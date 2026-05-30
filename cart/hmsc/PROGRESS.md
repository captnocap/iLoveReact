# HMSC Progress

Last updated: 2026-05-30

## Current Shape

HMSC is split into two carts:

- `hmsc`: the game cart.
- `hmsc-int`: internal map tooling.

The game state is a single JSON `GameState` object defined in `design.ts`.
World authoring is grid-locked, while player movement is continuous over that
grid.

The current reset point is intentionally simple:

- `hmsc` is back to a blank player-facing shell while the map contract is fixed.
- `hmsc-int` is back to a blank internal-tooling shell.
- No generated map or 3D world is mounted by default.
- The previous generated demo map files and current 3D world renderer files
  were removed from the active code path.
- The established scale remains: 1 grid tile = 1 meter.
- The large-map storage contract is unresolved and should be confirmed before
  any new implementation.

## Historical Work Before Reset

The list below records work that happened before the reset. Treat anything about
the removed map renderer, demo map, or internal map canvas as historical context,
not the current implementation.

- Created the HMSC cart scaffold with a command-first surface.
- Split the game cart from the internal map cart.
- Normalized the cart names around `hmsc` and `hmsc-int`.
- Added a shared demo map in `world/demoMap.ts`.
- Added grid helpers in `world/grid.ts` for cell keys, chunk keys, world/cell
  conversion, placement, removal, and occupancy checks.
- Added typed tile kinds in `world/tileKinds.ts`.
- Added pathing metadata per tile kind:
  - `walkable`
  - `movementCost`
  - `blocksLineOfSight`
- Added render metadata per tile kind:
  - color
  - height in meters
  - texture key
- Added `world/pathing.ts`, a basic grid pathfinder that uses tile pathing
  metadata.
- Added command support for map/path work:
  - `wv_place <kind> <x> <z> [y]`
  - `wv_remove <x> <z> [y]`
  - `wv_path <fromX> <fromZ> <toX> <toZ> [y]`
- Added the third-person drive-mode player model from `animation_lab`.
- Added continuous WASD/arrow movement in `state/usePlayerDrive.ts`.
- Fixed movement basis to match `animation_lab` drive mode:
  - `W` moves away from the camera into the scene.
  - `A`/`D` strafe in the same direction as the lab.
- Added smoothed camera drag and matched the lab's third-person camera position.
- Added live player sync from `hmsc` to `hmsc-int` through a compact
  localstore snapshot.
- Added continuous player marker rendering in `hmsc-int`.
- Added click-to-inspect tile diagnostics in `hmsc-int`.
- Ported the player-facing Scape3D HUD shape into `hmsc`:
  - GTA-style clock, cash, health, armor, item box, and wanted stars
  - circular bottom-right minimap rendered from `GameState.world.placedCells`
  - player marker and facing pip driven by continuous player position/yaw
  - item menu and debug panels intentionally left out for now
- Added `input/controlContract.ts` as the canonical player control vocabulary:
  - mouse move for camera look/orbit
  - right mouse hold for aim over shoulder
  - left mouse while aiming for fire/attack/throw
  - E/F interact, R reload, Q/Tab quick menu
  - Shift run, Space jump/mantle, Ctrl/C crouch
- Added `world/noiseModel.ts` for stealth/audio noise contracts:
  - material multipliers from carpet through shallow water
  - continuous movement ranges for creep/walk, jog, and sprint
  - burst movement events for jump/land and mantle/climb
  - current tile kinds mapped onto the material multiplier vocabulary
- Exposed the contracts through the HMSC command surface:
  - `gv_controls`
  - `gv_noise`
- Replaced the command surface with domain-prefixed canonical names:
  - `cmd_*` for console meta commands
  - `gv_*` for game/global state and configuration
  - `pv_*` for player variables and player-state mutations
  - `wv_*` for world/grid/map variables and mutations
  - `ev_*` for spawned entity variables and mutations
  - `lab_*` for in-cart lab selection and lab workflow
  - `a_*` reserved for audio configuration and audio-state mutations
  - no unprefixed legacy aliases
