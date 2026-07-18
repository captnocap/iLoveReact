//! Audio subsystem — DSP engine, module graph, and routing.

const std = @import("std");
const log = @import("../diag/log.zig");
const types = @import("types.zig");
const state = @import("state.zig");
const api = @import("api.zig");
const mathx = @import("../math/root.zig");

const Module = types.Module;
const Connection = types.Connection;
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

// ── Module initialization helpers ───────────────────────────────────

pub fn initModulePorts(m: *Module) void {
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
            addParam(m, "steps", .int, 1, MAX_SEQUENCER_STEPS, 16);
            addParam(m, "tracks", .int, 1, MAX_SEQUENCER_TRACKS, 4);
            addParam(m, "bpm", .float, 20, 300, 120);
            addParam(m, "running", .bool_, 0, 1, 1);
        },
        .sampler => {
            addPort(m, "audio_out", .audio, .out);
            addPort(m, "gate_in", .control, .in_);
            addParam(m, "gain", .float, 0, 2, 1);
            addParam(m, "loop", .bool_, 0, 1, 0);
            addParam(m, "slot", .int, 1, MAX_SAMPLER_SLOTS, 1);
        },
        .custom => {},
        .synth => {
            addPort(m, "audio_out", .audio, .out);
            addParam(m, "voice", .enum_, 0, 4, 0); // kick, snare, hat, bass, lead
            addParam(m, "tone", .float, 0, 1, 0.5);
            addParam(m, "decay", .float, 0.02, 1.5, 0.25);
            addParam(m, "color", .float, 0, 1, 0.4);
            addParam(m, "drive", .float, 0, 1, 0.2);
            addParam(m, "gain", .float, 0, 1.5, 0.8);
            // 0 = fully deterministic (same input → same sound). 1 = full per-trigger
            // randomization on tone/color/drive/decay/freq/phase. Default low so the
            // synth obeys its knobs by default; turn it up to "humanize" repeated hits.
            addParam(m, "humanize", .float, 0, 1, 0.15);
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
    p.buffer = state.g_engine.buffer_pool.getBuffer(m.slot_index, m.port_count);
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
    const wf: Waveform = @enumFromInt(@as(u8, @trunc(m.params[0].value)));
    var freq = m.params[1].value; // frequency
    const detune = m.params[2].value;
    const gain = m.params[3].value;
    const fm_amt = m.params[4].value;
    var phase = m.phase;
    const inv_sr = 1.0 / @as(f64, SAMPLE_RATE);

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
            const x = @as(u32, @truncate(@as(u64, @bitCast(@as(i64, @trunc(phase * 2147483647.0))))));
            break :blk @as(f64, @as(i32, @bitCast(x *% 1103515245 +% 12345))) / 2147483647.0;
        },
    };
}

fn wrapPhase(v: f64) f64 {
    const wrapped = v - @floor(v);
    return if (wrapped < 0) wrapped + 1.0 else wrapped;
}

fn nextNoise(seed: *u32) f64 {
    seed.* = seed.* *% 1664525 +% 1013904223;
    return (@as(f64, seed.* >> 1) / 1073741824.0) - 1.0;
}

fn seedUnit(seed: u32) f64 {
    return @as(f64, seed & 0x00ffffff) / 16777215.0;
}

fn clamp01(v: f64) f64 {
    if (v != v) return 0;
    return @min(1.0, @max(0.0, v));
}

fn pulseSample(phase: f64, duty_raw: f64) f64 {
    const duty = @min(0.95, @max(0.05, duty_raw));
    return if (@mod(phase, 1.0) < duty) @as(f64, 1.0) else @as(f64, -1.0);
}

