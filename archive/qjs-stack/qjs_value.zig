//! Protected QuickJS value wrapper — RAII ownership for JSValue.
//!
//! Eliminates scattered JS_FreeValue/JS_FreeCString calls by encoding
//! ownership in the type system. Values auto-free on scope exit via `defer`.
//!
//! Inspired by Bun's JSValue wrapper (BUN_FIELD_NOTES.md §3).
//!
//! Usage:
//!   const global = JsVal.getGlobal(ctx);
//!   defer global.deinit();
//!   const func = global.getProperty("myFunc");
//!   defer func.deinit();
//!   const result = func.call(global, &.{});
//!   defer result.deinit();

const std = @import("std");
const qjs_c = @import("qjs_c.zig");
const HAS_QUICKJS = qjs_c.HAS_QUICKJS;
const qjs = qjs_c.qjs;

pub const UNDEFINED = qjs_c.UNDEFINED;

// ── CString — auto-freeing C string from JS ─────────────────────

/// Wraps a string obtained via JS_ToCString. Auto-frees on deinit.
pub const CString = struct {
    ctx: *qjs.JSContext,
    ptr: [*:0]const u8,

    pub fn deinit(self: CString) void {
        if (comptime !HAS_QUICKJS) return;
        qjs.JS_FreeCString(self.ctx, self.ptr);
    }

    /// Return as a Zig slice.
    pub fn slice(self: CString) []const u8 {
        return std.mem.span(self.ptr);
    }
};

/// Wraps a string obtained via JS_ToCStringLen. Auto-frees on deinit.
pub const CStringLen = struct {
    ctx: *qjs.JSContext,
    ptr: [*]const u8,
    len: usize,

    pub fn deinit(self: CStringLen) void {
        if (comptime !HAS_QUICKJS) return;
        qjs.JS_FreeCString(self.ctx, self.ptr);
    }

    /// Return as a Zig slice.
    pub fn slice(self: CStringLen) []const u8 {
        return self.ptr[0..self.len];
    }
};

// ── JsVal — owned JSValue with automatic cleanup ────────────────

