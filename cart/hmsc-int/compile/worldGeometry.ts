// worldGeometry.ts — extrude the AUTHORED hmsc world into a flat 3D instance
// buffer the stateless loader renders with ZERO V8.
//
// This is the first capability through the universal pipe (PLATMOD): the React-
// authored world's geometry, lowered to encoded data. Two sources, both real:
//   • the GameState world layers (surface regions, roads, junctions, props,
//     landforms) — the painted ground the editor's preview shows; and
//   • the BUILD WORLD STREAM's PLACED PIECES (world.state().pieces) — the
//     walls/floors/pillars the /test play view renders as the city's structures.
//     A "Building 1" prefab is N placed pieces; a tower is stacked wall/pillar
//     pieces. These are the towers the user sees in /test — the loader MUST show
//     parity. Each placed piece becomes ONE box instance using the SAME catalog
//     size + material the play view's pieceVisualShapes uses.
//
// Every object becomes ONE box instance: a (position, rotation, scale, color)
// row in a packed Float32Array. The host's instanced-mesh path expands each row
// into a model matrix and draws the whole batch with one interned unit cube.
//
// Layout per instance (stride 12, matches gpu/3d.zig makeInstance stride>=12):
//   [ px, py, pz,  rx, ry, rz,  sx, sy, sz,  r, g, b ]
// position is the box CENTER (world meters, y up); rotation is degrees about
// each axis (only ry / yaw is used); scale is the full box size.

import type { GameState, PropKind, BuildingKind, TileKind } from '../../hmsc/design';
import { solveRoadCrossSection } from '../../hmsc/world/roadProfile';
import { GAME_BUILD } from '@game';
import type { BuildMaterial, PlacedBuildPiece } from '@game';

export const INSTANCE_STRIDE = 12;

type Color = readonly [number, number, number];

