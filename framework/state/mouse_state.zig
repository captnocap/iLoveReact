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
pub var g_mouse_down: bool = false;
pub var g_mouse_right_down: bool = false;

pub fn updateMouse(x: f32, y: f32) void {
    g_mouse_x = x;
    g_mouse_y = y;
}

pub fn updateMouseButton(down: bool, right: bool) void {
    if (right) {
        g_mouse_right_down = down;
    } else {
        g_mouse_down = down;
    }
}
