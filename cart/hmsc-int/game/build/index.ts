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
  validateCatalogEntry,
  validateCatalog,
  catalogIdsForConsole,
} from './catalog';
export type { BuildMaterial, BuildPieceDef, BuildPieceSize, BuildTheme } from './catalog';

export {
  BUILD_PREFAB_DEFINITIONS,
  BUILD_PREFAB_IDS,
  isPrefabId,
  prefabDefinition,
  decomposePrefab,
  validatePrefab,
  validatePrefabs,
  prefabIdsForConsole,
} from './prefabs';
export type { BuildPrefabDef, DecomposedPiece, PrefabPiece } from './prefabs';

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
  placedPieceTags,
  placedPieceAcceptsEdits,
  placedPieceBands,
  placedPieceDepthSpan,
  placedPieceWallEnds,
  pieceBounds,
  connectedPieceIds,
  raycastPieces,
  placedPieceCameraOccluders,
  placedPieceColliders,
  placedPieceRamps,
  stampPrefabPieces,
  mintPrefabId,
  prefabFromPieces,
  validatePlacement,
  liftBuildingsToTerrain,
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
  validateCatalog,
} from './catalog';
import {
  BUILD_PREFAB_DEFINITIONS,
  BUILD_PREFAB_IDS,
  isPrefabId,
  prefabDefinition,
  decomposePrefab,
  validatePrefabs,
} from './prefabs';
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
  placedPieceTags,
  placedPieceAcceptsEdits,
  placedPieceBands,
  placedPieceDepthSpan,
  placedPieceWallEnds,
  pieceBounds,
  connectedPieceIds,
  raycastPieces,
  placedPieceCameraOccluders,
  placedPieceColliders,
  placedPieceRamps,
  stampPrefabPieces,
  mintPrefabId,
  prefabFromPieces,
  validatePlacement,
  liftBuildingsToTerrain,
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
    decompose: decomposePrefab,
    validate: validatePrefabs,
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
    tags: placedPieceTags,
    acceptsEdits: placedPieceAcceptsEdits,
    bands: placedPieceBands,
    depthSpan: placedPieceDepthSpan,
    /** CORNERSEAM-0610: per-end corner joins (renderer slab-miter input) */
    wallEnds: placedPieceWallEnds,
    bounds: pieceBounds,
    /** SMARTSEL-0605: the connected shape under one click */
    connected: connectedPieceIds,
    raycast: raycastPieces,
    cameraOccluders: placedPieceCameraOccluders,
    colliders: placedPieceColliders,
    ramps: placedPieceRamps,
    stamp: stampPrefabPieces,
    mintPrefabId,
    prefabFromPieces,
    validatePlacement,
    /** flat-pad terrain lift (req_0444): a stamped building rides the terrain under
     *  its footprint as one level pad — pure/idempotent, applied at render+collide+compile */
    liftToTerrain: liftBuildingsToTerrain,
  },
} as const;
