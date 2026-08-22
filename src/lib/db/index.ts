'use client';

/**
 * Everything lives in IndexedDB on the user's own machine.
 *
 * That is a deliberate product decision, not a shortcut: the input is
 * photographs of the inside of someone's home, and the app has no reason to
 * ever see them. Photos are stored as Blobs, so nothing is base64-bloated and
 * nothing leaves the device unless the user explicitly opts into a cloud
 * detector on the capture screen.
 */

import Dexie, { type Table } from 'dexie';
import type {
  DecisionEntry,
  InventoryItem,
  Layout,
  Photo,
  Project,
  Room,
  RoomFeature,
} from '../domain/types';

export interface Preference {
  key: string;
  value: unknown;
}

export class StanzaDatabase extends Dexie {
  projects!: Table<Project, string>;
  rooms!: Table<Room, string>;
  photos!: Table<Photo, string>;
  items!: Table<InventoryItem, string>;
  features!: Table<RoomFeature, string>;
  layouts!: Table<Layout, string>;
  decisions!: Table<DecisionEntry, string>;
  preferences!: Table<Preference, string>;

  constructor() {
    super('stanza');
    this.version(1).stores({
      projects: 'id, name, updatedAt',
      rooms: 'id, projectId, name',
      photos: 'id, roomId, projectId, takenAt',
      items: 'id, projectId, category, label',
      features: 'id, roomId, kind',
      layouts: 'id, projectId, roomId, parentId, updatedAt',
      decisions: 'id, projectId, roomId, layoutId, createdAt',
      preferences: 'key',
    });

    // Projects saved before the daylight clock became explicit read the slider
    // in the device's timezone, so that is the reading to preserve for them.
    this.version(2).upgrade((tx) =>
      tx
        .table<Project>('projects')
        .toCollection()
        .modify((p) => {
          p.utcOffsetMinutes ??= -new Date().getTimezoneOffset();
        }),
    );
  }
}

let instance: StanzaDatabase | null = null;

export function db(): StanzaDatabase {
  if (!instance) instance = new StanzaDatabase();
  return instance;
}

export async function getPreference<T>(key: string, fallback: T): Promise<T> {
  const row = await db().preferences.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  await db().preferences.put({ key, value });
}

/** Full project export — the escape hatch that keeps this data yours. */
export async function exportProject(projectId: string): Promise<Record<string, unknown>> {
  const d = db();
  const [project, rooms, items, features, layouts, decisions] = await Promise.all([
    d.projects.get(projectId),
    d.rooms.where('projectId').equals(projectId).toArray(),
    d.items.where('projectId').equals(projectId).toArray(),
    d.features.toArray(),
    d.layouts.where('projectId').equals(projectId).toArray(),
    d.decisions.where('projectId').equals(projectId).toArray(),
  ]);
  const roomIds = new Set(rooms.map((r) => r.id));
  return {
    format: 'stanza.project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    rooms,
    items,
    features: features.filter((f) => roomIds.has(f.roomId)),
    layouts,
    decisions,
  };
}

export async function deleteProject(projectId: string): Promise<void> {
  const d = db();
  const rooms = await d.rooms.where('projectId').equals(projectId).toArray();
  const roomIds = rooms.map((r) => r.id);
  await d.transaction(
    'rw',
    [d.projects, d.rooms, d.photos, d.items, d.features, d.layouts, d.decisions],
    async () => {
      await d.projects.delete(projectId);
      await d.rooms.where('projectId').equals(projectId).delete();
      await d.photos.where('projectId').equals(projectId).delete();
      await d.items.where('projectId').equals(projectId).delete();
      await d.layouts.where('projectId').equals(projectId).delete();
      await d.decisions.where('projectId').equals(projectId).delete();
      for (const roomId of roomIds) {
        await d.features.where('roomId').equals(roomId).delete();
      }
    },
  );
}
