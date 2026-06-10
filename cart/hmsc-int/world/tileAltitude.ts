import type { GameState, GridCell, TileKind } from '../design';
import { landformGroundTopAt } from './landforms';
import { tileKindDefinition } from './tileKinds';

export type TileAltitudeSource = 'heightfield' | 'cell';

export type TileAltitudeSample = {
  kind: TileKind;
  source: TileAltitudeSource;
  baseMeters: number;
  surfaceMeters: number;
  followsHeightfield: boolean;
  surfaceOffsetMeters: number;
};

export function tileAltitudeAtWorldPosition(
  state: GameState,
  kind: TileKind,
  x: number,
  z: number,
  fallbackBaseMeters = 0,
): TileAltitudeSample {
  const altitude = tileKindDefinition(kind).altitude;
  const heightfieldBase = altitude.followsHeightfield ? landformGroundTopAt(state, x, z) : undefined;
  const baseMeters = heightfieldBase ?? fallbackBaseMeters;
  return {
    kind,
    source: heightfieldBase == null ? 'cell' : 'heightfield',
    baseMeters,
    surfaceMeters: baseMeters + altitude.surfaceOffsetMeters,
    followsHeightfield: altitude.followsHeightfield,
    surfaceOffsetMeters: altitude.surfaceOffsetMeters,
  };
}

export function tileAltitudeAtCellCenter(state: GameState, kind: TileKind, cell: GridCell): TileAltitudeSample {
  const c = state.world.cellSizeMeters;
  return tileAltitudeAtWorldPosition(
    state,
    kind,
    (cell.x + 0.5) * c,
    (cell.z + 0.5) * c,
    cell.y * c,
  );
}
