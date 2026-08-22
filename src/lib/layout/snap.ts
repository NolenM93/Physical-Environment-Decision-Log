/**
 * Snapping while you drag.
 *
 * Priority matters: a piece that is nearly flush with a wall should go flush
 * and square to it, because that is almost always the intent, and only then
 * should alignment with other furniture or the grid apply. Every snap that
 * fires reports a guide line so the reason is visible rather than magic.
 */

import { type Vec2, angleDelta180, v2, wrapAngle } from '../geometry/vec';
import { type Obb, obbCorners } from '../geometry/shapes';

export interface SnapGuide {
  kind: 'wall' | 'align-x' | 'align-y' | 'edge';
  a: Vec2;
  b: Vec2;
  label?: string;
}

export interface SnapContext {
  roomFootprint: Vec2[];
  others: { id: string; obb: Obb }[];
  enabled: boolean;
  gridStep: number;
  angleStepDeg: number;
  wallThreshold?: number;
  alignThreshold?: number;
}

export interface SnapResult {
  position: Vec2;
  rotation: number;
  guides: SnapGuide[];
  snappedToWall: boolean;
}

interface WallLine {
  a: Vec2;
  b: Vec2;
  angle: number;
  inward: Vec2;
}

function wallLines(footprint: Vec2[]): WallLine[] {
  const centroid = footprint.reduce(
    (acc, p) => v2(acc.x + p.x / footprint.length, acc.y + p.y / footprint.length),
    v2(0, 0),
  );
  const out: WallLine[] = [];
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const a = footprint[j];
    const b = footprint[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
    let inward = v2(-dy / len, dx / len);
    if ((centroid.x - mid.x) * inward.x + (centroid.y - mid.y) * inward.y < 0) {
      inward = v2(-inward.x, -inward.y);
    }
    out.push({ a, b, angle: Math.atan2(dy, dx), inward });
  }
  return out;
}

/** Half-extent of an OBB projected onto a direction. */
function supportRadius(size: Vec2, rotation: number, dir: Vec2): number {
  const ax = v2(Math.cos(rotation), Math.sin(rotation));
  const ay = v2(-Math.sin(rotation), Math.cos(rotation));
  return (
    Math.abs((ax.x * dir.x + ax.y * dir.y) * size.x) / 2 +
    Math.abs((ay.x * dir.x + ay.y * dir.y) * size.y) / 2
  );
}

