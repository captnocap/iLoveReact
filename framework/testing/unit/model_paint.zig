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

const CornerBounds = struct { low_x: f32, low_y: f32, high_x: f32, high_y: f32 };

fn cornerBounds(corners: []const f32) CornerBounds {
    var bounds = CornerBounds{
        .low_x = std.math.floatMax(f32),
        .low_y = std.math.floatMax(f32),
        .high_x = -std.math.floatMax(f32),
        .high_y = -std.math.floatMax(f32),
    };
    var coordinate: usize = 0;
    while (coordinate + 1 < corners.len) : (coordinate += 2) {
        bounds.low_x = @min(bounds.low_x, corners[coordinate + 0]);
        bounds.low_y = @min(bounds.low_y, corners[coordinate + 1]);
        bounds.high_x = @max(bounds.high_x, corners[coordinate + 0]);
        bounds.high_y = @max(bounds.high_y, corners[coordinate + 1]);
    }
    return bounds;
}

test "glass opacity classification is shared at the authored-face boundary" {
    try testing.expect(model_paint.isGlassAlpha(model_paint.GLASS_ALPHA));
    try testing.expect(model_paint.isGlassAlpha(model_paint.OPAQUE_ALPHA_MIN - 1));
    try testing.expect(!model_paint.isGlassAlpha(model_paint.OPAQUE_ALPHA_MIN));
    try testing.expect(!model_paint.isGlassAlpha(255));
}

test "face glass presentation reads authored opacity without sampling atlas colour" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(905, &quad, 6);
    defer model_paint.test_support.clearTargetAndSource();

    try testing.expect(!model_paint.faceIsGlass(0));
    model_paint.paintFaceAlpha(0, model_paint.GLASS_ALPHA);
    try testing.expect(model_paint.faceIsGlass(0));
    try testing.expect(!model_paint.faceIsGlass(2)); // out-of-range is never glass
}

test "only authored or imported pixels make an atlas document-ready" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(906, &quad, 6);
    defer model_paint.test_support.clearTargetAndSource();

    // Every mesh receives an automatic layout for editing, but that blank allocation
    // must not prevent a persisted atlas from hydrating on cold/hot document load.
    try testing.expect(!model_paint.hasAuthoredAtlas());

    const generated = model_paint.atlas().?;
    const saved_pixels = try testing.allocator.dupe(u8, generated.rgba);
    defer testing.allocator.free(saved_pixels);
    try testing.expect(model_paint.setAtlas(saved_pixels));
    try testing.expect(model_paint.hasAuthoredAtlas());

    // A genuinely new target returns to automatic-only state until imported pixels land.
    model_paint.setTarget(907, &quad, 6);
    try testing.expect(!model_paint.hasAuthoredAtlas());
    const fresh = model_paint.atlas().?;
    const imported = try testing.allocator.dupe(u8, fresh.rgba);
    defer testing.allocator.free(imported);
    try testing.expect(model_paint.importAtlasPreservingUvGeometry(imported, fresh.w, fresh.h, &quad, 6));
    try testing.expect(model_paint.hasAuthoredAtlas());
}

test "unused atlas space stays transparent while real faces retain their alpha" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(907, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    model_paint.setBase(.solid, .{ 41, 67, 89, 255 });
    model_paint.paintFaceAlpha(0, 87);
    model_paint.clearAtlas();
    try testing.expectEqual(@as(u8, 87), model_paint.faceColor(0).?[3]);

    const atlas = model_paint.atlas().?;
    var transparent = false;
    var pixel: usize = 0;
    while (pixel < atlas.rgba.len) : (pixel += 4) {
        if (atlas.rgba[pixel + 3] != 0) continue;
        try testing.expectEqualSlices(u8, &model_paint.EMPTY_ATLAS_TEXEL, atlas.rgba[pixel .. pixel + 4]);
        transparent = true;
        break;
    }
    try testing.expect(transparent);
}

