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
  COMMANDS, MENUS, blockingOverlay, commandById, commandEnabled, deviceToolReplayable, menuNodes, meshActionBarCommands, meshPartCommands, meshToolActive, meshToolCommands, meshTopoCommands, modelContextMenuLayout,
  menuDropdownLeft, publishCharacterRigUndoDepths, undoDepths, worldActionBarCommands, type MenuNode,
} from './commands';
import { BUILD_PIECE_EXPORT_TARGETS } from './buildExports';
import { BUILD_PIECE_STARTERS } from './buildStarters';
import { PROP_EXPORT_TARGETS, propExportCommandId } from './propExports';
import { commandForKeyEvent, worldViewSlotForKey, WORLD_VIEW_SLOT_COUNT } from './keymap';
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

test('input-owning character rig history overrides mesh undo depth and enablement', () => {
  const state = {
    workspaceDocuments: [{ id: 'model', kind: 'model', sourceId: 'model-1', title: 'Model' }],
    activeWorkspaceDocumentId: 'model',
    materialFocused: false,
    modelTool: { blocking: null, paint: false },
    worldUndo: [],
    worldRedo: [],
  } as unknown as EditorState;
  publishCharacterRigUndoDepths(3, 1, true);
  try {
    const depths = undoDepths(state);
    assert(depths.source === 'rig' && depths.undo === 3 && depths.redo === 1,
      'active rig did not own the global undo depths');
    assert(commandEnabled(commandById('undo-local'), state).on, 'rig Undo was disabled with history available');
    assert(commandEnabled(commandById('redo-local'), state).on, 'rig Redo was disabled with history available');
    publishCharacterRigUndoDepths(0, 0, true);
    const refusal = commandEnabled(commandById('undo-local'), state);
    assert(!refusal.on && refusal.reason === 'character rig history empty', 'empty rig history reported the wrong owner');
  } finally {
    publishCharacterRigUndoDepths(0, 0, false);
  }
});

test('the live/disk paint picker blocks every competing editor command', () => {
  const state = { modelTool: { blocking: 'paint-conflict' } } as unknown as EditorState;
  const block = blockingOverlay(state);
  assert(block?.id === 'paint-conflict' && block.label.includes('Live / Disk'), 'paint conflict escaped modal discipline');
});

test('the exact extrusion panel blocks competing editor commands', () => {
  const state = { modelTool: { blocking: 'extrude' } } as unknown as EditorState;
  const block = blockingOverlay(state);
  assert(block?.id === 'extrude' && block.label === 'Extrude', 'extrusion inputs escaped modal discipline');
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
  assert(commands.includes('mesh-face-polygon'), 'single-face Face to N-gon disappeared');
  assert(commands.includes('mesh-extrude-face'), 'single-face Extrude disappeared');
  assert(commands.includes('mesh-flip-face'), 'single-face Flip disappeared');
  assert(commands.includes('mesh-select-uv-orientation'), 'single-face UV orientation collection disappeared');
  assert(commands.includes('mesh-tris-to-quads'), 'whole-topology Tris to Quads still depends on a multi-face selection');
});

test('Face to N-gon is strict to one selected authored face', () => {
  assert(ids(meshTopoCommands({ selMode: 3, sel: 1 }, 1)).includes('mesh-face-polygon'), 'one face cannot reach Face to N-gon');
  assert(!ids(meshTopoCommands({ selMode: 3, sel: 2 }, 1)).includes('mesh-face-polygon'), 'multi-face selection incorrectly exposes Face to N-gon');
  assert(!ids(meshTopoCommands({ selMode: 3, sel: 0 }, 1)).includes('mesh-face-polygon'), 'empty face selection incorrectly exposes Face to N-gon');
});

test('face mode exposes the whole-topology quad scan without a selection', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 0 }, 0));
  assert(commands.join('|') === 'mesh-tris-to-quads', 'empty Face mode did not expose exactly the global topology scan');
});

test('bevel is contextual to one corner or any sharp manifold edge selection', () => {
  const vertex = ids(meshTopoCommands({ selMode: 1, sel: 1 }));
  const vertices = ids(meshTopoCommands({ selMode: 1, sel: 2 }));
  const edge = ids(meshTopoCommands({ selMode: 2, sel: 1 }));
  const edges = ids(meshTopoCommands({ selMode: 2, sel: 2 }));
  const boundary = ids(meshTopoCommands({ selMode: 2, sel: 4 }));
  assert(vertex.includes('mesh-bevel') && vertex.includes('mesh-extrude'), 'single target vertex lost Bevel or mixed extrusion');
  assert(!vertices.includes('mesh-bevel') && vertices.includes('mesh-align-loop') && vertices.includes('mesh-weld'), 'multi-vertex selection lost Align Loop/Weld or still exposes Bevel');
  assert(edge.includes('mesh-bevel'), 'single-edge Bevel disappeared');
  assert(edges.includes('mesh-bevel') && edges.includes('mesh-align-loop'), 'two-edge selection cannot reach joined Bevel or lost Align Loop');
  assert(boundary.includes('mesh-bevel'), '3+ edge selection cannot reach joined Bevel or boundary chamfer');
  assert(meshTopoCommands({ selMode: 2, sel: 4 }).find((command) => command.id === 'mesh-bevel')?.name === 'Bevel Edges', 'multi-edge action kept the ambiguous single-edge label');
});

