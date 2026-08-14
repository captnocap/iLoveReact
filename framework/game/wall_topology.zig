//! Exact planar predicates and derived wall topology.
//!
//! Persisted architecture enters as whole `u` coordinates. This module widens
//! every predicate before arithmetic and never rounds a rational intersection.

const types = @import("wall_types");

pub const Wide = i128;

pub const Point = struct {
    x_u: types.Unit,
    z_u: types.Unit,
};

pub const Vector = struct {
    x_u: i64,
    z_u: i64,
};

pub const Rational = struct {
    numerator: Wide,
    denominator: Wide,

    pub fn init(numerator: Wide, denominator: Wide) Rational {
        std.debug.assert(denominator != 0);
        var canonical_numerator = numerator;
        var canonical_denominator = denominator;
        if (canonical_denominator < 0) {
            canonical_numerator = -canonical_numerator;
            canonical_denominator = -canonical_denominator;
        }
        const divisor = greatestCommonDivisor(
            unsignedMagnitude(canonical_numerator),
            @intCast(canonical_denominator),
        );
        return .{
            .numerator = @divExact(canonical_numerator, @as(Wide, @intCast(divisor))),
            .denominator = @divExact(canonical_denominator, @as(Wide, @intCast(divisor))),
        };
    }

    pub fn isInteger(self: Rational) bool {
        return @rem(self.numerator, self.denominator) == 0;
    }
};

pub const RationalPoint = struct {
    x: Rational,
    z: Rational,
};

pub const SegmentIntersectionKind = enum {
    none,
    proper,
    endpoint_touch,
    collinear_overlap,
};

pub const ExactIntersectionError = error{
    collinear_overlap,
    intersection_off_lattice,
    intersection_out_of_range,
};

pub const FaceRef = union(enum) {
    interior: usize,
    exterior: usize,
};

pub const IndexCycle = struct {
    half_edge_indices: []usize,

    pub fn deinit(self: *IndexCycle, allocator: std.mem.Allocator) void {
        freeSlice(usize, allocator, self.half_edge_indices);
        self.* = undefined;
    }
};

pub const DerivedVertex = struct {
    source_vertex_id: []u8,
    floor: i32,
    point: Point,
    outgoing_half_edge_indices: []usize,

    pub fn deinit(self: *DerivedVertex, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.source_vertex_id);
        freeSlice(usize, allocator, self.outgoing_half_edge_indices);
        self.* = undefined;
    }
};

pub const DerivedHalfEdge = struct {
    source_edge_id: []u8,
    source_side: types.WallSide,
    origin_vertex_index: usize,
    target_vertex_index: usize,
    twin_half_edge_index: usize,
    next_half_edge_index: usize,
    previous_half_edge_index: usize,
    face: ?FaceRef,

    pub fn deinit(self: *DerivedHalfEdge, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.source_edge_id);
        self.* = undefined;
    }
};

pub const DerivedFace = struct {
    signature: []u8,
    floor: i32,
    outer_boundary: IndexCycle,
    hole_indices: []usize,
    signed_area_twice: Wide,

    pub fn deinit(self: *DerivedFace, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.signature);
        self.outer_boundary.deinit(allocator);
        freeSlice(usize, allocator, self.hole_indices);
        self.* = undefined;
    }
};

pub const DerivedExterior = struct {
    floor: i32,
    boundary_cycles: []IndexCycle,

    pub fn deinit(self: *DerivedExterior, allocator: std.mem.Allocator) void {
        for (self.boundary_cycles) |*cycle| cycle.deinit(allocator);
        freeSlice(IndexCycle, allocator, self.boundary_cycles);
        self.* = undefined;
    }
};

pub const DerivedHole = struct {
    signature: []u8,
    floor: i32,
    boundary: IndexCycle,
    containing_face_index: usize,
    signed_area_twice: Wide,

    pub fn deinit(self: *DerivedHole, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.signature);
        self.boundary.deinit(allocator);
        self.* = undefined;
    }
};

pub const DiagnosticCode = enum {
    duplicate_coincident_edge,
    partial_collinear_overlap,
    self_loop,
    unsplit_intersection,
    intersection_in_opening_clearance,
    face_traversal_limit,
};

pub const TopologyDiagnostic = struct {
    code: DiagnosticCode,
    floor: i32,
    source_ids: [][]u8,
    detail: []u8,

    pub fn deinit(self: *TopologyDiagnostic, allocator: std.mem.Allocator) void {
        freeStringList(allocator, self.source_ids);
        freeBytes(allocator, self.detail);
        self.* = undefined;
    }
};

pub const DerivedTopology = struct {
    vertices: []DerivedVertex,
    half_edges: []DerivedHalfEdge,
    faces: []DerivedFace,
    exteriors: []DerivedExterior,
    holes: []DerivedHole,
    diagnostics: []TopologyDiagnostic,

    pub fn deinit(self: *DerivedTopology, allocator: std.mem.Allocator) void {
        for (self.vertices) |*vertex| vertex.deinit(allocator);
        for (self.half_edges) |*half_edge| half_edge.deinit(allocator);
        for (self.faces) |*face| face.deinit(allocator);
        for (self.exteriors) |*exterior| exterior.deinit(allocator);
        for (self.holes) |*hole| hole.deinit(allocator);
        for (self.diagnostics) |*diagnostic| diagnostic.deinit(allocator);
        freeSlice(DerivedVertex, allocator, self.vertices);
        freeSlice(DerivedHalfEdge, allocator, self.half_edges);
        freeSlice(DerivedFace, allocator, self.faces);
        freeSlice(DerivedExterior, allocator, self.exteriors);
        freeSlice(DerivedHole, allocator, self.holes);
        freeSlice(TopologyDiagnostic, allocator, self.diagnostics);
        self.* = undefined;
    }
};

pub const BuildError = error{
    missing_vertex_reference,
    cross_floor_edge,
    half_edge_link_failure,
};

