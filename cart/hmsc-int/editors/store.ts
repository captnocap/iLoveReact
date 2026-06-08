// editors/store.ts — the tool's umbrella data store.
//
// Every editor concern registers its stream HERE, through the same workspace
// facade, and the data layer routes each stream to its own domain DB under the
// umbrella manifest. One workspace, separate files: world corruption cannot
// take items/characters/voxels with it.
//
// Editor routes call editorStore() and defineStream their concern once at
// module level (cache the handle — defineStream throws on re-registration).
// Tests NEVER use this: they open scratch roots under zig-out/ directly.

import { openWorkspaceStore, type Store, type StreamDef, type StreamHandle } from '../data';
import { GAME_TELEMETRY } from '../game/telemetry';
import { readRouteTwigState } from './twigs';

function envString(name: string): string | null {
  try {
    const fn = (globalThis as any).__env_get;
    const value = typeof fn === 'function' ? fn(name) : null;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/** the live authoring data umbrella (manifest.json + per-domain store.db files, gitignored) */
export const EDITOR_DATA_ROOT = envString('HMSC_INT_DATA_ROOT') ?? 'cart/hmsc-int/data';

let store: Store | null = null;
const gStorelagProbe: any = globalThis;

function armStorelagProbe(): void {
  const enabled =
    readRouteTwigState('/', 'storelagProbe', false) === true ||
    readRouteTwigState('/workbench', 'storelagProbe', false) === true ||
    readRouteTwigState('/characters', 'storelagProbe', false) === true ||
    readRouteTwigState('/cutout', 'storelagProbe', false) === true;
  if (!enabled || gStorelagProbe.__hmsc_storelag_probe_armed) return;
  gStorelagProbe.__hmsc_storelag_probe_armed = true;
  GAME_TELEMETRY.clearDiagnostics();
  GAME_TELEMETRY.setDiagnosticChannel('worldStream', true);
  GAME_TELEMETRY.setDiagnosticChannel('churn', true);
  GAME_TELEMETRY.recordDiagnostic('worldStream', 'storelag.probe.armed', { rootDir: EDITOR_DATA_ROOT });
  const timer = (globalThis as any).setTimeout;
  if (typeof timer === 'function') {
    timer(() => {
      GAME_TELEMETRY.diagnosticDump('storelag-load');
      GAME_TELEMETRY.setDiagnosticChannel('worldStream', false);
      GAME_TELEMETRY.setDiagnosticChannel('churn', false);
    }, 3000);
  }
}

export function editorStore(): Store {
  if (!store) {
    armStorelagProbe();
    store = openWorkspaceStore(EDITOR_DATA_ROOT);
  }
  return store;
}

// Route surfaces mount and unmount (and hot reloads remount them), but a
// stream registers ONCE per store. editorChannel is the route-safe door: the
// first call defines the stream on the live workspace, every later call
// (same name) returns the cached handle. Route code only — tests register
// their streams on a scratch openStore() directly.
const channels = new Map<string, StreamHandle<any, any>>();

export function editorChannel<State, Event>(def: StreamDef<State, Event>): StreamHandle<State, Event> {
  const cached = channels.get(def.name);
  if (cached) return cached as StreamHandle<State, Event>;
  const handle = editorStore().defineStream(def);
  channels.set(def.name, handle);
  return handle;
}
