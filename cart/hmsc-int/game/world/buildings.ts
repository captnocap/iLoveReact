// game/world/buildings — BUILDINGS OWN THEIR HISTORY (req_0512 → req_0513).
//
// THE USER'S PROPOSAL, the law of this stream: "give buildings their own
// branch of history rather than storing as a global state. and then the
// building itself can just say 'i am here at this position' … every edit to
// a building is only making incredibly scoped edits in a map the size of
// vice city."
//
// The shape is the authoring-side completion of already-ruled ground:
//   • V29 — the compiled map is defs + placement references (Vice City
//     IDE/IPL). This stream applies the same law at AUTHORING time: a
//     building is ONE BuildingDef (origin-relative pieces, the same
//     BuildPrefabDef family) + ONE instance reference ("i am here").
//   • V24 — prefabs are first-class, and the bake SEES THROUGH them: the
//     derived view below decomposes every instance into its semantic placed
//     pieces, so every existing consumer (render, colliders, footprints, F2,
//     compile) keeps reading `pieces` unchanged. No second render path.
//   • V20 — new feature = NEW STREAM ('buildings'), schema evolution by
//     addition; old world logs stay valid forever. Per-building undo appends
//     REVERSE events (reconcileBuildingInstances) — shared history is never
//     rewound.
//   • V28 — the game-data shape literally starts with buildings[].
//
// A building's "branch" is its event subsequence: every event carries the
// instance (or def) id, so "the history of THIS building" is a filter over
// the one total log — never a fork of it. A move is ONE buildingMoved event
// (no 358-event remove+place storm); the edit is so scoped it doesn't need
// the optimistic layer ("the updates at this point are never optimistic").
//
// DERIVED PIECES: worldPieces = stamped(instances) ⊕ loose pieces. Piece ids
// are DETERMINISTIC per instance (`bld:<instId>:<localPieceIndex>`) so
// selection survives re-derivation and a moved building keeps its identity;
// stampId `bld:<instId>` makes the whole instance one flat-pad lift group
// (liftBuildingsToTerrain). Skins/edits ride the def through stampPrefabPieces.

import type { StreamDef } from '../../data';
import {
  BUILD_PREFAB_DEFINITIONS,
  catalogEntry,
  prefabFromPieces,
  stampPrefabPieces,
  validatePrefab,
  type BuildPrefabDef,
  type PlacedBuildPiece,
} from '../build';
import type { WorldEvent } from './stream';

// ── the instance record ("i am here at this position") ──────────────────────

export type BuildingInstance = {
  /** `bld_<n>` — minted by the materializer per map (replay-deterministic) */
  id: string;
  /** the BuildingDef this instance references (state.defs, seed fallback) */
  defId: string;
  /** world meters: the def's origin (its min corner at capture time) */
  x: number;
  y: number;
  z: number;
  /** rotation about +Y in degrees, composed onto every stamped piece */
  yawDegrees: number;
};

export type BuildingsStreamState = {
  /** BuildingDefs by id — GLOBAL/shared across maps (the multi-map ruling:
   *  maps are THIN references to SHARED globals; change a def, all follow) */
  defs: Record<string, BuildPrefabDef>;
  /** placed instances per project/map (the piecesByMap pattern) */
  instancesByMap: Record<string, Record<string, BuildingInstance>>;
  /** the instance-id mint per map — replay-deterministic (`bld_<n>`) */
  instanceSeqByMap: Record<string, number>;
};

export type BuildingsEvent =
  | { kind: 'buildingDefined'; def: BuildPrefabDef }
  | { kind: 'buildingPlaced'; defId: string; x: number; y: number; z: number; yawDegrees: number; mapName?: string }
  | { kind: 'buildingMoved'; id: string; x: number; z: number; yawDegrees?: number; mapName?: string }
  | { kind: 'buildingRemoved'; id: string; mapName?: string };

/** Everything the build surfaces commit: world events (loose pieces, grid,
 *  prefab registry) OR buildings events — the shell routes by kind to the
 *  right channel. */
