//! WebSocket client — pure Zig RFC 6455 implementation.
//!
//! Port of love2d/lua/websocket.lua. Non-blocking update() for poll-based
//! architecture. No external dependencies.
//!
//! Usage:
//!   var ws = try websocket.connect(alloc, "echo.websocket.org", 80, "/");
//!   try ws.send("hello");
//!   // each frame:
//!   if (ws.update()) |event| {
//!       switch (event) {
//!           .message => |msg| { ... },
//!           .open => { ... },
//!           .close => { ... },
//!           .err => |e| { ... },
//!       }
//!   }

const std = @import("std");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const sysx = @import("sysx.zig");

// ── Constants ────────────────────────────────────────────────────────────

const MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB515859764";

const Opcode = enum(u4) {
    continuation = 0,
    text = 1,
    binary = 2,
    close = 8,
    ping = 9,
    pong = 10,
    _,
};

pub const Status = enum {
    connecting, // TCP connected, waiting for HTTP upgrade response
    open, // upgrade complete, frames flowing
    closing, // close frame sent, waiting for reply
    closed, // done
};

// ── Public types ─────────────────────────────────────────────────────────

pub const Event = union(enum) {
    open: void,
    message: []const u8,
    close: struct { code: u16, reason: []const u8 },
    err: []const u8,
};

const MAX_MSG = 65536;
const MAX_FRAME_HDR = 14; // 2 + 8 + 4 (max header + mask)

// ── WebSocket ────────────────────────────────────────────────────────────

