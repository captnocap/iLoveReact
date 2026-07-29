//! Automatic skin weights — voxel-geodesic binding (SKIN-3499, phase 2).
//!
//! The production-robust family (Dionne & de Lasa, SCA 2013 / TVCG 2014),
//! adapted to this editor's Lego part model: instead of seeding each bone's
//! distance field from a bone SEGMENT, we seed it from the surface voxels of
//! the bone's OWN authored part (the per-vertex joint prior the rigid payload
//! already carries). Deep inside a part the part's bone stays ~1.0; at a seam
//! the neighbouring part's distance approaches zero too, so influence blends
//! smoothly across exactly the seams that used to hinge.
//!
//! Pipeline: AABB → uniform voxel grid → triangle rasterization (SAT) tags
//! boundary voxels + per-bone seeds → 3-axis parity voting classifies interior
//! (≥2 votes; tolerant of holes/self-intersections the way the paper's z-buffer
//! voting is) → per-bone label-correcting BFS through non-exterior voxels
//! (6-connected, Euclidean costs, ×penalty entering boundary voxels — the
//! TVCG armpit fix) → per-vertex falloff max(d_tol, d)^(−λ) → top-4 weights,
//! pruned + renormalized → one weld-aware Laplacian smoothing pass.
//!
//! Everything happens IN PLACE on the stride-16 wire verts
//! [pos3, normal3, uv2, j0..j3, w0..w3]; unreachable vertices keep their rigid
//! prior (always defined) and are counted loudly.

const std = @import("std");

pub const STRIDE = 16;

pub const SolveParams = struct {
    /// Voxels along the mesh's LONGEST extent (other axes scale down).
    resolution: u32 = 96,
    /// Falloff stiffness: weight = normalized_distance^(−lambda). The Maya
    /// falloff slider maps roughly to 5 (soft) … 30 (rigid); 10 ≈ its default.
    lambda: f32 = 10.0,
    /// Edge-cost multiplier entering a BOUNDARY voxel — biases geodesics
    /// through the interior so a path can't skim across a fold (armpit).
    boundary_penalty: f32 = 4.0,
    max_influences: u32 = 4,
    /// Influences below this (after normalize) are dropped, rest renormalized.
    prune_below: f32 = 0.02,
    /// Weld radius for the smoothing graph, metres — seam-coincident corners
    /// of NEIGHBOURING parts must weld or smoothing can't see across the seam.
    weld_epsilon: f32 = 1e-3,
    smoothing_iterations: u32 = 1,
};

pub const SolveStats = struct {
    bones: usize = 0,
    verts: usize = 0,
    voxels_non_exterior: usize = 0,
    unreachable_verts: usize = 0,
};

const VOX_EXTERIOR: u8 = 0;
const VOX_BOUNDARY: u8 = 1;
const VOX_INTERIOR: u8 = 2;
/// Max axis crossings a parity column tracks (a torso column crosses ~a dozen).
const MAX_COLUMN_CROSSINGS = 64;
const INF = std.math.inf(f32);

const Grid = struct {
    nx: usize,
    ny: usize,
    nz: usize,
    voxel: f32, // uniform voxel edge length, metres
    min: [3]f32,

    fn cellCount(self: Grid) usize {
        return self.nx * self.ny * self.nz;
    }
    fn index(self: Grid, gx: usize, gy: usize, gz: usize) usize {
        return (gz * self.ny + gy) * self.nx + gx;
    }
    fn clampAxis(self: Grid, v: f32, axis: usize) usize {
        const n: f32 = switch (axis) {
            0 => @floatFromInt(self.nx),
            1 => @floatFromInt(self.ny),
            else => @floatFromInt(self.nz),
        };
        const c = std.math.clamp(@floor((v - self.min[axis]) / self.voxel), 0.0, n - 1.0);
        const out: usize = @intFromFloat(c);
        return out;
    }
    fn center(self: Grid, gx: usize, gy: usize, gz: usize) [3]f32 {
        return .{
            self.min[0] + (@as(f32, @floatFromInt(gx)) + 0.5) * self.voxel,
            self.min[1] + (@as(f32, @floatFromInt(gy)) + 0.5) * self.voxel,
            self.min[2] + (@as(f32, @floatFromInt(gz)) + 0.5) * self.voxel,
        };
    }
};

