// system_signals.zig — producer side of OS-level signals exposed via the
// useIFTTT bus. Sister to clipboard_watch.zig; same dispatch shape:
//
//   OS event ──► this module ──► __ifttt_onSystem*(...) eval ──► JS busEmit
//
// All numeric payloads are passed inline (safe to format). String payloads
// are stashed in module-level buffers and pulled by the JS handler via the
// matching __sys_*_get host function so we never have to JSON-escape paths.
//
// Tick-based polls (cursor, ram, vram) accumulate dt and fire on a fixed
// interval to avoid 60Hz spam.

const std = @import("std");
const c = @import("../c.zig").imports;
const v8_runtime = @import("../v8_runtime.zig");
const HostContext = @import("../host_context.zig");

// ── Tunables ────────────────────────────────────────────────────────────
const CURSOR_POLL_MS: u32 = 16; // ~60Hz max for cursor delta
const PERF_POLL_MS: u32 = 1000; // 1Hz for ram/vram polls
const SLOW_FRAME_MS: f32 = 32.0; // > 2 frames at 60Hz = "slow"
const HANG_FRAMES: u32 = 3; // N consecutive slow frames = hang

// ── Cursor ──────────────────────────────────────────────────────────────
var cursor_accum_ms: u32 = 0;
var cursor_last_x: f32 = -1;
var cursor_last_y: f32 = -1;
var cursor_initialized: bool = false;

// ── Window focus ────────────────────────────────────────────────────────
var last_focused: i8 = -1; // -1 = unknown; 0 = blurred; 1 = focused

// ── Viewport size ──────────────────────────────────────────────────────
// Source of truth for the JS side. Engine fires notifyResize() from the
// SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED handler in engine.zig. JS subscribers
// pick it up via __ifttt_onSystemResize(w, h); the matching getters
// (getViewportWidth/Height) let JS-side modules read the current size on
// import without waiting for an event.
//
// Tier-gated dispatch: SDL fires PIXEL_SIZE_CHANGED on every pixel of an
// active drag (60+/sec). Each JS fire evals into V8 and re-renders the
// classifier tree, which froze the engine on resize before this gate
// landed. notifyResize now only invokes the JS handler when the breakpoint
// tier crosses (sm/md/lg/xl). The latest width/height are still stashed in
// last_w/last_h so getViewportWidth() returns the live value.
var last_w: f32 = 1280;
var last_h: f32 = 800;
var last_bp_tier: u8 = 2; // 0=sm 1=md 2=lg 3=xl — matches breakpoint.zig

// Thresholds match runtime/theme.tsx + framework/breakpoint.zig defaults.
const BP_THRESHOLD_MD: f32 = 640;
const BP_THRESHOLD_LG: f32 = 1024;
const BP_THRESHOLD_XL: f32 = 1440;

fn classifyBpTier(w: f32) u8 {
    if (w >= BP_THRESHOLD_XL) return 3;
    if (w >= BP_THRESHOLD_LG) return 2;
    if (w >= BP_THRESHOLD_MD) return 1;
    return 0;
}

// ── File drop (path stash for JS-side pull) ─────────────────────────────
var drop_path_buf: [4096]u8 = undefined;
var drop_path_len: usize = 0;

// ── Slow frame / hang detection ─────────────────────────────────────────
var consecutive_slow: u32 = 0;
var hang_announced: bool = false;

// ── Mem polls ───────────────────────────────────────────────────────────
var perf_accum_ms: u32 = 0;
var last_ram_used: u64 = 0;
var last_ram_total: u64 = 0;
var last_vram_used: u64 = 0;
var last_vram_total: u64 = 0;

pub fn init() void {
    cursor_accum_ms = 0;
    cursor_last_x = -1;
    cursor_last_y = -1;
    cursor_initialized = false;
    last_focused = -1;
    drop_path_len = 0;
    consecutive_slow = 0;
    hang_announced = false;
    perf_accum_ms = 0;
    last_w = 1280;
    last_h = 800;
    last_bp_tier = classifyBpTier(last_w);
}

// ── Public API: notifications from engine event handlers ───────────────

