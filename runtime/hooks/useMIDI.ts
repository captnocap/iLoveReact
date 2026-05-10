import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '../audio';

declare const globalThis: any;

export type MidiEventType = 'note_on' | 'note_off' | 'cc' | 'clock' | 'start' | 'stop';

export interface MidiEvent {
  type: MidiEventType;
  note: number;
  velocity: number;
  cc: number;
  value: number;
  channel: number;
  device: string;
}

export interface MidiPort {
  id: string;
  name: string;
  connected: boolean;
}

export interface MidiMapping {
  target: string | number;
  param: string;
  channel: number;
  cc: number;
  min?: number;
  max?: number;
}

export interface MidiLearnTarget {
  target: string | number;
  param: string;
  min?: number;
  max?: number;
}

export interface MIDIOptions {
  autoStart?: boolean;
  pollMs?: number;
  target?: string | number;
  routeNotes?: boolean;
  clockTarget?: string | number;
  syncTransport?: boolean;
}

export interface MIDIHandle {
  available: boolean;
  inputs: MidiPort[];
  lastEvent: MidiEvent | null;
  error: string | null;
  start: () => boolean;
  stop: () => void;
  refreshDevices: () => MidiPort[];
  subscribe: (fn: (event: MidiEvent) => void) => () => void;
  midiLearn: (target: string | number, param: string, range?: { min?: number; max?: number }) => void;
  midiMap: (target: string | number, param: string, channel: number, cc: number, range?: { min?: number; max?: number }) => void;
  midiUnmap: (target: string | number, param?: string) => void;
  mappings: MidiMapping[];
  learning: MidiLearnTarget | null;
}

type Handler = (event: MidiEvent) => void;

const subs = new Set<Handler>();
let pollTimer: any = null;
let pollPeriodMs = 16;

const G = globalThis as any;

function hostStart(): boolean {
  const fn = G.__midiStart ?? G.__midi_start;
  return typeof fn === 'function' ? Number(fn() ?? 0) > 0 : false;
}

function hostStop(): void {
  const fn = G.__midiStop ?? G.__midi_stop;
  if (typeof fn === 'function') fn();
}

function hostAvailable(): boolean {
  const fn = G.__midiIsAvailable ?? G.__midi_is_available;
  return typeof fn === 'function' ? Number(fn() ?? 0) > 0 : false;
}

function hostPoll(): number {
  const fn = G.__midiPoll ?? G.__midi_poll;
  return typeof fn === 'function' ? Number(fn() ?? 0) : 0;
}

function hostNextEventJson(): string {
  const fn = G.__midiNextEventJson ?? G.__midi_next_event_json;
  return typeof fn === 'function' ? String(fn() ?? '') : '';
}

function hostDevicesJson(): string {
  const fn = G.__midiDevicesJson ?? G.__midi_devices_json;
  return typeof fn === 'function' ? String(fn() ?? '[]') : '[]';
}

function emit(event: MidiEvent) {
  for (const fn of Array.from(subs)) {
    try { fn(event); } catch (e: any) {
      console.error('[midi] handler error:', e?.message || e);
    }
  }
}

function parseEvent(raw: string): MidiEvent | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw);
    return {
      type: String(e.type || 'clock') as MidiEventType,
      note: Number(e.note || 0),
      velocity: Number(e.velocity || 0),
      cc: Number(e.cc || 0),
      value: Number(e.value || 0),
      channel: Number(e.channel || 0),
      device: String(e.device || ''),
    };
  } catch {
    return null;
  }
}

function drainEvents() {
  hostPoll();
  while (true) {
    const event = parseEvent(hostNextEventJson());
    if (!event) break;
    emit(event);
  }
}

function ensurePolling(periodMs: number) {
  pollPeriodMs = Math.max(4, Math.round(periodMs || 16));
  if (pollTimer != null) return;
  pollTimer = setInterval(drainEvents, pollPeriodMs);
}

