/**
 * Line-segment detection, in the spirit of LSD (Grompone von Gioi et al.).
 *
 * Pipeline: greyscale -> Gaussian pre-smoothing -> Sobel gradients -> pixels
 * sorted by gradient magnitude -> region growing over pixels whose *level-line*
 * orientation agrees with the running region mean -> principal-axis fit ->
 * endpoints from the extreme projections.
 *
 * We only need segments that are good enough to vote for vanishing points, so
 * the NFA validation step of true LSD is replaced by simple length/aniso-tropy
 * filters, which is far cheaper and empirically sufficient on interior photos.
 */

import { type Vec2, v2 } from '../geometry/vec';

export interface LineSegment {
  a: Vec2;
  b: Vec2;
  /** Pixel length. */
  length: number;
  /** Orientation of the segment in image space, wrapped to [0, PI). */
  angle: number;
  /** Mean gradient magnitude of the supporting region — used as a vote weight. */
  strength: number;
}

export interface DetectOptions {
  /** Gradient magnitude below which a pixel can never seed a region. */
  gradientThreshold?: number;
  /** Angular tolerance for region growing, radians. */
  angleTolerance?: number;
  /** Minimum segment length as a fraction of the image diagonal. */
  minLengthRatio?: number;
  /** Maximum segments returned (longest first). */
  maxSegments?: number;
}

export interface GreyImage {
  data: Float32Array;
  width: number;
  height: number;
}

/** Rec. 709 luma, with an optional box downscale to keep the cost bounded. */
export function toGreyscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxDimension = 900,
): GreyImage {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Float32Array(w * h);

  if (w === width && h === height) {
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    }
    return { data: out, width: w, height: h };
  }

  const sx = width / w;
  const sy = height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * width + xx) * 4;
          sum += 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
          n++;
        }
      }
      out[y * w + x] = n ? sum / n : 0;
    }
  }
  return { data: out, width: w, height: h };
}

/** Separable Gaussian blur, kernel radius derived from sigma. */
export function gaussianBlur(img: GreyImage, sigma = 0.8): GreyImage {
  if (sigma <= 0) return img;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += data[y * w + xx] * kernel[k + radius];
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return { data: out, width: w, height: h };
}

interface GradientField {
  magnitude: Float32Array;
  /** Level-line angle = gradient angle rotated 90°, wrapped to [0, PI). */
  levelAngle: Float32Array;
  width: number;
  height: number;
}

function sobel(img: GreyImage): GradientField {
  const { width: w, height: h, data } = img;
  const magnitude = new Float32Array(w * h);
  const levelAngle = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = data[i - w - 1];
      const t = data[i - w];
      const tr = data[i - w + 1];
      const l = data[i - 1];
      const r = data[i + 1];
      const bl = data[i + w - 1];
      const b = data[i + w];
      const br = data[i + w + 1];

      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);

      magnitude[i] = Math.hypot(gx, gy) / 4;
      // Level line runs perpendicular to the gradient.
      let a = Math.atan2(gx, -gy);
      if (a < 0) a += Math.PI;
      if (a >= Math.PI) a -= Math.PI;
      levelAngle[i] = a;
    }
  }
  return { magnitude, levelAngle, width: w, height: h };
}

/** Signed difference between two undirected orientations, in (-PI/2, PI/2]. */
function orientationDiff(a: number, b: number): number {
  let d = a - b;
  while (d <= -Math.PI / 2) d += Math.PI;
  while (d > Math.PI / 2) d -= Math.PI;
  return d;
}

