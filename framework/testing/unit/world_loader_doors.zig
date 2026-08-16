//! Cooked-door swing collider law (req_4538).
//!
//! The swinging leaf collides as an ORIENTED box that follows the swing —
//! pivot at the swung panel center, yaw = instance yaw + swing angle. It was
//! previously the world AABB of the swung leaf, which is exact at cardinal
//! yaws but inflates over the whole doorway at a diagonal one: the player hit
//! an invisible collider standing in a visually open angled doorway. These
//! tests pin the emitted floats at cardinal and diagonal yaws, closed and
//! open, so the leaf's collider can never silently fall back to an AABB.
//!
//! Run: zig build test-world-loader-doors

const std = @import("std");
const loader_state = @import("../../world_loader/state.zig");
const runtime_dynamics = @import("../../world_loader/runtime_dynamics.zig");
const game_physics = @import("../../game/physics.zig");

const testing = std.testing;
const CookedDoor = loader_state.CookedDoor;
const cookedDoorOrientedFloats = loader_state.cookedDoorOrientedFloats;

/// The doorway from the live repro: a 0.9×0.06×2.1 leaf on a 45° wall,
/// portal center at the origin, hinge on the min-X local edge.
fn diagonalDoor(progress: f32) CookedDoor {
    return .{
        .open = progress >= 0.5,
        .progress = progress,
        .yaw_degrees = 45,
        .cx = 0,
        .cz = 0,
        .base_y = 0,
        .panel_h = 2.1,
        .half_x = 0.339411, // |cos45|·0.45 + |sin45|·0.03 (closed-pose AABB record)
        .half_z = 0.339411,
        .half_w_local = 0.45,
        .half_d_local = 0.03,
        .hinge_x = -0.318198, // local (−0.45, 0) through the 45° instance transform
        .hinge_z = 0.318198,
        .reach = 2,
        .vehicle = false,
    };
}

test "closed diagonal leaf: oriented box sits on the portal at the instance yaw" {
    const floats = cookedDoorOrientedFloats(diagonalDoor(0));
    try testing.expectApproxEqAbs(@as(f32, -0.45), floats[0], 1e-4); // min local X
    try testing.expectApproxEqAbs(@as(f32, -0.03), floats[1], 1e-4); // min local Z
    try testing.expectApproxEqAbs(@as(f32, 0.45), floats[2], 1e-4); // max local X
    try testing.expectApproxEqAbs(@as(f32, 0.03), floats[3], 1e-4); // max local Z
    try testing.expectApproxEqAbs(@as(f32, 2.1), floats[4], 1e-4); // top
    try testing.expect(floats[5] > 0.5); // solid
    try testing.expectApproxEqAbs(@as(f32, 0), floats[8], 1e-4); // floor
    try testing.expectApproxEqAbs(@as(f32, 0), floats[9], 1e-4); // pivot X = panel center
    try testing.expectApproxEqAbs(@as(f32, 0), floats[10], 1e-4); // pivot Z
    try testing.expectApproxEqAbs(@as(f32, std.math.pi / 4.0), floats[11], 1e-4); // instance yaw
}

test "open diagonal leaf: the box follows the swing and leaves the portal clear (req_4538)" {
    const floats = cookedDoorOrientedFloats(diagonalDoor(1));
    // Fully open, the panel center swings about the hinge to (−0.636, 0) and
    // the leaf stands perpendicular to the wall (total yaw 135°).
    try testing.expectApproxEqAbs(@as(f32, -0.636396), floats[9], 1e-3);
    try testing.expectApproxEqAbs(@as(f32, 0), floats[10], 1e-3);
    try testing.expectApproxEqAbs(@as(f32, 3.0 * std.math.pi / 4.0), floats[11], 1e-4);
    // Local box stays the leaf's OWN extents around the pivot — never the
    // inflated world AABB that bricked the doorway.
    try testing.expectApproxEqAbs(@as(f32, 0.45), (floats[2] - floats[0]) / 2.0, 1e-4);
    try testing.expectApproxEqAbs(@as(f32, 0.03), (floats[3] - floats[1]) / 2.0, 1e-4);

    // The regression itself: a player-sized probe at the portal center must
    // clear the open leaf. Rotate the probe into the leaf frame about the
    // pivot (the engine's worldToLocal) and check the z-slab clearance.
    const player_radius = 0.34;
    const cs = @cos(floats[11]);
    const sn = @sin(floats[11]);
    const dx = 0.0 - floats[9];
    const dz = 0.0 - floats[10];
    const local_z = floats[10] + sn * dx + cs * dz;
    try testing.expect(local_z > floats[3] + player_radius or local_z < floats[1] - player_radius);
}

