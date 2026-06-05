// editors/paint/usePaintEditor.ts — the shared painter's live state: the
// headless core (strokes/layers/history/surfaces) wired to GPU paintables,
// the smart-select backend, the session-history layer, and the keyboard.
//
// THE perf invariants (the cutout painter's, kept):
//   - dabs write straight to the GPU override texture (paintableOps) and
//     bump a throttled version counter — never a per-dab setState;
//   - RLE/readback runs lazily at discrete commit points (history snapshots,
//     document builds), never per frame.
//
// Session integration (V20): every completed interaction lands ONE labeled
// edit-commit on whatever the hosting editor passed as `session` — a
// RouteSession satisfies the type structurally (note-grade); a route whose
// channel event-sources paint content passes { note: (label) => ses.commit(
// myEvent(), label) } to upgrade to commit-grade without the painter knowing
// the channel's event type.
//
// Behavior reference: cart/cutout/state.ts (read, never imported).

import { useEffect, useMemo, useRef, useState } from 'react';
import { paintableOps } from '@reactjit/runtime/hooks/usePaintable';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { PAINT_TUNING } from './tuning';
import {
  createStrokeEngine, lassoIsDoubleClick, lassoShouldClose,
  type GraySource,
} from './strokes';
import {
  activeAfterDelete, buildPaintDocument, cloneLayerConfig, effectiveMask,
  inflatePaintDocument, invertIntoBase, makeLayer, mergeIntoBase,
  moveLayerInStack, overrideBandValue, paintableIdsFor, scaleMask, unionMasks,
  type PaintClipping, type PaintDocument, type PaintLayer,
  type PaintLayerBytes, type PaintLayerConfig, type PaintLookDefaults,
  type PaintMode, type PaintTool,
} from './layers';
import { createPaintHistory } from './history';
import { addCustomSurface as addCustomSurfaceOp, SLOT_DEFAULTS, type CustomSurface, type PaintBlendMode, type SurfaceId } from './surfaces';
import type { BackendOpts, ClickLabel, ClickPoint, SelectionBackend } from './backends/types';

export type Dims = { w: number; h: number };

/** What the painter needs from the session layer — one labeled edit-commit
 *  per interaction. editors/sessions.ts RouteSession satisfies it. */
export type PaintSession = { note: (label: string) => unknown };

export type PaintEditorOptions = {
  /** paintable-id namespace so multiple embedded painters coexist */
  idPrefix: string;
  /** target resolution (source image dims, or the blank canvas size) */
  dims: Dims;
  /** image under the paint (display + smart-select source); null = blank */
  srcPath?: string | null;
  /** grayscale of the source for edge snapping/edge-aware refine — the host
   *  loads it however it wants (the painter takes data, not ImageMagick) */
  gray?: GraySource | null;
  /** smart-select backend; the smart tool surfaces only when provided AND a
   *  source path exists */
  backend?: SelectionBackend | null;
  /** the hosting route's session — one labeled edit-commit per interaction */
  session?: PaintSession | null;
  /** mirror painting across the vertical center (the character-route
   *  capability, off by default) */
  mirror?: boolean;
  /** wire the cutout keyboard map (ctrl+z/y, c/x/v, b/h/s/l/f, e/r, [/],
   *  Enter/Esc). Default true — pass false when the host owns the keys. */
  hotkeys?: boolean;
  /** restore a previously built document on mount */
  initial?: PaintDocument | null;
};

type LassoPoint = { x: number; y: number };

export interface PaintEditorState {
  // identity / target
  idPrefix: string;
  dims: Dims;
  srcPath: string | null;

  // status
  status: string;
  smartBusy: boolean;

  // tool config
  tool: PaintTool;
  mode: PaintMode;
  brushPx: number;
  mirror: boolean;
  setTool: (t: PaintTool) => void;
  setMode: (m: PaintMode) => void;
  setBrushPx: (n: number) => void;
  setMirror: (on: boolean) => void;
  stepBrush: (dir: -1 | 1) => void;

  // strokes (viewport input → here)
  beginStroke: () => void;
  paintAtSource: (sx: number, sy: number, pressure?: number) => void;
  endStroke: () => void;

  // lasso
  lassoPoints: LassoPoint[];
  addLassoPoint: (sx: number, sy: number, at?: number) => void;
  commitLasso: () => void;
  clearLasso: () => void;

