/**
 * Single-image metric calibration under the Manhattan-world assumption.
 *
 * Given line segments from one ordinary photograph we
 *   1. cluster them into up to three mutually orthogonal vanishing points
 *      (RANSAC + weighted total-least-squares refinement),
 *   2. recover focal length from the orthogonality constraint
 *      (v_i - p)·(v_j - p) + f² = 0,
 *   3. optionally recover the principal point as the orthocentre of the
 *      vanishing-point triangle,
 *   4. build the world<-camera rotation from the three vanishing directions,
 *   5. anchor metric scale with a single known quantity: the camera height.
 *
 * From there any pixel that lies on the floor can be back-projected to real
 * metres, which is what makes clearance and effort analysis meaningful rather
 * than decorative.
 *
 * Conventions
 *   image : (u, v) pixels, origin top-left, v down
 *   camera: x right, y down, z forward   (classic pinhole)
 *   world : x right, y up, z away from camera, origin on the floor directly
 *           beneath the camera
 */

import { type Mat, apply3, invert3, nullSpaceVector, transpose } from '../geometry/linalg';
import {
  type Hom,
  type Vec2,
  type Vec3,
  cross3,
  dot3,
  homCross,
  homNorm,
  homToPoint,
  lineThrough,
  norm3,
  sub3,
  v2,
  v3,
} from '../geometry/vec';
import type { LineSegment } from './lineSegments';

export interface VanishingPoint {
  /** Homogeneous image point; w ~ 0 means the direction is parallel to the plate. */
  hom: Hom;
  /** Finite image location, if it has one. */
  point: Vec2 | null;
  /** Indices into the input segment array. */
  inliers: number[];
  /** Sum of inlier lengths — a rough measure of evidence. */
  support: number;
  kind: 'vertical' | 'horizontal';
}

export interface VanishingResult {
  vertical: VanishingPoint | null;
  horizontal: VanishingPoint[];
  segments: LineSegment[];
  width: number;
  height: number;
}

export interface Calibration {
  /** Focal length in pixels of the (possibly downscaled) analysis image. */
  focal: number;
  principal: Vec2;
  width: number;
  height: number;
  /** World -> camera rotation, row-major 3x3. Columns are world axes in camera coords. */
  rotationWorldToCamera: Mat;
  /** Distance from the lens to the floor, metres. The only metric anchor. */
  cameraHeight: number;
  /** Vertical field of view in degrees, for driving a matching virtual camera. */
  fovDeg: number;
  /** 0..1 heuristic on how trustworthy this calibration is. */
  confidence: number;
  /** Where the true horizon sits in the image, useful for the overlay UI. */
  horizonLine: Hom | null;
  source: 'vanishing-points' | 'assumed-fov' | 'manual';
}

const DEG = Math.PI / 180;

function segmentLine(s: LineSegment): Hom {
  return lineThrough(s.a, s.b);
}

