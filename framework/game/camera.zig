//! framework/game/camera.zig — native game camera controller (V23).
//!
//! V23 applies the V7 pattern to camera: JavaScript transports parameters and
//! input deltas; the host owns per-frame solve/smoothing/interpolation and
//! writes the existing Scene3D camera node fields consumed by gpu/3d.zig.
//!
//! Pure solve functions mirror runtime/cameras exactly. The retained controller
//! is opt-in: until a cart binds a Scene3D.Camera node, declarative JS camera
//! props keep working unchanged.

const std = @import("std");

pub const Vec3 = struct {
    x: f32 = 0,
    y: f32 = 0,
    z: f32 = 0,
};

pub const Solved = struct {
    pos: Vec3,
    target: Vec3,
    fov: f32,
};

pub const Mode = enum {
    orbit,
    aim,
    freefly,
};

pub const OrbitParams = struct {
    target: Vec3 = .{},
    yaw: f32 = 45,
    pitch: f32 = 35,
    dist: f32 = 15,
    zoom: f32 = 1,
    fov: f32 = 55,
};

pub const AimParams = struct {
    target: Vec3 = .{},
    yaw: f32 = 0,
    pitch: f32 = 0,
    crouch: f32 = 0,
    shoulder_shift: f32 = 0.62,
    pivot_height: f32 = 1.62,
    crouch_drop: f32 = 0.42,
    distance: f32 = 2.4,
    look_ahead: f32 = 12,
    min_pitch: f32 = -1.15 / DEG,
    max_pitch: f32 = 1.0 / DEG,
    fov: f32 = 47,
};

pub const FreeFlyParams = struct {
    position: Vec3 = .{ .x = 0, .y = 5, .z = 14 },
    yaw: f32 = 180,
    pitch: f32 = -12,
    fov: f32 = 60,
};

pub const MoveAxes = struct {
    forward: f32 = 0,
    strafe: f32 = 0,
    lift: f32 = 0,
    speed: f32 = 0,
};

pub const DistanceConstraint = struct {
    target_distance: f32 = 0,
    min_distance: f32 = 1,
    smoothing_per_second: f32 = 24,
    current_distance: f32 = 0,
    initialized: bool = false,
};

pub const ControllerParams = struct {
    smoothing_per_second: f32 = DEFAULT_SMOOTHING_PER_SECOND,
};

pub const DEG: f32 = std.math.pi / 180.0;
pub const DEFAULT_SMOOTHING_PER_SECOND: f32 = 14.0;
pub const MAX_CONTROLLERS: usize = 64;

fn clamp(n: f32, lo: f32, hi: f32) f32 {
    return @max(lo, @min(hi, n));
}

fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

fn lerp3(a: Vec3, b: Vec3, t: f32) Vec3 {
    return .{
        .x = lerp(a.x, b.x, t),
        .y = lerp(a.y, b.y, t),
        .z = lerp(a.z, b.z, t),
    };
}

pub fn orbitalEye(target: Vec3, yaw_deg: f32, pitch_deg: f32, dist: f32) Vec3 {
    const yaw = yaw_deg * DEG;
    const elev = pitch_deg * DEG;
    const horiz = dist * @cos(elev);
    const height = dist * @sin(elev);
    return .{
        .x = target.x - @sin(yaw) * horiz,
        .y = target.y + height,
        .z = target.z - @cos(yaw) * horiz,
    };
}

pub fn solveOrbit(params: OrbitParams) Solved {
    const dist = params.dist / @max(@as(f32, 0.2), params.zoom);
    return .{
        .pos = orbitalEye(params.target, params.yaw, params.pitch, dist),
        .target = params.target,
        .fov = params.fov,
    };
}

