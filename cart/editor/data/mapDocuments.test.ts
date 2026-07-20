// Named-map document boundary tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/mapDocuments.test.ts --bundle \
//     --outfile=/tmp/editor-map-documents.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-map-documents.test.js
import {
  MAP_DOCUMENT_STEM_MAX_CHARS,
  createMapDocument,
  deleteMapDocument,
  listMapDocuments,
  mapDocumentPaths,
  recordMapDocumentRenderStats,
  renameMapDocument,
  sanitizeMapDocumentName,
} from './mapDocuments';
import { emptyWorldSave, parseWorldSaveText, readWorldSave, saveWorldNow } from './worldStore';
import { mapAuthoringSlicesFor } from './mapDocumentState';
import { defaultMapPaint } from '../stage/mapPaint';
import type { PlacedPiece } from '../world/pieces';
import type { WorldObject } from './types';
import { readFile, remove, writeFile } from '../../../runtime/hooks/fs';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const piece = (id: string): PlacedPiece => ({
  id,
  pieceId: 'floor.concrete.common',
  x: 1,
  y: 0,
  z: 2,
  yawDegrees: 0,
  floor: 0,
});

const object = (id: string): WorldObject => ({
  id,
  kind: 'TRIGGER',
  name: id,
  assetId: 'mat-concrete',
  left: 12,
  top: 18,
  width: 6,
  height: 4,
  metrics: [],
});

test('map names sanitize to isolated sibling directories', () => {
  assert(sanitizeMapDocumentName('  North Plaza!! ') === 'north-plaza', 'friendly name did not sanitize');
  assert(sanitizeMapDocumentName('_last') === 'last', 'reserved metadata prefix survived sanitization');
  assert(sanitizeMapDocumentName('x'.repeat(200)).length === MAP_DOCUMENT_STEM_MAX_CHARS, 'stem length was not bounded');
  const north = mapDocumentPaths('north-plaza');
  const south = mapDocumentPaths('south-plaza');
  assert(north.painting !== south.painting, 'painting paths collided');
  assert(north.world !== south.world, 'world paths collided');
  assert(north.metadata !== south.metadata, 'metadata paths collided');
  assert(north.painting.startsWith(`${north.dir}/`), 'painting escaped its document directory');
  assert(north.world.startsWith(`${north.dir}/`), 'world save escaped its document directory');
});

test('friendly rename and diagnostics retain a stable document id', () => {
  const token = `${Date.now()}-${Math.trunc(Math.random() * 1_000_000)}`;
  const kept = createMapDocument(`map-doc-meta-${token}`);
  const removed = createMapDocument(`map-doc-delete-${token}`);
  try {
    const renamed = renameMapDocument(kept, 'North Plaza — Night');
    assert(renamed.ok && renamed.name === 'North Plaza — Night', 'friendly title did not persist');
    assert(recordMapDocumentRenderStats(kept, 123_456), 'render diagnostics did not persist');
    const summary = listMapDocuments().find((document) => document.stem === kept);
    assert(summary?.name === 'North Plaza — Night', 'catalog did not read friendly title');
    assert(summary?.renderTriangles === 123_456, 'catalog did not read triangle snapshot');
    assert(!deleteMapDocument(kept, kept).ok, 'active-map delete guard failed');
    assert(deleteMapDocument(removed, kept).ok, 'inactive map directory was not removed');
    assert(readFile(mapDocumentPaths(removed).metadata) === null, 'delete left metadata behind');
  } finally {
    remove(mapDocumentPaths(kept).dir);
    remove(mapDocumentPaths(removed).dir);
  }
});

test('world save rejects a document id from another directory', () => {
  const misplaced = JSON.stringify({ version: 2, document: 'map-a', seq: 3, pieces: [piece('a')], zones: [] });
  let rejected = false;
  try { parseWorldSaveText(misplaced, 'map-b'); } catch { rejected = true; }
  assert(rejected, 'misplaced world save was accepted');
});

test('world save refuses malformed authoring instead of silently dropping it', () => {
  const malformed = JSON.stringify({
    version: 2,
    document: 'map-a',
    seq: 3,
    pieces: [{ id: 'broken', pieceId: 'floor.concrete.common', x: 'not-a-number', y: 0, z: 0, yawDegrees: 0 }],
    zones: [],
  });
  let rejected = false;
  try { parseWorldSaveText(malformed, 'map-a'); } catch { rejected = true; }
  assert(rejected, 'malformed piece was silently discarded from an otherwise accepted map');
});

