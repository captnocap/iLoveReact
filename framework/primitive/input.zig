//! TextInput state management — ported from love2d/examples/layout-stress/lua/textinput.lua
//!
//! Design rule (copied verbatim from the lua source):
//!   "All editing state (text, cursor, selection, blink) lives entirely in [the host].
//!    The JS/TS side only hears about boundary events: focus, blur, submit, change."
//!
//! That rule is the reason this module does NOT notify JS on every cursor
//! movement. Broadcasting cursor changes on each mouse-motion during a
//! drag-select triggers a React re-render per motion event and collapses FPS.
//! Carts that need cursor info can poll via getCursorPos(id).
//!
//! Each <TextInput> gets a compile-time slot id. Text buffers, cursor,
//! selection, scrollX, and undo/redo live here. SDL text/key events route
//! through handleTextInput / handleKey / handleCtrlKey.

const std = @import("std");
const c = @import("../c.zig").imports;
const state_mod = @import("../state/dirty.zig");
const build_options = @import("build_options");
const USE_V8 = if (@hasDecl(build_options, "use_v8")) build_options.use_v8 else false;
const js_vm = @import("../v8_runtime.zig");
const input_echo = @import("input_echo.zig");

pub const MAX_INPUTS = 128;
// Large editor surfaces like sweatshop need materially more than 4 KiB or the
// controlled input truncates immediately on mount.
const BUF_SIZE = 256 * 1024;

pub const InputState = struct {
    buf: [BUF_SIZE]u8 = [_]u8{0} ** BUF_SIZE,
    len: u32 = 0,
    cursor: u32 = 0,
    sel_start: u32 = 0,
    sel_end: u32 = 0,
    has_selection: bool = false,
    active: bool = false,
    multiline: bool = false,
    scroll_x: f32 = 0,
    // syncValue tracks the last value prop we copied in, so we only overwrite
    // the buffer when the cart's value genuinely changed — not every paint.
    last_synced_len: u32 = 0,
    last_synced_buf: [BUF_SIZE]u8 = [_]u8{0} ** BUF_SIZE,
    last_synced_valid: bool = false,
    // Texts dispatched via onChange whose controlled-value echoes are still
    // in flight — syncValue must never rewrite the buffer from one of these
    // (req_4713 fast-typing shuffle). See primitive/input_echo.zig.
    echo_ring: input_echo.EchoRing = .{},
    // Props forwarded from the node side
    editable: bool = true,
    secure: bool = false,
    max_length: u32 = 0, // 0 = unlimited
    submit_on_enter: bool = true, // multiline only — Enter submits, Shift+Enter inserts newline (chat-composer default; code editors that want raw Enter-newline opt out via setSubmitOnEnter(id, false))
};

var inputs: [MAX_INPUTS]InputState = [_]InputState{.{}} ** MAX_INPUTS;
var callback_contexts: [MAX_INPUTS]?*anyopaque = [_]?*anyopaque{null} ** MAX_INPUTS;
var on_change_callbacks: [MAX_INPUTS]?*const fn (?*anyopaque) void = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
var on_submit_callbacks: [MAX_INPUTS]?*const fn (?*anyopaque) void = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
var on_focus_callbacks: [MAX_INPUTS]?*const fn (?*anyopaque) void = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
var on_blur_callbacks: [MAX_INPUTS]?*const fn (?*anyopaque) void = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
var on_key_callbacks: [MAX_INPUTS]?*const fn (?*anyopaque, key: c_int, mods: u16) void = [_]?*const fn (?*anyopaque, key: c_int, mods: u16) void{null} ** MAX_INPUTS;
var focused_id: ?u8 = null;

// ── Submit event bus ────────────────────────────────────────────────────
// On Enter, captures the pre-submit text so carts can pick it up later via
// consumeLastSubmit(). Unlike the previous implementation, we do NOT clear
// the buffer here — carts that want chat-style clear-on-submit call
// __setInputText(id, "") from their onSubmit.
var g_last_submit_id: i16 = -1;
var g_last_submit_buf: [BUF_SIZE]u8 = [_]u8{0} ** BUF_SIZE;
var g_last_submit_len: u32 = 0;

pub const SubmitEvent = struct { id: u8, text: []const u8 };

pub fn consumeLastSubmit() ?SubmitEvent {
    if (g_last_submit_id < 0) return null;
    const id: u8 = @intCast(g_last_submit_id);
    const text = g_last_submit_buf[0..g_last_submit_len];
    g_last_submit_id = -1;
    return .{ .id = id, .text = text };
}

var cursor_blink: f32 = 0;
var cursor_visible: bool = true;
var measure_width_fn: ?*const fn ([]const u8, u16) f32 = null;

pub fn setMeasureWidthFn(f: *const fn ([]const u8, u16) f32) void {
    measure_width_fn = f;
}

var last_click_ms: u32 = 0;
var last_click_target: i16 = -1;
var click_count: u8 = 0;

pub fn trackClick(now_ms: u32) u8 {
    const id = focused_id;
    const tgt: i16 = if (id) |v| @intCast(v) else -1;
    const dt = now_ms -| last_click_ms;
    if (dt < 400 and tgt == last_click_target) {
        click_count = if (click_count >= 3) 1 else click_count + 1;
    } else {
        click_count = 1;
    }
    last_click_ms = now_ms;
    last_click_target = tgt;
    return click_count;
}

