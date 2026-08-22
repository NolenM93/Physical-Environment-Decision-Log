/**
 * From "I like this layout" to "here is how to actually do it on Saturday".
 *
 * Two things make this more than a diff:
 *  - Ordering. If the dresser's destination is currently under the bookcase,
 *    you cannot start with the dresser. We resolve the dependency graph and,
 *    when it cycles, stage the lightest offender out of the way first.
 *  - Honest effort. Distance comes from an A* route around the furniture that
 *    is still in place, not a straight line through the sofa.
 */

import { type Vec2, dist2, v2, wrapAngle } from '../geometry/vec';
import { type Obb, obbOverlap, polygonCentroid } from '../geometry/shapes';
import { type Blocker, type OccupancyGrid, buildGrid, findPath } from './grid';
import { priorFor } from '../domain/catalog';
import type { InventoryItem, Layout, PlacedItem, Room, RoomFeature } from '../domain/types';

export type MoveKind = 'move' | 'rotate' | 'stage' | 'return' | 'introduce' | 'remove';

export interface MoveStep {
  order: number;
  itemId: string;
  label: string;
  kind: MoveKind;
  from?: Vec2;
  to?: Vec2;
  /** Signed yaw change in degrees. */
  rotationDeg: number;
  distanceM: number;
  minutes: number;
  people: number;
  massKg: number;
  path?: Vec2[];
  instruction: string;
  /** Set when the route is tighter than the item is wide. */
  tightSqueeze?: { routeWidthM: number; itemWidthM: number };
}

export interface MovePlan {
  steps: MoveStep[];
  totalMinutes: number;
  peopleNeeded: number;
  totalDistanceM: number;
  heaviestKg: number;
  warnings: string[];
  unchanged: number;
}

const SETUP_MINUTES: Record<string, number> = {
  light: 0.6,
  moderate: 2.0,
  heavy: 5.0,
  fixed: 25.0,
};

const MINUTES_PER_METRE: Record<string, number> = {
  light: 0.35,
  moderate: 0.9,
  heavy: 2.1,
  fixed: 6.0,
};

/** Shoulder-ish half-width for someone carrying one end of something. */
const CARRY_RADIUS = 0.3;

function peopleFor(massKg: number, movability: string): number {
  if (movability === 'fixed') return 2;
  if (massKg > 130) return 3;
  if (massKg > 55) return 2;
  return 1;
}

interface Change {
  itemId: string;
  item: InventoryItem;
  from?: PlacedItem;
  to?: PlacedItem;
  distance: number;
  rotationDeg: number;
}

export function diffLayouts(
  from: Layout,
  to: Layout,
  inventory: Map<string, InventoryItem>,
): { changes: Change[]; unchanged: number } {
  const fromMap = new Map(from.items.map((p) => [p.itemId, p]));
  const toMap = new Map(to.items.map((p) => [p.itemId, p]));
  const ids = new Set([...fromMap.keys(), ...toMap.keys()]);

  const changes: Change[] = [];
  let unchanged = 0;

  for (const id of ids) {
    const item = inventory.get(id);
    if (!item) continue;
    const a = fromMap.get(id);
    const b = toMap.get(id);
    const distance = a && b ? dist2(a.position, b.position) : 0;
    const rotationDeg = a && b ? (wrapAngle(b.rotation - a.rotation) * 180) / Math.PI : 0;
    if (a && b && distance < 0.03 && Math.abs(rotationDeg) < 2.5) {
      unchanged++;
      continue;
    }
    changes.push({ itemId: id, item, from: a, to: b, distance, rotationDeg });
  }

  return { changes, unchanged };
}

function obbFor(placed: PlacedItem, item: InventoryItem): Obb {
  const s = placed.scale || 1;
  return {
    center: placed.position,
    size: v2(item.size.x * s, item.size.z * s),
    rotation: placed.rotation,
  };
}

export interface MovePlanInput {
  room: Room;
  features: RoomFeature[];
  from: Layout;
  to: Layout;
  inventory: Map<string, InventoryItem>;
}

