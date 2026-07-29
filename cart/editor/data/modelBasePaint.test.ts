import { exactUvCornersFromAtlasTriangles, parseModelBasePaintText, writeModelArtifacts } from './modelPackageStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('base paint restores the durable stroke program and density', () => {
  const paint = parseModelBasePaintText(JSON.stringify({ version: 1, detail: 64, program: 'c3Ryb2tlcw==' }));
  assert(paint?.detail === 64 && paint.program === 'c3Ryb2tlcw==', 'valid base paint was not restored');
});

test('base paint v2 restores an authored UV island layout', () => {
  const paint = parseModelBasePaintText(JSON.stringify({ version: 2, detail: 64, program: 'c3Ryb2tlcw==', layout: [0, 0, 12, 9, 14, 0, 8, 9] }));
  assert(paint?.version === 2 && paint.layout?.join(',') === '0,0,12,9,14,0,8,9', 'authored UV layout was not restored');
});

test('base paint v3 restores a raster baseline with an optional stroke recipe', () => {
  const paint = parseModelBasePaintText(JSON.stringify({ version: 3, detail: 64, program: '', rasterBase: true, layout: [0, 0, 12, 9] }));
  assert(paint?.version === 3 && paint.rasterBase === true && paint.program === '', 'raster baseline record was not restored');
});

test('base paint v4 restores every exact face-corner UV across a cold restart', () => {
  const cornerUv = [1.25, 2.5, 12, 3, 7.75, 9, 20, 4, 30, 8, 21, 16];
  const paint = parseModelBasePaintText(JSON.stringify({
    version: 4,
    detail: 64,
    program: '',
    rasterBase: true,
    layout: [1, 2, 12, 9],
    cornerUv,
  }));
  assert(paint?.version === 4 && paint.cornerUv?.join(',') === cornerUv.join(','), 'exact UV geometry was not restored');
});

test('atlas triangle metadata strips to the host corner-geometry table in face order', () => {
  const corners = exactUvCornersFromAtlasTriangles([
    0, 7, 1.25, 2.5, 12, 3, 7.75, 9,
    1, 0xffffffff, 20, 4, 30, 8, 21, 16,
  ], 32, 20);
  assert(corners?.join(',') === '1.25,2.5,12,3,7.75,9,20,4,30,8,21,16', 'triangle envelopes leaked into persisted UV geometry');
  assert(exactUvCornersFromAtlasTriangles([0, 7, -1, 2, 3, 4, 5, 6], 32, 20) === null, 'out-of-atlas UV was accepted');
});

