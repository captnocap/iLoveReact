//! Freeze tripwire for the req_3503 webcam-capture bug.
//!
//! Run with `zig build test-child-teardown`. Tearing down a capture child
//! must NEVER park the calling thread — not even for a child that ignores
//! SIGTERM while blocked writing into a pipe nobody drains, which is the
//! exact state a live ffmpeg v4l2 grab is in the moment its feed closes.
//! Under the old `std.process.Child.kill` teardown (one SIGTERM + an
//! uncancelable wait4 loop) that state parked the frame thread FOREVER and
//! froze the whole app until kill -9. These tests pin the bound.

const std = @import("std");
const child_teardown = @import("child_teardown");

/// Teardown is bounded by spawning kill(1), never by the child. Generous so
/// slow CI cannot flake it, tight enough that the old SIGTERM+wait4 hang
/// (infinite for a TERM-immune child) can never pass.
const PROMPT_BUDGET_MS: i64 = 2_000;

fn elapsedMs(io: std.Io, started: std.Io.Clock.Timestamp) i64 {
    return started.untilNow(io).raw.toMilliseconds();
}

test "teardown returns promptly for a SIGTERM-immune child blocked on a full pipe" {
    const io = std.testing.io;
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();

    // The live-ffmpeg freeze state, reproduced: TERM is ignored, stdout
    // floods a pipe WE never drain, so the child ends up blocked in write()
    // with the pipe full. One SIGTERM can never make this child exit.
    const argv = [_][]const u8{ "bash", "-c", "trap '' TERM; while :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done" };
    const child = try std.process.spawn(io, .{
        .argv = &argv,
        .stdout = .pipe,
        .stderr = .ignore,
        .stdin = .ignore,
        .environ_map = &environ,
    });

    // Give it a beat to fill the ~64KB pipe and block in write().
    try std.Io.sleep(io, .fromNanoseconds(300 * std.time.ns_per_ms), .awake);

    const started = std.Io.Clock.Timestamp.now(io, .awake);
    child_teardown.terminateDetached(io, &environ, child);
    const elapsed = elapsedMs(io, started);
    try std.testing.expect(elapsed < PROMPT_BUDGET_MS);

    // Let the detached reap collect the SIGKILLed child, then release.
    try std.Io.sleep(io, .fromNanoseconds(200 * std.time.ns_per_ms), .awake);
    child_teardown.shutdown(io);
}

test "teardown returns promptly for an exited-but-unreaped child" {
    const io = std.testing.io;
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();

    const argv = [_][]const u8{ "true" };
    const child = try std.process.spawn(io, .{
        .argv = &argv,
        .stdout = .ignore,
        .stderr = .ignore,
        .stdin = .ignore,
        .environ_map = &environ,
    });
    // Let it exit; it stays a zombie until the detached reap collects it.
    try std.Io.sleep(io, .fromNanoseconds(200 * std.time.ns_per_ms), .awake);

    const started = std.Io.Clock.Timestamp.now(io, .awake);
    child_teardown.terminateDetached(io, &environ, child);
    const elapsed = elapsedMs(io, started);
    try std.testing.expect(elapsed < PROMPT_BUDGET_MS);

    try std.Io.sleep(io, .fromNanoseconds(200 * std.time.ns_per_ms), .awake);
    child_teardown.shutdown(io);
}
