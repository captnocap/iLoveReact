//! Island atlas layout for host-native painting — the port of the PROVEN studio
//! painter's UV model (USER RULING req_2515/req_2516: "that was always the ruling").
//!
//! The per-triangle patch grid solved the perf problem (host-native paint, no React
//! in the loop) but silently swapped the painting MODEL: fixed texels per TRIANGLE
//! regardless of physical size, each triangle a disconnected square. Writing on a big
//! face produced blobs (a 3m face got 16 texels) shredded at every triangle edge.
//!
//! This module is the layout half of the old model, ported from the studio reference
//! (cart/hmsc-int/editors/model/editMesh.ts `unwrapMesh` + textureize.ts):
//!   • an AUTHORED FACE (face-group) becomes ONE island — strokes travel continuous
//!     texture space across the whole face, exactly like the hand unwrap;
//!   • island size = the face's PHYSICAL footprint × density (texels per meter) —
//!     Blockbench semantics, where 16x means 16 texels to the meter, so a big sign
//!     face gets the texels to write words on;
//!   • intrinsic planar projection in each authored chart's own geometric basis —
//!     equal physical faces keep equal texel density regardless of world rotation;
//!   • deterministic shelf packing (tallest first, near-square target) — same mesh,
//!     same layout, every time;
//!   • ungrouped triangles (raw imports) each become their own island through the
//!     SAME path — they still get area-proportional texels, no special grid.
//!
//! Pure geometry + packing, no GPU, no globals — model_paint.zig owns adoption
//! (UV rewrite, rasterization, dirty rows); this stays unit-testable.

const std = @import("std");

pub const NO_GROUP: u32 = std.math.maxInt(u32);

/// Gutter between packed islands, in texels — stops linear filtering from pulling a
/// neighbour island across the boundary (the reference used padded gutters + bleed).
pub const PAD_TEXELS: u32 = 2;
/// f32 slack forgiven when rounding a chart extent up to whole texels — chained
/// unroll hinges accumulate ~1e-5 relative error around exact meter sizes.
const CEIL_TEXEL_FORGIVENESS: f32 = 0.01;
/// Signed UV editor workspace guard. f32 represents every integer through this
/// value exactly; it is a corruption limit, not a finite canvas boundary.
pub const MAX_SIGNED_UV_TEXELS: f32 = 16_777_216.0;

// Newly generated islands are UNFOLDED charts (req_3876): neighbouring authored
// faces hinge-unroll into one shared 2D frame across any fold below
// UNFOLD_TUNING.max_fold_degrees, stopping only at hard creases, non-manifold
// edges, and genuine 2D self-overlap. Unrolling is isometric per face, so every
// face keeps its exact physical texel density regardless of world rotation (the
// req_3726 law) while a cube unfolds into its cross, a cylinder wall into one
// strip, and a retopology band into one rectangle. The two prior half-measures —
// dominant-world-axis buckets (req_3426: big islands, cosine-squeezed density)
// and strict coplanar merging (req_3726: honest density, confetti islands) —
// are both subsumed; neither rule could ever unfold a 90° cube edge.
// Existing authored UVs retain their exact edge-based reconstruction rule below.

/// Reconstructed layouts additionally require the two copies of a shared UV edge to
/// coincide. Moving one fan wedge breaks that equality and therefore detaches it into
/// its own island without changing the model's authored face groups.
pub const UV_EDGE_MATCH_EPSILON: f32 = 0.0001;
pub const INTRINSIC_PROJECTION_TUNING = struct {
    /// Degenerate edges cannot establish a stable intrinsic chart basis.
    pub const minimum_basis_edge_m: f32 = 0.00000001;
    /// Stabilizes dimensions against f32 rotation noise before texel rounding.
    pub const extent_quantum_m: f32 = 0.000001;
};

pub const UNFOLD_TUNING = struct {
    /// Charts grow across a shared manifold edge while the fold between the two
    /// units stays under this angle — just past a right angle, so box corners
    /// (the Blockbench cross) unfold while harder creases become honest seams.
    pub const max_fold_degrees: f32 = 92.0;
    /// Interior shrink applied to triangles in the self-overlap test, as a
    /// fraction toward the centroid: edge-adjacent neighbours never collide,
    /// genuine chart curl (a fan wrapping past 360°) does.
    pub const overlap_shrink: f32 = 0.06;
    /// Overlap-grid cell size as a multiple of the mesh's mean edge length.
    pub const cell_edge_scale: f32 = 0.75;
};

pub const Island = struct {
    /// The authored group this island carries (or NO_GROUP for a loose triangle's own island).
    group: u32,
    /// Packed rect in atlas texels.
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    /// Intrinsic chart basis. Generated layouts use this orientation-independent
    /// frame; reconstructed authored layouts leave it at the harmless zero default.
    origin: [3]f32,
    basis_u: [3]f32,
    basis_v: [3]f32,
    /// Projection window in meters (the island's 2D bounds before texel scaling) — the
    /// inverse map for painting: world point → (u,v) meters → island texel.
    min_u: f32,
    min_v: f32,
};

pub const Layout = struct {
    atlas_w: u32,
    atlas_h: u32,
    /// Applied texels-per-meter — ≤ the requested density when the limits clamped it.
    density: f32,
    islands: []Island,
    /// Per displayed triangle → index into `islands`.
    tri_island: []u32,
    /// Per corner (fc*3), absolute atlas-texel coordinates (x,y interleaved) — the UVs
    /// model_paint writes into the mesh (divided by atlas dims).
    corner_uv: []f32,

    pub fn deinit(self: *Layout, alloc: std.mem.Allocator) void {
        alloc.free(self.islands);
        alloc.free(self.tri_island);
        alloc.free(self.corner_uv);
        self.* = undefined;
    }
};

fn projectIntrinsic(origin: [3]f32, basis_u: [3]f32, basis_v: [3]f32, p: [3]f32) [2]f32 {
    const relative = [3]f32{ p[0] - origin[0], p[1] - origin[1], p[2] - origin[2] };
    return .{
        relative[0] * basis_u[0] + relative[1] * basis_u[1] + relative[2] * basis_u[2],
        relative[0] * basis_v[0] + relative[1] * basis_v[1] + relative[2] * basis_v[2],
    };
}

fn quantizeExtentMeters(value: f32) f32 {
    const quantum = INTRINSIC_PROJECTION_TUNING.extent_quantum_m;
    return @round(value / quantum) * quantum;
}

const RawIsland = struct {
    group: u32,
    min_u: f32,
    min_v: f32,
    w_m: f32, // footprint in meters
    h_m: f32,
    w: u32 = 0, // texels at the current density attempt
    h: u32 = 0,
    x: u32 = 0,
    y: u32 = 0,
    first_tri: u32, // for deterministic ordering
};

const PointBits = struct { x: u32, y: u32, z: u32 };
const EdgeKey = struct { a: PointBits, b: PointBits };
const EdgeOwner = struct {
    raw: u32,
    uv_a: [2]f32,
    uv_b: [2]f32,
};
const RawPair = struct { a: u32, b: u32 };
const ComponentMap = struct { raw_to_component: []u32, count: u32 };

fn canonicalFloatBits(value: f32) u32 {
    // Shared edit-mesh vertices lower to bit-identical soup positions. Canonicalize
    // signed zero so a harmless -0 does not invent a seam.
    return if (value == 0) 0 else @bitCast(value);
}

fn pointBits(positions: []const f32, face: u32, corner: u32) PointBits {
    const base = @as(usize, face) * 9 + @as(usize, corner) * 3;
    return .{
        .x = canonicalFloatBits(positions[base + 0]),
        .y = canonicalFloatBits(positions[base + 1]),
        .z = canonicalFloatBits(positions[base + 2]),
    };
}

fn pointBefore(a: PointBits, b: PointBits) bool {
    if (a.x != b.x) return a.x < b.x;
    if (a.y != b.y) return a.y < b.y;
    return a.z < b.z;
}

fn faceUnitNormal(positions: []const f32, face: u32) ?[3]f32 {
    const base = @as(usize, face) * 9;
    const ax = positions[base + 0];
    const ay = positions[base + 1];
    const az = positions[base + 2];
    const e1x = positions[base + 3] - ax;
    const e1y = positions[base + 4] - ay;
    const e1z = positions[base + 5] - az;
    const e2x = positions[base + 6] - ax;
    const e2y = positions[base + 7] - ay;
    const e2z = positions[base + 8] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const length = @sqrt(nx * nx + ny * ny + nz * nz);
    if (!std.math.isFinite(length) or length <= 1e-8) return null;
    return .{ nx / length, ny / length, nz / length };
}

const IntrinsicBasis = struct {
    origin: [3]f32,
    u: [3]f32,
    v: [3]f32,
};

