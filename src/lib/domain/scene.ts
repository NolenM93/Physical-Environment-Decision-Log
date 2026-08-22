/**
 * Resolving a layout: joining placements to inventory and producing the
 * geometry every other subsystem consumes.
 */

import { type Vec2, type Vec3, v2, v3 } from '../geometry/vec';
import { type Obb, type Polygon, arcPolygon, obbCorners, obbToPolygon } from '../geometry/shapes';
import { type CategoryPrior, priorFor } from './catalog';
import type { InventoryItem, Layout, PlacedItem, Room, RoomFeature } from './types';

export interface ResolvedItem {
  id: string;
  placed: PlacedItem;
  item: InventoryItem;
  prior: CategoryPrior;
  /** Footprint in plan space, already scaled and rotated. */
  obb: Obb;
  size: Vec3;
  /** Top of the item above the floor. */
  topY: number;
  /** Bottom of the item above the floor. */
  baseY: number;
  /** Walk-over-able (rugs) or duck-under-able (wall-mounted). */
  passable: boolean;
}

export function resolveItems(layout: Layout, inventory: Map<string, InventoryItem>): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  for (const placed of layout.items) {
    const item = inventory.get(placed.itemId);
    if (!item) continue;
    const prior = priorFor(item.category);
    const s = placed.scale || 1;
    const size = v3(item.size.x * s, item.size.y * s, item.size.z * s);
    const baseY = placed.elevation;
    const topY = baseY + size.y;
    out.push({
      id: placed.itemId,
      placed,
      item,
      prior,
      size,
      baseY,
      topY,
      obb: { center: placed.position, size: v2(size.x, size.z), rotation: placed.rotation },
      passable: Boolean(prior.walkable) || baseY >= 1.85,
    });
  }
  return out;
}

/** Local +Y of the footprint is the item's "front". */
export function frontDirection(r: ResolvedItem): Vec2 {
  return v2(-Math.sin(r.placed.rotation), Math.cos(r.placed.rotation));
}

export function rightDirection(r: ResolvedItem): Vec2 {
  return v2(Math.cos(r.placed.rotation), Math.sin(r.placed.rotation));
}

/** The strip of floor you need in order to actually use the thing. */
export function accessZones(r: ResolvedItem): Obb[] {
  const clearance = r.prior.accessClearance;
  if (clearance <= 0.01 || r.prior.accessSide === 'none') return [];
  const f = frontDirection(r);
  const right = rightDirection(r);
  const zones: Obb[] = [];

  const strip = (dir: Vec2, alongHalf: number, depthOfItem: number, rotation: number) => ({
    center: v2(
      r.obb.center.x + dir.x * (depthOfItem / 2 + clearance / 2),
      r.obb.center.y + dir.y * (depthOfItem / 2 + clearance / 2),
    ),
    size: v2(alongHalf * 2, clearance),
    rotation,
  });

  const yaw = r.placed.rotation;
  switch (r.prior.accessSide) {
    case 'front':
      zones.push(strip(f, r.size.x / 2, r.size.z, yaw));
      break;
    case 'front-and-sides':
      zones.push(strip(f, r.size.x / 2, r.size.z, yaw));
      zones.push(strip(right, r.size.z / 2, r.size.x, yaw + Math.PI / 2));
      zones.push(strip(v2(-right.x, -right.y), r.size.z / 2, r.size.x, yaw + Math.PI / 2));
      break;
    case 'long-sides': {
      const longIsX = r.size.x >= r.size.z;
      const dir = longIsX ? f : right;
      const other = longIsX ? right : f;
      const alongHalf = longIsX ? r.size.x / 2 : r.size.z / 2;
      const depth = longIsX ? r.size.z : r.size.x;
      const rot = longIsX ? yaw : yaw + Math.PI / 2;
      zones.push(strip(dir, alongHalf, depth, rot));
      zones.push(strip(v2(-dir.x, -dir.y), alongHalf, depth, rot));
      void other;
      break;
    }
    case 'all':
      zones.push(strip(f, r.size.x / 2, r.size.z, yaw));
      zones.push(strip(v2(-f.x, -f.y), r.size.x / 2, r.size.z, yaw));
      zones.push(strip(right, r.size.z / 2, r.size.x, yaw + Math.PI / 2));
      zones.push(strip(v2(-right.x, -right.y), r.size.z / 2, r.size.x, yaw + Math.PI / 2));
      break;
  }
  return zones;
}

/** The floor a door leaf sweeps, or the pass-through zone for openings. */
export function doorZone(f: RoomFeature): Polygon {
  const facing = v2(Math.cos(f.facing), Math.sin(f.facing));
  const along = v2(-facing.y, facing.x);
  const hinge =
    f.swing === 'in-right' || f.swing === 'out-right'
      ? v2(f.position.x + along.x * (f.width / 2), f.position.y + along.y * (f.width / 2))
      : v2(f.position.x - along.x * (f.width / 2), f.position.y - along.y * (f.width / 2));

  if (f.kind === 'door' && f.swing && f.swing.startsWith('in')) {
    // The leaf starts closed, lying along the wall from the hinge to the far
    // jamb, and swings a quarter turn towards the room. Which way round that is
    // depends on the hinge side, and getting it backwards throws the arc out
    // through the wall.
    const closed = v2(f.position.x - hinge.x, f.position.y - hinge.y);
    const towardsRoom = Math.sign(closed.x * facing.y - closed.y * facing.x) || 1;
    const start = Math.atan2(closed.y, closed.x);
    return arcPolygon(hinge, f.width, start, start + towardsRoom * (Math.PI / 2), 12);
  }

  // Sliding doors, openings and out-swinging doors just need a landing area.
  const depth = 0.9;
  const box: Obb = {
    center: v2(f.position.x + facing.x * (depth / 2), f.position.y + facing.y * (depth / 2)),
    size: v2(f.width, depth),
    rotation: Math.atan2(facing.y, facing.x) - Math.PI / 2,
  };
  return obbToPolygon(box);
}

export function itemFootprintPolygon(r: ResolvedItem): Polygon {
  return obbCorners(r.obb);
}

export function roomArea(room: Room): number {
  const poly = room.footprint;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a) / 2;
}

/** Total footprint area occupied by non-walkable items. */
export function occupiedArea(items: ResolvedItem[]): number {
  return items.reduce((sum, r) => (r.passable ? sum : sum + r.size.x * r.size.z), 0);
}
