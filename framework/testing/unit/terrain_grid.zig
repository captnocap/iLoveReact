//! Formula-painted shared terrain grid contract.
//!
//! Run: zig build test-world-loader

const std = @import("std");
const terrain_grid = @import("terrain_grid");

test "height trailer is fixed-offset, detectable, and preserves formula data" {
    var data: [terrain_grid.TOTAL_FLOATS]f32 = @splat(0);
    data[0] = 121;
    data[17] = 42.5;
    var source: [terrain_grid.SAMPLE_COUNT]f32 = undefined;
    for (&source, 0..) |*height, i| height.* = @floatFromInt(i);

    try std.testing.expect(terrain_grid.append(data[0..], 32_134, source[0..], 121, 121, 1, 1));
    try std.testing.expect(terrain_grid.hasTrailer(data[0..]));
    try std.testing.expectEqual(@as(f32, 121), data[0]);
    try std.testing.expectEqual(@as(f32, 42.5), data[17]);
    try std.testing.expectEqualSlices(f32, source[0..], terrain_grid.heightSlice(data[0..]).?);
    try std.testing.expectEqual(@as(f32, 1), data[terrain_grid.CELL_X_OFFSET]);
    try std.testing.expectEqual(@as(f32, 1), data[terrain_grid.CELL_Z_OFFSET]);

    terrain_grid.clearMarker(data[0..]);
    try std.testing.expect(!terrain_grid.hasTrailer(data[0..]));
}

test "only the renderer's exact regular-grid contract gets a trailer" {
    var data: [terrain_grid.TOTAL_FLOATS]f32 = @splat(0);
    var source: [terrain_grid.SAMPLE_COUNT]f32 = @splat(0);
    try std.testing.expect(!terrain_grid.append(data[0..], terrain_grid.FORMULA_FLOAT_CAP + 1, source[0..], 121, 121, 1, 1));
    try std.testing.expect(!terrain_grid.append(data[0..], 1, source[0 .. source.len - 1], 121, 121, 1, 1));
    try std.testing.expect(!terrain_grid.append(data[0..], 1, source[0..], 120, 121, 1, 1));
    try std.testing.expect(!terrain_grid.hasTrailer(data[0..]));
}

test "shared topology budget includes one surface and four perimeter skirts" {
    try std.testing.expectEqual(@as(usize, 89_280), terrain_grid.TOPOLOGY_VERTEX_COUNT);
    try std.testing.expectEqual(@as(usize, 48_644), terrain_grid.TOTAL_FLOATS);
}
