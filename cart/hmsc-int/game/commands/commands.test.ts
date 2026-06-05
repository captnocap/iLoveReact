// commands.test.ts — P4 behavior tests for GAME_COMMANDS.
//
// The contract under test is the V19 scripting surface: console lines parse
// the way hmsc's console parses them today, commands mutate only their ctx,
// failures resolve to outcomes (never throws), and a verify script stops at
// its first failure with a full replay transcript.

import { GAME_COMMANDS } from './index';
import { assert, assertEqual, assertThrows, finish, test } from '../_testkit';

type World = { tick: number; notes: string[] };

function worldRegistry() {
  const registry = GAME_COMMANDS.createRegistry<World>();
  registry.define({
    name: 'tick',
    usage: 'tick <count>',
    summary: 'advance the state tick',
    run: (world, args) => {
      const count = Number(args[0] ?? 1);
      if (!Number.isFinite(count) || count <= 0) throw new Error('count must be a positive number');
      world.tick += Math.floor(count);
      return [`tick=${world.tick}`];
    },
  });
  registry.define({
    name: 'note',
    usage: 'note <text>',
    summary: 'record a note',
    run: (world, args) => {
      world.notes.push(args.join(' '));
    },
  });
  return registry;
}

test('quoted arguments survive tokenizing the way the hmsc console parses them', () => {
  assertEqual(
    GAME_COMMANDS.tokenize(`spawn  crate "north lot" 'by the door'`).join('|'),
    'spawn|crate|north lot|by the door',
    'quotes must protect spaces; runs of whitespace must split',
  );
  assertEqual(GAME_COMMANDS.parseValue('45'), 45, 'numbers must parse');
  assertEqual(GAME_COMMANDS.parseValue('true'), true, 'booleans must parse');
  assertEqual(GAME_COMMANDS.parseValue('null'), null, 'null must parse');
  assertEqual(JSON.stringify(GAME_COMMANDS.parseValue('{"a":1}')), '{"a":1}', 'JSON must parse');
  assertEqual(GAME_COMMANDS.parseValue('{broken'), '{broken', 'broken JSON must fall back to the raw string');
});

test('commands run against their ctx and report typed outcomes', () => {
  const registry = worldRegistry();
  const world: World = { tick: 0, notes: [] };
  const ok = registry.run(world, 'tick 3');
  assertEqual(ok.ok, true, 'a good command must succeed');
  assertEqual(ok.output[0], 'tick=3', 'output lines must come back');
  assertEqual(world.tick, 3, 'the ctx must mutate');
  registry.run(world, `note "hello world"`);
  assertEqual(world.notes[0], 'hello world', 'quoted args must reach the command joined');
});

test('failure is an outcome, never a throw', () => {
  const registry = worldRegistry();
  const world: World = { tick: 0, notes: [] };
  const unknown = registry.run(world, 'fly 100');
  assertEqual(unknown.ok, false, 'unknown commands must fail');
  assert(unknown.output[0].includes('unknown command'), 'the error must name the problem');
  const bad = registry.run(world, 'tick nope');
  assertEqual(bad.ok, false, 'a throwing command must resolve to a failed outcome');
  assert(bad.output[0].startsWith('error:'), 'the thrown message must surface');
  assertEqual(world.tick, 0, 'a failed command must not have advanced the world');
});

test('the registry boundary rejects bad definitions', () => {
  const registry = worldRegistry();
  assertThrows(
    () => registry.define({ name: 'tick', usage: 'tick', summary: 'dup', run: () => undefined }),
    'duplicate names must be rejected',
  );
  assertThrows(
    () => registry.define({ name: 'two words', usage: '', summary: '', run: () => undefined }),
    'names with whitespace must be rejected',
  );
  assertThrows(
    () => registry.define({ name: 'Tick', usage: '', summary: '', run: () => undefined }),
    'uppercase names must be rejected',
  );
  assertEqual(registry.list().map((s) => s.name).join(','), 'note,tick', 'list must stay sorted and uncorrupted');
});

test('a verify script skips comments and stops at its first failure (V19)', () => {
  const registry = worldRegistry();
  const world: World = { tick: 0, notes: [] };
  const result = registry.runScript(world, [
    '# milestone-0 smoke',
    '',
    'tick 2',
    'note checkpoint',
    'tick nope',
    'tick 100',
  ]);
  assertEqual(result.ok, false, 'the script must fail');
  assertEqual(result.commandsRun, 2, 'two commands must have run before the failure');
  assertEqual(world.tick, 2, 'the failing line must not advance the world');
  assert(result.transcript.join('\n').includes('> tick nope'), 'the transcript must record the failing line');
  assert(!result.transcript.join('\n').includes('> tick 100'), 'nothing after the failure may run');

  const green = registry.runScript(world, ['tick 1', 'note done']);
  assertEqual(green.ok, true, 'a clean script must pass');
  assertEqual(green.commandsRun, 2, 'every command must count');
});

finish('game/commands');
