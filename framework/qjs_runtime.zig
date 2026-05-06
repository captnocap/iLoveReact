//! QuickJS Runtime — the main loop for <script> mode apps.
//!
//! Provides: SDL2 windowing, QuickJS VM, state bridge, SDL2 painter, telemetry.
//! The generated_app.zig just needs to provide: root node, JS_LOGIC, state init.
//! In lean builds (has_quickjs=false), all public functions are no-ops.

const std = @import("std");
const log = @import("log.zig");
const build_options = @import("build_options");
const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;

const c = @import("c.zig").imports;
const layout = @import("layout.zig");
const text_mod = @import("text.zig");
const state = @import("state.zig");
const pty_mod = if (HAS_QUICKJS) @import("pty.zig") else struct {
    pub const Pty = struct {};
};

const HAS_DEBUG_SERVER = if (@hasDecl(build_options, "has_debug_server")) build_options.has_debug_server else false;
const qjs_ipc = if (HAS_DEBUG_SERVER) @import("qjs_ipc.zig") else struct {
    pub fn registerAll(_: *anyopaque) void {}
};
const qjs_bindings = @import("qjs_bindings.zig");
const mouse_state = @import("mouse_state.zig");

const Node = layout.Node;
const Color = layout.Color;
const TextEngine = text_mod.TextEngine;

// ── QuickJS C bindings (only in full builds) ────────────────────
const qjs = if (HAS_QUICKJS) @cImport({
    @cDefine("_GNU_SOURCE", "1");
    @cDefine("QUICKJS_NG_BUILD", "1");
    @cInclude("quickjs.h");
}) else struct {
    pub const JSValue = extern struct { u: extern union { int32: i32 } = .{ .int32 = 0 }, tag: i64 = 0 };
    pub const JSRuntime = opaque {};
    pub const JSContext = opaque {};
};
const QJS_UNDEFINED = if (HAS_QUICKJS) (qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = 3 }) else qjs.JSValue{};

fn jsBoolValue(val: bool) qjs.JSValue {
    if (comptime !HAS_QUICKJS) return qjs.JSValue{};
    return qjs.JSValue{
        .u = .{ .int32 = if (val) 1 else 0 },
        .tag = qjs.JS_TAG_BOOL,
    };
}

var g_qjs_rt: ?*qjs.JSRuntime = null;
var g_qjs_ctx: ?*qjs.JSContext = null;
var g_text_engine: ?*TextEngine = null;

// ── PTY pool ─────────────────────────────────────────────────────
const MAX_PTYS: usize = 16;
var g_ptys: [MAX_PTYS]?pty_mod.Pty = .{null} ** MAX_PTYS;
var g_active_pty_handle: u8 = 0;

// ── Claude SDK session singleton ─────────────────────────────────
const claude_sdk = @import("claude_sdk/mod.zig");
var g_claude_session: ?claude_sdk.Session = null;

// ── Kimi Wire SDK session singleton ──────────────────────────────
const kimi_wire_sdk = @import("kimi_wire_sdk.zig");
var g_kimi_session: ?kimi_wire_sdk.Session = null;
var g_kimi_turn_text: std.ArrayList(u8) = .{};
var g_kimi_turn_thinking: std.ArrayList(u8) = .{};

// ── Local AI runtime singleton ────────────────────────────────────
const local_ai_runtime = @import("local_ai_runtime.zig");
var g_local_ai_session: ?*local_ai_runtime.Session = null;

// ── Telemetry (written by the main loop, read by JS host functions) ──
pub var telemetry_fps: u32 = 0;
pub var telemetry_layout_us: u64 = 0;
pub var telemetry_paint_us: u64 = 0;
// GPU encode + submit + present time (the gpu.frame() call). Distinct
// from telemetry_paint_us, which is just the CPU-side walk that emits
// draw commands. Use this to separate "framework overhead" from
// "actual GPU rasterization."
pub var telemetry_gpu_us: u64 = 0;
pub var telemetry_tick_us: u64 = 0;
pub var telemetry_bridge_calls: u64 = 0;
pub var bridge_calls_this_second: u64 = 0;
var bridge_last_reset: i64 = 0;
pub var g_prepared_node_event_id: u32 = 0;
pub var g_prepared_mouse_x: f32 = 0;
pub var g_prepared_mouse_y: f32 = 0;
pub var g_prepared_scroll_x: f32 = 0;
pub var g_prepared_scroll_y: f32 = 0;
pub var g_prepared_scroll_dx: f32 = 0;
pub var g_prepared_scroll_dy: f32 = 0;
var g_terminal_dock_resize_active: bool = false;
var g_terminal_dock_resize_start_y: f32 = 0;
var g_terminal_dock_resize_start_height: f32 = 0;

pub fn beginTerminalDockResize(start_y: f32, start_height: f32) void {
    g_terminal_dock_resize_active = true;
    g_terminal_dock_resize_start_y = start_y;
    g_terminal_dock_resize_start_height = start_height;
}

pub fn endTerminalDockResize() void {
    g_terminal_dock_resize_active = false;
}

pub fn terminalDockResizeActive() bool {
    return g_terminal_dock_resize_active;
}

pub fn terminalDockResizeStartY() f32 {
    return g_terminal_dock_resize_start_y;
}

pub fn terminalDockResizeStartHeight() f32 {
    return g_terminal_dock_resize_start_height;
}

fn kimiResetTurnBuffers() void {
    g_kimi_turn_text.clearRetainingCapacity();
    g_kimi_turn_thinking.clearRetainingCapacity();
}

fn kimiDeinitTurnBuffers() void {
    g_kimi_turn_text.deinit(std.heap.c_allocator);
    g_kimi_turn_thinking.deinit(std.heap.c_allocator);
    g_kimi_turn_text = .{};
    g_kimi_turn_thinking = .{};
}

fn kimiAppendTurnText(kind: enum { assistant, thinking }, chunk: []const u8) void {
    if (chunk.len == 0) return;
    switch (kind) {
        .assistant => g_kimi_turn_text.appendSlice(std.heap.c_allocator, chunk) catch {},
        .thinking => g_kimi_turn_thinking.appendSlice(std.heap.c_allocator, chunk) catch {},
    }
}

// ── Host functions ──────────────────────────────────────────────

fn hostSetState(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    var slot_id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &slot_id, argv[0]);
    if (slot_id < 0 or slot_id >= state.MAX_SLOTS) return QJS_UNDEFINED;
    switch (state.getSlotKind(@intCast(slot_id))) {
        .string => {
            const str = qjs.JS_ToCString(ctx, argv[1]);
            if (str == null) return QJS_UNDEFINED;
            defer qjs.JS_FreeCString(ctx, str);
            state.setSlotString(@intCast(slot_id), std.mem.span(str));
        },
        .float => {
            var f: f64 = 0;
            _ = qjs.JS_ToFloat64(ctx, &f, argv[1]);
            state.setSlotFloat(@intCast(slot_id), f);
        },
        .boolean => {
            state.setSlotBool(@intCast(slot_id), qjs.JS_ToBool(ctx, argv[1]) != 0);
        },
        .int => {
            var f: f64 = 0;
            _ = qjs.JS_ToFloat64(ctx, &f, argv[1]);
            state.setSlot(@intCast(slot_id), @intFromFloat(f));
        },
    }
    state.markDirty();
    bridge_calls_this_second += 1;
    return QJS_UNDEFINED;
}

fn hostSetStateString(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    var slot_id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &slot_id, argv[0]);
    if (slot_id < 0 or slot_id >= state.MAX_SLOTS) return QJS_UNDEFINED;
    const str = qjs.JS_ToCString(ctx, argv[1]);
    if (str == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, str);
    state.setSlotString(@intCast(slot_id), std.mem.span(str));
    state.markDirty();
    return QJS_UNDEFINED;
}

fn hostGetState(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var slot_id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &slot_id, argv[0]);
    if (slot_id < 0 or slot_id >= state.MAX_SLOTS) return QJS_UNDEFINED;
    return switch (state.getSlotKind(@intCast(slot_id))) {
        .float => qjs.JS_NewFloat64(null, state.getSlotFloat(@intCast(slot_id))),
        .boolean => qjs.JS_NewFloat64(null, if (state.getSlotBool(@intCast(slot_id))) 1 else 0),
        .int => qjs.JS_NewFloat64(null, @floatFromInt(state.getSlot(@intCast(slot_id)))),
        .string => qjs.JS_NewFloat64(null, 0),
    };
}

fn hostGetStateString(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var slot_id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &slot_id, argv[0]);
    if (slot_id < 0 or slot_id >= state.MAX_SLOTS) return QJS_UNDEFINED;
    const s = state.getSlotString(@intCast(slot_id));
    return qjs.JS_NewStringLen(ctx, s.ptr, @intCast(s.len));
}

fn hostLog(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    const msg = qjs.JS_ToCString(ctx, argv[1]);
    if (msg == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, msg);
    std.log.info("[JS] {s}", .{std.mem.span(msg)});
    return QJS_UNDEFINED;
}

/// __markDirty() — mark state dirty from QJS. Used by OA setters (setItems etc.)
/// that update JS-side data without going through Lua setters.
fn hostMarkDirty(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    state.markDirty();
    return QJS_UNDEFINED;
}

/// __luaEval(code) — evaluate a Lua expression from QJS. Used by JS setters
/// to call Lua setters directly so Lua owns state.
fn hostLuaEval(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    const code = qjs.JS_ToCString(c2, argv[0]);
    if (code == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(c2, code);
    const luajit = @import("luajit_runtime.zig");
    luajit.evalExpr(std.mem.span(code));
    return QJS_UNDEFINED;
}

/// __js_eval(code) — evaluate a JS expression string and return result as string.
/// Used by the inspector console to run live expressions.
fn hostJsEval(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    const code = qjs.JS_ToCString(c2, argv[0]);
    if (code == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(c2, code);
    const code_span = std.mem.span(code);
    const result = qjs.JS_Eval(c2, code, @intCast(code_span.len), "<eval>", qjs.JS_EVAL_TYPE_GLOBAL);
    if (qjs.JS_IsException(result)) {
        // Get exception message
        const exc = qjs.JS_GetException(c2);
        defer qjs.JS_FreeValue(c2, exc);
        const exc_str = qjs.JS_ToCString(c2, exc);
        if (exc_str != null) {
            defer qjs.JS_FreeCString(c2, exc_str);
            const span = std.mem.span(exc_str);
            return qjs.JS_NewStringLen(c2, span.ptr, @intCast(span.len));
        }
        return qjs.JS_NewStringLen(c2, "Error", 5);
    }
    // Convert result to string
    const str = qjs.JS_ToCString(c2, result);
    qjs.JS_FreeValue(c2, result);
    if (str == null) return qjs.JS_NewStringLen(c2, "undefined", 9);
    defer qjs.JS_FreeCString(c2, str);
    const span = std.mem.span(str);
    return qjs.JS_NewStringLen(c2, span.ptr, @intCast(span.len));
}

fn hostHeavyCompute(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewFloat64(null, 0);
    var n: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &n, argv[0]);
    const compute = @extern(*const fn (c_long) callconv(.c) c_long, .{ .name = "heavy_compute" });
    const result = compute(@intCast(n));
    return qjs.JS_NewFloat64(null, @floatFromInt(result));
}

fn hostHeavyComputeTimed(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewFloat64(null, 0);
    var n: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &n, argv[0]);
    const compute = @extern(*const fn (c_long) callconv(.c) c_long, .{ .name = "heavy_compute_timed" });
    const result = compute(@intCast(n));
    return qjs.JS_NewFloat64(null, @floatFromInt(result));
}

fn hostSetComputeN(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var n: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &n, argv[0]);
    const setter = @extern(*const fn (c_long) callconv(.c) void, .{ .name = "set_compute_n" });
    setter(@intCast(n));
    return QJS_UNDEFINED;
}

fn hostGetActiveNode(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const canvas_mod = @import("canvas.zig");
    if (canvas_mod.getActiveNode()) |idx| {
        return qjs.JS_NewFloat64(null, @floatFromInt(idx));
    }
    return qjs.JS_NewFloat64(null, -1);
}

fn hostGetSelectedNode(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const canvas_mod = @import("canvas.zig");
    if (canvas_mod.getSelectedNode()) |idx| {
        return qjs.JS_NewFloat64(null, @floatFromInt(idx));
    }
    return qjs.JS_NewFloat64(null, -1);
}

fn hostGetInputText(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const input_mod = @import("input.zig");
    if (argc < 1) return qjs.JS_NewString(ctx, "");
    var id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &id, argv[0]);
    const text = input_mod.getText(@intCast(@max(0, id)));
    if (text.len == 0) return qjs.JS_NewString(ctx, "");
    // Need null-terminated string for JS
    return qjs.JS_NewStringLen(ctx, text.ptr, @intCast(text.len));
}

/// __setInputText(id, text) — write to the framework input buffer directly.
/// Used to clear an input from JS after a button-driven submit.
fn hostSetInputText(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const input_mod = @import("input.zig");
    if (argc < 2) return QJS_UNDEFINED;
    var id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &id, argv[0]);
    const s = qjs.JS_ToCString(ctx, argv[1]);
    if (s == null) {
        input_mod.setText(@intCast(@max(0, id)), "");
        return QJS_UNDEFINED;
    }
    defer qjs.JS_FreeCString(ctx, s);
    input_mod.setText(@intCast(@max(0, id)), std.mem.span(s));
    return QJS_UNDEFINED;
}

/// __pollInputSubmit() -> { id: number, text: string } | null
/// Drains the framework's "last Enter submit" one-shot. Enables carts whose
/// onSubmit handler the compiler failed to wire up to still drive Enter
/// submissions from a tick loop.
fn hostPollInputSubmit(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const input_mod = @import("input.zig");
    const c2 = ctx orelse return QJS_UNDEFINED;
    const evt = input_mod.consumeLastSubmit() orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "id", @floatFromInt(evt.id));
    _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, evt.text.ptr, @intCast(evt.text.len)));
    return obj;
}

fn hostGetPreparedRightClick(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "x", g_prepared_mouse_x);
    setF(c2, obj, "y", g_prepared_mouse_y);
    return obj;
}

fn hostGetPreparedScroll(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "scrollX", g_prepared_scroll_x);
    setF(c2, obj, "scrollY", g_prepared_scroll_y);
    setF(c2, obj, "deltaX", g_prepared_scroll_dx);
    setF(c2, obj, "deltaY", g_prepared_scroll_dy);
    return obj;
}

pub fn prepareNodeEvent(node_id: u32) void {
    g_prepared_node_event_id = node_id;
}

pub fn prepareScrollEvent(node_id: u32, scroll_x: f32, scroll_y: f32, delta_x: f32, delta_y: f32) void {
    g_prepared_node_event_id = node_id;
    g_prepared_scroll_x = scroll_x;
    g_prepared_scroll_y = scroll_y;
    g_prepared_scroll_dx = delta_x;
    g_prepared_scroll_dy = delta_y;
}

pub fn dispatchPreparedRightClick(x: f32, y: f32) void {
    if (g_prepared_node_event_id == 0) return;
    g_prepared_mouse_x = x;
    g_prepared_mouse_y = y;
    callGlobal("__beginJsEvent");
    callGlobalInt("__dispatchRightClick", @intCast(g_prepared_node_event_id));
    callGlobal("__endJsEvent");
    state.markDirty();
    g_prepared_node_event_id = 0;
}

pub fn dispatchPreparedScroll() void {
    if (g_prepared_node_event_id == 0) return;
    callGlobal("__beginJsEvent");
    callGlobalInt("__dispatchScroll", @intCast(g_prepared_node_event_id));
    callGlobal("__endJsEvent");
    state.markDirty();
    g_prepared_node_event_id = 0;
}

fn hostSetNodeDim(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const canvas_mod = @import("canvas.zig");
    if (argc < 2) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &idx, argv[0]);
    var opacity_f64: f64 = 1.0;
    _ = qjs.JS_ToFloat64(ctx, &opacity_f64, argv[1]);
    canvas_mod.setNodeDim(@intCast(@max(0, idx)), @floatCast(opacity_f64));
    return QJS_UNDEFINED;
}

fn hostResetNodeDim(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const canvas_mod = @import("canvas.zig");
    canvas_mod.resetNodeDim();
    return QJS_UNDEFINED;
}

fn hostSetPathFlow(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const canvas_mod = @import("canvas.zig");
    if (argc < 2) return QJS_UNDEFINED;
    var idx: i32 = 0;
    var enabled: i32 = 1;
    _ = qjs.JS_ToInt32(ctx, &idx, argv[0]);
    _ = qjs.JS_ToInt32(ctx, &enabled, argv[1]);
    canvas_mod.setFlowOverride(@intCast(@max(0, idx)), enabled != 0);
    return QJS_UNDEFINED;
}

fn hostResetPathFlow(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const canvas_mod = @import("canvas.zig");
    canvas_mod.resetFlowOverride();
    return QJS_UNDEFINED;
}

/// Resolve the app root directory from /proc/self/exe.
/// Self-extracting binaries: /proc/self/exe → <root>/lib/ld-linux-x86-64.so.2 → returns <root>/
/// Non-self-extracting:      /proc/self/exe → <root>/app.bin → returns <root>/
/// Returns the length of the directory path in buf (including trailing slash), or 0 on failure.
var _app_dir_buf: [4096]u8 = undefined;
var _app_dir_len: usize = 0;
var _app_dir_resolved: bool = false;

fn resolveAppDir() usize {
    if (_app_dir_resolved) return _app_dir_len;
    _app_dir_resolved = true;

    const exe_path = std.posix.readlink("/proc/self/exe", &_app_dir_buf) catch return 0;
    var dir_end: usize = exe_path.len;
    // Strip filename
    while (dir_end > 0 and _app_dir_buf[dir_end - 1] != '/') dir_end -= 1;
    if (dir_end == 0) return 0;
    // If exe is inside lib/, go up one more level
    if (dir_end >= 4 and std.mem.eql(u8, _app_dir_buf[dir_end - 4 .. dir_end], "lib/")) {
        dir_end -= 4;
        if (dir_end > 0 and _app_dir_buf[dir_end - 1] == '/') {
            // already at parent's trailing slash
        } else {
            while (dir_end > 0 and _app_dir_buf[dir_end - 1] != '/') dir_end -= 1;
        }
    }
    _app_dir_len = dir_end;
    return dir_end;
}

/// __get_app_dir() → string: the app's root directory (where `run` wrapper + app.bin live).
/// Useful in scripts that need to reference sibling files or spawn processes.
fn hostGetAppDir(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const dir_len = resolveAppDir();
    if (dir_len == 0) return qjs.JS_NewStringLen(c2, "", 0);
    return qjs.JS_NewStringLen(c2, &_app_dir_buf, dir_len);
}

/// __get_run_path() → string: full path to the `run` wrapper script.
fn hostGetRunPath(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const dir_len = resolveAppDir();
    if (dir_len == 0) return qjs.JS_NewStringLen(c2, "", 0);
    const run_suffix = "run";
    if (dir_len + run_suffix.len >= _app_dir_buf.len) return qjs.JS_NewStringLen(c2, "", 0);
    var buf: [4096]u8 = undefined;
    @memcpy(buf[0..dir_len], _app_dir_buf[0..dir_len]);
    @memcpy(buf[dir_len .. dir_len + run_suffix.len], run_suffix);
    return qjs.JS_NewStringLen(c2, &buf, dir_len + run_suffix.len);
}

/// Spawn a copy of the current app with TSZ_DEBUG=1. Returns child PID (or -1 on failure).
/// Uses the `run` wrapper script (sibling of app.bin) which sets up ld-linux + library-path.
fn hostSpawnSelf(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const process_mod = @import("process.zig");
    const log_mod = @import("log.zig");
    const dir_len = resolveAppDir();
    if (dir_len == 0) {
        log_mod.info(.engine, "spawn_self: failed to resolve app directory", .{});
        return qjs.JS_NewFloat64(null, -1);
    }
    // Build path to `run` wrapper
    const run_suffix = "run";
    if (dir_len + run_suffix.len >= _app_dir_buf.len) return qjs.JS_NewFloat64(null, -1);
    var run_buf: [4096]u8 = undefined;
    @memcpy(run_buf[0..dir_len], _app_dir_buf[0..dir_len]);
    @memcpy(run_buf[dir_len .. dir_len + run_suffix.len], run_suffix);
    run_buf[dir_len + run_suffix.len] = 0;
    const run_z: [*:0]const u8 = @ptrCast(run_buf[0 .. dir_len + run_suffix.len :0]);
    log_mod.info(.engine, "spawn_self: run_path={s}", .{run_z});
    const child = process_mod.spawn(.{
        .exe = run_z,
        .env = &.{.{ .key = "TSZ_DEBUG", .value = "1" }},
        .new_session = false,
    }) catch |err| {
        log_mod.info(.engine, "spawn_self: spawn failed: {s}", .{@errorName(err)});
        return qjs.JS_NewFloat64(null, -1);
    };
    log_mod.info(.engine, "spawn_self: child pid={d}", .{child.pid});
    return qjs.JS_NewFloat64(null, @floatFromInt(child.pid));
}

fn hostSetFlowEnabled(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const svg_path = @import("svg_path.zig");
    if (argc < 1) return QJS_UNDEFINED;
    var val: i32 = 2;
    _ = qjs.JS_ToInt32(ctx, &val, argv[0]);
    svg_path.setFlowMode(@intCast(@max(0, @min(2, val))));
    return QJS_UNDEFINED;
}

fn hostSetVariant(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const theme_mod = @import("theme.zig");
    if (argc < 1) return QJS_UNDEFINED;
    var val: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &val, argv[0]);
    theme_mod.setVariant(@intCast(@max(0, @min(255, val))));
    return QJS_UNDEFINED;
}

fn hostGetFps(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(telemetry_fps));
}
fn hostGetLayoutUs(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(telemetry_layout_us));
}
fn hostGetPaintUs(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(telemetry_paint_us));
}
fn hostGetTickUs(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(telemetry_tick_us));
}
fn hostGetMouseX(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatCast(mouse_state.g_mouse_x));
}
fn hostGetMouseY(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatCast(mouse_state.g_mouse_y));
}

