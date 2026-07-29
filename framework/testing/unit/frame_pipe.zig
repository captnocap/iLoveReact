//! Regression test for camera raw-frame draining (req_3532).
//!
//! Run with `zig build test-frame-pipe`. The old frame-thread MultiReader
//! path advanced by one small pipe completion per render tick and could not
//! assemble a 1280x720 RGBA frame before the watchdog killed FFmpeg.

const std = @import("std");
const frame_pipe = @import("frame_pipe");

const FRAME_BYTES: usize = 1280 * 720 * 4;
const FRAME_DEADLINE_MS: i64 = 2_000;

test "multi-megabyte subprocess frame reaches the consumer before its deadline" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    var environ = try std.testing.environ.createMap(allocator);
    defer environ.deinit();

    const argv = [_][]const u8{ "head", "-c", "3686400", "/dev/zero" };
    var child = try std.process.spawn(io, .{
        .argv = &argv,
        .stdout = .pipe,
        .stderr = .ignore,
        .stdin = .ignore,
        .environ_map = &environ,
    });

    var pump = try frame_pipe.FramePump.init(io, allocator, child.stdout.?, FRAME_BYTES);
    var consumer_buf = try allocator.alloc(u8, FRAME_BYTES);
    var received = false;
    const started = std.Io.Clock.Timestamp.now(io, .awake);
    while (started.untilNow(io).raw.toMilliseconds() < FRAME_DEADLINE_MS) {
        if (pump.takeLatest(io, consumer_buf)) |fresh| {
            consumer_buf = fresh;
            received = true;
            break;
        }
        try std.Io.sleep(io, .fromNanoseconds(2 * std.time.ns_per_ms), .awake);
    }

    pump.deinit(io);
    defer allocator.free(consumer_buf);
    _ = try child.wait(io);

    try std.testing.expect(received);
    try std.testing.expectEqual(@as(u8, 0), consumer_buf[0]);
    try std.testing.expectEqual(@as(u8, 0), consumer_buf[consumer_buf.len - 1]);
}