export type BuildEditEvent = WorldEvent | BuildingsEvent;

export function isBuildingsEvent(event: { kind?: string } | null | undefined): event is BuildingsEvent {
  return typeof event?.kind === 'string' && event.kind.startsWith('building');
}

const DEFAULT_MAP = '';

function mapKey(mapName: string | null | undefined): string {
  const name = typeof mapName === 'string' ? mapName.trim() : '';
  return name.length > 0 ? name : DEFAULT_MAP;
}

function normalizeYaw(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

function defOf(state: BuildingsStreamState, defId: string): BuildPrefabDef | undefined {
  // stream-defined defs win over a same-id static seed (newest meaning) —
  // the prefabStamped resolution order, mirrored.
  return state.defs?.[defId] ?? BUILD_PREFAB_DEFINITIONS[defId];
}

// ── the stream ───────────────────────────────────────────────────────────────

export const buildingsStream: StreamDef<BuildingsStreamState, BuildingsEvent> = Object.freeze({
  name: 'buildings',
  initial: (): BuildingsStreamState => ({ defs: {}, instancesByMap: {}, instanceSeqByMap: {} }),
  apply: (state: BuildingsStreamState, event: BuildingsEvent): BuildingsStreamState => {
    switch (event?.kind) {
      case 'buildingDefined': {
        // tolerant by contract: a malformed def is noise, not a crash — the
        // authoring side validates BEFORE it appends (buildingDefFromPieces)
        if (!event.def || typeof event.def.id !== 'string' || validatePrefab(event.def).length > 0) return state;
        return { ...state, defs: { ...state.defs, [event.def.id]: event.def } };
      }
      case 'buildingPlaced': {
        if (typeof event.defId !== 'string' || !defOf(state, event.defId)) return state;
        if (![event.x, event.y, event.z, event.yawDegrees].every(Number.isFinite)) return state;
        const map = mapKey(event.mapName);
        const seq = Math.max(0, state.instanceSeqByMap?.[map] ?? 0) + 1;
        const id = `bld_${seq}`;
        const pool = { ...(state.instancesByMap?.[map] ?? {}) };
        pool[id] = { id, defId: event.defId, x: event.x, y: event.y, z: event.z, yawDegrees: normalizeYaw(event.yawDegrees) };
        return {
          ...state,
          instancesByMap: { ...(state.instancesByMap ?? {}), [map]: pool },
          instanceSeqByMap: { ...(state.instanceSeqByMap ?? {}), [map]: seq },
        };
      }
      case 'buildingMoved': {
        const map = mapKey(event.mapName);
        const pool = state.instancesByMap?.[map];
        const inst = pool?.[event.id];
        if (!inst) return state;
        if (!Number.isFinite(event.x) || !Number.isFinite(event.z)) return state;
        const yaw = event.yawDegrees !== undefined && Number.isFinite(event.yawDegrees)
          ? normalizeYaw(event.yawDegrees)
          : inst.yawDegrees;
        return {
          ...state,
          instancesByMap: {
            ...state.instancesByMap,
            [map]: { ...pool, [event.id]: { ...inst, x: event.x, z: event.z, yawDegrees: yaw } },
          },
        };
      }
      case 'buildingRemoved': {
        const map = mapKey(event.mapName);
        const pool = state.instancesByMap?.[map];
        if (!pool?.[event.id]) return state;
        const next = { ...pool };
        delete next[event.id];
        // the DEF survives — removing an instance never deletes the type
        // (defs are shared globals; other instances/maps may reference it)
        return { ...state, instancesByMap: { ...state.instancesByMap, [map]: next } };
      }
      default:
        // Unknown kinds from the future MUST pass through untouched (V20
        // schema evolution by addition; old streams stay valid forever).
        return state;
    }
  },
});

// ── derived piece ids ────────────────────────────────────────────────────────

/** the instance id inside a derived piece id (`bld:<instId>:<idx>`), else null */
export function buildingPieceInstanceId(pieceId: string): string | null {
  if (typeof pieceId !== 'string' || !pieceId.startsWith('bld:')) return null;
  const sep = pieceId.indexOf(':', 4);
  return sep > 4 ? pieceId.slice(4, sep) : null;
}

/** the def-local piece index inside a derived piece id, else null */
export function buildingPieceLocalIndex(pieceId: string): number | null {
  if (typeof pieceId !== 'string' || !pieceId.startsWith('bld:')) return null;
  const sep = pieceId.indexOf(':', 4);
  if (sep <= 4) return null;
  const index = Number(pieceId.slice(sep + 1));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

// ── derivation: instances → placed pieces (the compatibility contract) ───────

const EMPTY_INSTANCES: Readonly<Record<string, BuildingInstance>> = Object.freeze({});
const EMPTY_PIECES: readonly PlacedBuildPiece[] = Object.freeze([]);

/** this map's instances (defs are global; instances are per-map) */
export function instancesForMap(
  state: BuildingsStreamState | null | undefined,
  mapName: string,
): Readonly<Record<string, BuildingInstance>> {
  return state?.instancesByMap?.[mapKey(mapName)] ?? EMPTY_INSTANCES;
}

function stampInstance(def: BuildPrefabDef, inst: BuildingInstance): PlacedBuildPiece[] {
  // stampPrefabPieces carries skin + edit + prefabId/prefabPieceIndex (the
  // req_0431 invariant: a re-derivation never strips face materials); the
  // deterministic id + per-instance stampId are the building's identity.
  return stampPrefabPieces(def, { x: inst.x, y: inst.y, z: inst.z }, inst.yawDegrees)
    .map((piece, index) => ({ ...piece, id: `bld:${inst.id}:${index}`, stampId: `bld:${inst.id}` }));
}

// Re-derives reuse untouched instances' piece OBJECTS (the materializer only
// replaces the touched instance/def records), so the renderer's per-piece
// caches (pieceShapesCached, joinKeys) survive every fold that didn't touch
// that building. The per-state WeakMap keeps the derived ARRAY stable between
// renders of the same state.
type DerivedEntry = { def: BuildPrefabDef; inst: BuildingInstance; pieces: PlacedBuildPiece[] };
const derivedByInstance = new Map<string, DerivedEntry>();
const derivedByState = new WeakMap<BuildingsStreamState, Map<string, PlacedBuildPiece[]>>();

/** every instance of this map, stamped — the derived placed-piece view */
export function buildingPiecesForMap(
  state: BuildingsStreamState | null | undefined,
  mapName: string,
): readonly PlacedBuildPiece[] {
  if (!state) return EMPTY_PIECES;
  let perMap = derivedByState.get(state);
  if (!perMap) {
    perMap = new Map();
    derivedByState.set(state, perMap);
  }
  const map = mapKey(mapName);
  const cached = perMap.get(map);
  if (cached) return cached;
  const pool = state.instancesByMap?.[map] ?? EMPTY_INSTANCES;
  const out: PlacedBuildPiece[] = [];
  for (const inst of Object.values(pool)) {
    const def = defOf(state, inst.defId);
    if (!def) continue; // a dangling defId is noise, not a crash
    const key = `${map}/${inst.id}`;
    const entry = derivedByInstance.get(key);
    if (entry && entry.def === def && entry.inst === inst) {
      out.push(...entry.pieces);
      continue;
    }
    const pieces = stampInstance(def, inst);
    derivedByInstance.set(key, { def, inst, pieces });
    out.push(...pieces);
  }
  // prune entries for instances this map no longer holds (bounded cache)
  const prefix = `${map}/`;
  for (const key of derivedByInstance.keys()) {
    if (key.startsWith(prefix) && !(key.slice(prefix.length) in pool)) derivedByInstance.delete(key);
  }
  perMap.set(map, out);
  return out;
}

/** the ONE pieces view every consumer reads: loose pieces ⊕ stamped instances.
 *  Identity-preserving when the map has no buildings (zero new allocations on
 *  the hot path of a buildings-free map). */
export function withBuildingPieces(
  base: PlacedBuildPiece[],
  state: BuildingsStreamState | null | undefined,
  mapName: string,
): PlacedBuildPiece[] {
  const derived = buildingPiecesForMap(state, mapName);
  if (derived.length === 0) return base;
  return [...base, ...derived];
}

// ── authoring helpers ────────────────────────────────────────────────────────

/** `bld.<slug>-<mint>` — authored-side unique (the tower-stampId idiom) */
export function mintBuildingDefId(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'building';
  return `bld.${slug}-${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export type BuildingCapture = {
  def: BuildPrefabDef;
  /** where to place the instance so the stamp reproduces the captured pieces
   *  exactly (the def's locals are relative to this min corner) */
  origin: { x: number; y: number; z: number };
};

/** Capture world pieces into a BuildingDef + its placement origin — the
 *  promote/tower door. Returns null when the capture would be refused by the
 *  stream (so the caller never half-commits: removing the loose pieces
 *  without a standing building is the one unforgivable outcome). */
export function buildingDefFromPieces(
  label: string,
  pieces: readonly Omit<PlacedBuildPiece, 'id'>[],
): BuildingCapture | null {
  if (!pieces.length) return null;
  let x = Infinity;
  let y = Infinity;
  let z = Infinity;
  for (const p of pieces) {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    z = Math.min(z, p.z);
  }
  const theme = catalogEntry(pieces[0].pieceId).theme;
  // prefabFromPieces reads pose/edit/skin only — the id is never touched
  const def = prefabFromPieces(mintBuildingDefId(label), label, theme, pieces as readonly PlacedBuildPiece[]);
  if (validatePrefab(def).length > 0) return null;
  return { def, origin: { x, y, z } };
}

/** the owning map for a mutation on instance `id` (the pieceMutationMapName
 *  twin): the active map when it holds the instance; undefined when the
 *  instance lives in the default (unscoped) pool. */
export function buildingMutationMapName(
  state: BuildingsStreamState | null | undefined,
  mapName: string,
  id: string,
): string | undefined {
  const map = mapKey(mapName);
  if (state?.instancesByMap?.[map]?.[id]) return map === DEFAULT_MAP ? undefined : map;
  if (state?.instancesByMap?.[DEFAULT_MAP]?.[id]) return undefined;
  return map === DEFAULT_MAP ? undefined : map;
}

// ── selection partition (whole-building ops vs loose pieces) ─────────────────

export type BuildingSelectionPartition = {
  /** instances whose EVERY derived piece is selected — whole-building ops */
  wholeInstances: string[];
  /** instances only partially covered — piece-scoped building edits are
   *  slice 2; callers skip these (loudly), never half-mutate */
  partialInstances: string[];
  /** selected ids that are plain world pieces */
  loosePieceIds: string[];
};

export function partitionBuildingSelection(
  selectedIds: ReadonlySet<string>,
  pieces: readonly PlacedBuildPiece[],
): BuildingSelectionPartition {
  const selectedByInstance = new Map<string, number>();
  const totalByInstance = new Map<string, number>();
  const loosePieceIds: string[] = [];
  for (const piece of pieces) {
    const inst = buildingPieceInstanceId(piece.id);
    if (inst) {
      totalByInstance.set(inst, (totalByInstance.get(inst) ?? 0) + 1);
      if (selectedIds.has(piece.id)) selectedByInstance.set(inst, (selectedByInstance.get(inst) ?? 0) + 1);
    } else if (selectedIds.has(piece.id)) {
      loosePieceIds.push(piece.id);
    }
  }
  const wholeInstances: string[] = [];
  const partialInstances: string[] = [];
  for (const [inst, n] of selectedByInstance) {
    (n === totalByInstance.get(inst) ? wholeInstances : partialInstances).push(inst);
  }
  return { wholeInstances, partialInstances, loosePieceIds };
}

// ── undo: REVERSE events over the building branch (V20: never rewind) ────────

const DEG = Math.PI / 180;

/** invert the stamp: the instance pose that puts def piece `index` at `piece` */
function instancePoseFromPiece(
  def: BuildPrefabDef,
  index: number,
  piece: { x: number; z: number; yawDegrees: number },
): { x: number; z: number; yawDegrees: number } | null {
  const local = def.pieces[index];
  if (!local) return null;
  const yaw = normalizeYaw(piece.yawDegrees - local.yawDegrees);
  const cos = Math.cos(yaw * DEG);
  const sin = Math.sin(yaw * DEG);
  // stampPrefabPieces: world = origin + (lx·cos − lz·sin, lx·sin + lz·cos)
  return {
    x: piece.x - (local.x * cos - local.z * sin),
    z: piece.z - (local.x * sin + local.z * cos),
    yawDegrees: yaw,
  };
}

/**
 * The buildings-channel REVERSE events that turn `current` derived pieces into
 * `target` (both this-map views, building pieces only considered). Ctrl+Z's
 * apply side: a moved instance gets ONE buildingMoved back, a promoted/placed
 * instance present only in current gets buildingRemoved (the loose-piece diff
 * re-places its originals), an instance present only in target gets
 * re-placed by pose reconstruction (defs are shared globals and survive
 * removal, so the def is always there to stamp from).
 */
export function reconcileBuildingInstances(
  current: readonly PlacedBuildPiece[],
  target: readonly PlacedBuildPiece[],
  state: BuildingsStreamState | null | undefined,
  mapName: string,
): BuildingsEvent[] {
  type Group = Map<number, PlacedBuildPiece>;
  const group = (pieces: readonly PlacedBuildPiece[]): Map<string, Group> => {
    const out = new Map<string, Group>();
    for (const piece of pieces) {
      const inst = buildingPieceInstanceId(piece.id);
      if (!inst) continue;
      const index = buildingPieceLocalIndex(piece.id);
      if (index === null) continue;
      const g = out.get(inst);
      if (g) g.set(index, piece);
      else out.set(inst, new Map([[index, piece]]));
    }
    return out;
  };
  const cur = group(current);
  const tgt = group(target);
  const pool = state?.instancesByMap?.[mapKey(mapName)] ?? EMPTY_INSTANCES;
  const events: BuildingsEvent[] = [];
  const eps = 1e-6;
  for (const [inst, curPieces] of cur) {
    const tgtPieces = tgt.get(inst);
    if (!tgtPieces) {
      events.push({ kind: 'buildingRemoved', id: inst });
      continue;
    }
    const live = pool[inst];
    const def = live ? defOf(state as BuildingsStreamState, live.defId) : undefined;
    if (!live || !def) continue;
    // one shared index decides the pose delta (the stamp is rigid)
    for (const [index, tp] of tgtPieces) {
      if (!curPieces.has(index)) continue;
      const pose = instancePoseFromPiece(def, index, tp);
      if (!pose) break;
      const yawDiff = Math.abs(normalizeYaw(pose.yawDegrees - live.yawDegrees + 180) - 180);
      if (Math.abs(pose.x - live.x) > eps || Math.abs(pose.z - live.z) > eps || yawDiff > eps) {
        events.push({
          kind: 'buildingMoved',
          id: inst,
          x: pose.x,
          z: pose.z,
          ...(yawDiff > eps ? { yawDegrees: pose.yawDegrees } : {}),
        });
      }
      break;
    }
  }
  for (const [inst, tgtPieces] of tgt) {
    if (cur.has(inst)) continue;
    // re-place from the snapshot's derived pieces: defId rides prefabId
    const first = tgtPieces.entries().next();
    if (first.done) continue;
    const [index, tp] = first.value;
    const defId = tp.prefabId;
    if (!defId) continue;
    const def = defOf((state ?? buildingsStream.initial()) as BuildingsStreamState, defId);
    if (!def) continue;
    const pose = instancePoseFromPiece(def, index, tp);
    if (!pose) continue;
    events.push({
      kind: 'buildingPlaced',
      defId,
      x: pose.x,
      y: tp.y - (def.pieces[index]?.y ?? 0),
      z: pose.z,
      yawDegrees: pose.yawDegrees,
    });
  }
  return events;
}
