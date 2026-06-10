# cart/hmsc inventory

Reviewed: 2026-06-04

Source: `cart/hmsc`

HMSC is the main game cart for "Hitman Shitcity". It is not a lab-only or editor-only cart. It is a playable blank game shell with a command console, a 3D world renderer, a JSON game-state contract, grid authoring commands, player movement, host physics, events, zones, buildings, roads, props, landforms, NPC data, and several in-cart labs.

The prime architecture is:

- Everything important mutates through commands. UI, triggers, lab entry, save/load, world authoring, and debug tools all go through `runCommandLine`.
- Runtime state is one JSON-serializable `GameState`.
- Constructed world data is grid or authored-object data. Player, entities, and NPCs move in continuous meters.
- The active scene is selected by `GameState.sceneStep`, not by separate cart entrypoints.
- Rendering is a 3D Scene3D tree plus 2D offscreen StaticSurface/Effect captures that provide texture keys.
- Browser DOM APIs are not used. Host bridge calls are made through `globalThis` or ReactJIT hooks.

## Manifest and cart shell

`cart/hmsc/cart.json`

- Declares cart name `HMSC`, description `Hitman Shitcity blank game shell with command console.`, and a default 1280x800 window.

`cart/hmsc/AGENTS.md`

- Local working contract for this cart.
- States that the cart ships with `./tools/rjit ship hmsc`.
- Makes the command console first-class.
- Requires all mutations to be commands.
- Keeps labs inside HMSC via `lab_spawn`.
- Defines command prefixes: `cmd_*`, `gv_*`, `pv_*`, `wv_*`, `ev_*`, `lab_*`, `a_*`.
- Notes that cheats are gated through `cmd_cheats`.
- Notes that `placedCells` remains the explicit authored-cell surface.
- Notes that game events are first-class and publish to `hmsc:event:*` channels.
- Notes that 1 grid tile equals 1 meter.
- Notes that textured boxes with `textureKey` must name `texturedFaces`.

`cart/hmsc/README.md`

- Human orientation document for the cart.
- Lists the command taxonomy, state model, scale model, sky controls, input contract, tile texture keys, building system, and event bus rules.
- Calls out the split between HMSC and `cart/hmsc-int`, where internal map tooling belongs.

`cart/hmsc/PROGRESS.md`

- Progress log for the HMSC cart.
- Tracks already-completed systems such as events, labs, map/world authoring work, and rendering improvements.

`cart/hmsc/WORLD_AUTHORING_PLAN.md`

- Planning document for the world authoring path.
- Mentions shared localstore, map tree, zone authoring, copy/export flows, and the event bus as the intended integration spine.

`cart/hmsc/index.tsx`

- Composition root for the game cart.
- Creates initial state with `readStoredGameState() ?? createInitialGameState()`.
- Holds React state for `gameState`, `commandLine`, console visibility, and console history.
- Calls `useHmscEventRules(setGameState)` to attach story/event rules.
- Records and publishes `game.booted` on mount.
- Publishes a compact live player snapshot immediately and every `DEFAULT_LIVE_SYNC_INTERVAL_MS`.
- Mirrors the full game state for hot reload every 2000 ms.
- Autosaves every `DEFAULT_AUTOSAVE_INTERVAL_MS`.
- Advances sky time every `SKY_TICK_INTERVAL_MS` when day cycle is enabled.
- Submits console text through `runCommandLine`, then appends input/output/error entries.
- Renders `HmscGameplayRig` full-screen, plus a Console toggle and overlay.
- Uses JavaScript timers: `setInterval`.
- Uses JavaScript `Date.now()` and `Math.random()` only for console entry ids.

## Core state contract

`cart/hmsc/design.ts`

- Defines `HMSC_STATE_SCHEMA_VERSION`, autosave interval, live sync interval, grid cell size, and chunk span.
- Defines primitive data shapes: `Vec3`, `GridCell`.
- Defines all tile kinds: `water`, `road`, `asphalt`, `sidewalk`, directional lanes, `junction`, `crosswalk`, `mud`, `sand`, `wall`, `door`, `bush`, `marker`, `spawn`, `save`.
- Defines player state, including continuous position, yaw, noclip flag, physics velocity/grounded state, walk/run speeds, health, heat, money, perception, inventory, and optional respawn cell.
- Defines a compact `LivePlayerSnapshot` for cross-cart/shared live state.
- Defines authored cells as `PlacedCell`, including optional `triggerCommand`, `triggerLabel`, and spawn/save pairing data.
- Defines spawned physics entities as `SpawnedEntity`.
- Defines NPC state: kind, faction, role, stance, posture, health, animation time, velocity, path target, and target id.
- Defines game-event records and story-state records.
- Defines `WorldState`: surface regions, placed cells, roads, junctions, props, buildings, interiors, landforms, zones, spawned entities, and NPCs.
- Defines building kinds, skins, enclosure modes, face skins, open-structure part textures, and interior id linkage.
- Defines prop kinds, traffic signal phase, landform fields, road profiles, road segments, junctions, zones, config objects, command state, and command handler types.
- The file is type-only plus constants. It does not call host functions.

`cart/hmsc/state/defaults.ts`

- Stores gameplay defaults and tuning numbers.
- Defines default player speeds, health, heat, money, event log limit, console event limit, sky settings, view/draw radius, fog defaults, and physics defaults.
- Defines drive constants such as movement deadzone, max frame step, noclip floor, entity radii, and burst counts.
- This is the main place where tuning values should live before they become runtime `GameState.config` values.

`cart/hmsc/state/gameState.ts`

- Owns save/load, hot reload mirror, live player publish, and initial seed world construction.
- Uses a namespaced local store first: `globalThis.__localstoreGet('hmsc', key)` and `globalThis.__localstoreSet('hmsc', key, value)`.
- Falls back to generic store functions: `globalThis.__store_get('hmsc:key')` and `globalThis.__store_set('hmsc:key', value)`.
- Reads hot state through `globalThis.__hot_get('hmsc:hot-game-state')`.
- Writes hot state through `globalThis.__hot_set('hmsc:hot-game-state', json)`.
- Creates a 2x2 seed world with surface regions for sidewalk, road, sand, and asphalt.
- Seeds roads, intersections, a cul-de-sac, props, landforms, and buildings.
- Seeds building examples for sealed, hollow, interior, warehouse, internet cafe, gun shop, mall, parking garage, gas station, used car lot, and drive-in.
- Computes the initial player foot height from the spawn surface.
- Revives old saved state into the current schema, rejects future schemas, merges defaults, repairs missing fields, and handles layout-key mismatch.
- Does not use browser storage. Persistence is host-backed.

