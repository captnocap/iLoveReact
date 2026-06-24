// editors/build/ingestImage.ts — make an uploaded image PORTABLE (req_1774).
//
// The problem this fixes: image uploads used to store the picked file's RAW
// absolute path (e.g. /home/siah/pics/wall.png) on the decal. That path breaks
// the moment the file is renamed/moved, and is doubly dead on another machine
// (the file isn't in the repo, and /home/siah doesn't exist on macOS). The data
// store that holds the decal is gitignored, so nothing about an upload travelled.
//
// The fix: copy the image BYTES into a repo-tracked, content-addressed folder and
// store a repo-RELATIVE ref instead of the path. That ref then travels with
// `git push`, survives a source rename (it's keyed by content, not name), and
// resolves from the repo root on any OS. Same content-addressing idea the studio
// texture cache already uses (texSource) — here it points at a TRACKED home.

import { exists, mkdir, readFileBase64, writeFileBase64Atomic } from '@reactjit/hooks/fs';
import { hashHex } from '../model/textureGen';

/** Repo-tracked home for ingested image bytes. Repo-relative on purpose: it
 *  resolves from the repo root whether the cart runs on this box or a MacBook. */
export const TEX_ASSET_DIR = 'cart/hmsc-int/assets/tex';

/** Normalize a file extension off a path (jpeg→jpg, default png), dropping any
 *  query suffix. Used only to keep the asset filename recognizable — the hash is
 *  what makes it unique. */
function ext(path: string): string {
  const m = /\.([A-Za-z0-9]+)(?:\?.*)?$/.exec(path);
  const e = (m?.[1] ?? 'png').toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}

/** True when an image src is ALREADY portable — an inline `data:` URL (the bytes
 *  ride in the record) or a file already under the repo asset dir. Such a src
 *  needs no ingest; everything else is an external path to be copied in. */
export function isRepoLocalImageSrc(src: string): boolean {
  return src.startsWith('data:') || src.startsWith(TEX_ASSET_DIR);
}

/** Copy an external image file INTO the repo as a content-addressed asset and
 *  return its repo-relative path. Returns null when the source can't be read
 *  (moved/renamed/gone) so callers can fall back or report it. Idempotent:
 *  identical bytes always land at the same path, so re-runs dedupe for free. */
export function ingestImageFile(path: string): string | null {
  const b64 = readFileBase64(path);
  if (!b64) return null;
  mkdir(TEX_ASSET_DIR);
  const rel = `${TEX_ASSET_DIR}/${hashHex(b64)}.${ext(path)}`;
  if (!exists(rel)) writeFileBase64Atomic(rel, b64);
  return rel;
}
