//! procgen.zig — Procedural geometry generation for the 3D pipeline
//!
//! Generates vertex buffers for terrain, trees, cones, and torus shapes.
//! Uses math.zig for Perlin noise (terrain) and vec3 ops (tree skeleton).
//! Output format matches 3d.zig Vertex: position(3) + normal(3) + uv(2).
//!
//! Inspired by samhattangady/easel (Penn & Weber parametric trees,
//! Perlin noise terrain, cross-section branch geometry).

const std = @import("std");
const math = @import("../math/root.zig");

// Must match 3d.zig Vertex layout exactly
pub const Vertex = extern struct {
    px: f32, py: f32, pz: f32,
    nx: f32, ny: f32, nz: f32,
    u: f32, v: f32,
};

pub const MAX_VERTS = 65536;
pub var geo_buf: [MAX_VERTS]Vertex = undefined;

fn addVert(buf: []Vertex, idx: *usize, px: f32, py: f32, pz: f32, nx: f32, ny: f32, nz: f32, u: f32, v: f32) void {
    if (idx.* >= buf.len) return;
    buf[idx.*] = .{ .px = px, .py = py, .pz = pz, .nx = nx, .ny = ny, .nz = nz, .u = u, .v = v };
    idx.* += 1;
}

fn addTri(buf: []Vertex, idx: *usize, v0: Vertex, v1: Vertex, v2: Vertex) void {
    if (idx.* + 3 > buf.len) return;
    buf[idx.*] = v0; idx.* += 1;
    buf[idx.*] = v1; idx.* += 1;
    buf[idx.*] = v2; idx.* += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Cone
// ════════════════════════════════════════════════════════════════════════

pub fn generateCone(radius: f32, height: f32, segments: u32) u32 {
    var idx: usize = 0;
    const pi = std.math.pi;
    const hy = height;
    var j: u32 = 0;
    while (j < segments) : (j += 1) {
        const a1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);
        if (idx + 6 > MAX_VERTS) break;
        // Side triangle (apex at top)
        const slope = radius / math.length2(radius, height);
        const ny = slope;
        const nscale = @sqrt(1.0 - ny * ny);
        addVert(&geo_buf, &idx, 0, hy, 0, (c1 + c2) * 0.5 * nscale, ny, (s1 + s2) * 0.5 * nscale, 0.5, 0);
        addVert(&geo_buf, &idx, radius * c1, 0, radius * s1, c1 * nscale, ny, s1 * nscale, 0, 1);
        addVert(&geo_buf, &idx, radius * c2, 0, radius * s2, c2 * nscale, ny, s2 * nscale, 1, 1);
        // Base triangle
        addVert(&geo_buf, &idx, 0, 0, 0, 0, -1, 0, 0.5, 0.5);
        addVert(&geo_buf, &idx, radius * c2, 0, radius * s2, 0, -1, 0, c2 * 0.5 + 0.5, s2 * 0.5 + 0.5);
        addVert(&geo_buf, &idx, radius * c1, 0, radius * s1, 0, -1, 0, c1 * 0.5 + 0.5, s1 * 0.5 + 0.5);
    }
    return @intCast(idx);
}

// ════════════════════════════════════════════════════════════════════════
// Torus
// ════════════════════════════════════════════════════════════════════════

