import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { readFile, writeFile, mkdir } from '@reactjit/hooks/fs';
import { execAsync } from '@reactjit/runtime/hooks/process';
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
import type { BuildingFaceRole, BuildingSkin, GameState } from '../hmsc/design';
import { applyFaceSkin } from './buildingEditor';
import { compileEditorWorld, emptyEditorWorld, placeMarker, placeWorldProp } from './editorWorld';
import { cellCenterToWorld, cellKey as gridCellKey } from '../hmsc/world/grid';
import { type ChunkFloor, floorsFromEditorWorld, floorsToLandforms } from './chunkFloor';
import { IsoPreview, type PreviewCamera, type PreviewCameraApi } from './IsoPreview';
import { IsoAuthor } from './IsoAuthor';
import { QuadSplit } from './QuadSplit';
import { PaintCanvas, type Tool, type Layer, type PaintCanvasApi, type BrushSettings, type CanvasView2D } from './PaintCanvas';
import { PropertiesPanel, type Focus } from './PropertiesPanel';
import { RightPanel, type TabId } from './RightPanel';
import { placementCellRect, resolvePlaceable, type Placement, type PlaceCat } from './placements';
import { buildObjectWorld } from './objectPreview';
import { useKindTextures, kindTexturesFor } from './kindTextures';
import { serializeMap, deserializeMap, emptyMap, hasAuthoredMapContent, paintedCenter, isSaneView2d, viewRunawayLogKey, type MapSnapshot, type EditorWorld } from './mapStore';
import { Chrome, MapsMenu, EventLog } from './shell/chrome';
import { NotificationOverlayHost } from './shell/notifications';
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
import { Assist3DRoute } from './assist3d';
import { PlayRoute } from './editors/play/PlayRoute';
import { LabsRoute } from './shell/LabsRoute';
import { WorkbenchRoute } from './shell/WorkbenchRoute';
import { currentWorkbenchFamily, requestWorkbenchSource, subscribeWorkbenchFamily, type WorkbenchFamily } from './shell/workbenchDoor';
import { CompiledWorldRoute } from './CompiledWorld';
import { workbenchSources } from './editors/workbench/sources';
import { LABS } from './labs';
import { editorChannel } from './editors/store';
import { editorSessions } from './editors/sessions';
import { editorTunables, tuningStream } from './editors/tunables';
import { GAME_BUILD, pieceMutationMapName, piecesForMap, worldStream, type BuildPrefabDef, type PlacedBuildPiece, type WorldEvent, type WorldStreamState } from './game';
import { buildingMutationMapName, buildingPieceInstanceId, buildingsStream, instancesForMap, isBuildingsEvent, partitionBuildingSelection, reconcileBuildingInstances, withBuildingPieces, type BuildEditEvent, type BuildingsEvent, type BuildingsStreamState } from './game';
import { graphToBuildWorld, mapBuildFootprints, mapBuildPlaceable } from './mapBuildPlacements';

// hmsc-int is a multi-map WORKSPACE (the city, every building interior, ...), not
// one world — see memory project_hmsc_int_multimap_workspace. A persistent shell
// (the chrome strip, shell/chrome.tsx) manages the SET of maps; below it the
// editor is a 2x2 pane grid:
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
const GAME_BAKE_CMD = 'tools/rjit game bake 2>&1';

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
  view2d?: CanvasView2D;               // the 2D canvas camera (MAPGONE2-0605:
                                       // unrestored, every remount snapped the
                                       // viewport to the lattice origin)
  pieces?: PlacedBuildPiece[];         // this map's build pieces AS OF the snapshot —
                                       // carried so Ctrl+Z reverts building edits;
                                       // only read on a 'history' apply (undo/redo),
                                       // inert on restore (the live worldStream wins)
}

// A build piece's VALUE identity (everything but its stream-minted id), so undo can
// reconcile by value: replaying history mints fresh ids, so the snapshot's pieces never
// match the live ones by id — only by what they ARE (kind, pose, edit, material skin).
function pieceValueKey(p: Omit<PlacedBuildPiece, 'id'>): string {
  return `${p.pieceId}|${p.x}|${p.y}|${p.z}|${p.yawDegrees}|${p.edit ?? ''}|${p.skin ? JSON.stringify(p.skin) : ''}`;
}

