const std = @import("std");
const motion = @import("motion_document");
const fk = motion.fk;

fn quatX(degrees: f32) motion.Quat {
    return fk.axisAngle(.{ 1, 0, 0 }, degrees * std.math.pi / 180.0) catch unreachable;
}

fn angleOf(rotation: motion.Quat) f32 {
    const w = std.math.clamp(rotation[3], -1, 1);
    return 2 * std.math.acos(@abs(w)) * 180.0 / std.math.pi;
}

const IDENTITY = fk.IDENTITY_QUAT;

fn twoChannelDocument(allocator: std.mem.Allocator, keys: []const motion.Key, runs: []const motion.Run, looping: bool) motion.Document {
    return .{
        .allocator = allocator,
        .name = "test-doc",
        .looping = looping,
        .duration_seconds = 1.0,
        .source = .hand,
        .channel_ids = &.{ "upper_arm_left", "head" },
        .keys = keys,
        .runs = runs,
    };
}

test "round-trip preserves keys, runs, planted annotations, and source" {
    const allocator = std.testing.allocator;
    const keys = [_]motion.Key{
        .{
            .time_seconds = 0,
            .coverage = 0b11,
            .planted = 0b01,
            .easing = .smooth,
            .root_translation = .{ 0, 0.1, 0 },
            .deltas = &.{ IDENTITY, quatX(10) },
        },
        .{ .time_seconds = 0.4, .coverage = 0b01, .deltas = &.{quatX(45)} },
    };
    const run_times = [_]f32{ 0, 0.05, 0.1 };
    const run_roots = [_]motion.Vec3{ .{ 0, 0, 0 }, .{ 0, 0.02, 0 }, .{ 0, 0.04, 0 } };
    const run_deltas = [_]motion.Quat{ quatX(50), quatX(60), quatX(70) };
    const runs = [_]motion.Run{.{
        .start_seconds = 0.6,
        .coverage = 0b01,
        .times = &run_times,
        .root_translations = &run_roots,
        .deltas = &run_deltas,
    }};
    var original = twoChannelDocument(allocator, &keys, &runs, false);
    original.source = .capture;

    const bytes = try motion.encodeAlloc(allocator, &original);
    defer allocator.free(bytes);
    var decoded = try motion.decodeAlloc(allocator, bytes);
    defer decoded.deinit();

    try std.testing.expectEqualStrings("test-doc", decoded.name);
    try std.testing.expectEqual(motion.SourceKind.capture, decoded.source);
    try std.testing.expectEqual(@as(usize, 2), decoded.channel_ids.len);
    try std.testing.expectEqualStrings("upper_arm_left", decoded.channel_ids[0]);
    try std.testing.expectEqual(@as(usize, 2), decoded.keys.len);
    try std.testing.expectEqual(@as(u32, 0b01), decoded.keys[0].planted);
    try std.testing.expectEqual(motion.Easing.smooth, decoded.keys[0].easing);
    try std.testing.expectEqual(@as(f32, 0.1), decoded.keys[0].root_translation.?[1]);
    try std.testing.expectEqual(@as(usize, 1), decoded.runs.len);
    try std.testing.expectEqual(@as(usize, 3), decoded.runs[0].frameCount());
    try std.testing.expectEqual(@as(f32, 0.04), decoded.runs[0].root_translations.?[2][1]);
    try std.testing.expectApproxEqAbs(quatX(70)[0], decoded.runs[0].deltas[2][0], 1.0e-7);
}

test "two keys fill in by shortest-arc slerp at the declared times" {
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b01, .deltas = &.{IDENTITY} },
        .{ .time_seconds = 1.0, .coverage = 0b01, .deltas = &.{quatX(90)} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &.{}, false);
    try motion.validate(&doc);

    const halfway = try motion.sample(&doc, 0.5);
    try std.testing.expectEqual(@as(u32, 0b01), halfway.coverage);
    try std.testing.expectApproxEqAbs(@as(f32, 45), angleOf(halfway.deltas[0]), 0.01);
    try std.testing.expect(!halfway.has_root);

    // Non-looping clamps: hold-first and hold-last.
    const before = try motion.sample(&doc, -5);
    try std.testing.expectApproxEqAbs(@as(f32, 0), angleOf(before.deltas[0]), 0.01);
    const after = try motion.sample(&doc, 5);
    try std.testing.expectApproxEqAbs(@as(f32, 90), angleOf(after.deltas[0]), 0.01);
}

