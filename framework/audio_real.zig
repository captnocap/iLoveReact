//! Audio Subsystem — SDL3 audio stream + LuaJIT DSP engine
//!
//! Three-phase architecture per the research blueprint:
//!   1. Init (main thread): SDL3 device, buffers, LuaJIT VM, module registry
//!   2. Control (QuickJS): graph topology changes via atomic commits to MPSC queue
//!   3. DSP (audio callback): LuaJIT processes graph, writes to Zig-owned buffers
//!
//! The audio callback runs on an OS interrupt thread. It MUST NOT:
//!   - Allocate memory (malloc/free)
//!   - Lock mutexes
//!   - Do file I/O or logging
//!   - Trigger garbage collection
//!
//! All buffers are pre-allocated at init. The callback only reads atomics and
//! processes pre-allocated float buffers via LuaJIT FFI zero-copy pointers.

const std = @import("std");
const log = @import("log.zig");
const zluajit = @import("zluajit");

// SDL3 C imports
const sdl = @cImport({
    @cInclude("SDL3/SDL.h");
});

// ── Constants ───────────────────────────────────────────────────────

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
const SAMPLER_BASE_NOTE: i32 = 36;
const SAMPLER_PITCH_NOTE: i32 = 60;

// ── Port and Param types ────────────────────────────────────────────

pub const PortType = enum(u8) { audio, control, midi };
pub const PortDir = enum(u8) { in_, out };
pub const ParamType = enum(u8) { float, int, bool_, enum_ };
pub const Waveform = enum(u8) { sine, saw, square, triangle, noise };

