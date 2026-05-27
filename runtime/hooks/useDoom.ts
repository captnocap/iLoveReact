/**
 * useDoom — vendored id Software Doom (via ozkl's doomgeneric port) as a
 * one-line hook. Importing this file flips the source-driven build gate
 * (-Dhas-doom=true) so the engine ships with the cart.
 *
 * ── What you get back ────────────────────────────────────────────────────
 *   ready          true after init resolved (false until WAD is found)
 *   framebuffer    Uint32Array of length 640×400 (BGRA pixels, 0xAARRGGBB
 *                  little-endian). Same backing memory across frames —
 *                  doomgeneric overwrites in place. Bumped frame counter
 *                  triggers re-render; consumers read the live buffer.
 *   frame          monotonic counter, increments each successful tick.
 *                  Use as a render trigger (it forces re-render even
 *                  though framebuffer's identity is stable).
 *   sendKey(code, pressed)
 *                  push a doom key event. Codes are the doomkeys.h values
 *                  (also re-exported as DK below).
 *
 * ── WAD ──────────────────────────────────────────────────────────────────
 * Doom needs a .wad file (game data). Shareware doom1.wad is freely
 * redistributable; freedoom1.wad (BSD) is a drop-in replacement. Pass an
 * absolute path or one of these well-known locations:
 *   /usr/share/games/doom/doom1.wad      (apt install doom-wad-shareware)
 *   /usr/share/games/doom/freedoom1.wad
 *   ~/.local/share/reactjit/wads/doom1.wad
 *
 * If the WAD is missing, doomgeneric prints "W_Init: couldn't open ..." to
 * stdout and exits the cart process. There's no graceful in-cart recovery.
 *
 * @example  minimal cart
 *   const doom = useDoom({ wad: '~/.local/share/reactjit/wads/doom1.wad' });
 *   if (!doom.ready) return <Text>booting…</Text>;
 *   // ...render `doom.framebuffer` however you like.
 */
import { useEffect, useRef, useState } from 'react';
import { useIFTTT, busOn } from './useIFTTT';
import { callHost } from '../ffi';

// doomkeys.h values, re-exported. Cart code uses these instead of magic
// numbers when wiring keyboard input.
export const DK = {
  RIGHT: 0xae,
  LEFT: 0xac,
  UP: 0xad,
  DOWN: 0xaf,
  STRAFE_L: 0xa0,
  STRAFE_R: 0xa1,
  USE: 0xa2,
  FIRE: 0xa3,
  ESCAPE: 27,
  ENTER: 13,
  TAB: 9,
  RSHIFT: 0xb6,
  RCTRL: 0x9d,
  RALT: 0xb8,
  SPACE: 32,
  Y: 'y'.charCodeAt(0),
  N: 'n'.charCodeAt(0),
} as const;

/** Translate a DOM-style keyboard event (or our `Pressable.onKey`) into a
 *  doom keycode. Handles arrow / fire / use / strafe / shift / ctrl / alt
 *  and falls back to lowercased ascii. Returns 0 for unmappable keys. */
export function doomKeyFor(key: string): number {
  switch (key) {
    case 'ArrowRight': return DK.RIGHT;
    case 'ArrowLeft':  return DK.LEFT;
    case 'ArrowUp':    return DK.UP;
    case 'ArrowDown':  return DK.DOWN;
    case 'Enter':      return DK.ENTER;
    case 'Escape':     return DK.ESCAPE;
    case 'Tab':        return DK.TAB;
    case ' ':          return DK.USE;
    case 'Control':    return DK.FIRE;
    case 'Shift':      return DK.RSHIFT;
    case 'Alt':        return DK.RALT;
  }
  if (key.length === 1) return key.toLowerCase().charCodeAt(0);
  return 0;
}

/** Framework bus `__keydown`/`__keyup` `ev.key` string → doomkeys.h code.
 *  The decoder in useIFTTT names arrows as 'left'/'up'/'right'/'down',
 *  ascii as lowercase chars, and named keys as 'enter'/'escape'/'tab'/
 *  'space'/'backspace'. Standalone modifier presses arrive as `sdl:NNN`
 *  with the matching ctrlKey/shiftKey/altKey flag set — those edges are
 *  picked up via the modStateRef in the hook below, not here. */
function keyEventToDoom(key: string): number {
  switch (key) {
    case 'left':      return DK.LEFT;
    case 'right':     return DK.RIGHT;
    case 'up':        return DK.UP;
    case 'down':      return DK.DOWN;
    case 'enter':     return DK.ENTER;
    case 'escape':    return DK.ESCAPE;
    case 'tab':       return DK.TAB;
    case 'space':     return DK.USE;
    case 'backspace': return 127;
  }
  if (key.length === 1) {
    const c = key.charCodeAt(0);
    if (c >= 0x20 && c < 0x7F) return c;
  }
  return 0;
}