- Added the shared HMSC gameplay rig:
  - `gameplay/HmscGameplayRig.tsx` owns the real third-person camera, player
    drive hook, 3D world renderer, and HUD together
  - `gameplay/camera.ts` holds the canonical camera tuning constants
  - the game cart now uses this rig instead of wiring camera/movement inline
  - camera look is handled by mouse movement through the rig, with state
    coalescing so camera updates do not create a node storm while dragging
- Started the one-entry lab system:
  - `labDefinitions.ts` declares labs that can run inside the HMSC cart
  - `lab_spawn scale` enters the scale lab through the normal gameplay rig
  - `lab_spawn textures` enters the tile texture material lab through the same
    gameplay rig
  - `lab_spawn aim` enters the aim/crosshair target lab through the same
    gameplay rig
  - `lab_exit` returns to the normal game scene
  - labs render as Scene3D add-ons inside the live game world, so they inherit
    the real player, camera, controls, HUD, noclip, and physics
- Turned labs into in-world easter egg building targets:
  - `PlacedCell.triggerCommand` stores per-cell entry commands
  - the player drive loop fires a trigger when entering that cell
  - `wv_trigger <x> <z> [y] [command...|off]` inspects, sets, or clears door
    triggers
  - the demo map has `lab_spawn scale`, `lab_spawn textures`, and
    `lab_spawn aim` doors
  - `hmsc-int` tile diagnostics now show trigger command and trigger label
- Replaced the tiny demo-map cell list with a master layout:
  - `world/masterLayout.ts` authors map root -> zones -> nested lab building
    placements
  - the starter layout is now a 1200x1200 water-surrounded three-island
    district sketch
  - blue residential, red downtown, green mixed-density, and sand beach/causeway
    regions are authored as named zones
  - huge water/island floor materials are stored as `surfaceRegions` instead
    of 1.44 million serialized placed cells
  - lab buildings are distributed across the map as nested placements
  - `GameWorld3D` renders surface regions as large flat meshes
  - `hmsc-int` renders surface regions directly and keeps placed-cell
    diagnostics for buildings and trigger doors
- Ported the analytic skybox from `cart/skybox_demo.tsx` into HMSC:
  - `render3d/sky.ts` owns the day-keyframe sky model
  - `GameWorld3D` now renders `Scene3D.Skybox`
  - ambient and directional light are synced to the sky sun direction/color
  - sky time, weather, gloom, cycle enable, and cycle speed now live under
    `GameState.config.sky`
  - the day/night clock advances `config.sky.hour` while day cycling is enabled
  - `gv_sky`, `gv_time`, `gv_daycycle`, and `gv_weather` are the command
    surface for controlling the skybox
  - HMSC still uses seam-safe sky colors until the host skybox diagonal split
    is fixed below the cart layer
- Added the first HMSC game event layer:
  - `GameState.events.recent` stores the recent in-state event ring
  - `events/gameEvents.ts` records typed events and mirrors them to the host
    event bus
  - every event also emits `useIFTTT` channels like `hmsc:event:lab.entered`
  - command execution, scene changes, lab entry/exit, entity spawns/despawns,
    cell placement/removal, player cell entry, and door-trigger entry now have
    traceable events
  - `events/useHmscEventRules.ts` is the story-conditional surface and
    currently sets story flags for visited labs and seen trigger doors
  - `gv_events [count] [type-filter]` inspects recent events from the console
  - `gv_emit <type> [json-payload]` manually emits a typed event for rule tests
- Added the first HMSC tile texture pipeline from `effect_fills`:
  - procedural tile fills are captured through hidden `StaticSurface` nodes
  - world tile meshes now sample stable `hmsc.tile.*` texture keys
  - tile render metadata points at texture keys instead of placeholder
    `solid.*` names
  - `world/tileTextureKeys.ts` is typed against `TileKind`, so every tile kind
    must have an authored texture key
  - `lab_spawn textures` shows all current tile texture captures on 3D panels
- Added cheat-gated player noclip:
  - `cmd_cheats <1|0>` enables or disables cheat-gated commands
  - disabling cheats forces `player.noclip` off
  - `pv_noclip <1|0>` toggles collision/gravity-free player movement
