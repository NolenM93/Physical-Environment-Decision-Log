'use client';

/**
 * The printable sheet.
 *
 * The point of the whole exercise is a physical afternoon of moving furniture,
 * so it ends on paper: a scaled plan, a dimension schedule, and numbered
 * instructions somebody else can follow while you take the other end.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { db } from '@/lib/db';
import { PRINT_THEME, drawPlan, fitViewport } from '@/lib/plan/render';
import { resolveItems } from '@/lib/domain/scene';
import { buildMovePlan } from '@/lib/constraints/moveplan';
import { evaluateLayout } from '@/lib/constraints/evaluate';
import type {
  DecisionEntry,
  InventoryItem,
  Layout,
  Project,
  Room,
  RoomFeature,
} from '@/lib/domain/types';
import { formatDate, formatDuration, formatLength, formatMass } from '@/lib/format';

interface Loaded {
  project: Project;
  room: Room;
  features: RoomFeature[];
  inventory: Map<string, InventoryItem>;
  target: Layout;
  source: Layout | null;
  decisions: DecisionEntry[];
  printedAt: number;
}

function PlanSheet() {
  const params = useSearchParams();
  const layoutId = params.get('layout');
  const fromId = params.get('from');
  const [data, setData] = useState<Loaded | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!layoutId) return;
    void (async () => {
      const d = db();
      const target = await d.layouts.get(layoutId);
      if (!target) return;
      const [project, room, features, items, layouts, decisions] = await Promise.all([
        d.projects.get(target.projectId),
        d.rooms.get(target.roomId),
        d.features.where('roomId').equals(target.roomId).toArray(),
        d.items.where('projectId').equals(target.projectId).toArray(),
        d.layouts.where('roomId').equals(target.roomId).toArray(),
        d.decisions.where('layoutId').equals(layoutId).toArray(),
      ]);
      if (!project || !room) return;
      const source =
        (fromId ? layouts.find((l) => l.id === fromId) : null) ??
        layouts.find((l) => l.isCurrent) ??
        null;
      setData({
        project,
        room,
        features,
        inventory: new Map(items.map((i) => [i.id, i])),
        target,
        source: source && source.id !== target.id ? source : null,
        decisions,
        printedAt: Date.now(),
      });
    })();
  }, [layoutId, fromId]);

  const resolved = useMemo(
    () => (data ? resolveItems(data.target, data.inventory) : []),
    [data],
  );

  const plan = useMemo(() => {
    if (!data?.source) return null;
    return buildMovePlan({
      room: data.room,
      features: data.features,
      from: data.source,
      to: data.target,
      inventory: data.inventory,
    });
  }, [data]);

  const evaluation = useMemo(() => {
    if (!data) return null;
    return evaluateLayout({
      room: data.room,
      features: data.features,
      layout: data.target,
      inventory: data.inventory,
      latitude: data.project.latitude,
      longitude: data.project.longitude,
    });
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const width = 760;
    const height = 520;
    const dpr = 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawPlan(ctx, {
      room: data.room,
      features: data.features,
      items: resolved,
      theme: PRINT_THEME,
      viewport: fitViewport(data.room.footprint, width, height, 74),
      units: data.project.unitSystem,
      showGrid: true,
      showDimensions: true,
      showDoorSwings: true,
      showLabels: true,
    });
  }, [data, resolved]);

  if (!layoutId) {
    return <div className="p-10 text-[13px] text-ink-400">No arrangement specified.</div>;
  }
  if (!data) {
    return <div className="p-10 text-[13px] text-ink-400">Loading the plan…</div>;
  }

  const units = data.project.unitSystem;

  return (
    <div className="min-h-screen bg-ink-950 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--hairline)] bg-ink-900/90 px-4 py-2.5 backdrop-blur">
        <span className="text-[13px] text-ink-300">
          {data.room.name} · {data.target.name}
        </span>
        <Button size="sm" variant="primary" onClick={() => window.print()}>
          <Printer size={13} /> Print
        </Button>
      </div>

      <article className="print-plain mx-auto my-6 max-w-[820px] bg-white p-10 text-[#111] shadow-2xl print:my-0 print:shadow-none">
        <header className="mb-6 flex items-baseline justify-between border-b border-[#ddd] pb-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{data.room.name}</h1>
            <p className="text-[13px] text-[#555]">
              {data.target.name} · {data.project.name}
            </p>
          </div>
          <div className="text-right text-[11px] text-[#666]">
            <div>{formatDate(data.printedAt)}</div>
            <div>Stanza spatial decision log</div>
          </div>
        </header>

        <canvas ref={canvasRef} className="mx-auto block" />

        <section className="mt-7">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-[#666]">
            Schedule of pieces
          </h2>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#ccc] text-left text-[10.5px] uppercase tracking-wide text-[#777]">
                <th className="py-1.5 pr-2">Piece</th>
                <th className="py-1.5 pr-2">Width</th>
                <th className="py-1.5 pr-2">Depth</th>
                <th className="py-1.5 pr-2">Height</th>
                <th className="py-1.5 pr-2">Mass</th>
                <th className="py-1.5">Position (x, y)</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => (
                <tr key={r.id} className="border-b border-[#eee]">
                  <td className="py-1.5 pr-2">{r.item.label}</td>
                  <td className="py-1.5 pr-2 font-mono">{formatLength(r.size.x, units)}</td>
                  <td className="py-1.5 pr-2 font-mono">{formatLength(r.size.z, units)}</td>
                  <td className="py-1.5 pr-2 font-mono">{formatLength(r.size.y, units)}</td>
                  <td className="py-1.5 pr-2 font-mono">{formatMass(r.item.massKg, units)}</td>
                  <td className="py-1.5 font-mono">
                    {formatLength(r.obb.center.x, units)}, {formatLength(r.obb.center.y, units)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {plan && plan.steps.length > 0 && (
          <section className="mt-7 break-inside-avoid">
            <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-widest text-[#666]">
              Order of work
            </h2>
            <p className="mb-3 text-[12px] text-[#555]">
              From &ldquo;{data.source?.name}&rdquo; · about {formatDuration(plan.totalMinutes)} ·{' '}
              {plan.peopleNeeded} {plan.peopleNeeded === 1 ? 'person' : 'people'} ·{' '}
              {formatLength(plan.totalDistanceM, units)} of carrying
            </p>
            <ol className="space-y-2">
              {plan.steps.map((s) => (
                <li key={s.order} className="flex gap-3 break-inside-avoid text-[12.5px]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#bbb] font-mono text-[10.5px]">
                    {s.order}
                  </span>
                  <span>
                    {s.instruction}
                    <span className="ml-1.5 font-mono text-[11px] text-[#777]">
                      [{formatDuration(s.minutes)}
                      {s.people > 1 ? `, ${s.people} people` : ''}
                      {s.distanceM > 0 ? `, ${formatLength(s.distanceM, units)}` : ''}]
                    </span>
                    {s.tightSqueeze && (
                      <span className="ml-1 text-[11.5px] text-[#9a6d16]">
                        Turn on edge: route narrows to {formatLength(s.tightSqueeze.routeWidthM, units)}.
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {plan.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 border-l-2 border-[#c9a24a] pl-3 text-[11.5px] text-[#7a5c14]">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {evaluation && evaluation.findings.length > 0 && (
          <section className="mt-7 break-inside-avoid">
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-[#666]">
              Things to watch
            </h2>
            <ul className="space-y-1 text-[12px]">
              {evaluation.findings.slice(0, 10).map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.title}.</span>{' '}
                  <span className="text-[#555]">{f.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.decisions.length > 0 && (
          <section className="mt-7 break-inside-avoid">
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-[#666]">
              Why this one
            </h2>
            {data.decisions.map((d) => (
              <div key={d.id} className="mb-3">
                <div className="text-[13px] font-medium">
                  {d.title} <span className="text-[11px] uppercase text-[#777]">({d.verdict})</span>
                </div>
                {d.rationale && <p className="mt-0.5 text-[12px] text-[#444]">{d.rationale}</p>}
                {(d.pros.length > 0 || d.cons.length > 0) && (
                  <div className="mt-1 grid grid-cols-2 gap-4 text-[11.5px] text-[#555]">
                    <ul>{d.pros.map((p, i) => <li key={i}>+ {p}</li>)}</ul>
                    <ul>{d.cons.map((c, i) => <li key={i}>− {c}</li>)}</ul>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <footer className="mt-8 border-t border-[#ddd] pt-3 text-[10.5px] text-[#888]">
          Dimensions reconstructed from photographs and corrected by hand. Check anything critical
          with a tape measure before you commit to it.
        </footer>
      </article>
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="p-10 text-[13px] text-ink-400">Loading…</div>}>
      <PlanSheet />
    </Suspense>
  );
}
