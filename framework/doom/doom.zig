//! Doom platform shim — implements the DG_* functions doomgeneric.h declares
//! and holds the per-cart key queue + tick clock. JS drives advancement via
//! v8_bindings_doom (__doom_init / __doom_tick / __doom_framebuffer /
//! __doom_key). The renderer doesn't draw anything in DG_DrawFrame — the
//! cart reads the framebuffer pointer and paints it itself (Box matrix or
//! shader quad).

const std = @import("std");
const host_io = @import("../host_io.zig");
const builtin = @import("builtin");

// ── doomgeneric public surface ───────────────────────────────────────────
//
// `pixel_t* DG_ScreenBuffer` lives in deps/doomgeneric/src/doomgeneric.c.
// doomgeneric uses 640x400 RGBA by default (DOOMGENERIC_RESX/Y), with
// internal 2x scale-up from the 320x200 render. Pixel layout: 0xAARRGGBB
// little-endian (B is byte 0, then G, R, A) — i.e. BGRA byte order. We
// expose the buffer to JS as a 256KB ArrayBuffer view.
pub const RESX: usize = 640;
pub const RESY: usize = 400;
pub const FB_BYTES: usize = RESX * RESY * 4;

pub extern var DG_ScreenBuffer: ?[*]u32;

extern fn doomgeneric_Create(argc: c_int, argv: [*c][*c]u8) void;
extern fn doomgeneric_Tick() void;

// ── Key queue ────────────────────────────────────────────────────────────
//
// doomgeneric polls DG_GetKey(&pressed, &doom_key) until it returns 0.
// We push events from JS (with already-translated doom key codes — the
// cart does X11→doom key mapping or uses our helper) into a small ring.

const QUEUE_CAP: usize = 64;
const KeyEvent = packed struct(u32) { code: u8, pressed: u8, _pad: u16 = 0 };

var queue: [QUEUE_CAP]KeyEvent = undefined;
var queue_head: usize = 0; // read
var queue_tail: usize = 0; // write
var queue_mu: host_io.Mutex = .{};

pub fn pushKey(code: u8, pressed: bool) void {
    queue_mu.lock();
    defer queue_mu.unlock();
    const next = (queue_tail + 1) % QUEUE_CAP;
    if (next == queue_head) {
        // queue full — drop oldest
        queue_head = (queue_head + 1) % QUEUE_CAP;
    }
    queue[queue_tail] = .{ .code = code, .pressed = if (pressed) 1 else 0 };
    queue_tail = next;
}

fn popKey() ?KeyEvent {
    queue_mu.lock();
    defer queue_mu.unlock();
    if (queue_head == queue_tail) return null;
    const e = queue[queue_head];
    queue_head = (queue_head + 1) % QUEUE_CAP;
    return e;
}

// ── Tick clock ──────────────────────────────────────────────────────────
//
// DG_GetTicksMs is called by doomgeneric's I_GetTime / I_GetTimeMS. It
// drives the 35Hz game logic. We anchor to a monotonic timer at init.

var start_ns: i128 = 0;

fn nowMs() u32 {
    const delta_ns: i128 = host_io.nanoTimestamp() - start_ns;
    if (delta_ns < 0) return 0;
    return @as(u32, @intCast(@divTrunc(delta_ns, std.time.ns_per_ms) & 0xFFFF_FFFF));
}

// ── Init / tick state ───────────────────────────────────────────────────

var initialised: bool = false;
var argv_storage: [4][:0]u8 = undefined;
var argv_ptrs: [5][*c]u8 = undefined;

/// Boot doomgeneric with `wad_path` (file:// or absolute path passed via -iwad).
/// Returns false if already initialised. Safe to call once per cart; calling
/// twice is a no-op so the cart can rehydrate without restarting the host.
pub fn init(allocator: std.mem.Allocator, wad_path: []const u8) !bool {
    if (initialised) return false;
    start_ns = host_io.nanoTimestamp();

    // Build argv: ["doom", "-iwad", "<path>", "-nomusic"] — sound is stubbed
    // out by linking i_sound.c against null DG_*sound modules, but -nomusic
    // suppresses the music-server probe path in S_Init.
    argv_storage[0] = try allocator.dupeZ(u8, "doom");
    argv_storage[1] = try allocator.dupeZ(u8, "-iwad");
    argv_storage[2] = try allocator.dupeZ(u8, wad_path);
    argv_storage[3] = try allocator.dupeZ(u8, "-nomusic");

    var i: usize = 0;
    while (i < 4) : (i += 1) argv_ptrs[i] = @ptrCast(argv_storage[i].ptr);
    argv_ptrs[4] = null;

    doomgeneric_Create(@as(c_int, 4), @ptrCast(&argv_ptrs));
    initialised = true;
    return true;
}

pub fn tick() void {
    if (!initialised) return;
    doomgeneric_Tick();
}

pub fn isInitialised() bool {
    return initialised;
}

pub fn framebufferPtr() ?[*]u32 {
    return DG_ScreenBuffer;
}

// ── DG_* exports (called from doomgeneric.c) ────────────────────────────

export fn DG_Init() void {
    // We allocate the screen buffer in doomgeneric.c (it does malloc on
    // create). All we do here is reset our timer baseline in case it
    // wasn't set yet (e.g. somebody calls doomgeneric_Create directly).
    if (start_ns == 0) start_ns = host_io.nanoTimestamp();
}

export fn DG_DrawFrame() void {
    // The cart reads the framebuffer itself via __doom_framebuffer().
    // No work for us here.
}

export fn DG_SleepMs(ms: u32) void {
    host_io.sleep(@as(u64, ms) * std.time.ns_per_ms);
}

export fn DG_GetTicksMs() u32 {
    return nowMs();
}

export fn DG_GetKey(pressed_out: [*c]c_int, key_out: [*c]u8) c_int {
    const ev = popKey() orelse return 0;
    pressed_out.* = if (ev.pressed != 0) 1 else 0;
    key_out.* = ev.code;
    return 1;
}

export fn DG_SetWindowTitle(_: [*c]const u8) void {
    // Cart owns the window title; no-op.
}
