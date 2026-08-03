// editor/data/texturePackage.ts — the on-disk Imported Texture format.
//
// Same philosophy as modelPackage.ts: an imported texture is a SELF-CONTAINED
// directory you can copy — the project directory IS the collection, so moving
// machines is `cp -r` and there is never a second "collect assets" copy of the
// image anywhere. The original file on disk is read ONCE at import and never
// referenced again.
//
//   cart/editor/data/textures/
//     <slug>/
//       manifest.json     durable metadata (this file's schema)
//       pixel.json        pixel-texture payload: palette + RLE rows
//       image.png         exact-image payload: the imported bytes (png passthrough)
//
// A loaded texture package materializes as a ShaderSpec (textures/shaders.ts
// dynamic registry): the payload packs into PIXEL_TEXTURE_SHADER's data[], so
// previews, the paint-material bake, and stroke-program replay all consume an
// imported texture through the exact same contract as a catalog material.
import { exists, listDir, mkdir, readFile, writeFile, writeFileBase64Atomic, readFileBase64 } from '../../../runtime/hooks/fs';
import {
  PIXEL_TEXTURE_SHADER,
  decodeRows,
  encodeRows,
  packExactTexture,
  packPixelTexture,
  type QuantizeProbe,
  type RleEntry,
} from '../textures/pixelTexture';
import type { ShaderSpec } from '../textures/shaders';
import type { Rgb } from './types';

export const TEXTURES_HOME = 'cart/editor/data/textures';
export const TEXTURE_MANIFEST_VERSION = 1;

export type TextureSource = 'pixel-texture' | 'exact-image';

export type TextureManifest = {
  version: number;
  id: string; // `img-<slug>` — doubles as the ShaderSpec id
  name: string;
  source: TextureSource;
  width: number;
  height: number;
  colors?: number; // pixel-texture: palette size
  mse?: number; // pixel-texture: quantization error at import
  originalName: string; // basename of the imported file (provenance only)
};

export type PixelPayload = {
  width: number;
  height: number;
  palette: string[]; // #rrggbb
  rows: RleEntry[][];
};

export type TexturePackage = {
  manifest: TextureManifest;
  /** pixel-texture: the decoded payload. exact-image: undefined (bytes stay on disk). */
  pixel?: PixelPayload;
};

/** An exact imported image that can be reused as a UV source. The texture
 * package remains the shared authoring asset; ModelView installs a hashed PNG
 * into a model only when the patch is actually used there. */
export type TexturePatchPackage = {
  id: string;
  name: string;
  width: number;
  height: number;
  imagePath: string;
};

export function textureSlug(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'texture';
}

export function textureDir(slug: string): string {
  return `${TEXTURES_HOME}/${slug}`;
}

export function exactTextureImagePath(manifest: TextureManifest): string | null {
  if (manifest.source !== 'exact-image') return null;
  const extension = manifest.originalName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return null;
  return `${textureDir(textureSlug(manifest.name))}/image.${extension}`;
}

export function texturePatchPackages(packages: readonly TexturePackage[]): TexturePatchPackage[] {
  return packages.flatMap((pkg) => {
    const imagePath = exactTextureImagePath(pkg.manifest);
    return imagePath ? [{
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      width: pkg.manifest.width,
      height: pkg.manifest.height,
      imagePath,
    }] : [];
  });
}

const hexByte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const rgbToHexStr = (rgb: Rgb) => `#${hexByte(rgb[0])}${hexByte(rgb[1])}${hexByte(rgb[2])}`;
const hexToRgbTriple = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** Persist a quantized import as a pixel-texture package. */
export function savePixelTexture(name: string, originalName: string, probe: QuantizeProbe): TextureManifest | null {
  const slug = textureSlug(name);
  const dir = textureDir(slug);
  if (!mkdir(dir)) return null;
  const manifest: TextureManifest = {
    version: TEXTURE_MANIFEST_VERSION,
    id: `img-${slug}`,
    name,
    source: 'pixel-texture',
    width: probe.width,
    height: probe.height,
    colors: probe.palette.length,
    mse: Math.round(probe.mse),
    originalName,
  };
  const payload: PixelPayload = {
    width: probe.width,
    height: probe.height,
    palette: probe.palette.map(rgbToHexStr),
    rows: encodeRows(probe.indices, probe.width, probe.height),
  };
  if (!writeFile(`${dir}/pixel.json`, JSON.stringify(payload))) return null;
  if (!writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2))) return null;
  return manifest;
}

/** Persist an exact-image import: copy the ORIGINAL bytes into the package
 *  (single copy, content lives with the project). */
