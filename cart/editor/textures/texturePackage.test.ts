import {
  exactTextureImagePath,
  texturePatchPackages,
  type TexturePackage,
} from '../data/texturePackage';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const exact: TexturePackage = {
  manifest: {
    version: 1,
    id: 'img-tire-sidewall',
    name: 'Tire Sidewall.PNG',
    source: 'exact-image',
    width: 512,
    height: 512,
    originalName: 'Tire Sidewall.PNG',
  },
};

const pixel: TexturePackage = {
  manifest: {
    version: 1,
    id: 'img-pixel-gauge',
    name: 'Pixel Gauge',
    source: 'pixel-texture',
    width: 32,
    height: 32,
    originalName: 'gauge.png',
  },
  pixel: { width: 32, height: 32, palette: [], rows: [] },
};

test('exact image path resolves to the canonical imported package file', () => {
  assert(
    exactTextureImagePath(exact.manifest) === 'cart/editor/data/textures/tire-sidewall/image.png',
    'exact package path drifted from saveExactImage',
  );
});

test('UV patch catalog includes exact images and excludes shader-packed pixel textures', () => {
  const patches = texturePatchPackages([pixel, exact]);
  assert(patches.length === 1, 'patch shelf did not enforce exact-image sources');
  assert(patches[0]?.id === exact.manifest.id, 'wrong package entered the patch shelf');
  assert(patches[0]?.width === 512 && patches[0]?.height === 512, 'native patch dimensions were lost');
});

test('a malformed exact package without a source extension is not addressable', () => {
  const malformed = { ...exact.manifest, originalName: 'no-extension' };
  assert(exactTextureImagePath(malformed) === null, 'malformed package minted a guessed source path');
});

log(`${failed === 0 ? 'PASS' : 'FAIL'} texture package patches: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} texture package patch test(s) failed`);
