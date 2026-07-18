//! Audio subsystem — SDL3 audio callback (interrupt thread entry point).

const std = @import("std");
const sdl = @import("sdl.zig").c; // was: @cImport({
const types = @import("types.zig");
const state = @import("state.zig");
const dsp = @import("dsp.zig");
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

pub fn audioCallback(userdata: ?*anyopaque, stream: ?*sdl.SDL_AudioStream, additional_amount: c_int, _: c_int) callconv(.c) void {
    if (additional_amount <= 0) return;

    // SDL fixes this foreign ABI, so the owning audio engine injects its Io
    // capability through SDL's userdata slot when registering the callback.
    const io_ptr: *const std.Io = @ptrCast(@alignCast(userdata orelse return));
    const io = io_ptr.*;
    const t0 = std.Io.Clock.now(.awake, io);

    // Process pending commands from QuickJS
    api.processCommands();

    // Rebuild execution order if graph changed
    if (state.g_engine.order_dirty) dsp.rebuildExecOrder();

    const num_samples = BUFFER_SIZE;
    state.g_engine.current_tempo = api.tempoAtMeasure(state.g_engine.transport_measure);
    if (state.g_engine.transport_playing) {
        api.scheduleMediaEvents();
        api.scheduleBeatPatterns();
    }

    // Clear input buffers
    dsp.clearInputBuffers(num_samples);

    // Route connections (copy upstream outputs to downstream inputs)
    dsp.routeConnections(num_samples);

    // Process modules in topological order
    for (0..state.g_engine.exec_count) |i| {
        const idx = state.g_engine.exec_order[i];
        dsp.processModule(&state.g_engine.modules[idx], num_samples);
    }

    // Mix to master (sum all modules with audio outputs)
    @memset(&state.g_engine.master_buffer, 0);
    for (0..state.g_engine.module_count) |i| {
        const m = &state.g_engine.modules[i];
        if (!m.active) continue;
        for (0..m.port_count) |p| {
            if (m.ports[p].direction == .out and m.ports[p].port_type == .audio) {
                const buf = m.ports[p].buffer;
                // Check if this port has any downstream connection — if not, it's a terminal output
                var has_downstream = false;
                for (0..state.g_engine.connection_count) |c| {
                    const conn = &state.g_engine.connections[c];
                    if (conn.active and conn.from_module == m.id and conn.from_port == @as(u8, @intCast(p))) {
                        has_downstream = true;
                        break;
                    }
                }
                if (!has_downstream) {
                    var gain = @as(f32, 1.0);
                    var pan = @as(f32, 0.0);
                    if (api.findBeatTrackByModule(m.id)) |bt| {
                        if (!api.trackAudible(bt)) continue;
                        gain = @floatCast(api.sanitizeUnit(bt.volume));
                        pan = @floatCast(api.sanitizePan(bt.pan));
                    }
                    const left_gain: f32 = if (pan > 0) 1.0 - pan else 1.0;
                    const right_gain: f32 = if (pan < 0) 1.0 + pan else 1.0;
                    for (0..num_samples) |j| {
                        const sample = buf[j] * state.g_engine.master_gain * gain;
                        const out = j * @as(usize, MAX_CHANNELS);
                        state.g_engine.master_buffer[out] += sample * left_gain;
                        state.g_engine.master_buffer[out + 1] += sample * right_gain;
                    }
                }
            }
        }
    }

    api.mixSampleVoices(num_samples);

    // ── Safety limiter ────────────────────────────────────────────────────────
    // Last line of defense before audio hits the speaker. Pure max-protection —
    // signals at or below the ceiling pass through bit-exact untouched.
    //   - NaN / Inf → 0 (sanitize per-sample, never mute the whole callback)
    //   - |x| > panic_threshold → 0 (kill runaway feedback)
    //   - else → clamp to ±safety_ceiling
    {
        const ceiling = state.g_engine.safety_ceiling;
        const panic = state.g_engine.safety_panic_threshold;
        const total = num_samples * MAX_CHANNELS;
        for (0..total) |j| {
            const s = state.g_engine.master_buffer[j];
            if (std.math.isNan(s) or !std.math.isFinite(s) or @abs(s) > panic) {
                state.g_engine.master_buffer[j] = 0;
            } else if (s > ceiling) {
                state.g_engine.master_buffer[j] = ceiling;
            } else if (s < -ceiling) {
                state.g_engine.master_buffer[j] = -ceiling;
            }
        }
    }

    // Feed SDL3 stream
    if (stream) |s| {
        _ = sdl.SDL_PutAudioStreamData(s, &state.g_engine.master_buffer, @intCast(num_samples * MAX_CHANNELS * @sizeOf(f32)));
    }

    _ = state.g_engine.callback_count.fetchAdd(1, .monotonic);
    if (state.g_engine.transport_playing) {
        const seconds = @as(f64, @floatFromInt(num_samples)) / @as(f64, @floatFromInt(SAMPLE_RATE));
        state.g_engine.transport_measure += (state.g_engine.current_tempo / 60.0) * seconds / BEATS_PER_MEASURE;
    }
    const elapsed_us = t0.durationTo(std.Io.Clock.now(.awake, io)).toMicroseconds();
    state.g_engine.callback_us.store(@intCast(@max(0, elapsed_us)), .monotonic);
}
