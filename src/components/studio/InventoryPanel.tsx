'use client';

import { useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { Package, Plus } from 'lucide-react';
import { Button, Panel, TextInput, cn } from '@/components/ui/primitives';
import { CATEGORY_KEYS, ROOM_CATEGORY_HINTS, estimateMass, priorFor } from '@/lib/domain/catalog';
import type { FurnitureCategory, InventoryItem } from '@/lib/domain/types';
import { v2, v3 } from '@/lib/geometry/vec';
import { polygonCentroid } from '@/lib/geometry/shapes';
import { formatLength } from '@/lib/format';
import { useStudio } from '@/lib/store/studio';

export function InventoryPanel() {
  const inventory = useStudio((s) => s.inventory);
  const layoutItems = useStudio((s) => s.layoutItems);
  const project = useStudio((s) => s.project);
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const placeInLayout = useStudio((s) => s.placeInLayout);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);
  const addInventoryItem = useStudio((s) => s.addInventoryItem);
  const setSelection = useStudio((s) => s.setSelection);

  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftCategory, setDraftCategory] = useState<FurnitureCategory>('armchair');

  const placed = useMemo(() => new Set(layoutItems.map((i) => i.itemId)), [layoutItems]);
  const units = project?.unitSystem ?? 'metric';

  const suggestions = room ? ROOM_CATEGORY_HINTS[room.kind] : CATEGORY_KEYS;

  const create = async () => {
    if (!project) return;
    const prior = priorFor(draftCategory);
    const size = v3(prior.size[0], prior.size[1], prior.size[2]);
    const item: InventoryItem = {
      id: nanoid(10),
      projectId: project.id,
      label: draftLabel.trim() || prior.label,
      category: draftCategory,
      size,
      massKg: estimateMass(draftCategory, size),
      movability: prior.movability,
      color: prior.color,
      confidence: 0.5,
      needsPower: prior.needsPower,
      cordLength: prior.cordLength,
      tags: ['added by hand'],
      quantityOnHand: 1,
      createdAt: Date.now(),
    };
    await addInventoryItem(item);
    if (room) placeInLayout(item.id, polygonCentroid(room.footprint));
    setDraftLabel('');
    setAdding(false);
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Package size={12} /> Your things
        </span>
      }
      action={
        <Button size="sm" variant="subtle" onClick={() => setAdding((v) => !v)}>
          <Plus size={12} /> Add
        </Button>
      }
      className="min-h-0"
    >
      {adding && (
        <div className="space-y-2 border-b border-[color:var(--hairline)] p-2.5">
          <TextInput
            autoFocus
            placeholder="What is it? e.g. Nan's armchair"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            className="w-full"
          />
          <div className="flex flex-wrap gap-1">
            {suggestions.slice(0, 10).map((c) => (
              <button
                key={c}
                onClick={() => setDraftCategory(c)}
                className={cn(
                  'rounded px-1.5 py-1 text-[11px] transition-colors',
                  draftCategory === c
                    ? 'bg-brass-500/20 text-brass-300'
                    : 'bg-ink-800 text-ink-400 hover:text-ink-100',
                )}
              >
                {priorFor(c).label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="tabular text-[11px] text-ink-500">
              starts at {priorFor(draftCategory).size.map((v) => formatLength(v, units)).join(' × ')}
            </span>
            <Button size="sm" variant="primary" onClick={() => void create()}>
              Add to room
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {inventory.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-ink-500">
            Nothing catalogued yet. Capture a photo of the room, or add pieces by hand.
          </div>
        )}
        {inventory.map((item) => {
          const isPlaced = placed.has(item.id);
          return (
            <div
              key={item.id}
              className="group mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-800"
            >
              <span
                className="h-6 w-6 shrink-0 rounded border border-[color:var(--hairline)]"
                style={{ background: item.color }}
              />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => isPlaced && setSelection([item.id])}
              >
                <div
                  className={cn(
                    'truncate text-[12.5px]',
                    isPlaced ? 'text-ink-100' : 'text-ink-500',
                  )}
                >
                  {item.label}
                </div>
                <div className="tabular text-[10.5px] text-ink-500">
                  {formatLength(item.size.x, units)} × {formatLength(item.size.z, units)} ·{' '}
                  {priorFor(item.category).label}
                </div>
              </button>
              <button
                onClick={() =>
                  isPlaced
                    ? removeFromLayout(item.id)
                    : room && placeInLayout(item.id, polygonCentroid(room.footprint))
                }
                className={cn(
                  'shrink-0 rounded px-1.5 py-1 text-[10.5px] uppercase tracking-wide transition-colors',
                  isPlaced
                    ? 'text-ink-500 opacity-0 group-hover:opacity-100 hover:text-signal-red'
                    : 'bg-ink-800 text-brass-300 hover:bg-ink-700',
                )}
              >
                {isPlaced ? 'remove' : 'place'}
              </button>
            </div>
          );
        })}
      </div>

      <footer className="border-t border-[color:var(--hairline)] px-3 py-2 text-[11px] text-ink-500">
        {placed.size} of {inventory.length} in this arrangement
      </footer>
    </Panel>
  );
}

export { v2 };
