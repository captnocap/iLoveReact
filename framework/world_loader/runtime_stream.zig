//! Streaming setup, input polling, windowed collider rebuilds, and the frame-step coordinator.
//!
//! Operations are generic over the retained Runtime shape to keep ownership in runtime.zig.

const std = @import("std");
const c = @import("../c.zig").imports;
const scene3d = @import("../gpu/3d.zig");
const constructor = @import("../world/constructor.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const foliage = @import("../world/foliage.zig");
const flora_geometry = @import("../world/flora_geometry.zig");
const instance_collider_policy = @import("../world/instance_collider_policy.zig");
const streaming = @import("../world/streaming.zig");
const game_physics = @import("../game/physics.zig");
const log = std.debug;
const m_config = @import("config.zig");
const m_state = @import("state.zig");
const m_player_assets = @import("player_assets.zig");
const m_instances = @import("instances.zig");
const m_physics = @import("physics.zig");
const m_camera = @import("camera.zig");
const m_animation = @import("animation.zig");
const m_streaming_support = @import("streaming_support.zig");
const runtime_live_scene = @import("runtime_live_scene.zig");
const runtime_dynamics = @import("runtime_dynamics.zig");
const runtime_interaction = @import("runtime_interaction.zig");
const live_inputs = @import("live_inputs.zig");

const SCAN_A = m_config.SCAN_A;
const SCAN_D = m_config.SCAN_D;
const SCAN_S = m_config.SCAN_S;
const SCAN_W = m_config.SCAN_W;
const SCAN_SPACE = m_config.SCAN_SPACE;
const SCAN_LSHIFT = m_config.SCAN_LSHIFT;
const CAMERA_MIN_PITCH_DEGREES = m_config.CAMERA_MIN_PITCH_DEGREES;
const CAMERA_MAX_PITCH_DEGREES = m_config.CAMERA_MAX_PITCH_DEGREES;
const CAMERA_YAW_DEGREES_PER_PIXEL = m_config.CAMERA_YAW_DEGREES_PER_PIXEL;
const CAMERA_PITCH_DEGREES_PER_PIXEL = m_config.CAMERA_PITCH_DEGREES_PER_PIXEL;
const PLAYER_WALK_SPEED_METERS_PER_SECOND = m_config.PLAYER_WALK_SPEED_METERS_PER_SECOND;
const PLAYER_RUN_SPEED_METERS_PER_SECOND = m_config.PLAYER_RUN_SPEED_METERS_PER_SECOND;
const PLAYER_JUMP_SPEED_METERS_PER_SECOND = m_config.PLAYER_JUMP_SPEED_METERS_PER_SECOND;
const PHYSICS_SOLID_HEIGHT_METERS = m_config.PHYSICS_SOLID_HEIGHT_METERS;
const SCAN_P = m_config.SCAN_P;
const PhysicsColliders = m_state.PhysicsColliders;
const clamp = m_state.clamp;
const nowNs = m_state.nowNs;
const keyDown = m_state.keyDown;
const LIVE_POSE_STALE_FRAMES = m_player_assets.LIVE_POSE_STALE_FRAMES;
const pendingPoseFor = m_player_assets.pendingPoseFor;
const advancePlayerLivePose = m_player_assets.advancePlayerLivePose;
const instanceYawRadians = m_instances.instanceYawRadians;
const isRampInstance = m_instances.isRampInstance;
const isNonCollidingFoliage = m_instances.isNonCollidingFoliage;
const geomForShape = m_instances.geomForShape;
const rectFloats = m_instances.rectFloats;
const orientedFloats = m_instances.orientedFloats;
const MeshIsland = m_physics.MeshIsland;
const islandOrientedFloats = m_physics.islandOrientedFloats;
const registerRampHeightfield = m_physics.registerRampHeightfield;
const registerSceneHeightfield = m_physics.registerSceneHeightfield;
const registerColliderField = m_physics.registerColliderField;
const buildPhysicsColliders = m_physics.buildPhysicsColliders;
const COLLIDER_WINDOW_CELLS = m_physics.COLLIDER_WINDOW_CELLS;
const SpatialGrid = m_physics.SpatialGrid;
const runPlayerPhysics = m_physics.runPlayerPhysics;
const resolveMeshPropPlayer = m_physics.resolveMeshPropPlayer;
const PitchLimits = m_camera.PitchLimits;
const updateCameraNode = m_camera.updateCameraNode;
const aimPitchLimitsInOrbitSpace = m_camera.aimPitchLimitsInOrbitSpace;
const setAimMode = m_camera.setAimMode;
const updatePlayerModelNodes = m_animation.updatePlayerModelNodes;
const updatePlayerModelNodesLive = m_animation.updatePlayerModelNodesLive;
const updatePlayerSkinnedNode = m_animation.updatePlayerSkinnedNode;
const updatePlayerSkinnedNodeLive = m_animation.updatePlayerSkinnedNodeLive;
const updateNpcModelNodes = m_animation.updateNpcModelNodes;
const updatePlayerAnimationClock = m_animation.updatePlayerAnimationClock;
const STREAM_CELL_METERS = m_streaming_support.STREAM_CELL_METERS;
const StreamProto = m_streaming_support.StreamProto;
const applyDirtyErase = runtime_live_scene.applyDirtyErase;
const applyLiveMeshProps = runtime_live_scene.applyLiveMeshProps;
const applyWallHide = runtime_live_scene.applyWallHide;
const meshForHash = runtime_live_scene.meshForHash;
const pendingLiveMeshFor = live_inputs.pendingLiveMeshFor;
const stepCookedDoors = runtime_dynamics.stepCookedDoors;
const stepElevators = runtime_dynamics.stepElevators;
const stepTickers = runtime_dynamics.stepTickers;
const stepTraffic = runtime_dynamics.stepTraffic;
const updateDynamicPropNodes = runtime_dynamics.updateDynamicPropNodes;
const stepInteract = runtime_interaction.stepInteract;

pub fn setupStreaming(self: anytype) !void {
    var fams: std.ArrayList(streaming.FamilyRows) = .empty;
    defer fams.deinit(self.allocator);
    errdefer self.stream_protos.clearAndFree(self.allocator);

    // req_1665: short foliage (grass/flora/trees) draws to HALF the structural
    // view distance — a dense field at full radius dominates per-frame instance
    // staging + the wind shader, so cutting its draw distance is the main fps
    // lever. Structure keeps the full bubble (draw_radius 0 = unlimited).
    const flora_radius = streaming.foliageDetailRadius(self.stream_radius);

    try fams.append(self.allocator, .{ .rows = self.shape_batches.boxes, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "box", .verts = self.cube[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.boxes_open_run_min, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "box-open-run-min", .verts = self.cube_open_run_min[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.boxes_open_run_max, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "box-open-run-max", .verts = self.cube_open_run_max[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.boxes_open_run_both, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "box-open-run-both", .verts = self.cube_open_run_both[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.ramps, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "ramp-slab", .verts = self.ramp_slab[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.cylinder8s, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "cylinder8", .verts = self.cylinder8[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.cylinder16s, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "cylinder16", .verts = self.cylinder16[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.spheres, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "sphere12x8", .verts = self.sphere[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.gables, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "gable-prism", .verts = self.gable_prism[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.corner_miters, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "corner-miter-prism", .verts = self.corner_miter_prism[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.corner_miter_mirrors, .stride = @intCast(self.stride) });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "corner-miter-mirror-prism", .verts = self.corner_miter_mirror_prism[0..], .tex_key = null });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.grass, .stride = @intCast(self.stride), .draw_radius = flora_radius });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "grass-blade", .verts = self.grass_blade[0..], .tex_key = "~grass~" });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.flowers, .stride = @intCast(self.stride), .draw_radius = flora_radius });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "flower-head", .verts = self.flower_head[0..], .tex_key = "~grass~" });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.bush, .stride = @intCast(self.stride), .draw_radius = flora_radius });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "bush-clump", .verts = self.bush_clump[0..], .tex_key = "~grass~" });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.frond, .stride = @intCast(self.stride), .draw_radius = flora_radius });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "frond-card", .verts = self.frond_card[0..], .tex_key = "~frond~" });
    try fams.append(self.allocator, .{ .rows = self.shape_batches.palmtrunks, .stride = @intCast(self.stride), .draw_radius = flora_radius });
    try self.stream_protos.append(self.allocator, .{ .geom_key = "palm-trunk", .verts = self.palm_trunk[0..], .tex_key = null });
    for (0..foliage.WRAPPED_SPECIES_COUNT) |i| {
        const species: foliage.WrappedSpecies = @enumFromInt(i);
        try fams.append(self.allocator, .{ .rows = self.shape_batches.wrapped[i], .stride = @intCast(self.stride), .draw_radius = flora_radius });
        try self.stream_protos.append(self.allocator, .{
            .geom_key = flora_geometry.geometryKey(species),
            .verts = self.wrapped_meshes[i].constFloats(),
            .tex_key = "~frond~",
        });
    }
    for (self.material_batches) |batch| {
        if (batch.translucent or batch.textured_translucent or batch.count == 0) continue;
        // Shape-aware streaming proto (req_0939): same fix as the monolithic
        // opaque draw — a skinned non-box shape streams with its real geometry.
        const geom = geomForShape(self, batch.shape);
        try fams.append(self.allocator, .{ .rows = batch.boxes, .stride = @intCast(self.stride) });
        try self.stream_protos.append(self.allocator, .{ .geom_key = geom.key, .verts = geom.verts, .tex_key = batch.key });
    }
    var total_rows: u64 = 0;
    for (fams.items, self.stream_protos.items) |fam, proto| {
        // Foliage cards (~grass~/~frond~ tex keys) upload to their OWN slim
        // instance pool (g_slim_*, req_2019) — they never touch the shared
        // MAX_STATIC_INSTANCES buffer. Counting them here starved lod_budget
        // to 0 on any big map (grass rows alone exceed the whole pool), which
        // silently dropped the far LOD shell.
        if (proto.tex_key) |tk| {
            if (std.mem.eql(u8, tk, "~grass~") or std.mem.eql(u8, tk, "~frond~")) continue;
        }
        total_rows += fam.rows.len / fam.stride;
    }
    // The LOD shell shares the retained static buffer with the detail rows —
    // budget it from what's left so the upload can never overflow.
    const lod_budget: u32 = if (total_rows < scene3d.MAX_STATIC_INSTANCES)
        @intCast(scene3d.MAX_STATIC_INSTANCES - total_rows)
    else
        0;

    var world = try streaming.build(self.allocator, fams.items, STREAM_CELL_METERS, lod_budget);
    const s = world.stats;
    if (s.occupied_chunks < 4) {
        // A world this small sits inside the detail bubble whole — one
        // monolithic draw is strictly better.
        world.deinit(self.allocator);
        self.stream_protos.clearAndFree(self.allocator);
        log.print("[loader] streaming skipped — only {d} occupied chunk(s)\n", .{s.occupied_chunks});
        return;
    }
    self.stream = world;
    log.print("[loader] streaming ON — grid {d}x{d} ({d} occupied chunks), {d} local + {d} spanning rows, lod shell {d} rows (≥{d:.0}m verbatim), detail radius {d:.0}m (cell {d:.0}m)\n", .{
        world.cols, world.rows, s.occupied_chunks, s.local_rows, s.spanning_rows, s.lod_rows, s.lod_min_height, self.stream_radius, world.cell,
    });
    if (s.lod_truncated_chunks > 0) {
        log.print("[loader] streaming LOD budget clipped {d} chunk(s) — far field thins there\n", .{s.lod_truncated_chunks});
    }
}

