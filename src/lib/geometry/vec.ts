/**
 * Minimal 2D/3D vector + homogeneous math.
 *
 * Everything in Stanza is stored in metres, with the room's floor on the XZ
 * plane and +Y pointing at the ceiling (matching three.js). Plan-space (2D)
 * coordinates therefore map as (x, z).
 */

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** Homogeneous 2D point / 2D line, both live in P^2 as 3-vectors. */
export type Hom = readonly [number, number, number];

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const perp2 = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const rot2 = (a: Vec2, rad: number): Vec2 => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a);
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

// --- Homogeneous helpers (used heavily by the vanishing-point solver) ---

export const homCross = (a: Hom, b: Hom): Hom => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const homDot = (a: Hom, b: Hom): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const homNorm = (a: Hom): Hom => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-15 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

/** Dehomogenise. Returns null for points at (or extremely near) infinity. */
export const homToPoint = (a: Hom): Vec2 | null => {
  if (Math.abs(a[2]) < 1e-9) return null;
  return { x: a[0] / a[2], y: a[1] / a[2] };
};

export const pointToHom = (p: Vec2): Hom => [p.x, p.y, 1];

/** The line through two image points, normalised so (a,b) is a unit normal. */
export function lineThrough(p: Vec2, q: Vec2): Hom {
  const l = homCross(pointToHom(p), pointToHom(q));
  const n = Math.hypot(l[0], l[1]);
  return n < 1e-12 ? l : [l[0] / n, l[1] / n, l[2] / n];
}

/** Signed perpendicular distance from a point to a normalised line. */
export const pointLineDistance = (l: Hom, p: Vec2): number => l[0] * p.x + l[1] * p.y + l[2];

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const TAU = Math.PI * 2;

/** Wrap to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r <= -Math.PI) r += TAU;
  return r;
}

/** Smallest absolute difference between two headings, ignoring 180° flips. */
export function angleDelta180(a: number, b: number): number {
  const d = Math.abs(wrapAngle(a - b));
  return Math.min(d, Math.PI - d);
}