pub fn register(id: u8) void {
    if (id >= MAX_INPUTS) return;
    inputs[id].active = true;
    inputs[id].multiline = false;
}

pub fn registerMultiline(id: u8) void {
    if (id >= MAX_INPUTS) return;
    inputs[id].active = true;
    inputs[id].multiline = true;
}

pub fn setCallbackContext(id: u8, context: ?*anyopaque) void {
    if (id < MAX_INPUTS) callback_contexts[id] = context;
}

pub fn setOnChange(id: u8, cb: *const fn (?*anyopaque) void) void {
    if (id < MAX_INPUTS) on_change_callbacks[id] = cb;
}
pub fn setOnSubmit(id: u8, cb: *const fn (?*anyopaque) void) void {
    if (id < MAX_INPUTS) on_submit_callbacks[id] = cb;
}
pub fn setOnFocus(id: u8, cb: *const fn (?*anyopaque) void) void {
    if (id < MAX_INPUTS) on_focus_callbacks[id] = cb;
}
pub fn setOnBlur(id: u8, cb: *const fn (?*anyopaque) void) void {
    if (id < MAX_INPUTS) on_blur_callbacks[id] = cb;
}
pub fn setOnKey(id: u8, cb: *const fn (?*anyopaque, c_int, u16) void) void {
    if (id < MAX_INPUTS) on_key_callbacks[id] = cb;
}

pub fn unregister(id: u8) void {
    if (id >= MAX_INPUTS) return;
    if (focused_id != null and focused_id.? == id) focused_id = null;
    if (undo_input_id != null and undo_input_id.? == id) {
        undo_input_id = null;
        undo_count = 0;
        redo_count = 0;
    }
    if (g_last_submit_id >= 0 and @as(u8, @intCast(g_last_submit_id)) == id) {
        g_last_submit_id = -1;
        g_last_submit_len = 0;
    }
    on_change_callbacks[id] = null;
    on_submit_callbacks[id] = null;
    on_focus_callbacks[id] = null;
    on_blur_callbacks[id] = null;
    on_key_callbacks[id] = null;
    callback_contexts[id] = null;
    inputs[id] = .{};
}

pub fn getText(id: u8) []const u8 {
    if (id >= MAX_INPUTS) return "";
    return inputs[id].buf[0..inputs[id].len];
}

pub fn getTextZ(id: u8) ?[]const u8 {
    if (id >= MAX_INPUTS or inputs[id].len == 0) return null;
    return inputs[id].buf[0..inputs[id].len];
}

pub fn focus(id: u8) void {
    if (id >= MAX_INPUTS) return;
    if (focused_id != null and focused_id.? == id) {
        cursor_blink = 0;
        cursor_visible = true;
        return;
    }
    if (focused_id) |prev| {
        if (prev < MAX_INPUTS) {
            // Focus boundary: the blurred input can't type further, so any
            // still-in-flight echo may safely re-apply as authored — and
            // dropping the history keeps a batched-away intermediate text
            // from false-acking an equal cart-authored value much later.
            inputs[prev].echo_ring.reset();
            if (on_blur_callbacks[prev]) |cb| cb(callback_contexts[prev]);
        }
    }
    focused_id = id;
    cursor_blink = 0;
    cursor_visible = true;
    if (on_focus_callbacks[id]) |cb| cb(callback_contexts[id]);
}

pub fn unfocus() void {
    if (focused_id) |prev| {
        focused_id = null;
        if (prev < MAX_INPUTS) {
            inputs[prev].echo_ring.reset();
            if (on_blur_callbacks[prev]) |cb| cb(callback_contexts[prev]);
        }
        return;
    }
    focused_id = null;
}

pub fn isFocused(id: u8) bool {
    return focused_id != null and focused_id.? == id;
}

pub fn isMultiline(id: u8) bool {
    if (id >= MAX_INPUTS) return false;
    return inputs[id].multiline;
}

pub fn getFocusedId() ?u8 {
    return focused_id;
}

// ── UTF-8 continuation-byte walkers ─────────────────────────────────

fn isContByte(b: u8) bool {
    return b >= 0x80 and b < 0xC0;
}

/// Step one codepoint left from `pos` in `buf`. Returns the new byte position.
fn stepLeft(buf: []const u8, pos: u32) u32 {
    if (pos == 0) return 0;
    var p = pos - 1;
    while (p > 0 and isContByte(buf[p])) : (p -= 1) {}
    return p;
}

/// Step one codepoint right from `pos` in `buf`. Returns the new byte position.
fn stepRight(buf: []const u8, pos: u32) u32 {
    if (pos >= buf.len) return @intCast(buf.len);
    var p = pos + 1;
    while (p < buf.len and isContByte(buf[p])) : (p += 1) {}
    return p;
}

// ── Selection helpers ───────────────────────────────────────────────

pub fn getSelection(id: u8) struct { lo: u32, hi: u32 } {
    if (id >= MAX_INPUTS) return .{ .lo = 0, .hi = 0 };
    const inp = &inputs[id];
    if (!inp.has_selection) return .{ .lo = inp.cursor, .hi = inp.cursor };
    return if (inp.sel_start <= inp.sel_end)
        .{ .lo = inp.sel_start, .hi = inp.sel_end }
    else
        .{ .lo = inp.sel_end, .hi = inp.sel_start };
}

