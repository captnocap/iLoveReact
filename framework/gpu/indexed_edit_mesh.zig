//! Indexed edit-mode mesh topology.
//!
//! Rendering still consumes non-indexed triangles. Editing does not: vertices have
//! stable numeric identities and faces own ordered vertex-id loops plus per-corner
//! UVs. Position tolerance is used exactly once, while importing a triangle soup;
//! every operation after that resolves adjacency by ids.

const std = @import("std");
const mesh_semantics = @import("mesh_semantics.zig");

pub const NO_GROUP: u32 = std.math.maxInt(u32);
pub const NO_PART: u32 = std.math.maxInt(u32);
pub const NO_MATERIAL: u32 = std.math.maxInt(u32);
pub const NO_SEMANTIC_ID: u32 = mesh_semantics.NO_ID;
const IMPORT_WELD_SCALE: f32 = 1024.0;
/// Public because it is a durability contract, not just an import knob: any two
/// vertices closer than this MERGE on the next soup→indexed rebuild, so an edit
/// that mints geometry inside this distance is writing topology that cannot
/// survive its own save/load cycle (req_3435 — loop cuts at a clamped offset).
pub const IMPORT_WELD_EPS: f32 = 1.0 / IMPORT_WELD_SCALE;
const MIRROR_MATCH_SCALE: f32 = 1000.0;
// Merge Faces is a planar dissolve, not a general polygon stitch. A permissive
// normal gate can turn a bent perimeter into a fan whose diagonals cut through the
// model even when its output triangle count happens to match the input.
const MERGE_FACE_NORMAL_DOT_MIN: f32 = 0.9999;
const MERGE_FACE_PLANE_ABS_EPS: f32 = IMPORT_WELD_EPS * 2.0;
const MERGE_FACE_PLANE_REL_EPS: f32 = 0.00001;

pub const Vec2 = [2]f32;
pub const Vec3 = [3]f32;

/// One source of truth for choosing between competing triangle pairings.
/// Cardinality is always maximized first. These values only order the augmenting
/// paths inside that exact maximum, giving the preview popup three useful,
/// deterministic evaluations without changing how many quads are recovered.
const QuadifyTuning = struct {
    const diagonal_balance_weight: f32 = 0.50;
    const opposite_edge_balance_weight: f32 = 0.30;
    const corner_quality_weight: f32 = 0.20;
    const score_tie_epsilon: f32 = 0.000001;
    const boundary_corner_epsilon: f32 = 0.00001;
};

pub const QuadEvaluation = enum(u8) {
    balanced = 0,
    short_seams = 1,
    alternate_flow = 2,

    pub const count: u32 = 3;

    pub fn fromIndex(index: u32) QuadEvaluation {
        return @enumFromInt(index % count);
    }
};

pub const QuadifyStats = struct {
    authored_faces_before: u32 = 0,
    authored_faces_after: u32 = 0,
    triangle_faces: u32 = 0,
    candidate_pairs: u32 = 0,
    ambiguous_triangles: u32 = 0,
    quads: u32 = 0,
    plan_signature: u32 = 2166136261,
};

const QuadPair = struct {
    first_face: u32,
    second_face: u32,
    diagonal: [2]u32,
};

/// What a face fusion actually produced. `retessellated` is the dissolve signal
/// (req_3771): the fused boundary dropped corners the recorded resident rows still
/// reference (interior grid verts, collinear cut-seam verts), and the loop is CONVEX,
/// so the face was marked for a fresh loop tessellation — the only way the dead verts
/// actually leave the mesh. Concave fusions always stay byte-stable instead: a naive
/// re-fan of a concave perimeter reverses render triangles (the bookshelf-side bug),
/// so their recorded rows are kept even when the clean boundary dropped corners.
pub const MergedFace = struct {
    face_id: u32,
    retessellated: bool,
};

const QuadCandidate = struct {
    pair: QuadPair,
    score: f32,
    diagonal_length: f32,
};

const QuadFaceEdge = struct {
    key: u64,
    face: u32,
};

/// Edmonds' blossom search over the sparse triangle-adjacency graph. Every face
/// can belong to at most one result, and every augmenting path increases the
/// result by one, so the final pairing is maximum-cardinality rather than a
/// locally-good greedy packing. Candidate order only chooses WHICH maximum the
/// user previews.
const MaximumQuadMatcher = struct {
    allocator: std.mem.Allocator,
    candidates: []const QuadCandidate,
    adjacency: []const std.ArrayListUnmanaged(u32),
    mate: []i32,
    parent: []i32,
    base: []u32,
    used: []bool,
    blossom: []bool,
    lca_seen: []bool,
    queue: []u32,
    queue_head: usize = 0,
    queue_tail: usize = 0,

    fn init(
        allocator: std.mem.Allocator,
        candidates: []const QuadCandidate,
        adjacency: []const std.ArrayListUnmanaged(u32),
    ) !MaximumQuadMatcher {
        const count = adjacency.len;
        const mate = try allocator.alloc(i32, count);
        errdefer allocator.free(mate);
        const parent = try allocator.alloc(i32, count);
        errdefer allocator.free(parent);
        const base = try allocator.alloc(u32, count);
        errdefer allocator.free(base);
        const used = try allocator.alloc(bool, count);
        errdefer allocator.free(used);
        const blossom = try allocator.alloc(bool, count);
        errdefer allocator.free(blossom);
        const lca_seen = try allocator.alloc(bool, count);
        errdefer allocator.free(lca_seen);
        const queue = try allocator.alloc(u32, count);
        @memset(mate, -1);
        return .{
            .allocator = allocator,
            .candidates = candidates,
            .adjacency = adjacency,
            .mate = mate,
            .parent = parent,
            .base = base,
            .used = used,
            .blossom = blossom,
            .lca_seen = lca_seen,
            .queue = queue,
        };
    }

    fn deinit(matcher: *MaximumQuadMatcher) void {
        matcher.allocator.free(matcher.mate);
        matcher.allocator.free(matcher.parent);
        matcher.allocator.free(matcher.base);
        matcher.allocator.free(matcher.used);
        matcher.allocator.free(matcher.blossom);
        matcher.allocator.free(matcher.lca_seen);
        matcher.allocator.free(matcher.queue);
        matcher.* = undefined;
    }

    fn other(matcher: *const MaximumQuadMatcher, candidate_index: u32, face: u32) u32 {
        const pair = matcher.candidates[candidate_index].pair;
        return if (pair.first_face == face) pair.second_face else pair.first_face;
    }

    fn leastCommonAncestor(matcher: *MaximumQuadMatcher, first_raw: u32, second_raw: u32) u32 {
        @memset(matcher.lca_seen, false);
        var first = first_raw;
        while (true) {
            first = matcher.base[first];
            matcher.lca_seen[first] = true;
            const first_mate = matcher.mate[first];
            if (first_mate < 0) break;
            const next = matcher.parent[@intCast(first_mate)];
            if (next < 0) break;
            first = @intCast(next);
        }
        var second = second_raw;
        while (true) {
            second = matcher.base[second];
            if (matcher.lca_seen[second]) return second;
            const second_mate = matcher.mate[second];
            if (second_mate < 0) return second;
            const next = matcher.parent[@intCast(second_mate)];
            if (next < 0) return second;
            second = @intCast(next);
        }
    }

    fn markBlossomPath(matcher: *MaximumQuadMatcher, start_raw: u32, root_base: u32, child_raw: u32) void {
        var start = start_raw;
        var child = child_raw;
        while (matcher.base[start] != root_base) {
            const start_mate_i = matcher.mate[start];
            if (start_mate_i < 0) break;
            const start_mate: u32 = @intCast(start_mate_i);
            matcher.blossom[matcher.base[start]] = true;
            matcher.blossom[matcher.base[start_mate]] = true;
            matcher.parent[start] = @intCast(child);
            child = start_mate;
            const next = matcher.parent[start_mate];
            if (next < 0) break;
            start = @intCast(next);
        }
    }

    fn augmentFrom(matcher: *MaximumQuadMatcher, finish_raw: u32) void {
        var finish: i32 = @intCast(finish_raw);
        while (finish >= 0) {
            const previous = matcher.parent[@intCast(finish)];
            const next = if (previous >= 0) matcher.mate[@intCast(previous)] else -1;
            matcher.mate[@intCast(finish)] = previous;
            if (previous >= 0) matcher.mate[@intCast(previous)] = finish;
            finish = next;
        }
    }

    fn findAugmentingPath(matcher: *MaximumQuadMatcher, root: u32) bool {
        @memset(matcher.used, false);
        @memset(matcher.parent, -1);
        for (matcher.base, 0..) |*slot, index| slot.* = @intCast(index);
        matcher.queue_head = 0;
        matcher.queue_tail = 0;
        matcher.queue[matcher.queue_tail] = root;
        matcher.queue_tail += 1;
        matcher.used[root] = true;

        while (matcher.queue_head < matcher.queue_tail) {
            const face = matcher.queue[matcher.queue_head];
            matcher.queue_head += 1;
            for (matcher.adjacency[face].items) |candidate_index| {
                const neighbor = matcher.other(candidate_index, face);
                if (matcher.base[face] == matcher.base[neighbor] or
                    matcher.mate[face] == @as(i32, @intCast(neighbor)))
                {
                    continue;
                }
                const neighbor_mate = matcher.mate[neighbor];
                if (neighbor == root or
                    (neighbor_mate >= 0 and matcher.parent[@intCast(neighbor_mate)] >= 0))
                {
                    const common = matcher.leastCommonAncestor(face, neighbor);
                    @memset(matcher.blossom, false);
                    matcher.markBlossomPath(face, common, neighbor);
                    matcher.markBlossomPath(neighbor, common, face);
                    for (matcher.base, 0..) |*slot, index| {
                        if (!matcher.blossom[slot.*]) continue;
                        slot.* = common;
                        if (!matcher.used[index]) {
                            matcher.used[index] = true;
                            matcher.queue[matcher.queue_tail] = @intCast(index);
                            matcher.queue_tail += 1;
                        }
                    }
                } else if (matcher.parent[neighbor] < 0) {
                    matcher.parent[neighbor] = @intCast(face);
                    if (neighbor_mate < 0) {
                        matcher.augmentFrom(neighbor);
                        return true;
                    }
                    const matched_neighbor: u32 = @intCast(neighbor_mate);
                    if (!matcher.used[matched_neighbor]) {
                        matcher.used[matched_neighbor] = true;
                        matcher.queue[matcher.queue_tail] = matched_neighbor;
                        matcher.queue_tail += 1;
                    }
                }
            }
        }
        return false;
    }

    fn solve(matcher: *MaximumQuadMatcher, pairs: *std.ArrayListUnmanaged(QuadPair)) !void {
        for (matcher.adjacency, 0..) |edges, face| {
            if (edges.items.len == 0 or matcher.mate[face] >= 0) continue;
            _ = matcher.findAugmentingPath(@intCast(face));
        }
        for (matcher.mate, 0..) |mate_i, face| {
            if (mate_i < 0) continue;
            const mate: u32 = @intCast(mate_i);
            if (face >= mate) continue;
            for (matcher.adjacency[face].items) |candidate_index| {
                const candidate = matcher.candidates[candidate_index];
                if (matcher.other(candidate_index, @intCast(face)) != mate) continue;
                try pairs.append(matcher.allocator, candidate.pair);
                break;
            }
        }
    }
};

/// One source of truth for the Studio bevel's behavior-affecting dimensions.
/// Geometry is stored in metres; the popup presents these as modeling units
/// (16 u = 1 m) without owning a second set of limits.
pub const BevelTuning = struct {
    pub const default_width_m: f32 = 2.0 / 16.0;
    pub const minimum_width_m: f32 = 0.1 / 16.0;
    pub const vertex_edge_fraction: f32 = 0.45;
    pub const edge_reach_fraction: f32 = 0.9;
    pub const coplanar_normal_dot: f32 = 0.999;
};

/// One selected open boundary loop is chamfered as a unit: every old corner
/// receives one new boundary edge and every old boundary edge keeps a positive
/// middle span. That changes any N-sided opening into a clean 2N-sided opening;
/// these limits are shared by the popup preview and headless callers.
pub const BoundaryChamferTuning = struct {
    pub const minimum_sides: usize = 3;
    pub const default_width_m: f32 = BevelTuning.default_width_m;
    pub const minimum_width_m: f32 = BevelTuning.minimum_width_m;
    pub const edge_fraction: f32 = 0.45;
};

pub const BoundaryChamferSelection = struct {
    sides_before: u32,
    sides_after: u32,
    max_width: f32,
};

pub const BevelKind = enum { vertex, edge };
pub const BevelTarget = union(BevelKind) {
    vertex: u32,
    edge: [2]u32,
};
pub const BevelSelection = struct {
    target: BevelTarget,
    max_width: f32,
};

