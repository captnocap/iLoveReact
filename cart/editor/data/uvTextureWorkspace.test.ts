import {
  compileUvTextureWorkspace,
  createUvTextureWorkspace,
  parseUvTextureWorkspace,
  updateUvTextureWorkspace,
  uvTextureWorkspaceBounds,
  uvTextureWorkspaceIsStale,
  type DecodedUvTextureLayer,
  type UvTextureLayer,
} from './uvTextureWorkspace';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const source = (hash: string) => `atlases/uv-sources/${hash}.png`;
const pixel = (r: number, g: number, b: number, a = 255) => new Uint8Array([r, g, b, a]);

test('workspace validation accepts only strict package-relative content addresses', () => {
  const doc = createUvTextureWorkspace(source(HASH_A), 2, 3);
  assert(parseUvTextureWorkspace(JSON.stringify(doc))?.layers[0]?.source === source(HASH_A), 'valid workspace did not round-trip');
  const traversal = JSON.parse(JSON.stringify(doc));
  traversal.layers[0].source = 'atlases/uv-sources/../../outside.png';
  assert(parseUvTextureWorkspace(JSON.stringify(traversal)) === null, 'path traversal source crossed the package boundary');
  const duplicate = JSON.parse(JSON.stringify(doc));
  duplicate.layers.push({ ...duplicate.layers[0] });
  assert(parseUvTextureWorkspace(JSON.stringify(duplicate)) === null, 'duplicate layer identity was accepted');
});

test('visible bounds retain negative positions and crop transparent workspace space', () => {
  const layers: UvTextureLayer[] = [
    { id: 'a', name: 'A', source: source(HASH_A), x: -7, y: 4, width: 3, height: 2, visible: true },
    { id: 'b', name: 'B', source: source(HASH_B), x: 5, y: -3, width: 4, height: 5, visible: true },
  ];
  const bounds = uvTextureWorkspaceBounds(layers);
  assert(bounds.x === -7 && bounds.y === -3 && bounds.width === 16 && bounds.height === 9, 'signed visible union was wrong');
});

test('compile preserves native pixels, transparent gaps, paint order, and origin shift', () => {
  let doc = createUvTextureWorkspace(source(HASH_A), 1, 1);
  doc = updateUvTextureWorkspace(doc, [
    { ...doc.layers[0]!, x: -2, y: 1 },
    { id: 'layer-2', name: 'top', source: source(HASH_B), x: 1, y: 1, width: 1, height: 1, visible: true },
  ], 3);
  const rows: DecodedUvTextureLayer[] = [
    { layer: doc.layers[1]!, rgba: pixel(0, 0, 255, 128), width: 1, height: 1 },
    { layer: doc.layers[0]!, rgba: pixel(255, 0, 0), width: 1, height: 1 },
  ];
  const raster = compileUvTextureWorkspace(doc, rows);
  assert(raster.x === -2 && raster.y === 1 && raster.width === 4 && raster.height === 1, 'compile did not use the smallest visible union');
  assert([...raster.rgba.slice(0, 4)].join(',') === '255,0,0,255', 'opaque native pixel changed');
  assert([...raster.rgba.slice(4, 12)].every((value) => value === 0), 'unused workspace did not stay transparent');
  assert([...raster.rgba.slice(12, 16)].join(',') === '0,0,255,128', 'top image alpha changed');
  assert(raster.shiftX === 2 && raster.shiftY === -1, 'first compile did not retain workspace UV positions');
});

test('recompile translates local UVs by old origin minus new origin', () => {
  const base = createUvTextureWorkspace(source(HASH_A), 1, 1);
  const compiled = {
    ...base,
    compiled: { revision: base.revision, originX: -10, originY: 5, width: 1, height: 1, atlasSha256: HASH_A },
  };
  const moved = updateUvTextureWorkspace(compiled, [{ ...compiled.layers[0]!, x: 4, y: -8 }]);
  const raster = compileUvTextureWorkspace(moved, [{
    layer: moved.layers[0]!,
    rgba: pixel(9, 8, 7),
    width: 1,
    height: 1,
  }]);
  assert(raster.shiftX === -14 && raster.shiftY === 13, 'origin delta would move authored workspace UVs');
  assert(uvTextureWorkspaceIsStale(moved), 'edited workspace incorrectly reported a current compile');
});

test('later layers source-over earlier layers in document order', () => {
  let doc = createUvTextureWorkspace(source(HASH_A), 1, 1);
  doc = updateUvTextureWorkspace(doc, [
    doc.layers[0]!,
    { id: 'layer-2', name: 'top', source: source(HASH_B), x: 0, y: 0, width: 1, height: 1, visible: true },
  ], 3);
  const raster = compileUvTextureWorkspace(doc, [
    { layer: doc.layers[1]!, rgba: pixel(0, 0, 255, 128), width: 1, height: 1 },
    { layer: doc.layers[0]!, rgba: pixel(255, 0, 0), width: 1, height: 1 },
  ]);
  assert([...raster.rgba].join(',') === '127,0,128,255', 'source-over order or straight-alpha math changed');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