export function detectLineSegments(img: GreyImage, options: DetectOptions = {}): LineSegment[] {
  const {
    gradientThreshold = 8,
    angleTolerance = (22.5 * Math.PI) / 180,
    minLengthRatio = 0.035,
    maxSegments = 900,
  } = options;

  const blurred = gaussianBlur(img, 0.8);
  const grad = sobel(blurred);
  const { width: w, height: h, magnitude, levelAngle } = grad;
  const minLength = Math.hypot(w, h) * minLengthRatio;

  // Bucket-sort pixel indices by gradient magnitude (descending) in O(n).
  const BUCKETS = 1024;
  let maxMag = 0;
  for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > maxMag) maxMag = magnitude[i];
  if (maxMag <= gradientThreshold) return [];

  const counts = new Int32Array(BUCKETS + 1);
  const bucketOf = (m: number) =>
    Math.min(BUCKETS - 1, Math.floor((m / maxMag) * (BUCKETS - 1)));
  let candidates = 0;
  for (let i = 0; i < magnitude.length; i++) {
    if (magnitude[i] < gradientThreshold) continue;
    counts[bucketOf(magnitude[i])]++;
    candidates++;
  }
  const offsets = new Int32Array(BUCKETS + 1);
  let running = 0;
  for (let b = BUCKETS - 1; b >= 0; b--) {
    offsets[b] = running;
    running += counts[b];
  }
  const order = new Int32Array(candidates);
  const cursor = offsets.slice();
  for (let i = 0; i < magnitude.length; i++) {
    if (magnitude[i] < gradientThreshold) continue;
    const b = bucketOf(magnitude[i]);
    order[cursor[b]++] = i;
  }

  const used = new Uint8Array(w * h);
  const segments: LineSegment[] = [];
  const queue = new Int32Array(w * h);
  const region = new Int32Array(w * h);

  for (let oi = 0; oi < order.length && segments.length < maxSegments * 3; oi++) {
    const seed = order[oi];
    if (used[seed]) continue;

    // Region growing with a running circular mean of the level-line angle.
    let sinSum = Math.sin(2 * levelAngle[seed]);
    let cosSum = Math.cos(2 * levelAngle[seed]);
    let regionAngle = levelAngle[seed];
    let head = 0;
    let tail = 0;
    let count = 0;
    queue[tail++] = seed;
    used[seed] = 1;
    region[count++] = seed;

    while (head < tail) {
      const p = queue[head++];
      const py = (p / w) | 0;
      const px = p - py * w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 1 || ny >= h - 1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          if (nx < 1 || nx >= w - 1) continue;
          const q = ny * w + nx;
          if (used[q] || magnitude[q] < gradientThreshold) continue;
          if (Math.abs(orientationDiff(levelAngle[q], regionAngle)) > angleTolerance) continue;
          used[q] = 1;
          queue[tail++] = q;
          region[count++] = q;
          sinSum += Math.sin(2 * levelAngle[q]);
          cosSum += Math.cos(2 * levelAngle[q]);
          regionAngle = Math.atan2(sinSum, cosSum) / 2;
          if (regionAngle < 0) regionAngle += Math.PI;
        }
      }
    }

    if (count < 12) {
      continue;
    }

    // Weighted principal axis of the supporting region.
    let sw = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < count; k++) {
      const p = region[k];
      const y = (p / w) | 0;
      const x = p - y * w;
      const m = magnitude[p];
      sw += m;
      cx += x * m;
      cy += y * m;
    }
    cx /= sw;
    cy /= sw;

    let mxx = 0;
    let myy = 0;
    let mxy = 0;
    for (let k = 0; k < count; k++) {
      const p = region[k];
      const y = (p / w) | 0;
      const x = p - y * w;
      const m = magnitude[p];
      const dx = x - cx;
      const dy = y - cy;
      mxx += m * dx * dx;
      myy += m * dy * dy;
      mxy += m * dx * dy;
    }
    mxx /= sw;
    myy /= sw;
    mxy /= sw;

    const theta = 0.5 * Math.atan2(2 * mxy, mxx - myy);
    const ax = Math.cos(theta);
    const ay = Math.sin(theta);

    // Reject blobs: the region must be strongly elongated along the axis.
    const lambdaMajor = (mxx + myy) / 2 + Math.hypot((mxx - myy) / 2, mxy);
    const lambdaMinor = (mxx + myy) / 2 - Math.hypot((mxx - myy) / 2, mxy);
    if (lambdaMajor < 1e-6 || lambdaMinor / lambdaMajor > 0.14) continue;

    let tMin = Infinity;
    let tMax = -Infinity;
    for (let k = 0; k < count; k++) {
      const p = region[k];
      const y = (p / w) | 0;
      const x = p - y * w;
      const t = (x - cx) * ax + (y - cy) * ay;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }

    const length = tMax - tMin;
    if (length < minLength) continue;

    let angle = Math.atan2(ay, ax);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle -= Math.PI;

    segments.push({
      a: v2(cx + ax * tMin, cy + ay * tMin),
      b: v2(cx + ax * tMax, cy + ay * tMax),
      length,
      angle,
      strength: sw / count,
    });
  }

  segments.sort((p, q) => q.length - p.length);
  return segments.slice(0, maxSegments);
}