const MirrorPositionKey = struct { part: u32, x: i32, y: i32, z: i32 };
/// Sentinel part id for any-part position lookups — never a real part index.
const MIRROR_ANY_PART: u32 = std.math.maxInt(u32);
// Quad identity is its sorted vertex ids — those are already mesh-global, so twin
// quads resolve across outliner parts too.
const MirrorQuadKey = struct { a: u32, b: u32, c: u32, d: u32 };

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
    /// Meaning survives topology changes independently from authored group ids.
    semantic: mesh_semantics.Face = .{},
    /// True while `source_triangles` still names the exact resident render
    /// tessellation for this authored face. Authored grouping (Merge Faces) may
    /// change without changing those triangles; geometric edits invalidate the
    /// mapping until their newly lowered soup is adopted.
    source_tessellation_valid: bool = false,
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
            .semantic = face.semantic,
            .source_tessellation_valid = face.source_tessellation_valid,
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
    semantic_regions: []u32,
    semantic_instances: []u32,
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
        lowered.allocator.free(lowered.semantic_regions);
        lowered.allocator.free(lowered.semantic_instances);
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
    /// Exact per-corner UVs paired with `render_triangles`. Authored n-gons may be
    /// concave and their source triangles may sample independent atlas pins, so a
    /// polygon fan cannot reconstruct this state.
    render_uvs: std.ArrayListUnmanaged([3]Vec2) = .empty,
    next_group: u32 = 0,

    pub fn deinit(mesh: *Mesh) void {
        for (mesh.faces.items) |*face| face.deinit(mesh.allocator);
        mesh.faces.deinit(mesh.allocator);
        mesh.vertices.deinit(mesh.allocator);
        mesh.render_triangles.deinit(mesh.allocator);
        mesh.render_uvs.deinit(mesh.allocator);
        mesh.* = undefined;
    }

    pub fn clone(mesh: *const Mesh) !Mesh {
        var out = Mesh{ .allocator = mesh.allocator, .next_group = mesh.next_group };
        errdefer out.deinit();
        try out.vertices.appendSlice(mesh.allocator, mesh.vertices.items);
        try out.render_triangles.appendSlice(mesh.allocator, mesh.render_triangles.items);
        try out.render_uvs.appendSlice(mesh.allocator, mesh.render_uvs.items);
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
        return mesh.residentMetadataMatchesWithSemantics(tri_count, groups, parts, materials, null, null);
    }

    pub fn residentMetadataMatchesWithSemantics(
        mesh: *const Mesh,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
        materials: ?[]const u32,
        semantic_regions: ?[]const u32,
        semantic_instances: ?[]const u32,
    ) bool {
        if (mesh.render_triangles.items.len != tri_count or mesh.render_uvs.items.len != tri_count) return false;
        if (groups) |rows| if (rows.len < tri_count) return false;
        if (parts) |rows| if (rows.len < tri_count) return false;
        if (materials) |rows| if (rows.len < tri_count) return false;
        if (!mesh_semantics.rowsValid(semantic_regions, semantic_instances, tri_count)) return false;

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
                const expected_semantic = mesh_semantics.Face{
                    .region = if (semantic_regions) |rows| rows[triangle] else mesh_semantics.NO_ID,
                    .instance = if (semantic_instances) |rows| rows[triangle] else mesh_semantics.NO_ID,
                };
                if (face.group != expected_group or
                    face.part != expected_part or
                    face.material != expected_material or
                    !mesh_semantics.eql(face.semantic, expected_semantic))
                {
                    return false;
                }
                seen[triangle] = true;
                seen_count += 1;
            }
        }
        return seen_count == tri_count;
    }

    /// UV editing mutates the resident interleaved soup without changing face
    /// metadata. A cached topology with old UV rows must be re-imported before the
    /// next structural edit or it would lower stale atlas coordinates over the model.
    pub fn residentUvsMatch(mesh: *const Mesh, interleaved: []const f32, tri_count: u32) bool {
        if (mesh.render_uvs.items.len != tri_count or interleaved.len < @as(usize, tri_count) * 24) return false;
        for (mesh.render_uvs.items, 0..) |triangle_uvs, triangle| {
            for (triangle_uvs, 0..) |uv, corner| {
                const base = (triangle * 3 + corner) * 8;
                if (uv[0] != interleaved[base + 6] or uv[1] != interleaved[base + 7]) return false;
            }
        }
        return true;
    }

    /// Project authored face metadata back onto the unchanged resident triangle
    /// rows. This is the inverse of `fromSoup` and is the safe commit path for
    /// topology-only edits such as Merge Faces.
    pub fn writeResidentMetadata(
        mesh: *const Mesh,
        groups: []u32,
        parts: []u32,
        materials: []u32,
    ) bool {
        const ignored_regions = mesh.allocator.alloc(u32, groups.len) catch return false;
        defer mesh.allocator.free(ignored_regions);
        const ignored_instances = mesh.allocator.alloc(u32, groups.len) catch return false;
        defer mesh.allocator.free(ignored_instances);
        return mesh.writeResidentMetadataWithSemantics(groups, parts, materials, ignored_regions, ignored_instances);
    }

    pub fn writeResidentMetadataWithSemantics(
        mesh: *const Mesh,
        groups: []u32,
        parts: []u32,
        materials: []u32,
        semantic_regions: []u32,
        semantic_instances: []u32,
    ) bool {
        const tri_count = mesh.render_triangles.items.len;
        if (mesh.render_uvs.items.len != tri_count or
            groups.len != tri_count or
            parts.len != tri_count or
            materials.len != tri_count or
            semantic_regions.len != tri_count or
            semantic_instances.len != tri_count)
        {
            return false;
        }
        const seen = mesh.allocator.alloc(bool, tri_count) catch return false;
        defer mesh.allocator.free(seen);
        @memset(seen, false);
        var seen_count: usize = 0;
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.source_triangles.items) |triangle| {
                if (triangle >= tri_count or seen[triangle]) return false;
                groups[triangle] = face.group;
                parts[triangle] = face.part;
                materials[triangle] = face.material;
                semantic_regions[triangle] = face.semantic.region;
                semantic_instances[triangle] = face.semantic.instance;
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
        semantic: mesh_semantics.Face,
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
        return fromSoupWithSemantics(allocator, interleaved, tri_count, groups, parts, materials, null, null);
    }

    pub fn fromSoupWithSemantics(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
        materials: ?[]const u32,
        semantic_regions: ?[]const u32,
        semantic_instances: ?[]const u32,
    ) !Mesh {
        if (interleaved.len < @as(usize, tri_count) * 24) return error.InvalidSoup;
        if (groups) |rows| if (rows.len < tri_count) return error.InvalidGroups;
        if (parts) |rows| if (rows.len < tri_count) return error.InvalidParts;
        if (materials) |rows| if (rows.len < tri_count) return error.InvalidMaterials;
        if (!mesh_semantics.rowsValid(semantic_regions, semantic_instances, tri_count)) return error.InvalidSemantics;

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
            try mesh.render_uvs.append(allocator, .{
                .{ interleaved[(@as(usize, triangle) * 3 + 0) * 8 + 6], interleaved[(@as(usize, triangle) * 3 + 0) * 8 + 7] },
                .{ interleaved[(@as(usize, triangle) * 3 + 1) * 8 + 6], interleaved[(@as(usize, triangle) * 3 + 1) * 8 + 7] },
                .{ interleaved[(@as(usize, triangle) * 3 + 2) * 8 + 6], interleaved[(@as(usize, triangle) * 3 + 2) * 8 + 7] },
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
                    .semantic = .{
                        .region = if (semantic_regions) |rows| rows[triangle] else mesh_semantics.NO_ID,
                        .instance = if (semantic_instances) |rows| rows[triangle] else mesh_semantics.NO_ID,
                    },
                });
            } else {
                const bucket = &buckets.items[entry.value_ptr.*];
                if (materials != null and bucket.material != materials.?[triangle]) {
                    // One authored face cannot wear two texture roles. Reject corrupt
                    // persistence at the import boundary instead of choosing a triangle.
                    return error.InconsistentFaceMaterial;
                }
                const semantic = mesh_semantics.Face{
                    .region = if (semantic_regions) |rows| rows[triangle] else mesh_semantics.NO_ID,
                    .instance = if (semantic_instances) |rows| rows[triangle] else mesh_semantics.NO_ID,
                };
                if (!mesh_semantics.eql(bucket.semantic, semantic)) return error.InconsistentFaceSemantic;
            }
            try buckets.items[entry.value_ptr.*].triangles.append(allocator, triangle);
            if (group != NO_GROUP and group >= mesh.next_group) mesh.next_group = group + 1;
        }

        for (buckets.items) |*bucket| {
            var face = try buildFaceFromBucket(allocator, interleaved, corner_vertex, bucket);
            face.id = @intCast(mesh.faces.items.len);
            try mesh.faces.append(allocator, face);
        }
        try mesh.collapseCoincidentDuplicateFaces();
        return mesh;
    }

    /// Drop exact same-winding duplicate faces at the import boundary (req_3435).
    /// A poisoned save can carry several authored faces over ONE welded vertex
    /// cycle; every loop-cut walk across such a pair multiplies it (the traversal
    /// enters the duplicate instead of the true neighbor and the copies subdivide
    /// divergently). The first face keeps the geometry and absorbs the duplicates'
    /// source triangles so whole-face selection still finds it; REVERSED cycles
    /// (back-to-back two-sided sheets) are deliberate authoring and are kept.
    fn collapseCoincidentDuplicateFaces(mesh: *Mesh) !void {
        const CycleKey = struct { part: u32, material: u32, region: u32, instance: u32, hash: u64 };
        var seen = std.AutoHashMapUnmanaged(CycleKey, u32).empty;
        defer seen.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 3) continue;
            const items = face.vertices.items;
            // rotation-normalized directed cycle: start at the smallest vertex id
            var start: usize = 0;
            for (items, 0..) |vertex_id, index| {
                if (vertex_id < items[start]) start = index;
            }
            var hash: u64 = 1469598103934665603;
            for (0..items.len) |offset| {
                const vertex_id = items[(start + offset) % items.len];
                hash = (hash ^ vertex_id) *% 1099511628211;
            }
            const entry = try seen.getOrPut(mesh.allocator, .{
                .part = face.part,
                .material = face.material,
                .region = face.semantic.region,
                .instance = face.semantic.instance,
                .hash = hash,
            });
            if (!entry.found_existing) {
                entry.value_ptr.* = face.id;
                continue;
            }
            const keeper = &mesh.faces.items[entry.value_ptr.*];
            // Hash collisions must not destroy real faces: confirm the exact cycle.
            if (keeper.vertices.items.len != items.len) continue;
            const keeper_items = keeper.vertices.items;
            var keeper_start: usize = 0;
            for (keeper_items, 0..) |vertex_id, index| {
                if (vertex_id < keeper_items[keeper_start]) keeper_start = index;
            }
            var same = true;
            for (0..items.len) |offset| {
                if (keeper_items[(keeper_start + offset) % keeper_items.len] != items[(start + offset) % items.len]) same = false;
            }
            if (!same) continue;
            try keeper.source_triangles.appendSlice(mesh.allocator, face.source_triangles.items);
            keeper.source_tessellation_valid = false;
            face.source_triangles.clearRetainingCapacity();
            face.alive = false;
        }
    }

    /// Cut vertices minted closer than the import weld tolerance to either end of
    /// their origin edge. Such a cut is invisible on screen but rewrites topology
    /// that the NEXT soup→indexed rebuild welds into degenerate faces — the
    /// loop-cut session refuses to preview or commit while any exist (req_3435).
    pub fn degenerateCutVertexCount(mesh: *const Mesh) u32 {
        var count: u32 = 0;
        for (mesh.vertices.items) |*vertex| {
            const origin = vertex.cut_origin orelse continue;
            const a = mesh.vertices.items[origin.edge[0]].position;
            const b = mesh.vertices.items[origin.edge[1]].position;
            if (distanceSquared(vertex.position, a) <= IMPORT_WELD_EPS * IMPORT_WELD_EPS or
                distanceSquared(vertex.position, b) <= IMPORT_WELD_EPS * IMPORT_WELD_EPS) count += 1;
        }
        return count;
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
        var face = Face{
            .id = 0,
            .group = bucket.group,
            .part = bucket.part,
            .material = bucket.material,
            .semantic = bucket.semantic,
            .source_tessellation_valid = true,
        };
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
        /// Basic Cut resolves one world-space orientation across every selected
        /// face. splitFace still orders an edge against each face's winding, so
        /// this vector also keeps the offset phase anchored to the seed face's
        /// world end when mirrored/rotated rings order that edge oppositely.
        basic_cut_direction: ?Vec3 = null,
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

        fn ratioForSide(context: *const CutContext, side: [2]u32, cut_no: u32) f32 {
            const ratio = cutRatio(context.cuts, context.offset_fraction, cut_no);
            const direction = context.basic_cut_direction orelse return ratio;
            const a = context.mesh.vertices.items[side[0]].position;
            const b = context.mesh.vertices.items[side[1]].position;
            // The seed edge follows its stored ring, and splitFace canonicalizes
            // it to point opposite the seed direction. Preserve that established
            // UI offset convention on every other face: a reversed/mirrored ring
            // whose canonical side points WITH the seed direction gets the
            // complementary ratio.
            return if (dot3(sub3(b, a), direction) > 0) 1.0 - ratio else ratio;
        }
    };

    pub fn repositionCutVertices(mesh: *Mesh, cuts_raw: u32, offset_fraction_raw: f32, basic_cut_direction: ?Vec3) void {
        const cuts = @max(1, cuts_raw);
        const offset_fraction = std.math.clamp(offset_fraction_raw, 0.0, 1.0);
        var cut_no: u32 = 0;
        while (cut_no < cuts) : (cut_no += 1) {
            for (mesh.vertices.items) |*vertex| {
                const origin = vertex.cut_origin orelse continue;
                if (origin.cut_no != cut_no) continue;
                const a = mesh.vertices.items[origin.edge[0]].position;
                const b = mesh.vertices.items[origin.edge[1]].position;
                var ratio = cutRatio(cuts, offset_fraction, origin.cut_no);
                if (basic_cut_direction) |direction| {
                    if (dot3(sub3(b, a), direction) > 0) ratio = 1.0 - ratio;
                }
                vertex.position = lerp3(a, b, ratio);
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
            twin.source_tessellation_valid = false;
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

    /// Composite-model symmetrize. Every requested outliner part is repaired at the
    /// SAME injected plane (the caller's symmetry authority — mesh_edit's model-origin
    /// plane in the editor). The plane is deliberately not derived from any bounds:
    /// a bounds midpoint moves with every one-sided edit, which made "mirror" cut at
    /// a plane the user never chose (req_3795). Parts absent from the mask are strict
    /// pass-through geometry: they are neither cut nor reflected.
    pub fn symmetrizeParts(mesh: *Mesh, axis: u8, center: f32, keep_positive: bool, target_parts: []const bool) !bool {
        if (axis > 2) return false;
        var changed = false;
        for (target_parts, 0..) |target, part_index| {
            if (!target) continue;
            const part: u32 = @intCast(part_index);
            changed = (try mesh.symmetrizeForPart(axis, center, keep_positive, part)) or changed;
        }
        return changed;
    }

    /// Part-scoped symmetrize about PER-PART planes (req_3886): `centers[part]`
    /// carries each targeted part's own plane, so a focused off-origin part (a
    /// detached head rest) repairs about its OWN centerline instead of reflecting
    /// across the whole model. The single-plane variant above remains the
    /// whole-model authority (req_3795); the caller decides which contract the
    /// user invoked.
    pub fn symmetrizePartsAt(mesh: *Mesh, axis: u8, centers: []const f32, keep_positive: bool, target_parts: []const bool) !bool {
        if (axis > 2) return false;
        var changed = false;
        for (target_parts, 0..) |target, part_index| {
            if (!target or part_index >= centers.len) continue;
            const part: u32 = @intCast(part_index);
            changed = (try mesh.symmetrizeForPart(axis, centers[part_index], keep_positive, part)) or changed;
        }
        return changed;
    }

    /// Receipt for mirrorReplaceSelection — every counter a zero needs to explain itself.
    pub const MirrorReplaceStats = struct {
        copied: u32 = 0, // selected faces stamped onto the other side
        replaced: u32 = 0, // twin faces deleted to make room
        welded: u32 = 0, // stamped corners welded onto surviving twin verts
        seam: u32 = 0, // near-plane corners shared with the source (the welded seam)
    };

    /// Mirror-stamp the SELECTED faces across the model-origin plane (req_3864, the
    /// user's own retopo unit generalized: "delete the triangles, then create the face
    /// in the space"). For the selection S:
    ///   1. every twin-side face ALL of whose corners lie on the reflected surface of
    ///      S is deleted — whole authored faces only, neighbours that cross the region
    ///      border survive untouched;
    ///   2. every face of S is re-created reflected (reverse-wound, quads stay quads,
    ///      diagonal choice preserved — the symmetrize clone machinery);
    ///   3. stamped corners weld: near-plane corners (≤ SEAM_EPS) SHARE the source
    ///      vertex outright, and every other corner snaps onto a surviving twin vertex
    ///      in the same quantized position class before minting a new one — the seam
    ///      and the region border come out welded, never coincident-but-separate.
    /// Faces the user did not select are never deleted and never reflected, so
    /// deliberate asymmetry survives by simply not being selected.
    pub fn mirrorReplaceSelection(mesh: *Mesh, selected_triangles: []const bool, axis: u8, center: f32) !?MirrorReplaceStats {
        if (axis > 2) return null;
        const SEAM_EPS: f32 = 0.001; // 1mm: centreline verts this close to the plane weld to the source
        var stats = MirrorReplaceStats{};

        var selected = std.ArrayListUnmanaged(u32).empty;
        defer selected.deinit(mesh.allocator);
        var selected_lookup = std.AutoHashMapUnmanaged(u32, void).empty;
        defer selected_lookup.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!faceFullySelected(face, selected_triangles)) continue;
            try selected.append(mesh.allocator, face.id);
            try selected_lookup.put(mesh.allocator, face.id, {});
        }
        if (selected.items.len == 0) return null;

        // The reflected surface of S as fan triangles with a per-triangle weld
        // tolerance: 35% of the triangle's shortest edge. A twin corner within that
        // leash of the surface is "inside the stamped space".
        const SurfaceTri = struct { a: Vec3, b: Vec3, c: Vec3, tol_sq: f32 };
        var surface = std.ArrayListUnmanaged(SurfaceTri).empty;
        defer surface.deinit(mesh.allocator);
        var region_lo = Vec3{ std.math.floatMax(f32), std.math.floatMax(f32), std.math.floatMax(f32) };
        var region_hi = Vec3{ -std.math.floatMax(f32), -std.math.floatMax(f32), -std.math.floatMax(f32) };
        var max_tol: f32 = 0;
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            const loop = face.vertices.items;
            if (loop.len < 3) continue;
            var corner: usize = 1;
            while (corner + 1 < loop.len) : (corner += 1) {
                var a = mesh.vertices.items[loop[0]].position;
                var b = mesh.vertices.items[loop[corner]].position;
                var c = mesh.vertices.items[loop[corner + 1]].position;
                a[axis] = center * 2 - a[axis];
                b[axis] = center * 2 - b[axis];
                c[axis] = center * 2 - c[axis];
                const shortest = @min(length3(sub3(b, a)), @min(length3(sub3(c, b)), length3(sub3(a, c))));
                const tol = @max(SEAM_EPS, shortest * 0.35);
                max_tol = @max(max_tol, tol);
                try surface.append(mesh.allocator, .{ .a = a, .b = b, .c = c, .tol_sq = tol * tol });
                inline for (0..3) |at| {
                    region_lo[at] = @min(region_lo[at], @min(a[at], @min(b[at], c[at])));
                    region_hi[at] = @max(region_hi[at], @max(a[at], @max(b[at], c[at])));
                }
            }
        }
        if (surface.items.len == 0) return null;
        inline for (0..3) |at| {
            region_lo[at] -= max_tol;
            region_hi[at] += max_tol;
        }

        const on_surface = struct {
            fn dist_sq(p: Vec3, a: Vec3, b: Vec3, c: Vec3) f32 {
                // Ericson closest-point-on-triangle.
                const ab = sub3(b, a);
                const ac = sub3(c, a);
                const ap = sub3(p, a);
                const d1 = dot3(ab, ap);
                const d2 = dot3(ac, ap);
                if (d1 <= 0 and d2 <= 0) return dot3(ap, ap);
                const bp = sub3(p, b);
                const d3 = dot3(ab, bp);
                const d4 = dot3(ac, bp);
                if (d3 >= 0 and d4 <= d3) return dot3(bp, bp);
                const vc = d1 * d4 - d3 * d2;
                if (vc <= 0 and d1 >= 0 and d3 <= 0) {
                    const t = d1 / (d1 - d3);
                    const q = Vec3{ a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t };
                    const pq = sub3(p, q);
                    return dot3(pq, pq);
                }
                const cp = sub3(p, c);
                const d5 = dot3(ab, cp);
                const d6 = dot3(ac, cp);
                if (d6 >= 0 and d5 <= d6) return dot3(cp, cp);
                const vb = d5 * d2 - d1 * d6;
                if (vb <= 0 and d2 >= 0 and d6 <= 0) {
                    const t = d2 / (d2 - d6);
                    const q = Vec3{ a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t };
                    const pq = sub3(p, q);
                    return dot3(pq, pq);
                }
                const va = d3 * d6 - d5 * d4;
                if (va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0) {
                    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                    const bc = sub3(c, b);
                    const q = Vec3{ b[0] + bc[0] * t, b[1] + bc[1] * t, b[2] + bc[2] * t };
                    const pq = sub3(p, q);
                    return dot3(pq, pq);
                }
                const denom = 1.0 / (va + vb + vc);
                const v = vb * denom;
                const w = vc * denom;
                const q = Vec3{
                    a[0] + ab[0] * v + ac[0] * w,
                    a[1] + ab[1] * v + ac[1] * w,
                    a[2] + ab[2] * v + ac[2] * w,
                };
                const pq = sub3(p, q);
                return dot3(pq, pq);
            }
        };
        const vert_on_surface = struct {
            fn check(tris: []const SurfaceTri, lo: Vec3, hi: Vec3, p: Vec3) bool {
                inline for (0..3) |at| {
                    if (p[at] < lo[at] or p[at] > hi[at]) return false;
                }
                for (tris) |tri| {
                    if (on_surface.dist_sq(p, tri.a, tri.b, tri.c) <= tri.tol_sq) return true;
                }
                return false;
            }
        };

        // Which side the selection lives on: deletion may only ever eat the OTHER side.
        var source_side: f32 = 0;
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            for (face.vertices.items) |vertex_id| {
                source_side += mesh.vertices.items[vertex_id].position[axis] - center;
            }
        }
        const source_sign: f32 = if (source_side >= 0) 1 else -1;

        // 1. Delete every whole twin-side face buried inside the stamped space. The
        //    selection itself is never deleted, and neither is anything on the
        //    selection's own side of the plane (a source-side sliver hugging the
        //    plane can sit within tolerance of the reflected surface).
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 3) continue;
            if (selected_lookup.contains(face.id)) continue;
            var centroid: f32 = 0;
            for (face.vertices.items) |vertex_id| {
                centroid += mesh.vertices.items[vertex_id].position[axis];
            }
            centroid = centroid / @as(f32, @floatFromInt(face.vertices.items.len)) - center;
            if (centroid * source_sign > SEAM_EPS) continue; // source side — untouchable
            var covered = true;
            for (face.vertices.items) |vertex_id| {
                if (!vert_on_surface.check(surface.items, region_lo, region_hi, mesh.vertices.items[vertex_id].position)) {
                    covered = false;
                    break;
                }
            }
            if (!covered) continue;
            face.alive = false;
            stats.replaced += 1;
        }

        // Survivor position index for border welding: every vertex still referenced by
        // a live face, keyed by the shared quantized position class.
        var survivors = std.AutoHashMapUnmanaged(MirrorPositionKey, u32).empty;
        defer survivors.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.vertices.items) |vertex_id| {
                const key = mirrorPositionKey(0, mesh.vertices.items[vertex_id].position);
                const entry = try survivors.getOrPut(mesh.allocator, key);
                if (!entry.found_existing) entry.value_ptr.* = vertex_id;
            }
        }

        // 2. Stamp the reflected copies — the symmetrize clone loop plus border welding.
        var reflected_vertices = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer reflected_vertices.deinit(mesh.allocator);
        var twin_groups = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer twin_groups.deinit(mesh.allocator);
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            if (face.vertices.items.len < 3) continue;
            var on_seam = true;
            for (face.vertices.items) |vertex_id| {
                if (@abs(mesh.vertices.items[vertex_id].position[axis] - center) > SEAM_EPS) on_seam = false;
            }
            if (on_seam) continue; // lives on the plane — it IS its own twin
            var twin = try face.clone(mesh.allocator);
            errdefer twin.deinit(mesh.allocator);
            const source_diagonal = if (face.vertices.items.len == 4)
                (face.diagonal orelse chosenQuadDiagonal(mesh, face))
            else
                null;
            var twin_vertices = std.ArrayListUnmanaged(u32).empty;
            defer twin_vertices.deinit(mesh.allocator);
            var output_corner: usize = 0;
            while (output_corner < face.vertices.items.len) : (output_corner += 1) {
                const source_corner = if (output_corner == 0) 0 else face.vertices.items.len - output_corner;
                const source_id = face.vertices.items[source_corner];
                const source_position = mesh.vertices.items[source_id].position;
                var twin_id = source_id;
                if (@abs(source_position[axis] - center) > SEAM_EPS) {
                    const entry = try reflected_vertices.getOrPut(mesh.allocator, source_id);
                    if (!entry.found_existing) {
                        var reflected = source_position;
                        reflected[axis] = center * 2 - reflected[axis];
                        // Border weld: an existing survivor in the same position class
                        // IS this corner — share its identity instead of minting a
                        // coincident-but-separate twin.
                        if (survivors.get(mirrorPositionKey(0, reflected))) |existing| {
                            entry.value_ptr.* = existing;
                            stats.welded += 1;
                        } else {
                            entry.value_ptr.* = @intCast(mesh.vertices.items.len);
                            try mesh.vertices.append(mesh.allocator, .{ .position = reflected });
                        }
                    }
                    twin_id = entry.value_ptr.*;
                } else {
                    stats.seam += 1;
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
            twin.source_tessellation_valid = false;
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
                const twin_a = if (@abs(a_position[axis] - center) <= SEAM_EPS)
                    diagonal[0]
                else
                    reflected_vertices.get(diagonal[0]) orelse return error.InvalidMirrorDiagonal;
                const twin_b = if (@abs(b_position[axis] - center) <= SEAM_EPS)
                    diagonal[1]
                else
                    reflected_vertices.get(diagonal[1]) orelse return error.InvalidMirrorDiagonal;
                twin.diagonal = .{ twin_a, twin_b };
            } else {
                twin.diagonal = null;
            }
            try mesh.faces.append(mesh.allocator, twin);
            stats.copied += 1;
        }
        if (stats.copied == 0 and stats.replaced == 0) return null;
        return stats;
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

    fn sortedQuadKey(vertices: [4]u32) MirrorQuadKey {
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
        return .{ .a = sorted[0], .b = sorted[1], .c = sorted[2], .d = sorted[3] };
    }

    fn sameUndirectedEdge(a: [2]u32, b: [2]u32) bool {
        return (a[0] == b[0] and a[1] == b[1]) or (a[0] == b[1] and a[1] == b[0]);
    }

    /// Live mirror editing changes vertex positions through a separate welded-twin
    /// table. The physical diagonal is topology too: if already-authored mirror quads
    /// retain opposite imported diagonals, identical mirrored positions fold in
    /// opposite directions as soon as the quads become non-planar. Resolve every
    /// reflected quad pair across the INJECTED plane (the caller's one symmetry
    /// authority — never a bounds midpoint) and copy one canonical physical edge
    /// across each enabled mirror subset. Reflected vertices resolve same-part first,
    /// any part otherwise, so a mirror-duplicated part synchronizes with its twin
    /// part. Position tolerance is used only to identify the existing mirror
    /// relation; the stored result is stable ids.
    pub fn synchronizeMirrorDiagonals(mesh: *Mesh, mirror_mask_raw: u8, center: Vec3) !u32 {
        const mirror_mask = mirror_mask_raw & 7;
        if (mirror_mask == 0) return 0;

        var vertices_by_position = std.AutoHashMapUnmanaged(MirrorPositionKey, u32).empty;
        defer vertices_by_position.deinit(mesh.allocator);
        var quads_by_vertices = std.AutoHashMapUnmanaged(MirrorQuadKey, u32).empty;
        defer quads_by_vertices.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.vertices.items) |vertex_id| {
                const position = mesh.vertices.items[vertex_id].position;
                try vertices_by_position.put(mesh.allocator, mirrorPositionKey(face.part, position), vertex_id);
                try vertices_by_position.put(mesh.allocator, mirrorPositionKey(MIRROR_ANY_PART, position), vertex_id);
            }
            if (face.vertices.items.len != 4) continue;
            try quads_by_vertices.put(mesh.allocator, sortedQuadKey(.{
                face.vertices.items[0],
                face.vertices.items[1],
                face.vertices.items[2],
                face.vertices.items[3],
            }), face.id);
        }
        const resolve = struct {
            fn at(map: *const std.AutoHashMapUnmanaged(MirrorPositionKey, u32), part: u32, position: Vec3) ?u32 {
                if (map.get(mirrorPositionKey(part, position))) |vertex| return vertex;
                return map.get(mirrorPositionKey(MIRROR_ANY_PART, position));
            }
        }.at;

        var changed: u32 = 0;
        var source_id: u32 = 0;
        while (source_id < mesh.faces.items.len) : (source_id += 1) {
            const source = &mesh.faces.items[source_id];
            if (!source.alive or source.vertices.items.len != 4) continue;
            var subset: u8 = 1;
            while (subset <= 7) : (subset += 1) {
                if ((subset & mirror_mask) != subset) continue;
                var reflected_vertices: [4]u32 = undefined;
                var corner: usize = 0;
                while (corner < reflected_vertices.len) : (corner += 1) {
                    const source_vertex = source.vertices.items[corner];
                    const reflected = reflectedPoint(mesh.vertices.items[source_vertex].position, subset, center);
                    reflected_vertices[corner] = resolve(&vertices_by_position, source.part, reflected) orelse break;
                }
                if (corner != reflected_vertices.len) continue;
                const twin_id = quads_by_vertices.get(sortedQuadKey(reflected_vertices)) orelse continue;
                // A pair is canonicalized once from the lower stable face id. A quad
                // reflected onto itself cannot own a mirror-invariant single diagonal;
                // changing it here would only oscillate between its two choices.
                if (twin_id <= source_id or twin_id >= mesh.faces.items.len) continue;
                const diagonal = source.diagonal orelse chosenQuadDiagonal(mesh, source);
                const reflected_diagonal = [2]u32{
                    resolve(&vertices_by_position, source.part, reflectedPoint(mesh.vertices.items[diagonal[0]].position, subset, center)) orelse continue,
                    resolve(&vertices_by_position, source.part, reflectedPoint(mesh.vertices.items[diagonal[1]].position, subset, center)) orelse continue,
                };
                const twin = &mesh.faces.items[twin_id];
                if (quadDiagonalKind(twin, reflected_diagonal) == null) continue;
                if (twin.diagonal) |existing| {
                    if (sameUndirectedEdge(existing, reflected_diagonal)) continue;
                }
                twin.diagonal = reflected_diagonal;
                twin.source_tessellation_valid = false;
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

    fn sharedTriangleDiagonal(mesh: *const Mesh, selected: []const u32) ?[2]u32 {
        if (selected.len != 2) return null;
        const first = &mesh.faces.items[selected[0]];
        const second = &mesh.faces.items[selected[1]];
        if (first.vertices.items.len != 3 or second.vertices.items.len != 3 or
            first.source_triangles.items.len != 1 or second.source_triangles.items.len != 1)
        {
            return null;
        }
        var shared: [2]u32 = undefined;
        var count: usize = 0;
        for (first.vertices.items) |vertex| {
            if (indexOf(second.vertices.items, vertex) == null) continue;
            if (count == shared.len) return null;
            shared[count] = vertex;
            count += 1;
        }
        return if (count == shared.len) shared else null;
    }

    /// Dissolve known connected coplanar faces into one ordered boundary face.
    /// Shared seams cancel by vertex-id edge keys after every edge is split at the
    /// selection vertices lying strictly inside it — a T-junction seam (one side
    /// spans in one run what the other side splits mid-way) is the same geometry
    /// and must cancel just like an exactly-shared edge (req_3800).
    fn mergeFaceIds(mesh: *Mesh, selected: []const u32, preferred_diagonal: ?[2]u32) !?MergedFace {
        return mesh.mergeFaceIdsGated(selected, preferred_diagonal, true);
    }

    fn mergeFaceIdsGated(mesh: *Mesh, selected: []const u32, preferred_diagonal: ?[2]u32, require_coplanar: bool) !?MergedFace {
        if (selected.len < 2) return null;
        if (selected[0] >= mesh.faces.items.len or !mesh.faces.items[selected[0]].alive) return null;
        const reference_part = mesh.faces.items[selected[0]].part;
        const reference_material = mesh.faces.items[selected[0]].material;
        const reference_semantic = mesh.faces.items[selected[0]].semantic;
        var semantic_conflict = false;
        var source_tessellation_valid = true;
        for (selected) |face_id| {
            if (face_id >= mesh.faces.items.len) return null;
            const face = &mesh.faces.items[face_id];
            if (!face.alive or face.part != reference_part or face.material != reference_material) return null;
            semantic_conflict = semantic_conflict or !mesh_semantics.eql(face.semantic, reference_semantic);
            source_tessellation_valid = source_tessellation_valid and face.source_tessellation_valid;
        }
        if (require_coplanar and !selectedFacesAreCoplanar(mesh, selected)) return null;

        // Every vertex the selection references: candidate T-points for edge splitting.
        var cluster = std.ArrayListUnmanaged(u32).empty;
        defer cluster.deinit(mesh.allocator);
        var cluster_seen = std.AutoHashMapUnmanaged(u32, void).empty;
        defer cluster_seen.deinit(mesh.allocator);
        for (selected) |face_id| {
            for (mesh.faces.items[face_id].vertices.items) |vertex_id| {
                const entry = try cluster_seen.getOrPut(mesh.allocator, vertex_id);
                if (!entry.found_existing) try cluster.append(mesh.allocator, vertex_id);
            }
        }

        const Directed = struct { from: u32, to: u32, uv: Vec2, key: u64 };
        var uses = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer uses.deinit(mesh.allocator);
        var directed = std.ArrayListUnmanaged(Directed).empty;
        defer directed.deinit(mesh.allocator);
        // Keys whose contributions include a T-split fragment: the spanning side has
        // no welded vertex along the overlap, so if such a seam cancels, the fused
        // interior physically contains a CRACK until a re-tessellation stitches it.
        var fragment_keys = std.AutoHashMapUnmanaged(u64, void).empty;
        defer fragment_keys.deinit(mesh.allocator);
        const Split = struct { t: f32, vertex: u32 };
        var splits = std.ArrayListUnmanaged(Split).empty;
        defer splits.deinit(mesh.allocator);
        for (selected) |face_id| {
            const face = &mesh.faces.items[face_id];
            const corner_count = face.vertices.items.len;
            for (face.vertices.items, 0..) |from, corner| {
                const to = face.vertices.items[(corner + 1) % corner_count];
                if (from == to) continue;
                // A T-junction seam: this edge spans in one run what the facing
                // side splits at mid-run vertices. Cancellation is by edge key, so
                // decompose the run at every selection vertex strictly inside it —
                // the sub-edges then cancel exactly against the split side.
                const from_position = mesh.vertices.items[from].position;
                const to_position = mesh.vertices.items[to].position;
                const axis = sub3(to_position, from_position);
                const axis_length_squared = dot3(axis, axis);
                splits.clearRetainingCapacity();
                if (axis_length_squared > 1e-12) {
                    const line_tolerance = @max(MERGE_FACE_PLANE_ABS_EPS, @sqrt(axis_length_squared) * MERGE_FACE_PLANE_REL_EPS);
                    const weld_squared = IMPORT_WELD_EPS * IMPORT_WELD_EPS;
                    for (cluster.items) |vertex_id| {
                        if (vertex_id == from or vertex_id == to) continue;
                        const point = mesh.vertices.items[vertex_id].position;
                        const t = dot3(sub3(point, from_position), axis) / axis_length_squared;
                        if (t <= 0 or t >= 1) continue;
                        if (length3(sub3(point, lerp3(from_position, to_position, t))) > line_tolerance) continue;
                        if (distanceSquared(point, from_position) <= weld_squared) continue;
                        if (distanceSquared(point, to_position) <= weld_squared) continue;
                        try splits.append(mesh.allocator, .{ .t = t, .vertex = vertex_id });
                    }
                    std.mem.sort(Split, splits.items, {}, struct {
                        fn lessThan(_: void, first: Split, second: Split) bool {
                            return first.t < second.t;
                        }
                    }.lessThan);
                }
                const uv_from = face.uvs.items[corner];
                const uv_to = face.uvs.items[(corner + 1) % corner_count];
                const edge_was_split = splits.items.len > 0;
                var run_from = from;
                var run_uv = uv_from;
                for (splits.items) |split| {
                    if (split.vertex == run_from) continue;
                    const key = edgeKey(run_from, split.vertex);
                    const entry = try uses.getOrPut(mesh.allocator, key);
                    if (!entry.found_existing) entry.value_ptr.* = 0;
                    entry.value_ptr.* += 1;
                    try fragment_keys.put(mesh.allocator, key, {});
                    try directed.append(mesh.allocator, .{ .from = run_from, .to = split.vertex, .uv = run_uv, .key = key });
                    run_from = split.vertex;
                    run_uv = lerp2(uv_from, uv_to, split.t);
                }
                const key = edgeKey(run_from, to);
                const entry = try uses.getOrPut(mesh.allocator, key);
                if (!entry.found_existing) entry.value_ptr.* = 0;
                entry.value_ptr.* += 1;
                if (edge_was_split) try fragment_keys.put(mesh.allocator, key, {});
                try directed.append(mesh.allocator, .{ .from = run_from, .to = to, .uv = run_uv, .key = key });
            }
        }
        var next = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer next.deinit(mesh.allocator);
        var boundary_count: usize = 0;
        var start: ?u32 = null;
        for (directed.items, 0..) |edge, index| {
            if ((uses.get(edge.key) orelse 0) != 1) continue;
            const entry = try next.getOrPut(mesh.allocator, edge.from);
            if (entry.found_existing) return null;
            entry.value_ptr.* = @intCast(index);
            if (start == null) start = edge.from;
            boundary_count += 1;
        }
        if (boundary_count < 3) return null;
        var loop = std.ArrayListUnmanaged(u32).empty;
        defer loop.deinit(mesh.allocator);
        var uvs = std.ArrayListUnmanaged(Vec2).empty;
        defer uvs.deinit(mesh.allocator);
        var current = start.?;
        var consumed: usize = 0;
        while (consumed < boundary_count) : (consumed += 1) {
            const edge_index = next.get(current) orelse return null;
            const edge = directed.items[edge_index];
            try loop.append(mesh.allocator, edge.from);
            try uvs.append(mesh.allocator, edge.uv);
            current = edge.to;
            if (current == start.?) break;
        }
        if (current != start.? or loop.items.len != boundary_count) return null;
        dropCollinearFaceLoop(mesh, &loop, &uvs);
        if (loop.items.len < 3) return null;

        // A cancelled T-split seam is a physical CRACK (req_3805): the spanning side
        // has no welded vertex along the overlap, so its byte-stable rows keep
        // rendering an open edge INSIDE the fused face. Only a re-tessellation
        // stitches that, and concave loops never re-tessellate (a re-fan flips
        // rows) — so a concave fusion over cracked seams refuses instead of
        // committing an authored face that lies about its own topology (the
        // horseshoe-around-a-hole whose centre dot floats over the void).
        var cracked_seams = false;
        var fragment_iter = fragment_keys.keyIterator();
        while (fragment_iter.next()) |key| {
            if ((uses.get(key.*) orelse 0) >= 2) {
                cracked_seams = true;
                break;
            }
        }
        if (cracked_seams and loopIsConcavePositions(mesh, loop.items)) return null;

        // The dissolve test (req_3771): would the byte-stable resident rows still
        // reference a corner the fused boundary no longer owns? Interior grid verts
        // and collinear cut-seam verts fail this; they only actually leave the mesh
        // if this face is re-tessellated from its clean loop instead of re-emitting
        // its recorded source triangles.
        var dropped_corners = false;
        detect: for (selected) |face_id| {
            const face = &mesh.faces.items[face_id];
            for (face.vertices.items) |vertex_id| {
                if (!vertexInLoop(loop.items, vertex_id)) {
                    dropped_corners = true;
                    break :detect;
                }
            }
            for (face.source_triangles.items) |source_triangle| {
                if (source_triangle >= mesh.render_triangles.items.len) continue;
                for (mesh.render_triangles.items[source_triangle]) |vertex_id| {
                    if (!vertexInLoop(loop.items, vertex_id)) {
                        dropped_corners = true;
                        break :detect;
                    }
                }
            }
        }

        const target_id = selected[0];
        var sources = std.ArrayListUnmanaged(u32).empty;
        defer sources.deinit(mesh.allocator);
        for (selected) |face_id| try sources.appendSlice(mesh.allocator, mesh.faces.items[face_id].source_triangles.items);
        const target = &mesh.faces.items[target_id];
        target.vertices.clearRetainingCapacity();
        target.uvs.clearRetainingCapacity();
        target.source_triangles.clearRetainingCapacity();
        try target.vertices.appendSlice(mesh.allocator, loop.items);
        try target.uvs.appendSlice(mesh.allocator, uvs.items);
        try target.source_triangles.appendSlice(mesh.allocator, sources.items);
        target.diagonal = null;
        if (loop.items.len == 4) {
            if (preferred_diagonal) |diagonal| {
                if (quadDiagonalKind(target, diagonal) != null) target.diagonal = diagonal;
            }
        }
        // A dropped corner means the recorded rows still triangulate the OLD
        // boundary; invalidating them makes the next lower() rebuild this face
        // from its clean loop, which is what actually dissolves the dead verts.
        // CONVEX loops only: lower()'s loop tessellation is a fan, and re-fanning
        // a concave perimeter reverses render triangles (the bookshelf-side bug),
        // so concave fusions keep their byte-stable rows even with dropped corners.
        const retessellated = dropped_corners and !faceIsConcave(mesh, target);
        target.source_tessellation_valid = source_tessellation_valid and !retessellated;
        // Meaning may never be chosen arbitrarily. A merge across differently
        // named surfaces becomes explicit naming debt for the agent to resolve.
        if (semantic_conflict) target.semantic = .{};
        for (selected) |face_id| {
            if (face_id != target_id) mesh.faces.items[face_id].alive = false;
        }
        return .{ .face_id = target_id, .retessellated = retessellated };
    }

    fn vertexInLoop(loop: []const u32, vertex_id: u32) bool {
        for (loop) |kept| if (kept == vertex_id) return true;
        return false;
    }

    /// Dissolve a connected coplanar face selection into one ordered boundary face.
    /// A two-triangle merge records their real resident diagonal so later geometric
    /// edits never have to guess how the authored quad was physically tessellated.
    pub fn mergeSelected(mesh: *Mesh, selected_triangles: []const bool) !?MergedFace {
        return mesh.mergeSelectedImpl(selected_triangles, true);
    }

    /// Mirror-twin fusion (req_3855): mergeSelected WITHOUT the coplanarity gate.
    /// Licensed ONLY when the caller has proven the fused result is the positional
    /// mirror image of an authored face the model already contains — the twin is
    /// exactly as warped as its licensed source (import-authored quads are routinely
    /// millimetres out of plane, which the interactive gate rightly refuses to
    /// CREATE but must not refuse to COPY).
    pub fn mergeSelectedTrusted(mesh: *Mesh, selected_triangles: []const bool) !?MergedFace {
        return mesh.mergeSelectedImpl(selected_triangles, false);
    }

    fn mergeSelectedImpl(mesh: *Mesh, selected_triangles: []const bool, require_coplanar: bool) !?MergedFace {
        var selected = std.ArrayListUnmanaged(u32).empty;
        defer selected.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (faceFullySelected(face, selected_triangles)) try selected.append(mesh.allocator, face.id);
        }
        const diagonal = mesh.sharedTriangleDiagonal(selected.items);
        return mesh.mergeFaceIdsGated(selected.items, diagonal, require_coplanar);
    }

    fn triangleTip(face: *const Face, diagonal: [2]u32) ?u32 {
        var tip: ?u32 = null;
        var shared_count: u32 = 0;
        for (face.vertices.items) |vertex| {
            if (vertex == diagonal[0] or vertex == diagonal[1]) {
                shared_count += 1;
            } else if (tip == null) {
                tip = vertex;
            } else return null;
        }
        return if (shared_count == 2) tip else null;
    }

    fn directedDiagonalUse(face: *const Face, diagonal: [2]u32) i8 {
        for (face.vertices.items, 0..) |from, corner| {
            const to = face.vertices.items[(corner + 1) % face.vertices.items.len];
            if (from == diagonal[0] and to == diagonal[1]) return 1;
            if (from == diagonal[1] and to == diagonal[0]) return -1;
        }
        return 0;
    }

    /// The bulk planner deliberately accepts exactly the useful two-triangle
    /// subset of Merge Faces: same plane/winding, one shared edge, and a durable
    /// four-corner boundary after the merge's own collinear-drop rule. Concave
    /// authored quads remain legal because pairwise Merge Faces already supports
    /// them; this sweep must not silently impose a stricter second definition.
    fn trianglePairCanMergeAsQuad(mesh: *const Mesh, first_face: u32, second_face: u32, diagonal: [2]u32) bool {
        const first = &mesh.faces.items[first_face];
        const second = &mesh.faces.items[second_face];
        const first_tip = triangleTip(first, diagonal) orelse return false;
        const second_tip = triangleTip(second, diagonal) orelse return false;
        if (first_tip == second_tip) return false;
        const first_direction = directedDiagonalUse(first, diagonal);
        const second_direction = directedDiagonalUse(second, diagonal);
        if (first_direction == 0 or second_direction == 0 or first_direction == second_direction) return false;
        const selected = [2]u32{ first_face, second_face };
        if (!mesh.selectedFacesAreCoplanar(selected[0..])) return false;

        const loop = [4]u32{ first_tip, diagonal[0], second_tip, diagonal[1] };
        for (0..loop.len) |corner| {
            const previous = mesh.vertices.items[loop[(corner + loop.len - 1) % loop.len]].position;
            const current = mesh.vertices.items[loop[corner]].position;
            const next = mesh.vertices.items[loop[(corner + 1) % loop.len]].position;
            const incoming = sub3(current, previous);
            const outgoing = sub3(next, current);
            const scale = length3(incoming) * length3(outgoing);
            if (!std.math.isFinite(scale) or scale <= 1e-12) return false;
            if (length3(cross3(incoming, outgoing)) / scale < QuadifyTuning.boundary_corner_epsilon) return false;
        }
        return true;
    }

    fn lengthBalance(first: f32, second: f32) f32 {
        const longest = @max(first, second);
        if (!std.math.isFinite(longest) or longest <= 1e-12) return 0;
        return @min(first, second) / longest;
    }

    fn quadCandidateScore(mesh: *const Mesh, first_face: u32, second_face: u32, diagonal: [2]u32) ?f32 {
        const first_tip = triangleTip(&mesh.faces.items[first_face], diagonal) orelse return null;
        const second_tip = triangleTip(&mesh.faces.items[second_face], diagonal) orelse return null;
        const loop = [4]u32{ first_tip, diagonal[0], second_tip, diagonal[1] };

        var edge_lengths: [4]f32 = undefined;
        var corner_quality: f32 = 1;
        for (0..loop.len) |corner| {
            const previous = mesh.vertices.items[loop[(corner + loop.len - 1) % loop.len]].position;
            const current = mesh.vertices.items[loop[corner]].position;
            const next = mesh.vertices.items[loop[(corner + 1) % loop.len]].position;
            const incoming = sub3(previous, current);
            const outgoing = sub3(next, current);
            const scale = length3(incoming) * length3(outgoing);
            if (!std.math.isFinite(scale) or scale <= 1e-12) return null;
            corner_quality = @min(corner_quality, length3(cross3(incoming, outgoing)) / scale);
            edge_lengths[corner] = length3(outgoing);
        }

        const shared_diagonal = length3(sub3(
            mesh.vertices.items[diagonal[0]].position,
            mesh.vertices.items[diagonal[1]].position,
        ));
        const other_diagonal = length3(sub3(
            mesh.vertices.items[first_tip].position,
            mesh.vertices.items[second_tip].position,
        ));
        const diagonal_balance = lengthBalance(shared_diagonal, other_diagonal);
        const opposite_edge_balance = (lengthBalance(edge_lengths[0], edge_lengths[2]) +
            lengthBalance(edge_lengths[1], edge_lengths[3])) * 0.5;
        const score =
            diagonal_balance * QuadifyTuning.diagonal_balance_weight +
            opposite_edge_balance * QuadifyTuning.opposite_edge_balance_weight +
            corner_quality * QuadifyTuning.corner_quality_weight;
        return if (std.math.isFinite(score)) score else null;
    }

    fn quadCandidateBefore(evaluation: QuadEvaluation, first: QuadCandidate, second: QuadCandidate) bool {
        switch (evaluation) {
            .balanced => {
                if (@abs(first.score - second.score) > QuadifyTuning.score_tie_epsilon) {
                    return first.score > second.score;
                }
            },
            .short_seams => {
                if (@abs(first.diagonal_length - second.diagonal_length) > QuadifyTuning.score_tie_epsilon) {
                    return first.diagonal_length < second.diagonal_length;
                }
                if (@abs(first.score - second.score) > QuadifyTuning.score_tie_epsilon) {
                    return first.score > second.score;
                }
            },
            .alternate_flow => {
                const first_key = quadCandidateFlowKey(first);
                const second_key = quadCandidateFlowKey(second);
                if (first_key != second_key) {
                    return first_key < second_key;
                }
                if (@abs(first.score - second.score) > QuadifyTuning.score_tie_epsilon) {
                    return first.score > second.score;
                }
            },
        }
        if (first.pair.first_face != second.pair.first_face) {
            return first.pair.first_face < second.pair.first_face;
        }
        if (first.pair.second_face != second.pair.second_face) {
            return first.pair.second_face < second.pair.second_face;
        }
        return edgeKey(first.pair.diagonal[0], first.pair.diagonal[1]) <
            edgeKey(second.pair.diagonal[0], second.pair.diagonal[1]);
    }

    fn quadCandidateFlowKey(candidate: QuadCandidate) u32 {
        var key: u32 = 2166136261;
        for ([_]u32{
            candidate.pair.first_face,
            candidate.pair.second_face,
            candidate.pair.diagonal[0],
            candidate.pair.diagonal[1],
        }) |value| {
            key = (key ^ value) *% 16777619;
        }
        return key;
    }

    /// Build the complete compatible-pair graph. This counts only authored triangle
    /// faces selected by the caller's class mask (opaque and glass are planned
    /// independently). A source seam still has to be manifold: a third face on the
    /// exact same edge is not one unambiguous diagonal to remove.
    fn collectSelectedTriangleQuadCandidates(
        mesh: *const Mesh,
        selected_triangles: []const bool,
        candidates: *std.ArrayListUnmanaged(QuadCandidate),
        stats: *QuadifyStats,
    ) !void {
        var face_edges = std.ArrayListUnmanaged(QuadFaceEdge).empty;
        defer face_edges.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            stats.authored_faces_before += 1;
            const eligible = faceFullySelected(face, selected_triangles) and
                face.vertices.items.len == 3 and face.source_triangles.items.len == 1;
            if (eligible) stats.triangle_faces += 1;
            for (face.vertices.items, 0..) |from, corner| {
                const to = face.vertices.items[(corner + 1) % face.vertices.items.len];
                if (from == to) continue;
                try face_edges.append(mesh.allocator, .{ .key = edgeKey(from, to), .face = face.id });
            }
        }
        stats.authored_faces_after = stats.authored_faces_before;
        std.mem.sort(QuadFaceEdge, face_edges.items, {}, struct {
            fn lessThan(_: void, first: QuadFaceEdge, second: QuadFaceEdge) bool {
                if (first.key != second.key) return first.key < second.key;
                return first.face < second.face;
            }
        }.lessThan);

        var seen_pairs = std.AutoHashMapUnmanaged(u64, void).empty;
        defer seen_pairs.deinit(mesh.allocator);
        var run_start: usize = 0;
        while (run_start < face_edges.items.len) {
            var run_end = run_start + 1;
            while (run_end < face_edges.items.len and face_edges.items[run_end].key == face_edges.items[run_start].key) {
                run_end += 1;
            }
            if (run_end - run_start != 2) {
                run_start = run_end;
                continue;
            }
            const diagonal = [2]u32{
                @intCast(face_edges.items[run_start].key >> 32),
                @intCast(face_edges.items[run_start].key & 0xffffffff),
            };
            var first_index = run_start;
            while (first_index < run_end) : (first_index += 1) {
                var second_index = first_index + 1;
                while (second_index < run_end) : (second_index += 1) {
                    const raw_first = face_edges.items[first_index].face;
                    const raw_second = face_edges.items[second_index].face;
                    if (raw_first == raw_second) continue;
                    const first = @min(raw_first, raw_second);
                    const second = @max(raw_first, raw_second);
                    const pair_key = (@as(u64, first) << 32) | @as(u64, second);
                    if (seen_pairs.contains(pair_key)) continue;
                    const first_face = &mesh.faces.items[first];
                    const second_face = &mesh.faces.items[second];
                    if (!faceFullySelected(first_face, selected_triangles) or
                        !faceFullySelected(second_face, selected_triangles) or
                        first_face.vertices.items.len != 3 or second_face.vertices.items.len != 3 or
                        first_face.source_triangles.items.len != 1 or second_face.source_triangles.items.len != 1)
                    {
                        continue;
                    }
                    if (first_face.part != second_face.part or first_face.material != second_face.material) continue;
                    if (!mesh.trianglePairCanMergeAsQuad(first, second, diagonal)) continue;
                    const score = mesh.quadCandidateScore(first, second, diagonal) orelse continue;
                    const diagonal_length = length3(sub3(
                        mesh.vertices.items[diagonal[0]].position,
                        mesh.vertices.items[diagonal[1]].position,
                    ));
                    if (!std.math.isFinite(diagonal_length) or diagonal_length <= 1e-12) continue;
                    try seen_pairs.put(mesh.allocator, pair_key, {});
                    try candidates.append(mesh.allocator, .{
                        .pair = .{ .first_face = first, .second_face = second, .diagonal = diagonal },
                        .score = score,
                        .diagonal_length = diagonal_length,
                    });
                }
            }
            run_start = run_end;
        }
        stats.candidate_pairs = @intCast(candidates.items.len);
    }

    /// Convert the compatible triangle graph to an exact maximum matching. A high
    /// quality middle edge can no longer strand two end pairs: augmenting paths
    /// rearrange earlier choices until no plan with more quads exists.
    pub fn quadifySelectedWithEvaluation(
        mesh: *Mesh,
        selected_triangles: []const bool,
        evaluation: QuadEvaluation,
    ) !QuadifyStats {
        var stats = QuadifyStats{};
        var candidates = std.ArrayListUnmanaged(QuadCandidate).empty;
        defer candidates.deinit(mesh.allocator);
        try mesh.collectSelectedTriangleQuadCandidates(selected_triangles, &candidates, &stats);
        if (candidates.items.len == 0) return stats;

        std.mem.sort(QuadCandidate, candidates.items, evaluation, struct {
            fn lessThan(order: QuadEvaluation, first: QuadCandidate, second: QuadCandidate) bool {
                return quadCandidateBefore(order, first, second);
            }
        }.lessThan);

        const adjacency = try mesh.allocator.alloc(std.ArrayListUnmanaged(u32), mesh.faces.items.len);
        defer {
            for (adjacency) |*list| list.deinit(mesh.allocator);
            mesh.allocator.free(adjacency);
        }
        for (adjacency) |*list| list.* = .empty;
        const degree = try mesh.allocator.alloc(u32, mesh.faces.items.len);
        defer mesh.allocator.free(degree);
        @memset(degree, 0);
        for (candidates.items, 0..) |candidate, candidate_index| {
            try adjacency[candidate.pair.first_face].append(mesh.allocator, @intCast(candidate_index));
            try adjacency[candidate.pair.second_face].append(mesh.allocator, @intCast(candidate_index));
            degree[candidate.pair.first_face] += 1;
            degree[candidate.pair.second_face] += 1;
        }
        for (degree) |candidate_count| {
            if (candidate_count > 1) stats.ambiguous_triangles += 1;
        }
        var pairs = std.ArrayListUnmanaged(QuadPair).empty;
        defer pairs.deinit(mesh.allocator);
        var matcher = try MaximumQuadMatcher.init(mesh.allocator, candidates.items, adjacency);
        defer matcher.deinit();
        try matcher.solve(&pairs);

        var changed: u32 = 0;
        for (pairs.items) |pair| {
            for ([_]u32{ pair.first_face, pair.second_face, pair.diagonal[0], pair.diagonal[1] }) |value| {
                stats.plan_signature = (stats.plan_signature ^ value) *% 16777619;
            }
            const face_ids = [2]u32{ pair.first_face, pair.second_face };
            if ((try mesh.mergeFaceIds(face_ids[0..], pair.diagonal)) != null) changed += 1;
        }
        stats.quads = changed;
        stats.authored_faces_after = stats.authored_faces_before - changed;
        return stats;
    }

    /// Compatibility wrapper for callers that do not expose the preview's
    /// evaluation choice.
    pub fn quadifySelected(mesh: *Mesh, selected_triangles: []const bool) !u32 {
        return (try mesh.quadifySelectedWithEvaluation(selected_triangles, .balanced)).quads;
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
        return loopIsConcavePositions(mesh, face.vertices.items);
    }

    /// The faceIsConcave turn-sign test over a bare vertex loop — usable BEFORE a
    /// candidate boundary is committed onto a face (req_3805's refusal runs on the
    /// clean loop, ahead of any mutation). Newell normal, same 1e-9 turn epsilon.
    fn loopIsConcavePositions(mesh: *const Mesh, loop: []const u32) bool {
        if (loop.len < 4) return false;
        var normal: Vec3 = .{ 0, 0, 0 };
        for (loop, 0..) |vertex_id, corner| {
            const current = mesh.vertices.items[vertex_id].position;
            const next = mesh.vertices.items[loop[(corner + 1) % loop.len]].position;
            normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
            normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
            normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
        }
        var sign: f32 = 0;
        for (loop, 0..) |vertex_id, corner| {
            const previous = mesh.vertices.items[loop[(corner + loop.len - 1) % loop.len]].position;
            const current = mesh.vertices.items[vertex_id].position;
            const next = mesh.vertices.items[loop[(corner + 1) % loop.len]].position;
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

    fn cutSideAlignedToWorld(mesh: *const Mesh, face: *const Face, world_direction_raw: Vec3) ?[2]u32 {
        const direction_length = length3(world_direction_raw);
        if (direction_length <= IMPORT_WELD_EPS) return null;
        const world_direction = mul3(world_direction_raw, 1.0 / direction_length);
        var best_side: ?[2]u32 = null;
        var best_alignment: f32 = -1.0;
        for (face.vertices.items, 0..) |vertex_id, edge_index| {
            const next_vertex_id = face.vertices.items[(edge_index + 1) % face.vertices.items.len];
            const a = mesh.vertices.items[vertex_id].position;
            const b = mesh.vertices.items[next_vertex_id].position;
            const edge = sub3(b, a);
            const edge_length = length3(edge);
            // An edge shorter than the soup-import weld boundary cannot remain a
            // distinct edge after save/load and is not a usable cut orientation.
            if (edge_length <= IMPORT_WELD_EPS) continue;
            const alignment = @abs(dot3(mul3(edge, 1.0 / edge_length), world_direction));
            if (alignment <= best_alignment) continue;
            best_alignment = alignment;
            best_side = if (dot3(edge, world_direction) >= 0)
                .{ vertex_id, next_vertex_id }
            else
                .{ next_vertex_id, vertex_id };
        }
        return best_side;
    }

    /// Basic Cut uses the same face splitter but deliberately disables neighbor
    /// traversal. One call resolves one seed world direction against every selected
    /// face, so stored ring rotation/winding can never change the requested axis or
    /// offset phase. It can therefore never turn into a loop cut or exceed selection.
    pub fn cutSelected(mesh: *Mesh, selected_triangles: []const bool, world_direction_raw: Vec3, cuts: u32, offset_fraction: f32) !bool {
        const direction_length = length3(world_direction_raw);
        if (direction_length <= IMPORT_WELD_EPS) return false;
        const world_direction = mul3(world_direction_raw, 1.0 / direction_length);
        var selected = std.ArrayListUnmanaged(u32).empty;
        defer selected.deinit(mesh.allocator);
        for (mesh.faces.items) |*face| {
            if (faceFullySelected(face, selected_triangles)) try selected.append(mesh.allocator, face.id);
        }
        var context = CutContext{
            .mesh = mesh,
            .direction = 0,
            .basic_cut_direction = world_direction,
            .cuts = @max(1, cuts),
            .offset_fraction = std.math.clamp(offset_fraction, 0.0, 1.0),
            .propagate = false,
        };
        defer context.deinit();
        var changed = false;
        for (selected.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            if (!face.alive or face.vertices.items.len < 2) continue;
            const side = cutSideAlignedToWorld(mesh, face, world_direction) orelse continue;
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

            const ratio = context.ratioForSide(side, cut_no);
            const center_side = try context.centerVertex(side, ratio, cut_no);
            const center_opposite = try context.centerVertex(opposite, ratio, cut_no);

            const old = &context.mesh.faces.items[face_id];
            const side_uv = lerp2(uvFor(old, side[0]), uvFor(old, side[1]), ratio);
            const opposite_uv = lerp2(uvFor(old, opposite[0]), uvFor(old, opposite[1]), ratio);
            const new_face = try context.mesh.makeSplitFace(old, &.{ side[1], center_side, center_opposite, opposite[1] }, &.{ uvFor(old, side[1]), side_uv, opposite_uv, uvFor(old, opposite[1]) });
            const new_face_id = new_face.id;
            // Blockbench stores this array as an unordered vertex set and its
            // MeshFace.getSortedVertices() restores polygon order. Our face loops are
            // ordered data, so emit that sorted order directly; the literal reference
            // array crosses center_side/center_opposite into a bow-tie quad.
            try context.mesh.replaceFaceLoop(face_id, &.{ opposite[0], center_opposite, center_side, side[0] }, &.{ uvFor(old, opposite[0]), opposite_uv, side_uv, uvFor(old, side[0]) });
            try context.mesh.faces.append(context.mesh.allocator, new_face);

            if (cut_no + 1 < context.cuts) {
                // The remaining comb planes belong on the FAR side of this plane along
                // the seed world direction. replaceFaceLoop kept side[0]'s child at
                // face_id and the appended face holds side[1]'s — which of those is the
                // far child is a ring-order artifact, so on a world-anchored basic cut
                // pick by projection instead (req_3825: the mirrored half recursed into
                // the near child and its comb collapsed inward — stations {1/3, 1/6}
                // where the unmirrored twin correctly spread {1/3, 2/3}).
                if (context.basic_cut_direction) |world_direction| {
                    const p_side0 = context.mesh.vertices.items[side[0]].position;
                    const p_side1 = context.mesh.vertices.items[side[1]].position;
                    if (dot3(p_side0, world_direction) >= dot3(p_side1, world_direction)) {
                        _ = try splitFace(context, face_id, .{ center_side, side[0] }, double_side, cut_no + 1);
                    } else {
                        _ = try splitFace(context, new_face_id, .{ center_side, side[1] }, double_side, cut_no + 1);
                    }
                } else {
                    _ = try splitFace(context, face_id, .{ center_side, side[0] }, double_side, cut_no + 1);
                }
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
            const ratio = context.ratioForSide(side, cut_no);

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
            .semantic = source.semantic,
            .source_tessellation_valid = false,
        };
        mesh.next_group += 1;
        errdefer out.deinit(mesh.allocator);
        try out.vertices.appendSlice(mesh.allocator, vertices);
        try out.uvs.appendSlice(mesh.allocator, uvs);
        try out.source_triangles.appendSlice(mesh.allocator, source.source_triangles.items);
        if (out.vertices.items.len == 4) out.diagonal = chosenQuadDiagonal(mesh, &out);
        return out;
    }

    /// Connect two non-adjacent stable vertices that share one authored face.
    /// The retained half keeps the source group; the second half receives a fresh
    /// group while material, part, and semantic identity inherit from the source.
    pub fn connectVertices(mesh: *Mesh, a: u32, b: u32) !bool {
        if (a == b or a >= mesh.vertices.items.len or b >= mesh.vertices.items.len or
            !mesh.vertices.items[a].alive or !mesh.vertices.items[b].alive) return false;
        var face_id: u32 = 0;
        while (face_id < mesh.faces.items.len) : (face_id += 1) {
            const face = &mesh.faces.items[face_id];
            if (!face.alive or face.vertices.items.len < 4) continue;
            const ia = indexOf(face.vertices.items, a) orelse continue;
            const ib = indexOf(face.vertices.items, b) orelse continue;
            const count = face.vertices.items.len;
            if ((ia + 1) % count == ib or (ib + 1) % count == ia) continue;

            var source = try face.clone(mesh.allocator);
            defer source.deinit(mesh.allocator);
            var first_vertices = std.ArrayListUnmanaged(u32).empty;
            defer first_vertices.deinit(mesh.allocator);
            var first_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer first_uvs.deinit(mesh.allocator);
            var second_vertices = std.ArrayListUnmanaged(u32).empty;
            defer second_vertices.deinit(mesh.allocator);
            var second_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer second_uvs.deinit(mesh.allocator);

            var at = ia;
            while (true) : (at = (at + 1) % count) {
                try first_vertices.append(mesh.allocator, source.vertices.items[at]);
                try first_uvs.append(mesh.allocator, source.uvs.items[at]);
                if (at == ib) break;
            }
            at = ib;
            while (true) : (at = (at + 1) % count) {
                try second_vertices.append(mesh.allocator, source.vertices.items[at]);
                try second_uvs.append(mesh.allocator, source.uvs.items[at]);
                if (at == ia) break;
            }
            if (first_vertices.items.len < 3 or second_vertices.items.len < 3) return false;
            try mesh.replaceFaceLoop(face_id, first_vertices.items, first_uvs.items);
            var split = try mesh.makeSplitFace(&source, second_vertices.items, second_uvs.items);
            errdefer split.deinit(mesh.allocator);
            try mesh.faces.append(mesh.allocator, split);
            return true;
        }
        return false;
    }

    fn replaceFaceLoop(mesh: *Mesh, face_id: u32, vertices: []const u32, uvs: []const Vec2) !void {
        const face = &mesh.faces.items[face_id];
        face.vertices.clearRetainingCapacity();
        face.uvs.clearRetainingCapacity();
        try face.vertices.appendSlice(mesh.allocator, vertices);
        try face.uvs.appendSlice(mesh.allocator, uvs);
        face.diagonal = if (face.vertices.items.len == 4) chosenQuadDiagonal(mesh, face) else null;
        face.source_tessellation_valid = false;
    }

    fn reverseFace(mesh: *Mesh, face_id: u32) void {
        if (face_id >= mesh.faces.items.len) return;
        std.mem.reverse(u32, mesh.faces.items[face_id].vertices.items);
        std.mem.reverse(Vec2, mesh.faces.items[face_id].uvs.items);
        mesh.faces.items[face_id].source_tessellation_valid = false;
    }

    fn findNeighbor(mesh: *const Mesh, processed: *const std.AutoHashMapUnmanaged(u32, void), current_face: u32, edge: [2]u32) ?u32 {
        const current = &mesh.faces.items[current_face];
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.id == current_face or processed.contains(face.id)) continue;
            // The walk continues only across a REAL shared edge. Mere containment of
            // both vertices also matches a face where they sit diagonally (a cap
            // piece, a damaged panel) — splitting along that diagonal rebuilds the
            // loop as a bow-tie (req_3435).
            if (!faceHasUndirectedEdge(face, edge[0], edge[1])) continue;
            // Back-to-back coincident sheets are NOT a surface continuation
            // (req_3436): per-face cap extrusion mints one reversed interior wall
            // pair per fan spoke, and a loop that enters one subdivides the
            // coincident copies divergently — the wreckage then compounds on every
            // later cut. Skip the CURRENT face's own twin, and skip any candidate
            // whose same-vertex-set twin is also incident on this edge (the
            // sandwich); the true manifold neighbor is whatever remains.
            if (sameVertexSet(face, current)) continue;
            var sandwiched = false;
            for (mesh.faces.items) |*twin| {
                if (!twin.alive or twin.id == face.id or twin.id == current_face) continue;
                if (!faceHasUndirectedEdge(twin, edge[0], edge[1])) continue;
                if (sameVertexSet(face, twin)) sandwiched = true;
            }
            if (sandwiched) continue;
            return face.id;
        }
        return null;
    }

    fn sameVertexSet(a: *const Face, b: *const Face) bool {
        if (a.vertices.items.len != b.vertices.items.len) return false;
        for (a.vertices.items) |vertex_id| {
            if (indexOf(b.vertices.items, vertex_id) == null) return false;
        }
        return true;
    }

    fn faceHasUndirectedEdge(face: *const Face, a: u32, b: u32) bool {
        const items = face.vertices.items;
        for (items, 0..) |vertex_id, index| {
            const next = items[(index + 1) % items.len];
            if ((vertex_id == a and next == b) or (vertex_id == b and next == a)) return true;
        }
        return false;
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

    const EdgeRecede = struct {
        direction: Vec3,
        reach: f32,
    };

    fn vertexBelongsToPart(mesh: *const Mesh, vertex_id: u32, part: u32) bool {
        for (mesh.faces.items) |*face| {
            if (face.alive and face.part == part and containsVertex(face, vertex_id)) return true;
        }
        return false;
    }

    fn vertexAt(mesh: *const Mesh, position: Vec3, part: ?u32) ?u32 {
        for (mesh.vertices.items, 0..) |vertex, index| {
            if (!vertex.alive or !samePoint(vertex.position, position)) continue;
            if (part) |owner| {
                if (!mesh.vertexBelongsToPart(@intCast(index), owner)) continue;
            }
            return @intCast(index);
        }
        return null;
    }

    /// Resolve the cart's selected welded edge once, at the soup→indexed boundary.
    /// Preview clones then keep these stable ids; no later operation position-matches.
    pub fn resolveBevelEdge(mesh: *const Mesh, a: Vec3, b: Vec3, part: ?u32) ?BevelSelection {
        const va = mesh.vertexAt(a, part) orelse return null;
        const vb = mesh.vertexAt(b, part) orelse return null;
        if (va == vb) return null;
        const target = BevelTarget{ .edge = .{ va, vb } };
        return .{ .target = target, .max_width = mesh.bevelLimit(target) orelse return null };
    }

    /// Resolve one selected welded corner into the resident indexed topology.
    pub fn resolveBevelVertex(mesh: *const Mesh, position: Vec3, part: ?u32) ?BevelSelection {
        const vertex = mesh.vertexAt(position, part) orelse return null;
        const target = BevelTarget{ .vertex = vertex };
        return .{ .target = target, .max_width = mesh.bevelLimit(target) orelse return null };
    }

    fn edgeIncidentFaces(mesh: *const Mesh, edge: [2]u32, out: *[2]u32) bool {
        var count: usize = 0;
        for (mesh.faces.items) |*face| {
            if (!face.alive or !faceHasUndirectedEdge(face, edge[0], edge[1])) continue;
            if (count == out.len) return false;
            out[count] = face.id;
            count += 1;
        }
        return count == 2;
    }

    fn edgeIncidentFaceCount(mesh: *const Mesh, edge: [2]u32) u32 {
        var count: u32 = 0;
        for (mesh.faces.items) |*face| {
            if (face.alive and faceHasUndirectedEdge(face, edge[0], edge[1])) count += 1;
        }
        return count;
    }

    fn boundaryChamferLimit(mesh: *const Mesh, loop: []const u32) ?f32 {
        if (loop.len < BoundaryChamferTuning.minimum_sides) return null;
        var shortest = std.math.inf(f32);
        for (loop, 0..) |vertex, index| {
            const next = loop[(index + 1) % loop.len];
            if (vertex == next or vertex >= mesh.vertices.items.len or next >= mesh.vertices.items.len or
                !mesh.vertices.items[vertex].alive or !mesh.vertices.items[next].alive or
                mesh.edgeIncidentFaceCount(.{ vertex, next }) != 1)
            {
                return null;
            }
            for (loop[0..index]) |prior| if (prior == vertex) return null;
            shortest = @min(shortest, length3(sub3(
                mesh.vertices.items[next].position,
                mesh.vertices.items[vertex].position,
            )));
        }
        const limit = shortest * BoundaryChamferTuning.edge_fraction;
        return if (std.math.isFinite(limit) and limit >= BoundaryChamferTuning.minimum_width_m) limit else null;
    }

    /// Resolve an unordered selected edge set into one strict closed loop. Every
    /// edge must be an actual open mesh boundary (one incident authored face),
    /// every vertex must have degree two in the selection, and all identity is
    /// resolved inside the selected outliner part before topology is changed.
    pub fn resolveBoundaryChamfer(
        mesh: *const Mesh,
        selected_edges: []const [2]Vec3,
        part: u32,
        out_loop: []u32,
    ) ?BoundaryChamferSelection {
        if (selected_edges.len < BoundaryChamferTuning.minimum_sides or out_loop.len != selected_edges.len) return null;
        const BoundaryNode = struct {
            neighbors: [2]u32 = undefined,
            count: u8 = 0,
        };
        var nodes = std.AutoHashMapUnmanaged(u32, BoundaryNode).empty;
        defer nodes.deinit(mesh.allocator);
        nodes.ensureTotalCapacity(mesh.allocator, @intCast(selected_edges.len)) catch return null;

        for (selected_edges) |edge_positions| {
            const edge = [2]u32{
                mesh.vertexAt(edge_positions[0], part) orelse return null,
                mesh.vertexAt(edge_positions[1], part) orelse return null,
            };
            if (edge[0] == edge[1] or mesh.edgeIncidentFaceCount(edge) != 1) return null;
            for ([2][2]u32{ .{ edge[0], edge[1] }, .{ edge[1], edge[0] } }) |directed| {
                const entry = nodes.getOrPut(mesh.allocator, directed[0]) catch return null;
                if (!entry.found_existing) entry.value_ptr.* = .{};
                var neighbor_index: usize = 0;
                while (neighbor_index < entry.value_ptr.count) : (neighbor_index += 1) {
                    if (entry.value_ptr.neighbors[neighbor_index] == directed[1]) return null;
                }
                if (entry.value_ptr.count >= entry.value_ptr.neighbors.len) return null;
                entry.value_ptr.neighbors[entry.value_ptr.count] = directed[1];
                entry.value_ptr.count += 1;
            }
        }
        if (nodes.count() != selected_edges.len) return null;
        var start: u32 = std.math.maxInt(u32);
        var node_it = nodes.iterator();
        while (node_it.next()) |entry| {
            if (entry.value_ptr.count != 2) return null;
            start = @min(start, entry.key_ptr.*);
        }

        var previous: ?u32 = null;
        var current = start;
        for (out_loop, 0..) |*slot, index| {
            for (out_loop[0..index]) |visited| if (visited == current) return null;
            slot.* = current;
            const node = nodes.get(current) orelse return null;
            const next = if (previous) |prior|
                if (node.neighbors[0] == prior) node.neighbors[1] else if (node.neighbors[1] == prior) node.neighbors[0] else return null
            else
                @min(node.neighbors[0], node.neighbors[1]);
            previous = current;
            current = next;
        }
        if (current != start) return null;
        const max_width = mesh.boundaryChamferLimit(out_loop) orelse return null;
        return .{
            .sides_before = @intCast(out_loop.len),
            .sides_after = @intCast(out_loop.len * 2),
            .max_width = max_width,
        };
    }

    fn faceCentroid(mesh: *const Mesh, face: *const Face) Vec3 {
        var center = Vec3{ 0, 0, 0 };
        for (face.vertices.items) |vertex_id| center = add3(center, mesh.vertices.items[vertex_id].position);
        const inverse = if (face.vertices.items.len > 0)
            1.0 / @as(f32, @floatFromInt(face.vertices.items.len))
        else
            1.0;
        return mul3(center, inverse);
    }

    fn edgeRecede(mesh: *const Mesh, face_id: u32, edge: [2]u32) ?EdgeRecede {
        if (face_id >= mesh.faces.items.len) return null;
        const face = &mesh.faces.items[face_id];
        const a = mesh.vertices.items[edge[0]].position;
        const b = mesh.vertices.items[edge[1]].position;
        const edge_direction = norm3(sub3(b, a));
        if (length3(edge_direction) < 0.5) return null;
        const normal = faceNormal(mesh, face);
        if (length3(normal) < 0.5) return null;
        var direction = cross3(normal, edge_direction);
        const midpoint = mul3(add3(a, b), 0.5);
        if (dot3(direction, sub3(mesh.faceCentroid(face), midpoint)) < 0) direction = mul3(direction, -1);
        direction = norm3(direction);
        if (length3(direction) < 0.5) return null;
        var reach: f32 = 0;
        for (face.vertices.items) |vertex_id| {
            reach = @max(reach, dot3(sub3(mesh.vertices.items[vertex_id].position, a), direction));
        }
        return .{ .direction = direction, .reach = reach };
    }

    fn appendUniqueVertex(list: *std.ArrayListUnmanaged(u32), allocator: std.mem.Allocator, vertex: u32) !void {
        for (list.items) |existing| if (existing == vertex) return;
        try list.append(allocator, vertex);
    }

    fn collectVertexNeighborhood(
        mesh: *const Mesh,
        vertex: u32,
        faces: *std.ArrayListUnmanaged(u32),
        neighbors: *std.ArrayListUnmanaged(u32),
    ) !void {
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 3) continue;
            const corner = indexOf(face.vertices.items, vertex) orelse continue;
            try faces.append(mesh.allocator, face.id);
            const previous = face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len];
            const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
            if (previous != vertex) try appendUniqueVertex(neighbors, mesh.allocator, previous);
            if (next != vertex) try appendUniqueVertex(neighbors, mesh.allocator, next);
        }
    }

    /// The widest meaningful bevel for this exact topology target. Null is the
    /// strict boundary refusal: boundary/non-manifold/coplanar edge, or a corner
    /// with fewer than three incident edges.
    pub fn bevelLimit(mesh: *const Mesh, target: BevelTarget) ?f32 {
        const limit = switch (target) {
            .edge => |edge| edge_limit: {
                if (edge[0] >= mesh.vertices.items.len or edge[1] >= mesh.vertices.items.len or
                    !mesh.vertices.items[edge[0]].alive or !mesh.vertices.items[edge[1]].alive)
                {
                    break :edge_limit 0;
                }
                var incident: [2]u32 = undefined;
                if (!mesh.edgeIncidentFaces(edge, &incident)) break :edge_limit 0;
                const normal0 = faceNormal(mesh, &mesh.faces.items[incident[0]]);
                const normal1 = faceNormal(mesh, &mesh.faces.items[incident[1]]);
                if (@abs(dot3(normal0, normal1)) > BevelTuning.coplanar_normal_dot) break :edge_limit 0;
                const recede0 = mesh.edgeRecede(incident[0], edge) orelse break :edge_limit 0;
                const recede1 = mesh.edgeRecede(incident[1], edge) orelse break :edge_limit 0;
                const edge_length = length3(sub3(mesh.vertices.items[edge[1]].position, mesh.vertices.items[edge[0]].position));
                break :edge_limit @min(
                    edge_length * BevelTuning.vertex_edge_fraction,
                    @min(recede0.reach, recede1.reach) * BevelTuning.edge_reach_fraction,
                );
            },
            .vertex => |vertex| vertex_limit: {
                if (vertex >= mesh.vertices.items.len or !mesh.vertices.items[vertex].alive) break :vertex_limit 0;
                var incident = std.ArrayListUnmanaged(u32).empty;
                defer incident.deinit(mesh.allocator);
                var neighbors = std.ArrayListUnmanaged(u32).empty;
                defer neighbors.deinit(mesh.allocator);
                mesh.collectVertexNeighborhood(vertex, &incident, &neighbors) catch break :vertex_limit 0;
                if (neighbors.items.len < 3) break :vertex_limit 0;
                const origin = mesh.vertices.items[vertex].position;
                var shortest = std.math.inf(f32);
                for (neighbors.items) |neighbor| {
                    shortest = @min(shortest, length3(sub3(mesh.vertices.items[neighbor].position, origin)));
                }
                break :vertex_limit shortest * BevelTuning.vertex_edge_fraction;
            },
        };
        return if (std.math.isFinite(limit) and limit >= BevelTuning.minimum_width_m) limit else null;
    }

    fn replaceFaceVertex(mesh: *Mesh, face_id: u32, from: u32, replacements: []const u32) !bool {
        if (face_id >= mesh.faces.items.len or replacements.len == 0) return false;
        const face = &mesh.faces.items[face_id];
        const replace_at = indexOf(face.vertices.items, from) orelse return false;
        var vertices = std.ArrayListUnmanaged(u32).empty;
        errdefer vertices.deinit(mesh.allocator);
        var uvs = std.ArrayListUnmanaged(Vec2).empty;
        errdefer uvs.deinit(mesh.allocator);
        try vertices.ensureTotalCapacity(mesh.allocator, face.vertices.items.len - 1 + replacements.len);
        try uvs.ensureTotalCapacity(mesh.allocator, face.vertices.items.len - 1 + replacements.len);
        for (face.vertices.items, 0..) |vertex_id, corner| {
            const uv = if (corner < face.uvs.items.len) face.uvs.items[corner] else Vec2{ 0.5, 0.5 };
            if (corner == replace_at) {
                for (replacements) |replacement| {
                    vertices.appendAssumeCapacity(replacement);
                    uvs.appendAssumeCapacity(uv);
                }
            } else {
                vertices.appendAssumeCapacity(vertex_id);
                uvs.appendAssumeCapacity(uv);
            }
        }
        face.vertices.deinit(mesh.allocator);
        face.uvs.deinit(mesh.allocator);
        face.vertices = vertices;
        face.uvs = uvs;
        face.diagonal = if (face.vertices.items.len == 4) chosenQuadDiagonal(mesh, face) else null;
        face.source_tessellation_valid = false;
        return true;
    }

    fn loopNormal(mesh: *const Mesh, loop: []const u32) Vec3 {
        var normal = Vec3{ 0, 0, 0 };
        for (loop, 0..) |vertex_id, index| {
            const current = mesh.vertices.items[vertex_id].position;
            const next = mesh.vertices.items[loop[(index + 1) % loop.len]].position;
            normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
            normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
            normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
        }
        return norm3(normal);
    }

    fn loopCentroid(mesh: *const Mesh, loop: []const u32) Vec3 {
        var center = Vec3{ 0, 0, 0 };
        for (loop) |vertex_id| center = add3(center, mesh.vertices.items[vertex_id].position);
        return mul3(center, 1.0 / @as(f32, @floatFromInt(loop.len)));
    }

    fn meshCentroid(mesh: *const Mesh) Vec3 {
        var center = Vec3{ 0, 0, 0 };
        var count: u32 = 0;
        for (mesh.vertices.items) |vertex| {
            if (!vertex.alive) continue;
            center = add3(center, vertex.position);
            count += 1;
        }
        return if (count > 0) mul3(center, 1.0 / @as(f32, @floatFromInt(count))) else center;
    }

    fn orientLoopOutward(mesh: *const Mesh, loop: []u32, center: Vec3) void {
        if (loop.len < 3) return;
        const outward = sub3(mesh.loopCentroid(loop), center);
        if (dot3(mesh.loopNormal(loop), outward) < 0) std.mem.reverse(u32, loop);
    }

    fn appendSquareUvs(mesh: *const Mesh, loop: []const u32, out: *std.ArrayListUnmanaged(Vec2)) !void {
        const normal = mesh.loopNormal(loop);
        const ax = @abs(normal[0]);
        const ay = @abs(normal[1]);
        const az = @abs(normal[2]);
        const axis: u8 = if (ax >= ay and ax >= az) 0 else if (ay >= az) 1 else 2;
        var min_u = std.math.inf(f32);
        var min_v = std.math.inf(f32);
        var max_u = -std.math.inf(f32);
        var max_v = -std.math.inf(f32);
        for (loop) |vertex_id| {
            const p = mesh.vertices.items[vertex_id].position;
            const uv = if (axis == 0) Vec2{ p[2], p[1] } else if (axis == 1) Vec2{ p[0], p[2] } else Vec2{ p[0], p[1] };
            min_u = @min(min_u, uv[0]);
            min_v = @min(min_v, uv[1]);
            max_u = @max(max_u, uv[0]);
            max_v = @max(max_v, uv[1]);
        }
        const width = if (max_u - min_u > 1e-8) max_u - min_u else 1;
        const height = if (max_v - min_v > 1e-8) max_v - min_v else 1;
        for (loop) |vertex_id| {
            const p = mesh.vertices.items[vertex_id].position;
            const uv = if (axis == 0) Vec2{ p[2], p[1] } else if (axis == 1) Vec2{ p[0], p[2] } else Vec2{ p[0], p[1] };
            try out.append(mesh.allocator, .{ (uv[0] - min_u) / width, (uv[1] - min_v) / height });
        }
    }

    fn appendBevelFace(mesh: *Mesh, source_face_id: u32, loop: []const u32) !u32 {
        if (source_face_id >= mesh.faces.items.len or loop.len < 3) return error.InvalidBevelSource;
        const source = &mesh.faces.items[source_face_id];
        var face = Face{
            .id = @intCast(mesh.faces.items.len),
            .group = mesh.next_group,
            .part = source.part,
            .material = source.material,
            .semantic = source.semantic,
            .source_tessellation_valid = false,
        };
        mesh.next_group += 1;
        errdefer face.deinit(mesh.allocator);
        try face.vertices.appendSlice(mesh.allocator, loop);
        try mesh.appendSquareUvs(loop, &face.uvs);
        try face.source_triangles.appendSlice(mesh.allocator, source.source_triangles.items);
        if (face.vertices.items.len == 4) face.diagonal = chosenQuadDiagonal(mesh, &face);
        const id = face.id;
        try mesh.faces.append(mesh.allocator, face);
        return id;
    }

    fn pruneOrphanVertices(mesh: *Mesh) !void {
        const used = try mesh.allocator.alloc(bool, mesh.vertices.items.len);
        defer mesh.allocator.free(used);
        @memset(used, false);
        for (mesh.faces.items) |*face| {
            if (!face.alive) continue;
            for (face.vertices.items) |vertex_id| if (vertex_id < used.len) {
                used[vertex_id] = true;
            };
        }
        for (mesh.vertices.items, 0..) |*vertex, index| {
            if (!used[index]) vertex.alive = false;
        }
    }

    fn bevelEdge(mesh: *Mesh, edge: [2]u32, width: f32) !bool {
        var incident: [2]u32 = undefined;
        if (!mesh.edgeIncidentFaces(edge, &incident)) return false;
        const recede0 = mesh.edgeRecede(incident[0], edge) orelse return false;
        const recede1 = mesh.edgeRecede(incident[1], edge) orelse return false;
        var source0 = try mesh.faces.items[incident[0]].clone(mesh.allocator);
        defer source0.deinit(mesh.allocator);
        var source1 = try mesh.faces.items[incident[1]].clone(mesh.allocator);
        defer source1.deinit(mesh.allocator);
        const center = mesh.meshCentroid();
        const a = mesh.vertices.items[edge[0]].position;
        const b = mesh.vertices.items[edge[1]].position;
        const new_ids = [4]u32{
            @intCast(mesh.vertices.items.len),
            @intCast(mesh.vertices.items.len + 1),
            @intCast(mesh.vertices.items.len + 2),
            @intCast(mesh.vertices.items.len + 3),
        };
        try mesh.vertices.appendSlice(mesh.allocator, &.{
            Vertex{ .position = add3(a, mul3(recede0.direction, width)) },
            Vertex{ .position = add3(b, mul3(recede0.direction, width)) },
            Vertex{ .position = add3(a, mul3(recede1.direction, width)) },
            Vertex{ .position = add3(b, mul3(recede1.direction, width)) },
        });
        if (!try mesh.replaceFaceVertex(incident[0], edge[0], new_ids[0..1]) or
            !try mesh.replaceFaceVertex(incident[0], edge[1], new_ids[1..2]) or
            !try mesh.replaceFaceVertex(incident[1], edge[0], new_ids[2..3]) or
            !try mesh.replaceFaceVertex(incident[1], edge[1], new_ids[3..4]))
        {
            return false;
        }

        const original_face_count = mesh.faces.items.len;
        const Endpoint = struct {
            fn absorb(
                target_mesh: *Mesh,
                original_count: usize,
                incident_faces: [2]u32,
                first_source: *const Face,
                second_source: *const Face,
                sharp: u32,
                first_new: u32,
                second_new: u32,
                outward_center: Vec3,
            ) !void {
                var absorbed = false;
                var face_index: usize = 0;
                while (face_index < original_count) : (face_index += 1) {
                    if (face_index == incident_faces[0] or face_index == incident_faces[1]) continue;
                    const face = &target_mesh.faces.items[face_index];
                    if (!face.alive) continue;
                    const corner = indexOf(face.vertices.items, sharp) orelse continue;
                    const previous = face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len];
                    const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
                    const left = if (faceHasUndirectedEdge(first_source, previous, sharp))
                        first_new
                    else if (faceHasUndirectedEdge(second_source, previous, sharp))
                        second_new
                    else
                        sharp;
                    const right = if (faceHasUndirectedEdge(first_source, next, sharp))
                        first_new
                    else if (faceHasUndirectedEdge(second_source, next, sharp))
                        second_new
                    else
                        sharp;
                    const replacements = if (left == right) [2]u32{ left, left } else [2]u32{ left, right };
                    const replacement_slice = if (left == right) replacements[0..1] else replacements[0..2];
                    _ = try target_mesh.replaceFaceVertex(@intCast(face_index), sharp, replacement_slice);
                    absorbed = true;
                }
                var still_used = false;
                for (target_mesh.faces.items) |*face| {
                    if (face.alive and containsVertex(face, sharp)) {
                        still_used = true;
                        break;
                    }
                }
                if (!absorbed or still_used) {
                    var cap = [3]u32{ sharp, first_new, second_new };
                    target_mesh.orientLoopOutward(cap[0..], outward_center);
                    _ = try target_mesh.appendBevelFace(incident_faces[0], cap[0..]);
                }
            }
        };
        try Endpoint.absorb(mesh, original_face_count, incident, &source0, &source1, edge[0], new_ids[0], new_ids[2], center);
        try Endpoint.absorb(mesh, original_face_count, incident, &source0, &source1, edge[1], new_ids[1], new_ids[3], center);
        var chamfer = [4]u32{ new_ids[0], new_ids[1], new_ids[3], new_ids[2] };
        mesh.orientLoopOutward(chamfer[0..], center);
        _ = try mesh.appendBevelFace(incident[0], chamfer[0..]);
        try mesh.pruneOrphanVertices();
        return true;
    }

    fn bevelVertex(mesh: *Mesh, vertex: u32, width: f32) !bool {
        var incident = std.ArrayListUnmanaged(u32).empty;
        defer incident.deinit(mesh.allocator);
        var neighbors = std.ArrayListUnmanaged(u32).empty;
        defer neighbors.deinit(mesh.allocator);
        try mesh.collectVertexNeighborhood(vertex, &incident, &neighbors);
        if (neighbors.items.len < 3 or incident.items.len < 3) return false;

        const origin = mesh.vertices.items[vertex].position;
        const center = mesh.meshCentroid();
        var normal = Vec3{ 0, 0, 0 };
        for (incident.items) |face_id| normal = add3(normal, faceNormal(mesh, &mesh.faces.items[face_id]));
        normal = norm3(normal);
        if (length3(normal) < 0.5) return false;

        var on_edge = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer on_edge.deinit(mesh.allocator);
        for (neighbors.items) |neighbor| {
            const direction = norm3(sub3(mesh.vertices.items[neighbor].position, origin));
            const new_id: u32 = @intCast(mesh.vertices.items.len);
            try mesh.vertices.append(mesh.allocator, .{ .position = add3(origin, mul3(direction, width)) });
            try on_edge.put(mesh.allocator, neighbor, new_id);
        }
        for (incident.items) |face_id| {
            const face = &mesh.faces.items[face_id];
            const corner = indexOf(face.vertices.items, vertex) orelse return false;
            const previous = face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len];
            const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
            const replacements = [2]u32{ on_edge.get(previous) orelse return false, on_edge.get(next) orelse return false };
            if (!try mesh.replaceFaceVertex(face_id, vertex, replacements[0..])) return false;
        }

        const reference = if (@abs(normal[1]) < 0.9) Vec3{ 0, 1, 0 } else Vec3{ 1, 0, 0 };
        const u_axis = norm3(cross3(normal, reference));
        const v_axis = cross3(normal, u_axis);
        var ring = std.ArrayListUnmanaged(u32).empty;
        defer ring.deinit(mesh.allocator);
        for (neighbors.items) |neighbor| try ring.append(mesh.allocator, on_edge.get(neighbor).?);
        const SortContext = struct {
            target_mesh: *const Mesh,
            pivot: Vec3,
            u: Vec3,
            v: Vec3,
            fn lessThan(context: @This(), lhs: u32, rhs: u32) bool {
                const left = sub3(context.target_mesh.vertices.items[lhs].position, context.pivot);
                const right = sub3(context.target_mesh.vertices.items[rhs].position, context.pivot);
                const left_angle = std.math.atan2(dot3(left, context.v), dot3(left, context.u));
                const right_angle = std.math.atan2(dot3(right, context.v), dot3(right, context.u));
                return if (left_angle == right_angle) lhs < rhs else left_angle < right_angle;
            }
        };
        std.mem.sort(u32, ring.items, SortContext{ .target_mesh = mesh, .pivot = origin, .u = u_axis, .v = v_axis }, SortContext.lessThan);
        mesh.orientLoopOutward(ring.items, center);
        _ = try mesh.appendBevelFace(incident.items[0], ring.items);
        try mesh.pruneOrphanVertices();
        return true;
    }

    /// Chamfer one already-resolved target. Width is clamped to the topology's
    /// strict limit, so popup and headless callers share the same durable boundary.
    pub fn bevel(mesh: *Mesh, target: BevelTarget, width_raw: f32) !bool {
        const limit = mesh.bevelLimit(target) orelse return false;
        const width = @min(width_raw, limit);
        if (!std.math.isFinite(width) or width < BevelTuning.minimum_width_m) return false;
        return switch (target) {
            .edge => |edge| mesh.bevelEdge(edge, width),
            .vertex => |vertex| mesh.bevelVertex(vertex, width),
        };
    }

    fn directedEdgeKey(a: u32, b: u32) u64 {
        return (@as(u64, a) << 32) | b;
    }

    /// Chamfer one complete open boundary loop from the captured indexed base.
    /// Each old boundary edge receives a point near each endpoint; a new corner
    /// face makes the segment between those points the opening boundary while the
    /// old corner becomes an interior vertex. The operation is simultaneous, so
    /// adjacent corners cannot shorten or clamp one another in iteration order.
    pub fn chamferBoundary(mesh: *Mesh, loop: []const u32, width_raw: f32) !bool {
        const limit = mesh.boundaryChamferLimit(loop) orelse return false;
        const width = @min(width_raw, limit);
        if (!std.math.isFinite(width) or width < BoundaryChamferTuning.minimum_width_m) return false;

        var point_by_direction = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer point_by_direction.deinit(mesh.allocator);
        try point_by_direction.ensureTotalCapacity(mesh.allocator, @intCast(loop.len * 2));
        for (loop, 0..) |vertex, index| {
            const next = loop[(index + 1) % loop.len];
            const a = mesh.vertices.items[vertex].position;
            const b = mesh.vertices.items[next].position;
            const edge_length = length3(sub3(b, a));
            if (edge_length <= width * 2) return false;
            const direction = mul3(sub3(b, a), 1.0 / edge_length);
            const near_a: u32 = @intCast(mesh.vertices.items.len);
            const near_b: u32 = near_a + 1;
            try mesh.vertices.appendSlice(mesh.allocator, &.{
                Vertex{ .position = add3(a, mul3(direction, width)) },
                Vertex{ .position = add3(b, mul3(direction, -width)) },
            });
            try point_by_direction.put(mesh.allocator, directedEdgeKey(vertex, next), near_a);
            try point_by_direction.put(mesh.allocator, directedEdgeKey(next, vertex), near_b);
        }

        const original_face_count = mesh.faces.items.len;
        var face_index: usize = 0;
        while (face_index < original_face_count) : (face_index += 1) {
            const face = &mesh.faces.items[face_index];
            if (!face.alive or face.vertices.items.len < 3) continue;
            var split_edges: usize = 0;
            for (face.vertices.items, 0..) |vertex, corner| {
                const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
                if (point_by_direction.contains(directedEdgeKey(vertex, next))) split_edges += 1;
            }
            if (split_edges == 0) continue;

            var vertices = std.ArrayListUnmanaged(u32).empty;
            errdefer vertices.deinit(mesh.allocator);
            var uvs = std.ArrayListUnmanaged(Vec2).empty;
            errdefer uvs.deinit(mesh.allocator);
            try vertices.ensureTotalCapacity(mesh.allocator, face.vertices.items.len + split_edges * 2);
            try uvs.ensureTotalCapacity(mesh.allocator, face.vertices.items.len + split_edges * 2);
            for (face.vertices.items, 0..) |vertex, corner| {
                const next_corner = (corner + 1) % face.vertices.items.len;
                const next = face.vertices.items[next_corner];
                const uv = if (corner < face.uvs.items.len) face.uvs.items[corner] else Vec2{ 0.5, 0.5 };
                const next_uv = if (next_corner < face.uvs.items.len) face.uvs.items[next_corner] else Vec2{ 0.5, 0.5 };
                vertices.appendAssumeCapacity(vertex);
                uvs.appendAssumeCapacity(uv);
                const near_vertex = point_by_direction.get(directedEdgeKey(vertex, next)) orelse continue;
                const near_next = point_by_direction.get(directedEdgeKey(next, vertex)) orelse return false;
                const a = mesh.vertices.items[vertex].position;
                const b = mesh.vertices.items[next].position;
                const edge_length = length3(sub3(b, a));
                const fraction = width / edge_length;
                vertices.appendAssumeCapacity(near_vertex);
                vertices.appendAssumeCapacity(near_next);
                uvs.appendAssumeCapacity(.{
                    uv[0] + (next_uv[0] - uv[0]) * fraction,
                    uv[1] + (next_uv[1] - uv[1]) * fraction,
                });
                uvs.appendAssumeCapacity(.{
                    next_uv[0] + (uv[0] - next_uv[0]) * fraction,
                    next_uv[1] + (uv[1] - next_uv[1]) * fraction,
                });
            }
            face.vertices.deinit(mesh.allocator);
            face.uvs.deinit(mesh.allocator);
            face.vertices = vertices;
            face.uvs = uvs;
            face.diagonal = null;
            face.source_tessellation_valid = false;
        }

        for (loop, 0..) |vertex, index| {
            const previous = loop[(index + loop.len - 1) % loop.len];
            const next = loop[(index + 1) % loop.len];
            var cap = [3]u32{
                point_by_direction.get(directedEdgeKey(vertex, previous)) orelse return false,
                vertex,
                point_by_direction.get(directedEdgeKey(vertex, next)) orelse return false,
            };
            var source_face: ?u32 = null;
            var reference_normal = Vec3{ 0, 0, 0 };
            for (mesh.faces.items[0..original_face_count]) |*face| {
                if (!face.alive or !containsVertex(face, vertex)) continue;
                if (source_face == null) source_face = face.id;
                reference_normal = add3(reference_normal, faceNormal(mesh, face));
            }
            const source = source_face orelse return false;
            if (dot3(mesh.loopNormal(cap[0..]), reference_normal) < 0) std.mem.reverse(u32, cap[0..]);
            _ = try mesh.appendBevelFace(source, cap[0..]);
        }
        return true;
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
        var semantic_regions = std.ArrayListUnmanaged(u32).empty;
        defer semantic_regions.deinit(mesh.allocator);
        var semantic_instances = std.ArrayListUnmanaged(u32).empty;
        defer semantic_instances.deinit(mesh.allocator);

        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 3) continue;
            if (face.source_tessellation_valid and face.source_triangles.items.len > 0) {
                // Emit in resident row order, not the face's provenance order.
                // Import may move the first non-collapsed source to slot zero for
                // colour inheritance, and Merge Faces combines several source lists.
                // The render order itself remains authoritative.
                var source_triangle: u32 = 0;
                while (source_triangle < mesh.render_triangles.items.len) : (source_triangle += 1) {
                    var owned = false;
                    for (face.source_triangles.items) |candidate| {
                        if (candidate == source_triangle) {
                            owned = true;
                            break;
                        }
                    }
                    if (!owned) continue;
                    try emitResidentSourceTri(
                        mesh,
                        face,
                        source_triangle,
                        &positions,
                        &uvs,
                        &triangle_vertices,
                        &groups,
                        &sources,
                        &face_ids,
                        &parts,
                        &materials,
                        &semantic_regions,
                        &semantic_instances,
                    );
                }
            } else if (face.vertices.items.len == 4) {
                const tris = quadTriangles(mesh, face);
                try emitLoweredTri(mesh, face, tris[0], &positions, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials, &semantic_regions, &semantic_instances);
                try emitLoweredTri(mesh, face, tris[1], &positions, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials, &semantic_regions, &semantic_instances);
            } else {
                var corner: usize = 1;
                while (corner + 1 < face.vertices.items.len) : (corner += 1) {
                    try emitLoweredTri(mesh, face, .{ 0, corner, corner + 1 }, &positions, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials, &semantic_regions, &semantic_instances);
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
        errdefer mesh.allocator.free(material_owned);
        const semantic_region_owned = try semantic_regions.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(semantic_region_owned);
        const semantic_instance_owned = try semantic_instances.toOwnedSlice(mesh.allocator);
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
            .semantic_regions = semantic_region_owned,
            .semantic_instances = semantic_instance_owned,
            .tri_count = @intCast(group_owned.len),
        };
    }

    fn emitResidentSourceTri(
        mesh: *const Mesh,
        face: *const Face,
        source_triangle: u32,
        positions: *std.ArrayListUnmanaged(f32),
        uvs: *std.ArrayListUnmanaged(f32),
        triangle_vertices: *std.ArrayListUnmanaged([3]u32),
        groups: *std.ArrayListUnmanaged(u32),
        sources: *std.ArrayListUnmanaged(u32),
        face_ids: *std.ArrayListUnmanaged(u32),
        parts: *std.ArrayListUnmanaged(u32),
        materials: *std.ArrayListUnmanaged(u32),
        semantic_regions: *std.ArrayListUnmanaged(u32),
        semantic_instances: *std.ArrayListUnmanaged(u32),
    ) !void {
        if (source_triangle >= mesh.render_triangles.items.len or source_triangle >= mesh.render_uvs.items.len)
            return error.InvalidSourceTessellation;
        const triangle = mesh.render_triangles.items[source_triangle];
        const triangle_uvs = mesh.render_uvs.items[source_triangle];
        for (triangle, 0..) |vertex_id, corner| {
            if (vertex_id >= mesh.vertices.items.len) return error.InvalidSourceTessellation;
            const position = mesh.vertices.items[vertex_id].position;
            try positions.appendSlice(mesh.allocator, position[0..]);
            try uvs.appendSlice(mesh.allocator, triangle_uvs[corner][0..]);
        }
        try triangle_vertices.append(mesh.allocator, triangle);
        try groups.append(mesh.allocator, face.group);
        try sources.append(mesh.allocator, source_triangle);
        try face_ids.append(mesh.allocator, face.id);
        try parts.append(mesh.allocator, face.part);
        try materials.append(mesh.allocator, face.material);
        try semantic_regions.append(mesh.allocator, face.semantic.region);
        try semantic_instances.append(mesh.allocator, face.semantic.instance);
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
        semantic_regions: *std.ArrayListUnmanaged(u32),
        semantic_instances: *std.ArrayListUnmanaged(u32),
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
        try semantic_regions.append(mesh.allocator, face.semantic.region);
        try semantic_instances.append(mesh.allocator, face.semantic.instance);
    }

    /// Adopt metadata that was normalized after lowering, then make current render
    /// triangle ids the provenance basis for the next edit session. Vertex and face ids
    /// remain untouched.
    pub fn adoptLoweredMetadata(mesh: *Mesh, lowered: *const Lowered, groups: ?[]const u32, parts: ?[]const u32) void {
        // Reserve before clearing so allocation failure leaves the still-valid resident
        // mapping intact. A missing map would make the next position-only gizmo update
        // fail (or tempt this layer to reconstruct identity from soup order again).
        mesh.render_triangles.ensureTotalCapacity(mesh.allocator, lowered.triangle_vertices.len) catch return;
        mesh.render_uvs.ensureTotalCapacity(mesh.allocator, lowered.triangle_vertices.len) catch return;
        mesh.render_triangles.clearRetainingCapacity();
        mesh.render_uvs.clearRetainingCapacity();
        mesh.render_triangles.appendSliceAssumeCapacity(lowered.triangle_vertices);
        var render_index: usize = 0;
        while (render_index < lowered.triangle_vertices.len) : (render_index += 1) {
            const uv = render_index * 6;
            mesh.render_uvs.appendAssumeCapacity(.{
                .{ lowered.uvs[uv], lowered.uvs[uv + 1] },
                .{ lowered.uvs[uv + 2], lowered.uvs[uv + 3] },
                .{ lowered.uvs[uv + 4], lowered.uvs[uv + 5] },
            });
        }
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
            mesh.faces.items[face_id].source_tessellation_valid = true;
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

/// Recover authored quads from a raw triangle import without turning broad flat
/// surfaces (caps, floors, scans) into a single n-gon. Two source triangles share
/// an authored face only when they have exactly one manifold shared edge, lie on the
/// same plane with matching winding, and their four-point perimeter is convex.
/// Everything else deliberately remains a one-triangle face.
pub fn inferQuadFaceGroups(
    allocator: std.mem.Allocator,
    interleaved: []const f32,
    tri_count: u32,
) ![]u32 {
    var mesh = try Mesh.fromSoup(allocator, interleaved, tri_count, null, null);
    defer mesh.deinit();

    const selected = try allocator.alloc(bool, tri_count);
    defer allocator.free(selected);
    @memset(selected, true);

    const EdgeUse = struct { first: ?u32 = null, second: ?u32 = null, non_manifold: bool = false };
    var uses = std.AutoHashMapUnmanaged(u64, EdgeUse).empty;
    defer uses.deinit(allocator);
    for (mesh.render_triangles.items, 0..) |triangle, triangle_index| {
        for (0..3) |corner| {
            const edge = undirectedEdgeKey(triangle[corner], triangle[(corner + 1) % 3]);
            const entry = try uses.getOrPut(allocator, edge);
            if (!entry.found_existing) {
                entry.value_ptr.* = .{ .first = @intCast(triangle_index) };
            } else if (entry.value_ptr.second == null) {
                entry.value_ptr.second = @intCast(triangle_index);
            } else {
                entry.value_ptr.non_manifold = true;
            }
        }
    }

    const partners = try allocator.alloc(?u32, tri_count);
    defer allocator.free(partners);
    @memset(partners, null);
    var iterator = uses.iterator();
    while (iterator.next()) |entry| {
        const use = entry.value_ptr.*;
        const first = use.first orelse continue;
        const second = use.second orelse continue;
        if (use.non_manifold or partners[first] != null or partners[second] != null) continue;
        if (trianglesFormConvexQuad(&mesh, first, second)) {
            partners[first] = second;
            partners[second] = first;
        }
    }

    const groups = try allocator.alloc(u32, tri_count);
    @memset(groups, NO_GROUP);
    var next_group: u32 = 0;
    var triangle: u32 = 0;
    while (triangle < tri_count) : (triangle += 1) {
        if (groups[triangle] != NO_GROUP) continue;
        groups[triangle] = next_group;
        if (partners[triangle]) |partner| {
            if (groups[partner] == NO_GROUP) groups[partner] = next_group;
        }
        next_group += 1;
    }
    return groups;
}

/// Extend a weld's per-triangle deletion mask to whole authored faces that the
/// final vertex positions can no longer reconstruct. This is deliberately
/// evaluated through `Mesh.fromSoup`, the same boundary authority used by loop
/// cut, so Weld cannot accept a face that the next indexed edit rejects.
///
/// `touched` limits the repair to authored groups changed by this weld. A stale
/// malformed group elsewhere in the document must not be silently deleted as a
/// side effect of welding an unrelated surface.
pub fn maskMalformedWeldFaceGroups(
    allocator: std.mem.Allocator,
    interleaved: []const f32,
    final_positions: []const f32,
    tri_count: u32,
    groups: []const u32,
    parts: ?[]const u32,
    touched: []const bool,
    mask: []bool,
) !u32 {
    const triangle_count: usize = @intCast(tri_count);
    if (interleaved.len < triangle_count * 24 or
        final_positions.len < triangle_count * 9 or
        groups.len < triangle_count or
        touched.len < triangle_count or
        mask.len < triangle_count) return error.InvalidSoup;
    if (parts) |rows| if (rows.len < triangle_count) return error.InvalidParts;

    var candidates = std.AutoHashMapUnmanaged(u32, void).empty;
    defer candidates.deinit(allocator);
    for (0..triangle_count) |triangle| {
        const group = groups[triangle];
        if (touched[triangle] and group != NO_GROUP) try candidates.put(allocator, group, {});
    }

    var newly_masked: u32 = 0;
    var candidate_it = candidates.keyIterator();
    while (candidate_it.next()) |group_ptr| {
        const group = group_ptr.*;
        var survivor_count: usize = 0;
        for (0..triangle_count) |triangle| {
            if (groups[triangle] == group and !mask[triangle]) survivor_count += 1;
        }
        // A lone surviving triangle is already a valid authored face. This is
        // the normal adjacent-corner collapse of a quad: one degenerate source
        // triangle leaves and the other remains.
        if (survivor_count <= 1) continue;

        const probe_soup = try allocator.alloc(f32, survivor_count * 24);
        defer allocator.free(probe_soup);
        const probe_groups = try allocator.alloc(u32, survivor_count);
        defer allocator.free(probe_groups);
        const probe_parts = if (parts != null) try allocator.alloc(u32, survivor_count) else null;
        defer if (probe_parts) |rows| allocator.free(rows);

        var output_triangle: usize = 0;
        for (0..triangle_count) |triangle| {
            if (groups[triangle] != group or mask[triangle]) continue;
            const source_base = triangle * 24;
            const output_base = output_triangle * 24;
            @memcpy(probe_soup[output_base .. output_base + 24], interleaved[source_base .. source_base + 24]);
            for (0..3) |corner| {
                const position_base = triangle * 9 + corner * 3;
                const corner_base = output_base + corner * 8;
                @memcpy(probe_soup[corner_base .. corner_base + 3], final_positions[position_base .. position_base + 3]);
            }
            probe_groups[output_triangle] = group;
            if (probe_parts) |rows| rows[output_triangle] = parts.?[triangle];
            output_triangle += 1;
        }

        var probe = Mesh.fromSoup(
            allocator,
            probe_soup,
            @intCast(survivor_count),
            probe_groups,
            probe_parts,
        ) catch |err| {
            if (err != error.MalformedFaceBoundary) return err;
            for (0..triangle_count) |triangle| {
                if (groups[triangle] != group or mask[triangle]) continue;
                mask[triangle] = true;
                newly_masked += 1;
            }
            continue;
        };
        probe.deinit();
    }
    return newly_masked;
}

fn trianglesFormConvexQuad(mesh: *const Mesh, first: u32, second: u32) bool {
    const a = mesh.render_triangles.items[first];
    const b = mesh.render_triangles.items[second];
    var shared: [2]u32 = undefined;
    var shared_count: usize = 0;
    var first_tip: ?u32 = null;
    for (a) |vertex| {
        if (vertex == b[0] or vertex == b[1] or vertex == b[2]) {
            if (shared_count == shared.len) return false;
            shared[shared_count] = vertex;
            shared_count += 1;
        } else first_tip = vertex;
    }
    if (shared_count != 2 or first_tip == null) return false;
    var second_tip: ?u32 = null;
    for (b) |vertex| {
        if (vertex != shared[0] and vertex != shared[1]) second_tip = vertex;
    }
    if (second_tip == null) return false;

    const p0 = mesh.vertices.items[a[0]].position;
    const p1 = mesh.vertices.items[a[1]].position;
    const p2 = mesh.vertices.items[a[2]].position;
    const q0 = mesh.vertices.items[b[0]].position;
    const q1 = mesh.vertices.items[b[1]].position;
    const q2 = mesh.vertices.items[b[2]].position;
    const normal_a = norm3(cross3(sub3(p1, p0), sub3(p2, p0)));
    const normal_b = norm3(cross3(sub3(q1, q0), sub3(q2, q0)));
    if (length3(normal_a) < 0.5 or dot3(normal_a, normal_b) < MERGE_FACE_NORMAL_DOT_MIN) return false;

    const loop = [4]u32{ first_tip.?, shared[0], second_tip.?, shared[1] };
    var sign: f32 = 0;
    for (0..4) |index| {
        const here = mesh.vertices.items[loop[index]].position;
        const next = mesh.vertices.items[loop[(index + 1) % 4]].position;
        const after = mesh.vertices.items[loop[(index + 2) % 4]].position;
        const turn = dot3(cross3(sub3(next, here), sub3(after, next)), normal_a);
        if (@abs(turn) <= IMPORT_WELD_EPS) return false;
        if (sign == 0) {
            sign = if (turn > 0) 1 else -1;
        } else if ((turn > 0 and sign < 0) or (turn < 0 and sign > 0)) {
            return false;
        }
    }
    return true;
}

fn undirectedEdgeKey(a: u32, b: u32) u64 {
    return (@as(u64, @min(a, b)) << 32) | @as(u64, @max(a, b));
}

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

test "semantic membership survives indexed face splitting" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ -1, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ -1, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    const regions = [_]u32{ 7, 7 };
    const instances = [_]u32{ 2, 2 };
    var mesh = try Mesh.fromSoupWithSemantics(
        allocator,
        fixture.verts,
        2,
        fixture.groups,
        null,
        null,
        regions[0..],
        instances[0..],
    );
    defer mesh.deinit();
    try std.testing.expect(try mesh.cutSelected(&.{ true, true }, .{ 1, 0, 0 }, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expect(lowered.tri_count > 2);
    for (lowered.semantic_regions) |region| try std.testing.expectEqual(@as(u32, 7), region);
    for (lowered.semantic_instances) |instance| try std.testing.expectEqual(@as(u32, 2), instance);
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
    try std.testing.expect(try mesh.cutSelected(selected[0..], .{ 0, 1, 0 }, 1, 0.5));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 6), lowered.tri_count); // selected 2→4, neighbor stays 2
}

