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
  assert(pending.length >= 16, 'the pending list covers the uncaptured systems');
  for (const flipped of ['gv_noise', 'gv_save', 'gv_load', 'wv_place', 'wv_fill', 'wv_remove', 'wv_trigger', 'pv_respawn']) {
    assert(!pending.includes(flipped), `${flipped} has a captured owner and must not stay in the pending list`);
  }
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

test('gv_noise reports captured perception and tile-noise tuning', () => {
  const { registry, game } = freshConsole();
  const noise = registry.run(game, 'gv_noise');
  assertEqual(noise.ok, true, 'gv_noise is backed by GAME_PERCEPTION now');
  const text = noise.output.join('\n');
  assert(text.includes('run=radius:16m'), 'movement noise must print the run radius');
  assert(text.includes('gunshot noise: radius:40m'), 'gunshot tuning must print');
  assert(text.includes('road=0.70'), 'tile noise multipliers must come from GAME_KINDS');
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

test('gv_save and gv_load require a mounted persistence door and restore the command-state slice', () => {
  const { registry, game } = freshConsole();
  const unmounted = registry.run(game, 'gv_save');
  assertEqual(unmounted.ok, false, 'gv_save without a mounted store must fail loud');
  assert(unmounted.output[0].includes('persistence store not mounted'), 'the missing mount must be explicit');

  let saved: GameCommandState | null = null;
  game.__commandPersistence = {
    save: (state) => {
      saved = state;
      return ['saved test state'];
    },
    load: () => saved,
  };

  registry.run(game, 'pv_teleport 3 4 5');
  const save = registry.run(game, 'gv_save');
  assertEqual(save.ok, true, 'mounted gv_save must succeed');
  registry.run(game, 'pv_teleport 30 40 50');
  assertEqual(game.player.position.x, 30, 'the mutation after save must land before load');
  const load = registry.run(game, 'gv_load');
  assertEqual(load.ok, true, 'mounted gv_load must succeed');
  assertEqual(game.player.position.x, 3, 'load must restore the saved command state');
  assert(game.__commandPersistence != null, 'loading must keep the mounted persistence door');
});

test('cmd_help teaches the whole surface, including pending commands', () => {
  const { registry, game } = freshConsole();
  const help = registry.run(game, 'cmd_help');
  assertEqual(help.output.length, 48, 'help lists every registered command');
  const one = registry.run(game, 'cmd_help wv_road');
  assertEqual(one.ok, true, 'help on a pending command still teaches its usage');
  assert(one.output[1].includes('usage: wv_road'), 'the usage line must print');
});

test('the world grid commands run for real: place, fill, trigger, remove, respawn (V4 captured)', () => {
  const { registry, game } = freshConsole();

  assertEqual(registry.run(game, 'wv_fill road 0 0 8 8').ok, true, 'wv_fill must paint a region');
  assertEqual(game.world.surfaceRegions.length, 1, 'the region must land in state');
  assertEqual(game.world.surfaceRegions[0].id, 'fill_0_0_8x8', 'the reference region id shape');

  assertEqual(registry.run(game, 'wv_place spawn 3 3').ok, true, 'wv_place must place a cell');
  assertEqual(game.world.placedCells['3,0,3'].kind, 'spawn', 'the spawn cell must land');
  const badKind = registry.run(game, 'wv_place lava 1 1');
  assertEqual(badKind.ok, false, 'unknown kinds must fail');
  assert(badKind.output[0].includes('expected one of'), 'the failure must teach the valid kinds');

  assertEqual(registry.run(game, 'wv_trigger 3 3 gv_time noon').ok, true, 'wv_trigger must set a command');
  assertEqual(game.world.placedCells['3,0,3'].triggerCommand, 'gv_time noon', 'the trigger must land');
  const show = registry.run(game, 'wv_trigger 3 3');
  assert(show.output[0].includes('gv_time noon'), 'bare wv_trigger must show the command');
  registry.run(game, 'wv_trigger 3 3 off');
  assertEqual(game.world.placedCells['3,0,3'].triggerCommand, undefined, 'off must clear the trigger');
  assertEqual(registry.run(game, 'wv_trigger 9 9 anything').ok, false, 'no placed cell → loud failure');

  // pv_respawn: no marker → loud; the placed spawn is the world default; the
  // landing y snaps to the painted road region's walkable top.
  registry.run(game, 'pv_teleport 50 50 9');
  const respawn = registry.run(game, 'pv_respawn');
  assertEqual(respawn.ok, true, 'the placed spawn must serve as the default respawn');
  assertEqual(game.player.position.x, 3.5, 'respawn lands on the cell centre');
  assertClose(game.player.position.y, 0.07, 1e-9, 'respawn y snaps to the painted ground top');
  assertEqual(game.player.physics.grounded, true, 'respawn grounds the player');

  registry.run(game, 'wv_remove 3 3');
  assertEqual(game.world.placedCells['3,0,3'], undefined, 'wv_remove must delete the cell');
  delete game.player.respawnCell;
  assertEqual(registry.run(game, 'pv_respawn').ok, false, 'no spawn anywhere → loud failure');
});

test('wv_mountain lists landform instances and drops the player at the trailhead', () => {
  const { registry, game } = freshConsole();
  assertEqual(registry.run(game, 'wv_mountain').output[0], 'no mountains', 'an empty world says so');
  game.world.landforms.push({
    id: 'mountain_a', kind: 'mountain', label: 'Mount Test',
    centerX: 100, centerZ: 100, baseY: 0,
    params: { baseRadius: 48, peak: 30, trailStartAngle: Math.PI / 2 },
    createdByCommand: 'test',
  });
  const list = registry.run(game, 'wv_mountain');
  assert(list.output[0].includes('mountain_a Mount Test peak 30m'), 'the listing must describe the instance');
  const tp = registry.run(game, 'wv_mountain trailhead');
  assertEqual(tp.ok, true, 'the trailhead teleport must run');
  assertClose(game.player.position.x, 100, 1e-6, 'trailStartAngle π/2 puts the trailhead at +Z of centre');
  assertClose(game.player.position.z, 148, 1e-6, 'trailhead radius = baseRadius');
  assertClose(game.player.position.y, 0.05, 1e-9, 'the drop-in lift is the named tuning value');
  assertEqual(registry.run(game, 'wv_mountain trailhead nope').ok, false, 'an unknown id fails loud');
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
