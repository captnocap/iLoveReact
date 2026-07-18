//! Frame-friendly shell execution on Zig 0.16's native process and Io APIs.
//!
//! `Executor` is initialized by the application binding with its `std.Io`
//! capability. Each command runs in the executor's `std.Io.Group`; the worker
//! drains the child's stdout pipe before waiting, then publishes an owned,
//! bounded result for the frame thread. No detached OS threads or stdio FILE
//! shims are involved.

const std = @import("std");

const MAX_IN_FLIGHT = 32;
const MAX_COMPLETED = 64;
const MAX_REQUEST_ID_BYTES = 1024;
const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 16 * 1024;

const Completed = struct {
    rid: []u8,
    stdout: []u8,
    exit_code: i32,
};

pub const Executor = struct {
    io: std.Io = undefined,
    allocator: std.mem.Allocator = undefined,
    tasks: std.Io.Group = .init,
    mutex: std.Io.Mutex = .init,
    completed: [MAX_COMPLETED]Completed = undefined,
    completed_len: usize = 0,
    in_flight: usize = 0,
    initialized: bool = false,

    pub fn init(self: *Executor, io: std.Io, allocator: std.mem.Allocator) void {
        if (self.initialized) return;
        self.io = io;
        self.allocator = allocator;
        self.tasks = .init;
        self.mutex = .init;
        self.completed_len = 0;
        self.in_flight = 0;
        self.initialized = true;
    }

    /// Starts a command without blocking the frame thread. False means the
    /// bounded executor rejected the request or could not copy its inputs.
    pub fn spawn(self: *Executor, rid: []const u8, cmd: []const u8) bool {
        if (!self.initialized or rid.len > MAX_REQUEST_ID_BYTES or cmd.len > MAX_COMMAND_BYTES) return false;

        const rid_copy = self.allocator.dupe(u8, rid) catch return false;
        const cmd_copy = self.allocator.dupe(u8, cmd) catch {
            self.allocator.free(rid_copy);
            return false;
        };

        self.mutex.lockUncancelable(self.io);
        if (self.in_flight >= MAX_IN_FLIGHT) {
            self.mutex.unlock(self.io);
            self.allocator.free(rid_copy);
            self.allocator.free(cmd_copy);
            return false;
        }
        self.in_flight += 1;
        self.mutex.unlock(self.io);

        self.tasks.concurrent(self.io, worker, .{ self, rid_copy, cmd_copy }) catch {
            self.mutex.lockUncancelable(self.io);
            self.in_flight -= 1;
            self.mutex.unlock(self.io);
            self.allocator.free(rid_copy);
            self.allocator.free(cmd_copy);
            return false;
        };
        return true;
    }

    fn worker(self: *Executor, rid: []u8, cmd: []u8) std.Io.Cancelable!void {
        defer self.allocator.free(cmd);

        var stdout: std.ArrayList(u8) = .empty;
        defer stdout.deinit(self.allocator);
        var exit_code: i32 = -1;

        var child = std.process.spawn(self.io, .{
            .argv = &.{ "/bin/sh", "-c", cmd },
            .stdin = .ignore,
            .stdout = .pipe,
            .stderr = .inherit,
        }) catch {
            self.complete(rid, &stdout, exit_code);
            return;
        };
        var reaped = false;
        defer if (!reaped) child.kill(self.io);

        if (child.stdout) |file| {
            child.stdout = null;
            defer file.close(self.io);
            var read_buf: [READ_CHUNK_BYTES]u8 = undefined;
            read_loop: while (true) {
                const n = file.readStreaming(self.io, &.{&read_buf}) catch |err| switch (err) {
                    error.EndOfStream => break :read_loop,
                    error.Canceled => {
                        self.complete(rid, &stdout, exit_code);
                        return error.Canceled;
                    },
                    else => break :read_loop,
                };
                if (n == 0) continue;
                const remaining = MAX_STDOUT_BYTES - stdout.items.len;
                if (remaining != 0) {
                    stdout.appendSlice(self.allocator, read_buf[0..@min(n, remaining)]) catch {};
                }
            }
        }

        const term = child.wait(self.io) catch |err| {
            self.complete(rid, &stdout, exit_code);
            if (err == error.Canceled) return error.Canceled;
            return;
        };
        reaped = true;
        exit_code = switch (term) {
            .exited => |code| code,
            .signal => |signal| -@as(i32, @intCast(@intFromEnum(signal))),
            .stopped => |signal| -@as(i32, @intCast(@intFromEnum(signal))),
            .unknown => -1,
        };
        self.complete(rid, &stdout, exit_code);
    }

    fn complete(self: *Executor, rid: []u8, stdout: *std.ArrayList(u8), exit_code: i32) void {
        const stdout_owned = stdout.toOwnedSlice(self.allocator) catch {
            self.finishDropped(rid);
            return;
        };

        self.mutex.lockUncancelable(self.io);
        self.in_flight -= 1;
        if (self.completed_len == MAX_COMPLETED) {
            self.mutex.unlock(self.io);
            self.allocator.free(rid);
            self.allocator.free(stdout_owned);
            return;
        }
        self.completed[self.completed_len] = .{
            .rid = rid,
            .stdout = stdout_owned,
            .exit_code = exit_code,
        };
        self.completed_len += 1;
        self.mutex.unlock(self.io);
    }

    fn finishDropped(self: *Executor, rid: []u8) void {
        self.mutex.lockUncancelable(self.io);
        self.in_flight -= 1;
        self.mutex.unlock(self.io);
        self.allocator.free(rid);
    }

    /// Moves every currently-completed result out from under the mutex before
    /// invoking callbacks. Work completed during callbacks waits for the next
    /// frame, keeping callback re-entry away from executor synchronization.
    pub fn drain(self: *Executor, context: anytype, comptime on_complete: anytype) void {
        var ready: [MAX_COMPLETED]Completed = undefined;
        self.mutex.lockUncancelable(self.io);
        const ready_len = self.completed_len;
        @memcpy(ready[0..ready_len], self.completed[0..ready_len]);
        self.completed_len = 0;
        self.mutex.unlock(self.io);

        for (ready[0..ready_len]) |item| {
            on_complete(context, item.rid, item.stdout, item.exit_code);
            self.allocator.free(item.rid);
            self.allocator.free(item.stdout);
        }
    }

    pub fn deinit(self: *Executor) void {
        if (!self.initialized) return;
        self.tasks.cancel(self.io);

        self.mutex.lockUncancelable(self.io);
        for (self.completed[0..self.completed_len]) |item| {
            self.allocator.free(item.rid);
            self.allocator.free(item.stdout);
        }
        self.completed_len = 0;
        self.in_flight = 0;
        self.initialized = false;
        self.mutex.unlock(self.io);
    }
};

