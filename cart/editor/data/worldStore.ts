// editor/data/worldStore.ts — on-disk persistence for the WORLD document's
// authored edits (SESSIONSAVE req_2765).
//
// Placed build pieces lived only in EditorState (hot-state mirrors survive a
// reload but die on a cold restart), so a session's building wiped on relaunch.
// This is the pieces' save file, beside the painted map it belongs with:
//
//   zig-out/game/editor/painted-map.rmap   — the painting (host-side RMAP,
//                                            micro-saved via __map_set_autosave_file)
//   zig-out/game/editor/world-pieces.json  — placed pieces + zone defs + id seq
//                                            (this file; micro-saved from AppFrame)
//
// Per-concern files, never one blob (V20): the painting and the pieces are
// separate concerns with separate formats; each stream evolves by addition.
// Saves are DEBOUNCED micro-saves — every worldPieces/zones change schedules a
// write, so there is no Save button to forget. Loads happen once at boot
// (persistView.loadPersistedState) and materialize straight into EditorState.
import { mkdir, readFile, writeFile } from '../../../runtime/hooks/fs';
import type { PlacedPiece } from '../world/pieces';
import type { MapZoneDef } from '../stage/mapPaint';

const WORLD_SAVE_DIR = 'zig-out/game/editor';
export const WORLD_SAVE_FILE = `${WORLD_SAVE_DIR}/world-pieces.json`;

export type WorldSave = {
  version: 1;
  /** EditorState.seq at save time — restored so re-minted ids (bp_N/obj-N) never collide with loaded ones. */
  seq: number;
  pieces: PlacedPiece[];
  /** zone DEFINITIONS (id/name/color) — the painted zone cells live in the RMAP; the legend lives here. */
  zones: MapZoneDef[];
};

/** Read the world save. Null = no file yet (fresh world) or unreadable —
 *  callers fall back to an empty world; a malformed file is reported LOUD. */
export function loadWorldSave(): WorldSave | null {
  const text = readFile(WORLD_SAVE_FILE);
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<WorldSave>;
    if (raw.version !== 1 || !Array.isArray(raw.pieces)) throw new Error(`unrecognized shape (version ${raw.version})`);
    return {
      version: 1,
      seq: typeof raw.seq === 'number' && raw.seq > 0 ? raw.seq : 1,
      pieces: raw.pieces.filter((p) => p && typeof p.id === 'string' && typeof p.pieceId === 'string'),
      zones: Array.isArray(raw.zones) ? raw.zones.filter((z) => z && typeof z.id === 'string') : [],
    };
  } catch (err) {
    console.error(`[world-store] ${WORLD_SAVE_FILE} is malformed — booting an empty world, the file stays untouched until the next edit: ${err}`);
    return null;
  }
}

// Debounced micro-save: state changes at interaction rate (a drag-run of walls
// is one placement batch), so a short settle window folds a burst into one
// write. The LAST scheduled snapshot wins — pieces arrays are immutable.
const SAVE_SETTLE_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: WorldSave | null = null;
let dirReady = false;

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (!save) return;
  if (!dirReady) {
    mkdir(WORLD_SAVE_DIR);
    dirReady = true;
  }
  if (!writeFile(WORLD_SAVE_FILE, JSON.stringify(save))) {
    console.error(`[world-store] SAVE FAILED: ${WORLD_SAVE_FILE} — placed pieces will NOT survive a restart`);
  }
}

/** Schedule a micro-save of the world's authored edits (debounced). AppFrame
 *  calls this on every worldPieces/zones change — including undo/redo. */
export function scheduleWorldSave(pieces: readonly PlacedPiece[], zones: readonly MapZoneDef[], seq: number): void {
  queued = { version: 1, seq, pieces: pieces as PlacedPiece[], zones: zones as MapZoneDef[] };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, SAVE_SETTLE_MS);
}
