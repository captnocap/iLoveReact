//! World streaming tests (req_0524 + req_0537 rework) — partition, verbatim
//! LOD shell, height-boosted residency hysteresis, and draw assembly with
//! contiguous-only merging (the req_0537 face-eater regression).
//!
//! Run directly (build.zig registration pending — the named module matches the
//! world_mapfile/world_gamefile test wiring for when it lands):
//!   zig test --dep world_streaming -Mroot=framework/testing/unit/world_streaming.zig \
//!     -Mworld_streaming=framework/world/streaming.zig

const std = @import("std");
const streaming = @import("world_streaming");

// One synthetic world, cell = 16m, used by every test. Stride 12 rows
// (pos3 rot3 scale3 color3):
//   row 0: spanning ground slab  (16, 0, 16) scale (64, 0.5, 64)
//   row 1: red tower, chunk 0    ( 4, 2.5, 4) scale (2,  5, 2) color red
//   row 2: red tower, chunk 0    (12, 2.5, 4) scale (2,  5, 2) color red
//   row 3: green tower, chunk 1  (20, 2.5, 4) scale (2,  5, 2) color green
//   row 4: blue tower, chunk 2   (36, 5,   4) scale (4, 10, 4) color blue
// Extent over centers: x 4..36, z 4..16 → 3×1 grid of 16m cells.
const ROWS = [_]f32{
    16, 0,   16, 0, 0, 0, 64, 0.5, 64, 0.5, 0.5, 0.5,
    4,  2.5, 4,  0, 0, 0, 2,  5,   2,  1,   0,   0,
    12, 2.5, 4,  0, 0, 0, 2,  5,   2,  1,   0,   0,
    20, 2.5, 4,  0, 0, 0, 2,  5,   2,  0,   1,   0,
    36, 5,   4,  0, 0, 0, 4,  10,  4,  0,   0,   1,
};

fn buildWorld(allocator: std.mem.Allocator) !streaming.World {
    const fams = [_]streaming.FamilyRows{.{ .rows = ROWS[0..], .stride = 12 }};
    return streaming.build(allocator, fams[0..], 16.0, 100);
}

const WIDE_VIEW = streaming.Camera{
    .pos = .{ 20, 5, -60 },
    .look = .{ 20, 5, 4 },
    .fov_degrees = 60,
    .aspect = 1.5,
    .far = 0,
};

test "partition: spanning prefix, chunk ranges, row content preserved" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    try std.testing.expectEqual(@as(u32, 3), world.cols);
    try std.testing.expectEqual(@as(u32, 1), world.rows);
    const family = world.families[0];
    try std.testing.expectEqual(@as(u32, 1), family.always.count);
    try std.testing.expectEqual(@as(u32, 2), family.ranges[0].count);
    try std.testing.expectEqual(@as(u32, 1), family.ranges[1].count);
    try std.testing.expectEqual(@as(u32, 1), family.ranges[2].count);
    try std.testing.expectEqual(@as(u32, 3), world.stats.occupied_chunks);
    try std.testing.expectEqual(@as(u32, 4), world.stats.local_rows);
    try std.testing.expectEqual(@as(u32, 1), world.stats.spanning_rows);

    // The spanning slab leads the sorted copy; the blue tower's row is intact
    // at its chunk range.
    try std.testing.expectEqual(@as(f32, 64), family.rows[6]); // slab scale.x at row 0
    const blue = family.ranges[2].first * family.stride;
    try std.testing.expectEqual(@as(f32, 36), family.rows[blue + 0]);
    try std.testing.expectEqual(@as(f32, 1), family.rows[blue + 11]);

    // Chunk 0's bounds wrap its two towers (x 3..13, top 5), not the slab.
    try std.testing.expectApproxEqAbs(@as(f32, 3), world.bounds_min[0][0], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 13), world.bounds_max[0][0], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 5), world.bounds_max[0][1], 0.001);
}

test "lod shell: verbatim rows — exact shape, exact color, nothing invented" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    // Every tower is ≥ 2m → all 4 survive the smallest rung; the slab spans.
    try std.testing.expectEqual(@as(u32, 4), world.stats.lod_rows);
    try std.testing.expectApproxEqAbs(@as(f32, 2), world.stats.lod_min_height, 0.001);
    try std.testing.expectEqual(@as(u32, 2), world.lod.ranges[0].count);
    try std.testing.expectEqual(@as(u32, 1), world.lod.ranges[1].count);
    try std.testing.expectEqual(@as(u32, 1), world.lod.ranges[2].count);

    // The blue tower's LOD row is the REAL row: same position, same scale (no
    // shrink — req_0537 killed the nested stand-in), same blue.
    const rows = world.lod.rows;
    const blue = world.lod.ranges[2].first * world.lod.stride;
    try std.testing.expectApproxEqAbs(@as(f32, 36), rows[blue + 0], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 5), rows[blue + 1], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 4), rows[blue + 6], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 10), rows[blue + 7], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 4), rows[blue + 8], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 0), rows[blue + 9], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 1), rows[blue + 11], 0.001);
}