`cart/hmsc/state/driveInScreens.ts`

- Session-only singleton store for drive-in video source paths.
- Exposes `getDriveInSource`, `setDriveInSource`, `subscribeDriveInSources`, and `useDriveInSources`.
- Uses React state/subscriptions only. It does not persist to host storage.

## Command system

`cart/hmsc/commands/parser.ts`

- Tokenizes command lines.
- Supports whitespace splitting plus single and double quoted strings.
- Parses JSON-ish values for commands: booleans, null, numbers, JSON objects, JSON arrays, and raw strings.
- Pure JavaScript. No host calls.

`cart/hmsc/commands/registry.ts`

- Source of truth for HMSC commands.
- Defines helpers for command success/failure, number parsing, boolean switches, toggles, sky args, path read/write, spawn helpers, and placement validation.
- Exports `runCommandLine(line, state, options)`.
- `runCommandLine` tokenizes input, looks up a command, executes it, then sends the result through `recordCommandEvents`.
- Unknown commands still pass through `recordCommandEvents` as failed command events.
- The registry uses `globalThis.__hmsc_spike_trace(1|0)` from `gv_perflog 2` when available.

Commands present in the registry:

- `cmd_help`: list commands or inspect one command.
- `cmd_cheats`: enable/disable cheat-gated commands; disabling cheats forces noclip off.
- `lab_list`: list in-cart labs.
- `lab_spawn`: enter a lab scene through the normal gameplay rig.
- `lab_exit`: return from a lab scene.
- `gv_controls`: print canonical input bindings.
- `gv_debug_hud`: toggle debug overlay.
- `gv_perflog`: toggle JS spike recorder; level 2 also asks host for spike trace.
- `gv_noise`: print noise multipliers.
- `wv_tile`: inspect tile metadata.
- `gv_sky`: print current sky config.
- `gv_time`: set or print sky hour.
- `gv_daycycle`: set day/night cycling.
- `gv_weather`: set weather/gloom or named presets.
- `gv_view`: set draw radius and fog.
- `gv_events`: print recent game events.
- `gv_emit`: emit a manual typed game event.
- `gv_state`: print whole state or a dot path.
- `gv_config`: print or mutate `GameState.config`.
- `gv_save`: persist current `GameState`.
- `gv_load`: load persisted `GameState`.
- `gv_reset`: reset to seed state.
- `pv_teleport`: set continuous player position.
- `pv_respawn`: return to armed respawn cell.
- `gv_scene`: print or set `sceneStep`.
- `gv_set`: set arbitrary game-state dot path to a parsed value.
- `pv_noclip`: enable/disable noclip, gated by `cmd_cheats`.
- `pv_speed`: tune walk/run speeds.
- `ev_spawn`: spawn a continuous physics entity.
- `ev_burst`: spawn a burst of physics test entities.
- `ev_despawn`: remove an entity.
- `wv_place`: place a single authored grid cell.
- `wv_fill`: add a rectangular surface region.
- `wv_remove`: remove a placed cell.
- `wv_trigger`: show/set/clear a command trigger on a placed cell.
- `pv_where`: print player continuous position and grid cell.
- `wv_path`: run grid pathfinding between cells.
- `wv_road`: list/place/remove road segments.
- `wv_intersection`: place/remove four-way intersections.
- `wv_culdesac`: place/remove cul-de-sacs.
- `wv_prop`: list/place/remove props.
- `wv_signal`: inspect or pin traffic-control phases.
- `wv_building`: list/place/remove buildings and set legacy face skins.
- `wv_enter`: enter an interior building.
- `wv_leave`: leave an active interior.
- `wv_mountain`: list mountains or teleport to a trailhead.
- `wv_zone`: list/place/remove named zones.
- `wv_validate`: audit existing or proposed placements.

## Events and story rules

`cart/hmsc/events/gameEvents.ts`

- Defines the HMSC event log and host/event-bus publishing path.
- `recordGameEvent` appends a JSON-safe event to `GameState.events.recent`.
- Event ids are sequential strings like `hmsc_evt_000001`.
- Event records include type, timestamp, source, scene, actor, subject, tags, player snapshot, and payload.
- `publishGameEvent` emits to the host event bus and ReactJIT IFTTT bus.
- Publishes root channel `hmsc:event`.
- Publishes typed channel `hmsc:event:<type>`.
- Publishes actor, subject, and tag channels.
- `recordAndPublishGameEvent` is the combined state mutation plus bus emission.
- `recordCommandEvents` translates command results into standard events: command executed, scene change, lab entry/exit, entity spawn/despawn, world cell placement/removal, and related facts.
- Uses `busEmit` from `@reactjit/hooks/useIFTTT`.
- Uses `hostEventBus.emit` from `@reactjit/hooks/useIFTTT`.

`cart/hmsc/events/useHmscEventRules.ts`

- Installs story rules with `useIFTTT`.
- Listens to `hmsc:event:lab.entered`.
- Sets story flags such as `lab.<name>.visited`.
- Listens to `hmsc:event:world.trigger.entered`.
- Sets story flags such as `trigger.<subjectId>.seen` when a trigger label exists.
- Emits `story.flag.set` events when rules update story state.

## Gameplay loop and input

`cart/hmsc/gameplay/HmscGameplayRig.tsx`

- Main playable surface wrapper.
- Renders Scene3D, sky, world, player, HUD, debug HUD, lab children, crosshair, interaction prompt, focus hint, and all offscreen texture captures.
- Calls `usePlayerDrive` to move the player.
- Calls `useTerrainColliders` to register host heightfields.
- Calls `useBuildingInteract` to resolve E/F interaction prompts and commands.
- Starts/stops the performance watch when `state.command.perfWatchEnabled` changes.
- Reads host mouse state through `globalThis.__mouse_delta`, `globalThis.getMouseRightDown`, `globalThis.getMouseX`, and `globalThis.getMouseY`.
- Captures/releases host mouse through `globalThis.__mouse_capture(1|0)`.
- Reads keyboard Escape through `busOn('__keydown')` to release focus.
- Uses `requestAnimationFrame` if present, else `setTimeout`.
- Uses `performance.now()` if present, else `Date.now()`.
- Computes yaw/pitch with smoothing and clamping in JavaScript.
- Does not use DOM mouse APIs.

`cart/hmsc/gameplay/camera.ts`

