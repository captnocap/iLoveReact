/**
 * Audio — declarative wrapper around framework/audio.zig.
 *
 * The Zig audio engine runs at 44.1 kHz with up to 64 modules and 256
 * connections, driven by a lock-free SPSC command queue. JS pushes
 * add/remove/connect/disconnect/set_param/note_on/note_off/master_gain
 * commands; the audio thread consumes them between callbacks.
 *
 * React surface (mirrors the Physics namespace pattern):
 *
 *   <Audio gain={0.8}>
 *     <Audio.Module id="voice1" type="instrument" tone={0.5} drive={0.3} />
 *     <Audio.Module id="delay1" type="delay" feedback={0.4} time={0.25} />
 *     <Audio.Module id="mixer1" type="mixer" />
 *     <Audio.Connection from="voice1" to="delay1" />
 *     <Audio.Connection from="delay1" to="mixer1" toPort={0} />
 *   </Audio>
 *
 *   // Notes don't fit a declarative tree — go through the hook.
 *   const audio = useAudio();
 *   audio.noteOn('voice1', 60);   // 'voice1' resolves through the <Audio> ctx
 *
 * Lifecycle wiring:
 *   <Audio>           mount   →                                          (engine auto-inits on first add)
 *                     prop    → __audioMasterGain(gain)
 *   <Audio.Module>    mount   → __audioAddModule(idNum, typeNum)
 *                     unmount → __audioRemoveModule(idNum)
 *                     props   → __audioSetParam(idNum, paramIdx, value) per typed param
 *   <Audio.Connection> mount  → __audioConnect(fromNum, fromPort, toNum, toPort)
 *                     unmount → __audioDisconnect(...)
 *
 * Host bindings used here are registered in framework/v8_bindings_core.zig:
 *   __audioAddModule  __audioRemoveModule  __audioConnect  __audioDisconnect
 *   __audioSetParam   __audioNoteOn        __audioNoteOff  __audioMasterGain
 *   __audioSetTempo   __audioMakeBeat      __audioMakeBeatSlice
 *   __audioInsertMedia __audioFitMedia     __audioDur
 *   __audioInsertMediaSection __audioClearTrack
 *   __audioSetTrackVolume __audioSetTrackPan __audioSetTrackMute
 *   __audioSetTrackSolo __audioCreateAudioStretch
 *   __audioCreateAudioSlice __audioLoadSample __audioClearSample
 *
 * Lifecycle is exposed through the hook as initAudio/deinitAudio so carts do
 * not need to reach through globalThis directly.
 */

const React = require('react');

// ── Module-type enum (matches framework/audio.zig:ModuleType) ─────────

export const AUDIO_MODULE_TYPE = {
  oscillator:   0,
  filter:       1,
  amplifier:    2,
  mixer:        3,
  delay:        4,
  envelope:     5,
  lfo:          6,
  sequencer:    7,
  sampler:      8,
  custom:       9,
  instrument:   10,
  clock:        11,
} as const;

export type AudioModuleType = keyof typeof AUDIO_MODULE_TYPE;

export const AUDIO_SOUND = {
  kick: 0,
  snare: 1,
  hat: 2,
  bass: 3,
  lead: 4,
} as const;

export type AudioSound = number | readonly number[];
export type AudioParamDefinition = {
  name: string;
  index: number;
  min: number;
  max: number;
  defaultValue: number;
};

