// cart/editor/world/worldOutliner.test.ts — the world outliner read-model (req_4737).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/worldOutliner.test.ts --bundle \
//     --outfile=/tmp/world-outliner.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/world-outliner.test.js
import {
  buildWorldOutliner,
  outlinerExpansionForSelection,
  pieceComponents,
  selectedOutlinerKeys,
  wallComponents,
  type WorldOutlinerSection,
} from './worldOutliner';
import type { ArchitectureSource, WallEdge } from './architecture';
import type { PlacedPiece } from './pieces';
import { instanceCount, worldFloraPatchInstances, type WorldFloraPatch } from './surfaceFlora';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function edge(id: string, startVertexId: string, endVertexId: string, openings: WallEdge['openings'] = []): WallEdge {
  return {
    id, startVertexId, endVertexId,
    support: { kind: 'absolute', baseYU: 0 },
    heightU: 48, thicknessU: 4, profile: 'solid' as WallEdge['profile'], styleId: 'style.concrete',
    sideA: { materialId: 'm.a' }, sideB: { materialId: 'm.b' },
    openings,
  };
}

function architecture(edges: WallEdge[], vertices: { id: string; xU: number; zU: number; floor?: number }[]): ArchitectureSource {
  return {
    version: 1,
    revision: 1,
    walls: {
      vertices: vertices.map((vertex) => ({ id: vertex.id, floor: vertex.floor ?? 0, xU: vertex.xU, zU: vertex.zU })),
      edges,
      anchors: [],
    },
  };
}

function piece(id: string, pieceId: string, x: number, z: number, floor = 0): PlacedPiece {
  return { id, pieceId, x, y: 0, z, yawDegrees: 0, floor };
}

function patch(id: string, speciesId: string, x: number, z: number, seed: number): WorldFloraPatch {
  return { id, speciesId, x, y: 0, z, density: 1, radiusM: 3, seed };
}

const OAK = 'builtin-flora:oak';

function sectionByKey(sections: WorldOutlinerSection[], key: string): WorldOutlinerSection {
  const section = sections.find((candidate) => candidate.key === key);
  if (!section) throw new Error(`section ${key} missing`);
  return section;
}

test('walls sharing vertices group into one building; islands stay separate', () => {
  const source = architecture(
    [edge('e1', 'v1', 'v2'), edge('e2', 'v2', 'v3'), edge('e9', 'v8', 'v9')],
    [
      { id: 'v1', xU: 0, zU: 0 }, { id: 'v2', xU: 48, zU: 0 }, { id: 'v3', xU: 48, zU: 48 },
      { id: 'v8', xU: 320, zU: 0 }, { id: 'v9', xU: 368, zU: 0 },
    ],
  );
  const components = wallComponents(source);
  assert(components.length === 2, `expected 2 buildings, got ${components.length}`);
  assert(components[0]!.edges.length === 2, 'connected pair did not group');
  assert(components[1]!.edges.length === 1, 'island wall lost');
});

test('building rows nest wall rows, and openings nest under their wall', () => {
  const source = architecture(
    [edge('e1', 'v1', 'v2', [{ id: 'o1', kind: 'door' as any, kitId: 'kit.door', columnU: 8, rowU: 0, facingSide: 'a', hinge: 'start' }])],
    [{ id: 'v1', xU: 0, zU: 0 }, { id: 'v2', xU: 96, zU: 0 }],
  );
  const buildings = sectionByKey(buildWorldOutliner({ architecture: source, pieces: [], worldFlora: [], floraSpecies: [] }), 'buildings');
  assert(buildings.count === 1, 'building count wrong');
  const building = buildings.rows[0]!;
  assert(building.children.length === 1, 'wall row missing');
  const wall = building.children[0]!;
  assert(wall.label === 'Wall · 6m', `wall length label drifted: ${wall.label}`);
  assert(wall.target?.kind === 'wallEdge', 'wall row lost its selection target');
  assert(wall.children.length === 1 && wall.children[0]!.target?.kind === 'wallOpening', 'opening row missing');
});

