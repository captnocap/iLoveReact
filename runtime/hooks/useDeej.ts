import { useCallback, useEffect, useState } from 'react';
import { callHost, hasHost } from '../ffi';

// deej fader boards (framework/deej.zig) — homemade Arduino mixers that
// print '|'-separated 10-bit fader values over USB serial. The host only
// emits an event when a fader PHYSICALLY moves, so whatever UI consumes
// these stays fully authoritative while the board is idle or absent.

export interface DeejMove {
  /** Fader index, 0-based, left to right as wired on the board. */
  slider: number;
  /** Normalized position 0..1. */
  value: number;
}

export interface DeejState {
  connected: boolean;
  port: string;
  count: number;
  values: number[];
}

export interface DeejOptions {
  autoStart?: boolean;
  pollMs?: number;
  /** Explicit serial port (otherwise RJIT_DEEJ_PORT env, then /dev/ttyACM*-ttyUSB* scan). */
  port?: string;
  /** Serial baud, default 9600 (the stock deej sketch rate). */
  baud?: number;
}

export interface DeejHandle {
  /** Host capability compiled in and started. */
  available: boolean;
  /** Physical board present on the wire right now. */
  connected: boolean;
  port: string;
  /** Latest normalized 0..1 value per fader. */
  values: number[];
  start: () => boolean;
  stop: () => void;
  subscribe: (fn: (move: DeejMove) => void) => () => void;
}

type Handler = (move: DeejMove) => void;

const subs = new Set<Handler>();
let pollTimer: any = null;
let lastState: DeejState = { connected: false, port: '', count: 0, values: [] };
const stateSubs = new Set<(s: DeejState) => void>();

function hostStart(port: string, baud: number): boolean {
  return Number(callHost<unknown>('__deej_start', 0, port, baud) ?? 0) > 0;
}

function hostStop(): void {
  callHost<void>('__deej_stop', undefined);
}

function hostPoll(): number {
  return Number(callHost<unknown>('__deej_poll', 0) ?? 0);
}

function hostNextEventJson(): string {
  return String(callHost<unknown>('__deej_next_event_json', '') ?? '');
}

function hostStateJson(): string {
  return String(callHost<unknown>('__deej_state_json', '{}') ?? '{}');
}

function parseMove(raw: string): DeejMove | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw);
    return { slider: Number(e.slider || 0), value: Number(e.value || 0) };
  } catch {
    return null;
  }
}

function readState(): DeejState {
  try {
    const s = JSON.parse(hostStateJson());
    return {
      connected: Boolean(s.connected),
      port: String(s.port || ''),
      count: Number(s.count || 0),
      values: Array.isArray(s.values) ? s.values.map(Number) : [],
    };
  } catch {
    return { connected: false, port: '', count: 0, values: [] };
  }
}

function drain() {
  hostPoll();
  let sawMove = false;
  while (true) {
    const move = parseMove(hostNextEventJson());
    if (!move) break;
    sawMove = true;
    for (const fn of Array.from(subs)) {
      try { fn(move); } catch (e: any) {
        console.error('[deej] handler error:', e?.message || e);
      }
    }
  }
  const next = readState();
  if (sawMove || next.connected !== lastState.connected || next.port !== lastState.port) {
    lastState = next;
    for (const fn of Array.from(stateSubs)) fn(next);
  }
}

function ensurePolling(periodMs: number) {
  if (pollTimer != null) return;
  pollTimer = setInterval(drain, Math.max(8, Math.round(periodMs || 33)));
}

function stopPolling() {
  if (pollTimer == null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export function subscribeDeej(fn: Handler): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export function useDeej(options: DeejOptions = {}): DeejHandle {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<DeejState>(lastState);

  const start = useCallback(() => {
    if (!hasHost('__deej_start')) {
      setAvailable(false);
      return false;
    }
    if (!hostStart(options.port ?? '', options.baud ?? 0)) {
      setAvailable(false);
      return false;
    }
    setAvailable(true);
    ensurePolling(options.pollMs ?? 33);
    return true;
  }, [options.port, options.baud, options.pollMs]);

  const stop = useCallback(() => {
    stopPolling();
    hostStop();
    setAvailable(false);
  }, []);

  useEffect(() => {
    if (options.autoStart === false) return;
    start();
  }, [options.autoStart, start]);

  useEffect(() => {
    stateSubs.add(setState);
    return () => { stateSubs.delete(setState); };
  }, []);

  return {
    available,
    connected: state.connected,
    port: state.port,
    values: state.values,
    start,
    stop,
    subscribe: subscribeDeej,
  };
}