test('Edge Split is available for any edge selection and never masquerades as face detach', () => {
  const one = ids(meshTopoCommands({ selMode: 2, sel: 1 }));
  const many = ids(meshTopoCommands({ selMode: 2, sel: 8 }));
  assert(one.includes('mesh-edge-split') && many.includes('mesh-edge-split'), 'edge selection cannot reach Edge Split');
  assert(!ids(meshTopoCommands({ selMode: 1, sel: 2 })).includes('mesh-edge-split'), 'vertex mode exposed Edge Split');
  assert(!ids(meshTopoCommands({ selMode: 3, sel: 2 })).includes('mesh-edge-split'), 'face mode exposed Edge Split instead of Detach Faces');
  assert(ids(meshTopoCommands({ selMode: 3, sel: 2 })).includes('mesh-detach'), 'face Detach disappeared while adding Edge Split');
});

test('Edge to Tubes is available only for selected edges', () => {
  assert(ids(meshTopoCommands({ selMode: 2, sel: 1 })).includes('mesh-edge-tubes'), 'one selected edge cannot become a tube');
  assert(ids(meshTopoCommands({ selMode: 2, sel: 12 })).includes('mesh-edge-tubes'), 'an edge network cannot become connected tubes');
  assert(!ids(meshTopoCommands({ selMode: 1, sel: 2 })).includes('mesh-edge-tubes'), 'vertex mode exposed Edge to Tubes');
  assert(!ids(meshTopoCommands({ selMode: 3, sel: 2 })).includes('mesh-edge-tubes'), 'face mode exposed Edge to Tubes');
});

test('one target vertex exposes the mixed edge-to-vertex extrusion', () => {
  const vertex = meshTopoCommands({ selMode: 1, sel: 1 });
  const extrude = vertex.find((command) => command.id === 'mesh-extrude');
  assert(extrude?.name === 'Extrude Edge to Vertex', 'mixed edge+vertex extrusion is not discoverable from the target vertex');
});

test('Align Loop is one contextual A action for vertex rows and multi-edge loops', () => {
  const command = commandById('mesh-align-loop');
  assert(command.key === 'A', 'Align Loop lost its direct hotkey');
  assert(!ids(meshTopoCommands({ selMode: 1, sel: 1 })).includes(command.id), 'one vertex incorrectly exposes loop alignment');
  assert(ids(meshTopoCommands({ selMode: 1, sel: 4 })).includes(command.id), 'selected vertex loop cannot reach alignment');
  assert(!ids(meshTopoCommands({ selMode: 2, sel: 1 })).includes(command.id), 'one edge incorrectly exposes loop alignment');
  assert(ids(meshTopoCommands({ selMode: 2, sel: 4 })).includes(command.id), 'selected edge loop cannot reach alignment');
  assert(!ids(meshTopoCommands({ selMode: 3, sel: 1 })).includes(command.id), 'face mode incorrectly exposes vertex-loop alignment');
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
  const resolve = (selMode: number, sel: number) => commandForKeyEvent({
    ...base,
    modelTool: { blocking: null, paint: false, selMode, sel },
  } as EditorState, 'a', mods);
  assert(resolve(1, 4) === command.id, 'Vertex-mode A did not resolve Align Loop');
  assert(resolve(2, 4) === command.id, 'Edge-mode A did not resolve Align Loop');
  assert(resolve(3, 1) === null, 'Face-mode A stole a key it does not own');
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
  assert(one.includes('mesh-linear-array') && one.includes('mesh-path-array'), 'focused part cannot reach both straight and curved array workflows');
  assert(many.includes('mesh-merge-down'), 'two selected rows expose structural merge');
});

