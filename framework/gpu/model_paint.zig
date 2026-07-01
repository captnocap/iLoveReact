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
// Free-form detail: texels per face EDGE. 1 = the classic one-texel-per-face atlas
// (flat per-face fill, byte-identical to the original — the safe default). >1 gives
// each face its own PATCH (g_patch × g_patch texels) so a brush can lay sub-face
// strokes clipped to the face's triangle — no neighbour bleed, because each face
// owns its texels. Set live via setDetail(); fill + selection work at any size.
var g_patch: u32 = 1;
var g_patches_w: u32 = 0; // patches per atlas row (atlas_w == patches_w * g_patch)
// Gutter inset (texels) so a face's triangle sits off its patch edge — keeps linear
// filtering from sampling across the patch boundary. Zero at patch==1 (nothing to inset).
const PATCH_GUTTER: f32 = 0.5;
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

// ── Atlas layout: face → patch ──────────────────────────────────────────────────
// The atlas is a grid of per-face patches. patchGrid gives the patch count per axis;
// the texel dims are that times g_patch. At g_patch==1 a "patch" is one texel and this
// is exactly the original √facecount layout.
fn patchGrid(fc: u32) [2]u32 {
    if (fc == 0) return .{ 1, 1 };
    var pw: u32 = @intFromFloat(@ceil(@sqrt(@as(f32, @floatFromInt(fc)))));
    if (pw < 1) pw = 1;
    const ph = (fc + pw - 1) / pw;
    return .{ pw, ph };
}

/// Top-left texel of a face's patch in the atlas.
fn patchOrigin(face: u32) [2]u32 {
    return .{ (face % g_patches_w) * g_patch, (face / g_patches_w) * g_patch };
}

/// The usable span (texels) inside a patch — the triangle lives in [GUTTER, span+GUTTER].
fn patchSpan() f32 {
    const p: f32 = @floatFromInt(g_patch);
    return if (g_patch > 1) p - 2.0 * PATCH_GUTTER else 0.0;
}

/// Barycentric (bu along v0→v1, bv along v0→v2) → patch-local texel (x,y). At g_patch==1
/// every point collapses to the patch centre (0.5,0.5) — the classic constant-UV texel.
fn baryToPatchTexel(bu: f32, bv: f32) [2]f32 {
    if (g_patch <= 1) return .{ 0.5, 0.5 };
    const span = patchSpan();
    return .{ PATCH_GUTTER + bu * span, PATCH_GUTTER + bv * span };
}

