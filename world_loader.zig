//! world_loader.zig — the stateless Zig loader (PLATMOD §4, V28). NO V8.
//!
//! Built with -Duse-v8=false: the binary links the GPU substrate (SDL3 + wgpu +
//! the framework draw pipelines + capture) and ZERO V8 / zero embedded bundle.
//! It reads a baked game-file, hands it to the constructor (which installs +
//! verifies the asset vocabulary and resolves every reference), and renders the
//! constructed world's 3D geometry to the swapchain via gpu/3d.zig — then (in
//! headless mode) captures its OWN frame to a PNG (SELFSHOT-0606, hidden window,
//! no desktop). This proves the user's pipeline end to end: TypeScript/React ->
//! encoded data -> stateless engine -> rendered 3D frame, no JS.
//!
//! The world's geometry rides as a packed instance buffer (the INSTANCES map
//! lump): authored objects lower to keyed primitive instances. Boxes are the
//! common path; ramps, cylinders, and spheres carry semantic prop/build shapes
//! without reintroducing JS. 3D is the ONLY path — there is no 2D tile grid and
//! no flag to gate it.
//!
//! Build:
//!   zig build app -Dapp-name=world_loader -Dapp-source=world_loader.zig \
//!     -Duse-v8=false -Dhas-gpu=true -Doptimize=ReleaseFast
//! Run (headless self-capture):
//!   ZIGOS_HEADLESS=1 ZIGOS_SCREENSHOT=1 ZIGOS_SCREENSHOT_OUTPUT=out.png \
//!     ZIGOS_SCREENSHOT_FRAMES=8 ./zig-out/bin/world_loader [game-file.b64]

const std = @import("std");
const c = @import("framework/c.zig").imports;
const wgpu = @import("wgpu");
const gpu = @import("framework/gpu/gpu.zig");
const capture = @import("framework/gpu/capture.zig");
const scene3d = @import("framework/gpu/3d.zig");
const material_tex = @import("framework/gpu/material_tex.zig");
const decal_raster = @import("framework/gpu/decal_raster.zig");
const layout = @import("framework/layout.zig");
const text_engine = @import("framework/primitive/text.zig");
const Node = layout.Node;
const constructor = @import("framework/world/constructor.zig");
const foliage = @import("framework/world/foliage.zig");
const flora_geometry = @import("framework/world/flora_geometry.zig");
const instance_collider_policy = @import("framework/world/instance_collider_policy.zig");
const streaming = @import("framework/world/streaming.zig");
const game_physics = @import("framework/game/physics.zig");
// MAPPAINT req_2473: the host-owned map painter. The loader renders its live
// chunks (sculpted terrain mirror), routes armed pointer input into its stroke
// engine, and refreshes its heightfield colliders — all in-process, no bridge.
const map_paint = @import("framework/game/map/engine.zig");
const map_chunks = @import("framework/game/map/chunks.zig");

// Resolution of each materialized shader's 1-tile texture (the shader's canvas
// is exactly one 1m tile; the face sampler REPEATS it across the surface).
const MATERIAL_TILE_PX: u32 = 256;

const WIN_W: c_int = 800;
const WIN_H: c_int = 600;
const DEFAULT_FIXTURE = "framework/testing/fixtures/gamefile_roundtrip.b64";
const RJMP_MAGIC: u32 = 0x504d4a52;
const STORE_DIR = "zig-out/game/contentstore";
const MAX_FRAMES: u32 = 600;
// Instance row: pos3 + rot3 + scale3 + color3 + optional shape id. The first
// 12 floats match gpu/3d.zig; shape id is loader metadata for keyed geometry.
const INSTANCE_STRIDE: usize = 12;
// A baked traffic prototype row (req_2056): the 12 instance floats + a shape id
// at index 12. Mirrors compile/worldTraffic.ts TRAFFIC_ROW_STRIDE.
const TRAFFIC_PROTO_STRIDE: usize = 13;
const SHAPE_BOX: f32 = 0;
const SHAPE_RAMP: f32 = 1;
const SHAPE_CYLINDER8: f32 = 2;

// MAPPAINT req_2473: live-painted terrain mirror. One render node + one
// collider slot per painted chunk; the collider ids claim the TOP of the
// game_physics heightfield table so baked scene fields (counting up from 0)
// never collide with them.
const MAX_PAINT_SLOTS: usize = 64;
const PAINT_COLLIDER_BASE: usize = game_physics.MAX_HEIGHTFIELDS - MAX_PAINT_SLOTS;
/// The default THPS-style brush beam: a translucent column over the brush footprint.
const PAINT_BEAM_HEIGHT_METERS: f32 = 42;
const PAINT_BEAM_ALPHA: f32 = 0.32;
const PAINT_GIZMO_SURFACE_LIFT_M: f32 = 0.035;
const PAINT_GIZMO_PROFILE_MAX_M: f32 = 8;
// Live-foliage preview STARTING sizes (req_2497: painting flora grows LITERAL
// blades/bushes/flowers/palms live). These are NOT walls (req_2843: "the
// 15.5mb cap on flora is killing me" — dozens of asks died on fixed budgets):
// pushFoliageRow DOUBLES a family when it fills, and the GPU retained pools
// grow to match (gpu/3d.zig growStaticPool, up to the device's granted
// maxBufferSize — real limits are requested at device creation now). The only
// refusals left are the machine's: allocator, device, frame rate. One palm =
// 1 trunk + ~16 crown fronds, so frond:trunk starts 16:1. Rows are SLIM on
// the GPU: grass/bush/flower/frond ride the 24 B SlimInstance pool and trunks
// the InstanceData pool. CPU side is 12 f32/row, reallocated on growth.
const PAINT_GRASS_ROW_CAP: u32 = 262144;
const PAINT_BUSH_ROW_CAP: u32 = 65536;
const PAINT_FLOWER_ROW_CAP: u32 = 65536;
const PAINT_FROND_ROW_CAP: u32 = 262144;
const PAINT_TRUNK_ROW_CAP: u32 = 16384;
const PAINT_WRAPPED_ROW_CAP: u32 = 16384;
const FOLIAGE_SEGMENT_HEADROOM_M: f32 = 16;
const FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M: f32 = 87; // 120 m chunk half-diagonal + row jitter

/// Live-preview node/buffer order. Ground families retain distance-density LOD;
/// palm parts and whole wrapped-flora silhouettes stay exact. Appending species here
/// keeps every row one existing 24-byte slim GPU instance.
const PaintFoliageFamily = enum(usize) {
    grass,
    flowers,
    bush,
    palm_fronds,
    palm_trunks,
    pine,
    maple,
    oak,
    cedar,
    spruce,
    mophead_hydrangea,
    panicle_hydrangea,
    leafy_thicket,
    wild_weed,
};
const PAINT_FOLIAGE_FAMILY_COUNT: usize = @intFromEnum(PaintFoliageFamily.wild_weed) + 1;
const PAINT_FOLIAGE_THINNABLE_COUNT: usize = @intFromEnum(PaintFoliageFamily.palm_fronds);
const PAINT_WRAPPED_FAMILY_FIRST: usize = @intFromEnum(PaintFoliageFamily.pine);
const PAINT_FOLIAGE_START_CAPS: [PAINT_FOLIAGE_FAMILY_COUNT]u32 = .{
    PAINT_GRASS_ROW_CAP,
    PAINT_FLOWER_ROW_CAP,
    PAINT_BUSH_ROW_CAP,
    PAINT_FROND_ROW_CAP,
    PAINT_TRUNK_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
    PAINT_WRAPPED_ROW_CAP,
};
const PAINT_FOLIAGE_NAMES: [PAINT_FOLIAGE_FAMILY_COUNT][]const u8 = .{
    "grass",             "flowers",           "bush",          "palm fronds", "palm trunks",
    "pine",              "maple",             "oak",           "cedar",       "spruce",
    "mophead hydrangea", "panicle hydrangea", "leafy thicket", "wild weed",
};
comptime {
    if (PAINT_FOLIAGE_FAMILY_COUNT != PAINT_WRAPPED_FAMILY_FIRST + foliage.WRAPPED_SPECIES_COUNT) {
        @compileError("paint foliage family order must end with WrappedSpecies in exact enum order");
    }
}
// Verbatim palm trunk constants (render3d/palmPopulation.ts PALM_CONFIG +
// PALM_TRUNK_UNIT_RADIUS) — the live trunk must roll the SAME hash chain the
// crown does so bark and fronds agree per cell.
const PALM_TRUNK_UNIT_RADIUS: f64 = 0.13;
const PALM_TRUNK_RADIUS_MIN: f64 = 0.14;
const PALM_TRUNK_RADIUS_MAX: f64 = 0.2;
const PALM_TRUNK_COLOR = [3]f32{ 0.48, 0.38, 0.26 };
const SHAPE_CYLINDER16: f32 = 3;
const SHAPE_SPHERE: f32 = 4;
const SHAPE_GABLE: f32 = 5; // req_0930: the triangular gable-end wall prism
const SHAPE_GRASS: f32 = 6; // a grass blade clump — drawn by the grass pipeline (wind/wisp/gradient)
const SHAPE_BUSH: f32 = 7; // a bush foliage clump — same foliage pipeline, bushier geometry
const SHAPE_FROND: f32 = 8; // a palm-crown frond card — drawn by the ~frond~ pipeline (leaf cutout + wind)
const SHAPE_PALMTRUNK: f32 = 9; // a palm trunk — tapered/curved/scar-ringed log, a normal lit mesh
const SHAPE_FLOWER: f32 = 10; // flower heads — tiny cards drawn by the ~grass~ wind pipeline
// A decorative box — renders exactly like SHAPE_BOX (geomForShape falls back to
// box) but NEVER becomes a physics collider. The procedural void shell
// (SKYBOX_PLAYBOOK) bakes thousands of these for the distant skyline; you never
// bump them (its single ground heightfield is what you walk on), and keeping them
// out of the collider build is what stops them saturating the rect/oriented cap.
const SHAPE_SCENERY_BOX: f32 = 11;
const SHAPE_CORNER_MITER: f32 = 12; // wall L-corner triangular miter prism
const SHAPE_CORNER_MITER_MIRROR: f32 = 13; // reflected wall L-corner miter prism
const SHAPE_BOX_OPEN_RUN_MIN: f32 = 14; // cube without local -x face
const SHAPE_BOX_OPEN_RUN_MAX: f32 = 15; // cube without local +x face
const SHAPE_BOX_OPEN_RUN_BOTH: f32 = 16; // cube without local +/-x faces
const SHAPE_WRAPPED_FIRST: f32 = 17; // contiguous whole-flora shapes, WrappedSpecies order

fn wrappedShapeId(species: foliage.WrappedSpecies) f32 {
    return SHAPE_WRAPPED_FIRST + @as(f32, @floatFromInt(@intFromEnum(species)));
}

fn wrappedSpeciesForShape(shape: f32) ?foliage.WrappedSpecies {
    const rounded: i32 = @intFromFloat(@round(shape - SHAPE_WRAPPED_FIRST));
    if (rounded < 0 or rounded >= foliage.WRAPPED_SPECIES_COUNT) return null;
    if (@abs(shape - wrappedShapeId(@enumFromInt(rounded))) >= 0.5) return null;
    return @enumFromInt(rounded);
}
// WALLHIDE req_2053: a marker stamped into the SHAPE slot (index 12) of a wall
// row INSIDE a built batch/family buffer — never in self.insts. It's safe to
// overwrite there because: (1) post-batching every shape/material batch and every
// stream family is single-geometry (the draw picks geometry from the batch/proto,
// not the per-row shape), and (2) makeInstance (gpu/3d.zig) reads only indices
// 0..11, so index 12 is GPU-dead. collapseWallRows finds wall rows by this value
// so hide-walls can scale them to 0 with no rebake. Value is far outside the real
// shape id range so a non-stamped row's true shape never reads as a wall.
const WALL_SENTINEL_SHAPE: f32 = 424242.0;
const SCAN_A: usize = 4;
const SCAN_D: usize = 7;
const SCAN_S: usize = 22;
const SCAN_W: usize = 26;
const SCAN_SPACE: usize = 44;
const SCAN_LSHIFT: usize = 225;
// Spawn drops in from slightly above the resolved ground (req_0523): an exact
// or stale surface sample must settle ONTO the floor, never inside it.
const SPAWN_DROP_CLEARANCE_METERS: f32 = 0.35;
const CAMERA_DISTANCE_METERS: f32 = 7.65;
const CAMERA_INITIAL_PITCH_DEGREES: f32 = 17.8;
const CAMERA_MIN_PITCH_DEGREES: f32 = -10.0;
const CAMERA_MAX_PITCH_DEGREES: f32 = 62.0;
const CAMERA_TARGET_HEIGHT_METERS: f32 = 1.45;
const CAMERA_FOV_DEGREES: f32 = 52.0;
const CAMERA_YAW_DEGREES_PER_PIXEL: f32 = 0.28;
const CAMERA_PITCH_DEGREES_PER_PIXEL: f32 = 0.22;
const CAMERA_SMOOTHING_PER_SECOND: f32 = 14.0;
const AIM_SHOULDER_SHIFT_METERS: f32 = 0.62;
const AIM_PIVOT_HEIGHT_METERS: f32 = 1.62;
const AIM_CROUCH_DROP_METERS: f32 = 0.42;
const AIM_DISTANCE_METERS: f32 = 2.4;
const AIM_LOOK_AHEAD_METERS: f32 = 12.0;
const AIM_MIN_PITCH_DEGREES: f32 = -1.15 * 180.0 / std.math.pi;
const AIM_MAX_PITCH_DEGREES: f32 = 1.0 * 180.0 / std.math.pi;
const AIM_FOV_DEGREES: f32 = 47.0;
// Camera-collision spring-arm (parity with the editor's play-camera-occlusion
// tuning): when a wall/roof sits between the eye and the player-side pivot, pull
// the eye in to the wall's near side instead of clipping through it.
const CAMERA_SPRING_MIN_DISTANCE_METERS: f32 = 0.7;
const CAMERA_SPRING_SKIN_METERS: f32 = 0.14;
const CAMERA_SPRING_SWEEP_RADIUS_METERS: f32 = 0.08;
const PLAYER_WALK_SPEED_METERS_PER_SECOND: f32 = 4.5;
const PLAYER_RUN_SPEED_METERS_PER_SECOND: f32 = 8.0;
const PLAYER_RADIUS_METERS: f32 = 0.42;
const PLAYER_HEIGHT_METERS: f32 = 1.9;
const PLAYER_STEP_HEIGHT_METERS: f32 = 0.42;
const PLAYER_WALL_RESTITUTION: f32 = 0.0;
const PLAYER_SURFACE_FRICTION: f32 = 0.55;
const PLAYER_SURFACE_RESTITUTION: f32 = 0.0;
const PLAYER_ACCELERATION_MULTIPLIER: f32 = 1.0;
const PLAYER_GRAVITY_METERS_PER_SECOND2: f32 = 10.0;
const PLAYER_JUMP_SPEED_METERS_PER_SECOND: f32 = 5.2;
const WALKABLE_SIDE_PUSH_GRACE_METERS: f32 = 0.08;
const PHYSICS_SOLID_HEIGHT_METERS: f32 = PLAYER_STEP_HEIGHT_METERS + 0.05;
const RAMP_SLAB_THICKNESS_METERS: f32 = 0.2;
const RAMP_SLAB_THICKNESS_RATIO: f32 = RAMP_SLAB_THICKNESS_METERS / 3.0;
const RAMP_HEIGHTFIELD_CELL_METERS: f32 = 0.6;
const RAMP_WALKABLE_SLOPE_COS: f32 = 0.6;
const PLAYER_WALK_CYCLES_PER_SECOND: f32 = 1.6;
const PLAYER_RUN_CYCLES_PER_SECOND: f32 = 2.3;
const PLAYER_CLIP_IDLE: u32 = 0;
const PLAYER_CLIP_WALK: u32 = 1;
const PLAYER_CLIP_JUMP: u32 = 2;
// PROPUSE req_0624 — the seat poses (compile/playerModel.ts CLIP.sit/lay).
const PLAYER_CLIP_SIT: u32 = 3;
const PLAYER_CLIP_LAY: u32 = 4;
const MAX_EMBEDDED_LOADERS: usize = 8;

// ── prop interaction (PROPUSE req_0624) — parity with /test's interact frame
// (cart/hmsc-int/editors/play/PlayRoute.tsx): same reach, same cancel radius,
// same prompt grammar, driven by the INTERACTABLES lump instead of a JS scan.
const SCAN_E: usize = 8;
const SCAN_P: usize = 19; // [traffic-paths req_2072] toggle the route-debug ribbon
const INTERACT_REACH_METERS: f32 = 2.2;
const INTERACT_Y_WINDOW_METERS: f32 = 2.5;
const INTERACT_SEARCH_CANCEL_MOVE_METERS: f32 = 0.35;
const INTERACT_NOTICE_SECONDS: f32 = 3.2;
// req_0674: the reach gate — the E ray starts at the standing chest/eye line
// and aims at the candidate's mid-body; a THIN solid collider crossing it
// (wall slab, closed door panel, window strip) kills the prompt. Props are
// chunkier than the thickness cap in both plan extents, so a candidate's own
// collider never blocks it. Mirrors PlayRoute.tsx's editor-side gate.
const INTERACT_EYE_HEIGHT_METERS: f32 = 1.4;
const INTERACT_PROP_AIM_HEIGHT_METERS: f32 = 0.9;
const INTERACT_BLOCKER_MAX_THICKNESS_METERS: f32 = 0.5;

// ── elevators (req_0652) — parity with /test's ride (PlayRoute.tsx): the car
// is a LIVE rect in the physics buffer, re-aimed in place per frame; E rides
// up a stop per press (wrapping down from the top) or calls the car to a
// landing. Tuning mirrors PLACED_TUNING (game/build/placed.ts) — per-shaft
// speed/thickness travel in the ELEVATORS lump, interaction reach here.
const ELEVATOR_ARRIVE_TOLERANCE_METERS: f32 = 0.02;
const ELEVATOR_BOARD_REACH_METERS: f32 = 1.2;
const ELEVATOR_BOARD_BELOW_METERS: f32 = 0.4;
const ELEVATOR_CALL_REACH_METERS: f32 = 2.8;
const ELEVATOR_CAR_FRICTION: f32 = 0.85;
const ELEVATOR_CAR_RESTITUTION: f32 = 0.02;
// the editor's BUILD_UI.elevatorCarColor look
const ELEVATOR_CAR_COLOR = [3]f32{ 0.68, 0.71, 0.75 };

// ── doors (DOORS-0611, req_0654) — /test's two-state door, native: the closed
// panel is a LIVE rect in the physics buffer + a live render node; E within
// the record's reach toggles open/closed (closed blocks body AND eye, open is
// genuinely clear). Per-door reach travels in the DOORS lump (edits.ts is the
// source); the leaf's look mirrors pieceShapes' DOOR_PANEL_COLOR (#0c1018).
const DOOR_PANEL_COLOR = [3]f32{ 0.047, 0.063, 0.094 };
const DOOR_PANEL_FRICTION: f32 = 0.85;
const DOOR_PANEL_RESTITUTION: f32 = 0.02;
/// vertical window around the door base the prompt accepts (player on the
/// same storey, mirrors the interactables Y window)
const DOOR_Y_WINDOW_METERS: f32 = 2.5;
/// an OPEN door's node drops here — out of every sightline (no node-hide
/// flag in the kid list)
const DOOR_OPEN_HIDE_DROP_METERS: f32 = 4000.0;
/// an OPEN door's rect parks here. Flipping blocksPlayer alone is NOT enough:
/// the host step side-pushes any rect too tall to step onto EVEN when
/// non-solid (physics.zig collideSolidRects — that's what makes walkable
/// platforms push you off their sides), so a de-flagged 2.2m door still
/// blocked the doorway (req_0663). Out of the world = out of every test.
const DOOR_OPEN_PARK_METERS: f32 = 1.0e9;

/// The door panel's world-AABB half extents (quarter-turn walls — exact).
fn doorHalfExtents(door: constructor.Door) [2]f32 {
    const rad = door.yaw_degrees * std.math.pi / 180.0;
    const half_x = @abs(@cos(rad)) * door.panel_w / 2 + @abs(@sin(rad)) * door.panel_d / 2;
    const half_z = @abs(@sin(rad)) * door.panel_w / 2 + @abs(@cos(rad)) * door.panel_d / 2;
    return .{ half_x, half_z };
}

/// The next stop the car serves from car_y: closest stop ABOVE, wrapping to
/// the bottom from the top (game/build/elevators.ts nextElevatorStop parity).
fn nextElevatorStop(stops: []const f32, car_y: f32) ?f32 {
    if (stops.len < 2) return null;
    for (stops) |stop| {
        if (stop > car_y + ELEVATOR_ARRIVE_TOLERANCE_METERS) return stop;
    }
    return stops[0];
}

fn nearestElevatorStop(stops: []const f32, y: f32) f32 {
    var best = stops[0];
    for (stops) |stop| {
        if (@abs(stop - y) < @abs(best - y)) best = stop;
    }
    return best;
}

fn elevatorStopIndex(stops: []const f32, stop: f32) usize {
    for (stops, 0..) |s, i| {
        if (s == stop) return i;
    }
    return 0;
}

const log = std.debug;

const Vec3 = struct {
    x: f32,
    y: f32,
    z: f32,
};

const Posture = enum { none, sit, lay };

const PlayerState = struct {
    x: f32,
    y: f32,
    z: f32,
    vx: f32 = 0,
    vy: f32 = 0,
    vz: f32 = 0,
    yaw: f32,
    grounded: bool = false,
    gait_phase: f32 = 0,
    jump_time: f32 = 0,
    /// Seated/lying on a prop (PROPUSE req_0624): movement is skipped and the
    /// figure plays the baked sit/lay clip until WASD/Space stands up.
    posture: Posture = .none,
};

/// One live NPC figure (req_0935): which baked model it wears, where its child
/// nodes start in the kid list, and its transform/animation state. Stage 1
/// renders + animates only (clip defaults to IDLE); the Stage-2 Zig combat AI
/// will drive x/z/yaw/gait/clip. y is grounded on the terrain at build time.
const NpcRuntime = struct {
    model_index: u32,
    first_child: usize,
    group_count: usize,
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
    gait_phase: f32 = 0,
    clip: u32 = PLAYER_CLIP_IDLE,
};

/// The interaction frame's live state — what the player can do right now and
/// what the HUD shows (prompt / search bar / notice). One per Runtime.
const InteractState = struct {
    /// session-local searched flags, parallel to interactables.instances
    searched: []bool = &.{},
    search_active: bool = false,
    search_instance: usize = 0,
    search_elapsed: f32 = 0,
    search_anchor_x: f32 = 0,
    search_anchor_z: f32 = 0,
    prev_e_down: bool = false,
    prompt_buf: [160]u8 = undefined,
    prompt_len: usize = 0,
    notice_buf: [192]u8 = undefined,
    notice_len: usize = 0,
    notice_left: f32 = 0,
    /// 0..1 while a search runs, negative when no bar should draw
    bar_progress: f32 = -1,

    fn prompt(self: *const InteractState) []const u8 {
        return self.prompt_buf[0..self.prompt_len];
    }

    fn notice(self: *const InteractState) []const u8 {
        return self.notice_buf[0..self.notice_len];
    }

    fn setPrompt(self: *InteractState, comptime fmt: []const u8, args: anytype) void {
        const written = std.fmt.bufPrint(&self.prompt_buf, fmt, args) catch self.prompt_buf[0..0];
        self.prompt_len = written.len;
    }

    fn postNotice(self: *InteractState, comptime fmt: []const u8, args: anytype) void {
        const written = std.fmt.bufPrint(&self.notice_buf, fmt, args) catch self.notice_buf[0..0];
        self.notice_len = written.len;
        self.notice_left = INTERACT_NOTICE_SECONDS;
    }
};

const CameraState = struct {
    yaw_degrees: f32,
    pitch_degrees: f32,
    current_pos: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    current_target: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    current_fov: f32 = CAMERA_FOV_DEGREES,
    initialized: bool = false,
    aiming: bool = false,
    far: f32,
    // External-camera override (LOADERVIEW req_1757): the editor drives the iso
    // authoring camera from JS (cart/hmsc-int IsoAuthor's IsoStage). JS pushes the
    // ALREADY-SOLVED eye + look + fov — the exact same GAME_CAMERA.solve(Isometric)
    // pose its picking math assumes — so the rendered view matches the cursor ray by
    // construction (no second orbit convention to keep in parity). When set the camera
    // SNAPS to it (no smoothing, no spring-arm) and ignores the player. setExternalCamera()
    // flips it on; the player-trailing game camera is untouched when off.
    external: bool = false,
    ext_pos: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    ext_look: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    ext_fov: f32 = CAMERA_FOV_DEGREES,
};

const PhysicsColliders = struct {
    values: []f32,
    rect_count: usize,
    oriented_count: usize,
    heightfield_count: usize,
    clipped_rows: usize,
    /// Dynamic-body slots reserved between the header and the rect data
    /// (KICKPROP req_0625) — the host step's entity section. The layout is
    /// [header][entity_capacity × ENTITY_FLOATS][rects][oriented]; every rect
    /// writer and reader must shift by this. 0 on maps with no dynamic props
    /// (and on the camera's dedicated set), keeping the legacy layout.
    entity_capacity: usize = 0,
    /// LIVE elevator car rects (req_0652): `car_count` rects starting at rect
    /// index `car_rect_start` are the cars, one per ELEVATORS-lump shaft in
    /// order — stepElevators re-aims their top/floor floats in place per
    /// frame. 0/0 on maps without elevators (and on the camera set).
    car_rect_start: usize = 0,
    car_count: usize = 0,
    /// LIVE door panel rects (DOORS-0611): `door_count` rects starting at
    /// rect index `door_rect_start`, one per DOORS-lump record in order —
    /// the E toggle flips their blocksPlayer float in place. 0/0 on maps
    /// without doors (and on the camera set).
    door_rect_start: usize = 0,
    door_count: usize = 0,
    /// LIVE cooked-door panel rects (req_1864): `cooked_door_count` rects starting
    /// at rect index `cooked_door_rect_start`, one per cooked-door mesh-prop
    /// instance in mp.instances order — the E toggle parks/unparks them in place,
    /// the same machinery as the DOORS-lump doors but sourced from a custom mesh.
    cooked_door_rect_start: usize = 0,
    cooked_door_count: usize = 0,

    pub fn deinit(self: PhysicsColliders, allocator: std.mem.Allocator) void {
        allocator.free(self.values);
    }

    /// First float index of the rect section.
    fn rectBase(self: *const PhysicsColliders) usize {
        return game_physics.INPUT_HEADER_FLOATS + self.entity_capacity * game_physics.ENTITY_FLOATS;
    }
};

/// One kickable prop's live body (KICKPROP req_0625) — stepped through the
/// host physics entity section every frame; render nodes follow it.
const PropBody = struct {
    x: f32,
    y: f32,
    z: f32,
    vx: f32 = 0,
    vy: f32 = 0,
    vz: f32 = 0,
    radius: f32,
    restitution: f32,
};

/// One elevator shaft's live car (req_0652) — parallel to the ELEVATORS-lump
/// shafts (first car_count of them) and to the live car rects in the physics
/// buffer. Car height is transient runtime state, parked at the bottom stop
/// on load (/test parity: doors persist, car height does not).
const ElevatorCar = struct {
    car_y: f32,
    target_y: f32,
};

/// One door's live two-state machine (DOORS-0611) — parallel to the
/// DOORS-lump records (first door_count of them) and to the live door rects.
/// State is transient like car height: doors boot at their authored state.
const DoorState = struct {
    open: bool,
};

/// One cooked door's live two-state machine (req_1864) — the toggleable leaf is
/// a mesh-prop slot NODE (the user's custom art) plus a parked-when-open rect.
/// Sourced from MeshPropDoor (MESH_PROPS v6), not the DOORS lump; runs the same
/// E-toggle as a built-in door but drops a mesh node instead of a box.
const CookedDoor = struct {
    /// the TARGET state — E / proximity flips it; `progress` animates toward it.
    open: bool,
    /// kid index of the FIRST leaf node (set during the mesh-prop node pass). The
    /// leaf renders as `node_child_count` contiguous slot nodes — the opaque frame
    /// plus, for a glass door (req_2020), its translucent window pane — all swung
    /// together about the hinge by stepCookedDoors.
    node_child_first: usize = 0,
    node_child_count: usize = 0,
    /// the leaf node's resting pose (the closed mesh-prop instance transform)
    node_base_y: f32 = 0,
    node_x: f32 = 0,
    node_z: f32 = 0,
    yaw_degrees: f32 = 0,
    /// rect index in physics_colliders (parked out of the world when open)
    rect_index: usize = 0,
    /// SWING (req_1908): the leaf rotates about this WORLD hinge line (one vertical
    /// edge of the leaf) by `progress * arc`. progress 0=closed .. 1=open, animated
    /// over COOKED_DOOR_OPEN_SECONDS so the door visibly swings instead of teleporting.
    hinge_x: f32 = 0,
    hinge_z: f32 = 0,
    progress: f32 = 0,
    /// world panel box (CLOSED): center + yawed-AABB half extents + base/height
    cx: f32,
    cz: f32,
    base_y: f32,
    panel_h: f32,
    half_x: f32,
    half_z: f32,
    /// LOCAL leaf half extents (req_1960) — the leaf's own half-width (X) + half-depth
    /// (Z) before any rotation, so stepCookedDoors recomputes the SWUNG world AABB each
    /// frame and the moving rect shoves the player (a real physical door).
    half_w_local: f32 = 0,
    half_d_local: f32 = 0,
    reach: f32,
    vehicle: bool,
};

/// SWING tuning (req_1908) — until per-door authoring lands, every cooked door
/// swings 90° about its hinge edge over this many seconds.
const COOKED_DOOR_SWING_ARC_DEGREES: f32 = 90.0;
const COOKED_DOOR_OPEN_SECONDS: f32 = 0.4;

/// Cooked-prop glass tint (req_2020) — hand-mirrors materials.ts GLASS_TINT
/// ('#a9c8d8', the editor's Glass()). A flat-translucent mesh-prop slot ships
/// opacity only; appendMeshPropNode tints it this blue so /compiled glass panes
/// match the React play view instead of falling back to the prop's gray.
const GLASS_TINT = [3]f32{ 169.0 / 255.0, 200.0 / 255.0, 216.0 / 255.0 }; // #a9c8d8

