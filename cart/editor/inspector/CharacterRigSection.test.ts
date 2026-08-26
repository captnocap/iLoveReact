// Character Rig panel layout + host-slider contract.
//
//   tools/esbuild cart/editor/inspector/CharacterRigSection.test.ts --bundle \
//     --outfile=/tmp/character-rig-section.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/character-rig-section.test.js

import { Slider } from '../../../runtime/primitives';
import type {
  CharacterRigApi,
  CharacterRigCommand,
  CharacterRigSnapshot,
} from '../../../runtime/skeleton';
import { REGIONS } from '../shell/regions';
import { C } from '../workspace.cls';
import { HUMANOID_SEMANTIC_ROLE_CHOICES, humanoidSemanticRoleKey } from '../skeleton/humanoidSemanticAssignment';
import CharacterRigSection from './CharacterRigSection';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function snapshot(revision = 4): CharacterRigSnapshot {
  return {
    sessionId: 'rig:panel-test',
    revision,
    state: 'bound',
    externalProvenance: null,
    viewportActive: true,
    viewportHydration: { status: 'ready', boneCount: 1, logicalVertexCount: 48, deformedMesh: true, detail: 'test' },
    specimenSeparation: 2.5,
    bodyTopology: {
      componentCount: 1,
      mainLogicalVertexCount: 48,
      mainTriangleCount: 80,
      detachedLogicalVertexCount: 0,
      detachedTriangleCount: 0,
      detachedFaceIndices: [],
      detachedSelectionComplete: true,
    },
    semanticCoverage: {
      bodyFaceCount: 80,
      coveredBodyFaceCount: 80,
      uncoveredBodyFaceCount: 0,
      missingRequiredRoles: [],
      roleFaceCounts: [],
      uncoveredFaceIndices: [],
      uncoveredSelectionComplete: true,
    },
    selectedBoneId: 'lower_arm_left',
    selectedVertex: null,
    bones: [{
      id: 'lower_arm_left',
      displayName: 'Left Lower Arm',
      parent: null,
      transform: { pos: [0, 1, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] },
      tip: [0, 0.5, 0],
      joint: { kind: 'hinge', axis: [1, 0, 0], limits: { min: 0, max: Math.PI * 5 / 6 } },
      fit: { source: 'boundary', confidence: 0.95, locked: false },
      segmentLength: 0.5,
    }],
    semanticBindings: [],
    objectBindings: [{ objectId: 'body-with-a-long-stable-object-id', mode: 'body' }],
    overlay: { bindMesh: true, deformedMesh: true, axes: true, names: true, heatmap: false },
    testPose: { name: 'bind' },
    history: { canUndo: true, canRedo: true, undoDepth: 3, redoDepth: 1 },
    readiness: [
      { id: 'connected_body', status: 'ready', ready: true, detail: 'one connected body' },
      { id: 'required_semantics', status: 'ready', ready: true, detail: 'required anatomy roles' },
      { id: 'canonical_skeleton', status: 'ready', ready: true, detail: 'canonical skeleton' },
      { id: 'current_topology_hash', status: 'ready', ready: true },
      { id: 'current_semantic_hash', status: 'ready', ready: true },
      { id: 'current_object_binding_hash', status: 'ready', ready: true },
      { id: 'saved_four_influence_weights', status: 'ready', ready: true },
    ],
    weightsStale: false,
    fitNeedsReview: true,
    bindNeedsReview: true,
  };
}

function unexpectedInspect<T>(): T {
  throw new Error('inspect was not expected');
}

function unexpectedPreflight(): never {
  throw new Error('preflightAttach was not expected');
}

function unexpectedCommitSave(): CharacterRigSnapshot {
  throw new Error('commitSave was not expected');
}

function elementsOfType(root: any, type: any): any[] {
  const found: any[] = [];
  const visit = (node: any): void => {
    if (node == null || node === false || node === true) return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (typeof node !== 'object') return;
    if (node.type === type) found.push(node);
    visit(node.props?.children);
  };
  visit(root);
  return found;
}

