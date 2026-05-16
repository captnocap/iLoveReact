//! physics2d.zig — 2D physics engine integration (Box2D 2.4.1)
//!
//! Manages Box2D worlds and maps physics bodies to layout nodes.
//! Each frame: step worlds, then write body positions back to node computed x/y.
//!
//! Instance-safe: each <Physics.World> gets its own Box2D world and body pool.
//! Node.physics_world_id indexes into the world pool. Instance 0 is the default.
//!
//! Architecture:
//!   - Pool of MAX_PHYSICS_WORLDS, each with MAX_BODIES_PER_WORLD bodies
//!   - Bodies are registered with a pointer to their Node
//!   - tick(dt) steps all active worlds and syncs positions to nodes
//!   - Pixel <-> meter conversion: 1 meter = PIXELS_PER_METER pixels

const std = @import("std");
const layout = @import("../layout.zig");
const Node = layout.Node;

// ── Box2D C shim ───────────────────────────────────────────────
const c = @cImport({
    @cInclude("physics_shim.h");
});

// ── Constants ──────────────────────────────────────────────────

pub const PIXELS_PER_METER: f32 = 50.0;
pub const MAX_BODIES: usize = 256;
pub const MAX_BODIES_PER_WORLD: usize = 256;
pub const MAX_PHYSICS_WORLDS: u8 = 8;

const VELOCITY_ITERATIONS: c_int = 8;
const POSITION_ITERATIONS: c_int = 3;

// ── Body types ─────────────────────────────────────────────────

pub const BodyType = enum(c_int) {
    static_body = 0,
    kinematic = 1,
    dynamic = 2,
};

pub const ColliderShape = enum {
    rectangle,
    circle,
};

// ── Body registration ──────────────────────────────────────────

pub const Body = struct {
    active: bool = false,
    handle: c.PhysBody = null,
    node: ?*Node = null,
    offset_x: f32 = 0,
    offset_y: f32 = 0,
};

// ── Physics World Instance ─────────────────────────────────────

pub const PhysicsWorld = struct {
    world: c.PhysWorld = null,
    bodies: [MAX_BODIES_PER_WORLD]Body = [_]Body{.{}} ** MAX_BODIES_PER_WORLD,
    body_count: u32 = 0,
    initialized: bool = false,
    drag_joint: c.PhysJoint = null,
    drag_body: c.PhysBody = null,
};

var worlds: [MAX_PHYSICS_WORLDS]PhysicsWorld = [_]PhysicsWorld{.{}} ** MAX_PHYSICS_WORLDS;

fn w(id: u8) *PhysicsWorld {
    return &worlds[@min(id, MAX_PHYSICS_WORLDS - 1)];
}

// ── Public API (backward-compat wrappers → world 0) ───────────

pub fn init(gravity_x: f32, gravity_y: f32) void {
    initFor(0, gravity_x, gravity_y);
}

pub fn initFor(id: u8, gravity_x: f32, gravity_y: f32) void {
    const pw = w(id);
    if (pw.initialized) deinitFor(id);
    pw.world = c.phys_world_create(
        gravity_x / PIXELS_PER_METER,
        gravity_y / PIXELS_PER_METER,
    );
    pw.initialized = true;
    pw.body_count = 0;
    for (&pw.bodies) |*b| b.active = false;
}

pub fn deinit() void {
    deinitFor(0);
}

pub fn deinitFor(id: u8) void {
    const pw = w(id);
    if (!pw.initialized) return;
    c.phys_world_destroy(pw.world);
    pw.world = null;
    pw.initialized = false;
    pw.body_count = 0;
    for (&pw.bodies) |*b| b.active = false;
}

pub fn createBody(body_type: BodyType, x: f32, y: f32, angle: f32, node: ?*Node) ?u32 {
    return createBodyFor(0, body_type, x, y, angle, node);
}

pub fn createBodyFor(id: u8, body_type: BodyType, x: f32, y: f32, angle: f32, node: ?*Node) ?u32 {
    const pw = w(id);
    if (!pw.initialized) return null;

    const idx = allocBodyIn(pw) orelse return null;
    const handle = c.phys_body_create(
        pw.world,
        @intFromEnum(body_type),
        x / PIXELS_PER_METER,
        y / PIXELS_PER_METER,
        angle,
    );

    pw.bodies[idx] = .{
        .active = true,
        .handle = handle,
        .node = node,
    };
    pw.body_count += 1;
    return @intCast(idx);
}

pub fn addBoxCollider(body_idx: u32, width: f32, height: f32, density: f32, friction: f32, restitution: f32) void {
    addBoxColliderFor(0, body_idx, width, height, density, friction, restitution);
}

pub fn addBoxColliderFor(id: u8, body_idx: u32, width: f32, height: f32, density: f32, friction: f32, restitution: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    const b = &pw.bodies[body_idx];
    const half_w = (width / 2.0) / PIXELS_PER_METER;
    const half_h = (height / 2.0) / PIXELS_PER_METER;
    _ = c.phys_collider_box(b.handle, half_w, half_h, density, friction, restitution);
    b.offset_x = width / 2.0;
    b.offset_y = height / 2.0;
}

