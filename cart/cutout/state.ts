// useCutoutState — the single source of truth for the cutout cart.
//
// ── Unified layer model (dual-source masks) ───────────────────────────
// A cutout is ONE stack of layers. Each layer owns TWO full-resolution GPU
// mask textures that compose:
//   - base  (smart selection): set by replaying this layer's clicks; rebuilt
//     on every refine. Binary, stored 0/255 (255 = removed).
//   - brush (manual override): brush/lasso/refine paint here ON TOP of the
//     base. Three states: 0 = untouched (defer to base), ~128 = force-keep,
//     ~255 = force-remove.
// Effective removed-mask = brush==force ? brush : base. So you can smart-
// select a layer, clean it up with the brush, and smart-select AGAIN — the
// re-refine rebuilds `base` while your brush overrides ride on top untouched.
//
// `activeLayer` is the index every tool writes into. Brush, lasso, refine
// and smart-select all edit the active layer — switching tools never
// disturbs the stack. On-screen + exported PNG/.sqi composite the stack:
// the final removed region is the union of every visible layer's effective
// mask.
//
// Perf invariants:
//   - Brush dabs write straight to the GPU override texture (paintableOps)
//     and only bump a throttled version counter — never a per-dab setState.
//   - RLE-encoding masks for autosave / undo runs lazily at discrete commit
//     points, reading each layer's textures back on demand.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { execAsync } from '@reactjit/runtime/hooks/process';
import { usePaintable, paintableOps } from '@reactjit/runtime/hooks/usePaintable';
import { identify, loadGrayImage, compositeCutout, type Dims, type GrayImage } from './magick';
import { hasAnyErased, snapToStrongGradient } from './mask';
import { createFloodBackend } from './backends/flood';
import { createSamBackend } from './backends/sam';
import { isSegmentAvailable } from '@reactjit/runtime/hooks/useSegment';
import type { BackendOpts, ClickLabel, ClickPoint, SelectionBackend } from './backends/types';
import { bakeMatrix, exportIcons } from './icons';
import { buildSqi, decodeMaskRows, parseSqi, serializeSqi } from './sqi';
import {
  buildSession,
  inflateSessionLayers,
  parseSession,
  serializeSession,
  sessionPathFor,
  SESSION_DIR,
  SESSION_LAST_POINTER,
  type LayerSnapshot,
  type SessionDocument,
} from './session';
import type { CustomSurface, SurfaceId } from './components/MaskQuad';
import { NUM_COLOR_SLOTS, SLOT_DEFAULTS } from './components/MaskQuad';
import type { LayerConfig, BlendMode } from './domain';
import { adoptSurface } from './domain';
import { useHistory } from './history';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';

export type Mode = 'erase' | 'restore';
export type Tool = 'brush' | 'smart' | 'hand' | 'lasso' | 'refine';
export type LassoPoint = { x: number; y: number };
export type BackendName = 'flood' | 'sam';

/** Grid resolution used when baking a layer down for the .sqi export. The
 *  working masks are full-resolution; this only affects the shipped FX
 *  artifact. */
export const OVERLAY_RES = 128;

const DEFAULT_FLOOD_FUZZ = 15;
const DEFAULT_FLOOD_REJECT_FRAC = 0.04;
const DEFAULT_SAM_THRESHOLD = 0;
const DEFAULT_SAM_MASK_IDX: 0 | 1 | 2 = 0;
const BRUSH_SIZES = [2, 8, 32, 128, 512];
const BRUSH_EDGE_SNAP_THRESHOLD = 150;
const BRUSH_SPACING_FRAC = 0.32;

// Brush override band values (normalized 0..1, written via paintable.circle
// which stores value*255 into the R8 texture). Read back as bytes.
const BRUSH_REMOVE = 1.0; // force-remove (erase mode)  → byte 255
const BRUSH_KEEP = 0.5;   // force-keep   (restore mode) → byte ~128

export type { LayerConfig } from './domain';

/** A layer in the stack. Both masks live on the GPU under base/brush ids. */
export interface Layer {
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  /** Paintable id for the SMART selection mask (full-res R8, 0/255). */
  baseId: string;
  /** Paintable id for MANUAL brush overrides (0 untouched / ~128 keep /
   *  ~255 remove). Brush/lasso/refine paint here so re-refining never wipes
   *  manual cleanup. */
  brushId: string;
  /** Smart-select click history that drives `base` (empty = brush only). */
  clicks: ClickPoint[];
}

function baseIdFor(layerId: string): string { return `cutout-base-${layerId}`; }
function brushIdFor(layerId: string): string { return `cutout-brush-${layerId}`; }

/** Scale a 0/1 (or 0/255) mask to 0/255 so the R8Unorm sampler reads it as
 *  1.0, not byte-1 ≈ 0.004. paintable.upload writes RAW bytes, so the
 *  backend's 0/1 mask MUST be scaled or it samples as empty. */
function scaleMask(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ? 255 : 0;
  return out;
}

/** Compose a layer's effective binary mask (1 = removed) from its smart
 *  base (0/255 bytes) and brush override (0 untouched / ~128 keep / ~255
 *  remove). Matches the in-shader compose in MaskQuad. */
