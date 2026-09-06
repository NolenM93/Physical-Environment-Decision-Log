'use client';

/**
 * The only studio chrome. The floor is the product: switch the setup, drag
 * furniture, add a piece, fix what is wrong. Everything else stays in a tray.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { nanoid } from 'nanoid';
import {
  AlertTriangle,
  Box,
  Check,
  ClipboardList,
  Grid2x2,
  MoreHorizontal,
  Plus,
  Printer,
  Redo2,
  Route,
  Square,
  Undo2,
  X,
} from 'lucide-react';
import { Button, Segmented, cn } from '@/components/ui/primitives';
import { PlanCanvas } from '@/components/studio/PlanCanvas';
import { FindingsPanel } from '@/components/studio/FindingsPanel';
import { MovePlanPanel } from '@/components/studio/MovePlanPanel';
import { DoorChip, RoomEditor, RoomSizeButton } from '@/components/studio/RoomEditor';
import { BeoPanel } from '@/components/studio/BeoPanel';
import { CATEGORY_KEYS, ROOM_CATEGORY_HINTS, estimateMass, priorFor } from '@/lib/domain/catalog';
import type { Evaluation } from '@/lib/constraints/evaluate';
import type {
  FurnitureCategory,
  InventoryItem,
  Layout,
  Room,
  RoomFeature,
  SetupKind,
} from '@/lib/domain/types';
import { polygonCentroid } from '@/lib/geometry/shapes';
import { v3 } from '@/lib/geometry/vec';
import { useStudio } from '@/lib/store/studio';

const Scene3D = dynamic(() => import('@/components/studio/Scene3D').then((m) => m.Scene3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-ink-500">
      Opening the room…
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

type Tray = 'add' | 'fix' | 'flip' | 'room' | 'beo';

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

function tabLabel(layout: Layout) {
  if (layout.setupKind) return SETUP_LABEL[layout.setupKind];
  return layout.name.replace(/\s*\(rejected\)\s*$/i, '');
}

function isStanding(kind: SetupKind | undefined) {
  return kind === 'reception' || kind === 'cocktail' || kind === 'dance';
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
  const layouts = useStudio((s) => s.layouts);
  const layoutId = useStudio((s) => s.layoutId);
  const selectLayout = useStudio((s) => s.selectLayout);
  const dirty = useStudio((s) => s.dirty);
  const project = useStudio((s) => s.project);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);

  const [tray, setTray] = useState<Tray | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [addingCorner, setAddingCorner] = useState(false);
  const temporal = useTemporal();

  const setups = useMemo(() => {
    if (event) {
      return event.setupIds
        .map((id) => layouts.find((l) => l.id === id))
        .filter((l): l is Layout => Boolean(l));
    }
    return layouts
      .filter((l) => l.roomId === room.id && !/\(rejected\)/i.test(l.name))
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [event, layouts, room.id]);

  const layout = layouts.find((l) => l.id === layoutId);
  const blockers = evaluation.findings.filter((f) => f.severity === 'blocker').length;
  const warnings = evaluation.findings.filter((f) => f.severity === 'warning').length;
  const issues = blockers + warnings;
  const covers = evaluation.metrics.covers ?? 0;
  const aisle = evaluation.metrics.aisleM;
  const standing = isStanding(layout?.setupKind);
  const setupIndex = layoutId ? setups.findIndex((s) => s.id === layoutId) : -1;
  const canFlip = Boolean(event ? setupIndex > 0 : setups.length > 1 && layout && !layout.isCurrent);

  const toggleTray = (next: Tray) => setTray((cur) => (cur === next ? null : next));

  const title = event?.name ?? project?.name ?? 'Room';
  const subtitle = event
    ? `${event.beoNumber ? `${event.beoNumber} · ` : ''}${prettyDate(event.dateISO)} · ${event.guestCount} guests`
    : room.name;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5" title="All rooms">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brass-500 text-[15px] font-semibold text-ink-950">
            S
          </span>
        </Link>
        <div className="min-w-0">
          <div className="truncate text-[16px] font-medium tracking-tight text-ink-50">{title}</div>
          <div className="truncate text-[12px] text-ink-500">{subtitle}</div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className={cn('tabular mr-1 text-[11px]', dirty ? 'text-brass-400' : 'text-ink-600')}>
            {dirty ? 'Saving…' : 'Saved'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!temporal.pastStates.length}
            onClick={() => temporal.undo()}
            title="Undo"
          >
            <Undo2 size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!temporal.futureStates.length}
            onClick={() => temporal.redo()}
            title="Redo"
          >
            <Redo2 size={15} />
          </Button>
          <Segmented
            value={view === 'perspective' ? 'perspective' : 'plan'}
            onChange={(v) => setView(v)}
            options={[
              { value: 'plan', label: <><Grid2x2 size={13} /> Floor</>, title: 'Scaled floor plan' },
              { value: 'perspective', label: <><Box size={13} /> 3D</>, title: 'Walk the room' },
            ]}
          />
          <div className="relative">
            <Button
              size="sm"
              variant={moreOpen ? 'subtle' : 'ghost'}
              onClick={() => setMoreOpen((v) => !v)}
              title="More"
            >
              <MoreHorizontal size={16} />
            </Button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div className="panel absolute right-0 top-9 z-20 w-52 p-1.5">
                  {canFlip && (
                    <MoreItem
                      onClick={() => {
                        setTray('flip');
                        setMoreOpen(false);
                      }}
                    >
                      <Route size={14} /> What to move
                    </MoreItem>
                  )}
                  {event && (
                    <Link href={`/beo?event=${event.id}`} target="_blank" onClick={() => setMoreOpen(false)}>
                      <MoreItem>
                        <ClipboardList size={14} /> Print BEO
                      </MoreItem>
                    </Link>
                  )}
                  {layoutId && (
                    <Link href={`/plan?layout=${layoutId}`} target="_blank" onClick={() => setMoreOpen(false)}>
                      <MoreItem>
                        <Printer size={14} /> Print this plan
                      </MoreItem>
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {setups.length > 1 && (
        <nav className="flex shrink-0 gap-1 px-4 pb-3">
          {setups.map((setup) => {
            const active = setup.id === layoutId;
            return (
              <button
                key={setup.id}
                onClick={() => {
                  selectLayout(setup.id);
                  setTray(null);
                }}
                className={cn(
                  'flex-1 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors',
                  active
                    ? 'bg-brass-500 text-ink-950'
                    : 'bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-50',
                )}
              >
                <span className="truncate">{tabLabel(setup)}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
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
              <p className="pointer-events-none absolute left-4 top-4 text-[12px] text-ink-500">
                Drag empty space to look around. Click a piece to move it.
              </p>
            </>
          ) : (
            <PlanCanvas
              room={room}
              features={features}
              evaluation={evaluation}
              ghostLayout={ghostLayout}
              inventory={inventory}
              simpleHints
              selectedFeatureId={selectedFeatureId}
              onSelectFeature={setSelectedFeatureId}
              addingCorner={addingCorner}
              onAddedCorner={() => setAddingCorner(false)}
            />
          )}

          <div className="absolute right-4 top-4 flex w-[200px] flex-col items-stretch gap-2">
            <RoomSizeButton
              onClick={() => {
                setView('plan');
                toggleTray('room');
              }}
            />
            <StatusCard
              standing={Boolean(event && standing)}
              covers={covers}
              guestCount={event?.guestCount}
              aisle={aisle}
              issues={issues}
              onFix={() => toggleTray('fix')}
            />
          </div>

          <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-2">
            <Button size="lg" variant="primary" onClick={() => toggleTray('add')}>
              <Plus size={16} /> Add furniture
            </Button>
            {event && (
              <Button size="lg" variant={tray === 'beo' ? 'primary' : 'subtle'} onClick={() => toggleTray('beo')}>
                <ClipboardList size={15} /> Event sheet
              </Button>
            )}
            <Button
              size="lg"
              variant={tray === 'room' ? 'primary' : 'subtle'}
              onClick={() => {
                setView('plan');
                toggleTray('room');
              }}
            >
              <Square size={15} /> Edit room
            </Button>
            {canFlip && (
              <Button size="lg" variant="subtle" onClick={() => toggleTray('flip')}>
                <Route size={15} /> What to move
              </Button>
            )}
            {selectedFeatureId ? (
              <DoorChip featureId={selectedFeatureId} onClose={() => setSelectedFeatureId(null)} />
            ) : (
              <SelectedChip />
            )}
          </div>
        </main>

        {tray && (
          <aside className="flex w-[min(360px,100%)] shrink-0 flex-col border-l border-[color:var(--hairline)] bg-ink-900">
            <div className="flex h-12 shrink-0 items-center justify-between px-4">
              <span className="text-[14px] font-medium text-ink-100">
                {tray === 'add' && 'Add furniture'}
                {tray === 'fix' && (issues ? `${issues} to fix` : 'Looks good')}
                {tray === 'flip' && 'What to move'}
                {tray === 'room' && 'Edit the room'}
                {tray === 'beo' && 'Event sheet'}
              </span>
              <button
                onClick={() => setTray(null)}
                className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 px-2 pb-3">
              {tray === 'add' && <FurnitureTray />}
              {tray === 'fix' && <FindingsPanel evaluation={evaluation} simple />}
              {tray === 'flip' && <MovePlanPanel simple />}
              {tray === 'beo' && <BeoPanel evaluation={evaluation} />}
              {tray === 'room' && (
                <RoomEditor
                  selectedFeatureId={selectedFeatureId}
                  onSelectFeature={setSelectedFeatureId}
                  addingCorner={addingCorner}
                  onToggleCorner={() => setAddingCorner((v) => !v)}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function MoreItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-200 hover:bg-ink-800 hover:text-ink-50"
    >
      {children}
    </button>
  );
}

function StatusCard({
  standing,
  covers,
  guestCount,
  aisle,
  issues,
  onFix,
}: {
  standing: boolean;
  covers: number;
  guestCount?: number;
  aisle?: number;
  issues: number;
  onFix: () => void;
}) {
  const seatsOk = guestCount != null && covers >= guestCount;
  const walkOk = aisle != null && aisle >= 1.8;
  const walkTight = aisle != null && aisle > 0 && aisle < 1.8;

  return (
    <div className="rounded-2xl border border-[color:var(--hairline)] bg-ink-900/95 p-3 shadow-lg backdrop-blur">
      {guestCount != null &&
        (standing ? (
          <div className="text-[13px] text-ink-200">Standing reception</div>
        ) : (
          <div className="text-[13px]">
            <span className={cn('tabular font-medium', seatsOk ? 'text-signal-green' : 'text-signal-red')}>
              {covers}
            </span>
            <span className="text-ink-400"> of {guestCount} seats</span>
          </div>
        ))}
      <div className="mt-1 text-[13px]">
        <span className="text-ink-500">Walkway </span>
        <span
          className={cn(
            'tabular font-medium',
            walkOk ? 'text-signal-green' : walkTight ? 'text-signal-amber' : 'text-signal-red',
          )}
        >
          {aisle && aisle > 0 ? `${Math.round(aisle * 100)} cm` : 'blocked'}
        </span>
      </div>
      {issues > 0 ? (
        <button
          onClick={onFix}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-signal-amber/15 px-2 py-1.5 text-[13px] font-medium text-signal-amber hover:bg-signal-amber/25"
        >
          <AlertTriangle size={13} />
          {issues} to fix
        </button>
      ) : (
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-signal-green">
          <Check size={13} /> Looks good
        </div>
      )}
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
    <div className="flex items-center gap-2 rounded-xl border border-[color:var(--hairline)] bg-ink-900/95 px-3 py-2 shadow-lg">
      <span className="h-3.5 w-3.5 rounded-sm" style={{ background: item.color }} />
      <span className="text-[14px] text-ink-100">{item.label}</span>
      <Button size="sm" variant="ghost" onClick={() => rotateItem(item.id, placed.rotation + Math.PI / 2)}>
        Turn
      </Button>
      <Button size="sm" variant="ghost" onClick={() => removeFromLayout(item.id)}>
        Remove
      </Button>
      <button
        onClick={() => setSelection([])}
        className="rounded p-1 text-ink-500 hover:text-ink-100"
        title="Deselect"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FurnitureTray() {
  const inventory = useStudio((s) => s.inventory);
  const layoutItems = useStudio((s) => s.layoutItems);
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const project = useStudio((s) => s.project);
  const placeInLayout = useStudio((s) => s.placeInLayout);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);
  const addInventoryItem = useStudio((s) => s.addInventoryItem);
  const [addingNew, setAddingNew] = useState(false);
  const [draftCategory, setDraftCategory] = useState<FurnitureCategory>('armchair');

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

  const suggestions = room ? ROOM_CATEGORY_HINTS[room.kind] : CATEGORY_KEYS;

  const createNew = async () => {
    if (!project || !room) return;
    const prior = priorFor(draftCategory);
    const size = v3(prior.size[0], prior.size[1], prior.size[2]);
    const item: InventoryItem = {
      id: nanoid(10),
      projectId: project.id,
      label: prior.label,
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
    placeInLayout(item.id, polygonCentroid(room.footprint));
    setAddingNew(false);
  };

  return (
    <div className="flex h-full flex-col">
      <p className="px-2 pb-3 text-[13px] leading-relaxed text-ink-400">
        Add a piece to the middle of the room, then drag it into place.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => {
          const next = group.items.find((i) => !layoutItems.some((p) => p.itemId === i.id));
          const last = [...group.items].reverse().find((i) =>
            layoutItems.some((p) => p.itemId === i.id),
          );
          return (
            <div key={group.key} className="mb-1 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-ink-800">
              <span
                className="h-8 w-8 shrink-0 rounded-md border border-[color:var(--hairline)]"
                style={{ background: group.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-ink-100">{group.label}</div>
                <div className="tabular text-[12px] text-ink-500">
                  {group.onPlan} on the floor
                  {group.items.length > 1 ? ` · ${group.items.length} in stock` : ''}
                </div>
              </div>
              {last && (
                <button
                  onClick={() => removeFromLayout(last.id)}
                  className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-500 hover:bg-ink-700 hover:text-ink-100"
                >
                  Remove
                </button>
              )}
              <button
                disabled={!next || !room}
                onClick={() => next && room && placeInLayout(next.id, polygonCentroid(room.footprint))}
                className="rounded-lg bg-brass-500/15 px-2.5 py-1.5 text-[13px] font-medium text-brass-300 hover:bg-brass-500/25 disabled:opacity-30"
              >
                Add
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[color:var(--hairline)] px-2 pt-2">
        {addingNew ? (
          <div className="space-y-2 pb-1">
            <div className="flex flex-wrap gap-1">
              {suggestions.slice(0, 8).map((c) => (
                <button
                  key={c}
                  onClick={() => setDraftCategory(c)}
                  className={cn(
                    'rounded-lg px-2 py-1 text-[12px]',
                    draftCategory === c
                      ? 'bg-brass-500/20 text-brass-300'
                      : 'bg-ink-800 text-ink-400 hover:text-ink-100',
                  )}
                >
                  {priorFor(c).label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => void createNew()}>
                Add to room
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingNew(true)}
            className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          >
            + Something else
          </button>
        )}
      </div>
    </div>
  );
}
