import type { Building, BuildingFaceRole, BuildingSide, BuildingSkin, Vec3 } from '../design';
import { buildingDefaultSkin, buildingKindDefinition, buildingKindHeightMeters, isOpenBuildingKind } from './buildingKinds';
import { structureBlocksWorldPoint, structureSolids } from './structures';
import { HMSC_SCALE } from './scale';

// World-layer geometry, physics, and mutations for buildings — the buildings
// twin of roads.ts/props.ts. A building is an axis-aligned footprint anchored at
// its min-corner (x,z) on the cell floor (y). Its solid mass is expressed as a
// set of XZ boxes (buildingBoxes); the SAME boxes feed both host physics (as
// blocking rects) and the 3D renderer (as wall meshes), so collision and visuals
// can never drift. 1 tile = 1 meter.
//
// The enclosure mode picks the box set:
//   - sealed:   one filled footprint box. No entry; you bump it and stand on top.
//   - hollow:   four perimeter walls with a gap on the door side. You walk in;
//               the floor inside is the SAME outer-world surface (one space).
//   - interior: four perimeter walls with NO gap (a sealed shell). Entry is the
//               door PAD in front of it (a 'door' placedCell carrying wv_enter),
//               which swaps the player into a separate, larger interior space.

export const BUILDING_WALL_THICKNESS_METERS = 0.3;

export type BuildingFootprint = { minX: number; minZ: number; maxX: number; maxZ: number };

// One solid mass of a building in the XZ plane. Spans the full wall height
// (b.y .. buildingTopMeters) in Y; only the XZ rect varies between boxes.
export type BuildingBox = BuildingFootprint;

export function buildingFootprint(b: Building): BuildingFootprint {
  return { minX: b.x, minZ: b.z, maxX: b.x + b.widthTiles, maxZ: b.z + b.depthTiles };
}

export function buildingHeightMeters(b: Building): number {
  return buildingKindHeightMeters(b.kind);
}

export function buildingTopMeters(b: Building): number {
  return b.y + buildingHeightMeters(b);
}

// The door opening's center, in world meters, on the building's door side — used
// both to split the hollow wall and to place the entry pad / interior spawn.
export function buildingDoorCenter(b: Building): { x: number; z: number } {
  const f = buildingFootprint(b);
  switch (b.doorSide) {
    case 'north': return { x: (f.minX + f.maxX) / 2, z: f.maxZ };
    case 'south': return { x: (f.minX + f.maxX) / 2, z: f.minZ };
    case 'east': return { x: f.maxX, z: (f.minZ + f.maxZ) / 2 };
    case 'west': return { x: f.minX, z: (f.minZ + f.maxZ) / 2 };
  }
}

// The cells flush in front of the door — the entry-pad footprint for interior
// buildings. They sit ONE cell outside the door wall (so the player stands on
// them the moment they walk up to the closed door) and span the full doorway
// width, so an even-width building whose door center lands on a cell boundary
// can't be approached "between" pad cells and miss the trigger. 1 tile = 1 m.
export function buildingDoorFrontCells(b: Building): Array<{ x: number; y: number; z: number }> {
  const f = buildingFootprint(b);
  const center = buildingDoorCenter(b);
  const half = HMSC_SCALE.doorWidthMeters / 2;
  const span = (lo: number, hi: number): number[] => {
    const cells: number[] = [];
    for (let c = Math.floor(lo); c <= Math.floor(hi - 1e-6); c += 1) cells.push(c);
    return cells.length ? cells : [Math.floor((lo + hi) / 2)];
  };
  const horizontal = b.doorSide === 'north' || b.doorSide === 'south';
  if (horizontal) {
    const z = b.doorSide === 'south' ? Math.floor(f.minZ) - 1 : Math.floor(f.maxZ);
    return span(center.x - half, center.x + half).map((x) => ({ x, y: b.y, z }));
  }
  const x = b.doorSide === 'west' ? Math.floor(f.minX) - 1 : Math.floor(f.maxX);
  return span(center.z - half, center.z + half).map((z) => ({ x, y: b.y, z }));
}

// The world point in front of the door center, where leaving an interior drops
// the player back (facing away from the building). It sits ONE CELL BEYOND the
// entry pad (which is one cell out from the wall), so leaving never lands the
// player back on the wv_enter pad and bounces them straight back in.
const DOOR_RETURN_OFFSET_METERS = 1.5;
export function buildingDoorFrontPoint(b: Building): { x: number; z: number } {
  const f = buildingFootprint(b);
  const center = buildingDoorCenter(b);
  const d = DOOR_RETURN_OFFSET_METERS;
  switch (b.doorSide) {
    case 'north': return { x: center.x, z: f.maxZ + d };
    case 'south': return { x: center.x, z: f.minZ - d };
    case 'east': return { x: f.maxX + d, z: center.z };
    case 'west': return { x: f.minX - d, z: center.z };
  }
}

