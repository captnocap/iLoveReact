//! Logical-topology automatic skin binding for welded characters.
//!
//! This module owns one strict authoring-time door: solve one explicitly bound
//! logical object against real model-space bone segments. It never discovers
//! welds from positions, reads render-corner payloads, derives seeds from part
//! centers, or preserves a rigid prior after a failed solve.
//!
//! Body and semantically-authored deformable objects use the same pipeline:
//! semantic regions are eroded on the supplied logical graph, actual bone
//! segments plus surviving semantic cores seed voxel-geodesic distance fields,
//! parent/child weights blend around their real joint, and four object-local
//! adjacency passes smooth the result. A deformable object without semantics is
//! initialized by closest-point projection from an explicitly supplied, already
//! solved body. Rigid objects are exactly one bone at weight 1.

const std = @import("std");
const sk = @import("skeleton.zig");

pub const Vec3 = [3]f32;
pub const MAX_BONES: usize = 255;
pub const MAX_INFLUENCES: usize = 4;
pub const UNUSED_BONE: u16 = 0xffff;

pub const AutoWeightTuning = struct {
    longest_axis_resolution: u16,
    min_occupied_axis_cells: u16,
    semantic_erosion_rings: u8,
    boundary_penalty: f32,
    distance_falloff: f32,
    distance_floor_fraction: f32,
    segment_sample_cell_fraction: f32,
    joint_blend_half_width_ratio: f32,
    smoothing_iterations: u8,
    smoothing_lambda: f32,
    /// A vertex blends only within its dominant bone's joint neighborhood:
    /// influences whose bone sits more than this many skeleton joints from
    /// the row's strongest bone are dropped and renormalized away. Solver
    /// dust on a distant bone (a toe influence in a hand row, req_4303) is
    /// invisible at bind and tears the mesh the moment the near chain
    /// animates away from it; legitimate blends are always chain-local.
    max_influence_joint_span: u8,
};

/// Behavior-affecting constants are data at the solver boundary, not literals
/// scattered through the implementation.
pub const HUMANOID_AUTO_WEIGHT_TUNING = AutoWeightTuning{
    .longest_axis_resolution = 96,
    .min_occupied_axis_cells = 32,
    .semantic_erosion_rings = 2,
    .boundary_penalty = 4.0,
    .distance_falloff = 6.0,
    .distance_floor_fraction = 0.0001,
    .segment_sample_cell_fraction = 0.5,
    .joint_blend_half_width_ratio = 0.15,
    .smoothing_iterations = 4,
    .smoothing_lambda = 0.35,
    .max_influence_joint_span = 3,
};

pub const InfluenceRow = struct {
    bone_indices: [MAX_INFLUENCES]u16 = @splat(UNUSED_BONE),
    weights: [MAX_INFLUENCES]f32 = @splat(0),
};

pub const LogicalAdjacency = struct {
    /// CSR offsets, exactly logicalVertexCount + 1 rows.
    offsets: []const u32,
    /// Object-local logical vertex IDs. No cross-object ID is accepted.
    neighbors: []const u32,
};

pub const LogicalMesh = struct {
    positions: []const Vec3,
    triangles: []const [3]u32,
    adjacency: LogicalAdjacency,
};

pub const Semantic = struct {
    role: sk.HumanoidSemanticRole,
    side: ?sk.HumanoidSide = null,
};

/// Stable semantic membership is supplied as logical vertex IDs. A boundary
/// vertex may intentionally occur in both adjacent regions; two-ring erosion
/// removes that band from both hard-prior sets.
pub const SemanticRegion = struct {
    semantic: Semantic,
    bone_index: u16,
    logical_vertices: []const u32,
};

/// A real model-space segment. `origin` is the bone joint and `tip` is the
/// segment endpoint chosen from its child joint or authored terminal tip.
pub const BoneSegment = struct {
    parent_index: ?u16 = null,
    origin: Vec3,
    tip: Vec3,
    /// False for the canonical unweighted root control.
    weighted: bool = true,
};

pub const ObjectBindingMode = union(enum) {
    body,
    deformable,
    rigid: u16,
};

/// The only accepted transfer source: a body that has already completed this
/// logical solve. This is explicit input; the solver owns no hidden body cache.
pub const SolvedBody = struct {
    positions: []const Vec3,
    triangles: []const [3]u32,
    weights: []const InfluenceRow,
};

pub const SolveInput = struct {
    object_id: []const u8,
    mesh: LogicalMesh,
    semantic_regions: []const SemanticRegion,
    binding: ObjectBindingMode,
    bones: []const BoneSegment,
    body_weights: ?SolvedBody = null,
};

pub const SolveStats = struct {
    bones: usize = 0,
    logical_vertices: usize = 0,
    grid_occupied_axis_cells: [3]u16 = @splat(0),
    grid_cells: usize = 0,
    voxels_non_exterior: usize = 0,
    semantic_core_vertices: usize = 0,
    projected_vertices: usize = 0,
};

pub const Error = std.mem.Allocator.Error || error{
    EmptyObjectId,
    InvalidBoneCount,
    InvalidBoneSegment,
    InvalidParentIndex,
    InvalidLogicalMesh,
    InvalidAdjacency,
    MissingTriangleEdge,
    DegenerateTriangle,
    InvalidSemanticSide,
    InvalidSemanticRegion,
    DuplicateSemanticRegion,
    AmbiguousSemanticCore,
    InvalidRigidBone,
    UnexpectedBodyWeights,
    MissingSolvedBody,
    InvalidSolvedBody,
    OutputLengthMismatch,
    GridTooLarge,
    NoVoxelInterior,
    UnreachableLogicalVertex,
    InvalidWeightRow,
};

const VOX_EXTERIOR: u8 = 0;
const VOX_BOUNDARY: u8 = 1;
const VOX_INTERIOR: u8 = 2;
const MAX_COLUMN_CROSSINGS: usize = 128;
const INF = std.math.inf(f32);

