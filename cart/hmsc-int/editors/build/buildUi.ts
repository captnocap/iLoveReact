// buildUi — BUILD-mode presentation/feel constants, lifted out of PlayRoute so the
// embodied F2 build mode AND the iso authoring pane read ONE table (a ghost's
// color, a wall's window cutout, the occluded-wall residual alpha — one source).
//
// The live-tuning REGISTRATIONS (editorTunables().register for 'build-placed' and
// 'play-camera-occlusion') deliberately STAY in PlayRoute: they reference these
// same objects by import, so a slider still mutates the one CAMERA_OCCLUSION_TUNING
// every reader sees — behavior is identical to when these lived inline.

import { PLAYER_CAMERA } from '../../Embodied';

// BUILD_UI moved to ./pieceShapes (PARITY-0611, req_0655): the shape math the
// compile bake and the headless parity suite share needs the cutout/slab
// numbers without dragging this module's Embodied (React) import. Re-exported
// here so every existing consumer keeps its import path.
export { BUILD_UI } from './pieceShapes';

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
  // req_0930: a roof high overhead must not yank the camera. A roof pulls the
  // spring-arm in ONLY when the player's head is within this of the eave (i.e.
  // on/just under the roof); a player a storey-plus below it (the ground floor
  // of a 2-storey house) leaves the roof a non-occluder — the camera rides on.
  roofOverheadClearanceMeters: 3,
};
