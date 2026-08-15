import {
  applyArchitectureCommand,
  architectureCommandId,
  deleteEdgeCommand,
  type ArchitectureMutationHost,
} from './architectureCommand';
import { emptyArchitectureSource, type ArchitectureSource } from './architecture';
import type { ArchitectureCommand, MutationReceipt } from './architectureHost';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    log(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const receipt = { commandId: 'x', revision: 1, affectedBounds: [], dirtyTargets: [] } as unknown as MutationReceipt;

/** Fake engine: each apply returns a NEW source object with revision+1 and one
 * more vertex, so adoption is observable by identity and content. */
function fakeHost(): ArchitectureMutationHost {
  return {
    mutate(source: ArchitectureSource, command: ArchitectureCommand) {
      const next: ArchitectureSource = {
        ...source,
        revision: source.revision + 1,
        walls: {
          ...source.walls,
          vertices: [...source.walls.vertices, { id: `${command.commandId}:v:0`, floor: 0, xU: source.revision * 16, zU: 0 }],
        },
      };
      return { source: next, receipt: { ...receipt, commandId: command.commandId } };
    },
  };
}

function drawCommand(commandId: string, expectedRevision: number): ArchitectureCommand {
  return {
    commandId,
    expectedRevision,
    kind: 'drawWall',
    floor: 0,
    start: { xU: 0, zU: 0 },
    end: { xU: 48, zU: 0 },
    support: { kind: 'absolute', baseYU: 0 },
    heightU: 48,
    thicknessU: 4,
    profile: 'full',
    styleId: 'build:wall:style:basic',
    sideAMaterialId: 'build:wall:style:basic',
    sideBMaterialId: 'build:wall:style:basic',
  };
}

test('apply adopts the engine source and surfaces its receipt', () => {
  const source = emptyArchitectureSource();
  const result = applyArchitectureCommand(source, drawCommand('arch:draw:1', 0), fakeHost());
  assert(result.status === 'applied', 'apply did not succeed');
  assert(result.source !== source, 'engine source was not a new retained object');
  assert(result.source.revision === 1 && result.source.walls.vertices.length === 1, 'engine source was not adopted');
  assert(result.receipt.commandId === 'arch:draw:1', 'receipt identity was lost');
});

test('an engine rejection surfaces its reason and changes nothing', () => {
  const source = emptyArchitectureSource();
  const host: ArchitectureMutationHost = { mutate: () => { throw new Error('stale_source_revision'); } };
  const result = applyArchitectureCommand(source, drawCommand('arch:draw:1', 0), host);
  assert(result.status === 'rejected', 'engine rejection did not surface');
  assert(result.reason.includes('stale_source_revision'), 'rejection reason was lost');
  assert(source.walls.vertices.length === 0 && source.revision === 0, 'rejection mutated the source');
});

test('command ids are minted from the editor seq', () => {
  assert(architectureCommandId('draw', 41) === 'arch:draw:41', 'draw command id drifted');
  assert(architectureCommandId('delete-edge', 7) === 'arch:delete-edge:7', 'delete command id drifted');
  const command = deleteEdgeCommand('arch:delete-edge:7', 3, 'edge:0');
  assert(command.kind === 'deleteEdge' && command.expectedRevision === 3 && command.edgeId === 'edge:0', 'delete command shape drifted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
