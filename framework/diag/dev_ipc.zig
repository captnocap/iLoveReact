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
const event_bus = @import("event_bus.zig");
// Frame telemetry counters — were housed in qjs_runtime.zig, now in
// framework/frame_telemetry.zig (archive/qjs-stack/README.md). Aliased
// as `qjs_runtime` to keep existing call sites working.
const frame_telemetry = @import("frame_telemetry.zig");
const telemetry = @import("telemetry.zig");
const sock_util = @import("sock_util.zig");
const log = std.log.scoped(.dev_ipc);

const writeAll = sock_util.writeAll;

pub const SOCKET_PATH = "/tmp/reactjit.sock";

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

var listen_fd: ?std.posix.socket_t = null;
var queued: std.ArrayList(Message) = .{};
var alloc: std.mem.Allocator = std.heap.page_allocator;
var build_id: []const u8 = "unknown";

/// Install the allocator used for push-message buffers. Must be called
/// BEFORE start() so bundle bytes are freed by the same allocator that
/// qjs_app.zig uses when upserting a tab. Using the wrong allocator here
/// is a silent UB/crash — don't skip this.
pub fn setAllocator(a: std.mem.Allocator) void {
    alloc = a;
}

pub fn setBuildId(id: []const u8) void {
    build_id = id;
}

/// Bind + listen on the well-known socket path. Silently no-ops if we can't
/// bind (another host already running, or path permission issue).
pub fn start() void {
    if (listen_fd != null) return;

    // Unlink stale socket file if present
    std.posix.unlink(SOCKET_PATH) catch {};

    const fd = std.posix.socket(std.posix.AF.UNIX, std.posix.SOCK.STREAM | std.posix.SOCK.NONBLOCK, 0) catch |e| {
        log.warn("socket create failed: {}", .{e});
        return;
    };

    // sun_path is [108]u8 on Linux, [104]u8 on macOS — undefined + memset zeroes
    // the field by its real length so this builds on both.
    var addr: std.posix.sockaddr.un = .{ .family = std.posix.AF.UNIX, .path = undefined };
    @memset(&addr.path, 0);
    const path = SOCKET_PATH;
    if (path.len >= addr.path.len) {
        log.warn("socket path too long", .{});
        std.posix.close(fd);
        return;
    }
    @memcpy(addr.path[0..path.len], path);

    std.posix.bind(fd, @ptrCast(&addr), @sizeOf(std.posix.sockaddr.un)) catch |e| {
        log.warn("bind {s} failed: {}", .{ path, e });
        std.posix.close(fd);
        return;
    };
    std.posix.listen(fd, 4) catch |e| {
        log.warn("listen failed: {}", .{e});
        std.posix.close(fd);
        return;
    };

    listen_fd = fd;
    log.info("listening on {s}", .{path});
}

pub fn stop() void {
    if (listen_fd) |fd| {
        std.posix.close(fd);
        std.posix.unlink(SOCKET_PATH) catch {};
        listen_fd = null;
    }
    drainQueue();
}

/// Accept pending connections and parse any queued messages. Non-blocking —
/// returns immediately if no connection is waiting.
pub fn pollOnce() void {
    const fd = listen_fd orelse return;

    // Accept one connection per poll (if more are pending, they'll come next frame)
    const client_fd = std.posix.accept(fd, null, null, std.posix.SOCK.NONBLOCK) catch |e| {
        if (e == error.WouldBlock) return;
        log.warn("accept failed: {}", .{e});
        return;
    };
    defer std.posix.close(client_fd);

    handleClient(client_fd) catch |e| {
        // BrokenPipe / ConnectionResetByPeer = client gave up before our
        // write completed. Common when devshell polls TELEMETRY at 4Hz
        // and the cart frame loop briefly stalls past the 200ms read
        // timeout — not an error worth logging on every occurrence.
        if (e == error.BrokenPipe or e == error.ConnectionResetByPeer) return;
        log.warn("client error: {}", .{e});
        writeAll(client_fd, "ERR internal\n") catch {};
    };
}

