/**
 * A rasterised view of the room used for everything that is easier as a field
 * than as geometry: how much clear floor there is, whether you can actually
 * walk from the door to the sofa, and how far you would have to carry things.
 *
 * Cells are ~6 cm. A generous living room is then about 80 x 60 cells, so
 * every pass here is trivially fast and can run on every drag frame.
 */

import { type Vec2, v2 } from '../geometry/vec';
import { type Obb, type Polygon, aabbOf, obbCorners, pointInPolygon, pointInObb } from '../geometry/shapes';

export const CELL_SIZE = 0.06;

export type CellState = 0 | 1 | 2;
export const OUTSIDE: CellState = 0;
export const FREE: CellState = 1;
export const BLOCKED: CellState = 2;

export interface OccupancyGrid {
  cols: number;
  rows: number;
  cell: number;
  origin: Vec2;
  state: Uint8Array;
  /** Metres from each free cell to the nearest blocked cell or wall. */
  clearance: Float32Array;
  /** Index of the blocker occupying each cell, or -1. */
  owner: Int16Array;
}

export interface Blocker {
  obb: Obb;
  /** Things you can walk over (rugs) or under (wall-mounted) do not block. */
  passable: boolean;
}

export function buildGrid(room: Polygon, blockers: Blocker[], cell = CELL_SIZE): OccupancyGrid {
  const bounds = aabbOf(room);
  const pad = cell * 2;
  const origin = v2(bounds.min.x - pad, bounds.min.y - pad);
  const cols = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x + pad * 2) / cell));
  const rows = Math.max(1, Math.ceil((bounds.max.y - bounds.min.y + pad * 2) / cell));

  const state = new Uint8Array(cols * rows);
  const owner = new Int16Array(cols * rows).fill(-1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = v2(origin.x + (c + 0.5) * cell, origin.y + (r + 0.5) * cell);
      state[r * cols + c] = pointInPolygon(p, room) ? FREE : OUTSIDE;
    }
  }

  blockers.forEach((b, index) => {
    if (b.passable) return;
    const box = aabbOf(obbCorners(b.obb));
    const c0 = Math.max(0, Math.floor((box.min.x - origin.x) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((box.max.x - origin.x) / cell));
    const r0 = Math.max(0, Math.floor((box.min.y - origin.y) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((box.max.y - origin.y) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const p = v2(origin.x + (c + 0.5) * cell, origin.y + (r + 0.5) * cell);
        if (!pointInObb(p, b.obb)) continue;
        const i = r * cols + c;
        state[i] = BLOCKED;
        if (owner[i] === -1) owner[i] = index;
      }
    }
  });

  const clearance = distanceTransform(state, cols, rows, cell);
  return { cols, rows, cell, origin, state, clearance, owner };
}

/**
 * Chamfer 3-4 distance transform: metres from each free cell to the nearest
 * non-free cell. Two sweeps, exact to within ~2% of true Euclidean distance.
 */
function distanceTransform(state: Uint8Array, cols: number, rows: number, cell: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = state[i] === FREE ? INF : 0;

  const straight = 1;
  const diagonal = Math.SQRT2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      let best = d[i];
      if (r > 0) best = Math.min(best, d[i - cols] + straight);
      if (c > 0) best = Math.min(best, d[i - 1] + straight);
      if (r > 0 && c > 0) best = Math.min(best, d[i - cols - 1] + diagonal);
      if (r > 0 && c < cols - 1) best = Math.min(best, d[i - cols + 1] + diagonal);
      d[i] = best;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      let best = d[i];
      if (r < rows - 1) best = Math.min(best, d[i + cols] + straight);
      if (c < cols - 1) best = Math.min(best, d[i + 1] + straight);
      if (r < rows - 1 && c < cols - 1) best = Math.min(best, d[i + cols + 1] + diagonal);
      if (r < rows - 1 && c > 0) best = Math.min(best, d[i + cols - 1] + diagonal);
      d[i] = best;
    }
  }

  for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i], 1e6) * cell;
  return d;
}

