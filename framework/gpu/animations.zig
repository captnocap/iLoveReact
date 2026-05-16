//! animations.zig — host-side animation registry.
//!
//! Each registered animation knows: a latch key to write into, an
//! easing curve, a from/to range, a duration, a start time, and a
//! loop mode. Once per frame, `tickAll(now_ms)` walks the registry,
//! evaluates each animation's curve against `now_ms`, and writes the
//! current value into `framework/latches.zig`. The existing pre-frame
//! `syncLatchesToNodes` then writes those values into the bound style
//! props (left/top/width/height/right/bottom — see
//! v8_app.zig:applyLatchOrPct).
//!
//! Net effect: cart code declares an animation once at mount via
//! `useHostAnimation` (registers via __anim_register), the painter
//! drives it from its own frame loop, JS does ZERO work per frame.
//! No RAF, no setState, no bridge crossings during animation.
//!
//! Compare to the latch-driven JS RAF pattern: cart's RAF fires per
//! frame, computes easings in JS, calls __latchSet ~3× per animated
//! thing per frame. With this registry the same work moves into the
//! painter loop and runs in compiled Zig instead of JIT'd JS — closer
//! to the WoW-pattern "engine owns the runtime, script declares the
//! scene."
//!
//! Memory: fixed pool of MAX_ANIMS entries (no allocations during
//! tick). Linear scan in `tickAll` is O(N), N is small (tens, maybe
//! hundreds), cache-friendly. No HashMap overhead.

const std = @import("std");
const latches = @import("../state/latches.zig");
const easing = @import("../math/easing.zig");
const m = @import("../math/root.zig");

// Sized to cover the chart_stress 4000-bar test plus headroom. Each
// active animation is ~150 bytes, so 8192 slots = ~1.2MB — fine.
// `tickAll` is a linear scan, so this also bounds the per-frame work
// (8192 × ~80ns ≈ 0.66ms worst case if every slot is active).
const MAX_ANIMS: usize = 8192;
const MAX_KEY_LEN: usize = 128;

pub const CurveType = enum(u8) {
    linear = 0,
    ease_in = 1,
    ease_out = 2,
    ease_in_out = 3,
    spring = 4,
    bounce = 5,
    sine = 6,
    // Named easings.net matrix — these match the EASING_NAMES set in
    // runtime/easing.ts exactly, so cart code can pass an EasingName
    // straight through useHostAnimation and the host evaluates the same
    // curve in compiled Zig.
    ease_in_sine = 7,
    ease_out_sine = 8,
    ease_in_out_sine = 9,
    ease_in_quad = 10,
    ease_out_quad = 11,
    ease_in_out_quad = 12,
    ease_in_cubic = 13,
    ease_out_cubic = 14,
    ease_in_out_cubic = 15,
    ease_in_quart = 16,
    ease_out_quart = 17,
    ease_in_out_quart = 18,
    ease_in_quint = 19,
    ease_out_quint = 20,
    ease_in_out_quint = 21,
    ease_in_expo = 22,
    ease_out_expo = 23,
    ease_in_out_expo = 24,
    ease_in_circ = 25,
    ease_out_circ = 26,
    ease_in_out_circ = 27,
    ease_in_back = 28,
    ease_out_back = 29,
    ease_in_out_back = 30,
    ease_in_elastic = 31,
    ease_out_elastic = 32,
    ease_in_out_elastic = 33,
    ease_in_bounce = 34,
    ease_out_bounce = 35,
    ease_in_out_bounce = 36,

    pub fn fromString(s: []const u8) CurveType {
        if (std.mem.eql(u8, s, "linear")) return .linear;
        if (std.mem.eql(u8, s, "easeIn")) return .ease_in;
        if (std.mem.eql(u8, s, "easeOut")) return .ease_out;
        if (std.mem.eql(u8, s, "easeInOut")) return .ease_in_out;
        if (std.mem.eql(u8, s, "spring")) return .spring;
        if (std.mem.eql(u8, s, "bounce")) return .bounce;
        if (std.mem.eql(u8, s, "sine")) return .sine;
        if (std.mem.eql(u8, s, "easeInSine")) return .ease_in_sine;
        if (std.mem.eql(u8, s, "easeOutSine")) return .ease_out_sine;
        if (std.mem.eql(u8, s, "easeInOutSine")) return .ease_in_out_sine;
        if (std.mem.eql(u8, s, "easeInQuad")) return .ease_in_quad;
        if (std.mem.eql(u8, s, "easeOutQuad")) return .ease_out_quad;
        if (std.mem.eql(u8, s, "easeInOutQuad")) return .ease_in_out_quad;
        if (std.mem.eql(u8, s, "easeInCubic")) return .ease_in_cubic;
        if (std.mem.eql(u8, s, "easeOutCubic")) return .ease_out_cubic;
        if (std.mem.eql(u8, s, "easeInOutCubic")) return .ease_in_out_cubic;
        if (std.mem.eql(u8, s, "easeInQuart")) return .ease_in_quart;
        if (std.mem.eql(u8, s, "easeOutQuart")) return .ease_out_quart;
        if (std.mem.eql(u8, s, "easeInOutQuart")) return .ease_in_out_quart;
        if (std.mem.eql(u8, s, "easeInQuint")) return .ease_in_quint;
        if (std.mem.eql(u8, s, "easeOutQuint")) return .ease_out_quint;
        if (std.mem.eql(u8, s, "easeInOutQuint")) return .ease_in_out_quint;
        if (std.mem.eql(u8, s, "easeInExpo")) return .ease_in_expo;
        if (std.mem.eql(u8, s, "easeOutExpo")) return .ease_out_expo;
        if (std.mem.eql(u8, s, "easeInOutExpo")) return .ease_in_out_expo;
        if (std.mem.eql(u8, s, "easeInCirc")) return .ease_in_circ;
        if (std.mem.eql(u8, s, "easeOutCirc")) return .ease_out_circ;
        if (std.mem.eql(u8, s, "easeInOutCirc")) return .ease_in_out_circ;
        if (std.mem.eql(u8, s, "easeInBack")) return .ease_in_back;
        if (std.mem.eql(u8, s, "easeOutBack")) return .ease_out_back;
        if (std.mem.eql(u8, s, "easeInOutBack")) return .ease_in_out_back;
        if (std.mem.eql(u8, s, "easeInElastic")) return .ease_in_elastic;
        if (std.mem.eql(u8, s, "easeOutElastic")) return .ease_out_elastic;
        if (std.mem.eql(u8, s, "easeInOutElastic")) return .ease_in_out_elastic;
        if (std.mem.eql(u8, s, "easeInBounce")) return .ease_in_bounce;
        if (std.mem.eql(u8, s, "easeOutBounce")) return .ease_out_bounce;
        if (std.mem.eql(u8, s, "easeInOutBounce")) return .ease_in_out_bounce;
        return .linear;
    }
};