fn handleClient(client_fd: std.posix.socket_t) !void {
    // Client is set to non-blocking by accept; make blocking for the parse.
    const flags = try std.posix.fcntl(client_fd, std.posix.F.GETFL, 0);
    _ = try std.posix.fcntl(client_fd, std.posix.F.SETFL, flags & ~@as(usize, std.posix.SOCK.NONBLOCK));

    // Read the header line up to '\n' into a small stack buffer
    var header_buf: [256]u8 = undefined;
    var header_len: usize = 0;
    while (header_len < header_buf.len) {
        var byte: [1]u8 = undefined;
        const n = try std.posix.read(client_fd, &byte);
        if (n == 0) return error.EarlyEof;
        header_buf[header_len] = byte[0];
        header_len += 1;
        if (byte[0] == '\n') break;
    }
    if (header_len == 0 or header_buf[header_len - 1] != '\n') return error.BadHeader;
    const header = std.mem.trimRight(u8, header_buf[0..header_len], "\r\n");

    // Parse: "PUSH <name> <length>", "INFO", "NOTICE <length>", or diagnostics.
    var it = std.mem.tokenizeScalar(u8, header, ' ');
    const verb = it.next() orelse return error.BadHeader;

    if (std.mem.eql(u8, verb, "INFO")) {
        var buf: [256]u8 = undefined;
        const reply = std.fmt.bufPrint(
            &buf,
            "{{\"build_id\":\"{s}\"}}\n",
            .{build_id},
        ) catch "{\"build_id\":\"unknown\"}\n";
        try writeAll(client_fd, reply);
        return;
    }

    if (std.mem.eql(u8, verb, "LOGLEVEL")) {
        // "LOGLEVEL"          → reply "{\"level\":<f>}\n" (current threshold)
        // "LOGLEVEL <0..1>"   → set threshold and reply with the new value
        if (it.next()) |arg| {
            const v = std.fmt.parseFloat(f32, arg) catch {
                try writeAll(client_fd, "ERR bad level\n");
                return;
            };
            event_bus.setMinImportance(v);
        }
        var buf: [64]u8 = undefined;
        const reply = std.fmt.bufPrint(&buf, "{{\"level\":{d:.3}}}\n", .{event_bus.minImportance()}) catch "{}\n";
        try writeAll(client_fd, reply);
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
        const a = std.heap.page_allocator;
        const json = event_bus.recentEventsJson(a, n) catch {
            try writeAll(client_fd, "[]\n");
            return;
        };
        defer a.free(json);
        try writeAll(client_fd, json);
        try writeAll(client_fd, "\n");
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
            "{{\"fps\":{d},\"tick_us\":{d},\"layout_us\":{d},\"paint_us\":{d},\"gpu_us\":{d},\"frame_total_us\":{d},\"frame_number\":{d},\"node_count\":{d}}}\n",
            .{
                frame_telemetry.telemetry_fps,
                snap.tick_us,
                frame_telemetry.telemetry_layout_us,
                frame_telemetry.telemetry_paint_us,
                frame_telemetry.telemetry_gpu_us,
                snap.frame_total_us,
                snap.frame_number,
                telemetry.nodeCount(),
            },
        ) catch "{}\n";
        try writeAll(client_fd, json);
        return;
    }

    if (std.mem.eql(u8, verb, "NOTICE")) {
        const len_str = it.next() orelse return error.BadHeader;
        const json_len = std.fmt.parseInt(usize, len_str, 10) catch return error.BadHeader;
        if (json_len > 128 * 1024) {
            try writeAll(client_fd, "ERR notice too large\n");
            return;
        }
        const json = try alloc.alloc(u8, json_len);
        errdefer alloc.free(json);
        var read_total: usize = 0;
        while (read_total < json_len) {
            const n = try std.posix.read(client_fd, json[read_total..]);
            if (n == 0) return error.EarlyEof;
            read_total += n;
        }
        try queued.append(alloc, .{ .notice = .{ .json = json } });
        try writeAll(client_fd, "OK\n");
        _ = event_bus.emit("dev.notice", "framework/dev_ipc.zig", null, "{\"kind\":\"notice\"}");
        return;
    }

    if (!std.mem.eql(u8, verb, "PUSH")) {
        try writeAll(client_fd, "ERR unknown verb\n");
        return;
    }
    const name = it.next() orelse return error.BadHeader;
    const len_str = it.next() orelse return error.BadHeader;
    const bundle_len = std.fmt.parseInt(usize, len_str, 10) catch return error.BadHeader;
    if (bundle_len > 32 * 1024 * 1024) {
        try writeAll(client_fd, "ERR bundle too large\n");
        return;
    }

    // Copy name into heap and read bundle body
    const name_copy = try alloc.dupe(u8, name);
    errdefer alloc.free(name_copy);
    const bundle = try alloc.alloc(u8, bundle_len);
    errdefer alloc.free(bundle);

    var read_total: usize = 0;
    while (read_total < bundle_len) {
        const n = try std.posix.read(client_fd, bundle[read_total..]);
        if (n == 0) return error.EarlyEof;
        read_total += n;
    }

    try queued.append(alloc, .{ .push = .{ .name = name_copy, .bundle = bundle } });
    try writeAll(client_fd, "OK\n");
    log.info("pushed '{s}' ({d} bytes)", .{ name_copy, bundle_len });

    // Bus event. Peer PID lets us spot the orphan-watcher race we hit
    // earlier — if two different PIDs alternate in the bus log pushing
    // the same cart, that's the failure mode (zombie watchers fighting
    // for the active tab). Without this signal we'd just see the active
    // tab flapping with no clue who's responsible.
    const peer = peerPidOrZero(client_fd);
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

const Ucred = extern struct { pid: i32, uid: u32, gid: u32 };
const SOL_SOCKET: c_int = 1;
const SO_PEERCRED: c_int = 17;
extern fn getsockopt(s: c_int, level: c_int, optname: c_int, optval: ?*anyopaque, optlen: ?*u32) c_int;

fn peerPidOrZero(fd: std.posix.socket_t) i32 {
    var cred: Ucred = .{ .pid = 0, .uid = 0, .gid = 0 };
    var len: u32 = @sizeOf(Ucred);
    if (getsockopt(@as(c_int, @intCast(fd)), SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return 0;
    return cred.pid;
}

/// Pull the next queued dev message. Returns null if the queue is empty.
/// Caller owns the returned message memory.
pub fn takeNext() ?Message {
    if (queued.items.len == 0) return null;
    return queued.orderedRemove(0);
}

fn drainQueue() void {
    while (queued.items.len > 0) {
        const msg = queued.orderedRemove(0);
        switch (msg) {
            .push => |push| {
                alloc.free(push.name);
                alloc.free(push.bundle);
            },
            .notice => |notice| alloc.free(notice.json),
        }
    }
}
