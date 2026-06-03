// compiler.ts — text → live audio dispatch.
//
// The user's editor text is treated as a function body executed inside
// a sandboxed environment where the EarSketch-shaped API is bound as
// globals (setTempo, makeBeat, loadSound, …) along with built-in synth
// constants (kick / snare / hat / bass / lead) and project sample ids
// (whatever the user named entries in the library).
//
// Compile flow:
//   1. Stop transport, clear every track — wipe stale arrangement.
//   2. Pre-load all project samples; build { id → handle } map.
//   3. Wrap user text in `new Function(...sandboxKeys, text)`.
//   4. Invoke it with the sandbox values.
//   5. On success: resume play. On error: leave audio silent + return
//      the error message for the editor gutter.

import { AUDIO_SOUND, type AudioHandle, type AudioSound } from '@reactjit/audio';
import type { SampleRef } from './domain';

const MAX_TRACKS_TO_CLEAR = 16;

export interface CompileContext {
  audio: AudioHandle;
  samples: SampleRef[];
}

export interface CompileResult {
  ok: boolean;
  error?: string;
  /** Names bound into the sandbox at compile time — useful for the
   *  library UI to show the user "what's available right now". */
  bindings: string[];
  /** User-code scheduling calls captured during compile. This feeds the
   *  timeline UI; audio remains the source of truth for playback. */
  events: TimelineEvent[];
}

export interface TimelineEvent {
  kind: 'pattern' | 'media' | 'section';
  track: number;
  start: number;
  end: number;
  label: string;
}