fn intrinsicBasis(positions: []const f32, face: u32, area_vector: [3]f32) ?IntrinsicBasis {
    const base = @as(usize, face) * 9;
    if (base + 8 >= positions.len) return null;
    const points = [3][3]f32{
        .{ positions[base + 0], positions[base + 1], positions[base + 2] },
        .{ positions[base + 3], positions[base + 4], positions[base + 5] },
        .{ positions[base + 6], positions[base + 7], positions[base + 8] },
    };
    const area_length = @sqrt(area_vector[0] * area_vector[0] + area_vector[1] * area_vector[1] + area_vector[2] * area_vector[2]);
    const normal = if (area_length > INTRINSIC_PROJECTION_TUNING.minimum_basis_edge_m)
        [3]f32{ area_vector[0] / area_length, area_vector[1] / area_length, area_vector[2] / area_length }
    else
        faceUnitNormal(positions, face) orelse return null;

    var best_edge: [3]f32 = undefined;
    var best_length_sq = std.math.floatMax(f32);
    for ([3][2]u8{ .{ 0, 1 }, .{ 1, 2 }, .{ 2, 0 } }) |edge| {
        const delta = [3]f32{
            points[edge[1]][0] - points[edge[0]][0],
            points[edge[1]][1] - points[edge[0]][1],
            points[edge[1]][2] - points[edge[0]][2],
        };
        const normal_component = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
        const planar = [3]f32{
            delta[0] - normal_component * normal[0],
            delta[1] - normal_component * normal[1],
            delta[2] - normal_component * normal[2],
        };
        const length_sq = planar[0] * planar[0] + planar[1] * planar[1] + planar[2] * planar[2];
        const minimum = INTRINSIC_PROJECTION_TUNING.minimum_basis_edge_m;
        if (length_sq < minimum * minimum or length_sq >= best_length_sq) continue;
        best_edge = planar;
        best_length_sq = length_sq;
    }
    if (!std.math.isFinite(best_length_sq) or best_length_sq == std.math.floatMax(f32)) return null;
    const edge_length = @sqrt(best_length_sq);
    const basis_u = [3]f32{ best_edge[0] / edge_length, best_edge[1] / edge_length, best_edge[2] / edge_length };
    const basis_v = [3]f32{
        normal[1] * basis_u[2] - normal[2] * basis_u[1],
        normal[2] * basis_u[0] - normal[0] * basis_u[2],
        normal[0] * basis_u[1] - normal[1] * basis_u[0],
    };
    return .{ .origin = points[0], .u = basis_u, .v = basis_v };
}

fn findRoot(parents: []u32, index: u32) u32 {
    var root = index;
    while (parents[root] != root) root = parents[root];
    var cursor = index;
    while (parents[cursor] != cursor) {
        const next = parents[cursor];
        parents[cursor] = root;
        cursor = next;
    }
    return root;
}

fn joinRoots(parents: []u32, a: u32, b: u32) void {
    const ra = findRoot(parents, a);
    const rb = findRoot(parents, b);
    if (ra == rb) return;
    // Stable representative: the first-authored raw island wins.
    if (ra < rb) parents[rb] = ra else parents[ra] = rb;
}

fn uvPoint(normalized_uvs: []const f32, face: u32, corner: u32) [2]f32 {
    const base = @as(usize, face) * 6 + @as(usize, corner) * 2;
    return .{ normalized_uvs[base + 0], normalized_uvs[base + 1] };
}

fn uvEdgeMatches(owner: EdgeOwner, a: [2]f32, b: [2]f32) bool {
    return @abs(owner.uv_a[0] - a[0]) <= UV_EDGE_MATCH_EPSILON and @abs(owner.uv_a[1] - a[1]) <= UV_EDGE_MATCH_EPSILON and @abs(owner.uv_b[0] - b[0]) <= UV_EDGE_MATCH_EPSILON and @abs(owner.uv_b[1] - b[1]) <= UV_EDGE_MATCH_EPSILON;
}

/// Coalesce initial authored-face buckets through real shared edges — the
/// RECONSTRUCTION rule for already-authored UV layouts: two faces are one island
/// exactly when their shared 3D edge remains shared in UV space. That is the
/// honest continuity test; the projection-era dominant-axis gate that also used
/// to apply here re-shredded unfolded charts at every 90° bucket wall on
/// save/reload adoption (req_3879). Newly generated layouts use unfoldCharts
/// instead. The returned ids are compact and first-face stable.
fn connectedComponents(
    alloc: std.mem.Allocator,
    positions: []const f32,
    normalized_uvs: []const f32,
    raw_of_face: []const u32,
    raw_count: u32,
) ?ComponentMap {
    if (raw_count == 0) return null;
    const face_count: u32 = @intCast(raw_of_face.len);
    if (positions.len < @as(usize, face_count) * 9) return null;
    if (normalized_uvs.len < @as(usize, face_count) * 6) return null;

    const parents = alloc.alloc(u32, raw_count) catch return null;
    defer alloc.free(parents);
    for (parents, 0..) |*parent, index| parent.* = @intCast(index);

    var edges = std.AutoHashMapUnmanaged(EdgeKey, EdgeOwner).empty;
    defer edges.deinit(alloc);
    var joins = std.AutoHashMapUnmanaged(RawPair, u8).empty;
    defer joins.deinit(alloc);
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        // Degenerate faces have no stable island membership to contribute.
        if (faceUnitNormal(positions, face) == null) continue;
        var edge: u32 = 0;
        while (edge < 3) : (edge += 1) {
            const ca = edge;
            const cb = (edge + 1) % 3;
            const pa = pointBits(positions, face, ca);
            const pb = pointBits(positions, face, cb);
            if (std.meta.eql(pa, pb)) continue;
            const forward = pointBefore(pa, pb);
            const key: EdgeKey = if (forward) .{ .a = pa, .b = pb } else .{ .a = pb, .b = pa };
            const uva = uvPoint(normalized_uvs, face, if (forward) ca else cb);
            const uvb = uvPoint(normalized_uvs, face, if (forward) cb else ca);
            const owner = edges.get(key) orelse {
                edges.put(alloc, key, .{ .raw = raw_of_face[face], .uv_a = uva, .uv_b = uvb }) catch return null;
                continue;
            };
            if (owner.raw == raw_of_face[face]) continue;
            if (!uvEdgeMatches(owner, uva, uvb)) continue;
            const other = raw_of_face[face];
            const pair: RawPair = if (owner.raw < other) .{ .a = owner.raw, .b = other } else .{ .a = other, .b = owner.raw };
            const entry = joins.getOrPut(alloc, pair) catch return null;
            if (!entry.found_existing) entry.value_ptr.* = 1 else entry.value_ptr.* +|= 1;
        }
    }
    // Proper manifold neighbours share one boundary edge. Coincident duplicate
    // faces share several edges; merging those would turn stacked parts into one
    // UV island merely because their geometry overlaps exactly.
    var join_it = joins.iterator();
    while (join_it.next()) |entry| {
        if (entry.value_ptr.* != 1) continue;
        joinRoots(parents, entry.key_ptr.a, entry.key_ptr.b);
    }

    const mapping = alloc.alloc(u32, raw_count) catch return null;
    errdefer alloc.free(mapping);
    var root_to_component = std.AutoHashMapUnmanaged(u32, u32).empty;
    defer root_to_component.deinit(alloc);
    var count: u32 = 0;
    var raw: u32 = 0;
    while (raw < raw_count) : (raw += 1) {
        const root = findRoot(parents, raw);
        const entry = root_to_component.getOrPut(alloc, root) catch return null;
        if (!entry.found_existing) {
            entry.value_ptr.* = count;
            count += 1;
        }
        mapping[raw] = entry.value_ptr.*;
    }
    return .{ .raw_to_component = mapping, .count = count };
}

// ── Unfold chart growth (req_3876) ──────────────────────────────────────────────
// The generation-lane grouping: every raw unit (one authored face, or one loose
// triangle) gets a planar 2D frame of its own, then charts grow across shared
// manifold edges by HINGE UNROLL — a rigid rotation+translation that lays the
// neighbouring unit flat against the already-placed side of the shared edge.
// Placement is isometric per unit (no cosine squeeze, rotation-invariant), and a
// candidate is refused only by fold angle, non-manifold incidence, or genuine 2D
// self-overlap of the growing chart, which is exactly when a seam is honest.

const UnfoldResult = struct {
    /// Per raw unit → compact chart id (seed-order stable).
    raw_to_chart: []u32,
    /// Per corner (fc*3, x/y interleaved) — meters in the owning chart's frame.
    corner_chart: []f32,
    count: u32,

    fn deinit(self: *UnfoldResult, alloc: std.mem.Allocator) void {
        alloc.free(self.raw_to_chart);
        alloc.free(self.corner_chart);
        self.* = undefined;
    }
};

const HingeOwner = struct { raw: u32, face: u32, ca: u32, cb: u32, forward: bool };
const ChartHinge = struct {
    raw_a: u32,
    raw_b: u32,
    /// Shared-edge endpoints in each side's LOCAL frame, in the canonical 3D
    /// point order — index 0 on side a is the same physical vertex as index 0
    /// on side b, which is what makes the rigid alignment well-posed.
    a_uv: [2][2]f32,
    b_uv: [2][2]f32,
    fold_ok: bool,
};
const OverlapCell = struct { x: i32, y: i32 };

fn shrinkTriangle(tri: [3][2]f32) [3][2]f32 {
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3.0;
    const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3.0;
    const keep = 1.0 - UNFOLD_TUNING.overlap_shrink;
    var out: [3][2]f32 = undefined;
    for (tri, 0..) |p, i| out[i] = .{ cx + (p[0] - cx) * keep, cy + (p[1] - cy) * keep };
    return out;
}

/// 2D triangle SAT: true when a separating axis exists (no interior overlap).
fn trianglesSeparated(a: [3][2]f32, b: [3][2]f32) bool {
    const tris = [2][3][2]f32{ a, b };
    for (tris) |edges_of| {
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const p = edges_of[k];
            const q = edges_of[(k + 1) % 3];
            const axis = [2]f32{ q[1] - p[1], p[0] - q[0] };
            var min_a: f32 = std.math.floatMax(f32);
            var max_a: f32 = -std.math.floatMax(f32);
            var min_b: f32 = std.math.floatMax(f32);
            var max_b: f32 = -std.math.floatMax(f32);
            for (a) |v| {
                const d = v[0] * axis[0] + v[1] * axis[1];
                min_a = @min(min_a, d);
                max_a = @max(max_a, d);
            }
            for (b) |v| {
                const d = v[0] * axis[0] + v[1] * axis[1];
                min_b = @min(min_b, d);
                max_b = @max(max_b, d);
            }
            if (max_a < min_b or max_b < min_a) return true;
        }
    }
    return false;
}