pub fn generateTorus(major_radius: f32, minor_radius: f32, segments: u32, rings: u32) u32 {
    var idx: usize = 0;
    const pi = std.math.pi;
    var i: u32 = 0;
    while (i < rings) : (i += 1) {
        const t1 = 2 * pi * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(rings));
        const t2 = 2 * pi * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(rings));
        var j: u32 = 0;
        while (j < segments) : (j += 1) {
            if (idx + 6 > MAX_VERTS) return @intCast(idx);
            const p1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
            const p2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));

            const pt = struct {
                fn f(R: f32, r: f32, theta: f32, phi: f32) [3]f32 {
                    const ct = @cos(theta);
                    const st = @sin(theta);
                    const cp = @cos(phi);
                    const sp = @sin(phi);
                    return .{ (R + r * cp) * ct, r * sp, (R + r * cp) * st };
                }
                fn n(theta: f32, phi: f32) [3]f32 {
                    const ct = @cos(theta);
                    const st = @sin(theta);
                    const cp = @cos(phi);
                    const sp = @sin(phi);
                    return .{ cp * ct, sp, cp * st };
                }
            };

            const a = pt.f(major_radius, minor_radius, t1, p1);
            const b = pt.f(major_radius, minor_radius, t1, p2);
            const cc = pt.f(major_radius, minor_radius, t2, p2);
            const d = pt.f(major_radius, minor_radius, t2, p1);
            const na = pt.n(t1, p1);
            const nb = pt.n(t1, p2);
            const nc = pt.n(t2, p2);
            const nd = pt.n(t2, p1);

            // Tri 1: a, d, cc
            addVert(&geo_buf, &idx, a[0], a[1], a[2], na[0], na[1], na[2], 0, 0);
            addVert(&geo_buf, &idx, d[0], d[1], d[2], nd[0], nd[1], nd[2], 0, 1);
            addVert(&geo_buf, &idx, cc[0], cc[1], cc[2], nc[0], nc[1], nc[2], 1, 1);
            // Tri 2: a, cc, b
            addVert(&geo_buf, &idx, a[0], a[1], a[2], na[0], na[1], na[2], 0, 0);
            addVert(&geo_buf, &idx, cc[0], cc[1], cc[2], nc[0], nc[1], nc[2], 1, 1);
            addVert(&geo_buf, &idx, b[0], b[1], b[2], nb[0], nb[1], nb[2], 1, 0);
        }
    }
    return @intCast(idx);
}

// ════════════════════════════════════════════════════════════════════════
// Terrain (Perlin noise heightmap)
// ════════════════════════════════════════════════════════════════════════

/// Heightfield data for physics collider sharing
pub var terrain_heights: [128 * 128]f32 = undefined;
pub var terrain_width: u32 = 0;
pub var terrain_depth: u32 = 0;
pub var terrain_min_h: f32 = 0;
pub var terrain_max_h: f32 = 0;

/// Sample terrain height at fractional grid coords using fbm
fn sampleHeight(fx: f32, fz: f32, oct: u32, pers: f32, seed: f32, amplitude: f32) f32 {
    return math.fbm2d(fx, fz, oct, pers, 2.0, seed) * amplitude;
}

/// Compute smooth per-vertex normal via central differences on the heightfield
fn terrainNormal(gx: f32, gz: f32, freq: f32, oct: u32, pers: f32, seed: f32, amp: f32, step: f32) [3]f32 {
    // Sample height at neighboring grid positions (±0.5 cell in grid space)
    const hL = sampleHeight((gx - 0.5) * freq, gz * freq, oct, pers, seed, amp);
    const hR = sampleHeight((gx + 0.5) * freq, gz * freq, oct, pers, seed, amp);
    const hD = sampleHeight(gx * freq, (gz - 0.5) * freq, oct, pers, seed, amp);
    const hU = sampleHeight(gx * freq, (gz + 0.5) * freq, oct, pers, seed, amp);
    // Gradient → normal: scale by world step size for correct steepness
    const dhdx = (hR - hL) / step;
    const dhdz = (hU - hD) / step;
    return normalize3(.{ -dhdx, 1.0, -dhdz });
}