fn hostClipboardSet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    const str = qjs.JS_ToCString(ctx, argv[0]);
    if (str == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, str);
    _ = c.SDL_SetClipboardText(str);
    return QJS_UNDEFINED;
}

fn hostClipboardGet(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const clip = c.SDL_GetClipboardText();
    if (clip == null) return qjs.JS_NewString(ctx, "");
    defer c.SDL_free(@ptrCast(clip));
    return qjs.JS_NewString(ctx, clip);
}
fn hostGetMouseDown(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (mouse_state.g_mouse_down) 1.0 else 0.0);
}
fn hostGetMouseRightDown(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (mouse_state.g_mouse_right_down) 1.0 else 0.0);
}

fn hostBeginTerminalDockResize(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    var start_y: f64 = 0;
    var start_height: f64 = 0;
    _ = qjs.JS_ToFloat64(ctx, &start_y, argv[0]);
    _ = qjs.JS_ToFloat64(ctx, &start_height, argv[1]);
    beginTerminalDockResize(@floatCast(start_y), @floatCast(start_height));
    return QJS_UNDEFINED;
}

fn hostEndTerminalDockResize(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    endTerminalDockResize();
    return QJS_UNDEFINED;
}

fn hostGetTerminalDockResizeState(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "active", if (g_terminal_dock_resize_active) 1 else 0);
    setF(c2, obj, "startY", g_terminal_dock_resize_start_y);
    setF(c2, obj, "startHeight", g_terminal_dock_resize_start_height);
    return obj;
}
fn hostIsKeyDown(_: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewFloat64(null, 0);
    var scancode: c_int = 0;
    _ = qjs.JS_ToInt32(null, &scancode, argv[0]);
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return qjs.JS_NewFloat64(null, 0);
    const pressed = keys[@intCast(scancode)];
    return qjs.JS_NewFloat64(null, if (pressed) @as(f64, 1) else @as(f64, 0));
}

// ── Telemetry host functions (build JS objects from unified snapshot) ──

const tel = @import("telemetry.zig");
const semantic = @import("semantic.zig");
const classifier = @import("classifier.zig");
const vterm_mod = @import("vterm.zig");

// ── Semantic terminal bridge ─────────────────────────────────────
// Exposes the semantic graph, classified cache, session state, and
// per-row token data to .tsz scripts. This is the bridge that turns
// raw terminal output into structured data any UI can consume.
//
// Port of: love2d/lua/capabilities/semantic_terminal.lua
// Pipeline: PTY → vterm → classifier → semantic graph → JS

fn hostSemState(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = semantic.getState();
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "mode", @floatFromInt(@intFromEnum(s.mode)));
    setB(c2, obj, "streaming", s.streaming);
    setF(c2, obj, "streaming_kind", @floatFromInt(@intFromEnum(s.streaming_kind)));
    setB(c2, obj, "awaiting_input", s.awaiting_input);
    setB(c2, obj, "awaiting_decision", s.awaiting_decision);
    setB(c2, obj, "modal_open", s.modal_open);
    setB(c2, obj, "interrupt_pending", s.interrupt_pending);
    setF(c2, obj, "turn_count", @floatFromInt(s.turn_count));
    setF(c2, obj, "current_turn_id", @floatFromInt(s.current_turn_id));
    setF(c2, obj, "node_count", @floatFromInt(s.node_count));
    setF(c2, obj, "group_count", @floatFromInt(s.group_count));
    // Mode name as string for convenience
    const mode_name = @tagName(s.mode);
    _ = qjs.JS_SetPropertyStr(c2, obj, "mode_name", qjs.JS_NewStringLen(c2, mode_name.ptr, @intCast(mode_name.len)));
    const sk_name = @tagName(s.streaming_kind);
    _ = qjs.JS_SetPropertyStr(c2, obj, "streaming_kind_name", qjs.JS_NewStringLen(c2, sk_name.ptr, @intCast(sk_name.len)));
    return obj;
}

fn hostSemNodeCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(semantic.nodeCount()));
}

fn hostSemNode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const node = semantic.getNode(@intCast(idx)) orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    const kind_name = @tagName(node.kind);
    _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kind_name.ptr, @intCast(kind_name.len)));
    const role_name = @tagName(node.role);
    _ = qjs.JS_SetPropertyStr(c2, obj, "role", qjs.JS_NewStringLen(c2, role_name.ptr, @intCast(role_name.len)));
    const lane_name = @tagName(node.lane);
    _ = qjs.JS_SetPropertyStr(c2, obj, "lane", qjs.JS_NewStringLen(c2, lane_name.ptr, @intCast(lane_name.len)));
    const scope_name = @tagName(node.scope);
    _ = qjs.JS_SetPropertyStr(c2, obj, "scope", qjs.JS_NewStringLen(c2, scope_name.ptr, @intCast(scope_name.len)));
    setF(c2, obj, "turn_id", @floatFromInt(node.turn_id));
    setF(c2, obj, "group_id", @floatFromInt(node.group_id));
    setF(c2, obj, "row_start", @floatFromInt(node.row_start));
    setF(c2, obj, "row_end", @floatFromInt(node.row_end));
    setF(c2, obj, "row_count", @floatFromInt(node.row_count));
    setF(c2, obj, "children_count", @floatFromInt(node.children_count));
    setB(c2, obj, "active", node.active);
    // Row text for the first row of this node
    if (node.row_count > 0) {
        const text = vterm_mod.getRowText(node.row_start);
        _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
    }
    return obj;
}

fn hostSemCacheCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(semantic.cacheCount()));
}

fn hostSemCacheEntry(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const entry = semantic.getCacheEntry(@intCast(idx)) orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "row", @floatFromInt(entry.row));
    const kind_name = @tagName(entry.kind);
    _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kind_name.ptr, @intCast(kind_name.len)));
    setF(c2, obj, "turn_id", @floatFromInt(entry.turn_id));
    setF(c2, obj, "group_id", @floatFromInt(entry.group_id));
    // Include row text
    const text = vterm_mod.getRowText(entry.row);
    _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
    return obj;
}

fn hostSemRowToken(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var row: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &row, argv[0]);
    if (row < 0) return QJS_UNDEFINED;
    const token = classifier.getRowToken(@intCast(row));
    const name = @tagName(token);
    return qjs.JS_NewStringLen(c2, name.ptr, @intCast(name.len));
}

fn hostSemRowText(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var row: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &row, argv[0]);
    if (row < 0) return QJS_UNDEFINED;
    const text = vterm_mod.getRowText(@intCast(row));
    return qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len));
}

fn hostSemTree(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    var buf: [4096]u8 = undefined;
    const tree = semantic.formatTree(&buf);
    return qjs.JS_NewStringLen(c2, tree.ptr, @intCast(tree.len));
}

// ── Claude SDK host functions ────────────────────────────────────
// __claude_init(cwd: string, model?: string, resume_session?: string) -> bool
// __claude_send(text: string) -> bool
// __claude_poll() -> event object or null
// __claude_close() -> void

fn hostClaudeInit(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsBoolValue(false);
    if (argc < 1) return jsBoolValue(false);
    if (g_claude_session != null) return jsBoolValue(true); // already running

    const cwd_z = qjs.JS_ToCString(c2, argv[0]);
    if (cwd_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, cwd_z);
    const cwd = std.mem.span(cwd_z);

    var model: ?[]const u8 = null;
    var model_z: ?[*:0]const u8 = null;
    if (argc >= 2) {
        model_z = qjs.JS_ToCString(c2, argv[1]);
        if (model_z) |mz| model = std.mem.span(mz);
    }
    defer if (model_z) |mz| qjs.JS_FreeCString(c2, mz);

    var resume_session: ?[]const u8 = null;
    var resume_session_z: ?[*:0]const u8 = null;
    if (argc >= 3) {
        resume_session_z = qjs.JS_ToCString(c2, argv[2]);
        if (resume_session_z) |sidz| {
            const sid = std.mem.span(sidz);
            if (sid.len > 0) resume_session = sid;
        }
    }
    defer if (resume_session_z) |sidz| qjs.JS_FreeCString(c2, sidz);

    const opts = claude_sdk.SessionOptions{
        .cwd = cwd,
        .model = model,
        .resume_session = resume_session,
        .verbose = true,
        .permission_mode = .bypass_permissions,
        .inherit_stderr = true,
    };
    log.print("[claude_sdk] init cwd={s} model={s} resume={s}\n", .{
        cwd,
        if (model) |m| m else "(default)",
        if (resume_session) |sid| sid else "(new)",
    });
    const sess = claude_sdk.Session.init(std.heap.c_allocator, opts) catch |err| {
        log.print("[claude_sdk] init FAILED: {s}\n", .{@errorName(err)});
        return jsBoolValue(false);
    };
    log.print("[claude_sdk] init OK\n", .{});
    g_claude_session = sess;
    return jsBoolValue(true);
}

fn hostClaudeSend(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsBoolValue(false);
    if (argc < 1) return jsBoolValue(false);
    if (g_claude_session == null) return jsBoolValue(false);

    const text_z = qjs.JS_ToCString(c2, argv[0]);
    if (text_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, text_z);
    const text = std.mem.span(text_z);

    log.print("[claude_sdk] send len={d}: {s}\n", .{ text.len, text[0..@min(text.len, 80)] });
    g_claude_session.?.send(text) catch |err| {
        log.print("[claude_sdk] send FAILED: {s}\n", .{@errorName(err)});
        if (g_claude_session) |*sess| {
            sess.deinit();
            g_claude_session = null;
        }
        return jsBoolValue(false);
    };
    return jsBoolValue(true);
}

var g_claude_poll_count: u64 = 0;

fn hostClaudePoll(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    g_claude_poll_count += 1;
    // Heartbeat every ~1s (60 polls @ 16ms) so we can see if the loop is alive
    if (g_claude_poll_count % 60 == 0) {
        log.print("[claude_sdk] poll heartbeat count={d} session_alive={}\n", .{ g_claude_poll_count, g_claude_session != null });
    }
    if (g_claude_session == null) return QJS_UNDEFINED;

    var owned = (g_claude_session.?.poll() catch |err| {
        log.print("[claude_sdk] poll FAILED: {s}\n", .{@errorName(err)});
        return QJS_UNDEFINED;
    }) orelse {
        if (g_claude_session.?.closed) {
            log.print("[claude_sdk] session exited\n", .{});
            g_claude_session.?.deinit();
            g_claude_session = null;
        }
        return QJS_UNDEFINED;
    };
    defer owned.deinit();

    const tag = @tagName(owned.msg);
    log.print("[claude_sdk] recv {s}\n", .{tag});
    return claudeMessageToJs(c2, owned.msg);
}

fn hostClaudeClose(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (g_claude_session) |*sess| {
        sess.close() catch {};
        sess.deinit();
        g_claude_session = null;
    }
    return QJS_UNDEFINED;
}

fn claudeMessageToJs(ctx: *qjs.JSContext, msg: claude_sdk.Message) qjs.JSValue {
    const obj = qjs.JS_NewObject(ctx);
    switch (msg) {
        .system => |s| {
            setStr(ctx, obj, "type", "system");
            setStr(ctx, obj, "session_id", s.session_id);
            if (s.model) |m| setStr(ctx, obj, "model", m);
            if (s.cwd) |cwd| setStr(ctx, obj, "cwd", cwd);
            const tools = qjs.JS_NewArray(ctx);
            for (s.tools, 0..) |tname, i| {
                _ = qjs.JS_SetPropertyUint32(ctx, tools, @intCast(i), qjs.JS_NewStringLen(ctx, tname.ptr, @intCast(tname.len)));
            }
            _ = qjs.JS_SetPropertyStr(ctx, obj, "tools", tools);
        },
        .assistant => |a| {
            setStr(ctx, obj, "type", "assistant");
            if (a.id) |id| setStr(ctx, obj, "id", id);
            if (a.session_id) |sid| setStr(ctx, obj, "session_id", sid);
            if (a.stop_reason) |sr| setStr(ctx, obj, "stop_reason", sr);
            setF(ctx, obj, "input_tokens", @floatFromInt(a.usage.input_tokens));
            setF(ctx, obj, "output_tokens", @floatFromInt(a.usage.output_tokens));

            const blocks = qjs.JS_NewArray(ctx);
            var text_join: std.ArrayList(u8) = .{};
            defer text_join.deinit(std.heap.c_allocator);
            var thinking_join: std.ArrayList(u8) = .{};
            defer thinking_join.deinit(std.heap.c_allocator);
            for (a.content, 0..) |blk, i| {
                const b_obj = qjs.JS_NewObject(ctx);
                switch (blk) {
                    .text => |t| {
                        setStr(ctx, b_obj, "type", "text");
                        setStr(ctx, b_obj, "text", t.text);
                        text_join.appendSlice(std.heap.c_allocator, t.text) catch {};
                    },
                    .thinking => |th| {
                        setStr(ctx, b_obj, "type", "thinking");
                        setStr(ctx, b_obj, "thinking", th.thinking);
                        thinking_join.appendSlice(std.heap.c_allocator, th.thinking) catch {};
                    },
                    .tool_use => |tu| {
                        setStr(ctx, b_obj, "type", "tool_use");
                        setStr(ctx, b_obj, "id", tu.id);
                        setStr(ctx, b_obj, "name", tu.name);
                        setStr(ctx, b_obj, "input_json", tu.input_json);
                    },
                }
                _ = qjs.JS_SetPropertyUint32(ctx, blocks, @intCast(i), b_obj);
            }
            _ = qjs.JS_SetPropertyStr(ctx, obj, "content", blocks);
            if (text_join.items.len > 0) setStr(ctx, obj, "text", text_join.items);
            if (thinking_join.items.len > 0) setStr(ctx, obj, "thinking", thinking_join.items);
        },
        .user => |u| {
            setStr(ctx, obj, "type", "user");
            if (u.session_id) |sid| setStr(ctx, obj, "session_id", sid);
            setStr(ctx, obj, "content_json", u.content_json);
        },
        .result => |r| {
            log.print("[claude_sdk] result num_turns={d} cost={d} is_error={}\n", .{ r.num_turns, r.total_cost_usd, r.is_error });
            setStr(ctx, obj, "type", "result");
            setStr(ctx, obj, "subtype", @tagName(r.subtype));
            setStr(ctx, obj, "session_id", r.session_id);
            if (r.result) |rt| setStr(ctx, obj, "result", rt);
            setF(ctx, obj, "total_cost_usd", r.total_cost_usd);
            setF(ctx, obj, "duration_ms", @floatFromInt(r.duration_ms));
            setF(ctx, obj, "num_turns", @floatFromInt(r.num_turns));
            setB(ctx, obj, "is_error", r.is_error);
        },
    }
    return obj;
}

// ── Kimi Wire host functions ─────────────────────────────────────
// __kimi_init(cwd: string, model?: string, session_id?: string) -> bool
// __kimi_send(text: string) -> bool
// __kimi_poll() -> event object or null
// __kimi_close() -> void

fn hostKimiInit(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsBoolValue(false);
    if (argc < 1) return jsBoolValue(false);
    if (g_kimi_session != null) return jsBoolValue(true);

    const cwd_z = qjs.JS_ToCString(c2, argv[0]);
    if (cwd_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, cwd_z);
    const cwd = std.mem.span(cwd_z);

    var model: ?[]const u8 = null;
    var model_z: ?[*:0]const u8 = null;
    if (argc >= 2) {
        model_z = qjs.JS_ToCString(c2, argv[1]);
        if (model_z) |mz| model = std.mem.span(mz);
    }
    defer if (model_z) |mz| qjs.JS_FreeCString(c2, mz);

    var session_id: ?[]const u8 = null;
    var session_id_z: ?[*:0]const u8 = null;
    if (argc >= 3) {
        session_id_z = qjs.JS_ToCString(c2, argv[2]);
        if (session_id_z) |sidz| {
            const sid = std.mem.span(sidz);
            if (sid.len > 0) session_id = sid;
        }
    }
    defer if (session_id_z) |sidz| qjs.JS_FreeCString(c2, sidz);

    const opts = kimi_wire_sdk.SessionOptions{
        .cwd = cwd,
        .model = model,
        .session_id = session_id,
        .yolo = true,
        .inherit_stderr = true,
    };
    log.print("[kimi_wire_sdk] init cwd={s} model={s} session={s}\n", .{
        cwd,
        if (model) |m| m else "(default)",
        if (session_id) |sid| sid else "(new)",
    });
    var sess = kimi_wire_sdk.Session.init(std.heap.c_allocator, opts) catch |err| {
        log.print("[kimi_wire_sdk] init FAILED: {s}\n", .{@errorName(err)});
        return jsBoolValue(false);
    };
    var init_result = sess.initialize(.{}) catch |err| {
        log.print("[kimi_wire_sdk] initialize FAILED: {s}\n", .{@errorName(err)});
        sess.deinit();
        return jsBoolValue(false);
    };
    defer init_result.deinit();

    log.print("[kimi_wire_sdk] init OK protocol={s} server={s}/{s}\n", .{
        init_result.protocol_version,
        init_result.server_name,
        init_result.server_version,
    });
    kimiResetTurnBuffers();
    g_kimi_session = sess;
    return jsBoolValue(true);
}

fn hostKimiSend(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsBoolValue(false);
    if (argc < 1) return jsBoolValue(false);
    if (g_kimi_session == null) return jsBoolValue(false);

    const text_z = qjs.JS_ToCString(c2, argv[0]);
    if (text_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, text_z);
    const text = std.mem.span(text_z);

    log.print("[kimi_wire_sdk] send len={d}: {s}\n", .{ text.len, text[0..@min(text.len, 80)] });
    kimiResetTurnBuffers();
    var token = g_kimi_session.?.prompt(.{ .text = text }) catch |err| {
        log.print("[kimi_wire_sdk] send FAILED: {s}\n", .{@errorName(err)});
        if (g_kimi_session) |*sess| {
            sess.deinit();
            g_kimi_session = null;
        }
        kimiDeinitTurnBuffers();
        return jsBoolValue(false);
    };
    token.deinit();
    return jsBoolValue(true);
}

var g_kimi_poll_count: u64 = 0;

fn hostKimiPoll(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    g_kimi_poll_count += 1;
    if (g_kimi_poll_count % 60 == 0) {
        log.print("[kimi_wire_sdk] poll heartbeat count={d} session_alive={}\n", .{ g_kimi_poll_count, g_kimi_session != null });
    }
    if (g_kimi_session == null) return QJS_UNDEFINED;

    var owned = (g_kimi_session.?.poll() catch |err| {
        log.print("[kimi_wire_sdk] poll FAILED: {s}\n", .{@errorName(err)});
        return QJS_UNDEFINED;
    }) orelse {
        if (g_kimi_session.?.closed) {
            log.print("[kimi_wire_sdk] session exited\n", .{});
            g_kimi_session.?.deinit();
            g_kimi_session = null;
            kimiDeinitTurnBuffers();
        }
        return QJS_UNDEFINED;
    };
    defer owned.deinit();

    switch (owned.msg) {
        .event => |event| log.print("[kimi_wire_sdk] recv event {s}\n", .{event.event_type}),
        .request => |request| log.print("[kimi_wire_sdk] recv request {s}\n", .{request.request_type}),
        .response => |response| log.print("[kimi_wire_sdk] recv response {s}\n", .{response.status() orelse response.id}),
    }
    return kimiMessageToJs(c2, owned.msg);
}

fn hostKimiClose(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (g_kimi_session) |*sess| {
        sess.close() catch {};
        sess.deinit();
        g_kimi_session = null;
    }
    kimiDeinitTurnBuffers();
    return QJS_UNDEFINED;
}

