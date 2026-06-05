import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from '@reactjit/primitives';
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
import type { Building, BuildingFaceRole, BuildingSkin, GameState } from '../hmsc/design';
import { applyFaceSkin } from './buildingEditor';
import { compileEditorWorld, emptyEditorWorld, placeBuilding, placeMarker, placeWorldProp } from './editorWorld';
import { cellCenterToWorld, cellKey as gridCellKey } from '../hmsc/world/grid';
import { type ChunkFloor, floorsToLandforms } from './chunkFloor';
import { IsoPreview, type PreviewCamera, type PreviewCameraApi } from './IsoPreview';
import { QuadSplit } from './QuadSplit';
import { PaintCanvas, type Tool, type Layer, type PaintCanvasApi, type BrushSettings } from './PaintCanvas';
import { PropertiesPanel, type Focus } from './PropertiesPanel';
import { RightPanel, type TabId } from './RightPanel';
import { placementCellRect, resolvePlaceable, type Placement, type PlaceCat } from './placements';
import { buildObjectWorld } from './objectPreview';
import { useKindTextures, kindTexturesFor } from './kindTextures';
import { serializeMap, deserializeMap, emptyMap, type MapSnapshot, type EditorWorld } from './mapStore';
import { ProjectBar, MapsMenu, EventLog } from './ProjectBar';
import { loadEvents, saveEvents, type EditNote, type EditEvent } from './editLog';
import { listMaps, uniqueMapName, sanitizeMapName, mapExists, deleteMap } from './projects';
import { TILE_UNITS, HEIGHT_LIMIT } from './heightData';
import { CHUNK_TILES } from './chunks';
import type { TileKind } from '../hmsc/design';
import {
  cellKey, serializeOverrides, deserializeOverrides,
  type SelCell, type OverrideStore, type OverrideValue, type OverrideSnap,
} from './tileOverrides';
import { plog, ptime, useChurn } from './perfLog';
import { Router, Route, useNavigate, useRoute } from '@reactjit/router';
import { LogView } from './LogView';
import { Assist3DRoute } from './assist3d';
import { TextureStudio } from './TextureStudio';
import { TestRoute } from './TestRoute';
import { VoxelHybridRoute } from './VoxelHybridRoute';
import { LabsRoute } from './shell/LabsRoute';
import { LABS } from './labs';
import { CharactersRoute } from './editors/characters/CharactersRoute';
import { VehiclesRoute } from './editors/vehicles/VehiclesRoute';

// hmsc-int is a multi-map WORKSPACE (the city, every building interior, ...), not
// one world — see memory project_hmsc_int_multimap_workspace. A persistent shell
// (the ProjectBar) manages the SET of maps; below it the editor is a 2x2 pane grid:
//
//   ┌──────────┬──────────┐
//   │ in-focus │  right    │   top row — properties + tabbed rail
//   ├──────────┼──────────┤
//   │  canvas  │  preview  │   bottom row — 2D paint canvas + live iso-3D
//   └──────────┴──────────┘
//
// Each map is its own session file (cart/hmsc-int/sessions/<name>.session.json) via
// the workspace layer's "disk = truth" pattern: the CURRENT map autosaves (debounced)
// on every edit and restores on mount, so iterating the UI (hot reload) no longer
// wipes the painted world. The payload carries the WORLD (chunks + heights + zones +
// placements) alongside the view; the world is a thin set of REFERENCES into the
// shared global registries (tile kinds, objects), never copies — change a global and
// every map follows (see mapStore.ts).

const CART = 'hmsc-int';
// v2: the payload gained `world`. v1 (view-only) files cleanly fail to parse and
// boot blank — those had no world to lose.
const VERSION = 2;
const MIN_FRAC = 0.06; // never collapse a pane fully — keep a grabbable sliver

// The persisted state of ONE map: the editor view + the authored world.
interface MapPayload {
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
};

function clampNum(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function normalizeBrushSettings(value: Partial<BrushSettings> | undefined): BrushSettings {
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
    heightMode: v.heightMode === 'ramp' ? 'ramp' : DEFAULT_BRUSH.heightMode,
    rampMin: clampNum(v.rampMin, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.rampMin),
    rampMax: clampNum(v.rampMax, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.rampMax),
    rampWide: clampNum(v.rampWide, 1, 120, DEFAULT_BRUSH.rampWide),
    rampLong: clampNum(v.rampLong, 1, 120, DEFAULT_BRUSH.rampLong),
    rampAngle: clampNum(v.rampAngle, 0, 359, DEFAULT_BRUSH.rampAngle),
  };
}