export function buildMovePlan(input: MovePlanInput): MovePlan {
  const { room, features, from, to, inventory } = input;
  const { changes, unchanged } = diffLayouts(from, to, inventory);
  const warnings: string[] = [];

  // Live map of where everything currently sits, mutated as we schedule steps.
  const current = new Map<string, PlacedItem>();
  for (const p of from.items) current.set(p.itemId, p);

  const pending = new Map(changes.map((c) => [c.itemId, c]));
  const steps: MoveStep[] = [];
  const staged = new Set<string>();
  let order = 0;

  const blockersOf = (change: Change): string[] => {
    if (!change.to) return [];
    // A rug goes under everything, so nothing standing on its destination stops
    // it from being laid. Treating those as blockers deadlocks the whole plan.
    if (priorFor(change.item.category).walkable) return [];
    const target = obbFor(change.to, change.item);
    const blocking: string[] = [];
    for (const [id, placed] of current) {
      if (id === change.itemId) continue;
      const other = inventory.get(id);
      if (!other) continue;
      if (priorFor(other.category).walkable) continue;
      const hit = obbOverlap(target, obbFor(placed, other));
      if (hit && hit.depth > 0.04) blocking.push(id);
    }
    return blocking;
  };

  const gridFor = (excludeIds: Set<string>): OccupancyGrid =>
    buildGrid(
      room.footprint,
      [...current.entries()]
        .filter(([id]) => !excludeIds.has(id))
        .map(([id, placed]) => {
          const item = inventory.get(id)!;
          return { obb: obbFor(placed, item), passable: Boolean(priorFor(item.category).walkable) };
        }),
    );

  /**
   * Somewhere to park a piece that is in the way.
   *
   * It has to be floor that is empty now *and* floor that nothing else is headed
   * for — park the armchair on the sofa's destination and you have simply moved
   * the deadlock rather than broken it. Near the door for preference, since that
   * is where things naturally get shoved.
   */
  const stagingSpot = (itemId: string, item: InventoryItem): Vec2 => {
    const door = features.find((f) => f.kind === 'door' || f.kind === 'opening');
    const preferred = door
      ? v2(door.position.x + Math.cos(door.facing) * 0.6, door.position.y + Math.sin(door.facing) * 0.6)
      : polygonCentroid(room.footprint);

    const reserved: Blocker[] = [];
    for (const c of pending.values()) {
      if (c.itemId === itemId || !c.to) continue;
      if (priorFor(c.item.category).walkable) continue;
      reserved.push({ obb: obbFor(c.to, c.item), passable: false });
    }

    const grid = buildGrid(room.footprint, [
      ...[...current.entries()]
        .filter(([id]) => id !== itemId)
        .map(([id, placed]) => {
          const other = inventory.get(id)!;
          return {
            obb: obbFor(placed, other),
            passable: Boolean(priorFor(other.category).walkable),
          };
        }),
      ...reserved,
    ]);
    const need = Math.hypot(item.size.x, item.size.z) / 2;

    let best: { p: Vec2; d: number } | null = null;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const i = r * grid.cols + c;
        if (grid.state[i] !== 1 || grid.clearance[i] < need) continue;
        const p = v2(grid.origin.x + (c + 0.5) * grid.cell, grid.origin.y + (r + 0.5) * grid.cell);
        const d = dist2(p, preferred);
        if (!best || d < best.d) best = { p, d };
      }
    }
    return best?.p ?? preferred;
  };

  const emit = (
    change: Change,
    kind: MoveKind,
    fromPos: Vec2 | undefined,
    toPos: Vec2 | undefined,
    rotationDeg: number,
  ) => {
    const item = change.item;
    const prior = priorFor(item.category);
    const movability = item.movability ?? prior.movability;

    let distance = fromPos && toPos ? dist2(fromPos, toPos) : 0;
    let path: Vec2[] | undefined;
    let tightSqueeze: MoveStep['tightSqueeze'];

    if (fromPos && toPos && distance > 0.05) {
      const grid = gridFor(new Set([change.itemId]));
      // Route for the people, not the object. Nobody walks a two-metre sofa
      // through the room flat-on: it goes on its end, and the question that
      // actually matters is whether the gap is tighter than it is thick, which
      // the squeeze check below answers separately.
      const route = findPath(grid, fromPos, toPos, CARRY_RADIUS);
      if (route) {
        distance = Math.max(distance, route.lengthM);
        path = route.points;
        const shortSide = Math.min(item.size.x, item.size.z);
        if (!prior.walkable && route.tightestM * 2 < shortSide) {
          tightSqueeze = { routeWidthM: route.tightestM * 2, itemWidthM: shortSide };
        }
      } else {
        warnings.push(
          `${item.label} has no clear route to its new spot — something else has to come out of the way first, or it goes out of the room and back in.`,
        );
      }
    }

    const setup = SETUP_MINUTES[movability] ?? 2;
    const perMetre = MINUTES_PER_METRE[movability] ?? 1;
    const rotationCost = (Math.abs(rotationDeg) / 90) * (movability === 'heavy' ? 1.4 : 0.4);
    const minutes = Math.round((setup + distance * perMetre + rotationCost) * 10) / 10;

    steps.push({
      order: ++order,
      itemId: change.itemId,
      label: item.label,
      kind,
      from: fromPos,
      to: toPos,
      rotationDeg: Math.round(rotationDeg),
      distanceM: Math.round(distance * 100) / 100,
      minutes,
      people: peopleFor(item.massKg, movability),
      massKg: item.massKg,
      path,
      instruction: instructionFor(change, kind, fromPos, toPos, rotationDeg, distance, room, features),
      tightSqueeze,
    });
  };

  // Remove departures first — they free the most space.
  for (const change of [...pending.values()]) {
    if (change.to) continue;
    emit(change, 'remove', change.from?.position, undefined, 0);
    current.delete(change.itemId);
    pending.delete(change.itemId);
  }

  // Then the floor coverings, which want to be down before anything stands on them.
  for (const change of [...pending.values()]) {
    if (!priorFor(change.item.category).walkable) continue;
    emit(change, change.from ? 'move' : 'introduce', change.from?.position, change.to!.position, change.rotationDeg);
    current.set(change.itemId, change.to!);
    pending.delete(change.itemId);
  }

  // Anything already staged comes back last: it was moved aside to clear the
  // way, so returning it the moment its own spot is free would just put it back
  // in front of whatever is still waiting.
  const everStaged = new Set<string>();
  let guard = 0;
  while (pending.size && guard++ < 200) {
    let progressed = false;
    const othersWaiting = [...pending.keys()].some((id) => !staged.has(id));

    for (const change of [...pending.values()]) {
      const returning = staged.has(change.itemId);
      if (returning && othersWaiting) continue;
      if (blockersOf(change).length) continue;
      const fromPos = change.from?.position;
      const toPos = change.to!.position;
      const kind: MoveKind = returning
        ? 'return'
        : change.from
          ? change.distance < 0.03
            ? 'rotate'
            : 'move'
          : 'introduce';
      emit(change, kind, fromPos, toPos, change.rotationDeg);
      current.set(change.itemId, change.to!);
      pending.delete(change.itemId);
      staged.delete(change.itemId);
      progressed = true;
    }

    if (progressed || !pending.size) continue;

    // Deadlock: everything left is blocked by something else that has to move.
    // Stage the lightest blocker out of the way and try again. Staging the same
    // piece twice would never converge, so each one gets a single turn.
    let lightest: { id: string; mass: number } | null = null;
    for (const change of pending.values()) {
      for (const blockerId of blockersOf(change)) {
        const item = inventory.get(blockerId);
        if (!item || everStaged.has(blockerId)) continue;
        if (!lightest || item.massKg < lightest.mass) lightest = { id: blockerId, mass: item.massKg };
      }
    }
    if (!lightest) break;
    everStaged.add(lightest.id);

    const item = inventory.get(lightest.id)!;
    const placed = current.get(lightest.id)!;
    const spot = stagingSpot(lightest.id, item);
    const stageChange: Change = {
      itemId: lightest.id,
      item,
      from: placed,
      to: pending.get(lightest.id)?.to,
      distance: dist2(placed.position, spot),
      rotationDeg: 0,
    };
    emit(stageChange, 'stage', placed.position, spot, 0);
    current.set(lightest.id, { ...placed, position: spot });
    staged.add(lightest.id);
    if (!pending.has(lightest.id)) {
      // It was not otherwise moving, so it has to come back afterwards.
      pending.set(lightest.id, {
        itemId: lightest.id,
        item,
        from: { ...placed, position: spot },
        to: placed,
        distance: dist2(spot, placed.position),
        rotationDeg: 0,
      });
    } else {
      const existing = pending.get(lightest.id)!;
      pending.set(lightest.id, { ...existing, from: { ...placed, position: spot } });
    }
  }

  // Whatever is left is genuinely circular. Place it anyway rather than ending
  // the plan with pieces parked in the doorway, and say so.
  if (pending.size) {
    const stuck = [...pending.values()];
    warnings.push(
      `${stuck.map((c) => c.item.label).join(', ')} ${stuck.length === 1 ? 'ends' : 'end'} up where something else still stands. Do ${stuck.length === 1 ? 'it' : 'them'} last, and expect to shuffle by hand.`,
    );
    for (const change of stuck) {
      emit(
        change,
        staged.has(change.itemId) ? 'return' : 'move',
        change.from?.position,
        change.to!.position,
        change.rotationDeg,
      );
      current.set(change.itemId, change.to!);
    }
  }

  const totalMinutes = Math.round(steps.reduce((s, x) => s + x.minutes, 0) * 10) / 10;
  const totalDistanceM = Math.round(steps.reduce((s, x) => s + x.distanceM, 0) * 10) / 10;
  const peopleNeeded = steps.reduce((m, s) => Math.max(m, s.people), 1);
  const heaviestKg = steps.reduce((m, s) => Math.max(m, s.massKg), 0);

  for (const step of steps) {
    if (step.tightSqueeze) {
      warnings.push(
        `${step.label} is ${(step.tightSqueeze.itemWidthM * 100).toFixed(0)} cm across but the clearest route narrows to ${(step.tightSqueeze.routeWidthM * 100).toFixed(0)} cm. Plan to turn it on edge.`,
      );
    }
  }

  return {
    steps,
    totalMinutes,
    peopleNeeded,
    totalDistanceM,
    heaviestKg,
    warnings: [...new Set(warnings)],
    unchanged,
  };
}

