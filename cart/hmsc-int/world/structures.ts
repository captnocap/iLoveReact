import type { Building } from '../design';
import { buildingKindDefinition, buildingKindHeightMeters } from './buildingKinds';
import { bakeTerrainField, terrainColliderData, type TerrainColliderData, type TerrainField } from './terrain';
import { HMSC_SCALE } from './scale';

// LAYOUT for open structures — the parking garage, gas station, and used car lot.
// The buildings twin of world/buildings.ts (box geometry) for the open kinds:
// given a placed Building of an open kind, it resolves the structure's part layout
// (deck heights, pillar grid, parking bays, parked cars, canopy slab, fuel pumps,
// store/kiosk boxes, sign anchors) in absolute world meters. Both the renderer
// (render3d/structures/*) and host physics (world/buildings → structureSolids)
// read THIS, so the pillars you see are the pillars you bump. JSX-free so host
// physics can import it without the renderer (same rule as buildingKinds.ts).
//
// Buildings are axis-aligned (no yaw), so every part is authored directly in world
// coordinates off the footprint — no rotation. This file owns the geometry (the
// numbers); the render files own appearance (materials, sign text, pump nozzles).
//
// COLLISION SCOPE (this pass): an open structure's solid mass is its full-height
// columns and back boxes (pillars / store / kiosk / sign post). Upper decks are
// thin slabs drawn for show but NOT standable — the host's solid rect is a column
// up to its top, so a floating deck can't be a single rect. Walk-up-the-ramp
// multi-level collision is the follow-up (it wants the heightfield-ramp machinery
// the mountain trail uses). The ground deck is the chunk floor: fully walkable.

const STOREY = HMSC_SCALE.storyHeightMeters;

// One solid mass for host physics: a column from the ground up to topMeters. Shape
// matches buildings.ts BuildingPhysicsRect (minX/minZ/maxX/maxZ/topMeters), so the
// open-kind branch of buildingPhysicsRects can return these directly.
// topMeters is the solid top. floorMeters (optional) is the solid BOTTOM: a raised
// parking deck / a car parked on one sets it so the host's banded-solid rule lets
// you walk UNDER it; columns omit it and stay solid to the ground.
export type StructureSolid = { minX: number; minZ: number; maxX: number; maxZ: number; topMeters: number; floorMeters?: number };

// One parked car: a ground anchor, a facing, a deck height it sits on, and a
// palette index for deterministic color variety. Shared by the garage and the lot
// (the Car sub-model reads it). Authored without Math.random so bakes are stable.
export type StructureCar = { x: number; y: number; z: number; yawDegrees: number; colorIndex: number };

type Footprint = { minX: number; minZ: number; maxX: number; maxZ: number; cx: number; cz: number; w: number; d: number };

function footprintOf(b: Building): Footprint {
  const minX = b.x;
  const minZ = b.z;
  const maxX = b.x + b.widthTiles;
  const maxZ = b.z + b.depthTiles;
  return { minX, minZ, maxX, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: b.widthTiles, d: b.depthTiles };
}

// Deterministic per-index variation without Math.random (stable across bakes), the
// same trick buildingSkins.tsx uses for window grids.
function hash2(a: number, b: number): number {
  return ((a * 73856093) ^ (b * 19349663)) >>> 0;
}

// ── Parking garage ──────────────────────────────────────────────────────────
//
// A two-level open garage you actually walk through. Two collision primitives,
// each playing to its strength:
//   • GROUND floor + the RAMP up one side = ONE heightfield (the mountain's
//     walkable-slope machinery, world/terrain.ts). A heightfield is single-valued,
//     so it gives a smooth, climbable ramp but can't stack a floor over a floor.
//   • UPPER DECK = a banded platform rect (the `floor` field added to host rects):
//     solid to stand ON, open to walk UNDER, so the ground floor stays usable
//     beneath it. A parapet rings the deck (gap where the ramp lands).
// Cars park on both levels. The floor you SEE (Heightfield mesh + deck slab) is the
// floor you walk (heightfield + platform rect) — see-it == walk-it. A THIRD level
// would need a sloped *rect* primitive (a 2nd ramp can't be another heightfield —
// it'd overhang the ground floor). Footprint squared (side = min(w, d)) so the
// heightfield covers it. 1 tile = 1 meter.

