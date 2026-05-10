//! wrap.zig — Greedy line-packing along a 1D axis (CSS flexbox `flex-wrap`).
//!
//! Grep target: `wrap`, anything resembling `flex-wrap`, `line-break`,
//! `chip wrap`, or any "fit items into rows of width N".
//!
//! Same algorithm appears in `framework/layout.zig` twice — once in the
//! intrinsic-height estimation pass and once in the concrete layout pass.
//! Same break rule, same gap accounting, same edge cases. Reach for this
//! instead of inlining a fourth copy.
//!
//! Inputs:
//!   - items   — main-axis size of each item, ALREADY INCLUDING outer margins
//!               (caller folds basis + margin-start + margin-end before
//!               passing). The packer is purely about the axis layout.
//!   - max     — main-axis budget per line (e.g. innerW). May be 0 or
//!               negative; the packer still produces a valid result (every
//!               item gets its own line).
//!   - gap     — between-item gap on the same line (no leading/trailing).
//!   - out     — pre-allocated buffer for the output `Line` slice. The
//!               caller decides max-lines via slice length; if there are
//!               more lines than fit, the remainder is silently truncated
//!               — same behavior as the existing `MAX_LINES = 64` cap in
//!               layout.zig.
//!
//! Returns the number of lines actually written to `out`.
//!
//! Algorithm (greedy, single-pass, O(n)):
//!   For each item, if we already placed something on the current line and
//!   adding this item plus a gap would exceed `max`, close the line and
//!   start a new one with this item. Otherwise append to the current line.

const std = @import("std");

pub const Line = struct {
    start: u32 = 0,
    count: u32 = 0,
};

pub fn pack(items: []const f32, max: f32, gap: f32, out: []Line) u32 {
    if (items.len == 0 or out.len == 0) return 0;

    var n_lines: u32 = 0;
    var line_start: u32 = 0;
    var items_on_line: u32 = 0;
    var line_main: f32 = 0;

    for (items, 0..) |item_main, i| {
        const idx: u32 = @intCast(i);
        const gap_before: f32 = if (items_on_line > 0) gap else 0;
        if (items_on_line > 0 and line_main + gap_before + item_main > max) {
            // Close the current line; start a fresh one with this item.
            out[n_lines] = .{ .start = line_start, .count = items_on_line };
            n_lines += 1;
            if (n_lines >= out.len) return n_lines;
            line_start = idx;
            items_on_line = 1;
            line_main = item_main;
        } else {
            line_main += gap_before + item_main;
            items_on_line += 1;
        }
    }

    // Flush the trailing line.
    if (items_on_line > 0 and n_lines < out.len) {
        out[n_lines] = .{ .start = line_start, .count = items_on_line };
        n_lines += 1;
    }
    return n_lines;
}

// ── Tests ───────────────────────────────────────────────────────────────

test "pack single line when items fit" {
    const items = [_]f32{ 10, 20, 30 };
    var out: [4]Line = undefined;
    const n = pack(&items, 100, 0, &out);
    try std.testing.expectEqual(@as(u32, 1), n);
    try std.testing.expectEqual(@as(u32, 0), out[0].start);
    try std.testing.expectEqual(@as(u32, 3), out[0].count);
}

test "pack wraps when total exceeds max" {
    const items = [_]f32{ 60, 60, 60 };
    var out: [4]Line = undefined;
    const n = pack(&items, 100, 0, &out);
    try std.testing.expectEqual(@as(u32, 3), n);
    for (0..3) |i| {
        try std.testing.expectEqual(@as(u32, @intCast(i)), out[i].start);
        try std.testing.expectEqual(@as(u32, 1), out[i].count);
    }
}

test "pack respects gap between items on same line" {
    // Two items of 40 with gap 30 = 110 > 100 → wrap.
    const items = [_]f32{ 40, 40 };
    var out: [4]Line = undefined;
    const n = pack(&items, 100, 30, &out);
    try std.testing.expectEqual(@as(u32, 2), n);
}

test "pack first item never wraps even if larger than max" {
    // CSS flex-wrap: an item too big for its line still gets ITS OWN line
    // rather than disappearing. (Greedy contract: itemsOnLine must be > 0
    // for the wrap rule to fire.)
    const items = [_]f32{ 200, 10 };
    var out: [4]Line = undefined;
    const n = pack(&items, 100, 0, &out);
    try std.testing.expectEqual(@as(u32, 2), n);
    try std.testing.expectEqual(@as(u32, 1), out[0].count);
    try std.testing.expectEqual(@as(u32, 1), out[1].count);
}

test "pack empty items returns 0" {
    const items = [_]f32{};
    var out: [4]Line = undefined;
    try std.testing.expectEqual(@as(u32, 0), pack(&items, 100, 0, &out));
}

test "pack truncates at out-buffer capacity" {
    const items = [_]f32{ 60, 60, 60, 60, 60 };
    var out: [2]Line = undefined; // only room for 2 lines
    const n = pack(&items, 100, 0, &out);
    try std.testing.expectEqual(@as(u32, 2), n);
}

test "pack groups items that fit with gap" {
    // 30 + 10 + 30 + 10 + 30 = 110, with max=120, gap=10 → all on one line (sum=110)
    const items = [_]f32{ 30, 30, 30 };
    var out: [4]Line = undefined;
    const n = pack(&items, 120, 10, &out);
    try std.testing.expectEqual(@as(u32, 1), n);
    try std.testing.expectEqual(@as(u32, 3), out[0].count);
}
