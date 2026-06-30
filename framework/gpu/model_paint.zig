//! Host-side per-face painting for the model viewer (the Studio mesh-editor path).
//!
//! WHY this exists: the Studio's paint pipeline maps congruent faces onto ONE shared
//! UV-atlas island (uvDedup.ts), so painting one panel repaints every identical panel,
//! and degenerate unwrap islands leave faces unpaintable. This module throws that whole
//! class of bug away. The model is the resident GPU mesh from mesh_import (non-indexed,
//! 3 verts/triangle — every face has its OWN vertices). We give each face its OWN texel
//! in a small host-owned paint atlas and map that face's three verts to it, so:
//!   • painting is per-face and independent — no congruent-face fusion, ever;
//!   • it rides the EXISTING scene3d diffuse-texture path — zero shader change;
//!   • picking is a real raycast against the visible triangle, so you paint exactly
//!     the face under the cursor (no projection mismatch).
//!
//! The viewer paints ONE model at a time, so the state here is a single active target
//! keyed by the mesh's intern-key hash. 3d.zig owns the camera + viewport + GPU upload
//! and drives this module; the math + paint buffer live here so they stay testable.

const std = @import("std");

const alloc = std.heap.c_allocator;

// ── Active paint target ─────────────────────────────────────────────────────────
var g_key_hash: u64 = 0; // intern-key hash of the mesh being painted
var g_positions: ?[]f32 = null; // facecount*9 floats: 3 verts (xyz) per face, model space
var g_facecount: u32 = 0;
var g_atlas_w: u32 = 0;
var g_atlas_h: u32 = 0;
// The atlas IS the source of truth — face f's colour lives at its texel (f%W, f/W), so
// a paint writes straight here (no separate per-face array, no full rebuild). The GPU
// re-uploads only the DIRTY ROW BAND since the last frame, so painting a 400k-tri model
// uploads one row, not the whole 1.6 MB texture every stroke.
var g_rgba: ?[]u8 = null; // atlas_w*atlas_h*4 — the diffuse texture, mutated in place
var g_dirty_lo: u32 = 0; // inclusive dirty-row range; lo > hi ⇒ nothing to upload
var g_dirty_hi: u32 = 0;
var g_has_dirty: bool = false;

/// Unpainted faces read as this neutral light grey, so a freshly-loaded model looks
/// the same as the plain shaded viewer until you paint it.
pub const DEFAULT_FACE: [4]u8 = .{ 200, 200, 205, 255 };

fn markRows(lo: u32, hi: u32) void {
    if (!g_has_dirty) {
        g_dirty_lo = lo;
        g_dirty_hi = hi;
        g_has_dirty = true;
    } else {
        if (lo < g_dirty_lo) g_dirty_lo = lo;
        if (hi > g_dirty_hi) g_dirty_hi = hi;
    }
}

/// The atlas rows changed since the last call (inclusive [lo,hi]), or null if none.
/// The GPU side uploads exactly this band and nothing else. Clears the pending range.
pub fn consumeDirtyRows() ?[2]u32 {
    if (!g_has_dirty) return null;
    const r = [2]u32{ g_dirty_lo, g_dirty_hi };
    g_has_dirty = false;
    return r;
}

pub fn hasTarget() bool {
    return g_positions != null;
}
pub fn isTarget(key_hash: u64) bool {
    return g_positions != null and key_hash == g_key_hash;
}
pub fn faceCount() u32 {
    return g_facecount;
}

// ── Atlas layout: face → texel ──────────────────────────────────────────────────
fn atlasDims(fc: u32) [2]u32 {
    if (fc == 0) return .{ 1, 1 };
    var w: u32 = @intFromFloat(@ceil(@sqrt(@as(f32, @floatFromInt(fc)))));
    if (w < 1) w = 1;
    const h = (fc + w - 1) / w;
    return .{ w, h };
}

/// Texel-center UV for a face in the atlas. All three of a face's verts get this same
/// UV, so the fragment samples exactly that one texel (constant UV ⇒ no neighbour
/// bleed even under linear filtering).
fn faceUv(face: u32) [2]f32 {
    const fx = face % g_atlas_w;
    const fy = face / g_atlas_w;
    return .{
        (@as(f32, @floatFromInt(fx)) + 0.5) / @as(f32, @floatFromInt(g_atlas_w)),
        (@as(f32, @floatFromInt(fy)) + 0.5) / @as(f32, @floatFromInt(g_atlas_h)),
    };
}