export function toCell(g: OccupancyGrid, p: Vec2): { c: number; r: number } {
  return {
    c: Math.floor((p.x - g.origin.x) / g.cell),
    r: Math.floor((p.y - g.origin.y) / g.cell),
  };
}

export function toPoint(g: OccupancyGrid, c: number, r: number): Vec2 {
  return v2(g.origin.x + (c + 0.5) * g.cell, g.origin.y + (r + 0.5) * g.cell);
}

export function inBounds(g: OccupancyGrid, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows;
}

export function clearanceAt(g: OccupancyGrid, p: Vec2): number {
  const { c, r } = toCell(g, p);
  if (!inBounds(g, c, r)) return 0;
  return g.clearance[r * g.cols + c];
}

/**
 * Flood fill from a set of seeds through cells whose clearance can accommodate
 * a body of `bodyRadius`.
 *
 * Two different areas fall out of this and they must not be confused. `mask`
 * holds the cells where a body's *centre* may stand, which is the free space
 * eroded by `bodyRadius` — the right thing for routing, but a wild understatement
 * of the room. `sweptM2` dilates that back out: the floor a person actually
 * covers as they walk the network, which is what a reader means by "walkable".
 */
export function reachableRegion(
  g: OccupancyGrid,
  seeds: Vec2[],
  bodyRadius: number,
): { mask: Uint8Array; areaM2: number; sweptM2: number } {
  const mask = new Uint8Array(g.cols * g.rows);
  const queue: number[] = [];

  const passable = (i: number) => g.state[i] === FREE && g.clearance[i] >= bodyRadius;

  for (const s of seeds) {
    const { c, r } = toCell(g, s);
    // Doors sit right against a wall, so search outward for a usable start.
    let placed = false;
    for (let radius = 0; radius <= 12 && !placed; radius++) {
      for (let dr = -radius; dr <= radius && !placed; dr++) {
        for (let dc = -radius; dc <= radius && !placed; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (!inBounds(g, cc, rr)) continue;
          const i = rr * g.cols + cc;
          if (!passable(i) || mask[i]) continue;
          mask[i] = 1;
          queue.push(i);
          placed = true;
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const r = (i / g.cols) | 0;
    const c = i - r * g.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (!inBounds(g, cc, rr)) continue;
        const j = rr * g.cols + cc;
        if (mask[j] || !passable(j)) continue;
        mask[j] = 1;
        queue.push(j);
      }
    }
  }

  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;

  const cellArea = g.cell * g.cell;
  return {
    mask,
    areaM2: count * cellArea,
    sweptM2: count ? sweptArea(g, mask, bodyRadius) : 0,
  };
}

/** Free floor within `radius` of a cell the walker's centre can occupy. */
function sweptArea(g: OccupancyGrid, mask: Uint8Array, radius: number): number {
  const n = g.cols * g.rows;
  const INF = 1e9;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = mask[i] ? 0 : INF;

  const diagonal = Math.SQRT2;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (d[i] === 0) continue;
      let best = d[i];
      if (r > 0) best = Math.min(best, d[i - g.cols] + 1);
      if (c > 0) best = Math.min(best, d[i - 1] + 1);
      if (r > 0 && c > 0) best = Math.min(best, d[i - g.cols - 1] + diagonal);
      if (r > 0 && c < g.cols - 1) best = Math.min(best, d[i - g.cols + 1] + diagonal);
      d[i] = best;
    }
  }
  for (let r = g.rows - 1; r >= 0; r--) {
    for (let c = g.cols - 1; c >= 0; c--) {
      const i = r * g.cols + c;
      if (d[i] === 0) continue;
      let best = d[i];
      if (r < g.rows - 1) best = Math.min(best, d[i + g.cols] + 1);
      if (c < g.cols - 1) best = Math.min(best, d[i + 1] + 1);
      if (r < g.rows - 1 && c < g.cols - 1) best = Math.min(best, d[i + g.cols + 1] + diagonal);
      if (r < g.rows - 1 && c > 0) best = Math.min(best, d[i + g.cols - 1] + diagonal);
      d[i] = best;
    }
  }

  let count = 0;
  const limit = radius / g.cell;
  for (let i = 0; i < n; i++) if (g.state[i] === FREE && d[i] <= limit) count++;
  return count * g.cell * g.cell;
}

