'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, Printer, Route, Users } from 'lucide-react';
import { Badge, Button, Panel, Stat, cn } from '@/components/ui/primitives';
import { buildMovePlan } from '@/lib/constraints/moveplan';
import { formatDuration, formatLength, formatMass } from '@/lib/format';
import { inventoryMap, useStudio } from '@/lib/store/studio';
import type { Layout } from '@/lib/domain/types';

const KIND_LABEL: Record<string, string> = {
  move: 'Move',
  rotate: 'Turn',
  stage: 'Park',
  return: 'Put back',
  introduce: 'Bring in',
  remove: 'Take out',
};

export function MovePlanPanel() {
  const layouts = useStudio((s) => s.layouts);
  const roomId = useStudio((s) => s.roomId);
  const layoutId = useStudio((s) => s.layoutId);
  const layoutItems = useStudio((s) => s.layoutItems);
  const inventory = useStudio((s) => s.inventory);
  const features = useStudio((s) => s.features);
  const project = useStudio((s) => s.project);
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const setSelection = useStudio((s) => s.setSelection);

  const units = project?.unitSystem ?? 'metric';
  const roomLayouts = layouts.filter((l) => l.roomId === roomId);
  const source = roomLayouts.find((l) => l.isCurrent) ?? roomLayouts[0] ?? null;

  const plan = useMemo(() => {
    if (!room || !source || !layoutId) return null;
    const target: Layout = {
      ...(layouts.find((l) => l.id === layoutId) ?? source),
      items: layoutItems,
    };
    if (target.id === source.id) return null;
    return buildMovePlan({
      room,
      features,
      from: source,
      to: target,
      inventory: inventoryMap(inventory),
    });
  }, [room, source, layoutId, layouts, layoutItems, features, inventory]);

  if (!plan) {
    return (
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <Route size={12} /> Move plan
          </span>
        }
        className="min-h-0"
      >
        <div className="p-3 text-[12.5px] leading-relaxed text-ink-400">
          {source && layoutId === source.id
            ? `You are looking at "${source.name}", which is marked as how the room actually is. Open a different arrangement and this becomes an ordered list of what to shift, in what order, and roughly how long it will take.`
            : 'Mark one arrangement as the live one, then open another to get step-by-step instructions.'}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Route size={12} /> Move plan
        </span>
      }
      action={
        <Link href={`/plan?layout=${layoutId}&from=${source?.id ?? ''}`} target="_blank">
          <Button size="sm" variant="subtle">
            <Printer size={12} /> Print
          </Button>
        </Link>
      }
      className="min-h-0"
    >
      <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-4">
        <Stat label="Time" value={formatDuration(plan.totalMinutes)} hint="Rough, assuming nothing goes wrong" />
        <Stat
          label="People"
          value={
            <span className="flex items-center gap-1">
              <Users size={13} /> {plan.peopleNeeded}
            </span>
          }
          tone={plan.peopleNeeded > 1 ? 'fair' : 'good'}
        />
        <Stat label="Carrying" value={formatLength(plan.totalDistanceM, units)} hint="Total distance things travel" />
        <Stat label="Heaviest" value={formatMass(plan.heaviestKg, units)} />
      </div>

      {plan.warnings.length > 0 && (
        <div className="mx-2 mb-2 space-y-1 rounded-md border border-signal-amber/30 bg-signal-amber/10 p-2.5">
          {plan.warnings.map((w, i) => (
            <div key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-signal-amber">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {plan.steps.map((step) => (
          <li
            key={`${step.order}-${step.itemId}`}
            onMouseEnter={() => setSelection([step.itemId])}
            className="mb-1 flex gap-2.5 rounded-md border border-[color:var(--hairline)] bg-ink-900/50 p-2.5 hover:border-brass-500/40"
          >
            <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] text-ink-300">
              {step.order}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={step.kind === 'stage' ? 'warn' : 'neutral'}>
                  {KIND_LABEL[step.kind] ?? step.kind}
                </Badge>
                <span className="text-[12.5px] font-medium text-ink-100">{step.label}</span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-300">{step.instruction}</p>
              <div className="tabular mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-ink-500">
                {step.distanceM > 0 && <span>{formatLength(step.distanceM, units)}</span>}
                {Math.abs(step.rotationDeg) > 2 && <span>{Math.abs(step.rotationDeg)}° turn</span>}
                <span>{formatDuration(step.minutes)}</span>
                <span>{formatMass(step.massKg, units)}</span>
                {step.people > 1 && (
                  <span className="text-signal-amber">{step.people} people</span>
                )}
              </div>
              {step.tightSqueeze && (
                <div
                  className={cn(
                    'mt-1.5 rounded bg-signal-amber/10 px-2 py-1 text-[11px] leading-snug text-signal-amber',
                  )}
                >
                  Route narrows to {formatLength(step.tightSqueeze.routeWidthM, units)} but the piece
                  is {formatLength(step.tightSqueeze.itemWidthM, units)} across. Turn it on edge.
                </div>
              )}
            </div>
          </li>
        ))}
        {plan.steps.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] text-ink-500">
            Nothing has moved between these two arrangements.
          </div>
        )}
      </ol>

      <footer className="border-t border-[color:var(--hairline)] px-3 py-2 text-[11px] text-ink-500">
        {plan.unchanged} pieces stay exactly where they are.
      </footer>
    </Panel>
  );
}
