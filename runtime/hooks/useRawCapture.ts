/**
 * useRawCapture — raw microphone capture for music sampling.
 *
 * Sibling to useVoiceInput. Same SDL3 input source, but bypasses VAD
 * entirely and writes the whole recording to a WAV file at the audio
 * framework's playback rate (44.1kHz mono 16-bit PCM) so captured
 * clips drop directly into audio.loadSound() without resampling.
 *
 * Backend lives in framework/audio_input/audio_input.zig. Bindings
 * are __rawCapture_* — gated by the metafile-gate via this hook's
 * import path (declared in sdk/dependency-registry.json:audio_input).
 *
 * Lifecycle:
 *   start()        opens the default recording device + begins streaming
 *   stop(path)     closes the device, writes WAV at `path`, returns true on success
 *
 * The cart is responsible for picking `path` (typically under its own
 * project sidecar dir) and for any post-stop bookkeeping (registering
 * the new file in a sample library, etc.). This hook is intentionally
 * thin — it doesn't own a sample registry.
 *
 * Co-exists with useVoiceInput: SDL3 arbitrates the underlying device
 * when both streams are open. Practical use case: voice for transcript
 * UX in one cart, raw capture for sampling in another, both available
 * simultaneously without the surfaces fighting.
 */
import { useCallback, useEffect, useState } from 'react';
import { callHost, hasHost } from '../ffi';
import { G as G_typed } from '../host-globals';

// Zig→JS dispatch hooks (assigned on globalThis so the Zig side can call back).
const G = G_typed as any;

// Install the level-event callback once. The hook just subscribes to
// the shared event the Zig side fires; no per-instance globals.
type LevelHandler = (level: number) => void;
const levelSubs = new Set<LevelHandler>();

if (!G.__rawCapture_handlers_installed) {
  G.__rawCapture_handlers_installed = true;
  G.__rawCapture_onLevel = (level_x100: number) => {
    const v = Math.max(0, Math.min(1, level_x100 / 10000));
    for (const fn of Array.from(levelSubs)) {
      try { fn(v); } catch (e: any) {
        console.error('[rawCapture] level handler error:', e?.message || e);
      }
    }
  };
}

export interface RawCaptureResult {
  /** True between start() and stop(). */
  isRecording: boolean;
  /** Live peak-dBFS level, 0..1. Same scale as useVoiceInput.level so
   *  cart-side meters share calibration. */
  level: number;
  /** True if the last recording hit the 10-minute cap. UI should warn. */
  wasCapped: boolean;
  /** Open the mic + begin recording. Returns true on success. Pass a
   *  `deviceId` from the shared enumeration (useAudioInput().devices,
   *  or `__audio_input_devices_json`) to target a specific source —
   *  monitor / loopback devices appear here too on PipeWire / PulseAudio,
   *  letting carts capture system audio output rather than the mic.
   *  Omit (or pass 0) for the SDL3 default recording device. */
  start: (deviceId?: number) => boolean;
  /** Close the mic, write the accumulated buffer as a WAV at `path`.
   *  Returns true on successful write. Buffer is cleared regardless so
   *  a failure doesn't pin memory. Safe to call when not recording —
   *  returns false in that case. */
  stop: (path: string) => boolean;
}

export interface RawCaptureOptions {
  /** Begin recording on mount. Stops on unmount. Default false. */
  autoStart?: boolean;
}

/** Subscribe to raw level updates outside the React render cycle.
 *  Useful for trace-style visualisations that don't want a re-render
 *  per frame. Returns an unsubscribe function. */
export function subscribeRawCaptureLevel(fn: (level: number) => void): () => void {
  levelSubs.add(fn);
  return () => { levelSubs.delete(fn); };
}

export function useRawCapture(opts: RawCaptureOptions = {}): RawCaptureResult {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [wasCapped, setWasCapped] = useState(false);

  useEffect(() => {
    const onLevel: LevelHandler = (v) => setLevel(v);
    levelSubs.add(onLevel);
    return () => { levelSubs.delete(onLevel); };
  }, []);

  const start = useCallback((deviceId?: number): boolean => {
    if (!hasHost('__rawCapture_start')) {
      console.warn('[rawCapture] __rawCapture_start missing — was -Dhas-audio-input=true set?');
      return false;
    }
    // 0 (or missing) tells the Zig side to use SDL_AUDIO_DEVICE_DEFAULT_RECORDING.
    const id = typeof deviceId === 'number' && deviceId > 0 ? deviceId : 0;
    const ok = !!callHost('__rawCapture_start', false, id);
    if (ok) {
      setIsRecording(true);
      setWasCapped(false);
    }
    return ok;
  }, []);

  const stop = useCallback((path: string): boolean => {
    if (!hasHost('__rawCapture_stop')) return false;
    const ok = !!callHost('__rawCapture_stop', false, path);
    setIsRecording(false);
    setLevel(0);
    if (hasHost('__rawCapture_wasCapped')) setWasCapped(!!callHost('__rawCapture_wasCapped', false));
    return ok;
  }, []);

  // autoStart — symmetry with useAudioInput. The cart owns the WAV
  // path for stop(), so autoStart on its own can only start, not
  // round-trip; carts wanting auto-recording-with-path need to handle
  // stop themselves.
  useEffect(() => {
    if (!opts.autoStart) return;
    start();
  }, [opts.autoStart, start]);

  return { isRecording, level, wasCapped, start, stop };
}
