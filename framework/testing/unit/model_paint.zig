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

fn atlasHash(bytes: []const u8) u64 {
    var hash: u64 = 1469598103934665603;
    for (bytes) |byte| hash = (hash ^ byte) *% 1099511628211;
    return hash;
}

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

test "model brush blend modes alter the destination colour" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(901, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    model_paint.setBase(.solid, .{ 100, 150, 200, 255 });
    model_paint.clearAtlas();
    model_paint.paintStampShaped(0, 0.33, 0.33, 20, .{ 200, 100, 50, 255 }, 1, .{ .blend = 1 });
    try testing.expectEqual(@as([4]u8, .{ 78, 58, 39, 255 }), model_paint.faceColor(0).?);

    model_paint.clearAtlas();
    model_paint.paintStampShaped(0, 0.33, 0.33, 20, .{ 200, 100, 50, 255 }, 1, .{ .blend = 2 });
    const screen = model_paint.faceColor(0).?;
    try testing.expect(screen[0] > 200 and screen[1] > 150 and screen[2] > 200);
}

test "scatter moves an ordinary round dab and replays deterministically" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(902, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(48, &quad, 6);
    model_paint.setBase(.solid, .{ 0, 0, 0, 255 });
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    model_paint.clearAtlas();
    model_paint.paintStampShaped(0, 0.27, 0.41, 3, .{ 255, 255, 255, 255 }, 1, .{ .scatter = 0 });
    const centered = atlasHash(model_paint.atlas().?.rgba);
    model_paint.clearAtlas();
    model_paint.paintStampShaped(0, 0.27, 0.41, 3, .{ 255, 255, 255, 255 }, 1, .{ .scatter = 2 });
    const scattered = atlasHash(model_paint.atlas().?.rgba);
    try testing.expect(centered != scattered);
    model_paint.clearAtlas();
    model_paint.paintStampShaped(0, 0.27, 0.41, 3, .{ 255, 255, 255, 255 }, 1, .{ .scatter = 2 });
    try testing.expectEqual(scattered, atlasHash(model_paint.atlas().?.rgba));
}

test "all advertised analytic brush kinds rasterize distinct footprints" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(903, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(64, &quad, 6);
    model_paint.setBase(.solid, .{ 0, 0, 0, 255 });
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    var hashes: [11]u64 = undefined;
    for (0..11) |kind| {
        model_paint.clearAtlas();
        model_paint.paintStampShaped(0, 0.33, 0.33, 8, .{ 255, 255, 255, 255 }, 1, .{
            .kind = @intCast(kind),
            .hardness = 0.8,
            .aspect = 1.9,
            .scatter = if (kind == 8 or kind == 9) 0.65 else 0,
        });
        hashes[kind] = atlasHash(model_paint.atlas().?.rgba);
    }
    for (hashes, 0..) |hash, at| for (hashes[at + 1 ..]) |other| {
        try testing.expect(hash != other);
    };
}

test "authored UV rectangle edits keep texture pixels fixed and rewrite displayed UVs" {
    var joined: [12 * 8]f32 = undefined;
    @memcpy(joined[0 .. 6 * 8], &QUAD_VERTS);
    @memcpy(joined[6 * 8 ..], &QUAD_VERTS);
    var vertex: usize = 6;
    while (vertex < 12) : (vertex += 1) joined[vertex * 8] += 2.0;

    model_paint.setTarget(904, &joined, 12);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0, 1, 1 }, &joined, 12);
    model_paint.setDetail(32, &joined, 12);
    defer {
        model_paint.setDetail(1, &joined, 12);
        model_paint.test_support.clearTargetAndSource();
    }
    model_paint.paintFaceRgb(0, .{ 251, 31, 47 });
    const before_color = model_paint.faceColor(0).?;
    const before_atlas_hash = atlasHash(model_paint.atlas().?.rgba);
    const before_u = joined[6];
    const before_v = joined[7];
    const islands = model_paint.layoutIslands().?;
    try testing.expectEqual(@as(usize, 2), islands.len);

    var old_rects: [8]u32 = undefined;
    try testing.expect(model_paint.copyLayoutRects(&old_rects));
    const moved_and_resized = [8]u32{
        old_rects[4], old_rects[5], @max(1, old_rects[2] / 2), @max(1, old_rects[3] / 2),
        old_rects[0], old_rects[1], old_rects[6],              old_rects[7],
    };
    try testing.expect(model_paint.applyIslandRects(&moved_and_resized, &joined, 12));
    try testing.expectEqual(before_atlas_hash, atlasHash(model_paint.atlas().?.rgba));
    const moved_triangle = model_paint.uvTriangle(0) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 0), moved_triangle.island);
    try testing.expect(moved_triangle.corners[0] >= @as(f32, @floatFromInt(moved_and_resized[0])));
    try testing.expect(moved_triangle.corners[1] >= @as(f32, @floatFromInt(moved_and_resized[1])));
    const after_color = model_paint.faceColor(0).?;
    try testing.expect(!std.mem.eql(u8, before_color[0..], after_color[0..]));
    try testing.expect(before_u != joined[6] or before_v != joined[7]);
    try testing.expectEqual(@as(u32, 0), model_paint.firstFaceForIsland(0).?);
    try testing.expectEqual(@as(u32, 2), model_paint.firstFaceForIsland(1).?);
    var adopted: [8]u32 = undefined;
    try testing.expect(model_paint.copyLayoutRects(&adopted));
    try testing.expectEqualSlices(u32, &moved_and_resized, &adopted);

    // A later brush dab follows the transformed triangle corners. This is the
    // cylinder-sliver regression: moving a UV must not leave painting behind in
    // the original packing cell.
    const before_dab_hash = atlasHash(model_paint.atlas().?.rgba);
    model_paint.paintStamp(0, 0.33, 0.33, 4, .{ 7, 239, 113, 255 }, 1);
    try testing.expect(before_dab_hash != atlasHash(model_paint.atlas().?.rgba));
    const dabbed = model_paint.sampleTexel(0, 0.33, 0.33) orelse return error.TestUnexpectedResult;
    try testing.expect(dabbed[1] > 220 and dabbed[0] < 30);
}

