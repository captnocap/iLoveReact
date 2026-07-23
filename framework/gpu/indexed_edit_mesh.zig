//! Indexed edit-mode mesh topology.
//!
//! Rendering still consumes non-indexed triangles. Editing does not: vertices have
//! stable numeric identities and faces own ordered vertex-id loops plus per-corner
//! UVs. Position tolerance is used exactly once, while importing a triangle soup;
//! every operation after that resolves adjacency by ids.

const std = @import("std");

pub const NO_GROUP: u32 = std.math.maxInt(u32);
pub const NO_PART: u32 = std.math.maxInt(u32);
pub const NO_MATERIAL: u32 = std.math.maxInt(u32);
const IMPORT_WELD_SCALE: f32 = 1024.0;
const IMPORT_WELD_EPS: f32 = 1.0 / IMPORT_WELD_SCALE;
const MIRROR_MATCH_SCALE: f32 = 1000.0;
// Merge Faces is a planar dissolve, not a general polygon stitch. A permissive
// normal gate can turn a bent perimeter into a fan whose diagonals cut through the
// model even when its output triangle count happens to match the input.
const MERGE_FACE_NORMAL_DOT_MIN: f32 = 0.9999;
const MERGE_FACE_PLANE_ABS_EPS: f32 = IMPORT_WELD_EPS * 2.0;
const MERGE_FACE_PLANE_REL_EPS: f32 = 0.00001;

pub const Vec2 = [2]f32;
pub const Vec3 = [3]f32;

const MirrorPositionKey = struct { part: u32, x: i32, y: i32, z: i32 };
const MirrorQuadKey = struct { part: u32, a: u32, b: u32, c: u32, d: u32 };
const MirrorPartBounds = struct { min: Vec3, max: Vec3 };

pub const CutOrigin = struct {
    edge: [2]u32,
    cut_no: u32,
};

pub const Vertex = struct {
    position: Vec3,
    alive: bool = true,
    cut_origin: ?CutOrigin = null,
};

pub const Face = struct {
    id: u32,
    vertices: std.ArrayListUnmanaged(u32) = .empty,
    uvs: std.ArrayListUnmanaged(Vec2) = .empty,
    source_triangles: std.ArrayListUnmanaged(u32) = .empty,
    /// The physical render diagonal of a quad, as stable vertex ids. Four
    /// non-planar positions do not define one surface without this edge; it is
    /// authored topology and mirrored twins copy it explicitly.
    diagonal: ?[2]u32 = null,
    group: u32,
    part: u32,
    /// Stable texture-role index authored in the Rig panel. Rendering remains
    /// triangle soup, but splits/cuts inherit this identity from their source face.
    material: u32 = NO_MATERIAL,
    alive: bool = true,

    fn deinit(face: *Face, allocator: std.mem.Allocator) void {
        face.vertices.deinit(allocator);
        face.uvs.deinit(allocator);
        face.source_triangles.deinit(allocator);
        face.* = undefined;
    }

    fn clone(face: *const Face, allocator: std.mem.Allocator) !Face {
        var out = Face{
            .id = face.id,
            .group = face.group,
            .part = face.part,
            .material = face.material,
            .alive = face.alive,
            .diagonal = face.diagonal,
        };
        errdefer out.deinit(allocator);
        try out.vertices.appendSlice(allocator, face.vertices.items);
        try out.uvs.appendSlice(allocator, face.uvs.items);
        try out.source_triangles.appendSlice(allocator, face.source_triangles.items);
        return out;
    }
};

pub const SeedInfo = struct {
    face_id: u32,
    part: u32,
    center: Vec3,
    directions: [2]Vec3,
    sizes: [2]f32,
    lo: [2]f32,
    hi: [2]f32,
    keep_group: u32,
};

pub const Lowered = struct {
    allocator: std.mem.Allocator,
    positions: []f32,
    /// Normalized per-render-corner UVs (six floats per triangle). These are
    /// edit topology, not disposable render metadata: loop cut interpolates them
    /// so the derived soup can keep the current painted atlas exactly.
    uvs: []f32,
    triangle_vertices: [][3]u32,
    groups: []u32,
    source_triangles: []u32,
    face_ids: []u32,
    parts: []u32,
    materials: []u32,
    tri_count: u32,

    pub fn deinit(lowered: *Lowered) void {
        lowered.allocator.free(lowered.positions);
        lowered.allocator.free(lowered.uvs);
        lowered.allocator.free(lowered.triangle_vertices);
        lowered.allocator.free(lowered.groups);
        lowered.allocator.free(lowered.source_triangles);
        lowered.allocator.free(lowered.face_ids);
        lowered.allocator.free(lowered.parts);
        lowered.allocator.free(lowered.materials);
        lowered.* = undefined;
    }
};

