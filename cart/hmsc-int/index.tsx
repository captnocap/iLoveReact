import { startupMark, startupWatchSettle, navStart, navReady } from './startupTimer';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, Pressable } from '@reactjit/primitives';
import { execAsync, envGet } from '@reactjit/runtime/hooks/process';
import { nsGet, nsSet } from '@reactjit/hooks/localstore';
import type { GameState } from './design';
import { compileEditorWorld, emptyEditorWorld } from './editorWorld';
import { floorsToLandforms, floorsToWaterBodies, type ChunkFloor } from './chunkFloor';
import { IsoAuthor, CatalogRail, sameArmed, type Armed } from './IsoAuthor';
import { LoaderIsoView } from './LoaderIsoView';
import { QuadSplit } from './QuadSplit';
import { PaintCanvas } from './PaintCanvas';
import { PropertiesPanel, type Focus } from './PropertiesPanel';
import { RightPanel } from './RightPanel';
import type { SkinDraft } from './editors/build/FacePainter';
import { buildObjectWorld } from './objectPreview';
import { useKindTextures, kindTexturesFor } from './kindTextures';
import { Chrome, MapsMenu, EventLog } from './shell/chrome';
import { DashboardRoute } from './shell/DashboardRoute';
import { EditorLayout } from './shell/EditorLayout';
import { NotificationOverlayHost } from './shell/notifications';
import { loadEvents, saveEvents, type EditNote, type EditEvent } from './editLog';
import { plog, ptime, useChurn } from './perfLog';
import { startPerfHeartbeat } from './state/perfWatch';
import { Router, Route, useNavigate, useRoute } from '@reactjit/router';
import { Assist3DRoute } from './assist3d';
import { LabsRoute } from './shell/LabsRoute';
import { WorkbenchRoute } from './shell/WorkbenchRoute';
import { currentWorkbenchFamily, requestWorkbenchSource, subscribeWorkbenchFamily, type WorkbenchFamily } from './shell/workbenchDoor';
import { CompiledWorldRoute, reloadCompiledWindowIfOpen } from './CompiledWorld';
import { workbenchSources } from './editors/workbench/sources';
import { LABS } from './labs';
import { editorChannel } from './editors/store';
import { editorSessions } from './editors/sessions';
import { editorTunables, tuningStream } from './editors/tunables';
import { ensureCookedRegistry } from './editors/model/cookedAssets';
import { worldStream, buildingsStream, type PlacedBuildPiece, type BuildEditEvent } from './game';
import { useMapSession } from './editors/world/useMapSession';
import { useBuildUndo } from './editors/world/useBuildUndo';
import { usePlacements } from './editors/world/usePlacements';
import { assemblePreviewWorld } from './editors/world/previewWorld';
import { worldToPlacementGraph } from './placements';
import { writeFile as diagWriteFile } from '@reactjit/hooks/fs';

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
// the workspace layer's "disk = truth" pattern (the save/restore engine is
// editors/world/useMapSession.ts). The shell is WIRING ONLY (SHELLFOLD-0611,
// review §2): each concern lives in its own hook —
//   useMapSession   — MapPayload build/apply, autosave, open/new/rename/delete,
//                     the view-sanity laws, every per-map twig
//   useBuildUndo    — build-stream commits (one undo step per interaction) +
//                     the Ctrl+Z piece reconciler
//   usePlacements   — the 'place' layer's CRUD verbs + the canvas `place` API
//   previewWorld.ts — (floors, placements) → GameState, a pure assembler
// — and the next feature lands as a module, not 40 more lines in a closure.

// Boot phase: every module index.tsx pulls in has now evaluated (this is the
// 5.7mb bundle's import cost, on top of t0 set in startupTimer).
startupMark('index.tsx module graph evaluated');

const GAME_BAKE_CMD = 'tools/rjit game bake 2>&1';
// AUTOCOMPILE req_1867: how long after a (re)mount to suppress the loader pane's auto-bake,
// so boot/hot-reload world-data settling never auto-compiles — only genuine edits after it do.
const AUTO_COMPILE_GRACE_MS = 4000;

function lastMeaningfulLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
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
  // Boot phase: React reached the cart's root component and is mounting (only the
  // first render — re-renders during boot don't re-stamp).
  const bootMarked = useRef(false);
  if (!bootMarked.current) {
    bootMarked.current = true;
    startupMark('EditorShell first render (React mounting)');
    // The honest READY: watch frames from here and report when the main thread
    // settles (chunk bakes / grass / 3D preview all drained), not when the canvas
    // merely mounts. This is the ~3s the user actually waits for.
    startupWatchSettle();
  }

  // PERF HEARTBEAT (req_1735): unconditional once-per-second frame breakdown to the
  // dev terminal — names what the host spends a flat-slow frame on (paint/gpu/tick/
  // other) when the spike recorder can't (no calm baseline at 1-3fps). TEMP probe.
  useEffect(() => startPerfHeartbeat(), []);

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

  // ── The cross-hook seams (refs, so hook order stays acyclic) ──────────────────
  // buildPayload (map session) snapshots the live pieces useBuildUndo derives;
  // applyPayload (map session) reverts build edits through useBuildUndo's
  // reconciler; the map verbs log through the event log defined further down.
  const buildPiecesRef = useRef<PlacedBuildPiece[]>([]);
  const reconcileBuildUndoRef = useRef<(target: PlacedBuildPiece[] | undefined, reason?: 'restore' | 'history') => void>(() => {});
  const logEventRef = useRef<(note: EditNote) => void>(() => {});
  const logStable = useCallback((note: EditNote) => logEventRef.current(note), []);

  // ── The map session: persistence, twigs, map verbs (editors/world/useMapSession) ──
  const map = useMapSession({ onFloorsRestored: setFloors, log: logStable, buildPiecesRef, reconcileBuildUndoRef });
  const {
    ws, snapshotForUndo, snapshotForUndoCoalesced, legacyPieceMapName,
    displayMaps, refreshMaps, openMap, newMap, renameMap, deleteMapAndAdvance,
    fx, fy, onResize, resetLayout,
    tool, setTool, tile, setTile, layer, setLayer, channels, toggleChannel,
    tab, setTab, notes, setNotes, showGrid, setShowGrid, brush, updateBrush,
    wasdQuad, focusCanvas, focusPreview,
    placements, setPlacements, placeSeq, selPlaceId, setSelPlaceId, selBuildId, setSelBuildId,
    overrides, selCells, tileSelect, applyOverride, clearOverride,
    seedWorld, seedView, worldEpoch, worldRev, viewRev, bumpWorldRev, bumpViewRev,
    paintApiRef,
  } = map;
  const stemRef = useRef(ws.stem);
  stemRef.current = ws.stem;

  // ── Chrome popovers + compile feedback ────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // EDITORLAYOUT req_1882: which map fills the reworked editor stage — '3d' = the iso
  // build pane (the ~90% surface, default), '2d' = the tile canvas. The other rides a
  // corner PiP; clicking it swaps. Both stay mounted (no remount/reload on swap).
  const [mapFocus, setMapFocus] = useState<'3d' | '2d'>('3d');
  // RAILHOIST req_1888: the prop/piece menu (CatalogRail) lives in the editor RAIL now,
  // OFF the map — so the editor owns the armed piece and feeds it to whichever map pane
  // is mounted (loader or react). One source of truth, shared.
  const [armed, setArmed] = useState<Armed>(null);
  const armCatalog = useCallback((a: NonNullable<Armed>) => setArmed((cur) => (sameArmed(cur, a) ? null : a)), []);
  // req_1943: a STAGED skin for the held item — skin it in the paint panel, then it
  // rides into the piecePlaced event on drop. Persists across repeated placements of
  // the SAME armed item (place many dressed copies); reset when the armed item changes.
  const [armedDraft, setArmedDraft] = useState<SkinDraft | null>(null);
  const armedKey = armed && 'id' in armed ? `${armed.kind}:${armed.id}` : (armed?.kind ?? null);
  useEffect(() => { setArmedDraft(null); }, [armedKey]);
  // [LOADERVIEW req_1768] render the bottom-right build pane via the native world_loader
  // (one gamefile read) instead of the React Scene3D rebuild (~683MB/boot that chokes the
  // big 'main' map → slow boot + blank viewport). NOW DEFAULT ON: the app opens into the
  // loader pane so startup is fast and the world actually renders. The pane toggle flips
  // back to the React view and PERSISTS '0' so that choice sticks. env RJIT_LOADER_VIEW
  // forces '1'/'0'.
  const [loaderView, setLoaderViewState] = useState(() => {
    try {
      const env = envGet('RJIT_LOADER_VIEW');
      if (env === '1') return true;
      if (env === '0') return false;
      return nsGet('hmsc', 'editor.loaderView') !== '0'; // default ON unless turned off
    } catch { return true; }
  });
  const setLoaderView = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setLoaderViewState((v) => {
      const n = typeof next === 'function' ? next(v) : next;
      try { nsSet('hmsc', 'editor.loaderView', n ? '1' : '0'); } catch { /* headless / no store */ }
      return n;
    });
  }, []);
  // AUTOCOMPILE req_1865: gate for the loader pane's debounced auto-bake. PERSISTED in
  // localstore (not plain state) because a hot reload re-mounts the cart and would otherwise
  // reset it to ON every time — which is the whole problem: while an agent edits, each hot
  // reload re-armed a compile that locked the editor 5-6s, back-to-back. Off → only the
  // manual Compile button bakes; the live overlay still shows placements/skins instantly.
  const [autoCompile, setAutoCompileState] = useState(() => {
    try { return nsGet('hmsc', 'editor.autoCompile') !== '0'; } catch { return true; } // default ON
  });
  const setAutoCompile = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setAutoCompileState((v) => {
      const n = typeof next === 'function' ? next(v) : next;
      try { nsSet('hmsc', 'editor.autoCompile', n ? '1' : '0'); } catch { /* headless / no store */ }
      return n;
    });
  }, []);
  const [compiledReloadKey, setCompiledReloadKey] = useState(0);
  const compilingRef = useRef(false); // a bake is in flight (auto + manual share it)
  const [compiledStatus, setCompiledStatus] = useState('native world_loader primitive');
  // Compile-button feedback (the bake shells out, no instant result): the state
  // drives the pill icon, the status is a readable one-liner in the chrome.
  const [compileState, setCompileState] = useState<'idle' | 'compiling' | 'done' | 'error'>('idle');
  const [compileStatus, setCompileStatus] = useState('');
  // The two toolbar popovers are mutually exclusive; opening one closes the other.
  const toggleMenu = useCallback(() => { setMenuOpen((o) => !o); setLogOpen(false); }, []);
  const toggleLog = useCallback(() => { setLogOpen((o) => !o); setMenuOpen(false); }, []);
  // Refresh the map list from disk whenever the menu opens (a sibling session may
  // have added/removed a map).
  useEffect(() => { if (menuOpen) refreshMaps(); }, [menuOpen, refreshMaps]);

  // ── The / route's session on the world channel (editors/sessions.ts) ──────────
  // The user's ruling made live on the MAIN authoring surface: this mount opens a
  // session on the 'world' channel and every interaction below sprinkles one
  // edit-commit. The MAP CONTENT still saves through the workspace session files
  // (useMapSession — untouched, zero risk to authored maps); these are
  // marker-only commits (note()), so the route-scoped commit history exists TODAY
  // and world content events join the same channel later by ADDITION (V20 schema
  // evolution — nothing to migrate when the editor's world goes event-sourced).
  // req_1136: register the persisted Studio-cooked props into the prop + catalog
  // overlays BEFORE the worldStream is defined/folded below. The world materializer
  // drops a piecePlaced whose pieceId isn't a known catalog id
  // (game/world/stream.ts:267), so a placed cooked prop would silently vanish on
  // fold (and stay gone — state() caches incrementally) until the overlay synced.
  // Syncing here, ahead of the fold, makes a cooked prop placeable AND survive a
  // cold reload. Idempotent; safe headless.
  useMemo(() => { try { ensureCookedRegistry(); } catch { /* no store / headless */ } }, []);
  const worldChannel = useMemo(() => {
    try {
      return editorChannel(worldStream);
    } catch {
      return null;
    }
  }, []);
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
    worldSession?.note(`${stemRef.current}: ${note.cat}: ${note.text}`);
    setEvents((es) => {
      const next = [...es, { ...note, t }];
      return next.length > EVENTS_CAP ? next.slice(next.length - EVENTS_CAP) : next;
    });
  }, [worldSession]);
  logEventRef.current = logEvent; // the map verbs (open/new/rename/delete) log through this
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

  // ── Build streams: commits + the Ctrl+Z reconciler (editors/world/useBuildUndo) ──
  const build = useBuildUndo({
    worldChannel, buildingsChannel, worldSession, buildingsSession,
    stem: ws.stem, legacyPieceMapName, snapshotForUndo,
    buildPiecesRef, reconcileBuildUndoRef,
  });
  const { buildingPrefabs, buildPieces, buildingInstances, buildFootprints, commitBuildEvent, commitBuildEvents } = build;

  // req_1943: inject the STAGED skin into a piecePlaced placement so a held item
  // dropped after being skinned lands already-dressed. ONE seam at the commit
  // boundary covers BOTH the loader pane and the react IsoAuthor (both place via
  // these); other commits (paint on placed pieces, the place layer) pass through.
  const armedDraftRef = useRef(armedDraft); armedDraftRef.current = armedDraft;
  const injectDraft = useCallback((event: BuildEditEvent): BuildEditEvent => {
    const d = armedDraftRef.current;
    if (!d || event.kind !== 'piecePlaced' || (!d.skin && !d.partTextures)) return event;
    return { ...event, placement: { ...event.placement, ...(d.skin ? { skin: d.skin } : {}), ...(d.partTextures ? { partTextures: d.partTextures } : {}) } };
  }, []);
  const commitPlacement = useCallback((event: BuildEditEvent, label: string) => commitBuildEvent(injectDraft(event), label), [commitBuildEvent, injectDraft]);
  const commitPlacements = useCallback((items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => commitBuildEvents(items.map((it) => ({ ...it, event: injectDraft(it.event) }))), [commitBuildEvents, injectDraft]);

  // The / dashboard's footprint census reads every placement + building footprint
  // (both carry footW/footD). Cheap; rebuilt only when either set changes.
  const dashFootprints = useMemo(
    () => [...placements, ...buildFootprints],
    [placements, buildFootprints],
  );
  // The dashboard's "most placed" census: every placed prop/building's display
  // label (buildings via their footprint group label). Cheap; recomputed only
  // when either set changes.
  const dashPlacedLabels = useMemo(
    () => [...placements.map((p) => p.label), ...buildFootprints.map((f) => f.label)],
    [placements, buildFootprints],
  );

  // [LOADERVIEW req_1757] content centroid to seed the loader pane's iso camera so it
  // opens looking at what's built (the loader can't read the gamefile's center from JS).
  const [buildCenterX, buildCenterZ] = useMemo(() => {
    if (!buildPieces.length) return [0, 0];
    let sx = 0, sz = 0;
    for (const p of buildPieces) { sx += p.x; sz += p.z; }
    return [sx / buildPieces.length, sz / buildPieces.length];
  }, [buildPieces]);

  // ── Placement verbs + the canvas `place` API (editors/world/usePlacements) ────
  const placementsApi = usePlacements({
    placements, setPlacements, placeSeq, selPlaceId, setSelPlaceId, selBuildId, setSelBuildId,
    stem: ws.stem, buildingPrefabs, buildFootprints, buildPiecesRef,
    commitBuildEvent, commitBuildEvents, snapshotForUndo, snapshotForUndoCoalesced,
    logEvent, logCoalesced, setLayer, setTool, setTab,
  });
  const { place, activePlaceable, armPlaceable, armScatter, placeObject, setFaceTexture } = placementsApi;

  // PaintCanvas reports each edit with a semantic note (or none for silent edits like
  // focus toggles): trip the autosave + log the note. Stable for the memoized canvas.
  const onCanvasEdit = useCallback((e?: EditNote) => {
    plog('edit', `onCanvasEdit → setWorldRev${e ? ` + logEvent(${e.cat}:${e.text})` : ' (silent)'}`);
    bumpWorldRev();
    if (e) logEvent(e);
  }, [bumpWorldRev, logEvent]);

  // ── The iso pane's selection, mirrored up (req_0702) ─────────────────────────
  // The face painter lives in the top-right PAINT tab now (off the crowded map),
  // so the cart holds a mirror of what the iso build pane has selected. Gaining a
  // selection auto-opens the PAINT tab — select pieces, the paint surface is there.
  const [isoSelectedIds, setIsoSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const isoSelRef = useRef<ReadonlySet<string>>(isoSelectedIds);
  const onIsoSelectionChange = useCallback((ids: ReadonlySet<string>) => {
    const gained = ids.size > 0 && isoSelRef.current.size === 0;
    isoSelRef.current = ids;
    setIsoSelectedIds(ids);
    if (gained) setTab('paint');
  }, [setTab]);

  // The iso build pane's WATER tab drops a body of water at a clicked ground
  // point: lower it to an ordinary water placement (cat 'water') at that world
  // position, so it persists, positions, renders, and bakes like everything else.
  const placeWaterBodyAt = useCallback((presetKind: string, x: number, z: number) => {
    const { gx, gy } = worldToPlacementGraph(x, z);
    place.onPaintAt('water', presetKind, gx, gy, 0);
  }, [place]);

  // The top-left "in focus" panel. A tile SELECTION (group) wins — it's the
  // bulk-override surface. Else the place layer shows the SELECTED placement's
  // object (built into a one-object world so the panel resolves it); else it falls
  // back to the active paint tile so it is always live.
  const selPlacement = placements.find((p) => p.id === selPlaceId) ?? null;
  const placeFocus = useMemo(
    () => (layer === 'place' && selPlacement ? buildObjectWorld(selPlacement.cat, selPlacement.kind, selPlacement.skin) : null),
    [layer, selPlacement?.cat, selPlacement?.kind, selPlacement?.skin],
  );
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
  // landforms + every current placement applied via the game's own mutators.
  //
  // PERF (PAINTCHOKE-0618): a tile-COLOUR dab used to re-run the whole placement
  // walk because previewWorld was memoized on `floors` directly, and that walk is
  // O(placements) (each placeWorldProp immutably re-appends to the props array +
  // scans all ids). On a grown map that quadratic was the 3-4s-per-edit choke.
  //
  // The split below decouples the two cheap inputs from the expensive one:
  //   • landforms/waterBodies — cached per chunk by floorsToLandforms (stable
  //     identity for unpainted chunks), so a colour dab only rebuilds the one
  //     painted chunk's landform.
  //   • placementWorld — the O(placements) assembler, keyed on a HEIGHT signature
  //     (hver per chunk) + placements, NOT on tile colour. Prop Y depends only on
  //     terrain HEIGHT (landformGroundTopAt), so colouring never moves a prop and
  //     this walk can be skipped for colour edits entirely.
  //   • previewWorld — overlays the freshly-coloured landforms + floors-water onto
  //     the (reused) placementWorld with a single spread. Cheap, runs every paint.
  const landforms = useMemo(() => floorsToLandforms(floors), [floors]);
  const floorsWater = useMemo(() => floorsToWaterBodies(floors), [floors]);
  const heightSig = useMemo(() => floors.map((f) => `${f.cx},${f.cz}:${f.hver}`).join(';'), [floors]);
  // The placement assembler holds ONLY placement-derived water (base water = []) so
  // the overlay can refresh painted floors-water without re-running it AND without
  // dropping placed water. landforms are baked for prop Y (height) but intentionally
  // not a memo dep — keyed on heightSig so colour-only paint reuses this result.
  const placementWorld = useMemo<GameState>(() => ptime('placementWorld', `rebuild placements=${placements.length} heightSig=${heightSig.length}b`, () => {
    // EDITLATENCY req_1939: time the O(placements) GameState reassembler and stash it so the
    // loader pane's edit-latency line can show how much of the ~500ms reconcile this one memo is.
    const _t0 = (globalThis as any).performance?.now?.() ?? Date.now();
    const w = assemblePreviewWorld({ baseWorld, landforms, waterBodies: [], placements, mergeKindTextures });
    (globalThis as any).__lastPlacementWorldMs = ((globalThis as any).performance?.now?.() ?? Date.now()) - _t0;
    return w;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [baseWorld, placements, mergeKindTextures, heightSig]);
  const previewWorld = useMemo<GameState>(() => (
    { ...placementWorld, world: { ...placementWorld.world, landforms, waterBodies: [...floorsWater, ...(placementWorld.world.waterBodies ?? [])] } }
  ), [placementWorld, landforms, floorsWater]);
  const focusWorld = placeFocus?.world ?? previewWorld;

  // Compile = persist the authored world (the SAME GameState the preview shows:
  // painted terrain as heightfield landforms + placements) to the game's boot key
  // via saveGameState. The standalone game's readStoredGameState then boots THIS
  // map — what you see in the preview is what the game runs. Deliberate (a button),
  // not on every keystroke, so authoring doesn't clobber the booted world midway.
  const compileToGame = useCallback(async () => {
    if (compilingRef.current) return; // never overlap bakes (auto + manual share this)
    compilingRef.current = true;
    setCompiledStatus('compiling game-file...');
    setCompileState('compiling');
    setCompileStatus('baking…');
    try {
      // TEMP DIAG (req_1505): record what the LIVE previewWorld carries at compile
      // time — to localize where the auto-generated signs are lost vs the bake.
      try {
        const dp: any[] = (previewWorld as any).world?.props ?? [];
        const signKinds = ['streetSign', 'stopSign', 'trafficLight', 'streetLight'];
        const signs = dp.filter((p) => signKinds.includes(p.kind));
        diagWriteFile('/tmp/rjit-compile-diag.json', JSON.stringify({
          when: 'compileToGame(live previewWorld)',
          props: dp.length,
          signs: signs.length,
          signTexts: [...new Set(signs.map((p) => p.text).filter(Boolean))],
          studioProps: dp.filter((p) => String(p.kind).startsWith('studio.')).map((p) => p.kind),
          genPlacements: placements.filter((p) => p.gen).length,
          totalPlacements: placements.length,
        }, null, 2));
      } catch { /* diag best-effort */ }
      compileEditorWorld(previewWorld);
      const bake = await execAsync(GAME_BAKE_CMD);
      const summary = lastMeaningfulLine(bake.stdout);
      if (bake.code !== 0 || /\[game\].*FAILED/i.test(bake.stdout)) {
        throw new Error(summary || `tools/rjit game bake exited ${bake.code}`);
      }
      setCompiledReloadKey((key) => key + 1);
      setCompiledStatus(summary || 'compiled game-file refreshed');
      // WORLDWIN-0611: an open pop-out window takes the fresh gamefile live —
      // paint → Compile → the second window updates, zero route flips.
      reloadCompiledWindowIfOpen();
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
    } finally {
      compilingRef.current = false;
    }
  }, [previewWorld, logEvent, ws.stem]);

  // [LIVEHOST tier-2 req_1800] a DEBOUNCED settle bake the loader pane requests only when
  // an edit touched BAKED geometry (delete/move/rotate of a pre-baked piece) — the live
  // overlay can add meshes but not erase a baked one, so those need a bake to reflect.
  // Placements never call this (instant via the overlay). Re-arms while a bake is running.
  const settleBakeTimer = useRef<any>(null);
  const requestSettleBake = useCallback(() => {
    if (settleBakeTimer.current) clearTimeout(settleBakeTimer.current);
    const arm = () => {
      settleBakeTimer.current = setTimeout(() => {
        if (compilingRef.current) { arm(); return; } // a bake is running — wait, then retry
        compileToGame();
      }, 1200);
    };
    arm();
  }, [compileToGame]);

  // [LOADERVIEW req_1760/1761] "always up to date": the loader pane renders the BAKED
  // gamefile, so it only reflects edits after a compile. Auto-compile on a DEBOUNCED
  // cadence — bake ~2.5s after edits settle (never per-edit; the user's ruling), and
  // skip while a bake is in flight (re-arm so the latest edits still land). Only while
  // the loader view is on (the React view shows live state directly, no bake needed).
  // Edit history is untouched (V20 streams); this just refreshes the rendered bake.
  const autoCompileTimer = useRef<any>(null);
  // AUTOCOMPILE req_1866/1867: a GRACE WINDOW after each (re)mount. The cart re-mounts on every
  // hot reload AND on boot the world DATA loads (worldRev/placements/previewWorld go empty →
  // populated) — both re-run the auto-compile effect with no USER edit, and arming a bake each
  // time was the compile→5-6s-lock storm (frozen on startup, frozen during agent edits). Suppress
  // auto-compile until the settling window passes; only genuine edits AFTER it bake. Reset on map
  // switch. Manual Compile is always available; the persisted toggle (req_1865) is the off switch.
  const autoCompileReadyRef = useRef(false);
  useEffect(() => {
    autoCompileReadyRef.current = false;
    const t = setTimeout(() => { autoCompileReadyRef.current = true; }, AUTO_COMPILE_GRACE_MS);
    return () => clearTimeout(t);
  }, [ws.stem]);
  useEffect(() => {
    if (!loaderView || !autoCompile) return; // toggle off → manual bake only
    if (!autoCompileReadyRef.current) return; // still in the post-(re)mount settling window
    if (autoCompileTimer.current) clearTimeout(autoCompileTimer.current);
    const arm = () => {
      autoCompileTimer.current = setTimeout(() => {
        if (compilingRef.current) { arm(); return; } // a bake is running — wait, then retry
        compileToGame();
      }, compilingRef.current ? 1500 : 2500);
    };
    arm();
    return () => { if (autoCompileTimer.current) clearTimeout(autoCompileTimer.current); };
    // NOT keyed on buildPieces (LIVEHOST req_1798): a piece PLACEMENT shows instantly via
    // the loader's live overlay (LoaderIsoView pushes __compiled_world_set_live_pieces), so
    // it must NOT trigger the ~5s whole-world rebake+reload flash. Placements fold into the
    // gamefile on the next bake (a 2D-canvas/terrain edit via worldRev, or manual Compile).
  }, [loaderView, autoCompile, worldRev, placements, ws.stem, compileToGame]);

  // The /workbench source registry (WORKBENCH.md §6) — built once per mount.
  const wbSources = useMemo(workbenchSources, []);

  // Router nav lives in the persistent chrome shell.
  const nav = useNavigate();
  const route = useRoute();
  // STEP10-COLLAPSE-0607: ASSETS and SETTINGS are both /workbench; the bench
  // reports its source FAMILY so the chrome lights the right door truthfully.
  const [wbFamily, setWbFamily] = useState<WorkbenchFamily>(currentWorkbenchFamily());
  useEffect(() => subscribeWorkbenchFamily(setWbFamily), []);
  // / is now the light DASHBOARD (req_1872); the editor moved to /editor so boot
  // lands on a screen that paints in one frame instead of the full world load.
  const activeRoute = route.path === '/workbench' ? (wbFamily === 'settings' ? 'workbench-settings' : 'workbench-assets') : route.path === '/labs' ? 'labs' : route.path === '/assist3d' ? 'assist3d' : route.path === '/compiled' ? 'compiled' : route.path === '/editor' ? 'editor' : 'dashboard';
  const atEditor = activeRoute === 'editor';
  const atDashboard = route.path === '/';
  // Route nav timing (req_1637): a route button calls navStart(path) on click; this
  // effect fires after the new route's surface first renders, logging click→first-
  // render and arming a settle watch for the fully-loaded number.
  useEffect(() => { navReady(route.path); }, [route.path]);

  // The 3D preview camera settled (stopped flying) — trip the view autosave + log it
  // (coalesced so a long fly is one entry, not a stream).
  const onCameraSettle = useCallback(() => {
    bumpViewRev();
    logCoalesced({ cat: 'camera', text: 'camera moved' });
  }, [bumpViewRev, logCoalesced]);
  void onCameraSettle; // wired into IsoPreview when the inspect pane returns

  // Churn probe: which cart-level state drove this whole-cart re-render? During a
  // paint stroke the cart should be QUIET — any line here mid-stroke is the choke.
  useChurn('cart', {
    floors, previewWorld, worldRev, viewRev, placements, events, selCells, overrides,
    seedWorld, tool, tile, layer, tab, notes, showGrid, wasdQuad, brush, menuOpen, logOpen, maps: displayMaps,
  });

  // [transfer dump] req_1751: the "I MADE IT" button on the / route. After sitting
  // through the egregious boot, ONE click dumps every byte that crossed the host
  // boundary up to this moment — the JS→host reconciler command stream (hostConfig
  // flush meter, __flushReport) and the host→JS localstore reads (localstore meter,
  // __storeReadReport) — to a log file. This is the HONEST number the settle-watcher
  // could not give: whatever actually MOVED, not a guess at when frames went calm.
  const [dumpMsg, setDumpMsg] = useState('');
  const dumpTransfer = useCallback(() => {
    const g: any = globalThis as any;
    const flush = g.__flushReport?.() ?? { totalBytes: 0, flushCount: 0, elapsedMs: 0, byOp: [], smallFlushBytes: 0, smallFlushCount: 0, timeline: [], biggestCommands: [] };
    const store = g.__storeReadReport?.() ?? { totalBytes: 0, byKey: [] };
    const MB = (b: number) => (b / 1024 / 1024).toFixed(2) + 'MB';
    const KB = (b: number) => (b / 1024).toFixed(1) + 'KB';
    const grand = flush.totalBytes + store.totalBytes;
    const L: string[] = [];
    L.push('=== hmsc-int  /  route — STARTUP TRANSFER DUMP ===');
    L.push(`clicked "I MADE IT" at: ${new Date().toISOString()}`);
    L.push(`elapsed since first flush (~boot start): ${(flush.elapsedMs / 1000).toFixed(1)}s`);
    L.push('');
    L.push(`GRAND TOTAL across the host boundary to reach / : ${MB(grand)}`);
    L.push(`  - JS -> host (reconciler command stream): ${MB(flush.totalBytes)} in ${flush.flushCount} flushes`);
    L.push(`  - host -> JS (localstore reads):          ${MB(store.totalBytes)}`);
    L.push('');
    L.push('-- JS -> host: by op (fat flushes >=64KB attributed) --');
    for (const o of flush.byOp) L.push(`    ${String(o.op).padEnd(8)} ${String(o.n).padStart(7)} cmd   ${MB(o.bytes)}`);
    L.push(`    (sub-64KB batches: ${MB(flush.smallFlushBytes)} across ${flush.smallFlushCount} flushes, not op-attributed)`);
    L.push('');
    L.push('-- JS -> host: biggest single commands --');
    for (const c of flush.biggestCommands) L.push(`    ${KB(c.len).padStart(9)}  ${String(c.op).padEnd(7)} ${String(c.type ?? '').padEnd(14)} keys=[${(c.keys || []).join(',')}]`);
    L.push('');
    L.push('-- host -> JS: localstore reads by key --');
    for (const k of store.byKey) L.push(`    ${KB(k.bytes).padStart(9)}  ${k.n}x  ${k.key}`);
    L.push('');
    L.push(`-- JS -> host: full flush timeline (${flush.timeline.length} flushes, ms@size) --`);
    for (const t of flush.timeline) L.push(`    +${t.at.toFixed(0).padStart(7)}ms  ${KB(t.bytes).padStart(9)}  (${t.n} cmd)`);
    L.push('');
    const path = '/tmp/rjit-startup-transfer.log';
    let ok = false;
    try { ok = diagWriteFile(path, L.join('\n')); } catch {}
    setDumpMsg(ok ? `dumped ${MB(grand)} -> ${path}` : 'dump FAILED (no __fs_write host?)');
    try { (g.__hostLog)?.(0, `[transfer-dump] ${MB(grand)} total (flush ${MB(flush.totalBytes)} + store ${MB(store.totalBytes)}) -> ${path}`); } catch {}
  }, []);

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
        onProbeDump={dumpTransfer}
        probeMsg={dumpMsg}
        onHome={() => { navStart('/'); nav.push('/'); }}
        onEditor={() => { navStart('/editor'); nav.push('/editor'); }}
        onLabs={() => { navStart('/labs'); nav.push('/labs'); }}
        onWorkbench={() => { navStart('/workbench'); nav.push('/workbench'); }}
        onSettings={() => { navStart('/workbench'); requestWorkbenchSource('settings'); nav.push('/workbench'); }}
        onAssist={() => { navStart('/assist3d'); nav.push('/assist3d'); }}
        onCompiled={() => { navStart('/compiled'); nav.push('/compiled'); }}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onCompile={compileToGame}
        compileState={compileState}
        compileStatus={compileStatus}
      />
      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
        {/* / = the light dashboard (req_1872): paints instantly, no 3D/world load.
            The editor's heavy panes are gated to /editor below, so boot lands
            here while the workspace warms the map in the background. */}
        {atDashboard ? (
          <DashboardRoute
            mapName={ws.stem}
            floors={floors}
            footprints={dashFootprints}
            placedLabels={dashPlacedLabels}
            onOpenEditor={() => { navStart('/editor'); nav.push('/editor'); }}
            onCompiled={() => { navStart('/compiled'); nav.push('/compiled'); }}
          />
        ) : null}
        {atEditor ? (
          <EditorLayout
            focus={mapFocus}
            onSwapFocus={() => setMapFocus((f) => (f === '3d' ? '2d' : '3d'))}
            rail={
              <>
                {/* selected piece — fills the rail in 2D mode (the build tools below hide,
                    and the tile-paint tools live in the 2D map's own left rail). */}
                <Box style={{ flexBasis: mapFocus === '3d' ? '13%' : 'auto', flexGrow: mapFocus === '3d' ? 0 : 1, flexShrink: 0, minHeight: 0, borderBottomWidth: 1, borderBottomColor: '#1c2940' }}>
                  <PropertiesPanel focus={shownFocus} world={focusWorld} overrides={overrides} onOverride={applyOverride} onClearOverride={clearOverride} onSetFace={setFaceTexture} />
                </Box>
                {/* CONTEXTUAL (req_1890): the build tools (paint/skins + prop/piece) show only
                    when the 3D build map is up. When the 2D tile map is pulled up they give way
                    to the tile-paint tools, which currently ride the 2D map's own left rail. */}
                {mapFocus === '3d' ? (
                  <>
                    {/* paint / skins above, prop / piece below — roughly equal halves so
                        neither menu is cramped (req_1929: "equally spaced, no dead space").
                        The skin grid is a FITTED paged grid now, so it adapts to whatever
                        height it gets instead of collapsing — the old 54% lion's share is
                        no longer needed. */}
                    <Box style={{ flexBasis: '45%', flexShrink: 0, minHeight: 0, borderBottomWidth: 1, borderBottomColor: '#1c2940' }}>
                      <RightPanel
                        tab={tab}
                        onTab={setTab}
                        notes={notes}
                        onNotes={setNotes}
                        buildingPrefabs={buildingPrefabs}
                        onPlace={placeObject}
                        activePlaceable={activePlaceable}
                        onArmPlaceable={armPlaceable}
                        onArmScatter={armScatter}
                        paintPieces={buildPieces}
                        paintSelectedIds={isoSelectedIds}
                        armed={armed}
                        armedDraft={armedDraft}
                        onArmedDraftChange={setArmedDraft}
                        onPaintCommit={commitBuildEvents}
                        onOpenPainter={() => { requestWorkbenchSource('paint'); nav.push('/workbench'); }}
                      />
                    </Box>
                    {/* prop / piece menu — OFF the map, in the rail (req_1888) */}
                    <Box style={{ flexGrow: 1, minHeight: 0 }}>
                      <CatalogRail armed={armed} onArm={armCatalog} prefabs={buildingPrefabs} />
                    </Box>
                  </>
                ) : null}
              </>
            }
            map2d={
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
                channels={channels}
                onToggleChannel={toggleChannel}
                brush={brush}
                onBrushChange={updateBrush}
                place={place}
                showGrid={showGrid}
                onShowGrid={setShowGrid}
                onFloors={onFloors}
                onEditBegin={snapshotForUndo}
                wasdFocused={atEditor && mapFocus === '2d'}
                onWasdFocus={() => setMapFocus('2d')}
                select={tileSelect}
              />
            }
            map3d={
              // Build-only: the on-foot 'inspect' (FreeFly) view is retired here — the
              // iso authoring view is the bottom-right pane (USER req_0424). On-foot lives
              // on the /test route (F1/F2).
              <Pane label="build">
                {loaderView ? (
                  // Key on the MAP only (not worldEpoch): switching maps remounts +
                  // re-centers, but an edit must NOT remount — the loader reloads its
                  // gamefile in place via reloadToken so the camera pose is preserved.
                  <LoaderIsoView
                    key={`loader#${ws.stem}`}
                    centerX={buildCenterX}
                    centerZ={buildCenterZ}
                    reloadToken={compiledReloadKey}
                    state={previewWorld}
                    pieces={buildPieces}
                    buildings={buildingInstances}
                    prefabs={buildingPrefabs}
                    onCommit={commitPlacement}
                    onCommitMany={commitPlacements}
                    onSelectionChange={onIsoSelectionChange}
                    onPlaceWaterBody={placeWaterBodyAt}
                    requestSettleBake={requestSettleBake}
                    armed={armed}
                    onArm={setArmed}
                  />
                ) : (
                  <IsoAuthor
                    key={`${ws.stem}#${worldEpoch}`}
                    state={previewWorld}
                    pieces={buildPieces}
                    buildings={buildingInstances}
                    prefabs={buildingPrefabs}
                    onCommit={commitPlacement}
                    onCommitMany={commitPlacements}
                    focused={atEditor && mapFocus === '3d'}
                    onFocus={() => setMapFocus('3d')}
                    onSelectionChange={onIsoSelectionChange}
                    onPlaceWaterBody={placeWaterBodyAt}
                    armed={armed}
                    onArm={setArmed}
                  />
                )}
                {/* [LOADERVIEW req_1757] side-by-side toggle pinned in the pane corner */}
                <Pressable
                  onPress={() => setLoaderView((v) => !v)}
                  style={{ position: 'absolute', left: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: loaderView ? '#34d399' : '#3a4a5f', backgroundColor: loaderView ? '#0c2a20' : '#0b1220ee', zIndex: 50 }}
                >
                  <Text fontSize={9} color={loaderView ? '#6ee7b7' : '#94a3b8'} style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    {loaderView ? '● LOADER VIEW' : '○ react view'}
                  </Text>
                </Pressable>
                {/* [AUTOCOMPILE req_1865] toggle the loader pane's auto-bake. OFF stops the
                    hot-reload→compile→5-6s-lock storm while an agent edits; live overlay still
                    shows placements/skins instantly, manual Compile still bakes. Persisted. */}
                {loaderView ? (
                  <Pressable
                    onPress={() => setAutoCompile((v) => !v)}
                    style={{ position: 'absolute', left: 8, bottom: 36, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: autoCompile ? '#34d399' : '#a16207', backgroundColor: autoCompile ? '#0c2a20' : '#241a06ee', zIndex: 50 }}
                  >
                    <Text fontSize={9} color={autoCompile ? '#6ee7b7' : '#fbbf24'} style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {autoCompile ? '● AUTO-COMPILE' : '○ AUTO-COMPILE OFF'}
                    </Text>
                  </Pressable>
                ) : null}
              </Pane>
            }
          />
        ) : null}

        {/* Route surfaces live inside the shell body, so the chrome remains the
            one navigation shell. The editor panes unmount off-route; the
            workspace/session layer owns durable world and view state. */}
        <Route path="/assist3d">{() => <Assist3DRoute />}</Route>
        {/* /test (the React embodied play view) was CUT (req_1878): it was the only
            sibling route that read the live editor world, and /compiled (the native
            baked view) is the real play target every feature ships to anyway — the
            React twin was double-work. Cutting it frees the workspace from the root. */}
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
