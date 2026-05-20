// Ring buffer of recent BridgeTrace records. The BridgePanel
// subscribes to inspect what the bridge resolved by, what fell back
// to terminal scraping, etc.
//
// Mirrors state.ts's subscribe pattern: dependency-free, useState
// trigger for React.

import { useEffect, useState } from 'react';
import type { BridgeTrace } from './types';

const MAX = 50;
let traces: BridgeTrace[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch (e: any) {
      console.error('[trace-store] listener error:', e?.message || e);
    }
  }
}

export function pushTrace(t: BridgeTrace): void {
  traces = [...traces, t].slice(-MAX);
  notify();
}

export function getTraces(): BridgeTrace[] {
  return traces;
}

export function subscribeTraces(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useTraces(): BridgeTrace[] {
  const [, force] = useState(0);
  useEffect(() => subscribeTraces(() => force(n => (n + 1) & 0xffff)), []);
  return traces;
}
