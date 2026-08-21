//! Indexed edit-mode mesh topology.
//!
//! Rendering still consumes non-indexed triangles. Editing does not: vertices have
//! stable numeric identities and faces own ordered vertex-id loops plus per-corner
//! UVs. Legacy soup import uses position tolerance exactly once; RJMD v5 hydration
//! supplies explicit logical ids and never position-welds. Every later operation
//! resolves adjacency by ids.

const std = @import("std");
const builtin = @import("builtin");
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
// Machine-chosen triangle pairing is a planar dissolve, not a general polygon
// stitch. Interactive Merge Faces is explicit user intent and may author a warped
// face while retaining its exact source tessellation; the bulk quadifier still
// uses this gate so it cannot silently fuse across a crease.
const MERGE_FACE_NORMAL_DOT_MIN: f32 = 0.9999;
const MERGE_FACE_PLANE_ABS_EPS: f32 = IMPORT_WELD_EPS * 2.0;
const MERGE_FACE_PLANE_REL_EPS: f32 = 0.00001;
// A mid-walk triangle passes the loop ring through only when the crossing keeps
// at least this much of the incoming rung's travel direction. Below it the
// crossing is essentially sideways — the promoted cylinder-cap fan entered from
// a side wall, where the reference's corner-dive to the fan center IS the
// straight continuation.
const TRI_PASS_MIN_ALIGNMENT: f32 = 0.1;

pub const Vec2 = [2]f32;
pub const Vec3 = [3]f32;

pub const PartitionedLogicalCorners = struct {
    rows: []u32,
    vertex_count: u32,

    pub fn deinit(result: *PartitionedLogicalCorners, allocator: std.mem.Allocator) void {
        allocator.free(result.rows);
        result.* = undefined;
    }
};

/// Re-key durable render-corner identity after authored faces change Outliner
/// ownership. Logical ids are shared only by corners that retain BOTH the same
/// prior identity and the same part. This preserves deliberate same-part seams,
/// while a detach splits the coincident addresses on opposite sides of its new
/// part boundary instead of letting a later transform bleed through the seam.
pub fn partitionLogicalCornersByPart(
    allocator: std.mem.Allocator,
    logical_rows: []const u32,
    face_parts: []const u32,
    logical_vertex_count: u32,
) !PartitionedLogicalCorners {
    if (logical_rows.len == 0 or logical_vertex_count == 0 or logical_rows.len != face_parts.len * 3)
        return error.InvalidLogicalTopology;
    const LogicalPart = struct { logical: u32, part: u32 };
    var ids = std.AutoHashMapUnmanaged(LogicalPart, u32).empty;
    defer ids.deinit(allocator);
    const rows = try allocator.alloc(u32, logical_rows.len);
    errdefer allocator.free(rows);
    var next: u32 = 0;
    for (logical_rows, 0..) |logical, corner| {
        if (logical >= logical_vertex_count) return error.InvalidLogicalTopology;
        const entry = try ids.getOrPut(allocator, .{
            .logical = logical,
            .part = face_parts[corner / 3],
        });
        if (!entry.found_existing) {
            entry.value_ptr.* = next;
            next += 1;
        }
        rows[corner] = entry.value_ptr.*;
    }
    return .{ .rows = rows, .vertex_count = next };
}

fn explicitLogicalRowsValid(
    allocator: std.mem.Allocator,
    interleaved: []const f32,
    rows: []const u32,
    logical_vertex_count: u32,
) bool {
    if (logical_vertex_count == 0 or interleaved.len != rows.len * 8 or rows.len == 0) return false;
    var min = [3]f64{ std.math.inf(f64), std.math.inf(f64), std.math.inf(f64) };
    var max = [3]f64{ -std.math.inf(f64), -std.math.inf(f64), -std.math.inf(f64) };
    for (rows, 0..) |id, corner| {
        if (id >= logical_vertex_count) return false;
        const at = corner * 8;
        for (0..3) |axis| {
            const value = interleaved[at + axis];
            if (!std.math.isFinite(value)) return false;
            const wide: f64 = value;
            min[axis] = @min(min[axis], wide);
            max[axis] = @max(max[axis], wide);
        }
    }
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const tolerance = 0.000001 * @max(@as(f64, 1), @sqrt(dx * dx + dy * dy + dz * dz));
    const tolerance_sq = tolerance * tolerance;
    var first_positions = std.AutoHashMapUnmanaged(u32, Vec3).empty;
    defer first_positions.deinit(allocator);
    for (rows, 0..) |id, corner| {
        const at = corner * 8;
        const position = Vec3{ interleaved[at], interleaved[at + 1], interleaved[at + 2] };
        const entry = first_positions.getOrPut(allocator, id) catch return false;
        if (!entry.found_existing) {
            entry.value_ptr.* = position;
            continue;
        }
        const prior = entry.value_ptr.*;
        const px: f64 = @as(f64, position[0]) - @as(f64, prior[0]);
        const py: f64 = @as(f64, position[1]) - @as(f64, prior[1]);
        const pz: f64 = @as(f64, position[2]) - @as(f64, prior[2]);
        if (px * px + py * py + pz * pz > tolerance_sq) return false;
    }
    return true;
}

/// One source of truth for choosing between competing triangle pairings.
/// Cardinality is always maximized first. These values only order the augmenting
/// paths inside that exact maximum, giving the preview popup three useful,
/// deterministic evaluations without changing how many quads are recovered.
const QuadifyTuning = struct {
    /// How far two triangles sharing a diagonal may FOLD across it and still be
    /// recovered as one authored quad, as cos(angle). For exactly two triangles over one
    /// shared edge, "coplanar" IS the dihedral angle, so this single number is the whole
    /// test — the general plane-distance sweep adds nothing for a pair.
    ///
    /// This used to run through selectedFacesAreCoplanar at MERGE_FACE_NORMAL_DOT_MIN =
    /// 0.9999 — agreement within 0.81 DEGREES. Imported quads are, in this file's own
    /// words, "routinely millimetres out of plane", so almost nothing qualified and
    /// Tris to Quads recovered 3 quads on a model with roughly 30 obvious ones (req_4143).
    /// 40° is the same default Blender's Tris-to-Quads ships: loose enough to recover a
    /// gently curved shell, tight enough that a hard crease is never fused into one face.
    const pair_normal_dot_min: f32 = 0.766044443; // cos(40°)
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
    /// The narrowest bevel/chamfer/N-gon inset worth minting, in METRES. This was
    /// `0.1 / 16.0` — 6.25 mm — a "tenth of a sixteenth of a block" voxel-era number
    /// sitting in a codebase whose ruled scale contract is 1 unit = 1 METRE (1 tile = 1 m,
    /// player 1.65 m). It silently refused every face whose inradius fell under 7.81 mm,
    /// i.e. anything narrower than ~15.6 mm — which is most panels on any real prop, so
    /// Bevel, Chamfer Boundary and Face to N-gon all worked on big test cubes and died on
    /// actual models (req_4125/req_4132).
    ///
    /// The honest floor is the mesh's OWN resolution: two vertices closer than
    /// IMPORT_WELD_EPS merge on the next soup→indexed rebuild, so an inset thinner than
    /// that writes topology that cannot survive its own save/load. Doubling it is the
    /// same margin this file already uses for its other weld-derived epsilons.
    pub const minimum_width_m: f32 = IMPORT_WELD_EPS * 2.0;
    pub const vertex_edge_fraction: f32 = 0.45;
    pub const edge_reach_fraction: f32 = 0.9;
    pub const coplanar_normal_dot: f32 = 0.999;
};

/// Selected-edge wireframe conversion uses the edge as the centerline of a
/// square strut. Values are half-extents in metres, so the generated tube is
/// `2 * radius` wide on both cross-section axes.
pub const EdgeTubeTuning = struct {
    pub const default_radius_m: f32 = 1.0 / 16.0;
    pub const minimum_radius_m: f32 = IMPORT_WELD_EPS * 2.0;
    pub const maximum_edge_fraction: f32 = 0.45;
    /// A square cross-section corner is sqrt(2) radii from its centerline. Shared
    /// vertices use that exact envelope for the junction box and tube inset.
    pub const junction_extent_radii: f32 = @sqrt(2.0);
};

/// One selected open boundary loop is chamfered as a unit. The caller chooses
/// any larger target side count; added sides are spread as evenly as possible
/// around the old corners while every untouched boundary span stays positive.
/// These limits are shared by the popup preview and headless callers.
pub const BoundaryChamferTuning = struct {
    pub const minimum_sides: usize = 3;
    pub const maximum_target_sides: usize = 256;
    pub const default_width_m: f32 = BevelTuning.default_width_m;
    pub const minimum_width_m: f32 = BevelTuning.minimum_width_m;
    pub const edge_fraction: f32 = 0.45;
};

pub const BoundaryChamferSelection = struct {
    sides_before: u32,
    default_target_sides: u32,
    minimum_target_sides: u32,
    maximum_target_sides: u32,
    max_width: f32,
};

/// One filled authored face can become a welded regular N-gon center plus a
/// deterministic transition ring. Width is the radial gap between the largest
/// regular polygon that fits the source face and the generated center polygon.
/// The center keeps the source face's authored group so the caller can select it
/// immediately and hand it to Extrude.
pub const FacePolygonTuning = struct {
    pub const minimum_target_sides: usize = 3;
    pub const maximum_target_sides: usize = 256;
    pub const default_target_sides: usize = 8;
    pub const minimum_width_m: f32 = BevelTuning.minimum_width_m;
    pub const default_width_fraction: f32 = 0.25;
    pub const maximum_width_fraction: f32 = 0.80;
    pub const planar_epsilon_m: f32 = IMPORT_WELD_EPS * 2.0;
    pub const barycentric_epsilon: f32 = 0.0001;
};

pub const FacePolygonSelection = struct {
    face_id: u32,
    selection_triangle: u32,
    sides_before: u32,
    default_target_sides: u32,
    minimum_target_sides: u32,
    maximum_target_sides: u32,
    default_width: f32,
    max_width: f32,
};

/// One disclosed tuning table owns every behavior-affecting face-fact threshold.
/// The table response publishes these values so native diagnostics and UI labels
/// cannot drift into different meanings.
pub const FaceFactTuning = struct {
    pub const area_definition = "sum_of_lowered_member_triangle_areas";
    pub const centroid_edge_clearance_definition = "min_distance_from_canonical_face_centroid_to_boundary_edge_line";
    pub const aspect_definition = "max_edge_over_twice_centroid_edge_clearance";
    pub const scale_epsilon: f32 = IMPORT_WELD_EPS;
    pub const tiny_area_relative_to_scale_squared: f32 = 0.000001;
    pub const zero_area_epsilon: f32 = IMPORT_WELD_EPS * IMPORT_WELD_EPS;
    pub const owner_capture_budget_us: u32 = 4000;

    pub fn tinyAreaThreshold(mesh_scale: f32) f32 {
        const finite_scale = if (std.math.isFinite(mesh_scale)) @max(mesh_scale, scale_epsilon) else scale_epsilon;
        return @max(
            scale_epsilon * scale_epsilon,
            finite_scale * finite_scale * tiny_area_relative_to_scale_squared,
        );
    }
};

pub const FaceDegeneracy = enum {
    repeated_vertex,
    nonfinite_position,
    short_edge,
    zero_normal,
    zero_area_member,
    too_few_corners,
};

pub const FaceConvexity = enum {
    convex,
    concave,
    indeterminate,
};

pub const FaceGeometryFacts = struct {
    corner_count: u32,
    triangle_count: u32,
    area: f32,
    perimeter: f32,
    centroid_edge_clearance: ?f32,
    min_edge: f32,
    max_edge: f32,
    aspect: ?f32,
    planarity_deviation: ?f32,
    convexity: FaceConvexity,
    degeneracy: std.EnumSet(FaceDegeneracy) = .empty,
};

pub const FaceOperation = enum {
    indexed_build,
    loop_cut,
    face_to_ngon,
    bevel,
    merge,
    extrude,
    solidify,
};

pub const OperationStatus = enum { allowed, blocked, not_analyzed };

pub const OperationRefusalCode = enum {
    duplicate_outgoing_boundary,
    too_few_boundary_edges,
    missing_boundary_continuation,
    boundary_did_not_close,
    mixed_material,
    mixed_semantic,
    no_face_selection,
    face_out_of_range,
    face_deleted,
    too_few_corners,
    too_many_corners,
    no_source_triangles,
    concave_boundary,
    zero_normal,
    non_planar,
    short_edge,
    too_small,
    invalid_frame,
    invalid_seed_edge,
    target_out_of_range,
    target_deleted,
    edge_not_manifold,
    coplanar_edge,
    invalid_recede,
    insufficient_valence,
    boundary_not_open,
    width_below_minimum,
};

pub const OperationMetrics = struct {
    boundary_edges: ?f32 = null,
    source_triangles: ?f32 = null,
    max_width: ?f32 = null,
    direction: ?f32 = null,
    seed_edge: ?f32 = null,
    valence: ?f32 = null,
};

pub const OperationEligibility = struct {
    status: OperationStatus,
    code: ?OperationRefusalCode = null,
    detail: []const u8,
    metrics: ?OperationMetrics = null,

    pub fn allowed(metrics: ?OperationMetrics) OperationEligibility {
        return .{ .status = .allowed, .detail = "", .metrics = metrics };
    }

    pub fn blocked(code: OperationRefusalCode, detail: []const u8, metrics: ?OperationMetrics) OperationEligibility {
        return .{ .status = .blocked, .code = code, .detail = detail, .metrics = metrics };
    }

    pub fn notAnalyzed() OperationEligibility {
        return .{ .status = .not_analyzed, .detail = "canonical noncommitting predicate is not exposed" };
    }
};

pub const FacePolygonFrame = struct {
    center: Vec3,
    normal: Vec3,
    u: Vec3,
    v: Vec3,
    centroid_edge_clearance: f32,
};

pub const FacePolygonEligibility = struct {
    eligibility: OperationEligibility,
    frame: ?FacePolygonFrame = null,
};

pub const LoopCutEligibility = struct {
    eligibility: OperationEligibility,
    seed_edge: ?[2]u32 = null,
};

pub const BevelContextKind = enum { edge, vertex, boundary };

pub const BevelContextTarget = union(BevelContextKind) {
    edge: [2]u32,
    vertex: u32,
    boundary: u32,
};

/// Test-only counters prove diagnostic analysis never invokes a committing
/// topology entry point. They are reset explicitly by the focused native test.
pub var operation_predicate_calls: [7]u64 = @splat(0);
pub var operation_mutation_calls: [7]u64 = @splat(0);
pub var last_operation_refusal: ?OperationEligibility = null;

pub fn resetOperationInstrumentation() void {
    operation_predicate_calls = @splat(0);
    operation_mutation_calls = @splat(0);
    last_operation_refusal = null;
}

fn notePredicate(operation: FaceOperation) void {
    if (builtin.is_test) operation_predicate_calls[@intFromEnum(operation)] += 1;
}

fn beginMutation(operation: FaceOperation) void {
    if (builtin.is_test) operation_mutation_calls[@intFromEnum(operation)] += 1;
    last_operation_refusal = null;
}

fn acceptOrRemember(eligibility: OperationEligibility) bool {
    if (eligibility.status == .allowed) return true;
    last_operation_refusal = eligibility;
    return false;
}

pub const BevelKind = enum { vertex, edge };
pub const BevelTarget = union(BevelKind) {
    vertex: u32,
    edge: [2]u32,
};
pub const BevelSelection = struct {
    target: BevelTarget,
    max_width: f32,
};

