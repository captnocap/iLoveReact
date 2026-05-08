//! framework/audio_stub.zig — empty implementation for carts that don't
//! enable -Dhas-audio. Selected by framework/audio.zig when
//! build_options.has_audio is false.
//!
//! Every public symbol from audio_real.zig is mirrored here so callers
//! (engine.zig, v8_bindings_core.zig) compile unchanged. Constants and
//! types are exact copies — they're part of the API contract regardless
//! of mode. Functions are no-ops returning false / 0 / void.
//!
//! When carts opt out of audio, audio_real.zig (which @imports zluajit
//! for its DSP engine) is never reached by the compiler, so libluajit
//! and libasound stay out of the cart bundle entirely.

const std = @import("std");

// ── Constants (verbatim copies from audio_real.zig) ─────────────────

pub const SAMPLE_RATE: u32 = 44100;
pub const BUFFER_SIZE: u32 = 512;
pub const MAX_CHANNELS: u32 = 2;
pub const MAX_MODULES: u32 = 64;
pub const MAX_CONNECTIONS: u32 = 256;
pub const MAX_PORTS_PER_MODULE: u32 = 8;
pub const MAX_PARAMS_PER_MODULE: u32 = 16;
pub const MAX_COMMAND_QUEUE: u32 = 1024;
pub const MAX_TEMPO_POINTS: u32 = 64;
pub const MAX_BEAT_PATTERNS: u32 = 64;
pub const MAX_BEAT_TRACKS: u32 = 16;
pub const MAX_MEDIA_EVENTS: u32 = 64;
pub const MAX_RETIRED_BEATS: u32 = 256;
pub const MAX_SOUNDS_PER_BEAT: u32 = 16;
pub const MAX_PATTERN_STEP_META: u32 = 1024;
pub const MAX_AUDIO_SOUND_HANDLES: u32 = 256;
pub const MAX_AUDIO_SAMPLES: u32 = 128;
pub const MAX_SAMPLE_VOICES: u32 = 64;
pub const MAX_SAMPLER_SLOTS: u32 = 16;
pub const MAX_SAMPLER_VOICES: u32 = 16;
pub const MAX_SEQUENCER_TRACKS: u32 = 8;
pub const MAX_SEQUENCER_STEPS: u32 = 64;
pub const BEAT_TRACK_MODULE_BASE: u32 = 60000;
pub const STRETCHED_SOUND_BASE: u32 = 1000;
pub const DEFAULT_TEMPO: f64 = 120.0;
pub const BEATS_PER_MEASURE: f64 = 4.0;

// ── Types (verbatim copies — API contract) ───────────────────────────

pub const PortType = enum(u8) { audio, control, midi };
pub const PortDir = enum(u8) { in_, out };
pub const ParamType = enum(u8) { float, int, bool_, enum_ };
pub const Waveform = enum(u8) { sine, saw, square, triangle, noise };

pub const Port = struct {
    name: [32]u8 = undefined,
    name_len: u8 = 0,
    port_type: PortType = .audio,
    direction: PortDir = .out,
    buffer: [*]f32 = undefined,
};

pub const Param = struct {
    name: [32]u8 = undefined,
    name_len: u8 = 0,
    param_type: ParamType = .float,
    value: f64 = 0,
    min: f64 = 0,
    max: f64 = 1,
    default: f64 = 0,
};

pub const ModuleType = enum(u8) {
    oscillator,
    filter,
    amplifier,
    mixer,
    delay,
    envelope,
    lfo,
    sequencer,
    sampler,
    custom,
    pocket_voice,
    clock,
};