// ── Per-module-type param-name → index map (matches audio.zig:moduleSetup) ──
//
// Carts pass params on <Audio.Module> by NAME (`feedback={0.4}`); we look up
// the numeric index via this table before calling __audioSetParam. Order is
// authoritative — it must match `addParam(...)` call order in audio.zig.
export const AUDIO_PARAM_DEFS: Record<AudioModuleType, AudioParamDefinition[]> = {
  oscillator: [
    { name: 'waveform', index: 0, min: 0, max: 4, defaultValue: 0 },
    { name: 'frequency', index: 1, min: 20, max: 20000, defaultValue: 440 },
    { name: 'detune', index: 2, min: -1200, max: 1200, defaultValue: 0 },
    { name: 'gain', index: 3, min: 0, max: 1, defaultValue: 0.5 },
    { name: 'fm_amount', index: 4, min: 0, max: 1, defaultValue: 0 },
  ],
  filter: [
    { name: 'cutoff', index: 0, min: 20, max: 20000, defaultValue: 1200 },
    { name: 'resonance', index: 1, min: 0, max: 1, defaultValue: 0.1 },
    { name: 'mode', index: 2, min: 0, max: 2, defaultValue: 0 },
  ],
  amplifier: [
    { name: 'gain', index: 0, min: 0, max: 1, defaultValue: 0.5 },
  ],
  mixer: [
    { name: 'gain_1', index: 0, min: 0, max: 1, defaultValue: 1 },
    { name: 'gain_2', index: 1, min: 0, max: 1, defaultValue: 1 },
    { name: 'gain_3', index: 2, min: 0, max: 1, defaultValue: 1 },
    { name: 'gain_4', index: 3, min: 0, max: 1, defaultValue: 1 },
  ],
  delay: [
    { name: 'time', index: 0, min: 0, max: 2, defaultValue: 0.25 },
    { name: 'feedback', index: 1, min: 0, max: 0.95, defaultValue: 0.3 },
    { name: 'mix', index: 2, min: 0, max: 1, defaultValue: 0.25 },
  ],
  envelope: [
    { name: 'attack', index: 0, min: 0, max: 5, defaultValue: 0.01 },
    { name: 'decay', index: 1, min: 0, max: 5, defaultValue: 0.2 },
    { name: 'sustain', index: 2, min: 0, max: 1, defaultValue: 0.8 },
    { name: 'release', index: 3, min: 0, max: 5, defaultValue: 0.3 },
  ],
  lfo: [
    { name: 'rate', index: 0, min: 0.01, max: 20, defaultValue: 1 },
    { name: 'depth', index: 1, min: 0, max: 1, defaultValue: 0.5 },
    { name: 'waveform', index: 2, min: 0, max: 4, defaultValue: 0 },
  ],
  clock: [
    { name: 'bpm', index: 0, min: 20, max: 300, defaultValue: 120 },
    { name: 'division', index: 1, min: 0, max: 5, defaultValue: 1 },
    { name: 'swing', index: 2, min: 0, max: 1, defaultValue: 0 },
    { name: 'running', index: 3, min: 0, max: 1, defaultValue: 0 },
  ],
  sequencer: [
    { name: 'steps', index: 0, min: 1, max: 64, defaultValue: 16 },
    { name: 'tracks', index: 1, min: 1, max: 8, defaultValue: 4 },
    { name: 'bpm', index: 2, min: 20, max: 300, defaultValue: 120 },
    { name: 'running', index: 3, min: 0, max: 1, defaultValue: 1 },
  ],
  sampler: [
    { name: 'gain', index: 0, min: 0, max: 1, defaultValue: 1 },
    { name: 'loop', index: 1, min: 0, max: 1, defaultValue: 0 },
    { name: 'slot', index: 2, min: 1, max: 16, defaultValue: 1 },
  ],
  custom: [],
  instrument: [
    { name: 'voice', index: 0, min: 0, max: 4, defaultValue: 0 },
    { name: 'tone', index: 1, min: 0, max: 1, defaultValue: 0.5 },
    { name: 'decay', index: 2, min: 0.05, max: 1, defaultValue: 0.35 },
    { name: 'color', index: 3, min: 0, max: 1, defaultValue: 0.5 },
    { name: 'drive', index: 4, min: 0, max: 1, defaultValue: 0.25 },
    { name: 'gain', index: 5, min: 0, max: 1.5, defaultValue: 0.8 },
  ],
};

const AUDIO_PARAM_INDEX = Object.fromEntries(
  (Object.keys(AUDIO_PARAM_DEFS) as AudioModuleType[]).map((type) => [
    type,
    Object.fromEntries(AUDIO_PARAM_DEFS[type].map((def) => [def.name, def.index])),
  ]),
) as Record<AudioModuleType, Record<string, number>>;

const AUDIO_MODULE_TYPE_BY_ID = Object.fromEntries(
  (Object.keys(AUDIO_MODULE_TYPE) as AudioModuleType[]).map((type) => [AUDIO_MODULE_TYPE[type], type]),
) as Record<number, AudioModuleType>;

// ── Host bridges ──────────────────────────────────────────────────────

const host = (): any => globalThis as any;

