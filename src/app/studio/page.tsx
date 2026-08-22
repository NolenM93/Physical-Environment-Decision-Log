'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BookMarked, ChevronDown, ChevronUp, GitCompare, Route, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button, cn } from '@/components/ui/primitives';
import { TopBar } from '@/components/studio/TopBar';
import { LayoutRail } from '@/components/studio/LayoutRail';
import { InventoryPanel } from '@/components/studio/InventoryPanel';
import { Inspector } from '@/components/studio/Inspector';
import { FindingsPanel, ReadoutStrip } from '@/components/studio/FindingsPanel';
import { DecisionLog } from '@/components/studio/DecisionLog';
import { ComparePanel } from '@/components/studio/ComparePanel';
import { MovePlanPanel } from '@/components/studio/MovePlanPanel';
import { RoomPanel } from '@/components/studio/RoomPanel';
import { PlanCanvas } from '@/components/studio/PlanCanvas';
import { PhotoMatch } from '@/components/studio/PhotoMatch';
import { useEvaluation } from '@/lib/hooks/useEvaluation';
import { inventoryMap, useStudio } from '@/lib/store/studio';
import { v2 } from '@/lib/geometry/vec';
import { DEMO_PROJECT_ID, seedDemoProject } from '@/lib/db/seed';
import { db } from '@/lib/db';

const Scene3D = dynamic(() => import('@/components/studio/Scene3D').then((m) => m.Scene3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[12px] text-ink-500">
      preparing the three-dimensional view…
    </div>
  ),
});

type Drawer = 'decisions' | 'compare' | 'move';

