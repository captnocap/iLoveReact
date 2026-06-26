// editors/world/useBuildUndo.ts — the build-piece undo reconciler + the build
// commit paths (SHELLFOLD-0611, review §2 seam 2). One concern: how build
// edits enter their streams (scoped to the right map, one undo step per
// interaction) and how Ctrl+Z brings the streams BACK to a snapshot's piece
// set (V20: undo APPENDS compensating events; the shared history is never
// rewound).
//
// The four `(session as { commitMany?: … })` structural casts the shell used
// to carry are gone: commitMany IS the RouteSession contract
// (editors/sessions.ts:117) — call it like one.

import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { StreamHandle } from '../../data';
import { appendProbe, resetAppendProbe } from '../../data';
import type { RouteSession } from '../sessions';
import {
  GAME_BUILD, pieceMutationMapName, piecesForMap,
  buildingMutationMapName, buildingPieceInstanceId, instancesForMap, isBuildingsEvent,
  reconcileBuildingInstances, withBuildingPieces,
  type BuildEditEvent, type BuildPrefabDef, type BuildingsEvent, type BuildingsStreamState,
  type PlacedBuildPiece, type WorldEvent, type WorldStreamState,
} from '../../game';
import { mapBuildFootprints } from '../../mapBuildPlacements';

// STOREPROBE (req_1984, TEMP): one line per place naming the SQLite store cost.
//   undoSnap = snapshotForUndo() (reads/serializes pre-edit state for Ctrl+Z)
//   commit   = worldSession.commit() wall time (append + any synchronous flush)
//   append breakdown (appendProbe, ms): seq SELECT MAX, JSON.stringify, INSERT, in-memory fold
function logStoreProbe(t0: number, tCommit: number, tEnd: number): void {
  const f = (n: number) => n.toFixed(1);
  console.warn(
    `[store-probe] place total=${f(tEnd - t0)}ms = undoSnap ${f(tCommit - t0)} + commit ${f(tEnd - tCommit)} ` +
      `| append(n=${appendProbe.count}): seq ${f(appendProbe.seqMs)} json ${f(appendProbe.jsonMs)} insert ${f(appendProbe.insertMs)} fold ${f(appendProbe.foldMs)}`,
  );
}

// A build piece's VALUE identity (everything but its stream-minted id), so undo can
// reconcile by value: replaying history mints fresh ids, so the snapshot's pieces never
// match the live ones by id — only by what they ARE (kind, pose, edit, material skin).
export function pieceValueKey(p: Omit<PlacedBuildPiece, 'id'>): string {
  return `${p.pieceId}|${p.x}|${p.y}|${p.z}|${p.yawDegrees}|${p.edit ?? ''}|${p.skin ? JSON.stringify(p.skin) : ''}`;
}