/// Solve smooth weights in place. `verts` is vert_count stride-16 rows whose
/// joint slots carry the rigid part prior (j0 = part rank, w0 = 1). Bone count
/// is the number of distinct part ranks (the staged bone table's row count).
pub fn solveVoxelGeodesic(
    allocator: std.mem.Allocator,
    verts: []f32,
    vert_count: usize,
    bone_count: usize,
    params: SolveParams,
) !SolveStats {
    var stats = SolveStats{ .bones = bone_count, .verts = vert_count };
    if (vert_count < 3 or bone_count == 0 or bone_count > 255) return stats;

    // ── Grid from the padded AABB ───────────────────────────────────────────
    var mn = [3]f32{ INF, INF, INF };
    var mx = [3]f32{ -INF, -INF, -INF };
    var vi: usize = 0;
    while (vi < vert_count) : (vi += 1) {
        const p = verts[vi * STRIDE ..][0..3];
        var a: usize = 0;
        while (a < 3) : (a += 1) {
            mn[a] = @min(mn[a], p[a]);
            mx[a] = @max(mx[a], p[a]);
        }
    }
    const extent = @max(@max(mx[0] - mn[0], mx[1] - mn[1]), @max(mx[2] - mn[2], 1e-4));
    const res: f32 = @floatFromInt(@max(params.resolution, 8));
    const voxel = extent / res;
    var grid = Grid{ .nx = 0, .ny = 0, .nz = 0, .voxel = voxel, .min = undefined };
    {
        var a: usize = 0;
        while (a < 3) : (a += 1) grid.min[a] = mn[a] - voxel; // one-voxel pad
        grid.nx = @intFromFloat(@ceil((mx[0] - mn[0]) / voxel) + 3);
        grid.ny = @intFromFloat(@ceil((mx[1] - mn[1]) / voxel) + 3);
        grid.nz = @intFromFloat(@ceil((mx[2] - mn[2]) / voxel) + 3);
    }

    const cells = grid.cellCount();
    const class = try allocator.alloc(u8, cells);
    defer allocator.free(class);
    @memset(class, VOX_EXTERIOR);

    // ── Rasterize triangles: boundary voxels + per-bone surface seeds ──────
    // Seeds collect (voxel index, bone) pairs; duplicates are harmless to the
    // BFS (a re-pushed 0-distance seed relaxes nothing).
    var seeds: std.ArrayList(struct { cell: u32, bone: u16 }) = .empty;
    defer seeds.deinit(allocator);
    const tri_count = vert_count / 3;
    var ti: usize = 0;
    while (ti < tri_count) : (ti += 1) {
        const a = verts[(ti * 3 + 0) * STRIDE ..][0..3];
        const b = verts[(ti * 3 + 1) * STRIDE ..][0..3];
        const c = verts[(ti * 3 + 2) * STRIDE ..][0..3];
        const bone: u16 = boneOfRow(verts, ti * 3);
        const lo = [3]usize{
            grid.clampAxis(@min(a[0], @min(b[0], c[0])), 0),
            grid.clampAxis(@min(a[1], @min(b[1], c[1])), 1),
            grid.clampAxis(@min(a[2], @min(b[2], c[2])), 2),
        };
        const hi = [3]usize{
            grid.clampAxis(@max(a[0], @max(b[0], c[0])), 0),
            grid.clampAxis(@max(a[1], @max(b[1], c[1])), 1),
            grid.clampAxis(@max(a[2], @max(b[2], c[2])), 2),
        };
        var gz = lo[2];
        while (gz <= hi[2]) : (gz += 1) {
            var gy = lo[1];
            while (gy <= hi[1]) : (gy += 1) {
                var gx = lo[0];
                while (gx <= hi[0]) : (gx += 1) {
                    const ctr = grid.center(gx, gy, gz);
                    if (!triBoxOverlap(ctr, voxel * 0.5, a.*, b.*, c.*)) continue;
                    const cell = grid.index(gx, gy, gz);
                    if (class[cell] != VOX_BOUNDARY) class[cell] = VOX_BOUNDARY;
                    try seeds.append(allocator, .{ .cell = @intCast(cell), .bone = bone });
                }
            }
        }
    }

    // ── Interior by 3-axis parity voting (≥ 2 of 3) ────────────────────────
    const votes = try allocator.alloc(u8, cells);
    defer allocator.free(votes);
    @memset(votes, 0);
    try parityVoteAxis(allocator, verts, vert_count, grid, votes, 2); // columns along z
    try parityVoteAxis(allocator, verts, vert_count, grid, votes, 1); // along y
    try parityVoteAxis(allocator, verts, vert_count, grid, votes, 0); // along x
    for (class, 0..) |*cl, cell| {
        if (cl.* == VOX_EXTERIOR and votes[cell] >= 2) cl.* = VOX_INTERIOR;
    }

    // ── Dense index over non-exterior voxels ───────────────────────────────
    const dense_of = try allocator.alloc(i32, cells);
    defer allocator.free(dense_of);
    var dense_cells: std.ArrayList(u32) = .empty;
    defer dense_cells.deinit(allocator);
    for (class, 0..) |cl, cell| {
        if (cl == VOX_EXTERIOR) {
            dense_of[cell] = -1;
        } else {
            dense_of[cell] = @intCast(dense_cells.items.len);
            try dense_cells.append(allocator, @intCast(cell));
        }
    }
    const n_dense = dense_cells.items.len;
    stats.voxels_non_exterior = n_dense;
    if (n_dense == 0) return stats;

    // ── Per-bone geodesic distances (label-correcting BFS) ─────────────────
    const dist = try allocator.alloc(f32, bone_count * n_dense);
    defer allocator.free(dist);
    @memset(dist, INF);
    var queue: std.ArrayList(u32) = .empty; // dense indices, FIFO via head cursor
    defer queue.deinit(allocator);
    var bone: usize = 0;
    while (bone < bone_count) : (bone += 1) {
        const d = dist[bone * n_dense ..][0..n_dense];
        queue.clearRetainingCapacity();
        for (seeds.items) |seed| {
            if (seed.bone != bone) continue;
            const dense = dense_of[seed.cell];
            if (dense < 0) continue;
            const di: usize = @intCast(dense);
            if (d[di] != 0) {
                d[di] = 0;
                try queue.append(allocator, @intCast(di));
            }
        }
        var head: usize = 0;
        while (head < queue.items.len) : (head += 1) {
            const di = queue.items[head];
            const cell: usize = dense_cells.items[di];
            const base = d[di];
            const gx = cell % grid.nx;
            const gy = (cell / grid.nx) % grid.ny;
            const gz = cell / (grid.nx * grid.ny);
            var n: usize = 0;
            while (n < 6) : (n += 1) {
                const ncell = neighborCell(grid, gx, gy, gz, n) orelse continue;
                const ndense = dense_of[ncell];
                if (ndense < 0) continue;
                const ndi: usize = @intCast(ndense);
                const step = if (class[ncell] == VOX_BOUNDARY) voxel * params.boundary_penalty else voxel;
                const cand = base + step;
                if (cand < d[ndi] - 1e-6) {
                    d[ndi] = cand;
                    try queue.append(allocator, @intCast(ndi));
                }
            }
        }
    }

    // ── Per-vertex weights: falloff over normalized distance, top-K ────────
    const influences: usize = @min(@max(params.max_influences, 1), 4);
    const d_tol = (voxel * 0.5) / extent;
    vi = 0;
    while (vi < vert_count) : (vi += 1) {
        const row = verts[vi * STRIDE ..][0..STRIDE];
        const cell = grid.index(
            grid.clampAxis(row[0], 0),
            grid.clampAxis(row[1], 1),
            grid.clampAxis(row[2], 2),
        );
        const dense = dense_of[cell];
        if (dense < 0) {
            stats.unreachable_verts += 1; // keep the rigid prior
            continue;
        }
        const di: usize = @intCast(dense);
        var top_bone = [4]u16{ 0, 0, 0, 0 };
        var top_w = [4]f32{ 0, 0, 0, 0 };
        var reachable = false;
        var bi: usize = 0;
        while (bi < bone_count) : (bi += 1) {
            const bd = dist[bi * n_dense + di];
            if (bd == INF) continue;
            reachable = true;
            const dn = @max(d_tol, bd / extent);
            const w = std.math.pow(f32, dn, -params.lambda);
            insertTop(&top_bone, &top_w, influences, @intCast(bi), w);
        }
        if (!reachable) {
            stats.unreachable_verts += 1; // keep the rigid prior
            continue;
        }
        writeWeights(row, top_bone, top_w, params.prune_below);
    }

    // ── Weld-aware Laplacian smoothing of the weight field ─────────────────
    if (params.smoothing_iterations > 0) {
        smoothWeights(allocator, verts, vert_count, params) catch |err| {
            // Smoothing is a quality pass, not correctness — keep solved weights.
            std.debug.print("[skin-solve] smoothing skipped ({s})\n", .{@errorName(err)});
        };
    }
    return stats;
}

