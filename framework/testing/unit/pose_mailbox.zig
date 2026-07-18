const std = @import("std");
const mailbox = @import("pose_mailbox");

fn blankKeypoints() [mailbox.KEYPOINTS]mailbox.Keypoint {
    return [_]mailbox.Keypoint{.{ .x = 0, .y = 0, .score = 0 }} ** mailbox.KEYPOINTS;
}

test "submitted camera pixels are owned by the worker" {
    var queue: mailbox.Queue = undefined;
    queue.init(std.testing.allocator);
    defer {
        queue.stop(std.testing.io);
        queue.deinit(std.testing.io);
    }

    var source = [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 };
    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 41, &source, 1, 2));
    source[0] = 99;

    var owned = queue.tryTake(std.testing.io) orelse return error.ExpectedOwnedFrame;
    defer owned.deinit();
    try std.testing.expectEqual(@as(u8, 1), owned.rgba[0]);
    try std.testing.expectEqual(@as(u32, 41), owned.request_id);
}

test "one pending working or undrained result applies backpressure" {
    var queue: mailbox.Queue = undefined;
    queue.init(std.testing.allocator);
    defer {
        queue.stop(std.testing.io);
        queue.deinit(std.testing.io);
    }
    const source = [_]u8{ 1, 2, 3, 4 };

    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 1, &source, 1, 1));
    try std.testing.expectEqual(mailbox.SubmitStatus.busy, queue.submitCopy(std.testing.io, 2, &source, 1, 1));

    var owned = queue.tryTake(std.testing.io) orelse return error.ExpectedWorkingFrame;
    owned.deinit();
    try std.testing.expectEqual(mailbox.SubmitStatus.busy, queue.submitCopy(std.testing.io, 2, &source, 1, 1));

    try std.testing.expect(queue.publish(std.testing.io, mailbox.Result.success(1, blankKeypoints(), 63)));
    try std.testing.expectEqual(mailbox.SubmitStatus.busy, queue.submitCopy(std.testing.io, 2, &source, 1, 1));

    const result = queue.poll(std.testing.io) orelse return error.ExpectedResult;
    try std.testing.expect(result.ok);
    try std.testing.expectEqual(@as(u32, 63), result.elapsed_ms);
    try std.testing.expectEqual(mailbox.SubmitStatus.queued, queue.submitCopy(std.testing.io, 2, &source, 1, 1));
}

test "failure text is bounded and shutdown rejects new frames" {
    const long_message = [_]u8{'x'} ** (mailbox.MAX_ERROR_BYTES + 20);
    const result = mailbox.Result.failure(7, &long_message, 5);
    try std.testing.expect(!result.ok);
    try std.testing.expectEqual(mailbox.MAX_ERROR_BYTES, result.errorText().len);

    var queue: mailbox.Queue = undefined;
    queue.init(std.testing.allocator);
    defer queue.deinit(std.testing.io);
    queue.stop(std.testing.io);
    const source = [_]u8{ 1, 2, 3, 4 };
    try std.testing.expectEqual(mailbox.SubmitStatus.stopped, queue.submitCopy(std.testing.io, 1, &source, 1, 1));
    try std.testing.expect(queue.tryTake(std.testing.io) == null);
    try std.testing.expect(queue.poll(std.testing.io) == null);
}
