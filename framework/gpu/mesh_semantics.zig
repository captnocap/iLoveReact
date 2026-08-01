//! Durable semantic membership for editable mesh faces.
//!
//! Geometry groups answer topology/editing questions and deliberately split during
//! cuts. Semantic regions answer what a surface means and therefore inherit across
//! those splits. Names and hierarchy live in the document dictionary; native topology
//! only needs the stable region and repetition-instance identities carried here.

const std = @import("std");

pub const NO_ID: u32 = std.math.maxInt(u32);

pub const Face = struct {
    region: u32 = NO_ID,
    instance: u32 = NO_ID,

    pub fn isNamed(self: Face) bool {
        return self.region != NO_ID;
    }
};

pub fn eql(a: Face, b: Face) bool {
    return a.region == b.region and a.instance == b.instance;
}

/// Merging two different meanings must never silently choose a winner. The result is
/// explicit semantic debt for the caller to surface and resolve.
pub fn merged(a: Face, b: Face) Face {
    return if (eql(a, b)) a else .{};
}

pub fn rowsValid(regions: ?[]const u32, instances: ?[]const u32, face_count: usize) bool {
    if (regions == null and instances == null) return true;
    const region_rows = regions orelse return false;
    const instance_rows = instances orelse return false;
    if (region_rows.len != face_count or instance_rows.len != face_count) return false;
    for (region_rows, instance_rows) |region, instance| {
        if (region == NO_ID and instance != NO_ID) return false;
    }
    return true;
}

pub fn unnamedCount(regions: ?[]const u32, face_count: usize) usize {
    const rows = regions orelse return face_count;
    if (rows.len != face_count) return face_count;
    var count: usize = 0;
    for (rows) |region| if (region == NO_ID) {
        count += 1;
    };
    return count;
}

test "semantic rows are paired and an instance cannot exist without a region" {
    try std.testing.expect(rowsValid(null, null, 2));
    try std.testing.expect(rowsValid(&.{ 1, 2 }, &.{ 0, NO_ID }, 2));
    try std.testing.expect(!rowsValid(&.{1}, null, 1));
    try std.testing.expect(!rowsValid(&.{NO_ID}, &.{0}, 1));
}

test "conflicting face meanings become explicit debt" {
    const window = Face{ .region = 7, .instance = 2 };
    try std.testing.expect(eql(window, merged(window, window)));
    try std.testing.expect(!merged(window, .{ .region = 8, .instance = 2 }).isNamed());
    try std.testing.expectEqual(@as(usize, 2), unnamedCount(&.{ NO_ID, 3, NO_ID }, 3));
}