function segmentMid(s: LineSegment): Vec2 {
  return v2((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2);
}

/**
 * Angular residual (radians) between a segment and the direction it would need
 * in order to pass through the candidate vanishing point.
 */
function vpResidual(vp: Hom, s: LineSegment): number {
  const m = segmentMid(s);
  // Direction from midpoint toward the vanishing point, valid at infinity too.
  const dx = vp[0] - m.x * vp[2];
  const dy = vp[1] - m.y * vp[2];
  const dl = Math.hypot(dx, dy);
  if (dl < 1e-9) return Math.PI / 2;

  const sx = s.b.x - s.a.x;
  const sy = s.b.y - s.a.y;
  const sl = Math.hypot(sx, sy);
  if (sl < 1e-9) return Math.PI / 2;

  const cos = Math.abs((dx * sx + dy * sy) / (dl * sl));
  return Math.acos(Math.min(1, cos));
}

function refineVanishingPoint(vp: Hom, segments: LineSegment[], inliers: number[]): Hom {
  if (inliers.length < 2) return vp;
  // Weighted homogeneous least squares: the VP minimises sum_i w_i (l_i . v)^2.
  const rows = inliers.map((i) => {
    const l = segmentLine(segments[i]);
    const w = Math.sqrt(segments[i].length);
    return [l[0] * w, l[1] * w, l[2] * w];
  });
  const solved = nullSpaceVector(rows);
  const candidate = homNorm([solved[0], solved[1], solved[2]]);
  return candidate[0] === 0 && candidate[1] === 0 && candidate[2] === 0 ? vp : candidate;
}

interface RansacOptions {
  iterations: number;
  toleranceRad: number;
  minInliers: number;
  rng: () => number;
}

function ransacVanishingPoint(
  segments: LineSegment[],
  pool: number[],
  opts: RansacOptions,
): { vp: Hom; inliers: number[]; support: number } | null {
  if (pool.length < 3) return null;

  let bestVp: Hom | null = null;
  let bestScore = 0;
  let bestInliers: number[] = [];

  for (let iter = 0; iter < opts.iterations; iter++) {
    const i = pool[Math.floor(opts.rng() * pool.length)];
    let j = pool[Math.floor(opts.rng() * pool.length)];
    if (i === j) {
      j = pool[(pool.indexOf(i) + 1) % pool.length];
      if (i === j) continue;
    }
    const candidate = homNorm(homCross(segmentLine(segments[i]), segmentLine(segments[j])));
    if (!candidate[0] && !candidate[1] && !candidate[2]) continue;

    let score = 0;
    const inliers: number[] = [];
    for (const k of pool) {
      if (vpResidual(candidate, segments[k]) < opts.toleranceRad) {
        inliers.push(k);
        score += segments[k].length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestVp = candidate;
      bestInliers = inliers;
    }
  }

  if (!bestVp || bestInliers.length < opts.minInliers) return null;

  // Two rounds of refit -> re-classify, which tightens the estimate noticeably.
  let vp = bestVp;
  let inliers = bestInliers;
  for (let pass = 0; pass < 2; pass++) {
    vp = refineVanishingPoint(vp, segments, inliers);
    const next: number[] = [];
    let support = 0;
    for (const k of pool) {
      if (vpResidual(vp, segments[k]) < opts.toleranceRad) {
        next.push(k);
        support += segments[k].length;
      }
    }
    if (next.length >= opts.minInliers) {
      inliers = next;
      bestScore = support;
    }
  }

  return { vp, inliers, support: bestScore };
}

/** Deterministic PRNG so a given photo always calibrates identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function estimateVanishingPoints(
  segments: LineSegment[],
  width: number,
  height: number,
): VanishingResult {
  const rng = mulberry32(0x57a17a);
  const tolerance = 1.6 * DEG;

  // Segments within 22° of image-vertical are the candidates for the up axis.
  const verticalPool: number[] = [];
  const otherPool: number[] = [];
  segments.forEach((s, i) => {
    const fromVertical = Math.abs(s.angle - Math.PI / 2);
    if (fromVertical < 24 * DEG) verticalPool.push(i);
    else otherPool.push(i);
  });

  const commonOpts = { iterations: 900, toleranceRad: tolerance, minInliers: 3, rng };

  const verticalHit = ransacVanishingPoint(segments, verticalPool, {
    ...commonOpts,
    minInliers: 4,
  });

  const vertical: VanishingPoint | null = verticalHit
    ? {
        hom: verticalHit.vp,
        point: homToPoint(verticalHit.vp),
        inliers: verticalHit.inliers,
        support: verticalHit.support,
        kind: 'vertical',
      }
    : null;

  const horizontal: VanishingPoint[] = [];
  let remaining = otherPool.slice();
  for (let pass = 0; pass < 2 && remaining.length >= 4; pass++) {
    const hit = ransacVanishingPoint(segments, remaining, commonOpts);
    if (!hit) break;
    horizontal.push({
      hom: hit.vp,
      point: homToPoint(hit.vp),
      inliers: hit.inliers,
      support: hit.support,
      kind: 'horizontal',
    });
    const consumed = new Set(hit.inliers);
    remaining = remaining.filter((i) => !consumed.has(i));
  }

  horizontal.sort((a, b) => b.support - a.support);
  return { vertical, horizontal, segments, width, height };
}

function focalFromOrthogonalPair(a: Vec2, b: Vec2, principal: Vec2): number | null {
  const dot = (a.x - principal.x) * (b.x - principal.x) + (a.y - principal.y) * (b.y - principal.y);
  if (dot >= -1) return null;
  return Math.sqrt(-dot);
}

function clampUnit(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Smallest interior angle of a triangle, in radians. Near zero means a sliver. */
function minInteriorAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const angleAt = (p: Vec2, q: Vec2, r: Vec2) => {
    const u = { x: q.x - p.x, y: q.y - p.y };
    const v = { x: r.x - p.x, y: r.y - p.y };
    const lu = Math.hypot(u.x, u.y);
    const lv = Math.hypot(v.x, v.y);
    if (lu < 1e-9 || lv < 1e-9) return 0;
    return Math.acos(clampUnit((u.x * v.x + u.y * v.y) / (lu * lv), -1, 1));
  };
  return Math.min(angleAt(a, b, c), angleAt(b, a, c), angleAt(c, a, b));
}

function weightedMedian(entries: { focal: number; weight: number }[]): number {
  const sorted = [...entries].sort((a, b) => a.focal - b.focal);
  const total = sorted.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)].focal;
  let seen = 0;
  for (const e of sorted) {
    seen += e.weight;
    if (seen >= total / 2) return e.focal;
  }
  return sorted[sorted.length - 1].focal;
}