pub const Port = struct {
    name: [32]u8 = undefined,
    name_len: u8 = 0,
    port_type: PortType = .audio,
    direction: PortDir = .out,
    buffer: [*]f32 = undefined, // points into pre-allocated pool
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

// ── Module ──────────────────────────────────────────────────────────

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

    // DSP state (type-specific, pre-allocated)
    phase: f64 = 0,
    phase2: f64 = 0,
    envelope_stage: u8 = 0, // 0=idle, 1=attack, 2=decay, 3=sustain, 4=release
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

// ── Connection ──────────────────────────────────────────────────────

pub const Connection = struct {
    from_module: u32 = 0,
    from_port: u8 = 0,
    to_module: u32 = 0,
    to_port: u8 = 0,
    active: bool = false,
};

// ── Command queue (MPSC: QuickJS → audio thread) ────────────────────

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

const SampleData = struct {
    active: bool = false,
    samples: ?[]f32 = null,
    sample_rate: u32 = SAMPLE_RATE,
    frame_count: u32 = 0,
    channels: u16 = 1,
};

const SoundKind = enum(u8) { generated, sample };

const TEMPO_FLAG_END_TEMPO: u8 = 1 << 0;
const TEMPO_FLAG_END_MEASURE: u8 = 1 << 1;
const TRACK_FLAG_RANGE: u8 = 1 << 0;

const TempoSegment = struct {
    start_tempo: f64 = DEFAULT_TEMPO,
    start_measure: f64 = 0,
    end_tempo: f64 = DEFAULT_TEMPO,
    end_measure: f64 = 0,
    has_end_tempo: bool = false,
    has_end_measure: bool = false,
};

const BeatPattern = struct {
    active: bool = false,
    track: i32 = 0,
    module_id: u32 = 0,
    start_measure: f64 = 0,
    steps_per_measure: f64 = 16.0,
    beat_ptr: ?[*]u8 = null,
    beat_len: u32 = 0,
    next_step: u32 = 0,
    sounds: [MAX_SOUNDS_PER_BEAT]u32 = [_]u32{0} ** MAX_SOUNDS_PER_BEAT,
    sound_count: u8 = 0,
    slice_starts: [MAX_SOUNDS_PER_BEAT]f64 = [_]f64{1.0} ** MAX_SOUNDS_PER_BEAT,
    slice_count: u8 = 0,
    slice_mode: bool = false,
    velocities: [MAX_PATTERN_STEP_META]f32 = [_]f32{1.0} ** MAX_PATTERN_STEP_META,
    probabilities: [MAX_PATTERN_STEP_META]f32 = [_]f32{1.0} ** MAX_PATTERN_STEP_META,
    offsets: [MAX_PATTERN_STEP_META]f32 = [_]f32{0} ** MAX_PATTERN_STEP_META,
};

const BeatTrack = struct {
    active: bool = false,
    track: i32 = 0,
    module_id: u32 = 0,
    volume: f64 = 1.0,
    pan: f64 = 0,
    muted: bool = false,
    soloed: bool = false,
};

const MediaEvent = struct {
    active: bool = false,
    fired: bool = false,
    repeat: bool = false,
    track: i32 = 0,
    module_id: u32 = 0,
    start_measure: f64 = 0,
    end_measure: f64 = 0,
    next_measure: f64 = 0,
    sound: u32 = 0,
};

const RetiredBeat = struct {
    ptr: ?[*]u8 = null,
    len: u32 = 0,
};

const SoundHandle = struct {
    active: bool = false,
    kind: SoundKind = .generated,
    base_sound: u32 = 0,
    sample_id: u32 = 0,
    stretch: f64 = 1.0,
    slice_start: f64 = 1.0,
    duration: f64 = 0,
};

const SoundInfo = struct {
    kind: SoundKind = .generated,
    base_sound: u32 = 0,
    sample_id: u32 = 0,
    stretch: f64 = 1.0,
    slice_start: f64 = 1.0,
    duration: f64 = 0,
};

const SampleVoice = struct {
    active: bool = false,
    track: i32 = 0,
    sample_id: u32 = 0,
    pos: f64 = 0,
    rate: f64 = 1,
    remaining_frames: f64 = 0,
    gain: f32 = 1,
};

// ── Audio engine state (all pre-allocated) ──────────────────────────

const BufferPool = struct {
    // Pre-allocated float buffers for all module ports
    // MAX_MODULES * MAX_PORTS_PER_MODULE * BUFFER_SIZE floats
    data: []f32,

    fn getBuffer(self: *BufferPool, module_idx: u32, port_idx: u8) [*]f32 {
        const offset = (@as(usize, module_idx) * MAX_PORTS_PER_MODULE + port_idx) * BUFFER_SIZE;
        return self.data.ptr + offset;
    }
};

var g_engine: struct {
    // SDL3 audio
    device_id: sdl.SDL_AudioDeviceID = 0,
    stream: ?*sdl.SDL_AudioStream = null,

    // Module graph
    modules: [MAX_MODULES]Module = undefined,
    module_count: u32 = 0,
    connections: [MAX_CONNECTIONS]Connection = undefined,
    connection_count: u32 = 0,

    // Execution order (topological sort result)
    exec_order: [MAX_MODULES]u32 = undefined,
    exec_count: u32 = 0,
    order_dirty: bool = true,

    // Master output
    master_buffer: [BUFFER_SIZE * MAX_CHANNELS]f32 = [_]f32{0} ** (BUFFER_SIZE * MAX_CHANNELS),
    master_gain: f32 = 0.8,

    // Project transport / tempo automation. Measures are 4/4 for now.
    tempo_segments: [MAX_TEMPO_POINTS]TempoSegment = [_]TempoSegment{TempoSegment{}} ** MAX_TEMPO_POINTS,
    tempo_count: u32 = 0,
    transport_measure: f64 = 0,
    transport_playing: bool = true,
    current_tempo: f64 = DEFAULT_TEMPO,

    // makeBeat patterns are written from control commands and read by the
    // audio callback. Beat bytes are allocated before enqueue and owned here.
    beat_patterns: [MAX_BEAT_PATTERNS]BeatPattern = [_]BeatPattern{BeatPattern{}} ** MAX_BEAT_PATTERNS,
    beat_tracks: [MAX_BEAT_TRACKS]BeatTrack = [_]BeatTrack{BeatTrack{}} ** MAX_BEAT_TRACKS,
    media_events: [MAX_MEDIA_EVENTS]MediaEvent = [_]MediaEvent{MediaEvent{}} ** MAX_MEDIA_EVENTS,
    retired_beats: [MAX_RETIRED_BEATS]RetiredBeat = [_]RetiredBeat{RetiredBeat{}} ** MAX_RETIRED_BEATS,
    retired_beat_count: u32 = 0,
    sound_handles: [MAX_AUDIO_SOUND_HANDLES]SoundHandle = [_]SoundHandle{SoundHandle{}} ** MAX_AUDIO_SOUND_HANDLES,
    next_sound_handle: u32 = STRETCHED_SOUND_BASE,
    samples: [MAX_AUDIO_SAMPLES]SampleData = [_]SampleData{SampleData{}} ** MAX_AUDIO_SAMPLES,
    next_sample_id: u32 = 1,
    sample_voices: [MAX_SAMPLE_VOICES]SampleVoice = [_]SampleVoice{SampleVoice{}} ** MAX_SAMPLE_VOICES,

    // Buffer pool
    buffer_pool: BufferPool = .{ .data = &.{} },
    buffer_storage: [MAX_MODULES * MAX_PORTS_PER_MODULE * BUFFER_SIZE]f32 = [_]f32{0} ** (MAX_MODULES * MAX_PORTS_PER_MODULE * BUFFER_SIZE),

    // Command queue (lock-free SPSC)
    commands: [MAX_COMMAND_QUEUE]Command = undefined,
    cmd_head: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    cmd_tail: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    // LuaJIT DSP engine
    lua_state: ?zluajit.State = null,
    lua_ready: bool = false,

    // Telemetry
    callback_count: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    underrun_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    callback_us: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    initialized: bool = false,
} = .{};

// ── Command queue operations ────────────────────────────────────────

/// Push a command from the control thread (QuickJS). Lock-free.
pub fn pushCommand(cmd: Command) bool {
    const tail = g_engine.cmd_tail.load(.acquire);
    const next = (tail + 1) % MAX_COMMAND_QUEUE;
    if (next == g_engine.cmd_head.load(.acquire)) return false; // full
    g_engine.commands[tail] = cmd;
    g_engine.cmd_tail.store(next, .release);
    return true;
}

/// Pop a command in the audio callback. Lock-free.
fn popCommand() ?Command {
    const head = g_engine.cmd_head.load(.acquire);
    if (head == g_engine.cmd_tail.load(.acquire)) return null;
    const cmd = g_engine.commands[head];
    g_engine.cmd_head.store((head + 1) % MAX_COMMAND_QUEUE, .release);
    return cmd;
}

// ── Tempo map ───────────────────────────────────────────────────────

fn sanitizeTempo(v: f64) f64 {
    if (v != v or v <= 0) return DEFAULT_TEMPO;
    if (v < 1) return 1;
    if (v > 999) return 999;
    return v;
}

fn sanitizeMeasure(v: f64) f64 {
    if (v != v or v < 0) return 0;
    return v;
}

fn apiMeasureToTransport(v: f64) f64 {
    return sanitizeMeasure(v - 1.0);
}

fn applyTempoChange(
    start_tempo_raw: f64,
    start_measure_raw: f64,
    end_tempo_raw: f64,
    end_measure_raw: f64,
    has_end_tempo: bool,
    has_end_measure: bool,
) bool {
    const start_tempo = sanitizeTempo(start_tempo_raw);
    const start_measure = sanitizeMeasure(start_measure_raw);
    const end_tempo = if (has_end_tempo) sanitizeTempo(end_tempo_raw) else start_tempo;
    var end_measure = if (has_end_measure) sanitizeMeasure(end_measure_raw) else start_measure;
    if (end_measure < start_measure) end_measure = start_measure;

    const seg = TempoSegment{
        .start_tempo = start_tempo,
        .start_measure = start_measure,
        .end_tempo = end_tempo,
        .end_measure = end_measure,
        .has_end_tempo = has_end_tempo,
        .has_end_measure = has_end_measure,
    };

    var insert: u32 = g_engine.tempo_count;
    var replace = false;
    const eps = 0.000001;
    for (0..g_engine.tempo_count) |i| {
        const idx: u32 = @intCast(i);
        const existing = g_engine.tempo_segments[idx].start_measure;
        if (@abs(existing - start_measure) <= eps) {
            insert = idx;
            replace = true;
            break;
        }
        if (existing > start_measure) {
            insert = idx;
            break;
        }
    }

    if (replace) {
        g_engine.tempo_segments[insert] = seg;
        return true;
    }

    if (g_engine.tempo_count >= MAX_TEMPO_POINTS) return false;

    var i = g_engine.tempo_count;
    while (i > insert) : (i -= 1) {
        g_engine.tempo_segments[i] = g_engine.tempo_segments[i - 1];
    }
    g_engine.tempo_segments[insert] = seg;
    g_engine.tempo_count += 1;
    return true;
}

fn tempoAtMeasure(measure_raw: f64) f64 {
    const measure = sanitizeMeasure(measure_raw);
    if (g_engine.tempo_count == 0) return DEFAULT_TEMPO;

    var selected = TempoSegment{};
    var has_selected = false;
    for (0..g_engine.tempo_count) |i| {
        const seg = g_engine.tempo_segments[i];
        if (seg.start_measure <= measure) {
            selected = seg;
            has_selected = true;
        } else {
            break;
        }
    }

    if (!has_selected) return DEFAULT_TEMPO;
    if (selected.has_end_tempo and selected.has_end_measure and selected.end_measure > selected.start_measure) {
        if (measure < selected.end_measure) {
            const t = (measure - selected.start_measure) / (selected.end_measure - selected.start_measure);
            return selected.start_tempo + (selected.end_tempo - selected.start_tempo) * t;
        }
        return selected.end_tempo;
    }
    return selected.start_tempo;
}

// ── Beat patterns ───────────────────────────────────────────────────

fn sanitizeTrack(v: i32) i32 {
    return if (v < 0) 0 else v;
}

fn sanitizeUnit(v: f64) f64 {
    if (v != v) return 1.0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

fn sanitizePan(v: f64) f64 {
    if (v != v) return 0;
    if (v < -1) return -1;
    if (v > 1) return 1;
    return v;
}

fn sanitizeStepOffset(v: f64) f64 {
    if (v != v) return 0;
    if (v < -0.5) return -0.5;
    if (v > 0.5) return 0.5;
    return v;
}

fn sanitizeStepsPerMeasure(v: f64) f64 {
    if (v != v or v <= 0) return 16.0;
    if (v < 1) return 1;
    if (v > 1024) return 1024;
    return v;
}

fn beatCharIndex(ch: u8) ?u8 {
    if (ch >= '0' and ch <= '9') return ch - '0';
    if (ch >= 'A' and ch <= 'F') return 10 + (ch - 'A');
    if (ch >= 'a' and ch <= 'f') return 10 + (ch - 'a');
    return null;
}

fn sanitizeStretchFactor(v: f64) f64 {
    if (v != v or v <= 0) return 1.0;
    if (v < 0.01) return 0.01;
    if (v > 100.0) return 100.0;
    return v;
}

fn sanitizeSlicePosition(v: f64) f64 {
    if (v != v) return 1.0;
    if (v < 1.0) return 1.0;
    return v;
}

fn soundHandleIndex(sound: u32) ?usize {
    if (sound < STRETCHED_SOUND_BASE) return null;
    const idx = sound - STRETCHED_SOUND_BASE;
    if (idx >= MAX_AUDIO_SOUND_HANDLES) return null;
    return @intCast(idx);
}

fn generatedSoundBaseDurationMeasures(voice: u32) f64 {
    return switch (@min(voice, 4)) {
        0 => 1.0, // kick
        1 => 0.75, // snare
        2 => 0.375, // hat
        3 => 1.5, // bass
        else => 1.0, // lead
    };
}

fn secondsToMeasures(seconds: f64) f64 {
    return @max(0.0, seconds) * DEFAULT_TEMPO / (60.0 * BEATS_PER_MEASURE);
}

fn measuresToSampleFrames(measures: f64, sample_rate: u32) f64 {
    const seconds = @max(0.0, measures) * (60.0 * BEATS_PER_MEASURE) / DEFAULT_TEMPO;
    return seconds * @as(f64, @floatFromInt(sample_rate));
}

fn sampleDurationMeasures(sample_id: u32) f64 {
    const sample = sampleById(sample_id) orelse return 0;
    return secondsToMeasures(@as(f64, @floatFromInt(sample.frame_count)) / @as(f64, @floatFromInt(sample.sample_rate)));
}

fn resolveSoundInfo(sound: u32) SoundInfo {
    if (soundHandleIndex(sound)) |idx| {
        const handle = g_engine.sound_handles[idx];
        if (handle.active) {
            return .{
                .kind = handle.kind,
                .base_sound = handle.base_sound,
                .sample_id = handle.sample_id,
                .stretch = handle.stretch,
                .slice_start = handle.slice_start,
                .duration = handle.duration,
            };
        }
    }
    const base = @min(sound, 4);
    return .{
        .kind = .generated,
        .base_sound = base,
        .duration = generatedSoundBaseDurationMeasures(base),
    };
}

fn resolveSoundBase(sound: u32) u32 {
    return resolveSoundInfo(sound).base_sound;
}

fn resolveSoundStretch(sound: u32) f64 {
    return resolveSoundInfo(sound).stretch;
}

fn resolveSoundVoice(sound: u32) u8 {
    return @intCast(@min(resolveSoundBase(sound), 4));
}

fn defaultMidiForVoice(voice: u32) i32 {
    return switch (@min(voice, 4)) {
        0 => 36, // kick
        1 => 38, // snare
        2 => 42, // hat
        3 => 36, // bass
        else => 60, // lead
    };
}

fn generatedSoundDecaySeconds(voice: u32) f64 {
    return switch (@min(voice, 4)) {
        0 => 0.28, // kick
        1 => 0.22, // snare
        2 => 0.07, // hat
        3 => 0.55, // bass
        else => 0.38, // lead
    };
}

fn generatedSoundDurationMeasures(sound: u32) f64 {
    return resolveSoundInfo(sound).duration;
}

fn generatedSoundDecaySecondsForDuration(sound: u32, duration: f64) f64 {
    const info = resolveSoundInfo(sound);
    const base_duration = @max(0.000001, generatedSoundBaseDurationMeasures(info.base_sound));
    const duration_scale = @max(0.01, @max(0, duration) / base_duration);
    return generatedSoundDecaySeconds(info.base_sound) * duration_scale;
}

fn generatedSoundDecaySecondsForSound(sound: u32) f64 {
    return generatedSoundDecaySecondsForDuration(sound, generatedSoundDurationMeasures(sound));
}

fn allocateSoundHandle(info: SoundInfo) u32 {
    var idx: ?usize = null;
    if (g_engine.next_sound_handle >= STRETCHED_SOUND_BASE) {
        const next_idx = g_engine.next_sound_handle - STRETCHED_SOUND_BASE;
        if (next_idx < MAX_AUDIO_SOUND_HANDLES and !g_engine.sound_handles[next_idx].active) {
            idx = @intCast(next_idx);
        }
    }
    if (idx == null) {
        for (0..MAX_AUDIO_SOUND_HANDLES) |i| {
            if (!g_engine.sound_handles[i].active) {
                idx = i;
                break;
            }
        }
    }

    const slot = idx orelse return if (info.kind == .generated) info.base_sound else 0;
    const handle = STRETCHED_SOUND_BASE + @as(u32, @intCast(slot));
    g_engine.sound_handles[slot] = .{
        .active = true,
        .kind = info.kind,
        .base_sound = @min(info.base_sound, 4),
        .sample_id = info.sample_id,
        .stretch = sanitizeStretchFactor(info.stretch),
        .slice_start = sanitizeSlicePosition(info.slice_start),
        .duration = @max(0, info.duration),
    };
    g_engine.next_sound_handle = handle + 1;
    return handle;
}

fn retireBeatBytes(ptr: ?[*]u8, len: u32) void {
    if (ptr == null or len == 0) return;
    if (g_engine.retired_beat_count >= MAX_RETIRED_BEATS) return;
    g_engine.retired_beats[g_engine.retired_beat_count] = .{ .ptr = ptr, .len = len };
    g_engine.retired_beat_count += 1;
}

fn freeBeatBytes() void {
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &g_engine.beat_patterns[i];
        if (p.beat_ptr) |ptr| {
            std.heap.c_allocator.free(ptr[0..p.beat_len]);
        }
        p.* = .{};
    }
    for (0..MAX_BEAT_TRACKS) |i| g_engine.beat_tracks[i] = .{};
    for (0..MAX_MEDIA_EVENTS) |i| g_engine.media_events[i] = .{};
    for (0..g_engine.retired_beat_count) |i| {
        const retired = g_engine.retired_beats[i];
        if (retired.ptr) |ptr| {
            std.heap.c_allocator.free(ptr[0..retired.len]);
        }
        g_engine.retired_beats[i] = .{};
    }
    g_engine.retired_beat_count = 0;
    for (0..MAX_AUDIO_SOUND_HANDLES) |i| g_engine.sound_handles[i] = .{};
    g_engine.next_sound_handle = STRETCHED_SOUND_BASE;
}

fn sampleIndex(sample_id: u32) ?usize {
    if (sample_id == 0) return null;
    const idx = sample_id - 1;
    if (idx >= MAX_AUDIO_SAMPLES) return null;
    return @intCast(idx);
}

fn sampleById(sample_id: u32) ?*const SampleData {
    const idx = sampleIndex(sample_id) orelse return null;
    const sample = &g_engine.samples[idx];
    if (!sample.active or sample.samples == null or sample.frame_count == 0) return null;
    return sample;
}

fn freeSampleStorage() void {
    for (0..MAX_AUDIO_SAMPLES) |i| {
        if (g_engine.samples[i].samples) |samples| {
            std.heap.c_allocator.free(samples);
        }
        g_engine.samples[i] = .{};
    }
    g_engine.next_sample_id = 1;
    for (0..MAX_SAMPLE_VOICES) |i| g_engine.sample_voices[i] = .{};
}

fn freeSampleById(sample_id: u32) void {
    const idx = sampleIndex(sample_id) orelse return;
    if (g_engine.samples[idx].samples) |samples| {
        std.heap.c_allocator.free(samples);
    }
    g_engine.samples[idx] = .{};
    for (0..MAX_SAMPLE_VOICES) |i| {
        if (g_engine.sample_voices[i].sample_id == sample_id) g_engine.sample_voices[i] = .{};
    }
}

fn allocateSample(samples: []f32, sample_rate: u32, channels: u16) u32 {
    var idx: ?usize = null;
    if (g_engine.next_sample_id > 0) {
        const next_idx = g_engine.next_sample_id - 1;
        if (next_idx < MAX_AUDIO_SAMPLES and !g_engine.samples[next_idx].active) {
            idx = @intCast(next_idx);
        }
    }
    if (idx == null) {
        for (0..MAX_AUDIO_SAMPLES) |i| {
            if (!g_engine.samples[i].active) {
                idx = i;
                break;
            }
        }
    }

    const slot = idx orelse return 0;
    const id = @as(u32, @intCast(slot)) + 1;
    g_engine.samples[slot] = .{
        .active = true,
        .samples = samples,
        .sample_rate = if (sample_rate == 0) SAMPLE_RATE else sample_rate,
        .frame_count = @intCast(@min(samples.len, std.math.maxInt(u32))),
        .channels = channels,
    };
    g_engine.next_sample_id = id + 1;
    return id;
}

fn findChunk(data: []const u8, name: *const [4]u8) ?[]const u8 {
    if (data.len < 12 or !std.mem.eql(u8, data[0..4], "RIFF") or !std.mem.eql(u8, data[8..12], "WAVE")) return null;
    var offset: usize = 12;
    while (offset + 8 <= data.len) {
        const chunk_id = data[offset .. offset + 4];
        const chunk_size = std.mem.readInt(u32, data[offset + 4 .. offset + 8][0..4], .little);
        const start = offset + 8;
        const end = start + @as(usize, chunk_size);
        if (end > data.len) return null;
        if (std.mem.eql(u8, chunk_id, name)) return data[start..end];
        offset = end + (chunk_size & 1);
    }
    return null;
}

fn decodeWavToMonoF32(path: []const u8) ?SampleData {
    const bytes = std.fs.cwd().readFileAlloc(std.heap.c_allocator, path, 256 * 1024 * 1024) catch return null;
    defer std.heap.c_allocator.free(bytes);

    const fmt = findChunk(bytes, "fmt ") orelse return null;
    const pcm = findChunk(bytes, "data") orelse return null;
    if (fmt.len < 16) return null;

    const audio_format = std.mem.readInt(u16, fmt[0..2], .little);
    const channels = std.mem.readInt(u16, fmt[2..4], .little);
    const sample_rate = std.mem.readInt(u32, fmt[4..8], .little);
    const bits_per_sample = std.mem.readInt(u16, fmt[14..16], .little);
    if (channels == 0 or channels > 2 or sample_rate == 0) return null;

    const bytes_per_sample: usize = bits_per_sample / 8;
    if (bytes_per_sample == 0) return null;
    const bytes_per_frame = bytes_per_sample * @as(usize, channels);
    if (bytes_per_frame == 0) return null;
    const frame_count = pcm.len / bytes_per_frame;
    if (frame_count == 0 or frame_count > std.math.maxInt(u32)) return null;

    const out = std.heap.c_allocator.alloc(f32, frame_count) catch return null;
    errdefer std.heap.c_allocator.free(out);

    for (0..frame_count) |frame| {
        var sum: f64 = 0;
        for (0..channels) |ch| {
            const offset = frame * bytes_per_frame + @as(usize, ch) * bytes_per_sample;
            const sample = switch (audio_format) {
                1 => switch (bits_per_sample) {
                    8 => (@as(f64, @floatFromInt(pcm[offset])) - 128.0) / 128.0,
                    16 => @as(f64, @floatFromInt(std.mem.readInt(i16, pcm[offset .. offset + 2][0..2], .little))) / 32768.0,
                    24 => blk: {
                        var v: i32 = @as(i32, pcm[offset]) |
                            (@as(i32, pcm[offset + 1]) << 8) |
                            (@as(i32, pcm[offset + 2]) << 16);
                        if ((v & 0x800000) != 0) v |= ~@as(i32, 0xFFFFFF);
                        break :blk @as(f64, @floatFromInt(v)) / 8388608.0;
                    },
                    32 => @as(f64, @floatFromInt(std.mem.readInt(i32, pcm[offset .. offset + 4][0..4], .little))) / 2147483648.0,
                    else => return null,
                },
                3 => switch (bits_per_sample) {
                    32 => @as(f64, @floatCast(@as(f32, @bitCast(std.mem.readInt(u32, pcm[offset .. offset + 4][0..4], .little))))),
                    else => return null,
                },
                else => return null,
            };
            sum += sample;
        }
        out[frame] = @floatCast(@max(-1.0, @min(1.0, sum / @as(f64, @floatFromInt(channels)))));
    }

    return .{
        .active = true,
        .samples = out,
        .sample_rate = sample_rate,
        .frame_count = @intCast(frame_count),
        .channels = channels,
    };
}

fn findBeatTrack(track: i32) ?*BeatTrack {
    const t = sanitizeTrack(track);
    for (0..MAX_BEAT_TRACKS) |i| {
        const bt = &g_engine.beat_tracks[i];
        if (bt.active and bt.track == t) return bt;
    }
    return null;
}

fn ensureBeatTrack(track: i32) ?*BeatTrack {
    const t = sanitizeTrack(track);
    if (findBeatTrack(t)) |bt| return bt;

    if (g_engine.module_count >= MAX_MODULES) return null;

    var slot: ?*BeatTrack = null;
    for (0..MAX_BEAT_TRACKS) |i| {
        if (!g_engine.beat_tracks[i].active) {
            slot = &g_engine.beat_tracks[i];
            break;
        }
    }
    const bt = slot orelse return null;

    var m = &g_engine.modules[g_engine.module_count];
    m.* = Module{};
    m.id = BEAT_TRACK_MODULE_BASE + @as(u32, @intCast(t));
    m.slot_index = g_engine.module_count;
    m.module_type = .pocket_voice;
    m.active = true;
    initModulePorts(m);
    g_engine.module_count += 1;
    g_engine.order_dirty = true;

    bt.* = .{
        .active = true,
        .track = t,
        .module_id = m.id,
        .volume = 1.0,
        .pan = 0,
        .muted = false,
        .soloed = false,
    };
    return bt;
}

fn findBeatTrackByModule(module_id: u32) ?*BeatTrack {
    for (0..MAX_BEAT_TRACKS) |i| {
        const bt = &g_engine.beat_tracks[i];
        if (bt.active and bt.module_id == module_id) return bt;
    }
    return null;
}

fn anyTrackSoloed() bool {
    for (0..MAX_BEAT_TRACKS) |i| {
        const bt = &g_engine.beat_tracks[i];
        if (bt.active and bt.soloed) return true;
    }
    return false;
}

fn trackAudible(bt: *const BeatTrack) bool {
    if (bt.muted) return false;
    if (anyTrackSoloed() and !bt.soloed) return false;
    return bt.volume > 0;
}

fn rangesOverlap(start_a: f64, end_a: f64, start_b: f64, end_b: f64) bool {
    return start_a < end_b and start_b < end_a;
}

fn clearTrackRange(track_raw: i32, start_raw: f64, end_raw: f64, has_range: bool) void {
    const track = sanitizeTrack(track_raw);
    const start = sanitizeMeasure(start_raw);
    const end = sanitizeMeasure(end_raw);

    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &g_engine.beat_patterns[i];
        if (!p.active or p.track != track) continue;
        var remove = !has_range;
        if (has_range) {
            const pattern_end = p.start_measure + (@as(f64, @floatFromInt(p.beat_len)) / @max(1.0, p.steps_per_measure));
            remove = rangesOverlap(p.start_measure, pattern_end, start, end);
        }
        if (remove) {
            retireBeatBytes(p.beat_ptr, p.beat_len);
            p.* = .{};
        }
    }

    for (0..MAX_MEDIA_EVENTS) |i| {
        const ev = &g_engine.media_events[i];
        if (!ev.active or ev.track != track) continue;
        var remove = !has_range;
        if (has_range) {
            const ev_end = if (ev.repeat) ev.end_measure else ev.start_measure + generatedSoundDurationMeasures(ev.sound);
            remove = rangesOverlap(ev.start_measure, ev_end, start, end);
        }
        if (remove) ev.* = .{};
    }

    if (!has_range) {
        for (0..MAX_SAMPLE_VOICES) |i| {
            if (g_engine.sample_voices[i].active and g_engine.sample_voices[i].track == track) {
                g_engine.sample_voices[i] = .{};
            }
        }
    }
}

fn applyTrackControl(cmd: Command) void {
    const bt = ensureBeatTrack(cmd.beat_track) orelse return;
    switch (cmd.cmd_type) {
        .set_track_volume => bt.volume = sanitizeUnit(cmd.value_f),
        .set_track_pan => bt.pan = sanitizePan(cmd.value_f),
        .set_track_mute => bt.muted = cmd.value_i != 0,
        .set_track_solo => bt.soloed = cmd.value_i != 0,
        else => {},
    }
}

fn latestPatternForTrack(track_raw: i32) ?*BeatPattern {
    const track = sanitizeTrack(track_raw);
    var best: ?*BeatPattern = null;
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &g_engine.beat_patterns[i];
        if (!p.active or p.track != track) continue;
        if (best == null or p.start_measure >= best.?.start_measure) best = p;
    }
    return best;
}

