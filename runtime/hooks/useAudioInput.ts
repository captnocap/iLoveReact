/**
 * useAudioInput — unified mic-input surface, gated by `kind`.
 *
 * Two specialized backends share this hook:
 *   - kind: 'voice' (default) — VAD-gated, utterance-shaped, 16kHz mono.
 *     Routes to useVoiceInput; what whisper consumes. Existing callers
 *     that pass no `kind` get this behavior exactly as before.
 *   - kind: 'raw'              — no VAD, 44.1kHz mono, one accumulator
 *     buffer per recording. Routes to useRawCapture. For music sampling.
 *
 * Device enumeration is shared regardless of kind (both backends pull
 * from the same SDL3 default-recording device pool).
 *
 * IMPORTANT: We don't reuse `mode` for the voice/raw discriminator —
 * VoiceInputOptions.mode is the libfvad aggressiveness (0..3). The new
 * `kind` field disambiguates the backend without colliding.
 */
import { useCallback, useEffect, useState } from 'react';
import { useVoiceInput, type VoiceInputOptions, type VoiceInputResult } from './useVoiceInput';
import { useRawCapture, type RawCaptureOptions, type RawCaptureResult } from './useRawCapture';
import { callHostJson, hasHost } from '../ffi';

// ── Devices (shared) ─────────────────────────────────────────────────

export interface AudioInputDevice {
  id: number;
  name: string;
}

/** Playback (output) device — speakers/headphones/HDMI. Carts pair these
 *  with a corresponding loopback recording device to offer "capture from
 *  this speaker" affordances. */
export interface AudioOutputDevice {
  id: number;
  name: string;
}

function readDevices(): AudioInputDevice[] {
  // Two registered names — newer audio_input subsystem vs. older voice-only one.
  const name = hasHost('__audio_input_devices_json')
    ? '__audio_input_devices_json'
    : '__voice_recording_devices_json';
  if (!hasHost(name)) return [];
  const parsed = callHostJson<unknown[]>(name, []);
  return Array.isArray(parsed) ? parsed.map((d: any) => ({
    id: Number(d.id || 0),
    name: String(d.name || ''),
  })) : [];
}

function readOutputDevices(): AudioOutputDevice[] {
  if (!hasHost('__audio_output_devices_json')) return [];
  const parsed = callHostJson<unknown[]>('__audio_output_devices_json', []);
  return Array.isArray(parsed) ? parsed.map((d: any) => ({
    id: Number(d.id || 0),
    name: String(d.name || ''),
  })) : [];
}

interface DeviceSurface {
  devices: AudioInputDevice[];
  refreshDevices: () => AudioInputDevice[];
  /** Playback devices — the speakers/headphones/HDMI sinks the OS exposes.
   *  Use alongside `devices` to pair each output with its loopback source. */
  outputDevices: AudioOutputDevice[];
  refreshOutputDevices: () => AudioOutputDevice[];
}

// ── Options ──────────────────────────────────────────────────────────

export type VoiceAudioInputOptions = VoiceInputOptions & {
  /** Discriminator. Default 'voice'. */
  kind?: 'voice';
  /** Begin voice listening on mount; stop on unmount. */
  autoStart?: boolean;
};

export type RawAudioInputOptions = RawCaptureOptions & {
  kind: 'raw';
};

export type AudioInputOptions = VoiceAudioInputOptions | RawAudioInputOptions;

// ── Return shapes ────────────────────────────────────────────────────

export type VoiceAudioInputHandle = VoiceInputResult & DeviceSurface & {
  kind: 'voice';
};

export type RawAudioInputHandle = RawCaptureResult & DeviceSurface & {
  kind: 'raw';
};

/**
 * Default handle alias preserved for callers that imported `AudioInputHandle`
 * back when this hook was voice-only. New code should prefer
 * VoiceAudioInputHandle / RawAudioInputHandle for explicit narrowing.
 */
export type AudioInputHandle = VoiceAudioInputHandle;

// ── Hook ─────────────────────────────────────────────────────────────

export function useAudioInput(): VoiceAudioInputHandle;
export function useAudioInput(opts: VoiceAudioInputOptions): VoiceAudioInputHandle;
export function useAudioInput(opts: RawAudioInputOptions): RawAudioInputHandle;
export function useAudioInput(opts: AudioInputOptions = {}): VoiceAudioInputHandle | RawAudioInputHandle {
  const kind: 'voice' | 'raw' = (opts as any).kind === 'raw' ? 'raw' : 'voice';

  // Both hooks are called unconditionally to satisfy the rules of hooks.
  // The inactive one is harmless — neither opens an SDL stream until its
  // own start() is invoked.
  const voice = useVoiceInput(kind === 'voice' ? (opts as VoiceInputOptions) : {});
  const raw = useRawCapture(kind === 'raw' ? (opts as RawCaptureOptions) : {});

  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const refreshDevices = useCallback(() => {
    const next = readDevices();
    setDevices(next);
    return next;
  }, []);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const refreshOutputDevices = useCallback(() => {
    const next = readOutputDevices();
    setOutputDevices(next);
    return next;
  }, []);
  useEffect(() => {
    refreshDevices();
    refreshOutputDevices();
  }, [refreshDevices, refreshOutputDevices]);

  // Voice autoStart preserved exactly as before. Raw autoStart is owned
  // by useRawCapture itself (it can only start; stop needs a path the
  // cart provides, so we don't auto-stop here).
  const voiceAutoStart = kind === 'voice' && !!(opts as VoiceAudioInputOptions).autoStart;
  useEffect(() => {
    if (!voiceAutoStart) return;
    voice.start();
    return () => voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAutoStart]);

  if (kind === 'raw') {
    return {
      kind: 'raw',
      ...raw,
      devices,
      refreshDevices,
      outputDevices,
      refreshOutputDevices,
    };
  }
  return {
    kind: 'voice',
    ...voice,
    devices,
    refreshDevices,
    outputDevices,
    refreshOutputDevices,
  };
}