// A wall strip along one footprint edge, thickness BUILDING_WALL_THICKNESS_METERS
// inward, optionally split to leave a doorWidth gap centered on the edge.
function wallBoxesForSide(f: BuildingFootprint, side: BuildingSide, gap: boolean): BuildingBox[] {
  const t = BUILDING_WALL_THICKNESS_METERS;
  const half = HMSC_SCALE.doorWidthMeters / 2;
  const horizontal = side === 'north' || side === 'south';
  const minAcross = horizontal ? f.minX : f.minZ;
  const maxAcross = horizontal ? f.maxX : f.maxZ;
  const center = (minAcross + maxAcross) / 2;

  const strip = (lo: number, hi: number): BuildingBox => {
    if (horizontal) {
      const z = side === 'north' ? { minZ: f.maxZ - t, maxZ: f.maxZ } : { minZ: f.minZ, maxZ: f.minZ + t };
      return { minX: lo, maxX: hi, ...z };
    }
    const x = side === 'east' ? { minX: f.maxX - t, maxX: f.maxX } : { minX: f.minX, maxX: f.minX + t };
    return { minZ: lo, maxZ: hi, ...x };
  };

  if (!gap) return [strip(minAcross, maxAcross)];
  return [strip(minAcross, center - half), strip(center + half, maxAcross)];
}

// The solid masses of a building, the one geometry source for physics + render.
export function buildingBoxes(b: Building): BuildingBox[] {
  const f = buildingFootprint(b);
  if (b.enclosure === 'sealed') return [f];
  const sides: BuildingSide[] = ['north', 'south', 'east', 'west'];
  // hollow has a real doorway on its door side; interior is a closed shell whose
  // entry is the portal pad, so all four walls are solid.
  const gapSide = b.enclosure === 'hollow' ? b.doorSide : null;
  return sides.flatMap((side) => wallBoxesForSide(f, side, side === gapSide));
}

// A blocking rect for host physics, in the same packed shape roads/props use:
// [minX, minZ, maxX, maxZ, top]. top = the wall top, so the host collides with
// the sides while the player is below and lets them stand on the roof once above
// (the standable-solid-rects rule in v8_bindings_physics_lab.zig).
// topMeters is the solid top; floorMeters (optional) the solid BOTTOM — a raised
// platform (parking deck) sets it so the host lets you walk under, while a wall
// omits it and stays solid to the ground. See state/hostPhysics RECT_SOLID_FLOOR.
export type BuildingPhysicsRect = BuildingBox & { topMeters: number; floorMeters?: number };

export function buildingPhysicsRects(b: Building): BuildingPhysicsRect[] {
  // Open structures own their collision: full-height columns (pillars) and back
  // boxes (store/kiosk/sign), each with its own top, from world/structures.ts —
  // the same layout the custom model draws. Box kinds use the uniform wall boxes.
  if (isOpenBuildingKind(b.kind)) return structureSolids(b);
  const top = buildingTopMeters(b);
  return buildingBoxes(b).map((box) => ({ ...box, topMeters: top }));
}

function footprintContains(f: BuildingFootprint, x: number, z: number): boolean {
  return x >= f.minX && x < f.maxX && z >= f.minZ && z < f.maxZ;
}

// Whether a building's solid mass blocks a world point — the JS-fallback collision
// used when the host physics step is unavailable (mirrors canOccupyWorldPosition's
// other checks). A box is solid full-height, so any point inside a box blocks.
export function buildingBlocksWorldPoint(b: Building, x: number, z: number): boolean {
  if (isOpenBuildingKind(b.kind)) return structureBlocksWorldPoint(b, x, z);
  return buildingBoxes(b).some((box) => footprintContains(box, x, z));
}

export function buildingWallSurface(b: Building) {
  return buildingKindDefinition(b.kind).wallTileKind;
}

// The face role of an absolute wall side, relative to the building's facing:
// the door side is the front, its opposite the back, the two perpendicular walls
// left/right. Left/right use one consistent winding (left = the side reached by
// turning the front normal 90° one way); flip LEFT_OF if they read mirrored.
const OPPOSITE_SIDE: Record<BuildingSide, BuildingSide> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
};
const LEFT_OF: Record<BuildingSide, BuildingSide> = {
  south: 'east', north: 'west', east: 'north', west: 'south',
};

export function buildingFaceRole(doorSide: BuildingSide, side: BuildingSide): 'front' | 'back' | 'left' | 'right' {
  if (side === doorSide) return 'front';
  if (side === OPPOSITE_SIDE[doorSide]) return 'back';
  return side === LEFT_OF[doorSide] ? 'left' : 'right';
}

// The skin on one wall face — a per-face override, the `all` fallback, a bare
// single-skin string applied to every wall, or the kind default.
export function resolveFaceSkin(b: Building, side: BuildingSide): BuildingSkin {
  const skin = b.skin;
  if (skin == null) return buildingDefaultSkin(b.kind);
  if (typeof skin === 'string') return skin;
  const role = buildingFaceRole(b.doorSide, side);
  return skin[role] ?? skin.all ?? buildingDefaultSkin(b.kind);
}

