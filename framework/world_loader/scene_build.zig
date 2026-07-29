//! One-time lowering of a constructed game scene into retained render and simulation state.
//!
//! Operations are generic over the retained Runtime shape to keep ownership in runtime.zig.

const std = @import("std");
const layout = @import("../layout.zig");
const Node = layout.Node;
const constructor = @import("../world/constructor.zig");
const foliage = @import("../world/foliage.zig");
const flora_geometry = @import("../world/flora_geometry.zig");
const game_physics = @import("../game/physics.zig");
const log = std.debug;
const m_config = @import("config.zig");
const m_state = @import("state.zig");
const m_geometry = @import("geometry.zig");
const m_player_assets = @import("player_assets.zig");
const m_instances = @import("instances.zig");
const m_physics = @import("physics.zig");
const m_camera = @import("camera.zig");
const m_animation = @import("animation.zig");
const m_streaming_support = @import("streaming_support.zig");
const m_live_inputs = @import("live_inputs.zig");
const m_paint_runtime = @import("paint_runtime.zig");
const runtime_live_scene = @import("runtime_live_scene.zig");
const runtime_stream = @import("runtime_stream.zig");

const INSTANCE_STRIDE = m_config.INSTANCE_STRIDE;
const TRAFFIC_PROTO_STRIDE = m_config.TRAFFIC_PROTO_STRIDE;
const SHAPE_BOX = m_config.SHAPE_BOX;
const SHAPE_RAMP = m_config.SHAPE_RAMP;
const SHAPE_CYLINDER8 = m_config.SHAPE_CYLINDER8;
const MAX_PAINT_SLOTS = m_config.MAX_PAINT_SLOTS;
const PAINT_BEAM_ALPHA = m_config.PAINT_BEAM_ALPHA;
const TRANSPORT_RENDER = m_config.TRANSPORT_RENDER;
const SHAPE_CYLINDER16 = m_config.SHAPE_CYLINDER16;
const SHAPE_SPHERE = m_config.SHAPE_SPHERE;
const SHAPE_GABLE = m_config.SHAPE_GABLE;
const SHAPE_CORNER_MITER = m_config.SHAPE_CORNER_MITER;
const SHAPE_CORNER_MITER_MIRROR = m_config.SHAPE_CORNER_MITER_MIRROR;
const SHAPE_BOX_OPEN_RUN_MIN = m_config.SHAPE_BOX_OPEN_RUN_MIN;
const SHAPE_BOX_OPEN_RUN_MAX = m_config.SHAPE_BOX_OPEN_RUN_MAX;
const SHAPE_BOX_OPEN_RUN_BOTH = m_config.SHAPE_BOX_OPEN_RUN_BOTH;
const SPAWN_DROP_CLEARANCE_METERS = m_config.SPAWN_DROP_CLEARANCE_METERS;
const CAMERA_INITIAL_PITCH_DEGREES = m_config.CAMERA_INITIAL_PITCH_DEGREES;
const CAMERA_FOV_DEGREES = m_config.CAMERA_FOV_DEGREES;
const ELEVATOR_CAR_COLOR = m_config.ELEVATOR_CAR_COLOR;
const DOOR_PANEL_COLOR = m_config.DOOR_PANEL_COLOR;
const DOOR_OPEN_HIDE_DROP_METERS = m_config.DOOR_OPEN_HIDE_DROP_METERS;
const Vec3 = m_state.Vec3;
const PropBody = m_state.PropBody;
const ElevatorCar = m_state.ElevatorCar;
const DoorState = m_state.DoorState;
const CookedDoor = m_state.CookedDoor;
const cookedDoorWorldBox = m_state.cookedDoorWorldBox;
const sampleRoute = m_state.sampleRoute;
const nowNs = m_state.nowNs;
const appendMeshPropNode = runtime_live_scene.appendMeshPropNode;
const cameraColliderSet = runtime_stream.cameraColliderSet;
const rebuildWindow = runtime_stream.rebuildWindow;
const refreshNpcNodes = runtime_stream.refreshNpcNodes;
const refreshStreamNodes = runtime_stream.refreshStreamNodes;
const setupStreaming = runtime_stream.setupStreaming;
const buildCube = m_geometry.buildCube;
const buildCubeOpenRun = m_geometry.buildCubeOpenRun;
const buildGablePrism = m_geometry.buildGablePrism;
const buildCornerMiterPrism = m_geometry.buildCornerMiterPrism;
const buildCornerMiterMirrorPrism = m_geometry.buildCornerMiterMirrorPrism;
const buildGrassBlade = m_geometry.buildGrassBlade;
const buildFlowerHead = m_geometry.buildFlowerHead;
const buildBushClump = m_geometry.buildBushClump;
const buildFrond = m_geometry.buildFrond;
const buildPalmTrunk = m_geometry.buildPalmTrunk;
const buildUnitSphere = m_geometry.buildUnitSphere;
const buildUnitCylinder = m_geometry.buildUnitCylinder;
const buildBrushDecal = m_geometry.buildBrushDecal;
const buildBrushRings = m_geometry.buildBrushRings;
const buildBrushHandles = m_geometry.buildBrushHandles;
const buildBrushCone = m_geometry.buildBrushCone;
const buildBrushDome = m_geometry.buildBrushDome;
const fallbackPlayerModel = m_player_assets.fallbackPlayerModel;
const geomContentHash = m_player_assets.geomContentHash;
const pendingPlayerModelCopy = m_player_assets.pendingPlayerModelCopy;
const pendingPlayerSkinCopy = m_player_assets.pendingPlayerSkinCopy;
const pendingPlayerAnimationCopy = m_player_assets.pendingPlayerAnimationCopy;
const m_pose = @import("../skeleton/pose.zig");
const m_pose_markers = @import("../skeleton/pose_markers.zig");
const extrudeTiles = m_instances.extrudeTiles;
const buildShapeBatches = m_instances.buildShapeBatches;
const whitenRows = m_instances.whitenRows;
const buildMaterialBatches = m_instances.buildMaterialBatches;
const instanceBounds = m_instances.instanceBounds;
const instanceCovers = m_instances.instanceCovers;
const instanceYawRadians = m_instances.instanceYawRadians;
const geomForShape = m_instances.geomForShape;
const MeshIsland = m_physics.MeshIsland;
const meshPropIslands = m_physics.meshPropIslands;
const maxAbsHeight = m_physics.maxAbsHeight;
const heightfieldContentHash = m_physics.heightfieldContentHash;
const buildPhysicsColliders = m_physics.buildPhysicsColliders;
const buildSpatialGrid = m_physics.buildSpatialGrid;
const sceneTerrainTopAt = m_physics.sceneTerrainTopAt;
const chooseSpawn = m_physics.chooseSpawn;
const springArmEye = m_camera.springArmEye;
const updateCameraNode = m_camera.updateCameraNode;
const updatePlayerModelNodes = m_animation.updatePlayerModelNodes;
const updateNpcModelNodes = m_animation.updateNpcModelNodes;
const streamModeFromEnv = m_streaming_support.streamModeFromEnv;
const streamRadiusFromEnv = m_streaming_support.streamRadiusFromEnv;
const BakedRange = m_streaming_support.BakedRange;
const meshPosKey = m_live_inputs.meshPosKey;
const applyPendingLive = m_live_inputs.applyPendingLive;
const applyPaintLayer = m_paint_runtime.applyPaintLayer;
fn buildRampSlab() [36 * 8]f32 {
    return m_geometry.buildRampSlab(m_config.RAMP_SLAB_THICKNESS_RATIO);
}