/// Bytes currently selected in input `id`, or empty slice if no selection.
pub fn getSelectedText(id: u8) []const u8 {
    if (id >= MAX_INPUTS) return &[_]u8{};
    const inp = &inputs[id];
    if (!inp.has_selection) return &[_]u8{};
    const lo = if (inp.sel_start <= inp.sel_end) inp.sel_start else inp.sel_end;
    const hi = if (inp.sel_start <= inp.sel_end) inp.sel_end else inp.sel_start;
    if (hi <= lo or hi > inp.len) return &[_]u8{};
    return inp.buf[lo..hi];
}

/// Drop has_selection on every input. Used to enforce single-global-highlight
/// when the tree-text selection (selection.zig) takes over.
pub fn clearAllSelections() void {
    var i: u8 = 0;
    while (i < MAX_INPUTS) : (i += 1) {
        inputs[i].has_selection = false;
        inputs[i].sel_start = inputs[i].cursor;
        inputs[i].sel_end = inputs[i].cursor;
    }
}

fn clearSelection(inp: *InputState) void {
    inp.has_selection = false;
    inp.sel_start = inp.cursor;
    inp.sel_end = inp.cursor;
}

fn startOrExtendSelection(inp: *InputState) void {
    if (!inp.has_selection) {
        inp.sel_start = inp.cursor;
    }
}

fn updateSelectionEnd(inp: *InputState) void {
    inp.sel_end = inp.cursor;
    inp.has_selection = inp.sel_start != inp.sel_end;
}

fn deleteSelection(inp: *InputState) bool {
    if (!inp.has_selection) return false;
    const lo = if (inp.sel_start <= inp.sel_end) inp.sel_start else inp.sel_end;
    const hi = if (inp.sel_start <= inp.sel_end) inp.sel_end else inp.sel_start;
    const del_len = hi - lo;
    if (del_len == 0) {
        inp.has_selection = false;
        return false;
    }
    var i = lo;
    while (i < inp.len - del_len) : (i += 1) {
        inp.buf[i] = inp.buf[i + del_len];
    }
    inp.len -= del_len;
    inp.cursor = lo;
    inp.has_selection = false;
    return true;
}

// ── Word-boundary helpers ───────────────────────────────────────────

fn isWordChar(b: u8) bool {
    return (b >= 'a' and b <= 'z') or (b >= 'A' and b <= 'Z') or (b >= '0' and b <= '9') or b == '_';
}

fn wordJumpLeft(inp: *InputState) void {
    var p = inp.cursor;
    while (p > 0 and !isWordChar(inp.buf[p - 1])) : (p -= 1) {}
    while (p > 0 and isWordChar(inp.buf[p - 1])) : (p -= 1) {}
    inp.cursor = p;
}

fn wordJumpRight(inp: *InputState) void {
    var p = inp.cursor;
    while (p < inp.len and !isWordChar(inp.buf[p])) : (p += 1) {}
    while (p < inp.len and isWordChar(inp.buf[p])) : (p += 1) {}
    inp.cursor = p;
}

// ── Undo / redo (one ring per focused input) ────────────────────────
//
// Scoped to the currently-focused input. Switching focus clears the ring.
// That matches love2d's per-node semantics closely enough for our needs
// without allocating 128 × 50 × 256 KB of per-slot snapshot buffers.

const MAX_UNDO = 100;
const UndoEntry = struct {
    buf: [BUF_SIZE]u8 = [_]u8{0} ** BUF_SIZE,
    len: u32 = 0,
    cursor: u32 = 0,
};

var undo_stack: [MAX_UNDO]UndoEntry = [_]UndoEntry{.{}} ** MAX_UNDO;
var redo_stack: [MAX_UNDO]UndoEntry = [_]UndoEntry{.{}} ** MAX_UNDO;
var undo_count: u16 = 0;
var redo_count: u16 = 0;
var undo_input_id: ?u8 = null;

fn snapshotInto(dst: *UndoEntry, inp: *const InputState) void {
    @memcpy(dst.buf[0..inp.len], inp.buf[0..inp.len]);
    dst.len = inp.len;
    dst.cursor = inp.cursor;
}

fn restoreFrom(entry: *const UndoEntry, inp: *InputState) void {
    @memcpy(inp.buf[0..entry.len], entry.buf[0..entry.len]);
    inp.len = entry.len;
    inp.cursor = entry.cursor;
    inp.has_selection = false;
}

fn pushUndo(id: u8, inp: *const InputState) void {
    if (undo_input_id != null and undo_input_id.? != id) {
        undo_count = 0;
        redo_count = 0;
    }
    undo_input_id = id;
    // New edit invalidates the redo stack (standard text-editor semantics).
    redo_count = 0;
    if (undo_count < MAX_UNDO) {
        snapshotInto(&undo_stack[undo_count], inp);
        undo_count += 1;
    } else {
        // Shift ring left to make room — oldest entry falls off.
        var i: u16 = 0;
        while (i + 1 < MAX_UNDO) : (i += 1) {
            @memcpy(undo_stack[i].buf[0..undo_stack[i + 1].len], undo_stack[i + 1].buf[0..undo_stack[i + 1].len]);
            undo_stack[i].len = undo_stack[i + 1].len;
            undo_stack[i].cursor = undo_stack[i + 1].cursor;
        }
        snapshotInto(&undo_stack[MAX_UNDO - 1], inp);
    }
}

