//! physics3d.zig — 3D physics engine integration (Bullet Physics 3.25)
//!
//! Manages Bullet worlds and maps physics bodies to 3D.Mesh layout nodes.
//! Each frame: step worlds, then write body transforms back to node scene3d fields.
//!
//! Instance-safe: each <3D.Physics> gets its own Bullet world and body pool.
//! Node.physics3d_world_id indexes into the world pool. Instance 0 is the default.
//!
//! Architecture:
//!   - Pool of MAX_PHYSICS3D_WORLDS, each with MAX_BODIES_PER_WORLD bodies
//!   - Bodies are registered with a pointer to their Node
//!   - tick(dt) steps all active worlds and syncs transforms to nodes
//!   - Works in world units (1 unit = 1 unit, no pixel conversion like 2D)

const std = @import("std");
const layout = @import("../layout.zig");
const Node = layout.Node;

// ── Bullet C shim ──────────────────────────────────────────────
const c = @cImport({
    @cInclude("physics3d_shim.h");
});

// ── Constants ──────────────────────────────────────────────────

pub const MAX_BODIES: usize = 256;
pub const MAX_BODIES_PER_WORLD: usize = 256;
pub const MAX_PHYSICS3D_WORLDS: u8 = 8;
const MAX_SUBSTEPS: c_int = 10;

// ── Body types ─────────────────────────────────────────────────

pub const BodyType = enum(u8) {
    static_body = 0,
    kinematic = 1,
    dynamic = 2,
};

pub const ColliderShape = enum {
    box,
    sphere,
    cylinder,
    capsule,
    cone,
    plane,
    heightfield,
};

// ── Body registration ──────────────────────────────────────────

pub const Body = struct {
    active: bool = false,
    handle: c.Phys3DBody = null,
    shape: c.Phys3DShape = null,
    node: ?*Node = null,
};

// ── Physics3D World Instance ───────────────────────────────────

pub const Physics3DWorld = struct {
    world: c.Phys3DWorld = null,
    bodies: [MAX_BODIES_PER_WORLD]Body = [_]Body{.{}} ** MAX_BODIES_PER_WORLD,
    body_count: u32 = 0,
    initialized: bool = false,
};

var worlds: [MAX_PHYSICS3D_WORLDS]Physics3DWorld = [_]Physics3DWorld{.{}} ** MAX_PHYSICS3D_WORLDS;

fn w(id: u8) *Physics3DWorld {
    return &worlds[@min(id, MAX_PHYSICS3D_WORLDS - 1)];
}

// ── Init / Deinit ──────────────────────────────────────────────

pub fn init(gravity_x: f32, gravity_y: f32, gravity_z: f32) void {
    initFor(0, gravity_x, gravity_y, gravity_z);
}

pub fn initFor(id: u8, gravity_x: f32, gravity_y: f32, gravity_z: f32) void {
    const pw = w(id);
    if (pw.initialized) return;
    pw.world = c.phys3d_world_create(gravity_x, gravity_y, gravity_z);
    if (pw.world == null) return;
    pw.initialized = true;
    pw.body_count = 0;
    for (&pw.bodies) |*b| b.* = .{};
}

pub fn deinit() void {
    deinitFor(0);
}

pub fn deinitFor(id: u8) void {
    const pw = w(id);
    if (!pw.initialized) return;
    for (&pw.bodies) |*b| {
        if (b.active and b.handle != null) {
            c.phys3d_body_destroy(pw.world, b.handle);
            if (b.shape != null) c.phys3d_shape_destroy(b.shape);
        }
        b.* = .{};
    }
    pw.body_count = 0;
    c.phys3d_world_destroy(pw.world);
    pw.world = null;
    pw.initialized = false;
}

pub fn isInitialized() bool {
    return isInitializedFor(0);
}

pub fn isInitializedFor(id: u8) bool {
    return w(id).initialized;
}

pub fn anyInitialized() bool {
    for (&worlds) |*pw| {
        if (pw.initialized) return true;
    }
    return false;
}

// ── Body creation ──────────────────────────────────────────────

pub fn createBody(
    body_type: BodyType,
    shape_type: ColliderShape,
    x: f32, y: f32, z: f32,
    mass: f32,
    size_x: f32, size_y: f32, size_z: f32,
    radius: f32,
    target: *Node,
) ?u32 {
    return createBodyFor(0, body_type, shape_type, x, y, z, mass, size_x, size_y, size_z, radius, target);
}

pub fn createBodyFor(
    id: u8,
    body_type: BodyType,
    shape_type: ColliderShape,
    x: f32, y: f32, z: f32,
    mass: f32,
    size_x: f32, size_y: f32, size_z: f32,
    radius: f32,
    target: *Node,
) ?u32 {
    const pw = w(id);
    if (!pw.initialized) return null;

    var idx: u32 = 0;
    while (idx < MAX_BODIES_PER_WORLD) : (idx += 1) {
        if (!pw.bodies[idx].active) break;
    }
    if (idx >= MAX_BODIES_PER_WORLD) return null;

    const shape: c.Phys3DShape = switch (shape_type) {
        .box => c.phys3d_shape_box(size_x * 0.5, size_y * 0.5, size_z * 0.5),
        .sphere => c.phys3d_shape_sphere(radius),
        .cylinder => c.phys3d_shape_cylinder(size_x * 0.5, size_y * 0.5, size_z * 0.5),
        .capsule => c.phys3d_shape_capsule(radius, size_y),
        .cone => c.phys3d_shape_cone(radius, size_y),
        .plane => c.phys3d_shape_plane(0, 1, 0, 0),
        .heightfield => return null,
    };
    if (shape == null) return null;

    const bt: c_int = @intFromEnum(body_type);
    const body = c.phys3d_body_create(pw.world, shape, bt, mass, x, y, z);
    if (body == null) {
        c.phys3d_shape_destroy(shape);
        return null;
    }

    pw.bodies[idx] = .{
        .active = true,
        .handle = body,
        .shape = shape,
        .node = target,
    };
    pw.body_count += 1;
    return idx;
}

