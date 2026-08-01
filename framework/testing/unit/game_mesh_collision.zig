//! Exact exported-mesh collision behavior at the owning Zig layer.
//! Run: tools/zig/zig build test-game-mesh-collision

const std = @import("std");
const testing = std.testing;
const physics = @import("game_physics");
const mesh_collision = physics.mesh_collision;

// The inner positive-Z arch face from the user's saved `tunnel_test` model.
// Its low edge sits almost a metre farther out than its high edge, which is the
// exact shape that exposed the empty-corner wall left by triangle AABBs.
const SLOPED_WALL = [_]f32{
    -1, 0.47083342, 3.94197893, 1, 0.47083342, 3.94604278, 1,  6.80833340, 2.80854273,
    -1, 0.47083342, 3.94197893, 1, 6.80833340, 2.80854273, -1, 6.80833340, 2.72322845,
};

test "sloped wall stops at the face, not its empty AABB corner" {
    var body: mesh_collision.Body = .{
        .x = 0,
        .y = 0.47083342,
        .z = 3.5,
        .vz = 1,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &SLOPED_WALL, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expect(result.side_contacts > 0);
    // At head height the saved face is z≈3.65, so contact rests near 3.31.
    // Its old AABB used minZ≈2.72 for the entire rise and pushed to ≈2.38.
    try testing.expectApproxEqAbs(@as(f32, 3.308), body.z, 0.02);
    try testing.expect(body.z > 3.25);

    var clear = body;
    clear.z = 3.2;
    clear.vz = 0;
    const before = clear.z;
    const clear_result = mesh_collision.resolve(&clear, &SLOPED_WALL, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expectEqual(@as(usize, 0), clear_result.side_contacts);
    try testing.expectEqual(before, clear.z);
}

test "sloped wall contact follows a placed mesh yaw" {
    var body: mesh_collision.Body = .{
        .x = 13.5,
        .y = 0.47083342,
        .z = 20,
        .vx = 1,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &SLOPED_WALL, .{
        .x = 10,
        .z = 20,
        .yaw_radians = @as(f32, std.math.pi) / 2.0,
    }, mesh_collision.DEFAULT_TUNING);
    try testing.expect(result.side_contacts > 0);
    try testing.expectApproxEqAbs(@as(f32, 13.308), body.x, 0.02);
    try testing.expectApproxEqAbs(@as(f32, 20), body.z, 0.001);
}

test "walkable mesh triangles support the player top" {
    const top = [_]f32{
        -1, 1, -1, 1, 1, -1, 1,  1, 1,
        -1, 1, -1, 1, 1, 1,  -1, 1, 1,
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

// Three steps rising along +x — rise 0.25, tread 0.4, width 2 — then a top
// platform. Risers are vertical quads, treads horizontal quads: the exact
// shape of a placed stairs prop's collision triangles.
const STAIRCASE = [_]f32{
    // riser 1 at x=0: y 0..0.25
    0,   0,    -1, 0,   0,    1,  0,   0.25, 1,
    0,   0,    -1, 0,   0.25, 1,  0,   0.25, -1,
    // tread 1: x 0..0.4 at y=0.25
    0,   0.25, -1, 0.4, 0.25, -1, 0.4, 0.25, 1,
    0,   0.25, -1, 0.4, 0.25, 1,  0,   0.25, 1,
    // riser 2 at x=0.4: y 0.25..0.5
    0.4, 0.25, -1, 0.4, 0.25, 1,  0.4, 0.5,  1,
    0.4, 0.25, -1, 0.4, 0.5,  1,  0.4, 0.5,  -1,
    // tread 2: x 0.4..0.8 at y=0.5
    0.4, 0.5,  -1, 0.8, 0.5,  -1, 0.8, 0.5,  1,
    0.4, 0.5,  -1, 0.8, 0.5,  1,  0.4, 0.5,  1,
    // riser 3 at x=0.8: y 0.5..0.75
    0.8, 0.5,  -1, 0.8, 0.5,  1,  0.8, 0.75, 1,
    0.8, 0.5,  -1, 0.8, 0.75, 1,  0.8, 0.75, -1,
    // top platform: x 0.8..2 at y=0.75
    0.8, 0.75, -1, 2,   0.75, -1, 2,   0.75, 1,
    0.8, 0.75, -1, 2,   0.75, 1,  0.8, 0.75, 1,
};

test "placed staircase risers within step reach mount instead of walling" {
    // Before the riser step-reach gate, riser 1 alone side-pushed the body off
    // the first tread forever and step height was never consulted on approach.
    var body: mesh_collision.Body = .{
        .x = -0.6,
        .y = 0,
        .z = 0,
        .vx = 1.5,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const dt: f32 = 1.0 / 60.0;
    var frame: usize = 0;
    while (frame < 180) : (frame += 1) {
        body.x += body.vx * dt;
        _ = mesh_collision.resolve(&body, &STAIRCASE, .{}, mesh_collision.DEFAULT_TUNING);
        body.vx = 1.5; // walk intent is re-driven each frame by the movement integrator
    }
    try testing.expectApproxEqAbs(@as(f32, 0.75), body.y, 0.001);
    try testing.expect(body.x > 0.8);
}

test "descending the staircase glues tread to tread instead of going ballistic" {
    // Walk from the top platform back down -x. A body that stood on the mesh
    // last frame (grounded=true) reaches a full step DOWN, so each tread seats
    // the feet immediately — no airborne frames, no falling animation. Before
    // the downhill snap, the mount only reached the 0.08 m snap band and every
    // 0.25 m step read as a fall.
    var body: mesh_collision.Body = .{
        .x = 1.2,
        .y = 0.75,
        .z = 0,
        .vx = -1.5,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
        .grounded = true,
    };
    const dt: f32 = 1.0 / 60.0;
    var frame: usize = 0;
    while (frame < 180) : (frame += 1) {
        body.x += body.vx * dt;
        const result = mesh_collision.resolve(&body, &STAIRCASE, .{}, mesh_collision.DEFAULT_TUNING);
        // Feet stay seated on a tread the whole way down while over the mesh.
        if (body.x >= 0.05 and body.x <= 1.2) {
            try testing.expect(result.grounded_on_mesh);
        }
        body.vx = -1.5;
    }
    try testing.expectApproxEqAbs(@as(f32, 0.25), body.y, 0.001);
    try testing.expect(body.x < 0);
}

test "a face taller than step reach still walls a walking body" {
    // One 2 m vertical face at x=0.5: no tread within step reach, so the riser
    // gate must not apply — the body walks into it and is held at radius.
    const wall = [_]f32{
        0.5, 0, -1, 0.5, 0, 1, 0.5, 2, 1,
        0.5, 0, -1, 0.5, 2, 1, 0.5, 2, -1,
    };
    var body: mesh_collision.Body = .{
        .x = 0.2,
        .y = 0,
        .z = 0,
        .vx = 1,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &wall, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expect(result.side_contacts > 0);
    try testing.expectApproxEqAbs(@as(f32, 0.16), body.x, 0.001);
    try testing.expectEqual(@as(f32, 0), body.y);
}

test "a tabletop rim crossed mid-jump does not teleport the body down" {
    // Jumping BESIDE a table drifts the centre over the slab rim while rising.
    // The tabletop is then a horizontal face mid-span — seating the head under
    // it teleported the feet ~0.9 m down, below what ground support reaches:
    // the player shot under the map. A ceiling seat may only correct a genuine
    // head bonk (overlap within a step); anything deeper rides past and the
    // fall mounts on top of the table instead.
    const tabletop = [_]f32{
        0, 0.75, -0.5, 1, 0.75, -0.5, 1, 0.75, 0.5,
        0, 0.75, -0.5, 1, 0.75, 0.5,  0, 0.75, 0.5,
    };
    var body: mesh_collision.Body = .{
        .x = 0.1,
        .y = 0.3,
        .z = 0,
        .vy = 4,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &tabletop, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expect(!result.hit_ceiling);
    try testing.expectEqual(@as(f32, 0.3), body.y);
    try testing.expectEqual(@as(f32, 4), body.vy);
}

test "horizontal mesh triangles stop an upward head" {
    const ceiling = [_]f32{
        -1, 2, -1, 1, 2, -1, 1,  2, 1,
        -1, 2, -1, 1, 2, 1,  -1, 2, 1,
    };
    var body: mesh_collision.Body = .{
        .x = 0,
        .y = 0.5,
        .z = 0,
        .vy = 1,
        .radius = 0.34,
        .height = 1.65,
        .step_height = 0.5,
    };
    const result = mesh_collision.resolve(&body, &ceiling, .{}, mesh_collision.DEFAULT_TUNING);
    try testing.expect(result.hit_ceiling);
    try testing.expectApproxEqAbs(@as(f32, 0.35), body.y, 0.001);
    try testing.expectEqual(@as(f32, 0), body.vy);
}

test "exact-mesh coarse boxes skip the player but still serve camera and dynamic bodies" {
    var input: [physics.INPUT_HEADER_FLOATS + physics.ORIENTED_FLOATS]f32 = @splat(0);
    input[0] = 0.05;
    input[2] = 1;
    input[3] = 2;
    input[7] = -0.45;
    input[16] = 0.34;
    input[17] = 1.65;
    input[20] = 0.5;
    input[21] = 4;
    input[24] = 1;
    const exact_mesh_coarse = [physics.ORIENTED_FLOATS]f32{ -1, -0.1, 1, 0.1, 3, physics.EXACT_MESH_COARSE_SOLID_FLAG, 0.85, 0, 0, 0, 0, 0 };
    @memcpy(input[physics.INPUT_HEADER_FLOATS..], &exact_mesh_coarse);

    const out = physics.step(&input).?;
    try testing.expect(out[3] > -0.4); // crossed into the coarse box; exact triangles own contact
    try testing.expect(physics.cameraOcclusionStepColliders(&input, 0, 1, 0, 1, -2, 0, 1, 2, 0) > 0);

    var body_input: [physics.INPUT_HEADER_FLOATS + physics.ENTITY_FLOATS + physics.ORIENTED_FLOATS]f32 = @splat(0);
    body_input[0] = 0.05;
    body_input[12] = 1;
    body_input[16] = 0.34;
    body_input[17] = 1.65;
    body_input[20] = 0.5;
    body_input[24] = 1;
    const entity_at = physics.INPUT_HEADER_FLOATS;
    body_input[entity_at + 1] = 1;
    body_input[entity_at + 2] = -0.31;
    body_input[entity_at + 5] = 2;
    body_input[entity_at + 6] = 0.2;
    @memcpy(body_input[entity_at + physics.ENTITY_FLOATS ..], &exact_mesh_coarse);
    const body_out = physics.step(&body_input).?;
    try testing.expect(body_out[physics.OUTPUT_HEADER_FLOATS + 2] <= -0.29);
}