export function snapPlacement(
  candidate: { position: Vec2; rotation: number; size: Vec2 },
  ctx: SnapContext,
): SnapResult {
  const guides: SnapGuide[] = [];
  let { position, rotation } = candidate;
  let snappedToWall = false;

  if (!ctx.enabled) return { position, rotation, guides, snappedToWall };

  const wallThreshold = ctx.wallThreshold ?? 0.22;
  const alignThreshold = ctx.alignThreshold ?? 0.07;

  // --- 1. Walls -----------------------------------------------------------
  const walls = wallLines(ctx.roomFootprint);
  let bestWall: { wall: WallLine; distance: number } | null = null;

  for (const wall of walls) {
    if (angleDelta180(rotation, wall.angle) > (18 * Math.PI) / 180) continue;
    const rel = v2(position.x - wall.a.x, position.y - wall.a.y);
    const perp = rel.x * wall.inward.x + rel.y * wall.inward.y;
    const halfDepth = supportRadius(candidate.size, rotation, wall.inward);
    const gap = perp - halfDepth;
    if (gap >= -0.05 && gap < wallThreshold && (!bestWall || gap < bestWall.distance)) {
      bestWall = { wall, distance: gap };
    }
  }

  if (bestWall) {
    const { wall } = bestWall;
    // Square up to the wall, choosing whichever 90° step is nearest.
    const quarter = Math.PI / 2;
    const relative = wrapAngle(rotation - wall.angle);
    rotation = wrapAngle(wall.angle + Math.round(relative / quarter) * quarter);

    const halfDepth = supportRadius(candidate.size, rotation, wall.inward);
    const rel = v2(position.x - wall.a.x, position.y - wall.a.y);
    const perp = rel.x * wall.inward.x + rel.y * wall.inward.y;
    const push = halfDepth - perp;
    position = v2(position.x + wall.inward.x * push, position.y + wall.inward.y * push);
    snappedToWall = true;
    guides.push({ kind: 'wall', a: wall.a, b: wall.b, label: 'flush' });
  } else {
    // --- 2. Angle steps ---------------------------------------------------
    const step = (ctx.angleStepDeg * Math.PI) / 180;
    if (step > 0) {
      const snapped = Math.round(rotation / step) * step;
      if (Math.abs(wrapAngle(rotation - snapped)) < (4 * Math.PI) / 180) rotation = snapped;
    }
  }

  // --- 3. Alignment with other pieces ------------------------------------
  let alignedX = false;
  let alignedY = false;
  for (const other of ctx.others) {
    if (!alignedX && Math.abs(other.obb.center.x - position.x) < alignThreshold) {
      position = v2(other.obb.center.x, position.y);
      alignedX = true;
      guides.push({
        kind: 'align-x',
        a: v2(other.obb.center.x, Math.min(other.obb.center.y, position.y) - 0.6),
        b: v2(other.obb.center.x, Math.max(other.obb.center.y, position.y) + 0.6),
      });
    }
    if (!alignedY && Math.abs(other.obb.center.y - position.y) < alignThreshold) {
      position = v2(position.x, other.obb.center.y);
      alignedY = true;
      guides.push({
        kind: 'align-y',
        a: v2(Math.min(other.obb.center.x, position.x) - 0.6, other.obb.center.y),
        b: v2(Math.max(other.obb.center.x, position.x) + 0.6, other.obb.center.y),
      });
    }
    if (alignedX && alignedY) break;
  }

  // --- 4. Edge contact with a neighbouring piece --------------------------
  if (!snappedToWall) {
    const self: Obb = { center: position, size: candidate.size, rotation };
    for (const other of ctx.others) {
      if (angleDelta180(rotation, other.obb.rotation) > (6 * Math.PI) / 180) continue;
      const axis = v2(Math.cos(other.obb.rotation), Math.sin(other.obb.rotation));
      const normal = v2(-axis.y, axis.x);
      for (const dir of [axis, normal]) {
        const delta = v2(position.x - other.obb.center.x, position.y - other.obb.center.y);
        const along = delta.x * dir.x + delta.y * dir.y;
        const need =
          supportRadius(self.size, rotation, dir) + supportRadius(other.obb.size, other.obb.rotation, dir);
        const gap = Math.abs(along) - need;
        if (gap > 0 && gap < 0.06) {
          const sign = Math.sign(along) || 1;
          position = v2(
            other.obb.center.x + dir.x * need * sign,
            other.obb.center.y + dir.y * need * sign,
          );
          const corners = obbCorners({ center: position, size: candidate.size, rotation });
          guides.push({ kind: 'edge', a: corners[0], b: corners[2], label: 'touching' });
          break;
        }
      }
    }
  }

  // --- 5. Grid fallback ---------------------------------------------------
  if (!snappedToWall && !alignedX && ctx.gridStep > 0) {
    position = v2(Math.round(position.x / ctx.gridStep) * ctx.gridStep, position.y);
  }
  if (!snappedToWall && !alignedY && ctx.gridStep > 0) {
    position = v2(position.x, Math.round(position.y / ctx.gridStep) * ctx.gridStep);
  }

  return { position, rotation, guides, snappedToWall };
}

/**
 * Push a footprint back inside the room if a drag left it hanging out.
 * Only corrects the perpendicular overshoot, so the piece slides along the
 * wall rather than jumping.
 */
export function containWithinRoom(
  position: Vec2,
  size: Vec2,
  rotation: number,
  footprint: Vec2[],
): Vec2 {
  let result = position;
  for (const wall of wallLines(footprint)) {
    const rel = v2(result.x - wall.a.x, result.y - wall.a.y);
    const perp = rel.x * wall.inward.x + rel.y * wall.inward.y;
    const half = supportRadius(size, rotation, wall.inward);
    if (perp < half) {
      const push = half - perp;
      result = v2(result.x + wall.inward.x * push, result.y + wall.inward.y * push);
    }
  }
  return result;
}
