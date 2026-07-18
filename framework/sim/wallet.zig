//! sim/wallet.zig — single-user wallet. Holds USD + per-token balances,
//! tracks PnL from average buy price.

const std = @import("std");

pub const MAX_HOLDINGS: usize = 64;

pub const Holding = struct {
    token_id: u32,
    symbol: [12]u8,
    symbol_len: u8,
    amount: f64,
    avg_buy_price: f64,
    total_invested: f64,
    realized_pnl: f64,
};

pub const WalletState = struct {
    address: [20]u8,
    usd: f64,
    holdings: [MAX_HOLDINGS]Holding,
    holding_count: u32,
    starting_usd: f64,
    total_value_usd: f64,
    total_trades: u32,
    biggest_win: f64,
    biggest_loss: f64,
};

/// Construct a wallet from entropy supplied by the simulation owner. Wallet
/// state is otherwise pure and has no reason to retain or discover an I/O
/// capability.
pub fn init(starting_usd: f64, address: [20]u8) WalletState {
    return .{
        .address = address,
        .usd = starting_usd,
        .holdings = undefined,
        .holding_count = 0,
        .starting_usd = starting_usd,
        .total_value_usd = starting_usd,
        .total_trades = 0,
        .biggest_win = 0,
        .biggest_loss = 0,
    };
}

test "wallet initialization uses caller-provided entropy" {
    const address = [_]u8{0xa5} ** 20;
    const wallet = init(1000.0, address);

    try std.testing.expectEqualSlices(u8, &address, &wallet.address);
    try std.testing.expectEqual(@as(f64, 1000.0), wallet.usd);
}

fn findHolding(w: *WalletState, token_id: u32) ?*Holding {
    var i: u32 = 0;
    while (i < w.holding_count) : (i += 1) {
        if (w.holdings[i].token_id == token_id) return &w.holdings[i];
    }
    return null;
}

fn addHolding(w: *WalletState, token_id: u32, symbol: []const u8) ?*Holding {
    if (w.holding_count >= MAX_HOLDINGS) return null;
    const h = &w.holdings[w.holding_count];
    h.* = .{
        .token_id = token_id,
        .symbol = [_]u8{0} ** 12,
        .symbol_len = 0,
        .amount = 0,
        .avg_buy_price = 0,
        .total_invested = 0,
        .realized_pnl = 0,
    };
    const n = @min(symbol.len, h.symbol.len);
    @memcpy(h.symbol[0..n], symbol[0..n]);
    h.symbol_len = @intCast(n);
    w.holding_count += 1;
    return h;
}

pub fn onBuy(
    w: *WalletState,
    token_id: u32,
    symbol: []const u8,
    quote_spent: f64,
    base_received: f64,
) void {
    if (base_received <= 0) return;
    var h = findHolding(w, token_id) orelse addHolding(w, token_id, symbol) orelse return;
    const new_amount = h.amount + base_received;
    h.avg_buy_price = (h.total_invested + quote_spent) / new_amount;
    h.amount = new_amount;
    h.total_invested += quote_spent;
    w.total_trades += 1;
}

pub fn onSell(
    w: *WalletState,
    token_id: u32,
    base_sold: f64,
    quote_received: f64,
) void {
    var h = findHolding(w, token_id) orelse return;
    if (h.amount <= 0) return;
    const sold = @min(base_sold, h.amount);
    const cost_basis = h.avg_buy_price * sold;
    const pnl = quote_received - cost_basis;
    h.realized_pnl += pnl;
    h.amount -= sold;
    h.total_invested = @max(h.total_invested - cost_basis, 0);
    if (pnl > w.biggest_win) w.biggest_win = pnl;
    if (pnl < w.biggest_loss) w.biggest_loss = pnl;
    w.total_trades += 1;
}

pub fn revalue(w: *WalletState, price_for: *const fn (u32) f64) void {
    var total = w.usd;
    var i: u32 = 0;
    while (i < w.holding_count) : (i += 1) {
        total += w.holdings[i].amount * price_for(w.holdings[i].token_id);
    }
    w.total_value_usd = total;
}
