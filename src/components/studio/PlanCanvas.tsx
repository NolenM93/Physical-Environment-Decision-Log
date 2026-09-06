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
import {
  OPENING_KINDS,
  insertVertex,
  isUsableFootprint,
  moveEdge,
  moveVertex,
  nearestEdge,
  remapFeatures,
  slideFeature,
  snapPoint,
} from '@/lib/geometry/roomEdit';

interface Props {
  room: Room;
  features: RoomFeature[];
  evaluation: Evaluation;
  ghostLayout: Layout | null;
  inventory: Map<string, InventoryItem>;
  simpleHints?: boolean;
  selectedFeatureId?: string | null;
  onSelectFeature?: (id: string | null) => void;
  addingCorner?: boolean;
  onAddedCorner?: () => void;
}

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'drag'; itemId: string; grab: Vec2 }
  | { kind: 'rotate'; itemId: string }
  | { kind: 'vertex'; index: number }
  | { kind: 'edge'; index: number }
  | { kind: 'door'; id: string };

export function PlanCanvas({
  room,
  features,
  evaluation,
  ghostLayout,
  inventory,
  simpleHints,
  selectedFeatureId,
  onSelectFeature,
  addingCorner,
  onAddedCorner,
}: Props) {
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
  const reshapeRoom = useStudio((s) => s.reshapeRoom);
  const [hoverHandle, setHoverHandle] = useState<'vertex' | 'edge' | 'door' | null>(null);

  const units = project?.unitSystem ?? 'metric';
  const interactionRef = useRef<Interaction>(interaction);
  interactionRef.current = interaction;
  const liveRef = useRef<{ itemId: string; position: Vec2; rotation: number; guides: SnapGuide[] } | null>(
    null,
  );
  const liveRoomRef = useRef<{ footprint: Vec2[]; features: RoomFeature[] } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Fit once per room. Resizing walls should not yank the camera back.
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
  }, [room.id]);

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

    const liveRoom = liveRoomRef.current;
    const drawRoom = liveRoom ? { ...room, footprint: liveRoom.footprint } : room;
    const drawFeatures = liveRoom?.features ?? features;

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
      room: drawRoom,
      features: drawFeatures,
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
      showGrid: simpleHints ? false : overlays.grid,
      showClearance: simpleHints ? false : overlays.clearance,
      showCirculation: simpleHints ? false : overlays.circulation,
      showDimensions: simpleHints ? true : overlays.measurements,
      showDoorSwings: overlays.doorSwings,
      showFindings: simpleHints ? false : overlays.findings,
      showSun: overlays.sunlight,
      showLabels: !simpleHints,
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

    drawRoomHandles(ctx, vp, drawRoom.footprint, drawFeatures, selectedFeatureId ?? null);
  }, [
    room,
    features,
    evaluation,
    selection,
    hovered,
    overlays,
    units,
    ghostItems,
    simpleHints,
    selectedFeatureId,
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

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const screen = v2(e.clientX - rect.left, e.clientY - rect.top);

    if (addingCorner) {
      const hit = nearestEdge(room.footprint, world);
      const mid = worldToScreen(viewport, hit.point);
      if (Math.hypot(screen.x - mid.x, screen.y - mid.y) < 28 || hit.dist < 0.35) {
        const next = insertVertex(room.footprint, hit.index, snapPoint(hit.point, gridSnapM));
        if (isUsableFootprint(next)) {
          void reshapeRoom(next, remapFeatures(features, room.footprint, next));
        }
        onAddedCorner?.();
        return;
      }
    }

    const roomHit = pickRoomHandle(viewport, room.footprint, features, screen);
    if (roomHit) {
      setSelection([]);
      if (roomHit.kind === 'door') {
        onSelectFeature?.(roomHit.id);
        setInteraction({ kind: 'door', id: roomHit.id });
      } else if (roomHit.kind === 'vertex') {
        onSelectFeature?.(null);
        setInteraction({ kind: 'vertex', index: roomHit.index });
      } else {
        onSelectFeature?.(null);
        setInteraction({ kind: 'edge', index: roomHit.index });
      }
      return;
    }

    const selected = evaluation.resolved.find((r) => r.id === selection[0]);
    if (selected && !selected.placed.locked) {
      const handle = rotateHandlePosition(selected, viewport);
      const dx = screen.x - handle.x;
      const dy = screen.y - handle.y;
      if (Math.hypot(dx, dy) < 12) {
        setInteraction({ kind: 'rotate', itemId: selected.id });
        return;
      }
    }

    const hit = pickItem(evaluation.resolved, world);
    if (!hit) {
      setSelection([]);
      onSelectFeature?.(null);
      setInteraction({ kind: 'pan', last: v2(e.clientX, e.clientY) });
      return;
    }

    onSelectFeature?.(null);
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
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const roomHit = pickRoomHandle(
          viewport,
          room.footprint,
          features,
          v2(e.clientX - rect.left, e.clientY - rect.top),
        );
        setHoverHandle(roomHit ? roomHit.kind : null);
        if (roomHit) {
          setHovered(null);
          return;
        }
      }
      const hit = pickItem(evaluation.resolved, world);
      setHovered(hit?.id ?? null);
      return;
    }

    if (interaction.kind === 'vertex' || interaction.kind === 'edge' || interaction.kind === 'door') {
      const step = snapEnabled && !e.shiftKey ? gridSnapM : 0;
      const nextFoot =
        interaction.kind === 'vertex'
          ? moveVertex(room.footprint, interaction.index, snapPoint(world, step))
          : interaction.kind === 'edge'
            ? moveEdge(room.footprint, interaction.index, snapPoint(world, step))
            : room.footprint;
      const nextFeatures =
        interaction.kind === 'door'
          ? features.map((f) => {
              if (f.id !== interaction.id) return f;
              const slid = slideFeature(room.footprint, f, world);
              return { ...f, position: slid.position, facing: slid.facing };
            })
          : remapFeatures(features, room.footprint, nextFoot);
      liveRoomRef.current = { footprint: nextFoot, features: nextFeatures };
      paint();
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
    if (session.kind === 'vertex' || session.kind === 'edge' || session.kind === 'door') {
      const live = liveRoomRef.current;
      if (live && (session.kind === 'door' || isUsableFootprint(live.footprint))) {
        void reshapeRoom(live.footprint, live.features);
      }
      liveRoomRef.current = null;
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

  const selected = simpleHints ? null : evaluation.resolved.find((r) => r.id === selection[0]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#0d1015]">
      <canvas
        ref={canvasRef}
        className={
          interaction.kind === 'pan'
            ? 'cursor-grabbing'
            : interaction.kind === 'rotate'
              ? 'cursor-alias'
              : interaction.kind === 'vertex' || interaction.kind === 'edge' || hoverHandle === 'vertex' || hoverHandle === 'edge'
                ? 'cursor-grab'
                : interaction.kind === 'door' || hoverHandle === 'door'
                  ? 'cursor-grab'
                  : hovered
                    ? 'cursor-move'
                    : addingCorner
                      ? 'cursor-crosshair'
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

      {!simpleHints && (
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
      )}

      <div className="pointer-events-none absolute left-4 top-4 text-[12px] text-ink-500">
        {addingCorner
          ? 'Click a wall to add a corner.'
          : simpleHints
            ? 'Drag furniture, corners, or doors. The dots on the walls move the room.'
            : 'drag to move · nose handle to rotate · shift to bypass snapping · alt-drag to pan'}
      </div>
    </div>
  );
}

type RoomHandle =
  | { kind: 'vertex'; index: number }
  | { kind: 'edge'; index: number }
  | { kind: 'door'; id: string };

function drawRoomHandles(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  footprint: Vec2[],
  features: RoomFeature[],
  selectedFeatureId: string | null,
) {
  ctx.save();
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const mid = worldToScreen(vp, v2((a.x + b.x) / 2, (a.y + b.y) / 2));
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1015';
    ctx.fill();
    ctx.strokeStyle = '#6bb6a1';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const p of footprint) {
    const s = worldToScreen(vp, p);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#dcb066';
    ctx.fill();
    ctx.strokeStyle = '#0d1015';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const f of features) {
    if (!OPENING_KINDS.has(f.kind)) continue;
    const s = worldToScreen(vp, f.position);
    const selected = f.id === selectedFeatureId;
    ctx.beginPath();
    ctx.arc(s.x, s.y, selected ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#dcb066' : '#0d1015';
    ctx.fill();
    ctx.strokeStyle = '#dcb066';
    ctx.lineWidth = selected ? 2.5 : 2;
    ctx.stroke();
  }
  ctx.restore();
}

function pickRoomHandle(
  vp: Viewport,
  footprint: Vec2[],
  features: RoomFeature[],
  screen: Vec2,
): RoomHandle | null {
  for (const f of features) {
    if (!OPENING_KINDS.has(f.kind)) continue;
    const s = worldToScreen(vp, f.position);
    if (Math.hypot(screen.x - s.x, screen.y - s.y) <= 12) return { kind: 'door', id: f.id };
  }
  for (let i = 0; i < footprint.length; i++) {
    const s = worldToScreen(vp, footprint[i]);
    if (Math.hypot(screen.x - s.x, screen.y - s.y) <= 12) return { kind: 'vertex', index: i };
  }
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const mid = worldToScreen(vp, v2((a.x + b.x) / 2, (a.y + b.y) / 2));
    if (Math.hypot(screen.x - mid.x, screen.y - mid.y) <= 11) return { kind: 'edge', index: i };
  }
  return null;
}