const OverlapGrid = struct {
    cells: std.AutoHashMapUnmanaged(OverlapCell, std.ArrayListUnmanaged(u32)),
    cell_m: f32,

    fn cellRange(self: *const OverlapGrid, tri: [3][2]f32) [4]i32 {
        var min_x: f32 = std.math.floatMax(f32);
        var min_y: f32 = std.math.floatMax(f32);
        var max_x: f32 = -std.math.floatMax(f32);
        var max_y: f32 = -std.math.floatMax(f32);
        for (tri) |p| {
            min_x = @min(min_x, p[0]);
            min_y = @min(min_y, p[1]);
            max_x = @max(max_x, p[0]);
            max_y = @max(max_y, p[1]);
        }
        return .{
            @intFromFloat(@floor(min_x / self.cell_m)),
            @intFromFloat(@floor(max_x / self.cell_m)),
            @intFromFloat(@floor(min_y / self.cell_m)),
            @intFromFloat(@floor(max_y / self.cell_m)),
        };
    }

    fn insert(self: *OverlapGrid, arena: std.mem.Allocator, face: u32, tri: [3][2]f32) bool {
        const range = self.cellRange(tri);
        var cy = range[2];
        while (cy <= range[3]) : (cy += 1) {
            var cx = range[0];
            while (cx <= range[1]) : (cx += 1) {
                const entry = self.cells.getOrPut(arena, .{ .x = cx, .y = cy }) catch return false;
                if (!entry.found_existing) entry.value_ptr.* = .empty;
                entry.value_ptr.append(arena, face) catch return false;
            }
        }
        return true;
    }

    fn overlaps(self: *const OverlapGrid, tri: [3][2]f32, shrunk_of: []const f32) bool {
        const range = self.cellRange(tri);
        var cy = range[2];
        while (cy <= range[3]) : (cy += 1) {
            var cx = range[0];
            while (cx <= range[1]) : (cx += 1) {
                const list = self.cells.get(.{ .x = cx, .y = cy }) orelse continue;
                for (list.items) |placed| {
                    const base = @as(usize, placed) * 6;
                    const other = [3][2]f32{
                        .{ shrunk_of[base + 0], shrunk_of[base + 1] },
                        .{ shrunk_of[base + 2], shrunk_of[base + 3] },
                        .{ shrunk_of[base + 4], shrunk_of[base + 5] },
                    };
                    if (!trianglesSeparated(tri, other)) return true;
                }
            }
        }
        return false;
    }
};

fn unfoldCharts(
    ret_alloc: std.mem.Allocator,
    positions: []const f32,
    tri_raw: []const u32,
    raw_count: u32,
    fc: u32,
) ?UnfoldResult {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.c_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    // ── Per-raw plane frames + per-corner LOCAL 2D coordinates ─────────────────
    const area_vec = arena.alloc([3]f32, raw_count) catch return null;
    const area_abs = arena.alloc(f32, raw_count) catch return null;
    const first_tri = arena.alloc(u32, raw_count) catch return null;
    @memset(area_vec, .{ 0, 0, 0 });
    @memset(area_abs, 0);
    @memset(first_tri, std.math.maxInt(u32));
    var total_edge_m: f64 = 0;
    var face: u32 = 0;
    while (face < fc) : (face += 1) {
        const base = @as(usize, face) * 9;
        const a = [3]f32{ positions[base + 0], positions[base + 1], positions[base + 2] };
        const b = [3]f32{ positions[base + 3], positions[base + 4], positions[base + 5] };
        const c = [3]f32{ positions[base + 6], positions[base + 7], positions[base + 8] };
        const e1 = [3]f32{ b[0] - a[0], b[1] - a[1], b[2] - a[2] };
        const e2 = [3]f32{ c[0] - a[0], c[1] - a[1], c[2] - a[2] };
        const cross = [3]f32{
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        };
        const raw = tri_raw[face];
        area_vec[raw][0] += cross[0];
        area_vec[raw][1] += cross[1];
        area_vec[raw][2] += cross[2];
        area_abs[raw] += @sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]) * 0.5;
        first_tri[raw] = @min(first_tri[raw], face);
        const e3 = [3]f32{ c[0] - b[0], c[1] - b[1], c[2] - b[2] };
        total_edge_m += @sqrt(e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]);
        total_edge_m += @sqrt(e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2]);
        total_edge_m += @sqrt(e3[0] * e3[0] + e3[1] * e3[1] + e3[2] * e3[2]);
    }
    const mean_edge_m: f32 = @floatCast(total_edge_m / @as(f64, @floatFromInt(@as(u64, fc) * 3)));
    const cell_m = @max(INTRINSIC_PROJECTION_TUNING.extent_quantum_m, mean_edge_m * UNFOLD_TUNING.cell_edge_scale);

    const normals = arena.alloc([3]f32, raw_count) catch return null;
    const bases = arena.alloc(IntrinsicBasis, raw_count) catch return null;
    var raw: u32 = 0;
    while (raw < raw_count) : (raw += 1) {
        const av = area_vec[raw];
        const len = @sqrt(av[0] * av[0] + av[1] * av[1] + av[2] * av[2]);
        normals[raw] = if (len > INTRINSIC_PROJECTION_TUNING.minimum_basis_edge_m)
            .{ av[0] / len, av[1] / len, av[2] / len }
        else
            faceUnitNormal(positions, first_tri[raw]) orelse return null;
        bases[raw] = intrinsicBasis(positions, first_tri[raw], av) orelse return null;
    }

    const corner_local = arena.alloc(f32, @as(usize, fc) * 6) catch return null;
    face = 0;
    while (face < fc) : (face += 1) {
        const basis = bases[tri_raw[face]];
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const base = @as(usize, face) * 9 + @as(usize, k) * 3;
            const uv = projectIntrinsic(basis.origin, basis.u, basis.v, .{ positions[base + 0], positions[base + 1], positions[base + 2] });
            corner_local[(@as(usize, face) * 3 + k) * 2 + 0] = uv[0];
            corner_local[(@as(usize, face) * 3 + k) * 2 + 1] = uv[1];
        }
    }

    // ── Hinges: manifold shared edges between different raws, face-scan order ──
    var edge_owners = std.AutoHashMapUnmanaged(EdgeKey, HingeOwner).empty;
    var pair_info = std.AutoHashMapUnmanaged(RawPair, u8).empty;
    var hinges = std.ArrayListUnmanaged(ChartHinge).empty;
    var hinge_pairs = std.ArrayListUnmanaged(RawPair).empty;
    const max_fold_cos = @cos(UNFOLD_TUNING.max_fold_degrees * std.math.pi / 180.0);
    face = 0;
    while (face < fc) : (face += 1) {
        var edge: u32 = 0;
        while (edge < 3) : (edge += 1) {
            const ca = edge;
            const cb = (edge + 1) % 3;
            const pa = pointBits(positions, face, ca);
            const pb = pointBits(positions, face, cb);
            if (std.meta.eql(pa, pb)) continue;
            const forward = pointBefore(pa, pb);
            const key: EdgeKey = if (forward) .{ .a = pa, .b = pb } else .{ .a = pb, .b = pa };
            const owner = edge_owners.get(key) orelse {
                edge_owners.put(arena, key, .{ .raw = tri_raw[face], .face = face, .ca = ca, .cb = cb, .forward = forward }) catch return null;
                continue;
            };
            if (owner.raw == tri_raw[face]) continue;
            const pair: RawPair = if (owner.raw < tri_raw[face])
                .{ .a = owner.raw, .b = tri_raw[face] }
            else
                .{ .a = tri_raw[face], .b = owner.raw };
            const entry = pair_info.getOrPut(arena, pair) catch return null;
            if (!entry.found_existing) entry.value_ptr.* = 1 else entry.value_ptr.* +|= 1;
            const o_first = if (owner.forward) owner.ca else owner.cb;
            const o_second = if (owner.forward) owner.cb else owner.ca;
            const m_first = if (forward) ca else cb;
            const m_second = if (forward) cb else ca;
            const na = normals[owner.raw];
            const nb = normals[tri_raw[face]];
            const fold = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
            hinges.append(arena, .{
                .raw_a = owner.raw,
                .raw_b = tri_raw[face],
                .a_uv = .{
                    .{ corner_local[(@as(usize, owner.face) * 3 + o_first) * 2 + 0], corner_local[(@as(usize, owner.face) * 3 + o_first) * 2 + 1] },
                    .{ corner_local[(@as(usize, owner.face) * 3 + o_second) * 2 + 0], corner_local[(@as(usize, owner.face) * 3 + o_second) * 2 + 1] },
                },
                .b_uv = .{
                    .{ corner_local[(@as(usize, face) * 3 + m_first) * 2 + 0], corner_local[(@as(usize, face) * 3 + m_first) * 2 + 1] },
                    .{ corner_local[(@as(usize, face) * 3 + m_second) * 2 + 0], corner_local[(@as(usize, face) * 3 + m_second) * 2 + 1] },
                },
                .fold_ok = fold >= max_fold_cos,
            }) catch return null;
            hinge_pairs.append(arena, pair) catch return null;
        }
    }
    // Per-raw adjacency, in deterministic hinge-array order; a pair sharing more
    // than one edge is coincident/duplicate geometry and never unfolds.
    const adj_head = arena.alloc(u32, raw_count) catch return null;
    @memset(adj_head, std.math.maxInt(u32));
    const adj_next = arena.alloc([2]u32, hinges.items.len) catch return null;
    const adj_tail = arena.alloc(u32, raw_count) catch return null;
    @memset(adj_tail, std.math.maxInt(u32));
    var hinge_index: u32 = 0;
    while (hinge_index < hinges.items.len) : (hinge_index += 1) {
        adj_next[hinge_index] = .{ std.math.maxInt(u32), std.math.maxInt(u32) };
        const pair = hinge_pairs.items[hinge_index];
        if ((pair_info.get(pair) orelse 0) != 1) continue;
        const hinge = hinges.items[hinge_index];
        for ([2]u32{ hinge.raw_a, hinge.raw_b }, 0..) |side_raw, side| {
            _ = side;
            if (adj_head[side_raw] == std.math.maxInt(u32)) {
                adj_head[side_raw] = hinge_index;
            } else {
                const tail = adj_tail[side_raw];
                const tail_hinge = hinges.items[tail];
                adj_next[tail][if (tail_hinge.raw_a == side_raw) 0 else 1] = hinge_index;
            }
            adj_tail[side_raw] = hinge_index;
        }
    }

    // ── Greedy BFS growth, biggest unit seeds first ────────────────────────────
    const raw_to_chart = ret_alloc.alloc(u32, raw_count) catch return null;
    errdefer ret_alloc.free(raw_to_chart);
    @memset(raw_to_chart, std.math.maxInt(u32));
    const corner_chart = ret_alloc.alloc(f32, @as(usize, fc) * 6) catch {
        ret_alloc.free(raw_to_chart);
        return null;
    };
    errdefer ret_alloc.free(corner_chart);
    const transforms = arena.alloc([4]f32, raw_count) catch return null; // cos, sin, tx, ty
    const shrunk = arena.alloc(f32, @as(usize, fc) * 6) catch return null; // placed shrunk tris, chart space
    const raw_faces_start = arena.alloc(u32, raw_count + 1) catch return null;
    @memset(raw_faces_start, 0);
    face = 0;
    while (face < fc) : (face += 1) raw_faces_start[tri_raw[face] + 1] += 1;
    raw = 1;
    while (raw <= raw_count) : (raw += 1) raw_faces_start[raw] += raw_faces_start[raw - 1];
    const raw_faces = arena.alloc(u32, fc) catch return null;
    const raw_cursor = arena.alloc(u32, raw_count) catch return null;
    @memcpy(raw_cursor, raw_faces_start[0..raw_count]);
    face = 0;
    while (face < fc) : (face += 1) {
        raw_faces[raw_cursor[tri_raw[face]]] = face;
        raw_cursor[tri_raw[face]] += 1;
    }

    const seed_order = arena.alloc(u32, raw_count) catch return null;
    for (seed_order, 0..) |*s, i| s.* = @intCast(i);
    std.mem.sort(u32, seed_order, SeedContext{ .area = area_abs, .first_tri = first_tri }, SeedContext.biggerFirst);

    var grid = OverlapGrid{ .cells = .empty, .cell_m = cell_m };
    var queue = std.ArrayListUnmanaged(u32).empty;
    var chart_count: u32 = 0;
    for (seed_order) |seed| {
        if (raw_to_chart[seed] != std.math.maxInt(u32)) continue;
        const chart = chart_count;
        chart_count += 1;
        grid.cells.clearRetainingCapacity();
        queue.clearRetainingCapacity();
        if (!placeUnit(seed, chart, .{ 1, 0, 0, 0 }, raw_to_chart, transforms, corner_local, corner_chart, shrunk, raw_faces, raw_faces_start, &grid, arena)) return null;
        pushAdjacent(seed, adj_head, adj_next, hinges.items, &queue, arena) orelse return null;
        var qi: usize = 0;
        while (qi < queue.items.len) : (qi += 1) {
            const hinge = hinges.items[queue.items[qi]];
            const a_placed = raw_to_chart[hinge.raw_a] != std.math.maxInt(u32);
            const b_placed = raw_to_chart[hinge.raw_b] != std.math.maxInt(u32);
            if (a_placed and b_placed) continue;
            if (!hinge.fold_ok) continue;
            const placed_raw = if (a_placed) hinge.raw_a else hinge.raw_b;
            const grow_raw = if (a_placed) hinge.raw_b else hinge.raw_a;
            const placed_uv = if (a_placed) hinge.a_uv else hinge.b_uv;
            const grow_uv = if (a_placed) hinge.b_uv else hinge.a_uv;
            const pt = transforms[placed_raw];
            const pa = applyTransform(pt, placed_uv[0]);
            const pb = applyTransform(pt, placed_uv[1]);
            const transform = alignEdge(grow_uv[0], grow_uv[1], pa, pb) orelse continue;
            // Overlap probe: every triangle of the candidate unit, shrunk, against
            // the chart's placed shrunk triangles.
            var collides = false;
            var fi = raw_faces_start[grow_raw];
            while (fi < raw_faces_start[grow_raw + 1]) : (fi += 1) {
                const probe_face = raw_faces[fi];
                const tri = shrinkTriangle(transformedTriangle(transform, corner_local, probe_face));
                if (grid.overlaps(tri, shrunk)) {
                    collides = true;
                    break;
                }
            }
            if (collides) continue;
            if (!placeUnit(grow_raw, chart, transform, raw_to_chart, transforms, corner_local, corner_chart, shrunk, raw_faces, raw_faces_start, &grid, arena)) return null;
            pushAdjacent(grow_raw, adj_head, adj_next, hinges.items, &queue, arena) orelse return null;
        }
    }

    return .{ .raw_to_chart = raw_to_chart, .corner_chart = corner_chart, .count = chart_count };
}

