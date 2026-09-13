'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button, Field, NumberInput, Segmented, TextInput } from '@/components/ui/primitives';
import { Mark } from '@/components/ui/hud';
import { createCustomRoom, type RoomUse } from '@/lib/db/create-room';
import { formatArea, fromDisplayLength, lengthSuffix, toDisplayLength } from '@/lib/format';
import type { UnitSystem } from '@/lib/domain/types';

const PRESETS: { label: string; use: RoomUse; width: number; depth: number; ceiling: number }[] = [
  { label: 'Small function', use: 'banquet', width: 12, depth: 10, ceiling: 3.6 },
  { label: 'Ballroom', use: 'banquet', width: 20, depth: 14, ceiling: 5.2 },
  { label: 'Grand hall', use: 'banquet', width: 30, depth: 20, ceiling: 6 },
  { label: 'Living room', use: 'living', width: 4.6, depth: 3.8, ceiling: 2.45 },
];

export function NewRoomForm() {
  const router = useRouter();
  const [use, setUse] = useState<RoomUse>('banquet');
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [widthM, setWidthM] = useState(20);
  const [depthM, setDepthM] = useState(14);
  const [ceilingM, setCeilingM] = useState(5.2);
  const [roomName, setRoomName] = useState('Ballroom');
  const [projectName, setProjectName] = useState('');
  const [eventName, setEventName] = useState('');
  const [clientName, setClientName] = useState('');
  const [guestCount, setGuestCount] = useState(120);
  const [dateISO, setDateISO] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suffix = lengthSuffix(units);
  const width = toDisplayLength(widthM, units);
  const depth = toDisplayLength(depthM, units);
  const ceiling = toDisplayLength(ceilingM, units);
  const area = widthM * depthM;

  const preview = useMemo(() => {
    const max = Math.max(widthM, depthM, 1);
    return { w: (widthM / max) * 280, h: (depthM / max) * 200 };
  }, [widthM, depthM]);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setUse(preset.use);
    setWidthM(preset.width);
    setDepthM(preset.depth);
    setCeilingM(preset.ceiling);
    if (preset.use === 'banquet') setRoomName((n) => (n === 'Living room' ? 'Ballroom' : n || 'Ballroom'));
    else setRoomName((n) => (n === 'Ballroom' ? 'Living room' : n || 'Living room'));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createCustomRoom({
        use,
        projectName: projectName || roomName,
        roomName,
        width: widthM,
        depth: depthM,
        ceilingHeight: ceilingM,
        unitSystem: units,
        guestCount,
        eventName,
        clientName,
        dateISO,
      });
      router.push(`/studio?project=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="paper-grid min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Mark size={28} />
            <span className="font-display text-[18px] text-ink-50">Stanza</span>
          </Link>
          <Link href="/" className="text-[13px] text-ink-400 hover:text-ink-100">
            <span className="inline-flex items-center gap-1">
              <ArrowLeft size={13} /> Home
            </span>
          </Link>
        </header>

        <section className="grid flex-1 items-start gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="rule-label mb-4">Your own floor</p>
            <h1 className="wordmark text-[40px] leading-[1.08] sm:text-[48px]">
              Draw the room
              <br />
              <span className="text-brass-400">to the nearest metre.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-300">
              Type the length, width and ceiling. The floor starts empty. Banquet rooms come with
              house stock and three setups — ceremony, reception, dinner — so you can place tables
              the way the hotel actually sets them.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-full border border-[color:var(--hairline)] px-3 py-1 text-[12.5px] text-ink-400 hover:bg-ink-800 hover:text-ink-50"
                >
                  {preset.label}
                  <span className="ml-1.5 tabular text-ink-600">
                    {preset.width}×{preset.depth}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <form
            className="panel p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                value={use}
                onChange={(v) => {
                  setUse(v);
                  setRoomName(v === 'banquet' ? 'Ballroom' : 'Living room');
                  if (v === 'living' && widthM > 12) {
                    setWidthM(4.6);
                    setDepthM(3.8);
                    setCeilingM(2.45);
                  }
                  if (v === 'banquet' && widthM < 8) {
                    setWidthM(20);
                    setDepthM(14);
                    setCeilingM(5.2);
                  }
                }}
                options={[
                  { value: 'banquet', label: 'Banquet' },
                  { value: 'living', label: 'Living room' },
                ]}
              />
              <Segmented
                value={units}
                onChange={setUnits}
                options={[
                  { value: 'metric', label: 'Metres' },
                  { value: 'imperial', label: 'Feet' },
                ]}
              />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <Field label="Length" hint="Along the guest doors">
                <NumberInput
                  value={Math.round(width * 100) / 100}
                  step={units === 'imperial' ? 0.5 : 0.1}
                  min={units === 'imperial' ? 6 : 2}
                  max={units === 'imperial' ? 260 : 80}
                  suffix={suffix}
                  onChange={(v) => setWidthM(fromDisplayLength(v, units))}
                />
              </Field>
              <Field label="Width" hint="Depth of the room">
                <NumberInput
                  value={Math.round(depth * 100) / 100}
                  step={units === 'imperial' ? 0.5 : 0.1}
                  min={units === 'imperial' ? 6 : 2}
                  max={units === 'imperial' ? 260 : 80}
                  suffix={suffix}
                  onChange={(v) => setDepthM(fromDisplayLength(v, units))}
                />
              </Field>
              <Field label="Ceiling">
                <NumberInput
                  value={Math.round(ceiling * 100) / 100}
                  step={units === 'imperial' ? 0.25 : 0.05}
                  min={units === 'imperial' ? 7 : 2}
                  max={units === 'imperial' ? 40 : 12}
                  suffix={suffix}
                  onChange={(v) => setCeilingM(fromDisplayLength(v, units))}
                />
              </Field>
            </div>

            <div className="mt-5 flex justify-center rounded-lg border border-[color:var(--hairline)] bg-ink-950/40 py-6">
              <svg
                width={preview.w + 48}
                height={preview.h + 36}
                viewBox={`0 0 ${preview.w + 48} ${preview.h + 36}`}
                aria-hidden
              >
                <rect
                  x={24}
                  y={8}
                  width={preview.w}
                  height={preview.h}
                  fill="color-mix(in srgb, var(--color-brass-500) 12%, transparent)"
                  stroke="var(--color-ink-50)"
                  strokeWidth="1.25"
                />
                <text
                  x={24 + preview.w / 2}
                  y={preview.h + 28}
                  textAnchor="middle"
                  className="fill-ink-400"
                  fontSize="11"
                >
                  {width.toFixed(units === 'imperial' ? 1 : 2)} {suffix}
                </text>
                <text
                  x={12}
                  y={8 + preview.h / 2}
                  textAnchor="middle"
                  className="fill-ink-400"
                  fontSize="11"
                  transform={`rotate(-90 12 ${8 + preview.h / 2})`}
                >
                  {depth.toFixed(units === 'imperial' ? 1 : 2)} {suffix}
                </text>
              </svg>
            </div>
            <p className="mt-2 text-center tabular text-[12px] text-ink-500">
              {formatArea(area, units)} of floor
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Field label="Room name">
                <TextInput value={roomName} onChange={(e) => setRoomName(e.target.value)} />
              </Field>
              <Field label="Property">
                <TextInput
                  value={projectName}
                  placeholder={use === 'banquet' ? 'Hotel name' : 'Home'}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </Field>
            </div>

            {use === 'banquet' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Event">
                  <TextInput
                    value={eventName}
                    placeholder="Saturday wedding"
                    onChange={(e) => setEventName(e.target.value)}
                  />
                </Field>
                <Field label="Client">
                  <TextInput value={clientName} onChange={(e) => setClientName(e.target.value)} />
                </Field>
                <Field label="Guests">
                  <NumberInput value={guestCount} step={1} min={1} max={2000} onChange={setGuestCount} />
                </Field>
                <Field label="Date" className="sm:col-span-3">
                  <TextInput type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
                </Field>
              </div>
            )}

            {error && <p className="mt-3 text-[13px] text-signal-red">{error}</p>}

            <div className="mt-6 flex items-center justify-between">
              <p className="max-w-[220px] text-[12px] leading-relaxed text-ink-500">
                Guest doors sit on the long south wall. You can move them once the floor is open.
              </p>
              <Button type="submit" variant="primary" size="lg" disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                Open the floor <ArrowRight size={15} />
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