fn applyStepControl(cmd: Command) void {
    const p = latestPatternForTrack(cmd.beat_track) orelse return;
    if (cmd.step_index >= MAX_PATTERN_STEP_META) return;
    const idx: usize = @intCast(cmd.step_index);
    switch (cmd.cmd_type) {
        .set_step_velocity => p.velocities[idx] = @floatCast(sanitizeUnit(cmd.value_f)),
        .set_step_probability => p.probabilities[idx] = @floatCast(sanitizeUnit(cmd.value_f)),
        .set_step_offset => p.offsets[idx] = @floatCast(sanitizeStepOffset(cmd.value_f)),
        else => {},
    }
}

fn stepRandom01(track: i32, step: u32) f64 {
    var x: u32 = @as(u32, @bitCast(track)) ^ (step *% 747796405) ^ 0x9e3779b9;
    x = (x ^ (x >> 16)) *% 2246822519;
    x = (x ^ (x >> 13)) *% 3266489917;
    x ^= x >> 16;
    return @as(f64, @floatFromInt(x)) / 4294967295.0;
}

fn resetTimelineCursors() void {
    const measure = g_engine.transport_measure;
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &g_engine.beat_patterns[i];
        if (!p.active) continue;
        if (measure <= p.start_measure) {
            p.next_step = 0;
            continue;
        }
        const elapsed = (measure - p.start_measure) * @max(1.0, p.steps_per_measure);
        var next_step: u32 = @intFromFloat(@floor(elapsed));
        if (next_step > p.beat_len) next_step = p.beat_len;
        p.next_step = next_step;
    }

    for (0..MAX_MEDIA_EVENTS) |i| {
        const ev = &g_engine.media_events[i];
        if (!ev.active) continue;
        if (!ev.repeat) {
            ev.fired = measure > ev.start_measure;
            continue;
        }
        const sound_duration = @max(0.000001, generatedSoundDurationMeasures(ev.sound));
        ev.fired = false;
        ev.next_measure = ev.start_measure;
        while (ev.next_measure + 0.000001 < measure and ev.next_measure + 0.000001 < ev.end_measure) {
            ev.next_measure += sound_duration;
        }
        if (ev.next_measure + 0.000001 >= ev.end_measure) ev.fired = true;
    }
}

fn applyMakeBeat(cmd: Command) void {
    if (cmd.beat_ptr == null or cmd.beat_len == 0 or cmd.sound_count == 0) return;
    const track = sanitizeTrack(cmd.beat_track);
    const bt = ensureBeatTrack(track) orelse {
        retireBeatBytes(cmd.beat_ptr, cmd.beat_len);
        return;
    };
    const start_measure = sanitizeMeasure(cmd.start_measure);
    const steps_per_measure = sanitizeStepsPerMeasure(cmd.steps_per_measure);

    var slot: ?*BeatPattern = null;
    const eps = 0.000001;
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &g_engine.beat_patterns[i];
        if (p.active and p.track == track and @abs(p.start_measure - start_measure) <= eps) {
            slot = p;
            break;
        }
    }
    if (slot == null) {
        for (0..MAX_BEAT_PATTERNS) |i| {
            if (!g_engine.beat_patterns[i].active) {
                slot = &g_engine.beat_patterns[i];
                break;
            }
        }
    }
    const p = slot orelse {
        retireBeatBytes(cmd.beat_ptr, cmd.beat_len);
        return;
    };
    retireBeatBytes(p.beat_ptr, p.beat_len);

    var next_step: u32 = 0;
    if (g_engine.transport_measure > start_measure) {
        const elapsed = (g_engine.transport_measure - start_measure) * steps_per_measure;
        if (elapsed > 0) next_step = @intFromFloat(@floor(elapsed));
        if (next_step > cmd.beat_len) next_step = cmd.beat_len;
    }

    p.* = .{
        .active = true,
        .track = track,
        .module_id = bt.module_id,
        .start_measure = start_measure,
        .steps_per_measure = steps_per_measure,
        .beat_ptr = cmd.beat_ptr,
        .beat_len = cmd.beat_len,
        .next_step = next_step,
        .sounds = cmd.sounds,
        .sound_count = cmd.sound_count,
        .slice_starts = cmd.slice_starts,
        .slice_count = cmd.slice_count,
        .slice_mode = cmd.cmd_type == .make_beat_slice,
    };
}

fn applyInsertMedia(cmd: Command) void {
    if (cmd.sound_count == 0) return;
    const track = sanitizeTrack(cmd.beat_track);
    const bt = ensureBeatTrack(track) orelse return;
    const start_measure = sanitizeMeasure(cmd.start_measure);
    const end_measure = sanitizeMeasure(cmd.end_measure);

    var slot: ?*MediaEvent = null;
    const eps = 0.000001;
    for (0..MAX_MEDIA_EVENTS) |i| {
        const ev = &g_engine.media_events[i];
        if (ev.active and ev.track == track and @abs(ev.start_measure - start_measure) <= eps) {
            slot = ev;
            break;
        }
    }
    if (slot == null) {
        for (0..MAX_MEDIA_EVENTS) |i| {
            if (!g_engine.media_events[i].active) {
                slot = &g_engine.media_events[i];
                break;
            }
        }
    }

    const ev = slot orelse return;
    ev.* = .{
        .active = true,
        .fired = false,
        .repeat = cmd.cmd_type == .fit_media,
        .track = track,
        .module_id = bt.module_id,
        .start_measure = start_measure,
        .end_measure = end_measure,
        .next_measure = start_measure,
        .sound = cmd.sounds[0],
    };
}

fn triggerBeatVoice(module_id: u32, sound: u32, slice_start: f64, duration: ?f64, velocity: f64) void {
    if (findModule(module_id)) |m| {
        const vel = sanitizeUnit(velocity);
        if (vel <= 0) return;
        const track = findBeatTrackByModule(module_id);
        if (track) |bt| {
            if (!trackAudible(bt)) return;
            if (m.param_count > 5) m.params[5].value = 0.8;
        }
        const info = resolveSoundInfo(sound);
        if (info.kind == .sample) {
            if (track) |bt| triggerSampleSound(bt.track, sound, slice_start, duration, velocity);
            return;
        }
        const voice = resolveSoundVoice(sound);
        if (m.param_count > 0) m.params[0].value = @floatFromInt(voice);
        if (m.param_count > 2) {
            m.params[2].value = if (duration) |d| generatedSoundDecaySecondsForDuration(sound, d) else generatedSoundDecaySecondsForSound(sound);
        }
        const note_freq = 440.0 * std.math.pow(f64, 2.0, (@as(f64, @floatFromInt(defaultMidiForVoice(voice))) - 69.0) / 12.0);
        m.base_freq = note_freq;
        const slice_measure = apiMeasureToTransport(info.slice_start + (apiMeasureToTransport(slice_start) / @max(0.01, info.stretch)));
        m.trigger_time = slice_measure * BEATS_PER_MEASURE * 60.0 / @max(1.0, g_engine.current_tempo);
        preparePocketVoiceTrigger(m, vel);
        m.envelope_stage = 1;
        m.envelope_level = vel;
    }
}

fn triggerSampleSound(track_raw: i32, sound: u32, slice_start: f64, duration: ?f64, velocity: f64) void {
    const info = resolveSoundInfo(sound);
    if (info.kind != .sample or info.sample_id == 0) return;
    const sample = sampleById(info.sample_id) orelse return;
    const vel = sanitizeUnit(velocity);
    if (vel <= 0) return;

    var idx: ?usize = null;
    for (0..MAX_SAMPLE_VOICES) |i| {
        if (!g_engine.sample_voices[i].active) {
            idx = i;
            break;
        }
    }
    const voice_idx = idx orelse 0;
    const stretch = @max(0.01, info.stretch);
    const effective_start = info.slice_start + ((sanitizeSlicePosition(slice_start) - 1.0) / stretch);
    const source_pos = measuresToSampleFrames(effective_start - 1.0, sample.sample_rate);
    const source_end = @as(f64, @floatFromInt(sample.frame_count));
    if (source_pos >= source_end) return;
    const requested_duration = @max(0.0, duration orelse info.duration);
    const output_frames = @min(
        measuresToSampleFrames(requested_duration, SAMPLE_RATE),
        @max(0.0, (source_end - source_pos) / (@as(f64, @floatFromInt(sample.sample_rate)) / @as(f64, @floatFromInt(SAMPLE_RATE)) / stretch)),
    );
    if (output_frames <= 0) return;

    g_engine.sample_voices[voice_idx] = .{
        .active = true,
        .track = sanitizeTrack(track_raw),
        .sample_id = info.sample_id,
        .pos = source_pos,
        .rate = @as(f64, @floatFromInt(sample.sample_rate)) / @as(f64, @floatFromInt(SAMPLE_RATE)) / stretch,
        .remaining_frames = output_frames,
        .gain = @floatCast(vel),
    };
}

fn mixSampleVoices(num_samples: u32) void {
    for (0..MAX_SAMPLE_VOICES) |voice_idx| {
        var v = &g_engine.sample_voices[voice_idx];
        if (!v.active) continue;
        const sample = sampleById(v.sample_id) orelse {
            v.active = false;
            continue;
        };
        const frames = sample.samples orelse {
            v.active = false;
            continue;
        };
        const bt = findBeatTrack(v.track);
        const audible = if (bt) |track| trackAudible(track) else true;
        const volume: f32 = if (audible) (if (bt) |track| @floatCast(sanitizeUnit(track.volume)) else 1.0) else 0.0;
        const pan: f32 = if (bt) |track| @floatCast(sanitizePan(track.pan)) else 0.0;
        const left_gain: f32 = if (pan > 0) 1.0 - pan else 1.0;
        const right_gain: f32 = if (pan < 0) 1.0 + pan else 1.0;
        const frame_count = @as(usize, sample.frame_count);

        for (0..num_samples) |i| {
            if (v.remaining_frames <= 0 or v.pos >= @as(f64, @floatFromInt(frame_count))) {
                v.active = false;
                break;
            }
            const idx: usize = @intFromFloat(@floor(v.pos));
            const next_idx = if (idx + 1 < frame_count) idx + 1 else idx;
            const frac: f32 = @floatCast(v.pos - @floor(v.pos));
            const s0 = frames[idx];
            const s1 = frames[next_idx];
            const sample_value = (s0 + (s1 - s0) * frac) * v.gain * volume * g_engine.master_gain;
            const out = i * @as(usize, MAX_CHANNELS);
            g_engine.master_buffer[out] += sample_value * left_gain;
            g_engine.master_buffer[out + 1] += sample_value * right_gain;
            v.pos += v.rate;
            v.remaining_frames -= 1.0;
        }
    }
}

fn scheduleMediaEvents() void {
    const measure = g_engine.transport_measure;
    for (0..MAX_MEDIA_EVENTS) |i| {
        const ev = &g_engine.media_events[i];
        if (!ev.active or ev.fired) continue;
        if (!ev.repeat) {
            if (measure + 0.000001 < ev.start_measure) continue;
            triggerBeatVoice(ev.module_id, ev.sound, 1.0, null, 1.0);
            ev.fired = true;
            continue;
        }

        const sound_duration = @max(0.000001, generatedSoundDurationMeasures(ev.sound));
        while (measure + 0.000001 >= ev.next_measure and ev.next_measure + 0.000001 < ev.end_measure) {
            const remaining = ev.end_measure - ev.next_measure;
            triggerBeatVoice(ev.module_id, ev.sound, 1.0, @min(sound_duration, remaining), 1.0);
            ev.next_measure += sound_duration;
        }
        if (ev.next_measure + 0.000001 >= ev.end_measure) ev.fired = true;
    }
}

fn scheduleBeatPatterns() void {
    const measure = g_engine.transport_measure;
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &g_engine.beat_patterns[i];
        if (!p.active or p.beat_ptr == null or p.beat_len == 0 or p.next_step >= p.beat_len) continue;
        const beat = p.beat_ptr.?;
        while (p.next_step < p.beat_len) {
            const meta_idx: ?usize = if (p.next_step < MAX_PATTERN_STEP_META) @intCast(p.next_step) else null;
            const step_offset = if (meta_idx) |mi| @as(f64, @floatCast(p.offsets[mi])) else 0;
            const step_measure = p.start_measure + ((@as(f64, @floatFromInt(p.next_step)) + step_offset) / p.steps_per_measure);
            if (measure + 0.000001 < step_measure) break;

            const ch = beat[p.next_step];
            if (ch == '-') {
                // rest
            } else if (ch == '+') {
                // tie: keep the previous sound decaying/sustaining, no retrigger
            } else if (beatCharIndex(ch)) |idx| {
                const velocity = if (meta_idx) |mi| @as(f64, @floatCast(p.velocities[mi])) else 1.0;
                const probability = if (meta_idx) |mi| @as(f64, @floatCast(p.probabilities[mi])) else 1.0;
                if (p.slice_mode) {
                    if (idx < p.slice_count and p.sound_count > 0 and stepRandom01(p.track, p.next_step) <= probability) {
                        triggerBeatVoice(p.module_id, p.sounds[0], p.slice_starts[idx], null, velocity);
                    }
                } else if (idx < p.sound_count and stepRandom01(p.track, p.next_step) <= probability) {
                    triggerBeatVoice(p.module_id, p.sounds[idx], 1.0, null, velocity);
                }
            }

            p.next_step += 1;
        }
    }
}

fn parseSoundSpec(spec: []const u8, out: *[MAX_SOUNDS_PER_BEAT]u32) u8 {
    var count: u8 = 0;
    var value: u32 = 0;
    var in_number = false;

    for (spec) |ch| {
        if (ch >= '0' and ch <= '9') {
            const digit: u32 = ch - '0';
            value = if (value > (std.math.maxInt(u32) - digit) / 10) std.math.maxInt(u32) else value * 10 + digit;
            in_number = true;
        } else if (in_number) {
            out[count] = value;
            count += 1;
            if (count >= MAX_SOUNDS_PER_BEAT) return count;
            value = 0;
            in_number = false;
        }
    }
    if (in_number and count < MAX_SOUNDS_PER_BEAT) {
        out[count] = value;
        count += 1;
    }
    return count;
}

fn parseSliceSpec(spec: []const u8, out: *[MAX_SOUNDS_PER_BEAT]f64) u8 {
    var count: u8 = 0;
    var it = std.mem.tokenizeAny(u8, spec, ", []\t\r\n");
    while (it.next()) |part| {
        const v = std.fmt.parseFloat(f64, part) catch continue;
        out[count] = if (v != v or v <= 0) 1.0 else v;
        count += 1;
        if (count >= MAX_SOUNDS_PER_BEAT) break;
    }
    return count;
}

// ── Module initialization helpers ───────────────────────────────────

