//! Hard geometric facts about the resident mesh. Two counts, both countable and
//! neither arguable (req_3749):
//!
//!   • intersecting — triangles that PASS THROUGH another triangle. Not "close to",
//!     not "sharing an edge", not RESTING AGAINST: each must have corners strictly on
//!     both sides of the other's plane and the crossing must have real length. A join
//!     at a direction change — a T-junction vertex mid-edge of a neighbour, a wall
//!     rising off the line of another face's edge — is contact, never a penetration
//!     (req_3808).
//!   • unreachable  — triangles no ray escapes from. Geometry sealed inside other
//!     geometry, which no camera reaches from any angle and no UV island can earn.
//!
//! These are REPORTED, never enforced. A threshold invites laundering — slide two
//! solids a micron apart and an overlap rule passes while the model is unchanged.
//! Neither number moves that way: separating two solids by 0.0000003 m does not let a
//! ray out of a buried face. The only way either count falls is to actually fix the
//! mesh. So this module counts, prints, and gets out of the way.
//!
//! Deliberately NOT graded. "Questionable" needs context that is not statically
//! available; "this triangle is inside your model" does not.
//!
//! Vertex layout is the resident edit buffer's: 8 floats per vertex, 3 vertices per
//! face, position in the first 3 — face f corner c axis a is verts[f*24 + c*8 + a].

const std = @import("std");

pub const Facts = struct {
    /// False when the mesh exceeded the budget and nothing was measured. Callers MUST
    /// report "not measured" rather than printing a zero they did not earn.
    computed: bool = false,
    /// Triangles penetrating at least one other triangle.
    intersecting: u32 = 0,
    /// Triangles from which no sampled direction escapes the mesh.
    unreachable_faces: u32 = 0,
    /// Directions sampled per face, so a reader can judge the reachability pass.
    directions: u32 = 0,
};

/// Optional per-face output. A count alone cannot be acted on — "34 unreachable"
/// says nothing about WHERE (req_3883) — so the same pass that counts can also
/// record which triangles it counted, and the editor selects exactly those.
/// Each slice must be `face_count` long or it is ignored; both are set to false
/// for every face first, so a skipped (over-budget) audit leaves no stale marks.
pub const Marks = struct {
    intersecting: ?[]bool = null,
    unreachable_faces: ?[]bool = null,
};

pub const Budget = struct {
    /// Above this the pass is skipped. Both passes ride the flat BVH below (n·log n)
    /// and run on the bounded face-table worker, never the frame path — the old 6_000
    /// cap guarded the pre-BVH quadratic scans and left every dense import reading
    /// "not measured" (req_4557: a 9.4k-tri quad remesh tripped it). The cap now only
    /// exists so a pathological import cannot pin the worker for minutes.
    max_faces: u32 = 200_000,
    /// Sphere sample count. 42 resolves oblique escape gaps that 6 axis directions
    /// miss, while staying cheap enough to run per edit.
    directions: u32 = 42,
};

const Vec3 = [3]f32;