// The minimal place/remove set to turn `current` into `target` (both this-map pieces),
// matched as multisets by value key — so an undo only touches the pieces that actually
// differ, leaving the rest of the map alone. removes carry live ids; places carry the
// target piece data minus its id (the stream mints a new one on replay).
function reconcileBuildPieces(
  current: readonly PlacedBuildPiece[],
  target: readonly PlacedBuildPiece[],
): { removes: string[]; places: Omit<PlacedBuildPiece, 'id'>[] } {
  const curByKey = new Map<string, string[]>();
  for (const p of current) {
    const k = pieceValueKey(p);
    const ids = curByKey.get(k);
    if (ids) ids.push(p.id); else curByKey.set(k, [p.id]);
  }
  const tgtByKey = new Map<string, PlacedBuildPiece[]>();
  for (const p of target) {
    const k = pieceValueKey(p);
    const ps = tgtByKey.get(k);
    if (ps) ps.push(p); else tgtByKey.set(k, [p]);
  }
  const removes: string[] = [];
  for (const [k, ids] of curByKey) {
    const keep = tgtByKey.get(k)?.length ?? 0;
    for (let i = keep; i < ids.length; i += 1) removes.push(ids[i]);
  }
  const places: Omit<PlacedBuildPiece, 'id'>[] = [];
  for (const [k, ps] of tgtByKey) {
    const have = curByKey.get(k)?.length ?? 0;
    for (let i = have; i < ps.length; i += 1) { const { id, ...rest } = ps[i]; places.push(rest); }
  }
  return { removes, places };
}

function clampFrac(f: number): number {
  return Math.max(MIN_FRAC, Math.min(1 - MIN_FRAC, f));
}

function lastMeaningfulLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
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
    heightMode: v.heightMode === 'ramp' || v.heightMode === 'slope' || v.heightMode === 'smooth' ? v.heightMode : DEFAULT_BRUSH.heightMode,
    rampMin: clampNum(v.rampMin, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.rampMin),
    rampMax: clampNum(v.rampMax, -HEIGHT_LIMIT, HEIGHT_LIMIT, DEFAULT_BRUSH.rampMax),
    rampWide: clampNum(v.rampWide, 1, 120, DEFAULT_BRUSH.rampWide),
    rampLong: clampNum(v.rampLong, 1, 120, DEFAULT_BRUSH.rampLong),
    rampAngle: clampNum(v.rampAngle, 0, 359, DEFAULT_BRUSH.rampAngle),
    smoothStrength: clampNum(v.smoothStrength, 0.05, 1, DEFAULT_BRUSH.smoothStrength),
  };
}

// Synchronous read of the last-open map's VIEW, to seed initial pane fractions so
// the divider never flashes to centre on mount. The WORLD is seeded by the
// workspace restore (applyPayload, which remounts PaintCanvas with the decoded map).
function readInitialView(): Partial<MapPayload> {
  try {
    const stem = readInitialMapStem();
    if (!stem) return {};
    const text = readFile(sessionPathFor(CART, stem));
    if (!text) return {};
    const env = parseEnvelope<MapPayload>(text, { cartName: CART, version: VERSION });
    return env?.payload ?? {};
  } catch {
    return {};
  }
}

function readInitialMapStem(): string | null {
  try {
    const stem = readFile(lastPointerPath(CART))?.trim();
    return stem && stem.length > 0 ? stem : null;
  } catch {
    return null;
  }
}

