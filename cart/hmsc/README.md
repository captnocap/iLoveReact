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

## Console Command Taxonomy

The command registry in `commands/registry.ts` is the source of truth. Use
`cmd_help` to list the live registry and `cmd_help <command>` for the exact
usage string. The current registry has 46 commands.

Command arguments are split on whitespace, with single and double quotes for
multi-word tokens. Value arguments accepted by `gv_set`, `gv_config`, and
`gv_emit` parse `true`, `false`, `null`, numbers, JSON objects, and JSON arrays
before falling back to strings.

### `cmd_*`: console and command system

- `cmd_help [command]` - list commands or inspect one command.
- `cmd_cheats <1|0>` - enable or disable cheat-gated commands. Turning cheats
  off also forces player noclip off.

### `lab_*`: in-cart lab workflow

- `lab_list` - list labs available inside this cart.
- `lab_spawn <name>` - enter a lab through the shared gameplay rig.
- `lab_exit` - leave the active lab and return to the normal game scene.

### `gv_*`: game/global state, config, diagnostics, and systems

- `gv_controls` - print the canonical HMSC input contract.
- `gv_debug_hud [1|0|toggle]` - toggle the live gameplay diagnostics overlay.
- `gv_perflog [1|0|toggle] [spikeRatio] [minJumpMs]` - toggle the
  spike-triggered perf flight recorder.
- `gv_noise` - print material and movement noise multipliers.
- `gv_view [radius-meters] [fogNear] [fogFar]` - inspect or set draw radius and
  fog distances.
- `gv_sky` - print current sky clock and weather config.
- `gv_time [0-24|midnight|dawn|noon|dusk]` - inspect or set sky time of day.
- `gv_daycycle [1|0] [hours-per-real-minute]` - enable, disable, or retime the
  day-night cycle.
- `gv_weather [clear|hazy|cloudy|storm|0-1] [gloom 0-1]` - inspect or set sky
  weather/gloom.
- `gv_events [count] [type-filter]` - print recent HMSC game events from the
  state ring.
- `gv_emit <type> [json-payload]` - emit a typed HMSC game event for story or
  debug wiring.
- `gv_state [path]` - print the full `GameState` or a dot path.
- `gv_config [path] [value]` - print or set a path under `GameState.config`.
- `gv_save` - persist the current `GameState`.
- `gv_load` - load the persisted `GameState`.
- `gv_reset` - reset to a fresh scaffold state.
- `gv_scene [step]` - inspect or set the current scene step.
- `gv_set <path> <value>` - set any `GameState` dot path to a JSON-ish value.

### `pv_*`: player variables and player state

- `pv_teleport <x> <z> [y]` - move the player in continuous world space.
- `pv_noclip <1|0>` - enable or disable player noclip movement. Requires
  `cmd_cheats 1` when enabling.
- `pv_speed <walk|run> <value>` - set player walk or run speed.
- `pv_where` - print continuous player position and current grid cell.

### `ev_*`: spawned entities and host-physics bodies

- `ev_spawn <kind> [x] [z] [y]` - spawn an entity at continuous coordinates.
- `ev_burst [count]` - spawn a cluster of host-physics test bodies around the
  player.
- `ev_despawn <entityId>` - remove a spawned entity.

### `wv_*`: grid cells, tiles, triggers, and pathing

- `wv_tile [kind]` - list tile kinds or inspect tile metadata for cover, doors,
  visibility, traversal, and surface physics.
- `wv_place <kind> <x> <z> [y]` - place a world cell on the construction grid.
- `wv_fill <kind> <x> <z> <width> <depth> [y]` - fill a rectangle as one
  chunk-native surface region. The chunk painter in `cart/hmsc-int` emits
  these.
- `wv_remove <x> <z> [y]` - remove a placed world cell.
- `wv_trigger <x> <z> [y] [command...|off]` - inspect, set, or clear an
  enter-cell command trigger.
- `wv_path <fromX> <fromZ> <toX> <toZ> [y] [pedestrian|runner|vehicle]` - find
  a typed-tile grid path between two cells.

### `wv_*`: roads and junctions

- `wv_road` - list roads, lay a road, or remove one. Usage:
  `wv_road [x z length [ns|ew] [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0]]`
  or `wv_road remove <id>`.
- `wv_intersection` - lay or remove a four-way intersection. Usage:
  `wv_intersection <x> <z> [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0]` or
  `wv_intersection remove <id>`.
- `wv_culdesac` - lay a cul-de-sac turnaround bulb or remove a junction by id.
  Lay usage starts with `wv_culdesac <centerX> <centerZ> <bulbRadius>` and can
  add `[throat n|s|e|w]`, `[lanesPerDir 1|2]`, `[bike 1|0]`, and
  `[sidewalks 1|0]`. Remove usage: `wv_culdesac remove <id>`.

### `wv_*`: props and traffic control

- `wv_prop` - list props, list prop kinds, place a prop, or remove one. Usage:
  `wv_prop [kinds]`, `wv_prop <kind> <x> <z> [yawDeg] [y]`, or
  `wv_prop remove <id>`.
- `wv_signal [id] [stop|caution|go|auto]` - inspect traffic-control props or
  pin/clear a signal phase for vehicle pathing tests.

