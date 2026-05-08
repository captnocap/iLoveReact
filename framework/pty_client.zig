//! PTY Remote Client — connects to supervisor.sock for terminal remote control.
//!
//! Provides QuickJS host functions for .tsz carts to communicate with the
//! pty_remote server over a unix socket using NDJSON.
//!
//! JS API:
//!   pty_client_connect()     → 1 on success, 0 on failure
//!   pty_client_disconnect()  → void
//!   pty_client_connected()   → 1 or 0
//!   pty_client_send(json)    → response JSON string (blocking, local socket)

const std = @import("std");
const log = @import("log.zig");
const posix = std.posix;

const build_options = @import("build_options");
const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;

const qjs = if (HAS_QUICKJS) @cImport({
    @cDefine("_GNU_SOURCE", "1");
    @cDefine("QUICKJS_NG_BUILD", "1");
    @cInclude("quickjs.h");
}) else struct {
    pub const JSContext = opaque {};
    pub const JSValue = extern struct { tag: i64 = 3, u: extern union { int32: i32, float64: f64, ptr: ?*anyopaque } = .{ .int32 = 0 } };
};

const QJS_UNDEFINED = qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = 3 };

// ── State ──────────────────────────────────────────────────────────

var g_fd: ?posix.fd_t = null;
var g_recv_buf: [64 * 1024]u8 = undefined;

// ── Core operations ────────────────────────────────────────────────

pub fn connect() bool {
    if (g_fd != null) return true; // already connected

    // Build socket path
    const uid = std.os.linux.getuid();
    var path_buf: [256]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "/run/user/{d}/claude-sessions/supervisor.sock", .{uid}) catch return false;
    path_buf[path.len] = 0;

    // Create socket (blocking — local unix sockets are sub-millisecond)
    const fd = posix.socket(posix.AF.UNIX, posix.SOCK.STREAM | posix.SOCK.CLOEXEC, 0) catch |err| {
        log.print("[pty_client] socket failed: {}\n", .{err});
        return false;
    };

    // Connect
    var addr: posix.sockaddr.un = .{ .family = posix.AF.UNIX, .path = undefined };
    @memset(&addr.path, 0);
    @memcpy(addr.path[0..path.len], path_buf[0..path.len]);

    // Use exact address length (family + path + null terminator)
    const addr_len: u32 = @intCast(@offsetOf(posix.sockaddr.un, "path") + path.len + 1);
    log.print("[pty_client] connecting to {s} (addr_len={d})\n", .{ path, addr_len });
    posix.connect(fd, @ptrCast(&addr), addr_len) catch |err| {
        log.print("[pty_client] connect failed: {}\n", .{err});
        posix.close(fd);
        return false;
    };

    // Set receive timeout (100ms — generous for local socket)
    const timeout = posix.timeval{ .sec = 0, .usec = 100_000 };
    posix.setsockopt(fd, posix.SOL.SOCKET, posix.SO.RCVTIMEO, std.mem.asBytes(&timeout)) catch {};

    g_fd = fd;
    log.print("[pty_client] connected to {s}\n", .{path});
    return true;
}

pub fn disconnect() void {
    if (g_fd) |fd| {
        posix.close(fd);
        g_fd = null;
        log.print("[pty_client] disconnected\n", .{});
    }
}

pub fn connected() bool {
    return g_fd != null;
}

/// Send an NDJSON command and receive the response line.
/// Returns the response JSON (without trailing newline), or empty on error.
pub fn send(cmd: []const u8) []const u8 {
    const fd = g_fd orelse return "";

    // Send command + newline
    _ = posix.write(fd, cmd) catch |err| {
        log.print("[pty_client] write failed: {}\n", .{err});
        disconnect();
        return "";
    };
    // Ensure trailing newline
    if (cmd.len == 0 or cmd[cmd.len - 1] != '\n') {
        _ = posix.write(fd, "\n") catch {};
    }

    // Read response (blocking with timeout)
    var total: usize = 0;
    while (total < g_recv_buf.len - 1) {
        const n = posix.read(fd, g_recv_buf[total..]) catch |err| {
            if (err == error.WouldBlock) break; // timeout
            log.print("[pty_client] read failed: {}\n", .{err});
            disconnect();
            return "";
        };
        if (n == 0) {
            disconnect();
            return "";
        } // EOF
        total += n;
        // Check for complete line
        if (std.mem.indexOf(u8, g_recv_buf[0..total], "\n") != null) break;
    }

    // Strip trailing newline
    var end = total;
    while (end > 0 and (g_recv_buf[end - 1] == '\n' or g_recv_buf[end - 1] == '\r')) end -= 1;
    return g_recv_buf[0..end];
}

// ── QuickJS host functions ─────────────────────────────────────────

fn hostConnect(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (connect()) 1 else 0);
}

fn hostDisconnect(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    disconnect();
    return QJS_UNDEFINED;
}

fn hostConnected(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (connected()) 1 else 0);
}

fn hostSend(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewString(ctx, "");
    const c_str = qjs.JS_ToCString(ctx, argv[0]);
    if (c_str == null) return qjs.JS_NewString(ctx, "");
    defer qjs.JS_FreeCString(ctx, c_str);

    const cmd: [*:0]const u8 = c_str;
    const len = std.mem.len(cmd);
    const resp = send(cmd[0..len]);
    return qjs.JS_NewStringLen(ctx, resp.ptr, @intCast(resp.len));
}

