//! Collider derivation, spatial indexing, spawn selection, and player physics.
//!
//! This is the CPU-side physics boundary: baked scene facts in, packed host inputs out.

const std = @import("std");
const constructor = @import("../world/constructor.zig");
const game_physics = @import("../game/physics.zig");
const instance_collider_policy = @import("../world/instance_collider_policy.zig");
const config = @import("config.zig");
const state = @import("state.zig");
const instances = @import("instances.zig");
const log = std.debug;
const SHAPE_PALMTRUNK = config.SHAPE_PALMTRUNK;
const PLAYER_RADIUS_METERS = config.PLAYER_RADIUS_METERS;
const PLAYER_HEIGHT_METERS = config.PLAYER_HEIGHT_METERS;
const PLAYER_STEP_HEIGHT_METERS = config.PLAYER_STEP_HEIGHT_METERS;
const PLAYER_WALL_RESTITUTION = config.PLAYER_WALL_RESTITUTION;
const PLAYER_SURFACE_FRICTION = config.PLAYER_SURFACE_FRICTION;
const PLAYER_SURFACE_RESTITUTION = config.PLAYER_SURFACE_RESTITUTION;
const PLAYER_ACCELERATION_MULTIPLIER = config.PLAYER_ACCELERATION_MULTIPLIER;
const PLAYER_GRAVITY_METERS_PER_SECOND2 = config.PLAYER_GRAVITY_METERS_PER_SECOND2;
const PLAYER_JUMP_SPEED_METERS_PER_SECOND = config.PLAYER_JUMP_SPEED_METERS_PER_SECOND;
const WALKABLE_SIDE_PUSH_GRACE_METERS = config.WALKABLE_SIDE_PUSH_GRACE_METERS;
const PHYSICS_SOLID_HEIGHT_METERS = config.PHYSICS_SOLID_HEIGHT_METERS;
const RAMP_HEIGHTFIELD_CELL_METERS = config.RAMP_HEIGHTFIELD_CELL_METERS;
const RAMP_WALKABLE_SLOPE_COS = config.RAMP_WALKABLE_SLOPE_COS;
const ELEVATOR_CAR_FRICTION = config.ELEVATOR_CAR_FRICTION;
const ELEVATOR_CAR_RESTITUTION = config.ELEVATOR_CAR_RESTITUTION;
const DOOR_PANEL_FRICTION = config.DOOR_PANEL_FRICTION;
const DOOR_PANEL_RESTITUTION = config.DOOR_PANEL_RESTITUTION;
const DOOR_OPEN_PARK_METERS = config.DOOR_OPEN_PARK_METERS;
const doorHalfExtents = state.doorHalfExtents;
const Vec3 = state.Vec3;
const PlayerState = state.PlayerState;
const PhysicsColliders = state.PhysicsColliders;
const PropBody = state.PropBody;
const cookedDoorWorldBox = state.cookedDoorWorldBox;
const solidVertexCount = state.solidVertexCount;
const clamp = state.clamp;
const Bounds = instances.Bounds;
const instanceTop = instances.instanceTop;
const instanceCovers = instances.instanceCovers;
const instanceYawRadians = instances.instanceYawRadians;
const isRampInstance = instances.isRampInstance;
const isNonCollidingFoliage = instances.isNonCollidingFoliage;
const rectFloats = instances.rectFloats;
const orientedFloats = instances.orientedFloats;

// A connected-vertex ISLAND of a cooked/imported mesh prop, boxed in the mesh's own
// local frame (anchor-centered XZ, ground-based Y — the SAME frame the render node
// is placed in). One island per disjoint piece, so a sign's two posts + overhead
// board collide as three banded boxes you walk under, not one full-bounds wall.
pub const MeshIsland = struct { lo: [3]f32, hi: [3]f32 };
pub const MAX_MESH_ISLANDS: usize = 24;

pub fn ufFind(parent: []u32, a0: u32) u32 {
    var a = a0;
    while (parent[a] != a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
    }
    return a;
}

/// The whole mesh as ONE box — the legacy full-bounds collider (anchor-centered XZ,
/// ground→height in Y). Only for a mesh with no scannable vertices: the centering
/// ASSUMES symmetry about the anchor, which an authored mesh rarely has.
pub fn meshFullBoundsIsland(mesh: constructor.MeshPropMesh) MeshIsland {
    return .{
        .lo = .{ -mesh.footprint_width / 2.0, 0, -mesh.footprint_depth / 2.0 },
        .hi = .{ mesh.footprint_width / 2.0, mesh.height, mesh.footprint_depth / 2.0 },
    };
}

/// The whole mesh as ONE box from its ACTUAL vertex bounds (req_2836: the centered
/// footprint box overhangs an off-center mesh — an invisible wall on one side,
/// pass-through on the other). Falls back to the centered form when no solid
/// vertices exist to scan.
pub fn meshVertexBoundsIsland(mesh: constructor.MeshPropMesh) MeshIsland {
    const vc: usize = solidVertexCount(mesh);
    if (vc == 0 or mesh.vertices.len < 8) return meshFullBoundsIsland(mesh);
    var isl = MeshIsland{
        .lo = .{ mesh.vertices[0], mesh.vertices[1], mesh.vertices[2] },
        .hi = .{ mesh.vertices[0], mesh.vertices[1], mesh.vertices[2] },
    };
    var vi: usize = 1;
    while (vi < vc and (vi * 8 + 2) < mesh.vertices.len) : (vi += 1) {
        const b = vi * 8;
        inline for (0..3) |a| {
            const v = mesh.vertices[b + a];
            if (v < isl.lo[a]) isl.lo[a] = v;
            if (v > isl.hi[a]) isl.hi[a] = v;
        }
    }
    return isl;
}

