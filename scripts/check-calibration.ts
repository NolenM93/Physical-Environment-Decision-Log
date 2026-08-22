/**
 * Ground-truth check for the single-image calibration.
 *
 * `make-room-photo.mjs` renders a room through a pinhole camera whose focal
 * length, height and dimensions are known exactly. This runs the real pipeline
 * over those pixels and reports how close the recovered numbers land. It is the
 * only honest answer to "does the measuring actually work".
 */

import { readFileSync, existsSync } from 'node:fs';
import { analyzePhoto } from '../src/lib/vision/analyze';
import { fitFloorFromQuad, liftDetections } from '../src/lib/vision/reconstruct';
import { imageToFloor } from '../src/lib/vision/calibration';
import { v2 } from '../src/lib/geometry/vec';
import { categoryFromLabel } from '../src/lib/domain/catalog';
import { TRUTH } from './room-truth.mjs';

const RAW = 'scripts/.shots/synthetic-room.rgba';
if (!existsSync(RAW)) {
  console.error('Run `node scripts/make-room-photo.mjs` first.');
  process.exit(1);
}

const { width, height, focalPx, camera, pitchDeg, yawDeg, room } = TRUTH;

/** The same projection the renderer used, so truth and test agree by construction. */
function project(p: [number, number, number]): [number, number] {
  let x = p[0] - camera.x;
  let y = p[1] - camera.y;
  let z = p[2] - camera.z;
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  [x, z] = [x * Math.cos(yaw) - z * Math.sin(yaw), x * Math.sin(yaw) + z * Math.cos(yaw)];
  [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
  return [width / 2 + (focalPx * x) / z, height / 2 - (focalPx * y) / z];
}

const pixels = new Uint8ClampedArray(readFileSync(RAW));
const analysis = analyzePhoto({
  pixels,
  width,
  height,
  cameraHeight: camera.y,
  maxDimension: 1000,
});
const calib = analysis.calibration;

console.log('\n=== vanishing points (analysis pixels) ===');
console.log(`  analysis image ${analysis.analysisWidth}x${analysis.analysisHeight}`);
for (const c of analysis.clusters) {
  const p = c.point;
  console.log(
    `  ${c.kind.padEnd(10)} ${p ? `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})` : 'at infinity'}` +
      `  from ${c.indices.length} segments`,
  );
}

const failures: string[] = [];
/** Percentage error, recorded against a budget so this can fail CI rather than just inform. */
function check(label: string, got: number, want: number, budgetPct: number): string {
  const pct = (Math.abs(got - want) / Math.abs(want)) * 100;
  if (pct > budgetPct) {
    failures.push(`${label}: ${pct.toFixed(1)}% off, budget ${budgetPct}%`);
  }
  return `${pct.toFixed(1)}%`;
}
const err = (got: number, want: number) => `${((Math.abs(got - want) / want) * 100).toFixed(1)}%`;
const row = (label: string, got: string, want: string, e: string) =>
  console.log(`  ${label.padEnd(28)} ${got.padStart(10)}   truth ${want.padStart(9)}   off by ${e}`);

console.log('\n=== camera ===');
for (const d of analysis.diagnostics) console.log(`  · ${d}`);
console.log();
row(
  'Focal length',
  `${calib.focal.toFixed(0)} px`,
  `${focalPx} px`,
  check('focal length', calib.focal, focalPx, 6),
);
row(
  'Principal point x',
  calib.principal.x.toFixed(0),
  (width / 2).toFixed(0),
  check('principal x', calib.principal.x, width / 2, 4),
);
row(
  'Principal point y',
  calib.principal.y.toFixed(0),
  (height / 2).toFixed(0),
  check('principal y', calib.principal.y, height / 2, 4),
);
console.log(`  ${'Confidence'.padEnd(22)} ${(calib.confidence * 100).toFixed(0)}%`);
console.log(`  ${'Solved from'.padEnd(22)} ${calib.source}`);

// Back-project the four true floor corners: this is what the user does by hand
// when dragging the quad onto the floor.
const corners: [number, number, number][] = [
  [0, 0, 0],
  [room.width, 0, 0],
  [room.width, 0, room.depth],
  [0, 0, room.depth],
];
const quad = corners.map(project).map(([x, y]) => v2(x, y));

