//! Instance lowering, shape/material batching, and row-space bounds.
//!
//! Inputs are baked rows; outputs are owned batches or deterministic collider-ready facts.

const std = @import("std");
const constructor = @import("../world/constructor.zig");
const foliage = @import("../world/foliage.zig");
const flora_geometry = @import("../world/flora_geometry.zig");
const game_physics = @import("../game/physics.zig");
const instance_collider_policy = @import("../world/instance_collider_policy.zig");
const geometry = @import("geometry.zig");
const config = @import("config.zig");
const tileColor = geometry.tileColor;
const SHAPE_BOX = config.SHAPE_BOX;
const SHAPE_RAMP = config.SHAPE_RAMP;
const SHAPE_CYLINDER8 = config.SHAPE_CYLINDER8;
const SHAPE_CYLINDER16 = config.SHAPE_CYLINDER16;
const SHAPE_SPHERE = config.SHAPE_SPHERE;
const SHAPE_GABLE = config.SHAPE_GABLE;
const SHAPE_GRASS = config.SHAPE_GRASS;
const SHAPE_BUSH = config.SHAPE_BUSH;
const SHAPE_FROND = config.SHAPE_FROND;
const SHAPE_PALMTRUNK = config.SHAPE_PALMTRUNK;
const SHAPE_FLOWER = config.SHAPE_FLOWER;
const SHAPE_SCENERY_BOX = config.SHAPE_SCENERY_BOX;
const SHAPE_CORNER_MITER = config.SHAPE_CORNER_MITER;
const SHAPE_CORNER_MITER_MIRROR = config.SHAPE_CORNER_MITER_MIRROR;
const SHAPE_BOX_OPEN_RUN_MIN = config.SHAPE_BOX_OPEN_RUN_MIN;
const SHAPE_BOX_OPEN_RUN_MAX = config.SHAPE_BOX_OPEN_RUN_MAX;
const SHAPE_BOX_OPEN_RUN_BOTH = config.SHAPE_BOX_OPEN_RUN_BOTH;
const wrappedShapeId = config.wrappedShapeId;
const wrappedSpeciesForShape = config.wrappedSpeciesForShape;
const WALL_SENTINEL_SHAPE = config.WALL_SENTINEL_SHAPE;
const PLAYER_SURFACE_FRICTION = config.PLAYER_SURFACE_FRICTION;
const PLAYER_SURFACE_RESTITUTION = config.PLAYER_SURFACE_RESTITUTION;

/// Fallback geometry for a game-file with no instance buffer: extrude each
/// non-null tile into one box instance (stride 9: pos3/scale3/color3). Heap-
/// owned; the caller frees it after the frame loop.
pub fn extrudeTiles(allocator: std.mem.Allocator, scene: constructor.Scene) ![]f32 {
    var list: std.ArrayList(f32) = .empty;
    errdefer list.deinit(allocator);
    var y: u32 = 0;
    while (y < scene.height) : (y += 1) {
        var x: u32 = 0;
        while (x < scene.width) : (x += 1) {
            const color = tileColor(scene.tiles[y * scene.width + x]) orelse continue;
            try list.appendSlice(allocator, &[_]f32{
                @floatFromInt(x), 0.25, @floatFromInt(y), // position (center)
                0, 0, 0, // rotation (yaw unused)
                0.9, 0.5, 0.9, // scale
                color[0], color[1], color[2], // color
            });
        }
    }
    return list.toOwnedSlice(allocator);
}

