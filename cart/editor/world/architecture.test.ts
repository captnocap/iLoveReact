import {
  ARCHITECTURE_LIMITS,
  ArchitectureValidationError,
  cloneArchitectureSource,
  emptyArchitectureSource,
  requireWallEdgeSide,
  summarizeArchitecture,
  validateArchitectureCatalog,
  validateArchitectureCatalogEntry,
  validateArchitectureCatalogQuery,
  validateArchitectureKitDeclaration,
  validateArchitectureSource,
  type ArchitectureCatalogEntry,
  type ArchitectureSource,
} from './architecture';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function throwsValidation(run: () => void, expectedPath: string): ArchitectureValidationError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ArchitectureValidationError)) throw error;
    assert(error.path.includes(expectedPath), `expected validation path containing '${expectedPath}', got '${error.path}'`);
    return error;
  }
  throw new Error(`expected ArchitectureValidationError containing '${expectedPath}'`);
}

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HASH_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function validSource(): ArchitectureSource {
  return {
    version: 1,
    revision: 7,
    walls: {
      vertices: [
        { id: 'v0', floor: 3, xU: 0, zU: 0 },
        { id: 'v1', floor: 3, xU: 32, zU: 0 },
        { id: 'v2', floor: 3, xU: 32, zU: 32 },
      ],
      edges: [
        {
          id: 'edge-east',
          startVertexId: 'v0',
          endVertexId: 'v1',
          support: { kind: 'absolute', baseYU: 48 },
          heightU: 48,
          thicknessU: 4,
          profile: 'full',
          styleId: 'build:wall:style:plaster',
          sideA: { materialId: 'material:inside' },
          sideB: { materialId: 'material:outside' },
          openings: [{
            id: 'opening-door',
            kind: 'door',
            kitId: 'build:wall:opening:door:measured',
            columnU: 8,
            rowU: 0,
            facingSide: 'a',
            hinge: 'start',
          }],
        },
        {
          id: 'edge-north',
          startVertexId: 'v1',
          endVertexId: 'v2',
          support: { kind: 'absolute', baseYU: 48 },
          heightU: 48,
          thicknessU: 4,
          profile: 'full',
          styleId: 'build:wall:style:plaster',
          sideA: { materialId: 'material:north-a' },
          sideB: { materialId: 'material:north-b' },
          openings: [],
        },
      ],
      anchors: [{
        id: 'anchor-light',
        edgeId: 'edge-east',
        side: 'a',
        columnU: 24,
        rowU: 24,
        targetPieceId: 'piece:light',
      }],
    },
  };
}

function validOpeningKit(): ArchitectureCatalogEntry {
  return {
    catalogId: 'build:wall:opening:door:measured',
    contentHash: HASH_A,
    packageId: 'door-package',
    label: 'Measured Door',
    family: 'wall',
    role: 'opening',
    semanticKind: 'door',
    categoryPath: ['Wall', 'Openings', 'Doors'],
    themeTags: ['modern'],
    gameplayTags: ['residential'],
    measurement: {
      sourceBoundsU: { minXU: -1.25, minYU: 0, minZU: -2, maxXU: 16.5, maxYU: 32.25, maxZU: 2 },
      mountBoundsU: { minU: -0.25, minV: 0.25, maxU: 15.25, maxV: 31.25 },
      footprint: { minColumn: -1, minRow: 0, maxColumnExclusive: 16, maxRowExclusive: 32 },
      occupiedMask: [],
      clearanceMask: [{ columnU: -2, rowU: 0 }, { columnU: 16, rowU: 0 }],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
    wallOpeningCompatibility: {
      permittedProfiles: ['full', 'half'],
      permittedThicknessU: [4, 6],
      portalClass: 'walk',
    },
    assetRefs: { meshContentHash: HASH_B, materialContentHashes: [HASH_C] },
  };
}

function validWallStyle(): ArchitectureCatalogEntry {
  return {
    catalogId: 'build:wall:style:plaster',
    contentHash: HASH_B,
    packageId: 'wall-package',
    label: 'Plaster Wall',
    family: 'wall',
    role: 'style',
    categoryPath: ['Wall', 'Styles'],
    themeTags: [],
    gameplayTags: [],
    measurement: {
      sourceBoundsU: { minXU: 0, minYU: 0, minZU: -1.25, maxXU: 16, maxYU: 48, maxZU: 1.25 },
      clearanceMask: [],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
    wallStyleDefaults: { heightU: 48, thicknessU: 4, profile: 'full' },
    assetRefs: { meshContentHash: HASH_A, materialContentHashes: [] },
  };
}

function changedSource(change: (draft: any) => void): unknown {
  const draft: any = cloneArchitectureSource(validSource());
  change(draft);
  return draft;
}

function changedKit(change: (draft: any) => void): unknown {
  const draft: any = JSON.parse(JSON.stringify(validOpeningKit()));
  change(draft);
  return draft;
}

test('valid source, empty source, measured catalog, declaration, and query DTOs pass', () => {
  validateArchitectureSource(emptyArchitectureSource());
  validateArchitectureSource(validSource());
  validateArchitectureCatalog([validWallStyle(), validOpeningKit()]);
  validateArchitectureKitDeclaration({
    as: 'architecture-kit',
    family: 'wall',
    role: 'opening',
    catalogPath: ['Wall', 'Openings', 'Doors'],
    semanticKind: 'door',
    themeTags: ['modern'],
    gameplayTags: ['residential'],
    measurement: validOpeningKit().measurement,
  });
  validateArchitectureCatalogQuery({ family: 'wall', semanticKind: 'door', maximumWidthU: 20, wallProfile: 'full' });
});

test('strict DTO shapes reject versions, unknown fields, and derived topology', () => {
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.version = 2; })), 'version');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.roomFaces = []; })), 'roomFaces');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].twin = 'derived'; })), 'twin');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.vertices[0].angularOrder = []; })), 'angularOrder');
});

