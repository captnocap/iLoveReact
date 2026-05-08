//! Shared QuickJS C bindings — single @cImport for all QJS consumers.
//!
//! Both qjs_runtime.zig and qjs_value.zig import from here to avoid
//! the Zig "same opaque type from two @cImport blocks" mismatch.

const build_options = @import("build_options");
pub const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;

pub const qjs = if (HAS_QUICKJS) @cImport({
    @cDefine("_GNU_SOURCE", "1");
    @cDefine("QUICKJS_NG_BUILD", "1");
    @cInclude("quickjs.h");
}) else struct {
    pub const JSValue = extern struct { u: extern union { int32: i32 } = .{ .int32 = 0 }, tag: i64 = 0 };
    pub const JSRuntime = opaque {};
    pub const JSContext = opaque {};
};

pub const UNDEFINED = if (HAS_QUICKJS) (qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = 3 }) else qjs.JSValue{};