const hostAdd          = (id: number, mt: number) => host().__audioAddModule?.(id, mt);
const hostRemove       = (id: number) => host().__audioRemoveModule?.(id);
const hostConnect      = (a: number, ap: number, b: number, bp: number) => host().__audioConnect?.(a, ap, b, bp);
const hostDisconnect   = (a: number, ap: number, b: number, bp: number) => host().__audioDisconnect?.(a, ap, b, bp);
const hostSetParam     = (id: number, p: number, v: number) => host().__audioSetParam?.(id, p, v);
const hostNoteOn       = (id: number, midi: number, velocity = 1) => host().__audioNoteOn?.(id, midi, velocity);
const hostNoteOff      = (id: number, midi?: number) => host().__audioNoteOff?.(id, midi);
const hostMasterGain   = (g: number) => host().__audioMasterGain?.(g);
const hostInitAudio    = (): boolean => {
  const h = host();
  const init = h.__audioInit ?? h.__audio_init;
  const isInitialized = h.__audioIsInitialized ?? h.__audio_is_initialized;
  const resume = h.__audioResume ?? h.__audio_resume;
  const ok = typeof init === 'function'
    ? Number(init() ?? 0) > 0
    : Number(isInitialized?.() ?? 0) > 0;
  if (ok && typeof resume === 'function') resume();
  return ok;
};
const hostDeinitAudio  = () => {
  const h = host();
  const fn = h.__audioDeinit ?? h.__audio_deinit;
  return typeof fn === 'function' ? fn() : 0;
};
const hostIsAudioInitialized = (): boolean => Boolean(Number((host().__audioIsInitialized ?? host().__audio_is_initialized)?.() ?? 0));
const hostPlay         = () => {
  const fn = host().__audioPlay ?? host().__audio_play;
  return typeof fn === 'function' ? fn() : 0;
};
const hostPauseTransport = () => {
  const fn = host().__audioPause ?? host().__audio_transport_pause;
  return typeof fn === 'function' ? fn() : 0;
};
const hostStop         = () => {
  const fn = host().__audioStop ?? host().__audio_stop;
  return typeof fn === 'function' ? fn() : 0;
};
const hostSetPlayhead  = (measure: number) => {
  const fn = host().__audioSetPlayhead ?? host().__audio_set_playhead;
  return typeof fn === 'function' ? fn(measure) : 0;
};
const hostGetPlayhead  = (): number => Number((host().__audioGetPlayhead ?? host().__audio_get_playhead)?.() ?? 1);
const hostIsPlaying    = (): boolean => Boolean(Number((host().__audioIsPlaying ?? host().__audio_is_playing)?.() ?? 0));
const hostSetTempo     = (startTempo: number, start: number, endTempo?: number, end?: number) => {
  const fn = host().__audioSetTempo ?? host().__audio_set_tempo;
  if (typeof fn !== 'function') return 0;
  if (typeof endTempo === 'number' && typeof end === 'number') return fn(startTempo, start, endTempo, end);
  return fn(startTempo, start);
};
const hostMakeBeat     = (soundSpec: string, track: number, start: number, beat: string, stepsPerMeasure: number) => {
  const fn = host().__audioMakeBeat ?? host().__audio_make_beat;
  return typeof fn === 'function' ? fn(soundSpec, track, start, beat, stepsPerMeasure) : 0;
};
const hostMakeBeatSlice = (soundSpec: string, track: number, start: number, beat: string, sliceSpec: string, stepsPerMeasure: number) => {
  const fn = host().__audioMakeBeatSlice ?? host().__audio_make_beat_slice;
  return typeof fn === 'function' ? fn(soundSpec, track, start, beat, sliceSpec, stepsPerMeasure) : 0;
};
const hostSetStepVelocity = (track: number, step: number, velocity: number) => {
  const fn = host().__audioSetStepVelocity ?? host().__audio_set_step_velocity;
  return typeof fn === 'function' ? fn(track, step, velocity) : 0;
};
const hostSetStepProbability = (track: number, step: number, probability: number) => {
  const fn = host().__audioSetStepProbability ?? host().__audio_set_step_probability;
  return typeof fn === 'function' ? fn(track, step, probability) : 0;
};
const hostSetStepOffset = (track: number, step: number, offset: number) => {
  const fn = host().__audioSetStepOffset ?? host().__audio_set_step_offset;
  return typeof fn === 'function' ? fn(track, step, offset) : 0;
};
const hostSetStep = (id: number, track: number, step: number, active: boolean, note = 36, velocity = 100) => {
  const fn = host().__audioSetStep ?? host().__audio_set_step;
  return typeof fn === 'function' ? fn(id, track, step, active ? 1 : 0, note, velocity) : 0;
};
const hostSetTrackTarget = (id: number, track: number, target: number) => {
  const fn = host().__audioSetTrackTarget ?? host().__audio_set_track_target;
  return typeof fn === 'function' ? fn(id, track, target) : 0;
};
const hostClearPattern = (id: number) => {
  const fn = host().__audioClearPattern ?? host().__audio_clear_pattern;
  return typeof fn === 'function' ? fn(id) : 0;
};
const hostClockPulse = (id = 0) => {
  const fn = host().__audioClockPulse ?? host().__audio_clock_pulse;
  return typeof fn === 'function' ? fn(id) : 0;
};
const hostClockStart = (id = 0) => {
  const fn = host().__audioClockStart ?? host().__audio_clock_start;
  return typeof fn === 'function' ? fn(id) : 0;
};
const hostClockStop = (id = 0) => {
  const fn = host().__audioClockStop ?? host().__audio_clock_stop;
  return typeof fn === 'function' ? fn(id) : 0;
};
const hostInsertMedia  = (soundSpec: string, track: number, start: number) => {
  const fn = host().__audioInsertMedia ?? host().__audio_insert_media;
  return typeof fn === 'function' ? fn(soundSpec, track, start) : 0;
};
const hostFitMedia     = (soundSpec: string, track: number, start: number, end: number) => {
  const fn = host().__audioFitMedia ?? host().__audio_fit_media;
  return typeof fn === 'function' ? fn(soundSpec, track, start, end) : 0;
};
const hostInsertMediaSection = (soundSpec: string, track: number, start: number, sliceStart: number, sliceEnd: number) => {
  const fn = host().__audioInsertMediaSection ?? host().__audio_insert_media_section;
  return typeof fn === 'function' ? fn(soundSpec, track, start, sliceStart, sliceEnd) : 0;
};
const hostClearTrack = (track: number, start?: number, end?: number) => {
  const fn = host().__audioClearTrack ?? host().__audio_clear_track;
  if (typeof fn !== 'function') return 0;
  if (typeof start === 'number' && typeof end === 'number') return fn(track, start, end);
  return fn(track);
};
const hostSetTrackVolume = (track: number, volume: number) => {
  const fn = host().__audioSetTrackVolume ?? host().__audio_set_track_volume;
  return typeof fn === 'function' ? fn(track, volume) : 0;
};
const hostSetTrackPan = (track: number, pan: number) => {
  const fn = host().__audioSetTrackPan ?? host().__audio_set_track_pan;
  return typeof fn === 'function' ? fn(track, pan) : 0;
};
const hostSetTrackMute = (track: number, muted: boolean) => {
  const fn = host().__audioSetTrackMute ?? host().__audio_set_track_mute;
  return typeof fn === 'function' ? fn(track, muted ? 1 : 0) : 0;
};
const hostSetTrackSolo = (track: number, soloed: boolean) => {
  const fn = host().__audioSetTrackSolo ?? host().__audio_set_track_solo;
  return typeof fn === 'function' ? fn(track, soloed ? 1 : 0) : 0;
};
const hostDur          = (soundSpec: string): number => {
  const fn = host().__audioDur ?? host().__audio_dur;
  return typeof fn === 'function' ? Number(fn(soundSpec) ?? 0) : 0;
};
const hostCreateAudioStretch = (soundSpec: string, stretchFactor: number): number => {
  const fn = host().__audioCreateAudioStretch ?? host().__audio_create_audio_stretch;
  return typeof fn === 'function' ? Number(fn(soundSpec, stretchFactor) ?? 0) : 0;
};
const hostCreateAudioSlice = (soundSpec: string, sliceStart: number, sliceEnd: number): number => {
  const fn = host().__audioCreateAudioSlice ?? host().__audio_create_audio_slice;
  return typeof fn === 'function' ? Number(fn(soundSpec, sliceStart, sliceEnd) ?? 0) : 0;
};
const hostLoadSound = (path: string): number => {
  const fn = host().__audioLoadSound ?? host().__audio_load_sound;
  return typeof fn === 'function' ? Number(fn(path) ?? 0) : 0;
};
const hostLoadSample = (id: number, slot: number, path: string, mode = 'oneshot'): number => {
  const fn = host().__audioLoadSample ?? host().__audio_load_sample;
  return typeof fn === 'function' ? Number(fn(id, slot, path, mode) ?? 0) : 0;
};
const hostClearSample = (id: number, slot: number): number => {
  const fn = host().__audioClearSample ?? host().__audio_clear_sample;
  return typeof fn === 'function' ? Number(fn(id, slot) ?? 0) : 0;
};
const hostGetModuleCount = (): number => Number((host().__audioGetModuleCount ?? host().__audio_get_module_count)?.() ?? 0);
const hostGetConnectionCount = (): number => Number((host().__audioGetConnectionCount ?? host().__audio_get_connection_count)?.() ?? 0);
const hostGetPeakLevel = (): number => Number((host().__audioGetPeakLevel ?? host().__audio_get_peak_level)?.() ?? 0);
const hostGetCallbackTime = (): number => Number((host().__audioGetCallbackTime ?? host().__audio_get_callback_us)?.() ?? 0);
const hostGetModuleType = (id: number): number => Number((host().__audioGetModuleType ?? host().__audio_get_module_type)?.(id) ?? -1);
const hostGetParam = (id: number, index: number): number => Number((host().__audioGetParam ?? host().__audio_get_param)?.(id, index) ?? 0);