- Stores third-person camera constants.
- Defines sensitivity, smoothing, frame clamp, pitch clamp, distance, height, target height, pitch target factor, fov, aim shoulder shift, and aim fov.
- Exports value clamp helpers and degree-angle delta helper.

`cart/hmsc/input/controlContract.ts`

- Defines the canonical control action ids.
- Documents implemented and reserved controls.
- Implemented or wired elsewhere: mouse camera, right-hold aim, Shift run, Space jump, E/F interact.
- Reserved: primary action variants, reload, quick menu, crouch.
- Exposes `inputBindingsForConsole()` for `gv_controls`.

`cart/hmsc/state/usePlayerDrive.ts`

- React hook that drives player movement.
- Reads key events through `busOn('__keydown')` and `busOn('__keyup')`.
- Reads host scancodes through `globalThis.isKeyDown(scancode)` for Shift, Space, Control, and C.
- Runs a frame loop with `requestAnimationFrame` fallback to `setTimeout`.
- Uses `performance.now()` fallback to `Date.now()`.
- Converts WASD/arrow input into movement basis relative to camera yaw.
- Applies terrain/surface multipliers through `movementSurfaceForPlayer`.
- In noclip mode, integrates x/y/z directly in JavaScript.
- In normal mode, prefers host physics through `advanceHostPhysics`.
- If host physics is absent, falls back to a JavaScript `canOccupyWorldPosition` check and direct x/z movement.
- Emits `player.cell.entered` events when the player changes grid cell.
- Runs placed-cell trigger commands through `runCommandLine(..., source: 'world-trigger')`.
- Handles save cells by setting respawn cell, saving state, and emitting `world.save.recorded`.
- Handles zone enter/exit events and optional zone commands.
- Suppresses cell triggers in labs; triggers run in `boot.console` and interiors.

`cart/hmsc/state/useBuildingInteract.ts`

- React hook for nearby building and drive-in interactions.
- Resolves interior building doors and returns a prompt with `wv_enter <id>`.
- Resolves current interior exit through `wv_leave`.
- Resolves drive-in booth interaction.
- For drive-in booth movie selection, calls `execAsync('zenity --file-selection ...')` from `@reactjit/hooks/process`.
- Sets the drive-in source with `setDriveInSource` after a file is selected.
- Listens to E/F with `busOn('__keydown')`.
- Sends normal interactions through `runCommandLine`.

`cart/hmsc/state/hostPhysics.ts`

- Host physics bridge and JavaScript packing layer.
- Calls `globalThis.__hmsc_physics_step(inputFloat32Array)`.
- If the host function is unavailable, returns null so the caller can use fallback movement.
- Packs player state, spawned entities, axis-aligned rects, oriented rects, gravity, step height, movement surface, and counts into a Float32Array.
- Expects an ArrayBuffer result from the host.
- Parses output back into player position/velocity/grounded state and sorted spawned entity states.
- Builds collision rects from surface regions, placed cells, roads, junctions, solid props, and buildings.
- Excludes landforms because they register as host heightfields through `terrainColliders.ts`.
- Supports oriented building collision when building yaw is non-zero.
- Defines movement surface rules from tile kind below player.

`cart/hmsc/state/terrainColliders.ts`

- Registers heightfield colliders with the host.
- Calls `globalThis.__hmsc_clear_heightfields()` before registering the current set when available.
- Calls `globalThis.__hmsc_register_heightfield(index, originX, originZ, cell, cols, rows, baseY, walkCos, heights, yaw, pivotX, pivotZ)`.
- Registers landform colliders.
- Registers parking-garage ramp/deck collider data for garage structures.
- No-ops cleanly if host functions are missing.

`cart/hmsc/state/perfWatch.ts`

- Diagnostic spike flight recorder toggled by `gv_perflog`.
- Reads host telemetry through `globalThis.__tel_history`, `__tel_frame`, `__tel_gpu`, `__tel_nodes`, and `__tel_input`.
- Uses `performance.now()` fallback to `Date.now()`.
- Uses `requestAnimationFrame` if present, else `setTimeout`.
- Emits reports with `globalThis.console?.warn?.(text)`.
- Can be tuned by `configurePerfWatch`.

## World model

`cart/hmsc/world/scale.ts`

- Defines physical scale constants.
- Establishes the key rule: 1 tile equals 1 meter.
- Defines player capsule height/radius, visual human min/max, door width/height, story height, car size, lane dimensions, and step height.

`cart/hmsc/world/grid.ts`

- Core grid/world query layer.
- Converts between continuous world coordinates and grid cells.
- Builds cell keys and chunk keys.
- Places/removes placed cells.
- Adds surface regions.
- Reads placed cell at grid or world position.
- Sets cell triggers.
- Resolves tile kind at world position with priority: landform water, placed cell, junction, road, landform tile, surface region.
- Resolves ground top at a world position from surface regions, placed cells, roads, junctions, and landforms.
- Checks pathability and occupancy.
- Provides visible/nearby placed-cell helpers.

`cart/hmsc/world/tileKinds.ts`

- Registry of tile metadata.
- Defines pathing, cover, door, visibility, traversal, NPC, surface, render, and altitude metadata for each tile kind.
- Distinguishes surface tiles, embedded tiles, gameplay tiles, and dev tiles.
- Exports tile-kind validation and console listing helpers.
- This is where the meaning of `road`, `door`, `bush`, `save`, and directional lanes lives.

`cart/hmsc/world/tileTextureKeys.ts`

- Maps `TileKind` values to texture keys.
- Road-like lane, junction, and crosswalk kinds share `hmsc.tile.road`.
- This file is the stable contract for tile material keys.

`cart/hmsc/world/surfaceHeights.ts`

- Defines visual/physics top heights for surface regions and placed cells.
- Keeps surface region mesh top slightly sunk where needed to avoid visual artifacts.

`cart/hmsc/world/tileAltitude.ts`

- Samples altitude and tile source for a cell, especially when landform heightfields affect surface height.
- Distinguishes base, surface, follows-heightfield, and offset facts.

`cart/hmsc/world/terrain.ts`

- Generic heightfield bake helpers.
- Produces terrain field and collider data from height samples.
- Pure data code, no React.

`cart/hmsc/world/rects.ts`

- Shared XZ rectangle math.
- Defines `Rect`, `rectsOverlap`, `rectGap`, and `rectCenter`.
- Used by placement and collision validation.

`cart/hmsc/world/idgen.ts`

- Collision-proof sequential id allocator.
- `nextUniqueId(prefix, existing)` finds the first non-live id instead of using list length.
- Prevents duplicate ids after removing an object.

