// Model-package manifest roundtrip for durable face-texture rig metadata.
//
//   tools/esbuild cart/editor/data/modelPackage.test.ts --bundle \
//     --outfile=/tmp/editor-model-package.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-model-package.test.js
import { manifestToPackage, modelThumbFileName, modelThumbRevision, packageToManifest } from './modelPackage';
import type { ModelPackage } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('face texture roles retain stable ids and labels through manifest persistence', () => {
  const pkg: ModelPackage = {
    id: 'prop:textured-chair', folderId: 'model-prop_textured-chair', name: 'Textured Chair',
    path: '/tmp/textured-chair', kind: 'prop', stage: 'wip', color: '#778899',
    source: '/tmp/textured-chair/manifest.json', rig: 'plain', data: 'studio',
    triangles: 12, lods: 1, decompositions: [], atlases: [], paints: [],
    textureSlots: [{ id: 'seat_cloth', label: 'Seat Cloth', purpose: 'flora' }, { id: 'frame', label: 'Frame' }],
    lights: [{ id: 'lamp', kind: 'spot', position: [1, 2, 3], dir: [0, -1, 0], color: '#ffcc88', intensity: 3, range: 9, spread: 28, castsShadow: true }],
  };
  const restored = manifestToPackage(packageToManifest(pkg), 'cart/editor/data/models/props/textured-chair');
  assert(restored.textureSlots?.length === 2, 'texture roles were dropped');
  assert(restored.textureSlots?.[0]?.id === 'seat_cloth', 'stable role id changed');
  assert(restored.textureSlots?.[1]?.label === 'Frame', 'role label changed');
  assert(restored.textureSlots?.[0]?.purpose === 'flora', 'face purpose was dropped');
  assert(restored.lights?.[0]?.position[2] === 3 && restored.lights[0].spread === 28, 'emitted light was dropped');
});

test('flora export declaration roundtrips as package-backed brush truth', () => {
  const pkg: ModelPackage = {
    id: 'studio:fern', folderId: 'model-studio_fern', name: 'Fern', path: '/tmp/fern',
    kind: 'prop', stage: 'wip', color: '#3c7b3f', source: '/tmp/fern/manifest.json',
    rig: '-', data: '-', triangles: 8, lods: 1, decompositions: [], atlases: [], paints: [],
    placeable: { as: 'flora', lane: 'bush' },
  };
  const restored = manifestToPackage(packageToManifest(pkg), 'cart/editor/data/models/props/fern');
  assert(restored.placeable?.as === 'flora' && restored.placeable.lane === 'bush', 'flora species declaration was dropped');
});

test('invalid manifest face purposes fall back without shifting role indexes', () => {
  const pkg: ModelPackage = {
    id: 'prop:legacy-screen', folderId: 'model-prop_legacy-screen', name: 'Legacy Screen',
    path: '/tmp/legacy-screen', kind: 'prop', stage: 'wip', color: '#778899',
    source: '/tmp/legacy-screen/manifest.json', rig: '-', data: '-', triangles: 2,
    lods: 1, decompositions: [], atlases: [], paints: [],
    textureSlots: [
      { id: 'display', label: 'Display', purpose: 'unknown-purpose' as any },
      null as any,
    ],
  };
  const restored = manifestToPackage(packageToManifest(pkg), 'cart/editor/data/models/props/legacy-screen');
  assert(restored.textureSlots?.length === 2, 'repair shifted indexed face roles');
  assert(restored.textureSlots?.[0]?.purpose === undefined, 'unknown purpose did not become material');
  assert(restored.textureSlots?.[1]?.id === 'surface_2', 'invalid role row was not repaired in place');
});

test('a staged thumbnail survives the manifest, and revisions parse in file order', () => {
  const pkg: ModelPackage = {
    id: 'prop:shot-car', folderId: 'model-prop_shot-car', name: 'Shot Car',
    path: '/tmp/shot-car', kind: 'prop', stage: 'ready', color: '#a34b43',
    source: '/tmp/shot-car/manifest.json', rig: '-', data: '-', triangles: 3786,
    lods: 0, decompositions: [], atlases: [], paints: [],
    thumbnail: 'cart/editor/data/models/props/shot-car/thumb-3.png',
  };
  const restored = manifestToPackage(packageToManifest(pkg), 'cart/editor/data/models/props/shot-car');
  assert(restored.thumbnail === pkg.thumbnail, 'the staged product shot did not survive the manifest');
  // The revision is what defeats the host image cache — a re-shot thumbnail MUST
  // land on a path nothing has loaded yet (gpu/image_cache.zig keys on the string).
  assert(modelThumbRevision('thumb-3.png') === 3, 'a revision number did not parse');
  assert(modelThumbRevision('thumb.png') === null, 'an unrevisioned name was read as a revision');
  assert(modelThumbRevision('atlas-2.png') === null, 'a foreign png was read as a thumbnail');
  assert(modelThumbFileName(4) === 'thumb-4.png', 'the next revision name drifted from the parser');
});

test('a model with no staged shot carries no thumbnail at all', () => {
  const pkg: ModelPackage = {
    id: 'prop:unshot', folderId: 'model-prop_unshot', name: 'Unshot',
    path: '/tmp/unshot', kind: 'prop', stage: 'wip', color: '#778899',
    source: '/tmp/unshot/manifest.json', rig: '-', data: '-', triangles: 12,
    lods: 0, decompositions: [], atlases: [], paints: [],
  };
  const restored = manifestToPackage(packageToManifest(pkg), 'cart/editor/data/models/props/unshot');
  assert(restored.thumbnail === undefined, 'an unshot model invented a thumbnail path');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
