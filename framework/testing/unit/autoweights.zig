//! Focused logical-topology auto-weight solver proofs.
//!
//! Direct run:
//! tools/zig/zig test -OReleaseFast --dep autoweights \
//!   -Mroot=framework/testing/unit/autoweights.zig \
//!   -Mautoweights=framework/skeleton/autoweights.zig

const std = @import("std");
const testing = std.testing;
const weights = @import("autoweights");

const OwnedMesh = struct {
    allocator: std.mem.Allocator,
    positions: []weights.Vec3,
    triangles: [][3]u32,
    offsets: []u32,
    neighbors: []u32,

    fn deinit(self: *OwnedMesh) void {
        self.allocator.free(self.positions);
        self.allocator.free(self.triangles);
        self.allocator.free(self.offsets);
        self.allocator.free(self.neighbors);
        self.* = undefined;
    }

    fn view(self: *const OwnedMesh) weights.LogicalMesh {
        return .{
            .positions = self.positions,
            .triangles = self.triangles,
            .adjacency = .{ .offsets = self.offsets, .neighbors = self.neighbors },
        };
    }
};

fn meshFromRows(
    allocator: std.mem.Allocator,
    positions: []const weights.Vec3,
    triangles: []const [3]u32,
) !OwnedMesh {
    const owned_positions = try allocator.dupe(weights.Vec3, positions);
    errdefer allocator.free(owned_positions);
    const owned_triangles = try allocator.dupe([3]u32, triangles);
    errdefer allocator.free(owned_triangles);

    const matrix = try allocator.alloc(bool, positions.len * positions.len);
    defer allocator.free(matrix);
    @memset(matrix, false);
    for (triangles) |triangle| {
        for (0..3) |edge| {
            const a: usize = triangle[edge];
            const b: usize = triangle[(edge + 1) % 3];
            matrix[a * positions.len + b] = true;
            matrix[b * positions.len + a] = true;
        }
    }

    const offsets = try allocator.alloc(u32, positions.len + 1);
    errdefer allocator.free(offsets);
    offsets[0] = 0;
    for (0..positions.len) |vertex| {
        var degree: u32 = 0;
        for (0..positions.len) |neighbor| {
            if (matrix[vertex * positions.len + neighbor]) degree += 1;
        }
        offsets[vertex + 1] = offsets[vertex] + degree;
    }
    const neighbors = try allocator.alloc(u32, offsets[positions.len]);
    errdefer allocator.free(neighbors);
    var at: usize = 0;
    for (0..positions.len) |vertex| {
        for (0..positions.len) |neighbor| {
            if (!matrix[vertex * positions.len + neighbor]) continue;
            neighbors[at] = @intCast(neighbor);
            at += 1;
        }
    }
    return .{
        .allocator = allocator,
        .positions = owned_positions,
        .triangles = owned_triangles,
        .offsets = offsets,
        .neighbors = neighbors,
    };
}

fn segmentedPrism(allocator: std.mem.Allocator) !OwnedMesh {
    const ring_count: usize = 11;
    const positions = try allocator.alloc(weights.Vec3, ring_count * 4);
    defer allocator.free(positions);
    for (0..ring_count) |ring| {
        const x = -2.0 + @as(f32, @floatFromInt(ring)) * 0.4;
        positions[ring * 4 + 0] = .{ x, -0.25, -0.25 };
        positions[ring * 4 + 1] = .{ x, 0.25, -0.25 };
        positions[ring * 4 + 2] = .{ x, 0.25, 0.25 };
        positions[ring * 4 + 3] = .{ x, -0.25, 0.25 };
    }
    var triangles: std.ArrayList([3]u32) = .empty;
    defer triangles.deinit(allocator);
    for (0..ring_count - 1) |ring| {
        for (0..4) |side| {
            const next_side = (side + 1) % 4;
            const a: u32 = @intCast(ring * 4 + side);
            const b: u32 = @intCast(ring * 4 + next_side);
            const c: u32 = @intCast((ring + 1) * 4 + next_side);
            const d: u32 = @intCast((ring + 1) * 4 + side);
            try triangles.append(allocator, .{ a, b, c });
            try triangles.append(allocator, .{ a, c, d });
        }
    }
    const last: u32 = @intCast((ring_count - 1) * 4);
    try triangles.appendSlice(allocator, &.{
        .{ 0, 2, 1 },
        .{ 0, 3, 2 },
        .{ last, last + 1, last + 2 },
        .{ last, last + 2, last + 3 },
    });
    return meshFromRows(allocator, positions, triangles.items);
}

