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
        }
    }

    pub fn desired(self: *const Controller) Solved {
        return switch (self.mode) {
            .orbit => solveOrbit(self.orbit),
            .aim => solveAim(self.aim),
        };
    }

    pub fn step(self: *Controller, dt_seconds: f32) Solved {
        const want = self.desired();
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
};

var g_controllers: [MAX_CONTROLLERS]ControllerSlot = [_]ControllerSlot{.{}} ** MAX_CONTROLLERS;
var g_active_node_id: u32 = 0;
var g_legacy_controller: Controller = .{};

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
    if (activeSlot()) |slot| slot.controller.setMode(mode);
}

pub fn setModeForNode(node_id: u32, mode: Mode) void {
    if (ensureSlot(node_id)) |slot| slot.controller.setMode(mode);
}

pub fn setOrbit(params: OrbitParams) void {
    g_legacy_controller.setOrbit(params);
    if (activeSlot()) |slot| slot.controller.setOrbit(params);
}

pub fn setOrbitForNode(node_id: u32, params: OrbitParams) void {
    if (ensureSlot(node_id)) |slot| slot.controller.setOrbit(params);
}

pub fn setAim(params: AimParams) void {
    g_legacy_controller.setAim(params);
    if (activeSlot()) |slot| slot.controller.setAim(params);
}

pub fn setAimForNode(node_id: u32, params: AimParams) void {
    if (ensureSlot(node_id)) |slot| slot.controller.setAim(params);
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
    if (activeSlot()) |slot| slot.controller.applyInputDeltas(yaw_delta, pitch_delta);
}

pub fn applyInputDeltasForNode(node_id: u32, yaw_delta: f32, pitch_delta: f32) void {
    if (ensureSlot(node_id)) |slot| slot.controller.applyInputDeltas(yaw_delta, pitch_delta);
}

pub fn activeNodeId() u32 {
    return if (getSlot(g_active_node_id) != null) g_active_node_id else 0;
}

pub fn isBound(node_id: u32) bool {
    return getSlot(node_id) != null;
}

pub fn resetForTests() void {
    g_controllers = [_]ControllerSlot{.{}} ** MAX_CONTROLLERS;
    g_active_node_id = 0;
    g_legacy_controller = .{};
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
    const dt_ms = if (slot.last_tick_ms == 0 or now_ms < slot.last_tick_ms) 0 else now_ms - slot.last_tick_ms;
    slot.last_tick_ms = now_ms;
    const dt_seconds = @as(f32, @floatFromInt(dt_ms)) / 1000.0;
    return slot.controller.step(dt_seconds);
}
