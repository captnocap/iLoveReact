// Face-editor helpers for the building tool. The editor now APPLIES face skins
// directly to the staged GameState via setBuildingFaceSkin (the game's own
// mutator) instead of emitting `wv_building face` text — the shared-localstore
// channel means the authored world reaches the game on compile, so there is no
// command round-trip to drive. This module just resolves "which building is under
// this cell" and "what skin is on each face now"; skin resolution itself stays in
// cart/hmsc/world/buildings.ts (one home, no re-implementation).

import type { Building, BuildingFaceRole, BuildingFaceSkins, BuildingSkin } from './design';
import { BUILDING_FACE_ROLES, buildingFootprint, buildingRoleSkin } from './world/buildings';
import { BUILDING_SKIN_NAMES } from './render3d/buildingSkins';

export type FaceSkins = Record<BuildingFaceRole, BuildingSkin>;

export const FACE_ROLES = BUILDING_FACE_ROLES;
export const SKIN_NAMES = BUILDING_SKIN_NAMES;

// The building whose footprint covers cell (x,z), or null. First hit wins.
export function buildingAtCell(buildings: Building[], x: number, z: number): Building | null {
  for (const b of buildings) {
    const f = buildingFootprint(b);
    if (x >= f.minX && x < f.maxX && z >= f.minZ && z < f.maxZ) return b;
  }
  return null;
}

// The skin each face role currently shows, through the canonical role resolver.
export function currentFaceSkins(b: Building): FaceSkins {
  const out = {} as FaceSkins;
  for (const role of FACE_ROLES) out[role] = buildingRoleSkin(b, role);
  return out;
}

// Apply one face's texture to a building-skin value (a single skin OR a per-face
// map), promoting a single skin to a per-face map so the other faces keep their
// look. Mirrors the game's setBuildingFaceSkin but works on the bare skin value
// the editor stores on a Placement — no GameState round-trip needed.
export function applyFaceSkin(current: Building['skin'], role: BuildingFaceRole, skin: BuildingSkin): BuildingFaceSkins {
  const faces: BuildingFaceSkins = typeof current === 'object' && current !== null
    ? { ...current }
    : (typeof current === 'string' ? { all: current } : {});
  faces[role] = skin;
  return faces;
}
