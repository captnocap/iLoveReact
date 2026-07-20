// world/facadeBake.ts — facade paint → the world (req_3057).
//
// The DURABLE form is the facade's paint program (strokes + stamp rows in
// world.json — the paint ruling). This module owns the derived forms:
//   bake    — painter readback RGBA + CPU-blitted stamps → PNG, cached beside
//             the map document (facades/<id>.png — regenerable, the same
//             persisted-cache pattern as a model package's atlases/base.png).
//   render  — cached PNGs + facade quads register as resident meshes + refs
//             that livePush appends, so the paint draws in every world view.
import { exists, mkdir, readFileBase64, writeFileBase64Atomic } from '../../../runtime/hooks/fs';
import { base64ToBytes, bytesToBase64 } from '../../../runtime/workspace';
import { encode as encodeImage } from '../../../runtime/image';
import { mapDocumentPaths } from '../data/mapDocuments';
import { stickerById } from '../data/stickerStore';
import { shaderSpec } from '../textures/shaders';
import { facadeCanvasSize, facadeQuadMesh, FACADE_TEXELS_PER_METER, type Facade, type FacadeStamp, type FacadeStrokeSelection } from './facades';
import type { BlendMode, PaintInk } from '../../../runtime/paint/model';
import { compositeBlendChannel } from '../../../runtime/paint/blend';
import { hexToRgb01 } from '../../../runtime/paint/colors';
import type { MeshRef, ResidentMesh } from './meshProps';

const DEG = Math.PI / 180;

/** Decode a PIXEL_TEXTURE_SHADER data[] pack to RGBA bytes (palette or raw
 *  mode). Transparent cells (palette -1) come back alpha 0. */
export function decodePackedTexture(data: number[]): { w: number; h: number; rgba: Uint8Array } {
  const w = Math.max(1, Math.round(data[0] ?? 1));
  const h = Math.max(1, Math.round(data[1] ?? 1));
  const k = Math.round(data[2] ?? 0);
  const rgba = new Uint8Array(w * h * 4);
  if (k > 0) {
    const cells = 3 + k * 3;
    for (let i = 0; i < w * h; i += 1) {
      const idx = Math.round(data[cells + i] ?? -1);
      if (idx < 0 || idx >= k) continue; // stays alpha 0
      const p = 3 + idx * 3;
      rgba[i * 4] = Math.round((data[p] ?? 0) * 255);
      rgba[i * 4 + 1] = Math.round((data[p + 1] ?? 0) * 255);
      rgba[i * 4 + 2] = Math.round((data[p + 2] ?? 0) * 255);
      rgba[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < w * h; i += 1) {
      rgba[i * 4] = Math.round((data[3 + i * 3] ?? 0) * 255);
      rgba[i * 4 + 1] = Math.round((data[4 + i * 3] ?? 0) * 255);
      rgba[i * 4 + 2] = Math.round((data[5 + i * 3] ?? 0) * 255);
      rgba[i * 4 + 3] = 255;
    }
  }
  return { w, h, rgba };
}

/** Composite one stamp over the canvas — FREE rotation (the paint level has no
 *  quarter-turn limit): each covered canvas texel inverse-rotates into sticker
 *  space and nearest-samples. Canvas row 0 = the facade TOP. */
export function blitStampInto(canvas: Uint8Array, cw: number, ch: number, stamp: FacadeStamp, facadeHeightMeters: number): void {
  const sticker = stickerById(stamp.stickerId);
  if (!sticker) return;
  const spec = shaderSpec(sticker.textureId);
  if (!spec) return;
  const img = decodePackedTexture(spec.buildData());
  const px = FACADE_TEXELS_PER_METER;
  const wPx = sticker.widthMeters * stamp.scale * px;
  const hPx = sticker.heightMeters * stamp.scale * px;
  const cx = stamp.u * px;
  const cy = (facadeHeightMeters - stamp.v) * px; // v measures UP; rows run DOWN
  const cos = Math.cos(-stamp.rotDegrees * DEG);
  const sin = Math.sin(-stamp.rotDegrees * DEG);
  const reach = Math.ceil(Math.hypot(wPx, hPx) / 2) + 1;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(cw - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(ch - 1, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const su = (dx * cos - dy * sin) / wPx + 0.5;
      const sv = (dx * sin + dy * cos) / hPx + 0.5;
      if (su < 0 || su >= 1 || sv < 0 || sv >= 1) continue;
      const sx = Math.min(img.w - 1, Math.floor(su * img.w));
      const sy = Math.min(img.h - 1, Math.floor(sv * img.h));
      const s = (sy * img.w + sx) * 4;
      const a = img.rgba[s + 3]!;
      if (a === 0) continue; // die-cut transparency
      const d = (y * cw + x) * 4;
      canvas[d] = img.rgba[s]!;
      canvas[d + 1] = img.rgba[s + 1]!;
      canvas[d + 2] = img.rgba[s + 2]!;
      canvas[d + 3] = 255;
    }
  }
}

export type FacadeInkPixels = { width: number; height: number; rgba: Uint8Array };

function insideSelection(x: number, y: number, selection?: FacadeStrokeSelection): boolean {
  if (!selection || selection.points.length < 4) return true;
  if (selection.kind === 'marquee') {
    const ax = selection.points[0]!, ay = selection.points[1]!;
    const bx = selection.points[selection.points.length - 2]!, by = selection.points[selection.points.length - 1]!;
    return x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by);
  }
  if (selection.points.length < 6) return true;
  let inside = false;
  const n = selection.points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = selection.points[i * 2]!, yi = selection.points[i * 2 + 1]!;
    const xj = selection.points[j * 2]!, yj = selection.points[j * 2 + 1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** Apply one host-generated RGBA brush mask to a layer. The host remains the
 *  only brush-footprint engine; this CPU save-boundary pass merely supplies a
 *  shader tile (or polygon clip) to that exact coverage. `selection` points are
 *  texture pixels. Mutates and returns `base`. */
export function compositeFacadeStrokeMask(
  base: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  ink: PaintInk,
  erase: boolean,
  selection?: FacadeStrokeSelection,
  shader?: FacadeInkPixels | null,
  blend: BlendMode = 'normal',
): Uint8Array {
  if (base.length !== width * height * 4 || mask.length !== base.length) return base;
  const color = ink.kind === 'color' ? hexToRgb01(ink.hex) : ([1, 1, 1] as [number, number, number]);
  const tiles = ink.kind === 'shader' && ink.tiles && ink.tiles > 0 ? ink.tiles : 1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!insideSelection(x + 0.5, y + 0.5, selection)) continue;
    const i = (y * width + x) * 4;
    const coverage = mask[i + 3]! / 255;
    if (coverage <= 0) continue;
    if (erase || blend === 'erase') {
      const keep = 1 - coverage;
      base[i] = Math.round(base[i]! * keep);
      base[i + 1] = Math.round(base[i + 1]! * keep);
      base[i + 2] = Math.round(base[i + 2]! * keep);
      base[i + 3] = Math.round(base[i + 3]! * keep);
      continue;
    }
    let sr = color[0], sg = color[1], sb = color[2], sa = coverage;
    if (ink.kind === 'shader' && shader && shader.width > 0 && shader.height > 0) {
      const sx = Math.floor((((x / width) * shader.width * tiles) % shader.width + shader.width) % shader.width);
      const sy = Math.floor((((y / height) * shader.height * tiles) % shader.height + shader.height) % shader.height);
      const si = (sy * shader.width + sx) * 4;
      sr = shader.rgba[si]! / 255; sg = shader.rgba[si + 1]! / 255; sb = shader.rgba[si + 2]! / 255;
      sa *= shader.rgba[si + 3]! / 255;
    }
    const da = base[i + 3]! / 255;
    base[i] = Math.round(compositeBlendChannel(base[i]! / 255, da, sr, sa, blend) * 255);
    base[i + 1] = Math.round(compositeBlendChannel(base[i + 1]! / 255, da, sg, sa, blend) * 255);
    base[i + 2] = Math.round(compositeBlendChannel(base[i + 2]! / 255, da, sb, sa, blend) * 255);
    base[i + 3] = Math.round((sa + da * (1 - sa)) * 255);
  }
  return base;
}

