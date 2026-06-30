// editor/data/journalStore.ts — durable persistence for build-journal bug
// threads, plus the (temporary) shelf of attachable diagnostic captures.
//
// Threads survive across editor sessions by round-tripping through a single JSON
// file that sits beside the request ledger. The journal's NOTES always re-derive
// from the req_*.json files; only the THREAD links + captures are persisted here.
//
// ADAPTER NOTE: persistence rides the fs door (framework/fs.zig) because there is
// no host-owned build-journal store yet. The future owner is the request-ledger /
// eventbus host (DESIGN_INTAKE → "Eventbus Direction"); this file is the shim
// that keeps the capability real until that exists.
import { readFile, writeFile } from '../../../runtime/hooks/fs';
import type { JournalThreadState, LogCapture } from '../../../runtime/buildjournal';

const THREAD_STORE_PATH = 'docs/game/_requests/_threads.json';

const EMPTY_STATE: JournalThreadState = { seq: 0, threads: [], captures: [] };

/** Read persisted thread state from disk. Returns an empty state when the file
 *  is missing or unparseable so a first run, or a corrupt file, never throws. */
export function loadThreadState(): JournalThreadState {
  const raw = readFile(THREAD_STORE_PATH);
  if (!raw) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<JournalThreadState>;
    return {
      seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      captures: Array.isArray(parsed.captures) ? parsed.captures : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Persist thread state to disk. Returns true on success. */
export function saveThreadState(state: JournalThreadState): boolean {
  return writeFile(THREAD_STORE_PATH, JSON.stringify(state, null, 2));
}

export { THREAD_STORE_PATH };

// SHIM: until the in-app raw console can mint captures from the live diagnostics
// feed (DESIGN_INTAKE → "Diagnostics Registry And Raw Console"), this shelf
// stands in as the pool of attachable captures so the thread capture-attach
// surface is exercisable against the real journal API. Future owner: the raw
// console capture flow. Replace this constant, not the attach plumbing.
export const CAPTURE_SHELF: LogCapture[] = [
  {
    id: 'cap_gpu_cliff',
    name: 'gpu cliff 4fps',
    channels: ['gpu.bindgroup', 'render.frame'],
    timeRange: { start: 0, end: 0 },
    buildId: '1.0.0.2118',
    mapContext: 'city_block_04',
    note: 'bind-group count spikes once the map gets dense',
  },
  {
    id: 'cap_place_latency',
    name: 'rich map place lag',
    channels: ['edit.place', 'authoring.cost'],
    timeRange: { start: 0, end: 0 },
    buildId: '1.0.0.2112',
    mapContext: 'motel_prefab',
    note: 'p95 edit time climbs with city size',
  },
  {
    id: 'cap_idle_memory',
    name: 'idle memory climb',
    channels: ['memory.rss', 'render.rebake'],
    timeRange: { start: 0, end: 0 },
    buildId: '1.0.0.2228',
    mapContext: 'traffic_layers',
    note: 'resident memory grows while the editor sits idle',
  },
];
