// game/world/stream — the V20 per-concern stream for the world grid, defined
// in ONE registration (log name + materializer; a stream without snapshot
// support cannot be expressed — the data layer's incompleteness guard).
//
// The grid mutators' vocabulary IS the stream's event shape: every wv_place/
// wv_fill/wv_remove/wv_trigger edit (and the save checkpoint arming a
// respawn) appends an event; the materialized snapshot is the WorldGridState
// the game loads (V20: the game loads materialized snapshots, never the
// history — and ten days of bad edits steps right back). The materializer
// tolerates unknown event kinds by contract: new world features arrive as
// event ADDITIONS, old logs stay valid forever.
//
// PLACED PIECES (V24, added with the Creative Build route): the building
// piece grammar's placed records joined this stream BY ADDITION — pieces are
// plain world data (the one-model invariant: nothing in these events assumes
// a camera or authoring mode). The materialized `pieces` list is the ONE
// source of truth for what stands in the world; piece ids are minted HERE
// (`bp_<pieceSeq>`) so replaying the log reproduces identical ids. A prefab
// stamp is ONE event (one authoring action = one session commit) that lands
// as its semantic pieces — the see-through law; never an opaque blob.

import type { StreamDef } from '../../data';
import {
  addSurfaceRegion,
  createWorldGridState,
  placeCell,
  placeLandform,
  removeCell,
  removeLandform,
  setCellTrigger,
  type GridCell,
  type LandformPlacement,
  type WorldGridState,
  type WorldSurfaceRegion,
} from './grid';
import type { TileKind } from '../kinds';
import {
  BUILD_FACE_SLOTS,
  BUILD_PREFAB_DEFINITIONS,
  isCatalogId,
  isWallEdit,
  resolveFaceSkin,
  catalogEntry,
  placedPieceAcceptsEdits,
  skinSetProblems,
  stampPrefabPieces,
  validatePrefab,
  type BuildSkinSet,
  type BuildPrefabDef,
  type PlacedBuildPiece,
  type WallEdit,
} from '../build';

export type WorldStreamState = {
  grid: WorldGridState;
  /** the armed respawn cell (save checkpoints write it; boot reads it) */
  respawnCell: GridCell | null;
  /** every placed build piece, in placement order — THE placed-piece truth */
  pieces: PlacedBuildPiece[];
  /** placed build pieces by project/map. Legacy snapshots may lack this; the
   *  global `pieces` pool above stays loadable for its owning/default map until
   *  the user rules on migration. */
  piecesByMap: Record<string, PlacedBuildPiece[]>;
  /** world-saved prefab definitions (clone-from-world) — the static seeds'
   *  registry family, grown by authoring (V24 addendum: P2/V20 data) */
  prefabs: Record<string, BuildPrefabDef>;
  /** deleted building types (BUILDSKIN req_0184 addendum): tombstones so a
   *  removed STATIC SEED stays removed across the merged read; a later
   *  prefabDefined for the same id revives it. Legacy snapshots lack this. */
  removedPrefabs?: string[];
  /** the id mint — replay-deterministic (`bp_<n>`) */
  pieceSeq: number;
  /** replay-deterministic id mint per project/map */
  pieceSeqByMap: Record<string, number>;
};

/** A to-be-placed piece: everything but the id (the materializer mints it). */
export type PiecePlacement = Omit<PlacedBuildPiece, 'id'>;

