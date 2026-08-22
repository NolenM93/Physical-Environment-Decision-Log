'use client';

/**
 * Browser-side entry point to the vision pipeline. Keeps exactly one worker
 * alive and falls back to running on the main thread where workers are not
 * available (which keeps SSR and older browsers honest rather than broken).
 */

import type { AnalyzeRequest, AnalyzeResult } from './analyze';
import type { WorkerRequest, WorkerResponse } from './analyze.worker';

let worker: Worker | null = null;
let counter = 0;
const pending = new Map<string, { resolve: (r: AnalyzeResult) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./analyze.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const entry = pending.get(event.data.requestId);
      if (!entry) return;
      pending.delete(event.data.requestId);
      if (event.data.ok) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      for (const [, entry] of pending) entry.reject(new Error('Vision worker crashed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

export async function analyzeImage(request: AnalyzeRequest): Promise<AnalyzeResult> {
  const w = ensureWorker();
  if (!w) {
    const { analyzePhoto } = await import('./analyze');
    return analyzePhoto(request);
  }
  const requestId = `a${++counter}`;
  const message: WorkerRequest = { ...request, requestId };
  return new Promise<AnalyzeResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    w.postMessage(message);
  });
}

/** Decode a File/Blob to raw pixels without touching the DOM tree. */
export async function readPixels(
  source: Blob,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { pixels: data.data, width: bitmap.width, height: bitmap.height };
}

/** Average colour of a normalised box, used to tint reconstructed furniture. */
export function sampleBoxColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  box: { x: number; y: number; width: number; height: number },
): string {
  const x0 = Math.max(0, Math.floor(box.x * width));
  const y0 = Math.max(0, Math.floor(box.y * height));
  const x1 = Math.min(width, Math.ceil((box.x + box.width) * width));
  const y1 = Math.min(height, Math.ceil((box.y + box.height) * height));
  if (x1 <= x0 || y1 <= y0) return '#9aa0a6';

  const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 24));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const p = (y * width + x) * 4;
      r += pixels[p];
      g += pixels[p + 1];
      b += pixels[p + 2];
      n++;
    }
  }
  if (!n) return '#9aa0a6';
  // Nudge toward mid-tones so lifted furniture stays readable in the 3D view.
  const mix = (v: number) => Math.round(Math.min(235, Math.max(40, (v / n) * 0.85 + 26)));
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