const PILLAR_SIZE_METERS = 0.7;
const BAY_WIDTH_METERS = 2.6;
// Lift the ground floor just above the chunk floor rect (~0.1m tile) it shares, or
// the host stands the player on the higher chunk rect and they float over it.
const GARAGE_FLOOR_LIFT = 0.15;
const GARAGE_CAR_FILL = 0.5;
// The garage's own floor-to-deck height — taller than a normal storey so there's
// real headroom under the deck (deck underside ≈ this − slab thickness ≈ 3.85m of
// clearance over a 1.65m player). The ramp climbs THIS, so its run scales with it.
const GARAGE_LEVEL_HEIGHT = 4.2;
const GARAGE_RAMP_STRIP_WIDTH = 6.5; // width of the west ramp+landing strip
const GARAGE_RAMP_RUN = 10.5; // horizontal run of the rise (~22° at this height)
// A FLAT run at deck level between where the ramp stops climbing and where the deck
// rect begins. The climber's feet settle to exactly deckY on this flat strip before
// they reach the deck's banded south face — without it the face blocks you mid-step
// (feet a few cm short of deck top) and reads as a "ledge not in step height".
const GARAGE_LANDING_DEPTH = 3.5;
const GARAGE_DECK_THICKNESS = 0.35;
const GARAGE_PARAPET_HEIGHT = 0.95;
const GARAGE_PARAPET_THICKNESS = 0.25;
const GARAGE_WALK_LIMIT_DEG = 42;
const GARAGE_FIELD_RESOLUTION = 56;

export type GarageBay = { x: number; z: number; y: number; yawDegrees: number; occupied: boolean; colorIndex: number };
export type GarageRect = { minX: number; minZ: number; maxX: number; maxZ: number };

export type ParkingGarageSpec = {
  footprint: Footprint;
  side: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseY: number;
  groundY: number; // ground-floor walking height (b.y + lift)
  deckY: number; // upper-deck walking height
  deckFloorBottom: number; // underside of the deck slab (the banded-rect floor)
  roofTop: number;
  walkCos: number;
  rampStripMaxX: number; // the west strip [minX, rampStripMaxX] carries the ramp
  rampClimbTopZ: number; // ramp stops CLIMBING here (reaches deckY); flat landing follows
  rampTopZ: number; // deck rect begins here (= rampClimbTopZ + landing); flat between
  deckArea: GarageRect; // the upper deck — the full-width NORTH portion (z ≥ rampTopZ)
  pillars: Array<{ x: number; z: number }>;
  bays: GarageBay[];
  cars: StructureCar[];
};

export function parkingGarageSpec(b: Building): ParkingGarageSpec {
  const f = footprintOf(b);
  const side = Math.min(f.w, f.d);
  const minX = f.cx - side / 2;
  const maxX = f.cx + side / 2;
  const minZ = f.cz - side / 2;
  const maxZ = f.cz + side / 2;

  const groundY = b.y + GARAGE_FLOOR_LIFT;
  const deckY = groundY + GARAGE_LEVEL_HEIGHT;
  const deckFloorBottom = deckY - GARAGE_DECK_THICKNESS;
  // Pillars rise to the deck top (the top deck is open-air; no roof above it).
  const roofTop = deckY;
  const walkCos = Math.cos((GARAGE_WALK_LIMIT_DEG * Math.PI) / 180);
  const rampStripMaxX = minX + GARAGE_RAMP_STRIP_WIDTH;
  // The ramp stops climbing at rampClimbTopZ (feet = deckY), runs FLAT for the
  // landing, then the deck rect begins at rampTopZ. The flat landing is what lets
  // the climber's feet settle to deckY before the deck's banded south face.
  const rampClimbTopZ = Math.min(maxZ - 10, minZ + GARAGE_RAMP_RUN);
  const rampTopZ = rampClimbTopZ + GARAGE_LANDING_DEPTH;
  // The upper deck is the full-width NORTH portion the ramp+landing tops INTO. South
  // of it: ramp + flat landing (west) and ground floor (east).
  const deckArea: GarageRect = { minX, minZ: rampTopZ, maxX, maxZ };

  // Pillars: a colonnade down the deck's WEST and EAST edges only, supporting the
  // upper deck. The car bays sit in the interior (x[minX+2, maxX-2]), so edge
  // columns never land inside a parked car — and there's no pointless interior grid.
  const pillars: Array<{ x: number; z: number }> = [];
  for (let pz = rampTopZ + 1.5; pz <= maxZ - 1; pz += 6.5) {
    pillars.push({ x: minX + 0.9, z: pz });
    pillars.push({ x: maxX - 0.9, z: pz });
  }

  // Nose-in rows of cars. Deck cars fill the north deck (at deckY); ground cars fill
  // the south-east ground floor beside the ramp (at groundY). ~half the bays hold one.
  const bays: GarageBay[] = [];
  const cars: StructureCar[] = [];
  const addRows = (x0: number, x1: number, z0: number, z1: number, surfaceY: number, salt: number) => {
    const usableW = x1 - x0;
    const bayCount = Math.max(1, Math.floor(usableW / BAY_WIDTH_METERS));
    const rowZs = z1 - z0 > 12 ? [z0 + 4, z1 - 4] : [(z0 + z1) / 2];
    for (let r = 0; r < rowZs.length; r += 1) {
      for (let i = 0; i < bayCount; i += 1) {
        const x = x0 + (i + 0.5) * (usableW / bayCount);
        const hsh = hash2(salt * 211 + r * 17, i);
        const occupied = (hsh % 100) / 100 < GARAGE_CAR_FILL;
        const colorIndex = hsh % 9;
        bays.push({ x, z: rowZs[r], y: surfaceY, yawDegrees: 0, occupied, colorIndex });
        if (occupied) cars.push({ x, y: surfaceY, z: rowZs[r], yawDegrees: 0, colorIndex });
      }
    }
  };
  addRows(minX + 2, maxX - 2, rampTopZ, maxZ, deckY, 1); // upper deck
  addRows(rampStripMaxX + 1, maxX - 2, minZ + 2, rampTopZ, groundY, 2); // ground, beside the ramp

  return {
    footprint: f, side, minX, maxX, minZ, maxZ, baseY: b.y, groundY, deckY, deckFloorBottom,
    roofTop, walkCos, rampStripMaxX, rampClimbTopZ, rampTopZ, deckArea, pillars, bays, cars,
  };
}

