//! ReactJIT Core — framework root module for shared library builds.
//!
//! Re-exports framework modules AND provides C-ABI wrappers that
//! cart executables link against. The cart uses framework/api.zig
//! (types + extern declarations) and resolves functions from this .so.

pub const layout = @import("layout.zig");
pub const state_mod = @import("state.zig");
pub const engine_mod = @import("engine.zig");
// qjs_runtime + luajit_runtime moved to archive/qjs-stack/ — Smith-era
// runtimes that V8 carts never reach. See task #13.
// NOTE: llama.cpp symbols are in a separate libllama_ffi.so, not in the engine.
// Carts that use llama FFI link it via scripts/build auto-detection.

// ── State C-ABI exports ─────────────────────────────────────────────

export fn rjit_state_create_slot(initial: i64) usize {
    return state_mod.createSlot(initial);
}
export fn rjit_state_create_slot_float(initial: f64) usize {
    return state_mod.createSlotFloat(initial);
}
export fn rjit_state_create_slot_bool(initial: bool) usize {
    return state_mod.createSlotBool(initial);
}
export fn rjit_state_create_slot_string(ptr: [*]const u8, len: usize) usize {
    return state_mod.createSlotString(ptr[0..len]);
}
export fn rjit_state_get_slot(id: usize) i64 {
    return state_mod.getSlot(id);
}
export fn rjit_state_set_slot(id: usize, val: i64) void {
    state_mod.setSlot(id, val);
}
export fn rjit_state_get_slot_float(id: usize) f64 {
    return state_mod.getSlotFloat(id);
}
export fn rjit_state_set_slot_float(id: usize, val: f64) void {
    state_mod.setSlotFloat(id, val);
}
export fn rjit_state_get_slot_bool(id: usize) bool {
    return state_mod.getSlotBool(id);
}
export fn rjit_state_set_slot_bool(id: usize, val: bool) void {
    state_mod.setSlotBool(id, val);
}
export fn rjit_state_get_slot_string_ptr(id: usize) [*]const u8 {
    return state_mod.getSlotString(id).ptr;
}
export fn rjit_state_get_slot_string_len(id: usize) usize {
    return state_mod.getSlotString(id).len;
}
export fn rjit_state_set_slot_string(id: usize, ptr: [*]const u8, len: usize) void {
    state_mod.setSlotString(id, ptr[0..len]);
}
export fn rjit_state_mark_dirty() void {
    state_mod.markDirty();
}
export fn rjit_state_is_dirty() bool {
    return state_mod.isDirty();
}
export fn rjit_state_clear_dirty() void {
    state_mod.clearDirty();
}

// ── Theme C-ABI exports ────────────────────────────────────────────

const theme_mod = @import("theme.zig");

export fn rjit_theme_active_variant() u8 {
    return theme_mod.activeVariant();
}
export fn rjit_theme_set_variant(v: u8) void {
    theme_mod.setVariant(v);
}

// ── Breakpoint C-ABI exports ───────────────────────────────────────

const bp_mod = @import("breakpoint.zig");

export fn rjit_breakpoint_current() u8 {
    return @intFromEnum(bp_mod.current());
}

const std = @import("std");

// ── Engine C-ABI export ─────────────────────────────────────────────

const api = @import("api.zig");

export fn rjit_engine_run(config: *const api.EngineConfig) c_int {
    engine_mod.run(.{
        .title = config.title,
        .root = @ptrCast(config.root),
        .js_logic = config.js_logic_ptr[0..config.js_logic_len],
        .lua_logic = config.lua_logic_ptr[0..config.lua_logic_len],
        .init = config.init,
        .tick = config.tick,
        .borderless = config.borderless,
    }) catch return 1;
    return 0;
}

// ── Window chrome C-ABI exports ─────────────────────────────────────

export fn rjit_window_close() void {
    engine_mod.windowClose();
}
export fn rjit_window_minimize() void {
    engine_mod.windowMinimize();
}
export fn rjit_window_maximize() void {
    engine_mod.windowMaximize();
}
export fn rjit_window_is_maximized() bool {
    return engine_mod.windowIsMaximized();
}
