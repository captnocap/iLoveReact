// game/build — THE DOOR (P3). The V24 building piece grammar's data layer:
// "Author by semantic piece. Bake by gameplay contract. Skin by catalog."
//
// Three data families under one model (ONE MODEL, TWO VIEWS — every authoring
// mode edits the same semantic data, never separate representations):
//   pieces   — the BuildPieceKind taxonomy + per-kind bake contracts
//   edits    — the meaningful-cutout vocabulary (WallEdit) + tag application
//   catalog  — BuildPieceDef rows: where variety lives (P2 tables)
//   prefabs  — named compositions that DECOMPOSE to semantic pieces
//   markers  — the WorldMarker semantic overlays (addendum 3)
//
// The bake contract is DECLARED here (BakePromise; what a piece promises) —
// emission lands with the compile/world integration, not in this module.

export {
  BUILD_KIND_CONTRACTS,
  BUILD_PIECE_KINDS,
  isBuildPieceKind,
  buildKindContract,
  buildKindNamesForConsole,
} from './pieces';
export type {
  BakePromise,
  BuildEditFamily,
  BuildGameplayTags,
  BuildKindContract,
  BuildPieceKind,
  BuildSnapMode,
} from './pieces';

export {
  WALL_EDIT_DEFINITIONS,
  WALL_EDITS,
  isWallEdit,
  wallEditDefinition,
  applyWallEdit,
  wallEditNamesForConsole,
} from './edits';
export type { EditPortalKind, WallEdit, WallEditDefinition } from './edits';

export {
  BUILD_CATALOG,
  BUILD_CATALOG_IDS,
  isCatalogId,
  catalogEntry,
  effectiveTags,
  catalogEntriesByKind,
  catalogEntriesByTheme,
  catalogPieceFamily,
  cookedCatalogPickEntries,
  validateCatalogEntry,
  validateCatalog,
  catalogIdsForConsole,
  ROOF_PITCH,
} from './catalog';
export type { BuildMaterial, BuildPieceDef, BuildPieceSize, BuildTheme, RoofShape } from './catalog';

export {
  BUILD_PREFAB_DEFINITIONS,
  BUILD_PREFAB_IDS,
  isPrefabId,
  prefabDefinition,
  prefabGridAnchor,
  decomposePrefab,
  validatePrefab,
  validatePrefabs,
  prefabIdsForConsole,
} from './prefabs';
export type { BuildPrefabDef, DecomposedPiece, PrefabPiece } from './prefabs';

// REQ-0647: the elevator — a vertical-link PIECE (never a prefab; USER ruled).
// Stacked storeys derive a shaft; the car is LIVE collision — the play route
// rides it, and the compiled loader rides it through the ELEVATORS lump
// (compile/worldElevators.ts, REQ-0652).
export {
  elevatorShafts,
  elevatorCarRect,
  elevatorCarBox,
  elevatorCarTop,
  updateElevatorCarRect,
  nextElevatorStop,
  nearestElevatorStop,
} from './elevators';
export type { ElevatorShaft } from './elevators';

// BUILDSKIN-0606: the building face-skin vocabulary (per-type globals,
// per-piece overrides, 2 majors + the one side group; resolution order).
export {
  BUILD_FACE_SLOTS,
  STRUCTURAL_SKIN_KINDS,
  faceSlotLabels,
  skinKindOrder,
  resolveFaceSkin,
  skinAllSlots,
  skinSetProblems,
  describeFaceSkin,
} from './skins';
export type { BuildFaceSlot, BuildFaceSkin, BuildSkinSet, BuildTypeSkins, ResolvedFaceSkin } from './skins';

export {
  PLACED_TUNING,
  placedPieceDef,
  placedPieceSize,
  placedRoofProfile,
  roofRiseMeters,
  placedPieceTags,
  placedPieceAcceptsEdits,
  placedPieceBands,
  placedPieceDepthSpan,
  placedPieceWallEnds,
  pieceBounds,
  pieceVisualBounds,
  liftedWallBaseY,
  liftWallsOntoFloors,
  connectedPieceIds,
  raycastPieces,
  placedPieceCameraOccluders,
  placedPieceColliders,
  placedPieceRamps,
  stampPrefabPieces,
  mintPrefabId,
  prefabFromPieces,
  placementFor,
  validatePlacement,
  liftBuildingsToTerrain,
  liftPropsToTerrain,
} from './placed';
export type {
  PieceBounds,
  PieceHit,
  PieceRay,
  PlacedBuildPiece,
  PlacedPieceCameraOccluders,
  PlacedPieceColliders,
  WallEndJoin,
  WallEnds,
} from './placed';

