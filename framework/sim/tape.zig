//! sim/tape.zig — synthetic NPC order flow.

const std = @import("std");
const Rng = @import("rng.zig").Rng;
const price_mod = @import("price.zig");
const pool_mod = @import("pool.zig");
const market_mod = @import("market.zig");

pub const TapeEntry = struct {
    id: u32,
    kind: u8, // 'b' or 's'
    sym: [12]u8,
    sym_len: u8,
    base: f64,
    usd: f64,
    price: f64,
    impact: f64,
    t: u64,
};

pub const TAPE_BUF: usize = 2048;

pub const Tape = struct {
    entries: [TAPE_BUF]TapeEntry,
    count: u32,

    pub fn reset(self: *Tape) void {
        self.count = 0;
    }

    fn push(self: *Tape, e: TapeEntry) void {
        if (self.count >= TAPE_BUF) return;
        self.entries[self.count] = e;
        self.count += 1;
    }
};

fn patternBuyBias(p: price_mod.PricePattern) f64 {
    return switch (p) {
        .crab         => 0.50,
        .pump         => 0.68,
        .dump         => 0.32,
        .organic_up   => 0.56,
        .organic_down => 0.44,
        .@"volatile"  => 0.50,
        .rug          => 0.05,
    };
}

fn marketBias(trend: market_mod.BtcTrend) f64 {
    return switch (trend) {
        .bull => 0.04,
        .bear => -0.04,
        .crab => 0.0,
    };
}

pub fn singleTrade(
    token_id: u32,
    sym: []const u8,
    price: *price_mod.PriceState,
    pool: *pool_mod.Pool,
    market: *const market_mod.MarketState,
    rng: *Rng,
    force_buy: ?bool,
    frac_override: ?f64,
    tape: *Tape,
) bool {
    if (pool.is_rugged or price.is_rugged) return false;

    var bias = patternBuyBias(price.pattern)
        + marketBias(market.btc_trend)
        + price_mod.bandBias(price);
    if (bias < 0.05) bias = 0.05;
    if (bias > 0.95) bias = 0.95;
    const buy = force_buy orelse (rng.float() < bias);

    const heat_scale: f64 = switch (price.pattern) {
        .@"volatile" => 3.0,
        .pump, .dump => 1.5,
        else => 1.0,
    };
    const natural_size_scale = price.base_volatility * heat_scale * (0.3 + market.btc_volatility * 1.5);
    const vol_component = price.base_volatility * 1.5;
    const pattern_bonus: f64 = switch (price.pattern) {
        .@"volatile" => 0.10,
        .pump, .dump => 0.05,
        else         => 0.0,
    };
    const max_frac = @max(0.001, vol_component + pattern_bonus);
    const r1 = rng.float();
    const r2 = rng.float();
    const frac_factor = r1 * r2;
    const frac = frac_override orelse (frac_factor * max_frac * natural_size_scale);

    var e: TapeEntry = .{
        .id = token_id,
        .kind = 0,
        .sym = [_]u8{0} ** 12,
        .sym_len = 0,
        .base = 0, .usd = 0, .price = 0, .impact = 0, .t = 0,
    };
    const nlen = @min(sym.len, e.sym.len);
    @memcpy(e.sym[0..nlen], sym[0..nlen]);
    e.sym_len = @intCast(nlen);

    if (buy) {
        const usd_in = pool.reserve_quote * frac;
        if (usd_in <= 0) return false;
        const q = pool_mod.executeBuy(pool, usd_in);
        if (q.output <= 0) return false;
        e.kind = 'b';
        e.usd = usd_in;
        e.base = q.output;
        e.price = q.effective_price;
        e.impact = q.price_impact;
    } else {
        const base_in = pool.reserve_base * frac;
        if (base_in <= 0) return false;
        const q = pool_mod.executeSell(pool, base_in);
        if (q.output <= 0) return false;
        e.kind = 's';
        e.base = base_in;
        e.usd = q.output;
        e.price = q.effective_price;
        e.impact = q.price_impact;
    }
    tape.push(e);

    price.current = pool_mod.spotPrice(pool);
    if (price.current > price.ath) price.ath = price.current;
    if (price.current < price.atl) price.atl = price.current;
    return true;
}

pub fn baseRatePerSec(p: price_mod.PricePattern) f32 {
    return switch (p) {
        .pump         => 5.0,
        .dump         => 3.0,
        .@"volatile"  => 8.0,
        .crab         => 0.6,
        .organic_up   => 1.2,
        .organic_down => 1.0,
        .rug          => 0.1,
    };
}
