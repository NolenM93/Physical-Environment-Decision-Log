/**
 * Canvas renderer for the floor plan.
 *
 * Kept pure and free of React so the same code draws the interactive editor,
 * the printable sheet, and the PNG export. Two themes: `studio` for the dark
 * workspace, `print` for something you can actually put on paper and hand to
 * whoever is helping you lift the sofa.
 */

import type { Vec2 } from '../geometry/vec';
import { obbCorners } from '../geometry/shapes';
import type { ResolvedItem } from '../domain/scene';
import { doorZone } from '../domain/scene';
import type { Room, RoomFeature, UnitSystem } from '../domain/types';
import type { Finding } from '../constraints/evaluate';
import type { OccupancyGrid } from '../constraints/grid';
import type { SunPatch } from '../constraints/solar';
import { formatLength } from '../format';

export interface PlanTheme {
  background: string;
  floor: string;
  wall: string;
  wallWidth: number;
  gridMinor: string;
  gridMajor: string;
  item: string;
  itemStroke: string;
  itemLabel: string;
  selection: string;
  dimension: string;
  door: string;
  window: string;
  outlet: string;
  findingBlocker: string;
  findingWarning: string;
  findingNote: string;
  ghost: string;
  sun: string;
}

export const STUDIO_THEME: PlanTheme = {
  background: '#0d1015',
  floor: '#161b22',
  wall: '#8d99ab',
  wallWidth: 3,
  gridMinor: 'rgba(109,124,146,0.10)',
  gridMajor: 'rgba(109,124,146,0.20)',
  item: 'rgba(255,255,255,0.06)',
  itemStroke: '#8d99ab',
  itemLabel: '#b5bfcd',
  selection: '#dcb066',
  dimension: '#8d99ab',
  door: '#dcb066',
  window: '#7fb0d6',
  outlet: '#dcb066',
  findingBlocker: '#d9695f',
  findingWarning: '#d9a75f',
  findingNote: '#6f97c4',
  ghost: 'rgba(220,176,102,0.30)',
  sun: 'rgba(255,214,150,0.20)',
};

export const PRINT_THEME: PlanTheme = {
  background: '#ffffff',
  floor: '#fbfbf9',
  wall: '#1a1a1a',
  wallWidth: 3.5,
  gridMinor: 'rgba(0,0,0,0.05)',
  gridMajor: 'rgba(0,0,0,0.11)',
  item: 'rgba(0,0,0,0.05)',
  itemStroke: '#333333',
  itemLabel: '#111111',
  selection: '#b07d20',
  dimension: '#555555',
  door: '#8a6a1f',
  window: '#2f6f9e',
  outlet: '#8a6a1f',
  findingBlocker: '#b03a30',
  findingWarning: '#9a6d16',
  findingNote: '#2f5f96',
  ghost: 'rgba(0,0,0,0.15)',
  sun: 'rgba(240,190,110,0.28)',
};

export interface Viewport {
  /** Pixels per metre. */
  scale: number;
  /** World point rendered at the canvas centre. */
  centre: Vec2;
  width: number;
  height: number;
}

export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  return {
    x: v.width / 2 + (p.x - v.centre.x) * v.scale,
    y: v.height / 2 + (p.y - v.centre.y) * v.scale,
  };
}

export function screenToWorld(v: Viewport, p: Vec2): Vec2 {
  return {
    x: v.centre.x + (p.x - v.width / 2) / v.scale,
    y: v.centre.y + (p.y - v.height / 2) / v.scale,
  };
}

export function fitViewport(
  footprint: Vec2[],
  width: number,
  height: number,
  padding = 68,
): Viewport {
  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (width - padding * 2) / Math.max(0.5, maxX - minX),
    (height - padding * 2) / Math.max(0.5, maxY - minY),
  );
  return {
    scale: Math.max(8, scale),
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width,
    height,
  };
}

export interface PlanRenderOptions {
  room: Room;
  features: RoomFeature[];
  items: ResolvedItem[];
  theme: PlanTheme;
  viewport: Viewport;
  units: UnitSystem;
  selection?: string[];
  hovered?: string | null;
  findings?: Finding[];
  grid?: OccupancyGrid;
  reachable?: Uint8Array;
  sunPatches?: SunPatch[];
  ghostItems?: ResolvedItem[];
  showGrid?: boolean;
  showClearance?: boolean;
  showCirculation?: boolean;
  showDimensions?: boolean;
  showDoorSwings?: boolean;
  showLabels?: boolean;
  showFindings?: boolean;
  showSun?: boolean;
  title?: string;
  subtitle?: string;
}