function encodeSoundSpec(sound: AudioSound): string {
  const values = Array.isArray(sound) ? sound : [sound];
  return values
    .slice(0, 16)
    .map((v) => Math.max(0, Math.floor(Number(v) || 0)))
    .join(',');
}

function encodeSliceSpec(sliceStarts: readonly number[]): string {
  return sliceStarts
    .slice(0, 16)
    .map((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : 1;
    })
    .join(',');
}

// ── Audio context ─────────────────────────────────────────────────────
//
// Children (Module / Connection) consume the context to translate string
// ids into the numeric ids the host wants. Module IDs are sequential from
// 1 (id 0 is reserved for the master output by convention).

interface AudioCtx {
  /** name → numeric id assigned at mount. */
  names: Map<string, number>;
  /** Next id to hand out. */
  nextId: { current: number };
  /** Per-id type so the param-name lookup picks the right schema. */
  types: Map<number, AudioModuleType>;
  /** Lookup helper for children + the useAudio hook. */
  getId(name: string): number | undefined;
  getType(idOrName: string | number): AudioModuleType | undefined;
}

// Module-level shared registry. Both `<Audio>` and bare `useAudio()` calls
// hit the SAME maps so a knob's onChange handler at the page level can resolve
// 'inst1' even though it's defined inside a nested <Audio> subtree. Previously
// each <Audio> created its own per-tree namespace, but in practice every cart
// has exactly one audio engine and the per-tree split silently broke any
// useAudio() call that happened above the <Audio> JSX.
const SHARED_AUDIO_NAMES = new Map<string, number>();
const SHARED_AUDIO_TYPES = new Map<number, AudioModuleType>();
const SHARED_AUDIO_NEXT_ID = { current: 1 };
const SHARED_AUDIO_CTX: AudioCtx = {
  names: SHARED_AUDIO_NAMES,
  types: SHARED_AUDIO_TYPES,
  nextId: SHARED_AUDIO_NEXT_ID,
  getId: (name) => SHARED_AUDIO_NAMES.get(name),
  getType: (idOrName) => {
    const id = typeof idOrName === 'number' ? idOrName : SHARED_AUDIO_NAMES.get(idOrName);
    return id !== undefined ? SHARED_AUDIO_TYPES.get(id) : undefined;
  },
};
const AudioContext = React.createContext<AudioCtx>(SHARED_AUDIO_CTX);

