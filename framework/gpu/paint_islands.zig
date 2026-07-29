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
/// Signed UV editor workspace guard. f32 represents every integer through this
/// value exactly; it is a corruption limit, not a finite canvas boundary.
pub const MAX_SIGNED_UV_TEXELS: f32 = 16_777_216.0;

// Two authored faces become one UV island when they share a real mesh edge and
// PROJECT the same way — same dominant normal axis, same sign (req_3426, the
// Blockbench island rule; `sameProjectionBucket`). Coplanar fans (a cylinder cap)
// merge as before, and curved walls now fold into per-axis-quadrant charts instead
// of one loose strip per face: a 24-side cylinder wall becomes four contiguous arc
// charts, a UV sphere six axis charts rather than hundreds of isolated quads.
// Projection along the shared axis stays single-valued on a convex chart; glancing
// faces compress by the projection cosine — the same distortion Blockbench accepts.

/// Reconstructed layouts additionally require the two copies of a shared UV edge to
/// coincide. Moving one fan wedge breaks that equality and therefore detaches it into
/// its own island without changing the model's authored face groups.
pub const UV_EDGE_MATCH_EPSILON: f32 = 0.0001;

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

/// The island-merge criterion (req_3426): two face normals belong to the same
/// projection bucket when they share the dominant axis AND the sign along it.
/// See the doc block above `UV_EDGE_MATCH_EPSILON` for why this replaces the old
/// strict-coplanarity rule.
fn sameProjectionBucket(a: [3]f32, b: [3]f32) bool {
    const axis = projectAxis(a[0], a[1], a[2]);
    if (axis != projectAxis(b[0], b[1], b[2])) return false;
    return (a[axis] < 0) == (b[axis] < 0);
}

