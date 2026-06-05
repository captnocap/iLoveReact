// vocabulary.test.ts — P4 behavior tests for the captured console vocabulary.
//
// The contract under test is hmsc's console BEHAVIOR (the reference:
// cart/hmsc/commands/registry.ts), rewritten onto the skeleton's mutable-ctx
// conventions: cheat gating, sky named hours/presets, view clamps, dot-path
// state surgery, the event ring, spawn/burst tuning — and the loud not-yet
// boundary: every pending command must FAIL with "system not captured yet",
// never silently no-op.

import { GAME_COMMANDS, type CommandRegistry } from './index';
import {
  COMMAND_TUNING,
  GAME_COMMAND_NAMES,
  NOT_YET_CAPTURED,
  createGameCommandState,
  defineGameCommands,
  type GameCommandState,
} from './vocabulary';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

function freshConsole(): { registry: CommandRegistry<GameCommandState>; game: GameCommandState } {
  const registry = GAME_COMMANDS.createRegistry<GameCommandState>();
  defineGameCommands(registry);
  return { registry, game: createGameCommandState() };
}

test('all 48 reference command names are registered — the script language is complete', () => {
  const { registry } = freshConsole();
  const registered = new Set(registry.list().map((spec) => spec.name));
  assertEqual(GAME_COMMAND_NAMES.length, 48, 'the captured vocabulary is 48 names');
  for (const name of GAME_COMMAND_NAMES) {
    assert(registered.has(name), `${name} must be registered`);
  }
});

test('every not-yet command fails LOUDLY, never silently (the capture boundary)', () => {
  const { registry, game } = freshConsole();
  const pending = Object.values(NOT_YET_CAPTURED).flat();
  assert(pending.length >= 24, 'the pending list covers the uncaptured systems');
  for (const name of pending) {
    if (name === 'wv_prop') continue; // partial: tested separately below
    const outcome = registry.run(game, name);
    assertEqual(outcome.ok, false, `${name} must fail until its system is captured`);
    assert(
      outcome.output[0].includes('system not captured yet'),
      `${name} must say WHY it fails (got: ${outcome.output[0]})`,
    );
  }
});

test('wv_prop is partial: kind table answers, placement fails loud', () => {
  const { registry, game } = freshConsole();
  const kinds = registry.run(game, 'wv_prop kinds');
  assertEqual(kinds.ok, true, 'wv_prop kinds must answer from GAME_KINDS');
  assert(kinds.output[0].startsWith('prop kinds:'), 'the kind list must print');
  const place = registry.run(game, 'wv_prop street_lamp 4 4');
  assertEqual(place.ok, false, 'placement must fail until the world capture');
  assert(place.output[0].includes('system not captured yet'), 'placement failure must name the boundary');
});

test('wv_tile inspects the captured kind registry', () => {
  const { registry, game } = freshConsole();
  const list = registry.run(game, 'wv_tile');
  assertEqual(list.ok, true, 'bare wv_tile lists kinds');
  assert(list.output[0].includes('road'), 'the tile list must include road');
  const road = registry.run(game, 'wv_tile road');
  assertEqual(road.ok, true, 'wv_tile road must answer');
  assert(road.output[0].includes('"kind"'), 'the definition must print as JSON');
  const bad = registry.run(game, 'wv_tile not_a_tile');
  assertEqual(bad.ok, false, 'unknown kinds must fail');
  assert(bad.output[0].includes('expected one of'), 'the failure must teach the valid kinds');
});

test('pv_teleport moves the player; pv_where reports position and cell (R4: 1 tile = 1m)', () => {
  const { registry, game } = freshConsole();
  assertEqual(registry.run(game, 'pv_teleport 10.6 -3.2 2').ok, true, 'teleport must succeed');
  assertEqual(game.player.position.x, 10.6, 'x must land');
  const where = registry.run(game, 'pv_where');
  assertEqual(where.ok, true, 'pv_where must answer');
  assert(where.output.join('\n').includes('cell = 10,2,-4'), 'the cell must floor world coords');
});

test('noclip is cheat-gated; disabling cheats revokes it (reference behavior)', () => {
  const { registry, game } = freshConsole();
  const denied = registry.run(game, 'pv_noclip 1');
  assertEqual(denied.ok, false, 'noclip without cheats must fail');
  assert(denied.output[0].includes('cmd_cheats 1 required'), 'the gate must name its key');
  registry.run(game, 'cmd_cheats 1');
  assertEqual(registry.run(game, 'pv_noclip 1').ok, true, 'noclip with cheats must work');
  assertEqual(game.player.noclip, true, 'the flag must set');
  registry.run(game, 'cmd_cheats 0');
  assertEqual(game.player.noclip, false, 'disabling cheats must clear noclip');
});

test('sky commands: named hours, presets, wrap, and influence bounds', () => {
  const { registry, game } = freshConsole();
  registry.run(game, 'gv_time noon');
  assertEqual(game.config.sky.hour, 12, 'noon = 12');
  registry.run(game, 'gv_time 25');
  assertClose(game.config.sky.hour, 1, 1e-9, 'hours wrap modulo 24');
  registry.run(game, 'gv_weather storm');
  assertEqual(game.config.sky.weather, 1, 'storm preset weather');
  assertClose(game.config.sky.gloom, 0.45, 1e-9, 'storm preset gloom');
  const bad = registry.run(game, 'gv_weather 1.5');
  assertEqual(bad.ok, false, 'out-of-range influence must fail');
  assert(bad.output[0].includes('presets:'), 'the failure must teach the presets');
  const sky = registry.run(game, 'gv_sky');
  assert(sky.output[0].includes('hour='), 'gv_sky prints the config line');
});

