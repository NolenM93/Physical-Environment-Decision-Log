/**
 * Turning an arrangement into findings.
 *
 * Every rule here is one a person would actually apply while shoving a sofa
 * around: can I open the door, can I walk past, can I plug it in, can I get
 * out of bed on both sides, will the TV be a mirror at 4pm. Each finding
 * carries the number it is based on so the decision log records evidence
 * rather than vibes.
 */

import { type Vec2, clamp, dist2, v2 } from '../geometry/vec';
import {
  type Obb,
  clipPolygon,
  distanceToWalls,
  obbCorners,
  obbGap,
  obbOverlap,
  obbToPolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonPerimeterDistance,
} from '../geometry/shapes';
import {
  type ResolvedItem,
  accessZones,
  doorZone,
  frontDirection,
  occupiedArea,
  resolveItems,
} from '../domain/scene';
import type { InventoryItem, Layout, LayoutMetricsSnapshot, Room, RoomFeature } from '../domain/types';
import {
  type OccupancyGrid,
  buildGrid,
  clearanceAt,
  isReachable,
  reachableRegion,
  widestRoute,
} from './grid';
import { type SunPatch, computeSunPatches } from './solar';
import { seatedCovers } from '../domain/catalog';

export type Severity = 'blocker' | 'warning' | 'note';

export interface Finding {
  id: string;
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  itemIds: string[];
  featureIds: string[];
  /** The measurement the rule turned on, so the log can quote it later. */
  measured?: { value: number; target: number; unit: string; comparison: 'min' | 'max' };
  /** Plan-space marker for the UI to highlight. */
  at?: Vec2;
}

export interface EvaluationInput {
  room: Room;
  features: RoomFeature[];
  layout: Layout;
  inventory: Map<string, InventoryItem>;
  latitude: number;
  longitude: number;
  date?: Date;
  /** Shoulder width used for circulation, metres. */
  primaryCorridor?: number;
  secondaryCorridor?: number;
  /** When set, covers and fire-aisle rules treat this as a banquet setup. */
  guestCount?: number;
}

export interface Evaluation {
  findings: Finding[];
  metrics: LayoutMetricsSnapshot;
  resolved: ResolvedItem[];
  grid: OccupancyGrid;
  reachableMask: Uint8Array;
  reachableAreaM2: number;
  sunPatches: SunPatch[];
  /** Ergonomic readouts the UI surfaces even when nothing is wrong. */
  readouts: Readout[];
}

export interface Readout {
  label: string;
  value: string;
  hint?: string;
  tone: 'good' | 'fair' | 'poor' | 'neutral';
}

let uid = 0;
const nextId = () => `f${++uid}`;

const MIN_PRIMARY_CORRIDOR = 0.76; // a comfortable walking route
const MIN_SECONDARY_CORRIDOR = 0.55; // squeeze-past route
const BED_ACCESS = 0.6;
/** Banquet egress target. Not a legal certificate — a house rule of thumb. */
const BANQUET_FIRE_AISLE = 1.8;

