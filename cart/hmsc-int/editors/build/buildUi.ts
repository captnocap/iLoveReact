// buildUi — BUILD-mode presentation/feel constants, lifted out of PlayRoute so the
// embodied F2 build mode AND the iso authoring pane read ONE table (a ghost's
// color, a wall's window cutout, the occluded-wall residual alpha — one source).
//
// The live-tuning REGISTRATIONS (editorTunables().register for 'build-placed' and
// 'play-camera-occlusion') deliberately STAY in PlayRoute: they reference these
// same objects by import, so a slider still mutates the one CAMERA_OCCLUSION_TUNING
// every reader sees — behavior is identical to when these lived inline.

import { PLAYER_CAMERA } from '../../Embodied';

// ── BUILD-mode presentation/feel data (P2: named values, no inline numbers) ──
export const BUILD_UI = {
  ghostOpacity: 0.45,
  ghostColor: '#7dd3fc',
  ghostBlockedColor: '#fb7185',
  markColor: '#fbbf24',
  targetColor: '#a5f3fc',
  /** the snap indicator cube's edge, meters */
  indicatorSizeMeters: 0.14,
  faceSlabThicknessMeters: 0.02,
  faceSlabLiftMeters: 0.012,
  editCutoutWidthMeters: 1.2,
  doubleWindowCutoutWidthMeters: 2.2,
  editCutoutHeightMeters: 1.2,
  editCutoutLowHeightMeters: 2.2,
  windowPaneDepthMeters: 0.04,
  windowPaneColor: '#bcd3dd',
  windowPaneOpacity: 0.3,
  buildingSkinTexturePx: 256,
  /** REQ-0647: the elevator car platform's look (a steel plate, distinct from
   *  the shaft frame's metal so the car reads against it) */
  elevatorCarColor: '#aeb6bf',
  panelBg: '#0f1a2ef0',
} as const;

export const CAMERA_OCCLUSION_TUNING = {
  // Faded walls/ceiling stack between the lens and the player inside a building,
  // so each layer must read as clearly see-through (62% opaque hid the player
  // behind two layers). Live-tunable via the 'play-camera-occlusion' table.
  residualOpacity: 0.34,
  maxHits: 24,
  sweepRadiusMeters: 0.08,
  playerTargetHeightMeters: PLAYER_CAMERA.targetHeightMeters,
  // Spring-arm floor: how close the camera may tuck to the player when a wall
  // pushes it in. Low enough to get to the player's side of a tight interior
  // wall (an aim-like over-shoulder framing) without clipping into the model.
  minDistanceMeters: 0.7,
  skinOffsetMeters: 0.14,
  pullSmoothingPerSecond: 26,
  rampGroundToleranceMeters: 0.28,
};
