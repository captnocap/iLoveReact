// compile/decalAssets.ts — decal image payloads as content-addressed game
// assets (DECALIMG-0610, USER ASK req_0592: "whats the point of me being able
// to add an image if i cant ship it in the game").
//
// GUIDING_LIGHT: an image is irreducible captured content — the honest tail.
// The recipe (the packed DecalDoc) stays declarative data; the image BYTES are
// stored ONCE by sha256 in the gamefile's content-addressed asset vocabulary
// and the doc's image node references them by manifest KEY (u32). Never inline
// the bytes in the MATERIALS lump's DOCS tail — that's the product, duplicated
// per decal; the manifest key + blob is the factor.
//
// This sink is the ONE asset vocabulary for decal images: packDecalDoc calls
// internImage per image node, the bake (bakeGameFile.ts) ships `assets` as
// gamefile manifest entries + content-store payloads, and the loader
// (framework/world/constructor.zig) reads them back by the same key/kind.

import { readFileBase64 } from '@reactjit/hooks/fs';
import { base64ToBytes } from '@reactjit/workspace';
import { sha256Hex } from '@reactjit/workspace/sha256';

/** Decal image manifest keys count up from here, in intern order — above the
 *  player model/animation range (2001/2002 in bakeGameFile.ts). */
export const DECAL_IMAGE_ASSET_KEY_BASE = 3001;
/** Manifest asset-kind tag (player model = 9, player animation = 10). The
 *  loader scans the manifest for this kind — framework/world/constructor.zig
 *  DECAL_IMAGE_ASSET_KIND is its reader twin. */
export const ASSET_KIND_DECAL_IMAGE = 11;
/** An image file larger than this doesn't ship: the raster canvas caps at
 *  1024px, so a multi-megabyte source is a mistake, not a texture. */
export const MAX_DECAL_IMAGE_BYTES = 8 << 20;

export type DecalImageAsset = {
  /** the manifest key packed into the doc's image node record */
  key: number;
  /** sha256 of `bytes` — the content address (hex, the store filename) */
  hashHex: string;
  /** the raw encoded image file (png/jpg…), NOT decoded pixels */
  bytes: Uint8Array;
  /** the first src that interned this content — diagnostics only */
  src: string;
};

export type DecalAssetSink = {
  /** Intern one image file as a content-addressed asset and return its
   *  manifest key, or 0 when the file can't ship (missing/empty/oversized —
   *  warned with `context`, never thrown: a bad image degrades to a skipped
   *  node, not a failed bake). The same content interns once (sha256 dedupe);
   *  the same src never re-reads. */
  internImage(src: string, context: string): number;
  /** Everything interned, in key order — the bake's asset vocabulary. */
  readonly assets: DecalImageAsset[];
};

/** Create the bake's decal-image collector. `readBase64` is the file door —
 *  injectable so tests run without a filesystem; the default reads the SAME
 *  cwd-relative path the editor's Image primitive loads, so what previewed is
 *  what ships. */
export function createDecalAssetSink(
  readBase64: (path: string) => string | null = readFileBase64,
): DecalAssetSink {
  const assets: DecalImageAsset[] = [];
  const keyByHash = new Map<string, number>();
  const keyBySrc = new Map<string, number>(); // 0 = known-bad: one read + warn per path

  function readAndIntern(src: string, context: string): number {
    const b64 = readBase64(src);
    if (b64 === null) {
      console.warn(`[decal-assets] ${context}: image '${src}' is not readable (cwd-relative, like the editor) — node ships nothing`);
      return 0;
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(b64);
    } catch {
      console.warn(`[decal-assets] ${context}: image '${src}' transport is not valid base64 — node ships nothing`);
      return 0;
    }
    if (bytes.byteLength === 0) {
      console.warn(`[decal-assets] ${context}: image '${src}' is empty — node ships nothing`);
      return 0;
    }
    if (bytes.byteLength > MAX_DECAL_IMAGE_BYTES) {
      console.warn(`[decal-assets] ${context}: image '${src}' is ${bytes.byteLength} bytes (cap ${MAX_DECAL_IMAGE_BYTES}) — node ships nothing`);
      return 0;
    }
    const hashHex = sha256Hex(bytes);
    const existing = keyByHash.get(hashHex);
    if (existing !== undefined) return existing; // same content, one blob — content addressing is the dedupe
    const key = DECAL_IMAGE_ASSET_KEY_BASE + assets.length;
    assets.push({ key, hashHex, bytes, src });
    keyByHash.set(hashHex, key);
    return key;
  }

  return {
    assets,
    internImage(src: string, context: string): number {
      const known = keyBySrc.get(src);
      if (known !== undefined) return known;
      const key = readAndIntern(src, context);
      keyBySrc.set(src, key);
      return key;
    },
  };
}
