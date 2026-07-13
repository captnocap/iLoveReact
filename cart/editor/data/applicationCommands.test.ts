// cart/editor/data/applicationCommands.test.ts — first command-authority canary.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/applicationCommands.test.ts --bundle \
//     --outfile=/tmp/editor-application-commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-application-commands.test.js
import { type CommandOutcome, type CommandSource } from '../../../runtime/commands';
import {
  WORLD_FLOOR_STEP_COMMAND_ID,
  WORLD_MAX_FLOOR,
  createEditorApplicationCommands,
  type EditorCommandAdapter,
  type WorldFloorStepResult,
} from './applicationCommands';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function harness(startFloor = 0, surface = 'world', blocked: string | null = null) {
  let floor = startFloor;
  let commits = 0;
  const outcomes: CommandOutcome[] = [];
  const adapter: EditorCommandAdapter = {
    activeSurface: () => surface,
    blockedReason: () => blocked,
    floorIndex: () => floor,
    commitFloor: (result) => { floor = result.floorIndex; commits += 1; },
  };
  return {
    commands: createEditorApplicationCommands(adapter, (outcome) => outcomes.push(outcome)),
    floor: () => floor,
    commits: () => commits,
    outcomes,
  };
}

test('menu, hotkey, Section D, and remote use the same floor handler', () => {
  const sources: CommandSource[] = ['menu', 'hotkey', 'toolbar', 'remote'];
  for (const source of sources) {
    const h = harness(4);
    const outcome = h.commands.invoke<WorldFloorStepResult>({
      invocationId: `floor:${source}`,
      commandId: WORLD_FLOOR_STEP_COMMAND_ID,
      args: { delta: 1 },
      source,
    });
    assert(outcome.status === 'applied' && outcome.result.floorIndex === 5, `${source} result drifted`);
    assert(h.floor() === 5 && h.commits() === 1, `${source} did not commit exactly once`);
    assert(h.outcomes.length === 1 && h.outcomes[0] === outcome, `${source} did not publish exactly once`);
    assert(!('actionId' in outcome), 'report-only floor choice invented an action id');
  }
});

test('both directions use one symmetric wrap rule', () => {
  const down = harness(0);
  down.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: -1 }, source: 'toolbar' });
  assert(down.floor() === WORLD_MAX_FLOOR, 'down from Ground did not wrap to the highest storey');
  const up = harness(WORLD_MAX_FLOOR);
  up.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 1 }, source: 'hotkey' });
  assert(up.floor() === 0, 'up from the highest storey did not wrap to Ground');
});

test('headless chord resolution returns the same inert command projection', () => {
  const h = harness();
  const byId = h.commands.command(WORLD_FLOOR_STEP_COMMAND_ID);
  assert(byId !== undefined && !('run' in byId), 'projection leaked a handler');
  assert(h.commands.commandsByMenu('Map')[0] === byId, 'menu projection identity drifted');
  assert(h.commands.resolveChord(']', { surface: 'world' }) === byId, 'world key projection drifted');
  assert(h.commands.resolveChord(']', { surface: 'model' }) === undefined, 'wrong mode resolved floor command');
});

test('invalid, blocked, and wrong-surface calls reject without mutation', () => {
  const invalid = harness(3);
  const bad = invalid.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 2 }, source: 'remote' });
  assert(bad.status === 'rejected' && bad.code === 'invalid-args', 'invalid delta was not rejected');
  assert(invalid.floor() === 3 && invalid.commits() === 0, 'invalid delta mutated floor');

  const blocked = harness(3, 'world', 'Add Chunk');
  const no = blocked.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 1 }, source: 'toolbar' });
  assert(no.status === 'rejected' && no.code === 'disabled', 'blocking overlay did not reject');
  assert(blocked.floor() === 3 && blocked.commits() === 0, 'blocked call mutated floor');

  const model = harness(3, 'model');
  const wrong = model.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 1 }, source: 'hotkey' });
  assert(wrong.status === 'rejected' && wrong.code === 'disabled', 'wrong surface did not reject');
  assert(model.floor() === 3 && model.commits() === 0, 'wrong surface mutated floor');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