/// The 12 oriented-collider floats for one island of one placed mesh-prop instance —
/// the island's local AABB offset to the anchor and banded by its OWN Y range (an
/// overhead board bands high → walk-under), then yawed about the anchor like the mesh.
pub fn islandOrientedFloats(inst: constructor.MeshPropInstance, isl: MeshIsland) [game_physics.ORIENTED_FLOATS]f32 {
    return .{
        inst.x + isl.lo[0],
        inst.z + isl.lo[2],
        inst.x + isl.hi[0],
        inst.z + isl.hi[2],
        inst.y + isl.hi[1], // top — the island's own ceiling
        1,
        PLAYER_SURFACE_FRICTION,
        PLAYER_SURFACE_RESTITUTION,
        inst.y + isl.lo[1], // floor — the island's own base (banded: walk under a high one)
        inst.x,
        inst.z,
        inst.yaw_degrees * std.math.pi / 180.0,
    };
}

/// Split a cooked/imported mesh prop into connected vertex ISLANDS (weld coincident
/// positions to a 1mm grid, union the three verts of every triangle) and box each, so
/// a sign authored as two posts + an overhead board collides as three banded boxes the
/// player walks under — instead of one full-bounds block (req_1624: "can't walk under
/// the big sign"). A single welded mesh yields ONE island == the old full-bounds box
/// (no regression). A soup too fractured to separate (> MAX_MESH_ISLANDS components)
/// also falls back to the one box, so a degenerate mesh can't explode the oriented
/// budget. Non-solid / empty meshes contribute nothing. Caller owns the returned slice.
pub fn meshPropIslands(allocator: std.mem.Allocator, mesh: constructor.MeshPropMesh) ![]MeshIsland {
    if (!mesh.solid or mesh.footprint_width <= 0 or mesh.footprint_depth <= 0) {
        return allocator.alloc(MeshIsland, 0);
    }
    // req_1900: a cooked prop ships the cook's AUTHORED collider boxes (one per
    // connected component, the door leaf already excluded). Use them verbatim so a
    // doorway / archway keeps its real gap — welding a bridged frame collapses it
    // into one solid full-bounds box that seals the opening. Local-frame AABBs,
    // banded by their own Y (a header bands high → walk under it).
    if (mesh.collision_boxes.len > 0) {
        const n = @min(mesh.collision_boxes.len, MAX_MESH_ISLANDS);
        const out = try allocator.alloc(MeshIsland, n);
        for (out, 0..) |*isl, i| {
            const b = mesh.collision_boxes[i];
            isl.* = .{ .lo = .{ b.min_x, b.min_y, b.min_z }, .hi = .{ b.max_x, b.max_y, b.max_z } };
        }
        return out;
    }
    // req_1864: a cooked door's leaf is the LIVE two-state panel (its own rect),
    // never a static island — so the body islands stop before the leaf slot.
    const vc: usize = solidVertexCount(mesh);
    const oneBox = struct {
        fn make(a: std.mem.Allocator, m: constructor.MeshPropMesh) ![]MeshIsland {
            const out = try a.alloc(MeshIsland, 1);
            out[0] = meshVertexBoundsIsland(m); // req_2836: true bounds, never the centered guess
            return out;
        }
    }.make;
    if (vc < 3 or mesh.vertices.len < vc * 8) return oneBox(allocator, mesh);

    // Weld coincident vertex positions → a representative id per vertex.
    var weld = std.AutoHashMap([3]i64, u32).init(allocator);
    defer weld.deinit();
    const rep = try allocator.alloc(u32, vc);
    defer allocator.free(rep);
    var uniq: u32 = 0;
    var vi: usize = 0;
    while (vi < vc) : (vi += 1) {
        const b = vi * 8;
        const key = [3]i64{
            @intFromFloat(@round(mesh.vertices[b] * 1000.0)),
            @intFromFloat(@round(mesh.vertices[b + 1] * 1000.0)),
            @intFromFloat(@round(mesh.vertices[b + 2] * 1000.0)),
        };
        const gop = try weld.getOrPut(key);
        if (!gop.found_existing) {
            gop.value_ptr.* = uniq;
            uniq += 1;
        }
        rep[vi] = gop.value_ptr.*;
    }

    // Union the three welded verts of every triangle.
    const parent = try allocator.alloc(u32, uniq);
    defer allocator.free(parent);
    for (parent, 0..) |*p, i| p.* = @intCast(i);
    var ti: usize = 0;
    while (ti + 3 <= vc) : (ti += 3) {
        const ra = ufFind(parent, rep[ti]);
        const rb = ufFind(parent, rep[ti + 1]);
        const rc = ufFind(parent, rep[ti + 2]);
        if (ra != rb) parent[rb] = ra;
        const rc2 = ufFind(parent, rc);
        if (ra != rc2) parent[rc2] = ra;
    }

    // Accumulate each component's local AABB.
    var roots = std.AutoHashMap(u32, usize).init(allocator);
    defer roots.deinit();
    var islands = std.ArrayList(MeshIsland){};
    defer islands.deinit(allocator);
    vi = 0;
    while (vi < vc) : (vi += 1) {
        const b = vi * 8;
        const x = mesh.vertices[b];
        const y = mesh.vertices[b + 1];
        const z = mesh.vertices[b + 2];
        const root = ufFind(parent, rep[vi]);
        const gop = try roots.getOrPut(root);
        if (!gop.found_existing) {
            if (islands.items.len >= MAX_MESH_ISLANDS) return oneBox(allocator, mesh); // too fractured
            gop.value_ptr.* = islands.items.len;
            try islands.append(allocator, .{ .lo = .{ x, y, z }, .hi = .{ x, y, z } });
        }
        const isl = &islands.items[gop.value_ptr.*];
        if (x < isl.lo[0]) isl.lo[0] = x;
        if (x > isl.hi[0]) isl.hi[0] = x;
        if (y < isl.lo[1]) isl.lo[1] = y;
        if (y > isl.hi[1]) isl.hi[1] = y;
        if (z < isl.lo[2]) isl.lo[2] = z;
        if (z > isl.hi[2]) isl.hi[2] = z;
    }
    if (islands.items.len <= 1) return oneBox(allocator, mesh); // one piece → the clean full-bounds box
    return islands.toOwnedSlice(allocator);
}

