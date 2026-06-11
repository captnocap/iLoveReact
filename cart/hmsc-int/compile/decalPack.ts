// compile/decalPack.ts — pack a DecalDoc into the flat binary the loader
// rasterizes (DECALRECIPE-0610, USER: "ok lets follow the guiding light").
//
// GUIDING_LIGHT: store the RECIPE, not the product. A decal is a declarative
// ~1KB document (rects, text, image refs — no conditionals, no loops); the
// pixels are its outer product. So the MATERIALS lump ships THE DOC, packed
// flat, and the no-V8 loader rasterizes it ONCE at load with fixed systems
// (rounded-rect fills, FreeType glyphs) — the exact shape shader materials
// already use (recipe → materialize-at-load). No editor bake, no pixel cache,
// no staleness: the bake is pure data → data, headless-green always.
//
// "Author structured → compile down to flat primitive data": all the niceness
// resolves HERE — CSS hex colors become raw RGBA bytes, hidden nodes drop,
// shader-fill rects substitute their fallback color (the WGSL fill is the
// honest tail; warned) — so the Zig reader (framework/gpu/decal_raster.zig,
// the byte-layout twin of this file) stays dumb: read, fill, blit.
//
// BINARY LAYOUT (little-endian; colors are 4 raw bytes R,G,B,A):
//   u16 docW | u16 docH | bg RGBA | u16 nodeCount
//   per node:
//     u8 kind (0 rect | 1 text | 2 image)
//     f32 x | f32 y | f32 w | f32 h | f32 opacity
//     rect:  fill RGBA | f32 borderRadius | f32 borderWidth | border RGBA
//     text:  color RGBA | f32 fontSize | u16 fontWeight | u8 align (0 l|1 c|2 r)
//            | f32 letterSpacing | u16 textByteLen | utf8 bytes
//     image: u32 assetKey | f32 borderRadius | u16 srcByteLen | utf8 bytes
//            (DECALIMG-0610: assetKey references the gamefile's content-
//            addressed manifest — ./decalAssets.ts interns the file bytes at
//            pack time; 0 = nothing shipped, the loader warns + skips. The
//            src string stays for diagnostics only.)

import { textBytes } from '@reactjit/workspace';
import type { DecalDoc, DecalNode } from '@game/textures/decal';
import type { DecalAssetSink } from './decalAssets';

export const DECAL_NODE_RECT = 0;
export const DECAL_NODE_TEXT = 1;
export const DECAL_NODE_IMAGE = 2;

/** Flat gray a shader-fill rect ships when its own bg is transparent — a
 *  wrong-but-visible block beats an invisible one (warned at pack time). */
const SHADER_FILL_FALLBACK: Rgba = [128, 128, 128, 255];

type Rgba = [number, number, number, number];

/** CSS hex → RGBA bytes. Accepts #rgb, #rrggbb, #rrggbbaa; '' (the format's
 *  "no fill") and anything unparseable → transparent (warned by the caller
 *  when that matters). */
export function packColor(value: string | undefined): Rgba {
  if (!value) return [0, 0, 0, 0];
  if (value[0] !== '#') return [0, 0, 0, 0];
  const hex = value.slice(1);
  if (hex.length === 3) {
    const n = Number.parseInt(hex, 16);
    if (!Number.isFinite(n)) return [0, 0, 0, 0];
    const r = (n >>> 8) & 15;
    const g = (n >>> 4) & 15;
    const b = n & 15;
    return [r * 17, g * 17, b * 17, 255];
  }
  if (hex.length === 6 || hex.length === 8) {
    const n = Number.parseInt(hex, 16);
    if (!Number.isFinite(n)) return [0, 0, 0, 0];
    if (hex.length === 6) return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255, 255];
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  return [0, 0, 0, 0];
}

function alignByte(align: 'left' | 'center' | 'right' | undefined): number {
  return align === 'center' ? 1 : align === 'right' ? 2 : 0;
}

class ByteWriter {
  private chunks: number[] = [];