pub const Mesh = struct {
    allocator: std.mem.Allocator,
    vertices: std.ArrayListUnmanaged(Vertex) = .empty,
    faces: std.ArrayListUnmanaged(Face) = .empty,
    /// Stable vertex ids for each triangle/corner in the CURRENT resident soup order.
    /// Imports preserve the source diagonal/order; lowering replaces this map with the
    /// deterministic derived order. Position-only gizmo mutations must use this map,
    /// never guess that an old model was already lowered by today's diagonal policy.
    render_triangles: std.ArrayListUnmanaged([3]u32) = .empty,
    next_group: u32 = 0,

    pub fn deinit(mesh: *Mesh) void {
        for (mesh.faces.items) |*face| face.deinit(mesh.allocator);
        mesh.faces.deinit(mesh.allocator);
        mesh.vertices.deinit(mesh.allocator);
        mesh.render_triangles.deinit(mesh.allocator);
        mesh.* = undefined;
    }

    pub fn clone(mesh: *const Mesh) !Mesh {
        var out = Mesh{ .allocator = mesh.allocator, .next_group = mesh.next_group };
        errdefer out.deinit();
        try out.vertices.appendSlice(mesh.allocator, mesh.vertices.items);
        try out.render_triangles.appendSlice(mesh.allocator, mesh.render_triangles.items);
        for (mesh.faces.items) |*face| try out.faces.append(mesh.allocator, try face.clone(mesh.allocator));
        return out;
    }

    /// True only when this cached indexed topology describes the CURRENT resident
    /// triangle metadata. Group-only operations can leave positions unchanged while
    /// replacing authored group ids or part ownership; reusing that cache would lower
    /// the old ownership table back over the new document.
    pub fn residentMetadataMatches(
        mesh: *const Mesh,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
        materials: ?[]const u32,
    ) bool {
        if (mesh.render_triangles.items.len != tri_count) return false;
        if (groups) |rows| if (rows.len < tri_count) return false;
        if (parts) |rows| if (rows.len < tri_count) return false;
        if (materials) |rows| if (rows.len < tri_count) return false;

        const seen = mesh.allocator.alloc(bool, tri_count) catch return false;
        defer mesh.allocator.free(seen);
        @memset(seen, false);
        var seen_count: u32 = 0;
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.source_triangles.items) |triangle| {
                if (triangle >= tri_count or seen[triangle]) return false;
                const expected_group = if (groups) |rows| rows[triangle] else NO_GROUP;
                const expected_part = if (parts) |rows| rows[triangle] else NO_PART;
                const expected_material = if (materials) |rows| rows[triangle] else NO_MATERIAL;
                if (face.group != expected_group or
                    face.part != expected_part or
                    face.material != expected_material)
                {
                    return false;
                }
                seen[triangle] = true;
                seen_count += 1;
            }
        }
        return seen_count == tri_count;
    }

    const WeldKey = struct {
        x: i32,
        y: i32,
        z: i32,
        part: u32,
    };

    const BucketKey = struct {
        group: u32,
        singleton: u32,
    };

    const Bucket = struct {
        group: u32,
        part: u32,
        material: u32,
        triangles: std.ArrayListUnmanaged(u32) = .empty,
    };

    const WeldCandidate = struct {
        vertex_id: u32,
        next: ?u32,
    };

    /// Import is the only position-matching boundary. `interleaved` is the resident
    /// position3/normal3/uv2 render soup; groups and parts are one row per triangle.
    pub fn fromSoup(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
    ) !Mesh {
        return fromSoupWithMaterials(allocator, interleaved, tri_count, groups, parts, null);
    }

    pub fn fromSoupWithMaterials(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
        materials: ?[]const u32,
    ) !Mesh {
        if (interleaved.len < @as(usize, tri_count) * 24) return error.InvalidSoup;
        if (groups) |rows| if (rows.len < tri_count) return error.InvalidGroups;
        if (parts) |rows| if (rows.len < tri_count) return error.InvalidParts;
        if (materials) |rows| if (rows.len < tri_count) return error.InvalidMaterials;

        var mesh = Mesh{ .allocator = allocator };
        errdefer mesh.deinit();
        var weld = std.AutoHashMapUnmanaged(WeldKey, u32).empty;
        defer weld.deinit(allocator);
        var weld_candidates = std.ArrayListUnmanaged(WeldCandidate).empty;
        defer weld_candidates.deinit(allocator);
        const corner_vertex = try allocator.alloc(u32, @as(usize, tri_count) * 3);
        defer allocator.free(corner_vertex);

        var triangle: u32 = 0;
        while (triangle < tri_count) : (triangle += 1) {
            const part = if (parts) |rows| rows[triangle] else NO_PART;
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                const base = (@as(usize, triangle) * 3 + corner) * 8;
                const p = Vec3{ interleaved[base], interleaved[base + 1], interleaved[base + 2] };
                const cell = WeldKey{
                    .x = @intFromFloat(@floor(p[0] * IMPORT_WELD_SCALE)),
                    .y = @intFromFloat(@floor(p[1] * IMPORT_WELD_SCALE)),
                    .z = @intFromFloat(@floor(p[2] * IMPORT_WELD_SCALE)),
                    .part = part,
                };
                var vertex_id: ?u32 = null;
                var dx: i32 = -1;
                neighbor: while (dx <= 1) : (dx += 1) {
                    var dy: i32 = -1;
                    while (dy <= 1) : (dy += 1) {
                        var dz: i32 = -1;
                        while (dz <= 1) : (dz += 1) {
                            var candidate_index: ?u32 = weld.get(.{
                                .x = cell.x + dx,
                                .y = cell.y + dy,
                                .z = cell.z + dz,
                                .part = part,
                            });
                            while (candidate_index) |index| {
                                const candidate = weld_candidates.items[index];
                                const q = mesh.vertices.items[candidate.vertex_id].position;
                                if (distanceSquared(p, q) <= IMPORT_WELD_EPS * IMPORT_WELD_EPS) {
                                    vertex_id = candidate.vertex_id;
                                    break :neighbor;
                                }
                                candidate_index = candidate.next;
                            }
                        }
                    }
                }
                if (vertex_id == null) {
                    vertex_id = @intCast(mesh.vertices.items.len);
                    try mesh.vertices.append(allocator, .{ .position = p });
                    const previous = weld.get(cell);
                    const candidate_index: u32 = @intCast(weld_candidates.items.len);
                    try weld_candidates.append(allocator, .{ .vertex_id = vertex_id.?, .next = previous });
                    try weld.put(allocator, cell, candidate_index);
                }
                corner_vertex[triangle * 3 + corner] = vertex_id.?;
            }
            try mesh.render_triangles.append(allocator, .{
                corner_vertex[triangle * 3],
                corner_vertex[triangle * 3 + 1],
                corner_vertex[triangle * 3 + 2],
            });
        }

        var buckets = std.ArrayListUnmanaged(Bucket).empty;
        defer {
            for (buckets.items) |*bucket| bucket.triangles.deinit(allocator);
            buckets.deinit(allocator);
        }
        var bucket_map = std.AutoHashMapUnmanaged(BucketKey, u32).empty;
        defer bucket_map.deinit(allocator);
        triangle = 0;
        while (triangle < tri_count) : (triangle += 1) {
            const group = if (groups) |rows| rows[triangle] else NO_GROUP;
            const key = BucketKey{
                .group = group,
                .singleton = if (group == NO_GROUP) triangle else std.math.maxInt(u32),
            };
            const entry = try bucket_map.getOrPut(allocator, key);
            if (!entry.found_existing) {
                entry.value_ptr.* = @intCast(buckets.items.len);
                try buckets.append(allocator, .{
                    .group = group,
                    .part = if (parts) |rows| rows[triangle] else NO_PART,
                    .material = if (materials) |rows| rows[triangle] else NO_MATERIAL,
                });
            } else if (materials != null and buckets.items[entry.value_ptr.*].material != materials.?[triangle]) {
                // One authored face cannot wear two texture roles. Reject corrupt
                // persistence at the import boundary instead of choosing a triangle.
                return error.InconsistentFaceMaterial;
            }
            try buckets.items[entry.value_ptr.*].triangles.append(allocator, triangle);
            if (group != NO_GROUP and group >= mesh.next_group) mesh.next_group = group + 1;
        }

        for (buckets.items) |*bucket| {
            var face = try buildFaceFromBucket(allocator, interleaved, corner_vertex, bucket);
            face.id = @intCast(mesh.faces.items.len);
            try mesh.faces.append(allocator, face);
        }
        return mesh;
    }

    const BoundaryEdge = struct {
        from: u32,
        to: u32,
        uv: Vec2,
        key: u64,
    };

    fn edgeKey(a: u32, b: u32) u64 {
        return (@as(u64, @min(a, b)) << 32) | @as(u64, @max(a, b));
    }

    fn triangleIsCollapsed(corner_vertex: []const u32, triangle: u32) bool {
        const a = corner_vertex[triangle * 3];
        const b = corner_vertex[triangle * 3 + 1];
        const c = corner_vertex[triangle * 3 + 2];
        return a == b or b == c or c == a;
    }

    fn buildFaceFromBucket(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        corner_vertex: []const u32,
        bucket: *const Bucket,
    ) !Face {
        var face = Face{ .id = 0, .group = bucket.group, .part = bucket.part, .material = bucket.material };
        errdefer face.deinit(allocator);
        try face.source_triangles.appendSlice(allocator, bucket.triangles.items);

        if (bucket.triangles.items.len == 1) {
            const triangle = bucket.triangles.items[0];
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                try face.vertices.append(allocator, corner_vertex[triangle * 3 + corner]);
                const base = (@as(usize, triangle) * 3 + corner) * 8;
                try face.uvs.append(allocator, .{ interleaved[base + 6], interleaved[base + 7] });
            }
            return face;
        }

        // Provenance drives colour inheritance after lowering.  When the first
        // render member is the collapsed half of a quad, prefer the first real
        // member while retaining every source id for whole-authored-face selection.
        for (face.source_triangles.items, 0..) |triangle, index| {
            if (triangleIsCollapsed(corner_vertex, triangle)) continue;
            if (index != 0) std.mem.swap(u32, &face.source_triangles.items[0], &face.source_triangles.items[index]);
            break;
        }

        var uses = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer uses.deinit(allocator);
        var directed = std.ArrayListUnmanaged(BoundaryEdge).empty;
        defer directed.deinit(allocator);
        // A collapsed authored quad is still a valid face: lowering it produces
        // one real triangle plus one zero-area triangle with a repeated stable
        // vertex. That zero-area member contributes no boundary. Counting its
        // two opposite copies of the surviving diagonal made the diagonal look
        // three-used, leaving only two boundary edges and rejecting the ENTIRE
        // composite mesh at import (req_3365).
        for (bucket.triangles.items) |triangle| {
            if (triangleIsCollapsed(corner_vertex, triangle)) continue;
            const triangle_vertices = [3]u32{
                corner_vertex[triangle * 3],
                corner_vertex[triangle * 3 + 1],
                corner_vertex[triangle * 3 + 2],
            };
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                const from = triangle_vertices[corner];
                const to = triangle_vertices[(corner + 1) % 3];
                const key = edgeKey(from, to);
                const entry = try uses.getOrPut(allocator, key);
                if (!entry.found_existing) entry.value_ptr.* = 0;
                entry.value_ptr.* += 1;
                const base = (@as(usize, triangle) * 3 + corner) * 8;
                try directed.append(allocator, .{
                    .from = from,
                    .to = to,
                    .uv = .{ interleaved[base + 6], interleaved[base + 7] },
                    .key = key,
                });
            }
        }

        var next = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer next.deinit(allocator);
        var boundary_count: u32 = 0;
        var start: ?u32 = null;
        for (directed.items, 0..) |edge, index| {
            if ((uses.get(edge.key) orelse 0) != 1) continue;
            const entry = try next.getOrPut(allocator, edge.from);
            if (entry.found_existing) return error.MalformedFaceBoundary;
            entry.value_ptr.* = @intCast(index);
            if (start == null) start = edge.from;
            boundary_count += 1;
        }
        if (boundary_count < 3) return error.MalformedFaceBoundary;

        var current = start.?;
        const first = current;
        var visited: u32 = 0;
        while (visited < boundary_count) : (visited += 1) {
            const index = next.get(current) orelse return error.MalformedFaceBoundary;
            const edge = directed.items[index];
            try face.vertices.append(allocator, edge.from);
            try face.uvs.append(allocator, edge.uv);
            current = edge.to;
            if (current == first) break;
        }
        if (current != first or face.vertices.items.len != boundary_count) return error.MalformedFaceBoundary;
        // Recover the exact diagonal that triangulated an imported authored quad.
        // Once inside the indexed model this edge is topology, never re-guessed from
        // positions after a non-planar edit.
        if (face.vertices.items.len == 4) {
            var use_it = uses.iterator();
            while (use_it.next()) |entry| {
                if (entry.value_ptr.* < 2) continue;
                const key = entry.key_ptr.*;
                const candidate = [2]u32{ @intCast(key >> 32), @intCast(key & 0xffffffff) };
                if (quadDiagonalKind(&face, candidate) != null) {
                    face.diagonal = candidate;
                    break;
                }
            }
        }
        return face;
    }

    fn faceFullySelected(face: *const Face, selected_triangles: []const bool) bool {
        if (!face.alive or face.source_triangles.items.len == 0) return false;
        for (face.source_triangles.items) |triangle| {
            if (triangle >= selected_triangles.len or !selected_triangles[triangle]) return false;
        }
        return true;
    }

    fn firstSelectedFace(mesh: *const Mesh, selected_triangles: []const bool) ?u32 {
        for (mesh.faces.items) |*face| {
            if (faceFullySelected(face, selected_triangles)) return face.id;
        }
        return null;
    }

    /// Assign one texture-role index to every fully selected authored face.
    /// Face selection already expands across a triangulated n-gon, so a partial
    /// render triangle can never acquire a different role from its siblings.
    pub fn assignSelectedMaterial(mesh: *Mesh, selected_triangles: []const bool, material: u32) u32 {
        var changed: u32 = 0;
        for (mesh.faces.items) |*face| {
            if (!faceFullySelected(face, selected_triangles) or face.material == material) continue;
            face.material = material;
            changed += 1;
        }
        return changed;
    }

    pub fn seedInfo(mesh: *const Mesh, selected_triangles: []const bool) ?SeedInfo {
        const face_id = mesh.firstSelectedFace(selected_triangles) orelse return null;
        const face = &mesh.faces.items[face_id];
        if (face.vertices.items.len < 3) return null;
        var center = Vec3{ 0, 0, 0 };
        for (face.vertices.items) |vertex_id| center = add3(center, mesh.vertices.items[vertex_id].position);
        center = mul3(center, 1.0 / @as(f32, @floatFromInt(face.vertices.items.len)));

        var directions: [2]Vec3 = undefined;
        var sizes: [2]f32 = undefined;
        var lo: [2]f32 = undefined;
        var hi: [2]f32 = undefined;
        var axis: usize = 0;
        while (axis < 2) : (axis += 1) {
            const a = mesh.vertices.items[face.vertices.items[axis % face.vertices.items.len]].position;
            const b = mesh.vertices.items[face.vertices.items[(axis + 1) % face.vertices.items.len]].position;
            const edge = sub3(b, a);
            sizes[axis] = length3(edge);
            directions[axis] = norm3(edge);
            lo[axis] = dot3(a, directions[axis]);
            hi[axis] = dot3(b, directions[axis]);
            if (hi[axis] < lo[axis]) std.mem.swap(f32, &lo[axis], &hi[axis]);
        }
        return .{
            .face_id = face_id,
            .part = face.part,
            .center = center,
            .directions = directions,
            .sizes = sizes,
            .lo = lo,
            .hi = hi,
            .keep_group = face.group,
        };
    }

    const CutContext = struct {
        mesh: *Mesh,
        processed: std.AutoHashMapUnmanaged(u32, void) = .empty,
        center_vertices: std.AutoHashMapUnmanaged(u64, u32) = .empty,
        direction: u32,
        cuts: u32,
        offset_fraction: f32,
        propagate: bool,

        fn deinit(context: *CutContext) void {
            context.processed.deinit(context.mesh.allocator);
            context.center_vertices.deinit(context.mesh.allocator);
        }

        fn centerVertex(context: *CutContext, edge: [2]u32, ratio: f32, cut_no: u32) !u32 {
            const key = edgeKey(edge[0], edge[1]);
            if (context.center_vertices.get(key)) |existing| return existing;
            const a = context.mesh.vertices.items[edge[0]].position;
            const b = context.mesh.vertices.items[edge[1]].position;
            const id: u32 = @intCast(context.mesh.vertices.items.len);
            try context.mesh.vertices.append(context.mesh.allocator, .{
                .position = lerp3(a, b, ratio),
                .cut_origin = .{ .edge = edge, .cut_no = cut_no },
            });
            try context.center_vertices.put(context.mesh.allocator, key, id);
            return id;
        }
    };

    pub fn repositionCutVertices(mesh: *Mesh, cuts_raw: u32, offset_fraction_raw: f32) void {
        const cuts = @max(1, cuts_raw);
        const offset_fraction = std.math.clamp(offset_fraction_raw, 0.0, 1.0);
        var cut_no: u32 = 0;
        while (cut_no < cuts) : (cut_no += 1) {
            for (mesh.vertices.items) |*vertex| {
                const origin = vertex.cut_origin orelse continue;
                if (origin.cut_no != cut_no) continue;
                const a = mesh.vertices.items[origin.edge[0]].position;
                const b = mesh.vertices.items[origin.edge[1]].position;
                vertex.position = lerp3(a, b, cutRatio(cuts, offset_fraction, origin.cut_no));
            }
            // UVs are per FACE corner, so updating the shared vertex position is only
            // half the preview. Each split piece retains the source-triangle provenance
            // of its authored parent; resolve the two endpoint UVs inside that domain so
            // seams on an adjacent face never leak across, then interpolate identically.
            for (mesh.faces.items) |*face| {
                if (!face.alive) continue;
                for (face.vertices.items, 0..) |vertex_id, corner| {
                    const origin = mesh.vertices.items[vertex_id].cut_origin orelse continue;
                    if (origin.cut_no != cut_no) continue;
                    const a_uv = mesh.uvInSourceDomain(face, origin.edge[0]) orelse continue;
                    const b_uv = mesh.uvInSourceDomain(face, origin.edge[1]) orelse continue;
                    face.uvs.items[corner] = lerp2(a_uv, b_uv, cutRatio(cuts, offset_fraction, origin.cut_no));
                }
            }
        }
    }

    fn uvInSourceDomain(mesh: *const Mesh, domain: *const Face, vertex_id: u32) ?Vec2 {
        if (indexOf(domain.vertices.items, vertex_id)) |corner| return domain.uvs.items[corner];
        for (mesh.faces.items) |*candidate| {
            if (!candidate.alive or !sourceDomainsOverlap(domain, candidate)) continue;
            if (indexOf(candidate.vertices.items, vertex_id)) |corner| return candidate.uvs.items[corner];
        }
        return null;
    }

    fn sourceDomainsOverlap(a: *const Face, b: *const Face) bool {
        for (a.source_triangles.items) |source_a| {
            for (b.source_triangles.items) |source_b| {
                if (source_a == source_b) return true;
            }
        }
        return false;
    }

    pub fn clearCutOrigins(mesh: *Mesh) void {
        for (mesh.vertices.items) |*vertex| vertex.cut_origin = null;
    }

    /// Split every straddling indexed face at a plane. Intersections are keyed by
    /// stable edge ids, so adjacent faces receive the same vertex without any
    /// position matching. The negative piece retains the source group; the positive
    /// piece receives a fresh authored group, matching the host's established rule.
    fn cutByPlaneForPart(mesh: *Mesh, normal: Vec3, distance: f32, target_part: ?u32) !bool {
        const original_face_count = mesh.faces.items.len;
        var edge_vertices = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer edge_vertices.deinit(mesh.allocator);
        var changed = false;
        var face_id: usize = 0;
        while (face_id < original_face_count) : (face_id += 1) {
            const face = &mesh.faces.items[face_id];
            if (!face.alive or face.vertices.items.len < 3) continue;
            if (target_part) |part| if (face.part != part) continue;
            var has_negative = false;
            var has_positive = false;
            for (face.vertices.items) |vertex_id| {
                const side = dot3(mesh.vertices.items[vertex_id].position, normal) - distance;
                has_negative = has_negative or side < -1e-6;
                has_positive = has_positive or side > 1e-6;
            }
            if (!has_negative or !has_positive) continue;

            var negative_vertices = std.ArrayListUnmanaged(u32).empty;
            defer negative_vertices.deinit(mesh.allocator);
            var positive_vertices = std.ArrayListUnmanaged(u32).empty;
            defer positive_vertices.deinit(mesh.allocator);
            var negative_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer negative_uvs.deinit(mesh.allocator);
            var positive_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer positive_uvs.deinit(mesh.allocator);
            var corner: usize = 0;
            while (corner < face.vertices.items.len) : (corner += 1) {
                const next = (corner + 1) % face.vertices.items.len;
                const a_id = face.vertices.items[corner];
                const b_id = face.vertices.items[next];
                const a = mesh.vertices.items[a_id].position;
                const b = mesh.vertices.items[b_id].position;
                const a_side = dot3(a, normal) - distance;
                const b_side = dot3(b, normal) - distance;
                const a_uv = face.uvs.items[corner];
                if (a_side <= 1e-6) {
                    try negative_vertices.append(mesh.allocator, a_id);
                    try negative_uvs.append(mesh.allocator, a_uv);
                }
                if (a_side >= -1e-6) {
                    try positive_vertices.append(mesh.allocator, a_id);
                    try positive_uvs.append(mesh.allocator, a_uv);
                }
                if (!((a_side < -1e-6 and b_side > 1e-6) or (a_side > 1e-6 and b_side < -1e-6))) continue;
                const ratio = (distance - dot3(a, normal)) / dot3(sub3(b, a), normal);
                const key = edgeKey(a_id, b_id);
                const entry = try edge_vertices.getOrPut(mesh.allocator, key);
                if (!entry.found_existing) {
                    entry.value_ptr.* = @intCast(mesh.vertices.items.len);
                    try mesh.vertices.append(mesh.allocator, .{ .position = lerp3(a, b, ratio) });
                }
                const cut_id = entry.value_ptr.*;
                const cut_uv = lerp2(a_uv, face.uvs.items[next], ratio);
                try negative_vertices.append(mesh.allocator, cut_id);
                try negative_uvs.append(mesh.allocator, cut_uv);
                try positive_vertices.append(mesh.allocator, cut_id);
                try positive_uvs.append(mesh.allocator, cut_uv);
            }
            if (negative_vertices.items.len < 3 or positive_vertices.items.len < 3) continue;
            const positive_face = try mesh.makeSplitFace(face, positive_vertices.items, positive_uvs.items);
            try mesh.replaceFaceLoop(@intCast(face_id), negative_vertices.items, negative_uvs.items);
            try mesh.faces.append(mesh.allocator, positive_face);
            changed = true;
        }
        return changed;
    }

    pub fn cutByPlane(mesh: *Mesh, normal: Vec3, distance: f32) !bool {
        return mesh.cutByPlaneForPart(normal, distance, null);
    }

    /// Symmetrize one identity domain. A null part is the legacy single-mesh
    /// contract; a concrete part leaves every other outliner part untouched.
    fn symmetrizeForPart(mesh: *Mesh, axis: u8, center: f32, keep_positive: bool, target_part: ?u32) !bool {
        if (axis > 2) return false;
        var normal = Vec3{ 0, 0, 0 };
        normal[axis] = 1;
        var changed = try mesh.cutByPlaneForPart(normal, center, target_part);
        const keep_sign: f32 = if (keep_positive) 1 else -1;
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 3) continue;
            if (target_part) |part| if (face.part != part) continue;
            var centroid: f32 = 0;
            for (face.vertices.items) |vertex_id| centroid += mesh.vertices.items[vertex_id].position[axis];
            centroid = centroid / @as(f32, @floatFromInt(face.vertices.items.len)) - center;
            if (centroid * keep_sign < -1e-5) {
                face.alive = false;
                changed = true;
            }
        }

        var reflected_vertices = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer reflected_vertices.deinit(mesh.allocator);
        var twin_groups = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer twin_groups.deinit(mesh.allocator);
        const kept_face_count = mesh.faces.items.len;
        var face_id: usize = 0;
        while (face_id < kept_face_count) : (face_id += 1) {
            const face = &mesh.faces.items[face_id];
            if (!face.alive) continue;
            if (target_part) |part| if (face.part != part) continue;
            var on_seam = true;
            for (face.vertices.items) |vertex_id| {
                if (@abs(mesh.vertices.items[vertex_id].position[axis] - center) > 1e-5) on_seam = false;
            }
            if (on_seam) continue;
            // Clone before appending reflected vertices: an append may reallocate the
            // mesh vertex table, but the face clone and its pinned diagonal stay valid.
            var twin = try face.clone(mesh.allocator);
            errdefer twin.deinit(mesh.allocator);
            const source_diagonal = if (face.vertices.items.len == 4)
                (face.diagonal orelse chosenQuadDiagonal(mesh, face))
            else
                null;
            var twin_vertices = std.ArrayListUnmanaged(u32).empty;
            defer twin_vertices.deinit(mesh.allocator);
            // Reverse winding while keeping corner zero as the anchor. In the exact
            // equal-diagonal case this maps 0-2 to the twin's corresponding 0-2,
            // instead of silently rotating the loop and swapping physical diagonals.
            var output_corner: usize = 0;
            while (output_corner < face.vertices.items.len) : (output_corner += 1) {
                const source_corner = if (output_corner == 0) 0 else face.vertices.items.len - output_corner;
                const source_id = face.vertices.items[source_corner];
                const source_position = mesh.vertices.items[source_id].position;
                var twin_id = source_id;
                if (@abs(source_position[axis] - center) > 1e-5) {
                    const entry = try reflected_vertices.getOrPut(mesh.allocator, source_id);
                    if (!entry.found_existing) {
                        var reflected = source_position;
                        reflected[axis] = center * 2 - reflected[axis];
                        entry.value_ptr.* = @intCast(mesh.vertices.items.len);
                        try mesh.vertices.append(mesh.allocator, .{ .position = reflected });
                    }
                    twin_id = entry.value_ptr.*;
                }
                try twin_vertices.append(mesh.allocator, twin_id);
            }
            const group_entry = try twin_groups.getOrPut(mesh.allocator, face.group);
            if (!group_entry.found_existing) {
                group_entry.value_ptr.* = mesh.next_group;
                mesh.next_group += 1;
            }
            twin.id = @intCast(mesh.faces.items.len);
            twin.group = group_entry.value_ptr.*;
            twin.vertices.clearRetainingCapacity();
            twin.uvs.clearRetainingCapacity();
            try twin.vertices.appendSlice(mesh.allocator, twin_vertices.items);
            output_corner = 0;
            while (output_corner < face.uvs.items.len) : (output_corner += 1) {
                const source_corner = if (output_corner == 0) 0 else face.uvs.items.len - output_corner;
                try twin.uvs.append(mesh.allocator, face.uvs.items[source_corner]);
            }
            if (source_diagonal) |diagonal| {
                const a_position = mesh.vertices.items[diagonal[0]].position;
                const b_position = mesh.vertices.items[diagonal[1]].position;
                const twin_a = if (@abs(a_position[axis] - center) <= 1e-5)
                    diagonal[0]
                else
                    reflected_vertices.get(diagonal[0]) orelse return error.InvalidMirrorDiagonal;
                const twin_b = if (@abs(b_position[axis] - center) <= 1e-5)
                    diagonal[1]
                else
                    reflected_vertices.get(diagonal[1]) orelse return error.InvalidMirrorDiagonal;
                twin.diagonal = .{ twin_a, twin_b };
            } else {
                twin.diagonal = null;
            }
            try mesh.faces.append(mesh.allocator, twin);
            changed = true;
        }
        return changed;
    }

    /// Reference single-mesh symmetrize: cut at the supplied plane, discard the
    /// requested far half, and reflect a reverse-wound twin of every off-seam face.
    pub fn symmetrize(mesh: *Mesh, axis: u8, center: f32, keep_positive: bool) !bool {
        return mesh.symmetrizeForPart(axis, center, keep_positive, null);
    }

    /// Composite-model symmetrize. Each requested outliner part is repaired around
    /// its own bounds center, matching live mirror editing. Parts absent from the
    /// mask are strict pass-through geometry: they are neither cut nor reflected.
    pub fn symmetrizeParts(mesh: *Mesh, axis: u8, keep_positive: bool, target_parts: []const bool) !bool {
        if (axis > 2) return false;
        var changed = false;
        for (target_parts, 0..) |target, part_index| {
            if (!target) continue;
            const part: u32 = @intCast(part_index);
            var lo = std.math.floatMax(f32);
            var hi = -std.math.floatMax(f32);
            var any = false;
            for (mesh.faces.items) |*face| {
                if (!face.alive or face.part != part) continue;
                for (face.vertices.items) |vertex_id| {
                    const coordinate = mesh.vertices.items[vertex_id].position[axis];
                    lo = @min(lo, coordinate);
                    hi = @max(hi, coordinate);
                    any = true;
                }
            }
            if (!any) continue;
            changed = (try mesh.symmetrizeForPart(axis, (lo + hi) * 0.5, keep_positive, part)) or changed;
        }
        return changed;
    }

    fn mirrorPositionKey(part: u32, position: Vec3) MirrorPositionKey {
        return .{
            .part = part,
            .x = @round(position[0] * MIRROR_MATCH_SCALE),
            .y = @round(position[1] * MIRROR_MATCH_SCALE),
            .z = @round(position[2] * MIRROR_MATCH_SCALE),
        };
    }

    fn reflectedPoint(position: Vec3, subset: u8, center: Vec3) Vec3 {
        var reflected = position;
        inline for (0..3) |axis| {
            if (subset & (@as(u8, 1) << @intCast(axis)) != 0) {
                reflected[axis] = center[axis] * 2.0 - reflected[axis];
            }
        }
        return reflected;
    }

    fn sortedQuadKey(part: u32, vertices: [4]u32) MirrorQuadKey {
        var sorted = vertices;
        var index: usize = 1;
        while (index < sorted.len) : (index += 1) {
            const value = sorted[index];
            var cursor = index;
            while (cursor > 0 and sorted[cursor - 1] > value) : (cursor -= 1) {
                sorted[cursor] = sorted[cursor - 1];
            }
            sorted[cursor] = value;
        }
        return .{ .part = part, .a = sorted[0], .b = sorted[1], .c = sorted[2], .d = sorted[3] };
    }

    fn sameUndirectedEdge(a: [2]u32, b: [2]u32) bool {
        return (a[0] == b[0] and a[1] == b[1]) or (a[0] == b[1] and a[1] == b[0]);
    }

    /// Live mirror editing changes vertex positions through a separate welded-twin
    /// table. The physical diagonal is topology too: if already-authored mirror quads
    /// retain opposite imported diagonals, identical mirrored positions fold in
    /// opposite directions as soon as the quads become non-planar. Resolve every
    /// reflected quad pair inside the same outliner part and copy one canonical
    /// physical edge across each enabled mirror subset. Position tolerance is used
    /// only to identify the existing mirror relation; the stored result is stable ids.
    pub fn synchronizeMirrorDiagonals(mesh: *Mesh, mirror_mask_raw: u8) !u32 {
        const mirror_mask = mirror_mask_raw & 7;
        if (mirror_mask == 0) return 0;

        var bounds_by_part = std.AutoHashMapUnmanaged(u32, MirrorPartBounds).empty;
        defer bounds_by_part.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.vertices.items) |vertex_id| {
                const position = mesh.vertices.items[vertex_id].position;
                const entry = try bounds_by_part.getOrPut(mesh.allocator, face.part);
                if (!entry.found_existing) {
                    entry.value_ptr.* = .{ .min = position, .max = position };
                } else {
                    inline for (0..3) |axis| {
                        entry.value_ptr.min[axis] = @min(entry.value_ptr.min[axis], position[axis]);
                        entry.value_ptr.max[axis] = @max(entry.value_ptr.max[axis], position[axis]);
                    }
                }
            }
        }

        var vertices_by_position = std.AutoHashMapUnmanaged(MirrorPositionKey, u32).empty;
        defer vertices_by_position.deinit(mesh.allocator);
        var quads_by_vertices = std.AutoHashMapUnmanaged(MirrorQuadKey, u32).empty;
        defer quads_by_vertices.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.vertices.items) |vertex_id| {
                try vertices_by_position.put(
                    mesh.allocator,
                    mirrorPositionKey(face.part, mesh.vertices.items[vertex_id].position),
                    vertex_id,
                );
            }
            if (face.vertices.items.len != 4) continue;
            try quads_by_vertices.put(mesh.allocator, sortedQuadKey(face.part, .{
                face.vertices.items[0],
                face.vertices.items[1],
                face.vertices.items[2],
                face.vertices.items[3],
            }), face.id);
        }

        var changed: u32 = 0;
        var source_id: u32 = 0;
        while (source_id < mesh.faces.items.len) : (source_id += 1) {
            const source = &mesh.faces.items[source_id];
            if (!source.alive or source.vertices.items.len != 4) continue;
            const bounds = bounds_by_part.get(source.part) orelse continue;
            const center = Vec3{
                (bounds.min[0] + bounds.max[0]) * 0.5,
                (bounds.min[1] + bounds.max[1]) * 0.5,
                (bounds.min[2] + bounds.max[2]) * 0.5,
            };
            var subset: u8 = 1;
            while (subset <= 7) : (subset += 1) {
                if ((subset & mirror_mask) != subset) continue;
                var reflected_vertices: [4]u32 = undefined;
                var corner: usize = 0;
                while (corner < reflected_vertices.len) : (corner += 1) {
                    const source_vertex = source.vertices.items[corner];
                    const reflected = reflectedPoint(mesh.vertices.items[source_vertex].position, subset, center);
                    reflected_vertices[corner] = vertices_by_position.get(mirrorPositionKey(source.part, reflected)) orelse break;
                }
                if (corner != reflected_vertices.len) continue;
                const twin_id = quads_by_vertices.get(sortedQuadKey(source.part, reflected_vertices)) orelse continue;
                // A pair is canonicalized once from the lower stable face id. A quad
                // reflected onto itself cannot own a mirror-invariant single diagonal;
                // changing it here would only oscillate between its two choices.
                if (twin_id <= source_id or twin_id >= mesh.faces.items.len) continue;
                const diagonal = source.diagonal orelse chosenQuadDiagonal(mesh, source);
                const reflected_diagonal = [2]u32{
                    vertices_by_position.get(mirrorPositionKey(
                        source.part,
                        reflectedPoint(mesh.vertices.items[diagonal[0]].position, subset, center),
                    )) orelse continue,
                    vertices_by_position.get(mirrorPositionKey(
                        source.part,
                        reflectedPoint(mesh.vertices.items[diagonal[1]].position, subset, center),
                    )) orelse continue,
                };
                const twin = &mesh.faces.items[twin_id];
                if (quadDiagonalKind(twin, reflected_diagonal) == null) continue;
                if (twin.diagonal) |existing| {
                    if (sameUndirectedEdge(existing, reflected_diagonal)) continue;
                }
                twin.diagonal = reflected_diagonal;
                changed += 1;
            }
        }
        return changed;
    }

    fn selectedFacesAreCoplanar(mesh: *const Mesh, selected: []const u32) bool {
        if (selected.len == 0) return false;
        const reference = &mesh.faces.items[selected[0]];
        if (reference.vertices.items.len < 3) return false;
        const reference_normal = faceNormal(mesh, reference);
        if (length3(reference_normal) < 0.5) return false;
        const reference_point = mesh.vertices.items[reference.vertices.items[0]].position;

        var extent: f32 = 1.0;
        for (selected) |face_id| {
            const face = &mesh.faces.items[face_id];
            for (face.vertices.items) |vertex_id| {
                extent = @max(extent, length3(sub3(mesh.vertices.items[vertex_id].position, reference_point)));
            }
        }
        const plane_tolerance = @max(MERGE_FACE_PLANE_ABS_EPS, extent * MERGE_FACE_PLANE_REL_EPS);
        for (selected) |face_id| {
            const face = &mesh.faces.items[face_id];
            if (dot3(faceNormal(mesh, face), reference_normal) < MERGE_FACE_NORMAL_DOT_MIN) return false;
            for (face.vertices.items) |vertex_id| {
                const offset = sub3(mesh.vertices.items[vertex_id].position, reference_point);
                if (@abs(dot3(offset, reference_normal)) > plane_tolerance) return false;
            }
        }
        return true;
    }

    /// Dissolve a connected coplanar face selection into one ordered boundary face.
    /// Shared seams cancel by vertex-id edge keys; no position reconstruction occurs.
    pub fn mergeSelected(mesh: *Mesh, selected_triangles: []const bool) !bool {
        var selected = std.ArrayListUnmanaged(u32).empty;
        defer selected.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (faceFullySelected(face, selected_triangles)) try selected.append(mesh.allocator, face.id);
        }
        if (selected.items.len < 2) return false;
        const reference_part = mesh.faces.items[selected.items[0]].part;
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            if (face.part != reference_part) return false;
        }
        if (!selectedFacesAreCoplanar(mesh, selected.items)) return false;

        const Directed = struct { from: u32, to: u32, uv: Vec2, key: u64 };
        var uses = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer uses.deinit(mesh.allocator);
        var directed = std.ArrayListUnmanaged(Directed).empty;
        defer directed.deinit(mesh.allocator);
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            for (face.vertices.items, 0..) |from, corner| {
                const to = face.vertices.items[(corner + 1) % face.vertices.items.len];
                if (from == to) continue;
                const key = edgeKey(from, to);
                const entry = try uses.getOrPut(mesh.allocator, key);
                if (!entry.found_existing) entry.value_ptr.* = 0;
                entry.value_ptr.* += 1;
                try directed.append(mesh.allocator, .{ .from = from, .to = to, .uv = face.uvs.items[corner], .key = key });
            }
        }
        var next = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer next.deinit(mesh.allocator);
        var boundary_count: usize = 0;
        var start: ?u32 = null;
        for (directed.items, 0..) |edge, index| {
            if ((uses.get(edge.key) orelse 0) != 1) continue;
            const entry = try next.getOrPut(mesh.allocator, edge.from);
            if (entry.found_existing) return false;
            entry.value_ptr.* = @intCast(index);
            if (start == null) start = edge.from;
            boundary_count += 1;
        }
        if (boundary_count < 3) return false;
        var loop = std.ArrayListUnmanaged(u32).empty;
        defer loop.deinit(mesh.allocator);
        var uvs = std.ArrayListUnmanaged(Vec2).empty;
        defer uvs.deinit(mesh.allocator);
        var current = start.?;
        var consumed: usize = 0;
        while (consumed < boundary_count) : (consumed += 1) {
            const edge_index = next.get(current) orelse return false;
            const edge = directed.items[edge_index];
            try loop.append(mesh.allocator, edge.from);
            try uvs.append(mesh.allocator, edge.uv);
            current = edge.to;
            if (current == start.?) break;
        }
        if (current != start.? or loop.items.len != boundary_count) return false;
        dropCollinearFaceLoop(mesh, &loop, &uvs);
        if (loop.items.len < 3) return false;

        const target_id = selected.items[0];
        var sources = std.ArrayListUnmanaged(u32).empty;
        defer sources.deinit(mesh.allocator);
        for (selected.items) |face_id| try sources.appendSlice(mesh.allocator, mesh.faces.items[face_id].source_triangles.items);
        const target = &mesh.faces.items[target_id];
        target.vertices.clearRetainingCapacity();
        target.uvs.clearRetainingCapacity();
        target.source_triangles.clearRetainingCapacity();
        try target.vertices.appendSlice(mesh.allocator, loop.items);
        try target.uvs.appendSlice(mesh.allocator, uvs.items);
        try target.source_triangles.appendSlice(mesh.allocator, sources.items);
        for (selected.items) |face_id| {
            if (face_id != target_id) mesh.faces.items[face_id].alive = false;
        }
        return true;
    }

    fn dropCollinearFaceLoop(mesh: *const Mesh, vertices: *std.ArrayListUnmanaged(u32), uvs: *std.ArrayListUnmanaged(Vec2)) void {
        var changed = true;
        while (changed and vertices.items.len > 3) {
            changed = false;
            var corner: usize = 0;
            while (corner < vertices.items.len) : (corner += 1) {
                const a = mesh.vertices.items[vertices.items[(corner + vertices.items.len - 1) % vertices.items.len]].position;
                const b = mesh.vertices.items[vertices.items[corner]].position;
                const c = mesh.vertices.items[vertices.items[(corner + 1) % vertices.items.len]].position;
                const first = sub3(b, a);
                const second = sub3(c, b);
                const scale = length3(first) * length3(second);
                if (scale < 1e-12 or length3(cross3(first, second)) / scale < 1e-5) {
                    _ = vertices.orderedRemove(corner);
                    _ = uvs.orderedRemove(corner);
                    changed = true;
                    break;
                }
            }
        }
    }

    pub fn newlyConcaveComparedTo(mesh: *const Mesh, before: *const Mesh, output_triangles: *std.ArrayListUnmanaged(u32)) u32 {
        var bad: u32 = 0;
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.id >= before.faces.items.len or face.vertices.items.len < 4) continue;
            const before_face = &before.faces.items[face.id];
            if (!before_face.alive or before_face.vertices.items.len != face.vertices.items.len) continue;
            if (!faceIsConcave(mesh, face) or faceIsConcave(before, before_face)) continue;
            if (face.source_triangles.items.len > 0) output_triangles.append(mesh.allocator, face.source_triangles.items[0]) catch return bad;
            bad += 1;
        }
        std.mem.sort(u32, output_triangles.items, {}, std.sort.asc(u32));
        return bad;
    }

    fn faceIsConcave(mesh: *const Mesh, face: *const Face) bool {
        if (face.vertices.items.len < 4) return false;
        const normal = faceNormal(mesh, face);
        var sign: f32 = 0;
        for (face.vertices.items, 0..) |vertex_id, corner| {
            const previous = mesh.vertices.items[face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len]].position;
            const current = mesh.vertices.items[vertex_id].position;
            const next = mesh.vertices.items[face.vertices.items[(corner + 1) % face.vertices.items.len]].position;
            const turn = dot3(cross3(sub3(current, previous), sub3(next, current)), normal);
            if (@abs(turn) < 1e-9) continue;
            const current_sign: f32 = if (turn > 0) 1 else -1;
            if (sign == 0) sign = current_sign else if (sign != current_sign) return true;
        }
        return false;
    }

    /// The js-bench-editor/Blockbench walk, ported structurally: split a quad across
    /// its opposite edge, walk into the adjacent face, walk the other direction for
    /// a quad seed, stop on boundaries/processed closure, and split a terminal tri.
    pub fn loopCut(mesh: *Mesh, selected_triangles: []const bool, direction: u32, cuts_raw: u32, offset_fraction_raw: f32) !bool {
        const start_face = mesh.firstSelectedFace(selected_triangles) orelse return false;
        const face = &mesh.faces.items[start_face];
        if (face.vertices.items.len < 2) return false;
        var start_edge = [2]u32{
            face.vertices.items[direction % face.vertices.items.len],
            face.vertices.items[(direction + 1) % face.vertices.items.len],
        };

        // Reference behavior: when several selected faces share an edge, that shared
        // selected edge determines the initial direction instead of the slider index.
        aligned: for (face.vertices.items, 0..) |_, edge_index| {
            const candidate = [2]u32{ face.vertices.items[edge_index], face.vertices.items[(edge_index + 1) % face.vertices.items.len] };
            for (mesh.faces.items) |*other| {
                if (other.id == start_face or !faceFullySelected(other, selected_triangles)) continue;
                if (containsVertex(other, candidate[0]) and containsVertex(other, candidate[1])) {
                    start_edge = candidate;
                    break :aligned;
                }
            }
        }

        var context = CutContext{
            .mesh = mesh,
            .direction = direction,
            .cuts = @max(1, cuts_raw),
            .offset_fraction = std.math.clamp(offset_fraction_raw, 0.0, 1.0),
            .propagate = true,
        };
        defer context.deinit();
        return try splitFace(&context, start_face, start_edge, face.vertices.items.len == 4 or direction > 2, 0);
    }

    pub fn loopCutFromEdge(mesh: *Mesh, a: Vec3, b: Vec3, part: ?u32, cuts: u32, offset_fraction: f32) !bool {
        var start_face: ?u32 = null;
        var start_edge: [2]u32 = undefined;
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            if (part) |wanted| {
                if (face.part != wanted) continue;
            }
            var edge_index: usize = 0;
            while (edge_index < face.vertices.items.len) : (edge_index += 1) {
                const va = face.vertices.items[edge_index];
                const vb = face.vertices.items[(edge_index + 1) % face.vertices.items.len];
                const pa = mesh.vertices.items[va].position;
                const pb = mesh.vertices.items[vb].position;
                if ((samePoint(pa, a) and samePoint(pb, b)) or (samePoint(pa, b) and samePoint(pb, a))) {
                    start_face = face.id;
                    start_edge = .{ va, vb };
                    break;
                }
            }
            if (start_face != null) break;
        }
        const face_id = start_face orelse return false;
        const face = &mesh.faces.items[face_id];
        var context = CutContext{
            .mesh = mesh,
            .direction = 0,
            .cuts = @max(1, cuts),
            .offset_fraction = std.math.clamp(offset_fraction, 0.0, 1.0),
            .propagate = true,
        };
        defer context.deinit();
        return try splitFace(&context, face_id, start_edge, face.vertices.items.len == 4, 0);
    }

    /// Basic Cut uses the same face splitter but deliberately disables neighbor
    /// traversal. It can therefore never turn into a loop cut or exceed selection.
    pub fn cutSelected(mesh: *Mesh, selected_triangles: []const bool, direction: u32, cuts: u32, offset_fraction: f32) !bool {
        var selected = std.ArrayListUnmanaged(u32).empty;
        defer selected.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (faceFullySelected(face, selected_triangles)) try selected.append(mesh.allocator, face.id);
        }
        var context = CutContext{
            .mesh = mesh,
            .direction = direction,
            .cuts = @max(1, cuts),
            .offset_fraction = std.math.clamp(offset_fraction, 0.0, 1.0),
            .propagate = false,
        };
        defer context.deinit();
        var changed = false;
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            if (!face.alive or face.vertices.items.len < 2) continue;
            const side = [2]u32{
                face.vertices.items[direction % face.vertices.items.len],
                face.vertices.items[(direction + 1) % face.vertices.items.len],
            };
            changed = (try splitFace(&context, face_id, side, false, 0)) or changed;
        }
        return changed;
    }

    fn splitFace(context: *CutContext, face_id: u32, side_raw: [2]u32, double_side: bool, cut_no: u32) !bool {
        if (face_id >= context.mesh.faces.items.len) return false;
        const face_len = context.mesh.faces.items[face_id].vertices.items.len;
        if (!context.mesh.faces.items[face_id].alive or face_len < 2) return false;
        try context.processed.put(context.mesh.allocator, face_id, {});

        var side = side_raw;
        const side0_index = indexOf(context.mesh.faces.items[face_id].vertices.items, side[0]) orelse return false;
        const side1_index = indexOf(context.mesh.faces.items[face_id].vertices.items, side[1]) orelse return false;
        const side_diff: isize = @as(isize, @intCast(side0_index)) - @as(isize, @intCast(side1_index));
        if (side_diff == -1 or side_diff > 2) std.mem.swap(u32, &side[0], &side[1]);

        if (face_len == 4) {
            var opposite: [2]u32 = undefined;
            var opposite_count: usize = 0;
            for (context.mesh.faces.items[face_id].vertices.items) |vertex_id| {
                if (vertex_id == side[0] or vertex_id == side[1]) continue;
                if (opposite_count < 2) opposite[opposite_count] = vertex_id;
                opposite_count += 1;
            }
            if (opposite_count != 2) return false;
            const opposite0_index = indexOf(context.mesh.faces.items[face_id].vertices.items, opposite[0]).?;
            const opposite1_index = indexOf(context.mesh.faces.items[face_id].vertices.items, opposite[1]).?;
            const opposite_diff: isize = @as(isize, @intCast(opposite0_index)) - @as(isize, @intCast(opposite1_index));
            if (opposite_diff == 1 or opposite_diff < -2) std.mem.swap(u32, &opposite[0], &opposite[1]);

            const ratio = cutRatio(context.cuts, context.offset_fraction, cut_no);
            const center_side = try context.centerVertex(side, ratio, cut_no);
            const center_opposite = try context.centerVertex(opposite, ratio, cut_no);

            const old = &context.mesh.faces.items[face_id];
            const side_uv = lerp2(uvFor(old, side[0]), uvFor(old, side[1]), ratio);
            const opposite_uv = lerp2(uvFor(old, opposite[0]), uvFor(old, opposite[1]), ratio);
            const new_face = try context.mesh.makeSplitFace(old, &.{ side[1], center_side, center_opposite, opposite[1] }, &.{ uvFor(old, side[1]), side_uv, opposite_uv, uvFor(old, opposite[1]) });
            // Blockbench stores this array as an unordered vertex set and its
            // MeshFace.getSortedVertices() restores polygon order. Our face loops are
            // ordered data, so emit that sorted order directly; the literal reference
            // array crosses center_side/center_opposite into a bow-tie quad.
            try context.mesh.replaceFaceLoop(face_id, &.{ opposite[0], center_opposite, center_side, side[0] }, &.{ uvFor(old, opposite[0]), opposite_uv, side_uv, uvFor(old, side[0]) });
            try context.mesh.faces.append(context.mesh.allocator, new_face);

            if (cut_no + 1 < context.cuts) {
                _ = try splitFace(context, face_id, .{ center_side, side[0] }, double_side, cut_no + 1);
            }
            if (cut_no != 0 or !context.propagate) return true;

            if (findNeighbor(context.mesh, &context.processed, face_id, opposite)) |next_face| {
                _ = try splitFace(context, next_face, opposite, context.mesh.faces.items[next_face].vertices.items.len == 4, 0);
            }
            if (double_side) {
                if (findNeighbor(context.mesh, &context.processed, face_id, side)) |previous_face| {
                    const previous = &context.mesh.faces.items[previous_face];
                    var previous_opposite: [2]u32 = undefined;
                    var count: usize = 0;
                    for (previous.vertices.items) |vertex_id| {
                        if (vertex_id == side[0] or vertex_id == side[1]) continue;
                        if (count < 2) previous_opposite[count] = vertex_id;
                        count += 1;
                    }
                    if (count == 2) {
                        _ = try splitFace(context, previous_face, previous_opposite, previous.vertices.items.len == 4, 0);
                    } else if (count == 1) {
                        _ = try splitFace(context, previous_face, side, false, 0);
                    } else if (previous.vertices.items.len > 4) {
                        // Legacy ReactJIT cylinder cap. The reference primitive would
                        // present a terminal triangle on this side of the seed too.
                        _ = try splitFace(context, previous_face, side, false, 0);
                    }
                }
            }
            return true;
        }

        if (face_len == 3) {
            var opposed: ?u32 = null;
            for (context.mesh.faces.items[face_id].vertices.items) |vertex_id| {
                if (vertex_id != side[0] and vertex_id != side[1]) opposed = vertex_id;
            }
            const opposed_vertex = opposed orelse return false;
            const ratio = cutRatio(context.cuts, context.offset_fraction, cut_no);

            if (context.direction > 2) {
                var opposite = [2]u32{ side[context.direction % side.len], opposed_vertex };
                const opposite0_index = indexOf(context.mesh.faces.items[face_id].vertices.items, opposite[0]).?;
                const opposite1_index = indexOf(context.mesh.faces.items[face_id].vertices.items, opposite[1]).?;
                const opposite_diff: isize = @as(isize, @intCast(opposite0_index)) - @as(isize, @intCast(opposite1_index));
                if (opposite_diff == 1 or opposite_diff < -2) std.mem.swap(u32, &opposite[0], &opposite[1]);
                const center_side = try context.centerVertex(side, ratio, cut_no);
                const center_opposite = try context.centerVertex(opposite, ratio, cut_no);
                const old = &context.mesh.faces.items[face_id];
                const old_normal = faceNormal(context.mesh, old);
                const side_uv = lerp2(uvFor(old, side[0]), uvFor(old, side[1]), ratio);
                const opposite_uv = lerp2(uvFor(old, opposite[0]), uvFor(old, opposite[1]), ratio);
                const other_quad = if (side[0] != opposite[0] and side[0] != opposite[1]) side[0] else side[1];
                const other_tri = if (side[0] == opposite[0] or side[0] == opposite[1]) side[0] else side[1];
                const new_face = try context.mesh.makeSplitFace(old, &.{ other_tri, center_side, center_opposite }, &.{ uvFor(old, other_tri), side_uv, opposite_uv });
                try context.mesh.replaceFaceLoop(face_id, &.{ opposed_vertex, center_opposite, center_side, other_quad }, &.{ uvFor(old, opposed_vertex), opposite_uv, side_uv, uvFor(old, other_quad) });
                const new_face_id = new_face.id;
                try context.mesh.faces.append(context.mesh.allocator, new_face);
                if (dot3(faceNormal(context.mesh, &context.mesh.faces.items[new_face_id]), old_normal) < 0) context.mesh.reverseFace(new_face_id);
                if (dot3(faceNormal(context.mesh, &context.mesh.faces.items[face_id]), old_normal) < 0) context.mesh.reverseFace(face_id);

                if (cut_no + 1 < context.cuts) {
                    _ = try splitFace(context, face_id, .{ center_side, other_quad }, double_side, cut_no + 1);
                }
                if (cut_no != 0 or !context.propagate) return true;
                if (findNeighbor(context.mesh, &context.processed, face_id, opposite)) |next_face| {
                    _ = try splitFace(context, next_face, opposite, context.mesh.faces.items[next_face].vertices.items.len == 4, 0);
                }
                if (double_side) {
                    if (findNeighbor(context.mesh, &context.processed, face_id, side)) |previous_face| {
                        const previous = &context.mesh.faces.items[previous_face];
                        var previous_opposite: [2]u32 = undefined;
                        var count: usize = 0;
                        for (previous.vertices.items) |vertex_id| {
                            if (vertex_id == side[0] or vertex_id == side[1]) continue;
                            if (count < 2) previous_opposite[count] = vertex_id;
                            count += 1;
                        }
                        if (count == 2) _ = try splitFace(context, previous_face, previous_opposite, previous.vertices.items.len == 4, 0);
                    }
                }
                return true;
            }

            const center = try context.centerVertex(side, ratio, cut_no);
            const old = &context.mesh.faces.items[face_id];
            const center_uv = lerp2(uvFor(old, side[0]), uvFor(old, side[1]), ratio);
            const new_face = try context.mesh.makeSplitFace(old, &.{ side[1], center, opposed_vertex }, &.{ uvFor(old, side[1]), center_uv, uvFor(old, opposed_vertex) });
            const new_face_id = new_face.id;
            try context.mesh.replaceFaceLoop(face_id, &.{ opposed_vertex, center, side[0] }, &.{ uvFor(old, opposed_vertex), center_uv, uvFor(old, side[0]) });
            try context.mesh.faces.append(context.mesh.allocator, new_face);
            if (context.direction % 3 == 2) {
                context.mesh.reverseFace(new_face_id);
                context.mesh.reverseFace(face_id);
            }
            return true; // reference terminates after splitting a triangle
        }

        // ReactJIT cylinders authored before req_3230 stored each cap as one convex
        // n-gon. js-bench-editor cylinders have a real center vertex and one triangle
        // per cap side, which is why its loop walk can enter the top/bottom. Promote
        // only a planar convex n-gon whose EVERY rim edge is bounded by a side quad;
        // arbitrary imported n-gons keep the reference's normal stop behavior.
        if (face_len > 4) {
            if (try context.mesh.promoteLegacyFanCap(face_id, side)) |cap_triangle| {
                return splitFace(context, cap_triangle, side, false, cut_no);
            }
        }
        return false;
    }

    fn promoteLegacyFanCap(mesh: *Mesh, face_id: u32, entering_edge: [2]u32) !?u32 {
        if (face_id >= mesh.faces.items.len) return null;
        const face = &mesh.faces.items[face_id];
        if (!face.alive or face.vertices.items.len <= 4 or faceIsConcave(mesh, face)) return null;

        var entering_corner: ?usize = null;
        var center = Vec3{ 0, 0, 0 };
        var center_uv = Vec2{ 0, 0 };
        const origin = mesh.vertices.items[face.vertices.items[0]].position;
        const normal = faceNormal(mesh, face);
        if (length3(normal) < 0.5) return null;
        var extent: f32 = 0;
        for (face.vertices.items, 0..) |vertex_id, corner| {
            const next = (corner + 1) % face.vertices.items.len;
            const next_id = face.vertices.items[next];
            const is_entering_edge = (vertex_id == entering_edge[0] and next_id == entering_edge[1]) or
                (vertex_id == entering_edge[1] and next_id == entering_edge[0]);
            if (is_entering_edge) entering_corner = corner;
            const position = mesh.vertices.items[vertex_id].position;
            center = add3(center, position);
            center_uv[0] += face.uvs.items[corner][0];
            center_uv[1] += face.uvs.items[corner][1];
            extent = @max(extent, length3(sub3(position, origin)));

            var quad_neighbor = false;
            for (mesh.faces.items) |*other| {
                if (!other.alive or other.id == face_id or other.part != face.part or other.vertices.items.len != 4) continue;
                if (containsVertex(other, vertex_id) and containsVertex(other, next_id)) {
                    quad_neighbor = true;
                    break;
                }
            }
            // The entering side quad was already split before traversal reached this
            // cap, so its original rim edge is now represented by two half-edge quads.
            if (!quad_neighbor and !is_entering_edge) return null;
        }
        const start = entering_corner orelse return null;
        const count = face.vertices.items.len;
        const inverse_count = 1.0 / @as(f32, @floatFromInt(count));
        center = mul3(center, inverse_count);
        center_uv = .{ center_uv[0] * inverse_count, center_uv[1] * inverse_count };
        const planar_epsilon = @max(@as(f32, 1e-5), extent * 1e-4);
        for (face.vertices.items) |vertex_id| {
            if (@abs(dot3(sub3(mesh.vertices.items[vertex_id].position, origin), normal)) > planar_epsilon) return null;
        }

        var source = try face.clone(mesh.allocator);
        defer source.deinit(mesh.allocator);
        const center_id: u32 = @intCast(mesh.vertices.items.len);
        try mesh.vertices.append(mesh.allocator, .{ .position = center });
        var fan_side: usize = 0;
        while (fan_side < count) : (fan_side += 1) {
            const corner = (start + fan_side) % count;
            const next = (corner + 1) % count;
            const vertices = [3]u32{ source.vertices.items[corner], source.vertices.items[next], center_id };
            const uvs = [3]Vec2{ source.uvs.items[corner], source.uvs.items[next], center_uv };
            if (fan_side == 0) {
                try mesh.replaceFaceLoop(face_id, vertices[0..], uvs[0..]);
            } else {
                const triangle = try mesh.makeSplitFace(&source, vertices[0..], uvs[0..]);
                try mesh.faces.append(mesh.allocator, triangle);
            }
        }
        return face_id;
    }

    fn makeSplitFace(mesh: *Mesh, source: *const Face, vertices: []const u32, uvs: []const Vec2) !Face {
        var out = Face{
            .id = @intCast(mesh.faces.items.len),
            .group = mesh.next_group,
            .part = source.part,
            .material = source.material,
        };
        mesh.next_group += 1;
        errdefer out.deinit(mesh.allocator);
        try out.vertices.appendSlice(mesh.allocator, vertices);
        try out.uvs.appendSlice(mesh.allocator, uvs);
        try out.source_triangles.appendSlice(mesh.allocator, source.source_triangles.items);
        if (out.vertices.items.len == 4) out.diagonal = chosenQuadDiagonal(mesh, &out);
        return out;
    }

    fn replaceFaceLoop(mesh: *Mesh, face_id: u32, vertices: []const u32, uvs: []const Vec2) !void {
        const face = &mesh.faces.items[face_id];
        face.vertices.clearRetainingCapacity();
        face.uvs.clearRetainingCapacity();
        try face.vertices.appendSlice(mesh.allocator, vertices);
        try face.uvs.appendSlice(mesh.allocator, uvs);
        face.diagonal = if (face.vertices.items.len == 4) chosenQuadDiagonal(mesh, face) else null;
    }

    fn reverseFace(mesh: *Mesh, face_id: u32) void {
        if (face_id >= mesh.faces.items.len) return;
        std.mem.reverse(u32, mesh.faces.items[face_id].vertices.items);
        std.mem.reverse(Vec2, mesh.faces.items[face_id].uvs.items);
    }

    fn findNeighbor(mesh: *const Mesh, processed: *const std.AutoHashMapUnmanaged(u32, void), current_face: u32, edge: [2]u32) ?u32 {
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.id == current_face or processed.contains(face.id)) continue;
            if (containsVertex(face, edge[0]) and containsVertex(face, edge[1])) return face.id;
        }
        return null;
    }

    fn containsVertex(face: *const Face, vertex_id: u32) bool {
        return indexOf(face.vertices.items, vertex_id) != null;
    }

    fn indexOf(vertices: []const u32, vertex_id: u32) ?usize {
        for (vertices, 0..) |candidate, index| if (candidate == vertex_id) return index;
        return null;
    }

    fn uvFor(face: *const Face, vertex_id: u32) Vec2 {
        const index = indexOf(face.vertices.items, vertex_id) orelse return .{ 0.5, 0.5 };
        return if (index < face.uvs.items.len) face.uvs.items[index] else .{ 0.5, 0.5 };
    }

    pub fn lower(mesh: *const Mesh) !Lowered {
        var positions = std.ArrayListUnmanaged(f32).empty;
        defer positions.deinit(mesh.allocator);
        var uvs = std.ArrayListUnmanaged(f32).empty;
        defer uvs.deinit(mesh.allocator);
        var triangle_vertices = std.ArrayListUnmanaged([3]u32).empty;
        defer triangle_vertices.deinit(mesh.allocator);
        var groups = std.ArrayListUnmanaged(u32).empty;
        defer groups.deinit(mesh.allocator);
        var sources = std.ArrayListUnmanaged(u32).empty;
        defer sources.deinit(mesh.allocator);
        var face_ids = std.ArrayListUnmanaged(u32).empty;
        defer face_ids.deinit(mesh.allocator);
        var parts = std.ArrayListUnmanaged(u32).empty;
        defer parts.deinit(mesh.allocator);
        var materials = std.ArrayListUnmanaged(u32).empty;
        defer materials.deinit(mesh.allocator);

        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 3) continue;
            if (face.vertices.items.len == 4) {
                const tris = quadTriangles(mesh, face);
                try emitLoweredTri(mesh, face, tris[0], &positions, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials);
                try emitLoweredTri(mesh, face, tris[1], &positions, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials);
            } else {
                var corner: usize = 1;
                while (corner + 1 < face.vertices.items.len) : (corner += 1) {
                    try emitLoweredTri(mesh, face, .{ 0, corner, corner + 1 }, &positions, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials);
                }
            }
        }
        const pos_owned = try positions.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(pos_owned);
        const uv_owned = try uvs.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(uv_owned);
        const triangle_vertices_owned = try triangle_vertices.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(triangle_vertices_owned);
        const group_owned = try groups.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(group_owned);
        const source_owned = try sources.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(source_owned);
        const face_id_owned = try face_ids.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(face_id_owned);
        const part_owned = try parts.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(part_owned);
        const material_owned = try materials.toOwnedSlice(mesh.allocator);
        return .{
            .allocator = mesh.allocator,
            .positions = pos_owned,
            .uvs = uv_owned,
            .triangle_vertices = triangle_vertices_owned,
            .groups = group_owned,
            .source_triangles = source_owned,
            .face_ids = face_id_owned,
            .parts = part_owned,
            .materials = material_owned,
            .tri_count = @intCast(group_owned.len),
        };
    }

    fn emitLoweredTri(
        mesh: *const Mesh,
        face: *const Face,
        triangle: [3]usize,
        positions: *std.ArrayListUnmanaged(f32),
        uvs: *std.ArrayListUnmanaged(f32),
        triangle_vertices: *std.ArrayListUnmanaged([3]u32),
        groups: *std.ArrayListUnmanaged(u32),
        sources: *std.ArrayListUnmanaged(u32),
        face_ids: *std.ArrayListUnmanaged(u32),
        parts: *std.ArrayListUnmanaged(u32),
        materials: *std.ArrayListUnmanaged(u32),
    ) !void {
        for (triangle) |corner| {
            const p = mesh.vertices.items[face.vertices.items[corner]].position;
            try positions.appendSlice(mesh.allocator, p[0..]);
            const uv = if (corner < face.uvs.items.len) face.uvs.items[corner] else Vec2{ 0.5, 0.5 };
            try uvs.appendSlice(mesh.allocator, uv[0..]);
        }
        try triangle_vertices.append(mesh.allocator, .{
            face.vertices.items[triangle[0]],
            face.vertices.items[triangle[1]],
            face.vertices.items[triangle[2]],
        });
        try groups.append(mesh.allocator, face.group);
        try sources.append(mesh.allocator, if (face.source_triangles.items.len > 0) face.source_triangles.items[0] else 0);
        try face_ids.append(mesh.allocator, face.id);
        try parts.append(mesh.allocator, face.part);
        try materials.append(mesh.allocator, face.material);
    }

    /// Adopt metadata that was normalized after lowering, then make current render
    /// triangle ids the provenance basis for the next edit session. Vertex and face ids
    /// remain untouched.
    pub fn adoptLoweredMetadata(mesh: *Mesh, lowered: *const Lowered, groups: ?[]const u32, parts: ?[]const u32) void {
        // Reserve before clearing so allocation failure leaves the still-valid resident
        // mapping intact. A missing map would make the next position-only gizmo update
        // fail (or tempt this layer to reconstruct identity from soup order again).
        mesh.render_triangles.ensureTotalCapacity(mesh.allocator, lowered.triangle_vertices.len) catch return;
        mesh.render_triangles.clearRetainingCapacity();
        mesh.render_triangles.appendSliceAssumeCapacity(lowered.triangle_vertices);
        var touched = std.AutoHashMapUnmanaged(u32, void).empty;
        defer touched.deinit(mesh.allocator);
        for (lowered.face_ids, 0..) |face_id, triangle| {
            if (face_id >= mesh.faces.items.len) continue;
            const first = touched.getOrPut(mesh.allocator, face_id) catch return;
            if (first.found_existing) continue;
            if (groups) |rows| {
                if (triangle < rows.len) mesh.faces.items[face_id].group = rows[triangle];
            }
            if (parts) |rows| {
                if (triangle < rows.len) mesh.faces.items[face_id].part = rows[triangle];
            }
            mesh.faces.items[face_id].source_triangles.clearRetainingCapacity();
        }
        for (lowered.face_ids, 0..) |face_id, triangle| {
            if (face_id >= mesh.faces.items.len) continue;
            mesh.faces.items[face_id].source_triangles.append(mesh.allocator, @intCast(triangle)) catch return;
        }
    }

    /// Pull a position-only mutation through the explicit resident triangle map.
    /// Import soup may use either quad diagonal and arbitrary triangle order; guessing
    /// today's deterministic lowering here corrupts stable ids on the first gizmo move.
    pub fn updatePositionsFromInterleaved(mesh: *Mesh, interleaved: []const f32, tri_count: u32) bool {
        if (interleaved.len < @as(usize, tri_count) * 24) return false;
        if (mesh.render_triangles.items.len != tri_count) return false;
        for (mesh.render_triangles.items, 0..) |triangle, rendered| {
            for (triangle, 0..) |vertex_id, output_corner| {
                if (vertex_id >= mesh.vertices.items.len) return false;
                const base = (@as(usize, rendered) * 3 + output_corner) * 8;
                mesh.vertices.items[vertex_id].position = .{ interleaved[base], interleaved[base + 1], interleaved[base + 2] };
            }
        }
        return true;
    }

    /// null when `candidate` is not one of this quad's two physical diagonals;
    /// true for loop positions 0-2, false for 1-3.
    fn quadDiagonalKind(face: *const Face, candidate: [2]u32) ?bool {
        if (face.vertices.items.len != 4) return null;
        const matches = struct {
            fn edge(a: u32, b: u32, edge_pair: [2]u32) bool {
                return (a == edge_pair[0] and b == edge_pair[1]) or (a == edge_pair[1] and b == edge_pair[0]);
            }
        }.edge;
        if (matches(face.vertices.items[0], face.vertices.items[2], candidate)) return true;
        if (matches(face.vertices.items[1], face.vertices.items[3], candidate)) return false;
        return null;
    }

    fn chosenQuadDiagonal(mesh: *const Mesh, face: *const Face) [2]u32 {
        const p0 = mesh.vertices.items[face.vertices.items[0]].position;
        const p1 = mesh.vertices.items[face.vertices.items[1]].position;
        const p2 = mesh.vertices.items[face.vertices.items[2]].position;
        const p3 = mesh.vertices.items[face.vertices.items[3]].position;
        const normal = faceNormal(mesh, face);
        const ac_convex = triFacesNormal(p0, p1, p2, normal) and triFacesNormal(p0, p2, p3, normal);
        const bd_convex = triFacesNormal(p1, p2, p3, normal) and triFacesNormal(p1, p3, p0, normal);
        const use_ac = if (ac_convex != bd_convex)
            ac_convex
        else
            distanceSquared(p0, p2) <= distanceSquared(p1, p3);
        return if (use_ac)
            .{ face.vertices.items[0], face.vertices.items[2] }
        else
            .{ face.vertices.items[1], face.vertices.items[3] };
    }

    fn quadTriangles(mesh: *const Mesh, face: *const Face) [2][3]usize {
        const use_ac = if (face.diagonal) |diagonal|
            (quadDiagonalKind(face, diagonal) orelse quadDiagonalKind(face, chosenQuadDiagonal(mesh, face)).?)
        else
            quadDiagonalKind(face, chosenQuadDiagonal(mesh, face)).?;
        return if (use_ac) .{ .{ 0, 1, 2 }, .{ 0, 2, 3 } } else .{ .{ 1, 2, 3 }, .{ 1, 3, 0 } };
    }

    fn faceNormal(mesh: *const Mesh, face: *const Face) Vec3 {
        var normal = Vec3{ 0, 0, 0 };
        for (face.vertices.items, 0..) |vertex_id, index| {
            const current = mesh.vertices.items[vertex_id].position;
            const next = mesh.vertices.items[face.vertices.items[(index + 1) % face.vertices.items.len]].position;
            normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
            normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
            normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
        }
        return norm3(normal);
    }
};

