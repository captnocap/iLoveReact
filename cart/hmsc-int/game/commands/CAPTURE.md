# Capture note — game/commands/ vocabulary (capture wave, 2026-06-05)

The hmsc console vocabulary REWRITTEN fresh onto the existing game/commands
skeleton (registry/parser/outcome machinery, laid by the verify-plumbing lane).
The old files are untouched behavior references (V15-TRANSITION).

## Sources (read, never moved/copied/imported)

| piece | old file | what it contained |
|---|---|---|
| the 48-command vocabulary | `cart/hmsc/commands/registry.ts` (1406 lines) | `cmd_/lab_/gv_/pv_/ev_/wv_` command taxonomy over GameState: help/cheats, lab scenes, sky/time/weather/view, events, state surgery, save/load/reset, player movement, entity spawning, world construction (cells/roads/junctions/props/buildings/zones), pathing, validation |
| tuning constants | `cart/hmsc/state/defaults.ts` | entity radii/restitution, burst constants, console event cap, draw-radius bounds, spawn clearance, player speeds, sky defaults |
| sky tables | `cart/hmsc/render3d/sky.ts` | named hours (midnight/dawn/noon/dusk), weather presets (clear/hazy/cloudy/storm), hour wrap + influence clamp |
| cell math | `cart/hmsc/world/grid.ts` (`worldToCell`/`cellKey` only) | floor-divide world→cell at `cellSizeMeters` (R4: 1 tile = 1m) |

## The capture boundary (the load-bearing decision)

All 48 names are REGISTERED — the script language is complete from day one.
But behavior splits by whether the command's TARGET SYSTEM is captured:

- **26 captured for real**: cmd_help, cmd_cheats, gv_debug_hud, gv_noise,
  gv_save, gv_load, gv_sky,
  gv_time, gv_daycycle, gv_weather, gv_view, gv_events, gv_emit, gv_state,
  gv_set, gv_config, gv_scene, gv_reset, pv_teleport, pv_where, pv_speed,
  pv_noclip, ev_spawn, ev_burst, ev_despawn, wv_tile. Their targets are the
  command state itself, the P2 `COMMAND_TUNING`/sky tables, `GAME_KINDS`,
  `GAME_PERCEPTION`, or the mounted V20 data store.
- **1 partial**: wv_prop — `wv_prop kinds` answers from GAME_KINDS.props;
  placement/list/remove fail loudly (world system).
- **21 explicitly NOT-YET** (`NOT_YET_CAPTURED`, exported per owner): they
  FAIL LOUDLY with `system not captured yet: <owner>` — never a silent no-op,
  never fake success. When an owning lane lands, it replaces the stub body;
  the name, usage line, and any saved scripts already exist.

### Stub inventory after captured-owner flips

| command(s) | owner | reason it remains a stub |
|---|---|---|
| lab_list, lab_spawn, lab_exit | lab scenes | awaits V13 labs-route integration with a live game-world scene mount |
| gv_controls | input contract | GAME_INPUT is transport-only until the input lane commits the canonical printable contract |
| gv_perflog | telemetry | skipped this pass; telemetry-owned command waits for that lane's command toggle |
| pv_respawn, wv_place, wv_fill, wv_remove, wv_trigger | world grid | awaits live placed-cell/surface/trigger/respawn state in the headless boot |
| wv_path | world grid pathing | GAME_PATHING is captured, but this command awaits the live tile grid published from world state |
| wv_road, wv_intersection, wv_culdesac | road grammar | awaits a road/junction world-state system |
| wv_signal | traffic | awaits signal-clock and phase-override state |
| wv_prop placement/remove | world props placement | kind data is captured; placement/removal awaits world props state |
| wv_building, wv_enter, wv_leave | buildings + interiors | awaits building/interior world state |
| wv_mountain | landform instances | kind math is captured; instance state and trailhead selection are not mounted |
| wv_zone | world zones | awaits zone state |
| wv_validate | placement validation | awaits placementCheck over live placed-world state |

## Verification

- P4 suite `vocabulary.test.ts` (16 behavior cases under `tools/v8cli` via the
  shared `game/_testkit.ts`): name completeness (48), loud-failure boundary
  (every pending command), cheat gating, sky named hours/presets/wrap/bounds,
  view clamps, gv_noise over perception/kinds, dot-path surgery, event ring +
  filters, spawn radii/burst clamp/despawn, gv_reset wrapper-ctx semantics,
  gv_save/gv_load mounted persistence, help coverage, and a green end-to-end
  script. 16/16 green.
- `compile/verify/commands.cmds` — a verify script of 30 command lines
  replayed headless, including gv_noise and a V20 gv_save/gv_load round trip.
  `rjit game verify`: **GREEN — 26/26 suites,
  2/2 scripts**.

## Changed shape (same behavior, constitution's bar)

- **Mutable ctx, throw-to-fail** (the skeleton's conventions) replaces the
  reference's immutable state-in/state-out pairs; the registry resolves throws
  to `CommandOutcome`s, so callers never try/catch.
- **Dot-path STATE SHAPE preserved** (`player.physics.velocity`,
  `config.sky.hour`, `world.spawnedEntities`, `command.cheatsEnabled`) so
  saved command sequences keep meaning the same thing across the capture.
- **Every number is table data (P2)**: `COMMAND_TUNING` + `SKY_NAMED_HOURS` +
  `SKY_WEATHER_PRESETS`, exported through the door. The reference scattered
  them across `state/defaults.ts` constants.
- **Event ring rewritten small**: the reference's `gameEvents.ts` channel
  (recordCommandEvents, useIFTTT publish, subject/actor schema) is the V8
  event-channel SYSTEM — its own capture. Carried here: a typed ring
  (`id/type/source/tags/payload`, capacity 256) with the reference's console
  read surface (count cap 40, type filter, newest first). Event id format is
  new (`ev_NNNN`); the reference delegated id minting to the channel.
- **cmd_help prints sorted** (registry.list() order), not source order; pad
  width derives from the longest name instead of the reference's `padEnd(10)`.

## Deliberately NOT carried

- **recordCommandEvents auto-wrapping** (every command emitting a command
  event): belongs to the event-channel capture; commands here return outcomes
  and the channel can wrap the registry when it lands.
- **`gv_events` subject-id filtering**: the captured ring has no subject
  schema yet (channel capture); type filter carried.
- **`lab_spawn` scene definitions** (`HMSC_LAB_DEFINITIONS`): hmsc-cart scene
  content; the V13 labs route owns what "a lab scene in the game world" means
  now.
- **localstore persistence** (`gv_save`/`gv_load` via `saveGameState`): V20
  ruled persistence is the data/ streams+snapshots layer — wiring these to
  localstore would re-roll the dead pattern. The flipped command path uses a
  mounted V20 `commands` stream/snapshot adapter instead.

## Ambiguities surfaced (NOT guessed)

1. **`gv_perflog` host hook**: the reference flips `__hmsc_spike_trace`; the
   honest binding name under V18 (`__game_*`) doesn't exist yet. Stubbed to
   telemetry rather than wiring a legacy host name into fresh code.
2. **`ev_burst` kind cycle emits `prop` as a spawned-entity kind** (reference
   behavior, carried) — distinct from world props (`wv_prop`). The world
   capture should decide if spawned-entity kinds and prop kinds converge.
3. **`gv_set` is not cheat-gated** (reference behavior, carried) — it can
   flip `command.cheatsEnabled` itself. If the gate should be load-bearing,
   that is a ruling, not a capture decision.
