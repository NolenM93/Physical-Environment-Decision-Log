'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BanquetStudio } from '@/components/studio/BanquetStudio';
import { useEvaluation } from '@/lib/hooks/useEvaluation';
import { inventoryMap, useStudio } from '@/lib/store/studio';
import { v2 } from '@/lib/geometry/vec';
import { seedDemoProject } from '@/lib/db/seed';
import { db } from '@/lib/db';

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
  const selection = useStudio((s) => s.selection);
  const nudgeSelection = useStudio((s) => s.nudgeSelection);
  const rotateSelection = useStudio((s) => s.rotateSelection);
  const removeFromLayout = useStudio((s) => s.removeFromLayout);
  const setView = useStudio((s) => s.setView);
  const toggleOverlay = useStudio((s) => s.toggleOverlay);

  const evaluation = useEvaluation();

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
        case 'c':
          toggleOverlay('clearance');
          break;
        case 'g':
          toggleOverlay('grid');
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
        <p className="text-[13px] text-ink-500">Opening the room…</p>
      </div>
    );
  }

  return (
    <BanquetStudio
      evaluation={evaluation}
      room={room}
      features={features}
      ghostLayout={ghostLayout}
      inventory={inventoryIndex}
    />
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-ink-950 text-[13px] text-ink-500">
          Loading…
        </div>
      }
    >
      <StudioInner />
    </Suspense>
  );
}