export interface UseDoomOptions {
  /** Absolute path to a WAD file (doom1.wad / freedoom1.wad / DOOM.WAD). */
  wad: string;
  /** Target ticks/sec for the doomgeneric loop. doom is natively 35Hz;
   *  we run at 60 by default so the perceived smoothness matches the
   *  surrounding cart. The engine handles interpolation internally. */
  fps?: number;
}

export interface DoomHandle {
  ready: boolean;
  framebuffer: Uint32Array | null;
  frame: number;
  sendKey: (code: number, pressed: boolean) => void;
  /** Convenience: maps a DOM-style key string then sendKey's it. */
  press: (key: string) => void;
  release: (key: string) => void;
}

const WIDTH = 640;
const HEIGHT = 400;

export function useDoom(options: UseDoomOptions): DoomHandle {
  const { wad, fps = 35 } = options;

  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const fbRef = useRef<Uint32Array | null>(null);
  const initOnceRef = useRef(false);

  // One-shot boot. We do NOT use useEffect to drive the per-frame tick —
  // that pattern triggers React update each interval and floods the host
  // queue. Tick is driven by useIFTTT('timer:every:N') below, which rides
  // the framework's Zig timer wheel and only sets state at the cadence we
  // actually want repaints.
  useEffect(() => {
    if (initOnceRef.current) return;
    initOnceRef.current = true;

    // doomgeneric_Create blocks (parses the WAD synchronously and runs
    // D_DoomMain through to first idle). ~150ms on shareware-sized WADs.
    const ok = callHost<boolean>('__doom_init', false, wad);
    if (!ok) {
      console.error('[useDoom] __doom_init failed for wad:', wad);
      return;
    }
    const ab = callHost<ArrayBuffer | null>('__doom_framebuffer', null);
    if (!ab) {
      console.error('[useDoom] framebuffer unavailable after init');
      return;
    }
    fbRef.current = new Uint32Array(ab);
    setReady(true);
  }, [wad]);

  // Key pipe — subscribe to the framework's decoded keydown/keyup bus
  // events (same path cart/app/world uses for WASD look). Single sub each,
  // no per-key useIFTTT churn. Modifier keys (Ctrl/Shift/Alt pressed alone)
  // aren't named in SDL_KEY_NAMES so they arrive as `sdl:NNN` — we detect
  // those by raw form, and also watch ctrlKey/shiftKey/altKey flag edges
  // for the case where the user holds Ctrl while pressing a letter.
  const modStateRef = useRef({ ctrl: false, shift: false, alt: false });
  useEffect(() => {
    const sendForKey = (key: string, ev: any, pressed: boolean): void => {
      // Doomkey from named/ascii key string.
      const code = keyEventToDoom(key);
      if (code > 0) callHost('__doom_key', undefined, code, pressed);
      // Track modifier edges — Doom's defaults are Ctrl=fire, Shift=strafe-run.
      const m = modStateRef.current;
      const newCtrl = !!ev?.ctrlKey;
      const newShift = !!ev?.shiftKey;
      const newAlt = !!ev?.altKey;
      if (newCtrl !== m.ctrl) { callHost('__doom_key', undefined, DK.FIRE, newCtrl); m.ctrl = newCtrl; }
      if (newShift !== m.shift) { callHost('__doom_key', undefined, DK.RSHIFT, newShift); m.shift = newShift; }
      if (newAlt !== m.alt) { callHost('__doom_key', undefined, DK.RALT, newAlt); m.alt = newAlt; }
    };
    const onDown = (ev: any) => sendForKey(String(ev?.key ?? ''), ev, true);
    const onUp = (ev: any) => sendForKey(String(ev?.key ?? ''), ev, false);
    const unsubDown = busOn('__keydown', onDown);
    const unsubUp = busOn('__keyup', onUp);
    return () => { unsubDown(); unsubUp(); };
  }, []);

  // Framework-driven tick — IFTTT timer fires on the Zig timer wheel, the
  // handler advances doomgeneric one frame and bumps a counter. setFrame
  // is the ONLY source of re-render from this hook.
  const periodMs = Math.max(1, Math.round(1000 / fps));
  useIFTTT(`timer:every:${periodMs}`, () => {
    if (!initOnceRef.current) return;
    callHost('__doom_tick', undefined);
    setFrame((f) => (f + 1) | 0);
  });

  const sendKey = (code: number, pressed: boolean): void => {
    if (code <= 0) return;
    callHost('__doom_key', undefined, code, pressed);
  };
  const press = (key: string): void => sendKey(doomKeyFor(key), true);
  const release = (key: string): void => sendKey(doomKeyFor(key), false);

  return {
    ready,
    framebuffer: fbRef.current,
    frame,
    sendKey,
    press,
    release,
  };
}

export { WIDTH as DOOM_WIDTH, HEIGHT as DOOM_HEIGHT };
