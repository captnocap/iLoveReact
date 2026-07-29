// cart/editor/data/commands.test.ts — model command ownership at the outliner/face
// boundary (req_2870). A multi-part outliner selection is represented by selected
// faces in the host, but its Merge verb must stay structural.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/commands.test.ts --bundle \
//     --outfile=/tmp/editor-commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-commands.test.js

import {
  COMMANDS, MENUS, commandById, menuNodes, meshPartCommands, meshToolCommands, meshTopoCommands, modelContextMenuLayout,
  menuDropdownLeft, worldActionBarCommands, type MenuNode,
} from './commands';
import { BUILD_PIECE_EXPORT_TARGETS } from './buildExports';
import { BUILD_PIECE_STARTERS } from './buildStarters';
import { PROP_EXPORT_TARGETS, propExportCommandId } from './propExports';
import { commandForKeyEvent } from './keymap';
import type { EditorState } from './types';
import { WORLD_PIECE_DELETE_COMMAND_ID, WORLD_PIECE_ROTATE_COMMAND_ID } from '../world/pieceCommandIds';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (e) { failed += 1; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
const ids = (commands: { id: string }[]) => commands.map((command) => command.id);

test('Save and Preferences are application commands on every document surface', () => {
  const save = commandById('save-snapshot');
  const preferences = commandById('open-preferences');
  assert(save.menu === 'File' && save.scope === 'global' && save.key === 'Ctrl+S', 'Save is not the global document command');
  assert(preferences.menu === 'Edit' && preferences.scope === 'global' && preferences.key === 'Ctrl+,', 'Preferences is not globally discoverable');
});

test('wide menu panels center on their chrome trigger before edge clamping', () => {
  assert(menuDropdownLeft('File') === 12, 'File menu was left-edge anchored instead of centered and clamped');
  assert(menuDropdownLeft('Window') < 448, 'Window menu still begins at its trigger left edge');
});

test('ordinary face selection still offers authored-face merge', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 2 }, 1));
  assert(commands.includes('mesh-merge-faces'), 'Merge Faces remains available for a real face selection');
  assert(commands.includes('mesh-tris-to-quads'), 'Tris to Quads is available for a real multi-face selection');
  assert(commands.includes('mesh-flip-face'), 'Flip Face is available for any real face selection');
});

test('a single face exposes winding correction and the whole-topology quad scan', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 1 }, 1));
  assert(commands.includes('mesh-extrude-face'), 'single-face Extrude disappeared');
  assert(commands.includes('mesh-flip-face'), 'single-face Flip disappeared');
  assert(commands.includes('mesh-select-uv-orientation'), 'single-face UV orientation collection disappeared');
  assert(commands.includes('mesh-tris-to-quads'), 'whole-topology Tris to Quads still depends on a multi-face selection');
});

test('face mode exposes the whole-topology quad scan without a selection', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 0 }, 0));
  assert(commands.join('|') === 'mesh-tris-to-quads', 'empty Face mode did not expose exactly the global topology scan');
});

test('bevel is contextual to exactly one vertex or edge', () => {
  const vertex = ids(meshTopoCommands({ selMode: 1, sel: 1 }));
  const vertices = ids(meshTopoCommands({ selMode: 1, sel: 2 }));
  const edge = ids(meshTopoCommands({ selMode: 2, sel: 1 }));
  const edges = ids(meshTopoCommands({ selMode: 2, sel: 2 }));
  assert(vertex.join('|') === 'mesh-bevel', 'single-vertex Bevel is not the strict contextual action');
  assert(!vertices.includes('mesh-bevel') && vertices.includes('mesh-weld'), 'multi-vertex selection still exposes Bevel');
  assert(edge.includes('mesh-bevel'), 'single-edge Bevel disappeared');
  assert(!edges.includes('mesh-bevel'), 'multi-edge selection still exposes Bevel');
});

test('B invokes Bevel in vertex and edge modes without stealing Face or Paint B', () => {
  const base = {
    workspaceDocuments: [{ id: 'model', kind: 'model', title: 'Model' }],
    activeWorkspaceDocumentId: 'model',
    materialFocused: false,
    newMeshPrompt: null,
    fileExplorerOpen: false,
    mapDocumentOpen: false,
    buildDialogOpen: false,
    addChunkOpen: false,
    worldUndo: [],
    worldRedo: [],
  } as unknown as EditorState;
  const mods = { ctrl: false, shift: false, alt: false, meta: false };
  const command = (modelTool: Partial<EditorState['modelTool']>) => commandForKeyEvent({
    ...base,
    modelTool: { blocking: null, paint: false, sel: 1, ...modelTool },
  } as EditorState, 'b', mods);
  assert(command({ selMode: 1 }) === 'mesh-bevel', 'Vertex B did not resolve Bevel');
  assert(command({ selMode: 2 }) === 'mesh-bevel', 'Edge B did not resolve Bevel');
  assert(command({ selMode: 3 }) === 'mesh-glass', 'Face B stopped resolving Glass');
  assert(command({ selMode: 0, paint: true }) === 'mesh-paint-fill', 'Paint B stopped resolving Fill');
  assert(commandById('mesh-bevel').key === 'B', 'Bevel does not advertise its live shortcut');
});