function stopPolling() {
  if (pollTimer == null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function readDevices(): MidiPort[] {
  try {
    const parsed = JSON.parse(hostDevicesJson());
    return Array.isArray(parsed) ? parsed.map((d) => ({
      id: String(d.id || ''),
      name: String(d.name || ''),
      connected: Boolean(d.connected),
    })) : [];
  } catch {
    return [];
  }
}

function subscribeMIDI(fn: Handler): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

function scaleCC(value: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(1, value / 127));
  return min + t * (max - min);
}

export { subscribeMIDI };

export function useMIDI(options: MIDIOptions = {}): MIDIHandle {
  const audio = useAudio();
  const audioRef = useRef(audio);
  const [available, setAvailable] = useState(false);
  const [inputs, setInputs] = useState<MidiPort[]>([]);
  const [lastEvent, setLastEvent] = useState<MidiEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<MidiMapping[]>([]);
  const [learning, setLearning] = useState<MidiLearnTarget | null>(null);

  const mappingsRef = useRef<MidiMapping[]>([]);
  const learningRef = useRef<MidiLearnTarget | null>(null);
  const targetRef = useRef<string | number | undefined>(options.target);
  const clockTargetRef = useRef<string | number | undefined>(options.clockTarget);
  const routeNotesRef = useRef(options.routeNotes !== false);
  const syncTransportRef = useRef(Boolean(options.syncTransport));

  audioRef.current = audio;
  mappingsRef.current = mappings;
  learningRef.current = learning;
  targetRef.current = options.target;
  clockTargetRef.current = options.clockTarget;
  routeNotesRef.current = options.routeNotes !== false;
  syncTransportRef.current = Boolean(options.syncTransport);

  const refreshDevices = useCallback(() => {
    const next = readDevices();
    setInputs(next);
    return next;
  }, []);

  const start = useCallback(() => {
    if (!hostStart()) {
      setAvailable(false);
      setError('midi unavailable');
      return false;
    }
    setAvailable(hostAvailable());
    setInputs(readDevices());
    setError(null);
    ensurePolling(options.pollMs ?? 16);
    return true;
  }, [options.pollMs]);

  const stop = useCallback(() => {
    stopPolling();
    hostStop();
    setAvailable(false);
  }, []);

  useEffect(() => {
    if (options.autoStart === false) return;
    start();
    return () => {};
  }, [options.autoStart, start]);

  useEffect(() => subscribeMIDI((event) => {
    setLastEvent(event);
    const audioApi = audioRef.current;

    if ((event.type === 'note_on' || event.type === 'note_off') && routeNotesRef.current && targetRef.current !== undefined) {
      if (event.type === 'note_on' && event.velocity > 0) {
        audioApi.noteOn(targetRef.current, event.note, event.velocity / 127);
      } else {
        audioApi.noteOff(targetRef.current, event.note);
      }
    }

    if (event.type === 'start') {
      if (clockTargetRef.current !== undefined) audioApi.clockStart(clockTargetRef.current);
      if (syncTransportRef.current) audioApi.play();
      return;
    }

    if (event.type === 'stop') {
      if (clockTargetRef.current !== undefined) audioApi.clockStop(clockTargetRef.current);
      if (syncTransportRef.current) audioApi.pause();
      return;
    }

    if (event.type === 'clock') {
      if (clockTargetRef.current !== undefined) audioApi.clockPulse(clockTargetRef.current);
      return;
    }

    if (event.type !== 'cc') return;

    const learn = learningRef.current;
    if (learn) {
      const next: MidiMapping = {
        target: learn.target,
        param: learn.param,
        channel: event.channel,
        cc: event.cc,
        min: learn.min,
        max: learn.max,
      };
      setMappings((prev) => {
        const filtered = prev.filter((m) => !(m.target === next.target && m.param === next.param));
        return [...filtered, next];
      });
      setLearning(null);
      return;
    }

    for (const mapping of mappingsRef.current) {
      if (mapping.channel !== event.channel || mapping.cc !== event.cc) continue;
      let min = mapping.min;
      let max = mapping.max;
      if (min === undefined || max === undefined) {
        const def = audioApi.getParamDefinitions(mapping.target).find((p) => p.name === mapping.param);
        min = min ?? def?.min ?? 0;
        max = max ?? def?.max ?? 1;
      }
      audioApi.setModuleParam(mapping.target, mapping.param, scaleCC(event.value, min, max));
    }
  }), []);

  const midiLearn = useCallback((target: string | number, param: string, range: { min?: number; max?: number } = {}) => {
    setLearning({ target, param, min: range.min, max: range.max });
  }, []);

  const midiMap = useCallback((target: string | number, param: string, channel: number, cc: number, range: { min?: number; max?: number } = {}) => {
    const next: MidiMapping = { target, param, channel, cc, min: range.min, max: range.max };
    setMappings((prev) => {
      const filtered = prev.filter((m) => !(m.target === target && m.param === param));
      return [...filtered, next];
    });
  }, []);

  const midiUnmap = useCallback((target: string | number, param?: string) => {
    setMappings((prev) => prev.filter((m) => {
      if (m.target !== target) return true;
      return param !== undefined && m.param !== param;
    }));
  }, []);

  return {
    available,
    inputs,
    lastEvent,
    error,
    start,
    stop,
    refreshDevices,
    subscribe: subscribeMIDI,
    midiLearn,
    midiMap,
    midiUnmap,
    mappings,
    learning,
  };
}