// The walkable floor height (meters above b.y) at a world point: flat ground
// everywhere, rising along the west ramp strip to the deck level. Single-valued
// (no overhang) — the deck overhang is the banded platform rect, not this field.
// Sampled from a precomputed spec (the bake calls this thousands of times).
function riseFromSpec(spec: ParkingGarageSpec, x: number, z: number): number {
  if (x < spec.minX || x > spec.maxX || z < spec.minZ || z > spec.maxZ) return 0;
  // West strip: climb to deck level by rampClimbTopZ, then a FLAT landing only
  // across the buffer [rampClimbTopZ, rampTopZ] (lets the climber's feet settle to
  // deckY before the deck rect). NORTH of rampTopZ it drops back to the ground floor
  // — that area is UNDER the deck slab, so the heightfield must NOT also sit at deck
  // level there or it z-fights the slab. Everywhere else is ground floor; the deck
  // overhang is the banded rect, not this field.
  if (x <= spec.rampStripMaxX) {
    if (z <= spec.rampClimbTopZ) {
      const u = (z - spec.minZ) / (spec.rampClimbTopZ - spec.minZ);
      return GARAGE_FLOOR_LIFT + GARAGE_LEVEL_HEIGHT * u;
    }
    if (z <= spec.rampTopZ) return GARAGE_FLOOR_LIFT + GARAGE_LEVEL_HEIGHT; // flat landing buffer
  }
  return GARAGE_FLOOR_LIFT;
}

// The ONE height source baked into both the Heightfield mesh and the host collider,
// so the ramp you see is the ramp you climb.
export function garageRise(b: Building, x: number, z: number): number {
  return riseFromSpec(parkingGarageSpec(b), x, z);
}

export function parkingGarageField(b: Building): TerrainField {
  const spec = parkingGarageSpec(b);
  return bakeTerrainField({
    centerX: spec.footprint.cx,
    centerZ: spec.footprint.cz,
    baseY: b.y,
    halfWidth: spec.side / 2,
    resolution: GARAGE_FIELD_RESOLUTION,
    walkCos: spec.walkCos,
    rise: (x, z) => riseFromSpec(spec, x, z),
  });
}

export function parkingGarageColliderData(b: Building): TerrainColliderData {
  return terrainColliderData(parkingGarageField(b));
}

// ── Gas station ───────────────────────────────────────────────────────────────
//
// A forecourt: a flat lit canopy on slim pillars over two fuel-pump islands, with
// a small convenience store box at the back edge and a tall price-pylon sign by
// the front. The canopy + store are the structure's read; the pumps are where you
// (later) refuel.