console.log('\n=== floor ===');
const fit = fitFloorFromQuad(calib, quad);
if (!fit) {
  failures.push('floor: a corner back-projected above the horizon');
  console.log('  FAILED: a corner back-projected above the horizon.');
} else {
  row('Room width', `${fit.width.toFixed(2)} m`, `${room.width} m`, check('room width', fit.width, room.width, 5));
  row('Room depth', `${fit.depth.toFixed(2)} m`, `${room.depth} m`, check('room depth', fit.depth, room.depth, 5));
  row(
    'Floor area',
    `${fit.area.toFixed(2)} m²`,
    `${(room.width * room.depth).toFixed(2)} m²`,
    check('floor area', fit.area, room.width * room.depth, 6),
  );
  console.log(`  ${'Squareness'.padEnd(28)} ${(100 - fit.skew * 100).toFixed(0)}%`);
  if (fit.skew > 0.06) failures.push(`floor squareness: ${(fit.skew * 100).toFixed(0)}% skew`);
}

// A ruler laid on the floor: does a known distance measure back correctly?
console.log('\n=== distances on the floor ===');
const probes: [string, [number, number, number], [number, number, number]][] = [
  ['far wall, corner to corner', [0, 0, room.depth], [room.width, 0, room.depth]],
  ['right wall, front to back', [room.width, 0, 0], [room.width, 0, room.depth]],
  ['diagonal', [0, 0, 0], [room.width, 0, room.depth]],
  ['one metre near the middle', [2, 0, 2], [3, 0, 2]],
];
for (const [label, a, b] of probes) {
  const fa = imageToFloor(calib, v2(...project(a)));
  const fb = imageToFloor(calib, v2(...project(b)));
  if (!fa || !fb) {
    console.log(`  ${label.padEnd(28)} unreachable`);
    continue;
  }
  const got = Math.hypot(fa.x - fb.x, fa.y - fb.y);
  const want = Math.hypot(a[0] - b[0], a[2] - b[2]);
  row(label, `${got.toFixed(3)} m`, `${want.toFixed(3)} m`, check(`distance ${label}`, got, want, 5));
}

// Finally the thing the user cares about: furniture footprints in metres.
console.log('\n=== furniture ===');
const PIECES = TRUTH.pieces as [string, number, number, number, number, number][];
const detections = PIECES.map(([label, cx, cz, w, h, d], i) => {
  // The bounding box a detector would draw around the piece, normalised the way
  // the detection contract expects.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const sx of [-1, 1])
    for (const sy of [0, 1])
      for (const sz of [-1, 1]) {
        const [u, v] = project([cx + (sx * w) / 2, sy * h, cz + (sz * d) / 2]);
        x0 = Math.min(x0, u);
        y0 = Math.min(y0, v);
        x1 = Math.max(x1, u);
        y1 = Math.max(y1, v);
      }
  return {
    id: `d${i}`,
    label,
    category: categoryFromLabel(label),
    score: 0.9,
    box: {
      x: x0 / width,
      y: y0 / height,
      width: (x1 - x0) / width,
      height: (y1 - y0) / height,
    },
  };
});

const lifted = liftDetections(calib, detections);
for (const [label, , , w, h, d] of PIECES) {
  const got = lifted.find((l) => l.label === label);
  if (!got) {
    console.log(`  ${label.padEnd(16)} not lifted`);
    continue;
  }
  const wantFootprint = Math.max(w, d);
  const gotFootprint = Math.max(got.size.x, got.size.z);
  console.log(
    `  ${label.padEnd(16)} ${gotFootprint.toFixed(2)} m across (truth ${wantFootprint.toFixed(2)}, ` +
      `off by ${err(gotFootprint, wantFootprint)}), ${got.size.y.toFixed(2)} m tall ` +
      `(truth ${h.toFixed(2)}, off by ${err(got.size.y, h)})`,
  );
}

// Lifted positions live in a camera-centred frame, so absolute coordinates are
// not comparable. The distances between pieces are, and they are what decides
// whether a rearrangement will actually fit.
console.log('\n=== gaps between pieces ===');
for (let i = 0; i < PIECES.length; i++) {
  for (let j = i + 1; j < PIECES.length; j++) {
    const a = lifted.find((l) => l.label === PIECES[i][0]);
    const b = lifted.find((l) => l.label === PIECES[j][0]);
    if (!a || !b) continue;
    const got = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    const want = Math.hypot(PIECES[i][1] - PIECES[j][1], PIECES[i][2] - PIECES[j][2]);
    row(
      `${PIECES[i][0]} ↔ ${PIECES[j][0]}`,
      `${got.toFixed(2)} m`,
      `${want.toFixed(2)} m`,
      // Looser: a bounding box cannot bound a rotated footprint, so metre-level
      // agreement is the honest ceiling here without a segmentation mask.
      check(`gap ${PIECES[i][0]}/${PIECES[j][0]}`, got, want, 25),
    );
  }
}

console.log();
if (failures.length) {
  console.log('FAILED');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log('OK: the camera, the floor and the furniture all landed inside budget.\n');
