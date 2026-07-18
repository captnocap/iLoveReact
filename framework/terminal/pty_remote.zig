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
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const log = @import("../diag/log.zig");
const vterm_mod = @import("vterm.zig");
const classifier = @import("classifier.zig");
const posix = @import("../net/sysx.zig");
const host_io = @import("../host_io.zig");

const MAX_CLIENTS = 4;
const READ_BUF_SIZE = 4096;
const WRITE_BUF_SIZE = 32 * 1024;

var g_server_fd: ?posix.fd_t = null;
var g_clients: [MAX_CLIENTS]?posix.fd_t = .{null} ** MAX_CLIENTS;
var g_client_bufs: [MAX_CLIENTS][READ_BUF_SIZE]u8 = undefined;
var g_client_buf_lens: [MAX_CLIENTS]usize = .{0} ** MAX_CLIENTS;
var g_initialized = false;
var g_sock_path_buf: [256]u8 = undefined;
var g_sock_path_len: usize = 0;

pub fn init() void {
    if (g_initialized) return;

    // Linux-only: PTY remote control socket lives in /run/user/<uid>/
    if (comptime @import("builtin").os.tag != .linux) return;

    // Build socket path
    const uid = std.os.linux.getuid();
    g_sock_path_len = (std.fmt.bufPrint(&g_sock_path_buf, "/run/user/{d}/claude-sessions/supervisor.sock", .{uid}) catch return).len;
    g_sock_path_buf[g_sock_path_len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(g_sock_path_buf[0..g_sock_path_len]);

    // Remove stale socket
    _ = std.Io.Dir.cwd().deleteFile(host_io.io(), g_sock_path_buf[0..g_sock_path_len]) catch {};

    // Create unix socket
    const fd = posix.socket(posix.AF.UNIX, posix.SOCK.STREAM | posix.SOCK.NONBLOCK | posix.SOCK.CLOEXEC, 0) catch |err| {
        log.print("[pty_remote] socket failed: {}\n", .{err});
        return;
    };

    // Bind
    var addr: posix.sockaddr.un = .{ .family = posix.AF.UNIX, .path = undefined };
    @memset(&addr.path, 0);
    @memcpy(addr.path[0..g_sock_path_len], g_sock_path_buf[0..g_sock_path_len]);

    posix.bind(fd, @ptrCast(&addr), @sizeOf(posix.sockaddr.un)) catch |err| {
        log.print("[pty_remote] bind failed: {}\n", .{err});
        posix.close(fd);
        return;
    };

    // Listen
    posix.listen(fd, 4) catch |err| {
        log.print("[pty_remote] listen failed: {}\n", .{err});
        posix.close(fd);
        return;
    };

    g_server_fd = fd;
    g_initialized = true;
    log.print("[pty_remote] listening on {s}\n", .{path_z});
}

pub fn deinit() void {
    for (&g_clients) |*c| {
        if (c.*) |fd| {
            posix.close(fd);
            c.* = null;
        }
    }
    if (g_server_fd) |fd| {
        posix.close(fd);
        g_server_fd = null;
    }
    if (g_sock_path_len > 0) {
        _ = std.Io.Dir.cwd().deleteFile(host_io.io(), g_sock_path_buf[0..g_sock_path_len]) catch {};
    }
    g_initialized = false;
}

/// Call once per frame from engine main loop.
pub fn poll() void {
    if (!g_initialized) return;
    acceptNewClients();
    readClients();
}

fn acceptNewClients() void {
    const server = g_server_fd orelse return;
    // Accept up to MAX_CLIENTS
    for (&g_clients) |*slot| {
        if (slot.* != null) continue;
        const result = posix.accept(server, null, null, posix.SOCK.NONBLOCK | posix.SOCK.CLOEXEC) catch return;
        slot.* = result;
        log.print("[pty_remote] client connected\n", .{});
        return;
    }
}

fn readClients() void {
    for (0..MAX_CLIENTS) |i| {
        const fd = g_clients[i] orelse continue;
        // Read available data
        const n = posix.read(fd, g_client_bufs[i][g_client_buf_lens[i]..]) catch |err| {
            if (err == error.WouldBlock) continue;
            // Client disconnected
            posix.close(fd);
            g_clients[i] = null;
            g_client_buf_lens[i] = 0;
            log.print("[pty_remote] client disconnected\n", .{});
            continue;
        };
        if (n == 0) {
            // EOF
            posix.close(fd);
            g_clients[i] = null;
            g_client_buf_lens[i] = 0;
            continue;
        }
        g_client_buf_lens[i] += n;

        // Process complete lines (NDJSON)
        processLines(i);
    }
}

fn processLines(client_idx: usize) void {
    var buf = g_client_bufs[client_idx][0..g_client_buf_lens[client_idx]];
    while (true) {
        const nl = std.mem.indexOf(u8, buf, "\n") orelse break;
        const line = buf[0..nl];
        if (line.len > 0) {
            handleCommand(client_idx, line);
        }
        // Shift remaining data
        const remaining = buf[nl + 1 ..];
        if (remaining.len > 0) {
            std.mem.copyForwards(u8, &g_client_bufs[client_idx], remaining);
        }
        g_client_buf_lens[client_idx] = remaining.len;
        buf = g_client_bufs[client_idx][0..g_client_buf_lens[client_idx]];
    }
    // Prevent buffer overflow
    if (g_client_buf_lens[client_idx] >= READ_BUF_SIZE - 1) {
        g_client_buf_lens[client_idx] = 0;
    }
}

fn handleCommand(client_idx: usize, line: []const u8) void {
    var out_buf: [WRITE_BUF_SIZE]u8 = undefined;

    // Minimal JSON parsing — extract "op" and "slot" fields
    const op = extractString(line, "\"op\"");
    const slot = extractInt(line, "\"slot\"");

    if (std.mem.eql(u8, op, "list")) {
        const resp = listTerminals(&out_buf);
        sendResponse(client_idx, resp);
    } else if (std.mem.eql(u8, op, "write")) {
        const data = extractString(line, "\"data\"");
        if (slot < vterm_mod.MAX_TERMINALS and data.len > 0) {
            var unescape_buf: [4096]u8 = undefined;
            const unescaped = jsonUnescape(&unescape_buf, data);
            vterm_mod.writePtyIdx(@intCast(slot), unescaped);
            sendResponse(client_idx, "{\"ok\":true}\n");
        } else {
            sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot or data\"}\n");
        }
    } else if (std.mem.eql(u8, op, "read")) {
        if (slot < vterm_mod.MAX_TERMINALS) {
            const resp = readTerminal(@intCast(slot), &out_buf);
            sendResponse(client_idx, resp);
        } else {
            sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
        }
    } else if (std.mem.eql(u8, op, "read_row")) {
        const row = extractInt(line, "\"row\"");
        if (slot < vterm_mod.MAX_TERMINALS) {
            const resp = readRow(@intCast(slot), @intCast(row), &out_buf);
            sendResponse(client_idx, resp);
        } else {
            sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
        }
    } else if (std.mem.eql(u8, op, "state")) {
        if (slot < vterm_mod.MAX_TERMINALS) {
            const resp = termState(@intCast(slot), &out_buf);
            sendResponse(client_idx, resp);
        } else {
            sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
        }
    } else if (std.mem.eql(u8, op, "resize")) {
        const rows_val = extractInt(line, "\"rows\"");
        const cols_val = extractInt(line, "\"cols\"");
        if (slot < vterm_mod.MAX_TERMINALS and rows_val > 0 and cols_val > 0) {
            vterm_mod.resizeVtermIdx(@intCast(slot), @intCast(rows_val), @intCast(cols_val));
            sendResponse(client_idx, "{\"ok\":true}\n");
        } else {
            sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid params\"}\n");
        }
    } else if (std.mem.eql(u8, op, "alive")) {
        if (slot < vterm_mod.MAX_TERMINALS) {
            const alive = vterm_mod.ptyAliveIdx(@intCast(slot));
            if (alive) {
                sendResponse(client_idx, "{\"ok\":true,\"alive\":true}\n");
            } else {
                sendResponse(client_idx, "{\"ok\":true,\"alive\":false}\n");
            }
        } else {
            sendResponse(client_idx, "{\"ok\":false,\"error\":\"invalid slot\"}\n");
        }
    } else {
        sendResponse(client_idx, "{\"ok\":false,\"error\":\"unknown op\"}\n");
    }
}

fn sendResponse(client_idx: usize, data: []const u8) void {
    const fd = g_clients[client_idx] orelse return;
    _ = posix.write(fd, data) catch {};
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