// MICROGRID-0610: the floor 3×3 micro-grid — the editor's cell painter and
// the nav bake both speak this surface.
export {
  carriesMicroGrid,
  FLOOR_CELL_COUNT,
  FLOOR_DEFAULT_CELL_KIND,
  FLOOR_GRID,
  floorCellRects,
  resolveFloorCells,
  setFloorCell,
} from './microGrid';
export type { FloorCell, FloorCellRect } from './microGrid';

export {
  WORLD_MARKER_TYPES,
  ROOM_ROLES,
  INTEREST_POINT_ROLES,
  isWorldMarkerType,
  validateMarker,
  validateMarkers,
  markersOfType,
  markerTypeNamesForConsole,
} from './markers';
export type {
  CameraMarker,
  InterestPointMarker,
  InterestPointRole,
  MarkerBounds,
  MarkerPos,
  PathNodeMarker,
  PortalMarker,
  RoomMarker,
  RoomRole,
  TriggerMarker,
  WorldMarker,
  WorldMarkerType,
} from './markers';

import {
  BUILD_KIND_CONTRACTS,
  BUILD_PIECE_KINDS,
  isBuildPieceKind,
  buildKindContract,
} from './pieces';
import { WALL_EDIT_DEFINITIONS, WALL_EDITS, isWallEdit, applyWallEdit } from './edits';
import {
  BUILD_CATALOG,
  BUILD_CATALOG_IDS,
  isCatalogId,
  catalogEntry,
  effectiveTags,
  catalogEntriesByKind,
  catalogEntriesByTheme,
  catalogPieceFamily,
  validateCatalog,
} from './catalog';
import {
  BUILD_PREFAB_DEFINITIONS,
  BUILD_PREFAB_IDS,
  isPrefabId,
  prefabDefinition,
  prefabGridAnchor,
  decomposePrefab,
  validatePrefabs,
} from './prefabs';
import {
  elevatorShafts,
  elevatorCarRect,
  elevatorCarBox,
  elevatorCarTop,
  updateElevatorCarRect,
  nextElevatorStop,
  nearestElevatorStop,
} from './elevators';
import {
  BUILD_FACE_SLOTS,
  STRUCTURAL_SKIN_KINDS,
  faceSlotLabels,
  skinKindOrder,
  resolveFaceSkin,
  skinAllSlots,
  skinSetProblems,
  describeFaceSkin,
} from './skins';
import {
  WORLD_MARKER_TYPES,
  ROOM_ROLES,
  INTEREST_POINT_ROLES,
  isWorldMarkerType,
  validateMarker,
  validateMarkers,
  markersOfType,
} from './markers';
import {
  PLACED_TUNING,
  placedPieceDef,
  placedPieceSize,
  placedRoofProfile,
  roofRiseMeters,
  placedPieceTags,
  placedPieceAcceptsEdits,
  placedPieceBands,
  placedPieceDepthSpan,
  placedPieceWallEnds,
  pieceBounds,
  pieceVisualBounds,
  liftedWallBaseY,
  liftWallsOntoFloors,
  connectedPieceIds,
  raycastPieces,
  placedPieceCameraOccluders,
  placedPieceColliders,
  placedPieceRamps,
  stampPrefabPieces,
  mintPrefabId,
  prefabFromPieces,
  placementFor,
  validatePlacement,
  liftBuildingsToTerrain,
  liftPropsToTerrain,
} from './placed';