/// UV for vertex k (0,1,2) of a face — its patch-triangle corner. k maps to barycentric
/// (0,0)/(1,0)/(0,1), so the face's triangle rasterises across its whole patch.
fn vertUv(face: u32, k: u32) [2]f32 {
    const o = patchOrigin(face);
    const bary: [2]f32 = switch (k) {
        1 => .{ 1.0, 0.0 },
        2 => .{ 0.0, 1.0 },
        else => .{ 0.0, 0.0 },
    };
    const t = baryToPatchTexel(bary[0], bary[1]);
    return .{
        (@as(f32, @floatFromInt(o[0])) + t[0]) / @as(f32, @floatFromInt(g_atlas_w)),
        (@as(f32, @floatFromInt(o[1])) + t[1]) / @as(f32, @floatFromInt(g_atlas_h)),
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
    if (g_patch < 1) g_patch = 1;
    const pg = patchGrid(fc);
    g_key_hash = key_hash;
    g_facecount = fc;
    g_patches_w = pg[0];
    g_atlas_w = pg[0] * g_patch;
    g_atlas_h = pg[1] * g_patch;

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

    // Atlas: every texel starts at the default grey (this also covers gutter/tail texels
    // that no face triangle maps to).
    const need = @as(usize, g_atlas_w) * @as(usize, g_atlas_h) * 4;
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

    // Overwrite the mesh's UVs — each vertex to its patch-triangle corner.
    var vi: u32 = 0;
    while (vi < vert_count) : (vi += 1) {
        const uv = vertUv(vi / 3, vi % 3);
        verts[vi * 8 + 6] = uv[0];
        verts[vi * 8 + 7] = uv[1];
    }
    g_has_dirty = false;
    markRows(0, g_atlas_h - 1); // the whole fresh atlas needs its first upload
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

/// Paint one face — FLOODS its whole patch (the per-face fill behaviour) and marks the
/// patch rows dirty. At g_patch==1 this is the classic single-texel write. `face` out of
/// range is ignored (a raycast miss passes -1 up the stack, never here).
pub fn paintFace(face: u32, rgba: [4]u8) void {
    const buf = g_rgba orelse return;
    if (face >= g_facecount) return;
    const o = patchOrigin(face);
    var py: u32 = 0;
    while (py < g_patch) : (py += 1) {
        const row = o[1] + py;
        var px: u32 = 0;
        while (px < g_patch) : (px += 1) {
            const dst = (@as(usize, row) * g_atlas_w + o[0] + px) * 4;
            buf[dst + 0] = rgba[0];
            buf[dst + 1] = rgba[1];
            buf[dst + 2] = rgba[2];
            buf[dst + 3] = rgba[3];
        }
    }
    markRows(o[1], o[1] + g_patch - 1);
}

/// Bulk-set every face's colour from a per-face RGBA array (length ≥ facecount*4) —
/// how a quality change carries the source paint down onto the new (decimated) mesh.
/// Floods each patch (sub-face detail can't survive a topology change, so fill is right).
pub fn applyColors(colors: []const u8) void {
    if (g_rgba == null) return;
    if (colors.len < @as(usize, g_facecount) * 4) return;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        paintFace(f, .{ colors[f * 4 + 0], colors[f * 4 + 1], colors[f * 4 + 2], colors[f * 4 + 3] });
    }
}

/// A face's representative colour — the texel at its triangle centroid. Lets callers read
/// a face's base tone (quality carry-over, the headless proof). Selection uses the whole-
/// patch save/restore below so it never flattens sub-face paint.
pub fn faceColor(face: u32) ?[4]u8 {
    const buf = g_rgba orelse return null;
    if (face >= g_facecount) return null;
    const o = patchOrigin(face);
    const t = baryToPatchTexel(1.0 / 3.0, 1.0 / 3.0);
    const tx = o[0] + @as(u32, @intFromFloat(t[0]));
    const ty = o[1] + @as(u32, @intFromFloat(t[1]));
    const d = (@as(usize, ty) * g_atlas_w + tx) * 4;
    return .{ buf[d], buf[d + 1], buf[d + 2], buf[d + 3] };
}

// ── Per-face patch save/restore/tint (selection rides this, patch-safe) ───────────
/// Bytes in one face's patch (g_patch² texels × RGBA). The selection layer allocates
/// this per tinted face so it can restore EXACT sub-face paint on deselect.
pub fn facePatchLen() usize {
    return @as(usize, g_patch) * @as(usize, g_patch) * 4;
}

/// Copy a face's whole patch into `out` (len ≥ facePatchLen()). Returns false if no target.
pub fn saveFacePatch(face: u32, out: []u8) bool {
    const buf = g_rgba orelse return false;
    if (face >= g_facecount or out.len < facePatchLen()) return false;
    const o = patchOrigin(face);
    var py: u32 = 0;
    while (py < g_patch) : (py += 1) {
        const src = (@as(usize, o[1] + py) * g_atlas_w + o[0]) * 4;
        const dst = @as(usize, py) * g_patch * 4;
        @memcpy(out[dst .. dst + g_patch * 4], buf[src .. src + g_patch * 4]);
    }
    return true;
}

/// Write a saved patch back onto a face (exact restore of sub-face paint).
pub fn restoreFacePatch(face: u32, in: []const u8) void {
    const buf = g_rgba orelse return;
    if (face >= g_facecount or in.len < facePatchLen()) return;
    const o = patchOrigin(face);
    var py: u32 = 0;
    while (py < g_patch) : (py += 1) {
        const dst = (@as(usize, o[1] + py) * g_atlas_w + o[0]) * 4;
        const src = @as(usize, py) * g_patch * 4;
        @memcpy(buf[dst .. dst + g_patch * 4], in[src .. src + g_patch * 4]);
    }
    markRows(o[1], o[1] + g_patch - 1);
}

/// Blend every texel in a face's patch toward `tint` by `amt` (0..1). The selection
/// highlight — reversible via the saved patch, so it never destroys the paint underneath.
pub fn tintFacePatch(face: u32, tint: [4]u8, amt: f32) void {
    const buf = g_rgba orelse return;
    if (face >= g_facecount) return;
    const a = std.math.clamp(amt, 0.0, 1.0);
    const o = patchOrigin(face);
    var py: u32 = 0;
    while (py < g_patch) : (py += 1) {
        const row = o[1] + py;
        var px: u32 = 0;
        while (px < g_patch) : (px += 1) {
            const d = (@as(usize, row) * g_atlas_w + o[0] + px) * 4;
            inline for (0..3) |c| {
                const base: f32 = @floatFromInt(buf[d + c]);
                const tc: f32 = @floatFromInt(tint[c]);
                buf[d + c] = @intFromFloat(std.math.clamp(base + (tc - base) * a, 0.0, 255.0));
            }
        }
    }
    markRows(o[1], o[1] + g_patch - 1);
}

/// The CPU triangle positions (facecount*9 f32: 3 verts xyz per face), or null. The
/// selection layer welds these into vertices/edges; the same array the raycast uses.
pub fn positions() ?[]const f32 {
    return g_positions;
}

/// Mutable CPU triangle positions for host-native mesh editing. This is the same array
/// raycast/project read, so a moved vertex is immediately pickable at its new location.
pub fn positionsMutable() ?[]f32 {
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

/// Like rayTri but also returns the barycentric (u along a→b, v along a→c) of the hit —
/// exactly what maps a surface point into its patch (baryToPatchTexel). No backface cull.
const TriHit = struct { t: f32, u: f32, v: f32 };
fn rayTriBary(o: [3]f32, d: [3]f32, a: [3]f32, b: [3]f32, c: [3]f32) ?TriHit {
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
    return if (t > 1e-4) TriHit{ .t = t, .u = u, .v = v } else null;
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

/// Is world point `p` hidden behind the surface from the camera? True when a FRONT-facing
/// triangle sits between the eye and `p` (render culls back faces, so only front faces
/// visibly occlude). Lets vertex/edge picking ignore elements on the far side of the model
/// you can't even see. The eps tolerates a vertex's own incident faces (it lies ON them).
pub fn occluded(cam: Camera, p: [3]f32) bool {
    const pos = g_positions orelse return false;
    const ev = sub(p, cam.eye);
    const pdist = @sqrt(dot(ev, ev));
    if (pdist < 1e-6) return false;
    const dir: [3]f32 = .{ ev[0] / pdist, ev[1] / pdist, ev[2] / pdist };
    const eps = pdist * 0.003 + 1e-4;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const cc: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        const n = cross(sub(b, a), sub(cc, a));
        if (dot(n, dir) >= 0.0) continue; // back-facing to the ray → not a visible occluder
        if (rayTri(cam.eye, dir, a, b, cc)) |t| {
            if (t < pdist - eps) return true;
        }
    }
    return false;
}

// ── Free-form brush (sub-face strokes, clipped to the face) ───────────────────────
fn triVerts(pos: []const f32, f: u32) [3][3]f32 {
    return .{
        .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] },
        .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] },
        .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] },
    };
}