pub fn notifyFocus(host: *HostContext, gained: bool) void {
    const want: i8 = if (gained) 1 else 0;
    if (last_focused == want) return;
    last_focused = want;
    var buf: [96]u8 = undefined;
    const sentinel = std.fmt.bufPrintZ(&buf, "__ifttt_onSystemFocus({d})", .{want}) catch return;
    fire(host, sentinel);
}

pub fn notifyDrop(host: *HostContext, path: []const u8) void {
    const n = @min(path.len, drop_path_buf.len);
    @memcpy(drop_path_buf[0..n], path[0..n]);
    drop_path_len = n;
    fire(host, "__ifttt_onSystemDrop()");
}

/// Pointer device flipped (mouse ⇄ pen). Engine calls this on the change edge
/// only (mouse_state.updatePointerDevice returns true), so no dedupe needed here.
/// dev: 0 = mouse, 1 = pen — matches mouse_state.PointerDevice.
pub fn notifyPointerDevice(host: *HostContext, dev: u8) void {
    var buf: [96]u8 = undefined;
    const sentinel = std.fmt.bufPrintZ(&buf, "__ifttt_onSystemPointerDevice({d})", .{dev}) catch return;
    fire(host, sentinel);
}

pub fn notifyResize(host: *HostContext, w: f32, h: f32) void {
    last_w = w;
    last_h = h;
    // Tier-gated: SDL fires PIXEL_SIZE_CHANGED on every pixel of an active
    // drag. Each fire() into V8 re-renders the classifier tree; without
    // this gate, dragging the window edge locked the engine. Only fire
    // when the breakpoint tier crosses (sm/md/lg/xl) — the JS side of
    // setViewportWidth would early-return on intra-tier updates anyway,
    // so coalescing here just avoids the V8 round-trip cost.
    const new_tier = classifyBpTier(w);
    if (new_tier == last_bp_tier) return;
    last_bp_tier = new_tier;
    var buf: [128]u8 = undefined;
    const sentinel = std.fmt.bufPrintZ(&buf, "__ifttt_onSystemResize({d:.0},{d:.0})", .{ w, h }) catch return;
    fire(host, sentinel);
}

// JS getters — let cart modules read the current viewport size on import
// without having to wait for a resize event. Bind via host fns in
// v8_bindings_core.zig.
pub fn getBpTier() u8 {
    return last_bp_tier;
}

pub fn getViewportWidth() f32 {
    return last_w;
}

pub fn getViewportHeight() f32 {
    return last_h;
}

// JS getter — returns the last drop path. Bind via system_signals.getDropPath
// from v8_bindings_core.zig.
pub fn getDropPath() []const u8 {
    return drop_path_buf[0..drop_path_len];
}

// ── Public API: per-frame tick (call once per main loop iteration) ─────

pub fn tick(host: *HostContext, dt_ms: u32) void {
    cursor_accum_ms += dt_ms;
    perf_accum_ms += dt_ms;

    if (cursor_accum_ms >= CURSOR_POLL_MS) {
        cursor_accum_ms = 0;
        var x: f32 = 0;
        var y: f32 = 0;
        _ = c.SDL_GetGlobalMouseState(&x, &y);
        if (!cursor_initialized) {
            cursor_initialized = true;
            cursor_last_x = x;
            cursor_last_y = y;
        } else if (x != cursor_last_x or y != cursor_last_y) {
            const dx = x - cursor_last_x;
            const dy = y - cursor_last_y;
            cursor_last_x = x;
            cursor_last_y = y;
            var buf: [192]u8 = undefined;
            const sentinel = std.fmt.bufPrintZ(&buf, "__ifttt_onSystemCursor({d:.0},{d:.0},{d:.0},{d:.0})", .{ x, y, dx, dy }) catch return;
            fire(host, sentinel);
        }
    }

    if (perf_accum_ms >= PERF_POLL_MS) {
        perf_accum_ms = 0;
        pollMem(host);
        pollVram(host);
    }
}

// ── Public API: post-paint frame timing ────────────────────────────────