// Synchronous read of the last-open map's VIEW, to seed initial pane fractions so
// the divider never flashes to centre on mount. The WORLD is seeded by the
// workspace restore (applyPayload, which remounts PaintCanvas with the decoded map).
function readInitialView(): Partial<MapPayload> {
  try {
    const stem = readFile(lastPointerPath(CART))?.trim();
    if (!stem) return {};
    const text = readFile(sessionPathFor(CART, stem));
    if (!text) return {};
    const env = parseEnvelope<MapPayload>(text, { cartName: CART, version: VERSION });
    return env?.payload ?? {};
  } catch {
    return {};
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

// A labeled empty pane so each quadrant is visible/identifiable while we build out.
function Pane(props: { label: string; children?: React.ReactNode }) {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1320', position: 'relative' }}>
      {props.children}
      <Text fontSize={9} color="#3a4a63" style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 6 }}>{props.label}</Text>
    </Box>
  );
}

// Memoized so a per-stroke autosave bump in the cart (worldRev) doesn't re-render
// the heavy canvas — its props are stable between strokes; it remounts only when
// the map key changes (open / new).
const MemoPaintCanvas = memo(PaintCanvas);

// The cart's router: the editor at "/", the in-app churn-log viewer at "/log",
// and the assistant-authored 3D route at "/assist3d". `hotKey` persists the
// active route across hot reloads. The editor stays MOUNTED below the persistent
// ProjectBar shell while route surfaces overlay the shell body.
export default function HmscWorldEditorCart() {
  return (
    <Router hotKey="hmsc-int:route" initialPath="/">
      <EditorShell />
    </Router>
  );
}

