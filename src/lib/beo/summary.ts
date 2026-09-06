/**
 * What a BEO needs from the floor: seats, aisle, stock, and the flip.
 */

import { evaluateLayout } from '../constraints/evaluate';
import { buildMovePlan, type MovePlan } from '../constraints/moveplan';
import { seatedCovers } from '../domain/catalog';
import type {
  BanquetEvent,
  BeoSlot,
  InventoryItem,
  Layout,
  Room,
  RoomFeature,
  SetupKind,
} from '../domain/types';
function asMap(items: InventoryItem[] | Map<string, InventoryItem>) {
  return items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
}

export const SETUP_LABEL: Record<SetupKind, string> = {
  ceremony: 'Ceremony',
  cocktail: 'Reception',
  reception: 'Reception',
  dinner: 'Dinner',
  dance: 'Dance',
  reset: 'House set',
  other: 'Setup',
};

export function slotFor(event: BanquetEvent, setupId: string): BeoSlot {
  return event.slots?.find((s) => s.setupId === setupId) ?? { setupId };
}

export function functionName(layout: Layout | undefined) {
  if (!layout) return 'Setup';
  if (layout.setupKind) return SETUP_LABEL[layout.setupKind];
  return layout.name.replace(/\s*\(rejected\)\s*$/i, '');
}

export function isStanding(kind: SetupKind | undefined) {
  return kind === 'reception' || kind === 'cocktail' || kind === 'dance';
}

export interface BeoFunctionRow {
  layout: Layout;
  slot: BeoSlot;
  covers: number;
  aisleM?: number;
  issues: number;
}

export function summarizeFunctions(
  event: BanquetEvent,
  layouts: Layout[],
  room: Room,
  features: RoomFeature[],
  inventory: Map<string, InventoryItem>,
): BeoFunctionRow[] {
  return event.setupIds
    .map((id) => layouts.find((l) => l.id === id))
    .filter((l): l is Layout => Boolean(l))
    .map((layout) => {
      const evaled = evaluateLayout({
        room,
        features,
        layout,
        inventory,
        latitude: 0,
        longitude: 0,
        guestCount: isStanding(layout.setupKind) ? undefined : event.guestCount,
      });
      return {
        layout,
        slot: slotFor(event, layout.id),
        covers: evaled.metrics.covers ?? seatedCovers(layout.items.map((p) => inventory.get(p.itemId)!).filter(Boolean)),
        aisleM: evaled.metrics.aisleM,
        issues: evaled.findings.filter((f) => f.severity === 'blocker' || f.severity === 'warning').length,
      };
    });
}

export interface StockLine {
  label: string;
  count: number;
}

export function stockOnFloor(layout: Layout, inventory: Map<string, InventoryItem>): StockLine[] {
  const map = new Map<string, StockLine>();
  for (const placed of layout.items) {
    const item = inventory.get(placed.itemId);
    if (!item) continue;
    const key = item.sku ?? item.label.replace(/\s+\d+$/, '');
    const label = item.label.replace(/\s+\d+$/, '');
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { label, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function flipsBetween(
  event: BanquetEvent,
  layouts: Layout[],
  room: Room,
  features: RoomFeature[],
  inventory: Map<string, InventoryItem>,
): { from: Layout; to: Layout; plan: MovePlan }[] {
  const index = asMap(inventory);
  const out: { from: Layout; to: Layout; plan: MovePlan }[] = [];
  for (let i = 1; i < event.setupIds.length; i++) {
    const from = layouts.find((l) => l.id === event.setupIds[i - 1]);
    const to = layouts.find((l) => l.id === event.setupIds[i]);
    if (!from || !to) continue;
    out.push({
      from,
      to,
      plan: buildMovePlan({ room, features, from, to, inventory: index }),
    });
  }
  return out;
}

export function formatBeoDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTimeRange(slot: BeoSlot) {
  if (slot.start && slot.end) return `${slot.start}–${slot.end}`;
  return slot.start ?? slot.end ?? '—';
}
