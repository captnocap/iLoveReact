//! sim/root.zig — slimmed orchestrator for the shitcoin sim hot path.
//!
//! Owns: market mood, base coins, tokens (price + AMM pool), NPC roster,
//! player wallet, reactive MEV/copy-trade queue, heat/difficulty, the
//! Poisson per-token tape scheduler, and the live tape ring.
//!
//! Cold systems (staking, upgrades, mining, lp, favors, web, cex, social,
//! telegram, forums, news, alpha, reputation) live in TS and apply their
//! results back through the `apply_*` mutators below.

const std = @import("std");
const host_io = @import("../host_io.zig");
const Rng = @import("rng.zig").Rng;
const market_mod = @import("market.zig");
const basecoin_mod = @import("basecoin.zig");
const price_mod = @import("price.zig");
const pool_mod = @import("pool.zig");
const tape_mod = @import("tape.zig");
const wallet_mod = @import("wallet.zig");
const npc_mod = @import("npc.zig");
const v8_runtime = @import("../v8_runtime.zig");

const MAX_TOKENS: usize = 256;

const Token = struct {
    price: price_mod.PriceState,
    pool: pool_mod.Pool,
    symbol: [12]u8,
    symbol_len: u8,
    home_chain: basecoin_mod.Chain,
    next_event_at_ms: u32,
    rate_boost: f32,
    boost_decay_at_ms: u32,
};

fn chainPoolDepthUsd(chain: basecoin_mod.Chain) f64 {
    return switch (chain) {
        .ethereum  => 300_000.0,
        .bsc       => 80_000.0,
        .solana    => 100_000.0,
        .arbitrum  => 60_000.0,
        .base      => 40_000.0,
        .polygon   => 50_000.0,
        .avalanche => 30_000.0,
        .tron      => 20_000.0,
        .cardano   => 10_000.0,
        .fantom    => 8_000.0,
        .bitcoin   => 100_000.0,
        .litecoin  => 5_000.0,
        .monero    => 2_000.0,
    };
}

fn chainFromRoll(roll: f64) basecoin_mod.Chain {
    const r = roll;
    return if (r < 0.25) .bsc
        else if (r < 0.45) .ethereum
        else if (r < 0.65) .solana
        else if (r < 0.75) .polygon
        else if (r < 0.80) .arbitrum
        else if (r < 0.85) .base
        else if (r < 0.90) .avalanche
        else if (r < 0.95) .fantom
        else .tron;
}

const SimState = struct {
    rng: Rng,
    market: market_mod.MarketState,
    base_coins: [basecoin_mod.N_BASE_COINS]basecoin_mod.BaseCoin,
    tokens: [MAX_TOKENS]Token,
    token_count: u32,
    npcs: [npc_mod.NPC_ROSTER_SIZE]npc_mod.Npc,
    run_id: u64,
    wallet: wallet_mod.WalletState,
    tape: tape_mod.Tape,
    real_time_ms: u64,
    tick_count: u64,
    initialized: bool,
    seeded: bool,
};

var g_state: SimState = .{
    .rng = undefined,
    .market = undefined,
    .base_coins = undefined,
    .tokens = undefined,
    .token_count = 0,
    .npcs = undefined,
    .run_id = 0,
    .wallet = undefined,
    .tape = .{ .entries = undefined, .count = 0 },
    .real_time_ms = 0,
    .tick_count = 0,
    .initialized = false,
    .seeded = false,
};

const SeedToken = struct {
    sym: []const u8,
};
const DEFAULT_SEEDS = [_]SeedToken{
    .{ .sym = "SHIT"  },
    .{ .sym = "DEGEN" },
    .{ .sym = "MOON"  },
    .{ .sym = "RUG"   },
    .{ .sym = "WGMI"  },
};

const STARTUP_TOKEN_COUNT: usize = 256;

const SYL_A = [_][]const u8{ "SH", "DEG", "MO", "RUG", "WG", "PUMP", "DUMP", "BAG", "APE", "FOMO", "CHAD", "REKT", "MEME", "TURBO", "ULTRA", "MAXI", "MINI", "GIGA", "NANO", "BASED", "CRINGE", "WAGMI", "NGMI", "HODL", "DIP", "FLIP", "GAS", "RUG", "SAFE", "MOON" };
const SYL_B = [_][]const u8{ "INU", "DOGE", "CAT", "FROG", "PEPE", "ELON", "MARS", "JUP", "SOL", "ETH", "BTC", "XYZ", "COIN", "TKN", "CASH", "GOLD", "FUD", "FOMO", "GANG", "LORD", "KING", "QUEEN", "BOY", "GIRL", "BRO", "SIS", "OG", "WIF", "HAT", "" };