pub fn appendPhysicsRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    try list.appendSlice(allocator, &rectFloats(insts, row, stride, solid));
}

pub fn appendPhysicsOrientedRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    try list.appendSlice(allocator, &orientedFloats(insts, row, stride, solid));
}

pub fn registerRampHeightfield(insts: []const f32, row: usize, stride: usize, slot: usize) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const width = @abs(insts[b + scale_base + 0]);
    const rise = @abs(insts[b + scale_base + 1]);
    const depth = @abs(insts[b + scale_base + 2]);
    if (width <= 0.001 or rise <= 0.001 or depth <= 0.001) return false;
    const cols: usize = @max(2, @as(usize, @intFromFloat(@round(width / RAMP_HEIGHTFIELD_CELL_METERS))) + 1);
    const rows: usize = @max(2, @as(usize, @intFromFloat(@round(depth / RAMP_HEIGHTFIELD_CELL_METERS))) + 1);
    const count = cols * rows;
    if (count > game_physics.HF_MAX_SAMPLES) return false;
    var samples: [game_physics.HF_MAX_SAMPLES]f32 = [_]f32{0} ** game_physics.HF_MAX_SAMPLES;
    var r: usize = 0;
    while (r < rows) : (r += 1) {
        const h = (@as(f32, @floatFromInt(r)) / @as(f32, @floatFromInt(rows - 1))) * rise;
        var cidx: usize = 0;
        while (cidx < cols) : (cidx += 1) {
            samples[r * cols + cidx] = h;
        }
    }
    const base_y = insts[b + 1] - rise * 0.5;
    const sample_bytes = std.mem.sliceAsBytes(samples[0..count]);
    return game_physics.registerHeightfield(.{
        .id = slot,
        .origin_x = insts[b + 0] - width * 0.5,
        .origin_z = insts[b + 2] - depth * 0.5,
        .cell = RAMP_HEIGHTFIELD_CELL_METERS,
        .cols = cols,
        .rows = rows,
        .base_y = base_y,
        .walk_cos = RAMP_WALKABLE_SLOPE_COS,
        .yaw = instanceYawRadians(insts, row, stride),
        .pivot_x = insts[b + 0],
        .pivot_z = insts[b + 2],
    }, sample_bytes);
}

pub fn registerSceneHeightfield(field: constructor.HeightfieldMesh, slot: usize) bool {
    const count = @as(usize, field.cols) * @as(usize, field.rows);
    if (count == 0 or count > game_physics.HF_MAX_SAMPLES) return false;
    const sample_bytes = std.mem.sliceAsBytes(field.heights[0..count]);
    return game_physics.registerHeightfield(.{
        .id = slot,
        .origin_x = field.center_x - field.width * 0.5,
        .origin_z = field.center_z - field.depth * 0.5,
        .cell = field.cell,
        .cols = field.cols,
        .rows = field.rows,
        .base_y = field.base_y,
        .walk_cos = field.walk_cos,
    }, sample_bytes);
}

/// Register a baked ramp/stair slope (placedPieceRamps) as a host heightfield
/// collider — the authored slope the editor walks up, not an instance guess.
pub fn registerColliderField(field: constructor.ColliderField, slot: usize) bool {
    const count = @as(usize, field.cols) * @as(usize, field.rows);
    if (count == 0 or count > game_physics.HF_MAX_SAMPLES) return false;
    const sample_bytes = std.mem.sliceAsBytes(field.heights[0..count]);
    return game_physics.registerHeightfield(.{
        .id = slot,
        .origin_x = field.origin_x,
        .origin_z = field.origin_z,
        .cell = field.cell,
        .cols = field.cols,
        .rows = field.rows,
        .base_y = field.base_y,
        .walk_cos = field.walk_cos,
        .yaw = field.yaw,
        .pivot_x = field.pivot_x,
        .pivot_z = field.pivot_z,
    }, sample_bytes);
}

pub fn maxAbsHeight(heights: []const f32) f32 {
    var max_abs: f32 = 0;
    for (heights) |height| max_abs = @max(max_abs, @abs(height));
    return max_abs;
}

/// Content fingerprint for a terrain heightfield — its grid dims + every height
/// sample. This rides the ~hf~ geometry key as the VERSION so the host's dyn-slot
/// cache (framework/gpu/3d.zig) rebuilds the mesh when the field's shape changes.
/// Without it the version was a constant "1": recompiling a new/edited heightfield
/// into an ALREADY-RUNNING process (the Compile → reload loop, the pop-out window)
/// reused the prior mount's cached mesh and the new terrain never rendered until a
/// full restart cleared the cache (req_1290).
pub fn heightfieldContentHash(field: constructor.HeightfieldMesh) u64 {
    var h = std.hash.Wyhash.init(0);
    h.update(std.mem.asBytes(&field.cols));
    h.update(std.mem.asBytes(&field.rows));
    h.update(std.mem.sliceAsBytes(field.heights));
    return h.final();
}