fn ringRange(allocator: std.mem.Allocator, first: usize, last_inclusive: usize) ![]u32 {
    const rows = try allocator.alloc(u32, (last_inclusive - first + 1) * 4);
    var at: usize = 0;
    for (first..last_inclusive + 1) |ring| {
        for (0..4) |corner| {
            rows[at] = @intCast(ring * 4 + corner);
            at += 1;
        }
    }
    return rows;
}

const BONES = [_]weights.BoneSegment{
    .{ .origin = .{ -2, 0, 0 }, .tip = .{ -2, 0, 0 }, .weighted = false },
    .{ .parent_index = 0, .origin = .{ -2, 0, 0 }, .tip = .{ 0, 0, 0 } },
    .{ .parent_index = 1, .origin = .{ 0, 0, 0 }, .tip = .{ 2, 0, 0 } },
};

fn weightFor(row: weights.InfluenceRow, bone: u16) f32 {
    for (row.bone_indices, row.weights) |candidate, value| {
        if (candidate == bone) return value;
    }
    return 0;
}

fn exactRow(bone: u16) weights.InfluenceRow {
    return .{
        .bone_indices = .{ bone, weights.UNUSED_BONE, weights.UNUSED_BONE, weights.UNUSED_BONE },
        .weights = .{ 1, 0, 0, 0 },
    };
}

fn expectValidRows(rows: []const weights.InfluenceRow) !void {
    for (rows) |row| {
        var sum: f32 = 0;
        var previous = std.math.inf(f32);
        for (row.bone_indices, row.weights) |bone, value| {
            try testing.expect(std.math.isFinite(value));
            try testing.expect(value <= previous + 1.0e-6);
            previous = value;
            if (bone == weights.UNUSED_BONE) {
                try testing.expectEqual(@as(f32, 0), value);
            } else {
                try testing.expect(value > 0);
                sum += value;
            }
        }
        try testing.expectApproxEqAbs(@as(f32, 1), sum, 1.0e-5);
    }
}

test "body solve uses 96x32x32 logical voxels, two-ring cores, and a welded joint transition" {
    var mesh = try segmentedPrism(testing.allocator);
    defer mesh.deinit();
    const left = try ringRange(testing.allocator, 0, 5);
    defer testing.allocator.free(left);
    const right = try ringRange(testing.allocator, 5, 10);
    defer testing.allocator.free(right);
    const semantics = [_]weights.SemanticRegion{
        .{ .semantic = .{ .role = .upper_arm, .side = .left }, .bone_index = 1, .logical_vertices = left },
        .{ .semantic = .{ .role = .lower_arm, .side = .left }, .bone_index = 2, .logical_vertices = right },
    };
    const output = try testing.allocator.alloc(weights.InfluenceRow, mesh.positions.len);
    defer testing.allocator.free(output);

    const stats = try weights.solveObject(testing.allocator, .{
        .object_id = "body",
        .mesh = mesh.view(),
        .semantic_regions = &semantics,
        .binding = .body,
        .bones = &BONES,
    }, output);

    try testing.expectEqualSlices(u16, &[_]u16{ 96, 32, 32 }, &stats.grid_occupied_axis_cells);
    try testing.expectEqual(@as(usize, 32), stats.semantic_core_vertices);
    try testing.expectEqual(@as(f32, 1), weightFor(output[0], 1));
    try testing.expectEqual(@as(f32, 1), weightFor(output[10 * 4], 2));
    const elbow = output[5 * 4];
    try testing.expect(weightFor(elbow, 1) > 0.25);
    try testing.expect(weightFor(elbow, 2) > 0.25);
    try expectValidRows(output);

    // The prism lowers to many render corners, but every duplicate resolves one
    // already-solved logical row; the solver has no positional weld phase.
    const corner_a = mesh.triangles[0][0];
    const corner_b = mesh.triangles[1][0];
    try testing.expectEqual(corner_a, corner_b);
    try testing.expectEqualDeep(output[corner_a], output[corner_b]);
}

