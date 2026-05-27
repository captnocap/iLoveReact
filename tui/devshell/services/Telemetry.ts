// Live cart telemetry over /tmp/reactjit.sock — fps, layout/paint times,
// node count. Polls the dev-host's TELEMETRY verb at 4Hz. Connections
// are short-lived (one per poll) to keep the dev-host's IPC handler
// simple — same shape as scripts/push-bundle.js. If the dev host isn't
// running or doesn't recognize the verb, we just return null.

import { useState, useEffect } from 'react';

declare const __unixConnect: ((path: string) => number) | undefined;
declare const __unixWrite:   ((fd: number, content: string) => number) | undefined;
declare const __unixReadAll: ((fd: number, timeoutMs: number, maxBytes: number) => string | null) | undefined;
declare const __unixClose:   ((fd: number) => void) | undefined;
declare const __fs_exists:      ((path: string) => boolean) | undefined;

export type Telemetry = {
  fps: number;
  layout_us: number;
  paint_us: number;
  frame_total_us: number;
  frame_number: number;
  node_count: number;
};

const SOCK = '/tmp/reactjit.sock';
const POLL_MS = 250;
const READ_TIMEOUT_MS = 200;

function pollOnce(): Telemetry | null {
  if (typeof __unixConnect !== 'function') return null;
  if (typeof __fs_exists === 'function' && !__fs_exists(SOCK)) return null;
  const fd = __unixConnect(SOCK);
  if (fd < 0) return null;
  try {
    if (__unixWrite!(fd, 'TELEMETRY\n') < 0) return null;
    const reply = __unixReadAll!(fd, READ_TIMEOUT_MS, 4096);
    if (!reply) return null;
    if (reply.startsWith('ERR')) return null; // old dev host w/o the verb
    try {
      const j = JSON.parse(reply.trim());
      if (typeof j.fps !== 'number') return null;
      return j as Telemetry;
    } catch { return null; }
  } finally {
    __unixClose!(fd);
  }
}

export function useTelemetry(): Telemetry | null {
  const [tel, setTel] = useState<Telemetry | null>(null);
  useEffect(() => {
    const t = setInterval(() => setTel(pollOnce()), POLL_MS);
    return () => clearInterval(t);
  }, []);
  return tel;
}
