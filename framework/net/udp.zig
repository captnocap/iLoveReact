//! UDP socket backed by Zig 0.16's explicit-Io datagram API.
//!
//! Used for connectionless protocols (Valve A2S Source-Query, DNS, custom
//! game protocols). The socket can either be connected to a single peer
//! (sendto-implicit, recvfrom-filtered) or used in unconnected mode.
//!
//! Usage:
//!   var u = try udp.UdpSocket.openConnected(allocator, io, "127.0.0.1", 27015);
//!   u.send(query_packet);
//!   var ev_buf: [4]udp.Event = undefined;
//!   const n = u.update(&ev_buf);
//!   for (ev_buf[0..n]) |ev| switch (ev) {
//!       .packet => |bytes| ...,
//!       .err => |msg| ...,
//!   };
//!   u.close();

const std = @import("std");
const transport = @import("transport.zig");

const READ_BUF = 65536;

pub const EventTag = enum { packet, err };

pub const Event = union(EventTag) {
    packet: []const u8,
    err: []const u8,
};

pub const UdpSocket = struct {
    pump: transport.DatagramPump,
    closed: bool = false,
    read_buf: [READ_BUF]u8 = undefined,
    err_buf: [128]u8 = undefined,

    /// Open + connect a UDP socket so subsequent send/recv go to/from this peer.
    pub fn openConnected(allocator: std.mem.Allocator, io: std.Io, host: []const u8, port: u16) !UdpSocket {
        const peer = try transport.resolveHost(io, host, port);
        return .{ .pump = try .connect(allocator, io, peer) };
    }

    pub fn send(self: *UdpSocket, data: []const u8) void {
        if (self.closed) return;
        self.pump.send(data) catch {};
    }

    pub fn close(self: *UdpSocket) void {
        if (self.closed) return;
        self.closed = true;
        self.pump.deinit();
    }

    /// Non-blocking poll. Returns at most one packet per call to keep the
    /// `read_buf` slice valid; loop on it to drain.
    pub fn update(self: *UdpSocket, out: []Event) usize {
        if (self.closed or out.len == 0) return 0;
        switch (self.pump.receive(&self.read_buf)) {
            .empty => return 0,
            .packet => |n| out[0] = .{ .packet = self.read_buf[0..n] },
            .failed => |err| {
                const msg = std.fmt.bufPrint(&self.err_buf, "recv: {s}", .{@errorName(err)}) catch "recv error";
                out[0] = .{ .err = msg };
            },
        }
        return 1;
    }
};