pub const ShapeBatches = struct {
    boxes: []f32,
    box_count: u32,
    boxes_open_run_min: []f32,
    box_open_run_min_count: u32,
    boxes_open_run_max: []f32,
    box_open_run_max_count: u32,
    boxes_open_run_both: []f32,
    box_open_run_both_count: u32,
    ramps: []f32,
    ramp_count: u32,
    cylinder8s: []f32,
    cylinder8_count: u32,
    cylinder16s: []f32,
    cylinder16_count: u32,
    spheres: []f32,
    sphere_count: u32,
    gables: []f32,
    gable_count: u32,
    corner_miters: []f32,
    corner_miter_count: u32,
    corner_miter_mirrors: []f32,
    corner_miter_mirror_count: u32,
    grass: []f32,
    grass_count: u32,
    flowers: []f32,
    flower_count: u32,
    bush: []f32,
    bush_count: u32,
    frond: []f32,
    frond_count: u32,
    palmtrunks: []f32,
    palmtrunk_count: u32,
    wrapped: [foliage.WRAPPED_SPECIES_COUNT][]f32,
    wrapped_counts: [foliage.WRAPPED_SPECIES_COUNT]u32,

    pub fn deinit(self: ShapeBatches, allocator: std.mem.Allocator) void {
        allocator.free(self.boxes);
        allocator.free(self.boxes_open_run_min);
        allocator.free(self.boxes_open_run_max);
        allocator.free(self.boxes_open_run_both);
        allocator.free(self.ramps);
        allocator.free(self.cylinder8s);
        allocator.free(self.cylinder16s);
        allocator.free(self.spheres);
        allocator.free(self.gables);
        allocator.free(self.corner_miters);
        allocator.free(self.corner_miter_mirrors);
        allocator.free(self.grass);
        allocator.free(self.flowers);
        allocator.free(self.bush);
        allocator.free(self.frond);
        allocator.free(self.palmtrunks);
        for (self.wrapped) |rows| allocator.free(rows);
    }
};

// One textured draw: the instance rows that wear material slot N, plus the key
// the materialized shader is installed under (scene3d_tex_key). One instanced
// mesh node per batch — the flat (material-less) rows stay in ShapeBatches.
pub const MaterialBatch = struct {
    boxes: []f32,
    count: u32,
    key: []u8,
    // The instance SHAPE this batch draws (FORMULAFLOOR sibling, req_0939): a
    // material-skinned gable roof / cylinder / sphere must wear its real geometry,
    // not a textured box. Rows are partitioned per (material, shape), so every
    // batch is single-shape and the draw picks geometry from it.
    shape: f32,
    textured_translucent: bool,
    translucent: bool,
    opacity: f32,

    pub fn deinit(self: MaterialBatch, allocator: std.mem.Allocator) void {
        allocator.free(self.boxes);
        allocator.free(self.key);
    }
};

/// Append one instance row into a batch list and, for a WALL row (req_2053),
/// stamp the WALL_SENTINEL into its SHAPE slot (index 12) — the marker
/// collapseWallRows finds so hide-walls can scale it to 0. Safe because the
/// batch is single-geometry and index 12 is GPU-dead (see WALL_SENTINEL_SHAPE).
pub fn appendInstanceRow(list: *std.ArrayList(f32), allocator: std.mem.Allocator, src: []const f32, is_wall: bool, stride: usize) !void {
    try list.appendSlice(allocator, src);
    if (is_wall and stride >= 13 and list.items.len >= stride) list.items[list.items.len - stride + 12] = WALL_SENTINEL_SHAPE;
}