const Grid = struct {
    dims: [3]usize,
    occupied: [3]usize,
    cell: Vec3,
    min: Vec3,

    fn cellCount(self: Grid) Error!usize {
        const xy = std.math.mul(usize, self.dims[0], self.dims[1]) catch return error.GridTooLarge;
        return std.math.mul(usize, xy, self.dims[2]) catch error.GridTooLarge;
    }

    fn index(self: Grid, gx: usize, gy: usize, gz: usize) usize {
        return (gz * self.dims[1] + gy) * self.dims[0] + gx;
    }

    fn coords(self: Grid, cell_index: usize) [3]usize {
        return .{
            cell_index % self.dims[0],
            (cell_index / self.dims[0]) % self.dims[1],
            cell_index / (self.dims[0] * self.dims[1]),
        };
    }

    fn clampAxis(self: Grid, value: f32, axis: usize) usize {
        const upper: f32 = @floatFromInt(self.dims[axis] - 1);
        return @intFromFloat(std.math.clamp(@floor((value - self.min[axis]) / self.cell[axis]), 0, upper));
    }

    fn cellOf(self: Grid, position: Vec3) usize {
        return self.index(
            self.clampAxis(position[0], 0),
            self.clampAxis(position[1], 1),
            self.clampAxis(position[2], 2),
        );
    }

    fn center(self: Grid, gx: usize, gy: usize, gz: usize) Vec3 {
        return .{
            self.min[0] + (@as(f32, @floatFromInt(gx)) + 0.5) * self.cell[0],
            self.min[1] + (@as(f32, @floatFromInt(gy)) + 0.5) * self.cell[1],
            self.min[2] + (@as(f32, @floatFromInt(gz)) + 0.5) * self.cell[2],
        };
    }
};

const Seed = struct {
    cell: u32,
    bone: u16,
};

const QueueNode = struct {
    distance: f32,
    dense: u32,
};

fn queueOrder(_: void, a: QueueNode, b: QueueNode) std.math.Order {
    return std.math.order(a.distance, b.distance);
}

const DistanceQueue = std.PriorityQueue(QueueNode, void, queueOrder);

/// Solve one logical object. Body calls must precede projection-based
/// deformables so their returned rows can be supplied as `body_weights`.
pub fn solveObject(
    allocator: std.mem.Allocator,
    input: SolveInput,
    output: []InfluenceRow,
) Error!SolveStats {
    try validateInput(input, output.len);
    clearRows(output);

    var stats = SolveStats{
        .bones = input.bones.len,
        .logical_vertices = input.mesh.positions.len,
    };

    switch (input.binding) {
        .rigid => |bone_index| {
            if (bone_index >= input.bones.len or !input.bones[bone_index].weighted) return error.InvalidRigidBone;
            const exact = exactRow(bone_index);
            for (output) |*row| row.* = exact;
            return stats;
        },
        .body => {
            if (input.body_weights != null) return error.UnexpectedBodyWeights;
        },
        .deformable => {
            if (input.semantic_regions.len == 0) {
                const body = input.body_weights orelse return error.MissingSolvedBody;
                try projectSolvedBody(input, body, output);
                stats.projected_vertices = output.len;
                const hard_bones = try allocator.alloc(u16, output.len);
                defer allocator.free(hard_bones);
                @memset(hard_bones, UNUSED_BONE);
                try smoothObjectWeights(allocator, input.mesh.adjacency, hard_bones, output);
                pruneDistantInfluences(input.bones, output);
                try validateOutputRows(output, input.bones.len);
                return stats;
            }
        },
    }

    const hard_bones = try allocator.alloc(u16, output.len);
    defer allocator.free(hard_bones);
    @memset(hard_bones, UNUSED_BONE);
    stats.semantic_core_vertices = try buildSemanticCores(allocator, input, hard_bones);

    try solveGeodesicFields(allocator, input, hard_bones, output, &stats);
    applySemanticPriors(hard_bones, output);
    try blendParentChildJoints(input, output);
    try smoothObjectWeights(allocator, input.mesh.adjacency, hard_bones, output);
    pruneDistantInfluences(input.bones, output);
    try validateOutputRows(output, input.bones.len);
    return stats;
}

/// The joint-span prune (req_4303): the final content gate after smoothing.
/// Every influence must live within `max_influence_joint_span` skeleton
/// joints of the row's dominant bone; the rest is renormalized away. The
/// dominant itself is span zero, so a row always survives.
pub fn pruneDistantInfluences(bones: []const BoneSegment, output: []InfluenceRow) void {
    const max_span = HUMANOID_AUTO_WEIGHT_TUNING.max_influence_joint_span;
    for (output) |*row| {
        var dominant: u16 = UNUSED_BONE;
        var dominant_weight: f32 = -1;
        for (row.bone_indices, row.weights) |bone_index, weight| {
            if (bone_index == UNUSED_BONE) continue;
            if (weight > dominant_weight) {
                dominant_weight = weight;
                dominant = bone_index;
            }
        }
        if (dominant == UNUSED_BONE) continue;
        var pruned = false;
        for (&row.bone_indices, &row.weights) |*bone_index, *weight| {
            if (bone_index.* == UNUSED_BONE or bone_index.* == dominant) continue;
            if (jointSpan(bones, dominant, bone_index.*) <= max_span) continue;
            bone_index.* = UNUSED_BONE;
            weight.* = 0;
            pruned = true;
        }
        // The dominant bone survives every prune, so the row stays normalizable.
        if (pruned) _ = normalizeRow(row);
    }
}

/// Undirected skeleton-graph distance between two bones via parent links
/// (the classic ancestor-walk LCA distance). Distinct roots — a disjoint
/// skeleton forest — count as unreachable.
pub fn jointSpan(bones: []const BoneSegment, a: u16, b: u16) u32 {
    if (a == b) return 0;
    var depth_a: u32 = 0;
    var cursor: u16 = a;
    while (bones[cursor].parent_index) |parent| : (depth_a += 1) cursor = parent;
    var depth_b: u32 = 0;
    cursor = b;
    while (bones[cursor].parent_index) |parent| : (depth_b += 1) cursor = parent;

    var walk_a: u16 = a;
    var walk_b: u16 = b;
    var height_a = depth_a;
    var height_b = depth_b;
    var span: u32 = 0;
    while (height_a > height_b) : (span += 1) {
        walk_a = bones[walk_a].parent_index.?;
        height_a -= 1;
    }
    while (height_b > height_a) : (span += 1) {
        walk_b = bones[walk_b].parent_index.?;
        height_b -= 1;
    }
    while (walk_a != walk_b) : (span += 2) {
        const parent_a = bones[walk_a].parent_index orelse return std.math.maxInt(u32);
        const parent_b = bones[walk_b].parent_index orelse return std.math.maxInt(u32);
        walk_a = parent_a;
        walk_b = parent_b;
    }
    return span;
}

