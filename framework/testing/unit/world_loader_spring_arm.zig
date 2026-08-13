//! Spring-arm camera vs placed-prop collision (req_4292 / req_4293).
//!
//! The /play camera steps against TWO collider sets: the dedicated full-authored
//! camera buffer and the live physics set. Mesh-prop coarse boxes (a placed
//! container's walls) exist ONLY in the physics set — they ride the oriented lane
//! with the EXACT_MESH_COARSE_SOLID_FLAG (−1) solid value and a finite floor.
//! Before the second input existed, a baked map's camera read only the authored
//! buffer and sailed straight through every placed prop's walls while the player
//! (exact-triangle narrowphase) stayed inside. These tests pin the prop lane.

const std = @import("std");
const camera = @import("../../world_loader/camera.zig");
const loader_state = @import("../../world_loader/state.zig");
const loader_physics = @import("../../world_loader/physics.zig");
const constructor = @import("../../world/constructor.zig");
const game_physics = @import("../../game/physics.zig");

const HEADER = game_physics.INPUT_HEADER_FLOATS;
const ORIENTED = game_physics.ORIENTED_FLOATS;

/// A container's north wall as ONE coarse collision island in the mesh's local
/// frame: 2.4 m wide, 2.6 m tall, 10 cm thick, base on the ground.
const CONTAINER_WALL = loader_physics.MeshIsland{
    .lo = .{ -1.2, 0.0, 1.4 },
    .hi = .{ 1.2, 2.6, 1.5 },
};

fn containerInstance(yaw_degrees: f32) constructor.MeshPropInstance {
    return .{ .mesh = 0, .x = 10, .y = 0, .z = 5, .yaw_degrees = yaw_degrees, .scale = 1 };
}

/// Pack one prop island into a PhysicsColliders buffer exactly the way the
/// loader does: header zeros, no rects, the island as one oriented row with the
/// exact-narrowphase solid flag (the value the camera lane must NOT skip).
fn propColliders(buf: *[HEADER + ORIENTED]f32, yaw_degrees: f32) loader_state.PhysicsColliders {
    @memset(buf, 0);
    const row = loader_physics.islandOrientedFloats(containerInstance(yaw_degrees), CONTAINER_WALL, true);
    @memcpy(buf[HEADER..], &row);
    return .{
        .values = buf,
        .rect_count = 0,
        .oriented_count = 1,
        .heightfield_count = 0,
        .clipped_rows = 0,
    };
}

/// An authored camera buffer with no rows — the shape of a baked map whose
/// piece walls are elsewhere: it must NOT satisfy the prop clip on its own.
fn emptyAuthoredColliders(buf: *[HEADER]f32) loader_state.PhysicsColliders {
    @memset(buf, 0);
    return .{
        .values = buf,
        .rect_count = 0,
        .oriented_count = 0,
        .heightfield_count = 0,
        .clipped_rows = 0,
    };
}

/// Player inside the container, desired eye orbited out through the north wall
/// (world z band 6.4..6.5 at yaw 0).
fn wantThroughNorthWall() camera.CameraSolve {
    return .{
        .pos = .{ .x = 10, .y = 2.0, .z = 8.5 },
        .target = .{ .x = 10, .y = 1.5, .z = 5 },
        .fov = 60,
        .pivot = .{ .x = 10, .y = 1.5, .z = 5 },
    };
}

test "prop coarse boxes in the physics set pull the eye to the wall's near side" {
    var prop_buf: [HEADER + ORIENTED]f32 = undefined;
    var wall_buf: [HEADER]f32 = undefined;
    const props = propColliders(&prop_buf, 0);
    const authored = emptyAuthoredColliders(&wall_buf);
    const want = wantThroughNorthWall();

    // The failing shape: authored camera buffer alone lets the eye through.
    const through = camera.springArmEye(want, authored, null);
    try std.testing.expectApproxEqAbs(want.pos.z, through.z, 0.001);

    // With the physics set as the second input the eye stays inside the wall.
    const held = camera.springArmEye(want, authored, props);
    try std.testing.expect(held.z < 6.4);
    try std.testing.expect(held.z > want.pivot.z);
}

test "a yawed prop instance clips the eye through the oriented rotation" {
    var prop_buf: [HEADER + ORIENTED]f32 = undefined;
    // Rotated 180°: the same local wall now stands at world z 3.5..3.6.
    const props = propColliders(&prop_buf, 180);
    const want = camera.CameraSolve{
        .pos = .{ .x = 10, .y = 2.0, .z = 1.5 },
        .target = .{ .x = 10, .y = 1.5, .z = 5 },
        .fov = 60,
        .pivot = .{ .x = 10, .y = 1.5, .z = 5 },
    };
    const held = camera.springArmEye(want, null, props);
    try std.testing.expect(held.z > 3.6);
    try std.testing.expect(held.z < want.pivot.z);
}

test "the pre-lump fallback passes the same buffer twice without double-clipping" {
    var prop_buf: [HEADER + ORIENTED]f32 = undefined;
    const props = propColliders(&prop_buf, 0);
    const want = wantThroughNorthWall();
    const once = camera.springArmEye(want, props, null);
    const twice = camera.springArmEye(want, props, props);
    try std.testing.expectApproxEqAbs(once.x, twice.x, 0.0001);
    try std.testing.expectApproxEqAbs(once.y, twice.y, 0.0001);
    try std.testing.expectApproxEqAbs(once.z, twice.z, 0.0001);
}

test "every camera decl analyzes — updateCameraNode carries the prop-collider input" {
    std.testing.refAllDecls(camera);
}

test "a clear view keeps the full desired eye" {
    const want = wantThroughNorthWall();
    const eye = camera.springArmEye(want, null, null);
    try std.testing.expectApproxEqAbs(want.pos.x, eye.x, 0.001);
    try std.testing.expectApproxEqAbs(want.pos.y, eye.y, 0.001);
    try std.testing.expectApproxEqAbs(want.pos.z, eye.z, 0.001);
}