pub const OpeningClearanceZone = struct {
    edge_id: []const u8,
    opening_id: []const u8,
    minimum_column_u: types.Unit,
    maximum_column_exclusive_u: types.Unit,
};

pub const BuildOptions = struct {
    opening_clearance_zones: []const OpeningClearanceZone = &.{},
    /// Test/diagnostic override. Production leaves this null so the exact
    /// half-edge count is the traversal bound.
    maximum_face_steps: ?usize = null,
};

const PendingDiagnostic = struct {
    code: DiagnosticCode,
    floor: i32,
    source_ids: [][]const u8,
    detail: []const u8,
};

const TempCycle = struct {
    half_edge_indices: []usize,
    floor: i32,
    signed_area_twice: Wide,
};

const TempExterior = struct {
    floor: i32,
    cycle_indices: std.ArrayList(usize),
};

const VertexSortContext = struct {
    vertices: []const types.WallVertex,
};

const EdgeSortContext = struct {
    vertices: []const types.WallVertex,
    edges: []const types.WallEdge,
    vertex_indices: *const std.StringHashMap(usize),
};

const EdgeSpatialSortContext = struct {
    vertices: []const types.WallVertex,
    edges: []const types.WallEdge,
    vertex_indices: *const std.StringHashMap(usize),
};

const EdgeBounds = struct {
    floor: i32,
    min_x_u: types.Unit,
    min_z_u: types.Unit,
    max_x_u: types.Unit,
    max_z_u: types.Unit,
};

const AngularSortContext = struct {
    source_vertices: []const types.WallVertex,
    canonical_vertex_sources: []const usize,
    half_edges: []const DerivedHalfEdge,
};

const std = @import("std");

/// Construct a normalized planar half-edge graph from validated source walls.
/// All returned memory belongs to `allocator`; no returned slice borrows source.
pub fn build(
    allocator: std.mem.Allocator,
    source: *const types.WallSource,
) (BuildError || std.mem.Allocator.Error)!DerivedTopology {
    return buildWithOptions(allocator, source, .{});
}

