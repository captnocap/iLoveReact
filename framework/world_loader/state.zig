//! Runtime value types and small deterministic state/math helpers.
//!
//! This module owns no mounted loader globals and performs no scene construction.

const std = @import("std");
const c = @import("../c.zig").imports;
const constructor = @import("../world/constructor.zig");
const game_physics = @import("../game/physics.zig");
const config = @import("config.zig");
const CAMERA_FOV_DEGREES = config.CAMERA_FOV_DEGREES;
const PLAYER_CLIP_IDLE = config.PLAYER_CLIP_IDLE;
const INTERACT_NOTICE_SECONDS = config.INTERACT_NOTICE_SECONDS;
const ELEVATOR_ARRIVE_TOLERANCE_METERS = config.ELEVATOR_ARRIVE_TOLERANCE_METERS;
const DOOR_PANEL_FRICTION = config.DOOR_PANEL_FRICTION;
const DOOR_PANEL_RESTITUTION = config.DOOR_PANEL_RESTITUTION;

pub fn doorHalfExtents(door: constructor.Door) [2]f32 {
    const rad = door.yaw_degrees * std.math.pi / 180.0;
    const half_x = @abs(@cos(rad)) * door.panel_w / 2 + @abs(@sin(rad)) * door.panel_d / 2;
    const half_z = @abs(@sin(rad)) * door.panel_w / 2 + @abs(@cos(rad)) * door.panel_d / 2;
    return .{ half_x, half_z };
}

/// The next stop the car serves from car_y: closest stop ABOVE, wrapping to
/// the bottom from the top (game/build/elevators.ts nextElevatorStop parity).
pub fn nextElevatorStop(stops: []const f32, car_y: f32) ?f32 {
    if (stops.len < 2) return null;
    for (stops) |stop| {
        if (stop > car_y + ELEVATOR_ARRIVE_TOLERANCE_METERS) return stop;
    }
    return stops[0];
}

pub fn nearestElevatorStop(stops: []const f32, y: f32) f32 {
    var best = stops[0];
    for (stops) |stop| {
        if (@abs(stop - y) < @abs(best - y)) best = stop;
    }
    return best;
}

pub fn elevatorStopIndex(stops: []const f32, stop: f32) usize {
    for (stops, 0..) |s, i| {
        if (s == stop) return i;
    }
    return 0;
}

pub const log = std.debug;

pub const Vec3 = struct {
    x: f32,
    y: f32,
    z: f32,
};

pub const Posture = enum { none, sit, lay };

