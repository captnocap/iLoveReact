//! Shared, baked flora geometry for painted non-palm trees.
//!
//! The user's plane→cylinder sketch is implemented literally for conifers: one
//! tapered branch plane is repeated around the trunk, tier by tier, so the cards
//! wrap 360 degrees without any per-frame mesh generation. Deciduous trees reuse
//! the earlier PathTube idea as tapered branch tubes with broad crossed crown
//! cards. A complete tree is one immutable mesh plus one 24-byte SlimInstance.

const std = @import("std");
const foliage = @import("foliage.zig");
pub const recipe = foliage;

pub const FLOATS_PER_VERTEX: usize = 8; // position3, normal3, uv2
pub const MAX_TREE_VERTICES: usize = 768;

pub const UV_FEATHERED: f32 = 0;
pub const UV_BROAD_LEAF: f32 = 10;
pub const UV_CONIFER: f32 = 20;
pub const UV_CROWN: f32 = 30;
pub const UV_BARK: f32 = 40;

pub const GEOMETRY_KEYS: [foliage.TREE_SPECIES_COUNT][]const u8 = .{
    "flora-tree-pine",
    "flora-tree-maple",
    "flora-tree-oak",
    "flora-tree-cedar",
    "flora-tree-spruce",
};

pub fn geometryKey(species: foliage.TreeSpecies) []const u8 {
    return GEOMETRY_KEYS[@intFromEnum(species)];
}

pub const TreeMesh = struct {
    values: [MAX_TREE_VERTICES * FLOATS_PER_VERTEX]f32 = @splat(0),
    vertex_count: u32 = 0,

    pub fn floats(self: *TreeMesh) []f32 {
        return self.values[0 .. @as(usize, self.vertex_count) * FLOATS_PER_VERTEX];
    }

    pub fn constFloats(self: *const TreeMesh) []const f32 {
        return self.values[0 .. @as(usize, self.vertex_count) * FLOATS_PER_VERTEX];
    }
};

const Vec3 = [3]f32;
const Vec2 = [2]f32;
const TAU: f32 = std.math.pi * 2.0;

fn add(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}

fn sub(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}

fn mul(a: Vec3, s: f32) Vec3 {
    return .{ a[0] * s, a[1] * s, a[2] * s };
}

fn cross(a: Vec3, b: Vec3) Vec3 {
    return .{
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    };
}

