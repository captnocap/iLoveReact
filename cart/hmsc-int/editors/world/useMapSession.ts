// editors/world/useMapSession.ts — the map persistence engine (SHELLFOLD-0611,
// review §2 seam 1). ONE concern with a small verb surface: the MapPayload
// schema, build/apply, the workspace autosave wiring, the undo snapshot
// hooks, open/new/rename/delete, and the view-sanity laws
// (VIEWRUNAWAY/MAPGONE). Everything the payload persists — the pane twigs,
// the placements array, per-cell overrides, the camera seeds — lives HERE so
// buildPayload/applyPayload close over their own state; verbs (placement
// CRUD, build commits) live in their own hooks and reach back through the
// refs this hook is handed.
//
// Boot reads ONE envelope (review §1: the shell used to parse the session
// file twice before first paint — view seed + legacy-piece probe each did
// their own read+parse; they now share a single boot read).

import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { readFile, writeFile, mkdir } from '@reactjit/hooks/fs';
import {
  useWorkspace,
  parseEnvelope,
  buildEnvelope,
  serializeEnvelope,
  sessionPathFor,
  sessionsDirFor,
  lastPointerPath,
  type SessionEnvelope,
} from '@reactjit/workspace';
import type { TileKind } from '../../design';
import { PAINTABLE_TILE_KINDS, isTileKind } from '../../world/tileKinds';
import { type ChunkFloor, floorsFromEditorWorld } from '../../chunkFloor';
import type { PreviewCamera, PreviewCameraApi } from '../../IsoPreview';
import type { Tool, Layer, PaintCanvasApi, BrushSettings, CanvasView2D } from '../../PaintCanvas';
import type { PainterChannels } from '../../TargetDock';
import type { TabId } from '../../RightPanel';
import type { Placement } from '../../placements';
import { serializeMap, deserializeMap, emptyMap, hasAuthoredMapContent, paintedCenter, isSaneView2d, viewRunawayLogKey, type MapSnapshot, type EditorWorld } from '../../mapStore';
import { listMaps, uniqueMapName, sanitizeMapName, mapExists, deleteMap } from '../../projects';
import { TILE_UNITS, HEIGHT_LIMIT } from '../../heightData';
import {
  cellKey, serializeOverrides, deserializeOverrides,
  type SelCell, type OverrideStore, type OverrideValue, type OverrideSnap,
} from '../../tileOverrides';
import { ptime } from '../../perfLog';
import type { EditNote } from '../../editLog';
import type { PlacedBuildPiece } from '../../game';

const CART = 'hmsc-int';
// v2: the payload gained `world`. v1 (view-only) files cleanly fail to parse and
// boot blank — those had no world to lose.
const VERSION = 2;
const MIN_FRAC = 0.06; // never collapse a pane fully — keep a grabbable sliver

// The persisted state of ONE map: the editor view + the authored world.
export interface MapPayload {
  fx: number;
  fy: number;
  yaw: number;
  tool: Tool;
  tile: TileKind;
  layer: Layer;
  tab: TabId;
  notes: string;
  showGrid: boolean;
  world: MapSnapshot;
  // Per-quad view state — the "little things" that should survive an update, not
  // just the world. All optional so older v2 files (without them) still parse.
  sel?: string | null;                 // the in-focus placement id (place layer)
  wasd?: 'canvas' | 'preview';         // which bottom quad owns the WASD keys
  cam?: PreviewCamera;                 // the 3D preview's free-fly pose
  overrides?: OverrideSnap[];          // per-cell property overrides (patch on kind)
  brush?: BrushSettings;               // paint/zone/height brush controls
  view2d?: CanvasView2D;               // the 2D canvas camera (MAPGONE2-0605:
                                       // unrestored, every remount snapped the
                                       // viewport to the lattice origin)
  channels?: PainterChannels;          // painter channel visibility (PAINTER-0610);
                                       // absent key = visible, absent field = all on
  pieces?: PlacedBuildPiece[];         // this map's build pieces AS OF the snapshot —
                                       // carried so Ctrl+Z reverts building edits;
                                       // only read on a 'history' apply (undo/redo),
                                       // inert on restore (the live worldStream wins)
}