/// Adopt a freshly-parsed mesh as the paint target. REWRITES each vertex's uv (in the
/// caller's interleaved buffer, 8 f32/vert) to its face's atlas texel, captures CPU
/// positions for raycasting, and resets every face to the default grey. Call BEFORE
/// the verts are uploaded to the GPU so the per-face UVs ship with the mesh.
pub fn setTarget(key_hash: u64, verts: []f32, vert_count: u32) void {
    clear();
    if (vert_count < 3) return;
    const fc = vert_count / 3;
    const dims = atlasDims(fc);
    g_key_hash = key_hash;
    g_facecount = fc;
    g_atlas_w = dims[0];
    g_atlas_h = dims[1];

    // CPU positions for raycasting (9 floats/face).
    const pos = alloc.alloc(f32, @as(usize, fc) * 9) catch return;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const vi = f * 3 + k;
            pos[f * 9 + k * 3 + 0] = verts[vi * 8 + 0];
            pos[f * 9 + k * 3 + 1] = verts[vi * 8 + 1];
            pos[f * 9 + k * 3 + 2] = verts[vi * 8 + 2];
        }
    }
    g_positions = pos;

    // Atlas: every texel starts at the default grey (this also covers the tail texels
    // past facecount, which no face maps to).
    const need = @as(usize, dims[0]) * @as(usize, dims[1]) * 4;
    const rgba = alloc.alloc(u8, need) catch {
        clear();
        return;
    };
    var i: usize = 0;
    while (i < need) : (i += 4) {
        rgba[i + 0] = DEFAULT_FACE[0];
        rgba[i + 1] = DEFAULT_FACE[1];
        rgba[i + 2] = DEFAULT_FACE[2];
        rgba[i + 3] = DEFAULT_FACE[3];
    }
    g_rgba = rgba;

    // Overwrite the mesh's UVs with the per-face atlas mapping.
    var vi: u32 = 0;
    while (vi < vert_count) : (vi += 1) {
        const uv = faceUv(vi / 3);
        verts[vi * 8 + 6] = uv[0];
        verts[vi * 8 + 7] = uv[1];
    }
    g_has_dirty = false;
    markRows(0, dims[1] - 1); // the whole fresh atlas needs its first upload
}

pub fn clear() void {
    if (g_positions) |p| alloc.free(p);
    if (g_rgba) |r| alloc.free(r);
    g_positions = null;
    g_rgba = null;
    g_facecount = 0;
    g_atlas_w = 0;
    g_atlas_h = 0;
    g_key_hash = 0;
    g_has_dirty = false;
}

/// Paint one face — writes straight to its atlas texel and marks that row dirty. `face`
/// out of range is ignored (a raycast miss passes -1 up the stack, never here).
pub fn paintFace(face: u32, rgba: [4]u8) void {
    const buf = g_rgba orelse return;
    if (face >= g_facecount) return;
    const tx = face % g_atlas_w;
    const ty = face / g_atlas_w;
    const dst = (@as(usize, ty) * g_atlas_w + tx) * 4;
    buf[dst + 0] = rgba[0];
    buf[dst + 1] = rgba[1];
    buf[dst + 2] = rgba[2];
    buf[dst + 3] = rgba[3];
    markRows(ty, ty);
}

/// Bulk-set every face's colour from a per-face RGBA array (length ≥ facecount*4) —
/// how a quality change carries the source paint down onto the new (decimated) mesh.
pub fn applyColors(colors: []const u8) void {
    const buf = g_rgba orelse return;
    if (colors.len < @as(usize, g_facecount) * 4) return;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const tx = f % g_atlas_w;
        const ty = f / g_atlas_w;
        const dst = (@as(usize, ty) * g_atlas_w + tx) * 4;
        buf[dst + 0] = colors[f * 4 + 0];
        buf[dst + 1] = colors[f * 4 + 1];
        buf[dst + 2] = colors[f * 4 + 2];
        buf[dst + 3] = colors[f * 4 + 3];
    }
    if (g_atlas_h > 0) markRows(0, g_atlas_h - 1);
}

/// The current colour of one face's atlas texel, or null if no target / out of range.
/// Lets the selection layer SAVE a face's base colour before tinting it as "selected",
/// then restore it on deselect — selection rides this same atlas, no second texture.
pub fn faceColor(face: u32) ?[4]u8 {
    const buf = g_rgba orelse return null;
    if (face >= g_facecount) return null;
    const tx = face % g_atlas_w;
    const ty = face / g_atlas_w;
    const d = (@as(usize, ty) * g_atlas_w + tx) * 4;
    return .{ buf[d], buf[d + 1], buf[d + 2], buf[d + 3] };
}