test "basic cut applies one world axis and offset phase to mirrored face rings" {
    const allocator = std.testing.allocator;
    // The right quad is the X reflection of the left with its loop reversed back
    // to the same surface normal — the ring shape produced by symmetrize.
    const quads = [_][4]Vec3{
        .{ .{ -2, 0, -1 }, .{ 0, 0, -1 }, .{ 0, 0, 1 }, .{ -2, 0, 1 } },
        .{ .{ 2, 0, 1 }, .{ 0, 0, 1 }, .{ 0, 0, -1 }, .{ 2, 0, -1 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, null);
    defer mesh.deinit();

    const original_vertex_count = mesh.vertices.items.len;
    const selected = [_]bool{ true, true, true, true };
    try std.testing.expect(try mesh.cutSelected(selected[0..], .{ 0, 0, 1 }, 1, 0.25));

    var cut_vertex_count: usize = 0;
    for (mesh.vertices.items[original_vertex_count..]) |vertex| {
        const origin = vertex.cut_origin orelse continue;
        cut_vertex_count += 1;
        const edge = sub3(
            mesh.vertices.items[origin.edge[1]].position,
            mesh.vertices.items[origin.edge[0]].position,
        );
        try std.testing.expect(@abs(dot3(norm3(edge), .{ 0, 0, 1 })) > 0.9999);
        // Offset 0.25 retains the seed face's established positive-end phase:
        // both opposite-winding halves land on the same z station.
        try std.testing.expectApproxEqAbs(@as(f32, 0.5), vertex.position[2], 0.00001);
    }
    try std.testing.expectEqual(@as(usize, 3), cut_vertex_count);

    mesh.repositionCutVertices(1, 0.4, .{ 0, 0, 1 });
    for (mesh.vertices.items[original_vertex_count..]) |vertex| {
        if (vertex.cut_origin == null) continue;
        try std.testing.expectApproxEqAbs(@as(f32, 0.2), vertex.position[2], 0.00001);
    }
}

test "basic cut multi-cut comb spreads the same world stations on mirrored rings" {
    const allocator = std.testing.allocator;
    // Same symmetrize-shaped fixture as the single-cut phase test above. With
    // cuts=2 the comb recursion must descend into the world-far child on BOTH
    // rings: before req_3825 the mirrored ring recursed into the near child and
    // its comb collapsed inward (stations {1/3, 1/6} of the span) while the
    // unmirrored twin spread evenly ({1/3, 2/3}).
    const quads = [_][4]Vec3{
        .{ .{ -2, 0, -1 }, .{ 0, 0, -1 }, .{ 0, 0, 1 }, .{ -2, 0, 1 } },
        .{ .{ 2, 0, 1 }, .{ 0, 0, 1 }, .{ 0, 0, -1 }, .{ 2, 0, -1 } },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 4, fixture.groups, null);
    defer mesh.deinit();

    const original_vertex_count = mesh.vertices.items.len;
    const selected = [_]bool{ true, true, true, true };
    try std.testing.expect(try mesh.cutSelected(selected[0..], .{ 0, 0, 1 }, 2, 0.5));

    // Even thirds of z∈[-1,1] are ±1/3. Both stations must appear, nothing else:
    // a ring-relative recursion leaves one side with a plane at z = 2/3 instead.
    var near_station: usize = 0;
    var far_station: usize = 0;
    for (mesh.vertices.items[original_vertex_count..]) |vertex| {
        if (vertex.cut_origin == null) continue;
        const z = vertex.position[2];
        try std.testing.expect(@abs(@abs(z) - 1.0 / 3.0) < 0.0001);
        if (z < 0) near_station += 1 else far_station += 1;
    }
    // Three welded verts per station line (x = -2, 0, 2).
    try std.testing.expectEqual(@as(usize, 3), near_station);
    try std.testing.expectEqual(@as(usize, 3), far_station);
}

test "basic cut world axis searches beyond collinear T-vertex ring edges" {
    const allocator = std.testing.allocator;
    var mesh = Mesh{ .allocator = allocator };
    defer mesh.deinit();
    try mesh.vertices.appendSlice(allocator, &.{
        .{ .position = .{ 0, 0, 0 } },
        .{ .position = .{ 1, 0, 0 } },
        .{ .position = .{ 2, 0, 0 } },
        .{ .position = .{ 2, 1, 0 } },
        .{ .position = .{ 0, 1, 0 } },
    });
    var face = Face{ .id = 0, .group = 0, .part = NO_PART };
    errdefer face.deinit(allocator);
    try face.vertices.appendSlice(allocator, &.{ 0, 1, 2, 3, 4 });
    try face.uvs.appendSlice(allocator, &.{ .{ 0, 0 }, .{ 0.5, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } });
    try mesh.faces.append(allocator, face);

    const side = mesh.cutSideAlignedToWorld(&mesh.faces.items[0], .{ 0, 1, 0 }).?;
    try std.testing.expectEqual(@as(u32, 2), side[0]);
    try std.testing.expectEqual(@as(u32, 3), side[1]);
}

test "basic cut keeps one station across side by side cut children" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 0, 1 }, .{ 0, 0, 1 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    const selected = [_]bool{ true, true };

    try std.testing.expect(try mesh.cutSelected(selected[0..], .{ 1, 0, 0 }, 1, 0.5));
    const seed = mesh.seedInfo(selected[0..]).?;
    const z_direction = if (@abs(dot3(seed.directions[0], .{ 0, 0, 1 })) >=
        @abs(dot3(seed.directions[1], .{ 0, 0, 1 })))
        seed.directions[0]
    else
        seed.directions[1];
    const before_cross_cut = mesh.vertices.items.len;
    try std.testing.expect(try mesh.cutSelected(selected[0..], z_direction, 1, 0.25));

    var station: ?f32 = null;
    var station_vertex_count: usize = 0;
    for (mesh.vertices.items[before_cross_cut..]) |vertex| {
        if (vertex.cut_origin == null) continue;
        station_vertex_count += 1;
        if (station) |expected| {
            try std.testing.expectApproxEqAbs(expected, vertex.position[2], 0.00001);
        } else {
            station = vertex.position[2];
        }
    }
    try std.testing.expectEqual(@as(usize, 3), station_vertex_count);
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
    try std.testing.expect(try mesh.cutSelected(first[0..], .{ 0, 1, 0 }, 1, 0.5));
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
    try std.testing.expect(try mesh.cutSelected(second, .{ 0, 1, 0 }, 1, 0.5));
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
    reused.repositionCutVertices(2, 0.75, null);

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

    try std.testing.expect(try mesh.symmetrizeParts(0, 0, true, &.{ true, false }));
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

test "per-part symmetrize repairs an off-origin part about its own centerline" {
    // The detached-head-rest case (req_3886): the part lives at x ∈ [10, 12],
    // nowhere near the model origin. Symmetrized about ITS plane (x = 11) it must
    // stay in place and come out symmetric — never reflect across the whole model.
    const allocator = std.testing.allocator;
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    const quad = [4]Vec3{
        .{ 10, 0, 0 }, .{ 12.5, 0, 0 }, .{ 12.5, 1, 0 }, .{ 10, 1, 0 },
    };
    try appendSoupTri(&soup, allocator, quad[0], quad[1], quad[2]);
    try appendSoupTri(&soup, allocator, quad[0], quad[2], quad[3]);
    const groups = [_]u32{ 0, 0 };
    const parts = [_]u32{ 0, 0 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 2, groups[0..], parts[0..]);
    defer mesh.deinit();

    try std.testing.expect(try mesh.symmetrizePartsAt(0, &.{11}, true, &.{true}));
    var min_x: f32 = std.math.floatMax(f32);
    var max_x: f32 = -std.math.floatMax(f32);
    for (mesh.faces.items) |face| {
        if (!face.alive) continue;
        for (face.vertices.items) |vertex_id| {
            const x = mesh.vertices.items[vertex_id].position[0];
            min_x = @min(min_x, x);
            max_x = @max(max_x, x);
        }
    }
    // keep_positive keeps x ≥ 11 ([11, 12.5]) and reflects it to [9.5, 11]: the
    // part stays put, symmetric about its own plane.
    try std.testing.expectApproxEqAbs(@as(f32, 9.5), min_x, 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 12.5), max_x, 0.0001);
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

    try std.testing.expectEqual(@as(u32, 1), try mesh.synchronizeMirrorDiagonals(1, .{ 0, 0, 0 }));
    try std.testing.expectEqual(@as(u32, 0), try mesh.synchronizeMirrorDiagonals(1, .{ 0, 0, 0 }));
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

test "import collapses exact same-winding duplicate faces and keeps reversed sheets" {
    const allocator = std.testing.allocator;
    // one panel authored THREE times: twice with identical winding (the req_3435
    // poison — the record player spindle carried 8 such pairs), once reversed
    // (a legitimate back-to-back two-sided sheet).
    const panel = [4]Vec3{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } };
    const reversed = [4]Vec3{ .{ 0, 1, 0 }, .{ 1, 1, 0 }, .{ 1, 0, 0 }, .{ 0, 0, 0 } };
    const quads = [_][4]Vec3{ panel, panel, reversed };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 6, fixture.groups, null);
    defer mesh.deinit();
    var alive: u32 = 0;
    for (mesh.faces.items) |*face| {
        if (face.alive) alive += 1;
    }
    try std.testing.expectEqual(@as(u32, 2), alive);
    // the keeper absorbed the duplicate's source triangles so selecting them
    // still resolves to one whole authored face
    try std.testing.expect(mesh.faces.items[0].alive);
    try std.testing.expectEqualSlices(u32, &.{ 0, 1, 2, 3 }, mesh.faces.items[0].source_triangles.items);
    try std.testing.expect(!mesh.faces.items[1].alive);
    try std.testing.expect(mesh.faces.items[2].alive);
}