// Rows referencing a material (material_refs[row] != 0) are drawn TEXTURED in
// their own per-material batch, so they're skipped here — the flat instanced
// batch is the material-less remainder. `material_refs` may be empty (no
// materials), in which case nothing is skipped.
// `wall_flags` (req_2053) is parallel to the instance rows (1 = wall piece); a
// wall row gets the WALL_SENTINEL stamp via appendInstanceRow so the editor's
// build pane can hide it. Empty → no row is a wall.
pub fn buildShapeBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, material_refs: []const u32, wall_flags: []const u8, flora: ?constructor.FloraCells) !ShapeBatches {
    var boxes: std.ArrayList(f32) = .empty;
    errdefer boxes.deinit(allocator);
    var boxes_open_run_min: std.ArrayList(f32) = .empty;
    errdefer boxes_open_run_min.deinit(allocator);
    var boxes_open_run_max: std.ArrayList(f32) = .empty;
    errdefer boxes_open_run_max.deinit(allocator);
    var boxes_open_run_both: std.ArrayList(f32) = .empty;
    errdefer boxes_open_run_both.deinit(allocator);
    var ramps: std.ArrayList(f32) = .empty;
    errdefer ramps.deinit(allocator);
    var cylinder8s: std.ArrayList(f32) = .empty;
    errdefer cylinder8s.deinit(allocator);
    var cylinder16s: std.ArrayList(f32) = .empty;
    errdefer cylinder16s.deinit(allocator);
    var spheres: std.ArrayList(f32) = .empty;
    errdefer spheres.deinit(allocator);
    var gables: std.ArrayList(f32) = .empty;
    errdefer gables.deinit(allocator);
    var corner_miters: std.ArrayList(f32) = .empty;
    errdefer corner_miters.deinit(allocator);
    var corner_miter_mirrors: std.ArrayList(f32) = .empty;
    errdefer corner_miter_mirrors.deinit(allocator);
    var grass: std.ArrayList(f32) = .empty;
    errdefer grass.deinit(allocator);
    var flowers: std.ArrayList(f32) = .empty;
    errdefer flowers.deinit(allocator);
    var bush: std.ArrayList(f32) = .empty;
    errdefer bush.deinit(allocator);
    var frond: std.ArrayList(f32) = .empty;
    errdefer frond.deinit(allocator);
    var palmtrunks: std.ArrayList(f32) = .empty;
    errdefer palmtrunks.deinit(allocator);
    var wrapped: [foliage.WRAPPED_SPECIES_COUNT]std.ArrayList(f32) = @splat(.{});
    errdefer for (&wrapped) |*rows| rows.deinit(allocator);
    var box_count: u32 = 0;
    var box_open_run_min_count: u32 = 0;
    var box_open_run_max_count: u32 = 0;
    var box_open_run_both_count: u32 = 0;
    var ramp_count: u32 = 0;
    var cylinder8_count: u32 = 0;
    var cylinder16_count: u32 = 0;
    var sphere_count: u32 = 0;
    var gable_count: u32 = 0;
    var corner_miter_count: u32 = 0;
    var corner_miter_mirror_count: u32 = 0;
    var grass_count: u32 = 0;
    var flower_count: u32 = 0;
    var bush_count: u32 = 0;
    var frond_count: u32 = 0;
    var palmtrunk_count: u32 = 0;
    var wrapped_counts: [foliage.WRAPPED_SPECIES_COUNT]u32 = @splat(0);
    var row: usize = 0;
    while (row < @as(usize, @intCast(inst_count))) : (row += 1) {
        if (row < material_refs.len and material_refs[row] != 0) continue; // textured batch
        const b = row * stride;
        const src = insts[b .. b + stride];
        const shape = instanceShapeId(insts, row, stride);
        // WALLHIDE req_2053: stamp this row's wall flag so hide-walls can find it.
        // Walls only ever land in box/open-run/gable/corner-miter (+ ramp) batches;
        // foliage is never a wall, so its shape@12 is left intact.
        const is_wall = row < wall_flags.len and wall_flags[row] != 0;
        if (@abs(shape - SHAPE_BOX_OPEN_RUN_MIN) < 0.5) {
            try appendInstanceRow(&boxes_open_run_min, allocator, src, is_wall, stride);
            box_open_run_min_count += 1;
        } else if (@abs(shape - SHAPE_BOX_OPEN_RUN_MAX) < 0.5) {
            try appendInstanceRow(&boxes_open_run_max, allocator, src, is_wall, stride);
            box_open_run_max_count += 1;
        } else if (@abs(shape - SHAPE_BOX_OPEN_RUN_BOTH) < 0.5) {
            try appendInstanceRow(&boxes_open_run_both, allocator, src, is_wall, stride);
            box_open_run_both_count += 1;
        } else if (@abs(shape - SHAPE_RAMP) < 0.5) {
            try appendInstanceRow(&ramps, allocator, src, is_wall, stride);
            ramp_count += 1;
        } else if (@abs(shape - SHAPE_CYLINDER8) < 0.5) {
            try appendInstanceRow(&cylinder8s, allocator, src, is_wall, stride);
            cylinder8_count += 1;
        } else if (@abs(shape - SHAPE_CYLINDER16) < 0.5) {
            try appendInstanceRow(&cylinder16s, allocator, src, is_wall, stride);
            cylinder16_count += 1;
        } else if (@abs(shape - SHAPE_SPHERE) < 0.5) {
            try appendInstanceRow(&spheres, allocator, src, is_wall, stride);
            sphere_count += 1;
        } else if (@abs(shape - SHAPE_GABLE) < 0.5) {
            try appendInstanceRow(&gables, allocator, src, is_wall, stride);
            gable_count += 1;
        } else if (@abs(shape - SHAPE_CORNER_MITER) < 0.5) {
            try appendInstanceRow(&corner_miters, allocator, src, is_wall, stride);
            corner_miter_count += 1;
        } else if (@abs(shape - SHAPE_CORNER_MITER_MIRROR) < 0.5) {
            try appendInstanceRow(&corner_miter_mirrors, allocator, src, is_wall, stride);
            corner_miter_mirror_count += 1;
        } else if (@abs(shape - SHAPE_GRASS) < 0.5) {
            try grass.appendSlice(allocator, src);
            grass_count += 1;
        } else if (@abs(shape - SHAPE_FLOWER) < 0.5) {
            try flowers.appendSlice(allocator, src);
            flower_count += 1;
        } else if (@abs(shape - SHAPE_BUSH) < 0.5) {
            try bush.appendSlice(allocator, src);
            bush_count += 1;
        } else if (@abs(shape - SHAPE_FROND) < 0.5) {
            try frond.appendSlice(allocator, src);
            frond_count += 1;
        } else if (@abs(shape - SHAPE_PALMTRUNK) < 0.5) {
            try palmtrunks.appendSlice(allocator, src);
            palmtrunk_count += 1;
        } else if (wrappedSpeciesForShape(shape)) |species| {
            const si = @intFromEnum(species);
            try wrapped[si].appendSlice(allocator, src);
            wrapped_counts[si] += 1;
        } else {
            try appendInstanceRow(&boxes, allocator, src, is_wall, stride);
            box_count += 1;
        }
    }
    // FOLIAGEFORMULA (req_1591): expand the grass/bush RECIPE into blade rows,
    // appended to the SAME batches the INSTANCES loop fills, so the draw path is
    // unchanged. The blades are a pure formula (foliage.zig, the bit-exact twin of
    // grassPopulation.ts emitClump), so the file ships only the painted cells (the
    // factors), not ~1M baked rows (the product). Rows are stride-13 (transform12 +
    // shape) like every other instance row; the foliage shaders read the first 12.
    if (flora) |fl| {
        const c_size: f64 = fl.cell_size;
        for (fl.cells) |cell| {
            const spec = foliage.specFromWire(cell.spec_id) orelse continue;
            if (foliage.wrappedSpecies(spec)) |species| {
                const si = @intFromEnum(species);
                const r = foliage.wrappedRow(species, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key);
                try wrapped[si].appendSlice(allocator, &r);
                try wrapped[si].append(allocator, wrappedShapeId(species));
                wrapped_counts[si] += 1;
                continue;
            }
            switch (spec) {
                .flowers => {
                    var k: u32 = 0;
                    while (k < cell.count) : (k += 1) {
                        const r = foliage.flowerRow(&foliage.FLOWER, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key, k);
                        try flowers.appendSlice(allocator, &r);
                        try flowers.append(allocator, SHAPE_FLOWER);
                        flower_count += 1;
                    }
                },
                .palm => {
                    // Palms retain their detailed multi-row crown: the trunk is
                    // already a baked instance; only its fronds recipe-expand.
                    const crown = foliage.palmCrown(&foliage.PALM, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key);
                    const fc = crown.total();
                    var k: u32 = 0;
                    while (k < fc) : (k += 1) {
                        const r = foliage.palmFrondRow(&crown, k);
                        try frond.appendSlice(allocator, &r);
                        try frond.append(allocator, SHAPE_FROND);
                        frond_count += 1;
                    }
                },
                else => if (foliage.bladePopulation(spec)) |population| {
                    const is_grass = population.family == .grass;
                    const shape: f32 = if (is_grass) SHAPE_GRASS else SHAPE_BUSH;
                    var k: u32 = 0;
                    while (k < cell.count) : (k += 1) {
                        const r = foliage.bladeRow(population.config, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key, k);
                        if (is_grass) {
                            try grass.appendSlice(allocator, &r);
                            try grass.append(allocator, shape);
                            grass_count += 1;
                        } else {
                            try bush.appendSlice(allocator, &r);
                            try bush.append(allocator, shape);
                            bush_count += 1;
                        }
                    }
                },
            }
        }
    }
    var wrapped_slices: [foliage.WRAPPED_SPECIES_COUNT][]f32 = undefined;
    for (&wrapped, 0..) |*rows, i| wrapped_slices[i] = try rows.toOwnedSlice(allocator);
    return .{
        .boxes = try boxes.toOwnedSlice(allocator),
        .box_count = box_count,
        .boxes_open_run_min = try boxes_open_run_min.toOwnedSlice(allocator),
        .box_open_run_min_count = box_open_run_min_count,
        .boxes_open_run_max = try boxes_open_run_max.toOwnedSlice(allocator),
        .box_open_run_max_count = box_open_run_max_count,
        .boxes_open_run_both = try boxes_open_run_both.toOwnedSlice(allocator),
        .box_open_run_both_count = box_open_run_both_count,
        .ramps = try ramps.toOwnedSlice(allocator),
        .ramp_count = ramp_count,
        .cylinder8s = try cylinder8s.toOwnedSlice(allocator),
        .cylinder8_count = cylinder8_count,
        .cylinder16s = try cylinder16s.toOwnedSlice(allocator),
        .cylinder16_count = cylinder16_count,
        .spheres = try spheres.toOwnedSlice(allocator),
        .sphere_count = sphere_count,
        .gables = try gables.toOwnedSlice(allocator),
        .gable_count = gable_count,
        .corner_miters = try corner_miters.toOwnedSlice(allocator),
        .corner_miter_count = corner_miter_count,
        .corner_miter_mirrors = try corner_miter_mirrors.toOwnedSlice(allocator),
        .corner_miter_mirror_count = corner_miter_mirror_count,
        .grass = try grass.toOwnedSlice(allocator),
        .grass_count = grass_count,
        .flowers = try flowers.toOwnedSlice(allocator),
        .flower_count = flower_count,
        .bush = try bush.toOwnedSlice(allocator),
        .bush_count = bush_count,
        .frond = try frond.toOwnedSlice(allocator),
        .frond_count = frond_count,
        .palmtrunks = try palmtrunks.toOwnedSlice(allocator),
        .palmtrunk_count = palmtrunk_count,
        .wrapped = wrapped_slices,
        .wrapped_counts = wrapped_counts,
    };
}

