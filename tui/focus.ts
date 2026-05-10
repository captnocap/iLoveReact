// tui/focus.ts — keyboard focus manager for the TUI backend.
//
// Walks getRootInstances() each tick, builds a flat list of focusable
// nodes (Pressable + anything with tabIndex >= 0), and traps Tab /
// Shift-Tab / Enter / Escape via host.addKeyInterceptor.
//
// Focus state is held by id, not by Instance reference, because the
// reconciler can rebuild Instance objects across renders. Looking up
// by id every keypress is O(N) over the focusable list — fine for
// terminal-scale UIs.

import type { Instance, TextInstance } from '../renderer/hostConfig';
import { getRootInstances } from '../renderer/hostConfig';
import { addKeyInterceptor, dispatchTo, setFocusedId, getFocusedId, requestPaint } from './host';

function isInstance(n: Instance | TextInstance): n is Instance {
  return !!n && 'children' in n;
}

function isFocusable(n: Instance): boolean {
  if (n.type === 'Pressable') return true;
  if (n.type === 'TextInput' || n.type === 'TextArea' || n.type === 'TextEditor') return true;
  const ti = (n.props as any)?.tabIndex;
  return typeof ti === 'number' && ti >= 0;
}

function collectFocusable(): number[] {
  const out: number[] = [];
  const walk = (n: Instance): void => {
    if (isFocusable(n)) out.push(n.id);
    for (const c of n.children) {
      if (isInstance(c)) walk(c);
    }
  };
  for (const r of getRootInstances()) walk(r);
  return out;
}

function moveFocus(delta: 1 | -1): void {
  const list = collectFocusable();
  if (list.length === 0) { setFocusedId(-1); return; }
  const cur = getFocusedId();
  const idx = list.indexOf(cur);
  let next: number;
  if (idx === -1) {
    next = delta > 0 ? list[0] : list[list.length - 1];
  } else {
    next = list[(idx + delta + list.length) % list.length];
  }
  setFocusedId(next);
}

export function installFocusManager(): () => void {
  // Auto-focus the first focusable on first tree appearance. Resolved
  // lazily — focus() runs on first key event, since the cart hasn't
  // committed yet at install time.
  const ensureFocused = (): void => {
    if (getFocusedId() !== -1) return;
    const list = collectFocusable();
    if (list.length > 0) setFocusedId(list[0]);
  };

  const off = addKeyInterceptor((key: string) => {
    // Tab / Shift-Tab — focus traversal.
    if (key === '\t') { ensureFocused(); moveFocus(1); return true; }
    if (key === '\x1b[Z') { ensureFocused(); moveFocus(-1); return true; }

    // Enter on Pressable — fire onPress (alias onClick).
    if (key === '\r' || key === '\n') {
      const id = getFocusedId();
      if (id !== -1) {
        const fired = dispatchTo(id, ['onPress', 'onClick'], {});
        if (fired) { requestPaint(); return true; }
      }
    }

    // Escape — clear focus (lets app-level handlers see it).
    if (key === '\x1b') {
      if (getFocusedId() !== -1) { setFocusedId(-1); return false; }
    }

    return false;
  });

  // Refresh focus once after install in case the tree is already mounted.
  queueMicrotask(ensureFocused);

  return off;
}