function effectiveMask(base: Uint8Array | null, brush: Uint8Array | null, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const ov = brush ? brush[i] : 0;
    if (ov >= 192) out[i] = 1;                          // force remove
    else if (ov >= 64) out[i] = 0;                      // force keep
    else out[i] = base && base[i] >= 128 ? 1 : 0;       // untouched → base
  }
  return out;
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
  lassoPoints: LassoPoint[];
  addLassoPoint: (sx: number, sy: number) => void;
  commitLasso: () => void;
  clearLasso: () => void;

  // Layer stack
  layers: Layer[];
  activeLayer: number;
  setActiveLayer: (i: number) => void;
  maskVersion: number;
  hasMaskEdits: boolean;

  // Brush / mask ops — act on the ACTIVE layer.
  beginStroke: () => void;
  paintAtSource: (sx: number, sy: number, pressure?: number) => void;
  endStroke: () => void;
  clearMask: () => void;
  invertMask: () => void;
  createBlankSurface: (w?: number, h?: number) => void;
  setCanvasSize: (w: number, h: number) => void;

  // Smart-select — drives the ACTIVE layer's selection.
  backendName: string;
  backend: BackendName;
  setBackend: (b: BackendName) => void;
  samAvailable: boolean;
  floodFuzz: number;
  setFloodFuzz: (n: number) => void;
  floodRejectFrac: number;
  setFloodRejectFrac: (n: number) => void;
  samThreshold: number;
  setSamThreshold: (n: number) => void;
  samMaskIdx: 0 | 1 | 2;
  setSamMaskIdx: (n: 0 | 1 | 2) => void;
  /** The active layer's click history (for the canvas markers + Inspector). */
  clicks: ClickPoint[];
  addClick: (sx: number, sy: number, label: ClickLabel) => Promise<void>;
  clearClicks: () => void;
  smartBusy: boolean;

  // Layer ops. `i` indexes `layers`. The per-look setters also accept the
  // legacy `i = -1` to target the effect* defaults.
  addLayer: () => number;
  deleteLayer: (i: number) => void;
  duplicateLayer: (i: number) => void;
  moveLayer: (i: number, dir: -1 | 1) => void;
  mergeLayer: (i: number) => void;
  toggleLayerMute: (i: number) => void;
  setLayerName: (i: number, name: string) => void;
  setLayerGroup: (i: number, groupName: string) => void;
  setLayerMode: (i: number, m: SurfaceId) => void;
  setLayerBlend: (i: number, blend: BlendMode) => void;
  setLayerColor: (i: number, slotIdx: number, hex: string) => void;
  setLayerHueOffset: (i: number, value: number) => void;
  setLayerPhaseOffset: (i: number, value: number) => void;
  setLayerDim: (i: number, value: number) => void;

  // Effect defaults — seed new layers; edited by the Tools palette.
  effectMode: SurfaceId;
  setEffectMode: (m: SurfaceId) => void;
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
  saveIcons: () => Promise<void>;
  saveSqi: () => Promise<void>;
  importSqi: (path?: string) => Promise<void>;

  lastSavedAt: number | null;
  restoredFrom: string | null;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  clipboard: LayerClipping | null;
  copyLayer: (i: number) => void;
  pasteLayer: () => void;
  cutLayer: (i: number) => void;
}

export interface LayerClipping {
  baseBytes: Uint8Array | null;
  brushBytes: Uint8Array | null;
  config: LayerConfig;
  clicks: ClickPoint[];
  sourceName: string;
}

let g_layerCounter = 1;
function newLayerId(): string {
  return `L${(g_layerCounter++).toString(36)}${Date.now().toString(36).slice(-3)}`;
}

function defaultConfig(seed: {
  mode: SurfaceId; colors: string[]; hueOffset: number; phaseOffset: number; dim: number;
}, ordinal: number): LayerConfig {
  return {
    mode: seed.mode,
    blend: 'normal',
    hueOffset: ((ordinal * 0.6180339887) + seed.hueOffset) % 1,
    phaseOffset: ordinal * 0.7 + seed.phaseOffset,
    muted: false,
    colors: seed.colors.slice(),
    dim: seed.dim,
  };
}

function cloneConfig(c: LayerConfig): LayerConfig {
  return { ...c, colors: c.colors.slice() };
}

