//! vterm.zig — libvterm FFI bridge with damage-driven updates, multiplexed
//! into N named-session pipes.
//!
//! Each `Pipe` is one self-contained terminal session: its own VTerm handle,
//! its own PTY, its own scrollback ring, its own optional recorder. Pipes
//! live in a process-global StringHashMap keyed by session name; callers
//! address them by string (see `getOrCreatePipe`, `getPipe`, `closePipe`).
//!
//! Single-Terminal carts use the implicit `"default"` session and don't
//! need to think about names. Multi-Terminal carts pass `<Terminal session="foo">`
//! and each name maps to an independent pipe.
//!
//! Terminal rendering itself is NOT done here — the engine paints from
//! cell data exposed via `Pipe.getCell` / `Pipe.getRowText` / `Pipe.dirty_rows`.

const std = @import("std");
const log = @import("../diag/log.zig");
const rec_mod = @import("recorder.zig");
const pty_mod = @import("pty.zig");

// ── Manual libvterm type declarations ───────────────────────────────
// (Zig's @cImport can't handle C bitfield structs, so we declare manually)

const VTermOpaque = opaque {};
const VTermScreenOpaque = opaque {};

const VTermPos = extern struct {
    row: c_int = 0,
    col: c_int = 0,
};

const VTermRect = extern struct {
    start_row: c_int = 0,
    end_row: c_int = 0,
    start_col: c_int = 0,
    end_col: c_int = 0,
};

// VTermColor: union { type: u8; rgb: { type, r, g, b }; indexed: { type, idx } }
// 4 bytes total
const VTermColor = extern struct {
    type: u8 = 0,
    c1: u8 = 0, // rgb.red or indexed.idx
    c2: u8 = 0, // rgb.green
    c3: u8 = 0, // rgb.blue
};

const VTERM_COLOR_DEFAULT_FG: u8 = 0x02;
const VTERM_COLOR_DEFAULT_BG: u8 = 0x04;
const VTERM_COLOR_TYPE_MASK: u8 = 0x01;
const VTERM_COLOR_INDEXED: u8 = 0x01;

// VTermScreenCell: chars[6] + width + padding + attrs(u32) + fg + bg
// attrs is a C bitfield struct — we store as u32 and extract bits manually
const VTermScreenCell = extern struct {
    chars: [6]u32 = .{ 0, 0, 0, 0, 0, 0 },
    width: u8 = 0,
    _pad1: u8 = 0,
    _pad2: u8 = 0,
    _pad3: u8 = 0,
    attrs: u32 = 0, // bitfield: bold:1 underline:2 italic:1 blink:1 reverse:1 conceal:1 strike:1 ...
    fg: VTermColor = .{},
    bg: VTermColor = .{},
};

// Attr bit extraction from the u32 attrs field
fn attrBold(attrs: u32) bool {
    return (attrs & 0x01) != 0;
}
fn attrUnderline(attrs: u32) bool {
    return ((attrs >> 1) & 0x03) != 0;
}
fn attrItalic(attrs: u32) bool {
    return ((attrs >> 3) & 0x01) != 0;
}
fn attrReverse(attrs: u32) bool {
    return ((attrs >> 5) & 0x01) != 0;
}
fn attrStrike(attrs: u32) bool {
    return ((attrs >> 7) & 0x01) != 0;
}

// VTermValue: union { boolean: c_int, number: c_int, ... }
const VTermValue = extern struct {
    boolean: c_int, // also serves as 'number' (same offset)
    _pad: [12]u8 = undefined, // rest of union (VTermStringFragment is larger)
};

// Constants
const VTERM_PROP_CURSORVISIBLE: c_int = 1;
const VTERM_PROP_ALTSCREEN: c_int = 3;
// From deps/libvterm/include/vterm.h enum VTermProp (CURSORVISIBLE=1,
// CURSORBLINK=2, ALTSCREEN=3, TITLE=4, ICONNAME=5, REVERSE=6, CURSORSHAPE=7,
// MOUSE=8). Values: 0=none, 1=click, 2=drag, 3=any-motion.
const VTERM_PROP_MOUSE: c_int = 8;
const VTERM_DAMAGE_ROW: c_int = 1;

// Callback function pointer types
const DamageFn = *const fn (VTermRect, ?*anyopaque) callconv(.c) c_int;
const MoverectFn = *const fn (VTermRect, VTermRect, ?*anyopaque) callconv(.c) c_int;
const MovecursorFn = *const fn (VTermPos, VTermPos, c_int, ?*anyopaque) callconv(.c) c_int;
const SettermpropFn = *const fn (c_int, [*c]VTermValue, ?*anyopaque) callconv(.c) c_int;
const BellFn = *const fn (?*anyopaque) callconv(.c) c_int;
const ResizeFn = *const fn (c_int, c_int, ?*anyopaque) callconv(.c) c_int;
const SbPushlineFn = *const fn (c_int, [*c]const VTermScreenCell, ?*anyopaque) callconv(.c) c_int;
const SbPoplineFn = *const fn (c_int, [*c]VTermScreenCell, ?*anyopaque) callconv(.c) c_int;

const VTermScreenCallbacks = extern struct {
    damage: ?DamageFn = null,
    moverect: ?MoverectFn = null,
    movecursor: ?MovecursorFn = null,
    settermprop: ?SettermpropFn = null,
    bell: ?BellFn = null,
    resize: ?ResizeFn = null,
    sb_pushline: ?SbPushlineFn = null,
    sb_popline: ?SbPoplineFn = null,
};