/** Orthocentre of the triangle of three finite vanishing points = principal point. */
function orthocentre(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  // Altitude from A is perpendicular to BC and passes through A.
  const dirBC = { x: c.x - b.x, y: c.y - b.y };
  const dirAC = { x: c.x - a.x, y: c.y - a.y };
  const det = dirBC.x * dirAC.y - dirBC.y * dirAC.x;
  if (Math.abs(det) < 1e-6) return null;
  // Solve: (P - A)·BC = 0 and (P - B)·AC = 0
  const rhs1 = a.x * dirBC.x + a.y * dirBC.y;
  const rhs2 = b.x * dirAC.x + b.y * dirAC.y;
  const x = (rhs1 * dirAC.y - rhs2 * dirBC.y) / det;
  const y = (dirBC.x * rhs2 - dirAC.x * rhs1) / det;
  return v2(x, y);
}

export interface CalibrateInput {
  vanishing: VanishingResult;
  cameraHeight: number;
  /** Fallback horizontal FOV when the geometry is too weak, degrees. */
  assumedHorizontalFov?: number;
  refinePrincipalPoint?: boolean;
}

export function calibrate(input: CalibrateInput): Calibration {
  const { vanishing, cameraHeight, assumedHorizontalFov = 66, refinePrincipalPoint = true } = input;
  const { width, height, vertical, horizontal } = vanishing;

  const diagonal = Math.hypot(width, height);
  /**
   * How much a vanishing point's *position* can be trusted. Total inlier length
   * is the obvious measure and the wrong one: two long, nearly parallel edges
   * look like strong evidence yet intersect at a point that slides hundreds of
   * pixels under a fraction of a degree of noise. Independent votes are what
   * pins a vanishing point down, so count them.
   */
  const votes = (vp: VanishingPoint | null) => (vp ? vp.inliers.length : 0);
  /** Total inlier length, for judging whether the photo had much to work with. */
  const evidence = (vp: VanishingPoint | null) => (vp ? vp.support / diagonal : 0);

  let principal = v2(width / 2, height / 2);
  const finite: VanishingPoint[] = [];
  if (vertical?.point) finite.push(vertical);
  for (const h of horizontal) if (h.point) finite.push(h);

  // The orthocentre is the textbook principal point, but it sits at the
  // intersection of three altitudes and inherits every bit of noise in the three
  // vanishing points, amplified. One direction supported by a couple of short
  // segments can drag it hundreds of pixels. For a phone photo the true answer
  // is the image centre to within a percent or two, so the refinement only earns
  // its place when all three directions are strongly supported, the triangle is
  // not a sliver, and the answer it gives is close to where we already believed
  // it was.
  if (refinePrincipalPoint && finite.length === 3 && finite.every((v) => votes(v) >= 10)) {
    const [a, b, c] = finite.map((v) => v.point!);
    const oc = orthocentre(a, b, c);
    if (oc && minInteriorAngle(a, b, c) >= 25 * DEG) {
      const drift = Math.hypot(oc.x - width / 2, oc.y - height / 2);
      if (drift <= Math.max(width, height) * 0.1) principal = oc;
    }
  }

  // Each orthogonal pair of vanishing points gives one focal estimate. They are
  // not equally trustworthy, so combine them by weighted median rather than
  // letting a five-segment direction outvote a fifty-segment one.
  const estimates: { focal: number; weight: number }[] = [];
  const pairs: Array<[VanishingPoint, VanishingPoint]> = [];
  if (vertical) for (const h of horizontal) pairs.push([vertical, h]);
  if (horizontal.length >= 2) pairs.push([horizontal[0], horizontal[1]]);

  for (const [a, b] of pairs) {
    if (!a.point || !b.point) continue;
    const f = focalFromOrthogonalPair(a.point, b.point, principal);
    if (f === null || !Number.isFinite(f) || f <= width * 0.15 || f >= width * 12) continue;
    estimates.push({ focal: f, weight: Math.min(votes(a), votes(b)) });
  }

  let focal: number;
  let source: Calibration['source'];
  let confidence: number;

  if (estimates.length) {
    focal = weightedMedian(estimates);
    source = 'vanishing-points';

    // Confidence has to answer "should I trust the measurements", so it is
    // driven by how much the independent estimates agree, not merely by how many
    // there were. Estimates that disagree by a third are worth saying so about.
    const spread =
      estimates.length > 1
        ? (Math.max(...estimates.map((e) => e.focal)) - Math.min(...estimates.map((e) => e.focal))) /
          focal
        : 0.12;
    const totalEvidence = evidence(vertical) + horizontal.reduce((s, h) => s + evidence(h), 0);
    const agreement = Math.exp(-spread * 2.2);
    confidence = clampUnit(
      0.2 + 0.35 * Math.min(1, totalEvidence / 4) + 0.45 * agreement,
      0.2,
      0.95,
    );
  } else {
    focal = width / 2 / Math.tan((assumedHorizontalFov * DEG) / 2);
    source = 'assumed-fov';
    confidence = 0.2;
  }

  const K: Mat = [
    [focal, 0, principal.x],
    [0, focal, principal.y],
    [0, 0, 1],
  ];
  const Kinv = invert3(K)!;

  const dirFromVp = (vp: Hom): Vec3 => {
    const d = apply3(Kinv, vp);
    return norm3(v3(d[0], d[1], d[2]));
  };

  // World up expressed in camera coordinates. Camera +y points down in the
  // image, so world up must have a negative y component.
  let upCam: Vec3;
  if (vertical) {
    upCam = dirFromVp(vertical.hom);
    if (upCam.y > 0) upCam = v3(-upCam.x, -upCam.y, -upCam.z);
  } else {
    upCam = v3(0, -1, 0);
  }

  // World forward (depth axis) from the strongest horizontal vanishing point.
  let fwdCam: Vec3;
  if (horizontal.length) {
    let best = dirFromVp(horizontal[0].hom);
    if (horizontal.length > 1) {
      const alt = dirFromVp(horizontal[1].hom);
      if (Math.abs(alt.z) > Math.abs(best.z)) best = alt;
    }
    fwdCam = best.z < 0 ? v3(-best.x, -best.y, -best.z) : best;
  } else {
    fwdCam = v3(0, 0, 1);
  }

  // Gram-Schmidt: keep up exact, project forward orthogonal to it.
  const proj = dot3(fwdCam, upCam);
  let zCam = norm3(sub3(fwdCam, { x: upCam.x * proj, y: upCam.y * proj, z: upCam.z * proj }));
  if (!Number.isFinite(zCam.x) || Math.hypot(zCam.x, zCam.y, zCam.z) < 0.5) {
    zCam = norm3(cross3(upCam, v3(1, 0, 0)));
  }
  const xCam = norm3(cross3(upCam, zCam));

  // Columns of R (world -> camera) are the world axes written in camera coords.
  const rotationWorldToCamera: Mat = [
    [xCam.x, upCam.x, zCam.x],
    [xCam.y, upCam.y, zCam.y],
    [xCam.z, upCam.z, zCam.z],
  ];

  const fovDeg = 2 * Math.atan(height / 2 / focal) * (180 / Math.PI);

  // Horizon = image of the line at infinity of the ground plane.
  let horizonLine: Hom | null = null;
  if (horizontal.length >= 2 && horizontal[0].point && horizontal[1].point) {
    horizonLine = lineThrough(horizontal[0].point, horizontal[1].point);
  }

  return {
    focal,
    principal,
    width,
    height,
    rotationWorldToCamera,
    cameraHeight,
    fovDeg,
    confidence,
    horizonLine,
    source,
  };
}

