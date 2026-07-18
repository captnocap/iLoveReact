//! PTY Remote Control — unix socket server for external terminal control.
//!
//! Listens on /run/user/<uid>/claude-sessions/supervisor.sock
//! Accepts NDJSON commands, routes to vterm slots, returns NDJSON responses.
//!
//! Protocol (one JSON object per line, both directions):
//!
//!   → {"op":"write","slot":0,"data":"ls -la\n"}     Write to terminal PTY
//!   ← {"ok":true}
//!
//!   → {"op":"read","slot":0}                         Read full terminal buffer
//!   ← {"ok":true,"rows":24,"cols":80,"lines":["$ ls","file1","file2",...]}
//!
//!   → {"op":"read_row","slot":0,"row":0}             Read single row
//!   ← {"ok":true,"text":"$ ls -la","token":"command"}
//!
//!   → {"op":"state","slot":0}                        Semantic state
//!   ← {"ok":true,"mode":"claude_code","alive":true,"rows":24,"cols":80}
//!
//!   → {"op":"resize","slot":0,"rows":40,"cols":120}  Resize terminal
//!   ← {"ok":true}
//!
//!   → {"op":"list"}                                  List active terminals
//!   ← {"ok":true,"terminals":[{"slot":0,"alive":true,"rows":24,"cols":80},...]}"
//!
//!   → {"op":"alive","slot":0}                        Check PTY alive
//!   ← {"ok":true,"alive":true}

const std = @import("std");
const log = @import("../diag/log.zig");
const transport = @import("../net/transport.zig");
const vterm_mod = @import("vterm.zig");
const classifier = @import("classifier.zig");

const MAX_CLIENTS = 4;
const READ_BUF_SIZE = 4096;
const WRITE_BUF_SIZE = 32 * 1024;

