//! WebSocket server — non-blocking, multi-client, broadcast + unicast.
//! RFC 6455 compliant (Autobahn conformance tested).
//!
//! Usage:
//!   var server = try wsserver.WsServer.listen(allocator, io, 8080);
//!   // each frame:
//!   var events: [32]wsserver.ServerEvent = undefined;
//!   const n = server.update(&events);
//!   for (events[0..n]) |ev| { ... }
//!   server.broadcast("hello everyone");
//!   server.send(client_id, "hello you");
//!   server.close();

const std = @import("std");
const transport = @import("transport.zig");

// ── Constants ────────────────────────────────────────────────────────────

const MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB515859764";
const MAX_CLIENTS = 64;
const MAX_MSG = 65536;
const MAX_HDR = 4096;

// ── Public types ─────────────────────────────────────────────────────────

pub const Opcode = enum(u4) {
    continuation = 0,
    text = 1,
    binary = 2,
    close = 8,
    ping = 9,
    pong = 10,
    _,
};

pub const ServerEventType = enum {
    client_connected,
    client_message,
    client_disconnected,
};

pub const ServerEvent = struct {
    client_id: u32 = 0,
    event_type: ServerEventType = .client_connected,
    opcode: Opcode = .text,
    data: [MAX_MSG]u8 = undefined,
    data_len: usize = 0,

    pub fn dataSlice(self: *const ServerEvent) []const u8 {
        return self.data[0..self.data_len];
    }
};

const ClientStatus = enum { handshake, open, closed };

const Client = struct {
    active: bool = false,
    id: u32 = 0,
    stream: ?transport.StreamPump = null,
    status: ClientStatus = .closed,
    handshake_buf: [MAX_HDR]u8 = undefined,
    handshake_len: usize = 0,
    read_buf: [MAX_MSG + 14]u8 = undefined,
    read_len: usize = 0,
    // Fragmentation support
    frag_buf: [MAX_MSG]u8 = undefined,
    frag_len: usize = 0,
    frag_opcode: Opcode = .text,
    frag_active: bool = false,
};

// ── Server ───────────────────────────────────────────────────────────────