export function isReachable(g: OccupancyGrid, mask: Uint8Array, p: Vec2, tolerance = 3): boolean {
  const { c, r } = toCell(g, p);
  for (let dr = -tolerance; dr <= tolerance; dr++) {
    for (let dc = -tolerance; dc <= tolerance; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (!inBounds(g, cc, rr)) continue;
      if (mask[rr * g.cols + cc]) return true;
    }
  }
  return false;
}

/**
 * A* between two plan points, preferring routes with generous clearance.
 * Used to work out how far something has to be carried, and along what line.
 */
export function findPath(
  g: OccupancyGrid,
  from: Vec2,
  to: Vec2,
  bodyRadius: number,
): { points: Vec2[]; lengthM: number; tightestM: number } | null {
  const start = toCell(g, from);
  const goal = toCell(g, to);
  if (!inBounds(g, start.c, start.r) || !inBounds(g, goal.c, goal.r)) return null;

  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const passable = (i: number) => g.state[i] === FREE && g.clearance[i] >= bodyRadius;

  const relaxTo = (cell: { c: number; r: number }) => {
    // Snap to the nearest passable cell if the exact one is blocked.
    for (let radius = 0; radius <= 16; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const cc = cell.c + dc;
          const rr = cell.r + dr;
          if (!inBounds(g, cc, rr)) continue;
          const i = rr * g.cols + cc;
          if (passable(i)) return i;
        }
      }
    }
    return -1;
  };

  const startIdx = relaxTo(start);
  const goalIdx = relaxTo(goal);
  if (startIdx < 0 || goalIdx < 0) return null;

  const goalR = (goalIdx / g.cols) | 0;
  const goalC = goalIdx - goalR * g.cols;
  const heuristic = (i: number) => {
    const r = (i / g.cols) | 0;
    const c = i - r * g.cols;
    return Math.hypot(c - goalC, r - goalR);
  };

  // Binary heap keyed on f-score.
  const heap: number[] = [];
  const fScore = new Float32Array(n).fill(Infinity);
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (fScore[heap[parent]] <= fScore[heap[k]]) break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let best = k;
        if (l < heap.length && fScore[heap[l]] < fScore[heap[best]]) best = l;
        if (r < heap.length && fScore[heap[r]] < fScore[heap[best]]) best = r;
        if (best === k) break;
        [heap[best], heap[k]] = [heap[k], heap[best]];
        k = best;
      }
    }
    return top;
  };

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startIdx);
  push(startIdx);

  while (heap.length) {
    const current = pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goalIdx) break;

    const r = (current / g.cols) | 0;
    const c = current - r * g.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (!inBounds(g, cc, rr)) continue;
        const j = rr * g.cols + cc;
        if (closed[j] || !passable(j)) continue;
        // Slight penalty for hugging obstacles, so routes feel walkable.
        const tightness = Math.max(0, 1 - g.clearance[j] / (bodyRadius * 3));
        const step = (dr && dc ? Math.SQRT2 : 1) * (1 + tightness * 0.8);
        const tentative = gScore[current] + step;
        if (tentative < gScore[j]) {
          gScore[j] = tentative;
          cameFrom[j] = current;
          fScore[j] = tentative + heuristic(j);
          push(j);
        }
      }
    }
  }

  if (!closed[goalIdx]) return null;

  const cells: number[] = [];
  for (let i = goalIdx; i !== -1; i = cameFrom[i]) cells.push(i);
  cells.reverse();

  const points: Vec2[] = [];
  let lengthM = 0;
  let tightestM = Infinity;
  let prev: Vec2 | null = null;
  for (const i of cells) {
    const r = (i / g.cols) | 0;
    const c = i - r * g.cols;
    const p = toPoint(g, c, r);
    if (prev) lengthM += Math.hypot(p.x - prev.x, p.y - prev.y);
    tightestM = Math.min(tightestM, g.clearance[i]);
    points.push(p);
    prev = p;
  }

  return { points: simplifyPath(points, g.cell * 0.9), lengthM, tightestM };
}

