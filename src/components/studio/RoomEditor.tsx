'use client';

import { nanoid } from 'nanoid';
import { DoorOpen, Plus, Trash2, X } from 'lucide-react';
import { Button, Field, NumberInput, cn } from '@/components/ui/primitives';
import type { RoomFeature } from '@/lib/domain/types';
import { formatLength } from '@/lib/format';
import {
  OPENING_KINDS,
  footprintSize,
  longestFreeEdge,
  placeOnEdge,
  remapFeatures,
  setFootprintSize,
} from '@/lib/geometry/roomEdit';
import { useStudio } from '@/lib/store/studio';

const SWINGS = [
  { value: 'in-right', label: 'In, right' },
  { value: 'in-left', label: 'In, left' },
  { value: 'out-right', label: 'Out, right' },
  { value: 'out-left', label: 'Out, left' },
] as const;

export function RoomEditor({
  selectedFeatureId,
  onSelectFeature,
  addingCorner,
  onToggleCorner,
}: {
  selectedFeatureId: string | null;
  onSelectFeature: (id: string | null) => void;
  addingCorner: boolean;
  onToggleCorner: () => void;
}) {
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const features = useStudio((s) => s.features);
  const project = useStudio((s) => s.project);
  const reshapeRoom = useStudio((s) => s.reshapeRoom);
  const addFeature = useStudio((s) => s.addFeature);
  const updateFeature = useStudio((s) => s.updateFeature);
  const deleteFeature = useStudio((s) => s.deleteFeature);
  const units = project?.unitSystem ?? 'metric';

  if (!room) return null;

  const size = footprintSize(room.footprint);
  const openings = features.filter((f) => OPENING_KINDS.has(f.kind));
  const toDisplay = (m: number) => (units === 'imperial' ? m / 0.3048 : m);
  const fromDisplay = (v: number) => (units === 'imperial' ? v * 0.3048 : v);
  const suffix = units === 'imperial' ? 'ft' : 'm';

  const applySize = (width: number, depth: number) => {
    const next = setFootprintSize(room.footprint, width, depth);
    void reshapeRoom(next, remapFeatures(features, room.footprint, next));
  };

  const addDoor = async () => {
    const edge = longestFreeEdge(room.footprint, openings);
    const placed = placeOnEdge(room.footprint, edge, 0.5);
    const feature: RoomFeature = {
      id: nanoid(10),
      roomId: room.id,
      kind: 'door',
      position: placed.position,
      facing: placed.facing,
      width: 0.9,
      height: 2.04,
      sillHeight: 0,
      swing: 'in-right',
      label: 'Door',
    };
    await addFeature(feature);
    onSelectFeature(feature.id);
  };

  return (
    <div className="flex h-full flex-col">
      <p className="px-2 pb-3 text-[13px] leading-relaxed text-ink-400">
        Drag the gold corners or the dots on the walls. Drag a door along a wall to move it.
      </p>

      <div className="grid grid-cols-2 gap-2 px-2">
        <Field label="Width">
          <NumberInput
            value={toDisplay(size.width)}
            step={units === 'imperial' ? 0.5 : 0.1}
            suffix={suffix}
            onChange={(v) => applySize(fromDisplay(v), size.depth)}
          />
        </Field>
        <Field label="Depth">
          <NumberInput
            value={toDisplay(size.depth)}
            step={units === 'imperial' ? 0.5 : 0.1}
            suffix={suffix}
            onChange={(v) => applySize(size.width, fromDisplay(v))}
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2 px-2">
        <Button size="sm" variant="subtle" className="flex-1" onClick={() => void addDoor()}>
          <DoorOpen size={13} /> Add a door
        </Button>
        <Button
          size="sm"
          variant={addingCorner ? 'primary' : 'subtle'}
          className="flex-1"
          onClick={onToggleCorner}
        >
          <Plus size={13} /> {addingCorner ? 'Click a wall' : 'Add a corner'}
        </Button>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-1">
        {openings.length === 0 && (
          <p className="px-2 text-[13px] text-ink-500">No doors yet. Add one, then drag it into place.</p>
        )}
        {openings.map((f) => {
          const active = f.id === selectedFeatureId;
          return (
            <div
              key={f.id}
              className={cn(
                'mb-1 rounded-xl px-2 py-2',
                active ? 'bg-brass-500/10 ring-1 ring-brass-500/40' : 'hover:bg-ink-800',
              )}
            >
              <button
                className="flex w-full items-center gap-2 text-left"
                onClick={() => onSelectFeature(active ? null : f.id)}
              >
                <DoorOpen size={14} className="shrink-0 text-brass-400" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink-100">
                  {f.label ?? (f.kind === 'opening' ? 'Opening' : 'Door')}
                </span>
                <span className="tabular text-[12px] text-ink-500">{formatLength(f.width, units)}</span>
              </button>
              {active && (
                <div className="mt-2 space-y-2 border-t border-[color:var(--hairline)] pt-2">
                  <Field label="Door width">
                    <NumberInput
                      value={toDisplay(f.width)}
                      step={units === 'imperial' ? 0.1 : 0.05}
                      suffix={suffix}
                      onChange={(v) => void updateFeature(f.id, { width: Math.max(0.6, fromDisplay(v)) })}
                    />
                  </Field>
                  {f.kind === 'door' && (
                    <div className="flex flex-wrap gap-1">
                      {SWINGS.map((s) => (
                        <button
                          key={s.value}
                          onClick={() => void updateFeature(f.id, { swing: s.value })}
                          className={cn(
                            'rounded-lg px-2 py-1 text-[12px]',
                            f.swing === s.value
                              ? 'bg-brass-500/20 text-brass-300'
                              : 'bg-ink-800 text-ink-400 hover:text-ink-100',
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      void deleteFeature(f.id);
                      onSelectFeature(null);
                    }}
                    className="flex items-center gap-1 text-[12px] text-ink-500 hover:text-signal-red"
                  >
                    <Trash2 size={12} /> Remove door
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RoomSizeButton({ onClick }: { onClick: () => void }) {
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const project = useStudio((s) => s.project);
  if (!room) return null;
  const size = footprintSize(room.footprint);
  const units = project?.unitSystem ?? 'metric';
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-[color:var(--hairline)] bg-ink-900/95 px-3 py-2 text-left shadow-lg hover:bg-ink-800"
      title="Edit the room"
    >
      <div className="text-[11px] text-ink-500">Room</div>
      <div className="tabular text-[13px] text-ink-100">
        {formatLength(size.width, units)} × {formatLength(size.depth, units)}
      </div>
    </button>
  );
}

export function DoorChip({
  featureId,
  onClose,
}: {
  featureId: string;
  onClose: () => void;
}) {
  const feature = useStudio((s) => s.features.find((f) => f.id === featureId) ?? null);
  const updateFeature = useStudio((s) => s.updateFeature);
  const deleteFeature = useStudio((s) => s.deleteFeature);
  if (!feature || !OPENING_KINDS.has(feature.kind)) return null;

  const cycleSwing = () => {
    const order = ['in-right', 'in-left', 'out-right', 'out-left'] as const;
    const i = order.indexOf((feature.swing as (typeof order)[number]) ?? 'in-right');
    void updateFeature(feature.id, { swing: order[(i + 1) % order.length] });
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[color:var(--hairline)] bg-ink-900/95 px-3 py-2 shadow-lg">
      <DoorOpen size={14} className="text-brass-400" />
      <span className="text-[14px] text-ink-100">{feature.label ?? 'Door'}</span>
      {feature.kind === 'door' && (
        <Button size="sm" variant="ghost" onClick={cycleSwing}>
          Swing
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void updateFeature(feature.id, { width: Math.min(3.2, feature.width + 0.1) })}
      >
        Wider
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void updateFeature(feature.id, { width: Math.max(0.6, feature.width - 0.1) })}
      >
        Narrower
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void deleteFeature(feature.id);
          onClose();
        }}
      >
        Remove
      </Button>
      <button onClick={onClose} className="rounded p-1 text-ink-500 hover:text-ink-100" title="Deselect">
        <X size={14} />
      </button>
    </div>
  );
}