- Moved gameplay-tuning numbers into named defaults and live config:
  - default values live in `state/defaults.ts`
  - physics tuning lives under `GameState.config.physics`
  - `gv_config [path] [value]` prints or changes config values from the console
  - gravity, jump speed, capsule size, step height, restitutions, and max drive
    frame time are now state-backed tuning values
  - player walk/run speed already remains state-backed through `pv_speed`
- Integrated the host physics layer into `hmsc` through a typed-buffer bridge:
  - player gravity and jumping
  - player collision against blocking map cells
  - spawned entity gravity, bounce, wall collision, and sphere pairs
- Expanded tile metadata into gameplay-facing profiles:
  - NPC traversal has separate pedestrian, runner, and vehicle costs.
  - Tiles now expose explicit cover profiles for protection, concealment,
    shoot-over behavior, lean-around behavior, and crouch requirements.
  - Door tiles now carry interaction metadata, open/closed blocking rules,
    width, open cost, and vehicle passability.
  - Visibility metadata now separates opacity, concealment, light transmission,
    sound occlusion, and line-of-sight blocking.
  - Traversal metadata now lists allowed movement modes, width class, max step,
    clearance, slope limit, crouch/mantle requirements, and vehicle grip.
  - Surfaces carry walk/run/vehicle speed multipliers, acceleration, friction,
    lateral grip, and restitution.
  - Added road, mud, and sand tile kinds for material testing.
  - `wv_tile [kind]` inspects the full metadata bundle from the command console.
- Threaded surface metadata into host physics:
  - Player speed and acceleration now respond to the tile underfoot.
  - Large `surfaceRegions` now participate in host physics ground detection,
    so the player stands on the same floor height that the 3D renderer shows.
  - Water now participates as a non-solid ground surface with slow wading
    movement, instead of acting like a void under the player.
  - Host rects now carry per-tile friction and restitution in the packed buffer.
  - Spawned physics bodies lose velocity faster on sticky surfaces and bounce
    less on mud/sand.
- Extended `wv_path` with optional agent mode:
  `wv_path <fromX> <fromZ> <toX> <toZ> [y] [pedestrian|runner|vehicle]`.
- Added `ev_burst [count]` for quickly spawning host-physics test bodies.
- Added host physics benchmarking in `physics_lab`:
  - JS simulation timing
  - host simulation timing
  - active backend total timing
  - bridge overhead timing
- Replaced CSV host physics snapshots with packed typed-buffer snapshots,
  reducing bridge overhead from hundreds of microseconds into low double-digit
  microseconds in the heavy item-body scene.
- Replaced simple ball visuals in `physics_lab` with multi-part gallery item
  bodies and off-center mass visualization.
- Added `world/scale.ts` as the canonical HMSC meter scale:
  - 1 tile = 1 meter
  - player capsule = 1.65m
  - normal visual human = 1.7-2.0m
  - door = 1m x 2.4m
  - story = 3m
  - car = 4m x 2m x 1.5m
  - bus = 11m x 2.5m x 3.2m
  - room, house, shop, and city-block reference sizes
- Walked back the broken 3D/map pass:
  - removed the incorrect `hmsc-int` SVG-style overview.
  - removed the current HMSC 3D world renderer while the tile contract is being
    corrected.
  - kept the game cart as a blank surface until the 3D view can be rebuilt from
    an agreed map contract.
- Added `hmsc_scale_lab` for inspecting player art, physics capsule, step
  height, ledge heights, door/story targets, and vehicle scale against a 1m
  ruler.
- Added orbit camera presets and zoom controls to `hmsc_scale_lab`.
- Added the in-cart aim lab:
  - `lab_spawn aim` places bottle targets based on `cart/game_item_gallery`
    bottle shapes on a pillar
  - right mouse hold uses the shared gameplay camera with a slight shoulder
    shift and crosshair instead of a strict separate aim camera
  - aiming does not interrupt run/jump/bhop movement
  - bottle targets highlight when the shared camera aim ray is aligned
  - the lab runs as a scene add-on inside `hmsc`, not as a separate cart, so it
    exercises the same player controller, camera constants, HUD, and world
    renderer as normal gameplay
