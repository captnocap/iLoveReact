/**
 * useVoiceInput — microphone capture + WebRTC VAD as a one-line hook.
 *
 * Hardware path is in framework/voice.zig (SDL3 mic → libfvad → utterance
 * state machine). This hook just watches the bridge globals it installs and
 * exposes a React-friendly surface.
 *
 * ── What you get back ──────────────────────────────────────────────────
 *   isListening   true between start() and stop()
 *   isSpeaking    true between speech-start and speech-end edges
 *   level         live RMS, 0..1 (square-rooted from int16 amplitude)
 *   transcript    last full-utterance text. Empty until whisper lands —
 *                 the speech-end event already fires; the transcript fills
 *                 once framework/whisper integration ships. Edits cleanly
 *                 once whisper arrives without changing the cart contract.
 *   utteranceId   id of the last finalised PCM buffer in the Zig store.
 *                 Whisper integration consumes this; carts can pass it to
 *                 a "transcribe(id)" hook once that exists.
 *   start()       opens the default recording device, begins streaming
 *   stop()        closes the device, finalises any in-flight utterance
 *
 * ── Aggressiveness ─────────────────────────────────────────────────────
 *   { mode: 0..3 } — libfvad VAD aggressiveness. 2 (default) = "aggressive",
 *   the best general-purpose setting per upstream docs. Bump to 3 if
 *   ambient noise is high; drop to 0/1 in studio-quiet rooms.
 *
 * ── Hold-to-talk vs always-on ──────────────────────────────────────────
 * Both shapes work today. Hold-to-talk: call start() onMouseDown, stop()
 * onMouseUp, ignore the speech-start/end edges. Always-on: call start()
 * once on mount, react to speech-start/end and dispatch each utterance.
 *
 * @example  hold-to-talk
 *   const v = useVoiceInput();
 *   <Pressable
 *     onPressIn={v.start}
 *     onPressOut={v.stop}
 *   ><Text>{v.isListening ? 'listening…' : 'hold to talk'}</Text></Pressable>
 *
 * @example  always-on with transcription
 *   const v = useVoiceInput();
 *   useEffect(() => { v.start(); return () => v.stop(); }, []);
 *   useEffect(() => {
 *     if (v.transcript) console.log('heard:', v.transcript);
 *   }, [v.transcript]);
 */
import { useCallback, useEffect, useState } from 'react';
import { callHost, hasHost } from '../ffi';
import { G as G_typed } from '../host-globals';
import { useLatest } from './useLatest';

// ── Bridge globals (installed by framework/voice.zig + v8_bindings_voice) ─
// Zig→JS callbacks are *assigned* to globalThis here so the Zig side can call
// back into JS. JS→Zig invocations go through callHost/hasHost.
const G = G_typed as any;

// Install the receiving callbacks once (idempotent — same pattern as useIFTTT
// guarding with __ifttt_handlers_installed). All hook instances share the
// same upstream events; per-hook subscription happens via a tiny in-module
// pub-sub table below.

type Handler = (payload?: any) => void;

const subs = {
  level: new Set<Handler>(),
  vadFrame: new Set<Handler>(),
  speechStart: new Set<Handler>(),
  speechEnd: new Set<Handler>(),
  previewReady: new Set<Handler>(),
  transcript: new Set<Handler>(),
};

function emit(set: Set<Handler>, payload?: any) {
  for (const fn of Array.from(set)) {
    try { fn(payload); } catch (e: any) {
      console.error('[voice] handler error:', e?.message || e);
    }
  }
}

if (!G.__voice_handlers_installed) {
  G.__voice_handlers_installed = true;
  G.__voice_onLevel = (rms_x100: number, vad_verdict?: number) => {
    // Zig sends two args: peak-dBFS level (0..10000, ×100 of 0..100) and the
    // raw libfvad verdict for the most recent frame (0 or 1, no debounce).
    // Older builds may send only one arg; treat undefined as 0.
    emit(subs.level, Math.max(0, Math.min(1, rms_x100 / 10000)));
    emit(subs.vadFrame, (vad_verdict ?? 0) === 1 ? 1 : 0);
  };
  G.__voice_onSpeechStart = () => emit(subs.speechStart);
  G.__voice_onSpeechEnd = (id: number, lenSamples: number) => {
    emit(subs.speechEnd, { id, lenSamples, durationMs: (lenSamples / 16000) * 1000 });
  };
  G.__voice_onPreviewReady = (id: number, lenSamples: number) => {
    emit(subs.previewReady, { id, lenSamples, durationMs: (lenSamples / 16000) * 1000 });
  };
  G.__voice_onTranscript = (text: string) => emit(subs.transcript, text);
}

