//! Bidirectional session with a running `claude` subprocess in stream-json mode.
//!
//! Inspired by codeberg/duhnist/claude-code-sdk-zig session.zig but rewritten
//! for Zig 0.16 using an injected `std.Io` capability. A cancelable reader task
//! owns stdout while the caller drains completed bytes once per frame.
//!
//! Usage:
//!   var sess = try Session.init(io, environ, allocator, .{ .cwd = "/path/to/project" });
//!   defer sess.deinit();
//!   try sess.send("Hello");
//!
//!   // Each frame:
//!   while (try sess.poll()) |*owned| {
//!       defer owned.deinit();
//!       switch (owned.msg) { ... }
//!   }

const std = @import("std");

const options = @import("options.zig");
const types = @import("types.zig");
const argv_mod = @import("argv.zig");
const parser = @import("parser.zig");
const ReadBuffer = @import("buffer.zig").ReadBuffer;
const ChildStdout = @import("child_stdout.zig").ChildStdout;

pub const Session = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    child: std.process.Child,
    stdout: ?ChildStdout,
    line_buf: ReadBuffer,
    chunk: [8192]u8 = undefined,
    closed: bool = false,
    reaped: bool = false,

    pub fn init(
        io: std.Io,
        environ_map: *const std.process.Environ.Map,
        allocator: std.mem.Allocator,
        opts: options.SessionOptions,
    ) !Session {
        const binary = try argv_mod.findBinary(io, environ_map, allocator, opts.cli_path);
        defer allocator.free(binary);

        const argv = try argv_mod.buildSessionArgv(allocator, binary, opts);
        // argv memory must outlive spawn(); Child.init copies it but we still
        // own the slice data until spawn returns successfully. Free after.
        defer argv_mod.freeArgv(allocator, argv);

        // When config_dir is set, fork the parent's env, override
        // CLAUDE_CONFIG_DIR, and hand it to the child. The map must outlive
        // spawn() but can be torn down right after — spawn() copies env
        // into the new process before returning.
        var env_overlay: ?std.process.Environ.Map = null;
        defer if (env_overlay) |*m| m.deinit();
        if (opts.config_dir) |cd| {
            var em = try environ_map.clone(allocator);
            errdefer em.deinit();
            try em.put("CLAUDE_CONFIG_DIR", cd);
            env_overlay = em;
        }

        var child = std.process.spawn(io, .{
            .argv = argv,
            .cwd = .{ .path = opts.cwd },
            .stdin = .pipe,
            .stdout = .pipe,
            .stderr = if (opts.inherit_stderr) .inherit else .ignore,
            .environ_map = if (env_overlay) |*m| m else null,
        }) catch |err| {
            std.log.err("claude_sdk: spawn failed: {s}", .{@errorName(err)});
            return error.SpawnFailed;
        };
        errdefer child.kill(io);

        const stdout_file = child.stdout orelse return error.SpawnFailed;
        child.stdout = null;
        const stdout = try ChildStdout.init(allocator, io, stdout_file);

        return .{
            .io = io,
            .allocator = allocator,
            .child = child,
            .stdout = stdout,
            .line_buf = ReadBuffer.init(allocator),
        };
    }

    /// Write a user turn to the subprocess stdin in stream-json format.
    pub fn send(self: *Session, prompt: []const u8) !void {
        if (self.closed) return error.SessionClosed;
        const stdin = self.child.stdin orelse return error.SessionClosed;

        var buf: std.ArrayList(u8) = .empty;
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":");
        try appendJsonString(self.allocator, &buf, prompt);
        try buf.appendSlice(self.allocator, "},\"parent_tool_use_id\":null}\n");

        stdin.writeStreamingAll(self.io, buf.items) catch |err| {
            std.log.err("claude_sdk: stdin writeAll failed: {s}", .{@errorName(err)});
            self.closed = true;
            stdin.close(self.io);
            self.child.stdin = null;
            return error.WriteError;
        };
    }

    /// Send a cancellation signal mid-turn.
    pub fn interrupt(self: *Session) !void {
        if (self.closed) return error.SessionClosed;
        const stdin = self.child.stdin orelse return error.SessionClosed;
        stdin.writeStreamingAll(self.io, "{\"type\":\"interrupt\"}\n") catch return error.WriteError;
    }

    /// Non-blocking poll. Returns the next parsed message if one is ready, or
    /// null if the subprocess has not yet produced a complete line this tick.
    /// Call repeatedly until null to drain all available events per frame.
    pub fn poll(self: *Session) !?types.OwnedMessage {
        while (true) {
            if (self.line_buf.drain()) |line| {
                if (try parseLine(self.allocator, line)) |owned| return owned;
                continue;
            }

            const stdout = if (self.stdout) |*value| value else return null;
            switch (stdout.drain(&self.chunk)) {
                .empty => return null,
                .data => |n| try self.line_buf.append(self.chunk[0..n]),
                .closed => {
                    self.finishStdout();
                    return null;
                },
                .failed => |err| {
                    std.log.err("claude_sdk: stdout read failed: {s}", .{@errorName(err)});
                    self.finishStdout();
                    return error.ReadError;
                },
            }
        }
    }

    /// Close stdin and reap the subprocess.
    pub fn close(self: *Session) !void {
        if (self.reaped) return;
        self.closed = true;

        if (self.child.stdin) |stdin| {
            stdin.close(self.io);
            self.child.stdin = null;
        }

        if (self.stdout) |*stdout| stdout.discard();
        defer self.stopStdout();
        _ = try self.child.wait(self.io);
        self.reaped = true;
    }

    /// Force-kill if still running and release internal buffers.
    pub fn deinit(self: *Session) void {
        if (self.child.stdin) |stdin| {
            stdin.close(self.io);
            self.child.stdin = null;
        }
        self.stopStdout();
        if (!self.reaped) {
            self.child.kill(self.io);
            self.reaped = true;
        }
        self.closed = true;
        self.line_buf.deinit();
    }

    fn finishStdout(self: *Session) void {
        self.closed = true;
        if (self.child.stdin) |stdin| {
            stdin.close(self.io);
            self.child.stdin = null;
        }
        self.stopStdout();
    }

    fn stopStdout(self: *Session) void {
        if (self.stdout) |*stdout| stdout.deinit();
        self.stdout = null;
    }
};