fn kimiMessageToJs(ctx: *qjs.JSContext, msg: kimi_wire_sdk.InboundMessage) qjs.JSValue {
    const obj = qjs.JS_NewObject(ctx);
    switch (msg) {
        .event => |event| {
            const event_name = event.event_type;
            if (std.mem.eql(u8, event_name, "TurnBegin")) {
                kimiResetTurnBuffers();
                setStr(ctx, obj, "type", "turn_begin");
                if (jsonGetStringPath(event.payload, &.{"user_input"})) |value| setStr(ctx, obj, "text", value);
                return obj;
            }
            if (std.mem.eql(u8, event_name, "TurnEnd")) {
                setStr(ctx, obj, "type", "status");
                setStr(ctx, obj, "status", "turn_end");
                return obj;
            }
            if (std.mem.eql(u8, event_name, "StatusUpdate")) {
                setStr(ctx, obj, "type", "usage");
                setF(ctx, obj, "input_tokens", @floatFromInt(jsonGetUIntPath(event.payload, &.{ "token_usage", "input_other" }) orelse 0));
                setF(ctx, obj, "output_tokens", @floatFromInt(jsonGetUIntPath(event.payload, &.{ "token_usage", "output" }) orelse 0));
                setF(ctx, obj, "cache_creation_input_tokens", @floatFromInt(jsonGetUIntPath(event.payload, &.{ "token_usage", "input_cache_creation" }) orelse 0));
                setF(ctx, obj, "cache_read_input_tokens", @floatFromInt(jsonGetUIntPath(event.payload, &.{ "token_usage", "input_cache_read" }) orelse 0));
                return obj;
            }
            if (std.mem.eql(u8, event_name, "ContentPart")) {
                const part_type = jsonGetStringPath(event.payload, &.{"type"}) orelse "unknown";
                const maybe_text = extractKimiDisplayTextAlloc(std.heap.c_allocator, event.payload) catch null;
                defer if (maybe_text) |value| std.heap.c_allocator.free(value);
                setStr(ctx, obj, "type", "assistant_part");
                if (std.mem.eql(u8, part_type, "text")) {
                    setStr(ctx, obj, "part_type", "text");
                    if (maybe_text) |value| {
                        kimiAppendTurnText(.assistant, value);
                        setStr(ctx, obj, "text", value);
                    }
                    return obj;
                }
                if (std.mem.eql(u8, part_type, "think") or std.mem.eql(u8, part_type, "thinking")) {
                    setStr(ctx, obj, "part_type", "thinking");
                    if (maybe_text) |value| {
                        kimiAppendTurnText(.thinking, value);
                        setStr(ctx, obj, "text", value);
                    }
                    return obj;
                }
                if (maybe_text) |value| {
                    kimiAppendTurnText(.assistant, value);
                    setStr(ctx, obj, "part_type", "text");
                    setStr(ctx, obj, "text", value);
                    return obj;
                }
                setStr(ctx, obj, "part_type", part_type);
                return obj;
            }
            if (std.mem.eql(u8, event_name, "ToolCall")) {
                setStr(ctx, obj, "type", "tool_call");
                if (jsonGetStringPath(event.payload, &.{ "function", "name" })) |value| setStr(ctx, obj, "name", value);
                const maybe_input_json = jsonValueTextAlloc(std.heap.c_allocator, jsonGetPath(event.payload, &.{ "function", "arguments" })) catch null;
                defer if (maybe_input_json) |value| std.heap.c_allocator.free(value);
                if (maybe_input_json) |value| setStr(ctx, obj, "input_json", value);
                return obj;
            }
            if (std.mem.eql(u8, event_name, "ToolCallPart")) {
                setStr(ctx, obj, "type", "tool_call");
                setStr(ctx, obj, "name", "tool_delta");
                if (jsonGetStringPath(event.payload, &.{"arguments_part"})) |value| setStr(ctx, obj, "input_json", value);
                return obj;
            }
            if (std.mem.eql(u8, event_name, "ToolResult")) {
                setStr(ctx, obj, "type", "tool_result");
                setB(ctx, obj, "is_error", jsonGetBoolPath(event.payload, &.{ "return_value", "is_error" }) orelse false);
                const maybe_text = extractKimiToolResultTextAlloc(std.heap.c_allocator, event.payload) catch null;
                defer if (maybe_text) |value| std.heap.c_allocator.free(value);
                if (maybe_text) |value| setStr(ctx, obj, "text", value);
                return obj;
            }
            if (std.mem.eql(u8, event_name, "PlanDisplay")) {
                setStr(ctx, obj, "type", "assistant_part");
                setStr(ctx, obj, "part_type", "text");
                const maybe_text = extractKimiDisplayTextAlloc(std.heap.c_allocator, event.payload) catch null;
                defer if (maybe_text) |value| std.heap.c_allocator.free(value);
                if (maybe_text) |value| setStr(ctx, obj, "text", value);
                return obj;
            }
            if (std.mem.endsWith(u8, event_name, "Display")) {
                const maybe_text = extractKimiDisplayTextAlloc(std.heap.c_allocator, event.payload) catch null;
                defer if (maybe_text) |value| std.heap.c_allocator.free(value);
                if (maybe_text) |value| {
                    setStr(ctx, obj, "type", "assistant_part");
                    setStr(ctx, obj, "part_type", "text");
                    setStr(ctx, obj, "text", value);
                    return obj;
                }
            }
            if (std.mem.eql(u8, event_name, "BtwBegin")) {
                setStr(ctx, obj, "type", "status");
                if (jsonGetStringPath(event.payload, &.{"question"})) |value| setStr(ctx, obj, "text", value);
                return obj;
            }
            if (std.mem.eql(u8, event_name, "BtwEnd")) {
                setStr(ctx, obj, "type", "status");
                if (jsonGetStringPath(event.payload, &.{"response"})) |value| setStr(ctx, obj, "text", value);
                if (jsonGetStringPath(event.payload, &.{"error"})) |value| {
                    setStr(ctx, obj, "text", value);
                    setB(ctx, obj, "is_error", true);
                }
                return obj;
            }

            setStr(ctx, obj, "type", "status");
            setStr(ctx, obj, "status", event_name);
            const payload_json = jsonStringifyAlloc(std.heap.c_allocator, event.payload) catch null;
            defer if (payload_json) |value| std.heap.c_allocator.free(value);
            if (payload_json) |value| setStr(ctx, obj, "payload_json", value);
            return obj;
        },
        .request => |request| {
            if (std.mem.eql(u8, request.request_type, "ToolCallRequest")) {
                setStr(ctx, obj, "type", "tool_call");
                if (jsonGetStringPath(request.payload, &.{"name"})) |value| setStr(ctx, obj, "name", value);
                if (jsonGetStringPath(request.payload, &.{"arguments"})) |value| setStr(ctx, obj, "input_json", value);
                return obj;
            }

            setStr(ctx, obj, "type", "status");
            if (std.mem.eql(u8, request.request_type, "ApprovalRequest")) {
                if (jsonGetStringPath(request.payload, &.{"description"})) |value| {
                    setStr(ctx, obj, "text", value);
                } else if (jsonGetStringPath(request.payload, &.{"action"})) |value| {
                    setStr(ctx, obj, "text", value);
                }
            } else if (std.mem.eql(u8, request.request_type, "QuestionRequest")) {
                const maybe_text = extractKimiQuestionTextAlloc(std.heap.c_allocator, request.payload) catch null;
                defer if (maybe_text) |value| std.heap.c_allocator.free(value);
                if (maybe_text) |value| setStr(ctx, obj, "text", value);
            } else if (std.mem.eql(u8, request.request_type, "HookRequest")) {
                if (jsonGetStringPath(request.payload, &.{"target"})) |value| setStr(ctx, obj, "text", value);
            }
            setStr(ctx, obj, "status", request.request_type);
            return obj;
        },
        .response => |response| {
            setStr(ctx, obj, "type", "result");
            if (response.status()) |value| setStr(ctx, obj, "status", value);
            setB(ctx, obj, "is_error", response.isError());
            if (response.error_message) |value| setStr(ctx, obj, "result", value);
            const maybe_json = response.resultJsonAlloc(std.heap.c_allocator) catch null;
            defer if (maybe_json) |value| std.heap.c_allocator.free(value);
            if (!response.isError() and g_kimi_turn_text.items.len > 0) {
                setStr(ctx, obj, "result", g_kimi_turn_text.items);
            } else if (maybe_json) |value| {
                setStr(ctx, obj, "result", value);
            }
            if (g_kimi_turn_thinking.items.len > 0) setStr(ctx, obj, "thinking", g_kimi_turn_thinking.items);
            return obj;
        },
    }
}

fn jsonStringifyAlloc(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, value, .{});
}

fn jsonValueTextAlloc(allocator: std.mem.Allocator, maybe_value: ?std.json.Value) !?[]u8 {
    const value = maybe_value orelse return null;
    if (jsonAsString(value)) |text| return try allocator.dupe(u8, text);
    return try jsonStringifyAlloc(allocator, value);
}

fn extractKimiToolResultTextAlloc(allocator: std.mem.Allocator, payload: std.json.Value) !?[]u8 {
    if (jsonGetStringPath(payload, &.{ "return_value", "message" })) |message| {
        return try allocator.dupe(u8, message);
    }
    return extractKimiContentTextAlloc(allocator, jsonGetPath(payload, &.{ "return_value", "output" }));
}

fn extractKimiDisplayTextAlloc(allocator: std.mem.Allocator, payload: std.json.Value) !?[]u8 {
    if (jsonGetStringPath(payload, &.{"text"})) |text| return try allocator.dupe(u8, text);
    if (jsonGetStringPath(payload, &.{"content"})) |text| return try allocator.dupe(u8, text);
    if (jsonGetStringPath(payload, &.{"message"})) |text| return try allocator.dupe(u8, text);
    if (jsonGetStringPath(payload, &.{"response"})) |text| return try allocator.dupe(u8, text);
    if (jsonGetStringPath(payload, &.{"delta"})) |text| return try allocator.dupe(u8, text);
    if (jsonGetStringPath(payload, &.{"markdown"})) |text| return try allocator.dupe(u8, text);
    if (jsonGetStringPath(payload, &.{"think"})) |text| return try allocator.dupe(u8, text);
    if (try extractKimiContentTextAlloc(allocator, jsonGetPath(payload, &.{"content"}))) |text| return text;
    if (try extractKimiContentTextAlloc(allocator, jsonGetPath(payload, &.{"output"}))) |text| return text;
    if (try extractKimiContentTextAlloc(allocator, jsonGetPath(payload, &.{"parts"}))) |text| return text;
    if (try extractKimiContentTextAlloc(allocator, jsonGetPath(payload, &.{"delta"}))) |text| return text;
    return null;
}

fn extractKimiQuestionTextAlloc(allocator: std.mem.Allocator, payload: std.json.Value) !?[]u8 {
    const questions_value = jsonGetPath(payload, &.{"questions"}) orelse return null;
    const questions = jsonAsArray(questions_value) orelse return null;
    if (questions.items.len == 0) return null;
    const first = jsonAsObject(questions.items[0]) orelse return null;
    const question_value = first.get("question") orelse return null;
    if (jsonAsString(question_value)) |text| return try allocator.dupe(u8, text);
    return try jsonStringifyAlloc(allocator, question_value);
}

fn extractKimiContentTextAlloc(allocator: std.mem.Allocator, maybe_value: ?std.json.Value) !?[]u8 {
    const value = maybe_value orelse return null;
    if (jsonAsString(value)) |text| return try allocator.dupe(u8, text);

    const arr = jsonAsArray(value) orelse return null;
    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(allocator);

    for (arr.items) |entry| {
        const obj = jsonAsObject(entry) orelse continue;
        const item_type = if (obj.get("type")) |type_value| jsonAsString(type_value) else null;
        if (item_type != null and !std.mem.eql(u8, item_type.?, "text")) continue;
        const text_value = obj.get("text") orelse continue;
        const text = jsonAsString(text_value) orelse continue;
        if (buf.items.len > 0) try buf.append(allocator, '\n');
        try buf.appendSlice(allocator, text);
    }

    if (buf.items.len == 0) return null;
    return try buf.toOwnedSlice(allocator);
}

fn jsonGetPath(root: std.json.Value, path: []const []const u8) ?std.json.Value {
    var current = root;
    for (path) |segment| {
        const obj = jsonAsObject(current) orelse return null;
        current = obj.get(segment) orelse return null;
    }
    return current;
}

fn jsonGetStringPath(root: std.json.Value, path: []const []const u8) ?[]const u8 {
    const value = jsonGetPath(root, path) orelse return null;
    return jsonAsString(value);
}

fn jsonGetUIntPath(root: std.json.Value, path: []const []const u8) ?u64 {
    const value = jsonGetPath(root, path) orelse return null;
    return switch (value) {
        .integer => |number| @intCast(@max(number, 0)),
        else => null,
    };
}

fn jsonGetBoolPath(root: std.json.Value, path: []const []const u8) ?bool {
    const value = jsonGetPath(root, path) orelse return null;
    return switch (value) {
        .bool => |flag| flag,
        else => null,
    };
}

fn jsonAsObject(value: std.json.Value) ?std.json.ObjectMap {
    return switch (value) {
        .object => |object| object,
        else => null,
    };
}

fn jsonAsArray(value: std.json.Value) ?std.json.Array {
    return switch (value) {
        .array => |array| array,
        else => null,
    };
}

fn jsonAsString(value: std.json.Value) ?[]const u8 {
    return switch (value) {
        .string => |text| text,
        else => null,
    };
}

// ── Local AI host functions ───────────────────────────────────────
// __localai_init(cwd: string, model_path: string, session_id?: string) -> bool
// __localai_send(text: string) -> bool
// __localai_poll() -> event object or null
// __localai_close() -> void

fn hostLocalAiInit(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsBoolValue(false);
    if (argc < 2) return jsBoolValue(false);
    if (g_local_ai_session != null) return jsBoolValue(true);

    const cwd_z = qjs.JS_ToCString(c2, argv[0]);
    if (cwd_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, cwd_z);
    const cwd = std.mem.span(cwd_z);

    const model_z = qjs.JS_ToCString(c2, argv[1]);
    if (model_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, model_z);
    const model_path = std.mem.span(model_z);
    if (model_path.len == 0) return jsBoolValue(false);

    var session_id: ?[]const u8 = null;
    var session_id_z: ?[*:0]const u8 = null;
    if (argc >= 3) {
        session_id_z = qjs.JS_ToCString(c2, argv[2]);
        if (session_id_z) |sidz| {
            const sid = std.mem.span(sidz);
            if (sid.len > 0) session_id = sid;
        }
    }
    defer if (session_id_z) |sidz| qjs.JS_FreeCString(c2, sidz);

    const opts = local_ai_runtime.SessionOptions{
        .cwd = cwd,
        .model_path = model_path,
        .session_id = session_id,
        .verbose = false,
    };
    const sess = local_ai_runtime.Session.create(std.heap.c_allocator, opts) catch |err| {
        log.print("[local_ai_runtime] init FAILED: {s}\n", .{@errorName(err)});
        return jsBoolValue(false);
    };
    g_local_ai_session = sess;
    return jsBoolValue(true);
}

fn hostLocalAiSend(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsBoolValue(false);
    if (argc < 1) return jsBoolValue(false);
    const sess = g_local_ai_session orelse return jsBoolValue(false);

    const text_z = qjs.JS_ToCString(c2, argv[0]);
    if (text_z == null) return jsBoolValue(false);
    defer qjs.JS_FreeCString(c2, text_z);
    const text = std.mem.span(text_z);

    sess.submit(.{ .text = text }) catch |err| {
        log.print("[local_ai_runtime] send FAILED: {s}\n", .{@errorName(err)});
        return jsBoolValue(false);
    };
    return jsBoolValue(true);
}

fn hostLocalAiPoll(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const sess = g_local_ai_session orelse return QJS_UNDEFINED;
    var evt = sess.poll() orelse return QJS_UNDEFINED;
    defer evt.deinit();
    return localAiEventToJs(c2, evt);
}

fn hostLocalAiClose(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (g_local_ai_session) |sess| {
        sess.destroy();
        g_local_ai_session = null;
    }
    return QJS_UNDEFINED;
}

fn localAiEventToJs(ctx: *qjs.JSContext, evt: local_ai_runtime.OwnedEvent) qjs.JSValue {
    const obj = qjs.JS_NewObject(ctx);
    switch (evt.kind) {
        .system => {
            setStr(ctx, obj, "type", "system");
            if (evt.model) |value| setStr(ctx, obj, "model", value);
            if (evt.session_id) |value| setStr(ctx, obj, "session_id", value);
        },
        .assistant_part => {
            setStr(ctx, obj, "type", "assistant_part");
            setStr(ctx, obj, "part_type", evt.part_type orelse "text");
            if (evt.text) |value| setStr(ctx, obj, "text", value);
        },
        .status => {
            setStr(ctx, obj, "type", "status");
            if (evt.text) |value| setStr(ctx, obj, "text", value);
            setB(ctx, obj, "is_error", evt.is_error);
        },
        .result => {
            setStr(ctx, obj, "type", "result");
            if (evt.text) |value| setStr(ctx, obj, "result", value);
            setB(ctx, obj, "is_error", evt.is_error);
        },
    }
    return obj;
}

fn setStr(ctx: *qjs.JSContext, obj: qjs.JSValue, key: []const u8, val: []const u8) void {
    var key_buf: [64]u8 = undefined;
    if (key.len >= key_buf.len) return;
    @memcpy(key_buf[0..key.len], key);
    key_buf[key.len] = 0;
    _ = qjs.JS_SetPropertyStr(ctx, obj, @ptrCast(&key_buf), qjs.JS_NewStringLen(ctx, val.ptr, @intCast(val.len)));
}

fn hostSemSetMode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var mode: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &mode, argv[0]);
    // 0=none, 1=basic, 2=claude_code, 3=json (JS-driven)
    classifier.setMode(switch (mode) {
        1 => .basic,
        2 => .claude_code,
        3 => .json,
        else => .none,
    });
    classifier.markDirty();
    return QJS_UNDEFINED;
}

fn hostSemHasDiff(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (semantic.hasDiff()) 1.0 else 0.0);
}

fn hostSemFrame(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(semantic.getFrame()));
}

fn hostSemExport(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const count = semantic.cacheCount();
    const arr = qjs.JS_NewArray(c2);
    var i: u16 = 0;
    while (i < count) : (i += 1) {
        const entry = semantic.getCacheEntry(i) orelse continue;
        const obj = qjs.JS_NewObject(c2);
        setF(c2, obj, "row", @floatFromInt(entry.row));
        const kind_name = @tagName(entry.kind);
        _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kind_name.ptr, @intCast(kind_name.len)));
        setF(c2, obj, "turn_id", @floatFromInt(entry.turn_id));
        setF(c2, obj, "group_id", @floatFromInt(entry.group_id));
        const text = vterm_mod.getRowText(entry.row);
        _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
        // Token color
        const tc = classifier.tokenColor(entry.kind);
        var hex_buf: [8]u8 = undefined;
        const hex = std.fmt.bufPrint(&hex_buf, "#{x:0>2}{x:0>2}{x:0>2}", .{ tc.r, tc.g, tc.b }) catch "#e2e8f0";
        _ = qjs.JS_SetPropertyStr(c2, obj, "color", qjs.JS_NewStringLen(c2, hex.ptr, @intCast(hex.len)));
        _ = qjs.JS_SetPropertyUint32(c2, arr, @intCast(i), obj);
    }
    return arr;
}

// ── JSON-driven classifier bridge ────────────────────────────────
// These let JS set row tokens directly and trigger the graph build,
// enabling runtime classifiers loaded from JSON sheets.

fn hostSemSetRowToken(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    var row: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &row, argv[0]);
    if (row < 0) return QJS_UNDEFINED;
    const name = qjs.JS_ToCString(ctx, argv[1]);
    if (name == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, name);
    const token = classifier.tokenFromName(std.mem.span(name));
    classifier.setRowToken(@intCast(row), token);
    return QJS_UNDEFINED;
}

fn hostSemVtermRows(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(vterm_mod.getRows()));
}

fn hostSemBuildGraph(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    var rows: i32 = 0;
    if (argc >= 1) _ = qjs.JS_ToInt32(ctx, &rows, argv[0]);
    if (rows <= 0) rows = @intCast(vterm_mod.getRows());
    semantic.tick(@intCast(rows));
    return QJS_UNDEFINED;
}

/// Single-shot semantic snapshot — the standardized consumer format.
/// Returns a versioned JS object with state + classified rows + graph.
/// Consumer calls JSON.stringify(__sem_snapshot()) to get the wire format.
///
/// Schema (v1):
///   { version, classifier, frame,
///     state: { mode, streaming, streaming_kind, awaiting_input, ... },
///     rows: [ { row, kind, role, lane, turn_id, group_id, text, color } ],
///     graph: { node_count, turn_count, tree } }
fn hostSemSnapshot(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const root = qjs.JS_NewObject(c2);

    // Version + metadata
    setF(c2, root, "version", 1.0);
    const cls_name = switch (classifier.getMode()) {
        .none => "none",
        .basic => "basic",
        .claude_code => "claude_code",
        .json => "json",
    };
    _ = qjs.JS_SetPropertyStr(c2, root, "classifier", qjs.JS_NewStringLen(c2, cls_name.ptr, @intCast(cls_name.len)));
    setF(c2, root, "frame", @floatFromInt(semantic.getFrame()));

    // State
    const s = semantic.getState();
    const st = qjs.JS_NewObject(c2);
    const mode_name = @tagName(s.mode);
    _ = qjs.JS_SetPropertyStr(c2, st, "mode", qjs.JS_NewStringLen(c2, mode_name.ptr, @intCast(mode_name.len)));
    setB(c2, st, "streaming", s.streaming);
    const sk = @tagName(s.streaming_kind);
    _ = qjs.JS_SetPropertyStr(c2, st, "streaming_kind", qjs.JS_NewStringLen(c2, sk.ptr, @intCast(sk.len)));
    setB(c2, st, "awaiting_input", s.awaiting_input);
    setB(c2, st, "awaiting_decision", s.awaiting_decision);
    setB(c2, st, "modal_open", s.modal_open);
    setB(c2, st, "interrupt_pending", s.interrupt_pending);
    setF(c2, st, "turn_count", @floatFromInt(s.turn_count));
    setF(c2, st, "current_turn_id", @floatFromInt(s.current_turn_id));
    setF(c2, st, "node_count", @floatFromInt(s.node_count));
    setF(c2, st, "group_count", @floatFromInt(s.group_count));
    _ = qjs.JS_SetPropertyStr(c2, root, "state", st);

    // Rows — classified cache with role/lane from the token definitions
    const count = semantic.cacheCount();
    const rows = qjs.JS_NewArray(c2);
    var i: u16 = 0;
    while (i < count) : (i += 1) {
        const entry = semantic.getCacheEntry(i) orelse continue;
        const obj = qjs.JS_NewObject(c2);
        setF(c2, obj, "row", @floatFromInt(entry.row));
        const kn = @tagName(entry.kind);
        _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kn.ptr, @intCast(kn.len)));
        const role = @tagName(semantic.roleOf(entry.kind));
        _ = qjs.JS_SetPropertyStr(c2, obj, "role", qjs.JS_NewStringLen(c2, role.ptr, @intCast(role.len)));
        const lane = @tagName(semantic.laneOf(entry.kind));
        _ = qjs.JS_SetPropertyStr(c2, obj, "lane", qjs.JS_NewStringLen(c2, lane.ptr, @intCast(lane.len)));
        setF(c2, obj, "turn_id", @floatFromInt(entry.turn_id));
        setF(c2, obj, "group_id", @floatFromInt(entry.group_id));
        const text = vterm_mod.getRowText(entry.row);
        _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
        const tc = classifier.tokenColor(entry.kind);
        var hb: [8]u8 = undefined;
        const hx = std.fmt.bufPrint(&hb, "#{x:0>2}{x:0>2}{x:0>2}", .{ tc.r, tc.g, tc.b }) catch "#e2e8f0";
        _ = qjs.JS_SetPropertyStr(c2, obj, "color", qjs.JS_NewStringLen(c2, hx.ptr, @intCast(hx.len)));
        _ = qjs.JS_SetPropertyUint32(c2, rows, @intCast(i), obj);
    }
    _ = qjs.JS_SetPropertyStr(c2, root, "rows", rows);

    // Graph summary
    const g = qjs.JS_NewObject(c2);
    setF(c2, g, "node_count", @floatFromInt(semantic.nodeCount()));
    setF(c2, g, "turn_count", @floatFromInt(s.turn_count));
    var tree_buf: [4096]u8 = undefined;
    const tree = semantic.formatTree(&tree_buf);
    _ = qjs.JS_SetPropertyStr(c2, g, "tree", qjs.JS_NewStringLen(c2, tree.ptr, @intCast(tree.len)));
    _ = qjs.JS_SetPropertyStr(c2, root, "graph", g);

    return root;
}