pub const WebSocket = struct {
    stream: std.net.Stream,
    status: Status,
    read_buf: [MAX_MSG]u8 = undefined,
    read_len: usize = 0,
    msg_buf: [MAX_MSG]u8 = undefined,
    msg_len: usize = 0,
    continuation_buf: [MAX_MSG]u8 = undefined,
    continuation_len: usize = 0,
    upgrade_buf: [4096]u8 = undefined,
    upgrade_len: usize = 0,

    /// Connect to a WebSocket server. Sends the HTTP upgrade request.
    /// Call update() each frame to complete the handshake and receive messages.
    pub fn init(stream: std.net.Stream, host: []const u8, port: u16, path: []const u8) !WebSocket {
        const ws = WebSocket{
            .stream = stream,
            .status = .connecting,
        };

        // Generate Sec-WebSocket-Key (fixed key is fine for non-security purposes)
        const sec_key = "dGhlIHNhbXBsZSBub25jZQ==";

        // Send HTTP upgrade request
        var writer_buf: [4096]u8 = undefined;
        var stream_writer = stream.writer(&writer_buf);
        const writer = &stream_writer.interface;
        try writer.print(
            "GET {s} HTTP/1.1\r\n" ++
                "Host: {s}:{d}\r\n" ++
                "Connection: Upgrade\r\n" ++
                "Upgrade: websocket\r\n" ++
                "Sec-WebSocket-Version: 13\r\n" ++
                "Sec-WebSocket-Key: {s}\r\n\r\n",
            .{ path, host, port, sec_key },
        );
        try writer.flush();

        // Set socket to non-blocking for update() polling
        setNonBlocking(stream);

        return ws;
    }

    /// Connect to a WebSocket server via TCP.
    pub fn connectTcp(host: []const u8, port: u16, path: []const u8) !WebSocket {
        const stream = try std.net.tcpConnectToHost(std.heap.page_allocator, host, port);
        errdefer stream.close(); // don't leak on init failure
        return try init(stream, host, port, path);
    }

    /// Connect via an already-established stream (e.g., SOCKS5 tunnel).
    pub fn connectViaStream(stream: std.net.Stream, host: []const u8, port: u16, path: []const u8) !WebSocket {
        return try init(stream, host, port, path);
    }

    /// Non-blocking poll. Call once per frame.
    /// Returns an event if one is ready, null if nothing to do.
    pub fn update(self: *WebSocket) ?Event {
        switch (self.status) {
            .connecting => return self.handleUpgrade(),
            .open, .closing => return self.handleFrames(),
            .closed => return null,
        }
    }

    /// Send a text message.
    pub fn send(self: *WebSocket, message: []const u8) !void {
        if (self.status != .open) return;
        try self.writeFrame(.text, message);
    }

    /// Send a ping.
    pub fn ping(self: *WebSocket, message: []const u8) !void {
        if (self.status != .open) return;
        try self.writeFrame(.ping, message);
    }

    /// Initiate close handshake.
    pub fn close(self: *WebSocket) void {
        if (self.status != .open) return;
        self.writeFrame(.close, "") catch {};
        self.status = .closing;
    }

    /// Hard close — shutdown immediately.
    pub fn shutdown(self: *WebSocket) void {
        self.stream.close();
        self.status = .closed;
    }

    // ── Internal: HTTP upgrade ───────────────────────────────────────

    fn handleUpgrade(self: *WebSocket) ?Event {
        // Try to read more of the HTTP response
        const n = self.stream.read(self.upgrade_buf[self.upgrade_len..]) catch |err| {
            if (err == error.WouldBlock) return null;
            self.stream.close();
            self.status = .closed;
            return .{ .err = "upgrade read failed" };
        };
        if (n == 0) {
            self.stream.close();
            self.status = .closed;
            return .{ .err = "connection closed during upgrade" };
        }
        self.upgrade_len += n;

        // Look for end of HTTP headers (\r\n\r\n)
        const headers = self.upgrade_buf[0..self.upgrade_len];
        if (std.mem.indexOf(u8, headers, "\r\n\r\n")) |end_pos| {
            // Check for "101" status
            const first_line = if (std.mem.indexOf(u8, headers[0..@min(end_pos, 100)], "\r\n")) |nl|
                headers[0..nl]
            else
                headers[0..@min(end_pos, 100)];

            if (std.mem.indexOf(u8, first_line, "101") == null) {
                self.stream.close();
                self.status = .closed;
                return .{ .err = "upgrade rejected (not 101)" };
            }

            // Move any data after headers into read_buf (could be start of a frame)
            const remaining = self.upgrade_len - (end_pos + 4);
            if (remaining > 0) {
                @memcpy(self.read_buf[0..remaining], self.upgrade_buf[end_pos + 4 .. self.upgrade_len]);
                self.read_len = remaining;
            }

            self.status = .open;
            return .{ .open = {} };
        }

        return null; // still waiting for headers
    }

    // ── Internal: frame reading ──────────────────────────────────────

    fn handleFrames(self: *WebSocket) ?Event {
        // Try to read more data
        if (self.read_len < MAX_MSG) {
            const n = self.stream.read(self.read_buf[self.read_len..]) catch |err| {
                if (err == error.WouldBlock) {
                    // No data available — check if we have buffered data to process
                    if (self.read_len >= 2) return self.tryParseFrame();
                    return null;
                }
                self.stream.close();
                self.status = .closed;
                return .{ .err = "read failed" };
            };
            if (n == 0) {
                self.stream.close();
                self.status = .closed;
                return .{ .close = .{ .code = 1006, .reason = "connection lost" } };
            }
            self.read_len += n;
        }

        return self.tryParseFrame();
    }

    fn tryParseFrame(self: *WebSocket) ?Event {
        if (self.read_len < 2) return null;

        const byte0 = self.read_buf[0];
        const byte1 = self.read_buf[1];
        const fin = (byte0 & 0x80) != 0;
        const opcode: Opcode = @enumFromInt(byte0 & 0x0F);
        const masked = (byte1 & 0x80) != 0;
        var payload_len: u64 = byte1 & 0x7F;
        var header_len: usize = 2;

        // Extended length
        if (payload_len == 126) {
            if (self.read_len < 4) return null;
            payload_len = (@as(u64, self.read_buf[2]) << 8) | self.read_buf[3];
            header_len = 4;
        } else if (payload_len == 127) {
            if (self.read_len < 10) return null;
            payload_len = 0;
            for (2..10) |i| {
                payload_len = (payload_len << 8) | self.read_buf[i];
            }
            header_len = 10;
        }

        // Mask key (server→client frames should be unmasked, but handle both)
        var mask_key: [4]u8 = .{ 0, 0, 0, 0 };
        if (masked) {
            if (self.read_len < header_len + 4) return null;
            @memcpy(&mask_key, self.read_buf[header_len .. header_len + 4]);
            header_len += 4;
        }

        const total_len = header_len + @as(usize, @intCast(@min(payload_len, MAX_MSG)));
        if (self.read_len < total_len) return null;

        // Extract payload
        const plen: usize = @intCast(@min(payload_len, MAX_MSG));
        @memcpy(self.msg_buf[0..plen], self.read_buf[header_len .. header_len + plen]);

        // Unmask if needed
        if (masked) {
            for (0..plen) |i| {
                self.msg_buf[i] ^= mask_key[i % 4];
            }
        }
        self.msg_len = plen;

        // Consume from read buffer
        const consumed = header_len + plen;
        const remaining = self.read_len - consumed;
        if (remaining > 0) {
            std.mem.copyForwards(u8, self.read_buf[0..remaining], self.read_buf[consumed..self.read_len]);
        }
        self.read_len = remaining;

        // Handle by opcode
        return switch (opcode) {
            .text, .binary => blk: {
                if (fin) {
                    if (self.continuation_len > 0) {
                        // Final fragment of a continued message
                        const total = self.continuation_len + plen;
                        if (total <= MAX_MSG) {
                            @memcpy(self.continuation_buf[self.continuation_len .. self.continuation_len + plen], self.msg_buf[0..plen]);
                            self.continuation_len = 0;
                            break :blk Event{ .message = self.continuation_buf[0..total] };
                        }
                    }
                    break :blk Event{ .message = self.msg_buf[0..plen] };
                } else {
                    // Start of fragmented message
                    @memcpy(self.continuation_buf[0..plen], self.msg_buf[0..plen]);
                    self.continuation_len = plen;
                    break :blk null;
                }
            },
            .continuation => blk: {
                const space = MAX_MSG - self.continuation_len;
                const to_copy = @min(plen, space);
                @memcpy(self.continuation_buf[self.continuation_len .. self.continuation_len + to_copy], self.msg_buf[0..to_copy]);
                self.continuation_len += to_copy;
                if (fin) {
                    const total = self.continuation_len;
                    self.continuation_len = 0;
                    break :blk Event{ .message = self.continuation_buf[0..total] };
                }
                break :blk null;
            },
            .close => blk: {
                var code: u16 = 1005;
                var reason: []const u8 = "";
                if (plen >= 2) {
                    code = (@as(u16, self.msg_buf[0]) << 8) | self.msg_buf[1];
                    if (plen > 2) reason = self.msg_buf[2..plen];
                }
                self.stream.close();
                self.status = .closed;
                break :blk Event{ .close = .{ .code = code, .reason = reason } };
            },
            .ping => blk: {
                // Auto-respond with pong
                self.writeFrame(.pong, self.msg_buf[0..plen]) catch {};
                break :blk null; // don't surface pings to caller
            },
            .pong => null,
            _ => null,
        };
    }

    // ── Internal: frame writing ──────────────────────────────────────

    fn writeFrame(self: *WebSocket, opcode: Opcode, payload: []const u8) !void {
        var writer_buf: [4096]u8 = undefined;
        var stream_writer = self.stream.writer(&writer_buf);
        const writer = &stream_writer.interface;

        // FIN + opcode
        try writer.writeByte(0x80 | @as(u8, @intFromEnum(opcode)));

        // Length + mask bit (client→server must be masked)
        const mask_bit: u8 = 0x80;
        if (payload.len > 65535) {
            try writer.writeByte(mask_bit | 127);
            var len_bytes: [8]u8 = undefined;
            std.mem.writeInt(u64, &len_bytes, payload.len, .big);
            try writer.writeAll(&len_bytes);
        } else if (payload.len > 125) {
            try writer.writeByte(mask_bit | 126);
            var len_bytes: [2]u8 = undefined;
            std.mem.writeInt(u16, &len_bytes, @intCast(payload.len), .big);
            try writer.writeAll(&len_bytes);
        } else {
            try writer.writeByte(mask_bit | @as(u8, @intCast(payload.len)));
        }

        // Mask key (fixed — security isn't the goal here)
        const mask_key = [_]u8{ 0x12, 0x34, 0x56, 0x78 };
        try writer.writeAll(&mask_key);

        // Masked payload
        var masked: [MAX_MSG]u8 = undefined;
        const len = @min(payload.len, MAX_MSG);
        for (0..len) |i| {
            masked[i] = payload[i] ^ mask_key[i % 4];
        }
        try writer.writeAll(masked[0..len]);
        try writer.flush();
    }
};

// ── Helper: set socket non-blocking ──────────────────────────────────────

fn setNonBlocking(stream: std.net.Stream) void {
    const fd = stream.handle;
    const flags = sysx.fcntl(fd, sysx.F.GETFL, 0) catch return;
    _ = sysx.fcntl(fd, sysx.F.SETFL, flags | sysx.SOCK.NONBLOCK) catch {};
}