function pushBox(
  out: number[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: Color,
  yawDegrees = 0,
): void {
  out.push(cx, cy, cz, 0, yawDegrees, 0, sx, sy, sz, color[0], color[1], color[2]);
}

function hexColor(hex: string): Color {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

// ── colors ────────────────────────────────────────────────────────────────

function tileColor(kind: TileKind | string): Color {
  switch (kind) {
    case 'water':
      return [0.18, 0.42, 0.7];
    case 'road':
    case 'asphalt':
    case 'laneNorth':
    case 'laneSouth':
    case 'laneEast':
    case 'laneWest':
    case 'junction':
      return [0.34, 0.34, 0.37]; // mid asphalt — dark enough to read, not a void
    case 'crosswalk':
      return [0.72, 0.72, 0.74];
    case 'sidewalk':
      return [0.64, 0.64, 0.66];
    case 'mud':
      return [0.4, 0.3, 0.2];
    case 'sand':
      return [0.82, 0.74, 0.46];
    case 'bush':
      return [0.3, 0.52, 0.24];
    case 'wall':
      return [0.5, 0.5, 0.52];
    case 'door':
      return [0.6, 0.45, 0.3];
    default:
      return [0.36, 0.5, 0.34]; // generic painted ground (greenish)
  }
}

const PROP_BOX: Record<string, readonly [number, number, number]> = {
  // [width, height, depth] in meters
  bush: [1.2, 0.8, 1.2],
  bushLarge: [1.8, 1.1, 1.8],
  bushLow: [1.2, 0.5, 1.2],
  bushSparse: [1.0, 0.6, 1.0],
  rock: [1.0, 0.8, 1.0],
  rockLarge: [2.0, 1.6, 2.0],
  rockSmall: [0.6, 0.5, 0.6],
  fireHydrant: [0.4, 0.9, 0.4],
  streetSign: [0.3, 3.0, 0.3],
  streetLight: [0.3, 5.0, 0.3],
  stopSign: [0.3, 2.6, 0.3],
  trafficLight: [0.4, 5.0, 0.4],
  payphone: [0.6, 1.4, 0.4],
  dumpster: [1.6, 1.3, 1.0],
  mailbox: [0.5, 1.1, 0.5],
  fence: [1.0, 1.2, 0.2],
};

function propColor(kind: PropKind | string): Color {
  switch (kind) {
    case 'bush':
    case 'bushLarge':
    case 'bushLow':
    case 'bushSparse':
      return [0.3, 0.55, 0.25];
    case 'fireHydrant':
    case 'stopSign':
      return [0.82, 0.22, 0.16];
    case 'trafficLight':
      return [0.85, 0.7, 0.2];
    case 'streetLight':
    case 'streetSign':
    case 'payphone':
    case 'mailbox':
      return [0.5, 0.5, 0.55];
    case 'dumpster':
      return [0.25, 0.45, 0.3];
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
      return [0.5, 0.5, 0.52];
    case 'fence':
      return [0.55, 0.4, 0.25];
    default:
      return [0.7, 0.6, 0.4];
  }
}

const BUILDING_HEIGHT: Record<string, number> = {
  house: 4,
  shop: 5,
  tower: 24,
  warehouse: 8,
  parkingGarage: 10,
  gasStation: 5,
  usedCarLot: 3,
  driveIn: 6,
};

function buildingColor(kind: BuildingKind | string): Color {
  switch (kind) {
    case 'tower':
      return [0.55, 0.6, 0.72];
    case 'house':
      return [0.72, 0.6, 0.5];
    case 'shop':
      return [0.62, 0.55, 0.72];
    case 'warehouse':
      return [0.5, 0.5, 0.56];
    case 'parkingGarage':
      return [0.55, 0.55, 0.58];
    case 'gasStation':
      return [0.8, 0.55, 0.4];
    case 'usedCarLot':
      return [0.5, 0.55, 0.6];
    default:
      return [0.6, 0.6, 0.62];
  }
}

// How each build MATERIAL reads — mirrors PlayRoute's MATERIAL_LOOK so the loader
// shows the same wall/floor/pillar colors the /test play view does.
const MATERIAL_COLOR: Record<BuildMaterial, Color> = {
  concrete: hexColor('#9aa3ad'),
  brick: hexColor('#8a4a3a'),
  stucco: hexColor('#d8cdb8'),
  wood: hexColor('#8a6a45'),
  metal: hexColor('#7d858d'),
  glass: hexColor('#cfe6f2'),
  chainlink: hexColor('#b9c2c9'),
};

// ── extrusion ───────────────────────────────────────────────────────────────

/** Extrude the GameState's painted world layers into box instances (the ground
 *  the editor preview shows: regions/roads/junctions/landforms/props). */
function pushWorldLayers(out: number[], state: GameState): void {
  const world = state.world;

  // Surface regions — flat colored ground slabs over their footprint.
  for (const region of world.surfaceRegions) {
    const w = Math.max(1, region.width);
    const d = Math.max(1, region.depth);
    pushBox(out, region.x + w / 2, region.y + 0.1, region.z + d / 2, w, 0.2, d, tileColor(region.kind));
  }

  // Placed single cells — small raised tiles with their own identity.
  for (const placed of Object.values(world.placedCells)) {
    const cell = placed.cell;
    pushBox(out, cell.x + 0.5, (cell.y ?? 0) + 0.2, cell.z + 0.5, 0.9, 0.4, 0.9, tileColor(placed.kind));
  }

  // Roads — dark asphalt slabs sized to their cross-section, run along their axis.
  for (const road of world.roads) {
    const width = Math.max(2, solveRoadCrossSection(road.profile).totalWidthMeters);
    const length = Math.max(1, road.lengthTiles);
    if (road.orientation === 'northSouth') {
      pushBox(out, road.x + width / 2, road.y + 0.075, road.z + length / 2, width, 0.15, length, [0.18, 0.18, 0.2]);
    } else {
      pushBox(out, road.x + length / 2, road.y + 0.075, road.z + width / 2, length, 0.15, width, [0.18, 0.18, 0.2]);
    }
  }

  // Junctions — intersection box / cul-de-sac bulb, sized to the joining roads.
  for (const junction of world.junctions) {
    if (junction.kind === 'intersection') {
      const w = Math.max(2, solveRoadCrossSection(junction.profile).totalWidthMeters);
      pushBox(out, junction.x + w / 2, junction.y + 0.08, junction.z + w / 2, w, 0.16, w, [0.22, 0.22, 0.24]);
    } else {
      const r = Math.max(1, junction.bulbRadiusTiles);
      pushBox(out, junction.centerX, junction.y + 0.08, junction.centerZ, r * 2, 0.16, r * 2, [0.22, 0.22, 0.24]);
    }
  }

  // Landforms — extruded footprints (crude box first cut; ~hf~ mesh path later).
  for (const landform of world.landforms) {
    const radius = landform.params.radius ?? (landform.field ? (landform.field.cols * landform.field.cell) / 2 : 12);
    const height = Math.max(1, landform.params.height ?? landform.params.peak ?? 6);
    const size = Math.max(2, radius * 2);
    pushBox(out, landform.centerX, landform.baseY + height / 2, landform.centerZ, size, height, size, [0.46, 0.5, 0.34]);
  }

  // Legacy authored buildings (usually empty; pieces are the real structures).
  for (const building of world.buildings ?? []) {
    const w = Math.max(1, building.widthTiles);
    const d = Math.max(1, building.depthTiles);
    const h = BUILDING_HEIGHT[building.kind] ?? 5;
    pushBox(out, building.x + w / 2, building.y + h / 2, building.z + d / 2, w, h, d, buildingColor(building.kind), building.yawDegrees ?? 0);
  }

  // Props — small raised boxes, sized + colored by kind.
  for (const prop of world.props) {
    const box = PROP_BOX[prop.kind] ?? [0.8, 1.0, 0.8];
    pushBox(out, prop.x, (prop.y ?? 0) + box[1] / 2, prop.z, box[0], box[1], box[2], propColor(prop.kind), prop.yawDegrees ?? 0);
  }
}

/** Extrude the BUILD stream's PLACED PIECES into box instances — the city's
 *  structures (walls/floors/pillars/towers/prefabs). One box per piece, at the
 *  catalog size + material the /test play view renders, rotated by the piece
 *  yaw. This is the parity-with-/test path. */
function pushPlacedPieces(out: number[], pieces: readonly PlacedBuildPiece[]): number {
  let emitted = 0;
  for (const piece of pieces) {
    let def;
    try {
      def = GAME_BUILD.catalog.get(piece.pieceId);
    } catch {
      continue; // unknown piece id — skip rather than abort the whole bake
    }
    const size = def.size;
    const color = MATERIAL_COLOR[def.material] ?? [0.62, 0.64, 0.68];
    // The play view's body box: center (x, y + h/2, z), full catalog size, yaw.
    pushBox(
      out,
      piece.x,
      piece.y + size.heightMeters / 2,
      piece.z,
      size.widthMeters,
      size.heightMeters,
      size.depthMeters,
      color,
      piece.yawDegrees,
    );
    emitted += 1;
  }
  return emitted;
}

export type WorldInstanceResult = {
  instances: Float32Array;
  total: number;
  pieces: number;
};

/** Build the packed instance buffer for the whole authored world. The PLACED
 *  PIECES (the structures /test renders) come FIRST so the loader can frame the
 *  camera tightly on them — the painted ground spans the whole 240m map and
 *  would otherwise dwarf the city to a speck. The painted GameState layers
 *  follow as the ground context. */
export function buildWorldInstances(state: GameState, pieces: readonly PlacedBuildPiece[] = []): WorldInstanceResult {
  const out: number[] = [];
  const pieceCount = pushPlacedPieces(out, pieces);
  pushWorldLayers(out, state);
  return {
    instances: new Float32Array(out),
    total: Math.floor(out.length / INSTANCE_STRIDE),
    pieces: pieceCount,
  };
}

/** Encode the instance buffer as a map lump payload:
 *  u32 count | u32 stride | u32 pieceCount | f32[count*stride].
 *  `pieceCount` (the first N rows, the placed structures) lets the loader frame
 *  the camera on the city rather than the whole ground plane. */
export function encodeInstanceLump(instances: Float32Array, pieceCount = 0, stride: number = INSTANCE_STRIDE): Uint8Array {
  const count = Math.floor(instances.length / stride);
  const out = new Uint8Array(12 + count * stride * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, count, true);
  view.setUint32(4, stride, true);
  view.setUint32(8, Math.min(pieceCount, count), true);
  for (let i = 0; i < count * stride; i += 1) {
    view.setFloat32(12 + i * 4, instances[i], true);
  }
  return out;
}