test "partial keys are first-class: an untouched channel holds its own timeline" {
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b01, .deltas = &.{IDENTITY} },
        .{ .time_seconds = 0.5, .coverage = 0b10, .deltas = &.{quatX(20)} },
        .{ .time_seconds = 1.0, .coverage = 0b01, .deltas = &.{quatX(90)} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &.{}, false);
    try motion.validate(&doc);

    const at = try motion.sample(&doc, 0.75);
    try std.testing.expectEqual(@as(u32, 0b11), at.coverage);
    // Channel 0 interpolates its own keys; channel 1 holds its single key.
    try std.testing.expectApproxEqAbs(@as(f32, 67.5), angleOf(at.deltas[0]), 0.01);
    try std.testing.expectApproxEqAbs(@as(f32, 20), angleOf(at.deltas[1]), 0.01);
}

test "a channel with no events is absent from every sample" {
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b01, .deltas = &.{quatX(30)} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &.{}, false);
    try motion.validate(&doc);
    const at = try motion.sample(&doc, 0.5);
    try std.testing.expectEqual(@as(u32, 0b01), at.coverage);
}

test "a dictated run owns its interior and blends at its edges" {
    const run_times = [_]f32{ 0, 0.1, 0.2 };
    const run_deltas = [_]motion.Quat{ quatX(40), quatX(60), quatX(80) };
    const runs = [_]motion.Run{.{
        .start_seconds = 0.5,
        .coverage = 0b01,
        .times = &run_times,
        .deltas = &run_deltas,
    }};
    const keys = [_]motion.Key{
        .{ .time_seconds = 0.1, .coverage = 0b01, .deltas = &.{IDENTITY} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &runs, false);
    try motion.validate(&doc);

    // Inside the run: dictated frames interpolate (0.55 is halfway 40..60).
    const inside = try motion.sample(&doc, 0.55);
    try std.testing.expectApproxEqAbs(@as(f32, 50), angleOf(inside.deltas[0]), 0.01);

    // Between the key and the run start, the run's first frame is the next
    // event: halfway from identity(0.1s) toward 40 degrees (0.5s).
    const approach = try motion.sample(&doc, 0.3);
    try std.testing.expectApproxEqAbs(@as(f32, 20), angleOf(approach.deltas[0]), 0.01);
}

test "looping documents interpolate through the seam" {
    const keys = [_]motion.Key{
        .{ .time_seconds = 0.25, .coverage = 0b01, .deltas = &.{quatX(0)} },
        .{ .time_seconds = 0.75, .coverage = 0b01, .deltas = &.{quatX(40)} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &.{}, true);
    try motion.validate(&doc);

    // 1.0 wraps to 0.0: halfway between the 0.75 key (40) and the 0.25 key
    // (0) re-approached at 1.25.
    const seam = try motion.sample(&doc, 1.0);
    try std.testing.expectApproxEqAbs(@as(f32, 20), angleOf(seam.deltas[0]), 0.01);
}

test "hold easing dictates a step transition" {
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b01, .easing = .hold, .deltas = &.{quatX(10)} },
        .{ .time_seconds = 1.0, .coverage = 0b01, .deltas = &.{quatX(90)} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &.{}, false);
    const late = try motion.sample(&doc, 0.99);
    try std.testing.expectApproxEqAbs(@as(f32, 10), angleOf(late.deltas[0]), 0.01);
}

test "root translation interpolates independently of rotation coverage" {
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b01, .root_translation = .{ 0, 0, 0 }, .deltas = &.{IDENTITY} },
        .{ .time_seconds = 0.5, .coverage = 0b10, .deltas = &.{quatX(5)} },
        .{ .time_seconds = 1.0, .coverage = 0b01, .root_translation = .{ 0, 0.2, 0 }, .deltas = &.{IDENTITY} },
    };
    const doc = twoChannelDocument(std.testing.allocator, &keys, &.{}, false);
    try motion.validate(&doc);
    const at = try motion.sample(&doc, 0.5);
    // The rotation-only key at 0.5 does not interrupt the root timeline.
    try std.testing.expect(at.has_root);
    try std.testing.expectApproxEqAbs(@as(f32, 0.1), at.root_translation[1], 1.0e-6);
}