function elementsWhere(root: any, predicate: (node: any) => boolean): any[] {
  const found: any[] = [];
  const visit = (node: any): void => {
    if (node == null || node === false || node === true) return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (typeof node !== 'object') return;
    if (predicate(node)) found.push(node);
    visit(node.props?.children);
  };
  visit(root);
  return found;
}

test('character rig renders inside the panel\'s ONE width, which the user can drag', () => {
  // req_4774 retired the dedicated 720px character-rig width. A pane no longer
  // owns a width: the panel has one, every pane wears it, and a rig that needs
  // more room is a drag away — in the same gesture every other pane offers.
  assert((REGIONS.focusPanel as Record<string, unknown>).characterRigWidth === undefined,
    'a per-pane character rig width came back — that is the tab-to-tab churn req_4774 removed');
  assert(REGIONS.focusPanel.resizeMaxWidth >= 720,
    'the shared drag can no longer reach the width character bind inspection wants');

  const tree = CharacterRigSection({
    api: null,
    snapshot: snapshot(),
    onSnapshot: () => {},
    onStatus: () => {},
    onMutated: () => {},
  });
  assert(tree.type === C.HW_RigWorkspace, 'character rig did not use its bounded workspace root');
  const columns = elementsOfType(tree, C.HW_RigColumn);
  assert(columns.length === 2, `expected two independently scrolling columns, found ${columns.length}`);
  assert(columns.every((column) => column.props.showScrollbar === true), 'a rig column lost its scrollbar');
});

test('failed native open shows the exact fault and retries the retained request', () => {
  let retried = 0;
  let received: CharacterRigSnapshot | null = null;
  let status = '';
  const api: CharacterRigApi = {
    available: () => true,
    preflightAttach: unexpectedPreflight,
    open: () => { throw new Error('open was not expected'); },
    currentOpenFault: () => 'invalid character rig open payload: InvalidRangeObjectIds',
    retryOpen: () => { retried += 1; return snapshot(5); },
    command: () => { throw new Error('command was not expected'); },
    undo: () => { throw new Error('undo was not expected'); },
    redo: () => { throw new Error('redo was not expected'); },
    snapshot: () => { throw new Error('snapshot was not expected'); },
    inspect: unexpectedInspect,
    prepareSave: () => { throw new Error('prepareSave was not expected'); },
    commitSave: unexpectedCommitSave,
    close: () => {},
  };
  const tree = CharacterRigSection({
    api,
    snapshot: null,
    onSnapshot: (next) => { received = next; },
    onStatus: (message) => { status = message; },
    onMutated: () => {},
  });
  const notices = elementsOfType(tree, C.HW_RigWrapText);
  assert(notices.some((row) => row.props.children === 'invalid character rig open payload: InvalidRangeObjectIds'),
    'native open fault was hidden behind a generic opening state');
  const buttons = elementsOfType(tree, C.HW_VerbPrimary);
  assert(buttons.length === 1, `expected one retry button, found ${buttons.length}`);
  buttons[0].props.onPress();
  assert(retried === 1 && received?.revision === 5, 'retry did not publish the recovered native snapshot');
  assert(status === 'character rig session opened', 'successful retry did not clear the visible failure status');
});