pub fn buildWithOptions(
    allocator: std.mem.Allocator,
    source: *const types.WallSource,
    options: BuildOptions,
) (BuildError || std.mem.Allocator.Error)!DerivedTopology {
    var scratch_arena = std.heap.ArenaAllocator.init(allocator);
    defer scratch_arena.deinit();
    const scratch = scratch_arena.allocator();

    var vertex_indices = std.StringHashMap(usize).init(scratch);
    for (source.vertices, 0..) |vertex_source, index| {
        try vertex_indices.put(vertex_source.id, index);
    }

    const canonical_vertex_sources = try scratch.alloc(usize, source.vertices.len);
    for (canonical_vertex_sources, 0..) |*source_index, index| source_index.* = index;
    std.mem.sort(
        usize,
        canonical_vertex_sources,
        VertexSortContext{ .vertices = source.vertices },
        vertexSourceLessThan,
    );
    const source_to_canonical_vertex = try scratch.alloc(usize, source.vertices.len);
    for (canonical_vertex_sources, 0..) |source_index, canonical_index| {
        source_to_canonical_vertex[source_index] = canonical_index;
    }

    const canonical_edge_sources = try scratch.alloc(usize, source.edges.len);
    for (canonical_edge_sources, 0..) |*source_index, index| source_index.* = index;
    std.mem.sort(
        usize,
        canonical_edge_sources,
        EdgeSortContext{
            .vertices = source.vertices,
            .edges = source.edges,
            .vertex_indices = &vertex_indices,
        },
        edgeSourceLessThan,
    );

    var pending_diagnostics: std.ArrayList(PendingDiagnostic) = .empty;
    var active_edge_sources: std.ArrayList(usize) = .empty;
    for (canonical_edge_sources) |source_edge_index| {
        const edge = source.edges[source_edge_index];
        const start_source_index = vertex_indices.get(edge.start_vertex_id) orelse
            return error.missing_vertex_reference;
        const end_source_index = vertex_indices.get(edge.end_vertex_id) orelse
            return error.missing_vertex_reference;
        const start = source.vertices[start_source_index];
        const end = source.vertices[end_source_index];
        if (start.floor != end.floor) return error.cross_floor_edge;
        if (start_source_index == end_source_index or
            (start.x_u == end.x_u and start.z_u == end.z_u))
        {
            try appendPendingDiagnostic(
                scratch,
                &pending_diagnostics,
                .self_loop,
                start.floor,
                &.{edge.id},
                "self-loop excluded from half-edge construction",
            );
            continue;
        }
        try active_edge_sources.append(scratch, source_edge_index);
    }
    try inspectDegenerateEdgePairs(
        scratch,
        source,
        &vertex_indices,
        active_edge_sources.items,
        options.opening_clearance_zones,
        &pending_diagnostics,
    );

    const half_edge_count = std.math.mul(usize, active_edge_sources.items.len, 2) catch
        return error.OutOfMemory;
    const half_edges = try allocator.alloc(DerivedHalfEdge, half_edge_count);
    var initialized_half_edges: usize = 0;
    errdefer {
        for (half_edges[0..initialized_half_edges]) |*half_edge| half_edge.deinit(allocator);
        if (half_edges.len != 0) allocator.free(half_edges);
    }

    const outgoing = try scratch.alloc(std.ArrayList(usize), source.vertices.len);
    for (outgoing) |*indices| indices.* = .empty;

    for (active_edge_sources.items, 0..) |source_edge_index, canonical_edge_index| {
        const edge = source.edges[source_edge_index];
        const start_source_index = vertex_indices.get(edge.start_vertex_id) orelse
            return error.missing_vertex_reference;
        const end_source_index = vertex_indices.get(edge.end_vertex_id) orelse
            return error.missing_vertex_reference;
        const start_index = source_to_canonical_vertex[start_source_index];
        const end_index = source_to_canonical_vertex[end_source_index];

        const side_a_index = canonical_edge_index * 2;
        const side_b_index = side_a_index + 1;
        const unset = std.math.maxInt(usize);
        half_edges[side_a_index] = .{
            .source_edge_id = try allocator.dupe(u8, edge.id),
            .source_side = .a,
            .origin_vertex_index = start_index,
            .target_vertex_index = end_index,
            .twin_half_edge_index = side_b_index,
            .next_half_edge_index = unset,
            .previous_half_edge_index = unset,
            .face = null,
        };
        initialized_half_edges += 1;
        half_edges[side_b_index] = .{
            .source_edge_id = try allocator.dupe(u8, edge.id),
            .source_side = .b,
            .origin_vertex_index = end_index,
            .target_vertex_index = start_index,
            .twin_half_edge_index = side_a_index,
            .next_half_edge_index = unset,
            .previous_half_edge_index = unset,
            .face = null,
        };
        initialized_half_edges += 1;
        try outgoing[start_index].append(scratch, side_a_index);
        try outgoing[end_index].append(scratch, side_b_index);
    }

    const angular_context = AngularSortContext{
        .source_vertices = source.vertices,
        .canonical_vertex_sources = canonical_vertex_sources,
        .half_edges = half_edges,
    };
    for (outgoing) |*indices| {
        std.mem.sort(usize, indices.items, angular_context, halfEdgeAngleLessThan);
    }

    for (half_edges, 0..) |*half_edge, half_edge_index| {
        const target_outgoing = outgoing[half_edge.target_vertex_index].items;
        const twin_position = std.mem.indexOfScalar(
            usize,
            target_outgoing,
            half_edge.twin_half_edge_index,
        ) orelse return error.half_edge_link_failure;
        const next_position = if (twin_position == 0)
            target_outgoing.len - 1
        else
            twin_position - 1;
        const next_index = target_outgoing[next_position];
        half_edge.next_half_edge_index = next_index;
        half_edges[next_index].previous_half_edge_index = half_edge_index;
    }

    const vertices = try allocator.alloc(DerivedVertex, source.vertices.len);
    var initialized_vertices: usize = 0;
    errdefer {
        for (vertices[0..initialized_vertices]) |*vertex| vertex.deinit(allocator);
        if (vertices.len != 0) allocator.free(vertices);
    }
    for (canonical_vertex_sources, 0..) |source_vertex_index, index| {
        const vertex_source = source.vertices[source_vertex_index];
        const source_vertex_id = try allocator.dupe(u8, vertex_source.id);
        errdefer allocator.free(source_vertex_id);
        const outgoing_indices = try allocator.dupe(usize, outgoing[index].items);
        vertices[index] = .{
            .source_vertex_id = source_vertex_id,
            .floor = vertex_source.floor,
            .point = .{ .x_u = vertex_source.x_u, .z_u = vertex_source.z_u },
            .outgoing_half_edge_indices = outgoing_indices,
        };
        initialized_vertices += 1;
    }

    const visited = try scratch.alloc(bool, half_edges.len);
    @memset(visited, false);
    var cycles: std.ArrayList(TempCycle) = .empty;
    const maximum_face_steps = options.maximum_face_steps orelse half_edges.len;
    cycle_walks: for (half_edges, 0..) |_, start_index| {
        if (visited[start_index]) continue;
        var cycle_indices: std.ArrayList(usize) = .empty;
        var current = start_index;
        var step_count: usize = 0;
        while (true) {
            if (current == start_index and step_count != 0) break;
            if (step_count >= maximum_face_steps) {
                const start_half_edge = half_edges[start_index];
                const floor = vertices[start_half_edge.origin_vertex_index].floor;
                try appendPendingDiagnostic(
                    scratch,
                    &pending_diagnostics,
                    .face_traversal_limit,
                    floor,
                    &.{start_half_edge.source_edge_id},
                    "face walk did not close within its configured half-edge bound",
                );
                break :cycle_walks;
            }
            if (visited[current] and current != start_index) return error.half_edge_link_failure;
            visited[current] = true;
            try cycle_indices.append(scratch, current);
            current = half_edges[current].next_half_edge_index;
            step_count += 1;
        }
        const owned_cycle = try cycle_indices.toOwnedSlice(scratch);
        try cycles.append(scratch, .{
            .half_edge_indices = owned_cycle,
            .floor = vertices[half_edges[start_index].origin_vertex_index].floor,
            .signed_area_twice = signedCycleArea(owned_cycle, half_edges, vertices),
        });
    }

    const cycle_face_indices = try scratch.alloc(?usize, cycles.items.len);
    @memset(cycle_face_indices, null);
    var face_count: usize = 0;
    for (cycles.items, 0..) |cycle, cycle_index| {
        if (cycle.signed_area_twice <= 0) continue;
        cycle_face_indices[cycle_index] = face_count;
        face_count += 1;
    }

    const cycle_hole_targets = try scratch.alloc(?usize, cycles.items.len);
    @memset(cycle_hole_targets, null);
    for (cycles.items, 0..) |cycle, cycle_index| {
        if (cycle.signed_area_twice >= 0) continue;
        const sample_half_edge = half_edges[cycle.half_edge_indices[0]];
        const sample = vertices[sample_half_edge.origin_vertex_index].point;
        var smallest_container: ?usize = null;
        var smallest_area: Wide = std.math.maxInt(Wide);
        for (cycles.items, 0..) |candidate, candidate_cycle_index| {
            if (candidate.floor != cycle.floor or candidate.signed_area_twice <= 0) continue;
            if (!cycleContainsPointStrict(candidate, half_edges, vertices, sample)) continue;
            if (candidate.signed_area_twice < smallest_area) {
                smallest_area = candidate.signed_area_twice;
                smallest_container = cycle_face_indices[candidate_cycle_index].?;
            }
        }
        cycle_hole_targets[cycle_index] = smallest_container;
    }

    const cycle_hole_indices = try scratch.alloc(?usize, cycles.items.len);
    @memset(cycle_hole_indices, null);
    const face_holes = try scratch.alloc(std.ArrayList(usize), face_count);
    for (face_holes) |*indices| indices.* = .empty;
    var hole_count: usize = 0;
    for (cycles.items, 0..) |cycle, cycle_index| {
        _ = cycle;
        const containing_face = cycle_hole_targets[cycle_index] orelse continue;
        cycle_hole_indices[cycle_index] = hole_count;
        try face_holes[containing_face].append(scratch, hole_count);
        hole_count += 1;
    }

    var exterior_groups: std.ArrayList(TempExterior) = .empty;
    var exterior_by_floor = std.AutoHashMap(i32, usize).init(scratch);
    for (cycles.items, 0..) |cycle, cycle_index| {
        if (cycle.signed_area_twice > 0 or cycle_hole_targets[cycle_index] != null) continue;
        const result = try exterior_by_floor.getOrPut(cycle.floor);
        if (!result.found_existing) {
            result.value_ptr.* = exterior_groups.items.len;
            try exterior_groups.append(scratch, .{ .floor = cycle.floor, .cycle_indices = .empty });
        }
        try exterior_groups.items[result.value_ptr.*].cycle_indices.append(scratch, cycle_index);
    }

    const faces = try allocator.alloc(DerivedFace, face_count);
    var initialized_faces: usize = 0;
    errdefer {
        for (faces[0..initialized_faces]) |*face| face.deinit(allocator);
        if (faces.len != 0) allocator.free(faces);
    }
    for (cycles.items, 0..) |cycle, cycle_index| {
        const face_index = cycle_face_indices[cycle_index] orelse continue;
        const signature = try cycleSignature(allocator, "face", cycle, half_edges);
        errdefer allocator.free(signature);
        const outer_half_edges = try allocator.dupe(usize, cycle.half_edge_indices);
        errdefer if (outer_half_edges.len != 0) allocator.free(outer_half_edges);
        const hole_indices = try allocator.dupe(usize, face_holes[face_index].items);
        errdefer if (hole_indices.len != 0) allocator.free(hole_indices);
        faces[face_index] = .{
            .signature = signature,
            .floor = cycle.floor,
            .outer_boundary = .{ .half_edge_indices = outer_half_edges },
            .hole_indices = hole_indices,
            .signed_area_twice = cycle.signed_area_twice,
        };
        initialized_faces += 1;
    }

    const holes = try allocator.alloc(DerivedHole, hole_count);
    var initialized_holes: usize = 0;
    errdefer {
        for (holes[0..initialized_holes]) |*hole| hole.deinit(allocator);
        if (holes.len != 0) allocator.free(holes);
    }
    for (cycles.items, 0..) |cycle, cycle_index| {
        const hole_index = cycle_hole_indices[cycle_index] orelse continue;
        const signature = try cycleSignature(allocator, "hole", cycle, half_edges);
        errdefer allocator.free(signature);
        const boundary_half_edges = try allocator.dupe(usize, cycle.half_edge_indices);
        errdefer if (boundary_half_edges.len != 0) allocator.free(boundary_half_edges);
        holes[hole_index] = .{
            .signature = signature,
            .floor = cycle.floor,
            .boundary = .{ .half_edge_indices = boundary_half_edges },
            .containing_face_index = cycle_hole_targets[cycle_index].?,
            .signed_area_twice = cycle.signed_area_twice,
        };
        initialized_holes += 1;
    }

    const exteriors = try allocator.alloc(DerivedExterior, exterior_groups.items.len);
    var initialized_exteriors: usize = 0;
    errdefer {
        for (exteriors[0..initialized_exteriors]) |*exterior| exterior.deinit(allocator);
        if (exteriors.len != 0) allocator.free(exteriors);
    }
    for (exterior_groups.items, 0..) |group, exterior_index| {
        const boundary_cycles = try allocator.alloc(IndexCycle, group.cycle_indices.items.len);
        var initialized_cycles: usize = 0;
        errdefer {
            for (boundary_cycles[0..initialized_cycles]) |*cycle| cycle.deinit(allocator);
            if (boundary_cycles.len != 0) allocator.free(boundary_cycles);
        }
        for (group.cycle_indices.items, 0..) |cycle_index, boundary_index| {
            boundary_cycles[boundary_index] = .{
                .half_edge_indices = try allocator.dupe(usize, cycles.items[cycle_index].half_edge_indices),
            };
            initialized_cycles += 1;
        }
        exteriors[exterior_index] = .{ .floor = group.floor, .boundary_cycles = boundary_cycles };
        initialized_exteriors += 1;
    }

    for (cycles.items, 0..) |cycle, cycle_index| {
        const face_ref: FaceRef = if (cycle_face_indices[cycle_index]) |face_index|
            .{ .interior = face_index }
        else if (cycle_hole_targets[cycle_index]) |face_index|
            .{ .interior = face_index }
        else
            .{ .exterior = exterior_by_floor.get(cycle.floor).? };
        for (cycle.half_edge_indices) |half_edge_index| half_edges[half_edge_index].face = face_ref;
    }

    const diagnostics = try materializeDiagnostics(allocator, pending_diagnostics.items);
    return .{
        .vertices = vertices,
        .half_edges = half_edges,
        .faces = faces,
        .exteriors = exteriors,
        .holes = holes,
        .diagnostics = diagnostics,
    };
}

