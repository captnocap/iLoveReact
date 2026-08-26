// Export-boundary regression: compiled Fart Racer terrain must preserve the
// map owner's formula and native road/material stream (HEIGHTFIELDS v3).

import { chunkOriginMeters, encodeFormulaHeightfields, GROUND_CHUNK_METERS, GROUND_FLOOR_RES, GROUND_FLOOR_SAMPLES } from './heightfieldExport';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test('HEIGHTFIELDS v3 carries the native formula and chunk road stream', () => {
  const heights = new Float32Array(GROUND_FLOOR_SAMPLES);
  heights[0] = 1.25;
  const ground = new Float32Array([120, 120, 1, 0, 0, 0, 0x524f4144]);
  const formula = 'fn hf_ground_rgb(uv: vec2f) -> vec3f { return vec3f(0.1, 0.2, 0.3); }';
  const formulaBytes = new Uint8Array([...formula].map((char) => char.charCodeAt(0)));
  const encoded = encodeFormulaHeightfields(formulaBytes, [{ cx: 2, cz: 3, heights, groundData: ground }], [0.25, 0.35, 0.2], 48);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  assert(view.getUint32(0, true) === 3, 'heightfield export regressed from formula v3');
  assert(view.getUint32(4, true) === 1, 'chunk count drifted');
  const formulaLength = view.getUint32(8, true);
  assert(formulaLength === formula.length, 'formula length was not baked once');
  let cursor = 12 + formulaLength;
  assert(view.getUint32(cursor + 8, true) === ground.length, 'ground-data length was dropped');
  // The record places the chunk by its CENTRE, and the native map centres chunk
  // (cx, cz) on (cx*120, cz*120) — chunks.globalTile is floor(x + 120/2). The
  // chunk index and its centre coincide; its LOW CORNER is 60 m lower.
  assert(view.getFloat32(cursor + 16, true) === 2 * GROUND_CHUNK_METERS, 'chunk centre X is not the chunk index times the span');
  assert(view.getFloat32(cursor + 20, true) === 3 * GROUND_CHUNK_METERS, 'chunk centre Z is not the chunk index times the span');
  assert(chunkOriginMeters(2) === 2 * GROUND_CHUNK_METERS - GROUND_CHUNK_METERS / 2, 'chunk origin is not half a span below its centre');
  assert(view.getUint32(cursor, true) === GROUND_FLOOR_RES, 'grid cols left the rendered floor resolution');
  assert(view.getUint32(cursor + 4, true) === GROUND_FLOOR_RES, 'grid rows left the rendered floor resolution');
  assert(view.getFloat32(cursor + 16 + 5 * 4, true) === GROUND_CHUNK_METERS / (GROUND_FLOOR_RES - 1), 'cell size does not span the chunk at the rendered resolution');
  cursor += 16 + 40 + heights.byteLength;
  assert(view.getFloat32(cursor + (ground.length - 1) * 4, true) === ground[ground.length - 1], 'road/material stream tail was dropped');
});

// The blue-void regression (2026-08-26): a compile that ships the 241x241
// BRUSH field passes every TS check and then renders/collides as nothing,
// because terrain_grid.canAppend, MAX_DYN_VERTS, and HF_MAX_SAMPLES all reject
// it natively and silently. The encoder is the last place that can say so.
test('a non-rendered grid resolution is refused at the wire, not in the game', () => {
  const brush = new Float32Array(241 * 241);
  const ground = new Float32Array([120, 120, 1, 0]);
  let refused = false;
  try {
    encodeFormulaHeightfields(new Uint8Array([0x66]), [{ cx: 0, cz: 0, heights: brush, groundData: ground }], [1, 1, 1], 48);
  } catch { refused = true; }
  assert(refused, 'the 241x241 brush field was encoded as if the game could draw it');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} game compile tests failed`);
