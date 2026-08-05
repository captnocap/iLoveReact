// Asset-browser summaries must report package artifacts, not stale manifest zeroes.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/modelPackageFacts.test.ts --bundle \
//     --outfile=/tmp/editor-model-package-facts.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-model-package-facts.test.js
import { bytesToBase64 } from '../../../runtime/workspace/lumps';
import { claimPackageDir } from './modelPackageStore';
import { readModelPackageFacts } from './modelPackageFacts';
import type { ModelPackage } from './types';

let passed = 0, failed = 0;
const FLOATS_FOR_TWO_TRIANGLES = 2 * 3 * 8;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const model = (id: string, overrides: Partial<ModelPackage> = {}): ModelPackage => ({
  id,
  folderId: `model-${id}`,
  name: id,
  path: `/cart/editor/data/models/props/${id}`,
  kind: 'prop',
  stage: 'wip',
  color: '#ffffff',
  source: 'source model',
  rig: 'none',
  data: 'source model',
  triangles: 0,
  lods: 0,
  decompositions: [],
  atlases: [],
  paints: [],
  ...overrides,
});

test('materialized package facts override stale zero-valued manifest fields', () => {
  const host = globalThis as any;
  const names = ['__fs_exists', '__fs_read', '__fs_read_base64', '__fs_list_json'];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const pkg = model('test:live-package-facts');
  const dir = claimPackageDir(pkg);
  const legacyMesh = new Float32Array(FLOATS_FOR_TWO_TRIANGLES);
  try {
    host.__fs_exists = (path: string) => path === `${dir}/manifest.json`
      || path === `${dir}/mesh/base.blob`
      || path === `${dir}/paints`
      || path === `${dir}/atlases/base.png`;
    host.__fs_read = () => null;
    host.__fs_read_base64 = (path: string) => path === `${dir}/mesh/base.blob`
      ? bytesToBase64(new Uint8Array(legacyMesh.buffer))
      : null;
    host.__fs_list_json = (path: string) => path === `${dir}/paints`
      ? JSON.stringify(['paint_1.json', 'paint_1.png', 'paint_2.json', 'compiled-atlas.json'])
      : '[]';

    const facts = readModelPackageFacts(pkg);
    assert(facts.triangles === 2, `expected 2 live triangles, got ${facts.triangles}`);
    assert(facts.paints === 2, `expected 2 saved paints, got ${facts.paints}`);
    assert(facts.atlases === 1, `expected the live base atlas, got ${facts.atlases}`);
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('source-only packages report unknown geometry instead of a fake zero', () => {
  const host = globalThis as any;
  const names = ['__fs_exists', '__fs_read', '__fs_list_json'];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const pkg = model('test:source-package-facts', { viewerPath: '/models/source.glb' });
  const dir = claimPackageDir(pkg);
  try {
    host.__fs_exists = (path: string) => path === `${dir}/manifest.json`;
    host.__fs_read = () => null;
    host.__fs_list_json = () => '[]';
    const facts = readModelPackageFacts(pkg);
    assert(facts.triangles === null, `expected unknown triangles, got ${facts.triangles}`);
    assert(facts.paints === 0 && facts.atlases === 0, 'source package invented paint or atlas artifacts');
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

if (failed > 0) throw new Error(`${failed} model-package fact test(s) failed`);
log(`modelPackageFacts: ${passed} passed`);
