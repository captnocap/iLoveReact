# HMSC - Blank Game Shell

HMSC means Hitman Shitcity.

Build the game with:

```sh
./tools/rjit ship hmsc
```

The game cart deliberately renders a blank play surface with a console drop
down. Internal map tooling is a separate cart:

```sh
./tools/rjit ship hmsc-int
```

The first product surface is still the console. It can mutate every meaningful
part of the game state, giving development the same power shape as a classic
engine console or an ultimate mod menu: commands are the stable interface, while
UI, tools, and hotloops call into the same path.

Command names are domain-prefixed. There are no unprefixed legacy aliases.

- `cmd_*`: console and command-system meta commands
- `gv_*`: game/global state and configuration
- `pv_*`: player variables and player-state mutations
- `wv_*`: world/grid/map variables and mutations
- `ev_*`: spawned entity variables and mutations
- `lab_*`: in-cart lab selection and lab workflow
- `a_*`: audio configuration and audio-state mutations

## Architecture

```
cart/hmsc/
  index.tsx              composition root
  design.ts              JSON game-state contract
  state/defaults.ts      named gameplay tuning defaults
  state/gameState.ts     create/load/save/revive GameState
  gameplay/              shared camera, drive, render, HUD gameplay rig
  labs/                  lab definitions and in-cart lab scene add-ons
  commands/              parser + command registry
  events/                typed game event recording + story IFTTT rules
  world/masterLayout.ts  map root -> zones -> nested lab building placements
  world/demoMap.ts       one authored seed map shared by game + internal map
  world/grid.ts          grid storage helpers over continuous movement
  world/scale.ts         canonical meter scale for players, rooms, vehicles, city blocks
  world/tileKinds.ts     typed tile definitions for rendering, pathing, cover, doors, visibility, traversal, and surfaces
  world/pathing.ts       grid pathfinder over tile-kind NPC traversal metadata
  render3d/GameWorld3D.tsx  3D renderer over GameState.world
  render3d/sky.ts       analytic skybox model from skybox_demo
  render3d/tileTextures.tsx procedural texture captures for tile materials
  render3d/PlayerFigure.tsx animation_lab drive-mode figure
  state/usePlayerDrive.ts   continuous third-person movement over the grid
  state/hostPhysics.ts      typed-buffer bridge to the host physics step
  input/controlContract.ts  canonical player input contract
  world/noiseModel.ts       surface and movement noise multipliers
  ui/Console.tsx         command terminal

cart/hmsc-int/
  index.tsx              internal map tooling shell
  MapCanvas.tsx          2D Canvas renderer over the same GameState.world
```

## State Model

The whole game state is one JSON object. The cart stores it through host storage
and mirrors it into hot state after every command. Autosave runs on a timer.
The game also publishes a compact live player snapshot so `hmsc-int` can track
the player marker without turning movement frames into autosaves.

Tunable gameplay defaults live in `state/defaults.ts` and runtime tuning lives
inside `GameState.config`. Use `gv_config` for config-specific inspection or
mutation. Player speed remains in `GameState.player` and is changed through
`pv_speed`. Sky time, weather, gloom, and day-cycle speed live under
`GameState.config.sky` and are surfaced through dedicated `gv_*` sky commands.

World construction is grid-locked: cell keys, chunk keys, placed cells. Player
and spawned entities move in continuous coordinates on top of the grid.
Large floor materials are stored as rectangular `surfaceRegions`; authored
objects like lab buildings and doors are stored as `placedCells`. This keeps the
1200x1200 starter map from becoming 1.44 million serialized floor cells.

## Scale

The canonical scale lives in `world/scale.ts`.

- 1 tile = 1 meter
- player capsule = 1.65m tall
- normal visual human = 1.7-2.0m, with stylized hats allowed above that
- door = 1m wide x 2.4m tall
- floor/story = 3m
- car = 4m x 2m x 1.5m
- bus = 11m x 2.5m x 3.2m
- small room = 4m x 4m
- bedroom = 3m x 4m
- shop interior = 8m x 10m
- small house footprint = 8m x 10m
- city block = 40-80m

## Control Contract

The canonical control vocabulary lives in `input/controlContract.ts`.

- Mouse move: camera look/orbit
- Right mouse hold: aim over shoulder
- Left mouse while aiming: fire / attack / throw
- Left mouse not aiming: optional light action, punch, select, or nothing
- E / F: interact
- R: reload
- Q / Tab: item wheel / phone / quick menu
- Shift: run
- Space: jump / mantle
- Ctrl / C: crouch

Current implementation status:

- Implemented: mouse camera orbit, right-hold shoulder aim/crosshair, Shift run,
  Space jump.
- Reserved: attack, light action, interact, reload, quick menu, crouch.

## Noise Model

The stealth/audio noise contract lives in `world/noiseModel.ts`. Tile kinds map
to these material multipliers, then movement modes multiply that result.

Material multipliers:

- Carpet: 0.35
- Grass: 0.55
- Dirt: 0.70
- Concrete: 1.00
- Wood floor: 1.25
- Gravel: 1.60
- Metal grate: 1.80
- Broken glass/trash: 2.20
- Water shallow: 2.50