/**
 * The widest way across: over every route from `from` to `to`, the one whose
 * narrowest point is widest, and how wide that point is.
 *
 * This is the number a person means by "can I get past". Taking the bottleneck
 * of the *shortest* route instead would report a squeeze that nobody would
 * choose to make when there is an open way round.
 *
 * Cells within `ignoreRadius` of either end are not allowed to set the
 * bottleneck: a doorway is as wide as it is, and its reveal says nothing about
 * how the furniture is arranged.
 */
export function widestRoute(
  g: OccupancyGrid,
  from: Vec2,
  to: Vec2,
  minRadius: number,
  ignoreRadius = 0,
): number | null {
  const n = g.cols * g.rows;
  const passable = (i: number) => g.state[i] === FREE && g.clearance[i] >= minRadius;

  const nearEnd = (i: number): boolean => {
    if (ignoreRadius <= 0) return false;
    const r = (i / g.cols) | 0;
    const c = i - r * g.cols;
    const p = toPoint(g, c, r);
    return (
      Math.hypot(p.x - from.x, p.y - from.y) < ignoreRadius ||
      Math.hypot(p.x - to.x, p.y - to.y) < ignoreRadius
    );
  };
  const widthAt = (i: number) => (nearEnd(i) ? Infinity : g.clearance[i]);

  const relax = (p: Vec2) => {
    const { c, r } = toCell(g, p);
    for (let radius = 0; radius <= 16; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (!inBounds(g, cc, rr)) continue;
          const i = rr * g.cols + cc;
          if (passable(i)) return i;
        }
      }
    }
    return -1;
  };

  const start = relax(from);
  const goal = relax(to);
  if (start < 0 || goal < 0) return null;

  const best = new Float32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  best[start] = widthAt(start);

  // Max-heap keyed on the bottleneck achieved so far.
  const heap: number[] = [start];
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (best[heap[parent]] >= best[heap[k]]) break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let pick = k;
        if (l < heap.length && best[heap[l]] > best[heap[pick]]) pick = l;
        if (r < heap.length && best[heap[r]] > best[heap[pick]]) pick = r;
        if (pick === k) break;
        [heap[pick], heap[k]] = [heap[k], heap[pick]];
        k = pick;
      }
    }
    return top;
  };

  while (heap.length) {
    const current = pop();
    if (settled[current]) continue;
    settled[current] = 1;
    if (current === goal) break;

    const r = (current / g.cols) | 0;
    const c = current - r * g.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (!inBounds(g, cc, rr)) continue;
        const j = rr * g.cols + cc;
        if (settled[j] || !passable(j)) continue;
        const candidate = Math.min(best[current], widthAt(j));
        if (candidate > best[j]) {
          best[j] = candidate;
          push(j);
        }
      }
    }
  }

  if (best[goal] < 0) return null;
  return Number.isFinite(best[goal]) ? best[goal] : minRadius;
}

/** Ramer-Douglas-Peucker, so exported routes read as a few straight legs. */
export function simplifyPath(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const norm = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs((points[i].x - a.x) * dy - (points[i].y - a.y) * dx) / norm;
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [a, b];
  const left = simplifyPath(points.slice(0, index + 1), epsilon);
  const right = simplifyPath(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}