const SeedContext = struct {
    area: []const f32,
    first_tri: []const u32,

    fn biggerFirst(self: SeedContext, lhs: u32, rhs: u32) bool {
        if (self.area[lhs] != self.area[rhs]) return self.area[lhs] > self.area[rhs];
        return self.first_tri[lhs] < self.first_tri[rhs];
    }
};

fn applyTransform(t: [4]f32, p: [2]f32) [2]f32 {
    return .{ t[0] * p[0] - t[1] * p[1] + t[2], t[1] * p[0] + t[0] * p[1] + t[3] };
}

fn transformedTriangle(t: [4]f32, corner_local: []const f32, face: u32) [3][2]f32 {
    var out: [3][2]f32 = undefined;
    var k: u32 = 0;
    while (k < 3) : (k += 1) {
        const base = (@as(usize, face) * 3 + k) * 2;
        out[k] = applyTransform(t, .{ corner_local[base + 0], corner_local[base + 1] });
    }
    return out;
}

/// The rigid rotation+translation mapping local edge (a0→a1) onto chart edge
/// (b0→b1). Rotation-only (no reflection): consistently wound neighbours land on
/// opposite sides of the shared edge, which IS the hinge unroll.
fn alignEdge(a0: [2]f32, a1: [2]f32, b0: [2]f32, b1: [2]f32) ?[4]f32 {
    const da = [2]f32{ a1[0] - a0[0], a1[1] - a0[1] };
    const db = [2]f32{ b1[0] - b0[0], b1[1] - b0[1] };
    const la = @sqrt(da[0] * da[0] + da[1] * da[1]);
    const lb = @sqrt(db[0] * db[0] + db[1] * db[1]);
    const minimum = INTRINSIC_PROJECTION_TUNING.minimum_basis_edge_m;
    if (la <= minimum or lb <= minimum) return null;
    const ua = [2]f32{ da[0] / la, da[1] / la };
    const ub = [2]f32{ db[0] / lb, db[1] / lb };
    const c = ua[0] * ub[0] + ua[1] * ub[1];
    const s = ua[0] * ub[1] - ua[1] * ub[0];
    return .{ c, s, b0[0] - (c * a0[0] - s * a0[1]), b0[1] - (s * a0[0] + c * a0[1]) };
}

fn placeUnit(
    raw: u32,
    chart: u32,
    transform: [4]f32,
    raw_to_chart: []u32,
    transforms: [][4]f32,
    corner_local: []const f32,
    corner_chart: []f32,
    shrunk: []f32,
    raw_faces: []const u32,
    raw_faces_start: []const u32,
    grid: *OverlapGrid,
    arena: std.mem.Allocator,
) bool {
    raw_to_chart[raw] = chart;
    transforms[raw] = transform;
    var fi = raw_faces_start[raw];
    while (fi < raw_faces_start[raw + 1]) : (fi += 1) {
        const face = raw_faces[fi];
        const tri = transformedTriangle(transform, corner_local, face);
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            corner_chart[(@as(usize, face) * 3 + k) * 2 + 0] = tri[k][0];
            corner_chart[(@as(usize, face) * 3 + k) * 2 + 1] = tri[k][1];
        }
        const small = shrinkTriangle(tri);
        k = 0;
        while (k < 3) : (k += 1) {
            shrunk[(@as(usize, face) * 3 + k) * 2 + 0] = small[k][0];
            shrunk[(@as(usize, face) * 3 + k) * 2 + 1] = small[k][1];
        }
        if (!grid.insert(arena, face, small)) return false;
    }
    return true;
}

