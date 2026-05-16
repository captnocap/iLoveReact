//! sim/npc.zig — NPC wallet roster.

const std = @import("std");
const Rng = @import("rng.zig").Rng;

pub const NPC_ROSTER_SIZE: usize = 512;
pub const NPC_MAX_HOLDINGS: usize = 16;

pub const NpcProfile = enum(u8) {
    retail,
    swing,
    whale,
    alpha,
    dev_insider,
    mev_bot,
    rug_runner,
    paper_hands,
    cartel,
};

pub const NpcHolding = struct {
    token_id: u32,
    amount: f64,
    avg_buy_price: f64,
    total_invested: f64,
    realized_pnl: f64,
};

pub const Npc = struct {
    id: u32,
    address: [20]u8,
    profile: NpcProfile,
    usd_balance: f64,
    starting_usd: f64,
    holdings: [NPC_MAX_HOLDINGS]NpcHolding,
    holding_count: u8,
    realized_pnl: f64,
    trade_count: u32,
    rep_score: f32,
};

fn genAddress(rng: *Rng) [20]u8 {
    var out: [20]u8 = undefined;
    var i: usize = 0;
    while (i < 20) : (i += 4) {
        const word = rng.prng.random().int(u32);
        out[i + 0] = @intCast((word >> 24) & 0xff);
        out[i + 1] = @intCast((word >> 16) & 0xff);
        out[i + 2] = @intCast((word >> 8) & 0xff);
        out[i + 3] = @intCast(word & 0xff);
    }
    return out;
}

const PROFILE_WEIGHTS = [_]struct { p: NpcProfile, count: u32 }{
    .{ .p = .retail,      .count = 256 },
    .{ .p = .swing,       .count = 77  },
    .{ .p = .whale,       .count = 15  },
    .{ .p = .alpha,       .count = 5   },
    .{ .p = .dev_insider, .count = 15  },
    .{ .p = .mev_bot,     .count = 26  },
    .{ .p = .rug_runner,  .count = 15  },
    .{ .p = .paper_hands, .count = 77  },
    .{ .p = .cartel,      .count = 26  },
};

fn startingUsdForProfile(p: NpcProfile, rng: *Rng) f64 {
    const r = rng.float();
    return switch (p) {
        .retail      => 100.0 + r * 2_000.0,
        .paper_hands => 200.0 + r * 3_000.0,
        .swing       => 5_000.0 + r * 25_000.0,
        .mev_bot     => 50_000.0 + r * 100_000.0,
        .rug_runner  => 2_000.0 + r * 10_000.0,
        .dev_insider => 20_000.0 + r * 80_000.0,
        .alpha       => 50_000.0 + r * 200_000.0,
        .cartel      => 200_000.0 + r * 500_000.0,
        .whale       => 1_000_000.0 + r * 4_000_000.0,
    };
}

pub fn initRoster(roster: *[NPC_ROSTER_SIZE]Npc, rng: *Rng) void {
    var slot: usize = 0;
    for (PROFILE_WEIGHTS) |w| {
        var i: u32 = 0;
        while (i < w.count and slot < NPC_ROSTER_SIZE) : (i += 1) {
            const start_usd = startingUsdForProfile(w.p, rng);
            roster[slot] = .{
                .id = @intCast(slot + 1),
                .address = genAddress(rng),
                .profile = w.p,
                .usd_balance = start_usd,
                .starting_usd = start_usd,
                .holdings = undefined,
                .holding_count = 0,
                .realized_pnl = 0,
                .trade_count = 0,
                .rep_score = 0.5,
            };
            slot += 1;
        }
    }
    while (slot < NPC_ROSTER_SIZE) : (slot += 1) {
        const start_usd = startingUsdForProfile(.retail, rng);
        roster[slot] = .{
            .id = @intCast(slot + 1),
            .address = genAddress(rng),
            .profile = .retail,
            .usd_balance = start_usd,
            .starting_usd = start_usd,
            .holdings = undefined,
            .holding_count = 0,
            .realized_pnl = 0,
            .trade_count = 0,
            .rep_score = 0.5,
        };
    }
}

fn findHolding(npc: *Npc, token_id: u32) ?*NpcHolding {
    var i: u8 = 0;
    while (i < npc.holding_count) : (i += 1) {
        if (npc.holdings[i].token_id == token_id) return &npc.holdings[i];
    }
    return null;
}

fn addHolding(npc: *Npc, token_id: u32) ?*NpcHolding {
    if (npc.holding_count >= NPC_MAX_HOLDINGS) return null;
    const h = &npc.holdings[npc.holding_count];
    h.* = .{
        .token_id = token_id,
        .amount = 0,
        .avg_buy_price = 0,
        .total_invested = 0,
        .realized_pnl = 0,
    };
    npc.holding_count += 1;
    return h;
}

pub fn onBuy(npc: *Npc, token_id: u32, usd_spent: f64, base_received: f64) void {
    if (base_received <= 0) return;
    npc.usd_balance -= usd_spent;
    var h = findHolding(npc, token_id) orelse addHolding(npc, token_id) orelse return;
    const new_amount = h.amount + base_received;
    if (new_amount > 0) {
        h.avg_buy_price = (h.total_invested + usd_spent) / new_amount;
    }
    h.amount = new_amount;
    h.total_invested += usd_spent;
    npc.trade_count += 1;
}

pub fn onSell(npc: *Npc, token_id: u32, base_sold: f64, usd_received: f64) void {
    var h = findHolding(npc, token_id) orelse return;
    if (h.amount <= 0) return;
    const sold = @min(base_sold, h.amount);
    const cost_basis = h.avg_buy_price * sold;
    const pnl = usd_received - cost_basis;
    h.realized_pnl += pnl;
    npc.realized_pnl += pnl;
    h.amount -= sold;
    h.total_invested = @max(h.total_invested - cost_basis, 0);
    npc.usd_balance += usd_received;
    npc.trade_count += 1;
}

pub fn pickForTrade(
    roster: *[NPC_ROSTER_SIZE]Npc,
    side_buy: bool,
    size_usd: f64,
    rng: *Rng,
) ?*Npc {
    var attempts: u32 = 0;
    while (attempts < 8) : (attempts += 1) {
        const idx = rng.prng.random().intRangeAtMost(usize, 0, NPC_ROSTER_SIZE - 1);
        const npc = &roster[idx];
        if (side_buy and npc.usd_balance < size_usd * 0.5) continue;
        return npc;
    }
    return null;
}