pub fn generateTerrain(
    size_x: f32, size_z: f32,
    subdivisions: u32,
    amplitude: f32,
    seed: f32,
    octaves: u32,
    roughness: f32,
) u32 {
    var idx: usize = 0;
    const subs = @min(subdivisions, 127); // cap for height buffer
    const fsubs: f32 = @floatFromInt(subs);
    const step_x = size_x / fsubs;
    const step_z = size_z / fsubs;
    const half_x = size_x * 0.5;
    const half_z = size_z * 0.5;
    const oct = @max(1, octaves);
    const pers = @max(0.01, @min(roughness, 0.99));
    // Scale noise coords so terrain looks like gentle rolling hills, not spikes
    const freq_scale: f32 = 1.0 / fsubs * 4.0;

    // Generate heights and track min/max for physics
    terrain_width = subs + 1;
    terrain_depth = subs + 1;
    terrain_min_h = std.math.floatMax(f32);
    terrain_max_h = -std.math.floatMax(f32);

    var gz: u32 = 0;
    while (gz <= subs) : (gz += 1) {
        var gx: u32 = 0;
        while (gx <= subs) : (gx += 1) {
            const fx = @as(f32, @floatFromInt(gx)) * freq_scale;
            const fz = @as(f32, @floatFromInt(gz)) * freq_scale;
            const h = sampleHeight(fx, fz, oct, pers, seed, amplitude);
            const hi = gz * (subs + 1) + gx;
            if (hi < terrain_heights.len) {
                terrain_heights[hi] = h;
                if (h < terrain_min_h) terrain_min_h = h;
                if (h > terrain_max_h) terrain_max_h = h;
            }
        }
    }

    // Generate triangles with per-vertex smooth normals
    gz = 0;
    while (gz < subs) : (gz += 1) {
        var gx: u32 = 0;
        while (gx < subs) : (gx += 1) {
            if (idx + 6 > MAX_VERTS) return @intCast(idx);

            const x0 = @as(f32, @floatFromInt(gx)) * step_x - half_x;
            const x1 = @as(f32, @floatFromInt(gx + 1)) * step_x - half_x;
            const z0 = @as(f32, @floatFromInt(gz)) * step_z - half_z;
            const z1 = @as(f32, @floatFromInt(gz + 1)) * step_z - half_z;

            const hi00 = gz * (subs + 1) + gx;
            const hi10 = gz * (subs + 1) + gx + 1;
            const hi01 = (gz + 1) * (subs + 1) + gx;
            const hi11 = (gz + 1) * (subs + 1) + gx + 1;

            const y00 = if (hi00 < terrain_heights.len) terrain_heights[hi00] else 0;
            const y10 = if (hi10 < terrain_heights.len) terrain_heights[hi10] else 0;
            const y01 = if (hi01 < terrain_heights.len) terrain_heights[hi01] else 0;
            const y11 = if (hi11 < terrain_heights.len) terrain_heights[hi11] else 0;

            // Per-vertex smooth normals via central difference on the noise
            const fgx0: f32 = @floatFromInt(gx);
            const fgx1: f32 = @floatFromInt(gx + 1);
            const fgz0: f32 = @floatFromInt(gz);
            const fgz1: f32 = @floatFromInt(gz + 1);
            const n00 = terrainNormal(fgx0, fgz0, freq_scale, oct, pers, seed, amplitude, step_x);
            const n10 = terrainNormal(fgx1, fgz0, freq_scale, oct, pers, seed, amplitude, step_x);
            const n01 = terrainNormal(fgx0, fgz1, freq_scale, oct, pers, seed, amplitude, step_x);
            const n11 = terrainNormal(fgx1, fgz1, freq_scale, oct, pers, seed, amplitude, step_x);

            const uvx0 = @as(f32, @floatFromInt(gx)) / fsubs;
            const uvx1 = @as(f32, @floatFromInt(gx + 1)) / fsubs;
            const uvz0 = @as(f32, @floatFromInt(gz)) / fsubs;
            const uvz1 = @as(f32, @floatFromInt(gz + 1)) / fsubs;

            // Tri 1: (0,0), (1,0), (0,1) — CCW winding for upward-facing
            addVert(&geo_buf, &idx, x0, y00, z0, n00[0], n00[1], n00[2], uvx0, uvz0);
            addVert(&geo_buf, &idx, x1, y10, z0, n10[0], n10[1], n10[2], uvx1, uvz0);
            addVert(&geo_buf, &idx, x0, y01, z1, n01[0], n01[1], n01[2], uvx0, uvz1);
            // Tri 2: (1,0), (1,1), (0,1)
            addVert(&geo_buf, &idx, x1, y10, z0, n10[0], n10[1], n10[2], uvx1, uvz0);
            addVert(&geo_buf, &idx, x1, y11, z1, n11[0], n11[1], n11[2], uvx1, uvz1);
            addVert(&geo_buf, &idx, x0, y01, z1, n01[0], n01[1], n01[2], uvx0, uvz1);
        }
    }
    return @intCast(idx);
}