fn initModulePorts(m: *Module) void {
    switch (m.module_type) {
        .oscillator => {
            addPort(m, "audio_out", .audio, .out);
            addPort(m, "freq_in", .control, .in_);
            addPort(m, "fm_in", .audio, .in_);
            addParam(m, "waveform", .enum_, 0, 4, 1); // sine=0, saw=1, square=2, tri=3, noise=4
            addParam(m, "frequency", .float, 20, 20000, 440);
            addParam(m, "detune", .float, -100, 100, 0);
            addParam(m, "gain", .float, 0, 1, 0.8);
            addParam(m, "fm_amount", .float, 0, 1000, 0);
        },
        .filter => {
            addPort(m, "audio_in", .audio, .in_);
            addPort(m, "audio_out", .audio, .out);
            addPort(m, "cutoff_in", .control, .in_);
            addParam(m, "cutoff", .float, 20, 20000, 1000);
            addParam(m, "resonance", .float, 0, 1, 0);
            addParam(m, "mode", .enum_, 0, 2, 0); // lowpass=0, highpass=1, bandpass=2
        },
        .amplifier => {
            addPort(m, "audio_in", .audio, .in_);
            addPort(m, "audio_out", .audio, .out);
            addPort(m, "gain_in", .control, .in_);
            addParam(m, "gain", .float, 0, 2, 1);
        },
        .mixer => {
            addPort(m, "in_1", .audio, .in_);
            addPort(m, "in_2", .audio, .in_);
            addPort(m, "in_3", .audio, .in_);
            addPort(m, "in_4", .audio, .in_);
            addPort(m, "audio_out", .audio, .out);
            addParam(m, "gain_1", .float, 0, 2, 1);
            addParam(m, "gain_2", .float, 0, 2, 1);
            addParam(m, "gain_3", .float, 0, 2, 1);
            addParam(m, "gain_4", .float, 0, 2, 1);
        },
        .delay => {
            addPort(m, "audio_in", .audio, .in_);
            addPort(m, "audio_out", .audio, .out);
            addParam(m, "time", .float, 0.001, 2.0, 0.25);
            addParam(m, "feedback", .float, 0, 0.95, 0.4);
            addParam(m, "mix", .float, 0, 1, 0.3);
        },
        .envelope => {
            addPort(m, "audio_in", .audio, .in_);
            addPort(m, "audio_out", .audio, .out);
            addPort(m, "gate_in", .control, .in_);
            addParam(m, "attack", .float, 0.001, 5.0, 0.01);
            addParam(m, "decay", .float, 0.001, 5.0, 0.1);
            addParam(m, "sustain", .float, 0, 1, 0.7);
            addParam(m, "release", .float, 0.001, 10.0, 0.3);
        },
        .lfo => {
            addPort(m, "control_out", .control, .out);
            addParam(m, "rate", .float, 0.01, 100, 1);
            addParam(m, "depth", .float, 0, 1, 1);
            addParam(m, "waveform", .enum_, 0, 3, 0);
        },
        .clock => {
            addPort(m, "gate_out", .control, .out);
            addPort(m, "audio_out", .audio, .out);
            addParam(m, "bpm", .float, 20, 300, 120);
            addParam(m, "division", .enum_, 0, 5, 1); // 0=1/4, 1=1/8, 2=1/16, 3=1/32, 4=1/2, 5=1/1
            addParam(m, "swing", .float, 0, 1, 0);
            addParam(m, "running", .bool_, 0, 1, 0);
        },
        .sequencer => {
            addPort(m, "clock_in", .control, .in_);
            addPort(m, "gate_out", .control, .out);
            addParam(m, "steps", .int, 1, @floatFromInt(MAX_SEQUENCER_STEPS), 16);
            addParam(m, "tracks", .int, 1, @floatFromInt(MAX_SEQUENCER_TRACKS), 4);
            addParam(m, "bpm", .float, 20, 300, 120);
            addParam(m, "running", .bool_, 0, 1, 1);
        },
        .sampler => {
            addPort(m, "audio_out", .audio, .out);
            addPort(m, "gate_in", .control, .in_);
            addParam(m, "gain", .float, 0, 2, 1);
            addParam(m, "loop", .bool_, 0, 1, 0);
            addParam(m, "slot", .int, 1, @floatFromInt(MAX_SAMPLER_SLOTS), 1);
        },
        .custom => {},
        .pocket_voice => {
            addPort(m, "audio_out", .audio, .out);
            addParam(m, "voice", .enum_, 0, 4, 0); // kick, snare, hat, bass, lead
            addParam(m, "tone", .float, 0, 1, 0.5);
            addParam(m, "decay", .float, 0.02, 1.5, 0.25);
            addParam(m, "color", .float, 0, 1, 0.4);
            addParam(m, "drive", .float, 0, 1, 0.2);
            addParam(m, "gain", .float, 0, 1.5, 0.8);
        },
    }
}

fn addPort(m: *Module, name: []const u8, port_type: PortType, direction: PortDir) void {
    if (m.port_count >= MAX_PORTS_PER_MODULE) return;
    var p = &m.ports[m.port_count];
    const len = @min(name.len, 31);
    @memcpy(p.name[0..len], name[0..len]);
    p.name_len = @intCast(len);
    p.port_type = port_type;
    p.direction = direction;
    p.buffer = g_engine.buffer_pool.getBuffer(m.slot_index, m.port_count);
    m.port_count += 1;
}

fn addParam(m: *Module, name: []const u8, param_type: ParamType, min: f64, max: f64, default: f64) void {
    if (m.param_count >= MAX_PARAMS_PER_MODULE) return;
    var p = &m.params[m.param_count];
    const len = @min(name.len, 31);
    @memcpy(p.name[0..len], name[0..len]);
    p.name_len = @intCast(len);
    p.param_type = param_type;
    p.min = min;
    p.max = max;
    p.default = default;
    p.value = default;
    m.param_count += 1;
}

// ── DSP processing (called from audio callback) ─────────────────────

fn processOscillator(m: *Module, num_samples: u32) void {
    const out_buf = m.ports[0].buffer; // audio_out
    const wf: Waveform = @enumFromInt(@as(u8, @intFromFloat(m.params[0].value)));
    var freq = m.params[1].value; // frequency
    const detune = m.params[2].value;
    const gain = m.params[3].value;
    const fm_amt = m.params[4].value;
    var phase = m.phase;
    const inv_sr = 1.0 / @as(f64, @floatFromInt(SAMPLE_RATE));

    // Detune: cents → multiplier
    const detune_mult = std.math.pow(f64, 2.0, detune / 1200.0);
    freq *= detune_mult;

    // Check freq control input
    if (m.port_count > 1) {
        const freq_in = m.ports[1].buffer; // freq_in
        const fv = freq_in[0];
        if (fv > 0) freq = @floatCast(fv);
    }

    const fm_buf = if (m.port_count > 2) m.ports[2].buffer else null; // fm_in

    for (0..num_samples) |i| {
        var f = freq;
        if (fm_buf) |fb| {
            f += @as(f64, @floatCast(fb[i])) * fm_amt;
        }

        const sample: f32 = @floatCast(generateSample(phase, wf) * gain);
        out_buf[i] = sample;
        phase += f * inv_sr;
        phase -= @floor(phase);
    }
    m.phase = phase;
}

fn generateSample(phase: f64, wf: Waveform) f64 {
    const TWO_PI = 2.0 * std.math.pi;
    return switch (wf) {
        .sine => @sin(phase * TWO_PI),
        .saw => 2.0 * (phase - @floor(phase + 0.5)),
        .square => if (@mod(phase, 1.0) < 0.5) @as(f64, 1.0) else @as(f64, -1.0),
        .triangle => 4.0 * @abs(phase - @floor(phase + 0.5)) - 1.0,
        .noise => blk: {
            // Simple LCG noise
            const x = @as(u32, @truncate(@as(u64, @bitCast(@as(i64, @intFromFloat(phase * 2147483647.0))))));
            break :blk @as(f64, @floatFromInt(@as(i32, @bitCast(x *% 1103515245 +% 12345)))) / 2147483647.0;
        },
    };
}

fn wrapPhase(v: f64) f64 {
    const wrapped = v - @floor(v);
    return if (wrapped < 0) wrapped + 1.0 else wrapped;
}

fn nextNoise(seed: *u32) f64 {
    seed.* = seed.* *% 1664525 +% 1013904223;
    return (@as(f64, @floatFromInt(seed.* >> 1)) / 1073741824.0) - 1.0;
}

fn seedUnit(seed: u32) f64 {
    return @as(f64, @floatFromInt(seed & 0x00ffffff)) / 16777215.0;
}

fn clamp01(v: f64) f64 {
    if (v != v) return 0;
    return @min(1.0, @max(0.0, v));
}

fn pulseSample(phase: f64, duty_raw: f64) f64 {
    const duty = @min(0.95, @max(0.05, duty_raw));
    return if (@mod(phase, 1.0) < duty) @as(f64, 1.0) else @as(f64, -1.0);
}

fn preparePocketVoiceTrigger(m: *Module, velocity: f64) void {
    const vel = sanitizeUnit(velocity);
    m.noise_seed = m.noise_seed *% 1664525 +% 1013904223;
    m.trigger_velocity = vel;
    m.trigger_variant = seedUnit(m.noise_seed);

    // Avoid identical oscillator starts on repeated one-shots without adding a
    // new public parameter. The offset is tiny for drums, wider for tonal voices.
    const spread: f64 = if (m.param_count > 0 and m.params[0].value >= 3.0) 0.19 else 0.045;
    m.phase = wrapPhase(m.trigger_variant * spread);
    m.phase2 = wrapPhase((1.0 - m.trigger_variant) * spread * 1.73);
}

fn softClip(x: f64) f64 {
    return x / (1.0 + @abs(x));
}

fn processFilter(m: *Module, num_samples: u32) void {
    const in_buf = m.ports[0].buffer;
    const out_buf = m.ports[1].buffer;
    var cutoff = m.params[0].value;
    const reso = m.params[1].value;
    var y1 = m.filter_y1;
    var y2 = m.filter_y2;

    // Check cutoff control input
    if (m.port_count > 2) {
        const cv = m.ports[2].buffer[0];
        if (cv > 0) cutoff = @floatCast(cv);
    }

    // Simple 2-pole resonant filter (SVF approximation)
    const f_norm = 2.0 * @sin(std.math.pi * cutoff / @as(f64, @floatFromInt(SAMPLE_RATE)));
    const q = 1.0 - reso * 0.99;

    for (0..num_samples) |i| {
        const x: f64 = @floatCast(in_buf[i]);
        const hp = x - y1 - q * (y1 - y2);
        y1 += f_norm * hp;
        y2 += f_norm * (y1 - y2);
        // mode: 0=lp, 1=hp, 2=bp
        const mode: u8 = @intFromFloat(m.params[2].value);
        out_buf[i] = @floatCast(switch (mode) {
            0 => y2, // lowpass
            1 => hp, // highpass
            else => y1 - y2, // bandpass
        });
    }
    m.filter_y1 = y1;
    m.filter_y2 = y2;
}

fn processAmplifier(m: *Module, num_samples: u32) void {
    const in_buf = m.ports[0].buffer;
    const out_buf = m.ports[1].buffer;
    var gain = m.params[0].value;

    // Check gain control input
    if (m.port_count > 2) {
        const gv = m.ports[2].buffer[0];
        if (gv > 0) gain = @floatCast(gv);
    }

    const g: f32 = @floatCast(gain);
    for (0..num_samples) |i| {
        out_buf[i] = in_buf[i] * g;
    }
}

fn processMixer(m: *Module, num_samples: u32) void {
    const out_idx: u8 = 4; // 5th port is output
    if (m.port_count <= out_idx) return;
    const out_buf = m.ports[out_idx].buffer;

    // Clear output
    for (0..num_samples) |i| out_buf[i] = 0;

    // Mix up to 4 inputs
    for (0..4) |ch| {
        if (ch >= m.port_count - 1) break;
        const in_buf = m.ports[ch].buffer;
        const g: f32 = @floatCast(m.params[ch].value);
        for (0..num_samples) |i| {
            out_buf[i] += in_buf[i] * g;
        }
    }
}

fn processEnvelope(m: *Module, num_samples: u32) void {
    const in_buf = m.ports[0].buffer;
    const out_buf = m.ports[1].buffer;
    const gate_val = m.ports[2].buffer[0]; // gate control
    const attack = m.params[0].value;
    const decay = m.params[1].value;
    const sustain = m.params[2].value;
    const release = m.params[3].value;
    var stage = m.envelope_stage;
    var level = m.envelope_level;
    const inv_sr = 1.0 / @as(f64, @floatFromInt(SAMPLE_RATE));

    // Gate on/off detection
    if (gate_val > 0.5 and stage == 0) stage = 1; // attack
    if (gate_val < 0.5 and stage > 0 and stage < 4) stage = 4; // release

    for (0..num_samples) |i| {
        switch (stage) {
            1 => { // attack
                level += inv_sr / @max(attack, 0.001);
                if (level >= 1.0) {
                    level = 1.0;
                    stage = 2;
                }
            },
            2 => { // decay
                level -= (1.0 - sustain) * inv_sr / @max(decay, 0.001);
                if (level <= sustain) {
                    level = sustain;
                    stage = 3;
                }
            },
            3 => {}, // sustain — hold level
            4 => { // release
                level -= level * inv_sr / @max(release, 0.001);
                if (level < 0.001) {
                    level = 0;
                    stage = 0;
                }
            },
            else => {},
        }
        out_buf[i] = in_buf[i] * @as(f32, @floatCast(level));
    }
    m.envelope_stage = stage;
    m.envelope_level = level;
}

fn processLfo(m: *Module, num_samples: u32) void {
    const out_buf = m.ports[0].buffer;
    const rate = m.params[0].value;
    const depth = m.params[1].value;
    const wf: Waveform = @enumFromInt(@as(u8, @intFromFloat(m.params[2].value)));
    var phase = m.phase;
    const inv_sr = 1.0 / @as(f64, @floatFromInt(SAMPLE_RATE));

    for (0..num_samples) |i| {
        const sample = generateSample(phase, wf) * depth;
        out_buf[i] = @floatCast(sample);
        phase += rate * inv_sr;
        phase -= @floor(phase);
    }
    m.phase = phase;
}

// Pre-allocated delay line storage (shared across all delay modules)
const MAX_DELAY_SAMPLES = SAMPLE_RATE * 2; // 2 seconds max
const MAX_DELAY_MODULES = 8;
var g_delay_storage: [MAX_DELAY_MODULES][MAX_DELAY_SAMPLES]f32 = [_][MAX_DELAY_SAMPLES]f32{[_]f32{0} ** MAX_DELAY_SAMPLES} ** MAX_DELAY_MODULES;
var g_delay_alloc_count: u32 = 0;

fn processDelay(m: *Module, num_samples: u32) void {
    const in_buf = m.ports[0].buffer;
    const out_buf = m.ports[1].buffer;
    const delay_time = m.params[0].value; // seconds
    const feedback = m.params[1].value;
    const mix = m.params[2].value;

    // Lazy-allocate from pool
    if (m.delay_buffer == null) {
        if (g_delay_alloc_count < MAX_DELAY_MODULES) {
            m.delay_buffer = &g_delay_storage[g_delay_alloc_count];
            g_delay_alloc_count += 1;
        } else return;
    }
    const dbuf = m.delay_buffer.?;

    const delay_samples: u32 = @intFromFloat(@min(
        @as(f64, @floatFromInt(MAX_DELAY_SAMPLES - 1)),
        delay_time * @as(f64, @floatFromInt(SAMPLE_RATE)),
    ));
    if (delay_samples == 0) {
        @memcpy(out_buf[0..num_samples], in_buf[0..num_samples]);
        return;
    }

    var wp = m.delay_write_pos;
    for (0..num_samples) |i| {
        const rp = (wp + MAX_DELAY_SAMPLES - delay_samples) % MAX_DELAY_SAMPLES;
        const delayed: f64 = @floatCast(dbuf[rp]);
        const dry: f64 = @floatCast(in_buf[i]);
        dbuf[wp] = @floatCast(dry + delayed * feedback);
        out_buf[i] = @floatCast(dry * (1.0 - mix) + delayed * mix);
        wp = (wp + 1) % MAX_DELAY_SAMPLES;
    }
    m.delay_write_pos = wp;
}

fn clockDivisionBeats(raw: f64) f64 {
    const idx: u8 = @intFromFloat(@max(0.0, @min(5.0, raw)));
    return switch (idx) {
        0 => 1.0, // 1/4
        1 => 0.5, // 1/8
        2 => 0.25, // 1/16
        3 => 0.125, // 1/32
        4 => 2.0, // 1/2
        else => 4.0, // 1/1
    };
}

fn clockMidiPulsesPerTick(raw: f64) u32 {
    const pulses = @max(1.0, @round(clockDivisionBeats(raw) * 24.0));
    return @intFromFloat(@min(96.0, pulses));
}

fn queueClockTick(m: *Module) void {
    if (m.clock_pending_ticks < 1024) m.clock_pending_ticks += 1;
}

