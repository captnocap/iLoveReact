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
const instance_collider_policy = @import("framework/world/instance_collider_policy.zig");
const streaming = @import("framework/world/streaming.zig");
const game_physics = @import("framework/game/physics.zig");

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
const SHAPE_BOX: f32 = 0;
const SHAPE_RAMP: f32 = 1;
const SHAPE_CYLINDER8: f32 = 2;
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
    open: bool,
    /// kid index of the leaf slot node (set during the mesh-prop node pass)
    node_child: usize = 0,
    /// the leaf node's resting Y (inst.y) — restore point when closed
    node_base_y: f32 = 0,
    /// rect index in physics_colliders (parked out of the world when open)
    rect_index: usize = 0,
    /// world panel box: center + half extents (yawed AABB) + base/height
    cx: f32,
    cz: f32,
    base_y: f32,
    panel_h: f32,
    half_x: f32,
    half_z: f32,
    reach: f32,
    vehicle: bool,
};

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
    return .{
        .open = door.start_open,
        .cx = inst.x + (lcx * cc - lcz * ss),
        .cz = inst.z + (lcx * ss + lcz * cc),
        .base_y = inst.y + lo[1],
        .panel_h = hi[1] - lo[1],
        .half_x = @abs(cc) * hx + @abs(ss) * hz,
        .half_z = @abs(ss) * hx + @abs(cc) * hz,
        .node_base_y = inst.y,
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

// Rows referencing a material (material_refs[row] != 0) are drawn TEXTURED in
// their own per-material batch, so they're skipped here — the flat instanced
// batch is the material-less remainder. `material_refs` may be empty (no
// materials), in which case nothing is skipped.
fn buildShapeBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, material_refs: []const u32, flora: ?constructor.FloraCells) !ShapeBatches {
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
    var row: usize = 0;
    while (row < @as(usize, @intCast(inst_count))) : (row += 1) {
        if (row < material_refs.len and material_refs[row] != 0) continue; // textured batch
        const b = row * stride;
        const src = insts[b .. b + stride];
        const shape = instanceShapeId(insts, row, stride);
        if (@abs(shape - SHAPE_BOX_OPEN_RUN_MIN) < 0.5) {
            try boxes_open_run_min.appendSlice(allocator, src);
            box_open_run_min_count += 1;
        } else if (@abs(shape - SHAPE_BOX_OPEN_RUN_MAX) < 0.5) {
            try boxes_open_run_max.appendSlice(allocator, src);
            box_open_run_max_count += 1;
        } else if (@abs(shape - SHAPE_BOX_OPEN_RUN_BOTH) < 0.5) {
            try boxes_open_run_both.appendSlice(allocator, src);
            box_open_run_both_count += 1;
        } else if (@abs(shape - SHAPE_RAMP) < 0.5) {
            try ramps.appendSlice(allocator, src);
            ramp_count += 1;
        } else if (@abs(shape - SHAPE_CYLINDER8) < 0.5) {
            try cylinder8s.appendSlice(allocator, src);
            cylinder8_count += 1;
        } else if (@abs(shape - SHAPE_CYLINDER16) < 0.5) {
            try cylinder16s.appendSlice(allocator, src);
            cylinder16_count += 1;
        } else if (@abs(shape - SHAPE_SPHERE) < 0.5) {
            try spheres.appendSlice(allocator, src);
            sphere_count += 1;
        } else if (@abs(shape - SHAPE_GABLE) < 0.5) {
            try gables.appendSlice(allocator, src);
            gable_count += 1;
        } else if (@abs(shape - SHAPE_CORNER_MITER) < 0.5) {
            try corner_miters.appendSlice(allocator, src);
            corner_miter_count += 1;
        } else if (@abs(shape - SHAPE_CORNER_MITER_MIRROR) < 0.5) {
            try corner_miter_mirrors.appendSlice(allocator, src);
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
        } else {
            try boxes.appendSlice(allocator, src);
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
            // FLOWERS (spec 2, req_1861): regenerated by flowerRow into the flowers batch —
            // the SAME card geometry the old enumerated buildFlowerInstances rows used.
            if (cell.spec_id == 2) {
                var k: u32 = 0;
                while (k < cell.count) : (k += 1) {
                    const r = foliage.flowerRow(&foliage.FLOWER, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key, k);
                    try flowers.appendSlice(allocator, &r);
                    try flowers.append(allocator, SHAPE_FLOWER);
                    flower_count += 1;
                }
                continue;
            }
            // PALM CROWNS (spec 3, req_1861): the trunk is a baked mesh; the frond crown is
            // regenerated here from the cell key — two rings via palmCrown/palmFrondRow into
            // the frond batch (the ~frond~ pipeline), never the ~614k enumerated rows.
            if (cell.spec_id == 3) {
                const crown = foliage.palmCrown(&foliage.PALM, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key);
                const fc = crown.total();
                var k: u32 = 0;
                while (k < fc) : (k += 1) {
                    const r = foliage.palmFrondRow(&crown, k);
                    try frond.appendSlice(allocator, &r);
                    try frond.append(allocator, SHAPE_FROND);
                    frond_count += 1;
                }
                continue;
            }
            const is_grass = cell.spec_id == 0;
            const cfg: *const foliage.FoliageConfig = if (is_grass) &foliage.GRASS else &foliage.BUSH;
            const shape: f32 = if (is_grass) SHAPE_GRASS else SHAPE_BUSH;
            var k: u32 = 0;
            while (k < cell.count) : (k += 1) {
                const r = foliage.bladeRow(cfg, @as(f64, cell.wx), @as(f64, cell.wz), @as(f64, cell.top), c_size, cell.cell_key, k);
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
        }
    }
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

fn buildMaterialBatches(allocator: std.mem.Allocator, insts: []const f32, inst_count: u32, stride: usize, materials: []const constructor.Material, material_refs: []const u32) ![]MaterialBatch {
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
        try lists[(ref - 1) * MATERIAL_SHAPE_SLOTS + slot].appendSlice(allocator, insts[b .. b + stride]);
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
/// field. Palm TRUNKS are decorative too (req_1676): a painted palm field grows
/// tens of thousands of trunks and one collider each flooded MAX_RECTS on even a
/// small map for no real gameplay value, so they're walk-through like the fronds.
fn isNonCollidingFoliage(insts: []const f32, row: usize, stride: usize) bool {
    const s = instanceShapeId(insts, row, stride);
    return @abs(s - SHAPE_GRASS) < 0.5 or @abs(s - SHAPE_BUSH) < 0.5 or
        @abs(s - SHAPE_FROND) < 0.5 or @abs(s - SHAPE_FLOWER) < 0.5 or
        @abs(s - SHAPE_PALMTRUNK) < 0.5 or
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
/// ground→height in Y). Used for a welded/degenerate mesh that won't cleanly split.
fn meshFullBoundsIsland(mesh: constructor.MeshPropMesh) MeshIsland {
    return .{
        .lo = .{ -mesh.footprint_width / 2.0, 0, -mesh.footprint_depth / 2.0 },
        .hi = .{ mesh.footprint_width / 2.0, mesh.height, mesh.footprint_depth / 2.0 },
    };
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
    // req_1864: a cooked door's leaf is the LIVE two-state panel (its own rect),
    // never a static island — so the body islands stop before the leaf slot.
    const vc: usize = solidVertexCount(mesh);
    const oneBox = struct {
        fn make(a: std.mem.Allocator, m: constructor.MeshPropMesh) ![]MeshIsland {
            const out = try a.alloc(MeshIsland, 1);
            out[0] = meshFullBoundsIsland(m);
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
    gable_prism: [24 * 8]f32 = undefined,
    corner_miter_prism: [12 * 8]f32 = undefined,
    corner_miter_mirror_prism: [12 * 8]f32 = undefined,
    grass_blade: [36 * 8]f32 = undefined,
    flower_head: [36 * 8]f32 = undefined,
    bush_clump: [60 * 8]f32 = undefined,
    frond_card: [144 * 8]f32 = undefined,
    palm_trunk: [1680 * 8]f32 = undefined,
    shape_batches: ShapeBatches = undefined,
    has_shape_batches: bool = false,
    // Per-material textured batches (geometry built at construct; the shaders are
    // run into textures lazily by ensureMaterials at first render, once gpu is up).
    material_batches: []MaterialBatch = &.{},
    materials_ready: bool = false,
    player_geom_keys: std.ArrayList([]u8) = .{},
    mesh_prop_vertex_buffers: std.ArrayList([]f32) = .{},
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
    // Live editor-placed MESH props (LIVEMESH req_1812): a just-placed imported/cooked
    // mesh prop renders instantly by REFERENCING an already-resident mesh (the user's
    // "once one X exists, the next is a reference to it" — instanced rendering). The
    // editor pushes (meshKeyHash, x,y,z,yaw) per placement; applyLiveMeshProps appends a
    // mesh-prop draw node per ref each frame, resolving the hash to a loaded mesh. No bake.
    mesh_by_hash: std.AutoHashMapUnmanaged(u32, usize) = .{},
    mesh_hash_built: bool = false,
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
    // LIVEBLDSKIN req_1849: per-frame instance rows for live procedurally-skinned building-
    // piece faces (textured cubes outset to cover the baked face-slab). Pre-sized each frame
    // so the node slices into it stay stable while kid_list grows.
    skin_box_buf: std.ArrayListUnmanaged(f32) = .{},
    // Node count of the permanent (non-streaming, non-live-mesh) prefix — captured in
    // build(). The non-streaming path truncates back to here before re-appending the live
    // mesh nodes each frame (streaming truncates to stream_tail_start in refreshStreamNodes).
    perm_node_count: usize = 0,
    ticker_seconds: f32 = 0,
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
        self.baked_by_pos.deinit(self.allocator);
        self.hidden_baked.deinit(self.allocator);
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
            .scene3d_color_r = if (textured) 1 else mesh.color[0],
            .scene3d_color_g = if (textured) 1 else mesh.color[1],
            .scene3d_color_b = if (textured) 1 else mesh.color[2],
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

    // LIVEMESH req_1812: append a draw node for each live-placed mesh prop, referencing an
    // already-resident mesh (material_ref 0 → the mesh's own baked texture/color, NO
    // per-frame allocation; see meshPropTexKey). Called at the END of stepNow, after
    // refreshStreamNodes rebuilt the stream tail — so the streaming path truncated last
    // frame's live nodes for us; the monolithic path truncates them here to perm_node_count.
    // The hover GHOST (req_1841) rides the same path with a forced translucent alpha.
    fn appendLiveMeshRef(self: *Runtime, mp: constructor.MeshProps, r: LiveMeshRef, alpha: ?f32) void {
        const idx = self.mesh_by_hash.get(r.hash) orelse return;
        if (idx >= mp.meshes.len) return;
        const mesh = mp.meshes[idx];
        const tex_override: ?[]const u8 = if (r.mat_hash != 0) self.live_mat_keys.get(r.mat_hash) else null;
        self.appendMeshPropNode(mesh, .{ .mesh = @intCast(idx), .x = r.x, .y = r.y, .z = r.z, .yaw_degrees = r.yaw }, mesh.key, 0, mesh.vertex_count, 0, alpha, tex_override) catch {};
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
        // RESKIN req_1845: un-hide whatever we hid last frame before re-evaluating, so a
        // reverted/reloaded prop shows its baked render again.
        for (self.hidden_baked.items) |rng| self.setBakedRangeVisible(rng, true);
        self.hidden_baked.clearRetainingCapacity();
        // Mesh props (need the mesh table loaded). Building-piece skin boxes below do not.
        if (self.scene.mesh_props) |mp| {
            self.ensureMeshHashMap();
            if (pendingLiveMeshFor(self.node_id)) |p| {
                for (p.refs) |r| {
                    self.appendLiveMeshRef(mp, r, null);
                    // A live ref coincident with a baked instance is a RE-SKIN of an existing
                    // prop (the editor only pushes those + brand-new placements, which sit at
                    // fresh positions) — hide the stale baked draw so the two don't z-fight.
                    if (self.baked_by_pos.count() > 0) {
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
                if (gh.has) self.appendLiveMeshRef(mp, gh.ref, LIVE_MESH_GHOST_ALPHA);
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
        self.gable_prism = buildGablePrism();
        self.corner_miter_prism = buildCornerMiterPrism();
        self.corner_miter_mirror_prism = buildCornerMiterMirrorPrism();
        self.grass_blade = buildGrassBlade();
        self.flower_head = buildFlowerHead();
        self.bush_clump = buildBushClump();
        self.frond_card = buildFrond();
        self.palm_trunk = buildPalmTrunk();
        // Expanded foliage rows are stride-13 (transform12 + shape); if the INSTANCES
        // lump was empty (stride 0) but a FLORA recipe ships, the grass/bush draw
        // nodes still need the 13-wide stride. Real bakes always carry pieces, so
        // this only matters for a foliage-only map.
        if (self.scene.flora != null and self.stride < 13) self.stride = 13;
        self.shape_batches = try buildShapeBatches(self.allocator, self.insts, self.inst_count, self.stride, self.scene.material_refs, self.scene.flora);
        self.has_shape_batches = true;
        // The textured remainder: rows wearing a material, partitioned per slot.
        // The shaders run at first render (gpu isn't up yet); the nodes carry the
        // material key now so scene3d samples it once it's materialized.
        self.material_batches = try buildMaterialBatches(self.allocator, self.insts, self.inst_count, self.stride, self.scene.materials, self.scene.material_refs);

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

        self.player_first_child = self.kid_list.items.len;
        for (self.scene.player_model, 0..) |group, i| {
            const key = try std.fmt.allocPrint(self.allocator, "player-model-{d}", .{i});
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
        if (self.scene.player_model.len == 0) log.print("[loader] no player model lump — camera target only\n", .{});

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
                const key = try std.fmt.allocPrint(self.allocator, "npc-{d}-{d}-{d}", .{ npc_index, mi, gi });
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
                    if (cnt > 0) self.baked_by_pos.put(self.allocator, meshPosKey(mesh_index, inst.x, inst.z, inst.yaw_degrees), .{ .first = @intCast(inst_first), .count = @intCast(cnt) }) catch {};
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
                    // req_1864: bind the door's leaf slot node to its live two-state
                    // machine, and drop it now if the door boots open.
                    if (this_cooked_door) |di| {
                        if (mesh.door) |door| {
                            if (si == door.leaf_slot and leaf_node_index < self.kid_list.items.len) {
                                self.cooked_doors[di].node_child = leaf_node_index;
                                if (self.cooked_doors[di].open) {
                                    self.kid_list.items[leaf_node_index].scene3d_pos_y = self.cooked_doors[di].node_base_y - DOOR_OPEN_HIDE_DROP_METERS;
                                }
                            }
                        }
                    }
                }
            }
            if (mp.instances.len > 0) {
                log.print("[loader] built {d} imported prop mesh instance(s) from {d} mesh asset(s)\n", .{ mp.instances.len, mp.meshes.len });
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
        for (self.material_batches) |batch| {
            if (batch.translucent or batch.textured_translucent or batch.count == 0) continue;
            // Shape-aware streaming proto (req_0939): same fix as the monolithic
            // opaque draw — a skinned non-box shape streams with its real geometry.
            const geom = geomForShape(self, batch.shape);
            try fams.append(self.allocator, .{ .rows = batch.boxes, .stride = @intCast(self.stride) });
            try self.stream_protos.append(self.allocator, .{ .geom_key = geom.key, .verts = geom.verts, .tex_key = batch.key });
        }
        var total_rows: u64 = 0;
        for (fams.items) |fam| total_rows += fam.rows.len / fam.stride;
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
        const cfg = self.scene.physics_config;
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
        const moving = !seated and @sqrt(intent.x * intent.x + intent.z * intent.z) > 0.001;
        const airborne = !seated and (!self.player.grounded or @abs(self.player.vy) > 0.05);
        updatePlayerAnimationClock(&self.player, dt, moving, run_down, airborne);
        self.stepInteract(dt);

        updateCameraNode(&self.kid_list.items[0], &self.camera, self.player, self.cameraColliderSet(), dt);
        updatePlayerModelNodes(self.kid_list.items, self.player_first_child, self.scene.player_model, self.scene.player_animation, self.player, moving, run_down, airborne);
        self.refreshNpcNodes();
        self.updateDynamicPropNodes();
        self.stepTickers(dt);
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

    /// req_1864 — flip a cooked door: park/unpark its rect (the doorway clears
    /// when open) and drop/raise its custom leaf NODE (the user's art), the same
    /// two-state machine as toggleDoor but the leaf is a mesh-prop slot node.
    fn toggleCookedDoor(self: *Runtime, index: usize) void {
        if (index >= self.cooked_doors.len) return;
        const cd = &self.cooked_doors[index];
        const open = !cd.open;
        cd.open = open;
        const at = self.physics_colliders.rectBase() + cd.rect_index * game_physics.RECT_FLOATS;
        if (at + game_physics.RECT_FLOATS <= self.physics_colliders.values.len and cd.rect_index < self.physics_colliders.rect_count) {
            const park: f32 = if (open) DOOR_OPEN_PARK_METERS else 0;
            self.physics_colliders.values[at + 0] = cd.cx - cd.half_x + park; // minX
            self.physics_colliders.values[at + 1] = cd.cz - cd.half_z + park; // minZ
            self.physics_colliders.values[at + 2] = cd.cx + cd.half_x + park; // maxX
            self.physics_colliders.values[at + 3] = cd.cz + cd.half_z + park; // maxZ
            self.physics_colliders.values[at + 5] = if (open) 0 else 1; // blocksPlayer
        }
        if (cd.node_child < self.kid_list.items.len) {
            const hide: f32 = if (open) DOOR_OPEN_HIDE_DROP_METERS else 0;
            self.kid_list.items[cd.node_child].scene3d_pos_y = cd.node_base_y - hide;
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

const LiveMeshRef = struct { hash: u32, x: f32, y: f32, z: f32, yaw: f32, mat_hash: u32 = 0 };
const LIVE_MESH_STRIDE_BYTES: usize = 24; // u32 keyHash + 4×f32 + u32 matHash (0 = baked tex)
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

/// Replace the live MESH-prop refs for a node (LIVEMESH req_1812). `bytes` packs
/// LIVE_MESH_STRIDE_BYTES per ref: u32 keyHash, then f32 x,y,z,yaw (little-endian, the
/// layout pieceMeshes.tsx writes). We own a copy so the JS buffer can be freed.
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
    const n = bytes.len / LIVE_MESH_STRIDE_BYTES;
    const refs = alloc.alloc(LiveMeshRef, n) catch return;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const off = i * LIVE_MESH_STRIDE_BYTES;
        refs[i] = .{
            .hash = std.mem.bytesToValue(u32, bytes[off..][0..4]),
            .x = std.mem.bytesToValue(f32, bytes[off + 4 ..][0..4]),
            .y = std.mem.bytesToValue(f32, bytes[off + 8 ..][0..4]),
            .z = std.mem.bytesToValue(f32, bytes[off + 12 ..][0..4]),
            .yaw = std.mem.bytesToValue(f32, bytes[off + 16 ..][0..4]),
            .mat_hash = std.mem.bytesToValue(u32, bytes[off + 20 ..][0..4]),
        };
    }
    if (p.refs.len > 0) alloc.free(p.refs);
    p.node_id = node_id;
    p.set = true;
    p.refs = refs;
    p.gen +%= 1;
}

/// Drop the live mesh-prop refs for a node (after a bake reload folds them in).
pub fn clearLiveMeshProps(node_id: u32) void {
    const p = pendingLiveMeshFor(node_id) orelse return;
    if (p.refs.len > 0) std.heap.page_allocator.free(p.refs);
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
    if (bytes.len < LIVE_MESH_STRIDE_BYTES) {
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