/// Rebuild the per-frame draw tail: detail ranges for the resident bubble
/// around the player, LOD-shell ranges for the visible rest of the city.
/// Allocation-free (capacity reserved at build; the streaming world merges
/// and caps its draw list).
/// Re-pose every live NPC figure's nodes from its transform + clip
/// (req_0935). Called each frame beside the player figure update.
pub fn refreshNpcNodes(self: anytype) void {
    for (self.npcs.items) |npc| {
        const mi: usize = @intCast(npc.model_index);
        if (mi >= self.scene.npc_models.len) continue;
        updateNpcModelNodes(self.kid_list.items, npc, self.scene.npc_models[mi], self.scene.player_animation);
    }
}

pub fn refreshStreamNodes(self: anytype) void {
    const w = if (self.stream) |*world| world else return;
    w.updateResidency(self.player.x, self.player.z, self.stream_radius);
    const draws = w.assembleDraws(.{
        .pos = .{ self.camera.current_pos.x, self.camera.current_pos.y, self.camera.current_pos.z },
        .look = .{ self.camera.current_target.x, self.camera.current_target.y, self.camera.current_target.z },
        .fov_degrees = self.camera.current_fov,
        .aspect = self.last_aspect,
        .far = self.camera.far,
    });
    self.kid_list.shrinkRetainingCapacity(self.stream_tail_start);
    for (draws) |d| {
        if (d.range.count == 0) continue;
        const fam = if (d.lod) &w.lod else &w.families[d.family];
        const proto: StreamProto = if (d.lod)
            .{ .geom_key = "box", .verts = self.cube[0..], .tex_key = null }
        else
            self.stream_protos.items[d.family];
        self.kid_list.appendAssumeCapacity(.{
            .scene3d_mesh = true,
            .scene3d_geom_key = proto.geom_key,
            .scene3d_vertices = proto.verts,
            // The proto's OWN vertex count (8 floats per vert) — a box is
            // 36 but sphere/cylinder families are not; the hardcoded 36
            // here drew only a sphere's first polar ring (bushes rendered
            // as flat leaf shards) and three of a cylinder's eight
            // segments (props lost their backs) once prop shapes joined
            // the streamed families (BUSHFLAT-0610).
            .scene3d_vert_count = @intCast(proto.verts.len / 8),
            .scene3d_instance_data = fam.rows,
            .scene3d_instance_count = d.range.count,
            .scene3d_instance_first = d.range.first,
            .scene3d_instance_stride = fam.stride,
            .scene3d_instance_static = true,
            // DIRTYRECT: detail families re-upload in place when a piece edit collapses
            // their rows (the LOD shell isn't collapsed, so it keeps version 0).
            .scene3d_instance_version = if (d.lod) 0 else self.stream_erase_gen,
            .scene3d_tex_key = proto.tex_key,
        });
    }
    self.stream_draw_count = self.kid_list.items.len - self.stream_tail_start;
    self.root.children = self.kid_list.items;
    if (w.dropped_draws > 0 and !self.stream_drop_warned) {
        self.stream_drop_warned = true;
        log.print("[loader] streaming draw cap hit — {d} range(s) dropped this frame (far field thins; raise MAX_DRAWS if persistent)\n", .{w.dropped_draws});
    }
    if (!self.stream_logged) {
        self.stream_logged = true;
        var detail_rows: u64 = 0;
        var lod_rows: u64 = 0;
        for (draws) |d| {
            if (d.lod) lod_rows += d.range.count else detail_rows += d.range.count;
        }
        log.print("[loader] streaming first frame — {d} draws: {d} detail + {d} lod shell instances (of {d} total rows)\n", .{
            self.stream_draw_count, detail_rows, lod_rows, w.stats.local_rows + w.stats.spanning_rows,
        });
    }
}

