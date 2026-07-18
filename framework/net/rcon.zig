//! Source RCON Protocol — non-blocking client.
//!
//! Speaks Valve's Source RCON to GoldSrc / Source / Source 2 / Minecraft
//! dedicated servers over TCP. Port of `love2d/lua/capabilities/game_server/rcon.lua`,
//! restructured around our existing non-blocking `tcp.TcpClient` so all binary
//! framing happens in Zig and only string command/response data crosses the
//! V8 FFI boundary (no UTF-8 mangling of the binary header).
//!
//! Protocol shape:
//!   Packet = size(i32 LE) + id(i32 LE) + type(i32 LE) + body(NUL-terminated) + NUL pad
//!   AUTH(3)         — client → server, body = password
//!   AUTH_RESPONSE(2) — server → client, id = -1 on failure
//!   EXEC_COMMAND(2) — client → server, body = command
//!   RESPONSE_VALUE(0) — server → client, may span multiple packets
//!
//! End-of-response detection: Source servers send a single empty
//! RESPONSE_VALUE for any unknown packet id. We exploit this by sending a
//! marker EXEC_COMMAND with an empty body right after the user's command;
//! when the marker's RESPONSE_VALUE arrives we know the prior response is
//! fully delivered.

const std = @import("std");
const tcp = @import("tcp.zig");

pub const PKT_AUTH: i32 = 3;
pub const PKT_AUTH_RESPONSE: i32 = 2;
pub const PKT_EXEC_COMMAND: i32 = 2;
pub const PKT_RESPONSE_VALUE: i32 = 0;

pub const ConnState = enum { authing, ready, closed, errored };

pub const EventTag = enum { auth_ok, auth_fail, response, closed, err };

pub const Event = union(EventTag) {
    auth_ok: void,
    auth_fail: void,
    response: struct {
        request_id: u32,
        /// Owned by the caller — must be freed with the same allocator that
        /// was passed to `update()` once the event has been consumed.
        body: []u8,
    },
    closed: void,
    err: []const u8,
};

const PendingCmd = struct {
    request_id: u32,
    cmd_id: i32,
    marker_id: i32,
    accumulated: std.ArrayList(u8) = .empty,
};