### `wv_*`: buildings, interiors, terrain, and zones

- `wv_building` - list buildings, list building kinds, place a building, or
  remove one. Usage: `wv_building [kinds]`, or start placement with
  `wv_building <kind> <x> <z>` and optionally add `[enclosure]`, `[w]`, `[d]`,
  and `[doorSide n|s|e|w]`. Remove usage: `wv_building remove <id>`.
- `wv_enter <buildingId>` - enter a closed `interior` building.
- `wv_leave` - leave the current building interior.
- `wv_mountain | wv_mountain trailhead [id]` - list mountains or teleport to a
  trailhead.
- `wv_zone [name x z w d [flags...]] | wv_zone remove <id>` - define, list, or
  remove a named area. Walking in flashes its name and fires `zone.entered`.
  Flags: `private`, `safe`, `hostile`, `restricted`, `interior`. Zones show on
  the minimap and the internal map.

### `a_*`: audio state

No `a_*` commands are registered yet.


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

### Textured box faces

A `Geometry.Box` carrying a `textureKey` textures **every face** unless told
otherwise, so a thin box (a sign edge, a slab side) stretches the whole capture
sideways onto faces that should never show it. Every textured box in this cart
declares `texturedFaces` — the faces that actually carry the texture; undeclared
faces pin their UVs to the capture's `(0,0)` corner texel and read as one flat
color. The mechanism lives in `@reactjit/geometries` Box
(`texturedFaces?: BoxFace[]`); the convention is enforced here per `AGENTS.md`.

- Flat slabs (road, junction, floor, crater water): `['top']`.
- Upright panels (street sign, building facade wall): the two broad faces —
  `['front','back']` or `['left','right']` by orientation.
- A capture's `(0,0)` corner should be the intended edge color (e.g. the street
  sign's green background) so the flat-face fallback reads cleanly.

## Buildings

A building is a first-class world layer (peer of roads/junctions/props), not a
field of tiles. Each carries a collision-free `id` (`world/idgen.ts` walks to the
first unused `building_user_N` instead of the old `length+1`, which reissued a
live id after a removal) — so a building can be loaded by id from the internal
tool. Each is an axis-aligned footprint anchored at its min-corner;
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

A fresh world seeds four near spawn (east of the arterial, south of the cross
street): a sealed house, a hollow shop, an interior tower, and a sealed
warehouse (the taller garage). Author more with `wv_building`; `wv_building
kinds` lists the kinds and `wv_building skins` the skins.

### Skins (facade appearance)

A building's look is a **separate axis from its kind** (size/physics): any
footprint can wear any skin. A skin is a 2D facade — windows, signage, an
address — laid out with `Box`/`Text`, captured to a GPU texture, and mapped onto
the wall faces as thin panels (the `billboard_demo` / `tileSurface` pattern). The
catalog lives in `render3d/buildingSkins.tsx` (a `BUILDING_SKINS` registry, the
appearance peer of `buildingKinds`); panels + captures are in
`render3d/BuildingFacades.tsx`.

- Skins: `plain` (bare wall, no panel), `office` (glass curtain grid), `residential`
  (brick + balconies + address), `retail` (storefront awning + sign), `industrial`
  (corrugated metal + roller door). `wv_building <kind> <x> <z> ... [skin]`, or a
  kind's default skin (house→residential, shop→retail, tower→office,
  warehouse→industrial).
- **Per-face skins:** `skin` can be a single skin (all walls) or a per-face map
  `{ front, back, left, right, top, all }`. Roles are relative to facing — `front`
  is the door side, `top` is the roof. So a warehouse wears its garage on the
  front and plain walls on the sides (the seeded one does), and you can drop a
  billboard/doorway on one side or the roof. Author live with
  `wv_building face <id> <front|back|left|right|top|all> <skin>`, or visually in
  the `hmsc-int` BUILDING FACES panel — click a footprint to load it by id, pick
  a skin per face, and it emits exactly those `wv_building face` commands.
- One texture is shared per `(skin, cols, floors)` bucket (windows sized ~3m), so
  a street of offices is a handful of bakes, not one per building. Captures are
  memoized exactly like `tileSurface` to avoid the per-frame re-bake trap.
- **Dynamic perception (surface only, not yet live):** the skin render context
  carries `player.perception` (a 0–1 `high` channel) so a future slice can have
  a skin scramble its text or swap a wall to a live plasma `Effect` based on
  player state. The static catalog accepts but ignores it; turning it on is a
  per-skin change that adds a perception bucket to that skin's texture key.

### Placement rules

`wv_building` placements are kept city-sane by `world/buildingPlacement.ts`:

- **No overlap** with another building (edge-to-edge touching is allowed) and
  never sitting on a road — both reject.
- **Must be near a road** (≤ `MAX_ROAD_DISTANCE_METERS`, ~18m) or it reads as
  sparse and is rejected.
- **Door auto-snaps** to face the nearest road, so you place by position and the
  entrance orients itself — no one thinks about facing.
- **`force`** (a trailing arg) bypasses all of it: keeps your given door side and
  skips the overlap/road checks, for intentional/sandbox placement.

The seeded block obeys these — a row down the east side of the spawn arterial,
doors facing the road. Authored seed buildings are laid to comply directly;
the rules gate console placement (and any future generator).