/// CLIP mode: the nearest front-facing face under (mx,my) plus the hit's barycentric —
/// each dab paints whichever face it lands on, clipped to that face's triangle.
pub const StampHit = struct { face: u32, u: f32, v: f32 };
pub fn pickBary(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) ?StampHit {
    const pos = g_positions orelse return null;
    if (vp_w <= 0 or vp_h <= 0) return null;
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    var best_front_t: f32 = std.math.floatMax(f32);
    var best_any_t: f32 = std.math.floatMax(f32);
    var front = StampHit{ .face = 0, .u = 0, .v = 0 };
    var any = StampHit{ .face = 0, .u = 0, .v = 0 };
    var hit_front = false;
    var hit_any = false;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const tri = triVerts(pos, f);
        if (rayTriBary(ray.o, ray.d, tri[0], tri[1], tri[2])) |h| {
            if (h.t < best_any_t) {
                best_any_t = h.t;
                any = .{ .face = f, .u = h.u, .v = h.v };
                hit_any = true;
            }
            const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
            if (dot(n, ray.d) < 0.0 and h.t < best_front_t) {
                best_front_t = h.t;
                front = .{ .face = f, .u = h.u, .v = h.v };
                hit_front = true;
            }
        }
    }
    if (hit_front) return front;
    if (hit_any) return any;
    return null;
}