test "cardinal leaf parity: at yaw 0 the oriented box matches the old exact AABB" {
    var door = diagonalDoor(0);
    door.yaw_degrees = 0;
    door.hinge_x = -0.45;
    door.hinge_z = 0;
    const closed = cookedDoorOrientedFloats(door);
    // yaw 0 → the oriented box IS the axis box the rect lane used to emit.
    try testing.expectApproxEqAbs(@as(f32, -0.45), closed[0], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, -0.03), closed[1], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, 0.45), closed[2], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, 0.03), closed[3], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, 0), closed[11], 1e-4);

    door.progress = 1;
    door.open = true;
    const open = cookedDoorOrientedFloats(door);
    // 90° about the hinge (−0.45, 0) under the engine's m4rotateY convention
    // ((x,z) → (z,−x)): the panel center lands at (−0.45, −0.45), yaw 90°.
    try testing.expectApproxEqAbs(@as(f32, -0.45), open[9], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, -0.45), open[10], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, std.math.pi / 2.0), open[11], 1e-4);
}

test "the swing collider rides the oriented lane end to end" {
    // The struct carries an oriented_index and the floats are ORIENTED_FLOATS
    // wide — a compile-time seal against the leaf drifting back to a rect.
    const door = diagonalDoor(1);
    _ = door.oriented_index;
    const floats: [game_physics.ORIENTED_FLOATS]f32 = cookedDoorOrientedFloats(door);
    try testing.expectEqual(@as(usize, 12), floats.len);
}

const MockNode = struct {
    scene3d_pos_x: f32 = 0,
    scene3d_pos_y: f32 = 0,
    scene3d_pos_z: f32 = 0,
    scene3d_rot_y: f32 = 0,
};

test "applyCookedDoorPose writes the swing box into the ORIENTED section past the rects" {
    // The per-frame writer must land at orientedBase() + index — a base that
    // MOVES whenever live folds change rect_count, which is why it recomputes
    // per call. One rect of padding proves the offset is honored.
    var values: [game_physics.INPUT_HEADER_FLOATS + game_physics.RECT_FLOATS + game_physics.ORIENTED_FLOATS]f32 = @splat(0);
    var nodes: [1]MockNode = .{.{}};
    var mock = .{
        .kid_list = .{ .items = nodes[0..] },
        .physics_colliders = loader_state.PhysicsColliders{
            .values = values[0..],
            .rect_count = 1,
            .oriented_count = 1,
            .heightfield_count = 0,
            .clipped_rows = 0,
        },
    };
    var door = diagonalDoor(1);
    door.oriented_index = 0;
    door.node_child_first = 0;
    door.node_child_count = 1;
    runtime_dynamics.applyCookedDoorPose(&mock, &door);
    const at = mock.physics_colliders.orientedBase();
    const expected = cookedDoorOrientedFloats(door);
    for (expected, 0..) |value, i| try testing.expectApproxEqAbs(value, values[at + i], 1e-4);
    // the leaf node followed the swing: instance yaw 45° + arc 90°
    try testing.expectApproxEqAbs(@as(f32, 135), nodes[0].scene3d_rot_y, 1e-4);
}