/// Force every row's tint to white: a SHADER material samples a texture, and the
/// row's color would multiply into it. Applied at the DRAW arrays' final home —
/// the monolithic batch, or the streaming world's sorted copy (after the LOD
/// shell has already accumulated the original colors). A TRANSLUCENT flat
/// material (glass) is never whitened — that tint IS the glass look.
pub fn whitenRows(rows: []f32, stride: usize) void {
    const color_off: usize = if (stride >= 12) 9 else 6;
    var b: usize = 0;
    while (b + stride <= rows.len) : (b += stride) {
        rows[b + color_off + 0] = 1;
        rows[b + color_off + 1] = 1;
        rows[b + color_off + 2] = 1;
    }
}

// Partition the material-referencing rows into one instanced batch per material
// slot (the shaders themselves are run later, at first render — gpu isn't ready
// at build time). Rows keep their authored fallback color here; the caller
// whitens whichever array actually draws (whitenRows above), so the streaming
// LOD shell can read the real colors first. Empty when the map has no materials.
// Shape slots a material batch can split into — indexed by the rounded shape id
// (SHAPE_BOX..SHAPE_BUSH). A skinned row is bucketed by BOTH its material AND its
// shape, so a brick-skinned gable roof draws as a gable, not a textured box
// (req_0939). Most rows are boxes, so a typical material still yields one batch.
pub const MATERIAL_SHAPE_SLOTS: usize = 8;

