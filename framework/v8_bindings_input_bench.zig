//! Input bench host bindings — pure-Zig WASD player controller.
//!
//! One of four backends in cart/input_bench, this one keeps player state
//! entirely on the Zig side. JS publishes the current camera yaw (so the
//! cart's mouse-look stays the universal source of yaw across backends),
//! Zig reads SDL's keyboard state directly on each `pos()` call and
//! integrates an axis-aligned velocity with an internal dt clock.
//!
//! "Purely zig" here means input *interpretation* and integration are
//! zig-side; JS just queries the result. The V8 round-trip on the getter
//! is the unavoidable shared overhead — every backend pays it once per
//! frame to read the position.
//!
//! Host fns:
//!   __input_bench_reset(x, z)             reset position
//!   __input_bench_set_yaw(rad)            publish camera yaw (radians)
//!   __input_bench_set_speed(units_per_s)  override walk speed (default 4)
//!   __input_bench_set_enabled(bool)       enable/disable ticking
//!   __input_bench_pos()                   advance + return "x,z,dx,dz,us"
//!
//! Return string is a tight CSV ("x,z,dx,dz,us") to keep JSON.parse out of
//! the per-frame hot path. `us` is the wall-clock microseconds spent inside
//! the host fn (always close to zero — included so cart code shows a real
//! number even on the pure-Zig backend).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const c = @import("engine.zig").c;

const alloc = std.heap.c_allocator;

// SDL3 scancodes (we read SDL_GetKeyboardState directly).
const SCAN_A: usize = 4;
const SCAN_D: usize = 7;
const SCAN_S: usize = 22;
const SCAN_W: usize = 26;
const SCAN_SPACE: usize = 44;
const SCAN_LSHIFT: usize = 225;

// ── state ────────────────────────────────────────────────────────────

var g_x: f32 = 0;
var g_z: f32 = 0;
var g_last_dx: f32 = 0;
var g_last_dz: f32 = 0;
var g_yaw: f32 = 0;
var g_speed: f32 = 4.0;
var g_enabled: bool = false;
var g_last_ns: i64 = 0;

// Monotonic origin for __bench_now_us. Set on first call so the returned
// double stays well within f64's 53-bit integer range (a year of uptime
// in nanoseconds is ~3e16 — over 2^53; subtracting an origin keeps the
// number tiny, and dividing by 1000 gives μs with fractional nanoseconds).
var g_bench_origin_ns: i64 = 0;

// ── helpers ──────────────────────────────────────────────────────────

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
}

fn argToBool(info: v8.FunctionCallbackInfo, idx: u32) ?bool {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toBool(info.getIsolate());
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn keyDown(scancode: usize) bool {
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return false;
    return keys[scancode];
}

// ── host fns ─────────────────────────────────────────────────────────

fn hostReset(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    g_x = if (info.length() >= 1) @floatCast(argToF64(info, 0) orelse 0) else 0;
    g_z = if (info.length() >= 2) @floatCast(argToF64(info, 1) orelse 0) else 0;
    g_last_dx = 0;
    g_last_dz = 0;
    g_last_ns = nowNs(info);
}

// Io.Timestamp nanoseconds are i96; this benchmark stores i64 (roughly 292
// years of monotonic-clock range) so the hot-path arithmetic stays narrow.
inline fn nowNs(info: v8.FunctionCallbackInfo) i64 {
    return @as(i64, @truncate(std.Io.Clock.now(.awake, v8_runtime.hostContext(info.getIsolate()).io).toNanoseconds()));
}

fn hostSetYaw(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    g_yaw = @floatCast(argToF64(info, 0) orelse 0);
}

fn hostSetSpeed(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const s: f32 = @floatCast(argToF64(info, 0) orelse 4.0);
    g_speed = if (s > 0) s else 0;
}

fn hostSetEnabled(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    g_enabled = argToBool(info, 0) orelse false;
    // Reset clock on enable so the next tick gets a clean dt.
    if (g_enabled) g_last_ns = nowNs(info);
}

// __input_bench_pos() — advance integration with an internal dt clock,
// read SDL keyboard state, return "x,z,dx,dz,us".
fn hostPos(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs(info);

    if (g_enabled) {
        const now = t0;
        var dt_ns: i64 = if (g_last_ns == 0) 0 else (now - g_last_ns);
        g_last_ns = now;
        // Clamp dt to 100ms so paused tabs don't catapult the player.
        if (dt_ns > 100_000_000) dt_ns = 100_000_000;
        const dt: f32 = @as(f32, @floatFromInt(dt_ns)) / 1_000_000_000.0;

        var fwd: f32 = 0;
        var strafe: f32 = 0;
        if (keyDown(SCAN_W)) fwd += 1;
        if (keyDown(SCAN_S)) fwd -= 1;
        if (keyDown(SCAN_D)) strafe += 1;
        if (keyDown(SCAN_A)) strafe -= 1;

        // Normalize diagonals so |v| stays at g_speed.
        const len2 = fwd * fwd + strafe * strafe;
        if (len2 > 1.0) {
            const inv = 1.0 / @sqrt(len2);
            fwd *= inv;
            strafe *= inv;
        }

        // Engine renders world +X as screen-LEFT (lookForward uses
        // -sin(yaw) for X), so strafe gets the opposite sign of forward
        // to keep D walking screen-right. Same formula as keys.ts —
        // change one, change the other.
        const cy = @cos(g_yaw);
        const sy = @sin(g_yaw);
        const dx = (fwd * sy - strafe * cy) * g_speed * dt;
        const dz = (fwd * cy + strafe * sy) * g_speed * dt;

        g_x += dx;
        g_z += dz;
        g_last_dx = dx;
        g_last_dz = dz;
    } else {
        g_last_ns = t0;
    }

    const elapsed_us: f64 = @as(f64, @floatFromInt(nowNs(info) - t0)) / 1000.0;
    var out: [128]u8 = undefined;
    const s = std.fmt.bufPrint(&out, "{d:.4},{d:.4},{d:.5},{d:.5},{d:.2}", .{
        g_x, g_z, g_last_dx, g_last_dz, elapsed_us,
    }) catch {
        setReturnString(info, "0,0,0,0,0");
        return;
    };
    setReturnString(info, s);
}

// __bench_now_us() — nanosecond-resolution wall-clock microseconds since
// the first call. JS `performance.now()` in this V8 host returns
// millisecond-precision floats, which can't resolve the sub-μs cost of
// integrating a single WASD step — so the JS and IFTTT backends would
// always show 0.00 μs without this. Returns a double; nanosecond
// precision is preserved by dividing ns by 1000 in floating point.
fn hostNowUs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const now = nowNs(info);
    if (g_bench_origin_ns == 0) g_bench_origin_ns = now;
    const us: f64 = @as(f64, @floatFromInt(now - g_bench_origin_ns)) / 1000.0;
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), us));
}

// ── Registration ─────────────────────────────────────────────────────

pub fn registerInputBench(_: anytype) void {
    v8_runtime.registerHostFn("__input_bench_reset", hostReset);
    v8_runtime.registerHostFn("__input_bench_set_yaw", hostSetYaw);
    v8_runtime.registerHostFn("__input_bench_set_speed", hostSetSpeed);
    v8_runtime.registerHostFn("__input_bench_set_enabled", hostSetEnabled);
    v8_runtime.registerHostFn("__input_bench_pos", hostPos);
    v8_runtime.registerHostFn("__bench_now_us", hostNowUs);
}
