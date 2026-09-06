'use client';

import Link from 'next/link';
import { Lock, Printer } from 'lucide-react';
import { Button, Field, NumberInput, TextArea, TextInput } from '@/components/ui/primitives';
import type { BanquetEvent, BeoSlot, MealStyle } from '@/lib/domain/types';
import { functionName, slotFor } from '@/lib/beo/summary';
import { useStudio } from '@/lib/store/studio';
import type { Evaluation } from '@/lib/constraints/evaluate';

const MEALS: { value: MealStyle; label: string }[] = [
  { value: 'plated', label: 'Plated' },
  { value: 'buffet', label: 'Buffet' },
  { value: 'stations', label: 'Stations' },
  { value: 'cocktail', label: 'Cocktail' },
  { value: 'ceremony', label: 'Ceremony only' },
  { value: 'other', label: 'Other' },
];

export function BeoPanel({ evaluation }: { evaluation: Evaluation }) {
  const event = useStudio((s) => s.events.find((e) => e.id === s.eventId) ?? null);
  const layouts = useStudio((s) => s.layouts);
  const updateEvent = useStudio((s) => s.updateEvent);
  const issueEvent = useStudio((s) => s.issueEvent);

  if (!event) return null;

  const patch = (partial: Partial<BanquetEvent>) => void updateEvent(event.id, partial);

  const setSlot = (setupId: string, next: Partial<BeoSlot>) => {
    const slots = event.setupIds.map((id) => {
      const current = slotFor(event, id);
      return id === setupId ? { ...current, ...next } : current;
    });
    patch({ slots });
  };

  const setups = event.setupIds
    .map((id) => layouts.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        <p className="text-[13px] leading-relaxed text-ink-400">
          This is the sheet the house works from. The floor fills in seats and the flip. You fill
          in who, when, and what is served.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Event">
            <TextInput value={event.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="BEO #">
            <TextInput
              value={event.beoNumber ?? ''}
              placeholder="HH-261018-04"
              onChange={(e) => patch({ beoNumber: e.target.value })}
            />
          </Field>
          <Field label="Client">
            <TextInput value={event.clientName} onChange={(e) => patch({ clientName: e.target.value })} />
          </Field>
          <Field label="Guests">
            <NumberInput
              value={event.guestCount}
              step={1}
              onChange={(v) => patch({ guestCount: Math.max(1, Math.round(v)) })}
            />
          </Field>
          <Field label="Date">
            <TextInput
              type="date"
              value={event.dateISO}
              onChange={(e) => patch({ dateISO: e.target.value })}
            />
          </Field>
          <Field label="Meal">
            <select
              value={event.mealStyle}
              onChange={(e) => patch({ mealStyle: e.target.value as MealStyle })}
              className="h-8 w-full rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2 text-[13px] text-ink-100 focus:border-brass-500 focus:outline-none"
            >
              {MEALS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <div className="rule-label mb-1.5">Day&apos;s run</div>
          <div className="space-y-2">
            {setups.map((setup) => {
              const slot = slotFor(event, setup.id);
              return (
                <div key={setup.id} className="rounded-xl bg-ink-850 px-2.5 py-2">
                  <div className="mb-1.5 text-[13px] font-medium text-ink-100">{functionName(setup)}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start">
                      <TextInput
                        type="time"
                        value={slot.start ?? ''}
                        onChange={(e) => setSlot(setup.id, { start: e.target.value })}
                      />
                    </Field>
                    <Field label="End">
                      <TextInput
                        type="time"
                        value={slot.end ?? ''}
                        onChange={(e) => setSlot(setup.id, { end: e.target.value })}
                      />
                    </Field>
                  </div>
                  <TextInput
                    className="mt-2 w-full"
                    placeholder="Notes for this setup"
                    value={slot.notes ?? ''}
                    onChange={(e) => setSlot(setup.id, { notes: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <Field label="Menu">
          <TextArea
            value={event.menu ?? ''}
            placeholder="What is served"
            onChange={(e) => patch({ menu: e.target.value })}
          />
        </Field>
        <Field label="Drinks">
          <TextArea
            value={event.beverage ?? ''}
            placeholder="Bar and wine service"
            onChange={(e) => patch({ beverage: e.target.value })}
          />
        </Field>
        <Field label="AV">
          <TextArea
            value={event.av ?? ''}
            placeholder="DJ, mics, lighting"
            onChange={(e) => patch({ av: e.target.value })}
          />
        </Field>
        <Field label="Special notes">
          <TextArea
            value={event.notes ?? ''}
            placeholder="Anything the crew must not miss"
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Sales">
            <TextInput
              value={event.salesperson ?? ''}
              onChange={(e) => patch({ salesperson: e.target.value })}
            />
          </Field>
          <Field label="Contact">
            <TextInput
              value={event.contactName ?? ''}
              onChange={(e) => patch({ contactName: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <TextInput
              value={event.contactPhone ?? ''}
              onChange={(e) => patch({ contactPhone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <TextInput
              value={event.contactEmail ?? ''}
              onChange={(e) => patch({ contactEmail: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="flex gap-2 border-t border-[color:var(--hairline)] px-2 pt-2">
        <Link href={`/beo?event=${event.id}`} target="_blank" className="flex-1">
          <Button size="md" variant="primary" className="w-full">
            <Printer size={14} /> Print BEO
          </Button>
        </Link>
        {event.status !== 'executed' && (
          <Button
            size="md"
            variant="subtle"
            disabled={event.status === 'issued'}
            onClick={() => void issueEvent(evaluation.metrics)}
          >
            <Lock size={13} /> {event.status === 'issued' ? 'Issued' : 'Issue'}
          </Button>
        )}
      </div>
    </div>
  );
}