- Added `hmsc_massive_map_lab`, a procedural city-scale render/chunking lab:
  - 12.8km x 8km generated Miami-like world
  - 160m chunks with an 80m road/block rhythm
  - downtown, coast/water, suburb, urban, and industrial zones
  - configurable visible chunk radius and building density
  - HUD counters for total chunks, visible chunks, visible buildings, and
    approximate visible meshes
  - HMSC player model placed at the active focus point
  - real HMSC third-person gameplay camera and separate aerial map camera mode
- Added massive-map render diagnostics:
  - host FPS and RAF FPS
  - frame, tick, layout, paint, GPU, and 3D draw timings
  - camera position/target and input coalescing counters
  - node totals and Scene3D mesh/drop/draw/instance counters
  - copy-to-clipboard diagnostics snapshot button
- Wired the `tools/rjit ship` path to run geometry baking before bundling:
  - `bake-geometry-auto`
  - `bake-geometry`
  - esbuild bundle with the baked seed included
  - restore `runtime/geometries/_baked.generated.ts` afterward so shipping does
    not leave the repo dirty
- Added `Scene3D.Instances`, a packed host-instance path for large static
  repeated geometry:
  - one React/host node can submit thousands of transforms and colors
  - instance layout currently uses `[px, py, pz, sx, sy, sz, r, g, b]`
  - the massive map now submits the procedural city as one packed unit-box
    instance batch rather than one `<Scene3D.Mesh>` per building/road/floor
- Batched Scene3D instance-buffer uploads per draw group, replacing one
  `queue.writeBuffer` per instance with one upload per grouped draw.
- Added a real draw radius and distance fog to control what is visible at range:
  - before, `Scene3D` auto-fit its clip plane and fog to whatever was in the
    scene, so a small world drew in full from any vantage point (cresting a hill
    showed the entire map)
  - `Scene3D.Camera` now takes `far` (the draw radius: hard clip plane plus a
    per-mesh cull) and optional `near`; omitting them keeps the old auto behavior
  - new `Scene3D.Fog` primitive fades geometry into a color before the cull edge;
    fog auto-anchors to the camera `far` (fade finishes at the radius, no
    popping) unless `near`/`far`/`color` are set to decouple the haze
  - this is a general engine feature: `runtime/primitives.tsx` props,
    `framework/layout.zig` node fields, `v8_app.zig` prop appliers, and the
    `framework/gpu/3d.zig` render path (clip plane, fog anchor, per-mesh cull)
  - HMSC drives it from `GameState.config.view` (`drawRadiusMeters`,
    `fogNearMeters`, `fogFarMeters`); default radius is 140m (one 120m chunk plus
    a margin) over the 240m world
  - `gv_view [radius] [fogNear] [fogFar]` prints or sets the view distance live;
    `gv_view` and `gv_view 80` are console quick-command buttons
