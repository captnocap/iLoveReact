//! Derived floor plates for enclosed wall rooms.
//!
//! Floors here are DERIVED, never authored (USER RULING req_4482, 2026-08-15:
//! "the floor has to react with it" — when boundary walls move, grow, or are
//! deleted, the floor must follow). Every interior room face detected by the
//! wall topology receives exactly one plate; holes (courtyards) stay open; open
//! wall runs produce nothing. The authored floor-slab tool is a LATER family —
//! this module is the quick enclosure solve and owns no source records.
//!
//! All boundary math is exact integer/rational arithmetic on the 16 u = 1 m
//! lattice; meters appear only in the emitted triangles.

const std = @import("std");
const scale = @import("architecture_scale");
const types = @import("wall_types");
const topology = @import("wall_topology");
const geometry = @import("wall_geometry");

pub const FloorRole = enum(u8) { top, bottom, rim };

/// Plate thickness in lattice units: 1 u = 6.25 cm, mirroring the legacy 5 cm
/// `floor.concrete.common` plates the user already knows. Plates extrude UP
/// from the boundary walls' base plane (the legacy storey-0 plate policy), so
/// the walkable top never z-fights terrain.
pub const plate_thickness_u: types.Unit = 1;

pub const generated_floor_material_id = "floor:generated";

pub const FloorTriangle = struct {
    face_signature: []u8,
    floor: i32,
    role: FloorRole,
    material_id: []u8,
    corners_m: [3]geometry.Point3Meters,
    normal: geometry.Vector3,
    uv_m: [3]geometry.Point2Meters,

    pub fn deinit(self: *FloorTriangle, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.face_signature);
        freeBytes(allocator, self.material_id);
        self.* = undefined;
    }
};

pub const BuildError = std.mem.Allocator.Error;

const Point = topology.Point;
const Wide = topology.Wide;

/// One face selected for plating, with cleaned integer rings.
const PlateInput = struct {
    face_index: usize,
    signature: []const u8,
    floor: i32,
    base_y_u: types.Unit,
    outer: []Point,
    holes: [][]Point,
};

/// Derive every interior face's plate. `included` selects faces by index in
/// `derived.faces`; pass null to include all. Output order is canonical
/// (floor, then signature) so bundle bytes ignore source array order.
pub fn build(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    included: ?[]const bool,
) BuildError![]FloorTriangle {
    var scratch_arena = std.heap.ArenaAllocator.init(allocator);
    defer scratch_arena.deinit();
    const scratch = scratch_arena.allocator();

    var plates: std.ArrayList(PlateInput) = .empty;
    for (derived.faces, 0..) |*face, face_index| {
        if (included) |mask| {
            if (!mask[face_index]) continue;
        }
        const outer = try cleanedRing(scratch, derived, face.outer_boundary.half_edge_indices);
        if (outer.len < 3) continue;
        var holes: std.ArrayList([]Point) = .empty;
        for (face.hole_indices) |hole_index| {
            const hole_ring = try cleanedRing(scratch, derived, derived.holes[hole_index].boundary.half_edge_indices);
            if (hole_ring.len < 3) continue;
            try holes.append(scratch, hole_ring);
        }
        try plates.append(scratch, .{
            .face_index = face_index,
            .signature = face.signature,
            .floor = face.floor,
            .base_y_u = faceBaseElevation(source, derived, face.outer_boundary.half_edge_indices),
            .outer = outer,
            .holes = try holes.toOwnedSlice(scratch),
        });
    }
    std.mem.sort(PlateInput, plates.items, {}, plateLessThan);

    var result: std.ArrayList(FloorTriangle) = .empty;
    errdefer {
        for (result.items) |*triangle| triangle.deinit(allocator);
        result.deinit(allocator);
    }
    for (plates.items) |plate| {
        try emitPlate(allocator, scratch, &result, plate);
    }
    return result.toOwnedSlice(allocator);
}

