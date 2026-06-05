// editors/store.ts — the tool's ONE data store (V20).
//
// Every editor concern registers its stream HERE, on the same Store instance,
// because the global sequence number (the total cross-session undo chain) has
// exactly one authority per process: two independent openStore() instances
// would each resume their own counter from only the streams THEY registered,
// and seq numbers would collide across concerns. One instance, one chain.
//
// Editor routes call editorStore() and defineStream their concern once at
// module level (cache the handle — defineStream throws on re-registration).
// Tests NEVER use this: they open scratch roots under zig-out/ directly.

import { openStore, type Store, type StreamDef, type StreamHandle } from '../data';

/** the live authoring data root (data/streams + data/snapshots, gitignored) */
export const EDITOR_DATA_ROOT = 'cart/hmsc-int/data';

let store: Store | null = null;

export function editorStore(): Store {
  if (!store) store = openStore(EDITOR_DATA_ROOT);
  return store;
}

// Route surfaces mount and unmount (and hot reloads remount them), but a
// stream registers ONCE per store. editorChannel is the route-safe door: the
// first call defines the stream on the one live store, every later call
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