fn boneOfRow(verts: []const f32, row: usize) u16 {
    const j = verts[row * STRIDE + 8];
    const i: i32 = @trunc(@max(0.0, j));
    return @intCast(@min(i, 255));
}

fn neighborCell(grid: Grid, gx: usize, gy: usize, gz: usize, n: usize) ?usize {
    switch (n) {
        0 => return if (gx + 1 < grid.nx) grid.index(gx + 1, gy, gz) else null,
        1 => return if (gx > 0) grid.index(gx - 1, gy, gz) else null,
        2 => return if (gy + 1 < grid.ny) grid.index(gx, gy + 1, gz) else null,
        3 => return if (gy > 0) grid.index(gx, gy - 1, gz) else null,
        4 => return if (gz + 1 < grid.nz) grid.index(gx, gy, gz + 1) else null,
        else => return if (gz > 0) grid.index(gx, gy, gz - 1) else null,
    }
}

fn insertTop(bones: *[4]u16, weights: *[4]f32, k: usize, bone: u16, w: f32) void {
    var slot: usize = 0;
    while (slot < k) : (slot += 1) {
        if (w > weights[slot]) {
            var back = k - 1;
            while (back > slot) : (back -= 1) {
                weights[back] = weights[back - 1];
                bones[back] = bones[back - 1];
            }
            weights[slot] = w;
            bones[slot] = bone;
            return;
        }
    }
}