pub fn buildPhysicsColliders(allocator: std.mem.Allocator, scene: constructor.Scene, insts: []const f32, inst_count: u32, stride: usize, entity_capacity: usize, mesh_islands: []const []MeshIsland) !PhysicsColliders {
    const entity_floats = entity_capacity * game_physics.ENTITY_FLOATS;
    var rects: std.ArrayList(f32) = .{};
    errdefer rects.deinit(allocator);
    var oriented: std.ArrayList(f32) = .{};
    errdefer oriented.deinit(allocator);
    var rect_count: usize = 0;
    var oriented_count: usize = 0;
    var heightfield_count: usize = 0;
    var clipped_rows: usize = 0;

    game_physics.clearHeightfields();
    for (scene.heightfields) |field| {
        if (heightfield_count < game_physics.MAX_HEIGHTFIELDS and registerSceneHeightfield(field, heightfield_count)) {
            heightfield_count += 1;
        } else {
            clipped_rows += 1;
        }
    }

    // AUTHORED colliders present → step against THEM (the editor's +-join-aware
    // wall / floor / ramp solids), not a guess re-derived from the render boxes.
    // The painted-floor heightfields above already collide; here we add the
    // baked ramp slopes and hand the rects/oriented straight to the step (they
    // are already packed in host wire order). Absent → fall through to the
    // instance-derived path below (pre-lump bakes).
    if (scene.baked_colliders) |bc| {
        for (bc.ramps) |ramp| {
            if (heightfield_count < game_physics.MAX_HEIGHTFIELDS and registerColliderField(ramp, heightfield_count)) {
                heightfield_count += 1;
            } else {
                clipped_rows += 1;
            }
        }
        // The baked solids ARE the authored PIECES (walls/floors/pillars) — copy
        // them in host wire order. Clamp to the host caps (step @min-clamps the
        // counts; copying past the cap would slide the oriented slice into rect
        // data). A normal authored map is far under the caps.
        const kept_rects = @min(@as(usize, bc.rect_count), game_physics.MAX_RECTS);
        const kept_oriented = @min(@as(usize, bc.oriented_count), game_physics.MAX_ORIENTED);
        clipped_rows += (@as(usize, bc.rect_count) - kept_rects) + (@as(usize, bc.oriented_count) - kept_oriented);
        try rects.appendSlice(allocator, bc.rects[0 .. kept_rects * game_physics.RECT_FLOATS]);
        rect_count = kept_rects;

        try oriented.appendSlice(allocator, bc.oriented[0 .. kept_oriented * game_physics.ORIENTED_FLOATS]);
        oriented_count = kept_oriented;

        // Imported OBJ/GLB props are not part of the instanced primitive buffer,
        // so their static blocking footprint rides the MESH_PROPS lump. Use the
        // measured local X/Z rectangle from the importer; a desk stays narrow on
        // its short axis instead of colliding as a radius square.
        if (scene.mesh_props) |mp| {
            outer: for (mp.instances, 0..) |inst, imported_index| {
                const mi: usize = @intCast(inst.mesh);
                const isls = if (mi < mesh_islands.len) mesh_islands[mi] else &[_]MeshIsland{};
                for (isls) |isl| {
                    if (oriented_count >= game_physics.MAX_ORIENTED) {
                        clipped_rows += mp.instances.len - imported_index;
                        break :outer;
                    }
                    try oriented.appendSlice(allocator, &islandOrientedFloats(inst, isl));
                    oriented_count += 1;
                }
            }
        }

        // LIVE elevator car rects (req_0652): one per ELEVATORS-lump shaft,
        // appended AFTER the baked rects so stepElevators can re-aim their
        // top/floor floats in place per frame (the step reads this same
        // buffer every frame — a rising top carries the standing player).
        // Cars spawn parked at each shaft's bottom stop. `break` on cap keeps
        // cars[i] ↔ shafts[i] aligned (a partial tail would skew indices).
        var car_rect_start: usize = 0;
        var car_count: usize = 0;
        if (scene.elevators) |el| {
            car_rect_start = rect_count;
            for (el.shafts) |shaft| {
                if (rect_count >= game_physics.MAX_RECTS) {
                    clipped_rows += el.shafts.len - car_count;
                    break;
                }
                const rest = shaft.stops[0];
                try rects.appendSlice(allocator, &[_]f32{
                    shaft.x - shaft.car_half_x, // minX
                    shaft.z - shaft.car_half_z, // minZ
                    shaft.x + shaft.car_half_x, // maxX
                    shaft.z + shaft.car_half_z, // maxZ
                    rest + shaft.car_thickness, // top (the standable car surface)
                    1, // blocksPlayer
                    ELEVATOR_CAR_FRICTION,
                    ELEVATOR_CAR_RESTITUTION,
                    rest, // floor (banded: walk under a risen car)
                });
                rect_count += 1;
                car_count += 1;
            }
        }

        // LIVE door panel rects (DOORS-0611): one per DOORS-lump record,
        // appended after the cars so the E toggle can flip blocksPlayer in
        // place. AABB of the yawed panel (quarter-turn walls — exact).
        var door_rect_start: usize = 0;
        var door_count: usize = 0;
        if (scene.doors) |doors| {
            door_rect_start = rect_count;
            for (doors.records) |door| {
                if (rect_count >= game_physics.MAX_RECTS) {
                    clipped_rows += doors.records.len - door_count;
                    break;
                }
                const half = doorHalfExtents(door);
                const park: f32 = if (door.start_open) DOOR_OPEN_PARK_METERS else 0;
                try rects.appendSlice(allocator, &[_]f32{
                    door.x - half[0] + park, // minX (an open door's rect parks out of the world)
                    door.z - half[1] + park, // minZ
                    door.x + half[0] + park, // maxX
                    door.z + half[1] + park, // maxZ
                    door.base_y + door.panel_h, // top
                    if (door.start_open) 0 else 1, // blocksPlayer
                    DOOR_PANEL_FRICTION,
                    DOOR_PANEL_RESTITUTION,
                    door.base_y, // floor (banded with the wall's storey)
                });
                rect_count += 1;
                door_count += 1;
            }
        }

        // LIVE cooked-door panel rects (req_1864): one toggleable rect per cooked
        // door mesh-prop instance, in mp.instances order (so collectCookedDoors
        // aligns rect_index = start + i). Same park/blocksPlayer machinery as the
        // DOORS-lump doors, but the world box comes from the custom leaf slot.
        var cooked_door_rect_start: usize = 0;
        var cooked_door_count: usize = 0;
        if (scene.mesh_props) |mp| {
            cooked_door_rect_start = rect_count;
            cooked: for (mp.instances) |inst| {
                const mi: usize = @intCast(inst.mesh);
                if (mi >= mp.meshes.len) continue;
                const box = cookedDoorWorldBox(mp.meshes[mi], inst) orelse continue;
                if (rect_count >= game_physics.MAX_RECTS) {
                    clipped_rows += 1;
                    break :cooked;
                }
                const park: f32 = if (box.open) DOOR_OPEN_PARK_METERS else 0;
                try rects.appendSlice(allocator, &[_]f32{
                    box.cx - box.half_x + park, // minX
                    box.cz - box.half_z + park, // minZ
                    box.cx + box.half_x + park, // maxX
                    box.cz + box.half_z + park, // maxZ
                    box.base_y + box.panel_h, // top
                    if (box.open) 0 else 1, // blocksPlayer
                    DOOR_PANEL_FRICTION,
                    DOOR_PANEL_RESTITUTION,
                    box.base_y, // floor (banded with the door's storey)
                });
                rect_count += 1;
                cooked_door_count += 1;
            }
        }

        // We DON'T derive any colliders from the render instances here — exactly
        // like /test, the pieces collide ONLY through the baked colliders above
        // and the painted ground through the heightfields. The instance fallback
        // now keeps real vertical bands too, but the baked colliders still own the
        // authored semantics: door cuts, wall joins, half-height edits, and exact
        // floor/roof slabs. (Heightfields above handle the ground; baked
        // rects/oriented handle every authored piece.)

        // Palm trees are DECORATION (req_1676): no per-trunk colliders. A painted
        // palm field grows tens of thousands of trunks; one rect collider each
        // (req_1454) flooded MAX_RECTS on even a small authored map and gave no
        // real gameplay value (you brush past palms in a grove, you don't path
        // around 25k poles). isNonCollidingFoliage now skips SHAPE_PALMTRUNK too,
        // so the windowed/instance paths agree. Re-enable here + remove the skip
        // if a map ever needs solid individual trees.

        const values = try allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + entity_floats + rects.items.len + oriented.items.len);
        @memset(values, 0);
        const rect_base = game_physics.INPUT_HEADER_FLOATS + entity_floats;
        @memcpy(values[rect_base .. rect_base + rects.items.len], rects.items);
        @memcpy(values[rect_base + rects.items.len ..], oriented.items);
        rects.deinit(allocator);
        oriented.deinit(allocator);
        return .{
            .values = values,
            .rect_count = rect_count,
            .oriented_count = oriented_count,
            .heightfield_count = heightfield_count,
            .clipped_rows = clipped_rows,
            .entity_capacity = entity_capacity,
            .car_rect_start = car_rect_start,
            .car_count = car_count,
            .door_rect_start = door_rect_start,
            .door_count = door_count,
            .cooked_door_rect_start = cooked_door_rect_start,
            .cooked_door_count = cooked_door_count,
        };
    }

    // Two passes so WALKABLE FLOORS win the collider cap over solid walls. A
    // huge world (the --massive scale lab) has far more instances than MAX_RECTS;
    // if buildings (which lead the buffer) fill the cap first, the ground gets
    // clipped and the player falls through the world. Registering floors first
    // guarantees the ground you stand on always collides — at worst, distant
    // walls become walk-through, never the floor. For real bakes (< MAX_RECTS
    // instances) this is a no-op: everything fits regardless of order.
    const total_rows: usize = @intCast(inst_count);
    var pass: usize = 0;
    while (pass < 2) : (pass += 1) {
        const want_solid = pass == 1;
        var row: usize = 0;
        while (row < total_rows) : (row += 1) {
            if (isRampInstance(insts, row, stride)) {
                if (want_solid) continue; // ramps are heightfields — registered in the floor pass
                if (heightfield_count < game_physics.MAX_HEIGHTFIELDS and registerRampHeightfield(insts, row, stride, heightfield_count)) {
                    heightfield_count += 1;
                } else {
                    clipped_rows += 1;
                }
                continue;
            }
            if (isNonCollidingFoliage(insts, row, stride)) continue; // grass/bush/frond/flower/scenery = walk-through (req_1607)
            const scale_base: usize = if (stride >= 12) 6 else 3;
            const b = row * stride;
            const sx = @abs(insts[b + scale_base + 0]);
            const sy = @abs(insts[b + scale_base + 1]);
            const sz = @abs(insts[b + scale_base + 2]);
            if (sx <= 0.001 or sy <= 0.001 or sz <= 0.001) continue;
            const solid = instance_collider_policy.blocksPlayerByHeight(sy, PHYSICS_SOLID_HEIGHT_METERS);
            if (solid != want_solid) continue; // floors in pass 0, walls in pass 1
            const yaw = instanceYawRadians(insts, row, stride);
            if (@abs(yaw) > 0.0001) {
                if (oriented_count >= game_physics.MAX_ORIENTED) {
                    clipped_rows += 1;
                    continue;
                }
                try appendPhysicsOrientedRect(allocator, &oriented, insts, row, stride, solid);
                oriented_count += 1;
            } else {
                if (rect_count >= game_physics.MAX_RECTS) {
                    clipped_rows += 1;
                    continue;
                }
                try appendPhysicsRect(allocator, &rects, insts, row, stride, solid);
                rect_count += 1;
            }
        }
    }

    var values = try allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + entity_floats + rects.items.len + oriented.items.len);
    @memset(values, 0);
    const rect_base = game_physics.INPUT_HEADER_FLOATS + entity_floats;
    @memcpy(values[rect_base .. rect_base + rects.items.len], rects.items);
    @memcpy(values[rect_base + rects.items.len ..], oriented.items);
    rects.deinit(allocator);
    oriented.deinit(allocator);
    return .{ .values = values, .rect_count = rect_count, .oriented_count = oriented_count, .heightfield_count = heightfield_count, .clipped_rows = clipped_rows, .entity_capacity = entity_capacity };
}