test('joint-angle scrub stays host-owned and commits one native snapshot cycle', () => {
  let current = snapshot();
  const commands: CharacterRigCommand[] = [];
  let snapshots = 0;
  let mutations = 0;
  const api: CharacterRigApi = {
    available: () => true,
    preflightAttach: unexpectedPreflight,
    open: () => current,
    command: (command) => {
      commands.push(command);
      current = { ...current, revision: current.revision + 1, testPose: command.kind === 'setTestPose' ? command.pose : current.testPose };
      return current;
    },
    undo: () => current,
    redo: () => current,
    snapshot: () => current,
    inspect: unexpectedInspect,
    prepareSave: () => { throw new Error('prepareSave was not expected'); },
    commitSave: unexpectedCommitSave,
    close: () => {},
  };
  const tree = CharacterRigSection({
    api,
    snapshot: current,
    onSnapshot: () => { snapshots += 1; },
    onStatus: (message) => { throw new Error(message); },
    onMutated: () => { mutations += 1; },
  });
  const sliders = elementsOfType(tree, Slider);
  assert(sliders.length === 1, `expected one host Slider, found ${sliders.length}`);
  assert(sliders[0].props.onChange === undefined, 'joint slider streamed per-frame JavaScript changes');
  assert(typeof sliders[0].props.onCommit === 'function', 'joint slider lost its release commit');

  sliders[0].props.onCommit(42.25);
  assert(commands.length === 1, `slider release sent ${commands.length} commands`);
  assert(commands[0]?.kind === 'setTestPose', 'slider release sent the wrong rig command');
  assert(commands[0]?.kind !== 'setTestPose' || commands[0].pose.name === 'selected_joint', 'slider release lost selected-joint mode');
  assert(commands[0]?.kind !== 'setTestPose' || commands[0].pose.angleDeg === 42.25, 'slider release changed the committed angle');
  assert(snapshots === 1, `slider release applied ${snapshots} snapshots`);
  assert(mutations === 0, 'a test-pose preview dirtied the authored bind');
});

test('numeric joint-origin edits request anchored child joints', () => {
  let current = snapshot();
  current = {
    ...current,
    bones: current.bones.map((bone) => ({ ...bone, parent: 'upper_arm_left' })),
  };
  let command: CharacterRigCommand | null = null;
  const api: CharacterRigApi = {
    available: () => true,
    preflightAttach: unexpectedPreflight,
    open: () => current,
    command: (next) => { command = next; return { ...current, revision: current.revision + 1 }; },
    undo: () => current,
    redo: () => current,
    snapshot: () => current,
    inspect: unexpectedInspect,
    prepareSave: () => { throw new Error('prepareSave was not expected'); },
    commitSave: unexpectedCommitSave,
    close: () => {},
  };
  const tree = CharacterRigSection({
    api,
    snapshot: current,
    onSnapshot: () => {},
    onStatus: (message) => { throw new Error(message); },
    onMutated: () => {},
  });
  const steppers = elementsOfType(tree, C.HW_OvBtn);
  assert(steppers.length >= 2, 'joint-origin steppers were not rendered');
  steppers[0].props.onPress();
  assert(command?.kind === 'setJointTransform', 'origin stepper sent the wrong command');
  assert(command?.kind !== 'setJointTransform' || command.preserveChildren === true, 'origin stepper did not anchor child joints');
});

test('rig history buttons publish snapshots and mark the restored document dirty', () => {
  let current = snapshot();
  const commands: CharacterRigCommand[] = [];
  let snapshots = 0;
  let mutations = 0;
  const api: CharacterRigApi = {
    available: () => true,
    preflightAttach: unexpectedPreflight,
    open: () => current,
    command: (command) => {
      commands.push(command);
      current = {
        ...current,
        revision: current.revision + 1,
        history: command.kind === 'undo'
          ? { canUndo: true, canRedo: true, undoDepth: 2, redoDepth: 2 }
          : { canUndo: true, canRedo: true, undoDepth: 3, redoDepth: 1 },
      };
      return current;
    },
    undo: () => current,
    redo: () => current,
    snapshot: () => current,
    inspect: unexpectedInspect,
    prepareSave: () => { throw new Error('prepareSave was not expected'); },
    commitSave: unexpectedCommitSave,
    close: () => {},
  };
  const tree = CharacterRigSection({
    api,
    snapshot: current,
    onSnapshot: () => { snapshots += 1; },
    onStatus: (message) => { throw new Error(message); },
    onMutated: () => { mutations += 1; },
  });
  const buttons = elementsOfType(tree, C.HW_VerbPrimary);
  const buttonNamed = (label: string) => buttons.find((button) =>
    button.props.children?.props?.children === label);
  const undo = buttonNamed('Undo · 3');
  const redo = buttonNamed('Redo · 1');
  assert(typeof undo?.props.onPress === 'function' && typeof redo?.props.onPress === 'function',
    'available rig history was not exposed as explicit controls');
  undo.props.onPress();
  redo.props.onPress();
  assert(commands[0]?.kind === 'undo' && commands[1]?.kind === 'redo', 'history buttons sent the wrong native commands');
  assert(snapshots === 2, `history traversal published ${snapshots} snapshots instead of two`);
  assert(mutations === 2, 'undo/redo did not mark the restored authored document dirty');
});

