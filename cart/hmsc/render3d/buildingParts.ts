// buildingParts — a building's texturable PARTS (render3d/parts.tsx Part[]).
//
// This is the describe side of the click-to-pick texture flow: the inspector picks
// against this list, the game renders from it (Building.tsx / BuildingFacades), and
// a per-part texture (Building.partTextures) keys off each part's id.
//
//   • BOX buildings → one thin facade panel per exterior wall face plus the roof,
//     ids `front/back/left/right/top` (the same role ids the legacy face-skin
//     model used, so old `skin` data maps straight onto a part). Panel geometry
//     mirrors BuildingFacades' buildingPanels exactly — one source of the math.
//   • OPEN structures (parkingGarage/gasStation/usedCarLot) → their model's own
//     parts (deck/parapet/pillar/…), which have NO face equivalent. That's the
//     whole point: a garage has no "front face" to skin, but it has a deck you can
//     click and texture. Each structure model exports its own *Parts(b).
//
// buildingPartTextures folds the legacy `skin` (per-face BuildingSkin) into the
// part-texture map so a building authored before partTextures still shows its skin:
// a non-'plain' face skin id IS a TEXTURE_REGISTRY id. Explicit partTextures win.

import type { Building } from '../design';
import type { Part, PartTextures } from './parts';
import {
  buildingExteriorFaces,
  buildingFaceRole,
  buildingFootprint,
  buildingHeightMeters,
  buildingRoleSkin,
  buildingTopMeters,
} from '../world/buildings';
import { buildingKindDefinition, isOpenBuildingKind } from '../world/buildingKinds';
import { buildingYawDegrees, yawAboutCenter } from './buildingTransform';
import { skinGridCols, skinGridFloors } from './buildingSkins';
import { parkingGarageParts } from './structures/ParkingGarage';
import { gasStationParts } from './structures/GasStation';
import { usedCarLotParts } from './structures/UsedCarLot';
import { driveInParts } from './structures/DriveIn';

const PANEL_NUDGE_METERS = 0.06;
const PANEL_THICKNESS = 0.05;

const ROLE_LABEL: Record<string, string> = {
  front: 'Front wall',
  back: 'Back wall',
  left: 'Left wall',
  right: 'Right wall',
  top: 'Roof',
};

// The five box facade panels (4 walls + roof) as pickable, texturable parts.
function boxBuildingParts(b: Building): Part[] {
  const out: Part[] = [];
  const yaw = buildingYawDegrees(b);
  for (const face of buildingExteriorFaces(b)) {
    // A hollow building's door side stays open (no panel), matching the renderer.
    if (b.enclosure === 'hollow' && face.side === b.doorSide) continue;
    const role = buildingFaceRole(b.doorSide, face.side);
    const [wx, wz] = yawAboutCenter(
      b,
      face.centerX + face.outwardX * PANEL_NUDGE_METERS,
      face.centerZ + face.outwardZ * PANEL_NUDGE_METERS,
    );
    out.push({
      id: role,
      label: ROLE_LABEL[role] ?? role,
      geometry: 'Box',
      params: { width: 1, height: 1, depth: 1 },
      scale: face.horizontal
        ? [face.widthMeters, face.heightMeters, PANEL_THICKNESS]
        : [PANEL_THICKNESS, face.heightMeters, face.widthMeters],
      texturedFaces: face.horizontal ? ['front', 'back'] : ['left', 'right'],
      position: [wx, b.y + face.heightMeters / 2, wz],
      rotation: [0, yaw, 0],
      material: buildingKindDefinition(b.kind).facadeColor,
      tex: { cols: skinGridCols(face.widthMeters), floors: skinGridFloors(face.heightMeters) },
    });
  }
  const f = buildingFootprint(b);
  const spanX = f.maxX - f.minX;
  const spanZ = f.maxZ - f.minZ;
  const [cx, cz] = yawAboutCenter(b, (f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2);
  out.push({
    id: 'top',
    label: ROLE_LABEL.top,
    geometry: 'Box',
    params: { width: 1, height: 1, depth: 1 },
    scale: [spanX, PANEL_THICKNESS, spanZ],
    texturedFaces: ['top'],
    position: [cx, buildingTopMeters(b) + PANEL_NUDGE_METERS, cz],
    rotation: [0, yaw, 0],
    material: buildingKindDefinition(b.kind).facadeColor,
    tex: { cols: skinGridCols(spanX), floors: skinGridFloors(spanZ) },
  });
  return out;
}

// Every texturable part of a building — box facade panels OR an open structure's
// own parts. The one list the inspector picks and the renderer draws.
export function buildingParts(b: Building): Part[] {
  if (!isOpenBuildingKind(b.kind)) return boxBuildingParts(b);
  const sm = buildingKindDefinition(b.kind).structureModel;
  if (sm === 'parkingGarage') return parkingGarageParts(b);
  if (sm === 'gasStation') return gasStationParts(b);
  if (sm === 'usedCarLot') return usedCarLotParts(b);
  if (sm === 'driveIn') return driveInParts(b);
  return [];
}

// The texture each part shows: explicit partTextures, with the legacy per-face
// `skin` folded in as the default for box buildings (a non-'plain' skin id is a
// valid TEXTURE_REGISTRY id, so old maps render unchanged). Open structures have
// no skin, so they read partTextures alone.
export function buildingPartTextures(b: Building): PartTextures {
  const out: PartTextures = {};
  if (!isOpenBuildingKind(b.kind)) {
    for (const role of ['front', 'back', 'left', 'right', 'top'] as const) {
      const skin = buildingRoleSkin(b, role);
      if (skin && skin !== 'plain') out[role] = skin;
    }
  }
  if (b.partTextures) Object.assign(out, b.partTextures);
  return out;
}