test "moving one coplanar face breaks its UV edge without moving atlas pixels" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(908, &quad, 6);
    // Distinct authored faces share one continuous UV island through their common
    // mesh edge. This is the same topology as adjacent wedges in a cylinder cap.
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 1 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    try testing.expectEqual(@as(usize, 1), model_paint.layoutIslands().?.len);
    var original: [12]f32 = undefined;
    for (0..2) |face| {
        const triangle = model_paint.uvTriangle(@intCast(face)) orelse return error.TestUnexpectedResult;
        @memcpy(original[face * 6 ..][0..6], triangle.corners[0..]);
    }
    const fixed_atlas = atlasHash(model_paint.atlas().?.rgba);

    var detached = original;
    var coordinate: usize = 6;
    while (coordinate < detached.len) : (coordinate += 2) detached[coordinate] += 1;
    try testing.expect(model_paint.applyCornerUvs(&detached, &quad, 6));
    try testing.expectEqual(@as(usize, 2), model_paint.layoutIslands().?.len);
    try testing.expectEqual(fixed_atlas, atlasHash(model_paint.atlas().?.rgba));

    try testing.expect(model_paint.applyCornerUvs(&original, &quad, 6));
    try testing.expectEqual(@as(usize, 1), model_paint.layoutIslands().?.len);
    try testing.expectEqual(fixed_atlas, atlasHash(model_paint.atlas().?.rgba));
}

test "texture import adopts native dimensions without stretching UV geometry" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(909, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    var corners_before: [12]f32 = undefined;
    for (0..2) |face| {
        const triangle = model_paint.uvTriangle(@intCast(face)) orelse return error.TestUnexpectedResult;
        @memcpy(corners_before[face * 6 ..][0..6], triangle.corners[0..]);
    }
    const atlas_before = model_paint.atlas().?;
    const old_width: f32 = @floatFromInt(atlas_before.w);
    const old_height: f32 = @floatFromInt(atlas_before.h);
    const width: u32 = 37;
    const height: u32 = 19;
    var imported: [width * height * 4]u8 = undefined;
    for (&imported, 0..) |*byte, index| byte.* = @intCast(index % 251);

    try testing.expect(model_paint.importAtlasPreservingUvGeometry(&imported, width, height, &quad, 6));
    const atlas = model_paint.atlas().?;
    try testing.expectEqual(width, atlas.w);
    try testing.expectEqual(height, atlas.h);
    try testing.expectEqualSlices(u8, &imported, atlas.rgba);
    const new_width: f32 = @floatFromInt(width);
    const new_height: f32 = @floatFromInt(height);
    const scale = @min(new_width / old_width, new_height / old_height);
    const offset_x = (new_width - old_width * scale) * 0.5;
    const offset_y = (new_height - old_height * scale) * 0.5;
    for (0..6) |vertex| {
        const actual_x = quad[vertex * 8 + 6] * new_width;
        const actual_y = quad[vertex * 8 + 7] * new_height;
        try testing.expectApproxEqAbs(offset_x + corners_before[vertex * 2 + 0] * scale, actual_x, 0.0001);
        try testing.expectApproxEqAbs(offset_y + corners_before[vertex * 2 + 1] * scale, actual_y, 0.0001);
    }

    const fixed_hash = atlasHash(atlas.rgba);
    try testing.expect(!model_paint.importAtlasPreservingUvGeometry(imported[0 .. imported.len - 1], width, height, &quad, 6));
    try testing.expectEqual(fixed_hash, atlasHash(model_paint.atlas().?.rgba));
}

test "restore shape reprojects a distorted island with square texel aspect in place" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(910, &quad, 6);
    // Distinct authored triangles exercise the same coplanar joining used by a
    // cylinder cap fan rather than relying on one pre-grouped face.
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 1 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    var original: [12]f32 = undefined;
    for (0..2) |face| {
        const triangle = model_paint.uvTriangle(@intCast(face)) orelse return error.TestUnexpectedResult;
        @memcpy(original[face * 6 ..][0..6], triangle.corners[0..]);
    }
    const original_bounds = cornerBounds(&original);
    const center_y = (original_bounds.low_y + original_bounds.high_y) * 0.5;
    var distorted = original;
    var coordinate: usize = 1;
    while (coordinate < distorted.len) : (coordinate += 2) {
        distorted[coordinate] = center_y + (distorted[coordinate] - center_y) * 0.5;
    }
    try testing.expect(model_paint.applyCornerUvs(&distorted, &quad, 6));
    try testing.expectEqual(@as(usize, 1), model_paint.layoutIslands().?.len);

    var restored: [12]f32 = undefined;
    try testing.expect(model_paint.writeCanonicalIslandCorners(&.{0}, &restored));
    const distorted_bounds = cornerBounds(&distorted);
    const restored_bounds = cornerBounds(&restored);
    const restored_width = restored_bounds.high_x - restored_bounds.low_x;
    const restored_height = restored_bounds.high_y - restored_bounds.low_y;
    try testing.expectApproxEqAbs(restored_width, restored_height, 0.0001);
    try testing.expectApproxEqAbs((distorted_bounds.low_x + distorted_bounds.high_x) * 0.5, (restored_bounds.low_x + restored_bounds.high_x) * 0.5, 0.0001);
    try testing.expectApproxEqAbs((distorted_bounds.low_y + distorted_bounds.high_y) * 0.5, (restored_bounds.low_y + restored_bounds.high_y) * 0.5, 0.0001);
    try testing.expect(model_paint.applyCornerUvs(&restored, &quad, 6));

    // If the fan was broken into pieces, restoring all selected pieces uses their
    // shared canonical frame and welds coincident UV edges back into one island.
    var detached = restored;
    coordinate = 6;
    while (coordinate < detached.len) : (coordinate += 2) detached[coordinate] += 1;
    try testing.expect(model_paint.applyCornerUvs(&detached, &quad, 6));
    try testing.expectEqual(@as(usize, 2), model_paint.layoutIslands().?.len);
    var rejoined: [12]f32 = undefined;
    try testing.expect(model_paint.writeCanonicalIslandCorners(&.{ 0, 1 }, &rejoined));
    try testing.expect(model_paint.applyCornerUvs(&rejoined, &quad, 6));
    try testing.expectEqual(@as(usize, 1), model_paint.layoutIslands().?.len);
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