test "native executor drains stdout and exit status" {
    const testing = std.testing;
    var executor: Executor = .{};
    executor.init(testing.io, testing.allocator);
    defer executor.deinit();

    const Capture = struct {
        received: bool = false,
        code: i32 = -1,
        stdout: [32]u8 = undefined,
        stdout_len: usize = 0,

        fn receive(self: *@This(), rid: []const u8, bytes: []const u8, code: i32) void {
            testing.expectEqualStrings("request-1", rid) catch unreachable;
            self.received = true;
            self.code = code;
            self.stdout_len = @min(bytes.len, self.stdout.len);
            @memcpy(self.stdout[0..self.stdout_len], bytes[0..self.stdout_len]);
        }
    };

    var capture: Capture = .{};
    try testing.expect(executor.spawn("request-1", "printf native-io; exit 7"));
    const deadline = std.Io.Clock.now(.awake, testing.io).addDuration(.fromSeconds(5));
    while (!capture.received and std.Io.Clock.now(.awake, testing.io).toNanoseconds() < deadline.toNanoseconds()) {
        executor.drain(&capture, Capture.receive);
        if (!capture.received) try std.Io.sleep(testing.io, .fromMilliseconds(1), .awake);
    }

    try testing.expect(capture.received);
    try testing.expectEqual(@as(i32, 7), capture.code);
    try testing.expectEqualStrings("native-io", capture.stdout[0..capture.stdout_len]);
}

test "native executor rejects oversized inputs" {
    const testing = std.testing;
    var executor: Executor = .{};
    executor.init(testing.io, testing.allocator);
    defer executor.deinit();

    var oversized: [MAX_REQUEST_ID_BYTES + 1]u8 = undefined;
    @memset(&oversized, 'x');
    try testing.expect(!executor.spawn(&oversized, "true"));
}