test('unbound probes and bind-dependent checks do not masquerade as zero weights or independent blockers', () => {
  const current: CharacterRigSnapshot = {
    ...snapshot(),
    state: 'needs_bind',
    bodyTopology: {
      componentCount: 3,
      mainLogicalVertexCount: 120,
      mainTriangleCount: 180,
      detachedLogicalVertexCount: 7,
      detachedTriangleCount: 3,
      detachedFaceIndices: [4, 9, 27],
      detachedSelectionComplete: true,
    },
    semanticCoverage: {
      bodyFaceCount: 180,
      coveredBodyFaceCount: 150,
      uncoveredBodyFaceCount: 30,
      missingRequiredRoles: ['chest', 'head'],
      roleFaceCounts: [],
      uncoveredFaceIndices: [],
      uncoveredSelectionComplete: false,
    },
    selectedVertex: {
      logicalVertexId: 27,
      renderDuplicateCount: 3,
      modelPosition: [0.125, 1.25, -0.5],
      influences: [
        { boneId: null, weight: 0 },
        { boneId: null, weight: 0 },
        { boneId: null, weight: 0 },
        { boneId: null, weight: 0 },
      ],
    },
    readiness: [
      { id: 'connected_body', status: 'blocked', ready: false, detail: 'body has 3 logical edge components' },
      { id: 'required_semantics', status: 'blocked', ready: false, detail: 'missing 2 required roles: chest, head' },
      { id: 'canonical_skeleton', status: 'ready', ready: true, detail: 'canonical skeleton' },
      { id: 'current_topology_hash', status: 'waiting', ready: false, detail: 'bind has not established a topology hash' },
      { id: 'current_semantic_hash', status: 'waiting', ready: false, detail: 'bind has not established a semantic hash' },
      { id: 'current_object_binding_hash', status: 'waiting', ready: false, detail: 'bind has not established an object-binding hash' },
      { id: 'saved_four_influence_weights', status: 'waiting', ready: false, detail: 'no current four-influence logical binding' },
    ],
    fitNeedsReview: false,
    bindNeedsReview: false,
  };
  const tree = CharacterRigSection({
    api: null,
    snapshot: current,
    onSnapshot: () => {},
    onStatus: () => {},
    onMutated: () => {},
  });

  const noticeLabels = elementsOfType(tree, C.HW_RigNoticeLabel).map((node) => node.props.children);
  assert(noticeLabels.includes('NO SKIN WEIGHTS'), 'pre-bind state did not explain the absent skin data');
  assert(noticeLabels.includes('UNBOUND VERTEX'), 'selected unbound vertex still looked like a weighted zero row');

  const wrapText = elementsOfType(tree, C.HW_RigWrapText).map((node) => node.props.children);
  assert(wrapText.includes('0.125000, 1.250000, -0.500000'), 'unbound probe hid the useful model position');
  assert(!wrapText.includes('unused'), 'unbound probe rendered unused influence slots as if they were skin data');
  const numericRows = elementsOfType(tree, C.HW_RigSliderValue).map((node) => node.props.children);
  assert(!numericRows.includes('0.0000000'), 'unbound probe rendered misleading zero-weight values');

  const readinessLabels = elementsOfType(tree, C.HW_RigReadinessLabel).map((node) => node.props.children);
  assert(readinessLabels.filter((label) => label === 'WAITING').length === 3,
    'bind hash checks remained three redundant blockers before any weights existed');
  assert(readinessLabels.includes('UNBOUND'), 'missing saved weights were not distinguished from setup blockers');
  assert(readinessLabels.filter((label) => label === 'BLOCKED').length === 2,
    'setup blockers were not kept distinct from dependent checks');

  const heatmapToggle = elementsWhere(tree, (node) => node.props?.label === 'heatmap')[0];
  assert(heatmapToggle?.props.disabled === true, 'empty heatmap remained enabled before Bind succeeded');
  const renderedHeatmapToggle = heatmapToggle.type(heatmapToggle.props);
  assert(renderedHeatmapToggle.props.onPress === undefined, 'disabled heatmap still dispatched an overlay command');
});