export type WorldEvent =
  | { kind: 'cellPlaced'; tile: TileKind; cell: GridCell; sourceLine: string; triggerCommand?: string; triggerLabel?: string; spawnKey?: string }
  | { kind: 'cellRemoved'; cell: GridCell }
  | { kind: 'regionFilled'; region: WorldSurfaceRegion }
  | { kind: 'triggerSet'; cell: GridCell; command: string | null; label?: string }
  | { kind: 'landformPlaced'; landform: LandformPlacement }
  | { kind: 'landformRemoved'; id: string }
  | { kind: 'respawnArmed'; cell: GridCell }
  // ── V24 placed pieces (additions; older logs predate them and stay valid) ──
  | { kind: 'piecePlaced'; placement: PiecePlacement; mapName?: string }
  | { kind: 'pieceRemoved'; id: string; mapName?: string }
  | { kind: 'pieceEditSet'; id: string; edit: WallEdit; mapName?: string }
  // TOWERSKIN-0610 (addition): per-face paint on a STANDING piece — set slots
  // MERGE onto the piece's skin. Mirrors pieceEditSet so the id stays stable
  // (the editor's selection survives painting face after face).
  | { kind: 'pieceSkinSet'; id: string; skin: BuildSkinSet; mapName?: string }
  | { kind: 'prefabDefined'; def: BuildPrefabDef }
  // BUILDSKIN req_0184 addendum (addition): delete a building TYPE — drops
  // the def + tombstones the id (a same-id static seed stays gone); placed
  // stamps in the world are copies and stay standing.
  | { kind: 'prefabRemoved'; id: string }
  | { kind: 'prefabStamped'; prefabId: string; origin: { x: number; y: number; z: number }; yawDegrees: number; mapName?: string };

function eventMapName(event: { mapName?: string } | null | undefined): string | null {
  const name = typeof event?.mapName === 'string' ? event.mapName.trim() : '';
  return name.length > 0 ? name : null;
}

export function piecesForMap(
  state: WorldStreamState | null | undefined,
  mapName: string,
  opts: { legacyMapName?: string | null } = {},
): PlacedBuildPiece[] {
  const key = eventMapName({ mapName });
  const scoped = key ? (state?.piecesByMap?.[key] ?? []) : [];
  const legacy = state?.pieces ?? [];
  const legacyKey = eventMapName({ mapName: opts.legacyMapName ?? undefined });
  if (key && legacyKey === key && legacy.length > 0) return [...legacy, ...scoped];
  return scoped;
}

export function legacyGlobalPieces(state: WorldStreamState | null | undefined): PlacedBuildPiece[] {
  return state?.pieces ?? [];
}

export function pieceMutationMapName(
  state: WorldStreamState | null | undefined,
  mapName: string,
  legacyMapName: string | null | undefined,
  pieceId: string,
): string | undefined {
  const map = eventMapName({ mapName });
  if (!map) return undefined;
  if ((state?.piecesByMap?.[map] ?? []).some((piece) => piece.id === pieceId)) return map;
  const legacyMap = eventMapName({ mapName: legacyMapName ?? undefined });
  if (legacyMap === map && (state?.pieces ?? []).some((piece) => piece.id === pieceId)) return undefined;
  return map;
}

/** Mint ids and append placements — the one piece-adding step both
 *  piecePlaced and prefabStamped fold through. */
function appendPieces(state: WorldStreamState, placements: PiecePlacement[], mapName?: string): WorldStreamState {
  if (placements.length === 0) return state;
  const map = eventMapName({ mapName });
  if (map) {
    const piecesByMap = { ...(state.piecesByMap ?? {}) };
    const pieces = [...(piecesByMap[map] ?? [])];
    const pieceSeqByMap = { ...(state.pieceSeqByMap ?? {}) };
    let seq = Math.max(pieceSeqByMap[map] ?? 0, state.pieceSeq ?? 0);
    for (const placement of placements) {
      seq += 1;
      pieces.push({ ...placement, id: `bp_${seq}` });
    }
    piecesByMap[map] = pieces;
    pieceSeqByMap[map] = seq;
    return { ...state, piecesByMap, pieceSeqByMap };
  }
  const pieces = [...state.pieces];
  let seq = state.pieceSeq;
  for (const placement of placements) {
    seq += 1;
    pieces.push({ ...placement, id: `bp_${seq}` });
  }
  return { ...state, pieces, pieceSeq: seq };
}