fn pushAdjacent(
    raw: u32,
    adj_head: []const u32,
    adj_next: []const [2]u32,
    hinges: []const ChartHinge,
    queue: *std.ArrayListUnmanaged(u32),
    arena: std.mem.Allocator,
) ?void {
    var cursor = adj_head[raw];
    while (cursor != std.math.maxInt(u32)) {
        queue.append(arena, cursor) catch return null;
        const hinge = hinges[cursor];
        cursor = adj_next[cursor][if (hinge.raw_a == raw) 0 else 1];
    }
}

/// Build the island layout. `positions` is fc*9 floats (3 corners × xyz per displayed
/// triangle); `groups` is one authored id per triangle or null (every triangle loose).
/// `density` is requested texels/meter; it HALVES until the atlas fits max_dim on both
/// axes and budget_bytes of RGBA — the caller reads the applied value from the Layout.
/// Returns null only on allocation failure or an empty mesh.
pub fn build(
    alloc: std.mem.Allocator,
    positions: []const f32,
    groups: ?[]const u32,
    density_req: f32,
    max_dim: u32,
    budget_bytes: usize,
) ?Layout {
    return buildImpl(alloc, positions, groups, density_req, null, max_dim, budget_bytes);
}

/// Build FIT to an atlas budget — the proven painter's fidelity law (reference
/// textureize.ts fitTexels, req_1207/1209/1299): the density is DERIVED so the packed
/// atlas ≈ fit_texels² REGARDLESS of model size. A lone cube spreads a whole 1024²
/// across six faces (~330 texels/face — cursive-writing fidelity); a car divides the
/// same budget among its many faces. The paint fidelity dial is the atlas SIZE, not a
/// fixed texels-per-meter. The derived density still halves if it blows the hard caps.
pub fn buildFit(
    alloc: std.mem.Allocator,
    positions: []const f32,
    groups: ?[]const u32,
    fit_texels: u32,
    max_dim: u32,
    budget_bytes: usize,
) ?Layout {
    return buildImpl(alloc, positions, groups, 1, fit_texels, max_dim, budget_bytes);
}

/// Reconstruct only the face-to-atlas metadata for an already-authored UV layout.
/// Structural indexed edits (loop cut, merge, symmetrize) interpolate the existing
/// per-corner UVs; adopting those UVs must not repack or clear the live paint atlas.
/// `normalized_uvs` is two floats per rendered corner (six per triangle).
pub fn buildFromNormalizedUv(
    alloc: std.mem.Allocator,
    positions: ?[]const f32,
    normalized_uvs: []const f32,
    groups: ?[]const u32,
    atlas_w: u32,
    atlas_h: u32,
    density: f32,
) ?Layout {
    if (atlas_w == 0 or atlas_h == 0 or normalized_uvs.len == 0 or normalized_uvs.len % 6 != 0) return null;
    const fc: u32 = @intCast(normalized_uvs.len / 6);
    if (groups) |rows| if (rows.len < @as(usize, fc)) return null;
    if (positions) |rows| if (rows.len < @as(usize, fc) * 9) return null;

    // Start with authored-face buckets, then join neighbouring buckets only when
    // their 3D edge and UV edge are both continuous. That makes a cap fan one island
    // while preserving an intentionally detached wedge after a UV edit/reopen.
    var raw_of_group = std.AutoHashMapUnmanaged(u32, u32).empty;
    defer raw_of_group.deinit(alloc);
    var raw_groups = std.ArrayListUnmanaged(u32).empty;
    defer raw_groups.deinit(alloc);
    const tri_raw = alloc.alloc(u32, fc) catch return null;
    defer alloc.free(tri_raw);
    var face: u32 = 0;
    while (face < fc) : (face += 1) {
        const group = if (groups) |rows| rows[face] else NO_GROUP;
        if (group == NO_GROUP) {
            tri_raw[face] = @intCast(raw_groups.items.len);
            raw_groups.append(alloc, NO_GROUP) catch return null;
        } else {
            const entry = raw_of_group.getOrPut(alloc, group) catch return null;
            if (!entry.found_existing) {
                entry.value_ptr.* = @intCast(raw_groups.items.len);
                raw_groups.append(alloc, group) catch return null;
            }
            tri_raw[face] = entry.value_ptr.*;
        }
    }

    const components: ComponentMap = if (positions) |pos|
        connectedComponents(alloc, pos, normalized_uvs, tri_raw, @intCast(raw_groups.items.len)) orelse return null
    else blk: {
        const identity = alloc.alloc(u32, raw_groups.items.len) catch return null;
        for (identity, 0..) |*value, index| value.* = @intCast(index);
        break :blk .{ .raw_to_component = identity, .count = @intCast(identity.len) };
    };
    defer alloc.free(components.raw_to_component);

    const tri_island = alloc.alloc(u32, fc) catch return null;
    errdefer alloc.free(tri_island);
    face = 0;
    while (face < fc) : (face += 1) tri_island[face] = components.raw_to_component[tri_raw[face]];

    const islands = alloc.alloc(Island, components.count) catch return null;
    errdefer alloc.free(islands);
    const group_seen = alloc.alloc(bool, components.count) catch return null;
    defer alloc.free(group_seen);
    @memset(group_seen, false);
    for (islands) |*island| island.* = .{
        .group = NO_GROUP,
        .x = atlas_w - 1,
        .y = atlas_h - 1,
        .w = 0,
        .h = 0,
        .origin = .{ 0, 0, 0 },
        .basis_u = .{ 0, 0, 0 },
        .basis_v = .{ 0, 0, 0 },
        .min_u = 0,
        .min_v = 0,
    };
    for (raw_groups.items, 0..) |group, raw| {
        const component = components.raw_to_component[raw];
        if (group_seen[component]) continue;
        group_seen[component] = true;
        islands[component].group = group;
    }

    const corner_uv = alloc.alloc(f32, normalized_uvs.len) catch return null;
    errdefer alloc.free(corner_uv);
    face = 0;
    while (face < fc) : (face += 1) {
        const island_index = tri_island[face];

        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const source = (@as(usize, face) * 3 + corner) * 2;
            const u = normalized_uvs[source + 0];
            const v = normalized_uvs[source + 1];
            if (!std.math.isFinite(u) or !std.math.isFinite(v)) return null;
            // Exact authored corners live in a signed, unbounded UV workspace.
            // Island rectangles remain finite u32 paint-clipping metadata, so
            // their bounds are projected onto the nearest atlas texel without
            // changing the real corner coordinates.
            const px = u * @as(f32, @floatFromInt(atlas_w));
            const py = v * @as(f32, @floatFromInt(atlas_h));
            if (!std.math.isFinite(px) or !std.math.isFinite(py) or
                @abs(px) > MAX_SIGNED_UV_TEXELS or @abs(py) > MAX_SIGNED_UV_TEXELS) return null;
            corner_uv[source + 0] = px;
            corner_uv[source + 1] = py;

            const tx: u32 = @intFromFloat(std.math.clamp(@floor(px), 0, @as(f32, @floatFromInt(atlas_w - 1))));
            const ty: u32 = @intFromFloat(std.math.clamp(@floor(py), 0, @as(f32, @floatFromInt(atlas_h - 1))));
            const island = &islands[island_index];
            if (island.w == 0) {
                island.x = tx;
                island.y = ty;
                island.w = 1;
                island.h = 1;
            } else {
                const max_x = @max(island.x + island.w - 1, tx);
                const max_y = @max(island.y + island.h - 1, ty);
                island.x = @min(island.x, tx);
                island.y = @min(island.y, ty);
                island.w = max_x - island.x + 1;
                island.h = max_y - island.y + 1;
            }
        }
    }

    return .{
        .atlas_w = atlas_w,
        .atlas_h = atlas_h,
        .density = density,
        .islands = islands,
        .tri_island = tri_island,
        .corner_uv = corner_uv,
    };
}