fn doUndo(id: u8, inp: *InputState) bool {
    if (undo_input_id != null and undo_input_id.? != id) return false;
    if (undo_count == 0) return false;
    // Push current state onto redo before reverting.
    if (redo_count < MAX_UNDO) {
        snapshotInto(&redo_stack[redo_count], inp);
        redo_count += 1;
    }
    undo_count -= 1;
    restoreFrom(&undo_stack[undo_count], inp);
    return true;
}

fn doRedo(id: u8, inp: *InputState) bool {
    if (undo_input_id != null and undo_input_id.? != id) return false;
    if (redo_count == 0) return false;
    if (undo_count < MAX_UNDO) {
        snapshotInto(&undo_stack[undo_count], inp);
        undo_count += 1;
    }
    redo_count -= 1;
    restoreFrom(&redo_stack[redo_count], inp);
    return true;
}

// ── Insertion ───────────────────────────────────────────────────────

fn insertBytes(inp: *InputState, bytes: []const u8) bool {
    var to_insert = bytes;
    if (inp.max_length > 0) {
        // Count existing + incoming codepoints; trim incoming if over.
        const cur_cp = utf8Count(inp.buf[0..inp.len]);
        if (cur_cp >= inp.max_length) return false;
        const allowed_cp = inp.max_length - cur_cp;
        const incoming_cp = utf8Count(bytes);
        if (incoming_cp > allowed_cp) {
            to_insert = trimToCodepoints(bytes, allowed_cp);
        }
    }
    if (to_insert.len == 0) return false;
    if (inp.len + to_insert.len > BUF_SIZE - 1) return false;

    // Shift right to make room
    if (inp.cursor < inp.len) {
        var i: u32 = inp.len;
        while (i > inp.cursor) : (i -= 1) {
            inp.buf[i + @as(u32, @intCast(to_insert.len)) - 1] = inp.buf[i - 1];
        }
    }
    for (to_insert, 0..) |b, j| {
        inp.buf[inp.cursor + @as(u32, @intCast(j))] = b;
    }
    inp.len += @intCast(to_insert.len);
    inp.cursor += @intCast(to_insert.len);
    return true;
}

fn utf8Count(bytes: []const u8) u32 {
    var count: u32 = 0;
    var i: usize = 0;
    while (i < bytes.len) {
        if (!isContByte(bytes[i])) count += 1;
        i += 1;
    }
    return count;
}

fn trimToCodepoints(bytes: []const u8, max_cp: u32) []const u8 {
    var count: u32 = 0;
    var i: usize = 0;
    while (i < bytes.len) {
        if (!isContByte(bytes[i])) {
            if (count == max_cp) break;
            count += 1;
        }
        i += 1;
    }
    return bytes[0..i];
}

/// Every onChange dispatch flows through here so the input remembers what
/// text it told JS about. The controlled-value echo of that dispatch lands
/// one or more paint frames later (reconciler commits drain at the next
/// frame), and syncValue uses the ring to tell a self-echo — which must not
/// disturb the buffer or caret — from a cart-authored value.
fn fireChange(id: u8) void {
    const inp = &inputs[id];
    inp.echo_ring.noteDispatched(inp.buf[0..inp.len]);
    if (on_change_callbacks[id]) |cb| cb(callback_contexts[id]);
}

fn dispatchInputChange(id: u8) void {
    // V8 carts receive input change through the per-slot callback installed by
    // v8_app.zig, which can translate slot -> React node id before dispatch.
    // Calling the JS global here would pass a raw slot where JS expects a node.
    if (USE_V8) return;

    const id64: i64 = @intCast(id);
    if (js_vm.hasGlobal("__dispatchInputChange")) {
        js_vm.callGlobalInt("__dispatchInputChange", id64);
        state_mod.markDirty();
    }
}

// ── SDL event handlers ──────────────────────────────────────────────

pub fn handleTextInput(text: [*:0]const u8) void {
    const id = focused_id orelse return;
    if (id >= MAX_INPUTS) return;
    const inp = &inputs[id];
    if (!inp.editable) return;

    var text_len: u32 = 0;
    while (text[text_len] != 0 and text_len < 64) : (text_len += 1) {}
    if (text_len == 0) return;
    const bytes = text[0..text_len];

    // Strip newlines in single-line mode
    if (!inp.multiline) {
        var has_newline = false;
        for (bytes) |b| if (b == '\n' or b == '\r') {
            has_newline = true;
            break;
        };
        if (has_newline) {
            pushUndo(id, inp);
            var changed = false;
            if (inp.has_selection) _ = deleteSelection(inp);
            for (bytes) |b| {
                if (b == '\n' or b == '\r') continue;
                var tmp: [1]u8 = .{b};
                changed = insertBytes(inp, tmp[0..]) or changed;
            }
            cursor_blink = 0;
            cursor_visible = true;
            fireChange(id);
            if (changed) dispatchInputChange(id);
            return;
        }
    }

    pushUndo(id, inp);
    if (inp.has_selection) _ = deleteSelection(inp);
    if (insertBytes(inp, bytes)) {
        cursor_blink = 0;
        cursor_visible = true;
        fireChange(id);
        dispatchInputChange(id);
    }
}