export function resizeFacadeRgba(source: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return source.slice();
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y += 1) for (let x = 0; x < dw; x += 1) {
    const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    const si = (sy * sw + sx) * 4, di = (y * dw + x) * 4;
    out[di] = source[si]!; out[di + 1] = source[si + 1]!; out[di + 2] = source[si + 2]!; out[di + 3] = source[si + 3]!;
  }
  return out;
}

export function facadePngPath(stem: string, facadeId: string): string {
  return `${mapDocumentPaths(stem).dir}/facades/${facadeId}.png`;
}

/** Bake: the painter's stroke readback (RGBA, canvas-sized) + every stamp
 *  composited in program order, encoded and cached beside the map document.
 *  Returns whether the cache landed on disk. */
export function saveFacadeBake(stem: string, facade: Facade, strokesRgba: Uint8Array): boolean {
  const { w, h } = facadeCanvasSize(facade);
  if (strokesRgba.length !== w * h * 4) {
    console.error(`[facade] bake SKIPPED — readback ${strokesRgba.length}B does not match ${w}x${h} canvas`);
    return false;
  }
  const canvas = new Uint8Array(strokesRgba);
  for (const stamp of facade.stamps) blitStampInto(canvas, w, h, stamp, facade.heightMeters);
  const png = encodeImage(canvas, w, h, { format: 'png' });
  if (!png) {
    console.error('[facade] bake SKIPPED — PNG encode failed');
    return false;
  }
  mkdir(`${mapDocumentPaths(stem).dir}/facades`);
  return writeFileBase64Atomic(facadePngPath(stem, facade.id), bytesToBase64(png));
}

// ── the live registry livePush consumes ───────────────────────────────────────
// AppFrame publishes the active map's facades here; pushResidentMeshes appends
// the quads, pushLiveWorld appends the refs. Bake cache misses draw nothing —
// honestly absent until the painter saves once.

let LIVE: { stem: string; facades: readonly Facade[] } = { stem: '', facades: [] };

export function setLiveFacades(stem: string, facades: readonly Facade[]): void {
  LIVE = { stem, facades };
}

export function facadeMeshKey(facadeId: string): string {
  return `facade:${facadeId}`;
}

export function liveFacadeResidentMeshes(): ResidentMesh[] {
  const out: ResidentMesh[] = [];
  for (const f of LIVE.facades) {
    const path = facadePngPath(LIVE.stem, f.id);
    if (!exists(path)) continue;
    const b64 = readFileBase64(path);
    if (!b64) continue;
    out.push({ key: facadeMeshKey(f.id), vertices: facadeQuadMesh(f), png: base64ToBytes(b64) });
  }
  return out;
}

export function liveFacadeRefs(): MeshRef[] {
  return LIVE.facades
    .filter((f) => exists(facadePngPath(LIVE.stem, f.id)))
    .map((f) => ({ key: facadeMeshKey(f.id), x: 0, y: 0, z: 0, yaw: 0 }));
}