fn setF(ctx: *qjs.JSContext, obj: qjs.JSValue, name: [*:0]const u8, val: f64) void {
    _ = qjs.JS_SetPropertyStr(ctx, obj, name, qjs.JS_NewFloat64(ctx, val));
}

fn setB(ctx: *qjs.JSContext, obj: qjs.JSValue, name: [*:0]const u8, val: bool) void {
    setF(ctx, obj, name, if (val) 1.0 else 0.0);
}

// ── Recording/playback bridge ────────────────────────────────────
const player_mod = @import("player.zig");

fn hostRecStart(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const rows = vterm_mod.getRows();
    const cols = vterm_mod.getCols();
    vterm_mod.startRecording(rows, cols);
    log.print("[rec] started ({d}x{d})\n", .{ rows, cols });
    return QJS_UNDEFINED;
}

fn hostRecStop(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    vterm_mod.stopRecording();
    log.print("[rec] stopped\n", .{});
    return QJS_UNDEFINED;
}

fn hostRecSave(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewFloat64(null, 0);
    const path_c = qjs.JS_ToCString(ctx, argv[0]);
    if (path_c == null) return qjs.JS_NewFloat64(null, 0);
    defer qjs.JS_FreeCString(ctx, path_c);
    const path = std.mem.span(path_c);
    const ok = vterm_mod.saveRecording(path);
    log.print("[rec] save {s} → {s}\n", .{ path, if (ok) "OK" else "FAIL" });
    return qjs.JS_NewFloat64(null, if (ok) 1.0 else 0.0);
}

fn hostRecToggle(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (vterm_mod.isRecording()) {
        vterm_mod.stopRecording();
    } else {
        vterm_mod.startRecording(vterm_mod.getRows(), vterm_mod.getCols());
    }
    return qjs.JS_NewFloat64(null, if (vterm_mod.isRecording()) 1.0 else 0.0);
}

fn hostRecIsRecording(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (vterm_mod.isRecording()) 1.0 else 0.0);
}

fn hostRecFrameCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(vterm_mod.getRecorder().frame_count));
}

fn hostPlayLoad(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    // Load from the current recorder's in-memory data
    const rec = vterm_mod.getRecorder();
    if (rec.frame_count == 0) return qjs.JS_NewFloat64(null, 0);
    player_mod.load(rec);
    return qjs.JS_NewFloat64(null, 1.0);
}

fn hostPlayPlay(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    player_mod.play();
    return QJS_UNDEFINED;
}

fn hostPlayPause(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    player_mod.pause();
    return QJS_UNDEFINED;
}

fn hostPlayToggle(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    player_mod.togglePlay();
    return QJS_UNDEFINED;
}

fn hostPlayStep(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    player_mod.step();
    return QJS_UNDEFINED;
}

fn hostPlaySeek(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var frac: f64 = 0;
    _ = qjs.JS_ToFloat64(ctx, &frac, argv[0]);
    player_mod.seekFraction(@floatCast(frac));
    return QJS_UNDEFINED;
}

fn hostPlaySpeed(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var spd: f64 = 1;
    _ = qjs.JS_ToFloat64(ctx, &spd, argv[0]);
    player_mod.setSpeed(@floatCast(spd));
    return QJS_UNDEFINED;
}

fn hostPlayState(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (!player_mod.isLoaded()) return QJS_UNDEFINED;
    const s = player_mod.getState();
    const obj = qjs.JS_NewObject(c2);
    setB(c2, obj, "playing", s.playing);
    setF(c2, obj, "time_us", @floatFromInt(s.time_us));
    setF(c2, obj, "duration_us", @floatFromInt(s.duration_us));
    setF(c2, obj, "frame", @floatFromInt(s.frame));
    setF(c2, obj, "total_frames", @floatFromInt(s.total_frames));
    setF(c2, obj, "speed", s.speed);
    setB(c2, obj, "at_end", s.at_end);
    setB(c2, obj, "at_start", s.at_start);
    setF(c2, obj, "progress", if (s.duration_us > 0) @as(f64, @floatFromInt(s.time_us)) / @as(f64, @floatFromInt(s.duration_us)) else 0.0);
    return obj;
}

fn hostTelFrame(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "fps", @floatFromInt(s.fps));
    setF(c2, obj, "tick_us", @floatFromInt(s.tick_us));
    setF(c2, obj, "layout_us", @floatFromInt(s.layout_us));
    setF(c2, obj, "paint_us", @floatFromInt(s.paint_us));
    setF(c2, obj, "frame_total_us", @floatFromInt(s.frame_total_us));
    setF(c2, obj, "frame_number", @floatFromInt(s.frame_number));
    setF(c2, obj, "bridge_calls_per_sec", @floatFromInt(s.bridge_calls_per_sec));
    return obj;
}

fn hostTelGpu(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "rect_count", @floatFromInt(s.rect_count));
    setF(c2, obj, "glyph_count", @floatFromInt(s.glyph_count));
    setF(c2, obj, "rect_capacity", @floatFromInt(s.rect_capacity));
    setF(c2, obj, "glyph_capacity", @floatFromInt(s.glyph_capacity));
    setF(c2, obj, "atlas_glyph_count", @floatFromInt(s.atlas_glyph_count));
    setF(c2, obj, "atlas_capacity", @floatFromInt(s.atlas_capacity));
    setF(c2, obj, "atlas_row_x", @floatFromInt(s.atlas_row_x));
    setF(c2, obj, "atlas_row_y", @floatFromInt(s.atlas_row_y));
    setF(c2, obj, "scissor_depth", @floatFromInt(s.scissor_depth));
    setF(c2, obj, "scissor_segment_count", @floatFromInt(s.scissor_segment_count));
    setF(c2, obj, "gpu_surface_w", @floatFromInt(s.gpu_surface_w));
    setF(c2, obj, "gpu_surface_h", @floatFromInt(s.gpu_surface_h));
    setF(c2, obj, "frame_hash", @floatFromInt(s.frame_hash));
    setF(c2, obj, "frames_since_drain", @floatFromInt(s.frames_since_drain));
    return obj;
}

fn hostTelNodes(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "total", @floatFromInt(s.total_nodes));
    setF(c2, obj, "visible", @floatFromInt(s.visible_nodes));
    setF(c2, obj, "hidden", @floatFromInt(s.hidden_nodes));
    setF(c2, obj, "zero_size", @floatFromInt(s.zero_size_nodes));
    setF(c2, obj, "max_depth", @floatFromInt(s.max_depth));
    setF(c2, obj, "scroll", @floatFromInt(s.scroll_nodes));
    setF(c2, obj, "text", @floatFromInt(s.text_nodes));
    setF(c2, obj, "image", @floatFromInt(s.image_nodes));
    setF(c2, obj, "pressable", @floatFromInt(s.pressable_nodes));
    setF(c2, obj, "canvas", @floatFromInt(s.canvas_nodes));
    return obj;
}

fn hostTelState(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "slot_count", @floatFromInt(s.state_slot_count));
    setF(c2, obj, "slot_capacity", @floatFromInt(s.state_slot_capacity));
    setB(c2, obj, "dirty", s.state_dirty);
    setF(c2, obj, "array_slot_count", @floatFromInt(s.array_slot_count));
    setF(c2, obj, "array_slot_capacity", @floatFromInt(s.array_slot_capacity));
    return obj;
}

fn hostTelSystem(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "window_x", @floatFromInt(s.window_x));
    setF(c2, obj, "window_y", @floatFromInt(s.window_y));
    setF(c2, obj, "window_w", @floatFromInt(s.window_w));
    setF(c2, obj, "window_h", @floatFromInt(s.window_h));
    setF(c2, obj, "display_count", @floatFromInt(s.display_count));
    setF(c2, obj, "current_display", @floatFromInt(s.current_display));
    setF(c2, obj, "display_w", @floatFromInt(s.display_w));
    setF(c2, obj, "display_h", @floatFromInt(s.display_h));
    setF(c2, obj, "breakpoint", @floatFromInt(s.breakpoint_tier));
    setF(c2, obj, "secondary_windows", @floatFromInt(s.secondary_window_count));
    return obj;
}

fn hostTelInput(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "focused_id", @floatFromInt(s.focused_input_id));
    setF(c2, obj, "active_count", @floatFromInt(s.active_input_count));
    setB(c2, obj, "has_selection", s.has_selection);
    setB(c2, obj, "selection_dragging", s.selection_dragging);
    setB(c2, obj, "tooltip_visible", s.tooltip_visible);
    return obj;
}

fn hostTelCanvas(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "cam_x", s.canvas_cam_x);
    setF(c2, obj, "cam_y", s.canvas_cam_y);
    setF(c2, obj, "cam_zoom", s.canvas_cam_zoom);
    setF(c2, obj, "type_count", @floatFromInt(s.canvas_type_count));
    return obj;
}

fn hostTelNet(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "active_connections", @floatFromInt(s.net_active_connections));
    setF(c2, obj, "open_connections", @floatFromInt(s.net_open_connections));
    setF(c2, obj, "reconnecting", @floatFromInt(s.net_reconnecting));
    setF(c2, obj, "event_queue_depth", @floatFromInt(s.net_event_queue_depth));
    return obj;
}

fn hostTelLayout(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = tel.current;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "budget", @floatFromInt(s.layout_budget));
    setF(c2, obj, "budget_used", @floatFromInt(s.layout_budget_used));
    setF(c2, obj, "route_history_depth", @floatFromInt(s.route_history_depth));
    setF(c2, obj, "route_current_index", @floatFromInt(s.route_current_index));
    setF(c2, obj, "log_channels_enabled", @floatFromInt(s.log_channels_enabled));
    return obj;
}

fn hostTelHistory(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    var count: i32 = 40;
    if (argc >= 1) _ = qjs.JS_ToInt32(c2, &count, argv[0]);
    const n: usize = @intCast(@max(1, @min(count, 120)));
    const avail = tel.historyCount();
    const actual = @min(n, avail);

    const arr = qjs.JS_NewArray(c2);
    for (0..actual) |i| {
        if (tel.getHistory(i)) |snap| {
            _ = qjs.JS_SetPropertyUint32(c2, arr, @intCast(i), qjs.JS_NewFloat64(c2, @floatFromInt(snap.frame_total_us)));
        }
    }
    return arr;
}

fn hostTelNodeCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(tel.nodeCount()));
}

fn hostTelNode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const node = tel.getNode(@intCast(idx)) orelse return QJS_UNDEFINED;
    const depth = tel.getNodeDepth(@intCast(idx));
    const r = node.computed;

    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "depth", @floatFromInt(depth));
    setF(c2, obj, "child_count", @floatFromInt(node.children.len));
    setF(c2, obj, "x", r.x);
    setF(c2, obj, "y", r.y);
    setF(c2, obj, "w", r.w);
    setF(c2, obj, "h", r.h);
    setB(c2, obj, "has_text", node.text != null);
    setB(c2, obj, "has_image", node.image_src != null);
    setB(c2, obj, "has_handler", node.handlers.on_press != null);
    setB(c2, obj, "has_tooltip", node.tooltip != null);
    setF(c2, obj, "font_size", @floatFromInt(node.font_size));
    setF(c2, obj, "opacity", node.style.opacity);
    setF(c2, obj, "scroll_y", node.scroll_y);
    setF(c2, obj, "content_height", node.content_height);

    // Tag name — debug_name or inferred type
    const tag = node.debug_name orelse tel.nodeTypeName(node);
    _ = qjs.JS_SetPropertyStr(c2, obj, "tag", qjs.JS_NewStringLen(c2, tag.ptr, @intCast(tag.len)));

    // Display and flex direction as numbers
    setF(c2, obj, "display", @floatFromInt(@intFromEnum(node.style.display)));
    setF(c2, obj, "flex_direction", @floatFromInt(@intFromEnum(node.style.flex_direction)));

    return obj;
}

fn hostTelNodeStyle(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const node = tel.getNode(@intCast(idx)) orelse return QJS_UNDEFINED;
    const sty = node.style;
    const obj = qjs.JS_NewObject(c2);

    // Dimensions
    if (sty.width) |v| setF(c2, obj, "width", v) else setF(c2, obj, "width", -1);
    if (sty.height) |v| setF(c2, obj, "height", v) else setF(c2, obj, "height", -1);
    if (sty.min_width) |v| setF(c2, obj, "min_width", v);
    if (sty.max_width) |v| setF(c2, obj, "max_width", v);
    if (sty.min_height) |v| setF(c2, obj, "min_height", v);
    if (sty.max_height) |v| setF(c2, obj, "max_height", v);

    // Flex
    setF(c2, obj, "flex_grow", sty.flex_grow);
    if (sty.flex_shrink) |v| setF(c2, obj, "flex_shrink", v);
    if (sty.flex_basis) |v| setF(c2, obj, "flex_basis", v);
    setF(c2, obj, "flex_direction", @floatFromInt(@intFromEnum(sty.flex_direction)));
    setF(c2, obj, "justify_content", @floatFromInt(@intFromEnum(sty.justify_content)));
    setF(c2, obj, "align_items", @floatFromInt(@intFromEnum(sty.align_items)));
    setF(c2, obj, "align_self", @floatFromInt(@intFromEnum(sty.align_self)));
    setF(c2, obj, "gap", sty.gap);

    // Padding
    setF(c2, obj, "padding", sty.padding);
    if (sty.padding_left) |v| setF(c2, obj, "padding_left", v);
    if (sty.padding_right) |v| setF(c2, obj, "padding_right", v);
    if (sty.padding_top) |v| setF(c2, obj, "padding_top", v);
    if (sty.padding_bottom) |v| setF(c2, obj, "padding_bottom", v);

    // Margin
    setF(c2, obj, "margin", sty.margin);
    if (sty.margin_left) |v| setF(c2, obj, "margin_left", v);
    if (sty.margin_right) |v| setF(c2, obj, "margin_right", v);
    if (sty.margin_top) |v| setF(c2, obj, "margin_top", v);
    if (sty.margin_bottom) |v| setF(c2, obj, "margin_bottom", v);

    // Visual
    setF(c2, obj, "border_radius", sty.border_radius);
    setF(c2, obj, "border_width", sty.border_width);
    if (sty.border_top_width) |v| setF(c2, obj, "border_top_width", v);
    if (sty.border_right_width) |v| setF(c2, obj, "border_right_width", v);
    if (sty.border_bottom_width) |v| setF(c2, obj, "border_bottom_width", v);
    if (sty.border_left_width) |v| setF(c2, obj, "border_left_width", v);
    setF(c2, obj, "opacity", sty.opacity);
    setF(c2, obj, "z_index", @floatFromInt(sty.z_index));
    setF(c2, obj, "rotation", sty.rotation);
    setF(c2, obj, "scale_x", sty.scale_x);
    setF(c2, obj, "scale_y", sty.scale_y);

    // Background color
    if (sty.background_color) |bg| {
        setF(c2, obj, "bg_r", @floatFromInt(bg.r));
        setF(c2, obj, "bg_g", @floatFromInt(bg.g));
        setF(c2, obj, "bg_b", @floatFromInt(bg.b));
        setF(c2, obj, "bg_a", @floatFromInt(bg.a));
    }

    // Border color
    if (sty.border_color) |bc| {
        setF(c2, obj, "border_r", @floatFromInt(bc.r));
        setF(c2, obj, "border_g", @floatFromInt(bc.g));
        setF(c2, obj, "border_b", @floatFromInt(bc.b));
        setF(c2, obj, "border_a", @floatFromInt(bc.a));
    }

    // Position
    setF(c2, obj, "position", @floatFromInt(@intFromEnum(sty.position)));
    if (sty.top) |v| setF(c2, obj, "top", v);
    if (sty.left) |v| setF(c2, obj, "left", v);
    if (sty.right) |v| setF(c2, obj, "right", v);
    if (sty.bottom) |v| setF(c2, obj, "bottom", v);

    // Overflow, display, text align
    setF(c2, obj, "overflow", @floatFromInt(@intFromEnum(sty.overflow)));
    setF(c2, obj, "display", @floatFromInt(@intFromEnum(sty.display)));
    setF(c2, obj, "text_align", @floatFromInt(@intFromEnum(sty.text_align)));

    return obj;
}

fn hostTelNodeBoxModel(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const node = tel.getNode(@intCast(idx)) orelse return QJS_UNDEFINED;
    const sty = node.style;
    const r = node.computed;

    const obj = qjs.JS_NewObject(c2);
    // Computed rect
    setF(c2, obj, "x", r.x);
    setF(c2, obj, "y", r.y);
    setF(c2, obj, "w", r.w);
    setF(c2, obj, "h", r.h);

    // Resolved padding
    setF(c2, obj, "pad_top", sty.padTop());
    setF(c2, obj, "pad_right", sty.padRight());
    setF(c2, obj, "pad_bottom", sty.padBottom());
    setF(c2, obj, "pad_left", sty.padLeft());

    // Resolved margin (no helper methods — resolve optional fields manually)
    setF(c2, obj, "margin_top", sty.margin_top orelse sty.margin);
    setF(c2, obj, "margin_right", sty.margin_right orelse sty.margin);
    setF(c2, obj, "margin_bottom", sty.margin_bottom orelse sty.margin);
    setF(c2, obj, "margin_left", sty.margin_left orelse sty.margin);

    setF(c2, obj, "border_width", sty.border_width);
    setF(c2, obj, "border_top_width", sty.brdTop());
    setF(c2, obj, "border_right_width", sty.brdRight());
    setF(c2, obj, "border_bottom_width", sty.brdBottom());
    setF(c2, obj, "border_left_width", sty.brdLeft());

    // Content dimensions
    const pl = sty.padLeft();
    const pr = sty.padRight();
    const pt = sty.padTop();
    const pb = sty.padBottom();
    setF(c2, obj, "content_w", @max(0, r.w - pl - pr));
    setF(c2, obj, "content_h", @max(0, r.h - pt - pb));

    return obj;
}

const polyfill =
    \\globalThis.console = {
    \\  log: function(...args) { __hostLog(0, args.map(String).join(' ')); },
    \\  warn: function(...args) { __hostLog(1, args.map(String).join(' ')); },
    \\  error: function(...args) { __hostLog(2, args.map(String).join(' ')); },
    \\};
    \\globalThis._timers = [];
    \\globalThis._timerIdNext = 1;
    \\globalThis.setTimeout = function(fn, ms) {
    \\  const id = globalThis._timerIdNext++;
    \\  globalThis._timers.push({ id, fn, ms: ms || 0, at: Date.now() + (ms || 0), interval: false });
    \\  return id;
    \\};
    \\globalThis.setInterval = function(fn, ms) {
    \\  const id = globalThis._timerIdNext++;
    \\  globalThis._timers.push({ id, fn, ms: ms || 16, at: Date.now() + (ms || 16), interval: true });
    \\  return id;
    \\};
    \\globalThis.clearTimeout = function(id) {
    \\  globalThis._timers = globalThis._timers.filter(t => t.id !== id);
    \\};
    \\globalThis.clearInterval = globalThis.clearTimeout;
    \\globalThis.__zigOS_tick = function() {
    \\  const now = Date.now();
    \\  const ready = globalThis._timers.filter(t => now >= t.at);
    \\  for (const t of ready) {
    \\    t.fn();
    \\    if (t.interval) { t.at = now + t.ms; }
    \\  }
    \\  globalThis._timers = globalThis._timers.filter(t => t.interval || now < t.at);
    \\};
    \\globalThis.fetch = function(url) {
    \\  const body = __fetch(url);
    \\  return body;
    \\};
    \\globalThis.__semCls = {
    \\  sheet: null, prevKind: null,
    \\  load: function(path) {
    \\    var json = __fs_readfile(path);
    \\    if (!json) return false;
    \\    try { this.sheet = JSON.parse(json); } catch(e) { return false; }
    \\    __sem_set_mode(3);
    \\    return true;
    \\  },
    \\  _match: function(r, text, trimmed) {
    \\    var t = r.on === 'trimmed' ? trimmed : text;
    \\    if (r.match === 'contains') return t.indexOf(r.value) >= 0;
    \\    if (r.match === 'starts_with') {
    \\      var s = trimmed;
    \\      if (r.case === 'insensitive') return s.toLowerCase().indexOf(r.value.toLowerCase()) === 0;
    \\      return s.indexOf(r.value) === 0;
    \\    }
    \\    if (r.match === 'equals') return trimmed === r.value;
    \\    if (r.match === 'regex') return new RegExp(r.pattern).test(t);
    \\    return false;
    \\  },
    \\  classifyRow: function(text, row, total) {
    \\    if (!this.sheet) return 'output';
    \\    var trimmed = text.replace(/^\s+|\s+$/g, '');
    \\    if (trimmed.length === 0) return this.sheet.default_token || 'output';
    \\    var rules = this.sheet.rules;
    \\    for (var i = 0; i < rules.length; i++) {
    \\      var r = rules[i];
    \\      if (r.max_row !== undefined && row > r.max_row) continue;
    \\      if (r.zone === 'bottom_8' && row < total - 8) continue;
    \\      if (r.max_len && trimmed.length > r.max_len) continue;
    \\      if (!this._match(r, text, trimmed)) continue;
    \\      if (r.also && !this._match(r.also, text, trimmed)) continue;
    \\      if (r.not_contains && text.indexOf(r.not_contains) >= 0) continue;
    \\      return r.token;
    \\    }
    \\    return this.sheet.default_token || 'output';
    \\  },
    \\  refine: function(kind, prev, text) {
    \\    if (!this.sheet || !this.sheet.adjacency) return kind;
    \\    var adj = this.sheet.adjacency;
    \\    for (var i = 0; i < adj.length; i++) {
    \\      var a = adj[i];
    \\      if (a.when_current && a.when_current !== kind) continue;
    \\      if (a.when_prev && a.when_prev.indexOf(prev) < 0) continue;
    \\      if (a.text_contains && text.indexOf(a.text_contains) < 0) continue;
    \\      return a.promote_to;
    \\    }
    \\    return kind;
    \\  },
    \\  classifyAll: function() {
    \\    if (!this.sheet) return;
    \\    var rows = __sem_vterm_rows();
    \\    var prev = null;
    \\    for (var r = 0; r < rows; r++) {
    \\      var text = __sem_row_text(r);
    \\      var kind = this.classifyRow(text, r, rows);
    \\      kind = this.refine(kind, prev, text);
    \\      __sem_set_row_token(r, kind);
    \\      prev = kind;
    \\    }
    \\    __sem_build_graph(rows);
    \\  }
    \\};