fn writeWeights(row: []f32, bones: [4]u16, weights: [4]f32, prune_below: f32) void {
    var sum: f32 = 0;
    for (weights) |w| sum += w;
    if (sum <= 0) return;
    var pruned = weights;
    var pruned_sum: f32 = 0;
    for (&pruned) |*w| {
        if (w.* / sum < prune_below) w.* = 0;
        pruned_sum += w.*;
    }
    if (pruned_sum <= 0) return;
    var slot: usize = 0;
    while (slot < 4) : (slot += 1) {
        row[8 + slot] = @floatFromInt(bones[slot]);
        row[12 + slot] = pruned[slot] / pruned_sum;
    }
}

// ── Parity voting ───────────────────────────────────────────────────────────
// One axis pass: bin triangles by grid column, intersect each column's center
// ray, sort crossings, parity-fill voxel centers between pairs. Shared-edge
// double counts and open-mesh noise are absorbed by the 2-of-3 vote.
fn parityVoteAxis(
    allocator: std.mem.Allocator,
    verts: []const f32,
    vert_count: usize,
    grid: Grid,
    votes: []u8,
    axis: usize,
) !void {
    const u_axis: usize = if (axis == 0) 1 else 0;
    const v_axis: usize = if (axis == 2) 1 else 2;
    const nu = switch (u_axis) {
        0 => grid.nx,
        1 => grid.ny,
        else => grid.nz,
    };
    const nv = switch (v_axis) {
        0 => grid.nx,
        1 => grid.ny,
        else => grid.nz,
    };
    const n_along = switch (axis) {
        0 => grid.nx,
        1 => grid.ny,
        else => grid.nz,
    };

    // Column bins: head index per column + a growable linked list of
    // (triangle, next) nodes — a single big torso triangle can span hundreds
    // of columns, so the chain must not be capped.
    const heads = try allocator.alloc(i32, nu * nv);
    defer allocator.free(heads);
    @memset(heads, -1);
    const tri_count = vert_count / 3;
    var next: std.ArrayList(i32) = .empty;
    defer next.deinit(allocator);
    var node_tri: std.ArrayList(u32) = .empty;
    defer node_tri.deinit(allocator);

    var ti: usize = 0;
    while (ti < tri_count) : (ti += 1) {
        const a = verts[(ti * 3 + 0) * STRIDE ..][0..3];
        const b = verts[(ti * 3 + 1) * STRIDE ..][0..3];
        const c = verts[(ti * 3 + 2) * STRIDE ..][0..3];
        const ulo = grid.clampAxis(@min(a[u_axis], @min(b[u_axis], c[u_axis])), u_axis);
        const uhi = grid.clampAxis(@max(a[u_axis], @max(b[u_axis], c[u_axis])), u_axis);
        const vlo = grid.clampAxis(@min(a[v_axis], @min(b[v_axis], c[v_axis])), v_axis);
        const vhi = grid.clampAxis(@max(a[v_axis], @max(b[v_axis], c[v_axis])), v_axis);
        var cu = ulo;
        while (cu <= uhi) : (cu += 1) {
            var cv = vlo;
            while (cv <= vhi) : (cv += 1) {
                const col = cv * nu + cu;
                try next.append(allocator, heads[col]);
                try node_tri.append(allocator, @intCast(ti));
                heads[col] = @intCast(next.items.len - 1);
            }
        }
    }

    var crossings: [MAX_COLUMN_CROSSINGS]f32 = undefined;
    var cu: usize = 0;
    while (cu < nu) : (cu += 1) {
        var cv: usize = 0;
        while (cv < nv) : (cv += 1) {
            var n_cross: usize = 0;
            const ray_u = grid.min[u_axis] + (@as(f32, @floatFromInt(cu)) + 0.5) * grid.voxel;
            const ray_v = grid.min[v_axis] + (@as(f32, @floatFromInt(cv)) + 0.5) * grid.voxel;
            var node = heads[cv * nu + cu];
            while (node >= 0) : (node = next.items[@intCast(node)]) {
                const tri = node_tri.items[@intCast(node)];
                const a = verts[(tri * 3 + 0) * STRIDE ..][0..3];
                const b = verts[(tri * 3 + 1) * STRIDE ..][0..3];
                const c = verts[(tri * 3 + 2) * STRIDE ..][0..3];
                const t = rayTriangleAlongAxis(a.*, b.*, c.*, axis, u_axis, v_axis, ray_u, ray_v) orelse continue;
                if (n_cross < MAX_COLUMN_CROSSINGS) {
                    crossings[n_cross] = t;
                    n_cross += 1;
                }
            }
            if (n_cross < 2) continue;
            std.mem.sort(f32, crossings[0..n_cross], {}, std.sort.asc(f32));
            // Parity fill between crossing pairs; trailing unpaired = open-mesh noise.
            var pair: usize = 0;
            while (pair + 1 < n_cross) : (pair += 2) {
                const t0 = crossings[pair];
                const t1 = crossings[pair + 1];
                var along: usize = 0;
                while (along < n_along) : (along += 1) {
                    const w = grid.min[axis] + (@as(f32, @floatFromInt(along)) + 0.5) * grid.voxel;
                    if (w <= t0 or w >= t1) continue;
                    var g = [3]usize{ 0, 0, 0 };
                    g[axis] = along;
                    g[u_axis] = cu;
                    g[v_axis] = cv;
                    votes[grid.index(g[0], g[1], g[2])] +|= 1;
                }
            }
        }
    }
}

