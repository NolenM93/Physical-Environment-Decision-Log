'use client';

/**
 * The banquet chrome. One job on screen: the floor. Everything else waits
 * behind a single tray so a new hire can learn the room before the log.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  Box,
  Check,
  GitCompare,
  Grid2x2,
  Lock,
  Package,
  Printer,
  Redo2,
  Route,
  Undo2,
  X,
} from 'lucide-react';
import { Badge, Button, Segmented, cn } from '@/components/ui/primitives';
import { PlanCanvas } from '@/components/studio/PlanCanvas';
import { FindingsPanel } from '@/components/studio/FindingsPanel';
import { DecisionLog } from '@/components/studio/DecisionLog';
import { ComparePanel } from '@/components/studio/ComparePanel';
import { MovePlanPanel } from '@/components/studio/MovePlanPanel';
import type { Evaluation } from '@/lib/constraints/evaluate';
import type { InventoryItem, Layout, Room, RoomFeature, SetupKind } from '@/lib/domain/types';
import { polygonCentroid } from '@/lib/geometry/shapes';
import { useStudio } from '@/lib/store/studio';

const Scene3D = dynamic(() => import('@/components/studio/Scene3D').then((m) => m.Scene3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[12px] text-ink-500">
      opening the room…
    </div>
  ),
});

const SETUP_LABEL: Record<SetupKind, string> = {
  ceremony: 'Ceremony',
  cocktail: 'Reception',
  reception: 'Reception',
  dinner: 'Dinner',
  dance: 'Dance',
  reset: 'House set',
  other: 'Setup',
};

type Tray = 'add' | 'fix' | 'why' | 'flip' | 'compare';

function useTemporal() {
  const [state, setState] = useState(() => useStudio.temporal.getState());
  useEffect(() => useStudio.temporal.subscribe(setState), []);
  return state;
}

function prettyDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function BanquetStudio({
  evaluation,
  room,
  features,
  ghostLayout,
  inventory,
}: {
  evaluation: Evaluation;
  room: Room;
  features: RoomFeature[];
  ghostLayout: Layout | null;
  inventory: Map<string, InventoryItem>;
}) {
  const event = useStudio((s) => s.events.find((e) => e.id === s.eventId) ?? null);
  const studioMode = useStudio((s) => s.studioMode);
  const setStudioMode = useStudio((s) => s.setStudioMode);
  const layouts = useStudio((s) => s.layouts);
  const layoutId = useStudio((s) => s.layoutId);
  const decisions = useStudio((s) => s.decisions);
  const selectLayout = useStudio((s) => s.selectLayout);
  const forkLayout = useStudio((s) => s.forkLayout);
  const setCompare = useStudio((s) => s.setCompare);
  const issueEvent = useStudio((s) => s.issueEvent);
  const executeEvent = useStudio((s) => s.executeEvent);
  const dirty = useStudio((s) => s.dirty);
  const project = useStudio((s) => s.project);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);

  const [tray, setTray] = useState<Tray | null>(studioMode === 'ops' ? 'flip' : null);
  const [prevMode, setPrevMode] = useState(studioMode);
  if (studioMode !== prevMode) {
    setPrevMode(studioMode);
    setTray(studioMode === 'ops' ? 'flip' : null);
  }

  const temporal = useTemporal();

  if (!event) return null;

  const setups = event.setupIds
    .map((id) => layouts.find((l) => l.id === id))
    .filter((l): l is Layout => Boolean(l));
  const extras = layouts.filter(
    (l) => l.eventId === event.id && !event.setupIds.includes(l.id),
  );
  const layout = layouts.find((l) => l.id === layoutId);
  const blockers = evaluation.findings.filter((f) => f.severity === 'blocker').length;
  const warnings = evaluation.findings.filter((f) => f.severity === 'warning').length;
  const covers = evaluation.metrics.covers ?? 0;
  const aisle = evaluation.metrics.aisleM;

  const toggleTray = (next: Tray) => setTray((cur) => (cur === next ? null : next));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[color:var(--hairline)] px-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-brass-500 text-[13px] font-semibold text-ink-950">
            S
          </span>
        </Link>
        <div className="min-w-0">
          <div className="truncate text-[14px] text-ink-50">
            {event.name}
            <span className="text-ink-500"> · {event.clientName}</span>
          </div>
          <div className="truncate text-[11px] text-ink-500">
            {project?.name} · {room.name} · {prettyDate(event.dateISO)} · {event.guestCount} guests
          </div>
        </div>
        <Badge
          tone={
            event.status === 'issued' || event.status === 'executed' ? 'good' : 'neutral'
          }
        >
          {event.status}
        </Badge>

        <div className="ml-auto flex items-center gap-1.5">
          <span className={cn('tabular mr-1 text-[11px]', dirty ? 'text-brass-400' : 'text-ink-600')}>
            {dirty ? 'saving…' : 'saved'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!temporal.pastStates.length}
            onClick={() => temporal.undo()}
            title="Undo"
          >
            <Undo2 size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!temporal.futureStates.length}
            onClick={() => temporal.redo()}
            title="Redo"
          >
            <Redo2 size={14} />
          </Button>
          <Segmented
            value={view === 'perspective' ? 'perspective' : 'plan'}
            onChange={(v) => setView(v)}
            options={[
              { value: 'plan', label: <Grid2x2 size={13} />, title: 'Floor plan' },
              { value: 'perspective', label: <Box size={13} />, title: 'Walk the room' },
            ]}
          />
          <Segmented
            value={studioMode}
            onChange={setStudioMode}
            options={[
              { value: 'sales', label: 'Sales', title: 'Propose a setup' },
              { value: 'ops', label: 'Ops', title: 'Run the flip' },
            ]}
          />
          {layoutId && (
            <Link href={`/plan?layout=${layoutId}`} target="_blank">
              <Button size="sm" variant="subtle">
                <Printer size={13} /> Print
              </Button>
            </Link>
          )}
          {studioMode === 'sales' && event.status !== 'executed' && (
            <Button
              size="sm"
              variant="primary"
              disabled={event.status === 'issued'}
              onClick={() => void issueEvent(evaluation.metrics)}
            >
              <Lock size={12} /> {event.status === 'issued' ? 'Issued' : 'Issue to ops'}
            </Button>
          )}
          {studioMode === 'ops' && event.status === 'issued' && (
            <Button size="sm" variant="primary" onClick={() => void executeEvent()}>
              <Check size={12} /> Mark done
            </Button>
          )}
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[color:var(--hairline)] px-3 py-2">
        <ol className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {setups.map((setup, i) => {
            const active = setup.id === layoutId;
            const verdict = [...decisions].reverse().find((d) => d.layoutId === setup.id)?.verdict;
            return (
              <li key={setup.id} className="flex items-center gap-1">
                {i > 0 && <span className="px-1 text-[11px] text-ink-600">→</span>}
                <button
                  onClick={() => selectLayout(setup.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-[13px] transition-colors',
                    active
                      ? 'bg-brass-500/20 text-ink-50 ring-1 ring-brass-500/50'
                      : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100',
                  )}
                >
                  {setup.setupKind ? SETUP_LABEL[setup.setupKind] : setup.name}
                  {verdict === 'adopted' && <span className="ml-1.5 text-signal-green">✓</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {extras
          .filter((l) => !layout?.setupKind || l.setupKind === layout.setupKind)
          .map((l) => {
            const verdict = [...decisions].reverse().find((d) => d.layoutId === l.id)?.verdict;
            return (
              <button
                key={l.id}
                onClick={() => {
                  selectLayout(l.id);
                  setCompare(null);
                }}
                className={cn(
                  'rounded px-2 py-0.5 text-[12px] hover:bg-ink-800',
                  l.id === layoutId ? 'text-ink-100' : 'text-ink-500',
                )}
              >
                {l.name.replace(/^Dinner — /, '').replace(/\s*\(rejected\)\s*$/i, '')}
                {verdict === 'rejected' && <span className="ml-1 text-signal-red">rejected</span>}
              </button>
            );
          })}
        {studioMode === 'sales' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void forkLayout(layout ? `${layout.name} — try again` : 'Variant')}
          >
            Try another
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3 text-[13px]">
          <span>
            {layout?.setupKind === 'reception' || layout?.setupKind === 'cocktail' ? (
              <span className="text-ink-400">Standing reception</span>
            ) : (
              <>
                <span className="text-ink-500">Covers </span>
                <span
                  className={cn(
                    'tabular font-medium',
                    covers >= event.guestCount ? 'text-signal-green' : 'text-signal-red',
                  )}
                >
                  {covers}/{event.guestCount}
                </span>
              </>
            )}
          </span>
          <span>
            <span className="text-ink-500">Aisle </span>
            <span
              className={cn(
                'tabular font-medium',
                aisle && aisle >= 1.8 ? 'text-signal-green' : 'text-signal-amber',
              )}
            >
              {aisle && aisle > 0 ? `${Math.round(aisle * 100)} cm` : 'blocked'}
            </span>
          </span>
          {(blockers > 0 || warnings > 0) && (
            <button
              onClick={() => toggleTray('fix')}
              className="flex items-center gap-1.5 text-signal-amber hover:text-ink-50"
            >
              <AlertTriangle size={13} />
              {blockers + warnings} to fix
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {view === 'perspective' ? (
              <>
                <Scene3D
                  room={room}
                  features={features}
                  evaluation={evaluation}
                  ghostLayout={ghostLayout}
                  inventory={inventory}
                  quiet
                />
                <div className="pointer-events-none absolute left-3 top-3 text-[11px] text-ink-500">
                  Drag empty space to look · click a table to move it · WASD to walk
                </div>
              </>
            ) : (
              <PlanCanvas
                room={room}
                features={features}
                evaluation={evaluation}
                ghostLayout={ghostLayout}
                inventory={inventory}
                simpleHints
              />
            )}
            <SelectedChip />
          </div>
        </main>

        {tray && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-[color:var(--hairline)]">
            <div className="flex h-9 shrink-0 items-center justify-between px-3">
              <span className="text-[12px] text-ink-400">
                {tray === 'add' && 'Add furniture'}
                {tray === 'fix' && 'What to fix'}
                {tray === 'why' && 'Why this layout'}
                {tray === 'flip' && 'Tonight’s flip'}
                {tray === 'compare' && 'Compare'}
              </span>
              <button
                onClick={() => setTray(null)}
                className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 px-2 pb-2">
              {tray === 'add' && <BanquetStock />}
              {tray === 'fix' && <FindingsPanel evaluation={evaluation} />}
              {tray === 'why' && <DecisionLog evaluation={evaluation} />}
              {tray === 'flip' && <MovePlanPanel />}
              {tray === 'compare' && <ComparePanel evaluation={evaluation} />}
            </div>
          </aside>
        )}
      </div>

      <nav className="flex h-11 shrink-0 items-center gap-1 border-t border-[color:var(--hairline)] px-2">
        {(
          [
            ['add', 'Add furniture', Package],
            ['fix', blockers + warnings ? `Fix (${blockers + warnings})` : 'Problems', AlertTriangle],
            ['why', 'Why we chose this', Check],
            ['flip', 'Flip list', Route],
            ['compare', 'Compare', GitCompare],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => toggleTray(key)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12.5px]',
              tray === key ? 'bg-ink-800 text-ink-50' : 'text-ink-500 hover:text-ink-200',
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function SelectedChip() {
  const selection = useStudio((s) => s.selection);
  const inventory = useStudio((s) => s.inventory);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);
  const rotateItem = useStudio((s) => s.rotateItem);
  const layoutItems = useStudio((s) => s.layoutItems);
  const setSelection = useStudio((s) => s.setSelection);
  const id = selection[0];
  const item = inventory.find((i) => i.id === id);
  const placed = layoutItems.find((p) => p.itemId === id);
  if (!item || !placed) return null;

  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-[color:var(--hairline)] bg-ink-900/95 px-3 py-2 shadow-lg">
      <span className="h-3 w-3 rounded-sm" style={{ background: item.color }} />
      <span className="text-[13px] text-ink-100">{item.label}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => rotateItem(item.id, placed.rotation + Math.PI / 2)}
      >
        Turn 90°
      </Button>
      <Button size="sm" variant="ghost" onClick={() => removeFromLayout(item.id)}>
        Take off plan
      </Button>
      <button
        onClick={() => setSelection([])}
        className="rounded p-1 text-ink-500 hover:text-ink-100"
        title="Deselect"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function BanquetStock() {
  const inventory = useStudio((s) => s.inventory);
  const layoutItems = useStudio((s) => s.layoutItems);
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const placeInLayout = useStudio((s) => s.placeInLayout);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);

  const groups = useMemo(() => {
    const placed = new Set(layoutItems.map((p) => p.itemId));
    const map = new Map<
      string,
      { key: string; label: string; color: string; items: InventoryItem[]; onPlan: number }
    >();
    for (const item of inventory) {
      const key = item.sku ?? item.id;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
        if (placed.has(item.id)) existing.onPlan += 1;
      } else {
        map.set(key, {
          key,
          label: item.label.replace(/\s+\d+$/, ''),
          color: item.color,
          items: [item],
          onPlan: placed.has(item.id) ? 1 : 0,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  }, [inventory, layoutItems]);

  return (
    <div className="flex h-full flex-col">
      <p className="px-2 pb-2 text-[12px] leading-relaxed text-ink-400">
        House stock. Place one more of a kind, or take one off the plan.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => {
          const next = group.items.find((i) => !layoutItems.some((p) => p.itemId === i.id));
          const last = [...group.items].reverse().find((i) =>
            layoutItems.some((p) => p.itemId === i.id),
          );
          return (
            <div key={group.key} className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 hover:bg-ink-800">
              <span className="h-6 w-6 shrink-0 rounded border border-[color:var(--hairline)]" style={{ background: group.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink-100">{group.label}</div>
                <div className="tabular text-[11px] text-ink-500">
                  {group.onPlan} of {group.items.length} on the plan
                </div>
              </div>
              {last && (
                <button
                  onClick={() => removeFromLayout(last.id)}
                  className="rounded px-2 py-1 text-[11px] text-ink-500 hover:text-signal-red"
                >
                  −1
                </button>
              )}
              <button
                disabled={!next || !room}
                onClick={() => next && room && placeInLayout(next.id, polygonCentroid(room.footprint))}
                className="rounded bg-ink-800 px-2 py-1 text-[11px] text-brass-300 hover:bg-ink-700 disabled:opacity-30"
              >
                +1
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