fn buildImpl(
    alloc: std.mem.Allocator,
    positions: []const f32,
    groups: ?[]const u32,
    density_req: f32,
    fit_texels: ?u32,
    max_dim: u32,
    budget_bytes: usize,
) ?Layout {
    const fc: u32 = @intCast(positions.len / 9);
    if (fc == 0) return null;

    // ── Group triangles into islands (order of first appearance = stable ids) ────
    var island_of_group = std.AutoHashMapUnmanaged(u32, u32).empty;
    defer island_of_group.deinit(alloc);
    var raws = std.ArrayListUnmanaged(RawIsland).empty;
    defer raws.deinit(alloc);
    var tri_island = alloc.alloc(u32, fc) catch return null;
    errdefer alloc.free(tri_island);

    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const g: u32 = if (groups) |gs| (if (f < gs.len) gs[f] else NO_GROUP) else NO_GROUP;
        if (g != NO_GROUP) {
            const gop = island_of_group.getOrPut(alloc, g) catch return null;
            if (!gop.found_existing) {
                gop.value_ptr.* = @intCast(raws.items.len);
                raws.append(alloc, .{ .group = g, .min_u = 0, .min_v = 0, .w_m = 0, .h_m = 0, .first_tri = f }) catch return null;
            }
            tri_island[f] = gop.value_ptr.*;
        } else {
            tri_island[f] = @intCast(raws.items.len);
            raws.append(alloc, .{ .group = NO_GROUP, .min_u = 0, .min_v = 0, .w_m = 0, .h_m = 0, .first_tri = f }) catch return null;
        }
    }

    // Unfold connected raw units into charts: coplanar wedges, box corners, and
    // low-fold curvature all land in one shared 2D frame; only hard creases,
    // non-manifold edges, and genuine 2D self-overlap remain seams (req_3876).
    var unfold = unfoldCharts(alloc, positions, tri_island, @intCast(raws.items.len), fc) orelse return null;
    defer unfold.deinit(alloc);
    {
        var merged = std.ArrayListUnmanaged(RawIsland).empty;
        defer merged.deinit(alloc);
        var chart: u32 = 0;
        while (chart < unfold.count) : (chart += 1) {
            merged.append(alloc, .{ .group = NO_GROUP, .min_u = 0, .min_v = 0, .w_m = 0, .h_m = 0, .first_tri = std.math.maxInt(u32) }) catch return null;
        }
        for (raws.items, 0..) |raw, raw_index| {
            const target = &merged.items[unfold.raw_to_chart[raw_index]];
            if (raw.first_tri >= target.first_tri) continue;
            target.group = raw.group;
            target.first_tri = raw.first_tri;
        }
        f = 0;
        while (f < fc) : (f += 1) tri_island[f] = unfold.raw_to_chart[tri_island[f]];
        raws.deinit(alloc);
        raws = merged;
        merged = .empty;
    }

    // ── Chart bounds in meters, straight from the unfolded corner coordinates. ──
    const n_islands: u32 = @intCast(raws.items.len);
    for (raws.items) |*r| {
        r.min_u = std.math.floatMax(f32);
        r.min_v = std.math.floatMax(f32);
        r.w_m = -std.math.floatMax(f32); // temporarily max_u/max_v
        r.h_m = -std.math.floatMax(f32);
    }
    f = 0;
    while (f < fc) : (f += 1) {
        const r = &raws.items[tri_island[f]];
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const base = (@as(usize, f) * 3 + k) * 2;
            const u = unfold.corner_chart[base + 0];
            const v = unfold.corner_chart[base + 1];
            if (u < r.min_u) r.min_u = u;
            if (v < r.min_v) r.min_v = v;
            if (u > r.w_m) r.w_m = u;
            if (v > r.h_m) r.h_m = v;
        }
    }
    for (raws.items) |*r| {
        r.w_m = quantizeExtentMeters(@max(0, r.w_m - r.min_u)); // bounds → extent in meters
        r.h_m = quantizeExtentMeters(@max(0, r.h_m - r.min_v));
    }

    // ── FIT mode: derive the density from the model's own extent so the packed atlas
    //    ≈ fit_texels². The reference law verbatim (textureize.ts): naturalExtent =
    //    max(widest island edge, √(total island area)/0.85 shelf-pack occupancy), then
    //    t = fit×0.92 headroom / naturalExtent. Density is meters-based here; the
    //    reference was units-based — same formula, different ruler.
    var density = density_req;
    if (fit_texels) |ft| {
        var area: f64 = 0;
        var widest_m: f32 = 0;
        for (raws.items) |r| {
            area += @as(f64, @max(0.001, r.w_m)) * @as(f64, @max(0.001, r.h_m));
            widest_m = @max(widest_m, @max(r.w_m, r.h_m));
        }
        const natural: f32 = @max(@max(widest_m, @as(f32, @floatCast(@sqrt(area) / 0.85))), 1e-6);
        density = @as(f32, @floatFromInt(ft)) * 0.92 / natural;
    }

    // ── Size + shelf-pack at the requested density, HALVING until both hard limits
    //    fit (the import-while-painting lesson: never hand the GPU an illegal atlas).
    var atlas_w: u32 = 0;
    var atlas_h: u32 = 0;
    var attempts: u32 = 0;
    while (attempts < 16) : (attempts += 1) {
        for (raws.items) |*r| {
            // ≥1 texel per island axis — a sliver face still gets somewhere to paint.
            // The ceil forgives a hundredth of a texel: a chart chained from many
            // unroll hinges lands at 31.9999…/32.0001… texels and must stay 32.
            r.w = @max(1, @as(u32, @ceil(@max(0.0, r.w_m * density - CEIL_TEXEL_FORGIVENESS))));
            r.h = @max(1, @as(u32, @ceil(@max(0.0, r.h_m * density - CEIL_TEXEL_FORGIVENESS))));
        }
        // Deterministic order: tallest first (reference sort), first_tri tie-break.
        const order = alloc.alloc(u32, n_islands) catch return null;
        defer alloc.free(order);
        for (order, 0..) |*o, i| o.* = @intCast(i);
        std.mem.sort(u32, order, raws.items, struct {
            fn lessThan(items: []RawIsland, lhs: u32, rhs: u32) bool {
                const a = items[lhs];
                const b = items[rhs];
                if (a.h != b.h) return a.h > b.h;
                if (a.w != b.w) return a.w > b.w;
                return a.first_tri < b.first_tri;
            }
        }.lessThan);
        // Near-square target row width (reference: max(widest, ceil(sqrt(totalArea)))).
        var total_area: u64 = 0;
        var widest: u32 = 0;
        for (raws.items) |r| {
            total_area += @as(u64, r.w + PAD_TEXELS) * @as(u64, r.h + PAD_TEXELS);
            widest = @max(widest, r.w + PAD_TEXELS);
        }
        const total_area_f: f64 = @floatFromInt(total_area);
        const square_side: f64 = @sqrt(total_area_f);
        const row_width: u32 = @max(widest, @as(u32, @ceil(square_side)));
        var cx: u32 = 0;
        var cy: u32 = 0;
        var row_h: u32 = 0;
        atlas_w = 0;
        for (order) |i| {
            const r = &raws.items[i];
            if (cx > 0 and cx + r.w + PAD_TEXELS > row_width) {
                cx = 0;
                cy += row_h + PAD_TEXELS;
                row_h = 0;
            }
            r.x = cx;
            r.y = cy;
            cx += r.w + PAD_TEXELS;
            row_h = @max(row_h, r.h);
            atlas_w = @max(atlas_w, cx);
        }
        atlas_h = cy + row_h;
        const fits_dim = atlas_w <= max_dim and atlas_h <= max_dim;
        const fits_budget = @as(usize, atlas_w) * @as(usize, atlas_h) * 4 <= budget_bytes;
        if (fits_dim and fits_budget) break;
        density /= 2;
        if (density < 0.25) return null; // absurd mesh — refuse loudly rather than 0-texel islands
    }
    if (attempts >= 16) return null;

    // ── Emit ────────────────────────────────────────────────────────────────────
    const islands = alloc.alloc(Island, n_islands) catch return null;
    errdefer alloc.free(islands);
    for (raws.items, 0..) |r, i| {
        // Unfolded charts have no single planar basis; like reconstructed layouts
        // they carry the harmless zero frame — painting maps through corner UVs.
        islands[i] = .{
            .group = r.group,
            .x = r.x,
            .y = r.y,
            .w = r.w,
            .h = r.h,
            .origin = .{ 0, 0, 0 },
            .basis_u = .{ 0, 0, 0 },
            .basis_v = .{ 0, 0, 0 },
            .min_u = r.min_u,
            .min_v = r.min_v,
        };
    }
    const corner_uv = alloc.alloc(f32, @as(usize, fc) * 6) catch return null;
    f = 0;
    while (f < fc) : (f += 1) {
        const isl = islands[tri_island[f]];
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const source = (@as(usize, f) * 3 + k) * 2;
            const uv = [2]f32{ unfold.corner_chart[source + 0], unfold.corner_chart[source + 1] };
            // Meters → island texel, inset half a texel so edge samples stay inside
            // the island under linear filtering (the pad gutter handles the rest).
            const tw: f32 = @floatFromInt(isl.w);
            const th: f32 = @floatFromInt(isl.h);
            const lx = std.math.clamp((uv[0] - isl.min_u) * density, 0.5, @max(0.5, tw - 0.5));
            const ly = std.math.clamp((uv[1] - isl.min_v) * density, 0.5, @max(0.5, th - 0.5));
            corner_uv[source + 0] = @as(f32, @floatFromInt(isl.x)) + lx;
            corner_uv[source + 1] = @as(f32, @floatFromInt(isl.y)) + ly;
        }
    }

    return .{
        .atlas_w = @max(1, atlas_w),
        .atlas_h = @max(1, atlas_h),
        .density = density,
        .islands = islands,
        .tri_island = tri_island,
        .corner_uv = corner_uv,
    };
}

// ── Tests ───────────────────────────────────────────────────────────────────────
const testing = std.testing;

// A unit-cube triangle soup: 6 quads → 12 tris, positions only (9 f32/tri).
fn cubeSoup(out: *[12 * 9]f32) void {
    const c = [8][3]f32{
        .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
        .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
    };
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 }, .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    var w: usize = 0;
    for (quads) |q| {
        const tri = [6]u32{ q[0], q[1], q[2], q[0], q[2], q[3] };
        for (tri) |vi| {
            out[w + 0] = c[vi][0];
            out[w + 1] = c[vi][1];
            out[w + 2] = c[vi][2];
            w += 3;
        }
    }
}

