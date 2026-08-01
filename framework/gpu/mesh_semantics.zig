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

pub const PrimitiveKind = enum { cube, cylinder, cone, pyramid, plane, sphere, icosphere };
const primitive_axis_role_threshold: f32 = 0.9;

pub fn primitiveRoleCount(kind: PrimitiveKind) usize {
    return switch (kind) {
        .cube => 6,
        .cylinder => 3,
        .cone, .pyramid => 2,
        .plane, .sphere, .icosphere => 1,
    };
}

/// Fixed role vocabulary for resident generators. The role is captured while the
/// primitive is still in its canonical +Y-axis frame, before later transforms make
/// geometric inference ambiguous.
pub fn primitiveRole(kind: PrimitiveKind, normal: [3]f32) ?usize {
    return switch (kind) {
        .cube => blk: {
            var axis: usize = 0;
            if (@abs(normal[1]) > @abs(normal[axis])) axis = 1;
            if (@abs(normal[2]) > @abs(normal[axis])) axis = 2;
            if (@abs(normal[axis]) < primitive_axis_role_threshold) return null;
            break :blk axis * 2 + @as(usize, if (normal[axis] >= 0) 0 else 1);
        },
        .cylinder => if (normal[1] >= primitive_axis_role_threshold) 0 else if (normal[1] <= -primitive_axis_role_threshold) 1 else 2,
        .cone, .pyramid => if (normal[1] <= -primitive_axis_role_threshold) 0 else 1,
        .plane, .sphere, .icosphere => 0,
    };
}

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

/// A copied part keeps its region vocabulary but becomes a fresh occurrence of
/// each source instance family. Equal source instance ids stay equal within one
/// copy; different copies receive disjoint ids. Unnamed faces remain semantic debt.
pub fn reinstanceCopy(
    allocator: std.mem.Allocator,
    existing_instances: []const u32,
    copied_regions: []const u32,
    copied_instances: []u32,
) !void {
    if (copied_regions.len != copied_instances.len) return error.InvalidSemanticRows;
    var next: u32 = 0;
    for (existing_instances) |instance| {
        if (instance != NO_ID and instance >= next) {
            if (instance == NO_ID - 1) return error.InstanceIdExhausted;
            next = instance + 1;
        }
    }
    var families = std.AutoHashMap(u32, u32).init(allocator);
    defer families.deinit();
    for (copied_regions, copied_instances) |region, *instance| {
        if (region == NO_ID) {
            instance.* = NO_ID;
            continue;
        }
        const entry = try families.getOrPut(instance.*);
        if (!entry.found_existing) {
            if (next == NO_ID) return error.InstanceIdExhausted;
            entry.value_ptr.* = next;
            next += 1;
        }
        instance.* = entry.value_ptr.*;
    }
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

test "resident primitive roles split caps walls and cube sides deterministically" {
    try std.testing.expectEqual(@as(?usize, 0), primitiveRole(.cylinder, .{ 0, 1, 0 }));
    try std.testing.expectEqual(@as(?usize, 1), primitiveRole(.cylinder, .{ 0, -1, 0 }));
    try std.testing.expectEqual(@as(?usize, 2), primitiveRole(.cylinder, .{ 1, 0, 0 }));
    try std.testing.expectEqual(@as(?usize, 4), primitiveRole(.cube, .{ 0, 0, 1 }));
    try std.testing.expectEqual(@as(usize, 2), primitiveRoleCount(.pyramid));
}
