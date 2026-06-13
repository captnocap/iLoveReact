# Capture note — game/kinds/ (WO-2, 2026-06-04)

First system capture under V17-TRIAGE: the kind registries REWRITTEN fresh into
`cart/hmsc-int/game/kinds/`. The old files are untouched behavior references
(V15-TRANSITION: `cart/hmsc` is an extraction surface).

## Sources (read, never moved/copied/imported)

| family | old file(s) | what it contained |
|---|---|---|
| tiles | `cart/hmsc/world/tileKinds.ts` + `tileTextureKeys.ts` | 18 tile kinds × {placement, pathing, npc, cover, door, visibility, traversal, surface, render, altitude}; the locked road grammar kinds (4 lanes / junction / crosswalk); paintable/embedded/gameplay palettes; texture keys in a sibling module |
| props | `cart/hmsc/world/propKinds.ts` | 16 prop kinds × {solid, footprintRadiusMeters, heightMeters, tileKind borrow, trafficControl} |
| NPCs | `cart/hmsc/npc/kinds.ts` + `cart/hmsc/npc/factions.ts` | 4 NPC kinds × {health, speeds, defaultFaction, canFight, weaponDamage, Hitman perception profile}; the 3×4 faction regard matrix |
| roles | `cart/hmsc/npc/roles.ts` | 6 open-registry roles × {markerColor, hostileOnSight, objective, interactions}, unknown-id fallback to `none` |
| landforms | `cart/hmsc/world/landforms/kinds.ts` + the kind-def slice of `registry.ts` | 4 kinds (hills/mountain/estate/heightfield): height formulas, walk-slope limits, spiral carve, crater lake/trailhead/road-centerline helpers, register/lookup |

## Verification

Each family shipped with P4 behavior tests (run under `tools/v8cli` via the
shared `game/_testkit.ts`): tiles 19, props 8, npcs 11, roles 8, landforms 15 —
all green. Each family was ALSO deep-compared against the old module in a
one-off v8cli run: tiles 18 kinds field-identical on every carried field; props
16 identical; NPCs 4 kinds + full regard matrix identical; roles 6 identical;
landforms behaviorally identical over 4,356 surface samples + all pure helpers
(rise/footing/submerged/walkCos/footprint/resolution/lake/trailhead/centerline).

## Deliberately NOT carried (dead fields — cf. oracle "dead fields", the
## voxel `solid:false` hazard: scaffolding for mechanics that don't exist)

- **Tile door sub-fields** `defaultState`, `interaction`, `widthMeters`,
  `blocksMovementWhenClosed`, `blocksLineOfSightWhenClosed`, `vehiclePassable`:
  zero consumers anywhere (not even the editor inspector displays them; grep
  across hmsc, hmsc-int, combat_lab, pathing_lab). Only `isDoor` + `openCost`
  are read (world/pathing.ts:38, pathing_lab:476). A real door system (scape
  has one to converge with) re-grows its profile from its own requirements.
- **`visibility.blocksLineOfSight`**: exact duplicate of
  `pathing.blocksLineOfSight` (values agree on all 18 kinds); its only reader
  was the inspector's read-only row. The carried one is `pathing.…` — the path
  serialized in tileOverrides maps.
- **`npc.cover` (`'none'|'low'|'high'`)**: coarse duplicate of `cover.height`;
  only reader was an inspector text row. Consumers derive from the cover
  profile.
- **GameState-coupled landform code** (`landformTopAtWorldPosition`,
  `landformTileKindAtWorldPosition`, `landformWaterKindAtWorldPosition`,
  `landformGroundTopAt`, `nearestLandformCameraHit`, `placeLandform`,
  `removeLandform`, `landformHeightfield`/`landformColliderData` baking):
  world-state queries and terrain baking, not kind→meaning tables — they
  belong to the world/physics captures, not kinds/.
- **`tileTextureKeys.ts` as a separate module**: folded into the tile table
  (`render.textureKey`), same key strings (road-family kinds still share
  `hmsc.tile.road`).

## Changed shape (same behavior, constitution's bar)

- **Lane flow is table DATA (P2)**: the old registry carried direction in the
  kind NAME ("the NAME is the data") and every consumer hand-built its own
  kind→flow table (pathing_lab:683-687). Fresh: `flow: TileFlow` on each
  definition + `TILE_FLOW_VECTORS` + `tileFlowVector()`; host pathing's
  `setPathFlows` table derives from the registry.
- **`TILE_KIND_INDEX`** exported (consumers hand-rolled `KIND_INDEX`). The
  TILE_KINDS key order is LOCKED (host pathing ships kind indices); documented
  and tested.
- **`LANDFORM_TUNING` (P2)**: every fixed-shape number lifted out of the
  formulas into a data table — crater rim/floor/depth, trail turns/half-width,
  water depth, walk-slope degrees, hills bump distribution fractions, estate
  road turns/centerline sampling/ribbon lift, mesh resolutions.