fn add3(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}
fn sub3(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn mul3(a: Vec3, scalar: f32) Vec3 {
    return .{ a[0] * scalar, a[1] * scalar, a[2] * scalar };
}
fn dot3(a: Vec3, b: Vec3) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn cross3(a: Vec3, b: Vec3) Vec3 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn length3(a: Vec3) f32 {
    return @sqrt(dot3(a, a));
}
fn norm3(a: Vec3) Vec3 {
    const length = length3(a);
    return if (length > 1e-12) mul3(a, 1.0 / length) else .{ 0, 0, 0 };
}
fn lerp3(a: Vec3, b: Vec3, ratio: f32) Vec3 {
    return .{ a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio, a[2] + (b[2] - a[2]) * ratio };
}
fn lerp2(a: Vec2, b: Vec2, ratio: f32) Vec2 {
    return .{ a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio };
}
fn cutRatio(cuts: u32, offset_fraction: f32, cut_no: u32) f32 {
    if (cuts <= 1) return std.math.clamp(offset_fraction, 0.0, 1.0);
    const denominator: f32 = @floatFromInt(cuts + 1 - cut_no);
    return std.math.clamp(1.0 - (offset_fraction * 2.0) / denominator, 0.0, 1.0);
}
fn distanceSquared(a: Vec3, b: Vec3) f32 {
    return dot3(sub3(a, b), sub3(a, b));
}
fn samePoint(a: Vec3, b: Vec3) bool {
    return distanceSquared(a, b) <= 1e-10;
}
fn triFacesNormal(a: Vec3, b: Vec3, c: Vec3, normal: Vec3) bool {
    return dot3(cross3(sub3(b, a), sub3(c, a)), normal) > 0;
}

fn appendSoupVertex(out: *std.ArrayListUnmanaged(f32), allocator: std.mem.Allocator, p: Vec3, uv: Vec2) !void {
    try out.appendSlice(allocator, &.{ p[0], p[1], p[2], 0, 1, 0, uv[0], uv[1] });
}

fn appendSoupTri(out: *std.ArrayListUnmanaged(f32), allocator: std.mem.Allocator, a: Vec3, b: Vec3, c: Vec3) !void {
    try appendSoupVertex(out, allocator, a, .{ 0, 0 });
    try appendSoupVertex(out, allocator, b, .{ 1, 0 });
    try appendSoupVertex(out, allocator, c, .{ 1, 1 });
}

fn makeQuadStripSoup(allocator: std.mem.Allocator, quads: []const [4]Vec3) !struct { verts: []f32, groups: []u32 } {
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    var groups = std.ArrayListUnmanaged(u32).empty;
    defer groups.deinit(allocator);
    for (quads, 0..) |quad, group| {
        try appendSoupTri(&soup, allocator, quad[0], quad[1], quad[2]);
        try appendSoupTri(&soup, allocator, quad[0], quad[2], quad[3]);
        try groups.append(allocator, @intCast(group));
        try groups.append(allocator, @intCast(group));
    }
    return .{ .verts = try soup.toOwnedSlice(allocator), .groups = try groups.toOwnedSlice(allocator) };
}

test "indexed loop cut follows a closed flared quad ring at edge ratios" {
    const allocator = std.testing.allocator;
    const bottom = [4]Vec3{ .{ -4, 0, -4 }, .{ 4, 0, -4 }, .{ 4, 0, 4 }, .{ -4, 0, 4 } };
    const top = [4]Vec3{ .{ -1, 2, -1 }, .{ 1, 2, -1 }, .{ 1, 2, 1 }, .{ -1, 2, 1 } };
    var quads: [4][4]Vec3 = undefined;
    for (0..4) |index| quads[index] = .{ bottom[index], bottom[(index + 1) % 4], top[(index + 1) % 4], top[index] };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 8, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true, false, false, false, false, false, false };
    try std.testing.expect(try mesh.loopCut(selected[0..], 1, 1, 0.5));
    for (mesh.faces.items) |*face| {
        if (face.alive) try std.testing.expect(length3(Mesh.faceNormal(&mesh, face)) > 0.99);
    }
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 16), lowered.tri_count);
    var index: usize = 0;
    while (index < lowered.positions.len) : (index += 3) {
        const y = lowered.positions[index + 1];
        if (y != 0 and y != 2) try std.testing.expectEqual(@as(f32, 1), y);
    }
}

