# Capture note — game/world/ (W-1: the world grid state, 2026-06-04)

The LAST structural gap from the TestRoute inventory (TestRoute.REWIRE.md,
"Gap summary · W-1") REWRITTEN fresh per V17-TRIAGE: the V4 substrate — "the
tile system IS the system" — gets its captured home. The old files are
untouched behavior references (V15-TRANSITION: `cart/hmsc` is an extraction
surface). NOTE: GAME_WORLD is NOT exported from `game/index.ts` — the 19-door
list is RULED (V17 cites STRUCTURE); whether a 20th door joins it is surfaced
to the supervisor, not taken here. Inside `game/`, systems import `../world`.

## Sources (read, never moved/copied/imported)

| area | old file(s) | what it contained |
|---|---|---|
| grid state + mutators | `cart/hmsc/world/grid.ts` + the world slice of `cart/hmsc/design.ts` | GridCell/PlacedCell/WorldSurfaceRegion/Landform types; cell math; place/remove/fill/trigger mutators; kind/region resolvers |
| ground heights | `cart/hmsc/world/surfaceHeights.ts` + `grid.ts` `groundTopAtWorldPosition` + `landforms/registry.ts` queries | analytic tops (cell base + render height; region mesh-sink 0.01 m), walkable-gated ground, raw landform tops, slope gate (central-difference normal), footing/water resolution |
| world→collider adapter | the world-derivation half of `cart/hmsc/state/hostPhysics.ts` + `world/terrain.ts` bake + `state/terrainColliders.ts` loop | regions/cells → solid bands (blocksPlayer = ¬water ∧ ¬walkable, friction/restitution from the kind table); landforms → baked height grids (origin = center − halfWidth, cell = width/(cols−1)), slot-ordered registration, clear-then-register |
| spawn / save / triggers | `cart/hmsc/state/usePlayerDrive.ts` steps + `commands/registry.ts` `pv_respawn` + hmsc-int `editorWorld.placeMarker` / first-spawn-wins | save↔spawn pairing (never self), once-per-entry debounces, respawn = cell centre ground-snapped + velocity zeroed, world default spawn |
| authored-map channel | `cart/hmsc-int/editorWorld.ts` + `cart/hmsc/state/gameState.ts` store shims | the compile channel: localstore `'hmsc'/'game-state'` (`__localstoreGet`/`__store_get`), consumed as DATA |

The wire half of hostPhysics.ts already landed in `game/physics.ts` — this
capture produces THAT door's `CollisionRect[]`/`Heightfield[]` types verbatim,
so the seam is exact (V1: physics is ONE host system; the world door derives
data, never simulates). Landform kind MEANING (rise/walkCos/footprint) stays
in `game/kinds` — this door iterates instances and asks the registry (the
kinds capture note explicitly deferred the GameState-coupled queries here).

## Verification

- 21 P4 behavior tests (`world.test.ts`) + 2 new vocabulary tests; `rjit game
  verify` green: 1/1 oracle, 30/30 suites, 2/2 scripts.
- Fidelity deep-compare (one-off v8cli run, the kinds precedent): the same
  authored world built in both shapes, **251,550 comparisons, 0 mismatches** —
  `groundTopAtWorldPosition` (×4 step heights ×4 probe heights), footing,
  raw landform tops, and analytic tops, swept over the flat city + all four
  landform kinds (mountain/hills/estate/painted heightfield).
- The authored-map end-to-end: a persisted editor record loads through
  `loadAuthoredWorld`, spawn lands on the painted ground, and the collider
  derivation hands `GAME_PHYSICS.registerHeightfield` the authored heights
  verbatim (the figure stands on the map).

## Command stubs flipped (game/commands/vocabulary.ts)

`wv_place`, `wv_fill`, `wv_remove`, `wv_trigger`, `pv_respawn`, `wv_mountain`
now run for real over the captured state (reference messages/ids preserved;
`GameCommandState.world` gained the reference dot paths `surfaceRegions`/
`placedCells`/`landforms`, `player.respawnCell`). Still pending with their
owners: `wv_path` (grid × V5 host-pathing integration), `wv_road`/
`wv_intersection`/`wv_culdesac`, `wv_signal`, `wv_prop` placement,
`wv_building`/`wv_enter`/`wv_leave`, `wv_zone`, `wv_validate`.

## Deliberate differences from the references

- **`pv_respawn` falls back to the world default spawn** when nothing armed
  one. The reference failed unless `respawnCell` was set — but its boot path
  armed the default spawn at compile/boot; the command state has no boot
  step, so resolving `defaultSpawnCell` at respawn time is the same meaning
  in the captured shape. No marker anywhere still fails loud.
- **Scene gating stays caller-side.** The reference's `triggersActive`
  (boot.console / interiors) gates the drive loop, not the grid; the pure
  steps (`enteredTriggerStep`/`enteredSaveStep`) take no scene knowledge —
  interiors are an uncaptured lane.
- **Caps are reported, never silent.** hostPhysics truncated rects/slots
  silently; `worldCollisionRects`/`worldHeightfields` return `dropped`.
- **`wv_place` provenance is rebuilt** (`['wv_place', ...args].join(' ')`):
  the skeleton registry hands specs args, not the raw line.
- **P2 numbers named**: mesh sink 0.01 m, landform standing tolerance 0.6 m,
  normal probe 0.5 m (`WORLD_TUNING`); step height 0.35 m (R4 scale contract)
  and trailhead lift 0.05 m joined `COMMAND_TUNING`.

## Deliberately NOT carried

- **Roads/junctions/buildings/props/zones/interiors layers** — their own
  capture lanes (the `NOT_YET_CAPTURED` owners). The resolvers document the
  exact layer-order seams where each slots back in; the fidelity sweep ran
  with those layers empty in both shapes.
- **`nearestLandformCameraHit`** — camera-vs-terrain collision belongs to the
  camera/render side (W-2 adjacency), not the grid; listed as leftover.
- **`visibleCellsAround` / `placedCellsNearPlayer` / `chunkKeyForCell`** —
  render-windowing helpers (W-2: world rendering), not grid semantics.
- **`canOccupyWorldPosition`** — its building-blocker half is the buildings
  lane; capturing the walkability half alone would silently change meaning.
  `canPathThroughCell` (the honest captured half) is the door's surface.
- **hostPhysics' entity packing / IDLE_REST_EPSILON / step plumbing** — the
  wire half, already captured in `game/physics.ts`.

## V20

`worldStream` — the world concern in ONE registration: grid edits as events
(`cellPlaced`/`cellRemoved`/`regionFilled`/`triggerSet`/`landformPlaced`/
`landformRemoved`/`respawnArmed`) materializing the WorldGridState snapshot;
unknown future kinds pass through untouched.