fn validateInput(input: SolveInput, output_len: usize) Error!void {
    if (input.object_id.len == 0) return error.EmptyObjectId;
    if (input.bones.len == 0 or input.bones.len > MAX_BONES) return error.InvalidBoneCount;
    if (output_len != input.mesh.positions.len) return error.OutputLengthMismatch;

    for (input.bones, 0..) |bone, index| {
        if (!finiteVec3(bone.origin) or !finiteVec3(bone.tip)) return error.InvalidBoneSegment;
        if (bone.parent_index) |parent| {
            if (parent >= input.bones.len or parent == index) return error.InvalidParentIndex;
        }
        if (bone.weighted and lengthSquared(sub(bone.tip, bone.origin)) <= 1.0e-12) {
            return error.InvalidBoneSegment;
        }
    }

    try validateLogicalMesh(input.mesh);
    try validateSemanticRegions(input.semantic_regions, input.bones, input.mesh.positions.len);
    switch (input.binding) {
        .body => if (input.semantic_regions.len == 0) return error.InvalidSemanticRegion,
        .deformable => {},
        .rigid => |bone_index| if (bone_index >= input.bones.len) return error.InvalidRigidBone,
    }
    if (input.body_weights) |body| try validateSolvedBody(body, input.bones.len);
}

fn validateLogicalMesh(mesh: LogicalMesh) Error!void {
    const count = mesh.positions.len;
    if (count == 0 or mesh.triangles.len == 0) return error.InvalidLogicalMesh;
    for (mesh.positions) |position| if (!finiteVec3(position)) return error.InvalidLogicalMesh;
    if (mesh.adjacency.offsets.len != count + 1 or mesh.adjacency.offsets[0] != 0 or
        mesh.adjacency.offsets[count] != mesh.adjacency.neighbors.len)
    {
        return error.InvalidAdjacency;
    }
    for (mesh.adjacency.offsets[1..], 1..) |offset, index| {
        if (offset < mesh.adjacency.offsets[index - 1] or offset > mesh.adjacency.neighbors.len) {
            return error.InvalidAdjacency;
        }
    }
    for (mesh.positions, 0..) |_, vertex| {
        const lo: usize = mesh.adjacency.offsets[vertex];
        const hi: usize = mesh.adjacency.offsets[vertex + 1];
        for (mesh.adjacency.neighbors[lo..hi], 0..) |neighbor, local_index| {
            if (neighbor >= count or neighbor == vertex) return error.InvalidAdjacency;
            for (mesh.adjacency.neighbors[lo .. lo + local_index]) |prior| {
                if (prior == neighbor) return error.InvalidAdjacency;
            }
            if (!adjacencyContains(mesh.adjacency, neighbor, @intCast(vertex))) return error.InvalidAdjacency;
        }
    }
    for (mesh.triangles) |triangle| {
        if (triangle[0] >= count or triangle[1] >= count or triangle[2] >= count or
            triangle[0] == triangle[1] or triangle[1] == triangle[2] or triangle[2] == triangle[0])
        {
            return error.InvalidLogicalMesh;
        }
        const a = mesh.positions[triangle[0]];
        const b = mesh.positions[triangle[1]];
        const c = mesh.positions[triangle[2]];
        if (lengthSquared(cross(sub(b, a), sub(c, a))) <= 1.0e-16) return error.DegenerateTriangle;
        if (!adjacencyContains(mesh.adjacency, triangle[0], triangle[1]) or
            !adjacencyContains(mesh.adjacency, triangle[1], triangle[2]) or
            !adjacencyContains(mesh.adjacency, triangle[2], triangle[0]))
        {
            return error.MissingTriangleEdge;
        }
    }
}

fn adjacencyContains(adjacency: LogicalAdjacency, from: u32, to: u32) bool {
    const lo: usize = adjacency.offsets[from];
    const hi: usize = adjacency.offsets[from + 1];
    return std.mem.indexOfScalar(u32, adjacency.neighbors[lo..hi], to) != null;
}

fn validateSemanticRegions(regions: []const SemanticRegion, bones: []const BoneSegment, vertex_count: usize) Error!void {
    for (regions, 0..) |region, index| {
        if (!semanticSideValid(region.semantic)) return error.InvalidSemanticSide;
        if (region.bone_index >= bones.len or !bones[region.bone_index].weighted or region.logical_vertices.len == 0) {
            return error.InvalidSemanticRegion;
        }
        for (regions[0..index]) |prior| {
            if (prior.semantic.role == region.semantic.role and prior.semantic.side == region.semantic.side) {
                return error.DuplicateSemanticRegion;
            }
        }
        for (region.logical_vertices, 0..) |vertex, local_index| {
            if (vertex >= vertex_count) return error.InvalidSemanticRegion;
            if (std.mem.indexOfScalar(u32, region.logical_vertices[0..local_index], vertex) != null) {
                return error.InvalidSemanticRegion;
            }
        }
    }
}

fn semanticSideValid(semantic: Semantic) bool {
    return switch (semantic.role) {
        .pelvis, .abdomen, .chest, .head, .neck => semantic.side == null,
        .upper_arm, .lower_arm, .hand, .upper_leg, .lower_leg, .foot, .clavicle, .fingers, .toes => semantic.side != null,
    };
}