fn plateLessThan(_: void, left: PlateInput, right: PlateInput) bool {
    if (left.floor != right.floor) return left.floor < right.floor;
    return std.mem.lessThan(u8, left.signature, right.signature);
}

/// The plate rests on the lowest ground its boundary walls stand on. Slab-supported
/// edges (stubbed) contribute nothing; an all-slab boundary falls back to 0.
fn faceBaseElevation(
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    half_edge_indices: []const usize,
) types.Unit {
    var base: ?types.Unit = null;
    for (half_edge_indices) |half_edge_index| {
        const edge_id = derived.half_edges[half_edge_index].source_edge_id;
        const edge = findEdge(source, edge_id) orelse continue;
        switch (edge.support) {
            .absolute => |support| {
                if (base == null or support.base_y_u < base.?) base = support.base_y_u;
            },
            .slab => {},
        }
    }
    return base orelse 0;
}

fn findEdge(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallEdge {
    for (source.walls.edges) |*edge| if (std.mem.eql(u8, edge.id, id)) return edge;
    return null;
}

/// Ring of cycle origin points with dangling spikes (… P, D, P …) and
/// consecutive duplicates removed. Removals never change the signed area.
fn cleanedRing(
    scratch: std.mem.Allocator,
    derived: *const topology.DerivedTopology,
    half_edge_indices: []const usize,
) std.mem.Allocator.Error![]Point {
    var ring: std.ArrayList(Point) = .empty;
    for (half_edge_indices) |half_edge_index| {
        const half_edge = derived.half_edges[half_edge_index];
        try ring.append(scratch, derived.vertices[half_edge.origin_vertex_index].point);
    }
    var changed = true;
    while (changed and ring.items.len >= 3) {
        changed = false;
        var index: usize = 0;
        while (index < ring.items.len and ring.items.len >= 3) {
            const count = ring.items.len;
            const previous = ring.items[(index + count - 1) % count];
            const current = ring.items[index];
            const next = ring.items[(index + 1) % count];
            if (pointsEqual(current, next)) {
                _ = ring.orderedRemove(index);
                changed = true;
                continue;
            }
            if (pointsEqual(previous, next)) {
                // Spike: out-and-back along a dangling wall. Drop the tip and
                // one of the duplicated junction points.
                _ = ring.orderedRemove(index);
                _ = ring.orderedRemove(index % ring.items.len);
                changed = true;
                continue;
            }
            index += 1;
        }
    }
    if (ring.items.len < 3) return scratch.alloc(Point, 0);
    return ring.toOwnedSlice(scratch);
}

fn pointsEqual(left: Point, right: Point) bool {
    return left.x_u == right.x_u and left.z_u == right.z_u;
}

fn emitPlate(
    allocator: std.mem.Allocator,
    scratch: std.mem.Allocator,
    result: *std.ArrayList(FloorTriangle),
    plate: PlateInput,
) BuildError!void {
    const merged = try mergeHoles(scratch, plate.outer, plate.holes);
    const triangles = try earClip(scratch, merged);
    const base_m = scale.unitsToMeters(plate.base_y_u);
    const top_m = scale.unitsToMeters(plate.base_y_u + plate_thickness_u);
    for (triangles) |triangle| {
        // Ear output is positively oriented in (x, z), whose 3D cross points
        // -y; the walkable top reverses the corner order for a +y normal.
        try appendTriangle(allocator, result, plate, .top, .{
            horizontalPoint(triangle[0], top_m),
            horizontalPoint(triangle[2], top_m),
            horizontalPoint(triangle[1], top_m),
        }, .{ .x = 0, .y = 1, .z = 0 }, .{
            horizontalUv(triangle[0]),
            horizontalUv(triangle[2]),
            horizontalUv(triangle[1]),
        });
        try appendTriangle(allocator, result, plate, .bottom, .{
            horizontalPoint(triangle[0], base_m),
            horizontalPoint(triangle[1], base_m),
            horizontalPoint(triangle[2], base_m),
        }, .{ .x = 0, .y = -1, .z = 0 }, .{
            horizontalUv(triangle[0]),
            horizontalUv(triangle[1]),
            horizontalUv(triangle[2]),
        });
    }
    try emitRim(allocator, result, plate, plate.outer, base_m, top_m);
    for (plate.holes) |hole| try emitRim(allocator, result, plate, hole, base_m, top_m);
}

/// Rim faces for one ring. The outward normal is the +90-degree-right rotation
/// of the segment direction, which faces away from the slab for the positively
/// wound outer ring and into the cavity for negatively wound hole rings.
fn emitRim(
    allocator: std.mem.Allocator,
    result: *std.ArrayList(FloorTriangle),
    plate: PlateInput,
    ring: []const Point,
    base_m: f32,
    top_m: f32,
) BuildError!void {
    for (ring, 0..) |start, index| {
        const end = ring[(index + 1) % ring.len];
        const delta_x = scale.unitsToMeters(end.x_u - start.x_u);
        const delta_z = scale.unitsToMeters(end.z_u - start.z_u);
        const length = std.math.hypot(delta_x, delta_z);
        if (length <= 0) continue;
        const normal = geometry.Vector3{ .x = delta_z / length, .y = 0, .z = -delta_x / length };
        const p_bottom = horizontalPoint(start, base_m);
        const q_bottom = horizontalPoint(end, base_m);
        const p_top = horizontalPoint(start, top_m);
        const q_top = horizontalPoint(end, top_m);
        const height = top_m - base_m;
        try appendTriangle(allocator, result, plate, .rim, .{ p_bottom, q_top, q_bottom }, normal, .{
            .{ .u = 0, .v = 0 },
            .{ .u = length, .v = height },
            .{ .u = length, .v = 0 },
        });
        try appendTriangle(allocator, result, plate, .rim, .{ p_bottom, p_top, q_top }, normal, .{
            .{ .u = 0, .v = 0 },
            .{ .u = 0, .v = height },
            .{ .u = length, .v = height },
        });
    }
}

fn appendTriangle(
    allocator: std.mem.Allocator,
    result: *std.ArrayList(FloorTriangle),
    plate: PlateInput,
    role: FloorRole,
    corners: [3]geometry.Point3Meters,
    normal: geometry.Vector3,
    uv: [3]geometry.Point2Meters,
) BuildError!void {
    const signature = try allocator.dupe(u8, plate.signature);
    errdefer allocator.free(signature);
    const material_id = try allocator.dupe(u8, generated_floor_material_id);
    errdefer allocator.free(material_id);
    try result.append(allocator, .{
        .face_signature = signature,
        .floor = plate.floor,
        .role = role,
        .material_id = material_id,
        .corners_m = corners,
        .normal = normal,
        .uv_m = uv,
    });
}

fn horizontalPoint(point: Point, y_m: f32) geometry.Point3Meters {
    return .{ .x = scale.unitsToMeters(point.x_u), .y = y_m, .z = scale.unitsToMeters(point.z_u) };
}

fn horizontalUv(point: Point) geometry.Point2Meters {
    return .{ .u = scale.unitsToMeters(point.x_u), .v = scale.unitsToMeters(point.z_u) };
}

// ---------------------------------------------------------------------------
// Polygon-with-holes triangulation (integer earcut).
// ---------------------------------------------------------------------------

/// Splice every hole ring into the outer ring with a bridge to a visible outer
/// vertex, producing one simple (weakly) polygon. Holes merge rightmost-first
/// so earlier bridges cannot block later ones.
fn mergeHoles(
    scratch: std.mem.Allocator,
    outer: []const Point,
    holes: []const []Point,
) std.mem.Allocator.Error![]Point {
    var polygon: std.ArrayList(Point) = .empty;
    try polygon.appendSlice(scratch, outer);
    if (holes.len == 0) return polygon.toOwnedSlice(scratch);

    const order = try scratch.alloc(usize, holes.len);
    for (order, 0..) |*value, index| value.* = index;
    std.mem.sort(usize, order, holes, holeRightmostDescending);

    for (order) |hole_index| {
        const hole = holes[hole_index];
        const mouth = rightmostVertexIndex(hole);
        const bridge = findBridgeVertex(polygon.items, hole[mouth]) orelse continue;
        // polygon[..=bridge] + hole[mouth..] + hole[..=mouth] + polygon[bridge..]
        var spliced: std.ArrayList(Point) = .empty;
        try spliced.appendSlice(scratch, polygon.items[0 .. bridge + 1]);
        try spliced.appendSlice(scratch, hole[mouth..]);
        try spliced.appendSlice(scratch, hole[0 .. mouth + 1]);
        try spliced.appendSlice(scratch, polygon.items[bridge..]);
        polygon.deinit(scratch);
        polygon = spliced;
    }
    return polygon.toOwnedSlice(scratch);
}

fn holeRightmostDescending(holes: []const []Point, left: usize, right: usize) bool {
    const left_point = holes[left][rightmostVertexIndex(holes[left])];
    const right_point = holes[right][rightmostVertexIndex(holes[right])];
    if (left_point.x_u != right_point.x_u) return left_point.x_u > right_point.x_u;
    if (left_point.z_u != right_point.z_u) return left_point.z_u > right_point.z_u;
    return left < right;
}

fn rightmostVertexIndex(ring: []const Point) usize {
    var best: usize = 0;
    for (ring, 0..) |point, index| {
        if (point.x_u > ring[best].x_u or
            (point.x_u == ring[best].x_u and point.z_u > ring[best].z_u))
        {
            best = index;
        }
    }
    return best;
}

/// Exact +x ray intersection: the smallest intersection x at z = mouth.z_u,
/// held as the rational numerator/denominator pair (denominator > 0).
const RayHit = struct {
    numerator_x: Wide,
    denominator: Wide,
    edge_start: usize,

    fn lessThan(self: RayHit, other: RayHit) bool {
        return self.numerator_x * other.denominator < other.numerator_x * self.denominator;
    }
};

/// Earcut-style visible-vertex search: cast +x from the hole mouth, take the
/// hit edge's farther endpoint as the candidate, then prefer any reflex
/// polygon vertex inside the (mouth, hit, candidate) triangle that minimizes
/// the angle to the +x axis. Returns the polygon index to bridge to.
fn findBridgeVertex(polygon: []const Point, mouth: Point) ?usize {
    var best_hit: ?RayHit = null;
    for (polygon, 0..) |start, index| {
        const end = polygon[(index + 1) % polygon.len];
        if (start.z_u == end.z_u) continue;
        const spans = (start.z_u <= mouth.z_u and end.z_u >= mouth.z_u) or
            (start.z_u >= mouth.z_u and end.z_u <= mouth.z_u);
        if (!spans) continue;
        // x = start.x + (end.x - start.x) * (mouth.z - start.z) / (end.z - start.z)
        var denominator: Wide = @as(Wide, end.z_u) - @as(Wide, start.z_u);
        var numerator: Wide = @as(Wide, start.x_u) * denominator +
            (@as(Wide, end.x_u) - @as(Wide, start.x_u)) * (@as(Wide, mouth.z_u) - @as(Wide, start.z_u));
        if (denominator < 0) {
            denominator = -denominator;
            numerator = -numerator;
        }
        if (numerator < @as(Wide, mouth.x_u) * denominator) continue;
        const hit = RayHit{ .numerator_x = numerator, .denominator = denominator, .edge_start = index };
        if (best_hit == null or hit.lessThan(best_hit.?)) best_hit = hit;
    }
    const hit = best_hit orelse return null;

    const start_index = hit.edge_start;
    const end_index = (hit.edge_start + 1) % polygon.len;
    const initial = if (polygon[start_index].x_u >= polygon[end_index].x_u) start_index else end_index;

    // A polygon vertex exactly on the ray at the hit x is directly visible.
    for (polygon, 0..) |point, index| {
        if (point.z_u == mouth.z_u and
            @as(Wide, point.x_u) * hit.denominator == hit.numerator_x and
            point.x_u >= mouth.x_u)
        {
            return index;
        }
    }

    // Reflex vertices inside the fixed triangle (mouth, hit point, initial
    // candidate) occlude it; the one with the smallest +x angle (ties:
    // nearest) becomes the bridge target instead.
    var best = initial;
    for (polygon, 0..) |point, index| {
        if (index == initial) continue;
        if (point.x_u < mouth.x_u) continue;
        if (pointsEqual(point, mouth)) continue;
        if (!isReflexVertex(polygon, index)) continue;
        if (!insideMouthTriangle(mouth, hit, polygon[initial], point)) continue;
        if (angleLessThan(mouth, point, polygon[best])) best = index;
    }
    return best;
}

fn isReflexVertex(polygon: []const Point, index: usize) bool {
    const previous = polygon[(index + polygon.len - 1) % polygon.len];
    const next = polygon[(index + 1) % polygon.len];
    return topology.orientation(previous, polygon[index], next) < 0;
}

/// Strict containment of `point` in the triangle (mouth, rational hit, candidate),
/// evaluated with the hit's denominator multiplied through.
fn insideMouthTriangle(mouth: Point, hit: RayHit, candidate: Point, point: Point) bool {
    // Triangle corners scaled by hit.denominator: M', H', C'.
    const d = hit.denominator;
    const mx = @as(Wide, mouth.x_u) * d;
    const mz = @as(Wide, mouth.z_u) * d;
    const hx = hit.numerator_x;
    const hz = @as(Wide, mouth.z_u) * d;
    const cx = @as(Wide, candidate.x_u) * d;
    const cz = @as(Wide, candidate.z_u) * d;
    const px = @as(Wide, point.x_u) * d;
    const pz = @as(Wide, point.z_u) * d;
    const first = wideOrientation(mx, mz, hx, hz, px, pz);
    const second = wideOrientation(hx, hz, cx, cz, px, pz);
    const third = wideOrientation(cx, cz, mx, mz, px, pz);
    const all_positive = first > 0 and second > 0 and third > 0;
    const all_negative = first < 0 and second < 0 and third < 0;
    return all_positive or all_negative;
}

fn wideOrientation(ax: Wide, az: Wide, bx: Wide, bz: Wide, cx: Wide, cz: Wide) Wide {
    return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/// |angle to +x| comparison from `mouth`: left < right by cross-multiplied
/// |dz| / dx tangents; ties choose the nearer vertex.
fn angleLessThan(mouth: Point, left: Point, right: Point) bool {
    const left_dx = @as(Wide, left.x_u) - @as(Wide, mouth.x_u);
    const left_dz = if (left.z_u >= mouth.z_u)
        @as(Wide, left.z_u) - @as(Wide, mouth.z_u)
    else
        @as(Wide, mouth.z_u) - @as(Wide, left.z_u);
    const right_dx = @as(Wide, right.x_u) - @as(Wide, mouth.x_u);
    const right_dz = if (right.z_u >= mouth.z_u)
        @as(Wide, right.z_u) - @as(Wide, mouth.z_u)
    else
        @as(Wide, mouth.z_u) - @as(Wide, right.z_u);
    if (left_dx <= 0 and right_dx <= 0) return distanceLessThan(mouth, left, right);
    if (left_dx <= 0) return false;
    if (right_dx <= 0) return true;
    const left_tangent = left_dz * right_dx;
    const right_tangent = right_dz * left_dx;
    if (left_tangent != right_tangent) return left_tangent < right_tangent;
    return distanceLessThan(mouth, left, right);
}

fn distanceLessThan(mouth: Point, left: Point, right: Point) bool {
    const left_dx = @as(Wide, left.x_u) - @as(Wide, mouth.x_u);
    const left_dz = @as(Wide, left.z_u) - @as(Wide, mouth.z_u);
    const right_dx = @as(Wide, right.x_u) - @as(Wide, mouth.x_u);
    const right_dz = @as(Wide, right.z_u) - @as(Wide, mouth.z_u);
    return left_dx * left_dx + left_dz * left_dz < right_dx * right_dx + right_dz * right_dz;
}

/// Deterministic O(n^2)-per-ear clipping of one positively wound (weakly)
/// simple polygon. Zero-area ears clip silently; a full earless scan clips the
/// first convex vertex outright so the walk always terminates — a rare sliver
/// beats an unfillable room.
fn earClip(
    scratch: std.mem.Allocator,
    polygon: []const Point,
) std.mem.Allocator.Error![][3]Point {
    var remaining: std.ArrayList(Point) = .empty;
    try remaining.appendSlice(scratch, polygon);
    var triangles: std.ArrayList([3]Point) = .empty;

    while (remaining.items.len > 3) {
        const count = remaining.items.len;
        var clipped = false;
        var index: usize = 0;
        while (index < count) : (index += 1) {
            const previous = remaining.items[(index + count - 1) % count];
            const current = remaining.items[index];
            const next = remaining.items[(index + 1) % count];
            const turn = topology.orientation(previous, current, next);
            if (turn < 0) continue;
            if (turn == 0) {
                // Collinear: a zero-area ear; drop the middle vertex.
                _ = remaining.orderedRemove(index);
                clipped = true;
                break;
            }
            if (earBlocked(remaining.items, index, previous, current, next)) continue;
            try triangles.append(scratch, .{ previous, current, next });
            _ = remaining.orderedRemove(index);
            clipped = true;
            break;
        }
        if (clipped) continue;
        // Failsafe: no strict ear (degenerate/self-touching input). Clip the
        // first convex vertex regardless of containment, else drop a vertex.
        var fallback: ?usize = null;
        for (remaining.items, 0..) |_, candidate| {
            const previous = remaining.items[(candidate + count - 1) % count];
            const current = remaining.items[candidate];
            const next = remaining.items[(candidate + 1) % count];
            if (topology.orientation(previous, current, next) > 0) {
                fallback = candidate;
                break;
            }
        }
        if (fallback) |candidate| {
            const previous = remaining.items[(candidate + count - 1) % count];
            const current = remaining.items[candidate];
            const next = remaining.items[(candidate + 1) % count];
            try triangles.append(scratch, .{ previous, current, next });
            _ = remaining.orderedRemove(candidate);
        } else {
            _ = remaining.orderedRemove(0);
        }
    }
    if (remaining.items.len == 3) {
        const turn = topology.orientation(remaining.items[0], remaining.items[1], remaining.items[2]);
        if (turn > 0) {
            try triangles.append(scratch, .{ remaining.items[0], remaining.items[1], remaining.items[2] });
        }
    }
    return triangles.toOwnedSlice(scratch);
}

/// Any polygon vertex strictly inside the candidate ear blocks it. Bridge
/// duplicates land exactly on ear corners, where strict containment is false.
fn earBlocked(ring: []const Point, ear_index: usize, previous: Point, current: Point, next: Point) bool {
    for (ring, 0..) |point, index| {
        if (index == ear_index) continue;
        if (pointsEqual(point, previous) or pointsEqual(point, current) or pointsEqual(point, next)) continue;
        const first = topology.orientation(previous, current, point);
        const second = topology.orientation(current, next, point);
        const third = topology.orientation(next, previous, point);
        if (first > 0 and second > 0 and third > 0) return true;
    }
    return false;
}

fn freeBytes(allocator: std.mem.Allocator, bytes: []u8) void {
    if (bytes.len != 0) allocator.free(bytes);
}
