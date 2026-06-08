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

/** the live authoring data umbrella (manifest.json + per-domain store.db files, gitignored) */
export const EDITOR_DATA_ROOT = 'cart/hmsc-int/data';

let store: Store | null = null;

export function editorStore(): Store {
  if (!store) store = openWorkspaceStore(EDITOR_DATA_ROOT);
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
