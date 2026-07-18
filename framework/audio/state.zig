//! Audio subsystem — global engine state and command queue.

const std = @import("std");
const zluajit = @import("zluajit");
const types = @import("types.zig");
const sdl = @import("sdl.zig");

const BufferPool = struct {
    data: []f32,

    pub fn getBuffer(self: *BufferPool, module_idx: u32, port_idx: u8) [*]f32 {
        const offset = (@as(usize, module_idx) * types.MAX_PORTS_PER_MODULE + port_idx) * types.BUFFER_SIZE;
        return self.data.ptr + offset;
    }
};

pub var g_engine: struct {
    /// Capability installed by the audio owner before SDL starts the callback.
    /// SDL passes a pointer to this value back through its C callback userdata.
    io: std.Io = undefined,
    device_id: sdl.c.SDL_AudioDeviceID = 0,
    stream: ?*sdl.c.SDL_AudioStream = null,

    modules: [types.MAX_MODULES]types.Module = undefined,
    module_count: u32 = 0,
    connections: [types.MAX_CONNECTIONS]types.Connection = undefined,
    connection_count: u32 = 0,

    exec_order: [types.MAX_MODULES]u32 = undefined,
    exec_count: u32 = 0,
    order_dirty: bool = true,

    master_buffer: [types.BUFFER_SIZE * types.MAX_CHANNELS]f32 = [_]f32{0} ** (types.BUFFER_SIZE * types.MAX_CHANNELS),
    master_gain: f32 = 0.8,
    safety_ceiling: f32 = 0.95,
    safety_panic_threshold: f32 = 4.0,

    tempo_segments: [types.MAX_TEMPO_POINTS]types.TempoSegment = [_]types.TempoSegment{types.TempoSegment{}} ** types.MAX_TEMPO_POINTS,
    tempo_count: u32 = 0,
    transport_measure: f64 = 0,
    transport_playing: bool = true,
    current_tempo: f64 = types.DEFAULT_TEMPO,

    beat_patterns: [types.MAX_BEAT_PATTERNS]types.BeatPattern = [_]types.BeatPattern{types.BeatPattern{}} ** types.MAX_BEAT_PATTERNS,
    beat_tracks: [types.MAX_BEAT_TRACKS]types.BeatTrack = [_]types.BeatTrack{types.BeatTrack{}} ** types.MAX_BEAT_TRACKS,
    media_events: [types.MAX_MEDIA_EVENTS]types.MediaEvent = [_]types.MediaEvent{types.MediaEvent{}} ** types.MAX_MEDIA_EVENTS,
    retired_beats: [types.MAX_RETIRED_BEATS]types.RetiredBeat = [_]types.RetiredBeat{types.RetiredBeat{}} ** types.MAX_RETIRED_BEATS,
    retired_beat_count: u32 = 0,
    sound_handles: [types.MAX_AUDIO_SOUND_HANDLES]types.SoundHandle = [_]types.SoundHandle{types.SoundHandle{}} ** types.MAX_AUDIO_SOUND_HANDLES,
    next_sound_handle: u32 = types.STRETCHED_SOUND_BASE,
    samples: [types.MAX_AUDIO_SAMPLES]types.SampleData = [_]types.SampleData{types.SampleData{}} ** types.MAX_AUDIO_SAMPLES,
    next_sample_id: u32 = 1,
    sample_voices: [types.MAX_SAMPLE_VOICES]types.SampleVoice = [_]types.SampleVoice{types.SampleVoice{}} ** types.MAX_SAMPLE_VOICES,

    buffer_pool: BufferPool = .{ .data = &.{} },
    buffer_storage: [types.MAX_MODULES * types.MAX_PORTS_PER_MODULE * types.BUFFER_SIZE]f32 = [_]f32{0} ** (types.MAX_MODULES * types.MAX_PORTS_PER_MODULE * types.BUFFER_SIZE),

    commands: [types.MAX_COMMAND_QUEUE]types.Command = undefined,
    cmd_head: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    cmd_tail: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    lua_state: ?zluajit.State = null,
    lua_ready: bool = false,

    callback_count: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    underrun_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    callback_us: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    initialized: bool = false,
} = .{};

pub fn pushCommand(cmd: types.Command) bool {
    const tail = g_engine.cmd_tail.load(.acquire);
    const next = (tail + 1) % types.MAX_COMMAND_QUEUE;
    if (next == g_engine.cmd_head.load(.acquire)) return false; // full
    g_engine.commands[tail] = cmd;
    g_engine.cmd_tail.store(next, .release);
    return true;
}

pub fn popCommand() ?types.Command {
    const head = g_engine.cmd_head.load(.acquire);
    if (head == g_engine.cmd_tail.load(.acquire)) return null;
    const cmd = g_engine.commands[head];
    g_engine.cmd_head.store((head + 1) % types.MAX_COMMAND_QUEUE, .release);
    return cmd;
}