pub const Server = struct {
    allocator: std.mem.Allocator,
    listener: ?transport.ListenerPump = null,
    clients: [MAX_CLIENTS]?transport.StreamPump = .{null} ** MAX_CLIENTS,
    client_bufs: [MAX_CLIENTS][READ_BUF_SIZE]u8 = undefined,
    client_buf_lens: [MAX_CLIENTS]usize = .{0} ** MAX_CLIENTS,
    initialized: bool = false,
    sock_path_buf: [256]u8 = undefined,
    sock_path_len: usize = 0,

    pub fn init(allocator: std.mem.Allocator) Server {
        return .{ .allocator = allocator };
    }

    pub fn start(self: *Server, io: std.Io) void {
        if (self.initialized) return;

        // Linux-only: PTY remote control socket lives in /run/user/<uid>/
        if (comptime @import("builtin").os.tag != .linux) return;

        // Build socket path
        const uid = std.os.linux.getuid();
        self.sock_path_len = (std.fmt.bufPrint(&self.sock_path_buf, "/run/user/{d}/claude-sessions/supervisor.sock", .{uid}) catch return).len;
        const path = self.sock_path_buf[0..self.sock_path_len];

        // Remove stale socket
        std.Io.Dir.deleteFileAbsolute(io, path) catch |err| switch (err) {
            error.FileNotFound => {},
            else => {
                log.print("[pty_remote] unlink failed: {}\n", .{err});
                return;
            },
        };

        const address = std.Io.net.UnixAddress.init(path) catch |err| {
            log.print("[pty_remote] address failed: {}\n", .{err});
            return;
        };
        var server = address.listen(io, .{ .kernel_backlog = MAX_CLIENTS }) catch |err| {
            log.print("[pty_remote] bind/listen failed: {}\n", .{err});
            return;
        };
        const listener = transport.ListenerPump.init(self.allocator, io, server) catch |err| {
            server.deinit(io);
            log.print("[pty_remote] listener task failed: {}\n", .{err});
            return;
        };

        self.listener = listener;
        self.initialized = true;
        log.print("[pty_remote] listening on {s}\n", .{path});
    }

    pub fn deinit(self: *Server, io: std.Io) void {
        for (&self.clients) |*c| {
            if (c.*) |*stream| {
                stream.deinit();
                c.* = null;
            }
        }
        if (self.listener) |*listener| {
            listener.deinit();
            self.listener = null;
        }
        if (self.sock_path_len > 0) {
            std.Io.Dir.deleteFileAbsolute(io, self.sock_path_buf[0..self.sock_path_len]) catch {};
        }
        self.sock_path_len = 0;
        self.initialized = false;
    }

    /// Call once per frame from engine main loop.
    pub fn poll(self: *Server, io: std.Io) void {
        if (!self.initialized) return;
        self.acceptNewClients(io);
        self.readClients();
    }

    fn acceptNewClients(self: *Server, io: std.Io) void {
        const listener = if (self.listener) |*active| active else return;
        // Accept up to MAX_CLIENTS
        for (&self.clients) |*slot| {
            if (slot.* != null) continue;
            const accepted = listener.accept() orelse return;
            slot.* = transport.StreamPump.init(self.allocator, io, accepted) catch {
                accepted.close(io);
                return;
            };
            log.print("[pty_remote] client connected\n", .{});
            return;
        }
    }

    fn readClients(self: *Server) void {
        for (0..MAX_CLIENTS) |i| {
            const client = if (self.clients[i]) |*active| active else continue;
            // Read available data
            const n = switch (client.drain(self.client_bufs[i][self.client_buf_lens[i]..])) {
                .empty => continue,
                .data => |count| count,
                .closed, .failed => {
                    self.closeClient(i);
                    log.print("[pty_remote] client disconnected\n", .{});
                    continue;
                },
            };
            self.client_buf_lens[i] += n;

            // Process complete lines (NDJSON)
            self.processLines(i);
        }
    }

    fn processLines(self: *Server, client_idx: usize) void {
        var buf = self.client_bufs[client_idx][0..self.client_buf_lens[client_idx]];
        while (true) {
            const nl = std.mem.indexOf(u8, buf, "\n") orelse break;
            const line = buf[0..nl];
            if (line.len > 0) {
                self.handleCommand(client_idx, line);
            }
            // Shift remaining data
            const remaining = buf[nl + 1 ..];
            if (remaining.len > 0) {
                std.mem.copyForwards(u8, &self.client_bufs[client_idx], remaining);
            }
            self.client_buf_lens[client_idx] = remaining.len;
            buf = self.client_bufs[client_idx][0..self.client_buf_lens[client_idx]];
        }
        // Prevent buffer overflow
        if (self.client_buf_lens[client_idx] >= READ_BUF_SIZE - 1) {
            self.client_buf_lens[client_idx] = 0;
        }
    }

    fn handleCommand(self: *Server, client_idx: usize, line: []const u8) void {
        var out_buf: [WRITE_BUF_SIZE]u8 = undefined;

        // Minimal JSON parsing — extract "op" and "slot" fields
        const op = extractString(line, "\"op\"");
        const slot = extractInt(line, "\"slot\"");

        if (std.mem.eql(u8, op, "list")) {
            const resp = listTerminals(&out_buf);
            self.sendResponse(client_idx, resp);
        } else if (std.mem.eql(u8, op, "write")) {
            const data = extractString(line, "\"data\"");
            if (slot < vterm_mod.MAX_TERMINALS and data.len > 0) {
                var unescape_buf: [4096]u8 = undefined;
                const unescaped = jsonUnescape(&unescape_buf, data);
                vterm_mod.writePtyIdx(@intCast(slot), unescaped);
                self.sendResponse(client_idx, "{\"ok\":true}\n");
            } else {
                self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot or data\"}\n");
            }
        } else if (std.mem.eql(u8, op, "read")) {
            if (slot < vterm_mod.MAX_TERMINALS) {
                const resp = readTerminal(@intCast(slot), &out_buf);
                self.sendResponse(client_idx, resp);
            } else {
                self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
            }
        } else if (std.mem.eql(u8, op, "read_row")) {
            const row = extractInt(line, "\"row\"");
            if (slot < vterm_mod.MAX_TERMINALS) {
                const resp = readRow(@intCast(slot), @intCast(row), &out_buf);
                self.sendResponse(client_idx, resp);
            } else {
                self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
            }
        } else if (std.mem.eql(u8, op, "state")) {
            if (slot < vterm_mod.MAX_TERMINALS) {
                const resp = termState(@intCast(slot), &out_buf);
                self.sendResponse(client_idx, resp);
            } else {
                self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
            }
        } else if (std.mem.eql(u8, op, "resize")) {
            const rows_val = extractInt(line, "\"rows\"");
            const cols_val = extractInt(line, "\"cols\"");
            if (slot < vterm_mod.MAX_TERMINALS and rows_val > 0 and cols_val > 0) {
                vterm_mod.resizeVtermIdx(@intCast(slot), @intCast(rows_val), @intCast(cols_val));
                self.sendResponse(client_idx, "{\"ok\":true}\n");
            } else {
                self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid params\"}\n");
            }
        } else if (std.mem.eql(u8, op, "alive")) {
            if (slot < vterm_mod.MAX_TERMINALS) {
                const alive = vterm_mod.ptyAliveIdx(@intCast(slot));
                if (alive) {
                    self.sendResponse(client_idx, "{\"ok\":true,\"alive\":true}\n");
                } else {
                    self.sendResponse(client_idx, "{\"ok\":true,\"alive\":false}\n");
                }
            } else {
                self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
            }
        } else {
            self.sendResponse(client_idx, "{\"ok\":false,\"error\":\"unknown op\"}\n");
        }
    }

    fn sendResponse(self: *Server, client_idx: usize, data: []const u8) void {
        const client = if (self.clients[client_idx]) |*active| active else return;
        client.send(data) catch self.closeClient(client_idx);
    }

    fn closeClient(self: *Server, client_idx: usize) void {
        if (self.clients[client_idx]) |*client| client.deinit();
        self.clients[client_idx] = null;
        self.client_buf_lens[client_idx] = 0;
    }

    // ── Response builders ───────────────────────────────────────────

    fn listTerminals(buf: []u8) []const u8 {
        var pos: usize = 0;
        pos += copyTo(buf[pos..], "{\"ok\":true,\"terminals\":[");
        var first = true;
        for (0..vterm_mod.MAX_TERMINALS) |i| {
            const idx: u8 = @intCast(i);
            const alive = vterm_mod.ptyAliveIdx(idx);
            if (!alive and vterm_mod.getRowsIdx(idx) == 0) continue;
            if (!first) {
                pos += copyTo(buf[pos..], ",");
            }
            first = false;
            const rows = vterm_mod.getRowsIdx(idx);
            const cols = vterm_mod.getColsIdx(idx);
            pos += (std.fmt.bufPrint(buf[pos..], "{{\"slot\":{d},\"alive\":{s},\"rows\":{d},\"cols\":{d}}}", .{
                i,
                if (alive) "true" else "false",
                rows,
                cols,
            }) catch return buf[0..0]).len;
        }
        pos += copyTo(buf[pos..], "]}\n");
        return buf[0..pos];
    }

    fn readTerminal(slot: u8, buf: []u8) []const u8 {
        const rows = vterm_mod.getRowsIdx(slot);
        const cols = vterm_mod.getColsIdx(slot);
        var pos: usize = 0;
        pos += (std.fmt.bufPrint(buf[pos..], "{{\"ok\":true,\"rows\":{d},\"cols\":{d},\"lines\":[", .{ rows, cols }) catch return buf[0..0]).len;

        var r: u16 = 0;
        while (r < rows) : (r += 1) {
            if (r > 0) {
                pos += copyTo(buf[pos..], ",");
            }
            const text = vterm_mod.getRowTextIdx(slot, r);
            pos += copyTo(buf[pos..], "\"");
            pos += jsonEscape(buf[pos..], text);
            pos += copyTo(buf[pos..], "\"");
            if (pos >= buf.len - 100) break;
        }
        pos += copyTo(buf[pos..], "]}\n");
        return buf[0..pos];
    }

    fn readRow(slot: u8, row: u16, buf: []u8) []const u8 {
        const text = vterm_mod.getRowTextIdx(slot, row);
        const token = classifier.getRowTokenIdx(slot, row);
        const token_name = @tagName(token);
        var pos: usize = 0;
        pos += copyTo(buf[pos..], "{\"ok\":true,\"text\":\"");
        pos += jsonEscape(buf[pos..], text);
        pos += copyTo(buf[pos..], "\",\"token\":\"");
        pos += copyTo(buf[pos..], token_name);
        pos += copyTo(buf[pos..], "\"}\n");
        return buf[0..pos];
    }

    fn termState(slot: u8, buf: []u8) []const u8 {
        const mode = classifier.getModeIdx(slot);
        const mode_name = @tagName(mode);
        const alive = vterm_mod.ptyAliveIdx(slot);
        const rows = vterm_mod.getRowsIdx(slot);
        const cols = vterm_mod.getColsIdx(slot);
        var pos: usize = 0;
        pos += (std.fmt.bufPrint(buf[pos..], "{{\"ok\":true,\"mode\":\"{s}\",\"alive\":{s},\"rows\":{d},\"cols\":{d}}}\n", .{
            mode_name,
            if (alive) "true" else "false",
            rows,
            cols,
        }) catch return buf[0..0]).len;
        return buf[0..pos];
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn copyTo(dest: []u8, src: []const u8) usize {
        const n = @min(src.len, dest.len);
        @memcpy(dest[0..n], src[0..n]);
        return n;
    }

    /// Unescape JSON string: \n → newline, \t → tab, \\ → \, \" → "
    fn jsonUnescape(dest: []u8, src: []const u8) []const u8 {
        var pos: usize = 0;
        var i: usize = 0;
        while (i < src.len and pos < dest.len) {
            if (src[i] == '\\' and i + 1 < src.len) {
                switch (src[i + 1]) {
                    'n' => {
                        dest[pos] = '\n';
                        pos += 1;
                        i += 2;
                    },
                    'r' => {
                        dest[pos] = '\r';
                        pos += 1;
                        i += 2;
                    },
                    't' => {
                        dest[pos] = '\t';
                        pos += 1;
                        i += 2;
                    },
                    '\\' => {
                        dest[pos] = '\\';
                        pos += 1;
                        i += 2;
                    },
                    '"' => {
                        dest[pos] = '"';
                        pos += 1;
                        i += 2;
                    },
                    else => {
                        dest[pos] = src[i];
                        pos += 1;
                        i += 1;
                    },
                }
            } else {
                dest[pos] = src[i];
                pos += 1;
                i += 1;
            }
        }
        return dest[0..pos];
    }

    fn jsonEscape(dest: []u8, src: []const u8) usize {
        var pos: usize = 0;
        for (src) |ch| {
            if (pos >= dest.len - 6) break;
            switch (ch) {
                '"' => {
                    dest[pos] = '\\';
                    dest[pos + 1] = '"';
                    pos += 2;
                },
                '\\' => {
                    dest[pos] = '\\';
                    dest[pos + 1] = '\\';
                    pos += 2;
                },
                '\n' => {
                    dest[pos] = '\\';
                    dest[pos + 1] = 'n';
                    pos += 2;
                },
                '\r' => {
                    dest[pos] = '\\';
                    dest[pos + 1] = 'r';
                    pos += 2;
                },
                '\t' => {
                    dest[pos] = '\\';
                    dest[pos + 1] = 't';
                    pos += 2;
                },
                else => |c| {
                    if (c < 0x20) {
                        // Skip control chars
                    } else {
                        dest[pos] = c;
                        pos += 1;
                    }
                },
            }
        }
        return pos;
    }

    /// Extract a string value from JSON: "key":"value" → "value"
    fn extractString(json: []const u8, key: []const u8) []const u8 {
        const key_pos = std.mem.indexOf(u8, json, key) orelse return "";
        const after_key = json[key_pos + key.len ..];
        // Skip :"
        const colon = std.mem.indexOf(u8, after_key, "\"") orelse return "";
        const val_start = after_key[colon + 1 ..];
        // Handle escape sequences in the value
        var end: usize = 0;
        while (end < val_start.len) : (end += 1) {
            if (val_start[end] == '\\' and end + 1 < val_start.len) {
                end += 1; // skip escaped char
                continue;
            }
            if (val_start[end] == '"') break;
        }
        return val_start[0..end];
    }

    /// Extract an integer value from JSON: "key":42 → 42
    fn extractInt(json: []const u8, key: []const u8) i32 {
        const key_pos = std.mem.indexOf(u8, json, key) orelse return 0;
        const after_key = json[key_pos + key.len ..];
        // Skip :
        const colon = std.mem.indexOf(u8, after_key, ":") orelse return 0;
        const val_start = std.mem.trimStart(u8, after_key[colon + 1 ..], " ");
        // Parse digits
        var end: usize = 0;
        if (end < val_start.len and val_start[end] == '-') end += 1;
        while (end < val_start.len and val_start[end] >= '0' and val_start[end] <= '9') : (end += 1) {}
        if (end == 0) return 0;
        return std.fmt.parseInt(i32, val_start[0..end], 10) catch 0;
    }
};

test "Server owns state without storing an Io handle" {
    inline for (@typeInfo(Server).@"struct".fields) |field| {
        try std.testing.expect(field.type != std.Io);
        try std.testing.expect(field.type != ?std.Io);
    }

    var server = Server.init(std.testing.allocator);
    server.poll(std.testing.io);
    server.deinit(std.testing.io);
}

test "remote command JSON helpers remain local to the owner" {
    try std.testing.expectEqualStrings("write", Server.extractString("{\"op\":\"write\",\"slot\":2}", "\"op\""));
    try std.testing.expectEqual(@as(i32, 2), Server.extractInt("{\"op\":\"write\",\"slot\":2}", "\"slot\""));

    var buffer: [32]u8 = undefined;
    try std.testing.expectEqualStrings("line\nnext", Server.jsonUnescape(&buffer, "line\\nnext"));
}
