//! Behavior tests for framework/game/physics.zig + framework/game/movement.zig
//! (WO-1, P4). These assert BEHAVIOR — jump arcs, gravity, ground collision,
//! heightfield sampling, movement integration — not signatures. The sim moved
//! out of v8_bindings_physics_lab.zig; the old __hmsc_physics_step behavior is
//! the reference these tests pin down.
//!
//! Run: zig build test-game-physics

const std = @import("std");
const testing = std.testing;
const physics = @import("game_physics");
const movement = physics.movement;

// ── input-buffer builder ─────────────────────────────────────────────
// Packs the 25-float header + entities + rects the way cart JS
// (cart/hmsc/state/hostPhysics.ts) does.

const H = physics.INPUT_HEADER_FLOATS;

const Sim = struct {
    dt: f32 = 0.016,
    move_x: f32 = 0,
    move_z: f32 = 0,
    speed: f32 = 0,
    jump: bool = false,
    px: f32 = 0,
    py: f32 = 0,
    pz: f32 = 0,
    pvx: f32 = 0,
    pvy: f32 = 0,
    pvz: f32 = 0,
    gravity: f32 = 10,
    jump_speed: f32 = 5,
    player_radius: f32 = 0.4,
    player_height: f32 = 1.7,
    wall_restitution: f32 = 0,
    step_height: f32 = 0.4,
    walkable_side_push_grace: f32 = 0,
    acceleration_multiplier: f32 = 1,
    surface_friction: f32 = 0,
    surface_restitution: f32 = 0,
    // entity: [x,y,z,vx,vy,vz,r,restitution]
    entities: []const [physics.ENTITY_FLOATS]f32 = &.{},
    // rect: [minX,minZ,maxX,maxZ,top,solid,friction,restitution,floor]
    rects: []const [physics.RECT_FLOATS]f32 = &.{},

    fn pack(self: Sim, buf: []f32) []f32 {
        @memset(buf, 0);
        buf[0] = self.dt;
        buf[1] = self.move_x;
        buf[2] = self.move_z;
        buf[3] = self.speed;
        buf[4] = if (self.jump) 1 else 0;
        buf[5] = self.px;
        buf[6] = self.py;
        buf[7] = self.pz;
        buf[8] = self.pvx;
        buf[9] = self.pvy;
        buf[10] = self.pvz;
        buf[12] = @floatFromInt(self.entities.len);
        buf[13] = @floatFromInt(self.rects.len);
        buf[14] = self.gravity;
        buf[15] = self.jump_speed;
        buf[16] = self.player_radius;
        buf[17] = self.player_height;
        buf[18] = self.wall_restitution;
        buf[20] = self.step_height;
        buf[21] = self.acceleration_multiplier;
        buf[22] = self.surface_friction;
        buf[23] = self.surface_restitution;
        buf[11] = self.walkable_side_push_grace;
        buf[24] = 0; // oriented count
        var at: usize = H;
        for (self.entities) |e| {
            @memcpy(buf[at .. at + physics.ENTITY_FLOATS], &e);
            at += physics.ENTITY_FLOATS;
        }
        for (self.rects) |r| {
            @memcpy(buf[at .. at + physics.RECT_FLOATS], &r);
            at += physics.RECT_FLOATS;
        }
        return buf[0..at];
    }
};

// Wide flat ground at y=0 (non-solid: pure floor, no side push).
const GROUND = [physics.RECT_FLOATS]f32{ -50, -50, 50, 50, 0, 0, 0.5, 0, -1e9 };

var g_buf: [4096]f32 = undefined;
var g_occ_buf: [1024]f32 = undefined;

