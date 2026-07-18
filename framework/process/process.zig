//! Tracked child processes built on Zig 0.16's `std.process` and `std.Io`.
//!
//! The application polls process state once per frame, while the native
//! `Child.wait(io)` operation is blocking. A waiter task therefore owns every
//! `std.process.Child` and publishes its terminal state atomically. Piped
//! stdout/stderr use the same pattern: cancelable file-reader tasks feed
//! bounded queues which the frame thread drains without blocking.
//!
//! This module adds application-specific ownership (PID registry and polling)
//! around the standard API; it does not recreate a removed Zig process API.

const std = @import("std");

pub const Signal = enum { term, kill_ };
pub const Term = std.process.Child.Term;
pub const Id = std.process.Child.Id;

const MAX_CHILDREN = 32;
const PIPE_QUEUE_CAPACITY = 128 * 1024;
const PIPE_READ_CAPACITY = 16 * 1024;

const WaitStatus = enum(u8) { running, exited, failed };

const ProcessState = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    child: std.process.Child,
    pid: Id,
    tasks: std.Io.Group = .init,
    completed: std.Io.Event = .unset,
    status: std.atomic.Value(WaitStatus) = .init(.running),
    term: Term = .{ .unknown = 0 },
    wait_error: ?std.process.Child.WaitError = null,
    detached: bool = false,

    fn waitLoop(state: *ProcessState) std.Io.Cancelable!void {
        const term = state.child.wait(state.io) catch |err| {
            state.wait_error = err;
            state.status.store(.failed, .release);
            state.completed.set(state.io);
            if (err == error.Canceled) return error.Canceled;
            return;
        };
        state.term = term;
        state.status.store(.exited, .release);
        state.completed.set(state.io);
    }
};

pub const Process = struct {
    pid: Id,
    state: ?*ProcessState,

    pub fn alive(self: *const Process) bool {
        const state = self.state orelse return false;
        return state.status.load(.acquire) == .running;
    }

    pub fn termination(self: *const Process) ?Term {
        const state = self.state orelse return null;
        return switch (state.status.load(.acquire)) {
            .running, .failed => null,
            .exited => state.term,
        };
    }

    pub fn exitCode(self: *const Process) c_int {
        const term = self.termination() orelse return -1;
        return switch (term) {
            .exited => |code| code,
            else => -1,
        };
    }

    /// Deliver a signal without waiting. Zig's native `Child.kill(io)` is a
    /// blocking terminate-and-reap operation, so it cannot implement a frame-
    /// friendly signal request while the waiter task owns `Child.wait(io)`.
    /// Signal selection is therefore the one genuine POSIX boundary here.
    pub fn sendSignal(self: *Process, signal: Signal) void {
        if (!self.alive()) return;
        const sig: std.posix.SIG = switch (signal) {
            .term => .TERM,
            .kill_ => .KILL,
        };
        std.posix.kill(self.pid, sig) catch {};
    }

    /// Transfer lifetime ownership to the module registry. Detached children
    /// are still waited and killed during shutdown, but callers no longer hold
    /// a handle that must be closed.
    pub fn detach(self: *Process) void {
        const state = self.state orelse return;
        state.detached = true;
        self.state = null;
    }

    /// Wait for natural termination and return the native Zig terminal value.
    pub fn wait(self: *Process, io: std.Io) std.process.Child.WaitError!Term {
        const state = self.state orelse return error.Unexpected;
        state.completed.waitUncancelable(io);
        state.tasks.await(io) catch |err| switch (err) {
            error.Canceled => {},
        };
        return switch (state.status.load(.acquire)) {
            .exited => state.term,
            .failed => state.wait_error orelse error.Unexpected,
            .running => unreachable,
        };
    }

    /// Graceful shutdown: SIGTERM, a 200ms grace period, then SIGKILL. The
    /// waiter task performs the actual native wait/reap operation.
    pub fn closeProcess(self: *Process, io: std.Io) void {
        const state = self.state orelse return;
        if (state.status.load(.acquire) == .running) {
            self.sendSignal(.term);
            state.completed.waitTimeout(io, .{ .duration = .{
                .raw = .fromMilliseconds(200),
                .clock = .awake,
            } }) catch |err| switch (err) {
                error.Timeout, error.Canceled => self.sendSignal(.kill_),
            };
        }
        state.completed.waitUncancelable(io);
        state.tasks.await(io) catch |err| switch (err) {
            error.Canceled => {},
        };
        deregister(io, state);
        state.allocator.destroy(state);
        self.state = null;
    }
};

