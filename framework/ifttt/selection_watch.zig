// selection_watch.zig — system PRIMARY-selection watcher.
//
// Polls SDL_GetPrimarySelectionText() (X11 PRIMARY = mouse-highlight buffer).
// Pairs each content-change with a global-mouse-pos sample so the JS side can
// place a UI bubble relative to the inferred drag rectangle without needing
// to know where the highlighted glyphs actually live (impossible to query
// from outside the source app).
//
// Fire policy:
//   - First content-change after a stable period: record mouse pos as
//     drag_start_x/y (best guess for where the drag began — within one poll
//     interval of the actual mouse-down).
//   - Subsequent changes inside DEBOUNCE_MS: keep updating drag_end_x/y;
//     reset the debounce timer.
//   - DEBOUNCE_MS after the last change, if content non-empty:
//        fire __ifttt_onSystemSelection(text_len, downX, downY, upX, upY,
//                                       screenW, screenH).
//     JS pulls text via __sys_selection_get.
//   - Content goes empty → fire __ifttt_onSystemSelectionCleared().
//
// Why polling and not XFixes: SDL3 already exposes SDL_GetPrimarySelectionText
// portably and we already poll CLIPBOARD the same way (clipboard_watch.zig).
// XFixes would buy us push-vs-pull but adds a libXfixes link + an X11 event
// thread; not worth it for a 100ms cadence.

const std = @import("std");
const c = @import("../c.zig").imports;
const HostContext = @import("../host_context.zig");
const v8_runtime = @import("../v8_runtime.zig");

const POLL_MS: u32 = 80;
const DEBOUNCE_MS: u32 = 220;

var accum_ms: u32 = 0;
var last_hash: u64 = 0;
var last_len: usize = 0;
var initialized: bool = false;

// Drag-rect tracking — populated when a change is detected, drained on fire.
var pending_fire: bool = false;
var ms_since_change: u32 = 0;
var drag_start_x: f32 = 0;
var drag_start_y: f32 = 0;
var drag_end_x: f32 = 0;
var drag_end_y: f32 = 0;

// Cached text buffer for JS-side pull. Owned here so JS reads stay valid
// across polls (the SDL-allocated copy is freed each poll).
var text_buf: [16 * 1024]u8 = undefined;
var text_len: usize = 0;

pub fn init() void {
    accum_ms = 0;
    last_hash = 0;
    last_len = 0;
    initialized = false;
    pending_fire = false;
    ms_since_change = 0;
    text_len = 0;
}

/// Returns the most recently captured PRIMARY text. JS pulls this via the
/// matching __sys_selection_get host fn after an event fires.
pub fn getText() []const u8 {
    return text_buf[0..text_len];
}

pub fn tick(host: *HostContext, dt_ms: u32) void {
    accum_ms += dt_ms;
    if (accum_ms < POLL_MS) {
        // Still tick the debounce timer between polls so fast hardware
        // (high-Hz ticking) doesn't elongate the perceived debounce window.
        if (pending_fire) {
            ms_since_change += dt_ms;
            if (ms_since_change >= DEBOUNCE_MS) firePending(host);
        }
        return;
    }
    accum_ms = 0;

    const ptr = c.SDL_GetPrimarySelectionText();
    if (ptr == null) return;
    defer c.SDL_free(@ptrCast(@constCast(ptr)));

    const raw = std.mem.span(ptr);
    const hash = std.hash.Wyhash.hash(0, raw);

    if (!initialized) {
        initialized = true;
        last_hash = hash;
        last_len = raw.len;
        return;
    }

    // Empty selection — fire clear edge once.
    if (raw.len == 0) {
        if (last_len != 0) {
            last_hash = hash;
            last_len = 0;
            pending_fire = false;
            ms_since_change = 0;
            text_len = 0;
            v8_runtime.callGlobal(host, "__beginJsEvent");
            v8_runtime.evalExpr(host, "__ifttt_onSystemSelectionCleared()");
            v8_runtime.callGlobal(host, "__endJsEvent");
        }
        return;
    }

    const changed = hash != last_hash;
    if (changed) {
        last_hash = hash;
        last_len = raw.len;

        // Snapshot text into the local buffer for JS-side pull.
        const n = @min(raw.len, text_buf.len);
        @memcpy(text_buf[0..n], raw[0..n]);
        text_len = n;

        var mx: f32 = 0;
        var my: f32 = 0;
        _ = c.SDL_GetGlobalMouseState(&mx, &my);

        if (!pending_fire) {
            pending_fire = true;
            drag_start_x = mx;
            drag_start_y = my;
        }
        drag_end_x = mx;
        drag_end_y = my;
        ms_since_change = 0;
    } else if (pending_fire) {
        ms_since_change += POLL_MS;
        if (ms_since_change >= DEBOUNCE_MS) firePending(host);
    }
}

fn firePending(host: *HostContext) void {
    pending_fire = false;
    ms_since_change = 0;

    var screen_w: f32 = 1920;
    var screen_h: f32 = 1080;
    const display_id = c.SDL_GetPrimaryDisplay();
    if (display_id != 0) {
        var rect: c.SDL_Rect = undefined;
        if (c.SDL_GetDisplayUsableBounds(display_id, &rect)) {
            screen_w = @floatFromInt(rect.w);
            screen_h = @floatFromInt(rect.h);
        }
    }

    var buf: [256]u8 = undefined;
    const sentinel = std.fmt.bufPrintZ(
        &buf,
        "__ifttt_onSystemSelection({d},{d:.0},{d:.0},{d:.0},{d:.0},{d:.0},{d:.0})",
        .{ text_len, drag_start_x, drag_start_y, drag_end_x, drag_end_y, screen_w, screen_h },
    ) catch return;
    v8_runtime.callGlobal(host, "__beginJsEvent");
    v8_runtime.evalExpr(host, sentinel);
    v8_runtime.callGlobal(host, "__endJsEvent");
}