export function manualCalibration(
  width: number,
  height: number,
  cameraHeight: number,
  horizontalFovDeg: number,
  pitchDeg: number,
  yawDeg = 0,
): Calibration {
  const focal = width / 2 / Math.tan((horizontalFovDeg * DEG) / 2);
  const p = pitchDeg * DEG;
  const y = yawDeg * DEG;
  // Camera pitched down by `pitchDeg` about its right axis, then yawed.
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const xCam = v3(cy, 0, -sy);
  const upCam = v3(sy * sp, -cp, cy * sp);
  const zCam = norm3(cross3(upCam, xCam));
  return {
    focal,
    principal: v2(width / 2, height / 2),
    width,
    height,
    rotationWorldToCamera: [
      [xCam.x, upCam.x, zCam.x],
      [xCam.y, upCam.y, zCam.y],
      [xCam.z, upCam.z, zCam.z],
    ],
    cameraHeight,
    fovDeg: 2 * Math.atan(height / 2 / focal) * (180 / Math.PI),
    confidence: 0.35,
    horizonLine: null,
    source: 'manual',
  };
}

// --- Projection helpers -----------------------------------------------------

export function cameraPosition(c: Calibration): Vec3 {
  return v3(0, c.cameraHeight, 0);
}

function rayWorld(c: Calibration, px: Vec2): Vec3 {
  const dCam = v3((px.x - c.principal.x) / c.focal, (px.y - c.principal.y) / c.focal, 1);
  const Rwc = transpose(c.rotationWorldToCamera);
  const d = apply3(Rwc, [dCam.x, dCam.y, dCam.z]);
  return norm3(v3(d[0], d[1], d[2]));
}