fn sub(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn cross(a: Vec3, b: Vec3) Vec3 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn dot(a: Vec3, b: Vec3) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

fn corner(verts: []const f32, face: u32, c: u32) Vec3 {
    const base = @as(usize, face) * 24 + @as(usize, c) * 8;
    return .{ verts[base], verts[base + 1], verts[base + 2] };
}

const Box = struct { lo: Vec3, hi: Vec3 };

fn faceBox(verts: []const f32, face: u32) Box {
    var lo = corner(verts, face, 0);
    var hi = lo;
    for (1..3) |c| {
        const p = corner(verts, face, @intCast(c));
        for (0..3) |axis| {
            lo[axis] = @min(lo[axis], p[axis]);
            hi[axis] = @max(hi[axis], p[axis]);
        }
    }
    return .{ .lo = lo, .hi = hi };
}

fn boxesOverlap(a: Box, b: Box) bool {
    return !(a.lo[0] > b.hi[0] or a.hi[0] < b.lo[0] or
        a.lo[1] > b.hi[1] or a.hi[1] < b.lo[1] or
        a.lo[2] > b.hi[2] or a.hi[2] < b.lo[2]);
}

// ── Spatial index ─────────────────────────────────────────────────────────────
// Flat median-split BVH over the face boxes. Both facts consult it: penetration
// asks "which boxes overlap mine", reachability asks "does this ray meet any
// triangle". Median split on the widest centroid axis keeps the tree balanced,
// so the traversal stack below is bounded by tree depth (~log2(n/leaf)).

const leaf_faces: u32 = 8;

const BvhNode = struct {
    box: Box,
    /// Leaf when `count > 0`: faces are `order[start .. start + count]`.
    start: u32 = 0,
    count: u32 = 0,
    left: u32 = 0,
    right: u32 = 0,
};

const Bvh = struct {
    nodes: []BvhNode,
    order: []u32,

    fn deinit(self: *Bvh, allocator: std.mem.Allocator) void {
        allocator.free(self.nodes);
        allocator.free(self.order);
    }
};

fn centroidAxis(box: Box, axis: usize) f32 {
    return (box.lo[axis] + box.hi[axis]) * 0.5;
}

const CentroidLess = struct {
    boxes: []const Box,
    axis: usize,
    fn lessThan(self: @This(), a: u32, b: u32) bool {
        return centroidAxis(self.boxes[a], self.axis) < centroidAxis(self.boxes[b], self.axis);
    }
};

fn buildRange(nodes: []BvhNode, next: *u32, boxes: []const Box, order: []u32, start: u32, count: u32) u32 {
    const index = next.*;
    next.* += 1;
    var box = boxes[order[start]];
    for (order[start + 1 .. start + count]) |face| {
        const b = boxes[face];
        for (0..3) |axis| {
            box.lo[axis] = @min(box.lo[axis], b.lo[axis]);
            box.hi[axis] = @max(box.hi[axis], b.hi[axis]);
        }
    }
    if (count <= leaf_faces) {
        nodes[index] = .{ .box = box, .start = start, .count = count };
        return index;
    }
    var axis: usize = 0;
    var widest: f32 = -1;
    for (0..3) |candidate| {
        const width = box.hi[candidate] - box.lo[candidate];
        if (width > widest) {
            widest = width;
            axis = candidate;
        }
    }
    std.mem.sortUnstable(u32, order[start .. start + count], CentroidLess{ .boxes = boxes, .axis = axis }, CentroidLess.lessThan);
    const half = count / 2;
    const left = buildRange(nodes, next, boxes, order, start, half);
    const right = buildRange(nodes, next, boxes, order, start + half, count - half);
    nodes[index] = .{ .box = box, .left = left, .right = right };
    return index;
}

/// Null only on allocation failure; the caller reports "not measured" as for any
/// other unfulfilled audit. `boxes` must be non-empty.
fn buildBvh(allocator: std.mem.Allocator, boxes: []const Box) ?Bvh {
    const n: u32 = @intCast(boxes.len);
    const order = allocator.alloc(u32, n) catch return null;
    for (order, 0..) |*slot, i| slot.* = @intCast(i);
    // A binary tree over n faces with any leaf size has at most 2n-1 nodes.
    const nodes = allocator.alloc(BvhNode, @as(usize, n) * 2) catch {
        allocator.free(order);
        return null;
    };
    var next: u32 = 0;
    _ = buildRange(nodes, &next, boxes, order, 0, n);
    return .{ .nodes = nodes, .order = order };
}

// Balanced median split bounds depth at ~log2(n); 64 entries covers any u32 count.
const traversal_depth = 64;

/// Flag every face that face `x` penetrates (and `x` itself). Considers only
/// faces `y > x`, so every unordered pair is tested exactly once across the
/// caller's loop over all x.
fn markPenetrationsFor(bvh: *const Bvh, boxes: []const Box, verts: []const f32, x: u32, hit_flags: []bool) void {
    const target = boxes[x];
    var stack: [traversal_depth]u32 = undefined;
    var sp: usize = 1;
    stack[0] = 0;
    while (sp > 0) {
        sp -= 1;
        const node = bvh.nodes[stack[sp]];
        if (!boxesOverlap(target, node.box)) continue;
        if (node.count > 0) {
            for (bvh.order[node.start .. node.start + node.count]) |y| {
                if (y <= x) continue;
                if (hit_flags[x] and hit_flags[y]) continue;
                if (!boxesOverlap(target, boxes[y])) continue;
                if (!penetrates(verts, x, y)) continue;
                hit_flags[x] = true;
                hit_flags[y] = true;
            }
            continue;
        }
        stack[sp] = node.left;
        stack[sp + 1] = node.right;
        sp += 2;
    }
}

/// Any-hit query for the reachability pass: does the ray meet any non-glass
/// triangle other than the origin face?
fn rayBlockedByMesh(bvh: *const Bvh, boxes: []const Box, verts: []const f32, glass: ?[]const bool, self_index: u32, origin: Vec3, dir: Vec3, inv: Vec3, far: f32) bool {
    var stack: [traversal_depth]u32 = undefined;
    var sp: usize = 1;
    stack[0] = 0;
    while (sp > 0) {
        sp -= 1;
        const node = bvh.nodes[stack[sp]];
        if (!rayHitsBox(origin, inv, node.box, far)) continue;
        if (node.count > 0) {
            for (bvh.order[node.start .. node.start + node.count]) |other| {
                if (other == self_index) continue;
                if (glass) |rows| {
                    if (rows[other]) continue; // rays pass through glass
                }
                if (!rayHitsBox(origin, inv, boxes[other], far)) continue;
                const oa = corner(verts, other, 0);
                const ob = corner(verts, other, 1);
                const oc = corner(verts, other, 2);
                if (rayTriangle(origin, dir, oa, ob, oc, 1e-5, far) != null) return true;
            }
            continue;
        }
        stack[sp] = node.left;
        stack[sp + 1] = node.right;
        sp += 2;
    }
    return false;
}

/// Slab test: can a ray from `origin` along `dir` reach `box` at all? Cheap enough to
/// run against every face before paying for the triangle test. `inv` carries
/// precomputed reciprocals; infinities are the intended behaviour for axis-parallel
/// rays and compare correctly through the min/max below.
fn rayHitsBox(origin: Vec3, inv: Vec3, box: Box, far: f32) bool {
    var t0: f32 = 0;
    var t1: f32 = far;
    for (0..3) |axis| {
        const a = (box.lo[axis] - origin[axis]) * inv[axis];
        const b = (box.hi[axis] - origin[axis]) * inv[axis];
        t0 = @max(t0, @min(a, b));
        t1 = @min(t1, @max(a, b));
    }
    return t0 <= t1;
}

/// Möller–Trumbore. Returns the ray parameter of the hit, or null. `min_t` rejects the
/// origin's own surface; `max_t` bounds a segment (use `far` for a ray).
fn rayTriangle(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3, min_t: f32, max_t: f32) ?f32 {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const pv = cross(dir, e2);
    const det = dot(e1, pv);
    if (@abs(det) < 1e-12) return null; // parallel: coplanar contact is not penetration
    const inv = 1.0 / det;
    const tv = sub(origin, a);
    const u = dot(tv, pv) * inv;
    if (u < 0 or u > 1) return null;
    const qv = cross(tv, e1);
    const v = dot(dir, qv) * inv;
    if (v < 0 or u + v > 1) return null;
    const t = dot(e2, qv) * inv;
    if (t < min_t or t > max_t) return null;
    return t;
}

/// Touch deadband, in metres. A vertex within this distance of the other triangle's
/// plane is ON that plane — resting against it, not through it. Sized well above f32
/// coordinate noise and weld-seam mismatch (~1e-5 on metre-scale models) and well
/// below any penetration a modeller would call real.
const touch_eps: f32 = 1e-4;

/// Where a triangle's corners sit relative to a plane: signed distances plus whether
/// any corner is strictly in front of / behind the touch deadband.
const PlaneSide = struct {
    d: [3]f32,
    front: bool,
    behind: bool,
};

fn planeSide(n: Vec3, origin: Vec3, a: Vec3, b: Vec3, c: Vec3) PlaneSide {
    var side = PlaneSide{ .d = undefined, .front = false, .behind = false };
    for ([_]Vec3{ a, b, c }, 0..) |p, i| {
        const d = dot(n, sub(p, origin));
        side.d[i] = d;
        if (d > touch_eps) side.front = true;
        if (d < -touch_eps) side.behind = true;
    }
    return side;
}

/// Interval of a triangle's crossing along the two planes' intersection line: project
/// every deadband-zero corner and every strict front/behind edge crossing onto the
/// line direction. Returns null when the triangle only touches the line at nothing.
fn crossingInterval(line_dir: Vec3, corners: [3]Vec3, side: PlaneSide) ?[2]f32 {
    var lo: f32 = std.math.floatMax(f32);
    var hi: f32 = -std.math.floatMax(f32);
    var any = false;
    for (0..3) |i| {
        const di = side.d[i];
        if (@abs(di) <= touch_eps) {
            const t = dot(line_dir, corners[i]);
            lo = @min(lo, t);
            hi = @max(hi, t);
            any = true;
            continue;
        }
        const j = (i + 1) % 3;
        const dj = side.d[j];
        if ((di > touch_eps and dj < -touch_eps) or (di < -touch_eps and dj > touch_eps)) {
            const f = di / (di - dj);
            const p = Vec3{
                corners[i][0] + (corners[j][0] - corners[i][0]) * f,
                corners[i][1] + (corners[j][1] - corners[i][1]) * f,
                corners[i][2] + (corners[j][2] - corners[i][2]) * f,
            };
            const t = dot(line_dir, p);
            lo = @min(lo, t);
            hi = @max(hi, t);
            any = true;
        }
    }
    if (!any) return null;
    return .{ lo, hi };
}

/// True when two triangles genuinely pass through each other: EACH strictly straddles
/// the other's plane (corners beyond the touch deadband on both sides), and their
/// crossing intervals along the planes' intersection line overlap with real length.
///
/// Everything that merely TOUCHES fails the straddle test and never counts: shared
/// edges, a T-junction vertex resting mid-edge of a neighbouring face, a wall rising
/// off the line of another face's edge — a join at a direction change is a join, not
/// a penetration (req_3808: the audit read a sedan's wheel-well seams as 16
/// "intersecting" triangles; every contact point sat exactly on a triangle boundary).
fn penetrates(verts: []const f32, x: u32, y: u32) bool {
    const xa = corner(verts, x, 0);
    const xb = corner(verts, x, 1);
    const xc = corner(verts, x, 2);
    const ya = corner(verts, y, 0);
    const yb = corner(verts, y, 1);
    const yc = corner(verts, y, 2);

    var nx = cross(sub(xb, xa), sub(xc, xa));
    var ny = cross(sub(yb, ya), sub(yc, ya));
    const nx_len = @sqrt(dot(nx, nx));
    const ny_len = @sqrt(dot(ny, ny));
    if (nx_len < 1e-12 or ny_len < 1e-12) return false; // degenerate sliver
    nx = .{ nx[0] / nx_len, nx[1] / nx_len, nx[2] / nx_len };
    ny = .{ ny[0] / ny_len, ny[1] / ny_len, ny[2] / ny_len };

    // Each triangle must have corners strictly on BOTH sides of the other's plane.
    // Touching the plane (within the deadband) is contact, never a crossing.
    const y_side = planeSide(nx, xa, ya, yb, yc);
    if (!(y_side.front and y_side.behind)) return false;
    const x_side = planeSide(ny, ya, xa, xb, xc);
    if (!(x_side.front and x_side.behind)) return false;

    // Both planes are crossed; near-parallel planes cannot both be straddled beyond
    // the deadband unless the line is well defined, but guard the degenerate case.
    const line = cross(nx, ny);
    if (@sqrt(dot(line, line)) < 1e-6) return false;

    const ix = crossingInterval(line, .{ xa, xb, xc }, x_side) orelse return false;
    const iy = crossingInterval(line, .{ ya, yb, yc }, y_side) orelse return false;
    const overlap = @min(ix[1], iy[1]) - @max(ix[0], iy[0]);
    return overlap > touch_eps;
}

/// Fibonacci sphere — an even spread with no axis bias, so a face that only escapes
/// through an oblique gap is still found reachable.
fn sampleDirection(index: u32, count: u32) Vec3 {
    const golden_angle: f32 = std.math.pi * (3.0 - @sqrt(5.0));
    const fi: f32 = @floatFromInt(index);
    const fc: f32 = @floatFromInt(count);
    const y = 1.0 - 2.0 * (fi + 0.5) / fc;
    const r = @sqrt(@max(0.0, 1.0 - y * y));
    const theta = golden_angle * fi;
    return .{ @cos(theta) * r, y, @sin(theta) * r };
}

/// Count the two facts. Returns `computed = false` with zero counts when the mesh is
/// over budget — the caller must not present that as "nothing wrong".
///
/// `transparent` (optional, one bool per face): glass faces. A camera SEES THROUGH
/// glass, so a transparent face never blocks another face's reachability ray —
/// without this every glazed cabin reported its whole interior unreachable
/// (req_3763 P3-1: 184 of 187 "unreachable" triangles were visible through the
/// windows). Transparent faces are still audited as candidates themselves, and
/// intersection counting ignores the flag entirely — glass through a fender is
/// still a penetration.
///
/// `marks` (optional): per-face output for the two facts — see Marks. Counting and
/// marking are the SAME pass, so a marked audit can never disagree with the count
/// the panel is showing.
pub fn audit(allocator: std.mem.Allocator, verts: []const f32, face_count: u32, budget: Budget, transparent: ?[]const bool, marks: Marks) Facts {
    // Clear before any early return: an over-budget or malformed audit must leave the
    // caller's buffers empty rather than whatever a previous mesh left in them.
    const mark_intersecting: ?[]bool = if (marks.intersecting) |rows|
        (if (rows.len == face_count) blk: {
            @memset(rows, false);
            break :blk rows;
        } else null)
    else
        null;
    const mark_unreachable: ?[]bool = if (marks.unreachable_faces) |rows|
        (if (rows.len == face_count) blk: {
            @memset(rows, false);
            break :blk rows;
        } else null)
    else
        null;
    if (face_count == 0) return .{ .computed = true, .directions = budget.directions };
    if (budget.directions == 0 or face_count > budget.max_faces) return .{};
    if (verts.len < @as(usize, face_count) * 24) return .{};
    const glass: ?[]const bool = if (transparent) |rows|
        (if (rows.len == face_count) rows else null)
    else
        null;

    const boxes = allocator.alloc(Box, face_count) catch return .{};
    defer allocator.free(boxes);
    const hit_flags = allocator.alloc(bool, face_count) catch return .{};
    defer allocator.free(hit_flags);
    @memset(hit_flags, false);

    var lo = Vec3{ std.math.floatMax(f32), std.math.floatMax(f32), std.math.floatMax(f32) };
    var hi = Vec3{ -std.math.floatMax(f32), -std.math.floatMax(f32), -std.math.floatMax(f32) };
    for (0..face_count) |face| {
        const box = faceBox(verts, @intCast(face));
        boxes[face] = box;
        for (0..3) |axis| {
            lo[axis] = @min(lo[axis], box.lo[axis]);
            hi[axis] = @max(hi[axis], box.hi[axis]);
        }
    }

    var bvh = buildBvh(allocator, boxes) orelse return .{};
    defer bvh.deinit(allocator);

    // ── Fact 1: penetration ────────────────────────────────────────────────────
    // Every pair is considered exactly once (the query only visits y > x); the BVH
    // settles almost all of them at node level before the segment tests. Both faces
    // of a penetrating pair are flagged, so the count is "triangles involved in a
    // penetration", not "pairs".
    for (0..face_count) |x| {
        markPenetrationsFor(&bvh, boxes, verts, @intCast(x), hit_flags);
    }
    var intersecting: u32 = 0;
    for (hit_flags) |flag| {
        if (flag) intersecting += 1;
    }
    if (mark_intersecting) |rows| @memcpy(rows, hit_flags);

    // ── Fact 2: reachability ───────────────────────────────────────────────────
    // A face is reachable when some sampled direction off its front side leaves the
    // mesh without meeting another triangle. Proving a blocked direction exits on the
    // first hit; proving an escape costs a full sweep, but the direction loop stops at
    // the first escape, so most faces pay for one sweep at most.
    const diag = @sqrt(dot(sub(hi, lo), sub(hi, lo)));
    const far = @max(diag * 2.0, 1.0);
    var unreachable_count: u32 = 0;

    for (0..face_count) |face| {
        const self_index: u32 = @intCast(face);
        const a = corner(verts, self_index, 0);
        const b = corner(verts, self_index, 1);
        const c = corner(verts, self_index, 2);
        var normal = cross(sub(b, a), sub(c, a));
        const nlen = @sqrt(dot(normal, normal));
        if (nlen < 1e-12) continue; // degenerate sliver: no surface to reach
        normal = .{ normal[0] / nlen, normal[1] / nlen, normal[2] / nlen };
        const origin = Vec3{
            (a[0] + b[0] + c[0]) / 3.0 + normal[0] * 1e-4,
            (a[1] + b[1] + c[1]) / 3.0 + normal[1] * 1e-4,
            (a[2] + b[2] + c[2]) / 3.0 + normal[2] * 1e-4,
        };

        var escaped = false;
        var d: u32 = 0;
        while (d < budget.directions and !escaped) : (d += 1) {
            const dir = sampleDirection(d, budget.directions);
            if (dot(normal, dir) <= 1e-6) continue; // behind the face: not its side
            const inv = Vec3{ 1.0 / dir[0], 1.0 / dir[1], 1.0 / dir[2] };
            if (!rayBlockedByMesh(&bvh, boxes, verts, glass, self_index, origin, dir, inv, far)) escaped = true;
        }
        if (!escaped) {
            unreachable_count += 1;
            if (mark_unreachable) |rows| rows[self_index] = true;
        }
    }

    return .{
        .computed = true,
        .intersecting = intersecting,
        .unreachable_faces = unreachable_count,
        .directions = budget.directions,
    };
}