test "structural violations are rejected" {
    const allocator = std.testing.allocator;

    // A key strictly inside a run that speaks the same channel.
    {
        const run_times = [_]f32{ 0, 0.2 };
        const run_deltas = [_]motion.Quat{ IDENTITY, quatX(10) };
        const runs = [_]motion.Run{.{ .start_seconds = 0.4, .coverage = 0b01, .times = &run_times, .deltas = &run_deltas }};
        const keys = [_]motion.Key{.{ .time_seconds = 0.5, .coverage = 0b01, .deltas = &.{quatX(5)} }};
        const doc = twoChannelDocument(allocator, &keys, &runs, false);
        try std.testing.expectError(error.KeyInsideRun, motion.validate(&doc));
    }
    // Two keys claiming the same channel at the same instant.
    {
        const keys = [_]motion.Key{
            .{ .time_seconds = 0.5, .coverage = 0b01, .deltas = &.{quatX(5)} },
            .{ .time_seconds = 0.5, .coverage = 0b01, .deltas = &.{quatX(6)} },
        };
        const doc = twoChannelDocument(allocator, &keys, &.{}, false);
        try std.testing.expectError(error.DuplicateChannelKey, motion.validate(&doc));
    }
    // Overlapping runs on a shared channel.
    {
        const times_a = [_]f32{ 0, 0.3 };
        const times_b = [_]f32{ 0, 0.3 };
        const deltas_a = [_]motion.Quat{ IDENTITY, quatX(10) };
        const deltas_b = [_]motion.Quat{ IDENTITY, quatX(10) };
        const runs = [_]motion.Run{
            .{ .start_seconds = 0.1, .coverage = 0b01, .times = &times_a, .deltas = &deltas_a },
            .{ .start_seconds = 0.2, .coverage = 0b01, .times = &times_b, .deltas = &deltas_b },
        };
        const doc = twoChannelDocument(allocator, &.{}, &runs, false);
        try std.testing.expectError(error.OverlappingRuns, motion.validate(&doc));
    }
    // Planted annotation outside the key's own coverage.
    {
        const keys = [_]motion.Key{.{ .time_seconds = 0, .coverage = 0b01, .planted = 0b10, .deltas = &.{IDENTITY} }};
        const doc = twoChannelDocument(allocator, &keys, &.{}, false);
        try std.testing.expectError(error.InvalidCoverage, motion.validate(&doc));
    }
}

test "decode rejects truncated and trailing bytes" {
    const allocator = std.testing.allocator;
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b01, .deltas = &.{IDENTITY} },
        .{ .time_seconds = 1.0, .coverage = 0b01, .deltas = &.{quatX(90)} },
    };
    const doc = twoChannelDocument(allocator, &keys, &.{}, false);
    const bytes = try motion.encodeAlloc(allocator, &doc);
    defer allocator.free(bytes);

    try std.testing.expectError(error.Truncated, motion.decodeAlloc(allocator, bytes[0 .. bytes.len - 1]));

    const padded = try allocator.alloc(u8, bytes.len + 1);
    defer allocator.free(padded);
    @memcpy(padded[0..bytes.len], bytes);
    padded[bytes.len] = 0;
    try std.testing.expectError(error.TrailingBytes, motion.decodeAlloc(allocator, padded));

    var corrupted = try allocator.dupe(u8, bytes);
    defer allocator.free(corrupted);
    corrupted[0] = 'X';
    try std.testing.expectError(error.BadMagic, motion.decodeAlloc(allocator, corrupted));
}
