//! Bounded cross-thread mailbox for live ML inference, generic over the
//! result payload.
//!
//! The render thread owns camera buffers and mutates them every frame, while
//! ONNX inference must never run on (or borrow memory from) that thread. This
//! mailbox is the strict seam between them:
//!
//! - `submitCopy` validates and owns one RGBA snapshot.
//! - native `std.Io.Queue` instances bound the pending/result pipeline to one.
//! - the worker transfers that exact snapshot into its fixed result.
//! - the engine tick polls the result without waiting and releases ownership.
//!
//! This is the canonical home of the pattern. `pose_mailbox.zig` predates it
//! and keeps its own copy only because the MoveNet lane it serves is legacy
//! slated for deletion with the BlazePose cutover (req_4387).

const std = @import("std");

pub const MAX_ERROR_BYTES: usize = 256;

pub const FrameIdentity = struct {
    request_id: u32,
    frame_id: u64,
    timestamp_ms: u64,
};

pub const Frame = struct {
    identity: FrameIdentity,
    rgba: []u8,
    width: u32,
    height: u32,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *Frame) void {
        if (self.rgba.len > 0) self.allocator.free(self.rgba);
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

pub fn Lane(comptime Payload: type) type {
    return struct {
        pub const Result = struct {
            request_id: u32,
            frame_id: u64,
            timestamp_ms: u64,
            /// The completed result owns the exact immutable inference input.
            /// Optional only so ownership can be moved out or released
            /// idempotently.
            frame: ?Frame,
            payload: Payload = undefined,
            ok: bool = false,
            elapsed_ms: u32 = 0,
            error_buf: [MAX_ERROR_BYTES]u8 = undefined,
            error_len: u16 = 0,

            pub fn success(frame: Frame, payload: Payload, elapsed_ms: u32) Result {
                return .{
                    .request_id = frame.identity.request_id,
                    .frame_id = frame.identity.frame_id,
                    .timestamp_ms = frame.identity.timestamp_ms,
                    .frame = frame,
                    .payload = payload,
                    .ok = true,
                    .elapsed_ms = elapsed_ms,
                };
            }

            pub fn failure(frame: Frame, message: []const u8, elapsed_ms: u32) Result {
                var out: Result = .{
                    .request_id = frame.identity.request_id,
                    .frame_id = frame.identity.frame_id,
                    .timestamp_ms = frame.identity.timestamp_ms,
                    .frame = frame,
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

            pub fn takeFrame(self: *Result) ?Frame {
                const owned = self.frame;
                self.frame = null;
                return owned;
            }

            pub fn deinit(self: *Result) void {
                if (self.frame) |*owned| owned.deinit();
                self.frame = null;
            }
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
            /// resource's one-element backing stores, so the resource must not
            /// move.
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
                if ((self.completed.getUncancelable(io, &completed, 0) catch 0) == 1) {
                    completed[0].deinit();
                }
                self.occupied.store(false, .release);
            }

            /// Copy one top-down RGBA frame into worker-owned memory. The
            /// queue stays bounded across pending, inference, and
            /// undrained-result phases.
            pub fn submitCopy(self: *Queue, io: std.Io, request_id: u32, rgba: []const u8, width: u32, height: u32) SubmitStatus {
                return self.submitIdentifiedCopy(io, .{
                    .request_id = request_id,
                    .frame_id = request_id,
                    .timestamp_ms = 0,
                }, rgba, width, height);
            }

            /// Capture-session ingress with an explicit immutable camera
            /// identity.
            pub fn submitIdentifiedCopy(
                self: *Queue,
                io: std.Io,
                identity: FrameIdentity,
                rgba: []const u8,
                width: u32,
                height: u32,
            ) SubmitStatus {
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
                    .identity = identity,
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

            /// Worker publishes at most one result and transfers ownership
            /// regardless of success. False means shutdown discarded and
            /// released it.
            pub fn publish(self: *Queue, io: std.Io, result: Result) bool {
                var owned = result;
                if (self.stopped.load(.acquire)) {
                    owned.deinit();
                    self.occupied.store(false, .release);
                    return false;
                }
                const queued = self.completed.putUncancelable(io, &.{owned}, 0) catch 0;
                if (queued == 1) return true;
                owned.deinit();
                self.occupied.store(false, .release);
                return false;
            }

            /// Engine-tick non-blocking result take. The caller owns and must
            /// deinit it.
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
    };
}