fn trackChild(allocator: std.mem.Allocator, io: std.Io, child: std.process.Child) !Process {
    reapDetached(io);
    if (reg_count >= MAX_CHILDREN) return error.ProcessRegistryFull;

    const pid = child.id orelse return error.ProcessDidNotStart;
    const state = try allocator.create(ProcessState);
    errdefer allocator.destroy(state);
    state.* = .{
        .allocator = allocator,
        .io = io,
        .child = child,
        .pid = pid,
    };
    try state.tasks.concurrent(io, ProcessState.waitLoop, .{state});
    register(io, state);
    return .{ .pid = pid, .state = state };
}

/// Spawn and track a process using Zig's native 0.16 spawn option shape.
pub fn spawn(
    allocator: std.mem.Allocator,
    io: std.Io,
    options: std.process.SpawnOptions,
) !Process {
    var child = try std.process.spawn(io, options);
    errdefer child.kill(io);
    return trackChild(allocator, io, child);
}

const FilePump = struct {
    state: *State,
    terminal_reported: bool = false,

    const Terminal = enum(u8) { running, eof, failed };

    const State = struct {
        allocator: std.mem.Allocator,
        io: std.Io,
        file: std.Io.File,
        tasks: std.Io.Group = .init,
        bytes: std.Io.Queue(u8),
        byte_storage: [PIPE_QUEUE_CAPACITY]u8 = undefined,
        readable: std.Io.Event = .unset,
        terminal: std.atomic.Value(Terminal) = .init(.running),
        read_error: ?std.Io.File.ReadStreamingError = null,

        fn readLoop(state: *State) std.Io.Cancelable!void {
            var buffer: [PIPE_READ_CAPACITY]u8 = undefined;
            while (true) {
                const n = state.file.readStreaming(state.io, &.{&buffer}) catch |err| switch (err) {
                    error.EndOfStream => {
                        state.terminal.store(.eof, .release);
                        state.readable.set(state.io);
                        return;
                    },
                    error.Canceled => return error.Canceled,
                    else => {
                        state.read_error = err;
                        state.terminal.store(.failed, .release);
                        state.readable.set(state.io);
                        return;
                    },
                };
                if (n == 0) continue;
                state.bytes.putAll(state.io, buffer[0..n]) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
                state.readable.set(state.io);
            }
        }
    };

    const DrainResult = union(enum) {
        empty,
        data: usize,
        closed,
        failed: std.Io.File.ReadStreamingError,
    };

    fn init(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File) !FilePump {
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

    fn drain(pump: *FilePump, out: []u8) DrainResult {
        if (out.len != 0) {
            const n = pump.state.bytes.getUncancelable(pump.state.io, out, 0) catch |err| switch (err) {
                error.Closed => 0,
            };
            if (n != 0) return .{ .data = n };
        }
        if (pump.terminal_reported) return .empty;
        return switch (pump.state.terminal.load(.acquire)) {
            .running => .empty,
            .eof => result: {
                pump.terminal_reported = true;
                break :result .closed;
            },
            .failed => result: {
                pump.terminal_reported = true;
                break :result .{ .failed = pump.state.read_error orelse error.Unexpected };
            },
        };
    }

    fn drainWait(pump: *FilePump, out: []u8, timeout: std.Io.Timeout) !DrainResult {
        const immediate = pump.drain(out);
        switch (immediate) {
            .empty => {},
            else => return immediate,
        }

        pump.state.readable.reset();
        const after_reset = pump.drain(out);
        switch (after_reset) {
            .empty => {},
            else => return after_reset,
        }

        try pump.state.readable.waitTimeout(pump.state.io, timeout);
        return pump.drain(out);
    }

    fn deinit(pump: *FilePump, io: std.Io) void {
        const state = pump.state;
        state.tasks.cancel(io);
        state.bytes.close(io);
        state.file.close(io);
        state.allocator.destroy(state);
        pump.* = undefined;
    }
};

pub const PipeReadResult = FilePump.DrainResult;

pub const PipedProcess = struct {
    process: Process,
    stdin: ?std.Io.File,
    stdout: ?FilePump,
    stderr: ?FilePump,

    pub fn hasStdin(self: *const PipedProcess) bool {
        return self.stdin != null;
    }

    pub fn hasStdout(self: *const PipedProcess) bool {
        return self.stdout != null;
    }

    pub fn hasStderr(self: *const PipedProcess) bool {
        return self.stderr != null;
    }

    pub fn writeStdin(self: *PipedProcess, io: std.Io, bytes: []const u8) bool {
        const file = self.stdin orelse return false;
        file.writeStreamingAll(io, bytes) catch return false;
        return true;
    }

    pub fn closeStdin(self: *PipedProcess, io: std.Io) void {
        const file = self.stdin orelse return;
        file.close(io);
        self.stdin = null;
    }

    pub fn drainStdout(self: *PipedProcess, out: []u8) PipeReadResult {
        if (self.stdout) |*pump| return pump.drain(out);
        return .closed;
    }

    pub fn drainStderr(self: *PipedProcess, out: []u8) PipeReadResult {
        if (self.stderr) |*pump| return pump.drain(out);
        return .closed;
    }

    pub fn deinit(self: *PipedProcess, io: std.Io) void {
        self.closeStdin(io);
        self.process.closeProcess(io);
        if (self.stdout) |*pump| pump.deinit(io);
        if (self.stderr) |*pump| pump.deinit(io);
        self.stdout = null;
        self.stderr = null;
    }
};

/// Spawn a process and transfer native pipe files into frame-friendly reader
/// tasks before the waiter task takes ownership of the child.
pub fn spawnPiped(
    allocator: std.mem.Allocator,
    io: std.Io,
    options: std.process.SpawnOptions,
) !PipedProcess {
    var child = try std.process.spawn(io, options);
    errdefer child.kill(io);

    const stdin = child.stdin;
    const stdout_file = child.stdout;
    const stderr_file = child.stderr;
    child.stdin = null;
    child.stdout = null;
    child.stderr = null;

    var stdin_unclaimed = stdin;
    errdefer if (stdin_unclaimed) |file| file.close(io);
    var stdout_unclaimed = stdout_file;
    errdefer if (stdout_unclaimed) |file| file.close(io);
    var stderr_unclaimed = stderr_file;
    errdefer if (stderr_unclaimed) |file| file.close(io);

    var stdout: ?FilePump = if (stdout_unclaimed) |file| try FilePump.init(allocator, io, file) else null;
    stdout_unclaimed = null;
    errdefer if (stdout) |*pump| pump.deinit(io);
    var stderr: ?FilePump = if (stderr_unclaimed) |file| try FilePump.init(allocator, io, file) else null;
    stderr_unclaimed = null;
    errdefer if (stderr) |*pump| pump.deinit(io);

    const tracked = try trackChild(allocator, io, child);
    stdin_unclaimed = null;
    return .{
        .process = tracked,
        .stdin = stdin,
        .stdout = stdout,
        .stderr = stderr,
    };
}

// PID registry used by the crash watchdog.
var registered: [MAX_CHILDREN]?*ProcessState = [_]?*ProcessState{null} ** MAX_CHILDREN;
var reg_count: usize = 0;
var registry_path_buf: [128]u8 = undefined;
var registry_path_len: usize = 0;
var registry_initialized = false;

fn ensureRegistryInit() void {
    if (registry_initialized) return;
    registry_initialized = true;
    registry_path_len = (std.fmt.bufPrint(
        &registry_path_buf,
        "/tmp/tsz_children_{d}",
        .{std.c.getpid()},
    ) catch return).len;
}

fn registryPath() ?[]const u8 {
    ensureRegistryInit();
    if (registry_path_len == 0) return null;
    return registry_path_buf[0..registry_path_len];
}

fn register(io: std.Io, state: *ProcessState) void {
    registered[reg_count] = state;
    reg_count += 1;
    writeRegistryFile(io);
}

fn deregister(io: std.Io, state: *ProcessState) void {
    var write_index: usize = 0;
    for (registered[0..reg_count]) |candidate| {
        if (candidate != state) {
            registered[write_index] = candidate;
            write_index += 1;
        }
    }
    for (write_index..reg_count) |i| registered[i] = null;
    reg_count = write_index;
    writeRegistryFile(io);
}

fn reapDetached(io: std.Io) void {
    var index: usize = 0;
    while (index < reg_count) {
        const state = registered[index].?;
        if (!state.detached or state.status.load(.acquire) == .running) {
            index += 1;
            continue;
        }
        state.completed.waitUncancelable(io);
        state.tasks.await(io) catch |err| switch (err) {
            error.Canceled => {},
        };
        deregister(io, state);
        state.allocator.destroy(state);
    }
}

fn writeRegistryFile(io: std.Io) void {
    const path = registryPath() orelse return;
    var file = std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true }) catch return;
    defer file.close(io);

    var buffer: [512]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    for (registered[0..reg_count]) |state| {
        writer.print("{d}\n", .{state.?.pid}) catch break;
    }
    file.writeStreamingAll(io, writer.buffered()) catch {};
}