/// The world AABB of a cooked door's leaf panel (req_1864) — the leaf slot's
/// local bounds, yawed + offset by the placed instance. Shared by the rect
/// builder and the reach scan so collision and interaction agree. null when the
/// mesh carries no door or the leaf slot is empty/out of range.
fn cookedDoorWorldBox(mesh: constructor.MeshPropMesh, inst: constructor.MeshPropInstance) ?CookedDoor {
    const door = mesh.door orelse return null;
    if (door.leaf_slot >= mesh.slots.len) return null;
    const slot = mesh.slots[door.leaf_slot];
    if (slot.count == 0) return null;
    var lo = [3]f32{ std.math.floatMax(f32), std.math.floatMax(f32), std.math.floatMax(f32) };
    var hi = [3]f32{ -std.math.floatMax(f32), -std.math.floatMax(f32), -std.math.floatMax(f32) };
    var i: usize = slot.start;
    const end: usize = @min(slot.start + slot.count, mesh.vertex_count);
    while (i < end) : (i += 1) {
        const b = i * 8;
        if (b + 3 > mesh.vertices.len) break;
        var k: usize = 0;
        while (k < 3) : (k += 1) {
            const v = mesh.vertices[b + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
        }
    }
    if (lo[0] > hi[0]) return null;
    const lcx = (lo[0] + hi[0]) / 2;
    const lcz = (lo[2] + hi[2]) / 2;
    const hx = (hi[0] - lo[0]) / 2;
    const hz = (hi[2] - lo[2]) / 2;
    const rad = inst.yaw_degrees * std.math.pi / 180.0;
    const cc = @cos(rad);
    const ss = @sin(rad);
    // The hinge is the leaf's minimum-X local edge (a door leaf spans X, thin in Z),
    // at the panel's Z center — taken to WORLD via the instance transform. The
    // rotation MUST match the engine's m4rotateY (x'=x·c+z·s, z'=-x·s+z·c) or the
    // swing pivot won't cancel and the leaf slides across instead (req_1953).
    const hinge_lx = lo[0];
    return .{
        .open = door.start_open,
        .progress = if (door.start_open) 1.0 else 0.0,
        .cx = inst.x + (lcx * cc + lcz * ss),
        .cz = inst.z + (-lcx * ss + lcz * cc),
        .base_y = inst.y + lo[1],
        .panel_h = hi[1] - lo[1],
        .half_x = @abs(cc) * hx + @abs(ss) * hz,
        .half_z = @abs(ss) * hx + @abs(cc) * hz,
        .half_w_local = hx,
        .half_d_local = hz,
        .node_base_y = inst.y,
        .node_x = inst.x,
        .node_z = inst.z,
        .yaw_degrees = inst.yaw_degrees,
        .hinge_x = inst.x + (hinge_lx * cc + lcz * ss),
        .hinge_z = inst.z + (-hinge_lx * ss + lcz * cc),
        .reach = door.reach,
        .vehicle = door.vehicle,
    };
}

/// The vertex count of a mesh's SOLID body — everything before the door leaf
/// slot (req_1864), so meshPropIslands never colliders the toggleable leaf. The
/// full vertex_count for a non-door mesh.
fn solidVertexCount(mesh: constructor.MeshPropMesh) usize {
    if (mesh.door) |door| {
        if (door.leaf_slot < mesh.slots.len) return mesh.slots[door.leaf_slot].start;
    }
    return mesh.vertex_count;
}

fn clamp(v: f32, lo: f32, hi: f32) f32 {
    return @max(lo, @min(hi, v));
}

fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

fn lerpVec3(a: Vec3, b: Vec3, t: f32) Vec3 {
    return .{
        .x = lerp(a.x, b.x, t),
        .y = lerp(a.y, b.y, t),
        .z = lerp(a.z, b.z, t),
    };
}

fn rotateYLocal(local: [3]f32, yaw_degrees: f32) Vec3 {
    const rad = yaw_degrees * std.math.pi / 180.0;
    const c0 = @cos(rad);
    const s = @sin(rad);
    return .{
        .x = local[0] * c0 + local[2] * s,
        .y = local[1],
        .z = -local[0] * s + local[2] * c0,
    };
}

/// A pose along a baked traffic route (req_2056): world x,z + travel heading.
const RoutePose = struct { x: f32, z: f32, heading_deg: f32 };

/// Point + heading at arc-length `s` along a route polyline (x,z pairs). Heading
/// uses the motion convention (forward = [sin h, cos h] → h = atan2(dx, dz)), so
/// a +Z-forward vehicle prototype rotated by `heading_deg` faces travel.
fn sampleRoute(route: []const f32, s_in: f32) RoutePose {
    if (route.len < 4) {
        return .{ .x = if (route.len >= 2) route[0] else 0, .z = if (route.len >= 2) route[1] else 0, .heading_deg = 0 };
    }
    var s = s_in;
    var p: usize = 2;
    while (p + 1 < route.len) : (p += 2) {
        const ax = route[p - 2];
        const az = route[p - 1];
        const bx = route[p];
        const bz = route[p + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const seg = @sqrt(dx * dx + dz * dz);
        const last = p + 2 >= route.len;
        if (s <= seg or last) {
            const t = if (seg > 1.0e-5) @max(@as(f32, 0), @min(@as(f32, 1), s / seg)) else 0;
            return .{ .x = ax + dx * t, .z = az + dz * t, .heading_deg = std.math.atan2(dx, dz) * 180.0 / std.math.pi };
        }
        s -= seg;
    }
    return .{ .x = route[route.len - 2], .z = route[route.len - 1], .heading_deg = 0 };
}

fn nowNs() i64 {
    return @as(i64, @truncate(std.time.nanoTimestamp()));
}

fn keyDown(scancode: usize) bool {
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return false;
    return keys[scancode];
}

/// Read a game-file. Runtime artifacts are raw RJMP bytes; legacy round-trip
/// fixtures remain base64 text and are decoded only as a compatibility path.
fn loadGameFile(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    // 256MB read cap. Real editor bakes are a few MB; the headroom is for the
    // procedural scale lab (`rjit game play --massive --blocks N`), where the
    // instance buffer alone can run to hundreds of MB — we want the test to probe
    // the GPU/physics limit, not an artificial I/O wall.
    const raw = try std.fs.cwd().readFileAlloc(allocator, path, 256 << 20);
    if (raw.len >= 4 and std.mem.readInt(u32, raw[0..4], .little) == RJMP_MAGIC) return raw;
    defer allocator.free(raw);
    const trimmed = std.mem.trim(u8, raw, " \t\r\n");
    const dec = std.base64.standard.Decoder;
    const size = try dec.calcSizeForSlice(trimmed);
    const out = try allocator.alloc(u8, size);
    errdefer allocator.free(out);
    try dec.decode(out, trimmed);
    return out;
}

/// Map a tile value to a fill color. Empty cells are not drawn: a null cell, and
/// — by hmsc's string-table convention — tile index 0, the 'null' kind. Indices
/// 1.. are distinct map kinds. Used only for the tile-extrusion fallback when a
/// game-file carries no instance buffer (e.g. the codec round-trip fixture).
fn tileColor(value: ?u16) ?[3]f32 {
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
fn buildCube() [36 * 8]f32 {
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

/// GLOBALS req_2770: a stand-in blocky figure for worlds whose bake carries no
/// PLAYER_MODEL lump (the editor's blank paint-first world) — tuning physics in
/// the playtest tab needs a VISIBLE body, not a silent camera target. Proportions
/// follow the scale contract (R4): 1.65m collider, stylized-tall ~2m visual
/// head-top. Feet at local y=0 (the baked player-model convention); each part is
/// one unit-cube group scaled/offset via the group transform, no texture. The
/// visor is an asymmetric marker so turning is visible while testing.
fn fallbackPlayerModel(allocator: std.mem.Allocator) ![]constructor.PlayerModelGroup {
    const cube = buildCube();
    const Part = struct { pos: [3]f32, scale: [3]f32, color: [3]f32 };
    const parts = [_]Part{
        .{ .pos = .{ -0.11, 0.475, 0 }, .scale = .{ 0.17, 0.95, 0.20 }, .color = .{ 0.24, 0.32, 0.48 } }, // left leg
        .{ .pos = .{ 0.11, 0.475, 0 }, .scale = .{ 0.17, 0.95, 0.20 }, .color = .{ 0.24, 0.32, 0.48 } }, // right leg
        .{ .pos = .{ 0, 1.275, 0 }, .scale = .{ 0.46, 0.65, 0.26 }, .color = .{ 0.30, 0.42, 0.38 } }, // torso
        .{ .pos = .{ -0.325, 1.30, 0 }, .scale = .{ 0.13, 0.60, 0.18 }, .color = .{ 0.30, 0.42, 0.38 } }, // left arm
        .{ .pos = .{ 0.325, 1.30, 0 }, .scale = .{ 0.13, 0.60, 0.18 }, .color = .{ 0.30, 0.42, 0.38 } }, // right arm
        .{ .pos = .{ 0, 1.82, 0 }, .scale = .{ 0.30, 0.32, 0.28 }, .color = .{ 0.78, 0.62, 0.50 } }, // head
        .{ .pos = .{ 0, 1.86, 0.16 }, .scale = .{ 0.22, 0.06, 0.06 }, .color = .{ 0.15, 0.15, 0.18 } }, // visor
    };
    var groups = try allocator.alloc(constructor.PlayerModelGroup, parts.len);
    var initialized: usize = 0;
    errdefer {
        for (groups[0..initialized]) |group| group.deinit(allocator);
        allocator.free(groups);
    }
    for (parts, 0..) |part, i| {
        const verts = try allocator.alloc(f32, cube.len);
        @memcpy(verts, cube[0..]);
        groups[i] = .{
            .color = part.color,
            .alpha = 1,
            .vertices = verts,
            .vertex_count = 36,
            .tex_w = 0,
            .tex_h = 0,
            .tex_rgba = null,
            .position = part.pos,
            .rotation = .{ 0, 0, 0 },
            .scale = part.scale,
        };
        initialized += 1;
    }
    return groups;
}

// ── the live-pushed player model (req_2780) ─────────────────────────────────
// The editor's EXPORTED player-role character (manifest placeable
// {as:'character', role:'player'}) replaces the stand-in figure in worlds whose
// gamefile carries no player lump (the blank editor/playtest world). The cart
// stages it through __compiled_world_set_player_model BEFORE the loader node
// constructs (the door is process-global, consumed at construct); pending
// survives remounts so every playtest session wears the last-pushed body until
// a new push or a clear. The gamefile lump, when present, still wins — this is
// the pre-Compile live lane, not a second bake truth.
var g_pending_player_model: []constructor.PlayerModelGroup = &.{};

/// Decode + store the pushed player model. `table_bytes` is a Float32Array of
/// 8-float rows [vertStart, vertCount, cx, cy, cz, r, g, b]; `verts_bytes` is
/// the concatenated stride-8 vertex pool the rows slice (vertices are LOCAL to
/// each group's center so future clips can pose the parts). Empty table clears.
pub fn setPendingPlayerModel(verts_bytes: []const u8, table_bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    for (g_pending_player_model) |group| group.deinit(alloc);
    if (g_pending_player_model.len > 0) alloc.free(g_pending_player_model);
    g_pending_player_model = &.{};

    const vert_floats = verts_bytes.len / 4;
    const rows = table_bytes.len / (8 * 4);
    if (rows == 0 or vert_floats == 0) return;
    const table = alloc.alloc(f32, rows * 8) catch return;
    defer alloc.free(table);
    @memcpy(std.mem.sliceAsBytes(table), table_bytes[0 .. rows * 8 * 4]);

    var groups = std.ArrayListUnmanaged(constructor.PlayerModelGroup){};
    var r: usize = 0;
    while (r < rows) : (r += 1) {
        const row = table[r * 8 ..][0..8];
        const start: usize = @intFromFloat(@max(0.0, row[0]));
        const count: usize = @intFromFloat(@max(0.0, row[1]));
        if (count == 0) continue;
        const lo = start * 8 * 4;
        const hi = (start + count) * 8 * 4;
        if (hi > verts_bytes.len or lo >= hi) continue;
        const verts = alloc.alloc(f32, count * 8) catch continue;
        @memcpy(std.mem.sliceAsBytes(verts), verts_bytes[lo..hi]);
        groups.append(alloc, .{
            .color = .{ row[5], row[6], row[7] },
            .alpha = 1,
            .vertices = verts,
            .vertex_count = @intCast(count),
            .tex_w = 0,
            .tex_h = 0,
            .tex_rgba = null,
            .position = .{ row[2], row[3], row[4] },
            .rotation = .{ 0, 0, 0 },
            .scale = .{ 1, 1, 1 },
        }) catch {
            alloc.free(verts);
            continue;
        };
    }
    g_pending_player_model = groups.toOwnedSlice(alloc) catch &.{};
    log.print("[loader] player model staged — {d} groups (req_2780)\n", .{g_pending_player_model.len});
}

/// Figure geometry intern keys must name CONTENT, not a slot (req_2790): the
/// geometry intern cache never evicts, so a stable "player-model-{i}" key wears
/// whatever the FIRST construct interned under it forever — the stand-in
/// figure's cubes survived into the exported body's first seven parts (a boxy
/// torso over correct feet). Hashing the verts into the key makes a
/// stand-in→export swap or a re-export intern fresh, while an unchanged body
/// still cache-hits.
fn geomContentHash(verts: []const f32) u64 {
    return std.hash.Wyhash.hash(0, std.mem.sliceAsBytes(verts));
}

/// Deep-copy the staged player model for a constructing scene (the scene owns
/// its copy — Scene.deinit frees it exactly like a decoded lump). Null when
/// nothing is staged.
fn pendingPlayerModelCopy(allocator: std.mem.Allocator) ?[]constructor.PlayerModelGroup {
    if (g_pending_player_model.len == 0) return null;
    const groups = allocator.alloc(constructor.PlayerModelGroup, g_pending_player_model.len) catch return null;
    var initialized: usize = 0;
    for (g_pending_player_model, 0..) |src, i| {
        const verts = allocator.alloc(f32, src.vertices.len) catch {
            for (groups[0..initialized]) |g2| g2.deinit(allocator);
            allocator.free(groups);
            return null;
        };
        @memcpy(verts, src.vertices);
        groups[i] = .{
            .color = src.color,
            .alpha = src.alpha,
            .vertices = verts,
            .vertex_count = src.vertex_count,
            .tex_w = 0,
            .tex_h = 0,
            .tex_rgba = null,
            .position = src.position,
            .rotation = src.rotation,
            .scale = src.scale,
        };
        initialized += 1;
    }
    return groups;
}

// ── the live-pushed player ANIMATION (req_2781) ──────────────────────────────
// The basic animation shapes (idle/walk/jump/sit/lay) generated by the editor
// for the pushed body's exact node order — staged beside the model, consumed
// at construct when the gamefile carries no animation. Payload layout (f32):
// [nodeCount, clipCount, per clip: id, duration, looping, keyCount,
//  per key: time, per node: px,py,pz, rx,ry,rz, sx,sy,sz].
var g_pending_player_animation: ?constructor.PlayerAnimationSet = null;

pub fn setPendingPlayerAnimation(bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    if (g_pending_player_animation) |set| set.deinit(alloc);
    g_pending_player_animation = null;

    const float_count = bytes.len / 4;
    if (float_count < 2) return;
    const data = alloc.alloc(f32, float_count) catch return;
    defer alloc.free(data);
    @memcpy(std.mem.sliceAsBytes(data), bytes[0 .. float_count * 4]);

    const node_count: usize = @intFromFloat(@max(0.0, data[0]));
    const clip_count: usize = @intFromFloat(@max(0.0, data[1]));
    if (node_count == 0 or clip_count == 0) return;

    var clips = std.ArrayListUnmanaged(constructor.PlayerAnimationClip){};
    var at: usize = 2;
    var ci: usize = 0;
    decode: while (ci < clip_count) : (ci += 1) {
        if (at + 4 > data.len) break;
        const id: u32 = @intFromFloat(@max(0.0, data[at]));
        const duration = data[at + 1];
        const looping = data[at + 2] != 0;
        const key_count: usize = @intFromFloat(@max(0.0, data[at + 3]));
        at += 4;
        var keys = std.ArrayListUnmanaged(constructor.PlayerAnimationKeyframe){};
        var ki: usize = 0;
        while (ki < key_count) : (ki += 1) {
            if (at + 1 + node_count * 9 > data.len) {
                for (keys.items) |k| k.deinit(alloc);
                keys.deinit(alloc);
                break :decode;
            }
            const time = data[at];
            at += 1;
            const transforms = alloc.alloc(constructor.PlayerTransform, node_count) catch {
                for (keys.items) |k| k.deinit(alloc);
                keys.deinit(alloc);
                break :decode;
            };
            var ni: usize = 0;
            while (ni < node_count) : (ni += 1) {
                const t = data[at .. at + 9];
                transforms[ni] = .{
                    .position = .{ t[0], t[1], t[2] },
                    .rotation = .{ t[3], t[4], t[5] },
                    .scale = .{ t[6], t[7], t[8] },
                };
                at += 9;
            }
            keys.append(alloc, .{ .time = time, .transforms = transforms }) catch {
                alloc.free(transforms);
                for (keys.items) |k| k.deinit(alloc);
                keys.deinit(alloc);
                break :decode;
            };
        }
        const owned_keys = keys.toOwnedSlice(alloc) catch break :decode;
        clips.append(alloc, .{ .id = id, .duration = duration, .looping = looping, .keyframes = owned_keys }) catch {
            for (owned_keys) |k| k.deinit(alloc);
            alloc.free(owned_keys);
            break :decode;
        };
    }
    const owned = clips.toOwnedSlice(alloc) catch return;
    if (owned.len == 0) {
        alloc.free(owned);
        return;
    }
    g_pending_player_animation = .{
        .node_count = @intCast(node_count),
        .content_hash = [_]u8{0} ** 32,
        .clips = owned,
    };
    log.print("[loader] player animation staged — {d} clips × {d} nodes (req_2781)\n", .{ owned.len, node_count });
}

/// Deep-copy the staged animation for a constructing scene (scene owns its
/// copy). Null when nothing staged or the node count doesn't match the model.
fn pendingPlayerAnimationCopy(allocator: std.mem.Allocator, model_len: usize) ?constructor.PlayerAnimationSet {
    const src = g_pending_player_animation orelse return null;
    if (src.node_count != model_len) {
        log.print("[loader] staged animation skipped — {d} nodes vs {d} model groups\n", .{ src.node_count, model_len });
        return null;
    }
    const clips = allocator.alloc(constructor.PlayerAnimationClip, src.clips.len) catch return null;
    var ci: usize = 0;
    while (ci < src.clips.len) : (ci += 1) {
        const sclip = src.clips[ci];
        const keys = allocator.alloc(constructor.PlayerAnimationKeyframe, sclip.keyframes.len) catch {
            for (clips[0..ci]) |done_clip| done_clip.deinit(allocator);
            allocator.free(clips);
            return null;
        };
        var ki: usize = 0;
        while (ki < sclip.keyframes.len) : (ki += 1) {
            const transforms = allocator.alloc(constructor.PlayerTransform, sclip.keyframes[ki].transforms.len) catch {
                for (keys[0..ki]) |done_key| done_key.deinit(allocator);
                allocator.free(keys);
                for (clips[0..ci]) |done_clip| done_clip.deinit(allocator);
                allocator.free(clips);
                return null;
            };
            @memcpy(transforms, sclip.keyframes[ki].transforms);
            keys[ki] = .{ .time = sclip.keyframes[ki].time, .transforms = transforms };
        }
        clips[ci] = .{ .id = sclip.id, .duration = sclip.duration, .looping = sclip.looping, .keyframes = keys };
    }
    return .{ .node_count = src.node_count, .content_hash = [_]u8{0} ** 32, .clips = clips };
}

/// RJIT_FORCE_GAIT=1 forces the walk gait with no input — headless animation
/// repro (req_2781). Read once, cached (same idiom as streamModeFromEnv).
var g_force_gait: ?bool = null;
fn forceGaitEnv() bool {
    if (g_force_gait) |v| return v;
    const s = std.posix.getenv("RJIT_FORCE_GAIT");
    const v = s != null and s.?.len > 0 and s.?[0] == '1';
    g_force_gait = v;
    return v;
}

// ── the LIVE player pose (req_2786 — webcam capture drives the body) ────────
// The capture surface pushes per-node transforms every solve tick
// (__compiled_world_set_player_live_pose); while fresh they OVERRIDE the clip
// sampler entirely — the figure mirrors the camera. Node-scoped (the iso
// viewport's loader must never wear the capture pose) with the same slot
// discipline as the physics override. A stale pose (no push for ~3/4s)
// falls back to clips, so a dropped tracker never freezes the body.
const LIVE_POSE_STALE_FRAMES: u32 = 45;

const PendingPose = struct {
    node_id: u32 = 0,
    set: bool = false,
    transforms: []f32 = &.{}, // n × 9 floats (px,py,pz, rx,ry,rz, sx,sy,sz), page_allocator
    count: usize = 0,
    age_frames: u32 = 0,
};
var g_pending_pose: [4]PendingPose = .{ .{}, .{}, .{}, .{} };

fn pendingPoseFor(node_id: u32) ?*PendingPose {
    if (node_id == 0) return null;
    for (&g_pending_pose) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

pub fn setPlayerLivePose(node_id: u32, bytes: []const u8) void {
    if (node_id == 0) return;
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingPose = pendingPoseFor(node_id);
    if (slot == null) {
        for (&g_pending_pose) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const float_count = bytes.len / 4;
    if (float_count == 0 or float_count % 9 != 0) {
        clearPlayerLivePose(node_id);
        return;
    }
    if (p.transforms.len != float_count) {
        if (p.transforms.len > 0) alloc.free(p.transforms);
        p.transforms = alloc.alloc(f32, float_count) catch {
            p.transforms = &.{};
            p.set = false;
            return;
        };
    }
    @memcpy(std.mem.sliceAsBytes(p.transforms), bytes[0 .. float_count * 4]);
    p.node_id = node_id;
    p.set = true;
    p.count = float_count / 9;
    p.age_frames = 0;
}

pub fn clearPlayerLivePose(node_id: u32) void {
    const p = pendingPoseFor(node_id) orelse return;
    if (p.transforms.len > 0) std.heap.page_allocator.free(p.transforms);
    p.transforms = &.{};
    p.count = 0;
    p.set = false;
    p.node_id = 0;
}

fn buildCubeOpenRun(comptime open_min: bool, comptime open_max: bool) [(36 - (if (open_min) 6 else 0) - (if (open_max) 6 else 0)) * 8]f32 {
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
fn buildRampSlab() [36 * 8]f32 {
    const hx: f32 = 0.5;
    const hz: f32 = 0.5;
    const rise0: f32 = -0.5;
    const rise1: f32 = 0.5;
    const t: f32 = RAMP_SLAB_THICKNESS_RATIO;
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
fn buildGablePrism() [24 * 8]f32 {
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
fn buildCornerMiterPrism() [12 * 8]f32 {
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
fn buildCornerMiterMirrorPrism() [12 * 8]f32 {
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
fn buildGrassBlade() [36 * 8]f32 {
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
fn buildFlowerHead() [36 * 8]f32 {
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
fn buildBushClump() [60 * 8]f32 {
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
fn buildFrond() [144 * 8]f32 {
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
fn buildPalmTrunk() [1680 * 8]f32 {
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

fn buildUnitSphere(comptime segments: usize, comptime rings: usize) [segments * rings * 6 * 8]f32 {
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

fn buildUnitCylinder(comptime segments: usize) [segments * 12 * 8]f32 {
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

fn buildBrushDecal(comptime segments: usize) [segments * 3 * 8]f32 {
    var out: [segments * 3 * 8]f32 = undefined;
    var idx: usize = 0;
    pushFlatDisc(segments, out[0..], &idx, 0.5, 0);
    return out;
}

fn buildBrushRings(comptime segments: usize) [(segments * 3 * 6 + 12) * 8]f32 {
    var out: [(segments * 3 * 6 + 12) * 8]f32 = undefined;
    var idx: usize = 0;
    pushFlatRingBand(segments, out[0..], &idx, 0.485, 0.5, 0);
    pushFlatRingBand(segments, out[0..], &idx, 0.32, 0.335, 0);
    pushFlatRingBand(segments, out[0..], &idx, 0.14, 0.155, 0);
    pushFlatQuad(out[0..], &idx, -0.5, -0.01, 0.5, 0.01, 0);
    pushFlatQuad(out[0..], &idx, -0.01, -0.5, 0.01, 0.5, 0);
    return out;
}

fn buildBrushHandles(comptime segments: usize) [(segments * 2 * 6 + segments * 3 + 4 * 6) * 8]f32 {
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

fn buildBrushCone(comptime segments: usize) [segments * 3 * 8]f32 {
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

fn buildBrushDome(comptime segments: usize, comptime rings: usize) [segments * rings * 6 * 8]f32 {
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

/// Fallback geometry for a game-file with no instance buffer: extrude each
/// non-null tile into one box instance (stride 9: pos3/scale3/color3). Heap-
/// owned; the caller frees it after the frame loop.
fn extrudeTiles(allocator: std.mem.Allocator, scene: constructor.Scene) ![]f32 {
    var list: std.ArrayList(f32) = .{};
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

const ShapeBatches = struct {
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
const MaterialBatch = struct {
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
fn appendInstanceRow(list: *std.ArrayList(f32), allocator: std.mem.Allocator, src: []const f32, is_wall: bool, stride: usize) !void {
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
fn buildShapeBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, material_refs: []const u32, wall_flags: []const u8, flora: ?constructor.FloraCells) !ShapeBatches {
    var boxes: std.ArrayList(f32) = .{};
    errdefer boxes.deinit(allocator);
    var boxes_open_run_min: std.ArrayList(f32) = .{};
    errdefer boxes_open_run_min.deinit(allocator);
    var boxes_open_run_max: std.ArrayList(f32) = .{};
    errdefer boxes_open_run_max.deinit(allocator);
    var boxes_open_run_both: std.ArrayList(f32) = .{};
    errdefer boxes_open_run_both.deinit(allocator);
    var ramps: std.ArrayList(f32) = .{};
    errdefer ramps.deinit(allocator);
    var cylinder8s: std.ArrayList(f32) = .{};
    errdefer cylinder8s.deinit(allocator);
    var cylinder16s: std.ArrayList(f32) = .{};
    errdefer cylinder16s.deinit(allocator);
    var spheres: std.ArrayList(f32) = .{};
    errdefer spheres.deinit(allocator);
    var gables: std.ArrayList(f32) = .{};
    errdefer gables.deinit(allocator);
    var corner_miters: std.ArrayList(f32) = .{};
    errdefer corner_miters.deinit(allocator);
    var corner_miter_mirrors: std.ArrayList(f32) = .{};
    errdefer corner_miter_mirrors.deinit(allocator);
    var grass: std.ArrayList(f32) = .{};
    errdefer grass.deinit(allocator);
    var flowers: std.ArrayList(f32) = .{};
    errdefer flowers.deinit(allocator);
    var bush: std.ArrayList(f32) = .{};
    errdefer bush.deinit(allocator);
    var frond: std.ArrayList(f32) = .{};
    errdefer frond.deinit(allocator);
    var palmtrunks: std.ArrayList(f32) = .{};
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
fn whitenRows(rows: []f32, stride: usize) void {
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
const MATERIAL_SHAPE_SLOTS: usize = 8;

fn buildMaterialBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, materials: []const constructor.Material, material_refs: []const u32, wall_flags: []const u8) ![]MaterialBatch {
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

const Bounds = struct {
    cx: f32,
    cy: f32,
    cz: f32,
    radius: f32, // half the largest world extent (xz), min-clamped
};

/// Axis-aligned bounds of an instance batch (each row: pos3/scale3/color3),
/// used to auto-frame the camera so the whole world fits in view.
fn instanceBounds(insts: []const f32, count: u32, stride: usize) Bounds {
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

fn instanceTop(insts: []const f32, row: usize, stride: usize) f32 {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return insts[b + 1] + @abs(insts[b + scale_base + 1]) * 0.5;
}

fn instanceCovers(insts: []const f32, row: usize, stride: usize, x: f32, z: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    const hx = @abs(insts[b + scale_base + 0]) * 0.5;
    const hz = @abs(insts[b + scale_base + 2]) * 0.5;
    return x >= insts[b + 0] - hx and x <= insts[b + 0] + hx and
        z >= insts[b + 2] - hz and z <= insts[b + 2] + hz;
}

fn instanceYawRadians(insts: []const f32, row: usize, stride: usize) f32 {
    if (stride < 12) return 0;
    return insts[row * stride + 4] * std.math.pi / 180.0;
}

fn instanceShapeId(insts: []const f32, row: usize, stride: usize) f32 {
    if (stride < 13) return SHAPE_BOX;
    return insts[row * stride + 12];
}

fn isRampInstance(insts: []const f32, row: usize, stride: usize) bool {
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
fn isNonCollidingFoliage(insts: []const f32, row: usize, stride: usize) bool {
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

const GeomPick = struct { key: []const u8, verts: []const f32, vert_count: u32 };

/// The keyed geometry (verts + count) for an instance SHAPE id — the ONE place
/// shape→geometry is resolved for the material draws (req_0939). Grass/bush and
/// any unknown shape fall back to the box; foliage is never material-skinned.
fn geomForShape(rt: *const Runtime, shape: f32) GeomPick {
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
fn rectFloats(insts: []const f32, row: usize, stride: usize, solid: bool) [game_physics.RECT_FLOATS]f32 {
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
fn orientedFloats(insts: []const f32, row: usize, stride: usize, solid: bool) [game_physics.ORIENTED_FLOATS]f32 {
    const r = rectFloats(insts, row, stride, solid);
    return .{
        r[0],                    r[1],                    r[2],                                   r[3], r[4], r[5], r[6], r[7], r[8],
        insts[row * stride + 0], insts[row * stride + 2], instanceYawRadians(insts, row, stride),
    };
}

// A connected-vertex ISLAND of a cooked/imported mesh prop, boxed in the mesh's own
// local frame (anchor-centered XZ, ground-based Y — the SAME frame the render node
// is placed in). One island per disjoint piece, so a sign's two posts + overhead
// board collide as three banded boxes you walk under, not one full-bounds wall.
const MeshIsland = struct { lo: [3]f32, hi: [3]f32 };
const MAX_MESH_ISLANDS: usize = 24;

fn ufFind(parent: []u32, a0: u32) u32 {
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
fn meshFullBoundsIsland(mesh: constructor.MeshPropMesh) MeshIsland {
    return .{
        .lo = .{ -mesh.footprint_width / 2.0, 0, -mesh.footprint_depth / 2.0 },
        .hi = .{ mesh.footprint_width / 2.0, mesh.height, mesh.footprint_depth / 2.0 },
    };
}

/// The whole mesh as ONE box from its ACTUAL vertex bounds (req_2836: the centered
/// footprint box overhangs an off-center mesh — an invisible wall on one side,
/// pass-through on the other). Falls back to the centered form when no solid
/// vertices exist to scan.
fn meshVertexBoundsIsland(mesh: constructor.MeshPropMesh) MeshIsland {
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
fn islandOrientedFloats(inst: constructor.MeshPropInstance, isl: MeshIsland) [game_physics.ORIENTED_FLOATS]f32 {
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
fn meshPropIslands(allocator: std.mem.Allocator, mesh: constructor.MeshPropMesh) ![]MeshIsland {
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

fn appendPhysicsRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    try list.appendSlice(allocator, &rectFloats(insts, row, stride, solid));
}

fn appendPhysicsOrientedRect(allocator: std.mem.Allocator, list: *std.ArrayList(f32), insts: []const f32, row: usize, stride: usize, solid: bool) !void {
    try list.appendSlice(allocator, &orientedFloats(insts, row, stride, solid));
}

fn registerRampHeightfield(insts: []const f32, row: usize, stride: usize, slot: usize) bool {
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

fn registerSceneHeightfield(field: constructor.HeightfieldMesh, slot: usize) bool {
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
fn registerColliderField(field: constructor.ColliderField, slot: usize) bool {
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

fn maxAbsHeight(heights: []const f32) f32 {
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
fn heightfieldContentHash(field: constructor.HeightfieldMesh) u64 {
    var h = std.hash.Wyhash.init(0);
    h.update(std.mem.asBytes(&field.cols));
    h.update(std.mem.asBytes(&field.rows));
    h.update(std.mem.sliceAsBytes(field.heights));
    return h.final();
}

fn buildPhysicsColliders(allocator: std.mem.Allocator, scene: constructor.Scene, insts: []const f32, inst_count: u32, stride: usize, entity_capacity: usize, mesh_islands: []const []MeshIsland) !PhysicsColliders {
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
const COLLIDER_CELL_METERS: f32 = 64.0;
const COLLIDER_WINDOW_CELLS: i32 = 3; // gather ±3 cells around the player (7×7 ≈ 448m)

fn clampCell(v: i32, n: i32) i32 {
    return @max(0, @min(n - 1, v));
}

const SpatialGrid = struct {
    cell: f32,
    min_x: f32,
    min_z: f32,
    cols: i32,
    rows: i32,
    starts: []u32, // CSR offsets, len cols*rows+1
    items: []u32, // local row indices, bucketed by cell
    always: []u32, // world-spanning rows, included in every rebuild

    fn deinit(self: SpatialGrid, allocator: std.mem.Allocator) void {
        allocator.free(self.starts);
        allocator.free(self.items);
        allocator.free(self.always);
    }

    fn cellXZ(self: SpatialGrid, x: f32, z: f32) struct { cx: i32, cz: i32 } {
        const cx = clampCell(@as(i32, @intFromFloat(@floor((x - self.min_x) / self.cell))), self.cols);
        const cz = clampCell(@as(i32, @intFromFloat(@floor((z - self.min_z) / self.cell))), self.rows);
        return .{ .cx = cx, .cz = cz };
    }
};

fn instIsSpanning(insts: []const f32, row: usize, stride: usize, cell: f32) bool {
    const scale_base: usize = if (stride >= 12) 6 else 3;
    const b = row * stride;
    return @abs(insts[b + scale_base + 0]) > cell or @abs(insts[b + scale_base + 2]) > cell;
}

fn gridCellIndex(insts: []const f32, row: usize, stride: usize, min_x: f32, min_z: f32, cell: f32, cols: i32, rows: i32) usize {
    const b = row * stride;
    const cx = clampCell(@as(i32, @intFromFloat(@floor((insts[b + 0] - min_x) / cell))), cols);
    const cz = clampCell(@as(i32, @intFromFloat(@floor((insts[b + 2] - min_z) / cell))), rows);
    return @intCast(cz * cols + cx);
}

/// Bucket every instance into a uniform grid (local rows) + an always list
/// (world-spanning rows). One O(n) classify/count pass, a prefix sum, one scatter.
fn buildSpatialGrid(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize) !SpatialGrid {
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

fn runPlayerPhysics(player: *PlayerState, colliders: *PhysicsColliders, dt: f32, intent: game_physics.movement.Direction, speed: f32, jump_down: bool, cfg: ?constructor.PhysicsConfig, bodies: []PropBody) void {
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
fn sceneTerrainTopAt(fields: []const constructor.HeightfieldMesh, x: f32, z: f32) ?f32 {
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

fn chooseSpawn(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, bounds: Bounds) Vec3 {
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

fn groundHeightAt(insts: []const f32, inst_count: u32, piece_count: u32, stride: usize, x: f32, z: f32) ?f32 {
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

fn orbitEye(target: Vec3, yaw_degrees: f32, pitch_degrees: f32, distance: f32) Vec3 {
    const yaw = yaw_degrees * std.math.pi / 180.0;
    const elev = pitch_degrees * std.math.pi / 180.0;
    const horiz = distance * @cos(elev);
    const height = distance * @sin(elev);
    return .{
        .x = target.x - @sin(yaw) * horiz,
        .y = target.y + height,
        .z = target.z - @cos(yaw) * horiz,
    };
}

const CameraSolve = struct {
    pos: Vec3,
    target: Vec3,
    fov: f32,
    /// The player-side anchor the eye sits back from — the spring-arm casts
    /// pivot→pos against the walls and pulls the eye in to the wall's near side.
    pivot: Vec3,
};

const PitchLimits = struct {
    min: f32,
    max: f32,
};

fn solveAimCamera(player: PlayerState, yaw_degrees: f32, orbit_pitch_degrees: f32) CameraSolve {
    const yaw = yaw_degrees * std.math.pi / 180.0;
    const pitch = clamp(-orbit_pitch_degrees, AIM_MIN_PITCH_DEGREES, AIM_MAX_PITCH_DEGREES) * std.math.pi / 180.0;
    const cp = @cos(pitch);
    const fwd = Vec3{
        .x = @sin(yaw) * cp,
        .y = @sin(pitch),
        .z = @cos(yaw) * cp,
    };
    const pivot = Vec3{
        .x = player.x - @cos(yaw) * AIM_SHOULDER_SHIFT_METERS,
        .y = player.y + AIM_PIVOT_HEIGHT_METERS - 0 * AIM_CROUCH_DROP_METERS,
        .z = player.z + @sin(yaw) * AIM_SHOULDER_SHIFT_METERS,
    };
    return .{
        .pos = .{
            .x = pivot.x - fwd.x * AIM_DISTANCE_METERS,
            .y = pivot.y - fwd.y * AIM_DISTANCE_METERS,
            .z = pivot.z - fwd.z * AIM_DISTANCE_METERS,
        },
        .target = .{
            .x = pivot.x + fwd.x * AIM_LOOK_AHEAD_METERS,
            .y = pivot.y + fwd.y * AIM_LOOK_AHEAD_METERS,
            .z = pivot.z + fwd.z * AIM_LOOK_AHEAD_METERS,
        },
        .fov = AIM_FOV_DEGREES,
        .pivot = pivot,
    };
}

fn desiredCamera(cam: CameraState, player: PlayerState) CameraSolve {
    // External-camera (editor iso view): the JS-solved eye + look verbatim, no player
    // trailing, no aim mode.
    if (cam.external) {
        return .{
            .pos = cam.ext_pos,
            .target = cam.ext_look,
            .fov = cam.ext_fov,
            .pivot = cam.ext_look,
        };
    }
    if (cam.aiming) return solveAimCamera(player, cam.yaw_degrees, cam.pitch_degrees);
    const target = Vec3{ .x = player.x, .y = player.y + CAMERA_TARGET_HEIGHT_METERS, .z = player.z };
    return .{
        .pos = orbitEye(target, cam.yaw_degrees, cam.pitch_degrees, CAMERA_DISTANCE_METERS),
        .target = target,
        .fov = CAMERA_FOV_DEGREES,
        .pivot = target,
    };
}

/// Pull the desired eye in to the near side of any wall/roof between it and the
/// pivot (the compiled-game spring-arm — parity with the editor's JS one).
fn springArmEye(want: CameraSolve, maybe_colliders: ?PhysicsColliders) Vec3 {
    const dxp = want.pos.x - want.pivot.x;
    const dyp = want.pos.y - want.pivot.y;
    const dzp = want.pos.z - want.pivot.z;
    const base = @sqrt(dxp * dxp + dyp * dyp + dzp * dzp);
    if (base <= 0.0001) return want.pos;
    // The eye must clear BOTH the wall/roof boxes AND the terrain/ramp
    // heightfields (a separate collider type) — take the most restrictive cap.
    var cap: f32 = -1;
    if (maybe_colliders) |colliders| {
        if (colliders.rect_count != 0 or colliders.oriented_count != 0) {
            // cameraOcclusionStepColliders assumes rects at INPUT_HEADER_FLOATS
            // (no entity section) — skip past the body slots when present.
            const wall = game_physics.cameraOcclusionStepColliders(
                colliders.values[colliders.entity_capacity * game_physics.ENTITY_FLOATS ..],
                colliders.rect_count,
                colliders.oriented_count,
                want.pos.x,
                want.pos.y,
                want.pos.z,
                want.pivot.x,
                want.pivot.y,
                want.pivot.z,
                CAMERA_SPRING_SWEEP_RADIUS_METERS,
            );
            if (wall > 0) cap = wall;
        }
    }
    const terrain = game_physics.cameraOcclusionHeightfields(
        want.pos.x,
        want.pos.y,
        want.pos.z,
        want.pivot.x,
        want.pivot.y,
        want.pivot.z,
        CAMERA_SPRING_SWEEP_RADIUS_METERS,
    );
    if (terrain > 0 and (cap < 0 or terrain < cap)) cap = terrain;
    if (cap < 0) return want.pos;
    const safe = clamp(cap - CAMERA_SPRING_SKIN_METERS, CAMERA_SPRING_MIN_DISTANCE_METERS, base);
    const k = safe / base;
    return .{
        .x = want.pivot.x + dxp * k,
        .y = want.pivot.y + dyp * k,
        .z = want.pivot.z + dzp * k,
    };
}

fn updateCameraNode(camera_node: *Node, cam: *CameraState, player: PlayerState, colliders: ?PhysicsColliders, dt: f32) void {
    var want = desiredCamera(cam.*, player);
    // External-orbit (editor iso view): no spring-arm (the iso eye must stay at its
    // full authoring distance, never pulled in through a roof) and no smoothing (it
    // tracks the user's orbit/zoom drag frame-exact).
    if (cam.external) {
        cam.current_pos = want.pos;
        cam.current_target = want.target;
        cam.current_fov = want.fov;
        cam.initialized = true;
        camera_node.scene3d_pos_x = cam.current_pos.x;
        camera_node.scene3d_pos_y = cam.current_pos.y;
        camera_node.scene3d_pos_z = cam.current_pos.z;
        camera_node.scene3d_look_x = cam.current_target.x;
        camera_node.scene3d_look_y = cam.current_target.y;
        camera_node.scene3d_look_z = cam.current_target.z;
        camera_node.scene3d_fov = cam.current_fov;
        camera_node.scene3d_far = cam.far;
        return;
    }
    want.pos = springArmEye(want, colliders);
    if (!cam.initialized or dt <= 0 or CAMERA_SMOOTHING_PER_SECOND <= 0) {
        cam.current_pos = want.pos;
        cam.current_target = want.target;
        cam.current_fov = want.fov;
        cam.initialized = true;
    } else {
        const t = clamp(1.0 - @exp(-CAMERA_SMOOTHING_PER_SECOND * dt), 0, 1);
        cam.current_pos = lerpVec3(cam.current_pos, want.pos, t);
        cam.current_target = lerpVec3(cam.current_target, want.target, t);
        cam.current_fov = lerp(cam.current_fov, want.fov, t);
    }
    camera_node.scene3d_pos_x = cam.current_pos.x;
    camera_node.scene3d_pos_y = cam.current_pos.y;
    camera_node.scene3d_pos_z = cam.current_pos.z;
    camera_node.scene3d_look_x = cam.current_target.x;
    camera_node.scene3d_look_y = cam.current_target.y;
    camera_node.scene3d_look_z = cam.current_target.z;
    camera_node.scene3d_fov = cam.current_fov;
    camera_node.scene3d_far = cam.far;
}

fn aimPitchLimitsInOrbitSpace() PitchLimits {
    return .{ .min = -AIM_MAX_PITCH_DEGREES, .max = -AIM_MIN_PITCH_DEGREES };
}

fn setAimMode(cam: *CameraState, aiming: bool) void {
    if (cam.aiming == aiming) return;
    cam.aiming = aiming;
    if (!aiming) {
        cam.pitch_degrees = clamp(cam.pitch_degrees, CAMERA_MIN_PITCH_DEGREES, CAMERA_MAX_PITCH_DEGREES);
    }
}

fn findPlayerClip(animation: constructor.PlayerAnimationSet, clip_id: u32) ?constructor.PlayerAnimationClip {
    for (animation.clips) |clip| {
        if (clip.id == clip_id) return clip;
    }
    return null;
}

fn sampleClipTransform(clip: constructor.PlayerAnimationClip, node_index: usize, t_raw: f32) ?constructor.PlayerTransform {
    if (clip.keyframes.len == 0) return null;
    if (node_index >= clip.keyframes[0].transforms.len) return null;
    const duration = if (clip.duration > 0) clip.duration else 1.0;
    var t = t_raw;
    if (clip.looping) {
        t = @mod(t, duration);
        if (t < 0) t += duration;
    } else {
        t = clamp(t, 0, duration);
    }
    if (clip.keyframes.len == 1) return clip.keyframes[0].transforms[node_index];

    var prev = clip.keyframes[0];
    var next = clip.keyframes[clip.keyframes.len - 1];
    var i: usize = 1;
    while (i < clip.keyframes.len) : (i += 1) {
        if (t <= clip.keyframes[i].time) {
            next = clip.keyframes[i];
            break;
        }
        prev = clip.keyframes[i];
    }
    const span = @max(@as(f32, 0.000001), next.time - prev.time);
    const k = clamp((t - prev.time) / span, 0, 1);
    const a = prev.transforms[node_index];
    const b = next.transforms[node_index];
    return .{
        .position = .{ lerp(a.position[0], b.position[0], k), lerp(a.position[1], b.position[1], k), lerp(a.position[2], b.position[2], k) },
        .rotation = .{ lerp(a.rotation[0], b.rotation[0], k), lerp(a.rotation[1], b.rotation[1], k), lerp(a.rotation[2], b.rotation[2], k) },
        .scale = .{ lerp(a.scale[0], b.scale[0], k), lerp(a.scale[1], b.scale[1], k), lerp(a.scale[2], b.scale[2], k) },
    };
}

fn updatePlayerModelNodes(kids: []Node, first: usize, groups: []const constructor.PlayerModelGroup, animation: constructor.PlayerAnimationSet, player: PlayerState, moving: bool, running: bool, airborne: bool) void {
    const model_yaw_degrees = player.yaw * 180.0 / std.math.pi + 180.0;
    const clip_id: u32 = switch (player.posture) {
        .sit => PLAYER_CLIP_SIT,
        .lay => PLAYER_CLIP_LAY,
        .none => if (airborne) PLAYER_CLIP_JUMP else if (moving or running) PLAYER_CLIP_WALK else PLAYER_CLIP_IDLE,
    };
    const clip_time: f32 = if (clip_id == PLAYER_CLIP_WALK) player.gait_phase else if (clip_id == PLAYER_CLIP_JUMP) player.jump_time else 0;
    const clip = if (animation.node_count == groups.len) findPlayerClip(animation, clip_id) else null;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const base = groups[i];
        const base_transform = constructor.PlayerTransform{
            .position = base.position,
            .rotation = base.rotation,
            .scale = base.scale,
        };
        const t = if (clip) |cclip| sampleClipTransform(cclip, i, clip_time) orelse base_transform else base_transform;
        const local = rotateYLocal(t.position, model_yaw_degrees);
        const node = &kids[first + i];
        node.scene3d_pos_x = player.x + local.x;
        node.scene3d_pos_y = player.y + local.y;
        node.scene3d_pos_z = player.z + local.z;
        node.scene3d_rot_x = t.rotation[0];
        node.scene3d_rot_y = t.rotation[1] + model_yaw_degrees;
        node.scene3d_rot_z = t.rotation[2];
        node.scene3d_scale_x = t.scale[0];
        node.scene3d_scale_y = t.scale[1];
        node.scene3d_scale_z = t.scale[2];
    }
}

/// The LIVE-POSE twin (req_2786): identical node math, but the per-node
/// transforms come straight from the capture push instead of a clip — the
/// figure mirrors the camera. Transforms are model-local like clip keys.
fn updatePlayerModelNodesLive(kids: []Node, first: usize, groups: []const constructor.PlayerModelGroup, transforms: []const f32, player: PlayerState) void {
    const model_yaw_degrees = player.yaw * 180.0 / std.math.pi + 180.0;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const t = transforms[i * 9 ..][0..9];
        const local = rotateYLocal(.{ t[0], t[1], t[2] }, model_yaw_degrees);
        const node = &kids[first + i];
        node.scene3d_pos_x = player.x + local.x;
        node.scene3d_pos_y = player.y + local.y;
        node.scene3d_pos_z = player.z + local.z;
        node.scene3d_rot_x = t[3];
        node.scene3d_rot_y = t[4] + model_yaw_degrees;
        node.scene3d_rot_z = t[5];
        node.scene3d_scale_x = t[6];
        node.scene3d_scale_y = t[7];
        node.scene3d_scale_z = t[8];
    }
}

/// The NPC twin of updatePlayerModelNodes (req_0935): pose one NPC's child
/// nodes from its own transform + clip, reusing the SAME findPlayerClip /
/// sampleClipTransform / rotateYLocal the player figure uses (NPCs share the
/// PLAYER_ANIMATION clips). Stage 1 leaves clip = IDLE so figures stand.
fn updateNpcModelNodes(kids: []Node, npc: NpcRuntime, groups: []const constructor.PlayerModelGroup, animation: constructor.PlayerAnimationSet) void {
    const model_yaw_degrees = npc.yaw * 180.0 / std.math.pi + 180.0;
    const clip_time: f32 = if (npc.clip == PLAYER_CLIP_WALK) npc.gait_phase else 0;
    const clip = if (animation.node_count == groups.len) findPlayerClip(animation, npc.clip) else null;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const base = groups[i];
        const base_transform = constructor.PlayerTransform{
            .position = base.position,
            .rotation = base.rotation,
            .scale = base.scale,
        };
        const t = if (clip) |cclip| sampleClipTransform(cclip, i, clip_time) orelse base_transform else base_transform;
        const local = rotateYLocal(t.position, model_yaw_degrees);
        const node = &kids[npc.first_child + i];
        node.scene3d_pos_x = npc.x + local.x;
        node.scene3d_pos_y = npc.y + local.y;
        node.scene3d_pos_z = npc.z + local.z;
        node.scene3d_rot_x = t.rotation[0];
        node.scene3d_rot_y = t.rotation[1] + model_yaw_degrees;
        node.scene3d_rot_z = t.rotation[2];
        node.scene3d_scale_x = t.scale[0];
        node.scene3d_scale_y = t.scale[1];
        node.scene3d_scale_z = t.scale[2];
    }
}

fn updatePlayerAnimationClock(player: *PlayerState, dt: f32, moving: bool, running: bool, airborne: bool) void {
    if (moving) {
        const cycles = if (running) PLAYER_RUN_CYCLES_PER_SECOND else PLAYER_WALK_CYCLES_PER_SECOND;
        player.gait_phase += dt * cycles;
        player.gait_phase = @mod(player.gait_phase, 1.0);
    }
    if (airborne) {
        player.jump_time += dt;
    } else {
        player.jump_time = 0;
    }
}

// ── world content streaming (req_0524, V30 applied to the render plane) ─────
// The GTA 3/VC/SA-era residency model: full-detail geometry streams in around
// the player by RADIUS (promotion instant, demotion hysteretic), draws are
// culled by sight (frustum now; the Compile-precomputed VIS lump shares the
// seam), and a derived LOD shell keeps the whole skyline visible for cheap.
// Draw distance (camera far + fog) is unchanged — this governs what is drawn
// at full detail, not how far the camera sees. framework/world/streaming.zig
// owns the partition/LOD/draw-set logic; here we feed it the draw batches and
// turn its ranges into sub-range static draws (scene3d_instance_first).
const STREAM_CELL_METERS: f32 = 64.0; // same granularity as the collider grid
const STREAM_DETAIL_RADIUS_METERS: f32 = 240.0;
const CUTOUT_STENCIL_DATA_HEADER: usize = 10;
const CUTOUT_STENCIL_MAX_CELLS: usize = 512 * 512;
const CUTOUT_STENCIL_MARKER = "D[10u + cy * igw + cx]";

const StreamMode = enum { off, auto, force };

fn streamModeFromEnv() StreamMode {
    const s = std.posix.getenv("RJIT_STREAM") orelse return .auto;
    if (s.len == 0) return .auto;
    if (std.mem.eql(u8, s, "0") or std.ascii.eqlIgnoreCase(s, "off")) return .off;
    return .force;
}

fn streamRadiusFromEnv() f32 {
    const s = std.posix.getenv("RJIT_STREAM_RADIUS") orelse return STREAM_DETAIL_RADIUS_METERS;
    const v = std.fmt.parseFloat(f32, s) catch return STREAM_DETAIL_RADIUS_METERS;
    return clamp(v, 64.0, 4096.0);
}

fn colorChannelByte(v: f32) u8 {
    const scaled = clamp(v, 0, 1) * 255.0;
    return @intFromFloat(@round(scaled));
}

fn cutoutStencilGridSize(data: []const f32) ?struct { w: usize, h: usize } {
    if (data.len < CUTOUT_STENCIL_DATA_HEADER) return null;
    const wf = data[0];
    const hf = data[1];
    if (wf < 1 or hf < 1 or wf > 512 or hf > 512) return null;
    const w: usize = @intFromFloat(@round(wf));
    const h: usize = @intFromFloat(@round(hf));
    if (w == 0 or h == 0 or w * h > CUTOUT_STENCIL_MAX_CELLS) return null;
    if (@abs(wf - @as(f32, @floatFromInt(w))) > 0.01) return null;
    if (@abs(hf - @as(f32, @floatFromInt(h))) > 0.01) return null;
    if (data.len < CUTOUT_STENCIL_DATA_HEADER + w * h) return null;
    return .{ .w = w, .h = h };
}

fn materializeCutoutStencilPixels(allocator: std.mem.Allocator, key: []const u8, material: constructor.Material) bool {
    if (std.mem.indexOf(u8, material.wgsl, CUTOUT_STENCIL_MARKER) == null) return false;
    const grid = cutoutStencilGridSize(material.data) orelse return false;
    const tile_px: usize = MATERIAL_TILE_PX;
    const rgba = allocator.alloc(u8, tile_px * tile_px * 4) catch return false;
    defer allocator.free(rgba);

    const fg = [_]u8{
        colorChannelByte(material.data[2]),
        colorChannelByte(material.data[3]),
        colorChannelByte(material.data[4]),
        255,
    };
    const bg = [_]u8{
        colorChannelByte(material.data[5]),
        colorChannelByte(material.data[6]),
        colorChannelByte(material.data[7]),
        colorChannelByte(material.data[8]),
    };
    const cells = material.data[CUTOUT_STENCIL_DATA_HEADER .. CUTOUT_STENCIL_DATA_HEADER + grid.w * grid.h];

    var py: usize = 0;
    while (py < tile_px) : (py += 1) {
        const cy = @min(grid.h - 1, (py * grid.h) / tile_px);
        var px: usize = 0;
        while (px < tile_px) : (px += 1) {
            const cx = @min(grid.w - 1, (px * grid.w) / tile_px);
            const cell_on = cells[cy * grid.w + cx] >= 0.5;
            const color = if (cell_on) fg else bg;
            const o = (py * tile_px + px) * 4;
            rgba[o + 0] = color[0];
            rgba[o + 1] = color[1];
            rgba[o + 2] = color[2];
            rgba[o + 3] = color[3];
        }
    }
    return material_tex.materializePixels(key, rgba, MATERIAL_TILE_PX, MATERIAL_TILE_PX);
}

/// What a streamed family draws as: the shared geometry + texture every range
/// node of that family carries. Indexes align with streaming.World.families.
const StreamProto = struct {
    geom_key: []const u8,
    verts: []const f32,
    tex_key: ?[]const u8,
};

// RESKIN req_1845: the kid_list node range a baked mesh-prop instance occupies, so a live
// re-skin of that prop can hide the stale baked draw for the frame.
const BakedRange = struct { first: u32, count: u32 };
// DIRTYRECT: a baked mesh-prop's world center + the node range it occupies, so an
// erase rect can hide the ones inside it (the move case the position-keyed RESKIN
// coincident-hide misses, because the live ref has moved off the baked spot).
const BakedMeshPos = struct { x: f32, y: f32, z: f32, range: BakedRange, wall: bool = false };
// DIRTYRECT: a collapsed BOX instance row — its buffer + row + the original scale,
// so a changed erase-rect set can un-collapse it before re-evaluating.
const ErasedRow = struct { buf: []f32, row: usize, sx: f32, sy: f32, sz: f32 };
// Erase rect = an AABB the editor marks dirty (a moved/deleted piece's old footprint).
const EraseRect = struct { min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32 };

pub const Runtime = struct {
    allocator: std.mem.Allocator,
    node_id: u32 = 0,
    scene: constructor.Scene,
    fallback: ?[]f32 = null,
    insts: []const f32 = &.{},
    inst_count: u32 = 0,
    stride: usize = INSTANCE_STRIDE,
    piece_count: u32 = 0,
    physics_colliders: PhysicsColliders = undefined,
    has_physics_colliders: bool = false,
    // The CAMERA spring-arm always steps against the FULL baked authored wall/roof
    // colliders, never the per-frame windowed/instance-derived physics set. On a
    // huge map (spatial windowing ON) the physics set is re-derived from render
    // instances and capped (MAX_ORIENTED=256), which silently DROPS yawed building
    // walls near the player — the camera then buries inside a building it can't see.
    // Keeping a dedicated unclamped baked buffer for the camera means "see myself
    // against the building" works at any world scale (req_0407/0420). Null on a
    // pre-lump bake (no baked_colliders) — the camera falls back to physics_colliders.
    camera_colliders: ?PhysicsColliders = null,
    // Spatial collider windowing: enabled only when the full collider set overflows
    // MAX_RECTS (a huge --massive map), so normal maps keep their static full set.
    windowed: bool = false,
    grid: ?SpatialGrid = null,
    cube: [36 * 8]f32 = undefined,
    cube_open_run_min: [30 * 8]f32 = undefined,
    cube_open_run_max: [30 * 8]f32 = undefined,
    cube_open_run_both: [24 * 8]f32 = undefined,
    ramp_slab: [36 * 8]f32 = undefined,
    cylinder8: [8 * 12 * 8]f32 = undefined,
    cylinder16: [16 * 12 * 8]f32 = undefined,
    sphere: [12 * 8 * 6 * 8]f32 = undefined,
    brush_decal: [32 * 3 * 8]f32 = undefined,
    brush_rings: [(32 * 3 * 6 + 12) * 8]f32 = undefined,
    brush_handles: [(32 * 2 * 6 + 32 * 3 + 4 * 6) * 8]f32 = undefined,
    brush_cone: [32 * 3 * 8]f32 = undefined,
    brush_dome: [32 * 6 * 6 * 8]f32 = undefined,
    gable_prism: [24 * 8]f32 = undefined,
    corner_miter_prism: [12 * 8]f32 = undefined,
    corner_miter_mirror_prism: [12 * 8]f32 = undefined,
    grass_blade: [36 * 8]f32 = undefined,
    flower_head: [36 * 8]f32 = undefined,
    bush_clump: [60 * 8]f32 = undefined,
    frond_card: [144 * 8]f32 = undefined,
    palm_trunk: [1680 * 8]f32 = undefined,
    wrapped_meshes: [foliage.WRAPPED_SPECIES_COUNT]flora_geometry.WrappedMesh = undefined,
    shape_batches: ShapeBatches = undefined,
    has_shape_batches: bool = false,
    // Per-material textured batches (geometry built at construct; the shaders are
    // run into textures lazily by ensureMaterials at first render, once gpu is up).
    material_batches: []MaterialBatch = &.{},
    materials_ready: bool = false,
    player_geom_keys: std.ArrayList([]u8) = .{},
    mesh_prop_vertex_buffers: std.ArrayList([]f32) = .{},
    // LIVESKIN per-slot (req_2025): the live mesh-ref draw runs EVERY frame, so its per-slot
    // geom keys ("{meshKey}:base" / ":slot-N", the SAME keys the baked slotted draw interns)
    // are built ONCE and cached here, keyed by (meshHash<<32 | slotCode), never re-allocPrinted
    // per frame. Freed at teardown.
    live_slot_keys: std.AutoHashMapUnmanaged(u64, []u8) = .{},
    // Per cooked/imported mesh: its connected-component collision islands (req_1624),
    // computed once and shared by the static + windowed collider builds.
    mesh_prop_islands: []const []MeshIsland = &.{},
    kid_list: std.ArrayList(Node) = .{},
    root: Node = .{},
    player_first_child: usize = 0,
    /// Live NPC figures (req_0935) — built from scene.npc_spawns, rendered with
    /// the player figure's machinery. Their node child-strings are owned by
    /// player_geom_keys (the shared owned-key bag, freed at teardown).
    npcs: std.ArrayList(NpcRuntime) = .{},
    player: PlayerState = undefined,
    camera: CameraState = undefined,
    /// Prop interaction (PROPUSE req_0624) — driven by scene.interactables.
    interact: InteractState = .{},
    /// Kickable prop bodies (KICKPROP req_0625): the first MAX_ENTITIES of
    /// scene.dynamic_props, stepped through the host entity section.
    bodies: []PropBody = &.{},
    /// First kid index of the dynamic prop part nodes (laid out prop-by-prop
    /// in scene.dynamic_props order; updateDynamicPropNodes walks them).
    dyn_first_child: usize = 0,
    /// Live elevator cars (req_0652): parallel to the first
    /// physics_colliders.car_count ELEVATORS-lump shafts; stepElevators
    /// advances them and re-aims their live rects + render nodes.
    cars: []ElevatorCar = &.{},
    /// First kid index of the elevator car nodes (one box per car).
    car_first_child: usize = 0,
    /// Live doors (DOORS-0611): parallel to the first
    /// physics_colliders.door_count DOORS-lump records; the E toggle flips
    /// state, rect blocking, and the panel node together.
    doors_state: []DoorState = &.{},
    /// First kid index of the door panel nodes (one box per door).
    door_first_child: usize = 0,
    /// Live cooked doors (req_1864): parallel to physics_colliders.cooked_door
    /// rects; the leaf is a mesh-prop slot node (custom art), not a box. The E
    /// toggle parks the rect + drops the node together. Owned slice.
    cooked_doors: []CookedDoor = &.{},
    /// Live LED tickers (req_0893 #3): one MUTABLE instances node per ticker,
    /// whose lit-LED instance data we rebuild each frame as the scroll offset
    /// advances (the elevator-car live-node pattern, instanced). Buffers are
    /// owned, sized for the max lit dots ((windowCols+1)*rows).
    ticker_first_child: usize = 0,
    ticker_buffers: [][]f32 = &.{},
    /// Live editor-placed overlay (LIVEHOST req_1798): ONE mutable box-instance node in
    /// the stable prefix whose buffer applyPendingLive refreshes from the per-node pending
    /// rows the editor pushes. null until build() reserves it. live_buf is owned; live_gen
    /// tracks the last pending generation copied so a still view never re-uploads.
    live_kid: ?usize = null,
    live_buf: []f32 = &.{},
    live_gen: u64 = 0,
    /// Live physics-globals override (GLOBALS req_2770): the editor's Globals →
    /// Physics panel pushes the 13-float PHYSICS_CONFIG tuning through
    /// setPhysicsConfig and the NEXT step reads it — the baked lump value stays
    /// untouched so clearing the override reverts to the shipped feel.
    physics_override: ?constructor.PhysicsConfig = null,
    physics_override_gen: u64 = 0,
    /// Live-piece COLLIDERS (req_2792: "I can walk through every wall"): the
    /// live overlay is draw-only, so applyLiveColliders rebuilds the physics
    /// step buffer as BASE (the build-time rects/oriented, with their in-place
    /// door/car state) + LIVE (rects derived from the live rows, floors-first)
    /// whenever the overlay generation moves. These are the base section counts
    /// captured at build(); the gen tracks the last overlay folded in.
    base_rect_count: usize = 0,
    base_oriented_count: usize = 0,
    live_collider_gen: u64 = 0,
    /// Live MESH-prop colliders (req_2832: "i walk right through it") — the last
    /// live-mesh generation folded into the physics buffer, tracked separately so
    /// either overlay moving triggers the one shared rebuild.
    live_mesh_collider_gen: u64 = 0,
    live_collider_warned: bool = false,
    // Live editor-placed MESH props (LIVEMESH req_1812): a just-placed imported/cooked
    // mesh prop renders instantly by REFERENCING an already-resident mesh (the user's
    // "once one X exists, the next is a reference to it" — instanced rendering). The
    // editor pushes (meshKeyHash, x,y,z,yaw) per placement; applyLiveMeshProps appends a
    // mesh-prop draw node per ref each frame, resolving the hash to a loaded mesh. No bake.
    mesh_by_hash: std.AutoHashMapUnmanaged(u32, usize) = .{},
    mesh_hash_built: bool = false,
    // FULLRES req_1909/1911/1912: the editor's "fat & loaded" residency. The /editor route
    // pushes the WHOLE cooked-asset catalog (a MESH_PROPS lump, meshes only) so every compiled
    // asset is resident the instant you enter the route — placing/moving/skinning a prop made
    // seconds ago in Studio needs NO world rebake. These live alongside the baked scene meshes;
    // meshForHash resolves a live ref against baked first, then this resident set. Decoded once
    // per pushed generation (applyResidentMeshes), owned, freed on replace/unmount.
    resident: ?constructor.MeshProps = null,
    resident_by_hash: std.AutoHashMapUnmanaged(u32, usize) = .{},
    applied_resident_gen: u64 = 0,
    // Live editor face-skins (LIVESKIN req_1843): a procedural skin the editor pushes is
    // materialized once into a "live-mat:<hash>" tile; this maps its hash → that owned key
    // string (presence = already materialized). A live mesh ref carrying mat_hash wears it.
    live_mat_keys: std.AutoHashMapUnmanaged(u32, []u8) = .{},
    // RESKIN req_1845: a re-skinned EXISTING prop renders live with its new skin, but its
    // STALE baked copy must hide or the two z-fight. Each baked mesh-prop instance's node
    // range is keyed by world position; a live ref coincident with it hides that range for
    // the frame. hidden_baked tracks what we hid so the next frame restores it first.
    baked_by_pos: std.AutoHashMapUnmanaged(u64, BakedRange) = .{},
    hidden_baked: std.ArrayListUnmanaged(BakedRange) = .{},
    // DIRTYRECT req_1891/1892: erase the baked geometry a moved/deleted piece left
    // behind WITHOUT a rebake (the editor pushes the old-footprint rects). baked_mesh_list
    // is every baked mesh-prop's world pos + node range (so a rect can hide the ones inside
    // it — the move twin of the position-keyed RESKIN hide). erased_rows remembers each
    // collapsed BOX row's original scale so a changed rect set restores it first; the box
    // batches re-upload in place via the node version. applied_erase_gen tracks the last
    // pushed rect generation so the GPU re-upload happens once per edit, not per frame.
    baked_mesh_list: std.ArrayListUnmanaged(BakedMeshPos) = .{},
    erased_rows: std.ArrayListUnmanaged(ErasedRow) = .{},
    applied_erase_gen: u64 = 0,
    // DIRTYRECT (streaming): bumped when a stream family's rows are collapsed; refreshStreamNodes
    // stamps it as each streamed static node's instance version so the edited families re-upload.
    stream_erase_gen: u32 = 0,
    // WALLHIDE req_2053: the editor build pane's "disable walls" toggle. When ON, every WALL_SENTINEL
    // row collapses (scale→0) so you can see/edit a building's interior; toggling OFF restores them.
    // wall_collapsed_rows remembers each collapsed row's original scale (twin of erased_rows). The
    // *_gen counters re-run the collapse only when the toggle flips OR an erase pass restored a row
    // a wall pass had hidden (so the two never fight). The GPU cost (re-upload) is paid once per flip.
    hide_walls: bool = false,
    wall_collapsed_rows: std.ArrayListUnmanaged(ErasedRow) = .{},
    applied_wall_gen: u64 = 0,
    wall_seen_erase_gen: u64 = 0,
    // LIVEBLDSKIN req_1849: per-frame instance rows for live procedurally-skinned building-
    // piece faces (textured cubes outset to cover the baked face-slab). Pre-sized each frame
    // so the node slices into it stay stable while kid_list grows.
    skin_box_buf: std.ArrayListUnmanaged(f32) = .{},
    // Node count of the permanent (non-streaming, non-live-mesh) prefix — captured in
    // build(). The non-streaming path truncates back to here before re-appending the live
    // mesh nodes each frame (streaming truncates to stream_tail_start in refreshStreamNodes).
    perm_node_count: usize = 0,
    ticker_seconds: f32 = 0,
    // Ambient road traffic (req_2056): three MUTABLE instance nodes (box / cyl16 /
    // sphere — vehicle parts bucket by shape), their row buffers rebuilt each
    // frame by stepTraffic as every vehicle advances along its baked route.
    traffic_first_child: usize = 0,
    traffic_box_buf: []f32 = &.{},
    traffic_cyl_buf: []f32 = &.{},
    traffic_sphere_buf: []f32 = &.{},
    traffic_seconds: f32 = 0,
    // [traffic-paths req_2072] a debug ribbon along every baked route centerline,
    // toggled by the P key (or RJIT_TRAFFICPATHS=1 at boot) so the actual path over
    // the road is visible. One static box node; toggling sets its instance_count.
    traffic_path_node: usize = 0,
    traffic_path_buf: []f32 = &.{},
    traffic_path_count: u32 = 0,
    traffic_paths_on: bool = false,
    prev_paths_key_down: bool = false,
    last_ns: i64 = 0,
    frame: u32 = 0,
    // Content streaming (engaged when the world outgrows the detail radius):
    // per-frame draw-node tail rebuilt from the streaming world's ranges.
    stream: ?streaming.World = null,
    stream_protos: std.ArrayList(StreamProto) = .{},
    stream_radius: f32 = STREAM_DETAIL_RADIUS_METERS,
    stream_tail_start: usize = 0,
    stream_draw_count: usize = 0,
    stream_logged: bool = false,
    stream_drop_warned: bool = false,
    last_aspect: f32 = @as(f32, WIN_W) / @as(f32, WIN_H),
    // MAPPAINT req_2473: the live-painted terrain mirror. paint_kids_first is a
    // MAX_PAINT_SLOTS run of reserved nodes in the stable prefix (one per painted
    // chunk); each used slot owns a 121×121 downsampled floor buffer + a versioned
    // "~hf~paint-…" geom key, re-baked only when the chunk's height channel is
    // dirty (the once-per-frame coalescing the JS painter did with usePaintedField,
    // now host-side). paint_beam_kid is the translucent brush-beam column. The
    // last_* rect is the pane placement renderEmbedded saw — the screen→ray
    // mapping paintPointer needs.
    paint_kids_first: ?usize = null,
    paint_beam_kid: ?usize = null,
    paint_slot_used: [MAX_PAINT_SLOTS]bool = @splat(false),
    paint_slot_chunk: [MAX_PAINT_SLOTS][2]i32 = @splat(.{ 0, 0 }),
    paint_slot_ver: [MAX_PAINT_SLOTS]u32 = @splat(0),
    paint_slot_key: [MAX_PAINT_SLOTS]?[]u8 = @splat(null),
    paint_slot_floor: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    /// owned per-slot ground-formula D stream (tile channel), re-encoded on a
    /// dirty tiles channel — the 3d.zig ground pipeline re-reads it every frame
    paint_slot_ground: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    /// the water channel's mirror (chunkFloor.ts floorToWaterBody port): per-slot
    /// shore-culled depths + surface heights feeding a second "~water~" node
    /// live-foliage preview (req_2497/req_2875): ground flora, palm parts, and
    /// every whole wrapped tree/shrub species regenerated from
    /// the painted flora lanes whenever flora or terrain height changes —
    /// painting a tree paints a TREE, live. Buffers start at the family's
    /// ROW_CAP and DOUBLE when full (req_2843: elastic — the machine is the
    /// only wall); the renderer re-retains a grown family's fresh pointer.
    paint_foliage_kids_first: ?usize = null,
    /// req_2864: the regen runs on a WORKER thread (the pose_mailbox pattern,
    /// req_2845) — a moving brush must never spend frame time growing plants
    /// (240fps → 10fps measured). The main thread snapshots painted-chunk data
    /// (flora lanes + render floor) and submits; the worker grows rows +
    /// per-chunk segments (req_2859) into the row set the renderer is NOT
    /// displaying; poll swaps the finished set in. Strictly serial: one job in
    /// flight, stroke bursts coalesce through `foliage_want`.
    foliage_worker: ?std.Thread = null,
    foliage_box: FoliageMailbox = .{},
    foliage_sets: [2]FoliageRowSet = .{ .{}, .{} },
    foliage_display: u8 = 0,
    foliage_snap: FoliageSnapSlot = .{},
    foliage_want: bool = false,
    foliage_want_log: bool = false,
    paint_foliage_ver: u32 = 0,
    /// req_2838: preview-budget attention tracking. The regen spends the row
    /// budget NEAREST-FIRST from the anchor (brush hover, else camera look).
    /// When any family clipped, the preview FOLLOWS the author — a fresh regen
    /// fires once the anchor drifts half a chunk, re-spending the budget
    /// around the new spot so the place being painted is always dressed.
    paint_foliage_clipped: bool = false,
    paint_foliage_anchor: [2]f32 = .{ 0, 0 },
    paint_water_kids_first: ?usize = null,
    paint_slot_water_ver: [MAX_PAINT_SLOTS]u32 = @splat(0),
    paint_slot_water_key: [MAX_PAINT_SLOTS]?[]u8 = @splat(null),
    paint_slot_depths: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    paint_slot_surface: [MAX_PAINT_SLOTS]?[]f32 = @splat(null),
    paint_drop_warned: bool = false,
    paint_hover: ?[3]f32 = null,
    paint_stroking: bool = false,
    paint_last_x: f32 = 0,
    paint_last_y: f32 = 0,
    paint_last_w: f32 = 0,
    paint_last_h: f32 = 0,

    pub fn create(allocator: std.mem.Allocator, path: []const u8, store_dir: []const u8, node_id: u32) !*Runtime {
        const self = try allocator.create(Runtime);
        errdefer allocator.destroy(self);
        try self.initInPlace(allocator, path, store_dir, node_id);
        return self;
    }

    pub fn destroy(self: *Runtime) void {
        const allocator = self.allocator;
        self.deinit();
        allocator.destroy(self);
    }

    pub fn initInPlace(self: *Runtime, allocator: std.mem.Allocator, path: []const u8, store_dir: []const u8, node_id: u32) !void {
        const bytes = loadGameFile(allocator, path) catch |err| {
            // BLANKBOOT req_2490: no game file at this path yet — the paint-first
            // editor opens an EMPTY canvas instead of failing the mount. The world
            // is exactly the live layers (painted map, placed pieces, brush beam)
            // over nothing; the first Compile writes the file and a reload swaps
            // the real bake in. Only file-absence blanks; a corrupt file still
            // fails LOUDLY below.
            if (err == error.FileNotFound) {
                self.* = Runtime{
                    .allocator = allocator,
                    .node_id = node_id,
                    .scene = constructor.blankScene(),
                };
                log.print("[loader] no game file at {s} — BLANK world (paint-first canvas)\n", .{path});
                try self.build();
                return;
            }
            log.print("[loader] failed to read game-file {s}: {any}\n", .{ path, err });
            return err;
        };
        defer allocator.free(bytes);

        var store = std.fs.cwd().makeOpenPath(store_dir, .{}) catch |err| {
            log.print("[loader] cannot open content store {s}: {any}\n", .{ store_dir, err });
            return err;
        };
        defer store.close();

        const scene = constructor.construct(allocator, bytes, store) catch |err| {
            log.print("[loader] construct FAILED: {any}\n", .{err});
            return err;
        };
        self.* = Runtime{
            .allocator = allocator,
            .node_id = node_id,
            .scene = scene,
        };
        errdefer self.deinit();
        log.print("[loader] constructed map {d}x{d} from {s} (no JS)\n", .{ self.scene.width, self.scene.height, path });
        // WALLHIDE req_2053: RJIT_HIDE_WALLS=1 seeds the editor's "disable walls" so a headless
        // `rjit game shot` exercises the collapse (the door is otherwise only called from the
        // editor build pane). Diagnostic knob in the RJIT_STREAM / RJIT_COLLIDERLOG family.
        if (std.posix.getenv("RJIT_HIDE_WALLS")) |v| {
            if (v.len > 0 and v[0] == '1') {
                setHideWalls(node_id, true);
                log.print("[loader] RJIT_HIDE_WALLS=1 — walls collapsed (interior-edit view)\n", .{});
            }
        }
        if (self.scene.stats_config) |sc| {
            log.print("[loader] player stats config: hp_max={d:.0} armor={d:.0}/{d:.0} energy={d:.0}/{d:.0} wanted_decay={d:.2} skill_max_lvl={d:.0} (carries end to end)\n", .{ sc.health_max, sc.armor_start, sc.armor_max, sc.energy_start, sc.energy_max, sc.wanted_decay, sc.max_level });
        } else {
            log.print("[loader] no stats config lump — player stats use built-in defaults\n", .{});
        }
        try self.build();
    }

    /// Run each face material's RECIPE into its texture — a SHADER runs on
    /// the GPU, a DECAL DOC rasterizes on the CPU (DECALRECIPE-0610,
    /// gpu/decal_raster.zig) — and install it under the batch key
    /// (idempotent; needs gpu up, so it runs at first render not build).
    /// A material that fails to materialize leaves its faces on the
    /// fallback color.
    fn ensureMaterials(self: *Runtime) void {
        if (self.materials_ready) return;
        self.materials_ready = true;
        // The content-addressed image payloads decal docs reference by key
        // (DECALIMG-0610) — constructor read them from the store; hand the
        // rasterizer its own view of the table (gpu/ stays world/-free).
        var images: []decal_raster.ImageAsset = &.{};
        defer if (images.len > 0) self.allocator.free(images);
        if (self.scene.decal_assets.len > 0) {
            if (self.allocator.alloc(decal_raster.ImageAsset, self.scene.decal_assets.len)) |buf| {
                for (self.scene.decal_assets, 0..) |asset, k| buf[k] = .{ .key = asset.key, .bytes = asset.bytes };
                images = buf;
            } else |_| {
                log.print("[loader] OOM mapping {d} decal image asset(s) — image nodes skip\n", .{self.scene.decal_assets.len});
            }
        }
        for (self.scene.materials, 0..) |m, i| {
            var buf: [32]u8 = undefined;
            const key = std.fmt.bufPrint(&buf, "wmat-{d}", .{i}) catch continue;
            // Decal materials carry their packed doc — rasterize + upload.
            if (m.decal_doc.len > 0) {
                if (decal_raster.rasterize(self.allocator, m.decal_doc, images)) |raster| {
                    defer self.allocator.free(raster.rgba);
                    if (!material_tex.materializePixels(key, raster.rgba, raster.w, raster.h))
                        log.print("[loader] decal material {d} not installed — faces show fallback color\n", .{i});
                } else {
                    log.print("[loader] decal material {d} doc malformed — faces show fallback color\n", .{i});
                }
                continue;
            }
            // Translucent flat materials (glass: empty wgsl) have no shader to run —
            // they render through the transparent pass with the row's own color.
            // Feeding "" to the shader pipeline would crash wgpu, so skip them.
            if (m.wgsl.len == 0) continue;
            // Paint-bench cutout stencils ship as a tiny recipe: colors + a
            // coarse 0/1 mask grid. Rebuild that texture directly here so the
            // no-JS game path does not depend on the effects shader pipeline for
            // player-authored wall paint.
            if (materializeCutoutStencilPixels(self.allocator, key, m)) continue;
            if (!material_tex.materialize(key, m.wgsl, m.data, MATERIAL_TILE_PX))
                log.print("[loader] material {d} not materialized — faces show fallback color\n", .{i});
        }
    }

    pub fn deinit(self: *Runtime) void {
        self.mesh_by_hash.deinit(self.allocator);
        if (self.resident) |*res| res.deinit(self.allocator);
        self.resident_by_hash.deinit(self.allocator);
        self.baked_by_pos.deinit(self.allocator);
        self.hidden_baked.deinit(self.allocator);
        self.baked_mesh_list.deinit(self.allocator);
        self.erased_rows.deinit(self.allocator);
        self.wall_collapsed_rows.deinit(self.allocator);
        self.skin_box_buf.deinit(self.allocator);
        {
            var it = self.live_mat_keys.valueIterator();
            while (it.next()) |v| self.allocator.free(v.*);
            self.live_mat_keys.deinit(self.allocator);
        }
        for (self.mesh_prop_vertex_buffers.items) |verts| self.allocator.free(verts);
        self.mesh_prop_vertex_buffers.deinit(self.allocator);
        for (self.mesh_prop_islands) |isls| self.allocator.free(isls);
        if (self.mesh_prop_islands.len > 0) self.allocator.free(self.mesh_prop_islands);
        for (self.player_geom_keys.items) |key| self.allocator.free(key);
        self.player_geom_keys.deinit(self.allocator);
        for (self.paint_slot_key) |maybe_key| {
            if (maybe_key) |key| self.allocator.free(key);
        }
        for (self.paint_slot_floor) |maybe_floor| {
            if (maybe_floor) |floor| self.allocator.free(floor);
        }
        for (self.paint_slot_ground) |maybe_ground| {
            if (maybe_ground) |ground| self.allocator.free(ground);
        }
        for (self.paint_slot_water_key) |maybe_key| {
            if (maybe_key) |key| self.allocator.free(key);
        }
        for (self.paint_slot_depths) |maybe_buf| {
            if (maybe_buf) |buf| self.allocator.free(buf);
        }
        for (self.paint_slot_surface) |maybe_buf| {
            if (maybe_buf) |buf| self.allocator.free(buf);
        }
        // Foliage worker teardown (req_2864): stop the mailbox, join, THEN free
        // the worker-owned row sets — never while a regen could be writing them.
        self.foliage_box.stop();
        if (self.foliage_worker) |worker| worker.join();
        self.foliage_worker = null;
        for (&self.foliage_sets) |*set| {
            for (&set.rows) |*maybe_rows| {
                if (maybe_rows.*) |buf| std.heap.c_allocator.free(buf);
            }
            for (&set.segs) |*segs| segs.deinit(std.heap.c_allocator);
        }
        if (self.foliage_snap.chunks.len > 0) std.heap.c_allocator.free(self.foliage_snap.chunks);
        {
            var it = self.live_slot_keys.valueIterator();
            while (it.next()) |key| self.allocator.free(key.*);
            self.live_slot_keys.deinit(self.allocator);
        }
        self.npcs.deinit(self.allocator);
        if (self.material_batches.len > 0) {
            for (self.material_batches) |batch| batch.deinit(self.allocator);
            self.allocator.free(self.material_batches);
        }
        self.kid_list.deinit(self.allocator);
        if (self.stream) |*w| w.deinit(self.allocator);
        self.stream_protos.deinit(self.allocator);
        if (self.has_shape_batches) self.shape_batches.deinit(self.allocator);
        if (self.has_physics_colliders) self.physics_colliders.deinit(self.allocator);
        if (self.camera_colliders) |cam_cols| cam_cols.deinit(self.allocator);
        if (self.grid) |g| g.deinit(self.allocator);
        if (self.fallback) |f| self.allocator.free(f);
        if (self.interact.searched.len > 0) self.allocator.free(self.interact.searched);
        if (self.bodies.len > 0) self.allocator.free(self.bodies);
        if (self.cars.len > 0) self.allocator.free(self.cars);
        for (self.ticker_buffers) |buf| self.allocator.free(buf);
        if (self.ticker_buffers.len > 0) self.allocator.free(self.ticker_buffers);
        if (self.traffic_box_buf.len > 0) self.allocator.free(self.traffic_box_buf);
        if (self.traffic_cyl_buf.len > 0) self.allocator.free(self.traffic_cyl_buf);
        if (self.traffic_sphere_buf.len > 0) self.allocator.free(self.traffic_sphere_buf);
        if (self.traffic_path_buf.len > 0) self.allocator.free(self.traffic_path_buf);
        if (self.live_buf.len > 0) self.allocator.free(self.live_buf); // LIVEHOST req_1798
        self.scene.deinit(self.allocator);
        self.* = undefined;
    }

    fn meshPropTexKey(self: *Runtime, material_ref: u32) !?[]const u8 {
        if (material_ref == 0) return null;
        const mi: usize = @intCast(material_ref - 1);
        if (mi >= self.scene.materials.len) return null;
        const material = self.scene.materials[mi];
        if (material.wgsl.len == 0 and material.decal_doc.len == 0) return null;
        const key = try std.fmt.allocPrint(self.allocator, "wmat-{d}", .{mi});
        errdefer self.allocator.free(key);
        try self.player_geom_keys.append(self.allocator, key);
        return key;
    }

    fn appendMeshPropNode(
        self: *Runtime,
        mesh: constructor.MeshPropMesh,
        inst: constructor.MeshPropInstance,
        key: []const u8,
        start: u32,
        count: u32,
        material_ref: u32,
        alpha_override: ?f32,
        tex_key_override: ?[]const u8,
    ) !void {
        if (count == 0) return;
        const float_start: usize = @as(usize, @intCast(start)) * 8;
        const float_count: usize = @as(usize, @intCast(count)) * 8;
        if (float_start + float_count > mesh.vertices.len) return;
        const tex_key = try self.meshPropTexKey(material_ref);
        // tex_key_override (LIVESKIN req_1843): a live face-skin materialized into its own
        // "live-mat:<hash>" tile wins over the mesh's baked texture. It rides the mesh's OWN
        // UVs with no per-frame flip-copy (the live path runs every frame — a copy would leak);
        // the exact V-orientation lands on Compile.
        const eff_tex_key = tex_key_override orelse tex_key;
        const vertices = if (tex_key != null) blk: {
            const copy = try self.allocator.alloc(f32, float_count);
            errdefer self.allocator.free(copy);
            @memcpy(copy, mesh.vertices[float_start .. float_start + float_count]);
            var i: usize = 7;
            while (i < copy.len) : (i += 8) copy[i] = 1 - copy[i];
            try self.mesh_prop_vertex_buffers.append(self.allocator, copy);
            break :blk copy;
        } else mesh.vertices[float_start .. float_start + float_count];
        const material_index: usize = if (material_ref > 0) @intCast(material_ref - 1) else self.scene.materials.len;
        const opacity = if (material_index < self.scene.materials.len) self.scene.materials[material_index].opacity else 1;
        // alpha_override (LIVEMESH ghost req_1841): the hover preview forces a translucent
        // alpha so it reads as a not-yet-placed ghost; a<1 routes it to the transparent pass.
        const final_alpha = alpha_override orelse opacity;
        const textured = eff_tex_key != null or mesh.tex_rgba != null;
        // GLASS TINT (req_2020): a flat-translucent material (empty shader, no decal,
        // alpha<1) is a cooked-prop glass pane. The lump ships opacity only — without
        // this the node fell back to the prop's gray tint, so a window over bright sky
        // read as hollow. Tint it the editor's Glass() blue (mirrors materials.ts
        // GLASS_TINT '#a9c8d8') so /compiled glass matches the React play view.
        const glass_tint: ?[3]f32 = if (!textured and alpha_override == null and material_index < self.scene.materials.len) blk: {
            const m = self.scene.materials[material_index];
            break :blk if (m.wgsl.len == 0 and m.decal_doc.len == 0 and m.opacity < 0.999) GLASS_TINT else null;
        } else null;
        const node_color: [3]f32 = if (textured) .{ 1, 1, 1 } else (glass_tint orelse mesh.color);
        try self.kid_list.append(self.allocator, .{
            .scene3d_mesh = count > 0,
            .scene3d_geom_key = key,
            .scene3d_vertices = vertices,
            .scene3d_vert_count = count,
            .scene3d_bounds_radius = mesh.bounds_radius,
            .scene3d_pos_x = inst.x,
            .scene3d_pos_y = inst.y,
            .scene3d_pos_z = inst.z,
            .scene3d_rot_y = inst.yaw_degrees,
            .scene3d_color_r = node_color[0],
            .scene3d_color_g = node_color[1],
            .scene3d_color_b = node_color[2],
            .scene3d_color_a = final_alpha,
            .scene3d_tex_w = if (eff_tex_key == null) mesh.tex_w else 0,
            .scene3d_tex_h = if (eff_tex_key == null) mesh.tex_h else 0,
            .scene3d_tex_rgba = if (eff_tex_key == null) mesh.tex_rgba else null,
            .scene3d_tex_key = eff_tex_key,
        });
    }

    // LIVEMESH req_1812: map every resident mesh-prop's key-hash → its mesh index, once.
    // The editor pushes the SAME hash (FNV-1a of the mesh key the bake assigned), so a
    // live placement resolves to the loaded mesh with no string marshalling across V8.
    fn ensureMeshHashMap(self: *Runtime) void {
        if (self.mesh_hash_built) return;
        self.mesh_hash_built = true;
        const mp = self.scene.mesh_props orelse return;
        for (mp.meshes, 0..) |mesh, i| {
            self.mesh_by_hash.put(self.allocator, liveMeshHash(mesh.key), i) catch {};
        }
    }

    // FULLRES: resolve a live ref's key-hash to a loaded mesh — the BAKED scene meshes first
    // (those carry their lump-loaded textures), then the editor's pushed resident catalog. Null
    // when neither holds it (asset not installed). The two sets share the FNV-1a key-hash space,
    // so a placement ref resolves whether the prop was baked into the gamefile or just compiled.
    fn meshForHash(self: *Runtime, hash: u32) ?constructor.MeshPropMesh {
        if (self.scene.mesh_props) |mp| {
            if (self.mesh_by_hash.get(hash)) |idx| {
                if (idx < mp.meshes.len) return mp.meshes[idx];
            }
        }
        if (self.resident) |res| {
            if (self.resident_by_hash.get(hash)) |idx| {
                if (idx < res.meshes.len) return res.meshes[idx];
            }
        }
        return null;
    }

    // The stable per-slot geom key for a live mesh ref — "{meshKey}:base" (code 0) or
    // "{meshKey}:slot-N" (code N+1), the SAME strings the baked slotted draw interns, so the
    // two share one interned geometry slice. Built once per (meshHash, code) and cached (the
    // live draw runs every frame; an allocPrint per frame would leak). Null on OOM → the caller
    // falls back to the whole-mesh key (a coarser but safe draw).
    fn liveSlotKey(self: *Runtime, mesh: constructor.MeshPropMesh, hash: u32, code: u32) ?[]const u8 {
        const packed_key: u64 = (@as(u64, hash) << 32) | @as(u64, code);
        if (self.live_slot_keys.get(packed_key)) |k| return k;
        const key = (if (code == 0)
            std.fmt.allocPrint(self.allocator, "{s}:base", .{mesh.key})
        else
            std.fmt.allocPrint(self.allocator, "{s}:slot-{d}", .{ mesh.key, code - 1 })) catch return null;
        self.live_slot_keys.put(self.allocator, packed_key, key) catch {
            self.allocator.free(key);
            return null;
        };
        return key;
    }

    // LIVEMESH req_1812: append draw node(s) for each live-placed mesh prop, referencing an
    // already-resident mesh. Called at the END of stepNow, after refreshStreamNodes rebuilt the
    // stream tail — so the streaming path truncated last frame's live nodes for us; the monolithic
    // path truncates them here to perm_node_count. The hover GHOST (req_1841) rides the same path
    // with a forced translucent alpha. req_2025: a multi-slot prop emits one node per texture slot
    // so each slot wears its own skin (material_ref 0 throughout → no per-frame vertex allocation;
    // the per-slot skin rides as a tex_key_override, the base/atlas slots ride mesh.tex_rgba).
    fn appendLiveMeshRef(self: *Runtime, r: LiveMeshRef, alpha: ?f32) void {
        const mesh = self.meshForHash(r.hash) orelse return;
        const inst: constructor.MeshPropInstance = .{ .mesh = 0, .x = r.x, .y = r.y, .z = r.z, .yaw_degrees = r.yaw };
        // No texture slots, or no per-slot mats (ghost / unskinned new placement) → the whole
        // mesh on one optional override (back-compat: a single-surface prop's lone skin).
        if (mesh.slots.len == 0 or r.mats.len == 0) {
            const override: ?[]const u8 = if (r.mats.len > 0 and r.mats[0] != 0) self.live_mat_keys.get(r.mats[0]) else null;
            self.appendMeshPropNode(mesh, inst, mesh.key, 0, mesh.vertex_count, 0, alpha, override) catch {};
            return;
        }
        // PER-SLOT (req_2025): mirror the baked slotted draw so a multi-slot cooked prop wears
        // each slot's own skin instead of the FIRST skin smeared over every face. The base
        // range (faces before slot 0) and any trailing loader slot past mats.len (glass/leaf)
        // get no override → the mesh's baked atlas, exactly as today's whole-mesh live draw.
        const first_slot_start = mesh.slots[0].start;
        if (first_slot_start > 0) {
            const key = self.liveSlotKey(mesh, r.hash, 0) orelse mesh.key;
            self.appendMeshPropNode(mesh, inst, key, 0, first_slot_start, 0, alpha, null) catch {};
        }
        for (mesh.slots, 0..) |slot, si| {
            const key = self.liveSlotKey(mesh, r.hash, @as(u32, @intCast(si + 1))) orelse mesh.key;
            const mat_hash: u32 = if (si < r.mats.len) r.mats[si] else 0;
            const override: ?[]const u8 = if (mat_hash != 0) self.live_mat_keys.get(mat_hash) else null;
            self.appendMeshPropNode(mesh, inst, key, slot.start, slot.count, 0, alpha, override) catch {};
        }
    }

    // FULLRES: decode + install the pushed resident catalog once per generation. The lump is a
    // standard MESH_PROPS buffer (meshes only) — the SAME decode the gamefile uses, so textures
    // (tex_rgba) and slots come through identically and a resident mesh renders exactly as a
    // baked one would.
    fn applyResidentMeshes(self: *Runtime) void {
        const pend = pendingResidentFor(self.node_id) orelse return;
        if (pend.gen == self.applied_resident_gen) return;
        self.applied_resident_gen = pend.gen;
        if (self.resident) |*old| old.deinit(self.allocator);
        self.resident = null;
        self.resident_by_hash.clearRetainingCapacity();
        if (pend.bytes.len == 0) return;
        const decoded = constructor.decodeMeshProps(self.allocator, pend.bytes) catch |e| {
            log.print("[loader] resident catalog decode failed: {any}\n", .{e});
            return;
        };
        self.resident = decoded;
        for (decoded.meshes, 0..) |mesh, i| {
            self.resident_by_hash.put(self.allocator, liveMeshHash(mesh.key), i) catch {};
        }
        log.print("[loader] resident catalog: {d} cooked mesh(es) ready (no rebake to place)\n", .{decoded.meshes.len});
    }

    // LIVESKIN req_1843: materialize the editor's queued face-skin recipes (GPU is up by
    // render time), once per hash, into "live-mat:<hash>" tiles a live mesh ref then samples.
    fn ensureLiveMaterials(self: *Runtime) void {
        const pm = pendingLiveMatsFor(self.node_id) orelse return;
        for (pm.mats.items) |m| {
            if (self.live_mat_keys.contains(m.hash)) continue;
            const key = std.fmt.allocPrint(self.allocator, "live-mat:{x}", .{m.hash}) catch continue;
            const data: ?[]const f32 = if (m.data.len > 0) m.data else null;
            const ok = if (m.kind == 0) material_tex.materialize(key, m.wgsl, data, MATERIAL_TILE_PX) else false;
            if (!ok) {
                self.allocator.free(key);
                continue;
            }
            self.live_mat_keys.put(self.allocator, m.hash, key) catch self.allocator.free(key);
        }
    }

    // RESKIN req_1845: a baked mesh-prop instance's nodes shown/hidden as a block.
    fn setBakedRangeVisible(self: *Runtime, rng: BakedRange, visible: bool) void {
        var k: u32 = 0;
        while (k < rng.count) : (k += 1) {
            const ni: usize = @as(usize, rng.first) + k;
            if (ni < self.kid_list.items.len) self.kid_list.items[ni].scene3d_mesh = visible;
        }
    }

    // DIRTYRECT — the scale floats of a stride-N instance row (collapse target).
    fn rowScaleBase(stride: usize) usize {
        return if (stride >= 12) 6 else 3;
    }

    fn pointInAnyEraseRect(rects: []const EraseRect, x: f32, y: f32, z: f32, test_y: bool) bool {
        for (rects) |r| {
            if (x >= r.min_x and x <= r.max_x and z >= r.min_z and z <= r.max_z) {
                if (!test_y or (y >= r.min_y and y <= r.max_y)) return true;
            }
        }
        return false;
    }

    // Collapse (scale→0) every row of a static instance buffer whose center sits inside
    // an erase rect, recording the originals so a changed rect set restores them first.
    // Returns whether anything changed (the owning node then re-uploads via its version).
    fn collapseRowsInRects(self: *Runtime, buf: []f32, count: u32, stride: usize, rects: []const EraseRect) bool {
        if (count == 0 or buf.len < stride or rects.len == 0) return false;
        const sb = rowScaleBase(stride);
        var any = false;
        var row: usize = 0;
        while (row < count) : (row += 1) {
            const o = row * stride;
            if (o + sb + 3 > buf.len) break;
            if (buf[o + sb] == 0 and buf[o + sb + 1] == 0 and buf[o + sb + 2] == 0) continue; // already gone
            if (!pointInAnyEraseRect(rects, buf[o + 0], buf[o + 1], buf[o + 2], true)) continue;
            self.erased_rows.append(self.allocator, .{ .buf = buf, .row = row, .sx = buf[o + sb], .sy = buf[o + sb + 1], .sz = buf[o + sb + 2] }) catch {};
            buf[o + sb] = 0;
            buf[o + sb + 1] = 0;
            buf[o + sb + 2] = 0;
            any = true;
        }
        return any;
    }

    // DIRTYRECT req_1891/1892: erase the baked geometry a moved/deleted piece left at its
    // old footprint, WITHOUT a rebake. Runs once per pushed rect generation (the GPU
    // re-upload is the cost): un-collapse last round's box rows, collapse the rows inside
    // the current rects, and bump every static node's version so the edited batches
    // re-stage in place. Mesh-prop hides are recomputed per frame in applyLiveMeshProps
    // (cheap bool toggles) so they need no generation gate here.
    fn applyDirtyErase(self: *Runtime) void {
        const pend = pendingDirtyEraseFor(self.node_id) orelse return;
        if (pend.gen == self.applied_erase_gen) return;
        self.applied_erase_gen = pend.gen;
        const sb = rowScaleBase(self.stride);
        // 1. restore every row we collapsed last round (scale back to original).
        for (self.erased_rows.items) |er| {
            const o = er.row * self.stride + sb;
            if (o + 3 <= er.buf.len) {
                er.buf[o] = er.sx;
                er.buf[o + 1] = er.sy;
                er.buf[o + 2] = er.sz;
            }
        }
        self.erased_rows.clearRetainingCapacity();
        // 2. collapse the SOLID instance rows inside the current rects (flora is left
        // alone — a piece move never erases grass/flowers/fronds/palms). Streaming draws
        // its OWN spatially-sorted copies (w.families), so collapse THOSE; the monolithic
        // path collapses the shape/material batches directly.
        const rects = pend.rects;
        if (rects.len > 0) {
            if (self.stream) |*w| {
                for (w.families) |*fam| {
                    if (fam.draw_radius > 0) continue; // flora family (req_1665 half-radius) — skip
                    if (fam.rows.len >= fam.stride) _ = self.collapseRowsInRects(fam.rows, @intCast(fam.rows.len / fam.stride), fam.stride, rects);
                }
            } else {
                if (self.has_shape_batches) {
                    const s = self.shape_batches;
                    _ = self.collapseRowsInRects(s.boxes, s.box_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.boxes_open_run_min, s.box_open_run_min_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.boxes_open_run_max, s.box_open_run_max_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.boxes_open_run_both, s.box_open_run_both_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.ramps, s.ramp_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.cylinder8s, s.cylinder8_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.cylinder16s, s.cylinder16_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.spheres, s.sphere_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.gables, s.gable_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.corner_miters, s.corner_miter_count, self.stride, rects);
                    _ = self.collapseRowsInRects(s.corner_miter_mirrors, s.corner_miter_mirror_count, self.stride, rects);
                }
                for (self.material_batches) |mb| _ = self.collapseRowsInRects(mb.boxes, mb.count, self.stride, rects);
            }
        }
        // 3. re-upload the edited static batches in place. Both paths bump a version the
        // static cache keys re-staging off (once per edit, vs a per-frame restage); the
        // touched-only refinement is a later optimization for huge maps. Streaming nodes are
        // rebuilt every frame, so they read the version from stream_erase_gen in refreshStreamNodes.
        if (self.stream != null) {
            self.stream_erase_gen +%= 1;
        } else {
            var ni: usize = 0;
            const limit = @min(self.perm_node_count, self.kid_list.items.len);
            while (ni < limit) : (ni += 1) {
                if (self.kid_list.items[ni].scene3d_instance_static) self.kid_list.items[ni].scene3d_instance_version +%= 1;
            }
        }
    }

    // WALLHIDE req_2053: collapse (scale→0) every WALL row of a built batch/family buffer —
    // the rows appendInstanceRow stamped with WALL_SENTINEL in their shape slot. Records each
    // collapsed row's original scale (twin of collapseRowsInRects) so toggling OFF restores it.
    // Skips rows already collapsed (an erase rect got there first) so the two never double up.
    fn collapseWallRows(self: *Runtime, buf: []f32, count: u32, stride: usize) bool {
        if (count == 0 or stride < 13 or buf.len < stride) return false;
        const sb = rowScaleBase(stride);
        var any = false;
        var row: usize = 0;
        while (row < count) : (row += 1) {
            const o = row * stride;
            if (o + sb + 3 > buf.len) break;
            if (buf[o + 12] != WALL_SENTINEL_SHAPE) continue; // not a wall row
            if (buf[o + sb] == 0 and buf[o + sb + 1] == 0 and buf[o + sb + 2] == 0) continue; // already gone (erased)
            self.wall_collapsed_rows.append(self.allocator, .{ .buf = buf, .row = row, .sx = buf[o + sb], .sy = buf[o + sb + 1], .sz = buf[o + sb + 2] }) catch {};
            buf[o + sb] = 0;
            buf[o + sb + 1] = 0;
            buf[o + sb + 2] = 0;
            any = true;
        }
        return any;
    }

    // WALLHIDE req_2053: the editor build pane's "disable walls" toggle, with NO rebake — mirror
    // of applyDirtyErase. Re-runs only when the toggle flipped (its gen) OR an erase pass advanced
    // (it may have restored a wall row this pass hid; re-collapsing keeps them consistent). Restore
    // last round's collapses, collapse every WALL row when ON, then bump the same node/stream
    // version the erase path does so the edited batches re-upload once.
    fn applyWallHide(self: *Runtime) void {
        const pend = pendingWallHideFor(self.node_id);
        const want = if (pend) |p| p.on else false;
        const gen = if (pend) |p| p.gen else 0;
        // Mirror the state for applyLiveMeshProps (runs later this frame) so it hides the
        // cooked-wall MESH PROPS too — those aren't instance rows, so they ride that path.
        self.hide_walls = want;
        if (gen == self.applied_wall_gen and self.applied_erase_gen == self.wall_seen_erase_gen) return;
        self.applied_wall_gen = gen;
        self.wall_seen_erase_gen = self.applied_erase_gen;
        const sb = rowScaleBase(self.stride);
        // 1. restore every wall row we collapsed last round.
        for (self.wall_collapsed_rows.items) |er| {
            const o = er.row * self.stride + sb;
            if (o + 3 <= er.buf.len) {
                er.buf[o] = er.sx;
                er.buf[o + 1] = er.sy;
                er.buf[o + 2] = er.sz;
            }
        }
        self.wall_collapsed_rows.clearRetainingCapacity();
        // 2. collapse every wall row when the toggle is ON. Streaming draws its OWN sorted
        // copies (w.families); the monolithic path collapses the shape/material batches.
        if (want) {
            if (self.stream) |*w| {
                for (w.families) |*fam| {
                    if (fam.draw_radius > 0) continue; // flora family — never a wall
                    if (fam.rows.len >= fam.stride) _ = self.collapseWallRows(fam.rows, @intCast(fam.rows.len / fam.stride), fam.stride);
                }
            } else {
                if (self.has_shape_batches) {
                    const s = self.shape_batches;
                    _ = self.collapseWallRows(s.boxes, s.box_count, self.stride);
                    _ = self.collapseWallRows(s.boxes_open_run_min, s.box_open_run_min_count, self.stride);
                    _ = self.collapseWallRows(s.boxes_open_run_max, s.box_open_run_max_count, self.stride);
                    _ = self.collapseWallRows(s.boxes_open_run_both, s.box_open_run_both_count, self.stride);
                    _ = self.collapseWallRows(s.ramps, s.ramp_count, self.stride);
                    _ = self.collapseWallRows(s.gables, s.gable_count, self.stride);
                    _ = self.collapseWallRows(s.corner_miters, s.corner_miter_count, self.stride);
                    _ = self.collapseWallRows(s.corner_miter_mirrors, s.corner_miter_mirror_count, self.stride);
                }
                for (self.material_batches) |mb| _ = self.collapseWallRows(mb.boxes, mb.count, self.stride);
            }
        }
        // 3. re-upload the edited static batches in place (same invalidation as applyDirtyErase).
        if (self.stream != null) {
            self.stream_erase_gen +%= 1;
        } else {
            var ni: usize = 0;
            const limit = @min(self.perm_node_count, self.kid_list.items.len);
            while (ni < limit) : (ni += 1) {
                if (self.kid_list.items[ni].scene3d_instance_static) self.kid_list.items[ni].scene3d_instance_version +%= 1;
            }
        }
    }

    // LIVEBLDSKIN req_1849: append a textured cube per procedurally-skinned building-piece
    // face, OUTSET a hair so it covers the baked face-slab (building-piece boxes are batched
    // instanced draws — can't hide one — so we cover instead of hide). One-instance box nodes
    // into a pre-sized per-frame buffer (stable slices while kid_list grows).
    fn appendLiveSkinBoxes(self: *Runtime) void {
        const sb = pendingSkinBoxesFor(self.node_id) orelse return;
        if (sb.boxes.len == 0) return;
        self.skin_box_buf.clearRetainingCapacity();
        self.skin_box_buf.ensureTotalCapacity(self.allocator, sb.boxes.len * INSTANCE_STRIDE) catch return;
        const out = SKIN_BOX_OUTSET;
        for (sb.boxes) |b| {
            const key = self.live_mat_keys.get(b.mat_hash) orelse continue; // material not materialized yet
            const start = self.skin_box_buf.items.len;
            self.skin_box_buf.appendSliceAssumeCapacity(&[_]f32{ b.cx, b.cy, b.cz, 0, b.yaw, 0, b.sx + out, b.sy + out, b.sz + out, 1, 1, 1 });
            const row = self.skin_box_buf.items[start .. start + INSTANCE_STRIDE];
            self.kid_list.append(self.allocator, .{
                .scene3d_mesh = true,
                .scene3d_geom_key = "box",
                .scene3d_vertices = self.cube[0..],
                .scene3d_vert_count = 36,
                .scene3d_instance_data = row,
                .scene3d_instance_count = 1,
                .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
                .scene3d_instance_static = false,
                .scene3d_tex_key = key,
            }) catch {};
        }
    }

    fn applyLiveMeshProps(self: *Runtime) void {
        if (self.stream == null) self.kid_list.shrinkRetainingCapacity(self.perm_node_count);
        defer self.root.children = self.kid_list.items; // append may realloc; re-point the root
        self.ensureLiveMaterials();
        self.applyResidentMeshes(); // FULLRES: install the editor's pushed cooked-asset catalog (once per gen)
        // RESKIN req_1845: un-hide whatever we hid last frame before re-evaluating, so a
        // reverted/reloaded prop shows its baked render again.
        for (self.hidden_baked.items) |rng| self.setBakedRangeVisible(rng, true);
        self.hidden_baked.clearRetainingCapacity();
        // Live mesh-prop refs resolve against the baked scene meshes AND the resident catalog
        // (meshForHash), so they draw even on a map with no baked mesh props — a just-compiled
        // asset places instantly off residency, no rebake.
        self.ensureMeshHashMap(); // baked hash map (no-op when the map baked no mesh props)
        if (pendingLiveMeshFor(self.node_id)) |p| {
            for (p.refs) |r| {
                self.appendLiveMeshRef(r, null);
                // A live ref coincident with a BAKED instance is a RE-SKIN of an existing prop
                // (the editor pushes those + brand-new placements at fresh positions) — hide the
                // stale baked draw so the two don't z-fight. Resident-only meshes have no baked
                // twin, so this is gated on the baked table.
                if (self.scene.mesh_props != null and self.baked_by_pos.count() > 0) {
                    if (self.mesh_by_hash.get(r.hash)) |idx| {
                        if (self.baked_by_pos.get(meshPosKey(idx, r.x, r.z, r.yaw))) |rng| {
                            self.setBakedRangeVisible(rng, false);
                            self.hidden_baked.append(self.allocator, rng) catch {};
                        }
                    }
                }
            }
        }
        // The placement ghost: the armed mesh prop, translucent, tracking the snap target.
        if (pendingMeshGhostFor(self.node_id)) |gh| {
            if (gh.has) self.appendLiveMeshRef(gh.ref, LIVE_MESH_GHOST_ALPHA);
        }
        // DIRTYRECT req_1891/1892: hide every baked mesh prop whose old position sits inside
        // an active erase rect — the MOVED-prop case the coincident-hide above misses (the
        // live ref has moved to the new spot). Cheap bool toggles, recomputed each frame and
        // restored by the hidden_baked un-hide above; the live overlay draws the new position.
        if (pendingDirtyEraseFor(self.node_id)) |pend| {
            if (pend.rects.len > 0 and self.baked_mesh_list.items.len > 0) {
                for (self.baked_mesh_list.items) |bm| {
                    if (pointInAnyEraseRect(pend.rects, bm.x, bm.y, bm.z, false)) {
                        self.setBakedRangeVisible(bm.range, false);
                        self.hidden_baked.append(self.allocator, bm.range) catch {};
                    }
                }
            }
        }
        // WALLHIDE req_2058: hide every baked cooked-wall mesh prop while "disable walls" is on
        // (the box walls collapse via applyWallHide; these are mesh-prop nodes, hidden by range).
        // Recomputed each frame and restored by the hidden_baked un-hide above, exactly like erase.
        if (self.hide_walls) {
            for (self.baked_mesh_list.items) |bm| {
                if (!bm.wall) continue;
                self.setBakedRangeVisible(bm.range, false);
                self.hidden_baked.append(self.allocator, bm.range) catch {};
            }
        }
        self.appendLiveSkinBoxes();
    }

    fn build(self: *Runtime) !void {
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
        if (std.posix.getenv("RJIT_TRAFFIC_SPAWN") != null) {
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
                    self.rebuildWindow(spawn.x, spawn.z);
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
        self.stream_radius = streamRadiusFromEnv();
        const full_bounds = instanceBounds(self.insts, self.inst_count, self.stride);
        const want_stream = switch (streamModeFromEnv()) {
            .off => false,
            .force => self.inst_count > 0,
            .auto => full_bounds.radius > self.stream_radius,
        };
        if (want_stream) self.setupStreaming() catch |err| {
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
        if (self.scene.player_model.len == 0) {
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
        // the gamefile brought none, and only when the node count matches.
        if (self.scene.player_animation.clips.len == 0) {
            if (pendingPlayerAnimationCopy(self.allocator, self.scene.player_model.len)) |animation| {
                self.scene.player_animation = animation;
                log.print("[loader] player animation from live push — {d} clips (req_2781)\n", .{animation.clips.len});
            }
        }
        self.player_first_child = self.kid_list.items.len;
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
        if (self.scene.player_model.len == 0) log.print("[loader] no player model lump and stand-in failed — camera target only\n", .{});

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
                    try self.appendMeshPropNode(mesh, inst, mesh.key, 0, mesh.vertex_count, 0, null, null);
                    continue;
                }

                const first_slot_start = mesh.slots[0].start;
                if (first_slot_start > 0) {
                    const key = try std.fmt.allocPrint(self.allocator, "{s}:base", .{mesh.key});
                    self.player_geom_keys.append(self.allocator, key) catch |err| {
                        self.allocator.free(key);
                        return err;
                    };
                    try self.appendMeshPropNode(mesh, inst, key, 0, first_slot_start, 0, null, null);
                }
                for (mesh.slots, 0..) |slot, si| {
                    const key = try std.fmt.allocPrint(self.allocator, "{s}:slot-{d}", .{ mesh.key, si });
                    self.player_geom_keys.append(self.allocator, key) catch |err| {
                        self.allocator.free(key);
                        return err;
                    };
                    const material_ref = if (si < inst.slot_materials.len) inst.slot_materials[si] else 0;
                    const leaf_node_index = self.kid_list.items.len;
                    try self.appendMeshPropNode(mesh, inst, key, slot.start, slot.count, material_ref, null, null);
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
            self.traffic_paths_on = std.posix.getenv("RJIT_TRAFFICPATHS") != null;
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
        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, self.cameraColliderSet(), 0);
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, false, false, false);
        self.refreshNpcNodes();
        // Seed the bubble at spawn and assemble the first draw tail — the very
        // first rendered frame already streams (the camera was just solved).
        self.refreshStreamNodes();
        self.last_ns = nowNs();
    }

    /// Feed the draw batches through the streaming partitioner
    /// (framework/world/streaming.zig). On success the monolithic world nodes
    /// are not emitted; refreshStreamNodes rebuilds the draw tail every frame.
    /// Leaves self.stream null (and says so) when the world isn't worth
    /// chunking; any failure falls back to monolithic draws.
    fn setupStreaming(self: *Runtime) !void {
        var fams: std.ArrayList(streaming.FamilyRows) = .{};
        defer fams.deinit(self.allocator);
        errdefer self.stream_protos.clearAndFree(self.allocator);

        // req_1665: short foliage (grass/flora/trees) draws to HALF the structural
        // view distance — a dense field at full radius dominates per-frame instance
        // staging + the wind shader, so cutting its draw distance is the main fps
        // lever. Structure keeps the full bubble (draw_radius 0 = unlimited).
        const flora_radius: f32 = self.stream_radius * 0.5;

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
    fn refreshNpcNodes(self: *Runtime) void {
        for (self.npcs.items) |npc| {
            const mi: usize = @intCast(npc.model_index);
            if (mi >= self.scene.npc_models.len) continue;
            updateNpcModelNodes(self.kid_list.items, npc, self.scene.npc_models[mi], self.scene.player_animation);
        }
    }

    fn refreshStreamNodes(self: *Runtime) void {
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

    fn pollStandaloneEvents(self: *Runtime, running: *bool) void {
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
                    self.mouseLook(event.motion.xrel, event.motion.yrel);
                },
                else => {},
            }
        }
    }

    pub fn mouseLook(self: *Runtime, dx: f32, dy: f32) void {
        const pitch_limits: PitchLimits = if (self.camera.aiming) aimPitchLimitsInOrbitSpace() else .{ .min = CAMERA_MIN_PITCH_DEGREES, .max = CAMERA_MAX_PITCH_DEGREES };
        self.camera.yaw_degrees -= dx * CAMERA_YAW_DEGREES_PER_PIXEL;
        self.camera.pitch_degrees = clamp(
            self.camera.pitch_degrees - dy * CAMERA_PITCH_DEGREES_PER_PIXEL,
            pitch_limits.min,
            pitch_limits.max,
        );
    }

    pub fn setAiming(self: *Runtime, aiming: bool) void {
        setAimMode(&self.camera, aiming);
    }

    /// Emit one instance row's collider into the windowed physics input (floors-first
    /// over two passes: want_solid=false then true). Mirrors buildPhysicsColliders'
    /// per-row decision, but writes straight into the preallocated input buffer.
    fn emitRowCollider(self: *Runtime, row: usize, want_solid: bool, values: []f32, oriented_tmp: []f32, rc: *usize, oc: *usize, hf: *usize, clipped: *usize) void {
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
    fn emitWindowRing(self: *Runtime, grid: *const SpatialGrid, pcx: i32, pcz: i32, ring: i32, want_solid: bool, values: []f32, oriented_tmp: []f32, rc: *usize, oc: *usize, hf: *usize, clipped: *usize) void {
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
                    self.emitRowCollider(grid.items[k], want_solid, values, oriented_tmp, rc, oc, hf, clipped);
                }
            }
        }
    }

    fn emitMeshPropColliders(self: *Runtime, oriented_tmp: []f32, oc: *usize, clipped: *usize) void {
        const mp = self.scene.mesh_props orelse return;
        for (mp.instances) |inst| {
            const mi: usize = @intCast(inst.mesh);
            const isls = if (mi < self.mesh_prop_islands.len) self.mesh_prop_islands[mi] else &[_]MeshIsland{};
            for (isls) |isl| {
                if (oc.* >= game_physics.MAX_ORIENTED) {
                    clipped.* += 1;
                    continue;
                }
                const collider = islandOrientedFloats(inst, isl);
                @memcpy(oriented_tmp[oc.* * game_physics.ORIENTED_FLOATS ..][0..game_physics.ORIENTED_FLOATS], &collider);
                oc.* += 1;
            }
        }
    }

    /// Rebuild the player's near-field collider set from the spatial grid: the
    /// always list (world-spanning floors/walls) plus every local instance in the
    /// window of cells around (center_x, center_z). Floors-first so the ground always
    /// wins the cap. Refills the preallocated physics input in place — no allocation.
    fn rebuildWindow(self: *Runtime, center_x: f32, center_z: f32) void {
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
            self.emitWindowRing(&grid, pc.cx, pc.cz, 0, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            self.emitWindowRing(&grid, pc.cx, pc.cz, 1, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            if (want_solid) self.emitMeshPropColliders(oriented_tmp[0..], &oc, &clipped);
            for (grid.always) |row| self.emitRowCollider(row, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
            var ring: i32 = 2;
            while (ring <= COLLIDER_WINDOW_CELLS) : (ring += 1) {
                self.emitWindowRing(&grid, pc.cx, pc.cz, ring, want_solid, values, oriented_tmp[0..], &rc, &oc, &hf, &clipped);
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
    fn cameraColliderSet(self: *const Runtime) ?PhysicsColliders {
        if (self.camera_colliders) |cam_cols| return cam_cols;
        if (self.has_physics_colliders) return self.physics_colliders;
        return null;
    }

    pub fn stepNow(self: *Runtime) void {
        const ns = nowNs();
        const dt = clamp(@as(f32, @floatFromInt(ns - self.last_ns)) / 1_000_000_000.0, 0.001, 0.05);
        self.last_ns = ns;

        // req_0652: cars advance FIRST so this frame's physics step (and the
        // interact prompts) read the fresh car heights — /test's frame order.
        self.stepElevators(dt);

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
            if (self.windowed) self.rebuildWindow(self.player.x, self.player.z);
            runPlayerPhysics(&self.player, &self.physics_colliders, dt, intent, speed, keyDown(SCAN_SPACE) and !self.camera.external, cfg, self.bodies);
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
        const moving = forceGaitEnv() or (!seated and @sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001);
        const airborne = !seated and (!self.player.grounded or @abs(self.player.vy) > 0.05);
        updatePlayerAnimationClock(&self.player, dt, moving, run_down, airborne);
        self.stepInteract(dt);
        self.stepCookedDoors(dt); // req_1908: swing custom doors toward their target

        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, self.cameraColliderSet(), dt);
        // A FRESH capture pose overrides the clip sampler (req_2786); stale
        // (~3/4s without a push) falls back to clips so a dropped tracker
        // never freezes the body.
        var live_posed = false;
        if (pendingPoseFor(self.node_id)) |lp| {
            if (lp.count == self.scene.player_model.len and lp.age_frames < LIVE_POSE_STALE_FRAMES) {
                updatePlayerModelNodesLive(self.kid_list.items, self.player_first_child, self.scene.player_model, lp.transforms, self.player);
                live_posed = true;
            }
            lp.age_frames +%= 1;
        }
        if (!live_posed) updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, moving, run_down, airborne);
        self.refreshNpcNodes();
        self.updateDynamicPropNodes();
        self.stepTickers(dt);
        self.stepTraffic(dt); // req_2056: drive the ambient vehicles along their baked routes
        if (self.scene.traffic != null) { // [traffic-paths req_2072] P toggles the route ribbon
            const pdown = keyDown(SCAN_P);
            if (pdown and !self.prev_paths_key_down) self.traffic_paths_on = !self.traffic_paths_on;
            self.prev_paths_key_down = pdown;
            self.kid_list.items[self.traffic_path_node].scene3d_instance_count = if (self.traffic_paths_on) self.traffic_path_count else 0;
        }
        // DIRTYRECT: collapse the baked rows inside dirty footprints (once per edit) BEFORE
        // streaming rebuilds its nodes — so the bumped stream_erase_gen reaches THIS frame's
        // streamed static nodes and they re-upload the same frame (no one-frame stale flash).
        self.applyDirtyErase();
        // WALLHIDE req_2053: the editor build pane's "disable walls" — runs AFTER erase (so it
        // sees this frame's restored rows) and BEFORE refreshStreamNodes (so a bumped
        // stream_erase_gen reaches this frame's streamed nodes, like the erase pass).
        self.applyWallHide();
        // Re-stream the world around wherever the player ended up this step
        // (uses the camera solved just above for sight culling).
        self.refreshStreamNodes();
        // LIVEMESH req_1812: re-append the live mesh-prop draws AFTER the stream tail
        // (refreshStreamNodes truncated to stream_tail_start, dropping last frame's), so a
        // just-placed pepes/genmesh prop shows instantly by referencing its resident mesh.
        self.applyLiveMeshProps();
        self.frame += 1;
    }

    /// KICKPROP req_0625 — follow each dynamic prop's live body with its render
    /// parts (mesh anchor = body.y - radius, /test parity); props past the host
    /// body cap stay frozen at their authored anchor. Same composition as the
    /// bake's static path: anchor + yaw-rotated local, part rot + prop yaw.
    fn updateDynamicPropNodes(self: *Runtime) void {
        const dp = self.scene.dynamic_props orelse return;
        var kid = self.dyn_first_child;
        for (dp.props, 0..) |dprop, i| {
            var ax = dprop.x;
            var ay = dprop.y;
            var az = dprop.z;
            if (i < self.bodies.len) {
                const b = self.bodies[i];
                ax = b.x;
                ay = b.y - b.radius;
                az = b.z;
            }
            const part_count = dprop.parts.len / constructor.DYNAMIC_PART_FLOATS;
            var k: usize = 0;
            while (k < part_count) : (k += 1) {
                const row = dprop.parts[k * constructor.DYNAMIC_PART_FLOATS ..];
                const local = rotateYLocal(.{ row[0], row[1], row[2] }, dprop.yaw_degrees);
                const node = &self.kid_list.items[kid];
                node.scene3d_pos_x = ax + local.x;
                node.scene3d_pos_y = ay + local.y;
                node.scene3d_pos_z = az + local.z;
                node.scene3d_rot_x = row[3];
                node.scene3d_rot_y = row[4] + dprop.yaw_degrees;
                node.scene3d_rot_z = row[5];
                kid += 1;
            }
        }
    }

    /// req_0893 #3 — scroll every LED ticker and rebuild its lit-LED instance
    /// bucket in place. Mirrors cart/hmsc-int/compile/propRecipes/ledTicker.ts
    /// ledLitDots: the integer part of the offset selects the source column
    /// (wrapped), the fraction slides the window; lit cells become dot-box
    /// instances at the prop's anchor + yaw. Visual only (no physics), so it runs
    /// even under spatial windowing.
    fn stepTickers(self: *Runtime, dt: f32) void {
        const tk = self.scene.tickers orelse return;
        if (tk.boards.len == 0) return;
        self.ticker_seconds += dt;
        for (tk.boards, 0..) |board, ti| {
            const buf = self.ticker_buffers[ti];
            const n_cols = board.columns.len;
            var count: u32 = 0;
            if (n_cols > 0) {
                const offset = self.ticker_seconds * board.scroll_cols_per_sec;
                const base: i64 = @intFromFloat(@floor(offset));
                const frac = offset - @floor(offset);
                const half_w = -board.face_left; // face_left is negative
                const max_dots: u32 = @intCast(buf.len / INSTANCE_STRIDE);
                const m: i64 = @intCast(n_cols);
                var vc: u32 = 0;
                while (vc <= board.window_cols) : (vc += 1) {
                    const src: usize = @intCast(@mod(base + @as(i64, @intCast(vc)), m));
                    const mask = board.columns[src];
                    if (mask == 0) continue;
                    const cell_x = board.face_left + (@as(f32, @floatFromInt(vc)) - frac + 0.5) * board.cell;
                    if (cell_x < board.face_left - board.cell * 0.5 or cell_x > half_w + board.cell * 0.5) continue;
                    var r: u32 = 0;
                    while (r < board.rows) : (r += 1) {
                        if ((mask & (@as(u8, 1) << @as(u3, @intCast(r)))) == 0) continue;
                        if (count >= max_dots) break;
                        const ly = board.face_top - (@as(f32, @floatFromInt(r)) + 0.5) * board.cell;
                        const local = rotateYLocal(.{ cell_x, ly, board.face_z }, board.yaw_degrees);
                        const o = @as(usize, count) * INSTANCE_STRIDE;
                        buf[o + 0] = board.x + local.x;
                        buf[o + 1] = board.y + local.y;
                        buf[o + 2] = board.z + local.z;
                        buf[o + 3] = 0;
                        buf[o + 4] = board.yaw_degrees;
                        buf[o + 5] = 0;
                        buf[o + 6] = board.dot_size;
                        buf[o + 7] = board.dot_size;
                        buf[o + 8] = board.dot_size;
                        buf[o + 9] = board.color[0];
                        buf[o + 10] = board.color[1];
                        buf[o + 11] = board.color[2];
                        count += 1;
                    }
                }
            }
            self.kid_list.items[self.ticker_first_child + ti].scene3d_instance_count = count;
        }
    }

    /// Ambient road traffic (req_2056): advance every vehicle along its baked
    /// route (arc-length = speed*t + phase, wrapped to the loop length) and
    /// rebuild the three mutable instance buffers at the sampled pose. Each part
    /// prototype row is rotated about the agent by its heading and lifted onto the
    /// terrain under it — the LED-ticker mutable-instance pattern, one bucket per
    /// shape. No allocation in the hot path.
    fn stepTraffic(self: *Runtime, dt: f32) void {
        const tr = self.scene.traffic orelse return;
        if (tr.vehicles.len == 0) return;
        self.traffic_seconds += dt;
        var box_n: u32 = 0;
        var cyl_n: u32 = 0;
        var sph_n: u32 = 0;
        const box_cap: u32 = @intCast(self.traffic_box_buf.len / INSTANCE_STRIDE);
        const cyl_cap: u32 = @intCast(self.traffic_cyl_buf.len / INSTANCE_STRIDE);
        const sph_cap: u32 = @intCast(self.traffic_sphere_buf.len / INSTANCE_STRIDE);
        for (tr.vehicles) |veh| {
            if (veh.length <= 1.0e-4 or veh.route.len < 4) continue;
            const s = @mod(self.traffic_seconds * veh.speed + veh.phase, veh.length);
            const pose = sampleRoute(veh.route, s);
            // The vehicle model's FRONT is -Z (hood/headlights at -halfLength), so face
            // travel by rotating the whole body 180° past the raw heading.
            const heading = pose.heading_deg + 180;
            const ground = sceneTerrainTopAt(self.scene.heightfields, pose.x, pose.z) orelse 0;
            var ri: usize = 0;
            while (ri + TRAFFIC_PROTO_STRIDE <= veh.rows.len) : (ri += TRAFFIC_PROTO_STRIDE) {
                const r = veh.rows[ri .. ri + TRAFFIC_PROTO_STRIDE];
                const shape = r[12];
                const local = rotateYLocal(.{ r[0], r[1], r[2] }, heading);
                var buf: []f32 = undefined;
                var slot: u32 = undefined;
                if (@abs(shape - SHAPE_CYLINDER16) < 0.5) {
                    if (cyl_n >= cyl_cap) continue;
                    buf = self.traffic_cyl_buf;
                    slot = cyl_n;
                    cyl_n += 1;
                } else if (@abs(shape - SHAPE_SPHERE) < 0.5) {
                    if (sph_n >= sph_cap) continue;
                    buf = self.traffic_sphere_buf;
                    slot = sph_n;
                    sph_n += 1;
                } else {
                    if (box_n >= box_cap) continue;
                    buf = self.traffic_box_buf;
                    slot = box_n;
                    box_n += 1;
                }
                const o = @as(usize, slot) * INSTANCE_STRIDE;
                buf[o + 0] = pose.x + local.x;
                buf[o + 1] = ground + local.y;
                buf[o + 2] = pose.z + local.z;
                buf[o + 3] = r[3];
                buf[o + 4] = r[4] + heading;
                buf[o + 5] = r[5];
                buf[o + 6] = r[6];
                buf[o + 7] = r[7];
                buf[o + 8] = r[8];
                buf[o + 9] = r[9];
                buf[o + 10] = r[10];
                buf[o + 11] = r[11];
            }
        }
        self.kid_list.items[self.traffic_first_child + 0].scene3d_instance_count = box_n;
        self.kid_list.items[self.traffic_first_child + 1].scene3d_instance_count = cyl_n;
        self.kid_list.items[self.traffic_first_child + 2].scene3d_instance_count = sph_n;
        // [traffic-diag req_2056] RJIT_TRAFFICLOG=1 prints the emit counts + vehicle 0's
        // first box row (world pos/scale/color) ONCE, mid-capture — proves the per-frame
        // transform produces sane, colored, sized instances.
        if (self.frame == 5 and std.posix.getenv("RJIT_TRAFFICLOG") != null) {
            log.print("[traffic] frame5 emit box={d} cyl={d} sph={d}\n", .{ box_n, cyl_n, sph_n });
            if (box_n > 0) {
                const o: usize = 0;
                log.print("[traffic] v0 box0 pos=({d:.1},{d:.1},{d:.1}) scale=({d:.2},{d:.2},{d:.2}) color=({d:.2},{d:.2},{d:.2}) ry={d:.0}\n", .{
                    self.traffic_box_buf[o + 0], self.traffic_box_buf[o + 1],  self.traffic_box_buf[o + 2],
                    self.traffic_box_buf[o + 6], self.traffic_box_buf[o + 7],  self.traffic_box_buf[o + 8],
                    self.traffic_box_buf[o + 9], self.traffic_box_buf[o + 10], self.traffic_box_buf[o + 11],
                    self.traffic_box_buf[o + 4],
                });
            }
        }
    }

    /// req_0652 — /test's elevator ride, native: advance every car toward its
    /// target stop and re-aim its LIVE rect in the physics buffer IN PLACE
    /// (the step reads this buffer every frame, so the rising top carries the
    /// standing player); the car's render node follows. No-op without cars;
    /// skipped under spatial windowing (that path re-derives its buffer from
    /// render instances per frame, which carries no cars).
    fn stepElevators(self: *Runtime, dt: f32) void {
        if (self.cars.len == 0 or self.windowed) return;
        const el = self.scene.elevators orelse return;
        const base = self.physics_colliders.rectBase() + self.physics_colliders.car_rect_start * game_physics.RECT_FLOATS;
        for (self.cars, 0..) |*car, i| {
            const shaft = el.shafts[i];
            const delta = car.target_y - car.car_y;
            if (@abs(delta) > ELEVATOR_ARRIVE_TOLERANCE_METERS) {
                const step_m = @max(0.01, shaft.car_speed) * dt;
                car.car_y = if (@abs(delta) <= step_m) car.target_y else car.car_y + std.math.sign(delta) * step_m;
            }
            const at = base + i * game_physics.RECT_FLOATS;
            self.physics_colliders.values[at + 4] = car.car_y + shaft.car_thickness; // top
            self.physics_colliders.values[at + 8] = car.car_y; // floor
            const node = &self.kid_list.items[self.car_first_child + i];
            node.scene3d_pos_x = shaft.x;
            node.scene3d_pos_y = car.car_y + shaft.car_thickness / 2;
            node.scene3d_pos_z = shaft.z;
        }
    }

    /// DOORS-0611 — flip one door's two-state machine: the live rect stops or
    /// resumes blocking (blocksPlayer float, read by the step every frame)
    /// and the panel node drops out of sight / returns. Instant, /test parity
    /// (pieceDoorSet re-materializes the panel the same way).
    fn toggleDoor(self: *Runtime, index: usize) void {
        const doors = self.scene.doors orelse return;
        const record = doors.records[index];
        const open = !self.doors_state[index].open;
        self.doors_state[index].open = open;
        // The rect PARKS out of the world while open (see DOOR_OPEN_PARK_METERS:
        // a non-solid rect taller than step height still side-pushes — that
        // de-flag-only first cut was req_0663's unwalkable open door).
        const at = self.physics_colliders.rectBase() + (self.physics_colliders.door_rect_start + index) * game_physics.RECT_FLOATS;
        const half = doorHalfExtents(record);
        const park: f32 = if (open) DOOR_OPEN_PARK_METERS else 0;
        self.physics_colliders.values[at + 0] = record.x - half[0] + park; // minX
        self.physics_colliders.values[at + 1] = record.z - half[1] + park; // minZ
        self.physics_colliders.values[at + 2] = record.x + half[0] + park; // maxX
        self.physics_colliders.values[at + 3] = record.z + half[1] + park; // maxZ
        self.physics_colliders.values[at + 5] = if (open) 0 else 1; // blocksPlayer
        const node = &self.kid_list.items[self.door_first_child + index];
        const hide: f32 = if (open) DOOR_OPEN_HIDE_DROP_METERS else 0;
        node.scene3d_pos_y = record.base_y + record.panel_h / 2 - hide;
    }

    /// req_1864/req_1908 — flip a cooked door's TARGET; stepCookedDoors swings the
    /// leaf about its hinge toward the new target (open/closed) over openSeconds.
    fn toggleCookedDoor(self: *Runtime, index: usize) void {
        if (index >= self.cooked_doors.len) return;
        self.cooked_doors[index].open = !self.cooked_doors[index].open;
    }

    /// req_1908 — advance every cooked door's swing: ease `progress` toward the
    /// target, rotate the leaf NODE about its world hinge by `progress * arc`, and
    /// clear/raise its collision rect once it's past half-open (walk through the
    /// swinging door). The pivot keeps the hinge edge fixed: a leaf vert at world
    /// closed-pos rotates about the hinge, so node_pos = hinge + Ry(theta)*(inst-hinge)
    /// and node_rot_y = inst_yaw + theta.
    fn stepCookedDoors(self: *Runtime, dt: f32) void {
        if (self.cooked_doors.len == 0) return;
        const rate = dt / COOKED_DOOR_OPEN_SECONDS;
        for (self.cooked_doors) |*cd| {
            const target: f32 = if (cd.open) 1.0 else 0.0;
            if (cd.progress < target) {
                cd.progress = @min(target, cd.progress + rate);
            } else if (cd.progress > target) {
                cd.progress = @max(target, cd.progress - rate);
            }
            const theta_deg = cd.progress * COOKED_DOOR_SWING_ARC_DEGREES;
            const theta = theta_deg * std.math.pi / 180.0;
            const ct = @cos(theta);
            const st = @sin(theta);
            const dx = cd.node_x - cd.hinge_x;
            const dz = cd.node_z - cd.hinge_z;
            // The leaf nodes (opaque frame + glass pane, req_2020) share one instance
            // pose, so the SAME hinge swing applies to each: node_pos = hinge +
            // Ry(theta)*(inst-hinge), Ry matching the engine's m4rotateY
            // (x'=x·c+z·s, z'=-x·s+z·c) so the hinge edge stays fixed.
            const swung_x = cd.hinge_x + (dx * ct + dz * st);
            const swung_z = cd.hinge_z + (-dx * st + dz * ct);
            var ni: usize = 0;
            while (ni < cd.node_child_count) : (ni += 1) {
                const idx = cd.node_child_first + ni;
                if (idx >= self.kid_list.items.len) break;
                const node = &self.kid_list.items[idx];
                node.scene3d_pos_x = swung_x;
                node.scene3d_pos_z = swung_z;
                node.scene3d_pos_y = cd.node_base_y;
                node.scene3d_rot_y = cd.yaw_degrees + theta_deg;
            }
            // req_1960: the leaf is a PHYSICAL object — its rect TRACKS the swinging
            // panel every frame (always solid), so the sweeping door shoves the player
            // out of the way (like the elevator car carries a standing player) instead
            // of passing through. The swung world AABB: center pivots about the hinge,
            // half-extents fold by the leaf's TOTAL angle (yaw + swing). Fully open the
            // panel lies along the jamb, leaving the doorway clear.
            const at = self.physics_colliders.rectBase() + cd.rect_index * game_physics.RECT_FLOATS;
            if (at + game_physics.RECT_FLOATS <= self.physics_colliders.values.len and cd.rect_index < self.physics_colliders.rect_count) {
                const ddx = cd.cx - cd.hinge_x;
                const ddz = cd.cz - cd.hinge_z;
                const scx = cd.hinge_x + (ddx * ct + ddz * st);
                const scz = cd.hinge_z + (-ddx * st + ddz * ct);
                const total = cd.yaw_degrees * std.math.pi / 180.0 + theta;
                const tc = @abs(@cos(total));
                const ts = @abs(@sin(total));
                const hxw = tc * cd.half_w_local + ts * cd.half_d_local;
                const hzw = ts * cd.half_w_local + tc * cd.half_d_local;
                self.physics_colliders.values[at + 0] = scx - hxw;
                self.physics_colliders.values[at + 1] = scz - hzw;
                self.physics_colliders.values[at + 2] = scx + hxw;
                self.physics_colliders.values[at + 3] = scz + hzw;
                self.physics_colliders.values[at + 5] = 1; // always solid — a real door
            }
        }
    }

    /// req_0674 — true when a thin solid collider (wall slab, closed door
    /// panel, window strip) crosses the segment from the player's chest line
    /// to the candidate. Open doors dropped their solid flag in setDoorOpen,
    /// so they pass; a box containing the target itself (the aimed door's own
    /// panel) is skipped inside the query.
    fn interactReachBlocked(self: *Runtime, target_x: f32, target_y: f32, target_z: f32) bool {
        if (!self.has_physics_colliders) return false;
        const colliders = &self.physics_colliders;
        if (colliders.rect_count == 0 and colliders.oriented_count == 0) return false;
        return game_physics.reachBlockedStepColliders(
            colliders.values[colliders.entity_capacity * game_physics.ENTITY_FLOATS ..],
            colliders.rect_count,
            colliders.oriented_count,
            self.player.x,
            self.player.y + INTERACT_EYE_HEIGHT_METERS,
            self.player.z,
            target_x,
            target_y,
            target_z,
            INTERACT_BLOCKER_MAX_THICKNESS_METERS,
        );
    }

    /// PROPUSE req_0624 — /test's interact frame, native: resolve the nearest
    /// seat/container in reach over the INTERACTABLES lump, run the prompt /
    /// E edge / search timer, pin the seat pose. Mirrors PlayRoute.tsx
    /// interactFrame semantics (reach, cancel radius, prompt grammar).
    /// req_0652 adds the elevator: standing ON the car E rides to the next
    /// stop (wrapping down from the top); at a landing with the car elsewhere
    /// E calls it — props in reach win the E first, /test's priority.
    fn stepInteract(self: *Runtime, dt: f32) void {
        const st = &self.interact;
        if (st.notice_left > 0) st.notice_left = @max(0, st.notice_left - dt);
        st.prompt_len = 0;
        st.bar_progress = -1;
        // props are optional (the INTERACTABLES lump) and so are elevators
        // (the ELEVATORS lump) — either alone keeps the frame alive (req_0652).
        const ia_opt = self.scene.interactables;
        const has_props = if (ia_opt) |ia| ia.instances.len > 0 else false;
        if (!has_props and self.cars.len == 0 and self.doors_state.len == 0 and self.cooked_doors.len == 0) return;

        // 1. advance / cancel / finish an active search (props only)
        if (st.search_active) {
            const ia = ia_opt.?;
            const arch = ia.archetypes[ia.instances[st.search_instance].archetype];
            const adx = self.player.x - st.search_anchor_x;
            const adz = self.player.z - st.search_anchor_z;
            const moved_away = @sqrt(adx * adx + adz * adz) > INTERACT_SEARCH_CANCEL_MOVE_METERS;
            st.search_elapsed += dt;
            if (moved_away) {
                st.search_active = false;
                st.postNotice("Search interrupted", .{});
            } else if (st.search_elapsed >= arch.search_seconds) {
                st.search_active = false;
                st.searched[st.search_instance] = true;
                st.postNotice("Searched the {s} — empty for now ({s} loot lands with the item system)", .{ arch.label, arch.loot_category });
            } else {
                st.bar_progress = clamp(st.search_elapsed / @max(0.001, arch.search_seconds), 0, 1);
                st.setPrompt("Searching the {s}...", .{arch.label});
            }
        }

        // 2. resolve the nearest interactable in reach
        var target: ?usize = null;
        if (self.player.posture != .none) {
            st.setPrompt("WASD / Space — stand up", .{});
        } else if (!st.search_active and has_props) {
            const ia = ia_opt.?;
            var best_distance: f32 = INTERACT_REACH_METERS;
            for (ia.instances, 0..) |inst, i| {
                if (@abs(inst.y - self.player.y) > INTERACT_Y_WINDOW_METERS) continue;
                const dx = inst.x - self.player.x;
                const dz = inst.z - self.player.z;
                const distance = @sqrt(dx * dx + dz * dz);
                if (distance > best_distance) continue;
                // req_0674: within arm's length is not enough — a wall between
                // the player and the prop kills its E (fridge on the far side).
                if (self.interactReachBlocked(inst.x, inst.y + INTERACT_PROP_AIM_HEIGHT_METERS, inst.z)) continue;
                best_distance = distance;
                target = i;
            }
            if (target) |i| {
                const arch = ia.archetypes[ia.instances[i].archetype];
                if (arch.has_container) {
                    if (st.searched[i]) {
                        st.setPrompt("{s} — already searched", .{arch.label});
                    } else if (arch.access != 0) {
                        st.setPrompt("{s} — locked (needs a key)", .{arch.label});
                    } else {
                        st.setPrompt("E — search the {s}", .{arch.label});
                    }
                } else if (arch.has_seat) {
                    if (arch.seat_pose == 1) {
                        st.setPrompt("E — lie down on the {s}", .{arch.label});
                    } else {
                        st.setPrompt("E — sit on the {s}", .{arch.label});
                    }
                }
            }
        }

        // 2a-doors (DOORS-0611) — the nearest door leaf in ITS OWN reach wins
        // the E when no prop claimed the prompt (/test's priority: things in
        // reach beat the elevator call).
        var door_target: ?usize = null;
        if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.doors_state.len > 0) {
            const doors = self.scene.doors.?;
            var best_distance: f32 = std.math.floatMax(f32);
            for (self.doors_state, 0..) |_, i| {
                const record = doors.records[i];
                if (@abs(record.base_y - self.player.y) > DOOR_Y_WINDOW_METERS) continue;
                const dx = record.x - self.player.x;
                const dz = record.z - self.player.z;
                const distance = @sqrt(dx * dx + dz * dz);
                if (distance > record.reach or distance > best_distance) continue;
                // req_0674: a door behind ANOTHER wall must not offer its E;
                // the aimed door's own panel is skipped inside the query.
                if (self.interactReachBlocked(record.x, record.base_y + record.panel_h / 2, record.z)) continue;
                best_distance = distance;
                door_target = i;
            }
            if (door_target) |i| {
                const record = doors.records[i];
                const label: []const u8 = if (record.vehicle) "garage door" else "door";
                if (self.doors_state[i].open) {
                    st.setPrompt("E — close the {s}", .{label});
                } else {
                    st.setPrompt("E — open the {s}", .{label});
                }
            }
        }

        // 2a-cooked (req_1864) — custom doors compiled from a Studio model. Same
        // nearest-in-reach rule + prompt grammar as the built-in doors; only when
        // a built-in door hasn't already claimed the prompt.
        var cooked_door_target: ?usize = null;
        if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.cooked_doors.len > 0) {
            var best_distance: f32 = std.math.floatMax(f32);
            for (self.cooked_doors, 0..) |cd, i| {
                if (@abs(cd.base_y - self.player.y) > DOOR_Y_WINDOW_METERS) continue;
                const dx = cd.cx - self.player.x;
                const dz = cd.cz - self.player.z;
                const distance = @sqrt(dx * dx + dz * dz);
                if (distance > cd.reach or distance > best_distance) continue;
                if (self.interactReachBlocked(cd.cx, cd.base_y + cd.panel_h / 2, cd.cz)) continue;
                best_distance = distance;
                cooked_door_target = i;
            }
            if (cooked_door_target) |i| {
                const cd = self.cooked_doors[i];
                const label: []const u8 = if (cd.vehicle) "garage door" else "door";
                if (cd.open) {
                    st.setPrompt("E — close the {s}", .{label});
                } else {
                    st.setPrompt("E — open the {s}", .{label});
                }
            }
        }

        // 2b. the elevator (req_0652) — only when no prop claimed the prompt
        // (/test's priority: doors/props in reach win the E first).
        var elevator_ride: ?struct { index: usize, to_y: f32 } = null;
        if (self.player.posture == .none and !st.search_active and st.prompt_len == 0 and self.cars.len > 0) {
            const el = self.scene.elevators.?;
            for (self.cars, 0..) |car, i| {
                const shaft = el.shafts[i];
                const inside = @abs(self.player.x - shaft.x) <= shaft.module_half_x and @abs(self.player.z - shaft.z) <= shaft.module_half_z;
                const car_moving = @abs(car.target_y - car.car_y) > ELEVATOR_ARRIVE_TOLERANCE_METERS;
                if (inside and car_moving) {
                    st.setPrompt("Elevator moving...", .{});
                    break;
                }
                const car_top = car.car_y + shaft.car_thickness;
                const on_car = inside and self.player.y >= car.car_y - ELEVATOR_BOARD_BELOW_METERS and self.player.y <= car_top + ELEVATOR_BOARD_REACH_METERS;
                if (on_car) {
                    if (nextElevatorStop(shaft.stops, car.car_y)) |next| {
                        elevator_ride = .{ .index = i, .to_y = next };
                        const floor_number = elevatorStopIndex(shaft.stops, next) + 1;
                        if (next > car.car_y) {
                            st.setPrompt("E — elevator up to floor {d}", .{floor_number});
                        } else {
                            st.setPrompt("E — elevator down to floor {d}", .{floor_number});
                        }
                    } else {
                        st.setPrompt("Elevator — one stop (stack more storeys for more floors)", .{});
                    }
                    break;
                }
                if (car_moving) continue;
                const dx = shaft.x - self.player.x;
                const dz = shaft.z - self.player.z;
                if (@sqrt(dx * dx + dz * dz) > ELEVATOR_CALL_REACH_METERS) continue;
                const stop = nearestElevatorStop(shaft.stops, self.player.y);
                if (@abs(self.player.y - stop) > ELEVATOR_BOARD_REACH_METERS) continue;
                if (@abs(car.car_y - stop) <= ELEVATOR_ARRIVE_TOLERANCE_METERS) continue;
                elevator_ride = .{ .index = i, .to_y = stop };
                st.setPrompt("E — call the elevator", .{});
                break;
            }
        }

        // 3. the E edge
        const down = keyDown(SCAN_E);
        const pressed = down and !st.prev_e_down;
        st.prev_e_down = down;
        if (!pressed or st.search_active or self.player.posture != .none) return;
        if (door_target) |i| {
            self.toggleDoor(i);
            return;
        }
        if (cooked_door_target) |i| {
            self.toggleCookedDoor(i);
            return;
        }
        if (elevator_ride) |ride| {
            self.cars[ride.index].target_y = ride.to_y;
            return;
        }
        const i = target orelse return;
        const ia = ia_opt.?;
        const inst = ia.instances[i];
        const arch = ia.archetypes[inst.archetype];
        if (arch.has_container) {
            if (st.searched[i]) {
                st.postNotice("Nothing left in there", .{});
            } else if (arch.access != 0) {
                st.postNotice("The {s} is locked — needs a key", .{arch.label});
            } else {
                st.search_active = true;
                st.search_instance = i;
                st.search_elapsed = 0;
                st.search_anchor_x = self.player.x;
                st.search_anchor_z = self.player.z;
                st.bar_progress = 0;
            }
            return;
        }
        if (!arch.has_seat) return;
        // seat: pin the player to the prop (/test adoptPose parity: position =
        // the prop anchor, velocity zeroed, facing = the prop's yaw); stepNow's
        // stand-up edge owns the exit. The render path adds 180° to player.yaw
        // (updatePlayerModelNodes model_yaw_degrees), so bake the prop's yaw
        // MINUS 180 into the state — the figure then faces the prop's own way
        // instead of sitting backwards (USER report 2026-06-11).
        self.player.x = inst.x;
        self.player.y = inst.y;
        self.player.z = inst.z;
        self.player.vx = 0;
        self.player.vy = 0;
        self.player.vz = 0;
        self.player.yaw = (inst.yaw_degrees - 180.0) * std.math.pi / 180.0;
        self.player.grounded = true;
        self.player.posture = if (arch.seat_pose == 1) .lay else .sit;
    }

    /// PROPUSE req_0624 — /test's InteractOverlay, native: the bottom-center
    /// prompt pill / search loading bar / notice, drawn through the engine's
    /// 2D batches right after the world quad is queued. Image quads record
    /// segment boundaries, so these composite ON TOP of the world in both the
    /// embedded /compiled route and the standalone window. Text no-ops when no
    /// font face is initialized (drawTextLine guards); the bar still draws.
    fn drawHud(self: *Runtime, x: f32, y: f32, w: f32, h: f32) void {
        const st = &self.interact;
        const has_bar = st.bar_progress >= 0;
        const has_prompt = st.prompt_len > 0;
        const has_notice = st.notice_left > 0 and st.notice_len > 0;
        if (!has_bar and !has_prompt and !has_notice) return;
        // /test anchors the overlay column 96px above the pane bottom.
        const cx = x + w / 2;
        const bar_block: f32 = 15 + 4 + 10;
        const prompt_block: f32 = 25;
        const notice_block: f32 = 22;
        var total: f32 = 0;
        if (has_bar) total += bar_block else if (has_prompt) total += prompt_block;
        if (has_notice) total += if (total > 0) 6 + notice_block else notice_block;
        var cy = y + h - 96 - total;
        if (has_bar) {
            // "Searching the X..." label over the 260x10 track + sky-blue fill.
            const label = st.prompt();
            const lw = gpu.measureTextLineWidth(label, 11);
            gpu.drawTextLine(label, cx - lw / 2, cy, 11, 0.886, 0.910, 0.941, 1);
            cy += 15 + 4;
            gpu.drawRect(cx - 130, cy, 260, 10, 0.059, 0.102, 0.180, 0.8, 5, 1, 0.2, 0.255, 0.333, 1);
            const fill_w: f32 = @max(4, @round(258 * st.bar_progress));
            gpu.drawRect(cx - 129, cy + 1, fill_w, 8, 0.22, 0.741, 0.973, 1, 4, 0, 0, 0, 0, 0);
            cy += 10 + 6;
        } else if (has_prompt) {
            const label = st.prompt();
            const lw = gpu.measureTextLineWidth(label, 11);
            gpu.drawRect(cx - lw / 2 - 12, cy, lw + 24, prompt_block, 0.059, 0.102, 0.180, 0.8, 6, 1, 0.2, 0.255, 0.333, 1);
            gpu.drawTextLine(label, cx - lw / 2, cy + 5, 11, 0.886, 0.910, 0.941, 1);
            cy += prompt_block + 6;
        }
        if (has_notice) {
            const label = st.notice();
            const lw = gpu.measureTextLineWidth(label, 10);
            gpu.drawRect(cx - lw / 2 - 12, cy, lw + 24, notice_block, 0.090, 0.145, 0.329, 0.8, 6, 0, 0, 0, 0, 0);
            gpu.drawTextLine(label, cx - lw / 2, cy + 4, 10, 0.749, 0.859, 0.996, 1);
        }
    }

    pub fn sceneNodeForFrame(self: *Runtime) *Node {
        self.stepNow();
        return &self.root;
    }

    pub fn statusAlloc(self: *const Runtime, allocator: std.mem.Allocator) ![]u8 {
        if (self.stream) |*w| {
            return std.fmt.allocPrint(
                allocator,
                "loaded {d} instances ({d} pieces), {d} player mesh groups; streaming {d}x{d} grid ({d} occupied), lod {d} rows, {d} draws",
                .{ self.inst_count, self.piece_count, self.scene.player_model.len, w.cols, w.rows, w.stats.occupied_chunks, w.stats.lod_rows, self.stream_draw_count },
            );
        }
        return std.fmt.allocPrint(
            allocator,
            "loaded {d} instances ({d} pieces), {d} player mesh groups",
            .{ self.inst_count, self.piece_count, self.scene.player_model.len },
        );
    }
};

const MountedLoader = struct {
    active: bool = false,
    runtime: ?*Runtime = null,
};

var g_mounted_loaders: [MAX_EMBEDDED_LOADERS]MountedLoader = [_]MountedLoader{.{}} ** MAX_EMBEDDED_LOADERS;

// External-camera pending table (LOADERVIEW req_1757): keyed by node id, INDEPENDENT of
// mount state (findMounted needs a live runtime, but the editor pushes a pose before the
// lazy first-render mount). applyPendingCam runs every renderEmbedded frame, so the iso
// pose survives the mount and Compile remounts with no JS frame loop (headless has no rAF).
const PendingCam = struct {
    node_id: u32 = 0,
    set: bool = false,
    pos: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    look: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    fov: f32 = CAMERA_FOV_DEGREES,
};
var g_pending_cams: [MAX_EMBEDDED_LOADERS]PendingCam = [_]PendingCam{.{}} ** MAX_EMBEDDED_LOADERS;

// Live physics-globals override (GLOBALS req_2770): the editor's Globals → Physics
// panel pushes the SAME 13 floats the PHYSICS_CONFIG lump bakes (order:
// gravity, jumpSpeed, playerRadius, playerHeight, stepHeight, wallRestitution,
// bodyRestitution, walkableSidePushGrace, accelMult, surfaceFriction,
// surfaceRestitution, walkSpeed, runSpeed — the encodePhysicsConfigLump layout),
// and the mounted runtime's NEXT physics step reads them. Keyed by node id and
// INDEPENDENT of mount state (same reason as PendingCam), applied each
// renderEmbedded frame; `on = false` reverts to the baked lump / built-ins.
pub const PHYSICS_CONFIG_FLOATS: usize = 13;
const PendingPhysics = struct {
    node_id: u32 = 0,
    set: bool = false,
    on: bool = false,
    values: [PHYSICS_CONFIG_FLOATS]f32 = @splat(0),
    gen: u64 = 0,
};
var g_pending_physics: [MAX_EMBEDDED_LOADERS]PendingPhysics = [_]PendingPhysics{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingPhysicsFor(node_id: u32) ?*PendingPhysics {
    for (&g_pending_physics) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live physics override for a node (GLOBALS req_2770). `bytes` is the raw
/// Float32Array backing (13 floats, lump order); we copy so the JS array can be freed.
/// Short/oversized payloads are rejected loudly — a wrong pack is a bug, not a default.
pub fn setPhysicsConfig(node_id: u32, bytes: []const u8) bool {
    if (bytes.len < PHYSICS_CONFIG_FLOATS * 4) {
        log.print("[loader] physics override rejected: {d} bytes (need {d})\n", .{ bytes.len, PHYSICS_CONFIG_FLOATS * 4 });
        return false;
    }
    var slot: ?*PendingPhysics = pendingPhysicsFor(node_id);
    if (slot == null) {
        for (&g_pending_physics) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return false;
    p.node_id = node_id;
    p.set = true;
    p.on = true;
    @memcpy(std.mem.sliceAsBytes(p.values[0..]), bytes[0 .. PHYSICS_CONFIG_FLOATS * 4]);
    p.gen +%= 1;
    return true;
}

/// Drop the live physics override for a node — the next step reads the baked
/// PHYSICS_CONFIG lump again (or the loader built-ins on a pre-lump/blank world).
pub fn clearPhysicsConfig(node_id: u32) void {
    const p = pendingPhysicsFor(node_id) orelse return;
    p.on = false;
    p.gen +%= 1;
}

// Copy the node's pending physics override into the runtime (gen-guarded, so a
// still panel costs nothing per frame). Field order = the lump order above.
fn applyPendingPhysics(runtime: *Runtime) void {
    const p = pendingPhysicsFor(runtime.node_id) orelse return;
    if (runtime.physics_override_gen == p.gen) return;
    runtime.physics_override = if (p.on) constructor.PhysicsConfig{
        .gravity = p.values[0],
        .jump_speed = p.values[1],
        .player_radius = p.values[2],
        .player_height = p.values[3],
        .step_height = p.values[4],
        .wall_restitution = p.values[5],
        .body_restitution = p.values[6],
        .walkable_side_push_grace = p.values[7],
        .accel_mult = p.values[8],
        .surface_friction = p.values[9],
        .surface_restitution = p.values[10],
        .walk_speed = p.values[11],
        .run_speed = p.values[12],
    } else null;
    runtime.physics_override_gen = p.gen;
}

// Live-pieces overlay (LIVEHOST req_1798): the editor pushes instance rows for pieces
// it has placed-but-not-yet-baked, and the loader draws them as real solid box meshes
// THIS frame — no rebake. Keyed by node id and INDEPENDENT of mount state (same reason
// as PendingCam: the push can arrive before the lazy first-render mount), applied each
// renderEmbedded. `gen` bumps on every set so a mounted runtime re-copies only on change.
// Owns its `rows` allocation (page_allocator), grown on demand and freed on clear/replace.
const PendingLive = struct {
    node_id: u32 = 0,
    set: bool = false,
    rows: []f32 = &.{}, // 12-stride instance rows (cx,cy,cz, 0,yaw,0, sx,sy,sz, r,g,b)
    count: usize = 0, // instance count (rows.len / INSTANCE_STRIDE)
    gen: u64 = 0,
};
var g_pending_live: [MAX_EMBEDDED_LOADERS]PendingLive = [_]PendingLive{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingLiveFor(node_id: u32) ?*PendingLive {
    for (&g_pending_live) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live overlay rows for a node (LIVEHOST req_1798). `bytes` is the raw
/// Float32Array backing (12 floats per instance); we own a copy so the JS array can be
/// freed. Bumps gen so applyPendingLive re-uploads on the next frame.
pub fn setLivePieces(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingLive = pendingLiveFor(node_id);
    if (slot == null) {
        for (&g_pending_live) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const float_count = bytes.len / 4;
    const new_rows = alloc.alloc(f32, float_count) catch return;
    @memcpy(std.mem.sliceAsBytes(new_rows), bytes[0 .. float_count * 4]);
    if (p.rows.len > 0) alloc.free(p.rows);
    p.node_id = node_id;
    p.set = true;
    p.rows = new_rows;
    p.count = float_count / INSTANCE_STRIDE;
    p.gen +%= 1;
}

/// Drop the live overlay for a node (after a bake reload folds the pieces into the
/// baked world). Keeps the slot so gen keeps advancing; frees the row allocation.
pub fn clearLivePieces(node_id: u32) void {
    const p = pendingLiveFor(node_id) orelse return;
    if (p.rows.len > 0) std.heap.page_allocator.free(p.rows);
    p.rows = &.{};
    p.count = 0;
    p.gen +%= 1;
}

// ── live editor MESH-prop overlay (LIVEMESH req_1812) ───────────────────────
// FNV-1a 32-bit over the mesh key's bytes — MUST match the JS fnv1a in pieceMeshes.tsx
// so a kind's key hashes the same on both sides (keys are ASCII content hashes / ids).
fn liveMeshHash(key: []const u8) u32 {
    var h: u32 = 2166136261;
    for (key) |b| {
        h ^= b;
        h *%= 16777619;
    }
    return h;
}

// RESKIN req_1845: a position+mesh identity for matching a live re-skin ref to the baked
// instance it replaces. The live ref and the baked instance carry the SAME authored x/z/yaw
// (a re-skin doesn't move the prop), so quantizing to mm / 0.01° matches them exactly.
fn meshPosKey(mesh_index: usize, x: f32, z: f32, yaw: f32) u64 {
    const xi: i64 = @intFromFloat(@round(x * 1000.0));
    const zi: i64 = @intFromFloat(@round(z * 1000.0));
    const yi: i64 = @intFromFloat(@round(yaw * 100.0));
    var h: u64 = 1469598103934665603;
    h = (h ^ @as(u64, @intCast(mesh_index & 0xffff))) *% 1099511628211;
    h = (h ^ @as(u64, @bitCast(xi))) *% 1099511628211;
    h = (h ^ @as(u64, @bitCast(zi))) *% 1099511628211;
    h = (h ^ @as(u64, @bitCast(yi))) *% 1099511628211;
    return h;
}

// A live mesh-prop ref: a resident-mesh key-hash + transform + per-slot material hashes
// (req_2025). `mats[i]` is the live material for loader texture slot i (0 = that slot wears
// the mesh's own baked atlas); an empty `mats` = the whole mesh on its baked texture (ghost /
// brand-new unskinned placement). Trailing loader slots beyond mats.len (glass/leaf) read 0.
const LiveMeshRef = struct { hash: u32, x: f32, y: f32, z: f32, yaw: f32, mats: []u32 = &.{} };
const LIVE_MESH_HEADER_BYTES: usize = 24; // u32 keyHash + 4×f32 + u32 matCount, then matCount×u32
const PendingLiveMesh = struct {
    node_id: u32 = 0,
    set: bool = false,
    refs: []LiveMeshRef = &.{},
    gen: u64 = 0,
};
var g_pending_live_mesh: [MAX_EMBEDDED_LOADERS]PendingLiveMesh = [_]PendingLiveMesh{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingLiveMeshFor(node_id: u32) ?*PendingLiveMesh {
    for (&g_pending_live_mesh) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live MESH-prop refs for a node (LIVEMESH req_1812). `bytes` packs a variable
/// stride per ref: a 24-byte header (u32 keyHash, f32 x,y,z,yaw, u32 matCount) then matCount×u32
/// per-slot material hashes (little-endian, the layout pieceMeshes.tsx writes). We own a copy
/// (refs + each ref's mats array) so the JS buffer can be freed.
pub fn setLiveMeshProps(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingLiveMesh = pendingLiveMeshFor(node_id);
    if (slot == null) {
        for (&g_pending_live_mesh) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    // VARIABLE STRIDE (req_2025): each ref is a 24-byte header + matCount×u32, so walk the
    // buffer with a cursor into an ArrayList instead of a fixed divide. A malformed tail
    // (header runs past the buffer) just stops the walk — never reads out of bounds.
    var built: std.ArrayListUnmanaged(LiveMeshRef) = .{};
    var off: usize = 0;
    while (off + LIVE_MESH_HEADER_BYTES <= bytes.len) {
        const mat_count = std.mem.bytesToValue(u32, bytes[off + 20 ..][0..4]);
        const mats_bytes = @as(usize, mat_count) * 4;
        if (off + LIVE_MESH_HEADER_BYTES + mats_bytes > bytes.len) break; // truncated tail
        var mats: []u32 = &.{};
        if (mat_count > 0) {
            mats = alloc.alloc(u32, mat_count) catch break;
            var k: usize = 0;
            while (k < mat_count) : (k += 1) {
                mats[k] = std.mem.bytesToValue(u32, bytes[off + LIVE_MESH_HEADER_BYTES + k * 4 ..][0..4]);
            }
        }
        built.append(alloc, .{
            .hash = std.mem.bytesToValue(u32, bytes[off..][0..4]),
            .x = std.mem.bytesToValue(f32, bytes[off + 4 ..][0..4]),
            .y = std.mem.bytesToValue(f32, bytes[off + 8 ..][0..4]),
            .z = std.mem.bytesToValue(f32, bytes[off + 12 ..][0..4]),
            .yaw = std.mem.bytesToValue(f32, bytes[off + 16 ..][0..4]),
            .mats = mats,
        }) catch {
            if (mats.len > 0) alloc.free(mats);
            break;
        };
        off += LIVE_MESH_HEADER_BYTES + mats_bytes;
    }
    freeLiveRefs(alloc, p.refs);
    p.node_id = node_id;
    p.set = true;
    p.refs = built.toOwnedSlice(alloc) catch &.{};
    p.gen +%= 1;
}

/// Free a live-mesh-ref slice plus each ref's owned per-slot mats array.
fn freeLiveRefs(alloc: std.mem.Allocator, refs: []LiveMeshRef) void {
    for (refs) |r| if (r.mats.len > 0) alloc.free(r.mats);
    if (refs.len > 0) alloc.free(refs);
}

/// Drop the live mesh-prop refs for a node (after a bake reload folds them in).
pub fn clearLiveMeshProps(node_id: u32) void {
    const p = pendingLiveMeshFor(node_id) orelse return;
    freeLiveRefs(std.heap.page_allocator, p.refs);
    p.refs = &.{};
    p.gen +%= 1;
}

// ── live editor face-skin MATERIALS (LIVESKIN req_1843) ─────────────────────
// A procedural skin pushed by the editor — its WGSL recipe + tuned data — queued per node
// until applyLiveMeshProps materializes it (the GPU is up by render time). Materialized once
// per hash into "live-mat:<hash>"; a live mesh ref bearing that mat_hash then wears it.
const LiveMat = struct { hash: u32, kind: u32, wgsl: []u8, data: []f32, opacity: f32 };
const PendingLiveMats = struct {
    node_id: u32 = 0,
    set: bool = false,
    mats: std.ArrayListUnmanaged(LiveMat) = .{},
};
var g_pending_live_mats: [MAX_EMBEDDED_LOADERS]PendingLiveMats = [_]PendingLiveMats{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingLiveMatsFor(node_id: u32) ?*PendingLiveMats {
    for (&g_pending_live_mats) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Queue a live face-skin material for a node (LIVESKIN req_1843). kind 0 = shader (wgsl +
/// data). Owns copies of wgsl/data. Deduped by hash — the loader materializes each once.
pub fn setLiveMaterial(node_id: u32, hash: u32, kind: u32, wgsl: []const u8, data_bytes: []const u8, opacity: f32) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingLiveMats = pendingLiveMatsFor(node_id);
    if (slot == null) {
        for (&g_pending_live_mats) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    p.node_id = node_id;
    p.set = true;
    for (p.mats.items) |m| if (m.hash == hash) return; // already queued — materialized once
    const wgsl_copy = alloc.dupe(u8, wgsl) catch return;
    const n = data_bytes.len / 4;
    const data_copy = alloc.alloc(f32, n) catch {
        alloc.free(wgsl_copy);
        return;
    };
    var i: usize = 0;
    while (i < n) : (i += 1) data_copy[i] = std.mem.bytesToValue(f32, data_bytes[i * 4 ..][0..4]);
    p.mats.append(alloc, .{ .hash = hash, .kind = kind, .wgsl = wgsl_copy, .data = data_copy, .opacity = opacity }) catch {
        alloc.free(wgsl_copy);
        alloc.free(data_copy);
    };
}

// ── live BUILDING-PIECE skin boxes (LIVEBLDSKIN req_1849) ────────────────────
// A procedurally-skinned building-piece face, drawn as a textured cube outset over the
// baked face-slab. 32 bytes/box: cx,cy,cz, sx,sy,sz, yawDeg (f32), matHash (u32).
const SKIN_BOX_OUTSET: f32 = 0.008; // grow each dim so the live face protrudes past the baked
const SkinBox = struct { cx: f32, cy: f32, cz: f32, sx: f32, sy: f32, sz: f32, yaw: f32, mat_hash: u32 };
const SKIN_BOX_STRIDE_BYTES: usize = 32;
const PendingSkinBoxes = struct {
    node_id: u32 = 0,
    set: bool = false,
    boxes: []SkinBox = &.{},
    gen: u64 = 0,
};
var g_pending_skin_boxes: [MAX_EMBEDDED_LOADERS]PendingSkinBoxes = [_]PendingSkinBoxes{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingSkinBoxesFor(node_id: u32) ?*PendingSkinBoxes {
    for (&g_pending_skin_boxes) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live building-piece skin boxes for a node (LIVEBLDSKIN req_1849).
pub fn setLiveSkinBoxes(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingSkinBoxes = pendingSkinBoxesFor(node_id);
    if (slot == null) {
        for (&g_pending_skin_boxes) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const n = bytes.len / SKIN_BOX_STRIDE_BYTES;
    const boxes = alloc.alloc(SkinBox, n) catch return;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const o = i * SKIN_BOX_STRIDE_BYTES;
        boxes[i] = .{
            .cx = std.mem.bytesToValue(f32, bytes[o..][0..4]),
            .cy = std.mem.bytesToValue(f32, bytes[o + 4 ..][0..4]),
            .cz = std.mem.bytesToValue(f32, bytes[o + 8 ..][0..4]),
            .sx = std.mem.bytesToValue(f32, bytes[o + 12 ..][0..4]),
            .sy = std.mem.bytesToValue(f32, bytes[o + 16 ..][0..4]),
            .sz = std.mem.bytesToValue(f32, bytes[o + 20 ..][0..4]),
            .yaw = std.mem.bytesToValue(f32, bytes[o + 24 ..][0..4]),
            .mat_hash = std.mem.bytesToValue(u32, bytes[o + 28 ..][0..4]),
        };
    }
    if (p.boxes.len > 0) alloc.free(p.boxes);
    p.node_id = node_id;
    p.set = true;
    p.boxes = boxes;
    p.gen +%= 1;
}

// ── DIRTYRECT erase (req_1891/1892) ─────────────────────────────────────────
// The editor marks a moved/deleted piece's OLD footprint dirty; the loader collapses
// the baked rows + hides the baked mesh-prop nodes inside it (see applyDirtyErase /
// applyLiveMeshProps) so the stale geometry vanishes with no rebake. 24 bytes/rect:
// minX,minY,minZ, maxX,maxY,maxZ (all f32).
const ERASE_RECT_STRIDE_BYTES: usize = 24;
const PendingDirtyErase = struct {
    node_id: u32 = 0,
    set: bool = false,
    rects: []EraseRect = &.{},
    gen: u64 = 0,
};
var g_pending_dirty_erase: [MAX_EMBEDDED_LOADERS]PendingDirtyErase = [_]PendingDirtyErase{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingDirtyEraseFor(node_id: u32) ?*PendingDirtyErase {
    for (&g_pending_dirty_erase) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the dirty-erase rect set for a node (DIRTYRECT req_1891/1892). Each rect is
/// an old-footprint AABB; an empty `bytes` clears them (everything un-erases next frame).
pub fn setDirtyErase(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingDirtyErase = pendingDirtyEraseFor(node_id);
    if (slot == null) {
        for (&g_pending_dirty_erase) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const n = bytes.len / ERASE_RECT_STRIDE_BYTES;
    const rects = alloc.alloc(EraseRect, n) catch return;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const o = i * ERASE_RECT_STRIDE_BYTES;
        rects[i] = .{
            .min_x = std.mem.bytesToValue(f32, bytes[o..][0..4]),
            .min_y = std.mem.bytesToValue(f32, bytes[o + 4 ..][0..4]),
            .min_z = std.mem.bytesToValue(f32, bytes[o + 8 ..][0..4]),
            .max_x = std.mem.bytesToValue(f32, bytes[o + 12 ..][0..4]),
            .max_y = std.mem.bytesToValue(f32, bytes[o + 16 ..][0..4]),
            .max_z = std.mem.bytesToValue(f32, bytes[o + 20 ..][0..4]),
        };
    }
    if (p.rects.len > 0) alloc.free(p.rects);
    p.node_id = node_id;
    p.set = true;
    p.rects = rects;
    p.gen +%= 1;
}

// ── WALLHIDE editor "disable walls" toggle (req_2053) ───────────────────────
// The editor build pane flips this so you can see/edit a building's interior. The
// Runtime's applyWallHide reads it (once per generation) and collapses/restores
// the WALL_SENTINEL rows. Per node, the same slot pattern as the erase pending.
const PendingWallHide = struct {
    node_id: u32 = 0,
    set: bool = false,
    on: bool = false,
    gen: u64 = 0,
};
var g_pending_wall_hide: [MAX_EMBEDDED_LOADERS]PendingWallHide = [_]PendingWallHide{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingWallHideFor(node_id: u32) ?*PendingWallHide {
    for (&g_pending_wall_hide) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Toggle the editor's hide-walls for a node (req_2053). `on` true hides every wall
/// piece (collapses its rows) so the interior is visible/editable; false restores them.
pub fn setHideWalls(node_id: u32, on: bool) void {
    var slot: ?*PendingWallHide = pendingWallHideFor(node_id);
    if (slot == null) {
        for (&g_pending_wall_hide) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    if (p.set and p.node_id == node_id and p.on == on) return; // unchanged — no needless re-collapse
    p.node_id = node_id;
    p.set = true;
    p.on = on;
    p.gen +%= 1;
}

// ── FULLRES resident-mesh catalog (req_1909/1911/1912) ──────────────────────
// The editor pushes the WHOLE cooked-asset catalog as a MESH_PROPS lump (meshes only) so
// every compiled asset is resident in the /editor route — no rebake to place one. We hold the
// raw lump bytes here; the Runtime decodes them once per generation (applyResidentMeshes).
const PendingResident = struct {
    node_id: u32 = 0,
    set: bool = false,
    bytes: []u8 = &.{},
    gen: u64 = 0,
};
var g_pending_resident: [MAX_EMBEDDED_LOADERS]PendingResident = [_]PendingResident{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingResidentFor(node_id: u32) ?*PendingResident {
    for (&g_pending_resident) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the resident cooked-asset catalog for a node (FULLRES). `bytes` is a MESH_PROPS
/// lump (meshes only); empty clears residency. A copy is held until the Runtime decodes it.
pub fn setResidentMeshes(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingResident = pendingResidentFor(node_id);
    if (slot == null) {
        for (&g_pending_resident) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const copy = alloc.alloc(u8, bytes.len) catch return;
    @memcpy(copy, bytes);
    if (p.bytes.len > 0) alloc.free(p.bytes);
    p.node_id = node_id;
    p.set = true;
    p.bytes = copy;
    p.gen +%= 1;
}

// ── live placement GHOST (LIVEMESH req_1841) ────────────────────────────────
// The armed mesh prop, drawn as the REAL mesh translucent at the snap target — a far
// clearer preview than the faint projected wireframe. ONE ref per node, no allocation.
const LIVE_MESH_GHOST_ALPHA: f32 = 0.5;
const PendingMeshGhost = struct {
    node_id: u32 = 0,
    set: bool = false,
    has: bool = false, // a ref is currently armed (vs cleared but slot retained)
    ref: LiveMeshRef = .{ .hash = 0, .x = 0, .y = 0, .z = 0, .yaw = 0 },
};
var g_pending_mesh_ghost: [MAX_EMBEDDED_LOADERS]PendingMeshGhost = [_]PendingMeshGhost{.{}} ** MAX_EMBEDDED_LOADERS;

fn pendingMeshGhostFor(node_id: u32) ?*PendingMeshGhost {
    for (&g_pending_mesh_ghost) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Set the placement-ghost mesh ref for a node (LIVEMESH req_1841). `bytes` is ONE ref:
/// u32 keyHash, f32 x,y,z,yaw — the same layout as a live mesh-prop ref.
pub fn setLiveMeshGhost(node_id: u32, bytes: []const u8) void {
    if (bytes.len < LIVE_MESH_HEADER_BYTES) {
        clearLiveMeshGhost(node_id);
        return;
    }
    var slot: ?*PendingMeshGhost = pendingMeshGhostFor(node_id);
    if (slot == null) {
        for (&g_pending_mesh_ghost) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    p.node_id = node_id;
    p.set = true;
    p.has = true;
    p.ref = .{
        .hash = std.mem.bytesToValue(u32, bytes[0..4]),
        .x = std.mem.bytesToValue(f32, bytes[4..8]),
        .y = std.mem.bytesToValue(f32, bytes[8..12]),
        .z = std.mem.bytesToValue(f32, bytes[12..16]),
        .yaw = std.mem.bytesToValue(f32, bytes[16..20]),
    };
}

/// Drop the placement ghost for a node (disarmed, or hovering a non-mesh prop).
pub fn clearLiveMeshGhost(node_id: u32) void {
    const p = pendingMeshGhostFor(node_id) orelse return;
    p.has = false;
}

fn pendingCamFor(node_id: u32) ?*PendingCam {
    for (&g_pending_cams) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

fn setPendingCam(node_id: u32, pos: Vec3, look: Vec3, fov: f32) void {
    var slot: ?*PendingCam = pendingCamFor(node_id);
    if (slot == null) {
        for (&g_pending_cams) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    if (slot) |p| {
        p.node_id = node_id;
        p.set = true;
        p.pos = pos;
        p.look = look;
        p.fov = fov;
    }
}

fn applyPendingCam(runtime: *Runtime) void {
    const p = pendingCamFor(runtime.node_id) orelse return;
    runtime.camera.external = true;
    runtime.camera.ext_pos = p.pos;
    runtime.camera.ext_look = p.look;
    runtime.camera.ext_fov = p.fov;
}

// Copy the node's pending live-overlay rows into the runtime's own buffer and point the
// live render node at them (LIVEHOST req_1798). Only re-copies when the pending gen moved
// (a placement/move/delete or a clear), so a still view costs nothing. The live node was
// reserved in build() at live_kid in the STABLE node prefix, so streaming never clobbers it.
fn applyPendingLive(runtime: *Runtime) void {
    const kid = runtime.live_kid orelse return;
    const p = pendingLiveFor(runtime.node_id) orelse return;
    if (runtime.live_gen == p.gen) return;
    const floats = p.count * INSTANCE_STRIDE;
    if (floats > runtime.live_buf.len) {
        if (runtime.live_buf.len > 0) runtime.allocator.free(runtime.live_buf);
        runtime.live_buf = runtime.allocator.alloc(f32, floats) catch {
            runtime.live_buf = &.{};
            return;
        };
    }
    if (floats > 0) @memcpy(runtime.live_buf[0..floats], p.rows[0..floats]);
    const node = &runtime.kid_list.items[kid];
    node.scene3d_instance_data = runtime.live_buf[0..floats];
    node.scene3d_instance_count = @intCast(p.count);
    node.scene3d_mesh = p.count > 0;
    runtime.live_gen = p.gen;
    // [live-diag req_1812] RJIT_LIVELOG=1: prove the overlay applies + dump the first row,
    // so an invisible placed piece is diagnosed (0 rows? off-screen? zero scale?).
    if (std.posix.getenv("RJIT_LIVELOG") != null) {
        if (p.count > 0) {
            log.print("[live] kid={d} count={d} gen={d} row0 pos=({d:.1},{d:.1},{d:.1}) scale=({d:.1},{d:.1},{d:.1}) col=({d:.2},{d:.2},{d:.2})\n", .{
                kid, p.count, p.gen, p.rows[0], p.rows[1], p.rows[2], p.rows[6], p.rows[7], p.rows[8], p.rows[9], p.rows[10], p.rows[11],
            });
        } else {
            log.print("[live] kid={d} count=0 gen={d} (overlay cleared)\n", .{ kid, p.gen });
        }
    }
}

// Fold the live overlay into the PHYSICS colliders (req_2792: "I can walk
// through every wall" — the overlay was draw-only, so the playtest tab had no
// solids). When the overlay generation moves, the step buffer is rebuilt as
// BASE + LIVE:
//   • BASE = the build-time rect/oriented sections, copied from the CURRENT
//     buffer so in-place door/elevator state survives (their rect indices sit
//     inside the base and never move — live rows append strictly after).
//   • LIVE = the same two-pass derivation the pre-lump instance path uses,
//     over the 12-stride live rows: walkable floors first so ground always
//     survives the rect cap, walls solid by height, yawed rows oriented.
// Heightfields are deliberately NOT touched — a full buildPhysicsColliders
// rerun would clearHeightfields() and silently drop the PAINTED terrain
// (applyPaintLayer only re-registers a chunk when its height goes dirty).
fn applyLiveColliders(runtime: *Runtime) void {
    const p = pendingLiveFor(runtime.node_id);
    const pm = pendingLiveMeshFor(runtime.node_id);
    if (p == null and pm == null) return;
    const piece_gen: u64 = if (p) |x| x.gen else 0;
    const mesh_gen: u64 = if (pm) |x| x.gen else 0;
    if (runtime.live_collider_gen == piece_gen and runtime.live_mesh_collider_gen == mesh_gen) return;
    if (!runtime.has_physics_colliders) return;
    if (runtime.windowed) {
        // The huge-map window rebuild owns this buffer per frame; folding live
        // rows here would fight it. Say so once instead of silently no-oping.
        if (!runtime.live_collider_warned) {
            runtime.live_collider_warned = true;
            log.print("[live] windowed map — live-piece colliders skipped (window rebuild owns the physics set)\n", .{});
        }
        runtime.live_collider_gen = piece_gen;
        runtime.live_mesh_collider_gen = mesh_gen;
        return;
    }
    // A live MESH ref resolves through the resident catalog + baked hash map, which
    // stepNow builds AFTER this runs in the frame — force the gen-guarded decode NOW
    // or the rebuild on the push's own frame misses every mesh placement.
    runtime.applyResidentMeshes();
    runtime.ensureMeshHashMap();
    const alloc = runtime.allocator;

    var live_rects: std.ArrayList(f32) = .{};
    defer live_rects.deinit(alloc);
    var live_oriented: std.ArrayList(f32) = .{};
    defer live_oriented.deinit(alloc);
    var live_rect_count: usize = 0;
    var live_oriented_count: usize = 0;
    var clipped: usize = 0;

    if (p) |pp| {
        const rows = pp.rows[0 .. pp.count * INSTANCE_STRIDE];
        var pass: usize = 0;
        while (pass < 2) : (pass += 1) {
            const want_solid = pass == 1;
            var row: usize = 0;
            while (row < pp.count) : (row += 1) {
                const b = row * INSTANCE_STRIDE;
                const sx = @abs(rows[b + 6]);
                const sy = @abs(rows[b + 7]);
                const sz = @abs(rows[b + 8]);
                if (sx <= 0.001 or sy <= 0.001 or sz <= 0.001) continue;
                const solid = instance_collider_policy.blocksPlayerByHeight(sy, PHYSICS_SOLID_HEIGHT_METERS);
                if (solid != want_solid) continue;
                const yaw = instanceYawRadians(rows, row, INSTANCE_STRIDE);
                if (@abs(yaw) > 0.0001) {
                    if (runtime.base_oriented_count + live_oriented_count >= game_physics.MAX_ORIENTED) {
                        clipped += 1;
                        continue;
                    }
                    live_oriented.appendSlice(alloc, &orientedFloats(rows, row, INSTANCE_STRIDE, solid)) catch {
                        clipped += 1;
                        continue;
                    };
                    live_oriented_count += 1;
                } else {
                    if (runtime.base_rect_count + live_rect_count >= game_physics.MAX_RECTS) {
                        clipped += 1;
                        continue;
                    }
                    live_rects.appendSlice(alloc, &rectFloats(rows, row, INSTANCE_STRIDE, solid)) catch {
                        clipped += 1;
                        continue;
                    };
                    live_rect_count += 1;
                }
            }
        }
    }

    // req_2832 ("i walk right through it"): live MESH placements collide too — box
    // pieces folded in above, but a placed authored prop was draw-only. Same
    // per-island oriented boxes the baked mesh-prop path emits (walk under a
    // sign's overhead board), anchored at the live ref's transform. The GHOST
    // (pendingMeshGhostFor) stays collision-free — it's a placement preview.
    if (pm) |pmx| {
        for (pmx.refs) |r| {
            const mesh = runtime.meshForHash(r.hash) orelse continue;
            const inst: constructor.MeshPropInstance = .{ .mesh = 0, .x = r.x, .y = r.y, .z = r.z, .yaw_degrees = r.yaw };
            const isls = meshPropIslands(alloc, mesh) catch continue;
            defer alloc.free(isls);
            for (isls) |isl| {
                if (runtime.base_oriented_count + live_oriented_count >= game_physics.MAX_ORIENTED) {
                    clipped += 1;
                    continue;
                }
                live_oriented.appendSlice(alloc, &islandOrientedFloats(inst, isl)) catch {
                    clipped += 1;
                    continue;
                };
                live_oriented_count += 1;
            }
        }
    }

    // Reassemble: header + entity slots zeroed (the step rewrites both every
    // call), base rects + live rects, base oriented + live oriented.
    const old = runtime.physics_colliders;
    const rect_base = old.rectBase();
    const base_rect_floats = runtime.base_rect_count * game_physics.RECT_FLOATS;
    const base_oriented_floats = runtime.base_oriented_count * game_physics.ORIENTED_FLOATS;
    const old_oriented_start = rect_base + old.rect_count * game_physics.RECT_FLOATS;
    const values = alloc.alloc(f32, rect_base + base_rect_floats + live_rects.items.len + base_oriented_floats + live_oriented.items.len) catch {
        log.print("[live] collider rebuild allocation failed — live pieces stay walk-through\n", .{});
        runtime.live_collider_gen = piece_gen;
        runtime.live_mesh_collider_gen = mesh_gen;
        return;
    };
    @memset(values[0..rect_base], 0);
    var at: usize = rect_base;
    @memcpy(values[at .. at + base_rect_floats], old.values[rect_base .. rect_base + base_rect_floats]);
    at += base_rect_floats;
    @memcpy(values[at .. at + live_rects.items.len], live_rects.items);
    at += live_rects.items.len;
    @memcpy(values[at .. at + base_oriented_floats], old.values[old_oriented_start .. old_oriented_start + base_oriented_floats]);
    at += base_oriented_floats;
    @memcpy(values[at .. at + live_oriented.items.len], live_oriented.items);

    alloc.free(old.values);
    runtime.physics_colliders.values = values;
    runtime.physics_colliders.rect_count = runtime.base_rect_count + live_rect_count;
    runtime.physics_colliders.oriented_count = runtime.base_oriented_count + live_oriented_count;
    runtime.live_collider_gen = piece_gen;
    runtime.live_mesh_collider_gen = mesh_gen;
    if (clipped > 0) {
        log.print("[live] collider cap CLIPPED {d} live rows — distant pieces are walk-through\n", .{clipped});
    }
    log.print("[live] colliders folded: {d} base + {d} live rects, {d} base + {d} live oriented\n", .{ runtime.base_rect_count, live_rect_count, runtime.base_oriented_count, live_oriented_count });
}

// ── MAPPAINT req_2473: the live map-paint layer ───────────────────────────────
// The map painter's authoring buffers (framework/game/map) are host globals; the
// loader is their VIEW: each painted chunk claims a reserved paint node whose
// heights point at an owned 121×121 downsample of the chunk's 241×241 brush
// field, re-baked + collider-refreshed only when the chunk's height channel is
// dirty. Pointer input routes here from engine.zig when a paint tool is armed
// (setPaintMode) — screen → ext-camera ray → terrain hit → stroke engine, with
// zero JS per event. The brush gizmo is preview-only chrome the hover point
// drags around.

const PendingPaint = struct {
    node_id: u32 = 0,
    enabled: bool = false,
};
var g_pending_paint: [MAX_EMBEDDED_LOADERS]PendingPaint = [_]PendingPaint{.{}} ** MAX_EMBEDDED_LOADERS;
var g_any_paint_armed: bool = false;

/// Arm/disarm in-viewport map painting for a loader node (the editor's door).
pub fn setPaintMode(node_id: u32, enabled: bool) void {
    if (node_id == 0) return;
    var slot: ?*PendingPaint = null;
    for (&g_pending_paint) |*p| {
        if (p.node_id == node_id) {
            slot = p;
            break;
        }
        if (slot == null and p.node_id == 0) slot = p;
    }
    if (slot) |p| {
        p.node_id = node_id;
        p.enabled = enabled;
    }
    g_any_paint_armed = false;
    for (&g_pending_paint) |*p| {
        if (p.node_id != 0 and p.enabled) g_any_paint_armed = true;
    }
}

pub fn paintArmed(node_id: u32) bool {
    for (&g_pending_paint) |*p| {
        if (p.node_id == node_id) return p.enabled;
    }
    return false;
}

/// Cheap pre-check for engine.zig's per-motion routing: any armed viewport at all?
pub fn anyPaintArmed() bool {
    return g_any_paint_armed;
}

pub const PaintPhase = enum { down, move, up };

/// Route a pointer event into the map painter (engine.zig calls this while a
/// paint drag owns the pointer). Screen coords are window-absolute; the pane
/// rect renderEmbedded stored maps them into the viewport.
pub fn paintPointer(node_id: u32, phase: PaintPhase, mx: f32, my: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    if (phase == .up) {
        if (runtime.paint_stroking) {
            runtime.paint_stroking = false;
            _ = map_paint.strokeEnd();
        }
        return;
    }
    const hit = paintGroundHitAt(runtime, mx, my, 0) orelse return;
    runtime.paint_hover = hit;
    switch (phase) {
        .down => {
            runtime.paint_stroking = true;
            map_paint.strokeBegin(hit[0], hit[2]);
        },
        .move => {
            if (runtime.paint_stroking) map_paint.strokeMove(hit[0], hit[2]);
        },
        .up => unreachable,
    }
}

/// Window-space cursor → painted-terrain surface point, for the PLACEMENT path
/// (__compiled_world_ground_hit, req_2666). The EXACT brush-beam code path
/// (paintGroundHitAt below), so where a piece lands and where the brush strokes
/// can never disagree about the ground. Null when the loader isn't mounted, the
/// camera isn't the editor's external iso pose, the pane rect isn't live yet,
/// or the ray misses every painted chunk (off-map — the cart falls back to its
/// analytic flat plane).
///
/// `level_y` is the active storey's elevation in metres (req_2744): the ray is
/// intersected with the terrain surface LIFTED by level_y (floor N's slab rides
/// the terrain), so the returned x/z sit exactly under the cursor once the cart
/// bases the piece at terrainY + level_y. The returned y stays the TRUE terrain
/// height at that x/z — the cart owns the storey addition. 0 = ground behavior,
/// bit-identical to before.
pub fn groundHitAt(node_id: u32, mx: f32, my: f32, level_y: f32) ?[3]f32 {
    const entry = findMounted(node_id) orelse return null;
    const runtime = entry.runtime orelse return null;
    return paintGroundHitAt(runtime, mx, my, level_y);
}

/// Screen (window-absolute) → world ray through the external iso camera →
/// painted-terrain hit. The ray basis mirrors gpu/3d.zig drawScene's
/// m4perspective(fov_y, aspect) + lookAt(up = +Y) exactly, so the brush lands
/// under the cursor by construction.
///
/// `level_y` lifts the intersected surface by that many metres (req_2744) by
/// LOWERING the ray origin instead — intersecting y = terrain(x,z) + L with a
/// ray from O is identical to intersecting y = terrain(x,z) from O − (0,L,0),
/// so the heightfield march itself never learns what a storey is. The brush
/// paths always pass 0 (painting is a ground affair).
///
/// The ray marches the RENDERED surface — the 121-grid abs-max floor mirror the
/// mesh and collider use — NOT heightAt's fine 241-grid brush field, which sits
/// up to half a metre BELOW the rendered slope on sculpted ground. Placing on
/// that lower surface buried the 5 cm floor plate inside the visible hill while
/// a 3 m wall still poked through (req_2789 — the drowned-grass class, req_2704).
const RenderFloorSurface = struct {
    runtime: *Runtime,
    pub fn sample(self: @This(), x: f32, z: f32) f32 {
        const cx = map_chunks.chunkOfGlobalTile(map_chunks.globalTile(x));
        const cz = map_chunks.chunkOfGlobalTile(map_chunks.globalTile(z));
        const chunk = map_chunks.chunkAt(cx, cz) orelse return 0;
        return paintGroundY(paintSlotFloorFor(self.runtime, cx, cz), chunk, x, z);
    }
};

fn paintGroundHitAt(runtime: *Runtime, mx: f32, my: f32, level_y: f32) ?[3]f32 {
    if (runtime.paint_last_w <= 1 or runtime.paint_last_h <= 1) return null;
    const cam = &runtime.camera;
    if (!cam.external) return null; // painting is an editor-viewport affair
    const nx = ((mx - runtime.paint_last_x) / runtime.paint_last_w) * 2 - 1;
    const ny = 1 - ((my - runtime.paint_last_y) / runtime.paint_last_h) * 2;
    if (nx < -1.05 or nx > 1.05 or ny < -1.05 or ny > 1.05) return null;

    var fx = cam.ext_look.x - cam.ext_pos.x;
    var fy = cam.ext_look.y - cam.ext_pos.y;
    var fz = cam.ext_look.z - cam.ext_pos.z;
    const flen = @sqrt(fx * fx + fy * fy + fz * fz);
    if (flen < 0.0001) return null;
    fx /= flen;
    fy /= flen;
    fz /= flen;
    // right = normalize(forward × up), up basis = right × forward
    var rx = -fz;
    var rz = fx;
    const rlen = @sqrt(rx * rx + rz * rz);
    if (rlen < 0.0001) return null; // straight-down camera: degenerate basis
    rx /= rlen;
    rz /= rlen;
    // up basis = right(rx,0,rz) × forward(fx,fy,fz)
    const up_x = -rz * fy;
    const up_y = rz * fx - rx * fz;
    const up_z = rx * fy;
    const tan_half = @tan(cam.ext_fov * std.math.pi / 360.0);
    const aspect = runtime.paint_last_w / runtime.paint_last_h;
    var dx = fx + rx * (nx * tan_half * aspect) + up_x * (ny * tan_half);
    var dy = fy + up_y * (ny * tan_half);
    var dz = fz + rz * (nx * tan_half * aspect) + up_z * (ny * tan_half);
    const dlen = @sqrt(dx * dx + dy * dy + dz * dz);
    if (dlen < 0.0001) return null;
    dx /= dlen;
    dy /= dlen;
    dz /= dlen;
    return map_paint.surfaceHit(RenderFloorSurface{ .runtime = runtime }, cam.ext_pos.x, cam.ext_pos.y - level_y, cam.ext_pos.z, dx, dy, dz, 2000);
}

// Painted-water surface derivation (chunkFloor.ts floorToWaterBody, req_1840
// shore rule): a shallow cell (depth < SHORE_KEEP) only stays wet when a
// GENUINELY deep cell (≥ SHORE_DEEP) sits within SHORE_R grid steps — the deep
// body keeps its shoreline margin, isolated barely-negative film drops, and the
// height-0 contour reads as clean beach. Wet surface = bed + depth; dry cells
// tuck just UNDER the local terrain (bed − tuck) so the sheet edge dives into
// the bank it meets — one global basin base left a visible gap against raised
// shores and a floating slab over downhill ground (req_2704).
const PAINT_SHORE_DEEP_M: f32 = 0.5;
const PAINT_SHORE_KEEP_M: f32 = 0.5;
const PAINT_SHORE_R: i32 = 2;
const PAINT_WATER_TUCK_M: f32 = 0.3; // WATER_LOOK.floorTuckMeters

/// Shore-cull raw depths + build the water surface over the 121×121 floor grid.
/// Returns whether any cell is wet (dry chunk ⇒ hide the water node).
/// `depths` MAY alias `raw_depths` (the caller culls in place) — safe ONLY while
/// SHORE_KEEP == SHORE_DEEP: the neighbour scan looks for cells ≥ DEEP, and a
/// cell that gets zeroed is < KEEP, so an already-culled cell could never have
/// satisfied the scan anyway. Lower SHORE_DEEP below SHORE_KEEP and this needs
/// a scratch copy.
fn paintWaterSurface(raw_depths: []const f32, beds: []const f32, depths: []f32, surface: []f32) bool {
    const res: i32 = @intCast(map_paint.FLOOR_RES);
    var wet = false;
    for (raw_depths, 0..) |d, i| {
        var keep = d > 0 and d >= PAINT_SHORE_KEEP_M;
        if (!keep and d > 0) {
            const x: i32 = @intCast(i % map_paint.FLOOR_RES);
            const y: i32 = @intCast(i / map_paint.FLOOR_RES);
            search: {
                var dy: i32 = -PAINT_SHORE_R;
                while (dy <= PAINT_SHORE_R) : (dy += 1) {
                    const yy = y + dy;
                    if (yy < 0 or yy >= res) continue;
                    var dx: i32 = -PAINT_SHORE_R;
                    while (dx <= PAINT_SHORE_R) : (dx += 1) {
                        const xx = x + dx;
                        if (xx < 0 or xx >= res) continue;
                        if (raw_depths[@as(usize, @intCast(yy)) * map_paint.FLOOR_RES + @as(usize, @intCast(xx))] >= PAINT_SHORE_DEEP_M) {
                            keep = true;
                            break :search;
                        }
                    }
                }
            }
        }
        depths[i] = if (keep) d else 0;
        if (keep) wet = true;
    }
    if (!wet) return false;
    for (depths, 0..) |d, i| {
        surface[i] = if (d > 0) beds[i] + d else beds[i] - PAINT_WATER_TUCK_M;
    }
    return true;
}

fn paintGizmoColor(tool: map_paint.Tool) [3]f32 {
    if (tool.mode == .erase) return .{ 0.95, 0.25, 0.2 };
    return switch (tool.channel) {
        .terrain => if (tool.terrain_tool == .brush and tool.center_z < 0) .{ 0.95, 0.32, 0.24 } else .{ 0.45, 0.9, 0.28 },
        .water => .{ 0.25, 0.55, 0.95 },
        .flora => .{ 0.35, 0.88, 0.45 },
        .zone => .{ 0.85, 0.42, 1.0 },
        .road => .{ 1.0, 0.86, 0.25 },
        .tile => .{ 1.0, 0.72, 0.25 },
    };
}

fn paintGizmoProfileHeight(tool: map_paint.Tool, radius: f32) f32 {
    const raw = if (tool.channel == .terrain and tool.terrain_tool == .brush) @abs(tool.center_z) else radius * 0.75;
    return @max(0.75, @min(PAINT_GIZMO_PROFILE_MAX_M, raw));
}

fn setPaintGizmoMesh(node: *Node, key: []const u8, verts: []const f32, alpha: f32) void {
    node.scene3d_mesh = true;
    node.scene3d_geom_key = key;
    node.scene3d_vertices = verts;
    node.scene3d_vert_count = @intCast(verts.len / 8);
    node.scene3d_tex_key = null;
    node.scene3d_heights = null;
    node.scene3d_ground_formula = null;
    node.scene3d_ground_data = null;
    node.scene3d_instance_data = null;
    node.scene3d_instance_count = 0;
    node.scene3d_color_a = alpha;
}

fn setPaintGizmoTransform(node: *Node, hover: [3]f32, sx: f32, sy: f32, sz: f32, y_offset: f32, rot_y: f32) void {
    node.scene3d_pos_x = hover[0];
    node.scene3d_pos_y = hover[1] + y_offset;
    node.scene3d_pos_z = hover[2];
    node.scene3d_scale_x = sx;
    node.scene3d_scale_y = sy;
    node.scene3d_scale_z = sz;
    node.scene3d_rot_x = 0;
    node.scene3d_rot_y = rot_y;
    node.scene3d_rot_z = 0;
}

fn dressPaintGizmo(runtime: *Runtime, node: *Node, hover: [3]f32, tool: map_paint.Tool) void {
    const radius = @max(0.5, tool.radius_m);
    const diameter = radius * 2;
    const color = paintGizmoColor(tool);
    node.scene3d_color_r = color[0];
    node.scene3d_color_g = color[1];
    node.scene3d_color_b = color[2];

    const diamond_rot: f32 = if (tool.shape == .diamond) std.math.pi / 4.0 else 0.0;
    switch (map_paint.brushGizmo()) {
        .beam => {
            setPaintGizmoMesh(node, "box", runtime.cube[0..], PAINT_BEAM_ALPHA);
            setPaintGizmoTransform(node, hover, diameter, PAINT_BEAM_HEIGHT_METERS, diameter, PAINT_BEAM_HEIGHT_METERS / 2, diamond_rot);
        },
        .decal => {
            if (tool.shape == .circle) {
                setPaintGizmoMesh(node, "paint-gizmo-decal", runtime.brush_decal[0..], 0.42);
                setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, 0);
            } else {
                setPaintGizmoMesh(node, "box", runtime.cube[0..], 0.34);
                setPaintGizmoTransform(node, hover, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diameter, PAINT_GIZMO_SURFACE_LIFT_M * 0.5, diamond_rot);
            }
        },
        .rings => {
            setPaintGizmoMesh(node, "paint-gizmo-rings", runtime.brush_rings[0..], 0.88);
            setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
        },
        .profile => {
            const h = paintGizmoProfileHeight(tool, radius);
            if (tool.profile == .flat) {
                setPaintGizmoMesh(node, "paint-gizmo-decal", runtime.brush_decal[0..], 0.46);
                setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
            } else if (tool.profile == .dome) {
                setPaintGizmoMesh(node, "paint-gizmo-dome", runtime.brush_dome[0..], 0.3);
                setPaintGizmoTransform(node, hover, diameter, h * 2, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
            } else {
                setPaintGizmoMesh(node, "paint-gizmo-cone", runtime.brush_cone[0..], 0.34);
                setPaintGizmoTransform(node, hover, diameter, h * 2, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
            }
        },
        .handles => {
            setPaintGizmoMesh(node, "paint-gizmo-handles", runtime.brush_handles[0..], 0.9);
            setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
        },
    }
}

/// Per-frame paint pass (renderEmbedded): mirror every painted chunk into its
/// reserved node + collider (dirty-coalesced), poll the hover gizmo, and dress
/// the gizmo node. Runs unconditionally — with no painted chunks and paint
/// disarmed it is a cheap slot scan.
fn applyPaintLayer(runtime: *Runtime) void {
    const first = runtime.paint_kids_first orelse return;

    // hover poll: the beam follows the mouse whenever the tool is armed, not
    // just during a drag — no per-motion tree walk needed for hover.
    const armed = paintArmed(runtime.node_id);
    if (armed and !runtime.paint_stroking) {
        var mx: f32 = 0;
        var my: f32 = 0;
        _ = c.SDL_GetMouseState(&mx, &my);
        if (mx >= runtime.paint_last_x and mx <= runtime.paint_last_x + runtime.paint_last_w and
            my >= runtime.paint_last_y and my <= runtime.paint_last_y + runtime.paint_last_h)
        {
            runtime.paint_hover = paintGroundHitAt(runtime, mx, my, 0);
        } else {
            runtime.paint_hover = null;
        }
    } else if (armed and runtime.paint_stroking) {
        // Mid-stroke, the WORLD can move under a held cursor (WASD pans the
        // iso camera) without a single motion event — re-stamp from the
        // per-frame pose so the brush keeps painting along the pan
        // (req_2704). strokeMove dedups per stamp cell, so a stationary
        // cursor over a stationary camera deposits nothing new.
        var mx: f32 = 0;
        var my: f32 = 0;
        _ = c.SDL_GetMouseState(&mx, &my);
        if (paintGroundHitAt(runtime, mx, my, 0)) |hit| {
            runtime.paint_hover = hit;
            map_paint.strokeMove(hit[0], hit[2]);
        }
    } else if (!armed) {
        runtime.paint_hover = null;
    }

    // painted-chunk mirror: assign slots, re-bake dirty heights, refresh colliders
    var foliage_stale = false;
    for (map_chunks.slots()) |maybe| {
        const chunk = maybe orelse continue;
        var slot: ?usize = null;
        var free_slot: ?usize = null;
        for (0..MAX_PAINT_SLOTS) |i| {
            if (runtime.paint_slot_used[i]) {
                if (runtime.paint_slot_chunk[i][0] == chunk.cx and runtime.paint_slot_chunk[i][1] == chunk.cz) {
                    slot = i;
                    break;
                }
            } else if (free_slot == null) {
                free_slot = i;
            }
        }
        const fresh = slot == null;
        if (fresh) {
            slot = free_slot orelse {
                if (!runtime.paint_drop_warned) {
                    runtime.paint_drop_warned = true;
                    log.print("[paint] LIVE MIRROR FULL: >{d} painted chunks — chunk ({d},{d}) not mirrored\n", .{ MAX_PAINT_SLOTS, chunk.cx, chunk.cz });
                }
                continue;
            };
        }
        const i = slot.?;
        const height_dirty = fresh or chunk.dirty.height;
        // flora + zones ride the same packed D stream as the tiles (layout v2),
        // so any cell-channel edit re-encodes it. A formula IDENTITY change also
        // re-encodes: setGroundLook keeps superseded formula bytes alive exactly
        // so this pointer-swap pass can migrate live nodes without a frame ever
        // reading freed memory (SIGSEGV req_2492).
        const live_formula = map_paint.groundFormula();
        const formula_stale = if (live_formula) |f|
            (node_has_formula: {
                const nf = runtime.kid_list.items[first + i].scene3d_ground_formula orelse break :node_has_formula true;
                break :node_has_formula nf.ptr != f.ptr;
            })
        else
            runtime.kid_list.items[first + i].scene3d_ground_formula != null;
        const tiles_dirty = fresh or chunk.dirty.tiles or chunk.dirty.flora or chunk.dirty.zones or (runtime.paint_slot_used[i] and formula_stale);
        // the water surface is bed + depth, so a re-dug bed moves the water too
        const water_dirty = height_dirty or chunk.dirty.water;
        // painted flora grows LITERAL foliage (req_2497): regrow when the lanes
        // change AND when terrain height moves (blades sit on the relief)
        if (fresh or chunk.dirty.flora or height_dirty) foliage_stale = true;
        if (!height_dirty and !tiles_dirty and !water_dirty) continue;

        const half_span = map_chunks.CHUNK_METERS / 2;
        const node = &runtime.kid_list.items[first + i];
        if (fresh) {
            // one-time placement: the chunk is CENTERED at (cx·120, cz·120)
            node.* = .{
                .scene3d_hf_cols = @intCast(map_paint.FLOOR_RES),
                .scene3d_hf_rows = @intCast(map_paint.FLOOR_RES),
                .scene3d_hf_width = map_chunks.CHUNK_METERS,
                .scene3d_hf_depth = map_chunks.CHUNK_METERS,
                .scene3d_hf_base = 0,
                .scene3d_pos_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS,
                .scene3d_pos_y = 0,
                .scene3d_pos_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS,
            };
            runtime.paint_slot_used[i] = true;
            runtime.paint_slot_chunk[i] = .{ chunk.cx, chunk.cz };
        }

        if (height_dirty) {
            const floor = runtime.paint_slot_floor[i] orelse blk: {
                const buf = runtime.allocator.alloc(f32, map_paint.FLOOR_CELLS) catch continue;
                runtime.paint_slot_floor[i] = buf;
                break :blk buf;
            };
            map_paint.downsampleFloorHeights(&chunk.height, floor);
            chunk.dirty.height = false;
            runtime.paint_slot_ver[i] += 1;
            if (runtime.paint_slot_key[i]) |old| runtime.allocator.free(old);
            const key = std.fmt.allocPrint(runtime.allocator, "~hf~paint-{d}-{d}~{d}", .{ chunk.cx, chunk.cz, runtime.paint_slot_ver[i] }) catch continue;
            runtime.paint_slot_key[i] = key;

            var max_abs: f32 = 0;
            for (floor) |v| max_abs = @max(max_abs, @abs(v));
            node.scene3d_mesh = true;
            node.scene3d_geom_key = key;
            node.scene3d_heights = floor;
            node.scene3d_bounds_radius = @sqrt(half_span * half_span * 2 + max_abs * max_abs);

            // collider mirror: same grid the render bakes — see-it == walk-it
            _ = game_physics.registerHeightfield(.{
                .id = PAINT_COLLIDER_BASE + i,
                .origin_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS - half_span,
                .origin_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS - half_span,
                .cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(map_paint.FLOOR_RES - 1)),
                .cols = map_paint.FLOOR_RES,
                .rows = map_paint.FLOOR_RES,
                .base_y = 0,
                .walk_cos = 0.6,
            }, std.mem.sliceAsBytes(floor));
        }

        // ground texture (the tile channel): encode the chunk's cell grid as the
        // ground formula's D stream. The 3d.zig ground pipeline re-reads the
        // node's slice every frame, so no geometry re-key is needed — painting a
        // tile shows next frame. Falls back to the flat editor tint until the
        // cart pushes a formula (__map_set_ground_look).
        if (tiles_dirty) {
            chunk.dirty.tiles = false;
            chunk.dirty.flora = false;
            chunk.dirty.zones = false;
            if (live_formula) |formula| {
                const need = map_paint.groundDataFloats();
                var ground = runtime.paint_slot_ground[i];
                if (ground == null or ground.?.len < need) {
                    if (ground) |old| runtime.allocator.free(old);
                    ground = runtime.allocator.alloc(f32, need) catch null;
                    runtime.paint_slot_ground[i] = ground;
                }
                if (ground) |buf| {
                    const used = map_paint.encodeGroundData(chunk, buf);
                    node.scene3d_ground_formula = formula;
                    node.scene3d_ground_data = buf[0..used];
                    // whitened: the ground pipeline multiplies inst_color in
                    node.scene3d_color_r = 1;
                    node.scene3d_color_g = 1;
                    node.scene3d_color_b = 1;
                }
            } else {
                // the look was cleared — drop the stale pointers, fall to tint
                node.scene3d_ground_formula = null;
                node.scene3d_ground_data = null;
            }
        }
        if (node.scene3d_ground_formula == null) {
            // bare-terrain tint (no formula pushed / nothing painted yet)
            node.scene3d_color_r = 0.42;
            node.scene3d_color_g = 0.52;
            node.scene3d_color_b = 0.34;
        }

        // the water channel: a second "~water~"-pipeline node over the same
        // footprint — shore-culled depths + bed+depth surface, dry cells tucked
        // under the basin floor (paintWaterSurface). Static bake; the water
        // pipeline animates the surface on the GPU from the host clock.
        if (water_dirty) {
            chunk.dirty.water = false;
            const wfirst = runtime.paint_water_kids_first orelse continue;
            const wnode = &runtime.kid_list.items[wfirst + i];
            const floor = runtime.paint_slot_floor[i] orelse continue; // beds (height ran first)
            const depths = runtime.paint_slot_depths[i] orelse blk: {
                const buf = runtime.allocator.alloc(f32, map_paint.FLOOR_CELLS) catch continue;
                runtime.paint_slot_depths[i] = buf;
                break :blk buf;
            };
            const surface = runtime.paint_slot_surface[i] orelse blk: {
                const buf = runtime.allocator.alloc(f32, map_paint.FLOOR_CELLS) catch continue;
                runtime.paint_slot_surface[i] = buf;
                break :blk buf;
            };
            // Depth must ride the EXACT source sample selected for the terrain
            // bed. Independent abs-max passes can combine a dry +6 m bank with
            // a neighbouring 2 m depth and invent an 8 m water surface.
            map_paint.downsampleFloorWaterDepths(&chunk.height, &chunk.water, depths);
            const wet = paintWaterSurface(depths, floor, depths, surface);
            if (!wet) {
                wnode.scene3d_mesh = false;
            } else {
                runtime.paint_slot_water_ver[i] += 1;
                if (runtime.paint_slot_water_key[i]) |old| runtime.allocator.free(old);
                const wkey = std.fmt.allocPrint(runtime.allocator, "~hf~paint-water-{d}-{d}~{d}", .{ chunk.cx, chunk.cz, runtime.paint_slot_water_ver[i] }) catch continue;
                runtime.paint_slot_water_key[i] = wkey;
                var wmax: f32 = 0;
                for (surface) |v| wmax = @max(wmax, @abs(v));
                wnode.* = .{
                    .scene3d_mesh = true,
                    .scene3d_geom_key = wkey,
                    .scene3d_tex_key = "~water~",
                    .scene3d_heights = surface,
                    .scene3d_hf_depths = depths,
                    .scene3d_hf_cols = @intCast(map_paint.FLOOR_RES),
                    .scene3d_hf_rows = @intCast(map_paint.FLOOR_RES),
                    .scene3d_hf_width = map_chunks.CHUNK_METERS,
                    .scene3d_hf_depth = map_chunks.CHUNK_METERS,
                    .scene3d_hf_base = 0,
                    .scene3d_bounds_radius = @sqrt(half_span * half_span * 2 + wmax * wmax),
                    .scene3d_pos_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS,
                    .scene3d_pos_y = 0,
                    .scene3d_pos_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS,
                    // inst_color is ignored by the water shader; opaque keeps it
                    // on the pipeline-swap path (color_a < 1 would divert it)
                    .scene3d_color_a = 1,
                };
            }
        }
    }

    // req_2838: when the last regen CLIPPED a family, the preview follows the
    // author's attention — once the anchor (brush, else camera look) drifts
    // half a chunk from where the budget was last spent, regrow around the new
    // spot. Quiet regen (no saturation log) so panning doesn't spam it.
    var foliage_follow = false;
    if (!foliage_stale and runtime.paint_foliage_clipped) {
        const anchor = paintPreviewAnchor(runtime);
        const dx = anchor[0] - runtime.paint_foliage_anchor[0];
        const dz = anchor[1] - runtime.paint_foliage_anchor[1];
        const step = map_chunks.CHUNK_METERS * 0.5;
        foliage_follow = dx * dx + dz * dz > step * step;
    }
    if (foliage_stale or foliage_follow) requestFoliageRegen(runtime, foliage_stale);
    // req_2864: apply finished worker regens + feed the worker its next job.
    // The regen itself runs OFF this thread — a paint frame spends microseconds
    // here no matter how much of the world is planted.
    pollFoliageRegen(runtime);

    // the brush gizmo: preview-only chrome over the footprint at the hover point
    if (runtime.paint_beam_kid) |beam_kid| {
        const node = &runtime.kid_list.items[beam_kid];
        if (armed and runtime.paint_hover != null) {
            const hover = runtime.paint_hover.?;
            const tool = map_paint.tool();
            dressPaintGizmo(runtime, node, hover, tool);
        } else {
            node.scene3d_mesh = false;
        }
    }
}

// ── the live-foliage preview (req_2497) ───────────────────────────────────────
// Painting flora grows LITERAL foliage: the SAME foliage.zig generators the
// baked FLORA recipe expands through, driven straight off the painted lanes.
// Regenerated whole (all painted chunks) on any flora/height change —
// authoring-rate work; the nodes are static instance batches re-uploaded once
// per regen via the version bump, zero per-frame cost.

fn lerpF64(a: f64, b: f64, t: f64) f64 {
    return a + (b - a) * t;
}

/// Seeded Fisher–Yates over rows [first, end) of a family buffer (req_2868).
/// Deterministic per chunk: the same permutation every regen, so the distant
/// LOD subset never shimmers while painting elsewhere. WORKER THREAD.
fn shuffleFoliageRows(buf: []f32, first: u32, end: u32, seed: u32) void {
    var h = seed;
    var i: u32 = end - first;
    while (i > 1) {
        i -= 1;
        h = foliage.mix(h);
        const j = h % (i + 1);
        if (j == i) continue;
        const a = @as(usize, first + i) * foliage.STRIDE;
        const b = @as(usize, first + j) * foliage.STRIDE;
        var k: usize = 0;
        while (k < foliage.STRIDE) : (k += 1) {
            const tmp = buf[a + k];
            buf[a + k] = buf[b + k];
            buf[b + k] = tmp;
        }
    }
}

/// Ground height on the surface the painted ground RENDERS — the chunk's
/// 121-grid abs-max floor downsample (the same grid the collider walks).
/// heightAt's fine 241-grid bilinear can sit up to half a metre BELOW the
/// rendered slope, which drowned 0.3 m grass while 1.6 m bush poked through
/// (req_2704). Falls back to heightAt while the chunk has no mirrored floor.
/// MAIN THREAD only (live chunk reads) — the foliage worker uses its snapshot
/// twin snapGroundY (req_2864); the req_2699 per-row re-seat lives inline in
/// the worker walk.
fn paintGroundY(floor: ?[]const f32, chunk: *const map_chunks.Chunk, wx: f32, wz: f32) f32 {
    const f = floor orelse return map_paint.heightAt(wx, wz);
    const res = map_paint.FLOOR_RES;
    const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
    const max_i: f32 = @floatFromInt(res - 1);
    const gx = @max(0, @min(max_i, (wx - chunk.minX()) / cell));
    const gz = @max(0, @min(max_i, (wz - chunk.minZ()) / cell));
    const x0: usize = @intFromFloat(@floor(gx));
    const z0: usize = @intFromFloat(@floor(gz));
    const x1 = @min(x0 + 1, res - 1);
    const z1 = @min(z0 + 1, res - 1);
    const tx = gx - @floor(gx);
    const tz = gz - @floor(gz);
    const h00 = f[z0 * res + x0];
    const h10 = f[z0 * res + x1];
    const h01 = f[z1 * res + x0];
    const h11 = f[z1 * res + x1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
}

/// The mirrored render-floor slice for a painted chunk, if it has a slot.
fn paintSlotFloorFor(runtime: *Runtime, cx: i32, cz: i32) ?[]const f32 {
    for (0..MAX_PAINT_SLOTS) |i| {
        if (runtime.paint_slot_used[i] and runtime.paint_slot_chunk[i][0] == cx and runtime.paint_slot_chunk[i][1] == cz) {
            return runtime.paint_slot_floor[i];
        }
    }
    return null;
}

/// Append one 12-float foliage row, GROWING the family when full (req_2843:
/// the row caps are STARTING sizes, not walls — "the 15.5mb cap on flora is
/// killing me"). The doubled CPU buffer re-keys the render batch and the GPU
/// pool grows to match (gpu/3d.zig growStaticPool); the recycled old region
/// ages out of the retain cache. false = the ALLOCATOR refused the growth —
/// the machine's honest wall, not a budget's. Runs on the foliage WORKER
/// thread (req_2864) — alloc is the thread-safe c_allocator, and the GREW
/// log prints through std.debug (mutex-serialized).
fn pushFoliageRow(alloc: std.mem.Allocator, slot: *?[]f32, name: []const u8, count: *u32, row: [foliage.STRIDE]f32) bool {
    var buf = slot.*.?;
    const cap: u32 = @intCast(buf.len / foliage.STRIDE);
    if (count.* >= cap) {
        const grown = alloc.realloc(buf, buf.len * 2) catch return false;
        slot.* = grown;
        buf = grown;
        std.debug.print("[paint] LIVE FOLIAGE PREVIEW GREW: {s} → {d} rows ({d} MiB CPU) — elastic budget, the machine is the wall (req_2843)\n", .{ name, buf.len / foliage.STRIDE, buf.len * @sizeOf(f32) / (1024 * 1024) });
    }
    const at = @as(usize, count.*) * foliage.STRIDE;
    @memcpy(buf[at .. at + foliage.STRIDE], row[0..]);
    count.* += 1;
    return true;
}

/// Marker for the regen-end saturation log: names WHICH family hit its cap.
fn clippedMark(family_full: bool) []const u8 {
    return if (family_full) " CLIPPED" else "";
}

fn ensureFoliageBuf(alloc: std.mem.Allocator, slot: *?[]f32, cap: u32) ?[]f32 {
    if (slot.*) |buf| return buf;
    const buf = alloc.alloc(f32, @as(usize, cap) * foliage.STRIDE) catch return null;
    slot.* = buf;
    return buf;
}

/// Where the author's attention is (req_2838): the brush hover point when the
/// painter is armed, else the camera's look target (the pushed external pose
/// in editor mode). The foliage preview budget spends nearest-first from here.
fn paintPreviewAnchor(runtime: *Runtime) [2]f32 {
    if (runtime.paint_hover) |h| return .{ h[0], h[2] };
    const look = if (runtime.camera.external) runtime.camera.ext_look else runtime.camera.current_target;
    return .{ look.x, look.z };
}

// ── the foliage regen WORKER (req_2864) ──────────────────────────────────────
// Painting at 240fps leaves ~4ms of frame budget; a whole-preview regen costs
// tens of ms and used to run synchronously on every stroke frame (240 → 10fps
// with a moving brush). The regen now runs on ONE worker thread behind a
// strictly serial mailbox (the pose_mailbox pattern, req_2845):
//
//   stroke → requestFoliageRegen flags `foliage_want`
//   pollFoliageRegen (every paint frame): applies a finished result (pointer
//   swap + version bump — microseconds), then turns `want` into a job when
//   the box is idle: SNAPSHOT the painted chunks (flora lanes + render
//   floor) and submit.
//   worker: grows rows + per-chunk segments (req_2859) into the row set the
//   renderer is NOT displaying, reading the snapshot alone — it never touches
//   live chunk storage, so painting continues freely while it works.
//
// Stroke bursts coalesce: however many cells change during a regen, the next
// job regenerates once from the newest snapshot. The preview lags the brush
// by one regen; the frame rate never does.

const FoliageChunkSnap = struct {
    cx: i32,
    cz: i32,
    flora: [map_chunks.FLORA_LAYER_COUNT][map_chunks.TILE_CELLS]i16,
    floor: [map_paint.FLOOR_CELLS]f32,
};

const FoliageSnapSlot = struct {
    chunks: []FoliageChunkSnap = &.{},
    count: u32 = 0,
};

/// One ping-pong half of the preview: every PaintFoliageFamily's rows + its
/// per-chunk segments, in the exact node order declared above. The
/// renderer displays one set while the worker fills the other.
const FoliageRowSet = struct {
    rows: [PAINT_FOLIAGE_FAMILY_COUNT]?[]f32 = @splat(null),
    segs: [PAINT_FOLIAGE_FAMILY_COUNT]std.ArrayListUnmanaged(layout.InstanceSegment) = @splat(.{}),
};

const FoliageJob = struct {
    set: u8,
    anchor: [2]f32,
    log_full: bool,
    specs: [map_paint.MAX_PALETTE]?map_paint.FloraSpec,
};

const FoliageResult = struct {
    set: u8,
    counts: [PAINT_FOLIAGE_FAMILY_COUNT]u32,
    fulls: [PAINT_FOLIAGE_FAMILY_COUNT]bool,
    segs_ok: [PAINT_FOLIAGE_FAMILY_COUNT]bool,
    anchor: [2]f32,
    log_full: bool,
};

/// Strictly serial cross-thread mailbox: at most ONE job anywhere in the
/// pipeline (pending, working, or unpolled result). submit() only succeeds
/// when fully idle, so snapshot/row-set ownership never overlaps between
/// the main thread and the worker.
const FoliageMailbox = struct {
    mutex: std.Thread.Mutex = .{},
    cond: std.Thread.Condition = .{},
    pending: ?FoliageJob = null,
    result: ?FoliageResult = null,
    working: bool = false,
    shutdown: bool = false,

    fn idle(self: *FoliageMailbox) bool {
        self.mutex.lock();
        defer self.mutex.unlock();
        return self.pending == null and !self.working and self.result == null;
    }

    fn submit(self: *FoliageMailbox, job: FoliageJob) bool {
        self.mutex.lock();
        defer self.mutex.unlock();
        if (self.shutdown) return false;
        if (self.pending != null or self.working or self.result != null) return false;
        self.pending = job;
        self.cond.signal();
        return true;
    }

    /// Worker-only blocking take. `null` means shutdown.
    fn waitTake(self: *FoliageMailbox) ?FoliageJob {
        self.mutex.lock();
        defer self.mutex.unlock();
        while (self.pending == null and !self.shutdown) self.cond.wait(&self.mutex);
        if (self.shutdown) return null;
        const job = self.pending.?;
        self.pending = null;
        self.working = true;
        return job;
    }

    fn publish(self: *FoliageMailbox, result: FoliageResult) void {
        self.mutex.lock();
        defer self.mutex.unlock();
        self.working = false;
        if (!self.shutdown) self.result = result;
    }

    fn poll(self: *FoliageMailbox) ?FoliageResult {
        self.mutex.lock();
        defer self.mutex.unlock();
        const out = self.result;
        self.result = null;
        return out;
    }

    fn stop(self: *FoliageMailbox) void {
        self.mutex.lock();
        self.shutdown = true;
        self.cond.signal();
        self.mutex.unlock();
    }
};

/// paintGroundY's snapshot twin (req_2704 semantics: the 121-grid render
/// floor is the surface plants must seat on). Bilinear over COPIED floor
/// data — the worker never reads live chunk storage.
fn snapGroundY(floor: *const [map_paint.FLOOR_CELLS]f32, min_x: f32, min_z: f32, wx: f32, wz: f32) f32 {
    const res = map_paint.FLOOR_RES;
    const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
    const max_i: f32 = @floatFromInt(res - 1);
    const gx = @max(0, @min(max_i, (wx - min_x) / cell));
    const gz = @max(0, @min(max_i, (wz - min_z) / cell));
    const x0: usize = @intFromFloat(@floor(gx));
    const z0: usize = @intFromFloat(@floor(gz));
    const x1 = @min(x0 + 1, res - 1);
    const z1 = @min(z0 + 1, res - 1);
    const tx = gx - @floor(gx);
    const tz = gz - @floor(gz);
    const h00 = floor[z0 * res + x0];
    const h10 = floor[z0 * res + x1];
    const h01 = floor[z1 * res + x0];
    const h11 = floor[z1 * res + x1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
}

/// MAIN THREAD: copy every painted chunk's flora lanes + render floor into
/// the snapshot slot (~150KB memcpy per chunk). Chunks without a paint slot
/// get their floor sampled from heightAt at the same 121 dots here, so the
/// worker never calls into live engine state.
fn snapshotPaintedChunks(runtime: *Runtime) bool {
    var count: u32 = 0;
    for (map_chunks.slots()) |maybe| {
        if (maybe != null) count += 1;
    }
    const snap = &runtime.foliage_snap;
    if (count == 0) {
        snap.count = 0;
        return true;
    }
    if (snap.chunks.len < count) {
        snap.chunks = std.heap.c_allocator.realloc(snap.chunks, count) catch return false;
    }
    var i: u32 = 0;
    for (map_chunks.slots()) |maybe| {
        const chunk = maybe orelse continue;
        const dst = &snap.chunks[i];
        dst.cx = chunk.cx;
        dst.cz = chunk.cz;
        dst.flora = chunk.flora;
        if (paintSlotFloorFor(runtime, chunk.cx, chunk.cz)) |floor| {
            @memcpy(dst.floor[0..], floor);
        } else {
            const res = map_paint.FLOOR_RES;
            const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
            var gz: usize = 0;
            while (gz < res) : (gz += 1) {
                var gx: usize = 0;
                while (gx < res) : (gx += 1) {
                    const wx = chunk.minX() + @as(f32, @floatFromInt(gx)) * cell;
                    const wz = chunk.minZ() + @as(f32, @floatFromInt(gz)) * cell;
                    dst.floor[gz * res + gx] = map_paint.heightAt(wx, wz);
                }
            }
        }
        i += 1;
    }
    snap.count = i;
    return true;
}

/// `log_full` is true on paint-driven regens (the saturation warning prints);
/// anchor-follow regens pass false so panning the camera doesn't spam it.
/// This only FLAGS the want — pollFoliageRegen turns it into a worker job.
fn requestFoliageRegen(runtime: *Runtime, log_full: bool) void {
    runtime.foliage_want = true;
    if (log_full) runtime.foliage_want_log = true;
}

/// MAIN THREAD, every paint-layer frame: apply a finished regen, then feed
/// the worker if a regen is wanted and the pipeline is idle.
fn pollFoliageRegen(runtime: *Runtime) void {
    if (runtime.foliage_box.poll()) |result| applyFoliageResult(runtime, result);
    if (!runtime.foliage_want) return;
    if (!runtime.foliage_box.idle()) return;
    if (runtime.foliage_worker == null) {
        runtime.foliage_worker = std.Thread.spawn(.{}, foliageWorkerMain, .{runtime}) catch |err| {
            log.print("[paint] foliage worker spawn FAILED ({any}) — live foliage preview will not update\n", .{err});
            runtime.foliage_want = false;
            runtime.foliage_want_log = false;
            return;
        };
    }
    if (!snapshotPaintedChunks(runtime)) return; // OOM: keep the want, retry next frame
    var job = FoliageJob{
        .set = 1 - runtime.foliage_display,
        .anchor = paintPreviewAnchor(runtime),
        .log_full = runtime.foliage_want_log,
        .specs = undefined,
    };
    for (0..map_paint.MAX_PALETTE) |k| job.specs[k] = map_paint.floraSpec(@intCast(k));
    if (runtime.foliage_box.submit(job)) {
        runtime.foliage_want = false;
        runtime.foliage_want_log = false;
    }
}

/// MAIN THREAD: point every family kid at the finished row set. This is
/// the regen's only frame-time cost — pointers, counts, one version bump.
fn applyFoliageResult(runtime: *Runtime, result: FoliageResult) void {
    const first = runtime.paint_foliage_kids_first orelse return;
    runtime.foliage_display = result.set;
    const set = &runtime.foliage_sets[result.set];
    // A family only reads full when the ALLOCATOR refused to grow it — the
    // machine's wall, not a budget's (req_2843: the caps are starting sizes).
    var any_full = false;
    for (result.fulls) |family_full| any_full = any_full or family_full;
    runtime.paint_foliage_clipped = any_full;
    runtime.paint_foliage_anchor = result.anchor;
    if (result.log_full and any_full) {
        const cap = struct {
            fn rows(maybe: ?[]f32) usize {
                return if (maybe) |buf| buf.len / foliage.STRIDE else 0;
            }
        };
        log.print("[paint] LIVE FOLIAGE PREVIEW at the MACHINE'S wall (", .{});
        for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
            log.print("{s}{s} {d}/{d}{s}", .{
                if (fi == 0) "" else " · ",
                PAINT_FOLIAGE_NAMES[fi],
                result.counts[fi],
                cap.rows(set.rows[fi]),
                clippedMark(result.fulls[fi]),
            });
        }
        log.print(") — allocator refused further growth; nearest-first keeps clipping far from the brush. Compile grows the full population\n", .{});
    }
    runtime.paint_foliage_ver += 1;
    for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
        const node = &runtime.kid_list.items[first + fi];
        const buf = set.rows[fi] orelse {
            node.scene3d_mesh = false;
            continue;
        };
        // the FULL family slice every time: the static instance region is
        // reserved at first upload and re-uploaded in place on version bumps.
        // The slice only changes when the family GROWS (req_2843) — the
        // renderer then retains a fresh region and the old one ages out of
        // the cache (gpu/3d.zig staticCacheSlot).
        node.scene3d_instance_data = buf;
        node.scene3d_instance_count = result.counts[fi];
        node.scene3d_instance_version = runtime.paint_foliage_ver;
        node.scene3d_mesh = result.counts[fi] > 0;
        // req_2859: this family's per-chunk ranges, for frustum culling. A
        // family whose segment append failed draws whole.
        const segs = set.segs[fi].items;
        node.scene3d_instance_segments = if (result.segs_ok[fi] and segs.len > 0) segs else null;
        // req_2868: only ground flora is per-chunk shuffled. Palm parts and
        // whole wrapped plants keep authored order and draw their full silhouette.
        node.scene3d_instance_lod_density = fi < PAINT_FOLIAGE_THINNABLE_COUNT and node.scene3d_instance_segments != null;
    }
}

/// WORKER THREAD entry: block on the mailbox, regen, publish, repeat.
fn foliageWorkerMain(runtime: *Runtime) void {
    while (runtime.foliage_box.waitTake()) |job| {
        runtime.foliage_box.publish(buildFoliageRows(runtime, job));
    }
}

/// WORKER THREAD: the regen walk — grow every painted cell's plants from the
/// snapshot into the off-display row set. Reads the snapshot and job ONLY.
fn buildFoliageRows(runtime: *Runtime, job: FoliageJob) FoliageResult {
    const alloc = std.heap.c_allocator;
    const set = &runtime.foliage_sets[job.set];
    var result = FoliageResult{
        .set = job.set,
        .counts = @splat(0),
        .fulls = @splat(false),
        .segs_ok = @splat(true),
        .anchor = job.anchor,
        .log_full = job.log_full,
    };
    for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
        if (ensureFoliageBuf(alloc, &set.rows[fi], PAINT_FOLIAGE_START_CAPS[fi]) == null) return result;
        set.segs[fi].clearRetainingCapacity();
    }

    var counts: [PAINT_FOLIAGE_FAMILY_COUNT]u32 = @splat(0);
    var fulls: [PAINT_FOLIAGE_FAMILY_COUNT]bool = @splat(false);

    // req_2838: the budget spends NEAREST-FIRST from the author's anchor, so a
    // saturated preview undresses the FARTHEST chunks — never the one under
    // the brush. Raw slot order dropped whatever chunks the walk reached last,
    // which could be exactly where the user was painting (invisible strokes).
    const Order = struct {
        idx: u32,
        d2: f32,
        fn closer(_: void, a: @This(), b: @This()) bool {
            return a.d2 < b.d2;
        }
    };
    var order: [map_chunks.SLOT_COUNT]Order = undefined;
    const snap = &runtime.foliage_snap;
    const n_chunks: usize = @min(snap.count, snap.chunks.len);
    for (snap.chunks[0..n_chunks], 0..) |*chunk_snap, ci| {
        // chunks are CENTERED at (cx·CHUNK_METERS, cz·CHUNK_METERS)
        const dx = @as(f32, @floatFromInt(chunk_snap.cx)) * map_chunks.CHUNK_METERS - job.anchor[0];
        const dz = @as(f32, @floatFromInt(chunk_snap.cz)) * map_chunks.CHUNK_METERS - job.anchor[1];
        order[ci] = .{ .idx = @intCast(ci), .d2 = dx * dx + dz * dz };
    }
    std.sort.pdq(Order, order[0..n_chunks], {}, Order.closer);

    for (order[0..n_chunks]) |entry| {
        const chunk_snap = &snap.chunks[entry.idx];
        const min_x = @as(f32, @floatFromInt(chunk_snap.cx)) * map_chunks.CHUNK_METERS - map_chunks.CHUNK_METERS / 2;
        const min_z = @as(f32, @floatFromInt(chunk_snap.cz)) * map_chunks.CHUNK_METERS - map_chunks.CHUNK_METERS / 2;
        const seg_start = counts;
        var seg_ymin: f32 = std.math.floatMax(f32);
        var seg_ymax: f32 = -std.math.floatMax(f32);
        var lz: i32 = 0;
        while (lz < map_chunks.CHUNK_TILES) : (lz += 1) {
            var lx: i32 = 0;
            while (lx < map_chunks.CHUNK_TILES) : (lx += 1) {
                const idx = @as(usize, @intCast(lz)) * map_chunks.TILE_COLS + @as(usize, @intCast(lx));
                var lane: usize = 0;
                while (lane < map_chunks.FLORA_LAYER_COUNT) : (lane += 1) {
                    const kind = chunk_snap.flora[lane][idx];
                    if (kind < 0 or kind >= @as(i16, @intCast(map_paint.MAX_PALETTE))) continue;
                    const spec = job.specs[@intCast(kind)] orelse continue;
                    const recipe = foliage.specFromWire(spec.spec) orelse continue;
                    const wx = min_x + @as(f32, @floatFromInt(lx)) + 0.5;
                    const wz = min_z + @as(f32, @floatFromInt(lz)) + 0.5;
                    const top: f64 = snapGroundY(&chunk_snap.floor, min_x, min_z, wx, wz);
                    seg_ymin = @min(seg_ymin, @as(f32, @floatCast(top)));
                    seg_ymax = @max(seg_ymax, @as(f32, @floatCast(top)));
                    const gx = chunk_snap.cx * map_chunks.CHUNK_TILES + lx;
                    const gz = chunk_snap.cz * map_chunks.CHUNK_TILES + lz;
                    const cell_key: u32 = (@as(u32, @bitCast(gx)) *% 0x9E3779B1) ^
                        (@as(u32, @bitCast(gz)) *% 0x85EBCA77) ^
                        (@as(u32, @intCast(lane + 1)) *% 0xC2B2AE3D);

                    if (foliage.wrappedSpecies(recipe)) |species| {
                        if (foliage.wrappedSpawnRoll(species, cell_key) > spec.chance) continue;
                        var wrapped_row = foliage.wrappedRow(species, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key);
                        wrapped_row[1] += snapGroundY(&chunk_snap.floor, min_x, min_z, wrapped_row[0], wrapped_row[2]) - @as(f32, @floatCast(top));
                        const fi = PAINT_WRAPPED_FAMILY_FIRST + @intFromEnum(species);
                        if (!pushFoliageRow(alloc, &set.rows[fi], PAINT_FOLIAGE_NAMES[fi], &counts[fi], wrapped_row)) fulls[fi] = true;
                        continue;
                    }
                    switch (recipe) {
                        .palm => {
                            // Palms are density-GATED per cell (most stay bare — the
                            // grove look) and roll trunk + crown off the SAME hash
                            // chain palmPopulation.ts uses, so bark and fronds agree.
                            const seed = foliage.mix(cell_key ^ 0x9d2c5680);
                            if (foliage.unit(seed) > spec.chance) continue;
                            const h0 = foliage.mix(seed ^ 0x1b56c4e9);
                            const h1 = foliage.mix(h0 ^ 0x68bc21eb);
                            const h2 = foliage.mix(h1 ^ 0x7feb352d);
                            const trunk_h = lerpF64(foliage.PALM.trunk_h_min, foliage.PALM.trunk_h_max, foliage.unit(h0));
                            const radius = lerpF64(PALM_TRUNK_RADIUS_MIN, PALM_TRUNK_RADIUS_MAX, foliage.unit(h1));
                            const lean = (foliage.unit(foliage.mix(h2 ^ 0x51)) - 0.5) * 0.8 * 140.0;
                            const px = @as(f64, wx) + (foliage.unit(foliage.mix(h0 ^ 0xa5)) - 0.5) * 0.7;
                            const pz = @as(f64, wz) + (foliage.unit(foliage.mix(h1 ^ 0xa5)) - 0.5) * 0.7;
                            const span: f32 = @floatCast(radius / PALM_TRUNK_UNIT_RADIUS);
                            // Trunk + crown ride ONE ground delta (the trunk's
                            // footing) so bark and fronds stay attached on slopes.
                            const trunk_delta = snapGroundY(&chunk_snap.floor, min_x, min_z, @floatCast(px), @floatCast(pz)) - @as(f32, @floatCast(top));
                            const trunk_fi = @intFromEnum(PaintFoliageFamily.palm_trunks);
                            if (!pushFoliageRow(alloc, &set.rows[trunk_fi], PAINT_FOLIAGE_NAMES[trunk_fi], &counts[trunk_fi], .{
                                @floatCast(px),      @as(f32, @floatCast(top)) + trunk_delta, @floatCast(pz),
                                0,                   @floatCast(lean),                        0,
                                span,                @floatCast(trunk_h),                     span,
                                PALM_TRUNK_COLOR[0], PALM_TRUNK_COLOR[1],                     PALM_TRUNK_COLOR[2],
                            })) fulls[trunk_fi] = true;
                            const crown = foliage.palmCrown(&foliage.PALM, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key);
                            const fc = crown.total();
                            const frond_fi = @intFromEnum(PaintFoliageFamily.palm_fronds);
                            var k: u32 = 0;
                            while (k < fc) : (k += 1) {
                                var row = foliage.palmFrondRow(&crown, k);
                                row[1] += trunk_delta;
                                if (!pushFoliageRow(alloc, &set.rows[frond_fi], PAINT_FOLIAGE_NAMES[frond_fi], &counts[frond_fi], row)) fulls[frond_fi] = true;
                            }
                        },
                        .flowers => {
                            const fi = @intFromEnum(PaintFoliageFamily.flowers);
                            var k: u32 = 0;
                            while (k < spec.count) : (k += 1) {
                                var row = foliage.flowerRow(&foliage.FLOWER, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key, k);
                                // re-seat on the terrain under the row's OWN x/z
                                // (req_2699: cell-centre height buries slope rows)
                                row[1] += snapGroundY(&chunk_snap.floor, min_x, min_z, row[0], row[2]) - @as(f32, @floatCast(top));
                                if (!pushFoliageRow(alloc, &set.rows[fi], PAINT_FOLIAGE_NAMES[fi], &counts[fi], row)) fulls[fi] = true;
                            }
                        },
                        else => if (foliage.bladePopulation(recipe)) |population| {
                            const family: PaintFoliageFamily = if (population.family == .grass) .grass else .bush;
                            const fi = @intFromEnum(family);
                            var k: u32 = 0;
                            while (k < spec.count) : (k += 1) {
                                var row = foliage.bladeRow(population.config, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key, k);
                                row[1] += snapGroundY(&chunk_snap.floor, min_x, min_z, row[0], row[2]) - @as(f32, @floatCast(top));
                                if (!pushFoliageRow(alloc, &set.rows[fi], PAINT_FOLIAGE_NAMES[fi], &counts[fi], row)) fulls[fi] = true;
                            }
                        },
                    }
                }
            }
        }
        // Close out this chunk's segments (req_2859): one {row range, sphere}
        // per family that grew rows here. Sphere = chunk half-diagonal (+
        // lateral jitter) horizontally, sampled ground span + tallest-plant
        // headroom (the tallest wrapped flora is <16 m) vertically; conservative
        // bounds only ever draw a little extra, never cull a visible plant.
        const seg_end = counts;
        // req_2868: shuffle each thin-able family's chunk rows (seeded per
        // chunk, IDENTICAL across regens — no distant shimmer while painting)
        // so a PREFIX of the range is a spatially uniform density subset; the
        // renderer's distance LOD draws prefixes. Palm parts and whole wrapped
        // species anchor the silhouette and always draw whole.
        const chunk_seed: u32 = (@as(u32, @bitCast(chunk_snap.cx)) *% 0x9E3779B1) ^
            (@as(u32, @bitCast(chunk_snap.cz)) *% 0x85EBCA77);
        for (0..PAINT_FOLIAGE_THINNABLE_COUNT) |fi| {
            if (seg_end[fi] > seg_start[fi]) {
                shuffleFoliageRows(set.rows[fi].?, seg_start[fi], seg_end[fi], chunk_seed +% @as(u32, @intCast(fi)));
            }
        }
        const seg_cx = @as(f32, @floatFromInt(chunk_snap.cx)) * map_chunks.CHUNK_METERS;
        const seg_cz = @as(f32, @floatFromInt(chunk_snap.cz)) * map_chunks.CHUNK_METERS;
        const seg_grounded = seg_ymax >= seg_ymin;
        const seg_cy: f32 = if (seg_grounded) (seg_ymin + seg_ymax) * 0.5 else 0;
        const seg_yhalf: f32 = (if (seg_grounded) (seg_ymax - seg_ymin) * 0.5 else 0) + FOLIAGE_SEGMENT_HEADROOM_M;
        const seg_radius: f32 = @sqrt(FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M * FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M + seg_yhalf * seg_yhalf);
        for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
            const added = seg_end[fi] - seg_start[fi];
            if (added == 0 or !result.segs_ok[fi]) continue;
            set.segs[fi].append(alloc, .{
                .first = seg_start[fi],
                .count = added,
                .cx = seg_cx,
                .cy = seg_cy,
                .cz = seg_cz,
                .radius = seg_radius,
            }) catch {
                result.segs_ok[fi] = false;
            };
        }
    }

    result.counts = counts;
    result.fulls = fulls;
    return result;
}

fn findMounted(node_id: u32) ?*MountedLoader {
    for (&g_mounted_loaders) |*entry| {
        const runtime = entry.runtime orelse continue;
        if (entry.active and runtime.node_id == node_id) return entry;
    }
    return null;
}

fn findVacantMounted() ?*MountedLoader {
    for (&g_mounted_loaders) |*entry| {
        if (!entry.active) return entry;
    }
    return null;
}

pub fn mount(allocator: std.mem.Allocator, node_id: u32, game_file: []const u8, store_dir: []const u8) !void {
    if (node_id == 0) return error.BadNodeId;
    unmount(node_id);
    const entry = findVacantMounted() orelse return error.TooManyWorldLoaders;
    entry.runtime = try Runtime.create(allocator, game_file, store_dir, node_id);
    entry.active = true;
}

pub fn unmount(node_id: u32) void {
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| runtime.destroy();
        entry.runtime = null;
        entry.active = false;
    }
}

fn runtimeForNode(allocator: std.mem.Allocator, node: *Node) !*Runtime {
    if (node.id == 0) return error.BadNodeId;
    if (findMounted(node.id)) |entry| {
        if (entry.runtime) |runtime| return runtime;
    }
    const game_file = node.world_loader_game_file orelse "zig-out/game/hmsc.gamefile";
    const store_dir = node.world_loader_store_dir orelse STORE_DIR;
    try mount(allocator, node.id, game_file, store_dir);
    const entry = findMounted(node.id) orelse return error.MountFailed;
    return entry.runtime orelse error.MountFailed;
}

pub fn renderEmbedded(allocator: std.mem.Allocator, node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    const runtime = runtimeForNode(allocator, node) catch |err| {
        log.print("[loader] embedded mount/render failed for node {d}: {any}\n", .{ node.id, err });
        return false;
    };
    runtime.last_aspect = w / @max(h, 1); // streaming's sight culling needs the real pane shape
    applyPendingCam(runtime); // LOADERVIEW req_1757: editor iso pose, re-applied each frame
    // [live-diag req_1812] RJIT_LIVE_PROBE=1: inject ONE bright box at the camera's look
    // target so a headless shot proves whether the live overlay RENDERS at all (isolates
    // the Zig draw path from the JS push). Only when nothing real is set for this node.
    if (std.posix.getenv("RJIT_LIVE_PROBE") != null) {
        const cur = pendingLiveFor(node.id);
        if (cur == null or cur.?.count == 0) {
            const lk = runtime.camera.ext_look;
            var row = [_]f32{ lk.x, lk.y + 2, lk.z, 0, 0, 0, 6, 6, 6, 1, 0, 0 }; // red 6m cube
            setLivePieces(node.id, std.mem.sliceAsBytes(row[0..]));
            log.print("[live-probe] injected red box at ({d:.1},{d:.1},{d:.1})\n", .{ lk.x, lk.y + 2, lk.z });
        }
    }
    applyPendingLive(runtime); // LIVEHOST req_1798: just-placed pieces, drawn without a rebake
    applyLiveColliders(runtime); // req_2792: those same pieces COLLIDE — walls are solid in playtest
    applyPendingPhysics(runtime); // GLOBALS req_2770: live physics tuning, read by the next step
    // MAPPAINT req_2473: the pane rect feeds the screen→ray mapping; the paint
    // layer mirrors painted chunks + colliders and dresses the brush beam.
    runtime.paint_last_x = x;
    runtime.paint_last_y = y;
    runtime.paint_last_w = w;
    runtime.paint_last_h = h;
    applyPaintLayer(runtime);
    runtime.stepNow();
    runtime.ensureMaterials();
    const ok = scene3d.render(&runtime.root, x, y, w, h, opacity);
    // Interaction HUD (PROPUSE req_0624) — queued after the world quad so the
    // image-boundary segmentation draws it on top, inside this pane.
    if (ok) runtime.drawHud(x, y, w, h);
    return ok;
}

/// WORLDWIN-0611: step a mounted runtime and render it into a CALLER-OWNED
/// detached target — the pop-out window path. Unlike renderEmbedded nothing
/// is queued into the main window's 2D stream; the returned view is the
/// window's to blit. The runtime must already be mounted (mount()).
pub fn renderDetachedView(node_id: u32, target: *scene3d.DetachedTarget, w: f32, h: f32) ?*wgpu.TextureView {
    const entry = findMounted(node_id) orelse return null;
    const runtime = entry.runtime orelse return null;
    runtime.last_aspect = w / @max(h, 1);
    runtime.stepNow();
    runtime.ensureMaterials();
    return scene3d.renderDetached(target, &runtime.root, w, h);
}

/// WORLDWIN + PROPUSE req_0624: queue the interaction HUD prims for a
/// window-mounted runtime at (0,0,w,h). The window's frame draws them into
/// its own pass (world_window.zig owns globals/upload/reset around it).
pub fn drawHudForWindow(node_id: u32, w: f32, h: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.drawHud(0, 0, w, h);
}

pub fn mouseLook(node_id: u32, dx: f32, dy: f32) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.mouseLook(dx, dy);
}

/// LOADERVIEW req_1757: drive the camera from the editor's already-solved iso pose
/// (eye position + look target + fov degrees) instead of trailing the player. The pose
/// SNAPS each frame (no smoothing/spring-arm) so it tracks orbit/zoom drag frame-exact.
/// JS owns the solve (GAME_CAMERA.solve), so the render matches its picking ray.
pub fn setExternalCamera(node_id: u32, px: f32, py: f32, pz: f32, lx: f32, ly: f32, lz: f32, fov_degrees: f32) void {
    const pos = Vec3{ .x = px, .y = py, .z = pz };
    const look = Vec3{ .x = lx, .y = ly, .z = lz };
    // Pending table = source of truth (re-applied each renderEmbedded frame, survives the
    // lazy mount); also poke a live runtime so a mounted view turns this frame.
    setPendingCam(node_id, pos, look, fov_degrees);
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| {
            runtime.camera.external = true;
            runtime.camera.ext_pos = pos;
            runtime.camera.ext_look = look;
            runtime.camera.ext_fov = fov_degrees;
        }
    }
}

/// Return the camera to the player-trailing game camera (LOADERVIEW req_1757).
pub fn clearExternalCamera(node_id: u32) void {
    if (pendingCamFor(node_id)) |p| p.set = false;
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| {
            runtime.camera.external = false;
            runtime.camera.initialized = false; // re-seed the trailing camera cleanly
        }
    }
}

/// True when this loader node is editor-driven (external camera set). The engine uses
/// it to NOT capture the pointer for in-world look (LOADERVIEW req_1776) — so the
/// editor's own drag/keys reach its JS overlay instead of walking the game player.
pub fn isExternalCamera(node_id: u32) bool {
    if (pendingCamFor(node_id) != null) return true;
    if (findMounted(node_id)) |entry| {
        if (entry.runtime) |runtime| return runtime.camera.external;
    }
    return false;
}

pub fn setAiming(node_id: u32, aiming: bool) void {
    const entry = findMounted(node_id) orelse return;
    const runtime = entry.runtime orelse return;
    runtime.setAiming(aiming);
}

pub fn statusAlloc(allocator: std.mem.Allocator, node_id: u32) ![]u8 {
    const entry = findMounted(node_id) orelse return try allocator.dupe(u8, "unmounted");
    const runtime = entry.runtime orelse return try allocator.dupe(u8, "unmounted");
    return runtime.statusAlloc(allocator);
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    var path: []const u8 = DEFAULT_FIXTURE;
    for (args[1..]) |a| {
        if (!std.mem.startsWith(u8, a, "--")) path = a;
    }

    var runtime: Runtime = undefined;
    runtime.initInPlace(allocator, path, STORE_DIR, 0) catch |err| return err;
    defer runtime.deinit();

    // ── render the constructed scene (stateless GPU substrate) ───────────
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) {
        log.print("[loader] SDL_Init failed\n", .{});
        return error.SDLInitFailed;
    }
    defer c.SDL_Quit();

    const headless = std.posix.getenv("ZIGOS_HEADLESS") != null;
    const flags: u64 = if (headless) c.SDL_WINDOW_HIDDEN else 0;
    const window = c.SDL_CreateWindow("world_loader", WIN_W, WIN_H, flags) orelse {
        log.print("[loader] SDL_CreateWindow failed\n", .{});
        return error.WindowFailed;
    };

    gpu.init(window) catch |err| {
        log.print("[loader] gpu.init failed: {any}\n", .{err});
        return err;
    };
    capture.init();

    // Text for the interaction HUD (PROPUSE req_0624) — same system-font
    // fallback chain the engine uses. Missing fonts degrade gracefully:
    // drawTextLine no-ops without a face, the loading bar still draws.
    var te: ?text_engine.TextEngine = text_engine.TextEngine.initHeadless("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") catch
        text_engine.TextEngine.initHeadless("/usr/share/fonts/dejavu/DejaVuSans.ttf") catch // Alpine (font-dejavu)
        text_engine.TextEngine.initHeadless("/System/Library/Fonts/Supplemental/Arial.ttf") catch
        text_engine.TextEngine.initHeadless("C:/Windows/Fonts/segoeui.ttf") catch null;
    if (te) |*engine_ref| {
        gpu.initText(engine_ref.library, engine_ref.face, engine_ref.fallback_faces, engine_ref.fallback_count);
        if (engine_ref.face_bold != null) gpu.setBoldFace(engine_ref.face_bold);
    } else {
        log.print("[loader] no system font found — HUD prompts render without text\n", .{});
    }
    defer if (te) |*engine_ref| engine_ref.deinit();

    const screenshotting = capture.isScreenshotMode();
    if (!screenshotting) log.print("[loader] live window — close it or press ESC to exit (WASD move, Shift run, Space jump, mouse look, RMB aim)\n", .{});
    if (!headless and !screenshotting) {
        _ = c.SDL_SetWindowRelativeMouseMode(window, true);
    }

    var running = true;
    while (running) {
        runtime.pollStandaloneEvents(&running);
        runtime.stepNow();
        if (screenshotting and runtime.frame % 30 == 0) {
            // what does the LIVE physics set hold under the player's column?
            var covering: usize = 0;
            var best_top: f32 = -1.0e9;
            var ri: usize = 0;
            while (ri < runtime.physics_colliders.rect_count) : (ri += 1) {
                const r = runtime.physics_colliders.values[game_physics.INPUT_HEADER_FLOATS + ri * game_physics.RECT_FLOATS ..][0..game_physics.RECT_FLOATS];
                if (runtime.player.x >= r[0] and runtime.player.z >= r[1] and runtime.player.x <= r[2] and runtime.player.z <= r[3]) {
                    covering += 1;
                    if (r[4] > best_top) best_top = r[4];
                }
            }
            log.print("[loader] f{d} player y={d:.3} vy={d:.3} grounded={} rects={d} underCol={d} underTop={d:.2}\n", .{
                runtime.frame, runtime.player.y, runtime.player.vy, runtime.player.grounded, runtime.physics_colliders.rect_count, covering, best_top,
            });
        }
        runtime.ensureMaterials();
        _ = scene3d.render(&runtime.root, 0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H), 1.0);
        // Interaction HUD over the world quad (PROPUSE req_0624).
        runtime.drawHud(0, 0, @floatFromInt(WIN_W), @floatFromInt(WIN_H));
        gpu.frame(0.52, 0.62, 0.74); // sky-ish clear so the ground reads against it

        if (screenshotting) {
            if (capture.tick(null) or runtime.frame >= MAX_FRAMES) break; // captured → exit
        } else {
            c.SDL_Delay(16); // ~60fps cap so a static scene doesn't spin the CPU
        }
    }
    log.print("[loader] done after {d} frames — player x={d:.2} y={d:.2} z={d:.2} vy={d:.2} grounded={}\n", .{
        runtime.frame, runtime.player.x, runtime.player.y, runtime.player.z, runtime.player.vy, runtime.player.grounded,
    });
}