`cart/hmsc/world/noiseModel.ts`

- Defines surface noise materials and multipliers.
- Defines movement noise modes: creep/walk, jog, sprint, jump/land, mantle/climb.
- Maps tile kinds to noise materials.
- Provides console formatting helpers for `gv_noise`.
- Uses JavaScript math only.

`cart/hmsc/world/pathing.ts`

- A* grid pathfinding over HMSC tile kinds.
- Supports `pedestrian`, `runner`, and `vehicle` agents.
- Uses tile pathing/traversal/NPC metadata to compute movement cost.
- Returns a grid-cell path or empty array.

`cart/hmsc/world/zones.ts`

- Defines zone flags and zone mutations.
- Supports adding/removing zones, querying zones at cells/world positions, and picking the active smallest containing zone.
- Current availability logic is placeholder true.

`cart/hmsc/world/traffic.ts`

- Defines traffic signal cycle timing.
- Uses `globalThis.performance?.now?.()` fallback to `Date.now()`.
- Computes phase for traffic-control props.
- Supports signal override.
- Finds vehicle approach signals ahead of travel direction.
- Returns whether a vehicle should yield.

`cart/hmsc/world/placeables.ts`

- Shared registry for authorable things used by painter/map/tree tooling.
- Defines layers: tile, zone, building, road, prop, mountain.
- Converts placeable selections into command strings such as `wv_fill`, `wv_zone`, and `wv_building`.
- Centralizes swatch colors.
- Converts hex colors to RGB floats for map/minimap shaders.

`cart/hmsc/world/worldTree.ts`

- Derived read model for the authored world.
- Summarizes surface regions as chunks with base tile kind, sparse overrides, zones, and buildings.
- Produces world totals and optional staged paint totals.
- Not a storage shape.

`cart/hmsc/world/worldView.ts`

- Shared map/minimap landmark read model.
- Provides `worldMarkers(state)`.
- Emits building, landform, zone, and prop markers.
- Uses zone flag color rules.
- Lets in-game HUD and internal map tooling read the same landmark data.

`cart/hmsc/world/placementCheck.ts`

- Non-blocking placement audit system.
- Normalizes buildings, props, and landforms into `PlacementSubject`.
- Checks tile-under-footprint, water/void/road placement, scale versus player/door, overlap, and road distance.
- Used by `wv_validate`, `wv_building`, and `wv_prop`.
- Formats issues for console output.

## Roads, buildings, props, landforms

`cart/hmsc/world/roadProfile.ts`

- Defines road scale constants and default profile.
- Computes cross-section widths for lanes, bike lanes, sidewalks, centerlines, curbs, and markings.
- Exports road width helpers.

`cart/hmsc/world/roads.ts`

- Defines road footprint and road top height.
- Resolves road band kind at world positions.
- Builds road physics bands.
- Places/removes road segments.

`cart/hmsc/world/roadJunctions.ts`

- Defines intersection and cul-de-sac footprints.
- Computes junction top height.
- Resolves road/sidewalk bands within intersections and cul-de-sacs.
- Builds junction physics bands.
- Places/removes junctions.

`cart/hmsc/world/buildingKinds.ts`

- Pure building kind registry.
- Defines normal box buildings and open custom structures.
- Building kinds: house, shop, tower, warehouse, parkingGarage, gasStation, usedCarLot, driveIn.
- Stores default footprint, storeys, wall tile kind, default enclosure, default skin, facade color, and structure model.
- Exports validation and console listing helpers.

`cart/hmsc/world/buildings.ts`

- Building geometry and collision data.
- Computes footprints, heights, top, door center, door front cells, and door front point.
- Builds collision/render boxes for sealed, hollow, and interior buildings.
- Uses open-structure collision data through `structureSolids`.
- Tests whether buildings block world points.
- Resolves per-face skin roles: front, back, left, right, top.
- Provides exterior face panels for facade rendering.
- Computes camera collision against box buildings.
- Places/removes buildings and sets face skins.

`cart/hmsc/world/buildingPlacement.ts`

- Hard placement policy for buildings.
- Rejects overlapping buildings.
- Rejects buildings on roads.
- Rejects non-forced buildings too far from the road network.
- Auto-snaps `doorSide` toward the nearest road.
- `force` bypasses those rules.

`cart/hmsc/world/interiors.ts`

- Interior world swap system.
- Creates generated interior spaces for buildings with `enclosure: 'interior'`.
- Adds `wv_enter` entry pads to the outer world.
- Creates an interior `WorldState` that is larger inside than outside.
- `enterBuildingInterior` pushes the outer world to `suspendedSpaces` and replaces `state.world`.
- `leaveCurrentInterior` pops the previous world and returns to `boot.console`.

`cart/hmsc/world/propKinds.ts`

- Prop kind registry.
- Defines labels, solidity, footprint radius, height, tile kind, and traffic-control role.
- Props include rocks, hydrants, street signs, street lights, bush variants, stop signs, traffic lights, payphones, dumpsters, mailboxes, and fences.

`cart/hmsc/world/props.ts`

- Prop footprint, top height, physics rect, picking, placement, removal, and signal override helpers.
- Bushes can be non-solid.
- Fence footprints account for yaw.

`cart/hmsc/world/structures.ts`

- JSX-free layout descriptions for open structures.
- Defines parking garage, gas station, used car lot, and drive-in specs.
- Produces parking-garage heightfield/collider data.
- Defines drive-in screen texture keys and booth interaction points.
- Builds collision solids for open structures so render and physics share the same layout facts.

`cart/hmsc/world/landforms/index.ts`

- Imports and registers landform kinds.
- Re-exports the landform registry.

`cart/hmsc/world/landforms/registry.ts`

- Defines `LandformKindDef`.
- Registers and looks up landform kinds.
- Computes heightfields, colliders, top height, tile kind, water kind, camera hits, and mutations.

`cart/hmsc/world/landforms/kinds.ts`

- Registers built-in landforms.
- `hills`: rolling summed-cosine terrain.
- `mountain`: cone mountain with crater lake and spiral trail.
- `estate`: flat-topped dome with spiral road.
- `heightfield`: painted editable landform field.
- Exports mountain crater/trail helpers and estate road helpers.

## NPC subsystem

`cart/hmsc/npc/index.ts`

- Barrel export for NPC kind, faction, role, spawn, chance, and damage systems.
- Defines the intended axes: kind is what an NPC is, faction is who it fights, role is what it means to the player.

`cart/hmsc/npc/kinds.ts`

