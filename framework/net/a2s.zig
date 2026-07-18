//! Source Query Protocol (A2S) — UDP server query.
//!
//! Hits Valve dedicated servers (GoldSrc / Source / Source 2) for INFO,
//! PLAYER, and RULES responses. Port of
//! `love2d/lua/capabilities/game_server/source_query.lua`, with the binary
//! parsing kept in Zig and the parsed structures emitted to JS as JSON.
//!
//! Protocol summary:
//!   Request  = 0xFFFFFFFF + type-byte + payload
//!     INFO   : 0xFFFFFFFF "TSource Engine Query\0"
//!     PLAYER : 0xFFFFFFFF 'U' + 4-byte challenge
//!     RULES  : 0xFFFFFFFF 'V' + 4-byte challenge
//!   Response = 0xFFFFFFFF + type-byte + body
//!     0x49 ('I')   S2A_INFO  (Source/Source 2)
//!     0x6D ('m')   S2A_INFO_OLD (GoldSrc)
//!     0x44 ('D')   S2A_PLAYER
//!     0x45 ('E')   S2A_RULES
//!     0x41 ('A')   S2A_CHALLENGE — re-issue query with the 4-byte challenge

const std = @import("std");
const udp = @import("udp.zig");

pub const QueryKind = enum { info, players, rules };

pub const EventTag = enum { info_json, players_json, rules_json, err };

pub const Event = union(EventTag) {
    info_json: []u8, // owned
    players_json: []u8, // owned
    rules_json: []u8, // owned
    err: []const u8,
};

const HEADER = "\xFF\xFF\xFF\xFF";
const A2S_INFO_REQ = HEADER ++ "TSource Engine Query\x00";

pub const A2sClient = struct {
    sock: udp.UdpSocket,
    pending_info: bool = false,
    pending_players: bool = false,
    pending_rules: bool = false,
    player_challenge: ?[4]u8 = null,
    rules_challenge: ?[4]u8 = null,
    err_buf: [128]u8 = undefined,

    pub fn open(host: []const u8, port: u16) !A2sClient {
        return .{ .sock = try udp.UdpSocket.openConnected(host, port) };
    }

    pub fn close(self: *A2sClient) void {
        self.sock.close();
    }

    pub fn queryInfo(self: *A2sClient) void {
        self.pending_info = true;
        self.sock.send(A2S_INFO_REQ);
    }

    pub fn queryPlayers(self: *A2sClient) void {
        self.pending_players = true;
        var pkt: [9]u8 = undefined;
        @memcpy(pkt[0..5], HEADER ++ "U");
        const ch = self.player_challenge orelse [_]u8{ 0xFF, 0xFF, 0xFF, 0xFF };
        @memcpy(pkt[5..9], &ch);
        self.sock.send(&pkt);
    }

    pub fn queryRules(self: *A2sClient) void {
        self.pending_rules = true;
        var pkt: [9]u8 = undefined;
        @memcpy(pkt[0..5], HEADER ++ "V");
        const ch = self.rules_challenge orelse [_]u8{ 0xFF, 0xFF, 0xFF, 0xFF };
        @memcpy(pkt[5..9], &ch);
        self.sock.send(&pkt);
    }

    pub fn update(self: *A2sClient, out: []Event, alloc: std.mem.Allocator) usize {
        if (out.len == 0) return 0;
        var pkt_buf: [1]udp.Event = undefined;
        const n = self.sock.update(&pkt_buf);
        if (n == 0) return 0;
        const ev = pkt_buf[0];
        switch (ev) {
            .err => |msg| {
                const m = std.fmt.bufPrint(&self.err_buf, "{s}", .{msg}) catch "a2s recv err";
                out[0] = .{ .err = m };
                return 1;
            },
            .packet => |bytes| {
                if (bytes.len < 5) return 0;
                if (!std.mem.eql(u8, bytes[0..4], HEADER)) return 0;
                const t = bytes[4];
                switch (t) {
                    0x49, 0x6D => {
                        const json = buildInfoJson(bytes, alloc) catch return 0;
                        self.pending_info = false;
                        out[0] = .{ .info_json = json };
                        return 1;
                    },
                    0x44 => {
                        const json = buildPlayersJson(bytes, alloc) catch return 0;
                        self.pending_players = false;
                        out[0] = .{ .players_json = json };
                        return 1;
                    },
                    0x45 => {
                        const json = buildRulesJson(bytes, alloc) catch return 0;
                        self.pending_rules = false;
                        out[0] = .{ .rules_json = json };
                        return 1;
                    },
                    0x41 => {
                        // Challenge — reissue whichever query is pending.
                        if (bytes.len < 9) return 0;
                        var ch: [4]u8 = undefined;
                        @memcpy(&ch, bytes[5..9]);
                        if (self.pending_players) {
                            self.player_challenge = ch;
                            self.queryPlayers();
                        }
                        if (self.pending_rules) {
                            self.rules_challenge = ch;
                            self.queryRules();
                        }
                        return 0;
                    },
                    else => return 0,
                }
            },
        }
    }
};

