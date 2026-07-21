//! Exact exported-mesh collision behavior at the owning Zig layer.
//! Run: tools/zig/zig build test-game-mesh-collision

const std = @import("std");
const testing = std.testing;
const physics = @import("game_physics");
const mesh_collision = physics.mesh_collision;

const SLOPED_WALL = [_]f32{
    -1, 0, 4, 1, 0, 4, 1, 6, 3,
    -1, 0, 4, 1, 6, 3, -1, 6, 3,
};

test "sloped wall stops at the face, not its empty AABB corner" {
    var body: mesh_collision.Body = .{
        .x = 0,
        .y = 0,
        .z = 3.5,
        .vz = 1,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &SLOPED_WALL, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expect(result.side_contacts > 0);
    // At head height the face is z=3.725, so contact rests at 3.725−radius.
    // The old triangle AABB used minZ=3 for all six metres and pushed to 2.66.
    try testing.expectApproxEqAbs(@as(f32, 3.385), body.z, 0.015);
    try testing.expect(body.z > 3.3);

    var clear = body;
    clear.z = 3.2;
    clear.vz = 0;
    const before = clear.z;
    const clear_result = mesh_collision.resolve(&clear, &SLOPED_WALL, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expectEqual(@as(usize, 0), clear_result.side_contacts);
    try testing.expectEqual(before, clear.z);
}

test "walkable mesh triangles support the player top" {
    const top = [_]f32{
        -1, 1, -1, 1, 1, -1, 1, 1, 1,
        -1, 1, -1, 1, 1, 1, -1, 1, 1,
    };
    var body: mesh_collision.Body = .{
        .x = 0,
        .y = 0.7,
        .z = 0,
        .vy = -1,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &top, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expect(result.grounded_on_mesh);
    try testing.expect(body.grounded);
    try testing.expectEqual(@as(f32, 1), body.y);
    try testing.expectEqual(@as(f32, 0), body.vy);
}

test "camera-only coarse boxes never push the player but still stop the spring arm" {
    var input: [physics.INPUT_HEADER_FLOATS + physics.RECT_FLOATS]f32 = @splat(0);
    input[0] = 0.05;
    input[2] = 1;
    input[3] = 2;
    input[7] = -0.45;
    input[13] = 1;
    input[16] = 0.34;
    input[17] = 1.65;
    input[20] = 0.5;
    input[21] = 4;
    const camera_only = [physics.RECT_FLOATS]f32{ -1, -0.1, 1, 0.1, 3, physics.CAMERA_ONLY_SOLID_FLAG, 0.85, 0, 0 };
    @memcpy(input[physics.INPUT_HEADER_FLOATS..], &camera_only);

    const out = physics.step(&input).?;
    try testing.expect(out[3] > -0.4); // crossed into the coarse box; exact triangles own contact
    try testing.expect(physics.cameraOcclusionStepColliders(&input, 1, 0, 0, 1, -2, 0, 1, 2, 0) > 0);
}
