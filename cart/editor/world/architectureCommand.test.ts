import {
  applyArchitectureCommand,
  architectureCommandId,
  deleteEdgeCommand,
  flipOpeningFacingCommand,
  moveOpeningCommand,
  setSideFinishCommand,
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

test('the opening gizmo verbs build their exact engine commands (req_4738)', () => {
  const move = moveOpeningCommand('arch:move-opening:9', 5, 'wall:e:0:o:0', { columnU: 24, rowU: 4 });
  assert(move.kind === 'moveOpening' && move.expectedRevision === 5, 'move command envelope drifted');
  assert(move.kind === 'moveOpening' && move.openingId === 'wall:e:0:o:0' && move.columnU === 24 && move.rowU === 4, 'move command cell drifted');
  const flip = flipOpeningFacingCommand('arch:flip-opening:9', 5, {
    id: 'wall:e:0:o:0', kind: 'door', kitId: 'build:wall:opening:door:door-001',
    columnU: 24, rowU: 0, facingSide: 'a', hinge: 'start',
  });
  assert(flip.kind === 'configureOpening', 'flip must ride configureOpening');
  assert(flip.kind === 'configureOpening' && flip.opening.facingSide === 'b', 'flip did not turn side a to b');
  const flipBack = flipOpeningFacingCommand('arch:flip-opening:10', 6, {
    id: 'wall:e:0:o:0', kind: 'door', kitId: 'build:wall:opening:door:door-001',
    columnU: 24, rowU: 0, facingSide: 'b', hinge: 'end',
  });
  assert(flipBack.kind === 'configureOpening' && flipBack.opening.facingSide === 'a', 'flip did not turn side b to a');
  assert(flip.kind === 'configureOpening'
    && flip.opening.openingId === 'wall:e:0:o:0'
    && flip.opening.kind === 'door'
    && flip.opening.kitId === 'build:wall:opening:door:door-001'
    && flip.opening.columnU === 24
    && flip.opening.rowU === 0
    && flip.opening.hinge === 'start', 'flip must carry the whole record unchanged except facing');
  assert(architectureCommandId('move-opening', 9) === 'arch:move-opening:9', 'move command id drifted');
  assert(architectureCommandId('flip-opening', 9) === 'arch:flip-opening:9', 'flip command id drifted');
});

test('the wall side-finish verb builds its exact engine command (req_4739)', () => {
  const dress = setSideFinishCommand('arch:side-finish:3', 7, 'wall:e:0', 'b', 'shader:brick');
  assert(dress.kind === 'setSideFinish' && dress.expectedRevision === 7, 'side-finish envelope drifted');
  assert(dress.kind === 'setSideFinish' && dress.edgeId === 'wall:e:0' && dress.side === 'b' && dress.materialId === 'shader:brick', 'side-finish payload drifted');
  assert(architectureCommandId('side-finish', 3) === 'arch:side-finish:3', 'side-finish command id drifted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
