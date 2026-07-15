// runtime/hooks/useModifiers.ts — live keyboard modifier state + key-edge
// subscription, for any tool that needs chords (the paint kit's shift-line,
// [/] size stepping, tool hotkeys). Modifier state is global, so it lives in
// one module-level record the key bridge mutates in place; handlers read it
// without triggering React re-renders.
//
// The engine pumps globalThis.__ifttt_onKeyDown(packed) / __ifttt_onKeyUp on
// every SDL key event regardless of focus. useIFTTT, when present, decodes
// that and re-emits on the ffi bus. We don't depend on useIFTTT being loaded:
// if no global handler is installed yet we install a minimal one that emits to
// the SAME bus channels — whichever module installs last wins, both emit to
// __keydown/__keyup, so a single handler is always active and subscribers work
// either way.

import { useEffect } from 'react';
import { subscribe, emit } from '../ffi';
import { decodeSdlModifiers } from '../input/sdlModifiers';

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

const SDL_KEY_NAMES: Record<number, string> = {
  0x0d: 'enter', 0x1b: 'escape', 0x08: 'backspace', 0x09: 'tab', 0x20: 'space',
  0x7f: 'delete',
  0x40000050: 'left', 0x4000004f: 'right', 0x40000052: 'up', 0x40000051: 'down',
};

function decodeKey(packed: number): { key: string; mods: Modifiers } {
  const sym = packed % 0x100000000;
  const mod = Math.floor(packed / 0x100000000);
  let key = SDL_KEY_NAMES[sym];
  if (!key) {
    if (sym >= 0x20 && sym < 0x7f) key = String.fromCharCode(sym).toLowerCase();
    else key = `sdl:${sym}`;
  }
  const { shiftKey: shift, ctrlKey: ctrl, altKey: alt, metaKey: meta } = decodeSdlModifiers(mod);
  return { key, mods: { shift, ctrl, alt, meta } };
}

// ── The global live state + bridge ───────────────────────────────────────────

const g_mods: Modifiers = { shift: false, alt: false, ctrl: false, meta: false };

function setMods(m: Modifiers) {
  g_mods.shift = m.shift;
  g_mods.alt = m.alt;
  g_mods.ctrl = m.ctrl;
  g_mods.meta = m.meta;
}

function ensureBridge() {
  const G = globalThis as any;
  if (typeof G.__ifttt_onKeyDown !== 'function') {
    G.__ifttt_onKeyDown = (packed: number) => emit('__keydown', decodeKey(packed));
  }
  if (typeof G.__ifttt_onKeyUp !== 'function') {
    G.__ifttt_onKeyUp = (packed: number) => emit('__keyup', decodeKey(packed));
  }
  if (G.__paint_mods_tracking) return;
  G.__paint_mods_tracking = true;
  // Keep g_mods live off the bus (works whether the bridge above or useIFTTT's
  // is the active handler — both emit decoded events to these channels).
  subscribe('__keydown', (e: any) => { if (e?.mods) setMods(e.mods); });
  subscribe('__keyup', (e: any) => { if (e?.mods) setMods(e.mods); });
}

ensureBridge();

export interface UseModifiers {
  /** Live modifier record, mutated in place — read it inside event handlers;
   *  it never causes a re-render. */
  mods: Modifiers;
  /** Subscribe to key-DOWN edges. Returns an unsubscribe. */
  onKeyDown: (fn: (key: string, mods: Modifiers) => void) => () => void;
  /** Subscribe to key-UP edges. */
  onKeyUp: (fn: (key: string, mods: Modifiers) => void) => () => void;
}

/** Access live modifier state + key edges. Pass a `keys` map of
 *  `key → handler` to bind hotkeys declaratively (cleaned up on unmount). */
export function useModifiers(keys?: Record<string, (mods: Modifiers) => void>): UseModifiers {
  useEffect(() => {
    if (!keys) return;
    const off = subscribe('__keydown', (e: any) => {
      const fn = keys[e?.key];
      if (fn) fn(e.mods ?? g_mods);
    });
    return off;
  }, [keys]);

  return {
    mods: g_mods,
    onKeyDown: (fn) => subscribe('__keydown', (e: any) => fn(e?.key, e?.mods ?? g_mods)),
    onKeyUp: (fn) => subscribe('__keyup', (e: any) => fn(e?.key, e?.mods ?? g_mods)),
  };
}

/** Read live modifier state without the hook (for non-component call sites). */
export function currentModifiers(): Modifiers {
  return g_mods;
}