test "lowered loop cut preserves and interpolates per-corner UVs" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var corner: usize = 0;
    while (corner < fixture.verts.len / 8) : (corner += 1) {
        fixture.verts[corner * 8 + 6] = fixture.verts[corner * 8 + 0];
        fixture.verts[corner * 8 + 7] = fixture.verts[corner * 8 + 1];
    }
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true };
    try std.testing.expect(try mesh.loopCut(selected[0..], 0, 1, 0.25));

    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(usize, lowered.tri_count * 6), lowered.uvs.len);
    var rendered_corner: usize = 0;
    var saw_interpolated = false;
    while (rendered_corner < lowered.tri_count * 3) : (rendered_corner += 1) {
        const x = lowered.positions[rendered_corner * 3 + 0];
        const y = lowered.positions[rendered_corner * 3 + 1];
        try std.testing.expectApproxEqAbs(x, lowered.uvs[rendered_corner * 2 + 0], 0.0001);
        try std.testing.expectApproxEqAbs(y, lowered.uvs[rendered_corner * 2 + 1], 0.0001);
        if ((x > 0 and x < 1) or (y > 0 and y < 1)) saw_interpolated = true;
    }
    try std.testing.expect(saw_interpolated);
}

test "texture role follows authored face identity through loop cut" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    const imported_materials = [_]u32{ 3, 3 };
    var mesh = try Mesh.fromSoupWithMaterials(allocator, fixture.verts, 2, fixture.groups, null, imported_materials[0..]);
    defer mesh.deinit();
    const selected = [_]bool{ true, true };
    try std.testing.expect(try mesh.loopCut(selected[0..], 0, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 4), lowered.tri_count);
    for (lowered.materials) |material| try std.testing.expectEqual(@as(u32, 3), material);

    const all_selected = [_]bool{ true, true, true, true };
    try std.testing.expectEqual(@as(u32, 2), mesh.assignSelectedMaterial(all_selected[0..], 1));
    var reassigned = try mesh.lower();
    defer reassigned.deinit();
    for (reassigned.materials) |material| try std.testing.expectEqual(@as(u32, 1), material);
}

