/**
 * Lifting a calibrated photograph into a metric room.
 *
 * What a single image genuinely supports:
 *   - floor contact points, and therefore plan position and apparent width,
 *   - object height, via closest approach between the viewing ray to the
 *     silhouette top and the vertical line through the base,
 *   - wall positions, from the floor quad the user confirms.
 *
 * What it does not support: the depth of the hidden side of anything. We fill
 * that from category priors and mark it, rather than inventing precision.
 *
 * One nice consequence of doing this properly: if a detection's floor point
 * lands *outside* the room, the object is almost certainly wall-mounted, so we
 * re-solve it against the wall plane and recover its mounting height instead.
 */

import { type Vec2, clamp, dist2, len2, norm2, sub2, v2, v3, wrapAngle } from '../geometry/vec';
import { pointInPolygon, polygonArea } from '../geometry/shapes';
import { type CategoryPrior, categoryFromLabel, estimateMass, movabilityFromMass, priorFor } from '../domain/catalog';
import type { Detection2D, FurnitureCategory } from '../domain/types';
import { type Calibration, imageToFloor, heightFromTopPixel } from './calibration';

export interface FloorFit {
  /** Back-projected quad, metres, in the calibration's world frame. */
  polygon: Vec2[];
  /** Manhattan-rectified rectangle covering the same area. */
  rectangle: Vec2[];
  width: number;
  depth: number;
  area: number;
  /** How far the raw quad deviates from a rectangle, 0 = perfect. */
  skew: number;
}

/** Back-project a user-confirmed floor quad (pixels) into metric plan space. */
export function fitFloorFromQuad(calib: Calibration, quadPx: Vec2[]): FloorFit | null {
  if (quadPx.length < 3) return null;
  const pts: Vec2[] = [];
  for (const p of quadPx) {
    const f = imageToFloor(calib, p);
    if (!f) return null;
    pts.push(f);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const rectangle = [v2(minX, minY), v2(maxX, minY), v2(maxX, maxY), v2(minX, maxY)];
  const area = polygonArea(pts);
  const rectArea = (maxX - minX) * (maxY - minY);
  const skew = rectArea > 1e-6 ? clamp(1 - area / rectArea, 0, 1) : 1;

  return {
    polygon: pts,
    rectangle,
    width: maxX - minX,
    depth: maxY - minY,
    area,
    skew,
  };
}

export interface LiftedObject {
  detectionId: string;
  label: string;
  category: FurnitureCategory;
  /** Footprint centre in plan metres. */
  position: Vec2;
  /** Yaw, radians. */
  rotation: number;
  /** width x height x depth, metres. */
  size: { x: number; y: number; z: number };
  /** Base height above the floor — non-zero for wall-mounted things. */
  elevation: number;
  massKg: number;
  color: string;
  confidence: number;
  /** Human-readable notes on how much of this was inferred rather than measured. */
  provenance: string[];
  /** True when the depth came from a prior rather than the image. */
  depthAssumed: boolean;
}

export interface LiftOptions {
  /** Room polygon in the same frame, used for wall-mount recovery and snapping. */
  roomPolygon?: Vec2[];
  ceilingHeight?: number;
  /** Snap yaw to the Manhattan axes when within this many radians. */
  yawSnapTolerance?: number;
}

function sampleColorless(prior: CategoryPrior): string {
  return prior.color;
}

/**
 * Intersect the viewing ray with the vertical plane of each wall and keep the
 * nearest hit in front of the camera. Used when an object clearly is not on
 * the floor.
 */
function projectOntoWalls(
  calib: Calibration,
  px: Vec2,
  polygon: Vec2[],
  ceilingHeight: number,
): { point: Vec2; elevation: number; wallIndex: number } | null {
  const dCam = v3((px.x - calib.principal.x) / calib.focal, (px.y - calib.principal.y) / calib.focal, 1);
  const R = calib.rotationWorldToCamera;
  // world direction = R^T * dCam
  const d = {
    x: R[0][0] * dCam.x + R[1][0] * dCam.y + R[2][0] * dCam.z,
    y: R[0][1] * dCam.x + R[1][1] * dCam.y + R[2][1] * dCam.z,
    z: R[0][2] * dCam.x + R[1][2] * dCam.y + R[2][2] * dCam.z,
  };

  let best: { point: Vec2; elevation: number; wallIndex: number; t: number } | null = null;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    const e = sub2(b, a);
    const denom = d.x * e.y - d.z * e.x;
    if (Math.abs(denom) < 1e-9) continue;
    const originToA = v2(a.x - 0, a.y - 0); // camera plan position is the origin
    const t = (originToA.x * e.y - originToA.y * e.x) / denom;
    if (t <= 0.05) continue;
    const hitPlan = v2(d.x * t, d.z * t);
    const s = Math.abs(e.x) > Math.abs(e.y) ? (hitPlan.x - a.x) / e.x : (hitPlan.y - a.y) / e.y;
    if (s < -0.02 || s > 1.02) continue;
    const elevation = calib.cameraHeight + d.y * t;
    if (elevation < -0.05 || elevation > ceilingHeight + 0.3) continue;
    if (!best || t < best.t) best = { point: hitPlan, elevation, wallIndex: j, t };
  }
  return best ? { point: best.point, elevation: best.elevation, wallIndex: best.wallIndex } : null;
}

