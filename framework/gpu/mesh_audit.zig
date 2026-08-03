//! Hard geometric facts about the resident mesh. Two counts, both countable and
//! neither arguable (req_3749):
//!
//!   • intersecting — triangles that PASS THROUGH another triangle. Not "close to",
//!     not "sharing an edge": an edge of one crosses the interior of the other.
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

pub const Budget = struct {
    /// Above this the pass is skipped. Both passes are quadratic in the worst case and
    /// this runs once per topology generation on the interactive path, so the cap is
    /// set for authored models (the mopeds are ~2k) rather than dense imports.
    max_faces: u32 = 6_000,
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

/// Do two faces share a vertex position? Adjacent triangles meet along an edge by
/// construction — correct topology, not penetration, and it must never count.
fn sharesVertex(verts: []const f32, x: u32, y: u32) bool {
    const eps: f32 = 1e-6;
    for (0..3) |i| {
        const p = corner(verts, x, @intCast(i));
        for (0..3) |j| {
            const q = corner(verts, y, @intCast(j));
            if (@abs(p[0] - q[0]) <= eps and @abs(p[1] - q[1]) <= eps and @abs(p[2] - q[2]) <= eps) return true;
        }
    }
    return false;
}

/// True when an edge of one triangle crosses the interior of the other. Segment ends
/// are excluded by the parameter window, so triangles that merely meet at a shared
/// boundary do not register.
fn penetrates(verts: []const f32, x: u32, y: u32) bool {
    const eps: f32 = 1e-6;
    for ([_][2]u32{ .{ x, y }, .{ y, x } }) |ordered| {
        const ta = corner(verts, ordered[1], 0);
        const tb = corner(verts, ordered[1], 1);
        const tc = corner(verts, ordered[1], 2);
        for (0..3) |i| {
            const p0 = corner(verts, ordered[0], @intCast(i));
            const p1 = corner(verts, ordered[0], @intCast((i + 1) % 3));
            const seg = sub(p1, p0);
            const len = @sqrt(dot(seg, seg));
            if (len < eps) continue;
            const dir = Vec3{ seg[0] / len, seg[1] / len, seg[2] / len };
            if (rayTriangle(p0, dir, ta, tb, tc, eps, len - eps) != null) return true;
        }
    }
    return false;
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
pub fn audit(allocator: std.mem.Allocator, verts: []const f32, face_count: u32, budget: Budget) Facts {
    if (face_count == 0) return .{ .computed = true, .directions = budget.directions };
    if (budget.directions == 0 or face_count > budget.max_faces) return .{};
    if (verts.len < @as(usize, face_count) * 24) return .{};

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

    // ── Fact 1: penetration ────────────────────────────────────────────────────
    // Every pair is considered, but an AABB reject settles almost all of them before
    // the segment tests. Both faces of a penetrating pair are flagged, so the count is
    // "triangles involved in a penetration", not "pairs".
    for (0..face_count) |x| {
        const xi: u32 = @intCast(x);
        for (x + 1..face_count) |y| {
            const yi: u32 = @intCast(y);
            if (hit_flags[xi] and hit_flags[yi]) continue;
            if (!boxesOverlap(boxes[xi], boxes[yi])) continue;
            if (sharesVertex(verts, xi, yi)) continue;
            if (!penetrates(verts, xi, yi)) continue;
            hit_flags[xi] = true;
            hit_flags[yi] = true;
        }
    }
    var intersecting: u32 = 0;
    for (hit_flags) |flag| {
        if (flag) intersecting += 1;
    }

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
            var blocked = false;
            for (0..face_count) |other| {
                const oi: u32 = @intCast(other);
                if (oi == self_index) continue;
                if (!rayHitsBox(origin, inv, boxes[oi], far)) continue;
                const oa = corner(verts, oi, 0);
                const ob = corner(verts, oi, 1);
                const oc = corner(verts, oi, 2);
                if (rayTriangle(origin, dir, oa, ob, oc, 1e-5, far) != null) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) escaped = true;
        }
        if (!escaped) unreachable_count += 1;
    }

    return .{
        .computed = true,
        .intersecting = intersecting,
        .unreachable_faces = unreachable_count,
        .directions = budget.directions,
    };
}