test "cut vertices inside the weld tolerance count as degenerate" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    const selected = [_]bool{ true, true };

    var healthy = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer healthy.deinit();
    try std.testing.expect(try healthy.loopCut(selected[0..], 0, 1, 0.3));
    try std.testing.expectEqual(@as(u32, 0), healthy.degenerateCutVertexCount());

    // 0.05% of a 1-unit edge is inside IMPORT_WELD_EPS: the next soup rebuild
    // would weld these cut vertices onto the corners. The session door refuses
    // to preview/commit while this counter is non-zero.
    var poisoned = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer poisoned.deinit();
    try std.testing.expect(try poisoned.loopCut(selected[0..], 0, 1, 0.0005));
    try std.testing.expect(poisoned.degenerateCutVertexCount() > 0);
}

test "the loop walk passes back-to-back twin sheets and continues on the surface" {
    const allocator = std.testing.allocator;
    const edge_bottom = Vec3{ 0, 0, 0 };
    const edge_top = Vec3{ 0, 1, 0 };
    // Panels A and B share the (edge_bottom, edge_top) edge; between them sits a
    // reversed coincident interior pair T1/T2 that ALSO owns that edge — exactly
    // what per-face cap extrusion leaves along each fan spoke (req_3436). T1/T2
    // come BEFORE B in face order, so a naive walk would dive into the sandwich
    // and subdivide the coincident copies divergently.
    const quads = [_][4]Vec3{
        .{ .{ -1, 0, 0 }, edge_bottom, edge_top, .{ -1, 1, 0 } },
        .{ edge_bottom, edge_top, .{ 0.5, 1, 0.8 }, .{ 0.5, 0, 0.8 } },
        .{ .{ 0.5, 0, 0.8 }, .{ 0.5, 1, 0.8 }, edge_top, edge_bottom },
        .{ edge_bottom, .{ 1, 0, 0 }, .{ 1, 1, 0 }, edge_top },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 8, fixture.groups, null);
    defer mesh.deinit();

    const seed = &mesh.faces.items[0];
    var left_edge_index: ?u32 = null;
    for (seed.vertices.items, 0..) |vertex_id, index| {
        const next_id = seed.vertices.items[(index + 1) % seed.vertices.items.len];
        const a = mesh.vertices.items[vertex_id].position;
        const b = mesh.vertices.items[next_id].position;
        if (a[0] < -0.5 and b[0] < -0.5) left_edge_index = @intCast(index);
    }
    try std.testing.expect(left_edge_index != null);
    const twin1_before = try mesh.faces.items[1].clone(allocator);
    var twin1_copy = twin1_before;
    defer twin1_copy.deinit(allocator);
    const twin2_before = try mesh.faces.items[2].clone(allocator);
    var twin2_copy = twin2_before;
    defer twin2_copy.deinit(allocator);

    const selected = [_]bool{ true, true, false, false, false, false, false, false };
    try std.testing.expect(try mesh.loopCut(selected[0..], left_edge_index.?, 1, 0.5));

    // both twins kept their exact loops; the true surface neighbor B was split
    try std.testing.expectEqualSlices(u32, twin1_copy.vertices.items, mesh.faces.items[1].vertices.items);
    try std.testing.expectEqualSlices(u32, twin2_copy.vertices.items, mesh.faces.items[2].vertices.items);
    var alive: u32 = 0;
    for (mesh.faces.items) |*face| {
        if (face.alive) alive += 1;
    }
    try std.testing.expectEqual(@as(u32, 6), alive);
}