  u8(v: number): void { this.chunks.push(v & 255); }
  u16(v: number): void { this.chunks.push(v & 255, (v >>> 8) & 255); }
  u32(v: number): void { this.chunks.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
  f32(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    const bytes = new Uint8Array(buf);
    this.chunks.push(bytes[0], bytes[1], bytes[2], bytes[3]);
  }
  rgba(c: Rgba): void { this.chunks.push(c[0], c[1], c[2], c[3]); }
  bytes(b: Uint8Array): void { for (let i = 0; i < b.length; i += 1) this.chunks.push(b[i]); }
  done(): Uint8Array { return Uint8Array.from(this.chunks); }
}

/** Pack one VISIBLE node, or null for kinds the artifact drops (hidden). */
function packNode(w: ByteWriter, node: DecalNode, decalId: string, assets: DecalAssetSink | undefined): void {
  w.u8(node.kind === 'rect' ? DECAL_NODE_RECT : node.kind === 'text' ? DECAL_NODE_TEXT : DECAL_NODE_IMAGE);
  w.f32(node.x);
  w.f32(node.y);
  w.f32(node.w);
  w.f32(node.h);
  w.f32(node.opacity ?? 1);
  if (node.kind === 'rect') {
    let fill = packColor(node.bg);
    if (node.fillShaderId) {
      // The WGSL fill is the honest tail (GUIDING_LIGHT: pay it sparingly) —
      // not carried in v1. The editor preview shows the live Effect; the
      // compiled face shows the rect's own bg, or gray when it has none.
      if (fill[3] === 0) fill = SHADER_FILL_FALLBACK;
      console.warn(`[decal-pack] ${decalId}: rect ${node.id} uses shader fill '${node.fillShaderId}' — compiled face ships its flat color (shader fills are the marked follow-up)`);
    }
    w.rgba(fill);
    w.f32(node.borderRadius ?? 0);
    w.f32(node.borderWidth ?? 0);
    w.rgba(packColor(node.borderColor));
    return;
  }
  if (node.kind === 'text') {
    w.rgba(packColor(node.color));
    w.f32(node.fontSize);
    w.u16(node.fontWeight ?? 400);
    w.u8(alignByte(node.align));
    w.f32(node.letterSpacing ?? 0);
    const utf8 = textBytes(node.text);
    w.u16(Math.min(utf8.length, 0xffff));
    w.bytes(utf8.subarray(0, 0xffff));
    return;
  }
  // Image (DECALIMG-0610): the file bytes ride the content-addressed asset
  // store; the record carries only the manifest KEY. Key 0 = nothing shipped
  // (empty src / unreadable file / no sink on this bake path) — the loader
  // warns + skips that node, never fails.
  let assetKey = 0;
  if (!node.src) {
    console.warn(`[decal-pack] ${decalId}: image node ${node.id} has an empty src — nothing to ship (re-pick the image in /compose)`);
  } else if (!assets) {
    console.warn(`[decal-pack] ${decalId}: image node ${node.id} ('${node.src}') — this bake path ships no asset vocabulary, image skipped`);
  } else {
    assetKey = assets.internImage(node.src, `${decalId}: image node ${node.id}`);
  }
  w.u32(assetKey);
  w.f32(node.borderRadius ?? 0);
  const src = textBytes(node.src);
  w.u16(Math.min(src.length, 0xffff));
  w.bytes(src.subarray(0, 0xffff));
}

/** A validated DecalDoc → the packed recipe the MATERIALS lump ships. Hidden
 *  nodes drop here (a bake-time decision, not a runtime branch). `assets` is
 *  the bake's content-addressed image collector (./decalAssets.ts) — omitted
 *  on paths that can't ship assets (image nodes then pack key 0). */
export function packDecalDoc(doc: DecalDoc, decalId: string, assets?: DecalAssetSink): Uint8Array {
  const w = new ByteWriter();
  w.u16(doc.width);
  w.u16(doc.height);
  w.rgba(packColor(doc.bg));
  const visible = doc.nodes.filter((n) => !n.hidden);
  w.u16(visible.length);
  for (const node of visible) packNode(w, node, decalId, assets);
  return w.done();
}