fn normalize3(v: [3]f32) [3]f32 {
    const len = math.length3(v[0], v[1], v[2]);
    if (len < 0.0001) return .{ 0, 1, 0 };
    return .{ v[0] / len, v[1] / len, v[2] / len };
}

// ════════════════════════════════════════════════════════════════════════
// Tapered cylinder (branch segment — key building block from easel)
// ════════════════════════════════════════════════════════════════════════

pub fn generateTaperedCylinder(
    base_radius: f32, tip_radius: f32,
    height: f32, segments: u32,
) u32 {
    var idx: usize = 0;
    const pi = std.math.pi;
    const hy = height;
    var j: u32 = 0;
    while (j < segments) : (j += 1) {
        if (idx + 6 > MAX_VERTS) break;
        const a1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segments));
        const a2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segments));
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);
        // Side quad (two tris)
        const slope = (base_radius - tip_radius) / height;
        const ny = slope / @sqrt(1.0 + slope * slope);
        const nscale = @sqrt(1.0 - ny * ny);
        addVert(&geo_buf, &idx, base_radius * c1, 0, base_radius * s1, c1 * nscale, ny, s1 * nscale, 0, 0);
        addVert(&geo_buf, &idx, base_radius * c2, 0, base_radius * s2, c2 * nscale, ny, s2 * nscale, 1, 0);
        addVert(&geo_buf, &idx, tip_radius * c2, hy, tip_radius * s2, c2 * nscale, ny, s2 * nscale, 1, 1);

        addVert(&geo_buf, &idx, base_radius * c1, 0, base_radius * s1, c1 * nscale, ny, s1 * nscale, 0, 0);
        addVert(&geo_buf, &idx, tip_radius * c2, hy, tip_radius * s2, c2 * nscale, ny, s2 * nscale, 1, 1);
        addVert(&geo_buf, &idx, tip_radius * c1, hy, tip_radius * s1, c1 * nscale, ny, s1 * nscale, 0, 1);
    }
    return @intCast(idx);
}

// ════════════════════════════════════════════════════════════════════════
// Tree (simplified Penn & Weber — trunk + branching levels)
//
// Ported from easel's es_trees.c. Simplified to recursive branch segments
// using tapered cylinders with noise-based variation.
// ════════════════════════════════════════════════════════════════════════

const TreeParams = struct {
    seed: f32 = 42,
    levels: u32 = 3,
    trunk_length: f32 = 4.0,
    trunk_radius: f32 = 0.3,
    branch_angle: f32 = 35.0,
    branch_ratio: f32 = 0.7, // child length = parent * ratio
    radius_ratio: f32 = 0.6, // child radius = parent * ratio
    segments: u32 = 8,
    branches_per_level: u32 = 4,
};

pub fn generateTree(
    seed: f32,
    levels: u32,
    trunk_length: f32,
    trunk_radius: f32,
    branch_angle: f32,
) u32 {
    var idx: usize = 0;
    const params = TreeParams{
        .seed = seed,
        .levels = @min(levels, 4),
        .trunk_length = trunk_length,
        .trunk_radius = trunk_radius,
        .branch_angle = branch_angle,
    };
    generateBranch(&params, &idx, .{ 0, 0, 0 }, .{ 0, 1, 0 }, trunk_length, trunk_radius, 0);
    return @intCast(idx);
}