test('saving model artifacts commits exact UV geometry as the restart record', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_mkdir', '__fs_remove', '__fs_write_bytes_atomic', '__fs_stat_json',
    '__model_paint_layout_stale', '__model_atlas_read', '__image_write_png', '__model_painted_mesh_write',
    '__model_paint_program_read', '__model_paint_baseline_read',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  let savedBasePaint = '';
  try {
    host.__fs_exists = (path: string) => path.endsWith('/mesh/doc.blob');
    host.__fs_read = () => null;
    host.__fs_mkdir = () => true;
    host.__fs_remove = () => true;
    host.__fs_stat_json = () => JSON.stringify({ size: 128, mtimeMs: 10, isDir: false });
    host.__fs_write_bytes_atomic = (path: string, bytes: Uint8Array) => {
      if (path.endsWith('/atlases/base.paint.json')) {
        savedBasePaint = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
      }
      return true;
    };
    host.__model_paint_layout_stale = () => 0;
    host.__model_atlas_read = () => JSON.stringify({
      w: 32,
      h: 20,
      detail: 64,
      data: 'AAAA',
      islands: [1, 2, 30, 16],
      triangles: [0, 7, 1.25, 2.5, 12, 3, 7.75, 9],
    });
    host.__image_write_png = () => 1;
    host.__model_painted_mesh_write = () => 1;
    host.__model_paint_program_read = () => '';
    host.__model_paint_baseline_read = () => 'AAAA';
    const ok = writeModelArtifacts({ kind: 'prop', id: 'test:uv-restart-v4', name: 'uv restart v4' });
    const record = parseModelBasePaintText(savedBasePaint);
    assert(ok, 'artifact save failed');
    assert(record?.version === 4, `save emitted v${record?.version ?? 'none'} instead of exact v4`);
    assert(record?.cornerUv?.join(',') === '1.25,2.5,12,3,7.75,9', 'saved record dropped exact face-corner UVs');
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('model artifact save coverage-crops base and baseline without a base64 raster read', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_list_json', '__fs_mkdir', '__fs_remove',
    '__fs_write_bytes_atomic', '__fs_stat_json', '__model_paint_layout_stale',
    '__model_atlas_read', '__model_uv_coverage_write', '__image_write_png',
    '__model_painted_mesh_write', '__model_paint_program_read', '__model_paint_baseline_read',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const files = new Map<string, { size: number; text?: string }>();
  let atlasReadMode = -1;
  let legacyPngWrites = 0;
  let baselineReads = 0;
  let savedBasePaint = '';
  try {
    host.__fs_exists = (path: string) => path.endsWith('/mesh/doc.blob') || files.has(path);
    host.__fs_read = (path: string) => files.get(path)?.text ?? null;
    host.__fs_list_json = () => '[]';
    host.__fs_mkdir = () => true;
    host.__fs_remove = (path: string) => files.delete(path);
    host.__fs_stat_json = (path: string) => JSON.stringify({
      size: files.get(path)?.size ?? 128,
      mtimeMs: 10,
      isDir: false,
    });
    host.__fs_write_bytes_atomic = (path: string, bytes: Uint8Array) => {
      const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
      files.set(path, { size: bytes.length, text });
      if (path.endsWith('/atlases/base.paint.json')) savedBasePaint = text;
      return true;
    };
    host.__model_paint_layout_stale = () => 0;
    host.__model_atlas_read = (includeData: number) => {
      atlasReadMode = includeData;
      return JSON.stringify({
        w: 8,
        h: 8,
        detail: 16,
        islands: [1, 1, 6, 6],
        triangles: [0, 7, 1, 1, 6, 1, 1, 6],
      });
    };
    host.__model_uv_coverage_write = (composite: string, baseline: string) => {
      files.set(composite, { size: 222 });
      files.set(baseline, { size: 111 });
      return JSON.stringify({
        composite: 1,
        baseline: 1,
        w: 8,
        h: 8,
        totalPixels: 64,
        keptPixels: 32,
        clearedPixels: 32,
        gutterTexels: 2,
      });
    };
    host.__image_write_png = () => { legacyPngWrites += 1; return 1; };
    host.__model_painted_mesh_write = (path: string) => {
      files.set(path, { size: 3 * 8 * 4 });
      return 1;
    };
    host.__model_paint_program_read = () => '';
    host.__model_paint_baseline_read = () => { baselineReads += 1; return 'AAAA'; };

    const ok = writeModelArtifacts({ kind: 'prop', id: 'test:coverage-base', name: 'Coverage Base' });
    const record = parseModelBasePaintText(savedBasePaint);
    assert(ok, 'native coverage artifact save failed');
    assert(atlasReadMode === 0, `atlas pixels crossed JS despite native writer (mode ${atlasReadMode})`);
    assert(legacyPngWrites === 0 && baselineReads === 0, 'native success touched the base64 fallback');
    assert(record?.version === 4 && record.rasterBase === true, 'coverage baseline was not recorded as a full v4 look');
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('base paint refuses empty or unknown records', () => {
  assert(parseModelBasePaintText('{"version":5,"detail":64,"program":"x"}') === null, 'unknown version was accepted');
  assert(parseModelBasePaintText('{"version":3,"detail":64,"program":"","layout":[0,0,1,1]}') === null, 'v3 without raster marker was accepted');
  assert(parseModelBasePaintText('{"version":4,"detail":64,"program":"","rasterBase":true,"cornerUv":[0,0,1,1]}') === null, 'incomplete exact UV geometry was accepted');
  assert(parseModelBasePaintText('{"version":2,"detail":64,"program":"x","layout":[0,0,0,1]}') === null, 'invalid UV layout was accepted');
  assert(parseModelBasePaintText('{"version":1,"detail":64,"program":""}') === null, 'empty program was accepted');
  assert(parseModelBasePaintText('broken') === null, 'malformed json was accepted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