pub fn vector(from: Point, to: Point) Vector {
    return .{
        .x_u = @as(i64, to.x_u) - @as(i64, from.x_u),
        .z_u = @as(i64, to.z_u) - @as(i64, from.z_u),
    };
}

/// Positive is a counter-clockwise turn, negative clockwise, and zero collinear.
pub fn orientation(a: Point, b: Point, c: Point) Wide {
    const ab = vector(a, b);
    const ac = vector(a, c);
    return cross(ab, ac);
}

pub fn collinear(a: Point, b: Point, c: Point) bool {
    return orientation(a, b, c) == 0;
}

pub fn pointOnSegment(point: Point, start: Point, end: Point) bool {
    if (!collinear(start, end, point)) return false;
    return betweenInclusive(point.x_u, start.x_u, end.x_u) and
        betweenInclusive(point.z_u, start.z_u, end.z_u);
}

pub fn properSegmentsIntersect(a: Point, b: Point, c: Point, d: Point) bool {
    const abc = orientation(a, b, c);
    const abd = orientation(a, b, d);
    const cda = orientation(c, d, a);
    const cdb = orientation(c, d, b);
    return oppositeSigns(abc, abd) and oppositeSigns(cda, cdb);
}

pub fn classifySegmentIntersection(a: Point, b: Point, c: Point, d: Point) SegmentIntersectionKind {
    const abc = orientation(a, b, c);
    const abd = orientation(a, b, d);
    const cda = orientation(c, d, a);
    const cdb = orientation(c, d, b);

    if (abc == 0 and abd == 0 and cda == 0 and cdb == 0) {
        return classifyCollinearIntersection(a, b, c, d);
    }
    if (oppositeSigns(abc, abd) and oppositeSigns(cda, cdb)) return .proper;
    if ((abc == 0 and pointOnSegment(c, a, b)) or
        (abd == 0 and pointOnSegment(d, a, b)) or
        (cda == 0 and pointOnSegment(a, c, d)) or
        (cdb == 0 and pointOnSegment(b, c, d)))
    {
        return .endpoint_touch;
    }
    return .none;
}

