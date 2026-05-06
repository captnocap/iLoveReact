// EventStream — polls the dev host's in-memory event ring via the
// EVENTS IPC verb. No SQL involvement, no disk I/O on the host side.
// Returns the last N entries, newest at the bottom.

import { useState, useEffect } from 'react';

declare const __unixConnect: ((path: string) => number) | undefined;
declare const __unixWrite:   ((fd: number, content: string) => number) | undefined;
declare const __unixReadAll: ((fd: number, timeoutMs: number, maxBytes: number) => string | null) | undefined;
declare const __unixClose:   ((fd: number) => void) | undefined;
declare const __exists:      ((path: string) => boolean) | undefined;

const SOCK = '/tmp/reactjit.sock';
const POLL_MS = 1000;
const READ_TIMEOUT_MS = 500;
const MAX_BYTES = 256 * 1024;

export type Event = {
  id: number;
  ts: number;
  imp: number;
  type: string;
  src: string;
  payload: any;
};

function fetchRecent(n: number): Event[] | null {
  if (typeof __unixConnect !== 'function') return null;
  if (typeof __exists === 'function' && !__exists(SOCK)) return null;
  const fd = __unixConnect(SOCK);
  if (fd < 0) return null;
  try {
    if (__unixWrite!(fd, `EVENTS ${n}\n`) < 0) return null;
    // Drain until newline-terminated JSON received.
    let buf = '';
    const deadline = Date.now() + READ_TIMEOUT_MS;
    while (!buf.endsWith('\n') && Date.now() < deadline) {
      const remaining = Math.max(10, deadline - Date.now());
      const chunk = __unixReadAll!(fd, remaining, MAX_BYTES);
      if (chunk === null) continue;
      if (chunk === '') break; // EOF without newline — host went away
      buf += chunk;
      if (buf.length >= MAX_BYTES) break;
    }
    if (!buf) return null;
    if (buf.startsWith('ERR')) return null;
    try {
      const arr = JSON.parse(buf.trim());
      return Array.isArray(arr) ? arr as Event[] : null;
    } catch { return null; }
  } finally {
    __unixClose!(fd);
  }
}

export function useEventStream(maxN: number = 500) {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    const refresh = () => {
      const list = fetchRecent(maxN);
      if (list !== null) setEvents(list);
    };
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [maxN]);
  return events;
}