test "loop cut keeps every panel of a closed cylinder belt ordered" {
    const allocator = std.testing.allocator;
    const segments = 16;
    var quads: [segments][4]Vec3 = undefined;
    for (0..segments) |index| {
        const a0 = @as(f32, @floatFromInt(index)) / segments * std.math.tau;
        const a1 = @as(f32, @floatFromInt((index + 1) % segments)) / segments * std.math.tau;
        const bottom0 = Vec3{ @cos(a0), 0, @sin(a0) };
        const top0 = Vec3{ @cos(a0), 2, @sin(a0) };
        const bottom1 = Vec3{ @cos(a1), 0, @sin(a1) };
        const top1 = Vec3{ @cos(a1), 2, @sin(a1) };
        // Same ordered side loop emitted by cart/editor/model/editMesh.ts cylinder().
        quads[index] = .{ bottom0, top0, top1, bottom1 };
    }
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, segments * 2, fixture.groups, null);
    defer mesh.deinit();
    var selected: [segments * 2]bool = @splat(false);
    selected[0] = true;
    selected[1] = true;

    // The perpendicular direction has no opposite quad beyond the open belt edge,
    // so the reference splits only the seed panel and stops. It must still leave two
    // ordered faces rather than the crossed panel/hole seen in req_3227.
    var perpendicular = try mesh.clone();
    defer perpendicular.deinit();
    try std.testing.expect(try perpendicular.loopCut(selected[0..], 1, 1, 0.5));
    try std.testing.expectEqual(@as(usize, segments + 1), perpendicular.faces.items.len);
    for (perpendicular.faces.items) |*face| {
        if (face.alive) try std.testing.expect(length3(Mesh.faceNormal(&perpendicular, face)) > 0.99);
    }

    try std.testing.expect(try mesh.loopCut(selected[0..], 0, 1, 0.5));
    try std.testing.expectEqual(@as(usize, segments * 2), mesh.faces.items.len);
    for (mesh.faces.items) |*face| {
        if (!face.alive) continue;
        try std.testing.expectEqual(@as(usize, 4), face.vertices.items.len);
        try std.testing.expect(length3(Mesh.faceNormal(&mesh, face)) > 0.99);
    }
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, segments * 4), lowered.tri_count);
}