;

// ── IFTTT rules engine (embedded JS) ─────────────────────────────
// Same DSL as the Lua version. Runs in QuickJS for <script> block carts.
// Source-of-truth doc: framework/ifttt_lua.mod.tsz (same API, different lang)

const JS_IFTTT =
    \\// ifttt: If This Then That rules engine for QuickJS
    \\globalThis.__ifttt = { rules: {}, _nextId: 1, _initialized: false, _elapsed: 0 };
    \\
    \\// ── SDL scancode name table ──
    \\var __ifttt_keys = {
    \\  a:4,b:5,c:6,d:7,e:8,f:9,g:10,h:11,i:12,j:13,k:14,l:15,m:16,
    \\  n:17,o:18,p:19,q:20,r:21,s:22,t:23,u:24,v:25,w:26,x:27,y:28,z:29,
    \\  '1':30,'2':31,'3':32,'4':33,'5':34,'6':35,'7':36,'8':37,'9':38,'0':39,
    \\  enter:40,return:40,escape:41,esc:41,backspace:42,tab:43,space:44,
    \\  minus:45,equals:46,leftbracket:47,rightbracket:48,backslash:49,
    \\  semicolon:51,apostrophe:52,grave:53,comma:54,period:55,slash:56,
    \\  capslock:57,f1:58,f2:59,f3:60,f4:61,f5:62,f6:63,f7:64,f8:65,
    \\  f9:66,f10:67,f11:68,f12:69,printscreen:70,scrolllock:71,pause:72,
    \\  insert:73,home:74,pageup:75,delete:76,end:77,pagedown:78,
    \\  right:79,left:80,down:81,up:82,
    \\};
    \\function __ifttt_resolveKey(name) {
    \\  if (!isNaN(+name)) return +name;
    \\  return __ifttt_keys[name.toLowerCase()] || 0;
    \\}
    \\
    \\// ── Named state registry ──
    \\// Script blocks call __ifttt_registerState('name', slotId) during init
    \\globalThis.__ifttt_stateMap = {};
    \\globalThis.__ifttt_registerState = function(name, slot) {
    \\  __ifttt_stateMap[name] = slot;
    \\};
    \\function __ifttt_resolveSlot(s) {
    \\  if (!isNaN(+s)) return +s;
    \\  return __ifttt_stateMap[s] !== undefined ? __ifttt_stateMap[s] : -1;
    \\}
    \\
    \\// ── Trigger parsing ──
    \\function __ifttt_parseTrigger(t) {
    \\  if (t === 'mount') return { kind: 'mount' };
    \\  if (t === 'click') return { kind: 'event', event: 'click' };
    \\  if (t === 'filedrop') return { kind: 'event', event: 'filedrop' };
    \\
    \\  let m;
    \\  if ((m = t.match(/^key:up:(.+)$/))) return { kind: 'key_up', key: __ifttt_resolveKey(m[1]) };
    \\
    \\  // key:ctrl+s, key:ctrl+shift+z — combo with modifiers
    \\  if (t.startsWith('key:') && t.includes('+')) {
    \\    var parts = t.slice(4).toLowerCase().split('+');
    \\    var combo = { ctrl: false, shift: false, alt: false, key: 0 };
    \\    for (var pi = 0; pi < parts.length; pi++) {
    \\      var p = parts[pi].trim();
    \\      if (p === 'ctrl' || p === 'control') combo.ctrl = true;
    \\      else if (p === 'shift') combo.shift = true;
    \\      else if (p === 'alt') combo.alt = true;
    \\      else combo.key = __ifttt_resolveKey(p);
    \\    }
    \\    return { kind: 'key_combo', combo: combo };
    \\  }
    \\
    \\  if ((m = t.match(/^key:(.+)$/))) return { kind: 'key', key: __ifttt_resolveKey(m[1]) };
    \\
    \\  // state:<name_or_slot>:<value>
    \\  if ((m = t.match(/^state:([^:]+):(.+)$/))) {
    \\    var slot = __ifttt_resolveSlot(m[1]);
    \\    var val = m[2];
    \\    if (val === 'true') val = true;
    \\    else if (val === 'false') val = false;
    \\    else if (!isNaN(+val)) val = +val;
    \\    return { kind: 'state_match', slot: slot, matchVal: val, prevMatched: false };
    \\  }
    \\  if ((m = t.match(/^timer:every:(\d+)$/))) return { kind: 'timer_every', intervalMs: +m[1], accum: 0 };
    \\  if ((m = t.match(/^timer:once:(\d+)$/))) return { kind: 'timer_once', intervalMs: +m[1], accum: 0, fired: false };
    \\
    \\  return { kind: 'event', event: t };
    \\}
    \\
    \\// ── Action execution ──
    \\function __ifttt_execAction(action, event) {
    \\  if (typeof action === 'function') { action(event); return; }
    \\  let m;
    \\
    \\  // state:set:<name_or_slot>:<value>
    \\  if ((m = action.match(/^state:set:([^:]+):(.+)$/))) {
    \\    const slot = __ifttt_resolveSlot(m[1]), val = m[2];
    \\    if (slot < 0) return;
    \\    if (val === 'true') __setState(slot, 1);
    \\    else if (val === 'false') __setState(slot, 0);
    \\    else if (!isNaN(+val)) __setState(slot, +val);
    \\    else __setStateString(slot, val);
    \\    return;
    \\  }
    \\
    \\  // state:toggle:<name_or_slot>
    \\  if ((m = action.match(/^state:toggle:([^:]+)$/))) {
    \\    const slot = __ifttt_resolveSlot(m[1]);
    \\    if (slot < 0) return;
    \\    __setState(slot, __getState(slot) === 0 ? 1 : 0);
    \\    return;
    \\  }
    \\
    \\  if ((m = action.match(/^call:(.+)$/))) {
    \\    const fn = globalThis[m[1]];
    \\    if (typeof fn === 'function') fn(event);
    \\    return;
    \\  }
    \\
    \\  if ((m = action.match(/^log:(.+)$/))) {
    \\    console.log('[IFTTT]', m[1], event || '');
    \\    return;
    \\  }
    \\
    \\  // clipboard:<text> — copy text to system clipboard
    \\  if ((m = action.match(/^clipboard:(.+)$/))) {
    \\    __clipboard_set(m[1]);
    \\    return;
    \\  }
    \\
    \\  // notification:<msg> — log with notification prefix (OS notifications TODO)
    \\  if ((m = action.match(/^notification:(.+)$/))) {
    \\    console.log('[NOTIFICATION]', m[1]);
    \\    return;
    \\  }
    \\}
    \\
    \\// ── Public API ──
    \\globalThis.useIFTTT = function(trigger, action) {
    \\  const rule = {
    \\    id: __ifttt._nextId++,
    \\    action: action,
    \\    fired: 0,
    \\    active: true,
    \\  };
    \\
    \\  if (typeof trigger === 'function') {
    \\    rule.trigger = { kind: 'condition', fn: trigger, prev: false };
    \\  } else {
    \\    rule.trigger = __ifttt_parseTrigger(trigger);
    \\  }
    \\
    \\  __ifttt.rules[rule.id] = rule;
    \\  return rule;
    \\};
    \\
    \\function __ifttt_fire(rule, event) {
    \\  if (!rule.active) return;
    \\  rule.fired++;
    \\  __ifttt_execAction(rule.action, event);
    \\}
    \\
    \\globalThis.__ifttt_init = function() {
    \\  for (const id in __ifttt.rules) {
    \\    const rule = __ifttt.rules[id];
    \\    if (rule.trigger.kind === 'mount') __ifttt_fire(rule);
    \\    if (rule.trigger.kind === 'condition') rule.trigger.prev = rule.trigger.fn();
    \\  }
    \\  __ifttt._initialized = true;
    \\};
    \\
    \\// Patch existing __zigOS_tick to include IFTTT tick
    \\const __ifttt_origTick = globalThis.__zigOS_tick;
    \\globalThis.__zigOS_tick = function() {
    \\  // Run original timer tick
    \\  if (__ifttt_origTick) __ifttt_origTick();
    \\
    \\  // IFTTT tick (16ms assumed if no better dt available)
    \\  const dt = 16;
    \\  __ifttt._elapsed += dt;
    \\
    \\  for (const id in __ifttt.rules) {
    \\    const rule = __ifttt.rules[id];
    \\    if (!rule.active) continue;
    \\    const t = rule.trigger;
    \\
    \\    if (t.kind === 'timer_every') {
    \\      t.accum += dt;
    \\      while (t.accum >= t.intervalMs) {
    \\        t.accum -= t.intervalMs;
    \\        __ifttt_fire(rule);
    \\      }
    \\    } else if (t.kind === 'timer_once') {
    \\      if (!t.fired) {
    \\        t.accum += dt;
    \\        if (t.accum >= t.intervalMs) {
    \\          t.fired = true;
    \\          __ifttt_fire(rule);
    \\        }
    \\      }
    \\    } else if (t.kind === 'state_match') {
    \\      const cur = __getState(t.slot);
    \\      let matched = false;
    \\      if (typeof t.matchVal === 'boolean') {
    \\        matched = t.matchVal ? cur !== 0 : cur === 0;
    \\      } else {
    \\        matched = cur === t.matchVal;
    \\      }
    \\      if (matched && !t.prevMatched) __ifttt_fire(rule);
    \\      t.prevMatched = matched;
    \\    } else if (t.kind === 'condition') {
    \\      const cur = t.fn();
    \\      if (cur && !t.prev) __ifttt_fire(rule);
    \\      t.prev = cur;
    \\    }
    \\  }
    \\};
    \\
    \\globalThis.__ifttt_onKeyDown = function(packed) {
    \\  // Decode: low 16 bits = keycode, high 16 bits = modifiers
    \\  var keycode = packed & 0xFFFF;
    \\  var mods = (packed >> 16) & 0xFFFF;
    \\  var hasCtrl = (mods & 0x00C0) !== 0;
    \\  var hasShift = (mods & 0x0003) !== 0;
    \\  var hasAlt = (mods & 0x0300) !== 0;
    \\  var evt = { key: keycode, mods: mods, ctrl: hasCtrl, shift: hasShift, alt: hasAlt };
    \\
    \\  for (const id in __ifttt.rules) {
    \\    const rule = __ifttt.rules[id];
    \\    if (!rule.active) continue;
    \\    if (rule.trigger.kind === 'key' && rule.trigger.key === keycode) {
    \\      __ifttt_fire(rule, evt);
    \\    } else if (rule.trigger.kind === 'key_combo') {
    \\      var c = rule.trigger.combo;
    \\      if (c.key === keycode && c.ctrl === hasCtrl && c.shift === hasShift && c.alt === hasAlt) {
    \\        __ifttt_fire(rule, evt);
    \\      }
    \\    }
    \\  }
    \\};
    \\
    \\globalThis.__ifttt_onKeyUp = function(packed) {
    \\  var keycode = packed & 0xFFFF;
    \\  for (const id in __ifttt.rules) {
    \\    const rule = __ifttt.rules[id];
    \\    if (!rule.active) continue;
    \\    if (rule.trigger.kind === 'key_up' && rule.trigger.key === keycode) {
    \\      __ifttt_fire(rule, { key: keycode });
    \\    }
    \\  }
    \\};
    \\
    \\// SDL_BUTTON_LEFT=1, SDL_BUTTON_RIGHT=3
    \\globalThis.__ifttt_onClick = function(packed) {
    \\  var button = packed & 0xFFFF;
    \\  var mx = (packed >> 16) & 0xFFFF;
    \\  var isLeft = (button === 1);
    \\  var isRight = (button === 3);
    \\  var evt = { button: button, x: mx, left: isLeft, right: isRight };
    \\
    \\  for (const id in __ifttt.rules) {
    \\    const rule = __ifttt.rules[id];
    \\    if (!rule.active) continue;
    \\    if (rule.trigger.kind === 'event') {
    \\      if (rule.trigger.event === 'click' && isLeft) __ifttt_fire(rule, evt);
    \\      if (rule.trigger.event === 'rightclick' && isRight) __ifttt_fire(rule, evt);
    \\      if (rule.trigger.event === 'anyclick') __ifttt_fire(rule, evt);
    \\    }
    \\  }
    \\};
    \\
    \\globalThis.__ifttt_onFiledrop = function(path) {
    \\  var evt = { path: path };
    \\  for (const id in __ifttt.rules) {
    \\    const rule = __ifttt.rules[id];
    \\    if (!rule.active) continue;
    \\    if (rule.trigger.kind === 'event' && rule.trigger.event === 'filedrop') {
    \\      __ifttt_fire(rule, evt);
    \\    }
    \\  }
    \\};
;

// ── HTTP fetch host function ─────────────────────────────────────

fn hostFetch(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    const url_ptr = qjs.JS_ToCString(ctx, argv[0]);
    if (url_ptr == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, url_ptr);
    const url = std.mem.span(url_ptr);
    log.print("[fetch] GET {s}\n", .{url});

    // Use curl to fetch the URL synchronously
    const result = std.process.Child.run(.{
        .allocator = std.heap.page_allocator,
        .max_output_bytes = 2 * 1024 * 1024, // 2MB
        .argv = &[_][]const u8{
            "curl", "-sL",                                                            "--max-time", "10", "--compressed",
            "-H",   "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", url,
        },
    }) catch |err| {
        log.print("[fetch] curl failed: {}\n", .{err});
        return QJS_UNDEFINED;
    };
    defer std.heap.page_allocator.free(result.stdout);
    defer std.heap.page_allocator.free(result.stderr);

    if (result.stdout.len == 0) {
        log.print("[fetch] empty response\n", .{});
        return QJS_UNDEFINED;
    }
    log.print("[fetch] got {d} bytes\n", .{result.stdout.len});
    return qjs.JS_NewStringLen(ctx, result.stdout.ptr, @intCast(result.stdout.len));
}

// ── PTY host functions ───────────────────────────────────────────

fn ptySlot(handle: i32) ?usize {
    if (handle <= 0) return null;
    const idx: usize = @intCast(handle - 1);
    if (idx >= MAX_PTYS) return null;
    return idx;
}

fn ptyFromHandle(handle: i32) ?*pty_mod.Pty {
    const slot = ptySlot(handle) orelse return null;
    if (g_ptys[slot]) |*p| return p;
    return null;
}

fn ptyAllocSlot() ?usize {
    var idx: usize = 0;
    while (idx < MAX_PTYS) : (idx += 1) {
        if (g_ptys[idx] == null) return idx;
    }
    return null;
}

fn ptyReleaseHandle(handle: i32) void {
    const slot = ptySlot(handle) orelse return;
    if (g_ptys[slot]) |*p| p.closePty();
    g_ptys[slot] = null;
    if (g_active_pty_handle == handle) g_active_pty_handle = 0;
}

fn ptySetActiveHandle(handle: i32) void {
    if (handle <= 0) {
        g_active_pty_handle = 0;
        return;
    }
    if (ptyFromHandle(handle) != null) g_active_pty_handle = @intCast(handle);
}

fn hostPtyOpen(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    var cols: u16 = 80;
    var rows: u16 = 24;
    var shell_z: ?[*:0]const u8 = null;
    var cwd_z: ?[*:0]const u8 = null;

    if (argc >= 1) {
        var v: i32 = 0;
        _ = qjs.JS_ToInt32(ctx, &v, argv[0]);
        if (v > 0) cols = @intCast(v);
    }
    if (argc >= 2) {
        var v: i32 = 0;
        _ = qjs.JS_ToInt32(ctx, &v, argv[1]);
        if (v > 0) rows = @intCast(v);
    }
    if (argc >= 3) {
        const s = qjs.JS_ToCString(ctx, argv[2]);
        if (s != null and std.mem.span(s).len > 0) shell_z = s else if (s != null) qjs.JS_FreeCString(ctx, s);
    }
    if (argc >= 4) {
        const cpath = qjs.JS_ToCString(ctx, argv[3]);
        if (cpath != null and std.mem.span(cpath).len > 0) cwd_z = cpath else if (cpath != null) qjs.JS_FreeCString(ctx, cpath);
    }
    defer if (shell_z) |s| qjs.JS_FreeCString(ctx, s);
    defer if (cwd_z) |s| qjs.JS_FreeCString(ctx, s);

    const slot = ptyAllocSlot() orelse return qjs.JS_NewFloat64(null, -1);
    g_ptys[slot] = pty_mod.openPty(.{
        .cols = cols,
        .rows = rows,
        .shell = shell_z orelse "bash",
        .cwd = cwd_z,
    }) catch {
        return qjs.JS_NewFloat64(null, -1);
    };
    if (g_active_pty_handle == 0) g_active_pty_handle = @intCast(slot + 1);
    return qjs.JS_NewFloat64(null, @floatFromInt(slot + 1));
}

fn hostPtyFocus(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var value: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &value, argv[0]);
    ptySetActiveHandle(value);
    return QJS_UNDEFINED;
}

fn hostPtyCwd(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewString(ctx, "");
    var value: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &value, argv[0]);
    if (ptyFromHandle(value)) |p| {
        var path_buf: [64]u8 = undefined;
        const path = std.fmt.bufPrint(&path_buf, "/proc/{d}/cwd", .{p.pid}) catch {
            return qjs.JS_NewString(ctx, "");
        };
        var cwd_buf: [4096]u8 = undefined;
        const cwd = std.posix.readlink(path, &cwd_buf) catch {
            return qjs.JS_NewString(ctx, "");
        };
        return qjs.JS_NewStringLen(ctx, cwd.ptr, @intCast(cwd.len));
    }
    return qjs.JS_NewString(ctx, "");
}

fn hostPtyClose(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var value: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &value, argv[0]);
    ptyReleaseHandle(value);
    return QJS_UNDEFINED;
}

fn hostPtyRead(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var value: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &value, argv[0]);
    if (ptyFromHandle(value)) |p| {
        if (p.readData()) |data| {
            return qjs.JS_NewStringLen(ctx, data.ptr, @intCast(data.len));
        }
    }
    return QJS_UNDEFINED;
}

fn hostPtyWrite(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    var value: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &value, argv[0]);
    if (ptyFromHandle(value)) |p| {
        const str = qjs.JS_ToCString(ctx, argv[1]);
        if (str == null) return QJS_UNDEFINED;
        defer qjs.JS_FreeCString(ctx, str);
        _ = p.writeData(std.mem.span(str));
    }
    return QJS_UNDEFINED;
}

fn hostPtyAlive(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return qjs.JS_NewFloat64(null, 0);
    var value: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &value, argv[0]);
    if (ptyFromHandle(value)) |p| {
        const ok = p.alive();
        if (!ok) ptyReleaseHandle(value);
        return qjs.JS_NewFloat64(null, if (ok) @as(f64, 1) else 0);
    }
    return qjs.JS_NewFloat64(null, 0);
}

// ── PTY key routing — called from engine event loop ─────────────

/// Returns true if a PTY is active and should consume keyboard input.
pub fn ptyActive() bool {
    if (comptime !HAS_QUICKJS) return false;
    if (g_active_pty_handle == 0) return false;
    if (ptyFromHandle(g_active_pty_handle)) |*p| return p.*.alive();
    g_active_pty_handle = 0;
    return false;
}

/// Forward SDL_TEXTINPUT text to the PTY (printable chars, already UTF-8).
pub fn ptyHandleTextInput(text: [*:0]const u8) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_active_pty_handle != 0) {
        if (ptyFromHandle(g_active_pty_handle)) |*p| {
            _ = p.*.writeData(std.mem.span(text));
        }
    }
}

/// Translate an SDL keysym to a terminal escape sequence and write to PTY.
/// SDL constants are included via the c.zig import in engine.zig, so we
/// accept the raw i32 sym and u16 mod values directly.
pub fn ptyHandleKeyDown(sym: i32, mod: u16) void {
    if (comptime !HAS_QUICKJS) return;
    const SDLK_RETURN = 13;
    const SDLK_BACKSPACE = 8;
    const SDLK_DELETE = 127;
    const SDLK_TAB = 9;
    const SDLK_UP = 0x40000052;
    const SDLK_DOWN = 0x40000051;
    const SDLK_RIGHT = 0x4000004f;
    const SDLK_LEFT = 0x40000050;
    const SDLK_HOME = 0x4000004a;
    const SDLK_END = 0x4000004d;
    const SDLK_PAGEUP = 0x4000004b;
    const SDLK_PAGEDOWN = 0x4000004e;
    const KMOD_CTRL: u16 = 0x00c0;

    const ctrl = (mod & KMOD_CTRL) != 0;

    if (g_active_pty_handle != 0) {
        if (ptyFromHandle(g_active_pty_handle)) |*p| {
            if (ctrl and sym >= 'a' and sym <= 'z') {
                // Ctrl+letter → \x01..\x1a
                const seq = [1]u8{@intCast(sym - 'a' + 1)};
                _ = p.*.writeData(&seq);
                return;
            }
            const seq: []const u8 = switch (sym) {
                SDLK_RETURN => "\r",
                SDLK_BACKSPACE => "\x7f",
                SDLK_DELETE => "\x1b[3~",
                SDLK_TAB => "\t",
                SDLK_UP => "\x1b[A",
                SDLK_DOWN => "\x1b[B",
                SDLK_RIGHT => "\x1b[C",
                SDLK_LEFT => "\x1b[D",
                SDLK_HOME => "\x1b[H",
                SDLK_END => "\x1b[F",
                SDLK_PAGEUP => "\x1b[5~",
                SDLK_PAGEDOWN => "\x1b[6~",
                else => return,
            };
            _ = p.*.writeData(seq);
        }
    }
}