// ── libvterm extern functions ───────────────────────────────────────

extern "vterm" fn vterm_new(rows: c_int, cols: c_int) ?*VTermOpaque;
extern "vterm" fn vterm_free(vt: *VTermOpaque) void;
extern "vterm" fn vterm_set_size(vt: *VTermOpaque, rows: c_int, cols: c_int) void;
extern "vterm" fn vterm_set_utf8(vt: *VTermOpaque, is_utf8: c_int) void;
extern "vterm" fn vterm_input_write(vt: *VTermOpaque, bytes: [*]const u8, len: usize) usize;
extern "vterm" fn vterm_output_read(vt: *VTermOpaque, buffer: [*]u8, len: usize) usize;
extern "vterm" fn vterm_obtain_screen(vt: *VTermOpaque) *VTermScreenOpaque;
extern "vterm" fn vterm_screen_set_callbacks(screen: *VTermScreenOpaque, callbacks: *const VTermScreenCallbacks, user: ?*anyopaque) void;
extern "vterm" fn vterm_screen_enable_altscreen(screen: *VTermScreenOpaque, altscreen: c_int) void;
extern "vterm" fn vterm_screen_enable_reflow(screen: *VTermScreenOpaque, reflow: c_int) void;
extern "vterm" fn vterm_screen_reset(screen: *VTermScreenOpaque, hard: c_int) void;
extern "vterm" fn vterm_screen_flush_damage(screen: *VTermScreenOpaque) void;
extern "vterm" fn vterm_screen_set_damage_merge(screen: *VTermScreenOpaque, size: c_int) void;
extern "vterm" fn vterm_screen_get_text(screen: *const VTermScreenOpaque, str: [*]u8, len: usize, rect: VTermRect) usize;
extern "vterm" fn vterm_screen_get_cell(screen: *const VTermScreenOpaque, pos: VTermPos, cell: *VTermScreenCell) c_int;
extern "vterm" fn vterm_screen_is_eol(screen: *const VTermScreenOpaque, pos: VTermPos) c_int;
extern "vterm" fn vterm_screen_convert_color_to_rgb(screen: *const VTermScreenOpaque, col: *VTermColor) void;

// ── Public types ────────────────────────────────────────────────────

pub const Color = struct {
    r: u8,
    g: u8,
    b: u8,
};

pub const Cell = struct {
    char_buf: [4]u8 = .{ 0, 0, 0, 0 },
    char_len: u8 = 0,
    width: u8 = 1,
    fg: ?Color = null,
    bg: ?Color = null,
    bold: bool = false,
    italic: bool = false,
    underline: bool = false,
    strike: bool = false,
    reverse: bool = false,
};

/// Conventional name used by single-Terminal carts. `getOrCreatePipe`
/// auto-uses this when no session is specified.
pub const DEFAULT_SESSION: []const u8 = "default";

/// Legacy cap kept for older call sites that index a fixed range. The map
/// itself has no fixed cap — sessions can be created and closed at will.
pub const MAX_TERMINALS: u8 = 16;

// Scrollback ring sizing. Per-Pipe; for N sessions you pay N × this.
const SB_MAX_LINES: u16 = 500;
const SB_MAX_COLS: u16 = 200;

// ── Pipe — one terminal session ─────────────────────────────────────