const CANOPY_THICKNESS = 0.45;
const GAS_PILLAR_SIZE = 0.55;

export type FuelPump = { x: number; z: number; y: number; yawDegrees: number };
export type GasStationSpec = {
  footprint: Footprint;
  canopy: { minX: number; minZ: number; maxX: number; maxZ: number; bottomY: number; topY: number };
  pillars: Array<{ x: number; z: number; topY: number }>;
  pumps: FuelPump[];
  store: { minX: number; minZ: number; maxX: number; maxZ: number; y: number; topY: number };
  sign: { x: number; z: number; y: number; topY: number };
};

export function gasStationSpec(b: Building): GasStationSpec {
  const f = footprintOf(b);
  const canopyTop = b.y + buildingKindHeightMeters(b.kind);
  const canopyBottom = canopyTop - CANOPY_THICKNESS;

  // The store occupies the back third (toward maxZ); the canopy covers the front
  // two-thirds where the pumps sit.
  const storeDepth = Math.min(6, f.d * 0.32);
  const store = {
    minX: f.minX + 1,
    maxX: f.maxX - 1,
    minZ: f.maxZ - storeDepth,
    maxZ: f.maxZ,
    y: b.y,
    topY: b.y + 2 * STOREY,
  };

  const canopy = {
    minX: f.minX,
    maxX: f.maxX,
    minZ: f.minZ,
    maxZ: store.minZ - 1,
    bottomY: canopyBottom,
    topY: canopyTop,
  };

  const pillarX = [canopy.minX + 0.8, canopy.maxX - 0.8];
  const pillarZ = [canopy.minZ + 0.8, canopy.maxZ - 0.8];
  const pillars: Array<{ x: number; z: number; topY: number }> = [];
  for (const x of pillarX) for (const z of pillarZ) pillars.push({ x, z, topY: canopyBottom });

  // Two pump islands centered under the canopy, set apart along X.
  const pumpZ = (canopy.minZ + canopy.maxZ) / 2;
  const pumps: FuelPump[] = [
    { x: f.cx - 4, z: pumpZ, y: b.y, yawDegrees: 90 },
    { x: f.cx + 4, z: pumpZ, y: b.y, yawDegrees: 90 },
  ];

  const sign = { x: f.minX + 1.5, z: f.minZ + 1.5, y: b.y, topY: b.y + 2 * STOREY + 1.5 };

  return { footprint: f, canopy, pillars, pumps, store, sign };
}

// ── Used car lot ──────────────────────────────────────────────────────────────
//
// An open sales lot: rows of cars facing the front, a small glass sales kiosk in
// the back corner, a tall price banner, and two strings of pennant flags strung
// across the lot. Only the kiosk + sign post are solid; the cars are scenery you
// browse.

const LOT_CAR_SPACING_X = 3.4;
const LOT_CAR_SPACING_Z = 6;

export type UsedCarLotSpec = {
  footprint: Footprint;
  cars: StructureCar[];
  kiosk: { minX: number; minZ: number; maxX: number; maxZ: number; y: number; topY: number };
  sign: { x: number; z: number; y: number; topY: number };
  // Two pennant strings: each a pair of end anchors a flag line spans between.
  pennants: Array<{ from: { x: number; z: number }; to: { x: number; z: number }; y: number }>;
};

export function usedCarLotSpec(b: Building): UsedCarLotSpec {
  const f = footprintOf(b);

  const kiosk = {
    minX: f.maxX - 5,
    maxX: f.maxX - 0.5,
    minZ: f.maxZ - 4.5,
    maxZ: f.maxZ - 0.5,
    y: b.y,
    topY: b.y + STOREY,
  };

  // A grid of cars filling the front of the lot, leaving the kiosk corner clear.
  const cars: StructureCar[] = [];
  const startX = f.minX + 2.2;
  const startZ = f.minZ + 3.5;
  const cols = Math.max(1, Math.floor((f.w - 4) / LOT_CAR_SPACING_X));
  const rows = Math.max(1, Math.floor((f.d - 6) / LOT_CAR_SPACING_Z));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = startX + c * LOT_CAR_SPACING_X;
      const z = startZ + r * LOT_CAR_SPACING_Z;
      // Skip cars that would sit on the kiosk.
      if (x > kiosk.minX - 1.5 && z > kiosk.minZ - 1.5) continue;
      const h = hash2(r * 53 + 7, c);
      cars.push({ x, y: b.y, z, yawDegrees: r % 2 === 0 ? 0 : 180, colorIndex: h % 9 });
    }
  }

  const sign = { x: f.minX + 1.5, z: f.minZ + 1.5, y: b.y, topY: b.y + STOREY + 2.5 };

  const pennants = [
    { from: { x: f.minX + 0.5, z: f.minZ + 0.5 }, to: { x: f.maxX - 0.5, z: f.minZ + 0.5 }, y: b.y + 3.4 },
    { from: { x: f.minX + 0.5, z: f.cz }, to: { x: f.maxX - 0.5, z: f.cz }, y: b.y + 3.4 },
  ];

  return { footprint: f, cars, kiosk, sign, pennants };
}