/// Drop the dominant coordinate, then orient U so the projected triangle keeps
/// the same handedness when viewed from the OUTSIDE of either axis side. A fixed
/// basis alone mirrors one side of every axis pair, making text backwards on
/// half of a box/cylinder even though no amount of UV rotation can correct it.
fn projectVert(axis: u8, sign: i8, p: [3]f32) [2]f32 {
    var projected: [2]f32 = switch (axis) {
        0 => .{ p[2], p[1] }, // looking down ±X → (z, y)
        1 => .{ p[0], p[2] }, // looking down ±Y → (x, z)
        else => .{ p[0], p[1] }, // looking down ±Z → (x, y)
    };
    // U×V points -X, -Y, +Z for the three bases above. The opposite-facing
    // side reflects U so every emitted triangle has one consistent UV winding.
    const basis_sign: i8 = if (axis == 2) 1 else -1;
    if (sign != basis_sign) projected[0] = -projected[0];
    return projected;
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

const PointBits = struct { x: u32, y: u32, z: u32 };
const EdgeKey = struct { a: PointBits, b: PointBits };
const EdgeOwner = struct {
    raw: u32,
    normal: [3]f32,
    uv_a: [2]f32,
    uv_b: [2]f32,
};
const RawPair = struct { a: u32, b: u32 };
const ComponentMap = struct { raw_to_component: []u32, count: u32 };

fn canonicalFloatBits(value: f32) u32 {
    // Shared edit-mesh vertices lower to bit-identical soup positions. Canonicalize
    // signed zero so a harmless -0 does not invent a seam.
    return if (value == 0) 0 else @bitCast(value);
}

fn pointBits(positions: []const f32, face: u32, corner: u32) PointBits {
    const base = @as(usize, face) * 9 + @as(usize, corner) * 3;
    return .{
        .x = canonicalFloatBits(positions[base + 0]),
        .y = canonicalFloatBits(positions[base + 1]),
        .z = canonicalFloatBits(positions[base + 2]),
    };
}

fn pointBefore(a: PointBits, b: PointBits) bool {
    if (a.x != b.x) return a.x < b.x;
    if (a.y != b.y) return a.y < b.y;
    return a.z < b.z;
}

fn faceUnitNormal(positions: []const f32, face: u32) ?[3]f32 {
    const base = @as(usize, face) * 9;
    const ax = positions[base + 0];
    const ay = positions[base + 1];
    const az = positions[base + 2];
    const e1x = positions[base + 3] - ax;
    const e1y = positions[base + 4] - ay;
    const e1z = positions[base + 5] - az;
    const e2x = positions[base + 6] - ax;
    const e2y = positions[base + 7] - ay;
    const e2z = positions[base + 8] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const length = @sqrt(nx * nx + ny * ny + nz * nz);
    if (!std.math.isFinite(length) or length <= 1e-8) return null;
    return .{ nx / length, ny / length, nz / length };
}

fn findRoot(parents: []u32, index: u32) u32 {
    var root = index;
    while (parents[root] != root) root = parents[root];
    var cursor = index;
    while (parents[cursor] != cursor) {
        const next = parents[cursor];
        parents[cursor] = root;
        cursor = next;
    }
    return root;
}

fn joinRoots(parents: []u32, a: u32, b: u32) void {
    const ra = findRoot(parents, a);
    const rb = findRoot(parents, b);
    if (ra == rb) return;
    // Stable representative: the first-authored raw island wins.
    if (ra < rb) parents[rb] = ra else parents[ra] = rb;
}

fn uvPoint(normalized_uvs: []const f32, face: u32, corner: u32) [2]f32 {
    const base = @as(usize, face) * 6 + @as(usize, corner) * 2;
    return .{ normalized_uvs[base + 0], normalized_uvs[base + 1] };
}

fn uvEdgeMatches(owner: EdgeOwner, a: [2]f32, b: [2]f32) bool {
    return @abs(owner.uv_a[0] - a[0]) <= UV_EDGE_MATCH_EPSILON and @abs(owner.uv_a[1] - a[1]) <= UV_EDGE_MATCH_EPSILON and @abs(owner.uv_b[0] - b[0]) <= UV_EDGE_MATCH_EPSILON and @abs(owner.uv_b[1] - b[1]) <= UV_EDGE_MATCH_EPSILON;
}

/// Coalesce initial authored-face buckets through real shared edges. When `uvs` is
/// present this is also the Blockbench-style UV-island rule: the shared 3D edge must
/// still be shared in UV space. The returned ids are compact and first-face stable.
fn connectedComponents(
    alloc: std.mem.Allocator,
    positions: []const f32,
    normalized_uvs: ?[]const f32,
    raw_of_face: []const u32,
    raw_count: u32,
) ?ComponentMap {
    if (raw_count == 0) return null;
    const face_count: u32 = @intCast(raw_of_face.len);
    if (positions.len < @as(usize, face_count) * 9) return null;
    if (normalized_uvs) |uvs| if (uvs.len < @as(usize, face_count) * 6) return null;

    const parents = alloc.alloc(u32, raw_count) catch return null;
    defer alloc.free(parents);
    for (parents, 0..) |*parent, index| parent.* = @intCast(index);

    var edges = std.AutoHashMapUnmanaged(EdgeKey, EdgeOwner).empty;
    defer edges.deinit(alloc);
    var joins = std.AutoHashMapUnmanaged(RawPair, u8).empty;
    defer joins.deinit(alloc);
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        const normal = faceUnitNormal(positions, face) orelse continue;
        var edge: u32 = 0;
        while (edge < 3) : (edge += 1) {
            const ca = edge;
            const cb = (edge + 1) % 3;
            const pa = pointBits(positions, face, ca);
            const pb = pointBits(positions, face, cb);
            if (std.meta.eql(pa, pb)) continue;
            const forward = pointBefore(pa, pb);
            const key: EdgeKey = if (forward) .{ .a = pa, .b = pb } else .{ .a = pb, .b = pa };
            const uva = if (normalized_uvs) |uvs| uvPoint(uvs, face, if (forward) ca else cb) else .{ 0, 0 };
            const uvb = if (normalized_uvs) |uvs| uvPoint(uvs, face, if (forward) cb else ca) else .{ 0, 0 };
            const owner = edges.get(key) orelse {
                edges.put(alloc, key, .{ .raw = raw_of_face[face], .normal = normal, .uv_a = uva, .uv_b = uvb }) catch return null;
                continue;
            };
            if (owner.raw == raw_of_face[face]) continue;
            if (!sameProjectionBucket(owner.normal, normal)) continue;
            if (normalized_uvs != null and !uvEdgeMatches(owner, uva, uvb)) continue;
            const other = raw_of_face[face];
            const pair: RawPair = if (owner.raw < other) .{ .a = owner.raw, .b = other } else .{ .a = other, .b = owner.raw };
            const entry = joins.getOrPut(alloc, pair) catch return null;
            if (!entry.found_existing) entry.value_ptr.* = 1 else entry.value_ptr.* +|= 1;
        }
    }
    // Proper manifold neighbours share one boundary edge. Coincident duplicate
    // faces share several edges; merging those would turn stacked parts into one
    // UV island merely because their geometry overlaps exactly.
    var join_it = joins.iterator();
    while (join_it.next()) |entry| {
        if (entry.value_ptr.* != 1) continue;
        joinRoots(parents, entry.key_ptr.a, entry.key_ptr.b);
    }

    const mapping = alloc.alloc(u32, raw_count) catch return null;
    errdefer alloc.free(mapping);
    var root_to_component = std.AutoHashMapUnmanaged(u32, u32).empty;
    defer root_to_component.deinit(alloc);
    var count: u32 = 0;
    var raw: u32 = 0;
    while (raw < raw_count) : (raw += 1) {
        const root = findRoot(parents, raw);
        const entry = root_to_component.getOrPut(alloc, root) catch return null;
        if (!entry.found_existing) {
            entry.value_ptr.* = count;
            count += 1;
        }
        mapping[raw] = entry.value_ptr.*;
    }
    return .{ .raw_to_component = mapping, .count = count };
}

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

