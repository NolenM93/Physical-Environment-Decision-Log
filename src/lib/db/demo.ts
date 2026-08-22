/**
 * The worked example, as plain data.
 *
 * A 4.6 x 3.8 m living room with the awkward bits that actually make rearranging
 * hard: a door that swings in, one radiator wall, sockets on only two walls, and
 * a bay window that puts the afternoon sun straight into the TV.
 *
 * This module deliberately touches no storage, so the same content can be run
 * through the constraint engine outside the browser — see `scripts/check-demo.ts`,
 * which is what keeps the example from quietly rotting into a wall of blockers.
 */

import { nanoid } from 'nanoid';
import { v2, v3 } from '../geometry/vec';
import type {
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
const DAY = 1000 * 60 * 60 * 24;

export const DEMO_PROJECT_ID = 'demo-flat';
export const DEMO_ROOM_ID = 'demo-living';

export interface DemoContent {
  project: Project;
  room: Room;
  features: RoomFeature[];
  items: InventoryItem[];
  layouts: Layout[];
  decisions: DecisionEntry[];
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
    confidence: 0.82,
    needsPower: prior.needsPower,
    cordLength: prior.cordLength,
    tags: [],
    createdAt,
    ...overrides,
  };
}

export function buildDemoContent(now: number): DemoContent {
  const projectId = DEMO_PROJECT_ID;
  const roomId = DEMO_ROOM_ID;

  const project: Project = {
    id: projectId,
    name: 'Flat 3B',
    unitSystem: 'metric',
    latitude: 51.5072,
    longitude: -0.1276,
    utcOffsetMinutes: 60, // London, British Summer Time
    createdAt: now,
    updatedAt: now,
  };

  const room: Room = {
    id: roomId,
    projectId,
    name: 'Living room',
    kind: 'living',
    footprint: [v2(0, 0), v2(4.6, 0), v2(4.6, 3.8), v2(0, 3.8)],
    ceilingHeight: 2.45,
    northAngle: 200,
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
    width: 0.9,
    sillHeight: 0,
    height: 2.04,
    facing,
    ...extra,
  });

  const features: RoomFeature[] = [
    feature('door', [0.95, 0], 90 * DEG, { width: 0.82, swing: 'in-right', label: 'hall door' }),
    feature('opening', [4.6, 2.9], 180 * DEG, { width: 1.1, label: 'kitchen opening' }),
    feature('window', [2.6, 3.8], 270 * DEG, {
      width: 1.75,
      sillHeight: 0.62,
      height: 1.35,
      label: 'bay window',
    }),
    feature('radiator', [0.62, 3.8], 270 * DEG, { width: 1.0, sillHeight: 0.12, height: 0.6 }),
    feature('outlet', [0.06, 1.5], 0, { width: 0.08, sillHeight: 0.25, height: 0.12 }),
    feature('outlet', [3.4, 0.06], 90 * DEG, { width: 0.08, sillHeight: 0.25, height: 0.12 }),
    feature('outlet', [4.54, 1.2], 180 * DEG, { width: 0.08, sillHeight: 0.25, height: 0.12 }),
    feature('tv_jack', [4.54, 1.05], 180 * DEG, { width: 0.08, sillHeight: 0.3, height: 0.1 }),
  ];

  const items: InventoryItem[] = [
    makeItem(projectId, 'Grey three-seater', 'sofa', [2.08, 0.84, 0.92], now, {
      color: '#78849b',
      tags: ['heavy frame', 'feet scratch the floor'],
      notes: 'Came with the flat. The back is unfinished, so it needs to face a wall.',
    }),
    makeItem(projectId, 'Reading armchair', 'armchair', [0.82, 0.95, 0.86], now, {
      color: '#95707f',
    }),
    makeItem(projectId, 'Oak coffee table', 'coffee_table', [1.1, 0.41, 0.58], now, {
      color: '#a87c4e',
    }),
    makeItem(projectId, '55" TV', 'tv', [1.24, 0.72, 0.07], now, { color: '#1e2126' }),
    makeItem(projectId, 'Low media unit', 'media_unit', [1.6, 0.46, 0.4], now, { color: '#6b5f52' }),
    makeItem(projectId, 'Tall bookcase', 'bookshelf', [0.8, 1.92, 0.31], now, {
      color: '#8b6b48',
      massKg: 68,
      movability: 'heavy',
      notes: 'Must be emptied before moving. Two shelves are bowed.',
    }),
    makeItem(projectId, 'Wool rug', 'rug', [2.4, 0.02, 1.7], now, { color: '#b8a68d' }),
    makeItem(projectId, 'Arc floor lamp', 'floor_lamp', [0.45, 1.78, 0.45], now, {
      color: '#c9b78f',
    }),
    makeItem(projectId, 'Fiddle-leaf fig', 'plant', [0.7, 1.55, 0.7], now, { color: '#5f8a55' }),
    makeItem(projectId, 'Side table', 'side_table', [0.44, 0.55, 0.44], now, { color: '#9b7c56' }),
  ];

  const byLabel = (label: string) => items.find((i) => i.label === label)!.id;

  const place = (
    label: string,
    x: number,
    y: number,
    rotationDeg: number,
    extra: Partial<PlacedItem> = {},
  ): PlacedItem => ({
    itemId: byLabel(label),
    position: v2(x, y),
    rotation: rotationDeg * DEG,
    elevation: 0,
    scale: 1,
    locked: false,
    roomId,
    ...extra,
  });

  /**
   * How the removal firm left it. Everything works, but the room reads as a
   * corridor and the bay window is dead space.
   */
  const currentLayout: Layout = {
    id: nanoid(10),
    projectId,
    roomId,
    name: 'As it stands',
    items: [
      place('Grey three-seater', 0.5, 1.9, 270),
      place('Oak coffee table', 1.75, 2.0, 0),
      place('Wool rug', 1.9, 1.95, 0),
      place('Low media unit', 4.37, 1.5, 90),
      place('55" TV', 4.52, 1.5, 90, { elevation: 0.95 }),
      place('Tall bookcase', 4.0, 0.2, 0),
      place('Arc floor lamp', 1.42, 3.35, 0),
      place('Reading armchair', 2.6, 0.46, 0),
      place('Fiddle-leaf fig', 3.3, 2.65, 0),
      place('Side table', 3.35, 0.35, 0),
    ],
    isCurrent: true,
    color: '#8fa8c8',
    createdAt: now - DAY * 30,
    updatedAt: now - DAY * 30,
  };

  /** Sofa under the bay, facing back into the room. Lovely until three o'clock. */
  const windowLayout: Layout = {
    id: nanoid(10),
    projectId,
    roomId,
    name: 'Sofa to the window',
    parentId: currentLayout.id,
    items: [
      place('Grey three-seater', 2.6, 3.3, 180),
      place('Oak coffee table', 2.6, 2.15, 0),
      place('Wool rug', 2.6, 2.4, 0),
      place('Low media unit', 4.37, 1.5, 90),
      place('55" TV', 4.52, 1.5, 90, { elevation: 0.95 }),
      place('Tall bookcase', 0.2, 0.85, 270),
      place('Arc floor lamp', 0.3, 1.55, 0),
      place('Reading armchair', 1.15, 2.5, 145),
      place('Fiddle-leaf fig', 1.9, 0.45, 0),
      place('Side table', 1.75, 1.85, 0),
    ],
    isCurrent: false,
    color: '#c2a06a',
    createdAt: now - DAY * 9,
    updatedAt: now - DAY * 9,
  };

  /** Seats facing each other rather than facing the screen. */
  const conversationLayout: Layout = {
    id: nanoid(10),
    projectId,
    roomId,
    name: 'Conversation pit',
    parentId: currentLayout.id,
    items: [
      place('Grey three-seater', 2.6, 0.5, 0),
      place('Oak coffee table', 2.6, 1.5, 0),
      place('Wool rug', 2.6, 1.7, 0),
      place('Low media unit', 4.37, 1.5, 90),
      place('55" TV', 4.52, 1.5, 90, { elevation: 0.95 }),
      place('Tall bookcase', 0.2, 0.85, 270),
      place('Arc floor lamp', 3.45, 2.6, 0),
      place('Reading armchair', 2.6, 2.6, 180),
      place('Fiddle-leaf fig', 0.42, 2.6, 0),
      place('Side table', 1.55, 2.35, 0),
    ],
    isCurrent: false,
    color: '#7fae94',
    createdAt: now - DAY * 3,
    updatedAt: now - DAY * 3,
  };

  const decisions: DecisionEntry[] = [
    {
      id: nanoid(10),
      projectId,
      roomId,
      layoutId: currentLayout.id,
      verdict: 'implemented',
      title: 'Baseline, as we moved in',
      rationale:
        'How the removal firm left it. Nothing is actually wrong with it, which is why it survived a year — but the sofa is the whole length of the room away from the television, and the bay window does nothing at all.',
      pros: ['TV cable already on that wall', 'Nothing blocks the radiator', 'Clear walk from the hall to the kitchen'],
      cons: ['Four metres from a 55-inch screen', 'Dead space in the bay', 'Everyone sits along one wall'],
      tags: ['baseline'],
      createdAt: now - DAY * 30,
      implementedAt: now - DAY * 30,
    },
    {
      id: nanoid(10),
      projectId,
      roomId,
      layoutId: windowLayout.id,
      comparedToLayoutId: currentLayout.id,
      verdict: 'rejected',
      title: 'Tried facing the window',
      rationale:
        'Lovely in the morning and unusable after about three, when the sun comes over the sofa and turns the screen into a mirror. Sitting distance is right at last, and the walk through is the widest of the three, but the sofa back covers the bottom of the bay.',
      pros: ['Widest route through the room, 84 cm', 'Sitting distance finally sensible'],
      cons: ['Screen glare from 15:00', 'Sofa back covers the bay', 'The far corner is a squeeze'],
      tags: ['light', 'glare'],
      createdAt: now - DAY * 8,
    },
    {
      id: nanoid(10),
      projectId,
      roomId,
      layoutId: conversationLayout.id,
      comparedToLayoutId: currentLayout.id,
      verdict: 'exploring',
      title: 'Pull the chair off the wall',
      rationale:
        'Trying to make the room work for four people talking rather than two people watching. It does — but it costs the through-route, which drops to 60 cm past the coffee table, and half the floor becomes somewhere you only edge into.',
      pros: ['Seats face each other', 'Television still watchable from both'],
      cons: ['Route through narrows to 60 cm', 'Walkable floor down to 5.5 m²', 'An hour of work for two people'],
      tags: ['hosting'],
      createdAt: now - DAY * 2,
    },
  ];

  return {
    project,
    room,
    features,
    items,
    layouts: [currentLayout, windowLayout, conversationLayout],
    decisions,
  };
}