// ── Drive-in movie theatre ──────────────────────────────────────────────────
//
// A big-screen wall standing at the back of an open lot, raised on two legs,
// with a small projector/concession booth out in the lot you walk up to and
// press E (opens a file picker — choose a movie). The screen's -Z ('back') face
// samples a LIVE video texture: render3d/driveInScreen captures a <Video> to
// driveInScreenTextureKey(b.id) (the billboard pattern), and the screen mesh in
// render3d/structures/DriveIn samples that key. Solid mass: the screen wall (a
// tall thin slab, full height to the ground — no walking through the screen),
// the booth, and the marquee pole. The lot in front is bare ground. The wall
// pins to the maxZ edge and the screen faces -Z, so the lot (and the booth)
// open toward minZ — the side the player arrives from spawn on.

const DRIVEIN_SCREEN_HEIGHT = 16; // lit panel height (m)
const DRIVEIN_SCREEN_LIFT = 2.5; // panel bottom off the ground (the legs)
const DRIVEIN_WALL_THICKNESS = 1.4;
const DRIVEIN_WALL_MARGIN = 1.3; // structural wall overhang past the lit panel, each side
const DRIVEIN_LEG_HALF = 0.9;
const DRIVEIN_BOOTH_SIZE = 3.4;
const DRIVEIN_BOOTH_HEIGHT = 3.0;
const DRIVEIN_BOOTH_SETBACK = 12; // booth distance in from the lot front (minZ) edge
const DRIVEIN_INTERACT_RANGE_METERS = 4.0;

export type DriveInSpec = {
  footprint: Footprint;
  // The lit screen panel — its -Z ('back') face shows the video, toward the lot.
  screen: { cx: number; faceZ: number; bottomY: number; topY: number; width: number; height: number };
  // The structural wall behind the panel (the "big ass wall"), solid to the ground.
  wall: { minX: number; minZ: number; maxX: number; maxZ: number; topY: number; baseY: number };
  // The two legs the screen stands on (visual; the wall slab carries collision).
  legs: Array<{ x: number; z: number; topY: number }>;
  // The interactable projector/concession booth out in the lot, facing the screen.
  booth: { minX: number; minZ: number; maxX: number; maxZ: number; cx: number; cz: number; y: number; topY: number };
  // The marquee pole + board at the lot entrance corner.
  marquee: { x: number; z: number; y: number; topY: number };
};

export function driveInSpec(b: Building): DriveInSpec {
  const f = footprintOf(b);
  const screenWidth = Math.max(12, Math.min(f.w - 6, 48));
  const cx = f.cx;
  const bottomY = b.y + DRIVEIN_SCREEN_LIFT;
  const topY = bottomY + DRIVEIN_SCREEN_HEIGHT;

  // Wall pins to the back (maxZ) edge; its -Z face carries the lit panel, so the
  // screen faces -Z toward the lot (and the player approaching from minZ/spawn).
  const wallMaxZ = f.maxZ - 0.6;
  const wallMinZ = wallMaxZ - DRIVEIN_WALL_THICKNESS;
  const faceZ = wallMinZ - 0.2; // panel proud of the wall, toward the lot (-Z)
  const wall = {
    minX: cx - screenWidth / 2 - DRIVEIN_WALL_MARGIN,
    maxX: cx + screenWidth / 2 + DRIVEIN_WALL_MARGIN,
    minZ: wallMinZ,
    maxZ: wallMaxZ,
    topY,
    baseY: b.y,
  };
  const screen = { cx, faceZ, bottomY, topY, width: screenWidth, height: DRIVEIN_SCREEN_HEIGHT };

  const legZ = (wallMinZ + wallMaxZ) / 2;
  const legs = [
    { x: cx - screenWidth / 2 + DRIVEIN_LEG_HALF, z: legZ, topY: bottomY },
    { x: cx + screenWidth / 2 - DRIVEIN_LEG_HALF, z: legZ, topY: bottomY },
  ];

  // Booth out in the lot toward the front (minZ) edge, where arriving players meet it.
  const bcz = f.minZ + DRIVEIN_BOOTH_SETBACK;
  const bh = DRIVEIN_BOOTH_SIZE / 2;
  const booth = {
    minX: cx - bh, minZ: bcz - bh, maxX: cx + bh, maxZ: bcz + bh,
    cx, cz: bcz, y: b.y, topY: b.y + DRIVEIN_BOOTH_HEIGHT,
  };

  const marquee = { x: f.minX + 2, z: f.minZ + 2, y: b.y, topY: b.y + 5.5 };

  return { footprint: f, screen, wall, legs, booth, marquee };
}