export function evaluateLayout(input: EvaluationInput): Evaluation {
  const {
    room,
    features,
    layout,
    inventory,
    latitude,
    longitude,
    date = new Date(),
    primaryCorridor = MIN_PRIMARY_CORRIDOR,
    secondaryCorridor = MIN_SECONDARY_CORRIDOR,
    guestCount,
  } = input;

  const resolved = resolveItems(layout, inventory).filter((r) => r.placed.roomId === room.id);
  const findings: Finding[] = [];
  const roomPoly = room.footprint;

  const grid = buildGrid(
    roomPoly,
    resolved.map((r) => ({ obb: r.obb, passable: r.passable })),
  );

  // --- 1. Overlaps -------------------------------------------------------
  let collisions = 0;
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      // Things at different heights can share plan space quite happily.
      const verticalOverlap = Math.min(a.topY, b.topY) - Math.max(a.baseY, b.baseY);
      if (verticalOverlap <= 0.02) continue;
      if (a.prior.walkable || b.prior.walkable) continue;
      const hit = obbOverlap(a.obb, b.obb);
      if (!hit || hit.depth < 0.02) continue;
      collisions++;
      findings.push({
        id: nextId(),
        code: 'collision',
        severity: 'blocker',
        title: `${a.item.label} and ${b.item.label} overlap`,
        detail: `They interpenetrate by ${(hit.depth * 100).toFixed(0)} cm. Two solid objects cannot share the same floor.`,
        itemIds: [a.id, b.id],
        featureIds: [],
        measured: { value: hit.depth, target: 0, unit: 'm', comparison: 'max' },
        at: polygonCentroid([...obbCorners(a.obb), ...obbCorners(b.obb)]),
      });
    }
  }

  // --- 2. Inside the room ------------------------------------------------
  // Pushed flush to a wall, corners land exactly on the outline and round either
  // way, so anything under a plausible skirting board depth is not a finding.
  const WALL_TOLERANCE = 0.03;
  for (const r of resolved) {
    const corners = obbCorners(r.obb);
    const outside = corners.filter(
      (c) => !pointInPolygon(c, roomPoly) && polygonPerimeterDistance(c, roomPoly) > WALL_TOLERANCE,
    );
    if (outside.length === 0) continue;
    const worst = Math.max(...outside.map((c) => polygonPerimeterDistance(c, roomPoly)));
    findings.push({
      id: nextId(),
      code: 'out-of-room',
      severity: 'blocker',
      title: `${r.item.label} sticks through a wall`,
      detail: `${outside.length} of 4 corners fall outside the room outline, by up to ${(worst * 100).toFixed(0)} cm.`,
      itemIds: [r.id],
      featureIds: [],
      measured: { value: worst, target: 0, unit: 'm', comparison: 'max' },
      at: r.obb.center,
    });
  }

  // --- 3. Doors and openings --------------------------------------------
  const doors = features.filter(
    (f) => f.kind === 'door' || f.kind === 'sliding_door' || f.kind === 'opening',
  );
  for (const door of doors) {
    const zone = doorZone(door);
    const zoneArea = polygonArea(zone);
    for (const r of resolved) {
      if (r.passable) continue;
      if (r.baseY > door.sillHeight + door.height) continue;
      const overlap = clipPolygon(obbToPolygon(r.obb), zone);
      if (overlap.length < 3) continue;
      const area = polygonArea(overlap);
      if (area < 0.01) continue;
      const fraction = zoneArea > 0 ? area / zoneArea : 0;
      findings.push({
        id: nextId(),
        code: 'door-blocked',
        severity: fraction > 0.18 ? 'blocker' : 'warning',
        title: `${r.item.label} fouls the ${door.label ?? doorLabel(door)}`,
        detail:
          door.kind === 'door' && door.swing?.startsWith('in')
            ? `It sits in the door's swing arc, covering ${(fraction * 100).toFixed(0)}% of it. The door will hit it before it opens fully.`
            : `It intrudes ${(fraction * 100).toFixed(0)}% into the landing space you need to get through.`,
        itemIds: [r.id],
        featureIds: [door.id],
        measured: { value: fraction, target: 0, unit: 'fraction', comparison: 'max' },
        at: polygonCentroid(overlap),
      });
    }
  }

  // --- 4. Circulation ----------------------------------------------------
  const doorSeeds = doors.map((d) =>
    v2(d.position.x + Math.cos(d.facing) * 0.35, d.position.y + Math.sin(d.facing) * 0.35),
  );
  const seeds = doorSeeds.length ? doorSeeds : [polygonCentroid(roomPoly)];
  const primary = reachableRegion(grid, seeds, primaryCorridor / 2);
  const secondary = reachableRegion(grid, seeds, secondaryCorridor / 2);

  const freeArea = countFree(grid) * grid.cell * grid.cell;
  // Compare swept floor, not centre positions: the difference between the two
  // corridor widths is then the floor you can only reach by turning sideways.
  const marooned = secondary.sweptM2 - primary.sweptM2;
  if (freeArea > 0.5 && primary.sweptM2 / freeArea < 0.72 && marooned > 0.4) {
    findings.push({
      id: nextId(),
      code: 'pinch-point',
      severity: 'warning',
      title: 'Part of the room is only reachable sideways',
      detail: `${marooned.toFixed(1)} m² of floor can only be reached through a gap narrower than ${(primaryCorridor * 100).toFixed(0)} cm. You can squeeze through, but not carry anything.`,
      itemIds: [],
      featureIds: [],
      measured: {
        value: primary.sweptM2 / freeArea,
        target: 0.72,
        unit: 'fraction',
        comparison: 'min',
      },
    });
  }

  // Doors should connect to each other — that is the through-route. This has to
  // flood from one door alone: seeding from all of them at once puts every door
  // in the mask by construction, and the question would answer itself.
  if (doorSeeds.length >= 2) {
    const fromFirst = reachableRegion(grid, [doorSeeds[0]], secondaryCorridor / 2);
    for (let i = 1; i < doorSeeds.length; i++) {
      if (!isReachable(grid, fromFirst.mask, doorSeeds[i])) {
        findings.push({
          id: nextId(),
          code: 'route-severed',
          severity: 'blocker',
          title: 'You cannot walk between two of the doors',
          detail: `Nothing gets you from the ${doorLabel(doors[0])} to the ${doorLabel(doors[i])} without turning sideways — every route is under ${(secondaryCorridor * 100).toFixed(0)} cm at some point.`,
          itemIds: [],
          featureIds: [doors[0].id, doors[i].id],
          at: doorSeeds[i],
        });
      }
    }
  }

  // --- 5. Access clearance ----------------------------------------------
  let clearanceViolations = 0;
  for (const r of resolved) {
    const zones = accessZones(r);
    if (!zones.length) continue;
    const blocked: string[] = [];
    let worstFraction = 0;

    for (const zone of zones) {
      const zonePoly = obbToPolygon(zone);
      const zoneArea = polygonArea(zonePoly);
      if (zoneArea < 1e-4) continue;

      let obstructed = 0;
      for (const other of resolved) {
        if (other === r || other.passable) continue;
        const verticalOverlap = Math.min(other.topY, r.baseY + 1.2) - other.baseY;
        if (verticalOverlap <= 0.05) continue;
        const clip = clipPolygon(obbToPolygon(other.obb), zonePoly);
        if (clip.length >= 3) {
          obstructed += polygonArea(clip);
          if (!blocked.includes(other.item.label)) blocked.push(other.item.label);
        }
      }
      const outside = zoneArea - polygonArea(clipPolygon(zonePoly, roomPoly));
      obstructed += Math.max(0, outside);
      const fraction = clamp(obstructed / zoneArea, 0, 1);
      worstFraction = Math.max(worstFraction, fraction);
    }

    const allBlocked =
      r.prior.accessSide === 'long-sides' ? worstFraction > 0.85 : worstFraction > 0.45;
    if (allBlocked) {
      clearanceViolations++;
      findings.push({
        id: nextId(),
        code: 'access-blocked',
        severity: worstFraction > 0.8 ? 'blocker' : 'warning',
        title: `You cannot get at the ${r.item.label.toLowerCase()}`,
        detail: `${(worstFraction * 100).toFixed(0)}% of the ${(r.prior.accessClearance * 100).toFixed(0)} cm you need in front of it is taken up${blocked.length ? ` by the ${blocked.join(' and ')}` : ' by the wall'}.`,
        itemIds: [r.id, ...resolved.filter((o) => blocked.includes(o.item.label)).map((o) => o.id)],
        featureIds: [],
        measured: { value: 1 - worstFraction, target: 0.55, unit: 'fraction', comparison: 'min' },
        at: r.obb.center,
      });
    }
  }

  // --- 6. Beds want a way in on both sides ------------------------------
  for (const r of resolved) {
    if (r.item.category !== 'bed' && r.item.category !== 'crib') continue;
    const sides = bedAccessSides(r, resolved, roomPoly);
    if (sides.open === 0) {
      findings.push({
        id: nextId(),
        code: 'bed-access',
        severity: 'blocker',
        title: `No clear side to get into the ${r.item.label.toLowerCase()}`,
        detail: `Both long sides are within ${(BED_ACCESS * 100).toFixed(0)} cm of an obstruction. You would be climbing in over the foot.`,
        itemIds: [r.id],
        featureIds: [],
        at: r.obb.center,
      });
    } else if (sides.open === 1 && r.item.category === 'bed' && r.size.x > 1.2) {
      findings.push({
        id: nextId(),
        code: 'bed-access',
        severity: 'note',
        title: 'Double bed with one open side',
        detail: `Only ${sides.bestGap.toFixed(2)} m is clear on one side. Fine for one sleeper, awkward for two, and it makes changing the sheets a chore.`,
        itemIds: [r.id],
        featureIds: [],
        measured: { value: sides.open, target: 2, unit: 'sides', comparison: 'min' },
        at: r.obb.center,
      });
    }
  }

  // --- 7. Power -----------------------------------------------------------
  const outlets = features.filter((f) => f.kind === 'outlet');
  let reachableOutlets = 0;
  let totalOutletDemands = 0;
  for (const r of resolved) {
    const needsPower = r.item.needsPower ?? r.prior.needsPower;
    if (!needsPower) continue;
    totalOutletDemands++;
    const cord = r.item.cordLength ?? r.prior.cordLength ?? 1.8;
    let nearest = Infinity;
    let nearestId: string | undefined;
    for (const o of outlets) {
      const d = obbGap(r.obb, { center: o.position, size: v2(0.06, 0.06), rotation: 0 });
      if (d < nearest) {
        nearest = d;
        nearestId = o.id;
      }
    }
    if (!outlets.length) continue;
    if (nearest <= cord) {
      reachableOutlets++;
      continue;
    }
    findings.push({
      id: nextId(),
      code: 'no-power',
      severity: nearest > cord + 1.5 ? 'warning' : 'note',
      title: `${r.item.label} cannot reach an outlet`,
      detail: `The nearest socket is ${nearest.toFixed(2)} m away and its cable is ${cord.toFixed(2)} m. You would need an extension lead ${(nearest - cord).toFixed(2)} m long, run across the floor.`,
      itemIds: [r.id],
      featureIds: nearestId ? [nearestId] : [],
      measured: { value: cord, target: nearest, unit: 'm', comparison: 'min' },
      at: r.obb.center,
    });
  }

  // --- 8. Things that belong against a wall -----------------------------
  for (const r of resolved) {
    if (!r.prior.prefersWall || r.passable) continue;
    const gap = wallGap(r.obb, roomPoly);
    if (gap > 0.35) {
      findings.push({
        id: nextId(),
        code: 'floating',
        severity: 'note',
        title: `${r.item.label} is floating`,
        detail: `It sits ${gap.toFixed(2)} m off the nearest wall. Deliberate zoning or wasted floor — you decide, but note it.`,
        itemIds: [r.id],
        featureIds: [],
        measured: { value: gap, target: 0.35, unit: 'm', comparison: 'max' },
        at: r.obb.center,
      });
    }
  }

  // --- 9. Blocked windows, radiators and vents --------------------------
  for (const f of features) {
    if (f.kind !== 'window' && f.kind !== 'radiator' && f.kind !== 'vent') continue;
    const facing = v2(Math.cos(f.facing), Math.sin(f.facing));
    const zone: Obb = {
      center: v2(f.position.x + facing.x * 0.3, f.position.y + facing.y * 0.3),
      size: v2(f.width, 0.6),
      rotation: Math.atan2(facing.y, facing.x) - Math.PI / 2,
    };
    for (const r of resolved) {
      if (r.passable) continue;
      if (r.topY < f.sillHeight - 0.05) continue;
      const hit = obbOverlap(r.obb, zone);
      if (!hit) continue;
      const isWindow = f.kind === 'window';
      findings.push({
        id: nextId(),
        code: isWindow ? 'window-blocked' : 'heat-blocked',
        severity: 'note',
        title: isWindow
          ? `${r.item.label} covers part of a window`
          : `${r.item.label} blocks a ${f.kind}`,
        detail: isWindow
          ? `It stands ${r.topY.toFixed(2)} m tall in front of a sill at ${f.sillHeight.toFixed(2)} m, so it cuts into the daylight and the view.`
          : `Furniture in front of a ${f.kind} traps the airflow and wastes the heat.`,
        itemIds: [r.id],
        featureIds: [f.id],
        at: r.obb.center,
      });
    }
  }

  // --- 10. Screens: distance, angle and glare ---------------------------
  const screens = resolved.filter((r) => r.prior.isViewTarget);
  const seats = resolved.filter((r) => r.prior.isSeating);
  for (const screen of screens) {
    const diagonal = Math.hypot(screen.size.x, screen.size.y);
    const ideal = { min: diagonal * 1.4, max: diagonal * 2.6 };
    for (const seat of seats) {
      const d = dist2(screen.obb.center, seat.obb.center);
      if (d > 8) continue;
      const toSeat = v2(seat.obb.center.x - screen.obb.center.x, seat.obb.center.y - screen.obb.center.y);
      const normal = frontDirection(screen);
      const cos = (toSeat.x * normal.x + toSeat.y * normal.y) / (Math.hypot(toSeat.x, toSeat.y) || 1);
      const offAxis = Math.acos(clamp(cos, -1, 1)) * (180 / Math.PI);

      if (offAxis > 55) {
        findings.push({
          id: nextId(),
          code: 'screen-angle',
          severity: 'note',
          title: `${seat.item.label} views the ${screen.item.label.toLowerCase()} at ${offAxis.toFixed(0)}°`,
          detail: `Past about 40° off-axis the picture washes out and you end up craning. Rotate one of them, or accept that seat is not the viewing seat.`,
          itemIds: [seat.id, screen.id],
          featureIds: [],
          measured: { value: offAxis, target: 40, unit: '°', comparison: 'max' },
          at: seat.obb.center,
        });
      } else if (d < ideal.min) {
        findings.push({
          id: nextId(),
          code: 'screen-distance',
          severity: 'note',
          title: `${seat.item.label} is close to the ${screen.item.label.toLowerCase()}`,
          detail: `${d.toFixed(2)} m from a ${(diagonal * 39.37).toFixed(0)}" screen. Comfortable range is roughly ${ideal.min.toFixed(1)}–${ideal.max.toFixed(1)} m.`,
          itemIds: [seat.id, screen.id],
          featureIds: [],
          measured: { value: d, target: ideal.min, unit: 'm', comparison: 'min' },
          at: seat.obb.center,
        });
      } else if (d > ideal.max) {
        findings.push({
          id: nextId(),
          code: 'screen-distance',
          severity: 'note',
          title: `${seat.item.label} is a long way from the ${screen.item.label.toLowerCase()}`,
          detail: `${d.toFixed(2)} m from a ${(diagonal * 39.37).toFixed(0)}" screen, where about ${ideal.max.toFixed(1)} m is the far end of comfortable. Subtitles and small text will be a squint.`,
          itemIds: [seat.id, screen.id],
          featureIds: [],
          measured: { value: d, target: ideal.max, unit: 'm', comparison: 'max' },
          at: seat.obb.center,
        });
      }
    }

    // Glare: a window roughly opposite the screen throws reflections onto it.
    const normal = frontDirection(screen);
    for (const f of features) {
      if (f.kind !== 'window') continue;
      const toWindow = v2(f.position.x - screen.obb.center.x, f.position.y - screen.obb.center.y);
      const dd = Math.hypot(toWindow.x, toWindow.y) || 1;
      const cos = (toWindow.x * normal.x + toWindow.y * normal.y) / dd;
      if (cos > 0.55 && dd < 7) {
        findings.push({
          id: nextId(),
          code: 'glare',
          severity: 'note',
          title: `Window reflects in the ${screen.item.label.toLowerCase()}`,
          detail: `The window sits ${dd.toFixed(1)} m in front of the screen and within ${(Math.acos(cos) * (180 / Math.PI)).toFixed(0)}° of its normal. Expect a mirror in daylight.`,
          itemIds: [screen.id],
          featureIds: [f.id],
          at: screen.obb.center,
        });
      }
    }
  }

  // --- 11. Conversation distance ----------------------------------------
  if (seats.length >= 2) {
    const pairs: number[] = [];
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        pairs.push(dist2(seats[i].obb.center, seats[j].obb.center));
      }
    }
    const closest = Math.min(...pairs);
    if (closest > 3.6) {
      findings.push({
        id: nextId(),
        code: 'conversation',
        severity: 'note',
        title: 'Seating is spread too far for conversation',
        detail: `The closest two seats are ${closest.toFixed(2)} m apart. People stop talking comfortably past about 2.7 m and start raising their voices past 3.6 m.`,
        itemIds: seats.map((s) => s.id),
        featureIds: [],
        measured: { value: closest, target: 2.7, unit: 'm', comparison: 'max' },
      });
    }
  }

  // --- 12. Daylight -------------------------------------------------------
  const { patches: sunPatches } = computeSunPatches({
    room: roomPoly,
    features,
    latitude,
    longitude,
    northAngle: room.northAngle,
    date,
  });
  const litArea = sunPatches.reduce((s, p) => s + p.areaM2, 0);
  const roomAreaM2 = polygonArea(roomPoly);
  const daylightCoverage = roomAreaM2 > 0 ? clamp(litArea / roomAreaM2, 0, 1) : 0;

  // --- 13. Banquet covers and fire aisle --------------------------------
  const covers = seatedCovers(resolved.map((r) => r.item));
  const aisleM = tightestCorridor(grid, seeds, secondaryCorridor / 2);

  if (guestCount != null && guestCount > 0) {
    if (covers < guestCount) {
      findings.push({
        id: nextId(),
        code: 'covers-short',
        severity: 'blocker',
        title: `Only ${covers} covers for ${guestCount} guests`,
        detail: `The seated pieces in this setup add up to ${covers} places. The event is sold at ${guestCount}. Someone is standing, or the count is wrong.`,
        itemIds: resolved.filter((r) => seatedCovers([r.item]) > 0).map((r) => r.id),
        featureIds: [],
        measured: { value: covers, target: guestCount, unit: 'covers', comparison: 'min' },
      });
    } else if (covers > guestCount + 12) {
      findings.push({
        id: nextId(),
        code: 'covers-spare',
        severity: 'note',
        title: `${covers - guestCount} spare covers`,
        detail: `The room seats ${covers} against a guarantee of ${guestCount}. Extra tables eat floor and add to the flip.`,
        itemIds: [],
        featureIds: [],
        measured: { value: covers, target: guestCount, unit: 'covers', comparison: 'max' },
      });
    }

    if (aisleM > 0 && aisleM < BANQUET_FIRE_AISLE) {
      findings.push({
        id: nextId(),
        code: 'fire-aisle',
        severity: 'warning',
        title: `Aisle to an exit is ${(aisleM * 100).toFixed(0)} cm`,
        detail: `The tightest walk between openings is ${(aisleM * 100).toFixed(0)} cm. House rule of thumb for a banquet is ${BANQUET_FIRE_AISLE} m. This is not a fire-officer certificate.`,
        itemIds: [],
        featureIds: doors.map((d) => d.id),
        measured: { value: aisleM, target: BANQUET_FIRE_AISLE, unit: 'm', comparison: 'min' },
      });
    }
  }

  const egressKinds = new Set(['dance_floor', 'stage']);
  for (const door of doors) {
    const zone = doorZone(door);
    const zoneArea = polygonArea(zone);
    for (const r of resolved) {
      if (!egressKinds.has(r.item.category)) continue;
      const overlap = clipPolygon(obbToPolygon(r.obb), zone);
      if (overlap.length < 3) continue;
      const area = polygonArea(overlap);
      if (zoneArea <= 0 || area / zoneArea < 0.12) continue;
      findings.push({
        id: nextId(),
        code: 'egress-blocked',
        severity: 'warning',
        title: `${r.item.label} sits on ${doorLabel(door)}`,
        detail: `A ${r.item.category.replace(/_/g, ' ')} covers ${Math.round((area / zoneArea) * 100)}% of the swing or opening. Guests cannot use that exit as drawn.`,
        itemIds: [r.id],
        featureIds: [door.id],
        at: r.obb.center,
      });
    }
  }

  // --- Metrics ------------------------------------------------------------
  const blockers = findings.filter((f) => f.severity === 'blocker').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const notes = findings.filter((f) => f.severity === 'note').length;

  const usableFloorRatio = roomAreaM2 > 0 ? clamp(primary.sweptM2 / roomAreaM2, 0, 1) : 0;
  // What fraction of the floor that is not under furniture can you actually get
  // to at walking width. A well-arranged room is in the nineties.
  const circulationScore = clamp(
    100 * (freeArea > 0 ? primary.sweptM2 / Math.max(freeArea, 1e-6) : 0),
    0,
    100,
  );
  const occupied = occupiedArea(resolved);
  const density = roomAreaM2 > 0 ? occupied / roomAreaM2 : 0;

  const score = clamp(
    100 - blockers * 18 - warnings * 7 - notes * 2 + (circulationScore - 70) * 0.18 - Math.max(0, density - 0.55) * 60,
    0,
    100,
  );

  const effortSeed = resolved.reduce((s, r) => s + r.item.massKg, 0);

  const metrics: LayoutMetricsSnapshot = {
    score: Math.round(score),
    circulationScore: Math.round(circulationScore),
    clearanceViolations,
    collisions,
    reachableOutlets,
    totalOutletDemands,
    daylightCoverage: Math.round(daylightCoverage * 1000) / 1000,
    moveEffortMinutes: 0,
    moveEffortPeople: effortSeed > 320 ? 2 : 1,
    usableFloorRatio: Math.round(usableFloorRatio * 1000) / 1000,
    covers,
    guestCount,
    aisleM: Math.round(aisleM * 1000) / 1000,
  };

  const readouts = buildReadouts({
    roomAreaM2,
    primaryArea: primary.sweptM2,
    freeArea,
    density,
    daylightCoverage,
    litArea,
    reachableOutlets,
    totalOutletDemands,
    tightest: aisleM,
    covers,
    guestCount,
  });

  findings.sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || a.code.localeCompare(b.code),
  );

  return {
    findings,
    metrics,
    resolved,
    grid,
    reachableMask: primary.mask,
    reachableAreaM2: primary.sweptM2,
    sunPatches,
    readouts,
  };
}