pub const Module = struct {
    id: u32 = 0,
    slot_index: u32 = 0,
    module_type: ModuleType = .oscillator,
    active: bool = false,

    ports: [MAX_PORTS_PER_MODULE]Port = undefined,
    port_count: u8 = 0,

    params: [MAX_PARAMS_PER_MODULE]Param = undefined,
    param_count: u8 = 0,

    phase: f64 = 0,
    phase2: f64 = 0,
    envelope_stage: u8 = 0,
    envelope_level: f64 = 0,
    filter_y1: f64 = 0,
    filter_y2: f64 = 0,
    delay_write_pos: u32 = 0,
    delay_buffer: ?[*]f32 = null,
    trigger_time: f64 = 0,
    trigger_velocity: f64 = 1,
    trigger_variant: f64 = 0.5,
    base_freq: f64 = 110,
    noise_seed: u32 = 1,
    sampler_slots: [MAX_SAMPLER_SLOTS]u32 = [_]u32{0} ** MAX_SAMPLER_SLOTS,
    sampler_slot_loop: [MAX_SAMPLER_SLOTS]bool = [_]bool{false} ** MAX_SAMPLER_SLOTS,
    sampler_voice_active: [MAX_SAMPLER_VOICES]bool = [_]bool{false} ** MAX_SAMPLER_VOICES,
    sampler_voice_slot: [MAX_SAMPLER_VOICES]u8 = [_]u8{0} ** MAX_SAMPLER_VOICES,
    sampler_voice_note: [MAX_SAMPLER_VOICES]i32 = [_]i32{0} ** MAX_SAMPLER_VOICES,
    sampler_voice_pos: [MAX_SAMPLER_VOICES]f64 = [_]f64{0} ** MAX_SAMPLER_VOICES,
    sampler_voice_rate: [MAX_SAMPLER_VOICES]f64 = [_]f64{1} ** MAX_SAMPLER_VOICES,
    sampler_voice_velocity: [MAX_SAMPLER_VOICES]f32 = [_]f32{1} ** MAX_SAMPLER_VOICES,
    sampler_voice_loop: [MAX_SAMPLER_VOICES]bool = [_]bool{false} ** MAX_SAMPLER_VOICES,
    sequencer_step_active: [MAX_SEQUENCER_TRACKS][MAX_SEQUENCER_STEPS]bool = [_][MAX_SEQUENCER_STEPS]bool{[_]bool{false} ** MAX_SEQUENCER_STEPS} ** MAX_SEQUENCER_TRACKS,
    sequencer_step_note: [MAX_SEQUENCER_TRACKS][MAX_SEQUENCER_STEPS]i32 = [_][MAX_SEQUENCER_STEPS]i32{[_]i32{36} ** MAX_SEQUENCER_STEPS} ** MAX_SEQUENCER_TRACKS,
    sequencer_step_velocity: [MAX_SEQUENCER_TRACKS][MAX_SEQUENCER_STEPS]f32 = [_][MAX_SEQUENCER_STEPS]f32{[_]f32{100} ** MAX_SEQUENCER_STEPS} ** MAX_SEQUENCER_TRACKS,
    sequencer_track_target: [MAX_SEQUENCER_TRACKS]u32 = [_]u32{0} ** MAX_SEQUENCER_TRACKS,
    sequencer_prev_active: [MAX_SEQUENCER_TRACKS]bool = [_]bool{false} ** MAX_SEQUENCER_TRACKS,
    sequencer_prev_target: [MAX_SEQUENCER_TRACKS]u32 = [_]u32{0} ** MAX_SEQUENCER_TRACKS,
    sequencer_prev_note: [MAX_SEQUENCER_TRACKS]i32 = [_]i32{0} ** MAX_SEQUENCER_TRACKS,
    sequencer_current_step: u32 = 0,
    sequencer_last_gate: f32 = 0,
    clock_sample_pos: f64 = 0,
    clock_tick_count: u64 = 0,
    clock_pending_ticks: u32 = 0,
    clock_midi_pulse_count: u32 = 0,
};

pub const Connection = struct {
    from_module: u32 = 0,
    from_port: u8 = 0,
    to_module: u32 = 0,
    to_port: u8 = 0,
    active: bool = false,
};

pub const CommandType = enum(u8) {
    add_module,
    remove_module,
    connect,
    disconnect,
    set_param,
    note_on,
    note_off,
    set_master_gain,
    set_tempo,
    make_beat,
    make_beat_slice,
    insert_media,
    fit_media,
    clear_track,
    set_track_volume,
    set_track_pan,
    set_track_mute,
    set_track_solo,
    set_step_velocity,
    set_step_probability,
    set_step_offset,
    transport_play,
    transport_pause,
    transport_stop,
    transport_set_playhead,
    load_sample,
    clear_sample,
    sequencer_set_step,
    sequencer_set_track_target,
    sequencer_clear_pattern,
    clock_pulse,
    clock_start,
    clock_stop,
};