test('touching pieces form one structure; a lone piece is a prop row', () => {
  const pieces = [
    piece('p1', 'floor.concrete.common', 1.5, 1.5),
    piece('p2', 'floor.concrete.common', 4.5, 1.5),
    piece('p3', 'pillar.concrete.common', 60, 60),
  ];
  const components = pieceComponents(pieces);
  assert(components.length === 2, `expected 2 components, got ${components.length}`);
  const sections = buildWorldOutliner({ architecture: architecture([], []), pieces, worldFlora: [], floraSpecies: [] });
  const structures = sectionByKey(sections, 'structures');
  const props = sectionByKey(sections, 'props');
  assert(structures.rows.length === 1 && structures.rows[0]!.children.length === 2, 'touching floors did not group');
  assert(structures.rows[0]!.target?.kind === 'pieceGroup', 'structure row lost its group target');
  assert(props.rows.length === 1 && props.rows[0]!.label === 'Concrete Pillar', 'lone pillar missing from props');
});

test('a flora patch is a nested group whose children are the rendered scatter', () => {
  const one = patch('f1', OAK, 10, 10, 7);
  const sections = buildWorldOutliner({ architecture: architecture([], []), pieces: [], worldFlora: [one], floraSpecies: [] });
  const flora = sectionByKey(sections, 'flora');
  assert(flora.rows.length === 1, 'species group missing');
  const species = flora.rows[0]!;
  assert(species.label === 'Oak Tree', `species label drifted: ${species.label}`);
  const patchRow = species.children[0]!;
  assert(patchRow.target?.kind === 'floraPatch', 'patch row lost its target');
  const expected = worldFloraPatchInstances(one, 'tree');
  assert(expected.length === instanceCount('tree', one.density, one.seed), 'derivation self-check failed');
  assert(patchRow.children.length === expected.length, `plant rows ${patchRow.children.length} != scatter ${expected.length}`);
  if (expected.length > 0) {
    const focus = patchRow.children[0]!.focus;
    assert(!!focus && Math.abs(focus.x - expected[0]!.x) < 1e-9 && Math.abs(focus.z - expected[0]!.z) < 1e-9,
      'plant row focus does not land on the rendered plant');
    assert(patchRow.children[0]!.target?.kind === 'floraPatch', 'plant row must select its patch');
  }
});

test('surface flora nests under its owning piece', () => {
  const owner: PlacedPiece = {
    ...piece('p1', 'floor.concrete.common', 1.5, 1.5),
    surfaceFlora: [{ id: 's1', speciesId: OAK, role: 'top', triangle: 0, lx: 0, ly: 0, lz: 0, density: 1, radiusM: 2, seed: 3 }],
  };
  const props = sectionByKey(buildWorldOutliner({ architecture: architecture([], []), pieces: [owner], worldFlora: [], floraSpecies: [] }), 'props');
  const row = props.rows[0]!;
  assert(row.children.length === 1 && row.children[0]!.label === 'Oak Tree', 'surface patch row missing');
});

test('selection keys and auto-expansion trace the path to a viewport pick', () => {
  const one = patch('f1', OAK, 10, 10, 7);
  const sections = buildWorldOutliner({ architecture: architecture([], []), pieces: [], worldFlora: [one], floraSpecies: [] });
  const keys = selectedOutlinerKeys({
    selectedPieceIds: ['p9'],
    architectureSelection: { kind: 'wallEdge', edgeId: 'e1', side: 'a' },
    selectedFloraPatchId: 'f1',
  });
  assert(keys.has('piece:p9') && keys.has('wall:e1') && keys.has('flora:f1'), 'selection keys drifted');
  const expand = outlinerExpansionForSelection(sections, keys);
  assert(expand.has(`flora-species:${OAK}`), 'selected patch did not expand its species group');
});

test('label numbering is stable across unrelated additions', () => {
  const base = [edge('b1', 'v1', 'v2'), edge('a1', 'v3', 'v4')];
  const vertices = [
    { id: 'v1', xU: 0, zU: 0 }, { id: 'v2', xU: 48, zU: 0 },
    { id: 'v3', xU: 320, zU: 0 }, { id: 'v4', xU: 368, zU: 0 },
  ];
  const before = wallComponents(architecture(base, vertices));
  const after = wallComponents(architecture(
    [...base, edge('z9', 'v5', 'v6')],
    [...vertices, { id: 'v5', xU: 640, zU: 0 }, { id: 'v6', xU: 688, zU: 0 }],
  ));
  assert(before[0]!.anchorEdgeId === after[0]!.anchorEdgeId && before[1]!.anchorEdgeId === after[1]!.anchorEdgeId,
    'adding a distant wall reordered existing buildings');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
