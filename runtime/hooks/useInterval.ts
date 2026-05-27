/**
 * useInterval — declarative setInterval. Calls `fn` every `ms` for the
 * lifetime of the component, picking up the latest closure each tick.
 *
 * Pass `ms = 0` (or null) to pause without unmounting.
 *
 * @example
 *   useInterval(() => setNow(Date.now()), 1000);
 *
 * Promoted from the private `useInterval` previously inlined inside
 * runtime/audio-controls.tsx.
 */
import { useEffect } from 'react';
import { useLatest } from './useLatest';

export function useInterval(fn: () => void, ms: number | null): void {
  const latest = useLatest(fn);
  useEffect(() => {
    if (ms == null || ms <= 0) return;
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
