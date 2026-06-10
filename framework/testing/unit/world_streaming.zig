//! World streaming tests (req_0524) — partition, LOD shell, residency
//! hysteresis, and draw assembly of framework/world/streaming.zig.
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
//   row 1: red tower, chunk 0    ( 4, 2.5, 4) scale (2, 5, 2) color red
//   row 2: red tower, chunk 0    (12, 2.5, 4) scale (2, 5, 2) color red
//   row 3: blue tower, chunk 2   (36, 5,   4) scale (4, 10, 4) color blue
// Extent over centers: x 4..36, z 4..16 → 3×1 grid of 16m cells.
const ROWS = [_]f32{
    16, 0,   16, 0, 0, 0, 64, 0.5, 64, 0.5, 0.5, 0.5,
    4,  2.5, 4,  0, 0, 0, 2,  5,   2,  1,   0,   0,
    12, 2.5, 4,  0, 0, 0, 2,  5,   2,  1,   0,   0,
    36, 5,   4,  0, 0, 0, 4,  10,  4,  0,   0,   1,
};

fn buildWorld(allocator: std.mem.Allocator) !streaming.World {
    const fams = [_]streaming.FamilyRows{.{ .rows = ROWS[0..], .stride = 12 }};
    return streaming.build(allocator, fams[0..], 16.0, 100);
}

test "partition: spanning prefix, chunk ranges, row content preserved" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    try std.testing.expectEqual(@as(u32, 3), world.cols);
    try std.testing.expectEqual(@as(u32, 1), world.rows);
    const family = world.families[0];
    try std.testing.expectEqual(@as(u32, 1), family.always.count);
    try std.testing.expectEqual(@as(u32, 2), family.ranges[0].count);
    try std.testing.expectEqual(@as(u32, 0), family.ranges[1].count);
    try std.testing.expectEqual(@as(u32, 1), family.ranges[2].count);
    try std.testing.expect(world.occupied[0]);
    try std.testing.expect(!world.occupied[1]);
    try std.testing.expect(world.occupied[2]);
    try std.testing.expectEqual(@as(u32, 2), world.stats.occupied_chunks);
    try std.testing.expectEqual(@as(u32, 3), world.stats.local_rows);
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

test "lod shell: quadrant boxes, volume-weighted color, nested shrink" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    // Chunk 0: towers land in two quadrants → 2 boxes. Chunk 2: 1 box.
    try std.testing.expectEqual(@as(u32, 2), world.lod.ranges[0].count);
    try std.testing.expectEqual(@as(u32, 1), world.lod.ranges[2].count);
    try std.testing.expectEqual(@as(u32, 3), world.stats.lod_rows);

    const blue_lod = (world.lod.ranges[2].first) * world.lod.stride;
    const rows = world.lod.rows;
    try std.testing.expectApproxEqAbs(@as(f32, 36), rows[blue_lod + 0], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 5), rows[blue_lod + 1], 0.001);
    // Shrunk to nest inside the real tower (scale 4,10,4 × 0.96).
    try std.testing.expectApproxEqAbs(@as(f32, 3.84), rows[blue_lod + 6], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 9.6), rows[blue_lod + 7], 0.001);
    // Pure blue survives the volume weighting (single contributor).
    try std.testing.expectApproxEqAbs(@as(f32, 0), rows[blue_lod + 9], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 1), rows[blue_lod + 11], 0.001);
}

test "residency: promotion instant, demotion hysteretic" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    // Player at the west end, radius 10: chunk 0 (cell x 4..20) touches, the
    // blue chunk (cell x 36..52) is 32m away.
    world.updateResidency(4, 4, 10);
    try std.testing.expect(world.resident[0]);
    try std.testing.expect(!world.resident[2]);

    // Step toward the blue chunk: 6m away → promoted immediately.
    world.updateResidency(30, 4, 10);
    try std.testing.expect(world.resident[2]);

    // Back off into the hysteresis band (10 < d ≤ 11.5): stays resident.
    world.updateResidency(25, 4, 10);
    try std.testing.expect(world.resident[2]);

    // Past the demotion edge (12 > 11.5): let go.
    world.updateResidency(24, 4, 10);
    try std.testing.expect(!world.resident[2]);
}

test "draws: always prefix, detail vs lod split, gap merging, behind-cull" {
    const allocator = std.testing.allocator;
    var world = try buildWorld(allocator);
    defer world.deinit(allocator);

    // Stand in chunk 0; whole grid in view from a camera north of it.
    world.updateResidency(4, 4, 10);
    const wide_view = streaming.Camera{
        .pos = .{ 20, 5, -60 },
        .look = .{ 20, 5, 4 },
        .fov_degrees = 60,
        .aspect = 1.5,
        .far = 0,
    };
    const draws = world.assembleDraws(wide_view);
    // always slab + chunk-0 detail + chunk-2 lod = 3 draws.
    try std.testing.expectEqual(@as(usize, 3), draws.len);
    try std.testing.expect(!draws[0].lod);
    try std.testing.expectEqual(@as(u32, 1), draws[0].range.count); // the slab
    try std.testing.expect(!draws[1].lod);
    try std.testing.expectEqual(@as(u32, 1), draws[1].range.first); // detail after prefix
    try std.testing.expectEqual(@as(u32, 2), draws[1].range.count);
    try std.testing.expect(draws[2].lod);
    try std.testing.expectEqual(@as(u32, 1), draws[2].range.count);

    // Nobody resident → both lod chunks emit, and their adjacent ranges merge
    // into ONE lod draw (gap 0 ≤ merge tolerance).
    world.updateResidency(-500, 4, 10);
    const draws2 = world.assembleDraws(wide_view);
    try std.testing.expectEqual(@as(usize, 2), draws2.len);
    try std.testing.expect(draws2[1].lod);
    try std.testing.expectEqual(@as(u32, 0), draws2[1].range.first);
    try std.testing.expectEqual(@as(u32, 3), draws2[1].range.count);

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