pub const LoopMode = enum(u8) {
    once = 0,      // play 0→1 then hold at 1
    cycle = 1,     // sawtooth: 0→1, jump back to 0
    pingpong = 2,  // 0→1, 1→0, 0→1, ...
};

pub const Animation = struct {
    id: u32 = 0,
    key_buf: [MAX_KEY_LEN]u8 = [_]u8{0} ** MAX_KEY_LEN,
    key_len: u8 = 0,
    curve: CurveType = .linear,
    loop: LoopMode = .cycle,
    from: f32 = 0,
    to: f32 = 0,
    duration_ms: f32 = 1000,
    start_ms: i64 = 0,
    active: bool = false,
};

var anims: [MAX_ANIMS]Animation = [_]Animation{.{}} ** MAX_ANIMS;
var next_id: u32 = 1;
var dirty_this_frame: bool = false;

/// Public re-export so callers outside this file (e.g. engine.zig's
/// inline-paint tween) can evaluate a curve byte without going through
/// the registry. Same dispatch as the internal applyCurve.
pub fn applyCurvePub(curve: CurveType, t: f32) f32 {
    return applyCurve(curve, t);
}

fn applyCurve(curve: CurveType, t: f32) f32 {
    return switch (curve) {
        .linear => easing.linear(t),
        .ease_in => easing.easeIn(t),
        .ease_out => easing.easeOut(t),
        .ease_in_out => easing.easeInOut(t),
        .spring => easing.spring(t),
        .bounce => easing.bounce(t),
        .sine => easing.sine(t),
        .ease_in_sine => easing.easeInSine(t),
        .ease_out_sine => easing.easeOutSine(t),
        .ease_in_out_sine => easing.easeInOutSine(t),
        .ease_in_quad => easing.easeInQuad(t),
        .ease_out_quad => easing.easeOutQuad(t),
        .ease_in_out_quad => easing.easeInOutQuad(t),
        .ease_in_cubic => easing.easeInCubic(t),
        .ease_out_cubic => easing.easeOutCubic(t),
        .ease_in_out_cubic => easing.easeInOutCubic(t),
        .ease_in_quart => easing.easeInQuart(t),
        .ease_out_quart => easing.easeOutQuart(t),
        .ease_in_out_quart => easing.easeInOutQuart(t),
        .ease_in_quint => easing.easeInQuint(t),
        .ease_out_quint => easing.easeOutQuint(t),
        .ease_in_out_quint => easing.easeInOutQuint(t),
        .ease_in_expo => easing.easeInExpo(t),
        .ease_out_expo => easing.easeOutExpo(t),
        .ease_in_out_expo => easing.easeInOutExpo(t),
        .ease_in_circ => easing.easeInCirc(t),
        .ease_out_circ => easing.easeOutCirc(t),
        .ease_in_out_circ => easing.easeInOutCirc(t),
        .ease_in_back => easing.easeInBack(t),
        .ease_out_back => easing.easeOutBack(t),
        .ease_in_out_back => easing.easeInOutBack(t),
        .ease_in_elastic => easing.easeInElastic(t),
        .ease_out_elastic => easing.easeOutElastic(t),
        .ease_in_out_elastic => easing.easeInOutElastic(t),
        .ease_in_bounce => easing.easeInBounce(t),
        .ease_out_bounce => easing.easeOutBounce(t),
        .ease_in_out_bounce => easing.easeInOutBounce(t),
    };
}