/// Infinite-line intersection in canonical exact rationals. Parallel and
/// collinear lines return null; segment membership is handled separately.
pub fn lineIntersection(a: Point, b: Point, c: Point, d: Point) ?RationalPoint {
    const ab = vector(a, b);
    const cd = vector(c, d);
    const denominator = cross(ab, cd);
    if (denominator == 0) return null;

    const ac = vector(a, c);
    const parameter_numerator = cross(ac, cd);
    const x_numerator = @as(Wide, a.x_u) * denominator +
        @as(Wide, ab.x_u) * parameter_numerator;
    const z_numerator = @as(Wide, a.z_u) * denominator +
        @as(Wide, ab.z_u) * parameter_numerator;
    return .{
        .x = Rational.init(x_numerator, denominator),
        .z = Rational.init(z_numerator, denominator),
    };
}

/// Exact parameter `t` for `a + t(b-a)` at the infinite-line intersection.
/// Its canonical denominator is positive, which makes comparison deterministic
/// even when the source segment direction is reversed.
pub fn intersectionParameter(a: Point, b: Point, c: Point, d: Point) ?Rational {
    const ab = vector(a, b);
    const cd = vector(c, d);
    const denominator = cross(ab, cd);
    if (denominator == 0) return null;
    return Rational.init(cross(vector(a, c), cd), denominator);
}

pub fn rationalLessThan(left: Rational, right: Rational) bool {
    return left.numerator * right.denominator < right.numerator * left.denominator;
}

/// Return the unique segment intersection only when it lies exactly on the
/// architecture lattice. A collinear range and a fractional crossing are typed
/// failures rather than guessed topology.
pub fn exactSegmentIntersection(
    a: Point,
    b: Point,
    c: Point,
    d: Point,
) ExactIntersectionError!?Point {
    switch (classifySegmentIntersection(a, b, c, d)) {
        .none => return null,
        .collinear_overlap => return error.collinear_overlap,
        .endpoint_touch => {
            const candidates = [_]Point{ a, b, c, d };
            for (candidates) |candidate| {
                if (pointOnSegment(candidate, a, b) and pointOnSegment(candidate, c, d)) {
                    return candidate;
                }
            }
            unreachable;
        },
        .proper => {
            const rational = lineIntersection(a, b, c, d) orelse unreachable;
            if (!rational.x.isInteger() or !rational.z.isInteger()) {
                return error.intersection_off_lattice;
            }
            const x = @divExact(rational.x.numerator, rational.x.denominator);
            const z = @divExact(rational.z.numerator, rational.z.denominator);
            if (x < types.Limits.minimum_unit or x > types.Limits.maximum_unit or
                z < types.Limits.minimum_unit or z > types.Limits.maximum_unit)
            {
                return error.intersection_out_of_range;
            }
            return .{ .x_u = @intCast(x), .z_u = @intCast(z) };
        },
    }
}

fn cross(left: Vector, right: Vector) Wide {
    return @as(Wide, left.x_u) * @as(Wide, right.z_u) -
        @as(Wide, left.z_u) * @as(Wide, right.x_u);
}

fn oppositeSigns(left: Wide, right: Wide) bool {
    return (left < 0 and right > 0) or (left > 0 and right < 0);
}

fn betweenInclusive(value: types.Unit, endpoint_a: types.Unit, endpoint_b: types.Unit) bool {
    return value >= @min(endpoint_a, endpoint_b) and value <= @max(endpoint_a, endpoint_b);
}

fn classifyCollinearIntersection(a: Point, b: Point, c: Point, d: Point) SegmentIntersectionKind {
    const ab = vector(a, b);
    const use_x = unsignedMagnitude(ab.x_u) >= unsignedMagnitude(ab.z_u);
    const a_scalar: i64 = if (use_x) a.x_u else a.z_u;
    const b_scalar: i64 = if (use_x) b.x_u else b.z_u;
    const c_scalar: i64 = if (use_x) c.x_u else c.z_u;
    const d_scalar: i64 = if (use_x) d.x_u else d.z_u;
    const overlap_start = @max(@min(a_scalar, b_scalar), @min(c_scalar, d_scalar));
    const overlap_end = @min(@max(a_scalar, b_scalar), @max(c_scalar, d_scalar));
    if (overlap_start > overlap_end) return .none;
    if (overlap_start == overlap_end) return .endpoint_touch;
    return .collinear_overlap;
}