// The roof skin — only a per-face `top` lights it up; a single-skin string or no
// skin leaves the roof plain (a facade stretched over the roof reads wrong).
export function resolveTopSkin(b: Building): BuildingSkin {
  const skin = b.skin;
  if (skin == null || typeof skin === 'string') return 'plain';
  return skin.top ?? 'plain';
}

// The building's representative skin (its front wall) — for console listings and
// any "one skin" query. Face rendering uses resolveFaceSkin per wall.
export function resolveBuildingSkin(b: Building): BuildingSkin {
  return resolveFaceSkin(b, b.doorSide);
}

// The five editable face roles, door-relative — the surfaces `wv_building face`
// (and the internal tool's face editor) set a skin on.
export const BUILDING_FACE_ROLES: BuildingFaceRole[] = ['front', 'back', 'left', 'right', 'top'];

// The skin currently shown on a face ROLE (front/back/left/right/top), the
// role-keyed peer of resolveFaceSkin (which is side-keyed). One resolver both the
// editor and any role query share, so skin-fallback logic lives in one place.
export function buildingRoleSkin(b: Building, role: BuildingFaceRole): BuildingSkin {
  if (role === 'top') return resolveTopSkin(b);
  const skin = b.skin;
  if (skin == null) return buildingDefaultSkin(b.kind);
  if (typeof skin === 'string') return skin;
  return skin[role] ?? skin.all ?? buildingDefaultSkin(b.kind);
}

// --- Facade faces ---
//
// The four exterior wall faces of a building, for laying a skinned facade panel
// flat against each one (a thin textured quad, billboard-style). `widthMeters`
// is the side length, `heightMeters` the wall height; `outward*` is the unit
// normal to nudge the panel off the wall (no z-fight). north/south faces span X,
// east/west span Z. Shared by the panel renderer and the texture-capture sizing.
export type BuildingFace = {
  side: BuildingSide;
  centerX: number;
  centerZ: number;
  widthMeters: number;
  heightMeters: number;
  outwardX: number;
  outwardZ: number;
  horizontal: boolean;
};

export function buildingExteriorFaces(b: Building): BuildingFace[] {
  const f = buildingFootprint(b);
  const h = buildingHeightMeters(b);
  const cx = (f.minX + f.maxX) / 2;
  const cz = (f.minZ + f.maxZ) / 2;
  const spanX = f.maxX - f.minX;
  const spanZ = f.maxZ - f.minZ;
  return [
    { side: 'north', centerX: cx, centerZ: f.maxZ, widthMeters: spanX, heightMeters: h, outwardX: 0, outwardZ: 1, horizontal: true },
    { side: 'south', centerX: cx, centerZ: f.minZ, widthMeters: spanX, heightMeters: h, outwardX: 0, outwardZ: -1, horizontal: true },
    { side: 'east', centerX: f.maxX, centerZ: cz, widthMeters: spanZ, heightMeters: h, outwardX: 1, outwardZ: 0, horizontal: false },
    { side: 'west', centerX: f.minX, centerZ: cz, widthMeters: spanZ, heightMeters: h, outwardX: -1, outwardZ: 0, horizontal: false },
  ];
}

// --- Camera occlusion ---
//
// The fraction along the segment from→to at which it first enters a building
// box (a full-height AABB from b.y to the wall top), or 1 if it never does. The
// third-person camera uses this to pull in to just before a wall instead of
// sitting behind it and hiding the player. Slab method per box; `from` is the
// look pivot near the player (assumed not inside a wall), so the smallest entry
// fraction across every box is the first occluder.
export function nearestBuildingHitFraction(buildings: Building[], from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  let nearest = 1;
  for (const b of buildings) {
    // Open structures (garage/gas/lot) read through their open sides, so the
    // camera should NOT pull in to them — only solid box buildings occlude.
    if (isOpenBuildingKind(b.kind)) continue;
    const top = buildingTopMeters(b);
    for (const box of buildingBoxes(b)) {
      const hit = segmentBoxEntryFraction(from, dx, dy, dz, box, b.y, top);
      if (hit != null && hit < nearest) nearest = hit;
    }
  }
  return nearest;
}

function segmentBoxEntryFraction(
  from: Vec3,
  dx: number,
  dy: number,
  dz: number,
  box: BuildingBox,
  minY: number,
  maxY: number,
): number | null {
  let tMin = 0;
  let tMax = 1;
  const slab = (origin: number, delta: number, lo: number, hi: number): boolean => {
    if (Math.abs(delta) < 1e-9) return origin >= lo && origin <= hi;
    let t1 = (lo - origin) / delta;
    let t2 = (hi - origin) / delta;
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    return tMin <= tMax;
  };
  if (!slab(from.x, dx, box.minX, box.maxX)) return null;
  if (!slab(from.y, dy, minY, maxY)) return null;
  if (!slab(from.z, dz, box.minZ, box.maxZ)) return null;
  return tMin > 0 ? tMin : null;
}