function instructionFor(
  change: Change,
  kind: MoveKind,
  fromPos: Vec2 | undefined,
  toPos: Vec2 | undefined,
  rotationDeg: number,
  distance: number,
  room: Room,
  features: RoomFeature[],
): string {
  const name = change.item.label;
  const rounded = Math.abs(Math.round(rotationDeg));
  const turn = rounded >= 3 ? ` and turn it ${rounded}° ${rotationDeg > 0 ? 'anticlockwise' : 'clockwise'}` : '';

  switch (kind) {
    case 'remove':
      return `Take the ${name.toLowerCase()} out of the room.`;
    case 'introduce':
      return `Bring the ${name.toLowerCase()} in and set it ${landmarkPhrase(toPos!, room, features)}.`;
    case 'stage':
      return `Shift the ${name.toLowerCase()} out of the way for now — park it ${landmarkPhrase(toPos!, room, features)}. It goes back at the end.`;
    case 'rotate':
      return `Leave the ${name.toLowerCase()} where it is${turn || ' and turn it to its new angle'}.`;
    case 'return':
      return `Bring the ${name.toLowerCase()} back, ${landmarkPhrase(toPos!, room, features)}${turn}.`;
    default:
      return `Move the ${name.toLowerCase()} ${distance.toFixed(2)} m, ${landmarkPhrase(toPos!, room, features)}${turn}.${
        fromPos ? '' : ''
      }`;
  }
}

