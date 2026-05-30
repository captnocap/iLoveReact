# AGENTS.md - HMSC

HMSC is the game cart for Hitman Shitcity. Ship it with `./tools/rjit ship hmsc`.
For fast local verification without self-extractor packaging, use
`SHIP_RUN_PACKAGE=0 ./tools/rjit ship hmsc`.
This cart starts from a blank game surface and a command console, not from
internal tooling.

Read before changing code:

1. Root `AGENTS.md` for runtime and repo discipline.
2. `README.md` for this cart's architecture.
3. `design.ts` for the serializable game-state contract.

## Prime Rule

Every game mutation is a command.

The console is not a debug afterthought. It is the first-class surface for
building, testing, and later modding the game: `pv_teleport`, `ev_spawn`,
`wv_place`, `wv_remove`, `pv_speed`, `gv_scene`, `gv_save`, `gv_load`, and
`gv_state`. UI buttons can call commands later; they should not create a second
mutation path.

Command names are domain-prefixed and have no unprefixed legacy aliases:

- `cmd_*`: console and command-system meta commands.
- `gv_*`: game/global state and configuration.
- `pv_*`: player variables and player-state mutations.
- `wv_*`: world/grid/map variables and mutations.
- `ev_*`: spawned entity variables and mutations.
- `lab_*`: in-cart lab selection and lab workflow.
- `a_*`: audio configuration and audio-state mutations.

Cheat-only commands are gated by `cmd_cheats <1|0>`. `pv_noclip <1|0>` must
stay behind that gate, and disabling cheats must force noclip off.

Gameplay-tuning numbers belong in `state/defaults.ts` and live under
`GameState.config` when they need runtime control. Use `gv_config` for
config-specific console mutation instead of adding new hidden constants.

Labs should run inside the HMSC cart through `lab_spawn <name>`, not as separate
shipped entry points. Lab scene add-ons must use the shared gameplay rig so
camera, player, controls, HUD, collision, physics, noclip, and config behavior
stay coherent.

Labs can also be entered from in-world cells. Store per-cell commands on
`PlacedCell.triggerCommand`; the player drive loop fires that command when the
player enters the cell. Use `wv_trigger` to author these, and prefer themed door
cells over console-only lab entry.

Large authored maps are currently paused at the contract stage. The established
scale remains one grid tile equals one meter, but do not implement a new large
map from a sketch or partial description without confirming the intended tile
storage shape first. `placedCells` remains the explicit authored-cell surface
until the replacement map contract is agreed.

Game events are first-class story facts, not incidental console text. Record
them through `events/gameEvents.ts` so they land in `GameState.events.recent`,
the host event bus, and `useIFTTT` channels such as `hmsc:event:lab.entered`.
Story conditionals belong in `events/useHmscEventRules.ts` unless they are part
of a lower-level system that owns its own event source.

Tile texture keys remain in `world/tileTextureKeys.ts`, but the previous 3D
texture capture path was removed during the map/render reset. Do not recreate a
tile texture renderer before the map and 3D contracts are agreed.

Map tooling belongs in `cart/hmsc-int/`, not in this cart.

## State Rule

The game lives in one JSON-serializable `GameState`. Hot reload and autosave are
the same idea: persist the current state, reload code, revive state, keep working.

Grid cells store construction. Continuous coordinates store movement.

- Grid: chunks, tiles, authored placement, serialization, console addresses.
- Continuous: player position, entity position, smooth locomotion.

## Textured boxes

Every `Geometry.Box` that carries a `textureKey` MUST declare `texturedFaces` —
the faces that actually show the texture. Any face left out pins its UVs to the
capture's `(0,0)` corner texel, so it reads as one flat color instead of cramping
the whole texture onto it (a thin sign edge stretching "HMSC AVE" sideways, a
floor slab smearing the surface down its sides). Declare the real faces:

- Flat slabs (road, junction, floor, water): `['top']`.
- Upright panels (street sign, building facade wall): the two broad faces —
  `['front', 'back']` for a panel whose thin axis is Z, `['left', 'right']` for
  one whose thin axis is X.

So that the corner-texel fallback reads cleanly, a capture's `(0,0)` corner
should be the intended edge color (e.g. the sign's green background). The
mechanism lives in `@reactjit/geometries` Box (`texturedFaces?: BoxFace[]`);
omitting it textures all six faces, which no hmsc textured box should do.