/// An owned QuickJS value. Calls JS_FreeValue on deinit.
/// Use `defer val.deinit()` immediately after obtaining a value.
///
/// Sentinel: `.tag = 3` (undefined) with `.ctx = null` means "nothing to free".
/// This is safe because JS_FreeValue on undefined is always a no-op in QuickJS,
/// but we skip the call entirely when ctx is null for clarity.
pub const JsVal = struct {
    ctx: ?*qjs.JSContext,
    val: qjs.JSValue,

    // ── Construction ─────────────────────────────────────────

    /// Wrap a raw JSValue and take ownership. Caller must not free `val` separately.
    pub fn init(ctx: *qjs.JSContext, val: qjs.JSValue) JsVal {
        return .{ .ctx = ctx, .val = val };
    }

    /// A no-op sentinel — deinit does nothing. Use when you need a JsVal
    /// but have no value (e.g. early return paths).
    pub const NONE = JsVal{ .ctx = null, .val = UNDEFINED };

    // ── Destruction ──────────────────────────────────────────

    /// Release ownership. Safe to call multiple times (idempotent after first call).
    pub fn deinit(self: *const JsVal) void {
        if (comptime !HAS_QUICKJS) return;
        if (self.ctx) |ctx| {
            qjs.JS_FreeValue(ctx, self.val);
        }
    }

    // ── Predicates ───────────────────────────────────────────

    pub fn isUndefined(self: JsVal) bool {
        if (comptime !HAS_QUICKJS) return true;
        return qjs.JS_IsUndefined(self.val);
    }

    pub fn isException(self: JsVal) bool {
        if (comptime !HAS_QUICKJS) return false;
        return qjs.JS_IsException(self.val);
    }

    pub fn isValid(self: JsVal) bool {
        return !self.isUndefined() and !self.isException();
    }

    // ── Property access ──────────────────────────────────────

    /// Get a property by name. Returns an owned JsVal — caller must deinit.
    pub fn getProperty(self: JsVal, name: [*:0]const u8) JsVal {
        if (comptime !HAS_QUICKJS) return NONE;
        const ctx = self.ctx orelse return NONE;
        return init(ctx, qjs.JS_GetPropertyStr(ctx, self.val, name));
    }

    /// Set a property by name. Takes ownership of `child` — caller must NOT deinit `child`.
    pub fn setProperty(self: JsVal, name: [*:0]const u8, child: qjs.JSValue) void {
        if (comptime !HAS_QUICKJS) return;
        const ctx = self.ctx orelse return;
        _ = qjs.JS_SetPropertyStr(ctx, self.val, name, child);
    }

    /// Set a property by integer index. Takes ownership of `child`.
    pub fn setPropertyUint32(self: JsVal, idx: u32, child: qjs.JSValue) void {
        if (comptime !HAS_QUICKJS) return;
        const ctx = self.ctx orelse return;
        _ = qjs.JS_SetPropertyUint32(ctx, self.val, idx, child);
    }

    // ── Calling ──────────────────────────────────────────────

    pub const CallError = error{JsException};

    /// Call this value as a function. Returns owned result or error.
    /// On exception: logs the error, frees the exception, returns CallError.
    pub fn call(self: JsVal, this: JsVal, argc: c_int, argv: ?[*]qjs.JSValue) CallError!JsVal {
        if (comptime !HAS_QUICKJS) return NONE;
        const ctx = self.ctx orelse return NONE;
        const r = qjs.JS_Call(ctx, self.val, this.val, argc, argv);
        if (qjs.JS_IsException(r)) {
            logException(ctx);
            return CallError.JsException;
        }
        return init(ctx, r);
    }

    /// Call with no arguments. Convenience wrapper.
    pub fn call0(self: JsVal, this: JsVal) CallError!JsVal {
        return self.call(this, 0, null);
    }

    // ── String extraction ────────────────────────────────────

    /// Get the value as a C string. Returns null if conversion fails.
    /// Caller must deinit the returned CString.
    pub fn toCString(self: JsVal) ?CString {
        if (comptime !HAS_QUICKJS) return null;
        const ctx = self.ctx orelse return null;
        const ptr = qjs.JS_ToCString(ctx, self.val);
        if (ptr == null) return null;
        return CString{ .ctx = ctx, .ptr = ptr.? };
    }

    /// Get the value as a C string with length. Returns null if conversion fails.
    /// Caller must deinit the returned CStringLen.
    pub fn toCStringLen(self: JsVal) ?CStringLen {
        if (comptime !HAS_QUICKJS) return null;
        const ctx = self.ctx orelse return null;
        var len: usize = 0;
        const ptr = qjs.JS_ToCStringLen(ctx, &len, self.val);
        if (ptr == null) return null;
        return CStringLen{ .ctx = ctx, .ptr = ptr.?, .len = len };
    }

    // ── Numeric extraction ───────────────────────────────────

    pub fn toInt32(self: JsVal) i32 {
        if (comptime !HAS_QUICKJS) return 0;
        const ctx = self.ctx orelse return 0;
        var v: i32 = 0;
        _ = qjs.JS_ToInt32(ctx, &v, self.val);
        return v;
    }

    pub fn toFloat64(self: JsVal) f64 {
        if (comptime !HAS_QUICKJS) return 0;
        const ctx = self.ctx orelse return 0;
        var v: f64 = 0;
        _ = qjs.JS_ToFloat64(ctx, &v, self.val);
        return v;
    }

    pub fn toBool(self: JsVal) bool {
        if (comptime !HAS_QUICKJS) return false;
        const ctx = self.ctx orelse return false;
        return qjs.JS_ToBool(ctx, self.val) != 0;
    }

    // ── Raw access (for interop with existing code) ──────────

    /// Get the underlying raw JSValue. Use when passing to QJS C functions
    /// that don't take ownership (e.g. JS_SetPropertyStr key side).
    pub fn raw(self: JsVal) qjs.JSValue {
        return self.val;
    }

    /// Get the context. Panics if NONE.
    pub fn context(self: JsVal) *qjs.JSContext {
        return self.ctx.?;
    }

    // ── Static constructors ──────────────────────────────────

    /// Get the global object. Caller must deinit.
    pub fn getGlobal(ctx: *qjs.JSContext) JsVal {
        if (comptime !HAS_QUICKJS) return NONE;
        return init(ctx, qjs.JS_GetGlobalObject(ctx));
    }

    /// Create a new JS object. Caller must deinit if not passed to setProperty.
    pub fn newObject(ctx: *qjs.JSContext) JsVal {
        if (comptime !HAS_QUICKJS) return NONE;
        return init(ctx, qjs.JS_NewObject(ctx));
    }

    /// Create a new JS array. Caller must deinit if not passed to setProperty.
    pub fn newArray(ctx: *qjs.JSContext) JsVal {
        if (comptime !HAS_QUICKJS) return NONE;
        return init(ctx, qjs.JS_NewArray(ctx));
    }

    /// Eval JS code. Returns owned result. Caller must deinit.
    pub fn eval(ctx: *qjs.JSContext, code: []const u8, filename: [*:0]const u8, flags: c_int) JsVal {
        if (comptime !HAS_QUICKJS) return NONE;
        return init(ctx, qjs.JS_Eval(ctx, code.ptr, code.len, filename, flags));
    }
};

// ── Helpers ─────────────────────────────────────────────────────

/// Set a float64 property on a raw JSValue. Used in host functions that build
/// JS objects (telemetry, semantic, etc.) where the object isn't wrapped in JsVal.
pub fn setF(ctx: *qjs.JSContext, obj: qjs.JSValue, name: [*:0]const u8, val: f64) void {
    if (comptime !HAS_QUICKJS) return;
    _ = qjs.JS_SetPropertyStr(ctx, obj, name, qjs.JS_NewFloat64(ctx, val));
}

/// Set a boolean-as-float property (1.0/0.0).
pub fn setB(ctx: *qjs.JSContext, obj: qjs.JSValue, name: [*:0]const u8, val: bool) void {
    setF(ctx, obj, name, if (val) 1.0 else 0.0);
}

/// Set a string property from a Zig slice.
pub fn setStr(ctx: *qjs.JSContext, obj: qjs.JSValue, name: [*:0]const u8, val: []const u8) void {
    if (comptime !HAS_QUICKJS) return;
    _ = qjs.JS_SetPropertyStr(ctx, obj, name, qjs.JS_NewStringLen(ctx, val.ptr, @intCast(val.len)));
}

/// Log the current pending exception and free it.
pub fn logException(ctx: *qjs.JSContext) void {
    if (comptime !HAS_QUICKJS) return;
    const exc = qjs.JS_GetException(ctx);
    const s = qjs.JS_ToCString(ctx, exc);
    if (s != null) {
        std.log.err("[JS] {s}", .{std.mem.span(s.?)});
        qjs.JS_FreeCString(ctx, s);
    }
    qjs.JS_FreeValue(ctx, exc);
}

/// Access to the underlying QJS C bindings (or stub when HAS_QUICKJS=false).
/// Use for host function signatures that must match the C callback ABI.
pub const c = qjs;