pub fn addCircleCollider(body_idx: u32, radius: f32, density: f32, friction: f32, restitution: f32) void {
    addCircleColliderFor(0, body_idx, radius, density, friction, restitution);
}

pub fn addCircleColliderFor(id: u8, body_idx: u32, radius: f32, density: f32, friction: f32, restitution: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    const b = &pw.bodies[body_idx];
    _ = c.phys_collider_circle(b.handle, radius / PIXELS_PER_METER, density, friction, restitution);
    b.offset_x = radius;
    b.offset_y = radius;
}

/// Step all active physics worlds and sync body positions to nodes.
pub fn tick(dt: f32) void {
    for (&worlds) |*pw| {
        if (!pw.initialized) continue;
        tickWorld(pw, dt);
    }
}

/// Step a single world by ID.
pub fn tickFor(id: u8, dt: f32) void {
    const pw = w(id);
    if (!pw.initialized) return;
    tickWorld(pw, dt);
}

fn tickWorld(pw: *PhysicsWorld, dt: f32) void {
    c.phys_world_step(pw.world, dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    for (&pw.bodies) |*b| {
        if (!b.active or b.node == null) continue;
        const node = b.node.?;
        const bx = c.phys_body_get_x(b.handle) * PIXELS_PER_METER;
        const by = c.phys_body_get_y(b.handle) * PIXELS_PER_METER;
        const angle = c.phys_body_get_angle(b.handle);
        node.computed.x = bx - b.offset_x;
        node.computed.y = by - b.offset_y;
        node.style.rotation = angle;
    }
}

pub fn applyForce(body_idx: u32, fx: f32, fy: f32) void {
    applyForceFor(0, body_idx, fx, fy);
}

pub fn applyForceFor(id: u8, body_idx: u32, fx: f32, fy: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_apply_force(pw.bodies[body_idx].handle, fx / PIXELS_PER_METER, fy / PIXELS_PER_METER);
}

pub fn applyImpulse(body_idx: u32, ix: f32, iy: f32) void {
    applyImpulseFor(0, body_idx, ix, iy);
}

pub fn applyImpulseFor(id: u8, body_idx: u32, ix: f32, iy: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_apply_impulse(pw.bodies[body_idx].handle, ix / PIXELS_PER_METER, iy / PIXELS_PER_METER);
}

pub fn setVelocity(body_idx: u32, vx: f32, vy: f32) void {
    setVelocityFor(0, body_idx, vx, vy);
}

pub fn setVelocityFor(id: u8, body_idx: u32, vx: f32, vy: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_set_linear_velocity(pw.bodies[body_idx].handle, vx / PIXELS_PER_METER, vy / PIXELS_PER_METER);
}

pub fn setLinearDamping(body_idx: u32, damping: f32) void {
    setLinearDampingFor(0, body_idx, damping);
}

pub fn setLinearDampingFor(id: u8, body_idx: u32, damping: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_set_linear_damping(pw.bodies[body_idx].handle, damping);
}

pub fn setAngularDamping(body_idx: u32, damping: f32) void {
    setAngularDampingFor(0, body_idx, damping);
}

pub fn setAngularDampingFor(id: u8, body_idx: u32, damping: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_set_angular_damping(pw.bodies[body_idx].handle, damping);
}

pub fn setFixedRotation(body_idx: u32, fixed: bool) void {
    setFixedRotationFor(0, body_idx, fixed);
}

pub fn setFixedRotationFor(id: u8, body_idx: u32, fixed: bool) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_set_fixed_rotation(pw.bodies[body_idx].handle, if (fixed) 1 else 0);
}

pub fn setBullet(body_idx: u32, bullet: bool) void {
    setBulletFor(0, body_idx, bullet);
}

pub fn setBulletFor(id: u8, body_idx: u32, bullet: bool) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_set_bullet(pw.bodies[body_idx].handle, if (bullet) 1 else 0);
}

pub fn setGravityScale(body_idx: u32, scale: f32) void {
    setGravityScaleFor(0, body_idx, scale);
}

pub fn setGravityScaleFor(id: u8, body_idx: u32, scale: f32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_set_gravity_scale(pw.bodies[body_idx].handle, scale);
}

pub fn destroyBody(body_idx: u32) void {
    destroyBodyFor(0, body_idx);
}

pub fn destroyBodyFor(id: u8, body_idx: u32) void {
    const pw = w(id);
    if (body_idx >= MAX_BODIES_PER_WORLD or !pw.bodies[body_idx].active) return;
    c.phys_body_destroy(pw.world, pw.bodies[body_idx].handle);
    pw.bodies[body_idx].active = false;
    if (pw.body_count > 0) pw.body_count -= 1;
}

pub fn clear() void {
    clearFor(0);
}

pub fn clearFor(id: u8) void {
    deinitFor(id);
}

pub fn activeCount() u32 {
    return activeCountFor(0);
}