fn validateSolvedBody(body: SolvedBody, bone_count: usize) Error!void {
    if (body.positions.len == 0 or body.positions.len != body.weights.len or body.triangles.len == 0) {
        return error.InvalidSolvedBody;
    }
    for (body.positions) |position| if (!finiteVec3(position)) return error.InvalidSolvedBody;
    for (body.triangles) |triangle| {
        if (triangle[0] >= body.positions.len or triangle[1] >= body.positions.len or triangle[2] >= body.positions.len) {
            return error.InvalidSolvedBody;
        }
        const a = body.positions[triangle[0]];
        const b = body.positions[triangle[1]];
        const c = body.positions[triangle[2]];
        if (lengthSquared(cross(sub(b, a), sub(c, a))) <= 1.0e-16) return error.InvalidSolvedBody;
    }
    validateOutputRows(body.weights, bone_count) catch return error.InvalidSolvedBody;
}

fn clearRows(rows: []InfluenceRow) void {
    for (rows) |*row| row.* = .{};
}

fn exactRow(bone_index: u16) InfluenceRow {
    return .{
        .bone_indices = .{ bone_index, UNUSED_BONE, UNUSED_BONE, UNUSED_BONE },
        .weights = .{ 1, 0, 0, 0 },
    };
}

fn buildSemanticCores(allocator: std.mem.Allocator, input: SolveInput, hard_bones: []u16) Error!usize {
    const count = input.mesh.positions.len;
    const membership = try allocator.alloc(bool, count);
    defer allocator.free(membership);
    var current_storage = try allocator.alloc(bool, count);
    defer allocator.free(current_storage);
    var next_storage = try allocator.alloc(bool, count);
    defer allocator.free(next_storage);

    for (input.semantic_regions) |region| {
        @memset(membership, false);
        for (region.logical_vertices) |vertex| membership[vertex] = true;
        @memcpy(current_storage, membership);

        var ring: u8 = 0;
        while (ring < HUMANOID_AUTO_WEIGHT_TUNING.semantic_erosion_rings) : (ring += 1) {
            @memcpy(next_storage, current_storage);
            for (current_storage, 0..) |inside, vertex| {
                if (!inside) continue;
                const lo: usize = input.mesh.adjacency.offsets[vertex];
                const hi: usize = input.mesh.adjacency.offsets[vertex + 1];
                for (input.mesh.adjacency.neighbors[lo..hi]) |neighbor| {
                    if (!current_storage[neighbor]) {
                        next_storage[vertex] = false;
                        break;
                    }
                }
            }
            const swap = current_storage;
            current_storage = next_storage;
            next_storage = swap;
        }

        for (current_storage, 0..) |inside, vertex| {
            if (!inside) continue;
            if (hard_bones[vertex] != UNUSED_BONE and hard_bones[vertex] != region.bone_index) {
                return error.AmbiguousSemanticCore;
            }
            hard_bones[vertex] = region.bone_index;
        }
    }

    var core_count: usize = 0;
    for (hard_bones) |bone| if (bone != UNUSED_BONE) {
        core_count += 1;
    };
    return core_count;
}

fn gridForPositions(positions: []const Vec3) Error!Grid {
    var minimum: Vec3 = @splat(INF);
    var maximum: Vec3 = @splat(-INF);
    for (positions) |position| {
        for (0..3) |axis| {
            minimum[axis] = @min(minimum[axis], position[axis]);
            maximum[axis] = @max(maximum[axis], position[axis]);
        }
    }
    const extent = Vec3{
        maximum[0] - minimum[0],
        maximum[1] - minimum[1],
        maximum[2] - minimum[2],
    };
    const longest = @max(extent[0], @max(extent[1], extent[2]));
    if (!std.math.isFinite(longest) or longest <= 1.0e-6) return error.InvalidLogicalMesh;

    var occupied: [3]usize = undefined;
    var cell: Vec3 = undefined;
    const longest_resolution: f32 = @floatFromInt(HUMANOID_AUTO_WEIGHT_TUNING.longest_axis_resolution);
    const base_cell = longest / longest_resolution;
    for (0..3) |axis| {
        if (extent[axis] > longest * 1.0e-6) {
            const proportional: usize = @intFromFloat(@ceil(extent[axis] / longest * longest_resolution));
            occupied[axis] = @max(@as(usize, HUMANOID_AUTO_WEIGHT_TUNING.min_occupied_axis_cells), proportional);
            cell[axis] = extent[axis] / @as(f32, @floatFromInt(occupied[axis]));
        } else {
            occupied[axis] = 1;
            cell[axis] = base_cell;
        }
    }
    var grid = Grid{
        .dims = .{ occupied[0] + 2, occupied[1] + 2, occupied[2] + 2 },
        .occupied = occupied,
        .cell = cell,
        .min = .{
            minimum[0] - cell[0],
            minimum[1] - cell[1],
            minimum[2] - cell[2],
        },
    };
    _ = try grid.cellCount();
    return grid;
}