function nextPieceSeq(state: WorldStreamState, mapName?: string): number {
  const map = eventMapName({ mapName });
  if (map) return Math.max(state.pieceSeqByMap?.[map] ?? 0, state.pieceSeq ?? 0) + 1;
  return state.pieceSeq + 1;
}

function resolvedSkinForPrefabPiece(def: BuildPrefabDef, index: number): BuildSkinSet | undefined {
  const piece = def.pieces[index];
  if (!piece) return undefined;
  const kind = catalogEntry(piece.pieceId).kind;
  const skin: BuildSkinSet = {};
  for (const slot of BUILD_FACE_SLOTS) {
    const resolved = resolveFaceSkin(def.skins, kind, piece.skin, slot).skin;
    if (resolved) skin[slot] = resolved;
  }
  return Object.keys(skin).length > 0 ? skin : undefined;
}

function refreshPrefabSkins(pieces: PlacedBuildPiece[], def: BuildPrefabDef): PlacedBuildPiece[] {
  let changed = false;
  const next = pieces.map((piece) => {
    if (piece.prefabId !== def.id || piece.prefabPieceIndex === undefined) return piece;
    const skin = resolvedSkinForPrefabPiece(def, piece.prefabPieceIndex);
    changed = true;
    if (skin) return { ...piece, skin };
    const { skin: _oldSkin, ...bare } = piece;
    return bare;
  });
  return changed ? next : pieces;
}

function refreshPrefabSkinsByMap(piecesByMap: Record<string, PlacedBuildPiece[]>, def: BuildPrefabDef): Record<string, PlacedBuildPiece[]> {
  let changed = false;
  const next: Record<string, PlacedBuildPiece[]> = {};
  for (const [map, pieces] of Object.entries(piecesByMap ?? {})) {
    const refreshed = refreshPrefabSkins(pieces, def);
    next[map] = refreshed;
    if (refreshed !== pieces) changed = true;
  }
  return changed ? next : piecesByMap;
}