pub const PlayerState = struct {
    x: f32,
    y: f32,
    z: f32,
    vx: f32 = 0,
    vy: f32 = 0,
    vz: f32 = 0,
    yaw: f32,
    grounded: bool = false,
    /// Stood on an exact mesh-prop top last frame. The packed rect step cannot
    /// see mesh triangle tops, so this is the mesh lane's own grounded memory —
    /// it extends the downward mount reach to a full step (downhill snap on
    /// placed staircases) the same way the jump law at stepNow re-authorizes
    /// jumps from mesh tops.
    on_mesh: bool = false,
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
pub const NpcRuntime = struct {
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
pub const InteractState = struct {
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

    pub fn prompt(self: *const InteractState) []const u8 {
        return self.prompt_buf[0..self.prompt_len];
    }

    pub fn notice(self: *const InteractState) []const u8 {
        return self.notice_buf[0..self.notice_len];
    }

    pub fn setPrompt(self: *InteractState, comptime fmt: []const u8, args: anytype) void {
        const written = std.fmt.bufPrint(&self.prompt_buf, fmt, args) catch self.prompt_buf[0..0];
        self.prompt_len = written.len;
    }

    pub fn postNotice(self: *InteractState, comptime fmt: []const u8, args: anytype) void {
        const written = std.fmt.bufPrint(&self.notice_buf, fmt, args) catch self.notice_buf[0..0];
        self.notice_len = written.len;
        self.notice_left = INTERACT_NOTICE_SECONDS;
    }
};

pub const CameraState = struct {
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

pub const PhysicsColliders = struct {
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
    pub fn rectBase(self: *const PhysicsColliders) usize {
        return game_physics.INPUT_HEADER_FLOATS + self.entity_capacity * game_physics.ENTITY_FLOATS;
    }
};

/// One kickable prop's live body (KICKPROP req_0625) — stepped through the
/// host physics entity section every frame; render nodes follow it.
pub const PropBody = struct {
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
pub const ElevatorCar = struct {
    car_y: f32,
    target_y: f32,
};

/// One door's live two-state machine (DOORS-0611) — parallel to the
/// DOORS-lump records (first door_count of them) and to the live door rects.
/// State is transient like car height: doors boot at their authored state.
pub const DoorState = struct {
    open: bool,
};

/// One cooked door's live two-state machine (req_1864) — the toggleable leaf is
/// a mesh-prop slot NODE (the user's custom art) plus a parked-when-open rect.
/// Sourced from MeshPropDoor (MESH_PROPS v6), not the DOORS lump; runs the same
/// E-toggle as a built-in door but drops a mesh node instead of a box.
pub const CookedDoor = struct {
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
pub const COOKED_DOOR_SWING_ARC_DEGREES: f32 = 90.0;
pub const COOKED_DOOR_OPEN_SECONDS: f32 = 0.4;

/// Cooked-prop glass tint (req_2020) — hand-mirrors materials.ts GLASS_TINT
/// ('#a9c8d8', the editor's Glass()). A flat-translucent mesh-prop slot ships
/// opacity only; appendMeshPropNode tints it this blue so /compiled glass panes
/// match the React play view instead of falling back to the prop's gray.
pub const GLASS_TINT = [3]f32{ 169.0 / 255.0, 200.0 / 255.0, 216.0 / 255.0 }; // #a9c8d8
// A textured resident mesh already carries its authored alpha in the atlas. The
// node only needs to be below the transparent-pass cutoff; keeping this near 1
// avoids multiplying that authored alpha down a second time.
pub const LIVE_TEXTURED_ALPHA_ROUTE_ALPHA: f32 = 0.998;
pub const LIVE_DOOR_FLAT_GLASS_ALPHA: f32 = 87.0 / 255.0;

/// The world AABB of a cooked door's leaf panel (req_1864) — the leaf slot's
/// local bounds, yawed + offset by the placed instance. Shared by the rect
/// builder and the reach scan so collision and interaction agree. null when the
/// mesh carries no door or the leaf slot is empty/out of range.
pub fn cookedDoorWorldBox(mesh: constructor.MeshPropMesh, inst: constructor.MeshPropInstance) ?CookedDoor {
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

/// Physics rect for a cooked door at its current swing progress. Shared by the
/// editor-live generation builder and the per-frame baked/live door step so the
/// panel cannot spawn closed for one physics frame after a state-preserving rebuild.
pub fn cookedDoorRectFloats(cd: CookedDoor) [game_physics.RECT_FLOATS]f32 {
    const theta = cd.progress * COOKED_DOOR_SWING_ARC_DEGREES * std.math.pi / 180.0;
    const ct = @cos(theta);
    const st = @sin(theta);
    const ddx = cd.cx - cd.hinge_x;
    const ddz = cd.cz - cd.hinge_z;
    const scx = cd.hinge_x + (ddx * ct + ddz * st);
    const scz = cd.hinge_z + (-ddx * st + ddz * ct);
    const total = cd.yaw_degrees * std.math.pi / 180.0 + theta;
    const tc = @abs(@cos(total));
    const ts = @abs(@sin(total));
    const hxw = tc * cd.half_w_local + ts * cd.half_d_local;
    const hzw = ts * cd.half_w_local + tc * cd.half_d_local;
    return .{
        scx - hxw,
        scz - hzw,
        scx + hxw,
        scz + hzw,
        cd.base_y + cd.panel_h,
        1,
        DOOR_PANEL_FRICTION,
        DOOR_PANEL_RESTITUTION,
        cd.base_y,
    };
}

/// The vertex count of a mesh's SOLID body — everything before the door leaf
/// slot (req_1864), so meshPropIslands never colliders the toggleable leaf. The
/// full vertex_count for a non-door mesh.
pub fn solidVertexCount(mesh: constructor.MeshPropMesh) usize {
    if (mesh.door) |door| {
        if (door.leaf_slot < mesh.slots.len) return mesh.slots[door.leaf_slot].start;
    }
    return mesh.vertex_count;
}

pub fn clamp(v: f32, lo: f32, hi: f32) f32 {
    return @max(lo, @min(hi, v));
}

pub fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

pub fn lerpVec3(a: Vec3, b: Vec3, t: f32) Vec3 {
    return .{
        .x = lerp(a.x, b.x, t),
        .y = lerp(a.y, b.y, t),
        .z = lerp(a.z, b.z, t),
    };
}

pub fn rotateYLocal(local: [3]f32, yaw_degrees: f32) Vec3 {
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
pub const RoutePose = struct { x: f32, z: f32, heading_deg: f32 };

/// Point + heading at arc-length `s` along a route polyline (x,z pairs). Heading
/// uses the motion convention (forward = [sin h, cos h] → h = atan2(dx, dz)), so
/// a +Z-forward vehicle prototype rotated by `heading_deg` faces travel.
pub fn sampleRoute(route: []const f32, s_in: f32) RoutePose {
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

pub fn nowNs(io: std.Io) i64 {
    return @as(i64, @truncate(std.Io.Clock.now(.awake, io).toNanoseconds()));
}

pub fn keyDown(scancode: usize) bool {
    const keys = c.SDL_GetKeyboardState(null);
    if (keys == null) return false;
    return keys[scancode];
}
