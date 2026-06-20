// editors/world/usePlacements.ts — the legacy placement CRUD (SHELLFOLD-0611,
// review §2 seam 3). The 'place' layer's verbs: arm a placeable, drop/paint/
// move/rotate/clone/remove placements, delete a build footprint as ONE batch,
// re-skin a selected building's face. State (the placements array, selection,
// placeSeq) lives in useMapSession — it persists with the map; this hook owns
// only the verbs and the `place` API the canvas consumes.

import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { BuildingFaceRole, BuildingSkin } from '../../design';
import { applyFaceSkin } from '../../buildingEditor';
import { placementCellRect, resolvePlaceable, type Placement, type PlaceCat } from '../../placements';
import { SCATTER_BRUSHES, type ScatterBrushId } from '../../game/kinds/scatter';
import { graphToBuildWorld, mapBuildFootprints, mapBuildPlaceable } from '../../mapBuildPlacements';
import { partitionBuildingSelection, type BuildEditEvent, type BuildPrefabDef, type PlacedBuildPiece } from '../../game';
import { TILE_UNITS } from '../../heightData';
import type { EditNote } from '../../editLog';
import type { Tool, Layer } from '../../PaintCanvas';
import type { TabId } from '../../RightPanel';

export type ActivePlaceable = {
  cat: PlaceCat; kind: string; label: string; color: string; footW: number; footD: number; rotation: number;
  /** SCATTERBRUSH-0611: armed as a procedural nature brush — the stroke rolls
   *  weighted prop placements per tile instead of stamping `kind` directly. */
  scatter?: ScatterBrushId;
} | null;

