//! random.zig — Deterministic PRNG for .tsz user code
//!
//! Exposed via the Random.* package namespace in .tsz:
//!   Random.float()          → random.float()        (0..1 f32)
//!   Random.range(min, max)  → random.range(min,max) (f32 in range)
//!   Random.int(min, max)    → random.intRange(min,max)
//!   Random.seed(s)          → random.seed(s)
//!
//! Uses xoshiro256** for quality + speed. Seeded from SDL_GetTicks at init
//! so each app run is different, but deterministic within a run once seeded.

const std = @import("std");

// ── State (xoshiro256**) ─────────────────────────────────────────────

var rng: std.Random.Xoshiro256 = std.Random.Xoshiro256.init(0x12345678_9ABCDEF0);
var initialized: bool = false;

// ── Public API ───────────────────────────────────────────────────────

/// Initialize with a seed. Called automatically at engine start.
pub fn init(s: u64) void {
    rng = std.Random.Xoshiro256.init(s);
    initialized = true;
}

/// Re-seed the PRNG (callable from .tsz via Random.seed).
pub fn seed(s: f32) void {
    rng = std.Random.Xoshiro256.init(@as(u64, @bitCast(@as(i64, @intFromFloat(s)))));
}

/// Random float in [0, 1).
pub fn float() f32 {
    return rng.random().float(f32);
}

/// Random float in [min, max).
pub fn range(min_val: f32, max_val: f32) f32 {
    return min_val + float() * (max_val - min_val);
}

/// Random integer in [min, max] inclusive.
pub fn intRange(min_val: f32, max_val: f32) f32 {
    const lo: i32 = @intFromFloat(min_val);
    const hi: i32 = @intFromFloat(max_val);
    if (hi <= lo) return min_val;
    const span: u32 = @intCast(hi - lo + 1);
    const val = rng.random().intRangeAtMost(i32, lo, lo + @as(i32, @intCast(span - 1)));
    return @floatFromInt(val);
}

// ── Tests ────────────────────────────────────────────────────────────

test "float returns 0..1" {
    init(42);
    for (0..100) |_| {
        const v = float();
        try std.testing.expect(v >= 0 and v < 1);
    }
}

test "range respects bounds" {
    init(42);
    for (0..100) |_| {
        const v = range(10, 20);
        try std.testing.expect(v >= 10 and v < 20);
    }
}

test "intRange returns integers" {
    init(42);
    for (0..100) |_| {
        const v = intRange(1, 6);
        try std.testing.expect(v >= 1 and v <= 6);
        // Should be a whole number
        try std.testing.expect(v == @floor(v));
    }
}

test "seed produces deterministic sequence" {
    seed(123);
    const a = float();
    const b = float();
    seed(123);
    const c = float();
    const d = float();
    try std.testing.expectEqual(a, c);
    try std.testing.expectEqual(b, d);
}
