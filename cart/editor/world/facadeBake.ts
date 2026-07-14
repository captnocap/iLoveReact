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
import { facadeCanvasSize, facadeQuadMesh, FACADE_TEXELS_PER_METER, type Facade, type FacadeStamp } from './facades';
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
