/**
 * clipboard — system clipboard access.
 *
 * These globals are already registered by framework/qjs_runtime.zig (see
 * hostClipboardSet / hostClipboardGet), so this module is live today without
 * any Zig-side additions.
 *
 * ── DSL surface (self-registered) ─────────────────────────────────
 *
 * Importing this module also registers:
 *   - `clipboard:` action verb — `'clipboard:<text>'` copies <text>
 *     (literal or after `$payload` substitution) to the system clipboard.
 *   - `system:clipboard` bus channel — emitted by the engine on every
 *     clipboard change; payload is the new text.
 *
 * useIFTTT side-effect imports this module so carts get the surface
 * without manually pulling clipboard.ts. Pattern parallels
 * process/useFileWatch/system_selection/ifttt-*; the previous version
 * had useIFTTT.ts wiring these up *for* clipboard, which was the only
 * outlier in the codebase (clipboard was one of the first capabilities,
 * predating the registry pattern).
 */

import { callHost, emit } from '../ffi';
import { G } from '../host-globals';
import { registerIfttAction } from './ifttt/registry';

declare module '../host-globals' {
  interface HostGlobals {
    __ifttt_onClipboardChange?(): void;
  }
}

/** Read the system clipboard as a UTF-8 string. */
export function get(): string {
  return callHost<string>('__clipboard_get', '');
}

/** Write a UTF-8 string to the system clipboard. */
export function set(value: string): void {
  callHost<void>('__clipboard_set', undefined as any, value);
}

/**
 * Currently highlighted text — exactly what Ctrl+C would copy right now.
 * Returns "" when nothing is selected. Use this to gate "Copy" menu items.
 *
 * Resolution order (matches the engine):
 *   focused TextInput with a selection range → that input's slice
 *   tree-text selection (any <Text>/etc)     → the walked text
 *   neither                                  → ""
 */
export function getSelection(): string {
  return callHost<string>('__selection_get', '');
}

// ── IFTTT registration ─────────────────────────────────────────────
//
// `clipboard:<text>` — copy <text> to the system clipboard. Composable
// with $payload substitution (handled by useIFTTT.runStringAction before
// this runner sees the string).
registerIfttAction('clipboard:', (rest, _payload) => {
  try { set(rest); } catch (e: any) {
    console.error('[clipboard] set failed:', e?.message || e);
  }
});

// `system:clipboard` bus event — fired by the Zig host on every clipboard
// change. Idempotent install: a second module-load (test envs, hot reload)
// doesn't double-wire.
if (!G.__ifttt_onClipboardChange) {
  G.__ifttt_onClipboardChange = () => {
    let text = '';
    try { text = get(); } catch { /* ignore */ }
    emit('system:clipboard', text);
  };
}
