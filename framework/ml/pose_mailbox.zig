//! Bounded cross-thread mailbox for live pose inference.
//!
//! The render thread owns camera buffers and mutates them every frame, while
//! ONNX inference must never run on (or borrow memory from) that thread. This
//! mailbox is the strict seam between them:
//!
//! - `submitCopy` validates and owns one RGBA snapshot.
//! - native `std.Io.Queue` instances bound the pending/result pipeline to one.
//! - the worker takes ownership of the snapshot and publishes a fixed result.
//! - the engine tick polls the result without waiting.

const std = @import("std");

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
    pending: std.Io.Queue(Frame),
    completed: std.Io.Queue(Result),
    pending_storage: [1]Frame = undefined,
    completed_storage: [1]Result = undefined,
    occupied: std.atomic.Value(bool) = .init(false),
    stopped: std.atomic.Value(bool) = .init(false),

    /// Initialize in place: the native queues retain pointers to this
    /// resource's one-element backing stores, so the resource must not move.
    pub fn init(self: *Queue, allocator: std.mem.Allocator) void {
        self.* = .{
            .allocator = allocator,
            .pending = .init(&self.pending_storage),
            .completed = .init(&self.completed_storage),
        };
    }

    /// Call only after the worker task has observed `stop` and joined.
    pub fn deinit(self: *Queue, io: std.Io) void {
        self.stop(io);
        var pending: [1]Frame = undefined;
        if ((self.pending.getUncancelable(io, &pending, 0) catch 0) == 1) {
            pending[0].deinit();
        }
        var completed: [1]Result = undefined;
        _ = self.completed.getUncancelable(io, &completed, 0) catch 0;
        self.occupied.store(false, .release);
    }

    /// Copy one top-down RGBA frame into worker-owned memory. The queue stays
    /// bounded across pending, inference, and undrained-result phases.
    pub fn submitCopy(self: *Queue, io: std.Io, request_id: u32, rgba: []const u8, width: u32, height: u32) SubmitStatus {
        const pixel_count = std.math.mul(usize, @as(usize, width), @as(usize, height)) catch return .invalid_frame;
        const byte_count = std.math.mul(usize, pixel_count, 4) catch return .invalid_frame;
        if (width == 0 or height == 0 or rgba.len < byte_count) return .invalid_frame;

        if (self.stopped.load(.acquire)) return .stopped;
        if (self.occupied.cmpxchgStrong(false, true, .acq_rel, .acquire) != null) return .busy;

        const owned = self.allocator.dupe(u8, rgba[0..byte_count]) catch {
            self.occupied.store(false, .release);
            return .out_of_memory;
        };
        if (self.stopped.load(.acquire)) {
            self.allocator.free(owned);
            self.occupied.store(false, .release);
            return .stopped;
        }
        const frame: Frame = .{
            .request_id = request_id,
            .rgba = owned,
            .width = width,
            .height = height,
            .allocator = self.allocator,
        };
        const queued = self.pending.putUncancelable(io, &.{frame}, 0) catch 0;
        if (queued != 1) {
            self.allocator.free(owned);
            self.occupied.store(false, .release);
            return if (self.stopped.load(.acquire)) .stopped else .busy;
        }
        return .queued;
    }

    /// Worker-only blocking take. `null` means shutdown.
    pub fn waitTake(self: *Queue, io: std.Io) std.Io.Cancelable!?Frame {
        var frame = self.pending.getOne(io) catch |err| switch (err) {
            error.Closed => return null,
            error.Canceled => return error.Canceled,
        };
        if (self.stopped.load(.acquire)) {
            frame.deinit();
            self.occupied.store(false, .release);
            return null;
        }
        return frame;
    }

    /// Non-blocking twin used by focused unit tests.
    pub fn tryTake(self: *Queue, io: std.Io) ?Frame {
        var frame: [1]Frame = undefined;
        const n = self.pending.getUncancelable(io, &frame, 0) catch return null;
        return if (n == 1) frame[0] else null;
    }

    /// Worker publishes at most one result. False means shutdown discarded it.
    pub fn publish(self: *Queue, io: std.Io, result: Result) bool {
        if (self.stopped.load(.acquire)) {
            self.occupied.store(false, .release);
            return false;
        }
        const queued = self.completed.putUncancelable(io, &.{result}, 0) catch 0;
        if (queued == 1) return true;
        self.occupied.store(false, .release);
        return false;
    }

    /// Engine-tick non-blocking result take.
    pub fn poll(self: *Queue, io: std.Io) ?Result {
        var result: [1]Result = undefined;
        const n = self.completed.getUncancelable(io, &result, 0) catch return null;
        if (n == 0) return null;
        self.occupied.store(false, .release);
        return result[0];
    }

    pub fn stop(self: *Queue, io: std.Io) void {
        if (self.stopped.swap(true, .acq_rel)) return;
        self.pending.close(io);
        self.completed.close(io);
    }
};