test('gv_view clamps the draw radius to the tuning bounds', () => {
  const { registry, game } = freshConsole();
  registry.run(game, 'gv_view 999999');
  assertEqual(game.config.view.drawRadiusMeters, COMMAND_TUNING.view.maxDrawRadiusMeters, 'huge radii clamp to max');
  registry.run(game, 'gv_view 1');
  assertEqual(game.config.view.drawRadiusMeters, COMMAND_TUNING.view.minDrawRadiusMeters, 'tiny radii clamp to min');
});

test('dot-path surgery: gv_set / gv_state / gv_config keep the reference paths', () => {
  const { registry, game } = freshConsole();
  registry.run(game, 'gv_set player.physics.grounded false');
  assertEqual(game.player.physics.grounded, false, 'gv_set must write nested paths');
  const read = registry.run(game, 'gv_state player.walkSpeedMetersPerSecond');
  assert(read.output[0].includes('2.4'), 'gv_state must read a dot path');
  registry.run(game, 'gv_config sky.gloom 0.3');
  assertClose(game.config.sky.gloom, 0.3, 1e-9, 'gv_config must write config paths');
});

test('the event ring: gv_emit records, gv_events filters, bad payloads fail', () => {
  const { registry, game } = freshConsole();
  // the console dialect: JSON payloads ride inside single quotes so the
  // tokenizer hands parseCommandValue the double quotes intact
  registry.run(game, `gv_emit door.opened '{"id":"d1"}'`);
  registry.run(game, 'gv_emit npc.alerted');
  const all = registry.run(game, 'gv_events');
  assertEqual(all.output.length, 2, 'both events must print');
  assert(all.output[0].includes('npc.alerted'), 'newest first');
  const filtered = registry.run(game, 'gv_events 5 door');
  assertEqual(filtered.output.length, 1, 'the type filter must apply');
  const bad = registry.run(game, 'gv_emit broken [1,2]');
  assertEqual(bad.ok, false, 'array payloads must fail');
});

test('spawn vocabulary: radius by kind, default placement, burst clamp, despawn', () => {
  const { registry, game } = freshConsole();
  registry.run(game, 'ev_spawn crate');
  const crate = game.world.spawnedEntities['crate_0000'];
  assert(crate != null, 'the first crate takes serial 0000');
  assertClose(crate.physics.radiusMeters, COMMAND_TUNING.spawn.crateEntityRadiusMeters, 1e-9, 'crates use the crate radius');
  assertClose(
    crate.position.y,
    COMMAND_TUNING.spawn.crateEntityRadiusMeters + COMMAND_TUNING.spawn.spawnClearanceMeters,
    1e-9,
    'default y = player.y + radius + clearance',
  );
  const burst = registry.run(game, 'ev_burst 999');
  assert(burst.output[0].includes(`${COMMAND_TUNING.spawn.maxBurstCount}`), 'bursts clamp to the max');
  assertEqual(
    Object.keys(game.world.spawnedEntities).length,
    1 + COMMAND_TUNING.spawn.maxBurstCount,
    'every burst body must exist in state',
  );
  assertEqual(registry.run(game, 'ev_despawn crate_0000').ok, true, 'despawn by id');
  assertEqual(registry.run(game, 'ev_despawn crate_0000').ok, false, 'double despawn must fail');
});

test('gv_reset restores the fresh state but keeps wrapper-ctx fields', () => {
  const registry = GAME_COMMANDS.createRegistry<GameCommandState & { booted: boolean }>();
  defineGameCommands(registry);
  const game = { ...createGameCommandState(), booted: true };
  registry.run(game, 'cmd_cheats 1');
  registry.run(game, 'pv_teleport 5 5');
  registry.run(game, 'gv_reset');
  assertEqual(game.command.cheatsEnabled, false, 'reset must clear cheats');
  assertEqual(game.player.position.x, 0, 'reset must re-home the player');
  assertEqual(game.booted, true, 'wrapper fields outside the command state must survive');
});

test('cmd_help teaches the whole surface, including pending commands', () => {
  const { registry, game } = freshConsole();
  const help = registry.run(game, 'cmd_help');
  assertEqual(help.output.length, 48, 'help lists every registered command');
  const one = registry.run(game, 'cmd_help wv_road');
  assertEqual(one.ok, true, 'help on a pending command still teaches its usage');
  assert(one.output[1].includes('usage: wv_road'), 'the usage line must print');
});

test('a verify script over captured commands runs green end to end (V19)', () => {
  const { registry, game } = freshConsole();
  const result = registry.runScript(game, [
    '# captured-vocabulary smoke',
    'pv_teleport 8 8',
    'gv_time dusk',
    'gv_weather cloudy',
    'ev_spawn ball 8 8 4',
    `gv_emit smoke.ran '{"ok":true}'`,
    'gv_events 1',
    'pv_where',
  ]);
  assertEqual(result.ok, true, `the script must pass (${result.transcript.join(' | ')})`);
  assertEqual(result.commandsRun, 7, 'every line must run');
});

finish('game/commands/vocabulary');