- Registry of closed NPC kinds: civilian, paramedic, thug, police.
- Stores max health, walk/run speed, default faction, combat ability, weapon damage, and perception.
- Perception includes vision range, field of view, hearing acuity, and reaction time.

`cart/hmsc/npc/factions.ts`

- Faction regard matrix.
- Factions: civilian, gang, police.
- Target column includes `player`.
- Regard values: hostile, wary, neutral, friendly.
- `isHostileTo` returns true only for hostile regard.

`cart/hmsc/npc/roles.ts`

- Open role registry.
- Roles include none, personOfInterest, target, informant, witness, contact.
- Role metadata includes HUD marker color token, hostile-on-sight override, objective flag, and interactions.
- Unknown roles fall back to `none`.

`cart/hmsc/npc/spawn.ts`

- Pure NPC factory and world mutation helpers.
- `createNpc` builds an `NpcState` from kind defaults plus id, position, optional faction, role, yaw, and source command.
- Adds stable gait phase offset by id so groups do not animate in lockstep.
- `addNpcToWorld`, `removeNpcFromWorld`, and `npcAt` mutate/read the `world.npcs` map immutably.

`cart/hmsc/npc/systems/chance.ts`

- Probabilistic hit model for NPC-to-player and NPC-to-NPC shots.
- Computes hit chance from range, cover fraction, target crouch, and shooter skill.
- Uses `Math.random` by default for `rollHit` and `rollZone`, but accepts injected RNG functions.
- Chooses landed shot zone from weighted damage zones.

`cart/hmsc/npc/systems/damage.ts`

- Applies resolved damage to NPC state.
- Joins two paths: geometric player aim hits and probabilistic zone shots.
- Uses humanoid zone multipliers from `render3d/humanoid`.
- Sets NPC posture to `down` at zero health.

## Labs

`cart/hmsc/labs/labDefinitions.ts`

- Defines in-cart labs: `scale`, `textures`, and `aim`.
- Each lab has a name, label, scene step, spawn position/yaw, and exit position/yaw.
- Provides validation and scene-step lookup helpers.

`cart/hmsc/labs/ScaleLabScene.tsx`

- Scene3D lab for physical scale.
- Renders player capsule, blocks, ledges, door frame, height lines, and ruler ticks.
- Uses `HMSC_SCALE`.
- JavaScript/React only, no host functions.

`cart/hmsc/labs/TextureLabScene.tsx`

- Scene3D material board for tile textures.
- Renders panels using texture keys from `HMSC_TILE_TEXTURE_KEYS`.
- Uses `textureKey` on `Scene3D.Mesh`.

`cart/hmsc/labs/AimLabScene.tsx`

- Scene3D aim lab with bottles and target selection.
- Computes an aim ray in JavaScript from gameplay camera context.
- Highlights the bottle under the crosshair when aiming.
- No host raycast; this lab uses JS vector math.

## UI and diagnostics

`cart/hmsc/ui/Console.tsx`

- Console panel UI.
- Renders quick-command buttons, command history, and `TextInput`.
- On submit calls the parent `onSubmitCommand`.
- Quick commands include help, HUD, sky/time/weather, lab commands, player location, cheats/noclip, state, save, and reset.

`cart/hmsc/render/Hud.tsx`

- GTA-style HUD overlay.
- Renders clock, money, armor, health, wanted stars, inventory item, minimap, and zone name flash.
- Minimap uses a WGSL `Effect` shader fed by a packed JavaScript float array.
- Minimap colors come from placeable swatches and `worldMarkers`.
- Smooths minimap center/yaw using `requestAnimationFrame` fallback to `setTimeout`.
- Uses `performance.now()` fallback to `Date.now()`.
- Listens to `hmsc:event:zone.entered` with `busOn`.

`cart/hmsc/render/DebugHud.tsx`

- Debug overlay for frame, render, input, player, camera, and world stats.
- Uses `useTelemetry` hook for fps, frame, gpu, nodes, and input data.
- Shows host physics microseconds from the drive loop.
- Reads movement surface from `movementSurfaceForPlayer`.

`cart/hmsc/tools/runWorldScript.ts`

- Headless seed-world placement auditor.
- Creates initial state and runs placement validation over seed buildings, props, and landforms.
- Writes to terminal through declared host function `__writeStderr`.
- Exits through declared host function `__exit`.
- Does not import renderer or command registry so it can run as a plain V8 CLI script.

## 3D renderer

`cart/hmsc/render3d/GameWorld3D.tsx`

- Main world renderer.
- Renders skybox, lights, floor regions, roads, junctions, placed cells, props, buildings, facades, part-textured faces, landforms, player, and scene children.
- Computes third-person camera position and target from player position, yaw, pitch, and aim state.
- Uses building and landform camera-hit helpers to pull the camera forward when occluded.
- Uses `Scene3D.Camera`, `Scene3D.Fog`, `Scene3D.Skybox`, and `Scene3D.Mesh`.
- Surface region floors are textured top-face slabs using `floorTextureKey(region.id)`.

`cart/hmsc/render3d/sky.ts`

- Pure sky model.
- Defines named hours and weather presets.
- Computes zenith, horizon, sun color, sun direction, ambient, directional light, fog, and background colors from hour, weather, and gloom.
- No host calls.

`cart/hmsc/render3d/materials.ts`

- Small material object factory layer.
- Defines `Glass`, `AutoGlass`, and `Storefront` material presets with transparency/breakable-style metadata.

`cart/hmsc/render3d/Building.tsx`

- Renders one placed building.
- Box buildings draw walls from the same `buildingBoxes` data used by physics.
- Interior buildings get a visible door panel.
- Open structures dispatch to custom structure components through `buildingCustomModel`.
- Also renders `BuildingWindows`.

`cart/hmsc/render3d/BuildingWindows.tsx`

- Adds glass panes to box buildings based on building skins, floors, and faces.
- Uses `Glass` material.
- Pure render logic.

`cart/hmsc/render3d/BuildingFacades.tsx`

- Legacy per-face building skin renderer.
- Adds thin textured panels over box building walls and roof.
- Resolves face skins with `resolveFaceSkin` and top skins with `resolveTopSkin`.
- Skips panels owned by newer `partTextures` to avoid z-fighting.
- Captures one StaticSurface per distinct `(skin, cols, floors)` bucket.
- Uses `StaticSurface` plus React facade UI from `buildingSkins.tsx`.

`cart/hmsc/render3d/buildingSkins.tsx`

- Defines 2D React facade skin renderers.
- Skins include office, residential, retail, industrial, internetCafe, gunShop, and mall.
- `plain` means no facade texture.
- Exposes grid sizing and texture-key helpers.