function EditorShell() {
  // The 3D preview world. baseWorld is the empty editor GameState (built once);
  // floors (the painted tile/height per chunk) are mirrored from PaintCanvas and
  // drive the preview's floor MESHES directly (not surfaceRegions). previewWorld
  // is baseWorld + the placements applied as real buildings/props (below), so
  // WorldStatics draws them — it only rebuilds when placements change, not on paint.
  const baseWorld = useMemo(emptyEditorWorld, []);
  const [floors, setFloors] = useState<ChunkFloor[]>([]);
  // Churn probe: PaintCanvas mirrors the focused chunks here (throttled). Each call
  // re-renders the whole cart AND rebuilds previewWorld — so log every one.
  const onFloors = useCallback((f: ChunkFloor[]) => {
    plog('floors', `setFloors n=${f.length} chunks=[${f.map((x) => `${x.cx},${x.cz}:h${x.hver}`).join(' ')}]`);
    setFloors(f);
  }, []);

  // Seed view state from disk once (lazy initializer → runs only on mount).
  const [initial] = useState(readInitialView);
  const [fx, setFx] = useState(() => initial.fx ?? 0.5);
  const [fy, setFy] = useState(() => initial.fy ?? 0.5);
  const [yaw, setYaw] = useState(() => initial.yaw ?? 45);
  const [tool, setTool] = useState<Tool>(() => initial.tool ?? 'pointer');
  const [tile, setTile] = useState<TileKind>(() => initial.tile ?? 'sidewalk');
  const [layer, setLayer] = useState<Layer>(() => initial.layer ?? 'paint');
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
  const [worldEpoch, setWorldEpoch] = useState(0);
  const [worldRev, setWorldRev] = useState(0);

  // The 3D preview camera persists too (per map). camApiRef pulls the live pose for
  // serialize; seedCam seeds the pane on mount/open; viewRev bumps when the camera
  // settles (or focus/selection changes) to trip the same debounced autosave.
  const camApiRef = useRef<PreviewCameraApi | null>(null);
  const [seedCam, setSeedCam] = useState<PreviewCamera | null>(() => initial.cam ?? null);
  const [viewRev, setViewRev] = useState(0);

  const placeSeq = useRef(0);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selPlaceId, setSelPlaceId] = useState<string | null>(() => initial.sel ?? null);
  const [activePlaceable, setActivePlaceable] = useState<{ cat: PlaceCat; kind: string; label: string; color: string; footW: number; footD: number; rotation: number } | null>(null);

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
    const world = ptime('autosave', `serializeMap chunks=${w.chunks.size}`, () => serializeMap({ chunks: w.chunks, zones: w.zones, focus: w.focus, placements }));
    return { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, world, sel: selPlaceId, wasd: wasdQuad, cam: camApiRef.current?.get(), overrides: serializeOverrides(overrides), brush: brushRef.current };
  }, [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, placements, selPlaceId, wasdQuad, overrides]);

  const applyPayload = useCallback((env: SessionEnvelope<MapPayload>) => {
    const p = env.payload;
    if (typeof p.fx === 'number') setFx(p.fx);
    if (typeof p.fy === 'number') setFy(p.fy);
    if (typeof p.yaw === 'number') setYaw(p.yaw);
    if (p.tool) setTool(p.tool);
    if (p.tile) setTile(p.tile);
    if (p.layer) setLayer(p.layer);
    if (p.tab) setTab(p.tab);
    if (typeof p.notes === 'string') setNotes(p.notes);
    if (typeof p.showGrid === 'boolean') setShowGrid(p.showGrid);
    // Decode the world and remount PaintCanvas onto it.
    const w = p.world ? deserializeMap(p.world) : emptyMap();
    placeSeq.current = Math.max(placeSeq.current, maxPlacementSeq(w.placements));
    setPlacements(w.placements);
    setSelPlaceId(p.sel ?? null);
    if (p.wasd) setWasdQuad(p.wasd);
    setSeedCam(p.cam ?? null);
    setOverrides(deserializeOverrides(p.overrides));
    setBrush(normalizeBrushSettings(p.brush));
    setSelCells([]); // selection is transient — never carries across a map switch
    setSeedWorld(w);
    setWorldEpoch((e) => e + 1);
  }, []);

  const ws = useWorkspace<MapPayload>({
    cartName: CART,
    version: VERSION,
    buildPayload,
    applyPayload,
    deps: [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, placements, worldRev, selPlaceId, wasdQuad, viewRev, overrides, brush],
  });

  // Undo history: snapshot the PRE-edit state at the START of each undoable action
  // (stroke begin via onEditBegin, placement actions below). ws identity changes
  // each render, so route through a ref to keep the handlers (and the memoized
  // canvas's props) stable. undo/redo replay via applyPayload — they don't start
  // actions, so they never record spurious steps. ctrl+z/ctrl+y are already bound.
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const snapshotForUndo = useCallback(() => wsRef.current.commit(), []);
  const snapshotForUndoCoalesced = useCallback(() => wsRef.current.commitCoalesced(), []);

  // ── Multi-map management (the project manager surface is ProjectBar) ──────────
  const [maps, setMaps] = useState<string[]>(() => listMaps());
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const refreshMaps = useCallback(() => setMaps(listMaps()), []);
  // The two toolbar popovers are mutually exclusive; opening one closes the other.
  const toggleMenu = useCallback(() => { setMenuOpen((o) => !o); setLogOpen(false); }, []);
  const toggleLog = useCallback(() => { setLogOpen((o) => !o); setMenuOpen(false); }, []);
  // Refresh the map list from disk whenever the menu opens (a sibling session may
  // have added/removed a map).
  useEffect(() => { if (menuOpen) setMaps(listMaps()); }, [menuOpen]);

  // ── Event-log trace (the categorized eventbus shown in the ProjectBar popover) ──
  // A stream of WHAT happened (tile painted, object moved, camera moved, ...), not
  // autosave spam — the "saved" pill already shows save state.
  const EVENTS_CAP = 100;
  // Seed from disk so the trace survives hot updates (it's the whole point of a
  // "history"). Written debounced below; never an input to any save → cannot loop.
  const [events, setEvents] = useState<EditEvent[]>(() => loadEvents());
  const logEvent = useCallback((note: EditNote, t = Date.now()) => {
    setEvents((es) => {
      const next = [...es, { ...note, t }];
      return next.length > EVENTS_CAP ? next.slice(next.length - EVENTS_CAP) : next;
    });
  }, []);
  // Debounced one-way writer: events change → write the file. Skips the first run
  // (the just-loaded value) so a mount doesn't rewrite identical content.
  const logWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logWriteReady = useRef(false);
  useEffect(() => {
    if (!logWriteReady.current) { logWriteReady.current = true; return; }
    if (logWriteTimer.current) clearTimeout(logWriteTimer.current);
    logWriteTimer.current = setTimeout(() => saveEvents(events), 500);
    return () => { if (logWriteTimer.current) clearTimeout(logWriteTimer.current); };
  }, [events]);
  // Continuous edits (drag, rotate, fly) would flood the trace — coalesce them to
  // one entry per ~600ms per category.
  const lastCatAtRef = useRef<Record<string, number>>({});
  const logCoalesced = useCallback((note: EditNote) => {
    const now = Date.now();
    if (now - (lastCatAtRef.current[note.cat] ?? 0) < 600) { lastCatAtRef.current[note.cat] = now; return; }
    lastCatAtRef.current[note.cat] = now;
    logEvent(note, now);
  }, [logEvent]);

  // PaintCanvas reports each edit with a semantic note (or none for silent edits like
  // focus toggles): trip the autosave + log the note. Stable for the memoized canvas.
  const onCanvasEdit = useCallback((e?: EditNote) => {
    plog('edit', `onCanvasEdit → setWorldRev${e ? ` + logEvent(${e.cat}:${e.text})` : ' (silent)'}`);
    setWorldRev((r) => r + 1);
    if (e) logEvent(e);
  }, [logEvent]);

  // The 3D preview camera settled (stopped flying) — trip the view autosave + log it
  // (coalesced so a long fly is one entry, not a stream).
  const onCameraSettle = useCallback(() => {
    setViewRev((r) => r + 1);
    logCoalesced({ cat: 'camera', text: 'camera moved' });
  }, [logCoalesced]);

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
    snapshotForUndoCoalesced();
    const next = normalizeBrushSettings({ ...brushRef.current, ...patch });
    brushRef.current = next;
    setBrush(next);
    setViewRev((r) => r + 1);
    const payload = buildPayload();
    if (payload) writeMapFile(ws.stem, payload);
  }, [snapshotForUndoCoalesced, buildPayload, writeMapFile, ws.stem]);

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
    logEvent({ cat: 'map', text: `opened ${name}` });
  }, [ws, applyPayload, refreshMaps, flushCurrent, logEvent]);

  const newMap = useCallback(() => {
    flushCurrent(); // don't lose the current map's just-painted edits
    const name = uniqueMapName('untitled');
    const payload: MapPayload = { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, brush, world: serializeMap(emptyMap()) };
    writeMapFile(name, payload);
    placeSeq.current = 0;
    setPlacements([]);
    setSelPlaceId(null);
    setSeedWorld(emptyMap());
    setWorldEpoch((e) => e + 1);
    ws.setStem(name);
    ws.history.clear();
    refreshMaps();
    logEvent({ cat: 'map', text: `new map ${name}` });
  }, [ws, fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, brush, writeMapFile, refreshMaps, flushCurrent, logEvent]);

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
    logEvent({ cat: 'map', text: `renamed → ${finalName}` });
  }, [ws, buildPayload, writeMapFile, refreshMaps, logEvent]);

  const deleteMapAndAdvance = useCallback((name: string) => {
    deleteMap(name);
    logEvent({ cat: 'map', text: `deleted ${name}` });
    if (name === ws.stem) {
      const remaining = listMaps().filter((m) => m !== name);
      if (remaining.length) openMap(remaining[0]);
      else newMap();
    } else {
      refreshMaps();
    }
  }, [ws, openMap, newMap, refreshMaps, logEvent]);

  // Divider drags arrive as per-event fraction deltas; accumulate + clamp here.
  const onResize = useCallback((axis: 'col' | 'row', d: number) => {
    if (axis === 'col') setFx((f) => clampFrac(f + d));
    else setFy((f) => clampFrac(f + d));
  }, []);
  const resetLayout = useCallback(() => { setFx(0.5); setFy(0.5); }, []);
  const clearNotes = useCallback(() => setNotes(''), []);

  // ── Object placements (the 'place' layer) ───────────────────────────────────
  // The model viewer's + drops the selected kind at the origin, selects it, and
  // switches the painter to the place layer ("brings the view into this layer").
  // A ref so the id-only handlers can name a placement in the log without a stale
  // closure over `placements`.
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
  const labelOf = (id: string) => placementsRef.current.find((p) => p.id === id)?.label ?? 'object';

  const armPlaceable = useCallback((cat: PlaceCat, kind: string) => {
    const base = resolvePlaceable(cat, kind);
    setActivePlaceable((prev) => ({ cat, kind, ...base, rotation: prev?.rotation ?? 0 }));
    setLayer('place');
    setTool('brush');
    setTab('objects');
  }, []);

  const rotatePlaceBrush = useCallback((delta: number) => {
    setActivePlaceable((prev) => prev ? { ...prev, rotation: ((prev.rotation + delta) % 360 + 360) % 360 } : prev);
  }, []);

  const addPlacement = useCallback((cat: PlaceCat, kind: string, gx: number, gy: number, rotation = 0) => {
    placeSeq.current += 1;
    const id = `pl_${placeSeq.current}`;
    const base = resolvePlaceable(cat, kind);
    // Store SNAPPED: the resting position is always the exact cell rect the
    // compile lowers to (placementCellRect), so the canvas draws the truth raw.
    const snap = placementCellRect({ gx, gy, footW: base.footW, footD: base.footD });
    setPlacements((ps) => [...ps, { id, cat, kind, ...base, gx: snap.snapGx, gy: snap.snapGy, rotation, locked: false }]);
    setSelPlaceId(id);
    return base;
  }, []);

  const placeObject = useCallback((cat: PlaceCat, kind: string) => {
    snapshotForUndo(); // pre-add
    armPlaceable(cat, kind);
    const base = addPlacement(cat, kind, 0, 0, activePlaceable?.rotation ?? 0);
    setLayer('place');
    logEvent({ cat: 'object', text: `placed ${base.label}` });
  }, [snapshotForUndo, armPlaceable, addPlacement, activePlaceable?.rotation, logEvent]);
  const paintObjectAt = useCallback((cat: PlaceCat, kind: string, gx: number, gy: number, rotation: number) => {
    const base = addPlacement(cat, kind, gx, gy, rotation);
    logCoalesced({ cat: 'object', text: `painted ${base.label}` });
  }, [addPlacement, logCoalesced]);
  // Drag/update coalesce — one undo step + one log entry per drag, not per move.
  // Position handling during a drag: the engine moves the node NATIVELY (it owns
  // canvas_gx while the button is down) and streams onMove (~60Hz + one final on
  // mouse-up). Snapping the live value would fight that native drag (jitter), so
  // store raw while moves stream and SETTLE-SNAP once they stop: when no onMove
  // arrives for a beat, quantize to the cell rect (placementCellRect) — the node
  // clicks onto the exact tiles the compile will use.
  const moveSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movePlacement = useCallback((id: string, gx: number, gy: number) => {
    snapshotForUndoCoalesced();
    setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, gx, gy } : p)));
    logCoalesced({ cat: 'object', text: `moved ${labelOf(id)}` });
    if (moveSettleTimer.current) clearTimeout(moveSettleTimer.current);
    moveSettleTimer.current = setTimeout(() => {
      moveSettleTimer.current = null;
      setPlacements((ps) => {
        const p = ps.find((q) => q.id === id);
        if (!p) return ps;
        const snap = placementCellRect(p);
        if (p.gx === snap.snapGx && p.gy === snap.snapGy) return ps;
        return ps.map((q) => (q.id === id ? { ...q, gx: snap.snapGx, gy: snap.snapGy } : q));
      });
    }, 140);
  }, [snapshotForUndoCoalesced, logCoalesced]);
  const updatePlacement = useCallback((id: string, patch: Partial<Placement>) => {
    snapshotForUndoCoalesced();
    setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if ('locked' in patch) logEvent({ cat: 'object', text: `${patch.locked ? 'locked' : 'unlocked'} ${labelOf(id)}` });
    else logCoalesced({ cat: 'object', text: `rotated ${labelOf(id)}` });
  }, [snapshotForUndoCoalesced, logEvent, logCoalesced]);
  const removePlacement = useCallback((id: string) => { snapshotForUndo(); logEvent({ cat: 'object', text: `removed ${labelOf(id)}` }); setPlacements((ps) => ps.filter((p) => p.id !== id)); setSelPlaceId((s) => (s === id ? null : s)); }, [snapshotForUndo, logEvent]);
  const clonePlacement = useCallback((id: string) => {
    snapshotForUndo(); // pre-clone
    logEvent({ cat: 'object', text: `cloned ${labelOf(id)}` });
    placeSeq.current += 1;
    const nid = `pl_${placeSeq.current}`;
    setPlacements((ps) => {
      const src = ps.find((p) => p.id === id);
      return src ? [...ps, { ...src, id: nid, gx: src.gx + TILE_UNITS, gy: src.gy + TILE_UNITS, locked: false }] : ps;
    });
    setSelPlaceId(nid);
  }, [snapshotForUndo, logEvent]);
  const place = useMemo(() => ({
    items: placements, selId: selPlaceId, active: activePlaceable, onSelect: setSelPlaceId, onArm: armPlaceable, onRotateBrush: rotatePlaceBrush, onPaintAt: paintObjectAt,
    onMove: movePlacement, onUpdate: updatePlacement, onClone: clonePlacement, onDelete: removePlacement,
  }), [placements, selPlaceId, activePlaceable, armPlaceable, rotatePlaceBrush, paintObjectAt, movePlacement, updatePlacement, clonePlacement, removePlacement]);

  // The top-left "in focus" panel. A tile SELECTION (group) wins — it's the
  // bulk-override surface. Else the place layer shows the SELECTED placement's
  // object (built into a one-object world so the panel resolves it); else it falls
  // back to the active paint tile so it is always live.
  const selPlacement = placements.find((p) => p.id === selPlaceId) ?? null;
  const placeFocus = useMemo(
    () => (layer === 'place' && selPlacement ? buildObjectWorld(selPlacement.cat, selPlacement.kind, selPlacement.skin) : null),
    [layer, selPlacement?.cat, selPlacement?.kind, selPlacement?.skin],
  );

  // Assign a texture to one face of the SELECTED building placement. Promotes the
  // placement's skin to a per-face map and persists it via updatePlacement, so it
  // rides undo/save and compiles into the game (the previously-dead picker path).
  const setFaceTexture = useCallback((_buildingId: string, role: BuildingFaceRole, skin: BuildingSkin) => {
    if (!selPlaceId) return;
    const cur = placements.find((p) => p.id === selPlaceId);
    if (!cur || cur.cat !== 'building') return;
    updatePlacement(selPlaceId, { skin: applyFaceSkin(cur.skin, role, skin) });
    logEvent({ cat: 'object', text: `textured ${role} of ${cur.label}` });
  }, [selPlaceId, placements, updatePlacement, logEvent]);
  const shownFocus: Focus = selCells.length
    ? { kind: 'tiles', cells: selCells }
    : (placeFocus?.focus ?? { kind: 'tile', tile });

  // GLOBAL per-kind part textures (authored in the right-rail Objects inspector).
  // Subscribed so the preview rebuilds when a kind is re-skinned; folded into each
  // instance with the per-instance override winning. Empty → undefined (no field).
  const kindTex = useKindTextures();
  const mergeKindTextures = useCallback((cat: 'building' | 'prop', kind: string, inst?: Record<string, string>) => {
    const merged = { ...kindTexturesFor(cat, kind), ...(inst ?? {}) };
    return Object.keys(merged).length ? merged : undefined;
  }, [kindTex]);

  // The preview world = baseWorld + the painted chunks as REAL heightfield
  // landforms (so WorldStatics draws the terrain the game's own way and placement
  // samples its height) + every placement applied via the game's own mutators.
  // Landforms fold in BEFORE placements so a building/prop sits on the hill under
  // it. Placement graph coords → world cells: graph origin is the seed chunk's
  // centre, so worldCell = gx/TILE_UNITS + CHUNK_TILES/2; buildings place by
  // min-corner (centre − half-footprint) and carry the placement's free rotation.
  const previewWorld = useMemo<GameState>(() => ptime('previewWorld', `rebuild floors=${floors.length} placements=${placements.length}`, () => {
    let s: GameState = { ...baseWorld, world: { ...baseWorld.world, landforms: floorsToLandforms(floors) } };
    // Placement graph coords → world cells via placementCellRect — the ONE shared
    // snap (the canvas node draws the same rect), so 2D, preview, and compile agree
    // on every cell. Markers are single cells; precompute every marker's cell up
    // front so a save can resolve the spawn it links to even if that spawn is placed
    // later in the list.
    const markerCellOf = new Map<string, { x: number; z: number }>();
    for (const p of placements) {
      if (p.cat !== 'marker') continue;
      const r = placementCellRect(p);
      markerCellOf.set(p.id, { x: r.minX, z: r.minZ });
    }
    const occupiedMarkerCells = new Set<string>();
    for (const p of placements) {
      const rect = placementCellRect(p);
      const wx = rect.minX;
      const wz = rect.minZ;
      if (p.cat === 'building') {
        const r = placeBuilding(s, {
          kind: p.kind as Building['kind'],
          x: wx,
          z: wz,
          // The placement's free rotation IS the building's yaw now — the whole
          // mass turns (render3d/buildingTransform + the host OBB), so the 3D box
          // matches the rotated 2D node instead of just flipping a door quadrant.
          yawDegrees: p.rotation,
          // Per-face texture assignment authored on the placement rides into the
          // derived building, so the preview AND the compiled game wear it.
          skin: p.skin,
          // GLOBAL per-kind part textures (right-rail Objects scope) fold in here;
          // a per-instance partTextures override (if any) wins. The merged map rides
          // into the derived building so preview AND compiled game wear it.
          partTextures: mergeKindTextures('building', p.kind, p.partTextures),
          force: true,
        });
        if (r.ok) s = r.state;
      } else if (p.cat === 'marker') {
        // Spawn / save markers lower to single placedCells. ONE marker per cell —
        // a spawn can't sit on a save (the non-overlap rule), so the first to claim
        // a cell wins and any later marker on it is dropped.
        const key = gridCellKey({ x: wx, y: 0, z: wz });
        if (occupiedMarkerCells.has(key)) continue;
        occupiedMarkerCells.add(key);
        // A save links to its chosen spawn (manual pairing) — resolve that spawn's
        // cell to a key, but never to its own cell (a save never spawns you on top
        // of itself).
        let spawnKey: string | undefined;
        if (p.kind === 'save' && p.spawnId) {
          const sc = markerCellOf.get(p.spawnId);
          if (sc && !(sc.x === wx && sc.z === wz)) spawnKey = gridCellKey({ x: sc.x, y: 0, z: sc.z });
        }
        s = placeMarker(s, { kind: p.kind as 'spawn' | 'save', x: wx, z: wz, spawnKey });
      } else {
        // Props anchor at their CENTER (radial footprint) — the snapped rect's
        // centre, so the prop sits exactly where its canvas node draws.
        s = placeWorldProp(s, { kind: p.kind as Parameters<typeof placeWorldProp>[1]['kind'], x: wx + p.footW / 2, z: wz + p.footD / 2, yawDegrees: p.rotation, partTextures: mergeKindTextures('prop', p.kind, p.partTextures) }).state;
      }
    }
    // The world's default spawn — where a fresh game drops the player. The first
    // spawn marker wins; its cell becomes the player start AND the armed respawn,
    // so booting the compiled map puts you on that spawn.
    const firstSpawn = placements.find((p) => p.cat === 'marker' && p.kind === 'spawn');
    if (firstSpawn) {
      const c = markerCellOf.get(firstSpawn.id)!;
      const cell = { x: c.x, y: 0, z: c.z };
      const pos = cellCenterToWorld(cell, s.world.cellSizeMeters);
      s = { ...s, player: { ...s.player, position: { x: pos.x, y: s.player.position.y, z: pos.z }, respawnCell: cell } };
    }
    return s;
  }), [baseWorld, placements, floors, mergeKindTextures]);
  const focusWorld = placeFocus?.world ?? previewWorld;

  // Compile = persist the authored world (the SAME GameState the preview shows:
  // painted terrain as heightfield landforms + placements) to the game's boot key
  // via saveGameState. The standalone game's readStoredGameState then boots THIS
  // map — what you see in the preview is what the game runs. Deliberate (a button),
  // not on every keystroke, so authoring doesn't clobber the booted world midway.
  const compileToGame = useCallback(() => {
    compileEditorWorld(previewWorld);
    logEvent({ cat: 'map', text: `compiled ${ws.stem} → game` });
  }, [previewWorld, logEvent, ws.stem]);

  // The current map always shows in the switcher even before its file lands on disk.
  const displayMaps = maps.includes(ws.stem) ? maps : [...maps, ws.stem].sort();

  // Router nav lives in the persistent ProjectBar shell.
  const nav = useNavigate();
  const route = useRoute();
  const activeRoute = route.path === '/test' ? 'test' : route.path === '/labs' ? 'labs' : route.path === '/characters' ? 'characters' : route.path === '/vehicles' ? 'vehicles' : route.path === '/voxels' ? 'voxels' : route.path === '/assist3d' ? 'assist3d' : route.path === '/textures' ? 'textures' : route.path === '/log' ? 'log' : 'editor';

  // Churn probe: which cart-level state drove this whole-cart re-render? During a
  // paint stroke the cart should be QUIET — any line here mid-stroke is the choke.
  useChurn('cart', {
    floors, previewWorld, worldRev, viewRev, placements, events, selCells, overrides,
    seedWorld, tool, tile, layer, tab, notes, showGrid, wasdQuad, brush, menuOpen, logOpen, maps,
  });

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: '#080d16' }}>
      <ProjectBar
        mapName={ws.stem}
        activeRoute={activeRoute}
        menuOpen={menuOpen}
        logOpen={logOpen}
        lastSavedAt={ws.lastSavedAt}
        canUndo={ws.canUndo}
        canRedo={ws.canRedo}
        onToggleMenu={toggleMenu}
        onToggleLog={toggleLog}
        onNew={() => { setMenuOpen(false); newMap(); }}
        onEditor={() => nav.push('/')}
        onTest={() => nav.push('/test')}
        onLabs={() => nav.push('/labs')}
        onCharacters={() => nav.push('/characters')}
        onVehicles={() => nav.push('/vehicles')}
        onVoxels={() => nav.push('/voxels')}
        onPerf={() => nav.push('/log')}
        onAssist={() => nav.push('/assist3d')}
        onTextures={() => nav.push('/textures')}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onCompile={compileToGame}
      />
      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
        <QuadSplit
          fx={fx}
          fy={fy}
          onResize={onResize}
          topLeft={<PropertiesPanel focus={shownFocus} world={focusWorld} overrides={overrides} onOverride={applyOverride} onClearOverride={clearOverride} onSetFace={setFaceTexture} />}
          topRight={
            <RightPanel
              tab={tab}
              onTab={setTab}
              notes={notes}
              onNotes={setNotes}
              showGrid={showGrid}
              onShowGrid={setShowGrid}
              onResetLayout={resetLayout}
              onClearNotes={clearNotes}
              lastSavedAt={ws.lastSavedAt}
              onPlace={placeObject}
              activePlaceable={activePlaceable}
              onArmPlaceable={armPlaceable}
            />
          }
          bottomLeft={
            <MemoPaintCanvas
              key={`${ws.stem}#${worldEpoch}`}
              initialWorld={seedWorld}
              apiRef={paintApiRef}
              onEdit={onCanvasEdit}
              tool={tool}
              onTool={setTool}
              tile={tile}
              onTile={setTile}
              layer={layer}
              onLayer={setLayer}
              brush={brush}
              onBrushChange={updateBrush}
              place={place}
              showGrid={showGrid}
              onFloors={onFloors}
              onEditBegin={snapshotForUndo}
              wasdFocused={wasdQuad === 'canvas'}
              onWasdFocus={focusCanvas}
              select={tileSelect}
            />
          }
          bottomRight={
            <Pane label="preview">
              <IsoPreview
                key={`${ws.stem}#${worldEpoch}`}
                state={previewWorld}
                wasdFocused={wasdQuad === 'preview'}
                onWasdFocus={focusPreview}
                initialCamera={seedCam}
                cameraApiRef={camApiRef}
                onCameraSettle={onCameraSettle}
              />
            </Pane>
          }
        />

        {/* Route surfaces live inside the shell body, so ProjectBar remains the
            one navigation shell and the editor stays mounted underneath. */}
        <Route path="/log">{() => <LogView />}</Route>
        <Route path="/assist3d">{() => <Assist3DRoute />}</Route>
        <Route path="/textures">{() => <TextureStudio />}</Route>
        <Route path="/voxels">{() => <VoxelHybridRoute onExit={() => nav.push('/')} />}</Route>
        <Route path="/test">{() => <TestRoute state={previewWorld} mapName={ws.stem} onExit={() => nav.push('/')} />}</Route>
        {/* Labs cross into shell as plain data here — shell/ imports nothing
            game-specific; labs/index.ts is the registry rjit lab new maintains. */}
        <Route path="/labs">{() => <LabsRoute labs={LABS} onExit={() => nav.push('/')} />}</Route>
        {/* The characters editor (editors/characters/) — authors what game/figure runs. */}
        <Route path="/characters">{() => <CharactersRoute onExit={() => nav.push('/')} />}</Route>
        {/* The vehicles editor (editors/vehicles/) — authors what game/vehicle builds. */}
        <Route path="/vehicles">{() => <VehiclesRoute onExit={() => nav.push('/')} />}</Route>
      </Box>

      {/* The maps menu lives here — the shell root's LAST child — so it paints on
          top of the editor panes (this engine hit-tests later siblings first). */}
      {menuOpen ? (
        <MapsMenu
          mapName={ws.stem}
          maps={displayMaps}
          onOpen={(m) => { openMap(m); setMenuOpen(false); }}
          onRename={(n) => { renameMap(n); setMenuOpen(false); }}
          onDelete={deleteMapAndAdvance}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}

      {/* Event-log trace — also a root last-child overlay (same layering rule). */}
      {logOpen ? (
        <EventLog events={events} now={Date.now()} onClose={() => setLogOpen(false)} />
      ) : null}

    </Box>
  );
}
