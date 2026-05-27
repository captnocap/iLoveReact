/**
 * useFileDrop — fires `handler(path)` whenever a file is dropped onto the
 * window. Bridges framework/filedrop.zig.
 *
 * Mechanics: filedrop.zig increments a monotonic seq on every dispatch and
 * calls state.markDirty(), which wakes React. This hook re-reads
 * (lastPath, seq) on each render; when seq advances, it invokes the
 * handler with the new path.
 *
 * Usage:
 *   useFileDrop((path) => {
 *     console.log('dropped:', path);
 *     setFile(path);
 *   });
 */

import { useEffect, useRef } from 'react';
import { callHost } from '../ffi';

export function useFileDrop(handler: (path: string) => void): void {
  const seqRef = useRef<number>(-1);

  useEffect(() => {
    // Initialize the baseline so the first mount doesn't fire stale drops.
    if (seqRef.current === -1) {
      seqRef.current = callHost<number>('__filedropSeq', 0);
    }
  }, []);

  // Read on every render — this hook deliberately re-evaluates as part of
  // the regular render pass (markDirty wakes us).
  const seq = callHost<number>('__filedropSeq', 0);
  if (seqRef.current !== -1 && seq !== seqRef.current) {
    seqRef.current = seq;
    const path = callHost<string>('__filedropLastPath', '');
    if (path) handler(path);
  }
}