pub fn pollStandaloneEvents(self: anytype, running: *bool) void {
    var event: c.SDL_Event = undefined;
    while (c.SDL_PollEvent(&event)) {
        switch (event.type) {
            c.SDL_EVENT_QUIT, c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => running.* = false,
            c.SDL_EVENT_KEY_DOWN => {
                if (event.key.key == c.SDLK_ESCAPE) running.* = false;
            },
            c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
                if (event.button.button == c.SDL_BUTTON_RIGHT) setAimMode(&self.camera, true);
            },
            c.SDL_EVENT_MOUSE_BUTTON_UP => {
                if (event.button.button == c.SDL_BUTTON_RIGHT) setAimMode(&self.camera, false);
            },
            c.SDL_EVENT_MOUSE_MOTION => {
                mouseLook(self, event.motion.xrel, event.motion.yrel);
            },
            else => {},
        }
    }
}

pub fn mouseLook(self: anytype, dx: f32, dy: f32) void {
    const pitch_limits: PitchLimits = if (self.camera.aiming) aimPitchLimitsInOrbitSpace() else .{ .min = CAMERA_MIN_PITCH_DEGREES, .max = CAMERA_MAX_PITCH_DEGREES };
    self.camera.yaw_degrees -= dx * CAMERA_YAW_DEGREES_PER_PIXEL;
    self.camera.pitch_degrees = clamp(
        self.camera.pitch_degrees - dy * CAMERA_PITCH_DEGREES_PER_PIXEL,
        pitch_limits.min,
        pitch_limits.max,
    );
}