// ── Public types ─────────────────────────────────────────────────────────

export interface VoiceInputResult {
  isListening: boolean;
  isSpeaking: boolean;       // debounced — gated by 90ms start / 750ms end
  vadFrame: 0 | 1;           // raw per-frame libfvad verdict, no debounce
  level: number;             // 0..1, peak-dBFS amplitude
  transcript: string;        // last finalised utterance (whisper). '' until then.
  utteranceId: number;       // 0 until first speech-end
  utteranceMs: number;       // duration of the last finalised utterance
  start: () => boolean;
  stop: () => void;
}

export interface VoiceInputOptions {
  /** libfvad aggressiveness 0..3. Default 2 ("aggressive"). */
  mode?: 0 | 1 | 2 | 3;
  /** Amplitude floor on the same 0..1 scale as `level` (peak-dBFS,
   *  -60..0 → 0..1). Frames below this are forced to silent regardless of
   *  libfvad's verdict. 0 = off (libfvad-only). Useful for rejecting
   *  mid-band ambient (typing, fans) the GMM mistakes for speech.
   *  Quick reference: -50 dBFS ≈ 0.17, -40 ≈ 0.33, -30 ≈ 0.50. */
  floor?: number;
  /** Free the captured PCM buffer after speech-end. Default true; set false
   *  if you want to call a transcribe-by-id helper before it's freed. */
  autoRelease?: boolean;
  /** Stride between live-preview snapshots while mid-utterance, in ms.
   *  The Zig side periodically copies the in-flight PCM into a stable
   *  id-keyed buffer and fires __voice_onPreviewReady so a downstream
   *  hook (e.g. useEnsembleTranscript) can transcribe it for a live
   *  preview. 0 disables. Whisper's encoder runs a fixed 30s context
   *  regardless of clip length, so don't push this below ~700ms unless
   *  you want backlog. Default undefined = leaves the Zig default
   *  (~1500ms) untouched. */
  previewStrideMs?: number;
}

/**
 * Subscribe to raw per-frame VAD verdicts (0 or 1) — every 30ms frame, no
 * debounce. Callback fires on the same tick the Zig side fires
 * `__voice_onLevel`. Returns an unsubscribe function. Useful for trace-style
 * visualisations where you want to see each individual frame.
 *
 * The hook's `vadFrame` field gives you the latest value but React bails out
 * when consecutive identical values come in, so a 60-frame run of silence
 * triggers one re-render. Subscribe directly when you need every event.
 */
export function subscribeRawVadFrame(fn: (v: 0 | 1) => void): () => void {
  const wrapper: Handler = (v) => fn(v ? 1 : 0);
  subs.vadFrame.add(wrapper);
  return () => { subs.vadFrame.delete(wrapper); };
}

/** Subscribe to every level update (peak-dBFS, 0..1). See subscribeRawVadFrame
 *  rationale — useful when you want the full sample stream for a trace. */
export function subscribeRawLevel(fn: (level: number) => void): () => void {
  const wrapper: Handler = (v) => fn(typeof v === 'number' ? v : 0);
  subs.level.add(wrapper);
  return () => { subs.level.delete(wrapper); };
}

/** Subscribe to live-preview snapshots fired while the user is mid-utterance.
 *  Each event carries an id keyed into the same buffer store as speech-end —
 *  call `transcribe(id, modelPath)` on it for a fast preview, then
 *  `__voice_release_buffer(id)` once the result lands. The hook does not
 *  auto-release preview buffers because the consumer (e.g. ensemble) is
 *  responsible for the transcribe-then-release lifecycle. */