pub fn handleKey(sym: c_int, mods: u16) bool {
    const id = focused_id orelse return false;
    if (id >= MAX_INPUTS) return false;
    if (on_key_callbacks[id]) |cb| cb(callback_contexts[id], sym, mods);
    const inp = &inputs[id];
    const prev_len = inp.len;
    const shift = (mods & c.SDL_KMOD_SHIFT) != 0;

    // ── Movement ──
    if (sym == c.SDLK_LEFT) {
        if (shift) startOrExtendSelection(inp);
        if (!shift and inp.has_selection) {
            const sel = getSelection(id);
            inp.cursor = sel.lo;
            clearSelection(inp);
        } else {
            inp.cursor = stepLeft(inp.buf[0..inp.len], inp.cursor);
        }
        if (shift) updateSelectionEnd(inp) else if (!inp.has_selection) clearSelection(inp);
        cursor_blink = 0;
        cursor_visible = true;
        return true;
    }
    if (sym == c.SDLK_RIGHT) {
        if (shift) startOrExtendSelection(inp);
        if (!shift and inp.has_selection) {
            const sel = getSelection(id);
            inp.cursor = sel.hi;
            clearSelection(inp);
        } else {
            inp.cursor = stepRight(inp.buf[0..inp.len], inp.cursor);
        }
        if (shift) updateSelectionEnd(inp) else if (!inp.has_selection) clearSelection(inp);
        cursor_blink = 0;
        cursor_visible = true;
        return true;
    }
    if (sym == c.SDLK_HOME) {
        if (shift) startOrExtendSelection(inp) else clearSelection(inp);
        inp.cursor = 0;
        if (shift) updateSelectionEnd(inp);
        cursor_blink = 0;
        cursor_visible = true;
        return true;
    }
    if (sym == c.SDLK_END) {
        if (shift) startOrExtendSelection(inp) else clearSelection(inp);
        inp.cursor = inp.len;
        if (shift) updateSelectionEnd(inp);
        cursor_blink = 0;
        cursor_visible = true;
        return true;
    }

    // ── Enter ──
    if (sym == c.SDLK_RETURN or sym == c.SDLK_KP_ENTER) {
        if (inp.multiline and inp.editable) {
            // submitOnEnter: Enter submits, Shift+Enter inserts newline
            if (inp.submit_on_enter and !shift) {
                if (inp.len > 0) {
                    @memcpy(g_last_submit_buf[0..inp.len], inp.buf[0..inp.len]);
                    g_last_submit_len = inp.len;
                    g_last_submit_id = @intCast(id);
                }
                if (on_submit_callbacks[id]) |cb| cb(callback_contexts[id]);
                return true;
            }
            pushUndo(id, inp);
            if (inp.has_selection) _ = deleteSelection(inp);
            var nl: [1]u8 = .{'\n'};
            _ = insertBytes(inp, nl[0..]);
            cursor_blink = 0;
            cursor_visible = true;
            if (inp.len != prev_len) {
                fireChange(id);
            }
            return true;
        }
        // Single-line: capture text for submit bus, fire onSubmit.
        // Buffer is NOT cleared here — controlled inputs round-trip through
        // React state; carts that want clear-on-submit call __setInputText.
        if (inp.len > 0) {
            @memcpy(g_last_submit_buf[0..inp.len], inp.buf[0..inp.len]);
            g_last_submit_len = inp.len;
            g_last_submit_id = @intCast(id);
        }
        if (on_submit_callbacks[id]) |cb| cb(callback_contexts[id]);
        return true;
    }

    // ── Tab ──
    if (sym == c.SDLK_TAB) {
        if (inp.multiline and inp.editable) {
            pushUndo(id, inp);
            if (inp.has_selection) _ = deleteSelection(inp);
            var spaces: [4]u8 = .{ ' ', ' ', ' ', ' ' };
            _ = insertBytes(inp, spaces[0..]);
            cursor_blink = 0;
            cursor_visible = true;
            if (inp.len != prev_len) {
                fireChange(id);
            }
            return true;
        }
        // Single-line: cycle focus to next/prev active input
        const reverse = shift;
        const current = id;
        var next = current;
        var tried: u8 = 0;
        while (tried < MAX_INPUTS) : (tried += 1) {
            if (reverse) {
                next = if (next == 0) MAX_INPUTS - 1 else next - 1;
            } else {
                next +%= 1;
                if (next >= MAX_INPUTS) next = 0;
            }
            if (inputs[next].active) {
                focus(next);
                return true;
            }
        }
        return true;
    }

    if (sym == c.SDLK_ESCAPE) {
        unfocus();
        return true;
    }

    // ── Editing ──
    if (!inp.editable) return true;

    if (sym == c.SDLK_BACKSPACE) {
        pushUndo(id, inp);
        if (inp.has_selection) {
            _ = deleteSelection(inp);
        } else if (inp.cursor > 0) {
            const new_pos = stepLeft(inp.buf[0..inp.len], inp.cursor);
            const del_len = inp.cursor - new_pos;
            var i = new_pos;
            while (i < inp.len - del_len) : (i += 1) {
                inp.buf[i] = inp.buf[i + del_len];
            }
            inp.len -= del_len;
            inp.cursor = new_pos;
        }
        cursor_blink = 0;
        cursor_visible = true;
        if (inp.len != prev_len) {
            fireChange(id);
        }
        return true;
    }

    if (sym == c.SDLK_DELETE) {
        pushUndo(id, inp);
        if (inp.has_selection) {
            _ = deleteSelection(inp);
        } else if (inp.cursor < inp.len) {
            const end = stepRight(inp.buf[0..inp.len], inp.cursor);
            const del_len = end - inp.cursor;
            var i = inp.cursor;
            while (i < inp.len - del_len) : (i += 1) {
                inp.buf[i] = inp.buf[i + del_len];
            }
            inp.len -= del_len;
        }
        cursor_blink = 0;
        cursor_visible = true;
        if (inp.len != prev_len) {
            fireChange(id);
        }
        return true;
    }

    return false;
}

