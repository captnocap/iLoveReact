//! Procedural loader geometry.
//!
//! Pure mesh builders only: no retained runtime state, GPU ownership, or file I/O.

const std = @import("std");

pub fn tileColor(value: ?u16) ?[3]f32 {
    const v = value orelse return null;
    if (v == 0) return null;
    const palette = [_][3]f32{
        .{ 0.18, 0.65, 0.62 }, // teal
        .{ 0.92, 0.52, 0.18 }, // orange
        .{ 0.30, 0.45, 0.85 }, // blue
        .{ 0.45, 0.72, 0.34 }, // green
        .{ 0.82, 0.35, 0.55 }, // magenta
        .{ 0.85, 0.78, 0.30 }, // yellow
        .{ 0.55, 0.55, 0.62 }, // gray
        .{ 0.70, 0.45, 0.30 }, // brown
    };
    return palette[@as(usize, v - 1) % palette.len];
}

/// A unit cube as 36 interleaved verts (pos3 + normal3 + uv2), CCW-wound for the
/// back-face/ccw mesh pipeline. ONE interned geometry; every world object is an
/// instance of it, scaled + positioned + colored by the instance buffer.
pub fn buildCube() [36 * 8]f32 {
    const Corner = [3]f32;
    const Face = struct { n: Corner, a: Corner, b: Corner, c: Corner, d: Corner };
    const v0 = Corner{ -0.5, -0.5, -0.5 };
    const v1 = Corner{ 0.5, -0.5, -0.5 };
    const v2 = Corner{ 0.5, 0.5, -0.5 };
    const v3 = Corner{ -0.5, 0.5, -0.5 };
    const v4 = Corner{ -0.5, -0.5, 0.5 };
    const v5 = Corner{ 0.5, -0.5, 0.5 };
    const v6 = Corner{ 0.5, 0.5, 0.5 };
    const v7 = Corner{ -0.5, 0.5, 0.5 };
    const faces = [_]Face{
        .{ .n = .{ 0, 0, 1 }, .a = v4, .b = v5, .c = v6, .d = v7 }, // +Z
        .{ .n = .{ 0, 0, -1 }, .a = v1, .b = v0, .c = v3, .d = v2 }, // -Z
        .{ .n = .{ 1, 0, 0 }, .a = v5, .b = v1, .c = v2, .d = v6 }, // +X
        .{ .n = .{ -1, 0, 0 }, .a = v0, .b = v4, .c = v7, .d = v3 }, // -X
        .{ .n = .{ 0, 1, 0 }, .a = v7, .b = v6, .c = v2, .d = v3 }, // +Y
        .{ .n = .{ 0, -1, 0 }, .a = v0, .b = v1, .c = v5, .d = v4 }, // -Y
    };
    // Corners run world bottom→top (BL,BR,TR,TL); V is FLIPPED so a top-down
    // texture stays upright on the face — the geometry registry's addFace
    // convention EXACTLY (runtime/geometries/_util.ts face()), which the
    // editor's every textured mesh uses. UVFLIP-0610: this cube shipped v=0
    // at world BOTTOM for two days — every materialized shader sampled
    // upside-down (the user's door), and the decal raster compensated with a
    // 180° rotation that silently mirrored u. One convention, one place.
    const uvs = [4][2]f32{ .{ 0, 1 }, .{ 1, 1 }, .{ 1, 0 }, .{ 0, 0 } };
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    for (faces) |f| {
        const quad = [4]Corner{ f.a, f.b, f.c, f.d };
        for ([6]usize{ 0, 1, 2, 0, 2, 3 }) |q| {
            const p = quad[q];
            out[i + 0] = p[0];
            out[i + 1] = p[1];
            out[i + 2] = p[2];
            out[i + 3] = f.n[0];
            out[i + 4] = f.n[1];
            out[i + 5] = f.n[2];
            out[i + 6] = uvs[q][0];
            out[i + 7] = uvs[q][1];
            i += 8;
        }
    }
    return out;
}