pub fn setAiming(self: anytype, aiming: bool) void {
    setAimMode(&self.camera, aiming);
}

/// Emit one instance row's collider into the windowed physics input (floors-first
/// over two passes: want_solid=false then true). Mirrors buildPhysicsColliders'
/// per-row decision, but writes straight into the preallocated input buffer.
pub fn emitRowCollider(self: anytype, row: usize, want_solid: bool, values: []f32, oriented_tmp: []f32, rc: *usize, oc: *usize, hf: *usize, clipped: *usize) void {
    if (isRampInstance(self.insts, row, self.stride)) {
        if (want_solid) return; // ramps are heightfields — registered in the floor pass
        if (hf.* < game_physics.MAX_HEIGHTFIELDS and registerRampHeightfield(self.insts, row, self.stride, hf.*)) hf.* += 1 else clipped.* += 1;
        return;
    }
    if (isNonCollidingFoliage(self.insts, row, self.stride)) return; // grass/bush/frond/flower = walk-through (req_1607)
    const scale_base: usize = if (self.stride >= 12) 6 else 3;
    const b = row * self.stride;
    const sx = @abs(self.insts[b + scale_base + 0]);
    const sy = @abs(self.insts[b + scale_base + 1]);
    const sz = @abs(self.insts[b + scale_base + 2]);
    if (sx <= 0.001 or sy <= 0.001 or sz <= 0.001) return;
    const solid = instance_collider_policy.blocksPlayerByHeight(sy, PHYSICS_SOLID_HEIGHT_METERS);
    if (solid != want_solid) return;
    if (@abs(instanceYawRadians(self.insts, row, self.stride)) > 0.0001) {
        if (oc.* >= game_physics.MAX_ORIENTED) {
            clipped.* += 1;
            return;
        }
        const of = orientedFloats(self.insts, row, self.stride, solid);
        @memcpy(oriented_tmp[oc.* * game_physics.ORIENTED_FLOATS ..][0..game_physics.ORIENTED_FLOATS], &of);
        oc.* += 1;
    } else {
        if (rc.* >= game_physics.MAX_RECTS) {
            clipped.* += 1;
            return;
        }
        const rf = rectFloats(self.insts, row, self.stride, solid);
        @memcpy(values[self.physics_colliders.rectBase() + rc.* * game_physics.RECT_FLOATS ..][0..game_physics.RECT_FLOATS], &rf);
        rc.* += 1;
    }
}