const OcclusionQuery = struct {
    camera: [3]f32,
    target: [3]f32,
    rects: []const [physics.CAMERA_OCCLUSION_RECT_FLOATS]f32 = &.{},
    oriented: []const [physics.CAMERA_OCCLUSION_ORIENTED_FLOATS]f32 = &.{},
    max_hits: f32 = 16,

    fn pack(self: OcclusionQuery, buf: []f32) []f32 {
        @memset(buf, 0);
        buf[0] = self.camera[0];
        buf[1] = self.camera[1];
        buf[2] = self.camera[2];
        buf[3] = self.target[0];
        buf[4] = self.target[1];
        buf[5] = self.target[2];
        buf[6] = @floatFromInt(self.rects.len);
        buf[7] = @floatFromInt(self.oriented.len);
        buf[8] = self.max_hits;
        var at: usize = physics.CAMERA_OCCLUSION_HEADER_FLOATS;
        for (self.rects) |r| {
            @memcpy(buf[at .. at + physics.CAMERA_OCCLUSION_RECT_FLOATS], &r);
            at += physics.CAMERA_OCCLUSION_RECT_FLOATS;
        }
        for (self.oriented) |r| {
            @memcpy(buf[at .. at + physics.CAMERA_OCCLUSION_ORIENTED_FLOATS], &r);
            at += physics.CAMERA_OCCLUSION_ORIENTED_FLOATS;
        }
        return buf[0..at];
    }
};

// ── gravity ──────────────────────────────────────────────────────────

test "gravity: airborne player accelerates downward and integrates position" {
    physics.clearHeightfields();
    const sim = Sim{ .dt = 0.05, .py = 5 };
    const out = physics.step(sim.pack(&g_buf)).?;
    // vy = -g*dt; y = y0 + vy*dt
    try testing.expectApproxEqAbs(@as(f32, -0.5), out[5], 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 5.0 - 0.5 * 0.05), out[2], 1e-5);
    try testing.expectEqual(@as(f32, 0), out[7]); // airborne
}

test "gravity: entity in free fall matches the player's gravity" {
    physics.clearHeightfields();
    const sim = Sim{
        .dt = 0.05,
        .py = 50,
        .entities = &.{.{ 0, 5, 0, 0, 0, 0, 0.2, 0.5 }},
    };
    const out = physics.step(sim.pack(&g_buf)).?;
    const ey = out[physics.OUTPUT_HEADER_FLOATS + 1];
    const evy = out[physics.OUTPUT_HEADER_FLOATS + 4];
    try testing.expectApproxEqAbs(@as(f32, -0.5), evy, 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 5.0 - 0.5 * 0.05), ey, 1e-5);
}

// ── ground collision ─────────────────────────────────────────────────

test "ground collide: falling player lands on a rect top, vy zeroed, grounded" {
    physics.clearHeightfields();
    const sim = Sim{ .dt = 0.05, .py = 0.05, .pvy = -1, .rects = &.{GROUND} };
    const out = physics.step(sim.pack(&g_buf)).?;
    try testing.expectEqual(@as(f32, 0), out[2]); // snapped to the top
    try testing.expectEqual(@as(f32, 0), out[5]); // vy zeroed
    try testing.expectEqual(@as(f32, 1), out[7]); // grounded
}

test "ground collide: no ground under the player means no landing" {
    physics.clearHeightfields();
    const sim = Sim{ .dt = 0.05, .py = 0.05, .pvy = -1 };
    const out = physics.step(sim.pack(&g_buf)).?;
    try testing.expect(out[2] < 0); // fell through — nothing to stand on
    try testing.expectEqual(@as(f32, 0), out[7]);
}

test "ground collide: solid wall blocks horizontal motion" {
    physics.clearHeightfields();
    // Wall ahead: x in [1, 2], 3m tall, solid to the ground.
    const wall = [physics.RECT_FLOATS]f32{ 1, -50, 2, 50, 3, 1, 0.5, 0, -1e9 };
    var sim = Sim{ .dt = 0.05, .px = 0.7, .py = 0, .pvx = 4, .rects = &.{ GROUND, wall } };
    var out = physics.step(sim.pack(&g_buf)).?;
    // Player radius 0.4: pushed back out so the circle doesn't overlap x=1.
    try testing.expect(out[1] <= 1 - 0.4 + 1e-4);
    // Run several frames pressing into the wall — never penetrates.
    var frame: usize = 0;
    while (frame < 30) : (frame += 1) {
        sim.px = out[1];
        sim.py = out[2];
        sim.pvx = 4;
        out = physics.step(sim.pack(&g_buf)).?;
        try testing.expect(out[1] <= 1 - 0.4 + 1e-4);
    }
}