fn solveGeodesicFields(
    allocator: std.mem.Allocator,
    input: SolveInput,
    hard_bones: []const u16,
    output: []InfluenceRow,
    stats: *SolveStats,
) Error!void {
    const grid = try gridForPositions(input.mesh.positions);
    stats.grid_occupied_axis_cells = .{
        @intCast(grid.occupied[0]),
        @intCast(grid.occupied[1]),
        @intCast(grid.occupied[2]),
    };
    const cell_count = try grid.cellCount();
    stats.grid_cells = cell_count;

    const classes = try allocator.alloc(u8, cell_count);
    defer allocator.free(classes);
    @memset(classes, VOX_EXTERIOR);
    try rasterizeSurface(input.mesh, grid, classes);

    const votes = try allocator.alloc(u8, cell_count);
    defer allocator.free(votes);
    @memset(votes, 0);
    try parityVoteAxis(allocator, input.mesh, grid, votes, 2);
    try parityVoteAxis(allocator, input.mesh, grid, votes, 1);
    try parityVoteAxis(allocator, input.mesh, grid, votes, 0);
    for (classes, 0..) |*class, cell| {
        if (class.* == VOX_EXTERIOR and votes[cell] >= 2) class.* = VOX_INTERIOR;
    }

    var seeds: std.ArrayList(Seed) = .empty;
    defer seeds.deinit(allocator);
    for (input.bones, 0..) |bone, bone_index| {
        if (!bone.weighted) continue;
        try rasterizeSegmentSeeds(allocator, grid, classes, bone, @intCast(bone_index), &seeds);
    }
    for (hard_bones, input.mesh.positions) |bone_index, position| {
        if (bone_index == UNUSED_BONE) continue;
        const cell = grid.cellOf(position);
        if (classes[cell] == VOX_EXTERIOR) classes[cell] = VOX_BOUNDARY;
        try seeds.append(allocator, .{ .cell = @intCast(cell), .bone = bone_index });
    }

    const dense_of = try allocator.alloc(i32, cell_count);
    defer allocator.free(dense_of);
    var dense_cells: std.ArrayList(u32) = .empty;
    defer dense_cells.deinit(allocator);
    for (classes, 0..) |class, cell| {
        if (class == VOX_EXTERIOR) {
            dense_of[cell] = -1;
        } else {
            dense_of[cell] = @intCast(dense_cells.items.len);
            try dense_cells.append(allocator, @intCast(cell));
        }
    }
    if (dense_cells.items.len == 0) return error.NoVoxelInterior;
    stats.voxels_non_exterior = dense_cells.items.len;

    const distance = try allocator.alloc(f32, dense_cells.items.len);
    defer allocator.free(distance);
    var queue = DistanceQueue.initContext({});
    defer queue.deinit(allocator);

    const bounds = boundsDiagonal(input.mesh.positions);
    const distance_floor = @max(
        HUMANOID_AUTO_WEIGHT_TUNING.distance_floor_fraction,
        @min(grid.cell[0], @min(grid.cell[1], grid.cell[2])) * 0.5 / bounds,
    );

    for (input.bones, 0..) |bone, bone_index| {
        if (!bone.weighted) continue;
        @memset(distance, INF);
        queue.clearRetainingCapacity();
        for (seeds.items) |seed| {
            if (seed.bone != bone_index) continue;
            const dense = dense_of[seed.cell];
            if (dense < 0) continue;
            const dense_index: usize = @intCast(dense);
            if (distance[dense_index] == 0) continue;
            distance[dense_index] = 0;
            try queue.push(allocator, .{ .distance = 0, .dense = @intCast(dense_index) });
        }
        while (queue.pop()) |node| {
            const dense_index: usize = node.dense;
            if (node.distance > distance[dense_index]) continue;
            const cell: usize = dense_cells.items[dense_index];
            const coords = grid.coords(cell);
            for (0..6) |direction| {
                const neighbor = neighborCell(grid, coords, direction) orelse continue;
                const neighbor_dense = dense_of[neighbor];
                if (neighbor_dense < 0) continue;
                const neighbor_index: usize = @intCast(neighbor_dense);
                const axis = direction / 2;
                const penalty = if (classes[neighbor] == VOX_BOUNDARY)
                    HUMANOID_AUTO_WEIGHT_TUNING.boundary_penalty
                else
                    1.0;
                const candidate = node.distance + grid.cell[axis] * penalty;
                if (candidate + 1.0e-7 >= distance[neighbor_index]) continue;
                distance[neighbor_index] = candidate;
                try queue.push(allocator, .{ .distance = candidate, .dense = @intCast(neighbor_index) });
            }
        }

        for (input.mesh.positions, 0..) |position, vertex| {
            const dense = dense_of[grid.cellOf(position)];
            if (dense < 0) continue;
            const value = distance[@intCast(dense)];
            if (!std.math.isFinite(value)) continue;
            const normalized = @max(distance_floor, value / bounds);
            const strength = std.math.pow(f32, normalized, -HUMANOID_AUTO_WEIGHT_TUNING.distance_falloff);
            if (std.math.isFinite(strength) and strength > 0) {
                insertCandidate(&output[vertex], @intCast(bone_index), strength);
            }
        }
    }

    for (output) |*row| {
        if (!normalizeRow(row)) return error.UnreachableLogicalVertex;
    }
}

fn rasterizeSurface(mesh: LogicalMesh, grid: Grid, classes: []u8) Error!void {
    for (mesh.triangles) |triangle| {
        const a = mesh.positions[triangle[0]];
        const b = mesh.positions[triangle[1]];
        const c = mesh.positions[triangle[2]];
        const low = [3]usize{
            grid.clampAxis(@min(a[0], @min(b[0], c[0])), 0),
            grid.clampAxis(@min(a[1], @min(b[1], c[1])), 1),
            grid.clampAxis(@min(a[2], @min(b[2], c[2])), 2),
        };
        const high = [3]usize{
            grid.clampAxis(@max(a[0], @max(b[0], c[0])), 0),
            grid.clampAxis(@max(a[1], @max(b[1], c[1])), 1),
            grid.clampAxis(@max(a[2], @max(b[2], c[2])), 2),
        };
        var z = low[2];
        while (z <= high[2]) : (z += 1) {
            var y = low[1];
            while (y <= high[1]) : (y += 1) {
                var x = low[0];
                while (x <= high[0]) : (x += 1) {
                    if (triangleBoxOverlap(grid.center(x, y, z), scale(grid.cell, 0.5), a, b, c)) {
                        classes[grid.index(x, y, z)] = VOX_BOUNDARY;
                    }
                }
            }
        }
    }
}

fn rasterizeSegmentSeeds(
    allocator: std.mem.Allocator,
    grid: Grid,
    classes: []u8,
    segment: BoneSegment,
    bone_index: u16,
    seeds: *std.ArrayList(Seed),
) Error!void {
    const delta = sub(segment.tip, segment.origin);
    const length = @sqrt(lengthSquared(delta));
    const sample_step = @min(grid.cell[0], @min(grid.cell[1], grid.cell[2])) *
        HUMANOID_AUTO_WEIGHT_TUNING.segment_sample_cell_fraction;
    const sample_count: usize = @max(1, @as(usize, @intFromFloat(@ceil(length / sample_step))));
    var previous_cell: ?usize = null;
    var sample: usize = 0;
    while (sample <= sample_count) : (sample += 1) {
        const t = @as(f32, @floatFromInt(sample)) / @as(f32, @floatFromInt(sample_count));
        const position = add(segment.origin, scale(delta, t));
        const cell = grid.cellOf(position);
        if (previous_cell != null and previous_cell.? == cell) continue;
        previous_cell = cell;
        if (classes[cell] == VOX_EXTERIOR) classes[cell] = VOX_INTERIOR;
        try seeds.append(allocator, .{ .cell = @intCast(cell), .bone = bone_index });
    }
}

