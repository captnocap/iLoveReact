//! SOCKS5 proxy client — blocking and async tunnel establishment.
//!
//! Port of love2d/lua/socks5.lua. Supports no-auth and username/password
//! auth (RFC 1928 + RFC 1929). Both blocking and non-blocking modes.
//!
//! Usage (blocking):
//!   const stream = try socks5.connect(alloc, "127.0.0.1", 9050, "target.onion", 80, null, null);
//!   // stream is now tunneled to target through proxy

const std = @import("std");
const netx = @import("netx.zig");

// ── Error codes (RFC 1928 §6) ────────────────────────────────────────────

pub const Socks5Error = error{
    Socks5GreetingFailed,
    Socks5AuthRejected,
    Socks5AuthFailed,
    Socks5ConnectFailed,
    Socks5GeneralFailure,
    Socks5NotAllowed,
    Socks5NetworkUnreachable,
    Socks5HostUnreachable,
    Socks5ConnectionRefused,
    Socks5TtlExpired,
    Socks5CommandNotSupported,
    Socks5AddressTypeNotSupported,
};

fn replyError(code: u8) Socks5Error {
    return switch (code) {
        1 => Socks5Error.Socks5GeneralFailure,
        2 => Socks5Error.Socks5NotAllowed,
        3 => Socks5Error.Socks5NetworkUnreachable,
        4 => Socks5Error.Socks5HostUnreachable,
        5 => Socks5Error.Socks5ConnectionRefused,
        6 => Socks5Error.Socks5TtlExpired,
        7 => Socks5Error.Socks5CommandNotSupported,
        8 => Socks5Error.Socks5AddressTypeNotSupported,
        else => Socks5Error.Socks5GeneralFailure,
    };
}

// ── Blocking connect ─────────────────────────────────────────────────────
// Reference: love2d/lua/socks5.lua:29-90

/// Read exactly `out.len` bytes from a stream, looping over short reads.
/// netx.Stream.read returns 0 on EOF, which we treat as an error.
fn streamReadAll(stream: netx.Stream, out: []u8) !void {
    var got: usize = 0;
    while (got < out.len) {
        const n = try stream.read(out[got..]);
        if (n == 0) return error.EndOfStream;
        got += n;
    }
}

/// Establish a SOCKS5 tunnel through a proxy. Blocks until connected or error.
/// Returns the tunneled stream — reads/writes go through the proxy to the target.
pub fn connect(
    proxy_host: []const u8,
    proxy_port: u16,
    target_host: []const u8,
    target_port: u16,
    user: ?[]const u8,
    pass: ?[]const u8,
) !netx.Stream {
    // Connect to proxy
    const stream = try netx.tcpConnectToHost(std.heap.page_allocator, proxy_host, proxy_port);
    errdefer stream.close();

    // Send greeting
    if (user != null and user.?.len > 0) {
        try stream.writeAll(&[_]u8{ 5, 2, 0, 2 }); // version 5, 2 methods: no-auth + user/pass
    } else {
        try stream.writeAll(&[_]u8{ 5, 1, 0 }); // version 5, 1 method: no-auth
    }

    // Receive greeting response
    var greeting_resp: [2]u8 = undefined;
    try streamReadAll(stream, &greeting_resp);
    if (greeting_resp[0] != 5) return Socks5Error.Socks5GreetingFailed;
    if (greeting_resp[1] == 0xFF) return Socks5Error.Socks5AuthRejected;

    // Username/password auth (RFC 1929)
    if (greeting_resp[1] == 0x02) {
        const u = user orelse return Socks5Error.Socks5AuthFailed;
        const p = pass orelse "";
        // Format: [01, ulen, user, plen, pass]
        var auth_buf: [515]u8 = undefined; // 1 + 1 + 255 + 1 + 255 + safety
        auth_buf[0] = 1; // version
        auth_buf[1] = @intCast(u.len);
        @memcpy(auth_buf[2 .. 2 + u.len], u);
        auth_buf[2 + u.len] = @intCast(p.len);
        @memcpy(auth_buf[3 + u.len .. 3 + u.len + p.len], p);
        try stream.writeAll(auth_buf[0 .. 3 + u.len + p.len]);

        var auth_resp: [2]u8 = undefined;
        try streamReadAll(stream, &auth_resp);
        if (auth_resp[1] != 0) return Socks5Error.Socks5AuthFailed;
    }

    // Send CONNECT request
    // Format: [05, 01, 00, 03, hostlen, host, port_hi, port_lo]
    var req_buf: [262]u8 = undefined; // 4 + 1 + 255 + 2
    req_buf[0] = 5; // version
    req_buf[1] = 1; // CONNECT
    req_buf[2] = 0; // reserved
    req_buf[3] = 3; // domain name address type
    const hlen: u8 = @intCast(@min(target_host.len, 255));
    req_buf[4] = hlen;
    @memcpy(req_buf[5 .. 5 + hlen], target_host[0..hlen]);
    req_buf[5 + hlen] = @intCast(target_port >> 8);
    req_buf[6 + hlen] = @intCast(target_port & 0xFF);
    try stream.writeAll(req_buf[0 .. 7 + hlen]);

    // Receive CONNECT response
    var conn_resp: [4]u8 = undefined;
    try streamReadAll(stream, &conn_resp);
    if (conn_resp[1] != 0) return replyError(conn_resp[1]);

    // Consume bound address (we don't use it but must drain it)
    const addr_type = conn_resp[3];
    if (addr_type == 1) {
        // IPv4: 4 bytes addr + 2 bytes port
        var skip: [6]u8 = undefined;
        try streamReadAll(stream, &skip);
    } else if (addr_type == 3) {
        // Domain: 1 byte len + domain + 2 bytes port
        var dlen_buf: [1]u8 = undefined;
        try streamReadAll(stream, &dlen_buf);
        var skip: [257]u8 = undefined;
        try streamReadAll(stream, skip[0 .. dlen_buf[0] + 2]);
    } else if (addr_type == 4) {
        // IPv6: 16 bytes addr + 2 bytes port
        var skip: [18]u8 = undefined;
        try streamReadAll(stream, &skip);
    }

    // Tunnel established — stream is now proxied to target
    return stream;
}

// ── Async note ───────────────────────────────────────────────────────────
// Async SOCKS5 tunneling is handled by the Network Manager (manager.zig)
// which spawns a thread calling connect() and hands off via atomic flag.
// No separate async state machine is needed — the Lua version's complexity
// was due to single-threaded non-blocking I/O, which Zig threads replace.
