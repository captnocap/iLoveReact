//! distribute.zig — Distribute free space along a 1D axis (CSS flexbox style).
//!
//! Grep target: `distribute`, anything resembling `space-between`,
//! `space-around`, `space-evenly`, `justify-content`, `align-content`.
//!
//! The same six-case equation appears in `layout.zig` for the main axis
//! (justify-content) and the cross axis (align-content). It also shows up in
//! anywhere that lays out items along a line — toolbar slots, tab strips,
//! tick marks, audio playheads, etc. Reach for this instead of inlining.
//!
//! Inputs:
//!   - mode  — how items distribute within `free` space
//!   - free  — leftover space after items + gaps; pass 0 if items overflow
//!   - count — number of items being distributed
//!
//! Outputs:
//!   - offset    — distance from the start of the axis to the first item
//!   - extra_gap — extra spacing inserted *between* items (added to any
//!                 baseline gap the caller already accounts for)
//!
//! Convention: callers `@floor` of `offset` is baked in for pixel snapping.

const std = @import("std");

pub const Mode = enum {
    start,
    center,
    end,
    space_between,
    space_around,
    space_evenly,
};

pub const Distribution = struct {
    offset: f32 = 0,
    extra_gap: f32 = 0,
};

/// Pure equation — does NOT early-return on negative `free`. CSS allows
/// negative offsets when content overflows (e.g. `.center` with overflow
/// pushes items past the start edge), and callers like layout.zig depend on
/// that. Guard outside this function if you want overflow to clamp.
pub fn distribute(mode: Mode, free: f32, count: u32) Distribution {
    if (count == 0) return .{};
    const n = @as(f32, @floatFromInt(count));
    return switch (mode) {
        .start => .{},
        .center => .{ .offset = @floor(free / 2) },
        .end => .{ .offset = free },
        .space_between => if (count > 1)
            .{ .extra_gap = free / (n - 1) }
        else
            .{},
        .space_around => blk: {
            const gap = free / n;
            break :blk .{ .offset = @floor(gap / 2), .extra_gap = gap };
        },
        .space_evenly => blk: {
            const gap = free / (n + 1);
            break :blk .{ .offset = @floor(gap), .extra_gap = gap };
        },
    };
}

// ── Tests ───────────────────────────────────────────────────────────────

test "distribute start is zero" {
    const d = distribute(.start, 100, 3);
    try std.testing.expectEqual(@as(f32, 0), d.offset);
    try std.testing.expectEqual(@as(f32, 0), d.extra_gap);
}

test "distribute center halves free space (floored)" {
    const d = distribute(.center, 100, 3);
    try std.testing.expectEqual(@as(f32, 50), d.offset);
}

test "distribute end pushes everything to the far edge" {
    const d = distribute(.end, 100, 3);
    try std.testing.expectEqual(@as(f32, 100), d.offset);
}

test "distribute space_between: gaps fill, no leading offset" {
    const d = distribute(.space_between, 90, 4);
    try std.testing.expectEqual(@as(f32, 0), d.offset);
    try std.testing.expectEqual(@as(f32, 30), d.extra_gap);
}

test "distribute space_between with one item is start" {
    const d = distribute(.space_between, 100, 1);
    try std.testing.expectEqual(@as(f32, 0), d.offset);
    try std.testing.expectEqual(@as(f32, 0), d.extra_gap);
}

test "distribute space_around: half-gap end-pads" {
    const d = distribute(.space_around, 100, 4);
    try std.testing.expectEqual(@as(f32, 25), d.extra_gap);
    try std.testing.expectEqual(@as(f32, 12), d.offset); // floor(25/2)
}

test "distribute space_evenly: full-gap end-pads" {
    const d = distribute(.space_evenly, 100, 4);
    try std.testing.expectEqual(@as(f32, 20), d.extra_gap);
    try std.testing.expectEqual(@as(f32, 20), d.offset);
}

test "distribute zero count is no-op" {
    try std.testing.expectEqual(Distribution{}, distribute(.center, 100, 0));
    try std.testing.expectEqual(Distribution{}, distribute(.space_evenly, 100, 0));
}

test "distribute negative free still applies (CSS overflow)" {
    // .center with overflow pushes items past the start edge.
    const d = distribute(.center, -20, 5);
    try std.testing.expectEqual(@as(f32, -10), d.offset);
}

test "distribute zero free is identity for offsets and gaps" {
    try std.testing.expectEqual(@as(f32, 0), distribute(.center, 0, 5).offset);
    try std.testing.expectEqual(@as(f32, 0), distribute(.space_between, 0, 5).extra_gap);
}
