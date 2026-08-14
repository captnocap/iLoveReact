//! Focused native contract tests for semantic building architecture.
//! Run: zig build test-building-architecture -Doptimize=ReleaseFast

const std = @import("std");
const testing = std.testing;
const architecture = @import("building_architecture");

test "facade constructs and owns one integer-u wall source" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const vertices = try allocator.alloc(architecture.types.WallVertex, 2);
    vertices[0] = .{
        .id = try allocator.dupe(u8, "draw-1:v:0"),
        .floor = 0,
        .x_u = 0,
        .z_u = 0,
    };
    vertices[1] = .{
        .id = try allocator.dupe(u8, "draw-1:v:1"),
        .floor = 0,
        .x_u = 16,
        .z_u = 0,
    };

    const edges = try allocator.alloc(architecture.types.WallEdge, 1);
    edges[0] = .{
        .id = try allocator.dupe(u8, "draw-1:e:0"),
        .start_vertex_id = try allocator.dupe(u8, "draw-1:v:0"),
        .end_vertex_id = try allocator.dupe(u8, "draw-1:v:1"),
        .support = .{ .absolute = .{ .base_y_u = 0 } },
        .height_u = 48,
        .thickness_u = 4,
        .profile = .full,
        .style_id = try allocator.dupe(u8, "build:wall:style:smoke"),
        .side_a = .{ .material_id = try allocator.dupe(u8, "material:plaster") },
        .side_b = .{ .material_id = try allocator.dupe(u8, "material:brick") },
        .openings = try allocator.alloc(architecture.types.WallOpening, 0),
    };

    var source = architecture.ArchitectureSource{
        .version = architecture.source_version,
        .revision = 0,
        .walls = .{
            .vertices = vertices,
            .edges = edges,
            .anchors = try allocator.alloc(architecture.types.WallAnchor, 0),
        },
    };
    defer source.deinit(allocator);

    try testing.expectEqual(@as(u16, 1), source.version);
    try testing.expectEqual(@as(usize, 2), source.walls.vertices.len);
    try testing.expectEqual(@as(architecture.Unit, 16), source.walls.vertices[1].x_u);
    try testing.expectEqualStrings("material:plaster", source.walls.edges[0].side_a.material_id);
    try testing.expectEqualStrings("material:brick", source.walls.edges[0].side_b.material_id);
}

test "facade preserves the exact 16-u to 1-m contract" {
    try testing.expectEqual(@as(architecture.Unit, 16), architecture.units_per_meter);
    try testing.expectEqual(@as(f32, 1.0), architecture.unitsToMeters(16));
    try testing.expectEqual(@as(f32, -1.0), architecture.unitsToMeters(-16));
}
