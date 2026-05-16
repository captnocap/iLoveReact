//! sim/basecoin.zig — first-class base-coin assets.

const std = @import("std");
const Rng = @import("rng.zig").Rng;

pub const BaseCoinId = u8;

pub const BaseCoinArchetype = enum(u8) {
    bitcoin,
    ethereum,
    altcoin_l1,
    altcoin_meme,
    stablecoin,
    privacy,
};

pub const Chain = enum(u8) {
    bitcoin,
    ethereum,
    bsc,
    solana,
    avalanche,
    fantom,
    polygon,
    arbitrum,
    base,
    tron,
    cardano,
    litecoin,
    monero,
};

pub const BaseCoin = struct {
    id: BaseCoinId,
    symbol: [8]u8,
    symbol_len: u8,
    home_chain: Chain,
    archetype: BaseCoinArchetype,
    price_usd: f64,
    target_usd: f64,
    volatility: f32,
    drift_rate: f32,
    correlated_with: ?BaseCoinId,
    correlation: f32,
    last_noise: f64,
};

pub const N_BASE_COINS: usize = 13;

const Seed = struct {
    sym: []const u8,
    chain: Chain,
    archetype: BaseCoinArchetype,
    target: f64,
    vol: f32,
    drift_rate: f32,
    corr_with: ?BaseCoinId,
    corr: f32,
};

const SEEDS = [_]Seed{
    .{ .sym = "BTC",   .chain = .bitcoin,    .archetype = .bitcoin,      .target = 65_000.0, .vol = 0.015, .drift_rate = 0.005, .corr_with = null,    .corr = 0.0 },
    .{ .sym = "ETH",   .chain = .ethereum,   .archetype = .ethereum,     .target =  3_400.0, .vol = 0.025, .drift_rate = 0.005, .corr_with = 0,       .corr = 0.85 },
    .{ .sym = "SOL",   .chain = .solana,     .archetype = .altcoin_l1,   .target =    180.0, .vol = 0.045, .drift_rate = 0.005, .corr_with = 1,       .corr = 0.70 },
    .{ .sym = "BNB",   .chain = .bsc,        .archetype = .altcoin_meme, .target =    620.0, .vol = 0.035, .drift_rate = 0.005, .corr_with = 0,       .corr = 0.65 },
    .{ .sym = "AVAX",  .chain = .avalanche,  .archetype = .altcoin_l1,   .target =     40.0, .vol = 0.050, .drift_rate = 0.005, .corr_with = 1,       .corr = 0.75 },
    .{ .sym = "FTM",   .chain = .fantom,     .archetype = .altcoin_meme, .target =      0.85,.vol = 0.080, .drift_rate = 0.005, .corr_with = 1,       .corr = 0.55 },
    .{ .sym = "ADA",   .chain = .cardano,    .archetype = .altcoin_l1,   .target =      0.55,.vol = 0.040, .drift_rate = 0.005, .corr_with = 0,       .corr = 0.60 },
    .{ .sym = "TRX",   .chain = .tron,       .archetype = .altcoin_meme, .target =      0.15,.vol = 0.040, .drift_rate = 0.005, .corr_with = null,    .corr = 0.0 },
    .{ .sym = "MATIC", .chain = .polygon,    .archetype = .altcoin_l1,   .target =      0.85,.vol = 0.050, .drift_rate = 0.005, .corr_with = 1,       .corr = 0.80 },
    .{ .sym = "LTC",   .chain = .litecoin,   .archetype = .bitcoin,      .target =     85.0, .vol = 0.025, .drift_rate = 0.005, .corr_with = 0,       .corr = 0.70 },
    .{ .sym = "XMR",   .chain = .monero,     .archetype = .privacy,      .target =    160.0, .vol = 0.030, .drift_rate = 0.005, .corr_with = null,    .corr = 0.0 },
    .{ .sym = "USDT",  .chain = .ethereum,   .archetype = .stablecoin,   .target =      1.0, .vol = 0.001, .drift_rate = 0.050, .corr_with = null,    .corr = 0.0 },
    .{ .sym = "USDC",  .chain = .ethereum,   .archetype = .stablecoin,   .target =      1.0, .vol = 0.0005,.drift_rate = 0.080, .corr_with = null,    .corr = 0.0 },
};

pub fn initAll(out: *[N_BASE_COINS]BaseCoin) void {
    inline for (SEEDS, 0..) |s, i| {
        const t = &out[i];
        t.id = @intCast(i);
        t.symbol = [_]u8{0} ** 8;
        const n = @min(s.sym.len, t.symbol.len);
        @memcpy(t.symbol[0..n], s.sym[0..n]);
        t.symbol_len = @intCast(n);
        t.home_chain = s.chain;
        t.archetype = s.archetype;
        t.price_usd = s.target;
        t.target_usd = s.target;
        t.volatility = s.vol;
        t.drift_rate = s.drift_rate;
        t.correlated_with = s.corr_with;
        t.correlation = s.corr;
        t.last_noise = 0;
    }
}

fn eqlIgnoreCase(a: []const u8, b: []const u8) bool {
    if (a.len != b.len) return false;
    for (a, b) |x, y| {
        const xl = if (x >= 'A' and x <= 'Z') x + 32 else x;
        const yl = if (y >= 'A' and y <= 'Z') y + 32 else y;
        if (xl != yl) return false;
    }
    return true;
}

pub fn tickAll(coins: *[N_BASE_COINS]BaseCoin, rng: *Rng) void {
    var raw_noise: [N_BASE_COINS]f64 = undefined;
    var i: usize = 0;
    while (i < N_BASE_COINS) : (i += 1) {
        raw_noise[i] = rng.signed();
    }
    i = 0;
    while (i < N_BASE_COINS) : (i += 1) {
        const c = &coins[i];
        var noise = raw_noise[i];
        if (c.correlated_with) |with_id| {
            if (with_id < N_BASE_COINS) {
                noise = noise * (1.0 - c.correlation) + raw_noise[with_id] * c.correlation;
            }
        }
        c.last_noise = noise;
        const drift = (c.target_usd - c.price_usd) / c.target_usd * c.drift_rate;
        const delta = noise * c.volatility + drift;
        c.price_usd *= (1.0 + delta);
        if (c.price_usd < 0.000001) c.price_usd = 0.000001;
    }
}

pub fn idForSymbol(coins: *const [N_BASE_COINS]BaseCoin, symbol: []const u8) i32 {
    var i: usize = 0;
    while (i < N_BASE_COINS) : (i += 1) {
        const c = &coins[i];
        if (eqlIgnoreCase(c.symbol[0..c.symbol_len], symbol)) return @intCast(i);
    }
    return -1;
}

pub fn usdtId(coins: *const [N_BASE_COINS]BaseCoin) BaseCoinId {
    const id = idForSymbol(coins, "USDT");
    return if (id >= 0) @intCast(id) else 11;
}
