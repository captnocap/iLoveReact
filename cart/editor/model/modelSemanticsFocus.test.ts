import {
  filterModelFocusSemanticRows,
  modelFocusSemantics,
  semanticHorizonLines,
  NO_SEMANTIC_ID,
} from './modelSemanticsFocus';

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

test('hidden parts are a visibility filter rather than a semantic load mismatch', () => {
  const focus = modelFocusSemantics({ regions: [3, 3, 4], instances: [0, 0, 0], table }, {
    faces: 2, unnamed: 0, hiddenFaces: 1, hiddenNamedFaces: 1, hiddenRegions: 1,
    regions: [{ id: 3, faces: 2, instances: 1 }], table,
  });
  assert(focus.status === 'visibility-filtered', 'hidden semantic faces were reported as lost');
  assert(focus.residentHiddenNamedFaces === 1 && focus.residentHiddenFaces === 1, 'hidden semantic totals were omitted');
  assert(focus.rows.find((row) => row.id === 4)?.presence === 'not-visible', 'hidden region was not identified as filtered');
});

test('documents with no saved or resident names remain honestly empty', () => {
  const focus = modelFocusSemantics({ regions: [NO_SEMANTIC_ID], instances: [NO_SEMANTIC_ID], table: null }, null);
  assert(focus.status === 'none' && focus.rows.length === 0, 'anonymous document invented semantics');
});

test('face regions and edge paths remain visibly distinct in the Names projection', () => {
  const semanticTable = {
    ...table,
    edgeRegions: [{
      id: 5,
      name: 'door.hinge',
      role: 'hinge' as const,
      objectId: 'driver-door',
      closed: false,
      vertices: [10, 11, 12],
    }],
  };
  const focus = modelFocusSemantics({ regions: [3, 3, 4], instances: [0, 0, 0], table: semanticTable }, {
    faces: 3,
    unnamed: 0,
    regions: [{ id: 3, faces: 2, instances: 1 }, { id: 4, faces: 1, instances: 1 }],
    table: semanticTable,
  });
  const all = filterModelFocusSemanticRows(focus.rows, '');
  assert(all.faces.length === 2, `Names projection lost face regions (${all.faces.length})`);
  assert(all.edges.length === 1 && all.edges[0]?.name === 'door.hinge', 'Names projection hid the named edge path');
  assert(all.edges[0]?.edges === 2 && all.edges[0]?.presence === 'resident', 'edge path summary lost its resident edge count');
  assert(filterModelFocusSemanticRows(focus.rows, 'driver-door').edges.length === 1, 'edge object id was not searchable');
  assert(filterModelFocusSemanticRows(focus.rows, 'wall').faces.length === 1, 'face role was not searchable');
});


test('horizons share a row when they agree and split only where they differ', () => {
  const agreeing = modelFocusSemantics({ regions: [3, 3, 4], instances: [0, 0, 0], table }, {
    faces: 3, unnamed: 0, regions: [{ id: 3, faces: 2, instances: 1 }, { id: 4, faces: 1, instances: 1 }], table,
  });
  const collapsed = semanticHorizonLines(agreeing);
  assert(collapsed.length === 1, `agreeing horizons printed ${collapsed.length} lines instead of one`);
  assert(collapsed[0]!.label === 'in sync', 'three agreeing horizons should read as one in-sync row');
  assert(collapsed[0]!.value.includes('tris'), 'per-triangle counts must be labelled as triangles');

  // The common case while naming: disk and mount still match, only the live mesh
  // has moved on. Two rows — never saved and mount repeating each other (req_3892).
  const liveDrift = modelFocusSemantics({ regions: [3, 3, 4], instances: [0, 0, 0], table }, {
    faces: 5, unnamed: 0, regions: [{ id: 3, faces: 4, instances: 1 }, { id: 4, faces: 1, instances: 1 }], table,
  });
  const split = semanticHorizonLines(liveDrift);
  assert(split.length === 2, `a live-only drift printed ${split.length} rows instead of two`);
  assert(split[0]!.label === 'saved+mount', `agreeing horizons did not share a row (got "${split[0]!.label}")`);
  assert(split[1]!.label === 'live', `the drifted horizon should stand alone (got "${split[1]!.label}")`);
  assert(split[0]!.value !== split[1]!.value, 'two rows must never carry the same numbers');
});

console.log(`modelSemanticsFocus: ${passed} passed`);