fn seedOne(i: usize) void {
    const t = &g_state.tokens[i];
    t.symbol = [_]u8{0} ** 12;
    var sym_len: usize = 0;

    if (i < DEFAULT_SEEDS.len) {
        const sym = DEFAULT_SEEDS[i].sym;
        sym_len = @min(sym.len, t.symbol.len);
        @memcpy(t.symbol[0..sym_len], sym[0..sym_len]);
    } else {
        const a = SYL_A[i % SYL_A.len];
        const b = SYL_B[(i * 7) % SYL_B.len];
        const an = @min(a.len, t.symbol.len);
        @memcpy(t.symbol[0..an], a[0..an]);
        sym_len = an;
        const remaining = t.symbol.len - sym_len;
        const bn = @min(b.len, remaining);
        @memcpy(t.symbol[sym_len .. sym_len + bn], b[0..bn]);
        sym_len += bn;
    }

    const seed: u64 = g_state.run_id ^ 0xA5A5_C0DE_0000_0000 ^ @as(u64, @intCast(i));
    var r = Rng.init(seed);
    const a_class = r.float();
    const anchor: f64 = if (a_class < 0.25) 0.000001 + r.float() * 0.0001
        else if (a_class < 0.6)  0.001  + r.float() * 0.5
        else                     0.5    + r.float() * 4.5;
    const bv: f64 = 0.02 + r.float() * 0.10;
    const rug: f64 = r.float() * r.float() * 0.0005;
    const chain_roll = r.float();
    const home_chain: basecoin_mod.Chain = chainFromRoll(chain_roll);
    const chain_baseline = chainPoolDepthUsd(home_chain);
    const is_blue_chip = r.float() < 0.05;
    const variance = if (is_blue_chip)
        5.0 + r.float() * 10.0
    else
        0.3 + r.float() * 1.4;
    const pq: f64 = chain_baseline * variance;
    const pb: f64 = pq / anchor;
    t.price = price_mod.init(@intCast(i), anchor, bv, rug);
    t.home_chain = home_chain;
    const usdt_id = basecoin_mod.usdtId(&g_state.base_coins);
    const supply_seed: u64 = g_state.run_id ^ 0xB1_5AF_E000_0000 ^ @as(u64, @intCast(i));
    var supply_rng = Rng.init(supply_seed);
    const supply_class = supply_rng.float();
    const supply_multiplier: f64 = if (supply_class < 0.20)
        2.0 + supply_rng.float() * 3.0
    else if (supply_class < 0.80)
        5.0 + supply_rng.float() * 15.0
    else
        20.0 + supply_rng.float() * 80.0;
    const circulating = pb * supply_multiplier;
    t.pool = pool_mod.initPool(@intCast(i), usdt_id, pb, pq, 0.003, circulating);
    t.symbol_len = @intCast(sym_len);
    const now32: u32 = if (g_state.real_time_ms > std.math.maxInt(u32))
        std.math.maxInt(u32)
    else
        @intCast(g_state.real_time_ms);
    t.next_event_at_ms = now32 + @as(u32, @intCast(i * 37 % 1000));
    t.rate_boost = 1.0;
    t.boost_decay_at_ms = now32;
}

fn seedN(n_in: usize) void {
    const n = @min(n_in, MAX_TOKENS);
    g_state.token_count = 0;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        seedOne(i);
        g_state.token_count += 1;
    }
    g_state.seeded = true;
}

fn freshRunId() u64 {
    var bytes: [8]u8 = undefined;
    host_io.io().random(&bytes);
    return std.mem.readInt(u64, &bytes, .little);
}

fn primeState() void {
    if (g_state.run_id == 0) g_state.run_id = freshRunId();
    g_state.rng = Rng.init(g_state.run_id);
    g_state.market = market_mod.init();
    basecoin_mod.initAll(&g_state.base_coins);
    g_state.wallet = wallet_mod.init(1000.0);
    if (!g_state.seeded) seedN(STARTUP_TOKEN_COUNT) else {
        seedN(g_state.token_count);
    }
    npc_mod.initRoster(&g_state.npcs, &g_state.rng);
}

fn ensureInit() void {
    if (g_state.initialized) return;
    primeState();
    g_live_read = 0;
    g_live_write = 0;
    g_state.initialized = true;
    emitTokensInit();
    emitPlayerInit();
    emitNpcInit();
}

// ── Live tape ring ──────────────────────────────────────────────────────

const LIVE_RING_SIZE: u32 = 16384;

const LiveTapeEvent = struct {
    real_ms: u32,
    id: u16,
    kind: u8,  // 'b', 's', or 'r'
    pat: u8,
    base: f32,
    usd: f32,
    price: f32,
    impact: f32,
    pool_base: f32,
    pool_quote: f32,
    wallet_id: u32,
};

var g_live_ring: [LIVE_RING_SIZE]LiveTapeEvent = undefined;
var g_live_write: u32 = 0;
var g_live_read: u32 = 0;

fn ringAppend(ev: LiveTapeEvent) void {
    g_live_ring[g_live_write % LIVE_RING_SIZE] = ev;
    g_live_write += 1;
    if (g_live_write - g_live_read > LIVE_RING_SIZE) {
        g_live_read = g_live_write - LIVE_RING_SIZE;
    }
}

// ── Game-time scale ─────────────────────────────────────────────────────

const GAME_DAY_MS: u32 = 60_000;
pub const GAME_HOUR_MS: u32 = GAME_DAY_MS / 24;
const MARKET_TICK_MS: u32 = GAME_HOUR_MS * 2;
const PATTERN_TICK_MS: u32 = GAME_DAY_MS / 100;
var g_market_accum_ms: u32 = 0;
var g_pattern_accum_ms: u32 = 0;
var g_sim_tick_n: u64 = 0;
const VOLUME_DECAY_PER_MARKET_TICK: f64 = blk: {
    const ratio = @as(f64, MARKET_TICK_MS) / @as(f64, GAME_DAY_MS);
    break :blk std.math.pow(f64, 0.5, ratio);
};

const MAX_TPS_GLOBAL: u32 = 60;
var g_tps_window_start_ms: u32 = 0;
var g_tps_count: u32 = 0;

var g_heat: f64 = 0.0;
var g_difficulty: f64 = 1.0;

fn recomputeHeat() void {
    const w = &g_state.wallet;
    const usd = if (w.total_value_usd > 1000.0) w.total_value_usd else 1000.0;
    const trades_f: f64 = @floatFromInt(w.total_trades);
    const usd_factor = std.math.log10(usd / 1000.0);
    const trade_factor = trades_f / 200.0;
    g_heat = @max(0.0, usd_factor + trade_factor * 0.5);
    const d_raw = 1.0 + g_heat * 0.30;
    g_difficulty = @min(d_raw, 3.0);
}

// ── Reactive event queue ────────────────────────────────────────────────

const ReactEventKind = enum(u8) {
    arb_buy,
    arb_sell,
    copy_buy,
    copy_sell,
};

