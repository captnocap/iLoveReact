//! Pure allocation policy for a mutable retained-geometry slot.
//!
//! The renderer owns the upload and bump allocator. This module owns the small,
//! testable decision: reuse an existing region, grow the tail in place, or move
//! once to the current tail when immutable geometry was interned after it.

const std = @import("std");

pub const Kind = enum {
    reuse,
    grow_tail,
    move_tail,
};

pub const Plan = struct {
    kind: Kind,
    offset_bytes: u64,
    capacity_bytes: u64,
    retained_top: u64,
};

pub fn plan(
    offset_bytes: u64,
    capacity_bytes: u64,
    requested_bytes: u64,
    retained_top: u64,
    retained_limit: u64,
) ?Plan {
    if (requested_bytes <= capacity_bytes) return .{
        .kind = .reuse,
        .offset_bytes = offset_bytes,
        .capacity_bytes = capacity_bytes,
        .retained_top = retained_top,
    };
    if (offset_bytes +| capacity_bytes == retained_top) {
        if (offset_bytes +| requested_bytes > retained_limit) return null;
        return .{
            .kind = .grow_tail,
            .offset_bytes = offset_bytes,
            .capacity_bytes = requested_bytes,
            .retained_top = offset_bytes + requested_bytes,
        };
    }
    if (retained_top +| requested_bytes > retained_limit) return null;
    return .{
        .kind = .move_tail,
        .offset_bytes = retained_top,
        .capacity_bytes = requested_bytes,
        .retained_top = retained_top + requested_bytes,
    };
}

pub fn nextGeneration(current: u32) u32 {
    const next = current +% 1;
    return if (next == 0) 1 else next;
}

test "mutable retained slot reuses, grows, and moves without multiplying cache entries" {
    const reused = plan(100, 80, 40, 180, 1000).?;
    try std.testing.expectEqual(Kind.reuse, reused.kind);
    try std.testing.expectEqual(@as(u64, 100), reused.offset_bytes);
    try std.testing.expectEqual(@as(u64, 180), reused.retained_top);

    const grown = plan(100, 80, 120, 180, 1000).?;
    try std.testing.expectEqual(Kind.grow_tail, grown.kind);
    try std.testing.expectEqual(@as(u64, 100), grown.offset_bytes);
    try std.testing.expectEqual(@as(u64, 220), grown.retained_top);

    const moved = plan(100, 80, 120, 400, 1000).?;
    try std.testing.expectEqual(Kind.move_tail, moved.kind);
    try std.testing.expectEqual(@as(u64, 400), moved.offset_bytes);
    try std.testing.expectEqual(@as(u64, 520), moved.retained_top);
}

test "mutable retained slot refuses over-budget growth and generation never becomes zero" {
    try std.testing.expect(plan(100, 80, 120, 180, 200) == null);
    try std.testing.expect(plan(100, 80, 120, 400, 500) == null);
    try std.testing.expectEqual(@as(u32, 2), nextGeneration(1));
    try std.testing.expectEqual(@as(u32, 1), nextGeneration(std.math.maxInt(u32)));
}
