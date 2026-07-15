//! Engine-wide mouse state container.
//!
//! Owns the global cursor position and button state that every runtime
//! (V8 host bindings, QJS host fns, LuaJIT host fns, GPU effect uniforms)
//! reads from. Written once per SDL mouse event in engine.zig.
//!
//! Previously these vars lived inside qjs_runtime.zig as a historical
//! accident — V8 and LuaJIT both reached across into qjs_runtime to read
//! `g_mouse_x` etc. Lifting the state here removes the misleading import
//! and gives every consumer a clear, runtime-neutral home.

pub var g_mouse_x: f32 = 0;
pub var g_mouse_y: f32 = 0;
pub var g_mouse_delta_x: f32 = 0;
pub var g_mouse_delta_y: f32 = 0;
pub var g_mouse_down: bool = false;
pub var g_mouse_right_down: bool = false;

// Which physical device last drove the pointer (GIMP-style device awareness).
// SDL3 synthesizes mouse events from a tablet pen with `which == SDL_PEN_MOUSEID`,
// so pen input keeps flowing through the one mouse pipeline — this only records
// who is speaking. 0 = mouse, 1 = pen. Pressure is the pen's live pressure axis
// (0..1); a mouse has none, so JS falls back to button state for it.
pub const PointerDevice = enum(u8) { mouse = 0, pen = 1 };
pub var g_pointer_device: PointerDevice = .mouse;
pub var g_pen_pressure: f32 = 0;

/// Record the device behind a pointer event. Returns true when the device
/// CHANGED (the caller fires the JS device-change signal on that edge).
pub fn updatePointerDevice(dev: PointerDevice) bool {
    if (g_pointer_device == dev) return false;
    g_pointer_device = dev;
    return true;
}

pub fn updateMouse(x: f32, y: f32) void {
    g_mouse_x = x;
    g_mouse_y = y;
}

pub fn addMouseDelta(dx: f32, dy: f32) void {
    g_mouse_delta_x += dx;
    g_mouse_delta_y += dy;
}

pub fn consumeMouseDelta() [2]f32 {
    const delta = .{ g_mouse_delta_x, g_mouse_delta_y };
    g_mouse_delta_x = 0;
    g_mouse_delta_y = 0;
    return delta;
}

pub fn updateMouseButton(down: bool, right: bool) void {
    if (right) {
        g_mouse_right_down = down;
    } else {
        g_mouse_down = down;
    }
}
