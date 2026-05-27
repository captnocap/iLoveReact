// useHostAnimation — register a host-driven animation. The Zig
// painter loop owns the per-frame tick; this hook is JUST for
// declaring "an animation exists" at mount and tearing it down at
// unmount. JS does ZERO per-frame work for the registered animation.
//
// Flow:
//   1. Component mounts → useHostAnimation calls __anim_register,
//      which inserts an entry into framework/animations.zig's
//      registry and seeds the bound latch with `from`.
//   2. Each painter frame: framework/animations.zig:tickAll evaluates
//      every active animation against now_ms, computes the eased
//      value, writes it to its latch via framework/latches.zig:set.
//   3. v8_app.zig:syncLatchesToNodes (already running per-frame)
//      writes that latch value into the bound style prop on whichever
//      node uses `style={{ X: 'latch:KEY' }}`.
//   4. Component unmounts → __anim_unregister removes the entry.
//
// What the cart code looks like:
//
//   useHostAnimation({
//     latch: 'easing:dot:x',
//     curve: 'easeInOut',
//     from: 0,
//     to: 200,
//     durationMs: 1800,
//     loop: 'cycle',
//   });
//
//   <Box style={{ left: 'latch:easing:dot:x' }} />
//
// No setState, no RAF, no useEffect doing per-frame math, no
// __latchSet calls. The animation runs entirely in Zig at the
// painter's natural cadence, smooth even when the JS thread is busy.

import { useEffect } from 'react';
import { callHost, hasHost } from '../ffi';

export type CurveName =
  | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring' | 'bounce' | 'sine'
  | 'easeInSine' | 'easeOutSine' | 'easeInOutSine'
  | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInQuart' | 'easeOutQuart' | 'easeInOutQuart'
  | 'easeInQuint' | 'easeOutQuint' | 'easeInOutQuint'
  | 'easeInExpo' | 'easeOutExpo' | 'easeInOutExpo'
  | 'easeInCirc' | 'easeOutCirc' | 'easeInOutCirc'
  | 'easeInBack' | 'easeOutBack' | 'easeInOutBack'
  | 'easeInElastic' | 'easeOutElastic' | 'easeInOutElastic'
  | 'easeInBounce' | 'easeOutBounce' | 'easeInOutBounce';
export type LoopMode = 'once' | 'cycle' | 'pingpong';

export interface HostAnimationConfig {
  latch: string;
  curve?: CurveName;
  from: number;
  to: number;
  durationMs: number;
  loop?: LoopMode;
  /** Rewind the animation's effective start by this many ms. Lets
   *  callers stagger phases when N animations share a curve. */
  startOffsetMs?: number;
}

export function useHostAnimation(config: HostAnimationConfig): void {
  const {
    latch,
    curve = 'linear',
    from,
    to,
    durationMs,
    loop = 'cycle',
    startOffsetMs = 0,
  } = config;
  useEffect(() => {
    if (!hasHost('__anim_register')) return;
    const id = callHost<number>('__anim_register', 0, latch, curve, loop, from, to, durationMs, startOffsetMs);
    if (typeof id !== 'number' || id <= 0) return;
    return () => {
      callHost('__anim_unregister', undefined, id);
    };
  }, [latch, curve, from, to, durationMs, loop, startOffsetMs]);
}