const ReactEvent = struct {
    fire_at_ms: u32,
    kind: ReactEventKind,
    token_id: u32,
    size_hint: f64,
};

const REACT_QUEUE_SIZE: usize = 1024;
var g_react_queue: [REACT_QUEUE_SIZE]ReactEvent = undefined;
var g_react_count: u32 = 0;

fn reactQueuePush(ev: ReactEvent) void {
    if (g_react_count >= REACT_QUEUE_SIZE) return;
    g_react_queue[g_react_count] = ev;
    g_react_count += 1;
}

fn reactQueueRemoveAt(i: u32) void {
    g_react_count -= 1;
    if (i < g_react_count) g_react_queue[i] = g_react_queue[g_react_count];
}

fn onTradeExecuted(token_id: u32, kind: u8, usd_amount: f64, impact: f64) void {
    const now32: u32 = if (g_state.real_time_ms > std.math.maxInt(u32))
        std.math.maxInt(u32)
    else
        @intCast(g_state.real_time_ms);

    if (impact > 0.005) {
        const heat_bots: u32 = if (g_difficulty > 1.8) 1 else 0;
        const base_n: u32 = 1 + g_state.rng.prng.random().intRangeAtMost(u32, 0, 1);
        const n_bots: u32 = base_n + heat_bots;
        const total_capture_target = @min(impact * (0.25 + g_difficulty * 0.05), impact * 0.45);
        const per_bot_size = total_capture_target / @as(f64, @floatFromInt(n_bots));
        var i: u32 = 0;
        while (i < n_bots) : (i += 1) {
            const delay = 20 + g_state.rng.prng.random().intRangeAtMost(u32, 0, 230);
            const jitter = 0.7 + g_state.rng.float() * 0.6;
            reactQueuePush(.{
                .fire_at_ms = now32 + delay,
                .kind = if (kind == 'b') .arb_sell else .arb_buy,
                .token_id = token_id,
                .size_hint = per_bot_size * jitter,
            });
        }
    }

    if (usd_amount > 5_000.0) {
        if (token_id < g_state.token_count) {
            const t = &g_state.tokens[token_id];
            const boost = @as(f32, @floatCast(@min(usd_amount / 5000.0, 6.0)));
            if (boost > t.rate_boost) t.rate_boost = boost;
            const decay_ms: u32 = @intFromFloat(@min(usd_amount * 5.0, 60_000.0));
            t.boost_decay_at_ms = now32 + decay_ms;
        }
    }

    if (usd_amount > 50_000.0) {
        const base_followers: u32 = 3 + g_state.rng.prng.random().intRangeAtMost(u32, 0, 4);
        const heat_followers: u32 = @intFromFloat(g_difficulty * 1.0);
        const followers: u32 = base_followers + heat_followers;
        var i: u32 = 0;
        while (i < followers) : (i += 1) {
            const delay = 500 + g_state.rng.prng.random().intRangeAtMost(u32, 0, 4000);
            const follower_frac = impact * (0.05 + g_state.rng.float() * 0.15);
            reactQueuePush(.{
                .fire_at_ms = now32 + delay,
                .kind = if (kind == 'b') .copy_buy else .copy_sell,
                .token_id = token_id,
                .size_hint = follower_frac,
            });
        }
    }
}

fn fireReactEvent(ev: *const ReactEvent, local_tape: *tape_mod.Tape) void {
    if (ev.token_id >= g_state.token_count) return;
    const t = &g_state.tokens[ev.token_id];
    const force_buy: bool = switch (ev.kind) {
        .arb_buy, .copy_buy => true,
        .arb_sell, .copy_sell => false,
    };
    local_tape.count = 0;
    const fired = tape_mod.singleTrade(
        ev.token_id,
        t.symbol[0..t.symbol_len],
        &t.price,
        &t.pool,
        &g_state.market,
        &g_state.rng,
        force_buy,
        ev.size_hint,
        local_tape,
    );
    if (!fired) return;
    var k: u32 = 0;
    while (k < local_tape.count) : (k += 1) {
        const e = &local_tape.entries[k];
        const real_ms_u32: u32 = if (g_state.real_time_ms > std.math.maxInt(u32))
            std.math.maxInt(u32)
        else
            @intCast(g_state.real_time_ms);
        ringAppend(.{
            .real_ms = real_ms_u32,
            .id = @intCast(ev.token_id),
            .kind = e.kind,
            .pat = @intFromEnum(t.price.pattern),
            .base = @floatCast(e.base),
            .usd = @floatCast(e.usd),
            .price = @floatCast(e.price),
            .impact = @floatCast(e.impact),
            .pool_base = @floatCast(t.pool.reserve_base),
            .pool_quote = @floatCast(t.pool.reserve_quote),
            .wallet_id = 0,
        });
    }
}

fn scheduleNextEvent(t: *Token, now_ms: u32) void {
    var u = g_state.rng.float();
    if (u < 0.000001) u = 0.000001;
    const base_rate = tape_mod.baseRatePerSec(t.price.pattern);
    if (now_ms >= t.boost_decay_at_ms) {
        t.rate_boost = 1.0;
    } else {
        const remaining = @as(f32, @floatFromInt(t.boost_decay_at_ms - now_ms));
        const total = @max(remaining, 1.0);
        t.rate_boost = @max(1.0, t.rate_boost - (t.rate_boost - 1.0) * (1.0 - total / 60_000.0));
    }
    const rate = base_rate * t.rate_boost;
    if (rate <= 0) {
        t.next_event_at_ms = now_ms + 60_000;
        return;
    }
    const interval_s: f64 = -std.math.log(f64, std.math.e, u) / rate;
    var interval_ms: u32 = @intFromFloat(@max(interval_s * 1000.0, 1.0));
    if (interval_ms > 60_000) interval_ms = 60_000;
    t.next_event_at_ms = now_ms + interval_ms;
}

