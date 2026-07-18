//! ONNX-backed integration check for the live pose worker.
//!
//! Run with `zig build test-pose-async -Doptimize=ReleaseFast`. The result may
//! be success (model installed) or a surfaced init error (model absent); this
//! test pins the lifecycle and, critically, that submit returns after an owned
//! frame copy instead of waiting for inference.

const std = @import("std");
const pose = @import("pose");

const CAMERA_WIDTH: u32 = 1280;
const CAMERA_HEIGHT: u32 = 720;
const RGBA_BYTES: usize = @as(usize, CAMERA_WIDTH) * @as(usize, CAMERA_HEIGHT) * 4;
const MAX_SUBMIT_US: i64 = 30_000;
const RESULT_TIMEOUT_NS: i128 = 10 * std.time.ns_per_s;
const REQUEST_INTERVAL_NS: u64 = 90 * std.time.ns_per_ms;
const FRAME_BUDGET_US: i64 = 16_000;

fn awakeNanos(io: std.Io) i128 {
    return @intCast(std.Io.Clock.now(.awake, io).toNanoseconds());
}

fn awakeMicros(io: std.Io) i64 {
    return std.Io.Clock.now(.awake, io).toMicroseconds();
}

fn waitForResult(io: std.Io) !pose.AsyncResult {
    const wait_started = awakeNanos(io);
    while (awakeNanos(io) - wait_started < RESULT_TIMEOUT_NS) {
        if (pose.pollAsync(io)) |result| return result;
        try std.Io.sleep(io, .fromNanoseconds(std.time.ns_per_ms), .awake);
    }
    return error.PoseWorkerTimedOut;
}

test "live pose request runs outside the submitting thread" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    pose.init(std.testing.io, &environ, std.testing.allocator);
    defer pose.deinit(std.testing.io);

    const rgba = try std.testing.allocator.alloc(u8, RGBA_BYTES);
    defer std.testing.allocator.free(rgba);
    @memset(rgba, 0);

    const submit_started = awakeMicros(std.testing.io);
    try std.testing.expectEqual(pose.SubmitStatus.queued, pose.enqueueRgba(std.testing.io, 2845, rgba, CAMERA_WIDTH, CAMERA_HEIGHT));
    const submit_us = awakeMicros(std.testing.io) - submit_started;
    try std.testing.expect(submit_us < MAX_SUBMIT_US);

    const result = try waitForResult(std.testing.io);
    try std.testing.expectEqual(@as(u32, 2845), result.request_id);
    if (!result.ok) try std.testing.expect(result.errorText().len > 0);
}

test "optional sustained pose spikewatch" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    const raw_seconds = environ.get("RJIT_POSE_STRESS_SECONDS") orelse return error.SkipZigTest;
    const seconds = std.fmt.parseInt(u64, raw_seconds, 10) catch return error.SkipZigTest;
    if (seconds == 0) return error.SkipZigTest;

    pose.init(std.testing.io, &environ, std.testing.allocator);
    defer pose.deinit(std.testing.io);
    const rgba = try std.testing.allocator.alloc(u8, RGBA_BYTES);
    defer std.testing.allocator.free(rgba);
    @memset(rgba, 0);

    const gate_started = awakeNanos(std.testing.io);
    const gate_duration_ns: i128 = @as(i128, seconds) * std.time.ns_per_s;
    var request_id: u32 = 1;
    var requests: u32 = 0;
    var submit_total_us: i64 = 0;
    var submit_max_us: i64 = 0;
    var frame_budget_spikes: u32 = 0;
    while (awakeNanos(std.testing.io) - gate_started < gate_duration_ns) {
        const cycle_started = awakeNanos(std.testing.io);
        const submit_started = awakeMicros(std.testing.io);
        try std.testing.expectEqual(pose.SubmitStatus.queued, pose.enqueueRgba(std.testing.io, request_id, rgba, CAMERA_WIDTH, CAMERA_HEIGHT));
        const submit_us = awakeMicros(std.testing.io) - submit_started;
        submit_total_us += submit_us;
        submit_max_us = @max(submit_max_us, submit_us);
        if (submit_us >= FRAME_BUDGET_US) frame_budget_spikes += 1;

        const result = try waitForResult(std.testing.io);
        try std.testing.expect(result.ok);
        try std.testing.expectEqual(request_id, result.request_id);
        requests += 1;
        request_id +%= 1;

        const cycle_ns = awakeNanos(std.testing.io) - cycle_started;
        if (cycle_ns < @as(i128, REQUEST_INTERVAL_NS)) {
            try std.Io.sleep(std.testing.io, .fromNanoseconds(@intCast(@as(i128, REQUEST_INTERVAL_NS) - cycle_ns)), .awake);
        }
    }

    const average_submit_us = @divTrunc(submit_total_us, @as(i64, requests));
    std.debug.print(
        "[pose-spikewatch] complete seconds={d} requests={d} avgSubmit={d}us maxSubmit={d}us frameBudgetSpikes={d}\n",
        .{ seconds, requests, average_submit_us, submit_max_us, frame_budget_spikes },
    );
    try std.testing.expectEqual(@as(u32, 0), frame_budget_spikes);
}