test "the loop walk crosses only real shared edges, never diagonal containment" {
    const allocator = std.testing.allocator;
    const edge_bottom = Vec3{ 0, 0, 0 };
    const edge_top = Vec3{ 0, 1, 0 };
    // A (left panel) propagates across (edge_bottom, edge_top). B holds BOTH of
    // those vertices but only diagonally (its authored diagonal is that edge); C
    // is the true neighbor sharing the actual edge — and sits AFTER B in face
    // order, so containment-based traversal would derail into B and rebuild it
    // as a bow-tie.
    const quads = [_][4]Vec3{
        .{ .{ -1, 0, 0 }, edge_bottom, edge_top, .{ -1, 1, 0 } },
        .{ edge_bottom, .{ 0.4, 0.5, 0.6 }, edge_top, .{ 0.4, 0.5, -0.6 } },
        .{ edge_bottom, .{ 1, 0, 0 }, .{ 1, 1, 0 }, edge_top },
    };
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 6, fixture.groups, null);
    defer mesh.deinit();

    // find A's loop index whose edge is the LEFT edge, so `opposite` becomes the
    // shared (edge_bottom, edge_top) edge
    const seed = &mesh.faces.items[0];
    var left_edge_index: ?u32 = null;
    for (seed.vertices.items, 0..) |vertex_id, index| {
        const next_id = seed.vertices.items[(index + 1) % seed.vertices.items.len];
        const a = mesh.vertices.items[vertex_id].position;
        const b = mesh.vertices.items[next_id].position;
        if (a[0] < -0.5 and b[0] < -0.5) left_edge_index = @intCast(index);
    }
    try std.testing.expect(left_edge_index != null);
    const diamond_before = try mesh.faces.items[1].clone(allocator);
    defer {
        var copy = diamond_before;
        copy.deinit(allocator);
    }

    const selected = [_]bool{ true, true, false, false, false, false };
    try std.testing.expect(try mesh.loopCut(selected[0..], left_edge_index.?, 1, 0.5));

    // the diamond kept its exact loop; the true neighbor C was the one split
    try std.testing.expectEqualSlices(u32, diamond_before.vertices.items, mesh.faces.items[1].vertices.items);
    var alive: u32 = 0;
    for (mesh.faces.items) |*face| {
        if (face.alive) alive += 1;
    }
    try std.testing.expectEqual(@as(u32, 5), alive);
}