  // smart select
  smartAvailable: boolean;
  clicks: ClickPoint[];
  addClick: (sx: number, sy: number, label: ClickLabel) => Promise<void>;
  clearClicks: () => void;
  backendName: string;
  floodFuzz: number;
  setFloodFuzz: (n: number) => void;
  floodRejectFrac: number;
  setFloodRejectFrac: (n: number) => void;
  samThreshold: number;
  setSamThreshold: (n: number) => void;
  samMaskIdx: 0 | 1 | 2;
  setSamMaskIdx: (n: 0 | 1 | 2) => void;

  // layer stack
  layers: PaintLayer[];
  activeLayer: number;
  setActiveLayer: (i: number) => void;
  maskVersion: number;
  baseIdOf: (layer: PaintLayer) => string;
  brushIdOf: (layer: PaintLayer) => string;
  addLayer: () => number;
  deleteLayer: (i: number) => void;
  duplicateLayer: (i: number) => void;
  moveLayer: (i: number, dir: -1 | 1) => void;
  mergeLayer: (i: number) => void;
  toggleLayerMute: (i: number) => void;
  setLayerName: (i: number, name: string) => void;
  setLayerGroup: (i: number, groupName: string) => void;
  clearMask: () => void;
  invertMask: () => void;

  // look (i < 0 targets the defaults that seed new layers)
  defaults: PaintLookDefaults;
  setLayerMode: (i: number, m: SurfaceId) => void;
  setLayerBlend: (i: number, blend: PaintBlendMode) => void;
  setLayerColor: (i: number, slotIdx: number, hex: string) => void;
  setLayerHueOffset: (i: number, value: number) => void;
  setLayerPhaseOffset: (i: number, value: number) => void;
  setLayerDim: (i: number, value: number) => void;
  customSurfaces: CustomSurface[];
  addCustomSurface: (label: string, shader: string) => string;

  // clipboard
  clipboard: PaintClipping | null;
  copyLayer: (i: number) => void;
  pasteLayer: () => void;
  cutLayer: (i: number) => void;

  // history
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // persistence seam — the host owns WHERE documents go
  /** readback + RLE-encode the live state (discrete commit points only) */
  buildDocument: () => PaintDocument | null;
  /** restore a document (queues texture uploads for mounted paintables) */
  applyDocument: (doc: PaintDocument) => void;
  /** union of every unmuted layer's effective mask (1 = selected/removed) */
  composeExportMask: () => Uint8Array | null;
  /** bumps on every meaningful edit — the host's autosave trigger */
  documentVersion: number;
}

