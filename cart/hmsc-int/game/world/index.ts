// game/world/ — GAME_WORLD: the world grid state (V4: "the tile system IS the
// system" — the implied substrate of the constitution, gap W-1).
//
// What the authored map lowers to and what every other system stands on. THE
// ONE DOOR (P3) over:
//
//   grid.ts      the world-grid state (surface regions, placed cells,
//                landform instances), cell math (R4: 1 tile = 1 m), pure
//                mutators + kind resolvers
//   heights.ts   ground-height + footing semantics: walkable ground vs raw
//                landform tops, the mesh-sink contract, slope-gated terrain
//   colliders.ts the world→physics adapter — CollisionRect[]/Heightfield[]
//                derivation feeding GAME_PHYSICS (V1: ONE host physics
//                system; this door derives data, never simulates)
//   spawn.ts     gameplay markers (spawn/save), trigger cells, respawn —
//                pure steps with inert returns
//   authored.ts  the user's authored map, loaded as DATA from the editor's
//                compile channel ('hmsc'/'game-state')
//   stream.ts    the V20 'world' concern — grid edits as events, the grid
//                snapshot the game loads
//
// STRUCTURE note: GAME_WORLD is not in the 19-door game/index.ts list — the
// door list is RULED (V17 cites STRUCTURE), so whether this export joins it
// is a supervisor/user call, surfaced rather than taken. Inside game/ the
// other systems import from THIS barrel; nothing reaches behind it.

import {
  addSurfaceRegion,
  canPathThroughCell,
  cellCenterToWorld,
  cellKey,
  createWorldGridState,
  placeCell,
  placedCellAt,
  placedCellAtWorldPosition,
  placeLandform,
  removeCell,
  removeLandform,
  setCellTrigger,
  surfaceRegionAtCell,
  tileKindAtCell,
  WORLD_TUNING,
  worldToCell,
} from './grid';
import {
  footingKindAtWorldPosition,
  groundTopAtWorldPosition,
  landformFootingKindAt,
  landformGroundTopAt,
  landformWalkableTopAt,
  landformWaterKindAt,
  placedCellTopMeters,
  surfaceRegionTopMeters,
} from './heights';
import {
  bakeLandformHeightfield,
  registerWorldHeightfields,
  WORLD_HEIGHTFIELD_SLOTS,
  worldCollisionRects,
  worldHeightfields,
} from './colliders';
import {
  defaultSpawnCell,
  enteredSaveStep,
  enteredTriggerStep,
  placeMarker,
  respawnPoint,
  triggerCellAtWorldPosition,
} from './spawn';
import { authoredWorldFromRecord, AUTHORED_WORLD_STORE, loadAuthoredWorld, readAuthoredWorldRaw } from './authored';
import { legacyGlobalPieces, pieceMutationMapName, piecesForMap, worldStream } from './stream';
import { bakeNavGrid, navKindAt } from './navGrid';
import { NAV_PROFILES, publishNavGrid } from './navPublish';