test "exact UV vertices deform face sampling while atlas pixels stay fixed" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(906, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    const atlas = model_paint.atlas().?;
    const stripes = try testing.allocator.dupe(u8, atlas.rgba);
    defer testing.allocator.free(stripes);
    var y: u32 = 0;
    while (y < atlas.h) : (y += 1) {
        var x: u32 = 0;
        while (x < atlas.w) : (x += 1) {
            const pixel = (@as(usize, y) * atlas.w + x) * 4;
            stripes[pixel + 0] = @intCast(x % 251);
            stripes[pixel + 1] = @intCast(y % 251);
            stripes[pixel + 2] = @intCast((x + y) % 251);
            stripes[pixel + 3] = 255;
        }
    }
    try testing.expect(model_paint.setAtlas(stripes));
    const fixed_atlas_hash = atlasHash(model_paint.atlas().?.rgba);

    var corners: [12]f32 = undefined;
    var face: u32 = 0;
    while (face < 2) : (face += 1) {
        const triangle = model_paint.uvTriangle(face) orelse return error.TestUnexpectedResult;
        @memcpy(corners[@as(usize, face) * 6 ..][0..6], triangle.corners[0..]);
    }
    const atlas_w_f: f32 = @floatFromInt(atlas.w);
    const atlas_h_f: f32 = @floatFromInt(atlas.h);
    @memcpy(corners[0..6], &[_]f32{ 0.5, 0.5, atlas_w_f - 0.5, 0.5, 0.5, atlas_h_f - 0.5 });
    try testing.expect(model_paint.applyCornerUvs(&corners, &quad, 6));
    try testing.expectEqual(fixed_atlas_hash, atlasHash(model_paint.atlas().?.rgba));

    const deformed = model_paint.uvTriangle(0) orelse return error.TestUnexpectedResult;
    try testing.expectEqualSlices(f32, corners[0..6], deformed.corners[0..]);
    try testing.expectApproxEqAbs(corners[0] / atlas_w_f, quad[6], 0.0001);
    try testing.expectApproxEqAbs(corners[1] / atlas_h_f, quad[7], 0.0001);
    const left_sample = model_paint.sampleTexel(0, 0.1, 0.1) orelse return error.TestUnexpectedResult;
    const right_sample = model_paint.sampleTexel(0, 0.8, 0.1) orelse return error.TestUnexpectedResult;
    try testing.expect(left_sample[0] != right_sample[0]);

    const before_reject = deformed.corners;
    var invalid = corners;
    invalid[0] = -1;
    try testing.expect(!model_paint.applyCornerUvs(&invalid, &quad, 6));
    try testing.expectEqualSlices(f32, before_reject[0..], model_paint.uvTriangle(0).?.corners[0..]);
    try testing.expectEqual(fixed_atlas_hash, atlasHash(model_paint.atlas().?.rgba));
}

test "closed pen polygon fills one logical island across its triangle diagonal" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(905, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(48, &quad, 6);
    model_paint.setBase(.solid, .{ 10, 20, 30, 255 });
    model_paint.clearAtlas();
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    try testing.expectEqual(model_paint.islandIndexForFace(0).?, model_paint.islandIndexForFace(1).?);
    const outline = [_]f32{ 0.08, 0.08, 0.92, 0.08, 0.92, 0.92, 0.08, 0.92 };
    try testing.expect(model_paint.paintPolygon(0, &outline, .{ 240, 60, 90, 255 }, false, 1, 0));
    const first = model_paint.faceColor(0).?;
    const second = model_paint.faceColor(1).?;
    try testing.expect(first[0] > 220 and first[1] < 80);
    try testing.expect(second[0] > 220 and second[1] < 80);
}