/// Register a new animation. Returns the animation id, or 0 if the
/// pool is full / key is too long.
///
/// `start_offset_ms` rewinds the animation's effective start time —
/// at registration, `start_ms = now_ms - start_offset_ms`, so a
/// non-zero offset makes the animation appear to have already been
/// running for that many milliseconds. Useful for staggering N
/// animations that share a curve (e.g. wave-with-phase patterns):
/// each bar registers with a different offset and the painter
/// computes their phase delta naturally.
pub fn register(
    key: []const u8,
    curve: CurveType,
    loop: LoopMode,
    from: f32,
    to: f32,
    duration_ms: f32,
    now_ms: i64,
    start_offset_ms: i64,
) u32 {
    if (key.len > MAX_KEY_LEN) return 0;
    // Find a free slot.
    var i: usize = 0;
    while (i < MAX_ANIMS) : (i += 1) {
        if (!anims[i].active) {
            const id = next_id;
            next_id += 1;
            anims[i] = .{
                .id = id,
                .curve = curve,
                .loop = loop,
                .from = from,
                .to = to,
                .duration_ms = if (duration_ms <= 0) 1 else duration_ms,
                .start_ms = now_ms - start_offset_ms,
                .active = true,
            };
            const len: u8 = @intCast(@min(key.len, MAX_KEY_LEN));
            @memcpy(anims[i].key_buf[0..len], key[0..len]);
            anims[i].key_len = len;
            // Seed the latch immediately so first-frame layout has a
            // value before tickAll runs.
            latches.set(key, from);
            return id;
        }
    }
    return 0;
}

/// Stop and remove an animation by id.
pub fn unregister(id: u32) void {
    var i: usize = 0;
    while (i < MAX_ANIMS) : (i += 1) {
        if (anims[i].active and anims[i].id == id) {
            anims[i].active = false;
            anims[i].key_len = 0;
            return;
        }
    }
}

/// Walk the registry, evaluate each animation against now_ms, write
/// the current value to its latch. Called from the painter loop
/// pre-frame, alongside syncLatchesToNodes.
pub fn tickAll(now_ms: i64) void {
    var i: usize = 0;
    var any: bool = false;
    while (i < MAX_ANIMS) : (i += 1) {
        const a = &anims[i];
        if (!a.active) continue;
        const elapsed: f32 = @floatCast(@as(f64, @floatFromInt(now_ms - a.start_ms)));
        const raw = elapsed / a.duration_ms;
        const t: f32 = switch (a.loop) {
            .once => m.clamp01(raw),
            .cycle => m.fract(raw),
            .pingpong => m.pingPong(raw, 1.0),
        };
        const eased = applyCurve(a.curve, t);
        const value = a.from + (a.to - a.from) * eased;
        latches.set(a.key_buf[0..a.key_len], value);
        any = true;
    }
    if (any) dirty_this_frame = true;
}

/// True iff at least one animation wrote to a latch this frame. Used
/// alongside latches.isDirty() so the host knows to re-layout/paint.
pub fn isDirty() bool {
    return dirty_this_frame;
}

pub fn clearDirty() void {
    dirty_this_frame = false;
}

/// Wipe all animation state. Called on dev hot-reload.
pub fn clearAll() void {
    var i: usize = 0;
    while (i < MAX_ANIMS) : (i += 1) {
        anims[i].active = false;
        anims[i].key_len = 0;
    }
    next_id = 1;
    dirty_this_frame = false;
}

pub fn count() usize {
    var c: usize = 0;
    for (anims) |a| if (a.active) {
        c += 1;
    };
    return c;
}
