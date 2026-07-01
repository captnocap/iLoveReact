// modelview — pick (or drop) a .glb/.obj, view it. Crisp, butter-smooth, native.
//
// The whole point of this cart is what it DOESN'T do: it never ships geometry across
// the JS bridge and never re-renders to move the camera. The chosen file is parsed
// ENTIRELY in the host (framework/world/mesh_import.zig via __mesh_load_file), uploaded
// to the GPU once, and handed back as a short intern key. The <Scene3D.Mesh hostKey>
// node carries only that key — the host redraws the resident mesh every frame. The
// camera is the host's orbit camera (<Scene3D.Camera orbit>): drag and wheel feed raw
// deltas straight to gpu/3d.zig (__model_orbit_drag/zoom), which repaints WITHOUT a
// React render. So no matter how heavy the model, orbiting stays smooth — React does
// exactly one render per file load and nothing per frame.
//
// A file is chosen with the native OS picker (the shared runtime pickFile — the same
// zenity dialog the Studio import uses), or by dropping it on the window.
//
// Verify headless: `./tools/rjit shot modelview` renders the empty prompt; open a real
// model under `./tools/rjit dev modelview`, or `RJIT_MODEL=path ./tools/rjit shot
// modelview` to render one headlessly.
import { useState, useRef, useEffect } from 'react';
import { Box, Col, Row, Text, Pressable, Slider, Scene3D } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { useModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { callHost } from '@reactjit/runtime/ffi';
import {
  loadLedger, putEntry, recordImport, exportCredits, pendingCount,
  AttributionPanel, AttributionStatusBadge, type Attribution, type Ledger,
} from '@reactjit/runtime/attribution';
// The ONE brush system (runtime/paint) — the same kit Color Studio, MaterialFocus,
// brush_studio and the Studio pixel-painter use. The model viewer adopts it too: BrushKit
// is the shared UI/state (tools, dials, colour wheel, palette); the actual per-face-safe 3D
// stamping is a Zig host capability (model_paint.zig via the __model_paint_* doors), so this
// is the brush MODEL driving a host backend, not a second brush implementation.
import {
  BrushKit, DEFAULT_BRUSH, defaultPalette, hexToRgb01, inkColorHex, DARK_THEME,
  type Brush, type BrushTool, type Palette,
} from '@reactjit/runtime/paint';

const host = globalThis as any;

type Loaded = { key: string; count: number; radius: number; name: string };
export type ModelViewInitialMesh = {
  key: string;
  name: string;
  vertices: Float32Array | number[];
  count?: number;
};
// The live tool state, mirrored out so an embedding shell (the editor) can drive
// the SAME host-native tools from its own toolbar / context menu instead of the
// viewer's floating buttons. selMode: 0 view · 1 vertex · 2 edge · 3 face.
// gizmoTool: 0 move · 1 scale · 2 rotate.
// sel: count of selected elements in the current mode. quality: live decimation
// slider (0..1). tris: the resident triangle count (for the quality readout).
// brushTool: 'fill' (per-face flood) · 'brush' (free-form disc). safety: 0 clip · 1 lock.
// detail: 1 fill-only · 8/16/32 free-form texels/face. brush/palette: the shared kit model,
// mirrored out so the editor's BrushKit dock is a controlled view of the viewer's brush.
export type ModelToolSnapshot = { selMode: number; gizmoTool: number; paint: boolean; focus: boolean; wire: boolean; sel: number; quality: number; tris: number; brushTool: BrushTool; safety: number; detail: number; brush: Brush; palette: Palette };
// The handlers the viewer owns, handed out so an external surface can invoke
// them. Same functions the floating buttons and hotkeys call — one owner, no
// split-brain: the shell remote-controls; the viewer stays the source of truth.
// extrudeEdge / createFace are the contextual topology ops (valid on an edge
// selection); setQuality drives the live decimation knob.
export type ModelToolApi = {
  selMode: (m: number) => void;
  gizmo: (t: number) => void;
  paint: () => void;
  focus: () => void;
  wire: () => void;
  extrudeEdge: () => void;
  createFace: () => void;
  setQuality: (q: number) => void;
  // Brush controls — the editor toolbar drives tool/safety/detail, the BrushKit dock drives
  // the brush + palette. The viewer stays the single owner of the live brush state.
  brushTool: (t: BrushTool) => void;
  cycleSafety: () => void;
  cycleDetail: () => void;
  setBrush: (b: Brush) => void;
  setPalette: (p: Palette) => void;
};
export type ModelViewProps = {
  initialPath?: string;
  initialTitle?: string;
  initialMesh?: ModelViewInitialMesh;
  allowFilePicker?: boolean;
  trackAttribution?: boolean;
  // When the editor hosts the viewer, its toolbar + context menu own the tool
  // chrome — so the viewer drops its own floating button rows and the surface
  // goes bland. The shell drives the tools through onToolApi / onToolState.
  hostChrome?: boolean;
  onToolApi?: (api: ModelToolApi) => void;
  onToolState?: (state: ModelToolSnapshot) => void;
};

/** sha256 of the file bytes (host door) — keys attribution to the content. */
const fileSha = (path: string): string => {
  const s = host.__file_sha256?.(path);
  return typeof s === 'string' ? s : '';
};

/** Parse a dropped file in the host and get back its intern key + stats. Returns null
 *  if the door is missing (non-V8 host) or the file failed to parse. */
function loadModelFile(path: string): Loaded | null {
  const fn = host.__mesh_load_file;
  if (typeof fn !== 'function') return null;
  const json = fn(path);
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.key !== 'string') return null;
    const name = path.split('/').pop() || path;
    return { key: o.key, count: o.count | 0, radius: o.radius || 1, name };
  } catch {
    return null;
  }
}

/** Adopt already-cooked triangle data into the same resident host-mesh path as
 *  file imports. This is for editor-owned assets: after import, the source file is
 *  no longer the model, the interleaved vertex factor is. */
