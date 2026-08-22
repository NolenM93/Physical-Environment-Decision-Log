/**
 * Oriented boxes, polygons and the queries the constraint engine runs against
 * them (separating-axis overlap, Minkowski penetration, clearance distance,
 * point-in-polygon, polygon clipping).
 *
 * All plan-space, all metres.
 */

import {
  type Vec2,
  add2,
  clamp,
  cross2,
  dist2,
  dot2,
  len2,
  mul2,
  norm2,
  rot2,
  sub2,
  v2,
} from './vec';

/** Axis-aligned in its own frame, rotated by `rotation` radians about `center`. */
export interface Obb {
  center: Vec2;
  /** Full extents (width along local X, depth along local Y). */
  size: Vec2;
  rotation: number;
}

export interface Aabb {
  min: Vec2;
  max: Vec2;
}

export type Polygon = Vec2[];

export function obbAxes(o: Obb): [Vec2, Vec2] {
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  return [v2(c, s), v2(-s, c)];
}

export function obbCorners(o: Obb): [Vec2, Vec2, Vec2, Vec2] {
  const [ax, ay] = obbAxes(o);
  const hx = mul2(ax, o.size.x / 2);
  const hy = mul2(ay, o.size.y / 2);
  return [
    add2(add2(o.center, mul2(hx, -1)), mul2(hy, -1)),
    add2(add2(o.center, hx), mul2(hy, -1)),
    add2(add2(o.center, hx), hy),
    add2(add2(o.center, mul2(hx, -1)), hy),
  ];
}

export function obbToPolygon(o: Obb): Polygon {
  return obbCorners(o);
}

export function aabbOf(points: Vec2[]): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: v2(minX, minY), max: v2(maxX, maxY) };
}

export function aabbIntersects(a: Aabb, b: Aabb, pad = 0): boolean {
  return (
    a.min.x - pad <= b.max.x &&
    a.max.x + pad >= b.min.x &&
    a.min.y - pad <= b.max.y &&
    a.max.y + pad >= b.min.y
  );
}

/** Expand an OBB uniformly (used to test clearance envelopes). */
export function inflate(o: Obb, margin: number): Obb {
  return {
    center: o.center,
    rotation: o.rotation,
    size: v2(o.size.x + margin * 2, o.size.y + margin * 2),
  };
}

function projectOntoAxis(points: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = dot2(p, axis);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

export interface Overlap {
  /** Penetration depth in metres (0 when separated). */
  depth: number;
  /** Unit vector that pushes A out of B by the minimum distance. */
  axis: Vec2;
}

/**
 * Separating-axis test between two oriented boxes.
 * Returns null when they do not overlap, otherwise the minimum translation.
 */
export function obbOverlap(a: Obb, b: Obb): Overlap | null {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [...obbAxes(a), ...obbAxes(b)];

  let best = Infinity;
  let bestAxis = v2(1, 0);

  for (const axis of axes) {
    const pa = projectOntoAxis(ca, axis);
    const pb = projectOntoAxis(cb, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null;
    if (overlap < best) {
      best = overlap;
      bestAxis = axis;
    }
  }

  const dir = sub2(a.center, b.center);
  const signed = dot2(dir, bestAxis) < 0 ? mul2(bestAxis, -1) : bestAxis;
  return { depth: best, axis: signed };
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  if (l2 < 1e-12) return a;
  const t = clamp(dot2(sub2(p, a), ab) / l2, 0, 1);
  return add2(a, mul2(ab, t));
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  return dist2(p, closestPointOnSegment(p, a, b));
}

export function segmentSegmentDistance(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

export function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = cross2(sub2(b2, b1), sub2(a1, b1));
  const d2 = cross2(sub2(b2, b1), sub2(a2, b1));
  const d3 = cross2(sub2(a2, a1), sub2(b1, a1));
  const d4 = cross2(sub2(a2, a1), sub2(b2, a1));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const onSeg = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.abs(cross2(sub2(q, p), sub2(r, p))) < 1e-12 &&
    Math.min(p.x, q.x) - 1e-12 <= r.x &&
    r.x <= Math.max(p.x, q.x) + 1e-12 &&
    Math.min(p.y, q.y) - 1e-12 <= r.y &&
    r.y <= Math.max(p.y, q.y) + 1e-12;
  return onSeg(b1, b2, a1) || onSeg(b1, b2, a2) || onSeg(a1, a2, b1) || onSeg(a1, a2, b2);
}

/** Gap between two boxes; 0 when they touch or overlap. */
export function obbGap(a: Obb, b: Obb): number {
  if (obbOverlap(a, b)) return 0;
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const a1 = ca[i];
    const a2 = ca[(i + 1) % 4];
    for (let j = 0; j < 4; j++) {
      const b1 = cb[j];
      const b2 = cb[(j + 1) % 4];
      const d = segmentSegmentDistance(a1, a2, b1, b2);
      if (d < best) best = d;
    }
  }
  return best;
}

export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInObb(p: Vec2, o: Obb): boolean {
  const local = rot2(sub2(p, o.center), -o.rotation);
  return Math.abs(local.x) <= o.size.x / 2 && Math.abs(local.y) <= o.size.y / 2;
}

export function polygonArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly: Polygon): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = poly.length || 1;
    return v2(poly.reduce((s, p) => s + p.x, 0) / n, poly.reduce((s, p) => s + p.y, 0) / n);
  }
  a *= 0.5;
  return v2(cx / (6 * a), cy / (6 * a));
}