export function liftDetection(
  calib: Calibration,
  detection: Detection2D,
  options: LiftOptions = {},
): LiftedObject | null {
  const { roomPolygon, ceilingHeight = 2.5, yawSnapTolerance = (16 * Math.PI) / 180 } = options;
  const prior = priorFor(detection.category);
  const provenance: string[] = [];

  const bx = detection.box.x * calib.width;
  const by = detection.box.y * calib.height;
  const bw = detection.box.width * calib.width;
  const bh = detection.box.height * calib.height;

  const baseLeft = v2(bx, by + bh);
  const baseRight = v2(bx + bw, by + bh);
  const baseMid = v2(bx + bw / 2, by + bh);
  const topMid = v2(bx + bw / 2, by);

  const floorLeft = imageToFloor(calib, baseLeft);
  const floorRight = imageToFloor(calib, baseRight);
  const floorMid = imageToFloor(calib, baseMid);

  let position: Vec2 | null = floorMid;
  let elevation = 0;
  let widthM: number | null = null;
  let rotation = 0;

  if (floorLeft && floorRight && floorMid) {
    const span = sub2(floorRight, floorLeft);
    widthM = len2(span);
    const dir = norm2(span);
    rotation = Math.atan2(dir.y, dir.x);
    provenance.push('Position and width measured from the floor contact line.');
  }

  const insideRoom = roomPolygon && position ? pointInPolygon(position, roomPolygon) : true;

  if ((!position || !insideRoom) && roomPolygon) {
    const wallHit = projectOntoWalls(calib, baseMid, roomPolygon, ceilingHeight);
    if (wallHit && wallHit.elevation > 0.25) {
      const leftHit = projectOntoWalls(calib, baseLeft, roomPolygon, ceilingHeight);
      const rightHit = projectOntoWalls(calib, baseRight, roomPolygon, ceilingHeight);
      position = wallHit.point;
      elevation = wallHit.elevation;
      if (leftHit && rightHit) {
        widthM = dist2(leftHit.point, rightHit.point);
        const dir = norm2(sub2(rightHit.point, leftHit.point));
        rotation = Math.atan2(dir.y, dir.x);
      }
      provenance.push(
        `Base sits off the floor — solved against the wall plane, mounted ${elevation.toFixed(2)} m up.`,
      );
    }
  }

  if (!position) return null;

  // --- width, then the depth the width implies ---
  let clampPenalty = 0;
  if (widthM === null) {
    widthM = prior.size[0];
    clampPenalty += 0.3;
    provenance.push('Width fell back to a typical value.');
  }
  const clampedWidth = clamp(widthM, prior.widthRange[0], prior.widthRange[1]);
  if (Math.abs(clampedWidth - widthM) > 0.02) {
    clampPenalty += Math.min(0.35, Math.abs(clampedWidth - widthM) / Math.max(0.5, widthM));
    provenance.push(
      `Measured width ${widthM.toFixed(2)} m was outside the plausible range and was pulled to ${clampedWidth.toFixed(2)} m.`,
    );
  }

  const depth = clamp(clampedWidth * prior.depthRatio, 0.05, 4.5);
  provenance.push('Depth is inferred from the category — the far side is not visible in one photo.');

  // --- snap yaw to the Manhattan grid when it is close ---
  const snapped = snapYaw(rotation, yawSnapTolerance);
  if (snapped.snapped) provenance.push('Orientation snapped to the room axes.');
  rotation = snapped.yaw;

  // Footprint centre sits half a depth behind the contact line, away from camera.
  const inward = v2(-Math.sin(rotation), Math.cos(rotation));
  const camPlan = v2(0, 0);
  const away = sub2(position, camPlan);
  const sign = inward.x * away.x + inward.y * away.y >= 0 ? 1 : -1;
  const center = v2(position.x + inward.x * sign * (depth / 2), position.y + inward.y * sign * (depth / 2));
  const farEdge = v2(position.x + inward.x * sign * depth, position.y + inward.y * sign * depth);

  // --- height ---
  // The topmost pixel of the silhouette does not sit above the contact line. If
  // the piece is lower than the lens its top surface is visible, so the highest
  // pixel belongs to the *far* top edge — measuring it against the near edge
  // inflates a coffee table by half again. If the piece is taller than the lens
  // the top face is hidden and the near edge is the right one. Which case
  // applies depends on the height, so solve it, then check the assumption.
  const solveHeight = (base: Vec2) => {
    const h = heightFromTopPixel(calib, base, topMid);
    return h === null || !Number.isFinite(h) ? null : h - elevation;
  };
  let heightM = solveHeight(position);
  let usedFarEdge = false;
  if (heightM !== null && heightM + elevation < calib.cameraHeight) {
    const far = solveHeight(farEdge);
    if (far !== null && far > 0.02) {
      heightM = far;
      usedFarEdge = true;
    }
  }

  if (heightM === null || heightM <= 0.02) {
    heightM = prior.size[1];
    provenance.push('Height fell back to a typical value for this category.');
  } else {
    provenance.push(
      usedFarEdge
        ? 'Height measured from the silhouette top, against the back of the piece since its top surface is in view.'
        : 'Height measured from the silhouette top.',
    );
  }

  const clampedHeight = clamp(heightM, prior.heightRange[0], prior.heightRange[1]);
  if (Math.abs(clampedHeight - heightM) > 0.02) {
    clampPenalty += Math.min(0.35, Math.abs(clampedHeight - heightM) / Math.max(0.5, heightM));
    provenance.push(
      `Measured height ${heightM.toFixed(2)} m was implausible and was pulled to ${clampedHeight.toFixed(2)} m.`,
    );
  }

  const size = { x: clampedWidth, y: clampedHeight, z: depth };
  const confidence = clamp(
    calib.confidence * 0.55 + detection.score * 0.45 - clampPenalty - (detection.baseOccluded ? 0.2 : 0),
    0.05,
    0.95,
  );

  return {
    detectionId: detection.id,
    label: detection.label,
    category: detection.category,
    position: center,
    rotation: wrapAngle(rotation + Math.PI / 2),
    size,
    elevation,
    massKg: estimateMass(detection.category, size),
    color: detection.color ?? sampleColorless(prior),
    confidence,
    provenance,
    depthAssumed: true,
  };
}