/// Reconstruct only the face-to-atlas metadata for an already-authored UV layout.
/// Structural indexed edits (loop cut, merge, symmetrize) interpolate the existing
/// per-corner UVs; adopting those UVs must not repack or clear the live paint atlas.
/// `normalized_uvs` is two floats per rendered corner (six per triangle).
pub fn buildFromNormalizedUv(
    alloc: std.mem.Allocator,
    positions: ?[]const f32,
    normalized_uvs: []const f32,
    groups: ?[]const u32,
    atlas_w: u32,
    atlas_h: u32,
    density: f32,
) ?Layout {
    if (atlas_w == 0 or atlas_h == 0 or normalized_uvs.len == 0 or normalized_uvs.len % 6 != 0) return null;
    const fc: u32 = @intCast(normalized_uvs.len / 6);
    if (groups) |rows| if (rows.len < @as(usize, fc)) return null;
    if (positions) |rows| if (rows.len < @as(usize, fc) * 9) return null;

    // Start with authored-face buckets, then join neighbouring buckets only when
    // their 3D edge and UV edge are both continuous. That makes a cap fan one island
    // while preserving an intentionally detached wedge after a UV edit/reopen.
    var raw_of_group = std.AutoHashMapUnmanaged(u32, u32).empty;
    defer raw_of_group.deinit(alloc);
    var raw_groups = std.ArrayListUnmanaged(u32).empty;
    defer raw_groups.deinit(alloc);
    const tri_raw = alloc.alloc(u32, fc) catch return null;
    defer alloc.free(tri_raw);
    var face: u32 = 0;
    while (face < fc) : (face += 1) {
        const group = if (groups) |rows| rows[face] else NO_GROUP;
        if (group == NO_GROUP) {
            tri_raw[face] = @intCast(raw_groups.items.len);
            raw_groups.append(alloc, NO_GROUP) catch return null;
        } else {
            const entry = raw_of_group.getOrPut(alloc, group) catch return null;
            if (!entry.found_existing) {
                entry.value_ptr.* = @intCast(raw_groups.items.len);
                raw_groups.append(alloc, group) catch return null;
            }
            tri_raw[face] = entry.value_ptr.*;
        }
    }

    const components: ComponentMap = if (positions) |pos|
        connectedComponents(alloc, pos, normalized_uvs, tri_raw, @intCast(raw_groups.items.len)) orelse return null
    else blk: {
        const identity = alloc.alloc(u32, raw_groups.items.len) catch return null;
        for (identity, 0..) |*value, index| value.* = @intCast(index);
        break :blk .{ .raw_to_component = identity, .count = @intCast(identity.len) };
    };
    defer alloc.free(components.raw_to_component);

    const tri_island = alloc.alloc(u32, fc) catch return null;
    errdefer alloc.free(tri_island);
    face = 0;
    while (face < fc) : (face += 1) tri_island[face] = components.raw_to_component[tri_raw[face]];

    const islands = alloc.alloc(Island, components.count) catch return null;
    errdefer alloc.free(islands);
    const group_seen = alloc.alloc(bool, components.count) catch return null;
    defer alloc.free(group_seen);
    @memset(group_seen, false);
    for (islands) |*island| island.* = .{
        .group = NO_GROUP,
        .x = atlas_w - 1,
        .y = atlas_h - 1,
        .w = 0,
        .h = 0,
        .axis = 0,
        .sign = 1,
        .min_u = 0,
        .min_v = 0,
    };
    for (raw_groups.items, 0..) |group, raw| {
        const component = components.raw_to_component[raw];
        if (group_seen[component]) continue;
        group_seen[component] = true;
        islands[component].group = group;
    }

    const corner_uv = alloc.alloc(f32, normalized_uvs.len) catch return null;
    errdefer alloc.free(corner_uv);
    face = 0;
    while (face < fc) : (face += 1) {
        const island_index = tri_island[face];

        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const source = (@as(usize, face) * 3 + corner) * 2;
            const u = normalized_uvs[source + 0];
            const v = normalized_uvs[source + 1];
            if (!std.math.isFinite(u) or !std.math.isFinite(v)) return null;
            // Exact authored corners live in a signed, unbounded UV workspace.
            // Island rectangles remain finite u32 paint-clipping metadata, so
            // their bounds are projected onto the nearest atlas texel without
            // changing the real corner coordinates.
            const px = u * @as(f32, @floatFromInt(atlas_w));
            const py = v * @as(f32, @floatFromInt(atlas_h));
            if (!std.math.isFinite(px) or !std.math.isFinite(py) or
                @abs(px) > MAX_SIGNED_UV_TEXELS or @abs(py) > MAX_SIGNED_UV_TEXELS) return null;
            corner_uv[source + 0] = px;
            corner_uv[source + 1] = py;

            const tx: u32 = @intFromFloat(std.math.clamp(@floor(px), 0, @as(f32, @floatFromInt(atlas_w - 1))));
            const ty: u32 = @intFromFloat(std.math.clamp(@floor(py), 0, @as(f32, @floatFromInt(atlas_h - 1))));
            const island = &islands[island_index];
            if (island.w == 0) {
                island.x = tx;
                island.y = ty;
                island.w = 1;
                island.h = 1;
            } else {
                const max_x = @max(island.x + island.w - 1, tx);
                const max_y = @max(island.y + island.h - 1, ty);
                island.x = @min(island.x, tx);
                island.y = @min(island.y, ty);
                island.w = max_x - island.x + 1;
                island.h = max_y - island.y + 1;
            }
        }
    }

    return .{
        .atlas_w = atlas_w,
        .atlas_h = atlas_h,
        .density = density,
        .islands = islands,
        .tri_island = tri_island,
        .corner_uv = corner_uv,
    };
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

    // Authored edit faces are not automatically UV islands. A cylinder deliberately
    // keeps each cap wedge as a selectable topology face, but those coplanar wedges
    // share edges and project to one circular UV piece. Coalesce those connected
    // buckets before measuring or packing them.
    const components = connectedComponents(alloc, positions, null, tri_island, @intCast(raws.items.len)) orelse return null;
    defer alloc.free(components.raw_to_component);
    if (@as(usize, components.count) != raws.items.len) {
        var merged = std.ArrayListUnmanaged(RawIsland).empty;
        defer merged.deinit(alloc);
        var component: u32 = 0;
        while (component < components.count) : (component += 1) {
            merged.append(alloc, .{ .group = NO_GROUP, .axis = 0, .sign = 1, .min_u = 0, .min_v = 0, .w_m = 0, .h_m = 0, .first_tri = std.math.maxInt(u32) }) catch return null;
        }
        for (raws.items, 0..) |raw, raw_index| {
            const target = &merged.items[components.raw_to_component[raw_index]];
            if (raw.first_tri >= target.first_tri) continue;
            target.group = raw.group;
            target.first_tri = raw.first_tri;
        }
        f = 0;
        while (f < fc) : (f += 1) tri_island[f] = components.raw_to_component[tri_island[f]];
        raws.deinit(alloc);
        raws = merged;
        merged = .empty;
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
            const uv = projectVert(r.axis, r.sign, .{ positions[base + 0], positions[base + 1], positions[base + 2] });
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
            const uv = projectVert(isl.axis, isl.sign, .{ positions[base + 0], positions[base + 1], positions[base + 2] });
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

test "generated UVs keep one outward handedness on both sides of every axis" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    var layout = build(testing.allocator, soup[0..], groups[0..], 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);

    var face: usize = 0;
    while (face < 12) : (face += 1) {
        const at = face * 6;
        const ax = layout.corner_uv[at + 0];
        const ay = layout.corner_uv[at + 1];
        const bx = layout.corner_uv[at + 2];
        const by = layout.corner_uv[at + 3];
        const cx = layout.corner_uv[at + 4];
        const cy = layout.corner_uv[at + 5];
        const signed_area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        try testing.expect(signed_area > 0);
    }
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

test "ungrouped triangle soup coalesces connected coplanar faces" {
    var soup: [12 * 9]f32 = undefined;
    cubeSoup(&soup);
    var l = build(testing.allocator, soup[0..], null, 16, 8192, 256 << 20).?;
    defer l.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 6), l.islands.len);
    for (l.islands) |isl| try testing.expectEqual(NO_GROUP, isl.group);
}

