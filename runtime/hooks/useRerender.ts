/**
 * useRerender — returns a stable callback that forces the calling component to
 * re-render.
 *
 * Use it when something OUTSIDE React state changed — a ref, an imperative
 * module store, a host value polled on an interval — and the view needs to
 * repaint. It hides the `const [, set] = useState(0)` throwaway-counter idiom
 * (the empty-slot destructuring + `set(n => n + 1)` trick) behind a name, so
 * call sites read as intent instead of a riddle.
 *
 * The returned function is referentially stable, so it is safe to pass straight
 * to an effect, a subscription, or `useInterval` without re-subscribing.
 *
 * @example
 *   const rerender = useRerender();
 *   useInterval(rerender, 33);            // repaint a ref-driven overlay at 30 Hz
 *   // or, on an imperative change:
 *   fovRef.current = next; rerender();
 */
import { useCallback, useState } from 'react';

export function useRerender(): () => void {
  const [, bump] = useState(0);
  return useCallback(() => bump((n) => n + 1), []);
}