pub fn buildMaterialBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, materials: []const constructor.Material, material_refs: []const u32, wall_flags: []const u8) ![]MaterialBatch {
    const mat_count = materials.len;
    if (mat_count == 0 or material_refs.len == 0) return try allocator.alloc(MaterialBatch, 0);
    // One row list per (material, shape) — lists[mat * SLOTS + shape].
    var lists = try allocator.alloc(std.ArrayList(f32), mat_count * MATERIAL_SHAPE_SLOTS);
    defer allocator.free(lists);
    for (lists) |*l| l.* = .{};
    defer for (lists) |*l| l.deinit(allocator);

    var row: usize = 0;
    while (row < @as(usize, @intCast(inst_count))) : (row += 1) {
        const ref = if (row < material_refs.len) material_refs[row] else 0;
        if (ref == 0 or ref > mat_count) continue;
        const b = row * stride;
        // Round the shape id to a slot; anything outside the known shapes (incl.
        // grass/bush, which are never skinned) falls back to the box slot.
        const sid = instanceShapeId(insts, row, stride);
        var slot: usize = @intFromFloat(@max(0, @min(@as(f32, MATERIAL_SHAPE_SLOTS - 1), @round(sid))));
        if (slot >= MATERIAL_SHAPE_SLOTS) slot = 0;
        // WALLHIDE req_2053: a TEXTURED wall (skinned wall face) is still a wall —
        // stamp it so hide-walls collapses it too. The batch shape comes from the
        // slot, not index 12, so the sentinel stamp is invisible to the draw.
        const is_wall = row < wall_flags.len and wall_flags[row] != 0;
        try appendInstanceRow(&lists[(ref - 1) * MATERIAL_SHAPE_SLOTS + slot], allocator, insts[b .. b + stride], is_wall, stride);
    }

    var nonempty: usize = 0;
    for (lists) |l| {
        if (l.items.len > 0) nonempty += 1;
    }
    var batches = try allocator.alloc(MaterialBatch, nonempty);
    var built: usize = 0;
    errdefer {
        for (batches[0..built]) |batch| batch.deinit(allocator);
        allocator.free(batches);
    }
    var mi: usize = 0;
    while (mi < mat_count) : (mi += 1) {
        var slot: usize = 0;
        while (slot < MATERIAL_SHAPE_SLOTS) : (slot += 1) {
            const list = &lists[mi * MATERIAL_SHAPE_SLOTS + slot];
            if (list.items.len == 0) continue;
            // Every (material, shape) batch keys off the SAME wmat-<i> texture
            // (materialized once per material). Each batch owns its own key copy.
            const key = try std.fmt.allocPrint(allocator, "wmat-{d}", .{mi});
            errdefer allocator.free(key);
            const count: u32 = @intCast(list.items.len / stride);
            const boxes = try list.toOwnedSlice(allocator);
            batches[built] = .{
                .boxes = boxes,
                .count = count,
                .key = key,
                .shape = @floatFromInt(slot),
                // Translucent flat (glass) = NO look to materialize at all. A
                // decal material also has empty wgsl but carries its packed DOC —
                // it draws in the textured batch like any shader material.
                .translucent = materials[mi].wgsl.len == 0 and materials[mi].decal_doc.len == 0,
                // Shader/decal textures can carry alpha (painted stencil materials
                // are opaque paint over transparent background). Instanced opaque
                // draws write depth even where tex alpha is 0, so route these sparse
                // cases through single textured meshes in the transparent pass.
                .textured_translucent = materials[mi].opacity < 0.999 and (materials[mi].wgsl.len > 0 or materials[mi].decal_doc.len > 0),
                .opacity = materials[mi].opacity,
            };
            built += 1;
        }
    }
    return batches;
}