test "triangle-fan caps become coherent radial islands without merging side walls" {
    const segments = 4;
    var soup: [segments * 4 * 9]f32 = undefined;
    var groups: [segments * 4]u32 = undefined;
    const ring = [segments][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ 1, 1 }, .{ -1, 1 } };
    var write: usize = 0;
    var face: usize = 0;
    var segment: usize = 0;
    while (segment < segments) : (segment += 1) {
        const next = (segment + 1) % segments;
        const bottom_a = [3]f32{ ring[segment][0], -0.5, ring[segment][1] };
        const top_a = [3]f32{ ring[segment][0], 0.5, ring[segment][1] };
        const bottom_b = [3]f32{ ring[next][0], -0.5, ring[next][1] };
        const top_b = [3]f32{ ring[next][0], 0.5, ring[next][1] };
        const triangles = [4][3][3]f32{
            .{ bottom_a, top_a, top_b },
            .{ bottom_a, top_b, bottom_b },
            .{ top_a, .{ 0, 0.5, 0 }, top_b },
            .{ bottom_a, bottom_b, .{ 0, -0.5, 0 } },
        };
        for (triangles, 0..) |triangle, local| {
            for (triangle) |point| for (point) |coordinate| {
                soup[write] = coordinate;
                write += 1;
            };
            groups[face] = if (local < 2) @intCast(segment) else @intCast(segments + segment * 2 + local - 2);
            face += 1;
        }
    }
    var layout = build(testing.allocator, &soup, &groups, 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, segments + 2), layout.islands.len);
    const top_island = layout.tri_island[2];
    const bottom_island = layout.tri_island[3];
    try testing.expect(top_island != bottom_island);
    segment = 1;
    while (segment < segments) : (segment += 1) {
        try testing.expectEqual(top_island, layout.tri_island[segment * 4 + 2]);
        try testing.expectEqual(bottom_island, layout.tri_island[segment * 4 + 3]);
    }
}