// ── spatial collider windowing (huge maps) ─────────────────────────────────
// When the full collider set overflows MAX_RECTS (a --massive city), collide only
// the instances NEAR the player, rebuilt as they move, so the whole world is solid
// in the near field. Local instances bucket into a uniform grid; world-spanning
// instances (the ground slab, the long road strips) bucket by center into ONE cell,
// so they are pulled into an ALWAYS list every rebuild includes — that keeps the
// floor under the player everywhere, not just near the world origin.
pub const COLLIDER_CELL_METERS: f32 = 64.0;
pub const COLLIDER_WINDOW_CELLS: i32 = 3; // gather ±3 cells around the player (7×7 ≈ 448m)

pub fn clampCell(v: i32, n: i32) i32 {
    return @max(0, @min(n - 1, v));
}

pub const SpatialGrid = struct {
    cell: f32,
    min_x: f32,
    min_z: f32,
    cols: i32,
    rows: i32,
    starts: []u32, // CSR offsets, len cols*rows+1
    items: []u32, // local row indices, bucketed by cell
    always: []u32, // world-spanning rows, included in every rebuild

    pub fn deinit(self: SpatialGrid, allocator: std.mem.Allocator) void {
        allocator.free(self.starts);
        allocator.free(self.items);
        allocator.free(self.always);
    }

    pub fn cellXZ(self: SpatialGrid, x: f32, z: f32) struct { cx: i32, cz: i32 } {
        const cx = clampCell(@as(i32, @intFromFloat(@floor((x - self.min_x) / self.cell))), self.cols);
        const cz = clampCell(@as(i32, @intFromFloat(@floor((z - self.min_z) / self.cell))), self.rows);
        return .{ .cx = cx, .cz = cz };
    }
};

