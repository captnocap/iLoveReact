// Editor-content binding for the pure coastal planner. The planner speaks
// semantic tile/flora names and one explicit wire version; this boundary binds
// those names to the active append-only editor legends and refuses drift from
// the native generated-map protocol before allocating the large payload.
import { MAP_GENERATED_WIRE } from '../../../runtime/game/map';
import {
  COASTAL_CITY_TUNING,
  packCoastalCityPainting,
  type CoastalCityPlan,
  type PackedCoastalCityPainting,
} from '../data/coastalCity';
import { FLORA_KIND_DEFINITIONS, type FloraKind, type FloraLane } from '../world/floraKinds';
import { TILE_KINDS } from '../world/tileKinds';

function tileIndex(kind: 'grass' | 'sand' | 'mud'): number {
  const index = TILE_KINDS.indexOf(kind);
  if (index < 0) throw new Error(`coastal generator requires missing tile kind '${kind}'`);
  return index;
}

function floraIndex(kind: FloraKind, lane: FloraLane): number {
  const index = FLORA_KIND_DEFINITIONS.findIndex((definition) => definition.kind === kind);
  const definition = FLORA_KIND_DEFINITIONS[index];
  if (index < 0 || !definition) throw new Error(`coastal generator requires missing flora kind '${kind}'`);
  if (definition.lane !== lane) {
    throw new Error(`coastal generator flora '${kind}' moved from ${lane} to ${definition.lane}`);
  }
  return index;
}

function assertGeneratedWireParity(): void {
  const planner = COASTAL_CITY_TUNING.wire;
  const plannerStride = planner.chunkCoordFloats
    + planner.sampleCells * 2
    + planner.tileCells * planner.cellChannelCount;
  if (planner.version !== MAP_GENERATED_WIRE.version
    || planner.sampleCells !== MAP_GENERATED_WIRE.sampleCount
    || planner.tileCells !== MAP_GENERATED_WIRE.tileCount
    || plannerStride !== MAP_GENERATED_WIRE.chunkStride
    || planner.pathHeaderFloats !== MAP_GENERATED_WIRE.pathHeaderFloats
    || planner.pathRecordFloats !== MAP_GENERATED_WIRE.pathRecordHeaderFloats) {
    throw new Error('coastal generator wire no longer matches the native map installer');
  }
}

/** Compile one plan against the editor's actual tile/flora legend. */
export function compileCoastalCityPainting(plan: CoastalCityPlan): PackedCoastalCityPainting {
  assertGeneratedWireParity();
  return packCoastalCityPainting(plan, {
    tiles: {
      grass: tileIndex('grass'),
      sand: tileIndex('sand'),
      mud: tileIndex('mud'),
    },
    flora: {
      grassSparse: floraIndex('grassSparse', 'grass'),
      grassLush: floraIndex('grassLush', 'grass'),
      grassReeds: floraIndex('grassReeds', 'grass'),
      pine: floraIndex('pine', 'tree'),
      cedar: floraIndex('cedar', 'tree'),
      bushDense: floraIndex('bushDense', 'bush'),
    },
  });
}