test "ground collide: flush floor seam is continuous when side-push grace is tuned on" {
    physics.clearHeightfields();
    const floor_a = [physics.RECT_FLOATS]f32{ -1.5, -1.5, 1.5, 1.5, 0.2, 1, 0.85, 0.02, 0 };
    const floor_b = [physics.RECT_FLOATS]f32{ 1.5, -1.5, 4.5, 1.5, 0.2, 1, 0.85, 0.02, 0 };

    const before = physics.step((Sim{
        .dt = 0.016,
        .px = 1.5,
        .py = 0.05,
        .pz = 0,
        .pvy = -1,
        .rects = &.{ floor_a, floor_b },
    }).pack(&g_buf)).?;
    try testing.expectApproxEqAbs(@as(f32, 0.9), before[1], 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 0.2), before[2], 1e-5);
    try testing.expectEqual(@as(f32, 1), before[7]);

    const after = physics.step((Sim{
        .dt = 0.016,
        .px = 1.5,
        .py = 0.05,
        .pz = 0,
        .pvy = -1,
        .walkable_side_push_grace = 0.08,
        .rects = &.{ floor_a, floor_b },
    }).pack(&g_buf)).?;
    try testing.expectApproxEqAbs(@as(f32, 1.5), after[1], 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 0.2), after[2], 1e-5);
    try testing.expectEqual(@as(f32, 1), after[7]);
}

test "ground collide: true floor edge supports to the bound without oscillation" {
    physics.clearHeightfields();
    const floor = [physics.RECT_FLOATS]f32{ -1.5, -1.5, 1.5, 1.5, 0.2, 1, 0.85, 0.02, 0 };
    var sim = Sim{
        .dt = 0.016,
        .px = 1.5,
        .py = 0.05,
        .pz = 0,
        .pvy = -1,
        .walkable_side_push_grace = 0.08,
        .rects = &.{floor},
    };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    while (frame < 6) : (frame += 1) {
        try testing.expectApproxEqAbs(@as(f32, 1.5), out[1], 1e-5);
        try testing.expectApproxEqAbs(@as(f32, 0.2), out[2], 1e-5);
        try testing.expectEqual(@as(f32, 1), out[7]);
        sim.px = out[1];
        sim.py = out[2];
        sim.pz = out[3];
        sim.pvx = out[4];
        sim.pvy = out[5];
        sim.pvz = out[6];
        out = physics.step(sim.pack(&g_buf)).?;
    }
}

test "ground collide: rest on flat floor does not oscillate with side-push grace" {
    physics.clearHeightfields();
    const floor = [physics.RECT_FLOATS]f32{ -1.5, -1.5, 1.5, 1.5, 0.2, 1, 0.85, 0.02, 0 };
    var sim = Sim{
        .dt = 0.016,
        .px = 0,
        .py = 0.2,
        .pz = 0,
        .walkable_side_push_grace = 0.08,
        .rects = &.{floor},
    };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    while (frame < 12) : (frame += 1) {
        try testing.expectApproxEqAbs(@as(f32, 0), out[1], 1e-6);
        try testing.expectApproxEqAbs(@as(f32, 0.2), out[2], 1e-6);
        try testing.expectApproxEqAbs(@as(f32, 0), out[3], 1e-6);
        try testing.expectApproxEqAbs(@as(f32, 0), out[4], 1e-6);
        try testing.expectApproxEqAbs(@as(f32, 0), out[5], 1e-6);
        try testing.expectApproxEqAbs(@as(f32, 0), out[6], 1e-6);
        try testing.expectEqual(@as(f32, 1), out[7]);
        sim.px = out[1];
        sim.py = out[2];
        sim.pz = out[3];
        sim.pvx = out[4];
        sim.pvy = out[5];
        sim.pvz = out[6];
        out = physics.step(sim.pack(&g_buf)).?;
    }
}