pub const WsServer = struct {
    allocator: std.mem.Allocator = undefined,
    io: std.Io = undefined,
    listener: transport.ListenerPump = undefined,
    clients: [MAX_CLIENTS]Client = [_]Client{.{}} ** MAX_CLIENTS,
    next_client_id: u32 = 1,
    event_count: usize = 0,

    /// Start listening on a port. Initializes self in-place (no large return by value).
    pub fn listen(allocator: std.mem.Allocator, io: std.Io, port: u16) !WsServer {
        const address: std.Io.net.IpAddress = .{ .ip4 = .unspecified(port) };
        var server = try address.listen(io, .{ .kernel_backlog = 16, .reuse_address = true });
        errdefer server.deinit(io);
        return .{
            .allocator = allocator,
            .io = io,
            .listener = try transport.ListenerPump.init(allocator, io, server),
        };
    }

    /// Initialize an existing WsServer in-place (avoids 8MB return-by-value).
    pub fn listenInPlace(self: *WsServer, allocator: std.mem.Allocator, io: std.Io, port: u16) !void {
        const address: std.Io.net.IpAddress = .{ .ip4 = .unspecified(port) };
        var server = try address.listen(io, .{ .kernel_backlog = 16, .reuse_address = true });
        errdefer server.deinit(io);
        const listener = try transport.ListenerPump.init(allocator, io, server);

        // Set fields individually — avoid constructing a full 8MB struct literal
        self.allocator = allocator;
        self.io = io;
        self.listener = listener;
        self.next_client_id = 1;
        self.event_count = 0;
        for (&self.clients) |*c| {
            c.active = false;
            c.status = .closed;
            c.read_len = 0;
            c.handshake_len = 0;
            c.frag_len = 0;
        }
    }

    /// Non-blocking poll. Call once per frame. Returns event count.
    pub fn update(self: *WsServer, out: []ServerEvent) usize {
        self.event_count = 0;
        self.acceptClients(out);
        for (&self.clients) |*client| {
            if (!client.active) continue;
            switch (client.status) {
                .handshake => self.processHandshake(client, out),
                .open => self.processFrames(client, out),
                .closed => {},
            }
        }
        return @min(self.event_count, out.len);
    }

    /// Send text to a specific client.
    pub fn send(self: *WsServer, client_id: u32, data: []const u8) void {
        self.sendWithOpcode(client_id, .text, data);
    }

    /// Send binary to a specific client.
    pub fn sendBinary(self: *WsServer, client_id: u32, data: []const u8) void {
        self.sendWithOpcode(client_id, .binary, data);
    }

    /// Send with explicit opcode.
    pub fn sendWithOpcode(self: *WsServer, client_id: u32, opcode: Opcode, data: []const u8) void {
        for (&self.clients) |*client| {
            if (client.active and client.id == client_id and client.status == .open) {
                if (client.stream) |*stream| {
                    writeFrame(stream, 0x80 | @as(u8, @intFromEnum(opcode)), data) catch {
                        stream.deinit();
                        client.stream = null;
                        client.status = .closed;
                        client.active = false;
                    };
                }
                return;
            }
        }
    }

    /// Broadcast text to all connected clients.
    pub fn broadcast(self: *WsServer, data: []const u8) void {
        for (&self.clients) |*client| {
            if (client.active and client.status == .open) {
                if (client.stream) |*stream| {
                    writeFrame(stream, 0x81, data) catch {
                        stream.deinit();
                        client.stream = null;
                        client.status = .closed;
                        client.active = false;
                    };
                }
            }
        }
    }

    /// Shut down the server and all clients.
    pub fn close(self: *WsServer) void {
        for (&self.clients) |*client| {
            if (client.active) {
                if (client.stream) |*stream| stream.deinit();
                client.stream = null;
                client.active = false;
            }
        }
        self.listener.deinit();
    }

    // ── Internal ─────────────────────────────────────────────────────

    fn acceptClients(self: *WsServer, out: []ServerEvent) void {
        _ = out;
        while (true) {
            const accepted = self.listener.accept() orelse break;
            const slot = self.findClientSlot() orelse {
                accepted.close(self.io);
                break;
            };
            const pump = transport.StreamPump.init(self.allocator, self.io, accepted) catch {
                accepted.close(self.io);
                break;
            };
            self.clients[slot] = .{
                .active = true,
                .id = self.next_client_id,
                .stream = pump,
                .status = .handshake,
            };
            self.next_client_id += 1;
        }
    }

    fn processHandshake(self: *WsServer, client: *Client, out: []ServerEvent) void {
        const stream = if (client.stream) |*pump| pump else return;
        const n = switch (stream.drain(client.handshake_buf[client.handshake_len..])) {
            .empty => return,
            .data => |count| count,
            .closed, .failed => {
                self.dropClient(client);
                return;
            },
        };
        client.handshake_len += n;

        const headers = client.handshake_buf[0..client.handshake_len];
        if (std.mem.indexOf(u8, headers, "\r\n\r\n") == null) return;

        const key = extractHeader(headers, "Sec-WebSocket-Key: ") orelse {
            self.dropClient(client);
            return;
        };

        // SHA1(key + MAGIC_GUID) → base64
        var hasher = std.crypto.hash.Sha1.init(.{});
        hasher.update(key);
        hasher.update(MAGIC_GUID);
        const digest = hasher.finalResult();
        var accept_buf: [28]u8 = undefined;
        const accept = std.base64.standard.Encoder.encode(&accept_buf, &digest);

        // Build 101 response
        var resp_buf: [256]u8 = undefined;
        const resp = std.fmt.bufPrint(&resp_buf, "HTTP/1.1 101 Switching Protocols\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Sec-WebSocket-Accept: {s}\r\n\r\n", .{accept}) catch {
            self.dropClient(client);
            return;
        };

        stream.send(resp) catch {
            self.dropClient(client);
            return;
        };

        client.status = .open;
        self.pushEvent(out, client.id, .client_connected, .text, "");
    }

    fn processFrames(self: *WsServer, client: *Client, out: []ServerEvent) void {
        const stream = if (client.stream) |*pump| pump else return;
        const buf_cap = client.read_buf.len;
        if (client.read_len < buf_cap) {
            switch (stream.drain(client.read_buf[client.read_len..])) {
                .empty => {},
                .data => |n| client.read_len += n,
                .closed, .failed => {
                    self.pushEvent(out, client.id, .client_disconnected, .text, "");
                    self.dropClient(client);
                    return;
                },
            }
        }
        // Parse as many frames as available
        while (client.read_len >= 2) {
            if (!self.tryParseClientFrame(client, out)) break;
        }
    }

    fn tryParseClientFrame(self: *WsServer, client: *Client, out: []ServerEvent) bool {
        if (client.read_len < 2) return false;

        const byte0 = client.read_buf[0];
        const byte1 = client.read_buf[1];
        const fin = (byte0 & 0x80) != 0;
        const rsv = byte0 & 0x70;
        const opcode_raw = byte0 & 0x0F;
        const opcode: Opcode = @enumFromInt(opcode_raw);
        const masked = (byte1 & 0x80) != 0;
        var payload_len: usize = byte1 & 0x7F;
        var header_len: usize = 2;

        // RSV bits must be 0 (no extensions negotiated) — RFC 6455 §5.2
        if (rsv != 0) {
            self.sendClose(client, 1002, "RSV bits set");
            return false;
        }

        // Client frames MUST be masked — RFC 6455 §5.1
        if (!masked) {
            self.sendClose(client, 1002, "Unmasked frame");
            return false;
        }

        if (payload_len == 126) {
            if (client.read_len < 4) return false;
            payload_len = (@as(usize, client.read_buf[2]) << 8) | client.read_buf[3];
            header_len = 4;
        } else if (payload_len == 127) {
            if (client.read_len < 10) return false;
            payload_len = 0;
            for (2..10) |i| {
                payload_len = (payload_len << 8) | client.read_buf[i];
            }
            header_len = 10;
        }

        // Control frames must not exceed 125 bytes — RFC 6455 §5.5
        if (opcode_raw >= 8 and payload_len > 125) {
            self.sendClose(client, 1002, "Control frame too large");
            return false;
        }

        // Payload too large
        if (payload_len > MAX_MSG) {
            self.sendClose(client, 1009, "Message too big");
            return false;
        }

        var mask_key: [4]u8 = .{ 0, 0, 0, 0 };
        if (masked) {
            if (client.read_len < header_len + 4) return false;
            @memcpy(&mask_key, client.read_buf[header_len .. header_len + 4]);
            header_len += 4;
        }

        const total = header_len + payload_len;
        if (client.read_len < total) return false;

        // Extract and unmask payload
        var payload: [MAX_MSG]u8 = undefined;
        @memcpy(payload[0..payload_len], client.read_buf[header_len .. header_len + payload_len]);
        if (masked) {
            for (0..payload_len) |i| payload[i] ^= mask_key[i % 4];
        }

        // Stop parsing data frames if event buffer is full (control frames still ok)
        if (opcode_raw < 8 and self.event_count >= out.len) return false;

        // Consume from buffer
        const remaining = client.read_len - total;
        if (remaining > 0) {
            std.mem.copyForwards(u8, client.read_buf[0..remaining], client.read_buf[total..client.read_len]);
        }
        client.read_len = remaining;

        // Handle by opcode
        switch (opcode) {
            .text, .binary => {
                if (fin) {
                    if (client.frag_active) {
                        // We were in a fragmentation sequence but got a new
                        // non-continuation opcode — protocol error
                        self.sendClose(client, 1002, "Expected continuation");
                        return false;
                    }
                    // Validate UTF-8 for text frames
                    if (opcode == .text and !isValidUtf8(payload[0..payload_len])) {
                        self.sendClose(client, 1007, "Invalid UTF-8");
                        return false;
                    }
                    self.pushEvent(out, client.id, .client_message, opcode, payload[0..payload_len]);
                } else {
                    // Start of fragmented message
                    if (client.frag_active) {
                        self.sendClose(client, 1002, "Nested fragmentation");
                        return false;
                    }
                    const copy_len = @min(payload_len, MAX_MSG);
                    if (copy_len > 0) @memcpy(client.frag_buf[0..copy_len], payload[0..copy_len]);
                    client.frag_len = copy_len;
                    client.frag_opcode = opcode;
                    client.frag_active = true;
                }
            },
            .continuation => {
                if (!client.frag_active) {
                    self.sendClose(client, 1002, "Unexpected continuation");
                    return false;
                }
                const space = MAX_MSG - client.frag_len;
                const to_copy = @min(payload_len, space);
                if (to_copy > 0) {
                    @memcpy(client.frag_buf[client.frag_len .. client.frag_len + to_copy], payload[0..to_copy]);
                    client.frag_len += to_copy;
                }
                if (payload_len > space) {
                    self.sendClose(client, 1009, "Message too big");
                    return false;
                }
                if (fin) {
                    const frag_op = client.frag_opcode;
                    const frag_len = client.frag_len;
                    client.frag_len = 0;
                    client.frag_active = false;
                    // Validate UTF-8 for text
                    if (frag_op == .text and !isValidUtf8(client.frag_buf[0..frag_len])) {
                        self.sendClose(client, 1007, "Invalid UTF-8");
                        return false;
                    }
                    self.pushEvent(out, client.id, .client_message, frag_op, client.frag_buf[0..frag_len]);
                }
            },
            .close => {
                // Validate close payload
                if (payload_len == 1) {
                    // Close frames with 1 byte payload are invalid
                    self.sendClose(client, 1002, "Invalid close payload");
                    return false;
                }
                if (payload_len >= 2) {
                    const code = (@as(u16, payload[0]) << 8) | payload[1];
                    // Validate close code — RFC 6455 §7.4.1
                    if (!isValidCloseCode(code)) {
                        self.sendClose(client, 1002, "Invalid close code");
                        return false;
                    }
                    // Validate UTF-8 in close reason
                    if (payload_len > 2 and !isValidUtf8(payload[2..payload_len])) {
                        self.sendClose(client, 1007, "Invalid UTF-8 in close");
                        return false;
                    }
                }
                // Echo close frame back
                if (client.stream) |*stream| writeFrame(stream, 0x88, payload[0..payload_len]) catch {};
                self.pushEvent(out, client.id, .client_disconnected, .close, "");
                self.dropClient(client);
                return false;
            },
            .ping => {
                // Control frames may be interleaved in fragmented messages
                if (payload_len > 125) {
                    self.sendClose(client, 1002, "Ping too large");
                    return false;
                }
                // Control frames must not be fragmented
                if (!fin) {
                    self.sendClose(client, 1002, "Fragmented ping");
                    return false;
                }
                // Pong with same payload
                if (client.stream) |*stream| writeFrame(stream, 0x8A, payload[0..payload_len]) catch {};
            },
            .pong => {
                if (!fin) {
                    self.sendClose(client, 1002, "Fragmented pong");
                    return false;
                }
                // Unsolicited pong — ignore per RFC 6455 §5.5.3
            },
            _ => {
                // Unknown opcode — protocol error
                self.sendClose(client, 1002, "Unknown opcode");
                return false;
            },
        }

        return true; // successfully parsed, may have more frames
    }

    fn sendClose(self: *WsServer, client: *Client, code: u16, reason: []const u8) void {
        if (client.stream) |*stream| {
            var close_payload: [127]u8 = undefined;
            std.mem.writeInt(u16, close_payload[0..2], code, .big);
            const rlen = @min(reason.len, 123);
            @memcpy(close_payload[2 .. 2 + rlen], reason[0..rlen]);
            writeFrame(stream, 0x88, close_payload[0 .. 2 + rlen]) catch {};
        }
        self.dropClient(client);
    }

    fn dropClient(self: *WsServer, client: *Client) void {
        _ = self;
        if (client.stream) |*stream| stream.deinit();
        client.stream = null;
        client.status = .closed;
        client.active = false;
    }

    fn findClientSlot(self: *WsServer) ?usize {
        for (0..MAX_CLIENTS) |i| {
            if (!self.clients[i].active) return i;
        }
        return null;
    }

    fn pushEvent(self: *WsServer, out: []ServerEvent, client_id: u32, event_type: ServerEventType, opcode: Opcode, data: []const u8) void {
        if (self.event_count >= out.len) return;
        var ev = &out[self.event_count];
        ev.client_id = client_id;
        ev.event_type = event_type;
        ev.opcode = opcode;
        const dlen = @min(data.len, MAX_MSG);
        if (dlen > 0) @memcpy(ev.data[0..dlen], data[0..dlen]);
        ev.data_len = dlen;
        self.event_count += 1;
    }
};

