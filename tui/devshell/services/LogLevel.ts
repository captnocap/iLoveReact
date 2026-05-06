// Log-level toggle. Cycles the dev host's event_bus min-importance
// threshold via the LOGLEVEL IPC verb so noisy "log"-tier events can
// be turned on for a debugging session and off again afterwards.
//
// Standard log-level semantics: each level = "show this tier and above".
// Threshold value = floor importance for that tier.
//   trace 0.00 — everything passes
//   debug 0.15 — log.debug and above (per-frame trace logs included)
//   info  0.30 — log.info and above (default; gpu trace excluded)
//   warn  0.70 — log.warn and above (only warnings/errors)
//   error 0.85 — only errors+critical

import { useState, useEffect, useCallback, useRef } from 'react';

declare const __unixConnect: ((path: string) => number) | undefined;
declare const __unixWrite:   ((fd: number, content: string) => number) | undefined;
declare const __unixReadAll: ((fd: number, timeoutMs: number, maxBytes: number) => string | null) | undefined;
declare const __unixClose:   ((fd: number) => void) | undefined;
declare const __exists:      ((path: string) => boolean) | undefined;

const SOCK = '/tmp/reactjit.sock';
const TIMEOUT_MS = 200;

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export const LEVELS: { name: LogLevelName; value: number; color: string }[] = [
  { name: 'trace', value: 0.00, color: '#94a3b8' },
  { name: 'debug', value: 0.15, color: '#60a5fa' },
  { name: 'info',  value: 0.30, color: '#a3e635' },
  { name: 'warn',  value: 0.70, color: '#fbbf24' },
  { name: 'error', value: 0.85, color: '#f87171' },
];

function txn(line: string): number | null {
  if (typeof __unixConnect !== 'function') return null;
  if (typeof __exists === 'function' && !__exists(SOCK)) return null;
  const fd = __unixConnect(SOCK);
  if (fd < 0) return null;
  try {
    if (__unixWrite!(fd, line) < 0) return null;
    const reply = __unixReadAll!(fd, TIMEOUT_MS, 4096);
    if (!reply) return null;
    if (reply.startsWith('ERR')) return null;
    try {
      const j = JSON.parse(reply.trim());
      return typeof j.level === 'number' ? j.level : null;
    } catch { return null; }
  } finally {
    __unixClose!(fd);
  }
}

export function fetchLogLevel(): number | null { return txn('LOGLEVEL\n'); }
export function setLogLevel(value: number): number | null { return txn(`LOGLEVEL ${value.toFixed(3)}\n`); }

function nearestLevelIndex(v: number): number {
  let best = 0;
  let bestDiff = Math.abs(LEVELS[0].value - v);
  for (let i = 1; i < LEVELS.length; i++) {
    const d = Math.abs(LEVELS[i].value - v);
    if (d < bestDiff) { best = i; bestDiff = d; }
  }
  return best;
}

export function useLogLevel() {
  const [value, setValue] = useState<number | null>(null);
  const valueRef = useRef<number | null>(null);
  valueRef.current = value;

  useEffect(() => {
    const refresh = () => { const v = fetchLogLevel(); if (v !== null) setValue(v); };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  // Stable callback — reads via ref so the keypress effect that holds
  // it doesn't have to resubscribe on every level change.
  const cycle = useCallback(() => {
    const cur = valueRef.current ?? LEVELS[0].value;
    const idx = (nearestLevelIndex(cur) + 1) % LEVELS.length;
    const next = LEVELS[idx].value;
    const ack = setLogLevel(next);
    setValue(ack ?? next);
  }, []);

  const idx = value === null ? null : nearestLevelIndex(value);
  return {
    value,
    name: idx === null ? null : LEVELS[idx].name,
    color: idx === null ? '#475569' : LEVELS[idx].color,
    cycle,
  };
}