function clampFrac(f: number): number {
  return Math.max(MIN_FRAC, Math.min(1 - MIN_FRAC, f));
}

const DEFAULT_BRUSH: BrushSettings = {
  size: 2,
  mode: 'paint',
  centerZ: 3,
  profile: 'cone',
  shape: 'circle',
  heightMode: 'brush',
  rampMin: 0,
  rampMax: 6,
  rampWide: 4,
  rampLong: 12,
  rampAngle: 0,
  smoothStrength: 0.45,
};

const DEFAULT_PAINT_TILE: TileKind = 'sidewalk';

function normalizePaintTile(value: unknown): TileKind {
  return typeof value === 'string'
    && isTileKind(value)
    && value !== 'water'
    && PAINTABLE_TILE_KINDS.includes(value)
    ? value
    : DEFAULT_PAINT_TILE;
}

function clampNum(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export function normalizeBrushSettings(value: Partial<BrushSettings> | undefined): BrushSettings {
  const v: any = value ?? {};
  const profile = v.profile ?? v.heightProfile;
  const shape = v.shape ?? v.heightShape;
  const legacyMode = v.heightTool === 'erase' ? 'erase' : undefined;
  return {
    size: Math.round(clampNum(v.size, 0, 40, DEFAULT_BRUSH.size)),
    mode: v.mode === 'erase' || legacyMode === 'erase' ? 'erase' : DEFAULT_BRUSH.mode,
    centerZ: clampNum(v.centerZ, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.centerZ),
    profile: profile === 'flat' || profile === 'dome' ? profile : DEFAULT_BRUSH.profile,
    shape: shape === 'square' || shape === 'diamond' ? shape : DEFAULT_BRUSH.shape,
    heightMode: v.heightMode === 'ramp' || v.heightMode === 'slope' || v.heightMode === 'smooth' ? v.heightMode : DEFAULT_BRUSH.heightMode,
    rampMin: clampNum(v.rampMin, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.rampMin),
    rampMax: clampNum(v.rampMax, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.rampMax),
    rampWide: clampNum(v.rampWide, 1, 120, DEFAULT_BRUSH.rampWide),
    rampLong: clampNum(v.rampLong, 1, 120, DEFAULT_BRUSH.rampLong),
    rampAngle: clampNum(v.rampAngle, 0, 359, DEFAULT_BRUSH.rampAngle),
    smoothStrength: clampNum(v.smoothStrength, 0.05, 1, DEFAULT_BRUSH.smoothStrength),
  };
}

function readInitialMapStem(): string | null {
  try {
    const stem = readFile(lastPointerPath(CART))?.trim();
    return stem && stem.length > 0 ? stem : null;
  } catch {
    return null;
  }
}

// ONE synchronous boot read: the last-open map's VIEW (seeds initial pane
// fractions so the divider never flashes to centre on mount) AND the
// legacy-piece-map probe off the same parsed payload. The WORLD is seeded by
// the workspace restore (applyPayload, which remounts PaintCanvas with the
// decoded map).
function readBoot(): { view: Partial<MapPayload>; legacyPieceMapName: string | null } {
  try {
    const stem = readInitialMapStem();
    if (!stem) return { view: {}, legacyPieceMapName: null };
    const text = readFile(sessionPathFor(CART, stem));
    if (!text) return { view: {}, legacyPieceMapName: null };
    const env = parseEnvelope<MapPayload>(text, { cartName: CART, version: VERSION });
    const view = env?.payload ?? {};
    let legacyPieceMapName: string | null = null;
    if (view.world) {
      try {
        legacyPieceMapName = hasAuthoredMapContent(deserializeMap(view.world)) ? stem : null;
      } catch {
        legacyPieceMapName = null;
      }
    }
    return { view, legacyPieceMapName };
  } catch {
    return { view: {}, legacyPieceMapName: null };
  }
}

// Highest pl_<n> in a placement list — so a restored map's next placement id
// doesn't collide with the ones it loaded.
function maxPlacementSeq(placements: Placement[]): number {
  return placements.reduce((mx, p) => {
    const n = Number(/^pl_(\d+)$/.exec(p.id)?.[1] ?? 0);
    return n > mx ? n : mx;
  }, 0);
}

export function useMapSession(opts: {
  /** STABLE — the shell's floors setter; applyPayload restores floors through it */
  onFloorsRestored: (floors: ChunkFloor[]) => void;
  /** STABLE wrapper — semantic event log (worldSession.note + the chrome trace) */
  log: (note: EditNote) => void;
  /** fed each render by useBuildUndo so buildPayload snapshots the live pieces */
  buildPiecesRef: MutableRefObject<PlacedBuildPiece[]>;
  /** filled each render by useBuildUndo; applyPayload reverts build edits through it */
  reconcileBuildUndoRef: MutableRefObject<(target: PlacedBuildPiece[] | undefined, reason?: 'restore' | 'history') => void>;
}) {
  const { onFloorsRestored, log, buildPiecesRef, reconcileBuildUndoRef } = opts;

  // Seed view state from disk once (lazy initializer → runs only on mount).
  const [boot] = useState(readBoot);
  const initial = boot.view;
  const [fx, setFx] = useState(() => initial.fx ?? 0.5);
  const [fy, setFy] = useState(() => initial.fy ?? 0.5);
  const [yaw, setYaw] = useState(() => initial.yaw ?? 45);
  const [tool, setTool] = useState<Tool>(() => initial.tool ?? 'pointer');
  const [tile, setTile] = useState<TileKind>(() => normalizePaintTile(initial.tile));
  const [layer, setLayer] = useState<Layer>(() => initial.layer ?? 'paint');
  // Channel visibility (PAINTER-0610): which inactive painter channels stay
  // visible as dim landmarks. Absent key = visible; persisted per map.
  const [channels, setChannels] = useState<PainterChannels>(() => initial.channels ?? {});
  const toggleChannel = useCallback((l: Layer) => setChannels((c) => ({ ...c, [l]: c[l] === false })), []);
  const [tab, setTab] = useState<TabId>(() => initial.tab ?? 'objects');
  const [notes, setNotes] = useState<string>(() => initial.notes ?? '');
  const [showGrid, setShowGrid] = useState<boolean>(() => initial.showGrid ?? true);
  const [brush, setBrush] = useState<BrushSettings>(() => normalizeBrushSettings(initial.brush));
  const brushRef = useRef(brush);
  brushRef.current = brush;
  // Which bottom quad owns the WASD keys. Both the 2D canvas and the 3D preview use
  // WASD, so exactly one is "focused" at a time — claimed by a CLICK in that quad
  // (not hover), so the cursor wandering across the divider can't steal an
  // in-progress fly/pan. Default to the canvas (the primary editing surface).
  const [wasdQuad, setWasdQuad] = useState<'canvas' | 'preview'>(() => initial.wasd ?? 'canvas');
  const focusCanvas = useCallback(() => setWasdQuad('canvas'), []);
  const focusPreview = useCallback(() => setWasdQuad('preview'), []);

  // ── The authored world ───────────────────────────────────────────────────────
  // The chunk buffers live INSIDE PaintCanvas (the de-thrashed paint path); the cart
  // reaches them through paintApiRef to serialize, and seeds a freshly-opened map
  // through `seedWorld` + a remount (worldEpoch in the PaintCanvas key). Placements
  // live here (they drive the preview). worldRev bumps once per stroke / structural
  // edit (PaintCanvas.onEdit) to trip the debounced autosave.
  const paintApiRef = useRef<PaintCanvasApi | null>(null);
  const [seedWorld, setSeedWorld] = useState<EditorWorld | null>(null);
  // The 2D canvas camera the next PaintCanvas mount opens at: the map's saved
  // view, or (older files) the painted-content centre — never the bare lattice
  // origin on a non-empty map (MAPGONE2-0605: that read as "the map vanished"
  // whenever the origin chunk is featureless at default zoom).
  const [seedView, setSeedView] = useState<CanvasView2D | null>(null);
  const lastViewRunawayWarn = useRef<string | null>(null);
  const [worldEpoch, setWorldEpoch] = useState(0);
  const [worldRev, setWorldRev] = useState(0);
  const bumpWorldRev = useCallback(() => setWorldRev((r) => r + 1), []);

  // The 3D preview camera persists too (per map). camApiRef pulls the live pose for
  // serialize; seedCam seeds the pane on mount/open; viewRev bumps when the camera
  // settles (or focus/selection changes) to trip the same debounced autosave.
  const camApiRef = useRef<PreviewCameraApi | null>(null);
  const [seedCam, setSeedCam] = useState<PreviewCamera | null>(() => initial.cam ?? null);
  const [viewRev, setViewRev] = useState(0);
  const bumpViewRev = useCallback(() => setViewRev((r) => r + 1), []);

  const placeSeq = useRef(0);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selPlaceId, setSelPlaceId] = useState<string | null>(() => initial.sel ?? null);
  const [selBuildId, setSelBuildId] = useState<string | null>(null);

  // ── Tile selection + per-cell overrides ──────────────────────────────────────
  // selCells = the group in focus (pointer-tool clicks in the canvas; ctrl-click to
  // add). overrides = a flat store keyed by global cell → { dotted-path → value },
  // patched on top of each cell's kind (the kind never changes). Both cart-owned so
  // the top-left panel can read the selection and edit the whole group at once.
  const [selCells, setSelCells] = useState<SelCell[]>([]);
  const [overrides, setOverrides] = useState<OverrideStore>(() => new Map());
  const tileSelect = useMemo(() => ({
    cells: selCells,
    set: (c: SelCell) => setSelCells([c]),
    toggle: (c: SelCell) => setSelCells((prev) => {
      const k = cellKey(c.gx, c.gz);
      return prev.some((p) => cellKey(p.gx, p.gz) === k) ? prev.filter((p) => cellKey(p.gx, p.gz) !== k) : [...prev, c];
    }),
    clear: () => setSelCells([]),
  }), [selCells]);
  // Edit one property across EVERY selected cell at once (the bulk override).
  const applyOverride = useCallback((path: string, value: OverrideValue) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const c of selCells) {
        const k = cellKey(c.gx, c.gz);
        next.set(k, { ...(next.get(k) ?? {}), [path]: value });
      }
      return next;
    });
    setWorldRev((r) => r + 1); // trip autosave
  }, [selCells]);
  const clearOverride = useCallback((path: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const c of selCells) {
        const k = cellKey(c.gx, c.gz);
        const o = next.get(k); if (!o || !(path in o)) continue;
        const rest = { ...o }; delete rest[path];
        if (Object.keys(rest).length) next.set(k, rest); else next.delete(k);
      }
      return next;
    });
    setWorldRev((r) => r + 1);
  }, [selCells]);

  // ── Persistence: build / apply the whole map payload ──────────────────────────
  const buildPayload = useCallback((): MapPayload | null => {
    const api = paintApiRef.current;
    if (!api) return null; // canvas not mounted yet — skip this autosave tick
    const w = api.getWorld();
    const world = ptime('autosave', `serializeMap chunks=${w.chunks.size}`, () => serializeMap({ chunks: w.chunks, zones: w.zones, focus: w.focus, placements, roads: w.roads, roadUnder: w.roadUnder, intersectionControls: w.intersectionControls, intersectionOverrides: w.intersectionOverrides }));
    // VIEWRUNAWAY-0605 write-side invariant: an autosaved view always passes
    // the sanity law — a camera that ran away (or read degenerate) is OMITTED
    // (the restore's painted-centre fallback then reframes, and the next sane
    // sample resumes persisting).
    const liveView = api.getView();
    const view2d = liveView && isSaneView2d(liveView, { chunks: w.chunks, zones: w.zones, focus: w.focus, placements }, TILE_UNITS) ? liveView : undefined;
    if (liveView && !view2d) {
      const key = viewRunawayLogKey(liveView);
      if (lastViewRunawayWarn.current !== key) {
        lastViewRunawayWarn.current = key;
        console.warn(`[viewrunaway] NOT persisting insane live view ${key}`);
      }
    } else if (view2d) {
      lastViewRunawayWarn.current = null;
    }
    return { fx, fy, yaw, tool, tile, layer, channels, tab, notes, showGrid, world, sel: selPlaceId, wasd: wasdQuad, cam: camApiRef.current?.get(), overrides: serializeOverrides(overrides), brush: brushRef.current, view2d, pieces: buildPiecesRef.current };
  }, [fx, fy, yaw, tool, tile, layer, channels, tab, notes, showGrid, placements, selPlaceId, wasdQuad, overrides]);

  const applyPayload = useCallback((env: SessionEnvelope<MapPayload>, reason?: 'restore' | 'history') => {
    const p = env.payload;
    const applyTwig = reason !== 'history';
    if (applyTwig && typeof p.fx === 'number') setFx(p.fx);
    if (applyTwig && typeof p.fy === 'number') setFy(p.fy);
    if (applyTwig && typeof p.yaw === 'number') setYaw(p.yaw);
    if (applyTwig && p.tool) setTool(p.tool);
    if (applyTwig) setTile(normalizePaintTile(p.tile));
    if (applyTwig && p.layer) setLayer(p.layer);
    if (applyTwig) setChannels(p.channels ?? {});
    // SET tab retired (SETFOLD-0610): old payloads may still say 'settings'.
    if (applyTwig && p.tab) setTab((p.tab as string) === 'settings' ? 'objects' : p.tab);
    if (typeof p.notes === 'string') setNotes(p.notes);
    if (applyTwig && typeof p.showGrid === 'boolean') setShowGrid(p.showGrid);
    // Decode the world and remount PaintCanvas onto it.
    const w = p.world ? deserializeMap(p.world) : emptyMap();
    // [mapgone-probe MAPGONE2-0605] boot-path count — stays until the user confirms
    {
      let painted = 0;
      for (const c of w.chunks.values()) for (let i = 0; i < c.tiles.idx.length; i++) if (c.tiles.idx[i] >= 0) painted++;
      console.warn(`[mapgone] applyPayload: world=${p.world ? 'present' : 'MISSING'} chunks=${w.chunks.size} focus=${w.focus.size} painted=${painted} placements=${w.placements.length}`);
    }
    const restoredFloors = floorsFromEditorWorld(w);
    console.warn(`[mapgone] applyPayload floors: restored=${restoredFloors.length} source=payload`);
    onFloorsRestored(restoredFloors);
    placeSeq.current = Math.max(placeSeq.current, maxPlacementSeq(w.placements));
    setPlacements(w.placements);
    if (applyTwig) setSelPlaceId(p.sel ?? null);
    if (applyTwig) setSelBuildId(null);
    if (applyTwig && p.wasd) setWasdQuad(p.wasd);
    if (applyTwig) setSeedCam(p.cam ?? null);
    setOverrides(deserializeOverrides(p.overrides));
    if (applyTwig) setBrush(normalizeBrushSettings(p.brush));
    if (applyTwig) setSelCells([]); // selection is transient — never carries across a map switch
    // The 2D camera: the saved view, else centre on the painted content (an
    // older file or a pre-fix save) — never the bare lattice origin on a
    // non-empty map (MAPGONE2-0605).
    // VIEWRUNAWAY-0605: a saved view must pass the sanity law (finite, sane
    // zoom, centre within the painted bounds + margin) or it is REJECTED —
    // logged, paintedCenter fallback, and the next autosave overwrites the
    // poisoned value (self-healing; the files are never rewritten here).
    const savedSane = isSaneView2d(p.view2d, w, TILE_UNITS);
    if (p.view2d && !savedSane) {
      console.warn(`[viewrunaway] REJECTED saved view2d ${p.view2d.x.toFixed(0)},${p.view2d.y.toFixed(0)}@${p.view2d.zoom.toFixed(2)} — outside the sanity law; falling back to painted centre`);
    }
    const restoredView = savedSane
      ? p.view2d!
      : (() => {
          const center = paintedCenter(w, TILE_UNITS);
          return center ? { x: center.gx, y: center.gy, zoom: 1 } : null;
        })();
    if (applyTwig) setSeedView(restoredView);
    console.warn(`[mapgone] applyPayload: view2d=${p.view2d ? (savedSane ? 'saved' : 'saved-INSANE') : 'absent'} → seedView=${applyTwig && restoredView ? `${restoredView.x.toFixed(0)},${restoredView.y.toFixed(0)}@${restoredView.zoom.toFixed(2)}` : applyTwig ? 'host default' : 'preserved (history apply)'}`);
    setSeedWorld(w);
    setWorldEpoch((e) => e + 1);
    // Build pieces ride the worldStream, not the map payload — so an undo/redo (history)
    // reverts them by appending the compensating place/remove events to reach the
    // snapshot's piece set. Only on 'history'; a restore/map-switch leaves the live
    // stream alone. (No-op until useBuildUndo fills the ref this render.)
    reconcileBuildUndoRef.current(p.pieces, reason);
  }, []);

  const ws = useWorkspace<MapPayload>({
    cartName: CART,
    version: VERSION,
    buildPayload,
    applyPayload,
    deps: [fx, fy, yaw, tool, tile, layer, channels, tab, notes, showGrid, placements, worldRev, selPlaceId, wasdQuad, viewRev, overrides, brush],
  });

  // Undo history: snapshot the PRE-edit state at the START of each undoable action
  // (stroke begin via onEditBegin, placement actions). ws identity changes
  // each render, so route through a ref to keep the handlers (and the memoized
  // canvas's props) stable. undo/redo replay via applyPayload — they don't start
  // actions, so they never record spurious steps. ctrl+z/ctrl+y are already bound.
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const snapshotForUndo = useCallback(() => wsRef.current.commit(), []);
  const snapshotForUndoCoalesced = useCallback(() => wsRef.current.commitCoalesced(), []);

  // ── Multi-map management (the project manager surface is the chrome strip) ────
  const [maps, setMaps] = useState<string[]>(() => listMaps());
  const refreshMaps = useCallback(() => setMaps(listMaps()), []);

  // Write a map file directly (used by new / rename so the file exists immediately,
  // not only after the autosave debounce). Mirrors the workspace flush.
  const writeMapFile = useCallback((stem: string, payload: MapPayload) => {
    mkdir(sessionsDirFor(CART));
    const env = buildEnvelope({ cartName: CART, version: VERSION, stem, payload });
    writeFile(sessionPathFor(CART, stem), serializeEnvelope(env));
    writeFile(lastPointerPath(CART), stem);
  }, []);

  // Flush the CURRENT map to disk synchronously. Called before switching away so a
  // stroke painted within the autosave debounce window isn't lost when the timer
  // gets rescheduled onto the next map.
  const flushCurrent = useCallback(() => {
    const p = buildPayload();
    if (p) writeMapFile(ws.stem, p);
  }, [buildPayload, writeMapFile, ws]);

  const updateBrush = useCallback((patch: Partial<BrushSettings>) => {
    const next = normalizeBrushSettings({ ...brushRef.current, ...patch });
    brushRef.current = next;
    setBrush(next);
    setViewRev((r) => r + 1);
    const payload = buildPayload();
    if (payload) writeMapFile(ws.stem, payload);
  }, [buildPayload, writeMapFile, ws.stem]);

  const openMap = useCallback((name: string) => {
    if (name === ws.stem) return;
    const text = readFile(sessionPathFor(CART, name));
    if (!text) return;
    const env = parseEnvelope<MapPayload>(text, { cartName: CART, version: VERSION });
    if (!env) return;
    flushCurrent(); // don't lose the current map's just-painted edits
    applyPayload(env);
    ws.setStem(name);
    ws.history.clear();
    writeFile(lastPointerPath(CART), name);
    refreshMaps();
    log({ cat: 'map', text: `opened ${name}` });
  }, [ws, applyPayload, refreshMaps, flushCurrent, log]);

  const newMap = useCallback(() => {
    flushCurrent(); // don't lose the current map's just-painted edits
    const name = uniqueMapName('untitled');
    const fresh = emptyMap();
    const payload: MapPayload = { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, brush, world: serializeMap(fresh) };
    writeMapFile(name, payload);
    placeSeq.current = 0;
    setPlacements([]);
    onFloorsRestored(floorsFromEditorWorld(fresh));
    setSelPlaceId(null);
    setSelBuildId(null);
    setSeedWorld(fresh);
    setWorldEpoch((e) => e + 1);
    ws.setStem(name);
    ws.history.clear();
    refreshMaps();
    log({ cat: 'map', text: `new map ${name}` });
  }, [ws, fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, brush, writeMapFile, refreshMaps, flushCurrent, log, onFloorsRestored]);

  const renameMap = useCallback((rawNext: string) => {
    const old = ws.stem;
    const next = sanitizeMapName(rawNext);
    if (!next || next === old) return;
    const finalName = mapExists(next) ? uniqueMapName(next) : next;
    const payload = buildPayload();
    if (payload) writeMapFile(finalName, payload);
    ws.setStem(finalName);
    if (old !== finalName) deleteMap(old);
    refreshMaps();
    log({ cat: 'map', text: `renamed → ${finalName}` });
  }, [ws, buildPayload, writeMapFile, refreshMaps, log]);

  const deleteMapAndAdvance = useCallback((name: string) => {
    deleteMap(name);
    log({ cat: 'map', text: `deleted ${name}` });
    if (name === ws.stem) {
      const remaining = listMaps().filter((m) => m !== name);
      if (remaining.length) openMap(remaining[0]);
      else newMap();
    } else {
      refreshMaps();
    }
  }, [ws, openMap, newMap, refreshMaps, log]);

  // The current map always shows in the switcher even before its file lands on disk.
  const displayMaps = maps.includes(ws.stem) ? maps : [...maps, ws.stem].sort();

  // Divider drags arrive as per-event fraction deltas; accumulate + clamp here.
  const onResize = useCallback((axis: 'col' | 'row', d: number) => {
    if (axis === 'col') setFx((f) => clampFrac(f + d));
    else setFy((f) => clampFrac(f + d));
  }, []);
  const resetLayout = useCallback(() => { setFx(0.5); setFy(0.5); }, []);

  return {
    // workspace + persistence
    ws, snapshotForUndo, snapshotForUndoCoalesced, flushCurrent,
    legacyPieceMapName: boot.legacyPieceMapName,
    // map verbs + roster
    maps, displayMaps, refreshMaps, openMap, newMap, renameMap, deleteMapAndAdvance,
    // pane layout
    fx, fy, onResize, resetLayout,
    // per-map twigs
    tool, setTool, tile, setTile, layer, setLayer, channels, toggleChannel,
    tab, setTab, notes, setNotes, showGrid, setShowGrid, brush, updateBrush,
    wasdQuad, focusCanvas, focusPreview,
    // placement STATE (verbs live in usePlacements)
    placements, setPlacements, placeSeq, selPlaceId, setSelPlaceId, selBuildId, setSelBuildId,
    // tile selection + overrides
    overrides, selCells, tileSelect, applyOverride, clearOverride,
    // seeds + revision ticks
    seedWorld, seedView, seedCam, worldEpoch, worldRev, viewRev, bumpWorldRev, bumpViewRev,
    // live-surface reach (serialize pulls through these)
    paintApiRef, camApiRef,
  };
}
