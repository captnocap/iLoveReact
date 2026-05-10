//! Bidirectional session with a running `claude` subprocess in stream-json mode.
//!
//! Inspired by codeberg/duhnist/claude-code-sdk-zig session.zig but rewritten
//! for Zig 0.15.2 using std.process.Child + O_NONBLOCK. No fiber runtime;
//! the caller drives progress via poll() once per frame.
//!
//! Usage:
//!   var sess = try Session.init(allocator, .{ .cwd = "/path/to/project" });
//!   defer sess.deinit();
//!   try sess.send("Hello");
//!
//!   // Each frame:
//!   while (try sess.poll()) |*owned| {
//!       defer owned.deinit();
//!       switch (owned.msg) { ... }
//!   }

const std = @import("std");
const posix = std.posix;

const options = @import("options.zig");
const types = @import("types.zig");
const argv_mod = @import("argv.zig");
const parser = @import("parser.zig");
const ReadBuffer = @import("buffer.zig").ReadBuffer;

pub const Session = struct {
    allocator: std.mem.Allocator,
    child: std.process.Child,
    line_buf: ReadBuffer,
    chunk: [8192]u8 = undefined,
    closed: bool = false,

    pub fn init(
        allocator: std.mem.Allocator,
        opts: options.SessionOptions,
    ) !Session {
        const binary = try argv_mod.findBinary(allocator, opts.cli_path);
        defer allocator.free(binary);

        const argv = try argv_mod.buildSessionArgv(allocator, binary, opts);
        // argv memory must outlive spawn(); Child.init copies it but we still
        // own the slice data until spawn returns successfully. Free after.
        defer argv_mod.freeArgv(allocator, argv);

        var child = std.process.Child.init(argv, allocator);
        child.cwd = opts.cwd;
        child.stdin_behavior = .Pipe;
        child.stdout_behavior = .Pipe;
        child.stderr_behavior = if (opts.inherit_stderr) .Inherit else .Ignore;

        // When config_dir is set, fork the parent's env, override
        // CLAUDE_CONFIG_DIR, and hand it to the child. The map must
        // outlive child.spawn() but can be torn down right after —
        // spawn() copies env into the new process before returning.
        var env_overlay: ?std.process.EnvMap = null;
        defer if (env_overlay) |*m| m.deinit();
        if (opts.config_dir) |cd| {
            var em = try std.process.getEnvMap(allocator);
            errdefer em.deinit();
            try em.put("CLAUDE_CONFIG_DIR", cd);
            env_overlay = em;
            child.env_map = &env_overlay.?;
        }

        child.spawn() catch |err| {
            std.log.err("claude_sdk: spawn failed: {s}", .{@errorName(err)});
            return error.SpawnFailed;
        };

        // Make stdout non-blocking so poll() can return promptly when no
        // line is available yet.
        if (child.stdout) |stdout| {
            setNonBlocking(stdout.handle) catch |err| {
                std.log.warn("claude_sdk: O_NONBLOCK on stdout failed: {s}", .{@errorName(err)});
            };
        }

        return .{
            .allocator = allocator,
            .child = child,
            .line_buf = ReadBuffer.init(allocator),
        };
    }

    /// Write a user turn to the subprocess stdin in stream-json format.
    pub fn send(self: *Session, prompt: []const u8) !void {
        if (self.closed) return error.SessionClosed;
        const stdin = self.child.stdin orelse return error.SessionClosed;

        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator,
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":");
        try appendJsonString(self.allocator, &buf, prompt);
        try buf.appendSlice(self.allocator, "},\"parent_tool_use_id\":null}\n");

        stdin.writeAll(buf.items) catch |err| {
            std.log.err("claude_sdk: stdin writeAll failed: {s}", .{@errorName(err)});
            self.closed = true;
            stdin.close();
            self.child.stdin = null;
            return error.WriteError;
        };
    }

    /// Send a cancellation signal mid-turn.
    pub fn interrupt(self: *Session) !void {
        if (self.closed) return error.SessionClosed;
        const stdin = self.child.stdin orelse return error.SessionClosed;
        stdin.writeAll("{\"type\":\"interrupt\"}\n") catch return error.WriteError;
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

            const stdout = self.child.stdout orelse return null;
            const n = posix.read(stdout.handle, &self.chunk) catch |err| switch (err) {
                error.WouldBlock => return null,
                else => {
                    std.log.err("claude_sdk: stdout read failed: {s}", .{@errorName(err)});
                    return error.ReadError;
                },
            };
            if (n == 0) {
                self.closed = true;
                if (self.child.stdin) |stdin| {
                    stdin.close();
                    self.child.stdin = null;
                }
                return null; // EOF — subprocess exited
            }
            try self.line_buf.append(self.chunk[0..n]);
        }
    }

    /// Close stdin and reap the subprocess.
    pub fn close(self: *Session) !void {
        if (self.closed) return;
        self.closed = true;

        if (self.child.stdin) |stdin| {
            stdin.close();
            self.child.stdin = null;
        }

        _ = self.child.wait() catch {};
    }

    /// Force-kill if still running and release internal buffers.
    pub fn deinit(self: *Session) void {
        if (!self.closed) {
            if (self.child.stdin) |stdin| {
                stdin.close();
                self.child.stdin = null;
            }
            _ = self.child.kill() catch {};
            self.closed = true;
        }
        self.line_buf.deinit();
    }
};

// ── helpers ──────────────────────────────────────────────────────────────

fn setNonBlocking(fd: posix.fd_t) !void {
    const flags = try posix.fcntl(fd, posix.F.GETFL, 0);
    _ = try posix.fcntl(fd, posix.F.SETFL, flags | @as(u32, @bitCast(posix.O{ .NONBLOCK = true })));
}

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
