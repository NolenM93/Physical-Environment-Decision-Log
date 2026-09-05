/**
 * Stanza's domain model.
 *
 * Two ideas shape it:
 *  - Inventory is separate from placement. You own a sofa; a *layout* is one
 *    opinion about where it goes. That separation is what lets the app compare
 *    arrangements and move things between rooms.
 *  - Layouts form a tree, and every branch can carry a decision entry. The
 *    history is the product, not a side effect.
 */

import type { Vec2, Vec3 } from '../geometry/vec';
import type { Calibration } from '../vision/calibration';

export type UnitSystem = 'metric' | 'imperial';

export type FurnitureCategory =
  | 'sofa'
  | 'sectional'
  | 'armchair'
  | 'ottoman'
  | 'coffee_table'
  | 'side_table'
  | 'console'
  | 'dining_table'
  | 'dining_chair'
  | 'desk'
  | 'office_chair'
  | 'bed'
  | 'nightstand'
  | 'dresser'
  | 'wardrobe'
  | 'bookshelf'
  | 'tv'
  | 'media_unit'
  | 'rug'
  | 'floor_lamp'
  | 'table_lamp'
  | 'plant'
  | 'piano'
  | 'exercise'
  | 'storage_bin'
  | 'refrigerator'
  | 'range'
  | 'dishwasher'
  | 'counter'
  | 'island'
  | 'washer_dryer'
  | 'crib'
  | 'round_table'
  | 'banquet_table'
  | 'chiavari'
  | 'dance_floor'
  | 'stage'
  | 'bar'
  | 'buffet'
  | 'cake_table'
  | 'gift_table'
  | 'lounge_set'
  | 'other';

export type RoomKind =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'dining'
  | 'office'
  | 'nursery'
  | 'bathroom'
  | 'hallway'
  | 'studio'
  | 'ballroom'
  | 'lawn'
  | 'terrace'
  | 'chapel'
  | 'other';

export type EventStatus = 'exploring' | 'proposed' | 'approved' | 'issued' | 'executed';
export type MealStyle = 'plated' | 'buffet' | 'stations' | 'cocktail' | 'ceremony' | 'other';
export type SetupKind =
  | 'ceremony'
  | 'cocktail'
  | 'reception'
  | 'dinner'
  | 'dance'
  | 'reset'
  | 'other';
export type StudioMode = 'sales' | 'ops';

/** How hard the thing is to shift, independent of mass. */
export type Movability = 'light' | 'moderate' | 'heavy' | 'fixed';

export interface InventoryItem {
  id: string;
  projectId: string;
  label: string;
  category: FurnitureCategory;
  /** width (x) x height (y) x depth (z) in metres, in the item's own frame. */
  size: Vec3;
  massKg: number;
  movability: Movability;
  /** Hex colour used for the procedural mesh and plan fill. */
  color: string;
  /** Where this item came from, if lifted out of a photo. */
  sourcePhotoId?: string;
  /** 0..1 — how sure we are about the measured size. */
  confidence: number;
  /** Requires a wall outlet within cord reach. */
  needsPower?: boolean;
  /** Length of its cable in metres, when it has one. */
  cordLength?: number;
  notes?: string;
  /** Free-form user annotations e.g. "wobbly leg, lift don't drag". */
  tags: string[];
  /**
   * House stock-keeping unit. Forty identical 60" rounds share a sku; a named
   * grand piano does not need one.
   */
  sku?: string;
  /** How many of this sku the house owns. Defaults to 1 for unique pieces. */
  quantityOnHand: number;
  /** Seated covers this piece provides, when it differs from the category prior. */
  covers?: number;
  createdAt: number;
}

export interface PlacedItem {
  itemId: string;
  /** Centre of the footprint in room plan coordinates, metres. */
  position: Vec2;
  /** Yaw about the vertical axis, radians, CCW in plan space. */
  rotation: number;
  /** Height of the item's base above the floor, metres (wall-mounted TVs etc). */
  elevation: number;
  /** Uniform scale correction the user applied after reconstruction. */
  scale: number;
  locked: boolean;
  /** Which room this placement belongs to, for multi-room projects. */
  roomId: string;
}

export type FeatureKind =
  | 'door'
  | 'sliding_door'
  | 'opening'
  | 'window'
  | 'outlet'
  | 'switch'
  | 'radiator'
  | 'vent'
  | 'fixed_obstruction'
  | 'tv_jack';

