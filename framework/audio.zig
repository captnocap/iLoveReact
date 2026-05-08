//! framework/audio.zig — feature-gated dispatcher for the audio subsystem.
//!
//! When -Dhas-audio=true (passed by scripts/ship for carts whose source
//! triggers the `audio` feature in sdk/dependency-registry.json — i.e.
//! imports runtime/audio.tsx), this re-exports framework/audio_real.zig
//! (the real SDL3 + LuaJIT-DSP-backed implementation).
//!
//! Otherwise it re-exports framework/audio_stub.zig, whose methods are
//! all no-ops. With the stub selected, audio_real.zig is never reached
//! by the compiler — its `@import("zluajit")` and SDL3 audio plumbing
//! aren't compiled, libluajit and libasound stay out of the cart bundle,
//! and the SDL3 audio backend chain (libpulse/libpipewire/libsndio +
//! codec libs) doesn't ride into the cart via the catch-all bundler.
//!
//! Audio's DSP architecture force-ties has_lua_worker = true whenever
//! has_audio = true; build.zig should mirror this with
//! `effective_has_lua_worker = has_lua_worker or has_audio` so the
//! audio_real.zig path always has zluajit available.
//!
//! Mirrors framework/sqlite.zig + framework/vterm.zig dispatcher pattern.

const build_options = @import("build_options");

const HAS_AUDIO = if (@hasDecl(build_options, "has_audio"))
    build_options.has_audio
else
    false;

const impl = if (HAS_AUDIO)
    @import("audio_real.zig")
else
    @import("audio_stub.zig");

// ── Constants ────────────────────────────────────────────────────────

pub const SAMPLE_RATE = impl.SAMPLE_RATE;
pub const BUFFER_SIZE = impl.BUFFER_SIZE;
pub const MAX_CHANNELS = impl.MAX_CHANNELS;
pub const MAX_MODULES = impl.MAX_MODULES;
pub const MAX_CONNECTIONS = impl.MAX_CONNECTIONS;
pub const MAX_PORTS_PER_MODULE = impl.MAX_PORTS_PER_MODULE;
pub const MAX_PARAMS_PER_MODULE = impl.MAX_PARAMS_PER_MODULE;
pub const MAX_COMMAND_QUEUE = impl.MAX_COMMAND_QUEUE;
pub const MAX_TEMPO_POINTS = impl.MAX_TEMPO_POINTS;
pub const MAX_BEAT_PATTERNS = impl.MAX_BEAT_PATTERNS;
pub const MAX_BEAT_TRACKS = impl.MAX_BEAT_TRACKS;
pub const MAX_MEDIA_EVENTS = impl.MAX_MEDIA_EVENTS;
pub const MAX_RETIRED_BEATS = impl.MAX_RETIRED_BEATS;
pub const MAX_SOUNDS_PER_BEAT = impl.MAX_SOUNDS_PER_BEAT;
pub const MAX_PATTERN_STEP_META = impl.MAX_PATTERN_STEP_META;
pub const MAX_AUDIO_SOUND_HANDLES = impl.MAX_AUDIO_SOUND_HANDLES;
pub const MAX_AUDIO_SAMPLES = impl.MAX_AUDIO_SAMPLES;
pub const MAX_SAMPLE_VOICES = impl.MAX_SAMPLE_VOICES;
pub const MAX_SAMPLER_SLOTS = impl.MAX_SAMPLER_SLOTS;
pub const MAX_SAMPLER_VOICES = impl.MAX_SAMPLER_VOICES;
pub const MAX_SEQUENCER_TRACKS = impl.MAX_SEQUENCER_TRACKS;
pub const MAX_SEQUENCER_STEPS = impl.MAX_SEQUENCER_STEPS;
pub const BEAT_TRACK_MODULE_BASE = impl.BEAT_TRACK_MODULE_BASE;
pub const STRETCHED_SOUND_BASE = impl.STRETCHED_SOUND_BASE;
pub const DEFAULT_TEMPO = impl.DEFAULT_TEMPO;
pub const BEATS_PER_MEASURE = impl.BEATS_PER_MEASURE;

// ── Types ────────────────────────────────────────────────────────────

pub const PortType = impl.PortType;
pub const PortDir = impl.PortDir;
pub const ParamType = impl.ParamType;
pub const Waveform = impl.Waveform;
pub const Port = impl.Port;
pub const Param = impl.Param;
pub const ModuleType = impl.ModuleType;
pub const Module = impl.Module;
pub const Connection = impl.Connection;
pub const CommandType = impl.CommandType;
pub const Command = impl.Command;

// ── Lifecycle ────────────────────────────────────────────────────────

pub const init = impl.init;
pub const deinit = impl.deinit;
pub const isInitialized = impl.isInitialized;
pub const resumeDevice = impl.resumeDevice;
pub const pauseDevice = impl.pauseDevice;

// ── Command queue ────────────────────────────────────────────────────

pub const pushCommand = impl.pushCommand;

// ── Tempo / transport ────────────────────────────────────────────────

pub const setTempo = impl.setTempo;
pub const play = impl.play;
pub const pauseTransport = impl.pauseTransport;
pub const stop = impl.stop;
pub const setPlayhead = impl.setPlayhead;
pub const getPlayhead = impl.getPlayhead;
pub const isPlaying = impl.isPlaying;

// ── Beat / pattern composition ───────────────────────────────────────

pub const makeBeat = impl.makeBeat;
pub const makeBeatSlice = impl.makeBeatSlice;
pub const insertMedia = impl.insertMedia;
pub const fitMedia = impl.fitMedia;
pub const insertMediaSection = impl.insertMediaSection;
pub const clearTrack = impl.clearTrack;

// ── Track mixer ──────────────────────────────────────────────────────

pub const setTrackVolume = impl.setTrackVolume;
pub const setTrackPan = impl.setTrackPan;
pub const setTrackMute = impl.setTrackMute;
pub const setTrackSolo = impl.setTrackSolo;

// ── Step modulation ──────────────────────────────────────────────────

pub const setStepVelocity = impl.setStepVelocity;
pub const setStepProbability = impl.setStepProbability;
pub const setStepOffset = impl.setStepOffset;
pub const setStep = impl.setStep;
pub const setTrackTarget = impl.setTrackTarget;
pub const clearPattern = impl.clearPattern;

// ── Clock ────────────────────────────────────────────────────────────

pub const clockPulse = impl.clockPulse;
pub const clockStart = impl.clockStart;
pub const clockStop = impl.clockStop;

// ── Sound lookup / sample ────────────────────────────────────────────

pub const dur = impl.dur;
pub const createAudioStretch = impl.createAudioStretch;
pub const createAudioSlice = impl.createAudioSlice;
pub const loadSound = impl.loadSound;
pub const loadSample = impl.loadSample;
pub const clearSample = impl.clearSample;

// ── Telemetry / counters ─────────────────────────────────────────────

pub const logTelemetry = impl.logTelemetry;
pub const getModuleCount = impl.getModuleCount;
pub const getConnectionCount = impl.getConnectionCount;
pub const getCallbackCount = impl.getCallbackCount;
pub const getCallbackUs = impl.getCallbackUs;
pub const getPeakLevel = impl.getPeakLevel;

// ── Param introspection ──────────────────────────────────────────────

pub const getParam = impl.getParam;
pub const getParamCount = impl.getParamCount;
pub const getPortCount = impl.getPortCount;
pub const getModuleType = impl.getModuleType;
pub const getParamMin = impl.getParamMin;
pub const getParamMax = impl.getParamMax;