// ── Parsers → JSON ─────────────────────────────────────────────────────

const Cursor = struct {
    data: []const u8,
    pos: usize = 0,

    fn byte(self: *Cursor) u8 {
        if (self.pos >= self.data.len) return 0;
        const b = self.data[self.pos];
        self.pos += 1;
        return b;
    }

    fn short(self: *Cursor) u16 {
        if (self.pos + 1 >= self.data.len) return 0;
        const v = std.mem.readInt(u16, self.data[self.pos..][0..2], .little);
        self.pos += 2;
        return v;
    }

    fn long(self: *Cursor) u32 {
        if (self.pos + 3 >= self.data.len) return 0;
        const v = std.mem.readInt(u32, self.data[self.pos..][0..4], .little);
        self.pos += 4;
        return v;
    }

    fn signedLong(self: *Cursor) i32 {
        if (self.pos + 3 >= self.data.len) return 0;
        const v = std.mem.readInt(i32, self.data[self.pos..][0..4], .little);
        self.pos += 4;
        return v;
    }

    fn float(self: *Cursor) f32 {
        if (self.pos + 3 >= self.data.len) return 0;
        const bits = std.mem.readInt(u32, self.data[self.pos..][0..4], .little);
        self.pos += 4;
        return @bitCast(bits);
    }

    fn cstring(self: *Cursor) []const u8 {
        const start = self.pos;
        while (self.pos < self.data.len and self.data[self.pos] != 0) self.pos += 1;
        const s = self.data[start..self.pos];
        if (self.pos < self.data.len) self.pos += 1; // consume NUL
        return s;
    }
};