pub fn lookForward(eye: Vec3, yaw_deg: f32, pitch_deg: f32) Vec3 {
    const yaw = yaw_deg * DEG;
    const pitch = pitch_deg * DEG;
    const cp = @cos(pitch);
    return .{
        .x = eye.x - @sin(yaw) * cp,
        .y = eye.y + @sin(pitch),
        .z = eye.z + @cos(yaw) * cp,
    };
}

pub fn solveFreeFly(params: FreeFlyParams) Solved {
    return .{
        .pos = params.position,
        .target = lookForward(params.position, params.yaw, params.pitch),
        .fov = params.fov,
    };
}

pub fn aimPivot(params: AimParams) Vec3 {
    const yaw = params.yaw * DEG;
    const right_x = -@cos(yaw);
    const right_z = @sin(yaw);
    return .{
        .x = params.target.x + right_x * params.shoulder_shift,
        .y = params.target.y + params.pivot_height - params.crouch * params.crouch_drop,
        .z = params.target.z + right_z * params.shoulder_shift,
    };
}

pub fn solveAim(params: AimParams) Solved {
    const pitch_deg = clamp(params.pitch, params.min_pitch, params.max_pitch);
    const yaw = params.yaw * DEG;
    const pitch = pitch_deg * DEG;
    const cp = @cos(pitch);
    const fwd = Vec3{
        .x = @sin(yaw) * cp,
        .y = @sin(pitch),
        .z = @cos(yaw) * cp,
    };
    const pivot = aimPivot(params);
    const pos = Vec3{
        .x = pivot.x - fwd.x * params.distance,
        .y = pivot.y - fwd.y * params.distance,
        .z = pivot.z - fwd.z * params.distance,
    };
    const target = Vec3{
        .x = pivot.x + fwd.x * params.look_ahead,
        .y = pivot.y + fwd.y * params.look_ahead,
        .z = pivot.z + fwd.z * params.look_ahead,
    };
    return .{ .pos = pos, .target = target, .fov = params.fov };
}