// ── Filesystem bridge (session discovery for tsz-tools) ─────────

extern fn getpid() c_int;

/// __fs_scandir(path) → array of filenames in the directory (strings).
/// Returns empty array on error. Only reads filenames, not contents.
fn hostFsScandir(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    const path_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (path_ptr == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(c2, path_ptr);
    const path = std.mem.span(path_ptr);

    const arr = qjs.JS_NewArray(c2);
    var dir = std.fs.cwd().openDir(path, .{ .iterate = true }) catch return arr;
    defer dir.close();
    var iter = dir.iterate();
    var i: u32 = 0;
    while (iter.next() catch null) |entry| {
        const name = qjs.JS_NewStringLen(c2, entry.name.ptr, @intCast(entry.name.len));
        _ = qjs.JS_SetPropertyUint32(c2, arr, i, name);
        i += 1;
    }
    return arr;
}

/// __fs_readfile(path) → file contents as string, or empty string on error.
fn hostFsReadfile(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    const path_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (path_ptr == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(c2, path_ptr);
    const path = std.mem.span(path_ptr);
    const alloc = std.heap.page_allocator;
    const data = std.fs.cwd().readFileAlloc(alloc, path, 16 * 1024 * 1024) catch return qjs.JS_NewString(c2, "");
    defer alloc.free(data);
    return qjs.JS_NewStringLen(c2, data.ptr, @intCast(data.len));
}

/// __getpid() → current process ID as number.
fn hostGetPid(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(getpid()));
}

/// __getenv(name) → env var value as string, or empty string if unset.
fn hostGetEnv(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return qjs.JS_NewString(c2, "");
    const name_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (name_ptr == null) return qjs.JS_NewString(c2, "");
    defer qjs.JS_FreeCString(c2, name_ptr);
    const val = std.posix.getenv(std.mem.span(name_ptr)) orelse return qjs.JS_NewString(c2, "");
    return qjs.JS_NewStringLen(c2, val.ptr, @intCast(val.len));
}

// ── /proc enumeration ───────────────────────────────────────────

fn appendJsonEscaped(list: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try list.append(alloc, '"');
    for (s) |ch| {
        switch (ch) {
            '"' => try list.appendSlice(alloc, "\\\""),
            '\\' => try list.appendSlice(alloc, "\\\\"),
            '\n' => try list.appendSlice(alloc, "\\n"),
            '\r' => try list.appendSlice(alloc, "\\r"),
            '\t' => try list.appendSlice(alloc, "\\t"),
            0...8, 11, 12, 14...31 => try list.writer(alloc).print("\\u{x:0>4}", .{ch}),
            else => try list.append(alloc, ch),
        }
    }
    try list.append(alloc, '"');
}

fn readProcField(pid: u32, field: []const u8, buf: []u8) ![]const u8 {
    var path_buf: [256]u8 = undefined;
    const path = try std.fmt.bufPrintZ(&path_buf, "/proc/{d}/{s}", .{ pid, field });
    var file = std.fs.openFileAbsoluteZ(path, .{}) catch return error.NotFound;
    defer file.close();
    const n = file.readAll(buf) catch return error.NotFound;
    var slice = buf[0..n];
    while (slice.len > 0 and (slice[slice.len - 1] == '\n' or slice[slice.len - 1] == 0)) {
        slice = slice[0 .. slice.len - 1];
    }
    return slice;
}

fn hostGetProcessesJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const alloc = std.heap.page_allocator;
    var list: std.ArrayList(u8) = .{};
    defer list.deinit(alloc);
    list.append(alloc, '[') catch return qjs.JS_NewString(c2, "[]");

    var proc_dir = std.fs.openDirAbsolute("/proc", .{ .iterate = true }) catch {
        return qjs.JS_NewString(c2, "[]");
    };
    defer proc_dir.close();
    var it = proc_dir.iterate();
    var first = true;
    while (it.next() catch null) |entry| {
        if (entry.kind != .directory) continue;
        const pid = std.fmt.parseInt(u32, entry.name, 10) catch continue;

        var name_buf: [256]u8 = undefined;
        const name = readProcField(pid, "comm", &name_buf) catch continue;

        var task_path_buf: [256]u8 = undefined;
        const task_path = std.fmt.bufPrintZ(&task_path_buf, "/proc/{d}/task", .{pid}) catch continue;
        var task_dir = std.fs.openDirAbsoluteZ(task_path, .{ .iterate = true }) catch continue;
        defer task_dir.close();
        var nthreads: u32 = 0;
        var tit = task_dir.iterate();
        while (tit.next() catch null) |tentry| {
            if (tentry.kind == .directory) nthreads += 1;
        }

        if (!first) list.append(alloc, ',') catch break;
        first = false;
        list.writer(alloc).print("{{\"pid\":{d},\"nthreads\":{d},\"name\":", .{ pid, nthreads }) catch break;
        appendJsonEscaped(&list, alloc, name) catch break;
        list.append(alloc, '}') catch break;
    }
    list.append(alloc, ']') catch {};
    return qjs.JS_NewStringLen(c2, list.items.ptr, list.items.len);
}

const ThreadStat = struct { core: i32 = -1, cputime: u64 = 0 };

fn readThreadStat(pid: u32, tid: u32) ThreadStat {
    var stat_path_buf: [256]u8 = undefined;
    const stat_path = std.fmt.bufPrintZ(&stat_path_buf, "/proc/{d}/task/{d}/stat", .{ pid, tid }) catch return .{};
    var file = std.fs.openFileAbsoluteZ(stat_path, .{}) catch return .{};
    defer file.close();
    var buf: [1024]u8 = undefined;
    const n = file.readAll(&buf) catch return .{};
    const data = buf[0..n];
    const rparen = std.mem.lastIndexOfScalar(u8, data, ')') orelse return .{};
    var rest = data[rparen + 1 ..];
    // After ")" fields are: state(3) ppid(4) pgrp(5) ... utime(14) stime(15) ... processor(39)
    // We're pointing after the ')'; next token is state (field 3). Track 1-based field index.
    var field: usize = 3;
    var idx: usize = 0;
    var utime: u64 = 0;
    var stime: u64 = 0;
    var core: i32 = -1;
    while (idx < rest.len) {
        while (idx < rest.len and rest[idx] == ' ') idx += 1;
        const start = idx;
        while (idx < rest.len and rest[idx] != ' ' and rest[idx] != '\n') idx += 1;
        const tok = rest[start..idx];
        if (tok.len == 0) break;
        if (field == 14) utime = std.fmt.parseInt(u64, tok, 10) catch 0;
        if (field == 15) stime = std.fmt.parseInt(u64, tok, 10) catch 0;
        if (field == 39) core = std.fmt.parseInt(i32, tok, 10) catch -1;
        field += 1;
        if (field > 40) break;
    }
    return .{ .core = core, .cputime = utime + stime };
}

fn hostGetThreadsJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return qjs.JS_NewString(c2, "[]");
    var pid_f: f64 = 0;
    _ = qjs.JS_ToFloat64(c2, &pid_f, argv[0]);
    const pid: u32 = @intFromFloat(pid_f);
    const alloc = std.heap.page_allocator;
    var list: std.ArrayList(u8) = .{};
    defer list.deinit(alloc);
    list.append(alloc, '[') catch return qjs.JS_NewString(c2, "[]");

    var task_path_buf: [256]u8 = undefined;
    const task_path = std.fmt.bufPrintZ(&task_path_buf, "/proc/{d}/task", .{pid}) catch return qjs.JS_NewString(c2, "[]");
    var task_dir = std.fs.openDirAbsoluteZ(task_path, .{ .iterate = true }) catch return qjs.JS_NewString(c2, "[]");
    defer task_dir.close();
    var it = task_dir.iterate();
    var first = true;
    while (it.next() catch null) |entry| {
        if (entry.kind != .directory) continue;
        const tid = std.fmt.parseInt(u32, entry.name, 10) catch continue;
        var comm_path_buf: [256]u8 = undefined;
        const comm_path = std.fmt.bufPrintZ(&comm_path_buf, "/proc/{d}/task/{d}/comm", .{ pid, tid }) catch continue;
        var file = std.fs.openFileAbsoluteZ(comm_path, .{}) catch continue;
        defer file.close();
        var name_buf: [256]u8 = undefined;
        const n = file.readAll(&name_buf) catch continue;
        var name = name_buf[0..n];
        while (name.len > 0 and (name[name.len - 1] == '\n' or name[name.len - 1] == 0)) {
            name = name[0 .. name.len - 1];
        }
        const tstat = readThreadStat(pid, tid);
        if (!first) list.append(alloc, ',') catch break;
        first = false;
        list.writer(alloc).print("{{\"tid\":{d},\"core\":{d},\"cpu\":{d},\"name\":", .{ tid, tstat.core, tstat.cputime }) catch break;
        appendJsonEscaped(&list, alloc, name) catch break;
        list.append(alloc, '}') catch break;
    }
    list.append(alloc, ']') catch {};
    return qjs.JS_NewStringLen(c2, list.items.ptr, list.items.len);
}

fn hostGetCoreCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    var count: u32 = 0;
    var cpu_dir = std.fs.openDirAbsolute("/sys/devices/system/cpu", .{ .iterate = true }) catch return qjs.JS_NewFloat64(null, 1);
    defer cpu_dir.close();
    var it = cpu_dir.iterate();
    while (it.next() catch null) |entry| {
        if (entry.kind != .directory) continue;
        if (entry.name.len < 4) continue;
        if (!std.mem.startsWith(u8, entry.name, "cpu")) continue;
        _ = std.fmt.parseInt(u32, entry.name[3..], 10) catch continue;
        count += 1;
    }
    if (count == 0) count = 1;
    return qjs.JS_NewFloat64(null, @floatFromInt(count));
}

// ── File write + exec host functions (Dashboard) ────────────────

extern fn popen(command: [*:0]const u8, mode: [*:0]const u8) ?*anyopaque;
extern fn pclose(stream: *anyopaque) c_int;
extern fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *anyopaque) usize;

/// __fs_writefile(path, content) → 0 on success, -1 on error.
/// Creates parent directories if needed.
fn hostFsWritefile(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 2) return qjs.JS_NewFloat64(null, -1);
    const path_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (path_ptr == null) return qjs.JS_NewFloat64(null, -1);
    defer qjs.JS_FreeCString(c2, path_ptr);
    const content_ptr = qjs.JS_ToCString(c2, argv[1]);
    if (content_ptr == null) return qjs.JS_NewFloat64(null, -1);
    defer qjs.JS_FreeCString(c2, content_ptr);
    const path = std.mem.span(path_ptr);
    const content = std.mem.span(content_ptr);
    // Ensure parent directory exists
    if (std.mem.lastIndexOfScalar(u8, path, '/')) |idx| {
        std.fs.cwd().makePath(path[0..idx]) catch {};
    }
    const file = std.fs.cwd().createFile(path, .{}) catch return qjs.JS_NewFloat64(null, -1);
    defer file.close();
    file.writeAll(content) catch return qjs.JS_NewFloat64(null, -1);
    return qjs.JS_NewFloat64(null, 0);
}

/// __fs_deletefile(path) → 0 on success, -1 on error.
fn hostFsDeletefile(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return qjs.JS_NewFloat64(null, -1);
    const path_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (path_ptr == null) return qjs.JS_NewFloat64(null, -1);
    defer qjs.JS_FreeCString(c2, path_ptr);
    const path = std.mem.span(path_ptr);
    std.fs.cwd().deleteFile(path) catch return qjs.JS_NewFloat64(null, -1);
    return qjs.JS_NewFloat64(null, 0);
}

/// __exec(cmd) → stdout+stderr as string, or empty string on error.
/// Runs a shell command synchronously via popen. Captures up to 64KB of output.
fn hostExec(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return qjs.JS_NewString(c2, "");
    const cmd_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (cmd_ptr == null) return qjs.JS_NewString(c2, "");
    defer qjs.JS_FreeCString(c2, cmd_ptr);
    const stream = popen(cmd_ptr, "r") orelse return qjs.JS_NewString(c2, "");
    var buf: [65536]u8 = undefined;
    var total: usize = 0;
    while (total < buf.len) {
        const n = fread(buf[total..].ptr, 1, buf.len - total, stream);
        if (n == 0) break;
        total += n;
    }
    _ = pclose(stream);
    if (total == 0) return qjs.JS_NewString(c2, "");
    return qjs.JS_NewStringLen(c2, &buf, @intCast(total));
}

/// __db_query(path, sql) → query results as pipe-delimited rows, newline-separated.
/// Opens the sqlite db at path, executes the SQL query, returns all result rows.
/// Each row's columns are separated by '|', rows by '\n'. Empty string on error.
fn hostDbQuery(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 2) return qjs.JS_NewString(c2, "");
    const path_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (path_ptr == null) return qjs.JS_NewString(c2, "");
    defer qjs.JS_FreeCString(c2, path_ptr);
    const sql_ptr = qjs.JS_ToCString(c2, argv[1]);
    if (sql_ptr == null) return qjs.JS_NewString(c2, "");
    defer qjs.JS_FreeCString(c2, sql_ptr);

    const sqlite = @import("sqlite.zig");
    var db = sqlite.Database.open(std.mem.span(path_ptr)) catch return qjs.JS_NewString(c2, "");
    defer db.close();

    var stmt = db.prepare(sql_ptr) catch return qjs.JS_NewString(c2, "");
    defer stmt.deinit();

    var buf: [65536]u8 = undefined;
    var pos: usize = 0;
    while (true) {
        const has_row = stmt.step() catch break;
        if (!has_row) break;
        const ncols = stmt.columnCount();
        var col: c_int = 0;
        while (col < ncols) : (col += 1) {
            if (col > 0 and pos < buf.len) {
                buf[pos] = '|';
                pos += 1;
            }
            const val = stmt.columnText(col) orelse "";
            const copy_len = @min(val.len, buf.len - pos);
            if (copy_len > 0) {
                @memcpy(buf[pos .. pos + copy_len], val[0..copy_len]);
                pos += copy_len;
            }
        }
        if (pos < buf.len) {
            buf[pos] = '\n';
            pos += 1;
        }
    }
    if (pos == 0) return qjs.JS_NewString(c2, "");
    return qjs.JS_NewStringLen(c2, &buf, @intCast(pos));
}

/// Function pointer set by engine to open a window. Avoids importing windows.zig here.
var g_open_window_fn: ?*const fn ([*:0]const u8, c_int, c_int) void = null;

pub fn setOpenWindowFn(f: *const fn ([*:0]const u8, c_int, c_int) void) void {
    g_open_window_fn = f;
}

fn hostWindowClose(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const engine_mod = @import("engine.zig");
    engine_mod.windowClose();
    return QJS_UNDEFINED;
}

fn hostWindowMinimize(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const engine_mod = @import("engine.zig");
    engine_mod.windowMinimize();
    return QJS_UNDEFINED;
}

fn hostWindowMaximize(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const engine_mod = @import("engine.zig");
    engine_mod.windowMaximize();
    return QJS_UNDEFINED;
}

fn hostWindowIsMaximized(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const engine_mod = @import("engine.zig");
    return jsBoolValue(engine_mod.windowIsMaximized());
}

fn hostOpenWindow(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 3) return QJS_UNDEFINED;
    const title_ptr = qjs.JS_ToCString(c2, argv[0]);
    if (title_ptr == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(c2, title_ptr);
    var w: i32 = 400;
    var h: i32 = 400;
    _ = qjs.JS_ToInt32(c2, &w, argv[1]);
    _ = qjs.JS_ToInt32(c2, &h, argv[2]);

    if (g_open_window_fn) |openFn| {
        // Copy title to sentinel-terminated buffer
        const title_span = std.mem.span(title_ptr);
        var title_buf: [256:0]u8 = undefined;
        const copy_len = @min(title_span.len, 255);
        @memcpy(title_buf[0..copy_len], title_span[0..copy_len]);
        title_buf[copy_len] = 0;
        openFn(&title_buf, @intCast(w), @intCast(h));
    }
    return QJS_UNDEFINED;
}

// ── QuickJS lifecycle ───────────────────────────────────────────

