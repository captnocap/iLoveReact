//! ONNX-backed integration + contract checks for the BlazePose lane.
//!
//! Run with `zig build test-blazepose -Doptimize=ReleaseFast`. Lifecycle
//! tests pass with or without the vendored models (a surfaced init error is
//! a valid worker result); when the models ARE present, the blank-frame test
//! additionally proves the output-tensor shape resolution against the real
//! files. The image probe is the ground-truth door:
//!
//!   RJIT_BLAZEPOSE_IMAGE=/path/to/person.jpg zig build test-blazepose
//!
//! prints all 33 landmarks (screen + world metres + visibility) so a human
//! or agent can eyeball a real solve.

const std = @import("std");
const blazepose = @import("blazepose");

const CAMERA_WIDTH: u32 = 1280;
const CAMERA_HEIGHT: u32 = 720;
const RGBA_BYTES: usize = @as(usize, CAMERA_WIDTH) * @as(usize, CAMERA_HEIGHT) * 4;
const MAX_SUBMIT_US: i64 = 30_000;
const RESULT_TIMEOUT_NS: i128 = 20 * std.time.ns_per_s;

fn awakeNanos(io: std.Io) i128 {
    return @intCast(std.Io.Clock.now(.awake, io).toNanoseconds());
}

fn awakeMicros(io: std.Io) i64 {
    return std.Io.Clock.now(.awake, io).toMicroseconds();
}

fn waitForResult(io: std.Io) !blazepose.AsyncResult {
    const wait_started = awakeNanos(io);
    while (awakeNanos(io) - wait_started < RESULT_TIMEOUT_NS) {
        if (blazepose.pollAsync(io)) |result| return result;
        try std.Io.sleep(io, .fromNanoseconds(std.time.ns_per_ms), .awake);
    }
    return error.BlazeposeWorkerTimedOut;
}

test "anchor table matches the SSD calculator contract" {
    try std.testing.expectEqual(@as(usize, 2254), blazepose.ANCHORS.len);
    // Stride-8 group: 28×28 cells, 2 anchors per cell, row-major.
    try std.testing.expectApproxEqAbs(@as(f32, 0.5 / 28.0), blazepose.ANCHORS[0][0], 1e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.5 / 28.0), blazepose.ANCHORS[0][1], 1e-6);
    try std.testing.expectEqual(blazepose.ANCHORS[0], blazepose.ANCHORS[1]);
    try std.testing.expectApproxEqAbs(@as(f32, 1.5 / 28.0), blazepose.ANCHORS[2][0], 1e-6);
    // Stride-16 group starts after 28×28×2 = 1568.
    try std.testing.expectApproxEqAbs(@as(f32, 0.5 / 14.0), blazepose.ANCHORS[1568][0], 1e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.5 / 14.0), blazepose.ANCHORS[1568][1], 1e-6);
    // Merged stride-32 group starts after +14×14×2 = 1960 and repeats each
    // cell 6× (three same-stride layers × 2 aspects).
    for (0..6) |offset| {
        try std.testing.expectApproxEqAbs(@as(f32, 0.5 / 7.0), blazepose.ANCHORS[1960 + offset][0], 1e-6);
        try std.testing.expectApproxEqAbs(@as(f32, 0.5 / 7.0), blazepose.ANCHORS[1960 + offset][1], 1e-6);
    }
}

test "roi rule: upright subject solves to zero rotation" {
    // Scale point straight above the centre (y-down coords) hits the 90°
    // target angle exactly: cos 1, sin 0, side = 2·radius·1.25.
    const roi = blazepose.roiFromPoints(100, 100, 100, 50) orelse return error.RoiRejected;
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), roi.cos_t, 1e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.0), roi.sin_t, 1e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 125.0), roi.side, 1e-4);
}

test "roi rule: subject lying to the right solves to a quarter turn" {
    const roi = blazepose.roiFromPoints(100, 100, 150, 100) orelse return error.RoiRejected;
    try std.testing.expectApproxEqAbs(@as(f32, 0.0), roi.cos_t, 1e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), roi.sin_t, 1e-6);
}

test "roi rule: degenerate and non-finite inputs are rejected" {
    try std.testing.expectEqual(@as(?blazepose.Roi, null), blazepose.roiFromPoints(10, 10, 10, 10));
    try std.testing.expectEqual(@as(?blazepose.Roi, null), blazepose.roiFromPoints(std.math.nan(f32), 10, 20, 20));
}