test "cube at 16 texels/m unfolds into ONE cross island with no self-overlap" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    var l = build(testing.allocator, soup[0..], groups[0..], 16, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);

    // The elementary-school cube cross (req_3876): one island, 4×3 faces of bbox.
    try testing.expectEqual(@as(usize, 1), l.islands.len);
    try testing.expectEqual(@as(f32, 16), l.density); // nothing clamped
    const isl = l.islands[0];
    try testing.expect((isl.w == 64 and isl.h == 48) or (isl.w == 48 and isl.h == 64));
    // Every corner's texel lands inside the island rect (with the half-texel inset).
    var f: u32 = 0;
    while (f < 12) : (f += 1) {
        try testing.expectEqual(@as(u32, 0), l.tri_island[f]);
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const x = l.corner_uv[(@as(usize, f) * 3 + k) * 2 + 0];
            const y = l.corner_uv[(@as(usize, f) * 3 + k) * 2 + 1];
            try testing.expect(x >= @as(f32, @floatFromInt(isl.x)) and x <= @as(f32, @floatFromInt(isl.x + isl.w)));
            try testing.expect(y >= @as(f32, @floatFromInt(isl.y)) and y <= @as(f32, @floatFromInt(isl.y + isl.h)));
        }
    }
    // Unfolded faces tile the cross without overlapping: pairwise shrunk-triangle
    // SAT over the emitted texel coordinates — the same test growth itself uses.
    var a: u32 = 0;
    while (a < 12) : (a += 1) {
        var tri_a: [3][2]f32 = undefined;
        var k: u32 = 0;
        while (k < 3) : (k += 1) tri_a[k] = .{ l.corner_uv[(@as(usize, a) * 3 + k) * 2 + 0], l.corner_uv[(@as(usize, a) * 3 + k) * 2 + 1] };
        const small_a = shrinkTriangle(tri_a);
        var b: u32 = a + 1;
        while (b < 12) : (b += 1) {
            var tri_b: [3][2]f32 = undefined;
            k = 0;
            while (k < 3) : (k += 1) tri_b[k] = .{ l.corner_uv[(@as(usize, b) * 3 + k) * 2 + 0], l.corner_uv[(@as(usize, b) * 3 + k) * 2 + 1] };
            try testing.expect(trianglesSeparated(small_a, shrinkTriangle(tri_b)));
        }
    }
    try testing.expect(l.atlas_w <= 8192 and l.atlas_h <= 8192);
}

test "generated UVs keep one outward handedness on both sides of every axis" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    var layout = build(testing.allocator, soup[0..], groups[0..], 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);

    var face: usize = 0;
    while (face < 12) : (face += 1) {
        const at = face * 6;
        const ax = layout.corner_uv[at + 0];
        const ay = layout.corner_uv[at + 1];
        const bx = layout.corner_uv[at + 2];
        const by = layout.corner_uv[at + 3];
        const cx = layout.corner_uv[at + 4];
        const cy = layout.corner_uv[at + 5];
        const signed_area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        try testing.expect(signed_area > 0);
    }
}

test "a big face gets proportionally more texels than a small one (density model)" {
    // One 4m×4m quad + one 0.5m×0.5m quad, both +Y facing, distinct groups.
    var soup: [4 * 9]f32 = undefined;
    const big = [4][3]f32{ .{ 0, 0, 0 }, .{ 4, 0, 0 }, .{ 4, 0, 4 }, .{ 0, 0, 4 } };
    const small = [4][3]f32{ .{ 10, 0, 10 }, .{ 10.5, 0, 10 }, .{ 10.5, 0, 10.5 }, .{ 10, 0, 10.5 } };
    var w: usize = 0;
    for ([2][4][3]f32{ big, small }) |q| {
        const tri = [6]u32{ 0, 1, 2, 0, 2, 3 };
        for (tri) |vi| {
            soup[w + 0] = q[vi][0];
            soup[w + 1] = q[vi][1];
            soup[w + 2] = q[vi][2];
            w += 3;
        }
    }
    const groups = [4]u32{ 0, 0, 1, 1 };
    var l = build(testing.allocator, soup[0..], groups[0..], 16, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    const a = l.islands[l.tri_island[0]];
    const b = l.islands[l.tri_island[2]];
    try testing.expectEqual(@as(u32, 64), a.w); // 4m × 16/m
    try testing.expectEqual(@as(u32, 8), b.w); // 0.5m × 16/m
}

test "density halves until the atlas fits the dimension limit" {
    // A 100m×100m face at 128 texels/m wants 12800² — must clamp, not crash.
    var soup: [2 * 9]f32 = undefined;
    const q = [4][3]f32{ .{ 0, 0, 0 }, .{ 100, 0, 0 }, .{ 100, 0, 100 }, .{ 0, 0, 100 } };
    const tri = [6]u32{ 0, 1, 2, 0, 2, 3 };
    var w: usize = 0;
    for (tri) |vi| {
        soup[w + 0] = q[vi][0];
        soup[w + 1] = q[vi][1];
        soup[w + 2] = q[vi][2];
        w += 3;
    }
    const groups = [2]u32{ 0, 0 };
    var l = build(testing.allocator, soup[0..], groups[0..], 128, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expect(l.atlas_w <= 8192 and l.atlas_h <= 8192);
    try testing.expect(l.density < 128);
    try testing.expect(l.density >= 32); // 100m × 64/m = 6400 fits; one or two halvings at most
}

test "ungrouped triangle soup unfolds through shared edges like grouped faces" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    var l = build(testing.allocator, soup[0..], null, 16, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 1), l.islands.len);
    for (l.islands) |isl| try testing.expectEqual(NO_GROUP, isl.group);
}

test "a closed prism unfolds into one chart including its cap fans" {
    const segments = 4;
    var soup: [segments * 4 * 9]f32 = undefined;
    var groups: [segments * 4]u32 = undefined;
    const ring = [segments][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ 1, 1 }, .{ -1, 1 } };
    var write: usize = 0;
    var face: usize = 0;
    var segment: usize = 0;
    while (segment < segments) : (segment += 1) {
        const next = (segment + 1) % segments;
        const bottom_a = [3]f32{ ring[segment][0], -0.5, ring[segment][1] };
        const top_a = [3]f32{ ring[segment][0], 0.5, ring[segment][1] };
        const bottom_b = [3]f32{ ring[next][0], -0.5, ring[next][1] };
        const top_b = [3]f32{ ring[next][0], 0.5, ring[next][1] };
        const triangles = [4][3][3]f32{
            .{ bottom_a, top_a, top_b },
            .{ bottom_a, top_b, bottom_b },
            .{ top_a, .{ 0, 0.5, 0 }, top_b },
            .{ bottom_a, bottom_b, .{ 0, -0.5, 0 } },
        };
        for (triangles, 0..) |triangle, local| {
            for (triangle) |point| for (point) |coordinate| {
                soup[write] = coordinate;
                write += 1;
            };
            groups[face] = if (local < 2) @intCast(segment) else @intCast(segments + segment * 2 + local - 2);
            face += 1;
        }
    }
    var layout = build(testing.allocator, &soup, &groups, 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);

    // Every fold of the closed prism is a right angle, under the unfold limit:
    // walls unroll into a strip and both cap fans flap out flat — one chart.
    try testing.expectEqual(@as(usize, 1), layout.islands.len);
    const top_island = layout.tri_island[2];
    const bottom_island = layout.tri_island[3];
    try testing.expectEqual(top_island, bottom_island);
    segment = 1;
    while (segment < segments) : (segment += 1) {
        try testing.expectEqual(top_island, layout.tri_island[segment * 4 + 2]);
        try testing.expectEqual(bottom_island, layout.tri_island[segment * 4 + 3]);
    }
}

test "equal cylinder walls keep equal intrinsic texel scale across world rotation" {
    // A 6-wall open cylinder (no caps). Every wall is the same physical square.
    // Each gets its own planar chart so PRESTACK can literally reuse all six; no
    // side may shrink merely because its normal is diagonal to a world axis.
    const walls = 6;
    var soup: [walls * 2 * 9]f32 = undefined;
    var groups: [walls * 2]u32 = undefined;
    // Precompute the ring so the wrap edge shares bit-identical positions — a real
    // mesh's shared vertices lower to identical soup floats; cos(2π) ≠ cos(0) does not.
    var ring: [walls][2]f32 = undefined;
    for (&ring, 0..) |*point, index| {
        const angle = @as(f32, @floatFromInt(index)) * std.math.pi * 2 / walls;
        point.* = .{ @cos(angle), @sin(angle) };
    }
    var write: usize = 0;
    var wall: usize = 0;
    while (wall < walls) : (wall += 1) {
        const next = (wall + 1) % walls;
        const bottom_a = [3]f32{ ring[wall][0], -0.5, ring[wall][1] };
        const top_a = [3]f32{ ring[wall][0], 0.5, ring[wall][1] };
        const bottom_b = [3]f32{ ring[next][0], -0.5, ring[next][1] };
        const top_b = [3]f32{ ring[next][0], 0.5, ring[next][1] };
        for ([2][3][3]f32{ .{ bottom_a, top_a, top_b }, .{ bottom_a, top_b, bottom_b } }) |triangle| {
            for (triangle) |point| for (point) |coordinate| {
                soup[write] = coordinate;
                write += 1;
            };
        }
        groups[wall * 2 + 0] = @intCast(wall);
        groups[wall * 2 + 1] = @intCast(wall);
    }
    var rotated: [walls * 2 * 9]f32 = undefined;
    const azimuth: f32 = 0.37;
    const elevation: f32 = -0.61;
    const cos_a = @cos(azimuth);
    const sin_a = @sin(azimuth);
    const cos_e = @cos(elevation);
    const sin_e = @sin(elevation);
    var coordinate: usize = 0;
    while (coordinate < soup.len) : (coordinate += 3) {
        const x = soup[coordinate + 0];
        const y = soup[coordinate + 1];
        const z = soup[coordinate + 2];
        const yaw_x = cos_a * x + sin_a * z;
        const yaw_z = -sin_a * x + cos_a * z;
        rotated[coordinate + 0] = yaw_x;
        rotated[coordinate + 1] = cos_e * y - sin_e * yaw_z;
        rotated[coordinate + 2] = sin_e * y + cos_e * yaw_z;
    }

    var layout = build(testing.allocator, &soup, &groups, 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);
    var rotated_layout = build(testing.allocator, &rotated, &groups, 16, 8192, 256 << 20).?;
    defer rotated_layout.deinit(testing.allocator);

    // The 60° hexagon folds all unroll: six 1m walls become ONE 6m×1m strip —
    // 96×16 texels — and the unroll is intrinsic, so a rotated copy of the same
    // geometry produces the identical island shape (the req_3726 law, kept).
    try testing.expectEqual(@as(usize, 1), layout.islands.len);
    try testing.expectEqual(layout.islands.len, rotated_layout.islands.len);
    const reference = layout.islands[0];
    const rotated_reference = rotated_layout.islands[0];
    try testing.expect((reference.w == 96 and reference.h == 16) or (reference.w == 16 and reference.h == 96));
    try testing.expectEqual(reference.w, rotated_reference.w);
    try testing.expectEqual(reference.h, rotated_reference.h);
    wall = 0;
    while (wall < walls) : (wall += 1) {
        try testing.expectEqual(@as(u32, 0), layout.tri_island[wall * 2]);
        try testing.expectEqual(@as(u32, 0), layout.tri_island[wall * 2 + 1]);
        try testing.expectEqual(@as(u32, 0), rotated_layout.tri_island[wall * 2]);
        try testing.expectEqual(@as(u32, 0), rotated_layout.tri_island[wall * 2 + 1]);
    }
}

