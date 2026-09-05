'use client';

/**
 * Capture: photograph in, measured room out.
 *
 * Four steps, each one showing its working:
 *   1. the photo,
 *   2. calibration — line segments, vanishing points, recovered focal length,
 *      and the single number the whole metric scale hangs on (camera height),
 *   3. the floor quad, which fixes the walls, with an option to correct the
 *      scale from any wall length you actually know,
 *   4. objects, boxed either by hand or by an optional vision model, each one
 *      reporting its measured size the instant you draw it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Crosshair,
  Info,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge, Button, Field, NumberInput, Panel, TextInput, cn } from '@/components/ui/primitives';
import { type Vec2, v2, v3 } from '@/lib/geometry/vec';
import { type AnalyzeResult } from '@/lib/vision/analyze';
import { analyzeImage, readPixels, sampleBoxColor } from '@/lib/vision/client';
import { type Calibration, imageToFloor } from '@/lib/vision/calibration';
import { type LiftedObject, fitFloorFromQuad, liftDetection, normaliseToOrigin } from '@/lib/vision/reconstruct';
import { deviceUtcOffsetMinutes } from '@/lib/constraints/solar';
import { CATEGORY_KEYS, categoryFromLabel, estimateMass, priorFor } from '@/lib/domain/catalog';
import type { Detection2D, FurnitureCategory, InventoryItem, Layout, Photo, Project, Room, RoomKind } from '@/lib/domain/types';
import { db } from '@/lib/db';
import { formatLength } from '@/lib/format';
import { useStudio } from '@/lib/store/studio';

type Step = 'photo' | 'calibrate' | 'floor' | 'objects' | 'save';

interface Box {
  id: string;
  label: string;
  category: FurnitureCategory;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  color?: string;
}

const STEPS: { key: Step; label: string; blurb: string }[] = [
  { key: 'photo', label: 'Photograph', blurb: 'One wide shot that shows a corner and some floor.' },
  { key: 'calibrate', label: 'Calibrate', blurb: 'Recover the camera from the geometry in the image.' },
  { key: 'floor', label: 'Floor', blurb: 'Mark the visible floor to fix the walls and the scale.' },
  { key: 'objects', label: 'Objects', blurb: 'Box each piece; its real size is measured as you draw.' },
  { key: 'save', label: 'Save', blurb: 'Write the room, the inventory and the first arrangement.' },
];

export function CaptureWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [pixels, setPixels] = useState<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraHeight, setCameraHeight] = useState(1.55);
  const [quad, setQuad] = useState<Vec2[] | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBox, setSelectedBox] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('Living room');
  const [roomKind, setRoomKind] = useState<RoomKind>('living');
  const [knownWall, setKnownWall] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const loadProject = useStudio((s) => s.loadProject);

  // --- photo ---------------------------------------------------------------
  const analyse = useCallback(
    async (raw: { pixels: Uint8ClampedArray; width: number; height: number }, height: number) => {
      setAnalyzing(true);
      try {
        const result = await analyzeImage({
          pixels: raw.pixels,
          width: raw.width,
          height: raw.height,
          cameraHeight: height,
        });
        setAnalysis(result);
      } finally {
        setAnalyzing(false);
      }
    },
    [],
  );

  const onFile = useCallback(
    async (f: File) => {
      setFile(f);
      setAnalysis(null);
      setBoxes([]);
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(f);
      });

      const raw = await readPixels(f);
      setPixels(raw);
      // A sensible starting floor quad: the lower-middle band of the frame,
      // which is where the floor almost always is in a room photograph.
      setQuad([
        v2(raw.width * 0.12, raw.height * 0.72),
        v2(raw.width * 0.88, raw.height * 0.72),
        v2(raw.width * 0.97, raw.height * 0.97),
        v2(raw.width * 0.03, raw.height * 0.97),
      ]);
      setStep('calibrate');
      await analyse(raw, cameraHeight);
    },
    [analyse, cameraHeight],
  );

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const resetQuad = useCallback(() => {
    if (!pixels) return;
    setQuad([
      v2(pixels.width * 0.12, pixels.height * 0.72),
      v2(pixels.width * 0.88, pixels.height * 0.72),
      v2(pixels.width * 0.97, pixels.height * 0.97),
      v2(pixels.width * 0.03, pixels.height * 0.97),
    ]);
  }, [pixels]);

  /**
   * Camera height is a pure scale factor, so changing it never needs a re-run
   * of the expensive vision pass — just rescale the calibration.
   */
  const calibration: Calibration | null = useMemo(() => {
    if (!analysis) return null;
    return { ...analysis.calibration, cameraHeight };
  }, [analysis, cameraHeight]);

  const floorFit = useMemo(() => {
    if (!calibration || !quad) return null;
    return fitFloorFromQuad(calibration, quad);
  }, [calibration, quad]);

  /** Correcting a known wall length re-solves the camera height. */
  const applyKnownWall = () => {
    if (!floorFit || !knownWall || knownWall <= 0) return;
    const factor = knownWall / floorFit.width;
    setCameraHeight((h) => Math.max(0.4, Math.min(3.5, h * factor)));
    setKnownWall(null);
  };

  const lifted: LiftedObject[] = useMemo(() => {
    if (!calibration) return [];
    const roomPolygon = floorFit?.rectangle;
    return boxes
      .map((b) => {
        const detection: Detection2D = {
          id: b.id,
          label: b.label,
          category: b.category,
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
          score: b.score,
          color: b.color,
        };
        return liftDetection(calibration, detection, { roomPolygon });
      })
      .filter((x): x is LiftedObject => Boolean(x));
  }, [boxes, calibration, floorFit]);

  // --- detection -----------------------------------------------------------
  const runDetection = async () => {
    if (!file) return;
    setDetecting(true);
    setDetectError(null);
    try {
      const dataUrl = await downscaleToDataUrl(file, 1280);
      const response = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const json = await response.json();
      if (!response.ok) {
        setDetectError(json.message ?? 'Detection failed.');
        return;
      }
      const incoming: Detection2D[] = json.detections ?? [];
      setBoxes((prev) => [
        ...prev,
        ...incoming.map((d) => ({
          id: nanoid(8),
          label: d.label,
          category: d.category,
          x: d.box.x,
          y: d.box.y,
          width: d.box.width,
          height: d.box.height,
          score: d.score,
          color: pixels ? sampleBoxColor(pixels.pixels, pixels.width, pixels.height, d.box) : undefined,
        })),
      ]);
    } catch (error) {
      setDetectError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetecting(false);
    }
  };

  // --- save ----------------------------------------------------------------
  const save = async () => {
    if (!calibration || !floorFit || !file || !pixels) return;
    setSaving(true);
    try {
      const now = Date.now();
      const normalised = normaliseToOrigin(floorFit.rectangle, lifted, 0);
      const projectId = nanoid(10);
      const roomId = nanoid(10);

      const project: Project = {
        id: projectId,
        name: roomName,
        unitSystem: 'metric',
        latitude: 51.5072,
        longitude: -0.1276,
        utcOffsetMinutes: deviceUtcOffsetMinutes(),
        createdAt: now,
        updatedAt: now,
      };

      const room: Room = {
        id: roomId,
        projectId,
        name: roomName,
        kind: roomKind,
        footprint: normalised.polygon,
        ceilingHeight: 2.45,
        northAngle: 0,
        planOrigin: v2(0, 0),
        createdAt: now,
      };

      const items: InventoryItem[] = normalised.objects.map((o) => {
        const prior = priorFor(o.category);
        return {
          id: nanoid(10),
          projectId,
          label: o.label,
          category: o.category,
          size: v3(o.size.x, o.size.y, o.size.z),
          massKg: o.massKg,
          movability: prior.movability,
          color: o.color,
          sourcePhotoId: 'capture',
          confidence: o.confidence,
          needsPower: prior.needsPower,
          cordLength: prior.cordLength,
          tags: [],
          notes: o.provenance.join(' '),
          quantityOnHand: 1,
          createdAt: now,
        };
      });

      const layout: Layout = {
        id: nanoid(10),
        projectId,
        roomId,
        name: 'As photographed',
        items: normalised.objects.map((o, i) => ({
          itemId: items[i].id,
          position: o.position,
          rotation: o.rotation,
          elevation: o.elevation,
          scale: 1,
          locked: false,
          roomId,
        })),
        isCurrent: true,
        color: '#8fa8c8',
        createdAt: now,
        updatedAt: now,
      };

      const photo: Photo = {
        id: nanoid(10),
        roomId,
        projectId,
        blob: file,
        width: pixels.width,
        height: pixels.height,
        calibration,
        floorQuad: quad ?? undefined,
        cameraHeight,
        takenAt: now,
        label: file.name,
      };

      const d = db();
      await d.transaction('rw', [d.projects, d.rooms, d.items, d.layouts, d.photos], async () => {
        await d.projects.put(project);
        await d.rooms.put(room);
        await d.items.bulkPut(items);
        await d.layouts.put(layout);
        await d.photos.put(photo);
      });

      await loadProject(projectId);
      router.push(`/studio?project=${projectId}`);
    } finally {
      setSaving(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="flex h-screen flex-col bg-ink-950">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-[color:var(--hairline)] px-3">
        <button onClick={() => router.push('/studio')} className="flex items-center gap-1.5 text-[13px] text-ink-400 hover:text-ink-100">
          <ArrowLeft size={14} /> Studio
        </button>
        <ol className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1">
              <button
                disabled={i > stepIndex && !(i === stepIndex + 1)}
                onClick={() => i <= stepIndex && setStep(s.key)}
                className={cn(
                  'rounded px-2 py-1 text-[12px] transition-colors',
                  i === stepIndex
                    ? 'bg-brass-500/15 text-brass-300'
                    : i < stepIndex
                      ? 'text-ink-300 hover:bg-ink-800'
                      : 'text-ink-600',
                )}
              >
                <span className="tabular mr-1.5 text-[10.5px] text-ink-500">{i + 1}</span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="text-ink-700">·</span>}
            </li>
          ))}
        </ol>
        <span className="ml-auto text-[12px] text-ink-500">{STEPS[stepIndex]?.blurb}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-[#08090c]">
          {!url && <DropZone onFile={onFile} />}
          {url && pixels && (
            <PhotoStage
              url={url}
              width={pixels.width}
              height={pixels.height}
              step={step}
              analysis={analysis}
              calibration={calibration}
              quad={quad}
              onQuadChange={setQuad}
              boxes={boxes}
              onBoxesChange={setBoxes}
              selectedBox={selectedBox}
              onSelectBox={setSelectedBox}
              lifted={lifted}
              pixels={pixels}
            />
          )}
          {analyzing && (
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-ink-900/90 px-3 py-2 text-[12px] text-brass-300">
              <Loader2 size={13} className="animate-spin" />
              detecting line segments and solving for the camera…
            </div>
          )}
        </div>

        <aside className="flex w-[352px] shrink-0 flex-col gap-2 border-l border-[color:var(--hairline)] p-2">
          {step === 'photo' && <PhotoStep onFile={onFile} />}

          {step === 'calibrate' && (
            <CalibrateStep
              analysis={analysis}
              calibration={calibration}
              cameraHeight={cameraHeight}
              onCameraHeight={setCameraHeight}
              onRerun={() => pixels && void analyse(pixels, cameraHeight)}
              analyzing={analyzing}
            />
          )}

          {step === 'floor' && (
            <FloorStep
              fit={floorFit}
              knownWall={knownWall}
              onKnownWall={setKnownWall}
              onApplyKnownWall={applyKnownWall}
              cameraHeight={cameraHeight}
              onResetQuad={resetQuad}
            />
          )}

          {step === 'objects' && (
            <ObjectsStep
              boxes={boxes}
              lifted={lifted}
              selected={selectedBox}
              onSelect={setSelectedBox}
              onChange={setBoxes}
              onDetect={runDetection}
              detecting={detecting}
              detectError={detectError}
            />
          )}

          {step === 'save' && (
            <SaveStep
              roomName={roomName}
              onRoomName={setRoomName}
              roomKind={roomKind}
              onRoomKind={setRoomKind}
              fit={floorFit}
              lifted={lifted}
              onSave={() => void save()}
              saving={saving}
            />
          )}

          <div className="flex shrink-0 items-center justify-between gap-2 px-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={stepIndex <= 0}
              onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}
            >
              <ArrowLeft size={13} /> Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={
                stepIndex >= STEPS.length - 1 ||
                (step === 'photo' && !url) ||
                (step === 'calibrate' && !analysis) ||
                (step === 'floor' && !floorFit)
              }
              onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].key)}
            >
              Next <ArrowRight size={13} />
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