pub fn destroyBody(idx: u32) void {
    destroyBodyFor(0, idx);
}

pub fn destroyBodyFor(id: u8, idx: u32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    if (pw.bodies[idx].handle != null) {
        c.phys3d_body_destroy(pw.world, pw.bodies[idx].handle);
    }
    if (pw.bodies[idx].shape != null) {
        c.phys3d_shape_destroy(pw.bodies[idx].shape);
    }
    pw.bodies[idx] = .{};
    if (pw.body_count > 0) pw.body_count -= 1;
}

// ── Properties ─────────────────────────────────────────────────

pub fn setFriction(idx: u32, friction: f32) void {
    setFrictionFor(0, idx, friction);
}

pub fn setFrictionFor(id: u8, idx: u32, friction: f32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    c.phys3d_body_set_friction(pw.bodies[idx].handle, friction);
}

pub fn setRestitution(idx: u32, restitution: f32) void {
    setRestitutionFor(0, idx, restitution);
}

pub fn setRestitutionFor(id: u8, idx: u32, restitution: f32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    c.phys3d_body_set_restitution(pw.bodies[idx].handle, restitution);
}

pub fn setDamping(idx: u32, linear: f32, angular: f32) void {
    setDampingFor(0, idx, linear, angular);
}

pub fn setDampingFor(id: u8, idx: u32, linear: f32, angular: f32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    c.phys3d_body_set_damping(pw.bodies[idx].handle, linear, angular);
}

// ── Forces ─────────────────────────────────────────────────────

pub fn applyForce(idx: u32, fx: f32, fy: f32, fz: f32) void {
    applyForceFor(0, idx, fx, fy, fz);
}

pub fn applyForceFor(id: u8, idx: u32, fx: f32, fy: f32, fz: f32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    c.phys3d_body_apply_force(pw.bodies[idx].handle, fx, fy, fz);
}

pub fn applyImpulse(idx: u32, ix: f32, iy: f32, iz: f32) void {
    applyImpulseFor(0, idx, ix, iy, iz);
}

pub fn applyImpulseFor(id: u8, idx: u32, ix: f32, iy: f32, iz: f32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    c.phys3d_body_apply_impulse(pw.bodies[idx].handle, ix, iy, iz);
}

pub fn setLinearVelocity(idx: u32, vx: f32, vy: f32, vz: f32) void {
    setLinearVelocityFor(0, idx, vx, vy, vz);
}

pub fn setLinearVelocityFor(id: u8, idx: u32, vx: f32, vy: f32, vz: f32) void {
    const pw = w(id);
    if (idx >= MAX_BODIES_PER_WORLD or !pw.bodies[idx].active) return;
    c.phys3d_body_set_linear_velocity(pw.bodies[idx].handle, vx, vy, vz);
}

// ── Raycast ────────────────────────────────────────────────────

pub const RayHit = struct {
    x: f32,
    y: f32,
    z: f32,
    normal_x: f32,
    normal_y: f32,
    normal_z: f32,
};

pub fn raycast(from_x: f32, from_y: f32, from_z: f32, to_x: f32, to_y: f32, to_z: f32) ?RayHit {
    return raycastFor(0, from_x, from_y, from_z, to_x, to_y, to_z);
}

pub fn raycastFor(id: u8, from_x: f32, from_y: f32, from_z: f32, to_x: f32, to_y: f32, to_z: f32) ?RayHit {
    const pw = w(id);
    if (!pw.initialized) return null;
    var hit: RayHit = undefined;
    const result = c.phys3d_raycast(pw.world, from_x, from_y, from_z, to_x, to_y, to_z,
        &hit.x, &hit.y, &hit.z, &hit.normal_x, &hit.normal_y, &hit.normal_z);
    return if (result == 1) hit else null;
}

// ── Tick — step worlds and sync transforms to nodes ─────────────

/// Step all active 3D physics worlds.
pub fn tick(dt: f32) void {
    for (&worlds) |*pw| {
        if (!pw.initialized) continue;
        tickWorld(pw, dt);
    }
}

pub fn tickFor(id: u8, dt: f32) void {
    const pw = w(id);
    if (!pw.initialized) return;
    tickWorld(pw, dt);
}

fn tickWorld(pw: *Physics3DWorld, dt: f32) void {
    c.phys3d_world_step(pw.world, dt, MAX_SUBSTEPS);
    for (&pw.bodies) |*b| {
        if (!b.active or b.handle == null) continue;
        const node = b.node orelse continue;
        node.scene3d_pos_x = c.phys3d_body_get_x(b.handle);
        node.scene3d_pos_y = c.phys3d_body_get_y(b.handle);
        node.scene3d_pos_z = c.phys3d_body_get_z(b.handle);
        var rx: f32 = 0;
        var ry: f32 = 0;
        var rz: f32 = 0;
        c.phys3d_body_get_euler(b.handle, &rx, &ry, &rz);
        node.scene3d_rot_x = rx;
        node.scene3d_rot_y = ry;
        node.scene3d_rot_z = rz;
    }
}
