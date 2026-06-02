import { memo, useCallback, useMemo, useRef, useState } from 'react';
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
import type { Building, GameState } from '../hmsc/design';
import { emptyEditorWorld, placeBuilding, placeWorldProp } from './editorWorld';
import { type ChunkFloor } from './chunkFloor';
import { IsoPreview, type PreviewCamera, type PreviewCameraApi } from './IsoPreview';
import { QuadSplit } from './QuadSplit';
import { PaintCanvas, type Tool, type Layer, type PaintCanvasApi } from './PaintCanvas';
import { PropertiesPanel, type Focus } from './PropertiesPanel';
import { RightPanel, type TabId } from './RightPanel';
import { resolvePlaceable, type Placement, type PlaceCat } from './placements';
import { buildObjectWorld } from './objectPreview';
import { serializeMap, deserializeMap, emptyMap, type MapSnapshot, type EditorWorld } from './mapStore';
import { ProjectBar, MapsMenu } from './ProjectBar';
import { listMaps, uniqueMapName, sanitizeMapName, mapExists, deleteMap } from './projects';
import { TILE_UNITS } from './heightData';
import { CHUNK_TILES } from './chunks';
import type { TileKind } from '../hmsc/design';

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
}

function clampFrac(f: number): number {
  return Math.max(MIN_FRAC, Math.min(1 - MIN_FRAC, f));
}