pub const Controller = struct {
    enabled: bool = false,
    node_id: u32 = 0,
    mode: Mode = .orbit,
    orbit: OrbitParams = .{},
    aim: AimParams = .{},
    freefly: FreeFlyParams = .{},
    move_axes: MoveAxes = .{},
    distance_constraint: DistanceConstraint = .{},
    current: Solved = solveOrbit(.{}),
    initialized: bool = false,
    smoothing_per_second: f32 = DEFAULT_SMOOTHING_PER_SECOND,

    pub fn bindNode(self: *Controller, node_id: u32) void {
        self.node_id = node_id;
        self.enabled = node_id != 0;
        self.initialized = false;
    }

    pub fn disable(self: *Controller) void {
        self.enabled = false;
        self.node_id = 0;
        self.initialized = false;
    }

    pub fn setMode(self: *Controller, mode: Mode) void {
        self.mode = mode;
    }

    pub fn setOrbit(self: *Controller, params: OrbitParams) void {
        self.orbit = params;
        if (self.mode == .orbit and !self.initialized) {
            self.current = solveOrbit(params);
        }
    }

    pub fn setAim(self: *Controller, params: AimParams) void {
        self.aim = params;
        if (self.mode == .aim and !self.initialized) {
            self.current = solveAim(params);
        }
    }

    pub fn setFreeFly(self: *Controller, params: FreeFlyParams) void {
        self.freefly = params;
        if (self.mode == .freefly and !self.initialized) {
            self.current = solveFreeFly(params);
        }
    }

    pub fn setMoveAxes(self: *Controller, axes: MoveAxes) void {
        self.move_axes = axes;
    }

    pub fn setDistanceConstraint(self: *Controller, target_distance: f32, min_distance: f32, smoothing_per_second: f32) void {
        self.distance_constraint.target_distance = @max(@as(f32, 0), target_distance);
        self.distance_constraint.min_distance = @max(@as(f32, 0.1), min_distance);
        self.distance_constraint.smoothing_per_second = @max(@as(f32, 0), smoothing_per_second);
    }

    pub fn setSmoothing(self: *Controller, per_second: f32) void {
        self.smoothing_per_second = @max(@as(f32, 0), per_second);
    }

    pub fn applyInputDeltas(self: *Controller, yaw_delta: f32, pitch_delta: f32) void {
        switch (self.mode) {
            .orbit => {
                self.orbit.yaw += yaw_delta;
                self.orbit.pitch += pitch_delta;
            },
            .aim => {
                self.aim.yaw += yaw_delta;
                self.aim.pitch = clamp(self.aim.pitch + pitch_delta, self.aim.min_pitch, self.aim.max_pitch);
            },
            .freefly => {
                self.freefly.yaw += yaw_delta;
                self.freefly.pitch = clamp(self.freefly.pitch + pitch_delta, -89, 89);
            },
        }
    }

    fn integrateFreeFly(self: *Controller, dt_seconds: f32) void {
        if (dt_seconds <= 0 or self.move_axes.speed == 0) return;
        const yaw = self.freefly.yaw * DEG;
        const pitch = self.freefly.pitch * DEG;
        const cp = @cos(pitch);
        const fwd = Vec3{
            .x = -@sin(yaw) * cp,
            .y = @sin(pitch),
            .z = @cos(yaw) * cp,
        };
        const right = Vec3{
            .x = -@cos(yaw),
            .y = 0,
            .z = -@sin(yaw),
        };
        const step_len = self.move_axes.speed * dt_seconds;
        self.freefly.position = .{
            .x = self.freefly.position.x + (fwd.x * self.move_axes.forward + right.x * self.move_axes.strafe) * step_len,
            .y = self.freefly.position.y + (fwd.y * self.move_axes.forward + self.move_axes.lift) * step_len,
            .z = self.freefly.position.z + (fwd.z * self.move_axes.forward + right.z * self.move_axes.strafe) * step_len,
        };
    }

    pub fn desired(self: *const Controller) Solved {
        return switch (self.mode) {
            .orbit => solveOrbit(self.orbit),
            .aim => solveAim(self.aim),
            .freefly => solveFreeFly(self.freefly),
        };
    }

    fn constrainedDistance(self: *Controller, base_distance: f32, dt_seconds: f32) f32 {
        const base = @max(@as(f32, 0.1), base_distance);
        var target = if (self.distance_constraint.target_distance > 0) self.distance_constraint.target_distance else base;
        target = clamp(target, self.distance_constraint.min_distance, base);
        if (!self.distance_constraint.initialized) {
            self.distance_constraint.current_distance = base;
            self.distance_constraint.initialized = true;
        }
        if (self.distance_constraint.smoothing_per_second <= 0 or dt_seconds <= 0) {
            self.distance_constraint.current_distance = target;
        } else {
            const t = clamp(1.0 - @exp(-self.distance_constraint.smoothing_per_second * dt_seconds), 0, 1);
            self.distance_constraint.current_distance = lerp(self.distance_constraint.current_distance, target, t);
        }
        self.distance_constraint.current_distance = clamp(self.distance_constraint.current_distance, self.distance_constraint.min_distance, base);
        return self.distance_constraint.current_distance;
    }

    fn desiredForStep(self: *Controller, dt_seconds: f32) Solved {
        return switch (self.mode) {
            .orbit => {
                var params = self.orbit;
                const zoom = @max(@as(f32, 0.2), params.zoom);
                const base = params.dist / zoom;
                params.dist = self.constrainedDistance(base, dt_seconds) * zoom;
                return solveOrbit(params);
            },
            .aim => {
                var params = self.aim;
                params.distance = self.constrainedDistance(params.distance, dt_seconds);
                return solveAim(params);
            },
            .freefly => solveFreeFly(self.freefly),
        };
    }

    pub fn step(self: *Controller, dt_seconds: f32) Solved {
        if (self.mode == .freefly) self.integrateFreeFly(dt_seconds);
        const want = self.desiredForStep(dt_seconds);
        if (!self.initialized or self.smoothing_per_second <= 0 or dt_seconds <= 0) {
            self.current = want;
            self.initialized = true;
            return self.current;
        }
        const t = clamp(1.0 - @exp(-self.smoothing_per_second * dt_seconds), 0, 1);
        self.current = .{
            .pos = lerp3(self.current.pos, want.pos, t),
            .target = lerp3(self.current.target, want.target, t),
            .fov = lerp(self.current.fov, want.fov, t),
        };
        return self.current;
    }
};

