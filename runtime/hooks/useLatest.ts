/**
 * useLatest — stable ref that always reads the latest value.
 *
 * Solves the stale-closure problem when you pass a handler into a
 * subscription / event listener / setInterval inside useEffect: capturing
 * the handler by value freezes it at first commit; reading
 * `latestRef.current` instead always sees the current render's value.
 *
 * @example
 *   function MyHook(onTick: () => void) {
 *     const latest = useLatest(onTick);
 *     useEffect(() => {
 *       const off = busOn('tick', () => latest.current());
 *       return off;
 *     }, []); // empty deps — `latest` is stable, the callback isn't captured.
 *   }
 *
 * Replaces inlined `const xRef = useRef(x); xRef.current = x;` blocks in
 * useFileWatch, useMedia, useTelemetry, useProcess, useConnection, useHost,
 * useCRUD, audio-controls.tsx.
 */
import { useRef } from 'react';

export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
