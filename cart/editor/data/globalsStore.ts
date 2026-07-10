// editor/data/globalsStore.ts — on-disk persistence for GAME-WIDE globals
// (GLOBALS req_2770), intentionally outside named map documents:
//
//   zig-out/game/editor/maps/<stem>/...     — per-map painting + placements
//   zig-out/game/editor/world-globals.json  — shared physics/player tunables
//
// Per-concern files, never one blob (V20). Saves are DEBOUNCED micro-saves,
// exactly the worldStore contract: every worldGlobals change schedules a write,
// no Save button to forget — "find a value, lock it in" IS the micro-save.
// Loads happen once at boot (persistView.loadPersistedState).
import { mkdir, readFile, writeFile } from '../../../runtime/hooks/fs';
import { defaultWorldGlobals, revivePhysicsGlobals, type WorldGlobals } from './globals';

const GLOBALS_SAVE_DIR = 'zig-out/game/editor';
export const GLOBALS_SAVE_FILE = `${GLOBALS_SAVE_DIR}/world-globals.json`;

export type GlobalsSave = {
  version: 1;
  physics: WorldGlobals['physics'];
};

/** Read the globals save. Null = no file yet (fresh world = game defaults) or
 *  unreadable — a malformed file is reported LOUD and left untouched. */
export function loadGlobalsSave(): WorldGlobals | null {
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

const SAVE_SETTLE_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: GlobalsSave | null = null;
let dirReady = false;

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (!save) return;
  if (!dirReady) {
    mkdir(GLOBALS_SAVE_DIR);
    dirReady = true;
  }
  if (!writeFile(GLOBALS_SAVE_FILE, JSON.stringify(save))) {
    console.error(`[globals-store] SAVE FAILED: ${GLOBALS_SAVE_FILE} — tuned globals will NOT survive a restart`);
  }
}

/** Schedule a micro-save of the world globals (debounced). AppFrame calls this
 *  on every worldGlobals change. */
export function scheduleGlobalsSave(globals: WorldGlobals): void {
  queued = { version: 1, physics: { ...globals.physics } };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, SAVE_SETTLE_MS);
}
