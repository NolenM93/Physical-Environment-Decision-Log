'use client';

/**
 * The precision surface. Drag to move, grab the nose handle to rotate, scroll
 * to zoom, middle-drag or space-drag to pan. Everything reports its real
 * dimension while you do it, because the whole point is deciding whether the
 * thing actually fits.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type Vec2, v2 } from '@/lib/geometry/vec';
import {
  type Viewport,
  STUDIO_THEME,
  drawPlan,
  fitViewport,
  pickItem,
  rotateHandlePosition,
  screenToWorld,
} from '@/lib/plan/render';
import { containWithinRoom, snapPlacement, type SnapGuide } from '@/lib/layout/snap';
import { worldToScreen } from '@/lib/plan/render';
import type { Evaluation } from '@/lib/constraints/evaluate';
import type { InventoryItem, Layout, Room, RoomFeature } from '@/lib/domain/types';
import { resolveItems } from '@/lib/domain/scene';
import { useStudio } from '@/lib/store/studio';
import { formatLength } from '@/lib/format';

interface Props {
  room: Room;
  features: RoomFeature[];
  evaluation: Evaluation;
  ghostLayout: Layout | null;
  inventory: Map<string, InventoryItem>;
}

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'drag'; itemId: string; grab: Vec2 }
  | { kind: 'rotate'; itemId: string };

export function PlanCanvas({ room, features, evaluation, ghostLayout, inventory }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [interaction, setInteraction] = useState<Interaction>({ kind: 'none' });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [cursorWorld, setCursorWorld] = useState<Vec2 | null>(null);

  const overlays = useStudio((s) => s.overlays);
  const selection = useStudio((s) => s.selection);
  const hovered = useStudio((s) => s.hovered);
  const project = useStudio((s) => s.project);
  const snapEnabled = useStudio((s) => s.snapEnabled);
  const gridSnapM = useStudio((s) => s.gridSnapM);
  const snapAngleDeg = useStudio((s) => s.snapAngleDeg);
  const moveItem = useStudio((s) => s.moveItem);
  const rotateItem = useStudio((s) => s.rotateItem);
  const setSelection = useStudio((s) => s.setSelection);
  const toggleSelection = useStudio((s) => s.toggleSelection);
  const setHovered = useStudio((s) => s.setHovered);

  const units = project?.unitSystem ?? 'metric';
  const interactionRef = useRef<Interaction>(interaction);
  interactionRef.current = interaction;
  const liveRef = useRef<{ itemId: string; position: Vec2; rotation: number; guides: SnapGuide[] } | null>(
    null,
  );
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Fit the plan when the container is first measured or the room changes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) => {
        if (!prev) return fitViewport(room.footprint, rect.width, rect.height);
        return { ...prev, width: rect.width, height: rect.height };
      });
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    setViewport(fitViewport(room.footprint, rect.width, rect.height));
    return () => observer.disconnect();
  }, [room.footprint]);

  const ghostItems = ghostLayout ? resolveItems(ghostLayout, inventory) : undefined;

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const nextW = Math.max(1, Math.floor(vp.width * dpr));
    const nextH = Math.max(1, Math.floor(vp.height * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const live = liveRef.current;
    const items = live
      ? evaluation.resolved.map((r) =>
          r.id === live.itemId
            ? {
                ...r,
                placed: { ...r.placed, position: live.position, rotation: live.rotation },
                obb: { ...r.obb, center: live.position, rotation: live.rotation },
              }
            : r,
        )
      : evaluation.resolved;
    const guidesNow = live?.guides ?? [];

    drawPlan(ctx, {
      room,
      features,
      items,
      theme: STUDIO_THEME,
      viewport: vp,
      units,
      selection,
      hovered,
      findings: evaluation.findings,
      grid: evaluation.grid,
      reachable: evaluation.reachableMask,
      sunPatches: evaluation.sunPatches,
      ghostItems: overlays.ghost ? ghostItems : undefined,
      showGrid: overlays.grid,
      showClearance: overlays.clearance,
      showCirculation: overlays.circulation,
      showDimensions: overlays.measurements,
      showDoorSwings: overlays.doorSwings,
      showFindings: overlays.findings,
      showSun: overlays.sunlight,
    });

    if (guidesNow.length) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.2;
      for (const g of guidesNow) {
        const a = worldToScreen(vp, g.a);
        const b = worldToScreen(vp, g.b);
        ctx.strokeStyle = g.kind === 'wall' ? '#6bb6a1' : '#dcb066';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const selected = items.find((r) => r.id === selection[0]);
    if (selected && !selected.placed.locked) {
      const h = rotateHandlePosition(selected, vp);
      const c = worldToScreen(vp, selected.obb.center);
      ctx.strokeStyle = '#dcb066';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1015';
      ctx.fill();
      ctx.strokeStyle = '#dcb066';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [
    room,
    features,
    evaluation,
    selection,
    hovered,
    overlays,
    units,
    ghostItems,
  ]);

  useEffect(() => {
    paint();
  }, [paint, viewport, guides]);

  const toWorld = useCallback(
    (e: React.PointerEvent | React.MouseEvent | React.WheelEvent): Vec2 | null => {
      const canvas = canvasRef.current;
      if (!canvas || !viewport) return null;
      const rect = canvas.getBoundingClientRect();
      return screenToWorld(viewport, v2(e.clientX - rect.left, e.clientY - rect.top));
    },
    [viewport],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const world = toWorld(e);
    if (!world || !viewport) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (e.button === 1 || e.altKey) {
      setInteraction({ kind: 'pan', last: v2(e.clientX, e.clientY) });
      return;
    }

    const selected = evaluation.resolved.find((r) => r.id === selection[0]);
    if (selected && !selected.placed.locked) {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const handle = rotateHandlePosition(selected, viewport);
      const dx = e.clientX - rect.left - handle.x;
      const dy = e.clientY - rect.top - handle.y;
      if (Math.hypot(dx, dy) < 12) {
        setInteraction({ kind: 'rotate', itemId: selected.id });
        return;
      }
    }

    const hit = pickItem(evaluation.resolved, world);
    if (!hit) {
      setSelection([]);
      setInteraction({ kind: 'pan', last: v2(e.clientX, e.clientY) });
      return;
    }

    toggleSelection(hit.id, e.shiftKey);
    if (!hit.placed.locked) {
      setInteraction({
        kind: 'drag',
        itemId: hit.id,
        grab: v2(world.x - hit.obb.center.x, world.y - hit.obb.center.y),
      });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e);
    if (!world || !viewport) return;
    setCursorWorld(world);

    if (interaction.kind === 'none') {
      const hit = pickItem(evaluation.resolved, world);
      setHovered(hit?.id ?? null);
      return;
    }

    if (interaction.kind === 'pan') {
      const dx = e.clientX - interaction.last.x;
      const dy = e.clientY - interaction.last.y;
      setViewport({
        ...viewport,
        centre: v2(viewport.centre.x - dx / viewport.scale, viewport.centre.y - dy / viewport.scale),
      });
      setInteraction({ kind: 'pan', last: v2(e.clientX, e.clientY) });
      return;
    }

    const resolved = evaluation.resolved.find((r) => r.id === interaction.itemId);
    if (!resolved) return;

    if (interaction.kind === 'rotate') {
      const angle = Math.atan2(world.y - resolved.obb.center.y, world.x - resolved.obb.center.x);
      // The handle sits on the front face, which is local +Y.
      let yaw = angle - Math.PI / 2;
      if (snapEnabled && !e.shiftKey) {
        const step = (snapAngleDeg * Math.PI) / 180;
        yaw = Math.round(yaw / step) * step;
      }
      liveRef.current = { itemId: interaction.itemId, position: resolved.placed.position, rotation: yaw, guides: [] };
      paint();
      return;
    }

    const raw = v2(world.x - interaction.grab.x, world.y - interaction.grab.y);
    const contained = containWithinRoom(
      raw,
      v2(resolved.size.x, resolved.size.z),
      resolved.placed.rotation,
      room.footprint,
    );
    liveRef.current = {
      itemId: interaction.itemId,
      position: contained,
      rotation: resolved.placed.rotation,
      guides: [],
    };
    paint();
  };

  const endInteraction = (e?: React.PointerEvent) => {
    const session = interactionRef.current;
    const live = liveRef.current;
    if ((session.kind === 'drag' || session.kind === 'rotate') && live) {
      const resolved = evaluation.resolved.find((r) => r.id === live.itemId);
      if (resolved) {
        const others = evaluation.resolved
          .filter((r) => r.id !== live.itemId && !r.prior.walkable)
          .map((r) => ({ id: r.id, obb: r.obb }));
        const snapped = snapPlacement(
          { position: live.position, rotation: live.rotation, size: v2(resolved.size.x, resolved.size.z) },
          {
            roomFootprint: room.footprint,
            others,
            enabled: snapEnabled && !(e?.shiftKey ?? false),
            gridStep: gridSnapM,
            angleStepDeg: snapAngleDeg,
          },
        );
        const contained = containWithinRoom(
          snapped.position,
          v2(resolved.size.x, resolved.size.z),
          snapped.rotation,
          room.footprint,
        );
        moveItem(live.itemId, contained);
        if (Math.abs(snapped.rotation - resolved.placed.rotation) > 1e-4) {
          rotateItem(live.itemId, snapped.rotation);
        }
        setGuides(snapped.guides);
      }
    }
    liveRef.current = null;
    setInteraction({ kind: 'none' });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!viewport) return;
    const world = toWorld(e);
    if (!world) return;
    const factor = Math.exp(-e.deltaY * 0.0016);
    const scale = Math.max(10, Math.min(400, viewport.scale * factor));
    // Keep the point under the cursor fixed.
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setViewport({
      ...viewport,
      scale,
      centre: v2(
        world.x - (sx - viewport.width / 2) / scale,
        world.y - (sy - viewport.height / 2) / scale,
      ),
    });
  };

  const selected = evaluation.resolved.find((r) => r.id === selection[0]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#0d1015]">
      <canvas
        ref={canvasRef}
        className={
          interaction.kind === 'pan'
            ? 'cursor-grabbing'
            : interaction.kind === 'rotate'
              ? 'cursor-alias'
              : hovered
                ? 'cursor-move'
                : 'cursor-default'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerLeave={() => {
          endInteraction();
          setHovered(null);
          setCursorWorld(null);
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1 text-[11px]">
        {cursorWorld && (
          <span className="tabular rounded bg-ink-900/85 px-2 py-1 text-ink-400">
            {formatLength(cursorWorld.x, units)}, {formatLength(cursorWorld.y, units)}
          </span>
        )}
        {selected && (
          <span className="tabular rounded bg-ink-900/85 px-2 py-1 text-brass-300">
            {selected.item.label} · {formatLength(selected.size.x, units)} ×{' '}
            {formatLength(selected.size.z, units)} ·{' '}
            {Math.round(((selected.placed.rotation * 180) / Math.PI + 360) % 360)}°
          </span>
        )}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 text-[11px] text-ink-500">
        drag to move · nose handle to rotate · shift to bypass snapping · alt-drag to pan
      </div>
    </div>
  );
}
