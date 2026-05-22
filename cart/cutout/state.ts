// useCutoutState — the single source of truth. Everything stateful lives
// here so components stay pure (props in, JSX out, callbacks fire).
//
// Two important invariants:
//   1. The hi-res mask is a ref (Uint8Array, can be 100MB+ at 4K — don't
//      let React see it). A version counter triggers re-renders of things
//      that derive from it.
//   2. All async work (ingest, save) is keyed by a token so abandoned work
//      from a previous image doesn't stomp on the current one.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { execAsync } from '@reactjit/runtime/hooks/process';
import { identify, compositeCutout, type Dims } from './magick';
import { paintCircle, hasAnyErased, sampleToCells } from './mask';
import { createFloodBackend } from './backends/flood';
import { createSamBackend } from './backends/sam';
import { isSegmentAvailable } from '@reactjit/runtime/hooks/useSegment';
import type { BackendOpts } from './backends/types';
import { bakeMatrix, exportIcons } from './icons';
import { buildSqi, serializeSqi } from './sqi';
import {
  buildSession,
  inflateSessionMasks,
  parseSession,
  serializeSession,
  sessionPathFor,
  SESSION_DIR,
  SESSION_LAST_POINTER,
  type SessionDocument,
} from './session';
import type { ClickLabel, ClickPoint, SelectionBackend } from './backends/types';
import type { CustomSurface, MaskSurface, SurfaceId } from './components/MaskQuad';
import { NUM_COLOR_SLOTS, SLOT_DEFAULTS } from './components/MaskQuad';
import type {
  LayerConfig,
  CompositionLayer,
  CompositionLayerKind,
} from './domain';
import { useHistory } from './history';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';

/** What lives on the in-cart clipboard. One slot — copy overwrites. */
export interface LayerClipping {
  /** Source layer mask at overlayRes (snapshot — paste deep-copies). */
  mask: Set<number>;
  /** Visual config. Pasted layer keeps the same mode/colors/hue/phase
   *  so a copy-paste produces a visually identical duplicate. */
  config: LayerConfig;
  /** Display label for UI feedback ("pasted from Layer 3"). */
  sourceLabel: string;
}

export type Mode = 'erase' | 'restore';
export type Tool = 'brush' | 'smart' | 'hand';
export type BackendName = 'flood' | 'sam';
export const OVERLAY_RES = 128;
// Default tunables — kept here so disk-restored sessions and fresh boots
// agree, and so the Inspector can render the slider mid-positions correctly
// before the user has touched anything.
const DEFAULT_FLOOD_FUZZ = 15;
const DEFAULT_FLOOD_REJECT_FRAC = 0.04;
const DEFAULT_SAM_THRESHOLD = 0;
const DEFAULT_SAM_MASK_IDX: 0 | 1 | 2 = 0;
// Re-export the canonical layer / composition / surface types so existing
// callers `import { LayerConfig } from '../state'` keep working. The
// declarations live in ./domain so session.ts + sqi.ts can compose
// against the same shape without re-declaring it.
export type { MaskSurface } from './components/MaskQuad';
export type { LayerConfig, CompositionLayer, CompositionLayerKind } from './domain';

interface SmartLayerMeta {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
}

export interface CutoutState {
  // Source
  srcPath: string | null;
  stem: string;
  srcDims: Dims | null;
  isBlank: boolean;

  // Status
  status: string;
  busy: boolean;
  savedPath: string | null;

  // Tool config
  tool: Tool;
  mode: Mode;
  brushPx: number;
  setTool: (t: Tool) => void;
  setMode: (m: Mode) => void;
  setBrushPx: (n: number) => void;

  // Active paint target. -1 = global brush layer (writes to maskRef
  // directly, source-resolution). 0..N = paint INTO smart layer `i`
  // (cells get added/removed from layers[i] at overlayRes granularity,
  // and mirrored into the source mask so the export path still sees
  // them). Inspector calls setActiveLayer when the user picks a layer
  // in the panel; keyboard shortcuts target this too.
  activeLayer: number;
  setActiveLayer: (i: number) => void;

  // Mask access — version bumps after each commit so dependents invalidate.
  maskVersion: number;
  hasMaskEdits: boolean;
  hasBrushLayer: boolean;
  overlayCells: Set<number>; // sampled to OVERLAY_RES for cheap rendering
  /** Cells the BRUSH layer alone owns — overlayCells minus every smart-
   *  layer cell. The Editor uses this for the global preview so smart
   *  layers can render their own FX without the global overlay
   *  double-painting on top. */
  brushOnlyOverlayCells: Set<number>;

  // Brush ops — components call paintAtSource(x, y) with source-pixel coords
  beginStroke: () => void;
  paintAtSource: (sx: number, sy: number) => void;
  endStroke: () => void;
  clearMask: () => void;
  createBlankSurface: (w?: number, h?: number) => void;
  setCanvasSize: (w: number, h: number) => void;

  // Smart-select ops — backend-driven object segmentation
  backendName: string;
  /** Which backend is currently driving smart-select. Persists in session
   *  + restored on reload. The cart UI exposes a toggle in Inspector. */
  backend: BackendName;
  setBackend: (b: BackendName) => void;
  /** True iff this cart was built with -Dhas-onnx=true — gates whether
   *  the SAM tile in the Inspector is enabled. */
  samAvailable: boolean;
  // Per-backend tunables. The cart owns these; backends read them per
  // refine call via the BackendOpts bag (state.ts merges them into one
  // bag in runRefine — backends cherry-pick the keys they understand).
  floodFuzz: number;
  setFloodFuzz: (n: number) => void;
  floodRejectFrac: number;
  setFloodRejectFrac: (n: number) => void;
  samThreshold: number;
  setSamThreshold: (n: number) => void;
  samMaskIdx: 0 | 1 | 2;
  setSamMaskIdx: (n: 0 | 1 | 2) => void;
  clicks: ClickPoint[];
  addClick: (sx: number, sy: number, label: ClickLabel) => Promise<void>;
  clearClicks: () => void;
  smartBusy: boolean;
  /** Per-click downsampled mask grids at `overlayRes`. One entry per KEEP
   *  click; reject clicks don't produce a layer. Empty for SAM backends
   *  (SAM fuses all clicks into one combined mask in its decoder). */
  layers: Set<number>[];
  overlayRes: number;
  /** Per-layer visual config (mode + hue + phase + muted). Same length as
   *  `layers`. Inspector Layers panel edits these in-place. */
  layerConfigs: LayerConfig[];
  compositionLayers: CompositionLayer[];
  setLayerMode: (i: number, m: SurfaceId) => void;
  toggleLayerMute: (i: number) => void;
  deleteLayer: (i: number) => Promise<void>;
  addPaintLayer: () => number;
  duplicateLayer: (i: number) => void;
  moveLayer: (i: number, dir: -1 | 1) => void;
  mergeLayer: (i: number) => void;
  deleteCompositionLayer: (i: number) => void;
  setCompositionLayerName: (i: number, name: string) => void;
  setCompositionLayerGroup: (i: number, groupName: string) => void;
  /** Per-layer parameter setters used by both Tools (color swatches) and
   *  Inspector Properties (sliders). `i` of -1 targets the brush/global
   *  layer (paint mask + global effectMode preview). */
  setLayerColor: (i: number, slotIdx: number, hex: string) => void;
  setLayerHueOffset: (i: number, value: number) => void;
  setLayerPhaseOffset: (i: number, value: number) => void;
  setLayerDim: (i: number, value: number) => void;