test('a malformed document is write-protected from the next debounce', () => {
  const stem = createMapDocument('map-doc-invalid-protection-test');
  const paths = mapDocumentPaths(stem);
  const malformed = JSON.stringify({ version: 2, document: stem, pieces: [{ id: 'broken' }] });
  try {
    assert(writeFile(paths.world, malformed), 'could not write malformed fixture');
    assert(readWorldSave(stem).status === 'invalid', 'fixture did not enter invalid state');
    assert(!saveWorldNow(emptyWorldSave(stem)), 'invalid document accepted a destructive overwrite');
    assert(readFile(paths.world) === malformed, 'invalid bytes changed after refused save');
  } finally {
    remove(paths.world);
    remove(paths.painting);
    remove(paths.legacyMarker);
    remove(paths.dir);
  }
});

test('legacy v1 is accepted only through explicit migration', () => {
  const legacy = JSON.stringify({ version: 1, seq: 4, pieces: [piece('legacy')], zones: [] });
  let rejected = false;
  try { parseWorldSaveText(legacy, 'legacy'); } catch { rejected = true; }
  assert(rejected, 'unscoped v1 save was accepted as an ordinary named document');
  const migrated = parseWorldSaveText(legacy, 'legacy', { allowLegacyV1: true });
  assert(migrated.version === 4 && migrated.document === 'legacy', 'legacy save was not upgraded into the named boundary');
  assert(migrated.objects.length === 0, 'pre-object legacy save did not receive the safe empty default');
  assert(migrated.worldFlora.length === 0, 'pre-flora legacy save did not receive the safe empty default');
});

test('older v2 saves gain an empty semantic-object concern', () => {
  const priorV2 = JSON.stringify({ version: 2, document: 'map-a', seq: 7, pieces: [], zones: [] });
  const loaded = parseWorldSaveText(priorV2, 'map-a');
  assert(loaded.objects.length === 0, 'missing objects did not default to an empty concern');
  assert(loaded.worldFlora.length === 0, 'missing custom flora did not default to an empty concern');
});

test('v4 preserves bounded surface and terrain flora recipes', () => {
  const save = emptyWorldSave('flora-map', 10);
  save.pieces = [{
    ...piece('planter'),
    surfaceFlora: [{
      id: 'surface-flora-10', speciesId: 'builtin-flora:grassLush', role: 'flora-1', triangle: 0,
      lx: 0.2, ly: 0.5, lz: 0.3, density: 0.65, radiusM: 1.5, seed: 41,
    }],
  }];
  save.worldFlora = [{
    id: 'world-flora-11', speciesId: 'custom-flora:hedge', x: 4, y: 0, z: 8,
    density: 0.4, radiusM: 2, seed: 42,
  }];
  const loaded = parseWorldSaveText(JSON.stringify(save), 'flora-map');
  assert(loaded.pieces[0]!.surfaceFlora?.[0]?.density === 0.65, 'surface flora recipe was lost');
  assert(loaded.worldFlora[0]?.speciesId === 'custom-flora:hedge', 'terrain flora recipe was lost');
});

test('New/Open replaces every authored map slice instead of merging', () => {
  const oldPaint = defaultMapPaint();
  oldPaint.zones = [{ id: 'old-zone', name: 'Old', color: '#f00' }];
  oldPaint.tileBindings = [{ fn: 'old-material', variant: 1 }];
  oldPaint.active = true;
  const target = emptyWorldSave('clean-map', 2);
  target.pieces = [piece('target-only')];
  target.objects = [object('target-trigger')];
  target.zones = [{ id: 'target-zone', name: 'Target', color: '#0f0' }];
  const slices = mapAuthoringSlicesFor({ seq: 9, mapPaint: oldPaint }, 'clean-map', target, [], 'Clean Map');
  assert(slices.activeMapStem === 'clean-map', 'active stem not replaced');
  assert(slices.activeMapName === 'Clean Map', 'active friendly name not replaced');
  assert(slices.worldPieces.length === 1 && slices.worldPieces[0]!.id === 'target-only', 'pieces merged or leaked');
  assert(slices.worldFlora.length === 0, 'old terrain flora leaked into the target map');
  assert(slices.worldPrefabs.length === 0, 'old prefab definitions leaked into the target map');
  assert(slices.objects.length === 1 && slices.objects[0]!.id === 'target-trigger', 'semantic objects merged or leaked');
  assert(slices.selectedObjectId === 'target-trigger', 'selection did not move inside the target document');
  assert(!slices.mapPaint.zones.some((zone) => zone.id === 'old-zone'), 'old zone leaked');
  assert(slices.mapPaint.tileBindings.length === 0, 'old material binding leaked');
  assert(slices.mapPaint.active === false, 'paint pointer claim stayed armed across switch');
  assert(slices.worldUndo.length === 0 && slices.worldRedo.length === 0, 'old undo history leaked');
  assert(slices.seq === 9, 'shared id sequence moved backwards');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
