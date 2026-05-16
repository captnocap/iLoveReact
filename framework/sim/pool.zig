//! sim/pool.zig — constant-product (x·y=k) AMM per token.

const std = @import("std");

pub const Pool = struct {
    token_id: u32,
    base_coin: u8,
    reserve_base: f64,
    reserve_quote: f64,
    fee: f64,
    volume_24h: f64,
    tx_count_24h: u32,
    total_supply: f64,
    emitted_as_reward: f64,
    circulating_supply: f64,
    lp_fees_pool: f64,
    is_rugged: bool,
};

pub const SwapQuote = struct {
    input: f64,
    output: f64,
    price_impact: f64,
    fee_amount: f64,
    effective_price: f64,
};

pub fn initPool(token_id: u32, base_coin: u8, reserve_base: f64, reserve_quote: f64, fee: f64, circulating_supply: f64) Pool {
    return .{
        .token_id = token_id,
        .base_coin = base_coin,
        .reserve_base = reserve_base,
        .reserve_quote = reserve_quote,
        .fee = fee,
        .volume_24h = 0,
        .tx_count_24h = 0,
        .total_supply = circulating_supply,
        .emitted_as_reward = 0,
        .circulating_supply = circulating_supply,
        .lp_fees_pool = 0,
        .is_rugged = false,
    };
}

pub fn mintForEmission(p: *Pool, amount: f64) void {
    if (amount <= 0) return;
    p.emitted_as_reward += amount;
    p.circulating_supply += amount;
}

pub fn decayVolume(p: *Pool, multiplier: f64) void {
    p.volume_24h *= multiplier;
    if (p.volume_24h < 0.01) p.volume_24h = 0;
}

pub fn marketCapInBase(p: *const Pool) f64 {
    return spotPriceInBase(p) * p.circulating_supply;
}

pub fn marketCapUsd(p: *const Pool, base_usd: f64) f64 {
    return marketCapInBase(p) * base_usd;
}

pub fn spotPriceInBase(p: *const Pool) f64 {
    if (p.reserve_base <= 0) return 0;
    return p.reserve_quote / p.reserve_base;
}

pub fn spotPriceUsd(p: *const Pool, base_usd: f64) f64 {
    return spotPriceInBase(p) * base_usd;
}

pub fn quoteBuy(p: *const Pool, quote_in: f64) SwapQuote {
    if (p.is_rugged or quote_in <= 0) return .{
        .input = quote_in, .output = 0, .price_impact = 0, .fee_amount = 0, .effective_price = 0,
    };
    const fee_amt = quote_in * p.fee;
    const q_after = quote_in - fee_amt;
    const k = p.reserve_base * p.reserve_quote;
    const new_quote = p.reserve_quote + q_after;
    const new_base = k / new_quote;
    const out = p.reserve_base - new_base;
    const spot_before = p.reserve_quote / p.reserve_base;
    const effective = if (out > 0) q_after / out else 0;
    const impact = if (spot_before > 0) (effective - spot_before) / spot_before else 0;
    return .{
        .input = quote_in,
        .output = out,
        .price_impact = impact,
        .fee_amount = fee_amt,
        .effective_price = effective,
    };
}

pub fn quoteSell(p: *const Pool, base_in: f64) SwapQuote {
    if (p.is_rugged or base_in <= 0) return .{
        .input = base_in, .output = 0, .price_impact = 0, .fee_amount = 0, .effective_price = 0,
    };
    const k = p.reserve_base * p.reserve_quote;
    const new_base = p.reserve_base + base_in;
    const new_quote_pre = k / new_base;
    const out_pre = p.reserve_quote - new_quote_pre;
    const fee_amt = out_pre * p.fee;
    const out = out_pre - fee_amt;
    const spot_before = p.reserve_quote / p.reserve_base;
    const effective = if (base_in > 0) out / base_in else 0;
    const impact = if (spot_before > 0) (spot_before - effective) / spot_before else 0;
    return .{
        .input = base_in,
        .output = out,
        .price_impact = impact,
        .fee_amount = fee_amt,
        .effective_price = effective,
    };
}

pub fn executeBuy(p: *Pool, quote_in: f64) SwapQuote {
    const q = quoteBuy(p, quote_in);
    if (q.output <= 0) return q;
    p.reserve_quote += quote_in - q.fee_amount;
    p.reserve_base -= q.output;
    p.volume_24h += quote_in;
    p.tx_count_24h += 1;
    p.lp_fees_pool += q.fee_amount;
    return q;
}

pub fn executeSell(p: *Pool, base_in: f64) SwapQuote {
    const q = quoteSell(p, base_in);
    if (q.output <= 0) return q;
    p.reserve_base += base_in;
    p.reserve_quote -= q.output + q.fee_amount;
    p.volume_24h += q.output;
    p.tx_count_24h += 1;
    p.lp_fees_pool += q.fee_amount;
    return q;
}

pub fn spotPrice(p: *const Pool) f64 {
    if (p.reserve_base <= 0) return 0;
    return p.reserve_quote / p.reserve_base;
}