`cart/hmsc/render3d/buildingTransform.ts`

- Shared yaw/position helpers for buildings.
- Computes building yaw, center, rotated points around center, part placement, and anchored yaw.

`cart/hmsc/render3d/buildingModels.tsx`

- Dispatches open building kinds to custom model components.
- Maps parking garage, gas station, used car lot, and drive-in to their render components.

`cart/hmsc/render3d/structures/Car.tsx`

- Reusable car model for open structures.
- Builds a stylized car from Scene3D primitives.
- Uses deterministic color choice from structure data, not `Math.random`.

`cart/hmsc/render3d/structures/ParkingGarage.tsx`

- Renders parking garage structure.
- Uses `parkingGarageSpec` and `parkingGarageField`.
- Exports `parkingGarageParts` for the part-texture system.
- Uses heightfield mesh, deck, pillars, parapets, stripes, and cars.

`cart/hmsc/render3d/structures/GasStation.tsx`

- Renders gas station structure.
- Uses `gasStationSpec`.
- Exports `gasStationParts`.
- Draws canopy, store, pumps, signs, glass, and pillars.

`cart/hmsc/render3d/structures/UsedCarLot.tsx`

- Renders used car lot structure.
- Uses `usedCarLotSpec`.
- Exports `usedCarLotParts`.
- Draws kiosk, sign, pennants, cables, and cars.

`cart/hmsc/render3d/structures/DriveIn.tsx`

- Renders drive-in structure.
- Uses `driveInSpec` and `driveInScreenTextureKey`.
- Exports `driveInParts`.
- Draws screen wall, booth, marquee, poles, and live screen panel.

`cart/hmsc/render3d/driveInScreen.tsx`

- Offscreen capture path for drive-in screen textures.
- Uses `Video` primitive when a source is selected.
- Uses `StaticSurface` to capture a video/effect composition to `driveInScreenTextureKey`.
- Refreshes approximately 30 fps with `requestAnimationFrame` fallback to `setTimeout`.
- Reads current source through `getDriveInSource` and `useDriveInSources`.

`cart/hmsc/render3d/Road.tsx`

- Renders each road as one textured slab.
- Top face samples a road texture captured from WGSL.
- Uses `RoadSurfaceCaptures` to mount one `StaticSurface` per road.
- Road slab top matches the host physics road top.

`cart/hmsc/render3d/RoadJunctions.tsx`

- Renders intersections and cul-de-sacs as single textured slabs.
- Uses WGSL captures for intersection/cul-de-sac markings.
- Junction top is slightly above road slabs so markings cover overlaps.

`cart/hmsc/render3d/Landform.tsx`

- Renders each landform as a `Geometry.Heightfield`.
- Uses the same landform heightfield source that collider registration uses.
- Painted landforms use dynamic geometry keys so edits show live.
- Mountain decor adds crater lake water.
- Estate decor adds road ribbon mesh.
- Mounts natural, painted, water, and road-ribbon StaticSurface captures.

`cart/hmsc/render3d/heightfieldSurface.tsx`