// The live-video texture key for a drive-in screen — the contract between the
// screen mesh (render3d/structures/DriveIn) and the capture host
// (render3d/driveInScreen). JSX-free so both sides import it from here.
export function driveInScreenTextureKey(buildingId: string): string {
  return `hmsc.driveIn.${buildingId}`;
}

// The booth (interact anchor) world center + the proximity range for the
// E-to-pick-a-movie prompt (state/useBuildingInteract reads these).
export function driveInBoothPoint(b: Building): { x: number; z: number } {
  const s = driveInSpec(b);
  return { x: s.booth.cx, z: s.booth.cz };
}

export const DRIVEIN_BOOTH_INTERACT_RANGE_METERS = DRIVEIN_INTERACT_RANGE_METERS;

// ── Collision: the solid masses host physics blocks on, derived from the same
// specs the renderers draw (see-it == walk-it). Full-height columns + back boxes;
// upper decks/cars are not solid this pass (see COLLISION SCOPE above). ──────────

function columnSolid(x: number, z: number, half: number, topMeters: number): StructureSolid {
  return { minX: x - half, minZ: z - half, maxX: x + half, maxZ: z + half, topMeters };
}

// A parked car as a solid AABB you bump into. The body is ~2.1m across × 5.0m long;
// at yaw 0/180 the length lies along Z, at 90/270 along X — swap the extents so the
// block matches the rendered car. Top is the roofline. Matches Car.tsx dimensions.
const CAR_HALF_WIDTH = 1.05;
const CAR_HALF_LENGTH = 2.5;
const CAR_TOP_METERS = 1.7;
function carSolid(car: StructureCar): StructureSolid {
  const yaw = (((car.yawDegrees % 360) + 360) % 360);
  const sideways = Math.abs(yaw - 90) < 45 || Math.abs(yaw - 270) < 45;
  const halfX = sideways ? CAR_HALF_LENGTH : CAR_HALF_WIDTH;
  const halfZ = sideways ? CAR_HALF_WIDTH : CAR_HALF_LENGTH;
  // Banded from the deck the car sits on (car.y) up to its roof, so a car parked on
  // an upper deck doesn't wall off the floor below — you walk under it.
  return { minX: car.x - halfX, minZ: car.z - halfZ, maxX: car.x + halfX, maxZ: car.z + halfZ, topMeters: car.y + CAR_TOP_METERS, floorMeters: car.y };
}

