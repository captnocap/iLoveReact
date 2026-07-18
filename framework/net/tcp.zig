//! TCP client backed by Zig 0.16's explicit-Io network stream.
//!
//! Used by anything that needs plain TCP without HTTP/WS framing (RCON,
//! arbitrary protocols). Outbound only for now (no inbound listener; that's
//! what httpserver / wsserver are for).
//!
//! Usage:
//!   var c = try tcp.TcpClient.connect(allocator, io, "127.0.0.1", 27015);
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
const transport = @import("transport.zig");

const READ_BUF = 65536;

pub const EventTag = enum { data, closed, err };

pub const Event = union(EventTag) {
    data: []const u8,
    closed: void,
    err: []const u8,
};

pub const TcpClient = struct {
    pump: transport.StreamPump,
    closed: bool = false,
    read_buf: [READ_BUF]u8 = undefined,
    err_buf: [128]u8 = undefined,

    pub fn connect(allocator: std.mem.Allocator, io: std.Io, host: []const u8, port: u16) !TcpClient {
        const stream = try transport.connectHost(io, host, port);
        errdefer stream.close(io);
        return .{ .pump = try .init(allocator, io, stream) };
    }

    /// Wrap an already-connected stream (e.g. one returned by socks5.connect).
    /// Used by the `via:` dispatch path so a tunneled connection is a TcpClient
    /// just like a plain one — same drain loop, same events.
    pub fn fromStream(allocator: std.mem.Allocator, io: std.Io, stream: std.Io.net.Stream) !TcpClient {
        errdefer stream.close(io);
        return .{ .pump = try .init(allocator, io, stream) };
    }

    pub fn send(self: *TcpClient, data: []const u8) void {
        if (self.closed) return;
        self.pump.send(data) catch self.close();
    }

    pub fn close(self: *TcpClient) void {
        if (self.closed) return;
        self.closed = true;
        self.pump.deinit();
    }

    /// Non-blocking poll. Reads up to one chunk into read_buf and returns
    /// at most one event so callers don't see stale slices when looping.
    /// Re-call until it returns 0 to fully drain.
    pub fn update(self: *TcpClient, out: []Event) usize {
        if (self.closed or out.len == 0) return 0;
        switch (self.pump.drain(&self.read_buf)) {
            .empty => return 0,
            .data => |n| out[0] = .{ .data = self.read_buf[0..n] },
            .closed => {
                out[0] = .closed;
                self.close();
            },
            .failed => |err| {
                const msg = std.fmt.bufPrint(&self.err_buf, "read: {s}", .{@errorName(err)}) catch "read error";
                out[0] = .{ .err = msg };
                self.close();
            },
        }
        return 1;
    }
};