pub fn handleCtrlKey(sym: c_int, mods: u16) bool {
    const id = focused_id orelse return false;
    if (id >= MAX_INPUTS) return false;
    if (on_key_callbacks[id]) |cb| cb(callback_contexts[id], sym, mods);
    const inp = &inputs[id];
    const shift = (mods & c.SDL_KMOD_SHIFT) != 0;
    const prev_len = inp.len;

    // Ctrl+Arrow = word jump (with optional shift-extend)
    if (sym == c.SDLK_LEFT) {
        if (shift) startOrExtendSelection(inp) else clearSelection(inp);
        wordJumpLeft(inp);
        if (shift) updateSelectionEnd(inp);
        cursor_blink = 0;
        cursor_visible = true;
        return true;
    }
    if (sym == c.SDLK_RIGHT) {
        if (shift) startOrExtendSelection(inp) else clearSelection(inp);
        wordJumpRight(inp);
        if (shift) updateSelectionEnd(inp);
        cursor_blink = 0;
        cursor_visible = true;
        return true;
    }

    // Ctrl+A — select all
    if (sym == c.SDLK_A) {
        inp.sel_start = 0;
        inp.sel_end = inp.len;
        inp.has_selection = inp.len > 0;
        inp.cursor = inp.len;
        return true;
    }

    // Ctrl+C — copy selection
    if (sym == c.SDLK_C) {
        if (inp.has_selection) {
            const sel = getSelection(id);
            if (sel.hi > sel.lo) {
                var clip_buf: [BUF_SIZE + 1]u8 = undefined;
                const clip_len = sel.hi - sel.lo;
                @memcpy(clip_buf[0..clip_len], inp.buf[sel.lo..sel.hi]);
                clip_buf[clip_len] = 0;
                _ = c.SDL_SetClipboardText(@ptrCast(&clip_buf));
            }
        }
        return true;
    }

    // Ctrl+X — cut selection
    if (sym == c.SDLK_X) {
        if (inp.editable and inp.has_selection) {
            const sel = getSelection(id);
            if (sel.hi > sel.lo) {
                var clip_buf: [BUF_SIZE + 1]u8 = undefined;
                const clip_len = sel.hi - sel.lo;
                @memcpy(clip_buf[0..clip_len], inp.buf[sel.lo..sel.hi]);
                clip_buf[clip_len] = 0;
                _ = c.SDL_SetClipboardText(@ptrCast(&clip_buf));
                pushUndo(id, inp);
                _ = deleteSelection(inp);
                fireChange(id);
            }
        }
        return true;
    }

    // Ctrl+V — paste
    if (sym == c.SDLK_V) {
        if (!inp.editable) return true;
        const clip = c.SDL_GetClipboardText();
        if (clip != null) {
            defer c.SDL_free(@ptrCast(clip));
            const span = std.mem.span(clip);
            if (span.len > 0) {
                pushUndo(id, inp);
                if (inp.has_selection) _ = deleteSelection(inp);
                // Strip newlines in single-line mode
                if (!inp.multiline) {
                    for (span) |b| {
                        if (b == '\n' or b == '\r') {
                            var tmp: [1]u8 = .{' '};
                            _ = insertBytes(inp, tmp[0..]);
                        } else {
                            var tmp: [1]u8 = .{b};
                            _ = insertBytes(inp, tmp[0..]);
                        }
                    }
                } else {
                    _ = insertBytes(inp, span);
                }
                cursor_blink = 0;
                cursor_visible = true;
                if (inp.len != prev_len) {
                    fireChange(id);
                }
            }
        }
        return true;
    }

    // Ctrl+Z — undo; Ctrl+Shift+Z / Ctrl+Y — redo
    if (sym == c.SDLK_Z) {
        if (!inp.editable) return true;
        const did = if (shift) doRedo(id, inp) else doUndo(id, inp);
        if (did) {
            fireChange(id);
        }
        return true;
    }
    if (sym == c.SDLK_Y) {
        if (!inp.editable) return true;
        if (doRedo(id, inp)) {
            fireChange(id);
        }
        return true;
    }

    // Ctrl+Backspace — delete word left
    if (sym == c.SDLK_BACKSPACE) {
        if (!inp.editable) return true;
        pushUndo(id, inp);
        if (inp.has_selection) {
            _ = deleteSelection(inp);
        } else if (inp.cursor > 0) {
            const old = inp.cursor;
            wordJumpLeft(inp);
            const new_pos = inp.cursor;
            const del_len = old - new_pos;
            var i = new_pos;
            while (i < inp.len - del_len) : (i += 1) {
                inp.buf[i] = inp.buf[i + del_len];
            }
            inp.len -= del_len;
        }
        cursor_blink = 0;
        cursor_visible = true;
        if (inp.len != prev_len) {
            fireChange(id);
        }
        return true;
    }

    // Ctrl+Delete — delete word right
    if (sym == c.SDLK_DELETE) {
        if (!inp.editable) return true;
        pushUndo(id, inp);
        if (inp.has_selection) {
            _ = deleteSelection(inp);
        } else if (inp.cursor < inp.len) {
            const start = inp.cursor;
            wordJumpRight(inp);
            const end = inp.cursor;
            inp.cursor = start;
            const del_len = end - start;
            var i = start;
            while (i < inp.len - del_len) : (i += 1) {
                inp.buf[i] = inp.buf[i + del_len];
            }
            inp.len -= del_len;
        }
        cursor_blink = 0;
        cursor_visible = true;
        if (inp.len != prev_len) {
            fireChange(id);
        }
        return true;
    }

    return false;
}

