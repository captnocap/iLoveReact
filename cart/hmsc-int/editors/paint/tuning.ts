// editors/paint/tuning.ts — every behavior-affecting number in the shared
// painter, in ONE table (P2: a literal constant buried in logic is a bug).
//
// Behavior reference: cart/cutout (read, never imported — the user deletes
// it). The values are the cutout painter's proven feel, plus the two
// character-route capabilities the painter absorbed so adoption loses
// nothing: mirror symmetry and arbitrary-value (sculpt-style) painting.
//
// SETTINGS-0605: the numeric leaves register into THE P2 registry
// (editors/tunables.ts) below — /settings edits them live and the registry
// writes THROUGH this table, which is why it is no longer frozen. The
// literals here stay the defaults (reset-to-default returns to them).
// Deliberately NOT registered: `bands` (MUST match the in-shader compose in
// surfaces.ts — live-editing one side breaks the pinned invariant; needs a
// one-source seam first), `overlayRes` (baked into stored asset previews),
// arrays/strings (brushSizes, palette, layerLook modes — the registry is
// numeric v1). All recorded in editors/settings/CAPTURE.md.

import { editorTunables } from '../tunables';

export const PAINT_TUNING = ({
  /** brush diameters offered by the size rail; [ and ] step through these.
   *  Dense at the low end (tattoo lines on a 512×256 unwrap want 1–16px);
   *  the slider is CONTINUOUS between the ends (log-mapped — strokes.ts
   *  brushTrackToPx), these are its detent ticks and the step-key ladder. */
  brushSizes: [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512],
  brushDefaultPx: 32,
  /** tool cursor: smart/lasso fixed screen radii + the update throttle. The
   *  brush ring is UNCLAMPED — it is the dab's true screen footprint
   *  (source radius × live zoom; the old radiusMin/Max clamp existed only
   *  because the ring ignored zoom). */
  cursor: { throttleMs: 60, smartRadius: 12, lassoRadius: 8 },
  /** pointer pressure → dab radius: r = brushPx * (base + p*gain), floor 1 */
  pressure: { base: 0.35, gain: 1.3, fallback: 0.5 },
  /** dab spacing along a stroke, as a fraction of the dab radius */
  spacingFrac: 0.32,
  /** sobel edge snapping for brush/refine dab centers (needs a gray source) */
  edgeSnap: { threshold: 150, radiusFrac: 0.35, radiusMin: 2, radiusMax: 12 },
  /** mirrored dabs closer than this to the original are skipped (axis seam) */
  mirrorMinSeparationPx: 2,
  /** the dual-band override encoding (normalized paint values + byte cuts):
   *  erase paints `remove`, restore paints `keep`; a byte ≥ removeByteMin is
   *  force-remove, ≥ keepByteMin is force-keep, else the smart base decides
   *  (base byte ≥ baseByteMin = removed). MUST match the in-shader compose
   *  in surfaces.ts. */
  bands: { remove: 1.0, keep: 0.5, removeByteMin: 192, keepByteMin: 64, baseByteMin: 128 },
  /** lasso: auto-close near the first vertex; double-click closes too */
  lasso: { closeRadiusMin: 8, closeRadiusFrac: 0.01, doubleClickMs: 320, doubleClickDistSq: 64, minVerts: 3 },
  /** blank canvas / resize clamp + the checkerboard cell */
  canvas: { minSize: 16, maxSize: 4096, defaultSize: 512, checkerCell: 32 },
  /** undo/redo snapshot stacks (before-action model, slider coalescing) */
  history: { cap: 50, coalesceMs: 250 },
  /** GPU writes never setState per dab — visual dependents poll a version
   *  counter bumped at most this often mid-stroke */
  maskBumpThrottleMs: 60,
  /** per-ordinal look stagger for new layers (golden-ratio hue walk).
   *  defaults are THE NORMAL PAINT BRUSH (solid = exactly the picked color,
   *  dim 1 = no darkening) — the effect surfaces live in the FX gallery;
   *  the stagger only matters when a layer adopts one of them. */
  layerLook: {
    hueStagger: 0.6180339887,
    phaseStagger: 0.7,
    defaultDim: 1.0,
    defaultSurface: 'solid',
    defaultBlend: 'normal',
  },
  /** quick palette swatches in the tool rail */
  palette: [
    '#ffffff', '#111827',
    '#ff4040', '#ff9f43',
    '#ffdd55', '#34d399',
    '#3da9ff', '#7c5cff',
    '#ff70cc', '#8b5a2b',
  ],
  /** coarse grid for cell-set surface rendering + backend per-keep layers */
  overlayRes: 128,
  /** 3×3 box blur radius (the soften op) */
  softenRadius: 1,
  /** smart-select backend tunables (flood fuzz %, reject disk fraction of
   *  min(w,h), SAM threshold + candidate) and the slider-retune debounce */
  backends: {
    floodFuzz: 15,
    floodRejectFrac: 0.04,
    floodFuzzMax: 100,
    rejectFracMin: 0.001,
    rejectFracMax: 0.5,
    rejectDiskMinPx: 8,
    samThreshold: 0,
    samMaskIdx: 0 as 0 | 1 | 2,
    retuneDebounceMs: 250,
  },
});

