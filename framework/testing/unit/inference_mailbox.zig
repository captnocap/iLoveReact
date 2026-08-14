//! Bounded inference-mailbox proofs against the generic lane (the BlazePose
//! worker's seam; formerly pose_mailbox coverage, ported when the MoveNet
//! lane died — req_4390).
//!
//! Direct run: tools/zig/zig test --dep inference_mailbox
//!   -Mroot=framework/testing/unit/inference_mailbox.zig
//!   -Minference_mailbox=framework/ml/inference_mailbox.zig

const std = @import("std");
const mailbox = @import("inference_mailbox");

const Lane = mailbox.Lane(u32);

fn makeFrame(queue: *Lane.Queue) !mailbox.Frame {
    return queue.tryTake(std.testing.io) orelse error.ExpectedOwnedFrame;
}

test "submitted camera pixels are owned by the worker" {
    var queue: Lane.Queue = undefined;
    queue.init(std.testing.allocator);
    defer {
        queue.stop(std.testing.io);
        queue.deinit(std.testing.io);
    }

    var source = [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 };
    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 41, &source, 1, 2));
    source[0] = 99;

    var owned = try makeFrame(&queue);
    defer owned.deinit();
    try std.testing.expectEqual(@as(u8, 1), owned.rgba[0]);
    try std.testing.expectEqual(@as(u32, 41), owned.identity.request_id);
    // submitCopy's identity: frame id mirrors the request id, timestamp 0.
    try std.testing.expectEqual(@as(u64, 41), owned.identity.frame_id);
}

test "identified submissions retain the exact camera identity" {
    var queue: Lane.Queue = undefined;
    queue.init(std.testing.allocator);
    defer {
        queue.stop(std.testing.io);
        queue.deinit(std.testing.io);
    }
    const source = [_]u8{ 9, 9, 9, 9 };
    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitIdentifiedCopy(std.testing.io, .{
        .request_id = 7,
        .frame_id = 4285,
        .timestamp_ms = 1_234,
    }, &source, 1, 1));
    var owned = try makeFrame(&queue);
    defer owned.deinit();
    try std.testing.expectEqual(@as(u64, 4285), owned.identity.frame_id);
    try std.testing.expectEqual(@as(u64, 1_234), owned.identity.timestamp_ms);
}

test "one pending working or undrained result applies backpressure" {
    var queue: Lane.Queue = undefined;
    queue.init(std.testing.allocator);
    defer {
        queue.stop(std.testing.io);
        queue.deinit(std.testing.io);
    }
    const source = [_]u8{ 1, 2, 3, 4 };

    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 1, &source, 1, 1));
    try std.testing.expectEqual(mailbox.SubmitStatus.busy, queue.submitCopy(std.testing.io, 2, &source, 1, 1));

    const owned = try makeFrame(&queue);
    try std.testing.expectEqual(mailbox.SubmitStatus.busy, queue.submitCopy(std.testing.io, 2, &source, 1, 1));

    try std.testing.expect(queue.publish(std.testing.io, Lane.Result.success(owned, 4387, 63)));
    try std.testing.expectEqual(mailbox.SubmitStatus.busy, queue.submitCopy(std.testing.io, 2, &source, 1, 1));

    var result = queue.poll(std.testing.io) orelse return error.ExpectedResult;
    defer result.deinit();
    try std.testing.expect(result.ok);
    try std.testing.expectEqual(@as(u32, 4387), result.payload);
    try std.testing.expectEqual(@as(u32, 63), result.elapsed_ms);
    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 2, &source, 1, 1));
}

test "failure text is bounded and shutdown rejects new frames" {
    var queue: Lane.Queue = undefined;
    queue.init(std.testing.allocator);
    defer queue.deinit(std.testing.io);

    const source = [_]u8{ 1, 2, 3, 4 };
    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 7, &source, 1, 1));
    const owned = try makeFrame(&queue);
    const long_message = [_]u8{'x'} ** (mailbox.MAX_ERROR_BYTES + 20);
    var result = Lane.Result.failure(owned, &long_message, 5);
    defer result.deinit();
    try std.testing.expect(!result.ok);
    try std.testing.expectEqual(mailbox.MAX_ERROR_BYTES, result.errorText().len);

    queue.stop(std.testing.io);
    try std.testing.expectEqual(mailbox.SubmitStatus.stopped, queue.submitCopy(std.testing.io, 1, &source, 1, 1));
    try std.testing.expect(queue.tryTake(std.testing.io) == null);
    try std.testing.expect(queue.poll(std.testing.io) == null);
}