export function usePlacements(opts: {
  placements: Placement[];
  setPlacements: Dispatch<SetStateAction<Placement[]>>;
  placeSeq: MutableRefObject<number>;
  selPlaceId: string | null;
  setSelPlaceId: Dispatch<SetStateAction<string | null>>;
  selBuildId: string | null;
  setSelBuildId: Dispatch<SetStateAction<string | null>>;
  stem: string;
  buildingPrefabs: BuildPrefabDef[];
  buildFootprints: ReturnType<typeof mapBuildFootprints>;
  buildPiecesRef: MutableRefObject<PlacedBuildPiece[]>;
  commitBuildEvent: (event: BuildEditEvent, label: string) => boolean;
  commitBuildEvents: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => boolean;
  snapshotForUndo: () => void;
  snapshotForUndoCoalesced: () => void;
  logEvent: (note: EditNote) => void;
  logCoalesced: (note: EditNote) => void;
  setLayer: (l: Layer) => void;
  setTool: (t: Tool) => void;
  setTab: (t: TabId) => void;
}) {
  const {
    placements, setPlacements, placeSeq, selPlaceId, setSelPlaceId, selBuildId, setSelBuildId,
    stem, buildingPrefabs, buildFootprints, buildPiecesRef,
    commitBuildEvent, commitBuildEvents, snapshotForUndo, snapshotForUndoCoalesced,
    logEvent, logCoalesced, setLayer, setTool, setTab,
  } = opts;

  const [activePlaceable, setActivePlaceable] = useState<ActivePlaceable>(null);

  // A ref so the id-only handlers can name a placement in the log without a stale
  // closure over `placements`.
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
  const buildFootprintsRef = useRef(buildFootprints);
  buildFootprintsRef.current = buildFootprints;
  const labelOf = (id: string) => placementsRef.current.find((p) => p.id === id)?.label ?? 'object';

  // The model viewer's + drops the selected kind at the origin, selects it, and
  // switches the painter to the place layer ("brings the view into this layer").
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
  }, [buildingPrefabs, setLayer, setTool, setTab]);

  // Arm a procedural nature brush (SCATTERBRUSH-0611): rides the same armed-
  // placeable channel, so the painter's place stroke, ghost, and Esc-to-clear
  // all just work; the stroke branches on `scatter` to roll the mix.
  const armScatter = useCallback((id: ScatterBrushId) => {
    const def = SCATTER_BRUSHES[id];
    setActivePlaceable({ cat: 'prop', kind: def.entries[0].kind, label: def.label, color: def.color, footW: 1, footD: 1, rotation: 0, scatter: id });
    setLayer('place');
    setTool('brush');
    setTab('objects');
  }, [setLayer, setTool, setTab]);

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
  }, [placeSeq, setPlacements, setSelPlaceId]);

  const placeObject = useCallback((cat: PlaceCat, kind: string) => {
    if (cat === 'building') {
      const def = buildingPrefabs.find((prefab) => prefab.id === kind);
      if (!def) return;
      armPlaceable(cat, kind);
      const origin = graphToBuildWorld(0, 0);
      commitBuildEvent({ kind: 'prefabStamped', prefabId: def.id, origin, yawDegrees: activePlaceable?.rotation ?? 0 }, `${stem}: object: placed ${def.label}`);
      logEvent({ cat: 'object', text: `placed ${def.label}` });
      setLayer('place');
      return;
    }
    snapshotForUndo(); // pre-add
    armPlaceable(cat, kind);
    const base = addPlacement(cat, kind, 0, 0, activePlaceable?.rotation ?? 0);
    setLayer('place');
    logEvent({ cat: 'object', text: `placed ${base.label}` });
  }, [buildingPrefabs, armPlaceable, commitBuildEvent, stem, activePlaceable?.rotation, logEvent, snapshotForUndo, addPlacement, setLayer]);

  const paintObjectAt = useCallback((cat: PlaceCat, kind: string, gx: number, gy: number, rotation: number) => {
    if (cat === 'building') {
      const def = buildingPrefabs.find((prefab) => prefab.id === kind);
      if (!def) return;
      const origin = graphToBuildWorld(gx, gy);
      commitBuildEvent({ kind: 'prefabStamped', prefabId: def.id, origin, yawDegrees: rotation }, `${stem}: object: stamped ${def.label}`);
      logCoalesced({ cat: 'object', text: `painted ${def.label}` });
      return;
    }
    const base = addPlacement(cat, kind, gx, gy, rotation);
    logCoalesced({ cat: 'object', text: `painted ${base.label}` });
  }, [buildingPrefabs, commitBuildEvent, stem, addPlacement, logCoalesced]);

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
  }, [snapshotForUndoCoalesced, logCoalesced, setPlacements]);

  const updatePlacement = useCallback((id: string, patch: Partial<Placement>) => {
    snapshotForUndoCoalesced();
    setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if ('locked' in patch) logEvent({ cat: 'object', text: `${patch.locked ? 'locked' : 'unlocked'} ${labelOf(id)}` });
    else logCoalesced({ cat: 'object', text: `rotated ${labelOf(id)}` });
  }, [snapshotForUndoCoalesced, logEvent, logCoalesced, setPlacements]);

  const removePlacement = useCallback((id: string) => {
    snapshotForUndo();
    logEvent({ cat: 'object', text: `removed ${labelOf(id)}` });
    setPlacements((ps) => ps.filter((p) => p.id !== id));
    setSelPlaceId((s) => (s === id ? null : s));
  }, [snapshotForUndo, logEvent, setPlacements, setSelPlaceId]);

  const removeBuildPlacement = useCallback((id: string) => {
    const fp = buildFootprintsRef.current.find((p) => p.id === id);
    if (!fp) return;
    // ONE batch (one snapshot, one undo step) — deleting a big building was N per-piece
    // commits, each re-materializing the store. A footprint over a BUILDING
    // INSTANCE (req_0513) deletes by ONE buildingRemoved on its own branch;
    // loose pieces keep the per-piece removes.
    const { wholeInstances, loosePieceIds } = partitionBuildingSelection(new Set(fp.pieceIds), buildPiecesRef.current);
    commitBuildEvents([
      ...wholeInstances.map((instId) => ({ event: { kind: 'buildingRemoved', id: instId } as BuildEditEvent, label: `${stem}: object: removed ${fp.label}` })),
      ...loosePieceIds.map((pieceId) => ({ event: { kind: 'pieceRemoved', id: pieceId } as BuildEditEvent, label: `${stem}: object: removed ${fp.label}` })),
    ]);
    logEvent({ cat: 'object', text: `removed ${fp.label}` });
    setSelBuildId((s) => (s === id ? null : s));
  }, [commitBuildEvents, stem, logEvent, buildPiecesRef, setSelBuildId]);

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
  }, [snapshotForUndo, logEvent, placeSeq, setPlacements, setSelPlaceId]);

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

  // INTERSECTIONS-0619 (req_1480): replace the DERIVED intersection placements
  // (`gen`-tagged: stop signs, lights, street-name signs) with a freshly-generated
  // set, preserving hand placements. No undo snapshot — they're a pure function of
  // the road network + control types, regenerated whenever those change. A no-op
  // guard keeps an unchanged set from churning the store (and the canvas memo).
  const syncGenerated = useCallback((gen: Placement[]) => {
    setPlacements((ps) => {
      const prevGen = ps.filter((p) => p.gen);
      const same = prevGen.length === gen.length && prevGen.every((p, i) =>
        p.id === gen[i].id && p.gx === gen[i].gx && p.gy === gen[i].gy &&
        p.rotation === gen[i].rotation && p.kind === gen[i].kind && p.text === gen[i].text);
      if (same) return ps;
      return [...ps.filter((p) => !p.gen), ...gen];
    });
  }, [setPlacements]);

  // The `place` API the canvas + panels consume — one object, stable between
  // renders unless an input actually changed (the memoized canvas depends on it).
  const place = useMemo(() => ({
    items: placements, selId: selPlaceId, active: activePlaceable, buildItems: buildFootprints, buildSelId: selBuildId,
    onSelect: setSelPlaceId, onSelectBuild: setSelBuildId, onArm: armPlaceable, onRotateBrush: rotatePlaceBrush, onPaintAt: paintObjectAt,
    onMove: movePlacement, onUpdate: updatePlacement, onClone: clonePlacement, onDelete: removePlacement,
    onDeleteBuild: removeBuildPlacement, onSyncGenerated: syncGenerated,
  }), [placements, selPlaceId, activePlaceable, buildFootprints, selBuildId, setSelPlaceId, setSelBuildId, armPlaceable, rotatePlaceBrush, paintObjectAt, movePlacement, updatePlacement, clonePlacement, removePlacement, removeBuildPlacement, syncGenerated]);

  return { place, activePlaceable, armPlaceable, armScatter, placeObject, setFaceTexture };
}