  // MaskQuad visual surface — DEFAULT picked for new layers. Pure visual;
  // doesn't affect the underlying mask or the saved PNG.
  effectMode: SurfaceId;
  setEffectMode: (m: SurfaceId) => void;
  /** Global default color slots applied to new layers when they're created
   *  (and used directly by the brush/global layer when nothing else is
   *  selected). Tools palette edits these by default. Length matches
   *  NUM_COLOR_SLOTS. */
  effectColors: string[];
  effectHueOffset: number;
  effectPhaseOffset: number;
  effectDim: number;
  setEffectColor: (slotIdx: number, hex: string) => void;
  setEffectHueOffset: (value: number) => void;
  setEffectPhaseOffset: (value: number) => void;
  setEffectDim: (value: number) => void;
  customSurfaces: CustomSurface[];
  addCustomSurface: (label: string, shader: string) => string;

  // Actions
  pickFile: () => Promise<void>;
  saveCutout: () => Promise<void>;
  /** Bake the cutout into pixel-icon JSON files (64/128/512) — drop-in
   *  format consumed by cart/pixel_icon_gallery.tsx + ShaderPixelIcon. */
  saveIcons: () => Promise<void>;
  /** Bake the merged cutout (base pixel matrix + layered shader FX) into a
   *  single .sqi.json document — drop-in format consumed by
   *  cart/cutout/components/ShaderQuadImage.tsx. */
  saveSqi: () => Promise<void>;

  // Autosave / restore — the cart treats its visible state as a view over
  // an on-disk SessionDocument. Every meaningful edit gets debounced-
  // flushed to `cart/cutout/sessions/<stem>.session.json`; on mount the
  // cart reads `_last.txt` and rehydrates. Manual Save PNG / Save .sqi
  // are still the EXPORT actions; this is the working state.
  lastSavedAt: number | null;
  restoredFrom: string | null;

  // Undo / redo. The history stack stores SessionDocument snapshots —
  // same shape autosave uses — so undo is "rehydrate the previous
  // snapshot". Bound to ctrl+z / ctrl+y / ctrl+shift+z at the keyboard
  // level so cart components don't need to subscribe themselves.
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Layer clipboard — one slot. Copy stashes the current layer's mask +
  // config; paste creates a new smart-style entry with the same fields.
  // Cut = copy then delete. Bound to ctrl+c / ctrl+v / ctrl+x.
  clipboard: LayerClipping | null;
  copyLayer: (i: number) => void;
  pasteLayer: () => void;
  cutLayer: (i: number) => void;
}