test "atlas carry keeps destination substrate outside the old face silhouette" {
    // The old and restored triangles intentionally share one authored identity and
    // bounding rect but only partly overlap. Undoing a topology edit can produce this:
    // the face identity survives while its triangle silhouette changes.
    var old = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
    };
    var restored = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    const groups = [_]u32{71};

    model_paint.setTarget(8801, &old, 3);
    model_paint.test_support.setFaceGroupsAndRebuild(&groups, &old, 3);
    model_paint.setDetail(32, &old, 3);
    model_paint.paintFace(0, .{ 240, 20, 10, model_paint.GLASS_ALPHA });
    model_paint.snapshotAtlasForCarry();

    // Match the edit install order: the new paint target lands first, then the
    // authoritative face groups trigger the carry rebuild.
    model_paint.setTarget(8802, &restored, 3);
    model_paint.test_support.setFaceGroupsAndRebuild(&groups, &restored, 3);
    defer {
        model_paint.setDetail(1, &restored, 3);
        model_paint.test_support.clearTargetAndSource();
        model_paint.dropAtlasCarry();
    }

    // Old rectangle padding must not overwrite newly exposed real face pixels.
    try testing.expectEqual(model_paint.DEFAULT_FACE, model_paint.sampleTexel(0, 0.10, 0.70).?);
    // Overlap keeps old RGB detail, while opacity remains owned by the restored face.
    try testing.expectEqual(@as([4]u8, .{ 240, 20, 10, 255 }), model_paint.sampleTexel(0, 0.40, 0.20).?);
}

test "append after stale topology preserves the raster and isolates the fresh part" {
    var initial = QUAD_VERTS;
    model_paint.setTarget(177, &initial, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &initial, 6);
    model_paint.setDetail(16, &initial, 6);
    model_paint.paintStamp(0, 0.15, 0.35, 3.0, .{ 255, 7, 11, 255 }, 1.0);

    const before_atlas = model_paint.atlas().?;
    const placeholder = model_paint.reserveNeutralPlaceholderUv() orelse return error.TestUnexpectedResult;
    const before = try testing.allocator.dupe(u8, before_atlas.rgba);
    defer testing.allocator.free(before);

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

    // A second Add Outliner operation runs while the atlas is already stale from
    // the first append. It still needs a neutral placeholder and another preserving
    // adoption, regardless of whether the next row is a saved mesh or a primitive.
    const second_placeholder = model_paint.reserveNeutralPlaceholderUv() orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(placeholder[0], second_placeholder[0], 1e-6);
    try testing.expectApproxEqAbs(placeholder[1], second_placeholder[1], 1e-6);
    const before_second = try testing.allocator.dupe(u8, model_paint.atlas().?.rgba);
    defer testing.allocator.free(before_second);

    var grown_again: [18 * 8]f32 = undefined;
    @memcpy(grown_again[0 .. 12 * 8], &grown);
    @memcpy(grown_again[12 * 8 ..], &initial);
    vertex = 12;
    while (vertex < 18) : (vertex += 1) {
        grown_again[vertex * 8 + 0] += 4.0;
        grown_again[vertex * 8 + 6] = second_placeholder[0];
        grown_again[vertex * 8 + 7] = second_placeholder[1];
    }
    try testing.expect(model_paint.setTargetPreservingAtlas(179, &grown_again, 18, &.{ 0, 0, 1, 1, 2, 2 }));
    const after_second = model_paint.atlas().?;
    try testing.expectEqualSlices(u8, before_second, after_second.rgba);
    try testing.expectEqual(model_paint.DEFAULT_FACE, model_paint.faceColor(4).?);
}

