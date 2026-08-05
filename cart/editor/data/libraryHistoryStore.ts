// editor/data/libraryHistoryStore.ts — durable mixed Asset Explorer history.
//
//   zig-out/game/editor/asset-library-history.json
//
// Recent is user history, not transient chrome: it survives a cold editor
// restart. Keep it in its own per-concern file rather than making the whole
// hot-reload view durable.
import { mkdir, readFile, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { textBytes } from '../../../runtime/workspace/lumps';
import { normalizeRecentLibraryKeys } from './libraryCollections';

const LIBRARY_HISTORY_DIR = 'zig-out/game/editor';
export const LIBRARY_HISTORY_FILE = `${LIBRARY_HISTORY_DIR}/asset-library-history.json`;

export type LibraryHistorySave = {
  version: 1;
  recentKeys: string[];
};

export function parseLibraryHistoryText(text: string): string[] {
  const raw = JSON.parse(text) as Partial<LibraryHistorySave>;
  if (raw.version !== 1) throw new Error(`unrecognized shape (version ${raw.version})`);
  if (!Array.isArray(raw.recentKeys)) throw new Error('recentKeys must be an array');
  return normalizeRecentLibraryKeys(raw.recentKeys);
}

/** Null means fresh install or an unreadable save. Malformed input is reported
 *  and ignored so startup remains available. */
export function loadLibraryHistory(): string[] | null {
  const text = readFile(LIBRARY_HISTORY_FILE);
  if (!text) return null;
  try {
    return parseLibraryHistoryText(text);
  } catch (error) {
    console.error(`[asset-library-history] ${LIBRARY_HISTORY_FILE} is malformed — booting with empty Recent: ${error}`);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: LibraryHistorySave | null = null;
let dirReady = false;

function writeSave(save: LibraryHistorySave): boolean {
  if (!dirReady) {
    mkdir(LIBRARY_HISTORY_DIR);
    dirReady = true;
  }
  const text = JSON.stringify(save);
  const ok = writeFileBytesAtomic(LIBRARY_HISTORY_FILE, textBytes(text))
    || writeFile(LIBRARY_HISTORY_FILE, text);
  if (!ok) {
    console.error(`[asset-library-history] SAVE FAILED: ${LIBRARY_HISTORY_FILE} — Recent will NOT survive a restart`);
  }
  return ok;
}

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (save) writeSave(save);
}

/** Debounced micro-save; AppFrame calls this whenever mixed history changes. */
export function scheduleLibraryHistorySave(recentKeys: readonly string[], delayMs = 400): void {
  queued = { version: 1, recentKeys: normalizeRecentLibraryKeys(recentKeys) };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, Math.max(0, delayMs));
}