- Fixed prop collision so the player bumps and stands on solid props:
  - solid props (hydrant, sign, light/traffic poles, rock, stop sign) had a
    zero-height blocking rect (`propPhysicsRect` used the ground `prop.y` as the
    box top), so the host's "feet at/above top" skip fired every frame and the
    player walked straight through them
  - the rect top is now the prop's real top (`prop.y + kind heightMeters`), so
    the side-collision engages while the player is below it — poles are solid
  - made solid objects standable-on-top as a general host change in
    `framework/v8_bindings_physics_lab.zig`: `hmscGroundAt`/`hmscSurfaceValueAt`
    no longer skip solid rects, so a solid's top counts as ground once the
    player's feet are at/above it (gated by step height). One rule for every
    solid box: bump from the side, stand from above — hop onto a hydrant GTA-style
  - the step-height gate keeps it sane: tall walls never count as ground at their
    base (only once you're on top), and a future low curb/ledge auto-steps up
- Added the building system as a first-class world layer (peer of
  roads/junctions/props), expressing three building types as ONE `enclosure`
  field rather than three parallel systems:
  - `world/buildingKinds.ts` is the per-kind property bundle (footprint, storeys
    → height, the `wall` tile bundle the mass borrows, default enclosure,
    facade) — the buildings twin of `propKinds.ts`.
  - `world/buildings.ts` exposes `buildingBoxes()` as the ONE geometry source
    consumed by both host physics (blocking rects) and the renderer (wall
    meshes), so the wall you see is exactly the wall you collide with.
  - `sealed` = solid block (bump the side, stand on the roof via the existing
    standable-solids host rule); `hollow` = perimeter walls with a real doorway
    gap and the same outer-world floor inside (see in/out, one continuous
    space); `interior` = a sealed shell whose front pad is a portal.
  - `world/interiors.ts` backs closed buildings with a mini-world PER building
    (its own `WorldState`). Entering pushes the outer world onto a new
    `GameState.suspendedSpaces` stack and swaps `state.world` to the interior,
    so the existing renderer (`GameWorld3D` reads `state.world`) and host
    physics draw/simulate it with NO special casing — the world-swap is the
    whole mechanism, cleaner than the lab scene-overlay. The interior size is
    decoupled from the footprint (bigger inside than out).
  - entry/exit are door triggers: an interior building drops a `wv_enter` pad in
    front; the interior's exit pad carries `wv_leave`. The cell-trigger guard in
    `usePlayerDrive` now fires in interior scenes too, not only `boot.console`.
  - `render3d/Building.tsx` draws all three from `buildingBoxes`; physics packs
    them in `state/hostPhysics.ts`; `grid.canOccupyWorldPosition` blocks the
    JS-fallback path. `wv_building`/`wv_enter`/`wv_leave` are the command
    surface. Schema bumped 13 → 14; a fresh world seeds one of each enclosure
    near spawn (sealed house, hollow shop, interior tower).
  - Camera now respects walls: the third-person camera casts from the look pivot
    (player head) to the desired spot and pulls in to just before the first
    building wall it hits (`nearestBuildingHitFraction`, 3D segment-vs-AABB over
    `buildingBoxes`), so the player stays visible inside hollow shells and
    interiors instead of being hidden behind a wall the camera clipped through.
  - Fixed closed-building entry: the `wv_enter` pad now sits flush in front of
    the door (one cell out, not two) and spans the full doorway width as a 2-cell
    mat, so walking up to the closed door reliably fires the trigger — the old
    single pad sat a cell too far out and, on an even-width building whose door
    center lands on a cell boundary, could be approached "between" it. The
    interior exit mat spans the shell doorway the same way, and the entry/exit
    geometry comes from `buildingDoorFrontCells`/`buildingDoorFrontPoint`.
  - Added E/F interact (`state/useBuildingInteract.ts`): standing near a closed
    building's door shows a "Press E to enter <label>" prompt; inside, "Press E
    to leave". Proximity-based (3.2m of the door front point) and it runs
    `wv_enter`/`wv_leave` directly, so it does not depend on landing on the exact
    mat cell — the discoverable path players actually reach for. The walk-on mat
    stays as a fallback and for NPCs. Prompt renders in `HmscGameplayRig`; E/F
    was the reserved interact binding in `input/controlContract.ts`.
- Added building skins — facade appearance as a SEPARATE axis from kind, so any
  footprint can wear any look:
  - `render3d/buildingSkins.tsx` is the catalog (a `BUILDING_SKINS` registry, the
    appearance peer of `buildingKinds`): office (glass curtain grid), residential
    (brick + balconies + address), retail (storefront awning + sign), industrial
    (corrugated + roller door), plus `plain` (bare wall, no panel). Each is a 2D
    `Box`/`Text` facade laid out to a window grid (`cols`≈width/3m, `floors`≈height/3m).
  - `render3d/BuildingFacades.tsx` lays a thin textured panel on each exterior
    wall face (billboard pattern; structural wall stays solid for physics) and
    captures one shared texture per `(skin, cols, floors)` bucket — memoized like
    `tileSurface` so a street of offices is a few bakes, not one per building and
    not a per-frame re-bake. Only a HOLLOW building's door side is left unskinned
    (it has a real walk-through gap); sealed/interior walls are fully skinned.
  - Per-face skins: `Building.skin` is either a single `BuildingSkin` (all walls)
    or a `BuildingFaceSkins` map `{ front, back, left, right, top, all }`. Roles
    are relative to the door side (front = door side); `resolveFaceSkin`/
    `resolveTopSkin`/`buildingFaceRole` in `world/buildings.ts` resolve them, and
    a roof panel renders when `top` is set. `wv_building face <id> <role> <skin>`
    authors one face. The seeded warehouse wears `{ front: industrial, all: plain }`
    — garage on the front, plain metal walls on the sides — proving the taxonomy.
  - `buildingKinds.defaultSkin` (house→residential, shop→retail, tower→office,
    warehouse→industrial). Seed has four demo buildings, one per skin; the fourth
    is a `warehouse` kind (a taller, wider garage). Schema already 14.
  - Crash fix: entering an interior swaps `state.world` to the mini-world, which
    must be a COMPLETE WorldState — a missing `zones` layer (added elsewhere) made
    `MiniMap` throw on `world.zones.map`. The interior space now spreads the outer
    world first (so any future layer exists) then empties every known layer.
  - Perception SURFACE built, not yet live (per the agreed slice): added
    `PlayerState.perception` (a 0–1 `high` channel) and threaded it into the skin
    render context, so a later slice can make a skin scramble text or go to a live
    plasma `Effect` on player state. Static skins accept but ignore it; the
    capture's bake deps deliberately exclude perception so it never re-bakes. The
    reactive slice is a per-skin change adding a perception bucket to its key.
- Added building placement rules (`world/buildingPlacement.ts`), applied by
  `wv_building`: reject overlap (edge-to-edge touch allowed) and sitting on a
  road; reject too-far-from-road (> ~18m, the "feels sparse" guard); and
  AUTO-SNAP the door to face the nearest road so placement never thinks about
  orientation. A trailing `force` arg bypasses everything (keeps the given door,
  skips checks) for intentional/sandbox placement. The seed was re-laid to obey
  — the four demo buildings now line the east side of the spawn arterial with
  road-facing (west) doors, set back ~3m, no overlaps. Authored seed complies
  directly; the rules gate console placement and any future generator.
  - Follow-ups (building map rendering): NEITHER map surface draws buildings yet
    — both the `hmsc-int` internal map tool AND the in-game circular minimap
    (`render/Hud.tsx`, fed from `GameState.world`). They read the same world
    layers, so add building footprints to both in ONE pass when this is picked
    up, rather than wiring one and leaving the other behind. Also: the live
    player snapshot reports interior-local coords while inside an interior, so
    both map views show the player marker jumping when entering a closed
    building — fold that fix into the same pass.

## Massive Map Findings

The procedural city lab established the current large-world rendering rule:
JS/React can declare the world, but repeated gameplay-scale renderables must
cross into the host as packed buffers, not as one host node per object.

Measured progression:

- Original per-object mesh path at radius 7-8:
  - thousands of React/host nodes
  - `nodeTotal` climbed past the `4096` node index cap
  - `scene3d_draw_calls` pinned at `512` before geometry canonicalization
  - dense scenes fell into multi-hundred-millisecond frames
- Canonical unit-box geometry plus scale:
  - collapsed thousands of unique box geometries into one `Box` key
  - stopped geometry-cache overflow
  - reduced draw calls to about `15`
  - eliminated `scene3d_meshes_dropped`
- Packed `Scene3D.Instances` path:
  - radius 8, density 1.0, 289 visible chunks, 5,780 buildings
  - `scene3d_instances`: 7,536
  - `scene3d_draw_calls`: 15
  - `scene3d_meshes_dropped`: 0
  - `nodeTotal`: 151
  - `scene3d_draw_us`: about 592us
  - `frame_total_us`: about 4,116us, inside the 240 FPS frame budget

This mirrors the physics-lab result: the winning pattern is typed/packed data
over the bridge, then host-side iteration and batching. CSV/object-per-entity
and node-per-entity approaches are useful for early demos, but they do not scale
to world/game production.

## Aim Lab Findings

The aim lab is now the first combat-control test running inside the actual HMSC
gameplay rig instead of a standalone demo. The important behavior is that aiming
is a camera presentation layer, not a movement-mode switch.

- Mouse movement owns the normal third-person camera look/orbit.
- Right mouse hold sets `aiming` and only nudges the camera into an
  over-shoulder offset.
- The crosshair appears while aiming, but walk, run, jump, and bhop motion keep
  using the same player drive path.
- The aim ray is derived from the shared gameplay camera yaw/pitch and used to
  highlight gallery-derived bottle targets.
- Left mouse fire/attack/throw, reload, interact, quick menu, and crouch remain
  reserved in `input/controlContract.ts`; the current lab intentionally tests
  aim alignment without shooting yet.

Current tuning lives in `gameplay/camera.ts`. The values to revisit next are
`aimShoulderShiftMeters`, `aimTargetShiftRatio`, `aimFovDegrees`, and the pitch
to target-height mapping.

## Internal Map Diagnostics

Clicking a cell in `hmsc-int` selects it and shows:

- cell coordinates
- chunk key
- world center position
- tile kind and label
- texture key
- render color and height
- player collision blocking and collision top height
- physics capsule radius/height and step-height tuning
- movement surface multipliers, friction, lateral grip, and restitution
- pathing walkability, cost, and line-of-sight blocking
- NPC traversal costs, cover profile, opacity, and visibility blocking
- live player position, velocity, speed, grounded/noclip state, current surface,
  and effective walk/run speeds
- original placement command

Empty cells are shown as non-walkable with no texture.

## State And Sync

Persistent game saves use the `hmsc/game-state` localstore entry.

Live player sync uses the `hmsc/live-player` localstore entry. This is a compact
snapshot of the player only, not the full world, so movement does not become an
autosave and does not hit localstore value-size limits as the map grows.

`hmsc-int` reads the saved world and overlays the live player snapshot.

## Verification

The current HMSC work has been verified with:

```sh
SHIP_RUN_PACKAGE=0 ./tools/rjit ship hmsc
SHIP_RUN_PACKAGE=0 ./tools/rjit ship hmsc-int
SHIP_RUN_PACKAGE=0 ./tools/rjit ship hmsc_scale_lab
SHIP_RUN_PACKAGE=0 ./tools/rjit ship hmsc_massive_map_lab
timeout 6s ./zig-out/bin/hmsc
timeout 6s ./zig-out/bin/hmsc-int
timeout 6s ./zig-out/bin/hmsc_scale_lab
timeout 6s ./zig-out/bin/hmsc_massive_map_lab
```

The timeout checks are expected to exit with code `124`; success means the carts
reached the render loop before timeout.

## Textured Box Faces

Every `Geometry.Box` carrying a `textureKey` now declares `texturedFaces` — the
faces that actually show the texture. Undeclared faces pin their UVs to the
capture's `(0,0)` corner texel, so they read as one flat color instead of
cramping the whole texture onto a thin edge (the street sign was stretching
"HMSC AVE" sideways down its 0.03 m side; flat slabs were smearing their surface
down the sides).

- Mechanism lives in `@reactjit/geometries` Box (`texturedFaces?: BoxFace[]`).
  Omitting it textures all six faces (back-compat); no hmsc textured box does.
- Flat slabs (road, junction, floor, crater water) declare `['top']`.
- Upright panels (street sign, building facade walls) declare the two broad
  faces — `['front','back']` or `['left','right']` by orientation.
- A capture's `(0,0)` corner should be the intended edge color (the sign's green
  background) so the fallback reads cleanly. Rule documented in `AGENTS.md`.

## Known Next Work

- Add authored map editing commands or map-tool controls for creating cells from
  `hmsc-int`.
- Use the expanded tile metadata for NPC cover selection, door state, line of
  sight, and vehicle/running route decisions.
- Add NPC state and path-following using `world/pathing.ts`.
- Turn the massive generated-map lab into a reusable chunk source for `hmsc`
  once rendering/chunking limits are known.
- Evaluate OSM import into the same chunk format after the procedural lab
  defines acceptable mesh counts and draw-distance behavior.
- Continue tuning the shared third-person/aim camera now that labs use the real
  gameplay rig instead of isolated camera code.

## Recent HMSC Commits

- `1458cb243 feat: add hmsc map tile diagnostics`
- `10a977d45 feat: sync hmsc player to internal map`
- `51e7c8506 feat: add hmsc tile pathing and drive movement`
- `cf8c4ef6f feat: share hmsc map across game and tooling`
- `5a4ab5eec fix: normalize hmsc cart names`
- `37b1257b0 refactor: split hsmc game and internal map carts`
- `fb04cc3f0 feat: scaffold hmsc command cart`