test('multi-part outliner selection cannot fall through to Merge Faces', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 12 }, 2));
  assert(!commands.includes('mesh-merge-faces'), 'Merge Faces is hidden while selected faces represent multiple parts');
  assert(commands.includes('mesh-tris-to-quads'), 'whole-topology Tris to Quads did not remain part-safe across the model');
});

test('structural merge requires the explicit selected set, not list adjacency', () => {
  const one = ids(meshPartCommands(true, 1));
  const many = ids(meshPartCommands(true, 2));
  assert(!one.includes('mesh-merge-down'), 'one selected row cannot infer a neighbor from list order');
  assert(many.includes('mesh-merge-down'), 'two selected rows expose structural merge');
});

test('model context menu folds stable tool families without hiding a command', () => {
  const layout = modelContextMenuLayout(true, 2);
  assert(layout.groups.map((group) => group.id).join('|') === 'select|gizmo|mirror|view', 'context groups drifted');
  assert(ids(layout.groups[0]!.commands).join('|') === 'mesh-vertex|mesh-edge|mesh-face', 'select modes escaped their group');
  assert(ids(layout.groups[1]!.commands).join('|') === 'mesh-move|mesh-scale|mesh-scale-by|mesh-rotate', 'gizmos escaped their group');
  assert(ids(layout.groups[2]!.commands).join('|') === 'mesh-sym-x|mesh-sym-y|mesh-sym-z|mesh-mirror-x|mesh-mirror-y|mesh-mirror-z', 'mirror edit and part axes are not together');
  assert(ids(layout.groups[3]!.commands).join('|') === 'mesh-focus|mesh-wire|mesh-cam-lock|mesh-cam-store|mesh-cam-recall', 'view tools escaped their group');
  assert(ids(layout.directToolCommands).join('|') === 'mesh-paint|mesh-path-plane|mesh-path-edges', 'Paint Faces and both Pen tools must remain one click away');
  assert(ids(layout.directPartCommands).join('|') === 'mesh-duplicate-part|mesh-path-array|mesh-merge-down|mesh-import-part', 'primary part verbs must remain direct');

  const expected = ids([...meshToolCommands(), commandById('mesh-scale-by'), ...meshPartCommands(true, 2)]).sort().join('|');
  const presented = ids([
    ...layout.groups.flatMap((group) => group.commands),
    ...layout.directToolCommands,
    ...layout.directPartCommands,
  ]).sort().join('|');
  assert(presented === expected, `context layout lost or duplicated commands: ${presented}`);
});

test('model context mirror group omits part actions without a focused part', () => {
  const layout = modelContextMenuLayout(false, 0);
  const mirror = layout.groups.find((group) => group.id === 'mirror');
  assert(!!mirror, 'Mirror group disappeared');
  assert(ids(mirror!.commands).join('|') === 'mesh-sym-x|mesh-sym-y|mesh-sym-z', 'part mirrors appeared without a focused part');
  assert(ids(layout.directPartCommands).join('|') === 'mesh-import-part', 'part generators need focus while library import remains global to the model');
});

test('New Mesh exposes every semantic build starter under one nested menu', () => {
  const newMesh = menuNodes('File').find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'New Mesh');
  assert(!!newMesh, 'File menu lost New Mesh');
  const build = newMesh!.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Build Pieces');
  assert(!!build, 'New Mesh lost its Build Pieces submenu');
  const commandIds = build!.children.filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  const expected = BUILD_PIECE_STARTERS.map((starter) => `new-build-starter-${starter.id}`);
  assert(commandIds.join('|') === expected.join('|'), `starter menu drifted: ${commandIds.join(', ')}`);
  assert(newMesh!.children.some((node) => node.kind === 'cmd' && node.id === 'new-model-player'), 'Player / NPC starter disappeared');
});

