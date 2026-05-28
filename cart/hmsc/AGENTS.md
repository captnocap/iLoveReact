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

Large authored maps start in `world/masterLayout.ts`: master layout -> zones ->
nested placements. Use `surfaceRegions` for huge floor materials and reserve
`placedCells` for things that need cell-level identity, collision, diagnostics,
or triggers. Do not expand a 1200x1200 floor into individual saved cells.

Game events are first-class story facts, not incidental console text. Record
them through `events/gameEvents.ts` so they land in `GameState.events.recent`,
the host event bus, and `useIFTTT` channels such as `hmsc:event:lab.entered`.
Story conditionals belong in `events/useHmscEventRules.ts` unless they are part
of a lower-level system that owns its own event source.

Tile textures use stable keys from `world/tileTextureKeys.ts`. Procedural
Effect fills are captured in `render3d/tileTextures.tsx` through `StaticSurface`
and sampled by `Scene3D.Mesh textureKey`; do not duplicate shader/material
decisions inside individual labs.

Map tooling belongs in `cart/hmsc-int/`, not in this cart.

## State Rule

The game lives in one JSON-serializable `GameState`. Hot reload and autosave are
the same idea: persist the current state, reload code, revive state, keep working.

Grid cells store construction. Continuous coordinates store movement.

- Grid: chunks, tiles, authored placement, serialization, console addresses.
- Continuous: player position, entity position, smooth locomotion.