fn processClock(m: *Module, num_samples: u32) void {
    const gate_out = m.ports[0].buffer;
    const audio_out = m.ports[1].buffer;
    for (0..num_samples) |i| {
        gate_out[i] = 0;
        audio_out[i] = 0;
    }

    const running = m.param_count <= 3 or m.params[3].value >= 0.5;
    if (!running) return;

    var ticked = false;
    if (m.clock_pending_ticks > 0) {
        m.clock_pending_ticks -= 1;
        ticked = true;
        audio_out[0] = 1;
        m.clock_tick_count +%= 1;
    } else {
        const bpm = if (g_engine.tempo_count > 0) g_engine.current_tempo else m.params[0].value;
        const division = clockDivisionBeats(m.params[1].value);
        const swing = @max(0.0, @min(1.0, m.params[2].value));
        const ticks_per_second = @max(0.001, (bpm / 60.0) / division);
        const samples_per_tick = @as(f64, @floatFromInt(SAMPLE_RATE)) / ticks_per_second;

        const start_sample_pos = m.clock_sample_pos;
        var sample_pos = start_sample_pos;
        var tick_count = m.clock_tick_count;
        for (0..num_samples) |i| {
            const next_tick = tick_count + 1;
            const next_swing = if ((next_tick % 2) != 0) swing * samples_per_tick * 0.5 else 0.0;
            const next_tick_start = @as(f64, @floatFromInt(next_tick)) * samples_per_tick + next_swing;
            if (sample_pos >= next_tick_start) {
                tick_count +%= 1;
                ticked = true;
                audio_out[i] = 1;
                break;
            }
            sample_pos += 1.0;
        }
        m.clock_sample_pos = start_sample_pos + @as(f64, @floatFromInt(num_samples));
        if (ticked) m.clock_tick_count = tick_count;
    }

    if (ticked) {
        for (0..num_samples) |i| gate_out[i] = 1;
    }
}

fn sequencerFireTick(m: *Module) void {
    const steps: u32 = @intFromFloat(@max(1.0, @min(@as(f64, @floatFromInt(MAX_SEQUENCER_STEPS)), m.params[0].value)));
    const tracks: u32 = @intFromFloat(@max(1.0, @min(@as(f64, @floatFromInt(MAX_SEQUENCER_TRACKS)), m.params[1].value)));

    for (0..MAX_SEQUENCER_TRACKS) |track| {
        if (m.sequencer_prev_active[track]) {
            if (findModule(m.sequencer_prev_target[track])) |target| {
                releaseModuleNote(target, m.sequencer_prev_note[track]);
            }
            m.sequencer_prev_active[track] = false;
        }
    }

    m.sequencer_current_step = (m.sequencer_current_step + 1) % steps;
    const step: usize = @intCast(m.sequencer_current_step);

    for (0..tracks) |track_u32| {
        const track: usize = @intCast(track_u32);
        const target_id = m.sequencer_track_target[track];
        if (target_id == 0 or !m.sequencer_step_active[track][step]) continue;
        if (findModule(target_id)) |target| {
            const note = m.sequencer_step_note[track][step];
            const velocity = @as(f64, @floatCast(m.sequencer_step_velocity[track][step])) / 127.0;
            triggerModuleNote(target, note, velocity);
            m.sequencer_prev_active[track] = true;
            m.sequencer_prev_target[track] = target_id;
            m.sequencer_prev_note[track] = note;
        }
    }
}

fn processSequencer(m: *Module, num_samples: u32) void {
    const gate_out = m.ports[1].buffer;
    var ticked = false;

    if (inputHasConnection(m.id, 0)) {
        const gate = m.ports[0].buffer[0];
        ticked = gate > 0.5 and m.sequencer_last_gate <= 0.5;
        m.sequencer_last_gate = gate;
    } else if (g_engine.transport_playing and (m.param_count <= 3 or m.params[3].value >= 0.5)) {
        const bpm = if (g_engine.tempo_count > 0) g_engine.current_tempo else m.params[2].value;
        const ticks_per_second = @max(0.001, bpm / 60.0 * 4.0);
        var phase = m.phase;
        const inc = ticks_per_second / @as(f64, @floatFromInt(SAMPLE_RATE));
        for (0..num_samples) |_| {
            phase += inc;
            if (phase >= 1.0) {
                phase -= @floor(phase);
                ticked = true;
                break;
            }
        }
        m.phase = phase;
    }

    if (ticked) sequencerFireTick(m);
    const gate: f32 = if (ticked) 1.0 else 0.0;
    for (0..num_samples) |i| gate_out[i] = gate;
}

fn samplerSlotForNote(note: i32) ?u8 {
    const slot = note - SAMPLER_BASE_NOTE;
    if (slot < 0 or slot >= @as(i32, @intCast(MAX_SAMPLER_SLOTS))) return null;
    return @intCast(slot);
}

fn samplerSelectedSlot(m: *const Module) u8 {
    if (m.param_count <= 2) return 0;
    const raw = m.params[2].value;
    if (raw != raw) return 0;
    const one_based: i32 = @intFromFloat(@max(1.0, @min(@as(f64, @floatFromInt(MAX_SAMPLER_SLOTS)), raw)));
    return @intCast(one_based - 1);
}

fn startSamplerVoice(m: *Module, slot: u8, note: i32, velocity: f64) void {
    if (slot >= MAX_SAMPLER_SLOTS) return;
    const sample_id = m.sampler_slots[slot];
    if (sampleById(sample_id) == null) return;

    var voice_idx: ?usize = null;
    for (0..MAX_SAMPLER_VOICES) |i| {
        if (!m.sampler_voice_active[i]) {
            voice_idx = i;
            break;
        }
    }
    const idx = voice_idx orelse 0;
    const sample = sampleById(sample_id) orelse return;
    const pitch = std.math.pow(f64, 2.0, (@as(f64, @floatFromInt(note - SAMPLER_PITCH_NOTE))) / 12.0);
    const rate = pitch * (@as(f64, @floatFromInt(sample.sample_rate)) / @as(f64, @floatFromInt(SAMPLE_RATE)));
    m.sampler_voice_active[idx] = true;
    m.sampler_voice_slot[idx] = slot;
    m.sampler_voice_note[idx] = note;
    m.sampler_voice_pos[idx] = 0;
    m.sampler_voice_rate[idx] = @max(0.000001, rate);
    m.sampler_voice_velocity[idx] = @floatCast(sanitizeUnit(velocity));
    m.sampler_voice_loop[idx] = m.sampler_slot_loop[slot] or (m.param_count > 1 and m.params[1].value >= 0.5);
}

fn stopSamplerLoopingVoices(m: *Module, note: i32) void {
    for (0..MAX_SAMPLER_VOICES) |i| {
        if (m.sampler_voice_active[i] and (note < 0 or m.sampler_voice_note[i] == note) and m.sampler_voice_loop[i]) {
            m.sampler_voice_active[i] = false;
        }
    }
}

fn processSampler(m: *Module, num_samples: u32) void {
    const out_buf = m.ports[0].buffer;
    for (0..num_samples) |i| out_buf[i] = 0;

    if (m.port_count > 1) {
        const gate = m.ports[1].buffer[0];
        if (gate > 0.5 and m.envelope_stage == 0) {
            const slot = samplerSelectedSlot(m);
            startSamplerVoice(m, slot, SAMPLER_BASE_NOTE + @as(i32, @intCast(slot)), 1.0);
            m.envelope_stage = 1;
        } else if (gate <= 0.5 and m.envelope_stage != 0) {
            m.envelope_stage = 0;
        }
    }

    const gain: f32 = if (m.param_count > 0) @floatCast(@max(0.0, @min(2.0, m.params[0].value))) else 1.0;
    for (0..MAX_SAMPLER_VOICES) |voice_idx| {
        if (!m.sampler_voice_active[voice_idx]) continue;
        const slot = m.sampler_voice_slot[voice_idx];
        if (slot >= MAX_SAMPLER_SLOTS) {
            m.sampler_voice_active[voice_idx] = false;
            continue;
        }
        const sample = sampleById(m.sampler_slots[slot]) orelse {
            m.sampler_voice_active[voice_idx] = false;
            continue;
        };
        const frames = sample.samples orelse {
            m.sampler_voice_active[voice_idx] = false;
            continue;
        };
        const frame_count = @as(usize, sample.frame_count);
        if (frame_count == 0) {
            m.sampler_voice_active[voice_idx] = false;
            continue;
        }

        var pos = m.sampler_voice_pos[voice_idx];
        const rate = m.sampler_voice_rate[voice_idx];
        const vel = m.sampler_voice_velocity[voice_idx] * gain;
        for (0..num_samples) |i| {
            if (pos >= @as(f64, @floatFromInt(frame_count))) {
                if (m.sampler_voice_loop[voice_idx]) {
                    pos = @mod(pos, @as(f64, @floatFromInt(frame_count)));
                } else {
                    m.sampler_voice_active[voice_idx] = false;
                    break;
                }
            }

            const idx: usize = @intFromFloat(@floor(pos));
            const next_idx = if (idx + 1 < frame_count) idx + 1 else idx;
            const frac: f32 = @floatCast(pos - @floor(pos));
            const s0 = frames[idx];
            const s1 = frames[next_idx];
            out_buf[i] += (s0 + (s1 - s0) * frac) * vel;
            pos += rate;
        }
        m.sampler_voice_pos[voice_idx] = pos;
    }
}

fn processPocketVoice(m: *Module, num_samples: u32) void {
    const out_buf = m.ports[0].buffer;
    var stage = m.envelope_stage;
    var env = m.envelope_level;

    if (stage == 0 or env <= 0.00001) {
        for (0..num_samples) |i| out_buf[i] = 0;
        m.envelope_stage = 0;
        m.envelope_level = 0;
        return;
    }

    const voice: u8 = @intFromFloat(@min(4.0, @max(0.0, m.params[0].value)));
    const tone_param = @min(1.0, @max(0.0, m.params[1].value));
    const decay_param = @max(0.01, m.params[2].value);
    const color_param = @min(1.0, @max(0.0, m.params[3].value));
    const drive_param = @min(1.0, @max(0.0, m.params[4].value));
    const gain = @max(0.0, m.params[5].value);
    const trig_vel = clamp01(m.trigger_velocity);
    const variant = clamp01(m.trigger_variant);
    const var_bi = variant * 2.0 - 1.0;
    const tone = clamp01(tone_param + var_bi * 0.16 + (trig_vel - 0.75) * 0.18);
    const color = clamp01(color_param + var_bi * 0.22 + (trig_vel - 0.65) * 0.16);
    const drive = clamp01(drive_param + (trig_vel - 0.5) * 0.25 + @abs(var_bi) * 0.12);
    const decay = @max(0.01, decay_param * (0.78 + trig_vel * 0.34 + variant * 0.18));
    const decay_coeff = std.math.exp(-1.0 / (decay * @as(f64, @floatFromInt(SAMPLE_RATE))));
    const dt = 1.0 / @as(f64, @floatFromInt(SAMPLE_RATE));

    var phase = m.phase;
    var phase2 = m.phase2;
    var t = m.trigger_time;
    const base_freq = if (m.base_freq > 0.0) m.base_freq else 110.0;
    var lp = m.filter_y1;
    var hp = m.filter_y2;
    var seed = if (m.noise_seed == 0) @as(u32, 1) else m.noise_seed;

    for (0..num_samples) |i| {
        if (stage == 0 or env <= 0.00005) {
            out_buf[i] = 0;
            env = 0;
            stage = 0;
            continue;
        }

        const noise = nextNoise(&seed);
        var sample: f64 = 0;

        switch (voice) {
            0 => { // kick
                const drop = std.math.exp(-t * (15.0 + tone * 58.0 + trig_vel * 18.0));
                const snap = std.math.exp(-t * (70.0 + color * 90.0));
                const freq = 34.0 + tone * 92.0 + drop * (96.0 + color * 105.0 + trig_vel * 34.0) + base_freq * (0.035 + variant * 0.045);
                const body = @sin(phase * 2.0 * std.math.pi);
                const upper = @sin(phase2 * 2.0 * std.math.pi) * snap * (0.04 + drive * 0.12);
                const click = noise * std.math.exp(-t * (95.0 + variant * 110.0)) * (0.035 + color * 0.16 + trig_vel * 0.06);
                sample = (body * (1.0 + trig_vel * 0.24) + upper + click) * env;
                phase = wrapPhase(phase + freq * dt);
                phase2 = wrapPhase(phase2 + freq * (1.9 + color * 1.4) * dt);
            },
            1 => { // snare
                const freq = 118.0 + tone * 245.0 + base_freq * (0.025 + variant * 0.05);
                const ring_env = std.math.exp(-t * (8.0 + color * 24.0));
                const ring = (@sin(phase * 2.0 * std.math.pi) * (0.34 + trig_vel * 0.18) +
                    @sin(phase2 * 2.0 * std.math.pi) * (0.12 + variant * 0.22)) * ring_env;
                lp += (noise - lp) * (0.08 + tone * 0.17 + variant * 0.08);
                const bright = noise - lp * (0.18 + (1.0 - color) * 0.22);
                const body = bright * (0.62 + color * 0.62 + trig_vel * 0.12);
                sample = (body + ring * (0.28 + (1.0 - color) * 0.32)) * env;
                phase = wrapPhase(phase + freq * dt);
                phase2 = wrapPhase(phase2 + freq * (1.54 + variant * 0.53) * dt);
            },
            2 => { // hat
                const freq1 = 1650.0 + tone * 3600.0 + variant * 900.0;
                const freq2 = 2700.0 + color * 4600.0 + trig_vel * 800.0;
                lp += (noise - lp) * (0.035 + tone * 0.04);
                hp += ((noise - lp) - hp) * (0.30 + color * 0.32 + trig_vel * 0.12);
                const metal = pulseSample(phase, 0.42 + var_bi * 0.12) * (0.22 + tone * 0.22) +
                    pulseSample(phase2, 0.31 + color * 0.16) * (0.18 + variant * 0.24);
                const tick = noise * std.math.exp(-t * (180.0 + color * 180.0)) * (0.08 + trig_vel * 0.12);
                sample = (hp * (0.75 + color * 0.38) + metal * (0.38 + drive * 0.32) + tick) * env * (0.7 + color * 0.42);
                phase = wrapPhase(phase + freq1 * dt);
                phase2 = wrapPhase(phase2 + freq2 * dt);
            },
            3 => { // bass
                const freq = @max(32.0, base_freq * (0.45 + tone * 0.92 + var_bi * 0.035));
                const wobble = 1.0 + std.math.exp(-t * (6.0 + color * 8.0)) * (0.035 + trig_vel * 0.07);
                const saw = generateSample(phase, .saw);
                const sub = @sin(phase2 * 2.0 * std.math.pi);
                const bite = pulseSample(phase, 0.42 + color * 0.16) * (0.08 + drive * 0.18);
                sample = softClip((saw * (0.44 + tone * 0.32) + sub * (0.54 + (1.0 - color) * 0.18) + bite) * (1.0 + drive * 4.8)) * env * (0.70 + color * 0.42);
                phase = wrapPhase(phase + freq * wobble * dt);
                phase2 = wrapPhase(phase2 + freq * 0.5 * dt);
            },
            else => { // lead
                const freq = @max(70.0, base_freq * (0.78 + tone * 0.48 + var_bi * 0.025));
                const pulse = pulseSample(phase, 0.34 + color * 0.28 + var_bi * 0.08);
                const saw = generateSample(phase2, .saw);
                const vibrato = 1.0 + @sin(t * (5.0 + variant * 8.0)) * (0.002 + color * 0.018);
                const shimmer = @sin(phase * 2.0 * std.math.pi * 2.01) * (0.04 + trig_vel * 0.06) * std.math.exp(-t * (5.0 + color * 12.0));
                sample = softClip((pulse * (0.42 + color * 0.25) + saw * (0.36 + tone * 0.18) + shimmer) * (1.0 + drive * 5.5)) * env;
                phase = wrapPhase(phase + freq * vibrato * dt);
                phase2 = wrapPhase(phase2 + freq * (0.996 + color * 0.026 + variant * 0.012) * dt);
            },
        }

        out_buf[i] = @floatCast(sample * gain);
        env *= decay_coeff;
        t += dt;

        if (env <= 0.00005) {
            env = 0;
            stage = 0;
        }
    }

    m.phase = phase;
    m.phase2 = phase2;
    m.trigger_time = t;
    m.envelope_level = env;
    m.envelope_stage = stage;
    m.filter_y1 = lp;
    m.filter_y2 = hp;
    m.noise_seed = seed;
}

