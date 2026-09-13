'use client';

/**
 * A typed-in rectangle becomes a project. Banquet rooms get empty setups and
 * house stock; living rooms get an empty layout and the household catalog.
 */

import { nanoid } from 'nanoid';
import { v2, v3 } from '../geometry/vec';
import { rectFootprint } from '../geometry/shapes';
import { estimateMass, priorFor } from '../domain/catalog';
import { deviceUtcOffsetMinutes } from '../constraints/solar';
import type {
  BanquetEvent,
  FurnitureCategory,
  InventoryItem,
  Layout,
  Project,
  Room,
  RoomFeature,
  RoomKind,
  UnitSystem,
} from '../domain/types';
import { db } from './index';

const DEG = Math.PI / 180;

export type RoomUse = 'banquet' | 'living';

export interface NewRoomInput {
  use: RoomUse;
  projectName: string;
  roomName: string;
  /** Metres. */
  width: number;
  /** Metres (plan depth). */
  depth: number;
  ceilingHeight: number;
  unitSystem: UnitSystem;
  guestCount?: number;
  eventName?: string;
  clientName?: string;
  dateISO?: string;
}

function stockItem(
  projectId: string,
  label: string,
  category: FurnitureCategory,
  size: [number, number, number],
  createdAt: number,
  extra: Partial<InventoryItem> = {},
): InventoryItem {
  const prior = priorFor(category);
  const sizeVec = v3(size[0], size[1], size[2]);
  return {
    id: nanoid(10),
    projectId,
    label,
    category,
    size: sizeVec,
    massKg: estimateMass(category, sizeVec),
    movability: prior.movability,
    color: prior.color,
    confidence: 1,
    needsPower: prior.needsPower,
    cordLength: prior.cordLength,
    tags: [],
    quantityOnHand: 1,
    createdAt,
    ...extra,
  };
}

