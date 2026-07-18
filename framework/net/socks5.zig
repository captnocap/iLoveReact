//! SOCKS5 proxy client — blocking and async tunnel establishment.
//!
//! Port of love2d/lua/socks5.lua. Supports no-auth and username/password
//! auth (RFC 1928 + RFC 1929). Both blocking and non-blocking modes.
//!
//! Usage (blocking):
//!   const stream = try socks5.connect(io, "127.0.0.1", 9050, "target.onion", 80, null, null);
//!   // stream is now tunneled to target through proxy

const std = @import("std");
const transport = @import("transport.zig");

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
    Socks5HostNameTooLong,
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

fn streamReadAll(reader: *std.Io.net.Stream.Reader, out: []u8) !void {
    reader.interface.readSliceAll(out) catch |err| switch (err) {
        error.EndOfStream => return error.EndOfStream,
        error.ReadFailed => return reader.err orelse error.Unexpected,
    };
}

fn streamWriteAll(stream: std.Io.net.Stream, io: std.Io, bytes: []const u8) !void {
    var writer = stream.writer(io, &.{});
    writer.interface.writeAll(bytes) catch return writer.err orelse error.Unexpected;
    writer.interface.flush() catch return writer.err orelse error.Unexpected;
}

/// Establish a SOCKS5 tunnel through a proxy. Blocks until connected or error.
/// Returns the tunneled stream — reads/writes go through the proxy to the target.
pub fn connect(
    io: std.Io,
    proxy_host: []const u8,
    proxy_port: u16,
    target_host: []const u8,
    target_port: u16,
    user: ?[]const u8,
    pass: ?[]const u8,
) !std.Io.net.Stream {
    // Connect to proxy
    const stream = try transport.connectHost(io, proxy_host, proxy_port);
    errdefer stream.close(io);
    // Empty backing storage prevents read-ahead beyond the exact handshake
    // fields, so returning the raw stream cannot discard tunneled payload.
    var stream_reader = stream.reader(io, &.{});

    // Send greeting
    if (user != null and user.?.len > 0) {
        try streamWriteAll(stream, io, &[_]u8{ 5, 2, 0, 2 }); // version 5, 2 methods: no-auth + user/pass
    } else {
        try streamWriteAll(stream, io, &[_]u8{ 5, 1, 0 }); // version 5, 1 method: no-auth
    }

    // Receive greeting response
    var greeting_resp: [2]u8 = undefined;
    try streamReadAll(&stream_reader, &greeting_resp);
    if (greeting_resp[0] != 5) return Socks5Error.Socks5GreetingFailed;
    if (greeting_resp[1] == 0xFF) return Socks5Error.Socks5AuthRejected;
    if (greeting_resp[1] != 0 and greeting_resp[1] != 0x02) return Socks5Error.Socks5AuthRejected;

    // Username/password auth (RFC 1929)
    if (greeting_resp[1] == 0x02) {
        const u = user orelse return Socks5Error.Socks5AuthFailed;
        const p = pass orelse "";
        if (u.len > 255 or p.len > 255) return Socks5Error.Socks5AuthFailed;
        // Format: [01, ulen, user, plen, pass]
        var auth_buf: [515]u8 = undefined; // 1 + 1 + 255 + 1 + 255 + safety
        auth_buf[0] = 1; // version
        auth_buf[1] = @intCast(u.len);
        @memcpy(auth_buf[2 .. 2 + u.len], u);
        auth_buf[2 + u.len] = @intCast(p.len);
        @memcpy(auth_buf[3 + u.len .. 3 + u.len + p.len], p);
        try streamWriteAll(stream, io, auth_buf[0 .. 3 + u.len + p.len]);

        var auth_resp: [2]u8 = undefined;
        try streamReadAll(&stream_reader, &auth_resp);
        if (auth_resp[0] != 1 or auth_resp[1] != 0) return Socks5Error.Socks5AuthFailed;
    }

    // Send CONNECT request
    // Format: [05, 01, 00, 03, hostlen, host, port_hi, port_lo]
    var req_buf: [262]u8 = undefined; // 4 + 1 + 255 + 2
    req_buf[0] = 5; // version
    req_buf[1] = 1; // CONNECT
    req_buf[2] = 0; // reserved
    req_buf[3] = 3; // domain name address type
    if (target_host.len == 0 or target_host.len > 255) return Socks5Error.Socks5HostNameTooLong;
    const hlen: u8 = @intCast(target_host.len);
    req_buf[4] = hlen;
    @memcpy(req_buf[5 .. 5 + hlen], target_host[0..hlen]);
    req_buf[5 + hlen] = @intCast(target_port >> 8);
    req_buf[6 + hlen] = @intCast(target_port & 0xFF);
    try streamWriteAll(stream, io, req_buf[0 .. 7 + hlen]);

    // Receive CONNECT response
    var conn_resp: [4]u8 = undefined;
    try streamReadAll(&stream_reader, &conn_resp);
    if (conn_resp[0] != 5 or conn_resp[2] != 0) return Socks5Error.Socks5ConnectFailed;
    if (conn_resp[1] != 0) return replyError(conn_resp[1]);

    // Consume bound address (we don't use it but must drain it)
    const addr_type = conn_resp[3];
    if (addr_type == 1) {
        // IPv4: 4 bytes addr + 2 bytes port
        var skip: [6]u8 = undefined;
        try streamReadAll(&stream_reader, &skip);
    } else if (addr_type == 3) {
        // Domain: 1 byte len + domain + 2 bytes port
        var dlen_buf: [1]u8 = undefined;
        try streamReadAll(&stream_reader, &dlen_buf);
        var skip: [257]u8 = undefined;
        try streamReadAll(&stream_reader, skip[0 .. dlen_buf[0] + 2]);
    } else if (addr_type == 4) {
        // IPv6: 16 bytes addr + 2 bytes port
        var skip: [18]u8 = undefined;
        try streamReadAll(&stream_reader, &skip);
    } else return Socks5Error.Socks5AddressTypeNotSupported;

    // Tunnel established — stream is now proxied to target
    return stream;
}

// ── Async note ───────────────────────────────────────────────────────────
// Async SOCKS5 tunneling is handled by the Network Manager (manager.zig)
// which starts an I/O task calling connect() and hands off under a mutex.
// No separate async state machine is needed — the Lua version's complexity
// was due to single-threaded non-blocking I/O, which the injected I/O
// implementation now schedules and cancels.
