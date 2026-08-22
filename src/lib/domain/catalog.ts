/**
 * Category priors.
 *
 * A single photo cannot tell you how deep a sofa is — the far side is hidden.
 * Rather than pretend, we lift what the image *can* support (floor position and
 * apparent width/height) and fill the missing depth from these priors, then
 * label the result as an estimate the user can correct.
 *
 * The same table drives ergonomics: what has to be reachable, what needs power,
 * what counts as a seat, and how painful the thing is to shove across a room.
 */

import type { FurnitureCategory, Movability, RoomKind } from './types';

export interface CategoryPrior {
  label: string;
  /** Typical width x height x depth, metres. */
  size: [number, number, number];
  /** Plausible bounds so reconstruction can reject nonsense. */
  widthRange: [number, number];
  heightRange: [number, number];
  /** Depth / width, used when the photo cannot see the far side. */
  depthRatio: number;
  /** kg per cubic metre of bounding volume — crude, but ranks things correctly. */
  densityKgM3: number;
  movability: Movability;
  color: string;
  /** Clearance needed in front of the item to actually use it, metres. */
  accessClearance: number;
  /** Which local face needs the clearance. */
  accessSide: 'front' | 'front-and-sides' | 'all' | 'long-sides' | 'none';
  needsPower?: boolean;
  cordLength?: number;
  /** People typically look at this (TVs, fireplaces). */
  isViewTarget?: boolean;
  /** People sit on it. */
  isSeating?: boolean;
  /** Belongs against a wall; free-floating placements get flagged. */
  prefersWall?: boolean;
  /** Cannot be moved without tools/plumbing. */
  fixture?: boolean;
  /** Sits flat on the floor and can be walked over. */
  walkable?: boolean;
  keywords: string[];
}

const P = (p: CategoryPrior) => p;