// The V14/V17 ground-floor handle: `import { GAME_BUILD } from '@game'`.
export const GAME_BUILD = {
  kinds: {
    contracts: BUILD_KIND_CONTRACTS,
    kinds: BUILD_PIECE_KINDS,
    is: isBuildPieceKind,
    get: buildKindContract,
  },
  edits: {
    wall: WALL_EDIT_DEFINITIONS,
    wallEdits: WALL_EDITS,
    is: isWallEdit,
    apply: applyWallEdit,
  },
  catalog: {
    entries: BUILD_CATALOG,
    ids: BUILD_CATALOG_IDS,
    is: isCatalogId,
    get: catalogEntry,
    family: catalogPieceFamily,
    effectiveTags,
    byKind: catalogEntriesByKind,
    byTheme: catalogEntriesByTheme,
    validate: validateCatalog,
  },
  prefabs: {
    definitions: BUILD_PREFAB_DEFINITIONS,
    ids: BUILD_PREFAB_IDS,
    is: isPrefabId,
    get: prefabDefinition,
    gridAnchor: prefabGridAnchor,
    decompose: decomposePrefab,
    validate: validatePrefabs,
  },
  // REQ-0647: the elevator's pure layer — shafts from stacked storey pieces,
  // the car's rect/box at any height, stop arithmetic. The play route rides
  // the live rect; the compiled loader rides the same shafts through the
  // ELEVATORS lump (REQ-0652).
  elevators: {
    shafts: elevatorShafts,
    carRect: elevatorCarRect,
    carBox: elevatorCarBox,
    carTop: elevatorCarTop,
    updateCarRect: updateElevatorCarRect,
    nextStop: nextElevatorStop,
    nearestStop: nearestElevatorStop,
  },
  // BUILDSKIN-0606: the face-skin vocabulary — the skin IS the material
  // system (a skin = the mesh's base color or a registry textureKey).
  skins: {
    slots: BUILD_FACE_SLOTS,
    structuralKinds: STRUCTURAL_SKIN_KINDS,
    slotLabels: faceSlotLabels,
    kindOrder: skinKindOrder,
    resolve: resolveFaceSkin,
    all: skinAllSlots,
    problems: skinSetProblems,
    describe: describeFaceSkin,
  },
  markers: {
    types: WORLD_MARKER_TYPES,
    roomRoles: ROOM_ROLES,
    interestPointRoles: INTEREST_POINT_ROLES,
    isType: isWorldMarkerType,
    validate: validateMarker,
    validateSet: validateMarkers,
    ofType: markersOfType,
  },
  // The V24 grammar PLACED in the world (the Creative Build route's lane):
  // pure semantics over the world stream's placed-piece records — the stream
  // (GAME_WORLD.stream) stays the one source of truth for what stands.
  placed: {
    tuning: PLACED_TUNING,
    def: placedPieceDef,
    /** effective plan size: catalog `size` with a roof's dragged footprint
     *  (ROOFSPAN) substituted (req_0917) */
    size: placedPieceSize,
    /** a pitched roof's resolved {shape, pitch}; flat for non-roof rows */
    roofProfile: placedRoofProfile,
    /** ridge/apex rise of a placed roof above its eave, scaled to the span */
    roofRise: roofRiseMeters,
    tags: placedPieceTags,
    acceptsEdits: placedPieceAcceptsEdits,
    bands: placedPieceBands,
    depthSpan: placedPieceDepthSpan,
    /** CORNERSEAM-0610: per-end corner joins (renderer slab-miter input) */
    wallEnds: placedPieceWallEnds,
    bounds: pieceBounds,
    /** req_1902: VISUAL envelope for selection — a prop exported off the ground is
     *  lifted to its real mesh band, not anchored to a ground-level box. */
    visualBounds: pieceVisualBounds,
    /** WALLTOP (req_0099/1477): the Y a wall RESTS at — on the floor at its cell
     *  (read-time projection; geometry/collision use it, stored data stays raw) */
    liftedWallBaseY,
    /** the piece list with every wall lifted onto the floor beneath it */
    liftWallsOntoFloors,
    /** SMARTSEL-0605: the connected shape under one click */
    connected: connectedPieceIds,
    raycast: raycastPieces,
    cameraOccluders: placedPieceCameraOccluders,
    colliders: placedPieceColliders,
    ramps: placedPieceRamps,
    stamp: stampPrefabPieces,
    mintPrefabId,
    prefabFromPieces,
    /** REQ-0647: the authored placement for a catalog row — wall types with a
     *  defaultEdit (Doorway Wall, Window Wall) carry their cut on it */
    placementFor,
    validatePlacement,
    /** flat-pad terrain lift (req_0444): a stamped building rides the terrain under
     *  its footprint as one level pad — pure/idempotent, applied at render+collide+compile */
    liftToTerrain: liftBuildingsToTerrain,
    /** prop terrain lift: free-standing props rest on the live heightfield at their anchor */
    liftPropsToTerrain,
  },
} as const;