test "curved walls fold into per-axis-quadrant charts, continuous across merged edges" {
    // An 8-wall open cylinder (no caps). Wall normals sit at 22.5° + k·45°, which
    // buckets them x+/z+/z+/x−/x−/z−/z−/x+ — so the Blockbench rule (req_3426)
    // folds 8 walls into 4 two-wall arc charts instead of 8 loose strips.
    const walls = 8;
    var soup: [walls * 2 * 9]f32 = undefined;
    var groups: [walls * 2]u32 = undefined;
    // Precompute the ring so the wrap edge shares bit-identical positions — a real
    // mesh's shared vertices lower to identical soup floats; cos(2π) ≠ cos(0) does not.
    var ring: [walls][2]f32 = undefined;
    for (&ring, 0..) |*point, index| {
        const angle = @as(f32, @floatFromInt(index)) * std.math.pi * 2 / walls;
        point.* = .{ @cos(angle), @sin(angle) };
    }
    var write: usize = 0;
    var wall: usize = 0;
    while (wall < walls) : (wall += 1) {
        const next = (wall + 1) % walls;
        const bottom_a = [3]f32{ ring[wall][0], -0.5, ring[wall][1] };
        const top_a = [3]f32{ ring[wall][0], 0.5, ring[wall][1] };
        const bottom_b = [3]f32{ ring[next][0], -0.5, ring[next][1] };
        const top_b = [3]f32{ ring[next][0], 0.5, ring[next][1] };
        for ([2][3][3]f32{ .{ bottom_a, top_a, top_b }, .{ bottom_a, top_b, bottom_b } }) |triangle| {
            for (triangle) |point| for (point) |coordinate| {
                soup[write] = coordinate;
                write += 1;
            };
        }
        groups[wall * 2 + 0] = @intCast(wall);
        groups[wall * 2 + 1] = @intCast(wall);
    }
    var layout = build(testing.allocator, &soup, &groups, 16, 8192, 256 << 20).?;
    defer layout.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 4), layout.islands.len);
    // The quadrant pairs: (7,0) x+, (1,2) z+, (3,4) x−, (5,6) z−.
    try testing.expectEqual(layout.tri_island[7 * 2], layout.tri_island[0]);
    try testing.expectEqual(layout.tri_island[1 * 2], layout.tri_island[2 * 2]);
    try testing.expectEqual(layout.tri_island[3 * 2], layout.tri_island[4 * 2]);
    try testing.expectEqual(layout.tri_island[5 * 2], layout.tri_island[6 * 2]);
    try testing.expect(layout.tri_island[0] != layout.tri_island[1 * 2]);
    // The shared vertex top_0 (wall 7 face 14 corner 2, wall 0 face 0 corner 1) maps
    // to ONE atlas texel — strokes travel the merged chart without a seam.
    try testing.expectApproxEqAbs(layout.corner_uv[(14 * 3 + 2) * 2 + 0], layout.corner_uv[(0 * 3 + 1) * 2 + 0], 0.0001);
    try testing.expectApproxEqAbs(layout.corner_uv[(14 * 3 + 2) * 2 + 1], layout.corner_uv[(0 * 3 + 1) * 2 + 1], 0.0001);
}