fn processModule(m: *Module, num_samples: u32) void {
    if (!m.active) return;
    switch (m.module_type) {
        .oscillator => processOscillator(m, num_samples),
        .filter => processFilter(m, num_samples),
        .amplifier => processAmplifier(m, num_samples),
        .mixer => processMixer(m, num_samples),
        .envelope => processEnvelope(m, num_samples),
        .lfo => processLfo(m, num_samples),
        .delay => processDelay(m, num_samples),
        .clock => processClock(m, num_samples),
        .sequencer => processSequencer(m, num_samples),
        .sampler => processSampler(m, num_samples),
        .pocket_voice => processPocketVoice(m, num_samples),
        .custom => {},
    }
}

// ── Graph routing ───────────────────────────────────────────────────

fn routeConnections(num_samples: u32) void {
    for (0..g_engine.connection_count) |i| {
        const conn = &g_engine.connections[i];
        if (!conn.active) continue;

        const from_mod = findModule(conn.from_module) orelse continue;
        const to_mod = findModule(conn.to_module) orelse continue;
        if (conn.from_port >= from_mod.port_count) continue;
        if (conn.to_port >= to_mod.port_count) continue;

        const src = from_mod.ports[conn.from_port].buffer;
        const dst = to_mod.ports[conn.to_port].buffer;

        // Copy or add (for mixing multiple inputs into one port)
        for (0..num_samples) |j| {
            dst[j] += src[j];
        }
    }
}

fn clearInputBuffers(num_samples: u32) void {
    for (0..g_engine.module_count) |i| {
        const m = &g_engine.modules[i];
        if (!m.active) continue;
        for (0..m.port_count) |p| {
            if (m.ports[p].direction == .in_) {
                const buf = m.ports[p].buffer;
                for (0..num_samples) |j| buf[j] = 0;
            }
        }
    }
}

// ── Topological sort ────────────────────────────────────────────────

fn rebuildExecOrder() void {
    // Simple topological sort via dependency counting
    var in_degree: [MAX_MODULES]u32 = [_]u32{0} ** MAX_MODULES;
    var id_to_idx: [MAX_MODULES]u32 = [_]u32{0} ** MAX_MODULES;

    // Map module IDs to indices
    for (0..g_engine.module_count) |i| {
        id_to_idx[i] = g_engine.modules[i].id;
    }

    // Count incoming connections per module
    for (0..g_engine.connection_count) |i| {
        const conn = &g_engine.connections[i];
        if (!conn.active) continue;
        for (0..g_engine.module_count) |j| {
            if (g_engine.modules[j].id == conn.to_module and g_engine.modules[j].active) {
                in_degree[j] += 1;
            }
        }
    }

    // BFS: start with modules that have no inputs
    var queue: [MAX_MODULES]u32 = undefined;
    var q_head: u32 = 0;
    var q_tail: u32 = 0;
    g_engine.exec_count = 0;

    for (0..g_engine.module_count) |i| {
        if (g_engine.modules[i].active and in_degree[i] == 0) {
            queue[q_tail] = @intCast(i);
            q_tail += 1;
        }
    }

    while (q_head < q_tail) {
        const idx = queue[q_head];
        q_head += 1;
        g_engine.exec_order[g_engine.exec_count] = idx;
        g_engine.exec_count += 1;

        const mod_id = g_engine.modules[idx].id;
        for (0..g_engine.connection_count) |i| {
            const conn = &g_engine.connections[i];
            if (!conn.active or conn.from_module != mod_id) continue;
            for (0..g_engine.module_count) |j| {
                if (g_engine.modules[j].id == conn.to_module and g_engine.modules[j].active) {
                    in_degree[j] -= 1;
                    if (in_degree[j] == 0) {
                        queue[q_tail] = @intCast(j);
                        q_tail += 1;
                    }
                }
            }
        }
    }

    g_engine.order_dirty = false;
}

fn findModule(id: u32) ?*Module {
    for (0..g_engine.module_count) |i| {
        if (g_engine.modules[i].id == id and g_engine.modules[i].active) return &g_engine.modules[i];
    }
    return null;
}

fn inputHasConnection(module_id: u32, port: u8) bool {
    for (0..g_engine.connection_count) |i| {
        const c = &g_engine.connections[i];
        if (c.active and c.to_module == module_id and c.to_port == port) return true;
    }
    return false;
}

fn triggerModuleNote(m: *Module, note: i32, velocity: f64) void {
    const note_freq = 440.0 * std.math.pow(f64, 2.0, (@as(f64, @floatFromInt(note)) - 69.0) / 12.0);
    switch (m.module_type) {
        .oscillator => {
            if (m.param_count > 1) m.params[1].value = note_freq;
        },
        .pocket_voice => {
            m.base_freq = note_freq;
            m.trigger_time = 0;
            preparePocketVoiceTrigger(m, velocity);
            if (m.param_count > 5) m.params[5].value = 0.8 * sanitizeUnit(velocity);
        },
        .sampler => {
            if (samplerSlotForNote(note)) |slot| {
                startSamplerVoice(m, slot, note, velocity);
            } else {
                startSamplerVoice(m, samplerSelectedSlot(m), note, velocity);
            }
        },
        else => {},
    }
    m.envelope_stage = 1;
    m.envelope_level = if (m.module_type == .pocket_voice) sanitizeUnit(velocity) else 0;
}

fn releaseModuleNote(m: *Module, note: i32) void {
    if (m.module_type == .sampler) stopSamplerLoopingVoices(m, note);
    m.envelope_stage = 4;
}

// ── Command processing (in audio callback) ──────────────────────────

fn processCommands() void {
    while (popCommand()) |cmd| {
        switch (cmd.cmd_type) {
            .add_module => {
                if (g_engine.module_count >= MAX_MODULES) continue;
                var m = &g_engine.modules[g_engine.module_count];
                m.* = Module{};
                m.id = cmd.module_id;
                m.slot_index = g_engine.module_count;
                m.module_type = cmd.module_type;
                m.active = true;
                initModulePorts(m);
                g_engine.module_count += 1;
                g_engine.order_dirty = true;
            },
            .remove_module => {
                if (findModule(cmd.module_id)) |m| {
                    m.active = false;
                    // Remove connections involving this module
                    for (0..g_engine.connection_count) |i| {
                        const c = &g_engine.connections[i];
                        if (c.from_module == cmd.module_id or c.to_module == cmd.module_id) {
                            c.active = false;
                        }
                    }
                    g_engine.order_dirty = true;
                }
            },
            .connect => {
                if (g_engine.connection_count >= MAX_CONNECTIONS) continue;
                var c = &g_engine.connections[g_engine.connection_count];
                c.from_module = cmd.module_id;
                c.from_port = cmd.port_a;
                c.to_module = cmd.target_module;
                c.to_port = cmd.port_b;
                c.active = true;
                g_engine.connection_count += 1;
                g_engine.order_dirty = true;
            },
            .disconnect => {
                for (0..g_engine.connection_count) |i| {
                    const c = &g_engine.connections[i];
                    if (c.from_module == cmd.module_id and c.from_port == cmd.port_a and
                        c.to_module == cmd.target_module and c.to_port == cmd.port_b)
                    {
                        c.active = false;
                        g_engine.order_dirty = true;
                    }
                }
            },
            .set_param => {
                if (findModule(cmd.module_id)) |m| {
                    if (cmd.param_index < m.param_count) {
                        m.params[cmd.param_index].value = cmd.value_f;
                    }
                }
            },
            .note_on => {
                if (findModule(cmd.module_id)) |m| {
                    triggerModuleNote(m, cmd.value_i, cmd.value_f);
                }
            },
            .note_off => {
                if (findModule(cmd.module_id)) |m| {
                    releaseModuleNote(m, cmd.value_i);
                }
            },
            .set_master_gain => {
                g_engine.master_gain = @floatCast(cmd.value_f);
            },
            .set_tempo => {
                _ = applyTempoChange(
                    cmd.start_tempo,
                    cmd.start_measure,
                    cmd.end_tempo,
                    cmd.end_measure,
                    (cmd.tempo_flags & TEMPO_FLAG_END_TEMPO) != 0,
                    (cmd.tempo_flags & TEMPO_FLAG_END_MEASURE) != 0,
                );
            },
            .make_beat => {
                applyMakeBeat(cmd);
            },
            .make_beat_slice => {
                applyMakeBeat(cmd);
            },
            .insert_media => {
                applyInsertMedia(cmd);
            },
            .fit_media => {
                applyInsertMedia(cmd);
            },
            .clear_track => {
                clearTrackRange(cmd.beat_track, cmd.start_measure, cmd.end_measure, (cmd.tempo_flags & TRACK_FLAG_RANGE) != 0);
            },
            .set_track_volume, .set_track_pan, .set_track_mute, .set_track_solo => {
                applyTrackControl(cmd);
            },
            .set_step_velocity, .set_step_probability, .set_step_offset => {
                applyStepControl(cmd);
            },
            .transport_play => {
                g_engine.transport_playing = true;
            },
            .transport_pause => {
                g_engine.transport_playing = false;
            },
            .transport_stop => {
                g_engine.transport_playing = false;
                g_engine.transport_measure = 0;
                resetTimelineCursors();
            },
            .transport_set_playhead => {
                g_engine.transport_measure = sanitizeMeasure(cmd.start_measure);
                resetTimelineCursors();
            },
            .load_sample => {
                if (findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sampler or cmd.param_index >= MAX_SAMPLER_SLOTS or cmd.value_i <= 0) continue;
                    m.sampler_slots[cmd.param_index] = @intCast(cmd.value_i);
                    m.sampler_slot_loop[cmd.param_index] = cmd.value_f >= 0.5;
                }
            },
            .clear_sample => {
                if (findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sampler or cmd.param_index >= MAX_SAMPLER_SLOTS) continue;
                    m.sampler_slots[cmd.param_index] = 0;
                    m.sampler_slot_loop[cmd.param_index] = false;
                    for (0..MAX_SAMPLER_VOICES) |i| {
                        if (m.sampler_voice_slot[i] == cmd.param_index) m.sampler_voice_active[i] = false;
                    }
                }
            },
            .sequencer_set_step => {
                if (findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sequencer or cmd.beat_track < 0 or cmd.step_index >= MAX_SEQUENCER_STEPS) continue;
                    const track: usize = @intCast(cmd.beat_track);
                    if (track >= MAX_SEQUENCER_TRACKS) continue;
                    const step: usize = @intCast(cmd.step_index);
                    m.sequencer_step_active[track][step] = cmd.value_i != 0;
                    m.sequencer_step_note[track][step] = @intCast(@max(0, @min(127, cmd.sounds[0])));
                    m.sequencer_step_velocity[track][step] = @floatCast(if (cmd.value_f > 1.0) @max(0.0, @min(127.0, cmd.value_f)) else sanitizeUnit(cmd.value_f) * 127.0);
                }
            },
            .sequencer_set_track_target => {
                if (findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sequencer or cmd.beat_track < 0) continue;
                    const track: usize = @intCast(cmd.beat_track);
                    if (track >= MAX_SEQUENCER_TRACKS) continue;
                    m.sequencer_track_target[track] = cmd.target_module;
                }
            },
            .sequencer_clear_pattern => {
                if (findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sequencer) continue;
                    for (0..MAX_SEQUENCER_TRACKS) |track| {
                        for (0..MAX_SEQUENCER_STEPS) |step| {
                            m.sequencer_step_active[track][step] = false;
                            m.sequencer_step_note[track][step] = 36;
                            m.sequencer_step_velocity[track][step] = 100;
                        }
                        m.sequencer_prev_active[track] = false;
                        m.sequencer_prev_target[track] = 0;
                        m.sequencer_prev_note[track] = 0;
                    }
                    m.sequencer_current_step = 0;
                }
            },
            .clock_pulse => {
                for (0..g_engine.module_count) |i| {
                    const m = &g_engine.modules[i];
                    if (!m.active or m.module_type != .clock) continue;
                    if (cmd.module_id != 0 and m.id != cmd.module_id) continue;
                    m.clock_midi_pulse_count += 1;
                    if (m.clock_midi_pulse_count >= clockMidiPulsesPerTick(m.params[1].value)) {
                        m.clock_midi_pulse_count = 0;
                        queueClockTick(m);
                    }
                }
            },
            .clock_start => {
                for (0..g_engine.module_count) |i| {
                    const m = &g_engine.modules[i];
                    if (!m.active or m.module_type != .clock) continue;
                    if (cmd.module_id != 0 and m.id != cmd.module_id) continue;
                    if (m.param_count > 3) m.params[3].value = 1;
                    m.clock_sample_pos = 0;
                    m.clock_tick_count = 0;
                    m.clock_pending_ticks = 0;
                    m.clock_midi_pulse_count = 0;
                }
            },
            .clock_stop => {
                for (0..g_engine.module_count) |i| {
                    const m = &g_engine.modules[i];
                    if (!m.active or m.module_type != .clock) continue;
                    if (cmd.module_id != 0 and m.id != cmd.module_id) continue;
                    if (m.param_count > 3) m.params[3].value = 0;
                    m.clock_pending_ticks = 0;
                    m.clock_midi_pulse_count = 0;
                }
            },
        }
    }
}

// ── SDL3 audio callback ─────────────────────────────────────────────

fn audioCallback(userdata: ?*anyopaque, stream: ?*sdl.SDL_AudioStream, additional_amount: c_int, _: c_int) callconv(.c) void {
    _ = userdata;
    if (additional_amount <= 0) return;

    const t0 = std.time.microTimestamp();

    // Process pending commands from QuickJS
    processCommands();

    // Rebuild execution order if graph changed
    if (g_engine.order_dirty) rebuildExecOrder();

    const num_samples = BUFFER_SIZE;
    g_engine.current_tempo = tempoAtMeasure(g_engine.transport_measure);
    if (g_engine.transport_playing) {
        scheduleMediaEvents();
        scheduleBeatPatterns();
    }

    // Clear input buffers
    clearInputBuffers(num_samples);

    // Route connections (copy upstream outputs to downstream inputs)
    routeConnections(num_samples);

    // Process modules in topological order
    for (0..g_engine.exec_count) |i| {
        const idx = g_engine.exec_order[i];
        processModule(&g_engine.modules[idx], num_samples);
    }

    // Mix to master (sum all modules with audio outputs)
    @memset(&g_engine.master_buffer, 0);
    for (0..g_engine.module_count) |i| {
        const m = &g_engine.modules[i];
        if (!m.active) continue;
        for (0..m.port_count) |p| {
            if (m.ports[p].direction == .out and m.ports[p].port_type == .audio) {
                const buf = m.ports[p].buffer;
                // Check if this port has any downstream connection — if not, it's a terminal output
                var has_downstream = false;
                for (0..g_engine.connection_count) |c| {
                    const conn = &g_engine.connections[c];
                    if (conn.active and conn.from_module == m.id and conn.from_port == @as(u8, @intCast(p))) {
                        has_downstream = true;
                        break;
                    }
                }
                if (!has_downstream) {
                    var gain = @as(f32, 1.0);
                    var pan = @as(f32, 0.0);
                    if (findBeatTrackByModule(m.id)) |bt| {
                        if (!trackAudible(bt)) continue;
                        gain = @floatCast(sanitizeUnit(bt.volume));
                        pan = @floatCast(sanitizePan(bt.pan));
                    }
                    const left_gain: f32 = if (pan > 0) 1.0 - pan else 1.0;
                    const right_gain: f32 = if (pan < 0) 1.0 + pan else 1.0;
                    for (0..num_samples) |j| {
                        const sample = buf[j] * g_engine.master_gain * gain;
                        const out = j * @as(usize, MAX_CHANNELS);
                        g_engine.master_buffer[out] += sample * left_gain;
                        g_engine.master_buffer[out + 1] += sample * right_gain;
                    }
                }
            }
        }
    }

    mixSampleVoices(num_samples);

    // Feed SDL3 stream
    if (stream) |s| {
        _ = sdl.SDL_PutAudioStreamData(s, &g_engine.master_buffer, @intCast(num_samples * MAX_CHANNELS * @sizeOf(f32)));
    }

    _ = g_engine.callback_count.fetchAdd(1, .monotonic);
    if (g_engine.transport_playing) {
        const seconds = @as(f64, @floatFromInt(num_samples)) / @as(f64, @floatFromInt(SAMPLE_RATE));
        g_engine.transport_measure += (g_engine.current_tempo / 60.0) * seconds / BEATS_PER_MEASURE;
    }
    const t1 = std.time.microTimestamp();
    g_engine.callback_us.store(@intCast(@max(0, t1 - t0)), .monotonic);
}

