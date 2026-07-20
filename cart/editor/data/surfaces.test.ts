// Explicit surface routing tests. Unknown/new documents must never inherit
// world command authority by fallthrough.
import { activeSurface } from './surfaces';
import { commandById, commandEnabled, undoDepths } from './commands';
import type { EditorState, WorkspaceDocumentKind } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function stateFor(kind: WorkspaceDocumentKind): EditorState {
  return {
    workspaceDocuments: [{ id: `${kind}:test`, kind, title: kind }],
    activeWorkspaceDocumentId: `${kind}:test`,
    materialFocused: false,
    worldUndo: [{ id: 'world-entry' }],
    worldRedo: [],
    modelTool: { blocking: null, paint: false, sel: 0 },
    selectedPieceId: null,
    selectedObjectId: null,
    newMeshPrompt: null,
    fileExplorerOpen: false,
    mapDocumentOpen: false,
    buildDialogOpen: false,
    addChunkOpen: false,
  } as unknown as EditorState;
}

test('knowledge routes to a non-world surface', () => {
  const state = stateFor('knowledge');
  assert(activeSurface(state) === 'knowledge', 'knowledge defaulted to world');
  assert(undoDepths(state).source === 'knowledge' && undoDepths(state).undo === 0, 'knowledge inherited world undo');
});

test('world commands are disabled while knowledge is in view', () => {
  const state = stateFor('knowledge');
  const command = commandById('select-tool');
  const enabled = commandEnabled(command, state);
  assert(!enabled.on && enabled.reason?.includes('world editor'), 'knowledge received world command authority');
});

log(`\nsurfaces: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} surface test(s) failed`);