test "atlas coordinate revision changes on repack but not preserving adoption" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(179, &quad, 6);
    defer model_paint.test_support.clearTargetAndSource();

    const original_revision = model_paint.layoutRevision();
    try testing.expect(original_revision != 0);

    try testing.expect(model_paint.setTargetPreservingAtlas(180, &quad, 6, &.{ 0, 0 }));
    try testing.expectEqual(original_revision, model_paint.layoutRevision());

    model_paint.rebuildLayout(&quad, 6);
    try testing.expect(model_paint.layoutRevision() != original_revision);
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

test "removing a part can preserve moved UVs and the exact resident atlas" {
    var joined: [12 * 8]f32 = undefined;
    var survivor: [6 * 8]f32 = undefined;
    @memcpy(joined[0 .. 6 * 8], &QUAD_VERTS);
    @memcpy(joined[6 * 8 ..], &QUAD_VERTS);
    var vertex: usize = 6;
    while (vertex < 12) : (vertex += 1) joined[vertex * 8] += 2.0;

    model_paint.setTarget(911, &joined, 12);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0, 1, 1 }, &joined, 12);
    model_paint.setDetail(32, &joined, 12);
    defer {
        if (model_paint.faceCount() == 2)
            model_paint.setDetail(1, &survivor, 6)
        else
            model_paint.setDetail(1, &joined, 12);
        model_paint.test_support.clearTargetAndSource();
    }

    // Give the raster unmistakable non-flat content, then swap the two UV islands
    // over that fixed artwork exactly as a UV-panel transform does.
    const atlas = model_paint.atlas().?;
    const patterned = try testing.allocator.dupe(u8, atlas.rgba);
    defer testing.allocator.free(patterned);
    var pixel: usize = 0;
    while (pixel < patterned.len) : (pixel += 4) {
        patterned[pixel + 0] = @intCast((pixel / 4) % 251);
        patterned[pixel + 1] = @intCast(((pixel / 4) / atlas.w) % 251);
        patterned[pixel + 2] = 173;
    }
    try testing.expect(model_paint.setAtlas(patterned));
    model_paint.paintFaceAlpha(0, model_paint.GLASS_ALPHA);
    model_paint.paintFaceAlpha(1, model_paint.GLASS_ALPHA);

    var rects: [8]u32 = undefined;
    try testing.expect(model_paint.copyLayoutRects(&rects));
    const moved = [8]u32{
        rects[4], rects[5], rects[2], rects[3],
        rects[0], rects[1], rects[6], rects[7],
    };
    try testing.expect(model_paint.applyIslandRects(&moved, &joined, 12));
    const revision = model_paint.layoutRevision();
    const expected_atlas = try testing.allocator.dupe(u8, model_paint.atlas().?.rgba);
    defer testing.allocator.free(expected_atlas);
    @memcpy(&survivor, joined[6 * 8 ..]);

    // Delete the first part by adopting only the second part's indexed rows. The
    // deleted face was glass, so exact parented opacity must also replace the stale
    // by-index classification without rewriting the retained image.
    try testing.expect(model_paint.setTargetPreservingAtlas(912, &survivor, 6, &.{ 1, 1 }));
    try testing.expect(model_paint.setFaceAlphaMetadata(0, 255));
    try testing.expect(model_paint.setFaceAlphaMetadata(1, 255));

    try testing.expectEqual(revision, model_paint.layoutRevision());
    try testing.expectEqualSlices(u8, expected_atlas, model_paint.atlas().?.rgba);
    const triangle = model_paint.uvTriangle(0) orelse return error.TestUnexpectedResult;
    const width: f32 = @floatFromInt(atlas.w);
    const height: f32 = @floatFromInt(atlas.h);
    for (0..3) |corner| {
        try testing.expectApproxEqAbs(survivor[corner * 8 + 6] * width, triangle.corners[corner * 2 + 0], 0.0001);
        try testing.expectApproxEqAbs(survivor[corner * 8 + 7] * height, triangle.corners[corner * 2 + 1], 0.0001);
    }
    try testing.expect(!model_paint.faceIsGlass(0));
    try testing.expect(!model_paint.faceIsGlass(1));
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

    var outside = corners;
    outside[0] = -7;
    outside[1] = atlas_h_f + 11;
    try testing.expect(model_paint.applyCornerUvs(&outside, &quad, 6));
    try testing.expectEqualSlices(f32, outside[0..6], model_paint.uvTriangle(0).?.corners[0..]);
    try testing.expect(quad[6] < 0 and quad[7] > 1);

    const before_reject = model_paint.uvTriangle(0).?.corners;
    var invalid = outside;
    invalid[0] = std.math.nan(f32);
    try testing.expect(!model_paint.applyCornerUvs(&invalid, &quad, 6));
    try testing.expectEqualSlices(f32, before_reject[0..], model_paint.uvTriangle(0).?.corners[0..]);
    try testing.expectEqual(fixed_atlas_hash, atlasHash(model_paint.atlas().?.rgba));
}

