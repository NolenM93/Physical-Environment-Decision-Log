/**
 * Reshape a room and keep doors glued to the walls they sat on.
 */

import type { RoomFeature } from '../domain/types';
import { aabbOf, polygonArea, polygonCentroid } from './shapes';
import { type Vec2, v2 } from './vec';

const MIN_EDGE = 0.6;
const MIN_AREA = 2;

export function footprintSize(footprint: Vec2[]) {
  const box = aabbOf(footprint);
  return {
    width: box.max.x - box.min.x,
    depth: box.max.y - box.min.y,
    min: box.min,
    max: box.max,
  };
}

export function setFootprintSize(footprint: Vec2[], width: number, depth: number): Vec2[] {
  const { width: w, depth: d, min } = footprintSize(footprint);
  const sx = w > 1e-6 ? Math.max(1.5, width) / w : 1;
  const sy = d > 1e-6 ? Math.max(1.5, depth) / d : 1;
  return footprint.map((p) => v2(min.x + (p.x - min.x) * sx, min.y + (p.y - min.y) * sy));
}

export function nearestEdge(footprint: Vec2[], p: Vec2) {
  let best = {
    index: 0,
    t: 0,
    point: footprint[0] ?? v2(0, 0),
    dist: Infinity,
    a: footprint[0] ?? v2(0, 0),
    b: footprint[0] ?? v2(0, 0),
  };
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    const q = v2(a.x + ex * t, a.y + ey * t);
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (dist < best.dist) best = { index: i, t, point: q, dist, a, b };
  }
  return best;
}

export function edgeFacing(footprint: Vec2[], edgeIndex: number): number {
  const a = footprint[edgeIndex];
  const b = footprint[(edgeIndex + 1) % footprint.length];
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  let nx = -ey / len;
  let ny = ex / len;
  const c = polygonCentroid(footprint);
  const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
  if ((c.x - mid.x) * nx + (c.y - mid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return Math.atan2(ny, nx);
}

export function placeOnEdge(
  footprint: Vec2[],
  edgeIndex: number,
  t: number,
): { position: Vec2; facing: number } {
  const a = footprint[edgeIndex];
  const b = footprint[(edgeIndex + 1) % footprint.length];
  const tt = Math.max(0, Math.min(1, t));
  return {
    position: v2(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt),
    facing: edgeFacing(footprint, edgeIndex),
  };
}

export function featureAnchor(footprint: Vec2[], feature: { position: Vec2 }) {
  const hit = nearestEdge(footprint, feature.position);
  return { index: hit.index, t: hit.t };
}

export function remapFeatures(features: RoomFeature[], oldFoot: Vec2[], newFoot: Vec2[]): RoomFeature[] {
  return features.map((f) => {
    const { index, t } = featureAnchor(oldFoot, f);
    const edge = ((index % newFoot.length) + newFoot.length) % newFoot.length;
    const placed = placeOnEdge(newFoot, edge, t);
    return { ...f, position: placed.position, facing: placed.facing };
  });
}

export function moveVertex(footprint: Vec2[], index: number, point: Vec2): Vec2[] {
  return footprint.map((p, i) => (i === index ? point : p));
}

export function moveEdge(footprint: Vec2[], edgeIndex: number, world: Vec2): Vec2[] {
  const a = footprint[edgeIndex];
  const b = footprint[(edgeIndex + 1) % footprint.length];
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  const nx = -ey / len;
  const ny = ex / len;
  const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
  const delta = (world.x - mid.x) * nx + (world.y - mid.y) * ny;
  return footprint.map((p, i) => {
    if (i === edgeIndex || i === (edgeIndex + 1) % footprint.length) {
      return v2(p.x + nx * delta, p.y + ny * delta);
    }
    return p;
  });
}

export function insertVertex(footprint: Vec2[], edgeIndex: number, point: Vec2): Vec2[] {
  const next = footprint.slice();
  next.splice(edgeIndex + 1, 0, point);
  return next;
}

export function removeVertex(footprint: Vec2[], index: number): Vec2[] {
  if (footprint.length <= 3) return footprint;
  return footprint.filter((_, i) => i !== index);
}

export function slideFeature(footprint: Vec2[], feature: { position: Vec2; width: number }, world: Vec2) {
  const hit = nearestEdge(footprint, world);
  const len = Math.hypot(hit.b.x - hit.a.x, hit.b.y - hit.a.y) || 1;
  const pad = Math.min(0.45, feature.width / 2 / len);
  const t = Math.max(pad, Math.min(1 - pad, hit.t));
  const placed = placeOnEdge(footprint, hit.index, t);
  return { position: placed.position, facing: placed.facing, edgeIndex: hit.index };
}

export function isUsableFootprint(footprint: Vec2[]): boolean {
  if (footprint.length < 3) return false;
  if (polygonArea(footprint) < MIN_AREA) return false;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_EDGE) return false;
  }
  return true;
}

export function snapPoint(p: Vec2, step: number): Vec2 {
  if (step <= 0) return p;
  return v2(Math.round(p.x / step) * step, Math.round(p.y / step) * step);
}

export function longestFreeEdge(footprint: Vec2[], features: RoomFeature[]) {
  let best = { index: 0, length: 0 };
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const occupied = features.some((f) => nearestEdge(footprint, f.position).index === i);
    const score = occupied ? length * 0.35 : length;
    if (score > best.length) best = { index: i, length: score };
  }
  return best.index;
}

export const OPENING_KINDS = new Set(['door', 'sliding_door', 'opening']);