test "semantic-free deformable projects from explicit solved-body weights" {
    const body_positions = [_]weights.Vec3{
        .{ 0, 0, 0 },
        .{ 2, 0, 0 },
        .{ 0, 2, 0 },
    };
    const body_triangles = [_][3]u32{.{ 0, 1, 2 }};
    const body_rows = [_]weights.InfluenceRow{
        .{ .bone_indices = .{ 1, weights.UNUSED_BONE, weights.UNUSED_BONE, weights.UNUSED_BONE }, .weights = .{ 1, 0, 0, 0 } },
        .{ .bone_indices = .{ 2, weights.UNUSED_BONE, weights.UNUSED_BONE, weights.UNUSED_BONE }, .weights = .{ 1, 0, 0, 0 } },
        .{ .bone_indices = .{ 1, weights.UNUSED_BONE, weights.UNUSED_BONE, weights.UNUSED_BONE }, .weights = .{ 1, 0, 0, 0 } },
    };
    const cloth_positions = [_]weights.Vec3{
        .{ 0.1, 0.1, 0.2 },
        .{ 0.3, 0.1, 0.2 },
        .{ 0.1, 0.3, 0.2 },
    };
    const triangle = [_][3]u32{.{ 0, 1, 2 }};
    var cloth = try meshFromRows(testing.allocator, &cloth_positions, &triangle);
    defer cloth.deinit();
    var output: [3]weights.InfluenceRow = undefined;

    const stats = try weights.solveObject(testing.allocator, .{
        .object_id = "shirt",
        .mesh = cloth.view(),
        .semantic_regions = &.{},
        .binding = .deformable,
        .bones = &BONES,
        .body_weights = .{
            .positions = &body_positions,
            .triangles = &body_triangles,
            .weights = &body_rows,
        },
    }, &output);

    try testing.expectEqual(@as(usize, 3), stats.projected_vertices);
    for (output) |row| try testing.expect(weightFor(row, 1) > weightFor(row, 2));
    try expectValidRows(&output);
}

test "deformable objects solve independently and prefer their own semantic roles" {
    const positions = [_]weights.Vec3{
        .{ -0.5, 0, 0 },
        .{ 0.5, 0, 0 },
        .{ 0, 0.5, 0 },
    };
    const triangles = [_][3]u32{.{ 0, 1, 2 }};
    var first = try meshFromRows(testing.allocator, &positions, &triangles);
    defer first.deinit();
    var second = try meshFromRows(testing.allocator, &positions, &triangles);
    defer second.deinit();
    const all = [_]u32{ 0, 1, 2 };
    const first_semantics = [_]weights.SemanticRegion{.{
        .semantic = .{ .role = .hand, .side = .left },
        .bone_index = 1,
        .logical_vertices = &all,
    }};
    const second_semantics = [_]weights.SemanticRegion{.{
        .semantic = .{ .role = .hand, .side = .right },
        .bone_index = 2,
        .logical_vertices = &all,
    }};
    const projected_rows = [_]weights.InfluenceRow{ exactRow(2), exactRow(2), exactRow(2) };
    const projected_body = weights.SolvedBody{
        .positions = &positions,
        .triangles = &triangles,
        .weights = &projected_rows,
    };
    var first_output: [3]weights.InfluenceRow = undefined;
    var second_output: [3]weights.InfluenceRow = undefined;

    _ = try weights.solveObject(testing.allocator, .{
        .object_id = "left-glove",
        .mesh = first.view(),
        .semantic_regions = &first_semantics,
        .binding = .deformable,
        .bones = &BONES,
        .body_weights = projected_body,
    }, &first_output);
    _ = try weights.solveObject(testing.allocator, .{
        .object_id = "right-glove",
        .mesh = second.view(),
        .semantic_regions = &second_semantics,
        .binding = .deformable,
        .bones = &BONES,
    }, &second_output);

    for (first_output) |row| try testing.expectEqual(@as(f32, 1), weightFor(row, 1));
    for (second_output) |row| try testing.expectEqual(@as(f32, 1), weightFor(row, 2));
}

