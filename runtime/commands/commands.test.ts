// commands/commands.test.ts — command identity and authority boundary.
//
//   tools/esbuild runtime/commands/commands.test.ts --bundle \
//     --outfile=/tmp/commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/commands.test.js

import {
  CommandAuthority,
  CommandRegistry,
  chordFromEvent,
  commandById,
  commandsByMenu,
  defineCommand,
  exportHotkeys,
  hotkeyFor,
  loadHotkeys,
  normalizeChord,
  prettyChord,
  rebindHotkey,
  registeredCommands,
  resolveHotkey,
  runCommand,
  tryNormalizeChord,
  type CommandDef,
  type CommandOutcome,
  type CommandSource,
} from './index';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (error) { failed++; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function numberArgs(args: unknown) {
  const value = args as { amount?: unknown } | null;
  return value && typeof value.amount === 'number'
    ? { ok: true as const, value: { amount: value.amount } }
    : { ok: false as const, reason: 'amount must be a number' };
}

test('key chords normalize aliases and desktop punctuation', () => {
  assert(normalizeChord('shift+z+control') === 'ctrl+shift+z', 'modifier ordering');
  assert(normalizeChord('Cmd+A') === 'meta+a', 'command alias');
  assert(normalizeChord('Esc') === 'escape', 'key alias');
  assert(normalizeChord(']') === ']', 'right bracket is a valid desktop key');
  assert(normalizeChord('Ctrl+[') === 'ctrl+[', 'modified bracket is valid');
  assert(normalizeChord('?') === '?', 'question mark from the command table is valid');
  assert(chordFromEvent({ key: ']', shiftKey: false }) === ']', 'event punctuation matches declaration');
  assert(prettyChord('ctrl+shift+z') === 'Ctrl+Shift+Z', 'pretty chord');
  assert(tryNormalizeChord('ctrl+alt') === null, 'modifier-only chord is rejected');
  assert(tryNormalizeChord('Ctrl++') === null, 'plus remains unambiguous as the chord separator');
});

test('public projections are frozen data and cannot execute handlers', () => {
  const registry = new CommandRegistry();
  let mutations = 0;
  const projection = registry.register({
    id: 'world.piece.rotate',
    label: 'Rotate Piece',
    icon: 'RotateCw',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { menu: ['Build', 'Transform'], toolbar: ['D.world'], palette: true },
    keybindings: [{ chord: 'R', when: { surface: 'world' } }],
    validateArgs: numberArgs,
  }, ({ args }) => { mutations += args.amount; return mutations; });

  assert(Object.isFrozen(projection), 'projection is frozen');
  assert(Object.isFrozen(projection.projections), 'projection declaration is frozen');
  assert(Object.isFrozen(projection.projections.menu!), 'menu path is frozen');
  assert(Object.isFrozen(projection.keybindings), 'keybinding list is frozen');
  assert(!('handler' in projection), 'handler is absent');
  assert(!('run' in projection), 'run callback is absent');
  assert(registry.command(projection.id) === projection, 'id lookup returns the same inert projection');
  assert(registry.byMenu('Build')[0] === projection, 'menu gets the same inert projection');
  assert(registry.resolveChord('R', { surface: 'world' }) === projection, 'keybinding gets the same projection');
  assert(mutations === 0, 'reading every projection does not execute the handler');
});

test('every invocation source reaches one private handler and one published outcome', () => {
  const registry = new CommandRegistry();
  let mutation = 0;
  let handlerCalls = 0;
  const published: CommandOutcome[] = [];
  registry.register({
    id: 'world.floor.step',
    label: 'Step Floor',
    icon: 'Layers',
    effect: 'report-only',
    undoScope: 'none',
    projections: {
      menu: ['View', 'Floor'], toolbar: ['D.world'], contextMenu: ['world'], palette: true,
    },
    validateArgs: numberArgs,
  }, (ctx) => {
    handlerCalls++;
    assert(!('source' in ctx), 'source is deliberately unavailable to handler');
    mutation += ctx.args.amount;
    return { floor: mutation };
  });
  const authority = new CommandAuthority(registry, { outcomeSink: (outcome) => published.push(outcome) });
  const sources: CommandSource[] = [
    'menu', 'hotkey', 'toolbar', 'context-menu', 'palette', 'native', 'remote', 'automation',
  ];
  const outcomes = sources.map((source, index) => authority.invoke<{ floor: number }>({
    invocationId: `floor:${index}`,
    commandId: 'world.floor.step',
    args: { amount: 1 },
    source,
    origin: 'test-user',
  }));

  assert(handlerCalls === sources.length, 'one handler call per invocation');
  assert(mutation === sources.length, 'all sources use the same mutation');
  assert(outcomes.every((outcome) => outcome.status === 'applied'), 'every source applies');
  assert(outcomes.every((outcome) => outcome.phase === 'applied'), 'serialized outcome carries its phase');
  assert(outcomes.every((outcome, index) => outcome.source === sources[index]), 'source survives as outcome metadata');
  assert(outcomes.every((outcome) => !('actionId' in outcome)), 'report-only outcomes do not invent action ids');
  assert(published.length === outcomes.length, 'sink called exactly once per invocation');
  assert(published.every((outcome, index) => outcome === outcomes[index]), 'sink receives the returned outcome object');
});

test('authored actions carry stable ids and controls can correlate to them', () => {
  const registry = new CommandRegistry();
  registry.register({
    id: 'world.piece.place', label: 'Place', icon: 'Box', effect: 'action',
    undoScope: { kind: 'document' }, projections: { toolbar: ['D.world'] },
    validateArgs: numberArgs,
  }, () => 'placed');
  registry.register({
    id: 'history.undo', label: 'Undo', icon: 'Undo2', effect: 'control',
    undoScope: 'none', projections: { menu: ['Edit'] },
    validateArgs: (_args) => ({ ok: true, value: {} }),
  }, () => 'undone');
  const authority = new CommandAuthority(registry);

  const defaultId = authority.invoke({
    invocationId: 'invoke:place:1', commandId: 'world.piece.place', args: { amount: 1 }, source: 'toolbar',
  });
  const suppliedId = authority.invoke({
    invocationId: 'invoke:place:2', actionId: 'action:piece:9',
    commandId: 'world.piece.place', args: { amount: 1 }, source: 'remote',
  });
  const undo = authority.invoke({
    invocationId: 'invoke:undo:1', actionId: 'action:piece:9',
    commandId: 'history.undo', args: {}, source: 'hotkey',
  });

  assert(defaultId.status === 'applied' && defaultId.actionId === 'invoke:place:1', 'action defaults to invocation id');
  assert(suppliedId.status === 'applied' && suppliedId.actionId === 'action:piece:9', 'explicit action id survives');
  assert(undo.status === 'applied' && undo.actionId === 'action:piece:9', 'control correlates to the authored action');
});

test('invalid, disabled, and unauthorized invocations never reach mutation', () => {
  const registry = new CommandRegistry();
  let mutations = 0;
  const published: CommandOutcome[] = [];
  registry.register({
    id: 'project.delete-map',
    label: 'Delete Map',
    icon: 'Trash2',
    effect: 'project-action',
    undoScope: { kind: 'project' },
    projections: { menu: ['File'], palette: true },
    requiredCapabilities: ['project.delete'],
    validateArgs: numberArgs,
  }, ({ args }) => { mutations += args.amount; });
  registry.register({
    id: 'world.disabled',
    label: 'Unavailable',
    icon: 'Ban',
    effect: 'action',
    undoScope: { kind: 'document' },
    projections: { hiddenReason: 'test guard' },
    validateArgs: numberArgs,
    isEnabled: () => ({ enabled: false, reason: 'nothing selected' }),
  }, ({ args }) => { mutations += args.amount; });

  const authority = new CommandAuthority(registry, {
    hasCapability: () => false,
    outcomeSink: (outcome) => published.push(outcome),
  });
  const invalid = authority.invoke({
    invocationId: 'invalid', commandId: 'project.delete-map', args: { amount: 'one' }, source: 'menu',
  });
  const unauthorized = authority.invoke({
    invocationId: 'unauthorized', commandId: 'project.delete-map', args: { amount: 1 }, source: 'remote',
  });
  const disabled = authority.invoke({
    invocationId: 'disabled', commandId: 'world.disabled', args: { amount: 1 }, source: 'toolbar',
  });
  const unknown = authority.invoke({
    invocationId: 'unknown', commandId: 'not.registered', args: {}, source: 'automation',
  });

  assert(invalid.status === 'rejected' && invalid.code === 'invalid-args', 'invalid args rejected');
  assert(unauthorized.status === 'rejected' && unauthorized.code === 'unauthorized', 'capability rejected');
  assert(disabled.status === 'rejected' && disabled.code === 'disabled', 'enablement rejected');
  assert(unknown.status === 'rejected' && unknown.code === 'unknown-command', 'unknown id rejected');
  assert([invalid, unauthorized, disabled, unknown].every((outcome) => outcome.phase === 'rejected'), 'rejections identify their phase');
  assert(mutations === 0, 'no rejected invocation entered a handler');
  assert(published.length === 4, 'each rejection published exactly once');
});

test('a thrown handler publishes exactly one rejected outcome', () => {
  const registry = new CommandRegistry();
  const published: CommandOutcome[] = [];
  let handlerCalls = 0;
  registry.register({
    id: 'world.prepare-fails', label: 'Prepare Failure', icon: 'TriangleAlert', effect: 'action',
    undoScope: { kind: 'document' }, projections: { hiddenReason: 'authority failure test' },
    validateArgs: (_args) => ({ ok: true, value: {} }),
  }, () => {
    handlerCalls++;
    throw new Error('prepare failed before commit');
  });
  const authority = new CommandAuthority(registry, {
    outcomeSink: (outcome) => published.push(outcome),
  });
  const outcome = authority.invoke({
    invocationId: 'failure:1', commandId: 'world.prepare-fails', args: {}, source: 'automation',
  });

  assert(handlerCalls === 1, 'handler attempted once');
  assert(outcome.status === 'rejected' && outcome.code === 'handler-failed', 'throw becomes rejected outcome');
  assert(outcome.phase === 'rejected', 'handler rejection is self-describing');
  assert(published.length === 1 && published[0] === outcome, 'one rejected outcome published exactly once');
});

test('the same chord resolves only the command belonging to the current mode', () => {
  const registry = new CommandRegistry();
  const base = {
    label: 'Cycle', icon: 'Layers', effect: 'report-only' as const, undoScope: 'none' as const,
    projections: { toolbar: ['D'] }, validateArgs: (_args: unknown) => ({ ok: true as const, value: {} }),
  };
  const world = registry.register({
    ...base, id: 'world.floor.cycle', keybindings: [{ chord: ']', when: { surface: 'world' } }],
  }, () => 'world');
  const model = registry.register({
    ...base, id: 'model.layer.cycle', keybindings: [{ chord: ']', when: { surface: 'model' } }],
  }, () => 'model');
  const help = registry.register({
    ...base, id: 'app.help', keybindings: [{ chord: '?', when: { surface: 'help' } }],
  }, () => 'help');

  assert(registry.resolveChord(']', { surface: 'world' }) === world, 'world mode resolves world command');
  assert(registry.resolveChord(']', { surface: 'model' }) === model, 'model mode resolves model command');
  assert(registry.resolveChord(']', { surface: 'play' }) === undefined, 'unmatched mode resolves nothing');
  assert(registry.resolveChord(']') === undefined, 'missing mode cannot select either command');
  assert(registry.resolveChord('?', { surface: 'help' }) === help, 'question-mark command resolves');

  let conflict = false;
  try {
    registry.register({
      ...base, id: 'world.overlap', keybindings: [{ chord: ']', when: { surface: 'world', pane: 'focus' } }],
    }, () => 'overlap');
  } catch { conflict = true; }
  assert(conflict, 'overlapping predicates cannot create an ambiguous chord');
});

// Compatibility facade: legacy declarations still work, but their returned
// command is inert and all execution enters the default authority.
let legacyRuns = 0;
const legacyDefinition: CommandDef = {
  id: 'test.legacy', menu: 'Edit', label: 'Legacy Action', icon: 'Bolt',
  defaultKey: 'Ctrl+L', undoable: true, native: false,
  run: (ctx) => { legacyRuns += Number(ctx.args?.amount ?? 0); },
};
const legacyProjection = defineCommand(legacyDefinition);

test('legacy facade preserves registration and rebinding without leaking run', () => {
  assert(commandById('test.legacy') === legacyProjection, 'id lookup');
  assert(commandsByMenu('Edit')[0] === legacyProjection, 'menu lookup');
  assert(resolveHotkey('control+l') === legacyProjection, 'hotkey lookup');
  assert(registeredCommands()[0] === legacyProjection, 'palette lookup');
  assert(!('run' in legacyProjection), 'legacy declaration returns inert projection');
  runCommand('test.legacy', { args: { amount: 2 } });
  assert(legacyRuns === 2, 'legacy runCommand enters the authority');

  const rebound = rebindHotkey('test.legacy', 'Ctrl+]');
  assert(rebound.ok, 'punctuation rebind accepted');
  assert(resolveHotkey('Ctrl+]') === legacyProjection, 'new binding resolves');
  assert(resolveHotkey('Ctrl+L') === undefined, 'old binding released');
  assert(hotkeyFor('test.legacy') === 'ctrl+]', 'effective binding exposed');
  const saved = exportHotkeys();
  assert(saved['test.legacy'] === 'ctrl+]', 'override exported');
  loadHotkeys(saved);
  assert(resolveHotkey('Ctrl+]') === legacyProjection, 'override load is idempotent');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