pub const Pipe = struct {
    /// Owned dupe; freed in `deinit`. Map key shares this slice.
    name: []const u8,

    // libvterm
    handle: *VTermOpaque,
    screen: *VTermScreenOpaque,
    rows: u16,
    cols: u16,

    // Damage tracking (set by callbacks)
    dirty_rows: [256]bool = [_]bool{false} ** 256,
    has_damage: bool = false,
    scrolled: bool = false,

    // Cursor state (set by movecursor callback)
    cursor_row: u16 = 0,
    cursor_col: u16 = 0,
    cursor_visible: bool = true,
    cursor_moved: bool = false,

    // Render lifecycle (set by settermprop callback)
    render_in_progress: bool = false,
    render_completed: bool = false,
    alt_screen: bool = false,
    // Mouse mode the inner program asked for via DECSET (1000/1002/1003). 0
    // means the program isn't tracking mouse events; the GPU host then owns
    // mouse for selection. Nonzero means we forward mouse events as SGR (1006)
    // sequences to the PTY instead of doing host-side selection.
    mouse_mode: c_int = 0,

    // Reusable cell buffer (avoids stack allocation in every getCell call)
    cell_buf: VTermScreenCell = .{},

    // PTY
    pty: ?pty_mod.Pty = null,
    spawn_cwd_buf: [std.fs.max_path_bytes]u8 = undefined,
    spawn_cwd_len: usize = 0,

    // Optional recorder. Lazy because every active pipe paying ~5MB of
    // recorder BSS would be wasteful when most aren't recording.
    recorder: ?*rec_mod.Recorder = null,
    recording_active: bool = false,

    // Scratch buffer for getRowText
    text_buf: [2048]u8 = undefined,

    // Scrollback ring — populated by cb_sb_pushline, read by paint/copy.
    sb_lines: [SB_MAX_LINES][SB_MAX_COLS]Cell = undefined,
    sb_col_count: [SB_MAX_LINES]u16 = [_]u16{0} ** SB_MAX_LINES,
    sb_head: u16 = 0, // next write position (ring)
    sb_count: u16 = 0, // total lines stored (capped at SB_MAX_LINES)
    sb_scroll: u16 = 0, // scroll offset: 0 = live view, >0 = scrolled up N lines

    fn initInternal(name_dup: []const u8, rows: u16, cols: u16) !Pipe {
        const handle = vterm_new(@intCast(rows), @intCast(cols)) orelse
            return error.VTermCreateFailed;
        vterm_set_utf8(handle, 1);

        const screen = vterm_obtain_screen(handle);
        vterm_screen_enable_altscreen(screen, 1);
        vterm_screen_enable_reflow(screen, 1);
        vterm_screen_set_damage_merge(screen, VTERM_DAMAGE_ROW);
        vterm_screen_reset(screen, 1);

        return Pipe{
            .name = name_dup,
            .handle = handle,
            .screen = screen,
            .rows = rows,
            .cols = cols,
        };
    }

    pub fn feedData(self: *Pipe, data: []const u8) void {
        if (data.len == 0) return;
        // Re-register callbacks every feed because `self` may have moved
        // since the last call (we live behind a heap pointer but the map
        // grow path could in principle relocate; cheap enough to redo).
        vterm_screen_set_callbacks(self.screen, &screen_callbacks, @ptrCast(self));
        _ = vterm_input_write(self.handle, data.ptr, data.len);
        vterm_screen_flush_damage(self.screen);
    }

    pub fn readOutputData(self: *Pipe, buf: []u8) ?[]const u8 {
        const len = vterm_output_read(self.handle, buf.ptr, buf.len);
        if (len > 0) return buf[0..len];
        return null;
    }

    pub fn getRowText(self: *Pipe, row: u16) []const u8 {
        const rect = VTermRect{
            .start_row = @intCast(row),
            .end_row = @intCast(row + 1),
            .start_col = 0,
            .end_col = @intCast(self.cols),
        };
        const len = vterm_screen_get_text(self.screen, &self.text_buf, self.text_buf.len, rect);
        if (len == 0) return self.text_buf[0..0];

        // Trim trailing spaces
        var end: usize = len;
        while (end > 0 and self.text_buf[end - 1] == ' ') end -= 1;
        return self.text_buf[0..end];
    }

    pub fn getCell(self: *Pipe, row: u16, col: u16) Cell {
        const pos = VTermPos{ .row = @intCast(row), .col = @intCast(col) };
        _ = vterm_screen_get_cell(self.screen, pos, &self.cell_buf);

        var result = Cell{
            .width = if (self.cell_buf.width > 0) self.cell_buf.width else 1,
            .bold = attrBold(self.cell_buf.attrs),
            .italic = attrItalic(self.cell_buf.attrs),
            .underline = attrUnderline(self.cell_buf.attrs),
            .strike = attrStrike(self.cell_buf.attrs),
            .reverse = attrReverse(self.cell_buf.attrs),
        };

        // Decode Unicode codepoint to UTF-8
        const cp = self.cell_buf.chars[0];
        if (cp > 0) encodeCodepoint(cp, &result);

        // Resolve colors
        result.fg = resolveColor(self.screen, &self.cell_buf.fg);
        result.bg = resolveColor(self.screen, &self.cell_buf.bg);

        return result;
    }

    pub fn resizeTerminal(self: *Pipe, new_rows: u16, new_cols: u16) void {
        self.rows = new_rows;
        self.cols = new_cols;
        vterm_set_size(self.handle, @intCast(new_rows), @intCast(new_cols));
        if (self.pty) |*p| p.resize(new_rows, new_cols);
    }

    pub fn clearDamage(self: *Pipe) void {
        self.dirty_rows = [_]bool{false} ** 256;
        self.has_damage = false;
        self.scrolled = false;
        self.cursor_moved = false;
        self.render_completed = false;
    }

    pub fn setSpawnCwd(self: *Pipe, path: []const u8) void {
        const len = @min(path.len, self.spawn_cwd_buf.len - 1);
        @memcpy(self.spawn_cwd_buf[0..len], path[0..len]);
        self.spawn_cwd_buf[len] = 0;
        self.spawn_cwd_len = len;
    }

    pub fn spawnShell(self: *Pipe, io: std.Io, shell: [*:0]const u8, rows: u16, cols: u16) void {
        if (self.pty != null) self.closePty();
        if (rows != self.rows or cols != self.cols) self.resizeTerminal(rows, cols);

        const cwd: ?[*:0]const u8 =
            if (self.spawn_cwd_len > 0) @ptrCast(&self.spawn_cwd_buf) else null;
        self.pty = pty_mod.openPty(g_alloc, io, .{
            .shell = shell,
            .rows = rows,
            .cols = cols,
            .cwd = cwd,
        }) catch |err| {
            log.print("[vterm:{s}] spawnShell failed: {}\n", .{ self.name, err });
            return;
        };
        log.print("[vterm:{s}] shell spawned: {s} ({d}x{d})\n", .{ self.name, std.mem.span(shell), cols, rows });
    }

    /// Drain PTY → vterm → flush vterm responses back. Returns true if new
    /// data was received. Loops up to 32×8KB to absorb large redraws (Claude
    /// Code's full-screen output is 100KB+ in one go).
    pub fn pollPty(self: *Pipe, io: std.Io) bool {
        var p = &(self.pty orelse return false);
        var got_data = false;
        var iters: u32 = 0;
        while (iters < 32) : (iters += 1) {
            const data = p.readData() orelse break;
            got_data = true;
            if (self.recording_active) {
                if (self.recorder) |r| {
                    const now_us: u64 = @intCast(@max(0, std.Io.Clock.now(.awake, io).toMicroseconds()));
                    r.capture(now_us, data);
                }
            }
            self.feedData(data);
        }
        if (got_data) {
            var out_buf: [4096]u8 = undefined;
            if (self.readOutputData(&out_buf)) |response| {
                _ = p.writeData(response);
            }
        }
        return got_data;
    }

    pub fn writePty(self: *Pipe, data: []const u8) void {
        var p = &(self.pty orelse {
            log.print("[vterm:{s}] writePty: no PTY open!\n", .{self.name});
            return;
        });
        const ok = p.writeData(data);
        log.print("[vterm:{s}] writePty: {d} bytes, ok={}\n", .{ self.name, data.len, ok });
    }

    pub fn ptyAlive(self: *Pipe) bool {
        var p = &(self.pty orelse return false);
        return p.alive();
    }

    pub fn closePty(self: *Pipe) void {
        if (self.pty) |*p| {
            p.closePty();
            self.pty = null;
        }
    }

    // ── Scrollback ──────────────────────────────────────────────────

    /// Get a cell from scrollback. `display_row` is 0..sb_scroll-1, where
    /// 0 = oldest visible scrollback line when scrolled up by `sb_scroll`.
    pub fn getScrollbackCell(self: *Pipe, display_row: u16, col: u16) Cell {
        if (display_row >= self.sb_scroll or display_row >= self.sb_count) return Cell{};
        if (col >= SB_MAX_COLS) return Cell{};
        // display_row 0 = oldest visible = age sb_scroll
        // display_row (sb_scroll-1) = newest visible = age 1
        const age = self.sb_scroll - display_row;
        const idx = (self.sb_head + SB_MAX_LINES - age) % SB_MAX_LINES;
        if (col >= self.sb_col_count[idx]) return Cell{};
        return self.sb_lines[idx][col];
    }

    pub fn scrollbackCount(self: *const Pipe) u16 {
        return self.sb_count;
    }

    pub fn scrollOffset(self: *const Pipe) u16 {
        return self.sb_scroll;
    }

    pub fn scrollUp(self: *Pipe, n: u16) void {
        self.sb_scroll = @min(self.sb_scroll + n, self.sb_count);
    }

    pub fn scrollDown(self: *Pipe, n: u16) void {
        if (n >= self.sb_scroll) {
            self.sb_scroll = 0;
        } else {
            self.sb_scroll -= n;
        }
    }

    pub fn scrollToBottom(self: *Pipe) void {
        self.sb_scroll = 0;
    }

    /// Extract text from a rectangular selection region (viewport coordinates).
    /// Handles scrollback vs live rows automatically. Returns bytes written.
    pub fn copySelectedText(
        self: *Pipe,
        start_row: u16,
        start_col: u16,
        end_row: u16,
        end_col: u16,
        buf: []u8,
    ) usize {
        // Normalize: ensure start before end
        var r0 = start_row;
        var c0 = start_col;
        var r1 = end_row;
        var c1 = end_col;
        if (r0 > r1 or (r0 == r1 and c0 > c1)) {
            r0 = end_row;
            c0 = end_col;
            r1 = start_row;
            c1 = start_col;
        }

        const sb_vis = self.sb_scroll;
        var pos: usize = 0;

        var row = r0;
        while (row <= r1) : (row += 1) {
            if (row > r0 and pos < buf.len - 1) {
                buf[pos] = '\n';
                pos += 1;
            }
            const cstart: u16 = if (row == r0) c0 else 0;
            const cend: u16 = if (row == r1) c1 + 1 else self.cols;

            var last_nonspace = pos;
            var col = cstart;
            while (col < cend and pos < buf.len - 4) : (col += 1) {
                const cell = if (row < sb_vis)
                    self.getScrollbackCell(row, col)
                else
                    self.getCell(row - sb_vis, col);

                if (cell.char_len > 0) {
                    for (0..cell.char_len) |j| {
                        if (pos < buf.len) {
                            buf[pos] = cell.char_buf[j];
                            pos += 1;
                        }
                    }
                    if (cell.char_buf[0] != ' ') last_nonspace = pos;
                } else {
                    if (pos < buf.len) {
                        buf[pos] = ' ';
                        pos += 1;
                    }
                }
            }
            pos = last_nonspace; // trim trailing spaces
        }
        return pos;
    }

    // ── Recording ───────────────────────────────────────────────────

    pub fn startRecording(self: *Pipe, io: std.Io) void {
        if (self.recorder == null) {
            self.recorder = g_alloc.create(rec_mod.Recorder) catch return;
            self.recorder.?.* = .{};
        }
        const now_us: u64 = @intCast(@max(0, std.Io.Clock.now(.awake, io).toMicroseconds()));
        self.recorder.?.start(now_us, self.rows, self.cols);
        self.recording_active = true;
    }

    pub fn stopRecording(self: *Pipe) void {
        if (self.recorder) |r| r.stop();
        self.recording_active = false;
    }

    pub fn saveRecording(self: *Pipe, io: std.Io, path: []const u8) bool {
        const r = self.recorder orelse return false;
        return r.save(io, path);
    }

    fn deinit(self: *Pipe) void {
        self.closePty();
        vterm_free(self.handle);
        if (self.recorder) |r| {
            g_alloc.destroy(r);
            self.recorder = null;
        }
        g_alloc.free(self.name);
    }
};

