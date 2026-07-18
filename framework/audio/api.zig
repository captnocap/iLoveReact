//! Audio subsystem — public API, beat scheduling, and command processing.

const std = @import("std");
const log = @import("../diag/log.zig");
const types = @import("types.zig");
const state = @import("state.zig");
const dsp = @import("dsp.zig");

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

    var insert: u32 = state.g_engine.tempo_count;
    var replace = false;
    const eps = 0.000001;
    for (0..state.g_engine.tempo_count) |i| {
        const idx: u32 = @intCast(i);
        const existing = state.g_engine.tempo_segments[idx].start_measure;
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
        state.g_engine.tempo_segments[insert] = seg;
        return true;
    }

    if (state.g_engine.tempo_count >= MAX_TEMPO_POINTS) return false;

    var i = state.g_engine.tempo_count;
    while (i > insert) : (i -= 1) {
        state.g_engine.tempo_segments[i] = state.g_engine.tempo_segments[i - 1];
    }
    state.g_engine.tempo_segments[insert] = seg;
    state.g_engine.tempo_count += 1;
    return true;
}

pub fn tempoAtMeasure(measure_raw: f64) f64 {
    const measure = sanitizeMeasure(measure_raw);
    if (state.g_engine.tempo_count == 0) return DEFAULT_TEMPO;

    var selected = TempoSegment{};
    var has_selected = false;
    for (0..state.g_engine.tempo_count) |i| {
        const seg = state.g_engine.tempo_segments[i];
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

pub fn sanitizeUnit(v: f64) f64 {
    if (v != v) return 1.0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

pub fn sanitizePan(v: f64) f64 {
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
        const handle = state.g_engine.sound_handles[idx];
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
    if (state.g_engine.next_sound_handle >= STRETCHED_SOUND_BASE) {
        const next_idx = state.g_engine.next_sound_handle - STRETCHED_SOUND_BASE;
        if (next_idx < MAX_AUDIO_SOUND_HANDLES and !state.g_engine.sound_handles[next_idx].active) {
            idx = @intCast(next_idx);
        }
    }
    if (idx == null) {
        for (0..MAX_AUDIO_SOUND_HANDLES) |i| {
            if (!state.g_engine.sound_handles[i].active) {
                idx = i;
                break;
            }
        }
    }

    const slot = idx orelse return if (info.kind == .generated) info.base_sound else 0;
    const handle = STRETCHED_SOUND_BASE + @as(u32, @intCast(slot));
    state.g_engine.sound_handles[slot] = .{
        .active = true,
        .kind = info.kind,
        .base_sound = @min(info.base_sound, 4),
        .sample_id = info.sample_id,
        .stretch = sanitizeStretchFactor(info.stretch),
        .slice_start = sanitizeSlicePosition(info.slice_start),
        .duration = @max(0, info.duration),
    };
    state.g_engine.next_sound_handle = handle + 1;
    return handle;
}

fn retireBeatBytes(ptr: ?[*]u8, len: u32) void {
    if (ptr == null or len == 0) return;
    if (state.g_engine.retired_beat_count >= MAX_RETIRED_BEATS) return;
    state.g_engine.retired_beats[state.g_engine.retired_beat_count] = .{ .ptr = ptr, .len = len };
    state.g_engine.retired_beat_count += 1;
}

pub fn freeBeatBytes() void {
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &state.g_engine.beat_patterns[i];
        if (p.beat_ptr) |ptr| {
            std.heap.c_allocator.free(ptr[0..p.beat_len]);
        }
        p.* = .{};
    }
    for (0..MAX_BEAT_TRACKS) |i| state.g_engine.beat_tracks[i] = .{};
    for (0..MAX_MEDIA_EVENTS) |i| state.g_engine.media_events[i] = .{};
    for (0..state.g_engine.retired_beat_count) |i| {
        const retired = state.g_engine.retired_beats[i];
        if (retired.ptr) |ptr| {
            std.heap.c_allocator.free(ptr[0..retired.len]);
        }
        state.g_engine.retired_beats[i] = .{};
    }
    state.g_engine.retired_beat_count = 0;
    for (0..MAX_AUDIO_SOUND_HANDLES) |i| state.g_engine.sound_handles[i] = .{};
    state.g_engine.next_sound_handle = STRETCHED_SOUND_BASE;
}

fn sampleIndex(sample_id: u32) ?usize {
    if (sample_id == 0) return null;
    const idx = sample_id - 1;
    if (idx >= MAX_AUDIO_SAMPLES) return null;
    return @intCast(idx);
}

pub fn sampleById(sample_id: u32) ?*const SampleData {
    const idx = sampleIndex(sample_id) orelse return null;
    const sample = &state.g_engine.samples[idx];
    if (!sample.active or sample.samples == null or sample.frame_count == 0) return null;
    return sample;
}

pub fn freeSampleStorage() void {
    for (0..MAX_AUDIO_SAMPLES) |i| {
        if (state.g_engine.samples[i].samples) |samples| {
            std.heap.c_allocator.free(samples);
        }
        state.g_engine.samples[i] = .{};
    }
    state.g_engine.next_sample_id = 1;
    for (0..MAX_SAMPLE_VOICES) |i| state.g_engine.sample_voices[i] = .{};
}

fn freeSampleById(sample_id: u32) void {
    const idx = sampleIndex(sample_id) orelse return;
    if (state.g_engine.samples[idx].samples) |samples| {
        std.heap.c_allocator.free(samples);
    }
    state.g_engine.samples[idx] = .{};
    for (0..MAX_SAMPLE_VOICES) |i| {
        if (state.g_engine.sample_voices[i].sample_id == sample_id) state.g_engine.sample_voices[i] = .{};
    }
}

fn allocateSample(samples: []f32, sample_rate: u32, channels: u16) u32 {
    var idx: ?usize = null;
    if (state.g_engine.next_sample_id > 0) {
        const next_idx = state.g_engine.next_sample_id - 1;
        if (next_idx < MAX_AUDIO_SAMPLES and !state.g_engine.samples[next_idx].active) {
            idx = @intCast(next_idx);
        }
    }
    if (idx == null) {
        for (0..MAX_AUDIO_SAMPLES) |i| {
            if (!state.g_engine.samples[i].active) {
                idx = i;
                break;
            }
        }
    }

    const slot = idx orelse return 0;
    const id = @as(u32, @intCast(slot)) + 1;
    state.g_engine.samples[slot] = .{
        .active = true,
        .samples = samples,
        .sample_rate = if (sample_rate == 0) SAMPLE_RATE else sample_rate,
        .frame_count = @intCast(@min(samples.len, std.math.maxInt(u32))),
        .channels = channels,
    };
    state.g_engine.next_sample_id = id + 1;
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

fn decodeWavToMonoF32(io: std.Io, path: []const u8) ?SampleData {
    const bytes = std.Io.Dir.cwd().readFileAlloc(io, path, std.heap.c_allocator, .limited(256 * 1024 * 1024)) catch return null;
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
        const bt = &state.g_engine.beat_tracks[i];
        if (bt.active and bt.track == t) return bt;
    }
    return null;
}

fn ensureBeatTrack(track: i32) ?*BeatTrack {
    const t = sanitizeTrack(track);
    if (findBeatTrack(t)) |bt| return bt;

    if (state.g_engine.module_count >= MAX_MODULES) return null;

    var slot: ?*BeatTrack = null;
    for (0..MAX_BEAT_TRACKS) |i| {
        if (!state.g_engine.beat_tracks[i].active) {
            slot = &state.g_engine.beat_tracks[i];
            break;
        }
    }
    const bt = slot orelse return null;

    var m = &state.g_engine.modules[state.g_engine.module_count];
    m.* = Module{};
    m.id = BEAT_TRACK_MODULE_BASE + @as(u32, @intCast(t));
    m.slot_index = state.g_engine.module_count;
    m.module_type = .synth;
    m.active = true;
    dsp.initModulePorts(m);
    state.g_engine.module_count += 1;
    state.g_engine.order_dirty = true;

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

pub fn findBeatTrackByModule(module_id: u32) ?*BeatTrack {
    for (0..MAX_BEAT_TRACKS) |i| {
        const bt = &state.g_engine.beat_tracks[i];
        if (bt.active and bt.module_id == module_id) return bt;
    }
    return null;
}

fn anyTrackSoloed() bool {
    for (0..MAX_BEAT_TRACKS) |i| {
        const bt = &state.g_engine.beat_tracks[i];
        if (bt.active and bt.soloed) return true;
    }
    return false;
}

pub fn trackAudible(bt: *const BeatTrack) bool {
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
        const p = &state.g_engine.beat_patterns[i];
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
        const ev = &state.g_engine.media_events[i];
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
            if (state.g_engine.sample_voices[i].active and state.g_engine.sample_voices[i].track == track) {
                state.g_engine.sample_voices[i] = .{};
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
        const p = &state.g_engine.beat_patterns[i];
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
    const measure = state.g_engine.transport_measure;
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &state.g_engine.beat_patterns[i];
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
        const ev = &state.g_engine.media_events[i];
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
        const p = &state.g_engine.beat_patterns[i];
        if (p.active and p.track == track and @abs(p.start_measure - start_measure) <= eps) {
            slot = p;
            break;
        }
    }
    if (slot == null) {
        for (0..MAX_BEAT_PATTERNS) |i| {
            if (!state.g_engine.beat_patterns[i].active) {
                slot = &state.g_engine.beat_patterns[i];
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
    if (state.g_engine.transport_measure > start_measure) {
        const elapsed = (state.g_engine.transport_measure - start_measure) * steps_per_measure;
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
        const ev = &state.g_engine.media_events[i];
        if (ev.active and ev.track == track and @abs(ev.start_measure - start_measure) <= eps) {
            slot = ev;
            break;
        }
    }
    if (slot == null) {
        for (0..MAX_MEDIA_EVENTS) |i| {
            if (!state.g_engine.media_events[i].active) {
                slot = &state.g_engine.media_events[i];
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
    if (dsp.findModule(module_id)) |m| {
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
        m.trigger_time = slice_measure * BEATS_PER_MEASURE * 60.0 / @max(1.0, state.g_engine.current_tempo);
        dsp.prepareSynthTrigger(m, vel);
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
        if (!state.g_engine.sample_voices[i].active) {
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

    state.g_engine.sample_voices[voice_idx] = .{
        .active = true,
        .track = sanitizeTrack(track_raw),
        .sample_id = info.sample_id,
        .pos = source_pos,
        .rate = @as(f64, @floatFromInt(sample.sample_rate)) / @as(f64, @floatFromInt(SAMPLE_RATE)) / stretch,
        .remaining_frames = output_frames,
        .gain = @floatCast(vel),
    };
}

pub fn mixSampleVoices(num_samples: u32) void {
    for (0..MAX_SAMPLE_VOICES) |voice_idx| {
        var v = &state.g_engine.sample_voices[voice_idx];
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
            const sample_value = (s0 + (s1 - s0) * frac) * v.gain * volume * state.g_engine.master_gain;
            const out = i * @as(usize, MAX_CHANNELS);
            state.g_engine.master_buffer[out] += sample_value * left_gain;
            state.g_engine.master_buffer[out + 1] += sample_value * right_gain;
            v.pos += v.rate;
            v.remaining_frames -= 1.0;
        }
    }
}

pub fn scheduleMediaEvents() void {
    const measure = state.g_engine.transport_measure;
    for (0..MAX_MEDIA_EVENTS) |i| {
        const ev = &state.g_engine.media_events[i];
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

pub fn scheduleBeatPatterns() void {
    const measure = state.g_engine.transport_measure;
    for (0..MAX_BEAT_PATTERNS) |i| {
        const p = &state.g_engine.beat_patterns[i];
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

pub fn processCommands() void {
    while (state.popCommand()) |cmd| {
        switch (cmd.cmd_type) {
            .add_module => {
                if (state.g_engine.module_count >= MAX_MODULES) continue;
                var m = &state.g_engine.modules[state.g_engine.module_count];
                m.* = Module{};
                m.id = cmd.module_id;
                m.slot_index = state.g_engine.module_count;
                m.module_type = cmd.module_type;
                m.active = true;
                dsp.initModulePorts(m);
                state.g_engine.module_count += 1;
                state.g_engine.order_dirty = true;
            },
            .remove_module => {
                if (dsp.findModule(cmd.module_id)) |m| {
                    m.active = false;
                    // Remove connections involving this module
                    for (0..state.g_engine.connection_count) |i| {
                        const c = &state.g_engine.connections[i];
                        if (c.from_module == cmd.module_id or c.to_module == cmd.module_id) {
                            c.active = false;
                        }
                    }
                    state.g_engine.order_dirty = true;
                }
            },
            .connect => {
                if (state.g_engine.connection_count >= MAX_CONNECTIONS) continue;
                var c = &state.g_engine.connections[state.g_engine.connection_count];
                c.from_module = cmd.module_id;
                c.from_port = cmd.port_a;
                c.to_module = cmd.target_module;
                c.to_port = cmd.port_b;
                c.active = true;
                state.g_engine.connection_count += 1;
                state.g_engine.order_dirty = true;
            },
            .disconnect => {
                for (0..state.g_engine.connection_count) |i| {
                    const c = &state.g_engine.connections[i];
                    if (c.from_module == cmd.module_id and c.from_port == cmd.port_a and
                        c.to_module == cmd.target_module and c.to_port == cmd.port_b)
                    {
                        c.active = false;
                        state.g_engine.order_dirty = true;
                    }
                }
            },
            .set_param => {
                if (dsp.findModule(cmd.module_id)) |m| {
                    if (cmd.param_index < m.param_count) {
                        m.params[cmd.param_index].value = cmd.value_f;
                    }
                }
            },
            .note_on => {
                if (dsp.findModule(cmd.module_id)) |m| {
                    dsp.triggerModuleNote(m, cmd.value_i, cmd.value_f);
                }
            },
            .note_off => {
                if (dsp.findModule(cmd.module_id)) |m| {
                    dsp.releaseModuleNote(m, cmd.value_i);
                }
            },
            .set_master_gain => {
                // Clamp to [0, 1.5]. The output limiter handles peaks above this; the
                // clamp just keeps a stray "set master to 50" from making the limiter
                // do all the work.
                const requested: f32 = @floatCast(cmd.value_f);
                state.g_engine.master_gain = std.math.clamp(requested, 0.0, 1.5);
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
                state.g_engine.transport_playing = true;
            },
            .transport_pause => {
                state.g_engine.transport_playing = false;
            },
            .transport_stop => {
                state.g_engine.transport_playing = false;
                state.g_engine.transport_measure = 0;
                resetTimelineCursors();
            },
            .transport_set_playhead => {
                state.g_engine.transport_measure = sanitizeMeasure(cmd.start_measure);
                resetTimelineCursors();
            },
            .load_sample => {
                if (dsp.findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sampler or cmd.param_index >= MAX_SAMPLER_SLOTS or cmd.value_i <= 0) continue;
                    m.sampler_slots[cmd.param_index] = @intCast(cmd.value_i);
                    m.sampler_slot_loop[cmd.param_index] = cmd.value_f >= 0.5;
                }
            },
            .clear_sample => {
                if (dsp.findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sampler or cmd.param_index >= MAX_SAMPLER_SLOTS) continue;
                    m.sampler_slots[cmd.param_index] = 0;
                    m.sampler_slot_loop[cmd.param_index] = false;
                    for (0..MAX_SAMPLER_VOICES) |i| {
                        if (m.sampler_voice_slot[i] == cmd.param_index) m.sampler_voice_active[i] = false;
                    }
                }
            },
            .sequencer_set_step => {
                if (dsp.findModule(cmd.module_id)) |m| {
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
                if (dsp.findModule(cmd.module_id)) |m| {
                    if (m.module_type != .sequencer or cmd.beat_track < 0) continue;
                    const track: usize = @intCast(cmd.beat_track);
                    if (track >= MAX_SEQUENCER_TRACKS) continue;
                    m.sequencer_track_target[track] = cmd.target_module;
                }
            },
            .sequencer_clear_pattern => {
                if (dsp.findModule(cmd.module_id)) |m| {
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
                for (0..state.g_engine.module_count) |i| {
                    const m = &state.g_engine.modules[i];
                    if (!m.active or m.module_type != .clock) continue;
                    if (cmd.module_id != 0 and m.id != cmd.module_id) continue;
                    m.clock_midi_pulse_count += 1;
                    if (m.clock_midi_pulse_count >= dsp.clockMidiPulsesPerTick(m.params[1].value)) {
                        m.clock_midi_pulse_count = 0;
                        dsp.queueClockTick(m);
                    }
                }
            },
            .clock_start => {
                for (0..state.g_engine.module_count) |i| {
                    const m = &state.g_engine.modules[i];
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
                for (0..state.g_engine.module_count) |i| {
                    const m = &state.g_engine.modules[i];
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
pub fn setTempo(start_tempo: f64, start_measure: f64, end_tempo: f64, end_measure: f64, has_end_tempo: bool, has_end_measure: bool) bool {
    var flags: u8 = 0;
    if (has_end_tempo) flags |= TEMPO_FLAG_END_TEMPO;
    if (has_end_measure) flags |= TEMPO_FLAG_END_MEASURE;
    return state.pushCommand(.{
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
    if (!state.pushCommand(.{
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
    if (!state.pushCommand(.{
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

    return state.pushCommand(.{
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

    return state.pushCommand(.{
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

    return state.pushCommand(.{
        .cmd_type = .insert_media,
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .sounds = section_sound,
        .sound_count = 1,
    });
}

pub fn clearTrack(track: i32, start_measure: f64, end_measure: f64, has_range: bool) bool {
    if (has_range and apiMeasureToTransport(end_measure) <= apiMeasureToTransport(start_measure)) return false;
    return state.pushCommand(.{
        .cmd_type = .clear_track,
        .beat_track = sanitizeTrack(track),
        .start_measure = apiMeasureToTransport(start_measure),
        .end_measure = apiMeasureToTransport(end_measure),
        .tempo_flags = if (has_range) TRACK_FLAG_RANGE else 0,
    });
}

pub fn setTrackVolume(track: i32, volume: f64) bool {
    return state.pushCommand(.{
        .cmd_type = .set_track_volume,
        .beat_track = sanitizeTrack(track),
        .value_f = sanitizeUnit(volume),
    });
}

pub fn setTrackPan(track: i32, pan: f64) bool {
    return state.pushCommand(.{
        .cmd_type = .set_track_pan,
        .beat_track = sanitizeTrack(track),
        .value_f = sanitizePan(pan),
    });
}

pub fn setTrackMute(track: i32, muted: bool) bool {
    return state.pushCommand(.{
        .cmd_type = .set_track_mute,
        .beat_track = sanitizeTrack(track),
        .value_i = if (muted) 1 else 0,
    });
}

pub fn setTrackSolo(track: i32, soloed: bool) bool {
    return state.pushCommand(.{
        .cmd_type = .set_track_solo,
        .beat_track = sanitizeTrack(track),
        .value_i = if (soloed) 1 else 0,
    });
}

pub fn setStepVelocity(track: i32, step: i32, velocity: f64) bool {
    if (step < 0) return false;
    return state.pushCommand(.{
        .cmd_type = .set_step_velocity,
        .beat_track = sanitizeTrack(track),
        .step_index = @intCast(step),
        .value_f = sanitizeUnit(velocity),
    });
}

pub fn setStepProbability(track: i32, step: i32, probability: f64) bool {
    if (step < 0) return false;
    return state.pushCommand(.{
        .cmd_type = .set_step_probability,
        .beat_track = sanitizeTrack(track),
        .step_index = @intCast(step),
        .value_f = sanitizeUnit(probability),
    });
}

pub fn setStepOffset(track: i32, step: i32, offset: f64) bool {
    if (step < 0) return false;
    return state.pushCommand(.{
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
    return state.pushCommand(.{
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
    return state.pushCommand(.{
        .cmd_type = .sequencer_set_track_target,
        .module_id = module_id,
        .beat_track = track,
        .target_module = target_module,
    });
}

pub fn clearPattern(module_id: u32) bool {
    return state.pushCommand(.{
        .cmd_type = .sequencer_clear_pattern,
        .module_id = module_id,
    });
}

pub fn clockPulse(module_id: u32) bool {
    return state.pushCommand(.{
        .cmd_type = .clock_pulse,
        .module_id = module_id,
    });
}

pub fn clockStart(module_id: u32) bool {
    return state.pushCommand(.{
        .cmd_type = .clock_start,
        .module_id = module_id,
    });
}

pub fn clockStop(module_id: u32) bool {
    return state.pushCommand(.{
        .cmd_type = .clock_stop,
        .module_id = module_id,
    });
}

pub fn play() bool {
    return state.pushCommand(.{ .cmd_type = .transport_play });
}

pub fn pauseTransport() bool {
    return state.pushCommand(.{ .cmd_type = .transport_pause });
}

pub fn stop() bool {
    return state.pushCommand(.{ .cmd_type = .transport_stop });
}

pub fn setPlayhead(measure: f64) bool {
    return state.pushCommand(.{
        .cmd_type = .transport_set_playhead,
        .start_measure = apiMeasureToTransport(measure),
    });
}

pub fn getPlayhead() f64 {
    return state.g_engine.transport_measure + 1.0;
}

pub fn isPlaying() bool {
    return state.g_engine.transport_playing;
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

pub fn loadSound(io: std.Io, path: []const u8) u32 {
    const decoded = decodeWavToMonoF32(io, path) orelse return 0;
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

pub fn loadSample(io: std.Io, module_id: u32, slot_raw: i32, path: []const u8, mode: []const u8) bool {
    if (slot_raw < 1 or slot_raw > @as(i32, @intCast(MAX_SAMPLER_SLOTS))) return false;
    const decoded = decodeWavToMonoF32(io, path) orelse return false;
    const sample_buffer = decoded.samples orelse return false;
    const sample_id = allocateSample(sample_buffer, decoded.sample_rate, decoded.channels);
    if (sample_id == 0) {
        std.heap.c_allocator.free(sample_buffer);
        return false;
    }
    const loop = std.mem.eql(u8, mode, "loop");
    if (!state.pushCommand(.{
        .cmd_type = .load_sample,
        .module_id = module_id,
        .param_index = @intCast(slot_raw - 1),
        .value_i = @intCast(sample_id),
        .value_f = if (loop) 1.0 else 0.0,
    })) {
        if (sampleIndex(sample_id)) |idx| {
            if (state.g_engine.samples[idx].samples) |samples| std.heap.c_allocator.free(samples);
            state.g_engine.samples[idx] = .{};
        }
        return false;
    }
    return true;
}

pub fn clearSample(module_id: u32, slot_raw: i32) bool {
    if (slot_raw < 1 or slot_raw > @as(i32, @intCast(MAX_SAMPLER_SLOTS))) return false;
    return state.pushCommand(.{
        .cmd_type = .clear_sample,
        .module_id = module_id,
        .param_index = @intCast(slot_raw - 1),
    });
}

// ── Telemetry ───────────────────────────────────────────────────────

pub fn logTelemetry() void {
    if (!state.g_engine.initialized) return;
    // Emit only when something interesting changed. The previous version logged
    // every tick (1 Hz) and drowned the log pane. Module/connection count change
    // is the signal you actually want; callback count is monotonic noise.
    const Last = struct {
        var modules: u32 = std.math.maxInt(u32);
        var connections: u32 = std.math.maxInt(u32);
    };
    const m = state.g_engine.module_count;
    const c = state.g_engine.connection_count;
    if (m == Last.modules and c == Last.connections) return;
    Last.modules = m;
    Last.connections = c;
    log.print("[audio] modules: {d} | connections: {d} | callbacks: {d} | last: {d}us\n", .{
        m,
        c,
        state.g_engine.callback_count.load(.monotonic),
        state.g_engine.callback_us.load(.monotonic),
    });
}
pub fn getModuleCount() u32 {
    return state.g_engine.module_count;
}

pub fn getConnectionCount() u32 {
    return state.g_engine.connection_count;
}

pub fn getCallbackCount() u64 {
    return state.g_engine.callback_count.load(.monotonic);
}

pub fn getCallbackUs() u64 {
    return state.g_engine.callback_us.load(.monotonic);
}

pub fn getPeakLevel() f32 {
    var peak: f32 = 0;
    for (0..BUFFER_SIZE * MAX_CHANNELS) |i| {
        const v = @abs(state.g_engine.master_buffer[i]);
        if (v > peak) peak = v;
    }
    return peak;
}

pub fn getParam(module_id: u32, param_idx: u8) f64 {
    if (dsp.findModule(module_id)) |m| {
        if (param_idx < m.param_count) return m.params[param_idx].value;
    }
    return 0;
}

pub fn getParamCount(module_id: u32) u8 {
    if (dsp.findModule(module_id)) |m| return m.param_count;
    return 0;
}

pub fn getPortCount(module_id: u32) u8 {
    if (dsp.findModule(module_id)) |m| return m.port_count;
    return 0;
}

pub fn getModuleType(module_id: u32) i32 {
    if (dsp.findModule(module_id)) |m| return @intFromEnum(m.module_type);
    return -1;
}

pub fn getParamMin(module_id: u32, param_idx: u8) f64 {
    if (dsp.findModule(module_id)) |m| {
        if (param_idx < m.param_count) return m.params[param_idx].min;
    }
    return 0;
}

pub fn getParamMax(module_id: u32, param_idx: u8) f64 {
    if (dsp.findModule(module_id)) |m| {
        if (param_idx < m.param_count) return m.params[param_idx].max;
    }
    return 0;
}
