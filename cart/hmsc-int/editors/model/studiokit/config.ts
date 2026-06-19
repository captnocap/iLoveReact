// editors/model/studio/config.ts — Studio's view constants + named tunables.
//
// Lifted VERBATIM from editors/model/Studio.tsx (req_1390). Every value is
// unchanged; only relocated so the viewport, panels, and dialogs share one
// source instead of reaching into the monolith. The editorTunables registration
// runs as a module side effect exactly as before (P2 — live-tunable in /settings).

import { GAME_CHROME } from '../../../game';

export const T = GAME_CHROME.tokens.color;
export const STEP_BTN = { paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' } as const;
// camera-smoothing presets cycled by the 'smooth' button — 0 = direct (Blockbench).
export const SMOOTH_PRESETS = [0, 24, 80, 160];
// PAINT mode palette (Phase 5c) — a compact spread; the user paints face texels with
// the active swatch. The eraser (null colour) clears cells. Brush sizes = texel diam.
export const PAINT_SWATCHES = ['#d94c4c', '#e08c3a', '#e9d24a', '#5ec26a', '#4aa3ff', '#8a5bd6', '#1c1f26', '#f2f2f2'];
export const PAINT_BRUSH_SIZES = [1, 2, 3, 5];

// SCALE GHOST (req_1165): a static reference figure — THE in-game player at its
// true height (collider 1.65 m, visual head-top ~2.04 m, RULED R4) — stood beside
// the model being made so the user can gauge real-world scale. Same seed as the
// game player so it IS the player; a unique cartKey so its face/skin captures don't
// collide with /test's, and rendered `intern` so it lives in the retained geometry
// buffer (no contention with the sculpted part's DYN slots).
export const SCALE_FIGURE_SEED = 1;
export const SCALE_FIGURE_CART_KEY = 'studio-scale';

export type Vec3 = [number, number, number];
export type Rect = { x: number; y: number; width: number; height: number };

// ── STUDIO tunables (P2 — named, registered, live-tunable in /settings) ───────
export const STUDIO = {
  /** the ground grid (req_0960): a clean 9-segment (gridTiles²) tile grid = one
   *  game floor (floors/walls are 3×3 tiles), 1 big tile = 1 game tile =
   *  tileMeters. ONLY the CENTER tile carries the fine subdivision. gridTiles
   *  must be ODD so a center tile exists. The center tile is a 16×16 line grid
   *  (`unitsPerTile`), Blockbench-style — that 16×16 IS the modeling unit ruler
   *  (req_0973): a 16-unit cube fills exactly one tile. */
  gridTiles: 3,
  tileMeters: 1,
  /** modeling units per tile (Blockbench's "pixels"): 16 units = 1 tile =
   *  tileMeters, and the same basis per-face UV/texels will use. The center
   *  tile's fine grid = this many lines, so 1 fine cell = 1 unit. */
  unitsPerTile: 16,
  fineDivisions: 16,
  gridLineMeters: 0.012,
  fineLineMeters: 0.006,
  gridLiftMeters: 0.001,
  /** origin axes: length + the thin square cross-section. */
  axisLengthMeters: 1,
  axisThicknessMeters: 0.02,
  /** Blockbench-ish boot framing: a 3/4 view looking slightly down. */
  bootYaw: 35,
  bootPitch: 28,
  fov: 38,
  /** orbit feel — degrees of camera turn per pixel of drag. */
  yawPerPixel: 0.4,
  pitchPerPixel: 0.32,
  // Full pole-to-pole so you can orbit UNDER the part (req_0960 — no camera
  // floor); just shy of ±90 to avoid the straight-up/down gimbal.
  minPitch: -89.9,
  maxPitch: 89.9,
  /** zoom (orbit distance) range + wheel step fraction. */
  minDistance: 0.4,
  maxDistance: 40,
  zoomStepFraction: 0.12,
  /** how tightly the boot distance frames the part (× its bounds radius). */
  fitDistanceFactor: 3.2,
  /** when the scene is empty, frame this radius so the 3×3 grid reads (grid
   *  half-extent is gridTiles·tileMeters/2 = 1.5 m). */
  emptyFitRadius: 1.6,
  /** SCALE GHOST (req_1165): clearance (meters) between the model's bounding
   *  radius and the reference figure, so the player stands just clear of the work. */
  scaleFigureGapMeters: 0.5,
  /** GLASS (req_1181): how the editor renders a face marked glass — a cool neutral
   *  architectural pane at the materials.ts Glass opacity (0.34). */
  glassColor: '#a9cbe0',
  glassOpacity: 0.34,
  /** WHEEL (req_1206): a generated tire's WIDTH as a fraction of its fitted radius,
   *  and its tread facet count — low-poly to match the era. Resize after if needed. */
  wheelWidthFraction: 0.5,
  wheelSides: 16,
  /** DETACH PANEL (req_1218): peel a selected face-group off the body into its own
   *  thin solid part (hood/door/trunk/light housing). `thickness` = how far the inner
   *  skin sits behind the outer skin (the panel's depth), on the 16-units basis. */
  shellThicknessMeters: 2 / 16,
  /** MIRROR (req_1183/1186): symmetric editing reflects edits across any enabled
   *  part-local plane at coord 0 — X (left↔right), Y (up↔down), Z (front↔back),
   *  multi-select for combined symmetry. The active planes live in twig state. */
  mirrorAxisLabels: ['X', 'Y', 'Z'] as const,
  mirrorAxisColors: ['#e0584e', '#5ec26a', '#4aa3ff'] as const,
  /** the SELECTED face is shaded this vivid color (req_0986) — distinct from the
   *  pastel part tints so the active face is unmistakable. */
  selectFaceColor: '#ff8a3d',
  /** push the face-highlight overlay out along the face normal so it sits just
   *  above the surface without z-fighting (meters). */
  selectFacePushMeters: 0.004,
  /** extrude's default lip: Blockbench's "Extend 1" = 1 unit on the 16-units
   *  basis (1/16 m). The button commits this thin extrusion; the move gizmo then
   *  pulls the cap in/out (req_1015). */
  extrudeMeters: 1 / 16,
  /** BEVEL (req_1265): the chamfer width a single 'bevel' commits — 2 modeling units
   *  on the 16-units basis, a visible chamfer the gizmo can then shape. */
  bevelMeters: 2 / 16,
  /** gizmo STEP (req_1023): every gizmo drag (move / resize / loop-cut slide)
   *  SNAPS by default — no modifier = whole modeling units, Shift = a finer step,
   *  Alt = freeform (no snap). On the 16-units basis 1 unit = 1/16 m. */
  gizmoStepMeters: 1 / 16,        // default: 1 modeling unit
  gizmoStepFineMeters: 1 / 64,    // Shift: a quarter unit
  /** uniform (center-hub) resize snaps the SCALE FACTOR instead of a distance. */
  gizmoUniformStep: 0.1,
  gizmoUniformStepFine: 0.05,
  /** rotate snaps in DEGREES — default 15° (orientation-friendly), Shift = 1°. */
  rotateStepDeg: 15,
  rotateStepFineDeg: 1,
  /** host camera smoothing (per-second ease). 0 = DIRECT 1:1 tracking, like
   *  Blockbench (no momentum/lag) — the default after the spin-feel hunt found
   *  the smoothing ease (24/s ≈ 42 ms lag) was the "skip"/float, not fps. The
   *  'smooth' button cycles presets live so the feel can be dialed in. */
  cameraSmoothing: 0,
  /** TEXTURE MAPPING (req_1062): the box-net atlas is rendered into one offscreen
   *  StaticSurface at this pixel resolution and the active part samples it via
   *  `textureKey` — so the UV→atlas→mesh mapping is visible on the 3D model
   *  (painting the atlas is the deferred next step). `textureCheckerCells` = the
   *  UV-test checkerboard density across the square (reads scale/stretch/seams). */
  textureAtlasPx: 512,
  textureCheckerCells: 8,
  /** PAINT mode (req_1203): throttle the atlas re-bake while a stroke is live — dabs
   *  land in a ref every mouse-move, the atlas re-bakes at most once per this many ms
   *  (the cutout painter's clock), so painting is smooth instead of re-rendering per dab. */
  paintBakeMs: 70,
  /** PAINT grid (req_1207, USER): a FIXED default grid the whole texture is divided
   *  into — NOT the model-size-dependent packed atlas resolution (which ballooned to
   *  1024 for a car, making each paint cell sub-pixel + invisible). A face sits on this
   *  global grid and clips cells at its edges (a triangle cuts through squares). 64² →
   *  4px cells on the 256px atlas, clearly visible. */
  paintGridCells: 64,
  /** PAINT cell (the corrected painter, req_1288): the uniform model-surface cell
   *  size in MODEL UNITS (16 units = 1 m), so a cell is the SAME world size on every
   *  face regardless of its atlas slot (no slivers). 2 units ≈ 0.125 m ≈ 8 cells/m. */
  paintCellUnits: 2,
  /** PAINT atlas resolution (req_1299): the paint cells are world-uniform now and
   *  INDEPENDENT of the atlas (the old `paintGridCells` fit is obsolete) — but the
   *  bake still renders into the per-face atlas slot, so the atlas must be big enough
   *  that a many-face model (a gun) gives each face real texels instead of flooring
   *  to 1 (which overlapped slots → paint landed nowhere visible). Fit the pack to
   *  this many texels so slots are well-resolved. */
  paintAtlasTexels: 1024,
  /** PAINT stroke (req_1207): a drag interpolates dabs every this-many screen px from
   *  the last point, so a fast stroke fills continuously instead of leaving gaps. */
  paintStrokeStepPx: 4,
  /** AI TEXTURE FILL (req_1070/1110, Phase 5d): the square px the image model
   *  generates at. Kept at atlas scale (NOT the model's 4096² default) so img2img
   *  results stay light; the atlas downscales them into the slot on render. */
  aiTextureSize: 1024,
  /** a re-uploaded / AI texture at or under this many bytes rides INLINE as a data:
   *  URL on the twig; anything larger is written to a content-addressed cache file
   *  and referenced by PATH instead (req_1110 — keeps big textures out of the twig
   *  while staying cache-correct, since the path's hash changes with content). */
  textureInlineMaxBytes: 256 * 1024,
  /** default text model for prompt enhancement via nano-gpt (req_1113) — any
   *  nano-gpt text model id works; the field is editable. */
  aiTextModel: 'openai/gpt-5.1',
  /** default image model for AI texture fill — any nano-gpt image model id works
   *  (seedream / nano-banana / riverflow / wan …); the field is editable. */
  aiImageModel: 'seedream-v4',
} as const;