// ── Color resolution ────────────────────────────────────────────────

fn resolveColor(screen: *const VTermScreenOpaque, col: *VTermColor) ?Color {
    if (col.type & VTERM_COLOR_DEFAULT_FG != 0) return null;
    if (col.type & VTERM_COLOR_DEFAULT_BG != 0) return null;

    if (col.type & VTERM_COLOR_TYPE_MASK == VTERM_COLOR_INDEXED) {
        var tmp = col.*;
        vterm_screen_convert_color_to_rgb(screen, &tmp);
        return Color{ .r = tmp.c1, .g = tmp.c2, .b = tmp.c3 };
    }

    return Color{ .r = col.c1, .g = col.c2, .b = col.c3 };
}

fn encodeCodepoint(cp: u32, result: *Cell) void {
    if (cp < 0x80) {
        result.char_buf[0] = @intCast(cp);
        result.char_len = 1;
    } else if (cp < 0x800) {
        result.char_buf[0] = @intCast(0xC0 | (cp >> 6));
        result.char_buf[1] = @intCast(0x80 | (cp & 0x3F));
        result.char_len = 2;
    } else if (cp < 0x10000) {
        result.char_buf[0] = @intCast(0xE0 | (cp >> 12));
        result.char_buf[1] = @intCast(0x80 | ((cp >> 6) & 0x3F));
        result.char_buf[2] = @intCast(0x80 | (cp & 0x3F));
        result.char_len = 3;
    } else if (cp <= 0x10FFFF) {
        result.char_buf[0] = @intCast(0xF0 | (cp >> 18));
        result.char_buf[1] = @intCast(0x80 | ((cp >> 12) & 0x3F));
        result.char_buf[2] = @intCast(0x80 | ((cp >> 6) & 0x3F));
        result.char_buf[3] = @intCast(0x80 | (cp & 0x3F));
        result.char_len = 4;
    }
}

