/**
 * Harbor House — Ballroom A — Miller wedding.
 *
 * The banquet worked example: one property, one ballroom, three setups and a
 * rejected dinner. Built as plain data so `scripts/check-demo.ts` can prove
 * the issued dinner seats the guarantee, a route to an exit exists, and the
 * ceremony→dinner flip is finite.
 */

import { nanoid } from 'nanoid';
import { v2, v3 } from '../geometry/vec';
import type {
  BanquetEvent,
  DecisionEntry,
  InventoryItem,
  Layout,
  PlacedItem,
  Project,
  Room,
  RoomFeature,
} from '../domain/types';
import { estimateMass, priorFor } from '../domain/catalog';

const DEG = Math.PI / 180;

export const HARBOR_PROJECT_ID = 'harbor-house';
export const HARBOR_ROOM_ID = 'harbor-ballroom-a';
export const HARBOR_EVENT_ID = 'harbor-miller-wedding';
export const HARBOR_CEREMONY_ID = 'harbor-ceremony';
export const HARBOR_COCKTAIL_ID = 'harbor-cocktail';
export const HARBOR_DINNER_ID = 'harbor-dinner';
export const HARBOR_DINNER_LONGS_ID = 'harbor-dinner-longs';

export interface HarborContent {
  project: Project;
  room: Room;
  features: RoomFeature[];
  items: InventoryItem[];
  layouts: Layout[];
  decisions: DecisionEntry[];
  events: BanquetEvent[];
}

function makeItem(
  projectId: string,
  label: string,
  category: InventoryItem['category'],
  size: [number, number, number],
  createdAt: number,
  overrides: Partial<InventoryItem> = {},
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
    confidence: 0.9,
    needsPower: prior.needsPower,
    cordLength: prior.cordLength,
    tags: [],
    quantityOnHand: 1,
    createdAt,
    ...overrides,
  };
}

function place(item: InventoryItem, roomId: string, x: number, y: number, rotation = 0): PlacedItem {
  return {
    itemId: item.id,
    position: v2(x, y),
    rotation,
    elevation: 0,
    scale: 1,
    locked: false,
    roomId,
  };
}

/**
 * Issued dinner: 5×5 at 3.3 × 2.4 m. Dance takes the two south-centre cells,
 * stage takes the northwest, bar takes the northeast. 20 rounds × 8 plus
 * two 10-top longs = 180.
 */
const DINNER_ROUND_XY: [number, number][] = [
  [6.5, 2.4],
  [13.1, 2.4],
  [16.4, 2.4],
  [3.2, 4.8],
  [6.5, 4.8],
  [13.1, 4.8],
  [16.4, 4.8],
  [3.2, 7.2],
  [6.5, 7.2],
  [9.8, 7.2],
  [13.1, 7.2],
  [16.4, 7.2],
  [3.2, 9.6],
  [6.5, 9.6],
  [9.8, 9.6],
  [13.1, 9.6],
  [16.4, 9.6],
  [6.5, 12.0],
  [14.8, 12.0],
  [18.5, 5.0],
];

const TIGHT_ROUND_XY: [number, number][] = (() => {
  const xs = [2.1, 4.25, 6.4, 8.55, 10.7, 12.85];
  const ys = [1.55, 3.7, 5.85, 8.0];
  const out: [number, number][] = [];
  for (const y of ys) {
    for (const x of xs) out.push([x, y]);
  }
  return out.slice(0, 22);
})();