export function usePaintEditor(opts: PaintEditorOptions): PaintEditorState {
  const { idPrefix } = opts;
  const dims = opts.dims;
  const dimsRef = useRef(dims); dimsRef.current = dims;
  const srcPath = opts.srcPath ?? null;

  const [status, setStatus] = useState('pick a tool and start painting');
  const [tool, setTool] = useState<PaintTool>('brush');
  const [mode, setMode] = useState<PaintMode>('erase');
  const [brushPx, setBrushPx] = useState(PAINT_TUNING.brushDefaultPx);
  const [mirror, setMirror] = useState(!!opts.mirror);
  const [lassoPoints, setLassoPoints] = useState<LassoPoint[]>([]);
  const [maskVersion, setMaskVersion] = useState(0);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [smartBusy, setSmartBusy] = useState(false);

  const toolRef = useRef(tool); toolRef.current = tool;
  const modeRef = useRef(mode); modeRef.current = mode;
  const brushPxRef = useRef(brushPx); brushPxRef.current = brushPx;
  const mirrorRef = useRef(mirror); mirrorRef.current = mirror;
  const lassoRef = useRef(lassoPoints); lassoRef.current = lassoPoints;

  // ── layer stack ─────────────────────────────────────────────────────────────
  const [layers, setLayersState] = useState<PaintLayer[]>([]);
  const layersRef = useRef<PaintLayer[]>([]);
  const setLayers = (next: PaintLayer[]) => { layersRef.current = next; setLayersState(next); };
  const [activeLayer, setActiveLayerState] = useState(-1);
  const activeLayerRef = useRef(-1);
  const setActiveLayer = (i: number) => {
    const clamped = i < 0 ? -1 : Math.min(i, layersRef.current.length - 1);
    activeLayerRef.current = clamped;
    setActiveLayerState(clamped);
  };

  const ids = (layer: PaintLayer) => paintableIdsFor(idPrefix, layer.id);
  const baseIdOf = (layer: PaintLayer) => ids(layer).baseId;
  const brushIdOf = (layer: PaintLayer) => ids(layer).brushId;

  // Pending CPU→GPU uploads, keyed by paintable id (bytes READY to upload —
  // already scaled for base channels). Filled by restore / undo / duplicate /
  // paste, flushed once the matching <Paintable> mounts.
  const pendingUploadsRef = useRef<Map<string, Uint8Array>>(new Map());
  useEffect(() => {
    if (pendingUploadsRef.current.size === 0) return;
    const live = new Set<string>();
    for (const l of layersRef.current) { const p = ids(l); live.add(p.baseId); live.add(p.brushId); }
    for (const [id, bytes] of pendingUploadsRef.current) {
      if (live.has(id)) paintableOps(id).upload(bytes);
    }
    pendingUploadsRef.current.clear();
    setMaskVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  // ── look defaults (seed new layers) ─────────────────────────────────────────
  const [defaults, setDefaults] = useState<PaintLookDefaults>({
    mode: PAINT_TUNING.layerLook.defaultSurface,
    colors: SLOT_DEFAULTS.slice(),
    hueOffset: 0,
    phaseOffset: 0,
    dim: PAINT_TUNING.layerLook.defaultDim,
  });
  const defaultsRef = useRef(defaults); defaultsRef.current = defaults;
  const [customSurfaces, setCustomSurfaces] = useState<CustomSurface[]>([]);
  const customSurfacesRef = useRef(customSurfaces); customSurfacesRef.current = customSurfaces;

  const [clipboard, setClipboard] = useState<PaintClipping | null>(null);

  // ── smart backend ───────────────────────────────────────────────────────────
  const backend = opts.backend ?? null;
  const backendRef = useRef<SelectionBackend | null>(backend); backendRef.current = backend;
  const smartAvailable = !!backend && !!srcPath;
  const [floodFuzz, setFloodFuzzState] = useState(PAINT_TUNING.backends.floodFuzz);
  const [floodRejectFrac, setFloodRejectFracState] = useState(PAINT_TUNING.backends.floodRejectFrac);
  const [samThreshold, setSamThresholdState] = useState(PAINT_TUNING.backends.samThreshold);
  const [samMaskIdx, setSamMaskIdxState] = useState<0 | 1 | 2>(PAINT_TUNING.backends.samMaskIdx);
  const tunablesRef = useRef<BackendOpts>({});
  tunablesRef.current = {
    fuzzPercent: floodFuzz,
    rejectDiskFrac: floodRejectFrac,
    samThreshold,
    samMaskIdx,
  };
  const smartTokenRef = useRef(0);

  useEffect(() => {
    if (!backend || !srcPath) return;
    void backend.open(srcPath, dimsRef.current);
    return () => backend.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, srcPath, dims.w, dims.h]);

  // ── history ─────────────────────────────────────────────────────────────────
  const history = useMemo(() => createPaintHistory<PaintDocument>(), []);
  const [historyTick, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((v) => v + 1);

  // ── interaction plumbing ────────────────────────────────────────────────────
  const session = opts.session ?? null;
  const sessionRef = useRef(session); sessionRef.current = session;
  const noteEdit = (label: string) => { sessionRef.current?.note(label); };

  const bump = () => setMaskVersion((v) => v + 1);
  const lastBumpRef = useRef(0);
  const bumpThrottled = () => {
    const now = Date.now();
    if (now - lastBumpRef.current < PAINT_TUNING.maskBumpThrottleMs) return;
    lastBumpRef.current = now;
    bump();
  };
  const touchDocument = () => setDocumentVersion((v) => v + 1);

  const activeLayerObj = (): PaintLayer | null => {
    const i = activeLayerRef.current;
    const arr = layersRef.current;
    return i >= 0 && i < arr.length ? arr[i] : null;
  };

  const ensureActiveLayer = (): PaintLayer => {
    let layer = activeLayerObj();
    if (layer) return layer;
    layer = makeLayer(defaultsRef.current, layersRef.current.length);
    const next = layersRef.current.concat([layer]);
    setLayers(next);
    setActiveLayer(next.length - 1);
    return layer;
  };

  const patchLayer = (i: number, patch: Partial<PaintLayer>) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...cur[i], ...patch };
    setLayers(next);
  };
  const patchLayerConfig = (i: number, patch: Partial<PaintLayerConfig>) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    const next = cur.slice();
    next[i] = { ...cur[i], config: { ...cur[i].config, ...patch } };
    setLayers(next);
  };

  /** Compose a layer's effective binary mask by reading its textures back —
   *  discrete commit points only (export / snapshot / merge / invert). */
  const readEffective = (layer: PaintLayer, n: number): Uint8Array => {
    const p = ids(layer);
    const base = paintableOps(p.baseId).readback();
    const brush = paintableOps(p.brushId).readback();
    return effectiveMask(base, brush, n);
  };

  // ── document build / apply (the persistence seam) ───────────────────────────
  const snapshotLayers = (): PaintLayerBytes[] =>
    layersRef.current.map((l) => {
      const p = ids(l);
      return {
        ...l,
        config: cloneLayerConfig(l.config),
        clicks: l.clicks.map((c) => ({ ...c })),
        base: paintableOps(p.baseId).readback(),
        brush: paintableOps(p.brushId).readback(),
      };
    });

  const buildDocument = (): PaintDocument | null => {
    const d = dimsRef.current;
    if (!d || d.w <= 0 || d.h <= 0) return null;
    return buildPaintDocument({
      dims: d,
      layers: snapshotLayers(),
      activeLayer: activeLayerRef.current,
      tool: toolRef.current,
      mode: modeRef.current,
      brushPx: brushPxRef.current,
      defaults: defaultsRef.current,
      customSurfaces: customSurfacesRef.current,
    });
  };

  const applyDocument = (doc: PaintDocument) => {
    const inflated = inflatePaintDocument(doc);
    pendingUploadsRef.current.clear();
    const restored: PaintLayer[] = inflated.map((l) => {
      const p = paintableIdsFor(idPrefix, l.id);
      if (l.base && l.base.length > 0) pendingUploadsRef.current.set(p.baseId, scaleMask(l.base));
      if (l.brush && l.brush.length > 0) pendingUploadsRef.current.set(p.brushId, l.brush);
      return { id: l.id, name: l.name, groupName: l.groupName, config: l.config, clicks: l.clicks };
    });
    setLayers(restored);
    setActiveLayer(typeof doc.activeLayer === 'number' ? doc.activeLayer : (restored.length > 0 ? 0 : -1));
    setTool(doc.tool ?? 'brush');
    setMode(doc.mode ?? 'erase');
    setBrushPx(doc.brushPx ?? PAINT_TUNING.brushDefaultPx);
    if (doc.defaults) setDefaults({ ...doc.defaults, colors: doc.defaults.colors.slice() });
    setCustomSurfaces((doc.customSurfaces ?? []).map((cs) => ({ ...cs })));
    setLassoPoints([]);
    bump();
    touchDocument();
  };

  const commit = () => { history.commit(buildDocument); bumpHistory(); };
  const commitCoalesced = () => { history.commitCoalesced(buildDocument); bumpHistory(); };

  // restore-on-mount + first layer
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (opts.initial) {
      applyDocument(opts.initial);
      setStatus('restored document');
      return;
    }
    const first = makeLayer(defaultsRef.current, 0);
    setLayers([first]);
    setActiveLayer(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dims change = a different paint target → fresh stack (the cutout
  // setCanvasSize rule), with history cleared.
  const dimsKeyRef = useRef(`${dims.w}x${dims.h}`);
  useEffect(() => {
    const key = `${dims.w}x${dims.h}`;
    if (dimsKeyRef.current === key) return;
    dimsKeyRef.current = key;
    if (!bootedRef.current) return;
    history.clear();
    bumpHistory();
    const first = makeLayer(defaultsRef.current, 0);
    setLayers([first]);
    setActiveLayer(0);
    setLassoPoints([]);
    bump();
    touchDocument();
    setStatus(`canvas → ${dims.w}×${dims.h}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.w, dims.h]);

  // ── strokes ─────────────────────────────────────────────────────────────────
  const engineRef = useRef<ReturnType<typeof createStrokeEngine> | null>(null);
  const dabCountRef = useRef(0);

  const beginStroke = () => {
    commit();
    ensureActiveLayer();
    dabCountRef.current = 0;
    engineRef.current = createStrokeEngine({
      brushPx: brushPxRef.current,
      mirrorAxisX: mirrorRef.current ? dimsRef.current.w / 2 : null,
      snap: (toolRef.current === 'brush' || toolRef.current === 'refine') ? (opts.gray ?? null) : null,
    });
    engineRef.current.begin();
    lastBumpRef.current = 0;
  };

  const paintAtSource = (sx: number, sy: number, pressure?: number) => {
    const engine = engineRef.current;
    if (!engine || !engine.drawing()) return;
    const layer = activeLayerObj();
    if (!layer) return;
    const dabs = engine.move(sx, sy, pressure);
    if (dabs.length === 0) return;
    // Brush writes the OVERRIDE channel: erase → force-remove, restore →
    // force-keep. The smart base underneath stays — re-refining never wipes
    // these strokes.
    const value = overrideBandValue(modeRef.current);
    const op = paintableOps(brushIdOf(layer));
    for (const d of dabs) op.circle(d.x, d.y, d.radius, value);
    dabCountRef.current += dabs.length;
    bumpThrottled();
  };

  const endStroke = () => {
    const engine = engineRef.current;
    if (!engine || !engine.drawing()) return;
    engine.end();
    bump();
    if (dabCountRef.current > 0) {
      touchDocument();
      const layer = activeLayerObj();
      noteEdit(`${toolRef.current} stroke · ${modeRef.current} · ${brushPxRef.current}px · ${layer?.name ?? 'layer'}`);
    }
  };

  // ── whole-layer ops ─────────────────────────────────────────────────────────
  const clearMask = () => {
    const layer = activeLayerObj();
    if (!layer) return;
    commit();
    const p = ids(layer);
    paintableOps(p.baseId).clear(0);
    paintableOps(p.brushId).clear(0);
    patchLayer(activeLayerRef.current, { clicks: [] });
    bump();
    touchDocument();
    setStatus(`cleared ${layer.name}`);
    noteEdit(`clear · ${layer.name}`);
  };

  const invertMask = () => {
    const layer = activeLayerObj();
    const d = dimsRef.current;
    if (!d || !layer) return;
    commit();
    // Bake the effective mask, invert into base, drop overrides + clicks —
    // invert is a whole-layer reset of intent.
    const n = d.w * d.h;
    const inv = invertIntoBase(readEffective(layer, n), n);
    const p = ids(layer);
    paintableOps(p.baseId).upload(inv);
    paintableOps(p.brushId).clear(0);
    patchLayer(activeLayerRef.current, { clicks: [] });
    bump();
    touchDocument();
    setStatus(`inverted ${layer.name}`);
    noteEdit(`invert · ${layer.name}`);
  };

  // ── lasso ───────────────────────────────────────────────────────────────────
  const lastLassoClickRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const commitLasso = () => {
    const d = dimsRef.current;
    const pts = lassoRef.current;
    if (!d || pts.length < PAINT_TUNING.lasso.minVerts) return;
    const layer = ensureActiveLayer();
    commit();
    const verts = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      verts[i * 2] = pts[i].x;
      verts[i * 2 + 1] = pts[i].y;
    }
    paintableOps(brushIdOf(layer)).polygon(verts, overrideBandValue(modeRef.current));
    setLassoPoints([]);
    bump();
    touchDocument();
    setStatus(`lasso ${modeRef.current === 'erase' ? 'removed' : 'restored'} · ${pts.length} points`);
    noteEdit(`lasso · ${modeRef.current} · ${pts.length} pts · ${layer.name}`);
  };

  const addLassoPoint = (sx: number, sy: number, at = Date.now()) => {
    const d = dimsRef.current;
    const pts = lassoRef.current;
    const doubleClick = lassoIsDoubleClick(lastLassoClickRef.current, sx, sy, at);
    lastLassoClickRef.current = { x: sx, y: sy, at };
    if (doubleClick || (d && lassoShouldClose(pts, sx, sy, d.w, d.h))) {
      commitLasso();
      return;
    }
    setLassoPoints((cur) => [...cur, { x: sx, y: sy }]);
    setStatus(`lasso · ${pts.length + 1} point${pts.length === 0 ? '' : 's'}`);
  };

  const clearLasso = () => { setLassoPoints([]); setStatus('lasso cleared'); };

  // ── smart select ────────────────────────────────────────────────────────────
  const runRefine = async (layerIndex: number, nextClicks: ClickPoint[]) => {
    const b = backendRef.current;
    const d = dimsRef.current;
    if (!b || !d) return;
    const layer = layersRef.current[layerIndex];
    if (!layer) return;
    const token = ++smartTokenRef.current;
    setSmartBusy(true);
    setStatus(nextClicks.length === 0
      ? 'cleared selection'
      : `smart-selecting · ${nextClicks.length} click${nextClicks.length === 1 ? '' : 's'}…`);
    const result = await b.refine(nextClicks, tunablesRef.current);
    if (smartTokenRef.current !== token) return;
    setSmartBusy(false);
    if (!result) { setStatus('smart-select failed'); return; }
    // Replace ONLY this layer's smart base; brush overrides + other layers
    // untouched. Scale 0/1 → 0/255 so the sampler reads 1.0.
    paintableOps(baseIdOf(layer)).upload(scaleMask(result.mask));
    bump();
    touchDocument();
    setStatus(`smart-select · ${nextClicks.length} click${nextClicks.length === 1 ? '' : 's'} · ${b.name}`);
  };

  const addClick = async (sx: number, sy: number, label: ClickLabel) => {
    if (!smartAvailable) return;
    commit();
    const layer = ensureActiveLayer();
    const i = layersRef.current.indexOf(layer);
    const next = [...layer.clicks, { x: sx, y: sy, label }];
    patchLayer(i, { clicks: next });
    noteEdit(`smart ${label} · ${layer.name}`);
    await runRefine(i, next);
  };

  const clearClicks = () => {
    const layer = activeLayerObj();
    if (!layer) return;
    commit();
    patchLayer(activeLayerRef.current, { clicks: [] });
    paintableOps(baseIdOf(layer)).clear(0);
    bump();
    touchDocument();
    setStatus('cleared selection');
    noteEdit(`clear selection · ${layer.name}`);
  };

  // tunable change → debounced active-layer re-refine (live slider feedback)
  useEffect(() => {
    const layer = activeLayerObj();
    if (!layer || layer.clicks.length === 0 || !smartAvailable) return;
    const i = activeLayerRef.current;
    const t = setTimeout(() => {
      void runRefine(i, layersRef.current[i]?.clicks ?? []);
    }, PAINT_TUNING.backends.retuneDebounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floodFuzz, floodRejectFrac, samThreshold, samMaskIdx]);

  // ── layer stack ops ─────────────────────────────────────────────────────────
  const addLayer = () => {
    commit();
    const ordinal = layersRef.current.length;
    const layer = makeLayer(defaultsRef.current, ordinal);
    const next = layersRef.current.concat([layer]);
    setLayers(next);
    setActiveLayer(next.length - 1);
    touchDocument();
    setStatus(`added ${layer.name}`);
    noteEdit(`add layer · ${layer.name}`);
    return next.length - 1;
  };

  const deleteLayer = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    commit();
    const removed = cur[i];
    const p = ids(removed);
    const next = cur.slice(0, i).concat(cur.slice(i + 1));
    setLayers(next);
    paintableOps(p.baseId).clear(0);
    paintableOps(p.brushId).clear(0);
    setActiveLayer(activeAfterDelete(activeLayerRef.current, i, next.length));
    bump();
    touchDocument();
    setStatus(`deleted ${removed.name}`);
    noteEdit(`delete layer · ${removed.name}`);
  };

  const duplicateLayer = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    commit();
    const src = cur[i];
    const sp = ids(src);
    const base = paintableOps(sp.baseId).readback();
    const brush = paintableOps(sp.brushId).readback();
    const dup = makeLayer(defaultsRef.current, cur.length, `${src.name} copy`);
    dup.config = cloneLayerConfig(src.config);
    dup.clicks = src.clicks.map((c) => ({ ...c }));
    const dp = ids(dup);
    if (base) pendingUploadsRef.current.set(dp.baseId, base);
    if (brush) pendingUploadsRef.current.set(dp.brushId, brush);
    const next = cur.slice();
    next.splice(i + 1, 0, dup);
    setLayers(next);
    setActiveLayer(i + 1);
    bump();
    touchDocument();
    setStatus(`duplicated ${src.name}`);
    noteEdit(`duplicate layer · ${src.name}`);
  };

  const moveLayer = (i: number, dir: -1 | 1) => {
    const cur = layersRef.current;
    const next = moveLayerInStack(cur, i, dir);
    if (next === cur) return;
    commit();
    setLayers(next);
    const j = i + dir;
    if (activeLayerRef.current === i) setActiveLayer(j);
    else if (activeLayerRef.current === j) setActiveLayer(i);
    bump();
    touchDocument();
    setStatus('moved layer');
    noteEdit('move layer');
  };

  const mergeLayer = (i: number) => {
    const cur = layersRef.current;
    const d = dimsRef.current;
    if (i <= 0 || i >= cur.length || !d) { setStatus('nothing below to merge into'); return; }
    commit();
    const above = cur[i];
    const below = cur[i - 1];
    const n = d.w * d.h;
    // Bake both effectives, union into below's base, drop below's brush +
    // clicks — the merged result is its baked base.
    const merged = mergeIntoBase(readEffective(above, n), readEffective(below, n), n);
    const ap = ids(above);
    const bp = ids(below);
    paintableOps(bp.baseId).upload(merged);
    paintableOps(bp.brushId).clear(0);
    paintableOps(ap.baseId).clear(0);
    paintableOps(ap.brushId).clear(0);
    const next = cur.slice(0, i).concat(cur.slice(i + 1));
    next[i - 1] = { ...below, clicks: [] };
    setLayers(next);
    setActiveLayer(Math.min(i - 1, next.length - 1));
    bump();
    touchDocument();
    setStatus(`merged ${above.name} down`);
    noteEdit(`merge down · ${above.name} → ${below.name}`);
  };

  const toggleLayerMute = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) return;
    commit();
    patchLayerConfig(i, { muted: !cur[i].config.muted });
    bump();
    touchDocument();
    noteEdit(`${cur[i].config.muted ? 'show' : 'mute'} layer · ${cur[i].name}`);
  };
  const setLayerName = (i: number, name: string) => {
    const clean = name.trim() || `Layer ${i + 1}`;
    commit();
    patchLayer(i, { name: clean });
    touchDocument();
  };
  const setLayerGroup = (i: number, groupName: string) => {
    commit();
    patchLayer(i, { groupName: groupName.trim() || null });
    touchDocument();
  };

  // ── look setters (i < 0 targets the defaults) ───────────────────────────────
  const setLayerMode = (i: number, m: SurfaceId) => {
    commitCoalesced();
    if (i < 0) { setDefaults((dft) => ({ ...dft, mode: m })); return; }
    patchLayerConfig(i, { mode: m });
    bump();
    touchDocument();
  };
  const setLayerBlend = (i: number, blend: PaintBlendMode) => {
    if (i < 0) return;
    commitCoalesced();
    patchLayerConfig(i, { blend });
    bump();
    touchDocument();
  };
  const setLayerColor = (i: number, slotIdx: number, hex: string) => {
    if (slotIdx < 0 || slotIdx >= SLOT_DEFAULTS.length) return;
    commitCoalesced();
    if (i < 0) {
      setDefaults((dft) => {
        const colors = dft.colors.slice();
        colors[slotIdx] = hex;
        return { ...dft, colors };
      });
      return;
    }
    const cur = layersRef.current;
    if (i >= cur.length) return;
    const colors = (cur[i].config.colors ?? SLOT_DEFAULTS).slice();
    colors[slotIdx] = hex;
    patchLayerConfig(i, { colors });
    bump();
    touchDocument();
  };
  const setLayerHueOffset = (i: number, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    commitCoalesced();
    if (i < 0) { setDefaults((dft) => ({ ...dft, hueOffset: v })); return; }
    patchLayerConfig(i, { hueOffset: v });
    bump();
    touchDocument();
  };
  const setLayerPhaseOffset = (i: number, value: number) => {
    commitCoalesced();
    if (i < 0) { setDefaults((dft) => ({ ...dft, phaseOffset: value })); return; }
    patchLayerConfig(i, { phaseOffset: value });
    bump();
    touchDocument();
  };
  const setLayerDim = (i: number, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    commitCoalesced();
    if (i < 0) { setDefaults((dft) => ({ ...dft, dim: v })); return; }
    patchLayerConfig(i, { dim: v });
    bump();
    touchDocument();
  };

  const addCustomSurface = (label: string, shader: string): string => {
    const grown = addCustomSurfaceOp(customSurfacesRef.current, label, shader);
    setCustomSurfaces(grown.customs);
    touchDocument();
    noteEdit(`add surface · ${grown.customs[grown.customs.length - 1].label}`);
    return grown.id;
  };

  // ── clipboard ───────────────────────────────────────────────────────────────
  const copyLayer = (i: number) => {
    const cur = layersRef.current;
    if (i < 0 || i >= cur.length) { setStatus('select a layer to copy'); return; }
    const src = cur[i];
    const p = ids(src);
    setClipboard({
      baseBytes: paintableOps(p.baseId).readback(),
      brushBytes: paintableOps(p.brushId).readback(),
      config: cloneLayerConfig(src.config),
      clicks: src.clicks.map((c) => ({ ...c })),
      sourceName: src.name,
    });
    setStatus(`copied · ${src.name}`);
  };
  const pasteLayer = () => {
    const clip = clipboard;
    if (!clip) { setStatus('clipboard empty'); return; }
    commit();
    const layer = makeLayer(defaultsRef.current, layersRef.current.length, `${clip.sourceName} (pasted)`);
    layer.config = cloneLayerConfig(clip.config);
    layer.config.muted = false;
    layer.clicks = clip.clicks.map((c) => ({ ...c }));
    const p = ids(layer);
    if (clip.baseBytes) pendingUploadsRef.current.set(p.baseId, clip.baseBytes);
    if (clip.brushBytes) pendingUploadsRef.current.set(p.brushId, clip.brushBytes);
    const next = layersRef.current.concat([layer]);
    setLayers(next);
    setActiveLayer(next.length - 1);
    touchDocument();
    setStatus(`pasted · ${clip.sourceName}`);
    noteEdit(`paste layer · ${clip.sourceName}`);
  };
  const cutLayer = (i: number) => { copyLayer(i); deleteLayer(i); };

  // ── undo / redo ─────────────────────────────────────────────────────────────
  const undo = () => {
    const prev = history.undo(buildDocument);
    bumpHistory();
    if (!prev) { setStatus('nothing to undo'); return; }
    applyDocument(prev);
    setStatus('undo');
  };
  const redo = () => {
    const next = history.redo(buildDocument);
    bumpHistory();
    if (!next) { setStatus('nothing to redo'); return; }
    applyDocument(next);
    setStatus('redo');
  };

  // ── export compose ──────────────────────────────────────────────────────────
  const composeExportMask = (): Uint8Array | null => {
    const d = dimsRef.current;
    if (!d) return null;
    const n = d.w * d.h;
    const effectives = layersRef.current
      .filter((l) => !l.config.muted)
      .map((l) => readEffective(l, n));
    if (effectives.length === 0) return new Uint8Array(n);
    return unionMasks(effectives, n);
  };

  // ── keyboard (the cutout map; gate inside the callback — hook order) ────────
  const hotkeysOn = opts.hotkeys !== false;
  const key = (cb: () => void) => () => { if (hotkeysOn) cb(); };
  useIFTTT('key:ctrl+z', key(undo));
  useIFTTT('key:ctrl+y', key(redo));
  useIFTTT('key:ctrl+shift+z', key(redo));
  useIFTTT('key:ctrl+c', key(() => { const i = activeLayerRef.current; if (i >= 0) copyLayer(i); }));
  useIFTTT('key:ctrl+v', key(pasteLayer));
  useIFTTT('key:ctrl+x', key(() => { const i = activeLayerRef.current; if (i >= 0) cutLayer(i); }));
  useIFTTT('key:b', key(() => setTool('brush')));
  useIFTTT('key:h', key(() => setTool('hand')));
  useIFTTT('key:s', key(() => { if (smartAvailable) setTool('smart'); }));
  useIFTTT('key:l', key(() => setTool('lasso')));
  useIFTTT('key:f', key(() => setTool('refine')));
  useIFTTT('key:e', key(() => setMode('erase')));
  useIFTTT('key:r', key(() => setMode('restore')));
  useIFTTT('key:enter', key(() => { if (toolRef.current === 'lasso') commitLasso(); }));
  useIFTTT('key:escape', key(() => { if (toolRef.current === 'lasso') clearLasso(); }));
  useIFTTT('key:bracketleft', key(() => stepBrush(-1)));
  useIFTTT('key:bracketright', key(() => stepBrush(1)));

  const stepBrush = (dir: -1 | 1) => {
    const sizes = PAINT_TUNING.brushSizes;
    const cur = brushPxRef.current;
    // nearest size, then step
    let idx = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (Math.abs(sizes[i] - cur) < Math.abs(sizes[idx] - cur)) idx = i;
    }
    const next = sizes[Math.max(0, Math.min(sizes.length - 1, idx + dir))];
    setBrushPx(next);
  };

  const active = activeLayer >= 0 && activeLayer < layers.length ? layers[activeLayer] : null;

  return {
    idPrefix,
    dims,
    srcPath,
    status,
    smartBusy,
    tool, mode, brushPx, mirror,
    setTool: (t) => { if (t === 'smart' && !smartAvailable) return; setTool(t); },
    setMode, setBrushPx, setMirror, stepBrush,
    beginStroke, paintAtSource, endStroke,
    lassoPoints, addLassoPoint, commitLasso, clearLasso,
    smartAvailable,
    clicks: active?.clicks ?? [],
    addClick, clearClicks,
    backendName: backend?.name ?? 'none',
    floodFuzz, setFloodFuzz: setFloodFuzzState,
    floodRejectFrac, setFloodRejectFrac: setFloodRejectFracState,
    samThreshold, setSamThreshold: setSamThresholdState,
    samMaskIdx, setSamMaskIdx: setSamMaskIdxState,
    layers, activeLayer, setActiveLayer, maskVersion,
    baseIdOf, brushIdOf,
    addLayer, deleteLayer, duplicateLayer, moveLayer, mergeLayer,
    toggleLayerMute, setLayerName, setLayerGroup,
    clearMask, invertMask,
    defaults,
    setLayerMode, setLayerBlend, setLayerColor,
    setLayerHueOffset, setLayerPhaseOffset, setLayerDim,
    customSurfaces, addCustomSurface,
    clipboard, copyLayer, pasteLayer, cutLayer,
    canUndo: historyTick >= 0 && history.canUndo(),
    canRedo: historyTick >= 0 && history.canRedo(),
    undo, redo,
    buildDocument, applyDocument, composeExportMask,
    documentVersion,
  };
}