fn generateBranch(
    params: *const TreeParams,
    idx: *usize,
    base_pos: [3]f32,
    direction: [3]f32,
    length: f32,
    radius: f32,
    depth: u32,
) void {
    if (depth > params.levels or length < 0.05 or radius < 0.01) return;
    if (idx.* + 100 > MAX_VERTS) return;

    const segs = @max(3, params.segments);
    const tip_radius = radius * params.radius_ratio;
    const pi = std.math.pi;

    // Build local coordinate frame from direction
    const up = direction;
    var right: [3]f32 = undefined;
    if (@abs(up[1]) > 0.9) {
        right = normalize3(.{ 1, 0, 0 });
    } else {
        right = normalize3(cross3(.{ 0, 1, 0 }, up));
    }
    const fwd = normalize3(cross3(up, right));

    // Generate the cylinder along direction
    var j: u32 = 0;
    while (j < segs) : (j += 1) {
        if (idx.* + 6 > MAX_VERTS) return;
        const a1 = 2 * pi * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(segs));
        const a2 = 2 * pi * @as(f32, @floatFromInt(j + 1)) / @as(f32, @floatFromInt(segs));
        const c1 = @cos(a1);
        const s1 = @sin(a1);
        const c2 = @cos(a2);
        const s2 = @sin(a2);

        // Base ring point = base_pos + radius * (right * cos + fwd * sin)
        const bx1 = base_pos[0] + radius * (right[0] * c1 + fwd[0] * s1);
        const by1 = base_pos[1] + radius * (right[1] * c1 + fwd[1] * s1);
        const bz1 = base_pos[2] + radius * (right[2] * c1 + fwd[2] * s1);
        const bx2 = base_pos[0] + radius * (right[0] * c2 + fwd[0] * s2);
        const by2 = base_pos[1] + radius * (right[1] * c2 + fwd[1] * s2);
        const bz2 = base_pos[2] + radius * (right[2] * c2 + fwd[2] * s2);

        // Tip ring point = base_pos + direction * length + tip_radius * (...)
        const tx = base_pos[0] + up[0] * length;
        const ty = base_pos[1] + up[1] * length;
        const tz = base_pos[2] + up[2] * length;
        const tx1 = tx + tip_radius * (right[0] * c1 + fwd[0] * s1);
        const ty1 = ty + tip_radius * (right[1] * c1 + fwd[1] * s1);
        const tz1 = tz + tip_radius * (right[2] * c1 + fwd[2] * s1);
        const tx2 = tx + tip_radius * (right[0] * c2 + fwd[0] * s2);
        const ty2 = ty + tip_radius * (right[1] * c2 + fwd[1] * s2);
        const tz2 = tz + tip_radius * (right[2] * c2 + fwd[2] * s2);

        // Normal = normalize(ring_point - center_at_that_height)
        const n1 = normalize3(.{ right[0] * c1 + fwd[0] * s1, right[1] * c1 + fwd[1] * s1, right[2] * c1 + fwd[2] * s1 });
        const n2 = normalize3(.{ right[0] * c2 + fwd[0] * s2, right[1] * c2 + fwd[1] * s2, right[2] * c2 + fwd[2] * s2 });

        // Tri 1
        addVert(&geo_buf, idx, bx1, by1, bz1, n1[0], n1[1], n1[2], 0, 0);
        addVert(&geo_buf, idx, bx2, by2, bz2, n2[0], n2[1], n2[2], 1, 0);
        addVert(&geo_buf, idx, tx2, ty2, tz2, n2[0], n2[1], n2[2], 1, 1);
        // Tri 2
        addVert(&geo_buf, idx, bx1, by1, bz1, n1[0], n1[1], n1[2], 0, 0);
        addVert(&geo_buf, idx, tx2, ty2, tz2, n2[0], n2[1], n2[2], 1, 1);
        addVert(&geo_buf, idx, tx1, ty1, tz1, n1[0], n1[1], n1[2], 0, 1);
    }

    // Branch tip position
    const tip = [3]f32{
        base_pos[0] + up[0] * length,
        base_pos[1] + up[1] * length,
        base_pos[2] + up[2] * length,
    };

    // Recurse: spawn child branches, or add leaf clusters at terminal branches
    if (depth < params.levels) {
        const n_branches = params.branches_per_level;
        var bi: u32 = 0;
        while (bi < n_branches) : (bi += 1) {
            // Vary angle and rotation using noise
            const noise_seed = params.seed + @as(f32, @floatFromInt(depth * 100 + bi * 37));
            const angle_var = math.noise2d(@as(f32, @floatFromInt(bi)), noise_seed, 0) * 10.0;
            const rot_angle = (2 * pi * @as(f32, @floatFromInt(bi)) / @as(f32, @floatFromInt(n_branches))) +
                math.noise2d(noise_seed, @as(f32, @floatFromInt(bi)), 0) * 0.5;

            const branch_ang = (params.branch_angle + angle_var) * pi / 180.0;
            const child_length = length * params.branch_ratio;
            const child_radius = radius * params.radius_ratio;

            // Rotate direction: tilt by branch_angle, spin by rot_angle
            const cos_b = @cos(branch_ang);
            const sin_b = @sin(branch_ang);
            const cos_r = @cos(rot_angle);
            const sin_r = @sin(rot_angle);

            const new_dir = normalize3(.{
                up[0] * cos_b + (right[0] * cos_r + fwd[0] * sin_r) * sin_b,
                up[1] * cos_b + (right[1] * cos_r + fwd[1] * sin_r) * sin_b,
                up[2] * cos_b + (right[2] * cos_r + fwd[2] * sin_r) * sin_b,
            });

            // Spawn branch at 60-90% up the parent
            const spawn_t = 0.6 + 0.3 * @as(f32, @floatFromInt(bi)) / @as(f32, @floatFromInt(@max(1, n_branches - 1)));
            const spawn_pos = [3]f32{
                base_pos[0] + up[0] * length * spawn_t,
                base_pos[1] + up[1] * length * spawn_t,
                base_pos[2] + up[2] * length * spawn_t,
            };

            generateBranch(params, idx, spawn_pos, new_dir, child_length, child_radius, depth + 1);
        }
    } else {
        // Terminal branch — add a leaf cluster (low-poly icosphere-ish blob)
        generateLeafCluster(idx, tip, length * 0.8, params.seed + @as(f32, @floatFromInt(depth * 7)));
    }
}