pub fn prepareSynthTrigger(m: *Module, velocity: f64) void {
    const vel = api.sanitizeUnit(velocity);
    m.noise_seed = m.noise_seed *% 1664525 +% 1013904223;
    m.trigger_velocity = vel;
    m.trigger_variant = seedUnit(m.noise_seed);

    // Per-trigger phase offset, scaled by the humanize knob. At humanize=0 every
    // trigger starts at phase 0 (deterministic). Wider spread for tonal voices.
    const humanize = if (m.param_count > 6) clamp01(m.params[6].value) else 0.15;
    const spread: f64 = if (m.param_count > 0 and m.params[0].value >= 3.0) 0.19 else 0.045;
    m.phase = wrapPhase(m.trigger_variant * spread * humanize);
    m.phase2 = wrapPhase((1.0 - m.trigger_variant) * spread * 1.73 * humanize);
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

    // SVF goes unstable as cutoff approaches Nyquist — cap well below it.
    const sr_f: f64 = SAMPLE_RATE;
    cutoff = std.math.clamp(cutoff, 20.0, sr_f * 0.45);

    // Simple 2-pole resonant filter (SVF approximation)
    const f_norm = 2.0 * @sin(std.math.pi * cutoff / sr_f);
    // Clamp resonance so q can't go ≤0 and self-oscillate to infinity.
    const q = 1.0 - std.math.clamp(reso, 0.0, 0.97) * 0.99;

    for (0..num_samples) |i| {
        const x: f64 = @floatCast(in_buf[i]);
        const hp = x - y1 - q * (y1 - y2);
        y1 += f_norm * hp;
        y2 += f_norm * (y1 - y2);
        // mode: 0=lp, 1=hp, 2=bp
        const mode: u8 = @trunc(m.params[2].value);
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
    const inv_sr = 1.0 / @as(f64, SAMPLE_RATE);

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
    const wf: Waveform = @enumFromInt(@as(u8, @trunc(m.params[2].value)));
    var phase = m.phase;
    const inv_sr = 1.0 / @as(f64, SAMPLE_RATE);

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

    const delay_samples: u32 = @trunc(@min(
        @as(f64, MAX_DELAY_SAMPLES - 1),
        delay_time * SAMPLE_RATE,
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
    const idx: u8 = @trunc(@max(0.0, @min(5.0, raw)));
    return switch (idx) {
        0 => 1.0, // 1/4
        1 => 0.5, // 1/8
        2 => 0.25, // 1/16
        3 => 0.125, // 1/32
        4 => 2.0, // 1/2
        else => 4.0, // 1/1
    };
}

pub fn clockMidiPulsesPerTick(raw: f64) u32 {
    const rounded: u32 = @round(clockDivisionBeats(raw) * 24.0);
    const pulses = @max(1, rounded);
    return @min(96, pulses);
}

pub fn queueClockTick(m: *Module) void {
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
        const bpm = if (state.g_engine.tempo_count > 0) state.g_engine.current_tempo else m.params[0].value;
        const division = clockDivisionBeats(m.params[1].value);
        const swing = @max(0.0, @min(1.0, m.params[2].value));
        const ticks_per_second = @max(0.001, (bpm / 60.0) / division);
        const samples_per_tick = @as(f64, SAMPLE_RATE) / ticks_per_second;

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
        m.clock_sample_pos = start_sample_pos + num_samples;
        if (ticked) m.clock_tick_count = tick_count;
    }

    if (ticked) {
        for (0..num_samples) |i| gate_out[i] = 1;
    }
}

fn sequencerFireTick(m: *Module) void {
    const steps: u32 = @trunc(@max(1.0, @min(@as(f64, MAX_SEQUENCER_STEPS), m.params[0].value)));
    const tracks: u32 = @trunc(@max(1.0, @min(@as(f64, MAX_SEQUENCER_TRACKS), m.params[1].value)));

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
    } else if (state.g_engine.transport_playing and (m.param_count <= 3 or m.params[3].value >= 0.5)) {
        const bpm = if (state.g_engine.tempo_count > 0) state.g_engine.current_tempo else m.params[2].value;
        const ticks_per_second = @max(0.001, bpm / 60.0 * 4.0);
        var phase = m.phase;
        const inc = ticks_per_second / SAMPLE_RATE;
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
    const one_based: i32 = @trunc(@max(1.0, @min(@as(f64, MAX_SAMPLER_SLOTS), raw)));
    return @intCast(one_based - 1);
}

fn startSamplerVoice(m: *Module, slot: u8, note: i32, velocity: f64) void {
    if (slot >= MAX_SAMPLER_SLOTS) return;
    const sample_id = m.sampler_slots[slot];
    if (api.sampleById(sample_id) == null) return;

    var voice_idx: ?usize = null;
    for (0..MAX_SAMPLER_VOICES) |i| {
        if (!m.sampler_voice_active[i]) {
            voice_idx = i;
            break;
        }
    }
    const idx = voice_idx orelse 0;
    const sample = api.sampleById(sample_id) orelse return;
    const pitch = std.math.pow(f64, 2.0, @as(f64, note - SAMPLER_PITCH_NOTE) / 12.0);
    const rate = pitch * (@as(f64, sample.sample_rate) / SAMPLE_RATE);
    m.sampler_voice_active[idx] = true;
    m.sampler_voice_slot[idx] = slot;
    m.sampler_voice_note[idx] = note;
    m.sampler_voice_pos[idx] = 0;
    m.sampler_voice_rate[idx] = @max(0.000001, rate);
    m.sampler_voice_velocity[idx] = @floatCast(api.sanitizeUnit(velocity));
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

    const gain: f32 = if (m.param_count > 0) mathx.clamp(@floatCast(m.params[0].value), 0, 2) else 1.0;
    for (0..MAX_SAMPLER_VOICES) |voice_idx| {
        if (!m.sampler_voice_active[voice_idx]) continue;
        const slot = m.sampler_voice_slot[voice_idx];
        if (slot >= MAX_SAMPLER_SLOTS) {
            m.sampler_voice_active[voice_idx] = false;
            continue;
        }
        const sample = api.sampleById(m.sampler_slots[slot]) orelse {
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

            const idx: usize = @floor(pos);
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

fn processSynth(m: *Module, num_samples: u32) void {
    const out_buf = m.ports[0].buffer;
    var stage = m.envelope_stage;
    var env = m.envelope_level;

    if (stage == 0 or env <= 0.00001) {
        for (0..num_samples) |i| out_buf[i] = 0;
        m.envelope_stage = 0;
        m.envelope_level = 0;
        return;
    }

    const voice: u8 = @trunc(@min(4.0, @max(0.0, m.params[0].value)));
    const tone_param = @min(1.0, @max(0.0, m.params[1].value));
    const decay_param = @max(0.01, m.params[2].value);
    const color_param = @min(1.0, @max(0.0, m.params[3].value));
    const drive_param = @min(1.0, @max(0.0, m.params[4].value));
    const gain = @max(0.0, m.params[5].value);
    const humanize = if (m.param_count > 6) clamp01(m.params[6].value) else 0.15;
    // Both the LCG variant AND the input velocity are scaled toward neutral by
    // humanize. At humanize=0 every press uses the same variant (0.5) and the
    // same effective velocity (0.5), so the synth is fully deterministic — the
    // knobs alone shape the sound. At humanize=1 the original full per-trigger
    // randomness + velocity sensitivity returns.
    const variant_raw = clamp01(m.trigger_variant);
    const variant = 0.5 + (variant_raw - 0.5) * humanize;
    const var_bi = (variant_raw * 2.0 - 1.0) * humanize;
    const trig_vel_raw = clamp01(m.trigger_velocity);
    const trig_vel = 0.5 + (trig_vel_raw - 0.5) * humanize;
    const tone = clamp01(tone_param + var_bi * 0.16 + (trig_vel - 0.75) * 0.18);
    const color = clamp01(color_param + var_bi * 0.22 + (trig_vel - 0.65) * 0.16);
    const drive = clamp01(drive_param + (trig_vel - 0.5) * 0.25 + @abs(var_bi) * 0.12);
    const decay = @max(0.01, decay_param * (0.78 + trig_vel * 0.34 + variant * 0.18));
    const decay_coeff = std.math.exp(-1.0 / (decay * SAMPLE_RATE));
    const dt = 1.0 / @as(f64, SAMPLE_RATE);

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

pub fn processModule(m: *Module, num_samples: u32) void {
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
        .synth => processSynth(m, num_samples),
        .custom => {},
    }
}

// ── Graph routing ───────────────────────────────────────────────────

pub fn routeConnections(num_samples: u32) void {
    for (0..state.g_engine.connection_count) |i| {
        const conn = &state.g_engine.connections[i];
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

pub fn clearInputBuffers(num_samples: u32) void {
    for (0..state.g_engine.module_count) |i| {
        const m = &state.g_engine.modules[i];
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

pub fn rebuildExecOrder() void {
    // Simple topological sort via dependency counting
    var in_degree: [MAX_MODULES]u32 = [_]u32{0} ** MAX_MODULES;
    var id_to_idx: [MAX_MODULES]u32 = [_]u32{0} ** MAX_MODULES;

    // Map module IDs to indices
    for (0..state.g_engine.module_count) |i| {
        id_to_idx[i] = state.g_engine.modules[i].id;
    }

    // Count incoming connections per module
    for (0..state.g_engine.connection_count) |i| {
        const conn = &state.g_engine.connections[i];
        if (!conn.active) continue;
        for (0..state.g_engine.module_count) |j| {
            if (state.g_engine.modules[j].id == conn.to_module and state.g_engine.modules[j].active) {
                in_degree[j] += 1;
            }
        }
    }

    // BFS: start with modules that have no inputs
    var queue: [MAX_MODULES]u32 = undefined;
    var q_head: u32 = 0;
    var q_tail: u32 = 0;
    state.g_engine.exec_count = 0;

    for (0..state.g_engine.module_count) |i| {
        if (state.g_engine.modules[i].active and in_degree[i] == 0) {
            queue[q_tail] = @intCast(i);
            q_tail += 1;
        }
    }

    while (q_head < q_tail) {
        const idx = queue[q_head];
        q_head += 1;
        state.g_engine.exec_order[state.g_engine.exec_count] = idx;
        state.g_engine.exec_count += 1;

        const mod_id = state.g_engine.modules[idx].id;
        for (0..state.g_engine.connection_count) |i| {
            const conn = &state.g_engine.connections[i];
            if (!conn.active or conn.from_module != mod_id) continue;
            for (0..state.g_engine.module_count) |j| {
                if (state.g_engine.modules[j].id == conn.to_module and state.g_engine.modules[j].active) {
                    in_degree[j] -= 1;
                    if (in_degree[j] == 0) {
                        queue[q_tail] = @intCast(j);
                        q_tail += 1;
                    }
                }
            }
        }
    }

    state.g_engine.order_dirty = false;
}

pub fn findModule(id: u32) ?*Module {
    for (0..state.g_engine.module_count) |i| {
        if (state.g_engine.modules[i].id == id and state.g_engine.modules[i].active) return &state.g_engine.modules[i];
    }
    return null;
}

fn inputHasConnection(module_id: u32, port: u8) bool {
    for (0..state.g_engine.connection_count) |i| {
        const c = &state.g_engine.connections[i];
        if (c.active and c.to_module == module_id and c.to_port == port) return true;
    }
    return false;
}

pub fn triggerModuleNote(m: *Module, note: i32, velocity: f64) void {
    const note_freq = 440.0 * std.math.pow(f64, 2.0, (@as(f64, note) - 69.0) / 12.0);
    switch (m.module_type) {
        .oscillator => {
            if (m.param_count > 1) m.params[1].value = note_freq;
        },
        .synth => {
            m.base_freq = note_freq;
            m.trigger_time = 0;
            prepareSynthTrigger(m, velocity);
            if (m.param_count > 5) m.params[5].value = 0.8 * api.sanitizeUnit(velocity);
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
    m.envelope_level = if (m.module_type == .synth) api.sanitizeUnit(velocity) else 0;
}

pub fn releaseModuleNote(m: *Module, note: i32) void {
    if (m.module_type == .sampler) stopSamplerLoopingVoices(m, note);
    m.envelope_stage = 4;
}