function severityRank(s: Severity): number {
  return s === 'blocker' ? 3 : s === 'warning' ? 2 : 1;
}

function doorLabel(f: RoomFeature): string {
  if (f.label) return f.label;
  return f.kind === 'sliding_door' ? 'sliding door' : f.kind === 'opening' ? 'opening' : 'door';
}

function countFree(g: OccupancyGrid): number {
  let n = 0;
  for (let i = 0; i < g.state.length; i++) if (g.state[i] === 1) n++;
  return n;
}

function wallGap(obb: Obb, room: Vec2[]): number {
  let best = Infinity;
  for (const c of obbCorners(obb)) {
    best = Math.min(best, Math.abs(distanceToWalls(c, room)));
  }
  return best;
}

function bedAccessSides(
  bed: ResolvedItem,
  all: ResolvedItem[],
  room: Vec2[],
): { open: number; bestGap: number } {
  const longIsX = bed.size.x >= bed.size.z;
  const yaw = bed.placed.rotation;
  const dir = longIsX
    ? v2(-Math.sin(yaw), Math.cos(yaw))
    : v2(Math.cos(yaw), Math.sin(yaw));
  const depth = longIsX ? bed.size.z : bed.size.x;
  const alongHalf = (longIsX ? bed.size.x : bed.size.z) / 2;

  let open = 0;
  let bestGap = 0;
  for (const sign of [1, -1]) {
    const zone: Obb = {
      center: v2(
        bed.obb.center.x + dir.x * sign * (depth / 2 + BED_ACCESS / 2),
        bed.obb.center.y + dir.y * sign * (depth / 2 + BED_ACCESS / 2),
      ),
      size: v2(alongHalf * 2 * 0.7, BED_ACCESS),
      rotation: longIsX ? yaw : yaw + Math.PI / 2,
    };
    const inside = polygonArea(clipPolygon(obbToPolygon(zone), room)) / (alongHalf * 2 * 0.7 * BED_ACCESS);
    let blockedArea = 0;
    for (const other of all) {
      if (other === bed || other.passable) continue;
      if (other.topY < 0.25) continue;
      const clip = clipPolygon(obbToPolygon(other.obb), obbToPolygon(zone));
      if (clip.length >= 3) blockedArea += polygonArea(clip);
    }
    const zoneArea = alongHalf * 2 * 0.7 * BED_ACCESS;
    const clearFraction = clamp(inside - blockedArea / zoneArea, 0, 1);
    if (clearFraction > 0.6) open++;
    bestGap = Math.max(bestGap, clearFraction * BED_ACCESS);
  }
  return { open, bestGap };
}

