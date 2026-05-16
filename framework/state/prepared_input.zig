//! framework/prepared_input.zig — shared globals for prepared-input state
//! (mouse / scroll coordinates and the prepared-node-event id) plus the
//! terminal dock resize tracker. These previously lived in qjs_runtime.zig
//! despite having nothing to do with the QuickJS engine — they were just
//! housed there because qjs_runtime was the "main" runtime file. Moving
//! them out is part of the QJS eviction (archive/qjs-stack/README.md).
//!
//! Writer: v8_app.zig (input pre-processing path).
//! Readers: framework/v8_bindings_core.zig, framework/v8_bindings_fs.zig.

// ── Prepared input event coords ───────────────────────────────────────

pub var g_prepared_node_event_id: u32 = 0;
pub var g_prepared_mouse_x: f64 = 0;
pub var g_prepared_mouse_y: f64 = 0;
pub var g_prepared_scroll_x: f64 = 0;
pub var g_prepared_scroll_y: f64 = 0;
pub var g_prepared_scroll_dx: f64 = 0;
pub var g_prepared_scroll_dy: f64 = 0;

pub fn prepareNodeEvent(slot: u32) void {
    g_prepared_node_event_id = slot;
}

pub fn prepareScrollEvent(slot: u32, scroll_x: f32, scroll_y: f32, dx: f32, dy: f32) void {
    g_prepared_node_event_id = slot;
    g_prepared_scroll_x = scroll_x;
    g_prepared_scroll_y = scroll_y;
    g_prepared_scroll_dx = dx;
    g_prepared_scroll_dy = dy;
}

// ── Open-window callback hook ─────────────────────────────────────────
// Lets engine.zig hand the windows subsystem an "open new window" entry
// point at startup. Lives here for the same reason as the prepared-input
// globals — was previously housed in qjs_runtime.zig because someone
// needed a single global home.

pub const OpenWindowFn = *const fn (title: [*:0]const u8, w: c_int, h: c_int) void;
var g_open_window_fn: ?OpenWindowFn = null;

pub fn setOpenWindowFn(f: OpenWindowFn) void {
    g_open_window_fn = f;
}

pub fn openWindow(title: [*:0]const u8, w: c_int, h: c_int) void {
    if (g_open_window_fn) |f| f(title, w, h);
}

// ── Terminal dock resize (sweatshop / IDE-style carts) ────────────────

var g_dock_resize_active: bool = false;
var g_dock_resize_start_y: f64 = 0;
var g_dock_resize_start_height: f64 = 0;

pub fn beginTerminalDockResize(start_y: f64, start_height: f64) void {
    g_dock_resize_active = true;
    g_dock_resize_start_y = start_y;
    g_dock_resize_start_height = start_height;
}

pub fn endTerminalDockResize() void {
    g_dock_resize_active = false;
}

pub fn terminalDockResizeActive() bool {
    return g_dock_resize_active;
}

pub fn terminalDockResizeStartY() f64 {
    return g_dock_resize_start_y;
}

pub fn terminalDockResizeStartHeight() f64 {
    return g_dock_resize_start_height;
}
