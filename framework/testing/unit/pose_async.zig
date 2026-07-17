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

fn io() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

fn nanoTimestamp() i128 {
    return @intCast(std.Io.Clock.now(.real, io()).toNanoseconds());
}

fn microTimestamp() i64 {
    return std.Io.Clock.now(.real, io()).toMicroseconds();
}

fn getenv(name: [:0]const u8) ?[]const u8 {
    return if (std.c.getenv(name.ptr)) |value| std.mem.span(value) else null;
}

fn waitForResult() !pose.AsyncResult {
    const wait_started = nanoTimestamp();
    while (nanoTimestamp() - wait_started < RESULT_TIMEOUT_NS) {
        if (pose.pollAsync()) |result| return result;
        try std.Io.sleep(io(), .fromNanoseconds(std.time.ns_per_ms), .awake);
    }
    return error.PoseWorkerTimedOut;
}

test "live pose request runs outside the submitting thread" {
    pose.init(std.testing.allocator);
    defer pose.deinit();

    const rgba = try std.testing.allocator.alloc(u8, RGBA_BYTES);
    defer std.testing.allocator.free(rgba);
    @memset(rgba, 0);

    const submit_started = microTimestamp();
    try std.testing.expectEqual(pose.SubmitStatus.queued, pose.enqueueRgba(2845, rgba, CAMERA_WIDTH, CAMERA_HEIGHT));
    const submit_us = microTimestamp() - submit_started;
    try std.testing.expect(submit_us < MAX_SUBMIT_US);

    const result = try waitForResult();
    try std.testing.expectEqual(@as(u32, 2845), result.request_id);
    if (!result.ok) try std.testing.expect(result.errorText().len > 0);
}

test "optional sustained pose spikewatch" {
    const raw_seconds = getenv("RJIT_POSE_STRESS_SECONDS") orelse return error.SkipZigTest;
    const seconds = std.fmt.parseInt(u64, raw_seconds, 10) catch return error.SkipZigTest;
    if (seconds == 0) return error.SkipZigTest;

    pose.init(std.testing.allocator);
    defer pose.deinit();
    const rgba = try std.testing.allocator.alloc(u8, RGBA_BYTES);
    defer std.testing.allocator.free(rgba);
    @memset(rgba, 0);

    const gate_started = nanoTimestamp();
    const gate_duration_ns: i128 = @as(i128, seconds) * std.time.ns_per_s;
    var request_id: u32 = 1;
    var requests: u32 = 0;
    var submit_total_us: i64 = 0;
    var submit_max_us: i64 = 0;
    var frame_budget_spikes: u32 = 0;
    while (nanoTimestamp() - gate_started < gate_duration_ns) {
        const cycle_started = nanoTimestamp();
        const submit_started = microTimestamp();
        try std.testing.expectEqual(pose.SubmitStatus.queued, pose.enqueueRgba(request_id, rgba, CAMERA_WIDTH, CAMERA_HEIGHT));
        const submit_us = microTimestamp() - submit_started;
        submit_total_us += submit_us;
        submit_max_us = @max(submit_max_us, submit_us);
        if (submit_us >= FRAME_BUDGET_US) frame_budget_spikes += 1;

        const result = try waitForResult();
        try std.testing.expect(result.ok);
        try std.testing.expectEqual(request_id, result.request_id);
        requests += 1;
        request_id +%= 1;

        const cycle_ns = nanoTimestamp() - cycle_started;
        if (cycle_ns < @as(i128, REQUEST_INTERVAL_NS)) {
            try std.Io.sleep(io(), .fromNanoseconds(@intCast(@as(i128, REQUEST_INTERVAL_NS) - cycle_ns)), .awake);
        }
    }

    const average_submit_us = @divTrunc(submit_total_us, @as(i64, requests));
    std.debug.print(
        "[pose-spikewatch] complete seconds={d} requests={d} avgSubmit={d}us maxSubmit={d}us frameBudgetSpikes={d}\n",
        .{ seconds, requests, average_submit_us, submit_max_us, frame_budget_spikes },
    );
    try std.testing.expectEqual(@as(u32, 0), frame_budget_spikes);
}
