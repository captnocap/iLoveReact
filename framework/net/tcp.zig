//! Raw TCP client — non-blocking, byte-stream.
//!
//! Used by anything that needs plain TCP without HTTP/WS framing (RCON,
//! arbitrary protocols). Outbound only for now (no inbound listener; that's
//! what httpserver / wsserver are for).
//!
//! Usage:
//!   var c = try tcp.connect("127.0.0.1", 27015);
//!   c.send("hello");
//!   var ev_buf: [4]tcp.Event = undefined;
//!   const n = c.update(&ev_buf);
//!   for (ev_buf[0..n]) |ev| switch (ev) {
//!       .data => |bytes| ...,
//!       .closed => {},
//!       .err => |msg| ...,
//!   };
//!   c.close();

const std = @import("std");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const sysx = @import("sysx.zig");

const READ_BUF = 65536;

pub const EventTag = enum { data, closed, err };

pub const Event = union(EventTag) {
    data: []const u8,
    closed: void,
    err: []const u8,
};

pub const TcpClient = struct {
    stream: std.net.Stream,
    closed: bool = false,
    read_buf: [READ_BUF]u8 = undefined,
    err_buf: [128]u8 = undefined,

    pub fn connect(host: []const u8, port: u16) !TcpClient {
        const stream = try std.net.tcpConnectToHost(std.heap.c_allocator, host, port);
        // Non-blocking so update() can be called every frame without stalling.
        _ = sysx.fcntl(stream.handle, sysx.F.SETFL, sysx.SOCK.NONBLOCK) catch 0;
        return .{ .stream = stream };
    }

    /// Wrap an already-connected stream (e.g. one returned by socks5.connect).
    /// Used by the `via:` dispatch path so a tunneled connection is a TcpClient
    /// just like a plain one — same drain loop, same events.
    pub fn fromStream(stream: std.net.Stream) TcpClient {
        _ = sysx.fcntl(stream.handle, sysx.F.SETFL, sysx.SOCK.NONBLOCK) catch 0;
        return .{ .stream = stream };
    }

    pub fn send(self: *TcpClient, data: []const u8) void {
        if (self.closed) return;
        self.stream.writeAll(data) catch {
            self.closed = true;
        };
    }

    pub fn close(self: *TcpClient) void {
        if (self.closed) return;
        self.closed = true;
        self.stream.close();
    }

    /// Non-blocking poll. Reads up to one chunk into read_buf and returns
    /// at most one event so callers don't see stale slices when looping.
    /// Re-call until it returns 0 to fully drain.
    pub fn update(self: *TcpClient, out: []Event) usize {
        if (self.closed or out.len == 0) return 0;
        const n = self.stream.read(&self.read_buf) catch |err| {
            if (err == error.WouldBlock) return 0;
            const msg = std.fmt.bufPrint(&self.err_buf, "read: {s}", .{@errorName(err)}) catch "read error";
            out[0] = .{ .err = msg };
            self.close();
            return 1;
        };
        if (n == 0) {
            out[0] = .closed;
            self.close();
            return 1;
        }
        out[0] = .{ .data = self.read_buf[0..n] };
        return 1;
    }
};
