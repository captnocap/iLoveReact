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
  world/grid.ts          grid storage helpers over continuous movement
  world/scale.ts         canonical meter scale for players, rooms, vehicles, city blocks
  world/tileKinds.ts     typed tile definitions for rendering, pathing, cover, doors, visibility, traversal, and surfaces
  world/buildingKinds.ts typed building definitions (footprint, storeys, wall tile borrow, default enclosure, facade)
  world/buildings.ts     building footprint/box geometry + physics rects (one geometry source for physics and render)
  world/interiors.ts     closed-building interiors: the mini-world per building + the enter/leave world-swap portal
  world/pathing.ts       grid pathfinder over tile-kind NPC traversal metadata
  render3d/sky.ts       analytic skybox model from skybox_demo
  state/usePlayerDrive.ts   continuous third-person movement over the grid
  state/hostPhysics.ts      typed-buffer bridge to the host physics step
  input/controlContract.ts  canonical player input contract
  world/noiseModel.ts       surface and movement noise multipliers
  ui/Console.tsx         command terminal

cart/hmsc-int/
  index.tsx              internal map tooling shell
```

## State Model

The whole game state is one JSON object. The cart stores it through host storage
and mirrors it into hot state after every command. Autosave runs on a timer.
The game can publish compact live player snapshots for future internal tools
without turning movement frames into autosaves.

Tunable gameplay defaults live in `state/defaults.ts` and runtime tuning lives
inside `GameState.config`. Use `gv_config` for config-specific inspection or
mutation. Player speed remains in `GameState.player` and is changed through
`pv_speed`. Sky time, weather, gloom, and day-cycle speed live under
`GameState.config.sky` and are surfaced through dedicated `gv_*` sky commands.

World construction is grid-locked: cell keys, chunk keys, placed cells. Player
and spawned entities move in continuous coordinates on top of the grid. No
generated map is currently mounted by default; the large-map storage contract
must be clarified before a new authored map is added.

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
  Space jump, E/F interact (enter/leave closed buildings).
- Reserved: attack, light action, reload, quick menu, crouch.

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
- `wv_fill <kind> <x> <z> <width> <depth> [y]` — fill a rectangle as one surface
  region (chunk-native). The chunk painter in `cart/hmsc-int` emits these.
- `wv_remove <x> <z> [y]`
- `wv_trigger <x> <z> [y] [command...|off]`
- `wv_path <fromX> <fromZ> <toX> <toZ> [y] [pedestrian|runner|vehicle]`
- `wv_building [kinds] | wv_building <kind> <x> <z> [enclosure] [w] [d] [doorSide]`
- `wv_enter <buildingId>`
- `wv_leave`
- `wv_zone [name x z w d [flags...]] | wv_zone remove <id>` — define a named area;
  walking in flashes its name (GTA-style) and fires `zone.entered`. Flags:
  `private`, `safe`, `hostile`, `restricted`, `interior`. Zones show on the
  minimap (tint) and the internal map (outline + name).


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

Stable tile texture keys live in `world/tileTextureKeys.ts`. The previous 3D
capture/render path was removed during the map reset, so texture capture should
not be rebuilt until the map and renderer contracts are clear.

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

## Buildings

A building is a first-class world layer (peer of roads/junctions/props), not a
field of tiles. Each is an axis-aligned footprint anchored at its min-corner;
its solid mass is a set of boxes that feed BOTH host physics (as blocking rects)
and the renderer (as wall meshes) from one geometry source (`world/buildings.ts`),
so the wall you see is exactly the wall you collide with. Definitions live in
`world/buildingKinds.ts`: footprint, storeys → height, the `wall` tile bundle the
mass borrows for cover/line-of-sight/friction, default enclosure, and facade.

The three building types are one `enclosure` field:

- `sealed` — static, no entry. A solid block: bump it from the side, stand on
  the roof (the standable-solids host rule). No door, no interior.
- `hollow` — a walk-in shell. The door side is a real gap and the floor inside
  is the SAME outer world, so you see in from outside and out from inside. No
  loading, no scene change — one continuous space.
- `interior` — closed. The exterior is a sealed shell with a door. Walk up to it
  and a **Press E to enter** prompt appears (proximity-based, `useBuildingInteract`);
  E swaps the player into a separate interior mini-world that can be far larger
  than the exterior footprint. Inside, **Press E to leave** returns you outside.
  A walk-on door mat firing `wv_enter`/`wv_leave` is the same path for NPCs and
  as a fallback; the console commands `wv_enter <id>` / `wv_leave` do it too.

A closed building's interior is its own `WorldState` (`world/interiors.ts`):
entering pushes the outer world onto a suspend stack and swaps `state.world` to
the interior, so the existing renderer and host-physics path draw and simulate
it with no special casing. The interior's size is independent of the footprint —
that is the "bigger inside than out" knob (`INTERIOR_FOOTPRINT_SCALE`).

A fresh world seeds one of each near spawn (east of the arterial, south of the
cross street): a sealed house, a hollow shop, and an interior tower. Author more
with `wv_building`; `wv_building kinds` lists the kinds.
