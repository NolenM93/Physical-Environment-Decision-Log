'use client';

import { useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { Compass, DoorOpen, Plug, Sun, Trash2 } from 'lucide-react';
import { Button, Field, NumberInput, Panel, Toggle, cn } from '@/components/ui/primitives';
import { type Vec2, clamp, v2 } from '@/lib/geometry/vec';
import { polygonCentroid } from '@/lib/geometry/shapes';
import { localClockToInstant, sunPosition } from '@/lib/constraints/solar';
import type { FeatureKind, RoomFeature } from '@/lib/domain/types';
import { formatClock, formatLength } from '@/lib/format';
import { useStudio } from '@/lib/store/studio';

const FEATURE_LABELS: Record<FeatureKind, string> = {
  door: 'Door',
  sliding_door: 'Sliding door',
  opening: 'Opening',
  window: 'Window',
  outlet: 'Socket',
  switch: 'Switch',
  radiator: 'Radiator',
  vent: 'Vent',
  fixed_obstruction: 'Obstruction',
  tv_jack: 'Aerial point',
};

const FEATURE_DEFAULTS: Record<FeatureKind, { width: number; height: number; sillHeight: number }> = {
  door: { width: 0.82, height: 2.04, sillHeight: 0 },
  sliding_door: { width: 1.6, height: 2.1, sillHeight: 0 },
  opening: { width: 1.0, height: 2.1, sillHeight: 0 },
  window: { width: 1.2, height: 1.3, sillHeight: 0.85 },
  outlet: { width: 0.08, height: 0.12, sillHeight: 0.28 },
  switch: { width: 0.08, height: 0.12, sillHeight: 1.1 },
  radiator: { width: 1.0, height: 0.6, sillHeight: 0.12 },
  vent: { width: 0.3, height: 0.2, sillHeight: 0.1 },
  fixed_obstruction: { width: 0.4, height: 1.0, sillHeight: 0 },
  tv_jack: { width: 0.08, height: 0.1, sillHeight: 0.3 },
};

/** Project a point onto the nearest wall and return the wall-aligned pose. */
function snapToNearestWall(footprint: Vec2[], p: Vec2): { position: Vec2; facing: number } {
  const centroid = polygonCentroid(footprint);
  let best: { position: Vec2; facing: number; d: number } | null = null;
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const a = footprint[j];
    const b = footprint[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    const q = v2(a.x + ex * t, a.y + ey * t);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    let nx = -ey / Math.sqrt(len2);
    let ny = ex / Math.sqrt(len2);
    if ((centroid.x - q.x) * nx + (centroid.y - q.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (!best || d < best.d) best = { position: q, facing: Math.atan2(ny, nx), d };
  }
  return best ?? { position: p, facing: 0 };
}

export function RoomPanel() {
  const room = useStudio((s) => s.rooms.find((r) => r.id === s.roomId) ?? null);
  const features = useStudio((s) => s.features);
  const project = useStudio((s) => s.project);
  const overlays = useStudio((s) => s.overlays);
  const timeOfDay = useStudio((s) => s.timeOfDay);
  const dateISO = useStudio((s) => s.dateISO);
  const updateRoom = useStudio((s) => s.updateRoom);
  const updateProject = useStudio((s) => s.updateProject);
  const addFeature = useStudio((s) => s.addFeature);
  const updateFeature = useStudio((s) => s.updateFeature);
  const deleteFeature = useStudio((s) => s.deleteFeature);
  const setTimeOfDay = useStudio((s) => s.setTimeOfDay);
  const setDateISO = useStudio((s) => s.setDateISO);
  const toggleOverlay = useStudio((s) => s.toggleOverlay);

  const [expanded, setExpanded] = useState<string | null>(null);
  const units = project?.unitSystem ?? 'metric';

  const sun = useMemo(() => {
    if (!project) return null;
    return sunPosition(
      localClockToInstant(dateISO, timeOfDay, project.utcOffsetMinutes),
      project.latitude,
      project.longitude,
    );
  }, [project, dateISO, timeOfDay]);

  if (!room || !project) return null;

  const addAt = async (kind: FeatureKind) => {
    const defaults = FEATURE_DEFAULTS[kind];
    const centroid = polygonCentroid(room.footprint);
    // Drop new features onto the nearest wall segment to the room centre-top,
    // which is nearly always where the user then drags them from.
    const seed = v2(centroid.x, room.footprint.reduce((m, p) => Math.min(m, p.y), Infinity));
    const pose = snapToNearestWall(room.footprint, seed);
    const feature: RoomFeature = {
      id: nanoid(10),
      roomId: room.id,
      kind,
      position: pose.position,
      facing: pose.facing,
      width: defaults.width,
      height: defaults.height,
      sillHeight: defaults.sillHeight,
      swing: kind === 'door' ? 'in-right' : undefined,
    };
    await addFeature(feature);
    setExpanded(feature.id);
  };

  const altitudeDeg = sun ? (sun.altitude * 180) / Math.PI : 0;
  const azimuthDeg = sun ? (sun.azimuth * 180) / Math.PI : 0;

  return (
    <Panel title="Room & constraints" className="min-h-0">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ceiling">
            <NumberInput
              value={room.ceilingHeight}
              step={0.05}
              onChange={(v) => void updateRoom(room.id, { ceilingHeight: v })}
              suffix="m"
            />
          </Field>
          <Field label="North bearing" hint="Which way the plan's downward axis points.">
            <NumberInput
              value={room.northAngle}
              step={5}
              onChange={(v) => void updateRoom(room.id, { northAngle: ((v % 360) + 360) % 360 })}
              suffix="°"
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="rule-label flex items-center gap-1">
              <Sun size={11} /> Daylight
            </span>
            <span className="tabular text-[11px] text-ink-400">
              {formatClock(timeOfDay)} · {altitudeDeg > 0 ? `${altitudeDeg.toFixed(0)}° up` : 'below horizon'}
            </span>
          </div>
          <input
            type="range"
            min={4}
            max={22}
            step={0.25}
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              value={dateISO}
              onChange={(e) => setDateISO(e.target.value)}
              className="h-7 flex-1 rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2 text-[12px] text-ink-200 focus:border-brass-500 focus:outline-none"
            />
            <span className="tabular flex items-center gap-1 text-[11px] text-ink-500">
              <Compass size={11} /> {azimuthDeg.toFixed(0)}°
            </span>
          </div>
          <div className="mt-1.5">
            <Toggle
              checked={overlays.sunlight}
              onChange={() => toggleOverlay('sunlight')}
              label="Show where the sun lands"
            />
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDateISO(`${new Date().getFullYear()}-12-21`)}
            >
              Winter
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDateISO(`${new Date().getFullYear()}-06-21`)}
            >
              Summer
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Latitude">
              <NumberInput
                value={project.latitude}
                step={0.5}
                onChange={(v) => void updateProject({ latitude: clamp(v, -89, 89) })}
                suffix="°"
              />
            </Field>
            <Field label="Clock" hint="Hours east of UTC where the room is.">
              <NumberInput
                value={project.utcOffsetMinutes / 60}
                step={0.5}
                onChange={(v) => void updateProject({ utcOffsetMinutes: Math.round(clamp(v, -12, 14) * 60) })}
                suffix="h"
              />
            </Field>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            The time above is the clock in the room, not on this device. Sun position is
            computed from {project.latitude.toFixed(2)}°, {project.longitude.toFixed(2)}° and the
            north bearing.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="rule-label flex items-center gap-1">
              <DoorOpen size={11} /> Openings & fittings
            </span>
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {(['door', 'window', 'opening', 'outlet', 'radiator'] as FeatureKind[]).map((k) => (
              <button
                key={k}
                onClick={() => void addAt(k)}
                className="rounded bg-ink-800 px-1.5 py-1 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-ink-50"
              >
                + {FEATURE_LABELS[k]}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            {features.length === 0 && (
              <p className="text-[11.5px] leading-relaxed text-ink-500">
                Add the door and at least one socket. Those two turn the room from a shape into a
                set of real constraints.
              </p>
            )}
            {features.map((f) => (
              <div
                key={f.id}
                className={cn(
                  'rounded-md border transition-colors',
                  expanded === f.id
                    ? 'border-brass-500/40 bg-ink-900/70'
                    : 'border-transparent hover:bg-ink-800',
                )}
              >
                <button
                  onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                >
                  {f.kind === 'outlet' || f.kind === 'tv_jack' ? (
                    <Plug size={12} className="shrink-0 text-brass-400" />
                  ) : (
                    <DoorOpen size={12} className="shrink-0 text-ink-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-200">
                    {f.label ?? FEATURE_LABELS[f.kind]}
                  </span>
                  <span className="tabular shrink-0 text-[10.5px] text-ink-500">
                    {formatLength(f.width, units)}
                  </span>
                </button>

                {expanded === f.id && (
                  <div className="space-y-2 border-t border-[color:var(--hairline)] p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Field label="X">
                        <NumberInput
                          value={f.position.x}
                          onChange={(v) => {
                            const pose = snapToNearestWall(room.footprint, v2(v, f.position.y));
                            void updateFeature(f.id, { position: pose.position, facing: pose.facing });
                          }}
                          suffix="m"
                        />
                      </Field>
                      <Field label="Y">
                        <NumberInput
                          value={f.position.y}
                          onChange={(v) => {
                            const pose = snapToNearestWall(room.footprint, v2(f.position.x, v));
                            void updateFeature(f.id, { position: pose.position, facing: pose.facing });
                          }}
                          suffix="m"
                        />
                      </Field>
                      <Field label="Width">
                        <NumberInput
                          value={f.width}
                          step={0.05}
                          onChange={(v) => void updateFeature(f.id, { width: Math.max(0.05, v) })}
                          suffix="m"
                        />
                      </Field>
                      <Field label="Sill height">
                        <NumberInput
                          value={f.sillHeight}
                          step={0.05}
                          onChange={(v) => void updateFeature(f.id, { sillHeight: Math.max(0, v) })}
                          suffix="m"
                        />
                      </Field>
                    </div>

                    {f.kind === 'door' && (
                      <div className="flex flex-wrap gap-1">
                        {(['in-left', 'in-right', 'out-left', 'out-right', 'none'] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => void updateFeature(f.id, { swing: s })}
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
                              f.swing === s
                                ? 'bg-brass-500/20 text-brass-300'
                                : 'bg-ink-800 text-ink-500 hover:text-ink-200',
                            )}
                          >
                            {s.replace('-', ' ')}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="tabular text-[10.5px] text-ink-600">
                        facing {Math.round((f.facing * 180) / Math.PI)}°
                      </span>
                      <button
                        onClick={() => void deleteFeature(f.id)}
                        className="flex items-center gap-1 text-[11px] text-ink-500 hover:text-signal-red"
                      >
                        <Trash2 size={11} /> remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