export const worldStream: StreamDef<WorldStreamState, WorldEvent> = Object.freeze({
  name: 'world',
  initial: (): WorldStreamState => ({
    grid: createWorldGridState(),
    respawnCell: null,
    pieces: [],
    piecesByMap: {},
    prefabs: {},
    removedPrefabs: [],
    pieceSeq: 0,
    pieceSeqByMap: {},
  }),
  apply: (state: WorldStreamState, event: WorldEvent): WorldStreamState => {
    switch (event?.kind) {
      case 'cellPlaced':
        return {
          ...state,
          grid: placeCell(state.grid, event.tile, event.cell, event.sourceLine, {
            ...(event.triggerCommand ? { triggerCommand: event.triggerCommand } : {}),
            ...(event.triggerLabel ? { triggerLabel: event.triggerLabel } : {}),
            ...(event.spawnKey ? { spawnKey: event.spawnKey } : {}),
          }),
        };
      case 'cellRemoved':
        return { ...state, grid: removeCell(state.grid, event.cell) };
      case 'regionFilled':
        return { ...state, grid: addSurfaceRegion(state.grid, event.region) };
      case 'triggerSet':
        return { ...state, grid: setCellTrigger(state.grid, event.cell, event.command, event.label) };
      case 'landformPlaced':
        return { ...state, grid: placeLandform(state.grid, event.landform) };
      case 'landformRemoved':
        return { ...state, grid: removeLandform(state.grid, event.id) };
      case 'respawnArmed':
        return { ...state, respawnCell: event.cell };
      case 'piecePlaced':
        // tolerant by contract (a dangling catalog id from a future/foreign
        // writer is noise, not a crash) — the authoring side validates
        // BEFORE it appends (game/build validatePlacement)
        if (!event.placement || !isCatalogId(event.placement.pieceId)) return state;
        if (event.placement.edit !== undefined && !isWallEdit(event.placement.edit)) return state;
        return appendPieces(state, [event.placement], event.mapName);
      case 'pieceRemoved':
        if (eventMapName(event)) {
          const map = eventMapName(event)!;
          return { ...state, piecesByMap: { ...(state.piecesByMap ?? {}), [map]: (state.piecesByMap?.[map] ?? []).filter((piece) => piece.id !== event.id) } };
        }
        return { ...state, pieces: state.pieces.filter((piece) => piece.id !== event.id) };
      case 'pieceEditSet': {
        if (!isWallEdit(event.edit)) return state;
        const map = eventMapName(event);
        const source = map ? (state.piecesByMap?.[map] ?? []) : state.pieces;
        const index = source.findIndex((piece) => piece.id === event.id);
        if (index < 0) return state;
        // an edit on an editless kind would poison every later tags read —
        // refuse it here too (the kind contract, enforced at both layers)
        if (!placedPieceAcceptsEdits(source[index])) return state;
        const pieces = [...source];
        pieces[index] = { ...pieces[index], edit: event.edit };
        if (map) return { ...state, piecesByMap: { ...(state.piecesByMap ?? {}), [map]: pieces } };
        return { ...state, pieces };
      }
      case 'pieceSkinSet': {
        // TOWERSKIN-0610: per-face paint on a standing piece. Set slots MERGE
        // onto the existing skin (paint the front, the back stays); invalid
        // skin shapes are refused here like every other malformed event.
        if (skinSetProblems(event.skin, 'pieceSkinSet').length > 0) return state;
        if (Object.keys(event.skin).length === 0) return state;
        const map = eventMapName(event);
        const source = map ? (state.piecesByMap?.[map] ?? []) : state.pieces;
        const index = source.findIndex((piece) => piece.id === event.id);
        if (index < 0) return state;
        const pieces = [...source];
        pieces[index] = { ...pieces[index], skin: { ...(pieces[index].skin ?? {}), ...event.skin } };
        if (map) return { ...state, piecesByMap: { ...(state.piecesByMap ?? {}), [map]: pieces } };
        return { ...state, pieces };
      }
      case 'prefabDefined': {
        if (!event.def || typeof event.def.id !== 'string' || validatePrefab(event.def).length > 0) return state;
        return {
          ...state,
          prefabs: { ...state.prefabs, [event.def.id]: event.def },
          pieces: refreshPrefabSkins(state.pieces, event.def),
          piecesByMap: refreshPrefabSkinsByMap(state.piecesByMap ?? {}, event.def),
          // re-defining a deleted id revives it (the tombstone lifts)
          removedPrefabs: (state.removedPrefabs ?? []).filter((id) => id !== event.def.id),
        };
      }
      case 'prefabRemoved': {
        if (typeof event.id !== 'string' || event.id.length === 0) return state;
        const prefabs = { ...state.prefabs };
        delete prefabs[event.id];
        const removed = state.removedPrefabs ?? [];
        return {
          ...state,
          prefabs,
          removedPrefabs: removed.includes(event.id) ? removed : [...removed, event.id],
        };
      }
      case 'prefabStamped': {
        // a deleted building type cannot stamp (the seed fallback would
        // otherwise resurrect a tombstoned id)
        if ((state.removedPrefabs ?? []).includes(event.prefabId)) return state;
        // world-saved prefabs win over a same-id static seed (newest meaning)
        const def = state.prefabs[event.prefabId] ?? BUILD_PREFAB_DEFINITIONS[event.prefabId];
        if (!def) return state;
        const stampId = `bps_${nextPieceSeq(state, event.mapName)}`;
        return appendPieces(state, stampPrefabPieces(def, event.origin, event.yawDegrees).map((piece) => ({ ...piece, stampId })), event.mapName);
      }
      default:
        // Unknown kinds from the future MUST pass through untouched (V20
        // schema evolution by addition; old streams stay valid forever).
        return state;
    }
  },
});