fn length(a: Vec3) f32 {
    return @sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

fn normalize(a: Vec3) Vec3 {
    const len = length(a);
    if (len <= 0.000001) return .{ 0, 1, 0 };
    return mul(a, 1.0 / len);
}

fn pushVertex(mesh: *TreeMesh, p: Vec3, n: Vec3, uv: Vec2) void {
    std.debug.assert(mesh.vertex_count < MAX_TREE_VERTICES);
    const at = @as(usize, mesh.vertex_count) * FLOATS_PER_VERTEX;
    mesh.values[at + 0] = p[0];
    mesh.values[at + 1] = p[1];
    mesh.values[at + 2] = p[2];
    mesh.values[at + 3] = n[0];
    mesh.values[at + 4] = n[1];
    mesh.values[at + 5] = n[2];
    mesh.values[at + 6] = uv[0];
    mesh.values[at + 7] = uv[1];
    mesh.vertex_count += 1;
}

fn pushTri(mesh: *TreeMesh, a: Vec3, b: Vec3, c: Vec3, n: Vec3, uva: Vec2, uvb: Vec2, uvc: Vec2) void {
    pushVertex(mesh, a, n, uva);
    pushVertex(mesh, b, n, uvb);
    pushVertex(mesh, c, n, uvc);
}

fn pushTriSmooth(mesh: *TreeMesh, a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3, nc: Vec3, uva: Vec2, uvb: Vec2, uvc: Vec2) void {
    pushVertex(mesh, a, na, uva);
    pushVertex(mesh, b, nb, uvb);
    pushVertex(mesh, c, nc, uvc);
}

fn addDoubleQuad(mesh: *TreeMesh, bl: Vec3, br: Vec3, tr: Vec3, tl: Vec3, uv_band: f32) void {
    const n = normalize(cross(sub(br, bl), sub(tl, bl)));
    const back = mul(n, -1);
    const uv0 = [2]f32{ uv_band, 0 };
    const uv1 = [2]f32{ uv_band + 1, 0 };
    const uv2 = [2]f32{ uv_band + 1, 1 };
    const uv3 = [2]f32{ uv_band, 1 };
    pushTri(mesh, bl, br, tr, n, uv0, uv1, uv2);
    pushTri(mesh, bl, tr, tl, n, uv0, uv2, uv3);
    pushTri(mesh, bl, tr, br, back, uv0, uv2, uv1);
    pushTri(mesh, bl, tl, tr, back, uv0, uv3, uv2);
}

/// The PathTube reference reduced to its strict native boundary: sweep one
/// tapered ring pair along a segment. Branching is composition of these pieces.
fn addTaperedTube(mesh: *TreeMesh, start: Vec3, end: Vec3, base_radius: f32, tip_radius: f32, sides: usize) void {
    const direction = normalize(sub(end, start));
    const reference: Vec3 = if (@abs(direction[1]) < 0.92) .{ 0, 1, 0 } else .{ 1, 0, 0 };
    const axis_a = normalize(cross(direction, reference));
    const axis_b = normalize(cross(direction, axis_a));
    var side: usize = 0;
    while (side < sides) : (side += 1) {
        const t0 = @as(f32, @floatFromInt(side)) / @as(f32, @floatFromInt(sides));
        const t1 = @as(f32, @floatFromInt(side + 1)) / @as(f32, @floatFromInt(sides));
        const radial0 = add(mul(axis_a, @cos(t0 * TAU)), mul(axis_b, @sin(t0 * TAU)));
        const radial1 = add(mul(axis_a, @cos(t1 * TAU)), mul(axis_b, @sin(t1 * TAU)));
        const a = add(start, mul(radial0, base_radius));
        const b = add(start, mul(radial1, base_radius));
        const c = add(end, mul(radial1, tip_radius));
        const d = add(end, mul(radial0, tip_radius));
        const uv0 = [2]f32{ UV_BARK + t0, 0 };
        const uv1 = [2]f32{ UV_BARK + t1, 0 };
        const uv2 = [2]f32{ UV_BARK + t1, 1 };
        const uv3 = [2]f32{ UV_BARK + t0, 1 };
        pushTriSmooth(mesh, a, b, c, radial0, radial1, radial1, uv0, uv1, uv2);
        pushTriSmooth(mesh, a, c, d, radial0, radial1, radial0, uv0, uv2, uv3);
    }
}

const ConiferShape = struct {
    tiers: usize,
    arms: usize,
    canopy_start: f32,
    canopy_end: f32,
    base_reach: f32,
    tip_reach: f32,
    profile_power: f32,
    droop: f32,
    trunk_base: f32,
    trunk_tip: f32,
};

fn coniferShape(species: foliage.TreeSpecies) ConiferShape {
    return switch (species) {
        .pine => .{ .tiers = 7, .arms = 7, .canopy_start = 0.24, .canopy_end = 0.94, .base_reach = 0.92, .tip_reach = 0.10, .profile_power = 0.82, .droop = 0.035, .trunk_base = 0.072, .trunk_tip = 0.025 },
        .cedar => .{ .tiers = 9, .arms = 6, .canopy_start = 0.18, .canopy_end = 0.96, .base_reach = 0.78, .tip_reach = 0.08, .profile_power = 0.66, .droop = 0.055, .trunk_base = 0.078, .trunk_tip = 0.022 },
        .spruce => .{ .tiers = 8, .arms = 7, .canopy_start = 0.16, .canopy_end = 0.96, .base_reach = 1.0, .tip_reach = 0.06, .profile_power = 0.95, .droop = 0.075, .trunk_base = 0.07, .trunk_tip = 0.02 },
        else => unreachable,
    };
}

fn addConifer(mesh: *TreeMesh, species: foliage.TreeSpecies) void {
    const cfg = coniferShape(species);
    addTaperedTube(mesh, .{ 0, 0, 0 }, .{ 0, 0.985, 0 }, cfg.trunk_base, cfg.trunk_tip, 8);
    var tier: usize = 0;
    while (tier < cfg.tiers) : (tier += 1) {
        const t = if (cfg.tiers > 1)
            @as(f32, @floatFromInt(tier)) / @as(f32, @floatFromInt(cfg.tiers - 1))
        else
            0;
        const y = cfg.canopy_start + (cfg.canopy_end - cfg.canopy_start) * t;
        const profile = std.math.pow(f32, 1.0 - t, cfg.profile_power);
        const tier_wobble = 0.94 + 0.06 * @sin(@as(f32, @floatFromInt(tier)) * 2.17 + @as(f32, @floatFromInt(@intFromEnum(species))));
        const reach = (cfg.tip_reach + (cfg.base_reach - cfg.tip_reach) * profile) * tier_wobble;
        var arm: usize = 0;
        while (arm < cfg.arms) : (arm += 1) {
            const stagger: f32 = if (tier % 2 == 0) 0 else 0.5;
            const angle = (@as(f32, @floatFromInt(arm)) + stagger) / @as(f32, @floatFromInt(cfg.arms)) * TAU;
            const radial = [3]f32{ @cos(angle), 0, @sin(angle) };
            const tangent = [3]f32{ -radial[2], 0, radial[0] };
            const root_center = add(mul(radial, cfg.trunk_tip * 1.6), .{ 0, y + 0.018, 0 });
            const tip_center = add(mul(radial, reach), .{ 0, y - cfg.droop * (1.1 - t), 0 });
            const root_half = @max(0.018, reach * 0.035);
            const tip_half = @max(0.04, reach * 0.22);
            const bl = sub(root_center, mul(tangent, root_half));
            const br = add(root_center, mul(tangent, root_half));
            const tr = add(tip_center, mul(tangent, tip_half));
            const tl = sub(tip_center, mul(tangent, tip_half));
            addDoubleQuad(mesh, bl, br, tr, tl, UV_CONIFER);
        }
    }
}

const DeciduousShape = struct {
    branches: usize,
    spread: f32,
    crown_center_y: f32,
    cluster_radius: f32,
    trunk_base: f32,
    trunk_tip: f32,
};

fn deciduousShape(species: foliage.TreeSpecies) DeciduousShape {
    return switch (species) {
        .maple => .{ .branches = 7, .spread = 0.52, .crown_center_y = 0.72, .cluster_radius = 0.31, .trunk_base = 0.075, .trunk_tip = 0.035 },
        .oak => .{ .branches = 8, .spread = 0.62, .crown_center_y = 0.68, .cluster_radius = 0.36, .trunk_base = 0.095, .trunk_tip = 0.045 },
        else => unreachable,
    };
}

fn addLeafCluster(mesh: *TreeMesh, center: Vec3, radius: f32, phase: f32) void {
    const cards: usize = 3;
    var card: usize = 0;
    while (card < cards) : (card += 1) {
        const angle = phase + @as(f32, @floatFromInt(card)) / @as(f32, @floatFromInt(cards)) * TAU;
        const right = [3]f32{ @cos(angle), 0, @sin(angle) };
        const lean = [3]f32{ -right[2] * radius * 0.12, 0, right[0] * radius * 0.12 };
        const lower = add(center, .{ 0, -radius * 0.68, 0 });
        const upper = add(add(center, .{ 0, radius, 0 }), lean);
        const bl = sub(lower, mul(right, radius));
        const br = add(lower, mul(right, radius));
        const tr = add(upper, mul(right, radius * 0.72));
        const tl = sub(upper, mul(right, radius * 0.72));
        addDoubleQuad(mesh, bl, br, tr, tl, UV_CROWN);
    }
}

fn addDeciduous(mesh: *TreeMesh, species: foliage.TreeSpecies) void {
    const cfg = deciduousShape(species);
    addTaperedTube(mesh, .{ 0, 0, 0 }, .{ 0, 0.72, 0 }, cfg.trunk_base, cfg.trunk_tip, 8);
    var branch: usize = 0;
    while (branch < cfg.branches) : (branch += 1) {
        const angle = @as(f32, @floatFromInt(branch)) / @as(f32, @floatFromInt(cfg.branches)) * TAU + @as(f32, @floatFromInt(branch % 2)) * 0.23;
        const radial = [3]f32{ @cos(angle), 0, @sin(angle) };
        const ring = @as(f32, @floatFromInt(branch % 3));
        const start_y = 0.34 + ring * 0.055;
        const end_y = cfg.crown_center_y + (@as(f32, @floatFromInt(branch % 4)) - 1.5) * 0.055;
        const reach = cfg.spread * (0.86 + 0.07 * ring);
        const start = .{ 0, start_y, 0 };
        const end = add(mul(radial, reach), .{ 0, end_y, 0 });
        addTaperedTube(mesh, start, end, cfg.trunk_tip * 0.72, cfg.trunk_tip * 0.18, 4);
        addLeafCluster(mesh, add(end, .{ 0, cfg.cluster_radius * 0.16, 0 }), cfg.cluster_radius, angle * 0.37);
    }
    addLeafCluster(mesh, .{ 0, cfg.crown_center_y + cfg.cluster_radius * 0.72, 0 }, cfg.cluster_radius * 1.08, 0.41);
}

pub fn buildTree(species: foliage.TreeSpecies) TreeMesh {
    var mesh: TreeMesh = .{};
    switch (species) {
        .pine, .cedar, .spruce => addConifer(&mesh, species),
        .maple, .oak => addDeciduous(&mesh, species),
    }
    return mesh;
}

/// Test/tool boundary that does not leak this module's private import identity.
/// Runtime code should use the typed buildTree entry point.
pub fn buildTreeByIndex(index: usize) ?TreeMesh {
    if (index >= foliage.TREE_SPECIES_COUNT) return null;
    return buildTree(@enumFromInt(index));
}

test "all tree meshes fit their fixed shared-geometry allocation" {
    for (0..foliage.TREE_SPECIES_COUNT) |i| {
        const species: foliage.TreeSpecies = @enumFromInt(i);
        const mesh = buildTree(species);
        try std.testing.expect(mesh.vertex_count > 0);
        try std.testing.expect(mesh.vertex_count <= MAX_TREE_VERTICES);
        try std.testing.expectEqual(@as(u32, 0), mesh.vertex_count % 3);
    }
}