/// LOCK mode: the barycentric where the ray meets ONE fixed face's plane, clamped into the
/// triangle — so a stroke locked to its start face keeps painting that face's nearest edge
/// even as the cursor drifts onto a neighbour. null only if the ray is parallel/behind.
pub fn baryOnFace(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32, face: u32) ?[2]f32 {
    const pos = g_positions orelse return null;
    if (face >= g_facecount or vp_w <= 0 or vp_h <= 0) return null;
    const tri = triVerts(pos, face);
    const a = tri[0];
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    const n = cross(sub(tri[1], a), sub(tri[2], a));
    const denom = dot(ray.d, n);
    if (@abs(denom) < 1e-9) return null;
    const t = dot(sub(a, ray.o), n) / denom;
    if (t <= 1e-4) return null;
    const hit: [3]f32 = .{ ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t };
    const v0 = sub(tri[1], a);
    const v1 = sub(tri[2], a);
    const v2 = sub(hit, a);
    const d00 = dot(v0, v0);
    const d01 = dot(v0, v1);
    const d11 = dot(v1, v1);
    const d20 = dot(v2, v0);
    const d21 = dot(v2, v1);
    const det = d00 * d11 - d01 * d01;
    if (@abs(det) < 1e-12) return null;
    var u = (d11 * d20 - d01 * d21) / det;
    var v = (d00 * d21 - d01 * d20) / det;
    u = std.math.clamp(u, 0.0, 1.0);
    v = std.math.clamp(v, 0.0, 1.0);
    if (u + v > 1.0) {
        const s = u + v;
        u /= s;
        v /= s;
    }
    return .{ u, v };
}

/// Stamp a brush dab onto a face's patch: a disc of `radius` texels around the hit's
/// barycentric, CLIPPED to the face's triangle (so overhang never touches a neighbour —
/// each face owns its texels). `flow` (0..1) is the blend toward `rgba`. At g_patch==1
/// there's no sub-face room, so it degrades to a per-face fill.
pub fn paintStamp(face: u32, cu: f32, cv: f32, radius: f32, rgba: [4]u8, flow: f32) void {
    const buf = g_rgba orelse return;
    if (face >= g_facecount) return;
    if (g_patch <= 1) return paintFace(face, rgba);
    const o = patchOrigin(face);
    const span = patchSpan();
    const cx = PATCH_GUTTER + cu * span;
    const cy = PATCH_GUTTER + cv * span;
    const r = @max(radius, 0.6);
    const amt = std.math.clamp(flow, 0.0, 1.0);
    const tri_max: f32 = span; // texels where px+py <= span are inside the triangle
    var py: u32 = 0;
    while (py < g_patch) : (py += 1) {
        var px: u32 = 0;
        while (px < g_patch) : (px += 1) {
            const fx: f32 = @floatFromInt(px);
            const fy: f32 = @floatFromInt(py);
            if (fx + fy > tri_max + 0.5) continue; // outside the face triangle → clipped
            const dx = fx + 0.5 - cx;
            const dy = fy + 0.5 - cy;
            if (dx * dx + dy * dy > r * r) continue; // outside the brush disc
            const d = (@as(usize, o[1] + py) * g_atlas_w + o[0] + px) * 4;
            inline for (0..3) |c| {
                const base: f32 = @floatFromInt(buf[d + c]);
                const tc: f32 = @floatFromInt(rgba[c]);
                buf[d + c] = @intFromFloat(std.math.clamp(base + (tc - base) * amt, 0.0, 255.0));
            }
            buf[d + 3] = 255;
        }
    }
    markRows(o[1], o[1] + g_patch - 1);
}

