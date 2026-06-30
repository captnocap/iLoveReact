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
var g_colors: ?[]u8 = null; // facecount*4 rgba — the per-face paint
var g_rgba: ?[]u8 = null; // atlas_w*atlas_h*4 — the diffuse texture, rebuilt on dirty
var g_dirty: bool = true;

/// Unpainted faces read as this neutral light grey, so a freshly-loaded model looks
/// the same as the plain shaded viewer until you paint it.
pub const DEFAULT_FACE: [4]u8 = .{ 200, 200, 205, 255 };

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

    // Default paint = grey for every face.
    const cols = alloc.alloc(u8, @as(usize, fc) * 4) catch {
        clear();
        return;
    };
    var i: usize = 0;
    while (i < fc) : (i += 1) {
        cols[i * 4 + 0] = DEFAULT_FACE[0];
        cols[i * 4 + 1] = DEFAULT_FACE[1];
        cols[i * 4 + 2] = DEFAULT_FACE[2];
        cols[i * 4 + 3] = DEFAULT_FACE[3];
    }
    g_colors = cols;

    // Overwrite the mesh's UVs with the per-face atlas mapping.
    var vi: u32 = 0;
    while (vi < vert_count) : (vi += 1) {
        const uv = faceUv(vi / 3);
        verts[vi * 8 + 6] = uv[0];
        verts[vi * 8 + 7] = uv[1];
    }
    g_dirty = true;
}

pub fn clear() void {
    if (g_positions) |p| alloc.free(p);
    if (g_colors) |c| alloc.free(c);
    if (g_rgba) |r| alloc.free(r);
    g_positions = null;
    g_colors = null;
    g_rgba = null;
    g_facecount = 0;
    g_atlas_w = 0;
    g_atlas_h = 0;
    g_key_hash = 0;
    g_dirty = true;
}

/// Paint one face. `face` out of range is ignored (a raycast miss passes -1 up the
/// stack and never reaches here).
pub fn paintFace(face: u32, rgba: [4]u8) void {
    const cols = g_colors orelse return;
    if (face >= g_facecount) return;
    cols[face * 4 + 0] = rgba[0];
    cols[face * 4 + 1] = rgba[1];
    cols[face * 4 + 2] = rgba[2];
    cols[face * 4 + 3] = rgba[3];
    g_dirty = true;
}

pub const Atlas = struct { rgba: []const u8, w: u32, h: u32 };

/// The diffuse-texture bytes for the active target (rebuilt only when paint changed),
/// or null if there is no target. 3d.zig feeds this to getOrCreateTexBindGroup.
pub fn atlas() ?Atlas {
    const cols = g_colors orelse return null;
    if (g_dirty or g_rgba == null) {
        const need = @as(usize, g_atlas_w) * @as(usize, g_atlas_h) * 4;
        if (g_rgba == null or g_rgba.?.len != need) {
            if (g_rgba) |r| alloc.free(r);
            g_rgba = alloc.alloc(u8, need) catch return null;
        }
        const rgba = g_rgba.?;
        // Default-fill (covers the atlas tail past facecount), then stamp each face.
        var i: usize = 0;
        while (i < g_atlas_w * g_atlas_h) : (i += 1) {
            rgba[i * 4 + 0] = DEFAULT_FACE[0];
            rgba[i * 4 + 1] = DEFAULT_FACE[1];
            rgba[i * 4 + 2] = DEFAULT_FACE[2];
            rgba[i * 4 + 3] = DEFAULT_FACE[3];
        }
        var f: u32 = 0;
        while (f < g_facecount) : (f += 1) {
            const tx = f % g_atlas_w;
            const ty = f / g_atlas_w;
            const dst = (@as(usize, ty) * g_atlas_w + tx) * 4;
            rgba[dst + 0] = cols[f * 4 + 0];
            rgba[dst + 1] = cols[f * 4 + 1];
            rgba[dst + 2] = cols[f * 4 + 2];
            rgba[dst + 3] = cols[f * 4 + 3];
        }
        g_dirty = false;
    }
    return .{ .rgba = g_rgba.?, .w = g_atlas_w, .h = g_atlas_h };
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

/// The face under viewport pixel (mx,my), or -1 on a miss. Builds the camera ray to
/// match the scene3d perspective (vertical fov, +Y up) and returns the nearest hit.
pub fn pick(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    const pos = g_positions orelse return -1;
    if (vp_w <= 0 or vp_h <= 0) return -1;
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

    var best_t: f32 = std.math.floatMax(f32);
    var best: i32 = -1;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const c: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        if (rayTri(cam.eye, dir, a, b, c)) |t| {
            if (t < best_t) {
                best_t = t;
                best = @intCast(f);
            }
        }
    }
    return best;
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

test "atlas dims cover every face" {
    const d = atlasDims(4612);
    try std.testing.expect(d[0] * d[1] >= 4612);
    try std.testing.expect(d[0] >= 68 and d[0] <= 80);
}
