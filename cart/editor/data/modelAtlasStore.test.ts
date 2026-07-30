// The UV panel's copy-path verb must materialize base.png before exposing a path.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/modelAtlasStore.test.ts --bundle \
//     --outfile=/tmp/editor-model-atlas-store.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-model-atlas-store.test.js
import {
  claimPackageDir,
  writeLiveModelAtlas,
  writeModelUvGenerationGuide,
  writeModelUvWireframe,
} from './modelPackageStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('copy-path persistence returns only a PNG proven to exist', () => {
  const host = globalThis as any;
  const names = ['__fs_exists', '__fs_read', '__fs_list_json', '__fs_mkdir', '__model_atlas_read', '__image_write_png', '__cwd'];
  const prior = new Map(names.map((name) => [name, host[name]]));
  let manifestExists = false;
  let pngExists = false;
  let writtenPath = '';
  try {
    host.__fs_exists = (path: string) => path.endsWith('/manifest.json') ? manifestExists : path === writtenPath && pngExists;
    host.__fs_read = () => null;
    host.__fs_list_json = () => '[]';
    host.__fs_mkdir = () => true;
    host.__cwd = () => '/workspace';
    claimPackageDir({ kind: 'prop', id: 'test:atlas-copy', name: 'Atlas Copy' });
    manifestExists = true;
    host.__model_atlas_read = () => JSON.stringify({ w: 64, h: 32, data: 'AAAA' });
    host.__image_write_png = (path: string) => { writtenPath = path; pngExists = true; return 1; };

    const result = writeLiveModelAtlas({ kind: 'prop', id: 'test:atlas-copy' });
    assert(result.ok, `live atlas write failed: ${result.ok ? '' : result.error}`);
    if (!result.ok) return;
    assert(result.path === '/workspace/cart/editor/data/models/props/Atlas_Copy/atlases/base.png', `unexpected copied path ${result.path}`);
    assert(result.width === 64 && result.height === 32, 'atlas dimensions were not carried with the proof');
    assert(pngExists, 'a path was returned before the PNG existed');
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('transparent and generation UV guides use distinct atomic package PNG paths', () => {
  const host = globalThis as any;
  const names = ['__fs_exists', '__fs_read', '__fs_list_json', '__fs_mkdir', '__imageops_encode_raw', '__fs_write_bytes_atomic', '__cwd'];
  const prior = new Map(names.map((name) => [name, host[name]]));
  let manifestExists = false;
  let writtenPath = '';
  let writtenBytes: Uint8Array | null = null;
  try {
    host.__fs_exists = (path: string) => path.endsWith('/manifest.json') ? manifestExists : path === writtenPath && writtenBytes !== null;
    host.__fs_read = () => null;
    host.__fs_list_json = () => '[]';
    host.__fs_mkdir = () => true;
    host.__cwd = () => '/workspace';
    claimPackageDir({ kind: 'prop', id: 'test:wireframe-copy', name: 'Wireframe Copy' });
    manifestExists = true;
    host.__imageops_encode_raw = () => new Uint8Array([137, 80, 78, 71]);
    host.__fs_write_bytes_atomic = (path: string, bytes: Uint8Array) => {
      writtenPath = path;
      writtenBytes = bytes;
      return true;
    };

    const rgba = new Uint8Array(4 * 2 * 4);
    rgba[3] = 255;
    const result = writeModelUvWireframe({ kind: 'prop', id: 'test:wireframe-copy' }, rgba, 4, 2);
    assert(result.ok, `wireframe write failed: ${result.ok ? '' : result.error}`);
    if (!result.ok) return;
    assert(result.path === '/workspace/cart/editor/data/models/props/Wireframe_Copy/atlases/uv-wireframe.png', `unexpected wireframe path ${result.path}`);
    assert(result.width === 4 && result.height === 2, 'wireframe dimensions were not carried with the proof');
    assert(writtenBytes?.join(',') === '137,80,78,71', 'encoded PNG bytes did not use the atomic binary door');

    const generation = writeModelUvGenerationGuide({ kind: 'prop', id: 'test:wireframe-copy' }, rgba, 4, 2);
    assert(generation.ok, `generation guide write failed: ${generation.ok ? '' : generation.error}`);
    if (!generation.ok) return;
    assert(generation.path === '/workspace/cart/editor/data/models/props/Wireframe_Copy/atlases/uv-ai-guide.png', `unexpected generation guide path ${generation.path}`);
    assert(generation.width === 4 && generation.height === 2, 'generation guide dimensions were not carried with the proof');
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