fn appendFormatted(out: *std.ArrayList(u8), alloc: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !void {
    var buf: [256]u8 = undefined;
    try out.appendSlice(alloc, try std.fmt.bufPrint(&buf, fmt, args));
}

fn jsonStr(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |c| {
        switch (c) {
            '\\' => try out.appendSlice(alloc, "\\\\"),
            '"' => try out.appendSlice(alloc, "\\\""),
            '\n' => try out.appendSlice(alloc, "\\n"),
            '\r' => try out.appendSlice(alloc, "\\r"),
            '\t' => try out.appendSlice(alloc, "\\t"),
            0...0x08, 0x0B, 0x0C, 0x0E...0x1F => {
                var buf: [8]u8 = undefined;
                const e = try std.fmt.bufPrint(&buf, "\\u{x:0>4}", .{c});
                try out.appendSlice(alloc, e);
            },
            else => try out.append(alloc, c),
        }
    }
    try out.append(alloc, '"');
}

fn buildInfoJson(bytes: []const u8, alloc: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    var cur = Cursor{ .data = bytes, .pos = 5 }; // skip 4 header + 1 type
    const t = bytes[4];

    try out.append(alloc, '{');
    if (t == 0x6D) {
        // GoldSrc legacy format
        const address = cur.cstring();
        const name = cur.cstring();
        const map = cur.cstring();
        const folder = cur.cstring();
        const game = cur.cstring();
        const players = cur.byte();
        const max_players = cur.byte();
        const protocol = cur.byte();
        try out.appendSlice(alloc, "\"format\":\"goldsrc\",\"address\":");
        try jsonStr(&out, alloc, address);
        try out.appendSlice(alloc, ",\"name\":");
        try jsonStr(&out, alloc, name);
        try out.appendSlice(alloc, ",\"map\":");
        try jsonStr(&out, alloc, map);
        try out.appendSlice(alloc, ",\"folder\":");
        try jsonStr(&out, alloc, folder);
        try out.appendSlice(alloc, ",\"game\":");
        try jsonStr(&out, alloc, game);
        try appendFormatted(&out, alloc, ",\"players\":{d},\"maxPlayers\":{d},\"protocol\":{d}", .{ players, max_players, protocol });
    } else {
        // Source / Source 2
        const protocol = cur.byte();
        const name = cur.cstring();
        const map = cur.cstring();
        const folder = cur.cstring();
        const game = cur.cstring();
        const app_id = cur.short();
        const players = cur.byte();
        const max_players = cur.byte();
        const bots = cur.byte();
        const server_type = cur.byte();
        const env = cur.byte();
        const visibility = cur.byte();
        const vac = cur.byte();
        const version = cur.cstring();
        try out.appendSlice(alloc, "\"format\":\"source\",\"protocol\":");
        try appendFormatted(&out, alloc, "{d}", .{protocol});
        try out.appendSlice(alloc, ",\"name\":");
        try jsonStr(&out, alloc, name);
        try out.appendSlice(alloc, ",\"map\":");
        try jsonStr(&out, alloc, map);
        try out.appendSlice(alloc, ",\"folder\":");
        try jsonStr(&out, alloc, folder);
        try out.appendSlice(alloc, ",\"game\":");
        try jsonStr(&out, alloc, game);
        try appendFormatted(&out, alloc, ",\"steamAppId\":{d},\"players\":{d},\"maxPlayers\":{d},\"bots\":{d},\"serverType\":{d},\"environment\":{d},\"visibility\":{d},\"vac\":{d}", .{ app_id, players, max_players, bots, server_type, env, visibility, vac });
        try out.appendSlice(alloc, ",\"version\":");
        try jsonStr(&out, alloc, version);
    }
    try out.append(alloc, '}');
    return try out.toOwnedSlice(alloc);
}

fn buildPlayersJson(bytes: []const u8, alloc: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    var cur = Cursor{ .data = bytes, .pos = 5 };
    const count = cur.byte();
    try out.append(alloc, '[');
    var i: usize = 0;
    while (i < count) : (i += 1) {
        if (i > 0) try out.append(alloc, ',');
        const idx = cur.byte();
        const name = cur.cstring();
        const score = cur.signedLong();
        const duration = cur.float();
        try appendFormatted(&out, alloc, "{{\"index\":{d},\"name\":", .{idx});
        try jsonStr(&out, alloc, name);
        try appendFormatted(&out, alloc, ",\"score\":{d},\"duration\":{d:.3}}}", .{ score, duration });
    }
    try out.append(alloc, ']');
    return try out.toOwnedSlice(alloc);
}

fn buildRulesJson(bytes: []const u8, alloc: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    var cur = Cursor{ .data = bytes, .pos = 5 };
    const count = cur.short();
    try out.append(alloc, '{');
    var i: usize = 0;
    while (i < count) : (i += 1) {
        if (i > 0) try out.append(alloc, ',');
        const name = cur.cstring();
        const value = cur.cstring();
        try jsonStr(&out, alloc, name);
        try out.append(alloc, ':');
        try jsonStr(&out, alloc, value);
    }
    try out.append(alloc, '}');
    return try out.toOwnedSlice(alloc);
}