pub fn tickPostPaint(host: *HostContext, dt_sec: f32) void {
    const ms = dt_sec * 1000.0;
    if (ms < SLOW_FRAME_MS) {
        consecutive_slow = 0;
        if (hang_announced) {
            // Recovered — announce end of hang as count=0. Edge-only fire.
            hang_announced = false;
            fire(host, "__ifttt_onSystemHang(0)");
        }
        return;
    }
    consecutive_slow += 1;
    var buf: [128]u8 = undefined;
    if (std.fmt.bufPrintZ(&buf, "__ifttt_onSystemSlowFrame({d:.2})", .{ms})) |sentinel| {
        fire(host, sentinel);
    } else |_| {}
    if (consecutive_slow >= HANG_FRAMES and !hang_announced) {
        hang_announced = true;
        var hbuf: [96]u8 = undefined;
        if (std.fmt.bufPrintZ(&hbuf, "__ifttt_onSystemHang({d})", .{consecutive_slow})) |sentinel| {
            fire(host, sentinel);
        } else |_| {}
    }
}

// ── Mem pollers ────────────────────────────────────────────────────────

fn pollMem(host: *HostContext) void {
    const io = host.io;
    const file = std.Io.Dir.openFileAbsolute(io, "/proc/meminfo", .{}) catch return;
    defer file.close(io);
    var buf: [4096]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return;
    var total: u64 = 0;
    var avail: u64 = 0;
    var line_iter = std.mem.splitScalar(u8, buf[0..n], '\n');
    while (line_iter.next()) |line| {
        if (std.mem.startsWith(u8, line, "MemTotal:")) {
            total = parseFirstNumber(line) * 1024;
        } else if (std.mem.startsWith(u8, line, "MemAvailable:")) {
            avail = parseFirstNumber(line) * 1024;
        }
    }
    if (total == 0) return;
    const used = if (avail > total) 0 else total - avail;
    if (used == last_ram_used and total == last_ram_total) return;
    last_ram_used = used;
    last_ram_total = total;
    var fbuf: [192]u8 = undefined;
    if (std.fmt.bufPrintZ(&fbuf, "__ifttt_onSystemRam({d},{d})", .{ used, total })) |sentinel| {
        fire(host, sentinel);
    } else |_| {}
}

fn pollVram(host: *HostContext) void {
    const io = host.io;
    // Try AMD/Intel discrete GPUs via /sys/class/drm/cardN/device/mem_info_vram_*.
    // We sweep cards 0..3 and use the first one that exposes both totals.
    var card: u32 = 0;
    while (card < 4) : (card += 1) {
        var total_path: [96]u8 = undefined;
        var used_path: [96]u8 = undefined;
        const tp = std.fmt.bufPrint(&total_path, "/sys/class/drm/card{d}/device/mem_info_vram_total", .{card}) catch return;
        const up = std.fmt.bufPrint(&used_path, "/sys/class/drm/card{d}/device/mem_info_vram_used", .{card}) catch return;
        const total = readU64File(io, tp) orelse continue;
        const used = readU64File(io, up) orelse continue;
        if (total == 0) continue;
        if (used == last_vram_used and total == last_vram_total) return;
        last_vram_used = used;
        last_vram_total = total;
        var fbuf: [192]u8 = undefined;
        if (std.fmt.bufPrintZ(&fbuf, "__ifttt_onSystemVram({d},{d})", .{ used, total })) |sentinel| {
            fire(host, sentinel);
        } else |_| {}
        return;
    }
    // No discoverable VRAM source — silently skip. NVIDIA proprietary needs
    // NVML; we don't link it. Cart authors who need NVIDIA stats can wire it
    // separately.
}

// ── Helpers ────────────────────────────────────────────────────────────

fn parseFirstNumber(line: []const u8) u64 {
    var i: usize = 0;
    while (i < line.len and (line[i] < '0' or line[i] > '9')) : (i += 1) {}
    var n: u64 = 0;
    while (i < line.len and line[i] >= '0' and line[i] <= '9') : (i += 1) {
        n = n * 10 + (line[i] - '0');
    }
    return n;
}

fn readU64File(io: std.Io, path: []const u8) ?u64 {
    const file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return null;
    defer file.close(io);
    var buf: [64]u8 = undefined;
    const n = file.readPositionalAll(io, &buf, 0) catch return null;
    if (n == 0) return null;
    return parseFirstNumber(buf[0..n]);
}

fn fire(host: *HostContext, sentinel: [:0]const u8) void {
    v8_runtime.callGlobal(host, "__beginJsEvent");
    v8_runtime.evalExpr(host, sentinel);
    v8_runtime.callGlobal(host, "__endJsEvent");
}
