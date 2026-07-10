//! Behavior tests for the native painted-flora contract.
//!
//! Run: zig build test-world-flora

const std = @import("std");
const geometry = @import("flora_geometry");
const foliage = geometry.recipe;
const shaders = @import("gpu_shaders");

test "wrapped flora transforms are deterministic and species-distinct" {
    var prior: ?[foliage.STRIDE]f32 = null;
    for (0..foliage.WRAPPED_SPECIES_COUNT) |i| {
        const species: foliage.WrappedSpecies = @enumFromInt(i);
        const a = foliage.wrappedRow(species, 10.5, 20.5, 2, 1, 12345);
        const b = foliage.wrappedRow(species, 10.5, 20.5, 2, 1, 12345);
        try std.testing.expectEqualSlices(f32, &a, &b);
        try std.testing.expect(a[6] < 16 and a[7] < 16 and a[8] < 16);
        if (prior) |p| try std.testing.expect(!std.mem.eql(f32, &p, &a));
        prior = a;
    }
}

test "shared meshes contain stems plus a 360-degree canopy" {
    for (0..foliage.WRAPPED_SPECIES_COUNT) |i| {
        const mesh = geometry.buildWrappedByIndex(i).?;
        try std.testing.expect(mesh.vertex_count > 0);
        try std.testing.expect(mesh.vertex_count <= geometry.MAX_WRAPPED_VERTICES);
        var stems = false;
        var canopy = false;
        var min_x: f32 = std.math.floatMax(f32);
        var max_x: f32 = -std.math.floatMax(f32);
        var min_z: f32 = std.math.floatMax(f32);
        var max_z: f32 = -std.math.floatMax(f32);
        var at: usize = 0;
        while (at < mesh.constFloats().len) : (at += geometry.FLOATS_PER_VERTEX) {
            const values = mesh.constFloats();
            min_x = @min(min_x, values[at]);
            max_x = @max(max_x, values[at]);
            min_z = @min(min_z, values[at + 2]);
            max_z = @max(max_z, values[at + 2]);
            const band = values[at + 6];
            stems = stems or (band >= geometry.UV_BARK and band < geometry.UV_SHRUB_LEAF) or band >= geometry.UV_GREEN_STEM;
            canopy = canopy or (band >= geometry.UV_CONIFER and band < geometry.UV_BARK) or
                (band >= geometry.UV_SHRUB_LEAF and band < geometry.UV_GREEN_STEM);
        }
        try std.testing.expect(stems and canopy);
        try std.testing.expect(min_x < -0.25 and max_x > 0.25);
        try std.testing.expect(min_z < -0.25 and max_z > 0.25);
    }
}

test "wrapped shrub cards stay single-sided in the unculled pipeline" {
    const shrub_first = @intFromEnum(foliage.WrappedSpecies.mophead_hydrangea);
    const expected_vertices = [_]usize{ 480, 480, 414, 486 };
    for (expected_vertices, 0..) |expected, offset| {
        const mesh = geometry.buildWrappedByIndex(shrub_first + offset).?;
        try std.testing.expectEqual(expected, mesh.vertex_count);
    }
}

test "frond shader recognizes tree, shrub, bloom, and stem bands" {
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "2 conifer") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "3 crown") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "4 bark") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "5 shrub leaf") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "6 mophead bloom") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "7 panicle bloom") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "8 weed leaf") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "9 green stem") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "style >= 3.5 && style < 4.5") != null);
    try std.testing.expect(std.mem.indexOf(u8, shaders.frond_wgsl, "wind_weight = 0.0") != null);
}