fn vertexSourceLessThan(context: VertexSortContext, left_index: usize, right_index: usize) bool {
    const left = context.vertices[left_index];
    const right = context.vertices[right_index];
    if (left.floor != right.floor) return left.floor < right.floor;
    const id_order = std.mem.order(u8, left.id, right.id);
    if (id_order != .eq) return id_order == .lt;
    if (left.x_u != right.x_u) return left.x_u < right.x_u;
    if (left.z_u != right.z_u) return left.z_u < right.z_u;
    return left_index < right_index;
}

fn edgeSourceLessThan(context: EdgeSortContext, left_index: usize, right_index: usize) bool {
    const left = context.edges[left_index];
    const right = context.edges[right_index];
    const left_vertex_index = context.vertex_indices.get(left.start_vertex_id) orelse unreachable;
    const right_vertex_index = context.vertex_indices.get(right.start_vertex_id) orelse unreachable;
    const left_floor = context.vertices[left_vertex_index].floor;
    const right_floor = context.vertices[right_vertex_index].floor;
    if (left_floor != right_floor) return left_floor < right_floor;
    const id_order = std.mem.order(u8, left.id, right.id);
    if (id_order != .eq) return id_order == .lt;
    const start_order = std.mem.order(u8, left.start_vertex_id, right.start_vertex_id);
    if (start_order != .eq) return start_order == .lt;
    const end_order = std.mem.order(u8, left.end_vertex_id, right.end_vertex_id);
    if (end_order != .eq) return end_order == .lt;
    return left_index < right_index;
}

fn edgeSpatialSourceLessThan(context: EdgeSpatialSortContext, left_index: usize, right_index: usize) bool {
    const left = edgeBounds(context.vertices, context.edges[left_index], context.vertex_indices);
    const right = edgeBounds(context.vertices, context.edges[right_index], context.vertex_indices);
    if (left.floor != right.floor) return left.floor < right.floor;
    if (left.min_x_u != right.min_x_u) return left.min_x_u < right.min_x_u;
    if (left.min_z_u != right.min_z_u) return left.min_z_u < right.min_z_u;
    if (left.max_x_u != right.max_x_u) return left.max_x_u < right.max_x_u;
    if (left.max_z_u != right.max_z_u) return left.max_z_u < right.max_z_u;
    const id_order = std.mem.order(u8, context.edges[left_index].id, context.edges[right_index].id);
    if (id_order != .eq) return id_order == .lt;
    return left_index < right_index;
}

fn halfEdgeAngleLessThan(context: AngularSortContext, left_index: usize, right_index: usize) bool {
    const left = context.half_edges[left_index];
    const right = context.half_edges[right_index];
    const left_origin = context.source_vertices[context.canonical_vertex_sources[left.origin_vertex_index]];
    const left_target = context.source_vertices[context.canonical_vertex_sources[left.target_vertex_index]];
    const right_origin = context.source_vertices[context.canonical_vertex_sources[right.origin_vertex_index]];
    const right_target = context.source_vertices[context.canonical_vertex_sources[right.target_vertex_index]];
    const left_direction = vector(
        .{ .x_u = left_origin.x_u, .z_u = left_origin.z_u },
        .{ .x_u = left_target.x_u, .z_u = left_target.z_u },
    );
    const right_direction = vector(
        .{ .x_u = right_origin.x_u, .z_u = right_origin.z_u },
        .{ .x_u = right_target.x_u, .z_u = right_target.z_u },
    );

    const left_half = angularHalf(left_direction);
    const right_half = angularHalf(right_direction);
    if (left_half != right_half) return left_half < right_half;
    const turn = cross(left_direction, right_direction);
    if (turn != 0) return turn > 0;

    const id_order = std.mem.order(u8, left.source_edge_id, right.source_edge_id);
    if (id_order != .eq) return id_order == .lt;
    if (left.source_side != right.source_side) {
        return @intFromEnum(left.source_side) < @intFromEnum(right.source_side);
    }
    return left_index < right_index;
}

fn angularHalf(direction: Vector) u1 {
    return if (direction.z_u > 0 or (direction.z_u == 0 and direction.x_u >= 0)) 0 else 1;
}

fn signedCycleArea(
    cycle: []const usize,
    half_edges: []const DerivedHalfEdge,
    vertices: []const DerivedVertex,
) Wide {
    var area: Wide = 0;
    for (cycle) |half_edge_index| {
        const half_edge = half_edges[half_edge_index];
        const origin = vertices[half_edge.origin_vertex_index].point;
        const target = vertices[half_edge.target_vertex_index].point;
        area += @as(Wide, origin.x_u) * @as(Wide, target.z_u) -
            @as(Wide, target.x_u) * @as(Wide, origin.z_u);
    }
    return area;
}

fn cycleContainsPointStrict(
    cycle: TempCycle,
    half_edges: []const DerivedHalfEdge,
    vertices: []const DerivedVertex,
    point: Point,
) bool {
    var winding: i64 = 0;
    for (cycle.half_edge_indices) |half_edge_index| {
        const half_edge = half_edges[half_edge_index];
        const start = vertices[half_edge.origin_vertex_index].point;
        const end = vertices[half_edge.target_vertex_index].point;
        if (pointOnSegment(point, start, end)) return false;
        if (start.z_u <= point.z_u) {
            if (end.z_u > point.z_u and orientation(start, end, point) > 0) winding += 1;
        } else if (end.z_u <= point.z_u and orientation(start, end, point) < 0) {
            winding -= 1;
        }
    }
    return winding != 0;
}