/// Intersection of the axis-aligned line (u,v fixed on the two cross axes)
/// with a triangle: 2D barycentric test in the projection, then the hit's
/// coordinate along the axis. Null = miss or degenerate (edge-on) triangle.
fn rayTriangleAlongAxis(a: [3]f32, b: [3]f32, c: [3]f32, axis: usize, u_axis: usize, v_axis: usize, ru: f32, rv: f32) ?f32 {
    const au = a[u_axis];
    const av = a[v_axis];
    const d1u = b[u_axis] - au;
    const d1v = b[v_axis] - av;
    const d2u = c[u_axis] - au;
    const d2v = c[v_axis] - av;
    const det = d1u * d2v - d2u * d1v;
    if (@abs(det) < 1e-12) return null;
    const pu = ru - au;
    const pv = rv - av;
    const s = (pu * d2v - d2u * pv) / det;
    const t = (d1u * pv - pu * d1v) / det;
    if (s < 0 or t < 0 or s + t > 1) return null;
    return a[axis] + s * (b[axis] - a[axis]) + t * (c[axis] - a[axis]);
}

// ── Triangle/box overlap (Akenine-Möller SAT) ───────────────────────────────
fn triBoxOverlap(box_center: [3]f32, half: f32, ta: [3]f32, tb: [3]f32, tc: [3]f32) bool {
    const v0 = sub(ta, box_center);
    const v1 = sub(tb, box_center);
    const v2 = sub(tc, box_center);
    const e0 = sub(v1, v0);
    const e1 = sub(v2, v1);
    const e2 = sub(v0, v2);

    // 1. AABB axes.
    var a: usize = 0;
    while (a < 3) : (a += 1) {
        const lo = @min(v0[a], @min(v1[a], v2[a]));
        const hi = @max(v0[a], @max(v1[a], v2[a]));
        if (lo > half or hi < -half) return false;
    }
    // 2. The 9 cross-product axes.
    const edges = [3][3]f32{ e0, e1, e2 };
    for (edges) |e| {
        var ax: usize = 0;
        while (ax < 3) : (ax += 1) {
            const axis = crossUnitAxis(ax, e);
            const p0 = dot(v0, axis);
            const p1 = dot(v1, axis);
            const p2 = dot(v2, axis);
            const r = half * (@abs(axis[0]) + @abs(axis[1]) + @abs(axis[2]));
            const lo = @min(p0, @min(p1, p2));
            const hi = @max(p0, @max(p1, p2));
            if (lo > r or hi < -r) return false;
        }
    }
    // 3. Triangle plane.
    const normal = cross(e0, e1);
    const d = -dot(normal, v0);
    const r = half * (@abs(normal[0]) + @abs(normal[1]) + @abs(normal[2]));
    return @abs(d) <= r;
}