pub fn instIsSpanning(insts: []const f32, row: usize, stride: usize, cell: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return @abs(insts[b + scale_base + 0]) > cell or @abs(insts[b + scale_base + 2]) > cell;
}

pub fn gridCellIndex(insts: []const f32, row: usize, stride: usize, min_x: f32, min_z: f32, cell: f32, cols: i32, rows: i32) usize {
    const b = row * stride;
    const cx = clampCell(@as(i32, @intFromFloat(@floor((insts[b + 0] - min_x) / cell))), cols);
    const cz = clampCell(@as(i32, @intFromFloat(@floor((insts[b + 2] - min_z) / cell))), rows);
    return @intCast(cz * cols + cx);
}

/// Bucket every instance into a uniform grid (local rows) + an always list
/// (world-spanning rows). One O(n) classify/count pass, a prefix sum, one scatter.
pub fn buildSpatialGrid(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize) !SpatialGrid {
    const cell = COLLIDER_CELL_METERS;
    var min_x: f32 = std.math.floatMax(f32);
    var min_z: f32 = std.math.floatMax(f32);
    var max_x: f32 = -std.math.floatMax(f32);
    var max_z: f32 = -std.math.floatMax(f32);
    var i: usize = 0;
    while (i < inst_count) : (i += 1) {
        const b = i * stride;
        min_x = @min(min_x, insts[b + 0]);
        max_x = @max(max_x, insts[b + 0]);
        min_z = @min(min_z, insts[b + 2]);
        max_z = @max(max_z, insts[b + 2]);
    }
    const cols = @max(1, @as(i32, @intFromFloat(@floor((max_x - min_x) / cell))) + 1);
    const rows = @max(1, @as(i32, @intFromFloat(@floor((max_z - min_z) / cell))) + 1);
    const ncells: usize = @intCast(@as(i64, cols) * @as(i64, rows));

    var starts = try allocator.alloc(u32, ncells + 1);
    errdefer allocator.free(starts);
    @memset(starts, 0);

    var local_count: usize = 0;
    var always_count: usize = 0;
    i = 0;
    while (i < inst_count) : (i += 1) {
        if (instIsSpanning(insts, i, stride, cell)) {
            always_count += 1;
        } else {
            starts[gridCellIndex(insts, i, stride, min_x, min_z, cell, cols, rows) + 1] += 1;
            local_count += 1;
        }
    }
    var s: usize = 0;
    while (s < ncells) : (s += 1) starts[s + 1] += starts[s];

    var items = try allocator.alloc(u32, local_count);
    errdefer allocator.free(items);
    var always = try allocator.alloc(u32, always_count);
    errdefer allocator.free(always);
    var cursor = try allocator.alloc(u32, ncells);
    defer allocator.free(cursor);
    @memcpy(cursor, starts[0..ncells]);

    var ai: usize = 0;
    i = 0;
    while (i < inst_count) : (i += 1) {
        if (instIsSpanning(insts, i, stride, cell)) {
            always[ai] = @intCast(i);
            ai += 1;
        } else {
            const cidx = gridCellIndex(insts, i, stride, min_x, min_z, cell, cols, rows);
            items[cursor[cidx]] = @intCast(i);
            cursor[cidx] += 1;
        }
    }
    return .{ .cell = cell, .min_x = min_x, .min_z = min_z, .cols = cols, .rows = rows, .starts = starts, .items = items, .always = always };
}

