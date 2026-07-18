//! Owns a child process stdout pipe while a frame-driven caller polls it.
//!
//! Zig 0.16 file reads are blocking, cancelable `std.Io` operations. The read
//! therefore runs in an `std.Io.Group` task and publishes bytes through a
//! bounded `std.Io.Queue`; `drain` never blocks the frame thread.

const std = @import("std");

const QUEUE_CAPACITY = 128 * 1024;
const READ_CAPACITY = 16 * 1024;

pub const ChildStdout = struct {
    state: *State,
    terminal_reported: bool = false,

    const Terminal = enum(u8) { running, eof, failed };

    const State = struct {
        allocator: std.mem.Allocator,
        io: std.Io,
        file: std.Io.File,
        tasks: std.Io.Group = .init,
        bytes: std.Io.Queue(u8),
        byte_storage: [QUEUE_CAPACITY]u8 = undefined,
        terminal: std.atomic.Value(Terminal) = .init(.running),
        discarding: std.atomic.Value(bool) = .init(false),
        read_error: ?std.Io.File.ReadStreamingError = null,

        fn readLoop(state: *State) std.Io.Cancelable!void {
            var buffer: [READ_CAPACITY]u8 = undefined;
            while (true) {
                const n = state.file.readStreaming(state.io, &.{&buffer}) catch |err| switch (err) {
                    error.EndOfStream => {
                        state.terminal.store(.eof, .release);
                        return;
                    },
                    error.Canceled => return error.Canceled,
                    else => {
                        state.read_error = err;
                        state.terminal.store(.failed, .release);
                        return;
                    },
                };
                if (n == 0) continue;
                if (state.discarding.load(.acquire)) continue;
                state.bytes.putAll(state.io, buffer[0..n]) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
            }
        }
    };

    pub const DrainResult = union(enum) {
        empty,
        data: usize,
        closed,
        failed: std.Io.File.ReadStreamingError,
    };

    /// Takes ownership of `file`, including when initialization fails.
    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        file: std.Io.File,
    ) !ChildStdout {
        errdefer file.close(io);
        const state = try allocator.create(State);
        errdefer allocator.destroy(state);
        state.* = .{
            .allocator = allocator,
            .io = io,
            .file = file,
            .bytes = .init(&state.byte_storage),
        };
        try state.tasks.concurrent(io, State.readLoop, .{state});
        return .{ .state = state };
    }

    /// Copies all bytes currently available without waiting for the reader.
    pub fn drain(stdout: *ChildStdout, out: []u8) DrainResult {
        if (out.len != 0) {
            const n = stdout.state.bytes.getUncancelable(stdout.state.io, out, 0) catch |err| switch (err) {
                error.Closed => 0,
            };
            if (n != 0) return .{ .data = n };
        }

        if (stdout.terminal_reported) return .empty;
        return switch (stdout.state.terminal.load(.acquire)) {
            .running => .empty,
            .eof => result: {
                stdout.terminal_reported = true;
                break :result .closed;
            },
            .failed => result: {
                stdout.terminal_reported = true;
                break :result .{ .failed = stdout.state.read_error orelse error.Unexpected };
            },
        };
    }

    /// Keeps the reader alive but drops all output from this point onward.
    /// This lets an owner wait for a child without filling the bounded queue
    /// when no frame thread remains to consume its final output.
    pub fn discard(stdout: *ChildStdout) void {
        const state = stdout.state;
        state.discarding.store(true, .release);

        // A producer may already be blocked in putAll after filling the queue.
        // Empty it once to release that put. At most its current read chunk can
        // race this loop; all later reads observe `discarding` and bypass it.
        var buffer: [READ_CAPACITY]u8 = undefined;
        while (true) {
            const n = state.bytes.getUncancelable(state.io, &buffer, 0) catch |err| switch (err) {
                error.Closed => return,
            };
            if (n == 0) return;
        }
    }

    /// Cancels and joins the reader task, closes the pipe, and releases state.
    pub fn deinit(stdout: *ChildStdout) void {
        const state = stdout.state;
        state.tasks.cancel(state.io);
        state.bytes.close(state.io);
        state.file.close(state.io);
        state.allocator.destroy(state);
        stdout.* = undefined;
    }
};

test "child stdout drains process output without blocking" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    var child = try std.process.spawn(io, .{
        .argv = &.{ "/bin/sh", "-c", "printf 'alpha\\nbeta\\n'" },
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    defer if (child.id != null) child.kill(io);

    const file = child.stdout orelse return error.MissingStdoutPipe;
    child.stdout = null;
    var stdout = try ChildStdout.init(allocator, io, file);
    defer stdout.deinit();

    var received: std.ArrayList(u8) = .empty;
    defer received.deinit(allocator);
    var buffer: [32]u8 = undefined;
    for (0..1_000) |_| {
        switch (stdout.drain(&buffer)) {
            .data => |n| try received.appendSlice(allocator, buffer[0..n]),
            .closed => break,
            .failed => |err| return err,
            .empty => try std.Io.sleep(io, .fromMilliseconds(1), .awake),
        }
    } else return error.StdoutDidNotClose;

    _ = try child.wait(io);
    try std.testing.expectEqualStrings("alpha\nbeta\n", received.items);
}

test "child stdout cancellation joins a blocked reader" {
    const io = std.testing.io;
    var child = try std.process.spawn(io, .{
        .argv = &.{ "/bin/sh", "-c", "exec sleep 30" },
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    defer if (child.id != null) child.kill(io);

    const file = child.stdout orelse return error.MissingStdoutPipe;
    child.stdout = null;
    var stdout = try ChildStdout.init(std.testing.allocator, io, file);
    stdout.deinit();
}

test "child stdout discard lets a child exceed the queue before wait" {
    const io = std.testing.io;
    var child = try std.process.spawn(io, .{
        .argv = &.{ "/usr/bin/head", "-c", "1048576", "/dev/zero" },
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    defer if (child.id != null) child.kill(io);

    const file = child.stdout orelse return error.MissingStdoutPipe;
    child.stdout = null;
    var stdout = try ChildStdout.init(std.testing.allocator, io, file);
    defer stdout.deinit();

    stdout.discard();
    _ = try child.wait(io);
}