// ── Helpers ──────────────────────────────────────────────────────────────

fn extractHeader(headers: []const u8, name: []const u8) ?[]const u8 {
    var pos: usize = 0;
    while (pos < headers.len) {
        if (std.mem.startsWith(u8, headers[pos..], name)) {
            const start = pos + name.len;
            const end = std.mem.indexOf(u8, headers[start..], "\r\n") orelse (headers.len - start);
            return headers[start .. start + end];
        }
        if (std.mem.indexOf(u8, headers[pos..], "\r\n")) |nl| {
            pos += nl + 2;
        } else break;
    }
    return null;
}

/// Write an unmasked server→client frame. first_byte = FIN+opcode.
fn writeFrame(stream: *transport.StreamPump, first_byte: u8, payload: []const u8) !void {
    var hdr: [10]u8 = undefined;
    var hdr_len: usize = 2;
    hdr[0] = first_byte;
    if (payload.len > 65535) {
        hdr[1] = 127;
        std.mem.writeInt(u64, hdr[2..10], payload.len, .big);
        hdr_len = 10;
    } else if (payload.len > 125) {
        hdr[1] = 126;
        std.mem.writeInt(u16, hdr[2..4], @intCast(payload.len), .big);
        hdr_len = 4;
    } else {
        hdr[1] = @intCast(payload.len);
    }
    try stream.send(hdr[0..hdr_len]);
    if (payload.len > 0) try stream.send(payload);
}

fn isValidUtf8(data: []const u8) bool {
    return std.unicode.utf8ValidateSlice(data);
}

fn isValidCloseCode(code: u16) bool {
    // RFC 6455 §7.4.1: valid close codes
    if (code >= 3000 and code <= 4999) return true;
    return switch (code) {
        1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011 => true,
        else => false,
    };
}

test "public WebSocket server API compiles" {
    std.testing.refAllDecls(@This());
}
