// Gastown — the buildings and roadside furniture that line the Fart Racer
// circuit.
//
// Everything here is ORDINARY authored world content. The blocks are
// architecture wall edges — the same vertex/edge source the Sims-style wall
// tool writes, so the editor opens this map and every wall of it is draggable
// (v5 rule: walls live in `architecture`, never as placed wall-kind pieces).
// Roofs and street furniture are placed catalog pieces. Nothing in the compiled
// game knows a "building" exists.

import { ARCHITECTURE_UNITS_PER_METER, type ArchitectureSource, type WallEdge, type WallVertex } from '../world/architecture';
import { trackProximity } from './fartRacerTrack';
import type { TerrainPad } from './fartRacerTerrain';

/** The build module. Walls, floors, and roof plates are 3 m on the ground plane
 *  and a storey is 3 m tall (framework/game/build.zig WALL_SIZE / PLATE_SIZE). */
export const BUILD_MODULE_M = 3;
const STOREY_M = 3;
const U = ARCHITECTURE_UNITS_PER_METER;

export type BuildingBlock = Readonly<{
  id: string;
  /** footprint centre, world metres */
  x: number;
  z: number;
  /** footprint size in build modules, so roof plates always tile it exactly */
  modulesX: number;
  modulesZ: number;
  floors: number;
  /** exterior wall thickness in metres */
  thicknessM: number;
  /** catalog id for the roof plates that cap it */
  roof: string;
  /** names the look for the wall finish; a name the Skins tab does not own
   *  falls back to the engine's flat face colour, which is what a raw block
   *  should look like until someone finishes it */
  finish: string;
}>;

type Row = Readonly<{
  idPrefix: string;
  /** first block centre and the step between block centres */
  x: number; z: number; stepX: number; stepZ: number;
  count: number;
  modulesX: number; modulesZ: number;
  floors: readonly number[];
  thicknessM: number;
  roof: string;
  finish: string;
}>;

/** The city, as rows of blocks along the circuit. Read this top to bottom and
 *  you have driven a lap: the downtown terrace down the main straight, an
 *  industrial yard under the east climb, motel row through the north woods,
 *  suburb lots on the western run home, and the trap lot behind the hairpin. */
const ROWS: readonly Row[] = Object.freeze([
  {
    idPrefix: 'downtown-s', x: 96, z: 62, stepX: 27, stepZ: 0, count: 8,
    modulesX: 7, modulesZ: 5, floors: [4, 3, 5, 3, 4, 6, 3, 4],
    thicknessM: 0.3, roof: 'roof.flat.common', finish: 'gastown.brick',
  },
  {
    idPrefix: 'downtown-n', x: 108, z: 120, stepX: 27, stepZ: 0, count: 7,
    modulesX: 7, modulesZ: 6, floors: [5, 7, 4, 6, 8, 5, 6],
    thicknessM: 0.3, roof: 'roof.flat.common', finish: 'gastown.concrete',
  },
  {
    idPrefix: 'industrial', x: 396, z: 160, stepX: 0, stepZ: 46, count: 3,
    modulesX: 8, modulesZ: 7, floors: [2, 2, 3],
    thicknessM: 0.25, roof: 'roof.shed.common', finish: 'gastown.metal',
  },
  {
    idPrefix: 'motel', x: 302, z: 344, stepX: -36, stepZ: 6, count: 4,
    modulesX: 6, modulesZ: 4, floors: [2, 2, 2, 2],
    thicknessM: 0.25, roof: 'roof.shedSteep.common', finish: 'gastown.stucco',
  },
  {
    idPrefix: 'suburb', x: 100, z: 250, stepX: 0, stepZ: -34, count: 4,
    modulesX: 5, modulesZ: 4, floors: [1, 2, 1, 2],
    thicknessM: 0.25, roof: 'roof.gable.suburb', finish: 'gastown.stucco',
  },
  {
    idPrefix: 'trap-lot', x: 150, z: 442, stepX: 27, stepZ: 4, count: 3,
    modulesX: 5, modulesZ: 4, floors: [1, 2, 1],
    thicknessM: 0.2, roof: 'roof.shingle.suburb', finish: 'gastown.plywood',
  },
]);

export function cityBlocks(): readonly BuildingBlock[] {
  const blocks: BuildingBlock[] = [];
  for (const row of ROWS) {
    for (let index = 0; index < row.count; index += 1) {
      blocks.push({
        id: `${row.idPrefix}-${index}`,
        x: row.x + row.stepX * index,
        z: row.z + row.stepZ * index,
        modulesX: row.modulesX,
        modulesZ: row.modulesZ,
        floors: row.floors[index % row.floors.length]!,
        thicknessM: row.thicknessM,
        roof: row.roof,
        finish: row.finish,
      });
    }
  }
  return blocks;
}

/** One flat lot per block, sized to the footprint plus an apron, sitting at the
 *  circuit's elevation beside it — so a building meets the ground at all four
 *  corners on land that is otherwise rolling. */
