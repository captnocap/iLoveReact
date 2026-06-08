// worldGeometry.ts — extrude the AUTHORED hmsc world into a flat 3D instance
// buffer the stateless loader renders with ZERO V8.
//
// This is the first capability through the universal pipe (PLATMOD): the React-
// authored world's geometry, lowered to encoded data. Every world object —
// surface region, road, junction, prop, landform, building — becomes ONE box
// instance: a (position, scale, color) row in a packed Float32Array. The host's
// instanced-mesh path (scene3d_instance_data, stride 9) expands each row into a
// model matrix and draws the whole batch with one unit-cube geometry interned
// once. MANY instances at real world positions — the user's actual map as 3D
// blocks, not a hand-typed cube.
//
// Layout per instance (stride 9, matches gpu/3d.zig makeInstance stride<12):
//   [ px, py, pz,  sx, sy, sz,  r, g, b ]
// position is the box CENTER (world meters, y up); scale is the full box size.

import type { GameState, PropKind, BuildingKind, TileKind } from '../../hmsc/design';
import { solveRoadCrossSection } from '../../hmsc/world/roadProfile';

export const INSTANCE_STRIDE = 9;

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
): void {
  out.push(cx, cy, cz, sx, sy, sz, color[0], color[1], color[2]);
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
      return [0.2, 0.2, 0.22];
    case 'crosswalk':
      return [0.7, 0.7, 0.72];
    case 'sidewalk':
      return [0.58, 0.58, 0.6];
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

// ── extrusion ───────────────────────────────────────────────────────────────

/** Build the packed instance buffer for the whole authored world. */
export function buildWorldInstances(state: GameState): Float32Array {
  const out: number[] = [];
  const world = state.world;

  // Surface regions — flat colored ground slabs over their footprint. These show
  // the map's painted layout (districts, water, sand…) read from above/iso.
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

  // Landforms — extruded footprints (mounds/hills). A crude box first cut; the
  // ~hf~ heightfield mesh path is the fidelity follow-up.
  for (const landform of world.landforms) {
    const radius = landform.params.radius ?? (landform.field ? (landform.field.cols * landform.field.cell) / 2 : 12);
    const height = Math.max(1, landform.params.height ?? landform.params.peak ?? 6);
    const size = Math.max(2, radius * 2);
    pushBox(out, landform.centerX, landform.baseY + height / 2, landform.centerZ, size, height, size, [0.46, 0.5, 0.34]);
  }

  // Buildings — one box per footprint, height by kind. (yaw is dropped in this
  // stride-9 first cut; most placements are axis-aligned.)
  for (const building of world.buildings ?? []) {
    const w = Math.max(1, building.widthTiles);
    const d = Math.max(1, building.depthTiles);
    const h = BUILDING_HEIGHT[building.kind] ?? 5;
    pushBox(out, building.x + w / 2, building.y + h / 2, building.z + d / 2, w, h, d, buildingColor(building.kind));
  }

  // Props — small raised boxes, sized + colored by kind. The bulk of the count.
  for (const prop of world.props) {
    const box = PROP_BOX[prop.kind] ?? [0.8, 1.0, 0.8];
    pushBox(out, prop.x, (prop.y ?? 0) + box[1] / 2, prop.z, box[0], box[1], box[2], propColor(prop.kind));
  }

  return new Float32Array(out);
}

/** Encode the instance buffer as a map lump payload: u32 count | f32[count*9]. */
export function encodeInstanceLump(instances: Float32Array): Uint8Array {
  const count = Math.floor(instances.length / INSTANCE_STRIDE);
  const out = new Uint8Array(4 + count * INSTANCE_STRIDE * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, count, true);
  for (let i = 0; i < count * INSTANCE_STRIDE; i += 1) {
    view.setFloat32(4 + i * 4, instances[i], true);
  }
  return out;
}