// ── camera occlusion ─────────────────────────────────────────────────

test "camera occlusion: wall between camera and player reports its owner" {
    const wall = [physics.CAMERA_OCCLUSION_RECT_FLOATS]f32{ -2, -0.15, 2, 0.15, 3, 1, 0.85, 0.02, 0, 7 };
    const out = physics.cameraOcclusion((OcclusionQuery{
        .camera = .{ 0, 1.5, -5 },
        .target = .{ 0, 1.5, 5 },
        .rects = &.{wall},
    }).pack(&g_occ_buf)).?;
    try testing.expectEqual(@as(f32, 1), out[1]);
    try testing.expectApproxEqAbs(@as(f32, 5.15), out[2], 0.0001);
    try testing.expectEqual(@as(f32, 7), out[3]);
    try testing.expectEqual(@as(f32, 7), out[4]);
}

test "camera occlusion: configured scalar query reports no hit for an empty scene" {
    const distance = physics.cameraOcclusionConfiguredDistance(0, 1.5, -5, 0, 1.5, 5, 0).?;
    try testing.expectEqual(@as(f32, 0), distance);
}

test "camera occlusion: configured hit query reports nearest owner" {
    var config = [_]f32{ 1, 0, -2, -0.15, 2, 0.15, 3, 1, 0.85, 0.02, 0, 13 };
    try testing.expect(physics.configureCameraOcclusion(config[0..]));
    var hit: physics.CameraOcclusionConfiguredHit = .{};
    try testing.expect(physics.cameraOcclusionConfiguredHit(0, 1.5, -5, 0, 1.5, 5, 0, &hit));
    try testing.expectApproxEqAbs(@as(f32, 5.15), hit.nearest_target_distance, 0.0001);
    try testing.expectEqual(@as(f32, 13), hit.nearest_owner);
}

test "camera occlusion: wall beside the camera ray reports no hit" {
    const wall = [physics.CAMERA_OCCLUSION_RECT_FLOATS]f32{ 3, -0.15, 5, 0.15, 3, 1, 0.85, 0.02, 0, 7 };
    const out = physics.cameraOcclusion((OcclusionQuery{
        .camera = .{ 0, 1.5, -5 },
        .target = .{ 0, 1.5, 5 },
        .rects = &.{wall},
    }).pack(&g_occ_buf)).?;
    try testing.expectEqual(@as(f32, 0), out[1]);
    try testing.expectEqual(@as(f32, 0), out[2]);
}

test "camera occlusion: split bands from one piece dedupe to one owner hit" {
    const near_band = [physics.CAMERA_OCCLUSION_RECT_FLOATS]f32{ -2, -2.1, 2, -1.9, 3, 1, 0.85, 0.02, 0, 9 };
    const far_band = [physics.CAMERA_OCCLUSION_RECT_FLOATS]f32{ -2, 1.9, 2, 2.1, 3, 1, 0.85, 0.02, 0, 9 };
    const out = physics.cameraOcclusion((OcclusionQuery{
        .camera = .{ 0, 1.5, -5 },
        .target = .{ 0, 1.5, 5 },
        .rects = &.{ near_band, far_band },
    }).pack(&g_occ_buf)).?;
    try testing.expectEqual(@as(f32, 1), out[1]);
    try testing.expectApproxEqAbs(@as(f32, 7.1), out[2], 0.0001);
    try testing.expectEqual(@as(f32, 9), out[3]);
    try testing.expectEqual(@as(f32, 9), out[4]);
}

test "camera occlusion: rotated wall reports through the oriented frame" {
    const wall = [physics.CAMERA_OCCLUSION_ORIENTED_FLOATS]f32{ -0.25, -4, 0.25, 4, 3, 1, 0.85, 0.02, 0, 0, 0, std.math.pi / 4.0, 11 };
    const out = physics.cameraOcclusion((OcclusionQuery{
        .camera = .{ -3, 1.5, -3 },
        .target = .{ 3, 1.5, 3 },
        .oriented = &.{wall},
    }).pack(&g_occ_buf)).?;
    try testing.expectEqual(@as(f32, 1), out[1]);
    try testing.expect(out[2] > 0);
    try testing.expectEqual(@as(f32, 11), out[3]);
    try testing.expectEqual(@as(f32, 11), out[4]);
}