pub const RconClient = struct {
    inner: tcp.TcpClient,
    state: ConnState = .authing,
    password: []u8,

    next_wire_id: i32 = 1,
    auth_id: i32 = 0,
    next_request_id: u32 = 1,

    pending: std.ArrayList(PendingCmd) = .empty,
    recv_buf: std.ArrayList(u8) = .empty,
    err_buf: [128]u8 = undefined,

    /// Connect, send the AUTH packet, return the half-initialized client.
    /// The caller polls `update()` until either `.auth_ok` or `.auth_fail`
    /// arrives before calling `command()`.
    pub fn connect(io: std.Io, host: []const u8, port: u16, password: []const u8, alloc: std.mem.Allocator) !RconClient {
        const pw = try alloc.dupe(u8, password);
        errdefer alloc.free(pw);
        const inner = try tcp.TcpClient.connect(alloc, io, host, port);
        var self: RconClient = .{ .inner = inner, .password = pw };
        self.sendAuth();
        return self;
    }

    fn sendPacket(self: *RconClient, wire_id: i32, ptype: i32, body: []const u8) void {
        var hdr: [12]u8 = undefined;
        const size: i32 = @intCast(body.len + 10);
        std.mem.writeInt(i32, hdr[0..4], size, .little);
        std.mem.writeInt(i32, hdr[4..8], wire_id, .little);
        std.mem.writeInt(i32, hdr[8..12], ptype, .little);
        self.inner.send(&hdr);
        if (body.len > 0) self.inner.send(body);
        self.inner.send(&[_]u8{ 0, 0 });
    }

    fn sendAuth(self: *RconClient) void {
        self.auth_id = self.next_wire_id;
        self.next_wire_id += 1;
        self.sendPacket(self.auth_id, PKT_AUTH, self.password);
    }

    /// Queue a command. Returns the request_id that will appear on the
    /// matching `.response` event.
    pub fn command(self: *RconClient, cmd: []const u8) error{ NotReady, OutOfMemory }!u32 {
        if (self.state != .ready) return error.NotReady;
        const req_id = self.next_request_id;
        self.next_request_id += 1;
        const cmd_id = self.next_wire_id;
        self.next_wire_id += 1;
        const marker_id = self.next_wire_id;
        self.next_wire_id += 1;
        try self.pending.append(self.allocOf(), .{
            .request_id = req_id,
            .cmd_id = cmd_id,
            .marker_id = marker_id,
        });
        self.sendPacket(cmd_id, PKT_EXEC_COMMAND, cmd);
        // Marker — empty RESPONSE_VALUE echoes back as end-of-stream.
        self.sendPacket(marker_id, PKT_RESPONSE_VALUE, &.{});
        return req_id;
    }

    pub fn close(self: *RconClient, alloc: std.mem.Allocator) void {
        self.inner.close();
        self.state = .closed;
        for (self.pending.items) |*p| p.accumulated.deinit(alloc);
        self.pending.deinit(alloc);
        self.recv_buf.deinit(alloc);
        alloc.free(self.password);
    }

    /// Drain incoming bytes; emit at most one `Event` per call. Re-call until
    /// it returns 0 to fully drain.
    pub fn update(self: *RconClient, out: []Event, alloc: std.mem.Allocator) usize {
        if (out.len == 0) return 0;
        if (self.state == .closed or self.state == .errored) return 0;

        var ev_buf: [1]tcp.Event = undefined;
        const n = self.inner.update(&ev_buf);
        if (n > 0) {
            switch (ev_buf[0]) {
                .data => |bytes| self.recv_buf.appendSlice(alloc, bytes) catch {},
                .closed => {
                    self.state = .closed;
                    out[0] = .closed;
                    return 1;
                },
                .err => |msg| {
                    self.state = .errored;
                    const m = std.fmt.bufPrint(&self.err_buf, "{s}", .{msg}) catch "rcon tcp err";
                    out[0] = .{ .err = m };
                    return 1;
                },
            }
        }

        return self.tryParseOne(out, alloc);
    }

    fn tryParseOne(self: *RconClient, out: []Event, alloc: std.mem.Allocator) usize {
        if (self.recv_buf.items.len < 12) return 0;
        const size = std.mem.readInt(i32, self.recv_buf.items[0..4], .little);
        if (size < 10) {
            // Garbage — drop a byte and bail; framing is irrecoverable.
            _ = self.recv_buf.orderedRemove(0);
            return 0;
        }
        const total: usize = @as(usize, @intCast(size)) + 4;
        if (self.recv_buf.items.len < total) return 0;

        const id = std.mem.readInt(i32, self.recv_buf.items[4..8], .little);
        const ptype = std.mem.readInt(i32, self.recv_buf.items[8..12], .little);
        const body_end = total - 1; // drop trailing pad NUL
        var body: []const u8 = &.{};
        if (body_end > 13) body = self.recv_buf.items[12 .. body_end - 1]; // also drop body NUL

        // Consume the packet's bytes.
        self.consumeFront(total, alloc);

        if (self.state == .authing and ptype == PKT_AUTH_RESPONSE) {
            if (id == -1) {
                self.state = .errored;
                out[0] = .auth_fail;
            } else {
                self.state = .ready;
                out[0] = .auth_ok;
            }
            return 1;
        }

        if (ptype == PKT_RESPONSE_VALUE) {
            for (self.pending.items, 0..) |*p, idx| {
                if (id == p.cmd_id) {
                    p.accumulated.appendSlice(alloc, body) catch {};
                    return 0;
                }
                if (id == p.marker_id) {
                    // Transfer ownership of the accumulated buffer to the event.
                    const owned = p.accumulated.toOwnedSlice(alloc) catch &[_]u8{};
                    const req_id = p.request_id;
                    _ = self.pending.orderedRemove(idx);
                    out[0] = .{ .response = .{ .request_id = req_id, .body = @constCast(owned) } };
                    return 1;
                }
            }
        }

        return 0;
    }

    fn consumeFront(self: *RconClient, n: usize, alloc: std.mem.Allocator) void {
        if (n >= self.recv_buf.items.len) {
            self.recv_buf.clearRetainingCapacity();
            return;
        }
        const tail = self.recv_buf.items[n..];
        std.mem.copyForwards(u8, self.recv_buf.items[0..tail.len], tail);
        self.recv_buf.shrinkRetainingCapacity(tail.len);
        _ = alloc; // unused — items are stored inline in the ArrayList
    }

    fn allocOf(self: *RconClient) std.mem.Allocator {
        // pending grows with the same allocator the recv_buf uses; both come
        // from the binding layer's c_allocator. We don't store it on the
        // struct because it'd duplicate state — the binding is the only
        // caller.
        _ = self;
        return std.heap.c_allocator;
    }
};
