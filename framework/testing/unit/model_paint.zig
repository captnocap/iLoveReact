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

test "append after stale topology preserves the raster and isolates the fresh part" {
    var initial = QUAD_VERTS;
    model_paint.setTarget(177, &initial, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &initial, 6);
    model_paint.setDetail(16, &initial, 6);
    model_paint.paintStamp(0, 0.15, 0.35, 3.0, .{ 255, 7, 11, 255 }, 1.0);

    const before_atlas = model_paint.atlas().?;
    const before = try testing.allocator.dupe(u8, before_atlas.rgba);
    defer testing.allocator.free(before);
    const placeholder = model_paint.reserveNeutralPlaceholderUv() orelse return error.TestUnexpectedResult;

    var grown: [12 * 8]f32 = undefined;
    @memcpy(grown[0 .. 6 * 8], &initial);
    @memcpy(grown[6 * 8 ..], &initial);
    var vertex: usize = 6;
    while (vertex < 12) : (vertex += 1) {
        grown[vertex * 8 + 0] += 2.0;
        grown[vertex * 8 + 6] = placeholder[0];
        grown[vertex * 8 + 7] = placeholder[1];
    }
    defer {
        model_paint.setDetail(1, &grown, 12);
        model_paint.test_support.clearTargetAndSource();
    }

    try testing.expect(model_paint.setTargetPreservingAtlas(178, &grown, 12, &.{ 0, 0, 1, 1 }));
    const after = model_paint.atlas().?;
    try testing.expectEqual(before_atlas.w, after.w);
    try testing.expectEqual(before_atlas.h, after.h);
    try testing.expectEqualSlices(u8, before, after.rgba);
    try testing.expectEqual(model_paint.DEFAULT_FACE, model_paint.faceColor(2).?);
}

test "deleting a fresh part preserves the surviving authored group's exact paint" {
    var joined: [12 * 8]f32 = undefined;
    @memcpy(joined[0 .. 6 * 8], &QUAD_VERTS);
    @memcpy(joined[6 * 8 ..], &QUAD_VERTS);
    var vertex: usize = 6;
    while (vertex < 12) : (vertex += 1) joined[vertex * 8] += 2.0;

    model_paint.setTarget(79, &joined, 12);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0, 1, 1 }, &joined, 12);
    model_paint.setDetail(16, &joined, 12);
    model_paint.setBase(.solid, .{ 19, 29, 43, 255 });
    model_paint.clearAtlas();
    model_paint.paintStamp(0, 0.21, 0.34, 3.0, .{ 3, 211, 97, 255 }, 1.0);

    const before_island = model_paint.layoutIslands().?[0];
    const before_atlas = model_paint.atlas().?;
    const before = try testing.allocator.alloc(u8, @as(usize, before_island.w) * before_island.h * 4);
    defer testing.allocator.free(before);
    var row: u32 = 0;
    while (row < before_island.h) : (row += 1) {
        const src = (@as(usize, before_island.y + row) * before_atlas.w + before_island.x) * 4;
        const dst = @as(usize, row) * before_island.w * 4;
        @memcpy(before[dst .. dst + @as(usize, before_island.w) * 4], before_atlas.rgba[src .. src + @as(usize, before_island.w) * 4]);
    }

    model_paint.snapshotAtlasForCarry();
    var survivor = QUAD_VERTS;
    model_paint.setTarget(80, &survivor, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &survivor, 6);
    defer {
        model_paint.setDetail(1, &survivor, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    const after_island = model_paint.layoutIslands().?[0];
    const after_atlas = model_paint.atlas().?;
    try testing.expectEqual(before_island.w, after_island.w);
    try testing.expectEqual(before_island.h, after_island.h);
    row = 0;
    while (row < after_island.h) : (row += 1) {
        const got = (@as(usize, after_island.y + row) * after_atlas.w + after_island.x) * 4;
        const want = @as(usize, row) * after_island.w * 4;
        try testing.expectEqualSlices(u8, before[want .. want + @as(usize, after_island.w) * 4], after_atlas.rgba[got .. got + @as(usize, after_island.w) * 4]);
    }

    model_paint.clearAtlas();
    try testing.expectEqual(@as([4]u8, .{ 19, 29, 43, 255 }), model_paint.faceColor(0).?);
}

test "an empty delete midpoint does not consume the pending atlas carry" {
    var original = QUAD_VERTS;
    model_paint.setTarget(81, &original, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &original, 6);
    model_paint.setDetail(16, &original, 6);
    model_paint.setBase(.solid, .{ 7, 13, 23, 255 });
    model_paint.clearAtlas();
    model_paint.paintStamp(0, 0.27, 0.41, 3.0, .{ 251, 101, 17, 255 }, 1.0);
    const expected = try testing.allocator.dupe(u8, model_paint.atlas().?.rgba);
    defer testing.allocator.free(expected);

    model_paint.snapshotAtlasForCarry();
    var empty: [0]f32 = .{};
    model_paint.setTarget(82, empty[0..], 0);
    var restored = QUAD_VERTS;
    model_paint.setTarget(83, &restored, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &restored, 6);
    defer {
        model_paint.setDetail(1, &restored, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    try testing.expectEqualSlices(u8, expected, model_paint.atlas().?.rgba);
    model_paint.clearAtlas();
    try testing.expectEqual(@as([4]u8, .{ 7, 13, 23, 255 }), model_paint.faceColor(0).?);
}
