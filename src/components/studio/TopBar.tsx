'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Box,
  Camera,
  Check,
  Grid2x2,
  Image as ImageIcon,
  Redo2,
  Ruler,
  Undo2,
  Waypoints,
} from 'lucide-react';
import { Badge, Button, Segmented, Toggle, cn } from '@/components/ui/primitives';
import { useStudio } from '@/lib/store/studio';
import type { ViewMode } from '@/lib/store/studio';

function useTemporal() {
  const [state, setState] = useState(() => useStudio.temporal.getState());
  useEffect(() => useStudio.temporal.subscribe(setState), []);
  return state;
}

export function TopBar() {
  const project = useStudio((s) => s.project);
  const rooms = useStudio((s) => s.rooms);
  const roomId = useStudio((s) => s.roomId);
  const selectRoom = useStudio((s) => s.selectRoom);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const overlays = useStudio((s) => s.overlays);
  const toggleOverlay = useStudio((s) => s.toggleOverlay);
  const snapEnabled = useStudio((s) => s.snapEnabled);
  const setSnapEnabled = useStudio((s) => s.setSnapEnabled);
  const dirty = useStudio((s) => s.dirty);
  const layouts = useStudio((s) => s.layouts);
  const layoutId = useStudio((s) => s.layoutId);

  const temporal = useTemporal();
  const [overlayMenu, setOverlayMenu] = useState(false);

  const layout = layouts.find((l) => l.id === layoutId);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[color:var(--hairline)] bg-ink-900/80 px-3 backdrop-blur">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-brass-500 text-[13px] font-semibold text-ink-950">
          S
        </span>
        <span className="text-[14px] font-medium tracking-tight text-ink-50">Stanza</span>
      </Link>

      <span className="h-5 w-px bg-[color:var(--hairline)]" />

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] text-ink-300">{project?.name}</span>
        {rooms.length > 1 ? (
          <select
            value={roomId ?? ''}
            onChange={(e) => void selectRoom(e.target.value)}
            className="h-7 rounded border border-[color:var(--hairline)] bg-ink-900 px-1.5 text-[12.5px] text-ink-200 focus:outline-none"
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] text-ink-500">· {rooms[0]?.name}</span>
        )}
        {layout && (
          <span className="flex items-center gap-1.5 text-[13px] text-ink-500">
            ·
            <span className="h-2 w-2 rounded-full" style={{ background: layout.color }} />
            <span className="text-ink-200">{layout.name}</span>
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={cn(
            'tabular mr-1 text-[11px] transition-opacity',
            dirty ? 'text-brass-400' : 'text-ink-600',
          )}
        >
          {dirty ? 'saving…' : 'saved'}
        </span>

        <Button
          size="sm"
          variant="ghost"
          disabled={!temporal.pastStates.length}
          onClick={() => temporal.undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!temporal.futureStates.length}
          onClick={() => temporal.redo()}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={14} />
        </Button>

        <span className="h-5 w-px bg-[color:var(--hairline)]" />

        <Segmented<ViewMode>
          value={view}
          onChange={setView}
          options={[
            { value: 'perspective', label: <Box size={13} />, title: 'Three-dimensional view' },
            { value: 'plan', label: <Grid2x2 size={13} />, title: 'Scaled floor plan' },
            { value: 'photo', label: <ImageIcon size={13} />, title: 'Photo match' },
          ]}
        />

        <div className="relative">
          <Button
            size="sm"
            variant={overlayMenu ? 'subtle' : 'ghost'}
            onClick={() => setOverlayMenu((v) => !v)}
            title="Overlays"
          >
            <Waypoints size={14} />
          </Button>
          {overlayMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOverlayMenu(false)} />
              <div className="panel absolute right-0 top-9 z-20 w-56 p-1.5">
                <Toggle
                  checked={overlays.circulation}
                  onChange={() => toggleOverlay('circulation')}
                  label="Walkable floor"
                  hint="Shades everything you cannot reach at walking width"
                />
                <Toggle
                  checked={overlays.clearance}
                  onChange={() => toggleOverlay('clearance')}
                  label="Clearance heat"
                  hint="Red where gaps get tight, green where they are generous"
                />
                <Toggle
                  checked={overlays.doorSwings}
                  onChange={() => toggleOverlay('doorSwings')}
                  label="Door swings"
                />
                <Toggle
                  checked={overlays.sunlight}
                  onChange={() => toggleOverlay('sunlight')}
                  label="Sunlight"
                />
                <Toggle
                  checked={overlays.measurements}
                  onChange={() => toggleOverlay('measurements')}
                  label="Dimensions"
                />
                <Toggle
                  checked={overlays.findings}
                  onChange={() => toggleOverlay('findings')}
                  label="Issue pins"
                />
                <Toggle checked={overlays.grid} onChange={() => toggleOverlay('grid')} label="Grid" />
                <Toggle
                  checked={overlays.ghost}
                  onChange={() => toggleOverlay('ghost')}
                  label="Ghost the compared layout"
                />
                <div className="mt-1 border-t border-[color:var(--hairline)] pt-1">
                  <Toggle
                    checked={snapEnabled}
                    onChange={setSnapEnabled}
                    label="Snapping"
                    hint="Flush to walls, aligned to neighbours. Hold Shift to bypass."
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <Button
          size="sm"
          variant={overlays.measurements ? 'subtle' : 'ghost'}
          onClick={() => toggleOverlay('measurements')}
          title="Dimensions"
        >
          <Ruler size={14} />
        </Button>

        <span className="h-5 w-px bg-[color:var(--hairline)]" />

        <Link href="/capture">
          <Button size="sm" variant="primary">
            <Camera size={13} /> Capture a room
          </Button>
        </Link>
      </div>
    </header>
  );
}

export function SavedIndicator() {
  const dirty = useStudio((s) => s.dirty);
  return dirty ? <Badge tone="warn">unsaved</Badge> : <Badge tone="good"><Check size={10} /> saved</Badge>;
}