test "existing normalized UVs rebuild metadata without repacking" {
    const allocator = std.testing.allocator;
    const uvs = [_]f32{
        0.125, 0.25, 0.5, 0.25, 0.5,   0.75,
        0.125, 0.25, 0.5, 0.75, 0.125, 0.75,
    };
    const groups = [_]u32{ 7, 7 };
    const positions = [_]f32{
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
    };
    var layout = buildFromNormalizedUv(allocator, &positions, &uvs, &groups, 128, 64, 16) orelse return error.OutOfMemory;
    defer layout.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), layout.islands.len);
    try std.testing.expectEqual(@as(u32, 0), layout.tri_island[0]);
    try std.testing.expectEqual(@as(u32, 0), layout.tri_island[1]);
    for (uvs, 0..) |normalized, index| {
        const dimension: f32 = if (index % 2 == 0) 128 else 64;
        try std.testing.expectApproxEqAbs(normalized * dimension, layout.corner_uv[index], 0.0001);
    }
    try std.testing.expectEqual(@as(u32, 16), layout.islands[0].x);
    try std.testing.expectEqual(@as(u32, 16), layout.islands[0].y);
    try std.testing.expectEqual(@as(u32, 49), layout.islands[0].w);
    try std.testing.expectEqual(@as(u32, 33), layout.islands[0].h);
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