- **Estate `roadHalfWidthMeters: 3.5` is a tuning VALUE**, not a call into the
  roads system: the old code computed it via
  `solveRoadCrossSection({lanesPerDirection:1, no bike, no sidewalks})` → 7m
  total / 2. The minimum road profile itself is kept as data
  (`LANDFORM_TUNING.estate.roadProfile`); the cross-section solver stays with
  the roads system (its own capture).
- **Faction regard matrix lives in the NPC family** (`npcs.ts`): WO-2 lists
  "NPCs" as one family and `NpcKindDefinition.defaultFaction` is a dangling
  string without the matrix that gives factions meaning. Scope call, surfaced
  below.
- Tests converged on the shared `game/_testkit.ts` harness (the kinds-local
  testKit was deleted the same session it was written — no duplication).

## Ambiguities surfaced (NOT guessed)

1. **Factions in scope?** WO-2 names "tiles, props, NPCs, roles, landforms";
   `factions.ts` is the fourth axis the NPC table references. Captured WITH
   the NPC family (above). If the supervisor wants factions as their own
   family or elsewhere, it is one extraction from `npcs.ts`.
2. **Spec-only profile fields carried**: `traversal.{maxStepUpMeters,
   minClearanceMeters, slopeLimitDegrees, requiresCrouch, requiresMantle,
   vehicleGripMultiplier}`, `cover.{shootOver, leanAround, crouchRequired}`,
   and `visibility.{opacity, concealment, lightTransmission, soundOcclusion}`
   have NO game-runtime consumer today — only the editor inspector/override
   surface reads them. They were CARRIED (unlike the door sub-fields) because
   they are part of the authored tuning surface (P2) and several sit in the
   tileOverrides serialized-override schema — but they are declared spec
   awaiting their systems (perception V12, physics V1), not live behavior.
3. **Old serialized tile overrides**: maps saved by the current editor carry
   dotted paths into the OLD schema. All paths in the override schema
   (`tileOverrides.ts OVERRIDABLE`) survive in the fresh shape; only the three
   dropped fields above could dangle, and none of them is in OVERRIDABLE. Not
   verified against actual saved workspaces.
4. **Legacy `road`/`asphalt` are flow-less drivable kinds.** The locked
   grammar says every drivable ROAD tile must carry flow (flow-less shoulders
   are the wrong-way loophole); plain `road` survives for generic expanses and
   pre-grammar saves. Authoring discipline (the road tool paints trios) is the
   editor's job — the registry cannot enforce where a kind is painted.
5. **`junction.npc.walkCost` is 1.04** (old value, preserved): pedestrians
   mildly avoid the box vs road's 1.02 — but raw costs are unshaped (the
   road-grammar memory: behavioral shaping lives in per-profile multipliers,
   e.g. pathing_lab walks road-family at ~12 vs crosswalk 1). Carried verbatim.
6. **No 'grass' tile kind** — old comments rule `sand` as the soft-ground
   stand-in for landform footings. Preserved, not "fixed".

## PARKSPAWN-0612 (req_0694)

Two kinds appended LAST (indices stable): `parking` — paintable parking-lot
ground, asphalt that wears white 3m stall lines (drawn by the tile surface
shaders: HEIGHTFIELD_TILE_SHADER + its CPU mirror + PAINTER_VIEW_WGSL, all
keyed by the baked kind index); priced as a destination (vehicleCost 1.4,
never preferred) so A* parks there but never shortcuts through. And
`vehicleSpawn` — the gameplay marker where the traffic system may
materialize a vehicle; WHICH vehicle is `GAME_VEHICLE.pickSpawn`'s
spawnRate-weighted pick, WHERE is `GAME_WORLD.vehicleSpawnCells`.

req_0699 amendment: marker kinds NEVER paint the game's ground. The painter's
2D view keeps their swatch colour (authoring), but the game floor — the live
heightfield shader, the CPU bake mirror, and the compiled box-slab path — all
resolve a marker cell to the nearest non-marker ground around it
(`groundKindAt` / `hf_ground_kind`, ring search radius 4), so a vehicleSpawn
painted on a parking lot renders as parking, stall lines included. Flat floors
containing parking cells route through the textured heightfield bake
(`floorHasParkingCells`) — the slab path cannot draw fragment paint.

req_0710 amendment: parking comes in two orientations so a lot is not stuck to
one direction. `parkingCross` is identical lot ground to `parking` (same
gameplay profile) but its bay lines run across Z instead of X — the same way
the road grammar expresses direction as separate lane kinds. The stall paint +
line geometry live in ONE home (`render3d/parkingStall.ts`: PARKING_STALL_WGSL
+ parkingStallColor + the kind indices), shared by the game heightfield shader,
its CPU bake mirror, and the editor painter view, so the two kinds differ only
in which axis they feed `parking_stall`. Paint "Parking" or "Parking ⟂".