export function drawPlan(ctx: CanvasRenderingContext2D, o: PlanRenderOptions): void {
  const { theme, viewport: vp } = o;
  const S = (p: Vec2) => worldToScreen(vp, p);

  ctx.save();
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, vp.width, vp.height);

  if (o.showGrid !== false) drawGrid(ctx, o);

  // --- floor ---
  ctx.beginPath();
  o.room.footprint.forEach((p, i) => {
    const s = S(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = theme.floor;
  ctx.fill();

  if (o.grid && (o.showClearance || o.showCirculation)) {
    ctx.save();
    ctx.clip();
    drawField(ctx, o);
    ctx.restore();
  }

  if (o.showSun && o.sunPatches?.length) {
    ctx.save();
    ctx.clip();
    for (const patch of o.sunPatches) {
      ctx.beginPath();
      patch.polygon.forEach((p, i) => {
        const s = S(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = theme.sun;
      ctx.fill();
    }
    ctx.restore();
  }

  // --- walls ---
  ctx.beginPath();
  o.room.footprint.forEach((p, i) => {
    const s = S(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.lineWidth = theme.wallWidth;
  ctx.strokeStyle = theme.wall;
  ctx.lineJoin = 'miter';
  ctx.stroke();

  drawFeatures(ctx, o);

  if (o.ghostItems?.length) {
    for (const item of o.ghostItems) {
      drawItem(ctx, o, item, { ghost: true });
    }
  }

  for (const item of o.items) {
    drawItem(ctx, o, item, {
      selected: o.selection?.includes(item.id) ?? false,
      hovered: o.hovered === item.id,
    });
  }

  if (o.showDimensions !== false) drawRoomDimensions(ctx, o);
  if (o.showFindings && o.findings?.length) drawFindings(ctx, o);
  drawScaleBar(ctx, o);

  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, o: PlanRenderOptions) {
  const { viewport: vp, theme } = o;
  const step = vp.scale > 90 ? 0.1 : vp.scale > 45 ? 0.25 : 0.5;
  const topLeft = screenToWorld(vp, { x: 0, y: 0 });
  const bottomRight = screenToWorld(vp, { x: vp.width, y: vp.height });

  ctx.lineWidth = 1;
  for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
    const s = worldToScreen(vp, { x, y: 0 });
    const major = Math.abs(x % 1) < 1e-6;
    ctx.strokeStyle = major ? theme.gridMajor : theme.gridMinor;
    ctx.beginPath();
    ctx.moveTo(Math.round(s.x) + 0.5, 0);
    ctx.lineTo(Math.round(s.x) + 0.5, vp.height);
    ctx.stroke();
  }
  for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
    const s = worldToScreen(vp, { x: 0, y });
    const major = Math.abs(y % 1) < 1e-6;
    ctx.strokeStyle = major ? theme.gridMajor : theme.gridMinor;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(s.y) + 0.5);
    ctx.lineTo(vp.width, Math.round(s.y) + 0.5);
    ctx.stroke();
  }
}

function drawField(ctx: CanvasRenderingContext2D, o: PlanRenderOptions) {
  const grid = o.grid!;
  const vp = o.viewport;
  const size = grid.cell * vp.scale;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = r * grid.cols + c;
      if (grid.state[i] !== 1) continue;
      const walkable = o.reachable ? o.reachable[i] === 1 : true;
      let fill: string | null = null;

      if (o.showClearance) {
        const t = Math.max(0, Math.min(1, (grid.clearance[i] * 2 - 0.45) / 0.95));
        const red = Math.round(232 * (1 - t) ** 0.8);
        const green = Math.round(170 * t ** 0.7 + 45 * (1 - t));
        fill = `rgba(${red},${green},${Math.round(80 * (1 - t))},0.42)`;
      }
      if (o.showCirculation && !walkable) {
        fill = 'rgba(20,24,32,0.55)';
      } else if (o.showCirculation && walkable && !o.showClearance) {
        fill = 'rgba(90,160,140,0.16)';
      }
      if (!fill) continue;

      const s = worldToScreen(vp, {
        x: grid.origin.x + c * grid.cell,
        y: grid.origin.y + r * grid.cell,
      });
      ctx.fillStyle = fill;
      ctx.fillRect(s.x, s.y, size + 0.6, size + 0.6);
    }
  }
}

function drawFeatures(ctx: CanvasRenderingContext2D, o: PlanRenderOptions) {
  const { theme, viewport: vp } = o;
  const S = (p: Vec2) => worldToScreen(vp, p);

  for (const f of o.features) {
    const facing = { x: Math.cos(f.facing), y: Math.sin(f.facing) };
    const along = { x: -facing.y, y: facing.x };
    const a = S({ x: f.position.x - along.x * (f.width / 2), y: f.position.y - along.y * (f.width / 2) });
    const b = S({ x: f.position.x + along.x * (f.width / 2), y: f.position.y + along.y * (f.width / 2) });

    if (f.kind === 'window') {
      ctx.strokeStyle = theme.window;
      ctx.lineWidth = theme.wallWidth + 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = theme.background;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if (f.kind === 'door' || f.kind === 'opening' || f.kind === 'sliding_door') {
      ctx.strokeStyle = theme.background;
      ctx.lineWidth = theme.wallWidth + 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      if (o.showDoorSwings !== false) {
        const zone = doorZone(f);
        ctx.beginPath();
        zone.forEach((p, i) => {
          const s = S(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = theme.door;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (f.kind === 'outlet' || f.kind === 'tv_jack' || f.kind === 'switch') {
      const s = S(f.position);
      ctx.fillStyle = f.kind === 'outlet' ? theme.outlet : theme.window;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.background;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (f.kind === 'radiator') {
      ctx.strokeStyle = theme.dimension;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  o: PlanRenderOptions,
  item: ResolvedItem,
  state: { selected?: boolean; hovered?: boolean; ghost?: boolean },
) {
  const { theme, viewport: vp } = o;
  const corners = obbCorners(item.obb).map((p) => worldToScreen(vp, p));

  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();

  if (state.ghost) {
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  ctx.fillStyle = hexWithAlpha(item.item.color, item.passable ? 0.16 : 0.4);
  ctx.fill();
  ctx.strokeStyle = state.selected ? theme.selection : state.hovered ? theme.itemLabel : theme.itemStroke;
  ctx.lineWidth = state.selected ? 2.4 : 1.3;
  ctx.stroke();

  // Front-face tick, so orientation is unambiguous on paper.
  const yaw = item.placed.rotation;
  const front = { x: -Math.sin(yaw), y: Math.cos(yaw) };
  const c = worldToScreen(vp, item.obb.center);
  const depthPx = (item.size.z / 2) * vp.scale;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + front.x * depthPx * 0.82, c.y + front.y * depthPx * 0.82);
  ctx.strokeStyle = state.selected ? theme.selection : theme.itemStroke;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (o.showLabels !== false && vp.scale > 26) {
    ctx.save();
    ctx.translate(c.x, c.y);
    let angle = yaw;
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    ctx.rotate(angle);
    ctx.fillStyle = theme.itemLabel;
    ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = item.item.label;
    const maxWidth = Math.max(item.size.x, item.size.z) * vp.scale - 8;
    if (ctx.measureText(label).width < maxWidth) {
      ctx.fillText(label, 0, -6);
      ctx.font = '400 9.5px ui-monospace, monospace';
      ctx.fillStyle = theme.dimension;
      ctx.fillText(
        `${formatLength(item.size.x, o.units)} × ${formatLength(item.size.z, o.units)}`,
        0,
        7,
      );
    }
    ctx.restore();
  }

  if (state.selected && o.showDimensions !== false) {
    drawItemDimensions(ctx, o, item);
  }
}

function drawItemDimensions(ctx: CanvasRenderingContext2D, o: PlanRenderOptions, item: ResolvedItem) {
  const { theme, viewport: vp } = o;
  const corners = obbCorners(item.obb);
  const pairs: [Vec2, Vec2, number][] = [
    [corners[0], corners[1], item.size.x],
    [corners[1], corners[2], item.size.z],
  ];
  ctx.font = '500 10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [a, b, length] of pairs) {
    const sa = worldToScreen(vp, a);
    const sb = worldToScreen(vp, b);
    const nx = -(sb.y - sa.y);
    const ny = sb.x - sa.x;
    const nl = Math.hypot(nx, ny) || 1;
    const ox = (nx / nl) * -14;
    const oy = (ny / nl) * -14;

    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sa.x + ox, sa.y + oy);
    ctx.lineTo(sb.x + ox, sb.y + oy);
    ctx.stroke();

    ctx.fillStyle = theme.background;
    const text = formatLength(length, o.units);
    const w = ctx.measureText(text).width + 6;
    ctx.fillRect((sa.x + sb.x) / 2 + ox - w / 2, (sa.y + sb.y) / 2 + oy - 7, w, 14);
    ctx.fillStyle = theme.selection;
    ctx.fillText(text, (sa.x + sb.x) / 2 + ox, (sa.y + sb.y) / 2 + oy);
  }
}

function drawRoomDimensions(ctx: CanvasRenderingContext2D, o: PlanRenderOptions) {
  const { theme, viewport: vp } = o;
  const poly = o.room.footprint;
  ctx.font = '500 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centroid = poly.reduce(
    (acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }),
    { x: 0, y: 0 },
  );

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.15) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let outward = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    if ((mid.x - centroid.x) * outward.x + (mid.y - centroid.y) * outward.y < 0) {
      outward = { x: -outward.x, y: -outward.y };
    }
    const off = 22;
    const sa = worldToScreen(vp, a);
    const sb = worldToScreen(vp, b);
    const ox = outward.x * off;
    const oy = outward.y * off;

    ctx.strokeStyle = theme.dimension;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sa.x + ox, sa.y + oy);
    ctx.lineTo(sb.x + ox, sb.y + oy);
    ctx.stroke();
    for (const end of [sa, sb]) {
      ctx.beginPath();
      ctx.moveTo(end.x + ox * 0.35, end.y + oy * 0.35);
      ctx.lineTo(end.x + ox * 1.18, end.y + oy * 1.18);
      ctx.stroke();
    }

    const label = formatLength(length, o.units);
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = theme.background;
    ctx.fillRect((sa.x + sb.x) / 2 + ox - w / 2, (sa.y + sb.y) / 2 + oy - 8, w, 16);
    ctx.fillStyle = theme.dimension;
    ctx.fillText(label, (sa.x + sb.x) / 2 + ox, (sa.y + sb.y) / 2 + oy);
  }
}

function drawFindings(ctx: CanvasRenderingContext2D, o: PlanRenderOptions) {
  const { theme, viewport: vp } = o;
  for (const f of o.findings ?? []) {
    if (!f.at) continue;
    const s = worldToScreen(vp, f.at);
    const color =
      f.severity === 'blocker'
        ? theme.findingBlocker
        : f.severity === 'warning'
          ? theme.findingWarning
          : theme.findingNote;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.background;
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.severity === 'blocker' ? '!' : f.severity === 'warning' ? '△' : 'i', s.x, s.y + 0.5);
  }
}

function drawScaleBar(ctx: CanvasRenderingContext2D, o: PlanRenderOptions) {
  const { theme, viewport: vp } = o;
  const target = 110;
  const candidates = [0.25, 0.5, 1, 2, 5];
  const metres = candidates.reduce((best, c) =>
    Math.abs(c * vp.scale - target) < Math.abs(best * vp.scale - target) ? c : best,
  );
  const px = metres * vp.scale;
  const x = 20;
  const y = vp.height - 24;

  ctx.strokeStyle = theme.dimension;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4);
  ctx.lineTo(x + px, y + 4);
  ctx.stroke();

  ctx.fillStyle = theme.dimension;
  ctx.font = '500 10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(formatLength(metres, o.units), x, y - 6);
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Hit-test in world space; topmost (last drawn) item wins. */
export function pickItem(items: ResolvedItem[], world: Vec2): ResolvedItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const dx = world.x - item.obb.center.x;
    const dy = world.y - item.obb.center.y;
    const cos = Math.cos(-item.placed.rotation);
    const sin = Math.sin(-item.placed.rotation);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) <= item.obb.size.x / 2 && Math.abs(ly) <= item.obb.size.y / 2) return item;
  }
  return null;
}

/** Screen-space position of the rotate handle for a selected item. */
export function rotateHandlePosition(item: ResolvedItem, vp: Viewport): Vec2 {
  const yaw = item.placed.rotation;
  const front = { x: -Math.sin(yaw), y: Math.cos(yaw) };
  const world = {
    x: item.obb.center.x + front.x * (item.size.z / 2 + 0.42),
    y: item.obb.center.y + front.y * (item.size.z / 2 + 0.42),
  };
  return worldToScreen(vp, world);
}