function readInitialLegacyPieceMapName(): string | null {
  const stem = readInitialMapStem();
  if (!stem) return null;
  const initial = readInitialView();
  if (!initial.world) return null;
  try {
    const world = deserializeMap(initial.world);
    return hasAuthoredMapContent(world) ? stem : null;
  } catch {
    return null;
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
// chrome shell while route surfaces overlay the shell body.
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
  const [legacyPieceMapName] = useState(readInitialLegacyPieceMapName);
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
  // The 2D canvas camera the next PaintCanvas mount opens at: the map's saved
  // view, or (older files) the painted-content centre — never the bare lattice
  // origin on a non-empty map (MAPGONE2-0605: that read as "the map vanished"
  // whenever the origin chunk is featureless at default zoom).
  const [seedView, setSeedView] = useState<CanvasView2D | null>(null);
  const lastViewRunawayWarn = useRef<string | null>(null);
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
  const [selBuildId, setSelBuildId] = useState<string | null>(null);
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

  // Build-piece undo wiring (set further down, once worldSession/streamState exist).
  // buildPiecesRef feeds the current pieces into buildPayload (defined before they're
  // computed); reconcileBuildUndoRef carries the apply-side reconcile so applyPayload
  // (empty-dep, ref-driven) can revert build edits on Ctrl+Z without a circular dep.
  const buildPiecesRef = useRef<PlacedBuildPiece[]>([]);
  const reconcileBuildUndoRef = useRef<(target: PlacedBuildPiece[] | undefined, reason?: 'restore' | 'history') => void>(() => {});

  // ── Persistence: build / apply the whole map payload ──────────────────────────
  const buildPayload = useCallback((): MapPayload | null => {
    const api = paintApiRef.current;
    if (!api) return null; // canvas not mounted yet — skip this autosave tick
    const w = api.getWorld();
    const world = ptime('autosave', `serializeMap chunks=${w.chunks.size}`, () => serializeMap({ chunks: w.chunks, zones: w.zones, focus: w.focus, placements }));
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
    return { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, world, sel: selPlaceId, wasd: wasdQuad, cam: camApiRef.current?.get(), overrides: serializeOverrides(overrides), brush: brushRef.current, view2d, pieces: buildPiecesRef.current };
  }, [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, placements, selPlaceId, wasdQuad, overrides]);

  const applyPayload = useCallback((env: SessionEnvelope<MapPayload>, reason?: 'restore' | 'history') => {
    const p = env.payload;
    const applyTwig = reason !== 'history';
    if (applyTwig && typeof p.fx === 'number') setFx(p.fx);
    if (applyTwig && typeof p.fy === 'number') setFy(p.fy);
    if (applyTwig && typeof p.yaw === 'number') setYaw(p.yaw);
    if (applyTwig && p.tool) setTool(p.tool);
    if (applyTwig && p.tile) setTile(p.tile);
    if (applyTwig && p.layer) setLayer(p.layer);
    if (applyTwig && p.tab) setTab(p.tab);
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
    setFloors(restoredFloors);
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
    // stream alone. (No-op until the wiring below is set this render.)
    reconcileBuildUndoRef.current(p.pieces, reason);
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

  // ── Multi-map management (the project manager surface is the chrome strip) ────
  const [maps, setMaps] = useState<string[]>(() => listMaps());
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [compiledReloadKey, setCompiledReloadKey] = useState(0);
  const [compiledStatus, setCompiledStatus] = useState('native world_loader primitive');
  // Compile-button feedback (the bake shells out, no instant result): the state
  // drives the pill icon, the status is a readable one-liner in the chrome.
  const [compileState, setCompileState] = useState<'idle' | 'compiling' | 'done' | 'error'>('idle');
  const [compileStatus, setCompileStatus] = useState('');
  const refreshMaps = useCallback(() => setMaps(listMaps()), []);
  // The two toolbar popovers are mutually exclusive; opening one closes the other.
  const toggleMenu = useCallback(() => { setMenuOpen((o) => !o); setLogOpen(false); }, []);
  const toggleLog = useCallback(() => { setLogOpen((o) => !o); setMenuOpen(false); }, []);
  // Refresh the map list from disk whenever the menu opens (a sibling session may
  // have added/removed a map).
  useEffect(() => { if (menuOpen) setMaps(listMaps()); }, [menuOpen]);

  // ── The / route's session on the world channel (editors/sessions.ts) ──────────
  // The user's ruling made live on the MAIN authoring surface: this mount opens a
  // session on the 'world' channel and every interaction below sprinkles one
  // edit-commit. The MAP CONTENT still saves through the workspace session files
  // (the save path above — untouched, zero risk to authored maps); these are
  // marker-only commits (note()), so the route-scoped commit history exists TODAY
  // and world content events join the same channel later by ADDITION (V20 schema
  // evolution — nothing to migrate when the editor's world goes event-sourced).
  const worldChannel = useMemo(() => {
    try {
      return editorChannel(worldStream);
    } catch {
      return null;
    }
  }, []);
  const [mapBuildRev, setMapBuildRev] = useState(0);
  const worldSession = useMemo(() => {
    try {
      return worldChannel ? editorSessions().open('/', worldChannel) : null;
    } catch {
      return null; // no __fs_* host — authoring continues without the trace
    }
  }, [worldChannel]);
  useEffect(() => () => worldSession?.close(), [worldSession]);

  // ── The buildings channel (req_0512/req_0513): buildings OWN their history.
  // A second concern stream beside 'world' (V20: new feature = new stream) —
  // defs + instance references whose derived pieces merge into buildPieces
  // below. Building events route here; loose-piece events stay on 'world'.
  const buildingsChannel = useMemo(() => {
    try {
      return editorChannel(buildingsStream);
    } catch {
      return null;
    }
  }, []);
  const buildingsSession = useMemo(() => {
    try {
      return buildingsChannel ? editorSessions().open('/', buildingsChannel) : null;
    } catch {
      return null;
    }
  }, [buildingsChannel]);
  useEffect(() => () => buildingsSession?.close(), [buildingsSession]);

  // ── The P2 tunables boot fold (editors/tunables.ts) ───────────────────────────
  // Persisted knob edits (the V20 'tuning' stream's override map) fold back over
  // the registered code defaults once per process, at shell mount — so a value
  // tuned on /settings yesterday is the value every route reads today. Knobs
  // registered after this (later module evals) pick their override up at
  // registration; /settings owns the edit path.
  useMemo(() => {
    try {
      editorTunables().applyOverrides(editorChannel(tuningStream).state().overrides);
    } catch {
      // no __fs_* host — tunables run on code defaults, editing still works
    }
  }, []);

  // ── Event-log trace (the categorized eventbus shown in the chrome popover) ────
  // A stream of WHAT happened (tile painted, object moved, camera moved, ...), not
  // autosave spam — the "saved" pill already shows save state.
  const EVENTS_CAP = 100;
  // Seed from disk so the trace survives hot updates (it's the whole point of a
  // "history"). Written debounced below; never an input to any save → cannot loop.
  const [events, setEvents] = useState<EditEvent[]>(() => loadEvents());
  // Every semantic interaction funnels through here (canvas strokes, placements,
  // camera settles, map lifecycle) — exactly where the session's edit-commits get
  // sprinkled. The label carries the map stem so a multi-map session reads right.
  const logEvent = useCallback((note: EditNote, t = Date.now()) => {
    worldSession?.note(`${wsRef.current.stem}: ${note.cat}: ${note.text}`);
    setEvents((es) => {
      const next = [...es, { ...note, t }];
      return next.length > EVENTS_CAP ? next.slice(next.length - EVENTS_CAP) : next;
    });
  }, [worldSession]);
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

  const streamState: WorldStreamState | null = worldChannel ? worldChannel.state() : null;
  const buildingsState: BuildingsStreamState | null = buildingsChannel ? buildingsChannel.state() : null;
  void mapBuildRev; // revision tick: forces this component to re-read worldChannel.state().
  const buildingPrefabs: BuildPrefabDef[] = (() => {
    const removed = new Set(streamState?.removedPrefabs ?? []);
    const merged: Record<string, BuildPrefabDef> = {};
    for (const id of GAME_BUILD.prefabs.ids) merged[id] = GAME_BUILD.prefabs.get(id);
    for (const def of Object.values(streamState?.prefabs ?? {})) merged[def.id] = def;
    return Object.values(merged).filter((def) => !removed.has(def.id)).sort((a, b) => a.label.localeCompare(b.label));
  })();
  // The ONE pieces view (req_0513): loose world pieces ⊕ derived building
  // stamps. Memoized so the merged array identity is stable between renders —
  // pieceGridOf/liftToTerrain/mapBuildFootprints all cache on array identity.
  const buildPieces = useMemo(
    () => withBuildingPieces(piecesForMap(streamState, ws.stem, { legacyMapName: legacyPieceMapName }), buildingsState, ws.stem),
    [streamState, buildingsState, ws.stem, legacyPieceMapName],
  );
  const buildingInstances = useMemo(() => instancesForMap(buildingsState, ws.stem), [buildingsState, ws.stem]);
  buildPiecesRef.current = buildPieces; // feed the current pieces into buildPayload's snapshot
  const buildFootprints = mapBuildFootprints(buildPieces);

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
    logEvent({ cat: 'map', text: `opened ${name}` });
  }, [ws, applyPayload, refreshMaps, flushCurrent, logEvent]);

  const newMap = useCallback(() => {
    flushCurrent(); // don't lose the current map's just-painted edits
    const name = uniqueMapName('untitled');
    const fresh = emptyMap();
    const payload: MapPayload = { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, brush, world: serializeMap(fresh) };
    writeMapFile(name, payload);
    placeSeq.current = 0;
    setPlacements([]);
    setFloors(floorsFromEditorWorld(fresh));
    setSelPlaceId(null);
    setSelBuildId(null);
    setSeedWorld(fresh);
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
  const buildFootprintsRef = useRef(buildFootprints);
  buildFootprintsRef.current = buildFootprints;
  const labelOf = (id: string) => placementsRef.current.find((p) => p.id === id)?.label ?? 'object';
  const buildingLabelOf = (id: string) => buildFootprintsRef.current.find((p) => p.id === id)?.label ?? 'building';

  // Tag a build event with the map it belongs to (places/stamps go to the active
  // stem; removes/edits resolve the owning map from the existing piece). Shared by the
  // single and batch commit paths so they scope identically.
  const scopeBuildEvent = useCallback((event: BuildEditEvent): BuildEditEvent => {
    switch (event.kind) {
      case 'piecePlaced':
      case 'prefabStamped':
        return { ...event, mapName: ws.stem } as WorldEvent;
      case 'pieceRemoved':
      case 'pieceEditSet':
      case 'pieceSkinSet': {
        const mapName = pieceMutationMapName(streamState, ws.stem, legacyPieceMapName, event.id);
        return mapName ? ({ ...event, mapName } as WorldEvent) : event;
      }
      // buildings (req_0513): instances are per-map; defs are shared globals
      // (buildingDefined carries no map scope by design).
      case 'buildingPlaced':
        return { ...event, mapName: ws.stem } as BuildingsEvent;
      case 'buildingMoved':
      case 'buildingRemoved': {
        const mapName = buildingMutationMapName(buildingsState, ws.stem, event.id);
        return mapName ? ({ ...event, mapName } as BuildingsEvent) : event;
      }
      default:
        return event;
    }
  }, [ws.stem, streamState, buildingsState, legacyPieceMapName]);

  const commitBuildEvent = useCallback((event: BuildEditEvent, label: string) => {
    const scoped = scopeBuildEvent(event);
    if (isBuildingsEvent(scoped)) {
      if (!buildingsSession) return false;
      snapshotForUndo();
      buildingsSession.commit(scoped, label);
    } else {
      if (!worldSession) return false;
      snapshotForUndo(); // record the pre-edit state so Ctrl+Z reverts this build edit
      worldSession.commit(scoped, label);
    }
    setMapBuildRev((r) => r + 1);
    return true;
  }, [worldSession, buildingsSession, scopeBuildEvent, snapshotForUndo]);

  // MANY build events as ONE undoable action: snapshot once, append every event with a
  // SINGLE store snapshot pass (RouteSession.commitMany), bump once. Without this a
  // bulk op (move/clone/delete a 352-piece building = hundreds of events) re-materialized
  // the whole store per event and froze the editor — and undo would step one piece at a
  // time. Falls back to a per-event loop if the session predates commitMany.
  // Building events route to their OWN channel (req_0513): the batch splits by
  // stream, buildings first (a promote defines/places before its loose pieces
  // are removed), and the deferred snapshot pass coalesces both into one flush.
  const commitBuildEvents = useCallback((items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => {
    if (!items.length) return false;
    const scoped = items.map((it) => ({ event: scopeBuildEvent(it.event), label: it.label }));
    const bld = scoped.filter((it): it is { event: BuildingsEvent; label: string } => isBuildingsEvent(it.event));
    const wrl = scoped.filter((it): it is { event: WorldEvent; label: string } => !isBuildingsEvent(it.event));
    if ((bld.length > 0 && !buildingsSession) || (wrl.length > 0 && !worldSession)) return false;
    snapshotForUndo();
    if (bld.length > 0 && buildingsSession) {
      const many = (buildingsSession as { commitMany?: (xs: typeof bld) => unknown }).commitMany;
      if (typeof many === 'function') many.call(buildingsSession, bld);
      else for (const s of bld) buildingsSession.commit(s.event, s.label);
    }
    if (wrl.length > 0 && worldSession) {
      const many = (worldSession as { commitMany?: (xs: typeof wrl) => unknown }).commitMany;
      if (typeof many === 'function') many.call(worldSession, wrl);
      else for (const s of wrl) worldSession.commit(s.event, s.label);
    }
    setMapBuildRev((r) => r + 1);
    return true;
  }, [worldSession, buildingsSession, scopeBuildEvent, snapshotForUndo]);

  // The apply-side of build undo, refreshed each render so applyPayload (empty-dep) can
  // call the latest through reconcileBuildUndoRef. On a 'history' apply only: diff the
  // live pieces against the snapshot's and append the compensating place/remove events
  // (one batch, one snapshot) so the worldStream returns to the snapshot's piece set.
  // Does NOT snapshotForUndo — an undo must not itself record an undo step.
  reconcileBuildUndoRef.current = (target, reason) => {
    if (reason !== 'history' || !worldSession || !Array.isArray(target)) return;
    const current = withBuildingPieces(
      piecesForMap(streamState, ws.stem, { legacyMapName: legacyPieceMapName }),
      buildingsState,
      ws.stem,
    );
    // LOOSE pieces reconcile by value (place/remove); BUILDING instances get
    // REVERSE events on their own branch (req_0513 — V20: undo APPENDS, the
    // shared history is never rewound). Derived `bld:` pieces must never leak
    // into the loose diff: a moved building would otherwise re-place its old
    // stamp as loose duplicates.
    const isLoose = (p: PlacedBuildPiece) => buildingPieceInstanceId(p.id) === null;
    const { removes, places } = reconcileBuildPieces(current.filter(isLoose), target.filter(isLoose));
    const buildingEvents = reconcileBuildingInstances(current, target, buildingsState, ws.stem);
    if (!removes.length && !places.length && !buildingEvents.length) return;
    if (buildingEvents.length && buildingsSession) {
      const scoped = buildingEvents.map((event) => ({ event: scopeBuildEvent(event) as BuildingsEvent, label: 'undo: building' }));
      const many = (buildingsSession as { commitMany?: (xs: typeof scoped) => unknown }).commitMany;
      if (typeof many === 'function') many.call(buildingsSession, scoped);
      else for (const e of scoped) buildingsSession.commit(e.event, e.label);
    }
    const events = [
      ...removes.map((id) => ({ event: scopeBuildEvent({ kind: 'pieceRemoved', id }) as WorldEvent, label: 'undo: remove piece' })),
      ...places.map((placement) => ({ event: scopeBuildEvent({ kind: 'piecePlaced', placement }) as WorldEvent, label: 'undo: place piece' })),
    ];
    if (events.length) {
      const many = (worldSession as { commitMany?: (xs: typeof events) => unknown }).commitMany;
      if (typeof many === 'function') many.call(worldSession, events);
      else for (const e of events) worldSession.commit(e.event, e.label);
    }
    setMapBuildRev((r) => r + 1);
  };

  const armPlaceable = useCallback((cat: PlaceCat, kind: string) => {
    if (cat === 'building') {
      const def = buildingPrefabs.find((prefab) => prefab.id === kind);
      if (!def) return;
      setActivePlaceable((prev) => ({ ...mapBuildPlaceable(def, prev?.rotation ?? 0), rotation: prev?.rotation ?? 0 }));
      setLayer('place');
      setTool('brush');
      setTab('objects');
      return;
    }
    const base = resolvePlaceable(cat, kind);
    setActivePlaceable((prev) => ({ cat, kind, ...base, rotation: prev?.rotation ?? 0 }));
    setLayer('place');
    setTool('brush');
    setTab('objects');
  }, [buildingPrefabs]);

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
    if (cat === 'building') {
      const def = buildingPrefabs.find((prefab) => prefab.id === kind);
      if (!def) return;
      armPlaceable(cat, kind);
      const origin = graphToBuildWorld(0, 0);
      commitBuildEvent({ kind: 'prefabStamped', prefabId: def.id, origin, yawDegrees: activePlaceable?.rotation ?? 0 }, `${ws.stem}: object: placed ${def.label}`);
      logEvent({ cat: 'object', text: `placed ${def.label}` });
      setLayer('place');
      return;
    }
    snapshotForUndo(); // pre-add
    armPlaceable(cat, kind);
    const base = addPlacement(cat, kind, 0, 0, activePlaceable?.rotation ?? 0);
    setLayer('place');
    logEvent({ cat: 'object', text: `placed ${base.label}` });
  }, [buildingPrefabs, armPlaceable, commitBuildEvent, ws.stem, activePlaceable?.rotation, logEvent, snapshotForUndo, addPlacement]);
  const paintObjectAt = useCallback((cat: PlaceCat, kind: string, gx: number, gy: number, rotation: number) => {
    if (cat === 'building') {
      const def = buildingPrefabs.find((prefab) => prefab.id === kind);
      if (!def) return;
      const origin = graphToBuildWorld(gx, gy);
      commitBuildEvent({ kind: 'prefabStamped', prefabId: def.id, origin, yawDegrees: rotation }, `${ws.stem}: object: stamped ${def.label}`);
      logCoalesced({ cat: 'object', text: `painted ${def.label}` });
      return;
    }
    const base = addPlacement(cat, kind, gx, gy, rotation);
    logCoalesced({ cat: 'object', text: `painted ${base.label}` });
  }, [buildingPrefabs, commitBuildEvent, ws.stem, addPlacement, logCoalesced]);
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
  const removeBuildPlacement = useCallback((id: string) => {
    const fp = buildFootprintsRef.current.find((p) => p.id === id);
    if (!fp) return;
    // ONE batch (one snapshot, one undo step) — deleting a big building was N per-piece
    // commits, each re-materializing the store. A footprint over a BUILDING
    // INSTANCE (req_0513) deletes by ONE buildingRemoved on its own branch;
    // loose pieces keep the per-piece removes.
    const { wholeInstances, loosePieceIds } = partitionBuildingSelection(new Set(fp.pieceIds), buildPiecesRef.current);
    commitBuildEvents([
      ...wholeInstances.map((instId) => ({ event: { kind: 'buildingRemoved', id: instId } as BuildEditEvent, label: `${ws.stem}: object: removed ${fp.label}` })),
      ...loosePieceIds.map((pieceId) => ({ event: { kind: 'pieceRemoved', id: pieceId } as BuildEditEvent, label: `${ws.stem}: object: removed ${fp.label}` })),
    ]);
    logEvent({ cat: 'object', text: `removed ${fp.label}` });
    setSelBuildId((s) => (s === id ? null : s));
  }, [commitBuildEvents, ws.stem, logEvent]);
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
    items: placements, selId: selPlaceId, active: activePlaceable, buildItems: buildFootprints, buildSelId: selBuildId,
    onSelect: setSelPlaceId, onSelectBuild: setSelBuildId, onArm: armPlaceable, onRotateBrush: rotatePlaceBrush, onPaintAt: paintObjectAt,
    onMove: movePlacement, onUpdate: updatePlacement, onClone: clonePlacement, onDelete: removePlacement,
    onDeleteBuild: removeBuildPlacement,
  }), [placements, selPlaceId, activePlaceable, buildFootprints, selBuildId, armPlaceable, rotatePlaceBrush, paintObjectAt, movePlacement, updatePlacement, clonePlacement, removePlacement, removeBuildPlacement]);

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
  // samples its height) + every current placement applied via the game's own
  // mutators. Legacy `cat: building` placements are intentionally inert:
  // AUTHBUILD-REMOVE deletes the old world.buildings system; V24 build pieces
  // (`bp_*`) are the surviving building model.
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
        continue;
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
  const compileToGame = useCallback(async () => {
    setCompiledStatus('compiling game-file...');
    setCompileState('compiling');
    setCompileStatus('baking…');
    try {
      compileEditorWorld(previewWorld);
      const bake = await execAsync(GAME_BAKE_CMD);
      const summary = lastMeaningfulLine(bake.stdout);
      if (bake.code !== 0 || /\[game\].*FAILED/i.test(bake.stdout)) {
        throw new Error(summary || `tools/rjit game bake exited ${bake.code}`);
      }
      setCompiledReloadKey((key) => key + 1);
      setCompiledStatus(summary || 'compiled game-file refreshed');
      // Surface the material breadcrumb the bake prints (worldGeometry
      // encodeMaterials) so you can confirm glass IS in the data — separate from
      // whether the /compiled host loader (a SEPARATE binary, needs a host
      // rebuild) renders it.
      const mats = bake.stdout.match(/\[materials\][^\n]*/)?.[0]?.replace('[materials] ', '') ?? '';
      setCompileState('done');
      setCompileStatus(mats ? `✓ ${mats}` : '✓ baked (data only — host loader needs a rebuild)');
      logEvent({ cat: 'map', text: `compiled ${ws.stem} → game-file${mats ? ` (${mats})` : ''}` });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      setCompiledStatus(`error: ${message}`);
      setCompileState('error');
      setCompileStatus(`✗ ${message.slice(0, 80)}`);
      logEvent({ cat: 'map', text: `compile failed: ${message}` });
    }
  }, [previewWorld, logEvent, ws.stem]);

  // The current map always shows in the switcher even before its file lands on disk.
  const displayMaps = maps.includes(ws.stem) ? maps : [...maps, ws.stem].sort();

  // The /workbench source registry (WORKBENCH.md §6) — built once per mount.
  const wbSources = useMemo(workbenchSources, []);

  // Router nav lives in the persistent chrome shell.
  const nav = useNavigate();
  const route = useRoute();
  // STEP10-COLLAPSE-0607: ASSETS and SETTINGS are both /workbench; the bench
  // reports its source FAMILY so the chrome lights the right door truthfully.
  const [wbFamily, setWbFamily] = useState<WorkbenchFamily>(currentWorkbenchFamily());
  useEffect(() => subscribeWorkbenchFamily(setWbFamily), []);
  const activeRoute = route.path === '/workbench' ? (wbFamily === 'settings' ? 'workbench-settings' : 'workbench-assets') : route.path === '/test' ? 'test' : route.path === '/labs' ? 'labs' : route.path === '/assist3d' ? 'assist3d' : route.path === '/compiled' ? 'compiled' : 'editor';
  const atEditor = activeRoute === 'editor';

  // Churn probe: which cart-level state drove this whole-cart re-render? During a
  // paint stroke the cart should be QUIET — any line here mid-stroke is the choke.
  useChurn('cart', {
    floors, previewWorld, worldRev, viewRev, placements, events, selCells, overrides,
    seedWorld, tool, tile, layer, tab, notes, showGrid, wasdQuad, brush, menuOpen, logOpen, maps,
  });

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', position: 'relative', backgroundColor: '#080d16' }}>
      <Chrome
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
        onWorkbench={() => nav.push('/workbench')}
        onSettings={() => { requestWorkbenchSource('settings'); nav.push('/workbench'); }}
        onAssist={() => nav.push('/assist3d')}
        onCompiled={() => nav.push('/compiled')}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onCompile={compileToGame}
        compileState={compileState}
        compileStatus={compileStatus}
      />
      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
        {atEditor ? (
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
                buildingPrefabs={buildingPrefabs}
                onPlace={placeObject}
                activePlaceable={activePlaceable}
                onArmPlaceable={armPlaceable}
              />
            }
            bottomLeft={
              <MemoPaintCanvas
                key={`${ws.stem}#${worldEpoch}`}
                initialWorld={seedWorld}
                initialView={seedView}
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
                wasdFocused={atEditor && wasdQuad === 'canvas'}
                onWasdFocus={focusCanvas}
                select={tileSelect}
              />
            }
            bottomRight={
              // Build-only: the on-foot 'inspect' (FreeFly) view is retired here — the
              // iso authoring view is the bottom-right pane (USER req_0424). On-foot lives
              // on the /test route (F1/F2).
              <Pane label="build">
                <IsoAuthor
                  key={`${ws.stem}#${worldEpoch}`}
                  state={previewWorld}
                  pieces={buildPieces}
                  buildings={buildingInstances}
                  prefabs={buildingPrefabs}
                  onCommit={commitBuildEvent}
                  onCommitMany={commitBuildEvents}
                  focused={atEditor && wasdQuad === 'preview'}
                  onFocus={focusPreview}
                />
              </Pane>
            }
          />
        ) : null}

        {/* Route surfaces live inside the shell body, so the chrome remains the
            one navigation shell. The editor panes unmount off-route; the
            workspace/session layer owns durable world and view state. */}
        <Route path="/assist3d">{() => <Assist3DRoute />}</Route>
        {/* The embodied game surface (editors/play/, PLAYFOLD-0605): /test +
            /build folded into ONE route — mode is PlayRoute's own state,
            F1 test / F2 build flip it WITHOUT remounting, so the pose,
            camera, console, and placed pieces carry across the toggle.
            (The /build URL retired as a dupe of this surface.) */}
        <Route path="/test">{() => <PlayRoute state={previewWorld} mapName={ws.stem} legacyPieceMapName={legacyPieceMapName} onExit={() => nav.push('/')} />}</Route>
        {/* Labs cross into shell as plain data here — shell/ imports nothing
            game-specific; labs/index.ts is the registry rjit lab new maintains. */}
        <Route path="/labs">{() => <LabsRoute labs={LABS} onExit={() => nav.push('/')} />}</Route>
        {/* The four-gutter rebuild (WORKBENCH.md) — additive while sources land;
            old routes flip off one at a time as parity is reached. */}
        <Route path="/workbench">{() => <WorkbenchRoute sources={wbSources} onExit={() => nav.push('/')} />}</Route>
        <Route path="/compiled">{() => <CompiledWorldRoute onExit={() => nav.push('/')} reloadKey={compiledReloadKey} status={compiledStatus} />}</Route>
      </Box>

      {/* Root overlays live here so they paint on top of the editor panes (this
          engine hit-tests later siblings first). */}
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

      {/* Event-log trace — also a root overlay (same layering rule). */}
      {logOpen ? (
        <EventLog events={events} now={Date.now()} onClose={() => setLogOpen(false)} />
      ) : null}

      <NotificationOverlayHost simulateRebuildNotice={route.path === '/__rebuild-notify'} />
    </Box>
  );
}
