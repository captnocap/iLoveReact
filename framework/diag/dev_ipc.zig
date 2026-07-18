//! dev_ipc.zig — Unix-domain socket listener for the dev-mode host.
//!
//! When the binary is compiled with -Ddev-mode=true, it listens on
//! /tmp/reactjit.sock for push messages from the `scripts/dev` CLI.
//! Multiple `scripts/dev <cart>` invocations share the same running binary:
//! each push either registers a new cart slot or updates an existing one,
//! and the binary switches its active cart to whichever was pushed most
//! recently.
//!
//! Wire protocol (one message per TCP accept — connections are one-shot):
//!   PUSH <name> <bundle_byte_length>\n
//!   <bundle_byte_length raw bytes>
//!   INFO\n
//!   NOTICE <json_byte_length>\n
//!   <json_byte_length raw bytes>
//!
//! The server acks with a single "OK\n" or "ERR <reason>\n" line.
//!
//! Polling model: the main loop calls `pollOnce()` each frame. This accepts
//! a waiting connection if any and parses at most one message per poll.
//! Pushes are queued for the application layer to handle between frames.

const std = @import("std");
const transport = @import("../net/transport.zig");
const event_bus = @import("event_bus.zig");
// Frame telemetry counters — were housed in qjs_runtime.zig, now in
// framework/frame_telemetry.zig (archive/qjs-stack/README.md). Aliased
// as `qjs_runtime` to keep existing call sites working.
const frame_telemetry = @import("frame_telemetry.zig");
const telemetry = @import("telemetry.zig");
const sock_util = @import("sock_util.zig");
const build_options = @import("build_options");
const log = std.log.scoped(.dev_ipc);

const writeAll = sock_util.writeAll;

pub const SOCKET_PATH = if (@hasDecl(build_options, "dev_socket_path")) build_options.dev_socket_path else "/tmp/reactjit.sock";

pub const PushMessage = struct {
    name: []u8, // heap-allocated, owned by the caller after take()
    bundle: []u8, // ditto
};

pub const NoticeMessage = struct {
    json: []u8, // heap-allocated JSON payload, owned by the caller after take()
};

pub const Message = union(enum) {
    push: PushMessage,
    notice: NoticeMessage,
};