// ── Public API (called from engine.zig init / QuickJS host functions) ──

pub fn init() bool {
    if (g_engine.initialized) return true;

    // Wire buffer pool
    g_engine.buffer_pool.data = &g_engine.buffer_storage;

    // Open SDL3 audio device
    const spec = sdl.SDL_AudioSpec{
        .format = sdl.SDL_AUDIO_F32,
        .channels = @intCast(MAX_CHANNELS),
        .freq = @intCast(SAMPLE_RATE),
    };

    g_engine.device_id = sdl.SDL_OpenAudioDevice(sdl.SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec);
    if (g_engine.device_id == 0) {
        std.log.err("[audio] Failed to open audio device: {s}", .{sdl.SDL_GetError()});
        return false;
    }

    // Create audio stream
    g_engine.stream = sdl.SDL_CreateAudioStream(&spec, &spec);
    if (g_engine.stream == null) {
        std.log.err("[audio] Failed to create audio stream: {s}", .{sdl.SDL_GetError()});
        sdl.SDL_CloseAudioDevice(g_engine.device_id);
        return false;
    }

    // Set callback
    _ = sdl.SDL_SetAudioStreamGetCallback(g_engine.stream, audioCallback, null);

    // Bind stream to device
    if (!sdl.SDL_BindAudioStream(g_engine.device_id, g_engine.stream)) {
        std.log.err("[audio] Failed to bind stream: {s}", .{sdl.SDL_GetError()});
        sdl.SDL_DestroyAudioStream(g_engine.stream);
        sdl.SDL_CloseAudioDevice(g_engine.device_id);
        return false;
    }

    // Resume playback
    _ = sdl.SDL_ResumeAudioDevice(g_engine.device_id);

    g_engine.initialized = true;
    std.log.info("[audio] Initialized: {d}Hz, {d} samples/buffer, F32 stereo", .{ SAMPLE_RATE, BUFFER_SIZE });
    return true;
}

pub fn deinit() void {
    if (!g_engine.initialized) return;
    if (g_engine.stream) |s| sdl.SDL_DestroyAudioStream(s);
    if (g_engine.device_id != 0) sdl.SDL_CloseAudioDevice(g_engine.device_id);
    freeBeatBytes();
    freeSampleStorage();
    g_engine.initialized = false;
}

pub fn isInitialized() bool {
    return g_engine.initialized;
}

pub fn setTempo(start_tempo: f64, start_measure: f64, end_tempo: f64, end_measure: f64, has_end_tempo: bool, has_end_measure: bool) bool {
    var flags: u8 = 0;
    if (has_end_tempo) flags |= TEMPO_FLAG_END_TEMPO;
    if (has_end_measure) flags |= TEMPO_FLAG_END_MEASURE;
    return pushCommand(.{
        .cmd_type = .set_tempo,
        .start_tempo = start_tempo,
        .start_measure = apiMeasureToTransport(start_measure),
        .end_tempo = end_tempo,
        .end_measure = apiMeasureToTransport(end_measure),
        .tempo_flags = flags,
    });
}

pub fn makeBeat(sound_spec: []const u8, track: i32, start_measure: f64, beat: []const u8, steps_per_measure: f64) bool {
    if (beat.len == 0) return false;

    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return false;

    const beat_copy = std.heap.c_allocator.dupe(u8, beat) catch return false;
    if (!pushCommand(.{
        .cmd_type = .make_beat,
        .beat_ptr = beat_copy.ptr,
        .beat_len = @intCast(@min(beat_copy.len, std.math.maxInt(u32))),
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .steps_per_measure = steps_per_measure,
        .sounds = sounds,
        .sound_count = sound_count,
    })) {
        std.heap.c_allocator.free(beat_copy);
        return false;
    }
    return true;
}

pub fn makeBeatSlice(sound_spec: []const u8, track: i32, start_measure: f64, beat: []const u8, slice_spec: []const u8, steps_per_measure: f64) bool {
    if (beat.len == 0) return false;

    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return false;

    var slice_starts = [_]f64{1.0} ** MAX_SOUNDS_PER_BEAT;
    const slice_count = parseSliceSpec(slice_spec, &slice_starts);
    if (slice_count == 0) return false;

    const beat_copy = std.heap.c_allocator.dupe(u8, beat) catch return false;
    if (!pushCommand(.{
        .cmd_type = .make_beat_slice,
        .beat_ptr = beat_copy.ptr,
        .beat_len = @intCast(@min(beat_copy.len, std.math.maxInt(u32))),
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .steps_per_measure = steps_per_measure,
        .sounds = sounds,
        .sound_count = 1,
        .slice_starts = slice_starts,
        .slice_count = slice_count,
    })) {
        std.heap.c_allocator.free(beat_copy);
        return false;
    }
    return true;
}

pub fn insertMedia(sound_spec: []const u8, track: i32, start_measure: f64) bool {
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return false;

    return pushCommand(.{
        .cmd_type = .insert_media,
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .sounds = sounds,
        .sound_count = 1,
    });
}

pub fn fitMedia(sound_spec: []const u8, track: i32, start_measure: f64, end_measure: f64) bool {
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return false;

    const start_transport = apiMeasureToTransport(start_measure);
    const end_transport = apiMeasureToTransport(end_measure);
    if (end_transport <= start_transport) return false;
    if (generatedSoundDurationMeasures(sounds[0]) <= 0) return false;

    return pushCommand(.{
        .cmd_type = .fit_media,
        .beat_track = sanitizeTrack(track),
        .start_measure = start_transport,
        .end_measure = end_transport,
        .sounds = sounds,
        .sound_count = 1,
    });
}

pub fn insertMediaSection(sound_spec: []const u8, track: i32, start_measure: f64, slice_start_raw: f64, slice_end_raw: f64) bool {
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return false;

    const source = resolveSoundInfo(sounds[0]);
    const source_end = 1.0 + @max(0, source.duration);
    const slice_start = @min(sanitizeSlicePosition(slice_start_raw), source_end);
    const slice_end = @min(@max(sanitizeSlicePosition(slice_end_raw), slice_start), source_end);
    if (slice_end <= slice_start) return false;

    var section_sound = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    section_sound[0] = allocateSoundHandle(.{
        .kind = source.kind,
        .base_sound = source.base_sound,
        .sample_id = source.sample_id,
        .stretch = source.stretch,
        .slice_start = source.slice_start + ((slice_start - 1.0) / @max(0.01, source.stretch)),
        .duration = slice_end - slice_start,
    });

    return pushCommand(.{
        .cmd_type = .insert_media,
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .sounds = section_sound,
        .sound_count = 1,
    });
}

pub fn clearTrack(track: i32, start_measure: f64, end_measure: f64, has_range: bool) bool {
    if (has_range and apiMeasureToTransport(end_measure) <= apiMeasureToTransport(start_measure)) return false;
    return pushCommand(.{
        .cmd_type = .clear_track,
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .end_measure = apiMeasureToTransport(end_measure),
        .tempo_flags = if (has_range) TRACK_FLAG_RANGE else 0,
    });
}

pub fn setTrackVolume(track: i32, volume: f64) bool {
    return pushCommand(.{
        .cmd_type = .set_track_volume,
        .beat_track = sanitizeTrack(track),
        .value_f = sanitizeUnit(volume),
    });
}

pub fn setTrackPan(track: i32, pan: f64) bool {
    return pushCommand(.{
        .cmd_type = .set_track_pan,
        .beat_track = sanitizeTrack(track),
        .value_f = sanitizePan(pan),
    });
}

pub fn setTrackMute(track: i32, muted: bool) bool {
    return pushCommand(.{
        .cmd_type = .set_track_mute,
        .beat_track = sanitizeTrack(track),
        .value_i = if (muted) 1 else 0,
    });
}

pub fn setTrackSolo(track: i32, soloed: bool) bool {
    return pushCommand(.{
        .cmd_type = .set_track_solo,
        .beat_track = sanitizeTrack(track),
        .value_i = if (soloed) 1 else 0,
    });
}

pub fn setStepVelocity(track: i32, step: i32, velocity: f64) bool {
    if (step < 0) return false;
    return pushCommand(.{
        .cmd_type = .set_step_velocity,
        .beat_track = sanitizeTrack(track),
        .step_index = @intCast(step),
        .value_f = sanitizeUnit(velocity),
    });
}

pub fn setStepProbability(track: i32, step: i32, probability: f64) bool {
    if (step < 0) return false;
    return pushCommand(.{
        .cmd_type = .set_step_probability,
        .beat_track = sanitizeTrack(track),
        .step_index = @intCast(step),
        .value_f = sanitizeUnit(probability),
    });
}

pub fn setStepOffset(track: i32, step: i32, offset: f64) bool {
    if (step < 0) return false;
    return pushCommand(.{
        .cmd_type = .set_step_offset,
        .beat_track = sanitizeTrack(track),
        .step_index = @intCast(step),
        .value_f = sanitizeStepOffset(offset),
    });
}

pub fn setStep(module_id: u32, track: i32, step: i32, active: bool, note: i32, velocity: f64) bool {
    if (track < 0 or step < 0) return false;
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    sounds[0] = @intCast(@max(0, @min(127, note)));
    return pushCommand(.{
        .cmd_type = .sequencer_set_step,
        .module_id = module_id,
        .beat_track = track,
        .step_index = @intCast(step),
        .value_i = if (active) 1 else 0,
        .value_f = velocity,
        .sounds = sounds,
        .sound_count = 1,
    });
}

pub fn setTrackTarget(module_id: u32, track: i32, target_module: u32) bool {
    if (track < 0) return false;
    return pushCommand(.{
        .cmd_type = .sequencer_set_track_target,
        .module_id = module_id,
        .beat_track = track,
        .target_module = target_module,
    });
}

pub fn clearPattern(module_id: u32) bool {
    return pushCommand(.{
        .cmd_type = .sequencer_clear_pattern,
        .module_id = module_id,
    });
}

pub fn clockPulse(module_id: u32) bool {
    return pushCommand(.{
        .cmd_type = .clock_pulse,
        .module_id = module_id,
    });
}

pub fn clockStart(module_id: u32) bool {
    return pushCommand(.{
        .cmd_type = .clock_start,
        .module_id = module_id,
    });
}

pub fn clockStop(module_id: u32) bool {
    return pushCommand(.{
        .cmd_type = .clock_stop,
        .module_id = module_id,
    });
}

pub fn play() bool {
    return pushCommand(.{ .cmd_type = .transport_play });
}

pub fn pauseTransport() bool {
    return pushCommand(.{ .cmd_type = .transport_pause });
}

pub fn stop() bool {
    return pushCommand(.{ .cmd_type = .transport_stop });
}

pub fn setPlayhead(measure: f64) bool {
    return pushCommand(.{
        .cmd_type = .transport_set_playhead,
        .start_measure = apiMeasureToTransport(measure),
    });
}

pub fn getPlayhead() f64 {
    return g_engine.transport_measure + 1.0;
}

pub fn isPlaying() bool {
    return g_engine.transport_playing;
}

pub fn dur(sound_spec: []const u8) f64 {
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return 0;
    return generatedSoundDurationMeasures(sounds[0]);
}

pub fn createAudioStretch(sound_spec: []const u8, stretch_factor: f64) u32 {
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return 0;

    var info = resolveSoundInfo(sounds[0]);
    const stretch = sanitizeStretchFactor(stretch_factor);
    info.stretch = sanitizeStretchFactor(info.stretch * stretch);
    info.duration *= stretch;
    return allocateSoundHandle(info);
}

pub fn createAudioSlice(sound_spec: []const u8, slice_start_raw: f64, slice_end_raw: f64) u32 {
    var sounds = [_]u32{0} ** MAX_SOUNDS_PER_BEAT;
    const sound_count = parseSoundSpec(sound_spec, &sounds);
    if (sound_count == 0) return 0;

    const source = resolveSoundInfo(sounds[0]);
    const source_end = 1.0 + @max(0, source.duration);
    const slice_start = @min(sanitizeSlicePosition(slice_start_raw), source_end);
    const slice_end = @min(@max(sanitizeSlicePosition(slice_end_raw), slice_start), source_end);

    return allocateSoundHandle(.{
        .kind = source.kind,
        .base_sound = source.base_sound,
        .sample_id = source.sample_id,
        .stretch = source.stretch,
        .slice_start = source.slice_start + ((slice_start - 1.0) / @max(0.01, source.stretch)),
        .duration = slice_end - slice_start,
    });
}

pub fn loadSound(path: []const u8) u32 {
    const decoded = decodeWavToMonoF32(path) orelse return 0;
    const sample_buffer = decoded.samples orelse return 0;
    const sample_id = allocateSample(sample_buffer, decoded.sample_rate, decoded.channels);
    if (sample_id == 0) {
        std.heap.c_allocator.free(sample_buffer);
        return 0;
    }
    const handle = allocateSoundHandle(.{
        .kind = .sample,
        .sample_id = sample_id,
        .stretch = 1.0,
        .slice_start = 1.0,
        .duration = sampleDurationMeasures(sample_id),
    });
    if (handle == 0) {
        freeSampleById(sample_id);
        return 0;
    }
    return handle;
}

pub fn loadSample(module_id: u32, slot_raw: i32, path: []const u8, mode: []const u8) bool {
    if (slot_raw < 1 or slot_raw > @as(i32, @intCast(MAX_SAMPLER_SLOTS))) return false;
    const decoded = decodeWavToMonoF32(path) orelse return false;
    const sample_buffer = decoded.samples orelse return false;
    const sample_id = allocateSample(sample_buffer, decoded.sample_rate, decoded.channels);
    if (sample_id == 0) {
        std.heap.c_allocator.free(sample_buffer);
        return false;
    }
    const loop = std.mem.eql(u8, mode, "loop");
    if (!pushCommand(.{
        .cmd_type = .load_sample,
        .module_id = module_id,
        .param_index = @intCast(slot_raw - 1),
        .value_i = @intCast(sample_id),
        .value_f = if (loop) 1.0 else 0.0,
    })) {
        if (sampleIndex(sample_id)) |idx| {
            if (g_engine.samples[idx].samples) |samples| std.heap.c_allocator.free(samples);
            g_engine.samples[idx] = .{};
        }
        return false;
    }
    return true;
}

pub fn clearSample(module_id: u32, slot_raw: i32) bool {
    if (slot_raw < 1 or slot_raw > @as(i32, @intCast(MAX_SAMPLER_SLOTS))) return false;
    return pushCommand(.{
        .cmd_type = .clear_sample,
        .module_id = module_id,
        .param_index = @intCast(slot_raw - 1),
    });
}

// ── Telemetry ───────────────────────────────────────────────────────

pub fn logTelemetry() void {
    if (!g_engine.initialized) return;
    log.print("[audio] modules: {d} | connections: {d} | callbacks: {d} | last: {d}us\n", .{
        g_engine.module_count,
        g_engine.connection_count,
        g_engine.callback_count.load(.monotonic),
        g_engine.callback_us.load(.monotonic),
    });
}