test "rigid binding is exact and a deformable cannot hide a missing body solve" {
    const positions = [_]weights.Vec3{
        .{ 0, 0, 0 },
        .{ 1, 0, 0 },
        .{ 0, 1, 0 },
    };
    const triangles = [_][3]u32{.{ 0, 1, 2 }};
    var accessory = try meshFromRows(testing.allocator, &positions, &triangles);
    defer accessory.deinit();
    var output: [3]weights.InfluenceRow = undefined;

    _ = try weights.solveObject(testing.allocator, .{
        .object_id = "watch",
        .mesh = accessory.view(),
        .semantic_regions = &.{},
        .binding = .{ .rigid = 2 },
        .bones = &BONES,
    }, &output);
    for (output) |row| {
        try testing.expectEqualSlices(u16, &[_]u16{ 2, weights.UNUSED_BONE, weights.UNUSED_BONE, weights.UNUSED_BONE }, &row.bone_indices);
        try testing.expectEqualSlices(f32, &[_]f32{ 1, 0, 0, 0 }, &row.weights);
    }

    try testing.expectError(error.MissingSolvedBody, weights.solveObject(testing.allocator, .{
        .object_id = "loose-cloth",
        .mesh = accessory.view(),
        .semantic_regions = &.{},
        .binding = .deformable,
        .bones = &BONES,
    }, &output));
}

test "adjacency is object-local, symmetric, and contains every logical triangle edge" {
    const positions = [_]weights.Vec3{
        .{ 0, 0, 0 },
        .{ 1, 0, 0 },
        .{ 0, 1, 0 },
    };
    const triangles = [_][3]u32{.{ 0, 1, 2 }};
    const invalid = weights.LogicalMesh{
        .positions = &positions,
        .triangles = &triangles,
        .adjacency = .{
            .offsets = &[_]u32{ 0, 1, 2, 2 },
            .neighbors = &[_]u32{ 1, 0 },
        },
    };
    var output: [3]weights.InfluenceRow = undefined;
    try testing.expectError(error.MissingTriangleEdge, weights.solveObject(testing.allocator, .{
        .object_id = "broken",
        .mesh = invalid,
        .semantic_regions = &.{},
        .binding = .{ .rigid = 1 },
        .bones = &BONES,
    }, &output));
}

test "the joint-span prune drops solver dust on distant bones and keeps chain-local blends (req_4303)" {
    // A seven-bone chain: 0-1-2-3-4-5-6. Span between 1 and 6 is 5.
    var chain: [7]weights.BoneSegment = undefined;
    for (&chain, 0..) |*bone, index| {
        bone.* = .{
            .parent_index = if (index == 0) null else @intCast(index - 1),
            .origin = .{ @floatFromInt(index), 0, 0 },
            .tip = .{ @as(f32, @floatFromInt(index)) + 1, 0, 0 },
        };
    }
    try testing.expectEqual(@as(u32, 0), weights.jointSpan(&chain, 3, 3));
    try testing.expectEqual(@as(u32, 1), weights.jointSpan(&chain, 3, 4));
    try testing.expectEqual(@as(u32, 5), weights.jointSpan(&chain, 1, 6));

    var rows = [_]weights.InfluenceRow{
        // Dominant bone 1 with a legitimate neighbor blend (span 1) and
        // solver dust on bone 6 (span 5): the dust drops, the pair renormalizes.
        .{
            .bone_indices = .{ 1, 2, 6, weights.UNUSED_BONE },
            .weights = .{ 0.6, 0.364, 0.036, 0 },
        },
        // Fully chain-local row: byte-stable through the prune.
        .{
            .bone_indices = .{ 2, 3, weights.UNUSED_BONE, weights.UNUSED_BONE },
            .weights = .{ 0.7, 0.3, 0, 0 },
        },
    };
    weights.pruneDistantInfluences(&chain, &rows);

    try testing.expectEqual(@as(f32, 0), weightFor(rows[0], 6));
    const kept = weightFor(rows[0], 1) + weightFor(rows[0], 2);
    try testing.expectApproxEqAbs(@as(f32, 1), kept, 1.0e-5);
    try testing.expect(weightFor(rows[0], 1) > weightFor(rows[0], 2));
    try testing.expectApproxEqAbs(@as(f32, 0.7), weightFor(rows[1], 2), 1.0e-6);
    try testing.expectApproxEqAbs(@as(f32, 0.3), weightFor(rows[1], 3), 1.0e-6);
}
