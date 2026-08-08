// editor/data/colorLibraryStore.ts — on-disk persistence for the color library
// (req_3097: "the saved key is literally fake" — saves evaporated on a cold
// restart, and used-but-unsaved colors were simply lost).
//
//   zig-out/game/editor/color-library.json — SAVED tray + RECENT use-history
//
// Same per-concern-file contract as globalsStore (V20: never one blob): loads
// once at boot (persistView.loadPersistedState), debounced micro-save on every
// palette/recents change. Colors are stored as OKLCH triples — the spine's own
// working space — so a round-trip never quantizes through hex.
import { mkdir, readFile, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { EDITOR_DATA_ROOT } from './editorDataRoot';
import { textBytes } from '../../../runtime/workspace/lumps';
import type { OklchColor } from '../../../runtime/paint/colors';

const COLOR_LIBRARY_DIR = EDITOR_DATA_ROOT;
export const COLOR_LIBRARY_FILE = `${COLOR_LIBRARY_DIR}/color-library.json`;

export type ColorLibrarySave = {
  version: 1;
  saved: OklchColor[];
  recents: OklchColor[];
};

function reviveColors(raw: unknown): OklchColor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is OklchColor =>
      !!c && typeof c === 'object'
      && Number.isFinite((c as OklchColor).l)
      && Number.isFinite((c as OklchColor).c)
      && Number.isFinite((c as OklchColor).h))
    .map((c) => ({ l: c.l, c: c.c, h: c.h }));
}

/** Read the color library. Null = no file yet (fresh install = empty tray) or
 *  unreadable — a malformed file is reported LOUD and left untouched. */
export function loadColorLibrary(): { saved: OklchColor[]; recents: OklchColor[] } | null {
  const text = readFile(COLOR_LIBRARY_FILE);
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<ColorLibrarySave>;
    if (raw.version !== 1) throw new Error(`unrecognized shape (version ${raw.version})`);
    return { saved: reviveColors(raw.saved), recents: reviveColors(raw.recents) };
  } catch (err) {
    console.error(`[color-library] ${COLOR_LIBRARY_FILE} is malformed — booting an empty library, the file stays untouched until the next save: ${err}`);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: ColorLibrarySave | null = null;
let dirReady = false;

function writeSave(save: ColorLibrarySave): boolean {
  if (!dirReady) {
    mkdir(COLOR_LIBRARY_DIR);
    dirReady = true;
  }
  const text = JSON.stringify(save);
  const ok = writeFileBytesAtomic(COLOR_LIBRARY_FILE, textBytes(text)) || writeFile(COLOR_LIBRARY_FILE, text);
  if (!ok) {
    console.error(`[color-library] SAVE FAILED: ${COLOR_LIBRARY_FILE} — saved colors will NOT survive a restart`);
  }
  return ok;
}

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (save) writeSave(save);
}

/** Schedule a micro-save of the color library (debounced). AppFrame calls this
 *  on every colorSpinePalette / colorSpineRecents change. */
export function scheduleColorLibrarySave(saved: OklchColor[], recents: OklchColor[], delayMs = 400): void {
  queued = {
    version: 1,
    saved: saved.map((c) => ({ ...c })),
    recents: recents.map((c) => ({ ...c })),
  };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, Math.max(0, delayMs));
}