function snapYaw(yaw: number, tolerance: number): { yaw: number; snapped: boolean } {
  const quarter = Math.PI / 2;
  const nearest = Math.round(yaw / quarter) * quarter;
  if (Math.abs(wrapAngle(yaw - nearest)) <= tolerance) return { yaw: nearest, snapped: true };
  return { yaw, snapped: false };
}

export function liftDetections(
  calib: Calibration,
  detections: Detection2D[],
  options: LiftOptions = {},
): LiftedObject[] {
  const out: LiftedObject[] = [];
  for (const d of detections) {
    const lifted = liftDetection(calib, d, options);
    if (lifted) out.push(lifted);
  }
  // Nearest first — the closest objects are the best measured.
  out.sort((a, b) => len2(a.position) - len2(b.position));
  return out;
}

/**
 * Move a room and everything in it so the plan sits in the positive quadrant
 * with a small margin. Purely cosmetic, but it makes every downstream readout
 * far easier to reason about.
 */
export function normaliseToOrigin(
  polygon: Vec2[],
  objects: LiftedObject[],
  margin = 0,
): { polygon: Vec2[]; objects: LiftedObject[]; offset: Vec2 } {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  if (!Number.isFinite(minX)) return { polygon, objects, offset: v2(0, 0) };
  const offset = v2(margin - minX, margin - minY);
  return {
    polygon: polygon.map((p) => v2(p.x + offset.x, p.y + offset.y)),
    objects: objects.map((o) => ({ ...o, position: v2(o.position.x + offset.x, o.position.y + offset.y) })),
    offset,
  };
}

export { priorFor, categoryFromLabel, movabilityFromMass };