export function compileAndRun(text: string, ctx: CompileContext): CompileResult {
  const { audio, samples } = ctx;

  // Stop + clear every track so a recompile starts from silence rather
  // than layering on top of the previous pattern.
  audio.stop();
  for (let t = 0; t < MAX_TRACKS_TO_CLEAR; t++) audio.clearTrack(t);

  // Pre-load samples. Failures here are silent — the user gets a
  // ReferenceError when they reference an unloaded id, which is the
  // clearer signal.
  const sampleBindings: Record<string, number> = {};
  const soundLabels = new Map<unknown, string>([
    [AUDIO_SOUND.kick, 'kick'],
    [AUDIO_SOUND.snare, 'snare'],
    [AUDIO_SOUND.hat, 'hat'],
    [AUDIO_SOUND.bass, 'bass'],
    [AUDIO_SOUND.lead, 'lead'],
  ]);
  for (const s of samples) {
    try {
      const handle = audio.loadSound(s.path);
      if (handle > 0) {
        sampleBindings[s.id] = handle;
        soundLabels.set(handle, s.id);
      }
    } catch {
      // skip; the user will see the missing-id ReferenceError at compile
    }
  }
  const events: TimelineEvent[] = [];

  const record = (event: TimelineEvent) => {
    if (!Number.isFinite(event.track) || !Number.isFinite(event.start) || !Number.isFinite(event.end)) return;
    events.push({
      ...event,
      track: Math.max(0, Math.floor(event.track)),
      start: Math.max(1, event.start),
      end: Math.max(event.start + 0.25, event.end),
    });
  };

  const soundLabel = (sound: unknown): string => {
    if (Array.isArray(sound)) return sound.map(soundLabel).join('+');
    return soundLabels.get(sound) ?? 'sound';
  };

  // Sandbox surface. The EarSketch idiom is global-flat: every entry
  // here becomes a top-level binding in the user's code via
  // `new Function(...keys, body)`.
  const sandbox: Record<string, unknown> = {
    // Transport
    setTempo: (bpm: number, start = 1, endBpm?: number, end?: number) =>
      audio.setTempo(bpm, start, endBpm, end),
    play: () => audio.play(),
    pause: () => audio.pause(),
    stop: () => audio.stop(),
    setPlayhead: (m: number) => audio.setPlayhead(m),

    // Patterns
    makeBeat: (sound: AudioSound, track: number, start: number, beat: string, steps = 16) => {
      record({ kind: 'pattern', track, start, end: start + Math.max(1, beat.length / Math.max(1, steps)), label: soundLabel(sound) });
      return audio.makeBeat(sound, track, start, beat, steps);
    },
    makePattern: (sound: AudioSound, track: number, start: number, pattern: string, steps = 16) => {
      record({ kind: 'pattern', track, start, end: start + Math.max(1, pattern.length / Math.max(1, steps)), label: soundLabel(sound) });
      return audio.makePattern(sound, track, start, pattern, steps);
    },
    makeBeatSlice: (sound: number, track: number, start: number, beat: string, slices: number[], steps = 16) => {
      record({ kind: 'pattern', track, start, end: start + Math.max(1, beat.length / Math.max(1, steps)), label: `${soundLabel(sound)} slice` });
      return audio.makeBeatSlice(sound, track, start, beat, slices, steps);
    },

    // Media
    insertMedia: (sound: number, track: number, start: number) => {
      record({ kind: 'media', track, start, end: start + Math.max(0.25, audio.dur(sound) || 1), label: soundLabel(sound) });
      return audio.insertMedia(sound, track, start);
    },
    fitMedia: (sound: number, track: number, start: number, end: number) => {
      record({ kind: 'media', track, start, end, label: soundLabel(sound) });
      return audio.fitMedia(sound, track, start, end);
    },
    insertMediaSection: (sound: number, track: number, start: number, sliceStart: number, sliceEnd: number) => {
      record({ kind: 'section', track, start, end: start + Math.max(0.25, sliceEnd - sliceStart), label: soundLabel(sound) });
      return audio.insertMediaSection(sound, track, start, sliceStart, sliceEnd);
    },

    // Sample handles
    loadSound: (path: string) => audio.loadSound(path),
    createAudioSlice: (sound: number, start: number, end: number) =>
      audio.createAudioSlice(sound, start, end),
    createAudioStretch: (sound: number, factor: number) =>
      audio.createAudioStretch(sound, factor),
    dur: (sound: number) => audio.dur(sound),

    // Tracks
    setTrackVolume: (track: number, volume: number) => audio.setTrackVolume(track, volume),
    setTrackPan: (track: number, pan: number) => audio.setTrackPan(track, pan),
    setTrackMute: (track: number, muted: boolean) => audio.setTrackMute(track, muted),
    setTrackSolo: (track: number, soloed: boolean) => audio.setTrackSolo(track, soloed),

    // Per-step humanization
    setStepVelocity: (track: number, step: number, velocity: number) =>
      audio.setStepVelocity(track, step, velocity),
    setStepProbability: (track: number, step: number, p: number) =>
      audio.setStepProbability(track, step, p),
    setStepOffset: (track: number, step: number, offset: number) =>
      audio.setStepOffset(track, step, offset),

    // Master
    setMasterVolume: (v: number) => audio.setMasterVolume(v),

    // Built-in synth constants
    kick: AUDIO_SOUND.kick,
    snare: AUDIO_SOUND.snare,
    hat: AUDIO_SOUND.hat,
    bass: AUDIO_SOUND.bass,
    lead: AUDIO_SOUND.lead,

    // Project sample bindings (id → handle)
    ...sampleBindings,
  };

  const keys = Object.keys(sandbox);
  const values = keys.map((k) => sandbox[k]);

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict";\n${text}`);
    fn(...values);
    audio.play();
    return { ok: true, bindings: keys, events };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.message || String(err), bindings: keys, events };
  }
}

/** The static surface of the sandbox — names that are ALWAYS bound,
 *  independent of the project's sample library. Useful for an
 *  autocomplete pass that doesn't want to also depend on the
 *  project-specific sample ids. */
export const STATIC_SANDBOX_NAMES: ReadonlyArray<string> = [
  'setTempo', 'play', 'pause', 'stop', 'setPlayhead',
  'makeBeat', 'makePattern', 'makeBeatSlice',
  'insertMedia', 'fitMedia', 'insertMediaSection',
  'loadSound', 'createAudioSlice', 'createAudioStretch', 'dur',
  'setTrackVolume', 'setTrackPan', 'setTrackMute', 'setTrackSolo',
  'setStepVelocity', 'setStepProbability', 'setStepOffset',
  'setMasterVolume',
  'kick', 'snare', 'hat', 'bass', 'lead',
];