test('disconnected body gates rig work before edits and selects the exact detached faces for repair', () => {
  let current: CharacterRigSnapshot = {
    ...snapshot(),
    state: 'needs_bind',
    bodyTopology: {
      componentCount: 2,
      mainLogicalVertexCount: 2410,
      mainTriangleCount: 4732,
      detachedLogicalVertexCount: 3,
      detachedTriangleCount: 1,
      detachedFaceIndices: [949],
      detachedSelectionComplete: true,
    },
    semanticCoverage: {
      bodyFaceCount: 4733,
      coveredBodyFaceCount: 4733,
      uncoveredBodyFaceCount: 0,
      missingRequiredRoles: [],
      roleFaceCounts: [],
      uncoveredFaceIndices: [],
      uncoveredSelectionComplete: true,
    },
    readiness: [
      { id: 'connected_body', status: 'blocked', ready: false, detail: 'body has 2 logical edge components' },
      { id: 'required_semantics', status: 'ready', ready: true, detail: 'required anatomy roles' },
      { id: 'canonical_skeleton', status: 'ready', ready: true, detail: 'canonical skeleton' },
      { id: 'current_topology_hash', status: 'waiting', ready: false },
      { id: 'current_semantic_hash', status: 'waiting', ready: false },
      { id: 'current_object_binding_hash', status: 'waiting', ready: false },
      { id: 'saved_four_influence_weights', status: 'waiting', ready: false },
    ],
    fitNeedsReview: false,
    bindNeedsReview: false,
  };
  const events: string[] = [];
  const api: CharacterRigApi = {
    available: () => true,
    preflightAttach: unexpectedPreflight,
    open: () => current,
    command: (command) => {
      events.push(`rig:${command.kind}`);
      current = { ...current, revision: current.revision + 1 };
      return current;
    },
    undo: () => current,
    redo: () => current,
    snapshot: () => current,
    inspect: (query) => {
      events.push(`inspect:${query.kind}`);
      return { selectedFaces: 1, expectedFaces: 1 } as never;
    },
    prepareSave: () => { throw new Error('prepareSave was not expected'); },
    commitSave: unexpectedCommitSave,
    close: () => {},
  };
  const tree = CharacterRigSection({
    api,
    snapshot: current,
    onSnapshot: () => {},
    onStatus: (message) => { events.push(`status:${message}`); },
    onMutated: () => { events.push('mutated'); },
  });

  const noticeLabels = elementsOfType(tree, C.HW_RigNoticeLabel).map((node) => node.props.children);
  assert(noticeLabels.includes('BODY HAS 2 COMPONENTS · main 4732 triangles · detached 1 triangle'),
    'top gate did not state the exact component and triangle counts before rig work');

  const verbButtons = elementsOfType(tree, C.HW_VerbPrimary);
  const verbNamed = (label: string) => verbButtons.find((button) => button.props.children?.props?.children === label);
  assert(verbNamed('Fit Skeleton')?.props.onPress === undefined, 'Fit remained active on a disconnected body');
  assert(verbNamed('Bind')?.props.onPress === undefined, 'Bind remained active on a disconnected body');
  assert(verbNamed('Bind pose')?.props.onPress === undefined, 'bind-pose test remained active on a disconnected body');

  const jointSteppers = elementsOfType(tree, C.HW_OvBtn);
  assert(jointSteppers.length > 0 && jointSteppers.every((button) => button.props.onPress === undefined),
    'joint transform or constraint stepper remained active behind the topology gate');
  const sliders = elementsOfType(tree, Slider);
  assert(sliders.length === 1 && sliders[0].props.onCommit === undefined,
    'selected-joint test slider remained active behind the topology gate');
  assert(sliders[0].props.style.pointerEvents === 'none', 'gated host slider still accepted pointer input');

  const lockToggle = elementsWhere(tree, (node) => node.props?.label === 'unlocked')[0];
  assert(lockToggle?.props.disabled === true, 'joint lock control remained active behind the topology gate');
  const overlayToggle = elementsWhere(tree, (node) => node.props?.label === 'bind')[0];
  assert(overlayToggle?.props.disabled !== true, 'bind-mesh overlay inspection was incorrectly gated');
  assert(typeof overlayToggle.type(overlayToggle.props).props.onPress === 'function',
    'bind-mesh overlay stopped working while topology was being repaired');

  const selectDetached = verbNamed('Select Detached');
  assert(typeof selectDetached?.props.onPress === 'function', 'complete detached-face summary did not expose its repair action');
  selectDetached.props.onPress();
  assert(events[0] === 'rig:setViewportActive', 'detached selection did not pause the rig viewport first');
  assert(events[1] === 'inspect:selectDetached', 'detached selection did not use the same native audit-and-select pass');
  assert(events.some((event) => event === 'status:Selected all 1 detached BODY face in Face mode.'),
    'detached selection did not report its exact repair result');
  assert(!events.includes('mutated'), 'selection-only repair dirtied rig data');
});