// ── Init emits (one-shot JSON payloads for cart-side string maps) ──────

fn emit(channel: []const u8, payload: []const u8) void {
    var chan_arr: std.ArrayList(u8) = .empty;
    defer chan_arr.deinit(std.heap.c_allocator);
    chan_arr.appendSlice(std.heap.c_allocator, channel) catch return;
    chan_arr.append(std.heap.c_allocator, 0) catch return;
    const chan_z = chan_arr.items[0 .. chan_arr.items.len - 1 :0];

    var payload_arr: std.ArrayList(u8) = .empty;
    defer payload_arr.deinit(std.heap.c_allocator);
    payload_arr.appendSlice(std.heap.c_allocator, payload) catch return;
    payload_arr.append(std.heap.c_allocator, 0) catch return;
    const payload_z = payload_arr.items[0 .. payload_arr.items.len - 1 :0];

    v8_runtime.callGlobal2Str("__ffiEmit", chan_z, payload_z);
}

fn emitTokensInit() void {
    var payload: [16384]u8 = undefined;
    var pos: usize = 0;
    payload[pos] = '['; pos += 1;
    var i: u32 = 0;
    while (i < g_state.token_count) : (i += 1) {
        if (i > 0) { payload[pos] = ','; pos += 1; }
        const t = &g_state.tokens[i];
        const sym = t.symbol[0..t.symbol_len];
        const w = std.fmt.bufPrint(payload[pos..],
            "{{\"id\":{d},\"sym\":\"{s}\"}}",
            .{ i, sym },
        ) catch return;
        pos += w.len;
        if (pos + 64 >= payload.len) break;
    }
    if (pos + 1 >= payload.len) return;
    payload[pos] = ']'; pos += 1;
    emit("sim:tokens", payload[0..pos]);
}

fn emitPlayerInit() void {
    var payload: [128]u8 = undefined;
    const addr = g_state.wallet.address;
    const hex = "0123456789abcdef";
    var pos: usize = 0;
    const head = "{\"address\":\"0x";
    @memcpy(payload[pos .. pos + head.len], head);
    pos += head.len;
    for (addr) |byte| {
        payload[pos] = hex[byte >> 4];
        payload[pos + 1] = hex[byte & 0xf];
        pos += 2;
    }
    const tail = "\"}";
    @memcpy(payload[pos .. pos + tail.len], tail);
    pos += tail.len;
    emit("sim:player", payload[0..pos]);
}

fn emitNpcInit() void {
    var payload: [16384]u8 = undefined;
    var pos: usize = 0;
    payload[pos] = '['; pos += 1;
    const hex = "0123456789abcdef";
    var i: usize = 0;
    while (i < npc_mod.NPC_ROSTER_SIZE) : (i += 1) {
        if (pos + 96 >= payload.len) break;
        if (i > 0) { payload[pos] = ','; pos += 1; }
        const npc = &g_state.npcs[i];
        const head = "{\"id\":";
        @memcpy(payload[pos .. pos + head.len], head);
        pos += head.len;
        const id_str = std.fmt.bufPrint(payload[pos..], "{d}", .{npc.id}) catch return;
        pos += id_str.len;
        const addr_pre = ",\"address\":\"0x";
        @memcpy(payload[pos .. pos + addr_pre.len], addr_pre);
        pos += addr_pre.len;
        for (npc.address) |byte| {
            payload[pos] = hex[byte >> 4];
            payload[pos + 1] = hex[byte & 0xf];
            pos += 2;
        }
        const prof_pre = "\",\"profile\":\"";
        @memcpy(payload[pos .. pos + prof_pre.len], prof_pre);
        pos += prof_pre.len;
        const pname = @tagName(npc.profile);
        @memcpy(payload[pos .. pos + pname.len], pname);
        pos += pname.len;
        const tail = "\"}";
        @memcpy(payload[pos .. pos + tail.len], tail);
        pos += tail.len;
    }
    if (pos + 1 >= payload.len) return;
    payload[pos] = ']'; pos += 1;
    emit("sim:npcs:init", payload[0..pos]);
}

// ── Tick ────────────────────────────────────────────────────────────────

