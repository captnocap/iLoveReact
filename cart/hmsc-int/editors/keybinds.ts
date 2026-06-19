// editors/keybinds.ts — localstore persistence for the editor keymap overrides
// (req_1433). Deliberately separate from controls.ts so that file stays
// import-pure and headless-testable; this is the thin I/O shell over it.
//
// The overrides are ONE shared map across every editor scope (canvas / iso-build
// / bench / studio), stored under a single localstore key. loadKeybinds() runs
// once at editor boot to hydrate controls' override map; rebind()/resetBind()
// mutate it and write straight back, so a rebinding survives a reload.

import * as localstore from '@reactjit/hooks/localstore';
import {
  loadUserBindings, exportUserBindings, setUserBinding, clearUserBinding,
  type EditorScope, type RebindResult,
} from './controls';

const KEY = 'editor:keybinds';

/** Hydrate controls' override map from localstore. Call once at boot. */
export function loadKeybinds(): void {
  loadUserBindings(localstore.getJson<Record<string, string[]>>(KEY, {}));
}

function persist(): void {
  localstore.setJson(KEY, exportUserBindings());
}

/** Rebind one action and persist if it took (a conflict leaves it unchanged). */
export function rebind(scope: EditorScope, action: string, keys: string[]): RebindResult {
  const r = setUserBinding(scope, action, keys);
  if (r.ok) persist();
  return r;
}

/** Drop the override for one action (back to its default) and persist. */
export function resetBind(scope: EditorScope, action: string): void {
  clearUserBinding(scope, action);
  persist();
}
