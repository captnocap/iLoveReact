// editors/useEditorControls.ts — the React dispatcher for the editor control
// contract (EDITORCTL-0610). The TABLE and its resolution logic live in
// editors/controls.ts (data only, headless-testable); this file is the thin
// React shell: one bus subscription per consuming surface, live-ref handlers,
// the typing gate applied at dispatch.

import { useEffect, useRef } from 'react';
import { busOn } from '@reactjit/hooks/useIFTTT';
import {
  editorTypingFocused, resolveEditorKey,
  type EditorKeyEvent, type EditorScope,
} from './controls';

export type EditorControlHandlers = Record<string, (ev: { phase: 'down' | 'up'; key: string; event: EditorKeyEvent }) => void>;

/**
 * The one dispatcher. A surface declares its scope, whether it is active
 * (the focus arbiter's word — an unfocused pane consumes nothing), and a
 * handler per action id. Press actions take phase 'down'; held-movement
 * actions take both phases and keep their own held-set.
 *
 * `bypassTypingGate` is the rare surface override (the canvas pan lock makes
 * WASD pan while a text field is focused — that is its whole point).
 */
export function useEditorControls(
  scope: EditorScope,
  opts: {
    active: boolean;
    handlers: EditorControlHandlers;
    bypassTypingGate?: () => boolean;
  },
): void {
  // Live refs so the once-mounted listeners always see the current handlers
  // and activation — the established keyActionsRef idiom, owned here once.
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    const dispatch = (phase: 'down' | 'up') => (event: EditorKeyEvent) => {
      const { active, handlers, bypassTypingGate } = ref.current;
      if (!active) return;
      const typing = bypassTypingGate?.() ? false : editorTypingFocused();
      const binding = resolveEditorKey(scope, phase, event, typing);
      if (!binding) return;
      handlers[binding.action]?.({ phase, key: String(event?.key ?? '').toLowerCase(), event });
    };
    const offDown = busOn('__keydown', dispatch('down'));
    const offUp = busOn('__keyup', dispatch('up'));
    return () => { offDown(); offUp(); };
  }, [scope]);
}

/** Held-modifier tracking off the key bus (mouse events carry no modifier
 *  flags in this host). Was hand-copied in PaintCanvas AND IsoAuthor — the
 *  rule of two says it lives here. Read `.current` at click time. */
export function useHeldModifiers(): { current: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } } {
  const held = useRef({ ctrl: false, alt: false, shift: false, meta: false });
  useEffect(() => {
    const upd = (e: EditorKeyEvent) => {
      held.current = {
        ctrl: !!e?.ctrlKey || !!e?.metaKey,
        alt: !!e?.altKey,
        shift: !!e?.shiftKey,
        meta: !!e?.metaKey,
      };
    };
    const offD = busOn('__keydown', upd);
    const offU = busOn('__keyup', upd);
    return () => { offD(); offU(); };
  }, []);
  return held;
}
