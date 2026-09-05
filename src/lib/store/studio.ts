'use client';

/**
 * The studio store.
 *
 * Undo history deliberately covers only `layoutItems` — the arrangement — and
 * not the surrounding chrome. Undoing should put the sofa back, never reopen a
 * panel or reload a project.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { nanoid } from 'nanoid';
import { type Vec2, v2, wrapAngle } from '../geometry/vec';
import type {
  BanquetEvent,
  DecisionEntry,
  InventoryItem,
  Layout,
  LayoutMetricsSnapshot,
  PlacedItem,
  Project,
  Room,
  RoomFeature,
  StudioMode,
  Verdict,
} from '../domain/types';
import { db } from '../db';

export type ViewMode = 'perspective' | 'plan' | 'photo';

export interface Overlays {
  clearance: boolean;
  circulation: boolean;
  doorSwings: boolean;
  sunlight: boolean;
  measurements: boolean;
  ghost: boolean;
  grid: boolean;
  findings: boolean;
}

interface StudioState {
  ready: boolean;
  projectId: string | null;
  project: Project | null;
  rooms: Room[];
  roomId: string | null;
  features: RoomFeature[];
  inventory: InventoryItem[];
  layouts: Layout[];
  layoutId: string | null;
  /** The live arrangement being edited. Undo history tracks exactly this. */
  layoutItems: PlacedItem[];
  decisions: DecisionEntry[];
  events: BanquetEvent[];
  eventId: string | null;
  studioMode: StudioMode;

  selection: string[];
  hovered: string | null;
  view: ViewMode;
  overlays: Overlays;
  /** Hour of day, fractional, for the sun model. */
  timeOfDay: number;
  dateISO: string;
  compareLayoutId: string | null;
  snapEnabled: boolean;
  snapAngleDeg: number;
  gridSnapM: number;
  dirty: boolean;

  loadProject: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
  selectRoom: (roomId: string) => Promise<void>;
  selectLayout: (layoutId: string) => void;

  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  setHovered: (id: string | null) => void;

  moveItem: (itemId: string, position: Vec2) => void;
  nudgeSelection: (delta: Vec2) => void;
  rotateItem: (itemId: string, rotation: number) => void;
  rotateSelection: (deltaRad: number) => void;
  scaleItem: (itemId: string, scale: number) => void;
  setElevation: (itemId: string, elevation: number) => void;
  toggleLock: (itemId: string) => void;
  removeFromLayout: (itemId: string) => void;
  placeInLayout: (itemId: string, position: Vec2) => void;
  replaceItems: (items: PlacedItem[]) => void;

  addInventoryItem: (item: InventoryItem) => Promise<void>;
  updateInventoryItem: (id: string, patch: Partial<InventoryItem>) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;

  addFeature: (feature: RoomFeature) => Promise<void>;
  updateFeature: (id: string, patch: Partial<RoomFeature>) => Promise<void>;
  deleteFeature: (id: string) => Promise<void>;

  createRoom: (room: Room) => Promise<void>;
  updateRoom: (id: string, patch: Partial<Room>) => Promise<void>;
  updateProject: (patch: Partial<Project>) => Promise<void>;

  forkLayout: (name: string) => Promise<string | null>;
  renameLayout: (id: string, name: string) => Promise<void>;
  deleteLayout: (id: string) => Promise<void>;
  markCurrent: (id: string) => Promise<void>;
  saveNow: () => Promise<void>;

  addDecision: (entry: Omit<DecisionEntry, 'id' | 'createdAt'>) => Promise<void>;
  updateDecision: (id: string, patch: Partial<DecisionEntry>) => Promise<void>;
  deleteDecision: (id: string) => Promise<void>;
  setVerdict: (id: string, verdict: Verdict) => Promise<void>;

  setView: (view: ViewMode) => void;
  toggleOverlay: (key: keyof Overlays) => void;
  setTimeOfDay: (hour: number) => void;
  setDateISO: (iso: string) => void;
  setCompare: (layoutId: string | null) => void;
  setSnapEnabled: (on: boolean) => void;
  setStudioMode: (mode: StudioMode) => void;
  selectEvent: (eventId: string) => void;
  updateEvent: (id: string, patch: Partial<BanquetEvent>) => Promise<void>;
  issueEvent: (metrics?: LayoutMetricsSnapshot) => Promise<void>;
  executeEvent: () => Promise<void>;
}

