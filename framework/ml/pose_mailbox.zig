//! Bounded cross-thread mailbox for live pose inference.
//!
//! The render thread owns camera buffers and mutates them every frame, while
//! ONNX inference must never run on (or borrow memory from) that thread. This
//! mailbox is the strict seam between them:
//!
//! - `submitCopy` validates and owns one RGBA snapshot.
//! - one pending/working/result pipeline applies backpressure (no frame queue).
//! - the worker takes ownership of the snapshot and publishes a fixed result.
//! - the engine tick polls the result without waiting.

const std = @import("std");

fn io() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

pub const KEYPOINTS: usize = 17;
pub const MAX_ERROR_BYTES: usize = 256;

pub const Keypoint = struct {
    x: f32,
    y: f32,
    score: f32,
};

pub const Result = struct {
    request_id: u32,
    keypoints: [KEYPOINTS]Keypoint = undefined,
    ok: bool = false,
    elapsed_ms: u32 = 0,
    error_buf: [MAX_ERROR_BYTES]u8 = undefined,
    error_len: u16 = 0,

    pub fn success(request_id: u32, keypoints: [KEYPOINTS]Keypoint, elapsed_ms: u32) Result {
        return .{
            .request_id = request_id,
            .keypoints = keypoints,
            .ok = true,
            .elapsed_ms = elapsed_ms,
        };
    }

    pub fn failure(request_id: u32, message: []const u8, elapsed_ms: u32) Result {
        var out: Result = .{
            .request_id = request_id,
            .elapsed_ms = elapsed_ms,
        };
        const n = @min(message.len, MAX_ERROR_BYTES);
        @memcpy(out.error_buf[0..n], message[0..n]);
        out.error_len = @intCast(n);
        return out;
    }

    pub fn errorText(self: *const Result) []const u8 {
        return self.error_buf[0..self.error_len];
    }
};

pub const Frame = struct {
    request_id: u32,
    rgba: []u8,
    width: u32,
    height: u32,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *Frame) void {
        self.allocator.free(self.rgba);
        self.rgba = &.{};
    }
};

/// Numeric values cross the V8 boundary; keep queued at zero so callers can
/// use the return directly as a compact status code.
pub const SubmitStatus = enum(i32) {
    queued = 0,
    busy = 1,
    stopped = 2,
    invalid_frame = 3,
    out_of_memory = 4,
};

pub const Queue = struct {
    allocator: std.mem.Allocator,
    mutex: std.Io.Mutex = .init,
    cond: std.Io.Condition = .init,
    pending: ?Frame = null,
    result: ?Result = null,
    working: bool = false,
    shutdown: bool = false,

    pub fn init(allocator: std.mem.Allocator) Queue {
        return .{ .allocator = allocator };
    }

    /// Call only after the worker has observed `stop` and joined.
    pub fn deinit(self: *Queue) void {
        if (self.pending) |*frame| frame.deinit();
        self.pending = null;
        self.result = null;
        self.working = false;
    }

    /// Copy one top-down RGBA frame into worker-owned memory. The queue stays
    /// bounded across pending, inference, and undrained-result phases.
    pub fn submitCopy(self: *Queue, request_id: u32, rgba: []const u8, width: u32, height: u32) SubmitStatus {
        const pixel_count = std.math.mul(usize, @as(usize, width), @as(usize, height)) catch return .invalid_frame;
        const byte_count = std.math.mul(usize, pixel_count, 4) catch return .invalid_frame;
        if (width == 0 or height == 0 or rgba.len < byte_count) return .invalid_frame;

        {
            self.mutex.lockUncancelable(io());
            defer self.mutex.unlock(io());
            if (self.shutdown) return .stopped;
            if (self.pending != null or self.working or self.result != null) return .busy;
        }

        const owned = self.allocator.dupe(u8, rgba[0..byte_count]) catch return .out_of_memory;
        self.mutex.lockUncancelable(io());
        defer self.mutex.unlock(io());
        if (self.shutdown) {
            self.allocator.free(owned);
            return .stopped;
        }
        // A second producer may have won while this producer copied. The live
        // pose path has one producer, but preserving the bound here is cheap.
        if (self.pending != null or self.working or self.result != null) {
            self.allocator.free(owned);
            return .busy;
        }
        self.pending = .{
            .request_id = request_id,
            .rgba = owned,
            .width = width,
            .height = height,
            .allocator = self.allocator,
        };
        self.cond.signal(io());
        return .queued;
    }

    /// Worker-only blocking take. `null` means shutdown.
    pub fn waitTake(self: *Queue) ?Frame {
        self.mutex.lockUncancelable(io());
        defer self.mutex.unlock(io());
        while (self.pending == null and !self.shutdown) self.cond.waitUncancelable(io(), &self.mutex);
        if (self.shutdown) return null;
        const frame = self.pending.?;
        self.pending = null;
        self.working = true;
        return frame;
    }

    /// Non-blocking twin used by focused unit tests.
    pub fn tryTake(self: *Queue) ?Frame {
        self.mutex.lockUncancelable(io());
        defer self.mutex.unlock(io());
        if (self.shutdown or self.pending == null) return null;
        const frame = self.pending.?;
        self.pending = null;
        self.working = true;
        return frame;
    }

    /// Worker publishes at most one result. False means shutdown discarded it.
    pub fn publish(self: *Queue, result: Result) bool {
        self.mutex.lockUncancelable(io());
        defer self.mutex.unlock(io());
        self.working = false;
        if (self.shutdown) return false;
        if (self.result != null) return false;
        self.result = result;
        return true;
    }

    /// Engine-tick non-blocking result take.
    pub fn poll(self: *Queue) ?Result {
        self.mutex.lockUncancelable(io());
        defer self.mutex.unlock(io());
        const out = self.result;
        self.result = null;
        return out;
    }

    pub fn stop(self: *Queue) void {
        self.mutex.lockUncancelable(io());
        self.shutdown = true;
        self.cond.signal(io());
        self.mutex.unlock(io());
    }
};