// ── libvterm callbacks ──────────────────────────────────────────────
//
// The user pointer is *Pipe. Pipes are heap-allocated and pinned for their
// lifetime, so storing &pipe in libvterm is stable.

fn getPipeFromUser(user: ?*anyopaque) ?*Pipe {
    if (user) |ptr| return @ptrCast(@alignCast(ptr));
    return null;
}

fn cb_damage(rect: VTermRect, user: ?*anyopaque) callconv(.c) c_int {
    const self = getPipeFromUser(user) orelse return 0;
    var r: usize = @intCast(rect.start_row);
    const end: usize = @intCast(rect.end_row);
    while (r < end) : (r += 1) {
        if (r < 256) self.dirty_rows[r] = true;
    }
    self.has_damage = true;
    return 0;
}

fn cb_moverect(dest: VTermRect, src: VTermRect, user: ?*anyopaque) callconv(.c) c_int {
    const self = getPipeFromUser(user) orelse return 0;
    var r: usize = @intCast(dest.start_row);
    while (r < @as(usize, @intCast(dest.end_row))) : (r += 1) {
        if (r < 256) self.dirty_rows[r] = true;
    }
    r = @intCast(src.start_row);
    while (r < @as(usize, @intCast(src.end_row))) : (r += 1) {
        if (r < 256) self.dirty_rows[r] = true;
    }
    self.has_damage = true;
    self.scrolled = true;
    return 0;
}

fn cb_movecursor(pos: VTermPos, _: VTermPos, visible: c_int, user: ?*anyopaque) callconv(.c) c_int {
    const self = getPipeFromUser(user) orelse return 0;
    self.cursor_row = @intCast(pos.row);
    self.cursor_col = @intCast(pos.col);
    self.cursor_visible = (visible != 0);
    self.cursor_moved = true;
    return 0;
}

fn cb_settermprop(prop: c_int, val: [*c]VTermValue, user: ?*anyopaque) callconv(.c) c_int {
    const self = getPipeFromUser(user) orelse return 0;

    if (prop == VTERM_PROP_CURSORVISIBLE) {
        const was_visible = self.cursor_visible;
        self.cursor_visible = (val[0].boolean != 0);
        if (was_visible and !self.cursor_visible) {
            self.render_in_progress = true;
        } else if (!was_visible and self.cursor_visible) {
            self.render_in_progress = false;
            self.render_completed = true;
        }
    } else if (prop == VTERM_PROP_ALTSCREEN) {
        self.alt_screen = (val[0].boolean != 0);
    } else if (prop == VTERM_PROP_MOUSE) {
        // Inner program enabled (or disabled) mouse reporting. We use this
        // as the gate for whether the GPU host forwards clicks to the PTY.
        // VTermValue is a union { boolean, number, … } and the Zig binding
        // only declares the `boolean` slot — but `number` lives at the same
        // offset, so reading via .boolean yields the correct c_int payload.
        self.mouse_mode = val[0].boolean;
    }
    return 1;
}

fn cb_bell(_: ?*anyopaque) callconv(.c) c_int {
    return 0;
}

fn cb_resize(_: c_int, _: c_int, _: ?*anyopaque) callconv(.c) c_int {
    return 0;
}

fn cb_sb_pushline(cols_count: c_int, cells: [*c]const VTermScreenCell, user: ?*anyopaque) callconv(.c) c_int {
    const self = getPipeFromUser(user) orelse return 0;
    const ncols: usize = @intCast(@min(cols_count, SB_MAX_COLS));

    for (0..ncols) |i| {
        const vcell = cells[i];
        var result = Cell{
            .width = if (vcell.width > 0) vcell.width else 1,
            .bold = attrBold(vcell.attrs),
            .italic = attrItalic(vcell.attrs),
            .underline = attrUnderline(vcell.attrs),
            .strike = attrStrike(vcell.attrs),
            .reverse = attrReverse(vcell.attrs),
        };
        const cp = vcell.chars[0];
        if (cp > 0) encodeCodepoint(cp, &result);

        var fg_copy = vcell.fg;
        var bg_copy = vcell.bg;
        result.fg = resolveColor(self.screen, &fg_copy);
        result.bg = resolveColor(self.screen, &bg_copy);
        self.sb_lines[self.sb_head][i] = result;
    }
    for (ncols..SB_MAX_COLS) |i| self.sb_lines[self.sb_head][i] = Cell{};
    self.sb_col_count[self.sb_head] = @intCast(ncols);

    self.sb_head = (self.sb_head + 1) % SB_MAX_LINES;
    if (self.sb_count < SB_MAX_LINES) self.sb_count += 1;

    return 0; // we store for our own scrollback but don't support sb_popline
}