fn parityVoteAxis(
    allocator: std.mem.Allocator,
    mesh: LogicalMesh,
    grid: Grid,
    votes: []u8,
    axis: usize,
) Error!void {
    const u_axis: usize = if (axis == 0) 1 else 0;
    const v_axis: usize = if (axis == 2) 1 else 2;
    const nu = grid.dims[u_axis];
    const nv = grid.dims[v_axis];
    const n_along = grid.dims[axis];

    const heads = try allocator.alloc(i32, nu * nv);
    defer allocator.free(heads);
    @memset(heads, -1);
    var next: std.ArrayList(i32) = .empty;
    defer next.deinit(allocator);
    var node_triangle: std.ArrayList(u32) = .empty;
    defer node_triangle.deinit(allocator);

    for (mesh.triangles, 0..) |triangle, triangle_index| {
        const a = mesh.positions[triangle[0]];
        const b = mesh.positions[triangle[1]];
        const c = mesh.positions[triangle[2]];
        const u_low = grid.clampAxis(@min(a[u_axis], @min(b[u_axis], c[u_axis])), u_axis);
        const u_high = grid.clampAxis(@max(a[u_axis], @max(b[u_axis], c[u_axis])), u_axis);
        const v_low = grid.clampAxis(@min(a[v_axis], @min(b[v_axis], c[v_axis])), v_axis);
        const v_high = grid.clampAxis(@max(a[v_axis], @max(b[v_axis], c[v_axis])), v_axis);
        var u = u_low;
        while (u <= u_high) : (u += 1) {
            var v = v_low;
            while (v <= v_high) : (v += 1) {
                const column = v * nu + u;
                try next.append(allocator, heads[column]);
                try node_triangle.append(allocator, @intCast(triangle_index));
                heads[column] = @intCast(next.items.len - 1);
            }
        }
    }

    var crossings: [MAX_COLUMN_CROSSINGS]f32 = undefined;
    var u: usize = 0;
    while (u < nu) : (u += 1) {
        var v: usize = 0;
        while (v < nv) : (v += 1) {
            var crossing_count: usize = 0;
            const ray_u = grid.min[u_axis] + (@as(f32, @floatFromInt(u)) + 0.5) * grid.cell[u_axis];
            const ray_v = grid.min[v_axis] + (@as(f32, @floatFromInt(v)) + 0.5) * grid.cell[v_axis];
            var node = heads[v * nu + u];
            while (node >= 0) : (node = next.items[@intCast(node)]) {
                const triangle = mesh.triangles[node_triangle.items[@intCast(node)]];
                const hit = rayTriangleAlongAxis(
                    mesh.positions[triangle[0]],
                    mesh.positions[triangle[1]],
                    mesh.positions[triangle[2]],
                    axis,
                    u_axis,
                    v_axis,
                    ray_u,
                    ray_v,
                ) orelse continue;
                if (crossing_count < crossings.len) {
                    crossings[crossing_count] = hit;
                    crossing_count += 1;
                }
            }
            if (crossing_count < 2) continue;
            std.mem.sort(f32, crossings[0..crossing_count], {}, std.sort.asc(f32));
            var pair: usize = 0;
            while (pair + 1 < crossing_count) : (pair += 2) {
                var along: usize = 0;
                while (along < n_along) : (along += 1) {
                    const coordinate = grid.min[axis] + (@as(f32, @floatFromInt(along)) + 0.5) * grid.cell[axis];
                    if (coordinate <= crossings[pair] or coordinate >= crossings[pair + 1]) continue;
                    var coords = [3]usize{ 0, 0, 0 };
                    coords[axis] = along;
                    coords[u_axis] = u;
                    coords[v_axis] = v;
                    votes[grid.index(coords[0], coords[1], coords[2])] +|= 1;
                }
            }
        }
    }
}

fn rayTriangleAlongAxis(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    axis: usize,
    u_axis: usize,
    v_axis: usize,
    ray_u: f32,
    ray_v: f32,
) ?f32 {
    const d1u = b[u_axis] - a[u_axis];
    const d1v = b[v_axis] - a[v_axis];
    const d2u = c[u_axis] - a[u_axis];
    const d2v = c[v_axis] - a[v_axis];
    const determinant = d1u * d2v - d2u * d1v;
    if (@abs(determinant) < 1.0e-12) return null;
    const pu = ray_u - a[u_axis];
    const pv = ray_v - a[v_axis];
    const s = (pu * d2v - d2u * pv) / determinant;
    const t = (d1u * pv - pu * d1v) / determinant;
    if (s < 0 or t < 0 or s + t > 1) return null;
    return a[axis] + s * (b[axis] - a[axis]) + t * (c[axis] - a[axis]);
}

fn neighborCell(grid: Grid, coords: [3]usize, direction: usize) ?usize {
    var next = coords;
    const axis = direction / 2;
    if (direction % 2 == 0) {
        if (next[axis] + 1 >= grid.dims[axis]) return null;
        next[axis] += 1;
    } else {
        if (next[axis] == 0) return null;
        next[axis] -= 1;
    }
    return grid.index(next[0], next[1], next[2]);
}

fn applySemanticPriors(hard_bones: []const u16, output: []InfluenceRow) void {
    for (hard_bones, output) |bone, *row| {
        if (bone != UNUSED_BONE) row.* = exactRow(bone);
    }
}