// ── External buffer management ──────────────────────────────────────

/// Blow away the buffer. Carts call this from onSubmit to clear.
pub fn clear(id: u8) void {
    if (id >= MAX_INPUTS) return;
    inputs[id].len = 0;
    inputs[id].cursor = 0;
    inputs[id].has_selection = false;
    inputs[id].scroll_x = 0;
    inputs[id].last_synced_valid = false;
}

/// Wipe every slot's buffer/cursor/selection/sync-baseline and drop
/// per-slot callbacks + focus. Called by the dev hot-reload path
/// (v8_runtime.resetContextForReload) so the new cart's TextInputs
/// don't inherit leftover bytes from the previous cart's slot ids —
/// slot ids are mount-order indices, not stable across reloads.
pub fn clearAll() void {
    inputs = [_]InputState{.{}} ** MAX_INPUTS;
    callback_contexts = [_]?*anyopaque{null} ** MAX_INPUTS;
    on_change_callbacks = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
    on_submit_callbacks = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
    on_focus_callbacks = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
    on_blur_callbacks = [_]?*const fn (?*anyopaque) void{null} ** MAX_INPUTS;
    on_key_callbacks = [_]?*const fn (?*anyopaque, key: c_int, mods: u16) void{null} ** MAX_INPUTS;
    focused_id = null;
    undo_input_id = null;
}

/// Set text programmatically, cursor goes to end. Use syncValue() instead
/// from prop-update paths — this one is for explicit resets.
pub fn setText(id: u8, text: []const u8) void {
    if (id >= MAX_INPUTS) return;
    const inp = &inputs[id];
    const copy_len: u32 = @intCast(@min(text.len, BUF_SIZE - 1));
    @memcpy(inp.buf[0..copy_len], text[0..copy_len]);
    inp.len = copy_len;
    inp.cursor = copy_len;
    inp.has_selection = false;
    // Snapshot the sync baseline so a subsequent syncValue(same text) no-ops.
    @memcpy(inp.last_synced_buf[0..copy_len], text[0..copy_len]);
    inp.last_synced_len = copy_len;
    inp.last_synced_valid = true;
}

/// Controlled-value sync — call from prop-update or paint-time paths.
/// Only writes the buffer when the new value differs from what was last
/// synced (not from the current buffer), so user edits aren't clobbered
/// by a paint-driven re-sync of an unchanged prop.
///
/// When the synced value does change (cart rewrote it), we preserve the
/// cursor position relatively: clamp to new length.
pub fn syncValue(id: u8, text: []const u8) void {
    if (id >= MAX_INPUTS) return;
    const inp = &inputs[id];
    const new_len: u32 = @intCast(@min(text.len, BUF_SIZE - 1));

    if (inp.last_synced_valid and inp.last_synced_len == new_len and
        std.mem.eql(u8, inp.last_synced_buf[0..inp.last_synced_len], text[0..new_len]))
    {
        return;
    }

    // Value already equals the live buffer — the round trip converged.
    // Adopt it as the baseline and drop the in-flight history; rewriting
    // would only re-run the cursor clamp for nothing.
    if (new_len == inp.len and std.mem.eql(u8, inp.buf[0..inp.len], text[0..new_len])) {
        inp.echo_ring.reset();
        @memcpy(inp.last_synced_buf[0..new_len], text[0..new_len]);
        inp.last_synced_len = new_len;
        inp.last_synced_valid = true;
        return;
    }

    // A text this input itself dispatched, coming back around as the cart's
    // controlled-value echo. By the time it lands the user may have typed
    // further keystrokes; rewriting the buffer from it would resurrect old
    // text and drag the caret backwards — the req_4713 fast-typing shuffle
    // ("industrial" → "inustriald"). Take it as the new sync baseline and
    // leave the live buffer and caret alone.
    if (inp.echo_ring.classify(text[0..new_len]) == .echo) {
        @memcpy(inp.last_synced_buf[0..new_len], text[0..new_len]);
        inp.last_synced_len = new_len;
        inp.last_synced_valid = true;
        return;
    }

    // Real change from the cart side — rewrite buffer, keep cursor clamped.
    // (classify() already cleared the ring: commits apply in order, so no
    // earlier dispatch can legitimately echo after a cart-authored value.)
    @memcpy(inp.buf[0..new_len], text[0..new_len]);
    inp.len = new_len;
    if (inp.cursor > new_len) inp.cursor = new_len;
    if (inp.sel_start > new_len) inp.sel_start = new_len;
    if (inp.sel_end > new_len) inp.sel_end = new_len;
    inp.has_selection = inp.has_selection and inp.sel_start != inp.sel_end;
    @memcpy(inp.last_synced_buf[0..new_len], text[0..new_len]);
    inp.last_synced_len = new_len;
    inp.last_synced_valid = true;
}

pub fn getCursorPos(id: u8) u32 {
    if (id >= MAX_INPUTS) return 0;
    return inputs[id].cursor;
}

