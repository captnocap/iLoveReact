import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from '@reactjit/primitives';
import { execAsync } from '@reactjit/runtime/hooks/process';
import type { GameState } from './design';
import { compileEditorWorld, emptyEditorWorld } from './editorWorld';
import type { ChunkFloor } from './chunkFloor';
import { IsoAuthor } from './IsoAuthor';
import { QuadSplit } from './QuadSplit';
import { PaintCanvas } from './PaintCanvas';
import { PropertiesPanel, type Focus } from './PropertiesPanel';
import { RightPanel } from './RightPanel';
import { buildObjectWorld } from './objectPreview';
import { useKindTextures, kindTexturesFor } from './kindTextures';
import { Chrome, MapsMenu, EventLog } from './shell/chrome';
import { NotificationOverlayHost } from './shell/notifications';
import { loadEvents, saveEvents, type EditNote, type EditEvent } from './editLog';
import { plog, ptime, useChurn } from './perfLog';
import { Router, Route, useNavigate, useRoute } from '@reactjit/router';
import { Assist3DRoute } from './assist3d';
import { PlayRoute } from './editors/play/PlayRoute';
import { LabsRoute } from './shell/LabsRoute';
import { WorkbenchRoute } from './shell/WorkbenchRoute';
import { currentWorkbenchFamily, requestWorkbenchSource, subscribeWorkbenchFamily, type WorkbenchFamily } from './shell/workbenchDoor';
import { CompiledWorldRoute, reloadCompiledWindowIfOpen } from './CompiledWorld';
import { workbenchSources } from './editors/workbench/sources';
import { LABS } from './labs';
import { editorChannel } from './editors/store';
import { editorSessions } from './editors/sessions';
import { editorTunables, tuningStream } from './editors/tunables';
import { worldStream, buildingsStream, type PlacedBuildPiece } from './game';
import { useMapSession } from './editors/world/useMapSession';
import { useBuildUndo } from './editors/world/useBuildUndo';
import { usePlacements } from './editors/world/usePlacements';
import { assemblePreviewWorld } from './editors/world/previewWorld';

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

const GAME_BAKE_CMD = 'tools/rjit game bake 2>&1';

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
  const [compiledReloadKey, setCompiledReloadKey] = useState(0);
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
  // landforms + every current placement applied via the game's own mutators —
  // a pure assembler (editors/world/previewWorld.ts), memoized here.
  const previewWorld = useMemo<GameState>(() => ptime('previewWorld', `rebuild floors=${floors.length} placements=${placements.length}`, () =>
    assemblePreviewWorld({ baseWorld, floors, placements, mergeKindTextures })
  ), [baseWorld, placements, floors, mergeKindTextures]);
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
    }
  }, [previewWorld, logEvent, ws.stem]);

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
            onReset={resetLayout}
            topLeft={<PropertiesPanel focus={shownFocus} world={focusWorld} overrides={overrides} onOverride={applyOverride} onClearOverride={clearOverride} onSetFace={setFaceTexture} />}
            topRight={
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
                channels={channels}
                onToggleChannel={toggleChannel}
                brush={brush}
                onBrushChange={updateBrush}
                place={place}
                showGrid={showGrid}
                onShowGrid={setShowGrid}
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
