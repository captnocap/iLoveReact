//! Semantic membership and repeated-instance boundary tests.
//! Run: zig build test-mesh-semantics

const std = @import("std");
const testing = std.testing;
const semantics = @import("mesh_semantics");

test "a copied semantic family receives fresh instance ids without losing names" {
    const existing = [_]u32{ 0, 0, 3, semantics.NO_ID };
    const regions = [_]u32{ 7, 7, 8, semantics.NO_ID };
    var instances = [_]u32{ 0, 0, 2, 19 };
    try semantics.reinstanceCopy(testing.allocator, existing[0..], regions[0..], instances[0..]);
    try testing.expectEqualSlices(u32, &.{ 4, 4, 5, semantics.NO_ID }, instances[0..]);
}

test "separate copies of one family receive disjoint instance ids" {
    const regions = [_]u32{ 7, 7 };
    var first = [_]u32{ 0, 0 };
    try semantics.reinstanceCopy(testing.allocator, &.{0}, regions[0..], first[0..]);
    var second = [_]u32{ 0, 0 };
    try semantics.reinstanceCopy(testing.allocator, &.{ 0, first[0] }, regions[0..], second[0..]);
    try testing.expectEqual(@as(u32, 1), first[0]);
    try testing.expectEqual(@as(u32, 2), second[0]);
}

test "primitive creation assigns a fixed cap wall and axis role vocabulary" {
    try testing.expectEqual(@as(usize, 3), semantics.primitiveRoleCount(.cylinder));
    try testing.expectEqual(@as(?usize, 0), semantics.primitiveRole(.cylinder, .{ 0, 1, 0 }));
    try testing.expectEqual(@as(?usize, 1), semantics.primitiveRole(.cylinder, .{ 0, -1, 0 }));
    try testing.expectEqual(@as(?usize, 2), semantics.primitiveRole(.cylinder, .{ 1, 0, 0 }));
    try testing.expectEqual(@as(?usize, 4), semantics.primitiveRole(.cube, .{ 0, 0, 1 }));
}