pub fn build(self: anytype, io: std.Io, environ: *const std.process.Environ.Map) !void {
    self.insts = self.scene.instances;
    self.inst_count = self.scene.instance_count;
    self.stride = if (self.scene.instance_stride > 0) self.scene.instance_stride else INSTANCE_STRIDE;
    if (self.inst_count == 0 and !self.scene.has_instance_lump) {
        const f = extrudeTiles(self.allocator, self.scene) catch |err| {
            log.print("[loader] tile extrusion FAILED: {any}\n", .{err});
            return err;
        };
        self.fallback = f;
        self.insts = f;
        self.stride = INSTANCE_STRIDE;
        self.inst_count = @intCast(f.len / INSTANCE_STRIDE);
        log.print("[loader] no instance buffer — extruded {d} tile boxes\n", .{self.inst_count});
    }
    self.piece_count = self.scene.piece_count;
    log.print("[loader] built {d} mesh instances ({d} placed pieces)\n", .{ self.inst_count, self.piece_count });
    if (self.inst_count == 0) log.print("[loader] empty world — rendering sky/model over void\n", .{});

    // PROPUSE req_0624: session-local searched flags, one per interactable.
    if (self.scene.interactables) |ia| {
        self.interact.searched = try self.allocator.alloc(bool, ia.instances.len);
        @memset(self.interact.searched, false);
        log.print("[loader] interaction layer: {d} archetypes, {d} interactable props\n", .{ ia.archetypes.len, ia.instances.len });
    }

    // KICKPROP req_0625: one live sphere body per dynamic prop, spawned a
    // radius above the anchor — lifted to the painted terrain when ground
    // sits above it (an authored-flat ball still lands ON the hill).
    if (self.scene.dynamic_props) |dp| {
        const body_count = @min(dp.props.len, game_physics.MAX_ENTITIES);
        if (dp.props.len > body_count) {
            log.print("[loader] {d} dynamic props exceed the host body cap of {d} — the tail stays frozen at its anchor\n", .{ dp.props.len - body_count, game_physics.MAX_ENTITIES });
        }
        self.bodies = try self.allocator.alloc(PropBody, body_count);
        for (self.bodies, 0..) |*b, i| {
            const p = dp.props[i];
            var anchor_y = p.y;
            if (sceneTerrainTopAt(self.scene.heightfields, p.x, p.z)) |top| anchor_y = @max(anchor_y, top);
            b.* = .{ .x = p.x, .y = anchor_y + p.body_radius, .z = p.z, .radius = p.body_radius, .restitution = p.restitution };
        }
        log.print("[loader] dynamics layer: {d} kickable props\n", .{self.bodies.len});
    }

    // Per-mesh collision ISLANDS for cooked/imported props (req_1624) — computed
    // ONCE here (connected-component split), then reused by both the static baked
    // build below and the per-frame windowed rebuild, so a multi-piece sign is
    // walk-under without re-splitting the mesh every collider refresh.
    if (self.scene.mesh_props) |mp| {
        const islands = try self.allocator.alloc([]MeshIsland, mp.meshes.len);
        for (mp.meshes, 0..) |mesh, mi| islands[mi] = try meshPropIslands(self.allocator, mesh);
        self.mesh_prop_islands = islands;
    }

    self.physics_colliders = try buildPhysicsColliders(self.allocator, self.scene, self.insts, self.inst_count, self.stride, self.bodies.len, self.mesh_prop_islands);
    self.has_physics_colliders = true;
    // req_2792: the build-time sections are the BASE the live-piece collider
    // fold appends after; a fresh build starts with no overlay folded in.
    self.base_rect_count = self.physics_colliders.rect_count;
    self.base_oriented_count = self.physics_colliders.oriented_count;
    self.live_collider_gen = 0;
    log.print("[loader] built {d} physics rects + {d} oriented physics rects + {d} heightfields\n", .{ self.physics_colliders.rect_count, self.physics_colliders.oriented_count, self.physics_colliders.heightfield_count });
    if (self.physics_colliders.clipped_rows > 0) {
        log.print("[loader] physics collider cap clipped {d} rendered instance rows\n", .{self.physics_colliders.clipped_rows});
    }
    // Elevator cars (req_0652): one live car per shaft that got a rect,
    // parked at its bottom stop. stepElevators owns motion + the rect.
    if (self.physics_colliders.car_count > 0) {
        self.cars = try self.allocator.alloc(ElevatorCar, self.physics_colliders.car_count);
        const el = self.scene.elevators.?;
        for (self.cars, 0..) |*car, i| {
            const rest = el.shafts[i].stops[0];
            car.* = .{ .car_y = rest, .target_y = rest };
        }
        log.print("[loader] elevator layer: {d} live car(s) across {d} shaft(s)\n", .{ self.cars.len, el.shafts.len });
    } else if (self.scene.elevators) |el| {
        if (el.shafts.len > 0) log.print("[loader] elevator layer: {d} shaft(s) but no live cars (collider cap / no baked colliders)\n", .{el.shafts.len});
    }
    // Doors (DOORS-0611): one live two-state machine per door that got a
    // rect, booting at its authored state. The E toggle owns the rest.
    if (self.physics_colliders.door_count > 0) {
        self.doors_state = try self.allocator.alloc(DoorState, self.physics_colliders.door_count);
        const doors = self.scene.doors.?;
        for (self.doors_state, 0..) |*door, i| door.* = .{ .open = doors.records[i].start_open };
        log.print("[loader] door layer: {d} live door(s)\n", .{self.doors_state.len});
    } else if (self.scene.doors) |doors| {
        if (doors.records.len > 0) log.print("[loader] door layer: {d} door(s) but no live rects (collider cap / no baked colliders)\n", .{doors.records.len});
    }
    // Cooked doors (req_1864): one live two-state machine per cooked-door
    // mesh-prop instance that got a rect, in the SAME mp.instances order the
    // rect builder used, so rect_index = cooked_door_rect_start + i. node_child
    // is filled later, when the mesh-prop node pass emits the leaf slot node.
    if (self.physics_colliders.cooked_door_count > 0) {
        if (self.scene.mesh_props) |mp| {
            self.cooked_doors = try self.allocator.alloc(CookedDoor, self.physics_colliders.cooked_door_count);
            var ci: usize = 0;
            for (mp.instances) |inst| {
                if (ci >= self.cooked_doors.len) break;
                const mi: usize = @intCast(inst.mesh);
                if (mi >= mp.meshes.len) continue;
                const box = cookedDoorWorldBox(mp.meshes[mi], inst) orelse continue;
                self.cooked_doors[ci] = box;
                self.cooked_doors[ci].rect_index = self.physics_colliders.cooked_door_rect_start + ci;
                ci += 1;
            }
            log.print("[loader] cooked-door layer: {d} live custom door(s)\n", .{self.cooked_doors.len});
        }
    }
    // The camera's own collider set: the FULL baked authored rects/oriented,
    // unclamped, packed in cameraOcclusionStepColliders wire order. Built once
    // and queried every frame by springArmEye regardless of physics windowing,
    // so a yawed building wall the windowed physics set drops is still seen by
    // the spring-arm and the eye is pushed to the player's side of it.
    if (self.scene.baked_colliders) |bc| {
        const rect_floats = bc.rects.len;
        const oriented_floats = bc.oriented.len;
        if (self.allocator.alloc(f32, game_physics.INPUT_HEADER_FLOATS + rect_floats + oriented_floats)) |buf| {
            @memset(buf, 0);
            @memcpy(buf[game_physics.INPUT_HEADER_FLOATS .. game_physics.INPUT_HEADER_FLOATS + rect_floats], bc.rects);
            @memcpy(buf[game_physics.INPUT_HEADER_FLOATS + rect_floats ..], bc.oriented);
            self.camera_colliders = .{
                .values = buf,
                .rect_count = @intCast(bc.rect_count),
                .oriented_count = @intCast(bc.oriented_count),
                .heightfield_count = 0,
                .clipped_rows = 0,
            };
            log.print("[loader] camera spring-arm collider set: {d} baked rects + {d} oriented (full, unclamped)\n", .{ bc.rect_count, bc.oriented_count });
        } else |_| {}
    }

    const env = self.scene.env;
    const frame_count: u32 = if (self.piece_count > 0) self.piece_count else self.inst_count;
    const bounds = instanceBounds(self.insts, frame_count, self.stride);
    const horiz = bounds.radius * env.cam_horiz_factor + env.cam_horiz_base;
    const height = bounds.radius * env.cam_height_factor + env.cam_height_base;
    const far = (horiz + height + bounds.radius) * env.cam_far_factor;
    const authored_eye = Vec3{
        .x = bounds.cx + horiz * 0.72,
        .y = bounds.cy + height,
        .z = bounds.cz + horiz * 0.72,
    };
    const authored_dx = authored_eye.x - bounds.cx;
    const authored_dz = authored_eye.z - bounds.cz;
    const authored_yaw = std.math.atan2(authored_dx, authored_dz);
    var spawn = chooseSpawn(self.insts, self.inst_count, self.piece_count, self.stride, bounds);
    // [traffic-diag req_2056] RJIT_TRAFFIC_SPAWN=1 drops the player onto the
    // first baked vehicle's route so a headless shot frames moving traffic.
    if (environ.get("RJIT_TRAFFIC_SPAWN") != null) {
        if (self.scene.traffic) |tr| {
            if (tr.vehicles.len > 0 and tr.vehicles[0].route.len >= 2) {
                const veh = tr.vehicles[0];
                const pose = sampleRoute(veh.route, @mod(veh.phase, @max(veh.length, 1)));
                spawn.x = pose.x;
                spawn.z = pose.z;
                // stand on the STREET (terrain) AT the car so the third-person
                // camera (behind + pitched down) frames it, not on whatever piece
                // chooseSpawn picked elsewhere.
                spawn.y = (sceneTerrainTopAt(self.scene.heightfields, spawn.x, spawn.z) orelse 0) + 1.0;
                log.print("[loader] RJIT_TRAFFIC_SPAWN: at vehicle 0 ({d:.1},{d:.1}) of {d}\n", .{ pose.x, pose.z, tr.vehicles.len });
            }
        }
    }
    // Painted terrain is HEIGHTFIELDS, not instance rows — chooseSpawn's
    // flat-box top can sit UNDER a painted hill, burying the player below
    // the surface where no collider can catch a body (req_0523: "falling
    // thru the world when trying to just load it"). Clamp the spawn to the
    // terrain surface, then drop in from a small clearance so an imprecise
    // sample still settles ONTO the ground instead of inside it.
    const terrain_top = sceneTerrainTopAt(self.scene.heightfields, spawn.x, spawn.z);
    if (terrain_top) |top| {
        if (top > spawn.y) spawn.y = top;
    }
    spawn.y += SPAWN_DROP_CLEARANCE_METERS;
    log.print("[loader] spawn x={d:.2} y={d:.2} z={d:.2} (terrain={d:.2} fields={d})\n", .{
        spawn.x, spawn.y, spawn.z, terrain_top orelse -999, self.scene.heightfields.len,
    });
    self.player = .{
        .x = spawn.x,
        .y = spawn.y,
        .z = spawn.z,
        .yaw = authored_yaw,
    };
    {
        // probe: every instance row whose footprint covers the spawn column
        var row: usize = 0;
        const total: usize = @intCast(self.inst_count);
        while (row < total) : (row += 1) {
            if (!instanceCovers(self.insts, row, self.stride, spawn.x, spawn.z)) continue;
            const sb: usize = if (self.stride >= 12) 6 else 3;
            const b = row * self.stride;
            log.print("[loader] spawn-col row={d} piece={} pos=({d:.1},{d:.2},{d:.1}) scale=({d:.1},{d:.2},{d:.1}) yaw={d:.2}\n", .{
                row,                                              row < @as(usize, @intCast(self.piece_count)),
                self.insts[b + 0],                                self.insts[b + 1],
                self.insts[b + 2],                                self.insts[b + sb + 0],
                self.insts[b + sb + 1],                           self.insts[b + sb + 2],
                instanceYawRadians(self.insts, row, self.stride),
            });
        }
    }
    // The SOLID collider set (rects/oriented) overflowed its host cap — a huge
    // --massive city: switch to SPATIAL WINDOWING so collision follows the player
    // and the whole world is solid in the near field. Build the grid, widen the
    // physics input buffer to MAX capacity for in-place per-frame refills, and seed
    // the window at spawn.
    //
    // Gate STRICTLY on the rect/oriented caps — NOT on clipped_rows. clipped_rows
    // also counts dropped HEIGHTFIELDS (too many painted relief chunks / ramp-stair
    // fields for MAX_HEIGHTFIELDS), and a heightfield overflow must not flip an
    // otherwise-fitting authored map into windowing. As long as the
    // rects/oriented fit, the baked colliders own door cuts, wall joins, and
    // floor/roof bands; only true rect/oriented overflow should swap to the
    // instance-derived near-field.
    if (self.physics_colliders.rect_count >= game_physics.MAX_RECTS or
        self.physics_colliders.oriented_count >= game_physics.MAX_ORIENTED)
    {
        if (buildSpatialGrid(self.allocator, self.insts, self.inst_count, self.stride)) |g| {
            const cap = self.physics_colliders.rectBase() + game_physics.MAX_RECTS * game_physics.RECT_FLOATS + game_physics.MAX_ORIENTED * game_physics.ORIENTED_FLOATS;
            if (self.allocator.alloc(f32, cap)) |buf| {
                @memset(buf, 0);
                self.allocator.free(self.physics_colliders.values);
                self.physics_colliders.values = buf;
                self.grid = g;
                self.windowed = true;
                rebuildWindow(self, spawn.x, spawn.z);
                log.print("[loader] spatial collider windowing ON — {d} spanning + grid {d}x{d}; near-field {d} rects + {d} oriented\n", .{ g.always.len, g.cols, g.rows, self.physics_colliders.rect_count, self.physics_colliders.oriented_count });
            } else |_| {
                g.deinit(self.allocator);
            }
        } else |_| {}
    }
    self.camera = .{
        .yaw_degrees = authored_yaw * 180.0 / std.math.pi,
        .pitch_degrees = CAMERA_INITIAL_PITCH_DEGREES,
        .far = @max(far, bounds.radius * 4.0 + 64.0),
    };
    self.cube = buildCube();
    self.sticker_quad_x = m_geometry.buildStickerQuad(0);
    self.sticker_quad_y = m_geometry.buildStickerQuad(1);
    self.sticker_quad_z = m_geometry.buildStickerQuad(2);
    self.cube_open_run_min = buildCubeOpenRun(true, false);
    self.cube_open_run_max = buildCubeOpenRun(false, true);
    self.cube_open_run_both = buildCubeOpenRun(true, true);
    self.ramp_slab = buildRampSlab();
    self.cylinder8 = buildUnitCylinder(8);
    self.cylinder16 = buildUnitCylinder(16);
    self.sphere = buildUnitSphere(12, 8);
    self.brush_decal = buildBrushDecal(32);
    self.brush_rings = buildBrushRings(32);
    self.brush_handles = buildBrushHandles(32);
    self.brush_cone = buildBrushCone(32);
    self.brush_dome = buildBrushDome(32, 6);
    self.gable_prism = buildGablePrism();
    self.corner_miter_prism = buildCornerMiterPrism();
    self.corner_miter_mirror_prism = buildCornerMiterMirrorPrism();
    self.grass_blade = buildGrassBlade();
    self.flower_head = buildFlowerHead();
    self.bush_clump = buildBushClump();
    self.frond_card = buildFrond();
    self.palm_trunk = buildPalmTrunk();
    for (0..foliage.WRAPPED_SPECIES_COUNT) |i| {
        const species: foliage.WrappedSpecies = @enumFromInt(i);
        self.wrapped_meshes[i] = flora_geometry.buildWrapped(species);
    }
    // Expanded foliage rows are stride-13 (transform12 + shape); if the INSTANCES
    // lump was empty (stride 0) but a FLORA recipe ships, the grass/bush draw
    // nodes still need the 13-wide stride. Real bakes always carry pieces, so
    // this only matters for a foliage-only map.
    if (self.scene.flora != null and self.stride < 13) self.stride = 13;
    self.shape_batches = try buildShapeBatches(self.allocator, self.insts, self.inst_count, self.stride, self.scene.material_refs, self.scene.wall_flags, self.scene.flora);
    self.has_shape_batches = true;
    // The textured remainder: rows wearing a material, partitioned per slot.
    // The shaders run at first render (gpu isn't up yet); the nodes carry the
    // material key now so scene3d samples it once it's materialized.
    self.material_batches = try buildMaterialBatches(self.allocator, self.insts, self.inst_count, self.stride, self.scene.materials, self.scene.material_refs, self.scene.wall_flags);

    // ── content streaming gate (req_0524) ── engage when the world's extent
    // outgrows the detail radius (auto), or RJIT_STREAM=1 forces it; tiny
    // maps keep the exact monolithic path. RJIT_STREAM=0 kills it. Setup
    // failure leaves stream null and the monolithic path takes over.
    self.stream_radius = streamRadiusFromEnv(environ);
    const full_bounds = instanceBounds(self.insts, self.inst_count, self.stride);
    const want_stream = switch (streamModeFromEnv(environ)) {
        .off => false,
        .force => self.inst_count > 0,
        .auto => full_bounds.radius > self.stream_radius,
    };
    if (want_stream) setupStreaming(self) catch |err| {
        log.print("[loader] streaming setup FAILED ({any}) — monolithic draws\n", .{err});
    };
    // Whichever array DRAWS a shader material must wear white (the sampled
    // texture would multiply with the row tint): the streaming world's
    // sorted copies, or the monolithic batch arrays. The streaming LOD
    // shell accumulated the REAL colors before this — distant buildings
    // keep their look. Translucent (glass) batches always keep their tint.
    if (self.stream) |*w| {
        for (self.stream_protos.items, 0..) |proto, fi| {
            if (proto.tex_key) |tk| {
                // The "~grass~"/"~frond~" sentinels are routing, NOT real
                // textures — the grass/frond shaders read inst_color as the
                // per-card root tint, so never whiten them (that would flatten
                // the field to one green / the crowns to white).
                if (std.mem.eql(u8, tk, "~grass~") or std.mem.eql(u8, tk, "~frond~")) continue;
                whitenRows(w.families[fi].rows, w.families[fi].stride);
            }
        }
    } else {
        for (self.material_batches) |batch| {
            if (!batch.translucent) whitenRows(batch.boxes, self.stride);
        }
    }

    try self.kid_list.append(self.allocator, .{
        .scene3d_camera = true,
        .scene3d_pos_x = 0,
        .scene3d_pos_y = 0,
        .scene3d_pos_z = 0,
        .scene3d_look_x = 0,
        .scene3d_look_y = 0,
        .scene3d_look_z = 0,
        .scene3d_fov = CAMERA_FOV_DEGREES,
        .scene3d_far = far,
    });
    try self.kid_list.append(self.allocator, .{
        .scene3d_skybox = true,
        .scene3d_sky_zenith = env.sky_zenith,
        .scene3d_sky_horizon = env.sky_horizon,
        .scene3d_sky_ground = env.sky_ground,
        .scene3d_sky_sun_dir = env.sky_sun_dir,
        .scene3d_sky_sun_color = env.sky_sun_color,
        .scene3d_sky_haze = env.sky_haze,
        .scene3d_sky_cloud = env.sky_cloud,
        .scene3d_sky_night = env.sky_night,
    });
    try self.kid_list.append(self.allocator, .{ .scene3d_light = true, .scene3d_light_type = "ambient", .scene3d_color_r = env.ambient_color[0], .scene3d_color_g = env.ambient_color[1], .scene3d_color_b = env.ambient_color[2], .scene3d_intensity = env.ambient_intensity });
    try self.kid_list.append(self.allocator, .{ .scene3d_light = true, .scene3d_light_type = "directional", .scene3d_dir_x = env.dir[0], .scene3d_dir_y = env.dir[1], .scene3d_dir_z = env.dir[2], .scene3d_color_r = env.dir_color[0], .scene3d_color_g = env.dir_color[1], .scene3d_color_b = env.dir_color[2], .scene3d_intensity = env.dir_intensity });

    // GLOBALS req_2770 / req_2780: a blank/pre-lump world wears the EXPORTED
    // player model when one is staged (__compiled_world_set_player_model);
    // only when nothing is staged does the stand-in figure mount. The scene
    // owns the groups exactly like a decoded lump (Scene.deinit frees them).
    // SKINNED figure (SKIN-3499): a staged skin WINS over the per-part model —
    // ONE palette-blended node instead of N part nodes. The palette buffer is
    // runtime-owned (freed at teardown) because animation.zig rewrites it every
    // frame while the node holds a read view. When a skin is present the
    // per-part staging/fallback below is skipped entirely (player_model stays
    // empty, so the group loop emits nothing).
    if (self.scene.player_skin == null) {
        if (pendingPlayerSkinCopy(self.allocator)) |skin| {
            self.scene.player_skin = skin;
            log.print("[loader] player skin from live push — {d} verts × {d} bones (SKIN-3499)\n", .{ skin.vertex_count, skin.bones.len });
        }
    }
    if (self.scene.player_skin) |skin| {
        if (self.scene.player_animation.clips.len == 0) {
            if (pendingPlayerAnimationCopy(self.allocator, skin.bones.len)) |animation| {
                self.scene.player_animation = animation;
                log.print("[loader] player animation from live push — {d} clips (req_2781)\n", .{animation.clips.len});
            }
        }
        if (self.player_skin_palette.len > 0) self.allocator.free(self.player_skin_palette);
        self.player_skin_palette = try self.allocator.alloc(f32, skin.bones.len * m_pose.BONE_FLOATS);
        for (skin.bones, 0..) |bone, i| m_pose.writeRestPalette(self.player_skin_palette, i, bone.center, bone.color);
        const skin_key = try std.fmt.allocPrint(self.allocator, "player-skin-{x}", .{geomContentHash(skin.vertices)});
        self.player_geom_keys.append(self.allocator, skin_key) catch |err| {
            self.allocator.free(skin_key);
            return err;
        };
        self.player_first_child = self.kid_list.items.len;
        try self.kid_list.append(self.allocator, .{
            .scene3d_skin_geom_key = skin_key,
            .scene3d_skin_vertices = skin.vertices,
            .scene3d_skin_vert_count = skin.vertex_count,
            .scene3d_skin_palette = self.player_skin_palette,
            .scene3d_skin_bone_count = @intCast(skin.bones.len),
            .scene3d_color_r = 1,
            .scene3d_color_g = 1,
            .scene3d_color_b = 1,
            .scene3d_color_a = 1,
        });
        // Globals → Animation asks for markers through the skin bone table.
        // Keep one slot per bone so the palette index and marker index are
        // identical; non-tracked helper/mesh bones are inert nodes. Ordinary
        // play has no marked bones and constructs no nodes at all.
        const has_pose_markers = for (skin.bones) |bone| {
            if (bone.marker_kind != .none) break true;
        } else false;
        if (has_pose_markers) {
            self.player_pose_marker_first = self.kid_list.items.len;
            self.player_pose_marker_count = skin.bones.len;
            for (skin.bones) |bone| {
                const marker_color = m_pose_markers.color(bone.marker_kind);
                try self.kid_list.append(self.allocator, .{
                    .scene3d_mesh = bone.marker_kind != .none,
                    .scene3d_geom_key = "sphere12x8",
                    .scene3d_vertices = self.sphere[0..],
                    .scene3d_vert_count = 12 * 8 * 6,
                    .scene3d_color_r = marker_color[0],
                    .scene3d_color_g = marker_color[1],
                    .scene3d_color_b = marker_color[2],
                    .scene3d_color_a = 1,
                    .scene3d_scale_x = m_pose_markers.Tuning.diameter_meters,
                    .scene3d_scale_y = m_pose_markers.Tuning.diameter_meters,
                    .scene3d_scale_z = m_pose_markers.Tuning.diameter_meters,
                });
            }
        }
    } else if (self.scene.player_model.len == 0) {
        if (pendingPlayerModelCopy(self.allocator)) |groups| {
            self.scene.player_model = groups;
            log.print("[loader] player model from live push — {d} groups (req_2780)\n", .{groups.len});
        } else {
            self.scene.player_model = fallbackPlayerModel(self.allocator) catch &.{};
            if (self.scene.player_model.len > 0) {
                log.print("[loader] no player model lump — stand-in figure (GLOBALS req_2770)\n", .{});
            }
        }
    }
    // Staged basic-shape clips ride in the same way (req_2781) — only when
    // the gamefile brought none, and only when the node count matches. The
    // skinned branch above consumed them against its bone count already.
    if (self.scene.player_skin == null and self.scene.player_animation.clips.len == 0) {
        if (pendingPlayerAnimationCopy(self.allocator, self.scene.player_model.len)) |animation| {
            self.scene.player_animation = animation;
            log.print("[loader] player animation from live push — {d} clips (req_2781)\n", .{animation.clips.len});
        }
    }
    if (self.scene.player_skin == null) self.player_first_child = self.kid_list.items.len;
    for (self.scene.player_model, 0..) |group, i| {
        const key = try std.fmt.allocPrint(self.allocator, "player-model-{d}-{x}", .{ i, geomContentHash(group.vertices) });
        self.player_geom_keys.append(self.allocator, key) catch |err| {
            self.allocator.free(key);
            return err;
        };
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = group.vertex_count > 0,
            .scene3d_geom_key = key,
            .scene3d_vertices = group.vertices,
            .scene3d_vert_count = group.vertex_count,
            .scene3d_color_r = group.color[0],
            .scene3d_color_g = group.color[1],
            .scene3d_color_b = group.color[2],
            .scene3d_color_a = group.alpha,
            .scene3d_tex_w = group.tex_w,
            .scene3d_tex_h = group.tex_h,
            .scene3d_tex_rgba = group.tex_rgba,
        });
    }
    if (self.scene.player_skin == null and self.scene.player_model.len == 0) log.print("[loader] no player model lump and stand-in failed — camera target only\n", .{});

    // NPC figures (req_0935): one child node per spawn × model group, posed
    // every frame by updateNpcModelNodes. Each (spawn, group) gets a unique
    // geom key — a small Stage-1 population interns well within GEO_CACHE;
    // sharing keys per model to dedup geometry is a later optimization once
    // crowds grow. y is grounded on the terrain like the player spawn.
    self.npcs.clearRetainingCapacity();
    for (self.scene.npc_spawns) |npc_spawn| {
        const mi: usize = @intCast(npc_spawn.model_index);
        if (mi >= self.scene.npc_models.len) continue;
        const groups = self.scene.npc_models[mi];
        if (groups.len == 0) continue;
        const ground = sceneTerrainTopAt(self.scene.heightfields, npc_spawn.x, npc_spawn.z) orelse 0;
        const first = self.kid_list.items.len;
        const npc_index = self.npcs.items.len;
        for (groups, 0..) |group, gi| {
            const key = try std.fmt.allocPrint(self.allocator, "npc-{d}-{d}-{d}-{x}", .{ npc_index, mi, gi, geomContentHash(group.vertices) });
            self.player_geom_keys.append(self.allocator, key) catch |err| {
                self.allocator.free(key);
                return err;
            };
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = group.vertex_count > 0,
                .scene3d_geom_key = key,
                .scene3d_vertices = group.vertices,
                .scene3d_vert_count = group.vertex_count,
                .scene3d_color_r = group.color[0],
                .scene3d_color_g = group.color[1],
                .scene3d_color_b = group.color[2],
                .scene3d_color_a = group.alpha,
                .scene3d_tex_w = group.tex_w,
                .scene3d_tex_h = group.tex_h,
                .scene3d_tex_rgba = group.tex_rgba,
            });
        }
        try self.npcs.append(self.allocator, .{
            .model_index = npc_spawn.model_index,
            .first_child = first,
            .group_count = groups.len,
            .x = npc_spawn.x,
            .y = ground,
            .z = npc_spawn.z,
            .yaw = npc_spawn.yaw,
        });
    }
    if (self.npcs.items.len > 0) log.print("[loader] built {d} NPC figure(s) from {d} model(s)\n", .{ self.npcs.items.len, self.scene.npc_models.len });

    if (self.scene.mesh_props) |mp| {
        // req_1864: cooked-door instances, in mp.instances order, align 1:1 with
        // self.cooked_doors (the bake only flags a door mesh when its leaf slot has
        // content). cd_idx walks them so the leaf slot node binds to its door.
        var cd_idx: usize = 0;
        for (mp.instances) |inst| {
            const mesh_index: usize = @intCast(inst.mesh);
            const mesh = mp.meshes[mesh_index];
            var this_cooked_door: ?usize = null;
            if (mesh.door != null and cd_idx < self.cooked_doors.len) {
                this_cooked_door = cd_idx;
                cd_idx += 1;
            }
            // RESKIN req_1845: remember the node range this instance occupies, keyed by
            // its world position, so a live re-skin of the same prop can hide it.
            const inst_first = self.kid_list.items.len;
            defer {
                const cnt = self.kid_list.items.len - inst_first;
                if (cnt > 0) {
                    const rng: BakedRange = .{ .first = @intCast(inst_first), .count = @intCast(cnt) };
                    self.baked_by_pos.put(self.allocator, meshPosKey(mesh_index, inst.x, inst.z, inst.yaw_degrees), rng) catch {};
                    // DIRTYRECT: also index by raw position so an erase rect can hide a MOVED prop.
                    // WALLHIDE req_2058: carry the wall flag so hide-walls hides cooked-wall props too.
                    self.baked_mesh_list.append(self.allocator, .{ .x = inst.x, .y = inst.y, .z = inst.z, .range = rng, .wall = inst.wall }) catch {};
                }
            }
            if (mesh.slots.len == 0) {
                // A painted cooked prop (req_1496) carries its atlas as tex_rgba —
                // wear it via scene3d_tex_rgba and whiten the tint so it doesn't
                // dim the texture. Untextured imports stay tinted.
                try appendMeshPropNode(self, mesh, inst, mesh.key, 0, mesh.vertex_count, 0, null, null);
                continue;
            }

            const first_slot_start = mesh.slots[0].start;
            if (first_slot_start > 0) {
                const key = try std.fmt.allocPrint(self.allocator, "{s}:base", .{mesh.key});
                self.player_geom_keys.append(self.allocator, key) catch |err| {
                    self.allocator.free(key);
                    return err;
                };
                try appendMeshPropNode(self, mesh, inst, key, 0, first_slot_start, 0, null, null);
            }
            for (mesh.slots, 0..) |slot, si| {
                // Named face-texture roles retain their manifest index before any
                // face is assigned. They consume a material-table position but no
                // geometry node in either the baked or live draw path.
                if (slot.count == 0) continue;
                const key = try std.fmt.allocPrint(self.allocator, "{s}:slot-{d}", .{ mesh.key, si });
                self.player_geom_keys.append(self.allocator, key) catch |err| {
                    self.allocator.free(key);
                    return err;
                };
                const material_ref = if (si < inst.slot_materials.len) inst.slot_materials[si] else 0;
                const leaf_node_index = self.kid_list.items.len;
                try appendMeshPropNode(self, mesh, inst, key, slot.start, slot.count, material_ref, null, null);
                // req_1864/req_1908: bind the door's leaf node range to its live
                // machine; stepCookedDoors owns the leaf transform every frame
                // (swings it about the hinge), so no instant drop here. req_2020:
                // the leaf is every slot from leaf_slot to the last (opaque frame
                // then, for a glass door, its translucent pane) — bind them all so
                // the window swings with the frame instead of staying behind.
                if (this_cooked_door) |di| {
                    if (mesh.door) |door| {
                        if (si >= door.leaf_slot) {
                            if (self.cooked_doors[di].node_child_count == 0) {
                                self.cooked_doors[di].node_child_first = leaf_node_index;
                            }
                            self.cooked_doors[di].node_child_count =
                                self.kid_list.items.len - self.cooked_doors[di].node_child_first;
                        }
                    }
                }
            }
        }
        if (mp.instances.len > 0) {
            var wall_props: usize = 0;
            for (mp.instances) |inst| {
                if (inst.wall) wall_props += 1;
            }
            log.print("[loader] built {d} imported prop mesh instance(s) from {d} mesh asset(s) ({d} wall, hide-walls aware)\n", .{ mp.instances.len, mp.meshes.len, wall_props });
        }
    }

    for (self.scene.heightfields, 0..) |field, i| {
        // Version = a hash of the field's content so the host dyn-slot cache
        // rebuilds the mesh on reload when the terrain changed (req_1290). The
        // id ("loader-floor-{i}") stays stable so the slot is REUSED, not
        // re-allocated — only the version flips when the shape differs.
        const key = try std.fmt.allocPrint(self.allocator, "~hf~loader-floor-{d}~{x}", .{ i, heightfieldContentHash(field) });
        self.player_geom_keys.append(self.allocator, key) catch |err| {
            self.allocator.free(key);
            return err;
        };
        const max_abs_y = maxAbsHeight(field.heights);
        const bounds_radius = @sqrt(field.width * field.width * 0.25 + field.depth * field.depth * 0.25 + max_abs_y * max_abs_y);
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = true,
            .scene3d_geom_key = key,
            .scene3d_heights = field.heights,
            .scene3d_hf_cols = field.cols,
            .scene3d_hf_rows = field.rows,
            .scene3d_hf_width = field.width,
            .scene3d_hf_depth = field.depth,
            .scene3d_hf_base = 0,
            .scene3d_bounds_radius = bounds_radius,
            .scene3d_pos_x = field.center_x,
            .scene3d_pos_y = field.base_y,
            .scene3d_pos_z = field.center_z,
            // Whitened when the look is a texture OR a formula: the ground
            // pipeline multiplies inst_color * hf_ground_rgb(uv), so a flat
            // tint would dim the formula. Only the bare fallback keeps color.
            .scene3d_color_r = if (field.tex_rgba != null or field.ground_formula != null) 1 else field.color[0],
            .scene3d_color_g = if (field.tex_rgba != null or field.ground_formula != null) 1 else field.color[1],
            .scene3d_color_b = if (field.tex_rgba != null or field.ground_formula != null) 1 else field.color[2],
            .scene3d_tex_w = field.tex_w,
            .scene3d_tex_h = field.tex_h,
            .scene3d_tex_rgba = field.tex_rgba,
            // v3 ground: render the painted floor through the per-fragment
            // FORMULA (gpu/3d.zig g_ground_pipeline) — crisp at any distance,
            // the same shader the editor /test view runs. Wins over tex_rgba
            // (which is null on v3 lumps) in the 3d.zig draw dispatch.
            .scene3d_ground_formula = field.ground_formula,
            .scene3d_ground_data = field.ground_data,
        });
    }
    if (self.scene.heightfields.len > 0) {
        const first = self.scene.heightfields[0];
        log.print("[loader] built {d} terrain heightfield mesh(es); first grid {d}x{d} at ({d:.2},{d:.2}) span {d:.2}x{d:.2}\n", .{ self.scene.heightfields.len, first.cols, first.rows, first.center_x, first.center_z, first.width, first.depth });
    }

    // Bodies of water (world/water): one STATIC flat heightfield per body,
    // routed to the fixed "~water~" host pipeline (gpu/3d.zig g_water_pipeline,
    // shaders.water_wgsl) by the tex key — the twin of "~grass~". All wave
    // motion + the deep/shallow gradient, foam, and Bayer-dither halftone live
    // in that pipeline, animated from the host S.time clock, so the mesh bakes
    // ONCE (no per-frame re-bake) and is OPAQUE: the dither IS the see-through
    // water, and an opaque mesh stays on the pipeline-swap path (color_a < 1
    // would divert to the transparent pass and miss the pipeline). The skirt
    // down to `base` makes a wadeable volume. Water is NOT in scene.heightfields,
    // so it never registers as a collider (wade, don't bump). This matches the
    // editor (cart/hmsc-int render3d/WaterBody.tsx) exactly — same 3d.zig.
    if (self.scene.water) |w| {
        for (w.bodies, 0..) |body, i| {
            const key = try std.fmt.allocPrint(self.allocator, "~hf~water-{d}~1", .{i});
            self.player_geom_keys.append(self.allocator, key) catch |err| {
                self.allocator.free(key);
                return err;
            };
            const max_abs_y = maxAbsHeight(body.heights);
            const bounds_radius = @sqrt(body.width * body.width * 0.25 + body.depth * body.depth * 0.25 + max_abs_y * max_abs_y);
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = key,
                .scene3d_tex_key = "~water~",
                .scene3d_heights = body.heights,
                // Per-cell water depth (WATER lump v2) → hfGen bakes it into UV.x
                // for the water shader (deep/shallow + shoreline run-up). Empty on
                // v1 gamefiles (recompile to get the beach); hfGen falls back to
                // grid UV then.
                .scene3d_hf_depths = if (body.depths.len == body.heights.len) body.depths else null,
                .scene3d_hf_cols = body.cols,
                .scene3d_hf_rows = body.rows,
                .scene3d_hf_width = body.width,
                .scene3d_hf_depth = body.depth,
                .scene3d_hf_base = body.base,
                // No baked wave — the ~water~ pipeline displaces the surface on
                // the GPU from S.time, so the field stays a flat static bake.
                .scene3d_bounds_radius = bounds_radius,
                .scene3d_pos_x = body.center_x,
                .scene3d_pos_y = 0,
                .scene3d_pos_z = body.center_z,
                // inst_color is ignored by the water shader (it carries the ONE
                // shared look); opaque so it rides the pipeline-swap path.
                .scene3d_color_r = w.color[0],
                .scene3d_color_g = w.color[1],
                .scene3d_color_b = w.color[2],
                .scene3d_color_a = 1,
            });
        }
        if (w.bodies.len > 0) log.print("[loader] built {d} water heightfield(s) → ~water~ pipeline\n", .{w.bodies.len});
    }
    // KICKPROP req_0625: dynamic props render as LIVE per-frame nodes (the
    // player-model pattern) — their parts are NOT in the one-time-uploaded
    // static instance buffer, so a rolling ball never re-stages the world.
    // Transforms land in updateDynamicPropNodes each step.
    self.dyn_first_child = self.kid_list.items.len;
    if (self.scene.dynamic_props) |dp| {
        for (dp.props) |dprop| {
            const part_count = dprop.parts.len / constructor.DYNAMIC_PART_FLOATS;
            var k: usize = 0;
            while (k < part_count) : (k += 1) {
                const row = dprop.parts[k * constructor.DYNAMIC_PART_FLOATS ..];
                const shape_id = row[12];
                var geom_key: []const u8 = "box";
                var verts: []const f32 = self.cube[0..];
                var vert_count: u32 = 36;
                if (shape_id == SHAPE_RAMP) {
                    geom_key = "ramp-slab";
                    verts = self.ramp_slab[0..];
                } else if (shape_id == SHAPE_BOX_OPEN_RUN_MIN) {
                    geom_key = "box-open-run-min";
                    verts = self.cube_open_run_min[0..];
                    vert_count = 30;
                } else if (shape_id == SHAPE_BOX_OPEN_RUN_MAX) {
                    geom_key = "box-open-run-max";
                    verts = self.cube_open_run_max[0..];
                    vert_count = 30;
                } else if (shape_id == SHAPE_BOX_OPEN_RUN_BOTH) {
                    geom_key = "box-open-run-both";
                    verts = self.cube_open_run_both[0..];
                    vert_count = 24;
                } else if (shape_id == SHAPE_CYLINDER8) {
                    geom_key = "cylinder8";
                    verts = self.cylinder8[0..];
                    vert_count = 8 * 12;
                } else if (shape_id == SHAPE_CYLINDER16) {
                    geom_key = "cylinder16";
                    verts = self.cylinder16[0..];
                    vert_count = 16 * 12;
                } else if (shape_id == SHAPE_SPHERE) {
                    geom_key = "sphere12x8";
                    verts = self.sphere[0..];
                    vert_count = 12 * 8 * 6;
                } else if (shape_id == SHAPE_GABLE) {
                    geom_key = "gable-prism";
                    verts = self.gable_prism[0..];
                    vert_count = 24;
                } else if (shape_id == SHAPE_CORNER_MITER) {
                    geom_key = "corner-miter-prism";
                    verts = self.corner_miter_prism[0..];
                    vert_count = 12;
                } else if (shape_id == SHAPE_CORNER_MITER_MIRROR) {
                    geom_key = "corner-miter-mirror-prism";
                    verts = self.corner_miter_mirror_prism[0..];
                    vert_count = 12;
                }
                try self.kid_list.append(self.allocator, .{
                    .scene3d_mesh = true,
                    .scene3d_geom_key = geom_key,
                    .scene3d_vertices = verts,
                    .scene3d_vert_count = vert_count,
                    .scene3d_scale_x = row[6],
                    .scene3d_scale_y = row[7],
                    .scene3d_scale_z = row[8],
                    .scene3d_color_r = row[9],
                    .scene3d_color_g = row[10],
                    .scene3d_color_b = row[11],
                });
            }
        }
    }
    // Elevator cars (req_0652) render as LIVE per-frame nodes too — one
    // box per car, positioned by stepElevators each step (the shaft frame
    // stays in the static instance buffer; only the car moves).
    self.car_first_child = self.kid_list.items.len;
    if (self.cars.len > 0) {
        const el = self.scene.elevators.?;
        for (self.cars, 0..) |car, i| {
            const shaft = el.shafts[i];
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = "box",
                .scene3d_vertices = self.cube[0..],
                .scene3d_vert_count = 36,
                .scene3d_pos_x = shaft.x,
                .scene3d_pos_y = car.car_y + shaft.car_thickness / 2,
                .scene3d_pos_z = shaft.z,
                .scene3d_scale_x = shaft.car_half_x * 2,
                .scene3d_scale_y = shaft.car_thickness,
                .scene3d_scale_z = shaft.car_half_z * 2,
                .scene3d_color_r = ELEVATOR_CAR_COLOR[0],
                .scene3d_color_g = ELEVATOR_CAR_COLOR[1],
                .scene3d_color_b = ELEVATOR_CAR_COLOR[2],
            });
        }
    }
    // Door panels (DOORS-0611) render as LIVE nodes — one box per door,
    // dropped out of sight while open (the jambs stay in the static
    // instance buffer; only the leaf toggles).
    self.door_first_child = self.kid_list.items.len;
    if (self.doors_state.len > 0) {
        const doors = self.scene.doors.?;
        for (self.doors_state, 0..) |door, i| {
            const record = doors.records[i];
            const hide: f32 = if (door.open) DOOR_OPEN_HIDE_DROP_METERS else 0;
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = "box",
                .scene3d_vertices = self.cube[0..],
                .scene3d_vert_count = 36,
                .scene3d_pos_x = record.x,
                .scene3d_pos_y = record.base_y + record.panel_h / 2 - hide,
                .scene3d_pos_z = record.z,
                .scene3d_rot_y = record.yaw_degrees,
                .scene3d_scale_x = record.panel_w,
                .scene3d_scale_y = record.panel_h,
                .scene3d_scale_z = record.panel_d,
                .scene3d_color_r = DOOR_PANEL_COLOR[0],
                .scene3d_color_g = DOOR_PANEL_COLOR[1],
                .scene3d_color_b = DOOR_PANEL_COLOR[2],
            });
        }
    }
    // LED ticker boards (req_0893 #3) render as LIVE instanced nodes — one
    // bucket per ticker, its lit-LED instance data rebuilt every frame by
    // stepTickers as the message scrolls. The dark HOUSING rode the static
    // prop bake; only the moving LEDs are here. Placed in the stable node
    // prefix (before the static/stream tail) so streaming never clobbers them.
    self.ticker_first_child = self.kid_list.items.len;
    if (self.scene.tickers) |tk| {
        self.ticker_buffers = try self.allocator.alloc([]f32, tk.boards.len);
        for (tk.boards, 0..) |board, i| {
            const max_dots = (@as(usize, board.window_cols) + 1) * @as(usize, board.rows);
            const buf = try self.allocator.alloc(f32, max_dots * INSTANCE_STRIDE);
            @memset(buf, 0);
            self.ticker_buffers[i] = buf;
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = "box",
                .scene3d_vertices = self.cube[0..],
                .scene3d_vert_count = 36,
                .scene3d_instance_data = buf,
                .scene3d_instance_count = 0,
                .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
                .scene3d_instance_static = false,
            });
        }
    }
    // Ambient road traffic (req_2056): three MUTABLE instance nodes — one per
    // vehicle-part shape (box / cylinder16 / sphere). stepTraffic rebuilds their
    // rows every frame as each vehicle advances along its baked route. Each buffer
    // is sized to the TOTAL rows of that shape across all vehicles (every vehicle
    // is drawn every frame). In the stable prefix like the tickers.
    self.traffic_first_child = self.kid_list.items.len;
    if (self.scene.traffic) |tr| {
        var box_rows: usize = 0;
        var cyl_rows: usize = 0;
        var sph_rows: usize = 0;
        for (tr.vehicles) |veh| {
            var ri: usize = 0;
            while (ri + TRAFFIC_PROTO_STRIDE <= veh.rows.len) : (ri += TRAFFIC_PROTO_STRIDE) {
                const shape = veh.rows[ri + 12];
                if (@abs(shape - SHAPE_CYLINDER16) < 0.5) {
                    cyl_rows += 1;
                } else if (@abs(shape - SHAPE_SPHERE) < 0.5) {
                    sph_rows += 1;
                } else {
                    box_rows += 1;
                }
            }
        }
        self.traffic_box_buf = try self.allocator.alloc(f32, box_rows * INSTANCE_STRIDE);
        self.traffic_cyl_buf = try self.allocator.alloc(f32, cyl_rows * INSTANCE_STRIDE);
        self.traffic_sphere_buf = try self.allocator.alloc(f32, sph_rows * INSTANCE_STRIDE);
        @memset(self.traffic_box_buf, 0);
        @memset(self.traffic_cyl_buf, 0);
        @memset(self.traffic_sphere_buf, 0);
        const buckets = [_]struct { buf: []f32, key: []const u8, verts: []const f32, vc: u32 }{
            .{ .buf = self.traffic_box_buf, .key = "box", .verts = self.cube[0..], .vc = 36 },
            .{ .buf = self.traffic_cyl_buf, .key = "cylinder16", .verts = self.cylinder16[0..], .vc = 16 * 12 },
            .{ .buf = self.traffic_sphere_buf, .key = "sphere12x8", .verts = self.sphere[0..], .vc = 12 * 8 * 6 },
        };
        for (buckets) |bk| {
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = bk.key,
                .scene3d_vertices = bk.verts,
                .scene3d_vert_count = bk.vc,
                .scene3d_instance_data = bk.buf,
                .scene3d_instance_count = 0,
                .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
                .scene3d_instance_static = false,
            });
        }
        log.print("[loader] built {d} traffic vehicle(s) ({d} box + {d} cyl + {d} sphere part rows)\n", .{ tr.vehicles.len, box_rows, cyl_rows, sph_rows });

        // [traffic-paths req_2072] a thin cyan ribbon tracing every route's
        // centerline, just above the road — toggled by P (or RJIT_TRAFFICPATHS=1
        // at boot). One box instance per route segment.
        var seg_cap: usize = 0;
        for (tr.vehicles) |veh| {
            const np = veh.route.len / 2;
            if (np >= 2) seg_cap += np - 1;
        }
        self.traffic_path_buf = try self.allocator.alloc(f32, seg_cap * INSTANCE_STRIDE);
        @memset(self.traffic_path_buf, 0);
        var pi: u32 = 0;
        for (tr.vehicles) |veh| {
            const np = veh.route.len / 2;
            if (np < 2) continue;
            var i: usize = 0;
            while (i + 1 < np) : (i += 1) {
                const ax = veh.route[i * 2];
                const az = veh.route[i * 2 + 1];
                const bx = veh.route[(i + 1) * 2];
                const bz = veh.route[(i + 1) * 2 + 1];
                const dx = bx - ax;
                const dz = bz - az;
                const len = @sqrt(dx * dx + dz * dz);
                if (len < 1.0e-4) continue;
                const gy = sceneTerrainTopAt(self.scene.heightfields, (ax + bx) * 0.5, (az + bz) * 0.5) orelse 0;
                const o = @as(usize, pi) * INSTANCE_STRIDE;
                self.traffic_path_buf[o + 0] = (ax + bx) * 0.5;
                self.traffic_path_buf[o + 1] = gy + 0.12;
                self.traffic_path_buf[o + 2] = (az + bz) * 0.5;
                self.traffic_path_buf[o + 3] = 0;
                self.traffic_path_buf[o + 4] = std.math.atan2(dx, dz) * 180.0 / std.math.pi;
                self.traffic_path_buf[o + 5] = 0;
                self.traffic_path_buf[o + 6] = 0.3; // ribbon width
                self.traffic_path_buf[o + 7] = 0.06; // thin
                self.traffic_path_buf[o + 8] = len; // length along +Z
                self.traffic_path_buf[o + 9] = 0.15;
                self.traffic_path_buf[o + 10] = 0.95;
                self.traffic_path_buf[o + 11] = 1.0; // cyan
                pi += 1;
            }
        }
        self.traffic_path_count = pi;
        self.traffic_paths_on = environ.get("RJIT_TRAFFICPATHS") != null;
        self.traffic_path_node = self.kid_list.items.len;
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = true,
            .scene3d_geom_key = "box",
            .scene3d_vertices = self.cube[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.traffic_path_buf,
            .scene3d_instance_count = if (self.traffic_paths_on) self.traffic_path_count else 0,
            .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
            .scene3d_instance_static = false,
        });
    }
    // LIVEHOST req_1798: reserve ONE mutable box-instance node for the editor's
    // live overlay (just-placed-but-unbaked pieces). Empty until applyPendingLive
    // points it at the runtime's live_buf. In the stable prefix (like the tickers)
    // so streaming's static/stream tail never clobbers it. Box geom + 12-stride rows
    // = the same unit-box instance path the world batches and pieceInstanceRows use.
    self.live_kid = self.kid_list.items.len;
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "box",
        .scene3d_vertices = self.cube[0..],
        .scene3d_vert_count = 36,
        .scene3d_instance_data = &.{},
        .scene3d_instance_count = 0,
        .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
        .scene3d_instance_static = false,
    });
    // MAPPAINT req_2473: the brush gizmo + the live-painted terrain mirror.
    // The gizmo is one translucent preview mesh (instance_count 0 + alpha
    // < 1 routes it through the transparent pass); the paint slots are inert
    // until applyPaintLayer assigns a painted chunk to one. All in the stable
    // prefix so streaming's tail rebuild never clobbers them.
    self.paint_beam_kid = self.kid_list.items.len;
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "box",
        .scene3d_vertices = self.cube[0..],
        .scene3d_vert_count = 36,
        .scene3d_color_a = PAINT_BEAM_ALPHA,
    });
    self.transport_committed_kid = self.kid_list.items.len;
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "box",
        .scene3d_vertices = self.cube[0..],
        .scene3d_vert_count = 36,
        .scene3d_instance_data = &.{},
        .scene3d_instance_count = 0,
        .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
        .scene3d_instance_static = false,
    });
    self.transport_preview_kid = self.kid_list.items.len;
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "box",
        .scene3d_vertices = self.cube[0..],
        .scene3d_vert_count = 36,
        .scene3d_instance_data = &.{},
        .scene3d_instance_count = 0,
        .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
        .scene3d_instance_static = false,
        .scene3d_color_a = TRANSPORT_RENDER.preview_alpha,
    });
    self.paint_kids_first = self.kid_list.items.len;
    var paint_slot: usize = 0;
    while (paint_slot < MAX_PAINT_SLOTS) : (paint_slot += 1) {
        try self.kid_list.append(self.allocator, .{ .scene3d_mesh = false });
    }
    // one water-surface node per paint slot ("~water~" pipeline, inert until wet)
    self.paint_water_kids_first = self.kid_list.items.len;
    paint_slot = 0;
    while (paint_slot < MAX_PAINT_SLOTS) : (paint_slot += 1) {
        try self.kid_list.append(self.allocator, .{ .scene3d_mesh = false });
    }
    // Live-foliage preview nodes (req_2497/req_2875/req_2877): ground flora,
    // the two palm parts, then every wrapped tree/shrub species. Each complete
    // shared mesh routes through ~frond~, so ONE painted plant is ONE 24-byte
    // slim GPU row. Inert until the worker supplies rows.
    self.paint_foliage_kids_first = self.kid_list.items.len;
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "grass-blade",
        .scene3d_tex_key = "~grass~",
        .scene3d_vertices = self.grass_blade[0..],
        .scene3d_vert_count = 36,
        .scene3d_instance_stride = @intCast(foliage.STRIDE),
        .scene3d_instance_static = true,
    });
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "flower-head",
        .scene3d_tex_key = "~grass~",
        .scene3d_vertices = self.flower_head[0..],
        .scene3d_vert_count = 36,
        .scene3d_instance_stride = @intCast(foliage.STRIDE),
        .scene3d_instance_static = true,
    });
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "bush-clump",
        .scene3d_tex_key = "~grass~",
        .scene3d_vertices = self.bush_clump[0..],
        .scene3d_vert_count = 60,
        .scene3d_instance_stride = @intCast(foliage.STRIDE),
        .scene3d_instance_static = true,
    });
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "frond-card",
        .scene3d_tex_key = "~frond~",
        .scene3d_vertices = self.frond_card[0..],
        .scene3d_vert_count = 144,
        .scene3d_instance_stride = @intCast(foliage.STRIDE),
        .scene3d_instance_static = true,
    });
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = false,
        .scene3d_geom_key = "palm-trunk",
        .scene3d_vertices = self.palm_trunk[0..],
        .scene3d_vert_count = 1680,
        .scene3d_instance_stride = @intCast(foliage.STRIDE),
        .scene3d_instance_static = true,
    });
    for (0..foliage.WRAPPED_SPECIES_COUNT) |i| {
        const species: foliage.WrappedSpecies = @enumFromInt(i);
        const mesh = &self.wrapped_meshes[i];
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = false,
            .scene3d_geom_key = flora_geometry.geometryKey(species),
            .scene3d_tex_key = "~frond~",
            .scene3d_vertices = mesh.constFloats(),
            .scene3d_vert_count = mesh.vertex_count,
            .scene3d_instance_stride = @intCast(foliage.STRIDE),
            .scene3d_instance_static = true,
        });
    }
    // The world batches are STATIC (built once at construct, never mutated) —
    // flag them so the host uploads each ONCE and redraws from the retained
    // instance buffer with no per-frame restage/upload. This is what makes a
    // 776k-instance city render flat-out: the world is data, the camera moves.
    // STREAMING replaces these two monolithic draws (and the instanced
    // material batches below) with per-chunk sub-range draws of the same
    // one-time upload, rebuilt each frame by refreshStreamNodes.
    if (self.stream == null) {
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.box_count > 0,
            .scene3d_geom_key = "box",
            .scene3d_vertices = self.cube[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.shape_batches.boxes,
            .scene3d_instance_count = self.shape_batches.box_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.box_open_run_min_count > 0,
            .scene3d_geom_key = "box-open-run-min",
            .scene3d_vertices = self.cube_open_run_min[0..],
            .scene3d_vert_count = 30,
            .scene3d_instance_data = self.shape_batches.boxes_open_run_min,
            .scene3d_instance_count = self.shape_batches.box_open_run_min_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.box_open_run_max_count > 0,
            .scene3d_geom_key = "box-open-run-max",
            .scene3d_vertices = self.cube_open_run_max[0..],
            .scene3d_vert_count = 30,
            .scene3d_instance_data = self.shape_batches.boxes_open_run_max,
            .scene3d_instance_count = self.shape_batches.box_open_run_max_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.box_open_run_both_count > 0,
            .scene3d_geom_key = "box-open-run-both",
            .scene3d_vertices = self.cube_open_run_both[0..],
            .scene3d_vert_count = 24,
            .scene3d_instance_data = self.shape_batches.boxes_open_run_both,
            .scene3d_instance_count = self.shape_batches.box_open_run_both_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.ramp_count > 0,
            .scene3d_geom_key = "ramp-slab",
            .scene3d_vertices = self.ramp_slab[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.shape_batches.ramps,
            .scene3d_instance_count = self.shape_batches.ramp_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.cylinder8_count > 0,
            .scene3d_geom_key = "cylinder8",
            .scene3d_vertices = self.cylinder8[0..],
            .scene3d_vert_count = 8 * 12,
            .scene3d_instance_data = self.shape_batches.cylinder8s,
            .scene3d_instance_count = self.shape_batches.cylinder8_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.cylinder16_count > 0,
            .scene3d_geom_key = "cylinder16",
            .scene3d_vertices = self.cylinder16[0..],
            .scene3d_vert_count = 16 * 12,
            .scene3d_instance_data = self.shape_batches.cylinder16s,
            .scene3d_instance_count = self.shape_batches.cylinder16_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.sphere_count > 0,
            .scene3d_geom_key = "sphere12x8",
            .scene3d_vertices = self.sphere[0..],
            .scene3d_vert_count = 12 * 8 * 6,
            .scene3d_instance_data = self.shape_batches.spheres,
            .scene3d_instance_count = self.shape_batches.sphere_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.gable_count > 0,
            .scene3d_geom_key = "gable-prism",
            .scene3d_vertices = self.gable_prism[0..],
            .scene3d_vert_count = 24,
            .scene3d_instance_data = self.shape_batches.gables,
            .scene3d_instance_count = self.shape_batches.gable_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.corner_miter_count > 0,
            .scene3d_geom_key = "corner-miter-prism",
            .scene3d_vertices = self.corner_miter_prism[0..],
            .scene3d_vert_count = 12,
            .scene3d_instance_data = self.shape_batches.corner_miters,
            .scene3d_instance_count = self.shape_batches.corner_miter_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.corner_miter_mirror_count > 0,
            .scene3d_geom_key = "corner-miter-mirror-prism",
            .scene3d_vertices = self.corner_miter_mirror_prism[0..],
            .scene3d_vert_count = 12,
            .scene3d_instance_data = self.shape_batches.corner_miter_mirrors,
            .scene3d_instance_count = self.shape_batches.corner_miter_mirror_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        // Grass blades: the "~grass~" tex key routes this batch to the grass
        // pipeline (gpu/3d.zig) — wind + wisp cutout + root→tip gradient.
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.grass_count > 0,
            .scene3d_geom_key = "grass-blade",
            .scene3d_tex_key = "~grass~",
            .scene3d_vertices = self.grass_blade[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.shape_batches.grass,
            .scene3d_instance_count = self.shape_batches.grass_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        // Flower heads: same grass pipeline and wind, but UVs switch the
        // shader to colored blossom cutouts.
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.flower_count > 0,
            .scene3d_geom_key = "flower-head",
            .scene3d_tex_key = "~grass~",
            .scene3d_vertices = self.flower_head[0..],
            .scene3d_vert_count = 36,
            .scene3d_instance_data = self.shape_batches.flowers,
            .scene3d_instance_count = self.shape_batches.flower_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        // Bush clumps: same "~grass~" foliage pipeline, bushier geometry.
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.bush_count > 0,
            .scene3d_geom_key = "bush-clump",
            .scene3d_tex_key = "~grass~",
            .scene3d_vertices = self.bush_clump[0..],
            .scene3d_vert_count = 60,
            .scene3d_instance_data = self.shape_batches.bush,
            .scene3d_instance_count = self.shape_batches.bush_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        // Palm crowns: the "~frond~" tex key routes this batch to the frond
        // pipeline (gpu/3d.zig) — leaf cutout + root→tip gradient + wind sway.
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.frond_count > 0,
            .scene3d_geom_key = "frond-card",
            .scene3d_tex_key = "~frond~",
            .scene3d_vertices = self.frond_card[0..],
            .scene3d_vert_count = 144,
            .scene3d_instance_data = self.shape_batches.frond,
            .scene3d_instance_count = self.shape_batches.frond_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        // Palm trunks: a normal LIT mesh (tapered/curved/scar-ringed log), no
        // foliage tex key — the per-instance row colour tints the bark.
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = self.shape_batches.palmtrunk_count > 0,
            .scene3d_geom_key = "palm-trunk",
            .scene3d_vertices = self.palm_trunk[0..],
            .scene3d_vert_count = 1680,
            .scene3d_instance_data = self.shape_batches.palmtrunks,
            .scene3d_instance_count = self.shape_batches.palmtrunk_count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
        });
        // Wrapped species: trunk/stems + leaves/blooms are one immutable mesh;
        // each placed tree or shrub is one ~frond~-routed 24-byte instance.
        for (0..foliage.WRAPPED_SPECIES_COUNT) |i| {
            const species: foliage.WrappedSpecies = @enumFromInt(i);
            const mesh = &self.wrapped_meshes[i];
            try self.kid_list.append(self.allocator, .{
                .scene3d_mesh = self.shape_batches.wrapped_counts[i] > 0,
                .scene3d_geom_key = flora_geometry.geometryKey(species),
                .scene3d_tex_key = "~frond~",
                .scene3d_vertices = mesh.constFloats(),
                .scene3d_vert_count = mesh.vertex_count,
                .scene3d_instance_data = self.shape_batches.wrapped[i],
                .scene3d_instance_count = self.shape_batches.wrapped_counts[i],
                .scene3d_instance_stride = @intCast(self.stride),
                .scene3d_instance_static = true,
            });
        }
    }

    // Per material: a SHADER material draws as one TEXTURED instanced box batch
    // (sampling the materialized shader via scene3d_tex_key, resolved once
    // ensureMaterials runs). A TRANSLUCENT flat material (glass) has no texture
    // and can't go through the opaque instanced pass — emit each of its rows as
    // an individual see-through mesh (scene3d_color_a) so the transparent pass
    // (single meshes, sorted far→near) draws it; those stay OUT of streaming
    // (sparse, already distance-culled). Textured-alpha materials use that
    // same single-mesh path but keep scene3d_tex_key so the stencil/decal
    // alpha samples instead of writing an invisible opaque face. Both share
    // the interned "box".
    var translucent_meshes: u32 = 0;
    for (self.material_batches) |batch| {
        if (batch.translucent or batch.textured_translucent) {
            var r: usize = 0;
            while (r < batch.count) : (r += 1) {
                const o = @as(usize, r) * self.stride;
                // Shape-aware (water discs / glass cylinders): a translucent
                // row keeps its instance shape id, so a 'disc' body of water
                // draws as a flat cylinder, not a square slab — parity with the
                // editor's WaterBody/Glass meshes. Box is the default.
                const shape_id = if (self.stride >= 13) batch.boxes[o + 12] else SHAPE_BOX;
                var geom_key: []const u8 = "box";
                var verts: []const f32 = self.cube[0..];
                var vert_count: u32 = 36;
                if (shape_id == SHAPE_CYLINDER8) {
                    geom_key = "cylinder8";
                    verts = self.cylinder8[0..];
                    vert_count = 8 * 12;
                } else if (shape_id == SHAPE_BOX_OPEN_RUN_MIN) {
                    geom_key = "box-open-run-min";
                    verts = self.cube_open_run_min[0..];
                    vert_count = 30;
                } else if (shape_id == SHAPE_BOX_OPEN_RUN_MAX) {
                    geom_key = "box-open-run-max";
                    verts = self.cube_open_run_max[0..];
                    vert_count = 30;
                } else if (shape_id == SHAPE_BOX_OPEN_RUN_BOTH) {
                    geom_key = "box-open-run-both";
                    verts = self.cube_open_run_both[0..];
                    vert_count = 24;
                } else if (shape_id == SHAPE_CYLINDER16) {
                    geom_key = "cylinder16";
                    verts = self.cylinder16[0..];
                    vert_count = 16 * 12;
                } else if (shape_id == SHAPE_SPHERE) {
                    geom_key = "sphere12x8";
                    verts = self.sphere[0..];
                    vert_count = 12 * 8 * 6;
                } else if (shape_id == SHAPE_RAMP) {
                    geom_key = "ramp-slab";
                    verts = self.ramp_slab[0..];
                } else if (shape_id == SHAPE_GABLE) {
                    geom_key = "gable-prism";
                    verts = self.gable_prism[0..];
                    vert_count = 24;
                } else if (shape_id == SHAPE_CORNER_MITER) {
                    geom_key = "corner-miter-prism";
                    verts = self.corner_miter_prism[0..];
                    vert_count = 12;
                } else if (shape_id == SHAPE_CORNER_MITER_MIRROR) {
                    geom_key = "corner-miter-mirror-prism";
                    verts = self.corner_miter_mirror_prism[0..];
                    vert_count = 12;
                }
                try self.kid_list.append(self.allocator, .{
                    .scene3d_mesh = true,
                    .scene3d_geom_key = geom_key,
                    .scene3d_vertices = verts,
                    .scene3d_vert_count = vert_count,
                    .scene3d_pos_x = batch.boxes[o + 0],
                    .scene3d_pos_y = batch.boxes[o + 1],
                    .scene3d_pos_z = batch.boxes[o + 2],
                    .scene3d_rot_y = batch.boxes[o + 4],
                    .scene3d_scale_x = batch.boxes[o + 6],
                    .scene3d_scale_y = batch.boxes[o + 7],
                    .scene3d_scale_z = batch.boxes[o + 8],
                    .scene3d_color_r = batch.boxes[o + 9],
                    .scene3d_color_g = batch.boxes[o + 10],
                    .scene3d_color_b = batch.boxes[o + 11],
                    .scene3d_color_a = batch.opacity,
                    .scene3d_tex_key = if (batch.textured_translucent) batch.key else null,
                });
                translucent_meshes += 1;
            }
            continue;
        }
        if (self.stream != null) continue; // streamed: drawn as per-chunk ranges
        // Shape-aware (req_0939): a skinned gable roof / cylinder / sphere
        // draws its real geometry sampling the same material texture, not a
        // textured box. Most batches are boxes (geomForShape's default).
        const geom = geomForShape(self, batch.shape);
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = batch.count > 0,
            .scene3d_geom_key = geom.key,
            .scene3d_vertices = geom.verts,
            .scene3d_vert_count = geom.vert_count,
            .scene3d_instance_data = batch.boxes,
            .scene3d_instance_count = batch.count,
            .scene3d_instance_stride = @intCast(self.stride),
            .scene3d_instance_static = true,
            .scene3d_tex_key = batch.key,
        });
    }
    if (self.scene.materials.len > 0) log.print("[loader] {d} face material(s) → {d} batch(es), {d} translucent meshes\n", .{ self.scene.materials.len, self.material_batches.len, translucent_meshes });
    // DIAG req_1109: dump each material batch (shape/count/key) + the UNSKINNED
    // ramp/gable counts, to see whether the gray flickering roof slope is a
    // skinned ramp batch, an unskinned flat-color ramp, or a z-fight overlap.
    if (self.scene.materials.len > 0) {
        for (self.material_batches, 0..) |batch, bi| {
            log.print("[diag-roof] matbatch[{d}] key={s} shape={d:.0} count={d} translucent={} tex_translucent={}\n", .{ bi, batch.key, batch.shape, batch.count, batch.translucent, batch.textured_translucent });
        }
        log.print("[diag-roof] UNSKINNED ramp_count={d} gable_count={d} box_count={d}\n", .{ self.shape_batches.ramp_count, self.shape_batches.gable_count, self.shape_batches.box_count });
    }

    // The streamed draw tail begins after every static-prefix node above;
    // refreshStreamNodes truncates back to here each frame. Capacity is
    // reserved once so the per-frame rebuild never allocates.
    if (self.stream) |*w| {
        self.stream_tail_start = self.kid_list.items.len;
        try self.kid_list.ensureUnusedCapacity(self.allocator, w.draws.len);
    }

    self.perm_node_count = self.kid_list.items.len; // before any streamed tail / live-mesh nodes
    self.root = .{ .children = self.kid_list.items };
    updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, cameraColliderSet(self), 0);
    if (self.scene.player_skin) |skin| {
        const marker_first = if (self.player_pose_marker_count == skin.bones.len) self.player_pose_marker_first else null;
        m_animation.updatePlayerSkinnedNode(self.kid_list.items, self.player_first_child, marker_first, skin, self.player_skin_palette, self.scene.player_animation, self.player, false, false, false);
    } else {
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, false, false, false);
    }
    refreshNpcNodes(self);
    // Seed the bubble at spawn and assemble the first draw tail — the very
    // first rendered frame already streams (the camera was just solved).
    refreshStreamNodes(self);
    self.last_ns = nowNs(io);
}
