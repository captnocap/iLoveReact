// editor/data/stickerStore.ts — the on-disk Sticker asset (req_3018/req_3025).
//
// A sticker is REUSABLE ART WITH A PHYSICAL SIZE: it references an imported
// texture package (texturePackage.ts — the formal import flow; the art bytes
// already live with the project, never a loose disk path) and adds the meter
// footprint that makes it stampable at true scale on any surface. Memory
// scales with unique stickers, not placements (V29 reference-not-embed): a
// placement is a ~30-byte row on its piece, this manifest + the texture
// package are the only stored art.
//
//   cart/editor/data/stickers/
//     <slug>/
//       manifest.json     durable metadata (this file's schema)
//
// Rendering resolves the texture id through the dynamic ShaderSpec registry
// (textures/shaders.ts) — the same PIXEL_TEXTURE_SHADER contract previews,
// paint bakes, and stroke replay already consume.
import { exists, listDir, mkdir, readFile, writeFile } from '../../../runtime/hooks/fs';
import { textureSlug } from './texturePackage';

export const STICKERS_HOME = 'cart/editor/data/stickers';
export const STICKER_MANIFEST_VERSION = 1;

/** The 4x6 thermal label — the user's reference sticker size (req_3021). */
export const DEFAULT_STICKER_METERS = { width: 0.1016, height: 0.1524 };

export type StickerManifest = {
  version: number;
  id: string; // `stk-<slug>`
  name: string;
  /** ShaderSpec id of the imported texture package carrying the art (`img-<slug>`). */
  textureId: string;
  /** Physical footprint at scale 1 — the truth that keeps stamps meter-accurate. */
  widthMeters: number;
  heightMeters: number;
};

export function stickerDir(slug: string): string {
  return `${STICKERS_HOME}/${slug}`;
}

function validManifest(raw: unknown): raw is StickerManifest {
  const m = raw as Partial<StickerManifest> | null;
  if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.textureId !== 'string') return false;
  if (!Number.isFinite(m.widthMeters) || !Number.isFinite(m.heightMeters)) return false;
  return (m.widthMeters as number) > 0 && (m.heightMeters as number) > 0;
}

/** Persist a sticker. `name` doubles as the slug source; re-saving the same
 *  name upserts (the texturePackage idiom). Null = disk refused, loudly. */
export function saveSticker(
  name: string,
  textureId: string,
  widthMeters: number,
  heightMeters: number,
): StickerManifest | null {
  const slug = textureSlug(name);
  const dir = stickerDir(slug);
  if (!mkdir(dir)) return null;
  const manifest: StickerManifest = {
    version: STICKER_MANIFEST_VERSION,
    id: `stk-${slug}`,
    name,
    textureId,
    widthMeters,
    heightMeters,
  };
  if (!writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2))) return null;
  return manifest;
}

export function loadStickers(): StickerManifest[] {
  if (!exists(STICKERS_HOME)) return [];
  const out: StickerManifest[] = [];
  for (const slug of listDir(STICKERS_HOME)) {
    const text = readFile(`${stickerDir(slug)}/manifest.json`);
    if (!text) continue;
    try {
      const raw = JSON.parse(text) as unknown;
      if (validManifest(raw)) out.push(raw);
    } catch {
      continue; // a malformed sticker is skipped, never fatal — the rest load
    }
  }
  return out;
}

// ── The live registry (the IMPORTED_SPECS idiom) ───────────────────────────────
// Loaded once at boot (and after every save) so placement rendering and the
// library resolve stickers synchronously without re-reading disk.

let STICKERS: StickerManifest[] = [];

export function registerStickers(stickers: StickerManifest[]): void {
  STICKERS = stickers;
}

export function allStickers(): readonly StickerManifest[] {
  return STICKERS;
}

export function stickerById(id: string): StickerManifest | undefined {
  return STICKERS.find((s) => s.id === id);
}