export function subscribePreview(
  fn: (e: { id: number; lenSamples: number; durationMs: number }) => void,
): () => void {
  const wrapper: Handler = (v) => fn(v);
  subs.previewReady.add(wrapper);
  return () => { subs.previewReady.delete(wrapper); };
}

/** Subscribe to confirmed speech-start edges (post-debounce). Useful for
 *  resetting derived state — e.g. clearing a stale live-preview the moment a
 *  new utterance begins, before the first preview chunk lands. */
export function subscribeSpeechStart(fn: () => void): () => void {
  const wrapper: Handler = () => fn();
  subs.speechStart.add(wrapper);
  return () => { subs.speechStart.delete(wrapper); };
}

// ── The hook ─────────────────────────────────────────────────────────────

export function useVoiceInput(opts: VoiceInputOptions = {}): VoiceInputResult {
  const [isListening, setListening] = useState(false);
  const [isSpeaking, setSpeaking] = useState(false);
  const [vadFrame, setVadFrame] = useState<0 | 1>(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [utterance, setUtterance] = useState({ id: 0, ms: 0 });

  const autoRelease = opts.autoRelease !== false;
  const autoReleaseRef = useLatest(autoRelease);

  // Mode application: re-apply on change (cheap, fvad_set_mode only flips an int).
  useEffect(() => {
    callHost('__voice_set_mode', undefined, opts.mode ?? 2);
  }, [opts.mode]);

  // Amplitude floor: convert 0..1 → 0..10000 for the Zig side.
  useEffect(() => {
    if (!hasHost('__voice_set_floor')) return;
    const f = Math.max(0, Math.min(1, opts.floor ?? 0));
    callHost('__voice_set_floor', undefined, Math.round(f * 10000));
  }, [opts.floor]);

  // Live-preview stride: forward to Zig if the cart specified one. Skip
  // when undefined so the Zig default (DEFAULT_PREVIEW_STRIDE_FRAMES, ~1.5s)
  // stays in effect — VAD-only carts get zero overhead.
  useEffect(() => {
    if (opts.previewStrideMs === undefined) return;
    if (!hasHost('__voice_set_preview_stride_ms')) return;
    callHost('__voice_set_preview_stride_ms', undefined, Math.max(0, Math.round(opts.previewStrideMs)));
  }, [opts.previewStrideMs]);

  // Subscribe to bridge events for this instance's lifetime.
  useEffect(() => {
    const onLevel: Handler = (v) => setLevel(v);
    const onVadFrame: Handler = (v) => setVadFrame(v ? 1 : 0);
    const onSpeechStart: Handler = () => setSpeaking(true);
    const onSpeechEnd: Handler = (e: { id: number; lenSamples: number; durationMs: number }) => {
      setSpeaking(false);
      setUtterance({ id: e.id, ms: e.durationMs });
      if (autoReleaseRef.current) callHost('__voice_release_buffer', undefined, e.id);
    };
    const onTranscript: Handler = (text) => setTranscript(String(text ?? ''));

    subs.level.add(onLevel);
    subs.vadFrame.add(onVadFrame);
    subs.speechStart.add(onSpeechStart);
    subs.speechEnd.add(onSpeechEnd);
    subs.transcript.add(onTranscript);
    return () => {
      subs.level.delete(onLevel);
      subs.vadFrame.delete(onVadFrame);
      subs.speechStart.delete(onSpeechStart);
      subs.speechEnd.delete(onSpeechEnd);
      subs.transcript.delete(onTranscript);
    };
  }, []);

  const start = useCallback(() => {
    if (!hasHost('__voice_start')) {
      console.warn('[voice] __voice_start missing — was -Dhas-voice=true set?');
      return false;
    }
    const ok = !!callHost('__voice_start', false);
    if (ok) setListening(true);
    return ok;
  }, []);

  const stop = useCallback(() => {
    callHost('__voice_stop', undefined);
    setListening(false);
    setSpeaking(false);
    setLevel(0);
  }, []);

  return {
    isListening,
    isSpeaking,
    vadFrame,
    level,
    transcript,
    utteranceId: utterance.id,
    utteranceMs: utterance.ms,
    start,
    stop,
  };
}