/// A simultaneously resolved manifold-edge set. `max_width` is the strictest
/// member limit, so one preview width can never partially bevel the selection.
pub const BevelEdgesSelection = struct {
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

/// Why one persisted authored-face bucket could not be reconstructed as one
/// closed logical boundary. These tags are durable provenance: callers must not
/// rediscover a different explanation by walking the degraded triangle faces.
pub const FaceBuildIssueCode = enum {
    duplicate_outgoing_boundary,
    too_few_boundary_edges,
    missing_boundary_continuation,
    boundary_did_not_close,
    mixed_material,
    mixed_semantic,
};

pub const FaceBuildIssue = struct {
    part: u32,
    source_group: u32,
    source_triangles: std.ArrayListUnmanaged(u32) = .empty,
    code: FaceBuildIssueCode,
    detail: []u8,
    degraded_to_groups: std.ArrayListUnmanaged(u32) = .empty,

    pub fn deinit(issue: *FaceBuildIssue, allocator: std.mem.Allocator) void {
        issue.source_triangles.deinit(allocator);
        allocator.free(issue.detail);
        issue.degraded_to_groups.deinit(allocator);
        issue.* = undefined;
    }

    fn clone(issue: *const FaceBuildIssue, allocator: std.mem.Allocator) !FaceBuildIssue {
        var out = FaceBuildIssue{
            .part = issue.part,
            .source_group = issue.source_group,
            .code = issue.code,
            .detail = try allocator.dupe(u8, issue.detail),
        };
        errdefer out.deinit(allocator);
        try out.source_triangles.appendSlice(allocator, issue.source_triangles.items);
        try out.degraded_to_groups.appendSlice(allocator, issue.degraded_to_groups.items);
        return out;
    }
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

/// Owned storage inspected before `Mesh.deinit` dereferences or frees it.  The
/// diagnostic is intentionally structural: a damaged owner must be reported at
/// the teardown boundary instead of turning an already-recoverable editor error
/// into a process-ending null-page access.
pub const MeshStorageField = enum {
    allocator_vtable,
    vertices,
    faces,
    build_issues,
    render_triangles,
    render_normals,
    render_uvs,
    face_vertices,
    face_uvs,
    face_source_triangles,
    build_issue_source_triangles,
    build_issue_detail,
    build_issue_degraded_to_groups,
};

pub const MeshDeinitRefusal = struct {
    field: MeshStorageField,
    /// Row within `faces` or `build_issues`; null for a top-level field.
    owner_index: ?usize = null,
    address: usize,
    len: usize,
    capacity: usize,
};

const minimum_plausible_owned_address: usize = std.heap.page_size_min;

fn ownedHeaderRefusal(
    comptime T: type,
    items: []const T,
    capacity: usize,
    field: MeshStorageField,
    owner_index: ?usize,
) ?MeshDeinitRefusal {
    if (items.len > capacity) return .{
        .field = field,
        .owner_index = owner_index,
        .address = @intFromPtr(items.ptr),
        .len = items.len,
        .capacity = capacity,
    };
    if (capacity == 0) return null;

    const address = @intFromPtr(items.ptr);
    const byte_count = std.math.mul(usize, capacity, @sizeOf(T)) catch return .{
        .field = field,
        .owner_index = owner_index,
        .address = address,
        .len = items.len,
        .capacity = capacity,
    };
    if (byte_count == 0 or
        address < minimum_plausible_owned_address or
        address % @alignOf(T) != 0)
    {
        return .{
            .field = field,
            .owner_index = owner_index,
            .address = address,
            .len = items.len,
            .capacity = capacity,
        };
    }
    return null;
}

fn ownedListRefusal(
    comptime T: type,
    list: std.ArrayListUnmanaged(T),
    field: MeshStorageField,
    owner_index: ?usize,
) ?MeshDeinitRefusal {
    return ownedHeaderRefusal(T, list.items, list.capacity, field, owner_index);
}

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
    /// Exact per-render-corner normals (nine floats per triangle). Imported
    /// source tessellation retains its authored rows; newly tessellated faces
    /// receive the deterministic geometric normal used by the lowered soup.
    normals: []f32,
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

    /// Point every render triangle minted after the captured topology boundary
    /// at one caller-owned atlas texel. Existing triangles retain exact UVs.
    pub fn pointFreshFacesAtUv(lowered: *Lowered, first_face_id: u32, uv: Vec2) bool {
        if (lowered.uvs.len != lowered.face_ids.len * 6 or
            !std.math.isFinite(uv[0]) or !std.math.isFinite(uv[1])) return false;
        for (lowered.face_ids, 0..) |face_id, triangle| {
            if (face_id < first_face_id) continue;
            const at = triangle * 6;
            for (0..3) |corner| {
                lowered.uvs[at + corner * 2] = uv[0];
                lowered.uvs[at + corner * 2 + 1] = uv[1];
            }
        }
        return true;
    }

    pub fn deinit(lowered: *Lowered) void {
        lowered.allocator.free(lowered.positions);
        lowered.allocator.free(lowered.normals);
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

/// A face-group table rewritten into the Outliner's ownership law: every part owns
/// one contiguous interval of authored group ids, ordered by part and then by each
/// group's first displayed face. Faces without a part are kept after all declared
/// ranges. The geometry does not change; this is the metadata partition that lets a
/// topology preview expose every face it just minted inside the focused part.
pub const GroupPartPartition = struct {
    groups: []u32,
    ranges: []u32,

    pub fn deinit(partition: *GroupPartPartition, allocator: std.mem.Allocator) void {
        allocator.free(partition.groups);
        allocator.free(partition.ranges);
        partition.* = undefined;
    }
};

pub fn partitionFaceGroupsByPart(
    allocator: std.mem.Allocator,
    groups: []const u32,
    face_parts: []const u32,
    part_count: u32,
) !GroupPartPartition {
    if (groups.len != face_parts.len) return error.InvalidFacePartTable;
    for (face_parts) |owner| {
        if (owner != NO_PART and owner >= part_count) return error.InvalidPartOwner;
    }

    const normalized = try allocator.dupe(u32, groups);
    errdefer allocator.free(normalized);
    const ranges = try allocator.alloc(u32, @as(usize, part_count) * 2);
    errdefer allocator.free(ranges);

    var next: u32 = 0;
    var pass: u32 = 0;
    while (pass <= part_count) : (pass += 1) {
        const wanted = if (pass == part_count) NO_PART else pass;
        const start = next;
        var remap = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer remap.deinit(allocator);
        for (groups, face_parts, 0..) |group, owner, face| {
            if (owner != wanted) continue;
            if (group == NO_GROUP) {
                normalized[face] = NO_GROUP;
                continue;
            }
            const entry = try remap.getOrPut(allocator, group);
            if (!entry.found_existing) {
                entry.value_ptr.* = next;
                next += 1;
            }
            normalized[face] = entry.value_ptr.*;
        }
        if (pass < part_count) {
            ranges[@as(usize, pass) * 2] = start;
            ranges[@as(usize, pass) * 2 + 1] = next;
        }
    }
    return .{ .groups = normalized, .ranges = ranges };
}

pub const Mesh = struct {
    allocator: std.mem.Allocator,
    vertices: std.ArrayListUnmanaged(Vertex) = .empty,
    faces: std.ArrayListUnmanaged(Face) = .empty,
    /// Original authored buckets that had to degrade into independently
    /// selectable triangle faces. The table and persistence adapters consume
    /// this exact record; neither repeats the canonical boundary walk.
    build_issues: std.ArrayListUnmanaged(FaceBuildIssue) = .empty,
    /// Stable vertex ids for each triangle/corner in the CURRENT resident soup order.
    /// Imports preserve the source diagonal/order; lowering replaces this map with the
    /// deterministic derived order. Position-only gizmo mutations must use this map,
    /// never guess that an old model was already lowered by today's diagonal policy.
    render_triangles: std.ArrayListUnmanaged([3]u32) = .empty,
    /// Exact normals paired with `render_triangles`. Unlike logical positions,
    /// normal splits are render-corner data and must survive a cold diff.
    render_normals: std.ArrayListUnmanaged([3]Vec3) = .empty,
    /// Exact per-corner UVs paired with `render_triangles`. Authored n-gons may be
    /// concave and their source triangles may sample independent atlas pins, so a
    /// polygon fan cannot reconstruct this state.
    render_uvs: std.ArrayListUnmanaged([3]Vec2) = .empty,
    next_group: u32 = 0,
    /// Distinguishes an authoritative RJMD-v5 import from a legacy soup whose
    /// position weld happened to mint the same numeric vertex ids.
    has_explicit_logical_topology: bool = false,

    pub fn deinit(mesh: *Mesh) void {
        _ = mesh.deinitChecked(@returnAddress());
    }

    /// Return the first corrupt owned-storage header without dereferencing it.
    /// This catches the concrete crash signature where `faces.items.ptr == 0x3`,
    /// along with length/capacity corruption and equivalent nested list damage.
    /// It cannot prove that an otherwise plausible arbitrary address is mapped;
    /// allocator provenance remains the owning subsystem's responsibility.
    pub fn deinitRefusal(mesh: *const Mesh) ?MeshDeinitRefusal {
        const allocator_vtable_address = @intFromPtr(mesh.allocator.vtable);
        if (allocator_vtable_address < minimum_plausible_owned_address or
            allocator_vtable_address % @alignOf(std.mem.Allocator.VTable) != 0)
        {
            return .{
                .field = .allocator_vtable,
                .address = allocator_vtable_address,
                .len = 0,
                .capacity = 0,
            };
        }
        if (ownedListRefusal(Vertex, mesh.vertices, .vertices, null)) |refusal| return refusal;
        if (ownedListRefusal(Face, mesh.faces, .faces, null)) |refusal| return refusal;
        if (ownedListRefusal(FaceBuildIssue, mesh.build_issues, .build_issues, null)) |refusal| return refusal;
        if (ownedListRefusal([3]u32, mesh.render_triangles, .render_triangles, null)) |refusal| return refusal;
        if (ownedListRefusal([3]Vec3, mesh.render_normals, .render_normals, null)) |refusal| return refusal;
        if (ownedListRefusal([3]Vec2, mesh.render_uvs, .render_uvs, null)) |refusal| return refusal;

        for (mesh.faces.items, 0..) |face, index| {
            if (ownedListRefusal(u32, face.vertices, .face_vertices, index)) |refusal| return refusal;
            if (ownedListRefusal(Vec2, face.uvs, .face_uvs, index)) |refusal| return refusal;
            if (ownedListRefusal(u32, face.source_triangles, .face_source_triangles, index)) |refusal| return refusal;
        }
        for (mesh.build_issues.items, 0..) |issue, index| {
            if (ownedListRefusal(u32, issue.source_triangles, .build_issue_source_triangles, index)) |refusal| return refusal;
            if (ownedHeaderRefusal(u8, issue.detail, issue.detail.len, .build_issue_detail, index)) |refusal| return refusal;
            if (ownedListRefusal(u32, issue.degraded_to_groups, .build_issue_degraded_to_groups, index)) |refusal| return refusal;
        }
        return null;
    }

    /// Teardown with a refusal receipt.  On corruption no pointer is
    /// dereferenced or freed: the owner is left intact for postmortem logging,
    /// and the caller may safely drop/quarantine the containing object.
    pub fn deinitChecked(mesh: *Mesh, caller_address: usize) bool {
        if (mesh.deinitRefusal()) |refusal| {
            if (refusal.owner_index) |index| {
                std.debug.print(
                    "[indexed-edit] REFUSING Mesh.deinit: corrupt {s}[{}] header mesh=0x{x} ptr=0x{x} len={} cap={} caller=0x{x}; ownership left untouched\n",
                    .{ @tagName(refusal.field), index, @intFromPtr(mesh), refusal.address, refusal.len, refusal.capacity, caller_address },
                );
            } else {
                std.debug.print(
                    "[indexed-edit] REFUSING Mesh.deinit: corrupt {s} header mesh=0x{x} ptr=0x{x} len={} cap={} caller=0x{x}; ownership left untouched\n",
                    .{ @tagName(refusal.field), @intFromPtr(mesh), refusal.address, refusal.len, refusal.capacity, caller_address },
                );
            }
            return false;
        }
        for (mesh.faces.items) |*face| face.deinit(mesh.allocator);
        mesh.faces.deinit(mesh.allocator);
        for (mesh.build_issues.items) |*issue| issue.deinit(mesh.allocator);
        mesh.build_issues.deinit(mesh.allocator);
        mesh.vertices.deinit(mesh.allocator);
        mesh.render_triangles.deinit(mesh.allocator);
        mesh.render_normals.deinit(mesh.allocator);
        mesh.render_uvs.deinit(mesh.allocator);
        mesh.* = undefined;
        return true;
    }

    pub fn clone(mesh: *const Mesh) !Mesh {
        var out = Mesh{
            .allocator = mesh.allocator,
            .next_group = mesh.next_group,
            .has_explicit_logical_topology = mesh.has_explicit_logical_topology,
        };
        errdefer out.deinit();
        try out.vertices.appendSlice(mesh.allocator, mesh.vertices.items);
        try out.render_triangles.appendSlice(mesh.allocator, mesh.render_triangles.items);
        try out.render_normals.appendSlice(mesh.allocator, mesh.render_normals.items);
        try out.render_uvs.appendSlice(mesh.allocator, mesh.render_uvs.items);
        for (mesh.faces.items) |*face| {
            var copied = try face.clone(mesh.allocator);
            errdefer copied.deinit(mesh.allocator);
            try out.faces.append(mesh.allocator, copied);
        }
        for (mesh.build_issues.items) |*issue| {
            var copied = try issue.clone(mesh.allocator);
            errdefer copied.deinit(mesh.allocator);
            try out.build_issues.append(mesh.allocator, copied);
        }
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
        if (mesh.render_triangles.items.len != tri_count or
            mesh.render_normals.items.len != tri_count or
            mesh.render_uvs.items.len != tri_count) return false;
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
    /// metadata. A cached topology with stale UV rows must be re-imported before
    /// the next structural edit or it would lower stale atlas coordinates over the
    /// model. Position transforms intentionally recompute normals, so normals do
    /// not participate in this PRE-transform guard; updatePositionsFromInterleaved
    /// adopts those rows together with the new positions.
    pub fn residentUvsMatch(mesh: *const Mesh, interleaved: []const f32, tri_count: u32) bool {
        if (mesh.render_uvs.items.len != tri_count or
            interleaved.len < @as(usize, tri_count) * 24) return false;
        for (mesh.render_uvs.items, 0..) |triangle_uvs, triangle| {
            for (triangle_uvs, 0..) |uv, corner| {
                const base = (triangle * 3 + corner) * 8;
                if (uv[0] != interleaved[base + 6] or uv[1] != interleaved[base + 7]) return false;
            }
        }
        return true;
    }

    /// Exact position guard for a cached resident lowering. Save recovery may only
    /// restore stable logical ids from an explicit indexed cache when every current
    /// render corner still names the same indexed vertex position. Unlike the live
    /// position-update path, this is read-only: it proves provenance rather than
    /// adopting an anonymous soup's positions into the cache.
    pub fn residentPositionsMatch(mesh: *const Mesh, interleaved: []const f32, tri_count: u32) bool {
        if (mesh.render_triangles.items.len != tri_count or
            interleaved.len < @as(usize, tri_count) * 24) return false;
        for (mesh.render_triangles.items, 0..) |triangle, rendered| {
            for (triangle, 0..) |vertex_id, corner| {
                if (vertex_id >= mesh.vertices.items.len) return false;
                const position = mesh.vertices.items[vertex_id].position;
                const base = (rendered * 3 + corner) * 8;
                if (position[0] != interleaved[base] or
                    position[1] != interleaved[base + 1] or
                    position[2] != interleaved[base + 2]) return false;
            }
        }
        return true;
    }

    /// Exact render-channel guard for clone/metadata-only paths. Those paths do
    /// not own a position transform and therefore may not silently absorb changed
    /// normal rows from some external writer.
    pub fn residentRenderChannelsMatch(mesh: *const Mesh, interleaved: []const f32, tri_count: u32) bool {
        if (!mesh.residentUvsMatch(interleaved, tri_count) or
            mesh.render_normals.items.len != tri_count) return false;
        for (mesh.render_normals.items, 0..) |triangle_normals, triangle| {
            for (triangle_normals, 0..) |normal, corner| {
                const base = (triangle * 3 + corner) * 8;
                if (normal[0] != interleaved[base + 3] or
                    normal[1] != interleaved[base + 4] or
                    normal[2] != interleaved[base + 5]) return false;
            }
        }
        return true;
    }

    /// Exact cache guard for the RJMD-v5 corner map. Numeric ids alone are not
    /// sufficient: a legacy position weld can coincidentally produce the same row.
    pub fn residentLogicalTopologyMatches(
        mesh: *const Mesh,
        rows: ?[]const u32,
        logical_vertex_count: u32,
    ) bool {
        const logical_rows = rows orelse return !mesh.has_explicit_logical_topology;
        if (!mesh.has_explicit_logical_topology or
            logical_vertex_count != mesh.vertices.items.len or
            logical_rows.len != mesh.render_triangles.items.len * 3)
        {
            return false;
        }
        for (mesh.render_triangles.items, 0..) |triangle, index| {
            if (!std.mem.eql(u32, triangle[0..], logical_rows[index * 3 .. index * 3 + 3])) return false;
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
        metadata_issue: ?FaceBuildIssueCode = null,
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
        return fromSoupInternal(
            allocator,
            interleaved,
            tri_count,
            groups,
            parts,
            materials,
            semantic_regions,
            semantic_instances,
            null,
        );
    }

    /// RJMD v5 import. The render-corner table is the topology authority, so this
    /// path never enters the legacy quantized-position weld. UV/normal duplicates
    /// become repeated references to the same stable native vertex id.
    pub fn fromSoupWithLogicalSemantics(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
        materials: ?[]const u32,
        semantic_regions: ?[]const u32,
        semantic_instances: ?[]const u32,
        render_corner_logical_ids: []const u32,
        logical_vertex_count: u32,
    ) !Mesh {
        return fromSoupInternal(
            allocator,
            interleaved,
            tri_count,
            groups,
            parts,
            materials,
            semantic_regions,
            semantic_instances,
            .{ .rows = render_corner_logical_ids, .vertex_count = logical_vertex_count },
        );
    }

    const ExplicitLogicalTopology = struct {
        rows: []const u32,
        vertex_count: u32,
    };

    fn fromSoupInternal(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        tri_count: u32,
        groups: ?[]const u32,
        parts: ?[]const u32,
        materials: ?[]const u32,
        semantic_regions: ?[]const u32,
        semantic_instances: ?[]const u32,
        explicit_logical: ?ExplicitLogicalTopology,
    ) !Mesh {
        if (interleaved.len < @as(usize, tri_count) * 24) return error.InvalidSoup;
        if (groups) |rows| if (rows.len < tri_count) return error.InvalidGroups;
        if (parts) |rows| if (rows.len < tri_count) return error.InvalidParts;
        if (materials) |rows| if (rows.len < tri_count) return error.InvalidMaterials;
        if (!mesh_semantics.rowsValid(semantic_regions, semantic_instances, tri_count)) return error.InvalidSemantics;
        if (explicit_logical) |logical| {
            const corner_count = @as(usize, tri_count) * 3;
            if (logical.rows.len != corner_count or
                !explicitLogicalRowsValid(
                    allocator,
                    interleaved[0 .. corner_count * 8],
                    logical.rows,
                    logical.vertex_count,
                )) return error.InvalidLogicalTopology;
        }

        var mesh = Mesh{ .allocator = allocator };
        mesh.has_explicit_logical_topology = explicit_logical != null;
        errdefer mesh.deinit();
        var weld = std.AutoHashMapUnmanaged(WeldKey, u32).empty;
        defer weld.deinit(allocator);
        var weld_candidates = std.ArrayListUnmanaged(WeldCandidate).empty;
        defer weld_candidates.deinit(allocator);
        const corner_vertex = try allocator.alloc(u32, @as(usize, tri_count) * 3);
        defer allocator.free(corner_vertex);
        var logical_seen: ?[]bool = null;
        defer if (logical_seen) |seen| allocator.free(seen);
        if (explicit_logical) |logical| {
            const seen = try allocator.alloc(bool, logical.vertex_count);
            @memset(seen, false);
            logical_seen = seen;
            try mesh.vertices.ensureTotalCapacity(allocator, logical.vertex_count);
            for (0..logical.vertex_count) |_| mesh.vertices.appendAssumeCapacity(.{
                .position = .{ 0, 0, 0 },
                .alive = false,
            });
        }

        var triangle: u32 = 0;
        while (triangle < tri_count) : (triangle += 1) {
            const part = if (parts) |rows| rows[triangle] else NO_PART;
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                const base = (@as(usize, triangle) * 3 + corner) * 8;
                const p = Vec3{ interleaved[base], interleaved[base + 1], interleaved[base + 2] };
                if (explicit_logical) |logical| {
                    const vertex_id = logical.rows[triangle * 3 + corner];
                    if (!logical_seen.?[vertex_id]) {
                        mesh.vertices.items[vertex_id] = .{ .position = p };
                        logical_seen.?[vertex_id] = true;
                    }
                    corner_vertex[triangle * 3 + corner] = vertex_id;
                    continue;
                }
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
            try mesh.render_normals.append(allocator, .{
                .{ interleaved[(@as(usize, triangle) * 3 + 0) * 8 + 3], interleaved[(@as(usize, triangle) * 3 + 0) * 8 + 4], interleaved[(@as(usize, triangle) * 3 + 0) * 8 + 5] },
                .{ interleaved[(@as(usize, triangle) * 3 + 1) * 8 + 3], interleaved[(@as(usize, triangle) * 3 + 1) * 8 + 4], interleaved[(@as(usize, triangle) * 3 + 1) * 8 + 5] },
                .{ interleaved[(@as(usize, triangle) * 3 + 2) * 8 + 3], interleaved[(@as(usize, triangle) * 3 + 2) * 8 + 4], interleaved[(@as(usize, triangle) * 3 + 2) * 8 + 5] },
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
                    // Retain this as typed build provenance. The bucket is degraded
                    // below, where each triangle keeps its own material row.
                    if (bucket.metadata_issue == null) bucket.metadata_issue = .mixed_material;
                }
                const semantic = mesh_semantics.Face{
                    .region = if (semantic_regions) |rows| rows[triangle] else mesh_semantics.NO_ID,
                    .instance = if (semantic_instances) |rows| rows[triangle] else mesh_semantics.NO_ID,
                };
                if (!mesh_semantics.eql(bucket.semantic, semantic) and bucket.metadata_issue == null) {
                    bucket.metadata_issue = .mixed_semantic;
                }
            }
            try buckets.items[entry.value_ptr.*].triangles.append(allocator, triangle);
            if (group != NO_GROUP and group >= mesh.next_group) mesh.next_group = group + 1;
        }

        for (buckets.items) |*bucket| {
            switch (try buildFaceFromBucket(allocator, interleaved, corner_vertex, bucket)) {
                .face => |built| {
                    var face = built;
                    face.id = @intCast(mesh.faces.items.len);
                    try mesh.faces.append(allocator, face);
                },
                .issue => |build_issue| {
                    // Append the provenance BEFORE degrading so the exact target
                    // groups are filled on the resident record as they are minted.
                    const issue_index = mesh.build_issues.items.len;
                    try mesh.build_issues.append(allocator, build_issue);
                    try appendDegradedBucket(
                        &mesh,
                        allocator,
                        interleaved,
                        corner_vertex,
                        bucket,
                        parts,
                        materials,
                        semantic_regions,
                        semantic_instances,
                        &mesh.build_issues.items[issue_index].degraded_to_groups,
                    );
                },
            }
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

    /// Source triangle and authored group of the face bucket that last failed to close a
    /// boundary loop. `error.MalformedFaceBoundary` rejects the WHOLE composite mesh, so a
    /// single bad face group silently blocks EVERY topology op on the model — loop cut,
    /// Basic Cut, bevel, merge-faces, tris-to-quads. The offender has to be nameable, not
    /// just countable, or the only repair advice possible is "rebuild the model" (req_4114).
    pub var last_malformed_triangle: i64 = -1;
    pub var last_malformed_group: i64 = -1;

    fn noteMalformedBoundary(bucket: *const Bucket) void {
        last_malformed_triangle = if (bucket.triangles.items.len > 0) @intCast(bucket.triangles.items[0]) else -1;
        last_malformed_group = @intCast(bucket.group);
    }

    const FaceBuildResult = union(enum) {
        face: Face,
        issue: FaceBuildIssue,
    };

    fn buildIssueDetail(code: FaceBuildIssueCode) []const u8 {
        return switch (code) {
            .duplicate_outgoing_boundary => "two boundary edges leave the same logical vertex",
            .too_few_boundary_edges => "fewer than three boundary edges remain after internal edges cancel",
            .missing_boundary_continuation => "the directed boundary walk cannot continue from its current vertex",
            .boundary_did_not_close => "the directed boundary edges do not form one closed loop",
            .mixed_material => "one authored face group contains multiple material indices",
            .mixed_semantic => "one authored face group contains multiple semantic memberships",
        };
    }

    fn buildIssueFromBucket(
        allocator: std.mem.Allocator,
        bucket: *const Bucket,
        code: FaceBuildIssueCode,
    ) !FaceBuildIssue {
        noteMalformedBoundary(bucket);
        var issue = FaceBuildIssue{
            .part = bucket.part,
            .source_group = bucket.group,
            .code = code,
            .detail = try allocator.dupe(u8, buildIssueDetail(code)),
        };
        errdefer issue.deinit(allocator);
        try issue.source_triangles.appendSlice(allocator, bucket.triangles.items);
        return issue;
    }

    fn failFaceBuild(
        allocator: std.mem.Allocator,
        face: *Face,
        bucket: *const Bucket,
        code: FaceBuildIssueCode,
    ) !FaceBuildResult {
        const issue = try buildIssueFromBucket(allocator, bucket, code);
        face.deinit(allocator);
        return .{ .issue = issue };
    }

    /// Emit every triangle of a face group that failed to close a boundary loop as its
    /// own single-triangle face. Each gets a fresh group id — the same way every other
    /// newly created face gets one — because the composite group it belonged to is not a
    /// coherent authored face and pretending otherwise is what wedged the indexer.
    fn appendDegradedBucket(
        mesh: *Mesh,
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        corner_vertex: []const u32,
        bucket: *const Bucket,
        parts: ?[]const u32,
        materials: ?[]const u32,
        semantic_regions: ?[]const u32,
        semantic_instances: ?[]const u32,
        degraded_to_groups: *std.ArrayListUnmanaged(u32),
    ) !void {
        try mesh.faces.ensureUnusedCapacity(allocator, bucket.triangles.items.len);
        try degraded_to_groups.ensureUnusedCapacity(allocator, bucket.triangles.items.len);
        for (bucket.triangles.items) |triangle| {
            const group = mesh.next_group;
            var face = Face{
                .id = @intCast(mesh.faces.items.len),
                .group = group,
                .part = if (parts) |rows| rows[triangle] else bucket.part,
                .material = if (materials) |rows| rows[triangle] else bucket.material,
                .semantic = .{
                    .region = if (semantic_regions) |rows| rows[triangle] else bucket.semantic.region,
                    .instance = if (semantic_instances) |rows| rows[triangle] else bucket.semantic.instance,
                },
                .source_tessellation_valid = true,
            };
            errdefer face.deinit(allocator);
            try face.source_triangles.append(allocator, triangle);
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                try face.vertices.append(allocator, corner_vertex[triangle * 3 + corner]);
                const base = (@as(usize, triangle) * 3 + corner) * 8;
                try face.uvs.append(allocator, .{ interleaved[base + 6], interleaved[base + 7] });
            }
            mesh.faces.appendAssumeCapacity(face);
            degraded_to_groups.appendAssumeCapacity(group);
            mesh.next_group += 1;
        }
    }

    fn buildFaceFromBucket(
        allocator: std.mem.Allocator,
        interleaved: []const f32,
        corner_vertex: []const u32,
        bucket: *const Bucket,
    ) !FaceBuildResult {
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

        if (bucket.metadata_issue) |code| return failFaceBuild(allocator, &face, bucket, code);

        if (bucket.triangles.items.len == 1) {
            const triangle = bucket.triangles.items[0];
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                try face.vertices.append(allocator, corner_vertex[triangle * 3 + corner]);
                const base = (@as(usize, triangle) * 3 + corner) * 8;
                try face.uvs.append(allocator, .{ interleaved[base + 6], interleaved[base + 7] });
            }
            return .{ .face = face };
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
            if (entry.found_existing) return failFaceBuild(allocator, &face, bucket, .duplicate_outgoing_boundary);
            entry.value_ptr.* = @intCast(index);
            if (start == null) start = edge.from;
            boundary_count += 1;
        }
        if (boundary_count < 3) return failFaceBuild(allocator, &face, bucket, .too_few_boundary_edges);

        var current = start.?;
        const first = current;
        var visited: u32 = 0;
        while (visited < boundary_count) : (visited += 1) {
            const index = next.get(current) orelse return failFaceBuild(allocator, &face, bucket, .missing_boundary_continuation);
            const edge = directed.items[index];
            try face.vertices.append(allocator, edge.from);
            try face.uvs.append(allocator, edge.uv);
            current = edge.to;
            if (current == first) break;
        }
        if (current != first or face.vertices.items.len != boundary_count)
            return failFaceBuild(allocator, &face, bucket, .boundary_did_not_close);
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
        return .{ .face = face };
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

    /// Resolve complete authored-face selection from resident triangle bits.
    /// `false` means at least one selected render triangle was only a fragment of
    /// its authored face; topology tools must reject that ambiguous identity.
    pub fn selectedFaceIds(
        mesh: *const Mesh,
        selected_triangles: []const bool,
        out: *std.ArrayListUnmanaged(u32),
    ) !bool {
        var selected_triangle_count: usize = 0;
        for (selected_triangles) |selected| if (selected) {
            selected_triangle_count += 1;
        };
        var covered_triangle_count: usize = 0;
        for (mesh.faces.items) |*face| {
            if (!faceFullySelected(face, selected_triangles)) continue;
            try out.append(mesh.allocator, face.id);
            covered_triangle_count += face.source_triangles.items.len;
        }
        return selected_triangle_count > 0 and covered_triangle_count == selected_triangle_count;
    }

    fn buildIssueRefusalCode(code: FaceBuildIssueCode) OperationRefusalCode {
        return switch (code) {
            .duplicate_outgoing_boundary => .duplicate_outgoing_boundary,
            .too_few_boundary_edges => .too_few_boundary_edges,
            .missing_boundary_continuation => .missing_boundary_continuation,
            .boundary_did_not_close => .boundary_did_not_close,
            .mixed_material => .mixed_material,
            .mixed_semantic => .mixed_semantic,
        };
    }

    /// Indexed-build eligibility is the provenance emitted by the canonical
    /// bucket boundary walk, never a second reconstruction attempt.
    pub fn indexedBuildEligibility(mesh: *const Mesh, face_id: u32) OperationEligibility {
        notePredicate(.indexed_build);
        if (face_id >= mesh.faces.items.len)
            return .blocked(.face_out_of_range, "indexed-build face id is out of range", null);
        const face = &mesh.faces.items[face_id];
        if (!face.alive) return .blocked(.face_deleted, "indexed-build face is deleted", null);
        for (mesh.build_issues.items) |*issue| {
            for (issue.degraded_to_groups.items) |group| {
                if (group != face.group) continue;
                return .blocked(
                    buildIssueRefusalCode(issue.code),
                    issue.detail,
                    .{
                        .boundary_edges = @floatFromInt(face.vertices.items.len),
                        .source_triangles = @floatFromInt(issue.source_triangles.items.len),
                    },
                );
            }
        }
        return .allowed(.{
            .boundary_edges = @floatFromInt(face.vertices.items.len),
            .source_triangles = @floatFromInt(face.source_triangles.items.len),
        });
    }

    /// Exactly which gate rejected the last Face-to-N-gon frame. Ten different geometric
    /// conditions all returned one bare `null`, so the tool could only ever say "no" and
    /// the user was left guessing between "too small", "concave", "not planar" and
    /// "not one face" — which are four unrelated fixes (req_4132).
    pub var last_face_polygon_stage: []const u8 = "";

    const FaceMeasurement = struct {
        facts: FaceGeometryFacts,
        center: Vec3 = .{ 0, 0, 0 },
        normal: Vec3 = .{ 0, 0, 0 },
        u: Vec3 = .{ 0, 0, 0 },
        v: Vec3 = .{ 0, 0, 0 },
    };

    fn loweredTriangleArea(lowered: *const Lowered, triangle: usize) f32 {
        const at = triangle * 9;
        if (at + 9 > lowered.positions.len) return 0;
        const a = Vec3{ lowered.positions[at], lowered.positions[at + 1], lowered.positions[at + 2] };
        const b = Vec3{ lowered.positions[at + 3], lowered.positions[at + 4], lowered.positions[at + 5] };
        const c = Vec3{ lowered.positions[at + 6], lowered.positions[at + 7], lowered.positions[at + 8] };
        if (!positionFinite(a) or !positionFinite(b) or !positionFinite(c)) return std.math.nan(f32);
        return length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
    }

    fn measureFaceGeometry(
        mesh: *const Mesh,
        face: *const Face,
        lowered: ?*const Lowered,
    ) FaceMeasurement {
        var facts = FaceGeometryFacts{
            .corner_count = @intCast(face.vertices.items.len),
            .triangle_count = 0,
            .area = 0,
            .perimeter = 0,
            .centroid_edge_clearance = null,
            .min_edge = 0,
            .max_edge = 0,
            .aspect = null,
            .planarity_deviation = null,
            .convexity = .indeterminate,
        };
        if (lowered) |rows| {
            for (rows.face_ids, 0..) |member_face, triangle| {
                if (member_face != face.id) continue;
                facts.triangle_count += 1;
                const member_area = loweredTriangleArea(rows, triangle);
                if (!std.math.isFinite(member_area)) {
                    facts.degeneracy.insert(.nonfinite_position);
                    continue;
                }
                facts.area += member_area;
                if (member_area <= FaceFactTuning.zero_area_epsilon) facts.degeneracy.insert(.zero_area_member);
            }
        } else {
            facts.triangle_count = @intCast(face.source_triangles.items.len);
        }

        if (face.vertices.items.len < 3) {
            facts.degeneracy.insert(.too_few_corners);
            return .{ .facts = facts };
        }

        var center = Vec3{ 0, 0, 0 };
        for (face.vertices.items, 0..) |vertex_id, corner| {
            if (vertex_id >= mesh.vertices.items.len or !mesh.vertices.items[vertex_id].alive) {
                facts.degeneracy.insert(.nonfinite_position);
                return .{ .facts = facts };
            }
            const position = mesh.vertices.items[vertex_id].position;
            if (!positionFinite(position)) facts.degeneracy.insert(.nonfinite_position);
            center = add3(center, position);
            for (face.vertices.items[0..corner]) |prior| {
                if (prior == vertex_id) facts.degeneracy.insert(.repeated_vertex);
            }
        }
        if (facts.degeneracy.contains(.nonfinite_position)) return .{ .facts = facts };
        center = mul3(center, 1.0 / @as(f32, @floatFromInt(face.vertices.items.len)));

        const normal = faceNormal(mesh, face);
        if (length3(normal) < 0.5) facts.degeneracy.insert(.zero_normal);

        var min_edge = std.math.inf(f32);
        var max_edge: f32 = 0;
        var clearance = std.math.inf(f32);
        for (face.vertices.items, 0..) |vertex_id, corner| {
            const next_id = face.vertices.items[(corner + 1) % face.vertices.items.len];
            const a = mesh.vertices.items[vertex_id].position;
            const b = mesh.vertices.items[next_id].position;
            const edge = sub3(b, a);
            const edge_length = length3(edge);
            facts.perimeter += edge_length;
            min_edge = @min(min_edge, edge_length);
            max_edge = @max(max_edge, edge_length);
            if (edge_length <= IMPORT_WELD_EPS) facts.degeneracy.insert(.short_edge);
            if (length3(normal) >= 0.5 and edge_length > IMPORT_WELD_EPS) {
                const distance = @abs(dot3(cross3(edge, sub3(center, a)), normal)) / edge_length;
                clearance = @min(clearance, distance);
            }
        }
        facts.min_edge = if (std.math.isFinite(min_edge)) min_edge else 0;
        facts.max_edge = max_edge;

        if (!facts.degeneracy.contains(.zero_normal)) {
            var max_deviation: f32 = 0;
            for (face.vertices.items) |vertex_id| {
                max_deviation = @max(max_deviation, @abs(dot3(
                    sub3(mesh.vertices.items[vertex_id].position, center),
                    normal,
                )));
            }
            facts.planarity_deviation = max_deviation;
        }

        if (!facts.degeneracy.contains(.zero_normal) and
            facts.planarity_deviation.? <= FacePolygonTuning.planar_epsilon_m)
        {
            facts.convexity = if (mesh.loopIsConcavePositionsWithNormal(face.vertices.items, normal)) .concave else .convex;
        }
        if (facts.convexity == .convex and
            !facts.degeneracy.contains(.short_edge) and
            std.math.isFinite(clearance))
        {
            facts.centroid_edge_clearance = clearance;
            facts.aspect = max_edge / @max(2.0 * clearance, FaceFactTuning.scale_epsilon);
        }

        var u = norm3(sub3(mesh.vertices.items[face.vertices.items[0]].position, center));
        if (length3(u) < 0.5) {
            const first = mesh.vertices.items[face.vertices.items[0]].position;
            const second = mesh.vertices.items[face.vertices.items[1]].position;
            u = norm3(sub3(second, first));
        }
        const v = norm3(cross3(normal, u));
        return .{ .facts = facts, .center = center, .normal = normal, .u = u, .v = v };
    }

    /// Complete non-mutating facts over the exact lowered member triangles.
    pub fn faceGeometryFactsFromLowered(mesh: *const Mesh, face_id: u32, lowered: *const Lowered) ?FaceGeometryFacts {
        if (face_id >= mesh.faces.items.len or !mesh.faces.items[face_id].alive) return null;
        return mesh.measureFaceGeometry(&mesh.faces.items[face_id], lowered).facts;
    }

    /// Convenience read for callers that do not already own a document lowering.
    /// FaceTableService lowers once and calls `faceGeometryFactsFromLowered` for
    /// every row, avoiding one allocation/traversal per face.
    pub fn faceGeometryFacts(mesh: *const Mesh, face_id: u32) !?FaceGeometryFacts {
        var lowered = try mesh.lower();
        defer lowered.deinit();
        return mesh.faceGeometryFactsFromLowered(face_id, &lowered);
    }

    /// Canonical Face-to-N-gon predicate. The mutation and table adapter both
    /// consume this exact typed result; no diagnostic tolerance is duplicated.
    pub fn facePolygonEligibility(mesh: *const Mesh, face_id: u32) FacePolygonEligibility {
        notePredicate(.face_to_ngon);
        if (face_id >= mesh.faces.items.len) return .{ .eligibility = .blocked(.face_out_of_range, "face id out of range", null) };
        const face = &mesh.faces.items[face_id];
        if (!face.alive) return .{ .eligibility = .blocked(.face_deleted, "that face is deleted", null) };
        if (face.vertices.items.len < 3) return .{ .eligibility = .blocked(.too_few_corners, "the face has fewer than 3 corners (wire/degenerate)", null) };
        if (face.vertices.items.len > FacePolygonTuning.maximum_target_sides) return .{ .eligibility = .blocked(.too_many_corners, "the face has more corners than the N-gon limit", null) };
        if (face.source_triangles.items.len == 0) return .{ .eligibility = .blocked(.no_source_triangles, "the face has no source triangles", null) };

        const measured = mesh.measureFaceGeometry(face, null);
        if (measured.facts.convexity == .concave) return .{ .eligibility = .blocked(.concave_boundary, "the face boundary is CONCAVE — Face to N-gon needs a convex face", null) };
        if (measured.facts.degeneracy.contains(.zero_normal)) return .{ .eligibility = .blocked(.zero_normal, "the face normal is degenerate (zero-area or collapsed face)", null) };
        if (measured.facts.planarity_deviation == null or
            measured.facts.planarity_deviation.? > FacePolygonTuning.planar_epsilon_m)
        {
            return .{ .eligibility = .blocked(.non_planar, "the face is NOT PLANAR — its corners do not lie in one plane", null) };
        }
        if (measured.facts.degeneracy.contains(.short_edge)) return .{ .eligibility = .blocked(.short_edge, "one face edge is shorter than the weld epsilon", null) };
        const clearance = measured.facts.centroid_edge_clearance orelse
            return .{ .eligibility = .blocked(.invalid_frame, "the face has no valid centroid-to-edge clearance", null) };
        const max_width = clearance * FacePolygonTuning.maximum_width_fraction;
        if (!std.math.isFinite(clearance) or max_width < FacePolygonTuning.minimum_width_m) {
            return .{ .eligibility = .blocked(.too_small, "the face is TOO SMALL for the minimum inset width", .{ .max_width = max_width }) };
        }
        if (length3(measured.u) < 0.5 or length3(measured.v) < 0.5) return .{ .eligibility = .blocked(.invalid_frame, "the face cannot establish a stable planar basis", null) };
        return .{
            .eligibility = .allowed(.{ .max_width = max_width }),
            .frame = .{
                .center = measured.center,
                .normal = measured.normal,
                .u = measured.u,
                .v = measured.v,
                .centroid_edge_clearance = clearance,
            },
        };
    }

    fn facePolygonFrame(mesh: *const Mesh, face_id: u32) ?FacePolygonFrame {
        const result = mesh.facePolygonEligibility(face_id);
        last_face_polygon_stage = result.eligibility.detail;
        if (!acceptOrRemember(result.eligibility)) return null;
        return result.frame;
    }

    pub fn facePolygonLimit(mesh: *const Mesh, face_id: u32) ?f32 {
        const frame = mesh.facePolygonFrame(face_id) orelse return null;
        return frame.centroid_edge_clearance * FacePolygonTuning.maximum_width_fraction;
    }

    /// One and only one complete selected authored face is the source. The popup
    /// may then vary width and target sides while rebuilding from the captured mesh.
    /// How many WHOLE authored faces the last Face-to-N-gon selection resolved to, and
    /// whether a polygon frame could be built from it. "your selection covers N faces"
    /// and "that face has no usable frame" are completely different user errors with
    /// completely different fixes; collapsing both into one null is what made this
    /// impossible to act on (req_4125). -1 means selectedFaceIds itself failed.
    pub var last_face_polygon_faces: i64 = -1;
    pub var last_face_polygon_frame_ok: bool = false;

    pub fn resolveFacePolygon(mesh: *const Mesh, selected_triangles: []const bool) ?FacePolygonSelection {
        last_face_polygon_faces = -1;
        last_face_polygon_frame_ok = false;
        var selected = std.ArrayListUnmanaged(u32).empty;
        defer selected.deinit(mesh.allocator);
        const whole = mesh.selectedFaceIds(selected_triangles, &selected) catch return null;
        last_face_polygon_faces = @intCast(selected.items.len);
        if (!whole) {
            last_face_polygon_stage = "the selection covers only PART of an authored face";
            return null;
        }
        if (selected.items.len != 1) {
            last_face_polygon_stage = "the selection is not exactly one authored face";
            return null;
        }
        const face_id = selected.items[0];
        const frame = mesh.facePolygonFrame(face_id) orelse return null;
        last_face_polygon_frame_ok = true;
        const face = &mesh.faces.items[face_id];
        const max_width = frame.centroid_edge_clearance * FacePolygonTuning.maximum_width_fraction;
        const default_width = std.math.clamp(
            frame.centroid_edge_clearance * FacePolygonTuning.default_width_fraction,
            FacePolygonTuning.minimum_width_m,
            max_width,
        );
        return .{
            .face_id = face_id,
            .selection_triangle = face.source_triangles.items[0],
            .sides_before = @intCast(face.vertices.items.len),
            .default_target_sides = @intCast(@max(FacePolygonTuning.default_target_sides, face.vertices.items.len)),
            .minimum_target_sides = FacePolygonTuning.minimum_target_sides,
            .maximum_target_sides = FacePolygonTuning.maximum_target_sides,
            .default_width = default_width,
            .max_width = max_width,
        };
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

    /// Dissolve a connected face selection into one ordered boundary face. A two-triangle
    /// merge records their real resident diagonal so later geometric edits never have to
    /// guess how the authored quad was physically tessellated.
    ///
    /// NOT coplanarity-gated (req_4140). It was, at MERGE_FACE_NORMAL_DOT_MIN — normals
    /// within 0.81° and every corner within ~2mm of the reference plane — and the comment
    /// on mergeSelectedTrusted below already concedes that "import-authored quads are
    /// routinely millimetres out of plane". So the gate refused, on essentially every
    /// imported model, the one cheap way to fuse two triangles into the quad they already
    /// visually are. It was not protecting the mesh: delete those same two triangles,
    /// select their edges, and create-face bridges them into the IDENTICAL quad with no
    /// planarity requirement whatsoever. The gate only made the direct route fail and
    /// forced hours of delete-then-recreate to reach byte-identical geometry by hand.
    ///
    /// This is a selection the USER made and an action they explicitly asked for; a warped
    /// quad is a legitimate authored face. The machine-chosen bulk pairing in
    /// trianglesFormConvexQuad (tris-to-quads) KEEPS its gate, because there nothing has
    /// expressed intent and fusing across a crease would be a silent wrong answer.
    pub fn mergeSelected(mesh: *Mesh, selected_triangles: []const bool) !?MergedFace {
        beginMutation(.merge);
        return mesh.mergeSelectedImpl(selected_triangles, false);
    }

    /// Mirror-twin fusion (req_3855): mergeSelected WITHOUT the coplanarity gate.
    /// Licensed ONLY when the caller has proven the fused result is the positional
    /// mirror image of an authored face the model already contains — the twin is
    /// exactly as warped as its licensed source (import-authored quads are routinely
    /// millimetres out of plane, which the interactive gate rightly refuses to
    /// CREATE but must not refuse to COPY).
    pub fn mergeSelectedTrusted(mesh: *Mesh, selected_triangles: []const bool) !?MergedFace {
        beginMutation(.merge);
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
        // A pair folds only across its shared diagonal, so the dihedral angle is the exact
        // and complete coplanarity test (req_4143). The old call into
        // selectedFacesAreCoplanar imposed the interactive merge's 0.81° tolerance here,
        // which rejected nearly every real imported quad.
        const first_normal = faceNormal(mesh, first);
        const second_normal = faceNormal(mesh, second);
        if (length3(first_normal) < 0.5 or length3(second_normal) < 0.5) return false;
        if (dot3(first_normal, second_normal) < QuadifyTuning.pair_normal_dot_min) return false;

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
        const normal = norm3(newellNormal(mesh, loop));
        return mesh.loopIsConcavePositionsWithNormal(loop, normal);
    }

    fn loopIsConcavePositionsWithNormal(mesh: *const Mesh, loop: []const u32, normal: Vec3) bool {
        if (loop.len < 4 or length3(normal) < 0.5) return false;
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
    pub fn loopCutEligibility(mesh: *const Mesh, face_id: u32, direction: u32, seed_edge: ?[2]u32) LoopCutEligibility {
        notePredicate(.loop_cut);
        if (face_id >= mesh.faces.items.len) return .{ .eligibility = .blocked(.face_out_of_range, "loop-cut face id is out of range", null) };
        const face = &mesh.faces.items[face_id];
        if (!face.alive) return .{ .eligibility = .blocked(.face_deleted, "loop-cut face is deleted", null) };
        if (face.vertices.items.len < 2) return .{ .eligibility = .blocked(.too_few_corners, "loop-cut face has fewer than two corners", null) };
        const edge = seed_edge orelse [2]u32{
            face.vertices.items[direction % face.vertices.items.len],
            face.vertices.items[(direction + 1) % face.vertices.items.len],
        };
        const first = indexOf(face.vertices.items, edge[0]) orelse
            return .{ .eligibility = .blocked(.invalid_seed_edge, "loop-cut seed edge is not on the authored face", null) };
        const next = face.vertices.items[(first + 1) % face.vertices.items.len];
        const previous = face.vertices.items[(first + face.vertices.items.len - 1) % face.vertices.items.len];
        if (edge[1] != next and edge[1] != previous) return .{ .eligibility = .blocked(.invalid_seed_edge, "loop-cut seed vertices are not one boundary edge", null) };
        if (edge[0] >= mesh.vertices.items.len or edge[1] >= mesh.vertices.items.len or
            !mesh.vertices.items[edge[0]].alive or !mesh.vertices.items[edge[1]].alive)
        {
            return .{ .eligibility = .blocked(.target_deleted, "loop-cut seed edge references a deleted vertex", null) };
        }
        const edge_length = length3(sub3(mesh.vertices.items[edge[1]].position, mesh.vertices.items[edge[0]].position));
        if (!std.math.isFinite(edge_length) or edge_length <= IMPORT_WELD_EPS) {
            return .{ .eligibility = .blocked(.short_edge, "loop-cut seed edge is shorter than the weld epsilon", null) };
        }
        return .{
            .eligibility = .allowed(.{
                .direction = @floatFromInt(direction),
                .seed_edge = @floatFromInt(first),
            }),
            .seed_edge = edge,
        };
    }

    pub fn loopCut(mesh: *Mesh, selected_triangles: []const bool, direction: u32, cuts_raw: u32, offset_fraction_raw: f32) !bool {
        beginMutation(.loop_cut);
        const start_face = mesh.firstSelectedFace(selected_triangles) orelse {
            last_operation_refusal = .blocked(.no_face_selection, "loop cut needs one complete authored-face selection", null);
            return false;
        };
        const face = &mesh.faces.items[start_face];
        if (face.vertices.items.len < 2) {
            last_operation_refusal = .blocked(.too_few_corners, "loop-cut face has fewer than two corners", null);
            return false;
        }
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

        const eligibility = mesh.loopCutEligibility(start_face, direction, start_edge);
        if (!acceptOrRemember(eligibility.eligibility)) return false;

        var context = CutContext{
            .mesh = mesh,
            .direction = direction,
            .cuts = @max(1, cuts_raw),
            .offset_fraction = std.math.clamp(offset_fraction_raw, 0.0, 1.0),
            .propagate = true,
        };
        defer context.deinit();
        return try splitFace(&context, start_face, start_edge, face.vertices.items.len == 4 or direction > 2, 0, null);
    }

    pub fn loopCutFromEdge(mesh: *Mesh, a: Vec3, b: Vec3, part: ?u32, cuts: u32, offset_fraction: f32) !bool {
        beginMutation(.loop_cut);
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
        const face_id = start_face orelse {
            last_operation_refusal = .blocked(.invalid_seed_edge, "loop-cut edge does not resolve in the requested part", null);
            return false;
        };
        const face = &mesh.faces.items[face_id];
        const eligibility = mesh.loopCutEligibility(face_id, 0, start_edge);
        if (!acceptOrRemember(eligibility.eligibility)) return false;
        var context = CutContext{
            .mesh = mesh,
            .direction = 0,
            .cuts = @max(1, cuts),
            .offset_fraction = std.math.clamp(offset_fraction, 0.0, 1.0),
            .propagate = true,
        };
        defer context.deinit();
        return try splitFace(&context, face_id, start_edge, face.vertices.items.len == 4, 0, null);
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
            changed = (try splitFace(&context, face_id, side, false, 0, null)) or changed;
        }
        return changed;
    }

    fn splitFace(context: *CutContext, face_id: u32, side_raw: [2]u32, double_side: bool, cut_no: u32, prev_dir: ?Vec3) !bool {
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
                        _ = try splitFace(context, face_id, .{ center_side, side[0] }, double_side, cut_no + 1, prev_dir);
                    } else {
                        _ = try splitFace(context, new_face_id, .{ center_side, side[1] }, double_side, cut_no + 1, prev_dir);
                    }
                } else {
                    _ = try splitFace(context, face_id, .{ center_side, side[0] }, double_side, cut_no + 1, prev_dir);
                }
            }
            if (cut_no != 0 or !context.propagate) return true;

            const rung_forward = sub3(
                context.mesh.vertices.items[center_opposite].position,
                context.mesh.vertices.items[center_side].position,
            );
            if (findNeighbor(context.mesh, &context.processed, face_id, opposite)) |next_face| {
                _ = try splitFace(context, next_face, opposite, context.mesh.faces.items[next_face].vertices.items.len == 4, 0, rung_forward);
            }
            if (double_side) {
                if (findNeighbor(context.mesh, &context.processed, face_id, side)) |previous_face| {
                    const rung_backward = mul3(rung_forward, -1.0);
                    const previous = &context.mesh.faces.items[previous_face];
                    var previous_opposite: [2]u32 = undefined;
                    var count: usize = 0;
                    for (previous.vertices.items) |vertex_id| {
                        if (vertex_id == side[0] or vertex_id == side[1]) continue;
                        if (count < 2) previous_opposite[count] = vertex_id;
                        count += 1;
                    }
                    if (count == 2) {
                        _ = try splitFace(context, previous_face, previous_opposite, previous.vertices.items.len == 4, 0, rung_backward);
                    } else if (count == 1) {
                        _ = try splitFace(context, previous_face, side, false, 0, rung_backward);
                    } else if (previous.vertices.items.len > 4) {
                        // Legacy ReactJIT cylinder cap. The reference primitive would
                        // present a terminal triangle on this side of the seed too.
                        _ = try splitFace(context, previous_face, side, false, 0, rung_backward);
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

            // Triangle pass-through (req_4728–req_4730): the reference walk terminates
            // at every triangle, which kills the ring on chamfered solids where a
            // triangle sits mid-loop. Blender crosses it — entry point to exit point,
            // one triangle + one quad — and the ring survives. A mid-walk triangle
            // (prev_dir carries the incoming rung's travel direction) whose crossing
            // keeps that direction passes the ring through instead of corner-diving
            // to the opposed vertex. A crossing that would turn essentially sideways
            // (a promoted cylinder-cap fan seen edge-on) stays on the reference
            // terminal path, as does an end-of-strip triangle with no surface
            // neighbor behind either candidate exit edge.
            if (prev_dir) |travel_raw| passthrough: {
                const travel_length = length3(travel_raw);
                if (travel_length <= IMPORT_WELD_EPS) break :passthrough;
                const travel = mul3(travel_raw, 1.0 / travel_length);
                const side0_position = context.mesh.vertices.items[side[0]].position;
                const entry_span_length = length3(sub3(context.mesh.vertices.items[side[1]].position, side0_position));
                if (entry_span_length <= IMPORT_WELD_EPS) break :passthrough;
                const entry_vertex = try context.centerVertex(side, ratio, cut_no);
                const entry_position = context.mesh.vertices.items[entry_vertex].position;
                // The station's real parameter from side[0]: a cache-hit vertex minted
                // by the neighbor may sit at the complementary phase of `ratio`.
                const entry_parameter = std.math.clamp(length3(sub3(entry_position, side0_position)) / entry_span_length, 0.0, 1.0);
                var no_processed: std.AutoHashMapUnmanaged(u32, void) = .empty;
                var best_isolated: ?u32 = null;
                var best_parameter: f32 = 0;
                var best_alignment: f32 = TRI_PASS_MIN_ALIGNMENT;
                for ([2]u32{ side[0], side[1] }) |isolated_candidate| {
                    const isolated_parameter = if (isolated_candidate == side[0]) entry_parameter else 1.0 - entry_parameter;
                    const corner_position = context.mesh.vertices.items[isolated_candidate].position;
                    const opposed_position = context.mesh.vertices.items[opposed_vertex].position;
                    if (length3(sub3(opposed_position, corner_position)) <= IMPORT_WELD_EPS) continue;
                    const exit_position = lerp3(corner_position, opposed_position, isolated_parameter);
                    const crossing = sub3(exit_position, entry_position);
                    const crossing_length = length3(crossing);
                    if (crossing_length <= IMPORT_WELD_EPS) continue;
                    const alignment = dot3(mul3(crossing, 1.0 / crossing_length), travel);
                    if (alignment <= best_alignment) continue;
                    // The first rung only re-routes when the ring has somewhere to go.
                    if (cut_no == 0 and findNeighbor(context.mesh, &no_processed, face_id, .{ isolated_candidate, opposed_vertex }) == null) continue;
                    best_alignment = alignment;
                    best_isolated = isolated_candidate;
                    best_parameter = isolated_parameter;
                }
                const isolated = best_isolated orelse break :passthrough;
                // Orient the exit edge so `lerp(edge[0], edge[1], ratio)` reproduces the
                // wanted station — repositionCutVertices re-derives every cut vertex
                // from its stored ordered edge with the raw comb ratio.
                const exit_edge: [2]u32 = if (@abs(best_parameter - ratio) <= @abs(best_parameter - (1.0 - ratio)))
                    .{ isolated, opposed_vertex }
                else
                    .{ opposed_vertex, isolated };
                const exit_vertex = try context.centerVertex(exit_edge, ratio, cut_no);
                const exit_position = context.mesh.vertices.items[exit_vertex].position;

                const old = &context.mesh.faces.items[face_id];
                const entry_uv = lerp2(uvFor(old, side[0]), uvFor(old, side[1]), entry_parameter);
                const exit_uv = lerp2(uvFor(old, isolated), uvFor(old, opposed_vertex), best_parameter);
                // Insert both stations into the parent loop in walk order, then split
                // along the entry→exit chord; deriving both pieces from the parent's
                // own cyclic order keeps the winding correct for either arrival
                // orientation of `side`.
                var ring_vertices: [5]u32 = undefined;
                var ring_uvs: [5]Vec2 = undefined;
                var ring_len: usize = 0;
                for (old.vertices.items, 0..) |vertex_id, corner| {
                    const next_id = old.vertices.items[(corner + 1) % old.vertices.items.len];
                    ring_vertices[ring_len] = vertex_id;
                    ring_uvs[ring_len] = old.uvs.items[corner];
                    ring_len += 1;
                    const on_entry = (vertex_id == side[0] and next_id == side[1]) or (vertex_id == side[1] and next_id == side[0]);
                    const on_exit = (vertex_id == isolated and next_id == opposed_vertex) or (vertex_id == opposed_vertex and next_id == isolated);
                    if (on_entry) {
                        ring_vertices[ring_len] = entry_vertex;
                        ring_uvs[ring_len] = entry_uv;
                        ring_len += 1;
                    } else if (on_exit) {
                        ring_vertices[ring_len] = exit_vertex;
                        ring_uvs[ring_len] = exit_uv;
                        ring_len += 1;
                    }
                }
                if (ring_len != 5) break :passthrough;
                const entry_at = indexOf(ring_vertices[0..], entry_vertex) orelse break :passthrough;
                const exit_at = indexOf(ring_vertices[0..], exit_vertex) orelse break :passthrough;
                var first_vertices: [4]u32 = undefined;
                var first_uvs: [4]Vec2 = undefined;
                const first_len = ((exit_at + 5 - entry_at) % 5) + 1;
                for (0..first_len) |i| {
                    first_vertices[i] = ring_vertices[(entry_at + i) % 5];
                    first_uvs[i] = ring_uvs[(entry_at + i) % 5];
                }
                var second_vertices: [4]u32 = undefined;
                var second_uvs: [4]Vec2 = undefined;
                const second_len = 7 - first_len;
                for (0..second_len) |i| {
                    second_vertices[i] = ring_vertices[(exit_at + i) % 5];
                    second_uvs[i] = ring_uvs[(exit_at + i) % 5];
                }
                // face_id keeps the piece holding side[0] — the same convention the
                // quad split follows, so the comb recursion below lands in it.
                const first_holds_side0 = indexOf(first_vertices[0..first_len], side[0]) != null;
                const retained_vertices = if (first_holds_side0) first_vertices[0..first_len] else second_vertices[0..second_len];
                const retained_uvs = if (first_holds_side0) first_uvs[0..first_len] else second_uvs[0..second_len];
                const appended_vertices = if (first_holds_side0) second_vertices[0..second_len] else first_vertices[0..first_len];
                const appended_uvs = if (first_holds_side0) second_uvs[0..second_len] else first_uvs[0..first_len];
                const appended = try context.mesh.makeSplitFace(old, appended_vertices, appended_uvs);
                try context.mesh.replaceFaceLoop(face_id, retained_vertices, retained_uvs);
                try context.mesh.faces.append(context.mesh.allocator, appended);

                if (cut_no + 1 < context.cuts) {
                    _ = try splitFace(context, face_id, .{ entry_vertex, side[0] }, double_side, cut_no + 1, prev_dir);
                }
                if (cut_no != 0 or !context.propagate) return true;
                if (findNeighbor(context.mesh, &context.processed, face_id, .{ isolated, opposed_vertex })) |next_face| {
                    _ = try splitFace(context, next_face, .{ isolated, opposed_vertex }, context.mesh.faces.items[next_face].vertices.items.len == 4, 0, sub3(exit_position, entry_position));
                }
                return true;
            }

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
                    _ = try splitFace(context, face_id, .{ center_side, other_quad }, double_side, cut_no + 1, prev_dir);
                }
                if (cut_no != 0 or !context.propagate) return true;
                const rung_forward = sub3(
                    context.mesh.vertices.items[center_opposite].position,
                    context.mesh.vertices.items[center_side].position,
                );
                if (findNeighbor(context.mesh, &context.processed, face_id, opposite)) |next_face| {
                    _ = try splitFace(context, next_face, opposite, context.mesh.faces.items[next_face].vertices.items.len == 4, 0, rung_forward);
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
                        if (count == 2) _ = try splitFace(context, previous_face, previous_opposite, previous.vertices.items.len == 4, 0, mul3(rung_forward, -1.0));
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
                return splitFace(context, cap_triangle, side, false, cut_no, prev_dir);
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

    /// Marquee-projected cut kernel (req_4271): split every face in `family` that
    /// `plane` genuinely crosses, appending each new piece back into `family` so a
    /// later plane cuts the pieces too. Crossing points mint shared vertices
    /// (cached per undirected edge in `minted`, so sibling pieces weld); a corner
    /// within the weld epsilon of the plane is reused instead of minting a sliver
    /// beside it. A loop the plane enters more than twice (a concave piece would
    /// need a multi-segment cut) is left whole rather than guessed at. Returns how
    /// many faces were split.
    pub fn cutFamilyByPlane(
        mesh: *Mesh,
        family: *std.ArrayListUnmanaged(u32),
        plane_normal: Vec3,
        plane_offset: f32,
        minted: *std.AutoHashMapUnmanaged(u64, u32),
    ) !u32 {
        var changed: u32 = 0;
        const family_before = family.items.len;
        var family_at: usize = 0;
        while (family_at < family_before) : (family_at += 1) {
            const face_id = family.items[family_at];
            if (face_id >= mesh.faces.items.len) continue;
            if (!mesh.faces.items[face_id].alive) continue;
            const count = mesh.faces.items[face_id].vertices.items.len;
            if (count < 3) continue;

            const dists = try mesh.allocator.alloc(f32, count);
            defer mesh.allocator.free(dists);
            const on_plane = try mesh.allocator.alloc(bool, count);
            defer mesh.allocator.free(on_plane);
            const eps = IMPORT_WELD_EPS * 2.0;
            var has_positive = false;
            var has_negative = false;
            for (mesh.faces.items[face_id].vertices.items, 0..) |vertex_id, corner| {
                const d = dot3(mesh.vertices.items[vertex_id].position, plane_normal) - plane_offset;
                dists[corner] = d;
                on_plane[corner] = @abs(d) <= eps;
                if (!on_plane[corner]) {
                    if (d > 0) has_positive = true else has_negative = true;
                }
            }
            if (!has_positive or !has_negative) continue; // the plane never enters this face

            // Count the cut points first — an on-plane corner, or an edge whose two
            // off-plane endpoints sit on strictly opposite sides. Exactly two make a
            // clean split; anything else leaves the face whole.
            var cut_points: u32 = 0;
            for (0..count) |corner| {
                if (on_plane[corner]) cut_points += 1;
                const next = (corner + 1) % count;
                if (!on_plane[corner] and !on_plane[next] and (dists[corner] > 0) != (dists[next] > 0)) cut_points += 1;
            }
            if (cut_points != 2) continue;

            // Build the augmented loop: source corners in order, with a minted (or
            // cached) crossing vertex inserted on each strictly-crossing edge.
            var loop_ids = std.ArrayListUnmanaged(u32).empty;
            defer loop_ids.deinit(mesh.allocator);
            var loop_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer loop_uvs.deinit(mesh.allocator);
            var loop_is_cut = std.ArrayListUnmanaged(bool).empty;
            defer loop_is_cut.deinit(mesh.allocator);
            for (0..count) |corner| {
                const face = &mesh.faces.items[face_id];
                const vertex_id = face.vertices.items[corner];
                try loop_ids.append(mesh.allocator, vertex_id);
                try loop_uvs.append(mesh.allocator, face.uvs.items[corner]);
                try loop_is_cut.append(mesh.allocator, on_plane[corner]);
                const next = (corner + 1) % count;
                if (on_plane[corner] or on_plane[next] or (dists[corner] > 0) == (dists[next] > 0)) continue;
                const next_id = face.vertices.items[next];
                const t = dists[corner] / (dists[corner] - dists[next]);
                const key = edgeKey(vertex_id, next_id);
                const crossing = minted.get(key) orelse blk: {
                    const id: u32 = @intCast(mesh.vertices.items.len);
                    try mesh.vertices.append(mesh.allocator, .{
                        .position = lerp3(mesh.vertices.items[vertex_id].position, mesh.vertices.items[next_id].position, t),
                    });
                    try minted.put(mesh.allocator, key, id);
                    break :blk id;
                };
                try loop_ids.append(mesh.allocator, crossing);
                try loop_uvs.append(mesh.allocator, lerp2(face.uvs.items[corner], face.uvs.items[next], t));
                try loop_is_cut.append(mesh.allocator, true);
            }

            var first_cut: ?usize = null;
            var second_cut: ?usize = null;
            for (loop_is_cut.items, 0..) |is_cut, at| {
                if (!is_cut) continue;
                if (first_cut == null) first_cut = at else second_cut = at;
            }
            const m0 = first_cut orelse continue;
            const m1 = second_cut orelse continue;

            var first_vertices = std.ArrayListUnmanaged(u32).empty;
            defer first_vertices.deinit(mesh.allocator);
            var first_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer first_uvs.deinit(mesh.allocator);
            var second_vertices = std.ArrayListUnmanaged(u32).empty;
            defer second_vertices.deinit(mesh.allocator);
            var second_uvs = std.ArrayListUnmanaged(Vec2).empty;
            defer second_uvs.deinit(mesh.allocator);
            const loop_len = loop_ids.items.len;
            var at = m0;
            while (true) : (at = (at + 1) % loop_len) {
                try first_vertices.append(mesh.allocator, loop_ids.items[at]);
                try first_uvs.append(mesh.allocator, loop_uvs.items[at]);
                if (at == m1) break;
            }
            at = m1;
            while (true) : (at = (at + 1) % loop_len) {
                try second_vertices.append(mesh.allocator, loop_ids.items[at]);
                try second_uvs.append(mesh.allocator, loop_uvs.items[at]);
                if (at == m0) break;
            }
            // Two adjacent cut points would leave a 2-gon; that is a graze, not a cut.
            if (first_vertices.items.len < 3 or second_vertices.items.len < 3) continue;

            var source = try mesh.faces.items[face_id].clone(mesh.allocator);
            defer source.deinit(mesh.allocator);
            try mesh.replaceFaceLoop(face_id, first_vertices.items, first_uvs.items);
            var split = try mesh.makeSplitFace(&source, second_vertices.items, second_uvs.items);
            errdefer split.deinit(mesh.allocator);
            const split_id = split.id;
            try mesh.faces.append(mesh.allocator, split);
            try family.append(mesh.allocator, split_id);
            changed += 1;
        }
        return changed;
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

    /// Resolve every selected manifold edge against one captured indexed base.
    /// Duplicate or ineligible edges reject the whole set before preview mutation.
    pub fn resolveBevelEdges(
        mesh: *const Mesh,
        selected_edges: []const [2]Vec3,
        part: u32,
        out_edges: [][2]u32,
    ) ?BevelEdgesSelection {
        if (selected_edges.len < 2 or out_edges.len != selected_edges.len) return null;
        var shared_max_width = std.math.inf(f32);
        for (selected_edges, 0..) |positions, index| {
            const resolved = mesh.resolveBevelEdge(positions[0], positions[1], part) orelse return null;
            const edge = switch (resolved.target) {
                .edge => |value| value,
                .vertex => return null,
            };
            const key = edgeKey(edge[0], edge[1]);
            for (out_edges[0..index]) |prior| if (edgeKey(prior[0], prior[1]) == key) return null;
            out_edges[index] = edge;
            shared_max_width = @min(shared_max_width, resolved.max_width);
        }
        return if (std.math.isFinite(shared_max_width)) .{ .max_width = shared_max_width } else null;
    }

    /// Resolve a selected same-part edge set without imposing bevel's sharpness
    /// constraint. Edge Split accepts any interior manifold edge; boundaries are
    /// already split and therefore reject as a no-op.
    pub fn resolveSplitEdges(
        mesh: *const Mesh,
        selected_edges: []const [2]Vec3,
        part: u32,
        out_edges: [][2]u32,
    ) bool {
        if (selected_edges.len == 0 or out_edges.len != selected_edges.len) return false;
        for (selected_edges, 0..) |positions, index| {
            const a = mesh.vertexAt(positions[0], part) orelse return false;
            const b = mesh.vertexAt(positions[1], part) orelse return false;
            out_edges[index] = .{ a, b };
        }
        return mesh.splitEdgeIdsEligible(out_edges, part);
    }

    /// Validate already-authoritative RJMD-v5 logical ids. Live topology doors
    /// must use this instead of position lookup when coincident seam vertices exist.
    pub fn splitEdgeIdsEligible(mesh: *const Mesh, edges: []const [2]u32, part: u32) bool {
        if (edges.len == 0) return false;
        for (edges, 0..) |edge, index| {
            if (edge[0] == edge[1] or edge[0] >= mesh.vertices.items.len or edge[1] >= mesh.vertices.items.len or
                !mesh.vertices.items[edge[0]].alive or !mesh.vertices.items[edge[1]].alive or
                !mesh.vertexBelongsToPart(edge[0], part) or !mesh.vertexBelongsToPart(edge[1], part) or
                mesh.edgeIncidentFaceCount(edge) != 2) return false;
            const key = edgeKey(edge[0], edge[1]);
            for (edges[0..index]) |prior| if (edgeKey(prior[0], prior[1]) == key) return false;
        }
        return true;
    }

    /// Resolve any selected same-part authored edge against one captured indexed
    /// base. Unlike bevel and edge split, naked/boundary edges are valid tube
    /// centerlines; only duplicate, missing, cross-part, or collapsed edges refuse.
    pub fn resolveEdgeTubes(
        mesh: *const Mesh,
        selected_edges: []const [2]Vec3,
        part: u32,
        out_edges: [][2]u32,
    ) bool {
        if (selected_edges.len == 0 or out_edges.len != selected_edges.len) return false;
        for (selected_edges, 0..) |positions, index| {
            const a = mesh.vertexAt(positions[0], part) orelse return false;
            const b = mesh.vertexAt(positions[1], part) orelse return false;
            out_edges[index] = .{ a, b };
        }
        return mesh.edgeTubeIdsEligible(out_edges, part);
    }

    /// Validate selected tube centerlines by stable logical identity. Position
    /// matching is ambiguous after Edge Split or any imported authored seam.
    pub fn edgeTubeIdsEligible(mesh: *const Mesh, edges: []const [2]u32, part: u32) bool {
        if (edges.len == 0) return false;
        for (edges, 0..) |edge, index| {
            if (edge[0] == edge[1] or edge[0] >= mesh.vertices.items.len or edge[1] >= mesh.vertices.items.len or
                !mesh.vertices.items[edge[0]].alive or !mesh.vertices.items[edge[1]].alive or
                !mesh.vertexBelongsToPart(edge[0], part) or !mesh.vertexBelongsToPart(edge[1], part)) return false;
            var exists = false;
            for (mesh.faces.items) |*face| {
                if (face.alive and face.part == part and faceHasUndirectedEdge(face, edge[0], edge[1])) {
                    exists = true;
                    break;
                }
            }
            if (!exists) return false;
            const key = edgeKey(edge[0], edge[1]);
            for (edges[0..index]) |prior| if (edgeKey(prior[0], prior[1]) == key) return false;
        }
        return true;
    }

    /// Sever logical vertex sharing across selected manifold edges while retaining
    /// every face in its existing authored group and Outliner part. Around each cut
    /// endpoint, incident faces remain welded through unselected radial edges; each
    /// resulting fan receives one logical vertex identity. An open cut endpoint has
    /// no second barrier, so one deterministic incident face becomes the terminal fan.
    pub fn splitEdges(mesh: *Mesh, edges: []const [2]u32) !bool {
        if (edges.len == 0) return false;
        var cut = std.AutoHashMapUnmanaged(u64, void).empty;
        defer cut.deinit(mesh.allocator);
        var endpoints = std.AutoHashMapUnmanaged(u32, void).empty;
        defer endpoints.deinit(mesh.allocator);
        try cut.ensureTotalCapacity(mesh.allocator, @intCast(edges.len));
        try endpoints.ensureTotalCapacity(mesh.allocator, @intCast(edges.len * 2));
        for (edges) |edge| {
            if (edge[0] == edge[1] or mesh.edgeIncidentFaceCount(edge) != 2) return false;
            const key = edgeKey(edge[0], edge[1]);
            if (cut.contains(key)) return false;
            try cut.put(mesh.allocator, key, {});
            try endpoints.put(mesh.allocator, edge[0], {});
            try endpoints.put(mesh.allocator, edge[1], {});
        }

        var endpoint_iterator = endpoints.keyIterator();
        while (endpoint_iterator.next()) |endpoint_ptr| {
            const vertex = endpoint_ptr.*;
            if (vertex >= mesh.vertices.items.len or !mesh.vertices.items[vertex].alive) return false;
            var incident = std.ArrayListUnmanaged(u32).empty;
            defer incident.deinit(mesh.allocator);
            for (mesh.faces.items) |*face| {
                if (face.alive and containsVertex(face, vertex)) try incident.append(mesh.allocator, face.id);
            }
            if (incident.items.len < 2) return false;

            const unassigned = std.math.maxInt(u32);
            const component = try mesh.allocator.alloc(u32, incident.items.len);
            defer mesh.allocator.free(component);
            @memset(component, unassigned);
            var stack = std.ArrayListUnmanaged(usize).empty;
            defer stack.deinit(mesh.allocator);
            var component_count: u32 = 0;
            for (incident.items, 0..) |_, seed| {
                if (component[seed] != unassigned) continue;
                component[seed] = component_count;
                try stack.append(mesh.allocator, seed);
                while (stack.pop()) |current| {
                    const face = &mesh.faces.items[incident.items[current]];
                    const corner = indexOf(face.vertices.items, vertex) orelse return false;
                    const neighbors = [2]u32{
                        face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len],
                        face.vertices.items[(corner + 1) % face.vertices.items.len],
                    };
                    for (neighbors) |neighbor| {
                        if (cut.contains(edgeKey(vertex, neighbor))) continue;
                        for (incident.items, 0..) |candidate_id, candidate_index| {
                            if (component[candidate_index] != unassigned) continue;
                            if (!faceHasUndirectedEdge(&mesh.faces.items[candidate_id], vertex, neighbor)) continue;
                            component[candidate_index] = component_count;
                            try stack.append(mesh.allocator, candidate_index);
                        }
                    }
                }
                component_count += 1;
            }

            // One selected edge in a closed fan removes only one adjacency from a
            // cycle. A seam still needs two logical sides, so isolate the stable
            // higher-id incident face at that open terminal.
            if (component_count == 1) {
                var terminal_face: ?u32 = null;
                for (edges) |edge| {
                    if (edge[0] != vertex and edge[1] != vertex) continue;
                    var pair: [2]u32 = undefined;
                    if (!mesh.edgeIncidentFaces(edge, &pair)) return false;
                    const candidate = @max(pair[0], pair[1]);
                    terminal_face = if (terminal_face) |prior| @max(prior, candidate) else candidate;
                }
                const terminal = terminal_face orelse return false;
                for (incident.items, 0..) |face_id, index| {
                    if (face_id == terminal) component[index] = 1;
                }
                component_count = 2;
            }

            var identities = try mesh.allocator.alloc(u32, component_count);
            defer mesh.allocator.free(identities);
            identities[0] = vertex;
            var component_index: u32 = 1;
            while (component_index < component_count) : (component_index += 1) {
                identities[component_index] = @intCast(mesh.vertices.items.len);
                try mesh.vertices.append(mesh.allocator, mesh.vertices.items[vertex]);
            }
            for (incident.items, 0..) |face_id, index| {
                const replacement = identities[component[index]];
                if (replacement == vertex) continue;
                const face = &mesh.faces.items[face_id];
                const corner = indexOf(face.vertices.items, vertex) orelse return false;
                face.vertices.items[corner] = replacement;
                if (face.diagonal) |*diagonal| {
                    if (diagonal[0] == vertex) diagonal[0] = replacement;
                    if (diagonal[1] == vertex) diagonal[1] = replacement;
                }
                face.source_tessellation_valid = false;
            }
        }
        return true;
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

    fn boundaryLoopEligibility(mesh: *const Mesh, loop: []const u32) OperationEligibility {
        if (loop.len < BoundaryChamferTuning.minimum_sides)
            return .blocked(.too_few_corners, "boundary bevel needs at least three sides", null);
        var shortest = std.math.inf(f32);
        for (loop, 0..) |vertex, index| {
            const next = loop[(index + 1) % loop.len];
            if (vertex == next or vertex >= mesh.vertices.items.len or next >= mesh.vertices.items.len or
                !mesh.vertices.items[vertex].alive or !mesh.vertices.items[next].alive)
                return .blocked(.target_deleted, "boundary bevel references a missing or deleted vertex", null);
            if (mesh.edgeIncidentFaceCount(.{ vertex, next }) != 1)
                return .blocked(.boundary_not_open, "every boundary bevel edge must have exactly one incident face", null);
            for (loop[0..index]) |prior| if (prior == vertex)
                return .blocked(.invalid_seed_edge, "boundary bevel loop repeats a logical vertex", null);
            shortest = @min(shortest, length3(sub3(
                mesh.vertices.items[next].position,
                mesh.vertices.items[vertex].position,
            )));
        }
        const limit = shortest * BoundaryChamferTuning.edge_fraction;
        if (!std.math.isFinite(limit) or limit < BoundaryChamferTuning.minimum_width_m)
            return .blocked(.width_below_minimum, "boundary bevel maximum width is below the durable minimum", .{ .max_width = limit, .valence = @floatFromInt(loop.len) });
        return .allowed(.{ .max_width = limit, .valence = @floatFromInt(loop.len) });
    }

    fn boundaryChamferLimit(mesh: *const Mesh, loop: []const u32) ?f32 {
        const eligibility = mesh.boundaryLoopEligibility(loop);
        if (eligibility.status != .allowed) return null;
        return eligibility.metrics.?.max_width;
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
        if (out_loop.len >= BoundaryChamferTuning.maximum_target_sides) return null;
        const max_width = mesh.boundaryChamferLimit(out_loop) orelse return null;
        return .{
            .sides_before = @intCast(out_loop.len),
            .default_target_sides = @intCast(@min(out_loop.len * 2, BoundaryChamferTuning.maximum_target_sides)),
            .minimum_target_sides = @intCast(out_loop.len + 1),
            .maximum_target_sides = BoundaryChamferTuning.maximum_target_sides,
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

    /// Canonical noncommitting bevel predicate for an exact logical target.
    /// The mutation, popup resolver, and face table all consume this result.
    pub fn bevelEligibility(mesh: *const Mesh, target: BevelTarget) OperationEligibility {
        notePredicate(.bevel);
        const result: OperationEligibility = switch (target) {
            .edge => |edge| edge_limit: {
                if (edge[0] >= mesh.vertices.items.len or edge[1] >= mesh.vertices.items.len or
                    !mesh.vertices.items[edge[0]].alive or !mesh.vertices.items[edge[1]].alive)
                    break :edge_limit .blocked(.target_deleted, "bevel edge references a missing or deleted vertex", null);
                var incident: [2]u32 = undefined;
                if (!mesh.edgeIncidentFaces(edge, &incident))
                    break :edge_limit .blocked(.edge_not_manifold, "bevel edge must have exactly two incident authored faces", null);
                const normal0 = faceNormal(mesh, &mesh.faces.items[incident[0]]);
                const normal1 = faceNormal(mesh, &mesh.faces.items[incident[1]]);
                if (@abs(dot3(normal0, normal1)) > BevelTuning.coplanar_normal_dot)
                    break :edge_limit .blocked(.coplanar_edge, "bevel edge is coplanar and has no chamfer angle", null);
                const recede0 = mesh.edgeRecede(incident[0], edge) orelse
                    break :edge_limit .blocked(.invalid_recede, "first incident face has no valid bevel recede direction", null);
                const recede1 = mesh.edgeRecede(incident[1], edge) orelse
                    break :edge_limit .blocked(.invalid_recede, "second incident face has no valid bevel recede direction", null);
                const edge_length = length3(sub3(mesh.vertices.items[edge[1]].position, mesh.vertices.items[edge[0]].position));
                const limit = @min(
                    edge_length * BevelTuning.vertex_edge_fraction,
                    @min(recede0.reach, recede1.reach) * BevelTuning.edge_reach_fraction,
                );
                if (!std.math.isFinite(limit) or limit < BevelTuning.minimum_width_m)
                    break :edge_limit .blocked(.width_below_minimum, "bevel edge maximum width is below the durable minimum", .{ .max_width = limit });
                break :edge_limit .allowed(.{ .max_width = limit, .valence = 2 });
            },
            .vertex => |vertex| vertex_limit: {
                if (vertex >= mesh.vertices.items.len or !mesh.vertices.items[vertex].alive)
                    break :vertex_limit .blocked(.target_deleted, "bevel vertex is missing or deleted", null);
                var incident = std.ArrayListUnmanaged(u32).empty;
                defer incident.deinit(mesh.allocator);
                var neighbors = std.ArrayListUnmanaged(u32).empty;
                defer neighbors.deinit(mesh.allocator);
                mesh.collectVertexNeighborhood(vertex, &incident, &neighbors) catch
                    break :vertex_limit .blocked(.invalid_frame, "bevel vertex neighborhood could not be measured", null);
                if (neighbors.items.len < 3)
                    break :vertex_limit .blocked(.insufficient_valence, "bevel vertex needs at least three incident logical edges", .{ .valence = @floatFromInt(neighbors.items.len) });
                const origin = mesh.vertices.items[vertex].position;
                var shortest = std.math.inf(f32);
                for (neighbors.items) |neighbor| {
                    shortest = @min(shortest, length3(sub3(mesh.vertices.items[neighbor].position, origin)));
                }
                const limit = shortest * BevelTuning.vertex_edge_fraction;
                if (!std.math.isFinite(limit) or limit < BevelTuning.minimum_width_m)
                    break :vertex_limit .blocked(.width_below_minimum, "bevel vertex maximum width is below the durable minimum", .{ .max_width = limit, .valence = @floatFromInt(neighbors.items.len) });
                break :vertex_limit .allowed(.{ .max_width = limit, .valence = @floatFromInt(neighbors.items.len) });
            },
        };
        return result;
    }

    pub fn bevelContextEligibility(mesh: *const Mesh, target: BevelContextTarget) OperationEligibility {
        return switch (target) {
            .edge => |edge| mesh.bevelEligibility(.{ .edge = edge }),
            .vertex => |vertex| mesh.bevelEligibility(.{ .vertex = vertex }),
            .boundary => |face_id| blk: {
                notePredicate(.bevel);
                if (face_id >= mesh.faces.items.len)
                    break :blk .blocked(.face_out_of_range, "boundary bevel face id is out of range", null);
                const face = &mesh.faces.items[face_id];
                if (!face.alive) break :blk .blocked(.face_deleted, "boundary bevel face is deleted", null);
                break :blk mesh.boundaryLoopEligibility(face.vertices.items);
            },
        };
    }

    /// Compatibility value read used by existing popup resolution.
    pub fn bevelLimit(mesh: *const Mesh, target: BevelTarget) ?f32 {
        const eligibility = mesh.bevelEligibility(target);
        if (eligibility.status != .allowed) return null;
        return eligibility.metrics.?.max_width;
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

    fn faceUvAt(mesh: *const Mesh, face_id: u32, position: Vec3) Vec2 {
        if (face_id >= mesh.faces.items.len) return .{ 0.5, 0.5 };
        const face = &mesh.faces.items[face_id];
        if (face.vertices.items.len < 3 or face.uvs.items.len != face.vertices.items.len) return .{ 0.5, 0.5 };
        const a = mesh.vertices.items[face.vertices.items[0]].position;
        const uv_a = face.uvs.items[0];
        var corner: usize = 1;
        while (corner + 1 < face.vertices.items.len) : (corner += 1) {
            const b = mesh.vertices.items[face.vertices.items[corner]].position;
            const c = mesh.vertices.items[face.vertices.items[corner + 1]].position;
            const v0 = sub3(b, a);
            const v1 = sub3(c, a);
            const v2 = sub3(position, a);
            const d00 = dot3(v0, v0);
            const d01 = dot3(v0, v1);
            const d11 = dot3(v1, v1);
            const d20 = dot3(v2, v0);
            const d21 = dot3(v2, v1);
            const denominator = d00 * d11 - d01 * d01;
            if (@abs(denominator) <= 1e-12) continue;
            const weight_b = (d11 * d20 - d01 * d21) / denominator;
            const weight_c = (d00 * d21 - d01 * d20) / denominator;
            const weight_a = 1.0 - weight_b - weight_c;
            if (weight_a < -FacePolygonTuning.barycentric_epsilon or
                weight_b < -FacePolygonTuning.barycentric_epsilon or
                weight_c < -FacePolygonTuning.barycentric_epsilon)
            {
                continue;
            }
            const uv_b = face.uvs.items[corner];
            const uv_c = face.uvs.items[corner + 1];
            return .{
                uv_a[0] * weight_a + uv_b[0] * weight_b + uv_c[0] * weight_c,
                uv_a[1] * weight_a + uv_b[1] * weight_b + uv_c[1] * weight_c,
            };
        }
        var average = Vec2{ 0, 0 };
        for (face.uvs.items) |uv| {
            average[0] += uv[0];
            average[1] += uv[1];
        }
        const reciprocal = 1.0 / @as(f32, @floatFromInt(face.uvs.items.len));
        return .{ average[0] * reciprocal, average[1] * reciprocal };
    }

    fn appendDerivedFace(
        mesh: *Mesh,
        source_face_id: u32,
        loop: []const u32,
        uvs: []const Vec2,
        preserved_group: ?u32,
    ) !u32 {
        if (source_face_id >= mesh.faces.items.len or loop.len < 3 or loop.len != uvs.len) return error.InvalidDerivedFace;
        const source = &mesh.faces.items[source_face_id];
        const group = preserved_group orelse group: {
            const fresh = mesh.next_group;
            mesh.next_group += 1;
            break :group fresh;
        };
        var face = Face{
            .id = @intCast(mesh.faces.items.len),
            .group = group,
            .part = source.part,
            .material = source.material,
            .semantic = source.semantic,
            .source_tessellation_valid = false,
        };
        errdefer face.deinit(mesh.allocator);
        try face.vertices.appendSlice(mesh.allocator, loop);
        try face.uvs.appendSlice(mesh.allocator, uvs);
        try face.source_triangles.appendSlice(mesh.allocator, source.source_triangles.items);
        if (loop.len == 4) face.diagonal = chosenQuadDiagonal(mesh, &face);
        const id = face.id;
        try mesh.faces.append(mesh.allocator, face);
        return id;
    }

    fn cross2(a: Vec2, b: Vec2) f32 {
        return a[0] * b[1] - a[1] * b[0];
    }

    const FaceRayBoundaryHit = struct { distance: f32, param: f32 };

    /// Nearest boundary crossing of a centroid ray, as both a distance and a
    /// perimeter parameter (cumulative arc length around the face loop, taken
    /// from `corner_params`, whose last entry is the full perimeter).
    fn faceRayBoundaryHit(
        mesh: *const Mesh,
        face_id: u32,
        frame: FacePolygonFrame,
        direction: Vec2,
        corner_params: []const f32,
    ) ?FaceRayBoundaryHit {
        const face = &mesh.faces.items[face_id];
        var nearest: ?FaceRayBoundaryHit = null;
        for (face.vertices.items, 0..) |vertex_id, corner| {
            const next_id = face.vertices.items[(corner + 1) % face.vertices.items.len];
            const a3 = sub3(mesh.vertices.items[vertex_id].position, frame.center);
            const b3 = sub3(mesh.vertices.items[next_id].position, frame.center);
            const a = Vec2{ dot3(a3, frame.u), dot3(a3, frame.v) };
            const b = Vec2{ dot3(b3, frame.u), dot3(b3, frame.v) };
            const edge = Vec2{ b[0] - a[0], b[1] - a[1] };
            const denominator = cross2(direction, edge);
            if (@abs(denominator) <= 1e-8) continue;
            const distance = cross2(a, edge) / denominator;
            const along_edge = cross2(a, direction) / denominator;
            if (distance <= IMPORT_WELD_EPS or
                along_edge < -FacePolygonTuning.barycentric_epsilon or
                along_edge > 1.0 + FacePolygonTuning.barycentric_epsilon)
            {
                continue;
            }
            if (nearest == null or distance < nearest.?.distance) {
                const clamped = std.math.clamp(along_edge, 0.0, 1.0);
                nearest = .{
                    .distance = distance,
                    .param = corner_params[corner] +
                        clamped * (corner_params[corner + 1] - corner_params[corner]),
                };
            }
        }
        return nearest;
    }

    /// True when the (a, b, c, d) loop turns the frame's way at all four
    /// corners — a reflex or twisted ring-quad candidate returns false.
    fn ringQuadConvex(mesh: *const Mesh, frame: FacePolygonFrame, a_id: u32, b_id: u32, c_id: u32, d_id: u32) bool {
        const ids = [4]u32{ a_id, b_id, c_id, d_id };
        var points: [4]Vec2 = undefined;
        for (ids, 0..) |vertex_id, at| {
            const offset = sub3(mesh.vertices.items[vertex_id].position, frame.center);
            points[at] = .{ dot3(offset, frame.u), dot3(offset, frame.v) };
        }
        for (0..4) |at| {
            const p = points[(at + 3) % 4];
            const q = points[at];
            const r = points[(at + 1) % 4];
            const turn = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
            if (turn <= 0) return false;
        }
        return true;
    }

    fn polygonVertexUv(
        outer: []const u32,
        outer_uvs: []const Vec2,
        inner: []const u32,
        inner_uvs: []const Vec2,
        vertex_id: u32,
    ) ?Vec2 {
        for (outer, 0..) |candidate, index| if (candidate == vertex_id) return outer_uvs[index];
        for (inner, 0..) |candidate, index| if (candidate == vertex_id) return inner_uvs[index];
        return null;
    }

    fn appendFacePolygonRingCell(
        mesh: *Mesh,
        source_face_id: u32,
        outer: []const u32,
        outer_uvs: []const Vec2,
        inner: []const u32,
        inner_uvs: []const Vec2,
        loop: []const u32,
    ) !void {
        var cell_uvs: [4]Vec2 = undefined;
        for (loop, 0..) |vertex_id, index| {
            cell_uvs[index] = polygonVertexUv(outer, outer_uvs, inner, inner_uvs, vertex_id) orelse
                return error.InvalidFacePolygonVertex;
        }
        _ = try mesh.appendDerivedFace(source_face_id, loop, cell_uvs[0..loop.len], null);
    }

    /// Replace one convex planar authored face with a regular N-gon center and a
    /// welded transition ring. Each inner vertex is assigned to the source edge
    /// its centroid ray crosses; every source edge then stitches to exactly the
    /// inner vertices that face it (quads on the flats, triangle fans and corner
    /// triangles where densities differ). It therefore supports every target
    /// side count and any face proportion without crossing spokes or twisted
    /// ring quads, and never hides the transition in six-vertex authored faces.
    pub fn polygonizeFace(mesh: *Mesh, face_id: u32, width_raw: f32, target_sides: usize) !?u32 {
        beginMutation(.face_to_ngon);
        if (target_sides < FacePolygonTuning.minimum_target_sides or
            target_sides > FacePolygonTuning.maximum_target_sides or
            !std.math.isFinite(width_raw) or width_raw < FacePolygonTuning.minimum_width_m)
        {
            return null;
        }
        const frame = mesh.facePolygonFrame(face_id) orelse return null;
        const source = &mesh.faces.items[face_id];
        const max_width = frame.centroid_edge_clearance * FacePolygonTuning.maximum_width_fraction;
        if (width_raw > max_width) return null;
        const outer = source.vertices.items;
        const outer_uvs = source.uvs.items;
        if (outer_uvs.len != outer.len) return null;

        // Phase the regular loop from the source face's first directed edge,
        // not from its first corner. Corner anchoring makes the polygon appear
        // to rotate as N changes because a different sample becomes nearest
        // each source edge. Keeping the first inner edge parallel to the first
        // outer edge gives every side count the same visible orientation and
        // also starts the perimeter zipper at corresponding corners.
        const first_edge = sub3(
            mesh.vertices.items[outer[1]].position,
            mesh.vertices.items[outer[0]].position,
        );
        const edge_angle = std.math.atan2(dot3(first_edge, frame.v), dot3(first_edge, frame.u));
        const angle_step = 2.0 * std.math.pi / @as(f32, @floatFromInt(target_sides));
        const phase = edge_angle - std.math.pi / 2.0 - angle_step / 2.0;

        // Cumulative arc length at each source corner; the last entry is the
        // full perimeter. Each inner vertex's centroid ray records where it
        // crosses this parameterization, which is the geometric truth the
        // transition stitch below is built from.
        const outer_param = try mesh.allocator.alloc(f32, outer.len + 1);
        defer mesh.allocator.free(outer_param);
        outer_param[0] = 0;
        for (outer, 0..) |vertex_id, corner| {
            const next = mesh.vertices.items[outer[(corner + 1) % outer.len]].position;
            outer_param[corner + 1] = outer_param[corner] +
                length3(sub3(next, mesh.vertices.items[vertex_id].position));
        }

        const inner_param = try mesh.allocator.alloc(f32, target_sides);
        defer mesh.allocator.free(inner_param);
        var radius_limit = std.math.inf(f32);
        for (0..target_sides) |side| {
            const angle = phase + angle_step * @as(f32, @floatFromInt(side));
            const direction = Vec2{ @cos(angle), @sin(angle) };
            const hit = mesh.faceRayBoundaryHit(face_id, frame, direction, outer_param) orelse return null;
            radius_limit = @min(radius_limit, hit.distance);
            inner_param[side] = hit.param;
        }
        const radius = radius_limit - width_raw;
        if (!std.math.isFinite(radius) or radius <= IMPORT_WELD_EPS * 2.0) return null;

        var inner = std.ArrayListUnmanaged(u32).empty;
        defer inner.deinit(mesh.allocator);
        var inner_uvs = std.ArrayListUnmanaged(Vec2).empty;
        defer inner_uvs.deinit(mesh.allocator);
        try inner.ensureTotalCapacity(mesh.allocator, target_sides);
        try inner_uvs.ensureTotalCapacity(mesh.allocator, target_sides);
        for (0..target_sides) |side| {
            const angle = phase + angle_step * @as(f32, @floatFromInt(side));
            const position = add3(
                frame.center,
                add3(mul3(frame.u, @cos(angle) * radius), mul3(frame.v, @sin(angle) * radius)),
            );
            const vertex_id: u32 = @intCast(mesh.vertices.items.len);
            try mesh.vertices.append(mesh.allocator, .{ .position = position });
            inner.appendAssumeCapacity(vertex_id);
            inner_uvs.appendAssumeCapacity(mesh.faceUvAt(face_id, position));
        }

        const source_group = source.group;
        const center_face = try mesh.appendDerivedFace(face_id, inner.items, inner_uvs.items, source_group);
        // Stitch the transition ring by GEOMETRY, not index arithmetic. Each
        // inner vertex's centroid ray recorded WHERE it crosses the source
        // perimeter (inner_param), which assigns it to exactly one source
        // edge. A source edge with no facing inner vertex gets one triangle
        // to the vertex whose arc spans it; one facing vertex gets one
        // triangle; two or more get corner fans around a single centered
        // quad — the pattern a hand author draws. Crossing a source corner
        // always mints its corner triangle. The retired index-lockstep
        // zipper compared loop-count fractions instead, welding each inner
        // vertex to whichever corner the counter had reached — the crossing
        // spokes, slivers, and twisted ring quads of req_4686.
        var traversal_start: usize = 0;
        for (inner_param, 0..) |param, side| {
            if (param < inner_param[traversal_start]) traversal_start = side;
        }
        var consumed: usize = 0;
        var cur = inner.items[(traversal_start + target_sides - 1) % target_sides];
        for (0..outer.len) |corner| {
            const outer_a = outer[corner];
            const outer_b = outer[(corner + 1) % outer.len];
            var facing: usize = 0;
            while (consumed + facing < target_sides and
                inner_param[(traversal_start + consumed + facing) % target_sides] < outer_param[corner + 1])
            {
                facing += 1;
            }
            // Perimeter-end rounding must not strand the largest parameters.
            if (corner == outer.len - 1) facing = target_sides - consumed;
            if (facing == 0) {
                try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, outer_b, cur });
                continue;
            }
            const first = inner.items[(traversal_start + consumed) % target_sides];
            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, first, cur });
            cur = first;
            if (facing == 1) {
                try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, outer_b, cur });
            } else {
                // The pivot is the facing vertex nearest the edge's middle.
                // A quad may only stand on an inner edge flanking the pivot
                // AND only when it is actually convex: on an elongated face
                // the inner chord tilts against a long source edge, and the
                // forced quad goes reflex (back-facing sliver). When neither
                // flank supports a convex quad, the pivot takes the whole
                // source edge as a triangle and both sides fan to their
                // nearest corner — exactly the hand-authored pattern.
                var pivot: usize = 0;
                var pivot_gap = std.math.inf(f32);
                const edge_mid = (outer_param[corner] + outer_param[corner + 1]) / 2.0;
                for (0..facing) |index| {
                    const gap = @abs(inner_param[(traversal_start + consumed + index) % target_sides] - edge_mid);
                    if (gap < pivot_gap) {
                        pivot_gap = gap;
                        pivot = index;
                    }
                }
                var quad_at: ?usize = null;
                const flanks = [2]?usize{
                    if (pivot + 1 < facing) pivot else null,
                    if (pivot >= 1) pivot - 1 else null,
                };
                for (flanks) |flank| {
                    const candidate = flank orelse continue;
                    if (quad_at != null) break;
                    const near = inner.items[(traversal_start + consumed + candidate) % target_sides];
                    const far = inner.items[(traversal_start + consumed + candidate + 1) % target_sides];
                    if (mesh.ringQuadConvex(frame, outer_a, outer_b, far, near)) quad_at = candidate;
                }
                for (1..facing) |step| {
                    const next_vert = inner.items[(traversal_start + consumed + step) % target_sides];
                    if (quad_at) |quad_step| {
                        if (step - 1 == quad_step) {
                            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, outer_b, next_vert, cur });
                        } else if (step - 1 < quad_step) {
                            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, next_vert, cur });
                        } else {
                            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_b, next_vert, cur });
                        }
                    } else {
                        if (step - 1 == pivot) {
                            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, outer_b, cur });
                        }
                        if (step - 1 < pivot) {
                            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, next_vert, cur });
                        } else {
                            try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_b, next_vert, cur });
                        }
                    }
                    cur = next_vert;
                }
                if (quad_at == null and pivot == facing - 1) {
                    try mesh.appendFacePolygonRingCell(face_id, outer, outer_uvs, inner.items, inner_uvs.items, &.{ outer_a, outer_b, cur });
                }
            }
            consumed += facing;
        }
        mesh.faces.items[face_id].alive = false;
        return center_face;
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

    /// Replace selected authored edges with square-section struts. A face whose
    /// complete non-degenerate boundary is selected is consumed (Select All thus
    /// produces a wireframe cage); partially selected faces remain untouched.
    /// Incident struts extend to the same endpoint and omit internal end caps, so
    /// bends and branches meet as one continuous solid instead of detached parts.
    pub fn edgeTubes(mesh: *Mesh, edges: []const [2]u32, radius_raw: f32) !bool {
        if (edges.len == 0 or !std.math.isFinite(radius_raw)) return false;

        const EdgePlan = struct { edge: [2]u32, source_face: u32 };
        var plans = std.ArrayListUnmanaged(EdgePlan).empty;
        defer plans.deinit(mesh.allocator);
        try plans.ensureTotalCapacity(mesh.allocator, edges.len);
        var selected = std.AutoHashMapUnmanaged(u64, void).empty;
        defer selected.deinit(mesh.allocator);
        try selected.ensureTotalCapacity(mesh.allocator, @intCast(edges.len));
        var degree = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer degree.deinit(mesh.allocator);
        var junction_source = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer junction_source.deinit(mesh.allocator);
        var maximum_radius = std.math.inf(f32);

        for (edges) |edge| {
            if (edge[0] == edge[1] or edge[0] >= mesh.vertices.items.len or edge[1] >= mesh.vertices.items.len) return false;
            if (!mesh.vertices.items[edge[0]].alive or !mesh.vertices.items[edge[1]].alive) return false;
            const key = edgeKey(edge[0], edge[1]);
            if (selected.contains(key)) return false;
            var source_face: ?u32 = null;
            for (mesh.faces.items) |*face| {
                if (face.alive and faceHasUndirectedEdge(face, edge[0], edge[1])) {
                    source_face = face.id;
                    break;
                }
            }
            const source = source_face orelse return false;
            try selected.put(mesh.allocator, key, {});
            try plans.append(mesh.allocator, .{ .edge = edge, .source_face = source });
            for (edge) |vertex| {
                const entry = try degree.getOrPut(mesh.allocator, vertex);
                if (!entry.found_existing) entry.value_ptr.* = 0;
                entry.value_ptr.* += 1;
                if (!junction_source.contains(vertex)) try junction_source.put(mesh.allocator, vertex, source);
            }
            maximum_radius = @min(
                maximum_radius,
                length3(sub3(mesh.vertices.items[edge[1]].position, mesh.vertices.items[edge[0]].position)) * EdgeTubeTuning.maximum_edge_fraction,
            );
        }
        const radius = @min(radius_raw, maximum_radius);
        if (!std.math.isFinite(radius) or radius < EdgeTubeTuning.minimum_radius_m) return false;
        const junction_extent = radius * EdgeTubeTuning.junction_extent_radii;

        // Consume only faces completely described by the selected network. This
        // includes the repeated-corner triangles used to persist naked Pen Edges.
        for (mesh.faces.items) |*face| {
            if (!face.alive or face.vertices.items.len < 2) continue;
            var boundary_edges: usize = 0;
            var all_selected = true;
            for (face.vertices.items, 0..) |a, corner| {
                const b = face.vertices.items[(corner + 1) % face.vertices.items.len];
                if (a == b) continue;
                boundary_edges += 1;
                if (!selected.contains(edgeKey(a, b))) all_selected = false;
            }
            if (boundary_edges > 0 and all_selected) face.alive = false;
        }

        const Append = struct {
            fn face(target: *Mesh, source: u32, loop_raw: []const u32, outward: Vec3) !void {
                var loop: [4]u32 = undefined;
                if (loop_raw.len < 3 or loop_raw.len > loop.len) return error.InvalidTubeFace;
                @memcpy(loop[0..loop_raw.len], loop_raw);
                if (dot3(target.loopNormal(loop[0..loop_raw.len]), outward) < 0) std.mem.reverse(u32, loop[0..loop_raw.len]);
                const uv = [4]Vec2{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
                _ = try target.appendDerivedFace(source, loop[0..loop_raw.len], uv[0..loop_raw.len], null);
            }

            fn inset(direction: Vec3, offsets: [4]Vec3, extent: f32) f32 {
                var result = std.math.inf(f32);
                for (offsets) |offset| {
                    for (0..3) |axis| {
                        const component = direction[axis];
                        if (@abs(component) <= IMPORT_WELD_EPS) continue;
                        const signed_offset = if (component > 0) offset[axis] else -offset[axis];
                        result = @min(result, @max(0.0, (extent - signed_offset) / @abs(component)));
                    }
                }
                return if (std.math.isFinite(result)) result else 0;
            }
        };

        for (plans.items) |plan| {
            const a = mesh.vertices.items[plan.edge[0]].position;
            const b = mesh.vertices.items[plan.edge[1]].position;
            const direction = norm3(sub3(b, a));
            if (length3(direction) < 0.5) return false;
            const abs_direction = Vec3{ @abs(direction[0]), @abs(direction[1]), @abs(direction[2]) };
            const reference: Vec3 = if (abs_direction[0] <= abs_direction[1] and abs_direction[0] <= abs_direction[2])
                .{ 1, 0, 0 }
            else if (abs_direction[1] <= abs_direction[2])
                .{ 0, 1, 0 }
            else
                .{ 0, 0, 1 };
            const u = norm3(cross3(direction, reference));
            const v = norm3(cross3(direction, u));
            const offsets = [4]Vec3{
                add3(mul3(u, radius), mul3(v, radius)),
                add3(mul3(u, -radius), mul3(v, radius)),
                add3(mul3(u, -radius), mul3(v, -radius)),
                add3(mul3(u, radius), mul3(v, -radius)),
            };
            const a_inset = if ((degree.get(plan.edge[0]) orelse 0) > 1)
                Append.inset(direction, offsets, junction_extent)
            else
                0;
            const reverse_direction = mul3(direction, -1);
            const b_inset = if ((degree.get(plan.edge[1]) orelse 0) > 1)
                Append.inset(reverse_direction, offsets, junction_extent)
            else
                0;
            if (a_inset + b_inset >= length3(sub3(b, a)) - EdgeTubeTuning.minimum_radius_m) return false;
            const tube_a = add3(a, mul3(direction, a_inset));
            const tube_b = add3(b, mul3(direction, -b_inset));
            const first: u32 = @intCast(mesh.vertices.items.len);
            for (offsets) |offset| try mesh.vertices.append(mesh.allocator, .{ .position = add3(tube_a, offset) });
            for (offsets) |offset| try mesh.vertices.append(mesh.allocator, .{ .position = add3(tube_b, offset) });
            const midpoint = mul3(add3(tube_a, tube_b), 0.5);
            for (0..4) |side| {
                const next = (side + 1) % 4;
                const loop = [4]u32{ first + @as(u32, @intCast(side)), first + 4 + @as(u32, @intCast(side)), first + 4 + @as(u32, @intCast(next)), first + @as(u32, @intCast(next)) };
                const side_midpoint = add3(midpoint, mul3(add3(offsets[side], offsets[next]), 0.5));
                try Append.face(mesh, plan.source_face, loop[0..], sub3(side_midpoint, midpoint));
            }
            if ((degree.get(plan.edge[0]) orelse 0) == 1) {
                const cap = [4]u32{ first, first + 1, first + 2, first + 3 };
                try Append.face(mesh, plan.source_face, cap[0..], mul3(direction, -1));
            }
            if ((degree.get(plan.edge[1]) orelse 0) == 1) {
                const cap = [4]u32{ first + 4, first + 5, first + 6, first + 7 };
                try Append.face(mesh, plan.source_face, cap[0..], direction);
            }
        }

        // A selected network vertex owns one explicit square junction. Struts are
        // inset into its envelope, replacing the old pile of mutually rotated open
        // rings with one stable, closed corner/branch volume.
        var junction_iterator = degree.iterator();
        while (junction_iterator.next()) |entry| {
            if (entry.value_ptr.* <= 1) continue;
            const center = mesh.vertices.items[entry.key_ptr.*].position;
            const source = junction_source.get(entry.key_ptr.*) orelse return false;
            const first: u32 = @intCast(mesh.vertices.items.len);
            const signs = [8]Vec3{
                .{ -1, -1, -1 }, .{ 1, -1, -1 }, .{ 1, 1, -1 }, .{ -1, 1, -1 },
                .{ -1, -1, 1 },  .{ 1, -1, 1 },  .{ 1, 1, 1 },  .{ -1, 1, 1 },
            };
            for (signs) |sign| try mesh.vertices.append(mesh.allocator, .{
                .position = add3(center, mul3(sign, junction_extent)),
            });
            const faces = [6][4]u32{
                .{ 0, 4, 7, 3 }, .{ 1, 2, 6, 5 },
                .{ 0, 1, 5, 4 }, .{ 3, 7, 6, 2 },
                .{ 0, 3, 2, 1 }, .{ 4, 5, 6, 7 },
            };
            const outward = [6]Vec3{
                .{ -1, 0, 0 }, .{ 1, 0, 0 },  .{ 0, -1, 0 },
                .{ 0, 1, 0 },  .{ 0, 0, -1 }, .{ 0, 0, 1 },
            };
            for (faces, outward) |local, normal| {
                const loop = [4]u32{ first + local[0], first + local[1], first + local[2], first + local[3] };
                try Append.face(mesh, source, loop[0..], normal);
            }
        }
        try mesh.pruneOrphanVertices();
        return true;
    }

    /// Bevel a manifold-edge set simultaneously. Every source face is inset once,
    /// then edge strips and shared-vertex caps are stitched from that one corner map.
    /// Adjacent selections therefore meet at one authored cap instead of deleting the
    /// identity the next sequential edge still needs.
    pub fn bevelEdges(mesh: *Mesh, edges: []const [2]u32, width_raw: f32) !bool {
        beginMutation(.bevel);
        if (edges.len < 2) return false;

        const EdgePlan = struct { edge: [2]u32, incident: [2]u32 };
        var plans = std.ArrayListUnmanaged(EdgePlan).empty;
        defer plans.deinit(mesh.allocator);
        try plans.ensureTotalCapacity(mesh.allocator, edges.len);
        var selected = std.AutoHashMapUnmanaged(u64, void).empty;
        defer selected.deinit(mesh.allocator);
        try selected.ensureTotalCapacity(mesh.allocator, @intCast(edges.len));
        var selected_degree = std.AutoHashMapUnmanaged(u32, u32).empty;
        defer selected_degree.deinit(mesh.allocator);
        var shared_limit = std.math.inf(f32);

        for (edges) |edge| {
            const eligibility = mesh.bevelEligibility(.{ .edge = edge });
            if (!acceptOrRemember(eligibility)) return false;
            const key = edgeKey(edge[0], edge[1]);
            if (selected.contains(key)) return false;
            try selected.put(mesh.allocator, key, {});
            var incident: [2]u32 = undefined;
            if (!mesh.edgeIncidentFaces(edge, &incident)) return false;
            plans.appendAssumeCapacity(.{ .edge = edge, .incident = incident });
            for (edge) |vertex| {
                const degree = try selected_degree.getOrPut(mesh.allocator, vertex);
                if (!degree.found_existing) degree.value_ptr.* = 0;
                degree.value_ptr.* += 1;
            }
            shared_limit = @min(shared_limit, eligibility.metrics.?.max_width.?);
        }
        const width = @min(width_raw, shared_limit);
        if (!std.math.isFinite(width) or width < BevelTuning.minimum_width_m) {
            last_operation_refusal = .blocked(.width_below_minimum, "requested multi-edge bevel width is below the durable minimum", .{ .max_width = shared_limit });
            return false;
        }

        const original_face_count = mesh.faces.items.len;
        const center = mesh.meshCentroid();
        // Key = face id + original vertex id. One inset point per affected face
        // corner is the shared authority consumed by faces, strips, and caps.
        var corner_point = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer corner_point.deinit(mesh.allocator);
        try corner_point.ensureTotalCapacity(mesh.allocator, @intCast(edges.len * 4));
        // Directed original edge -> inset point nearest its first endpoint. Faces
        // across an unselected edge consume this too, preventing a geometric
        // T-junction where only the selected edge's incident face was shortened.
        var edge_split = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer edge_split.deinit(mesh.allocator);
        try edge_split.ensureTotalCapacity(mesh.allocator, @intCast(edges.len * 4));

        var face_index: usize = 0;
        while (face_index < original_face_count) : (face_index += 1) {
            const face = &mesh.faces.items[face_index];
            if (!face.alive or face.vertices.items.len < 3) continue;
            for (face.vertices.items, 0..) |vertex, corner| {
                const previous = face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len];
                const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
                const previous_selected = selected.contains(edgeKey(previous, vertex));
                const next_selected = selected.contains(edgeKey(vertex, next));
                if (!previous_selected and !next_selected) continue;

                var offset = Vec3{ 0, 0, 0 };
                if (previous_selected and next_selected) {
                    const previous_recede = mesh.edgeRecede(face.id, .{ previous, vertex }) orelse return false;
                    const next_recede = mesh.edgeRecede(face.id, .{ vertex, next }) orelse return false;
                    const denominator = 1.0 + dot3(previous_recede.direction, next_recede.direction);
                    if (@abs(denominator) <= IMPORT_WELD_EPS) return false;
                    offset = mul3(add3(previous_recede.direction, next_recede.direction), width / denominator);
                } else {
                    const edge = if (previous_selected) [2]u32{ previous, vertex } else [2]u32{ vertex, next };
                    const recede = mesh.edgeRecede(face.id, edge) orelse return false;
                    offset = mul3(recede.direction, width);
                }
                const position = add3(mesh.vertices.items[vertex].position, offset);
                if (!std.math.isFinite(position[0]) or !std.math.isFinite(position[1]) or !std.math.isFinite(position[2])) return false;
                // Adjacent selected edges can drive two face-corner solves onto the
                // same unselected edge. Reuse that exact logical point so the miter is
                // welded, not merely two coincident render positions.
                var point: ?u32 = null;
                var prior_face: u32 = 0;
                while (prior_face < face.id) : (prior_face += 1) {
                    const candidate = corner_point.get(directedEdgeKey(prior_face, vertex)) orelse continue;
                    if (samePoint(mesh.vertices.items[candidate].position, position)) {
                        point = candidate;
                        break;
                    }
                }
                if (point == null) {
                    point = @intCast(mesh.vertices.items.len);
                    try mesh.vertices.append(mesh.allocator, .{ .position = position });
                }
                try corner_point.put(mesh.allocator, directedEdgeKey(face.id, vertex), point.?);
                if (previous_selected != next_selected) {
                    const unselected_neighbor = if (previous_selected) next else previous;
                    const split_key = directedEdgeKey(vertex, unselected_neighbor);
                    if (edge_split.get(split_key)) |existing| {
                        if (existing != point.?) return false;
                    } else {
                        try edge_split.put(mesh.allocator, split_key, point.?);
                    }
                }
            }
        }

        // Rebuild each affected source face exactly once from the common corner map.
        face_index = 0;
        while (face_index < original_face_count) : (face_index += 1) {
            const face = &mesh.faces.items[face_index];
            if (!face.alive) continue;
            var changed = false;
            for (face.vertices.items, 0..) |vertex, corner| {
                const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
                if (corner_point.contains(directedEdgeKey(face.id, vertex)) or
                    edge_split.contains(directedEdgeKey(vertex, next)) or
                    edge_split.contains(directedEdgeKey(next, vertex)))
                {
                    changed = true;
                    break;
                }
            }
            if (!changed) continue;
            var vertices = std.ArrayListUnmanaged(u32).empty;
            errdefer vertices.deinit(mesh.allocator);
            var uvs = std.ArrayListUnmanaged(Vec2).empty;
            errdefer uvs.deinit(mesh.allocator);
            try vertices.ensureTotalCapacity(mesh.allocator, face.vertices.items.len + 2);
            try uvs.ensureTotalCapacity(mesh.allocator, face.vertices.items.len + 2);
            for (face.vertices.items, 0..) |vertex, corner| {
                const previous = face.vertices.items[(corner + face.vertices.items.len - 1) % face.vertices.items.len];
                const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
                const incoming = edge_split.get(directedEdgeKey(vertex, previous));
                const outgoing = edge_split.get(directedEdgeKey(vertex, next));
                const replacement = corner_point.get(directedEdgeKey(face.id, vertex));
                const candidates = if (replacement) |point|
                    [3]?u32{ incoming, point, outgoing }
                else if (incoming != null and outgoing != null)
                    // The neighboring face across a bevel endpoint is clipped too;
                    // retaining the old corner here would overlap the endpoint cap.
                    [3]?u32{ incoming, outgoing, null }
                else
                    [3]?u32{ incoming, vertex, outgoing };
                for (candidates) |candidate| {
                    const point = candidate orelse continue;
                    if (vertices.items.len > 0 and vertices.items[vertices.items.len - 1] == point) continue;
                    try vertices.append(mesh.allocator, point);
                    try uvs.append(mesh.allocator, if (point == vertex)
                        face.uvs.items[corner]
                    else
                        mesh.faceUvAt(face.id, mesh.vertices.items[point].position));
                }
            }
            if (vertices.items.len > 1 and vertices.items[0] == vertices.items[vertices.items.len - 1]) {
                _ = vertices.pop();
                _ = uvs.pop();
            }
            // Lowering triangulates 5+-corner authored faces as a fan. A split point
            // is collinear with its source edge, so choose a fan origin away from
            // every split segment instead of emitting a zero-area triangle.
            if (vertices.items.len > 4) {
                var fan_origin: ?usize = null;
                for (0..vertices.items.len) |candidate| {
                    var durable = true;
                    var step: usize = 1;
                    while (step + 1 < vertices.items.len) : (step += 1) {
                        const a = mesh.vertices.items[vertices.items[candidate]].position;
                        const b = mesh.vertices.items[vertices.items[(candidate + step) % vertices.items.len]].position;
                        const c = mesh.vertices.items[vertices.items[(candidate + step + 1) % vertices.items.len]].position;
                        const area_vector = cross3(sub3(b, a), sub3(c, a));
                        if (dot3(area_vector, area_vector) <= IMPORT_WELD_EPS * IMPORT_WELD_EPS) {
                            durable = false;
                            break;
                        }
                    }
                    if (durable) {
                        fan_origin = candidate;
                        break;
                    }
                }
                const rotate = fan_origin orelse return false;
                if (rotate != 0) {
                    std.mem.reverse(u32, vertices.items[0..rotate]);
                    std.mem.reverse(u32, vertices.items[rotate..]);
                    std.mem.reverse(u32, vertices.items);
                    std.mem.reverse(Vec2, uvs.items[0..rotate]);
                    std.mem.reverse(Vec2, uvs.items[rotate..]);
                    std.mem.reverse(Vec2, uvs.items);
                }
            }
            face.vertices.deinit(mesh.allocator);
            face.uvs.deinit(mesh.allocator);
            face.vertices = vertices;
            face.uvs = uvs;
            face.diagonal = if (face.vertices.items.len == 4) chosenQuadDiagonal(mesh, face) else null;
            face.source_tessellation_valid = false;
        }

        // One quad per selected edge, joined to the inset corners of both incident faces.
        for (plans.items) |plan| {
            var strip = [4]u32{
                corner_point.get(directedEdgeKey(plan.incident[0], plan.edge[0])) orelse return false,
                corner_point.get(directedEdgeKey(plan.incident[0], plan.edge[1])) orelse return false,
                corner_point.get(directedEdgeKey(plan.incident[1], plan.edge[1])) orelse return false,
                corner_point.get(directedEdgeKey(plan.incident[1], plan.edge[0])) orelse return false,
            };
            mesh.orientLoopOutward(strip[0..], center);
            _ = try mesh.appendBevelFace(plan.incident[0], strip[0..]);
        }

        // Close each affected original vertex. If an untouched face still uses the
        // sharp point, each selected edge owns one endpoint triangle into it. If the
        // point was fully cut away, all incident inset corners form one shared cap.
        var vertex_it = selected_degree.iterator();
        while (vertex_it.next()) |entry| {
            const vertex = entry.key_ptr.*;
            var original_still_used = false;
            face_index = 0;
            while (face_index < original_face_count) : (face_index += 1) {
                const face = &mesh.faces.items[face_index];
                if (face.alive and containsVertex(face, vertex)) {
                    original_still_used = true;
                    break;
                }
            }
            if (original_still_used) {
                for (plans.items) |plan| {
                    if (plan.edge[0] != vertex and plan.edge[1] != vertex) continue;
                    var cap = [3]u32{
                        vertex,
                        corner_point.get(directedEdgeKey(plan.incident[0], vertex)) orelse return false,
                        corner_point.get(directedEdgeKey(plan.incident[1], vertex)) orelse return false,
                    };
                    mesh.orientLoopOutward(cap[0..], center);
                    _ = try mesh.appendBevelFace(plan.incident[0], cap[0..]);
                }
                continue;
            }

            var ring = std.ArrayListUnmanaged(u32).empty;
            defer ring.deinit(mesh.allocator);
            var normal = Vec3{ 0, 0, 0 };
            var source_face: ?u32 = null;
            face_index = 0;
            while (face_index < original_face_count) : (face_index += 1) {
                const face: *const Face = &mesh.faces.items[face_index];
                const point = corner_point.get(directedEdgeKey(face.id, vertex)) orelse continue;
                var already_present = false;
                for (ring.items) |existing| if (existing == point) {
                    already_present = true;
                    break;
                };
                if (already_present) continue;
                try ring.append(mesh.allocator, point);
                normal = add3(normal, faceNormal(mesh, face));
                if (source_face == null) source_face = face.id;
            }
            // Two adjacent selected cube edges meet at one welded miter point; the
            // two edge strips close each other and need no zero-area corner cap.
            if (ring.items.len < 3) continue;
            normal = norm3(normal);
            if (length3(normal) < 0.5) return false;
            const reference = if (@abs(normal[1]) < 0.9) Vec3{ 0, 1, 0 } else Vec3{ 1, 0, 0 };
            const u_axis = norm3(cross3(normal, reference));
            const v_axis = cross3(normal, u_axis);
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
            std.mem.sort(u32, ring.items, SortContext{
                .target_mesh = mesh,
                .pivot = mesh.vertices.items[vertex].position,
                .u = u_axis,
                .v = v_axis,
            }, SortContext.lessThan);
            mesh.orientLoopOutward(ring.items, center);
            _ = try mesh.appendBevelFace(source_face.?, ring.items);
        }

        try mesh.pruneOrphanVertices();
        return true;
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
        beginMutation(.bevel);
        const eligibility = mesh.bevelEligibility(target);
        if (!acceptOrRemember(eligibility)) return false;
        const limit = eligibility.metrics.?.max_width.?;
        const width = @min(width_raw, limit);
        if (!std.math.isFinite(width) or width < BevelTuning.minimum_width_m) {
            last_operation_refusal = .blocked(.width_below_minimum, "requested bevel width is below the durable minimum", .{ .max_width = limit });
            return false;
        }
        return switch (target) {
            .edge => |edge| mesh.bevelEdge(edge, width),
            .vertex => |vertex| mesh.bevelVertex(vertex, width),
        };
    }

    fn directedEdgeKey(a: u32, b: u32) u64 {
        return (@as(u64, a) << 32) | b;
    }

    fn boundaryCornerSideCount(corner: usize, source_sides: usize, target_sides: usize) usize {
        const added_sides = target_sides - source_sides;
        return ((corner + 1) * added_sides) / source_sides - (corner * added_sides) / source_sides;
    }

    /// Chamfer one complete open boundary loop from the captured indexed base.
    /// A target of M distributes M-N new corner edges across the N old corners.
    /// Corners receiving zero stay sharp; corners receiving several use a rounded
    /// chain. The operation is simultaneous, so iteration order cannot change it.
    pub fn chamferBoundary(mesh: *Mesh, loop: []const u32, width_raw: f32, target_sides: usize) !bool {
        if (target_sides <= loop.len or target_sides > BoundaryChamferTuning.maximum_target_sides) return false;
        const limit = mesh.boundaryChamferLimit(loop) orelse return false;
        const width = @min(width_raw, limit);
        if (!std.math.isFinite(width) or width < BoundaryChamferTuning.minimum_width_m) return false;

        var point_by_direction = std.AutoHashMapUnmanaged(u64, u32).empty;
        defer point_by_direction.deinit(mesh.allocator);
        try point_by_direction.ensureTotalCapacity(mesh.allocator, @intCast(loop.len * 2));
        for (loop, 0..) |vertex, index| {
            if (boundaryCornerSideCount(index, loop.len, target_sides) == 0) continue;
            const previous = loop[(index + loop.len - 1) % loop.len];
            const next = loop[(index + 1) % loop.len];
            const a = mesh.vertices.items[vertex].position;
            const before = mesh.vertices.items[previous].position;
            const b = mesh.vertices.items[next].position;
            const incoming_length = length3(sub3(before, a));
            const outgoing_length = length3(sub3(b, a));
            if (incoming_length <= width * 2 or outgoing_length <= width * 2) return false;
            const incoming_direction = mul3(sub3(before, a), 1.0 / incoming_length);
            const outgoing_direction = mul3(sub3(b, a), 1.0 / outgoing_length);
            const near_incoming: u32 = @intCast(mesh.vertices.items.len);
            const near_outgoing: u32 = near_incoming + 1;
            try mesh.vertices.appendSlice(mesh.allocator, &.{
                Vertex{ .position = add3(a, mul3(incoming_direction, width)) },
                Vertex{ .position = add3(a, mul3(outgoing_direction, width)) },
            });
            try point_by_direction.put(mesh.allocator, directedEdgeKey(vertex, previous), near_incoming);
            try point_by_direction.put(mesh.allocator, directedEdgeKey(vertex, next), near_outgoing);
        }

        const original_face_count = mesh.faces.items.len;
        var face_index: usize = 0;
        while (face_index < original_face_count) : (face_index += 1) {
            const face = &mesh.faces.items[face_index];
            if (!face.alive or face.vertices.items.len < 3) continue;
            var split_edges: usize = 0;
            for (face.vertices.items, 0..) |vertex, corner| {
                const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
                if (point_by_direction.contains(directedEdgeKey(vertex, next)) or
                    point_by_direction.contains(directedEdgeKey(next, vertex))) split_edges += 1;
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
                const a = mesh.vertices.items[vertex].position;
                const b = mesh.vertices.items[next].position;
                const edge_length = length3(sub3(b, a));
                const fraction = width / edge_length;
                if (point_by_direction.get(directedEdgeKey(vertex, next))) |near_vertex| {
                    vertices.appendAssumeCapacity(near_vertex);
                    uvs.appendAssumeCapacity(.{
                        uv[0] + (next_uv[0] - uv[0]) * fraction,
                        uv[1] + (next_uv[1] - uv[1]) * fraction,
                    });
                }
                if (point_by_direction.get(directedEdgeKey(next, vertex))) |near_next| {
                    vertices.appendAssumeCapacity(near_next);
                    uvs.appendAssumeCapacity(.{
                        next_uv[0] + (uv[0] - next_uv[0]) * fraction,
                        next_uv[1] + (uv[1] - next_uv[1]) * fraction,
                    });
                }
            }
            face.vertices.deinit(mesh.allocator);
            face.uvs.deinit(mesh.allocator);
            face.vertices = vertices;
            face.uvs = uvs;
            face.diagonal = null;
            face.source_tessellation_valid = false;
        }

        for (loop, 0..) |vertex, index| {
            const corner_sides = boundaryCornerSideCount(index, loop.len, target_sides);
            if (corner_sides == 0) continue;
            const previous = loop[(index + loop.len - 1) % loop.len];
            const next = loop[(index + 1) % loop.len];
            const near_incoming = point_by_direction.get(directedEdgeKey(vertex, previous)) orelse return false;
            const near_outgoing = point_by_direction.get(directedEdgeKey(vertex, next)) orelse return false;
            var cap = std.ArrayListUnmanaged(u32).empty;
            defer cap.deinit(mesh.allocator);
            try cap.ensureTotalCapacity(mesh.allocator, corner_sides + 2);
            cap.appendAssumeCapacity(near_incoming);
            cap.appendAssumeCapacity(vertex);
            cap.appendAssumeCapacity(near_outgoing);
            if (corner_sides > 1) {
                const center = mesh.vertices.items[vertex].position;
                const incoming_direction = norm3(sub3(mesh.vertices.items[near_incoming].position, center));
                const outgoing_direction = norm3(sub3(mesh.vertices.items[near_outgoing].position, center));
                var segment: usize = 1;
                while (segment < corner_sides) : (segment += 1) {
                    const ratio = @as(f32, @floatFromInt(segment)) / @as(f32, @floatFromInt(corner_sides));
                    const arc_direction = norm3(lerp3(outgoing_direction, incoming_direction, ratio));
                    if (length3(arc_direction) <= 1e-6) return false;
                    const arc_vertex: u32 = @intCast(mesh.vertices.items.len);
                    try mesh.vertices.append(mesh.allocator, .{ .position = add3(center, mul3(arc_direction, width)) });
                    cap.appendAssumeCapacity(arc_vertex);
                }
            }
            var source_face: ?u32 = null;
            var reference_normal = Vec3{ 0, 0, 0 };
            for (mesh.faces.items[0..original_face_count]) |*face| {
                if (!face.alive or !containsVertex(face, vertex)) continue;
                if (source_face == null) source_face = face.id;
                reference_normal = add3(reference_normal, faceNormal(mesh, face));
            }
            const source = source_face orelse return false;
            if (dot3(mesh.loopNormal(cap.items), reference_normal) < 0) std.mem.reverse(u32, cap.items);
            _ = try mesh.appendBevelFace(source, cap.items);
        }
        return true;
    }

    pub fn lower(mesh: *const Mesh) !Lowered {
        var positions = std.ArrayListUnmanaged(f32).empty;
        defer positions.deinit(mesh.allocator);
        var normals = std.ArrayListUnmanaged(f32).empty;
        defer normals.deinit(mesh.allocator);
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
                        &normals,
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
                try emitLoweredTri(mesh, face, tris[0], &positions, &normals, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials, &semantic_regions, &semantic_instances);
                try emitLoweredTri(mesh, face, tris[1], &positions, &normals, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials, &semantic_regions, &semantic_instances);
            } else {
                var corner: usize = 1;
                while (corner + 1 < face.vertices.items.len) : (corner += 1) {
                    try emitLoweredTri(mesh, face, .{ 0, corner, corner + 1 }, &positions, &normals, &uvs, &triangle_vertices, &groups, &sources, &face_ids, &parts, &materials, &semantic_regions, &semantic_instances);
                }
            }
        }
        const pos_owned = try positions.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(pos_owned);
        const normal_owned = try normals.toOwnedSlice(mesh.allocator);
        errdefer mesh.allocator.free(normal_owned);
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
            .normals = normal_owned,
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
        normals: *std.ArrayListUnmanaged(f32),
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
        if (source_triangle >= mesh.render_triangles.items.len or
            source_triangle >= mesh.render_normals.items.len or
            source_triangle >= mesh.render_uvs.items.len)
            return error.InvalidSourceTessellation;
        const triangle = mesh.render_triangles.items[source_triangle];
        const triangle_normals = mesh.render_normals.items[source_triangle];
        const triangle_uvs = mesh.render_uvs.items[source_triangle];
        for (triangle, 0..) |vertex_id, corner| {
            if (vertex_id >= mesh.vertices.items.len) return error.InvalidSourceTessellation;
            const position = mesh.vertices.items[vertex_id].position;
            try positions.appendSlice(mesh.allocator, position[0..]);
            try normals.appendSlice(mesh.allocator, triangle_normals[corner][0..]);
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
        normals: *std.ArrayListUnmanaged(f32),
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
        const a = mesh.vertices.items[face.vertices.items[triangle[0]]].position;
        const b = mesh.vertices.items[face.vertices.items[triangle[1]]].position;
        const c = mesh.vertices.items[face.vertices.items[triangle[2]]].position;
        const normal = installedFlatNormal(a, b, c);
        for (triangle) |corner| {
            const p = mesh.vertices.items[face.vertices.items[corner]].position;
            try positions.appendSlice(mesh.allocator, p[0..]);
            try normals.appendSlice(mesh.allocator, normal[0..]);
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
        mesh.render_normals.ensureTotalCapacity(mesh.allocator, lowered.triangle_vertices.len) catch return;
        mesh.render_uvs.ensureTotalCapacity(mesh.allocator, lowered.triangle_vertices.len) catch return;
        mesh.render_triangles.clearRetainingCapacity();
        mesh.render_normals.clearRetainingCapacity();
        mesh.render_uvs.clearRetainingCapacity();
        mesh.render_triangles.appendSliceAssumeCapacity(lowered.triangle_vertices);
        var render_index: usize = 0;
        while (render_index < lowered.triangle_vertices.len) : (render_index += 1) {
            const position = render_index * 9;
            const uv = render_index * 6;
            // Every indexed install rebuilds the resident soup through
            // appendTriWithUvs, whose render normal is the flat geometric
            // triangle normal. Mirror that exact owner here so the next cache
            // validation does not mistake a successful edit for stale data.
            const a = Vec3{ lowered.positions[position], lowered.positions[position + 1], lowered.positions[position + 2] };
            const b = Vec3{ lowered.positions[position + 3], lowered.positions[position + 4], lowered.positions[position + 5] };
            const c = Vec3{ lowered.positions[position + 6], lowered.positions[position + 7], lowered.positions[position + 8] };
            const render_normal = installedFlatNormal(a, b, c);
            mesh.render_normals.appendAssumeCapacity(.{
                render_normal,
                render_normal,
                render_normal,
            });
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
        if (mesh.render_triangles.items.len != tri_count or mesh.render_normals.items.len != tri_count) return false;
        for (mesh.render_triangles.items, 0..) |triangle, rendered| {
            for (triangle, 0..) |vertex_id, output_corner| {
                if (vertex_id >= mesh.vertices.items.len) return false;
                const base = (@as(usize, rendered) * 3 + output_corner) * 8;
                mesh.vertices.items[vertex_id].position = .{ interleaved[base], interleaved[base + 1], interleaved[base + 2] };
                mesh.render_normals.items[rendered][output_corner] = .{
                    interleaved[base + 3],
                    interleaved[base + 4],
                    interleaved[base + 5],
                };
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

    fn newellNormal(mesh: *const Mesh, loop: []const u32) Vec3 {
        var normal = Vec3{ 0, 0, 0 };
        for (loop, 0..) |vertex_id, index| {
            const current = mesh.vertices.items[vertex_id].position;
            const next = mesh.vertices.items[loop[(index + 1) % loop.len]].position;
            normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
            normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
            normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
        }
        return normal;
    }

    fn faceNormal(mesh: *const Mesh, face: *const Face) Vec3 {
        return norm3(newellNormal(mesh, face.vertices.items));
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

        var probe = try Mesh.fromSoup(
            allocator,
            probe_soup,
            @intCast(survivor_count),
            probe_groups,
            probe_parts,
        );
        // fromSoup used to throw error.MalformedFaceBoundary here. It now keeps
        // the model editable by returning typed build provenance and degrading
        // only the malformed bucket to selectable triangle faces. Weld still
        // needs the same canonical boundary answer: a weld that CREATED that
        // debt must remove the touched authored face instead of committing a
        // group which immediately degrades on the next indexed rebuild.
        const malformed = probe.build_issues.items.len != 0;
        probe.deinit();
        if (malformed) {
            for (0..triangle_count) |triangle| {
                if (groups[triangle] != group or mask[triangle]) continue;
                mask[triangle] = true;
                newly_masked += 1;
            }
            continue;
        }
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
    // Import-time quad recovery is the same machine-chosen pairing as Tris to Quads, so it
    // takes the same dihedral limit (req_4143). At MERGE_FACE_NORMAL_DOT_MIN's 0.81° this
    // silently shredded every gently-curved authored quad into loose triangles on the way
    // in, which is why imported models arrive as soup and stay that way.
    if (length3(normal_a) < 0.5 or dot3(normal_a, normal_b) < QuadifyTuning.pair_normal_dot_min) return false;

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
fn positionFinite(position: Vec3) bool {
    return std.math.isFinite(position[0]) and
        std.math.isFinite(position[1]) and
        std.math.isFinite(position[2]);
}
fn norm3(a: Vec3) Vec3 {
    const length = length3(a);
    return if (length > 1e-12) mul3(a, 1.0 / length) else .{ 0, 0, 0 };
}

/// Exact normal convention used by Scene3D's appendTriWithUvs install lane.
/// Indexed metadata predicts the installed resident rows so cache validation
/// can distinguish a real external normal edit from its own successful lower.
fn installedFlatNormal(a: Vec3, b: Vec3, c: Vec3) Vec3 {
    const u = sub3(b, a);
    const v = sub3(c, a);
    var normal = Vec3{
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    };
    const length = @sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    if (length > 1e-8) {
        normal[0] /= length;
        normal[1] /= length;
        normal[2] /= length;
    } else {
        normal = .{ 0, 1, 0 };
    }
    return normal;
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

test "edge tubes consume a fully selected face into a square wireframe cage" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ -1, 0, -1 }, .{ 1, 0, -1 }, .{ 1, 0, 1 }, .{ -1, 0, 1 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    const positions = [4][2]Vec3{
        .{ quads[0][0], quads[0][1] },
        .{ quads[0][1], quads[0][2] },
        .{ quads[0][2], quads[0][3] },
        .{ quads[0][3], quads[0][0] },
    };
    var edges: [4][2]u32 = undefined;
    try std.testing.expect(mesh.resolveEdgeTubes(positions[0..], NO_PART, edges[0..]));
    try std.testing.expect(try mesh.edgeTubes(edges[0..], 0.1));
    try std.testing.expect(!mesh.faces.items[0].alive);
    var lowered = try mesh.lower();
    defer lowered.deinit();
    // Four square struts plus one closed square junction at every shared corner.
    // The old 32-triangle result was four independently oriented open tubes whose
    // endpoint rings crossed visibly instead of forming a usable cage.
    try std.testing.expectEqual(@as(u32, 80), lowered.tri_count);
    for (lowered.parts) |part| try std.testing.expectEqual(NO_PART, part);
}

test "one edge tube keeps a partial source face and closes both ends" {
    const allocator = std.testing.allocator;
    const quads = [_][4]Vec3{.{ .{ -1, 0, -1 }, .{ 1, 0, -1 }, .{ 1, 0, 1 }, .{ -1, 0, 1 } }};
    const fixture = try makeQuadStripSoup(allocator, quads[0..]);
    defer allocator.free(fixture.verts);
    defer allocator.free(fixture.groups);
    var mesh = try Mesh.fromSoup(allocator, fixture.verts, 2, fixture.groups, null);
    defer mesh.deinit();
    const positions = [1][2]Vec3{.{ quads[0][0], quads[0][1] }};
    var edges: [1][2]u32 = undefined;
    try std.testing.expect(mesh.resolveEdgeTubes(positions[0..], NO_PART, edges[0..]));
    try std.testing.expect(try mesh.edgeTubes(edges[0..], 0.1));
    try std.testing.expect(mesh.faces.items[0].alive);
    var lowered = try mesh.lower();
    defer lowered.deinit();
    // Source quad + four tube sides + two caps.
    try std.testing.expectEqual(@as(u32, 14), lowered.tri_count);
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

test "loop cut passes through a mid-ring triangle and reaches the far quad" {
    // The chamfered-solid shape (req_4728–req_4730): quad A — triangle B — quad C.
    // The reference walk terminated inside B with a corner-dive to (4,0); the
    // pass-through crosses B at the ring station and keeps walking into C.
    const allocator = std.testing.allocator;
    var soup = std.ArrayListUnmanaged(f32).empty;
    defer soup.deinit(allocator);
    // A: quad [0,0 2,0 2,2 0,2]
    try appendSoupTri(&soup, allocator, .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 2, 0 });
    try appendSoupTri(&soup, allocator, .{ 0, 0, 0 }, .{ 2, 2, 0 }, .{ 0, 2, 0 });
    // B: triangle sharing A's right edge, apex at (4,0)
    try appendSoupTri(&soup, allocator, .{ 2, 2, 0 }, .{ 2, 0, 0 }, .{ 4, 0, 0 });
    // C: quad sharing B's hypotenuse
    try appendSoupTri(&soup, allocator, .{ 2, 2, 0 }, .{ 4, 0, 0 }, .{ 6, 0, 0 });
    try appendSoupTri(&soup, allocator, .{ 2, 2, 0 }, .{ 6, 0, 0 }, .{ 6, 2, 0 });
    const groups = [_]u32{ 0, 0, 1, 2, 2 };
    var mesh = try Mesh.fromSoup(allocator, soup.items, 5, groups[0..], null);
    defer mesh.deinit();
    try std.testing.expect(try mesh.loopCutFromEdge(.{ 2, 0, 0 }, .{ 2, 2, 0 }, null, 1, 0.5));

    // A → two quads, B → triangle + quad, C → two quads.
    var alive_faces: usize = 0;
    for (mesh.faces.items) |*face| {
        if (!face.alive) continue;
        alive_faces += 1;
        try std.testing.expect(face.vertices.items.len == 3 or face.vertices.items.len == 4);
        try std.testing.expect(length3(Mesh.faceNormal(&mesh, face)) > 0.99);
    }
    try std.testing.expectEqual(@as(usize, 6), alive_faces);
    // The ring's station inside B: the pass-through exit on the hypotenuse.
    var saw_exit_station = false;
    for (mesh.vertices.items) |vertex| {
        if (samePoint(vertex.position, .{ 3, 1, 0 })) saw_exit_station = true;
    }
    try std.testing.expect(saw_exit_station);
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try std.testing.expectEqual(@as(u32, 11), lowered.tri_count);
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

test "fresh multi-cut groups remain inside their owning part partition" {
    // Parts 0 and 1 originally own groups [0,2) and [2,3). A five-cut preview on
    // part 0 appends groups 3..7 after part 1's range. Leaving that raw table live
    // makes every new strip out-of-scope; partitioning must fold the strips back
    // into part 0 and move part 1 after them without changing triangle order.
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7 };
    const parts = [_]u32{ 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    var partition = try partitionFaceGroupsByPart(std.testing.allocator, &groups, &parts, 2);
    defer partition.deinit(std.testing.allocator);

    try std.testing.expectEqualSlices(u32, &.{ 0, 0, 1, 1, 7, 7, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6 }, partition.groups);
    try std.testing.expectEqualSlices(u32, &.{ 0, 7, 7, 8 }, partition.ranges);
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