fn cycleSignature(
    allocator: std.mem.Allocator,
    kind: []const u8,
    cycle: TempCycle,
    half_edges: []const DerivedHalfEdge,
) std.mem.Allocator.Error![]u8 {
    var bytes: std.ArrayList(u8) = .empty;
    errdefer bytes.deinit(allocator);
    try bytes.appendSlice(allocator, kind);
    try bytes.append(allocator, ':');
    var floor_buffer: [32]u8 = undefined;
    const floor_text = std.fmt.bufPrint(&floor_buffer, "{d}", .{cycle.floor}) catch unreachable;
    try bytes.appendSlice(allocator, floor_text);
    for (cycle.half_edge_indices) |half_edge_index| {
        const half_edge = half_edges[half_edge_index];
        try bytes.append(allocator, '|');
        var length_buffer: [32]u8 = undefined;
        const length_text = std.fmt.bufPrint(&length_buffer, "{d}", .{half_edge.source_edge_id.len}) catch unreachable;
        try bytes.appendSlice(allocator, length_text);
        try bytes.append(allocator, '#');
        try bytes.appendSlice(allocator, half_edge.source_edge_id);
        try bytes.append(allocator, ':');
        try bytes.append(allocator, if (half_edge.source_side == .a) 'a' else 'b');
    }
    var digest: [std.crypto.hash.sha2.Sha256.digest_length]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes.items, &digest, .{});
    const digest_hex = std.fmt.bytesToHex(digest, .lower);
    const signature = try allocator.dupe(u8, &digest_hex);
    bytes.deinit(allocator);
    return signature;
}

fn inspectDegenerateEdgePairs(
    scratch: std.mem.Allocator,
    source: *const types.WallSource,
    vertex_indices: *const std.StringHashMap(usize),
    active_edge_sources: []const usize,
    clearance_zones: []const OpeningClearanceZone,
    diagnostics: *std.ArrayList(PendingDiagnostic),
) std.mem.Allocator.Error!void {
    const spatial_order = try scratch.dupe(usize, active_edge_sources);
    std.mem.sort(
        usize,
        spatial_order,
        EdgeSpatialSortContext{
            .vertices = source.vertices,
            .edges = source.edges,
            .vertex_indices = vertex_indices,
        },
        edgeSpatialSourceLessThan,
    );

    for (spatial_order, 0..) |left_edge_index, left_order_index| {
        const left_edge = source.edges[left_edge_index];
        const left_bounds = edgeBounds(source.vertices, left_edge, vertex_indices);
        const left_points = edgePoints(source, left_edge, vertex_indices);
        for (spatial_order[left_order_index + 1 ..]) |right_edge_index| {
            const right_edge = source.edges[right_edge_index];
            const right_bounds = edgeBounds(source.vertices, right_edge, vertex_indices);
            if (right_bounds.floor != left_bounds.floor) break;
            if (right_bounds.min_x_u > left_bounds.max_x_u) break;
            if (right_bounds.min_z_u > left_bounds.max_z_u or
                right_bounds.max_z_u < left_bounds.min_z_u)
            {
                continue;
            }

            const right_points = edgePoints(source, right_edge, vertex_indices);
            switch (classifySegmentIntersection(
                left_points.start,
                left_points.end,
                right_points.start,
                right_points.end,
            )) {
                .none, .endpoint_touch => {},
                .collinear_overlap => {
                    const duplicate = (pointsEqual(left_points.start, right_points.start) and
                        pointsEqual(left_points.end, right_points.end)) or
                        (pointsEqual(left_points.start, right_points.end) and
                            pointsEqual(left_points.end, right_points.start));
                    try appendPendingDiagnostic(
                        scratch,
                        diagnostics,
                        if (duplicate) .duplicate_coincident_edge else .partial_collinear_overlap,
                        left_bounds.floor,
                        &.{ left_edge.id, right_edge.id },
                        if (duplicate)
                            "coincident source edges retained for explicit rejection"
                        else
                            "partially overlapping collinear source edges retained for explicit rejection",
                    );
                },
                .proper => {
                    try appendPendingDiagnostic(
                        scratch,
                        diagnostics,
                        .unsplit_intersection,
                        left_bounds.floor,
                        &.{ left_edge.id, right_edge.id },
                        "proper source-edge crossing requires a committed lattice junction",
                    );
                    const intersection = exactSegmentIntersection(
                        left_points.start,
                        left_points.end,
                        right_points.start,
                        right_points.end,
                    ) catch null;
                    if (intersection) |intersection_point| {
                        try appendClearanceDiagnostics(
                            scratch,
                            diagnostics,
                            clearance_zones,
                            left_edge,
                            left_points,
                            right_edge,
                            intersection_point,
                            left_bounds.floor,
                        );
                        try appendClearanceDiagnostics(
                            scratch,
                            diagnostics,
                            clearance_zones,
                            right_edge,
                            right_points,
                            left_edge,
                            intersection_point,
                            left_bounds.floor,
                        );
                    }
                },
            }
        }
    }
}

const EdgePoints = struct { start: Point, end: Point };

fn edgePoints(
    source: *const types.WallSource,
    edge: types.WallEdge,
    vertex_indices: *const std.StringHashMap(usize),
) EdgePoints {
    const start = source.vertices[vertex_indices.get(edge.start_vertex_id).?];
    const end = source.vertices[vertex_indices.get(edge.end_vertex_id).?];
    return .{
        .start = .{ .x_u = start.x_u, .z_u = start.z_u },
        .end = .{ .x_u = end.x_u, .z_u = end.z_u },
    };
}

fn edgeBounds(
    vertices: []const types.WallVertex,
    edge: types.WallEdge,
    vertex_indices: *const std.StringHashMap(usize),
) EdgeBounds {
    const start = vertices[vertex_indices.get(edge.start_vertex_id).?];
    const end = vertices[vertex_indices.get(edge.end_vertex_id).?];
    return .{
        .floor = start.floor,
        .min_x_u = @min(start.x_u, end.x_u),
        .min_z_u = @min(start.z_u, end.z_u),
        .max_x_u = @max(start.x_u, end.x_u),
        .max_z_u = @max(start.z_u, end.z_u),
    };
}