/// Generate a rough leaf cluster — 8 triangles forming a spiky blob around center
fn generateLeafCluster(idx: *usize, center: [3]f32, size: f32, seed: f32) void {
    if (idx.* + 24 > MAX_VERTS) return;
    const pi = std.math.pi;
    // Generate 8 triangles radiating from center with noise displacement
    var i: u32 = 0;
    while (i < 8) : (i += 1) {
        if (idx.* + 3 > MAX_VERTS) return;
        const fi: f32 = @floatFromInt(i);
        const a1 = 2 * pi * fi / 8.0;
        const a2 = 2 * pi * (fi + 1) / 8.0;
        // Vary height with noise for organic shape
        const h_var = 0.5 + math.noise2d(fi, seed, 0) * 0.5;
        const r = size * (0.6 + math.noise2d(seed, fi * 3.7, 0) * 0.4);
        const p1 = [3]f32{
            center[0] + @cos(a1) * r,
            center[1] + h_var * size * 0.3,
            center[2] + @sin(a1) * r,
        };
        const p2 = [3]f32{
            center[0] + @cos(a2) * r,
            center[1] + h_var * size * 0.3,
            center[2] + @sin(a2) * r,
        };
        const top = [3]f32{
            center[0] + @cos((a1 + a2) * 0.5) * r * 0.3,
            center[1] + size * (0.5 + h_var * 0.5),
            center[2] + @sin((a1 + a2) * 0.5) * r * 0.3,
        };
        // Compute face normal
        const e1 = [3]f32{ p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2] };
        const e2 = [3]f32{ top[0] - p1[0], top[1] - p1[1], top[2] - p1[2] };
        const n = normalize3(cross3(e1, e2));
        addVert(&geo_buf, idx, p1[0], p1[1], p1[2], n[0], n[1], n[2], 0, 0);
        addVert(&geo_buf, idx, p2[0], p2[1], p2[2], n[0], n[1], n[2], 1, 0);
        addVert(&geo_buf, idx, top[0], top[1], top[2], n[0], n[1], n[2], 0.5, 1);
    }
}

fn cross3(a: [3]f32, b: [3]f32) [3]f32 {
    return .{
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    };
}
