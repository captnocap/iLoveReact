// editors/paint — THE shared painter (P3: this file is the one door).
//
// The cutout painter ("actually good for painting" — the user's ruling)
// captured as the one paint surface every editor that paints embeds:
// characters (replacing paintKit's hand-rolled input), materials/textures
// (later), the map editor's brushes (later). COMPOSABILITY IS THE POINT —
// one painter, no per-route forks. Behavior reference: cart/cutout (read,
// never imported, never edited; the user deletes it).
//
// Two halves behind this door:
//   PAINT          — the headless core: tuning tables (P2), stroke math,
//                    the dual-source layer model, history, the WGSL surface
//                    system, smart-select backends. Pure; meaning-tested
//                    under tools/v8cli (paint.test.ts).
//   usePaintEditor — the live state hook wiring core → GPU paintables +
//   + components     session history; PaintSurface (viewport), PaintToolRail
//                    / PaintLayerStrip / PaintLookPanel (chrome-kit
//                    controls), PaintEditor (the one-line full painter).
//
// Session contract (V20): pass `session` (a RouteSession satisfies it) and
// every completed interaction lands one labeled edit-commit on the hosting
// route's channel. Smart select activates only when the host provides a
// backend + source path (makeDefaultBackend picks SAM when the onnx host
// binding exists, else flood).

import { PAINT_TUNING } from './tuning';
import {
  brushPxToTrack, brushTrackToPx, createStrokeEngine, createVectorStroke,
  fillPolygon, hasAnyPainted, lassoIsDoubleClick, lassoShouldClose,
  paintCircle, paintCircleEdgeAware, pressureRadius, rowRuns, sampleToCells,
  snapToStrongGradient, soften3x3, sobelMagnitudeSq,
} from './strokes';
import {
  activeAfterDelete, buildPaintDocument, cloneLayerConfig, defaultLayerConfig,
  effectiveMask, inflatePaintDocument, invertIntoBase, makeLayer,
  mergeIntoBase, mintLayerId, moveLayerInStack, overrideBandValue,
  paintableIdsFor, parsePaintDocument, scaleMask, serializePaintDocument,
  unionMasks, PAINT_DOC_KIND, PAINT_DOC_VERSION,
} from './layers';
import { createPaintHistory } from './history';
import {
  addCustomSurface, adoptSurface, blendModeIndex, buildCellShader,
  buildTextureShader, CELL_SHADER_CACHE, hexToRgb01, inflateSurface,
  isBuiltinSurface, MASK_SURFACES, maskSurfaceLabel, mintCustomSurfaceId,
  NUM_COLOR_SLOTS, PAINT_BLEND_MODES, packCellModeData, packTextureModeData,
  resolveShader, SLOT_DEFAULTS, SLOT_LABELS, TEXTURE_SHADER_CACHE,
} from './surfaces';
import { createFloodBackend } from './backends/flood';
import { createSamBackend, isSegmentAvailable } from './backends/sam';
import type { SelectionBackend } from './backends/types';

/** Best available smart-select backend: SAM when the onnx host binding is
 *  registered, the ImageMagick flood fallback otherwise. */
export function makeDefaultBackend(): SelectionBackend {
  return isSegmentAvailable() ? createSamBackend() : createFloodBackend();
}

/** The headless core, one namespace. */
export const PAINT = Object.freeze({
  tuning: PAINT_TUNING,
  // strokes
  createStrokeEngine, createVectorStroke, pressureRadius,
  brushTrackToPx, brushPxToTrack,
  paintCircle, paintCircleEdgeAware, fillPolygon, soften3x3,
  snapToStrongGradient, sobelMagnitudeSq, hasAnyPainted,
  sampleToCells, rowRuns, lassoShouldClose, lassoIsDoubleClick,
  // layers
  effectiveMask, scaleMask, unionMasks, invertIntoBase, mergeIntoBase,
  overrideBandValue, defaultLayerConfig, cloneLayerConfig, makeLayer,
  mintLayerId, paintableIdsFor, moveLayerInStack, activeAfterDelete,
  // documents
  buildPaintDocument, parsePaintDocument, serializePaintDocument,
  inflatePaintDocument, PAINT_DOC_KIND, PAINT_DOC_VERSION,
  // history
  createPaintHistory,
  // surfaces
  MASK_SURFACES, PAINT_BLEND_MODES, NUM_COLOR_SLOTS, SLOT_LABELS,
  SLOT_DEFAULTS, maskSurfaceLabel, isBuiltinSurface, buildCellShader,
  buildTextureShader, CELL_SHADER_CACHE, TEXTURE_SHADER_CACHE, resolveShader,
  packTextureModeData, packCellModeData, hexToRgb01, blendModeIndex,
  addCustomSurface, mintCustomSurfaceId, inflateSurface, adoptSurface,
  // backends
  createFloodBackend, createSamBackend, isSegmentAvailable, makeDefaultBackend,
});

// The live half (React + GPU + session wiring).
export { usePaintEditor } from './usePaintEditor';
export type { PaintEditorOptions, PaintEditorState, PaintSession, Dims } from './usePaintEditor';
export { PaintSurface, PaintQuad } from './PaintSurface';
export { PaintEditor, PaintToolRail, PaintLayerStrip, PaintLookPanel } from './PaintControls';
export { ColorWheel } from './ColorWheel';
export {
  hexToHsv, hsvToHex, isFullHexColor, isHexColor, normalizeHexColor,
  type HsvColor,
} from './colors';

// Types consumers speak.
export type {
  PaintLayer, PaintLayerBytes, PaintLayerConfig, PaintLookDefaults,
  PaintClipping, PaintDocument, PaintDocLayer, PaintMode, PaintTool,
} from './layers';
export type {
  CustomSurface, MaskSurface, PaintBlendMode, Surface, SurfaceId,
} from './surfaces';
export type { Dab, GraySource, StrokeEngine, StrokeEngineOpts, VectorStroke, Run } from './strokes';
export type { PaintHistory, PaintHistoryOpts, SnapshotBuilder } from './history';
export type {
  BackendOpts, ClickLabel, ClickPoint, RefineResult, SelectionBackend,
} from './backends/types';