export function saveExactImage(name: string, sourcePath: string, width: number, height: number): TextureManifest | null {
  const slug = textureSlug(name);
  const dir = textureDir(slug);
  const base64 = readFileBase64(sourcePath);
  if (!base64) return null;
  if (!mkdir(dir)) return null;
  const ext = (sourcePath.split('.').pop() ?? 'png').toLowerCase();
  if (!writeFileBase64Atomic(`${dir}/image.${ext}`, base64)) return null;
  const manifest: TextureManifest = {
    version: TEXTURE_MANIFEST_VERSION,
    id: `img-${slug}`,
    name,
    source: 'exact-image',
    width,
    height,
    originalName: sourcePath.split('/').pop() ?? sourcePath,
  };
  if (!writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2))) return null;
  return manifest;
}

export function loadTexturePackages(): TexturePackage[] {
  if (!exists(TEXTURES_HOME)) return [];
  const out: TexturePackage[] = [];
  for (const slug of listDir(TEXTURES_HOME)) {
    const dir = textureDir(slug);
    const manifestText = readFile(`${dir}/manifest.json`);
    if (!manifestText) continue;
    try {
      const manifest = JSON.parse(manifestText) as TextureManifest;
      if (typeof manifest.id !== 'string' || typeof manifest.source !== 'string') continue;
      if (manifest.source === 'pixel-texture') {
        const payloadText = readFile(`${dir}/pixel.json`);
        if (!payloadText) continue;
        out.push({ manifest, pixel: JSON.parse(payloadText) as PixelPayload });
      } else {
        out.push({ manifest });
      }
    } catch {
      // A malformed package is skipped, never fatal — the rest of the library loads.
      continue;
    }
  }
  return out;
}

/** The exact-image bytes as base64 (for <Image>/blob previews). */
export function exactImageBase64(manifest: TextureManifest): string | null {
  const path = exactTextureImagePath(manifest);
  return path ? readFileBase64(path) : null;
}

/** Materialize a texture package as a ShaderSpec so it is a first-class
 *  material: ink-pickable, bakeable, replayable. Pixel textures carry their
 *  palette; exact images decode once and pack raw-mode at a paintable size. */
export function textureSpec(pkg: TexturePackage, decodeRgba: (base64: string) => { width: number; height: number; rgba: Uint8Array } | null): ShaderSpec | null {
  const m = pkg.manifest;
  if (m.source === 'pixel-texture' && pkg.pixel) {
    const palette = pkg.pixel.palette.map(hexToRgbTriple);
    const indices = decodeRows(pkg.pixel.rows, pkg.pixel.width, pkg.pixel.height);
    const data = packPixelTexture({ width: pkg.pixel.width, height: pkg.pixel.height, palette, indices });
    return {
      id: m.id,
      label: m.name,
      group: 'Imported',
      blurb: `${m.name} — imported image, ${m.colors ?? palette.length} colors, recolorable.`,
      shader: PIXEL_TEXTURE_SHADER,
      base: [],
      variants: [{ id: 'v0', label: 'Source', value: 0, params: [] }],
      buildData: () => data,
      // Palette-as-slots editing for imported textures is a follow-up: the studio's
      // withPalette() writes the fill-board D[5] contract, which would corrupt this
      // shader's packed data. Empty slots keeps it safely out of that path.
      slots: [],
    };
  }
  if (m.source === 'exact-image') {
    const base64 = exactImageBase64(m);
    if (!base64) return null;
    const raw = decodeRgba(base64);
    if (!raw) return null;
    // Nearest-sample down to a paintable size: the raw-mode data[] carries
    // w*h*3 floats, so cap the longest side (the ORIGINAL bytes stay pristine
    // in the package; this is only the paint/preview projection).
    const CAP = 128;
    const longest = Math.max(raw.width, raw.height);
    const scale = longest > CAP ? CAP / longest : 1;
    const w = Math.max(1, Math.round(raw.width * scale));
    const h = Math.max(1, Math.round(raw.height * scale));
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(raw.height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(raw.width - 1, Math.floor(x / scale));
        const si = (sy * raw.width + sx) * 4;
        rgba.set(raw.rgba.subarray(si, si + 4), (y * w + x) * 4);
      }
    }
    const data = packExactTexture(rgba, w, h);
    return {
      id: m.id,
      label: m.name,
      group: 'Imported',
      blurb: `${m.name} — imported image, exact pixels.`,
      shader: PIXEL_TEXTURE_SHADER,
      base: [],
      variants: [{ id: 'v0', label: 'Source', value: 0, params: [] }],
      buildData: () => data,
      slots: [],
    };
  }
  return null;
}
