// editor/data/editorDataRoot.ts — where the editor's AUTHORED data lives.
//
// It used to live under `zig-out/game/editor/`, and on 2026-08-08 that cost a full-scale
// world map: `zig-out` is the build-output directory by every convention in this repo, so
// "clear out zig-out" read as "delete build artifacts" and took the authored maps with it
// (req_4083). Nothing about the old path said "this is the only copy of your work."
//
// So authored data now lives OUTSIDE the build tree entirely, under a root whose name says
// what it is. The two rules that make this stick:
//
//   1. `userdata/` is a SIBLING of `zig-out`, not a child. No cleanup that targets build
//      output can reach it by accident, however broadly it is written.
//   2. Anything under `zig-out` is regenerable by definition. If a file cannot be rebuilt
//      from source, it does not belong there — it belongs here.
//
// Bake OUTPUT stays in `zig-out/game/` where it belongs: `hmsc.gamefile` and the
// contentstore are products of compiling this data, and losing them costs a rebuild.

import { exists, listDir, mkdir, readFile, writeFile } from '../../../runtime/hooks/fs';

/** Authored, irreplaceable, never swept by a build clean. */
export const USER_DATA_ROOT = 'userdata';
export const EDITOR_DATA_ROOT = `${USER_DATA_ROOT}/editor`;

/** Where this data lived before req_4083. Read-only now: a checkout that still has files
 *  here gets them moved on first touch rather than stranded. */
export const LEGACY_EDITOR_DATA_ROOT = 'zig-out/game/editor';

let migrated = false;

/** Move any surviving legacy data into the new root, once per process.
 *
 *  Copy-then-verify, never move-then-hope: each file is written to its new home and read
 *  back before the old one is dropped. A migration that loses the data it is rescuing
 *  would repeat the exact failure this module exists to prevent, so when anything cannot
 *  be verified the legacy copy is LEFT IN PLACE and the mismatch is reported. */
export function migrateLegacyEditorData(): { moved: number; kept: number } | null {
  if (migrated) return null;
  migrated = true;
  if (!exists(LEGACY_EDITOR_DATA_ROOT)) return null;
  ensureEditorDataDir('');
  let moved = 0;
  let kept = 0;
  const walk = (relative: string) => {
    const from = relative ? `${LEGACY_EDITOR_DATA_ROOT}/${relative}` : LEGACY_EDITOR_DATA_ROOT;
    for (const entry of listDir(from)) {
      const child = relative ? `${relative}/${entry}` : entry;
      const source = `${LEGACY_EDITOR_DATA_ROOT}/${child}`;
      const target = `${EDITOR_DATA_ROOT}/${child}`;
      const contents = readFile(source);
      if (contents === null) {
        // A directory (or an unreadable file). Recurse; unreadable leaves count as kept.
        if (listDir(source).length > 0) {
          ensureEditorDataDir(child);
          walk(child);
        } else kept += 1;
        continue;
      }
      if (exists(target)) { kept += 1; continue; } // never clobber newer data
      ensureEditorDataDir(child.includes('/') ? child.slice(0, child.lastIndexOf('/')) : '');
      if (writeFile(target, contents) && readFile(target) === contents) moved += 1;
      else kept += 1;
    }
  };
  walk('');
  if (kept > 0) {
    console.warn(`[editor-data] moved ${moved} file(s) to ${EDITOR_DATA_ROOT}; ${kept} left in ${LEGACY_EDITOR_DATA_ROOT} because they could not be verified at the new home — nothing was deleted`);
  }
  return { moved, kept };
}

/** Resolve a path under the authored-data root, creating the directories on the way. */
export function editorDataPath(relative: string): string {
  ensureEditorDataDir(relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '');
  return relative ? `${EDITOR_DATA_ROOT}/${relative}` : EDITOR_DATA_ROOT;
}

export function ensureEditorDataDir(relative: string): void {
  const parts = [USER_DATA_ROOT, 'editor', ...(relative ? relative.split('/') : [])].filter(Boolean);
  let path = '';
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    if (!exists(path)) mkdir(path);
  }
}