export function useCutoutState(): CutoutState {
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [stem, setStem] = useState('cutout');
  const [srcDims, setSrcDims] = useState<Dims | null>(null);
  // Mirror srcPath/srcDims to refs so setBackend (declared later) can
  // re-open on the current image without depending on closure timing.
  // Lands synchronously each render; React batching is a non-issue.
  const srcPathRef = useRef<string | null>(null);
  srcPathRef.current = srcPath;
  const srcDimsRef = useRef<Dims | null>(null);
  srcDimsRef.current = srcDims;
  const [isBlank, setIsBlank] = useState(false);
  const [status, setStatus] = useState('no source loaded');
  const [busy, setBusy] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [mode, setMode] = useState<Mode>('erase');
  const [brushPx, setBrushPx] = useState(32);
  const [maskVersion, setMaskVersion] = useState(0);
  const [hasBrushLayer, setHasBrushLayer] = useState(false);
  // Active paint target. -1 = global brush layer (the historical behavior);
  // 0..N = paint INTO smart layer i (cells get added/removed from
  // layers[i] AND mirrored into the source mask so export still sees
  // them). Bound to Inspector's selected-layer pick via setActiveLayer.
  const [activeLayer, setActiveLayer] = useState(-1);
  // Mirror to a ref so paintAtSource (called on every mouseMove frame)
  // reads the latest target without going through React state. setState
  // is async; the ref lands synchronously below.
  const activeLayerRef = useRef(-1);
  activeLayerRef.current = activeLayer;
  const [effectMode, setEffectMode] = useState<SurfaceId>('rainbow');
  const [effectColors, setEffectColors] = useState<string[]>(SLOT_DEFAULTS.slice());
  const [effectHueOffset, setEffectHueOffset] = useState(0);
  const [effectPhaseOffset, setEffectPhaseOffset] = useState(0);
  const [effectDim, setEffectDim] = useState(0.85);
  // Autosave bookkeeping. `lastSavedAt` is shown in the status bar so the
  // user can see the cart is keeping up. `restoredFrom` records the stem
  // of the session that was rehydrated on mount (null if cart booted
  // clean) — also informational only.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  // Guard for the restore effect — React strict mode runs effects twice
  // in dev, and we want the disk → state path to fire exactly once per
  // mount, otherwise the second pass would clobber the user's first few
  // edits with the saved snapshot again.
  const restoreOnceRef = useRef(false);
  // Debounce timer + suppression flag for autosave. While `suppress` is
  // true (during the restore window) the autosave effect is a no-op so
  // we don't immediately re-flush a freshly-loaded payload back to disk.
  const autosaveTimerRef = useRef<any>(null);
  const autosaveSuppressedRef = useRef(true);
  // Undo / redo history — pushes SessionDocument snapshots. See
  // ./history for the model. Commit / undo / redo callers build the
  // current snapshot lazily via buildCurrentSession() rather than from a
  // memo, so the RLE encode only runs at discrete commit points (stroke
  // start, layer mutation, etc.), not every render.
  const history = useHistory();
  // Layer clipboard — single-slot. Lives in state so it persists across
  // tab/composition selection changes; intentionally NOT in session.json
  // (transient editor state).
  const [clipboard, setClipboard] = useState<LayerClipping | null>(null);
  // Mirror effect-* so async layer creation can read the LATEST user pick
  // without needing setLayerXxx wiring at the call site (same pattern as
  // effectModeRef). One ref per slot would be noisy; keep a single ref to
  // the full string[] and recompute it on every render.
  const effectColorsRef = useRef<string[]>(SLOT_DEFAULTS.slice());
  effectColorsRef.current = effectColors;
  const effectHueOffsetRef = useRef(0); effectHueOffsetRef.current = effectHueOffset;
  const effectPhaseOffsetRef = useRef(0); effectPhaseOffsetRef.current = effectPhaseOffset;
  const effectDimRef = useRef(0.85); effectDimRef.current = effectDim;
  const [customSurfaces, setCustomSurfaces] = useState<CustomSurface[]>([]);
  const [layers, setLayers] = useState<Set<number>[]>([]);
  const [overlayRes, setOverlayRes] = useState<number>(OVERLAY_RES);
  const [layerConfigs, setLayerConfigs] = useState<LayerConfig[]>([]);
  const [paintLayerName, setPaintLayerName] = useState('Paint Layer');
  const [paintLayerGroup, setPaintLayerGroup] = useState('');
  const [smartLayerMeta, setSmartLayerMeta] = useState<SmartLayerMeta[]>([]);
  const smartLayerMetaRef = useRef<SmartLayerMeta[]>([]);
  // Mirror layerConfigs so async refines + handler closures always read
  // the current array (state is async; ref is now). Same pattern we use
  // for clicksRef.
  const layerConfigsRef = useRef<LayerConfig[]>([]);
  const writeLayerConfigs = (next: LayerConfig[]) => {
    layerConfigsRef.current = next;
    setLayerConfigs(next);
  };
  const writeLayerStack = (
    nextLayers: Set<number>[],
    nextConfigs: LayerConfig[],
    nextMeta: SmartLayerMeta[],
  ) => {
    setLayers(nextLayers);
    writeLayerConfigs(nextConfigs);
    smartLayerMetaRef.current = nextMeta;
    setSmartLayerMeta(nextMeta);
  };
  // Reach for `effectMode` lazily inside refine so newly-created layers
  // pick up the latest user choice without needing setLayerMode wiring.
  const effectModeRef = useRef<SurfaceId>('rainbow');
  effectModeRef.current = effectMode;

  const maskRef = useRef<Uint8Array | null>(null);
  const tokenRef = useRef(0);
  const drawingRef = useRef(false);

  // Smart-select state. Backend opens on ingest, closes on new image.
  // Clicks are the click HISTORY; backend.refine always replays the entire
  // history so a reject click after an overshoot cleanly removes the bad
  // selection without leaving phantom mask bits.
  //
  // Backend is user-toggleable at runtime. `samAvailable` mirrors the
  // build-time ONNX gate — if false, the SAM tile in Inspector is disabled
  // and we hard-coerce any restored 'sam' choice back to 'flood'.
  const samAvailable = isSegmentAvailable();
  const makeBackend = (name: BackendName): SelectionBackend =>
    name === 'sam' && samAvailable ? createSamBackend() : createFloodBackend();
  const [backend, setBackendState] = useState<BackendName>(samAvailable ? 'sam' : 'flood');
  const backendRef = useRef<SelectionBackend>(makeBackend(backend));
  // Tunables. The cart owns these in React state and hands them to the
  // active backend through a BackendOpts bag at every refine call.
  const [floodFuzz, setFloodFuzz] = useState(DEFAULT_FLOOD_FUZZ);
  const [floodRejectFrac, setFloodRejectFrac] = useState(DEFAULT_FLOOD_REJECT_FRAC);
  const [samThreshold, setSamThreshold] = useState(DEFAULT_SAM_THRESHOLD);
  const [samMaskIdx, setSamMaskIdx] = useState<0 | 1 | 2>(DEFAULT_SAM_MASK_IDX);
  // Mirror to refs so async callers (runRefine, addClick) always read the
  // CURRENT values without React batching the refine call with a stale
  // closure. Same pattern as effectColorsRef / activeLayerRef.
  const floodFuzzRef = useRef(DEFAULT_FLOOD_FUZZ); floodFuzzRef.current = floodFuzz;
  const floodRejectFracRef = useRef(DEFAULT_FLOOD_REJECT_FRAC); floodRejectFracRef.current = floodRejectFrac;
  const samThresholdRef = useRef(DEFAULT_SAM_THRESHOLD); samThresholdRef.current = samThreshold;
  const samMaskIdxRef = useRef<0 | 1 | 2>(DEFAULT_SAM_MASK_IDX); samMaskIdxRef.current = samMaskIdx;
  const buildBackendOpts = (): BackendOpts => ({
    fuzzPercent: floodFuzzRef.current,
    rejectDiskFrac: floodRejectFracRef.current,
    samThreshold: samThresholdRef.current,
    samMaskIdx: samMaskIdxRef.current,
  });
  const setBackend = (next: BackendName) => {
    const coerced: BackendName = next === 'sam' && !samAvailable ? 'flood' : next;
    if (coerced === backend) return;
    backendRef.current.close();
    backendRef.current = makeBackend(coerced);
    setBackendState(coerced);
    if (srcPathRef.current && srcDimsRef.current) {
      void backendRef.current.open(srcPathRef.current, srcDimsRef.current);
    }
    setStatus(`backend → ${backendRef.current.name}`);
  };
  const [clicks, setClicks] = useState<ClickPoint[]>([]);
  // clicksRef mirrors `clicks` so handlers can read the CURRENT value even
  // when called multiple times within one React batch. Without this,
  // back-to-back addClick calls each see the stale render-time `clicks`
  // and overwrite each other instead of accumulating.
  const clicksRef = useRef<ClickPoint[]>([]);
  const [smartBusy, setSmartBusy] = useState(false);
  const smartTokenRef = useRef(0);

  // Derived: cheap overlay grid for visual feedback. Recomputes on commit
  // (maskVersion bump) — NOT on every brush mousemove.
  const overlayCells = useMemo(() => {
    if (!maskRef.current || !srcDims) return new Set<number>();
    return sampleToCells(maskRef.current, srcDims.w, srcDims.h, OVERLAY_RES);
  }, [maskVersion, srcDims]);

  // Cells that belong to the BRUSH/PAINT layer only — the combined mask
  // minus every smart-layer cell (muted or not). Smart layers own their
  // own pixels and render independently; the global overlay must NOT
  // double-paint that same area with `effectMode`, because:
  //   - it hides per-layer FX changes (a layer's plasma still renders
  //     under the global rainbow, so the user sees only rainbow)
  //   - it makes layer-mute look broken (muting a layer just lets the
  //     global paint through with no visible change)
  // Computed off the same maskVersion as overlayCells.
  const brushOnlyOverlayCells = useMemo(() => {
    if (overlayCells.size === 0) return overlayCells;
    if (layers.length === 0) return overlayCells;
    const owned = new Set<number>();
    for (const layer of layers) {
      for (const c of layer) owned.add(c);
    }
    const out = new Set<number>();
    for (const c of overlayCells) if (!owned.has(c)) out.add(c);
    return out;
  }, [overlayCells, layers]);

  const hasMaskEdits = useMemo(() => {
    if (!maskRef.current) return false;
    return hasAnyErased(maskRef.current);
  }, [maskVersion]);

  const compositionLayers = useMemo<CompositionLayer[]>(() => {
    const out: CompositionLayer[] = [];
    if (hasBrushLayer) {
      out.push({
        id: 'paint:base',
        kind: 'paint',
        name: paintLayerName,
        groupId: paintLayerGroup ? `group:${paintLayerGroup}` : null,
        groupName: paintLayerGroup || null,
        sourceIndex: -1,
        visible: true,
      });
    }
    for (let i = 0; i < layers.length; i++) {
      const cfg = layerConfigs[i];
      const meta = smartLayerMeta[i] ?? defaultSmartMeta(i);
      out.push({
        id: meta.id,
        kind: 'smart',
        name: meta.name,
        groupId: meta.groupId,
        groupName: meta.groupName,
        sourceIndex: i,
        visible: !(cfg?.muted),
      });
    }
    return out;
  }, [hasBrushLayer, paintLayerName, paintLayerGroup, layers, layerConfigs, smartLayerMeta]);

  // ── Ingestion ──────────────────────────────────────────────────────
  const ingest = async (path: string) => {
    const token = ++tokenRef.current;
    backendRef.current.close(); // release any previous-image state
    setIsBlank(false);
    setSrcPath(path);
    setStem(basenameStem(path));
    setSavedPath(null);
    setSrcDims(null);
    maskRef.current = null;
    setHasBrushLayer(false);
    setMaskVersion(0);
    clicksRef.current = [];
    setClicks([]);
    writeLayerStack([], [], []);
    setBusy(true);
    setStatus(`loading ${basenameStem(path)}…`);
    const dims = await identify(path);
    if (tokenRef.current !== token) return;
    if (!dims) {
      setStatus('could not read image dimensions');
      setBusy(false);
      return;
    }
    setSrcDims(dims);
    maskRef.current = new Uint8Array(dims.w * dims.h);
    void backendRef.current.open(path, dims); // fire and forget for Phase 0
    setBusy(false);
    setStatus(`ready · ${dims.w}×${dims.h} · brush or smart-select to cut out`);
  };

  const createBlankSurface = (w = srcDims?.w || 512, h = srcDims?.h || 512) => {
    const cw = clampCanvasSize(w);
    const ch = clampCanvasSize(h);
    tokenRef.current++;
    smartTokenRef.current++;
    backendRef.current.close();
    setIsBlank(true);
    setSrcPath(null);
    setStem('Untitled canvas');
    setSavedPath(null);
    setSrcDims({ w: cw, h: ch });
    maskRef.current = new Uint8Array(cw * ch);
    setHasBrushLayer(false);
    clicksRef.current = [];
    setClicks([]);
    writeLayerStack([], [], []);
    setMaskVersion((v) => v + 1);
    setBusy(false);
    setSmartBusy(false);
    setStatus(`blank canvas · ${cw}×${ch}`);
  };

  const setCanvasSize = (w: number, h: number) => {
    const cw = clampCanvasSize(w);
    const ch = clampCanvasSize(h);
    if (!srcDims || (srcDims.w === cw && srcDims.h === ch)) return;
    setSrcDims({ w: cw, h: ch });
    maskRef.current = new Uint8Array(cw * ch);
    setHasBrushLayer(false);
    clicksRef.current = [];
    setClicks([]);
    writeLayerStack([], [], []);
    setMaskVersion((v) => v + 1);
    setStatus(`${isBlank ? 'blank canvas' : 'canvas resized'} · ${cw}×${ch}`);
  };

  useFileDrop((path) => { void ingest(path); });

  const pickFile = async () => {
    setStatus('opening file picker…');
    const r = await execAsync(
      "zenity --file-selection --title='Pick an image' " +
      "--file-filter='Images | *.png *.jpg *.jpeg *.webp *.gif *.bmp *.tif *.tiff' " +
      "--file-filter='All files | *'"
    );
    const path = (r.stdout || '').trim();
    if (!path) { setStatus(`no file selected (exit ${r.code})`); return; }
    void ingest(path);
  };

  // ── Brush ───────────────────────────────────────────────────────────
  // The version-bump model is:
  //   - beginStroke bumps immediately so the FIRST paint of a stroke is
  //     reflected even if the matching mouseup never reaches us (clicks
  //     near the canvas edge or off the Pressable hit-region drop mouseup).
  //   - paintAtSource bumps with a throttle (~60ms) so live drag has
  //     ongoing feedback without recomputing the 24MB-mask sample every
  //     mousemove.
  //   - endStroke bumps for the final settle if the throttle was deferred.
  const lastBumpRef = useRef(0);
  const BUMP_THROTTLE_MS = 60;
  const bump = () => setMaskVersion((v) => v + 1);
  const bumpThrottled = () => {
    const now = Date.now();
    if (now - lastBumpRef.current < BUMP_THROTTLE_MS) return;
    lastBumpRef.current = now;
    bump();
  };
  const beginStroke = () => {
    // Snapshot BEFORE the stroke starts so undo returns to the pre-
    // stroke state. We commit on stroke-begin (not end) because the
    // current state IS the BEFORE-state at this moment.
    history.commit(buildCurrentSession());
    drawingRef.current = true;
    lastBumpRef.current = 0; // force first paint to fire a bump
  };
  const endStroke = () => {
    drawingRef.current = false; // unconditional — survives orphan mouseups
    bump();
  };
  const paintAtSource = (sx: number, sy: number) => {
    if (!srcDims || !maskRef.current || !drawingRef.current) return;
    // Always write into the source mask so the export path (saveCutout,
    // saveIcons, saveSqi base) sees every painted pixel regardless of
    // which layer the user is targeting. The layer Set below is the
    // VISUAL view (controls which MaskQuad renders the cells); the
    // source mask is the truth for compositing.
    paintCircle(maskRef.current, srcDims.w, srcDims.h, sx, sy, brushPx, mode === 'erase' ? 1 : 0);
    const target = activeLayerRef.current;
    if (target < 0) {
      // Global brush layer — the historical path. The brush-only
      // overlay paints these cells with `effectMode`.
      setHasBrushLayer(true);
    } else if (target < layers.length) {
      // Smart layer paint — quantize the brush circle to overlayRes
      // cells and add/remove them from the layer's Set. The Editor's
      // per-layer MaskQuad sees the updated cells immediately because
      // useMemo on the Set ref refires when we hand it a new Set.
      const cellW = srcDims.w / overlayRes;
      const cellH = srcDims.h / overlayRes;
      const r = brushPx;
      const xMin = Math.max(0, Math.floor((sx - r) / cellW));
      const xMax = Math.min(overlayRes - 1, Math.ceil((sx + r) / cellW));
      const yMin = Math.max(0, Math.floor((sy - r) / cellH));
      const yMax = Math.min(overlayRes - 1, Math.ceil((sy + r) / cellH));
      const r2 = r * r;
      const next = new Set(layers[target]);
      for (let cy = yMin; cy <= yMax; cy++) {
        const ccy = (cy + 0.5) * cellH;
        const dy = ccy - sy;
        for (let cx = xMin; cx <= xMax; cx++) {
          const ccx = (cx + 0.5) * cellW;
          const dx = ccx - sx;
          if (dx * dx + dy * dy > r2) continue;
          const idx = cy * overlayRes + cx;
          if (mode === 'erase') next.add(idx);
          else next.delete(idx);
        }
      }
      const nextLayers = layers.slice();
      nextLayers[target] = next;
      setLayers(nextLayers);
    }
    bumpThrottled();
  };
  const clearMask = () => {
    if (!maskRef.current) return;
    history.commit(buildCurrentSession());
    maskRef.current.fill(0);
    setHasBrushLayer(false);
    setMaskVersion((v) => v + 1);
  };

  // ── Smart select ───────────────────────────────────────────────────
  // addClick pushes a new point and asks the backend to replay the full
  // history. The result REPLACES the current mask (Phase 0 simplification;
  // future phases may layer brush edits on top via a separate buffer).
  // A token guards against out-of-order responses if the user clicks fast.
  const runRefine = async (nextClicks: ClickPoint[]) => {
    if (!srcDims || !maskRef.current) return;
    const token = ++smartTokenRef.current;
    setSmartBusy(true);
    setStatus(nextClicks.length === 0
      ? 'cleared smart selection'
      : `smart-selecting · ${nextClicks.length} click${nextClicks.length === 1 ? '' : 's'}…`);
    const result = await backendRef.current.refine(nextClicks, buildBackendOpts());
    if (smartTokenRef.current !== token) return; // newer click won
    setSmartBusy(false);
    if (!result) {
      setStatus('smart-select failed');
      return;
    }
    // Replace the mask with the backend's combined output AND store the
    // per-click layers — the Editor renders one MaskQuad per layer (with
    // staggered hue/phase) when there are any, else falls back to the
    // single combined-mask MaskQuad path (SAM gives no layers).
    maskRef.current = result.mask;
    setHasBrushLayer(false);
    setOverlayRes(result.overlayRes);
    // Sync per-layer configs to the new layer count. PRESERVE any existing
    // entries by index so user customizations (mode, mute) survive a new
    // click adding another layer. For newly-appearing layers, seed with
    // the current global effectMode + a staggered hue/phase so neighbors
    // don't cycle in unison.
    const prev = layerConfigsRef.current;
    const prevMeta = smartLayerMetaRef.current;
    const nextConfigs: LayerConfig[] = result.layers.map((_, i) => prev[i] ?? defaultLayerConfig(i, {
      mode: effectModeRef.current,
      colors: effectColorsRef.current,
      hueOffset: effectHueOffsetRef.current,
      phaseOffset: effectPhaseOffsetRef.current,
      dim: effectDimRef.current,
    }));
    const nextMeta: SmartLayerMeta[] = result.layers.map((_, i) => prevMeta[i] ?? defaultSmartMeta(i));
    writeLayerStack(result.layers, nextConfigs, nextMeta);
    setMaskVersion((v) => v + 1);
    setStatus(`smart-select · ${nextClicks.length} click${nextClicks.length === 1 ? '' : 's'} · ${backendRef.current.name}`);
  };

  const addClick = async (sx: number, sy: number, label: ClickLabel) => {
    // Read from clicksRef (always current) not from `clicks` closure
    // (frozen at render time — would lose intermediate adds).
    history.commit(buildCurrentSession());
    const next: ClickPoint[] = [...clicksRef.current, { x: sx, y: sy, label }];
    clicksRef.current = next;
    setClicks(next);
    await runRefine(next);
  };

  const clearClicks = () => {
    history.commit(buildCurrentSession());
    clicksRef.current = [];
    setClicks([]);
    writeLayerStack([], [], []);
    if (maskRef.current) maskRef.current.fill(0);
    setHasBrushLayer(false);
    setMaskVersion((v) => v + 1);
    setStatus('cleared smart selection');
  };

  // ── Per-layer config ops ────────────────────────────────────────────
  // `i < 0` is the "global / brush layer" target. Editing the brush layer
  // routes the change to the corresponding effect* state so the global
  // MaskQuad preview and the next-created smart layer both pick it up.

  const setLayerMode = (i: number, m: SurfaceId) => {
    if (i < 0) { setEffectMode(m); return; }
    const cur = layerConfigsRef.current;
    if (i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...next[i], mode: m };
    writeLayerConfigs(next);
  };

  const setLayerColor = (i: number, slotIdx: number, hex: string) => {
    if (slotIdx < 0 || slotIdx >= NUM_COLOR_SLOTS) return;
    if (i < 0) {
      const next = effectColorsRef.current.slice();
      next[slotIdx] = hex;
      setEffectColors(next);
      return;
    }
    const cur = layerConfigsRef.current;
    if (i >= cur.length) return;
    const layer = cur[i];
    const colors = (layer.colors ?? SLOT_DEFAULTS).slice();
    colors[slotIdx] = hex;
    const next = cur.slice();
    next[i] = { ...layer, colors };
    writeLayerConfigs(next);
  };

  const setLayerHueOffset = (i: number, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    if (i < 0) { setEffectHueOffset(v); return; }
    const cur = layerConfigsRef.current;
    if (i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...next[i], hueOffset: v };
    writeLayerConfigs(next);
  };

  const setLayerPhaseOffset = (i: number, value: number) => {
    if (i < 0) { setEffectPhaseOffset(value); return; }
    const cur = layerConfigsRef.current;
    if (i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...next[i], phaseOffset: value };
    writeLayerConfigs(next);
  };

  const setLayerDim = (i: number, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    if (i < 0) { setEffectDim(v); return; }
    const cur = layerConfigsRef.current;
    if (i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...next[i], dim: v };
    writeLayerConfigs(next);
  };

  const setEffectColor = (slotIdx: number, hex: string) => setLayerColor(-1, slotIdx, hex);

  const addCustomSurface = (label: string, shader: string) => {
    const id = `custom:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`;
    const cleanLabel = label.trim() || `Custom ${customSurfaces.length + 1}`;
    setCustomSurfaces((cur) => [...cur, { id, label: cleanLabel, shader }]);
    return id;
  };

  const addPaintLayer = () => {
    if (!srcDims) createBlankSurface();
    if (!hasBrushLayer) {
      setHasBrushLayer(true);
      setStatus('paint layer ready');
      return -1;
    }

    const i = layers.length;
    const nextLayers = layers.concat([new Set<number>()]);
    const nextConfigs = layerConfigsRef.current.concat([defaultLayerConfig(i, {
      mode: effectModeRef.current,
      colors: effectColorsRef.current,
      hueOffset: effectHueOffsetRef.current,
      phaseOffset: effectPhaseOffsetRef.current,
      dim: effectDimRef.current,
    })]);
    const nextMeta = smartLayerMetaRef.current.concat([{
      ...defaultSmartMeta(i),
      name: `Layer ${i + 1}`,
    }]);
    writeLayerStack(nextLayers, nextConfigs, nextMeta);
    setStatus(`added Layer ${i + 1}`);
    return i;
  };

  const duplicateLayer = (i: number) => {
    if (i < 0) {
      setHasBrushLayer(true);
      setPaintLayerName(`${paintLayerName} copy`);
      setStatus('duplicated paint layer metadata');
      return;
    }
    if (i < 0 || i >= layers.length || !layerConfigsRef.current[i]) return;
    const insertAt = i + 1;
    const nextLayers = layers.slice();
    nextLayers.splice(insertAt, 0, new Set(layers[i]));
    const nextConfigs = layerConfigsRef.current.slice();
    nextConfigs.splice(insertAt, 0, {
      ...layerConfigsRef.current[i],
      colors: layerConfigsRef.current[i].colors.slice(),
    });
    const meta = smartLayerMetaRef.current[i] ?? defaultSmartMeta(i);
    const nextMeta = smartLayerMetaRef.current.slice();
    nextMeta.splice(insertAt, 0, {
      ...meta,
      id: makeLayerId('smart'),
      name: `${meta.name} copy`,
    });
    writeLayerStack(nextLayers, nextConfigs, nextMeta);
    setMaskVersion((v) => v + 1);
    setStatus(`duplicated ${meta.name}`);
  };

  const moveLayer = (i: number, dir: -1 | 1) => {
    if (i < 0) {
      setStatus('paint layer stays below mask layers');
      return;
    }
    const j = i + dir;
    if (j < 0 || i >= layers.length || j >= layers.length) return;
    const nextLayers = layers.slice();
    const nextConfigs = layerConfigsRef.current.slice();
    const nextMeta = smartLayerMetaRef.current.slice();
    [nextLayers[i], nextLayers[j]] = [nextLayers[j], nextLayers[i]];
    [nextConfigs[i], nextConfigs[j]] = [nextConfigs[j], nextConfigs[i]];
    [nextMeta[i], nextMeta[j]] = [nextMeta[j], nextMeta[i]];
    writeLayerStack(nextLayers, nextConfigs, nextMeta);
    setMaskVersion((v) => v + 1);
    setStatus('moved layer');
  };

  const mergeLayer = (i: number) => {
    if (i < 0) {
      setStatus('paint layer is already the base layer');
      return;
    }
    if (i < 0 || i >= layers.length) return;
    const meta = smartLayerMetaRef.current[i] ?? defaultSmartMeta(i);
    setHasBrushLayer(true);
    writeLayerStack(
      layers.slice(0, i).concat(layers.slice(i + 1)),
      layerConfigsRef.current.slice(0, i).concat(layerConfigsRef.current.slice(i + 1)),
      smartLayerMetaRef.current.slice(0, i).concat(smartLayerMetaRef.current.slice(i + 1)),
    );
    setMaskVersion((v) => v + 1);
    setStatus(`merged ${meta.name}`);
  };

  const deleteCompositionLayer = (i: number) => {
    if (i < 0) {
      clearMask();
      return;
    }
    if (i < 0 || i >= layers.length) return;
    const meta = smartLayerMetaRef.current[i] ?? defaultSmartMeta(i);
    writeLayerStack(
      layers.slice(0, i).concat(layers.slice(i + 1)),
      layerConfigsRef.current.slice(0, i).concat(layerConfigsRef.current.slice(i + 1)),
      smartLayerMetaRef.current.slice(0, i).concat(smartLayerMetaRef.current.slice(i + 1)),
    );
    setMaskVersion((v) => v + 1);
    setStatus(`deleted ${meta.name}`);
  };

  const setCompositionLayerName = (i: number, name: string) => {
    const clean = name.trim() || (i < 0 ? 'Paint Layer' : `Layer ${i + 1}`);
    if (i < 0) {
      setPaintLayerName(clean);
      return;
    }
    if (i >= smartLayerMetaRef.current.length) return;
    const next = smartLayerMetaRef.current.slice();
    next[i] = { ...(next[i] ?? defaultSmartMeta(i)), name: clean };
    smartLayerMetaRef.current = next;
    setSmartLayerMeta(next);
  };

  const setCompositionLayerGroup = (i: number, groupName: string) => {
    const clean = groupName.trim();
    if (i < 0) {
      setPaintLayerGroup(clean);
      return;
    }
    if (i >= smartLayerMetaRef.current.length) return;
    const next = smartLayerMetaRef.current.slice();
    next[i] = {
      ...(next[i] ?? defaultSmartMeta(i)),
      groupId: clean ? `group:${clean}` : null,
      groupName: clean || null,
    };
    smartLayerMetaRef.current = next;
    setSmartLayerMeta(next);
  };

  const toggleLayerMute = (i: number) => {
    const cur = layerConfigsRef.current;
    if (i < 0 || i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...next[i], muted: !next[i].muted };
    writeLayerConfigs(next);
  };

  /** Delete the i-th keep-layer. Maps that layer index back to its
   *  corresponding click in `clicks` (skipping rejects) and removes both
   *  the click and the config slot, then re-runs the backend so the
   *  combined mask updates. */
  const deleteLayer = async (i: number) => {
    history.commit(buildCurrentSession());
    const allClicks = clicksRef.current;
    let keepSeen = 0;
    let targetClickIdx = -1;
    for (let k = 0; k < allClicks.length; k++) {
      if (allClicks[k].label !== 'keep') continue;
      if (keepSeen === i) { targetClickIdx = k; break; }
      keepSeen++;
    }
    if (targetClickIdx < 0) return;
    const nextClicks = allClicks.slice(0, targetClickIdx).concat(allClicks.slice(targetClickIdx + 1));
    clicksRef.current = nextClicks;
    setClicks(nextClicks);
    // Drop the corresponding config slot now so the UI doesn't flash
    // stale state between delete + refine returning.
    const cur = layerConfigsRef.current;
    const nextConfigs = cur.slice(0, i).concat(cur.slice(i + 1));
    writeLayerConfigs(nextConfigs);
    await runRefine(nextClicks);
  };

  // Clean up backend when component unmounts.
  useEffect(() => () => { backendRef.current.close(); }, []);

  // ── Save ────────────────────────────────────────────────────────────
  const saveCutout = async () => {
    if (!srcPath || !srcDims || !maskRef.current) {
      setStatus('nothing to save'); return;
    }
    if (!hasAnyErased(maskRef.current)) {
      setStatus('mask is empty — erase something first'); return;
    }
    setBusy(true);
    setStatus(`saving ${srcDims.w}×${srcDims.h} cutout…`);
    mkdir('cart/pixel_icons');
    const outPath = `cart/pixel_icons/${stem}.cutout.png`;
    const r = await compositeCutout({
      srcPath, mask: maskRef.current, w: srcDims.w, h: srcDims.h, outPath,
    });
    setBusy(false);
    if (r.ok) {
      setSavedPath(outPath);
      setStatus(`saved → ${outPath}`);
    } else {
      setStatus(`save failed: ${r.error}`);
    }
  };

  const saveIcons = async () => {
    if (!srcPath || !srcDims || !maskRef.current) {
      setStatus('nothing to bake'); return;
    }
    if (!hasAnyErased(maskRef.current)) {
      setStatus('mask is empty — make a cutout first'); return;
    }
    setBusy(true);
    setStatus(`baking pixel-icons (64/128/512)…`);
    const r = await exportIcons({
      srcPath,
      mask: maskRef.current,
      srcW: srcDims.w,
      srcH: srcDims.h,
      stem,
    });
    setBusy(false);
    if (r.errors.length > 0 && r.written.length === 0) {
      setStatus(`icon bake failed: ${r.errors[0]}`);
      return;
    }
    setSavedPath(r.written.join('\n'));
    setStatus(`baked ${r.written.length} icon${r.written.length === 1 ? '' : 's'}${r.errors.length ? ` (${r.errors.length} errored)` : ''}`);
  };

  // Bake the merged cutout into a self-contained .sqi.json. The base pixel
  // matrix is quantized at `overlayRes` (matches the layer-mask resolution
  // so all quads composite at one shared coordinate system inside the
  // loader). Layer masks come straight from `layers` — they're already at
  // `overlayRes`.
  const saveSqi = async () => {
    if (!srcPath || !srcDims || !maskRef.current) {
      setStatus('nothing to export'); return;
    }
    if (!hasAnyErased(maskRef.current)) {
      setStatus('mask is empty — make a cutout first'); return;
    }
    setBusy(true);
    setStatus(`packing .sqi at ${overlayRes}×${overlayRes}…`);
    const { matrix, error } = await bakeMatrix({
      srcPath,
      mask: maskRef.current,
      srcW: srcDims.w,
      srcH: srcDims.h,
      size: overlayRes,
    });
    if (!matrix) {
      setBusy(false);
      setStatus(`sqi base bake failed: ${error}`);
      return;
    }
    const doc = buildSqi({
      size: overlayRes,
      stem,
      base: matrix,
      layerMasks: layers,
      layerConfigs: layerConfigsRef.current,
      customSurfaces,
    });
    mkdir('cart/pixel_icons');
    const outPath = `cart/pixel_icons/${stem}.sqi.json`;
    const ok = writeFile(outPath, serializeSqi(doc));
    setBusy(false);
    if (!ok) {
      setStatus(`sqi write failed at ${outPath}`);
      return;
    }
    setSavedPath(outPath);
    setStatus(`shader-quad image → ${outPath} (${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'})`);
  };

  // ── Autosave / restore ─────────────────────────────────────────────
  // Treat the cart as stateless: every meaningful edit lands on disk
  // within ~600ms, on next mount we re-read it. Mask payload sits in the
  // SAME JSON (RLE full-res) so there's no separate binary file to manage
  // — keeps the disk shape simple and the readFile/writeFile hooks happy.

  // Build a SessionDocument from the CURRENT state. Called lazily — at
  // autosave flush time and at undo/redo commit points — not eagerly on
  // every render. The RLE-encode of the full-resolution mask runs INSIDE
  // this function, so memoizing it was the silent perf killer: at 4K it
  // re-encoded ~16 Hz during a brush stroke (every maskVersion bump),
  // burning ~10 ms per pass that the user felt as a frame-rate drop.
  //
  // Trade-off: undo snapshots and the autosave write each call this
  // synchronously, so a stroke-start (which commits) costs one encode
  // (~10 ms at 4K). That's amortized across an actual stroke (~hundreds
  // of ms of painting) and only burns at discrete moments, not in the
  // hot per-frame loop.
  const buildCurrentSession = (): SessionDocument | null => {
    if (!srcDims) return null;
    return buildSession({
      stem,
      srcPath,
      srcDims,
      isBlank,
      tool,
      mode,
      brushPx,
      mask: maskRef.current,
      hasBrushLayer,
      clicks: clicks.map((c) => ({ x: c.x, y: c.y, label: c.label })),
      overlayRes,
      layers,
      layerConfigs,
      effectMode,
      effectColors,
      effectHueOffset,
      effectPhaseOffset,
      effectDim,
      customSurfaces,
      backend,
      floodFuzz,
      floodRejectFrac,
      samThreshold,
      samMaskIdx,
    });
  };

  // Apply a SessionDocument to the cart's state. Used by both the
  // mount-time restore path and by undo/redo — they all share the same
  // "rehydrate every field from a snapshot" semantics.
  const applyDoc = (doc: SessionDocument, { quiet = false }: { quiet?: boolean } = {}) => {
    const { mask, layers: layersRestored } = inflateSessionMasks(doc);
    maskRef.current = mask;
    // Restore backend choice + tunables before opening, so the new backend
    // gets the right per-image precompute (SAM encoder vs flood no-op).
    const restoredBackend: BackendName = doc.backend === 'sam' && samAvailable
      ? 'sam'
      : 'flood';
    if (restoredBackend !== backend) {
      backendRef.current.close();
      backendRef.current = makeBackend(restoredBackend);
      setBackendState(restoredBackend);
    } else {
      backendRef.current.close();
    }
    if (typeof doc.floodFuzz === 'number') setFloodFuzz(doc.floodFuzz);
    if (typeof doc.floodRejectFrac === 'number') setFloodRejectFrac(doc.floodRejectFrac);
    if (typeof doc.samThreshold === 'number') setSamThreshold(doc.samThreshold);
    if (typeof doc.samMaskIdx === 'number') {
      setSamMaskIdx(Math.max(0, Math.min(2, doc.samMaskIdx)) as 0 | 1 | 2);
    }
    if (doc.srcPath && doc.srcDims) {
      void backendRef.current.open(doc.srcPath, doc.srcDims);
    }
    setStem(doc.stem);
    setSrcPath(doc.srcPath ?? null);
    setSrcDims(doc.srcDims ?? null);
    setIsBlank(!!doc.isBlank);
    setTool(doc.tool ?? 'brush');
    setMode(doc.mode ?? 'erase');
    setBrushPx(doc.brushPx ?? 32);
    setHasBrushLayer(!!doc.hasBrushLayer);
    clicksRef.current = (doc.clicks ?? []).slice();
    setClicks(clicksRef.current);
    setOverlayRes(doc.overlayRes ?? OVERLAY_RES);
    setLayers(layersRestored);
    writeLayerConfigs((doc.layerConfigs ?? []).map((c) => ({
      mode: c.mode,
      hueOffset: c.hueOffset,
      phaseOffset: c.phaseOffset,
      muted: c.muted,
      colors: c.colors?.slice() ?? SLOT_DEFAULTS.slice(),
      dim: typeof c.dim === 'number' ? c.dim : 0.85,
    })));
    setEffectMode(doc.effectMode ?? 'rainbow');
    setEffectColors((doc.effectColors ?? SLOT_DEFAULTS).slice());
    setEffectHueOffset(doc.effectHueOffset ?? 0);
    setEffectPhaseOffset(doc.effectPhaseOffset ?? 0);
    setEffectDim(typeof doc.effectDim === 'number' ? doc.effectDim : 0.85);
    setCustomSurfaces((doc.customSurfaces ?? []).map((cs) => ({ ...cs })));
    setMaskVersion((v) => v + 1);
    if (!quiet) setStatus(`restored · ${doc.stem}`);
  };

  // Restore on mount. Guarded so React strict-mode's double-invoke pass
  // doesn't run the disk → state path twice (the second run would
  // clobber any in-flight edits with the stale snapshot).
  useEffect(() => {
    if (restoreOnceRef.current) return;
    restoreOnceRef.current = true;
    const pointer = readFile(SESSION_LAST_POINTER);
    if (!pointer) { autosaveSuppressedRef.current = false; return; }
    const targetStem = pointer.trim();
    if (!targetStem) { autosaveSuppressedRef.current = false; return; }
    const text = readFile(sessionPathFor(targetStem));
    if (!text) { autosaveSuppressedRef.current = false; return; }
    const doc = parseSession(text);
    if (!doc) { autosaveSuppressedRef.current = false; return; }

    applyDoc(doc, { quiet: true });
    setRestoredFrom(targetStem);
    setStatus(`restored session · ${targetStem}`);

    // The setters above will trigger the autosave memo + effect. Release
    // the suppression flag on the next tick so the restored payload
    // doesn't immediately get re-flushed (no-op, but pointless churn).
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave. Effect depends on every observable state slice
  // that matters (maskVersion captures the brush mask via a counter; the
  // rest are React-tracked refs). The HEAVY work — RLE-encoding the
  // full-resolution mask — runs INSIDE the setTimeout, so a brush flurry
  // at 16 Hz schedules+cancels timers cheaply and only flushes once
  // (~600 ms after the last bump).
  useEffect(() => {
    if (autosaveSuppressedRef.current) return;
    if (!srcDims) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      const doc = buildCurrentSession();
      if (!doc) return;
      mkdir(SESSION_DIR);
      const path = sessionPathFor(doc.stem);
      const ok = writeFile(path, serializeSession(doc));
      if (ok) {
        writeFile(SESSION_LAST_POINTER, doc.stem);
        setLastSavedAt(Date.now());
      }
    }, 600);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stem, srcPath, srcDims, isBlank,
    tool, mode, brushPx,
    maskVersion, hasBrushLayer,
    clicks, overlayRes, layers, layerConfigs,
    effectMode, effectColors, effectHueOffset, effectPhaseOffset, effectDim,
    customSurfaces,
    backend, floodFuzz, floodRejectFrac, samThreshold, samMaskIdx,
  ]);

  // Debounced re-refine on backend / tunable change. When the user drags a
  // slider, we want the mask to update live, but each refine costs ~50ms
  // (SAM) or ~150ms (flood-per-keep). A 250ms settle keeps slider feedback
  // responsive without queueing dozens of in-flight requests. Guarded by
  // clicksRef so we don't spin up a no-op refine on an empty selection.
  useEffect(() => {
    if (clicksRef.current.length === 0) return;
    if (!srcDims) return;
    const t = setTimeout(() => { void runRefine(clicksRef.current); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, floodFuzz, floodRejectFrac, samThreshold, samMaskIdx]);

  // ── Undo / redo / clipboard ────────────────────────────────────────
  // commit() captures the CURRENT snapshot before a mutation lands so
  // undo can return to it. Reserved for future call-site sprinkles
  // (endStroke, addClick, deleteLayer, etc.); reachable today via the
  // keyboard shortcuts + the undo/redo state fields exposed below.
  // commitCoalesced is for slider-style continuous edits — first-write-
  // wins inside a 250 ms window so a drag becomes one undo step.
  const commit = () => history.commit(buildCurrentSession());
  const commitCoalesced = () => history.commitCoalesced(buildCurrentSession());
  // Mark these as used to silence "declared but never used" until the
  // call-site sprinkle pass lands. The keyboard handlers below already
  // exercise commit() through pasteLayer().
  void commit; void commitCoalesced;

  const undo = () => {
    const prev = history.undo(buildCurrentSession());
    if (!prev) { setStatus('nothing to undo'); return; }
    autosaveSuppressedRef.current = true;
    applyDoc(prev, { quiet: true });
    setStatus('undo');
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
  };

  const redo = () => {
    const next = history.redo(buildCurrentSession());
    if (!next) { setStatus('nothing to redo'); return; }
    autosaveSuppressedRef.current = true;
    applyDoc(next, { quiet: true });
    setStatus('redo');
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
  };

  // Copy / paste / cut on smart layers. Paste creates a new entry in
  // `layers` + `layerConfigs` + `smartLayerMeta` so the composition
  // stack treats it as a first-class layer. No corresponding click is
  // created — pasted layers don't round-trip through the smart-select
  // backend, they're standalone.
  const copyLayer = (i: number) => {
    if (i < 0 || i >= layers.length) {
      setStatus('select a layer to copy'); return;
    }
    const config = layerConfigsRef.current[i];
    if (!config) return;
    setClipboard({
      mask: new Set<number>(layers[i]),
      config: {
        mode: config.mode,
        hueOffset: config.hueOffset,
        phaseOffset: config.phaseOffset,
        muted: config.muted,
        colors: config.colors.slice(),
        dim: config.dim,
      },
      sourceLabel: `Layer ${i + 1}`,
    });
    setStatus(`copied · Layer ${i + 1}`);
  };

  const pasteLayer = () => {
    if (!clipboard) { setStatus('clipboard empty'); return; }
    history.commit(buildCurrentSession());
    const nextLayers = [...layers, new Set<number>(clipboard.mask)];
    const nextConfigs = [...layerConfigsRef.current, {
      mode: clipboard.config.mode,
      hueOffset: clipboard.config.hueOffset,
      phaseOffset: clipboard.config.phaseOffset,
      muted: false,
      colors: clipboard.config.colors.slice(),
      dim: clipboard.config.dim,
    }];
    const nextMeta = [...smartLayerMetaRef.current, {
      id: `pasted:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`,
      name: `${clipboard.sourceLabel} (pasted)`,
      groupId: null,
      groupName: null,
    }];
    writeLayerStack(nextLayers, nextConfigs, nextMeta);
    setStatus(`pasted · ${clipboard.sourceLabel}`);
  };

  const cutLayer = (i: number) => {
    if (i < 0 || i >= layers.length) {
      setStatus('select a layer to cut'); return;
    }
    copyLayer(i);
    void deleteLayer(i);
  };

  // Keyboard shortcuts. useIFTTT fires on the global key bus regardless
  // of cart focus. ctrl+c / ctrl+x currently target the topmost smart
  // layer as a fallback — once selectedLayer is lifted into the cart
  // state we'll route to the explicit Inspector selection.
  useIFTTT('key:ctrl+z', () => undo());
  useIFTTT('key:ctrl+y', () => redo());
  useIFTTT('key:ctrl+shift+z', () => redo());
  useIFTTT('key:ctrl+c', () => {
    if (layers.length === 0) { setStatus('no layer to copy'); return; }
    copyLayer(layers.length - 1);
  });
  useIFTTT('key:ctrl+v', () => pasteLayer());
  useIFTTT('key:ctrl+x', () => {
    if (layers.length === 0) { setStatus('no layer to cut'); return; }
    cutLayer(layers.length - 1);
  });

  return {
    srcPath, stem, srcDims, isBlank,
    status, busy, savedPath,
    tool, mode, brushPx, setTool, setMode, setBrushPx,
    activeLayer, setActiveLayer,
    maskVersion, hasMaskEdits, hasBrushLayer, overlayCells, brushOnlyOverlayCells,
    beginStroke, paintAtSource, endStroke, clearMask, createBlankSurface, setCanvasSize,
    backendName: backendRef.current.name,
    backend, setBackend, samAvailable,
    floodFuzz, setFloodFuzz,
    floodRejectFrac, setFloodRejectFrac,
    samThreshold, setSamThreshold,
    samMaskIdx, setSamMaskIdx,
    clicks, addClick, clearClicks, smartBusy,
    layers, overlayRes,
    layerConfigs, compositionLayers, setLayerMode, toggleLayerMute, deleteLayer,
    addPaintLayer, duplicateLayer, moveLayer, mergeLayer, deleteCompositionLayer, setCompositionLayerName, setCompositionLayerGroup,
    setLayerColor, setLayerHueOffset, setLayerPhaseOffset, setLayerDim,
    effectMode, setEffectMode,
    effectColors, effectHueOffset, effectPhaseOffset, effectDim,
    setEffectColor, setEffectHueOffset, setEffectPhaseOffset, setEffectDim,
    customSurfaces, addCustomSurface,
    pickFile, saveCutout, saveIcons, saveSqi,
    lastSavedAt, restoredFrom,
    canUndo: history.canUndo, canRedo: history.canRedo, undo, redo,
    clipboard, copyLayer, pasteLayer, cutLayer,
  };
}

function basenameStem(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]+/g, '_');
}

function clampCanvasSize(n: number): number {
  if (!Number.isFinite(n)) return 512;
  return Math.max(16, Math.min(4096, Math.round(n)));
}

function makeLayerId(kind: CompositionLayerKind): string {
  return `${kind}:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`;
}

function defaultSmartMeta(i: number): SmartLayerMeta {
  return {
    id: makeLayerId('smart'),
    name: `Layer ${i + 1}`,
    groupId: null,
    groupName: null,
  };
}

function defaultLayerConfig(
  i: number,
  defaults: {
    mode: SurfaceId;
    colors: string[];
    hueOffset: number;
    phaseOffset: number;
    dim: number;
  },
): LayerConfig {
  return {
    mode: defaults.mode,
    hueOffset: ((i * 0.6180339887) + defaults.hueOffset) % 1,
    phaseOffset: i * 0.7 + defaults.phaseOffset,
    muted: false,
    colors: defaults.colors.slice(),
    dim: defaults.dim,
  };
}