export function buildHarborContent(now: number): HarborContent {
  const projectId = HARBOR_PROJECT_ID;
  const roomId = HARBOR_ROOM_ID;

  const project: Project = {
    id: projectId,
    name: 'Harbor House',
    unitSystem: 'metric',
    latitude: 41.49,
    longitude: -71.31,
    utcOffsetMinutes: -240,
    createdAt: now,
    updatedAt: now,
  };

  const room: Room = {
    id: roomId,
    projectId,
    name: 'Ballroom A',
    kind: 'ballroom',
    footprint: [v2(0, 0), v2(20, 0), v2(20, 14), v2(0, 14)],
    ceilingHeight: 5.2,
    northAngle: 0,
    planOrigin: v2(0, 0),
    createdAt: now,
  };

  const feature = (
    kind: RoomFeature['kind'],
    position: [number, number],
    facing: number,
    extra: Partial<RoomFeature> = {},
  ): RoomFeature => ({
    id: nanoid(10),
    roomId,
    kind,
    position: v2(position[0], position[1]),
    width: 1.6,
    sillHeight: 0,
    height: 2.4,
    facing,
    ...extra,
  });

  const features: RoomFeature[] = [
    feature('door', [4.5, 0], 90 * DEG, { width: 1.8, swing: 'in-right', label: 'guest doors west' }),
    feature('door', [15.5, 0], 90 * DEG, { width: 1.8, swing: 'in-left', label: 'guest doors east' }),
    feature('door', [18.8, 14], 270 * DEG, { width: 1.5, swing: 'in-left', label: 'service doors' }),
    feature('window', [10, 0], 90 * DEG, { width: 4.2, sillHeight: 0.9, height: 2.4, label: 'harbour windows' }),
    feature('outlet', [19.9, 10.4], 180 * DEG, { width: 0.08, sillHeight: 0.3, height: 0.12 }),
    feature('outlet', [0.1, 12.4], 0, { width: 0.08, sillHeight: 0.3, height: 0.12 }),
    feature('outlet', [10, 13.9], 270 * DEG, { width: 0.08, sillHeight: 0.3, height: 0.12 }),
  ];

  const rounds = DINNER_ROUND_XY.map((_, i) =>
    makeItem(projectId, `60" round ${i + 1}`, 'round_table', [1.52, 0.75, 1.52], now, {
      sku: 'round-60',
      covers: 8,
      quantityOnHand: 1,
      color: '#d7c6a6',
    }),
  );
  const longs = [1, 2].map((n) =>
    makeItem(projectId, `Head table ${n}`, 'banquet_table', [2.44, 0.75, 0.76], now, {
      sku: 'banquet-8',
      covers: 10,
      color: '#c4b089',
    }),
  );
  const rows = Array.from({ length: 12 }, (_, i) =>
    makeItem(projectId, `Theatre row ${i + 1}`, 'banquet_table', [6.4, 0.9, 0.48], now, {
      sku: 'theatre-row',
      covers: 15,
      color: '#cfc4ae',
    }),
  );
  const highboys = Array.from({ length: 10 }, (_, i) =>
    makeItem(projectId, `High-boy ${i + 1}`, 'round_table', [0.8, 1.1, 0.8], now, {
      sku: 'highboy',
      covers: 4,
      color: '#e2d3b6',
    }),
  );
  const lounge = [
    makeItem(projectId, 'Lounge west', 'lounge_set', [2.2, 0.78, 1.6], now, { sku: 'lounge', covers: 4 }),
    makeItem(projectId, 'Lounge east', 'lounge_set', [2.2, 0.78, 1.6], now, { sku: 'lounge', covers: 4 }),
  ];
  const stage = makeItem(projectId, 'Stage', 'stage', [4.88, 0.4, 2.44], now, { sku: 'stage-16x8' });
  const bar = makeItem(projectId, 'Portable bar', 'bar', [2.4, 1.1, 0.7], now, { sku: 'bar-8' });
  const dance = makeItem(projectId, 'Dance floor', 'dance_floor', [4.88, 0.04, 4.88], now, {
    sku: 'dance-16',
  });
  const cake = makeItem(projectId, 'Cake table', 'cake_table', [0.9, 0.75, 0.9], now);
  const gift = makeItem(projectId, 'Gift table', 'gift_table', [1.5, 0.75, 0.6], now);

  const items: InventoryItem[] = [
    ...rounds,
    ...longs,
    ...rows,
    ...highboys,
    ...lounge,
    stage,
    bar,
    dance,
    cake,
    gift,
  ];

  const ceremonyItems: PlacedItem[] = [
    ...rows.map((row, i) => {
      const left = i < 6;
      const index = left ? i : i - 6;
      return place(row, roomId, left ? 5.1 : 14.9, 2.3 + index * 1.2);
    }),
    place(stage, roomId, 3.0, 12.3),
    place(gift, roomId, 1.2, 7),
  ];

  const cocktailItems: PlacedItem[] = [
    place(highboys[0], roomId, 4.2, 3.4),
    place(highboys[1], roomId, 7.6, 3.1),
    place(highboys[2], roomId, 11.2, 3.4),
    place(highboys[3], roomId, 15.0, 3.1),
    place(highboys[4], roomId, 5.4, 7.2),
    place(highboys[5], roomId, 9.4, 6.8),
    place(highboys[6], roomId, 13.6, 7.2),
    place(highboys[7], roomId, 17.2, 6.6),
    place(highboys[8], roomId, 7.2, 10.4),
    place(highboys[9], roomId, 12.4, 10.2),
    place(lounge[0], roomId, 3.4, 10.8, 20 * DEG),
    place(lounge[1], roomId, 16.6, 10.6, -20 * DEG),
    place(bar, roomId, 17.8, 12.2, 180 * DEG),
    place(stage, roomId, 3.0, 12.3),
    place(gift, roomId, 1.3, 4.2),
  ];

  const dinnerItems: PlacedItem[] = [
    ...rounds.map((item, i) => place(item, roomId, DINNER_ROUND_XY[i][0], DINNER_ROUND_XY[i][1])),
    place(longs[0], roomId, 9.0, 12.75),
    place(longs[1], roomId, 11.5, 12.75),
    place(dance, roomId, 10, 3.0),
    place(stage, roomId, 3.0, 12.3),
    place(bar, roomId, 17.8, 12.2, 180 * DEG),
    place(cake, roomId, 1.2, 7.2),
  ];

  const rejectedItems: PlacedItem[] = [
    ...rounds.map((item, i) => place(item, roomId, TIGHT_ROUND_XY[i][0], TIGHT_ROUND_XY[i][1])),
    place(longs[0], roomId, 15.4, 3.2, 90 * DEG),
    place(longs[1], roomId, 15.4, 5.8, 90 * DEG),
    place(dance, roomId, 17.4, 10.2),
    place(stage, roomId, 3.0, 12.3),
    place(bar, roomId, 17.8, 12.2, 180 * DEG),
  ];

  const layouts: Layout[] = [
    {
      id: HARBOR_CEREMONY_ID,
      projectId,
      roomId,
      name: 'Ceremony — theatre',
      items: ceremonyItems,
      isCurrent: false,
      color: '#8fa8c8',
      eventId: HARBOR_EVENT_ID,
      setupKind: 'ceremony',
      createdAt: now - 4 * 3600_000,
      updatedAt: now - 3 * 3600_000,
    },
    {
      id: HARBOR_COCKTAIL_ID,
      projectId,
      roomId,
      name: 'Reception — lounge',
      parentId: HARBOR_CEREMONY_ID,
      items: cocktailItems,
      isCurrent: false,
      color: '#7fae94',
      eventId: HARBOR_EVENT_ID,
      setupKind: 'reception',
      createdAt: now - 3 * 3600_000,
      updatedAt: now - 2 * 3600_000,
    },
    {
      id: HARBOR_DINNER_ID,
      projectId,
      roomId,
      name: 'Dinner — rounds',
      parentId: HARBOR_COCKTAIL_ID,
      items: dinnerItems,
      isCurrent: false,
      color: '#c2a06a',
      eventId: HARBOR_EVENT_ID,
      setupKind: 'dinner',
      createdAt: now - 2 * 3600_000,
      updatedAt: now - 30 * 60_000,
    },
    {
      id: HARBOR_DINNER_LONGS_ID,
      projectId,
      roomId,
      name: 'Dinner — longs (rejected)',
      parentId: HARBOR_DINNER_ID,
      items: rejectedItems,
      isCurrent: false,
      color: '#cf8f7a',
      eventId: HARBOR_EVENT_ID,
      setupKind: 'dinner',
      createdAt: now - 90 * 60_000,
      updatedAt: now - 80 * 60_000,
    },
  ];

  const banquetEvent: BanquetEvent = {
    id: HARBOR_EVENT_ID,
    projectId,
    roomId,
    name: 'Miller wedding',
    clientName: 'Alex & Jordan Miller',
    dateISO: '2026-10-18',
    guestCount: 180,
    mealStyle: 'plated',
    status: 'issued',
    setupIds: [HARBOR_CEREMONY_ID, HARBOR_COCKTAIL_ID, HARBOR_DINNER_ID],
    issuedAt: now - 25 * 60_000,
    notes: '180 plated. Ceremony, then reception, then dinner and dance.',
    createdAt: now - 5 * 3600_000,
    updatedAt: now - 25 * 60_000,
  };

  const decisions: DecisionEntry[] = [
    {
      id: nanoid(10),
      projectId,
      roomId,
      layoutId: HARBOR_DINNER_LONGS_ID,
      eventId: HARBOR_EVENT_ID,
      comparedToLayoutId: HARBOR_DINNER_ID,
      verdict: 'rejected',
      title: 'Longs lose the aisle',
      rationale:
        'Couple asked for longs instead of rounds — more formal, they said. Packed eight-tops down the room to keep the dance floor. The walk to the east guest doors dropped well under the house 1.8 m aisle. We cannot issue this. They took the rounds.',
      pros: ['Head-table look the couple wanted', 'Dance floor stays'],
      cons: ['Aisle to the east exits is too tight', 'Service cannot cross during dinner'],
      tags: ['aisle', 'rejected'],
      createdAt: now - 70 * 60_000,
    },
    {
      id: nanoid(10),
      projectId,
      roomId,
      layoutId: HARBOR_DINNER_ID,
      eventId: HARBOR_EVENT_ID,
      comparedToLayoutId: HARBOR_DINNER_LONGS_ID,
      verdict: 'adopted',
      title: 'Issued to ops — Miller wedding',
      rationale:
        'Locked for Alex & Jordan Miller, 180 guests on 2026-10-18. Twenty-two 60" rounds plus two longs at the head. This is the sheet the crew works from.',
      pros: ['Seats the guarantee', 'Aisle to both guest doors and the service doors'],
      cons: ['More tables to flip than the longs would have been'],
      tags: ['issued', 'beo'],
      createdAt: now - 25 * 60_000,
    },
  ];

  return {
    project,
    room,
    features,
    items,
    layouts,
    decisions,
    events: [banquetEvent],
  };
}
