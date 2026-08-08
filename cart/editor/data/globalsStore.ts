// editor/data/globalsStore.ts — on-disk persistence for GAME-WIDE globals
// (GLOBALS req_2770), intentionally outside named map documents:
//
//   userdata/editor/maps/<stem>/...     — per-map painting + placements
//   userdata/editor/world-globals.json  — shared physics/player tunables
//
// Per-concern files, never one blob (V20). With autosave enabled, changes use
// the same debounced writer as worldStore. Explicit Save always remains valid;
// disabling autosave cancels only the pending background write.
// Loads happen once at boot (persistView.loadPersistedState).
import { mkdir, readFile, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { EDITOR_DATA_ROOT, migrateLegacyEditorData } from './editorDataRoot';
import { textBytes } from '../../../runtime/workspace/lumps';
import { defaultWorldGlobals, revivePhysicsGlobals, type WorldGlobals } from './globals';

const GLOBALS_SAVE_DIR = EDITOR_DATA_ROOT;
export const GLOBALS_SAVE_FILE = `${GLOBALS_SAVE_DIR}/world-globals.json`;

export type GlobalsSave = {
  version: 1;
  physics: WorldGlobals['physics'];
};

/** Read the globals save. Null = no file yet (fresh world = game defaults) or
 *  unreadable — a malformed file is reported LOUD and left untouched. */
export function loadGlobalsSave(): WorldGlobals | null {
  migrateLegacyEditorData();
  const text = readFile(GLOBALS_SAVE_FILE);
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<GlobalsSave>;
    if (raw.version !== 1) throw new Error(`unrecognized shape (version ${raw.version})`);
    return { ...defaultWorldGlobals(), physics: revivePhysicsGlobals(raw.physics) };
  } catch (err) {
    console.error(`[globals-store] ${GLOBALS_SAVE_FILE} is malformed — booting the game defaults, the file stays untouched until the next edit: ${err}`);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: GlobalsSave | null = null;
let dirReady = false;

function writeSave(save: GlobalsSave): boolean {
  if (!dirReady) {
    mkdir(GLOBALS_SAVE_DIR);
    dirReady = true;
  }
  const text = JSON.stringify(save);
  const ok = writeFileBytesAtomic(GLOBALS_SAVE_FILE, textBytes(text)) || writeFile(GLOBALS_SAVE_FILE, text);
  if (!ok) {
    console.error(`[globals-store] SAVE FAILED: ${GLOBALS_SAVE_FILE} — tuned globals will NOT survive a restart`);
  }
  return ok;
}

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (save) writeSave(save);
}

/** Schedule a micro-save of the world globals (debounced). AppFrame calls this
 *  on every worldGlobals change. */
export function scheduleGlobalsSave(
  globals: WorldGlobals,
  options: { enabled?: boolean; delayMs?: number } = {},
): void {
  if (options.enabled === false) {
    cancelGlobalsSave();
    return;
  }
  queued = { version: 1, physics: { ...globals.physics } };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, Math.max(0, options.delayMs ?? 400));
}

export function cancelGlobalsSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  queued = null;
}

export function saveGlobalsNow(globals: WorldGlobals): boolean {
  cancelGlobalsSave();
  return writeSave({ version: 1, physics: { ...globals.physics } });
}