pub const Bounds = struct {
    cx: f32,
    cy: f32,
    cz: f32,
    radius: f32, // half the largest world extent (xz), min-clamped
};

/// Axis-aligned bounds of an instance batch (each row: pos3/scale3/color3),
/// used to auto-frame the camera so the whole world fits in view.
pub fn instanceBounds(insts: []const f32, count: u32, stride: usize) Bounds {
    if (count == 0) return .{ .cx = 0, .cy = 0, .cz = 0, .radius = 16 };
    // Scale floats follow the optional rot3 block: at +6 for stride>=12, else +3.
    const scale_base: usize = if (stride >= 12) 6 else 3;
    var min_x: f32 = std.math.floatMax(f32);
    var min_y: f32 = std.math.floatMax(f32);
    var min_z: f32 = std.math.floatMax(f32);
    var max_x: f32 = -std.math.floatMax(f32);
    var max_y: f32 = -std.math.floatMax(f32);
    var max_z: f32 = -std.math.floatMax(f32);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const b = i * stride;
        const px = insts[b + 0];
        const py = insts[b + 1];
        const pz = insts[b + 2];
        const hx = @abs(insts[b + scale_base + 0]) * 0.5;
        const hy = @abs(insts[b + scale_base + 1]) * 0.5;
        const hz = @abs(insts[b + scale_base + 2]) * 0.5;
        min_x = @min(min_x, px - hx);
        max_x = @max(max_x, px + hx);
        min_y = @min(min_y, py - hy);
        max_y = @max(max_y, py + hy);
        min_z = @min(min_z, pz - hz);
        max_z = @max(max_z, pz + hz);
    }
    const span_x = max_x - min_x;
    const span_z = max_z - min_z;
    const radius = @max(8.0, @max(span_x, span_z) * 0.5);
    return .{
        .cx = (min_x + max_x) * 0.5,
        .cy = (min_y + max_y) * 0.5,
        .cz = (min_z + max_z) * 0.5,
        .radius = radius,
    };
}

