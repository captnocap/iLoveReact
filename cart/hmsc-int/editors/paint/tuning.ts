// editors/paint/tuning.ts — every behavior-affecting number in the shared
// painter, in ONE table (P2: a literal constant buried in logic is a bug).
//
// Behavior reference: cart/cutout (read, never imported — the user deletes
// it). The values are the cutout painter's proven feel, plus the two
// character-route capabilities the painter absorbed so adoption loses
// nothing: mirror symmetry and arbitrary-value (sculpt-style) painting.

export const PAINT_TUNING = Object.freeze({
  /** brush diameters offered by the size rail; [ and ] step through these */
  brushSizes: [2, 8, 32, 128, 512],
  brushDefaultPx: 32,
  /** on-screen cursor ring clamp (display only — dabs use the true radius) */
  cursor: { radiusMin: 4, radiusMax: 180, throttleMs: 60, smartRadius: 12, lassoRadius: 8 },
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
  /** per-ordinal look stagger for new layers (golden-ratio hue walk) */
  layerLook: {
    hueStagger: 0.6180339887,
    phaseStagger: 0.7,
    defaultDim: 0.85,
    defaultSurface: 'rainbow',
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