/** Describe a plan position relative to the nearest named thing in the room. */
function landmarkPhrase(p: Vec2, room: Room, features: RoomFeature[]): string {
  let best: { label: string; d: number } | null = null;
  for (const f of features) {
    const label =
      f.label ??
      (f.kind === 'window'
        ? 'window'
        : f.kind === 'door'
          ? 'door'
          : f.kind === 'outlet'
            ? 'socket'
            : f.kind.replace(/_/g, ' '));
    const d = dist2(p, f.position);
    if (!best || d < best.d) best = { label, d };
  }

  const walls = wallNames(room);
  let bestWall: { label: string; d: number } | null = null;
  for (const w of walls) {
    const d = Math.abs((p.x - w.point.x) * w.normal.x + (p.y - w.point.y) * w.normal.y);
    if (!bestWall || d < bestWall.d) bestWall = { label: w.label, d };
  }

  if (best && best.d < 1.0) return `about ${best.d.toFixed(1)} m from the ${best.label}`;
  if (bestWall) return `${bestWall.d < 0.25 ? 'flush against' : `${bestWall.d.toFixed(1)} m off`} the ${bestWall.label}`;
  return 'in its new position';
}

function wallNames(room: Room): { label: string; point: Vec2; normal: Vec2 }[] {
  const compass = ['north', 'east', 'south', 'west'];
  const poly = room.footprint;
  const centroid = polygonCentroid(poly);
  const out: { label: string; point: Vec2; normal: Vec2 }[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
    const edge = v2(b.x - a.x, b.y - a.y);
    const len = Math.hypot(edge.x, edge.y) || 1;
    let normal = v2(-edge.y / len, edge.x / len);
    if ((mid.x - centroid.x) * normal.x + (mid.y - centroid.y) * normal.y < 0) {
      normal = v2(-normal.x, -normal.y);
    }
    // Bearing of the outward normal, offset by the room's north angle.
    const bearing = (Math.atan2(normal.x, normal.y) * 180) / Math.PI + room.northAngle;
    const index = Math.round(((bearing % 360) + 360) / 90) % 4;
    out.push({ label: `${compass[index]} wall`, point: mid, normal });
  }
  return out;
}