test "workspace compile preserves alpha and translates UVs without resampling" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(913, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(16, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    var corners_before: [12]f32 = undefined;
    for (0..2) |face| {
        const triangle = model_paint.uvTriangle(@intCast(face)) orelse return error.TestUnexpectedResult;
        @memcpy(corners_before[face * 6 ..][0..6], triangle.corners[0..]);
    }
    const bounds = cornerBounds(&corners_before);
    const shift_x = -bounds.high_x - 3;
    const shift_y: f32 = 5;
    const width: u32 = 17;
    const height: u32 = 9;
    var compiled: [width * height * 4]u8 = undefined;
    for (0..width * height) |pixel| {
        compiled[pixel * 4 + 0] = @intCast(pixel % 251);
        compiled[pixel * 4 + 1] = 37;
        compiled[pixel * 4 + 2] = 91;
        compiled[pixel * 4 + 3] = if (pixel % 3 == 0) 0 else 173;
    }

    try testing.expect(model_paint.importAtlasTranslatingUvGeometry(
        &compiled,
        width,
        height,
        shift_x,
        shift_y,
        &quad,
        6,
    ));
    try testing.expectEqualSlices(u8, &compiled, model_paint.atlas().?.rgba);
    for (0..6) |vertex| {
        const expected_x = corners_before[vertex * 2 + 0] + shift_x;
        const expected_y = corners_before[vertex * 2 + 1] + shift_y;
        try testing.expectApproxEqAbs(expected_x, model_paint.uvTriangle(@intCast(vertex / 3)).?.corners[(vertex % 3) * 2 + 0], 0.0001);
        try testing.expectApproxEqAbs(expected_y, model_paint.uvTriangle(@intCast(vertex / 3)).?.corners[(vertex % 3) * 2 + 1], 0.0001);
        try testing.expectApproxEqAbs(expected_x / @as(f32, @floatFromInt(width)), quad[vertex * 8 + 6], 0.0001);
        try testing.expectApproxEqAbs(expected_y / @as(f32, @floatFromInt(height)), quad[vertex * 8 + 7], 0.0001);
    }
}

test "painting a UV over transparent atlas space reveals ink and preserves glass opacity" {
    var quad = QUAD_VERTS;
    model_paint.setTarget(910, &quad, 6);
    model_paint.test_support.setFaceGroupsAndRebuild(&.{ 0, 0 }, &quad, 6);
    model_paint.setDetail(32, &quad, 6);
    defer {
        model_paint.setDetail(1, &quad, 6);
        model_paint.test_support.clearTargetAndSource();
    }

    model_paint.paintFaceAlpha(0, 87);
    const atlas = model_paint.atlas().?;
    const transparent = try testing.allocator.alloc(u8, atlas.rgba.len);
    defer testing.allocator.free(transparent);
    @memset(transparent, 0);
    try testing.expect(model_paint.setAtlas(transparent));

    model_paint.paintStamp(0, 0.33, 0.33, 4, .{ 7, 239, 113, 255 }, 1);
    const brushed = model_paint.sampleTexel(0, 0.33, 0.33) orelse return error.TestUnexpectedResult;
    try testing.expectEqualSlices(u8, &[_]u8{ 7, 239, 113, 87 }, brushed[0..]);

    try testing.expect(model_paint.setAtlas(transparent));
    model_paint.paintFaceRgb(0, .{ 251, 101, 17 });
    const filled = model_paint.sampleTexel(0, 0.33, 0.33) orelse return error.TestUnexpectedResult;
    try testing.expectEqualSlices(u8, &[_]u8{ 251, 101, 17, 87 }, filled[0..]);
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
