//! HEIGHTFIELDS v3 → shared-grid ground, decoded (the blue-void regression).
//!
//! A compiled world's terrain reaches the renderer only if its lump grid IS the
//! rendered floor resolution. At any other resolution three independent native
//! gates reject the chunk WITHOUT a word: terrain_grid.canAppend refuses the
//! height trailer (so the shared ground pipeline never binds it), the dynamic
//! heightfield fallback exceeds MAX_DYN_VERTS, and game_physics.HF_MAX_SAMPLES
//! refuses the collider. On 2026-08-26 an exporter shipped the 241×241 BRUSH
//! field and the game rendered as an empty blue sky with no ground to drive on.
//! These tests pin the decode side of that contract.
//!
//! Run: zig build test-world-terrain-lump

const std = @import("std");
const constructor = @import("../../world/constructor.zig");
const terrain_grid = @import("../../gpu/terrain_grid.zig");
const game_physics = @import("../../game/physics.zig");
const dynamic_region = @import("../../gpu/scene3d/dynamic_region.zig");

const FORMULA = "fn hf_ground_rgb(uv: vec2f) -> vec3f { _ = uv; return vec3f(0.5); }";
const CHUNK_METERS: f32 = 120;

/// Build one HEIGHTFIELDS v3 lump the way an exporter must: header, the formula
/// once, then per chunk a 16-byte record header, ten f32 of placement, the
/// height grid, and the native ground/road stream.
fn encodeLump(allocator: std.mem.Allocator, res: u32, ground_floats: usize) ![]u8 {
    const samples: usize = @as(usize, res) * @as(usize, res);
    const total = 12 + FORMULA.len + 16 + 10 * 4 + samples * 4 + ground_floats * 4;
    const bytes = try allocator.alloc(u8, total);
    @memset(bytes, 0);
    std.mem.writeInt(u32, bytes[0..4], 3, .little);
    std.mem.writeInt(u32, bytes[4..8], 1, .little);
    std.mem.writeInt(u32, bytes[8..12], @intCast(FORMULA.len), .little);
    @memcpy(bytes[12 .. 12 + FORMULA.len], FORMULA);
    var at: usize = 12 + FORMULA.len;
    std.mem.writeInt(u32, bytes[at..][0..4], res, .little);
    std.mem.writeInt(u32, bytes[at + 4 ..][0..4], res, .little);
    std.mem.writeInt(u32, bytes[at + 8 ..][0..4], @intCast(ground_floats), .little);
    at += 16;
    const cell = CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
    const placement = [_]f32{ 0, 0, 0, CHUNK_METERS, CHUNK_METERS, cell, 0.66, 1, 1, 1 };
    for (placement, 0..) |value, i| std.mem.writeInt(u32, bytes[at + i * 4 ..][0..4], @bitCast(value), .little);
    at += 40;
    // A visible ridge: flat terrain would pass a "did anything decode" check even
    // when the height stream is dropped.
    var h: usize = 0;
    while (h < samples) : (h += 1) {
        const value: f32 = if (h % @as(usize, res) == 3) 4.25 else 0;
        std.mem.writeInt(u32, bytes[at + h * 4 ..][0..4], @bitCast(value), .little);
    }
    at += samples * 4;
    var g: usize = 0;
    while (g < ground_floats) : (g += 1) {
        const value: f32 = @floatFromInt(g + 1);
        std.mem.writeInt(u32, bytes[at + g * 4 ..][0..4], @bitCast(value), .little);
    }
    return bytes;
}

test "a lump at the rendered floor resolution decodes onto the shared ground grid" {
    const allocator = std.testing.allocator;
    const ground_floats: usize = 2_048;
    const bytes = try encodeLump(allocator, terrain_grid.SAMPLE_COLS, ground_floats);
    defer allocator.free(bytes);

    const fields = try constructor.decodeHeightfields(allocator, bytes);
    defer {
        for (fields) |field| field.deinit(allocator);
        allocator.free(fields);
    }
    try std.testing.expectEqual(@as(usize, 1), fields.len);
    const field = fields[0];
    try std.testing.expect(field.ground_formula != null);

    // The trailer is what routes the chunk to the ground pipeline at all.
    try std.testing.expect(terrain_grid.hasTrailer(field.ground_data));
    try std.testing.expectEqual(terrain_grid.TOTAL_FLOATS, field.ground_data.?.len);

    // The formula prefix survives underneath the appended trailer.
    try std.testing.expectEqual(@as(f32, 1), field.ground_data.?[0]);
    try std.testing.expectEqual(@as(f32, @floatFromInt(ground_floats)), field.ground_data.?[ground_floats - 1]);

    // The heights the shader reads are the authored ridge, not zeroes.
    const heights = terrain_grid.heightSlice(field.ground_data.?).?;
    try std.testing.expectEqual(@as(f32, 4.25), heights[3]);
    try std.testing.expectEqual(@as(f32, 1), field.ground_data.?[terrain_grid.CELL_X_OFFSET]);

    // And the same grid fits the collider table, so there is ground to drive on.
    try std.testing.expect(field.heights.len <= game_physics.HF_MAX_SAMPLES);
}

test "an off-resolution lump is the silent-empty-world shape, and every gate rejects it" {
    const allocator = std.testing.allocator;
    const brush_res: u32 = 241;
    const bytes = try encodeLump(allocator, brush_res, 2_048);
    defer allocator.free(bytes);

    const fields = try constructor.decodeHeightfields(allocator, bytes);
    defer {
        for (fields) |field| field.deinit(allocator);
        allocator.free(fields);
    }
    const field = fields[0];

    // It decodes cleanly — that is exactly why the failure was invisible.
    try std.testing.expectEqual(@as(u32, brush_res), field.cols);
    try std.testing.expect(!terrain_grid.hasTrailer(field.ground_data));

    // Gate 1: no shared-grid ground pipeline.
    try std.testing.expect(!terrain_grid.canAppend(2_048, field.heights, field.cols, field.rows));
    // Gate 2: the dynamic-mesh fallback cannot hold the surface either.
    const fallback_verts = (@as(usize, field.cols) - 1) * (@as(usize, field.rows) - 1) * 6;
    try std.testing.expect(fallback_verts > dynamic_region.MAX_DYN_VERTS);
    // Gate 3: no collider.
    try std.testing.expect(field.heights.len > game_physics.HF_MAX_SAMPLES);
}
