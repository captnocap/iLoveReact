// The Fart Racer landscape — terrain relief, ground tiles, and foliage, all
// derived from the authored circuit.
//
// The rule the whole surface obeys: the ROAD CORRIDOR IS EXACTLY THE AUTHORED
// ELEVATION, and everything else is free to roll. That keeps the drivable line
// honest (a checkpoint sampled at a path point's elevation lands on the surface)
// while the world around it has shape to read speed against.

import { trackProximity } from './fartRacerTrack';

export const TERRAIN_TUNING = Object.freeze({
  /** Fully flat, exactly at the authored elevation — road, shoulders, verge. */
  corridorHalfWidthM: 17,
  /** Relief reaches full strength this far out; between the two it eases in. */
  reliefBlendM: 78,
  /** Peak-to-trough of the rolling hills away from the circuit. */
  reliefAmplitudeM: 9,
  /** A building lot is flat to its own pad height, easing out over this margin. */
  padBlendM: 7,
  /** Trees keep this clear of the centerline so nothing grows on the racing line. */
  treeClearanceM: 34,
  bushClearanceM: 24,
  /** Above this height the ground goes dry and sandy. */
  drySlopeHeightM: 6.5,
  /** Below this it reads as wet low ground. */
  wetHollowHeightM: -1.6,
});

/** An explicitly flattened rectangle — a building lot or a parking apron. Pads
 *  are the reason a placed wall meets the ground at all four corners on a
 *  landscape that is otherwise rolling. */
export type TerrainPad = Readonly<{
  x: number; z: number;
  halfX: number; halfZ: number;
  heightM: number;
}>;

/** Rolling relief. Three incommensurate waves so the eye never finds the grid;
 *  the amplitudes sum to TERRAIN_TUNING.reliefAmplitudeM. */