export type PaintTuning = typeof PAINT_TUNING;

// ── THE P2 registry (SETTINGS-0605): same values, now /settings-editable ─────
editorTunables().register({
  system: 'paint', route: 'editors/paint', table: PAINT_TUNING,
  specs: {
    'brushDefaultPx': { label: 'brush px', min: 1, max: 512, step: 1, precision: 0 },
    'cursor.throttleMs': { label: 'cursor ms', min: 0, max: 500, step: 10, precision: 0 },
    'cursor.smartRadius': { label: 'smart r', min: 1, max: 64, step: 1, precision: 0 },
    'cursor.lassoRadius': { label: 'lasso r', min: 1, max: 64, step: 1, precision: 0 },
    'pressure.base': { label: 'press base', min: 0, max: 1, step: 0.05, precision: 2 },
    'pressure.gain': { label: 'press gain', min: 0, max: 4, step: 0.05, precision: 2 },
    'pressure.fallback': { label: 'press fallbk', min: 0, max: 1, step: 0.05, precision: 2 },
    'spacingFrac': { label: 'dab spacing', min: 0.05, max: 1, step: 0.01, precision: 2 },
    'edgeSnap.threshold': { label: 'snap thresh', min: 0, max: 255, step: 5, precision: 0 },
    'edgeSnap.radiusFrac': { label: 'snap r frac', min: 0, max: 1, step: 0.05, precision: 2 },
    'edgeSnap.radiusMin': { label: 'snap r min', min: 1, max: 32, step: 1, precision: 0 },
    'edgeSnap.radiusMax': { label: 'snap r max', min: 1, max: 64, step: 1, precision: 0 },
    'mirrorMinSeparationPx': { label: 'mirror sep', min: 0, max: 16, step: 1, precision: 0 },
    'lasso.closeRadiusMin': { label: 'lasso close', min: 1, max: 64, step: 1, precision: 0 },
    'lasso.closeRadiusFrac': { label: 'close frac', min: 0, max: 0.2, step: 0.005, precision: 3 },
    'lasso.doubleClickMs': { label: 'dbl-click ms', min: 100, max: 1000, step: 20, precision: 0 },
    'lasso.doubleClickDistSq': { label: 'dbl-click d²', min: 1, max: 400, step: 1, precision: 0 },
    'lasso.minVerts': { label: 'lasso verts', min: 3, max: 10, step: 1, precision: 0 },
    'canvas.minSize': { label: 'canvas min', min: 1, max: 256, step: 1, precision: 0 },
    'canvas.maxSize': { label: 'canvas max', min: 256, max: 8192, step: 64, precision: 0 },
    'canvas.defaultSize': { label: 'canvas def', min: 16, max: 4096, step: 16, precision: 0 },
    'canvas.checkerCell': { label: 'checker px', min: 2, max: 128, step: 1, precision: 0 },
    'history.cap': { label: 'undo depth', min: 1, max: 500, step: 1, precision: 0 },
    'history.coalesceMs': { label: 'undo coalesce', min: 0, max: 2000, step: 50, precision: 0 },
    'maskBumpThrottleMs': { label: 'mask bump ms', min: 0, max: 500, step: 10, precision: 0 },
    'layerLook.hueStagger': { label: 'hue stagger', min: 0, max: 1, step: 0.001, precision: 3 },
    'layerLook.phaseStagger': { label: 'phase stagger', min: 0, max: 6.3, step: 0.05, precision: 2 },
    'layerLook.defaultDim': { label: 'layer dim', min: 0, max: 1, step: 0.05, precision: 2 },
    'softenRadius': { label: 'soften r', min: 1, max: 8, step: 1, precision: 0 },
    'backends.floodFuzz': { label: 'flood fuzz', min: 0, max: 100, step: 5, precision: 0 },
    'backends.floodRejectFrac': { label: 'flood reject', min: 0.001, max: 0.5, step: 0.005, precision: 3 },
    'backends.rejectDiskMinPx': { label: 'reject disk', min: 1, max: 64, step: 1, precision: 0 },
    'backends.samThreshold': { label: 'sam thresh', min: -8, max: 8, step: 1, precision: 0 },
    'backends.retuneDebounceMs': { label: 'retune ms', min: 0, max: 2000, step: 50, precision: 0 },
  },
});