test('duplicate and missing source IDs reject before canonical lookup', () => {
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].id = 'v0'; })), 'id');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].openings[0].id = 'anchor-light'; })), 'id');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].startVertexId = 'missing'; })), 'startVertexId');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.anchors[0].edgeId = 'missing'; })), 'edgeId');
});

test('all persisted structural axes require whole bounded u values', () => {
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.vertices[0].xU = 0.5; })), 'xU');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].support.baseYU = 48.25; })), 'baseYU');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].openings[0].rowU = 6.25; })), 'rowU');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => {
    draft.walls.vertices[0].zU = ARCHITECTURE_LIMITS.maximumUnit + 1;
  })), 'zU');
});

test('millimeter aliases and float structural coordinates never enter v1 source', () => {
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.vertices[0].xMm = 1000; })), 'xMm');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].heightMeters = 3; })), 'heightMeters');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => { draft.walls.edges[0].thicknessU = 3.5; })), 'thicknessU');
});

test('deep clone isolates every nested mutable source record', () => {
  const source = validSource();
  const clone: any = cloneArchitectureSource(source);
  clone.walls.vertices[0].xU = 16;
  clone.walls.edges[0].support.baseYU = 64;
  clone.walls.edges[0].sideA.materialId = 'material:changed';
  clone.walls.edges[0].openings[0].columnU = 12;
  clone.walls.anchors[0].rowU = 20;
  equal(source.walls.vertices[0].xU, 0, 'vertex leaked through clone');
  equal(source.walls.edges[0].support.baseYU, 48, 'support leaked through clone');
  equal(source.walls.edges[0].sideA.materialId, 'material:inside', 'finish leaked through clone');
  equal(source.walls.edges[0].openings[0].columnU, 8, 'opening leaked through clone');
  equal(source.walls.anchors[0].rowU, 24, 'anchor leaked through clone');
});

test('directed edge-side lookup remains stable when arrays reorder', () => {
  const source: any = cloneArchitectureSource(validSource());
  source.walls.edges.reverse();
  source.walls.vertices.reverse();
  const sideA = requireWallEdgeSide(source, 'edge-east', 'a');
  const sideB = requireWallEdgeSide(source, 'edge-east', 'b');
  equal(sideA.edge.startVertexId, 'v0', 'directed edge start changed');
  equal(sideA.finish.materialId, 'material:inside', 'side A changed');
  equal(sideB.finish.materialId, 'material:outside', 'side B changed');
});

test('opening size belongs only to the measured kit and footprint rounds outward', () => {
  const kit = validOpeningKit();
  validateArchitectureCatalogEntry(kit);
  equal(kit.measurement.footprint!.maxColumnExclusive - kit.measurement.footprint!.minColumn, 17, 'kit width');
  equal(kit.measurement.footprint!.maxRowExclusive - kit.measurement.footprint!.minRow, 32, 'kit height');
  const source = validSource();
  assert(!Object.prototype.hasOwnProperty.call(source.walls.edges[0].openings[0], 'widthU'), 'source repeated kit width');
  throwsValidation(() => validateArchitectureSource(changedSource(draft => {
    draft.walls.edges[0].openings[0].widthU = 17;
  })), 'widthU');
  throwsValidation(() => validateArchitectureCatalogEntry(changedKit(draft => {
    draft.measurement.footprint.maxColumnExclusive = 15;
  })), 'footprint');
});

test('catalog behavior comes from typed roles, measured fields, and exact compatibility', () => {
  throwsValidation(() => validateArchitectureCatalogEntry(changedKit(draft => { draft.role = 'style'; })), 'semanticKind');
  throwsValidation(() => validateArchitectureCatalogEntry(changedKit(draft => { draft.wallOpeningCompatibility.permittedThicknessU = [4, 4]; })), 'permittedThicknessU');
  throwsValidation(() => validateArchitectureCatalog([validOpeningKit(), validOpeningKit()]), 'catalogId');
  throwsValidation(() => validateArchitectureCatalogEntry(changedKit(draft => { draft.contentHash = HASH_A.toUpperCase(); })), 'contentHash');
});

test('derived summary is recomputed from source and never persisted', () => {
  const summary = summarizeArchitecture(validSource());
  equal(summary.vertexCount, 3, 'vertex count');
  equal(summary.edgeCount, 2, 'edge count');
  equal(summary.openingCount, 1, 'opening count');
  equal(summary.anchorCount, 1, 'anchor count');
  equal(summary.floors.join(','), '3', 'floors');
  equal(summary.boundsU?.minYU, 48, 'minimum Y');
  equal(summary.boundsU?.maxYU, 96, 'maximum Y');
  assert(!Object.prototype.hasOwnProperty.call(validSource(), 'summary'), 'summary entered persisted source');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