function reliefAt(x: number, z: number): number {
  return Math.sin(x / 94) * Math.cos(z / 111) * 5
    + Math.sin((x + z) / 57) * 2.5
    + Math.cos(x / 41 - z / 63) * 1.5;
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How strongly a pad owns this point: 1 inside the lot, easing to 0 at the
 *  blend margin. Overlapping pads take the strongest claim. */
function padWeight(pads: readonly TerrainPad[], x: number, z: number): { weight: number; heightM: number } {
  let bestWeight = 0;
  let bestHeight = 0;
  for (const pad of pads) {
    const outsideX = Math.abs(x - pad.x) - pad.halfX;
    const outsideZ = Math.abs(z - pad.z) - pad.halfZ;
    const outside = Math.max(outsideX, outsideZ);
    const weight = 1 - smoothStep(0, TERRAIN_TUNING.padBlendM, Math.max(0, outside));
    if (weight > bestWeight) { bestWeight = weight; bestHeight = pad.heightM; }
  }
  return { weight: bestWeight, heightM: bestHeight };
}

/** Ground height in metres at a world point. */
export function terrainHeightAt(x: number, z: number, pads: readonly TerrainPad[]): number {
  const near = trackProximity(x, z);
  const away = smoothStep(TERRAIN_TUNING.corridorHalfWidthM, TERRAIN_TUNING.reliefBlendM, near.distanceM);
  const land = near.elevationM + reliefAt(x, z) * (TERRAIN_TUNING.reliefAmplitudeM / 9) * away;
  const pad = padWeight(pads, x, z);
  return pad.weight > 0 ? land + (pad.heightM - land) * pad.weight : land;
}

/** The tile-kind names this world paints. Resolved against the live legend by
 *  the caller so no catalog index is ever hardcoded. */
export const TERRAIN_TILE_KINDS = Object.freeze(['grass', 'sand', 'mud', 'sidewalk', 'asphalt'] as const);
export type TerrainTileKind = (typeof TERRAIN_TILE_KINDS)[number];

/** Which flora kinds this world plants, by lane. Resolved against the live
 *  flora legend by the caller for the same reason. */
export const TERRAIN_FLORA_KINDS = Object.freeze({
  grass: Object.freeze(['grassMed', 'grassLush', 'grassTall', 'grassDry', 'grassFlowers'] as const),
  tree: Object.freeze(['pine', 'oak', 'maple', 'cedar', 'spruce'] as const),
  bush: Object.freeze(['bush', 'bushLow', 'bushDense', 'leafyThicket'] as const),
});

/** Deterministic hash → [0,1). Two integer cell coordinates and a salt in, one
 *  stable roll out; regenerating the world twice must lay down the same forest. */
function cellRoll(cellX: number, cellZ: number, salt: number): number {
  let h = (cellX * 0x1f1f1f1f) ^ (cellZ * 0x27d4eb2f) ^ (salt * 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export type SurfacePaint = Readonly<{
  /** index into TERRAIN_TILE_KINDS */
  tile: number;
  /** index into TERRAIN_FLORA_KINDS.grass, or -1 */
  grass: number;
  /** index into TERRAIN_FLORA_KINDS.tree, or -1 */
  tree: number;
  /** index into TERRAIN_FLORA_KINDS.bush, or -1 */
  bush: number;
}>;

const BARE: SurfacePaint = Object.freeze({ tile: 0, grass: -1, tree: -1, bush: -1 });

/** Everything painted onto one 1 m ground cell. Splitting this out keeps the
 *  packer a loop over cells and keeps the LOOK reviewable in one place. */
export function surfacePaintAt(
  cellX: number,
  cellZ: number,
  height: number,
  pads: readonly TerrainPad[],
): SurfacePaint {
  const x = cellX + 0.5;
  const z = cellZ + 0.5;
  const near = trackProximity(x, z);
  const pad = padWeight(pads, x, z);

  // A building lot is paved and grows nothing.
  if (pad.weight > 0.55) return { tile: 3, grass: -1, tree: -1, bush: -1 };
  // The road itself is drawn analytically by the road ribbon; the shoulder
  // under it reads as asphalt so the verge does not flash green at the seam.
  if (near.distanceM < 11) return { tile: 4, grass: -1, tree: -1, bush: -1 };
  if (pad.weight > 0.15) return BARE;

  const dry = height > TERRAIN_TUNING.drySlopeHeightM;
  const wet = height < TERRAIN_TUNING.wetHollowHeightM;
  const tile = dry ? 1 : wet ? 2 : 0;

  // Verge grass right beside the road reads speed; it thins out further away.
  const grassRoll = cellRoll(cellX, cellZ, 11);
  const nearVerge = near.distanceM < 30;
  const grass = wet
    ? (grassRoll < 0.8 ? 2 : 4)                       // tall grass / flowers in the hollows
    : dry
      ? (grassRoll < 0.45 ? 3 : -1)                   // dry tufts on the sandy tops
      : nearVerge
        ? (grassRoll < 0.9 ? (grassRoll < 0.25 ? 4 : 1) : 0)
        : (grassRoll < 0.7 ? 0 : -1);

  let tree = -1;
  if (near.distanceM > TERRAIN_TUNING.treeClearanceM && !dry) {
    const treeRoll = cellRoll(cellX, cellZ, 29);
    // Stand density varies with a slow noise field so the woods clump rather
    // than dusting the whole map evenly.
    const stand = 0.5 + 0.5 * Math.sin(x / 73) * Math.cos(z / 61);
    if (treeRoll < 0.055 * stand) {
      tree = Math.floor(cellRoll(cellX, cellZ, 31) * TERRAIN_FLORA_KINDS.tree.length);
    }
  }

  let bush = -1;
  if (tree < 0 && near.distanceM > TERRAIN_TUNING.bushClearanceM) {
    const bushRoll = cellRoll(cellX, cellZ, 47);
    if (bushRoll < 0.035) bush = Math.floor(cellRoll(cellX, cellZ, 53) * TERRAIN_FLORA_KINDS.bush.length);
  }

  return { tile, grass, tree, bush };
}
