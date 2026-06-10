import type { BuildingEnclosure, BuildingKind, BuildingSkin, TileKind } from '../design';
import { HMSC_SCALE } from './scale';

// The pure, render-free property bundle for every building kind — the buildings
// twin of propKinds.ts. Both the physics/pathing layer (world/buildings.ts,
// state/hostPhysics.ts) and the 3D model (render3d/Building.tsx) resolve a
// building through here, so a building's collision mass and its mesh agree on
// one footprint and one height. Kept JSX-free so host physics can import it
// without dragging the renderer along (same rule as tileKinds.ts/propKinds.ts).

// Which renderer + collision path a kind takes. 'box' is the default: wall boxes
// + a captured facade skin through Building3D. The others are open sculpted
// structures, each owning a custom model (render3d/buildingModels) and custom
// collision rects (world/structures) — the buildings twin of a PropKind owning
// its own mesh. Adding an open kind is: a value here + a spec in world/structures
// + a model file + one line in the buildingModels registry.
export type BuildingStructureModel = 'box' | 'parkingGarage' | 'gasStation' | 'usedCarLot' | 'driveIn';

export type BuildingKindDefinition = {
  kind: BuildingKind;
  label: string;
  structureModel: BuildingStructureModel;
  // Footprint in tiles (1 tile = 1 meter) when a placement does not override it.
  defaultWidthTiles: number;
  defaultDepthTiles: number;
  // Storeys → wall height. A storey is HMSC_SCALE.storyHeightMeters (3m). For open
  // structures this is the deck-count proxy: each storey is one parking deck / the
  // canopy clearance, read by the structure spec in world/structures.ts.
  storeys: number;
  // The gameplay tile bundle the building's solid mass borrows for cover, line
  // of sight, noise, and surface friction — always 'wall' (full cover, blocks
  // sight, walk-speed 0). This is how a building "gets all the property ideas of
  // a tile" without a parallel schema, exactly like propKinds.ts borrows a tile.
  wallTileKind: TileKind;
  // The default entry behavior for this kind. A placement may override it.
  // 'sealed' = solid, no entry; 'hollow' = walk-in shell sharing the outer world;
  // 'interior' = the door is a portal into a separate, larger interior space.
  defaultEnclosure: BuildingEnclosure;
  // The facade skin a placement gets when it doesn't pick one. Appearance is a
  // separate axis from kind, but each kind suggests a fitting look.
  defaultSkin: BuildingSkin;
  // Flat-shaded fallback wall color — shown behind/around the facade panels and
  // on 'plain'-skinned buildings. Definition files are the one place raw colors
  // live in this cart (the same convention tileKinds.ts/propKinds.ts follow).
  facadeColor: string;
};

const STOREY = HMSC_SCALE.storyHeightMeters;