test "loop cut promotes legacy cylinder n-gon caps to the reference triangle fan" {
    const allocator = std.testing.allocator;
    const segments = 16;
    var bottom: [segments]Vec3 = undefined;
    var top: [segments]Vec3 = undefined;
    for (0..segments) |index| {
        const angle = @as(f32, @floatFromInt(index)) / segments * std.math.tau;
        bottom[index] = .{ @cos(angle), 0, @sin(angle) };
        top[index] = .{ @cos(angle), 2, @sin(angle) };
    }
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    var groups = std.ArrayListUnmanaged(u32).empty;
    defer groups.deinit(allocator);
    for (0..segments) |index| {
        const next = (index + 1) % segments;
        try appendSoupTri(&soup, allocator, bottom[index], top[index], top[next]);
        try appendSoupTri(&soup, allocator, bottom[index], top[next], bottom[next]);
        try groups.append(allocator, @intCast(index));
        try groups.append(allocator, @intCast(index));
    }
    // Exact old ReactJIT cap lowering: each cap was one authored n-gon group,
    // render-fanned from a rim vertex with no stable center vertex.
    for (0..segments - 2) |index| {
        try appendSoupTri(&soup, allocator, top[segments - 1], top[segments - 2 - index], top[segments - 3 - index]);
        try groups.append(allocator, segments);
    }
    for (0..segments - 2) |index| {
        try appendSoupTri(&soup, allocator, bottom[0], bottom[index + 1], bottom[index + 2]);
        try groups.append(allocator, segments + 1);
    }
    const triangle_count: u32 = @intCast(groups.items.len);
    var mesh = try Mesh.fromSoup(allocator, soup.items, triangle_count, groups.items, null);
    defer mesh.deinit();
    try std.testing.expectEqual(@as(usize, segments + 2), mesh.faces.items.len);

    const selected = try allocator.alloc(bool, triangle_count);
    defer allocator.free(selected);
    @memset(selected, false);
    selected[0] = true;
    selected[1] = true;
    try std.testing.expect(try mesh.loopCut(selected, 1, 1, 0.5));
    try std.testing.expectEqual(@as(usize, segments * 3 + 3), mesh.faces.items.len);
    try std.testing.expectEqual(@as(usize, segments * 2 + 4), mesh.vertices.items.len);
    for (mesh.faces.items) |*face| {
        if (!face.alive) continue;
        try std.testing.expect(face.vertices.items.len == 3 or face.vertices.items.len == 4);
        try std.testing.expect(length3(Mesh.faceNormal(&mesh, face)) > 0.99);
    }
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, segments * 4 + 4), lowered.tri_count);
}