test('model context menu folds stable tool families without hiding a command', () => {
  const layout = modelContextMenuLayout(true, 2);
  assert(layout.groups.map((group) => group.id).join('|') === 'select|gizmo|mirror|view', 'context groups drifted');
  assert(ids(layout.groups[0]!.commands).join('|') === 'mesh-view|mesh-vertex|mesh-edge|mesh-face|mesh-persistent-additive', 'select modes and additive preference escaped their group');
  assert(ids(layout.groups[1]!.commands).join('|') === 'mesh-move|mesh-scale|mesh-scale-by|mesh-rotate', 'gizmos escaped their group');
  assert(ids(layout.groups[2]!.commands).join('|') === 'mesh-sym-x|mesh-sym-y|mesh-sym-z|mesh-mirror-x|mesh-mirror-y|mesh-mirror-z', 'mirror edit and part axes are not together');
  assert(ids(layout.groups[3]!.commands).join('|') === 'mesh-focus|mesh-wire|mesh-measurements|mesh-player-scale|mesh-xray|mesh-cam-lock|mesh-cam-store|mesh-cam-recall', 'view tools escaped their group');
  assert(ids(layout.directToolCommands).join('|') === 'mesh-paint|mesh-path-plane|mesh-path-edges|mesh-curve-pull', 'Paint Faces, both Pen tools, and Curve Pull must remain one click away');
  assert(ids(layout.directPartCommands).join('|') === 'mesh-duplicate-part|mesh-linear-array|mesh-path-array|mesh-merge-down|mesh-import-part', 'primary part verbs must remain direct');

  const expected = ids([...meshToolCommands(), commandById('mesh-scale-by'), ...meshPartCommands(true, 2)]).sort().join('|');
  const presented = ids([
    ...layout.groups.flatMap((group) => group.commands),
    ...layout.directToolCommands,
    ...layout.directPartCommands,
  ]).sort().join('|');
  assert(presented === expected, `context layout lost or duplicated commands: ${presented}`);
});

test('model action bar contains only foundational and persistent-state tools', () => {
  assert(ids(meshActionBarCommands()).join('|') === [
    'mesh-view', 'mesh-vertex', 'mesh-edge', 'mesh-face',
    'mesh-move', 'mesh-scale', 'mesh-rotate',
    'mesh-sym-x', 'mesh-sym-y', 'mesh-sym-z',
    'mesh-paint',
  ].join('|'), 'occasional model commands returned to the permanent action bar');
});

test('input preferences are not replayed as remembered pointer-device tools', () => {
  assert(commandById('mesh-xray').tool !== true, 'X-Ray was registered as a replayable input tool');
  assert(!deviceToolReplayable('mesh-xray', 'model'), 'a stale device slot can still replay X-Ray');
  assert(commandById('mesh-persistent-additive').tool !== true, 'Additive Select was registered as a replayable input tool');
  assert(!deviceToolReplayable('mesh-persistent-additive', 'model'), 'a stale device slot can toggle Additive Select');
  assert(deviceToolReplayable('mesh-face', 'model'), 'the device gate rejected a real model input tool');
});

test('Additive Select highlights only from its explicit preference state', () => {
  const base = { selMode: 3, gizmoTool: 0, paint: false, focus: false, wire: false };
  assert(!meshToolActive('mesh-persistent-additive', base), 'Additive Select invented an enabled state');
  assert(meshToolActive('mesh-persistent-additive', { ...base, persistentAdditive: true }), 'Additive Select did not highlight when enabled');
});

test('View Only is the explicit neutral model tool and has a direct 0 shortcut', () => {
  const neutral = { selMode: 0, gizmoTool: 0, paint: false, pathPlane: false, pathEdges: false, focus: false, wire: false };
  assert(meshToolActive('mesh-view', neutral), 'neutral model state did not highlight View Only');
  assert(!meshToolActive('mesh-vertex', neutral) && !meshToolActive('mesh-edge', neutral) && !meshToolActive('mesh-face', neutral), 'an element overlay remained active in View Only');
  assert(deviceToolReplayable('mesh-view', 'model'), 'View Only cannot be remembered as the active pointer-device tool');

  const state = {
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
    modelTool: { ...neutral, blocking: null, sel: 0 },
  } as unknown as EditorState;
  const mods = { ctrl: false, shift: false, alt: false, meta: false };
  assert(commandForKeyEvent(state, '0', mods) === 'mesh-view', '0 did not resolve the neutral model view tool');
});

test('measurement furniture is default-off presentation state, not replayable input', () => {
  assert(commandById('mesh-measurements').tool !== true, 'Measurements were registered as a replayable input tool');
  assert(commandById('mesh-player-scale').tool !== true, 'Player Scale was registered as a replayable input tool');
  assert(!deviceToolReplayable('mesh-measurements', 'model'), 'a stale device slot can arm Measurements');
  assert(!deviceToolReplayable('mesh-player-scale', 'model'), 'a stale device slot can arm Player Scale');
  const view = menuNodes('View').filter((node) => node.kind === 'cmd').map((node) => node.id);
  assert(view.includes('mesh-measurements') && view.includes('mesh-player-scale'), 'Studio View menu cannot reach both measurement overlays');
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
  assert(!newMesh!.children.some((node) => node.kind === 'cmd' && node.id === 'new-model-player'), 'Player / NPC creation must remain an export-time role');
  assert(!COMMANDS.some((command) => command.id === 'new-model-player'), 'removed Player / NPC creation command remains registered');
});

