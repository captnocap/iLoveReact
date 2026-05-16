//! vterm.zig — libvterm FFI bridge with damage-driven updates
//!
//! Engine-core: wraps libvterm for ANSI parsing, damage tracking,
//! cursor state, and cell access. Manual extern declarations because
//! @cImport can't handle libvterm's C bitfield structs.
//!
//! Terminal rendering is NOT done here — .tsz <Terminal> components
//! read dirty_rows/getCell/getRowText and render via Box+Text primitives.

const std = @import("std");
const log = @import("../diag/log.zig");
const rec_mod = @import("recorder.zig");

// ── Session recording — taps into pollPty data stream ──────────────
var g_recorder: rec_mod.Recorder = .{};
var g_recording_active: bool = false;

pub fn startRecording(rows: u16, cols: u16) void {
    g_recorder.start(rows, cols);
    g_recording_active = true;
}

pub fn stopRecording() void {
    g_recorder.stop();
    g_recording_active = false;
}

pub fn saveRecording(path: []const u8) bool {
    return g_recorder.save(path);
}

pub fn isRecording() bool {
    return g_recording_active;
}

pub fn getRecorder() *const rec_mod.Recorder {
    return &g_recorder;
}

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

pub const MAX_TERMINALS: u8 = 4;

// ── VTerm wrapper ───────────────────────────────────────────────────