Movement modes:

- Creep/walk: 0.25-0.40 continuous
- Jog: 1.00 continuous
- Sprint: 2.25-3.00 continuous
- Jump/land: material-dependent burst event, not continuous noise
- Mantle/climb: material-dependent short burst

## Sky Cycle

The skybox is state-backed, not a renderer constant. `GameState.config.sky.hour`
stores the current 0-24 game hour, and the game clock advances it while
`dayCycleEnabled` is on. Weather is a 0-1 overcast blend, and gloom is a 0-1
green/dark pall blend.

Sky commands:

- `gv_sky`
- `gv_time [0-24|midnight|dawn|noon|dusk]`
- `gv_daycycle [1|0] [hours-per-real-minute]`
- `gv_weather [clear|hazy|cloudy|storm|0-1] [gloom 0-1]`

The current host skybox path is still using HMSC's seam-safe color mode until
the diagonal split in high-contrast gradients is fixed lower in the renderer.

## Starter Commands

- `cmd_help [command]`
- `cmd_cheats <1|0>`
- `lab_list`
- `lab_spawn <name>`
- `lab_exit`
- `gv_controls`
- `gv_noise`
- `gv_sky`
- `gv_time [0-24|midnight|dawn|noon|dusk]`
- `gv_daycycle [1|0] [hours-per-real-minute]`
- `gv_weather [clear|hazy|cloudy|storm|0-1] [gloom 0-1]`
- `gv_events [count] [type-filter]`
- `gv_emit <type> [json-payload]`
- `gv_state [path]`
- `gv_config [path] [value]`
- `gv_save`
- `gv_load`
- `gv_reset`
- `gv_scene <step>`
- `gv_set <path> <value>`
- `pv_noclip <1|0>`
- `pv_teleport <x> <z> [y]`
- `pv_speed <walk|run> <value>`
- `pv_where`
- `ev_spawn <kind> [x] [z] [y]`
- `ev_burst [count]`
- `ev_despawn <entityId>`
- `wv_place <kind> <x> <z> [y]`
- `wv_remove <x> <z> [y]`
- `wv_trigger <x> <z> [y] [command...|off]`
- `wv_path <fromX> <fromZ> <toX> <toZ> [y] [pedestrian|runner|vehicle]`

## Map Layout

The starter map is authored in `world/masterLayout.ts` as:

`master layout -> zones -> nested lab building placements -> door cells`.

The current layout is a 1200x1200 water-surrounded district sketch split into
three islands. Blue residential regions are normal city blocks, red downtown
regions are denser/high-activity blocks, green mixed regions sit between those
two densities, and sand regions mark beaches/causeways. Lab buildings are
spread across the islands as authored placements rather than being hard-coded in
the renderer.

## Lab Buildings

Labs are in-world easter egg interiors. A placed cell can carry a
`triggerCommand`, and the player drive loop fires that command once when the
player enters the cell. The starter map currently includes:

- `Human Measurement Standards Council`: door trigger `lab_spawn scale`
- `HMSC Materials Annex`: door trigger `lab_spawn textures`
- `HMSC Coastal Range`: door trigger `lab_spawn aim`

Use `wv_trigger` to inspect or author door triggers:

```sh
wv_trigger 6 -1
wv_trigger 6 -1 lab_spawn scale
wv_trigger 6 -1 off
```

Saved states from before the lab-building pass will not have these starter
door triggers until you run `gv_reset` or author them with `wv_trigger`.

## Game Events

Game events are the story and diagnostics surface. HMSC records recent events in
`GameState.events.recent`, mirrors every event to the host event bus, and emits
`useIFTTT` channels for gameplay rules.

Channel shape:

- `hmsc:event`: every HMSC event
- `hmsc:event:<type>`: one event type, such as `hmsc:event:lab.entered`
- `hmsc:actor:<kind>:<id>`: events by actor
- `hmsc:subject:<kind>:<id>`: events by subject
- `hmsc:tag:<tag>`: events by tag

Use `gv_events` for the in-state recent ring. The deeper trace is owned by the
runtime event bus, so player movement, NPC behavior, commands, world triggers,
and story rules have a shared audit trail instead of private logs.

## Tile Textures

HMSC tile textures are procedural Effect fills captured once through
`StaticSurface`, then sampled by `Scene3D.Mesh textureKey`. Stable texture keys
live in `world/tileTextureKeys.ts`; render-time capture sources live in
`render3d/tileTextures.tsx`.

The current material set covers every `TileKind`; no `solid.*` placeholder
texture keys remain in tile render metadata.

- `hmsc.tile.water`
- `hmsc.tile.residential`
- `hmsc.tile.downtown`
- `hmsc.tile.mixed`
- `hmsc.tile.road`
- `hmsc.tile.asphalt`
- `hmsc.tile.sidewalk`
- `hmsc.tile.mud`
- `hmsc.tile.sand`
- `hmsc.tile.wall`
- `hmsc.tile.door`
- `hmsc.tile.marker`

Use `lab_spawn textures` to inspect the current tile material board inside the
real gameplay rig.