test('Export Build Piece carries base kinds only — doors live in ONE export home (req_4725)', () => {
  const exportMenu = menuNodes('File').find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export');
  const build = exportMenu?.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export Build Piece');
  assert(!!build, 'File menu lost Export Build Piece');
  const commandIds = build!.children.filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  const expected = BUILD_PIECE_EXPORT_TARGETS.map((target) => `export-build-piece-${target.id}`);
  assert(commandIds.join('|') === expected.join('|'), `build export menu drifted: ${commandIds.join(', ')}`);
  // The twin door lanes are RETIRED: doors and garage doors export through
  // Doors & Windows (the opening-kit lane) and nowhere else — two menu homes
  // for one meaning is how a kit lands in the wrong system.
  assert(!commandIds.includes('export-build-piece-door-wall'), 'the retired Door Wall duplicate returned');
  assert(!commandIds.includes('export-build-piece-garage-door-wall'), 'the retired Garage Door Wall duplicate returned');
  const openings = exportMenu?.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Export Wall Opening');
  assert(!!openings && openings.label === 'Doors & Windows', 'the opening-kit export must wear the palette vocabulary');
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
  assert(MENUS.includes('Animation'), 'registry-backed Animation menu is absent from chrome');
  assert(menuNodes('Animation').length === 0, 'Animation commands leaked into the legacy command table');
});

// req_4663: the menu reorganization exists so no command is stranded off-menu again —
// actions were reachable only from the action bar with no hotkey and no menu row.
test('every registered command is reachable through the menu tree', () => {
  const reachable = new Set<string>();
  const walk = (nodes: MenuNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'cmd') reachable.add(node.id);
      else if (node.kind === 'sub') walk(node.children);
    }
  };
  for (const menu of MENUS) walk(menuNodes(menu));
  // The one deliberate absence: the world-piece delete id is the contextual dispatch
  // target behind the Edit → Delete Selection row — a second Del row would be noise.
  const covered = new Set([...reachable, WORLD_PIECE_DELETE_COMMAND_ID]);
  const missing = COMMANDS.filter((command) => !covered.has(command.id)).map((command) => command.id);
  assert(missing.length === 0, `commands unreachable from any menu: ${missing.join(', ')}`);
});

test('the View menu owns camera and display control for both surfaces', () => {
  const view = menuNodes('View').filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  for (const id of ['toggle-minimap', 'focus-selection', 'world-view-store', 'world-view-recall',
    'mesh-focus', 'mesh-cam-lock', 'mesh-cam-store', 'mesh-cam-recall',
    'mesh-wire', 'mesh-xray', 'mesh-measurements', 'mesh-player-scale', 'model-ref-images']) {
    assert(view.includes(id), `View menu lost ${id}`);
  }
});

test('the Mesh menu is collapsible families, never one flat overflow list', () => {
  const top = menuNodes('Mesh');
  assert(top.length > 0 && top.every((node) => node.kind === 'sub'), 'Mesh menu regressed to a flat command list');
  const families = top.map((node) => (node as Extract<MenuNode, { kind: 'sub' }>).id);
  assert(families.join('|') === ['Select', 'Transform', 'Topology', 'Draw', 'Parts', 'Paint'].join('|'), `Mesh families drifted: ${families.join(', ')}`);
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

  // Saved views (req_4168/req_4172): H recalls the active pin, bare 1..9 jump to a slot.
  assert(commandForKeyEvent(state, 'h', mods) === 'world-view-recall', 'H did not reach Recall View on the world');
  assert(worldViewSlotForKey(state, '1', mods) === 1, '1 did not resolve the first view slot');
  assert(worldViewSlotForKey(state, '9', mods) === WORLD_VIEW_SLOT_COUNT, '9 did not resolve the last view slot');
  assert(worldViewSlotForKey(state, '0', mods) === null, '0 resolved a slot — the list is 1-based');
  assert(worldViewSlotForKey(state, 'a', mods) === null, 'a letter resolved a slot');
  // A digit only means a slot BARE: chords belong to the command table, and the
  // model surface's 1/2/3 are vertex/edge/face and outrank any bookmark reading.
  for (const held of ['ctrl', 'shift', 'alt', 'meta'] as const) {
    assert(worldViewSlotForKey(state, '1', { ...mods, [held]: true }) === null, `${held}+1 resolved a view slot`);
  }
  const onModel = { ...state, activeWorkspaceDocumentId: 'model-doc', workspaceDocuments: [{ id: 'model-doc', kind: 'model', sourceId: 'm1' }] } as unknown as EditorState;
  assert(worldViewSlotForKey(onModel, '1', mods) === null, '1 resolved a view slot on the model surface — it is the vertex mode there');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
