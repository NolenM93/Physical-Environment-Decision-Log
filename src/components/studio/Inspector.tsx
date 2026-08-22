'use client';

import { useMemo } from 'react';
import { Info, Lock, LockOpen, RotateCw, Trash2 } from 'lucide-react';
import { Badge, Button, Field, NumberInput, Panel, TextInput, cn } from '@/components/ui/primitives';
import { CATEGORY_KEYS, priorFor } from '@/lib/domain/catalog';
import type { FurnitureCategory } from '@/lib/domain/types';
import { formatLength, formatMass } from '@/lib/format';
import { useStudio } from '@/lib/store/studio';
import type { Evaluation } from '@/lib/constraints/evaluate';

export function Inspector({ evaluation }: { evaluation: Evaluation | null }) {
  const selection = useStudio((s) => s.selection);
  const inventory = useStudio((s) => s.inventory);
  const project = useStudio((s) => s.project);
  const moveItem = useStudio((s) => s.moveItem);
  const rotateItem = useStudio((s) => s.rotateItem);
  const scaleItem = useStudio((s) => s.scaleItem);
  const setElevation = useStudio((s) => s.setElevation);
  const toggleLock = useStudio((s) => s.toggleLock);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);
  const updateInventoryItem = useStudio((s) => s.updateInventoryItem);

  const units = project?.unitSystem ?? 'metric';
  const id = selection[0];
  const resolved = evaluation?.resolved.find((r) => r.id === id) ?? null;
  const item = inventory.find((i) => i.id === id) ?? null;

  const relatedFindings = useMemo(
    () => evaluation?.findings.filter((f) => id && f.itemIds.includes(id)) ?? [],
    [evaluation, id],
  );

  if (!item || !resolved) {
    return (
      <Panel title="Inspector" className="min-h-0">
        <div className="p-4 text-[12.5px] leading-relaxed text-ink-500">
          Select a piece of furniture to see its measurements, how confident the reconstruction is,
          and what the constraint checks say about where it currently sits.
        </div>
      </Panel>
    );
  }

  const prior = priorFor(item.category);
  const confidenceTone =
    item.confidence > 0.7 ? 'good' : item.confidence > 0.45 ? 'warn' : 'bad';

  return (
    <Panel
      title="Inspector"
      action={
        <div className="flex items-center gap-1">
          <button
            title={resolved.placed.locked ? 'Unlock' : 'Lock in place'}
            onClick={() => toggleLock(item.id)}
            className={cn(
              'rounded p-1.5 hover:bg-ink-700',
              resolved.placed.locked ? 'text-brass-400' : 'text-ink-500',
            )}
          >
            {resolved.placed.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
          <button
            title="Take out of this arrangement"
            onClick={() => removeFromLayout(item.id)}
            className="rounded p-1.5 text-ink-500 hover:bg-ink-700 hover:text-signal-red"
          >
            <Trash2 size={13} />
          </button>
        </div>
      }
      className="min-h-0"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-2">
          <TextInput
            value={item.label}
            onChange={(e) => void updateInventoryItem(item.id, { label: e.target.value })}
            className="w-full text-[14px]"
          />
          <div className="flex items-center gap-2">
            <select
              value={item.category}
              onChange={(e) => {
                const category = e.target.value as FurnitureCategory;
                void updateInventoryItem(item.id, { category, color: priorFor(category).color });
              }}
              className="h-8 flex-1 rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2 text-[12.5px] text-ink-100 focus:border-brass-500 focus:outline-none"
            >
              {CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {priorFor(c).label}
                </option>
              ))}
            </select>
            <input
              type="color"
              value={item.color}
              onChange={(e) => void updateInventoryItem(item.id, { color: e.target.value })}
              className="h-8 w-9 cursor-pointer rounded-md border border-[color:var(--hairline)] bg-ink-900"
            />
          </div>
        </div>

        <div>
          <div className="rule-label mb-1.5">Measured size</div>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="Width">
              <NumberInput
                value={item.size.x}
                onChange={(v) => void updateInventoryItem(item.id, { size: { ...item.size, x: v } })}
                suffix="m"
              />
            </Field>
            <Field label="Height">
              <NumberInput
                value={item.size.y}
                onChange={(v) => void updateInventoryItem(item.id, { size: { ...item.size, y: v } })}
                suffix="m"
              />
            </Field>
            <Field label="Depth">
              <NumberInput
                value={item.size.z}
                onChange={(v) => void updateInventoryItem(item.id, { size: { ...item.size, z: v } })}
                suffix="m"
              />
            </Field>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-500">
            <Badge tone={confidenceTone}>{Math.round(item.confidence * 100)}% confident</Badge>
            <span>
              {formatMass(item.massKg, units)} · {prior.movability}
            </span>
          </div>
        </div>

        <div>
          <div className="rule-label mb-1.5">Placement</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="X">
              <NumberInput
                value={resolved.placed.position.x}
                onChange={(v) => moveItem(item.id, { x: v, y: resolved.placed.position.y })}
                suffix="m"
              />
            </Field>
            <Field label="Y">
              <NumberInput
                value={resolved.placed.position.y}
                onChange={(v) => moveItem(item.id, { x: resolved.placed.position.x, y: v })}
                suffix="m"
              />
            </Field>
            <Field label="Rotation">
              <NumberInput
                value={((resolved.placed.rotation * 180) / Math.PI + 360) % 360}
                step={5}
                onChange={(v) => rotateItem(item.id, (v * Math.PI) / 180)}
                suffix="°"
              />
            </Field>
            <Field label="Base height">
              <NumberInput
                value={resolved.placed.elevation}
                step={0.05}
                onChange={(v) => setElevation(item.id, v)}
                suffix="m"
              />
            </Field>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => rotateItem(item.id, resolved.placed.rotation + Math.PI / 2)}>
              <RotateCw size={12} /> 90°
            </Button>
            <Button size="sm" variant="outline" onClick={() => rotateItem(item.id, resolved.placed.rotation + Math.PI)}>
              180°
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="rule-label">Scale</span>
              <input
                type="range"
                min={0.5}
                max={1.6}
                step={0.01}
                value={resolved.placed.scale}
                onChange={(e) => scaleItem(item.id, parseFloat(e.target.value))}
                className="w-20"
              />
              <span className="tabular w-9 text-right text-[11px] text-ink-400">
                {resolved.placed.scale.toFixed(2)}×
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="rule-label mb-1.5">Footprint</div>
          <div className="tabular grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-ink-300">
            <span className="text-ink-500">Area</span>
            <span className="text-right">{(resolved.size.x * resolved.size.z).toFixed(2)} m²</span>
            <span className="text-ink-500">Top of piece</span>
            <span className="text-right">{formatLength(resolved.topY, units)}</span>
            <span className="text-ink-500">Access needed</span>
            <span className="text-right">
              {prior.accessClearance > 0 ? `${formatLength(prior.accessClearance, units)} ${prior.accessSide.replace(/-/g, ' ')}` : 'none'}
            </span>
          </div>
        </div>

        {relatedFindings.length > 0 && (
          <div>
            <div className="rule-label mb-1.5">What the checks say</div>
            <ul className="space-y-1.5">
              {relatedFindings.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    'rounded-md border-l-2 bg-ink-900/60 px-2.5 py-1.5 text-[12px] leading-snug',
                    f.severity === 'blocker' && 'border-signal-red text-ink-200',
                    f.severity === 'warning' && 'border-signal-amber text-ink-200',
                    f.severity === 'note' && 'border-signal-blue text-ink-300',
                  )}
                >
                  <div className="font-medium">{f.title}</div>
                  <div className="mt-0.5 text-ink-400">{f.detail}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Notes" hint="Anything you would forget by the next time you move it.">
          <textarea
            value={item.notes ?? ''}
            onChange={(e) => void updateInventoryItem(item.id, { notes: e.target.value })}
            rows={3}
            placeholder="Needs two people. Back is unfinished. Legs mark the floor."
            className="w-full resize-none rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-100 placeholder:text-ink-600 focus:border-brass-500 focus:outline-none"
          />
        </Field>

        {item.sourcePhotoId && (
          <div className="flex items-start gap-2 rounded-md bg-ink-900/60 p-2.5 text-[11.5px] leading-relaxed text-ink-400">
            <Info size={13} className="mt-0.5 shrink-0 text-ink-500" />
            <span>
              Reconstructed from a photograph. Width and position were measured from the floor
              contact line; depth was inferred from the category, because one photo cannot see the
              far side. Correct it above if you know better.
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}