pub fn instanceTop(insts: []const f32, row: usize, stride: usize) f32 {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return insts[b + 1] + @abs(insts[b + scale_base + 1]) * 0.5;
}

pub fn instanceCovers(insts: []const f32, row: usize, stride: usize, x: f32, z: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const hx = @abs(insts[b + scale_base + 0]) * 0.5;
    const hz = @abs(insts[b + scale_base + 2]) * 0.5;
    return x >= insts[b + 0] - hx and x <= insts[b + 0] + hx and
        z >= insts[b + 2] - hz and z <= insts[b + 2] + hz;
}

pub fn instanceYawRadians(insts: []const f32, row: usize, stride: usize) f32 {
    if (stride < 12) return 0;
    return insts[row * stride + 4] * std.math.pi / 180.0;
}

pub fn instanceShapeId(insts: []const f32, row: usize, stride: usize) f32 {
    if (stride < 13) return SHAPE_BOX;
    return insts[row * stride + 12];
}

pub fn isRampInstance(insts: []const f32, row: usize, stride: usize) bool {
    return @abs(instanceShapeId(insts, row, stride) - SHAPE_RAMP) < 0.5;
}

/// Decorative foliage — grass blades, bush clumps, palm fronds, flower heads — is
/// WALK-THROUGH and must NEVER become a physics collider (req_1607). The flora
/// recipe (req_1591) expands tens of thousands of these into render instances; if
/// the instance-derived physics paths (windowed huge maps + the pre-lump fallback)
/// turned each into a collider, you'd bump invisible flowers AND the blades would
/// saturate the MAX_ORIENTED budget, crowding REAL walls/props out of the near
/// field. Painted tree TRUNKS are decorative too (req_1676): a painted forest grows
/// tens of thousands of trunks and one collider each flooded MAX_RECTS on even a
/// small map for no real gameplay value, so they're walk-through like the fronds.
pub fn isNonCollidingFoliage(insts: []const f32, row: usize, stride: usize) bool {
    const s = instanceShapeId(insts, row, stride);
    return @abs(s - SHAPE_GRASS) < 0.5 or @abs(s - SHAPE_BUSH) < 0.5 or
        @abs(s - SHAPE_FROND) < 0.5 or @abs(s - SHAPE_FLOWER) < 0.5 or
        @abs(s - SHAPE_PALMTRUNK) < 0.5 or
        wrappedSpeciesForShape(s) != null or
        // Decorative scenery (the void shell's distant skyline) renders but never
        // collides — same reason as foliage: thousands of rows would saturate the
        // collider cap and you're meant to walk past, not into, the horizon.
        @abs(s - SHAPE_SCENERY_BOX) < 0.5 or
        @abs(s - SHAPE_CORNER_MITER) < 0.5 or
        @abs(s - SHAPE_CORNER_MITER_MIRROR) < 0.5;
}

pub const GeomPick = struct { key: []const u8, verts: []const f32, vert_count: u32 };