export interface RoomFeature {
  id: string;
  roomId: string;
  kind: FeatureKind;
  /** Anchor point on the plan, metres. Doors/windows sit on their wall. */
  position: Vec2;
  /** Width of the opening along the wall, metres. */
  width: number;
  /** Height above the floor of the feature's base, metres. */
  sillHeight: number;
  /** Height of the feature itself, metres. */
  height: number;
  /** Direction the feature faces (into the room), radians. */
  facing: number;
  /** Doors only: which way the leaf swings. */
  swing?: 'in-left' | 'in-right' | 'out-left' | 'out-right' | 'none';
  label?: string;
}

export interface Room {
  id: string;
  projectId: string;
  name: string;
  kind: RoomKind;
  /** Closed polygon in metres, CCW, origin arbitrary but shared per project. */
  footprint: Vec2[];
  ceilingHeight: number;
  /** Compass bearing of plan +Z in degrees (0 = plan +Z points true north). */
  northAngle: number;
  /** Offset of this room's plan origin within the project-wide floor plan. */
  planOrigin: Vec2;
  createdAt: number;
}

export interface Photo {
  id: string;
  roomId: string;
  projectId: string;
  /** Object URL is derived at runtime; the bytes live in IndexedDB. */
  blob: Blob;
  width: number;
  height: number;
  calibration?: Calibration;
  /** Pixel-space quad the user confirmed as visible floor, for reference. */
  floorQuad?: Vec2[];
  /** Assumed lens height above the floor when the shot was taken, metres. */
  cameraHeight: number;
  takenAt: number;
  label?: string;
}

export type Verdict = 'adopted' | 'rejected' | 'parked' | 'exploring' | 'implemented';

export interface BanquetEvent {
  id: string;
  projectId: string;
  roomId: string;
  name: string;
  clientName: string;
  dateISO: string;
  guestCount: number;
  mealStyle: MealStyle;
  status: EventStatus;
  /** Ordered layout ids: ceremony, cocktail, dinner… */
  setupIds: string[];
  issuedAt?: number;
  executedAt?: number;
  issuedMetrics?: LayoutMetricsSnapshot;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DecisionEntry {
  id: string;
  projectId: string;
  roomId: string;
  layoutId: string;
  /** The event this judgement belongs to, when it is a banquet decision. */
  eventId?: string;
  /** The layout it was weighed against, when the entry records a comparison. */
  comparedToLayoutId?: string;
  verdict: Verdict;
  title: string;
  rationale: string;
  pros: string[];
  cons: string[];
  tags: string[];
  /** Frozen metrics at the moment of the decision, so history stays honest. */
  metrics?: LayoutMetricsSnapshot;
  createdAt: number;
  /** Set when the user actually carried the arrangement out in the real world. */
  implementedAt?: number;
}

export interface LayoutMetricsSnapshot {
  score: number;
  circulationScore: number;
  clearanceViolations: number;
  collisions: number;
  reachableOutlets: number;
  totalOutletDemands: number;
  daylightCoverage: number;
  moveEffortMinutes: number;
  moveEffortPeople: number;
  usableFloorRatio: number;
  covers?: number;
  guestCount?: number;
  aisleM?: number;
}

export interface Layout {
  id: string;
  projectId: string;
  roomId: string;
  name: string;
  /** Layout this one was forked from — the decision log's edges. */
  parentId?: string;
  items: PlacedItem[];
  /** True for the arrangement that matches the physical room right now. */
  isCurrent: boolean;
  color: string;
  eventId?: string;
  setupKind?: SetupKind;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  unitSystem: UnitSystem;
  /** Used for the sun-path model. */
  latitude: number;
  longitude: number;
  /**
   * Minutes east of UTC at the room. The clock on the daylight slider is the
   * clock on the room's wall, which is not necessarily the one on the device
   * you are planning from.
   */
  utcOffsetMinutes: number;
  createdAt: number;
  updatedAt: number;
}

/** What an object detector hands back, before it is lifted into 3D. */
export interface Detection2D {
  id: string;
  label: string;
  category: FurnitureCategory;
  /** Normalised 0..1 box in image space. */
  box: { x: number; y: number; width: number; height: number };
  score: number;
  /** Optional dominant colour sampled from the crop. */
  color?: string;
  /** True when the detector thinks the base is cut off by the frame edge. */
  baseOccluded?: boolean;
}
