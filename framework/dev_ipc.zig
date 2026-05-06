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
//!
//! The server acks with a single "OK\n" or "ERR <reason>\n" line.
//!
//! Polling model: the main loop calls `pollOnce()` each frame. This accepts
//! a waiting connection if any and parses at most one message per poll.
//! Pushes are queued for the application layer to handle between frames.

const std = @import("std");
const event_bus = @import("event_bus.zig");
const qjs_runtime = @import("qjs_runtime.zig");
const telemetry = @import("telemetry.zig");
const log = std.log.scoped(.dev_ipc);

pub const SOCKET_PATH = "/tmp/reactjit.sock";

pub const PushMessage = struct {
    name: []u8, // heap-allocated, owned by the caller after take()
    bundle: []u8, // ditto
};

var listen_fd: ?std.posix.socket_t = null;
var queued: std.ArrayList(PushMessage) = .{};
var alloc: std.mem.Allocator = std.heap.page_allocator;

/// Install the allocator used for push-message buffers. Must be called
/// BEFORE start() so bundle bytes are freed by the same allocator that
/// qjs_app.zig uses when upserting a tab. Using the wrong allocator here
/// is a silent UB/crash — don't skip this.
pub fn setAllocator(a: std.mem.Allocator) void {
    alloc = a;
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

    var addr: std.posix.sockaddr.un = .{ .family = std.posix.AF.UNIX, .path = [_]u8{0} ** 108 };
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

    // Parse: "PUSH <name> <length>" or "TELEMETRY"
    var it = std.mem.tokenizeScalar(u8, header, ' ');
    const verb = it.next() orelse return error.BadHeader;

    if (std.mem.eql(u8, verb, "TELEMETRY")) {
        // One-shot snapshot of the live telemetry counters. JSON line +
        // close. Used by tools/devshell to render fps/nodes/paint/layout
        // in its title bar at ~4Hz.
        const snap = telemetry.current;
        var buf: [320]u8 = undefined;
        const json = std.fmt.bufPrint(
            &buf,
            "{{\"fps\":{d},\"layout_us\":{d},\"paint_us\":{d},\"frame_total_us\":{d},\"frame_number\":{d},\"node_count\":{d}}}\n",
            .{
                qjs_runtime.telemetry_fps,
                qjs_runtime.telemetry_layout_us,
                qjs_runtime.telemetry_paint_us,
                snap.frame_total_us,
                snap.frame_number,
                telemetry.nodeCount(),
            },
        ) catch "{}\n";
        try writeAll(client_fd, json);
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

    try queued.append(alloc, .{ .name = name_copy, .bundle = bundle });
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

fn writeAll(fd: std.posix.socket_t, data: []const u8) !void {
    var written: usize = 0;
    while (written < data.len) {
        const n = try std.posix.write(fd, data[written..]);
        if (n == 0) return error.EarlyEof;
        written += n;
    }
}

/// Pull the next queued push message. Returns null if the queue is empty.
/// Caller owns the returned memory — free both `.name` and `.bundle`.
pub fn takeNext() ?PushMessage {
    if (queued.items.len == 0) return null;
    return queued.orderedRemove(0);
}

fn drainQueue() void {
    while (queued.items.len > 0) {
        const msg = queued.orderedRemove(0);
        alloc.free(msg.name);
        alloc.free(msg.bundle);
    }
}