function loadModelVertices(mesh: ModelViewInitialMesh): Loaded | null {
  const fn = host.__mesh_load_vertices;
  if (typeof fn !== 'function') return null;
  const verts = mesh.vertices instanceof Float32Array ? mesh.vertices : new Float32Array(mesh.vertices);
  const count = mesh.count ?? Math.floor(verts.length / 8);
  const json = fn(mesh.key, verts, count);
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.key !== 'string') return null;
    return { key: o.key, count: o.count | 0, radius: o.radius || 1, name: mesh.name };
  } catch {
    return null;
  }
}

// Wheel zoom is the one orbit door the cart still calls directly — from the paint-mode
// Pressable's onScroll (in paint mode that surface owns the wheel; everywhere else the
// host's native loop handles it). Orbit/pan/select/marquee/focus are ALL native now.
const orbitZoom = (delta: number) => host.__model_orbit_zoom?.(delta);

// ── Host-native mesh editor (the editor surface) ─────────────────────────────────
// Mode: 0 = view, 1 = vertex, 2 = edge, 3 = face. Everything below the toolbar level is
// the host's: welded topology, selection sets, AND the input loop (engine.zig). The cart
// only sets mode/tool/capture and reads counts for the HUD — never a per-event handler.
type SelInfo = { mode: number; verts: number; edges: number; sel: number };
type TopoResult = { ok: number; key?: string; count?: number };
type GuardInfo = { pending: number; bad: number; faces: number; canSplit: number };
const meshSetMode = (m: number) => host.__mesh_edit_mode?.(m);
const meshClearSel = () => host.__mesh_edit_clear?.();
const meshGizmoTool = (t: number) => host.__mesh_gizmo_tool?.(t);
const meshSelectEdge = (idx: number, additive = false) => host.__mesh_edit_select_edge?.(idx, additive ? 1 : 0) === 1;
// Hand the model-editor input loop to the host (native orbit/select/marquee/zoom/focus,
// zero JS per event), and toggle the Focus tool (left-drag pans the pivot).
const meshCapture = (on: boolean) => host.__mesh_edit_capture?.(on ? 1 : 0);
const meshFocusTool = (on: boolean) => host.__mesh_edit_focus?.(on ? 1 : 0);
const readSelInfo = (): SelInfo | null => {
  try {
    const j = host.__mesh_edit_counts?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as SelInfo) : null;
  } catch {
    return null;
  }
};
const readTopoResult = (json: any): TopoResult | null => {
  try {
    return typeof json === 'string' && json ? (JSON.parse(json) as TopoResult) : null;
  } catch {
    return null;
  }
};
const meshExtrudeEdge = (distance: number) => readTopoResult(host.__mesh_topo_extrude_edge?.(distance));
const meshCreateFace = () => readTopoResult(host.__mesh_topo_create_face?.());
const readGuard = (): GuardInfo | null => {
  try {
    const j = host.__mesh_edit_guard?.();
    return typeof j === 'string' && j ? (JSON.parse(j) as GuardInfo) : null;
  } catch {
    return null;
  }
};
const resolveGuard = (action: number) => host.__mesh_edit_guard_resolve?.(action);
const SEL_MODES = ['Object', 'Vertex', 'Edge', 'Face'];
const GIZMO_TOOLS = ['Move', 'Scale', 'Rotate'];
// Re-decimate the model to clustering resolution `grid` (8..256, higher = more detail)
// and return the new {key,count}, or null. The host re-meshes from the retained full-res
// source — nothing but the key + count crosses the bridge.
function setModelQuality(grid: number): { key: string; count: number } | null {
  const json = host.__model_set_quality?.(grid);
  if (typeof json !== 'string' || !json) return null;
  try {
    const o = JSON.parse(json);
    return typeof o?.key === 'string' ? { key: o.key, count: o.count | 0 } : null;
  } catch {
    return null;
  }
}
// Slider position 0..1 → clustering grid. Squared so the low end (coarse "just the
// shape") gets fine control, which is where the game LoD lives. Quantized to a fixed
// set of levels so scrubbing the slider can't intern an unbounded number of distinct
// meshes into the retained GPU buffer — revisiting a level reuses its resident mesh.
const QUALITY_STEPS = 20;
const qualityToGrid = (q: number) => {
  const snapped = Math.round(q * QUALITY_STEPS) / QUALITY_STEPS;
  return Math.round(8 + snapped * snapped * 248);
};
type RGB = [number, number, number];

// The two brush behaviours, both host-backed (model_paint.zig). FILL raycasts the resident
// mesh and floods the whole face hit (__model_paint_at). BRUSH lays a sub-face disc clipped to
// the face triangle (__model_paint_stamp) — face-safe, so a scribble never bleeds onto the
// neighbour face. No verts or UVs cross the bridge; only the pixel + colour do.
const fillFaceAt = (x: number, y: number, rgb: RGB) => host.__model_paint_at?.(x, y, rgb[0], rgb[1], rgb[2]) === 1;
const stampAt = (x: number, y: number, rgb: RGB, radius: number, flow: number) =>
  host.__model_paint_stamp?.(x, y, rgb[0], rgb[1], rgb[2], radius, flow) === 1;
const strokeBeginAt = (x: number, y: number) => host.__model_paint_stroke_begin?.(x, y) ?? -1;
// Face-safety mode for free-form: 0 = clip (paint whatever face the dab is over), 1 = lock
// (mask the whole stroke to the face pressed at stroke-begin).
const setPaintSafety = (mode: number) => host.__model_paint_mode?.(mode);
// Set the free-form patch detail; returns the ACTUAL detail after the budget guard.
const applyPaintDetail = (px: number): number => host.__model_set_paint_detail?.(px) ?? px;