function StudioInner() {
  const params = useSearchParams();
  const router = useRouter();
  const ready = useStudio((s) => s.ready);
  const projectId = useStudio((s) => s.projectId);
  const loadProject = useStudio((s) => s.loadProject);
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const features = useStudio((s) => s.features);
  const inventory = useStudio((s) => s.inventory);
  const layouts = useStudio((s) => s.layouts);
  const compareLayoutId = useStudio((s) => s.compareLayoutId);
  const view = useStudio((s) => s.view);
  const selection = useStudio((s) => s.selection);
  const nudgeSelection = useStudio((s) => s.nudgeSelection);
  const rotateSelection = useStudio((s) => s.rotateSelection);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);
  const setView = useStudio((s) => s.setView);
  const toggleOverlay = useStudio((s) => s.toggleOverlay);

  const [drawer, setDrawer] = useState<Drawer>('decisions');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'inspector' | 'room'>('inspector');

  const evaluation = useEvaluation();

  // Resolve which project to open: query string, most recent, or the demo.
  useEffect(() => {
    const wanted = params.get('project');
    if (projectId && (!wanted || wanted === projectId)) return;
    void (async () => {
      if (wanted) {
        await loadProject(wanted);
        return;
      }
      const existing = await db().projects.orderBy('updatedAt').reverse().first();
      if (existing) {
        await loadProject(existing.id);
        router.replace(`/studio?project=${existing.id}`);
      } else {
        const id = await seedDemoProject();
        await loadProject(id);
        router.replace(`/studio?project=${id}`);
      }
    })();
  }, [params, projectId, loadProject, router]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const temporal = useStudio.temporal.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) temporal.redo();
        else temporal.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        temporal.redo();
        return;
      }

      const step = e.shiftKey ? 0.25 : 0.02;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          nudgeSelection(v2(-step, 0));
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudgeSelection(v2(step, 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          nudgeSelection(v2(0, -step));
          break;
        case 'ArrowDown':
          e.preventDefault();
          nudgeSelection(v2(0, step));
          break;
        case 'r':
        case 'R':
          rotateSelection(((e.shiftKey ? -15 : 15) * Math.PI) / 180);
          break;
        case 'Delete':
        case 'Backspace':
          selection.forEach((id) => removeFromLayout(id));
          break;
        case '1':
          setView('perspective');
          break;
        case '2':
          setView('plan');
          break;
        case '3':
          setView('photo');
          break;
        case 'c':
          toggleOverlay('clearance');
          break;
        case 'g':
          toggleOverlay('grid');
          break;
        case 'l':
        case 'L':
          toggleOverlay('sunlight');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudgeSelection, rotateSelection, removeFromLayout, selection, setView, toggleOverlay]);

  const inventoryIndex = useMemo(() => inventoryMap(inventory), [inventory]);
  const ghostLayout = useMemo(
    () => layouts.find((l) => l.id === compareLayoutId) ?? null,
    [layouts, compareLayoutId],
  );

  if (!ready || !room || !evaluation) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ink-950">
        <div className="relative h-0.5 w-40 overflow-hidden rounded-full bg-ink-800 sweep" />
        <p className="text-[12.5px] text-ink-500">opening your rooms…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[262px] shrink-0 flex-col gap-2 border-r border-[color:var(--hairline)] p-2">
          <LayoutRail />
          <InventoryPanel />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <ReadoutStrip evaluation={evaluation} />

          <div className="relative min-h-0 flex-1 border-y border-[color:var(--hairline)]">
            {view === 'perspective' && (
              <>
                <Scene3D
                  room={room}
                  features={features}
                  evaluation={evaluation}
                  ghostLayout={ghostLayout}
                  inventory={inventoryIndex}
                />
                <div className="pointer-events-none absolute left-3 top-3 text-[11px] text-ink-500">
                  WASD to walk · Q/E height · shift to sprint · drag empty space to look
                </div>
              </>
            )}
            {view === 'plan' && (
              <PlanCanvas
                room={room}
                features={features}
                evaluation={evaluation}
                ghostLayout={ghostLayout}
                inventory={inventoryIndex}
              />
            )}
            {view === 'photo' && <PhotoMatch room={room} evaluation={evaluation} />}
          </div>

          <section
            className={cn(
              'flex shrink-0 flex-col transition-[height] duration-200',
              drawerOpen ? 'h-[292px]' : 'h-9',
            )}
          >
            <div className="flex h-9 shrink-0 items-center gap-1 px-2">
              {(
                [
                  ['decisions', 'Decision log', BookMarked],
                  ['compare', 'Compare', GitCompare],
                  ['move', 'Move plan', Route],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => {
                    setDrawer(key);
                    setDrawerOpen(true);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors',
                    drawer === key && drawerOpen
                      ? 'bg-ink-800 text-ink-50'
                      : 'text-ink-500 hover:text-ink-200',
                  )}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setDrawerOpen((v) => !v)}
              >
                {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </Button>
            </div>

            {drawerOpen && (
              <div className="min-h-0 flex-1 px-2 pb-2">
                {drawer === 'decisions' && <DecisionLog evaluation={evaluation} />}
                {drawer === 'compare' && <ComparePanel evaluation={evaluation} />}
                {drawer === 'move' && <MovePlanPanel />}
              </div>
            )}
          </section>
        </main>

        <aside className="flex w-[330px] shrink-0 flex-col gap-2 border-l border-[color:var(--hairline)] p-2">
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setRightTab('inspector')}
              className={cn(
                'flex items-center gap-1.5 rounded px-2 py-1 text-[12px]',
                rightTab === 'inspector' ? 'bg-ink-800 text-ink-50' : 'text-ink-500 hover:text-ink-200',
              )}
            >
              <SlidersHorizontal size={12} /> Selection
            </button>
            <button
              onClick={() => setRightTab('room')}
              className={cn(
                'flex items-center gap-1.5 rounded px-2 py-1 text-[12px]',
                rightTab === 'room' ? 'bg-ink-800 text-ink-50' : 'text-ink-500 hover:text-ink-200',
              )}
            >
              <Settings2 size={12} /> Room
            </button>
          </div>

          <div className="flex min-h-0 flex-[1.1] flex-col">
            {rightTab === 'inspector' ? <Inspector evaluation={evaluation} /> : <RoomPanel />}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <FindingsPanel evaluation={evaluation} />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-ink-950 text-[12.5px] text-ink-500">
          loading…
        </div>
      }
    >
      <StudioInner />
    </Suspense>
  );
}

export { DEMO_PROJECT_ID };
