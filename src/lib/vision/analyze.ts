/**
 * The end-to-end "photo in, calibrated room out" routine.
 * Pure and dependency-free so it runs identically on the main thread or inside
 * a worker.
 */

import type { Vec2 } from '../geometry/vec';
import { type Calibration, calibrate, estimateVanishingPoints, rescaleCalibration } from './calibration';
import { type LineSegment, detectLineSegments, toGreyscale } from './lineSegments';

export interface AnalyzeRequest {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  cameraHeight: number;
  /** Longest edge used for the analysis pass. Smaller is faster, less precise. */
  maxDimension?: number;
  assumedHorizontalFov?: number;
}

export interface AnalyzeResult {
  calibration: Calibration;
  /** Segments in analysis-image pixel space. */
  segments: LineSegment[];
  /** Indices grouped by which vanishing point they voted for. */
  clusters: { kind: 'vertical' | 'horizontal'; indices: number[]; point: Vec2 | null }[];
  analysisWidth: number;
  analysisHeight: number;
  elapsedMs: number;
  /** Plain-language notes about what the geometry did or did not support. */
  diagnostics: string[];
}

export function analyzePhoto(req: AnalyzeRequest): AnalyzeResult {
  const started = Date.now();
  const maxDimension = req.maxDimension ?? 900;

  const grey = toGreyscale(req.pixels, req.width, req.height, maxDimension);
  const segments = detectLineSegments(grey);
  const vanishing = estimateVanishingPoints(segments, grey.width, grey.height);
  const analysisCalibration = calibrate({
    vanishing,
    cameraHeight: req.cameraHeight,
    assumedHorizontalFov: req.assumedHorizontalFov,
  });

  const calibration = rescaleCalibration(analysisCalibration, req.width);

  const clusters: AnalyzeResult['clusters'] = [];
  if (vanishing.vertical) {
    clusters.push({
      kind: 'vertical',
      indices: vanishing.vertical.inliers,
      point: vanishing.vertical.point,
    });
  }
  for (const h of vanishing.horizontal) {
    clusters.push({ kind: 'horizontal', indices: h.inliers, point: h.point });
  }

  const diagnostics: string[] = [];
  diagnostics.push(`${segments.length} line segments extracted.`);
  if (vanishing.vertical) {
    diagnostics.push(
      `Vertical vanishing point locked from ${vanishing.vertical.inliers.length} segments — the camera's roll and pitch are known.`,
    );
  } else {
    diagnostics.push(
      'No vertical vanishing point found. Assuming the camera was held level, which limits accuracy.',
    );
  }
  if (vanishing.horizontal.length >= 2) {
    diagnostics.push(
      `Two horizontal vanishing points found (${vanishing.horizontal[0].inliers.length} and ${vanishing.horizontal[1].inliers.length} segments) — full Manhattan frame recovered.`,
    );
  } else if (vanishing.horizontal.length === 1) {
    diagnostics.push(
      'Only one horizontal vanishing point found. One wall direction is known; the perpendicular one is assumed.',
    );
  } else {
    diagnostics.push('No horizontal vanishing points found — try a photo that shows a corner of the room.');
  }
  if (calibration.source === 'assumed-fov') {
    diagnostics.push(
      'Focal length could not be solved from the geometry, so a typical phone field of view was assumed. Measurements will be proportionally off if that guess is wrong.',
    );
  } else {
    diagnostics.push(
      `Focal length solved as ${Math.round(calibration.focal)} px (${calibration.fovDeg.toFixed(1)}° vertical field of view).`,
    );
  }
  diagnostics.push(
    `Scale is anchored entirely on the stated camera height of ${req.cameraHeight.toFixed(2)} m — every measurement scales linearly with it.`,
  );

  return {
    calibration,
    segments,
    clusters,
    analysisWidth: grey.width,
    analysisHeight: grey.height,
    elapsedMs: Date.now() - started,
    diagnostics,
  };
}