test "one euro filter kills jitter without lagging real motion" {
    const dt: f32 = 1.0 / 30.0;
    const config = blazepose.OneEuroConfig{ .min_cutoff = 0.05, .beta = 80.0, .derivate_cutoff = 1.0 };

    // Constant input passes through exactly.
    var constant = blazepose.OneEuro{};
    for (0..10) |_| try std.testing.expectApproxEqAbs(@as(f32, 0.5), constant.filter(0.5, dt, config), 1e-6);

    // A still subject with ±2px-equivalent sensor noise: filtered excursion
    // must collapse well below the raw noise amplitude.
    var noisy = blazepose.OneEuro{};
    _ = noisy.filter(0.5, dt, config);
    var worst: f32 = 0;
    for (0..120) |step| {
        const noise: f32 = if (step % 2 == 0) 0.004 else -0.004;
        const out = noisy.filter(0.5 + noise, dt, config);
        if (step > 10) worst = @max(worst, @abs(out - 0.5));
    }
    try std.testing.expect(worst < 0.001);

    // A fast sweep must track: the speed-adaptive cutoff keeps lag small
    // relative to the traveled distance.
    var moving = blazepose.OneEuro{};
    var target: f32 = 0;
    var out: f32 = 0;
    for (0..30) |_| {
        target += 0.05;
        out = moving.filter(target, dt, config);
    }
    try std.testing.expect(@abs(out - target) < 0.01);
}

test "live blazepose request runs outside the submitting thread" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    blazepose.init(std.testing.io, &environ, std.testing.allocator);
    defer blazepose.deinit(std.testing.io);

    const rgba = try std.testing.allocator.alloc(u8, RGBA_BYTES);
    defer std.testing.allocator.free(rgba);
    @memset(rgba, 0);

    const submit_started = awakeMicros(std.testing.io);
    try std.testing.expectEqual(blazepose.SubmitStatus.queued, blazepose.enqueueRgba(std.testing.io, 4387, rgba, CAMERA_WIDTH, CAMERA_HEIGHT));
    const submit_us = awakeMicros(std.testing.io) - submit_started;
    try std.testing.expect(submit_us < MAX_SUBMIT_US);

    var result = try waitForResult(std.testing.io);
    defer result.deinit();
    try std.testing.expectEqual(@as(u32, 4387), result.request_id);
    if (result.ok) {
        // Models present: shape resolution succeeded against the real files,
        // and a blank frame must contain nobody.
        try std.testing.expect(result.payload.presence < blazepose.PRESENCE_MIN);
    } else {
        try std.testing.expect(result.errorText().len > 0);
    }
}

test "optional image estimate probe" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    const image_path = environ.get("RJIT_BLAZEPOSE_IMAGE") orelse return error.SkipZigTest;

    blazepose.init(std.testing.io, &environ, std.testing.allocator);
    defer blazepose.deinit(std.testing.io);

    const path_z = try std.testing.allocator.dupeZ(u8, image_path);
    defer std.testing.allocator.free(path_z);
    const frame = blazepose.estimateImage(std.testing.io, &environ, path_z.ptr) orelse {
        std.debug.print("[blazepose-image-probe] inference failed: {s}\n", .{blazepose.initError() orelse "unknown"});
        return error.BlazeposeImageEstimateFailed;
    };
    std.debug.print("[blazepose-image-probe] presence={d:.3} tracked={}\n", .{ frame.presence, frame.tracked });
    var visible: usize = 0;
    for (frame.landmarks, 0..) |landmark, index| {
        if (landmark.visibility >= 0.5) visible += 1;
        std.debug.print(
            "[blazepose-image-probe] {s: <18} x={d:.4} y={d:.4} vis={d:.3} world=({d: >7.4}, {d: >7.4}, {d: >7.4})m\n",
            .{
                @tagName(@as(blazepose.LandmarkName, @enumFromInt(index))),
                landmark.x,
                landmark.y,
                landmark.visibility,
                landmark.world[0],
                landmark.world[1],
                landmark.world[2],
            },
        );
    }
    std.debug.print("[blazepose-image-probe] {d}/33 landmarks visible >= 0.5\n", .{visible});
    try std.testing.expect(frame.presence >= blazepose.PRESENCE_MIN);
}