/// The CPU triangle positions (facecount*9 f32: 3 verts xyz per face), or null. The
/// selection layer welds these into vertices/edges; the same array the raycast uses.
pub fn positions() ?[]const f32 {
    return g_positions;
}

/// Project a world point to viewport pixel (x,y), or null if behind the camera. The exact
/// inverse of cameraRay (same fov/aspect/basis), so a vertex projects to the pixel its
/// raycast would shoot back through — screen-nearest vertex/edge picking with zero drift.
pub fn project(cam: Camera, vp_w: f32, vp_h: f32, p: [3]f32) ?[2]f32 {
    if (vp_w <= 0 or vp_h <= 0) return null;
    const forward = norm(sub(cam.target, cam.eye));
    const right = norm(cross(forward, .{ 0, 1, 0 }));
    const up = cross(right, forward);
    const rel = sub(p, cam.eye);
    const z = dot(rel, forward);
    if (z <= 1e-4) return null; // behind the camera
    const aspect = vp_w / vp_h;
    const tan_h = @tan(cam.fov_deg * std.math.pi / 180.0 * 0.5);
    const ndc_x = (dot(rel, right) / z) / (tan_h * aspect);
    const ndc_y = (dot(rel, up) / z) / tan_h;
    return .{ (ndc_x * 0.5 + 0.5) * vp_w, (1.0 - ndc_y) * 0.5 * vp_h };
}

pub const Atlas = struct { rgba: []const u8, w: u32, h: u32 };

/// The live diffuse-texture bytes for the active target, or null if none. Always
/// current (paints mutate it in place); the GPU side uploads only consumeDirtyRows().
pub fn atlas() ?Atlas {
    const buf = g_rgba orelse return null;
    return .{ .rgba = buf, .w = g_atlas_w, .h = g_atlas_h };
}

// ── Raycast (Möller–Trumbore) ───────────────────────────────────────────────────
pub const Camera = struct { eye: [3]f32, target: [3]f32, fov_deg: f32 };

fn sub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn cross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn dot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn norm(a: [3]f32) [3]f32 {
    const l = @sqrt(dot(a, a));
    if (l < 1e-12) return .{ 0, 0, 0 };
    return .{ a[0] / l, a[1] / l, a[2] / l };
}

/// One triangle hit. Returns ray `t` (distance) on hit, else null. No backface cull —
/// paint works from either side.
fn rayTri(o: [3]f32, d: [3]f32, a: [3]f32, b: [3]f32, c: [3]f32) ?f32 {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (@abs(det) < 1e-9) return null;
    const inv = 1.0 / det;
    const tv = sub(o, a);
    const u = dot(tv, p) * inv;
    if (u < 0.0 or u > 1.0) return null;
    const q = cross(tv, e1);
    const v = dot(d, q) * inv;
    if (v < 0.0 or u + v > 1.0) return null;
    const t = dot(e2, q) * inv;
    return if (t > 1e-4) t else null;
}

/// The world-space ray (origin = eye, direction) through viewport pixel (mx,my), built to
/// match the scene3d perspective (vertical fov, +Y up). The one place pixel→ray lives, so
/// every raycast (face pick, focus point, future vertex/edge picks) shoots the SAME ray
/// the user sees.
pub const Ray = struct { o: [3]f32, d: [3]f32 };
pub fn cameraRay(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) Ray {
    const aspect = vp_w / vp_h;
    const tan_h = @tan(cam.fov_deg * std.math.pi / 180.0 * 0.5);
    const ndc_x = 2.0 * mx / vp_w - 1.0;
    const ndc_y = 1.0 - 2.0 * my / vp_h;
    const forward = norm(sub(cam.target, cam.eye));
    const right = norm(cross(forward, .{ 0, 1, 0 }));
    const up = cross(right, forward);
    const dir = norm(.{
        ndc_x * tan_h * aspect * right[0] + ndc_y * tan_h * up[0] + forward[0],
        ndc_x * tan_h * aspect * right[1] + ndc_y * tan_h * up[1] + forward[1],
        ndc_x * tan_h * aspect * right[2] + ndc_y * tan_h * up[2] + forward[2],
    });
    return .{ .o = cam.eye, .d = dir };
}

