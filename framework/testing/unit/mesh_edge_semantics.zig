//! Focused durable named-edge semantics proofs.
//! Run: zig build test-mesh-edge-semantics

const std = @import("std");
const testing = std.testing;
const semantics = @import("mesh_edge_semantics");

test "selected edges canonicalize independently of table order and direction" {
    const selected = [_]semantics.Edge{
        .{ .a = 9, .b = 5, .part = 3 },
        .{ .a = 2, .b = 5, .part = 3 },
        .{ .a = 12, .b = 9, .part = 3 },
    };
    var path = try semantics.canonicalPathAlloc(testing.allocator, &selected);
    defer path.deinit();
    try testing.expect(!path.closed);
    try testing.expectEqual(@as(u32, 3), path.part);
    try testing.expectEqualSlices(u32, &.{ 2, 5, 9, 12 }, path.vertices);
}

test "closed paths choose the smallest id and smaller first neighbor" {
    const selected = [_]semantics.Edge{
        .{ .a = 8, .b = 3, .part = 1 },
        .{ .a = 6, .b = 8, .part = 1 },
        .{ .a = 3, .b = 6, .part = 1 },
    };
    var path = try semantics.canonicalPathAlloc(testing.allocator, &selected);
    defer path.deinit();
    try testing.expect(path.closed);
    try testing.expectEqualSlices(u32, &.{ 3, 6, 8 }, path.vertices);
}

test "branch disconnected duplicate collapsed and mixed-part selections refuse" {
    try testing.expectError(error.Branched, semantics.canonicalPathAlloc(testing.allocator, &.{
        .{ .a = 1, .b = 2, .part = 0 }, .{ .a = 1, .b = 3, .part = 0 }, .{ .a = 1, .b = 4, .part = 0 },
    }));
    try testing.expectError(error.Disconnected, semantics.canonicalPathAlloc(testing.allocator, &.{
        .{ .a = 1, .b = 2, .part = 0 }, .{ .a = 3, .b = 4, .part = 0 },
    }));
    try testing.expectError(error.DuplicateEdge, semantics.canonicalPathAlloc(testing.allocator, &.{
        .{ .a = 1, .b = 2, .part = 0 }, .{ .a = 2, .b = 1, .part = 0 },
    }));
    try testing.expectError(error.CollapsedEdge, semantics.canonicalPathAlloc(testing.allocator, &.{
        .{ .a = 1, .b = 1, .part = 0 },
    }));
    try testing.expectError(error.MixedPart, semantics.canonicalPathAlloc(testing.allocator, &.{
        .{ .a = 1, .b = 2, .part = 0 }, .{ .a = 2, .b = 3, .part = 1 },
    }));
}

test "edge row shares global semantic identity and survives unknown table fields" {
    var path = try semantics.canonicalPathAlloc(testing.allocator, &.{
        .{ .a = 90, .b = 100, .part = 4 }, .{ .a = 100, .b = 120, .part = 4 },
    });
    defer path.deinit();
    var assigned = try semantics.appendRegionAlloc(
        testing.allocator,
        "{\"version\":1,\"regions\":[{\"id\":7,\"name\":\"hood\"}],\"nextRegionId\":8,\"future\":{\"kept\":true}}",
        "hood.hinge",
        .hinge,
        "object-hood",
        path,
    );
    defer assigned.deinit();
    try testing.expectEqual(@as(u32, 8), assigned.id);
    try testing.expect(semantics.validateTableJson(testing.allocator, assigned.json));
    try testing.expect(std.mem.indexOf(u8, assigned.json, "\"future\"") != null);
    try testing.expect(std.mem.indexOf(u8, assigned.json, "\"vertices\":[90,100,120]") != null);
    var loaded = try semantics.regionByIdAlloc(testing.allocator, assigned.json, assigned.id);
    defer loaded.deinit();
    try testing.expectEqualStrings("hood.hinge", loaded.name);
    try testing.expectEqual(semantics.Role.hinge, loaded.role);
    try testing.expectEqualStrings("object-hood", loaded.object_id);
    try testing.expectEqualSlices(u32, path.vertices, loaded.vertices);
    try testing.expectError(error.DuplicateName, semantics.appendRegionAlloc(
        testing.allocator,
        assigned.json,
        "hood",
        .boundary,
        "object-hood",
        path,
    ));
}

test "save snapshot remaps sparse logical ids without changing other semantics" {
    const table = "{\"version\":1,\"regions\":[{\"id\":2,\"name\":\"body\"}],\"edgeRegions\":[{\"id\":3,\"name\":\"hood.hinge\",\"role\":\"hinge\",\"objectId\":\"object-hood\",\"closed\":false,\"vertices\":[90,100,120]}],\"nextRegionId\":4}";
    const saved = try semantics.remapForSnapshotAlloc(testing.allocator, table, &.{ 20, 90, 100, 120 });
    defer testing.allocator.free(saved);
    try testing.expect(semantics.validateTableJson(testing.allocator, saved));
    try testing.expect(std.mem.indexOf(u8, saved, "\"vertices\":[1,2,3]") != null);
    try testing.expect(std.mem.indexOf(u8, saved, "\"name\":\"body\"") != null);
    try testing.expectError(error.LogicalIdMissing, semantics.remapForSnapshotAlloc(testing.allocator, table, &.{ 90, 120 }));
}

test "migration accepts real authored edges and rejects an internal face diagonal" {
    const logical_rows = [_]u32{ 0, 1, 2, 1, 3, 2 };
    const groups = [_]u32{ 7, 7 };
    const perimeter = "{\"version\":1,\"regions\":[],\"edgeRegions\":[{\"id\":19,\"name\":\"test\",\"role\":\"hinge\",\"objectId\":\"car_body\",\"closed\":false,\"vertices\":[0,1]}]}";
    try testing.expectEqual(@as(usize, 1), try semantics.edgeRegionCount(testing.allocator, perimeter));
    try testing.expect(try semantics.pathsResolveInTopology(
        testing.allocator,
        perimeter,
        &logical_rows,
        4,
        &groups,
    ));

    const diagonal = "{\"version\":1,\"regions\":[],\"edgeRegions\":[{\"id\":19,\"name\":\"test\",\"role\":\"hinge\",\"objectId\":\"car_body\",\"closed\":false,\"vertices\":[1,2]}]}";
    try testing.expect(!try semantics.pathsResolveInTopology(
        testing.allocator,
        diagonal,
        &logical_rows,
        4,
        &groups,
    ));
}

test "invalid edge rows never enter the durable table" {
    try testing.expect(!semantics.validateTableJson(testing.allocator, "{\"version\":1,\"regions\":[],\"edgeRegions\":[{\"id\":0,\"name\":\"bad\",\"role\":\"hinge\",\"objectId\":\"door\",\"closed\":false,\"vertices\":[1,1]}]}"));
    try testing.expect(!semantics.validateTableJson(testing.allocator, "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"same\"}],\"edgeRegions\":[{\"id\":1,\"name\":\"same\",\"role\":\"hinge\",\"objectId\":\"door\",\"closed\":false,\"vertices\":[1,2]}]}"));
    try testing.expect(!semantics.validateTableJson(testing.allocator, "{\"version\":1,\"regions\":[],\"edgeRegions\":[{\"id\":1,\"name\":\"bad-role\",\"role\":\"wheel\",\"objectId\":\"door\",\"closed\":false,\"vertices\":[1,2]}]}"));
}