test('anatomy roles stay actionable under readiness gates and name exact missing memberships', () => {
  const required = HUMANOID_SEMANTIC_ROLE_CHOICES.filter((choice) => choice.required).map(humanoidSemanticRoleKey);
  const present = required.filter((key) => key !== 'foot:right');
  let assigned: { role: string; side?: string } | null = null;
  const current = snapshot();
  const tree = CharacterRigSection({
    api: null,
    snapshot: current,
    onSnapshot: () => {},
    onStatus: () => {},
    onMutated: () => {},
    semanticRoleKeys: present,
    onAssignSemanticRole: (membership) => { assigned = membership; },
  });
  const noticeLabels = elementsOfType(tree, C.HW_RigNoticeLabel);
  assert(noticeLabels.some((node) => node.props.children === '1 REQUIRED ROLE MISSING'), 'exact required-role count was not shown');
  const wrapText = elementsOfType(tree, C.HW_RigWrapText);
  assert(wrapText.some((node) => node.props.children === 'Missing: Right Foot'), 'exact missing role was hidden behind a generic readiness failure');
  const rightFoot = elementsWhere(tree, (node) =>
    typeof node.props?.tooltip === 'string' && node.props.tooltip.includes('stable role foot:right'))[0];
  assert(typeof rightFoot?.props.onPress === 'function', 'role assignment was disabled by unrelated rig prerequisites');
  rightFoot.props.onPress();
  assert(assigned?.role === 'foot' && assigned?.side === 'right', 'role button sent a display label instead of stable anatomy');
});