export function useCutoutState(): CutoutState {
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [stem, setStem] = useState('cutout');
  const [srcDims, setSrcDims] = useState<Dims | null>(null);
  const srcDimsRef = useRef<Dims | null>(null); srcDimsRef.current = srcDims;
  const srcPathRef = useRef<string | null>(null); srcPathRef.current = srcPath;
  const [isBlank, setIsBlank] = useState(false);
  const [status, setStatus] = useState('no source loaded');
  const [busy, setBusy] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [mode, setMode] = useState<Mode>('erase');
  const [brushPx, setBrushPx] = useState(32);
  const [lassoPoints, setLassoPoints] = useState<LassoPoint[]>([]);
  const [maskVersion, setMaskVersion] = useState(0);

  // ── Layer stack ─────────────────────────────────────────────────────
  const [layers, setLayersState] = useState<Layer[]>([]);
  const layersRef = useRef<Layer[]>([]); layersRef.current = layers;
  const setLayers = (next: Layer[]) => { layersRef.current = next; setLayersState(next); };
  const [activeLayer, setActiveLayerState] = useState(-1);
  const activeLayerRef = useRef(-1); activeLayerRef.current = activeLayer;
  const setActiveLayer = (i: number) => {
    const clamped = i < 0 ? -1 : Math.min(i, layersRef.current.length - 1);
    activeLayerRef.current = clamped;
    setActiveLayerState(clamped);
  };

  // Pending CPU→GPU uploads, keyed by paintable id. Bytes are stored READY
  // to upload (already scaled for base channels). Filled by restore / undo /
  // duplicate / paste / import (which set `layers` before the matching
  // <Paintable> mounts) and flushed once the textures exist.
  const pendingUploadsRef = useRef<Map<string, Uint8Array>>(new Map());
  useEffect(() => {
    if (pendingUploadsRef.current.size === 0) return;
    const live = new Set<string>();
    for (const l of layersRef.current) { live.add(l.baseId); live.add(l.brushId); }
    for (const [id, bytes] of pendingUploadsRef.current) {
      if (live.has(id)) paintableOps(id).upload(bytes);
    }
    pendingUploadsRef.current.clear();
    setMaskVersion((v) => v + 1);
  }, [layers]);

  // Effect defaults (seed new layers; Tools palette edits these).
  const [effectMode, setEffectModeState] = useState<SurfaceId>('rainbow');
  const [effectColors, setEffectColors] = useState<string[]>(SLOT_DEFAULTS.slice());
  const [effectHueOffset, setEffectHueOffsetState] = useState(0);
  const [effectPhaseOffset, setEffectPhaseOffsetState] = useState(0);
  const [effectDim, setEffectDimState] = useState(0.85);
  const effectModeRef = useRef<SurfaceId>('rainbow'); effectModeRef.current = effectMode;
  const effectColorsRef = useRef<string[]>(SLOT_DEFAULTS.slice()); effectColorsRef.current = effectColors;
  const effectHueOffsetRef = useRef(0); effectHueOffsetRef.current = effectHueOffset;
  const effectPhaseOffsetRef = useRef(0); effectPhaseOffsetRef.current = effectPhaseOffset;
  const effectDimRef = useRef(0.85); effectDimRef.current = effectDim;
  const [customSurfaces, setCustomSurfaces] = useState<CustomSurface[]>([]);

  const [clipboard, setClipboard] = useState<LayerClipping | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);

  // Dirty bit — any paint/upload flips it on, clear-all flips it off.
  const maskDirtyCountRef = useRef(0);
  const [maskDirtyTick, setMaskDirtyTick] = useState(0);
  const markMaskDirty = () => {
    const wasClean = maskDirtyCountRef.current === 0;
    maskDirtyCountRef.current += 1;
    if (wasClean) setMaskDirtyTick((v) => v + 1);
  };
  const clearMaskDirty = () => {
    const wasDirty = maskDirtyCountRef.current > 0;
    maskDirtyCountRef.current = 0;
    if (wasDirty) setMaskDirtyTick((v) => v + 1);
  };
  const hasMaskEdits = useMemo(() => maskDirtyCountRef.current > 0, [maskDirtyTick]);

  const grayRef = useRef<GrayImage | null>(null);
  const tokenRef = useRef(0);
  const smartTokenRef = useRef(0);
  const drawingRef = useRef(false);
  const lastStrokePointRef = useRef<{ x: number; y: number; pressure: number } | null>(null);

  // ── Smart-select backend ────────────────────────────────────────────
  const samAvailable = isSegmentAvailable();
  const makeBackend = (name: BackendName): SelectionBackend =>
    name === 'sam' && samAvailable ? createSamBackend() : createFloodBackend();
  const [backend, setBackendState] = useState<BackendName>(samAvailable ? 'sam' : 'flood');
  const backendRef = useRef<SelectionBackend>(makeBackend(backend));
  const [floodFuzz, setFloodFuzzState] = useState(DEFAULT_FLOOD_FUZZ);
  const [floodRejectFrac, setFloodRejectFracState] = useState(DEFAULT_FLOOD_REJECT_FRAC);
  const [samThreshold, setSamThresholdState] = useState(DEFAULT_SAM_THRESHOLD);
  const [samMaskIdx, setSamMaskIdxState] = useState<0 | 1 | 2>(DEFAULT_SAM_MASK_IDX);
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
  const [smartBusy, setSmartBusy] = useState(false);

  const history = useHistory();
  const commit = () => history.commit(buildCurrentSession);
  const commitCoalesced = () => history.commitCoalesced(buildCurrentSession);

  // ── Layer helpers ───────────────────────────────────────────────────
  const makeLayer = (ordinal: number, name?: string): Layer => {
    const id = newLayerId();
    return {
      id,
      name: name ?? `Layer ${ordinal + 1}`,
      groupName: null,
      config: defaultConfig({
        mode: effectModeRef.current,
        colors: effectColorsRef.current,
        hueOffset: effectHueOffsetRef.current,
        phaseOffset: effectPhaseOffsetRef.current,
        dim: effectDimRef.current,
      }, ordinal),
      baseId: baseIdFor(id),
      brushId: brushIdFor(id),
      clicks: [],
    };
  };

  const activeLayerObj = (): Layer | null => {
    const i = activeLayerRef.current;
    const arr = layersRef.current;
    return i >= 0 && i < arr.length ? arr[i] : null;
  };

  const ensureActiveLayer = (): Layer => {
    let layer = activeLayerObj();
    if (layer) return layer;
    layer = makeLayer(layersRef.current.length);
    const next = layersRef.current.concat([layer]);
    setLayers(next);
    setActiveLayer(next.length - 1);
    return layer;
  };

  const patchLayer = (i: number, patch: Partial<Layer>) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...cur[i], ...patch };
    setLayers(next);
  };
  const patchLayerConfig = (i: number, patch: Partial<LayerConfig>) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...cur[i], config: { ...cur[i].config, ...patch } };
    setLayers(next);
  };

  /** Read a layer's effective binary mask (1 = removed) by composing its two
   *  textures. Used at export / snapshot / merge / invert. */
  const readEffective = (layer: Layer, n: number): Uint8Array => {
    const base = paintableOps(layer.baseId).readback();
    const brush = paintableOps(layer.brushId).readback();
    return effectiveMask(base, brush, n);
  };

  const bump = () => setMaskVersion((v) => v + 1);
  const lastBumpRef = useRef(0);
  const BUMP_THROTTLE_MS = 60;
  const bumpThrottled = () => {
    const now = Date.now();
    if (now - lastBumpRef.current < BUMP_THROTTLE_MS) return;
    lastBumpRef.current = now;
    bump();
  };

  // ── Ingestion ───────────────────────────────────────────────────────
  const ingest = async (path: string) => {
    const token = ++tokenRef.current;
    backendRef.current.close();
    setIsBlank(false);
    setSrcPath(path);
    setStem(basenameStem(path));
    setSavedPath(null);
    setSrcDims(null);
    grayRef.current = null;
    setLayers([]);
    setActiveLayer(-1);
    clearMaskDirty();
    setMaskVersion((v) => v + 1);
    setBusy(true);
    setStatus(`loading ${basenameStem(path)}…`);
    const dims = await identify(path);
    if (tokenRef.current !== token) return;
    if (!dims) { setStatus('could not read image dimensions'); setBusy(false); return; }
    setSrcDims(dims);
    const first = makeLayer(0, 'Layer 1');
    setLayers([first]);
    setActiveLayer(0);
    void backendRef.current.open(path, dims);
    setBusy(false);
    setStatus(`ready · ${dims.w}×${dims.h} · pick a tool and start cutting`);
    void loadGrayImage(path, dims).then((gray) => {
      if (tokenRef.current !== token) return;
      grayRef.current = gray;
      if (!gray) setStatus('ready · edge-aware refine unavailable for this source');
    });
  };

  const createBlankSurface = (w = srcDims?.w || 512, h = srcDims?.h || 512) => {
    const cw = clampCanvasSize(w);
    const ch = clampCanvasSize(h);
    tokenRef.current++;
    smartTokenRef.current++;
    backendRef.current.close();
    grayRef.current = null;
    setIsBlank(true);
    setSrcPath(null);
    setStem('Untitled canvas');
    setSavedPath(null);
    setSrcDims({ w: cw, h: ch });
    const first = makeLayer(0, 'Layer 1');
    setLayers([first]);
    setActiveLayer(0);
    clearMaskDirty();
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
    const first = makeLayer(0, 'Layer 1');
    setLayers([first]);
    setActiveLayer(0);
    clearMaskDirty();
    setMaskVersion((v) => v + 1);
    setStatus(`${isBlank ? 'blank canvas' : 'canvas resized'} · ${cw}×${ch}`);
  };

  useFileDrop((path) => { void ingest(path); });

  // ── Brush / lasso / refine — paint the ACTIVE layer's OVERRIDE ──────
  const pressureRadius = (pressure?: number) => {
    const p = typeof pressure === 'number' && Number.isFinite(pressure) && pressure > 0
      ? Math.max(0, Math.min(1, pressure)) : 0.5;
    return Math.max(1, brushPx * (0.35 + p * 1.3));
  };
  const snapBrushPoint = (sx: number, sy: number, radius: number) => {
    if (!grayRef.current || !srcDims || grayRef.current.w !== srcDims.w || grayRef.current.h !== srcDims.h) {
      return { x: sx, y: sy };
    }
    const snapRadius = Math.max(2, Math.min(12, radius * 0.35));
    return snapToStrongGradient(grayRef.current.pixels, srcDims.w, srcDims.h, sx, sy, snapRadius, BRUSH_EDGE_SNAP_THRESHOLD);
  };

  const beginStroke = () => {
    history.commit(buildCurrentSession);
    ensureActiveLayer();
    drawingRef.current = true;
    lastStrokePointRef.current = null;
    lastBumpRef.current = 0;
  };
  const endStroke = () => {
    drawingRef.current = false;
    lastStrokePointRef.current = null;
    bump();
  };

  const paintDabAtSource = (sx: number, sy: number, pressure?: number) => {
    if (!srcDims || !drawingRef.current) return;
    const layer = activeLayerObj();
    if (!layer) return;
    // Brush writes the OVERRIDE channel: erase → force-remove, restore →
    // force-keep. The smart base underneath is untouched, so re-refining
    // never wipes these strokes.
    const value = mode === 'erase' ? BRUSH_REMOVE : BRUSH_KEEP;
    const radius = pressureRadius(pressure);
    const pt = (tool === 'brush' || tool === 'refine') ? snapBrushPoint(sx, sy, radius) : { x: sx, y: sy };
    paintableOps(layer.brushId).circle(pt.x, pt.y, radius, value);
    markMaskDirty();
    bumpThrottled();
  };
  const paintAtSource = (sx: number, sy: number, pressure = 0.5) => {
    if (!srcDims || !drawingRef.current) return;
    const radius = pressureRadius(pressure);
    const spacing = Math.max(1, radius * BRUSH_SPACING_FRAC);
    const prev = lastStrokePointRef.current;
    if (!prev) {
      paintDabAtSource(sx, sy, pressure);
      lastStrokePointRef.current = { x: sx, y: sy, pressure };
      return;
    }
    const dx = sx - prev.x;
    const dy = sy - prev.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      paintDabAtSource(prev.x + dx * t, prev.y + dy * t, prev.pressure + (pressure - prev.pressure) * t);
    }
    lastStrokePointRef.current = { x: sx, y: sy, pressure };
  };

  const clearMask = () => {
    const layer = activeLayerObj();
    if (!layer) return;
    history.commit(buildCurrentSession);
    paintableOps(layer.baseId).clear(0);
    paintableOps(layer.brushId).clear(0);
    patchLayer(activeLayerRef.current, { clicks: [] });
    bump();
    setStatus(`cleared ${layer.name}`);
  };

  const invertMask = () => {
    const layer = activeLayerObj();
    if (!srcDims || !layer) return;
    history.commit(buildCurrentSession);
    // Bake the current effective mask, invert it into the base, and drop the
    // brush overrides + clicks (invert is a whole-layer reset of intent).
    const n = srcDims.w * srcDims.h;
    const eff = readEffective(layer, n);
    const inv = new Uint8Array(n);
    for (let i = 0; i < n; i++) inv[i] = eff[i] ? 0 : 255;
    paintableOps(layer.baseId).upload(inv);
    paintableOps(layer.brushId).clear(0);
    patchLayer(activeLayerRef.current, { clicks: [] });
    markMaskDirty();
    bump();
    setStatus(`inverted ${layer.name}`);
  };

  // ── Lasso — paints the ACTIVE layer's OVERRIDE ──────────────────────
  const addLassoPoint = (sx: number, sy: number) => {
    const nextPoint = { x: sx, y: sy };
    if (lassoPoints.length >= 3 && srcDims) {
      const first = lassoPoints[0];
      const dx = sx - first.x, dy = sy - first.y;
      const closeRadius = Math.max(8, Math.min(srcDims.w, srcDims.h) * 0.01);
      if (dx * dx + dy * dy <= closeRadius * closeRadius) { commitLasso(); return; }
    }
    setLassoPoints((cur) => [...cur, nextPoint]);
    setStatus(`lasso · ${lassoPoints.length + 1} point${lassoPoints.length === 0 ? '' : 's'}`);
  };
  const clearLasso = () => { setLassoPoints([]); setStatus('lasso cleared'); };
  const commitLasso = () => {
    if (!srcDims || lassoPoints.length < 3) return;
    const layer = ensureActiveLayer();
    history.commit(buildCurrentSession);
    const verts = new Float32Array(lassoPoints.length * 2);
    for (let i = 0; i < lassoPoints.length; i++) {
      verts[i * 2] = lassoPoints[i].x;
      verts[i * 2 + 1] = lassoPoints[i].y;
    }
    paintableOps(layer.brushId).polygon(verts, mode === 'erase' ? BRUSH_REMOVE : BRUSH_KEEP);
    setLassoPoints([]);
    markMaskDirty();
    bump();
    setStatus(`lasso ${mode === 'erase' ? 'removed' : 'restored'} · ${lassoPoints.length} points`);
  };

  // ── Smart select — rebuilds the ACTIVE layer's BASE ─────────────────
  const runRefine = async (layerIndex: number, nextClicks: ClickPoint[]) => {
    if (!srcDims) return;
    const layer = layersRef.current[layerIndex];
    if (!layer) return;
    const token = ++smartTokenRef.current;
    setSmartBusy(true);
    setStatus(nextClicks.length === 0
      ? 'cleared selection'
      : `smart-selecting · ${nextClicks.length} click${nextClicks.length === 1 ? '' : 's'}…`);
    const result = await backendRef.current.refine(nextClicks, buildBackendOpts());
    if (smartTokenRef.current !== token) return;
    setSmartBusy(false);
    if (!result) { setStatus('smart-select failed'); return; }
    // Replace ONLY this layer's smart base. Brush overrides + other layers
    // are untouched. Scale 0/1 → 0/255 so the sampler reads it as 1.0.
    paintableOps(layer.baseId).upload(scaleMask(result.mask));
    markMaskDirty();
    bump();
    setStatus(`smart-select · ${nextClicks.length} click${nextClicks.length === 1 ? '' : 's'} · ${backendRef.current.name}`);
  };

  const addClick = async (sx: number, sy: number, label: ClickLabel) => {
    history.commit(buildCurrentSession);
    const layer = ensureActiveLayer();
    const i = layersRef.current.indexOf(layer);
    const next = [...layer.clicks, { x: sx, y: sy, label }];
    patchLayer(i, { clicks: next });
    await runRefine(i, next);
  };

  const clearClicks = () => {
    const layer = activeLayerObj();
    if (!layer) return;
    history.commit(buildCurrentSession);
    patchLayer(activeLayerRef.current, { clicks: [] });
    paintableOps(layer.baseId).clear(0);
    bump();
    setStatus('cleared selection');
  };

  // ── Layer ops ───────────────────────────────────────────────────────
  const addLayer = () => {
    if (!srcDims) createBlankSurface();
    history.commit(buildCurrentSession);
    const ordinal = layersRef.current.length;
    const layer = makeLayer(ordinal);
    const next = layersRef.current.concat([layer]);
    setLayers(next);
    setActiveLayer(next.length - 1);
    setStatus(`added ${layer.name}`);
    return next.length - 1;
  };

  const deleteLayer = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    history.commit(buildCurrentSession);
    const removed = cur[i];
    const next = cur.slice(0, i).concat(cur.slice(i + 1));
    setLayers(next);
    paintableOps(removed.baseId).clear(0);
    paintableOps(removed.brushId).clear(0);
    const a = activeLayerRef.current;
    setActiveLayer(next.length === 0 ? -1 : Math.min(a > i ? a - 1 : a, next.length - 1));
    bump();
    setStatus(`deleted ${removed.name}`);
  };

  const duplicateLayer = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    history.commit(buildCurrentSession);
    const src = cur[i];
    const base = paintableOps(src.baseId).readback();
    const brush = paintableOps(src.brushId).readback();
    const dup = makeLayer(cur.length, `${src.name} copy`);
    dup.config = cloneConfig(src.config);
    dup.clicks = src.clicks.map((c) => ({ ...c }));
    if (base) pendingUploadsRef.current.set(dup.baseId, base);
    if (brush) pendingUploadsRef.current.set(dup.brushId, brush);
    const next = cur.slice();
    next.splice(i + 1, 0, dup);
    setLayers(next);
    setActiveLayer(i + 1);
    bump();
    setStatus(`duplicated ${src.name}`);
  };

  const moveLayer = (i: number, dir: -1 | 1) => {
    const cur = layersRef.current;
    const j = i + dir;
    if (i < 0 || i >= cur.length || j < 0 || j >= cur.length) return;
    history.commit(buildCurrentSession);
    const next = cur.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setLayers(next);
    if (activeLayerRef.current === i) setActiveLayer(j);
    else if (activeLayerRef.current === j) setActiveLayer(i);
    bump();
    setStatus('moved layer');
  };

  const mergeLayer = (i: number) => {
    const cur = layersRef.current;
    if (i <= 0 || i >= cur.length || !srcDims) { setStatus('nothing below to merge into'); return; }
    history.commit(buildCurrentSession);
    const above = cur[i];
    const below = cur[i - 1];
    const n = srcDims.w * srcDims.h;
    // Bake both effectives, union into `below`'s base, drop below's brush +
    // clicks (the merged result is now its baked base).
    const effAbove = readEffective(above, n);
    const effBelow = readEffective(below, n);
    const merged = new Uint8Array(n);
    for (let k = 0; k < n; k++) merged[k] = (effAbove[k] || effBelow[k]) ? 255 : 0;
    paintableOps(below.baseId).upload(merged);
    paintableOps(below.brushId).clear(0);
    paintableOps(above.baseId).clear(0);
    paintableOps(above.brushId).clear(0);
    const next = cur.slice(0, i).concat(cur.slice(i + 1));
    next[i - 1] = { ...below, clicks: [] };
    setLayers(next);
    setActiveLayer(Math.min(i - 1, next.length - 1));
    markMaskDirty();
    bump();
    setStatus(`merged ${above.name} down`);
  };

  const toggleLayerMute = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    commit();
    patchLayerConfig(i, { muted: !cur[i].config.muted });
    bump();
  };
  const setLayerName = (i: number, name: string) => {
    const clean = name.trim() || `Layer ${i + 1}`;
    commit();
    patchLayer(i, { name: clean });
  };
  const setLayerGroup = (i: number, groupName: string) => {
    commit();
    patchLayer(i, { groupName: groupName.trim() || null });
  };

  // Per-look setters. `i < 0` targets the effect* defaults.
  const setLayerMode = (i: number, m: SurfaceId) => {
    if (i < 0) { commitCoalesced(); setEffectModeState(m); return; }
    commitCoalesced(); patchLayerConfig(i, { mode: m }); bump();
  };
  const setLayerBlend = (i: number, blend: BlendMode) => {
    if (i < 0) return;
    commitCoalesced(); patchLayerConfig(i, { blend }); bump();
  };
  const setLayerColor = (i: number, slotIdx: number, hex: string) => {
    if (slotIdx < 0 || slotIdx >= NUM_COLOR_SLOTS) return;
    if (i < 0) {
      commitCoalesced();
      const next = effectColorsRef.current.slice();
      next[slotIdx] = hex;
      setEffectColors(next);
      return;
    }
    const cur = layersRef.current;
    if (i >= cur.length) return;
    commitCoalesced();
    const colors = (cur[i].config.colors ?? SLOT_DEFAULTS).slice();
    colors[slotIdx] = hex;
    patchLayerConfig(i, { colors });
    bump();
  };
  const setLayerHueOffset = (i: number, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    if (i < 0) { commitCoalesced(); setEffectHueOffsetState(v); return; }
    commitCoalesced(); patchLayerConfig(i, { hueOffset: v }); bump();
  };
  const setLayerPhaseOffset = (i: number, value: number) => {
    if (i < 0) { commitCoalesced(); setEffectPhaseOffsetState(value); return; }
    commitCoalesced(); patchLayerConfig(i, { phaseOffset: value }); bump();
  };
  const setLayerDim = (i: number, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    if (i < 0) { commitCoalesced(); setEffectDimState(v); return; }
    commitCoalesced(); patchLayerConfig(i, { dim: v }); bump();
  };

  const setEffectMode = (m: SurfaceId) => { commitCoalesced(); setEffectModeState(m); };
  const setEffectColor = (slotIdx: number, hex: string) => setLayerColor(-1, slotIdx, hex);
  const setEffectHueOffset = (v: number) => { commitCoalesced(); setEffectHueOffsetState(v); };
  const setEffectPhaseOffset = (v: number) => { commitCoalesced(); setEffectPhaseOffsetState(v); };
  const setEffectDim = (v: number) => { commitCoalesced(); setEffectDimState(v); };

  const addCustomSurface = (label: string, shader: string) => {
    const id = `custom:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`;
    const cleanLabel = label.trim() || `Custom ${customSurfaces.length + 1}`;
    setCustomSurfaces((cur) => [...cur, { id, label: cleanLabel, shader }]);
    return id;
  };

  // ── Backend swap ────────────────────────────────────────────────────
  const setBackend = (next: BackendName) => {
    const coerced: BackendName = next === 'sam' && !samAvailable ? 'flood' : next;
    if (coerced === backend) return;
    commitCoalesced();
    backendRef.current.close();
    backendRef.current = makeBackend(coerced);
    setBackendState(coerced);
    if (srcPathRef.current && srcDimsRef.current) {
      void backendRef.current.open(srcPathRef.current, srcDimsRef.current);
    }
    setStatus(`backend → ${backendRef.current.name}`);
  };
  const setFloodFuzz = (n: number) => { commitCoalesced(); setFloodFuzzState(n); };
  const setFloodRejectFrac = (n: number) => { commitCoalesced(); setFloodRejectFracState(n); };
  const setSamThreshold = (n: number) => { commitCoalesced(); setSamThresholdState(n); };
  const setSamMaskIdx = (n: 0 | 1 | 2) => { commitCoalesced(); setSamMaskIdxState(n); };

  useEffect(() => () => { backendRef.current.close(); }, []);

  // ── Export composite ────────────────────────────────────────────────
  // Final removed region = union of every VISIBLE layer's effective mask.
  const composeExportMask = (): Uint8Array | null => {
    if (!srcDims) return null;
    const n = srcDims.w * srcDims.h;
    let out: Uint8Array | null = null;
    for (const layer of layersRef.current) {
      if (layer.config.muted) continue;
      const eff = readEffective(layer, n);
      if (!out) out = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (eff[i]) out[i] = 1;
    }
    return out;
  };

  const maskToCellSet = (mask: Uint8Array, w: number, h: number, size: number): Set<number> => {
    const set = new Set<number>();
    const cw = w / size, ch = h / size;
    for (let cy = 0; cy < size; cy++) {
      const py = Math.min(h - 1, Math.floor((cy + 0.5) * ch));
      for (let cx = 0; cx < size; cx++) {
        const px = Math.min(w - 1, Math.floor((cx + 0.5) * cw));
        if (mask[py * w + px]) set.add(cy * size + cx);
      }
    }
    return set;
  };

  const saveCutout = async () => {
    if (!srcPath || !srcDims) { setStatus('nothing to save'); return; }
    const bytes = composeExportMask();
    if (!bytes || !hasAnyErased(bytes)) { setStatus('mask is empty — remove something first'); return; }
    setBusy(true);
    setStatus(`saving ${srcDims.w}×${srcDims.h} cutout…`);
    mkdir('cart/pixel_icons');
    const outPath = `cart/pixel_icons/${stem}.cutout.png`;
    const r = await compositeCutout({ srcPath, mask: bytes, w: srcDims.w, h: srcDims.h, outPath });
    setBusy(false);
    if (r.ok) { setSavedPath(outPath); setStatus(`saved → ${outPath}`); }
    else setStatus(`save failed: ${r.error}`);
  };

  const saveIcons = async () => {
    if (!srcPath || !srcDims) { setStatus('nothing to bake'); return; }
    const bytes = composeExportMask();
    if (!bytes || !hasAnyErased(bytes)) { setStatus('mask is empty — make a cutout first'); return; }
    setBusy(true);
    setStatus('baking pixel-icons (64/128/512)…');
    const r = await exportIcons({ srcPath, mask: bytes, srcW: srcDims.w, srcH: srcDims.h, stem });
    setBusy(false);
    if (r.errors.length > 0 && r.written.length === 0) { setStatus(`icon bake failed: ${r.errors[0]}`); return; }
    setSavedPath(r.written.join('\n'));
    setStatus(`baked ${r.written.length} icon${r.written.length === 1 ? '' : 's'}${r.errors.length ? ` (${r.errors.length} errored)` : ''}`);
  };

  const saveSqi = async () => {
    if (!srcPath || !srcDims) { setStatus('nothing to export'); return; }
    const composed = composeExportMask();
    if (!composed || !hasAnyErased(composed)) { setStatus('mask is empty — make a cutout first'); return; }
    setBusy(true);
    setStatus(`packing .sqi at ${OVERLAY_RES}×${OVERLAY_RES}…`);
    const { matrix, error } = await bakeMatrix({ srcPath, mask: composed, srcW: srcDims.w, srcH: srcDims.h, size: OVERLAY_RES });
    if (!matrix) { setBusy(false); setStatus(`sqi base bake failed: ${error}`); return; }
    const n = srcDims.w * srcDims.h;
    const layerMasks: Set<number>[] = [];
    const layerConfigs: LayerConfig[] = [];
    for (const layer of layersRef.current) {
      if (layer.config.muted) continue;
      const eff = readEffective(layer, n);
      layerMasks.push(maskToCellSet(eff, srcDims.w, srcDims.h, OVERLAY_RES));
      layerConfigs.push(layer.config);
    }
    const doc = buildSqi({
      size: OVERLAY_RES, stem, base: matrix,
      layerMasks, layerConfigs, customSurfaces,
      metadata: { title: stem, tags: ['cutout', 'shader-quad-image'] },
      thumbnailSize: 32,
    });
    mkdir('cart/pixel_icons');
    const outPath = `cart/pixel_icons/${stem}.sqi.json`;
    const ok = writeFile(outPath, serializeSqi(doc));
    setBusy(false);
    if (!ok) { setStatus(`sqi write failed at ${outPath}`); return; }
    setSavedPath(outPath);
    setStatus(`shader-quad image → ${outPath} (${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'})`);
  };

  const importSqi = async (givenPath?: string) => {
    let path = givenPath;
    if (!path) {
      setStatus('opening .sqi picker…');
      const r = await execAsync(
        "zenity --file-selection --title='Import SQI' " +
        "--file-filter='Shader Quad Images | *.sqi.json' " +
        "--file-filter='All files | *'"
      );
      path = (r.stdout || '').trim();
      if (!path) { setStatus(`no .sqi selected (exit ${r.code})`); return; }
    }
    const text = readFile(path);
    if (!text) { setStatus('could not read .sqi file'); return; }
    const doc = parseSqi(text);
    if (!doc) { setStatus('invalid .sqi file'); return; }
    history.commit(buildCurrentSession);
    createBlankSurface(doc.size, doc.size);
    setStem(doc.stem);
    const newCustoms: CustomSurface[] = [...customSurfaces];
    const newLayers: Layer[] = [];
    for (let li = 0; li < doc.layers.length; li++) {
      const sqiLayer = doc.layers[li];
      const cells = decodeMaskRows(sqiLayer.mask, doc.size);
      const { id: surfaceId, addedCustom } = adoptSurface(sqiLayer.surface, newCustoms);
      if (addedCustom) newCustoms.push(addedCustom);
      const layer = makeLayer(li, sqiLayer.label || `Layer ${li + 1}`);
      layer.config = {
        mode: surfaceId,
        blend: sqiLayer.blend ?? 'normal',
        hueOffset: sqiLayer.hueOffset,
        phaseOffset: sqiLayer.phaseOffset,
        dim: sqiLayer.dim,
        muted: sqiLayer.muted,
        colors: sqiLayer.colors?.slice() ?? SLOT_DEFAULTS.slice(),
      };
      // Inflate the cell set to a full-res base mask (0/255) at the .sqi grid
      // (doc.size == canvas size after createBlankSurface); brush stays empty.
      const bytes = new Uint8Array(doc.size * doc.size);
      for (const idx of cells) if (idx >= 0 && idx < bytes.length) bytes[idx] = 255;
      pendingUploadsRef.current.set(layer.baseId, bytes);
      newLayers.push(layer);
    }
    setCustomSurfaces(newCustoms);
    if (newLayers.length > 0) {
      setLayers(newLayers);
      setActiveLayer(0);
      markMaskDirty();
    }
    setMaskVersion((v) => v + 1);
    setStatus(`imported ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'} from ${path}`);
  };

  // ── Snapshot / session ──────────────────────────────────────────────
  const snapshotLayers = (): LayerSnapshot[] =>
    layersRef.current.map((l) => ({
      id: l.id,
      name: l.name,
      groupName: l.groupName,
      config: cloneConfig(l.config),
      // Readback is synchronous; only at discrete commit points, never per frame.
      base: paintableOps(l.baseId).readback(),
      brush: paintableOps(l.brushId).readback(),
      clicks: l.clicks.map((c) => ({ ...c })),
    }));

  const buildCurrentSession = (): SessionDocument | null => {
    if (!srcDims) return null;
    return buildSession({
      stem, srcPath, srcDims, isBlank,
      tool, mode, brushPx,
      layers: snapshotLayers(),
      activeLayer: activeLayerRef.current,
      effectMode, effectColors, effectHueOffset, effectPhaseOffset, effectDim,
      customSurfaces,
      backend, floodFuzz, floodRejectFrac, samThreshold, samMaskIdx,
    });
  };

  const applyDoc = (doc: SessionDocument, { quiet = false }: { quiet?: boolean } = {}) => {
    const inflated = inflateSessionLayers(doc);
    pendingUploadsRef.current.clear();
    const restored: Layer[] = inflated.map((l) => {
      const baseId = baseIdFor(l.id);
      const brushId = brushIdFor(l.id);
      if (l.base && l.base.length > 0) pendingUploadsRef.current.set(baseId, scaleMask(l.base));
      if (l.brush && l.brush.length > 0) pendingUploadsRef.current.set(brushId, l.brush);
      return { id: l.id, name: l.name, groupName: l.groupName, config: l.config, baseId, brushId, clicks: l.clicks };
    });

    const restoredBackend: BackendName = doc.backend === 'sam' && samAvailable ? 'sam' : 'flood';
    if (restoredBackend !== backend) {
      backendRef.current.close();
      backendRef.current = makeBackend(restoredBackend);
      setBackendState(restoredBackend);
    } else {
      backendRef.current.close();
    }
    if (typeof doc.floodFuzz === 'number') setFloodFuzzState(doc.floodFuzz);
    if (typeof doc.floodRejectFrac === 'number') setFloodRejectFracState(doc.floodRejectFrac);
    if (typeof doc.samThreshold === 'number') setSamThresholdState(doc.samThreshold);
    if (typeof doc.samMaskIdx === 'number') setSamMaskIdxState(Math.max(0, Math.min(2, doc.samMaskIdx)) as 0 | 1 | 2);

    if (doc.srcPath && doc.srcDims) {
      void backendRef.current.open(doc.srcPath, doc.srcDims);
      const token = ++tokenRef.current;
      grayRef.current = null;
      void loadGrayImage(doc.srcPath, doc.srcDims).then((gray) => {
        if (tokenRef.current !== token) return;
        grayRef.current = gray;
      });
    } else {
      grayRef.current = null;
    }
    setStem(doc.stem);
    setSrcPath(doc.srcPath ?? null);
    setSrcDims(doc.srcDims ?? null);
    setIsBlank(!!doc.isBlank);
    setTool(doc.tool ?? 'brush');
    setMode(doc.mode ?? 'erase');
    setBrushPx(doc.brushPx ?? 32);
    setLayers(restored);
    setActiveLayer(typeof doc.activeLayer === 'number' ? doc.activeLayer : (restored.length > 0 ? 0 : -1));
    setEffectModeState(doc.effectMode ?? 'rainbow');
    setEffectColors((doc.effectColors ?? SLOT_DEFAULTS).slice());
    setEffectHueOffsetState(doc.effectHueOffset ?? 0);
    setEffectPhaseOffsetState(doc.effectPhaseOffset ?? 0);
    setEffectDimState(typeof doc.effectDim === 'number' ? doc.effectDim : 0.85);
    setCustomSurfaces((doc.customSurfaces ?? []).map((cs) => ({ ...cs })));
    if (pendingUploadsRef.current.size > 0) markMaskDirty();
    else clearMaskDirty();
    setMaskVersion((v) => v + 1);
    if (!quiet) setStatus(`restored · ${doc.stem}`);
  };

  // ── Restore on mount ────────────────────────────────────────────────
  const restoreOnceRef = useRef(false);
  const autosaveTimerRef = useRef<any>(null);
  const autosaveSuppressedRef = useRef(true);
  useEffect(() => {
    if (restoreOnceRef.current) return;
    restoreOnceRef.current = true;
    const release = () => { autosaveSuppressedRef.current = false; };
    const pointer = readFile(SESSION_LAST_POINTER);
    if (!pointer) { release(); return; }
    const targetStem = pointer.trim();
    if (!targetStem) { release(); return; }
    const text = readFile(sessionPathFor(targetStem));
    if (!text) { release(); return; }
    const doc = parseSession(text);
    if (!doc) { release(); return; }
    applyDoc(doc, { quiet: true });
    setRestoredFrom(targetStem);
    setStatus(`restored session · ${targetStem}`);
    setTimeout(release, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Debounced autosave ──────────────────────────────────────────────
  useEffect(() => {
    if (autosaveSuppressedRef.current) return;
    if (!srcDims) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      const doc = buildCurrentSession();
      if (!doc) return;
      mkdir(SESSION_DIR);
      const path = sessionPathFor(doc.stem);
      if (writeFile(path, serializeSession(doc))) {
        writeFile(SESSION_LAST_POINTER, doc.stem);
        setLastSavedAt(Date.now());
      }
    }, 600);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stem, srcPath, srcDims, isBlank, tool, mode, brushPx,
    maskVersion, layers, activeLayer,
    effectMode, effectColors, effectHueOffset, effectPhaseOffset, effectDim,
    customSurfaces, backend, floodFuzz, floodRejectFrac, samThreshold, samMaskIdx,
  ]);

  // Live re-refine when a backend tunable changes — re-runs the ACTIVE
  // layer's clicks so slider feedback updates the selection.
  useEffect(() => {
    const layer = activeLayerObj();
    if (!layer || layer.clicks.length === 0 || !srcDims) return;
    const i = activeLayerRef.current;
    const t = setTimeout(() => { void runRefine(i, layersRef.current[i]?.clicks ?? []); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, floodFuzz, floodRejectFrac, samThreshold, samMaskIdx]);

  // ── Undo / redo ─────────────────────────────────────────────────────
  const undo = () => {
    const prev = history.undo(buildCurrentSession);
    if (!prev) { setStatus('nothing to undo'); return; }
    autosaveSuppressedRef.current = true;
    applyDoc(prev, { quiet: true });
    setStatus('undo');
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
  };
  const redo = () => {
    const next = history.redo(buildCurrentSession);
    if (!next) { setStatus('nothing to redo'); return; }
    autosaveSuppressedRef.current = true;
    applyDoc(next, { quiet: true });
    setStatus('redo');
    setTimeout(() => { autosaveSuppressedRef.current = false; }, 0);
  };

  // ── Clipboard ───────────────────────────────────────────────────────
  const copyLayer = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) { setStatus('select a layer to copy'); return; }
    const src = cur[i];
    setClipboard({
      baseBytes: paintableOps(src.baseId).readback(),
      brushBytes: paintableOps(src.brushId).readback(),
      config: cloneConfig(src.config),
      clicks: src.clicks.map((c) => ({ ...c })),
      sourceName: src.name,
    });
    setStatus(`copied · ${src.name}`);
  };
  const pasteLayer = () => {
    if (!clipboard) { setStatus('clipboard empty'); return; }
    history.commit(buildCurrentSession);
    const layer = makeLayer(layersRef.current.length, `${clipboard.sourceName} (pasted)`);
    layer.config = cloneConfig(clipboard.config);
    layer.config.muted = false;
    layer.clicks = clipboard.clicks.map((c) => ({ ...c }));
    if (clipboard.baseBytes) pendingUploadsRef.current.set(layer.baseId, clipboard.baseBytes);
    if (clipboard.brushBytes) pendingUploadsRef.current.set(layer.brushId, clipboard.brushBytes);
    const next = layersRef.current.concat([layer]);
    setLayers(next);
    setActiveLayer(next.length - 1);
    markMaskDirty();
    setStatus(`pasted · ${clipboard.sourceName}`);
  };
  const cutLayer = (i: number) => { copyLayer(i); deleteLayer(i); };

  // ── Keyboard ────────────────────────────────────────────────────────
  useIFTTT('key:ctrl+z', () => undo());
  useIFTTT('key:ctrl+y', () => redo());
  useIFTTT('key:ctrl+shift+z', () => redo());
  useIFTTT('key:ctrl+c', () => { const i = activeLayerRef.current; if (i >= 0) copyLayer(i); });
  useIFTTT('key:ctrl+v', () => pasteLayer());
  useIFTTT('key:ctrl+x', () => { const i = activeLayerRef.current; if (i >= 0) cutLayer(i); });
  useIFTTT('key:b', () => setTool('brush'));
  useIFTTT('key:h', () => setTool('hand'));
  useIFTTT('key:s', () => setTool('smart'));
  useIFTTT('key:l', () => setTool('lasso'));
  useIFTTT('key:f', () => setTool('refine'));
  useIFTTT('key:e', () => setMode('erase'));
  useIFTTT('key:r', () => setMode('restore'));
  useIFTTT('key:enter', () => commitLasso());
  useIFTTT('key:escape', () => clearLasso());
  useIFTTT('key:[', () => { const i = BRUSH_SIZES.indexOf(brushPx); if (i > 0) setBrushPx(BRUSH_SIZES[i - 1]); });
  useIFTTT('key:]', () => { const i = BRUSH_SIZES.indexOf(brushPx); if (i < BRUSH_SIZES.length - 1) setBrushPx(BRUSH_SIZES[i + 1]); });

  const activeClicks = (activeLayer >= 0 && activeLayer < layers.length) ? layers[activeLayer].clicks : [];

  return {
    srcPath, stem, srcDims, isBlank,
    status, busy, savedPath,
    tool, mode, brushPx, setTool, setMode, setBrushPx,
    lassoPoints, addLassoPoint, commitLasso, clearLasso,
    layers, activeLayer, setActiveLayer, maskVersion, hasMaskEdits,
    beginStroke, paintAtSource, endStroke, clearMask, invertMask, createBlankSurface, setCanvasSize,
    backendName: backendRef.current.name,
    backend, setBackend, samAvailable,
    floodFuzz, setFloodFuzz, floodRejectFrac, setFloodRejectFrac,
    samThreshold, setSamThreshold, samMaskIdx, setSamMaskIdx,
    clicks: activeClicks, addClick, clearClicks, smartBusy,
    addLayer, deleteLayer, duplicateLayer, moveLayer, mergeLayer, toggleLayerMute,
    setLayerName, setLayerGroup, setLayerMode, setLayerBlend,
    setLayerColor, setLayerHueOffset, setLayerPhaseOffset, setLayerDim,
    effectMode, setEffectMode, effectColors, effectHueOffset, effectPhaseOffset, effectDim,
    setEffectColor, setEffectHueOffset, setEffectPhaseOffset, setEffectDim,
    customSurfaces, addCustomSurface,
    pickFile, saveCutout, saveIcons, saveSqi, importSqi,
    lastSavedAt, restoredFrom,
    canUndo: history.canUndo, canRedo: history.canRedo, undo, redo,
    clipboard, copyLayer, pasteLayer, cutLayer,
  };

  // Hoisted — uses ingest defined above.
  async function pickFile() {
    setStatus('opening file picker…');
    const r = await execAsync(
      "zenity --file-selection --title='Pick an image' " +
      "--file-filter='Images | *.png *.jpg *.jpeg *.webp *.gif *.bmp *.tif *.tiff' " +
      "--file-filter='All files | *'"
    );
    const path = (r.stdout || '').trim();
    if (!path) { setStatus(`no file selected (exit ${r.code})`); return; }
    void ingest(path);
  }
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