const ControllerSlot = struct {
    controller: Controller = .{},
    last_tick_ms: u32 = 0,
    probe_frames: u32 = 0,
    probe_dt_sum_ms: u32 = 0,
    probe_params: u32 = 0,
    probe_modes: u32 = 0,
    probe_deltas: u32 = 0,
    probe_last_param_wall_ms: i64 = 0,
    probe_last_solved: Solved = solveOrbit(.{}),
    probe_has_last_solved: bool = false,
    probe_max_solved_step: f32 = 0,
    probe_max_pos_lag: f32 = 0,
    probe_max_target_lag: f32 = 0,
};

pub const ProbeSnapshot = struct {
    has_sample: bool = false,
    node_id: u32 = 0,
    active_node_id: u32 = 0,
    frames: u32 = 0,
    avg_dt_ms: f32 = 0,
    last_dt_ms: u32 = 0,
    params: u32 = 0,
    modes: u32 = 0,
    deltas: u32 = 0,
    last_param_age_ms: i64 = -1,
    max_solved_step: f32 = 0,
    max_pos_lag: f32 = 0,
    max_target_lag: f32 = 0,
    mode: Mode = .orbit,
    desired: Solved = solveOrbit(.{}),
    solved: Solved = solveOrbit(.{}),
    slot_orbit: OrbitParams = .{},
    staged_orbit: OrbitParams = .{},
    slot_freefly: FreeFlyParams = .{},
    move_axes: MoveAxes = .{},
};

var g_controllers: [MAX_CONTROLLERS]ControllerSlot = [_]ControllerSlot{.{}} ** MAX_CONTROLLERS;
var g_active_node_id: u32 = 0;
var g_legacy_controller: Controller = .{};
var g_probe_last_ms: u32 = 0;
var g_probe_clock_ms: u32 = 0;
var g_probe_snapshot: ProbeSnapshot = .{};

fn distance3(a: Vec3, b: Vec3) f32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return @sqrt(dx * dx + dy * dy + dz * dz);
}

fn probeRecordParams(slot: *ControllerSlot) void {
    slot.probe_params += 1;
    slot.probe_last_param_wall_ms = @intCast(g_probe_clock_ms);
}

fn probeRecordMode(slot: *ControllerSlot) void {
    slot.probe_modes += 1;
}

fn probeRecordDeltas(slot: *ControllerSlot) void {
    slot.probe_deltas += 1;
    slot.probe_last_param_wall_ms = @intCast(g_probe_clock_ms);
}

fn probeRecordFrame(slot: *ControllerSlot, dt_ms: u32, desired: Solved, solved: Solved) void {
    slot.probe_frames += 1;
    slot.probe_dt_sum_ms += dt_ms;
    const pos_lag = distance3(desired.pos, solved.pos);
    const target_lag = distance3(desired.target, solved.target);
    slot.probe_max_pos_lag = @max(slot.probe_max_pos_lag, pos_lag);
    slot.probe_max_target_lag = @max(slot.probe_max_target_lag, target_lag);
    if (slot.probe_has_last_solved) {
        slot.probe_max_solved_step = @max(slot.probe_max_solved_step, distance3(slot.probe_last_solved.pos, solved.pos));
    }
    slot.probe_last_solved = solved;
    slot.probe_has_last_solved = true;
}