fn sub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn dot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn cross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
/// Cross product of unit axis `ax` (0=x, 1=y, 2=z) with `e` — the SAT test axes.
fn crossUnitAxis(ax: usize, e: [3]f32) [3]f32 {
    return switch (ax) {
        0 => .{ 0, -e[2], e[1] },
        1 => .{ e[2], 0, -e[0] },
        else => .{ -e[1], e[0], 0 },
    };
}

// ── Weight-field smoothing ──────────────────────────────────────────────────
// One (or a few) Laplacian passes over the WELDED vertex graph: coincident
// corners across part seams share a welded node, so influence diffuses across
// exactly the seams the solve is meant to soften. 60/40 self/neighbour mix.
const SMOOTH_SELF_MIX: f32 = 0.6;
/// Accumulation table per welded node — enough for 4 influences × a few
/// distinct neighbouring parts; overflow drops the smallest contributor.
const SMOOTH_SLOTS = 12;

fn smoothWeights(allocator: std.mem.Allocator, verts: []f32, vert_count: usize, params: SolveParams) !void {
    // Weld by quantized position.
    const weld_of = try allocator.alloc(u32, vert_count);
    defer allocator.free(weld_of);
    var weld_map: std.AutoHashMapUnmanaged(u64, u32) = .empty;
    defer weld_map.deinit(allocator);
    var n_welded: u32 = 0;
    const inv_eps = 1.0 / @max(params.weld_epsilon, 1e-6);
    var vi: usize = 0;
    while (vi < vert_count) : (vi += 1) {
        const p = verts[vi * STRIDE ..][0..3];
        const qx: i64 = @intFromFloat(@round(p[0] * inv_eps));
        const qy: i64 = @intFromFloat(@round(p[1] * inv_eps));
        const qz: i64 = @intFromFloat(@round(p[2] * inv_eps));
        var h = std.hash.Wyhash.init(0);
        h.update(std.mem.asBytes(&qx));
        h.update(std.mem.asBytes(&qy));
        h.update(std.mem.asBytes(&qz));
        const key = h.final();
        const entry = try weld_map.getOrPut(allocator, key);
        if (!entry.found_existing) {
            entry.value_ptr.* = n_welded;
            n_welded += 1;
        }
        weld_of[vi] = entry.value_ptr.*;
    }

    // Welded adjacency from triangle edges (CSR after a counting pass).
    const tri_count = vert_count / 3;
    const deg = try allocator.alloc(u32, n_welded);
    defer allocator.free(deg);
    @memset(deg, 0);
    var ti: usize = 0;
    while (ti < tri_count) : (ti += 1) {
        var e: usize = 0;
        while (e < 3) : (e += 1) {
            const wa = weld_of[ti * 3 + e];
            const wb = weld_of[ti * 3 + (e + 1) % 3];
            if (wa == wb) continue;
            deg[wa] += 1;
            deg[wb] += 1;
        }
    }
    const offsets = try allocator.alloc(u32, n_welded + 1);
    defer allocator.free(offsets);
    offsets[0] = 0;
    var wi: usize = 0;
    while (wi < n_welded) : (wi += 1) offsets[wi + 1] = offsets[wi] + deg[wi];
    const adjacency = try allocator.alloc(u32, offsets[n_welded]);
    defer allocator.free(adjacency);
    const cursor = try allocator.alloc(u32, n_welded);
    defer allocator.free(cursor);
    @memcpy(cursor, offsets[0..n_welded]);
    ti = 0;
    while (ti < tri_count) : (ti += 1) {
        var e: usize = 0;
        while (e < 3) : (e += 1) {
            const wa = weld_of[ti * 3 + e];
            const wb = weld_of[ti * 3 + (e + 1) % 3];
            if (wa == wb) continue;
            adjacency[cursor[wa]] = wb;
            cursor[wa] += 1;
            adjacency[cursor[wb]] = wa;
            cursor[wb] += 1;
        }
    }

    // Sparse weights per welded node (last-writer wins across coincident
    // corners — they solved to near-identical weights by construction).
    const wj = try allocator.alloc([4]u16, n_welded);
    defer allocator.free(wj);
    const ww = try allocator.alloc([4]f32, n_welded);
    defer allocator.free(ww);
    const wj_next = try allocator.alloc([4]u16, n_welded);
    defer allocator.free(wj_next);
    const ww_next = try allocator.alloc([4]f32, n_welded);
    defer allocator.free(ww_next);
    vi = 0;
    while (vi < vert_count) : (vi += 1) {
        const row = verts[vi * STRIDE ..][0..STRIDE];
        const w = weld_of[vi];
        var s: usize = 0;
        while (s < 4) : (s += 1) {
            wj[w][s] = boneOfSlot(row, s);
            ww[w][s] = row[12 + s];
        }
    }

    var iter: u32 = 0;
    while (iter < params.smoothing_iterations) : (iter += 1) {
        wi = 0;
        while (wi < n_welded) : (wi += 1) {
            var acc_bone: [SMOOTH_SLOTS]u16 = undefined;
            var acc_w: [SMOOTH_SLOTS]f32 = @splat(0);
            var n_acc: usize = 0;
            accumulate(&acc_bone, &acc_w, &n_acc, wj[wi], ww[wi], SMOOTH_SELF_MIX);
            const nb_lo = offsets[wi];
            const nb_hi = offsets[wi + 1];
            const n_nb = nb_hi - nb_lo;
            if (n_nb > 0) {
                const share = (1.0 - SMOOTH_SELF_MIX) / @as(f32, @floatFromInt(n_nb));
                var nb = nb_lo;
                while (nb < nb_hi) : (nb += 1) {
                    const other = adjacency[nb];
                    accumulate(&acc_bone, &acc_w, &n_acc, wj[other], ww[other], share);
                }
            }
            // Re-top-4 + normalize into the next buffers.
            var top_bone = [4]u16{ 0, 0, 0, 0 };
            var top_w = [4]f32{ 0, 0, 0, 0 };
            var s: usize = 0;
            while (s < n_acc) : (s += 1) insertTop(&top_bone, &top_w, 4, acc_bone[s], acc_w[s]);
            var sum: f32 = 0;
            for (top_w) |w| sum += w;
            if (sum <= 0) {
                wj_next[wi] = wj[wi];
                ww_next[wi] = ww[wi];
                continue;
            }
            for (&top_w) |*w| w.* /= sum;
            wj_next[wi] = top_bone;
            ww_next[wi] = top_w;
        }
        @memcpy(wj, wj_next);
        @memcpy(ww, ww_next);
    }

    // Write back through the weld map.
    vi = 0;
    while (vi < vert_count) : (vi += 1) {
        const row = verts[vi * STRIDE ..][0..STRIDE];
        const w = weld_of[vi];
        var s: usize = 0;
        while (s < 4) : (s += 1) {
            row[8 + s] = @floatFromInt(wj[w][s]);
            row[12 + s] = ww[w][s];
        }
    }
}