test "indexed loop cut splits a terminal triangle then stops like the reference" {
    const allocator = std.testing.allocator;
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    // Quad [0,1,2,3], then a triangle sharing its opposite edge [3,2].
    try appendSoupTri(&soup, allocator, .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 });
    try appendSoupTri(&soup, allocator, .{ 0, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 });
    try appendSoupTri(&soup, allocator, .{ 0, 1, 0 }, .{ 1, 1, 0 }, .{ 0.5, 2, 0 });
    const groups = [_]u32{ 0, 0, 1 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 3, groups[0..], null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true, false };
    try std.testing.expect(try mesh.loopCut(selected[0..], 0, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    // Quad 2→4 tris, terminal triangle 1→2 tris.
    try std.testing.expectEqual(@as(u32, 6), lowered.tri_count);
}

test "basic indexed cut never traverses into an unselected neighbor" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{
        .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
        .{ .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1, 1, 0 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true, false, false };
    try std.testing.expect(try mesh.cutSelected(selected[0..], 1, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 6), lowered.tri_count); // selected 2→4, neighbor stays 2
}

test "reference direction above two splits a triangle edge to edge" {
    const allocator = std.testing.allocator;
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    try appendSoupTri(&soup, allocator, .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 0, 2, 0 });
    const groups = [_]u32{0};
    var mesh = try Mesh.fromSoup(allocator, soup.items, 1, groups[0..], null);
    defer mesh.deinit();
    const selected = [_]bool{true};
    try std.testing.expect(try mesh.loopCut(selected[0..], 3, 1, 0.5));
    try std.testing.expectEqual(@as(usize, 2), mesh.faces.items.len);
    try std.testing.expect(mesh.faces.items[0].vertices.items.len == 4 or mesh.faces.items[1].vertices.items.len == 4);
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 3), lowered.tri_count);
}

test "basic cut on an adjacent face succeeds after the first cut" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{
        .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
        .{ .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1, 1, 0 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, null);
    defer mesh.deinit();

    const first = [_]bool{ true, true, false, false };
    try std.testing.expect(try mesh.cutSelected(first[0..], 1, 1, 0.5));
    var first_lowered = try mesh.lower();
    defer first_lowered.deinit();
    mesh.adoptLoweredMetadata(&first_lowered, first_lowered.groups, null);

    const second = try allocator.alloc(bool, first_lowered.tri_count);
    defer allocator.free(second);
    @memset(second, false);
    for (mesh.faces.items) |*face| {
        if (face.group != 1) continue;
        for (face.source_triangles.items) |triangle| second[triangle] = true;
    }
    try std.testing.expect(try mesh.cutSelected(second, 1, 1, 0.5));
}

test "reference multi-cut recursively spaces cuts from the amended offset" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true };
    try std.testing.expect(try mesh.loopCut(selected[0..], 0, 2, 0.25));

    var saw_near = false;
    var saw_far = false;
    for (mesh.vertices.items) |vertex| {
        if (@abs(vertex.position[0] - 0.16666667) < 1e-5) saw_near = true;
        if (@abs(vertex.position[0] - 0.375) < 1e-5) saw_far = true;
    }
    try std.testing.expect(saw_near);
    try std.testing.expect(saw_far);
}

test "two perpendicular two-cut loops add exactly four planes to a manifold cuboid" {
    const allocator = std.testing.allocator;
    const half_width: f32 = 1.5;
    const half_height: f32 = 1.5;
    const half_depth: f32 = 0.0025;
    const quads = [_][4]Vec3{
        .{ .{ -half_width, half_height, -half_depth }, .{ -half_width, half_height, half_depth }, .{ half_width, half_height, half_depth }, .{ half_width, half_height, -half_depth } },
        .{ .{ -half_width, -half_height, -half_depth }, .{ half_width, -half_height, -half_depth }, .{ half_width, -half_height, half_depth }, .{ -half_width, -half_height, half_depth } },
        .{ .{ -half_width, -half_height, -half_depth }, .{ -half_width, half_height, -half_depth }, .{ half_width, half_height, -half_depth }, .{ half_width, -half_height, -half_depth } },
        .{ .{ -half_width, -half_height, half_depth }, .{ half_width, -half_height, half_depth }, .{ half_width, half_height, half_depth }, .{ -half_width, half_height, half_depth } },
        .{ .{ -half_width, -half_height, -half_depth }, .{ -half_width, -half_height, half_depth }, .{ -half_width, half_height, half_depth }, .{ -half_width, half_height, -half_depth } },
        .{ .{ half_width, -half_height, -half_depth }, .{ half_width, half_height, -half_depth }, .{ half_width, half_height, half_depth }, .{ half_width, -half_height, half_depth } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 12, fixture.groups, null);
    defer mesh.deinit();

    // Pick the -Z wall face and add two vertical loops.
    var first_selected = [_]bool{false} ** 12;
    first_selected[4] = true;
    first_selected[5] = true;
    try std.testing.expect(try mesh.loopCut(first_selected[0..], 1, 2, 0.5));
    try std.testing.expectEqual(@as(usize, 14), mesh.faces.items.len);

    // A committed edit re-lowers the mesh before the next face pick. Re-adopt
    // those source-triangle ids exactly as the host session does, then choose a
    // front panel's vertical edge for the perpendicular pair.
    var first_lowered = try mesh.lower();
    defer first_lowered.deinit();
    mesh.adoptLoweredMetadata(&first_lowered, first_lowered.groups, null);
    const second_selected = try allocator.alloc(bool, first_lowered.tri_count);
    defer allocator.free(second_selected);
    @memset(second_selected, false);
    var second_direction: u32 = 0;
    var found_front_panel = false;
    for (mesh.faces.items) |*face| {
        if (!face.alive) continue;
        const normal = Mesh.faceNormal(&mesh, face);
        if (normal[2] > -0.99) continue;
        for (face.vertices.items, 0..) |vertex_id, edge_index| {
            const next_id = face.vertices.items[(edge_index + 1) % face.vertices.items.len];
            const a = mesh.vertices.items[vertex_id].position;
            const b = mesh.vertices.items[next_id].position;
            if (@abs(b[1] - a[1]) > 2.9) {
                second_direction = @intCast(edge_index);
                found_front_panel = true;
                break;
            }
        }
        if (!found_front_panel) continue;
        for (face.source_triangles.items) |triangle| second_selected[triangle] = true;
        break;
    }
    try std.testing.expect(found_front_panel);
    try std.testing.expect(try mesh.loopCut(second_selected, second_direction, 2, 0.5));

    // A 3x3 grid on front/back plus three strips on each remaining side is 30
    // quads. Only x=+-0.5 and y=+-0.5 are new planes: no hidden fifth plane and
    // no local diagonal promoted into the editable boundary graph.
    try std.testing.expectEqual(@as(usize, 30), mesh.faces.items.len);
    var saw_x_negative = false;
    var saw_x_positive = false;
    var saw_y_negative = false;
    var saw_y_positive = false;
    for (mesh.vertices.items) |vertex| {
        const x = vertex.position[0];
        const y = vertex.position[1];
        if (@abs(x + 0.5) < 1e-5) saw_x_negative = true else if (@abs(x - 0.5) < 1e-5) saw_x_positive = true else try std.testing.expect(@abs(@abs(x) - half_width) < 1e-5);
        if (@abs(y + 0.5) < 1e-5) saw_y_negative = true else if (@abs(y - 0.5) < 1e-5) saw_y_positive = true else try std.testing.expect(@abs(@abs(y) - half_height) < 1e-5);
    }
    try std.testing.expect(saw_x_negative and saw_x_positive and saw_y_negative and saw_y_positive);
    var final_lowered = try mesh.lower();
    defer final_lowered.deinit();
    try std.testing.expectEqual(@as(u32, 60), final_lowered.tri_count);
}

test "offset preview reuses topology and only recomputes cut vertices" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var source_corner: usize = 0;
    while (source_corner < fixture.verts.len / 8) : (source_corner += 1) {
        fixture.verts[source_corner * 8 + 6] = fixture.verts[source_corner * 8 + 0];
        fixture.verts[source_corner * 8 + 7] = fixture.verts[source_corner * 8 + 1];
    }
    const selected = [_]bool{ true, true };

    var reused = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer reused.deinit();
    try std.testing.expect(try reused.loopCut(selected[0..], 0, 2, 0.25));
    reused.repositionCutVertices(2, 0.75);

    var fresh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer fresh.deinit();
    try std.testing.expect(try fresh.loopCut(selected[0..], 0, 2, 0.75));
    try std.testing.expectEqual(fresh.faces.items.len, reused.faces.items.len);
    try std.testing.expectEqual(fresh.vertices.items.len, reused.vertices.items.len);
    for (fresh.faces.items, reused.faces.items) |fresh_face, reused_face| {
        try std.testing.expectEqualSlices(u32, fresh_face.vertices.items, reused_face.vertices.items);
        try std.testing.expectEqual(fresh_face.uvs.items.len, reused_face.uvs.items.len);
        for (fresh_face.uvs.items, reused_face.uvs.items) |fresh_uv, reused_uv| {
            try std.testing.expectApproxEqAbs(fresh_uv[0], reused_uv[0], 1e-6);
            try std.testing.expectApproxEqAbs(fresh_uv[1], reused_uv[1], 1e-6);
        }
    }
    for (fresh.vertices.items, reused.vertices.items) |fresh_vertex, reused_vertex| {
        for (0..3) |axis| try std.testing.expectApproxEqAbs(fresh_vertex.position[axis], reused_vertex.position[axis], 1e-6);
    }
}

test "reference selected shared edge overrides the direction slider" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{
        .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
        .{ .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1, 1, 0 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true, true, true };
    try std.testing.expect(try mesh.loopCut(selected[0..], 0, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 8), lowered.tri_count);
}

test "position mutations update stable ids through the deterministic lowering" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    const original_face_ids = [_]u32{mesh.faces.items[0].id};
    var moved = try allocator.dupe(f32, fixture.verts);
    defer allocator.free(moved);
    var vertex: usize = 0;
    while (vertex < 6) : (vertex += 1) moved[vertex * 8] += 3;
    try std.testing.expect(mesh.updatePositionsFromInterleaved(moved, 2));
    try std.testing.expectEqualSlices(u32, original_face_ids[0..], &.{mesh.faces.items[0].id});
    for (mesh.vertices.items) |stable_vertex| try std.testing.expect(stable_vertex.position[0] >= 3);
}

test "first rigid gizmo move preserves an imported quad's original diagonal map" {
    const allocator = std.testing.allocator;
    const v = [4]Vec3{ .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 0, 1, 0 } };
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    // Imported resident soup uses diagonal 1–3. Deterministic lowering of this
    // rectangle chooses 0–2, so deriving the resident corner map from lower() would
    // assign the transformed corners to the wrong stable ids.
    try appendSoupTri(&soup, allocator, v[0], v[1], v[3]);
    try appendSoupTri(&soup, allocator, v[1], v[2], v[3]);
    const groups = [_]u32{ 0, 0 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 2, groups[0..], null);
    defer mesh.deinit();
    var before = try mesh.clone();
    defer before.deinit();
    var rotated = try allocator.dupe(f32, soup.items);
    defer allocator.free(rotated);
    var corner: usize = 0;
    while (corner < 6) : (corner += 1) {
        const base = corner * 8;
        const x = rotated[base];
        const y = rotated[base + 1];
        rotated[base] = 4 - y;
        rotated[base + 1] = -3 + x;
        rotated[base + 2] += 2;
    }
    try std.testing.expect(mesh.updatePositionsFromInterleaved(rotated, 2));
    for (before.vertices.items, mesh.vertices.items) |old, current| {
        const expected = Vec3{ 4 - old.position[1], -3 + old.position[0], old.position[2] + 2 };
        for (0..3) |axis| try std.testing.expectApproxEqAbs(expected[axis], current.position[axis], 1e-6);
    }
    var bad = std.ArrayListUnmanaged(u32).empty;
    defer bad.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 0), mesh.newlyConcaveComparedTo(&before, &bad));
}

