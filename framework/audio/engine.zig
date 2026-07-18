//! Audio subsystem — lifecycle, SDL3 device, and LuaJIT VM setup.

const std = @import("std");
const sdl = @import("sdl.zig").c;
const zluajit = @import("zluajit");
const types = @import("types.zig");
const state = @import("state.zig");
const callback = @import("callback.zig");
const api = @import("api.zig");

const Module = types.Module;
const Connection = types.Connection;
const Command = types.Command;
const PortType = types.PortType;
const PortDir = types.PortDir;
const ParamType = types.ParamType;
const ModuleType = types.ModuleType;
const Waveform = types.Waveform;
const Port = types.Port;
const Param = types.Param;
const BeatPattern = types.BeatPattern;
const BeatTrack = types.BeatTrack;
const MediaEvent = types.MediaEvent;
const RetiredBeat = types.RetiredBeat;
const SoundHandle = types.SoundHandle;
const SoundInfo = types.SoundInfo;
const SampleVoice = types.SampleVoice;
const SampleData = types.SampleData;
const SoundKind = types.SoundKind;
const TempoSegment = types.TempoSegment;

const SAMPLE_RATE = types.SAMPLE_RATE;
const BUFFER_SIZE = types.BUFFER_SIZE;
const MAX_CHANNELS = types.MAX_CHANNELS;
const MAX_MODULES = types.MAX_MODULES;
const MAX_CONNECTIONS = types.MAX_CONNECTIONS;
const MAX_PORTS_PER_MODULE = types.MAX_PORTS_PER_MODULE;
const MAX_PARAMS_PER_MODULE = types.MAX_PARAMS_PER_MODULE;
const MAX_COMMAND_QUEUE = types.MAX_COMMAND_QUEUE;
const MAX_TEMPO_POINTS = types.MAX_TEMPO_POINTS;
const MAX_BEAT_PATTERNS = types.MAX_BEAT_PATTERNS;
const MAX_BEAT_TRACKS = types.MAX_BEAT_TRACKS;
const MAX_MEDIA_EVENTS = types.MAX_MEDIA_EVENTS;
const MAX_RETIRED_BEATS = types.MAX_RETIRED_BEATS;
const MAX_SOUNDS_PER_BEAT = types.MAX_SOUNDS_PER_BEAT;
const MAX_PATTERN_STEP_META = types.MAX_PATTERN_STEP_META;
const MAX_AUDIO_SOUND_HANDLES = types.MAX_AUDIO_SOUND_HANDLES;
const MAX_AUDIO_SAMPLES = types.MAX_AUDIO_SAMPLES;
const MAX_SAMPLE_VOICES = types.MAX_SAMPLE_VOICES;
const MAX_SAMPLER_SLOTS = types.MAX_SAMPLER_SLOTS;
const MAX_SAMPLER_VOICES = types.MAX_SAMPLER_VOICES;
const MAX_SEQUENCER_TRACKS = types.MAX_SEQUENCER_TRACKS;
const MAX_SEQUENCER_STEPS = types.MAX_SEQUENCER_STEPS;
const BEAT_TRACK_MODULE_BASE = types.BEAT_TRACK_MODULE_BASE;
const STRETCHED_SOUND_BASE = types.STRETCHED_SOUND_BASE;
const DEFAULT_TEMPO = types.DEFAULT_TEMPO;
const BEATS_PER_MEASURE = types.BEATS_PER_MEASURE;
const SAMPLER_BASE_NOTE = types.SAMPLER_BASE_NOTE;
const SAMPLER_PITCH_NOTE = types.SAMPLER_PITCH_NOTE;
const TEMPO_FLAG_END_TEMPO = types.TEMPO_FLAG_END_TEMPO;
const TEMPO_FLAG_END_MEASURE = types.TEMPO_FLAG_END_MEASURE;
const TRACK_FLAG_RANGE = types.TRACK_FLAG_RANGE;

pub fn init(io: std.Io) bool {
    if (state.g_engine.initialized) return true;

    state.g_engine.io = io;

    // Wire buffer pool
    state.g_engine.buffer_pool.data = &state.g_engine.buffer_storage;

    // Open SDL3 audio device
    const spec = sdl.SDL_AudioSpec{
        .format = sdl.SDL_AUDIO_F32,
        .channels = @intCast(MAX_CHANNELS),
        .freq = @intCast(SAMPLE_RATE),
    };

    state.g_engine.device_id = sdl.SDL_OpenAudioDevice(sdl.SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec);
    if (state.g_engine.device_id == 0) {
        std.log.err("[audio] Failed to open audio device: {s}", .{sdl.SDL_GetError()});
        return false;
    }

    // Create audio stream
    state.g_engine.stream = sdl.SDL_CreateAudioStream(&spec, &spec);
    if (state.g_engine.stream == null) {
        std.log.err("[audio] Failed to create audio stream: {s}", .{sdl.SDL_GetError()});
        sdl.SDL_CloseAudioDevice(state.g_engine.device_id);
        return false;
    }

    // Set callback
    _ = sdl.SDL_SetAudioStreamGetCallback(state.g_engine.stream, callback.audioCallback, &state.g_engine.io);

    // Bind stream to device
    if (!sdl.SDL_BindAudioStream(state.g_engine.device_id, state.g_engine.stream)) {
        std.log.err("[audio] Failed to bind stream: {s}", .{sdl.SDL_GetError()});
        sdl.SDL_DestroyAudioStream(state.g_engine.stream);
        sdl.SDL_CloseAudioDevice(state.g_engine.device_id);
        return false;
    }

    // Resume playback
    _ = sdl.SDL_ResumeAudioDevice(state.g_engine.device_id);

    state.g_engine.initialized = true;
    std.log.info("[audio] Initialized: {d}Hz, {d} samples/buffer, F32 stereo", .{ SAMPLE_RATE, BUFFER_SIZE });
    return true;
}

pub fn deinit() void {
    if (!state.g_engine.initialized) return;
    if (state.g_engine.stream) |s| sdl.SDL_DestroyAudioStream(s);
    if (state.g_engine.device_id != 0) sdl.SDL_CloseAudioDevice(state.g_engine.device_id);
    api.freeBeatBytes();
    api.freeSampleStorage();
    state.g_engine.initialized = false;
}

pub fn isInitialized() bool {
    return state.g_engine.initialized;
}

pub fn resumeDevice() void {
    if (state.g_engine.device_id != 0) _ = sdl.SDL_ResumeAudioDevice(state.g_engine.device_id);
}

pub fn pauseDevice() void {
    if (state.g_engine.device_id != 0) _ = sdl.SDL_PauseAudioDevice(state.g_engine.device_id);
}