fn probeResetWindow(slot: *ControllerSlot) void {
    slot.probe_frames = 0;
    slot.probe_dt_sum_ms = 0;
    slot.probe_params = 0;
    slot.probe_modes = 0;
    slot.probe_deltas = 0;
    slot.probe_max_solved_step = 0;
    slot.probe_max_pos_lag = 0;
    slot.probe_max_target_lag = 0;
}

fn findSlotIndex(node_id: u32) ?usize {
    if (node_id == 0) return null;
    for (&g_controllers, 0..) |*slot, i| {
        if (slot.controller.enabled and slot.controller.node_id == node_id) return i;
    }
    return null;
}

fn firstFreeSlotIndex() ?usize {
    for (&g_controllers, 0..) |*slot, i| {
        if (!slot.controller.enabled) return i;
    }
    return null;
}

fn getSlot(node_id: u32) ?*ControllerSlot {
    const i = findSlotIndex(node_id) orelse return null;
    return &g_controllers[i];
}

fn ensureSlot(node_id: u32) ?*ControllerSlot {
    if (node_id == 0) return null;
    if (getSlot(node_id)) |slot| {
        g_active_node_id = node_id;
        return slot;
    }
    const i = firstFreeSlotIndex() orelse return null;
    g_controllers[i] = .{ .controller = g_legacy_controller };
    g_controllers[i].controller.bindNode(node_id);
    g_active_node_id = node_id;
    return &g_controllers[i];
}

fn activeSlot() ?*ControllerSlot {
    return getSlot(g_active_node_id);
}

/// The crosshair ray: the ACTIVE camera's resolved optical axis (pos →
/// normalized look direction). This is the truth only the host has — the JS
/// side never receives the smoothed/solved camera, so a cart that needs "what
/// is under the crosshair" (a shot, an interact, a pick) reads it here instead
/// of re-deriving a direction from yaw/pitch (which diverges from the real
/// camera by meters at range). `has` is false when no camera is bound.
pub const CameraRay = struct {
    pos: Vec3 = .{},
    dir: Vec3 = .{ .x = 0, .y = 0, .z = 1 },
    has: bool = false,
};

pub fn activeCameraRay() CameraRay {
    const slot = activeSlot() orelse return .{};
    const c = slot.controller.current;
    var dx = c.target.x - c.pos.x;
    var dy = c.target.y - c.pos.y;
    var dz = c.target.z - c.pos.z;
    const len = @sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) {
        dx /= len;
        dy /= len;
        dz /= len;
    }
    return .{ .pos = c.pos, .dir = .{ .x = dx, .y = dy, .z = dz }, .has = true };
}

pub fn bindNode(node_id: u32) void {
    _ = ensureSlot(node_id);
}

pub fn unbindNode(node_id: u32) void {
    const i = findSlotIndex(node_id) orelse return;
    g_controllers[i] = .{};
    if (g_active_node_id == node_id) {
        g_active_node_id = 0;
        for (&g_controllers) |*slot| {
            if (slot.controller.enabled) {
                g_active_node_id = slot.controller.node_id;
                break;
            }
        }
    }
}

pub fn disable() void {
    if (g_active_node_id != 0) unbindNode(g_active_node_id);
}

pub fn disableNode(node_id: u32) void {
    unbindNode(node_id);
}

pub fn setMode(mode: Mode) void {
    g_legacy_controller.setMode(mode);
    if (activeSlot()) |slot| {
        slot.controller.setMode(mode);
        probeRecordMode(slot);
    }
}

pub fn setModeForNode(node_id: u32, mode: Mode) void {
    if (ensureSlot(node_id)) |slot| {
        slot.controller.setMode(mode);
        probeRecordMode(slot);
    }
}

pub fn setOrbit(params: OrbitParams) void {
    g_legacy_controller.setOrbit(params);
    if (activeSlot()) |slot| {
        slot.controller.setOrbit(params);
        probeRecordParams(slot);
    }
}