/**
 * The width at the tightest point of the route you actually walk.
 *
 * Measuring the whole reachable network would be circular — the network is
 * defined as everywhere clearance exceeds half a body, so its minimum is always
 * exactly that threshold. The number worth reporting is the bottleneck on the
 * through-route between the openings, which is what you feel carrying a box.
 */
function tightestCorridor(g: OccupancyGrid, seeds: Vec2[], bodyRadius: number): number {
  if (seeds.length < 2) return 0;
  let worst = Infinity;
  let found = false;
  for (let i = 1; i < seeds.length; i++) {
    const width = widestRoute(g, seeds[0], seeds[i], bodyRadius, 0.55);
    if (width == null) continue;
    found = true;
    worst = Math.min(worst, width);
  }
  return found ? worst * 2 : 0;
}

function buildReadouts(args: {
  roomAreaM2: number;
  primaryArea: number;
  freeArea: number;
  density: number;
  daylightCoverage: number;
  litArea: number;
  reachableOutlets: number;
  totalOutletDemands: number;
  tightest: number;
  covers: number;
  guestCount?: number;
}): Readout[] {
  const {
    roomAreaM2,
    primaryArea,
    density,
    daylightCoverage,
    litArea,
    reachableOutlets,
    totalOutletDemands,
    tightest,
    covers,
    guestCount,
  } = args;

  if (guestCount != null && guestCount > 0) {
    const coverTone: Readout['tone'] =
      covers >= guestCount && covers <= guestCount + 12 ? 'good' : covers >= guestCount ? 'fair' : 'poor';
    const aisleTone: Readout['tone'] =
      tightest >= BANQUET_FIRE_AISLE ? 'good' : tightest >= 1.2 ? 'fair' : 'poor';
    const readouts: Readout[] = [
      {
        label: 'Covers',
        value: `${covers}/${guestCount}`,
        hint: 'Seated places against the event guarantee. Tables count at dinner; chairs count at ceremony. Reception is standing.',
        tone: coverTone,
      },
      {
        label: 'Fire aisle',
        value: tightest > 0 ? `${(tightest * 100).toFixed(0)} cm` : 'severed',
        hint: `Tightest walk between openings. House target ${BANQUET_FIRE_AISLE} m — not a legal cert.`,
        tone: tightest === 0 ? 'poor' : aisleTone,
      },
      {
        label: 'Floor density',
        value: `${(density * 100).toFixed(0)}%`,
        hint: 'Footprint over room area. Banquets run tighter than living rooms.',
        tone: density < 0.45 ? 'good' : density < 0.62 ? 'fair' : 'poor',
      },
    ];
    if (totalOutletDemands > 0) {
      readouts.push({
        label: 'Power',
        value: `${reachableOutlets}/${totalOutletDemands}`,
        hint: 'Bars, DJ and AV that can reach a socket.',
        tone: reachableOutlets === totalOutletDemands ? 'good' : 'fair',
      });
    }
    return readouts;
  }

  const readouts: Readout[] = [
    {
      label: 'Walkable floor',
      value: `${primaryArea.toFixed(1)} m²`,
      hint: `${((primaryArea / Math.max(roomAreaM2, 1e-6)) * 100).toFixed(0)}% of the room, at full walking width`,
      tone: primaryArea / Math.max(roomAreaM2, 1e-6) > 0.45 ? 'good' : primaryArea / Math.max(roomAreaM2, 1e-6) > 0.3 ? 'fair' : 'poor',
    },
    {
      label: 'Furniture density',
      value: `${(density * 100).toFixed(0)}%`,
      hint: 'Footprint area over room area. Above ~55% starts to feel cramped.',
      tone: density < 0.4 ? 'good' : density < 0.55 ? 'fair' : 'poor',
    },
    {
      label: 'Narrowest route',
      value: tightest > 0 ? `${(tightest * 100).toFixed(0)} cm` : '—',
      hint: 'The pinch point on the walk between the doors.',
      tone: tightest > 0.9 ? 'good' : tightest > 0.75 ? 'fair' : 'poor',
    },
    {
      label: 'Sunlit floor now',
      value: litArea > 0.01 ? `${litArea.toFixed(1)} m²` : 'none',
      hint: `${(daylightCoverage * 100).toFixed(0)}% of the floor at the selected time`,
      tone: 'neutral',
    },
  ];

  if (totalOutletDemands > 0) {
    readouts.push({
      label: 'Plugged in',
      value: `${reachableOutlets}/${totalOutletDemands}`,
      hint: 'Items that can reach a socket without an extension lead.',
      tone:
        reachableOutlets === totalOutletDemands
          ? 'good'
          : reachableOutlets >= totalOutletDemands - 1
            ? 'fair'
            : 'poor',
    });
  }

  return readouts;
}

/** Clearance sampled on a coarse lattice, for the heat overlay. */
export function clearanceField(
  grid: OccupancyGrid,
  step = 3,
): { points: Vec2[]; values: number[] } {
  const points: Vec2[] = [];
  const values: number[] = [];
  for (let r = 0; r < grid.rows; r += step) {
    for (let c = 0; c < grid.cols; c += step) {
      const i = r * grid.cols + c;
      if (grid.state[i] !== 1) continue;
      points.push(v2(grid.origin.x + (c + 0.5) * grid.cell, grid.origin.y + (r + 0.5) * grid.cell));
      values.push(grid.clearance[i]);
    }
  }
  return { points, values };
}

export { clearanceAt };