/// Kill all tracked children together, then join their native wait tasks.
pub fn killAll(io: std.Io) void {
    if (reg_count == 0) {
        cleanup(io);
        return;
    }

    for (registered[0..reg_count]) |state| {
        if (state.?.status.load(.acquire) == .running)
            std.posix.kill(state.?.pid, .TERM) catch {};
    }

    std.Io.sleep(io, .fromMilliseconds(200), .awake) catch |err| switch (err) {
        error.Canceled => {},
    };

    for (registered[0..reg_count]) |state| {
        if (state.?.status.load(.acquire) == .running)
            std.posix.kill(state.?.pid, .KILL) catch {};
    }

    while (reg_count != 0) {
        const state = registered[reg_count - 1].?;
        state.completed.waitUncancelable(io);
        state.tasks.await(io) catch |err| switch (err) {
            error.Canceled => {},
        };
        reg_count -= 1;
        registered[reg_count] = null;
        state.allocator.destroy(state);
    }
    cleanup(io);
}

pub fn cleanup(io: std.Io) void {
    const path = registryPath() orelse return;
    std.Io.Dir.deleteFileAbsolute(io, path) catch {};
}

pub fn count() usize {
    return reg_count;
}

pub fn getPid(index: usize) Id {
    if (index >= reg_count) return -1;
    return registered[index].?.pid;
}