// The minimal place/remove set to turn `current` into `target` (both this-map pieces),
// matched as multisets by value key — so an undo only touches the pieces that actually
// differ, leaving the rest of the map alone. removes carry live ids; places carry the
// target piece data minus its id (the stream mints a new one on replay).
export function reconcileBuildPieces(
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

export interface BuildUndoApi {
  /** worldChannel.state() as of this render (re-read on every commit bump) */
  streamState: WorldStreamState | null;
  buildingsState: BuildingsStreamState | null;
  /** built-in + stream-defined prefabs, removed ones filtered, label-sorted */
  buildingPrefabs: BuildPrefabDef[];
  /** THE one pieces view (req_0513): loose world pieces ⊕ derived building stamps */
  buildPieces: PlacedBuildPiece[];
  buildingInstances: ReturnType<typeof instancesForMap>;
  buildFootprints: ReturnType<typeof mapBuildFootprints>;
  commitBuildEvent: (event: BuildEditEvent, label: string) => boolean;
  commitBuildEvents: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => boolean;
}

export function useBuildUndo(opts: {
  worldChannel: StreamHandle<WorldStreamState, WorldEvent> | null;
  buildingsChannel: StreamHandle<BuildingsStreamState, BuildingsEvent> | null;
  worldSession: RouteSession<WorldEvent> | null;
  buildingsSession: RouteSession<BuildingsEvent> | null;
  stem: string;
  legacyPieceMapName: string | null;
  /** record the pre-edit state so Ctrl+Z reverts this build edit */
  snapshotForUndo: () => void;
  /** fed each render so buildPayload (in useMapSession) snapshots the live pieces */
  buildPiecesRef: MutableRefObject<PlacedBuildPiece[]>;
  /** filled each render so applyPayload (empty-dep, ref-driven) can revert
   *  build edits on Ctrl+Z without a circular dep */
  reconcileBuildUndoRef: MutableRefObject<(target: PlacedBuildPiece[] | undefined, reason?: 'restore' | 'history') => void>;
  /** PLACEPERF req_2012: only the dashboard census and the 2D map canvas read
   *  footprints; while you build in the 3D loader (its only consumer is the
   *  frozen PiP) the grouping is pure O(world) garbage per place. false ⇒ skip
   *  the census and return the last set, so the place memo it feeds also stays
   *  identity-stable. Defaults to computing (callers that don't pass it keep the
   *  old always-on behavior). */
  needFootprints?: boolean;
}): BuildUndoApi {
  const { worldChannel, buildingsChannel, worldSession, buildingsSession, stem, legacyPieceMapName, snapshotForUndo } = opts;
  // Revision tick: forces the consumer to re-read channel state after a commit.
  const [mapBuildRev, setMapBuildRev] = useState(0);
  void mapBuildRev;

  const streamState: WorldStreamState | null = worldChannel ? worldChannel.state() : null;
  const buildingsState: BuildingsStreamState | null = buildingsChannel ? buildingsChannel.state() : null;
  // MEMOSTABLE req_1971: scopeBuildEvent reads the CURRENT state via refs, not deps — so the commit
  // callbacks keep a STABLE identity across commits. Their deps used to include streamState/
  // buildingsState (which change every commit), giving onCommit/onPaintCommit a fresh identity each
  // place and re-rendering every panel that takes them (RightPanel, etc.). A place doesn't change
  // stem, so the callbacks are now stable.
  const streamStateRef = useRef(streamState);
  streamStateRef.current = streamState;
  const buildingsStateRef = useRef(buildingsState);
  buildingsStateRef.current = buildingsState;

  // PANELSKIP req_1965: MEMOIZE on the prefab-relevant state only. This was an IIFE producing a
  // NEW array every render — fed to BOTH RightPanel and CatalogRail, it silently defeated their
  // memos so a piece place (which never touches prefabs) re-rendered the whole rail. A place
  // doesn't change streamState.prefabs/removedPrefabs, so the array identity now stays stable.
  const buildingPrefabs: BuildPrefabDef[] = useMemo(() => {
    const removed = new Set(streamState?.removedPrefabs ?? []);
    const merged: Record<string, BuildPrefabDef> = {};
    for (const id of GAME_BUILD.prefabs.ids) merged[id] = GAME_BUILD.prefabs.get(id);
    for (const def of Object.values(streamState?.prefabs ?? {})) merged[def.id] = def;
    return Object.values(merged).filter((def) => !removed.has(def.id)).sort((a, b) => a.label.localeCompare(b.label));
  }, [streamState?.prefabs, streamState?.removedPrefabs]);

  // Memoized so the merged array identity is stable between renders —
  // pieceGridOf/liftToTerrain/mapBuildFootprints all cache on array identity.
  const buildPieces = useMemo(
    () => withBuildingPieces(piecesForMap(streamState, stem, { legacyMapName: legacyPieceMapName }), buildingsState, stem),
    [streamState, buildingsState, stem, legacyPieceMapName],
  );
  const buildingInstances = useMemo(() => instancesForMap(buildingsState, stem), [buildingsState, stem]);
  opts.buildPiecesRef.current = buildPieces; // feed the current pieces into buildPayload's snapshot
  // PLACEPERF req_2012: the footprint census walks connectivity over the whole
  // world (O(world), ~30ms+ and climbing per place). Its only consumers are the
  // dashboard and the 2D map canvas; while you build in the 3D loader neither is
  // live (the canvas is the frozen PiP), so the grouping is pure waste per place.
  // Compute it once on mount (so the PiP shows the loaded map's buildings on boot)
  // and whenever a consumer actually needs it; otherwise hold the last set, which
  // ALSO keeps the place memo it feeds identity-stable. The recompute on the swap-
  // to-2D render makes the canvas current again.
  const lastFootprintsRef = useRef<ReturnType<typeof mapBuildFootprints>>([]);
  const footprintsSeededRef = useRef(false);
  if (opts.needFootprints !== false || !footprintsSeededRef.current) {
    footprintsSeededRef.current = true;
    lastFootprintsRef.current = mapBuildFootprints(buildPieces);
  }
  const buildFootprints = lastFootprintsRef.current;

  // Tag a build event with the map it belongs to (places/stamps go to the active
  // stem; removes/edits resolve the owning map from the existing piece). Shared by the
  // single and batch commit paths so they scope identically.
  const scopeBuildEvent = useCallback((event: BuildEditEvent): BuildEditEvent => {
    switch (event.kind) {
      case 'piecePlaced':
      case 'prefabStamped':
        return { ...event, mapName: stem } as WorldEvent;
      case 'pieceRemoved':
      case 'pieceEditSet':
      case 'pieceMoved':
      case 'pieceSwapped':
      case 'pieceSkinSet':
      case 'piecePartTextureSet':
      // PARAMETRIC props (req_0893): the sign-text edit is a per-piece mutation
      // like skin/part — it MUST carry the owning map's name or the reducer looks
      // in the wrong piece bucket and the edit silently no-ops (req_0898).
      case 'pieceTextSet': {
        const mapName = pieceMutationMapName(streamStateRef.current, stem, legacyPieceMapName, event.id);
        return mapName ? ({ ...event, mapName } as WorldEvent) : event;
      }
      // buildings (req_0513): instances are per-map; defs are shared globals
      // (buildingDefined carries no map scope by design).
      case 'buildingPlaced':
        return { ...event, mapName: stem } as BuildingsEvent;
      case 'buildingMoved':
      case 'buildingRemoved': {
        const mapName = buildingMutationMapName(buildingsStateRef.current, stem, event.id);
        return mapName ? ({ ...event, mapName } as BuildingsEvent) : event;
      }
      default:
        return event;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state read via refs above (stable identity)
  }, [stem, legacyPieceMapName]);

  const commitBuildEvent = useCallback((event: BuildEditEvent, label: string) => {
    const scoped = scopeBuildEvent(event);
    // STOREPROBE (req_1984, TEMP): a straight log of the SQLite store read/write a
    // single place actually pays — the undo snapshot (a store read/serialize), and
    // the append's seq SELECT + JSON + INSERT + in-memory fold (appendProbe). Tells
    // us, with NUMBERS, whether the per-place cost is the store, not a guess.
    const _now = () => (globalThis as any).performance?.now?.() ?? Date.now();
    const _t0 = _now();
    resetAppendProbe();
    if (isBuildingsEvent(scoped)) {
      if (!buildingsSession) return false;
      snapshotForUndo();
      const _tCommit = _now();
      buildingsSession.commit(scoped, label);
      logStoreProbe(_t0, _tCommit, _now());
    } else {
      if (!worldSession) return false;
      snapshotForUndo(); // record the pre-edit state so Ctrl+Z reverts this build edit
      const _tCommit = _now();
      worldSession.commit(scoped as WorldEvent, label);
      logStoreProbe(_t0, _tCommit, _now());
    }
    setMapBuildRev((r) => r + 1);
    return true;
  }, [worldSession, buildingsSession, scopeBuildEvent, snapshotForUndo]);

  // MANY build events as ONE undoable action: snapshot once, append every event with a
  // SINGLE store snapshot pass (RouteSession.commitMany), bump once. Without this a
  // bulk op (move/clone/delete a 352-piece building = hundreds of events) re-materialized
  // the whole store per event and froze the editor — and undo would step one piece at a
  // time. Building events route to their OWN channel (req_0513): the batch splits by
  // stream, buildings first (a promote defines/places before its loose pieces
  // are removed), and the deferred snapshot pass coalesces both into one flush.
  const commitBuildEvents = useCallback((items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => {
    if (!items.length) return false;
    const scoped = items.map((it) => ({ event: scopeBuildEvent(it.event), label: it.label }));
    const bld = scoped.filter((it): it is { event: BuildingsEvent; label: string } => isBuildingsEvent(it.event));
    const wrl = scoped.filter((it): it is { event: WorldEvent; label: string } => !isBuildingsEvent(it.event));
    if ((bld.length > 0 && !buildingsSession) || (wrl.length > 0 && !worldSession)) return false;
    snapshotForUndo();
    if (bld.length > 0 && buildingsSession) buildingsSession.commitMany(bld);
    if (wrl.length > 0 && worldSession) worldSession.commitMany(wrl);
    setMapBuildRev((r) => r + 1);
    return true;
  }, [worldSession, buildingsSession, scopeBuildEvent, snapshotForUndo]);

  // The apply-side of build undo, refreshed each render so applyPayload (empty-dep) can
  // call the latest through reconcileBuildUndoRef. On a 'history' apply only: diff the
  // live pieces against the snapshot's and append the compensating place/remove events
  // (one batch, one snapshot) so the worldStream returns to the snapshot's piece set.
  // Does NOT snapshotForUndo — an undo must not itself record an undo step.
  opts.reconcileBuildUndoRef.current = (target, reason) => {
    if (reason !== 'history' || !worldSession || !Array.isArray(target)) return;
    const current = withBuildingPieces(
      piecesForMap(streamState, stem, { legacyMapName: legacyPieceMapName }),
      buildingsState,
      stem,
    );
    // LOOSE pieces reconcile by value (place/remove); BUILDING instances get
    // REVERSE events on their own branch (req_0513 — V20: undo APPENDS, the
    // shared history is never rewound). Derived `bld:` pieces must never leak
    // into the loose diff: a moved building would otherwise re-place its old
    // stamp as loose duplicates.
    const isLoose = (p: PlacedBuildPiece) => buildingPieceInstanceId(p.id) === null;
    const { removes, places } = reconcileBuildPieces(current.filter(isLoose), target.filter(isLoose));
    const buildingEvents = reconcileBuildingInstances(current, target, buildingsState, stem);
    if (!removes.length && !places.length && !buildingEvents.length) return;
    if (buildingEvents.length && buildingsSession) {
      buildingsSession.commitMany(buildingEvents.map((event) => ({ event: scopeBuildEvent(event) as BuildingsEvent, label: 'undo: building' })));
    }
    const events = [
      ...removes.map((id) => ({ event: scopeBuildEvent({ kind: 'pieceRemoved', id }) as WorldEvent, label: 'undo: remove piece' })),
      ...places.map((placement) => ({ event: scopeBuildEvent({ kind: 'piecePlaced', placement }) as WorldEvent, label: 'undo: place piece' })),
    ];
    if (events.length) worldSession.commitMany(events);
    setMapBuildRev((r) => r + 1);
  };

  return { streamState, buildingsState, buildingPrefabs, buildPieces, buildingInstances, buildFootprints, commitBuildEvent, commitBuildEvents };
}