pub fn tick(dt_ms: u32) void {
    ensureInit();
    g_state.real_time_ms += dt_ms;

    const now_ms: u32 = if (g_state.real_time_ms > std.math.maxInt(u32))
        std.math.maxInt(u32)
    else
        @intCast(g_state.real_time_ms);

    recomputeHeat();

    var local_tape: tape_mod.Tape = .{ .entries = undefined, .count = 0 };

    g_market_accum_ms += dt_ms;
    while (g_market_accum_ms >= MARKET_TICK_MS) {
        g_market_accum_ms -= MARKET_TICK_MS;
        market_mod.tickMarket(&g_state.market, &g_state.rng);
        basecoin_mod.tickAll(&g_state.base_coins, &g_state.rng);
        var vi: u32 = 0;
        while (vi < g_state.token_count) : (vi += 1) {
            pool_mod.decayVolume(&g_state.tokens[vi].pool, VOLUME_DECAY_PER_MARKET_TICK);
        }
    }

    g_pattern_accum_ms += dt_ms;
    while (g_pattern_accum_ms >= PATTERN_TICK_MS) {
        g_pattern_accum_ms -= PATTERN_TICK_MS;
        g_sim_tick_n += 1;
        var i: u32 = 0;
        while (i < g_state.token_count) : (i += 1) {
            const t = &g_state.tokens[i];
            const rugged = price_mod.advancePattern(&t.price, &g_state.rng, g_difficulty);
            if (rugged) {
                t.pool.is_rugged = true;
                t.pool.reserve_quote *= 0.02;
                t.price.current = pool_mod.spotPrice(&t.pool);
                ringAppend(.{
                    .real_ms = now_ms,
                    .id = @intCast(i),
                    .kind = 'r',
                    .pat = @intFromEnum(t.price.pattern),
                    .base = 0,
                    .usd = 0,
                    .price = @floatCast(t.price.current),
                    .impact = 0,
                    .pool_base = @floatCast(t.pool.reserve_base),
                    .pool_quote = @floatCast(t.pool.reserve_quote),
                    .wallet_id = 0,
                });
            }
            price_mod.aggregateCandle(&t.price, g_sim_tick_n);
        }
        g_state.tick_count = g_sim_tick_n;
    }

    if (now_ms - g_tps_window_start_ms >= 1000) {
        g_tps_window_start_ms = now_ms;
        g_tps_count = 0;
    }

    var qi: u32 = 0;
    while (qi < g_react_count) {
        const ev = &g_react_queue[qi];
        if (ev.fire_at_ms <= now_ms) {
            const copy = ev.*;
            reactQueueRemoveAt(qi);
            fireReactEvent(&copy, &local_tape);
            g_tps_count += 1;
        } else {
            qi += 1;
        }
    }

    var i: u32 = 0;
    while (i < g_state.token_count) : (i += 1) {
        const t = &g_state.tokens[i];
        while (t.next_event_at_ms <= now_ms) {
            if (t.pool.is_rugged or t.price.is_rugged) {
                t.next_event_at_ms = now_ms + 30_000 +
                    g_state.rng.prng.random().intRangeAtMost(u32, 0, 30_000);
                break;
            }
            if (g_tps_count >= MAX_TPS_GLOBAL) {
                t.next_event_at_ms = g_tps_window_start_ms + 1000 +
                    g_state.rng.prng.random().intRangeAtMost(u32, 0, 200);
                break;
            }
            local_tape.count = 0;
            const fired = tape_mod.singleTrade(
                i,
                t.symbol[0..t.symbol_len],
                &t.price,
                &t.pool,
                &g_state.market,
                &g_state.rng,
                null,
                null,
                &local_tape,
            );
            if (fired and local_tape.count > 0) {
                g_tps_count += 1;
                const e = &local_tape.entries[0];
                const npc_opt = npc_mod.pickForTrade(
                    &g_state.npcs,
                    e.kind == 'b',
                    @floatCast(e.usd),
                    &g_state.rng,
                );
                const wallet_id: u32 = if (npc_opt) |npc| blk: {
                    if (e.kind == 'b') {
                        npc_mod.onBuy(npc, i, @floatCast(e.usd), @floatCast(e.base));
                    } else {
                        npc_mod.onSell(npc, i, @floatCast(e.base), @floatCast(e.usd));
                    }
                    break :blk npc.id;
                } else 0;
                ringAppend(.{
                    .real_ms = now_ms,
                    .id = @intCast(i),
                    .kind = e.kind,
                    .pat = @intFromEnum(t.price.pattern),
                    .base = @floatCast(e.base),
                    .usd = @floatCast(e.usd),
                    .price = @floatCast(e.price),
                    .impact = @floatCast(e.impact),
                    .pool_base = @floatCast(t.pool.reserve_base),
                    .pool_quote = @floatCast(t.pool.reserve_quote),
                    .wallet_id = wallet_id,
                });
                if (e.usd > 5_000.0 or e.impact > 0.01) {
                    onTradeExecuted(i, e.kind, e.usd, e.impact);
                }
            }
            scheduleNextEvent(t, now_ms);
        }
    }
}

// ── Snapshot rows + getters (consumed by sim.ts via __zig_call) ─────────

const DRAIN_TAPE_MAX: u32 = 128;

pub const TapeRow = struct {
    id: u32,
    kind: u32,    // 0=buy, 1=sell, 2=rug
    pat: u32,
    base: f64,
    usd: f64,
    price: f64,
    impact: f64,
    wallet_id: u32,
};

var g_drain_buf: [DRAIN_TAPE_MAX]TapeRow = undefined;

pub fn drain_tape(max: u32) []const TapeRow {
    ensureInit();
    const limit = @min(max, @as(u32, DRAIN_TAPE_MAX));
    var n: u32 = 0;
    while (n < limit and g_live_read < g_live_write) {
        const ev = &g_live_ring[g_live_read % LIVE_RING_SIZE];
        g_live_read += 1;
        const kind_n: u32 = switch (ev.kind) {
            'b' => 0,
            's' => 1,
            else => 2,
        };
        g_drain_buf[n] = .{
            .id = @intCast(ev.id),
            .kind = kind_n,
            .pat = @intCast(ev.pat),
            .base = @floatCast(ev.base),
            .usd = @floatCast(ev.usd),
            .price = @floatCast(ev.price),
            .impact = @floatCast(ev.impact),
            .wallet_id = ev.wallet_id,
        };
        n += 1;
    }
    return g_drain_buf[0..n];
}

pub const PriceRow = struct {
    id: u32,
    price: f64,
    pat: u32,
    rug: u32,
    ath: f64,
    atl: f64,
    market_cap_usd: f64,
    volume_usd: f64,
    liquidity_usd: f64,
};

var g_price_buf: [MAX_TOKENS]PriceRow = undefined;

pub fn snapshot_prices() []const PriceRow {
    ensureInit();
    const n = @min(g_state.token_count, @as(u32, g_price_buf.len));
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const t = &g_state.tokens[i];
        const base_usd: f64 = 1.0;
        g_price_buf[i] = .{
            .id = i,
            .price = t.price.current,
            .pat = @intFromEnum(t.price.pattern),
            .rug = if (t.price.is_rugged) 1 else 0,
            .ath = t.price.ath,
            .atl = t.price.atl,
            .market_cap_usd = pool_mod.marketCapUsd(&t.pool, base_usd),
            .volume_usd = t.pool.volume_24h * base_usd,
            .liquidity_usd = t.pool.reserve_quote * base_usd * 2.0,
        };
    }
    return g_price_buf[0..n];
}

