//! Session player — replays recorded terminal sessions through vterm.
//!
//! Feeds recorded PTY data to vterm at original timing (or with speed
//! multiplier). Supports seek, step, pause, speed control.
//!
//! Recordings are classifier-independent: the same recording replayed
//! through different classifiers produces different interpretations.

const std = @import("std");
const vterm_mod = @import("vterm.zig");
const recorder = @import("recorder.zig");
const m = @import("../math/root.zig");

pub const State = struct {
    playing: bool = false,
    time_us: u64 = 0,
    duration_us: u64 = 0,
    frame: u32 = 0,
    total_frames: u32 = 0,
    speed: f32 = 1.0,
    at_end: bool = false,
    at_start: bool = true,
};

// ── Player state (module-level, single instance) ────────────────────

var rec: ?*const recorder.Recorder = null;
var playing: bool = false;
var time_us: u64 = 0;
var frame_index: u32 = 0;
var speed: f32 = 1.0;
var dirty: bool = false;
var player_rows: u16 = 24;
var player_cols: u16 = 80;
var total_frames: u32 = 0;
var duration_us: u64 = 0;

/// Load a recording for playback.
pub fn load(recording: *const recorder.Recorder) void {
    rec = recording;
    player_rows = recording.rows;
    player_cols = recording.cols;
    total_frames = recording.frame_count;
    duration_us = recording.durationUs();

    // Init vterm with recorded dimensions
    vterm_mod.initVterm(player_rows, player_cols);

    reset();
}

/// Reset playback to the beginning.
pub fn reset() void {
    time_us = 0;
    frame_index = 0;
    playing = false;
    dirty = false;
    // Re-init vterm
    vterm_mod.initVterm(player_rows, player_cols);
}

pub fn play() void {
    playing = true;
}

pub fn pause() void {
    playing = false;
}

pub fn togglePlay() void {
    playing = !playing;
}

pub fn setSpeed(s: f32) void {
    speed = @max(0.1, @min(s, 20.0));
}

/// Step forward one frame.
pub fn step() void {
    playing = false;
    const r = rec orelse return;
    if (frame_index < total_frames) {
        if (r.getFrameData(frame_index)) |data| {
            vterm_mod.feed(data);
        }
        time_us = r.frames[frame_index].timestamp_us;
        frame_index += 1;
        dirty = true;
    }
}

/// Seek to a specific time in microseconds.
pub fn seek(target_us: u64) void {
    const r = rec orelse return;
    const clamped = @min(target_us, duration_us);

    // Find target frame
    var target_idx: u32 = 0;
    var i: u32 = 0;
    while (i < total_frames) : (i += 1) {
        if (r.frames[i].timestamp_us <= clamped) {
            target_idx = i + 1;
        } else break;
    }

    if (target_idx < frame_index) {
        // Seeking backward: replay from start
        vterm_mod.initVterm(player_rows, player_cols);
        var j: u32 = 0;
        while (j < target_idx) : (j += 1) {
            if (r.getFrameData(j)) |data| {
                vterm_mod.feed(data);
            }
        }
    } else {
        // Seeking forward: apply remaining frames
        var j: u32 = frame_index;
        while (j < target_idx) : (j += 1) {
            if (r.getFrameData(j)) |data| {
                vterm_mod.feed(data);
            }
        }
    }
    frame_index = target_idx;
    time_us = clamped;
    dirty = true;
}

/// Seek by fraction (0.0 = start, 1.0 = end).
pub fn seekFraction(frac: f32) void {
    const f = m.clamp01(frac);
    seek(@trunc(f * @as(f32, @floatFromInt(duration_us))));
}

/// Advance playback by dt seconds. Returns true if vterm was modified.
pub fn advance(dt: f32) bool {
    if (!playing) return false;
    const r = rec orelse return false;
    dirty = false;

    const delta_us: u64 = @trunc(@max(0, dt * speed * 1_000_000.0));
    time_us += delta_us;

    // Apply all frames up to current time
    var applied = false;
    while (frame_index < total_frames) {
        if (r.frames[frame_index].timestamp_us <= time_us) {
            if (r.getFrameData(frame_index)) |data| {
                vterm_mod.feed(data);
            }
            frame_index += 1;
            applied = true;
        } else break;
    }

    if (applied) dirty = true;

    // Auto-pause at end
    if (frame_index >= total_frames) {
        playing = false;
    }

    return dirty;
}

pub fn getState() State {
    return .{
        .playing = playing,
        .time_us = time_us,
        .duration_us = duration_us,
        .frame = frame_index,
        .total_frames = total_frames,
        .speed = speed,
        .at_end = frame_index >= total_frames,
        .at_start = frame_index == 0,
    };
}

pub fn isDirty() bool {
    return dirty;
}

pub fn clearDirty() void {
    dirty = false;
}

pub fn isLoaded() bool {
    return rec != null;
}
