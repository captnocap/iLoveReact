// cart/editor/data/paintVariants.test.ts — paint skins carry UV/paint while the
// current model remains the single geometry authority.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/paintVariants.test.ts --bundle \
//     --outfile=/tmp/editor-paint-variants.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-paint-variants.test.js

import {
  bindPaintSkinToCurrentMesh,
  paintSkinFitsCurrentMesh,
  PAINT_MESH_VERTEX_BYTES,
  savePaintVariant,
} from './paintVariants';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const vertex = (x: number, nx: number, u: number, v: number) => [x, x + 1, x + 2, nx, nx + 1, nx + 2, u, v];

test('a saved skin contributes UVs but never its stale positions or normals', () => {
  const current = new Float32Array([
    ...vertex(10, 20, 0.1, 0.2),
    ...vertex(30, 40, 0.3, 0.4),
    ...vertex(50, 60, 0.5, 0.6),
  ]);
  const savedSkin = new Float32Array([
    ...vertex(-10, -20, 0.7, 0.8),
    ...vertex(-30, -40, 0.9, 1.0),
    ...vertex(-50, -60, 0.11, 0.12),
  ]);
  const bound = bindPaintSkinToCurrentMesh(current, savedSkin);
  assert(bound !== null, 'same-cardinality skin should bind');
  for (let i = 0; i < current.length; i += 8) {
    for (let field = 0; field < 6; field += 1) {
      assert(bound![i + field] === current[i + field], `geometry field ${field} came from stale skin`);
    }
    assert(bound![i + 6] === savedSkin[i + 6], 'u did not come from saved skin');
    assert(bound![i + 7] === savedSkin[i + 7], 'v did not come from saved skin');
  }
});

test('a topology-changing skin cannot bind to the current model', () => {
  const current = new Float32Array(3 * 8);
  const stale = new Float32Array(6 * 8);
  assert(bindPaintSkinToCurrentMesh(current, stale) === null, 'different vertex counts must refuse');
  assert(!paintSkinFitsCurrentMesh(current.byteLength, stale.byteLength), 'stale skin must leave the palette');
});

test('a well-formed legacy skin remains usable until a base mesh exists', () => {
  const triangleBytes = 3 * PAINT_MESH_VERTEX_BYTES;
  assert(paintSkinFitsCurrentMesh(null, triangleBytes), 'legacy skin should remain reachable');
  assert(!paintSkinFitsCurrentMesh(null, triangleBytes - 1), 'partial vertex data must refuse');
});

test('variant save uses native UV coverage and records the discarded texture area', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_list_json', '__fs_mkdir', '__fs_write',
    '__fs_remove', '__fs_stat_json', '__model_uv_coverage_write',
    '__image_write_png', '__model_painted_mesh_write',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dirs = new Set<string>();
  const files = new Map<string, { size: number; text?: string }>();
  let legacyWrites = 0;
  let compositePath = '';
  let baselinePath = '';
  try {
    host.__fs_exists = (path: string) => dirs.has(path) || files.has(path);
    host.__fs_read = (path: string) => files.get(path)?.text ?? null;
    host.__fs_list_json = () => '[]';
    host.__fs_mkdir = (path: string) => { dirs.add(path); return true; };
    host.__fs_write = (path: string, text: string) => {
      files.set(path, { size: text.length, text });
      return true;
    };
    host.__fs_remove = (path: string) => files.delete(path) || dirs.delete(path);
    host.__fs_stat_json = (path: string) => {
      const file = files.get(path);
      return file ? JSON.stringify({ size: file.size, mtimeMs: 1, isDir: false }) : null;
    };
    host.__model_uv_coverage_write = (composite: string, baseline: string) => {
      compositePath = composite;
      baselinePath = baseline;
      files.set(composite, { size: 321 });
      files.set(baseline, { size: 123 });
      return JSON.stringify({
        composite: 1,
        baseline: 1,
        w: 8,
        h: 8,
        totalPixels: 64,
        keptPixels: 20,
        clearedPixels: 44,
        gutterTexels: 2,
      });
    };
    host.__image_write_png = () => { legacyWrites += 1; return 1; };
    host.__model_painted_mesh_write = (path: string) => {
      files.set(path, { size: 96 });
      return 1;
    };

    const variant = savePaintVariant(
      { kind: 'prop', id: 'test:native-uv-coverage', name: 'Native UV Coverage' },
      {
        w: 8,
        h: 8,
        detail: 16,
        data: 'c3Ryb2tl',
        format: 'program',
        cornerUv: [1, 1, 6, 1, 1, 6],
      },
    );
    assert(compositePath.endsWith('/paints/paint_1.png'), `wrong composite path: ${compositePath}`);
    assert(baselinePath.endsWith('/paints/paint_1.base.png'), `wrong baseline path: ${baselinePath}`);
    assert(legacyWrites === 0, 'native success still base64-decoded a raster');
    assert(variant.rasterBase === true && !!variant.basePng, 'full-look baseline was not recorded');
    assert(variant.uvCoverage?.clearedPixels === 44, 'discarded pixel count was not persisted');
    assert(variant.uvCoverage?.pngBytes === 321 && variant.uvCoverage?.basePngBytes === 123, 'landed PNG sizes were not recorded');
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