pub const MarketRow = struct {
    trend: u32,
    vol: f64,
    fg: f64,
    trend_age: u32,
};

pub fn snapshot_market() MarketRow {
    ensureInit();
    return .{
        .trend = @intFromEnum(g_state.market.btc_trend),
        .vol = g_state.market.btc_volatility,
        .fg = g_state.market.fear_greed,
        .trend_age = g_state.market.trend_age_ticks,
    };
}

pub const HeatRow = struct {
    heat: f64,
    difficulty: f64,
};

pub fn snapshot_heat() HeatRow {
    ensureInit();
    return .{ .heat = g_heat, .difficulty = g_difficulty };
}

pub const TimeRow = struct {
    real_ms: f64,
    day: u32,
    hour: u32,
    day_ms: u32,
};

pub fn snapshot_time() TimeRow {
    ensureInit();
    const real: f64 = @floatFromInt(g_state.real_time_ms);
    const day_ms_f: f64 = @floatFromInt(GAME_DAY_MS);
    const total_days = real / day_ms_f;
    const day_n: u32 = 1 + @as(u32, @intFromFloat(@floor(total_days)));
    const frac_of_day = total_days - @floor(total_days);
    const hour_n: u32 = @as(u32, @intFromFloat(frac_of_day * 24.0));
    return .{ .real_ms = real, .day = day_n, .hour = hour_n, .day_ms = GAME_DAY_MS };
}

pub const BaseCoinRow = struct {
    id: u32,
    chain: u32,
    archetype: u32,
    price_usd: f64,
};

var g_basecoin_buf: [basecoin_mod.N_BASE_COINS]BaseCoinRow = undefined;

pub fn snapshot_basecoins() []const BaseCoinRow {
    ensureInit();
    var i: u32 = 0;
    while (i < basecoin_mod.N_BASE_COINS) : (i += 1) {
        const c = &g_state.base_coins[i];
        g_basecoin_buf[i] = .{
            .id = i,
            .chain = @intFromEnum(c.home_chain),
            .archetype = @intFromEnum(c.archetype),
            .price_usd = c.price_usd,
        };
    }
    return g_basecoin_buf[0..basecoin_mod.N_BASE_COINS];
}

pub const WalletSummary = struct {
    usd: f64,
    total_usd: f64,
    start_usd: f64,
    trades: u32,
};

fn priceForCb(token_id: u32) f64 {
    if (token_id >= g_state.token_count) return 0;
    return g_state.tokens[token_id].price.current;
}

pub fn snapshot_wallet() WalletSummary {
    ensureInit();
    wallet_mod.revalue(&g_state.wallet, &priceForCb);
    return .{
        .usd = g_state.wallet.usd,
        .total_usd = g_state.wallet.total_value_usd,
        .start_usd = g_state.wallet.starting_usd,
        .trades = g_state.wallet.total_trades,
    };
}

pub const HoldingRow = struct {
    id: u32,
    amount: f64,
    avg: f64,
    invested: f64,
    upnl: f64,
    rpnl: f64,
};

var g_holdings_buf: [wallet_mod.MAX_HOLDINGS]HoldingRow = undefined;

pub fn snapshot_holdings() []const HoldingRow {
    ensureInit();
    const n = @min(g_state.wallet.holding_count, @as(u32, g_holdings_buf.len));
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const h = &g_state.wallet.holdings[i];
        const cur = priceForCb(h.token_id);
        g_holdings_buf[i] = .{
            .id = h.token_id,
            .amount = h.amount,
            .avg = h.avg_buy_price,
            .invested = h.total_invested,
            .upnl = h.amount * cur - h.total_invested,
            .rpnl = h.realized_pnl,
        };
    }
    return g_holdings_buf[0..n];
}

pub const NpcRow = struct {
    id: u32,
    profile: u32,
    usd_balance: f64,
    starting_usd: f64,
    realized_pnl: f64,
    trade_count: u32,
    holding_count: u32,
    rep_score: f64,
};

const NPC_PAGE_MAX: usize = 128;
var g_npc_page_buf: [NPC_PAGE_MAX]NpcRow = undefined;

pub fn snapshot_npcs(start: u32, count: u32) []const NpcRow {
    ensureInit();
    if (start >= npc_mod.NPC_ROSTER_SIZE) return g_npc_page_buf[0..0];
    const end = @min(@as(usize, start) + @as(usize, count), npc_mod.NPC_ROSTER_SIZE);
    const n = @min(end - @as(usize, start), NPC_PAGE_MAX);
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const src = &g_state.npcs[start + @as(u32, @intCast(i))];
        g_npc_page_buf[i] = .{
            .id = src.id,
            .profile = @intFromEnum(src.profile),
            .usd_balance = src.usd_balance,
            .starting_usd = src.starting_usd,
            .realized_pnl = src.realized_pnl,
            .trade_count = src.trade_count,
            .holding_count = src.holding_count,
            .rep_score = src.rep_score,
        };
    }
    return g_npc_page_buf[0..n];
}

pub fn npc_count() u32 {
    return @intCast(npc_mod.NPC_ROSTER_SIZE);
}

pub fn current_price(token_id: u32) f64 {
    ensureInit();
    if (token_id >= g_state.token_count) return 0;
    return g_state.tokens[token_id].price.current;
}

pub fn token_count() u32 {
    ensureInit();
    return g_state.token_count;
}

pub fn tick_count() f64 {
    return @floatFromInt(g_state.tick_count);
}

pub fn real_time_ms() f64 {
    return @floatFromInt(g_state.real_time_ms);
}

pub const RunIdRow = struct { run_id_hi: f64, run_id_lo: f64 };

pub fn snapshot_run_id() RunIdRow {
    ensureInit();
    const hi: u64 = (g_state.run_id >> 32) & 0xFFFFFFFF;
    const lo: u64 = g_state.run_id & 0xFFFFFFFF;
    return .{ .run_id_hi = @floatFromInt(hi), .run_id_lo = @floatFromInt(lo) };
}

