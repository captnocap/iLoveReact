//! Focused regressions for the resident model-paint atlas.
//! Run: zig build test-model-paint

const std = @import("std");
const testing = std.testing;
const model_paint = @import("model_paint");

// A unit quad in z=0, lowered to the render soup accepted by the paint target.
const QUAD_VERTS = [_]f32{
    0, 0, 0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 0, 1, 0, 0,
    1, 1, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 1, 0, 0,
    1, 1, 0, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 0, 1, 0, 0,
};

test "appending an authored group carries exact paint texels and the atlas base" {
    var initial = QUAD_VERTS;
    model_paint.setTarget(77, &initial, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &initial, 6);
    model_paint.setDetail(16, &initial, 6);
    model_paint.setBase(.solid, .{ 31, 47, 63, 255 });
    model_paint.clearAtlas();
    model_paint.paintStamp(0, 0.15, 0.35, 3.0, .{ 255, 7, 11, 255 }, 1.0);

    const old_island = model_paint.layoutIslands().?[0];
    const old_atlas = model_paint.atlas().?;
    const old_patch = try testing.allocator.alloc(u8, @as(usize, old_island.w) * old_island.h * 4);
    defer testing.allocator.free(old_patch);
    var py: u32 = 0;
    while (py < old_island.h) : (py += 1) {
        const src = (@as(usize, old_island.y + py) * old_atlas.w + old_island.x) * 4;
        const dst = @as(usize, py) * old_island.w * 4;
        @memcpy(old_patch[dst .. dst + @as(usize, old_island.w) * 4], old_atlas.rgba[src .. src + @as(usize, old_island.w) * 4]);
    }

    model_paint.snapshotAtlasForCarry();
    var grown: [12 * 8]f32 = undefined;
    @memcpy(grown[0 .. 6 * 8], &QUAD_VERTS);
    @memcpy(grown[6 * 8 ..], &QUAD_VERTS);
    var vi: usize = 6;
    while (vi < 12) : (vi += 1) grown[vi * 8] += 2.0;
    model_paint.setTarget(78, &grown, 12);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0, 1, 1 }, &grown, 12);
    defer {
        model_paint.setDetail(1, &grown, 12);
        model_paint.test_support.clearTargetAndSource();
    }

    const new_atlas = model_paint.atlas().?;
    var carried_index: ?usize = null;
    for (model_paint.layoutIslands().?, 0..) |island, index| {
        if (island.group == 0) carried_index = index;
    }
    const ci = model_paint.layoutIslands().?[carried_index orelse return error.TestUnexpectedResult];
    try testing.expectEqual(old_island.w, ci.w);
    try testing.expectEqual(old_island.h, ci.h);
    py = 0;
    while (py < ci.h) : (py += 1) {
        const got = (@as(usize, ci.y + py) * new_atlas.w + ci.x) * 4;
        const want = @as(usize, py) * ci.w * 4;
        try testing.expectEqualSlices(u8, old_patch[want .. want + @as(usize, ci.w) * 4], new_atlas.rgba[got .. got + @as(usize, ci.w) * 4]);
    }

    // A later program replay begins with clearAtlas(). It must rebuild the authored
    // base on both the survivor and fresh group, not silently fall back to grey.
    model_paint.clearAtlas();
    try testing.expectEqual(@as([4]u8, .{ 31, 47, 63, 255 }), model_paint.faceColor(0).?);
    try testing.expectEqual(@as([4]u8, .{ 31, 47, 63, 255 }), model_paint.faceColor(2).?);
}