export function polygonPerimeterDistance(p: Vec2, poly: Polygon): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, pointSegmentDistance(p, poly[j], poly[i]));
  }
  return best;
}

/** Sutherland–Hodgman clip of `subject` against a convex `clip` polygon (CCW). */
export function clipPolygon(subject: Polygon, clip: Polygon): Polygon {
  let output = subject.slice();
  for (let i = 0, j = clip.length - 1; i < clip.length; j = i++) {
    const a = clip[j];
    const b = clip[i];
    const input = output;
    output = [];
    if (input.length === 0) break;
    const inside = (p: Vec2) => cross2(sub2(b, a), sub2(p, a)) >= 0;
    for (let k = 0; k < input.length; k++) {
      const cur = input[k];
      const prev = input[(k + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) {
          const ip = segmentLineIntersection(prev, cur, a, b);
          if (ip) output.push(ip);
        }
        output.push(cur);
      } else if (prevIn) {
        const ip = segmentLineIntersection(prev, cur, a, b);
        if (ip) output.push(ip);
      }
    }
  }
  return output;
}

function segmentLineIntersection(p1: Vec2, p2: Vec2, a: Vec2, b: Vec2): Vec2 | null {
  const r = sub2(p2, p1);
  const s = sub2(b, a);
  const denom = cross2(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const t = cross2(sub2(a, p1), s) / denom;
  return add2(p1, mul2(r, t));
}

/** Andrew's monotone chain convex hull (CCW). */
export function convexHull(points: Vec2[]): Polygon {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const build = (src: Vec2[]) => {
    const stack: Vec2[] = [];
    for (const p of src) {
      while (
        stack.length >= 2 &&
        cross2(sub2(stack[stack.length - 1], stack[stack.length - 2]), sub2(p, stack[stack.length - 2])) <= 0
      ) {
        stack.pop();
      }
      stack.push(p);
    }
    return stack;
  };
  const lower = build(pts);
  const upper = build(pts.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Sample an annulus sector as a polygon (door swing arcs, sun wedges). */
export function arcPolygon(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments = 16,
): Polygon {
  const poly: Polygon = [center];
  for (let i = 0; i <= segments; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / segments;
    poly.push(v2(center.x + Math.cos(t) * radius, center.y + Math.sin(t) * radius));
  }
  return poly;
}

/** Signed distance from `p` to the nearest wall of a closed room polygon. */
export function distanceToWalls(p: Vec2, room: Polygon): number {
  const d = polygonPerimeterDistance(p, room);
  return pointInPolygon(p, room) ? d : -d;
}

export function directionFromAngle(rad: number): Vec2 {
  return v2(Math.cos(rad), Math.sin(rad));
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function resamplePolyline(points: Vec2[], step: number): Vec2[] {
  if (points.length < 2) return points.slice();
  const out: Vec2[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = sub2(b, a);
    const l = len2(seg);
    if (l < 1e-9) continue;
    const dir = norm2(seg);
    let t = step - carry;
    while (t <= l) {
      out.push(add2(a, mul2(dir, t)));
      t += step;
    }
    carry = (l - (t - step)) % step;
  }
  out.push(points[points.length - 1]);
  return out;
}