fn cb_sb_popline(_: c_int, _: [*c]VTermScreenCell, _: ?*anyopaque) callconv(.c) c_int {
    return 0;
}

const screen_callbacks = VTermScreenCallbacks{
    .damage = &cb_damage,
    .moverect = &cb_moverect,
    .movecursor = &cb_movecursor,
    .settermprop = &cb_settermprop,
    .bell = &cb_bell,
    .resize = &cb_resize,
    .sb_pushline = &cb_sb_pushline,
    .sb_popline = &cb_sb_popline,
};

// ── Pipe registry ───────────────────────────────────────────────────

const g_alloc = std.heap.c_allocator;
var g_pipes: ?std.StringHashMap(*Pipe) = null;

fn ensureMap() *std.StringHashMap(*Pipe) {
    if (g_pipes == null) {
        g_pipes = std.StringHashMap(*Pipe).init(g_alloc);
    }
    return &g_pipes.?;
}

/// Look up a pipe by name. Returns null if it doesn't exist yet.
pub fn getPipe(name: []const u8) ?*Pipe {
    if (g_pipes == null) return null;
    return g_pipes.?.get(name);
}

/// Look up or create a pipe with the given session name. Initial size
/// is used only on creation; existing pipes keep their current size.
pub fn getOrCreatePipe(name: []const u8, rows: u16, cols: u16) ?*Pipe {
    const map = ensureMap();
    if (map.get(name)) |p| return p;

    const name_dup = g_alloc.dupe(u8, name) catch {
        log.print("[vterm] failed to dupe session name\n", .{});
        return null;
    };
    const pipe = g_alloc.create(Pipe) catch {
        g_alloc.free(name_dup);
        return null;
    };
    pipe.* = Pipe.initInternal(name_dup, rows, cols) catch |err| {
        log.print("[vterm] Pipe.init failed: {}\n", .{err});
        g_alloc.destroy(pipe);
        g_alloc.free(name_dup);
        return null;
    };
    // Register callbacks with the heap-stable Pipe pointer.
    vterm_screen_set_callbacks(pipe.screen, &screen_callbacks, @ptrCast(pipe));
    // Clear initial damage from the reset inside initInternal.
    pipe.clearDamage();

    map.put(pipe.name, pipe) catch {
        pipe.deinit();
        g_alloc.destroy(pipe);
        return null;
    };
    return pipe;
}

/// Tear down a pipe by name (closes PTY, frees vterm + recorder + buffer).
/// Safe to call on a name that doesn't exist.
pub fn closePipe(name: []const u8) bool {
    if (g_pipes == null) return false;
    const entry = g_pipes.?.fetchRemove(name) orelse return false;
    entry.value.deinit();
    g_alloc.destroy(entry.value);
    return true;
}

/// Iterator over all live pipes. Stable for the duration of the engine
/// tick provided no closePipe/getOrCreatePipe is called mid-iteration.
pub fn pipeIterator() std.StringHashMap(*Pipe).ValueIterator {
    return ensureMap().valueIterator();
}

pub fn pipeCount() usize {
    if (g_pipes == null) return 0;
    return g_pipes.?.count();
}

// ── Default-session helpers ─────────────────────────────────────────
// These let single-Terminal carts and legacy call sites address the
// "default" pipe without naming it. New code should use the named API.

fn defaultOrCreate(rows: u16, cols: u16) ?*Pipe {
    return getOrCreatePipe(DEFAULT_SESSION, rows, cols);
}

pub fn initVterm(rows: u16, cols: u16) void {
    _ = defaultOrCreate(rows, cols);
}

pub fn feed(data: []const u8) void {
    if (getPipe(DEFAULT_SESSION)) |p| p.feedData(data);
}

pub fn readOutput(buf: []u8) ?[]const u8 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.readOutputData(buf);
    return null;
}

pub fn getRowText(row: u16) []const u8 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.getRowText(row);
    return "";
}

pub fn getCell(row: u16, col: u16) Cell {
    if (getPipe(DEFAULT_SESSION)) |p| return p.getCell(row, col);
    return Cell{};
}

pub fn getCursorRow() u16 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.cursor_row;
    return 0;
}

pub fn getCursorCol() u16 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.cursor_col;
    return 0;
}

pub fn getCursorVisible() bool {
    if (getPipe(DEFAULT_SESSION)) |p| return p.cursor_visible;
    return false;
}

pub fn hasDamage() bool {
    if (getPipe(DEFAULT_SESSION)) |p| return p.has_damage;
    return false;
}

pub fn clearDamageState() void {
    if (getPipe(DEFAULT_SESSION)) |p| p.clearDamage();
}

pub fn getRows() u16 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.rows;
    return 0;
}

pub fn getCols() u16 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.cols;
    return 0;
}

pub fn resizeVterm(rows: u16, cols: u16) void {
    if (getPipe(DEFAULT_SESSION)) |p| p.resizeTerminal(rows, cols);
}

