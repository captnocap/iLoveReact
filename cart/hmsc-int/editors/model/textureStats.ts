// editors/model/textureStats.ts — texture census for the / dashboard (req_1879):
// how many textures, and how many PIXELS across all of them. Part of the growing
// portrait-of-your-world stat family.
//
// FREEZE LAW (req_1872): the paint/texture blobs can be ~MBs each, so we NEVER
// fully decode them. Pixel count comes from the image HEADER alone — the PNG IHDR
// or the JPEG SOF marker — read from the first few KB. So this stays cheap no
// matter how big the textures are. (Colour variety / most-used colours would need
// the actual pixel data — that's the next metric, with sampling.)

import { base64ToBytes } from '@reactjit/workspace';
import { editorChannel } from '../store';
import { cookedAssetStream } from './cookedAssetStream';
import { modelStream } from './modelStream';

export type TextureCensus = {
  /** distinct texture blobs counted (cooked textures + model paint atlases). */
  textures: number;
  /** total pixels (Σ width×height) across the textures we could read a header for. */
  pixels: number;
  /** textures whose header we couldn't parse (counted, but not in `pixels`). */
  unsized: number;
};

// base64 → bytes for just a PREFIX (the header is all we need). Decodes only the
// first few KB via the shared base64ToBytes (NOT atob — that global doesn't exist
// in this runtime), so a 5MB paint blob never gets fully decoded (freeze law).
// Strips a data-URL preamble and rounds to a 4-char boundary so the slice is whole
// base64 groups.
function headerBytes(b64: string, maxBytes = 4096): Uint8Array | null {
  let s = b64;
  const comma = s.startsWith('data:') ? s.indexOf(',') : -1;
  if (comma >= 0) s = s.slice(comma + 1);
  const chars = Math.min(s.length, Math.ceil((maxBytes * 4) / 3));
  s = s.slice(0, chars - (chars % 4));
  if (!s) return null;
  try {
    const out = base64ToBytes(s);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** Read {w,h} from a PNG IHDR or JPEG SOF header in `b`, or null if unrecognized. */
export function dimsFromBytes(b: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte signature, then IHDR (length+type+data); width@16, height@20.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { w: be32(b, 16), h: be32(b, 20) };
  }
  // JPEG: starts FF D8; walk segments to the SOF marker (FFC0..FFCF, minus the
  // non-frame C4/C8/CC), which carries height@+5, width@+7.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: be16(b, i + 5), w: be16(b, i + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + be16(b, i + 2); // skip this segment by its declared length
    }
  }
  return null;
}

function addBlobs(blobs: Record<string, string> | undefined, acc: TextureCensus): void {
  if (!blobs) return;
  for (const b64 of Object.values(blobs)) {
    acc.textures += 1;
    const bytes = headerBytes(b64);
    const dims = bytes ? dimsFromBytes(bytes) : null;
    if (dims && dims.w > 0 && dims.h > 0) acc.pixels += dims.w * dims.h;
    else acc.unsized += 1;
  }
}

/**
 * Count every texture (cooked imported textures + model pixel-paint atlases) and
 * sum their pixels from headers alone. Safe headless (a missing host yields the
 * stores we can read).
 */
export function reportTextureCensus(): TextureCensus {
  const acc: TextureCensus = { textures: 0, pixels: 0, unsized: 0 };
  try { addBlobs(editorChannel(cookedAssetStream).state().textureBlobs, acc); } catch { /* headless */ }
  try { addBlobs(editorChannel(modelStream).state().paintBlobs, acc); } catch { /* headless */ }
  return acc;
}