test "residency: height-boosted promotion, per-chunk hysteresis" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    // Effective promote radii (base 10): 5m towers → 30m; 10m tower → 60m.
    // The blue chunk's cell (x 36..52) is 32m from the player at x=4 — far
    // beyond the base radius, promoted anyway because it's TALL (the era's
    // per-model draw distance; the req_0537 walk-a-lot fix).
    world.updateResidency(4, 4, 10);
    try std.testing.expect(world.resident[0]);
    try std.testing.expect(world.resident[1]);
    try std.testing.expect(world.resident[2]);

    // Back off to x=-30: chunk0 at 34m sits in its (30, 34.5] hysteresis band
    // → stays; chunk1 at 50m is far past its demote edge → drops; chunk2 at
    // 66m sits in its (60, 69] band → stays.
    world.updateResidency(-30, 4, 10);
    try std.testing.expect(world.resident[0]);
    try std.testing.expect(!world.resident[1]);
    try std.testing.expect(world.resident[2]);

    // x=-34: chunk0 at 38 > 34.5 and chunk2 at 70 > 69 → both drop.
    world.updateResidency(-34, 4, 10);
    try std.testing.expect(!world.resident[0]);
    try std.testing.expect(!world.resident[2]);

    // Promotion is instant on re-approach: chunk2 at exactly 60m.
    world.updateResidency(-24, 4, 10);
    try std.testing.expect(world.resident[2]);
}

test "draws: contiguous merge only — never bridge a resident chunk's lod" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    // Everything resident → one always draw + ONE merged detail draw (ranges
    // {1,2}+{3,1}+{4,1} are contiguous), no lod.
    world.updateResidency(4, 4, 10);
    const all_detail = world.assembleDraws(WIDE_VIEW);
    try std.testing.expectEqual(@as(usize, 2), all_detail.len);
    try std.testing.expect(!all_detail[1].lod);
    try std.testing.expectEqual(@as(u32, 1), all_detail[1].range.first);
    try std.testing.expectEqual(@as(u32, 4), all_detail[1].range.count);

    // THE req_0537 REGRESSION: middle chunk resident, neighbors not. Its lod
    // rows sit BETWEEN the neighbors' lod ranges; the old gap-merge bridged
    // them and drew a lod box over the resident building (the face-eater).
    // Now: two SEPARATE lod draws that skip the resident chunk's rows.
    world.resident[0] = false;
    world.resident[1] = true;
    world.resident[2] = false;
    const split = world.assembleDraws(WIDE_VIEW);
    try std.testing.expectEqual(@as(usize, 4), split.len);
    try std.testing.expect(!split[1].lod); // chunk1 detail {3,1}
    try std.testing.expectEqual(@as(u32, 3), split[1].range.first);
    try std.testing.expect(split[2].lod); // chunk0 lod {0,2}
    try std.testing.expectEqual(@as(u32, 0), split[2].range.first);
    try std.testing.expectEqual(@as(u32, 2), split[2].range.count);
    try std.testing.expect(split[3].lod); // chunk2 lod {3,1} — NOT merged across chunk1's lod row
    try std.testing.expectEqual(@as(u32, 3), split[3].range.first);
    try std.testing.expectEqual(@as(u32, 1), split[3].range.count);

    // Nobody resident → the three lod ranges ARE contiguous → one lod draw.
    world.updateResidency(-500, 4, 10);
    const all_lod = world.assembleDraws(WIDE_VIEW);
    try std.testing.expectEqual(@as(usize, 2), all_lod.len);
    try std.testing.expect(all_lod[1].lod);
    try std.testing.expectEqual(@as(u32, 0), all_lod[1].range.first);
    try std.testing.expectEqual(@as(u32, 4), all_lod[1].range.count);

    // Camera facing AWAY from the grid: only the always slab survives.
    const away_view = streaming.Camera{
        .pos = .{ 20, 5, 100 },
        .look = .{ 20, 5, 200 },
        .fov_degrees = 60,
        .aspect = 1.5,
        .far = 0,
    };
    const draws3 = world.assembleDraws(away_view);
    try std.testing.expectEqual(@as(usize, 1), draws3.len);
    try std.testing.expect(!draws3[0].lod);
}