pub fn activeCountFor(id: u8) u32 {
    return w(id).body_count;
}

pub fn isInitialized() bool {
    return isInitializedFor(0);
}

pub fn isInitializedFor(id: u8) bool {
    return w(id).initialized;
}

/// Check if ANY world is initialized (for engine tick guard).
pub fn anyInitialized() bool {
    for (&worlds) |*pw| {
        if (pw.initialized) return true;
    }
    return false;
}

// ── Mouse drag ──────────────────────────────────────────────────

pub fn startDrag(px: f32, py: f32) void {
    startDragFor(0, px, py);
}

pub fn startDragFor(id: u8, px: f32, py: f32) void {
    const pw = w(id);
    if (!pw.initialized or pw.world == null) return;
    if (pw.drag_joint != null) return;
    const mx = px / PIXELS_PER_METER;
    const my = py / PIXELS_PER_METER;
    const body = c.phys_query_point(pw.world, mx, my);
    if (body == null) return;
    pw.drag_body = body;
    pw.drag_joint = c.phys_mouse_joint_create(pw.world, body, mx, my, 5000.0);
}

pub fn updateDrag(px: f32, py: f32) void {
    updateDragFor(0, px, py);
}

pub fn updateDragFor(id: u8, px: f32, py: f32) void {
    const pw = w(id);
    if (pw.drag_joint == null) return;
    c.phys_mouse_joint_set_target(pw.drag_joint, px / PIXELS_PER_METER, py / PIXELS_PER_METER);
}

pub fn endDrag() void {
    endDragFor(0);
}

pub fn endDragFor(id: u8) void {
    const pw = w(id);
    if (pw.drag_joint == null) return;
    c.phys_mouse_joint_destroy(pw.drag_joint);
    pw.drag_joint = null;
    pw.drag_body = null;
}

pub fn isDragging() bool {
    return isDraggingFor(0);
}

pub fn isDraggingFor(id: u8) bool {
    return w(id).drag_joint != null;
}

// ── Internal ───────────────────────────────────────────────────

fn allocBodyIn(pw: *PhysicsWorld) ?usize {
    for (0..MAX_BODIES_PER_WORLD) |i| {
        if (!pw.bodies[i].active) return i;
    }
    return null;
}

// ============================================================================
// Tests
// ============================================================================

test "world create and destroy" {
    init(0, 980);
    try std.testing.expect(isInitialized());
    try std.testing.expectEqual(@as(u32, 0), activeCount());
    deinit();
    try std.testing.expect(!isInitialized());
}

test "create bodies" {
    init(0, 980);
    defer deinit();

    const b0 = createBody(.static_body, 400, 580, 0, null);
    try std.testing.expect(b0 != null);
    try std.testing.expectEqual(@as(u32, 1), activeCount());

    const b1 = createBody(.dynamic, 400, 100, 0, null);
    try std.testing.expect(b1 != null);
    try std.testing.expectEqual(@as(u32, 2), activeCount());
}

test "add colliders" {
    init(0, 980);
    defer deinit();

    const b0 = createBody(.static_body, 400, 580, 0, null).?;
    addBoxCollider(b0, 800, 40, 0, 0.3, 0.1);

    const b1 = createBody(.dynamic, 400, 100, 0, null).?;
    addCircleCollider(b1, 20, 1.0, 0.3, 0.6);
}

test "gravity makes dynamic body fall" {
    init(0, 980);
    defer deinit();

    const floor = createBody(.static_body, 400, 600, 0, null).?;
    addBoxCollider(floor, 800, 40, 0, 0.3, 0.1);

    var ball_node = layout.Node{};
    const ball = createBody(.dynamic, 400, 100, 0, &ball_node).?;
    addCircleCollider(ball, 20, 1.0, 0.3, 0.6);

    for (0..60) |_| {
        tick(1.0 / 60.0);
    }

    const top = ball_node.style.top orelse 0;
    try std.testing.expect(top > 100);
}

test "destroy body" {
    init(0, 980);
    defer deinit();

    const b0 = createBody(.dynamic, 0, 0, 0, null).?;
    try std.testing.expectEqual(@as(u32, 1), activeCount());

    destroyBody(b0);
    try std.testing.expectEqual(@as(u32, 0), activeCount());
}

test "multi-world isolation" {
    initFor(0, 0, 980);
    initFor(1, 0, -980);
    defer deinitFor(0);
    defer deinitFor(1);

    const b0 = createBodyFor(0, .dynamic, 100, 100, 0, null);
    const b1 = createBodyFor(1, .dynamic, 100, 100, 0, null);
    try std.testing.expect(b0 != null);
    try std.testing.expect(b1 != null);

    try std.testing.expectEqual(@as(u32, 1), activeCountFor(0));
    try std.testing.expectEqual(@as(u32, 1), activeCountFor(1));

    // Destroying in world 0 doesn't affect world 1
    destroyBodyFor(0, b0.?);
    try std.testing.expectEqual(@as(u32, 0), activeCountFor(0));
    try std.testing.expectEqual(@as(u32, 1), activeCountFor(1));
}