// ── helpers ──────────────────────────────────────────────────────────────

fn appendJsonString(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    s: []const u8,
) !void {
    try buf.append(allocator, '"');
    for (s) |c| {
        switch (c) {
            '"' => try buf.appendSlice(allocator, "\\\""),
            '\\' => try buf.appendSlice(allocator, "\\\\"),
            '\n' => try buf.appendSlice(allocator, "\\n"),
            '\r' => try buf.appendSlice(allocator, "\\r"),
            '\t' => try buf.appendSlice(allocator, "\\t"),
            0x00...0x08, 0x0b...0x0c, 0x0e...0x1f => {
                var hex: [6]u8 = undefined;
                const s2 = try std.fmt.bufPrint(&hex, "\\u{x:0>4}", .{c});
                try buf.appendSlice(allocator, s2);
            },
            else => try buf.append(allocator, c),
        }
    }
    try buf.append(allocator, '"');
}

fn parseLine(allocator: std.mem.Allocator, line: []const u8) !?types.OwnedMessage {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();

    const msg = parser.parseMessage(arena.allocator(), line) catch |err| {
        arena.deinit();
        if (err == error.InvalidJson) {
            std.log.warn("claude_sdk: invalid JSON line, skipping", .{});
            return null;
        }
        return err;
    };

    if (msg) |m| {
        return types.OwnedMessage{
            .msg = m,
            .arena = arena,
        };
    }

    arena.deinit();
    return null;
}

test "session observes child stdout EOF through injected Io" {
    const io = std.testing.io;
    var environ_map = std.process.Environ.Map.init(std.testing.allocator);
    defer environ_map.deinit();

    var session = try Session.init(io, &environ_map, std.testing.allocator, .{
        .cwd = "/tmp",
        .cli_path = "/bin/true",
    });
    defer session.deinit();

    for (0..1_000) |_| {
        try std.testing.expect((try session.poll()) == null);
        if (session.closed) break;
        try std.Io.sleep(io, .fromMilliseconds(1), .awake);
    } else return error.SessionDidNotObserveEof;
}