pub fn setOrbitForNode(node_id: u32, params: OrbitParams) void {
    if (ensureSlot(node_id)) |slot| {
        slot.controller.setOrbit(params);
        probeRecordParams(slot);
    }
}

pub fn setAim(params: AimParams) void {
    g_legacy_controller.setAim(params);
    if (activeSlot()) |slot| {
        slot.controller.setAim(params);
        probeRecordParams(slot);
    }
}

pub fn setAimForNode(node_id: u32, params: AimParams) void {
    if (ensureSlot(node_id)) |slot| {
        slot.controller.setAim(params);
        probeRecordParams(slot);
    }
}

pub fn setFreeFly(params: FreeFlyParams) void {
    g_legacy_controller.setFreeFly(params);
    if (activeSlot()) |slot| {
        slot.controller.setFreeFly(params);
        probeRecordParams(slot);
    }
}

pub fn setFreeFlyForNode(node_id: u32, params: FreeFlyParams) void {
    if (ensureSlot(node_id)) |slot| {
        slot.controller.setFreeFly(params);
        probeRecordParams(slot);
    }
}

pub fn setMoveAxes(axes: MoveAxes) void {
    g_legacy_controller.setMoveAxes(axes);
    if (activeSlot()) |slot| {
        slot.controller.setMoveAxes(axes);
        probeRecordParams(slot);
    }
}

pub fn setMoveAxesForNode(node_id: u32, axes: MoveAxes) void {
    if (ensureSlot(node_id)) |slot| {
        slot.controller.setMoveAxes(axes);
        probeRecordParams(slot);
    }
}

pub fn setDistanceConstraint(target_distance: f32, min_distance: f32, smoothing_per_second: f32) void {
    g_legacy_controller.setDistanceConstraint(target_distance, min_distance, smoothing_per_second);
    if (activeSlot()) |slot| slot.controller.setDistanceConstraint(target_distance, min_distance, smoothing_per_second);
}

pub fn setDistanceConstraintForNode(node_id: u32, target_distance: f32, min_distance: f32, smoothing_per_second: f32) void {
    if (ensureSlot(node_id)) |slot| slot.controller.setDistanceConstraint(target_distance, min_distance, smoothing_per_second);
}

pub fn setSmoothing(per_second: f32) void {
    g_legacy_controller.setSmoothing(per_second);
    if (activeSlot()) |slot| slot.controller.setSmoothing(per_second);
}

pub fn setSmoothingForNode(node_id: u32, per_second: f32) void {
    if (ensureSlot(node_id)) |slot| slot.controller.setSmoothing(per_second);
}

pub fn applyInputDeltas(yaw_delta: f32, pitch_delta: f32) void {
    g_legacy_controller.applyInputDeltas(yaw_delta, pitch_delta);
    if (activeSlot()) |slot| {
        slot.controller.applyInputDeltas(yaw_delta, pitch_delta);
        probeRecordDeltas(slot);
    }
}

pub fn applyInputDeltasForNode(node_id: u32, yaw_delta: f32, pitch_delta: f32) void {
    if (ensureSlot(node_id)) |slot| {
        slot.controller.applyInputDeltas(yaw_delta, pitch_delta);
        probeRecordDeltas(slot);
    }
}

pub fn activeNodeId() u32 {
    return if (getSlot(g_active_node_id) != null) g_active_node_id else 0;
}

pub fn isBound(node_id: u32) bool {
    return getSlot(node_id) != null;
}

pub fn freeFlyForNode(node_id: u32) ?FreeFlyParams {
    const slot = getSlot(node_id) orelse return null;
    return slot.controller.freefly;
}

pub fn resetForTests() void {
    g_controllers = [_]ControllerSlot{.{}} ** MAX_CONTROLLERS;
    g_active_node_id = 0;
    g_legacy_controller = .{};
    g_probe_last_ms = 0;
    g_probe_clock_ms = 0;
    g_probe_snapshot = .{};
}

