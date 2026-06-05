// painted.test.ts — P4 behavior tests for the painted-overlay layer
// (game/painted.ts, MODELPAINT-0605). The contract: an overlay is plain
// color data (pixels only — the ruling), it survives the document/stream
// boundary through validation (never throws, clamps garbage, V20-tolerant),
// its texture keys are content-addressed by the save stamp, and the Effect
// packing puts every painted cell where the shader will read it.

import {
  figurePaintTextureKey, hexChannel, packPaintedLayerData, paintedOverlayHasContent,
  validatePaintedOverlay, vehiclePaintTextureKey, PAINTED_LAYER_WGSL, type PaintedOverlay,
} from './painted';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

function overlay(partial?: Partial<PaintedOverlay>): PaintedOverlay {
  return {
    version: 1, stamp: 1717600000000, cols: 8, rows: 4,
    layers: [
      { color: '#ff8040', cells: [0, 9, 31] },
      { color: '#00ff0080', cells: [5] },
    ],
    ...partial,
  };
}

test('a valid overlay round-trips JSON + validation unchanged', () => {
  const source = overlay({ paintDoc: { kind: 'paint-doc', layers: [] } });
  const back = validatePaintedOverlay(JSON.parse(JSON.stringify(source)));
  assert(back !== null, 'a valid overlay validates');
  assertEqual(JSON.stringify(back), JSON.stringify(source), 'validation is lossless on valid data');
});

test('validation rejects garbage and clamps stray cells — never throws', () => {
  assertEqual(validatePaintedOverlay(null), null, 'null rejected');
  assertEqual(validatePaintedOverlay({ version: 2 }), null, 'future version rejected (additive law: new versions get new readers)');
  assertEqual(validatePaintedOverlay(overlay({ cols: 0 })), null, 'degenerate grid rejected');
  assertEqual(validatePaintedOverlay(overlay({ layers: [{ color: 'red', cells: [] }] as any })), null, 'non-hex color rejected');
  const clamped = validatePaintedOverlay(overlay({ layers: [{ color: '#ffffff', cells: [-1, 3, 31, 32, 999] }] }));
  assertEqual(clamped?.layers[0].cells.join(','), '3,31', 'out-of-grid cells are dropped, in-grid survive');
});

test('hasContent distinguishes a painting from an empty save (a removal)', () => {
  assert(paintedOverlayHasContent(overlay()), 'painted cells = content');
  assert(!paintedOverlayHasContent(overlay({ layers: [{ color: '#ffffff', cells: [] }] })), 'no cells = no content');
});

test('texture keys are content-addressed by the stamp', () => {
  assertEqual(figurePaintTextureKey('head', 7), 'painted.figure.head.7', 'figure key recipe');
  assertEqual(vehiclePaintTextureKey('door_l', 7), 'painted.vehicle.door_l.7', 'vehicle key recipe');
  assert(figurePaintTextureKey('head', 7) !== figurePaintTextureKey('head', 8), 'a re-save re-keys');
});

test('the layer pack puts header, color and every cell where the shader reads', () => {
  const o = overlay();
  const pack = packPaintedLayerData(o, 0);
  assertEqual(pack.length, 6 + 32, 'header + cols*rows flags');
  assertEqual(pack[0], 8, 'cols');
  assertEqual(pack[1], 4, 'rows');
  assertClose(pack[2], 1, 1e-6, 'r of #ff8040');
  assertClose(pack[3], 0x80 / 255, 1e-6, 'g of #ff8040');
  assertClose(pack[4], 0x40 / 255, 1e-6, 'b of #ff8040');
  assertEqual(pack[5], 1, 'no alpha channel = opaque');
  assertEqual(pack[6 + 0] + pack[6 + 9] + pack[6 + 31], 3, 'painted cells are 1');
  assertEqual(pack.reduce((n, v, i) => (i >= 6 && v === 1 ? n + 1 : n), 0), 3, 'exactly the painted cells');
  const alpha = packPaintedLayerData(o, 1);
  assertClose(alpha[5], 0x80 / 255, 1e-6, '#RRGGBBAA alpha lands in the pack');
});

test('hexChannel reads both hex shapes', () => {
  assertClose(hexChannel('#336699', 1), 0x66 / 255, 1e-6, 'RRGGBB channel');
  assertClose(hexChannel('#33669980', 3), 0x80 / 255, 1e-6, 'AA channel');
});

test('the WGSL carries no backticks and no unary plus (the shader laws)', () => {
  assert(!PAINTED_LAYER_WGSL.includes('`'), 'backticks end the template literal');
  assert(!/[^\w)]\+\d/.test(PAINTED_LAYER_WGSL.replace(/\+ /g, '')), 'unary plus crashes module creation');
});

finish('painted');