/// The keyed geometry (verts + count) for an instance SHAPE id — the ONE place
/// shape→geometry is resolved for the material draws (req_0939). Grass/bush and
/// any unknown shape fall back to the box; foliage is never material-skinned.
pub fn geomForShape(rt: anytype, shape: f32) GeomPick {
    if (@abs(shape - SHAPE_RAMP) < 0.5) return .{ .key = "ramp-slab", .verts = rt.ramp_slab[0..], .vert_count = 36 };
    if (@abs(shape - SHAPE_BOX_OPEN_RUN_MIN) < 0.5) return .{ .key = "box-open-run-min", .verts = rt.cube_open_run_min[0..], .vert_count = 30 };
    if (@abs(shape - SHAPE_BOX_OPEN_RUN_MAX) < 0.5) return .{ .key = "box-open-run-max", .verts = rt.cube_open_run_max[0..], .vert_count = 30 };
    if (@abs(shape - SHAPE_BOX_OPEN_RUN_BOTH) < 0.5) return .{ .key = "box-open-run-both", .verts = rt.cube_open_run_both[0..], .vert_count = 24 };
    if (@abs(shape - SHAPE_CYLINDER8) < 0.5) return .{ .key = "cylinder8", .verts = rt.cylinder8[0..], .vert_count = 8 * 12 };
    if (@abs(shape - SHAPE_CYLINDER16) < 0.5) return .{ .key = "cylinder16", .verts = rt.cylinder16[0..], .vert_count = 16 * 12 };
    if (@abs(shape - SHAPE_SPHERE) < 0.5) return .{ .key = "sphere12x8", .verts = rt.sphere[0..], .vert_count = 12 * 8 * 6 };
    if (@abs(shape - SHAPE_GABLE) < 0.5) return .{ .key = "gable-prism", .verts = rt.gable_prism[0..], .vert_count = 24 };
    if (@abs(shape - SHAPE_CORNER_MITER) < 0.5) return .{ .key = "corner-miter-prism", .verts = rt.corner_miter_prism[0..], .vert_count = 12 };
    if (@abs(shape - SHAPE_CORNER_MITER_MIRROR) < 0.5) return .{ .key = "corner-miter-mirror-prism", .verts = rt.corner_miter_mirror_prism[0..], .vert_count = 12 };
    if (wrappedSpeciesForShape(shape)) |species| {
        const mesh = &rt.wrapped_meshes[@intFromEnum(species)];
        return .{ .key = flora_geometry.geometryKey(species), .verts = mesh.constFloats(), .vert_count = mesh.vertex_count };
    }
    return .{ .key = "box", .verts = rt.cube[0..], .vert_count = 36 };
}

/// The 9 axis-aligned-rect collider floats for one instance row (shared by the
/// static build and the windowed rebuild).
pub fn rectFloats(insts: []const f32, row: usize, stride: usize, solid: bool) [game_physics.RECT_FLOATS]f32 {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const sx = @abs(insts[b + scale_base + 0]);
    const sy = @abs(insts[b + scale_base + 1]);
    const sz = @abs(insts[b + scale_base + 2]);
    const top = insts[b + 1] + sy * 0.5;
    const floor = instance_collider_policy.bandFloorY(insts[b + 1], sy);
    return .{
        insts[b + 0] - sx * 0.5,
        insts[b + 2] - sz * 0.5,
        insts[b + 0] + sx * 0.5,
        insts[b + 2] + sz * 0.5,
        top,
        if (solid) 1 else 0,
        PLAYER_SURFACE_FRICTION,
        PLAYER_SURFACE_RESTITUTION,
        floor,
    };
}

/// The 12 oriented-rect collider floats for one (yawed) instance row.
pub fn orientedFloats(insts: []const f32, row: usize, stride: usize, solid: bool) [game_physics.ORIENTED_FLOATS]f32 {
    const r = rectFloats(insts, row, stride, solid);
    return .{
        r[0],                    r[1],                    r[2],                                   r[3], r[4], r[5], r[6], r[7], r[8],
        insts[row * stride + 0], insts[row * stride + 2], instanceYawRadians(insts, row, stride),
    };
}