pub fn writeNode(node: anytype, solved: Solved) void {
    node.scene3d_camera = true;
    node.scene3d_pos_x = solved.pos.x;
    node.scene3d_pos_y = solved.pos.y;
    node.scene3d_pos_z = solved.pos.z;
    node.scene3d_look_x = solved.target.x;
    node.scene3d_look_y = solved.target.y;
    node.scene3d_look_z = solved.target.z;
    node.scene3d_fov = solved.fov;
}

pub fn stepActive(now_ms: u32) ?Solved {
    return stepNode(g_active_node_id, now_ms);
}

pub fn stepNode(node_id: u32, now_ms: u32) ?Solved {
    const slot = getSlot(node_id) orelse return null;
    g_probe_clock_ms = now_ms;
    const dt_ms = if (slot.last_tick_ms == 0 or now_ms < slot.last_tick_ms) 0 else now_ms - slot.last_tick_ms;
    slot.last_tick_ms = now_ms;
    const dt_seconds = @as(f32, @floatFromInt(dt_ms)) / 1000.0;
    const solved = slot.controller.step(dt_seconds);
    const desired = slot.controller.desired();
    probeRecordFrame(slot, dt_ms, desired, solved);
    if (g_probe_last_ms == 0 or now_ms < g_probe_last_ms or now_ms - g_probe_last_ms >= 1000) {
        g_probe_last_ms = now_ms;
        const avg_dt = if (slot.probe_frames == 0) 0 else @as(f32, @floatFromInt(slot.probe_dt_sum_ms)) / @as(f32, @floatFromInt(slot.probe_frames));
        const last_param_age_ms = if (slot.probe_last_param_wall_ms == 0) -1 else @as(i64, now_ms) - slot.probe_last_param_wall_ms;
        g_probe_snapshot = .{
            .has_sample = true,
            .node_id = node_id,
            .active_node_id = g_active_node_id,
            .frames = slot.probe_frames,
            .avg_dt_ms = avg_dt,
            .last_dt_ms = dt_ms,
            .params = slot.probe_params,
            .modes = slot.probe_modes,
            .deltas = slot.probe_deltas,
            .last_param_age_ms = last_param_age_ms,
            .max_solved_step = slot.probe_max_solved_step,
            .max_pos_lag = slot.probe_max_pos_lag,
            .max_target_lag = slot.probe_max_target_lag,
            .mode = slot.controller.mode,
            .desired = desired,
            .solved = solved,
            .slot_orbit = slot.controller.orbit,
            .staged_orbit = g_legacy_controller.orbit,
            .slot_freefly = slot.controller.freefly,
            .move_axes = slot.controller.move_axes,
        };
        probeResetWindow(slot);
    }
    return solved;
}

pub fn probeSnapshot() ProbeSnapshot {
    return g_probe_snapshot;
}

pub fn probeHostBind(label: []const u8, node_id: u32, hit: bool) void {
    _ = label;
    _ = node_id;
    _ = hit;
}

pub fn probeHostMode(label: []const u8, mode: Mode, argc: u32, node_id: u32) void {
    _ = label;
    _ = mode;
    _ = argc;
    _ = node_id;
}

pub fn probeHostOrbit(label: []const u8, params: OrbitParams, argc: u32, node_id: u32) void {
    _ = label;
    _ = params;
    _ = argc;
    _ = node_id;
}

pub fn probeHostAim(label: []const u8, params: AimParams, argc: u32, node_id: u32) void {
    _ = label;
    _ = params;
    _ = argc;
    _ = node_id;
}

pub fn probeHostDeltas(label: []const u8, yaw_delta: f32, pitch_delta: f32, argc: u32, node_id: u32) void {
    _ = label;
    _ = yaw_delta;
    _ = pitch_delta;
    _ = argc;
    _ = node_id;
}