pub const VTerm = struct {
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

    // Reusable cell buffer
    cell_buf: VTermScreenCell = .{},

    pub fn init(rows: u16, cols: u16) !VTerm {
        const handle = vterm_new(@intCast(rows), @intCast(cols)) orelse
            return error.VTermCreateFailed;

        vterm_set_utf8(handle, 1);

        const screen = vterm_obtain_screen(handle);
        vterm_screen_enable_altscreen(screen, 1);
        vterm_screen_enable_reflow(screen, 1);

        var self = VTerm{
            .handle = handle,
            .screen = screen,
            .rows = rows,
            .cols = cols,
        };

        // Register callbacks
        vterm_screen_set_callbacks(screen, &screen_callbacks, @ptrCast(&self));

        // Row-level damage merge
        vterm_screen_set_damage_merge(screen, VTERM_DAMAGE_ROW);

        // Reset screen
        vterm_screen_reset(screen, 1);

        // Clear initial damage from reset
        self.clearDamage();

        return self;
    }

    pub fn feedData(self: *VTerm, data: []const u8) void {
        if (data.len == 0) return;
        // Re-register callbacks (self may have moved if stored in optional)
        vterm_screen_set_callbacks(self.screen, &screen_callbacks, @ptrCast(self));
        _ = vterm_input_write(self.handle, data.ptr, data.len);
        vterm_screen_flush_damage(self.screen);
    }

    pub fn readOutputData(self: *VTerm, buf: []u8) ?[]const u8 {
        const len = vterm_output_read(self.handle, buf.ptr, buf.len);
        if (len > 0) return buf[0..len];
        return null;
    }

    pub fn getRowText(self: *VTerm, row: u16, buf: []u8) []const u8 {
        const rect = VTermRect{
            .start_row = @intCast(row),
            .end_row = @intCast(row + 1),
            .start_col = 0,
            .end_col = @intCast(self.cols),
        };
        const len = vterm_screen_get_text(self.screen, buf.ptr, buf.len, rect);
        if (len == 0) return buf[0..0];

        // Trim trailing spaces
        var end: usize = len;
        while (end > 0 and buf[end - 1] == ' ') end -= 1;
        return buf[0..end];
    }

    pub fn getCell(self: *VTerm, row: u16, col: u16) Cell {
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
        if (cp > 0) {
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

        // Resolve colors
        result.fg = resolveColor(self.screen, &self.cell_buf.fg);
        result.bg = resolveColor(self.screen, &self.cell_buf.bg);

        return result;
    }

    pub fn resizeTerminal(self: *VTerm, new_rows: u16, new_cols: u16) void {
        self.rows = new_rows;
        self.cols = new_cols;
        vterm_set_size(self.handle, @intCast(new_rows), @intCast(new_cols));
    }

    pub fn clearDamage(self: *VTerm) void {
        self.dirty_rows = [_]bool{false} ** 256;
        self.has_damage = false;
        self.scrolled = false;
        self.cursor_moved = false;
        self.render_completed = false;
    }

    pub fn deinitVterm(self: *VTerm) void {
        vterm_free(self.handle);
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

// ── libvterm callbacks ──────────────────────────────────────────────

fn getSelf(user: ?*anyopaque) ?*VTerm {
    if (user) |ptr| return @ptrCast(@alignCast(ptr));
    return null;
}

fn cb_damage(rect: VTermRect, user: ?*anyopaque) callconv(.c) c_int {
    const self = getSelf(user) orelse return 0;
    var r: usize = @intCast(rect.start_row);
    const end: usize = @intCast(rect.end_row);
    while (r < end) : (r += 1) {
        if (r < 256) self.dirty_rows[r] = true;
    }
    self.has_damage = true;
    return 0;
}

fn cb_moverect(dest: VTermRect, src: VTermRect, user: ?*anyopaque) callconv(.c) c_int {
    const self = getSelf(user) orelse return 0;
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
    const self = getSelf(user) orelse return 0;
    self.cursor_row = @intCast(pos.row);
    self.cursor_col = @intCast(pos.col);
    self.cursor_visible = (visible != 0);
    self.cursor_moved = true;
    return 0;
}

fn cb_settermprop(prop: c_int, val: [*c]VTermValue, user: ?*anyopaque) callconv(.c) c_int {
    const self = getSelf(user) orelse return 0;

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
        // offset (see comment on VTermValue above), so reading via .boolean
        // yields the correct c_int payload.
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
    const self = getSelf(user) orelse return 0;
    const ncols: usize = @intCast(@min(cols_count, SB_MAX_COLS));

    // Convert VTermScreenCells to our Cell type and store in ring buffer
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
        // UTF-8 encode the codepoint
        const cp = vcell.chars[0];
        if (cp > 0) {
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
        // Resolve colors (copy to get mutable pointers for convert_color_to_rgb)
        var fg_copy = vcell.fg;
        var bg_copy = vcell.bg;
        result.fg = resolveColor(self.screen, &fg_copy);
        result.bg = resolveColor(self.screen, &bg_copy);
        sb_lines[sb_head][i] = result;
    }
    // Clear remaining cols
    for (ncols..SB_MAX_COLS) |i| sb_lines[sb_head][i] = Cell{};
    sb_col_count[sb_head] = @intCast(ncols);

    sb_head = (sb_head + 1) % SB_MAX_LINES;
    if (sb_count < SB_MAX_LINES) sb_count += 1;

    return 0; // return 0: we store for our own scrollback but don't support sb_popline
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

// ── Global instance + module API ────────────────────────────────────

var g_vterm: ?VTerm = null;
var g_text_buf: [2048]u8 = undefined;

pub fn initVterm(rows: u16, cols: u16) void {
    if (g_vterm != null) {
        g_vterm.?.deinitVterm();
    }
    g_vterm = VTerm.init(rows, cols) catch |err| {
        log.print("[vterm] init failed: {}\n", .{err});
        return;
    };
}

pub fn feed(data: []const u8) void {
    if (g_vterm) |*v| v.feedData(data);
}

pub fn readOutput(buf: []u8) ?[]const u8 {
    if (g_vterm) |*v| return v.readOutputData(buf);
    return null;
}

pub fn getRowText(row: u16) []const u8 {
    if (g_vterm) |*v| return v.getRowText(row, &g_text_buf);
    return g_text_buf[0..0];
}

pub fn getCell(row: u16, col: u16) Cell {
    if (g_vterm) |*v| return v.getCell(row, col);
    return Cell{};
}

pub fn getCursorRow() u16 {
    if (g_vterm) |v| return v.cursor_row;
    return 0;
}

pub fn getCursorCol() u16 {
    if (g_vterm) |v| return v.cursor_col;
    return 0;
}

pub fn getCursorVisible() bool {
    if (g_vterm) |v| return v.cursor_visible;
    return false;
}

pub fn hasDamage() bool {
    if (g_vterm) |v| return v.has_damage;
    return false;
}

pub fn clearDamageState() void {
    if (g_vterm) |*v| v.clearDamage();
}

pub fn getRows() u16 {
    if (g_vterm) |v| return v.rows;
    return 0;
}

pub fn getCols() u16 {
    if (g_vterm) |v| return v.cols;
    return 0;
}

pub fn resizeVterm(rows: u16, cols: u16) void {
    if (g_vterm) |*v| v.resizeTerminal(rows, cols);
    if (g_pty) |*p| p.resize(rows, cols);
}

// Terminal rendering is done by .tsz components (<Terminal>), not hand-painted.
// The VTerm struct exposes getCell/getRowText/dirty_rows for the component to read.

pub fn deinit() void {
    closePty();
    if (g_vterm) |*v| {
        v.deinitVterm();
        g_vterm = null;
    }
}

// ── PTY integration — spawn shell, drain to vterm each frame ────────

const pty_mod = @import("pty.zig");

var g_pty: ?pty_mod.Pty = null;
var g_spawn_cwd_buf: [std.fs.max_path_bytes]u8 = undefined;
var g_spawn_cwd_len: usize = 0;

pub fn setSpawnCwd(path: []const u8) void {
    const len = @min(path.len, g_spawn_cwd_buf.len - 1);
    @memcpy(g_spawn_cwd_buf[0..len], path[0..len]);
    g_spawn_cwd_buf[len] = 0;
    g_spawn_cwd_len = len;
}

/// Spawn a shell and connect it to the global vterm instance.
/// If vterm doesn't exist yet, creates one at the given dimensions.
pub fn spawnShell(shell: [*:0]const u8, rows: u16, cols: u16) void {
    if (g_pty != null) closePty();
    if (g_vterm == null) initVterm(rows, cols);

    const cwd: ?[*:0]const u8 = if (g_spawn_cwd_len > 0) @ptrCast(&g_spawn_cwd_buf) else null;
    g_pty = pty_mod.openPty(.{ .shell = shell, .rows = rows, .cols = cols, .cwd = cwd }) catch |err| {
        log.print("[vterm] spawnShell failed: {}\n", .{err});
        return;
    };
    log.print("[vterm] shell spawned: {s} ({d}x{d})\n", .{ std.mem.span(shell), cols, rows });
}

/// Drain PTY output → feed to vterm → flush vterm responses back to PTY.
/// Call once per frame. Returns true if new data was received.
///
/// Loops to drain ALL pending data (up to 256KB) rather than a single
/// 8KB buffer-full. Claude Code's full-screen redraws are 100KB+; at
/// one buffer per frame the old content (e.g. the / menu) persists for
/// many frames before the clearing escape sequences arrive.
pub fn pollPty() bool {
    var p = &(g_pty orelse return false);
    var got_data = false;
    var iters: u32 = 0;
    while (iters < 32) : (iters += 1) {
        const data = p.readData() orelse break;
        got_data = true;
        if (g_recording_active) g_recorder.capture(data);
        if (g_vterm) |*v| {
            v.feedData(data);
        }
    }
    if (got_data) {
        if (g_vterm) |*v| {
            var out_buf: [4096]u8 = undefined;
            if (v.readOutputData(&out_buf)) |response| {
                var pty = &(g_pty orelse return true);
                _ = pty.writeData(response);
            }
        }
    }
    return got_data;
}

/// Send keystrokes to the PTY (keyboard input from the user).
pub fn writePty(data: []const u8) void {
    var p = &(g_pty orelse {
        log.print("[vterm] writePty: no PTY open!\n", .{});
        return;
    });
    const ok = p.writeData(data);
    log.print("[vterm] writePty: {d} bytes, ok={}\n", .{ data.len, ok });
}

/// Check if the shell is still running.
pub fn ptyAlive() bool {
    var p = &(g_pty orelse return false);
    return p.alive();
}

/// Close the PTY and reap the child.
pub fn closePty() void {
    if (g_pty) |*p| {
        p.closePty();
        g_pty = null;
    }
}

// ── Scrollback buffer ───────────────────────────────────────────────
// Ring buffer storing lines that scrolled off the top of the screen.
// cb_sb_pushline fills this; paintTerminal reads it when scrolled up.

const SB_MAX_LINES: u16 = 500;
const SB_MAX_COLS: u16 = 200;

var sb_lines: [SB_MAX_LINES][SB_MAX_COLS]Cell = undefined;
var sb_col_count: [SB_MAX_LINES]u16 = [_]u16{0} ** SB_MAX_LINES;
var sb_head: u16 = 0; // next write position (ring)
var sb_count: u16 = 0; // total lines stored (capped at SB_MAX_LINES)
var sb_scroll: u16 = 0; // scroll offset: 0 = live view, >0 = scrolled up N lines

/// Get a cell from the scrollback buffer.
/// `sb_row` is display-order: 0 = oldest visible scrollback line when scrolled up.
/// The caller passes the display row index relative to the scrollback region.
/// Internally maps to ring buffer position based on current scroll offset.
pub fn getScrollbackCell(display_row: u16, col: u16) Cell {
    if (display_row >= sb_scroll or display_row >= sb_count) return Cell{};
    if (col >= SB_MAX_COLS) return Cell{};
    // display_row 0 = oldest visible = age sb_scroll
    // display_row (sb_scroll-1) = newest visible = age 1
    const age = sb_scroll - display_row;
    const idx = (sb_head + SB_MAX_LINES - age) % SB_MAX_LINES;
    if (col >= sb_col_count[idx]) return Cell{};
    return sb_lines[idx][col];
}

/// Number of lines in the scrollback buffer.
pub fn scrollbackCount() u16 {
    return sb_count;
}

/// Current scroll offset (0 = at bottom / live view).
pub fn scrollOffset() u16 {
    return sb_scroll;
}

/// Scroll up by N lines (into history).
pub fn scrollUp(n: u16) void {
    sb_scroll = @min(sb_scroll + n, sb_count);
}

/// Scroll down by N lines (toward live view).
pub fn scrollDown(n: u16) void {
    if (n >= sb_scroll) {
        sb_scroll = 0;
    } else {
        sb_scroll -= n;
    }
}

/// Snap to bottom (live view).
pub fn scrollToBottom() void {
    sb_scroll = 0;
}

/// Extract text from a rectangular selection region (viewport coordinates).
/// Handles scrollback vs live rows automatically. Returns bytes written.
pub fn copySelectedText(
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

    const sb_vis = sb_scroll;
    const cols = getCols();
    var pos: usize = 0;

    var row = r0;
    while (row <= r1) : (row += 1) {
        if (row > r0 and pos < buf.len - 1) {
            buf[pos] = '\n';
            pos += 1;
        }
        const cstart: u16 = if (row == r0) c0 else 0;
        const cend: u16 = if (row == r1) c1 + 1 else cols;

        var last_nonspace = pos;
        var col = cstart;
        while (col < cend and pos < buf.len - 4) : (col += 1) {
            const cell = if (row < sb_vis)
                getScrollbackCell(row, col)
            else
                getCell(row - sb_vis, col);

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

// ── Indexed compat stubs (engine.zig expects these) ─────────────────
// The refactor consolidated to a single terminal, but the engine API
// still passes a terminal index. These ignore the index and delegate.

pub fn scrollUpIdx(_: u8, n: u16) void {
    scrollUp(n);
}

pub fn scrollDownIdx(_: u8, n: u16) void {
    scrollDown(n);
}

pub fn spawnShellIdx(_: u8, shell: [*:0]const u8, rows: u16, cols: u16) void {
    spawnShell(shell, rows, cols);
}

pub fn resizeVtermIdx(_: u8, rows: u16, cols: u16) void {
    resizeVterm(rows, cols);
}

pub fn pollPtyIdx(_: u8) bool {
    return pollPty();
}

pub fn ptyAliveIdx(_: u8) bool {
    return ptyAlive();
}

pub fn getCellIdx(_: u8, row: u16, col: u16) Cell {
    return getCell(row, col);
}

pub fn getColsIdx(_: u8) u16 {
    return getCols();
}

pub fn getRowsIdx(_: u8) u16 {
    return getRows();
}

pub fn getCursorRowIdx(_: u8) u16 {
    return getCursorRow();
}

pub fn getCursorColIdx(_: u8) u16 {
    return getCursorCol();
}

pub fn getCursorVisibleIdx(_: u8) bool {
    return getCursorVisible();
}

// 0 = no mouse mode (host owns mouse for selection / drag-to-copy).
// 1..3 = inner program enabled SGR mouse reporting (click / drag / any-motion).
// Engine reads this in the mouse-down dispatcher and forwards events as SGR
// (1006) sequences when nonzero instead of doing host-side selection.
pub fn getMouseModeIdx(_: u8) c_int {
    if (g_vterm) |v| return v.mouse_mode;
    return 0;
}

pub fn getRowTextIdx(_: u8, row: u16) []const u8 {
    return getRowText(row);
}

pub fn getScrollbackCellIdx(_: u8, display_row: u16, col: u16) Cell {
    return getScrollbackCell(display_row, col);
}

pub fn scrollOffsetIdx(_: u8) u16 {
    return scrollOffset();
}

pub fn scrollToBottomIdx(_: u8) void {
    scrollToBottom();
}

pub fn copySelectedTextIdx(
    _: u8,
    start_row: u16,
    start_col: u16,
    end_row: u16,
    end_col: u16,
    buf: []u8,
) usize {
    return copySelectedText(start_row, start_col, end_row, end_col, buf);
}

pub fn writePtyIdx(_: u8, data: []const u8) void {
    writePty(data);
}