// A placement's free rotation → the building's door side (nearest quadrant). The
// preview can't show an arbitrary yaw on a box building, so snap it.
function rotToSide(rotation: number): Building['doorSide'] {
  const q = ((Math.round(rotation / 90) % 4) + 4) % 4;
  return (['south', 'west', 'north', 'east'] as const)[q];
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

export default function HmscWorldEditorCart() {
  // The 3D preview world. baseWorld is the empty editor GameState (built once);
  // floors (the painted tile/height per chunk) are mirrored from PaintCanvas and
  // drive the preview's floor MESHES directly (not surfaceRegions). previewWorld
  // is baseWorld + the placements applied as real buildings/props (below), so
  // WorldStatics draws them — it only rebuilds when placements change, not on paint.
  const baseWorld = useMemo(emptyEditorWorld, []);
  const [floors, setFloors] = useState<ChunkFloor[]>([]);

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
  const onWorldEdit = useCallback(() => setWorldRev((r) => r + 1), []);

  // The 3D preview camera persists too (per map). camApiRef pulls the live pose for
  // serialize; seedCam seeds the pane on mount/open; viewRev bumps when the camera
  // settles (or focus/selection changes) to trip the same debounced autosave.
  const camApiRef = useRef<PreviewCameraApi | null>(null);
  const [seedCam, setSeedCam] = useState<PreviewCamera | null>(() => initial.cam ?? null);
  const [viewRev, setViewRev] = useState(0);
  const onViewSettle = useCallback(() => setViewRev((r) => r + 1), []);

  const placeSeq = useRef(0);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selPlaceId, setSelPlaceId] = useState<string | null>(() => initial.sel ?? null);

  // ── Persistence: build / apply the whole map payload ──────────────────────────
  const buildPayload = useCallback((): MapPayload | null => {
    const api = paintApiRef.current;
    if (!api) return null; // canvas not mounted yet — skip this autosave tick
    const w = api.getWorld();
    const world = serializeMap({ chunks: w.chunks, zones: w.zones, focus: w.focus, placements });
    return { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, world, sel: selPlaceId, wasd: wasdQuad, cam: camApiRef.current?.get() };
  }, [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, placements, selPlaceId, wasdQuad]);

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
    setSeedWorld(w);
    setWorldEpoch((e) => e + 1);
  }, []);

  const ws = useWorkspace<MapPayload>({
    cartName: CART,
    version: VERSION,
    buildPayload,
    applyPayload,
    deps: [fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, placements, worldRev, selPlaceId, wasdQuad, viewRev],
  });

  // ── Multi-map management (the project manager surface is ProjectBar) ──────────
  const [maps, setMaps] = useState<string[]>(() => listMaps());
  const [menuOpen, setMenuOpen] = useState(false);
  const refreshMaps = useCallback(() => setMaps(listMaps()), []);
  const toggleMenu = useCallback(() => setMenuOpen((o) => { if (!o) setMaps(listMaps()); return !o; }), []);

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
  }, [ws, applyPayload, refreshMaps, flushCurrent]);

  const newMap = useCallback(() => {
    flushCurrent(); // don't lose the current map's just-painted edits
    const name = uniqueMapName('untitled');
    const payload: MapPayload = { fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, world: serializeMap(emptyMap()) };
    writeMapFile(name, payload);
    placeSeq.current = 0;
    setPlacements([]);
    setSelPlaceId(null);
    setSeedWorld(emptyMap());
    setWorldEpoch((e) => e + 1);
    ws.setStem(name);
    ws.history.clear();
    refreshMaps();
  }, [ws, fx, fy, yaw, tool, tile, layer, tab, notes, showGrid, writeMapFile, refreshMaps, flushCurrent]);

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
  }, [ws, buildPayload, writeMapFile, refreshMaps]);

  const deleteMapAndAdvance = useCallback((name: string) => {
    deleteMap(name);
    if (name === ws.stem) {
      const remaining = listMaps().filter((m) => m !== name);
      if (remaining.length) openMap(remaining[0]);
      else newMap();
    } else {
      refreshMaps();
    }
  }, [ws, openMap, newMap, refreshMaps]);

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
  const placeObject = useCallback((cat: PlaceCat, kind: string) => {
    placeSeq.current += 1;
    const id = `pl_${placeSeq.current}`;
    const base = resolvePlaceable(cat, kind);
    setPlacements((ps) => [...ps, { id, cat, kind, ...base, gx: 0, gy: 0, rotation: 0, locked: false }]);
    setSelPlaceId(id);
    setLayer('place');
  }, []);
  const movePlacement = useCallback((id: string, gx: number, gy: number) => setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, gx, gy } : p))), []);
  const updatePlacement = useCallback((id: string, patch: Partial<Placement>) => setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p))), []);
  const removePlacement = useCallback((id: string) => { setPlacements((ps) => ps.filter((p) => p.id !== id)); setSelPlaceId((s) => (s === id ? null : s)); }, []);
  const clonePlacement = useCallback((id: string) => {
    placeSeq.current += 1;
    const nid = `pl_${placeSeq.current}`;
    setPlacements((ps) => {
      const src = ps.find((p) => p.id === id);
      return src ? [...ps, { ...src, id: nid, gx: src.gx + TILE_UNITS, gy: src.gy + TILE_UNITS, locked: false }] : ps;
    });
    setSelPlaceId(nid);
  }, []);
  const place = useMemo(() => ({
    items: placements, selId: selPlaceId, onSelect: setSelPlaceId,
    onMove: movePlacement, onUpdate: updatePlacement, onClone: clonePlacement, onDelete: removePlacement,
  }), [placements, selPlaceId, movePlacement, updatePlacement, clonePlacement, removePlacement]);

  // The top-left "in focus" panel. On the place layer it shows the SELECTED
  // placement's object (built into a one-object world so the panel resolves it);
  // otherwise it falls back to the active paint tile so it is always live.
  const selPlacement = placements.find((p) => p.id === selPlaceId) ?? null;
  const placeFocus = useMemo(
    () => (layer === 'place' && selPlacement ? buildObjectWorld(selPlacement.cat, selPlacement.kind) : null),
    [layer, selPlacement?.cat, selPlacement?.kind],
  );
  const shownFocus: Focus = placeFocus?.focus ?? { kind: 'tile', tile };
  const focusWorld = placeFocus?.world ?? baseWorld;

  // The preview world = baseWorld with every placement applied via the game's own
  // mutators, so WorldStatics renders them exactly as the game would. Placement
  // graph coords → world cells: graph origin is the seed chunk's centre, so
  // worldCell = gx/TILE_UNITS + CHUNK_TILES/2. Buildings are placed by min-corner
  // (centre − half-footprint) with the door snapped to the rotation quadrant.
  const previewWorld = useMemo<GameState>(() => {
    let s = baseWorld;
    for (const p of placements) {
      const wx = Math.round(p.gx / TILE_UNITS + CHUNK_TILES / 2);
      const wz = Math.round(p.gy / TILE_UNITS + CHUNK_TILES / 2);
      if (p.cat === 'building') {
        const r = placeBuilding(s, {
          kind: p.kind as Building['kind'],
          x: wx - Math.floor(p.footW / 2),
          z: wz - Math.floor(p.footD / 2),
          doorSide: rotToSide(p.rotation),
          force: true,
        });
        if (r.ok) s = r.state;
      } else {
        s = placeWorldProp(s, { kind: p.kind as Parameters<typeof placeWorldProp>[1]['kind'], x: wx, z: wz, yawDegrees: p.rotation }).state;
      }
    }
    return s;
  }, [baseWorld, placements]);

  // The current map always shows in the switcher even before its file lands on disk.
  const displayMaps = maps.includes(ws.stem) ? maps : [...maps, ws.stem].sort();

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: '#080d16' }}>
      <ProjectBar
        mapName={ws.stem}
        menuOpen={menuOpen}
        lastSavedAt={ws.lastSavedAt}
        onToggleMenu={toggleMenu}
        onNew={() => { setMenuOpen(false); newMap(); }}
      />
      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
        <QuadSplit
          fx={fx}
          fy={fy}
          onResize={onResize}
          topLeft={<PropertiesPanel focus={shownFocus} world={focusWorld} />}
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
            />
          }
          bottomLeft={
            <MemoPaintCanvas
              key={`${ws.stem}#${worldEpoch}`}
              initialWorld={seedWorld}
              apiRef={paintApiRef}
              onEdit={onWorldEdit}
              tool={tool}
              onTool={setTool}
              tile={tile}
              onTile={setTile}
              layer={layer}
              onLayer={setLayer}
              place={place}
              showGrid={showGrid}
              onFloors={setFloors}
              wasdFocused={wasdQuad === 'canvas'}
              onWasdFocus={focusCanvas}
            />
          }
          bottomRight={
            <Pane label="preview">
              <IsoPreview
                key={`${ws.stem}#${worldEpoch}`}
                state={previewWorld}
                floors={floors}
                wasdFocused={wasdQuad === 'preview'}
                onWasdFocus={focusPreview}
                initialCamera={seedCam}
                cameraApiRef={camApiRef}
                onCameraSettle={onViewSettle}
              />
            </Pane>
          }
        />
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
    </Box>
  );
}