function copies(
  count: number,
  make: (index: number) => InventoryItem,
): InventoryItem[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

function banquetStock(projectId: string, guestCount: number, now: number): InventoryItem[] {
  const rounds = Math.min(40, Math.max(8, Math.ceil(guestCount / 8) + 4));
  const highboys = Math.min(16, Math.max(4, Math.ceil(guestCount / 18)));
  const rows = Math.min(16, Math.max(6, Math.ceil(guestCount / 15)));
  return [
    ...copies(rounds, (i) =>
      stockItem(projectId, `60" round ${i + 1}`, 'round_table', [1.52, 0.75, 1.52], now, {
        sku: 'round-60',
        covers: 8,
        color: '#d7c6a6',
      }),
    ),
    ...copies(2, (i) =>
      stockItem(projectId, `Head table ${i + 1}`, 'banquet_table', [2.44, 0.75, 0.76], now, {
        sku: 'banquet-8',
        covers: 10,
        color: '#c4b089',
      }),
    ),
    ...copies(rows, (i) =>
      stockItem(projectId, `Theatre row ${i + 1}`, 'banquet_table', [6.4, 0.9, 0.48], now, {
        sku: 'theatre-row',
        covers: 15,
        color: '#cfc4ae',
      }),
    ),
    ...copies(highboys, (i) =>
      stockItem(projectId, `High-boy ${i + 1}`, 'round_table', [0.8, 1.1, 0.8], now, {
        sku: 'highboy',
        covers: 4,
        color: '#e2d3b6',
      }),
    ),
    stockItem(projectId, 'Lounge', 'lounge_set', [2.2, 0.78, 1.6], now, { sku: 'lounge', covers: 4 }),
    stockItem(projectId, 'Stage', 'stage', [4.88, 0.4, 2.44], now, { sku: 'stage-16x8' }),
    stockItem(projectId, 'Portable bar', 'bar', [2.4, 1.1, 0.7], now, { sku: 'bar-8' }),
    stockItem(projectId, 'Dance floor', 'dance_floor', [4.88, 0.04, 4.88], now, { sku: 'dance-16' }),
    stockItem(projectId, 'Cake table', 'cake_table', [0.9, 0.75, 0.9], now),
    stockItem(projectId, 'Gift table', 'gift_table', [1.5, 0.75, 0.6], now),
  ];
}

function guestDoors(roomId: string, width: number, depth: number): RoomFeature[] {
  const west = Math.max(1.6, Math.min(width * 0.28, width - 2));
  const east = Math.min(width - 1.6, Math.max(width * 0.72, 2));
  const service = Math.min(width - 1.2, Math.max(width * 0.82, 2));
  const door = (
    label: string,
    x: number,
    y: number,
    facing: number,
    extra: Partial<RoomFeature> = {},
  ): RoomFeature => ({
    id: nanoid(10),
    roomId,
    kind: 'door',
    position: v2(x, y),
    width: extra.width ?? 1.8,
    sillHeight: 0,
    height: 2.4,
    facing,
    swing: extra.swing ?? 'in-right',
    label,
    ...extra,
  });
  return [
    door('Guest doors west', west, 0, 90 * DEG, { swing: 'in-right' }),
    door('Guest doors east', east, 0, 90 * DEG, { swing: 'in-left' }),
    door('Service doors', service, depth, 270 * DEG, { width: 1.5, swing: 'in-left' }),
  ];
}

function emptyLayout(
  projectId: string,
  roomId: string,
  name: string,
  now: number,
  extra: Partial<Layout> = {},
): Layout {
  return {
    id: nanoid(10),
    projectId,
    roomId,
    name,
    items: [],
    isCurrent: extra.isCurrent ?? false,
    color: extra.color ?? '#8fa8c8',
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

export async function createCustomRoom(input: NewRoomInput): Promise<string> {
  const width = clampDim(input.width, 2, 80);
  const depth = clampDim(input.depth, 2, 80);
  const ceiling = clampDim(input.ceilingHeight, 2, 12);
  const now = Date.now();
  const projectId = nanoid(10);
  const roomId = nanoid(10);
  const kind: RoomKind = input.use === 'banquet' ? 'ballroom' : 'living';

  const project: Project = {
    id: projectId,
    name: input.projectName.trim() || input.roomName.trim() || 'Untitled room',
    unitSystem: input.unitSystem,
    latitude: 43.31,
    longitude: -73.64,
    utcOffsetMinutes: deviceUtcOffsetMinutes(),
    createdAt: now,
    updatedAt: now,
  };

  const room: Room = {
    id: roomId,
    projectId,
    name: input.roomName.trim() || (kind === 'ballroom' ? 'Ballroom' : 'Living room'),
    kind,
    footprint: rectFootprint(width, depth),
    ceilingHeight: ceiling,
    northAngle: 0,
    planOrigin: v2(0, 0),
    createdAt: now,
  };

  const d = db();

  if (input.use === 'banquet') {
    const guestCount = Math.max(1, Math.round(input.guestCount ?? 120));
    const items = banquetStock(projectId, guestCount, now);
    const eventId = nanoid(10);
    const ceremony = emptyLayout(projectId, roomId, 'Ceremony', now, {
      setupKind: 'ceremony',
      color: '#cfc4ae',
      eventId,
    });
    const reception = emptyLayout(projectId, roomId, 'Reception', now, {
      setupKind: 'reception',
      color: '#c2a06a',
      eventId,
    });
    const dinner = emptyLayout(projectId, roomId, 'Dinner', now, {
      setupKind: 'dinner',
      color: '#8fa8c8',
      isCurrent: true,
      eventId,
    });
    const event: BanquetEvent = {
      id: eventId,
      projectId,
      roomId,
      name: input.eventName?.trim() || 'New event',
      clientName: input.clientName?.trim() || '',
      dateISO: input.dateISO || new Date().toISOString().slice(0, 10),
      guestCount,
      mealStyle: 'plated',
      status: 'exploring',
      setupIds: [ceremony.id, reception.id, dinner.id],
      createdAt: now,
      updatedAt: now,
    };

    await d.transaction(
      'rw',
      [d.projects, d.rooms, d.items, d.features, d.layouts, d.events],
      async () => {
        await d.projects.put(project);
        await d.rooms.put(room);
        await d.items.bulkPut(items);
        await d.features.bulkPut(guestDoors(roomId, width, depth));
        await d.layouts.bulkPut([ceremony, reception, dinner]);
        await d.events.put(event);
      },
    );
    return projectId;
  }

  const layout = emptyLayout(projectId, roomId, 'First arrangement', now, {
    isCurrent: true,
  });
  const livingDoor: RoomFeature = {
    id: nanoid(10),
    roomId,
    kind: 'door',
    position: v2(Math.min(0.9, width / 2), 0),
    width: 0.82,
    sillHeight: 0,
    height: 2.04,
    facing: 90 * DEG,
    swing: 'in-right',
    label: 'Door',
  };

  await d.transaction('rw', [d.projects, d.rooms, d.features, d.layouts], async () => {
    await d.projects.put(project);
    await d.rooms.put(room);
    await d.features.put(livingDoor);
    await d.layouts.put(layout);
  });
  return projectId;
}

function clampDim(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
