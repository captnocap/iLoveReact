//! V8 host bindings for framework/terminal/vterm.zig.
//!
//! All `__vterm_*` host fns address a specific session by name. The TUI host
//! (tui/host.ts) calls __vterm_open(name, rows, cols, shell) once on first
//! paint and stores the name; every subsequent poll/write/resize/get_row
//! threads the same string. Multiple `<Terminal session="X">` in one cart
//! each get their own independent pipe.
//!
//! `__terminal_set_cwd(name, path)` configures the working dir for the next
//! shell spawn under that session.
//!
//! Recorder/playback/semantic host fns live in framework/v8_bindings_sdk.zig
//! under the __rec_*, __play_*, __sem_* prefixes.

const std = @import("std");
const host_io = @import("host_io.zig");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const vterm = @import("terminal/vterm.zig");
const classifier = @import("terminal/classifier.zig");
const semantic = @import("terminal/semantic.zig");

// ── arg + return helpers ────────────────────────────────────────────

fn infoCtx(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = infoCtx(info);
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argF64(info: v8.FunctionCallbackInfo, idx: u32, default: f64) f64 {
    if (idx >= info.length()) return default;
    return info.getArg(idx).toF64(infoCtx(info)) catch default;
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, default: i32) i32 {
    return @intFromFloat(argF64(info, idx, @floatFromInt(default)));
}

fn argU16(info: v8.FunctionCallbackInfo, idx: u32, default: u16) u16 {
    const v = argI32(info, idx, default);
    if (v < 0) return 0;
    if (v > 65535) return 65535;
    return @intCast(v);
}

fn setReturnNum(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

/// Read the first arg as a session name. Empty/missing → DEFAULT_SESSION.
/// Caller owns the returned buffer (alloc'd) and must free it.
fn argSessionAlloc(info: v8.FunctionCallbackInfo) ?[]u8 {
    if (argToStringAlloc(info, 0)) |s| {
        if (s.len > 0) return s;
        std.heap.c_allocator.free(s);
    }
    // No name → return a heap copy of DEFAULT_SESSION so the free path is uniform.
    const dup = std.heap.c_allocator.dupe(u8, vterm.DEFAULT_SESSION) catch return null;
    return dup;
}

// ── __terminal_set_cwd(name, path) ──────────────────────────────────

fn hostTerminalSetCwd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse return;
    defer std.heap.c_allocator.free(name);
    const path = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(path);
    // Auto-create the pipe so we have somewhere to store the cwd.
    const p = vterm.ensurePipe(name, 24, 80) orelse return;
    p.setSpawnCwd(path);
}

// ── __vterm_open(name, rows, cols, shell) → 0 ok, -1 fail ──────────

var g_shell_buf: [512]u8 = undefined;

fn resolveShell(arg: ?[]const u8) [*:0]const u8 {
    // Arg wins if non-empty.
    if (arg) |s| {
        if (s.len > 0 and s.len < g_shell_buf.len) {
            @memcpy(g_shell_buf[0..s.len], s);
            g_shell_buf[s.len] = 0;
            return @ptrCast(&g_shell_buf);
        }
    }
    // Fall back to $SHELL.
    if (host_io.getEnvVarOwned(std.heap.c_allocator, "SHELL")) |env| {
        defer std.heap.c_allocator.free(env);
        if (env.len > 0 and env.len < g_shell_buf.len) {
            @memcpy(g_shell_buf[0..env.len], env);
            g_shell_buf[env.len] = 0;
            return @ptrCast(&g_shell_buf);
        }
    } else |_| {}
    // Last resort.
    const fallback = "/bin/sh";
    @memcpy(g_shell_buf[0..fallback.len], fallback);
    g_shell_buf[fallback.len] = 0;
    return @ptrCast(&g_shell_buf);
}

fn hostVtermOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse {
        setReturnNum(info, -1);
        return;
    };
    defer std.heap.c_allocator.free(name);
    const rows = argU16(info, 1, 24);
    const cols = argU16(info, 2, 80);
    const shell_arg = argToStringAlloc(info, 3);
    defer if (shell_arg) |s| std.heap.c_allocator.free(s);

    // Refuse to re-spawn into a pipe that already has a live shell.
    if (vterm.ptyAliveByName(name)) {
        setReturnNum(info, 0);
        return;
    }

    const shell_z = resolveShell(shell_arg);
    vterm.spawnShellByName(name, shell_z, rows, cols);

    if (!vterm.ptyAliveByName(name)) {
        setReturnNum(info, -1);
        return;
    }
    setReturnNum(info, 0);
}

// ── __vterm_close(name) → 1 if a pipe was torn down ────────────────