pub const Command = struct {
    cmd_type: CommandType = .add_module,
    module_id: u32 = 0,
    module_type: ModuleType = .oscillator,
    port_a: u8 = 0,
    port_b: u8 = 0,
    target_module: u32 = 0,
    param_index: u8 = 0,
    value_f: f64 = 0,
    value_i: i32 = 0,
    start_tempo: f64 = DEFAULT_TEMPO,
    start_measure: f64 = 0,
    end_tempo: f64 = DEFAULT_TEMPO,
    end_measure: f64 = 0,
    tempo_flags: u8 = 0,
    beat_ptr: ?[*]u8 = null,
    beat_len: u32 = 0,
    beat_track: i32 = 0,
    step_index: u32 = 0,
    steps_per_measure: f64 = 16.0,
    sounds: [MAX_SOUNDS_PER_BEAT]u32 = [_]u32{0} ** MAX_SOUNDS_PER_BEAT,
    sound_count: u8 = 0,
    slice_starts: [MAX_SOUNDS_PER_BEAT]f64 = [_]f64{1.0} ** MAX_SOUNDS_PER_BEAT,
    slice_count: u8 = 0,
};

// ── Lifecycle no-ops ─────────────────────────────────────────────────

pub fn init() bool {
    return false;
}

pub fn deinit() void {}

pub fn isInitialized() bool {
    return false;
}

pub fn resumeDevice() void {}

pub fn pauseDevice() void {}

// ── Command queue no-op ──────────────────────────────────────────────

pub fn pushCommand(cmd: Command) bool {
    _ = cmd;
    return false;
}

// ── Tempo / transport no-ops ─────────────────────────────────────────

pub fn setTempo(start_tempo: f64, start_measure: f64, end_tempo: f64, end_measure: f64, has_end_tempo: bool, has_end_measure: bool) bool {
    _ = start_tempo;
    _ = start_measure;
    _ = end_tempo;
    _ = end_measure;
    _ = has_end_tempo;
    _ = has_end_measure;
    return false;
}

pub fn play() bool {
    return false;
}

pub fn pauseTransport() bool {
    return false;
}

pub fn stop() bool {
    return false;
}

pub fn setPlayhead(measure: f64) bool {
    _ = measure;
    return false;
}

pub fn getPlayhead() f64 {
    return 0;
}

pub fn isPlaying() bool {
    return false;
}

// ── Beat / pattern composition no-ops ────────────────────────────────

pub fn makeBeat(sound_spec: []const u8, track: i32, start_measure: f64, beat: []const u8, steps_per_measure: f64) bool {
    _ = sound_spec;
    _ = track;
    _ = start_measure;
    _ = beat;
    _ = steps_per_measure;
    return false;
}

pub fn makeBeatSlice(sound_spec: []const u8, track: i32, start_measure: f64, beat: []const u8, slice_spec: []const u8, steps_per_measure: f64) bool {
    _ = sound_spec;
    _ = track;
    _ = start_measure;
    _ = beat;
    _ = slice_spec;
    _ = steps_per_measure;
    return false;
}

pub fn insertMedia(sound_spec: []const u8, track: i32, start_measure: f64) bool {
    _ = sound_spec;
    _ = track;
    _ = start_measure;
    return false;
}

pub fn fitMedia(sound_spec: []const u8, track: i32, start_measure: f64, end_measure: f64) bool {
    _ = sound_spec;
    _ = track;
    _ = start_measure;
    _ = end_measure;
    return false;
}

pub fn insertMediaSection(sound_spec: []const u8, track: i32, start_measure: f64, slice_start_raw: f64, slice_end_raw: f64) bool {
    _ = sound_spec;
    _ = track;
    _ = start_measure;
    _ = slice_start_raw;
    _ = slice_end_raw;
    return false;
}

pub fn clearTrack(track: i32, start_measure: f64, end_measure: f64, has_range: bool) bool {
    _ = track;
    _ = start_measure;
    _ = end_measure;
    _ = has_range;
    return false;
}

// ── Track mixer no-ops ───────────────────────────────────────────────