test "native piped process publishes stdout, stderr, and exit" {
    const testing = std.testing;
    const io = testing.io;
    var child = try spawnPiped(testing.allocator, io, .{
        .argv = &.{ "/bin/sh", "-c", "IFS= read -r line; printf '%s' \"$line\"; printf error >&2; exit 7" },
        .stdin = .pipe,
        .stdout = .pipe,
        .stderr = .pipe,
    });
    defer child.deinit(io);

    try testing.expect(child.writeStdin(io, "output\n"));
    child.closeStdin(io);

    const term = try child.process.wait(io);
    try testing.expectEqual(Term{ .exited = 7 }, term);

    var stdout_buffer: [32]u8 = undefined;
    var stderr_buffer: [32]u8 = undefined;
    var stdout_len: usize = 0;
    var stderr_len: usize = 0;
    var stdout_done = false;
    var stderr_done = false;
    while (!stdout_done or !stderr_done) {
        if (!stdout_done) switch (try child.stdout.?.drainWait(
            stdout_buffer[stdout_len..],
            .{ .duration = .{ .raw = .fromSeconds(1), .clock = .awake } },
        )) {
            .data => |n| stdout_len += n,
            .closed => stdout_done = true,
            .failed => |err| return err,
            .empty => {},
        };
        if (!stderr_done) switch (try child.stderr.?.drainWait(
            stderr_buffer[stderr_len..],
            .{ .duration = .{ .raw = .fromSeconds(1), .clock = .awake } },
        )) {
            .data => |n| stderr_len += n,
            .closed => stderr_done = true,
            .failed => |err| return err,
            .empty => {},
        };
    }
    try testing.expectEqualStrings("output", stdout_buffer[0..stdout_len]);
    try testing.expectEqualStrings("error", stderr_buffer[0..stderr_len]);
}

test "native process signal is reaped by the waiter task" {
    const testing = std.testing;
    const io = testing.io;
    var child = try spawn(testing.allocator, io, .{
        .argv = &.{ "/bin/sh", "-c", "while :; do sleep 1; done" },
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
    });
    defer child.closeProcess(io);

    try testing.expect(child.alive());
    child.sendSignal(.term);
    const term = try child.wait(io);
    switch (term) {
        .signal => |signal| try testing.expectEqual(std.posix.SIG.TERM, signal),
        else => return error.TestExpectedSignalTermination,
    }
}
