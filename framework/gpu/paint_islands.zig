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
//!   • box projection along the face's dominant normal axis (drop that coordinate,
//!     fixed (u,v) order so same-axis faces align), deterministic shelf packing
//!     (tallest first, near-square target) — same mesh, same layout, every time;
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

pub const Island = struct {
    /// The authored group this island carries (or NO_GROUP for a loose triangle's own island).
    group: u32,
    /// Packed rect in atlas texels.
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    /// Dominant projection axis: 0 = x, 1 = y, 2 = z; sign = which side the face looks.
    axis: u8,
    sign: i8,
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

fn projectAxis(nx: f32, ny: f32, nz: f32) u8 {
    const ax = @abs(nx);
    const ay = @abs(ny);
    const az = @abs(nz);
    if (ax >= ay and ax >= az) return 0;
    if (ay >= az) return 1;
    return 2;
}

/// Reference projectVert: drop the dominant coordinate, keep the other two in a fixed
/// (u,v) order so faces of the same axis align (editMesh.ts:1059).
fn projectVert(axis: u8, p: [3]f32) [2]f32 {
    return switch (axis) {
        0 => .{ p[2], p[1] }, // looking down ±X → (z, y)
        1 => .{ p[0], p[2] }, // looking down ±Y → (x, z)
        else => .{ p[0], p[1] }, // looking down ±Z → (x, y)
    };
}

const RawIsland = struct {
    group: u32,
    axis: u8,
    sign: i8,
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
                raws.append(alloc, .{ .group = g, .axis = 0, .sign = 1, .min_u = 0, .min_v = 0, .w_m = 0, .h_m = 0, .first_tri = f }) catch return null;
            }
            tri_island[f] = gop.value_ptr.*;
        } else {
            tri_island[f] = @intCast(raws.items.len);
            raws.append(alloc, .{ .group = NO_GROUP, .axis = 0, .sign = 1, .min_u = 0, .min_v = 0, .w_m = 0, .h_m = 0, .first_tri = f }) catch return null;
        }
    }

    // ── Per island: dominant axis from the area vector (sum of tri cross products),
    //    then projected 2D bounds in meters. Two passes keep it allocation-light. ──
    const n_islands: u32 = @intCast(raws.items.len);
    const area_vec = alloc.alloc([3]f32, n_islands) catch return null;
    defer alloc.free(area_vec);
    @memset(area_vec, .{ 0, 0, 0 });
    f = 0;
    while (f < fc) : (f += 1) {
        const base = f * 9;
        const a = [3]f32{ positions[base + 0], positions[base + 1], positions[base + 2] };
        const b = [3]f32{ positions[base + 3], positions[base + 4], positions[base + 5] };
        const c = [3]f32{ positions[base + 6], positions[base + 7], positions[base + 8] };
        const e1 = [3]f32{ b[0] - a[0], b[1] - a[1], b[2] - a[2] };
        const e2 = [3]f32{ c[0] - a[0], c[1] - a[1], c[2] - a[2] };
        const cx = e1[1] * e2[2] - e1[2] * e2[1];
        const cy = e1[2] * e2[0] - e1[0] * e2[2];
        const cz = e1[0] * e2[1] - e1[1] * e2[0];
        const av = &area_vec[tri_island[f]];
        av[0] += cx;
        av[1] += cy;
        av[2] += cz;
    }
    for (raws.items, 0..) |*r, i| {
        const av = area_vec[i];
        r.axis = projectAxis(av[0], av[1], av[2]);
        const comp = switch (r.axis) {
            0 => av[0],
            1 => av[1],
            else => av[2],
        };
        r.sign = if (comp < 0) -1 else 1;
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
            const base = f * 9 + k * 3;
            const uv = projectVert(r.axis, .{ positions[base + 0], positions[base + 1], positions[base + 2] });
            if (uv[0] < r.min_u) r.min_u = uv[0];
            if (uv[1] < r.min_v) r.min_v = uv[1];
            if (uv[0] > r.w_m) r.w_m = uv[0];
            if (uv[1] > r.h_m) r.h_m = uv[1];
        }
    }
    for (raws.items) |*r| {
        r.w_m = @max(0, r.w_m - r.min_u); // bounds → extent in meters
        r.h_m = @max(0, r.h_m - r.min_v);
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
            r.w = @max(1, @as(u32, @ceil(r.w_m * density)));
            r.h = @max(1, @as(u32, @ceil(r.h_m * density)));
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
        islands[i] = .{ .group = r.group, .x = r.x, .y = r.y, .w = r.w, .h = r.h, .axis = r.axis, .sign = r.sign, .min_u = r.min_u, .min_v = r.min_v };
    }
    const corner_uv = alloc.alloc(f32, @as(usize, fc) * 6) catch return null;
    f = 0;
    while (f < fc) : (f += 1) {
        const isl = islands[tri_island[f]];
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const base = f * 9 + k * 3;
            const uv = projectVert(isl.axis, .{ positions[base + 0], positions[base + 1], positions[base + 2] });
            // Meters → island texel, inset half a texel so edge samples stay inside
            // the island under linear filtering (the pad gutter handles the rest).
            const tw: f32 = @floatFromInt(isl.w);
            const th: f32 = @floatFromInt(isl.h);
            const lx = std.math.clamp((uv[0] - isl.min_u) * density, 0.5, @max(0.5, tw - 0.5));
            const ly = std.math.clamp((uv[1] - isl.min_v) * density, 0.5, @max(0.5, th - 0.5));
            corner_uv[(@as(usize, f) * 3 + k) * 2 + 0] = @as(f32, @floatFromInt(isl.x)) + lx;
            corner_uv[(@as(usize, f) * 3 + k) * 2 + 1] = @as(f32, @floatFromInt(isl.y)) + ly;
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

test "cube at 16 texels/m: 6 face islands, ~16x16 each, corners inside their island" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    var l = build(testing.allocator, soup[0..], groups[0..], 16, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 6), l.islands.len);
    try testing.expectEqual(@as(f32, 16), l.density); // nothing clamped
    for (l.islands) |isl| {
        // A 1m face at 16 texels/m → a 16×16 island.
        try testing.expectEqual(@as(u32, 16), isl.w);
        try testing.expectEqual(@as(u32, 16), isl.h);
    }
    // Every corner's texel lands inside its island rect (with the half-texel inset).
    var f: u32 = 0;
    while (f < 12) : (f += 1) {
        const isl = l.islands[l.tri_island[f]];
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const x = l.corner_uv[(@as(usize, f) * 3 + k) * 2 + 0];
            const y = l.corner_uv[(@as(usize, f) * 3 + k) * 2 + 1];
            try testing.expect(x >= @as(f32, @floatFromInt(isl.x)) and x <= @as(f32, @floatFromInt(isl.x + isl.w)));
            try testing.expect(y >= @as(f32, @floatFromInt(isl.y)) and y <= @as(f32, @floatFromInt(isl.y + isl.h)));
        }
    }
    // Both triangles of a quad share ONE island — the continuity the grid never had.
    try testing.expectEqual(l.tri_island[0], l.tri_island[1]);
    try testing.expect(l.atlas_w <= 8192 and l.atlas_h <= 8192);
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

test "ungrouped triangles each get their own area-proportional island" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    var l = build(testing.allocator, soup[0..], null, 16, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 12), l.islands.len);
    for (l.islands) |isl| try testing.expectEqual(NO_GROUP, isl.group);
}

test "buildFit: a lone cube spreads the whole atlas budget — writing-grade texels per face" {
    // The proven painter's law (req_1299): fidelity comes from the atlas SIZE, not a
    // fixed texels/meter. A 1m cube at fit-1024: naturalExtent = √6/0.85 ≈ 2.88m →
    // density ≈ 1024×0.92/2.88 ≈ 327 texels/m → each face island ≈ 327², and the
    // packed atlas stays around (under) the requested budget.
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    var l = buildFit(testing.allocator, soup[0..], groups[0..], 1024, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 6), l.islands.len);
    try testing.expect(l.density > 300 and l.density < 340);
    for (l.islands) |isl| {
        try testing.expect(isl.w >= 300 and isl.w <= 340);
        try testing.expect(isl.h >= 300 and isl.h <= 340);
    }
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
