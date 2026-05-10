//! Session recorder — captures raw PTY output with timestamps.
//!
//! Recordings are classifier-independent: they store the raw terminal stream,
//! not classified tokens. Classification happens at playback time, so you can
//! replay the same recording through different classifiers.
//!
//! Format: binary frames. Each frame = { timestamp_us: u64, len: u32, data: [len]u8 }
//! Header: magic "TREC", version u8, rows u16, cols u16.

const std = @import("std");

pub const MAGIC = "TREC";
pub const VERSION: u8 = 1;
const MAX_FRAMES = 50000;
const DATA_BUF_SIZE = 4 * 1024 * 1024; // 4MB circular data buffer

pub const Frame = struct {
    timestamp_us: u64,
    data_offset: u32,
    data_len: u32,
};

pub const Recorder = struct {
    frames: [MAX_FRAMES]Frame = undefined,
    frame_count: u32 = 0,
    data_buf: [DATA_BUF_SIZE]u8 = undefined,
    data_pos: u32 = 0,
    start_us: u64 = 0,
    recording: bool = false,
    rows: u16 = 24,
    cols: u16 = 80,

    pub fn start(self: *Recorder, rows: u16, cols: u16) void {
        self.rows = rows;
        self.cols = cols;
        self.frame_count = 0;
        self.data_pos = 0;
        self.start_us = getMicroseconds();
        self.recording = true;
    }

    pub fn capture(self: *Recorder, data: []const u8) void {
        if (!self.recording) {
            self.start_us = getMicroseconds();
            self.recording = true;
        }
        if (data.len == 0) return;
        if (self.frame_count >= MAX_FRAMES) return;
        if (self.data_pos + data.len > DATA_BUF_SIZE) return;

        // Store data
        const offset = self.data_pos;
        @memcpy(self.data_buf[offset .. offset + data.len], data);
        self.data_pos += @intCast(data.len);

        // Store frame
        self.frames[self.frame_count] = .{
            .timestamp_us = getMicroseconds() - self.start_us,
            .data_offset = offset,
            .data_len = @intCast(data.len),
        };
        self.frame_count += 1;
    }

    pub fn stop(self: *Recorder) void {
        self.recording = false;
    }

    /// Get frame data for a given frame index.
    pub fn getFrameData(self: *const Recorder, idx: u32) ?[]const u8 {
        if (idx >= self.frame_count) return null;
        const f = self.frames[idx];
        return self.data_buf[f.data_offset .. f.data_offset + f.data_len];
    }

    /// Duration in microseconds.
    pub fn durationUs(self: *const Recorder) u64 {
        if (self.frame_count == 0) return 0;
        return self.frames[self.frame_count - 1].timestamp_us;
    }

    /// Save recording to a file.
    pub fn save(self: *const Recorder, path: []const u8) bool {
        const file = std.fs.cwd().createFile(path, .{}) catch return false;
        defer file.close();

        // Header
        file.writeAll(MAGIC) catch return false;
        file.writeAll(&[1]u8{VERSION}) catch return false;
        file.writeAll(std.mem.asBytes(&std.mem.nativeToLittle(u16, self.rows))) catch return false;
        file.writeAll(std.mem.asBytes(&std.mem.nativeToLittle(u16, self.cols))) catch return false;
        file.writeAll(std.mem.asBytes(&std.mem.nativeToLittle(u32, self.frame_count))) catch return false;

        // Frames
        var i: u32 = 0;
        while (i < self.frame_count) : (i += 1) {
            const f = self.frames[i];
            file.writeAll(std.mem.asBytes(&std.mem.nativeToLittle(u64, f.timestamp_us))) catch return false;
            file.writeAll(std.mem.asBytes(&std.mem.nativeToLittle(u32, f.data_len))) catch return false;
            file.writeAll(self.data_buf[f.data_offset .. f.data_offset + f.data_len]) catch return false;
        }
        return true;
    }
};

pub const Recording = struct {
    frames: []Frame,
    data: []const u8,
    rows: u16,
    cols: u16,
    frame_count: u32,

    pub fn getFrameData(self: *const Recording, idx: u32) ?[]const u8 {
        if (idx >= self.frame_count) return null;
        const f = self.frames[idx];
        if (f.data_offset + f.data_len > self.data.len) return null;
        return self.data[f.data_offset .. f.data_offset + f.data_len];
    }

    pub fn durationUs(self: *const Recording) u64 {
        if (self.frame_count == 0) return 0;
        return self.frames[self.frame_count - 1].timestamp_us;
    }
};

fn getMicroseconds() u64 {
    return @intCast(@max(0, std.time.microTimestamp()));
}
