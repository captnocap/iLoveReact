import { useEffect, useRef, useState } from 'react';
import { EASINGS } from '@reactjit/runtime/easing';

// Frame primitives — fall back to setTimeout when the host doesn't expose
// requestAnimationFrame. Both refs are stable per-call, intended for
// scheduleFrame/cancelFrame pairs inside hooks.

function scheduleFrame(fn) {
  const g = globalThis;
  const raf = typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame.bind(g) : null;
  return raf ? raf(fn) : setTimeout(fn, 16);
}

function cancelFrame(id) {
  if (id == null) return;
  const g = globalThis;
  const cancel = typeof g.cancelAnimationFrame === 'function' ? g.cancelAnimationFrame.bind(g) : null;
  if (cancel) cancel(id); else clearTimeout(id);
}

function nowMs() {
  const g = globalThis;
  if (g && g.performance && typeof g.performance.now === 'function') return g.performance.now();
  return Date.now();
}

/**
 * useAnimationTimeline — one RAF-driven master clock per component, with
 * helpers to extract eased progress through arbitrary [start, end] ranges.
 *
 *   const tl = useAnimationTimeline({ skip: !hasGreet, skipOffsetMs: 1400 });
 *   const greetOp = hasGreet ? tl.fadeOut(500, 1400) : 0;
 *   const mainOp  = tl.range(1400, 1950);
 *   const slideP  = tl.range(1950, 2450);
 *   const btn1Op  = tl.range(2450, 2750);
 *
 * Why this exists: doing N independent useAppearProgress hooks burns N
 * RAF loops. A single timeline + N range queries is one loop, and the
 * phase constants stay readable as scheduled times.
 *
 * Options
 *   skip:           when true, the effective t is shifted forward by
 *                   `skipOffsetMs`. Use this to fast-forward past the
 *                   carryover phase when the prior step's state isn't
 *                   present (e.g. the user navigated here directly).
 *   skipOffsetMs:   number of ms to skip when `skip` is true.
 *
 * Returns
 *   t:        effective elapsed ms (after skip shift). Tracks the master
 *             clock through React state so derived values re-render.
 *   elapsed:  raw elapsed ms since mount, ignoring `skip`.
 *   tRef:     ref pointing at the *latest* effective t. Read this from
 *             click / keyboard handlers — the renderer's handler registry
 *             freezes closures from the first commit, so handlers reading
 *             `t` directly will see the value from when the entry was
 *             registered, not the value at click time.
 *   range(a, b, easing?):    eased progress 0→1 within [a, b]. Returns 0
 *                            before `a` and 1 after `b`. Default easing is
 *                            'easeOutCubic'; pass any name from runtime/easing.
 *   fadeOut(a, b, easing?):  the inverse — 1 before `a`, 0 after `b`.
 */
export function useAnimationTimeline(opts) {
  const skip = !!(opts && opts.skip);
  const skipOffsetMs = opts && typeof opts.skipOffsetMs === 'number' ? opts.skipOffsetMs : 0;

  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const frameRef = useRef(null);
  // Tracks the largest `b` ever passed to range(). Once effective time
  // is past it (plus a grace frame), every range() call saturates at 1,
  // so there is nothing left to animate and we go *idle*.
  //
  // Idle means: stop calling setT (no re-render, no repaint, no
  // ScrollView static-surface flicker — that flicker, from re-rendering
  // every frame for the cart's lifetime, is the bug this gating fixes).
  // It does NOT mean stop the RAF loop. The loop keeps running so that:
  //   (1) tRef.current stays *live* — interaction handlers
  //       (provider-tile click, Next, exit transitions) capture the real
  //       elapsed time, not a value frozen at the end of the intro; and
  //   (2) the moment a handler schedules a new range() whose upper bound
  //       pushes maxBRef forward, the next tick sees we're no longer idle
  //       and resumes setT, so the new fade actually plays.
  // A prior version stopped the RAF entirely on idle; that froze tRef and
  // killed every post-intro animation (probe menu never faded in, the
  // step 1→2 exit froze for ~1.9s instead of cross-fading).
  const maxBRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const startedAt = nowMs();
    const GRACE_MS = 64; // one extra frame past the last animation
    const tick = () => {
      if (cancelled) return;
      const elapsed = nowMs() - startedAt;
      const eff = skip ? elapsed + skipOffsetMs : elapsed;
      tRef.current = eff; // always live, even while idle
      // Re-render only while something is still animating. We require
      // maxBRef > 0 so the first render populates it before we can idle.
      const idle = maxBRef.current > 0 && eff >= maxBRef.current + GRACE_MS;
      if (!idle) setT(elapsed);
      frameRef.current = scheduleFrame(tick);
    };
    frameRef.current = scheduleFrame(tick);
    return () => {
      cancelled = true;
      cancelFrame(frameRef.current);
    };
  }, [skip, skipOffsetMs]);

  const eff = skip ? t + skipOffsetMs : t;

  function range(a, b, easing) {
    if (b > maxBRef.current) maxBRef.current = b;
    if (eff <= a) return 0;
    if (eff >= b) return 1;
    const fn = (easing && EASINGS[easing]) || EASINGS.easeOutCubic;
    return fn((eff - a) / (b - a));
  }

  function fadeOut(a, b, easing) {
    return 1 - range(a, b, easing);
  }

  return { t: eff, elapsed: t, tRef, range, fadeOut };
}