pub fn setSpawnCwd(path: []const u8) void {
    const p = defaultOrCreate(24, 80) orelse return;
    p.setSpawnCwd(path);
}

pub fn spawnShell(io: std.Io, shell: [*:0]const u8, rows: u16, cols: u16) void {
    const p = defaultOrCreate(rows, cols) orelse return;
    p.spawnShell(io, shell, rows, cols);
}

pub fn pollPty(io: std.Io) bool {
    if (getPipe(DEFAULT_SESSION)) |p| return p.pollPty(io);
    return false;
}

pub fn writePty(data: []const u8) void {
    if (getPipe(DEFAULT_SESSION)) |p| p.writePty(data);
}

pub fn ptyAlive() bool {
    if (getPipe(DEFAULT_SESSION)) |p| return p.ptyAlive();
    return false;
}

pub fn closePty() void {
    if (getPipe(DEFAULT_SESSION)) |p| p.closePty();
}

pub fn deinit() void {
    if (g_pipes == null) return;
    var it = g_pipes.?.valueIterator();
    while (it.next()) |pp| {
        pp.*.deinit();
        g_alloc.destroy(pp.*);
    }
    g_pipes.?.deinit();
    g_pipes = null;
}

// Scrollback (default session)
pub fn getScrollbackCell(display_row: u16, col: u16) Cell {
    if (getPipe(DEFAULT_SESSION)) |p| return p.getScrollbackCell(display_row, col);
    return Cell{};
}
pub fn scrollbackCount() u16 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.scrollbackCount();
    return 0;
}
pub fn scrollOffset() u16 {
    if (getPipe(DEFAULT_SESSION)) |p| return p.scrollOffset();
    return 0;
}
pub fn scrollUp(n: u16) void {
    if (getPipe(DEFAULT_SESSION)) |p| p.scrollUp(n);
}
pub fn scrollDown(n: u16) void {
    if (getPipe(DEFAULT_SESSION)) |p| p.scrollDown(n);
}
pub fn scrollToBottom() void {
    if (getPipe(DEFAULT_SESSION)) |p| p.scrollToBottom();
}
pub fn copySelectedText(
    start_row: u16,
    start_col: u16,
    end_row: u16,
    end_col: u16,
    buf: []u8,
) usize {
    if (getPipe(DEFAULT_SESSION)) |p|
        return p.copySelectedText(start_row, start_col, end_row, end_col, buf);
    return 0;
}

// Recording (default session — legacy entry points)
pub fn startRecording(io: std.Io, rows: u16, cols: u16) void {
    const p = defaultOrCreate(rows, cols) orelse return;
    p.startRecording(io);
}
pub fn stopRecording() void {
    if (getPipe(DEFAULT_SESSION)) |p| p.stopRecording();
}
pub fn saveRecording(io: std.Io, path: []const u8) bool {
    const p = getPipe(DEFAULT_SESSION) orelse return false;
    return p.saveRecording(io, path);
}
pub fn isRecording() bool {
    if (getPipe(DEFAULT_SESSION)) |p| return p.recording_active;
    return false;
}
pub fn getRecorder() ?*const rec_mod.Recorder {
    if (getPipe(DEFAULT_SESSION)) |p| {
        if (p.recorder) |r| return r;
    }
    return null;
}

// ── Named-session helpers used by the engine + bindings ─────────────
//
// These are the preferred entry points for new code that addresses a
// specific session. They auto-create the pipe at the given dimensions
// if it doesn't exist yet (so the first paint of a Terminal node spawns
// its session). All return safe zeros when the pipe is missing AND no
// dimensions are provided — code paths that should never see a missing
// pipe use `getPipe(name).?`.

pub fn ensurePipe(name: []const u8, rows: u16, cols: u16) ?*Pipe {
    return getOrCreatePipe(name, rows, cols);
}

pub fn spawnShellByName(io: std.Io, name: []const u8, shell: [*:0]const u8, rows: u16, cols: u16) void {
    const p = getOrCreatePipe(name, rows, cols) orelse return;
    p.spawnShell(io, shell, rows, cols);
}

pub fn pollPtyByName(io: std.Io, name: []const u8) bool {
    const p = getPipe(name) orelse return false;
    return p.pollPty(io);
}

pub fn writePtyByName(name: []const u8, data: []const u8) void {
    const p = getPipe(name) orelse return;
    p.writePty(data);
}

// Dumb-render path: feed ANSI bytes straight into the parser (the screen),
// no PTY involved. Creates the pipe on first feed at the given dims; paint
// resizes it to the laid-out grid afterward. Backs <Terminal dumb />.
pub fn feedByName(name: []const u8, rows: u16, cols: u16, data: []const u8) void {
    const p = getOrCreatePipe(name, rows, cols) orelse return;
    p.feedData(data);
}

pub fn hasDamageByName(name: []const u8) bool {
    const p = getPipe(name) orelse return false;
    return p.has_damage;
}

pub fn clearDamageByName(name: []const u8) void {
    const p = getPipe(name) orelse return;
    p.clearDamage();
}

pub fn resizeByName(name: []const u8, rows: u16, cols: u16) void {
    const p = getPipe(name) orelse return;
    p.resizeTerminal(rows, cols);
}

pub fn getCellByName(name: []const u8, row: u16, col: u16) Cell {
    const p = getPipe(name) orelse return Cell{};
    return p.getCell(row, col);
}

pub fn getRowTextByName(name: []const u8, row: u16) []const u8 {
    const p = getPipe(name) orelse return "";
    return p.getRowText(row);
}

