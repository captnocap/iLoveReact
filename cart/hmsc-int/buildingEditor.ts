// Building face-skin editor logic for hmsc-int.
//
// The internal tool stages per-face skin choices and EMITS `wv_building face`
// commands (the painter's emit-not-mutate pattern — hmsc-int reads the shared
// world but can't mutate the running game). Picking a building is a footprint
// hit-test on the same click that selects a cell, so loading a building "by id"
// is just clicking its footprint; the id is shown and drives every command.

import type { Building, BuildingFaceRole, BuildingSkin } from '../hmsc/design';
import { BUILDING_FACE_ROLES, buildingFootprint, buildingRoleSkin } from '../hmsc/world/buildings';
import { BUILDING_SKIN_NAMES } from '../hmsc/render3d/buildingSkins';

export type FaceSkins = Record<BuildingFaceRole, BuildingSkin>;

export const FACE_ROLES = BUILDING_FACE_ROLES;
export const SKIN_NAMES = BUILDING_SKIN_NAMES;

// The building whose footprint covers cell (x,z), or null. First hit wins; if
// footprints overlap (forced placement), the earliest-placed building reads.
export function buildingAtCell(buildings: Building[], x: number, z: number): Building | null {
  for (const b of buildings) {
    const f = buildingFootprint(b);
    if (x >= f.minX && x < f.maxX && z >= f.minZ && z < f.maxZ) return b;
  }
  return null;
}

// The skin each face role currently shows, resolved through the canonical
// role resolver so the editor's "before" matches what the game renders.
export function currentFaceSkins(b: Building): FaceSkins {
  const out = {} as FaceSkins;
  for (const role of FACE_ROLES) out[role] = buildingRoleSkin(b, role);
  return out;
}

// One `wv_building face` line per role whose staged skin differs from the
// building's current skin — the minimal command set to apply the edit. Empty
// when nothing changed.
export function faceSkinCommands(buildingId: string, current: FaceSkins, staged: FaceSkins): string[] {
  const lines: string[] = [];
  for (const role of FACE_ROLES) {
    if (staged[role] !== current[role]) lines.push(`wv_building face ${buildingId} ${role} ${staged[role]}`);
  }
  return lines;
}