const DEFAULT_OVERLAYS: Overlays = {
  clearance: false,
  circulation: true,
  doorSwings: true,
  sunlight: false,
  measurements: true,
  ghost: false,
  grid: true,
  findings: true,
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudio = create<StudioState>()(
  temporal(
    (set, get) => {
      const scheduleSave = () => {
        set({ dirty: true });
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          void get().saveNow();
        }, 450);
      };

      const mutateItems = (fn: (items: PlacedItem[]) => PlacedItem[]) => {
        set((state) => ({ layoutItems: fn(state.layoutItems) }));
        scheduleSave();
      };

      return {
        ready: false,
        projectId: null,
        project: null,
        rooms: [],
        roomId: null,
        features: [],
        inventory: [],
        layouts: [],
        layoutId: null,
        layoutItems: [],
        decisions: [],
        events: [],
        eventId: null,
        studioMode: 'sales',

        selection: [],
        hovered: null,
        view: 'perspective',
        overlays: DEFAULT_OVERLAYS,
        timeOfDay: 15.5,
        dateISO: new Date().toISOString().slice(0, 10),
        compareLayoutId: null,
        snapEnabled: true,
        snapAngleDeg: 15,
        gridSnapM: 0.05,
        dirty: false,

        async loadProject(projectId) {
          const d = db();
          const [project, rooms, inventory, layouts, decisions, events] = await Promise.all([
            d.projects.get(projectId),
            d.rooms.where('projectId').equals(projectId).toArray(),
            d.items.where('projectId').equals(projectId).toArray(),
            d.layouts.where('projectId').equals(projectId).toArray(),
            d.decisions.where('projectId').equals(projectId).toArray(),
            d.events.where('projectId').equals(projectId).toArray(),
          ]);
          if (!project) {
            set({ ready: true, projectId: null, project: null });
            return;
          }
          const room = rooms[0] ?? null;
          const features = room
            ? await d.features.where('roomId').equals(room.id).toArray()
            : [];
          const event = events[0] ?? null;
          const roomLayouts = layouts.filter((l) => !room || l.roomId === room.id);
          const fromEvent = event
            ? [...event.setupIds]
                .reverse()
                .map((id) => layouts.find((l) => l.id === id))
                .find(Boolean)
            : null;
          const active =
            fromEvent ??
            roomLayouts.find((l) => l.isCurrent) ??
            [...roomLayouts].sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
            null;
          const banquet = Boolean(event);

          set({
            ready: true,
            projectId,
            project,
            rooms,
            roomId: room?.id ?? null,
            features,
            inventory,
            layouts,
            decisions,
            events,
            eventId: event?.id ?? null,
            studioMode: 'sales',
            view: banquet ? 'plan' : 'perspective',
            overlays: banquet
              ? {
                  clearance: false,
                  circulation: false,
                  doorSwings: true,
                  sunlight: false,
                  measurements: false,
                  ghost: false,
                  grid: false,
                  findings: false,
                }
              : get().overlays,
            dateISO: event?.dateISO ?? get().dateISO,
            layoutId: active?.id ?? null,
            layoutItems: active ? active.items.map((i) => ({ ...i })) : [],
            selection: [],
            dirty: false,
          });
          useStudio.temporal.getState().clear();
        },

        async refresh() {
          const id = get().projectId;
          if (id) await get().loadProject(id);
        },

        async selectRoom(roomId) {
          const d = db();
          const features = await d.features.where('roomId').equals(roomId).toArray();
          const layouts = get().layouts.filter((l) => l.roomId === roomId);
          const active = layouts.find((l) => l.isCurrent) ?? layouts[0] ?? null;
          set({
            roomId,
            features,
            layoutId: active?.id ?? null,
            layoutItems: active ? active.items.map((i) => ({ ...i })) : [],
            selection: [],
            compareLayoutId: null,
          });
          useStudio.temporal.getState().clear();
        },

        selectLayout(layoutId) {
          const layout = get().layouts.find((l) => l.id === layoutId);
          if (!layout) return;
          set({
            layoutId,
            layoutItems: layout.items.map((i) => ({ ...i })),
            selection: [],
          });
          useStudio.temporal.getState().clear();
        },

        setSelection(ids) {
          set({ selection: ids });
        },

        toggleSelection(id, additive) {
          set((state) => {
            if (!additive) return { selection: [id] };
            return state.selection.includes(id)
              ? { selection: state.selection.filter((s) => s !== id) }
              : { selection: [...state.selection, id] };
          });
        },

        setHovered(id) {
          set({ hovered: id });
        },

        moveItem(itemId, position) {
          mutateItems((items) =>
            items.map((i) => (i.itemId === itemId && !i.locked ? { ...i, position } : i)),
          );
        },

        nudgeSelection(delta) {
          const selection = new Set(get().selection);
          mutateItems((items) =>
            items.map((i) =>
              selection.has(i.itemId) && !i.locked
                ? { ...i, position: v2(i.position.x + delta.x, i.position.y + delta.y) }
                : i,
            ),
          );
        },

        rotateItem(itemId, rotation) {
          mutateItems((items) =>
            items.map((i) =>
              i.itemId === itemId && !i.locked ? { ...i, rotation: wrapAngle(rotation) } : i,
            ),
          );
        },

        rotateSelection(deltaRad) {
          const selection = new Set(get().selection);
          mutateItems((items) =>
            items.map((i) =>
              selection.has(i.itemId) && !i.locked
                ? { ...i, rotation: wrapAngle(i.rotation + deltaRad) }
                : i,
            ),
          );
        },

        scaleItem(itemId, scale) {
          mutateItems((items) =>
            items.map((i) =>
              i.itemId === itemId ? { ...i, scale: Math.max(0.25, Math.min(3, scale)) } : i,
            ),
          );
        },

        setElevation(itemId, elevation) {
          mutateItems((items) =>
            items.map((i) => (i.itemId === itemId ? { ...i, elevation: Math.max(0, elevation) } : i)),
          );
        },

        toggleLock(itemId) {
          mutateItems((items) =>
            items.map((i) => (i.itemId === itemId ? { ...i, locked: !i.locked } : i)),
          );
        },

        removeFromLayout(itemId) {
          mutateItems((items) => items.filter((i) => i.itemId !== itemId));
          set((s) => ({ selection: s.selection.filter((id) => id !== itemId) }));
        },

        placeInLayout(itemId, position) {
          const roomId = get().roomId;
          if (!roomId) return;
          if (get().layoutItems.some((i) => i.itemId === itemId)) return;
          mutateItems((items) => [
            ...items,
            { itemId, position, rotation: 0, elevation: 0, scale: 1, locked: false, roomId },
          ]);
          set({ selection: [itemId] });
        },

        replaceItems(items) {
          mutateItems(() => items.map((i) => ({ ...i })));
        },

        async addInventoryItem(item) {
          await db().items.put(item);
          set((s) => ({ inventory: [...s.inventory, item] }));
        },

        async updateInventoryItem(id, patch) {
          const existing = get().inventory.find((i) => i.id === id);
          if (!existing) return;
          const next = { ...existing, ...patch };
          await db().items.put(next);
          set((s) => ({ inventory: s.inventory.map((i) => (i.id === id ? next : i)) }));
        },

        async deleteInventoryItem(id) {
          await db().items.delete(id);
          set((s) => ({
            inventory: s.inventory.filter((i) => i.id !== id),
            layoutItems: s.layoutItems.filter((i) => i.itemId !== id),
            selection: s.selection.filter((s2) => s2 !== id),
          }));
          scheduleSave();
        },

        async addFeature(featureRecord) {
          await db().features.put(featureRecord);
          set((s) => ({ features: [...s.features, featureRecord] }));
        },

        async updateFeature(id, patch) {
          const existing = get().features.find((f) => f.id === id);
          if (!existing) return;
          const next = { ...existing, ...patch };
          await db().features.put(next);
          set((s) => ({ features: s.features.map((f) => (f.id === id ? next : f)) }));
        },

        async deleteFeature(id) {
          await db().features.delete(id);
          set((s) => ({ features: s.features.filter((f) => f.id !== id) }));
        },

        async createRoom(room) {
          await db().rooms.put(room);
          set((s) => ({ rooms: [...s.rooms, room] }));
        },

        async updateRoom(id, patch) {
          const existing = get().rooms.find((r) => r.id === id);
          if (!existing) return;
          const next = { ...existing, ...patch };
          await db().rooms.put(next);
          set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? next : r)) }));
        },

        async updateProject(patch) {
          const existing = get().project;
          if (!existing) return;
          const next = { ...existing, ...patch, updatedAt: Date.now() };
          await db().projects.put(next);
          set({ project: next });
        },

        async forkLayout(name) {
          const { projectId, roomId, layoutId, layoutItems, layouts } = get();
          if (!projectId || !roomId) return null;
          const now = Date.now();
          const current = layouts.find((l) => l.id === layoutId);
          const palette = ['#8fa8c8', '#c2a06a', '#7fae94', '#b58ac0', '#cf8f7a', '#7fa7b5'];
          const layout: Layout = {
            id: nanoid(10),
            projectId,
            roomId,
            name,
            parentId: layoutId ?? undefined,
            items: layoutItems.map((i) => ({ ...i })),
            isCurrent: false,
            color: palette[layouts.length % palette.length],
            eventId: current?.eventId ?? get().eventId ?? undefined,
            setupKind: current?.setupKind,
            createdAt: now,
            updatedAt: now,
          };
          await db().layouts.put(layout);
          const event = get().events.find((e) => e.id === (layout.eventId ?? get().eventId));
          if (event && current?.setupKind && current.setupKind !== layout.setupKind) {
            const nextEvent = { ...event, setupIds: [...event.setupIds, layout.id], updatedAt: now };
            await db().events.put(nextEvent);
            set((s) => ({
              layouts: [...s.layouts, layout],
              layoutId: layout.id,
              events: s.events.map((e) => (e.id === nextEvent.id ? nextEvent : e)),
            }));
          } else {
            set((s) => ({ layouts: [...s.layouts, layout], layoutId: layout.id }));
          }
          useStudio.temporal.getState().clear();
          return layout.id;
        },

        async renameLayout(id, name) {
          const layout = get().layouts.find((l) => l.id === id);
          if (!layout) return;
          const next = { ...layout, name, updatedAt: Date.now() };
          await db().layouts.put(next);
          set((s) => ({ layouts: s.layouts.map((l) => (l.id === id ? next : l)) }));
        },

        async deleteLayout(id) {
          await db().layouts.delete(id);
          await db().decisions.where('layoutId').equals(id).delete();
          const remaining = get().layouts.filter((l) => l.id !== id);
          const nextActive = remaining.find((l) => l.roomId === get().roomId) ?? null;
          const touchedEvents = get().events
            .filter((e) => e.setupIds.includes(id))
            .map((e) => ({ ...e, setupIds: e.setupIds.filter((sid) => sid !== id), updatedAt: Date.now() }));
          if (touchedEvents.length) await db().events.bulkPut(touchedEvents);
          set((s) => ({
            layouts: remaining,
            decisions: s.decisions.filter((d) => d.layoutId !== id),
            events: s.events.map((e) => touchedEvents.find((t) => t.id === e.id) ?? e),
            layoutId: s.layoutId === id ? (nextActive?.id ?? null) : s.layoutId,
            layoutItems:
              s.layoutId === id ? (nextActive ? nextActive.items.map((i) => ({ ...i })) : []) : s.layoutItems,
            compareLayoutId: s.compareLayoutId === id ? null : s.compareLayoutId,
          }));
        },

        async markCurrent(id) {
          const { layouts, roomId } = get();
          const updated = layouts.map((l) =>
            l.roomId === roomId ? { ...l, isCurrent: l.id === id } : l,
          );
          await db().layouts.bulkPut(updated.filter((l) => l.roomId === roomId));
          set({ layouts: updated });
        },

        async saveNow() {
          const { layoutId, layoutItems, layouts } = get();
          if (!layoutId) {
            set({ dirty: false });
            return;
          }
          const layout = layouts.find((l) => l.id === layoutId);
          if (!layout) {
            set({ dirty: false });
            return;
          }
          const next: Layout = {
            ...layout,
            items: layoutItems.map((i) => ({ ...i })),
            updatedAt: Date.now(),
          };
          await db().layouts.put(next);
          set((s) => ({
            layouts: s.layouts.map((l) => (l.id === layoutId ? next : l)),
            dirty: false,
          }));
        },

        async addDecision(entry) {
          const record: DecisionEntry = { ...entry, id: nanoid(10), createdAt: Date.now() };
          await db().decisions.put(record);
          set((s) => ({ decisions: [...s.decisions, record] }));
        },

        async updateDecision(id, patch) {
          const existing = get().decisions.find((d) => d.id === id);
          if (!existing) return;
          const next = { ...existing, ...patch };
          await db().decisions.put(next);
          set((s) => ({ decisions: s.decisions.map((d) => (d.id === id ? next : d)) }));
        },

        async deleteDecision(id) {
          await db().decisions.delete(id);
          set((s) => ({ decisions: s.decisions.filter((d) => d.id !== id) }));
        },

        async setVerdict(id, verdict) {
          await get().updateDecision(id, {
            verdict,
            implementedAt: verdict === 'implemented' ? Date.now() : undefined,
          });
        },

        setView(view) {
          set({ view });
        },

        toggleOverlay(key) {
          set((s) => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } }));
        },

        setTimeOfDay(hour) {
          set({ timeOfDay: Math.max(0, Math.min(23.99, hour)) });
        },

        setDateISO(iso) {
          set({ dateISO: iso });
        },

        setCompare(layoutId) {
          set({ compareLayoutId: layoutId });
        },

        setSnapEnabled(on) {
          set({ snapEnabled: on });
        },

        setStudioMode(mode) {
          set({
            studioMode: mode,
            view: mode === 'ops' ? 'plan' : get().view,
          });
        },

        selectEvent(eventId) {
          const event = get().events.find((e) => e.id === eventId);
          if (!event) return;
          const first = event.setupIds.map((id) => get().layouts.find((l) => l.id === id)).find(Boolean);
          set({
            eventId,
            dateISO: event.dateISO,
            roomId: event.roomId,
            layoutId: first?.id ?? get().layoutId,
            layoutItems: first ? first.items.map((i) => ({ ...i })) : get().layoutItems,
          });
          useStudio.temporal.getState().clear();
        },

        async updateEvent(id, patch) {
          const existing = get().events.find((e) => e.id === id);
          if (!existing) return;
          const next = { ...existing, ...patch, updatedAt: Date.now() };
          await db().events.put(next);
          set((s) => ({
            events: s.events.map((e) => (e.id === id ? next : e)),
            dateISO: s.eventId === id && next.dateISO ? next.dateISO : s.dateISO,
          }));
        },

        async issueEvent(metrics) {
          const { eventId, layoutId, addDecision, projectId, roomId } = get();
          const event = get().events.find((e) => e.id === eventId);
          if (!event || !projectId || !roomId) return;
          const now = Date.now();
          const next: BanquetEvent = {
            ...event,
            status: 'issued',
            issuedAt: now,
            issuedMetrics: metrics,
            updatedAt: now,
          };
          await db().events.put(next);
          set((s) => ({ events: s.events.map((e) => (e.id === event.id ? next : e)) }));
          if (layoutId) {
            await addDecision({
              projectId,
              roomId,
              layoutId,
              eventId: event.id,
              verdict: 'adopted',
              title: `Issued to ops — ${event.name}`,
              rationale: `Locked for ${event.clientName}, ${event.guestCount} guests on ${event.dateISO}. This is the sheet the crew works from.`,
              pros: [],
              cons: [],
              tags: ['issued', 'beo'],
              metrics,
            });
          }
        },

        async executeEvent() {
          const { eventId, layoutId, markCurrent, addDecision, projectId, roomId } = get();
          const event = get().events.find((e) => e.id === eventId);
          if (!event || !projectId || !roomId) return;
          const now = Date.now();
          const next: BanquetEvent = {
            ...event,
            status: 'executed',
            executedAt: now,
            updatedAt: now,
          };
          await db().events.put(next);
          set((s) => ({ events: s.events.map((e) => (e.id === event.id ? next : e)) }));
          if (layoutId) {
            await markCurrent(layoutId);
            await addDecision({
              projectId,
              roomId,
              layoutId,
              eventId: event.id,
              verdict: 'implemented',
              title: `Executed — ${event.name}`,
              rationale: 'House set as drawn. Overnight reset follows this layout until the next issued event.',
              pros: [],
              cons: [],
              tags: ['executed'],
              implementedAt: now,
            });
          }
        },
      };
    },
    {
      limit: 120,
      partialize: (state) => ({ layoutItems: state.layoutItems }),
      equality: (a, b) => {
        if (a.layoutItems === b.layoutItems) return true;
        if (a.layoutItems.length !== b.layoutItems.length) return false;
        return a.layoutItems.every((item, i) => {
          const other = b.layoutItems[i];
          return (
            item.itemId === other.itemId &&
            item.position.x === other.position.x &&
            item.position.y === other.position.y &&
            item.rotation === other.rotation &&
            item.scale === other.scale &&
            item.elevation === other.elevation &&
            item.locked === other.locked
          );
        });
      },
    },
  ),
);

export const useTemporalStore = () => useStudio.temporal.getState();

/** Convenience selector: inventory indexed for the evaluator. */
export function inventoryMap(items: InventoryItem[]): Map<string, InventoryItem> {
  return new Map(items.map((i) => [i.id, i]));
}