export function structureSolids(b: Building): StructureSolid[] {
  switch (buildingKindDefinition(b.kind).structureModel) {
    case 'parkingGarage': {
      const spec = parkingGarageSpec(b);
      // Pillars are solid columns to the roof (no floor field → solid to ground).
      const out = spec.pillars.map((p) => columnSolid(p.x, p.z, PILLAR_SIZE_METERS / 2, spec.roofTop));
      const d = spec.deckArea;
      // The upper deck: a banded platform — stand on top (deckY), walk under (down
      // to deckFloorBottom). This is what makes it a real stacked level, not a hill.
      out.push({ minX: d.minX, minZ: d.minZ, maxX: d.maxX, maxZ: d.maxZ, topMeters: spec.deckY, floorMeters: spec.deckFloorBottom });
      // Parapet around the deck rim (banded above the deck → walk under it on the
      // ground floor), with the SOUTH edge open where the ramp tops in.
      const t = GARAGE_PARAPET_THICKNESS;
      const pTop = spec.deckY + GARAGE_PARAPET_HEIGHT;
      const wall = (minX: number, minZ: number, maxX: number, maxZ: number): StructureSolid =>
        ({ minX, minZ, maxX, maxZ, topMeters: pTop, floorMeters: spec.deckY });
      out.push(wall(d.minX, d.maxZ - t, d.maxX, d.maxZ)); // north
      out.push(wall(d.minX, d.minZ, d.minX + t, d.maxZ)); // west
      out.push(wall(d.maxX - t, d.minZ, d.maxX, d.maxZ)); // east
      out.push(wall(spec.rampStripMaxX, d.minZ, d.maxX, d.minZ + t)); // south, east of the ramp opening
      // Ramp side walls (solid to the ground) so you can't walk through the ramp's
      // flanks. The east wall (between ramp and ground floor) leaves the low ~3.5m
      // open so you step onto the ramp from the ground floor; the west wall is the
      // footprint-edge guardrail. Top = deck level, so the ramp rises into them.
      const rw = GARAGE_PARAPET_THICKNESS;
      const rampWall = (minX: number, minZ: number, maxX: number, maxZ: number): StructureSolid =>
        ({ minX, minZ, maxX, maxZ, topMeters: spec.deckY });
      out.push(rampWall(spec.rampStripMaxX - rw, spec.minZ + 3.5, spec.rampStripMaxX, spec.rampTopZ)); // east
      out.push(rampWall(spec.minX, spec.minZ, spec.minX + rw, spec.rampTopZ)); // west (footprint edge)
      // Cars on both levels — banded from their deck so upper-deck cars don't block
      // the floor under them.
      for (const car of spec.cars) out.push(carSolid(car));
      return out;
    }
    case 'gasStation': {
      const spec = gasStationSpec(b);
      const out: StructureSolid[] = [];
      // The convenience store is a solid box up to its roof.
      out.push({ minX: spec.store.minX, minZ: spec.store.minZ, maxX: spec.store.maxX, maxZ: spec.store.maxZ, topMeters: spec.store.topY });
      // Canopy pillars block to the canopy underside.
      for (const p of spec.pillars) out.push(columnSolid(p.x, p.z, GAS_PILLAR_SIZE / 2, p.topY));
      // Pump islands are low solid curbs.
      for (const p of spec.pumps) out.push(columnSolid(p.x, p.z, 1.1, b.y + 0.4));
      // The pylon sign post.
      out.push(columnSolid(spec.sign.x, spec.sign.z, 0.25, spec.sign.topY));
      return out;
    }
    case 'usedCarLot': {
      const spec = usedCarLotSpec(b);
      const out: StructureSolid[] = [
        { minX: spec.kiosk.minX, minZ: spec.kiosk.minZ, maxX: spec.kiosk.maxX, maxZ: spec.kiosk.maxZ, topMeters: spec.kiosk.topY },
        columnSolid(spec.sign.x, spec.sign.z, 0.25, spec.sign.topY),
      ];
      // Every car on the lot is solid (all ground-level) — you weave between them.
      for (const car of spec.cars) out.push(carSolid(car));
      return out;
    }
    case 'driveIn': {
      const spec = driveInSpec(b);
      const out: StructureSolid[] = [];
      // The screen wall: a solid slab from the ground to the screen top (the legs
      // read as open, but the mass is solid — you can't walk through the screen).
      out.push({ minX: spec.wall.minX, minZ: spec.wall.minZ, maxX: spec.wall.maxX, maxZ: spec.wall.maxZ, topMeters: spec.wall.topY });
      // The projector/concession booth.
      out.push({ minX: spec.booth.minX, minZ: spec.booth.minZ, maxX: spec.booth.maxX, maxZ: spec.booth.maxZ, topMeters: spec.booth.topY });
      // The marquee pole at the lot entrance.
      out.push(columnSolid(spec.marquee.x, spec.marquee.z, 0.3, spec.marquee.topY));
      return out;
    }
    default:
      return [];
  }
}

// Whether an open structure's solid mass blocks a world point — the JS-fallback
// collision (mirrors buildingBlocksWorldPoint for box kinds).
export function structureBlocksWorldPoint(b: Building, x: number, z: number): boolean {
  return structureSolids(b).some((s) => x >= s.minX && x < s.maxX && z >= s.minZ && z < s.maxZ);
}
