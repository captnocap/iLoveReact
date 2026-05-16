//! Dirty bit — the single live wire between Zig-side event handlers and the
//! React reconciler.
//!
//! Zig event handlers (input, windows, filedrop, system_signals, …) call
//! `markDirty()` after producing a side effect that the JS world needs to
//! observe. The main tick in `v8_app.zig` polls `isDirty()` once per frame,
//! clears it, and triggers a React re-render.
//!
//! Replaced the Smith-era 658-line `state.zig` slot system on 2026-05-15.
//! Every other state cell (useState, useReducer, etc.) lives inside React
//! inside V8 — none of it touches Zig.

var g_dirty: bool = false;

pub fn markDirty() void {
    g_dirty = true;
}

pub fn isDirty() bool {
    return g_dirty;
}

pub fn clearDirty() void {
    g_dirty = false;
}