export const CATEGORY_PRIORS: Record<FurnitureCategory, CategoryPrior> = {
  sofa: P({
    label: 'Sofa',
    size: [2.05, 0.85, 0.92],
    widthRange: [1.4, 2.8],
    heightRange: [0.6, 1.05],
    depthRatio: 0.45,
    densityKgM3: 28,
    movability: 'heavy',
    color: '#7d8ba1',
    accessClearance: 0.75,
    accessSide: 'front',
    isSeating: true,
    prefersWall: true,
    keywords: ['couch', 'settee', 'loveseat'],
  }),
  sectional: P({
    label: 'Sectional',
    size: [2.6, 0.85, 1.7],
    widthRange: [2.0, 4.2],
    heightRange: [0.6, 1.05],
    depthRatio: 0.65,
    densityKgM3: 26,
    movability: 'heavy',
    color: '#6f7d92',
    accessClearance: 0.75,
    accessSide: 'front',
    isSeating: true,
    prefersWall: true,
    keywords: ['l-shaped couch', 'corner sofa'],
  }),
  armchair: P({
    label: 'Armchair',
    size: [0.85, 0.9, 0.88],
    widthRange: [0.55, 1.2],
    heightRange: [0.6, 1.15],
    depthRatio: 1.0,
    densityKgM3: 30,
    movability: 'moderate',
    color: '#8b7f9b',
    accessClearance: 0.6,
    accessSide: 'front',
    isSeating: true,
    keywords: ['accent chair', 'recliner', 'lounge chair'],
  }),
  ottoman: P({
    label: 'Ottoman',
    size: [0.65, 0.42, 0.55],
    widthRange: [0.35, 1.3],
    heightRange: [0.3, 0.55],
    depthRatio: 0.85,
    densityKgM3: 35,
    movability: 'light',
    color: '#9a8b7a',
    accessClearance: 0.35,
    accessSide: 'none',
    keywords: ['footstool', 'pouffe'],
  }),
  coffee_table: P({
    label: 'Coffee table',
    size: [1.15, 0.42, 0.6],
    widthRange: [0.6, 1.8],
    heightRange: [0.3, 0.55],
    depthRatio: 0.55,
    densityKgM3: 90,
    movability: 'moderate',
    color: '#9c7a52',
    accessClearance: 0.4,
    accessSide: 'all',
    keywords: ['centre table'],
  }),
  side_table: P({
    label: 'Side table',
    size: [0.48, 0.55, 0.48],
    widthRange: [0.28, 0.8],
    heightRange: [0.35, 0.8],
    depthRatio: 1.0,
    densityKgM3: 80,
    movability: 'light',
    color: '#a3835c',
    accessClearance: 0.3,
    accessSide: 'none',
    keywords: ['end table', 'accent table'],
  }),
  console: P({
    label: 'Console',
    size: [1.2, 0.78, 0.38],
    widthRange: [0.7, 2.0],
    heightRange: [0.6, 0.95],
    depthRatio: 0.3,
    densityKgM3: 110,
    movability: 'moderate',
    color: '#8e6f4d',
    accessClearance: 0.6,
    accessSide: 'front',
    prefersWall: true,
    keywords: ['hall table', 'sideboard'],
  }),
  dining_table: P({
    label: 'Dining table',
    size: [1.6, 0.75, 0.9],
    widthRange: [0.8, 3.0],
    heightRange: [0.68, 0.82],
    depthRatio: 0.6,
    densityKgM3: 100,
    movability: 'heavy',
    color: '#8a5f3b',
    accessClearance: 0.9,
    accessSide: 'all',
    keywords: ['kitchen table'],
  }),
  dining_chair: P({
    label: 'Dining chair',
    size: [0.46, 0.92, 0.5],
    widthRange: [0.35, 0.65],
    heightRange: [0.75, 1.15],
    depthRatio: 1.05,
    densityKgM3: 45,
    movability: 'light',
    color: '#7c6247',
    accessClearance: 0.75,
    accessSide: 'front',
    isSeating: true,
    keywords: ['chair'],
  }),
  desk: P({
    label: 'Desk',
    size: [1.35, 0.75, 0.68],
    widthRange: [0.8, 2.4],
    heightRange: [0.68, 0.82],
    depthRatio: 0.5,
    densityKgM3: 85,
    movability: 'heavy',
    color: '#7f6c55',
    accessClearance: 0.9,
    accessSide: 'front',
    prefersWall: true,
    needsPower: true,
    cordLength: 1.8,
    keywords: ['workstation', 'writing table'],
  }),
  office_chair: P({
    label: 'Office chair',
    size: [0.62, 1.1, 0.62],
    widthRange: [0.45, 0.8],
    heightRange: [0.85, 1.35],
    depthRatio: 1.0,
    densityKgM3: 40,
    movability: 'light',
    color: '#565b66',
    accessClearance: 0.6,
    accessSide: 'all',
    isSeating: true,
    keywords: ['task chair', 'swivel chair'],
  }),
  bed: P({
    label: 'Bed',
    size: [1.52, 0.6, 2.03],
    widthRange: [0.9, 2.1],
    heightRange: [0.35, 1.4],
    depthRatio: 1.35,
    densityKgM3: 40,
    movability: 'heavy',
    color: '#93a08d',
    accessClearance: 0.62,
    accessSide: 'long-sides',
    prefersWall: true,
    keywords: ['mattress', 'queen bed', 'king bed', 'double bed'],
  }),
  nightstand: P({
    label: 'Nightstand',
    size: [0.46, 0.6, 0.4],
    widthRange: [0.3, 0.75],
    heightRange: [0.4, 0.8],
    depthRatio: 0.85,
    densityKgM3: 120,
    movability: 'light',
    color: '#8d7455',
    accessClearance: 0.4,
    accessSide: 'front',
    prefersWall: true,
    needsPower: true,
    cordLength: 1.5,
    keywords: ['bedside table'],
  }),
  dresser: P({
    label: 'Dresser',
    size: [1.35, 0.85, 0.5],
    widthRange: [0.7, 2.0],
    heightRange: [0.6, 1.4],
    depthRatio: 0.38,
    densityKgM3: 150,
    movability: 'heavy',
    color: '#7a5f42',
    accessClearance: 0.85,
    accessSide: 'front',
    prefersWall: true,
    keywords: ['chest of drawers', 'drawers'],
  }),
  wardrobe: P({
    label: 'Wardrobe',
    size: [1.2, 2.0, 0.6],
    widthRange: [0.6, 2.6],
    heightRange: [1.5, 2.4],
    depthRatio: 0.5,
    densityKgM3: 130,
    movability: 'heavy',
    color: '#6d563c',
    accessClearance: 0.95,
    accessSide: 'front',
    prefersWall: true,
    keywords: ['closet', 'armoire'],
  }),
  bookshelf: P({
    label: 'Bookshelf',
    size: [0.9, 1.8, 0.32],
    widthRange: [0.4, 2.4],
    heightRange: [0.7, 2.4],
    depthRatio: 0.35,
    densityKgM3: 160,
    movability: 'heavy',
    color: '#8a6a48',
    accessClearance: 0.7,
    accessSide: 'front',
    prefersWall: true,
    keywords: ['shelf', 'shelving', 'bookcase'],
  }),
  tv: P({
    label: 'Television',
    size: [1.25, 0.72, 0.08],
    widthRange: [0.5, 2.2],
    heightRange: [0.3, 1.3],
    depthRatio: 0.07,
    densityKgM3: 400,
    movability: 'moderate',
    color: '#22262d',
    accessClearance: 0.0,
    accessSide: 'none',
    isViewTarget: true,
    prefersWall: true,
    needsPower: true,
    cordLength: 1.6,
    keywords: ['screen', 'monitor', 'flatscreen'],
  }),
  media_unit: P({
    label: 'Media unit',
    size: [1.5, 0.5, 0.42],
    widthRange: [0.7, 2.6],
    heightRange: [0.3, 0.9],
    depthRatio: 0.3,
    densityKgM3: 130,
    movability: 'heavy',
    color: '#6e6154',
    accessClearance: 0.6,
    accessSide: 'front',
    prefersWall: true,
    needsPower: true,
    cordLength: 1.6,
    keywords: ['tv stand', 'entertainment centre', 'credenza'],
  }),
  rug: P({
    label: 'Rug',
    size: [2.4, 0.02, 1.7],
    widthRange: [0.6, 4.5],
    heightRange: [0.005, 0.06],
    depthRatio: 0.7,
    densityKgM3: 600,
    movability: 'light',
    color: '#b9a48b',
    accessClearance: 0,
    accessSide: 'none',
    walkable: true,
    keywords: ['carpet', 'mat'],
  }),
  floor_lamp: P({
    label: 'Floor lamp',
    size: [0.4, 1.55, 0.4],
    widthRange: [0.2, 0.8],
    heightRange: [1.1, 2.0],
    depthRatio: 1.0,
    densityKgM3: 55,
    movability: 'light',
    color: '#c8b48d',
    accessClearance: 0.2,
    accessSide: 'none',
    needsPower: true,
    cordLength: 2.0,
    keywords: ['standing lamp', 'lamp'],
  }),
  table_lamp: P({
    label: 'Table lamp',
    size: [0.3, 0.5, 0.3],
    widthRange: [0.15, 0.6],
    heightRange: [0.25, 0.8],
    depthRatio: 1.0,
    densityKgM3: 60,
    movability: 'light',
    color: '#d3c19c',
    accessClearance: 0,
    accessSide: 'none',
    needsPower: true,
    cordLength: 1.8,
    keywords: ['desk lamp'],
  }),
  plant: P({
    label: 'Plant',
    size: [0.6, 1.2, 0.6],
    widthRange: [0.2, 1.4],
    heightRange: [0.25, 2.4],
    depthRatio: 1.0,
    densityKgM3: 90,
    movability: 'light',
    color: '#5f8a55',
    accessClearance: 0.15,
    accessSide: 'none',
    keywords: ['pot plant', 'houseplant', 'tree'],
  }),
  piano: P({
    label: 'Piano',
    size: [1.5, 1.25, 0.65],
    widthRange: [1.2, 2.6],
    heightRange: [0.9, 1.5],
    depthRatio: 0.45,
    densityKgM3: 220,
    movability: 'heavy',
    color: '#2c2b30',
    accessClearance: 0.9,
    accessSide: 'front',
    prefersWall: true,
    keywords: ['upright piano', 'keyboard'],
  }),
  exercise: P({
    label: 'Exercise equipment',
    size: [1.7, 1.4, 0.85],
    widthRange: [0.6, 2.4],
    heightRange: [0.3, 2.1],
    depthRatio: 0.55,
    densityKgM3: 90,
    movability: 'heavy',
    color: '#4d5560',
    accessClearance: 0.8,
    accessSide: 'front-and-sides',
    needsPower: true,
    cordLength: 2.0,
    keywords: ['treadmill', 'bike', 'rack'],
  }),
  storage_bin: P({
    label: 'Storage bin',
    size: [0.6, 0.45, 0.42],
    widthRange: [0.25, 1.2],
    heightRange: [0.2, 1.0],
    depthRatio: 0.75,
    densityKgM3: 120,
    movability: 'light',
    color: '#9a9a93',
    accessClearance: 0.4,
    accessSide: 'front',
    keywords: ['crate', 'basket', 'trunk'],
  }),
  refrigerator: P({
    label: 'Refrigerator',
    size: [0.75, 1.78, 0.72],
    widthRange: [0.5, 1.2],
    heightRange: [0.8, 2.1],
    depthRatio: 0.95,
    densityKgM3: 90,
    movability: 'heavy',
    color: '#b6bcc2',
    accessClearance: 1.05,
    accessSide: 'front',
    prefersWall: true,
    needsPower: true,
    cordLength: 1.2,
    keywords: ['fridge', 'freezer'],
  }),
  range: P({
    label: 'Range',
    size: [0.76, 0.92, 0.66],
    widthRange: [0.5, 1.2],
    heightRange: [0.8, 1.1],
    depthRatio: 0.87,
    densityKgM3: 130,
    movability: 'fixed',
    color: '#8e939a',
    accessClearance: 1.05,
    accessSide: 'front',
    prefersWall: true,
    fixture: true,
    needsPower: true,
    cordLength: 1.0,
    keywords: ['stove', 'oven', 'cooker'],
  }),
  dishwasher: P({
    label: 'Dishwasher',
    size: [0.6, 0.85, 0.6],
    widthRange: [0.45, 0.75],
    heightRange: [0.7, 0.95],
    depthRatio: 1.0,
    densityKgM3: 130,
    movability: 'fixed',
    color: '#a7adb4',
    accessClearance: 1.15,
    accessSide: 'front',
    prefersWall: true,
    fixture: true,
    keywords: [],
  }),
  counter: P({
    label: 'Counter',
    size: [2.4, 0.92, 0.63],
    widthRange: [0.5, 6.0],
    heightRange: [0.85, 1.05],
    depthRatio: 0.26,
    densityKgM3: 300,
    movability: 'fixed',
    color: '#c2b7a5',
    accessClearance: 1.0,
    accessSide: 'front',
    prefersWall: true,
    fixture: true,
    keywords: ['worktop', 'cabinets', 'benchtop'],
  }),
  island: P({
    label: 'Island',
    size: [1.8, 0.92, 0.95],
    widthRange: [0.9, 3.6],
    heightRange: [0.85, 1.1],
    depthRatio: 0.53,
    densityKgM3: 300,
    movability: 'fixed',
    color: '#bfae97',
    accessClearance: 1.0,
    accessSide: 'all',
    fixture: true,
    keywords: ['kitchen island', 'peninsula'],
  }),
  washer_dryer: P({
    label: 'Washer / dryer',
    size: [0.6, 0.85, 0.6],
    widthRange: [0.5, 0.8],
    heightRange: [0.7, 1.9],
    depthRatio: 1.0,
    densityKgM3: 190,
    movability: 'fixed',
    color: '#aeb5ba',
    accessClearance: 1.0,
    accessSide: 'front',
    prefersWall: true,
    fixture: true,
    needsPower: true,
    cordLength: 1.2,
    keywords: ['washing machine', 'tumble dryer'],
  }),
  crib: P({
    label: 'Crib',
    size: [0.72, 0.95, 1.32],
    widthRange: [0.6, 0.95],
    heightRange: [0.8, 1.2],
    depthRatio: 1.8,
    densityKgM3: 55,
    movability: 'moderate',
    color: '#cdbfae',
    accessClearance: 0.75,
    accessSide: 'long-sides',
    prefersWall: true,
    keywords: ['cot', 'bassinet'],
  }),
  other: P({
    label: 'Object',
    size: [0.6, 0.7, 0.6],
    widthRange: [0.1, 3.0],
    heightRange: [0.05, 2.4],
    depthRatio: 1.0,
    densityKgM3: 100,
    movability: 'moderate',
    color: '#9aa0a6',
    accessClearance: 0.4,
    accessSide: 'none',
    keywords: [],
  }),
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_PRIORS) as FurnitureCategory[];