/// The face under viewport pixel (mx,my), or -1 on a miss. Returns the nearest hit.
pub fn pick(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    const pos = g_positions orelse return -1;
    if (vp_w <= 0 or vp_h <= 0) return -1;
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    const dir = ray.d;

    // Prefer the nearest FRONT-facing hit — the triangle you can actually see. The
    // render culls back-faces (cull_mode=.back), so without this the ray would happily
    // pick the invisible near side of a closed surface or a back-face on a fold, and
    // paint a face the user can't see (the "it paints the wrong place" scatter on a
    // real scanned mesh). A fallback to the nearest ANY hit means a model whose winding
    // disagrees with the render still paints something rather than nothing.
    var best_front_t: f32 = std.math.floatMax(f32);
    var best_front: i32 = -1;
    var best_any_t: f32 = std.math.floatMax(f32);
    var best_any: i32 = -1;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const c: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        if (rayTri(cam.eye, dir, a, b, c)) |t| {
            if (t < best_any_t) {
                best_any_t = t;
                best_any = @intCast(f);
            }
            // Geometric normal (same winding as the triangle). Front-facing toward the
            // camera ⇒ it opposes the ray direction.
            const n = cross(sub(b, a), sub(c, a));
            if (dot(n, dir) < 0.0 and t < best_front_t) {
                best_front_t = t;
                best_front = @intCast(f);
            }
        }
    }
    return if (best_front >= 0) best_front else best_any;
}

/// The world-space point where the camera ray through (mx,my) first meets the visible
/// (front-facing) surface, or null on a miss. This is what re-centres the orbit pivot on
/// the exact spot you click — put the focus on a far corner of a big model and edit it
/// without camera gymnastics (req_2148). Same front-then-any preference as `pick`.
pub fn pickPoint(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) ?[3]f32 {
    const pos = g_positions orelse return null;
    if (vp_w <= 0 or vp_h <= 0) return null;
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    var best_front_t: f32 = std.math.floatMax(f32);
    var best_any_t: f32 = std.math.floatMax(f32);
    var hit_front = false;
    var hit_any = false;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const c: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        if (rayTri(ray.o, ray.d, a, b, c)) |t| {
            if (t < best_any_t) {
                best_any_t = t;
                hit_any = true;
            }
            const n = cross(sub(b, a), sub(c, a));
            if (dot(n, ray.d) < 0.0 and t < best_front_t) {
                best_front_t = t;
                hit_front = true;
            }
        }
    }
    if (!hit_any) return null;
    const t = if (hit_front) best_front_t else best_any_t;
    return .{ ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t };
}

// ── Tests ───────────────────────────────────────────────────────────────────────
test "pick hits the face straddling the ray and paints it" {
    // One triangle in the z=0 plane, camera on +Z looking at origin down -Z.
    var verts = [_]f32{
        -1, -1, 0, 0, 0, 1, 0, 0,
        1,  -1, 0, 0, 0, 1, 0, 0,
        0,  1,  0, 0, 0, 1, 0, 0,
    };
    setTarget(123, &verts, 3);
    defer clear();
    try std.testing.expectEqual(@as(u32, 1), faceCount());
    // UVs were rewritten to the face's atlas texel (atlas is 1×1 → centre 0.5,0.5).
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), verts[6], 1e-6);

    const cam = Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    // Centre pixel → the triangle.
    try std.testing.expectEqual(@as(i32, 0), pick(cam, 800, 600, 400, 300));
    // A corner pixel misses (ray leaves the small triangle).
    try std.testing.expectEqual(@as(i32, -1), pick(cam, 800, 600, 0, 0));

    paintFace(0, .{ 10, 20, 30, 255 });
    const at = atlas().?;
    try std.testing.expectEqual(@as(u8, 10), at.rgba[0]);
    try std.testing.expectEqual(@as(u8, 30), at.rgba[2]);
}

test "pickPoint returns the world hit on the surface, null on a miss" {
    // Same single triangle in z=0, camera on +Z looking down -Z at the origin.
    var verts = [_]f32{
        -1, -1, 0, 0, 0, 1, 0, 0,
        1,  -1, 0, 0, 0, 1, 0, 0,
        0,  1,  0, 0, 0, 1, 0, 0,
    };
    setTarget(321, &verts, 3);
    defer clear();
    const cam = Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    // Centre pixel hits the triangle at the z=0 plane, on the ray, ≈ the origin.
    const hit = pickPoint(cam, 800, 600, 400, 300).?;
    try std.testing.expectApproxEqAbs(@as(f32, 0), hit[0], 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, 0), hit[1], 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, 0), hit[2], 1e-4);
    // A corner pixel misses → null (the cart keeps the current focus).
    try std.testing.expect(pickPoint(cam, 800, 600, 0, 0) == null);
}

test "atlas dims cover every face" {
    const d = atlasDims(4612);
    try std.testing.expect(d[0] * d[1] >= 4612);
    try std.testing.expect(d[0] >= 68 and d[0] <= 80);
}
