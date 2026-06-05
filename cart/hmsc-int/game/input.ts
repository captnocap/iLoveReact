// game/input.ts — GAME_INPUT: key/pointer TRANSPORT only.
//
// V7: WASD-becomes-velocity lives in the HOST — the input_bench integrator and
// the physics-step movement unify into one host-side movement integrator. JS
// keysRef remains only as input transport, never as the integrator. So this
// door carries key events and a held-keys snapshot to whoever packs the
// physics step (game/physics.ts), and nothing else. An integration loop
// appearing in this file is a V7 violation.
//
// Events ride the framework bus (runtime/ffi.ts): the engine fires
// `__ifttt_onKeyDown/Up`, the runtime entry's shims publish `__keydown` /
// `__keyup`, and this door subscribes — the same transport hmsc's
// usePlayerDrive rides today (the behavior reference).

import { subscribe } from '@reactjit/ffi';

/** The bus payload shape for `__keydown`/`__keyup` (decoded SDL key event). */
export type KeyEvent = {
  key?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

export type KeyState = {
  /** is this key held right now? (key names are matched case-insensitively) */
  isDown: (key: string) => boolean;
  /** live modifier snapshot from the latest event */
  shift: () => boolean;
  ctrl: () => boolean;
  alt: () => boolean;
  /** stop tracking — the snapshot freezes and the bus subscriptions drop */
  dispose: () => void;
};

/** Subscribe to raw keydown events. Returns the unsubscribe. */
export function onKeyDown(fn: (event: KeyEvent) => void): () => void {
  return subscribe('__keydown', fn);
}

/** Subscribe to raw keyup events. Returns the unsubscribe. */
export function onKeyUp(fn: (event: KeyEvent) => void): () => void {
  return subscribe('__keyup', fn);
}

/**
 * A held-keys snapshot fed by the bus — poll it from the frame tick, hand the
 * intent to the host step. One instance per consumer; dispose with the scene.
 */
export function createKeyState(): KeyState {
  const held: Record<string, boolean> = {};
  let shift = false;
  let ctrl = false;
  let alt = false;

  const apply = (event: KeyEvent, down: boolean): void => {
    const key = String(event?.key ?? '').toLowerCase();
    if (key) held[key] = down;
    if (typeof event?.shiftKey === 'boolean') shift = event.shiftKey;
    if (typeof event?.ctrlKey === 'boolean') ctrl = event.ctrlKey;
    if (typeof event?.altKey === 'boolean') alt = event.altKey;
  };
  const offDown = onKeyDown((event) => apply(event, true));
  const offUp = onKeyUp((event) => apply(event, false));

  return {
    isDown: (key: string) => held[key.toLowerCase()] === true,
    shift: () => shift,
    ctrl: () => ctrl,
    alt: () => alt,
    dispose: () => {
      offDown();
      offUp();
    },
  };
}

export const GAME_INPUT = Object.freeze({
  createKeyState,
  onKeyDown,
  onKeyUp,
});