/// One square shell of window cells at Chebyshev distance `ring` from the
/// player's cell — the unit of the nearest-first cap policy (req_0526).
pub fn emitWindowRing(self: anytype, grid: *const SpatialGrid, pcx: i32, pcz: i32, ring: i32, want_solid: bool, values: []f32, oriented_tmp: []f32, rc: *usize, oc: *usize, hf: *usize, clipped: *usize) void {
    var czi = pcz - ring;
    while (czi <= pcz + ring) : (czi += 1) {
        if (czi < 0 or czi >= grid.rows) continue;
        var cxi = pcx - ring;
        while (cxi <= pcx + ring) : (cxi += 1) {
            if (cxi < 0 or cxi >= grid.cols) continue;
            if (@max(@abs(cxi - pcx), @abs(czi - pcz)) != ring) continue; // shell only — inner rings already emitted
            const cellv: usize = @intCast(czi * grid.cols + cxi);
            var k = grid.starts[cellv];
            while (k < grid.starts[cellv + 1]) : (k += 1) {
                emitRowCollider(self, grid.items[k], want_solid, values, oriented_tmp, rc, oc, hf, clipped);
            }
        }
    }
}

pub fn emitMeshPropColliders(self: anytype, oriented_tmp: []f32, oc: *usize, clipped: *usize) void {
    const mp = self.scene.mesh_props orelse return;
    for (mp.instances) |inst| {
        const mi: usize = @intCast(inst.mesh);
        const isls = if (mi < self.mesh_prop_islands.len) self.mesh_prop_islands[mi] else &[_]MeshIsland{};
        for (isls) |isl| {
            if (oc.* >= game_physics.MAX_ORIENTED) {
                clipped.* += 1;
                continue;
            }
            const collider = islandOrientedFloats(inst, isl, mp.meshes[mi].collision_triangles.len > 0);
            @memcpy(oriented_tmp[oc.* * game_physics.ORIENTED_FLOATS ..][0..game_physics.ORIENTED_FLOATS], &collider);
            oc.* += 1;
        }
    }
}