pub const Server = struct {
    listener: ?transport.ListenerPump = null,
    queued: std.ArrayList(Message) = .empty,
    allocator: std.mem.Allocator,
    build_id: []const u8,

    /// `allocator` owns every queued message until `takeNext` transfers it
    /// to the caller. The caller must therefore free messages with the same
    /// allocator after taking them.
    pub fn init(allocator: std.mem.Allocator, build_id: []const u8) Server {
        return .{
            .allocator = allocator,
            .build_id = build_id,
        };
    }

    /// Bind + listen on the well-known socket path. Silently no-ops if we can't
    /// bind (another host already running, or path permission issue).
    pub fn start(self: *Server, io: std.Io) void {
        if (self.listener != null) return;

        // Unlink stale socket file if present
        std.Io.Dir.deleteFileAbsolute(io, SOCKET_PATH) catch |err| switch (err) {
            error.FileNotFound => {},
            else => {
                log.warn("unlink {s} failed: {}", .{ SOCKET_PATH, err });
                return;
            },
        };

        const address = std.Io.net.UnixAddress.init(SOCKET_PATH) catch |err| {
            log.warn("socket address failed: {}", .{err});
            return;
        };
        var server = address.listen(io, .{ .kernel_backlog = 4 }) catch |err| {
            log.warn("bind/listen {s} failed: {}", .{ SOCKET_PATH, err });
            return;
        };
        self.listener = transport.ListenerPump.init(self.allocator, io, server) catch |err| {
            server.deinit(io);
            log.warn("listener task failed: {}", .{err});
            return;
        };

        log.info("listening on {s}", .{SOCKET_PATH});
    }

    pub fn deinit(self: *Server, io: std.Io) void {
        if (self.listener) |*pump| {
            pump.deinit();
            std.Io.Dir.deleteFileAbsolute(io, SOCKET_PATH) catch {};
            self.listener = null;
        }
        self.drainQueue();
        self.queued.deinit(self.allocator);
        self.queued = .empty;
    }

    /// Accept pending connections and parse any queued messages. Non-blocking —
    /// returns immediately if no connection is waiting.
    pub fn pollOnce(self: *Server, io: std.Io) void {
        const pump = if (self.listener) |*active| active else return;

        // Accept one connection per poll (if more are pending, they'll come next frame)
        const client = pump.accept() orelse return;
        defer client.close(io);

        self.handleClient(io, client) catch |e| {
            // BrokenPipe / ConnectionResetByPeer = client gave up before our
            // write completed. Common when devshell polls TELEMETRY at 4Hz
            // and the cart frame loop briefly stalls past the 200ms read
            // timeout — not an error worth logging on every occurrence.
            if (e == error.BrokenPipe or e == error.ConnectionResetByPeer) return;
            log.warn("client error: {}", .{e});
            writeAll(io, client, "ERR internal\n") catch {};
        };
    }

    fn handleClient(self: *Server, io: std.Io, client: std.Io.net.Stream) !void {
        var read_backing: [8192]u8 = undefined;
        var stream_reader = client.reader(io, &read_backing);
        const reader = &stream_reader.interface;

        // Read the header line up to '\n' into a small stack buffer
        var header_buf: [256]u8 = undefined;
        var header_len: usize = 0;
        while (header_len < header_buf.len) {
            header_buf[header_len] = reader.takeByte() catch |err| switch (err) {
                error.EndOfStream => return error.EarlyEof,
                error.ReadFailed => return stream_reader.err orelse error.Unexpected,
            };
            header_len += 1;
            if (header_buf[header_len - 1] == '\n') break;
        }
        if (header_len == 0 or header_buf[header_len - 1] != '\n') return error.BadHeader;
        const header = std.mem.trimEnd(u8, header_buf[0..header_len], "\r\n");

        // Parse: "PUSH <name> <length>", "INFO", "NOTICE <length>", or diagnostics.
        var it = std.mem.tokenizeScalar(u8, header, ' ');
        const verb = it.next() orelse return error.BadHeader;

        if (std.mem.eql(u8, verb, "INFO")) {
            var buf: [256]u8 = undefined;
            const reply = std.fmt.bufPrint(
                &buf,
                "{{\"build_id\":\"{s}\"}}\n",
                .{self.build_id},
            ) catch "{\"build_id\":\"unknown\"}\n";
            try writeAll(io, client, reply);
            return;
        }

        if (std.mem.eql(u8, verb, "LOGLEVEL")) {
            // "LOGLEVEL"          → reply "{\"level\":<f>}\n" (current threshold)
            // "LOGLEVEL <0..1>"   → set threshold and reply with the new value
            if (it.next()) |arg| {
                const v = std.fmt.parseFloat(f32, arg) catch {
                    try writeAll(io, client, "ERR bad level\n");
                    return;
                };
                event_bus.setMinImportance(v);
            }
            var buf: [64]u8 = undefined;
            const reply = std.fmt.bufPrint(&buf, "{{\"level\":{d:.3}}}\n", .{event_bus.minImportance()}) catch "{}\n";
            try writeAll(io, client, reply);
            return;
        }

        if (std.mem.eql(u8, verb, "EVENTS")) {
            // "EVENTS <n>" → JSON array of the last N events from the
            // in-memory ring (capped at RING_SIZE = 4096). Default 200 if N
            // omitted or unparseable. Reads memory only — no SQL, no file
            // I/O — so safe to poll at devshell rates.
            var n: usize = 200;
            if (it.next()) |arg| {
                n = std.fmt.parseInt(usize, arg, 10) catch 200;
            }
            const json = event_bus.recentEventsJson(self.allocator, n) catch {
                try writeAll(io, client, "[]\n");
                return;
            };
            defer self.allocator.free(json);
            try writeAll(io, client, json);
            try writeAll(io, client, "\n");
            return;
        }

        if (std.mem.eql(u8, verb, "TELEMETRY")) {
            // One-shot snapshot of the live telemetry counters. JSON line +
            // close. Used by tools/devshell to render fps/nodes/paint/layout
            // in its title bar at ~4Hz.
            const snap = telemetry.current;
            var buf: [512]u8 = undefined;
            const json = std.fmt.bufPrint(
                &buf,
                "{{\"fps\":{d},\"layout_us\":{d},\"paint_us\":{d},\"gpu_us\":{d},\"frame_total_us\":{d},\"frame_number\":{d},\"node_count\":{d}}}\n",
                .{
                    frame_telemetry.telemetry_fps,
                    frame_telemetry.telemetry_layout_us,
                    frame_telemetry.telemetry_paint_us,
                    frame_telemetry.telemetry_gpu_us,
                    snap.frame_total_us,
                    snap.frame_number,
                    telemetry.nodeCount(),
                },
            ) catch "{}\n";
            try writeAll(io, client, json);
            return;
        }

        if (std.mem.eql(u8, verb, "NOTICE")) {
            const len_str = it.next() orelse return error.BadHeader;
            const json_len = std.fmt.parseInt(usize, len_str, 10) catch return error.BadHeader;
            if (json_len > 128 * 1024) {
                try writeAll(io, client, "ERR notice too large\n");
                return;
            }
            const json = try self.allocator.alloc(u8, json_len);
            errdefer self.allocator.free(json);
            try readExactly(&stream_reader, json);
            try self.queued.append(self.allocator, .{ .notice = .{ .json = json } });
            try writeAll(io, client, "OK\n");
            _ = event_bus.emit("dev.notice", "framework/dev_ipc.zig", null, "{\"kind\":\"notice\"}");
            return;
        }

        if (!std.mem.eql(u8, verb, "PUSH")) {
            try writeAll(io, client, "ERR unknown verb\n");
            return;
        }
        const name = it.next() orelse return error.BadHeader;
        const len_str = it.next() orelse return error.BadHeader;
        const bundle_len = std.fmt.parseInt(usize, len_str, 10) catch return error.BadHeader;
        if (bundle_len > 32 * 1024 * 1024) {
            try writeAll(io, client, "ERR bundle too large\n");
            return;
        }

        // Copy name into heap and read bundle body
        const name_copy = try self.allocator.dupe(u8, name);
        errdefer self.allocator.free(name_copy);
        const bundle = try self.allocator.alloc(u8, bundle_len);
        errdefer self.allocator.free(bundle);

        try readExactly(&stream_reader, bundle);

        try self.queued.append(self.allocator, .{ .push = .{ .name = name_copy, .bundle = bundle } });
        try writeAll(io, client, "OK\n");
        log.info("pushed '{s}' ({d} bytes)", .{ name_copy, bundle_len });

        // Bus event. Peer PID lets us spot the orphan-watcher race we hit
        // earlier — if two different PIDs alternate in the bus log pushing
        // the same cart, that's the failure mode (zombie watchers fighting
        // for the active tab). Without this signal we'd just see the active
        // tab flapping with no clue who's responsible.
        const peer = peerPidOrZero(client.socket.handle);
        var pbuf: [192]u8 = undefined;
        if (std.fmt.bufPrint(
            &pbuf,
            "{{\"cart\":\"{s}\",\"bytes\":{d},\"peer_pid\":{d}}}",
            .{ name_copy, bundle_len, peer },
        )) |p| {
            _ = event_bus.emit("bundle.push", "framework/dev_ipc.zig", null, p);
        } else |_| {
            _ = event_bus.emit("bundle.push", "framework/dev_ipc.zig", null, "{}");
        }
    }

    fn readExactly(stream_reader: *std.Io.net.Stream.Reader, destination: []u8) !void {
        stream_reader.interface.readSliceAll(destination) catch |err| switch (err) {
            error.EndOfStream => return error.EarlyEof,
            error.ReadFailed => return stream_reader.err orelse error.Unexpected,
        };
    }

    const Ucred = extern struct { pid: i32, uid: u32, gid: u32 };
    const SOL_SOCKET: c_int = 1;
    const SO_PEERCRED: c_int = 17;
    extern fn getsockopt(s: c_int, level: c_int, optname: c_int, optval: ?*anyopaque, optlen: ?*u32) c_int;

    fn peerPidOrZero(fd: std.posix.fd_t) i32 {
        var cred: Ucred = .{ .pid = 0, .uid = 0, .gid = 0 };
        var len: u32 = @sizeOf(Ucred);
        if (getsockopt(@as(c_int, @intCast(fd)), SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return 0;
        return cred.pid;
    }

    /// Pull the next queued dev message. Returns null if the queue is empty.
    /// Caller owns the returned message memory.
    pub fn takeNext(self: *Server) ?Message {
        if (self.queued.items.len == 0) return null;
        return self.queued.orderedRemove(0);
    }

    fn drainQueue(self: *Server) void {
        while (self.queued.items.len > 0) {
            const msg = self.queued.orderedRemove(0);
            switch (msg) {
                .push => |push| {
                    self.allocator.free(push.name);
                    self.allocator.free(push.bundle);
                },
                .notice => |notice| self.allocator.free(notice.json),
            }
        }
    }
};

test "Server owns queued message storage without storing an Io handle" {
    inline for (@typeInfo(Server).@"struct".fields) |field| {
        try std.testing.expect(field.type != std.Io);
        try std.testing.expect(field.type != ?std.Io);
    }

    var server = Server.init(std.testing.allocator, "test-build");
    defer server.deinit(std.testing.io);

    const json = try std.testing.allocator.dupe(u8, "{\"kind\":\"test\"}");
    try server.queued.append(std.testing.allocator, .{ .notice = .{ .json = json } });

    const message = server.takeNext() orelse return error.TestUnexpectedResult;
    switch (message) {
        .notice => |notice| {
            defer std.testing.allocator.free(notice.json);
            try std.testing.expectEqualStrings("{\"kind\":\"test\"}", notice.json);
        },
        .push => return error.TestUnexpectedResult,
    }
    try std.testing.expect(server.takeNext() == null);
}
