/**
 * The exact camera and room used to render the synthetic test photograph.
 * Kept apart from the renderer so the headless check can import it without
 * pulling in a browser.
 */
export const TRUTH = {
  width: 1440,
  height: 1020,
  focalPx: 900,
  // Chest height, standing back from the near-left corner and turned across the
  // room so both wall directions are visible. That two-point view is what the
  // capture guidance asks for and what vanishing-point calibration needs.
  camera: { x: -0.8, y: 1.55, z: -1.2 },
  pitchDeg: -9,
  yawDeg: 26,
  room: { width: 4.6, depth: 3.8, ceiling: 2.45 },
  /** [label, centreX, centreZ, width, height, depth] in metres. */
  pieces: [
    ['bookcase', 3.55, 3.35, 0.8, 1.9, 0.32],
    ['sofa', 1.05, 2.3, 2.05, 0.85, 0.9],
    ['media unit', 4.15, 1.9, 0.4, 0.45, 1.55],
    ['coffee table', 2.55, 1.55, 1.1, 0.42, 0.58],
  ],
};
