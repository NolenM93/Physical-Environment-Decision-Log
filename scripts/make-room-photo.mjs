/**
 * Renders a synthetic room photograph with known geometry.
 *
 * The calibration pipeline claims to recover focal length, camera height and
 * metric floor positions from one ordinary photo. The only way to know whether
 * it does is to feed it an image whose true answer is written down. This draws
 * a 4.6 x 3.8 m room through a pinhole camera at a known pose, so the numbers
 * the app reports can be checked against the numbers that went in.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TRUTH } from './room-truth.mjs';

const SHADES = {
  bookcase: ['#8d6c48', '#75593b', '#816241'],
  sofa: ['#8a93a6', '#6f7889', '#7c8598'],
  'media unit': ['#6f6154', '#5b4f45', '#665a4d'],
  'coffee table': ['#a8804f', '#8a6840', '#9a7548'],
};

const SCENE = `
const W = ${TRUTH.width}, H = ${TRUTH.height}, F = ${TRUTH.focalPx};
const CAM = ${JSON.stringify(TRUTH.camera)};
const PITCH = ${TRUTH.pitchDeg} * Math.PI / 180;
const YAW = ${TRUTH.yawDeg} * Math.PI / 180;
const RW = ${TRUTH.room.width}, RD = ${TRUTH.room.depth}, RH = ${TRUTH.room.ceiling};

const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const g = canvas.getContext('2d');

function project(p) {
  let x = p[0] - CAM.x, y = p[1] - CAM.y, z = p[2] - CAM.z;
  const cy = Math.cos(YAW), sy = Math.sin(YAW);
  [x, z] = [x * cy - z * sy, x * sy + z * cy];
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  if (z <= 0.05) return null;
  return [W / 2 + (F * x) / z, H / 2 - (F * y) / z];
}

function face(points, fill, stroke) {
  const pts = points.map(project);
  if (pts.some((p) => !p)) return;
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2.5; g.stroke(); }
}

g.fillStyle = '#cfc7bb';
g.fillRect(0, 0, W, H);

// Room shell. The two walls behind the camera are left out, the way the near
// corner of any real room is: what remains is the corner the guidance asks for.
face([[0,0,RD],[RW,0,RD],[RW,RH,RD],[0,RH,RD]], '#cfc7bb', '#8d8578');   // far wall
face([[RW,0,0],[RW,0,RD],[RW,RH,RD],[RW,RH,0]], '#c6bfb4', '#8d8578');   // right wall
face([[0,0,0],[RW,0,0],[RW,0,RD],[0,0,RD]], '#8a7d6b', '#6d6254');       // floor

// Floorboards give the floor plane a strong set of parallel lines.
g.lineWidth = 1.2;
g.strokeStyle = 'rgba(90,80,66,0.55)';
for (let x = 0.3; x < RW; x += 0.3) {
  const a = project([x, 0, 0.02]), b = project([x, 0, RD - 0.02]);
  if (a && b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
}

// Windows on the far wall: more orthogonal edges, and something for the
// daylight model to chew on later.
face([[1.5,0.95,RD-0.01],[3.1,0.95,RD-0.01],[3.1,2.05,RD-0.01],[1.5,2.05,RD-0.01]], '#dfeaf2', '#6b7078');
face([[RW-0.01,0.95,2.2],[RW-0.01,0.95,3.3],[RW-0.01,2.05,3.3],[RW-0.01,2.05,2.2]], '#dfeaf2', '#6b7078');

function box(cx, cz, w, h, d, top, side, front) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  face([[x0,0,z0],[x1,0,z0],[x1,h,z0],[x0,h,z0]], front, '#2f2b26');
  face([[x0,0,z0],[x0,0,z1],[x0,h,z1],[x0,h,z0]], side, '#2f2b26');
  face([[x1,0,z0],[x1,0,z1],[x1,h,z1],[x1,h,z0]], side, '#2f2b26');
  face([[x0,h,z0],[x1,h,z0],[x1,h,z1],[x0,h,z1]], top, '#2f2b26');
}

// Known furniture, in metres, painted back to front so nothing floats.
const PIECES = ${JSON.stringify(TRUTH.pieces.map(([label, ...rest]) => [...rest, ...SHADES[label]]))};
const dist = (p) => Math.hypot(p[0] - CAM.x, p[1] - CAM.z);
for (const p of [...PIECES].sort((a, b) => dist(b) - dist(a))) box(...p);
`;

export async function renderRoomPhoto(dir = 'scripts/.shots') {
  mkdirSync(dir, { recursive: true });
  const png = `${dir}/synthetic-room.png`;
  const raw = `${dir}/synthetic-room.rgba`;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: TRUTH.width, height: TRUTH.height },
  });
  await page.setContent('<body style="margin:0"><canvas id="c"></canvas></body>');
  await page.evaluate(SCENE);
  await page.locator('#c').screenshot({ path: png });

  // The pipeline wants pixels, not a PNG. Handing it raw RGBA keeps the headless
  // check free of an image-decoding dependency.
  const bytes = await page.evaluate(() => {
    const c = document.getElementById('c');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return Array.from(d);
  });
  writeFileSync(raw, Buffer.from(bytes));
  await browser.close();
  return { png, raw };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await renderRoomPhoto();
  console.log(`wrote ${out.png} and ${out.raw}`);
}
