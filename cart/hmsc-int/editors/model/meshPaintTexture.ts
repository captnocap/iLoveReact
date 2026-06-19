// editors/model/meshPaintTexture.ts — the PIXEL painter (req_1372). Replaces the
// box-atlas paint renderer (boxes → StaticSurface → texture) with direct RGBA
// pixel painting into a GPU <Paintable> the model's mesh samples by textureKey.
//
// Why: every old paint bug (AA seams between run-merged boxes, 1px gutters between
// packed cell slots, stale StaticSurface captures, bleed hacks) was the box-atlas
// indirection. Painting pixels straight into the texture deletes the whole class —
// a colour boundary is just adjacent texels, nearest-sampled (req_1321) = crisp,
// no blend. N colours cost nothing; 1 colour or the rainbow is the same machine.
//
// The mesh keeps its per-face UVs (the textureize unwrap). A brush dab raycasts to
// a face + interpolated UV (meshPaint.pickFaceUV), then stamps a coloured disc at
// (u*TEX, v*TEX), SCISSOR-clamped to the face's UV island so a round brush can't
// bleed onto a neighbour island packed beside it in the atlas.

import { paintableOps } from '@reactjit/runtime/hooks/usePaintable';
import { faceTexelRect, type TexelRect } from './meshPaint';
import { type EditMesh } from './editMesh';

/** The one RGBA paint texture every part's mesh samples while painting. */
export const STUDIO_PAINT_KEY = 'studio.paint.live';
/** Fixed paint resolution (px). Resolution-independent storage (PNG), so this is
 *  just the working canvas — generous so a many-face gun resolves fine detail. */
export const PAINT_TEX = 1024;

/** Imperative ops for the model paint texture (calls straight into V8, no React). */
export function paintTex() {
  return paintableOps(STUDIO_PAINT_KEY);
}

/** Hex (`#rrggbb`) → linear-ish 0..1 RGB triplet for the brush colour. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6) || '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Base coat: flat-fill the whole texture (the "fill all" / new-texture start). */
export function baseCoat(hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  paintTex().clearColor(r, g, b, 1);
}

/** The hit face's UV island rect in TEXTURE PIXELS — the scissor clamp so a dab
 *  near an island edge can't spill onto the neighbour island. */
export function faceIslandPx(mesh: EditMesh, faceIndex: number): TexelRect | null {
  return faceTexelRect(mesh, faceIndex, PAINT_TEX);
}

/** Stamp one coloured disc at a normalized UV. `radiusPx` is the brush radius in
 *  texture pixels; `island` (px) scissors the dab to the hit face. Hard round
 *  brush (kind 0, hardness 1) → crisp flat paint. */
export function stampUV(u: number, v: number, hex: string, radiusPx: number, island: TexelRect | null): void {
  const [r, g, b] = hexToRgb(hex);
  let cx = 0, cy = 0, cw = 0, ch = 0;
  if (island) {
    cx = Math.max(0, Math.floor(island.x0));
    cy = Math.max(0, Math.floor(island.y0));
    cw = Math.max(1, Math.ceil(island.x1) - cx);
    ch = Math.max(1, Math.ceil(island.y1) - cy);
  }
  paintTex().brushColor(u * PAINT_TEX, v * PAINT_TEX, radiusPx, r, g, b, 0, 0, 1, 1, 1, 0, 0, cx, cy, cw, ch);
}

/** Erase a disc back to a colour (no real alpha-erase yet — paint the base coat).
 *  `baseHex` is the texture's base colour so erase reveals it. */
export function eraseUV(u: number, v: number, baseHex: string, radiusPx: number, island: TexelRect | null): void {
  stampUV(u, v, baseHex, radiusPx, island);
}