pub fn initVM() void {
    if (comptime !HAS_QUICKJS) return;
    const rt = qjs.JS_NewRuntime() orelse return;
    qjs.JS_SetMemoryLimit(rt, 256 * 1024 * 1024);
    qjs.JS_SetMaxStackSize(rt, 1024 * 1024);
    const ctx = qjs.JS_NewContext(rt) orelse {
        qjs.JS_FreeRuntime(rt);
        return;
    };
    g_qjs_rt = rt;
    g_qjs_ctx = ctx;

    const global = qjs.JS_GetGlobalObject(ctx);
    defer qjs.JS_FreeValue(ctx, global);
    _ = qjs.JS_SetPropertyStr(ctx, global, "__markDirty", qjs.JS_NewCFunction(ctx, hostMarkDirty, "__markDirty", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__luaEval", qjs.JS_NewCFunction(ctx, hostLuaEval, "__luaEval", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__setState", qjs.JS_NewCFunction(ctx, hostSetState, "__setState", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__setStateString", qjs.JS_NewCFunction(ctx, hostSetStateString, "__setStateString", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getState", qjs.JS_NewCFunction(ctx, hostGetState, "__getState", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getStateString", qjs.JS_NewCFunction(ctx, hostGetStateString, "__getStateString", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__hostLog", qjs.JS_NewCFunction(ctx, hostLog, "__hostLog", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__js_eval", qjs.JS_NewCFunction(ctx, hostJsEval, "__js_eval", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getFps", qjs.JS_NewCFunction(ctx, hostGetFps, "getFps", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getLayoutUs", qjs.JS_NewCFunction(ctx, hostGetLayoutUs, "getLayoutUs", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getPaintUs", qjs.JS_NewCFunction(ctx, hostGetPaintUs, "getPaintUs", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getTickUs", qjs.JS_NewCFunction(ctx, hostGetTickUs, "getTickUs", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getProcessesJson", qjs.JS_NewCFunction(ctx, hostGetProcessesJson, "getProcessesJson", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getThreadsJson", qjs.JS_NewCFunction(ctx, hostGetThreadsJson, "getThreadsJson", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getCoreCount", qjs.JS_NewCFunction(ctx, hostGetCoreCount, "getCoreCount", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getMouseX", qjs.JS_NewCFunction(ctx, hostGetMouseX, "getMouseX", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getMouseY", qjs.JS_NewCFunction(ctx, hostGetMouseY, "getMouseY", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getMouseDown", qjs.JS_NewCFunction(ctx, hostGetMouseDown, "getMouseDown", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "isKeyDown", qjs.JS_NewCFunction(ctx, hostIsKeyDown, "isKeyDown", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getMouseRightDown", qjs.JS_NewCFunction(ctx, hostGetMouseRightDown, "getMouseRightDown", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__beginTerminalDockResize", qjs.JS_NewCFunction(ctx, hostBeginTerminalDockResize, "__beginTerminalDockResize", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__endTerminalDockResize", qjs.JS_NewCFunction(ctx, hostEndTerminalDockResize, "__endTerminalDockResize", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getTerminalDockResizeState", qjs.JS_NewCFunction(ctx, hostGetTerminalDockResizeState, "__getTerminalDockResizeState", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__clipboard_set", qjs.JS_NewCFunction(ctx, hostClipboardSet, "__clipboard_set", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__clipboard_get", qjs.JS_NewCFunction(ctx, hostClipboardGet, "__clipboard_get", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "heavy_compute", qjs.JS_NewCFunction(ctx, hostHeavyCompute, "heavy_compute", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "heavy_compute_timed", qjs.JS_NewCFunction(ctx, hostHeavyComputeTimed, "heavy_compute_timed", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "set_compute_n", qjs.JS_NewCFunction(ctx, hostSetComputeN, "set_compute_n", 1));

    // Canvas active/selected node
    _ = qjs.JS_SetPropertyStr(ctx, global, "getActiveNode", qjs.JS_NewCFunction(ctx, hostGetActiveNode, "getActiveNode", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "getSelectedNode", qjs.JS_NewCFunction(ctx, hostGetSelectedNode, "getSelectedNode", 0));
    // Flow animation control
    _ = qjs.JS_SetPropertyStr(ctx, global, "setFlowEnabled", qjs.JS_NewCFunction(ctx, hostSetFlowEnabled, "setFlowEnabled", 1));
    // Variant switching (classifier variants)
    _ = qjs.JS_SetPropertyStr(ctx, global, "setVariant", qjs.JS_NewCFunction(ctx, hostSetVariant, "setVariant", 1));
    // Input text access
    _ = qjs.JS_SetPropertyStr(ctx, global, "getInputText", qjs.JS_NewCFunction(ctx, hostGetInputText, "getInputText", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__setInputText", qjs.JS_NewCFunction(ctx, hostSetInputText, "__setInputText", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pollInputSubmit", qjs.JS_NewCFunction(ctx, hostPollInputSubmit, "__pollInputSubmit", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getPreparedRightClick", qjs.JS_NewCFunction(ctx, hostGetPreparedRightClick, "__getPreparedRightClick", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getPreparedScroll", qjs.JS_NewCFunction(ctx, hostGetPreparedScroll, "__getPreparedScroll", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__window_close", qjs.JS_NewCFunction(ctx, hostWindowClose, "__window_close", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__window_minimize", qjs.JS_NewCFunction(ctx, hostWindowMinimize, "__window_minimize", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__window_maximize", qjs.JS_NewCFunction(ctx, hostWindowMaximize, "__window_maximize", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__window_is_maximized", qjs.JS_NewCFunction(ctx, hostWindowIsMaximized, "__window_is_maximized", 0));
    // Node dim/highlight (filter system)
    _ = qjs.JS_SetPropertyStr(ctx, global, "setNodeDim", qjs.JS_NewCFunction(ctx, hostSetNodeDim, "setNodeDim", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "resetNodeDim", qjs.JS_NewCFunction(ctx, hostResetNodeDim, "resetNodeDim", 0));
    // Per-path flow override (hover mode)
    _ = qjs.JS_SetPropertyStr(ctx, global, "setPathFlow", qjs.JS_NewCFunction(ctx, hostSetPathFlow, "setPathFlow", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "resetPathFlow", qjs.JS_NewCFunction(ctx, hostResetPathFlow, "resetPathFlow", 0));
    // Process spawning + app path resolution
    _ = qjs.JS_SetPropertyStr(ctx, global, "__spawn_self", qjs.JS_NewCFunction(ctx, hostSpawnSelf, "__spawn_self", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__get_app_dir", qjs.JS_NewCFunction(ctx, hostGetAppDir, "__get_app_dir", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__get_run_path", qjs.JS_NewCFunction(ctx, hostGetRunPath, "__get_run_path", 0));

    // Telemetry host functions — unified snapshot access
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_frame", qjs.JS_NewCFunction(ctx, hostTelFrame, "__tel_frame", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_gpu", qjs.JS_NewCFunction(ctx, hostTelGpu, "__tel_gpu", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_nodes", qjs.JS_NewCFunction(ctx, hostTelNodes, "__tel_nodes", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_state", qjs.JS_NewCFunction(ctx, hostTelState, "__tel_state", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_system", qjs.JS_NewCFunction(ctx, hostTelSystem, "__tel_system", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_input", qjs.JS_NewCFunction(ctx, hostTelInput, "__tel_input", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_canvas", qjs.JS_NewCFunction(ctx, hostTelCanvas, "__tel_canvas", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_net", qjs.JS_NewCFunction(ctx, hostTelNet, "__tel_net", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_layout", qjs.JS_NewCFunction(ctx, hostTelLayout, "__tel_layout", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_history", qjs.JS_NewCFunction(ctx, hostTelHistory, "__tel_history", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_node_count", qjs.JS_NewCFunction(ctx, hostTelNodeCount, "__tel_node_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_node", qjs.JS_NewCFunction(ctx, hostTelNode, "__tel_node", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_node_style", qjs.JS_NewCFunction(ctx, hostTelNodeStyle, "__tel_node_style", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__tel_node_box_model", qjs.JS_NewCFunction(ctx, hostTelNodeBoxModel, "__tel_node_box_model", 1));

    // HTTP fetch
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fetch", qjs.JS_NewCFunction(ctx, hostFetch, "__fetch", 1));

    // PTY host functions
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_open", qjs.JS_NewCFunction(ctx, hostPtyOpen, "__pty_open", 4));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_read", qjs.JS_NewCFunction(ctx, hostPtyRead, "__pty_read", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_write", qjs.JS_NewCFunction(ctx, hostPtyWrite, "__pty_write", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_alive", qjs.JS_NewCFunction(ctx, hostPtyAlive, "__pty_alive", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_close", qjs.JS_NewCFunction(ctx, hostPtyClose, "__pty_close", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_focus", qjs.JS_NewCFunction(ctx, hostPtyFocus, "__pty_focus", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__pty_cwd", qjs.JS_NewCFunction(ctx, hostPtyCwd, "__pty_cwd", 1));

    // Claude Code SDK — subprocess session in stream-json mode
    _ = qjs.JS_SetPropertyStr(ctx, global, "__claude_init", qjs.JS_NewCFunction(ctx, hostClaudeInit, "__claude_init", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__claude_send", qjs.JS_NewCFunction(ctx, hostClaudeSend, "__claude_send", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__claude_poll", qjs.JS_NewCFunction(ctx, hostClaudePoll, "__claude_poll", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__claude_close", qjs.JS_NewCFunction(ctx, hostClaudeClose, "__claude_close", 0));

    // Kimi Wire SDK — subprocess session in wire mode
    _ = qjs.JS_SetPropertyStr(ctx, global, "__kimi_init", qjs.JS_NewCFunction(ctx, hostKimiInit, "__kimi_init", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__kimi_send", qjs.JS_NewCFunction(ctx, hostKimiSend, "__kimi_send", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__kimi_poll", qjs.JS_NewCFunction(ctx, hostKimiPoll, "__kimi_poll", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__kimi_close", qjs.JS_NewCFunction(ctx, hostKimiClose, "__kimi_close", 0));

    // Local AI runtime — background-thread llama.cpp session
    _ = qjs.JS_SetPropertyStr(ctx, global, "__localai_init", qjs.JS_NewCFunction(ctx, hostLocalAiInit, "__localai_init", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__localai_send", qjs.JS_NewCFunction(ctx, hostLocalAiSend, "__localai_send", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__localai_poll", qjs.JS_NewCFunction(ctx, hostLocalAiPoll, "__localai_poll", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__localai_close", qjs.JS_NewCFunction(ctx, hostLocalAiClose, "__localai_close", 0));

    // Semantic terminal bridge — structured data from CLI output
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_state", qjs.JS_NewCFunction(ctx, hostSemState, "__sem_state", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_node_count", qjs.JS_NewCFunction(ctx, hostSemNodeCount, "__sem_node_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_node", qjs.JS_NewCFunction(ctx, hostSemNode, "__sem_node", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_cache_count", qjs.JS_NewCFunction(ctx, hostSemCacheCount, "__sem_cache_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_cache_entry", qjs.JS_NewCFunction(ctx, hostSemCacheEntry, "__sem_cache_entry", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_row_token", qjs.JS_NewCFunction(ctx, hostSemRowToken, "__sem_row_token", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_row_text", qjs.JS_NewCFunction(ctx, hostSemRowText, "__sem_row_text", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_tree", qjs.JS_NewCFunction(ctx, hostSemTree, "__sem_tree", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_set_mode", qjs.JS_NewCFunction(ctx, hostSemSetMode, "__sem_set_mode", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_has_diff", qjs.JS_NewCFunction(ctx, hostSemHasDiff, "__sem_has_diff", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_frame", qjs.JS_NewCFunction(ctx, hostSemFrame, "__sem_frame", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_export", qjs.JS_NewCFunction(ctx, hostSemExport, "__sem_export", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_snapshot", qjs.JS_NewCFunction(ctx, hostSemSnapshot, "__sem_snapshot", 0));
    // JSON-driven classifier bridge
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_set_row_token", qjs.JS_NewCFunction(ctx, hostSemSetRowToken, "__sem_set_row_token", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_vterm_rows", qjs.JS_NewCFunction(ctx, hostSemVtermRows, "__sem_vterm_rows", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_build_graph", qjs.JS_NewCFunction(ctx, hostSemBuildGraph, "__sem_build_graph", 1));

    // Recording/playback bridge
    _ = qjs.JS_SetPropertyStr(ctx, global, "__rec_start", qjs.JS_NewCFunction(ctx, hostRecStart, "__rec_start", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__rec_stop", qjs.JS_NewCFunction(ctx, hostRecStop, "__rec_stop", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__rec_save", qjs.JS_NewCFunction(ctx, hostRecSave, "__rec_save", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__rec_toggle", qjs.JS_NewCFunction(ctx, hostRecToggle, "__rec_toggle", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__rec_is_recording", qjs.JS_NewCFunction(ctx, hostRecIsRecording, "__rec_is_recording", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__rec_frame_count", qjs.JS_NewCFunction(ctx, hostRecFrameCount, "__rec_frame_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_load", qjs.JS_NewCFunction(ctx, hostPlayLoad, "__play_load", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_play", qjs.JS_NewCFunction(ctx, hostPlayPlay, "__play_play", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_pause", qjs.JS_NewCFunction(ctx, hostPlayPause, "__play_pause", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_toggle", qjs.JS_NewCFunction(ctx, hostPlayToggle, "__play_toggle", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_step", qjs.JS_NewCFunction(ctx, hostPlayStep, "__play_step", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_seek", qjs.JS_NewCFunction(ctx, hostPlaySeek, "__play_seek", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_speed", qjs.JS_NewCFunction(ctx, hostPlaySpeed, "__play_speed", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__play_state", qjs.JS_NewCFunction(ctx, hostPlayState, "__play_state", 0));

    // Filesystem bridge (session discovery for tsz-tools inspector)
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_scandir", qjs.JS_NewCFunction(ctx, hostFsScandir, "__fs_scandir", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_readfile", qjs.JS_NewCFunction(ctx, hostFsReadfile, "__fs_readfile", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getpid", qjs.JS_NewCFunction(ctx, hostGetPid, "__getpid", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__getenv", qjs.JS_NewCFunction(ctx, hostGetEnv, "__getenv", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_writefile", qjs.JS_NewCFunction(ctx, hostFsWritefile, "__fs_writefile", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_deletefile", qjs.JS_NewCFunction(ctx, hostFsDeletefile, "__fs_deletefile", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__exec", qjs.JS_NewCFunction(ctx, hostExec, "__exec", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__db_query", qjs.JS_NewCFunction(ctx, hostDbQuery, "__db_query", 2));

    // Window management
    _ = qjs.JS_SetPropertyStr(ctx, global, "__openWindow", qjs.JS_NewCFunction(ctx, hostOpenWindow, "__openWindow", 3));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__windowClose", qjs.JS_NewCFunction(ctx, hostWindowClose, "__windowClose", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__windowMinimize", qjs.JS_NewCFunction(ctx, hostWindowMinimize, "__windowMinimize", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__windowMaximize", qjs.JS_NewCFunction(ctx, hostWindowMaximize, "__windowMaximize", 0));

    // IPC debug client host functions (external inspector attach)
    qjs_ipc.registerAll(@ptrCast(ctx));

    // runtime/hooks bindings (fs, localstore, crypto, env, exit)
    qjs_bindings.registerAll(@ptrCast(ctx));

    const val = qjs.JS_Eval(ctx, polyfill.ptr, polyfill.len, "<polyfill>", qjs.JS_EVAL_TYPE_GLOBAL);
    qjs.JS_FreeValue(ctx, val);

    // Load IFTTT rules engine
    const ifttt_val = qjs.JS_Eval(ctx, JS_IFTTT.ptr, JS_IFTTT.len, "<ifttt>", qjs.JS_EVAL_TYPE_GLOBAL);
    qjs.JS_FreeValue(ctx, ifttt_val);
}

/// Accessor so peer modules (e.g., qjs_bindings.zig) can reach the live JSContext
/// without needing the runtime's @cImport of quickjs.h. Returns null before
/// initVM or after teardown.
pub export fn qjs_runtime_get_ctx() ?*anyopaque {
    if (comptime !HAS_QUICKJS) return null;
    return @ptrCast(g_qjs_ctx);
}

/// Tear down the QuickJS VM. Used by dev-mode hot reload to wipe the JS world
/// before re-evaluating a fresh bundle. Safe to call followed by a new initVM().
pub fn teardownVM() void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| qjs.JS_FreeContext(ctx);
    if (g_qjs_rt) |rt| qjs.JS_FreeRuntime(rt);
    g_qjs_ctx = null;
    g_qjs_rt = null;
}

/// Register a native function on the JS global object. Call after initVM, before evalScript.
/// Accepts a raw function pointer to avoid @cImport type conflicts between compilation units.
pub fn registerHostFn(name: [*:0]const u8, func: *const anyopaque, argc: c_int) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        // JSCFunction is ?*const fn(...) — cast raw pointer through the inner type
        const FnType = @typeInfo(@TypeOf(qjs.JS_NewCFunction)).@"fn".params[1].type.?;
        const qjs_fn: FnType = @ptrCast(@alignCast(func));
        _ = qjs.JS_SetPropertyStr(ctx, global, name, qjs.JS_NewCFunction(ctx, qjs_fn, name, argc));
    }
}

/// Eval the app's JS logic. Call after initVM and any registerHostFn calls.
pub fn evalScript(js_logic: []const u8) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const val = qjs.JS_Eval(ctx, js_logic.ptr, js_logic.len, "<app>", qjs.JS_EVAL_TYPE_GLOBAL);
        if (qjs.JS_IsException(val)) {
            const exc = qjs.JS_GetException(ctx);
            const s = qjs.JS_ToCString(ctx, exc);
            if (s != null) {
                std.log.err("[JS] {s}", .{std.mem.span(s)});
                qjs.JS_FreeCString(ctx, s);
            }
            qjs.JS_FreeValue(ctx, exc);
        }
        qjs.JS_FreeValue(ctx, val);
    }
}

/// Call a global JS function by name (no arguments). Used by Zig event handlers
/// to invoke functions defined in <script> blocks.
pub fn callGlobal(name: [*:0]const u8) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            const r = qjs.JS_Call(ctx, func, global, 0, null);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

/// Check if a global JS function exists.
pub fn hasGlobal(name: [*:0]const u8) bool {
    if (comptime !HAS_QUICKJS) return false;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        return !qjs.JS_IsUndefined(func);
    }
    return false;
}

/// Call a global JS function with one string argument.
pub fn callGlobalStr(name: [*:0]const u8, arg: [*:0]const u8) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            var argv = [1]qjs.JSValue{qjs.JS_NewString(ctx, arg)};
            const r = qjs.JS_Call(ctx, func, global, 1, &argv);
            qjs.JS_FreeValue(ctx, argv[0]);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

/// Call a global JS function with one integer argument.
pub fn callGlobalInt(name: [*:0]const u8, arg: i64) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            var argv = [1]qjs.JSValue{qjs.JS_NewInt64(ctx, arg)};
            const r = qjs.JS_Call(ctx, func, global, 1, &argv);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

/// Call a global JS function with one float argument.
pub fn callGlobalFloat(name: [*:0]const u8, arg: f32) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            var argv = [1]qjs.JSValue{qjs.JS_NewFloat64(ctx, @floatCast(arg))};
            const r = qjs.JS_Call(ctx, func, global, 1, &argv);
            qjs.JS_FreeValue(ctx, argv[0]);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

/// Call a global JS function with two float arguments.
pub fn callGlobal2Float(name: [*:0]const u8, arg0: f32, arg1: f32) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            var argv = [2]qjs.JSValue{
                qjs.JS_NewFloat64(ctx, @floatCast(arg0)),
                qjs.JS_NewFloat64(ctx, @floatCast(arg1)),
            };
            const r = qjs.JS_Call(ctx, func, global, 2, &argv);
            qjs.JS_FreeValue(ctx, argv[0]);
            qjs.JS_FreeValue(ctx, argv[1]);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

/// Call a global JS function with three integer arguments.
pub fn callGlobal3Int(name: [*:0]const u8, arg0: i64, arg1: i64, arg2: i64) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            var argv = [3]qjs.JSValue{
                qjs.JS_NewInt64(ctx, arg0),
                qjs.JS_NewInt64(ctx, arg1),
                qjs.JS_NewInt64(ctx, arg2),
            };
            const r = qjs.JS_Call(ctx, func, global, 3, &argv);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

/// Call a global JS function with five integer arguments.
pub fn callGlobal5Int(name: [*:0]const u8, arg0: i64, arg1: i64, arg2: i64, arg3: i64, arg4: i64) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const func = qjs.JS_GetPropertyStr(ctx, global, name);
        defer qjs.JS_FreeValue(ctx, func);
        if (!qjs.JS_IsUndefined(func)) {
            var argv = [5]qjs.JSValue{
                qjs.JS_NewInt64(ctx, arg0),
                qjs.JS_NewInt64(ctx, arg1),
                qjs.JS_NewInt64(ctx, arg2),
                qjs.JS_NewInt64(ctx, arg3),
                qjs.JS_NewInt64(ctx, arg4),
            };
            const r = qjs.JS_Call(ctx, func, global, 5, &argv);
            qjs.JS_FreeValue(ctx, r);
        }
    }
}

fn noopFreeArrayBuffer(_: ?*qjs.JSRuntime, _: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {}

/// Dispatch a per-frame Effect render into JS. Wraps the CPU pixel buffer as
/// an ArrayBuffer (zero-copy, the free_func is a no-op — Zig still owns the
/// memory) and invokes `__dispatchEffectRender(id, buffer, w, h, stride, time,
/// dt, mouse_x, mouse_y, mouse_inside, frame)`. After the JS call returns,
/// the ArrayBuffer is detached so any references the JS handler kept around
/// can't outlive the Zig-owned buffer.
pub fn dispatchEffectRender(
    id: u32,
    buf_ptr: [*]u8,
    buf_len: usize,
    width: u32,
    height: u32,
    stride: u32,
    time: f32,
    dt: f32,
    mouse_x: f32,
    mouse_y: f32,
    mouse_inside: bool,
    frame: u32,
) void {
    if (comptime !HAS_QUICKJS) return;
    const ctx = g_qjs_ctx orelse return;
    // Recalibrate the QJS stack-overflow watermark. JS_NewRuntime captured
    // stack_top near program start (shallow C stack). Paint → effects →
    // here runs far deeper in the C stack — without this update, QJS's
    // `sp < stack_limit` guard fires immediately and every JS call throws
    // "Maximum call stack size exceeded" before the handler even runs.
    if (g_qjs_rt) |rt| qjs.JS_UpdateStackTop(rt);
    const global = qjs.JS_GetGlobalObject(ctx);
    defer qjs.JS_FreeValue(ctx, global);
    const func = qjs.JS_GetPropertyStr(ctx, global, "__dispatchEffectRender");
    defer qjs.JS_FreeValue(ctx, func);
    if (qjs.JS_IsUndefined(func) or !qjs.JS_IsFunction(ctx, func)) return;

    const ab = qjs.JS_NewArrayBuffer(ctx, buf_ptr, buf_len, noopFreeArrayBuffer, null, false);

    var argv = [_]qjs.JSValue{
        qjs.JS_NewInt32(ctx, @intCast(id)),
        ab,
        qjs.JS_NewInt32(ctx, @intCast(width)),
        qjs.JS_NewInt32(ctx, @intCast(height)),
        qjs.JS_NewInt32(ctx, @intCast(stride)),
        qjs.JS_NewFloat64(ctx, time),
        qjs.JS_NewFloat64(ctx, dt),
        qjs.JS_NewFloat64(ctx, mouse_x),
        qjs.JS_NewFloat64(ctx, mouse_y),
        jsBoolValue(mouse_inside),
        qjs.JS_NewInt32(ctx, @intCast(frame)),
    };
    const r = qjs.JS_Call(ctx, func, global, argv.len, &argv);

    // Detach the buffer so any JS-side references (the Uint8ClampedArray view,
    // cached references) can't read stale Zig memory after we return.
    qjs.JS_DetachArrayBuffer(ctx, ab);
    qjs.JS_FreeValue(ctx, ab);

    if (qjs.JS_IsException(r)) {
        const ex = qjs.JS_GetException(ctx);
        defer qjs.JS_FreeValue(ctx, ex);
        const ex_str = qjs.JS_ToCString(ctx, ex);
        if (ex_str) |s| {
            defer qjs.JS_FreeCString(ctx, s);
            log.print("[effect dispatch error] {s}\n", .{std.mem.span(s)});
        }
    }
    qjs.JS_FreeValue(ctx, r);
}

/// Evaluate a JS expression string (for multi-arg function calls from map handlers).
pub fn evalExpr(code: []const u8) void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        if (code.len == 0) return;
        const r = qjs.JS_Eval(ctx, code.ptr, code.len, "<handler>", 0);
        if (qjs.JS_IsException(r)) {
            const ex = qjs.JS_GetException(ctx);
            const str = qjs.JS_ToCString(ctx, ex);
            if (str) |s| {
                log.print("[evalExpr error] {s}: {s}\n", .{ code, s });
                qjs.JS_FreeCString(ctx, s);
            }
            qjs.JS_FreeValue(ctx, ex);
        }
        qjs.JS_FreeValue(ctx, r);
    }
}

/// Evaluate a JS expression and return the result as a string slice.
/// Writes into the caller-provided buffer. Returns "" on error or empty result.
pub fn evalToString(code: []const u8, buf: *[256]u8) []const u8 {
    if (comptime !HAS_QUICKJS) return "";
    if (g_qjs_ctx) |ctx| {
        if (code.len == 0) return "";
        const r = qjs.JS_Eval(ctx, code.ptr, code.len, "<expr>", 0);
        defer qjs.JS_FreeValue(ctx, r);
        if (qjs.JS_IsException(r)) {
            const ex = qjs.JS_GetException(ctx);
            defer qjs.JS_FreeValue(ctx, ex);
            const es = qjs.JS_ToCString(ctx, ex);
            if (es) |s| {
                log.print("[evalToString error] {s}: {s}\n", .{ code, s });
                qjs.JS_FreeCString(ctx, s);
            }
            return "";
        }
        const s = qjs.JS_ToCString(ctx, r);
        if (s) |str| {
            defer qjs.JS_FreeCString(ctx, s);
            const span = std.mem.span(str);
            const len = @min(span.len, 256);
            @memcpy(buf[0..len], span[0..len]);
            return buf[0..len];
        }
    }
    return "";
}

/// Sync a JS variable to a Lua global of the same name.
/// Reads the JS value via eval, then pushes the full converted value into Lua.
/// Arrays/objects use the same direct walker as evalLuaMapData.
pub fn syncScalarToLua(var_name: [*:0]const u8) void {
    if (comptime !HAS_QUICKJS) return;
    const ctx = g_qjs_ctx orelse return;

    const luajit = @import("luajit_runtime.zig");
    const lua = luajit.lua;
    const L = luajit.g_lua orelse return;

    const name_span = std.mem.span(var_name);
    if (name_span.len == 0) return;

    const r = qjs.JS_Eval(ctx, name_span.ptr, name_span.len, "<sync>", 0);
    defer qjs.JS_FreeValue(ctx, r);
    if (qjs.JS_IsException(r)) return;

    pushJSValueToLua(ctx, L, r, 0);
    lua.lua_setglobal(L, var_name);
}

/// Sync a Lua global variable to a QJS global variable.
/// Lua owns state in lua-tree mode — this pushes Lua's truth to QJS
/// so js_on_press script functions see current values.
pub fn syncLuaToQjs(var_name: [*:0]const u8) void {
    if (comptime !HAS_QUICKJS) return;
    const ctx = g_qjs_ctx orelse return;

    const luajit = @import("luajit_runtime.zig");
    const lua = luajit.lua;
    const L = luajit.g_lua orelse return;

    const name_span = std.mem.span(var_name);
    if (name_span.len == 0) return;

    // Read from Lua global
    _ = lua.lua_getglobal(L, var_name);
    defer lua.lua_pop(L, 1);

    const global = qjs.JS_GetGlobalObject(ctx);
    defer qjs.JS_FreeValue(ctx, global);

    const js_val = pushLuaValueToJS(ctx, L, -1, 0);
    _ = qjs.JS_SetPropertyStr(ctx, global, var_name, js_val);
}

/// Evaluate a JS expression and push the converted value onto the Lua stack.
/// Returns false on error or when either VM is unavailable.
pub fn evalToLua(code: []const u8) bool {
    if (comptime !HAS_QUICKJS) return false;
    const ctx = g_qjs_ctx orelse return false;
    if (code.len == 0) return false;

    const luajit = @import("luajit_runtime.zig");
    const L = luajit.g_lua orelse return false;

    const r = qjs.JS_Eval(ctx, code.ptr, code.len, "<expr>", 0);
    defer qjs.JS_FreeValue(ctx, r);
    if (qjs.JS_IsException(r)) {
        const ex = qjs.JS_GetException(ctx);
        defer qjs.JS_FreeValue(ctx, ex);
        const es = qjs.JS_ToCString(ctx, ex);
        if (es) |s| {
            log.print("[evalToLua error] {s}: {s}\n", .{ code, s });
            qjs.JS_FreeCString(ctx, s);
        }
        return false;
    }

    pushJSValueToLua(ctx, L, r, 0);
    return true;
}

/// Call a global JS function by name and push the converted result onto the Lua stack.
/// Returns false when the function is missing, not callable, or throws.
pub fn callGlobalReturnToLua(name: [*:0]const u8) bool {
    if (comptime !HAS_QUICKJS) return false;
    const ctx = g_qjs_ctx orelse return false;

    const luajit = @import("luajit_runtime.zig");
    const L = luajit.g_lua orelse return false;

    const global = qjs.JS_GetGlobalObject(ctx);
    defer qjs.JS_FreeValue(ctx, global);

    const func = qjs.JS_GetPropertyStr(ctx, global, name);
    defer qjs.JS_FreeValue(ctx, func);
    if (qjs.JS_IsUndefined(func) or !qjs.JS_IsFunction(ctx, func)) return false;

    const r = qjs.JS_Call(ctx, func, global, 0, null);
    defer qjs.JS_FreeValue(ctx, r);
    if (qjs.JS_IsException(r)) {
        const ex = qjs.JS_GetException(ctx);
        defer qjs.JS_FreeValue(ctx, ex);
        const es = qjs.JS_ToCString(ctx, ex);
        if (es) |s| {
            log.print("[callGlobalReturnToLua error] {s}: {s}\n", .{ std.mem.span(name), s });
            qjs.JS_FreeCString(ctx, s);
        }
        return false;
    }

    pushJSValueToLua(ctx, L, r, 0);
    return true;
}

/// Evaluate a JS expression and pass the result directly to LuaJIT as
/// __luaMapDataN. Uses direct FFI value walking — no JSON serialization.
/// Ported from love2d/lua/bridge_quickjs.lua:jsValueToLua (the proven bridge).
/// Called by generated code: qjs_runtime.evalLuaMapData(0, "sourceExpr")
pub fn evalLuaMapData(index: usize, js_expr: []const u8) void {
    if (comptime !HAS_QUICKJS) return;
    const ctx = g_qjs_ctx orelse return;
    if (js_expr.len == 0) return;

    const luajit = @import("luajit_runtime.zig");
    const lua = luajit.lua;
    const L = luajit.g_lua orelse return;

    // Evaluate the JS expression
    const r = qjs.JS_Eval(ctx, js_expr.ptr, js_expr.len, "<evalLuaMapData>", 0);
    defer qjs.JS_FreeValue(ctx, r);
    if (qjs.JS_IsException(r)) {
        const ex = qjs.JS_GetException(ctx);
        defer qjs.JS_FreeValue(ctx, ex);
        const es = qjs.JS_ToCString(ctx, ex);
        if (es) |s| {
            log.print("[evalLuaMapData error] {s}: {s}\n", .{ js_expr, s });
            qjs.JS_FreeCString(ctx, s);
        }
        return;
    }

    // Walk the JSValue tree and push directly onto the Lua stack
    pushJSValueToLua(ctx, L, r, 0);

    // Set as __luaMapDataN global
    var name_buf: [24]u8 = undefined;
    const name = std.fmt.bufPrint(&name_buf, "__luaMapData{d}", .{index}) catch return;
    name_buf[name.len] = 0;
    lua.lua_setglobal(L, @as([*:0]const u8, @ptrCast(name_buf[0..name.len :0])));
}

/// Walk a QuickJS JSValue and push the equivalent Lua value onto the Lua stack.
/// Two-phase conversion: pin ALL children first, THEN convert ALL.
/// This prevents QJS GC from collecting large string properties mid-walk.
/// Matches love2d/lua/bridge_quickjs.lua:jsValueToLua exactly.
fn pushJSValueToLua(ctx: *qjs.JSContext, L: *@import("luajit_runtime.zig").lua.lua_State, val: qjs.JSValue, depth: u32) void {
    const lua = @import("luajit_runtime.zig").lua;
    const alloc = std.heap.page_allocator;

    if (depth > 32) {
        lua.lua_pushnil(L);
        return;
    }

    const tag = qjs.JS_VALUE_GET_TAG(val);

    // String
    if (tag == qjs.JS_TAG_STRING) {
        const cstr = qjs.JS_ToCString(ctx, val);
        if (cstr) |s| {
            lua.lua_pushstring(L, s);
            qjs.JS_FreeCString(ctx, cstr);
        } else {
            lua.lua_pushnil(L);
        }
        return;
    }

    // Integer
    if (tag == qjs.JS_TAG_INT) {
        var int_val: i32 = 0;
        _ = qjs.JS_ToInt32(ctx, &int_val, val);
        lua.lua_pushinteger(L, @intCast(int_val));
        return;
    }

    // Float
    if (tag == qjs.JS_TAG_FLOAT64) {
        var f_val: f64 = 0;
        _ = qjs.JS_ToFloat64(ctx, &f_val, val);
        lua.lua_pushnumber(L, f_val);
        return;
    }

    // Boolean
    if (tag == qjs.JS_TAG_BOOL) {
        lua.lua_pushboolean(L, qjs.JS_ToBool(ctx, val));
        return;
    }

    // Null / Undefined
    if (tag == qjs.JS_TAG_NULL or tag == qjs.JS_TAG_UNDEFINED) {
        lua.lua_pushnil(L);
        return;
    }

    // Object (array or table)
    if (tag == qjs.JS_TAG_OBJECT) {
        if (qjs.JS_IsArray(val)) {
            // Array: get length
            const len_val = qjs.JS_GetPropertyStr(ctx, val, "length");
            var len: i32 = 0;
            _ = qjs.JS_ToInt32(ctx, &len, len_val);
            qjs.JS_FreeValue(ctx, len_val);
            const count: usize = @intCast(@max(len, 0));

            lua.lua_createtable(L, @intCast(count), 0);

            // Phase 1: Pin ALL elements (no cap — heap allocated)
            const pinned = alloc.alloc(qjs.JSValue, count) catch {
                // OOM — leave empty table on stack
                return;
            };
            defer alloc.free(pinned);

            for (0..count) |i| {
                const elem = qjs.JS_GetPropertyUint32(ctx, val, @intCast(i));
                pinned[i] = qjs.JS_DupValue(ctx, elem);
                qjs.JS_FreeValue(ctx, elem);
            }

            // Phase 2: Convert ALL pinned elements
            for (0..count) |i| {
                pushJSValueToLua(ctx, L, pinned[i], depth + 1);
                lua.lua_rawseti(L, -2, @intCast(i + 1));
                qjs.JS_FreeValue(ctx, pinned[i]);
            }
        } else {
            // Object: enumerate own properties
            var ptab: [*c]qjs.JSPropertyEnum = undefined;
            var plen: u32 = 0;
            const flags: c_int = (1 << 0) | (1 << 4); // JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY

            if (qjs.JS_GetOwnPropertyNames(ctx, &ptab, &plen, val, flags) != 0) {
                lua.lua_newtable(L);
                return;
            }

            const prop_count: usize = @intCast(plen);
            lua.lua_createtable(L, 0, @intCast(prop_count));

            // Phase 1: Collect ALL keys and pin ALL values BEFORE any conversion.
            // This matches love2d/lua/bridge_quickjs.lua:225 exactly —
            // prevents GC from collecting large string values during
            // recursive conversion of other properties.
            const keys = alloc.alloc([*:0]const u8, prop_count) catch {
                qjs.js_free(ctx, ptab);
                return;
            };
            defer alloc.free(keys);
            const vals = alloc.alloc(qjs.JSValue, prop_count) catch {
                qjs.js_free(ctx, ptab);
                return;
            };
            defer alloc.free(vals);

            var valid_count: usize = 0;
            for (0..prop_count) |i| {
                const key_cstr = qjs.JS_AtomToCString(ctx, ptab[i].atom);
                if (key_cstr) |key| {
                    const prop_val = qjs.JS_GetPropertyStr(ctx, val, key);
                    keys[valid_count] = key;
                    vals[valid_count] = qjs.JS_DupValue(ctx, prop_val);
                    qjs.JS_FreeValue(ctx, prop_val);
                    valid_count += 1;
                }
                qjs.JS_FreeAtom(ctx, ptab[i].atom);
            }
            qjs.js_free(ctx, ptab);

            // Phase 2: Convert ALL pinned values
            for (0..valid_count) |i| {
                lua.lua_pushstring(L, keys[i]);
                pushJSValueToLua(ctx, L, vals[i], depth + 1);
                lua.lua_settable(L, -3);
                qjs.JS_FreeValue(ctx, vals[i]);
                qjs.JS_FreeCString(ctx, keys[i]);
            }
        }
        return;
    }

    // Unknown tag — push nil
    lua.lua_pushnil(L);
}

fn luaAbsIndex(L: *@import("luajit_runtime.zig").lua.lua_State, idx: c_int) c_int {
    return if (idx > 0) idx else @as(c_int, luaAbsTop(L)) + idx + 1;
}

fn luaAbsTop(L: *@import("luajit_runtime.zig").lua.lua_State) c_int {
    const lua = @import("luajit_runtime.zig").lua;
    return lua.lua_gettop(L);
}

fn luaTableIsEmpty(L: *@import("luajit_runtime.zig").lua.lua_State, idx: c_int) bool {
    const lua = @import("luajit_runtime.zig").lua;
    const abs_idx = luaAbsIndex(L, idx);
    lua.lua_pushnil(L);
    if (lua.lua_next(L, abs_idx) != 0) {
        lua.lua_pop(L, 2);
        return false;
    }
    return true;
}

/// Convert a Lua value to a QuickJS JSValue via direct recursive construction.
/// Matches love2d/lua/bridge_quickjs.lua:luaToJSValue.
fn pushLuaValueToJS(ctx: *qjs.JSContext, L: *@import("luajit_runtime.zig").lua.lua_State, idx: c_int, depth: u32) qjs.JSValue {
    const lua = @import("luajit_runtime.zig").lua;
    if (depth > 32) return QJS_UNDEFINED;

    const abs_idx = luaAbsIndex(L, idx);
    const ty = lua.lua_type(L, abs_idx);

    if (ty == lua.LUA_TSTRING) {
        var len: usize = 0;
        const ptr = lua.lua_tolstring(L, abs_idx, &len);
        if (ptr == null) return QJS_UNDEFINED;
        return qjs.JS_NewStringLen(ctx, @ptrCast(ptr), len);
    }

    if (ty == lua.LUA_TNUMBER) {
        const val = lua.lua_tonumber(L, abs_idx);
        const truncated = @trunc(val);
        if (val == truncated and truncated >= -2147483648 and truncated <= 2147483647) {
            return qjs.JS_NewInt32(ctx, @intFromFloat(truncated));
        }
        return qjs.JS_NewFloat64(ctx, val);
    }

    if (ty == lua.LUA_TBOOLEAN) {
        return jsBoolValue(lua.lua_toboolean(L, abs_idx) != 0);
    }

    if (ty == lua.LUA_TNIL) {
        return QJS_UNDEFINED;
    }

    if (ty == lua.LUA_TTABLE) {
        lua.lua_rawgeti(L, abs_idx, 1);
        const has_first = !lua.lua_isnil(L, -1);
        lua.lua_pop(L, 1);
        const is_empty = luaTableIsEmpty(L, abs_idx);

        if (has_first or is_empty) {
            const len = lua.lua_objlen(L, abs_idx);
            const arr = qjs.JS_NewArray(ctx);
            for (0..len) |i| {
                lua.lua_rawgeti(L, abs_idx, @intCast(i + 1));
                const child = pushLuaValueToJS(ctx, L, -1, depth + 1);
                _ = qjs.JS_SetPropertyUint32(ctx, arr, @intCast(i), child);
                lua.lua_pop(L, 1);
            }
            return arr;
        }

        const obj = qjs.JS_NewObject(ctx);
        lua.lua_pushnil(L);
        while (lua.lua_next(L, abs_idx) != 0) {
            lua.lua_pushvalue(L, -2);
            var key_len: usize = 0;
            const key_ptr = lua.lua_tolstring(L, -1, &key_len);
            if (key_ptr != null) {
                var key_buf = std.heap.page_allocator.alloc(u8, key_len + 1) catch {
                    lua.lua_pop(L, 3);
                    return obj;
                };
                defer std.heap.page_allocator.free(key_buf);
                @memcpy(key_buf[0..key_len], @as([*]const u8, @ptrCast(key_ptr))[0..key_len]);
                key_buf[key_len] = 0;

                const child = pushLuaValueToJS(ctx, L, -2, depth + 1);
                _ = qjs.JS_SetPropertyStr(ctx, obj, @ptrCast(key_buf[0..key_len :0]), child);
            }
            lua.lua_pop(L, 2);
        }
        return obj;
    }

    return QJS_UNDEFINED;
}

pub fn tick() void {
    if (comptime !HAS_QUICKJS) return;
    if (g_qjs_ctx) |ctx| {
        const global = qjs.JS_GetGlobalObject(ctx);
        defer qjs.JS_FreeValue(ctx, global);
        const tick_fn = qjs.JS_GetPropertyStr(ctx, global, "__zigOS_tick");
        defer qjs.JS_FreeValue(ctx, tick_fn);
        if (!qjs.JS_IsUndefined(tick_fn)) {
            const r = qjs.JS_Call(ctx, tick_fn, global, 0, null);
            qjs.JS_FreeValue(ctx, r);
        }
        if (g_qjs_rt) |rt| {
            var ctx2: ?*qjs.JSContext = null;
            while (qjs.JS_ExecutePendingJob(rt, &ctx2) > 0) {}
        }
    }
}

pub fn deinit() void {
    if (comptime !HAS_QUICKJS) return;
    if (g_claude_session) |*sess| {
        sess.close() catch {};
        sess.deinit();
        g_claude_session = null;
    }
    if (g_kimi_session) |*sess| {
        sess.close() catch {};
        sess.deinit();
        g_kimi_session = null;
    }
    kimiDeinitTurnBuffers();
    if (g_local_ai_session) |sess| {
        sess.destroy();
        g_local_ai_session = null;
    }
    if (g_qjs_ctx) |ctx| qjs.JS_FreeContext(ctx);
    if (g_qjs_rt) |rt| qjs.JS_FreeRuntime(rt);
}

// ── SDL2 painter ────────────────────────────────────────────────

pub fn paintNode(renderer: *c.SDL_Renderer, te: *TextEngine, node: *Node) void {
    if (comptime !HAS_QUICKJS) return;
    if (node.style.display == .none) return;
    const r = node.computed;
    if (r.w <= 0 or r.h <= 0) return;
    if (node.style.background_color) |bg| {
        if (bg.a > 0) {
            _ = c.SDL_SetRenderDrawColor(renderer, bg.r, bg.g, bg.b, bg.a);
            var rect = c.SDL_FRect{
                .x = r.x,
                .y = r.y,
                .w = r.w,
                .h = r.h,
            };
            _ = c.SDL_RenderFillRect(renderer, &rect);
        }
    }
    if (node.text) |t| {
        if (t.len > 0) {
            const tc = node.text_color orelse Color.rgb(255, 255, 255);
            const pl = node.style.padLeft();
            const pt = node.style.padTop();
            const pr = node.style.padRight();
            te.drawTextWrapped(t, r.x + pl, r.y + pt, node.font_size, @max(1.0, r.w - pl - pr), tc);
        }
    }
    for (node.children) |*child| paintNode(renderer, te, child);
}

// ── Main loop ───────────────────────────────────────────────────

fn measureCallback(t: []const u8, fs: u16, _: u8, mw: f32, ls: f32, lh: f32, ml: u16, nw: bool, bold: bool) layout.TextMetrics {
    if (g_text_engine) |te| return te.measureTextWrappedEx(t, fs, mw, ls, lh, ml, nw, bold);
    return .{};
}
fn measureImageCallback(_: []const u8) layout.ImageDims {
    return .{};
}

pub fn run(root: *Node, js_logic: []const u8, initState: *const fn () void, updateTexts: *const fn () void) !void {
    if (comptime !HAS_QUICKJS) return;
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) return error.SDLInitFailed;
    defer c.SDL_Quit();

    const window = c.SDL_CreateWindow("tsz app", 1280, 800, c.SDL_WINDOW_RESIZABLE) orelse return error.WindowCreateFailed;
    defer c.SDL_DestroyWindow(window);

    const renderer = c.SDL_CreateRenderer(window, null) orelse return error.RendererFailed;
    defer c.SDL_DestroyRenderer(renderer);
    _ = c.SDL_SetRenderDrawBlendMode(renderer, c.SDL_BLENDMODE_BLEND);

    var text_engine = TextEngine.init(renderer, "fonts/base/DejaVuSans-Regular.ttf") catch
        TextEngine.init(renderer, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") catch
        TextEngine.init(renderer, "/System/Library/Fonts/Supplemental/Arial.ttf") catch
        TextEngine.init(renderer, "C:/Windows/Fonts/segoeui.ttf") catch
        return error.FontNotFound;
    defer text_engine.deinit();

    g_text_engine = &text_engine;
    layout.setMeasureFn(measureCallback);
    layout.setMeasureImageFn(measureImageCallback);
    var win_w: f32 = 1280;
    var win_h: f32 = 800;

    initState();
    initVM(js_logic);
    defer deinit();
    updateTexts();

    var running = true;
    var fps_frames: u32 = 0;
    var fps_last: u64 = c.SDL_GetTicks();
    var fps_display: u32 = 0;
    var tick_us: u64 = 0;
    var layout_us: u64 = 0;
    var paint_us: u64 = 0;

    while (running) {
        var event: c.SDL_Event = undefined;
        while (c.SDL_PollEvent(&event)) {
            switch (event.type) {
                c.SDL_EVENT_QUIT => running = false,
                c.SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED => {
                    var ww: c_int = 0;
                    var wh: c_int = 0;
                    _ = c.SDL_GetWindowSize(window, &ww, &wh);
                    win_w = @floatFromInt(ww);
                    win_h = @floatFromInt(wh);
                    layout.markLayoutDirty();
                },
                c.SDL_EVENT_KEY_DOWN => {
                    if (event.key.key == c.SDLK_ESCAPE) running = false;
                },
                else => {},
            }
        }

        const t0 = std.time.microTimestamp();
        tick();
        const t1 = std.time.microTimestamp();
        tick_us = @intCast(@max(0, t1 - t0));

        if (state.isDirty()) {
            updateTexts();
            state.clearDirty();
        }

        _ = c.SDL_SetRenderDrawColor(renderer, 13, 17, 23, 255);
        _ = c.SDL_RenderClear(renderer);

        const t2 = std.time.microTimestamp();
        if (layout.isLayoutDirty()) {
            layout.layout(root, 0, 0, win_w, win_h);
            layout.clearLayoutDirty();
        }
        const t3 = std.time.microTimestamp();
        layout_us = @intCast(@max(0, t3 - t2));

        const t4 = std.time.microTimestamp();
        paintNode(renderer, &text_engine, root);
        const t5 = std.time.microTimestamp();
        paint_us = @intCast(@max(0, t5 - t4));

        // Telemetry bar
        {
            const bar_y = win_h - 24;
            _ = c.SDL_SetRenderDrawColor(renderer, 0, 0, 0, 200);
            var bar_rect = c.SDL_FRect{ .x = 0, .y = bar_y, .w = win_w, .h = 24 };
            _ = c.SDL_RenderFillRect(renderer, &bar_rect);
            var tbuf: [256]u8 = undefined;
            const tstr = std.fmt.bufPrint(&tbuf, "FPS: {d}  |  tick: {d}us  layout: {d}us  paint: {d}us", .{
                fps_display, tick_us, layout_us, paint_us,
            }) catch "???";
            text_engine.drawText(tstr, 8, bar_y + 4, 13, Color.rgb(180, 220, 180));
        }

        _ = c.SDL_RenderPresent(renderer);

        fps_frames += 1;
        const now: u64 = c.SDL_GetTicks();
        if (now -% fps_last >= 1000) {
            fps_display = fps_frames;
            fps_frames = 0;
            fps_last = now;
        }
    }
}