/// Horizontal scroll offset (px) of a single-line input's text viewport —
/// how far the text is slid left so the caret stays visible as you type past
/// the right edge. The paint pass owns the value (recomputes it each frame
/// from the caret position) and click hit-testing reads it back so a click
/// maps to the same byte the user sees. Multiline inputs leave it 0.
pub fn getScrollX(id: u8) f32 {
    if (id >= MAX_INPUTS) return 0;
    return inputs[id].scroll_x;
}

pub fn setScrollX(id: u8, v: f32) void {
    if (id >= MAX_INPUTS) return;
    inputs[id].scroll_x = if (v > 0) v else 0;
}

pub fn setCursorPos(id: u8, pos: u32) void {
    if (id >= MAX_INPUTS) return;
    const s = &inputs[id];
    const clamped = @min(pos, s.len);
    s.cursor = clamped;
    s.has_selection = false;
    s.sel_start = clamped;
    s.sel_end = clamped;
}

pub fn moveCursorTo(id: u8, pos: u32, extend_selection: bool) void {
    if (id >= MAX_INPUTS) return;
    const s = &inputs[id];
    if (extend_selection) {
        startOrExtendSelection(s);
    } else {
        clearSelection(s);
    }
    const clamped = @min(pos, s.len);
    s.cursor = clamped;
    if (extend_selection) {
        updateSelectionEnd(s);
    } else {
        s.sel_start = clamped;
        s.sel_end = clamped;
    }
    cursor_blink = 0;
    cursor_visible = true;
}

pub fn updateDragToPos(id: u8, pos: u32) void {
    if (id >= MAX_INPUTS) return;
    const s = &inputs[id];
    const clamped = @min(pos, s.len);
    s.sel_end = clamped;
    s.cursor = clamped;
    s.has_selection = s.sel_start != s.sel_end;
}

pub fn selectAll(id: u8) void {
    if (id >= MAX_INPUTS) return;
    const s = &inputs[id];
    s.sel_start = 0;
    s.sel_end = s.len;
    s.has_selection = s.len > 0;
    s.cursor = s.len;
}

pub fn selectWord(id: u8) void {
    if (id >= MAX_INPUTS) return;
    const s = &inputs[id];
    const buf = s.buf[0..s.len];
    var start: u32 = s.cursor;
    var end: u32 = s.cursor;
    while (start > 0 and isWordChar(buf[start - 1])) start -= 1;
    while (end < s.len and isWordChar(buf[end])) end += 1;
    s.sel_start = start;
    s.sel_end = end;
    s.has_selection = start != end;
    s.cursor = end;
}

/// O(N) click-to-cursor: single running-width walk instead of measuring
/// every prefix. The old path called measure_width_fn N times per click.
pub fn setCursorFromX(id: u8, local_x: f32, font_size: u16) void {
    if (id >= MAX_INPUTS or measure_width_fn == null) return;
    const s = &inputs[id];
    const mfn = measure_width_fn.?;
    // Walk codepoints left→right; stop when cursor_x passes local_x, pick
    // the nearer boundary.
    var p: u32 = 0;
    var prev_w: f32 = 0;
    while (p < s.len) {
        const next = stepRight(s.buf[0..s.len], p);
        const w = mfn(s.buf[0..next], font_size);
        if (w >= local_x) {
            if (local_x - prev_w < w - local_x) {
                s.cursor = p;
            } else {
                s.cursor = next;
            }
            s.has_selection = false;
            return;
        }
        prev_w = w;
        p = next;
    }
    s.cursor = s.len;
    s.has_selection = false;
}

pub fn startDrag(id: u8) void {
    if (id >= MAX_INPUTS) return;
    const s = &inputs[id];
    s.sel_start = s.cursor;
    s.sel_end = s.cursor;
    s.has_selection = false;
}

pub fn updateDrag(id: u8, local_x: f32, font_size: u16) void {
    if (id >= MAX_INPUTS or measure_width_fn == null) return;
    setCursorFromX(id, local_x, font_size);
    const s = &inputs[id];
    s.sel_end = s.cursor;
    s.has_selection = s.sel_start != s.sel_end;
}

// ── Props (settable per slot) ───────────────────────────────────────

pub fn setEditable(id: u8, editable: bool) void {
    if (id < MAX_INPUTS) inputs[id].editable = editable;
}
pub fn setSecure(id: u8, secure: bool) void {
    if (id < MAX_INPUTS) inputs[id].secure = secure;
}
pub fn setMaxLength(id: u8, max: u32) void {
    if (id < MAX_INPUTS) inputs[id].max_length = max;
}
pub fn setSubmitOnEnter(id: u8, v: bool) void {
    if (id < MAX_INPUTS) inputs[id].submit_on_enter = v;
}
pub fn isSecure(id: u8) bool {
    if (id >= MAX_INPUTS) return false;
    return inputs[id].secure;
}

// ── Blink ───────────────────────────────────────────────────────────

pub fn tickBlink(dt: f32) bool {
    cursor_blink += dt;
    if (cursor_blink >= 0.53) {
        cursor_blink = 0;
        cursor_visible = !cursor_visible;
    }
    return cursor_visible;
}

// ── Telemetry ───────────────────────────────────────────────────────

pub const TelemetryInputStats = struct {
    focused_id: i8,
    active_count: u32,
};

pub fn telemetryStats() TelemetryInputStats {
    var count: u32 = 0;
    for (0..MAX_INPUTS) |i| {
        if (inputs[i].active) count += 1;
    }
    return .{
        .focused_id = if (focused_id) |id| @intCast(id) else -1,
        .active_count = count,
    };
}