/** Back-project a pixel that lies on the floor to metric plan coordinates. */
export function imageToFloor(c: Calibration, px: Vec2): Vec2 | null {
  const d = rayWorld(c, px);
  if (d.y > -1e-4) return null; // ray points at or above the horizon
  const t = -c.cameraHeight / d.y;
  if (!Number.isFinite(t) || t <= 0 || t > 200) return null;
  return v2(d.x * t, d.z * t);
}

/** Project a world point back into the photo. Returns null if behind the lens. */
export function worldToImage(c: Calibration, p: Vec3): Vec2 | null {
  const cam = cameraPosition(c);
  const rel: Vec3 = v3(p.x - cam.x, p.y - cam.y, p.z - cam.z);
  const d = apply3(c.rotationWorldToCamera, [rel.x, rel.y, rel.z]);
  if (d[2] <= 1e-6) return null;
  return v2(c.principal.x + (c.focal * d[0]) / d[2], c.principal.y + (c.focal * d[1]) / d[2]);
}

/**
 * Height of an object whose base sits at `floorPoint` and whose silhouette top
 * appears at `topPixel`, via closest approach between the viewing ray and the
 * vertical line through the base.
 */
export function heightFromTopPixel(c: Calibration, floorPoint: Vec2, topPixel: Vec2): number | null {
  const d = rayWorld(c, topPixel);
  const cam = cameraPosition(c);
  const w0 = v3(cam.x - floorPoint.x, cam.y - 0, cam.z - floorPoint.y);
  const b = d.y; // d . up
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return null;
  const dd = dot3(d, w0);
  const e = w0.y;
  const height = (e - b * dd) / denom;
  return Number.isFinite(height) ? height : null;
}

/**
 * Basis for a virtual camera that reproduces the photo exactly, expressed in
 * the three.js convention (x right, y up, z backward).
 */
export function virtualCameraBasis(c: Calibration): {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  back: Vec3;
  fovDeg: number;
} {
  const Rwc = transpose(c.rotationWorldToCamera);
  const col = (i: number): Vec3 => v3(Rwc[0][i], Rwc[1][i], Rwc[2][i]);
  const right = col(0);
  const down = col(1);
  const forward = col(2);
  return {
    position: cameraPosition(c),
    right,
    up: v3(-down.x, -down.y, -down.z),
    back: v3(-forward.x, -forward.y, -forward.z),
    fovDeg: c.fovDeg,
  };
}

/** Rescale a calibration computed on a downscaled image to full resolution. */
export function rescaleCalibration(c: Calibration, targetWidth: number): Calibration {
  const k = targetWidth / c.width;
  if (Math.abs(k - 1) < 1e-9) return c;
  return {
    ...c,
    focal: c.focal * k,
    principal: v2(c.principal.x * k, c.principal.y * k),
    width: c.width * k,
    height: c.height * k,
  };
}
