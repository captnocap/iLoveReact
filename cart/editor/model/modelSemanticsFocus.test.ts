import { modelFocusSemantics, NO_SEMANTIC_ID } from './modelSemanticsFocus';

let passed = 0;
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
const table = { version: 1 as const, regions: [
  { id: 3, name: 'panel.wall', role: 'wall' },
  { id: 4, name: 'boss.cap', role: 'cap' },
] };

test('saved semantics with an anonymous resident surface a load mismatch', () => {
  const focus = modelFocusSemantics({ regions: [3, 3, 4], instances: [0, 0, 0], table }, {
    faces: 3, unnamed: 3, regions: [], table: { version: 1, regions: [] },
  });
  assert(focus.status === 'load-mismatch' && focus.savedRegions === 2 && focus.residentRegions === 0, 'load mismatch was hidden');
  assert(focus.rows.every((row) => row.presence === 'mount-only'), 'mounted regions lost by native hydration were misidentified');
});

test('disk semantics dropped before ModelView surface as a mount mismatch', () => {
  const focus = modelFocusSemantics(
    { regions: [3, 3, 4], instances: [0, 0, 0], table },
    { faces: 3, unnamed: 3, regions: [], table: { version: 1, regions: [] } },
    { regions: [], instances: [], table: null },
  );
  assert(focus.status === 'mount-mismatch' && focus.mountRegions === 0, 'pre-mount loss was blamed on native hydration');
  assert(focus.rows.every((row) => row.presence === 'saved-only'), 'disk-only rows were not identified');
});

test('matching saved and resident semantics are healthy', () => {
  const focus = modelFocusSemantics({ regions: [3, 3, 4], instances: [0, 0, 0], table }, {
    faces: 3, unnamed: 0,
    regions: [{ id: 3, faces: 2, instances: 1 }, { id: 4, faces: 1, instances: 1 }],
    table,
  });
  assert(focus.status === 'healthy' && focus.residentNamedFaces === 3, 'healthy semantic state was rejected');
});

test('documents with no saved or resident names remain honestly empty', () => {
  const focus = modelFocusSemantics({ regions: [NO_SEMANTIC_ID], instances: [NO_SEMANTIC_ID], table: null }, null);
  assert(focus.status === 'none' && focus.rows.length === 0, 'anonymous document invented semantics');
});

console.log(`modelSemanticsFocus: ${passed} passed`);