fn boneOfSlot(row: []const f32, slot: usize) u16 {
    const i: i32 = @trunc(@max(0.0, row[8 + slot]));
    return @intCast(@min(i, 255));
}

fn accumulate(bones: *[SMOOTH_SLOTS]u16, weights: *[SMOOTH_SLOTS]f32, n: *usize, add_bones: [4]u16, add_weights: [4]f32, scale: f32) void {
    var s: usize = 0;
    outer: while (s < 4) : (s += 1) {
        const w = add_weights[s] * scale;
        if (w <= 0) continue;
        const bone = add_bones[s];
        var k: usize = 0;
        while (k < n.*) : (k += 1) {
            if (bones[k] == bone) {
                weights[k] += w;
                continue :outer;
            }
        }
        if (n.* < SMOOTH_SLOTS) {
            bones[n.*] = bone;
            weights[n.*] = w;
            n.* += 1;
        } else {
            // Table full: replace the smallest contributor if this one is bigger.
            var min_k: usize = 0;
            k = 1;
            while (k < SMOOTH_SLOTS) : (k += 1) {
                if (weights[k] < weights[min_k]) min_k = k;
            }
            if (w > weights[min_k]) {
                bones[min_k] = bone;
                weights[min_k] = w;
            }
        }
    }
}