pub fn buildCubeOpenRun(comptime open_min: bool, comptime open_max: bool) [(36 - (if (open_min) 6 else 0) - (if (open_max) 6 else 0)) * 8]f32 {
    const Corner = [3]f32;
    const v0 = Corner{ -0.5, -0.5, -0.5 };
    const v1 = Corner{ 0.5, -0.5, -0.5 };
    const v2 = Corner{ 0.5, 0.5, -0.5 };
    const v3 = Corner{ -0.5, 0.5, -0.5 };
    const v4 = Corner{ -0.5, -0.5, 0.5 };
    const v5 = Corner{ 0.5, -0.5, 0.5 };
    const v6 = Corner{ 0.5, 0.5, 0.5 };
    const v7 = Corner{ -0.5, 0.5, 0.5 };
    const vert_count = 36 - (if (open_min) 6 else 0) - (if (open_max) 6 else 0);
    var out: [vert_count * 8]f32 = undefined;
    var i: usize = 0;
    pushFace(out[0..], &i, v4, v5, v6, v7, .{ 0, 0, 1 });
    pushFace(out[0..], &i, v1, v0, v3, v2, .{ 0, 0, -1 });
    if (!open_max) pushFace(out[0..], &i, v5, v1, v2, v6, .{ 1, 0, 0 });
    if (!open_min) pushFace(out[0..], &i, v0, v4, v7, v3, .{ -1, 0, 0 });
    pushFace(out[0..], &i, v7, v6, v2, v3, .{ 0, 1, 0 });
    pushFace(out[0..], &i, v0, v1, v5, v4, .{ 0, -1, 0 });
    return out;
}

fn pushVertex(out: []f32, idx: *usize, p: [3]f32, n: [3]f32, uv: [2]f32) void {
    out[idx.* + 0] = p[0];
    out[idx.* + 1] = p[1];
    out[idx.* + 2] = p[2];
    out[idx.* + 3] = n[0];
    out[idx.* + 4] = n[1];
    out[idx.* + 5] = n[2];
    out[idx.* + 6] = uv[0];
    out[idx.* + 7] = uv[1];
    idx.* += 8;
}

fn pushTri(out: []f32, idx: *usize, a: [3]f32, b: [3]f32, c0: [3]f32, n: [3]f32, uva: [2]f32, uvb: [2]f32, uvc: [2]f32) void {
    pushVertex(out, idx, a, n, uva);
    pushVertex(out, idx, b, n, uvb);
    pushVertex(out, idx, c0, n, uvc);
}

/// Per-vertex normals — curved surfaces (sphere, cylinder barrel) shade
/// SMOOTH like the editor's geometry registry; one shared normal facets them
/// (SMOOTHPROP-0610: compiled bushes read as cut gems next to /test's).
fn pushTriSmooth(out: []f32, idx: *usize, a: [3]f32, b: [3]f32, c0: [3]f32, na: [3]f32, nb: [3]f32, nc: [3]f32, uva: [2]f32, uvb: [2]f32, uvc: [2]f32) void {
    pushVertex(out, idx, a, na, uva);
    pushVertex(out, idx, b, nb, uvb);
    pushVertex(out, idx, c0, nc, uvc);
}