test('external rigs assign roles to the selected generated bone and keep face semantics out of that path', () => {
  let current: CharacterRigSnapshot = {
    ...snapshot(),
    externalProvenance: { provider: 'SkinTokens', modelClass: 'articulation', seconds: 12 },
    selectedBoneId: 'external_joint_7',
    bones: [{ ...snapshot().bones[0], id: 'external_joint_7', displayName: 'M4004 8' }],
    semanticBindings: [],
  };
  let command: CharacterRigCommand | null = null;
  let faceAssignmentCalled = false;
  let mutations = 0;
  let status = '';
  const api: CharacterRigApi = {
    available: () => true,
    preflightAttach: unexpectedPreflight,
    open: () => current,
    command: (next) => {
      command = next;
      current = { ...current, revision: current.revision + 1 };
      return current;
    },
    undo: () => current,
    redo: () => current,
    snapshot: () => current,
    inspect: unexpectedInspect,
    prepareSave: () => { throw new Error('prepareSave was not expected'); },
    commitSave: unexpectedCommitSave,
    close: () => {},
  };
  const tree = CharacterRigSection({
    api,
    snapshot: current,
    onSnapshot: () => {},
    onStatus: (message) => { status = message; },
    onMutated: () => { mutations += 1; },
    semanticRoleKeys: ['head'],
    onAssignSemanticRole: () => { faceAssignmentCalled = true; },
  });
  const heads = elementsOfType(tree, C.HW_SectionTitle);
  assert(heads.some((node) => node.props.children === 'BONE ROLES'), 'external rig kept the face-role panel title');
  const noticeLabels = elementsOfType(tree, C.HW_RigNoticeLabel);
  assert(noticeLabels.some((node) => node.props.children === 'STEP 1 OF 16 · SELECT PELVIS'),
    'external rig did not open the required-role walkthrough automatically');
  const prompt = elementsOfType(tree, C.HW_RigWrapText);
  assert(prompt.some((node) => node.props.children === 'Select the central hip joint where the spine and both upper legs branch.'),
    'walkthrough hid the anatomical selection instruction');
  const confirm = elementsOfType(tree, C.HW_VerbPrimary).find((button) =>
    button.props.children?.props?.children === 'Confirm Pelvis');
  assert(typeof confirm?.props.onPress === 'function', 'selected generated bone did not enable the guided confirmation');
  confirm.props.onPress();
  assert(command?.kind === 'setSemanticBinding', 'guided confirmation did not use the native bone-binding command');
  assert(command?.kind !== 'setSemanticBinding' || (command.boneId === 'external_joint_7' && command.role === 'pelvis'),
    'external role command changed the selected bone or role');
  assert(!faceAssignmentCalled, 'external bone naming mutated selected mesh faces');
  assert(mutations === 1, 'external bone naming did not mark the rig descriptor dirty');
  assert(status === 'Pelvis confirmed. Select the joint for Abdomen.', 'walkthrough did not announce its next required joint');
});

test('guided naming refuses to overwrite an already confirmed joint on the next step', () => {
  const current: CharacterRigSnapshot = {
    ...snapshot(),
    externalProvenance: { provider: 'SkinTokens', modelClass: 'articulation', seconds: 12 },
    selectedBoneId: 'external_joint_0',
    bones: [{ ...snapshot().bones[0], id: 'external_joint_0', displayName: 'Pelvis' }],
    semanticBindings: [{ role: 'pelvis', boneId: 'external_joint_0' }],
  };
  const tree = CharacterRigSection({
    api: null,
    snapshot: current,
    onSnapshot: () => {},
    onStatus: () => {},
    onMutated: () => {},
  });
  const noticeLabels = elementsOfType(tree, C.HW_RigNoticeLabel);
  assert(noticeLabels.some((node) => node.props.children === 'STEP 2 OF 16 · SELECT ABDOMEN'),
    'walkthrough did not advance from the persisted required-role bindings');
  const confirm = elementsOfType(tree, C.HW_VerbPrimary).find((button) =>
    button.props.children?.props?.children === 'Confirm Abdomen');
  assert(confirm?.props.onPress === undefined, 'walkthrough allowed the pelvis joint to be silently rebound as abdomen');
  const prompt = elementsOfType(tree, C.HW_RigWrapText);
  assert(prompt.some((node) => typeof node.props.children === 'string' && node.props.children.includes('already named pelvis')),
    'walkthrough did not explain why the selected joint must change');
});

log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} (${passed} passed)`);
if (failed > 0) throw new Error(`${failed} Character Rig panel test(s) failed`);
