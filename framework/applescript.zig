//! AppleScript bridge — execute AppleScript from .tsz apps via NSAppleScript FFI.
//!
//! Uses Objective-C NSAppleScript in-process. No subprocess, no threading issues.
//! macOS only. No-op on other platforms.

const std = @import("std");
const builtin = @import("builtin");
const state = @import("api.zig").state;

const build_options = @import("build_options");
const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;

const qjs = if (HAS_QUICKJS) @cImport({
    @cDefine("_GNU_SOURCE", "1");
    @cDefine("QUICKJS_NG_BUILD", "1");
    @cInclude("quickjs.h");
}) else struct {
    pub const JSContext = opaque {};
    pub const JSValue = extern struct { tag: i64 = 3, u: extern union { int32: i32, float64: f64, ptr: ?*anyopaque } = .{ .int32 = 0 } };
};

const QJS_UNDEFINED = qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = 3 };

// ── FFI to Objective-C shim ───────────────────────────────────────────
extern fn applescript_execute(script: [*:0]const u8) [*:0]const u8;

// ── Public API ────────────────────────────────────────────────────────

/// Execute an AppleScript string and store the result in a state slot.
/// Runs synchronously via NSAppleScript FFI (fast, no subprocess).
pub fn run(script: []const u8, target_slot: usize) void {
    if (comptime builtin.os.tag != .macos) {
        state.setSlotString(target_slot, "ERROR: applescript requires macOS");
        return;
    }
    if (script.len == 0) return;

    // Need null-terminated string for C FFI
    var buf: [4096]u8 = undefined;
    const len = @min(script.len, buf.len - 1);
    @memcpy(buf[0..len], script[0..len]);
    buf[len] = 0;
    const script_z: [*:0]const u8 = buf[0..len :0];

    const result_ptr = applescript_execute(script_z);
    const result = std.mem.span(result_ptr);
    state.setSlotString(target_slot, result);
}

/// Poll — no-op now since execution is synchronous via FFI.
pub fn pollResult() void {}

// ── QuickJS host functions ────────────────────────────────────────────

fn hostApplescript(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (comptime !HAS_QUICKJS) return QJS_UNDEFINED;
    if (comptime builtin.os.tag != .macos) return qjs.JS_NewString(ctx, "ERROR: applescript requires macOS");
    if (argc < 1) return qjs.JS_NewString(ctx, "ERROR: missing script argument");

    const c_str = qjs.JS_ToCString(ctx, argv[0]);
    if (c_str == null) return qjs.JS_NewString(ctx, "ERROR: invalid string");
    defer qjs.JS_FreeCString(ctx, c_str);

    const result_ptr = applescript_execute(c_str);
    return qjs.JS_NewString(ctx, result_ptr);
}

fn hostApplescriptFile(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return QJS_UNDEFINED;
}