/// Narrow the player against exact saved-Outliner triangles after the ordinary
/// rect/heightfield step. Baked and editor-live placements share the same mesh
/// function; the ghost preview is deliberately absent.
pub fn resolveExactMeshProps(self: anytype, cfg: ?constructor.PhysicsConfig) bool {
    var grounded_on_mesh = false;
    if (self.scene.mesh_props) |mp| {
        for (mp.instances) |inst| {
            const mesh_index: usize = @intCast(inst.mesh);
            if (mesh_index >= mp.meshes.len) continue;
            grounded_on_mesh = resolveMeshPropPlayer(&self.player, mp.meshes[mesh_index], inst, cfg) or grounded_on_mesh;
        }
    }
    const pending = pendingLiveMeshFor(self.node_id) orelse return grounded_on_mesh;
    for (pending.refs) |ref| {
        const mesh = meshForHash(self, ref.hash) orelse continue;
        const inst: constructor.MeshPropInstance = .{
            .mesh = 0,
            .x = ref.x,
            .y = ref.y,
            .z = ref.z,
            .yaw_degrees = ref.yaw,
            .scale = ref.scale,
        };
        grounded_on_mesh = resolveMeshPropPlayer(&self.player, mesh, inst, cfg) or grounded_on_mesh;
    }
    return grounded_on_mesh;
}