test "a curved retopo band unrolls into one strip at true physical density" {
    // Eight 0.25m×1m quads bending 15° per hinge — a seat-hull retopology band.
    // Neither prior rule kept this together (buckets split at the 45° axis wall,
    // coplanarity split at every hinge); the unroll makes it ONE ~2m strip whose
    // every quad keeps its exact meter width in texels.
    const quads = 8;
    var soup: [quads * 2 * 9]f32 = undefined;
    var groups: [quads * 2]u32 = undefined;
    const step: f32 = 0.25;
    var rail_x: f32 = 0;
    var rail_z: f32 = 0;
    var heading: f32 = 0;
    var write: usize = 0;
    var quad: usize = 0;
    while (quad < quads) : (quad += 1) {
        const next_x = rail_x + step * @cos(heading);
        const next_z = rail_z + step * @sin(heading);
        const a0 = [3]f32{ rail_x, 0, rail_z };
        const a1 = [3]f32{ rail_x, 1, rail_z };
        const b0 = [3]f32{ next_x, 0, next_z };
        const b1 = [3]f32{ next_x, 1, next_z };
        for ([2][3][3]f32{ .{ a0, a1, b1 }, .{ a0, b1, b0 } }) |triangle| {
            for (triangle) |point| for (point) |coordinate| {
                soup[write] = coordinate;
                write += 1;
            };
        }
        groups[quad * 2 + 0] = @intCast(quad);
        groups[quad * 2 + 1] = @intCast(quad);
        rail_x = next_x;
        rail_z = next_z;
        heading += 15.0 * std.math.pi / 180.0;
    }
    var layout = build(testing.allocator, &soup, &groups, 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 1), layout.islands.len);
    const isl = layout.islands[0];
    const long = @max(isl.w, isl.h);
    const short = @min(isl.w, isl.h);
    try testing.expectEqual(@as(u32, 32), long); // 8 × 0.25m × 16 texels/m
    try testing.expectEqual(@as(u32, 16), short);
}

test "a fold past the unfold limit stays an honest seam" {
    // Two 1m quads whose normals differ by 120° — past max_fold_degrees. The
    // chart must refuse the hinge: two islands, no unrolled continuity to lie about.
    var soup: [4 * 9]f32 = undefined;
    const turn = 120.0 * std.math.pi / 180.0;
    const dx = @cos(turn); // the band folds back sharply
    const dz = @sin(turn);
    const a0 = [3]f32{ -1, 0, 0 };
    const a1 = [3]f32{ -1, 1, 0 };
    const m0 = [3]f32{ 0, 0, 0 };
    const m1 = [3]f32{ 0, 1, 0 };
    const b0 = [3]f32{ dx, 0, dz };
    const b1 = [3]f32{ dx, 1, dz };
    var write: usize = 0;
    for ([4][3][3]f32{ .{ a0, a1, m1 }, .{ a0, m1, m0 }, .{ m0, m1, b1 }, .{ m0, b1, b0 } }) |triangle| {
        for (triangle) |point| for (point) |coordinate| {
            soup[write] = coordinate;
            write += 1;
        };
    }
    const groups = [4]u32{ 0, 0, 1, 1 };
    var layout = build(testing.allocator, &soup, &groups, 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 2), layout.islands.len);
    try testing.expect(layout.tri_island[0] != layout.tri_island[2]);
}

test "reconstruction honors UV continuity across a 90° fold — no bucket shredding" {
    // An unfolded chart carries folds up to 92°; when its corner UVs are adopted
    // back (save/reload, structural edit), the reconstruction lane must keep the
    // chart whole wherever the UVs are continuous — the projection-era dominant-
    // axis gate split it at every bucket wall instead (req_3879).
    const positions = [_]f32{
        // quad A, z=0 plane (normal +z)
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
        // quad B folds 90° at the shared edge y=1,z=0 (normal +y)
        0, 1, 0, 1, 1, 0, 1, 1, -1,
        0, 1, 0, 1, 1, -1, 0, 1, -1,
    };
    const uvs = [_]f32{
        0.1, 0.1, 0.3, 0.1, 0.3, 0.5,
        0.1, 0.1, 0.3, 0.5, 0.1, 0.5,
        0.1, 0.5, 0.3, 0.5, 0.3, 0.7,
        0.1, 0.5, 0.3, 0.7, 0.1, 0.7,
    };
    const groups = [_]u32{ 0, 0, 1, 1 };
    var layout = buildFromNormalizedUv(std.testing.allocator, &positions, &uvs, &groups, 128, 128, 16) orelse return error.OutOfMemory;
    defer layout.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), layout.islands.len);
    try std.testing.expectEqual(layout.tri_island[0], layout.tri_island[2]);
}

test "existing normalized UVs rebuild metadata without repacking" {
    const allocator = std.testing.allocator;
    const uvs = [_]f32{
        0.125, 0.25, 0.5, 0.25, 0.5,   0.75,
        0.125, 0.25, 0.5, 0.75, 0.125, 0.75,
    };
    const groups = [_]u32{ 7, 7 };
    const positions = [_]f32{
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
    };
    var layout = buildFromNormalizedUv(allocator, &positions, &uvs, &groups, 128, 64, 16) orelse return error.OutOfMemory;
    defer layout.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), layout.islands.len);
    try std.testing.expectEqual(@as(u32, 0), layout.tri_island[0]);
    try std.testing.expectEqual(@as(u32, 0), layout.tri_island[1]);
    for (uvs, 0..) |normalized, index| {
        const dimension: f32 = if (index % 2 == 0) 128 else 64;
        try std.testing.expectApproxEqAbs(normalized * dimension, layout.corner_uv[index], 0.0001);
    }
    try std.testing.expectEqual(@as(u32, 16), layout.islands[0].x);
    try std.testing.expectEqual(@as(u32, 16), layout.islands[0].y);
    try std.testing.expectEqual(@as(u32, 49), layout.islands[0].w);
    try std.testing.expectEqual(@as(u32, 33), layout.islands[0].h);
}

test "buildFit: a lone cube spreads the whole atlas budget across its unfolded cross" {
    // The proven painter's law (req_1299): fidelity comes from the atlas SIZE, not a
    // fixed texels/meter. A 1m cube at fit-1024 unfolds into one 4m×3m cross:
    // naturalExtent = max(4, √12/0.85 ≈ 4.08) → density ≈ 1024×0.92/4.08 ≈ 231
    // texels/m, and the packed atlas stays around (under) the requested budget.
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    var l = buildFit(testing.allocator, soup[0..], groups[0..], 1024, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 1), l.islands.len);
    try testing.expect(l.density > 215 and l.density < 245);
    const isl = l.islands[0];
    const long = @max(isl.w, isl.h);
    const short = @min(isl.w, isl.h);
    try testing.expect(long >= 860 and long <= 980);
    try testing.expect(short >= 645 and short <= 735);
    try testing.expect(l.atlas_w <= 1100 and l.atlas_h <= 1100); // ≈ the fit, never wildly over
}

test "buildFit: a big model derives a LOW density — same budget, spread thin" {
    // A 100m×100m ground face at fit-1024 must land near 1024 texels across — i.e.
    // density ≈ 9 texels/m — instead of exploding the atlas.
    var soup: [2 * 9]f32 = undefined;
    const q = [4][3]f32{ .{ 0, 0, 0 }, .{ 100, 0, 0 }, .{ 100, 0, 100 }, .{ 0, 0, 100 } };
    const tri = [6]u32{ 0, 1, 2, 0, 2, 3 };
    var w: usize = 0;
    for (tri) |vi| {
        soup[w + 0] = q[vi][0];
        soup[w + 1] = q[vi][1];
        soup[w + 2] = q[vi][2];
        w += 3;
    }
    const groups = [2]u32{ 0, 0 };
    var l = buildFit(testing.allocator, soup[0..], groups[0..], 1024, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expect(l.atlas_w <= 1100 and l.atlas_h <= 1100);
    try testing.expect(l.density > 5 and l.density < 12);
}
