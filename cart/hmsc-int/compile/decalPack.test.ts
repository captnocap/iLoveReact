// compile/decalPack tests — the packed decal recipe's byte layout, pinned
// (DECALRECIPE-0610). framework/gpu/decal_raster.zig reads these exact
// offsets at load; a drift here is a corrupt-looking doc there.

import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';
import type { DecalDoc } from '../game/textures/decal';
import { DECAL_NODE_IMAGE, DECAL_NODE_RECT, DECAL_NODE_TEXT, packColor, packDecalDoc } from './decalPack';

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

test('packColor resolves css hex forms to RGBA bytes at pack time', () => {
  assertEqual(JSON.stringify(packColor('#ff8000')), '[255,128,0,255]', '#rrggbb');
  assertEqual(JSON.stringify(packColor('#ff800080')), '[255,128,0,128]', '#rrggbbaa');
  assertEqual(JSON.stringify(packColor('#f80')), '[255,136,0,255]', '#rgb expands');
  assertEqual(JSON.stringify(packColor('')), '[0,0,0,0]', 'empty = transparent (no fill)');
  assertEqual(JSON.stringify(packColor('tomato')), '[0,0,0,0]', 'non-hex degrades to transparent');
});

test('header + rect node pack at the pinned offsets', () => {
  const doc: DecalDoc = {
    version: 1, width: 512, height: 256, bg: '#0b1320',
    nodes: [{ id: 'r1', kind: 'rect', x: 10, y: 20, w: 100, h: 50, bg: '#ff0000', borderRadius: 8, borderWidth: 2, borderColor: '#00ff00', opacity: 0.5 }],
  };
  const bytes = packDecalDoc(doc, 'custom:test');
  const v = view(bytes);
  assertEqual(v.getUint16(0, true), 512, 'docW');
  assertEqual(v.getUint16(2, true), 256, 'docH');
  assertEqual(bytes[4], 0x0b, 'bg r');
  assertEqual(bytes[5], 0x13, 'bg g');
  assertEqual(bytes[6], 0x20, 'bg b');
  assertEqual(bytes[7], 255, 'bg a');
  assertEqual(v.getUint16(8, true), 1, 'node count');
  // node: kind u8 | x,y,w,h,opacity f32×5 | fill rgba | radius f32 | width f32 | border rgba
  assertEqual(bytes[10], DECAL_NODE_RECT, 'kind');
  assertClose(v.getFloat32(11, true), 10, 1e-6, 'x');
  assertClose(v.getFloat32(15, true), 20, 1e-6, 'y');
  assertClose(v.getFloat32(19, true), 100, 1e-6, 'w');
  assertClose(v.getFloat32(23, true), 50, 1e-6, 'h');
  assertClose(v.getFloat32(27, true), 0.5, 1e-6, 'opacity');
  assertEqual(bytes[31], 255, 'fill r');
  assertEqual(bytes[34], 255, 'fill a');
  assertClose(v.getFloat32(35, true), 8, 1e-6, 'borderRadius');
  assertClose(v.getFloat32(39, true), 2, 1e-6, 'borderWidth');
  assertEqual(bytes[44], 255, 'border g');
  assertEqual(bytes.length, 47, 'rect record ends the stream');
});

test('text node packs font surface + utf8 payload', () => {
  const doc: DecalDoc = {
    version: 1, width: 64, height: 64, bg: '',
    nodes: [{ id: 't1', kind: 'text', x: 0, y: 0, w: 64, h: 32, text: 'NET CAFE', color: '#ffffff', fontSize: 24, fontWeight: 700, align: 'center', letterSpacing: 1.5 }],
  };
  const bytes = packDecalDoc(doc, 'custom:test');
  const v = view(bytes);
  assertEqual(bytes[7], 0, 'empty bg packs transparent');
  assertEqual(bytes[10], DECAL_NODE_TEXT, 'kind');
  // after kind + 5×f32 (21 bytes in): color rgba | fontSize f32 | weight u16 | align u8 | letterSpacing f32 | len u16 | utf8
  const at = 10 + 1 + 20;
  assertEqual(bytes[at], 255, 'color r');
  assertClose(v.getFloat32(at + 4, true), 24, 1e-6, 'fontSize');
  assertEqual(v.getUint16(at + 8, true), 700, 'fontWeight');
  assertEqual(bytes[at + 10], 1, 'align center = 1');
  assertClose(v.getFloat32(at + 11, true), 1.5, 1e-6, 'letterSpacing');
  assertEqual(v.getUint16(at + 15, true), 8, 'text byte length');
  assertEqual(String.fromCharCode(...bytes.subarray(at + 17, at + 25)), 'NET CAFE', 'utf8 payload');
  assertEqual(bytes.length, at + 25, 'text record ends the stream');
});

test('hidden nodes drop at pack; image nodes carry their src', () => {
  const doc: DecalDoc = {
    version: 1, width: 64, height: 64, bg: '#000000',
    nodes: [
      { id: 'h', kind: 'rect', x: 0, y: 0, w: 4, h: 4, bg: '#ff0000', hidden: true },
      { id: 'i', kind: 'image', x: 1, y: 2, w: 30, h: 40, src: 'images/poster.png' },
    ],
  };
  const bytes = packDecalDoc(doc, 'custom:test');
  const v = view(bytes);
  assertEqual(v.getUint16(8, true), 1, 'hidden node dropped — one packed node');
  assertEqual(bytes[10], DECAL_NODE_IMAGE, 'image kind');
  const at = 10 + 1 + 20;
  assertEqual(v.getUint16(at, true), 17, 'src byte length');
  assertEqual(String.fromCharCode(...bytes.subarray(at + 2, at + 19)), 'images/poster.png', 'src payload');
});

test('shader-fill rect substitutes a visible flat color when its bg is transparent', () => {
  const doc: DecalDoc = {
    version: 1, width: 64, height: 64, bg: '',
    nodes: [
      { id: 's1', kind: 'rect', x: 0, y: 0, w: 8, h: 8, bg: '', fillShaderId: 'plasma', fillData: [1, 2] },
      { id: 's2', kind: 'rect', x: 0, y: 0, w: 8, h: 8, bg: '#112233', fillShaderId: 'plasma', fillData: [1, 2] },
    ],
  };
  const bytes = packDecalDoc(doc, 'custom:test');
  assertEqual(bytes[31], 128, 'transparent-bg shader rect ships gray');
  assertEqual(bytes[34], 255, 'gray is opaque');
  const second = 10 + 37 + 1 + 20; // second node's fill rgba
  assertEqual(bytes[second], 0x11, 'authored bg wins when present');
});

finish('compile/decal-pack');