// The RGB (0..255) a colour-ink brush deposits — texture/shader inks fall back to white until
// the host dest-sampling pass lands. Mirrors runtime/paint's brushDabRgb, scaled to bytes.
const brushRgb = (b: Brush): RGB => {
  const [r, g, bl] = hexToRgb01(inkColorHex(b.ink) ?? '#ffffff');
  return [Math.round(r * 255), Math.round(g * 255), Math.round(bl * 255)];
};

// Free-form detail levels: 8/16/32 texels per face. Higher = crisper strokes on low-poly
// models; lower keeps dense meshes inside the paint-atlas memory budget. (1 = fill-only.)
const DETAIL_LEVELS = [8, 16, 32] as const;
// BrushKit size (texture-px diameter, default 32) → patch-texel disc radius. A full-face brush
// (~size 96) covers a whole patch at any detail; the disc clips to the triangle regardless.
const brushRadius = (size: number, detail: number) => Math.max(0.6, (size / 96) * detail);

export default function ModelView({ initialPath, initialTitle, initialMesh, allowFilePicker = true, trackAttribution = true, hostChrome = false, onToolApi, onToolState }: ModelViewProps = {}) {
  const [model, setModel] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wire, setWire] = useState(false);
  const [paintMode, setPaintMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false); // Focus tool: drag pans the pivot
  const [selMode, setSelMode] = useState(0); // 0 view · 1 vertex · 2 edge · 3 face
  const [gizmoTool, setGizmoTool] = useState(0); // 0 move · 1 scale · 2 rotate
  const [selInfo, setSelInfo] = useState<SelInfo>({ mode: 0, verts: 0, edges: 0, sel: 0 });
  const [guard, setGuard] = useState<GuardInfo | null>(null);
  // Brush state (the ONE brush system). `brush`/`palette` are the shared kit model; `brushTool`
  // picks the behaviour ('fill' = per-face flood · 'brush' = free-form disc); `safety` is the
  // free-form face-safety mode (0 clip · 1 lock); `detail` is the patch resolution.
  const [brush, setBrush] = useState<Brush>(() => ({ ...DEFAULT_BRUSH, ink: { kind: 'color', hex: '#e0463f' } }));
  const [brushTool, setBrushTool] = useState<BrushTool>('fill');
  const [palette, setPalette] = useState<Palette>(() => defaultPalette());
  const [safety, setSafety] = useState(0); // 0 clip · 1 lock
  const [detail, setDetail] = useState(1); // 1 fill-only · 8/16/32 free-form texels/face
  const [quality, setQuality] = useState(1); // slider 0..1; 1 = full detail on load
  // Attribution: the shared ledger + the current model's entry + the panel toggle.
  const [ledger, setLedger] = useState<Ledger>(() => loadLedger());
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [attrOpen, setAttrOpen] = useState(false);

  // Record (or fetch) the attribution for a just-loaded file, keyed by its content sha.
  const recordAttribution = (path: string) => {
    if (!trackAttribution) return;
    const sha = fileSha(path);
    if (!sha) { setAttribution(null); return; }
    const next = { ...ledger };
    const entry = recordImport(sha, path, next);
    setLedger(next);
    setAttribution(entry);
    if (entry.status === 'pending') setAttrOpen(true); // surface the obligation immediately
  };

  const saveAttribution = (patch: Pick<Attribution, 'title' | 'author' | 'source' | 'license'>) => {
    if (!attribution) return;
    const next = { ...ledger };
    const saved = putEntry(next, { ...attribution, ...patch });
    setLedger(next);
    setAttribution(saved);
  };

  const doExportCredits = () => {
    const r = exportCredits(ledger);
    setError(r.ok
      ? (r.pending > 0 ? `Credits exported — ⚠ ${r.pending} asset(s) still need attribution` : 'Credits exported ✓')
      : 'Could not write credits file');
  };

  // Apply a new quality (slider 0..1): re-decimate in the host and swap the resident
  // mesh. Repainting resets (the topology changed) — quality is a pre-paint step.
  const applyQuality = (q: number) => {
    setQuality(q);
    const r = setModelQuality(qualityToGrid(q));
    if (r) {
      setModel((m) => (m ? { ...m, key: r.key, count: r.count } : m));
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 }); // host re-meshed → selection cleared
    }
  };

  const applyTopo = (r: TopoResult | null, fail: string) => {
    if (r?.ok && typeof r.key === 'string' && typeof r.count === 'number') {
      setModel((m) => (m ? { ...m, key: r.key!, count: r.count! } : m));
      setSelMode(2);
      setWire(true);
      setSelInfo(readSelInfo() ?? { mode: 2, verts: 0, edges: 0, sel: 0 });
      setError(null);
    } else {
      setError(fail);
    }
  };

  const closeGuard = (action: number) => {
    resolveGuard(action);
    setGuard(null);
    setSelInfo(readSelInfo() ?? selInfo);
  };

  // Only the paint stroke is JS-driven now (and only while in paint mode). Orbit, select,
  // marquee, focus, and zoom are owned entirely by the host's native input loop — there is
  // no per-move React state for them, which is the whole point (no JS in the loop).
  const paintingRef = useRef(false);
  // Last painted viewport point, so a fast drag interpolates dabs along the segment instead of
  // leaving gaps (the host stamps one disc per call; JS walks the segment between moves).
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  // Switch tool: selecting a mesh mode (or going back to view) is the active tool, so it
  // turns off Paint/Focus, and pushes the mode to the host. Mode 0 = plain view/orbit.
  const chooseSelMode = (m: number) => {
    setSelMode(m);
    setPaintMode(false);
    setFocusMode(false);
    meshFocusTool(false);
    if (m === 1 || m === 2) setWire(true); // show topology where you're clicking verts/edges
    meshSetMode(m);
    setSelInfo(readSelInfo() ?? { mode: m, verts: 0, edges: 0, sel: 0 });
  };
  const chooseGizmoTool = (t: number) => {
    setGizmoTool(t);
    meshGizmoTool(t);
  };
  // Paint and Focus are tools too — turning one on drops the mesh-select mode back to view
  // so only one tool owns the drag at a time. The Focus tool flag also goes to the host
  // (it owns the left-drag = pan-pivot gesture natively).
  const togglePaint = () => setPaintMode((v) => { const nv = !v; if (nv) { setFocusMode(false); meshFocusTool(false); setSelMode(0); meshSetMode(0); } return nv; });
  const toggleFocus = () => setFocusMode((v) => { const nv = !v; meshFocusTool(nv); if (nv) { setPaintMode(false); setSelMode(0); meshSetMode(0); } return nv; });

  // ── Brush behaviour handlers ─────────────────────────────────────────────────
  // Apply a free-form detail level through the host (it re-tessellates the paint atlas and
  // re-uploads the mesh); the door returns the ACTUAL level after its memory-budget guard.
  const changeDetail = (px: number) => setDetail(applyPaintDetail(px));
  const cycleDetail = () => {
    const i = DETAIL_LEVELS.indexOf(detail as (typeof DETAIL_LEVELS)[number]);
    changeDetail(DETAIL_LEVELS[(i + 1) % DETAIL_LEVELS.length]!);
  };
  // Free-form needs sub-face room, so entering the brush tool bumps detail off fill-only.
  const chooseBrushTool = (t: BrushTool) => {
    setBrushTool(t);
    if (t !== 'fill' && detail < 8) changeDetail(16);
  };
  const cycleSafety = () => setSafety((v) => (v === 0 ? 1 : 0));

  // Push the free-form face-safety mode to the host whenever it (or paint mode) changes.
  useEffect(() => { if (paintMode) setPaintSafety(safety); }, [safety, paintMode]);
  // A fresh model resets the host paint atlas to fill-only (patch=1) — mirror that in state.
  useEffect(() => { setDetail(1); }, [model?.key]);

  // ── Editor bridge ──────────────────────────────────────────────────────────
  // Hand the tool handlers out (once) and mirror the live tool state back, so an
  // embedding shell can drive the SAME tools its toolbar/context-menu present.
  // The exposed api wraps a ref to the latest handlers so it stays referentially
  // stable while always closing over fresh state — one owner, no split-brain.
  const toolApiRef = useRef<ModelToolApi | null>(null);
  toolApiRef.current = {
    selMode: chooseSelMode,
    gizmo: chooseGizmoTool,
    paint: togglePaint,
    focus: toggleFocus,
    wire: () => setWire((v) => !v),
    extrudeEdge: () => { if (model) applyTopo(meshExtrudeEdge(model.radius * 0.08), 'Select exactly one edge to extrude'); },
    createFace: () => applyTopo(meshCreateFace(), 'Select two separate edges or a closed 3/4-edge loop'),
    setQuality: (q) => applyQuality(q),
    brushTool: chooseBrushTool,
    cycleSafety,
    cycleDetail,
    setBrush,
    setPalette,
  };
  useEffect(() => {
    onToolApi?.({
      selMode: (m) => toolApiRef.current?.selMode(m),
      gizmo: (t) => toolApiRef.current?.gizmo(t),
      paint: () => toolApiRef.current?.paint(),
      focus: () => toolApiRef.current?.focus(),
      wire: () => toolApiRef.current?.wire(),
      extrudeEdge: () => toolApiRef.current?.extrudeEdge(),
      createFace: () => toolApiRef.current?.createFace(),
      setQuality: (q) => toolApiRef.current?.setQuality(q),
      brushTool: (t) => toolApiRef.current?.brushTool(t),
      cycleSafety: () => toolApiRef.current?.cycleSafety(),
      cycleDetail: () => toolApiRef.current?.cycleDetail(),
      setBrush: (b) => toolApiRef.current?.setBrush(b),
      setPalette: (p) => toolApiRef.current?.setPalette(p),
    });
  }, []);
  useEffect(() => {
    onToolState?.({ selMode, gizmoTool, paint: paintMode, focus: focusMode, wire, sel: selInfo.sel, quality, tris: model ? Math.floor(model.count / 3) : 0, brushTool, safety, detail, brush, palette });
  }, [selMode, gizmoTool, paintMode, focusMode, wire, selInfo.sel, quality, model?.count, brushTool, safety, detail, brush, palette]);

  // W = wireframe, P = paint, F = focus, 1/2/3 = vertex/edge/face, Esc = clear/back to view.
  useModifiers({
    w: () => setWire((v) => !v), W: () => setWire((v) => !v),
    p: togglePaint, P: togglePaint,
    f: toggleFocus, F: toggleFocus,
    g: () => chooseGizmoTool(0), G: () => chooseGizmoTool(0),
    s: () => chooseGizmoTool(1), S: () => chooseGizmoTool(1),
    r: () => chooseGizmoTool(2), R: () => chooseGizmoTool(2),
    '1': () => chooseSelMode(1), '2': () => chooseSelMode(2), '3': () => chooseSelMode(3),
    Escape: () => { if (selMode !== 0) { meshClearSel(); setSelInfo(readSelInfo() ?? selInfo); } },
  });

  // One load path for every source (picker, drop, CLI): validate the extension, hand
  // the path to the host parser, and surface a clean error if it can't be read.
  const applyPath = (path: string) => {
    // .gltf is intentionally NOT accepted: it's JSON with an external .bin, while the
    // host parser reads the self-contained binary .glb container.
    const ext = path.toLowerCase();
    if (!(ext.endsWith('.glb') || ext.endsWith('.obj'))) {
      setError('Unsupported file — pick a .glb or .obj');
      return;
    }
    const loaded = loadModelFile(path);
    if (loaded) {
      setModel(loaded);
      setError(null);
      setQuality(1); // a fresh model loads full-res
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 }); // new mesh → selection cleared
      recordAttribution(path); // account for where this asset came from
    } else {
      setError(`Could not load ${path.split('/').pop()}`);
    }
  };

  const applyMesh = (mesh: ModelViewInitialMesh) => {
    const loaded = loadModelVertices(mesh);
    if (loaded) {
      setModel(loaded);
      setError(null);
      setQuality(1);
      setSelInfo({ mode: selMode, verts: 0, edges: 0, sel: 0 });
    } else {
      setError(`Could not load ${mesh.name}`);
    }
  };

  // Open the native OS file picker (zenity, via the shared runtime pickFile). Async —
  // the dialog runs in a subprocess and resolves with the chosen path, or null on
  // cancel. This is the primary way in; drag-drop below is a bonus.
  const chooseModel = async () => {
    const path = await pickFile({
      title: 'Open a 3D model',
      filters: [
        { name: '3D models', patterns: ['*.glb', '*.obj'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (path) applyPath(path);
  };

  // Open-from-CLI: `RJIT_MODEL=path/to/file.glb ./zig-out/bin/modelview` loads a model
  // at boot (no picker needed). Also the headless self-shot path —
  // `RJIT_MODEL=... ./tools/rjit shot modelview` renders the loaded model.
  useEffect(() => {
    // Hand the model-editor input loop to the host (native orbit/select/marquee/zoom/focus).
    meshCapture(true);
    // The host calls this once per committed selection change (a click or a marquee release,
    // NOT per drag-move) so the count HUD refreshes without any JS in the interaction loop.
    (globalThis as any).__meshEditSelChanged = () => setSelInfo(readSelInfo() ?? { mode: 0, verts: 0, edges: 0, sel: 0 });
    (globalThis as any).__meshEditGuardChanged = () => setGuard(readGuard());
    if (initialMesh) {
      applyMesh(initialMesh);
    } else {
      const path = initialPath ?? callHost<string | null>('__env_get', null, 'RJIT_MODEL');
      if (path) applyPath(path);
    }
    // RJIT_WIRE=1 boots in wireframe mode — the headless self-shot path for it.
    if (callHost<string | null>('__env_get', null, 'RJIT_WIRE')) setWire(true);
    // RJIT_GIZMO=move|scale|rotate (or 0|1|2) selects the transform sub-tool at boot.
    const gt = callHost<string | null>('__env_get', null, 'RJIT_GIZMO');
    if (gt) {
      const t = gt === 'scale' ? 1 : gt === 'rotate' ? 2 : Number(gt) || 0;
      chooseGizmoTool(Math.max(0, Math.min(2, t)));
    }
    // RJIT_ZOOM=N dollies the camera in N notches at boot — the headless way to prove
    // the wireframe stays locked to the surface when you get in close.
    const zoom = Number(callHost<string | null>('__env_get', null, 'RJIT_ZOOM') ?? 0);
    for (let i = 0; i < zoom; i += 1) orbitZoom(1);
    // RJIT_PAINT=1 paints every face by index in a rainbow — the headless proof that
    // painting is per-face and independent (no congruent-face fusion). Each face shows
    // its OWN colour, which is exactly the bug the old UV-atlas dedup couldn't avoid.
    if (callHost<string | null>('__env_get', null, 'RJIT_PAINT')) {
      setPaintMode(true);
      const proof: RGB[] = [[222, 70, 64], [238, 142, 48], [240, 206, 74], [112, 196, 96], [66, 158, 226], [126, 112, 222], [226, 120, 196], [244, 244, 248]];
      const n = Number(host.__model_face_count?.() ?? 0);
      for (let f = 0; f < n; f += 1) {
        const c = proof[f % proof.length]!;
        host.__model_paint_face?.(f, c[0], c[1], c[2]);
      }
    }
    // RJIT_PAINTONE=1 paints exactly ONE face bright red — the proof that a single-face
    // change shows immediately (the content-hash texture cache used to drop it).
    if (callHost<string | null>('__env_get', null, 'RJIT_PAINTONE')) {
      setPaintMode(true);
      host.__model_paint_face?.(40, 230, 40, 40);
    }
    // RJIT_ATTRIB_EXPORT=1 writes CREDITS.md from the current ledger at boot — the
    // headless proof the credits export works (and reports pending obligations).
    if (callHost<string | null>('__env_get', null, 'RJIT_ATTRIB_EXPORT')) doExportCredits();
    // RJIT_QUALITY=grid re-decimates at boot — the headless proof the quality knob works.
    const q = Number(callHost<string | null>('__env_get', null, 'RJIT_QUALITY') ?? 0);
    if (q > 0) {
      const r = setModelQuality(q);
      if (r) setModel((m) => (m ? { ...m, key: r.key, count: r.count } : m));
    }
    // RJIT_QUALITYSTRESS=1 scrubs 30 distinct quality levels (>16 stash slots) then
    // settles — proof the stash no longer overflows and the model still draws (req_2137).
    if (callHost<string | null>('__env_get', null, 'RJIT_QUALITYSTRESS')) {
      let last: { key: string; count: number } | null = null;
      for (let g = 10; g < 40; g += 1) last = setModelQuality(g) ?? last;
      if (last) setModel((m) => (m ? { ...m, key: last!.key, count: last!.count } : m));
    }
    // RJIT_SELECTFACE=N selects face N (face mode) at boot — the headless proof that
    // selection HIGHLIGHTS show. Index select needs no camera, so it works pre-render.
    const sf = callHost<string | null>('__env_get', null, 'RJIT_SELECTFACE');
    if (sf != null) {
      host.__mesh_edit_select_face?.(Number(sf) || 0, 0);
      setSelMode(3);
      setSelInfo(readSelInfo() ?? { mode: 3, verts: 0, edges: 0, sel: 1 });
    }
    // RJIT_SELECTEDGE=N or RJIT_SELECTEDGES=A,B selects welded edges by index for
    // deterministic topology screenshots; RJIT_EDGEOP=extrude|face then runs the op.
    const edgeText = callHost<string | null>('__env_get', null, 'RJIT_SELECTEDGES')
      ?? callHost<string | null>('__env_get', null, 'RJIT_SELECTEDGE');
    if (edgeText != null) {
      edgeText.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)).forEach((idx, i) => {
        meshSelectEdge(idx, i > 0);
      });
      setSelMode(2);
      setWire(true);
      setSelInfo(readSelInfo() ?? { mode: 2, verts: 0, edges: 0, sel: 1 });
    }
    const edgeOp = callHost<string | null>('__env_get', null, 'RJIT_EDGEOP');
    if (edgeOp) {
      const r = edgeOp === 'face' ? meshCreateFace() : meshExtrudeEdge(0);
      if (r?.ok && r.key && typeof r.count === 'number') {
        setModel((m) => (m ? { ...m, key: r.key!, count: r.count! } : m));
        setSelMode(2);
        setWire(true);
        setSelInfo(readSelInfo() ?? { mode: 2, verts: 0, edges: 0, sel: 0 });
      }
    }
    // RJIT_NUDGE=x,0.25 (or y/z) translates the active selection headlessly after
    // index-based selection. It proves host-native geometry mutation without a mouse drag.
    const nudge = callHost<string | null>('__env_get', null, 'RJIT_NUDGE');
    if (nudge) {
      const [axisName, amountText] = nudge.split(',');
      const axis = axisName === 'y' ? 1 : axisName === 'z' ? 2 : 0;
      host.__mesh_gizmo_nudge?.(axis, Number(amountText) || 0);
      setSelInfo(readSelInfo() ?? { mode: 3, verts: 0, edges: 0, sel: 1 });
    }
    // RJIT_MESHMODE=1|2|3 enters vertex/edge/face mode at boot — the headless proof that
    // the vertex dots / edge highlights / overlay draw (vertex mode shows every vert).
    const mm = Number(callHost<string | null>('__env_get', null, 'RJIT_MESHMODE') ?? 0);
    if (mm >= 1 && mm <= 3) chooseSelMode(mm);
    return () => {
      paintingRef.current = false;
      meshFocusTool(false);
      meshCapture(false);
    };
  }, []);

  useFileDrop((path) => {
    if (allowFilePicker) applyPath(path);
  });

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0b0d12' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0d12" showAxes={false} wireframe={wire}>
        {/* The host owns this camera: position comes from orbit state seeded by the
            load door and driven by the overlay's drag/wheel — never from props here. */}
        <Scene3D.Camera orbit fov={50} />
        {/* A clean object-viewer wants no distance fade. */}
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#6b7488" intensity={1.0} />
        <Scene3D.DirectionalLight direction={[-0.5, -0.9, -0.4]} color="#ffffff" intensity={1.7} />
        {/* White material: all colour comes from the host's per-face paint atlas
            (default grey until painted), so painted colours render true. */}
        {model && <Scene3D.Mesh hostKey={model.key} material="#ffffff" />}
      </Scene3D>

      {/* Paint input surface — mounted ONLY in paint mode. Every other interaction (orbit
          on middle-drag, vertex/edge/face select + marquee on left, wheel zoom, double-click
          recenter, Focus-tool pan) is owned by the HOST's native model-editor input loop in
          engine.zig — zero JS per event, no React render per move. When this Pressable isn't
          mounted, viewport mouse events reach that native loop directly. */}
      {model && paintMode && (
        <Pressable
          onMouseDown={(p: any) => {
            const x = p?.x ?? 0, y = p?.y ?? 0;
            paintingRef.current = true;
            lastPtRef.current = { x, y };
            const rgb = brushRgb(brush);
            if (brushTool === 'fill') { fillFaceAt(x, y, rgb); return; }
            strokeBeginAt(x, y); // capture the pressed face for LOCK-mode masking
            stampAt(x, y, rgb, brushRadius(brush.size, detail), brush.flow);
          }}
          onMouseMove={(p: any) => {
            if (!paintingRef.current) return;
            const x = p?.x ?? 0, y = p?.y ?? 0;
            const rgb = brushRgb(brush);
            if (brushTool === 'fill') { fillFaceAt(x, y, rgb); lastPtRef.current = { x, y }; return; }
            // Free-form: walk the screen segment from the last dab in ~3px steps (bounded) so a
            // fast drag stays gap-free — each step is one host stamp (raycast + clipped disc).
            const last = lastPtRef.current ?? { x, y };
            const dx = x - last.x, dy = y - last.y;
            const steps = Math.min(24, Math.max(1, Math.floor(Math.hypot(dx, dy) / 3)));
            const radius = brushRadius(brush.size, detail);
            for (let i = 1; i <= steps; i += 1) {
              const t = i / steps;
              stampAt(last.x + dx * t, last.y + dy * t, rgb, radius, brush.flow);
            }
            lastPtRef.current = { x, y };
          }}
          onMouseUp={() => { paintingRef.current = false; lastPtRef.current = null; }}
          onMouseLeave={() => { paintingRef.current = false; lastPtRef.current = null; }}
          onScroll={(e: any) => orbitZoom(e?.deltaY ?? 0)}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }}
        />
      )}

      {/* Title strip — only changes on load, so this render is the one-and-only. */}
      <Row
        style={{
          position: 'absolute', left: 0, top: 0, right: 0, height: 34,
          alignItems: 'center', paddingLeft: 14, paddingRight: 14,
          backgroundColor: 'rgba(12,14,20,0.72)', borderBottomWidth: 1, borderColor: '#1d2330',
        }}
      >
        <Text style={{ color: '#e8edf6', fontSize: 13, fontWeight: 600 }}>
          {model ? model.name : initialTitle ?? 'Model Viewer'}
        </Text>
        {model && (
          <Text style={{ color: '#7d899c', fontSize: 12, marginLeft: 12 }}>
            {paintMode
              ? `${(model.count / 3).toLocaleString()} tris · click a face to fill · drag to paint · middle-drag orbits`
              : focusMode
                ? `${(model.count / 3).toLocaleString()} tris · drag to pan focus · double-click to recenter`
                : selMode !== 0
                  ? `${SEL_MODES[selMode]} · ${GIZMO_TOOLS[gizmoTool]} gizmo · ${selInfo.sel} selected · click · shift-click adds · drag = box · middle-drag orbits`
                  : `${(model.count / 3).toLocaleString()} tris · middle-drag orbits · wheel zoom · double-click recenter`}
          </Text>
        )}
        <Box style={{ flexGrow: 1 }} />
        {model && attribution && (
          <Pressable
            onPress={() => setAttrOpen((v) => !v)}
            tooltip="Attribution & credits"
            style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center' }}
          >
            <AttributionStatusBadge status={attribution.status} />
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={togglePaint}
            tooltip="Toggle paint mode (P)"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: paintMode ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: paintMode ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: paintMode ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Paint</Text>
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={toggleFocus}
            tooltip="Focus tool (F) — drag to move the pivot; double-click the model to recenter"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: focusMode ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: focusMode ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: focusMode ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Focus</Text>
          </Pressable>
        )}
        {!hostChrome && model && (
          <Pressable
            onPress={() => setWire((w) => !w)}
            tooltip="Toggle wireframe (W)"
            style={{
              marginRight: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: wire ? '#2a466e' : '#16233aee', borderWidth: 1, borderColor: wire ? '#5a86c0' : '#2c4a6a',
            }}
          >
            <Text style={{ color: wire ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Wireframe</Text>
          </Pressable>
        )}
        {allowFilePicker ? (
          <Pressable
            onPress={chooseModel}
            style={{
              paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
              backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a',
            }}
          >
            <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Open…</Text>
          </Pressable>
        ) : null}
      </Row>

      {/* Standalone brush panel — the ONE brush kit (runtime/paint), mounted on the left in
          paint mode. In the editor embed (hostChrome) the kit lives in the Model Focus dock and
          the tool/safety/detail toggles live in the top toolbar, so this whole panel is
          suppressed there. The two mandatory behaviours (fill · free-form) plus the clip/lock
          safety toggle and the 8/16/32 detail toggle are surfaced here for standalone use. */}
      {!hostChrome && model && paintMode && (
        <Col
          style={{
            position: 'absolute', left: 10, top: 44, width: 238,
            backgroundColor: 'rgba(12,14,20,0.92)', borderWidth: 1, borderColor: '#1d2330',
            borderRadius: 8, padding: 10, gap: 10,
          }}
        >
          <Row style={{ alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={cycleSafety}
              tooltip="Face safety: clip paints the face under the dab; lock masks the whole stroke to the pressed face"
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
            >
              <Text style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 700 }}>{safety === 0 ? 'Clip' : 'Lock'}</Text>
            </Pressable>
            <Pressable
              onPress={cycleDetail}
              tooltip="Free-form detail — texels per face (higher = crisper strokes on low-poly)"
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
            >
              <Text style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 700 }}>{detail <= 1 ? 'Detail —' : `Detail ${detail}`}</Text>
            </Pressable>
          </Row>
          <BrushKit
            brush={brush} onBrushChange={setBrush}
            tool={brushTool} onToolChange={chooseBrushTool}
            palette={palette} onPaletteChange={setPalette}
            tools={['fill', 'brush', 'eyedropper']}
            theme={DARK_THEME} width={218}
          />
        </Col>
      )}

      {/* Mode toolbar — Object / Vertex / Edge / Face. The host-native selection modes;
          picking happens against the resident mesh with the exact render camera. Shares the
          under-title row with the paint palette (they're mutually-exclusive tools).
          Suppressed under hostChrome: the editor's toolbar + context menu own these. */}
      {!hostChrome && model && !paintMode && (
        <Row
          style={{
            position: 'absolute', left: 0, top: 34, right: 0, height: 40,
            alignItems: 'center', paddingLeft: 12, paddingRight: 12, gap: 6,
            backgroundColor: 'rgba(12,14,20,0.82)', borderBottomWidth: 1, borderColor: '#1d2330',
          }}
        >
          {SEL_MODES.map((label, m) => {
            const active = selMode === m && !focusMode;
            return (
              <Pressable
                key={label}
                onPress={() => chooseSelMode(m)}
                tooltip={m === 0 ? 'View / orbit' : `${label} select (${m})`}
                style={{
                  paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                  backgroundColor: active ? '#2a466e' : '#16233aee',
                  borderWidth: 1, borderColor: active ? '#5a86c0' : '#2c4a6a',
                }}
              >
                <Text style={{ color: active ? '#eaf2ff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>{label}</Text>
              </Pressable>
            );
          })}
          {selMode !== 0 && (
            <>
              <Box style={{ width: 1, height: 22, backgroundColor: '#2a3446', marginLeft: 4, marginRight: 4 }} />
              {GIZMO_TOOLS.map((label, t) => {
                const active = gizmoTool === t;
                const key = t === 0 ? 'G' : t === 1 ? 'S' : 'R';
                return (
                  <Pressable
                    key={label}
                    onPress={() => chooseGizmoTool(t)}
                    tooltip={`${label} gizmo (${key})`}
                    style={{
                      paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                      backgroundColor: active ? '#42305f' : '#16233aee',
                      borderWidth: 1, borderColor: active ? '#8a6ac0' : '#2c4a6a',
                    }}
                  >
                    <Text style={{ color: active ? '#f0eaff' : '#cfe0f5', fontSize: 12, fontWeight: 600 }}>{label}</Text>
                  </Pressable>
                );
              })}
              {selMode === 2 && selInfo.sel > 0 && (
                <>
                  <Box style={{ width: 1, height: 22, backgroundColor: '#2a3446', marginLeft: 4, marginRight: 4 }} />
                  {selInfo.sel === 1 && (
                    <Pressable
                      onPress={() => applyTopo(meshExtrudeEdge(model.radius * 0.08), 'Select exactly one edge to extrude')}
                      tooltip="Extrude selected edge"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Extrude</Text>
                    </Pressable>
                  )}
                  {selInfo.sel >= 2 && (
                    <Pressable
                      onPress={() => applyTopo(meshCreateFace(), 'Select two separate edges or a closed 3/4-edge loop')}
                      tooltip="Create face from selected edges"
                      style={{
                        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6,
                        backgroundColor: '#203a2fee', borderWidth: 1, borderColor: '#3d765c',
                      }}
                    >
                      <Text style={{ color: '#ddf5e8', fontSize: 12, fontWeight: 600 }}>Create Face</Text>
                    </Pressable>
                  )}
                </>
              )}
              <Box style={{ flexGrow: 1 }} />
              <Text style={{ color: '#7d899c', fontSize: 12, fontFamily: 'monospace' }}>
                {`${selInfo.sel} sel · ${selMode === 1 ? `${selInfo.verts} verts` : selMode === 2 ? `${selInfo.edges} edges` : `${(model.count / 3).toLocaleString()} faces`}`}
              </Text>
              <Pressable
                onPress={() => { meshClearSel(); setSelInfo(readSelInfo() ?? selInfo); }}
                tooltip="Clear selection (Esc)"
                style={{ marginLeft: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
              >
                <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600 }}>Clear</Text>
              </Pressable>
            </>
          )}
        </Row>
      )}

      {guard?.pending ? (
        <Col
          style={{
            position: 'absolute', left: 18, bottom: 62, width: 360,
            paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12,
            backgroundColor: 'rgba(17,20,29,0.96)', borderWidth: 1, borderColor: '#805f3c',
            borderRadius: 8,
          }}
        >
          <Text style={{ color: '#ffe1bf', fontSize: 13, fontWeight: 700 }}>Unsafe face edit</Text>
          <Text style={{ color: '#b9c4d4', fontSize: 12, marginTop: 6 }}>
            {`${guard.bad} triangle${guard.bad === 1 ? '' : 's'} collapsed or flipped. Keep the triangulated split, ignore it, or revert.`}
          </Text>
          <Row style={{ marginTop: 12, gap: 8 }}>
            <Pressable
              onPress={() => closeGuard(0)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#244164', borderWidth: 1, borderColor: '#4e75a4' }}
            >
              <Text style={{ color: '#e6f1ff', fontSize: 12, fontWeight: 700 }}>Split Quads</Text>
            </Pressable>
            <Pressable
              onPress={() => closeGuard(1)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#303747', borderWidth: 1, borderColor: '#566176' }}
            >
              <Text style={{ color: '#e1e7f1', fontSize: 12, fontWeight: 700 }}>Ignore</Text>
            </Pressable>
            <Pressable
              onPress={() => closeGuard(2)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#4a2729', borderWidth: 1, borderColor: '#8d4b50' }}
            >
              <Text style={{ color: '#ffe3e4', fontSize: 12, fontWeight: 700 }}>Revert</Text>
            </Pressable>
          </Row>
        </Col>
      ) : null}

      {/* Quality strip — commit-only decimation. Drag to trade detail for triangles; the
          host owns the thumb mid-drag and re-meshes from the retained full-res source ONCE
          on release (decimating every onChange frame melted the app). Lower end is "just the
          shape" for the game (and the basis for baked LoD by render distance).
          Suppressed under hostChrome: the editor tucks Quality into its context menu. */}
      {!hostChrome && model && (
        <Row
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 46,
            alignItems: 'center', paddingLeft: 14, paddingRight: 16,
            backgroundColor: 'rgba(12,14,20,0.82)', borderTopWidth: 1, borderColor: '#1d2330',
          }}
        >
          <Text style={{ color: '#cfe0f5', fontSize: 12, fontWeight: 600, marginRight: 12 }}>Quality</Text>
          <Box style={{ flexGrow: 1, marginRight: 14 }}>
            <Slider
              value={quality}
              min={0}
              max={1}
              onCommit={(v: number) => applyQuality(v)}
              style={{ height: 24 }}
            />
          </Box>
          <Text style={{ color: '#7d899c', fontSize: 12, fontFamily: 'monospace' }}>
            {`${(model.count / 3).toLocaleString()} tris`}
          </Text>
        </Row>
      )}

      {/* Attribution panel — the shared editor (same one the Studio will use). Keyed by
          the entry id so switching models re-seeds the fields. */}
      {attrOpen && attribution && (
        <AttributionPanel
          key={attribution.id}
          entry={attribution}
          onSave={saveAttribution}
          onExport={doExportCredits}
          onClose={() => setAttrOpen(false)}
        />
      )}

      {/* Center prompt until something is loaded. */}
      {!model && (
        <Col style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#9aa6ba', fontSize: 22, fontWeight: 600 }}>
            {error ? 'Model could not load' : initialPath || initialMesh ? `Loading ${initialTitle ?? initialMesh?.name ?? 'model'}` : 'Open a model to view'}
          </Text>
          <Text style={{ color: '#5d6878', fontSize: 14, marginTop: 8 }}>.glb · .obj — parsed and rendered entirely in the host</Text>
          {allowFilePicker ? (
            <>
              <Pressable
                onPress={chooseModel}
                style={{
                  marginTop: 22, paddingLeft: 22, paddingRight: 22, paddingTop: 11, paddingBottom: 11, borderRadius: 8,
                  backgroundColor: '#1d3a5fee', borderWidth: 1, borderColor: '#3a5f8a',
                }}
              >
                <Text style={{ color: '#e6f0fb', fontSize: 15, fontWeight: 600 }}>Choose a model…</Text>
              </Pressable>
              <Text style={{ color: '#465162', fontSize: 12, marginTop: 14 }}>…or drop a file anywhere</Text>
            </>
          ) : null}
          {error && <Text style={{ color: '#e2706a', fontSize: 13, marginTop: 16 }}>{error}</Text>}
        </Col>
      )}
    </Box>
  );
}