test('Export Build Piece exposes explicit door-wall meanings without a door tile', () => {
  const exportMenu = menuNodes('File').find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export');
  const build = exportMenu?.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export Build Piece');
  assert(!!build, 'File menu lost Export Build Piece');
  const commandIds = build!.children.filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  const expected = BUILD_PIECE_EXPORT_TARGETS.map((target) => `export-build-piece-${target.id}`);
  assert(commandIds.join('|') === expected.join('|'), `build export menu drifted: ${commandIds.join(', ')}`);
  assert(commandIds.includes('export-build-piece-door-wall'), 'Door Wall export is missing');
  assert(!commandIds.includes('export-build-piece-door'), 'the unrelated door tile leaked into mesh export');
});

test('Export Prop exposes gameplay roles for intersections and transit stops', () => {
  const exportMenu = menuNodes('File').find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export');
  const props = exportMenu?.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export Prop');
  assert(!!props, 'File menu lost Export Prop');
  const commandIds = props!.children.filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  const expected = PROP_EXPORT_TARGETS.map(propExportCommandId);
  assert(commandIds.join('|') === expected.join('|'), `prop export menu drifted: ${commandIds.join(', ')}`);
  for (const id of ['export-prop-stop-sign', 'export-prop-traffic-light', 'export-prop-bus-stop', 'export-prop-train-stop']) {
    assert(commandIds.includes(id), `${id} is missing`);
  }
});

test('Export Flora exposes one semantic lane choice per custom species', () => {
  const exportMenu = menuNodes('File').find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export');
  const flora = exportMenu?.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export Flora');
  assert(!!flora, 'File menu lost Export Flora');
  const commandIds = flora!.children.filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  assert(commandIds.join('|') === 'export-flora-grass|export-flora-tree|export-flora-bush', `flora export lanes drifted: ${commandIds.join(', ')}`);
});

test('dead placeholder commands and their empty menus are absent', () => {
  const commandIds = new Set(COMMANDS.map((command) => command.id));
  const removed = [
    'compile-rle', 'toggle-view-mode', 'paint-material', 'sample-material',
    'add-trigger', 'set-spawn', 'mission-point', 'author-sequence', 'show-pipeline',
  ];
  for (const id of removed) assert(!commandIds.has(id), `${id} is still registered`);
  assert(!MENUS.some((menu) => menu === ('Story' as any) || menu === ('Help' as any)), 'an empty placeholder menu remains in chrome');
});

test('Section D follows the armed tool and contains only real Build tools', () => {
  const build = worldActionBarCommands({ activeCommandId: 'select-tool' });
  assert(build.every((command) => command.menu === 'Build'), 'default world bar mirrors unrelated menu history');
  assert(build.some((command) => command.id === 'place-piece'), 'real Build tools disappeared');
  const toolIds = new Set(['select-tool', 'place-piece', 'move-selection', 'paint-faces', 'place-sticker']);
  assert(build.filter((command) => toolIds.has(command.id)).every((command) => !command.undoable), 'arming a tool still claims to be an authored edit');

  const afterFloor = worldActionBarCommands({ activeCommandId: 'world.floor.step' });
  assert(afterFloor.map((command) => command.id).join('|') === build.map((command) => command.id).join('|'), 'floor report swapped Section D family');
  assert(!afterFloor.some((command) => command.id === 'paint-material' || command.id === 'sample-material'), 'legacy material tools leaked into Section D');
});

test('the live world key bridge reaches every authority-backed tool identity', () => {
  const state = {
    workspaceDocuments: [{ id: 'world', kind: 'world', title: 'World' }],
    activeWorkspaceDocumentId: 'world',
    materialFocused: false,
    modelTool: { blocking: null },
    newMeshPrompt: null,
    fileExplorerOpen: false,
    mapDocumentOpen: false,
    buildDialogOpen: false,
    addChunkOpen: false,
    selectedPieceId: null,
    selectedObjectId: '',
    worldUndo: [],
    worldRedo: [],
  } as unknown as EditorState;
  const mods = { ctrl: false, shift: false, alt: false, meta: false };
  const expected = [
    ['escape', 'select-tool'], ['b', 'place-piece'], ['v', 'move-selection'],
    ['f', 'focus-selection'], ['n', 'paint-faces'], ['k', 'place-sticker'],
  ];
  for (const [key, id] of expected) {
    assert(commandForKeyEvent(state, key!, mods) === id, `${key} did not reach ${id}`);
  }
  const selected = { ...state, selectedPieceId: 'bp_7' } as EditorState;
  assert(commandForKeyEvent(selected, 'r', mods) === WORLD_PIECE_ROTATE_COMMAND_ID, 'R did not resolve the authored rotate identity');
  assert(commandForKeyEvent(selected, 'delete', mods) === WORLD_PIECE_DELETE_COMMAND_ID, 'Delete did not resolve the authored delete identity');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
