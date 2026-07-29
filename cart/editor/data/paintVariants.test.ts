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
  ensureImportedTexturePaintVariant,
  IMPORTED_TEXTURE_UV_MAPPING_VERSION,
  paintSkinFitsCurrentMesh,
  PAINT_MESH_VERTEX_BYTES,
  savePaintVariant,
  updatePaintVariant,
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

test('an imported model texture is deduped and legacy source UV provenance upgrades in place', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_list_json', '__fs_mkdir', '__fs_write',
    '__fs_remove', '__fs_stat_json', '__model_uv_coverage_write',
    '__model_painted_mesh_write', '__model_paint_program_read', '__model_atlas_read',
    '__model_paint_baseline_read',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dirs = new Set<string>();
  const files = new Map<string, { size: number; text?: string; isDir?: boolean }>();
  try {
    host.__fs_exists = (path: string) => dirs.has(path) || files.has(path);
    host.__fs_read = (path: string) => files.get(path)?.text ?? null;
    host.__fs_list_json = (dir: string) => JSON.stringify(
      [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
        .map((path) => path.slice(dir.length + 1)),
    );
    host.__fs_mkdir = (path: string) => { dirs.add(path); return true; };
    host.__fs_write = (path: string, text: string) => {
      files.set(path, { size: text.length, text, isDir: false });
      return true;
    };
    host.__fs_remove = (path: string) => files.delete(path) || dirs.delete(path);
    host.__fs_stat_json = (path: string) => {
      const file = files.get(path);
      return file ? JSON.stringify({ size: file.size, mtimeMs: 1, isDir: false }) : null;
    };
    host.__model_uv_coverage_write = (composite: string) => {
      files.set(composite, { size: 64, isDir: false });
      return JSON.stringify({
        composite: 1,
        baseline: 0,
        w: 8,
        h: 8,
        totalPixels: 64,
        keptPixels: 32,
        clearedPixels: 32,
        gutterTexels: 2,
      });
    };
    host.__model_painted_mesh_write = (path: string) => {
      files.set(path, { size: 96, isDir: false });
      return 1;
    };
    host.__model_paint_program_read = () => '';
    let sourceEdge = 8;
    host.__model_atlas_read = () => JSON.stringify({
      w: 8,
      h: 8,
      detail: 1,
      triangles: [0, 0, 0, 0, sourceEdge, 0, 0, sourceEdge],
    });
    host.__model_paint_baseline_read = () => '';

    const pkg = { kind: 'prop' as const, id: 'test:embedded-texture', name: 'Embedded Texture' };
    const legacySource = {
      kind: 'model-import' as const,
      fingerprint: 'sha256:0',
      imageIndex: 0,
      uvMappingVersion: 1,
    };
    const source = {
      ...legacySource,
      uvMappingVersion: IMPORTED_TEXTURE_UV_MAPPING_VERSION,
    };
    const first = ensureImportedTexturePaintVariant(pkg, legacySource);
    assert(first.created && first.variant?.name === 'Imported Texture', 'first source texture was not captured');
    assert(first.variant?.rasterBase === true, 'strokeless source texture did not retain its raster base');
    assert(first.variant?.importedTexture?.fingerprint === source.fingerprint, 'source provenance was not persisted');

    // Historical records had no version field. The parser must recognize that
    // exact v1 shape, then refresh its known-incorrect generated UVs in place.
    const firstJsonPath = [...files.keys()].find((path) => path.endsWith('/paints/paint_1.json'))!;
    const legacyRecord = JSON.parse(files.get(firstJsonPath)!.text!);
    delete legacyRecord.importedTexture.uvMappingVersion;
    files.set(firstJsonPath, {
      size: JSON.stringify(legacyRecord).length,
      text: JSON.stringify(legacyRecord),
      isDir: false,
    });
    sourceEdge = 6;
    const upgraded = ensureImportedTexturePaintVariant(pkg, source);
    assert(upgraded.upgraded && !upgraded.created, 'legacy imported texture was not upgraded in place');
    assert(upgraded.variant?.id === first.variant?.id, 'legacy repair created a duplicate variant id');
    assert(upgraded.variant?.cornerUv?.[2] === sourceEdge, 'legacy repair kept the stale generated UV table');
    assert(
      upgraded.variant?.importedTexture?.uvMappingVersion === IMPORTED_TEXTURE_UV_MAPPING_VERSION,
      'legacy repair did not stamp the corrected UV mapping version',
    );

    const second = ensureImportedTexturePaintVariant(pkg, source);
    assert(!second.created && !second.upgraded && second.variant?.id === first.variant?.id, 'same corrected source texture created a duplicate variant');

    const edited = updatePaintVariant(pkg, upgraded.variant!.id, {
      w: 8,
      h: 8,
      detail: 1,
      data: '',
      format: 'program',
      cornerUv: [0, 0, 8, 0, 0, 8],
    });
    assert(edited?.importedTexture === undefined, 'save-back left edited paint claiming to be the pristine import');
    const recaptured = ensureImportedTexturePaintVariant(pkg, source);
    assert(recaptured.created && recaptured.variant?.id !== upgraded.variant?.id, 'edited source row suppressed recapture of the original');
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
