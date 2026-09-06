'use client';

/**
 * The printable banquet event order — one sheet for the whole day.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { db } from '@/lib/db';
import { PRINT_THEME, drawPlan, fitViewport } from '@/lib/plan/render';
import { resolveItems } from '@/lib/domain/scene';
import type { BanquetEvent, InventoryItem, Layout, Project, Room, RoomFeature } from '@/lib/domain/types';
import { formatDuration, formatLength } from '@/lib/format';
import {
  flipsBetween,
  formatBeoDate,
  formatTimeRange,
  functionName,
  isStanding,
  stockOnFloor,
  summarizeFunctions,
} from '@/lib/beo/summary';

interface Loaded {
  event: BanquetEvent;
  project: Project;
  room: Room;
  features: RoomFeature[];
  layouts: Layout[];
  inventory: Map<string, InventoryItem>;
}

function BeoSheet() {
  const params = useSearchParams();
  const eventId = params.get('event');
  const [data, setData] = useState<Loaded | null>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  useEffect(() => {
    if (!eventId) return;
    void (async () => {
      const d = db();
      const event = await d.events.get(eventId);
      if (!event) return;
      const [project, room, features, items, layouts] = await Promise.all([
        d.projects.get(event.projectId),
        d.rooms.get(event.roomId),
        d.features.where('roomId').equals(event.roomId).toArray(),
        d.items.where('projectId').equals(event.projectId).toArray(),
        d.layouts.where('projectId').equals(event.projectId).toArray(),
      ]);
      if (!project || !room) return;
      setData({
        event,
        project,
        room,
        features,
        layouts,
        inventory: new Map(items.map((i) => [i.id, i])),
      });
    })();
  }, [eventId]);

  const rows = useMemo(() => {
    if (!data) return [];
    return summarizeFunctions(data.event, data.layouts, data.room, data.features, data.inventory);
  }, [data]);

  const flips = useMemo(() => {
    if (!data) return [];
    return flipsBetween(data.event, data.layouts, data.room, data.features, data.inventory);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    for (const row of rows) {
      const canvas = canvasRefs.current[row.layout.id];
      if (!canvas) continue;
      const width = 240;
      const height = 168;
      const dpr = 2;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlan(ctx, {
        room: data.room,
        features: data.features,
        items: resolveItems(row.layout, data.inventory),
        theme: PRINT_THEME,
        viewport: fitViewport(data.room.footprint, width, height, 28),
        units: data.project.unitSystem,
        showGrid: false,
        showDimensions: false,
        showDoorSwings: true,
        showLabels: false,
      });
    }
  }, [data, rows]);

  if (!eventId) {
    return <div className="p-10 text-[13px] text-ink-400">No event specified.</div>;
  }
  if (!data) {
    return <div className="p-10 text-[13px] text-ink-400">Loading the event sheet…</div>;
  }

  const { event, project, room } = data;
  const dinner = rows.find((r) => r.layout.setupKind === 'dinner') ?? rows[rows.length - 1];
  const stock = dinner ? stockOnFloor(dinner.layout, data.inventory) : [];
  const units = project.unitSystem;

  return (
    <div className="min-h-screen bg-ink-950 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--hairline)] bg-ink-900/90 px-4 py-2.5 backdrop-blur">
        <span className="text-[13px] text-ink-300">
          {event.beoNumber ? `${event.beoNumber} · ` : ''}
          {event.name}
        </span>
        <Button size="sm" variant="primary" onClick={() => window.print()}>
          <Printer size={13} /> Print
        </Button>
      </div>

      <article className="print-plain mx-auto my-6 max-w-[860px] bg-white p-10 text-[#111] shadow-2xl print:my-0 print:shadow-none">
        <header className="mb-5 flex items-start justify-between border-b-2 border-[#111] pb-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#666]">
              Banquet event order
            </p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{event.name}</h1>
            <p className="text-[14px] text-[#333]">{event.clientName}</p>
            <p className="mt-1 text-[13px] text-[#555]">
              {formatBeoDate(event.dateISO)} · {room.name} · {project.name}
            </p>
          </div>
          <div className="text-right text-[12px] text-[#444]">
            <div className="font-mono text-[15px] font-semibold">{event.beoNumber ?? 'Draft'}</div>
            <div className="mt-1 uppercase tracking-wide">{event.status}</div>
            <div className="mt-2">
              {event.guestCount} guests · {event.mealStyle}
            </div>
            {event.salesperson && <div>Sales: {event.salesperson}</div>}
          </div>
        </header>

        <section className="mb-6 grid grid-cols-3 gap-4 text-[12.5px]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#777]">Contact</div>
            <div>{event.contactName ?? '—'}</div>
            {event.contactPhone && <div>{event.contactPhone}</div>}
            {event.contactEmail && <div>{event.contactEmail}</div>}
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#777]">Guarantee</div>
            <div className="text-[18px] font-semibold">{event.guestCount}</div>
            <div className="text-[#555]">
              {dinner && !isStanding(dinner.layout.setupKind)
                ? `Dinner seats ${dinner.covers}`
                : 'Standing reception has no seat count'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#777]">Room</div>
            <div>{room.name}</div>
            <div className="text-[#555]">{project.name}</div>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#666]">
            Function schedule
          </h2>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#111] text-left text-[10px] uppercase tracking-wide text-[#666]">
                <th className="py-1.5 pr-2">Time</th>
                <th className="py-1.5 pr-2">Setup</th>
                <th className="py-1.5 pr-2">Seats</th>
                <th className="py-1.5 pr-2">Walkway</th>
                <th className="py-1.5">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.layout.id} className="border-b border-[#e6e6e6]">
                  <td className="py-2 pr-2 font-mono">{formatTimeRange(row.slot)}</td>
                  <td className="py-2 pr-2 font-medium">{functionName(row.layout)}</td>
                  <td className="py-2 pr-2 font-mono">
                    {isStanding(row.layout.setupKind) ? 'Standing' : `${row.covers} / ${event.guestCount}`}
                  </td>
                  <td className="py-2 pr-2 font-mono">
                    {row.aisleM && row.aisleM > 0 ? formatLength(row.aisleM, units) : '—'}
                  </td>
                  <td className="py-2 text-[#444]">{row.slot.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#666]">
            Floor plans
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {rows.map((row) => (
              <div key={row.layout.id} className="border border-[#ddd] p-2">
                <div className="mb-1 text-center text-[11px] font-medium">
                  {functionName(row.layout)}
                  {row.slot.start ? ` · ${row.slot.start}` : ''}
                </div>
                <canvas
                  ref={(el) => {
                    canvasRefs.current[row.layout.id] = el;
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        {(event.menu || event.beverage || event.av) && (
          <section className="mb-6 grid grid-cols-3 gap-4 text-[12.5px]">
            {event.menu && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#777]">Menu</div>
                <p className="mt-1 leading-relaxed">{event.menu}</p>
              </div>
            )}
            {event.beverage && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#777]">Drinks</div>
                <p className="mt-1 leading-relaxed">{event.beverage}</p>
              </div>
            )}
            {event.av && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#777]">AV</div>
                <p className="mt-1 leading-relaxed">{event.av}</p>
              </div>
            )}
          </section>
        )}

        {stock.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#666]">
              House stock on the dinner floor
            </h2>
            <div className="columns-2 text-[12.5px]">
              {stock.map((line) => (
                <div key={line.label} className="mb-1 flex justify-between gap-4 border-b border-[#eee] py-0.5">
                  <span>{line.label}</span>
                  <span className="font-mono">{line.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {flips.length > 0 && (
          <section className="mb-6 break-inside-avoid">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#666]">
              Changeovers
            </h2>
            {flips.map(({ from, to, plan }) => (
              <div key={`${from.id}-${to.id}`} className="mb-3">
                <div className="text-[13px] font-medium">
                  {functionName(from)} → {functionName(to)}
                  <span className="ml-2 font-normal text-[#666]">
                    {formatDuration(plan.totalMinutes)} · {plan.peopleNeeded}{' '}
                    {plan.peopleNeeded === 1 ? 'person' : 'people'}
                  </span>
                </div>
                <ol className="mt-1 space-y-0.5 text-[12px] text-[#333]">
                  {plan.steps.slice(0, 8).map((s) => (
                    <li key={s.order}>
                      {s.order}. {s.instruction}
                    </li>
                  ))}
                  {plan.steps.length > 8 && (
                    <li className="text-[#666]">…and {plan.steps.length - 8} more steps on the flip list.</li>
                  )}
                </ol>
              </div>
            ))}
          </section>
        )}

        {event.notes && (
          <section className="mb-6">
            <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-[#666]">
              Special notes
            </h2>
            <p className="text-[13px] leading-relaxed">{event.notes}</p>
          </section>
        )}

        <footer className="mt-8 grid grid-cols-2 gap-8 border-t border-[#111] pt-4 text-[11.5px] text-[#444]">
          <div>
            <div className="mb-8">Sales sign-off</div>
            <div className="border-t border-[#999] pt-1">Name / date</div>
          </div>
          <div>
            <div className="mb-8">Ops received</div>
            <div className="border-t border-[#999] pt-1">Name / date</div>
          </div>
        </footer>
      </article>
    </div>
  );
}

export default function BeoPage() {
  return (
    <Suspense fallback={<div className="p-10 text-[13px] text-ink-400">Loading…</div>}>
      <BeoSheet />
    </Suspense>
  );
}