/// Rebuild the player's near-field collider set from the spatial grid: the
/// always list (world-spanning floors/walls) plus every local instance in the
/// window of cells around (center_x, center_z). Floors-first so the ground always
/// wins the cap. Refills the preallocated physics input in place — no allocation.
pub fn rebuildWindow(self: anytype, center_x: f32, center_z: f32) void {
    const grid = self.grid orelse return;
    const values = self.physics_colliders.values;
    const need = self.physics_colliders.rectBase() + game_physics.MAX_RECTS * game_physics.RECT_FLOATS + game_physics.MAX_ORIENTED * game_physics.ORIENTED_FLOATS;
    if (values.len < need) return;
    var oriented_tmp: [game_physics.MAX_ORIENTED * game_physics.ORIENTED_FLOATS]f32 = undefined;
    var rc: usize = 0;
    var oc: usize = 0;
    var hf: usize = 0;
    var clipped: usize = 0;

    game_physics.clearHeightfields();
    for (self.scene.heightfields) |field| {
        if (hf < game_physics.MAX_HEIGHTFIELDS and registerSceneHeightfield(field, hf)) hf += 1 else clipped += 1;
    }
    // Baked heightfields (authored stair/ramp slopes AND the void shell's ground
    // plane) live in the COLLIDERS lump, NOT scene.heightfields. The static build
    // registers them too (see buildPhysicsColliders); without re-registering them
    // here, a window rebuild on a huge map DROPS them — you fall through the void
    // ground and authored stairs stop catching you. (req_1669)
    if (self.scene.baked_colliders) |bc| {
        for (bc.ramps) |ramp| {
            if (hf < game_physics.MAX_HEIGHTFIELDS and registerColliderField(ramp, hf)) hf += 1 else clipped += 1;
        }
    }

    const pc = grid.cellXZ(center_x, center_z);

    var pass: usize = 0;
    while (pass < 2) : (pass += 1) {
        const want_solid = pass == 1;
        // NEAREST GEOMETRY WINS THE CAP (req_0526): the window over a dense
        // city holds MORE floors than MAX_RECTS, and the old raw lo→hi scan
        // let far cells fill the cap before the cell the player STANDS IN —
        // zero floor under their feet, a guaranteed fall through the world.
        // Emission order per pass: rings 0–1 (the ground underfoot), then
        // the spanning list (world-sized slabs/roads — the base ground),
        // then the outer rings. The cap now drops only the FAR field.
        emitWindowRing(self, &grid, pc.cx, pc.cz, 0, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
        emitWindowRing(self, &grid, pc.cx, pc.cz, 1, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
        if (want_solid) emitMeshPropColliders(self, oriented_tmp[0..], &oc, &clipped);
        for (grid.always) |row| emitRowCollider(self, row, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
        var ring: i32 = 2;
        while (ring <= COLLIDER_WINDOW_CELLS) : (ring += 1) {
            emitWindowRing(self, &grid, pc.cx, pc.cz, ring, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
        }
    }
    // oriented rects sit right after the actual rects in the physics input layout.
    const oriented_base = self.physics_colliders.rectBase() + rc * game_physics.RECT_FLOATS;
    @memcpy(values[oriented_base .. oriented_base + oc * game_physics.ORIENTED_FLOATS], oriented_tmp[0 .. oc * game_physics.ORIENTED_FLOATS]);
    self.physics_colliders.rect_count = rc;
    self.physics_colliders.oriented_count = oc;
    self.physics_colliders.heightfield_count = hf;
    self.physics_colliders.clipped_rows = clipped;
}

/// The collider set the camera spring-arm steps against: the FULL baked
/// authored walls when we have them (so the eye is pushed out of every
/// authored building regardless of the per-frame physics windowing), else
/// the live physics set (pre-lump bakes have no baked colliders).
pub fn cameraColliderSet(self: anytype) ?PhysicsColliders {
    if (self.camera_colliders) |cam_cols| return cam_cols;
    if (self.has_physics_colliders) return self.physics_colliders;
    return null;
}

pub fn stepNow(self: anytype, io: std.Io, environ: *const std.process.Environ.Map) void {
    const ns = nowNs(io);
    const dt = clamp(@as(f32, @floatFromInt(ns - self.last_ns)) / 1_000_000_000.0, 0.001, 0.05);
    self.last_ns = ns;

    // req_0652: cars advance FIRST so this frame's physics step (and the
    // interact prompts) read the fresh car heights — /test's frame order.
    stepElevators(self, dt);

    var forward: f32 = 0;
    var strafe: f32 = 0;
    // LOADERVIEW req_1775/1776: in editor (external-camera) mode the loader is a
    // PASSIVE viewport — freeze player locomotion so WASD pans the editor camera (JS
    // side) instead of walking an avatar, and the keys aren't eaten by game movement.
    if (!self.camera.external) {
        if (keyDown(SCAN_W)) forward += 1;
        if (keyDown(SCAN_S)) forward -= 1;
        if (keyDown(SCAN_A)) strafe -= 1;
        if (keyDown(SCAN_D)) strafe += 1;
    }
    const intent = game_physics.movement.wasdDirection(forward, strafe, self.camera.yaw_degrees * std.math.pi / 180.0);
    const run_down = keyDown(SCAN_LSHIFT);
    // Locomotion speed from the baked PHYSICS_CONFIG (the editor's walk/run),
    // falling back to the loader's built-in constants for pre-lump bakes.
    // A live Globals override (GLOBALS req_2770) outranks the baked lump.
    const cfg = self.physics_override orelse self.scene.physics_config;
    const walk_speed = if (cfg) |cf| cf.walk_speed else PLAYER_WALK_SPEED_METERS_PER_SECOND;
    const run_speed = if (cfg) |cf| cf.run_speed else PLAYER_RUN_SPEED_METERS_PER_SECOND;
    const speed: f32 = if (run_down) run_speed else walk_speed;
    // PROPUSE req_0624: a seated/lying player is pinned to the seat and the
    // movement step is skipped — WASD or Space stands up (/test parity:
    // the embodied loop owns the exit, the world keeps stepping).
    if (self.player.posture != .none and (@abs(forward) + @abs(strafe) > 0.001 or keyDown(SCAN_SPACE))) {
        self.player.posture = .none;
    }
    if (self.player.posture == .none) {
        // Refresh the near-field collider window around the player (huge maps only).
        // Cheap — it touches only the spanning list + the cells around the player.
        if (self.windowed) rebuildWindow(self, self.player.x, self.player.z);
        const jump_requested = keyDown(SCAN_SPACE) and !self.camera.external;
        const was_grounded = self.player.grounded;
        runPlayerPhysics(&self.player, &self.physics_colliders, dt, intent, speed, jump_requested, cfg, self.bodies);
        const rect_step_launched = self.player.vy > 0;
        const grounded_on_exact_mesh = resolveExactMeshProps(self, cfg);
        // The packed rect step cannot see an exact mesh's triangle top, so it
        // cannot authorize a jump from that surface. Preserve the same jump law
        // using last frame's exact grounded state, after this frame re-seats the
        // feet on the immutable mesh plane.
        if (jump_requested and was_grounded and !rect_step_launched and grounded_on_exact_mesh) {
            self.player.vy = if (cfg) |value| value.jump_speed else PLAYER_JUMP_SPEED_METERS_PER_SECOND;
            self.player.grounded = false;
        }
    } else if (self.bodies.len > 0) {
        // Seated: the world keeps stepping — an intent-less step whose
        // player result is discarded, so kicked balls roll past you
        // (/test parity, PROPUSE-0610).
        var ghost = self.player;
        runPlayerPhysics(&ghost, &self.physics_colliders, dt, .{ .x = 0, .z = 0 }, 0, false, cfg, self.bodies);
    }
    if (self.camera.aiming) self.player.yaw = self.camera.yaw_degrees * std.math.pi / 180.0;
    const seated = self.player.posture != .none;
    // RJIT_FORCE_GAIT=1 drives the walk clip with no input — the headless
    // animation-repro hook (req_2781): `rjit shot` frames land mid-stride.
    const moving = self.force_gait or (!seated and @sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001);
    const airborne = !seated and (!self.player.grounded or @abs(self.player.vy) > 0.05);
    updatePlayerAnimationClock(&self.player, dt, moving, run_down, airborne);
    stepInteract(self, dt);
    stepCookedDoors(self, dt); // req_1908: swing custom doors toward their target

    updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, cameraColliderSet(self), dt);
    // A FRESH capture pose overrides the clip sampler (req_2786); stale
    // (~3/4s without a push) falls back to clips so a dropped tracker
    // never freezes the body.
    var live_posed = false;
    if (self.scene.player_skin) |skin| {
        const marker_first = if (self.player_pose_marker_count == skin.bones.len) self.player_pose_marker_first else null;
        // SKINNED figure (SKIN-3499): the same clip/live-pose discipline, but
        // the pose lands in the bone palette instead of N part nodes.
        if (pendingPoseFor(self.node_id)) |lp| {
            if (lp.count == skin.bones.len and lp.age_frames < LIVE_POSE_STALE_FRAMES) {
                advancePlayerLivePose(lp, dt);
                updatePlayerSkinnedNodeLive(self.kid_list.items, self.player_first_child, marker_first, skin, self.player_skin_palette, lp.transforms, self.player);
                live_posed = true;
            }
            lp.age_frames +%= 1;
        }
        if (!live_posed) updatePlayerSkinnedNode(self.kid_list.items, self.player_first_child, marker_first, skin, self.player_skin_palette, self.scene.player_animation, self.player, moving, run_down, airborne);
    } else {
        if (pendingPoseFor(self.node_id)) |lp| {
            if (lp.count == self.scene.player_model.len and lp.age_frames < LIVE_POSE_STALE_FRAMES) {
                advancePlayerLivePose(lp, dt);
                updatePlayerModelNodesLive(self.kid_list.items, self.player_first_child, self.scene.player_model, lp.transforms, self.player);
                live_posed = true;
            }
            lp.age_frames +%= 1;
        }
        if (!live_posed) updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, moving, run_down, airborne);
    }
    refreshNpcNodes(self);
    updateDynamicPropNodes(self);
    stepTickers(self, dt);
    stepTraffic(self, dt); // req_2056: drive the ambient vehicles along their baked routes
    self.live_spin_seconds += dt; // SPINPROP req_3128: spinning live props sample this in applyLiveMeshProps
    if (self.scene.traffic != null) { // [traffic-paths req_2072] P toggles the route ribbon
        const pdown = keyDown(SCAN_P);
        if (pdown and !self.prev_paths_key_down) self.traffic_paths_on = !self.traffic_paths_on;
        self.prev_paths_key_down = pdown;
        self.kid_list.items[self.traffic_path_node].scene3d_instance_count = if (self.traffic_paths_on) self.traffic_path_count else 0;
    }
    // DIRTYRECT: collapse the baked rows inside dirty footprints (once per edit) BEFORE
    // streaming rebuilds its nodes — so the bumped stream_erase_gen reaches THIS frame's
    // streamed static nodes and they re-upload the same frame (no one-frame stale flash).
    applyDirtyErase(self);
    // WALLHIDE req_2053: the editor build pane's "disable walls" — runs AFTER erase (so it
    // sees this frame's restored rows) and BEFORE refreshStreamNodes (so a bumped
    // stream_erase_gen reaches this frame's streamed nodes, like the erase pass).
    applyWallHide(self);
    // Re-stream the world around wherever the player ended up this step
    // (uses the camera solved just above for sight culling).
    refreshStreamNodes(self);
    // LIVEMESH req_1812: re-append the live mesh-prop draws AFTER the stream tail
    // (refreshStreamNodes truncated to stream_tail_start, dropping last frame's), so a
    // just-placed pepes/genmesh prop shows instantly by referencing its resident mesh.
    applyLiveMeshProps(self, io, environ);
    self.frame += 1;
}