export const BUILDING_KIND_DEFINITIONS: Record<BuildingKind, BuildingKindDefinition> = {
  house: {
    kind: 'house',
    label: 'House',
    structureModel: 'box',
    defaultWidthTiles: HMSC_SCALE.smallHouse.widthMeters,
    defaultDepthTiles: HMSC_SCALE.smallHouse.depthMeters,
    storeys: 2,
    wallTileKind: 'wall',
    defaultEnclosure: 'sealed',
    defaultSkin: 'residential',
    facadeColor: '#b9a07a',
  },
  shop: {
    kind: 'shop',
    label: 'Shop',
    structureModel: 'box',
    defaultWidthTiles: HMSC_SCALE.shopInterior.widthMeters,
    defaultDepthTiles: HMSC_SCALE.shopInterior.depthMeters,
    storeys: 1,
    wallTileKind: 'wall',
    defaultEnclosure: 'hollow',
    defaultSkin: 'retail',
    facadeColor: '#8aa6b0',
  },
  tower: {
    kind: 'tower',
    label: 'Tower',
    structureModel: 'box',
    defaultWidthTiles: 12,
    defaultDepthTiles: 12,
    storeys: 6,
    wallTileKind: 'wall',
    defaultEnclosure: 'interior',
    defaultSkin: 'office',
    facadeColor: '#7d8794',
  },
  warehouse: {
    kind: 'warehouse',
    label: 'Warehouse',
    structureModel: 'box',
    // Wide and a few storeys tall so the roller door reads as a real garage.
    defaultWidthTiles: 14,
    defaultDepthTiles: 18,
    storeys: 3,
    wallTileKind: 'wall',
    defaultEnclosure: 'sealed',
    defaultSkin: 'industrial',
    facadeColor: '#8a9097',
  },
  // ── Open structures (custom model + custom collision) ───────────────────────
  parkingGarage: {
    kind: 'parkingGarage',
    label: 'Parking Garage',
    structureModel: 'parkingGarage',
    // A city block of open-deck parking: wide and deep, a few decks tall. storeys
    // is the deck count (ground + uppers). Concrete pillars are the solid mass;
    // the open sides show the parked cars on every level.
    defaultWidthTiles: 24,
    defaultDepthTiles: 30,
    storeys: 3,
    wallTileKind: 'wall',
    defaultEnclosure: 'hollow',
    defaultSkin: 'plain',
    facadeColor: '#9a9ea3',
  },
  gasStation: {
    kind: 'gasStation',
    label: 'Gas Station',
    structureModel: 'gasStation',
    // A forecourt: a flat canopy on slim pillars over two fuel-pump islands, with
    // a small convenience store box at the back. storeys sets the canopy height.
    defaultWidthTiles: 20,
    defaultDepthTiles: 16,
    storeys: 2,
    wallTileKind: 'wall',
    defaultEnclosure: 'hollow',
    defaultSkin: 'plain',
    facadeColor: '#d8dde2',
  },
  driveIn: {
    kind: 'driveIn',
    label: 'Drive-In Theatre',
    structureModel: 'driveIn',
    // A big open asphalt lot with one huge screen wall at the back and a small
    // projector booth out in the lot. Wide + deep so cars/players have room to
    // face the screen. storeys is unused by the spec (the screen height is fixed
    // in world/structures); the lot surface is bare ground.
    defaultWidthTiles: 56,
    defaultDepthTiles: 46,
    storeys: 1,
    wallTileKind: 'wall',
    defaultEnclosure: 'hollow',
    defaultSkin: 'plain',
    facadeColor: '#1b2027',
  },
  usedCarLot: {
    kind: 'usedCarLot',
    label: 'Used Car Lot',
    structureModel: 'usedCarLot',
    // An open sales lot: rows of cars under a pennant string, a small glass sales
    // kiosk in one corner, and a tall price-banner sign. storeys sets the sign
    // height. The lot surface is the bare ground; only the kiosk + sign are solid.
    defaultWidthTiles: 26,
    defaultDepthTiles: 18,
    storeys: 1,
    wallTileKind: 'wall',
    defaultEnclosure: 'hollow',
    defaultSkin: 'plain',
    facadeColor: '#b7bcc2',
  },
};

// The facade skin a building shows when its placement doesn't pick one.
export function buildingDefaultSkin(kind: BuildingKind): BuildingSkin {
  return BUILDING_KIND_DEFINITIONS[kind].defaultSkin;
}

export const BUILDING_KINDS = Object.keys(BUILDING_KIND_DEFINITIONS) as BuildingKind[];

export function isBuildingKind(value: string): value is BuildingKind {
  return Object.prototype.hasOwnProperty.call(BUILDING_KIND_DEFINITIONS, value);
}

export function buildingKindDefinition(kind: BuildingKind): BuildingKindDefinition {
  return BUILDING_KIND_DEFINITIONS[kind];
}

export function buildingKindHeightMeters(kind: BuildingKind): number {
  return BUILDING_KIND_DEFINITIONS[kind].storeys * STOREY;
}

export function buildingKindStructureModel(kind: BuildingKind): BuildingStructureModel {
  return BUILDING_KIND_DEFINITIONS[kind].structureModel;
}

// An open structure draws its own model and owns its own collision rects, instead
// of the box-wall + facade pipeline. The single predicate every box-vs-open branch
// reads (renderer dispatch, physics rects, camera occlusion, facade panels).
export function isOpenBuildingKind(kind: BuildingKind): boolean {
  return BUILDING_KIND_DEFINITIONS[kind].structureModel !== 'box';
}

export function buildingKindNamesForConsole(): string {
  return BUILDING_KINDS.join(', ');
}
