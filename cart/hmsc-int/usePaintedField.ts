// usePaintedField — coalesced GPU-buffer state for a brushed Effect surface.
//
// THE SCALE PROBLEM. The brush mutates the underlying typed buffer (Int16/
// Float32) at INPUT rate — every cursor move during a drag, ~100/s. Re-encoding
// that whole buffer into the Effect's data array on each move is O(cells), and
// each new array identity makes the reconciler re-upload the ENTIRE buffer to
// the GPU. At a demo 8x8 patch (64 cells) that was free; at a 120x120 chunk it
// is ~14,400 cells (the zone view ~28,800), uploaded ~100x/s during a drag.
//
// THE FIX. Decouple input rate from upload rate. The brush calls touch() at
// input rate; touch() only flips a dirty flag and schedules ONE flush per frame.
// The encode + the fresh data array (what drives the re-upload) happen at most
// once per frame, so a fast stroke that paints 30 cells in a frame still uploads
// once. encode() is a thunk reading the live buffer (refs/props), run only on a
// flushed frame; extraDeps forces a recompute when external React state (e.g.
// the zone defs, or the active layer) changes the encoded output.
//
// (The cart V8 host has no requestAnimationFrame — see the setTimeout fallback,
// the same idiom used across cart/hmsc. One frame of coalescing is imperceptible.)

import { useCallback, useMemo, useRef, useState } from 'react';

const g = globalThis as any;
const schedule: (fn: () => void) => unknown = g.requestAnimationFrame
  ? g.requestAnimationFrame.bind(g)
  : (fn: () => void) => setTimeout(fn, 16);

export function usePaintedField(
  encode: () => number[],
  extraDeps: unknown[] = [],
): { data: number[]; touch: () => void } {
  const [frame, setFrame] = useState(0);
  const dirty = useRef(false);
  const queued = useRef(false);

  const touch = useCallback(() => {
    dirty.current = true;
    if (queued.current) return; // a flush is already pending for this frame
    queued.current = true;
    schedule(() => {
      queued.current = false;
      if (!dirty.current) return;
      dirty.current = false;
      setFrame((f) => f + 1);
    });
  }, []);

  // encode reads live refs, so it recomputes only on a flushed frame or when an
  // external dep changes — not on unrelated re-renders (tool/hover/layout). The
  // returned array keeps a stable identity between flushes, so the Effect does
  // not re-upload on those re-renders.
  const data = useMemo(() => encode(), [frame, ...extraDeps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, touch };
}