export function cityPads(): readonly TerrainPad[] {
  const apron = 5;
  return cityBlocks().map((block) => ({
    x: block.x,
    z: block.z,
    halfX: (block.modulesX * BUILD_MODULE_M) / 2 + apron,
    halfZ: (block.modulesZ * BUILD_MODULE_M) / 2 + apron,
    heightM: trackProximity(block.x, block.z).elevationM,
  }));
}

/** Every block's exterior shell as wall vertices and edges. One edge per side
 *  carries the block's whole height; storeys are a look, not a data layer. The
 *  loop is closed and wound so side A faces outward. */
export function cityArchitecture(heightAt: (x: number, z: number) => number): ArchitectureSource {
  const vertices: WallVertex[] = [];
  const edges: WallEdge[] = [];
  for (const block of cityBlocks()) {
    const halfX = (block.modulesX * BUILD_MODULE_M) / 2;
    const halfZ = (block.modulesZ * BUILD_MODULE_M) / 2;
    const baseYU = Math.round(heightAt(block.x, block.z) * U);
    const corners: readonly (readonly [number, number])[] = [
      [block.x - halfX, block.z - halfZ],
      [block.x + halfX, block.z - halfZ],
      [block.x + halfX, block.z + halfZ],
      [block.x - halfX, block.z + halfZ],
    ];
    corners.forEach(([x, z], index) => {
      vertices.push({ id: `${block.id}-v${index}`, floor: 0, xU: Math.round(x * U), zU: Math.round(z * U) });
    });
    for (let index = 0; index < corners.length; index += 1) {
      edges.push({
        id: `${block.id}-e${index}`,
        startVertexId: `${block.id}-v${index}`,
        endVertexId: `${block.id}-v${(index + 1) % corners.length}`,
        support: { kind: 'absolute', baseYU },
        heightU: Math.round(block.floors * STOREY_M * U),
        thicknessU: Math.max(1, Math.round(block.thicknessM * U)),
        profile: 'full',
        styleId: 'gastown.exterior',
        sideA: { materialId: block.finish },
        sideB: { materialId: block.finish },
        openings: [],
      });
    }
  }
  return { version: 1, revision: 1, walls: { vertices, edges, anchors: [] } };
}

export type CityPiece = Readonly<{
  id: string;
  pieceId: string;
  x: number; y: number; z: number;
  yawDegrees: number;
  floor: number;
}>;

/** Roof plates tiling each block's footprint at the top of its walls. You see
 *  these from the elevated back straight, looking down over downtown. */
function roofPieces(heightAt: (x: number, z: number) => number): CityPiece[] {
  const pieces: CityPiece[] = [];
  for (const block of cityBlocks()) {
    const halfX = (block.modulesX * BUILD_MODULE_M) / 2;
    const halfZ = (block.modulesZ * BUILD_MODULE_M) / 2;
    const roofY = heightAt(block.x, block.z) + block.floors * STOREY_M;
    for (let i = 0; i < block.modulesX; i += 1) {
      for (let j = 0; j < block.modulesZ; j += 1) {
        pieces.push({
          id: `${block.id}-r${i}-${j}`,
          pieceId: block.roof,
          x: block.x - halfX + BUILD_MODULE_M * (i + 0.5),
          y: roofY,
          z: block.z - halfZ + BUILD_MODULE_M * (j + 0.5),
          yawDegrees: 0,
          floor: block.floors,
        });
      }
    }
  }
  return pieces;
}

/** Roadside furniture: pole signs down the downtown straight and chainlink runs
 *  on the outside of the two fastest corners, so there is always something
 *  close to the car to read speed against. */
function streetFurniture(heightAt: (x: number, z: number) => number): CityPiece[] {
  const pieces: CityPiece[] = [];
  for (let i = 0; i < 9; i += 1) {
    const x = 84 + i * 27;
    for (const [suffix, z] of [['s', 74] as const, ['n', 106] as const]) {
      pieces.push({ id: `lamp-${suffix}-${i}`, pieceId: 'sign.pole.common', x, y: heightAt(x, z), z, yawDegrees: 0, floor: 0 });
    }
  }
  const fenceRuns: readonly Readonly<{ id: string; x: number; z: number; stepX: number; stepZ: number; count: number; yaw: number }>[] = [
    { id: 'fence-t1', x: 456, z: 132, stepX: 0, stepZ: 6, count: 20, yaw: 90 },
    { id: 'fence-woods', x: 330, z: 420, stepX: -6, stepZ: 0, count: 20, yaw: 0 },
  ];
  for (const run of fenceRuns) {
    for (let i = 0; i < run.count; i += 1) {
      const x = run.x + run.stepX * i;
      const z = run.z + run.stepZ * i;
      pieces.push({ id: `${run.id}-${i}`, pieceId: 'fence.chainlink.trap_lot', x, y: heightAt(x, z), z, yawDegrees: run.yaw, floor: 0 });
    }
  }
  return pieces;
}

/** Every placed (non-wall) piece the city is made of. `heightAt` is the world's
 *  terrain sampler — a roof rides its own block's pad, furniture stands on the
 *  ground it actually occupies. */
export function cityPieces(heightAt: (x: number, z: number) => number): readonly CityPiece[] {
  return [...roofPieces(heightAt), ...streetFurniture(heightAt)];
}