test "ground collide: entity bounces with rect surface restitution" {
    physics.clearHeightfields();
    // Bouncy ground (restitution 1.0), entity restitution 0.9.
    const bouncy = [physics.RECT_FLOATS]f32{ -50, -50, 50, 50, 0, 0, 0, 1.0, -1e9 };
    // dt small enough that the entity doesn't sink past the step-height
    // ground gate in a single frame (fast tunneling skips ground detection —
    // reference behavior).
    const sim = Sim{
        .dt = 0.016,
        .py = 50,
        .entities = &.{.{ 0, 0.21, 0, 0, -3, 0, 0.2, 0.9 }},
        .rects = &.{bouncy},
    };
    const out = physics.step(sim.pack(&g_buf)).?;
    const ey = out[physics.OUTPUT_HEADER_FLOATS + 1];
    const evy = out[physics.OUTPUT_HEADER_FLOATS + 4];
    try testing.expectApproxEqAbs(@as(f32, 0.2), ey, 1e-5); // resting radius above the top
    // impact vy = -(3 + g*dt) reflected by entity 0.9 × surface 1.0
    try testing.expectApproxEqAbs(@as(f32, (3.0 + 10.0 * 0.016) * 0.9), evy, 1e-4);
}

// ── jump arc ─────────────────────────────────────────────────────────

test "jump arc: rises near v^2/2g then returns to the ground grounded" {
    physics.clearHeightfields();
    const dt: f32 = 0.016;
    const jump_speed: f32 = 5;
    const gravity: f32 = 10;
    var sim = Sim{ .dt = dt, .jump = true, .jump_speed = jump_speed, .gravity = gravity, .rects = &.{GROUND} };
    var out = physics.step(sim.pack(&g_buf)).?;
    try testing.expect(out[2] > 0); // left the ground
    try testing.expectEqual(@as(f32, 0), out[7]);
    var apex: f32 = out[2];
    var frames: usize = 0;
    sim.jump = false;
    while (out[7] == 0 and frames < 500) : (frames += 1) {
        sim.py = out[2];
        sim.pvy = out[5];
        out = physics.step(sim.pack(&g_buf)).?;
        apex = @max(apex, out[2]);
    }
    try testing.expectEqual(@as(f32, 1), out[7]); // landed
    try testing.expectEqual(@as(f32, 0), out[2]); // back on the rect top
    // Ideal apex = v^2/2g = 1.25; discretization keeps it within one step.
    const ideal = jump_speed * jump_speed / (2 * gravity);
    try testing.expect(apex > ideal - jump_speed * dt * 2);
    try testing.expect(apex < ideal + jump_speed * dt * 2);
}

test "jump arc: jump only fires from the ground" {
    physics.clearHeightfields();
    const sim = Sim{ .dt = 0.05, .py = 3, .jump = true, .rects = &.{GROUND} };
    const out = physics.step(sim.pack(&g_buf)).?;
    try testing.expect(out[5] < 0); // airborne jump press: gravity only, no boost
}

// ── heightfield ──────────────────────────────────────────────────────

// A 3×3 grid sloping up +x at 0.2/m: column heights 0, 0.2, 0.4.
fn registerSlope(walk_cos: f32) void {
    physics.clearHeightfields();
    var samples = [9]f32{ 0, 0.2, 0.4, 0, 0.2, 0.4, 0, 0.2, 0.4 };
    const ok = physics.registerHeightfield(.{
        .id = 0,
        .origin_x = 0,
        .origin_z = 0,
        .cell = 1,
        .cols = 3,
        .rows = 3,
        .base_y = 0,
        .walk_cos = walk_cos,
    }, std.mem.sliceAsBytes(samples[0..]));
    std.debug.assert(ok);
}

