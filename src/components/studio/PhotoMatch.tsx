'use client';

/**
 * Photo match.
 *
 * The reconstructed room, drawn back onto the photograph it came from, using
 * the recovered focal length and camera pose. This is the honesty check: if
 * the boxes sit on the real furniture, the calibration is right and the
 * measurements mean something. If they float, it is wrong and you should say
 * so rather than quietly believing the numbers.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui/primitives';
import { type Vec2, v2, v3 } from '@/lib/geometry/vec';
import { rescaleCalibration, worldToImage } from '@/lib/vision/calibration';
import type { Photo, Room } from '@/lib/domain/types';
import type { Evaluation } from '@/lib/constraints/evaluate';
import { db } from '@/lib/db';
import { useStudio } from '@/lib/store/studio';

export function PhotoMatch({ room, evaluation }: { room: Room; evaluation: Evaluation }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const [urls, setUrls] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const selection = useStudio((s) => s.selection);

  // Photos and their object URLs are loaded together so the URLs can be revoked
  // in the same cleanup that owns them.
  useEffect(() => {
    let cancelled = false;
    let created: string[] = [];
    db()
      .photos.where('roomId')
      .equals(room.id)
      .toArray()
      .then((rows) => {
        const usable = rows.filter((p) => p.calibration);
        if (cancelled) return;
        created = usable.map((p) => URL.createObjectURL(p.blob));
        setPhotos(usable);
        setUrls(created);
        setIndex(0);
      });
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [room.id]);

  const photo = photos[index] ?? null;
  const url = urls[index] ?? null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!photo || !size.width) return null;
    const scale = Math.min(size.width / photo.width, size.height / photo.height);
    return {
      scale,
      offsetX: (size.width - photo.width * scale) / 2,
      offsetY: (size.height - photo.height * scale) / 2,
    };
  }, [photo, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !photo || !fit || !photo.calibration) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, size.width * dpr);
    canvas.height = Math.max(1, size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const calib = rescaleCalibration(photo.calibration, photo.width);
    const project = (p: { x: number; y: number; z: number }): Vec2 | null => {
      const img = worldToImage(calib, v3(p.x, p.y, p.z));
      if (!img) return null;
      return v2(fit.offsetX + img.x * fit.scale, fit.offsetY + img.y * fit.scale);
    };

    // Room outline on the floor.
    ctx.strokeStyle = 'rgba(107,182,161,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of room.footprint) {
      const s = project({ x: p.x, y: 0, z: p.y });
      if (!s) continue;
      if (!started) {
        ctx.moveTo(s.x, s.y);
        started = true;
      } else ctx.lineTo(s.x, s.y);
    }
    if (started) {
      ctx.closePath();
      ctx.stroke();
    }

    // Every piece as a wireframe cuboid.
    for (const item of evaluation.resolved) {
      const isSelected = selection.includes(item.id);
      const yaw = item.placed.rotation;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const hx = item.size.x / 2;
      const hz = item.size.z / 2;
      const corner = (sx: number, sz: number) => ({
        x: item.obb.center.x + cos * sx * hx - sin * sz * hz,
        z: item.obb.center.y + sin * sx * hx + cos * sz * hz,
      });
      const base = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const lower = base.map((c) => project({ x: c.x, y: item.baseY, z: c.z }));
      const upper = base.map((c) => project({ x: c.x, y: item.topY, z: c.z }));
      if (lower.some((p) => !p) || upper.some((p) => !p)) continue;

      ctx.strokeStyle = isSelected ? '#dcb066' : item.item.color;
      ctx.lineWidth = isSelected ? 2.2 : 1.4;
      ctx.globalAlpha = isSelected ? 1 : 0.8;

      ctx.beginPath();
      lower.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      upper.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
      ctx.closePath();
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(lower[i]!.x, lower[i]!.y);
        ctx.lineTo(upper[i]!.x, upper[i]!.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      const label = project({ x: item.obb.center.x, y: item.topY + 0.08, z: item.obb.center.y });
      if (label) {
        ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
        const w = ctx.measureText(item.item.label).width + 8;
        ctx.fillStyle = 'rgba(11,13,16,0.8)';
        ctx.fillRect(label.x - w / 2, label.y - 16, w, 15);
        ctx.fillStyle = isSelected ? '#ecc98f' : '#dbe2ec';
        ctx.textAlign = 'center';
        ctx.fillText(item.item.label, label.x, label.y - 5);
      }
    }
  }, [photo, fit, size, room.footprint, evaluation.resolved, selection]);

  if (!photo) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="No calibrated photograph for this room" icon={<Camera size={26} />}>
          Photo match draws the reconstruction back onto the picture it came from, so you can see
          straight away whether the geometry is right.
          <div className="mt-3">
            <Link href="/capture">
              <Button size="sm" variant="primary">
                Capture one
              </Button>
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-ink-950">
      {url && fit && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={photo.label ?? 'Room photograph'}
          className="pointer-events-none absolute"
          style={{
            left: fit.offsetX,
            top: fit.offsetY,
            width: photo.width * fit.scale,
            height: photo.height * fit.scale,
          }}
        />
      )}
      <canvas ref={canvasRef} className="absolute inset-0" />

      {photos.length > 1 && (
        <div className="absolute bottom-3 left-3 flex gap-1">
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setIndex(i)}
              className={`h-1.5 w-6 rounded-full transition-colors ${
                i === index ? 'bg-brass-400' : 'bg-ink-700 hover:bg-ink-600'
              }`}
            />
          ))}
        </div>
      )}

      <div className="absolute left-3 top-3 rounded bg-ink-900/85 px-2 py-1 text-[11px] text-ink-400">
        {photo.calibration?.source === 'vanishing-points'
          ? `focal ${Math.round(photo.calibration.focal)} px · ${photo.calibration.fovDeg.toFixed(0)}° vertical · ${Math.round((photo.calibration.confidence ?? 0) * 100)}% confidence`
          : 'field of view was assumed — measurements scale with it'}
      </div>
    </div>
  );
}