// ── useAudio — imperative façade for events that don't fit a tree ─────

export interface AudioHandle {
  /** Resolve a string id (set on <Audio.Module id="...">) to its numeric id. */
  getId: (name: string) => number | undefined;
  /** Initialize the SDL-backed audio engine and resume the playback device. */
  initAudio: () => boolean;
  /** Shut down the audio engine and release device resources. */
  deinitAudio: () => void;
  /** Return whether the audio engine has an open device. */
  isAudioInitialized: () => boolean;
  /** Start or resume transport scheduling. */
  play: () => void;
  /** Pause transport scheduling without resetting the playhead. */
  pause: () => void;
  /** Stop transport scheduling and reset playhead to measure 1. */
  stop: () => void;
  /** Move the transport playhead to a 1-based measure. */
  setPlayhead: (measure: number) => void;
  /** Read the current 1-based transport playhead measure. */
  getPlayhead: () => number;
  /** Return whether transport scheduling is currently playing. */
  isPlaying: () => boolean;
  /** Create a module directly without JSX. */
  addModule: (id: number, type: AudioModuleType) => void;
  /** Alias for addModule. */
  createAudioModule: (id: number, type: AudioModuleType) => void;
  /** Remove a module directly without JSX. */
  removeModule: (id: number) => void;
  /** Connect modules directly without JSX. */
  connectModules: (from: number, to: number, fromPort?: number, toPort?: number) => void;
  /** Disconnect modules directly without JSX. */
  disconnectModules: (from: number, to: number, fromPort?: number, toPort?: number) => void;
  /** Trigger note-on for a module by name or numeric id. midi is 0..127. */
  noteOn: (target: string | number, midi: number, velocity?: number) => void;
  /** Trigger note-off (envelope release / amplitude decay). */
  noteOff: (target: string | number, midi?: number) => void;
  /** Load a WAV file into a sampler module slot. Slots are 1..16. */
  loadSample: (target: string | number, slot: number, path: string, mode?: 'oneshot' | 'loop') => boolean;
  /** Clear one sampler module slot. */
  clearSample: (target: string | number, slot: number) => boolean;
  /** Load a WAV file as a Sound handle usable by dur, slice/stretch, patterns, and media placement. */
  loadSound: (path: string) => number;
  /** Set a typed param by name (resolved through the module's type table). */
  setParam: (target: string | number, paramName: string, value: number) => void;
  /** Alias for setParam using the cleaner graph API name. */
  setModuleParam: (id: string | number, param: string, value: number) => void;
  /** Set a param by raw numeric index (skip the name → index lookup). */
  setParamIndex: (target: string | number, paramIndex: number, value: number) => void;
  /** Return a module type by name or numeric id when known. */
  getModuleType: (target: string | number) => AudioModuleType | undefined;
  /** Return local param metadata for a module type or module instance. */
  getParamDefinitions: (target: string | number | AudioModuleType) => AudioParamDefinition[];
  /** Read a module param by name or index when the host can provide it. */
  getParam: (target: string | number, param: string | number) => number;
  /** Set project tempo at a measure, optionally ramping to another tempo by end measure. */
  setTempo: (startTempo: number, start: number, endTempo?: number, end?: number) => void;
  /** Place a beat-string pattern onto a host-managed audio track. */
  makeBeat: (sound: AudioSound, track: number, start: number, beat: string, stepsPerMeasure?: number) => void;
  /** Alias for makeBeat using the cleaner pattern name. */
  makePattern: (sounds: AudioSound, track: number, start: number, pattern: string, stepsPerMeasure?: number) => void;
  /** Place a beat-string pattern that retriggers one sound from per-character slice starts. */
  makeBeatSlice: (sound: number, track: number, start: number, beat: string, sliceStarts: readonly number[], stepsPerMeasure?: number) => void;
  /** Alias for makeBeatSlice using the cleaner pattern name. */
  makeSlicePattern: (sound: number, track: number, start: number, pattern: string, sliceStarts: readonly number[], stepsPerMeasure?: number) => void;
  /** Set per-step velocity for the latest pattern on a track. */
  setStepVelocity: (track: number, step: number, velocity: number) => void;
  /** Set per-step trigger probability for the latest pattern on a track. */
  setStepProbability: (track: number, step: number, probability: number) => void;
  /** Set per-step micro-timing offset for the latest pattern on a track. */
  setStepOffset: (track: number, step: number, offset: number) => void;
  /** Set one module-level sequencer step. Velocity may be 0..1 or 0..127. */
  setStep: (sequencer: string | number, track: number, step: number, active: boolean, note?: number, velocity?: number) => boolean;
  /** Route one module-level sequencer track to a target module. */
  setTrackTarget: (sequencer: string | number, track: number, target: string | number) => boolean;
  /** Clear all module-level sequencer steps and pending note-offs. */
  clearPattern: (sequencer: string | number) => boolean;
  /** Send one external MIDI-clock pulse into a clock module, or all clock modules with target 0. */
  clockPulse: (clock?: string | number) => boolean;
  /** Start/reset a clock module, or all clock modules with target 0. */
  clockStart: (clock?: string | number) => boolean;
  /** Stop a clock module, or all clock modules with target 0. */
  clockStop: (clock?: string | number) => boolean;
  /** Insert one whole sound onto a host-managed audio track at a measure. */
  insertMedia: (sound: number, track: number, start: number) => void;
  /** Fit a sound to a track span, repeating or cutting it short as needed. */
  fitMedia: (sound: number, track: number, start: number, end: number) => void;
  /** Insert a section of a sound onto a host-managed audio track at a measure. */
  insertMediaSection: (sound: number, track: number, start: number, sliceStart: number, sliceEnd: number) => void;
  /** Remove clips and patterns from a track, optionally constrained to a measure range. */
  clearTrack: (track: number, start?: number, end?: number) => void;
  /** Set the host-managed track fader level. */
  setTrackVolume: (track: number, volume: number) => void;
  /** Store the host-managed track pan position. */
  setTrackPan: (track: number, pan: number) => void;
  /** Mute or unmute a host-managed track. */
  setTrackMute: (track: number, muted: boolean) => void;
  /** Solo or unsolo a host-managed track. */
  setTrackSolo: (track: number, soloed: boolean) => void;
  /** Return a sound's duration in measures. */
  dur: (sound: number) => number;
  /** Return a new sound constant stretched from the source sound. */
  createAudioStretch: (sound: number, stretchFactor: number) => number;
  /** Alias for createAudioStretch. */
  stretchSound: (sound: number, factor: number) => number;
  /** Return a new sound constant sliced from the source sound. */
  createAudioSlice: (sound: number, sliceStart: number, sliceEnd: number) => number;
  /** Alias for createAudioSlice. */
  sliceSound: (sound: number, start: number, end: number) => number;
  /** Alias for master gain. */
  setMasterVolume: (volume: number) => void;
  /** Reserved master-bus effect expansion point. */
  setMasterEffect: (effectType: string, params?: Record<string, unknown>) => void;
  getModuleCount: () => number;
  getConnectionCount: () => number;
  getPeakLevel: () => number;
  getCallbackTime: () => number;
}