test "heightfield sample: bilinear interior height" {
    registerSlope(0.5);
    const s = physics.heightfieldSurfaceAt(1.5, 1.0).?;
    try testing.expectApproxEqAbs(@as(f32, 0.3), s.height, 1e-5);
    // Central difference at x=1.5 with e=cell clamps at the grid edge
    // (x+e falls outside → falls back to the centre sample), so the measured
    // dh/dx is 0.1 here, not the analytic 0.2 — reference behavior.
    try testing.expectApproxEqAbs(@as(f32, 1.0 / @sqrt(1.01)), s.normal_y, 1e-4);
    physics.clearHeightfields();
    try testing.expect(physics.heightfieldSurfaceAt(1.5, 1.0) == null);
}

test "heightfield sample: rotated vertical link rises along the turned local depth" {
    physics.clearHeightfields();
    var samples = [18]f32{
        0,   0,   0,
        0.6, 0.6, 0.6,
        1.2, 1.2, 1.2,
        1.8, 1.8, 1.8,
        2.4, 2.4, 2.4,
        3.0, 3.0, 3.0,
    };
    try testing.expect(physics.registerHeightfield(.{
        .id = 0,
        .origin_x = 5.4,
        .origin_z = 4.5,
        .cell = 0.6,
        .cols = 3,
        .rows = 6,
        .base_y = 0,
        .walk_cos = 0.5,
        .yaw = std.math.pi / 2.0,
        .pivot_x = 6,
        .pivot_z = 6,
    }, std.mem.sliceAsBytes(samples[0..])));
    const low = physics.heightfieldSurfaceAt(4.8, 6).?;
    const high = physics.heightfieldSurfaceAt(7.2, 6).?;
    try testing.expectApproxEqAbs(@as(f32, 0.3), low.height, 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 2.7), high.height, 1e-5);
    try testing.expect(high.height > low.height);
    physics.clearHeightfields();
}

test "heightfield: falling player lands on the sampled surface" {
    registerSlope(0.5); // walkable
    const sim = Sim{ .dt = 0.05, .px = 1.5, .pz = 1.0, .py = 0.32, .pvy = -1 };
    const out = physics.step(sim.pack(&g_buf)).?;
    try testing.expectApproxEqAbs(@as(f32, 0.3), out[2], 1e-5);
    try testing.expectEqual(@as(f32, 1), out[7]);
    physics.clearHeightfields();
}

test "heightfield: ramp above terrain does not replace the ground underneath" {
    physics.clearHeightfields();
    var ground_samples = [4]f32{ 0, 0, 0, 0 };
    var ramp_samples = [4]f32{ 0, 0, 3, 3 };
    try testing.expect(physics.registerHeightfield(.{
        .id = 0,
        .origin_x = 0,
        .origin_z = 0,
        .cell = 3,
        .cols = 2,
        .rows = 2,
        .base_y = 0,
        .walk_cos = 0.5,
    }, std.mem.sliceAsBytes(ground_samples[0..])));
    try testing.expect(physics.registerHeightfield(.{
        .id = 1,
        .origin_x = 0,
        .origin_z = 0,
        .cell = 3,
        .cols = 2,
        .rows = 2,
        .base_y = 0,
        .walk_cos = 0.6,
    }, std.mem.sliceAsBytes(ramp_samples[0..])));

    const highest = physics.heightfieldSurfaceAt(1.5, 2.4).?;
    try testing.expect(highest.height > 2.3);

    var sim = Sim{ .dt = 0.05, .px = 1.5, .pz = 2.4, .py = 0, .pvy = 0 };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    while (frame < 8) : (frame += 1) {
        try testing.expectApproxEqAbs(@as(f32, 0), out[2], 1e-5);
        try testing.expectEqual(@as(f32, 1), out[7]);
        sim.px = out[1];
        sim.py = out[2];
        sim.pz = out[3];
        sim.pvx = out[4];
        sim.pvy = out[5];
        sim.pvz = out[6];
        out = physics.step(sim.pack(&g_buf)).?;
    }
    physics.clearHeightfields();
}