test "indexed symmetrize cuts authored faces without a fan-diagonal T vertex" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ -2, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ -2, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    try std.testing.expect(try mesh.symmetrize(0, 0, true));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 4), lowered.tri_count);
    var seam_vertices: u32 = 0;
    for (mesh.vertices.items) |vertex| if (vertex.position[0] == 0) {
        seam_vertices += 1;
    };
    try std.testing.expectEqual(@as(u32, 2), seam_vertices);
}

test "part symmetrize cannot cut or reflect an unfocused outliner part" {
    const allocator = std.testing.allocator;
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    const focused = [4]Vec3{
        .{ -1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ -1, 1, 0 },
    };
    const untouched = [4]Vec3{
        .{ 10, 3, 0 }, .{ 12, 3, 0 }, .{ 12, 5, 0 }, .{ 10, 5, 0 },
    };
    try appendSoupTri(&soup, allocator, focused[0], focused[1], focused[2]);
    try appendSoupTri(&soup, allocator, focused[0], focused[2], focused[3]);
    try appendSoupTri(&soup, allocator, untouched[0], untouched[1], untouched[2]);
    try appendSoupTri(&soup, allocator, untouched[0], untouched[2], untouched[3]);
    const groups = [_]u32{ 0, 0, 1, 1 };
    const parts = [_]u32{ 0, 0, 1, 1 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 4, groups[0..], parts[0..]);
    defer mesh.deinit();

    const untouched_face = try mesh.faces.items[1].clone(allocator);
    defer {
        var copy = untouched_face;
        copy.deinit(allocator);
    }
    var untouched_positions: [4]Vec3 = undefined;
    for (untouched_face.vertices.items, 0..) |vertex_id, corner| {
        untouched_positions[corner] = mesh.vertices.items[vertex_id].position;
    }

    try std.testing.expect(try mesh.symmetrizeParts(0, true, &.{ true, false }));
    try std.testing.expect(mesh.faces.items[1].alive);
    try std.testing.expectEqualSlices(u32, untouched_face.vertices.items, mesh.faces.items[1].vertices.items);
    try std.testing.expectEqual(untouched_face.diagonal, mesh.faces.items[1].diagonal);
    for (mesh.faces.items[1].vertices.items, 0..) |vertex_id, corner| {
        try std.testing.expectEqual(untouched_positions[corner], mesh.vertices.items[vertex_id].position);
    }
    var untouched_faces: u32 = 0;
    for (mesh.faces.items) |face| {
        if (face.alive and face.part == 1) untouched_faces += 1;
    }
    try std.testing.expectEqual(@as(u32, 1), untouched_faces);
}

test "equal-length non-planar mirror quads carry the same physical diagonal" {
    const allocator = std.testing.allocator;
    const v = [4]Vec3{
        .{ 1, -1, -1 },
        .{ 2, -1, 1 },
        .{ 1, 1, 1 },
        .{ 2, 1, -1 },
    };
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    try appendSoupTri(&soup, allocator, v[0], v[1], v[2]);
    try appendSoupTri(&soup, allocator, v[0], v[2], v[3]);
    const groups = [_]u32{ 0, 0 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 2, groups[0..], null);
    defer mesh.deinit();
    try std.testing.expect(mesh.faces.items[0].diagonal != null);
    try std.testing.expect(try mesh.symmetrize(0, 0, true));
    try std.testing.expectEqual(@as(usize, 2), mesh.faces.items.len);

    const kept_diagonal = mesh.faces.items[0].diagonal.?;
    const twin_diagonal = mesh.faces.items[1].diagonal.?;
    var reflected = [2]Vec3{
        mesh.vertices.items[kept_diagonal[0]].position,
        mesh.vertices.items[kept_diagonal[1]].position,
    };
    reflected[0][0] = -reflected[0][0];
    reflected[1][0] = -reflected[1][0];
    const twin = [2]Vec3{
        mesh.vertices.items[twin_diagonal[0]].position,
        mesh.vertices.items[twin_diagonal[1]].position,
    };
    const direct = distanceSquared(reflected[0], twin[0]) < 1e-10 and distanceSquared(reflected[1], twin[1]) < 1e-10;
    const swapped = distanceSquared(reflected[0], twin[1]) < 1e-10 and distanceSquared(reflected[1], twin[0]) < 1e-10;
    try std.testing.expect(direct or swapped);

    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 4), lowered.tri_count);
}

test "live mirror synchronizes opposite imported quad diagonals by stable ids" {
    const allocator = std.testing.allocator;
    const right = [4]Vec3{
        .{ 1, -1, -1 },
        .{ 2, -1, 1 },
        .{ 1, 1, 1 },
        .{ 2, 1, -1 },
    };
    const left = [4]Vec3{
        .{ -right[0][0], right[0][1], right[0][2] },
        .{ -right[3][0], right[3][1], right[3][2] },
        .{ -right[2][0], right[2][1], right[2][2] },
        .{ -right[1][0], right[1][1], right[1][2] },
    };
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    // Right uses physical diagonal 0-2.
    try appendSoupTri(&soup, allocator, right[0], right[1], right[2]);
    try appendSoupTri(&soup, allocator, right[0], right[2], right[3]);
    // Its reverse-wound left twin deliberately imports the OTHER diagonal 1-3.
    try appendSoupTri(&soup, allocator, left[1], left[2], left[3]);
    try appendSoupTri(&soup, allocator, left[1], left[3], left[0]);
    const groups = [_]u32{ 0, 0, 1, 1 };
    const parts = [_]u32{ 0, 0, 0, 0 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 4, groups[0..], parts[0..]);
    defer mesh.deinit();
    try std.testing.expectEqual(@as(usize, 2), mesh.faces.items.len);

    const before_right = mesh.faces.items[0].diagonal.?;
    const before_left = mesh.faces.items[1].diagonal.?;
    var before_reflected = [2]Vec3{
        mesh.vertices.items[before_right[0]].position,
        mesh.vertices.items[before_right[1]].position,
    };
    before_reflected[0][0] = -before_reflected[0][0];
    before_reflected[1][0] = -before_reflected[1][0];
    const before_left_positions = [2]Vec3{
        mesh.vertices.items[before_left[0]].position,
        mesh.vertices.items[before_left[1]].position,
    };
    const before_direct = samePoint(before_reflected[0], before_left_positions[0]) and samePoint(before_reflected[1], before_left_positions[1]);
    const before_swapped = samePoint(before_reflected[0], before_left_positions[1]) and samePoint(before_reflected[1], before_left_positions[0]);
    try std.testing.expect(!before_direct and !before_swapped);

    try std.testing.expectEqual(@as(u32, 1), try mesh.synchronizeMirrorDiagonals(1));
    try std.testing.expectEqual(@as(u32, 0), try mesh.synchronizeMirrorDiagonals(1));
    const after_left = mesh.faces.items[1].diagonal.?;
    const after_left_positions = [2]Vec3{
        mesh.vertices.items[after_left[0]].position,
        mesh.vertices.items[after_left[1]].position,
    };
    const after_direct = samePoint(before_reflected[0], after_left_positions[0]) and samePoint(before_reflected[1], after_left_positions[1]);
    const after_swapped = samePoint(before_reflected[0], after_left_positions[1]) and samePoint(before_reflected[1], after_left_positions[0]);
    try std.testing.expect(after_direct or after_swapped);
}

test "edge loop cut cannot cross a coincident outliner part" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{
        .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
        .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    const parts = [_]u32{ 0, 0, 1, 1 };
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, parts[0..]);
    defer mesh.deinit();
    try std.testing.expect(try mesh.loopCutFromEdge(.{ 0, 0, 0 }, .{ 1, 0, 0 }, 0, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 6), lowered.tri_count);
    var part_one_triangles: u32 = 0;
    for (lowered.parts) |part| if (part == 1) {
        part_one_triangles += 1;
    };
    try std.testing.expectEqual(@as(u32, 2), part_one_triangles);
}

test "cube loop cut cannot mutate a sibling concave path face" {
    const allocator = std.testing.allocator;
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    var groups = std.ArrayListUnmanaged(u32).empty;
    defer groups.deinit(allocator);
    var parts = std.ArrayListUnmanaged(u32).empty;
    defer parts.deinit(allocator);

    // The Path Plane primitive is one authored concave n-gon lowered to a fan of
    // render triangles. It is deliberately not a quad ring and must stay inert
    // when a different outliner part is loop-cut.
    const path = [6]Vec3{
        .{ 0, 0, 0 }, .{ 4, 0, 0 }, .{ 4, 1, 0 },
        .{ 2, 1, 0 }, .{ 2, 3, 0 }, .{ 0, 3, 0 },
    };
    const path_tris = [_][3]u32{
        .{ 0, 1, 2 }, .{ 0, 2, 3 }, .{ 0, 3, 4 }, .{ 0, 4, 5 },
    };
    for (path_tris) |triangle| {
        try appendSoupTri(&soup, allocator, path[triangle[0]], path[triangle[1]], path[triangle[2]]);
        try groups.append(allocator, 0);
        try parts.append(allocator, 0);
    }

    const cube = [8]Vec3{
        .{ 10, 0, 0 }, .{ 12, 0, 0 }, .{ 12, 2, 0 }, .{ 10, 2, 0 },
        .{ 10, 0, 2 }, .{ 12, 0, 2 }, .{ 12, 2, 2 }, .{ 10, 2, 2 },
    };
    const cube_quads = [_][4]u32{
        .{ 0, 1, 2, 3 }, .{ 5, 4, 7, 6 }, .{ 4, 0, 3, 7 },
        .{ 1, 5, 6, 2 }, .{ 4, 5, 1, 0 }, .{ 3, 2, 6, 7 },
    };
    for (cube_quads, 0..) |quad, face_index| {
        try appendSoupTri(&soup, allocator, cube[quad[0]], cube[quad[1]], cube[quad[2]]);
        try appendSoupTri(&soup, allocator, cube[quad[0]], cube[quad[2]], cube[quad[3]]);
        try groups.append(allocator, @intCast(face_index + 1));
        try groups.append(allocator, @intCast(face_index + 1));
        try parts.append(allocator, 1);
        try parts.append(allocator, 1);
    }

    const triangle_count: u32 = @intCast(groups.items.len);
    var mesh = try Mesh.fromSoup(allocator, soup.items, triangle_count, groups.items, parts.items);
    defer mesh.deinit();
    try std.testing.expectEqual(@as(usize, 7), mesh.faces.items.len);
    try std.testing.expectEqual(@as(usize, 6), mesh.faces.items[0].vertices.items.len);

    const path_vertex_ids = try allocator.dupe(u32, mesh.faces.items[0].vertices.items);
    defer allocator.free(path_vertex_ids);
    const path_positions = try allocator.alloc(Vec3, path_vertex_ids.len);
    defer allocator.free(path_positions);
    for (path_vertex_ids, 0..) |vertex_id, index| path_positions[index] = mesh.vertices.items[vertex_id].position;

    const selected = try allocator.alloc(bool, triangle_count);
    defer allocator.free(selected);
    @memset(selected, false);
    @memset(selected[0..path_tris.len], true);
    try std.testing.expect(!(try mesh.loopCut(selected, 0, 1, 0.5)));
    try std.testing.expectEqualSlices(u32, path_vertex_ids, mesh.faces.items[0].vertices.items);

    @memset(selected, false);
    selected[path_tris.len] = true;
    selected[path_tris.len + 1] = true;
    try std.testing.expect(try mesh.loopCut(selected, 0, 1, 0.5));

    try std.testing.expect(mesh.faces.items[0].alive);
    try std.testing.expectEqual(@as(u32, 0), mesh.faces.items[0].part);
    try std.testing.expectEqualSlices(u32, path_vertex_ids, mesh.faces.items[0].vertices.items);
    for (path_vertex_ids, 0..) |vertex_id, index| {
        try std.testing.expectEqual(path_positions[index], mesh.vertices.items[vertex_id].position);
    }
    var lowered = try mesh.lower();
    defer lowered.deinit();
    var path_triangles: u32 = 0;
    for (lowered.parts, lowered.groups) |part, group| {
        if (part == 0) {
            path_triangles += 1;
            try std.testing.expectEqual(@as(u32, 0), group);
        }
    }
    try std.testing.expectEqual(@as(u32, 4), path_triangles);
}

test "import weld joins real adjacency across a quantization cell boundary" {
    const allocator = std.testing.allocator;
    const drift: f32 = 0.0005;
    const quads = [_][4]Vec3{
        .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
        .{ .{ 1 - drift, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1 - drift, 1, 0 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true, false, false };
    try std.testing.expect(try mesh.loopCut(selected[0..], 1, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 8), lowered.tri_count);
}

test "concave guard compares ordered indexed face loops" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    var before = try mesh.clone();
    defer before.deinit();
    const buckled_id = mesh.faces.items[0].vertices.items[2];
    mesh.vertices.items[buckled_id].position = .{ 0.2, 0.2, 0 };
    var bad = std.ArrayListUnmanaged(u32).empty;
    defer bad.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 1), mesh.newlyConcaveComparedTo(&before, &bad));
    try std.testing.expectEqualSlices(u32, &.{0}, bad.items);
    var already_bad = try mesh.clone();
    defer already_bad.deinit();
    bad.clearRetainingCapacity();
    try std.testing.expectEqual(@as(u32, 0), mesh.newlyConcaveComparedTo(&already_bad, &bad));
}