fn blendParentChildJoints(input: SolveInput, output: []InfluenceRow) Error!void {
    for (input.bones, 0..) |child, child_index| {
        const parent_index = child.parent_index orelse continue;
        const parent = input.bones[parent_index];
        if (!child.weighted or !parent.weighted) continue;
        const parent_length = @sqrt(lengthSquared(sub(parent.tip, parent.origin)));
        const child_length = @sqrt(lengthSquared(sub(child.tip, child.origin)));
        const half_width = HUMANOID_AUTO_WEIGHT_TUNING.joint_blend_half_width_ratio * @min(parent_length, child_length);
        if (half_width <= 1.0e-8) continue;
        const parent_direction = normalizeOrZero(sub(parent.tip, parent.origin));
        const child_direction = normalizeOrZero(sub(child.tip, child.origin));
        var axis = normalizeOrZero(add(parent_direction, child_direction));
        if (lengthSquared(axis) <= 1.0e-12) axis = child_direction;
        for (input.mesh.positions, output) |position, *row| {
            const signed_distance = dot(sub(position, child.origin), axis);
            const child_share = smoothstep(-half_width, half_width, signed_distance);
            redistributePair(row, parent_index, @intCast(child_index), child_share);
        }
    }
}

fn redistributePair(row: *InfluenceRow, parent: u16, child: u16, child_share: f32) void {
    var dense: [MAX_BONES]f32 = @splat(0);
    rowAccumulateDense(row.*, 1, &dense);
    const total = dense[parent] + dense[child];
    if (total <= 0) return;
    dense[parent] = total * (1 - child_share);
    dense[child] = total * child_share;
    row.* = rowFromDense(&dense);
}

fn smoothObjectWeights(
    allocator: std.mem.Allocator,
    adjacency: LogicalAdjacency,
    hard_bones: []const u16,
    output: []InfluenceRow,
) Error!void {
    var current = try allocator.dupe(InfluenceRow, output);
    defer allocator.free(current);
    var next = try allocator.alloc(InfluenceRow, output.len);
    defer allocator.free(next);

    var iteration: u8 = 0;
    while (iteration < HUMANOID_AUTO_WEIGHT_TUNING.smoothing_iterations) : (iteration += 1) {
        for (current, 0..) |row, vertex| {
            if (hard_bones[vertex] != UNUSED_BONE) {
                next[vertex] = exactRow(hard_bones[vertex]);
                continue;
            }
            var dense: [MAX_BONES]f32 = @splat(0);
            rowAccumulateDense(row, 1 - HUMANOID_AUTO_WEIGHT_TUNING.smoothing_lambda, &dense);
            const low: usize = adjacency.offsets[vertex];
            const high: usize = adjacency.offsets[vertex + 1];
            const neighbor_count = high - low;
            if (neighbor_count > 0) {
                const share = HUMANOID_AUTO_WEIGHT_TUNING.smoothing_lambda /
                    @as(f32, @floatFromInt(neighbor_count));
                for (adjacency.neighbors[low..high]) |neighbor| {
                    rowAccumulateDense(current[neighbor], share, &dense);
                }
            }
            next[vertex] = rowFromDense(&dense);
        }
        const swap = current;
        current = next;
        next = swap;
    }
    @memcpy(output, current);
}

fn projectSolvedBody(input: SolveInput, body: SolvedBody, output: []InfluenceRow) Error!void {
    for (input.mesh.positions, output) |position, *row| {
        var best_distance = INF;
        var best_triangle: [3]u32 = undefined;
        var best_barycentric: Vec3 = undefined;
        for (body.triangles) |triangle| {
            const closest = closestPointOnTriangle(
                position,
                body.positions[triangle[0]],
                body.positions[triangle[1]],
                body.positions[triangle[2]],
            );
            if (closest.distance_squared < best_distance) {
                best_distance = closest.distance_squared;
                best_triangle = triangle;
                best_barycentric = closest.barycentric;
            }
        }
        if (!std.math.isFinite(best_distance)) return error.InvalidSolvedBody;
        var dense: [MAX_BONES]f32 = @splat(0);
        rowAccumulateDense(body.weights[best_triangle[0]], best_barycentric[0], &dense);
        rowAccumulateDense(body.weights[best_triangle[1]], best_barycentric[1], &dense);
        rowAccumulateDense(body.weights[best_triangle[2]], best_barycentric[2], &dense);
        row.* = rowFromDense(&dense);
        if (!normalizeRow(row)) return error.InvalidSolvedBody;
    }
}

const ClosestPoint = struct {
    barycentric: Vec3,
    distance_squared: f32,
};

/// Ericson's closest-point regions, returning barycentric coordinates on ABC.
fn closestPointOnTriangle(point: Vec3, a: Vec3, b: Vec3, c: Vec3) ClosestPoint {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(point, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 and d2 <= 0) return closestResult(point, a, .{ 1, 0, 0 });

    const bp = sub(point, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 and d4 <= d3) return closestResult(point, b, .{ 0, 1, 0 });

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 and d1 >= 0 and d3 <= 0) {
        const v = d1 / (d1 - d3);
        return closestResult(point, add(a, scale(ab, v)), .{ 1 - v, v, 0 });
    }

    const cp = sub(point, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 and d5 <= d6) return closestResult(point, c, .{ 0, 0, 1 });

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 and d2 >= 0 and d6 <= 0) {
        const w = d2 / (d2 - d6);
        return closestResult(point, add(a, scale(ac, w)), .{ 1 - w, 0, w });
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return closestResult(point, add(b, scale(sub(c, b), w)), .{ 0, 1 - w, w });
    }

    const denominator = 1 / (va + vb + vc);
    const v = vb * denominator;
    const w = vc * denominator;
    return closestResult(point, add(a, add(scale(ab, v), scale(ac, w))), .{ 1 - v - w, v, w });
}

fn closestResult(point: Vec3, closest: Vec3, barycentric: Vec3) ClosestPoint {
    return .{
        .barycentric = barycentric,
        .distance_squared = lengthSquared(sub(point, closest)),
    };
}

