// The bake-key identity law (req_4492): interned wall/floor geometry is keyed
// by the bundle's source CONTENT HASH, never by `source.revision` — revision
// numbers repeat after undo (the engine mints `revision + 1` from whatever
// source it is handed), and a repeated key made scene3d serve pre-undo
// geometry back. These suites prove the hash decode that carries that law.
import { bundleSourceHashHex, decodeWallRenderBands } from './architectureBake';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
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

function throws(run: () => void, needle: string): void {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(needle)) throw new Error(`threw '${message}', expected it to mention '${needle}'`);
    return;
  }
  throw new Error(`expected a throw mentioning '${needle}'`);
}

/** A minimal well-formed empty bundle: header + zero sections. Layout mirrors
 * framework/game/wall_compile.zig encodeBundleHeader. */
function syntheticBundle(input: { revision: number; sourceHash: (index: number) => number }): Uint8Array {
  const bytes = new Uint8Array(4 + 2 + 4 + 32 * 4 + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x42414a52, true); // "RJAB"
  view.setUint16(4, 1, true); // bundle version
  view.setUint32(6, input.revision, true);
  for (let index = 0; index < 32; index += 1) bytes[10 + index] = input.sourceHash(index) & 0xff;
  for (let index = 32; index < 128; index += 1) bytes[10 + index] = 0xee; // compiler/tuning/catalog hashes
  // section count u64 = 0 stays zero-initialized
  return bytes;
}

test('the key hash is the source hash bytes, hex-encoded, and nothing else', () => {
  const bundle = syntheticBundle({ revision: 7, sourceHash: (index) => index + 1 });
  equal(bundleSourceHashHex(bundle), '0102030405060708', 'hash prefix');
});

test('revision does not participate in the hash — that reuse was the req_4492 aliasing bug', () => {
  const atRevisionThree = syntheticBundle({ revision: 3, sourceHash: () => 0xab });
  const atRevisionNine = syntheticBundle({ revision: 9, sourceHash: () => 0xab });
  equal(bundleSourceHashHex(atRevisionThree), bundleSourceHashHex(atRevisionNine), 'same content, same key hash');
});

test('distinct source content yields distinct key hashes', () => {
  const contentA = syntheticBundle({ revision: 4, sourceHash: () => 0x11 });
  const contentB = syntheticBundle({ revision: 4, sourceHash: (index) => (index === 0 ? 0x12 : 0x11) });
  assert(bundleSourceHashHex(contentA) !== bundleSourceHashHex(contentB), 'first byte differs, hashes must differ');
});

test('low bytes hex-encode with their leading zero', () => {
  const bundle = syntheticBundle({ revision: 1, sourceHash: (index) => (index === 0 ? 0x00 : 0x0f) });
  equal(bundleSourceHashHex(bundle), '000f0f0f0f0f0f0f', 'zero-padded hex');
});

test('a foreign or truncated buffer fails closed', () => {
  const wrongMagic = syntheticBundle({ revision: 1, sourceHash: () => 0x11 });
  new DataView(wrongMagic.buffer).setUint32(0, 0x12345678, true);
  throws(() => bundleSourceHashHex(wrongMagic), 'magic');
  const wrongVersion = syntheticBundle({ revision: 1, sourceHash: () => 0x11 });
  new DataView(wrongVersion.buffer).setUint16(4, 2, true);
  throws(() => bundleSourceHashHex(wrongVersion), 'version');
  throws(() => bundleSourceHashHex(syntheticBundle({ revision: 1, sourceHash: () => 0x11 }).slice(0, 20)), 'truncated');
});

test('the synthetic bundle stays valid for the section decoders', () => {
  // Guards the shared header layout: if the real decoders reject this bundle,
  // the hash tests above are proving offsets against a fiction.
  equal(decodeWallRenderBands(syntheticBundle({ revision: 2, sourceHash: () => 0x22 })).length, 0, 'no wall sections');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
