//! ONNX Runtime — minimal Zig wrapper around the C API.
//!
//! Phase-1 hello-world: prove the .so is linked, the API entry point is
//! callable, and we can pull a version string out. Real session/inference
//! lives in framework/ml/segment.zig (Phase 2).
//!
//! The C API design: `OrtGetApiBase()` returns a struct with two slots —
//! `GetVersionString()` (a free function) and `GetApi(version)` which
//! returns the versioned API table. The API table itself is the giant
//! struct of function pointers for everything from session creation to
//! tensor manipulation. We cache the table on first use.

const std = @import("std");

// SHARED cimport — re-exported as `onnx.c` so framework/ml/segment.zig (and
// any future ONNX-touching module) uses the SAME generated Zig types. Each
// @cImport site generates its own copy of opaque types like OrtValue /
// OrtApi; Zig considers those distinct types even when they refer to the
// same C declaration, which produces "cannot cast pointer type child" errors
// at every cross-module call site. One canonical cimport here fixes the
// problem permanently.
pub const c = @cImport({
    @cInclude("onnxruntime_c_api.h");
});

const log = std.log.scoped(.onnx);

var g_api: ?*const c.OrtApi = null;

/// Look up the versioned API table. Caches on first call. Returns null if
/// the runtime is too old (doesn't support ORT_API_VERSION we compiled
/// against) — vendoring deps/onnxruntime/lib/ should keep this impossible
/// in practice, but the C contract permits it so we handle it.
pub fn api() ?*const c.OrtApi {
    if (g_api) |a| return a;
    const base_ptr = c.OrtGetApiBase();
    if (base_ptr == null) return null;
    const base = base_ptr.*;
    const get_api = base.GetApi orelse return null;
    const a = get_api(c.ORT_API_VERSION);
    if (a == null) return null;
    g_api = a;
    return a;
}

/// Linked onnxruntime version, e.g. "1.26.0". Returns "unknown" if the API
/// base isn't reachable (shouldn't happen with the vendored .so).
pub fn versionString() []const u8 {
    const base_ptr = c.OrtGetApiBase();
    if (base_ptr == null) return "unknown";
    const base = base_ptr.*;
    const get_ver = base.GetVersionString orelse return "unknown";
    const cstr = get_ver();
    if (cstr == null) return "unknown";
    return std.mem.span(cstr);
}

/// Hello-world smoke test. Initializes the API table, allocates an
/// environment with default logging, and frees it. If everything works,
/// the linker found the .so, the C ABI matches, and the runtime is
/// usable — Phase 1 done. Returns null on success or an error description
/// on failure (caller owns the returned string and must free it).
pub fn smokeTest(alloc: std.mem.Allocator) ?[]const u8 {
    const a = api() orelse return alloc.dupe(u8, "OrtGetApiBase returned null or wrong version") catch null;

    var env: ?*c.OrtEnv = null;
    const create_env = a.CreateEnv orelse return alloc.dupe(u8, "CreateEnv fn pointer is null") catch null;
    const status = create_env(c.ORT_LOGGING_LEVEL_WARNING, "reactjit", &env);
    if (status != null) {
        const msg = ortStatusMessage(a, status) orelse "unknown CreateEnv failure";
        const owned = alloc.dupe(u8, msg) catch null;
        releaseStatus(a, status);
        return owned;
    }
    defer if (env) |e| releaseEnv(a, e);

    log.info("onnx ok — version={s} api_version={d}", .{ versionString(), c.ORT_API_VERSION });
    return null;
}

fn ortStatusMessage(a: *const c.OrtApi, status: ?*c.OrtStatus) ?[]const u8 {
    const get_msg = a.GetErrorMessage orelse return null;
    const cstr = get_msg(status);
    if (cstr == null) return null;
    return std.mem.span(cstr);
}

fn releaseStatus(a: *const c.OrtApi, status: ?*c.OrtStatus) void {
    if (a.ReleaseStatus) |fn_ptr| fn_ptr(status);
}

fn releaseEnv(a: *const c.OrtApi, env: *c.OrtEnv) void {
    if (a.ReleaseEnv) |fn_ptr| fn_ptr(env);
}