pub fn set_run_id(hi: f64, lo: f64) void {
    const hi_u: u64 = @intFromFloat(@max(hi, 0));
    const lo_u: u64 = @intFromFloat(@max(lo, 0));
    g_state.run_id = ((hi_u & 0xFFFFFFFF) << 32) | (lo_u & 0xFFFFFFFF);
}

pub fn add_random_token() u32 {
    ensureInit();
    if (g_state.token_count >= MAX_TOKENS) return g_state.token_count;
    seedOne(g_state.token_count);
    g_state.token_count += 1;
    emitTokensInit();
    return g_state.token_count;
}

// ── Trade surface (player-driven) ──────────────────────────────────────

pub const QuoteResult = struct {
    output: f64,
    impact: f64,
    fee: f64,
    effective_price: f64,
};

pub fn quote_buy(token_id: u32, usd_in: f64) QuoteResult {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    const q = pool_mod.quoteBuy(&g_state.tokens[token_id].pool, usd_in);
    return .{ .output = q.output, .impact = q.price_impact, .fee = q.fee_amount, .effective_price = q.effective_price };
}

pub fn quote_sell(token_id: u32, base_in: f64) QuoteResult {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    const q = pool_mod.quoteSell(&g_state.tokens[token_id].pool, base_in);
    return .{ .output = q.output, .impact = q.price_impact, .fee = q.fee_amount, .effective_price = q.effective_price };
}

pub const TradeResult = struct {
    ok: u32,    // 0/1
    output: f64,
    impact: f64,
    fee: f64,
    effective_price: f64,
};

pub fn buy(token_id: u32, usd_in: f64) TradeResult {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    if (g_state.wallet.usd < usd_in or usd_in <= 0) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    var t = &g_state.tokens[token_id];
    if (t.price.is_rugged or t.pool.is_rugged) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    const q = pool_mod.executeBuy(&t.pool, usd_in);
    if (q.output <= 0) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    g_state.wallet.usd -= usd_in;
    wallet_mod.onBuy(&g_state.wallet, token_id, t.symbol[0..t.symbol_len], usd_in, q.output);
    t.price.current = pool_mod.spotPrice(&t.pool);
    onTradeExecuted(token_id, 'b', usd_in, q.price_impact);
    return .{ .ok = 1, .output = q.output, .impact = q.price_impact, .fee = q.fee_amount, .effective_price = q.effective_price };
}

pub fn sell(token_id: u32, base_in: f64) TradeResult {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    var t = &g_state.tokens[token_id];
    if (base_in <= 0 or t.pool.is_rugged) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    var h_amount: f64 = 0;
    var i: u32 = 0;
    while (i < g_state.wallet.holding_count) : (i += 1) {
        if (g_state.wallet.holdings[i].token_id == token_id) {
            h_amount = g_state.wallet.holdings[i].amount;
            break;
        }
    }
    const sell_amt = @min(base_in, h_amount);
    if (sell_amt <= 0) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    const q = pool_mod.executeSell(&t.pool, sell_amt);
    if (q.output <= 0) return .{ .ok = 0, .output = 0, .impact = 0, .fee = 0, .effective_price = 0 };
    g_state.wallet.usd += q.output;
    wallet_mod.onSell(&g_state.wallet, token_id, sell_amt, q.output);
    t.price.current = pool_mod.spotPrice(&t.pool);
    onTradeExecuted(token_id, 's', q.output, q.price_impact);
    return .{ .ok = 1, .output = q.output, .impact = q.price_impact, .fee = q.fee_amount, .effective_price = q.effective_price };
}

// ── Cold-system mutators (called from TS) ──────────────────────────────

pub const OkRow = struct { ok: u32 };

/// Mining tick: credit tokens to the player (zero cost basis), inflate
/// pool supply, and debit USD power cost. Called by TS once per second
/// per active rig.
pub fn apply_mining_yield(token_id: u32, base_minted: f64, usd_power_cost: f64) OkRow {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .ok = 0 };
    var t = &g_state.tokens[token_id];
    if (t.pool.is_rugged) return .{ .ok = 0 };
    if (base_minted > 0) {
        pool_mod.mintForEmission(&t.pool, base_minted);
        // walletOnMined-equivalent inline: weighted average against existing.
        var found: ?*wallet_mod.Holding = null;
        var i: u32 = 0;
        while (i < g_state.wallet.holding_count) : (i += 1) {
            if (g_state.wallet.holdings[i].token_id == token_id) {
                found = &g_state.wallet.holdings[i];
                break;
            }
        }
        if (found == null and g_state.wallet.holding_count < wallet_mod.MAX_HOLDINGS) {
            const slot = g_state.wallet.holding_count;
            g_state.wallet.holdings[slot] = .{
                .token_id = token_id,
                .symbol = [_]u8{0} ** 12,
                .symbol_len = 0,
                .amount = 0,
                .avg_buy_price = 0,
                .total_invested = 0,
                .realized_pnl = 0,
            };
            const sym = t.symbol[0..t.symbol_len];
            const n = @min(sym.len, g_state.wallet.holdings[slot].symbol.len);
            @memcpy(g_state.wallet.holdings[slot].symbol[0..n], sym[0..n]);
            g_state.wallet.holdings[slot].symbol_len = @intCast(n);
            g_state.wallet.holding_count += 1;
            found = &g_state.wallet.holdings[slot];
        }
        if (found) |h| {
            const new_amount = h.amount + base_minted;
            if (new_amount > 0) h.avg_buy_price = h.total_invested / new_amount;
            h.amount = new_amount;
        }
    }
    g_state.wallet.usd -= usd_power_cost;
    return .{ .ok = 1 };
}