pub fn runPlayerPhysics(player: *PlayerState, colliders: *PhysicsColliders, dt: f32, intent: game_physics.movement.Direction, speed: f32, jump_down: bool, cfg: ?constructor.PhysicsConfig, bodies: []PropBody) void {
    if (colliders.values.len < game_physics.INPUT_HEADER_FLOATS) return;
    const input = colliders.values;
    // The dynamic-body entity section (KICKPROP req_0625): live body state in,
    // stepped state out. `bodies.len == colliders.entity_capacity` by
    // construction (both come from the DYNAMIC_PROPS lump at build).
    for (bodies, 0..) |b, i| {
        const at = game_physics.INPUT_HEADER_FLOATS + i * game_physics.ENTITY_FLOATS;
        input[at] = b.x;
        input[at + 1] = b.y;
        input[at + 2] = b.z;
        input[at + 3] = b.vx;
        input[at + 4] = b.vy;
        input[at + 5] = b.vz;
        input[at + 6] = b.radius;
        input[at + 7] = b.restitution;
    }
    input[0] = dt;
    input[1] = intent.x;
    input[2] = intent.z;
    input[3] = speed;
    input[4] = if (jump_down) 1 else 0;
    input[5] = player.x;
    input[6] = player.y;
    input[7] = player.z;
    input[8] = player.vx;
    input[9] = player.vy;
    input[10] = player.vz;
    // Slots 11–23 are the player tuning. With a baked PHYSICS_CONFIG lump they
    // come from the editor's own config (so the shipped game feels identical);
    // without it they fall back to the loader's built-in constants.
    input[11] = if (cfg) |cf| cf.walkable_side_push_grace else WALKABLE_SIDE_PUSH_GRACE_METERS;
    input[12] = @floatFromInt(bodies.len);
    input[13] = @floatFromInt(colliders.rect_count);
    input[14] = if (cfg) |cf| cf.gravity else PLAYER_GRAVITY_METERS_PER_SECOND2;
    input[15] = if (cfg) |cf| cf.jump_speed else PLAYER_JUMP_SPEED_METERS_PER_SECOND;
    input[16] = if (cfg) |cf| cf.player_radius else PLAYER_RADIUS_METERS;
    input[17] = if (cfg) |cf| cf.player_height else PLAYER_HEIGHT_METERS;
    input[18] = if (cfg) |cf| cf.wall_restitution else PLAYER_WALL_RESTITUTION;
    input[19] = if (cfg) |cf| cf.body_restitution else 0;
    input[20] = if (cfg) |cf| cf.step_height else PLAYER_STEP_HEIGHT_METERS;
    input[21] = if (cfg) |cf| cf.accel_mult else PLAYER_ACCELERATION_MULTIPLIER;
    input[22] = if (cfg) |cf| cf.surface_friction else PLAYER_SURFACE_FRICTION;
    input[23] = if (cfg) |cf| cf.surface_restitution else PLAYER_SURFACE_RESTITUTION;
    input[24] = @floatFromInt(colliders.oriented_count);

    const out = game_physics.step(input) orelse return;
    player.x = out[1];
    player.y = out[2];
    player.z = out[3];
    player.vx = out[4];
    player.vy = out[5];
    player.vz = out[6];
    player.grounded = out[7] > 0.5;
    // Commit the stepped bodies back — gravity, bounce, the player kick, and
    // sphere-sphere shoves all came from the one host step.
    const stepped = @min(bodies.len, @as(usize, @intFromFloat(@max(0, out[8]))));
    for (bodies[0..stepped], 0..) |*b, i| {
        const at = game_physics.OUTPUT_HEADER_FLOATS + i * game_physics.ENTITY_FLOATS;
        b.x = out[at];
        b.y = out[at + 1];
        b.z = out[at + 2];
        b.vx = out[at + 3];
        b.vy = out[at + 4];
        b.vz = out[at + 5];
    }
    const horizontal_speed = @sqrt(player.vx * player.vx + player.vz * player.vz);
    if (horizontal_speed > 0.05) {
        player.yaw = std.math.atan2(player.vx, player.vz);
    } else if (@sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001) {
        player.yaw = std.math.atan2(intent.x, intent.z);
    }
}

