//! V8 host bindings for framework/terminal/vterm.zig.
//!
//! Two surfaces:
//!
//!   1. `__terminal_set_cwd(path)` — set the working dir for the next shell
//!      spawn. Used by the GPU host where Zig spawns shells autonomously
//!      from inside the engine tick.
//!
//!   2. `__vterm_spawn / _poll / _write / _resize / _get_row` — JS-driven
//!      PTY lifecycle for the TUI host. The TUI compositor needs to pull
//!      rendered cell rows back into JS to merge them into its character
//!      grid (see tui/host.ts:849 onward + decodeTerminalRow); the GPU
//!      host doesn't need these because it paints from Zig directly.
//!
//! Recorder/playback/semantic host fns live in
//! framework/v8_bindings_sdk.zig under the __rec_*, __play_*, __sem_*
//! prefixes (gated on HAS_TERMINAL there).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const vterm = @import("terminal/vterm.zig");

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

// ── __terminal_set_cwd ──────────────────────────────────────────────

fn hostTerminalSetCwd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(path);
    vterm.setSpawnCwd(path);
}

// ── __vterm_spawn(rows, cols, shell) → slot or -1 ───────────────────

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
    if (std.process.getEnvVarOwned(std.heap.c_allocator, "SHELL")) |env| {
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

fn hostVtermSpawn(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rows = argU16(info, 0, 24);
    const cols = argU16(info, 1, 80);
    const shell_arg = argToStringAlloc(info, 2);
    defer if (shell_arg) |s| std.heap.c_allocator.free(s);

    // vterm.zig backs a single global PTY today (MAX_TERMINALS=4 in the
    // type but storage is single-slot). Refuse a second concurrent spawn
    // so the caller gets a clear -1 instead of a silently-clobbered shell.
    if (vterm.ptyAlive()) {
        setReturnNum(info, -1);
        return;
    }

    vterm.initVterm(rows, cols);
    const shell_z = resolveShell(shell_arg);
    vterm.spawnShell(shell_z, rows, cols);

    if (!vterm.ptyAlive()) {
        setReturnNum(info, -1);
        return;
    }
    setReturnNum(info, 0);
}

// ── __vterm_poll(slot) → 1 if new data was drained, else 0 ──────────

fn hostVtermPoll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = argI32(info, 0, 0); // slot — single-slot for now
    const drained = vterm.pollPty();
    setReturnNum(info, if (drained) 1 else 0);
}

// ── __vterm_write(slot, data) ───────────────────────────────────────

fn hostVtermWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = argI32(info, 0, 0);
    const data = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(data);
    vterm.writePty(data);
    // Typing while scrolled-back snaps the view back to live — what
    // every terminal emulator does. Mouse-wheel scroll never calls
    // through here so it stays at its set offset until user types.
    vterm.scrollToBottom();
}

// ── __vterm_scroll(slot, delta) ─────────────────────────────────────
//
// Positive delta → scroll DOWN (toward live view, smaller offset).
// Negative delta → scroll UP (into history, larger offset).
// Returns the new scroll offset so JS can know if we hit the limits.

fn hostVtermScroll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = argI32(info, 0, 0);
    const delta = argI32(info, 1, 0);
    if (delta < 0) {
        const n: u16 = @intCast(@min(-delta, 65535));
        vterm.scrollUp(n);
    } else if (delta > 0) {
        const n: u16 = @intCast(@min(delta, 65535));
        vterm.scrollDown(n);
    }
    setReturnNum(info, @floatFromInt(vterm.scrollOffset()));
}

// ── __vterm_resize(slot, rows, cols) ────────────────────────────────

fn hostVtermResize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = argI32(info, 0, 0);
    const rows = argU16(info, 1, 24);
    const cols = argU16(info, 2, 80);
    vterm.resizeVterm(rows, cols);
}

// ── __vterm_get_mouse_mode(slot) → mouse mode (0 = off, 1..3 = on) ──
//
// Lets the JS TUI host decide whether to forward wheel/click events as
// SGR mouse sequences (when the inner program is tracking mouse — e.g.
// a nested TUI like claude-inner) vs handle them locally.

fn hostVtermGetMouseMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = argI32(info, 0, 0);
    setReturnNum(info, @floatFromInt(vterm.getMouseModeIdx(0)));
}

// ── __vterm_get_row(slot, row) → encoded cell string ────────────────
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
    _ = argI32(info, 0, 0);
    const row = argU16(info, 1, 0);

    const cols = vterm.getCols();
    const rows = vterm.getRows();
    if (cols == 0 or row >= rows) {
        setReturnString(info, "");
        return;
    }

    // Scroll-aware row source. sb_scroll > 0 means the user has
    // scrolled up into history; the top `sb_scroll` viewport rows
    // show scrollback, the rest still show live cells (shifted).
    const sb_scroll = vterm.scrollOffset();

    var pos: usize = 0;
    var col: u16 = 0;
    while (col < cols) : (col += 1) {
        if (col > 0) {
            if (pos + 1 > g_row_buf.len) break;
            g_row_buf[pos] = 0x1e; // RS — cell separator
            pos += 1;
        }
        const cell = if (row < sb_scroll)
            vterm.getScrollbackCell(row, col)
        else
            vterm.getCell(row - sb_scroll, col);

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
    v8_runtime.registerHostFn("__vterm_spawn", hostVtermSpawn);
    v8_runtime.registerHostFn("__vterm_poll", hostVtermPoll);
    v8_runtime.registerHostFn("__vterm_write", hostVtermWrite);
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

pub fn tickDrain() void {}