/** Which categories are worth offering first, given the kind of room. */
export const ROOM_CATEGORY_HINTS: Record<RoomKind, FurnitureCategory[]> = {
  living: ['sofa', 'sectional', 'armchair', 'coffee_table', 'tv', 'media_unit', 'rug', 'floor_lamp', 'bookshelf', 'side_table', 'plant', 'ottoman'],
  bedroom: ['bed', 'nightstand', 'dresser', 'wardrobe', 'armchair', 'rug', 'floor_lamp', 'bookshelf', 'desk'],
  kitchen: ['counter', 'island', 'refrigerator', 'range', 'dishwasher', 'dining_table', 'dining_chair', 'storage_bin'],
  dining: ['dining_table', 'dining_chair', 'console', 'rug', 'bookshelf', 'plant'],
  office: ['desk', 'office_chair', 'bookshelf', 'armchair', 'floor_lamp', 'storage_bin', 'rug'],
  nursery: ['crib', 'dresser', 'armchair', 'rug', 'storage_bin', 'bookshelf'],
  bathroom: ['storage_bin', 'washer_dryer', 'other'],
  hallway: ['console', 'storage_bin', 'plant', 'bookshelf'],
  studio: ['bed', 'sofa', 'desk', 'dining_table', 'bookshelf', 'rug', 'tv', 'refrigerator'],
  other: CATEGORY_KEYS,
};