// ── Detail (patch size) toggle ────────────────────────────────────────────────────
const ATLAS_BUDGET: usize = 64 * 1024 * 1024; // paint-atlas ceiling (bytes)
pub fn detail() u32 {
    return g_patch;
}
fn snapPatch(p: u32) u32 {
    if (p >= 32) return 32;
    if (p >= 16) return 16;
    if (p >= 8) return 8;
    return 1;
}
/// Re-tessellate the atlas to a new per-face detail (patch size), carrying each face's
/// current colour as a flat fill (sub-face strokes can't survive a resolution change).
/// Rewrites the caller's vertex UVs in place — 3d.zig re-uploads the mesh after. Rejected
/// (and logged) if the new atlas would blow the memory budget; the old layout stays.
pub fn setDetail(new_patch: u32, verts: []f32, vert_count: u32) void {
    if (g_positions == null or g_rgba == null) return;
    const fc = g_facecount;
    if (fc == 0 or vert_count / 3 != fc) return;
    const np = snapPatch(new_patch);
    if (np == g_patch) return;

    const pg = patchGrid(fc);
    const new_w = pg[0] * np;
    const new_h = pg[1] * np;
    const need = @as(usize, new_w) * @as(usize, new_h) * 4;
    if (need > ATLAS_BUDGET) {
        std.debug.print("[model_paint] detail {d}px on {d} faces needs {d}MB > {d}MB budget — staying at patch {d} (fill-only where detail is off). Lower detail or decimate.\n", .{ np, fc, need / (1024 * 1024), ATLAS_BUDGET / (1024 * 1024), g_patch });
        return;
    }

    // Snapshot per-face base colours (centroid texel) before the atlas is reshaped.
    const snap = alloc.alloc(u8, @as(usize, fc) * 4) catch return;
    defer alloc.free(snap);
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const col = faceColor(f) orelse DEFAULT_FACE;
        snap[f * 4 + 0] = col[0];
        snap[f * 4 + 1] = col[1];
        snap[f * 4 + 2] = col[2];
        snap[f * 4 + 3] = col[3];
    }

    const rgba = alloc.alloc(u8, need) catch return;
    var i: usize = 0;
    while (i < need) : (i += 4) {
        rgba[i + 0] = DEFAULT_FACE[0];
        rgba[i + 1] = DEFAULT_FACE[1];
        rgba[i + 2] = DEFAULT_FACE[2];
        rgba[i + 3] = DEFAULT_FACE[3];
    }
    if (g_rgba) |old| alloc.free(old);
    g_rgba = rgba;
    g_patch = np;
    g_patches_w = pg[0];
    g_atlas_w = new_w;
    g_atlas_h = new_h;

    var vi: u32 = 0;
    while (vi < vert_count) : (vi += 1) {
        const uv = vertUv(vi / 3, vi % 3);
        verts[vi * 8 + 6] = uv[0];
        verts[vi * 8 + 7] = uv[1];
    }
    applyColors(snap); // flood each patch with its carried base colour
    g_has_dirty = false;
    markRows(0, g_atlas_h - 1);
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

test "occluded: a point behind a front face is hidden; on/in front of it is not" {
    // One triangle in z=0 facing +Z, camera on +Z looking down -Z.
    var verts = [_]f32{
        -1, -1, 0, 0, 0, 1, 0, 0,
        1,  -1, 0, 0, 0, 1, 0, 0,
        0,  1,  0, 0, 0, 1, 0, 0,
    };
    setTarget(322, &verts, 3);
    defer clear();
    const cam = Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    // Behind the triangle (z<0), along the ray through its centre → hidden by the front face.
    try std.testing.expect(occluded(cam, .{ 0, 0, -1 }));
    // In front of the triangle (closer to the eye) → visible.
    try std.testing.expect(!occluded(cam, .{ 0, 0, 1 }));
    // A vertex lying ON the triangle → visible (eps tolerates its own face).
    try std.testing.expect(!occluded(cam, .{ 0, 1, 0 }));
}

test "patch grid covers every face" {
    const d = patchGrid(4612);
    try std.testing.expect(d[0] * d[1] >= 4612);
    try std.testing.expect(d[0] >= 68 and d[0] <= 80);
}