function PhotoStage({
  url,
  width,
  height,
  step,
  analysis,
  calibration,
  quad,
  onQuadChange,
  boxes,
  onBoxesChange,
  selectedBox,
  onSelectBox,
  lifted,
  pixels,
}: {
  url: string;
  width: number;
  height: number;
  step: Step;
  analysis: AnalyzeResult | null;
  calibration: Calibration | null;
  quad: Vec2[] | null;
  onQuadChange: (q: Vec2[]) => void;
  boxes: Box[];
  onBoxesChange: (b: Box[]) => void;
  selectedBox: string | null;
  onSelectBox: (id: string | null) => void;
  lifted: LiftedObject[];
  pixels: { pixels: Uint8ClampedArray; width: number; height: number };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const segmentsRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<
    | { kind: 'corner'; index: number }
    | { kind: 'draw'; start: Vec2 }
    | { kind: 'box'; id: string; grab: Vec2 }
    | { kind: 'resize'; id: string }
    | null
  >(null);

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
    if (!size.width || !size.height) return null;
    const scale = Math.min(size.width / width, size.height / height);
    return {
      scale,
      offsetX: (size.width - width * scale) / 2,
      offsetY: (size.height - height * scale) / 2,
    };
  }, [size, width, height]);

  const toScreen = useCallback(
    (p: Vec2) => (fit ? v2(fit.offsetX + p.x * fit.scale, fit.offsetY + p.y * fit.scale) : p),
    [fit],
  );
  const toImage = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const rect = wrapRef.current!.getBoundingClientRect();
      if (!fit) return v2(0, 0);
      return v2(
        (clientX - rect.left - fit.offsetX) / fit.scale,
        (clientY - rect.top - fit.offsetY) / fit.scale,
      );
    },
    [fit],
  );

  // Draw the detected line segments, coloured by which vanishing point they
  // voted for. This is the single most reassuring thing to look at.
  useEffect(() => {
    const canvas = segmentsRef.current;
    if (!canvas || !fit || !analysis || step !== 'calibrate') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const analysisScale = width / analysis.analysisWidth;
    const colours = ['#6bb6a1', '#dcb066', '#8f9fd6'];
    const assigned = new Map<number, string>();
    analysis.clusters.forEach((cluster, ci) => {
      cluster.indices.forEach((i) => assigned.set(i, colours[ci % colours.length]));
    });

    analysis.segments.forEach((s, i) => {
      const colour = assigned.get(i);
      ctx.strokeStyle = colour ?? 'rgba(140,150,165,0.22)';
      ctx.lineWidth = colour ? 1.7 : 0.8;
      const a = toScreen(v2(s.a.x * analysisScale, s.a.y * analysisScale));
      const b = toScreen(v2(s.b.x * analysisScale, s.b.y * analysisScale));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    // Horizon.
    if (calibration?.horizonLine) {
      const [a, b, c] = calibration.horizonLine;
      const y = (x: number) => (-c - a * x) / (b || 1e-6);
      const p1 = toScreen(v2(0, y(0)));
      const p2 = toScreen(v2(width, y(width)));
      ctx.strokeStyle = 'rgba(236,201,143,0.5)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [analysis, calibration, fit, size, step, toScreen, width]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!fit) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const img = toImage(e.clientX, e.clientY);

    if (step === 'floor' && quad) {
      const hit = quad.findIndex((p) => {
        const s = toScreen(p);
        const c = toScreen(img);
        return Math.hypot(s.x - c.x, s.y - c.y) < 18;
      });
      if (hit >= 0) {
        setDrag({ kind: 'corner', index: hit });
        return;
      }
    }

    if (step === 'objects') {
      const nx = img.x / width;
      const ny = img.y / height;
      // Resize handle first.
      for (const b of boxes) {
        const br = toScreen(v2((b.x + b.width) * width, (b.y + b.height) * height));
        const cur = toScreen(img);
        if (Math.hypot(br.x - cur.x, br.y - cur.y) < 14) {
          onSelectBox(b.id);
          setDrag({ kind: 'resize', id: b.id });
          return;
        }
      }
      const hit = [...boxes]
        .reverse()
        .find((b) => nx >= b.x && nx <= b.x + b.width && ny >= b.y && ny <= b.y + b.height);
      if (hit) {
        onSelectBox(hit.id);
        setDrag({ kind: 'box', id: hit.id, grab: v2(nx - hit.x, ny - hit.y) });
        return;
      }
      onSelectBox(null);
      setDrag({ kind: 'draw', start: v2(nx, ny) });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !fit) return;
    const img = toImage(e.clientX, e.clientY);
    const nx = Math.max(0, Math.min(1, img.x / width));
    const ny = Math.max(0, Math.min(1, img.y / height));

    if (drag.kind === 'corner' && quad) {
      const next = quad.slice();
      next[drag.index] = v2(
        Math.max(0, Math.min(width, img.x)),
        Math.max(0, Math.min(height, img.y)),
      );
      onQuadChange(next);
      return;
    }

    if (drag.kind === 'draw') {
      const x = Math.min(drag.start.x, nx);
      const y = Math.min(drag.start.y, ny);
      const w = Math.abs(nx - drag.start.x);
      const h = Math.abs(ny - drag.start.y);
      const existing = boxes.find((b) => b.id === '__draft');
      const draft: Box = {
        id: '__draft',
        label: 'New piece',
        category: 'other',
        x,
        y,
        width: w,
        height: h,
        score: 0.85,
      };
      onBoxesChange(existing ? boxes.map((b) => (b.id === '__draft' ? draft : b)) : [...boxes, draft]);
      return;
    }

    if (drag.kind === 'box') {
      onBoxesChange(
        boxes.map((b) =>
          b.id === drag.id
            ? {
                ...b,
                x: Math.max(0, Math.min(1 - b.width, nx - drag.grab.x)),
                y: Math.max(0, Math.min(1 - b.height, ny - drag.grab.y)),
              }
            : b,
        ),
      );
      return;
    }

    if (drag.kind === 'resize') {
      onBoxesChange(
        boxes.map((b) =>
          b.id === drag.id
            ? { ...b, width: Math.max(0.01, nx - b.x), height: Math.max(0.01, ny - b.y) }
            : b,
        ),
      );
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === 'draw') {
      const draft = boxes.find((b) => b.id === '__draft');
      if (draft && draft.width > 0.02 && draft.height > 0.02) {
        const id = nanoid(8);
        const colour = sampleBoxColor(pixels.pixels, pixels.width, pixels.height, {
          x: draft.x,
          y: draft.y,
          width: draft.width,
          height: draft.height,
        });
        onBoxesChange(
          boxes.map((b) => (b.id === '__draft' ? { ...b, id, color: colour } : b)),
        );
        onSelectBox(id);
      } else {
        onBoxesChange(boxes.filter((b) => b.id !== '__draft'));
      }
    }
    setDrag(null);
  };

  const liftedById = new Map(lifted.map((l) => [l.detectionId, l]));

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ cursor: step === 'objects' && !drag ? 'crosshair' : 'default' }}
    >
      {fit && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Room"
          draggable={false}
          className="pointer-events-none absolute"
          style={{
            left: fit.offsetX,
            top: fit.offsetY,
            width: width * fit.scale,
            height: height * fit.scale,
            opacity: step === 'calibrate' ? 0.62 : 1,
          }}
        />
      )}

      <canvas ref={segmentsRef} className="pointer-events-none absolute inset-0" />

      {fit && step === 'floor' && quad && (
        <svg className="pointer-events-none absolute inset-0" width={size.width} height={size.height}>
          <polygon
            points={quad.map((p) => { const s = toScreen(p); return `${s.x},${s.y}`; }).join(' ')}
            fill="rgba(107,182,161,0.16)"
            stroke="#6bb6a1"
            strokeWidth={2}
          />
          {quad.map((p, i) => {
            const s = toScreen(p);
            return (
              <g key={i}>
                <circle cx={s.x} cy={s.y} r={9} fill="#0b0d10" stroke="#6bb6a1" strokeWidth={2.5} />
                <circle cx={s.x} cy={s.y} r={2.5} fill="#6bb6a1" />
              </g>
            );
          })}
        </svg>
      )}

      {fit && step === 'objects' && (
        <svg className="pointer-events-none absolute inset-0" width={size.width} height={size.height}>
          {boxes.map((b) => {
            const tl = toScreen(v2(b.x * width, b.y * height));
            const br = toScreen(v2((b.x + b.width) * width, (b.y + b.height) * height));
            const active = selectedBox === b.id;
            const info = liftedById.get(b.id);
            return (
              <g key={b.id}>
                <rect
                  x={tl.x}
                  y={tl.y}
                  width={br.x - tl.x}
                  height={br.y - tl.y}
                  fill={active ? 'rgba(220,176,102,0.12)' : 'rgba(107,182,161,0.07)'}
                  stroke={active ? '#dcb066' : '#6bb6a1'}
                  strokeWidth={active ? 2.2 : 1.5}
                />
                {/* the floor-contact edge is what actually gets measured */}
                <line
                  x1={tl.x}
                  y1={br.y}
                  x2={br.x}
                  y2={br.y}
                  stroke={active ? '#dcb066' : '#6bb6a1'}
                  strokeWidth={3.5}
                />
                <rect x={br.x - 6} y={br.y - 6} width={12} height={12} fill="#0b0d10" stroke="#dcb066" strokeWidth={2} />
                <text x={tl.x + 4} y={tl.y - 6} fill={active ? '#ecc98f' : '#b5bfcd'} fontSize={12} fontFamily="ui-sans-serif, system-ui">
                  {b.label}
                  {info && ` · ${info.size.x.toFixed(2)} × ${info.size.y.toFixed(2)} m`}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {step === 'objects' && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-ink-900/85 px-2.5 py-1.5 text-[11.5px] text-ink-400">
          Drag a box around each piece. The thick bottom edge is the floor line — that is what gets measured, so keep it on the ground.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function DropZone({ onFile }: { onFile: (f: File) => void | Promise<void> }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void onFile(f);
      }}
      className={cn(
        'absolute inset-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors',
        over ? 'border-brass-400 bg-brass-500/5' : 'border-[color:var(--hairline)] hover:border-ink-500',
      )}
    >
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <Upload size={30} className="text-ink-600" />
      <div className="text-center">
        <div className="text-[14px] text-ink-200">Drop a photograph of the room</div>
        <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-500">
          One wide shot works best. Include a corner where two walls meet the floor, keep the camera
          roughly upright, and try not to crop the bottom of the furniture — the floor line is what
          gets measured.
        </p>
      </div>
    </label>
  );
}

function PhotoStep({ onFile }: { onFile: (f: File) => void | Promise<void> }) {
  return (
    <Panel title="What makes a good photograph" className="min-h-0">
      <div className="space-y-3 overflow-y-auto p-3 text-[12.5px] leading-relaxed text-ink-300">
        <p>
          Everything downstream rests on recovering the camera from this one image, so the geometry
          in the shot matters more than the lighting.
        </p>
        <ul className="space-y-2">
          {[
            ['Show a corner.', 'Two walls meeting the floor give two horizontal vanishing directions, which is what pins down the focal length.'],
            ['Keep verticals vertical-ish.', 'Do not tilt the phone sideways. A little downward pitch is fine and actually helps.'],
            ['Include floor.', 'The floor line under each object is where the measurement comes from.'],
            ['Avoid the ultra-wide lens.', 'Heavy barrel distortion breaks the straight-line assumption everything here depends on.'],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-2">
              <Check size={13} className="mt-0.5 shrink-0 text-verdigris-400" />
              <span>
                <span className="text-ink-100">{title}</span> {body}
              </span>
            </li>
          ))}
        </ul>
        <label className="mt-2 block">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <span className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-brass-500 text-[13px] font-medium text-ink-950 hover:bg-brass-400">
            <Camera size={14} /> Choose a photograph
          </span>
        </label>
        <p className="text-[11.5px] text-ink-500">
          The image is decoded and analysed in your browser. It is written to this device&apos;s local
          database and never uploaded, unless you explicitly use the optional detection step.
        </p>
      </div>
    </Panel>
  );
}

function CalibrateStep({
  analysis,
  calibration,
  cameraHeight,
  onCameraHeight,
  onRerun,
  analyzing,
}: {
  analysis: AnalyzeResult | null;
  calibration: Calibration | null;
  cameraHeight: number;
  onCameraHeight: (v: number) => void;
  onRerun: () => void;
  analyzing: boolean;
}) {
  return (
    <Panel
      title="Camera"
      action={
        analysis && (
          <Badge tone={calibration && calibration.confidence > 0.6 ? 'good' : calibration && calibration.confidence > 0.35 ? 'warn' : 'bad'}>
            {Math.round((calibration?.confidence ?? 0) * 100)}% confident
          </Badge>
        )
      }
      className="min-h-0"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Field
          label="Lens height above the floor"
          hint="This is the only thing that sets the scale. Everything the app reports is proportional to it, so it is worth measuring rather than guessing."
        >
          <NumberInput value={cameraHeight} step={0.05} onChange={onCameraHeight} suffix="m" />
        </Field>
        <div className="flex flex-wrap gap-1">
          {[
            ['Eye level, standing', 1.55],
            ['Chest, standing', 1.35],
            ['Held up high', 1.85],
            ['Seated', 1.15],
          ].map(([label, value]) => (
            <button
              key={label as string}
              onClick={() => onCameraHeight(value as number)}
              className={cn(
                'rounded px-1.5 py-1 text-[11px] transition-colors',
                Math.abs(cameraHeight - (value as number)) < 0.01
                  ? 'bg-brass-500/20 text-brass-300'
                  : 'bg-ink-800 text-ink-400 hover:text-ink-100',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {calibration && (
          <div className="tabular grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-ink-900/60 p-2.5 text-[12px]">
            <span className="text-ink-500">Focal length</span>
            <span className="text-right text-ink-100">{Math.round(calibration.focal)} px</span>
            <span className="text-ink-500">Field of view</span>
            <span className="text-right text-ink-100">{calibration.fovDeg.toFixed(1)}° vertical</span>
            <span className="text-ink-500">Principal point</span>
            <span className="text-right text-ink-100">
              {calibration.principal.x.toFixed(0)}, {calibration.principal.y.toFixed(0)}
            </span>
            <span className="text-ink-500">Solved from</span>
            <span className="text-right text-ink-100">
              {calibration.source === 'vanishing-points' ? 'vanishing points' : 'assumed lens'}
            </span>
          </div>
        )}

        {analysis && (
          <div>
            <div className="rule-label mb-1.5">What the geometry gave us</div>
            <ul className="space-y-1.5">
              {analysis.diagnostics.map((d, i) => (
                <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-400">
                  <Info size={12} className="mt-0.5 shrink-0 text-ink-600" />
                  {d}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-600">
              Analysed in {analysis.elapsedMs} ms at {analysis.analysisWidth}×{analysis.analysisHeight}.
              Green, brass and violet segments each voted for one vanishing direction; grey ones were
              rejected as outliers.
            </p>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={onRerun} disabled={analyzing}>
          {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
          Re-run detection
        </Button>
      </div>
    </Panel>
  );
}

function FloorStep({
  fit,
  knownWall,
  onKnownWall,
  onApplyKnownWall,
  cameraHeight,
  onResetQuad,
}: {
  fit: ReturnType<typeof fitFloorFromQuad>;
  knownWall: number | null;
  onKnownWall: (v: number | null) => void;
  onApplyKnownWall: () => void;
  cameraHeight: number;
  onResetQuad: () => void;
}) {
  return (
    <Panel title="Floor & scale" className="min-h-0">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-[12.5px] leading-relaxed text-ink-300">
          Drag the four handles onto the visible floor, ideally into the corners where the walls
          meet it. Each corner is back-projected through the camera onto the ground plane, which is
          what turns pixels into metres.
        </p>

        {fit ? (
          <>
            <div className="tabular grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-ink-900/60 p-2.5 text-[12.5px]">
              <span className="text-ink-500">Width</span>
              <span className="text-right text-ink-100">{formatLength(fit.width)}</span>
              <span className="text-ink-500">Depth</span>
              <span className="text-right text-ink-100">{formatLength(fit.depth)}</span>
              <span className="text-ink-500">Floor area</span>
              <span className="text-right text-ink-100">{fit.area.toFixed(2)} m²</span>
              <span className="text-ink-500">Squareness</span>
              <span className="text-right text-ink-100">{(100 - fit.skew * 100).toFixed(0)}%</span>
            </div>

            {fit.skew > 0.22 && (
              <p className="rounded-md border border-signal-amber/30 bg-signal-amber/10 p-2 text-[11.5px] leading-relaxed text-signal-amber">
                The quad back-projects to a noticeably non-rectangular shape. Either the room really
                is not square, or the calibration is off. The rectangle fitted to it is what gets
                saved.
              </p>
            )}

            <Field
              label="Correct the scale"
              hint="If you know one real wall length, enter it. Camera height is re-solved from it, and every measurement in the project moves with it."
            >
              <div className="flex gap-1.5">
                <NumberInput
                  value={knownWall ?? fit.width}
                  step={0.05}
                  onChange={(v) => onKnownWall(v)}
                  suffix="m"
                  className="flex-1"
                />
                <Button size="sm" variant="subtle" onClick={onApplyKnownWall} disabled={!knownWall}>
                  Apply
                </Button>
              </div>
            </Field>
            <p className="tabular text-[11px] text-ink-500">
              implies a lens height of{' '}
              {knownWall ? ((cameraHeight * knownWall) / fit.width).toFixed(2) : cameraHeight.toFixed(2)} m
            </p>
          </>
        ) : (
          <p className="rounded-md border border-signal-red/30 bg-signal-red/10 p-2 text-[12px] leading-relaxed text-signal-red">
            At least one handle is on or above the horizon, where the ground plane is unreachable.
            Drag it lower.
          </p>
        )}

        <Button variant="outline" size="sm" onClick={onResetQuad}>
          Reset the quad
        </Button>
      </div>
    </Panel>
  );
}

function ObjectsStep({
  boxes,
  lifted,
  selected,
  onSelect,
  onChange,
  onDetect,
  detecting,
  detectError,
}: {
  boxes: Box[];
  lifted: LiftedObject[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (b: Box[]) => void;
  onDetect: () => void;
  detecting: boolean;
  detectError: string | null;
}) {
  const liftedById = new Map(lifted.map((l) => [l.detectionId, l]));
  const active = boxes.find((b) => b.id === selected);
  const activeLift = active ? liftedById.get(active.id) : null;

  return (
    <Panel
      title="Objects"
      action={
        <Button size="sm" variant="subtle" onClick={onDetect} disabled={detecting}>
          {detecting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          Auto-detect
        </Button>
      }
      className="min-h-0"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {detectError && (
          <p className="rounded-md border border-signal-amber/30 bg-signal-amber/10 p-2 text-[11.5px] leading-relaxed text-signal-amber">
            {detectError}
          </p>
        )}

        {boxes.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Drag a rectangle around each piece of furniture. Width and floor position are measured
            from the bottom edge; height comes from the top edge; depth is filled in from the
            category, because a single photograph cannot see the back of anything.
          </p>
        )}

        {active && (
          <div className="space-y-2 rounded-md border border-brass-500/30 bg-ink-900/70 p-2.5">
            <TextInput
              value={active.label}
              onChange={(e) =>
                onChange(boxes.map((b) => (b.id === active.id ? { ...b, label: e.target.value } : b)))
              }
              className="w-full"
            />
            <select
              value={active.category}
              onChange={(e) => {
                const category = e.target.value as FurnitureCategory;
                onChange(
                  boxes.map((b) =>
                    b.id === active.id
                      ? { ...b, category, label: b.label === 'New piece' ? priorFor(category).label : b.label }
                      : b,
                  ),
                );
              }}
              className="h-8 w-full rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2 text-[12.5px] text-ink-100 focus:border-brass-500 focus:outline-none"
            >
              {CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {priorFor(c).label}
                </option>
              ))}
            </select>

            {activeLift && (
              <>
                <div className="tabular grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]">
                  <span className="text-ink-500">Measured</span>
                  <span className="text-right text-ink-100">
                    {activeLift.size.x.toFixed(2)} × {activeLift.size.y.toFixed(2)} m
                  </span>
                  <span className="text-ink-500">Depth (inferred)</span>
                  <span className="text-right text-ink-300">{activeLift.size.z.toFixed(2)} m</span>
                  <span className="text-ink-500">Distance</span>
                  <span className="text-right text-ink-300">
                    {Math.hypot(activeLift.position.x, activeLift.position.y).toFixed(2)} m
                  </span>
                  <span className="text-ink-500">Mass estimate</span>
                  <span className="text-right text-ink-300">{activeLift.massKg.toFixed(0)} kg</span>
                  {activeLift.elevation > 0.02 && (
                    <>
                      <span className="text-ink-500">Mounted at</span>
                      <span className="text-right text-brass-300">{activeLift.elevation.toFixed(2)} m</span>
                    </>
                  )}
                </div>
                <ul className="space-y-1">
                  {activeLift.provenance.map((p, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-ink-500">
                      · {p}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button
              onClick={() => {
                onChange(boxes.filter((b) => b.id !== active.id));
                onSelect(null);
              }}
              className="flex items-center gap-1 text-[11.5px] text-ink-500 hover:text-signal-red"
            >
              <Trash2 size={11} /> remove
            </button>
          </div>
        )}

        <div className="space-y-0.5">
          {boxes
            .filter((b) => b.id !== '__draft')
            .map((b) => {
              const info = liftedById.get(b.id);
              return (
                <button
                  key={b.id}
                  onClick={() => onSelect(b.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                    selected === b.id ? 'bg-ink-800' : 'hover:bg-ink-800/60',
                  )}
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded border border-[color:var(--hairline)]"
                    style={{ background: b.color ?? priorFor(b.category).color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink-100">{b.label}</span>
                    <span className="tabular block text-[10.5px] text-ink-500">
                      {info
                        ? `${info.size.x.toFixed(2)} × ${info.size.z.toFixed(2)} m · ${Math.round(info.confidence * 100)}%`
                        : 'not measurable — bottom edge is above the horizon'}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </Panel>
  );
}

function SaveStep({
  roomName,
  onRoomName,
  roomKind,
  onRoomKind,
  fit,
  lifted,
  onSave,
  saving,
}: {
  roomName: string;
  onRoomName: (v: string) => void;
  roomKind: RoomKind;
  onRoomKind: (v: RoomKind) => void;
  fit: ReturnType<typeof fitFloorFromQuad>;
  lifted: LiftedObject[];
  onSave: () => void;
  saving: boolean;
}) {
  const lowConfidence = lifted.filter((l) => l.confidence < 0.45).length;
  return (
    <Panel title="Save the room" className="min-h-0">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Field label="Name">
          <TextInput value={roomName} onChange={(e) => onRoomName(e.target.value)} />
        </Field>
        <Field label="Kind" hint="Decides which categories are offered first and which checks matter.">
          <select
            value={roomKind}
            onChange={(e) => onRoomKind(e.target.value as RoomKind)}
            className="h-8 w-full rounded-md border border-[color:var(--hairline)] bg-ink-900 px-2 text-[12.5px] text-ink-100 focus:border-brass-500 focus:outline-none"
          >
            {(['living', 'bedroom', 'kitchen', 'dining', 'office', 'nursery', 'studio', 'hallway', 'other'] as RoomKind[]).map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <div className="tabular space-y-1 rounded-md bg-ink-900/60 p-2.5 text-[12.5px]">
          <div className="flex justify-between">
            <span className="text-ink-500">Room</span>
            <span className="text-ink-100">
              {fit ? `${formatLength(fit.width)} × ${formatLength(fit.depth)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Pieces catalogued</span>
            <span className="text-ink-100">{lifted.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Low confidence</span>
            <span className={lowConfidence ? 'text-signal-amber' : 'text-ink-100'}>{lowConfidence}</span>
          </div>
        </div>

        <p className="text-[11.5px] leading-relaxed text-ink-500">
          Next: add the door and a socket or two in the room panel. Those two turn a shape into a set
          of constraints, and they are what the checks and the move plan actually run on.
        </p>

        <Button variant="primary" onClick={onSave} disabled={saving || !fit}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Create the project
        </Button>
      </div>
    </Panel>
  );
}

async function downscaleToDataUrl(file: File, maxDimension: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

export { imageToFloor, estimateMass, categoryFromLabel };