fn appendClearanceDiagnostics(
    scratch: std.mem.Allocator,
    diagnostics: *std.ArrayList(PendingDiagnostic),
    clearance_zones: []const OpeningClearanceZone,
    owning_edge: types.WallEdge,
    owning_edge_points: EdgePoints,
    crossing_edge: types.WallEdge,
    intersection: Point,
    floor: i32,
) std.mem.Allocator.Error!void {
    for (clearance_zones) |zone| {
        if (!std.mem.eql(u8, zone.edge_id, owning_edge.id)) continue;
        if (!pointWithinClearanceColumns(
            owning_edge_points.start,
            owning_edge_points.end,
            intersection,
            zone.minimum_column_u,
            zone.maximum_column_exclusive_u,
        )) continue;
        try appendPendingDiagnostic(
            scratch,
            diagnostics,
            .intersection_in_opening_clearance,
            floor,
            &.{ crossing_edge.id, zone.opening_id, owning_edge.id },
            "source-edge crossing intersects a measured opening clearance interval",
        );
    }
}

fn pointWithinClearanceColumns(
    start: Point,
    end: Point,
    intersection: Point,
    minimum_column_u: types.Unit,
    maximum_column_exclusive_u: types.Unit,
) bool {
    if (maximum_column_exclusive_u <= 0 or
        minimum_column_u >= maximum_column_exclusive_u)
    {
        return false;
    }
    const direction = vector(start, end);
    const offset = vector(start, intersection);
    const projection = @as(Wide, offset.x_u) * @as(Wide, direction.x_u) +
        @as(Wide, offset.z_u) * @as(Wide, direction.z_u);
    if (projection < 0) return false;
    const length_squared = @as(Wide, direction.x_u) * @as(Wide, direction.x_u) +
        @as(Wide, direction.z_u) * @as(Wide, direction.z_u);
    const projection_squared = projection * projection;
    const clamped_minimum: Wide = @max(0, minimum_column_u);
    const maximum: Wide = maximum_column_exclusive_u;
    return projection_squared >= clamped_minimum * clamped_minimum * length_squared and
        projection_squared < maximum * maximum * length_squared;
}

fn appendPendingDiagnostic(
    scratch: std.mem.Allocator,
    diagnostics: *std.ArrayList(PendingDiagnostic),
    code: DiagnosticCode,
    floor: i32,
    source_ids: []const []const u8,
    detail: []const u8,
) std.mem.Allocator.Error!void {
    const ordered_ids = try scratch.dupe([]const u8, source_ids);
    std.mem.sort([]const u8, ordered_ids, {}, stringLessThan);
    try diagnostics.append(scratch, .{
        .code = code,
        .floor = floor,
        .source_ids = ordered_ids,
        .detail = detail,
    });
}

fn materializeDiagnostics(
    allocator: std.mem.Allocator,
    pending: []PendingDiagnostic,
) std.mem.Allocator.Error![]TopologyDiagnostic {
    std.mem.sort(PendingDiagnostic, pending, {}, pendingDiagnosticLessThan);
    const diagnostics = try allocator.alloc(TopologyDiagnostic, pending.len);
    var initialized_diagnostics: usize = 0;
    errdefer {
        for (diagnostics[0..initialized_diagnostics]) |*diagnostic| diagnostic.deinit(allocator);
        if (diagnostics.len != 0) allocator.free(diagnostics);
    }
    for (pending, 0..) |pending_diagnostic, diagnostic_index| {
        const source_ids = try allocator.alloc([]u8, pending_diagnostic.source_ids.len);
        var initialized_ids: usize = 0;
        errdefer {
            for (source_ids[0..initialized_ids]) |source_id| allocator.free(source_id);
            if (source_ids.len != 0) allocator.free(source_ids);
        }
        for (pending_diagnostic.source_ids, 0..) |source_id, source_id_index| {
            source_ids[source_id_index] = try allocator.dupe(u8, source_id);
            initialized_ids += 1;
        }
        const detail = try allocator.dupe(u8, pending_diagnostic.detail);
        diagnostics[diagnostic_index] = .{
            .code = pending_diagnostic.code,
            .floor = pending_diagnostic.floor,
            .source_ids = source_ids,
            .detail = detail,
        };
        initialized_diagnostics += 1;
    }
    return diagnostics;
}

fn pendingDiagnosticLessThan(_: void, left: PendingDiagnostic, right: PendingDiagnostic) bool {
    if (left.floor != right.floor) return left.floor < right.floor;
    if (left.code != right.code) return @intFromEnum(left.code) < @intFromEnum(right.code);
    const shared_count = @min(left.source_ids.len, right.source_ids.len);
    for (left.source_ids[0..shared_count], right.source_ids[0..shared_count]) |left_id, right_id| {
        const order = std.mem.order(u8, left_id, right_id);
        if (order != .eq) return order == .lt;
    }
    if (left.source_ids.len != right.source_ids.len) return left.source_ids.len < right.source_ids.len;
    return std.mem.lessThan(u8, left.detail, right.detail);
}

fn stringLessThan(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}

fn pointsEqual(left: Point, right: Point) bool {
    return left.x_u == right.x_u and left.z_u == right.z_u;
}

fn unsignedMagnitude(value: anytype) std.meta.Int(.unsigned, @typeInfo(@TypeOf(value)).int.bits) {
    const T = @TypeOf(value);
    const Unsigned = std.meta.Int(.unsigned, @typeInfo(T).int.bits);
    if (value >= 0) return @intCast(value);
    return @as(Unsigned, @intCast(-(value + 1))) + 1;
}

fn greatestCommonDivisor(left: u128, right: u128) u128 {
    var a = left;
    var b = right;
    while (b != 0) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }
    return if (a == 0) 1 else a;
}

fn freeBytes(allocator: std.mem.Allocator, bytes: []u8) void {
    if (bytes.len != 0) allocator.free(bytes);
}

fn freeSlice(comptime T: type, allocator: std.mem.Allocator, values: []T) void {
    if (values.len != 0) allocator.free(values);
}

fn freeStringList(allocator: std.mem.Allocator, values: [][]u8) void {
    for (values) |value| freeBytes(allocator, value);
    freeSlice([]u8, allocator, values);
}
