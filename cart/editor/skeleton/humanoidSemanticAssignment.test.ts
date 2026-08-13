// Humanoid stable-role assignment (display names are deliberately irrelevant).
//
//   tools/esbuild cart/editor/skeleton/humanoidSemanticAssignment.test.ts --bundle \
//     --outfile=/tmp/humanoid-semantic-assignment.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/humanoid-semantic-assignment.test.js

import type { SemanticTable } from '../agent/seatApi';
import type { ModelSelectionSnapshot } from '../model/modelSelectionFocus';
import {
  assignHumanoidSemanticSelection,
  humanoidSemanticMembershipFromPartName,
  planHumanoidSemanticAssignment,
  stampHumanoidSemanticsFromParts,
} from './humanoidSemanticAssignment';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void) { try { run(); passed++; log(`  ok  ${name}`); } catch (error) { failed++; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function faceSelection(region: number | null, count = 2): ModelSelectionSnapshot {
  return {
    version: 1,
    mode: 3,
    count: 1,
    affectedVertices: 4,
    selectedTriangles: count,
    truncated: false,
    pivot: [0, 0, 0],
    bounds: [-1, -1, -1, 1, 1, 1],
    vertices: [],
    edges: [],
    triangles: Array.from({ length: count }, (_, id) => ({
      id,
      group: 4,
      part: 0,
      material: null,
      region,
      instance: region === null ? null : 0,
      vertices: [0, 1, 2],
      normal: [0, 1, 0],
      area: 1,
    })),
  };
}

test('a complete display region receives anatomy without being renamed', () => {
  const table: SemanticTable = { version: 1, regions: [{ id: 7, name: 'Sleeve Piece 04', role: 'authored' }] };
  const plan = planHumanoidSemanticAssignment(table, faceSelection(7), [{ id: 7, faces: 2 }], { role: 'upper_arm', side: 'left' });
  assert(plan.kind === 'update-region', `expected region metadata edit, got ${plan.kind}`);
  assert(plan.displayName === 'Sleeve Piece 04', 'stable role assignment rewrote the display name');
  assert(plan.table.regions[0]?.role === 'upper_arm:left', 'exact stable role key was not authored');
  assert(plan.table.regions[0]?.name === 'Sleeve Piece 04', 'display label did not remain independent');
});

test('an unnamed selection creates an exact role row without name inference', () => {
  const table: SemanticTable = { version: 1, regions: [{ id: 2, name: 'Pelvis', role: 'authored' }], nextRegionId: 3 };
  const plan = planHumanoidSemanticAssignment(table, faceSelection(null), [], { role: 'pelvis' });
  assert(plan.kind === 'assign-selection', `expected selection assignment, got ${plan.kind}`);
  assert(plan.table.regions.find((row) => row.id === plan.regionId)?.role === 'pelvis', 'created row did not carry stable pelvis identity');
  assert(plan.displayName === 'Pelvis Anatomy', 'display-name collision was not resolved independently');
  assert(table.regions[0]?.role === 'authored', 'the similarly named row was treated as a role alias');
});

test('an existing role row is reused after arbitrary display rename', () => {
  const table: SemanticTable = { version: 1, regions: [{ id: 9, name: 'Whatever the artist wants', role: 'foot:right' }] };
  const plan = planHumanoidSemanticAssignment(table, faceSelection(null), [{ id: 9, faces: 3 }], { role: 'foot', side: 'right' });
  assert(plan.kind === 'assign-selection' && plan.regionId === 9, 'role lookup depended on display name');
  assert(plan.displayName === 'Whatever the artist wants', 'role reuse rewrote the display label');
});

test('paired roles require a side and center roles reject one', () => {
  const selection = faceSelection(null);
  const table: SemanticTable = { version: 1, regions: [] };
  assert(planHumanoidSemanticAssignment(table, selection, [], { role: 'upper_arm' }).kind === 'rejected', 'side-less upper arm was accepted');
  assert(planHumanoidSemanticAssignment(table, selection, [], { role: 'pelvis', side: 'left' }).kind === 'rejected', 'sided pelvis was accepted');
});

test('executor lands a role-only table edit through the native semantic door', () => {
  let received: { region: number; remove: number; table: SemanticTable } | null = null;
  const table: SemanticTable = { version: 1, regions: [{ id: 4, name: 'Custom Torso Label', role: 'authored' }] };
  const receipt = assignHumanoidSemanticSelection({
    __mesh_semantic_state: () => JSON.stringify({ table, regions: [{ id: 4, faces: 2 }] }),
    __mesh_edit_selection: () => JSON.stringify(faceSelection(4)),
    __mesh_semantic_region_edit: (region, remove, tableJson) => {
      received = { region, remove, table: JSON.parse(tableJson) };
      return 0;
    },
  }, { role: 'chest' });
  assert(receipt?.applied === true, 'zero-membership metadata edit was mistaken for refusal');
  assert(received?.region === 4 && received.remove === 0, 'executor used the wrong native semantic operation');
  assert(received?.table.regions[0]?.name === 'Custom Torso Label', 'native edit changed the display name');
  assert(received?.table.regions[0]?.role === 'chest', 'native edit did not receive the stable role');
});

test('part aliases are exact after punctuation normalization', () => {
  assert(humanoidSemanticMembershipFromPartName('Upper Leg Left')?.role === 'upper_leg', 'spaced part alias was not recognized');
  assert(humanoidSemanticMembershipFromPartName('upper-leg-left')?.side === 'left', 'part side was not retained');
  assert(humanoidSemanticMembershipFromPartName('decorative_upper_leg_left') === null, 'substring guessing mislabeled a decorative part');
});

test('part stamp declares stable roles and sends one ordered native transaction', () => {
  let received: { stamps: number[]; table: SemanticTable } | null = null;
  const receipt = stampHumanoidSemanticsFromParts({
    __mesh_semantic_state: () => JSON.stringify({ table: { version: 1, regions: [] } }),
    __mesh_semantic_stamp_part_ranges: (stamps, tableJson) => {
      received = { stamps: [...stamps], table: JSON.parse(tableJson) };
      return 18;
    },
  }, [
    { name: 'head', lo: 20, hi: 30 },
    { name: 'cape', lo: 30, hi: 40 },
    { name: 'pelvis', lo: 0, hi: 10 },
  ]);
  assert(receipt?.recognizedParts === 2 && receipt.changedTriangles === 18, 'part stamp receipt lost native counts');
  assert(received?.stamps.join(',') === '0,10,0,20,30,1', 'recognized ranges were not sent in group order');
  assert(received?.table.regions[0]?.role === 'pelvis', 'pelvis role was not declared');
  assert(received?.table.regions[1]?.role === 'head', 'head role was not declared');
});

log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} (${passed} passed)`);
if (failed) throw new Error(`${failed} humanoid semantic assignment tests failed`);
