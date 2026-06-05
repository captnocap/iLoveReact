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

export type WorldStreamState = {
  grid: WorldGridState;
  /** the armed respawn cell (save checkpoints write it; boot reads it) */
  respawnCell: GridCell | null;
};

export type WorldEvent =
  | { kind: 'cellPlaced'; tile: TileKind; cell: GridCell; sourceLine: string; triggerCommand?: string; triggerLabel?: string; spawnKey?: string }
  | { kind: 'cellRemoved'; cell: GridCell }
  | { kind: 'regionFilled'; region: WorldSurfaceRegion }
  | { kind: 'triggerSet'; cell: GridCell; command: string | null; label?: string }
  | { kind: 'landformPlaced'; landform: LandformPlacement }
  | { kind: 'landformRemoved'; id: string }
  | { kind: 'respawnArmed'; cell: GridCell };

export const worldStream: StreamDef<WorldStreamState, WorldEvent> = Object.freeze({
  name: 'world',
  initial: (): WorldStreamState => ({ grid: createWorldGridState(), respawnCell: null }),
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
      default:
        // Unknown kinds from the future MUST pass through untouched (V20
        // schema evolution by addition; old streams stay valid forever).
        return state;
    }
  },
});