fn hostVtermClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse {
        setReturnNum(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(name);
    const ok = vterm.closePipe(name);
    setReturnNum(info, if (ok) 1 else 0);
}

// ── __vterm_poll(name) → 1 if new data was drained, else 0 ─────────

fn hostVtermPoll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse {
        setReturnNum(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(name);
    const drained = vterm.pollPtyByName(name);
    if (drained) classifier.markDirtyByName(name);
    setReturnNum(info, if (drained) 1 else 0);
}

// ── __vterm_write(name, data) ───────────────────────────────────────

fn hostVtermWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse return;
    defer std.heap.c_allocator.free(name);
    const data = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(data);
    vterm.writePtyByName(name, data);
    // Typing while scrolled-back snaps the view back to live — what
    // every terminal emulator does. Mouse-wheel scroll never calls
    // through here so it stays at its set offset until user types.
    vterm.scrollToBottomByName(name);
}

// ── __vterm_feed(name, data) ────────────────────────────────────────
//
// Dumb render: feed ANSI bytes straight into the parser/screen, no PTY.
// Creates the pipe at the default 24×80 on first feed (paintTerminal
// resizes to the laid-out grid). This is the write path for <Terminal
// dumb /> — the cart blits its own content; nothing echoes back.

fn hostVtermFeed(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse return;
    defer std.heap.c_allocator.free(name);
    const data = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(data);
    vterm.feedByName(name, 24, 80, data);
    classifier.markDirtyByName(name);
}

// ── __vterm_scroll(name, delta) ─────────────────────────────────────
//
// Positive delta → scroll DOWN (toward live view, smaller offset).
// Negative delta → scroll UP (into history, larger offset).
// Returns the new scroll offset so JS can know if we hit the limits.

fn hostVtermScroll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse {
        setReturnNum(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(name);
    const delta = argI32(info, 1, 0);
    if (delta < 0) {
        const n: u16 = @intCast(@min(-delta, 65535));
        vterm.scrollUpByName(name, n);
    } else if (delta > 0) {
        const n: u16 = @intCast(@min(delta, 65535));
        vterm.scrollDownByName(name, n);
    }
    setReturnNum(info, @floatFromInt(vterm.scrollOffsetByName(name)));
}

// ── __vterm_resize(name, rows, cols) ────────────────────────────────

fn hostVtermResize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse return;
    defer std.heap.c_allocator.free(name);
    const rows = argU16(info, 1, 24);
    const cols = argU16(info, 2, 80);
    vterm.resizeByName(name, rows, cols);
}

// ── __vterm_get_mouse_mode(name) → 0 (off), 1..3 (on) ──────────────

fn hostVtermGetMouseMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse {
        setReturnNum(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(name);
    setReturnNum(info, @floatFromInt(vterm.getMouseModeByName(name)));
}

// ── __vterm_get_row(name, row) → encoded cell string ───────────────
//
// Row encoding mirrors tui/host.ts decodeTerminalRow:
//   row     = cell *( "\x1e" cell )
//   cell    = char "\x1f" fg "\x1f" bg "\x1f" attrs
//   char    = utf-8 (single grapheme; empty → space)
//   fg/bg   = 6 hex chars (no '#'), empty string for default
//   attrs   = decimal bitmask — 0x01 bold, 0x02 italic, 0x04 underline,
//             0x08 strike, 0x10 reverse

var g_row_buf: [16 * 1024]u8 = undefined;

fn writeHex2(buf: []u8, byte: u8) void {
    const hex = "0123456789abcdef";
    buf[0] = hex[(byte >> 4) & 0xF];
    buf[1] = hex[byte & 0xF];
}

fn appendColor(buf: []u8, pos: *usize, color: ?vterm.Color) void {
    const c = color orelse return;
    if (pos.* + 6 > buf.len) return;
    writeHex2(buf[pos.*..], c.r);
    writeHex2(buf[pos.* + 2 ..], c.g);
    writeHex2(buf[pos.* + 4 ..], c.b);
    pos.* += 6;
}

fn appendU8Decimal(buf: []u8, pos: *usize, value: u8) void {
    if (value >= 100) {
        if (pos.* + 3 > buf.len) return;
        buf[pos.*] = '0' + (value / 100);
        buf[pos.* + 1] = '0' + ((value / 10) % 10);
        buf[pos.* + 2] = '0' + (value % 10);
        pos.* += 3;
    } else if (value >= 10) {
        if (pos.* + 2 > buf.len) return;
        buf[pos.*] = '0' + (value / 10);
        buf[pos.* + 1] = '0' + (value % 10);
        pos.* += 2;
    } else {
        if (pos.* + 1 > buf.len) return;
        buf[pos.*] = '0' + value;
        pos.* += 1;
    }
}

fn hostVtermGetRow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const name = argSessionAlloc(info) orelse {
        setReturnString(info, "");
        return;
    };
    defer std.heap.c_allocator.free(name);
    const row = argU16(info, 1, 0);

    const cols = vterm.getColsByName(name);
    const rows = vterm.getRowsByName(name);
    if (cols == 0 or row >= rows) {
        setReturnString(info, "");
        return;
    }

    // Scroll-aware row source. sb_scroll > 0 means the user has
    // scrolled up into history; the top `sb_scroll` viewport rows
    // show scrollback, the rest still show live cells (shifted).
    const sb_scroll = vterm.scrollOffsetByName(name);

    var pos: usize = 0;
    var col: u16 = 0;
    while (col < cols) : (col += 1) {
        if (col > 0) {
            if (pos + 1 > g_row_buf.len) break;
            g_row_buf[pos] = 0x1e; // RS — cell separator
            pos += 1;
        }
        const cell = if (row < sb_scroll)
            vterm.scrollbackCellByName(name, row, col)
        else
            vterm.getCellByName(name, row - sb_scroll, col);

        // Char (utf-8). Skip writing when empty — decoder treats the empty
        // first field as a space.
        const ch_len: usize = cell.char_len;
        if (ch_len > 0 and pos + ch_len <= g_row_buf.len) {
            // Drop NULs (vterm reports them for cells that were never
            // touched; decoder wants empty/space, not 0x00).
            if (!(ch_len == 1 and cell.char_buf[0] == 0)) {
                @memcpy(g_row_buf[pos .. pos + ch_len], cell.char_buf[0..ch_len]);
                pos += ch_len;
            }
        }

        // \x1f fg \x1f bg \x1f attrs
        if (pos + 1 > g_row_buf.len) break;
        g_row_buf[pos] = 0x1f;
        pos += 1;
        appendColor(&g_row_buf, &pos, cell.fg);
        if (pos + 1 > g_row_buf.len) break;
        g_row_buf[pos] = 0x1f;
        pos += 1;
        appendColor(&g_row_buf, &pos, cell.bg);
        if (pos + 1 > g_row_buf.len) break;
        g_row_buf[pos] = 0x1f;
        pos += 1;

        var attrs: u8 = 0;
        if (cell.bold) attrs |= 0x01;
        if (cell.italic) attrs |= 0x02;
        if (cell.underline) attrs |= 0x04;
        if (cell.strike) attrs |= 0x08;
        if (cell.reverse) attrs |= 0x10;
        appendU8Decimal(&g_row_buf, &pos, attrs);
    }

    setReturnString(info, g_row_buf[0..pos]);
}

// ── registration ────────────────────────────────────────────────────

pub fn registerVterm(_: anytype) void {
    v8_runtime.registerHostFn("__terminal_set_cwd", hostTerminalSetCwd);
    // Primary surface (new name): open is a clearer verb than spawn for a
    // call that may or may not actually fork a new shell (existing live pipe
    // is a no-op). `__vterm_spawn` is kept as an alias one line down.
    v8_runtime.registerHostFn("__vterm_open", hostVtermOpen);
    v8_runtime.registerHostFn("__vterm_spawn", hostVtermOpen);
    v8_runtime.registerHostFn("__vterm_close", hostVtermClose);
    v8_runtime.registerHostFn("__vterm_poll", hostVtermPoll);
    v8_runtime.registerHostFn("__vterm_write", hostVtermWrite);
    v8_runtime.registerHostFn("__vterm_feed", hostVtermFeed);
    v8_runtime.registerHostFn("__vterm_resize", hostVtermResize);
    v8_runtime.registerHostFn("__vterm_get_row", hostVtermGetRow);
    v8_runtime.registerHostFn("__vterm_scroll", hostVtermScroll);
    v8_runtime.registerHostFn("__vterm_get_mouse_mode", hostVtermGetMouseMode);
}

// Alias for the TUI app entry, which calls registerAll() (different
// shape from the GPU app's reflective INGREDIENTS table).
pub fn registerAll() void {
    registerVterm({});
}

pub fn tickDrain() bool {
    // Drain every live pipe; classifier dirties each one on its own.
    var any = false;
    var it = vterm.pipeIterator();
    while (it.next()) |pp| {
        const p = pp.*;
        if (!p.ptyAlive()) continue;
        if (p.pollPty()) {
            any = true;
            classifier.markDirtyByName(p.name);
        }
        // Re-classify + rebuild semantic per session when dirty.
        if (classifier.isDirtyByName(p.name)) {
            const mode = classifier.getModeByName(p.name);
            if (mode != .none and mode != .json) {
                const r = p.rows;
                var i: u16 = 0;
                while (i < r) : (i += 1) {
                    const text = vterm.getRowTextByName(p.name, i);
                    classifier.classifyAndCacheByName(p.name, i, text, r);
                }
                classifier.clearDirtyByName(p.name);
                semantic.tickByName(p.name, r);
            }
        }
    }
    return any;
}