test "heightfield: walkable grade climbs under movement" {
    registerSlope(0.5);
    var sim = Sim{ .dt = 0.05, .px = 0.5, .pz = 1.0, .py = 0.1, .move_x = 1, .speed = 2 };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    while (frame < 10) : (frame += 1) {
        sim.px = out[1];
        sim.py = out[2];
        sim.pvx = out[4];
        sim.pvy = out[5];
        out = physics.step(sim.pack(&g_buf)).?;
    }
    try testing.expect(out[1] > 0.6); // advanced up-slope
    try testing.expectApproxEqAbs(out[1] * 0.2, out[2], 1e-3); // riding h = 0.2x
    physics.clearHeightfields();
}

test "heightfield: hollow ramp slab ascent reaches the crest with zero side grace" {
    physics.clearHeightfields();
    var ramp_samples: [36]f32 = undefined;
    var row: usize = 0;
    while (row < 6) : (row += 1) {
        const h: f32 = @as(f32, @floatFromInt(row)) * 0.6;
        var col: usize = 0;
        while (col < 6) : (col += 1) ramp_samples[row * 6 + col] = h;
    }
    try testing.expect(physics.registerHeightfield(.{
        .id = 0,
        .origin_x = 4.5,
        .origin_z = 4.5,
        .cell = 0.6,
        .cols = 6,
        .rows = 6,
        .base_y = 0,
        .walk_cos = 0.6,
        .yaw = 0,
        .pivot_x = 6,
        .pivot_z = 6,
    }, std.mem.sliceAsBytes(ramp_samples[0..])));

    const segments = 16;
    var rects: [segments * 3 + 1][physics.RECT_FLOATS]f32 = undefined;
    var out_i: usize = 0;
    var i: usize = 0;
    while (i < segments) : (i += 1) {
        const z0 = 4.5 + (@as(f32, @floatFromInt(i)) / segments) * 3.0;
        const z1 = 4.5 + (@as(f32, @floatFromInt(i + 1)) / segments) * 3.0;
        const top = (@as(f32, @floatFromInt(i)) / segments) * 3.0;
        const floor = top - 0.2;
        rects[out_i] = .{ 4.5, z0, 7.5, z1, top, 1, 0.85, 0.02, floor };
        out_i += 1;
        rects[out_i] = .{ 4.38, z0, 4.5, z1, top, 1, 0.85, 0.02, floor };
        out_i += 1;
        rects[out_i] = .{ 7.5, z0, 7.62, z1, top, 1, 0.85, 0.02, floor };
        out_i += 1;
    }
    rects[out_i] = .{ 4.38, 7.5, 7.62, 7.62, 3.0, 1, 0.85, 0.02, 2.8 };

    var sim = Sim{
        .dt = 0.05,
        .move_z = 1,
        .speed = 3,
        .px = 6,
        .py = 0,
        .pz = 4.5,
        .rects = rects[0..],
        .walkable_side_push_grace = 0,
    };
    var frame: usize = 0;
    while (frame < 20) : (frame += 1) {
        const selected = physics.heightfieldGroundSurfaceAt(sim.px, sim.pz, sim.py, sim.step_height).?;
        try testing.expect(selected.normal_y >= selected.walk_cos);
        const stepped = physics.step(sim.pack(&g_buf)).?;
        std.debug.print(
            "[RAMPASCENT-ZIG] frame={} selected(h={d:.3},ny={d:.3},cos={d:.3}) pos=({d:.3},{d:.3},{d:.3}) vel=({d:.3},{d:.3},{d:.3}) grounded={d:.0}\n",
            .{ frame, selected.height, selected.normal_y, selected.walk_cos, stepped[1], stepped[2], stepped[3], stepped[4], stepped[5], stepped[6], stepped[7] },
        );
        try testing.expectEqual(@as(f32, 1), stepped[7]);
        sim.px = stepped[1];
        sim.py = stepped[2];
        sim.pz = stepped[3];
        sim.pvx = stepped[4];
        sim.pvy = stepped[5];
        sim.pvz = stepped[6];
    }
    try testing.expect(sim.pz >= 7.45);
    try testing.expectApproxEqAbs(@as(f32, 3), sim.py, 0.05);
    physics.clearHeightfields();
}