pub fn setTrackVolume(track: i32, volume: f64) bool {
    _ = track;
    _ = volume;
    return false;
}

pub fn setTrackPan(track: i32, pan: f64) bool {
    _ = track;
    _ = pan;
    return false;
}

pub fn setTrackMute(track: i32, muted: bool) bool {
    _ = track;
    _ = muted;
    return false;
}

pub fn setTrackSolo(track: i32, soloed: bool) bool {
    _ = track;
    _ = soloed;
    return false;
}

// ── Step modulation no-ops ───────────────────────────────────────────

pub fn setStepVelocity(track: i32, step: i32, velocity: f64) bool {
    _ = track;
    _ = step;
    _ = velocity;
    return false;
}

pub fn setStepProbability(track: i32, step: i32, probability: f64) bool {
    _ = track;
    _ = step;
    _ = probability;
    return false;
}

pub fn setStepOffset(track: i32, step: i32, offset: f64) bool {
    _ = track;
    _ = step;
    _ = offset;
    return false;
}

pub fn setStep(module_id: u32, track: i32, step: i32, active: bool, note: i32, velocity: f64) bool {
    _ = module_id;
    _ = track;
    _ = step;
    _ = active;
    _ = note;
    _ = velocity;
    return false;
}

pub fn setTrackTarget(module_id: u32, track: i32, target_module: u32) bool {
    _ = module_id;
    _ = track;
    _ = target_module;
    return false;
}

pub fn clearPattern(module_id: u32) bool {
    _ = module_id;
    return false;
}

// ── Clock no-ops ─────────────────────────────────────────────────────

pub fn clockPulse(module_id: u32) bool {
    _ = module_id;
    return false;
}

pub fn clockStart(module_id: u32) bool {
    _ = module_id;
    return false;
}

pub fn clockStop(module_id: u32) bool {
    _ = module_id;
    return false;
}

// ── Sound lookup / sample no-ops ─────────────────────────────────────

pub fn dur(sound_spec: []const u8) f64 {
    _ = sound_spec;
    return 0;
}

pub fn createAudioStretch(sound_spec: []const u8, stretch_factor: f64) u32 {
    _ = sound_spec;
    _ = stretch_factor;
    return 0;
}

pub fn createAudioSlice(sound_spec: []const u8, slice_start_raw: f64, slice_end_raw: f64) u32 {
    _ = sound_spec;
    _ = slice_start_raw;
    _ = slice_end_raw;
    return 0;
}

pub fn loadSound(path: []const u8) u32 {
    _ = path;
    return 0;
}

pub fn loadSample(module_id: u32, slot_raw: i32, path: []const u8, mode: []const u8) bool {
    _ = module_id;
    _ = slot_raw;
    _ = path;
    _ = mode;
    return false;
}

pub fn clearSample(module_id: u32, slot_raw: i32) bool {
    _ = module_id;
    _ = slot_raw;
    return false;
}

// ── Telemetry / counters no-ops ──────────────────────────────────────

pub fn logTelemetry() void {}

pub fn getModuleCount() u32 {
    return 0;
}

pub fn getConnectionCount() u32 {
    return 0;
}

pub fn getCallbackCount() u64 {
    return 0;
}

pub fn getCallbackUs() u64 {
    return 0;
}

pub fn getPeakLevel() f32 {
    return 0;
}

// ── Param introspection no-ops ───────────────────────────────────────

pub fn getParam(module_id: u32, param_idx: u8) f64 {
    _ = module_id;
    _ = param_idx;
    return 0;
}

pub fn getParamCount(module_id: u32) u8 {
    _ = module_id;
    return 0;
}

pub fn getPortCount(module_id: u32) u8 {
    _ = module_id;
    return 0;
}

pub fn getModuleType(module_id: u32) i32 {
    _ = module_id;
    return -1;
}

pub fn getParamMin(module_id: u32, param_idx: u8) f64 {
    _ = module_id;
    _ = param_idx;
    return 0;
}

pub fn getParamMax(module_id: u32, param_idx: u8) f64 {
    _ = module_id;
    _ = param_idx;
    return 0;
}

// ── QJS host registration no-op ──────────────────────────────────────

pub fn registerQjsHostFunctions() void {}
