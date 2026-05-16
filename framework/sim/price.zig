//! sim/price.zig — per-token price state, patterns, candle ring.

const std = @import("std");
const Rng = @import("rng.zig").Rng;

pub const PricePattern = enum(u8) {
    crab,
    pump,
    dump,
    organic_up,
    organic_down,
    @"volatile",
    rug,
};

pub const Candle = struct {
    t: u64,
    o: f64,
    h: f64,
    l: f64,
    c: f64,
};

pub const CANDLE_CAP: usize = 64;
pub const CANDLE_TICKS: u32 = 5;

pub const PriceBucket = enum(u8) {
    micro,
    small,
    mid,
    large,
    blue,
};

pub const BandParams = struct {
    pump_cap: f64,
    dump_floor: f64,
    pull_strength: f64,
};

pub fn bucketFor(anchor: f64) PriceBucket {
    return if (anchor < 1.0)        .micro
        else if (anchor < 100.0)    .small
        else if (anchor < 1_000.0)  .mid
        else if (anchor < 10_000.0) .large
        else                        .blue;
}

pub fn bandParamsFor(bucket: PriceBucket) BandParams {
    return switch (bucket) {
        .micro => .{ .pump_cap = 5.0,   .dump_floor = 0.05, .pull_strength = 0.25 },
        .small => .{ .pump_cap = 3.0,   .dump_floor = 0.20, .pull_strength = 0.30 },
        .mid   => .{ .pump_cap = 1.50,  .dump_floor = 0.50, .pull_strength = 0.35 },
        .large => .{ .pump_cap = 1.30,  .dump_floor = 0.70, .pull_strength = 0.40 },
        .blue  => .{ .pump_cap = 1.15,  .dump_floor = 0.85, .pull_strength = 0.50 },
    };
}

pub const PriceState = struct {
    token_id: u32,
    anchor: f64,
    current: f64,
    pattern: PricePattern,
    pattern_progress: f32,
    base_volatility: f64,
    rug_chance_per_tick: f64,
    is_rugged: bool,
    ath: f64,
    atl: f64,
    bucket: PriceBucket,
    band_low: f64,
    band_high: f64,
    band_pull: f64,
    candles: [CANDLE_CAP]Candle,
    candle_count: u32,
    candle_head: u32,
    current_open: f64,
    current_high: f64,
    current_low: f64,
    ticks_in_candle: u32,
};

pub fn init(token_id: u32, anchor: f64, base_volatility: f64, rug_chance: f64) PriceState {
    const bucket = bucketFor(anchor);
    const band = bandParamsFor(bucket);
    return .{
        .token_id = token_id,
        .anchor = anchor,
        .current = anchor,
        .pattern = .crab,
        .pattern_progress = 0,
        .base_volatility = base_volatility,
        .rug_chance_per_tick = rug_chance,
        .is_rugged = false,
        .ath = anchor,
        .atl = anchor,
        .bucket = bucket,
        .band_low = anchor * band.dump_floor,
        .band_high = anchor * band.pump_cap,
        .band_pull = band.pull_strength,
        .candles = undefined,
        .candle_count = 0,
        .candle_head = 0,
        .current_open = anchor,
        .current_high = anchor,
        .current_low = anchor,
        .ticks_in_candle = 0,
    };
}

pub fn bandBias(s: *const PriceState) f64 {
    if (s.current >= s.anchor) {
        if (s.band_high <= s.anchor) return 0;
        const dist = (s.current - s.anchor) / (s.band_high - s.anchor);
        return -@min(dist, 1.0) * s.band_pull;
    } else {
        if (s.band_low >= s.anchor) return 0;
        const dist = (s.anchor - s.current) / (s.anchor - s.band_low);
        return @min(dist, 1.0) * s.band_pull;
    }
}

fn pickNextPattern(rng: *Rng) PricePattern {
    const r = rng.float();
    if (r < 0.45) return .crab;
    if (r < 0.65) return .pump;
    if (r < 0.80) return .dump;
    if (r < 0.90) return .organic_up;
    if (r < 0.97) return .organic_down;
    return .@"volatile";
}

pub fn advancePattern(s: *PriceState, rng: *Rng, difficulty: f64) bool {
    if (s.is_rugged) return false;
    if (rng.float() < s.rug_chance_per_tick * difficulty) {
        s.is_rugged = true;
        s.pattern = .rug;
        return true;
    }
    s.pattern_progress += 0.01;
    if (s.pattern_progress >= 1.0) {
        s.pattern_progress = 0;
        s.pattern = pickNextPattern(rng);
    }
    return false;
}

pub fn aggregateCandle(s: *PriceState, tick_count: u64) void {
    if (s.is_rugged and s.ticks_in_candle == 0) return;
    if (s.ticks_in_candle == 0) {
        s.current_open = s.current;
        s.current_high = s.current;
        s.current_low = s.current;
    } else {
        if (s.current > s.current_high) s.current_high = s.current;
        if (s.current < s.current_low) s.current_low = s.current;
    }
    s.ticks_in_candle += 1;
    if (s.ticks_in_candle >= CANDLE_TICKS) {
        const c: Candle = .{
            .t = tick_count,
            .o = s.current_open,
            .h = s.current_high,
            .l = s.current_low,
            .c = s.current,
        };
        s.candles[s.candle_head] = c;
        s.candle_head = (s.candle_head + 1) % @as(u32, CANDLE_CAP);
        if (s.candle_count < CANDLE_CAP) s.candle_count += 1;
        s.ticks_in_candle = 0;
    }
}