/// The painted-terrain surface at (x, z): the highest heightfield sample under
/// the point, or null when no field covers it. Nearest-sample is enough here —
/// the spawn adds a drop clearance and settles through physics.
pub fn sceneTerrainTopAt(fields: []const constructor.HeightfieldMesh, x: f32, z: f32) ?f32 {
    var best: ?f32 = null;
    for (fields) |field| {
        if (field.cols == 0 or field.rows == 0 or field.cell <= 0) continue;
        const origin_x = field.center_x - field.width * 0.5;
        const origin_z = field.center_z - field.depth * 0.5;
        if (x < origin_x or z < origin_z or x > origin_x + field.width or z > origin_z + field.depth) continue;
        const max_col: f32 = @floatFromInt(field.cols - 1);
        const max_row: f32 = @floatFromInt(field.rows - 1);
        const col: usize = @intFromFloat(@round(std.math.clamp((x - origin_x) / field.cell, 0, max_col)));
        const row: usize = @intFromFloat(@round(std.math.clamp((z - origin_z) / field.cell, 0, max_row)));
        const idx = row * @as(usize, field.cols) + col;
        if (idx >= field.heights.len) continue;
        const top = field.base_y + field.heights[idx];
        if (best == null or top > best.?) best = top;
    }
    return best;
}

pub fn chooseSpawn(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, bounds: Bounds) Vec3 {
    // Spawn at the CITY, not the geometric centre of every road stripe on the
    // map (req_0526): when authored pieces exist, their bbox centre is where
    // the user's content is — the all-instance centre landed on a bare road
    // line hundreds of meters from anything built.
    var wanted_x = bounds.cx;
    var wanted_z = bounds.cz;
    if (piece_count > 0) {
        var min_px: f32 = std.math.floatMax(f32);
        var max_px: f32 = -std.math.floatMax(f32);
        var min_pz: f32 = std.math.floatMax(f32);
        var max_pz: f32 = -std.math.floatMax(f32);
        var pr: usize = 0;
        const pieces_end: usize = @min(@as(usize, @intCast(piece_count)), @as(usize, @intCast(inst_count)));
        while (pr < pieces_end) : (pr += 1) {
            const pb = pr * stride;
            min_px = @min(min_px, insts[pb + 0]);
            max_px = @max(max_px, insts[pb + 0]);
            min_pz = @min(min_pz, insts[pb + 2]);
            max_pz = @max(max_pz, insts[pb + 2]);
        }
        if (min_px <= max_px) {
            wanted_x = (min_px + max_px) * 0.5;
            wanted_z = (min_pz + max_pz) * 0.5;
        }
    }
    var best_row: ?usize = null;
    var best_dist2: f32 = std.math.floatMax(f32);
    const total_rows: usize = @intCast(inst_count);
    // ALL rows, pieces included (req_0526): this map's only non-piece flat rows
    // are 1m road stripes — the real standable floors ARE the authored piece
    // plates. Spawning on the city's own floor beats a stripe in the void.
    var row: usize = 0;
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        const sx = @abs(insts[b + scale_base + 0]);
        const sy = @abs(insts[b + scale_base + 1]);
        const sz = @abs(insts[b + scale_base + 2]);
        if (sy > 0.75) continue;
        // A REAL floor, not a paint stripe (req_0526): the nearest flat row to
        // the centre was a 61×1m road line — a body can't reliably stand on a
        // 1m-wide strip, and there may be no other ground around it at all.
        if (sx < 2.0 or sz < 2.0) continue;
        const dx = insts[b + 0] - wanted_x;
        const dz = insts[b + 2] - wanted_z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best_dist2) {
            best_dist2 = d2;
            best_row = row;
        }
    }
    if (best_row == null) {
        row = 0;
        while (row < total_rows) : (row += 1) {
            const b = row * stride;
            const scale_base: usize = if (stride >= 12) 6 else 3;
            const sx = @abs(insts[b + scale_base + 0]);
            const sy = @abs(insts[b + scale_base + 1]);
            const sz = @abs(insts[b + scale_base + 2]);
            if (sy > 1.0 or sx < 1.0 or sz < 1.0) continue;
            const dx = insts[b + 0] - wanted_x;
            const dz = insts[b + 2] - wanted_z;
            const d2 = dx * dx + dz * dz;
            if (d2 < best_dist2) {
                best_dist2 = d2;
                best_row = row;
            }
        }
    }
    if (best_row) |r| {
        const b = r * stride;
        return .{ .x = insts[b + 0], .y = instanceTop(insts, r, stride), .z = insts[b + 2] };
    }

    var y = bounds.cy;
    row = 0;
    var found_cover = false;
    while (row < total_rows) : (row += 1) {
        if (!instanceCovers(insts, row, stride, wanted_x, wanted_z)) continue;
        const top = instanceTop(insts, row, stride);
        if (!found_cover or top > y) {
            y = top;
            found_cover = true;
        }
    }
    if (!found_cover) y = 0;
    return .{ .x = wanted_x, .y = y, .z = wanted_z };
}

pub fn groundHeightAt(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, x: f32, z: f32) ?f32 {
    const total_rows: usize = @intCast(inst_count);
    var row: usize = @min(@as(usize, @intCast(piece_count)), total_rows);
    var best: ?f32 = null;
    while (row < total_rows) : (row += 1) {
        const b = row * stride;
        const scale_base: usize = if (stride >= 12) 6 else 3;
        if (@abs(insts[b + scale_base + 1]) > 0.75) continue;
        if (!instanceCovers(insts, row, stride, x, z)) continue;
        const top = instanceTop(insts, row, stride);
        if (best == null or top > best.?) best = top;
    }
    return best;
}