export {
  addSurfaceRegion,
  canPathThroughCell,
  cellCenterToWorld,
  cellKey,
  createWorldGridState,
  placeCell,
  placedCellAt,
  placedCellAtWorldPosition,
  placeLandform,
  removeCell,
  removeLandform,
  setCellTrigger,
  surfaceRegionAtCell,
  tileKindAtCell,
  WORLD_TUNING,
  worldToCell,
} from './grid';
export type {
  GridCell,
  LandformPlacement,
  PlaceCellOptions,
  PlacedCell,
  WorldGridState,
  WorldSurfaceRegion,
} from './grid';
export {
  footingKindAtWorldPosition,
  groundTopAtWorldPosition,
  landformFootingKindAt,
  landformGroundTopAt,
  landformWalkableTopAt,
  landformWaterKindAt,
  placedCellTopMeters,
  surfaceRegionTopMeters,
} from './heights';
export {
  bakeLandformHeightfield,
  registerWorldHeightfields,
  WORLD_HEIGHTFIELD_SLOTS,
  worldCollisionRects,
  worldHeightfields,
} from './colliders';
export type { WorldCollisionRects, WorldHeightfields } from './colliders';
export {
  defaultSpawnCell,
  enteredSaveStep,
  enteredTriggerStep,
  placeMarker,
  respawnPoint,
  triggerCellAtWorldPosition,
} from './spawn';
export type { RespawnPoint, SaveStepResult, TriggerStepResult } from './spawn';
export { authoredWorldFromRecord, AUTHORED_WORLD_STORE, loadAuthoredWorld, readAuthoredWorldRaw } from './authored';
export type { AuthoredWorld } from './authored';
export { legacyGlobalPieces, pieceMutationMapName, piecesForMap, worldStream } from './stream';
export type { PiecePlacement, WorldEvent, WorldStreamState } from './stream';
// The nav bake (MICROGRID-0610): painted ground + floor micro-cells + piece
// colliders → the publishGrid-ready kind grid. The first producer for
// GAME_PATHING.publishGrid.
export { bakeNavGrid, navKindAt, NAV_TUNING } from './navGrid';
export type { NavGrid } from './navGrid';
// The LIVE publish (NAVLIVE-0610): active map → bakeNavGrid → host A*, with
// flows/classes/profiles derived from the kind registry. Windows around the
// anchor when the map exceeds the host grid cap (reported, never silent).
export {
  clipPaintedGrid,
  navClassTable,
  navFlowTable,
  navProfileCosts,
  NAV_PROFILES,
  paintedGridFromLandforms,
  PATHING_GRID_LIMITS,
  publishNavGrid,
} from './navPublish';
export type { NavPublishResult, PaintedGrid } from './navPublish';
// buildings own their history (req_0512/req_0513): defs + instance references
// on their own V20 stream; derived back into the one pieces view.
export {
  buildingDefFromPieces,
  buildingMutationMapName,
  buildingPieceInstanceId,
  buildingPieceLocalIndex,
  buildingPiecesForMap,
  buildingsStream,
  instancesForMap,
  isBuildingsEvent,
  mintBuildingDefId,
  partitionBuildingSelection,
  reconcileBuildingInstances,
  withBuildingPieces,
} from './buildings';
export type {
  BuildEditEvent,
  BuildingCapture,
  BuildingInstance,
  BuildingSelectionPartition,
  BuildingsEvent,
  BuildingsStreamState,
} from './buildings';

// The V14/V17 ground-floor handle. One object, the whole substrate.
export const GAME_WORLD = Object.freeze({
  tuning: WORLD_TUNING,
  // state + cell math
  createState: createWorldGridState,
  cellKey,
  worldToCell,
  cellCenterToWorld,
  // mutators
  placeCell,
  removeCell,
  addSurfaceRegion,
  setCellTrigger,
  placeLandform,
  removeLandform,
  placeMarker,
  // resolvers
  placedCellAt,
  placedCellAtWorldPosition,
  surfaceRegionAtCell,
  tileKindAtCell,
  canPathThroughCell,
  triggerCellAtWorldPosition,
  // heights + footing
  placedCellTopMeters,
  surfaceRegionTopMeters,
  groundTopAtWorldPosition,
  footingKindAtWorldPosition,
  landformGroundTopAt,
  landformWalkableTopAt,
  landformFootingKindAt,
  landformWaterKindAt,
  // the nav bake (world → host path grid; pair with GAME_PATHING.publishGrid)
  bakeNavGrid,
  navKindAt,
  // the live publish (active map → host A*; NAV_PROFILES.walker/vehicle)
  publishNavGrid,
  navProfiles: NAV_PROFILES,
  // physics adapter
  collisionRects: worldCollisionRects,
  heightfields: worldHeightfields,
  bakeLandformHeightfield,
  registerHeightfields: registerWorldHeightfields,
  heightfieldSlots: WORLD_HEIGHTFIELD_SLOTS,
  // spawn / respawn / triggers
  defaultSpawnCell,
  respawnPoint,
  enteredTriggerStep,
  enteredSaveStep,
  // the authored map
  loadAuthoredWorld,
  authoredWorldFromRecord,
  readAuthoredWorldRaw,
  authoredStore: AUTHORED_WORLD_STORE,
  // V20
  stream: worldStream,
} as const);
