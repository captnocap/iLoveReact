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
  BUILD_PREFAB_DEFINITIONS,
  isCatalogId,
  isWallEdit,
  placedPieceAcceptsEdits,
  stampPrefabPieces,
  validatePrefab,
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
  /** world-saved prefab definitions (clone-from-world) — the static seeds'
   *  registry family, grown by authoring (V24 addendum: P2/V20 data) */
  prefabs: Record<string, BuildPrefabDef>;
  /** the id mint — replay-deterministic (`bp_<n>`) */
  pieceSeq: number;
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
  | { kind: 'piecePlaced'; placement: PiecePlacement }
  | { kind: 'pieceRemoved'; id: string }
  | { kind: 'pieceEditSet'; id: string; edit: WallEdit }
  | { kind: 'prefabDefined'; def: BuildPrefabDef }
  | { kind: 'prefabStamped'; prefabId: string; origin: { x: number; y: number; z: number }; yawDegrees: number };

/** Mint ids and append placements — the one piece-adding step both
 *  piecePlaced and prefabStamped fold through. */
function appendPieces(state: WorldStreamState, placements: PiecePlacement[]): WorldStreamState {
  if (placements.length === 0) return state;
  const pieces = [...state.pieces];
  let seq = state.pieceSeq;
  for (const placement of placements) {
    seq += 1;
    pieces.push({ ...placement, id: `bp_${seq}` });
  }
  return { ...state, pieces, pieceSeq: seq };
}

export const worldStream: StreamDef<WorldStreamState, WorldEvent> = Object.freeze({
  name: 'world',
  initial: (): WorldStreamState => ({
    grid: createWorldGridState(),
    respawnCell: null,
    pieces: [],
    prefabs: {},
    pieceSeq: 0,
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
        return appendPieces(state, [event.placement]);
      case 'pieceRemoved':
        return { ...state, pieces: state.pieces.filter((piece) => piece.id !== event.id) };
      case 'pieceEditSet': {
        if (!isWallEdit(event.edit)) return state;
        const index = state.pieces.findIndex((piece) => piece.id === event.id);
        if (index < 0) return state;
        // an edit on an editless kind would poison every later tags read —
        // refuse it here too (the kind contract, enforced at both layers)
        if (!placedPieceAcceptsEdits(state.pieces[index])) return state;
        const pieces = [...state.pieces];
        pieces[index] = { ...pieces[index], edit: event.edit };
        return { ...state, pieces };
      }
      case 'prefabDefined': {
        if (!event.def || typeof event.def.id !== 'string' || validatePrefab(event.def).length > 0) return state;
        return { ...state, prefabs: { ...state.prefabs, [event.def.id]: event.def } };
      }
      case 'prefabStamped': {
        // world-saved prefabs win over a same-id static seed (newest meaning)
        const def = state.prefabs[event.prefabId] ?? BUILD_PREFAB_DEFINITIONS[event.prefabId];
        if (!def) return state;
        return appendPieces(state, stampPrefabPieces(def, event.origin, event.yawDegrees));
      }
      default:
        // Unknown kinds from the future MUST pass through untouched (V20
        // schema evolution by addition; old streams stay valid forever).
        return state;
    }
  },
});