export function priorFor(category: FurnitureCategory): CategoryPrior {
  return CATEGORY_PRIORS[category] ?? CATEGORY_PRIORS.other;
}

/** Best-effort mapping from a free-text detector label to our taxonomy. */
export function categoryFromLabel(raw: string): FurnitureCategory {
  const text = raw.toLowerCase().trim();
  let best: FurnitureCategory = 'other';
  let bestScore = 0;
  for (const key of CATEGORY_KEYS) {
    const prior = CATEGORY_PRIORS[key];
    const candidates = [prior.label.toLowerCase(), key.replace(/_/g, ' '), ...prior.keywords];
    for (const c of candidates) {
      if (!c) continue;
      let score = 0;
      if (text === c) score = 100;
      else if (text.includes(c)) score = 50 + c.length;
      else if (c.includes(text) && text.length > 3) score = 30 + text.length;
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
  }
  return best;
}

export function estimateMass(category: FurnitureCategory, size: { x: number; y: number; z: number }): number {
  const prior = priorFor(category);
  const volume = Math.max(0.001, size.x * size.y * size.z);
  return Math.round(volume * prior.densityKgM3 * 10) / 10;
}

export function movabilityFromMass(massKg: number, fallback: Movability): Movability {
  if (fallback === 'fixed') return 'fixed';
  if (massKg > 55) return 'heavy';
  if (massKg > 18) return 'moderate';
  return 'light';
}
