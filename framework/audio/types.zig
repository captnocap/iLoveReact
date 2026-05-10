//! Audio subsystem — types and constants.

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
pub const SAMPLER_BASE_NOTE: i32 = 36;
pub const SAMPLER_PITCH_NOTE: i32 = 60;

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
    synth,
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

pub const SampleData = struct {
    active: bool = false,
    samples: ?[]f32 = null,
    sample_rate: u32 = SAMPLE_RATE,
    frame_count: u32 = 0,
    channels: u16 = 1,
};

pub const SoundKind = enum(u8) { generated, sample };

pub const TEMPO_FLAG_END_TEMPO: u8 = 1 << 0;
pub const TEMPO_FLAG_END_MEASURE: u8 = 1 << 1;
pub const TRACK_FLAG_RANGE: u8 = 1 << 0;

pub const TempoSegment = struct {
    start_tempo: f64 = DEFAULT_TEMPO,
    start_measure: f64 = 0,
    end_tempo: f64 = DEFAULT_TEMPO,
    end_measure: f64 = 0,
    has_end_tempo: bool = false,
    has_end_measure: bool = false,
};

pub const BeatPattern = struct {
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

pub const BeatTrack = struct {
    active: bool = false,
    track: i32 = 0,
    module_id: u32 = 0,
    volume: f64 = 1.0,
    pan: f64 = 0,
    muted: bool = false,
    soloed: bool = false,
};

pub const MediaEvent = struct {
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

pub const RetiredBeat = struct {
    ptr: ?[*]u8 = null,
    len: u32 = 0,
};

pub const SoundHandle = struct {
    active: bool = false,
    kind: SoundKind = .generated,
    base_sound: u32 = 0,
    sample_id: u32 = 0,
    stretch: f64 = 1.0,
    slice_start: f64 = 1.0,
    duration: f64 = 0,
};

pub const SoundInfo = struct {
    kind: SoundKind = .generated,
    base_sound: u32 = 0,
    sample_id: u32 = 0,
    stretch: f64 = 1.0,
    slice_start: f64 = 1.0,
    duration: f64 = 0,
};

pub const SampleVoice = struct {
    active: bool = false,
    track: i32 = 0,
    sample_id: u32 = 0,
    pos: f64 = 0,
    rate: f64 = 1,
    remaining_frames: f64 = 0,
    gain: f32 = 1,
};