pub fn getRowsByName(name: []const u8) u16 {
    const p = getPipe(name) orelse return 0;
    return p.rows;
}

pub fn getColsByName(name: []const u8) u16 {
    const p = getPipe(name) orelse return 0;
    return p.cols;
}

pub fn getCursorRowByName(name: []const u8) u16 {
    const p = getPipe(name) orelse return 0;
    return p.cursor_row;
}

pub fn getCursorColByName(name: []const u8) u16 {
    const p = getPipe(name) orelse return 0;
    return p.cursor_col;
}

pub fn getCursorVisibleByName(name: []const u8) bool {
    const p = getPipe(name) orelse return false;
    return p.cursor_visible;
}

pub fn getMouseModeByName(name: []const u8) c_int {
    const p = getPipe(name) orelse return 0;
    return p.mouse_mode;
}

pub fn ptyAliveByName(name: []const u8) bool {
    const p = getPipe(name) orelse return false;
    return p.ptyAlive();
}

pub fn scrollbackCellByName(name: []const u8, display_row: u16, col: u16) Cell {
    const p = getPipe(name) orelse return Cell{};
    return p.getScrollbackCell(display_row, col);
}

pub fn scrollOffsetByName(name: []const u8) u16 {
    const p = getPipe(name) orelse return 0;
    return p.scrollOffset();
}

pub fn scrollUpByName(name: []const u8, n: u16) void {
    const p = getPipe(name) orelse return;
    p.scrollUp(n);
}

pub fn scrollDownByName(name: []const u8, n: u16) void {
    const p = getPipe(name) orelse return;
    p.scrollDown(n);
}

pub fn scrollToBottomByName(name: []const u8) void {
    const p = getPipe(name) orelse return;
    p.scrollToBottom();
}

pub fn copySelectedTextByName(
    name: []const u8,
    start_row: u16,
    start_col: u16,
    end_row: u16,
    end_col: u16,
    buf: []u8,
) usize {
    const p = getPipe(name) orelse return 0;
    return p.copySelectedText(start_row, start_col, end_row, end_col, buf);
}

// ── Legacy Idx wrappers ─────────────────────────────────────────────
//
// Old engine/host code passes a u8 index. Internally we remap that to
// the synthesized session name "idx-<n>". The engine has been updated
// to call the *ByName variants directly; these stubs remain for any
// transitional caller that still hands us an integer.

var idx_name_buf: [MAX_TERMINALS][8]u8 = undefined;

fn nameForIdx(idx: u8) []const u8 {
    const i = @min(idx, MAX_TERMINALS - 1);
    const written = std.fmt.bufPrint(&idx_name_buf[i], "idx-{d}", .{i}) catch {
        idx_name_buf[i][0] = '0';
        return idx_name_buf[i][0..1];
    };
    return written;
}

pub fn scrollUpIdx(idx: u8, n: u16) void {
    scrollUpByName(nameForIdx(idx), n);
}
pub fn scrollDownIdx(idx: u8, n: u16) void {
    scrollDownByName(nameForIdx(idx), n);
}
pub fn spawnShellIdx(io: std.Io, idx: u8, shell: [*:0]const u8, rows: u16, cols: u16) void {
    spawnShellByName(io, nameForIdx(idx), shell, rows, cols);
}
pub fn resizeVtermIdx(idx: u8, rows: u16, cols: u16) void {
    resizeByName(nameForIdx(idx), rows, cols);
}
pub fn pollPtyIdx(io: std.Io, idx: u8) bool {
    return pollPtyByName(io, nameForIdx(idx));
}
pub fn ptyAliveIdx(idx: u8) bool {
    return ptyAliveByName(nameForIdx(idx));
}
pub fn getCellIdx(idx: u8, row: u16, col: u16) Cell {
    return getCellByName(nameForIdx(idx), row, col);
}
pub fn getColsIdx(idx: u8) u16 {
    return getColsByName(nameForIdx(idx));
}
pub fn getRowsIdx(idx: u8) u16 {
    return getRowsByName(nameForIdx(idx));
}
pub fn getCursorRowIdx(idx: u8) u16 {
    return getCursorRowByName(nameForIdx(idx));
}
pub fn getCursorColIdx(idx: u8) u16 {
    return getCursorColByName(nameForIdx(idx));
}
pub fn getCursorVisibleIdx(idx: u8) bool {
    return getCursorVisibleByName(nameForIdx(idx));
}
pub fn getMouseModeIdx(idx: u8) c_int {
    return getMouseModeByName(nameForIdx(idx));
}
pub fn getRowTextIdx(idx: u8, row: u16) []const u8 {
    return getRowTextByName(nameForIdx(idx), row);
}
pub fn getScrollbackCellIdx(idx: u8, display_row: u16, col: u16) Cell {
    return scrollbackCellByName(nameForIdx(idx), display_row, col);
}
pub fn scrollOffsetIdx(idx: u8) u16 {
    return scrollOffsetByName(nameForIdx(idx));
}
pub fn scrollToBottomIdx(idx: u8) void {
    scrollToBottomByName(nameForIdx(idx));
}
pub fn copySelectedTextIdx(
    idx: u8,
    start_row: u16,
    start_col: u16,
    end_row: u16,
    end_col: u16,
    buf: []u8,
) usize {
    return copySelectedTextByName(nameForIdx(idx), start_row, start_col, end_row, end_col, buf);
}
pub fn writePtyIdx(idx: u8, data: []const u8) void {
    writePtyByName(nameForIdx(idx), data);
}
