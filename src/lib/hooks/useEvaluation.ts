'use client';

import { useDeferredValue, useMemo } from 'react';
import { type Evaluation, evaluateLayout } from '../constraints/evaluate';
import { localClockToInstant } from '../constraints/solar';
import type { Layout, SetupKind } from '../domain/types';
import { inventoryMap, useStudio } from '../store/studio';

/**
 * Re-evaluating on every drag frame would be wasteful, so the arrangement is
 * deferred: the geometry follows the pointer at full rate while the findings
 * catch up a frame or two later.
 */
export function useEvaluation(): Evaluation | null {
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const features = useStudio((s) => s.features);
  const inventory = useStudio((s) => s.inventory);
  const project = useStudio((s) => s.project);
  const layoutId = useStudio((s) => s.layoutId);
  const layoutItems = useStudio((s) => s.layoutItems);
  const timeOfDay = useStudio((s) => s.timeOfDay);
  const dateISO = useStudio((s) => s.dateISO);
  const event = useStudio((s) => s.events.find((e) => e.id === s.eventId) ?? null);
  const setupKind = useStudio((s) => s.layouts.find((l) => l.id === s.layoutId)?.setupKind);

  const deferredItems = useDeferredValue(layoutItems);
  const guestCount = banquetGuestCount(event?.guestCount, setupKind);

  return useMemo(() => {
    if (!room || !project) return null;
    const layout: Layout = {
      id: layoutId ?? 'draft',
      projectId: project.id,
      roomId: room.id,
      name: 'draft',
      items: deferredItems,
      isCurrent: false,
      color: '#8fa8c8',
      createdAt: 0,
      updatedAt: 0,
    };
    const date = localClockToInstant(dateISO, timeOfDay, project.utcOffsetMinutes);

    return evaluateLayout({
      room,
      features,
      layout,
      inventory: inventoryMap(inventory),
      latitude: project.latitude,
      longitude: project.longitude,
      date,
      guestCount,
    });
  }, [room, features, inventory, project, layoutId, deferredItems, timeOfDay, dateISO, guestCount]);
}

/** Evaluate an arbitrary stored layout, for comparisons. */
export function useLayoutEvaluation(layoutId: string | null): Evaluation | null {
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const features = useStudio((s) => s.features);
  const inventory = useStudio((s) => s.inventory);
  const project = useStudio((s) => s.project);
  const layouts = useStudio((s) => s.layouts);
  const timeOfDay = useStudio((s) => s.timeOfDay);
  const dateISO = useStudio((s) => s.dateISO);
  const event = useStudio((s) => s.events.find((e) => e.id === s.eventId) ?? null);

  return useMemo(() => {
    const layout = layouts.find((l) => l.id === layoutId);
    if (!layout || !room || !project) return null;
    const date = localClockToInstant(dateISO, timeOfDay, project.utcOffsetMinutes);
    return evaluateLayout({
      room,
      features,
      layout,
      inventory: inventoryMap(inventory),
      latitude: project.latitude,
      longitude: project.longitude,
      date,
      guestCount: banquetGuestCount(event?.guestCount, layout.setupKind),
    });
  }, [layouts, layoutId, room, features, inventory, project, timeOfDay, dateISO, event?.guestCount]);
}

/** Dinner and ceremony must seat the guarantee. Reception is standing. */
function banquetGuestCount(guestCount: number | undefined, setupKind: SetupKind | undefined) {
  if (guestCount == null || guestCount <= 0) return undefined;
  if (setupKind === 'cocktail' || setupKind === 'reception' || setupKind === 'dance') return undefined;
  return guestCount;
}

export type { Evaluation };
