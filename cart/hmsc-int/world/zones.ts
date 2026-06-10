import type { GameState, GridCell, Vec3, Zone, ZoneFlag } from '../design';
import { worldToCell } from './grid';

// Canonical zone-flag list — the one source the wv_zone command validates
// against (kept here, beside the layer logic, so it can't drift from ZoneFlag).
export const ZONE_FLAGS: ZoneFlag[] = ['private', 'safe', 'hostile', 'restricted', 'interior'];

export function isZoneFlag(value: string): value is ZoneFlag {
  return (ZONE_FLAGS as string[]).includes(value);
}

export function zoneFlagNamesForConsole(): string {
  return ZONE_FLAGS.join(', ');
}

// World-layer logic for zones — the zones twin of roads.ts/buildings.ts. A zone
// is an axis-aligned rectangle in cells (1 tile = 1 m) carrying a name + flags +
// optional enter/exit commands. The player-drive loop (state/usePlayerDrive.ts)
// resolves the current zone each tick and fires on boundary crossings.

export function addZone(state: GameState, zone: Zone): GameState {
  return { ...state, world: { ...state.world, zones: [...state.world.zones, zone] } };
}

export function removeZone(state: GameState, id: string): GameState {
  return { ...state, world: { ...state.world, zones: state.world.zones.filter((zone) => zone.id !== id) } };
}

function cellInZone(zone: Zone, x: number, z: number): boolean {
  return x >= zone.x && x < zone.x + zone.width && z >= zone.z && z < zone.z + zone.depth;
}

// All zones containing the cell, regardless of nesting.
export function zonesAtCell(state: GameState, cell: GridCell): Zone[] {
  return state.world.zones.filter((zone) => cellInZone(zone, cell.x, cell.z));
}

// The single "current" zone at a cell — the SMALLEST (innermost) containing
// zone wins, so a private room inside a public district reports the room.
export function zoneAtCell(state: GameState, cell: GridCell): Zone | undefined {
  let best: Zone | undefined;
  let bestArea = Infinity;
  for (const zone of state.world.zones) {
    if (!cellInZone(zone, cell.x, cell.z)) continue;
    const area = zone.width * zone.depth;
    if (area < bestArea) {
      best = zone;
      bestArea = area;
    }
  }
  return best;
}

export function zonesAtWorldPosition(state: GameState, position: Vec3): Zone[] {
  return zonesAtCell(state, worldToCell(position, state.world.cellSizeMeters));
}

export function currentZone(state: GameState, position: Vec3): Zone | undefined {
  return zoneAtCell(state, worldToCell(position, state.world.cellSizeMeters));
}

// Forward seam (quest slice): does the player's state satisfy this zone's gate?
// No-op today — availability predicates (zone.availableWhen) are NOT evaluated
// until the quest slice wires them to WorldState.counters, so everything is
// available. See WORLD_AUTHORING_PLAN -> quest availability chain.
export function isZoneAvailable(_state: GameState, _zone: Zone): boolean {
  return true;
}