export function useAudio(): AudioHandle {
  const ctx = React.useContext(AudioContext);
  const resolve = (t: string | number): number =>
    typeof t === 'number' ? t : (ctx?.getId(t) ?? -1);
  return {
    getId: (n: string) => ctx?.getId(n),
    initAudio: () => hostInitAudio(),
    deinitAudio: () => { hostDeinitAudio(); },
    isAudioInitialized: () => hostIsAudioInitialized(),
    play: () => { hostPlay(); },
    pause: () => { hostPauseTransport(); },
    stop: () => { hostStop(); },
    setPlayhead: (measure) => { hostSetPlayhead(measure); },
    getPlayhead: () => hostGetPlayhead(),
    isPlaying: () => hostIsPlaying(),
    addModule: (id, type) => {
      hostAdd(id, AUDIO_MODULE_TYPE[type]);
      ctx?.types.set(id, type);
    },
    createAudioModule: (id, type) => {
      hostAdd(id, AUDIO_MODULE_TYPE[type]);
      ctx?.types.set(id, type);
    },
    removeModule: (id) => { hostRemove(id); ctx?.types.delete(id); },
    connectModules: (from, to, fromPort = 0, toPort = 0) => { hostConnect(from, fromPort, to, toPort); },
    disconnectModules: (from, to, fromPort = 0, toPort = 0) => { hostDisconnect(from, fromPort, to, toPort); },
    noteOn: (t, midi, velocity = 1) => { const id = resolve(t); if (id >= 0) hostNoteOn(id, midi, velocity); },
    noteOff: (t, midi) => { const id = resolve(t); if (id >= 0) hostNoteOff(id, midi); },
    loadSample: (t, slot, path, mode = 'oneshot') => {
      const id = resolve(t);
      return id >= 0 ? hostLoadSample(id, slot, String(path), mode) > 0 : false;
    },
    clearSample: (t, slot) => {
      const id = resolve(t);
      return id >= 0 ? hostClearSample(id, slot) > 0 : false;
    },
    loadSound: (path) => hostLoadSound(String(path)),
    setParam: (t, name, v) => {
      const id = resolve(t);
      if (id < 0) return;
      const type = ctx?.getType(t);
      if (!type) return;
      const idx = AUDIO_PARAM_INDEX[type]?.[name];
      if (idx === undefined) return;
      hostSetParam(id, idx, v);
    },
    setModuleParam: (t, name, v) => {
      const id = resolve(t);
      if (id < 0) return;
      const type = ctx?.getType(t);
      if (!type) return;
      const idx = AUDIO_PARAM_INDEX[type]?.[name];
      if (idx === undefined) return;
      hostSetParam(id, idx, v);
    },
    setParamIndex: (t, idx, v) => { const id = resolve(t); if (id >= 0) hostSetParam(id, idx, v); },
    getModuleType: (t) => {
      const ctxType = ctx?.getType(t);
      if (ctxType) return ctxType;
      const id = resolve(t);
      if (id < 0) return undefined;
      return AUDIO_MODULE_TYPE_BY_ID[hostGetModuleType(id)];
    },
    getParamDefinitions: (t) => {
      const type = typeof t === 'string' && t in AUDIO_PARAM_DEFS
        ? t as AudioModuleType
        : (ctx?.getType(t as string | number) ?? AUDIO_MODULE_TYPE_BY_ID[hostGetModuleType(resolve(t as string | number))]);
      return type ? AUDIO_PARAM_DEFS[type] ?? [] : [];
    },
    getParam: (t, param) => {
      const id = resolve(t);
      if (id < 0) return 0;
      if (typeof param === 'number') return hostGetParam(id, param);
      const type = ctx?.getType(t) ?? AUDIO_MODULE_TYPE_BY_ID[hostGetModuleType(id)];
      const idx = type ? AUDIO_PARAM_INDEX[type]?.[param] : undefined;
      return idx === undefined ? 0 : hostGetParam(id, idx);
    },
    setTempo: (startTempo, start, endTempo, end) => { hostSetTempo(startTempo, start, endTempo, end); },
    makeBeat: (sound, track, start, beat, stepsPerMeasure = 16) => {
      hostMakeBeat(encodeSoundSpec(sound), track, start, String(beat), stepsPerMeasure);
    },
    makePattern: (sound, track, start, pattern, stepsPerMeasure = 16) => {
      hostMakeBeat(encodeSoundSpec(sound), track, start, String(pattern), stepsPerMeasure);
    },
    makeBeatSlice: (sound, track, start, beat, sliceStarts, stepsPerMeasure = 16) => {
      hostMakeBeatSlice(encodeSoundSpec(sound), track, start, String(beat), encodeSliceSpec(sliceStarts), stepsPerMeasure);
    },
    makeSlicePattern: (sound, track, start, pattern, sliceStarts, stepsPerMeasure = 16) => {
      hostMakeBeatSlice(encodeSoundSpec(sound), track, start, String(pattern), encodeSliceSpec(sliceStarts), stepsPerMeasure);
    },
    setStepVelocity: (track, step, velocity) => { hostSetStepVelocity(track, step, velocity); },
    setStepProbability: (track, step, probability) => { hostSetStepProbability(track, step, probability); },
    setStepOffset: (track, step, offset) => { hostSetStepOffset(track, step, offset); },
    setStep: (sequencer, track, step, active, note = 36, velocity = 100) => {
      const id = resolve(sequencer);
      return id >= 0 ? hostSetStep(id, track, step, active, note, velocity) > 0 : false;
    },
    setTrackTarget: (sequencer, track, target) => {
      const id = resolve(sequencer);
      const targetId = resolve(target);
      return id >= 0 && targetId >= 0 ? hostSetTrackTarget(id, track, targetId) > 0 : false;
    },
    clearPattern: (sequencer) => {
      const id = resolve(sequencer);
      return id >= 0 ? hostClearPattern(id) > 0 : false;
    },
    clockPulse: (clock = 0) => {
      const id = resolve(clock);
      return id >= 0 ? hostClockPulse(id) > 0 : false;
    },
    clockStart: (clock = 0) => {
      const id = resolve(clock);
      return id >= 0 ? hostClockStart(id) > 0 : false;
    },
    clockStop: (clock = 0) => {
      const id = resolve(clock);
      return id >= 0 ? hostClockStop(id) > 0 : false;
    },
    insertMedia: (sound, track, start) => { hostInsertMedia(encodeSoundSpec(sound), track, start); },
    fitMedia: (sound, track, start, end) => { hostFitMedia(encodeSoundSpec(sound), track, start, end); },
    insertMediaSection: (sound, track, start, sliceStart, sliceEnd) => {
      hostInsertMediaSection(encodeSoundSpec(sound), track, start, sliceStart, sliceEnd);
    },
    clearTrack: (track, start, end) => { hostClearTrack(track, start, end); },
    setTrackVolume: (track, volume) => { hostSetTrackVolume(track, volume); },
    setTrackPan: (track, pan) => { hostSetTrackPan(track, pan); },
    setTrackMute: (track, muted) => { hostSetTrackMute(track, muted); },
    setTrackSolo: (track, soloed) => { hostSetTrackSolo(track, soloed); },
    dur: (sound) => hostDur(encodeSoundSpec(sound)),
    createAudioStretch: (sound, stretchFactor) => hostCreateAudioStretch(encodeSoundSpec(sound), stretchFactor),
    stretchSound: (sound, factor) => hostCreateAudioStretch(encodeSoundSpec(sound), factor),
    createAudioSlice: (sound, sliceStart, sliceEnd) => hostCreateAudioSlice(encodeSoundSpec(sound), sliceStart, sliceEnd),
    sliceSound: (sound, start, end) => hostCreateAudioSlice(encodeSoundSpec(sound), start, end),
    setMasterVolume: (volume) => { hostMasterGain(volume); },
    setMasterEffect: (_effectType, _params) => {},
    getModuleCount: () => hostGetModuleCount(),
    getConnectionCount: () => hostGetConnectionCount(),
    getPeakLevel: () => hostGetPeakLevel(),
    getCallbackTime: () => hostGetCallbackTime(),
  };
}

