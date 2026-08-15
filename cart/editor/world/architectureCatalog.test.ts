import {
  architectureCatalogHierarchy,
  architecturePaletteRows,
  installArchitectureCatalogFromPackages,
  projectArchitectureCatalog,
  projectArchitectureCatalogEntry,
  queryArchitecturePalette,
  queryInstalledArchitectureCatalog,
  searchArchitectureCatalog,
  structuredArchitectureCatalogQuery,
  type ArchitectureCatalogNative,
  type ArchitectureManifestPackage,
} from './architectureCatalog';
import type { ArchitectureCatalogEntry, ArchitectureCatalogQuery, ArchitectureKitPlaceable } from './architecture';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HASH_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const HASH_D = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

function stylePackage(categoryPath: readonly string[] = ['Wall', 'Styles']): ArchitectureManifestPackage {
  const placeable: ArchitectureKitPlaceable = {
    as: 'architecture-kit',
    family: 'wall',
    role: 'style',
    catalogPath: categoryPath,
    themeTags: ['modern'],
    gameplayTags: ['residential'],
    measurement: {
      sourceBoundsU: { minXU: 0, minYU: 0, minZU: -1.25, maxXU: 16, maxYU: 48, maxZU: 1.25 },
      clearanceMask: [],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
    install: {
      catalogId: 'build:wall:style:measured',
      contentHash: HASH_A,
      wallStyleProfile: 'full',
      assetRefs: { meshContentHash: HASH_B, materialContentHashes: [HASH_C] },
    },
  };
  return { id: 'package:wall-style', name: 'Measured Wall', placeable, paints: [{ id: 1 }, { id: 2 }] };
}

function doorPackage(catalogId = 'build:wall:opening:door:measured'): ArchitectureManifestPackage {
  const placeable: ArchitectureKitPlaceable = {
    as: 'architecture-kit',
    family: 'wall',
    role: 'opening',
    semanticKind: 'door',
    catalogPath: ['Wall', 'Openings', 'Doors'],
    themeTags: ['modern'],
    gameplayTags: ['residential'],
    measurement: {
      sourceBoundsU: { minXU: -1, minYU: 0, minZU: -2, maxXU: 17, maxYU: 33, maxZU: 2 },
      mountBoundsU: { minU: -0.25, minV: 0.25, maxU: 15.25, maxV: 31.25 },
      footprint: { minColumn: -1, minRow: 0, maxColumnExclusive: 16, maxRowExclusive: 32 },
      clearanceMask: [{ columnU: -2, rowU: 0 }, { columnU: 16, rowU: 0 }],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
    install: {
      catalogId,
      contentHash: HASH_C,
      wallOpeningCompatibility: {
        permittedProfiles: ['full'],
        permittedThicknessU: [4],
        portalClass: 'walk',
      },
      assetRefs: { meshContentHash: HASH_D, materialContentHashes: [] },
    },
  };
  return { id: 'package:door', name: 'Measured Door', placeable, paints: [{ id: 1 }, { id: 2 }, { id: 3 }] };
}

function misleadingTrimPackage(): ArchitectureManifestPackage {
  const placeable: ArchitectureKitPlaceable = {
    as: 'architecture-kit',
    family: 'wall',
    role: 'trim',
    catalogPath: ['Wall', 'Trim'],
    themeTags: [],
    gameplayTags: [],
    measurement: {
      sourceBoundsU: { minXU: 0, minYU: 0, minZU: 0, maxXU: 16, maxYU: 2, maxZU: 2 },
      clearanceMask: [],
      pivotU: { xU: 0, yU: 0, zU: 0 },
    },
    install: {
      catalogId: 'build:wall:opening:door:this-text-is-not-behavior',
      contentHash: HASH_D,
      assetRefs: { meshContentHash: HASH_A, materialContentHashes: [] },
    },
  };
  return { id: 'package:not-a-door', name: 'Door Text Trim', placeable };
}

class FakeNative implements ArchitectureCatalogNative {
  entries: ArchitectureCatalogEntry[] = [];
  installCalls = 0;

  installCatalog(entries: readonly ArchitectureCatalogEntry[]): void {
    this.installCalls += 1;
    this.entries = [...entries];
  }

  queryCatalog(query: ArchitectureCatalogQuery): number[] {
    return this.entries.flatMap((entry, index) => {
      if (entry.family !== query.family) return [];
      if (query.role && entry.role !== query.role) return [];
      if (query.semanticKind && entry.semanticKind !== query.semanticKind) return [];
      if (query.requiredThemeTags?.some(tag => !entry.themeTags.includes(tag))) return [];
      if (query.requiredGameplayTags?.some(tag => !entry.gameplayTags.includes(tag))) return [];
      return [index];
    });
  }

  readCatalog(): ArchitectureCatalogEntry[] {
    return [...this.entries];
  }
}

test('typed family and role beat door-like catalog and package IDs', () => {
  const entry = projectArchitectureCatalogEntry(misleadingTrimPackage());
  assert(entry?.role === 'trim' && entry.semanticKind === undefined, 'ID text changed typed role meaning');
  const native = new FakeNative();
  installArchitectureCatalogFromPackages([misleadingTrimPackage()], native);
  assert(queryInstalledArchitectureCatalog({ family: 'wall', role: 'opening' }, native).length === 0,
    'door-like ID entered an opening query');
});

test('moving a category changes hierarchy only, never identity or behavior', () => {
  const before = projectArchitectureCatalog([stylePackage(['Wall', 'Styles'])])[0]!;
  const after = projectArchitectureCatalog([stylePackage(['Wall', 'Styles', 'Modern'])])[0]!;
  assert(before.catalogId === after.catalogId && before.contentHash === after.contentHash, 'category move changed stable identity');
  assert(before.family === after.family && before.role === after.role, 'category move changed typed behavior');
  const tree = architectureCatalogHierarchy([after]);
  assert(tree[0]?.children[0]?.children[0]?.label === 'Modern', 'moved category was not projected into hierarchy');
});

test('palette and procedural consumers use the same native structured query rows', () => {
  const native = new FakeNative();
  installArchitectureCatalogFromPackages([stylePackage(), doorPackage(), misleadingTrimPackage()], native);
  const query: ArchitectureCatalogQuery = {
    family: 'wall', role: 'opening', semanticKind: 'door',
    requiredThemeTags: ['modern'], requiredGameplayTags: ['residential'],
  };
  const procedural = queryInstalledArchitectureCatalog(query, native).map(entry => entry.catalogId);
  const palette = queryArchitecturePalette(query, native).map(entry => entry.catalogId);
  assert(procedural.join('|') === palette.join('|'), 'palette and procedural query projections diverged');
  assert(procedural.join('|') === 'build:wall:opening:door:measured', 'structured query returned the wrong typed row');
});

test('paint skins dress one installed kit and never expand catalog rows', () => {
  const entry = doorPackage();
  assert(entry.paints?.length === 3, 'fixture lost its skin variants');
  const rows = projectArchitectureCatalog([entry]);
  assert(rows.length === 1, `three paints expanded into ${rows.length} catalog rows`);
  assert(architecturePaletteRows(rows).length === 1, 'palette multiplied paint skins');
});

test('search and query requests copy typed data without granting ID semantics', () => {
  const rows = projectArchitectureCatalog([stylePackage(), doorPackage(), misleadingTrimPackage()]);
  assert(searchArchitectureCatalog(rows, 'modern').length === 2, 'typed tags were not searchable');
  assert(searchArchitectureCatalog(rows, 'Doors').length === 1, 'category hierarchy was not searchable');
  assert(searchArchitectureCatalog(rows, 'this-text-is-not-behavior').length === 0, 'catalog ID text leaked into search behavior');
  const tags = ['modern'];
  const request = structuredArchitectureCatalogQuery({ family: 'wall', role: 'opening', requiredThemeTags: tags });
  tags.push('mutated-after-request');
  assert(request.requiredThemeTags?.join('|') === 'modern', 'structured query retained caller mutation');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
