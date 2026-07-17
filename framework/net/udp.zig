//! UDP socket — non-blocking, datagram.
//!
//! Used for connectionless protocols (Valve A2S Source-Query, DNS, custom
//! game protocols). The socket can either be connected to a single peer
//! (sendto-implicit, recvfrom-filtered) or used in unconnected mode.
//!
//! Usage:
//!   var u = try udp.openConnected("127.0.0.1", 27015);
//!   u.send(query_packet);
//!   var ev_buf: [4]udp.Event = undefined;
//!   const n = u.update(&ev_buf);
//!   for (ev_buf[0..n]) |ev| switch (ev) {
//!       .packet => |bytes| ...,
//!       .err => |msg| ...,
//!   };
//!   u.close();

const std = @import("std");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const sysx = @import("sysx.zig");

const READ_BUF = 65536;

pub const EventTag = enum { packet, err };

pub const Event = union(EventTag) {
    packet: []const u8,
    err: []const u8,
};

pub const UdpSocket = struct {
    fd: sysx.socket_t,
    closed: bool = false,
    read_buf: [READ_BUF]u8 = undefined,
    err_buf: [128]u8 = undefined,

    /// Open + connect a UDP socket so subsequent send/recv go to/from this peer.
    pub fn openConnected(host: []const u8, port: u16) !UdpSocket {
        const list = try std.net.getAddressList(std.heap.c_allocator, host, port);
        defer list.deinit();
        if (list.addrs.len == 0) return error.UnknownHost;
        const addr = list.addrs[0];

        const fd = try sysx.socket(addr.any.family, sysx.SOCK.DGRAM | sysx.SOCK.NONBLOCK, 0);
        errdefer sysx.close(fd);
        try sysx.connect(fd, &addr.any, addr.getOsSockLen());
        return .{ .fd = fd };
    }

    pub fn send(self: *UdpSocket, data: []const u8) void {
        if (self.closed) return;
        _ = sysx.send(self.fd, data, 0) catch {};
    }

    pub fn close(self: *UdpSocket) void {
        if (self.closed) return;
        self.closed = true;
        sysx.close(self.fd);
    }

    /// Non-blocking poll. Returns at most one packet per call to keep the
    /// `read_buf` slice valid; loop on it to drain.
    pub fn update(self: *UdpSocket, out: []Event) usize {
        if (self.closed or out.len == 0) return 0;
        const n = sysx.recv(self.fd, &self.read_buf, 0) catch |err| {
            if (err == error.WouldBlock) return 0;
            const msg = std.fmt.bufPrint(&self.err_buf, "recv: {s}", .{@errorName(err)}) catch "recv error";
            out[0] = .{ .err = msg };
            return 1;
        };
        if (n == 0) return 0;
        out[0] = .{ .packet = self.read_buf[0..n] };
        return 1;
    }
};
