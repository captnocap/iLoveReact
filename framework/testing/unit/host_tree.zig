//! Regression coverage for keyed React child placement in the native tree.

const std = @import("std");
const host_tree = @import("host_tree");

test "append repositions a child instead of duplicating it" {
    host_tree.init(std.testing.allocator);
    defer host_tree.deinit();

    try host_tree.appendChild(10, 1);
    try host_tree.appendChild(10, 2);
    try host_tree.appendChild(10, 1);

    try std.testing.expectEqualSlices(u32, &.{ 2, 1 }, host_tree.getChildren(10));
    try std.testing.expectEqual(@as(?u32, 10), host_tree.getParent(1));
}

test "insert-before repositions a child exactly once" {
    host_tree.init(std.testing.allocator);
    defer host_tree.deinit();

    try host_tree.appendChild(10, 1);
    try host_tree.appendChild(10, 2);
    try host_tree.appendChild(10, 3);
    try host_tree.insertBefore(10, 3, 1);

    try std.testing.expectEqualSlices(u32, &.{ 3, 1, 2 }, host_tree.getChildren(10));
}

test "placement detaches a child from its previous parent and root" {
    host_tree.init(std.testing.allocator);
    defer host_tree.deinit();

    try host_tree.appendChild(10, 1);
    try host_tree.appendChild(20, 1);
    try std.testing.expectEqual(@as(usize, 0), host_tree.getChildren(10).len);
    try std.testing.expectEqualSlices(u32, &.{1}, host_tree.getChildren(20));

    try host_tree.appendToRoot(1);
    try std.testing.expectEqual(@as(usize, 0), host_tree.getChildren(20).len);
    try std.testing.expectEqualSlices(u32, &.{1}, host_tree.getRootChildren());
    try std.testing.expectEqual(@as(?u32, null), host_tree.getParent(1));
}