test "heightfield: too-steep surface is a wall — the move is cancelled" {
    registerSlope(0.999); // only near-flat counts as walkable; 0.2/m slope is too steep
    const sim = Sim{ .dt = 0.05, .px = 0.5, .pz = 1.0, .py = 0.1, .move_x = 1, .speed = 3 };
    const out = physics.step(sim.pack(&g_buf)).?;
    try testing.expectApproxEqAbs(@as(f32, 0.5), out[1], 1e-5); // held at prev x
    try testing.expectEqual(@as(f32, 0), out[4]); // vx cancelled
    physics.clearHeightfields();
}

// ── movement (V7: the one host-side integrator) ──────────────────────

test "movement: velocity blends toward the move target inside the step" {
    physics.clearHeightfields();
    const sim = Sim{ .dt = 0.05, .move_x = 1, .speed = 4, .rects = &.{GROUND} };
    const out = physics.step(sim.pack(&g_buf)).?;
    // blend = clamp(dt*18*accel, 0, 1) = 0.9 → vx = 0.9 * 4
    try testing.expectApproxEqAbs(@as(f32, 3.6), out[4], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, 3.6 * 0.05), out[1], 1e-4);
}

test "movement: integrateHorizontal accelerates, normalizes diagonals, and drags to rest" {
    var vx: f32 = 0;
    var vz: f32 = 0;
    movement.integrateHorizontal(&vx, &vz, 1, 1, 4, 1, 0, 0.05);
    // Diagonal normalized: target = 4/sqrt(2) each axis, blended 0.9.
    try testing.expectApproxEqAbs(@as(f32, 0.9 * 4.0 / @sqrt(2.0)), vx, 1e-4);
    try testing.expectApproxEqAbs(vx, vz, 1e-6);
    // No input, frictionless surface: drag = 1 - dt*6.
    movement.integrateHorizontal(&vx, &vz, 0, 0, 4, 1, 0, 0.05);
    try testing.expectApproxEqAbs(@as(f32, 0.9 * 4.0 / @sqrt(2.0) * 0.7), vx, 1e-4);
    // High friction stops dead: drag = max(0, 1 - 0.05*22) = 0.
    movement.integrateHorizontal(&vx, &vz, 0, 0, 4, 1, 1, 0.05);
    try testing.expectEqual(@as(f32, 0), vx);
    try testing.expectEqual(@as(f32, 0), vz);
}

test "movement: wasdDirection is camera-relative with normalized diagonals" {
    // yaw 0: W walks +z, D walks -x (world +X renders screen-left).
    const w = movement.wasdDirection(1, 0, 0);
    try testing.expectApproxEqAbs(@as(f32, 0), w.x, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 1), w.z, 1e-6);
    const d = movement.wasdDirection(0, 1, 0);
    try testing.expectApproxEqAbs(@as(f32, -1), d.x, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), d.z, 1e-6);
    // Quarter turn: W now walks +x.
    const w90 = movement.wasdDirection(1, 0, std.math.pi / 2.0);
    try testing.expectApproxEqAbs(@as(f32, 1), w90.x, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), w90.z, 1e-6);
    // Diagonal magnitude stays 1.
    const diag = movement.wasdDirection(1, 1, 0.7);
    try testing.expectApproxEqAbs(@as(f32, 1), @sqrt(diag.x * diag.x + diag.z * diag.z), 1e-5);
}

// ── buffer contract ──────────────────────────────────────────────────

test "step rejects malformed buffers instead of reading out of bounds" {
    var tiny = [_]f32{0} ** 10;
    try testing.expect(physics.step(tiny[0..]) == null);
    // Header claims 2 rects but ships none.
    var lying = [_]f32{0} ** H;
    lying[0] = 0.016;
    lying[13] = 2;
    try testing.expect(physics.step(lying[0..]) == null);
}