fn insertCandidate(row: *InfluenceRow, bone: u16, weight: f32) void {
    for (row.bone_indices, 0..) |existing, slot| {
        if (existing == bone) {
            row.weights[slot] += weight;
            sortRowDescending(row);
            return;
        }
    }
    var slot: usize = 0;
    while (slot < MAX_INFLUENCES and weight <= row.weights[slot]) : (slot += 1) {}
    if (slot == MAX_INFLUENCES) return;
    var back = MAX_INFLUENCES - 1;
    while (back > slot) : (back -= 1) {
        row.bone_indices[back] = row.bone_indices[back - 1];
        row.weights[back] = row.weights[back - 1];
    }
    row.bone_indices[slot] = bone;
    row.weights[slot] = weight;
}

fn sortRowDescending(row: *InfluenceRow) void {
    var i: usize = 1;
    while (i < MAX_INFLUENCES) : (i += 1) {
        var current = i;
        while (current > 0 and row.weights[current] > row.weights[current - 1]) : (current -= 1) {
            std.mem.swap(f32, &row.weights[current], &row.weights[current - 1]);
            std.mem.swap(u16, &row.bone_indices[current], &row.bone_indices[current - 1]);
        }
    }
}

fn normalizeRow(row: *InfluenceRow) bool {
    sortRowDescending(row);
    var sum: f32 = 0;
    for (row.weights) |weight| {
        if (!std.math.isFinite(weight) or weight < 0) return false;
        sum += weight;
    }
    if (!std.math.isFinite(sum) or sum <= 0) return false;
    for (0..MAX_INFLUENCES) |slot| {
        if (row.weights[slot] <= 0) {
            row.weights[slot] = 0;
            row.bone_indices[slot] = UNUSED_BONE;
        } else {
            row.weights[slot] /= sum;
        }
    }
    return true;
}

fn rowAccumulateDense(row: InfluenceRow, scale_value: f32, dense: *[MAX_BONES]f32) void {
    if (scale_value <= 0) return;
    for (row.bone_indices, row.weights) |bone, weight| {
        if (bone == UNUSED_BONE or weight <= 0) continue;
        dense[bone] += weight * scale_value;
    }
}

fn rowFromDense(dense: *const [MAX_BONES]f32) InfluenceRow {
    var row = InfluenceRow{};
    for (dense, 0..) |weight, bone| {
        if (weight > 0 and std.math.isFinite(weight)) insertCandidate(&row, @intCast(bone), weight);
    }
    _ = normalizeRow(&row);
    return row;
}

fn validateOutputRows(rows: []const InfluenceRow, bone_count: usize) Error!void {
    for (rows) |row| {
        var sum: f32 = 0;
        var previous = INF;
        var unused = false;
        for (row.bone_indices, row.weights) |bone, weight| {
            if (!std.math.isFinite(weight) or weight < 0 or weight > previous + 1.0e-7) return error.InvalidWeightRow;
            previous = weight;
            if (bone == UNUSED_BONE) {
                if (weight != 0) return error.InvalidWeightRow;
                unused = true;
                continue;
            }
            if (unused or bone >= bone_count or weight <= 0) return error.InvalidWeightRow;
            sum += weight;
        }
        if (@abs(sum - 1) > 1.0e-5) return error.InvalidWeightRow;
    }
}

fn triangleBoxOverlap(center: Vec3, half: Vec3, triangle_a: Vec3, triangle_b: Vec3, triangle_c: Vec3) bool {
    const v0 = sub(triangle_a, center);
    const v1 = sub(triangle_b, center);
    const v2 = sub(triangle_c, center);
    const edges = [3]Vec3{ sub(v1, v0), sub(v2, v1), sub(v0, v2) };

    for (0..3) |axis| {
        const low = @min(v0[axis], @min(v1[axis], v2[axis]));
        const high = @max(v0[axis], @max(v1[axis], v2[axis]));
        if (low > half[axis] or high < -half[axis]) return false;
    }
    for (edges) |edge| {
        for (0..3) |axis_index| {
            const axis = crossUnitAxis(axis_index, edge);
            const p0 = dot(v0, axis);
            const p1 = dot(v1, axis);
            const p2 = dot(v2, axis);
            const radius = half[0] * @abs(axis[0]) + half[1] * @abs(axis[1]) + half[2] * @abs(axis[2]);
            if (@min(p0, @min(p1, p2)) > radius or @max(p0, @max(p1, p2)) < -radius) return false;
        }
    }
    const normal = cross(edges[0], edges[1]);
    const plane_distance = -dot(normal, v0);
    const radius = half[0] * @abs(normal[0]) + half[1] * @abs(normal[1]) + half[2] * @abs(normal[2]);
    return @abs(plane_distance) <= radius;
}

fn boundsDiagonal(positions: []const Vec3) f32 {
    var minimum: Vec3 = @splat(INF);
    var maximum: Vec3 = @splat(-INF);
    for (positions) |position| {
        for (0..3) |axis| {
            minimum[axis] = @min(minimum[axis], position[axis]);
            maximum[axis] = @max(maximum[axis], position[axis]);
        }
    }
    return @max(@sqrt(lengthSquared(sub(maximum, minimum))), 1.0e-6);
}

fn smoothstep(low: f32, high: f32, value: f32) f32 {
    const t = std.math.clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
}

fn finiteVec3(value: Vec3) bool {
    return std.math.isFinite(value[0]) and std.math.isFinite(value[1]) and std.math.isFinite(value[2]);
}

fn add(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}

fn sub(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}

fn scale(value: Vec3, amount: f32) Vec3 {
    return .{ value[0] * amount, value[1] * amount, value[2] * amount };
}

fn dot(a: Vec3, b: Vec3) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

fn cross(a: Vec3, b: Vec3) Vec3 {
    return .{
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    };
}

fn crossUnitAxis(axis: usize, edge: Vec3) Vec3 {
    return switch (axis) {
        0 => .{ 0, -edge[2], edge[1] },
        1 => .{ edge[2], 0, -edge[0] },
        else => .{ -edge[1], edge[0], 0 },
    };
}

fn lengthSquared(value: Vec3) f32 {
    return dot(value, value);
}

fn normalizeOrZero(value: Vec3) Vec3 {
    const length_squared = lengthSquared(value);
    if (length_squared <= 1.0e-12) return @splat(0);
    return scale(value, 1 / @sqrt(length_squared));
}