// ── <Audio> root ──────────────────────────────────────────────────────

interface AudioProps {
  /** Master output gain, 0..1 (engine clamps). */
  gain?: number;
  children?: any;
}

function AudioRoot({ gain, children }: AudioProps): any {
  // Shares the module-level registry so useAudio() works at any tree level.
  React.useEffect(() => {
    if (typeof gain === 'number') hostMasterGain(gain);
  }, [gain]);
  return React.createElement(AudioContext.Provider, { value: SHARED_AUDIO_CTX }, children);
}

// ── <Audio.Module> ────────────────────────────────────────────────────
//
// id        — string handle other children / useAudio refer to.
// type      — module-type key (e.g. 'instrument', 'delay').
// All other props are param names; values must be numbers.
//
// Mount   → assign numeric id, register name → id, host-add module, push
//           initial params.
// Update  → diff each typed param prop, push __audioSetParam on change.
// Unmount → host-remove module and clear name → id.

interface AudioModuleProps {
  id: string;
  type: AudioModuleType;
  /** Any additional numeric prop is treated as a typed param. */
  [param: string]: any;
}

function AudioModule(props: AudioModuleProps): any {
  const { id: name, type, children: _, ...paramProps } = props;
  const ctx = React.useContext(AudioContext);
  const numIdRef = React.useRef<number>(-1);

  // Allocate a stable numeric id on first render (synchronous so siblings
  // in the same tree see this id immediately when they mount).
  if (numIdRef.current === -1 && ctx) {
    numIdRef.current = ctx.nextId.current++;
    if (name) {
      ctx.names.set(name, numIdRef.current);
      ctx.types.set(numIdRef.current, type);
    }
  }
  const numId = numIdRef.current;

  // Host-add on mount, host-remove on unmount.
  React.useEffect(() => {
    if (numId < 0) return;
    hostAdd(numId, AUDIO_MODULE_TYPE[type]);
    return () => {
      hostRemove(numId);
      if (name && ctx) {
        ctx.names.delete(name);
        ctx.types.delete(numId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push numeric params on mount and whenever a JSX prop value changes. We
  // intentionally do NOT push on every render — that would clobber imperative
  // updates from `audio.setModuleParam(...)` (e.g. a knob writing live values)
  // every time anything in the parent re-renders.
  const lastParamsRef = React.useRef<Record<string, number>>({});
  React.useEffect(() => {
    if (numId < 0) return;
    const schema = AUDIO_PARAM_INDEX[type];
    if (!schema) return;
    const last = lastParamsRef.current;
    for (const key of Object.keys(paramProps)) {
      const idx = schema[key];
      if (idx === undefined) continue;
      const v = paramProps[key];
      if (typeof v !== 'number') continue;
      if (last[key] === v) continue;
      last[key] = v;
      hostSetParam(numId, idx, v);
    }
  });

  return null;
}

// ── <Audio.Connection> ────────────────────────────────────────────────
//
// Wires two modules' ports together. Mount → __audioConnect, unmount →
// __audioDisconnect. The `from`/`to` props are usually string ids that
// resolve through the <Audio> context, but raw numeric ids work too (e.g.
// 0 for the master output).

interface AudioConnectionProps {
  from: string | number;
  to: string | number;
  fromPort?: number;
  toPort?: number;
}

function AudioConnection({ from, to, fromPort = 0, toPort = 0 }: AudioConnectionProps): any {
  const ctx = React.useContext(AudioContext);
  const resolve = (t: string | number): number =>
    typeof t === 'number' ? t : (ctx?.getId(t) ?? -1);

  React.useEffect(() => {
    // Defer one tick so newly-mounted sibling modules have flushed their
    // own host-add effects first. Without this, connecting to a module
    // mounted in the same render produces "module not found" on the audio
    // thread.
    let connected = false;
    let aId = -1, bId = -1, aPort = fromPort, bPort = toPort;
    const t = setTimeout(() => {
      aId = resolve(from);
      bId = resolve(to);
      if (aId < 0 || bId < 0) return;
      hostConnect(aId, aPort, bId, bPort);
      connected = true;
    }, 0);
    return () => {
      clearTimeout(t);
      if (connected) hostDisconnect(aId, aPort, bId, bPort);
    };
  }, [from, to, fromPort, toPort]);

  return null;
}

// ── Namespace export ──────────────────────────────────────────────────

const AudioBase: any = AudioRoot;
AudioBase.Module     = AudioModule;
AudioBase.Connection = AudioConnection;

/** Root primitive — also exported as the namespace base. */
export const Audio: any = AudioBase;