// ── V8-binding wrappers (engine internals exposed to v8_bindings_core.zig) ──

pub fn resumeDevice() void {
    if (g_engine.device_id != 0) _ = sdl.SDL_ResumeAudioDevice(g_engine.device_id);
}

pub fn pauseDevice() void {
    if (g_engine.device_id != 0) _ = sdl.SDL_PauseAudioDevice(g_engine.device_id);
}

pub fn getModuleCount() u32 {
    return g_engine.module_count;
}

pub fn getConnectionCount() u32 {
    return g_engine.connection_count;
}

pub fn getCallbackCount() u64 {
    return g_engine.callback_count.load(.monotonic);
}

pub fn getCallbackUs() u64 {
    return g_engine.callback_us.load(.monotonic);
}

pub fn getPeakLevel() f32 {
    var peak: f32 = 0;
    for (0..BUFFER_SIZE * MAX_CHANNELS) |i| {
        const v = @abs(g_engine.master_buffer[i]);
        if (v > peak) peak = v;
    }
    return peak;
}

pub fn getParam(module_id: u32, param_idx: u8) f64 {
    if (findModule(module_id)) |m| {
        if (param_idx < m.param_count) return m.params[param_idx].value;
    }
    return 0;
}

pub fn getParamCount(module_id: u32) u8 {
    if (findModule(module_id)) |m| return m.param_count;
    return 0;
}

pub fn getPortCount(module_id: u32) u8 {
    if (findModule(module_id)) |m| return m.port_count;
    return 0;
}

pub fn getModuleType(module_id: u32) i32 {
    if (findModule(module_id)) |m| return @intFromEnum(m.module_type);
    return -1;
}

pub fn getParamMin(module_id: u32, param_idx: u8) f64 {
    if (findModule(module_id)) |m| {
        if (param_idx < m.param_count) return m.params[param_idx].min;
    }
    return 0;
}

pub fn getParamMax(module_id: u32, param_idx: u8) f64 {
    if (findModule(module_id)) |m| {
        if (param_idx < m.param_count) return m.params[param_idx].max;
    }
    return 0;
}

// ── QuickJS host functions (registered via qjs_runtime.registerHostFn) ──
// These get raw JSValue access with proper f64 extraction — no c_long truncation.

const build_options = @import("build_options");
const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;

const qjs = if (HAS_QUICKJS) @cImport({
    @cDefine("_GNU_SOURCE", "1");
    @cDefine("QUICKJS_NG_BUILD", "1");
    @cInclude("quickjs.h");
}) else struct {
    pub const JSValue = extern struct { u: extern union { int32: i32 } = .{ .int32 = 0 }, tag: i64 = 0 };
    pub const JSContext = opaque {};
};
const QJS_UNDEFINED = if (HAS_QUICKJS) (qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = 3 }) else qjs.JSValue{};

fn extractF64(ctx: ?*qjs.JSContext, argv: [*c]qjs.JSValue, idx: usize) f64 {
    var v: f64 = 0;
    _ = qjs.JS_ToFloat64(ctx, &v, argv[idx]);
    return v;
}

fn extractI32(ctx: ?*qjs.JSContext, argv: [*c]qjs.JSValue, idx: usize) i32 {
    var v: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &v, argv[idx]);
    return v;
}

fn extractStringAlloc(ctx: ?*qjs.JSContext, argv: [*c]qjs.JSValue, idx: usize) ?[]u8 {
    const c_str = qjs.JS_ToCString(ctx, argv[idx]);
    if (c_str == null) return null;
    defer qjs.JS_FreeCString(ctx, c_str);
    return std.heap.c_allocator.dupe(u8, std.mem.span(c_str)) catch null;
}

fn jsFloat(v: f64) qjs.JSValue {
    return qjs.JS_NewFloat64(null, v);
}

// --- Host function implementations ---

fn hostAudioInit(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(if (init()) 1 else 0);
}

fn hostAudioDeinit(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    deinit();
    return QJS_UNDEFINED;
}

fn hostAudioAddModule(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    const id: u32 = @intCast(extractI32(ctx, argv, 0));
    const mod_type: u8 = @intCast(extractI32(ctx, argv, 1));
    return jsFloat(if (pushCommand(.{
        .cmd_type = .add_module,
        .module_id = id,
        .module_type = @enumFromInt(mod_type),
    })) 1 else 0);
}

fn hostAudioRemoveModule(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .remove_module,
        .module_id = @intCast(extractI32(ctx, argv, 0)),
    })) 1 else 0);
}

fn hostAudioConnect(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 4) return QJS_UNDEFINED;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .connect,
        .module_id = @intCast(extractI32(ctx, argv, 0)),
        .port_a = @intCast(extractI32(ctx, argv, 1)),
        .target_module = @intCast(extractI32(ctx, argv, 2)),
        .port_b = @intCast(extractI32(ctx, argv, 3)),
    })) 1 else 0);
}

fn hostAudioDisconnect(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 4) return QJS_UNDEFINED;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .disconnect,
        .module_id = @intCast(extractI32(ctx, argv, 0)),
        .port_a = @intCast(extractI32(ctx, argv, 1)),
        .target_module = @intCast(extractI32(ctx, argv, 2)),
        .port_b = @intCast(extractI32(ctx, argv, 3)),
    })) 1 else 0);
}

fn hostAudioSetParam(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 3) return QJS_UNDEFINED;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .set_param,
        .module_id = @intCast(extractI32(ctx, argv, 0)),
        .param_index = @intCast(extractI32(ctx, argv, 1)),
        .value_f = extractF64(ctx, argv, 2), // proper f64 — no truncation
    })) 1 else 0);
}

fn hostAudioGetParam(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    var mid: i32 = 0;
    var pidx: i32 = 0;
    _ = qjs.JS_ToInt32(null, &mid, argv[0]);
    _ = qjs.JS_ToInt32(null, &pidx, argv[1]);
    if (findModule(@intCast(mid))) |m| {
        if (pidx >= 0 and pidx < m.param_count) {
            return jsFloat(m.params[@intCast(pidx)].value);
        }
    }
    return jsFloat(0);
}

fn hostAudioNoteOn(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    const velocity = if (argc >= 3) extractF64(ctx, argv, 2) else 1.0;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .note_on,
        .module_id = @intCast(extractI32(ctx, argv, 0)),
        .value_i = extractI32(ctx, argv, 1),
        .value_f = sanitizeUnit(velocity),
    })) 1 else 0);
}

fn hostAudioNoteOff(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .note_off,
        .module_id = @intCast(extractI32(ctx, argv, 0)),
    })) 1 else 0);
}

fn hostAudioSetMasterGain(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    return jsFloat(if (pushCommand(.{
        .cmd_type = .set_master_gain,
        .value_f = extractF64(ctx, argv, 0), // 0.0-1.0 directly
    })) 1 else 0);
}

fn hostAudioSetTempo(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    const start_tempo = extractF64(ctx, argv, 0);
    const start_measure = extractF64(ctx, argv, 1);
    const has_end_tempo = argc >= 3;
    const has_end_measure = argc >= 4;
    const end_tempo = if (has_end_tempo) extractF64(ctx, argv, 2) else start_tempo;
    const end_measure = if (has_end_measure) extractF64(ctx, argv, 3) else start_measure;
    return jsFloat(if (setTempo(start_tempo, start_measure, end_tempo, end_measure, has_end_tempo, has_end_measure)) 1 else 0);
}

fn hostAudioMakeBeat(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 4) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const track = extractI32(ctx, argv, 1);
    const start_measure = extractF64(ctx, argv, 2);
    const beat = extractStringAlloc(ctx, argv, 3) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(beat);
    const steps_per_measure = if (argc >= 5) extractF64(ctx, argv, 4) else 16.0;
    return jsFloat(if (makeBeat(sound_spec, track, start_measure, beat, steps_per_measure)) 1 else 0);
}

fn hostAudioMakeBeatSlice(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 5) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const track = extractI32(ctx, argv, 1);
    const start_measure = extractF64(ctx, argv, 2);
    const beat = extractStringAlloc(ctx, argv, 3) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(beat);
    const slice_spec = extractStringAlloc(ctx, argv, 4) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(slice_spec);
    const steps_per_measure = if (argc >= 6) extractF64(ctx, argv, 5) else 16.0;
    return jsFloat(if (makeBeatSlice(sound_spec, track, start_measure, beat, slice_spec, steps_per_measure)) 1 else 0);
}

fn hostAudioInsertMedia(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 3) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const track = extractI32(ctx, argv, 1);
    const start_measure = extractF64(ctx, argv, 2);
    return jsFloat(if (insertMedia(sound_spec, track, start_measure)) 1 else 0);
}

fn hostAudioFitMedia(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 4) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const track = extractI32(ctx, argv, 1);
    const start_measure = extractF64(ctx, argv, 2);
    const end_measure = extractF64(ctx, argv, 3);
    return jsFloat(if (fitMedia(sound_spec, track, start_measure, end_measure)) 1 else 0);
}

fn hostAudioInsertMediaSection(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 5) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const track = extractI32(ctx, argv, 1);
    const start_measure = extractF64(ctx, argv, 2);
    const slice_start = extractF64(ctx, argv, 3);
    const slice_end = extractF64(ctx, argv, 4);
    return jsFloat(if (insertMediaSection(sound_spec, track, start_measure, slice_start, slice_end)) 1 else 0);
}

fn hostAudioClearTrack(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return jsFloat(0);
    const track = extractI32(ctx, argv, 0);
    const has_range = argc >= 3;
    const start_measure = if (has_range) extractF64(ctx, argv, 1) else 1.0;
    const end_measure = if (has_range) extractF64(ctx, argv, 2) else start_measure;
    return jsFloat(if (clearTrack(track, start_measure, end_measure, has_range)) 1 else 0);
}

fn hostAudioSetTrackVolume(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    return jsFloat(if (setTrackVolume(extractI32(ctx, argv, 0), extractF64(ctx, argv, 1))) 1 else 0);
}

fn hostAudioSetTrackPan(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    return jsFloat(if (setTrackPan(extractI32(ctx, argv, 0), extractF64(ctx, argv, 1))) 1 else 0);
}

fn hostAudioSetTrackMute(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    return jsFloat(if (setTrackMute(extractI32(ctx, argv, 0), extractI32(ctx, argv, 1) != 0)) 1 else 0);
}

fn hostAudioSetTrackSolo(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    return jsFloat(if (setTrackSolo(extractI32(ctx, argv, 0), extractI32(ctx, argv, 1) != 0)) 1 else 0);
}

fn hostAudioSetStepVelocity(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 3) return jsFloat(0);
    return jsFloat(if (setStepVelocity(extractI32(ctx, argv, 0), extractI32(ctx, argv, 1), extractF64(ctx, argv, 2))) 1 else 0);
}

fn hostAudioSetStepProbability(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 3) return jsFloat(0);
    return jsFloat(if (setStepProbability(extractI32(ctx, argv, 0), extractI32(ctx, argv, 1), extractF64(ctx, argv, 2))) 1 else 0);
}

fn hostAudioSetStepOffset(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 3) return jsFloat(0);
    return jsFloat(if (setStepOffset(extractI32(ctx, argv, 0), extractI32(ctx, argv, 1), extractF64(ctx, argv, 2))) 1 else 0);
}

fn hostAudioDur(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    return jsFloat(dur(sound_spec));
}

fn hostAudioCreateAudioStretch(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const stretch_factor = extractF64(ctx, argv, 1);
    return jsFloat(@floatFromInt(createAudioStretch(sound_spec, stretch_factor)));
}

fn hostAudioCreateAudioSlice(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 3) return jsFloat(0);
    const sound_spec = extractStringAlloc(ctx, argv, 0) orelse return jsFloat(0);
    defer std.heap.c_allocator.free(sound_spec);
    const slice_start = extractF64(ctx, argv, 1);
    const slice_end = extractF64(ctx, argv, 2);
    return jsFloat(@floatFromInt(createAudioSlice(sound_spec, slice_start, slice_end)));
}

fn hostAudioPlay(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(if (play()) 1 else 0);
}

fn hostAudioTransportPause(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(if (pauseTransport()) 1 else 0);
}

fn hostAudioStop(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(if (stop()) 1 else 0);
}

fn hostAudioSetPlayhead(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return jsFloat(0);
    return jsFloat(if (setPlayhead(extractF64(ctx, argv, 0))) 1 else 0);
}

fn hostAudioGetPlayhead(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(getPlayhead());
}

fn hostAudioIsPlaying(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(if (isPlaying()) 1 else 0);
}

fn hostAudioPause(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (g_engine.device_id != 0) _ = sdl.SDL_PauseAudioDevice(g_engine.device_id);
    return QJS_UNDEFINED;
}

fn hostAudioResume(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (g_engine.device_id != 0) _ = sdl.SDL_ResumeAudioDevice(g_engine.device_id);
    return QJS_UNDEFINED;
}

fn hostAudioGetModuleCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(@floatFromInt(g_engine.module_count));
}

fn hostAudioGetCallbackCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(@floatFromInt(g_engine.callback_count.load(.monotonic)));
}

fn hostAudioGetCallbackUs(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(@floatFromInt(g_engine.callback_us.load(.monotonic)));
}

fn hostAudioGetSampleRate(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(@floatFromInt(SAMPLE_RATE));
}

fn hostAudioGetBufferSize(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(@floatFromInt(BUFFER_SIZE));
}

fn hostAudioGetPeakLevel(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    // Scan master buffer for peak
    var peak: f32 = 0;
    for (0..BUFFER_SIZE * MAX_CHANNELS) |i| {
        const v = @abs(g_engine.master_buffer[i]);
        if (v > peak) peak = v;
    }
    return jsFloat(@floatCast(peak));
}

fn hostAudioGetParamCount(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return jsFloat(0);
    var mid: i32 = 0;
    _ = qjs.JS_ToInt32(null, &mid, argv[0]);
    if (findModule(@intCast(mid))) |m| return jsFloat(@floatFromInt(m.param_count));
    return jsFloat(0);
}

fn hostAudioGetPortCount(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return jsFloat(0);
    var mid: i32 = 0;
    _ = qjs.JS_ToInt32(null, &mid, argv[0]);
    if (findModule(@intCast(mid))) |m| return jsFloat(@floatFromInt(m.port_count));
    return jsFloat(0);
}

fn hostAudioGetModuleType(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return jsFloat(-1);
    var mid: i32 = 0;
    _ = qjs.JS_ToInt32(null, &mid, argv[0]);
    if (findModule(@intCast(mid))) |m| return jsFloat(@floatFromInt(@intFromEnum(m.module_type)));
    return jsFloat(-1);
}

fn hostAudioGetParamMin(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    var mid: i32 = 0;
    var pidx: i32 = 0;
    _ = qjs.JS_ToInt32(null, &mid, argv[0]);
    _ = qjs.JS_ToInt32(null, &pidx, argv[1]);
    if (findModule(@intCast(mid))) |m| {
        if (pidx >= 0 and pidx < m.param_count) return jsFloat(m.params[@intCast(pidx)].min);
    }
    return jsFloat(0);
}

fn hostAudioGetParamMax(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return jsFloat(0);
    var mid: i32 = 0;
    var pidx: i32 = 0;
    _ = qjs.JS_ToInt32(null, &mid, argv[0]);
    _ = qjs.JS_ToInt32(null, &pidx, argv[1]);
    if (findModule(@intCast(mid))) |m| {
        if (pidx >= 0 and pidx < m.param_count) return jsFloat(m.params[@intCast(pidx)].max);
    }
    return jsFloat(0);
}

fn hostAudioGetConnectionCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(@floatFromInt(g_engine.connection_count));
}

fn hostAudioIsInitialized(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return jsFloat(if (g_engine.initialized) 1 else 0);
}