fn pushFace(out: []f32, idx: *usize, a: [3]f32, b: [3]f32, c0: [3]f32, d: [3]f32, n: [3]f32) void {
    pushTri(out, idx, a, b, c0, n, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
    pushTri(out, idx, a, c0, d, n, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
}

fn normalize3(x: f32, y: f32, z: f32) [3]f32 {
    const len = @sqrt(x * x + y * y + z * z);
    if (len <= 0.000001) return .{ 0, 1, 0 };
    return .{ x / len, y / len, z / len };
}

/// /test's RampSlabGeometry normalized for instancing: local x/z are unit
/// footprint, local y is centered so scale.y = catalog rise and position.y is
/// base + rise/2. The slab thickness ratio matches the common 3m ramp.
pub fn buildRampSlab(thickness_ratio: f32) [36 * 8]f32 {
    const hx: f32 = 0.5;
    const hz: f32 = 0.5;
    const rise0: f32 = -0.5;
    const rise1: f32 = 0.5;
    const t = thickness_ratio;
    const low_top = [2][3]f32{ .{ -hx, rise0, -hz }, .{ hx, rise0, -hz } };
    const high_top = [2][3]f32{ .{ -hx, rise1, hz }, .{ hx, rise1, hz } };
    const low_bottom = [2][3]f32{ .{ -hx, rise0 - t, -hz }, .{ hx, rise0 - t, -hz } };
    const high_bottom = [2][3]f32{ .{ -hx, rise1 - t, hz }, .{ hx, rise1 - t, hz } };
    const top_normal = normalize3(0, 1, -1);
    const bottom_normal = normalize3(0, -1, 1);
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    pushTri(out[0..], &i, low_top[0], high_top[1], low_top[1], top_normal, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
    pushTri(out[0..], &i, low_top[0], high_top[0], high_top[1], top_normal, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
    pushTri(out[0..], &i, low_bottom[0], low_bottom[1], high_bottom[1], bottom_normal, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
    pushTri(out[0..], &i, low_bottom[0], high_bottom[1], high_bottom[0], bottom_normal, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
    pushFace(out[0..], &i, low_bottom[1], low_top[1], high_top[1], high_bottom[1], .{ 1, 0, 0 });
    pushFace(out[0..], &i, low_top[0], low_bottom[0], high_bottom[0], high_top[0], .{ -1, 0, 0 });
    pushFace(out[0..], &i, low_bottom[0], low_bottom[1], low_top[1], low_top[0], .{ 0, 0, -1 });
    pushFace(out[0..], &i, high_bottom[1], high_bottom[0], high_top[0], high_top[1], .{ 0, 0, 1 });
    return out;
}

/// req_0930: the GABLE END prism — a unit isoceles-triangle wall, the compiled
/// twin of pieceMeshes' GablePrismGeometry (same verts/normals/winding so the
/// editor and the compiled game render the identical solid). Unit space: x is
/// the thin width-thickness, z is the eave-to-eave base, y is centered so
/// scale.y = the ridge rise. The apex is an EDGE at y=+0.5, z=0 (along x).
pub fn buildGablePrism() [24 * 8]f32 {
    const a0 = [3]f32{ -0.5, -0.5, -0.5 };
    const a1 = [3]f32{ 0.5, -0.5, -0.5 };
    const b0 = [3]f32{ -0.5, -0.5, 0.5 };
    const b1 = [3]f32{ 0.5, -0.5, 0.5 };
    const p0 = [3]f32{ -0.5, 0.5, 0 };
    const p1 = [3]f32{ 0.5, 0.5, 0 };
    const down = [3]f32{ 0, -1, 0 };
    const neg_z = normalize3(0, 0.5, -1); // -z slope, up-and-out
    const pos_z = normalize3(0, 0.5, 1); // +z slope, up-and-out
    const neg_x = [3]f32{ -1, 0, 0 };
    const pos_x = [3]f32{ 1, 0, 0 };
    var out: [24 * 8]f32 = undefined;
    var i: usize = 0;
    // base
    pushTri(out[0..], &i, a0, b1, b0, down, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
    pushTri(out[0..], &i, a0, a1, b1, down, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
    // -z slope
    pushTri(out[0..], &i, a0, p1, a1, neg_z, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
    pushTri(out[0..], &i, a0, p0, p1, neg_z, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
    // +z slope
    pushTri(out[0..], &i, b0, b1, p1, pos_z, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
    pushTri(out[0..], &i, b0, p1, p0, pos_z, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
    // triangular end caps
    pushTri(out[0..], &i, a0, b0, p0, neg_x, .{ 0, 0 }, .{ 1, 0 }, .{ 0.5, 1 });
    pushTri(out[0..], &i, a1, p1, b1, pos_x, .{ 0, 0 }, .{ 0.5, 1 }, .{ 1, 0 });
    return out;
}

/// CORNERSEAM-0610: a unit vertical right-triangle prism for wall L-corner
/// miters. Unit footprint is (-x,-z), (+x,-z), (-x,+z). The local -x face is
/// omitted because it lies against the trimmed wall body; drawing it creates the
/// visible vertical strip the miter is meant to remove. The diagonal split face
/// is omitted too; it is only the internal boundary between two painted halves.
pub fn buildCornerMiterPrism() [12 * 8]f32 {
    const b0 = [3]f32{ -0.5, -0.5, -0.5 };
    const b1 = [3]f32{ 0.5, -0.5, -0.5 };
    const b2 = [3]f32{ -0.5, -0.5, 0.5 };
    const t0 = [3]f32{ -0.5, 0.5, -0.5 };
    const t1 = [3]f32{ 0.5, 0.5, -0.5 };
    const t2 = [3]f32{ -0.5, 0.5, 0.5 };
    const down = [3]f32{ 0, -1, 0 };
    const up = [3]f32{ 0, 1, 0 };
    const neg_z = [3]f32{ 0, 0, -1 };
    var out: [12 * 8]f32 = undefined;
    var i: usize = 0;
    pushTri(out[0..], &i, b0, b2, b1, down, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 0 });
    pushTri(out[0..], &i, t0, t1, t2, up, .{ 0, 0 }, .{ 1, 0 }, .{ 0, 1 });
    pushFace(out[0..], &i, b0, b1, t1, t0, neg_z);
    return out;
}

/// Reflected twin of buildCornerMiterPrism. This is a separate keyed primitive
/// instead of negative instance scale, because the 3D pipeline back-face culls
/// normal meshes.
pub fn buildCornerMiterMirrorPrism() [12 * 8]f32 {
    const b0 = [3]f32{ -0.5, -0.5, 0.5 };
    const b1 = [3]f32{ 0.5, -0.5, 0.5 };
    const b2 = [3]f32{ -0.5, -0.5, -0.5 };
    const t0 = [3]f32{ -0.5, 0.5, 0.5 };
    const t1 = [3]f32{ 0.5, 0.5, 0.5 };
    const t2 = [3]f32{ -0.5, 0.5, -0.5 };
    const down = [3]f32{ 0, -1, 0 };
    const up = [3]f32{ 0, 1, 0 };
    const pos_z = [3]f32{ 0, 0, 1 };
    var out: [12 * 8]f32 = undefined;
    var i: usize = 0;
    pushTri(out[0..], &i, b0, b2, b1, down, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 0 });
    pushTri(out[0..], &i, t0, t1, t2, up, .{ 0, 0 }, .{ 1, 0 }, .{ 0, 1 });
    pushFace(out[0..], &i, b0, b1, t1, t0, pos_z);
    return out;
}

/// A grass blade clump — the compiled twin of runtime/geometries/GrassBlade.ts
/// (same crossed-quad layout / UVs so the editor iso view and the compiled game
/// render identical blades). 3 quads crossed around Y, each unit-tall (uv.y
/// 0=root,1=tip), double-sided (both windings). The grass pipeline (gpu/3d.zig,
/// routed by the "~grass~" tex key) paints the wisp cutout + gradient + wind.
pub fn buildGrassBlade() [36 * 8]f32 {
    const half_w: f32 = 0.07; // GRASS_BLADE_DEFAULTS.width 0.14 * 0.5
    const tip_half: f32 = 0.0175; // half_w * tipTaper 0.25
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    var b: usize = 0;
    while (b < 3) : (b += 1) {
        const theta = (@as(f32, @floatFromInt(b)) + 0.5) / 3.0 * std.math.pi;
        const dx = @cos(theta);
        const dz = @sin(theta);
        const n = [3]f32{ dz, 0, -dx };
        const nb = [3]f32{ -dz, 0, dx };
        const bl = [3]f32{ -dx * half_w, 0, -dz * half_w };
        const br = [3]f32{ dx * half_w, 0, dz * half_w };
        const tr = [3]f32{ dx * tip_half, 1, dz * tip_half };
        const tl = [3]f32{ -dx * tip_half, 1, -dz * tip_half };
        // front
        pushTri(out[0..], &i, bl, br, tr, n, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
        pushTri(out[0..], &i, bl, tr, tl, n, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
        // back (reversed winding + flipped normal)
        pushTri(out[0..], &i, bl, tr, br, nb, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
        pushTri(out[0..], &i, bl, tl, tr, nb, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
    }
    return out;
}

/// Flower heads — compiled twin of runtime/geometries/FlowerHead.ts. These are
/// tiny crossed cards in the grass shader's UV flower band (10..11), so the
/// "~grass~" pipeline cuts them into colored blossoms and applies the same
/// tip-weighted wind as grass blades.
pub fn buildFlowerHead() [36 * 8]f32 {
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    var b: usize = 0;
    while (b < 3) : (b += 1) {
        const theta = (@as(f32, @floatFromInt(b)) + 0.5) / 3.0 * std.math.pi;
        const dx = @cos(theta);
        const dz = @sin(theta);
        const n = [3]f32{ dz, 0, -dx };
        const nb = [3]f32{ -dz, 0, dx };
        const bl = [3]f32{ -dx, -1, -dz };
        const br = [3]f32{ dx, -1, dz };
        const tr = [3]f32{ dx, 1, dz };
        const tl = [3]f32{ -dx, 1, -dz };
        pushTri(out[0..], &i, bl, br, tr, n, .{ 10, 10 }, .{ 11, 10 }, .{ 11, 11 });
        pushTri(out[0..], &i, bl, tr, tl, n, .{ 10, 10 }, .{ 11, 11 }, .{ 10, 11 });
        pushTri(out[0..], &i, bl, tr, br, nb, .{ 10, 10 }, .{ 11, 11 }, .{ 11, 10 });
        pushTri(out[0..], &i, bl, tl, tr, nb, .{ 10, 10 }, .{ 10, 11 }, .{ 11, 11 });
    }
    return out;
}

/// A bush foliage clump — the compiled twin of runtime/geometries/BushClump.ts.
/// 5 cards fanned a FULL circle, each leaning OUTWARD (tip splayed along its
/// compass dir) so the silhouette reads as a leafy shrub, not a tuft. Double-sided;
/// the foliage pipeline (routed by "~grass~") cuts + gradients + sways it.
pub fn buildBushClump() [60 * 8]f32 {
    const half_w: f32 = 0.25; // BUSH_CLUMP_DEFAULTS.width 0.5 * 0.5
    const tip_half: f32 = 0.075; // half_w * tipTaper 0.3
    const splay: f32 = 0.5;
    var out: [60 * 8]f32 = undefined;
    var i: usize = 0;
    var b: usize = 0;
    while (b < 5) : (b += 1) {
        const theta = (@as(f32, @floatFromInt(b)) + 0.5) / 5.0 * std.math.pi * 2.0;
        const dx = @cos(theta);
        const dz = @sin(theta);
        const perp_x = -dz;
        const perp_z = dx;
        const n = [3]f32{ dx, 0.6, dz };
        const nb = [3]f32{ -dx, 0.6, -dz };
        const tip_x = dx * splay;
        const tip_z = dz * splay;
        const bl = [3]f32{ -perp_x * half_w, 0, -perp_z * half_w };
        const br = [3]f32{ perp_x * half_w, 0, perp_z * half_w };
        const tr = [3]f32{ tip_x + perp_x * tip_half, 1, tip_z + perp_z * tip_half };
        const tl = [3]f32{ tip_x - perp_x * tip_half, 1, tip_z - perp_z * tip_half };
        // front
        pushTri(out[0..], &i, bl, br, tr, n, .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 });
        pushTri(out[0..], &i, bl, tr, tl, n, .{ 0, 0 }, .{ 1, 1 }, .{ 0, 1 });
        // back (reversed winding + flipped normal)
        pushTri(out[0..], &i, bl, tr, br, nb, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
        pushTri(out[0..], &i, bl, tl, tr, nb, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
    }
    return out;
}

/// One palm-crown FROND card — the compiled twin of runtime/geometries/Frond.ts
/// (FROND_DEFAULTS: the feathered coconut leaf). A segmented arched card: y rises
/// 0→1 up the leaf, z arches forward by arc·t², the tip sags by sag·t², and the
/// width tapers to the point. uv.v 0=root→1=tip drives the gradient/wind; uv.u ∈
/// [0,1] is the across-leaf coordinate (style 'feathered' → u offset 0). Emitted
/// double-sided (front + flipped back) since the ~frond~ pipeline culls nothing.
/// The per-instance scale (wide, len, wide) sizes ONE interned frond to every tree.
pub fn buildFrond() [144 * 8]f32 {
    const width: f32 = 0.5; // FROND_DEFAULTS.width
    const tip_taper: f32 = 0.1;
    const arc: f32 = 0.8;
    const sag: f32 = 0.18;
    const segs: usize = 12;
    var out: [144 * 8]f32 = undefined;
    var i: usize = 0;
    var s: usize = 0;
    while (s < segs) : (s += 1) {
        const t0 = @as(f32, @floatFromInt(s)) / @as(f32, @floatFromInt(segs));
        const t1 = @as(f32, @floatFromInt(s + 1)) / @as(f32, @floatFromInt(segs));
        const ay = t0 - sag * t0 * t0;
        const az = arc * t0 * t0;
        const ah = width * 0.5 * (1.0 - (1.0 - tip_taper) * t0);
        const by = t1 - sag * t1 * t1;
        const bz = arc * t1 * t1;
        const bh = width * 0.5 * (1.0 - (1.0 - tip_taper) * t1);
        // Face normal ≈ the spine tangent rotated 90° (faces forward/up as it arches).
        const dy = by - ay;
        const dz = bz - az;
        const len = @max(1e-6, @sqrt(dy * dy + dz * dz));
        const nf = [3]f32{ 0, -dz / len, dy / len };
        const nb = [3]f32{ 0, dz / len, -dy / len };
        const bl = [3]f32{ -ah, ay, az };
        const br = [3]f32{ ah, ay, az };
        const tr = [3]f32{ bh, by, bz };
        const tl = [3]f32{ -bh, by, bz };
        // front (v base→tip, u spans leaf width)
        pushTri(out[0..], &i, bl, br, tr, nf, .{ 0, t0 }, .{ 1, t0 }, .{ 1, t1 });
        pushTri(out[0..], &i, bl, tr, tl, nf, .{ 0, t0 }, .{ 1, t1 }, .{ 0, t1 });
        // back (reversed winding + flipped normal)
        pushTri(out[0..], &i, bl, tr, br, nb, .{ 0, t0 }, .{ 1, t1 }, .{ 1, t0 });
        pushTri(out[0..], &i, bl, tl, tr, nb, .{ 0, t0 }, .{ 0, t1 }, .{ 1, t1 });
    }
    return out;
}

// Palm-trunk profile at height t∈[0,1] — the compiled twin of PalmTrunk.ts `at()`:
// taper base→top, a fattening bulge just above the base, the scar-ring radius
// ripple, and a forward lean (cx) that grows toward the top with a slight S.
fn palmTrunkProfile(t: f32) struct { r: f32, cx: f32 } {
    const base_r: f32 = 0.13; // PALM_TRUNK_DEFAULTS.baseRadius
    const top_r: f32 = 0.08;
    const curve: f32 = 0.16;
    const rings: f32 = 11;
    const ring_depth: f32 = 0.12;
    const taper = base_r + (top_r - base_r) * t;
    const dd = (t - 0.12) * (t - 0.12);
    const bulge = 1.0 + 0.18 * @exp(-dd / 0.01);
    const ring = 1.0 + ring_depth * @cos(t * rings * (2.0 * std.math.pi));
    const r = taper * bulge * ring;
    const cx = curve * (t * t * 0.7 + @sin(t * 2.8) * 0.05);
    return .{ .r = r, .cx = cx };
}

// One ring vertex at height t, side s of `sides` — outward radial normal tilted
// slightly up (0.15) so the log lights like a cylinder. (PalmTrunk.ts ringVerts.)
fn palmTrunkVert(t: f32, s: usize, sides: usize) struct { pos: [3]f32, nrm: [3]f32, u: f32 } {
    const prof = palmTrunkProfile(t);
    const a = @as(f32, @floatFromInt(s)) / @as(f32, @floatFromInt(sides)) * (2.0 * std.math.pi);
    const dx = @cos(a);
    const dz = @sin(a);
    const nl = @sqrt(dx * dx + 0.15 * 0.15 + dz * dz);
    return .{
        .pos = .{ prof.cx + dx * prof.r, t, dz * prof.r },
        .nrm = .{ dx / nl, 0.15 / nl, dz / nl },
        .u = @as(f32, @floatFromInt(s)) / @as(f32, @floatFromInt(sides)),
    };
}

/// One palm TRUNK — the compiled twin of runtime/geometries/PalmTrunk.ts
/// (PALM_TRUNK_DEFAULTS). A tapered tube, 1 unit tall (base y=0 → top y=1), that
/// fattens just above the base, narrows upward, leans forward, and wears horizontal
/// scar rings (a radius ripple that bands in light). Per-vertex outward normals; the
/// per-instance scale (span, height, span) sizes ONE interned trunk to every palm.
/// 28 segments × 10 sides × 2 tris × 3 verts = 1680 verts.
pub fn buildPalmTrunk() [1680 * 8]f32 {
    const sides: usize = 10; // PALM_TRUNK_DEFAULTS.sides
    const segs: usize = 28; // PALM_TRUNK_DEFAULTS.segments
    var out: [1680 * 8]f32 = undefined;
    var i: usize = 0;
    var seg: usize = 0;
    while (seg < segs) : (seg += 1) {
        const v0 = @as(f32, @floatFromInt(seg)) / @as(f32, @floatFromInt(segs));
        const v1 = @as(f32, @floatFromInt(seg + 1)) / @as(f32, @floatFromInt(segs));
        var s: usize = 0;
        while (s < sides) : (s += 1) {
            const bl = palmTrunkVert(v0, s, sides);
            const br = palmTrunkVert(v0, s + 1, sides);
            const tr = palmTrunkVert(v1, s + 1, sides);
            const tl = palmTrunkVert(v1, s, sides);
            // CCW outward winding (cull_mode=.back/front_face=.ccw) so the OUTER
            // wall is front-facing and the trunk reads solid — the reverse of
            // PalmTrunk.ts's order, whose outer faces were culled (the "hollow C").
            pushTriSmooth(out[0..], &i, bl.pos, tl.pos, tr.pos, bl.nrm, tl.nrm, tr.nrm, .{ bl.u, v0 }, .{ tl.u, v1 }, .{ tr.u, v1 });
            pushTriSmooth(out[0..], &i, bl.pos, tr.pos, br.pos, bl.nrm, tr.nrm, br.nrm, .{ bl.u, v0 }, .{ tr.u, v1 }, .{ br.u, v0 });
        }
    }
    return out;
}

fn spherePos(radius: f32, theta: f32, phi: f32) [3]f32 {
    const st = @sin(theta);
    return .{ radius * st * @cos(phi), radius * @cos(theta), radius * st * @sin(phi) };
}

fn sphereNormal(theta: f32, phi: f32) [3]f32 {
    const st = @sin(theta);
    return .{ st * @cos(phi), @cos(theta), st * @sin(phi) };
}

fn sphereUv(n: [3]f32) [2]f32 {
    return .{ (n[0] + 1.0) * 0.5, (1.0 - n[1]) * 0.5 };
}

pub fn buildUnitSphere(comptime segments: usize, comptime rings: usize) [segments * rings * 6 * 8]f32 {
    var out: [segments * rings * 6 * 8]f32 = undefined;
    var idx: usize = 0;
    var i: usize = 0;
    while (i < rings) : (i += 1) {
        const t1 = std.math.pi * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(rings));
        const t2 = std.math.pi * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(rings));
        var j: usize = 0;
        while (j < segments) : (j += 1) {
            const p1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
            const p2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
            const a = spherePos(0.5, t1, p1);
            const b = spherePos(0.5, t1, p2);
            const c0 = spherePos(0.5, t2, p2);
            const d = spherePos(0.5, t2, p1);
            const na = sphereNormal(t1, p1);
            const nb = sphereNormal(t1, p2);
            const nc = sphereNormal(t2, p2);
            const nd = sphereNormal(t2, p1);
            pushTriSmooth(out[0..], &idx, a, c0, d, na, nc, nd, sphereUv(na), sphereUv(nc), sphereUv(nd));
            pushTriSmooth(out[0..], &idx, a, b, c0, na, nb, nc, sphereUv(na), sphereUv(nb), sphereUv(nc));
        }
    }
    return out;
}

pub fn buildUnitCylinder(comptime segments: usize) [segments * 12 * 8]f32 {
    var out: [segments * 12 * 8]f32 = undefined;
    var idx: usize = 0;
    const radius: f32 = 0.5;
    const hy: f32 = 0.5;
    var j: usize = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);
        const a = [3]f32{ radius * c1, -hy, radius * s1 };
        const b = [3]f32{ radius * c2, -hy, radius * s2 };
        const c0 = [3]f32{ radius * c2, hy, radius * s2 };
        const d = [3]f32{ radius * c1, hy, radius * s1 };
        const n1 = [3]f32{ c1, 0, s1 };
        const n2 = [3]f32{ c2, 0, s2 };
        // Barrel quads share rim normals across segments (smooth); caps stay flat.
        pushTriSmooth(out[0..], &idx, a, d, c0, n1, n1, n2, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
        pushTriSmooth(out[0..], &idx, a, c0, b, n1, n2, n2, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
        pushTri(out[0..], &idx, .{ 0, hy, 0 }, c0, d, .{ 0, 1, 0 }, .{ 0.5, 0.5 }, .{ 1, 1 }, .{ 0, 1 });
        pushTri(out[0..], &idx, .{ 0, -hy, 0 }, a, b, .{ 0, -1, 0 }, .{ 0.5, 0.5 }, .{ 0, 0 }, .{ 1, 0 });
    }
    return out;
}

fn pushFlatDisc(comptime segments: usize, out: []f32, idx: *usize, radius: f32, y: f32) void {
    const center = [3]f32{ 0, y, 0 };
    var j: usize = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const p1 = [3]f32{ radius * @cos(a1), y, radius * @sin(a1) };
        const p2 = [3]f32{ radius * @cos(a2), y, radius * @sin(a2) };
        pushTri(out, idx, center, p2, p1, .{ 0, 1, 0 }, .{ 0.5, 0.5 }, .{ 1, 1 }, .{ 0, 1 });
    }
}

fn pushFlatRingBand(comptime segments: usize, out: []f32, idx: *usize, inner: f32, outer: f32, y: f32) void {
    var j: usize = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const o1 = [3]f32{ outer * @cos(a1), y, outer * @sin(a1) };
        const o2 = [3]f32{ outer * @cos(a2), y, outer * @sin(a2) };
        const inner1 = [3]f32{ inner * @cos(a1), y, inner * @sin(a1) };
        const inner2 = [3]f32{ inner * @cos(a2), y, inner * @sin(a2) };
        pushTri(out, idx, o1, inner2, o2, .{ 0, 1, 0 }, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
        pushTri(out, idx, o1, inner1, inner2, .{ 0, 1, 0 }, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
    }
}

fn pushFlatQuad(out: []f32, idx: *usize, min_x: f32, min_z: f32, max_x: f32, max_z: f32, y: f32) void {
    const a = [3]f32{ min_x, y, min_z };
    const b = [3]f32{ max_x, y, min_z };
    const c0 = [3]f32{ max_x, y, max_z };
    const d = [3]f32{ min_x, y, max_z };
    pushTri(out, idx, a, c0, b, .{ 0, 1, 0 }, .{ 0, 0 }, .{ 1, 1 }, .{ 1, 0 });
    pushTri(out, idx, a, d, c0, .{ 0, 1, 0 }, .{ 0, 0 }, .{ 0, 1 }, .{ 1, 1 });
}

pub fn buildBrushDecal(comptime segments: usize) [segments * 3 * 8]f32 {
    var out: [segments * 3 * 8]f32 = undefined;
    var idx: usize = 0;
    pushFlatDisc(segments, out[0..], &idx, 0.5, 0);
    return out;
}

pub fn buildBrushRings(comptime segments: usize) [(segments * 3 * 6 + 12) * 8]f32 {
    var out: [(segments * 3 * 6 + 12) * 8]f32 = undefined;
    var idx: usize = 0;
    pushFlatRingBand(segments, out[0..], &idx, 0.485, 0.5, 0);
    pushFlatRingBand(segments, out[0..], &idx, 0.32, 0.335, 0);
    pushFlatRingBand(segments, out[0..], &idx, 0.14, 0.155, 0);
    pushFlatQuad(out[0..], &idx, -0.5, -0.01, 0.5, 0.01, 0);
    pushFlatQuad(out[0..], &idx, -0.01, -0.5, 0.01, 0.5, 0);
    return out;
}

pub fn buildBrushHandles(comptime segments: usize) [(segments * 2 * 6 + segments * 3 + 4 * 6) * 8]f32 {
    var out: [(segments * 2 * 6 + segments * 3 + 4 * 6) * 8]f32 = undefined;
    var idx: usize = 0;
    pushFlatRingBand(segments, out[0..], &idx, 0.47, 0.5, 0);
    pushFlatRingBand(segments, out[0..], &idx, 0.25, 0.27, 0);
    pushFlatDisc(segments, out[0..], &idx, 0.045, 0);
    const h: f32 = 0.055;
    pushFlatQuad(out[0..], &idx, -h, 0.5 - h, h, 0.5 + h, 0);
    pushFlatQuad(out[0..], &idx, -h, -0.5 - h, h, -0.5 + h, 0);
    pushFlatQuad(out[0..], &idx, 0.5 - h, -h, 0.5 + h, h, 0);
    pushFlatQuad(out[0..], &idx, -0.5 - h, -h, -0.5 + h, h, 0);
    return out;
}

pub fn buildBrushCone(comptime segments: usize) [segments * 3 * 8]f32 {
    var out: [segments * 3 * 8]f32 = undefined;
    var idx: usize = 0;
    const top = [3]f32{ 0, 0.5, 0 };
    var j: usize = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const p1 = [3]f32{ 0.5 * @cos(a1), 0, 0.5 * @sin(a1) };
        const p2 = [3]f32{ 0.5 * @cos(a2), 0, 0.5 * @sin(a2) };
        const mid = (a1 + a2) * 0.5;
        const n = normalize3(@cos(mid), 0.7, @sin(mid));
        pushTri(out[0..], &idx, p1, top, p2, n, .{ 0, 1 }, .{ 0.5, 0 }, .{ 1, 1 });
    }
    return out;
}

pub fn buildBrushDome(comptime segments: usize, comptime rings: usize) [segments * rings * 6 * 8]f32 {
    var out: [segments * rings * 6 * 8]f32 = undefined;
    var idx: usize = 0;
    var i: usize = 0;
    while (i < rings) : (i += 1) {
        const t1 = (std.math.pi * 0.5) * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(rings));
        const t2 = (std.math.pi * 0.5) * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(rings));
        var j: usize = 0;
        while (j < segments) : (j += 1) {
            const p1 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
            const p2 = 2.0 * std.math.pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
            const a = spherePos(0.5, t1, p1);
            const b = spherePos(0.5, t1, p2);
            const c0 = spherePos(0.5, t2, p2);
            const d = spherePos(0.5, t2, p1);
            const na = sphereNormal(t1, p1);
            const nb = sphereNormal(t1, p2);
            const nc = sphereNormal(t2, p2);
            const nd = sphereNormal(t2, p1);
            pushTriSmooth(out[0..], &idx, a, c0, d, na, nc, nd, sphereUv(na), sphereUv(nc), sphereUv(nd));
            pushTriSmooth(out[0..], &idx, a, b, c0, na, nb, nc, sphereUv(na), sphereUv(nb), sphereUv(nc));
        }
    }
    return out;
}