/// LP fee skim: read and zero pool.lp_fees_pool. Returns the amount the
/// caller should distribute among LP positions.
pub fn pool_take_lp_fees(token_id: u32) f64 {
    ensureInit();
    if (token_id >= g_state.token_count) return 0;
    var p = &g_state.tokens[token_id].pool;
    const out = p.lp_fees_pool;
    p.lp_fees_pool = 0;
    return out;
}

/// LP add: debit USD from wallet, add (token, USDT) to reserves at spot.
/// Returns the actual token side added so TS can record the position.
pub const LpAddRow = struct { ok: u32, token_amount: f64, quote_amount: f64 };

pub fn apply_lp_add(token_id: u32, usd_amount: f64) LpAddRow {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .ok = 0, .token_amount = 0, .quote_amount = 0 };
    if (usd_amount <= 0 or g_state.wallet.usd < usd_amount) return .{ .ok = 0, .token_amount = 0, .quote_amount = 0 };
    var p = &g_state.tokens[token_id].pool;
    const sp = pool_mod.spotPrice(p);
    if (sp <= 0) return .{ .ok = 0, .token_amount = 0, .quote_amount = 0 };
    const half = usd_amount / 2.0;
    const token_amount = half / sp;
    g_state.wallet.usd -= usd_amount;
    p.reserve_base += token_amount;
    p.reserve_quote += half;
    return .{ .ok = 1, .token_amount = token_amount, .quote_amount = half };
}

/// LP remove: subtract reserves, credit USD-equivalent (token side
/// converted at current spot) + caller-known accrued fees.
pub fn apply_lp_remove(token_id: u32, base_amount: f64, quote_amount: f64, fees_earned: f64) f64 {
    ensureInit();
    if (token_id >= g_state.token_count) return 0;
    var p = &g_state.tokens[token_id].pool;
    if (p.reserve_base < base_amount or p.reserve_quote < quote_amount) return 0;
    p.reserve_base -= base_amount;
    p.reserve_quote -= quote_amount;
    const sp = pool_mod.spotPrice(p);
    const total = base_amount * sp + quote_amount + fees_earned;
    g_state.wallet.usd += total;
    return total;
}

/// Favors / scripted pattern flips.
pub fn set_token_pattern(token_id: u32, pattern_int: u32) OkRow {
    ensureInit();
    if (token_id >= g_state.token_count) return .{ .ok = 0 };
    if (pattern_int > 6) return .{ .ok = 0 };
    g_state.tokens[token_id].price.pattern = @enumFromInt(@as(u8, @intCast(pattern_int)));
    return .{ .ok = 1 };
}

/// Wallet USD mutators (staking, harvests, etc.).
pub fn wallet_credit_usd(amount: f64) void {
    ensureInit();
    if (amount > 0) g_state.wallet.usd += amount;
}

pub fn wallet_debit_usd(amount: f64) OkRow {
    ensureInit();
    if (amount <= 0 or g_state.wallet.usd < amount) return .{ .ok = 0 };
    g_state.wallet.usd -= amount;
    return .{ .ok = 1 };
}

/// Holding mutators (token-side staking).
pub fn wallet_credit_holding(token_id: u32, amount: f64) OkRow {
    ensureInit();
    if (token_id >= g_state.token_count or amount <= 0) return .{ .ok = 0 };
    const t = &g_state.tokens[token_id];
    var found: ?*wallet_mod.Holding = null;
    var i: u32 = 0;
    while (i < g_state.wallet.holding_count) : (i += 1) {
        if (g_state.wallet.holdings[i].token_id == token_id) {
            found = &g_state.wallet.holdings[i];
            break;
        }
    }
    if (found == null) {
        if (g_state.wallet.holding_count >= wallet_mod.MAX_HOLDINGS) return .{ .ok = 0 };
        const slot = g_state.wallet.holding_count;
        g_state.wallet.holdings[slot] = .{
            .token_id = token_id,
            .symbol = [_]u8{0} ** 12,
            .symbol_len = 0,
            .amount = 0,
            .avg_buy_price = 0,
            .total_invested = 0,
            .realized_pnl = 0,
        };
        const sym = t.symbol[0..t.symbol_len];
        const n = @min(sym.len, g_state.wallet.holdings[slot].symbol.len);
        @memcpy(g_state.wallet.holdings[slot].symbol[0..n], sym[0..n]);
        g_state.wallet.holdings[slot].symbol_len = @intCast(n);
        g_state.wallet.holding_count += 1;
        found = &g_state.wallet.holdings[slot];
    }
    if (found) |h| h.amount += amount;
    return .{ .ok = 1 };
}

pub fn wallet_debit_holding(token_id: u32, amount: f64) OkRow {
    ensureInit();
    if (token_id >= g_state.token_count or amount <= 0) return .{ .ok = 0 };
    var i: u32 = 0;
    while (i < g_state.wallet.holding_count) : (i += 1) {
        if (g_state.wallet.holdings[i].token_id == token_id) {
            const h = &g_state.wallet.holdings[i];
            if (h.amount < amount) return .{ .ok = 0 };
            h.amount -= amount;
            return .{ .ok = 1 };
        }
    }
    return .{ .ok = 0 };
}

// ── Reset ──────────────────────────────────────────────────────────────

pub fn reset() void {
    g_state.initialized = false;
    g_state.seeded = false;
    g_state.run_id = 0;
    g_state.token_count = 0;
    g_state.tick_count = 0;
    g_state.real_time_ms = 0;
    g_market_accum_ms = 0;
    g_pattern_accum_ms = 0;
    g_sim_tick_n = 0;
    g_live_read = 0;
    g_live_write = 0;
    g_react_count = 0;
    g_tps_window_start_ms = 0;
    g_tps_count = 0;
    g_heat = 0.0;
    g_difficulty = 1.0;
    ensureInit();
    emit("sim:trade:reset", "{}");
}