- Captures per-cell tile paint for field-backed heightfields.
- Builds palette data from tile definitions and placeable colors.
- Uses WGSL Effect into StaticSurface.
- `roadRibbonSection` (shared by the editor's 2D chunk quads) ALWAYS emits its
  5-float header, segN=0 when empty (GHOSTROAD-0610): the Effect GPU data
  buffer never shrinks and the shader gates on `arrayLength`, so an omitted
  section left the previous ribbon alive in the buffer tail — deleted roads
  kept rendering as ghosts.

`cart/hmsc/render3d/tileSurface.tsx`

- Captures texture maps for rectangular surface regions.
- Defines `floorTextureKey(regionId)`.
- Uses WGSL Effect plus StaticSurface.
- Stabilizes data/style identities to avoid rebakes during camera/player frames.

`cart/hmsc/render3d/tileFill.ts`

- WGSL tile fill shader and material/variant ids for tile kinds.
- Provides procedural base textures for tile surfaces.

`cart/hmsc/render3d/roadFill.ts`

- WGSL road cross-section shader.
- Packs road profile data.
- Provides `roadTextureKey` and capture dimension helpers.

`cart/hmsc/render3d/roadTileFill.ts`

- Shader layer for road-tile-style fill.
- Extends tile fill with lane/marking colors.

`cart/hmsc/render3d/junctionFill.ts`

- WGSL shaders and data packing for intersections and cul-de-sacs.
- Provides `junctionTextureKey`.

`cart/hmsc/render3d/landformFill.ts`

- WGSL natural-blend shader for parametric landforms.
- Packs landform kind/material/style data.
- Provides `landformTextureKey` and capture dimension helpers.

`cart/hmsc/render3d/waterFill.ts`

- WGSL water texture shader.
- Provides `waterTextureKey`.

`cart/hmsc/render3d/roadRibbon.ts`

- Mesh definition and WGSL texture capture for landform road ribbons.
- Used by estate landforms.

`cart/hmsc/render3d/fillShader.ts`

- Large shared WGSL fill shader catalog used by texture recipes.
- Provides procedural material logic used by `game/textures/shaders.ts`.

`cart/hmsc-int/game/textures/shaders.ts` (MOVED — was `cart/hmsc/render3d/textureShaders.ts`, TEXPORT-0606: the texture pipeline lives behind hmsc-int's `game/textures` door now; raw WGSL sources `roadTileFill`/`fillShader` stay here with the W-2 fills)

- Texture recipe catalog.
- Defines shader params, variants, defaults, and groups.
- Includes road recipe plus many fill-board recipes.
- Includes the `cutout-stencil` recipe (CUTOUTQOL2-0605): a coarse 0/1 cell
  grid rendered fill-inside / background-outside (alpha 0 = the shape floats
  on transparency). The /cutout painter Materializes extracted cutouts into
  it (`editors/cutout/extraction.ts packStencilData` — the data layout is
  documented on the recipe and pinned by the route's P4 test); the slider
  form tunes a full tile of fill color.
- Exports `HMSC_SHADERS`, `shaderSpec`, and `shaderGroups`.

`cart/hmsc-int/game/textures/registry.tsx` (MOVED — was `cart/hmsc/render3d/textures.tsx`, TEXPORT-0606)

- Unified texture registry.
- Treats shader textures and React facade textures as one concept: a texture id that bakes to a StaticSurface and is sampled by `textureKey`.
- Hydrates custom saved materials through `game/textures/materials.ts`.
- Exports `TextureCapture`, `TEXTURE_REGISTRY`, `TEXTURE_IDS`, `allTextures`, and `textureById`.
- The legacy consumer `render3d/parts.tsx` imports it from hmsc-int (the V15 compile direction).

`cart/hmsc-int/game/textures/materials.ts` (MOVED — was `cart/hmsc/render3d/customTextures.ts`, TEXPORT-0606; export names, `custom:` ids, and the store key unchanged)

- Stored material layer for editor-authored textures.
- Reads/writes through `hmscStoreGet` and `hmscStoreSet`, which ultimately use host localstore/store functions.
- Emits `hmsc:custom-textures-changed` with `busEmit`.
- Subscribes with `busOn`.
- Stores records as `{id,label,shaderId,data}`.

`cart/hmsc/render3d/parts.tsx`

- General part-texture system.
- Defines `Part`: stable id, label, geometry, params, world position, rotation, scale, material, textured faces, texture grid, default texture key, and overlay flag.
- `TexturedParts` renders parts with resolved texture keys.
- `PartTextureCaptures` bakes one texture per distinct `(textureId, cols, floors)` bucket.
- This is the more general replacement/extension for box-only face skins.

`cart/hmsc/render3d/buildingParts.ts`

- Converts buildings into texturable `Part[]`.
- Box buildings produce front/back/left/right/top panels.
- Open structures delegate to structure-specific part exporters.
- Folds legacy per-face `skin` into part-texture ids for backwards compatibility.

`cart/hmsc/render3d/propParts.ts`

- Converts props into texturable `Part[]`.
- Currently only street signs expose texturable parts.

`cart/hmsc/render3d/PartCaptures.tsx`

- Mounts part texture captures for all building/prop part textures used in the world.
- Renders additive textured face panels for box buildings when `Building.partTextures` is present.

`cart/hmsc/render3d/Prop.tsx`

- Dispatches prop kind to prop model component.
- Handles rock variants, hydrants, signs, lights, bushes, stop signs, traffic lights, payphones, dumpsters, mailboxes, and fences.

`cart/hmsc/render3d/PropCaptures.tsx`

- Mounts prop-specific StaticSurface captures.
- Currently includes the street sign face capture.

`cart/hmsc/render3d/props/place.ts`

- Shared prop transform math.
- Adds vectors, rotates local coordinates by yaw, gets prop base, and places local points.

`cart/hmsc/render3d/props/signFace.tsx`

- 2D React texture for the street sign face.
- Defines `STREET_SIGN_TEXTURE_KEY`.
- Draws sign plate with Box/Text primitives.

`cart/hmsc/render3d/props/StreetSign.tsx`

- Renders street sign model.
- Exports `streetSignParts` for part texturing.
- Uses `TexturedParts` and a default sign-face texture key.

`cart/hmsc/render3d/props/StopSign.tsx`

- Renders stop sign model with pole and octagonal sign.

`cart/hmsc/render3d/props/TrafficLight.tsx`

- Renders traffic light.
- Uses `trafficClockSeconds` and `trafficSignalPhase`.
- Refreshes display with `setInterval` every 250 ms.
- TRAFFIC-HEAD-0610 (user report): the mast arm cantilevers sideways (+X)
  with the lamp head at its end facing -Z at yaw 0 — the lamp's look
  direction IS the approach `world/traffic.ts` gates. The compiled-geometry
  mirror lives in `cart/hmsc-int/compile/worldGeometry.ts`.

`cart/hmsc/render3d/props/StreetLight.tsx`

- Renders street light model.

`cart/hmsc/render3d/props/FireHydrant.tsx`

- Renders fire hydrant model.

`cart/hmsc/render3d/props/Payphone.tsx`

- Renders payphone model.

`cart/hmsc/render3d/props/Dumpster.tsx`

- Renders dumpster model.

`cart/hmsc/render3d/props/Mailbox.tsx`

- Renders mailbox model.

`cart/hmsc/render3d/props/Fence.tsx`

- Renders fence segment model.

`cart/hmsc/render3d/props/Rock.tsx`

- Renders rock/boulder variants.

`cart/hmsc/render3d/props/Bush.tsx`

- Renders bush variants from deterministic blob layout.

`cart/hmsc/render3d/PlayerFigure.tsx`

- Renders player humanoid by solving a humanoid rig from movement state.
- Uses `drivePose`, `solveHumanoid`, `Figure`, `PLAYER_PALETTE`, and `PLAYER_FACE_KEY`.

`cart/hmsc/render3d/NpcFigure.tsx`

- Renders NPC humanoids from NPC drive data.
- Solves an NPC rig and uses `npcPalette` and `npcFaceKey`.

`cart/hmsc/render3d/humanoid/index.ts`

- Barrel export for humanoid pose, skeleton, figure, palette, face, and hitbox systems.

`cart/hmsc/render3d/humanoid/pose.ts`

- Defines humanoid pose values.
- `drivePose(animationSeconds, moving, running)` computes gait animation.

`cart/hmsc/render3d/humanoid/skeleton.ts`

- Single source of truth for humanoid mesh parts and hit capsules.
- Solves body pose into render parts, damage-zone capsules, and eye point.
- Supports optional face texture key on the head.
- Keeps hitboxes and rendered body aligned because both come from the same solve.

`cart/hmsc/render3d/humanoid/Figure.tsx`

- Renders a solved humanoid rig.
- Maps rig material slots to a palette.
- Uses `Scene3D.Mesh` primitives.

`cart/hmsc/render3d/humanoid/palette.ts`

- Defines player and NPC palettes.
- Hashes NPC id to a stable palette.

`cart/hmsc/render3d/humanoid/face.tsx`

- 2D React face texture system.
- Bakes face presets through StaticSurface.
- Supports player preset face, image source, or live camera render source.
- Bakes all NPC palette/feature combinations so each `npcFaceKey(id)` exists.
- Uses ReactJIT `Image`, `Render`, and `StaticSurface`, not browser image APIs.

`cart/hmsc/render3d/humanoid/hitbox.ts`

- Geometric raycast path for player aim against NPC humanoids.
- Ray-tests solved rig capsules and returns nearest hit zone.
- Defines damage multipliers for head, torso, arms, and legs.

## Host and JavaScript boundary

Direct or hook-mediated host functions used by HMSC:

- `__localstoreGet(namespace, key)`: preferred HMSC store read in `state/gameState.ts`.
- `__localstoreSet(namespace, key, value)`: preferred HMSC store write in `state/gameState.ts`.
- `__store_get(key)`: fallback store read.
- `__store_set(key, value)`: fallback store write.
- `__hot_get(key)`: hot reload state read.
- `__hot_set(key, value)`: hot reload state write.
- `__hmsc_physics_step(input)`: host physics step.
- `__hmsc_clear_heightfields()`: clear registered terrain colliders.
- `__hmsc_register_heightfield(...)`: register terrain/structure heightfield.
- `__mouse_delta()`: relative mouse delta for camera.
- `__mouse_capture(1|0)`: host mouse capture toggle.
- `getMouseRightDown()`: host right mouse button state.
- `getMouseX()` and `getMouseY()`: host absolute mouse position fallback.
- `isKeyDown(scancode)`: host scancode key state.
- `__tel_history(n)`, `__tel_frame()`, `__tel_gpu()`, `__tel_nodes()`, `__tel_input()`: telemetry reads.
- `__hmsc_spike_trace(1|0)`: host-side spike tracing.
- `__writeStderr(text)`: headless audit terminal output.
- `__exit(code)`: headless audit exit code.

ReactJIT hook bridges used:

- `busOn`: low-level event subscription for keyboard, zone HUD, and custom texture changes.
- `busEmit`: game-event and custom-texture publishing.
- `useIFTTT`: story/event rules.
- `useTelemetry`: debug HUD telemetry polling.
- `execAsync`: process execution for `zenity --file-selection`.

JavaScript runtime APIs used:

- `setInterval`: root autosave/live/sky loops and traffic-light refresh.
- `setTimeout`: fallback frame scheduling and UI timers.
- `requestAnimationFrame`: camera, drive loop, minimap smoothing, drive-in refresh, perf watch when present.
- `performance.now()`: frame timing when available.
- `Date.now()`: timing fallback and ids.
- `Math.random()`: console entry ids and default NPC chance rolls.

Browser APIs not used:

- No `document`.
- No `window`.
- No `fetch`.
- No `localStorage`.
- No DOM event listeners.

## Glossary

`GameState`

- The single JSON-serializable state object for the cart.
- Contains scene, config, command flags, story, event log, player, world, entity serial, and suspended interior worlds.

`sceneStep`

- String that selects the active scene mode, such as `boot.console`, `lab.scale`, `lab.textures`, `lab.aim`, or `interior.<id>`.

`WorldState`

- The authored and live world container inside `GameState`.
- Contains surface regions, placed cells, roads, junctions, props, buildings, interiors, landforms, zones, spawned entities, and NPCs.

`surfaceRegion`

- Large rectangular base surface chunk.
- Rendered as one textured floor slab.
- Used by world tree and minimap as chunk/base-kind data.

`placedCell`

- Sparse explicit grid cell overlay.
- Can hold tile kind, trigger command, trigger label, spawn/save pairing, and command provenance.

`cell`

- Integer grid position.
- One cell equals one meter in x/z.

`continuous position`

- Meter-space position for player, entities, NPCs, props, buildings, roads, and landforms.

`command`

- Stable user/tool interface for mutation.
- Console, triggers, interactions, labs, and authoring operations all use commands.

`triggerCommand`

- Command string stored on a placed cell.
- Runs when the player enters the cell outside labs.

`event`

- Typed gameplay fact stored in `GameState.events.recent` and published to bus channels.

`story flag`

- Key/value state updated by event rules.
- Used as the early story condition system.

`lab`

- In-cart test scene entered with `lab_spawn`.
- Uses the same gameplay rig instead of a separate cart entrypoint.

`tile kind`

- Registry id defining traversability, cover, visibility, NPC behavior, surface material, render color, and altitude behavior.

`textureKey`

- Runtime key sampled by Scene3D meshes.
- HMSC generates many texture keys from StaticSurface captures.

`StaticSurface`

- Offscreen 2D surface captured by the host into a texture.
- Used for floors, roads, junctions, building facades, part textures, props, faces, landforms, water, and drive-in screens.

`Effect`

- WGSL shader primitive used to generate procedural 2D textures and minimap pixels.

`texture registry`

- Unified list in `cart/hmsc-int/game/textures/registry.tsx` (TEXPORT-0606 — moved behind the captured ground floor's door).
- A texture can be authored by WGSL shader or React UI, but downstream it is just an id that bakes to a texture key.

`part`

- Texturable mesh descriptor with stable id, label, geometry, transform, material, and texture metadata.
- Used by buildings, open structures, and props.

`partTextures`

- Per-object map of `partId -> textureId`.
- Stored on `Building` and `WorldProp`.

`building skin`

- Legacy per-face facade skin for box buildings.
- Folded into part-texture ids for compatibility.

`open structure`

- Building kind with a custom structure model instead of simple box walls.
- Examples: parking garage, gas station, used car lot, drive-in.

`interior`

- Separate `WorldState` swapped in when entering an interior building.
- Outer world is pushed onto `suspendedSpaces`.

`landform`

- Parametric or painted heightfield terrain object.
- Provides render mesh, ground height, tile kind, camera collision, and host heightfield collider.

`heightfield`

- Grid of heights used for terrain rendering and host terrain collision.

`road profile`

- Lane/sidewalk/bike-lane description used by road physics, rendering, and pathing.

`junction`

- Intersection or cul-de-sac road object.
- Renders and collides separately from road segments.

`zone`

- Named rectangular area with flags.
- Emits enter/exit events and can run zone commands.

`NPC kind`

- Closed registry of what an NPC is: civilian, paramedic, thug, police.

`NPC faction`

- Combat allegiance axis: civilian, gang, police.

`NPC role`

- Open mission/social meaning axis: target, informant, witness, contact, etc.

`humanoid rig`

- Solved render parts plus hit capsules from one skeleton pose.
- Used for both drawing and player aim hit detection.

`host physics`

- Zig-side movement/collision solver called from JS with packed Float32Array input.
- JS fallback exists only for simple player x/z movement.

## Recurring concepts to watch across other carts

- Command-first mutation.
- One JSON state object.
- Grid authoring plus continuous movement.
- Scene step instead of separate cart entrypoints.
- StaticSurface texture capture as a shared render primitive.
- Texture id as one concept, independent of shader-vs-React authoring.
- Registry-driven kinds for tiles, buildings, props, NPCs, roles, and landforms.
- Separate pure data model from JSX render components.
- Host functions for persistence, physics, input, telemetry, and process/CLI boundaries.
- Event bus channels as story and UI integration points.
- Placement validation as a reusable authoring safety pass.
- Shared map/read models instead of per-view duplicate derivation.
