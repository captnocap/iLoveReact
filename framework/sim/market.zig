//! sim/market.zig — global market mood that biases every token tick.

const std = @import("std");
const Rng = @import("rng.zig").Rng;

pub const BtcTrend = enum(u8) { bull, bear, crab };

pub const MarketState = struct {
    btc_trend: BtcTrend,
    btc_volatility: f64,
    fear_greed: f64,
    trend_age_ticks: u32,
};

pub fn init() MarketState {
    return .{
        .btc_trend = .crab,
        .btc_volatility = 0.3,
        .fear_greed = 50,
        .trend_age_ticks = 0,
    };
}

pub fn tickMarket(m: *MarketState, rng: *Rng) void {
    m.trend_age_ticks += 1;
    const flip_chance = 0.0008 + @as(f64, m.trend_age_ticks) * 0.000002;
    if (rng.float() < flip_chance) {
        const r = rng.float();
        m.btc_trend = if (r < 0.4) .bull else if (r < 0.75) .crab else .bear;
        m.trend_age_ticks = 0;
    }
    m.btc_volatility += rng.signed() * 0.01;
    if (m.btc_volatility < 0.05) m.btc_volatility = 0.05;
    if (m.btc_volatility > 1.0) m.btc_volatility = 1.0;
    const target: f64 = switch (m.btc_trend) {
        .bull => 70,
        .bear => 30,
        .crab => 50,
    };
    m.fear_greed += (target - m.fear_greed) * 0.005 + rng.signed() * 0.6;
    if (m.fear_greed < 0) m.fear_greed = 0;
    if (m.fear_greed > 100) m.fear_greed = 100;
}
