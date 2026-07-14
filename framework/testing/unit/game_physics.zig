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
// (cart/hmsc-int/state/hostPhysics.ts) does.

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
    // oriented: rect floats + [pivotX,pivotZ,yawRadians]
    oriented: []const [physics.ORIENTED_FLOATS]f32 = &.{},

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
        buf[24] = @floatFromInt(self.oriented.len);
        var at: usize = H;
        for (self.entities) |e| {
            @memcpy(buf[at .. at + physics.ENTITY_FLOATS], &e);
            at += physics.ENTITY_FLOATS;
        }
        for (self.rects) |r| {
            @memcpy(buf[at .. at + physics.RECT_FLOATS], &r);
            at += physics.RECT_FLOATS;
        }
        for (self.oriented) |r| {
            @memcpy(buf[at .. at + physics.ORIENTED_FLOATS], &r);
            at += physics.ORIENTED_FLOATS;
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

test "ground collide: solid rect blocks a player fully below world zero" {
    physics.clearHeightfields();
    // Regression for req_2847: the player stands on a -2.5m seabed with their
    // head still below Y=0. The rock band spans the seabed and must block just
    // as it does above water; world zero has no collision semantics.
    const seabed = [physics.RECT_FLOATS]f32{ -50, -50, 50, 50, -2.5, 0, 0.5, 0, -1e9 };
    const rock = [physics.RECT_FLOATS]f32{ 1, -50, 2, 50, 9.21, 1, 0.5, 0, -2.6 };
    const out = physics.step((Sim{
        .dt = 0.05,
        .px = 0.7,
        .py = -2.5,
        .pvx = 4,
        .player_height = 1.65,
        .rects = &.{ seabed, rock },
    }).pack(&g_buf)).?;
    try testing.expect(out[1] <= 1 - 0.4 + 1e-4);
}

test "ground collide: oriented mesh prop blocks a player fully below world zero" {
    physics.clearHeightfields();
    const seabed = [physics.RECT_FLOATS]f32{ -50, -50, 50, 50, -2.5, 0, 0.5, 0, -1e9 };
    const rock = [physics.ORIENTED_FLOATS]f32{ 1, -50, 2, 50, 9.21, 1, 0.5, 0, -2.6, 0, 0, 0 };
    const out = physics.step((Sim{
        .dt = 0.05,
        .px = 0.7,
        .py = -2.5,
        .pvx = 4,
        .player_height = 1.65,
        .rects = &.{seabed},
        .oriented = &.{rock},
    }).pack(&g_buf)).?;
    try testing.expect(out[1] <= 1 - 0.4 + 1e-4);
}

test "ground collide: raised finite-band slabs are walk-under from below" {
    physics.clearHeightfields();
    const overhead = [physics.RECT_FLOATS]f32{ 1, -50, 2, 50, 3.2, 0, 0.5, 0, 3.0 };
    const clear = physics.step((Sim{ .dt = 0.05, .px = 0.7, .py = 0, .pvx = 4, .rects = &.{GROUND} }).pack(&g_buf)).?;
    const under = physics.step((Sim{ .dt = 0.05, .px = 0.7, .py = 0, .pvx = 4, .rects = &.{ GROUND, overhead } }).pack(&g_buf)).?;
    try testing.expectApproxEqAbs(clear[1], under[1], 1e-5);
    try testing.expect(under[1] > 0.7);
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

test "head bonk: jumping into a ceiling caps the head and keeps horizontal speed" {
    physics.clearHeightfields();
    const dt: f32 = 0.016;
    const player_height: f32 = 1.7;
    // A solid ceiling slab over the play area, underside at y=2.0. A grounded
    // 1.7m player jumping (apex 1.25) drives the head from 1.7 up into it.
    const ceiling = [physics.RECT_FLOATS]f32{ -5, -5, 5, 5, 2.4, 1, 0.5, 0, 2.0 };
    var sim = Sim{
        .dt = dt,
        .jump = true,
        .jump_speed = 5,
        .gravity = 10,
        .move_x = 1,
        .speed = 4,
        .player_height = player_height,
        .rects = &.{ GROUND, ceiling },
    };
    var out = physics.step(sim.pack(&g_buf)).?;
    sim.jump = false;
    var frames: usize = 0;
    var bonked = false;
    while (out[7] == 0 and frames < 500) : (frames += 1) {
        sim.px = out[1];
        sim.py = out[2];
        sim.pz = out[3];
        sim.pvx = out[4];
        sim.pvy = out[5];
        sim.pvz = out[6];
        out = physics.step(sim.pack(&g_buf)).?;
        // The head never punches through the ceiling underside.
        try testing.expect(out[2] + player_height <= 2.0 + 0.001);
        // At the bonk the upward velocity is removed (force is into the surface)
        // but horizontal momentum is kept — the player still accelerates along +x
        // toward speed, never side-shoved to a stop (the Source-style head-skim).
        if (out[2] + player_height >= 2.0 - 0.02 and out[5] <= 0) {
            bonked = true;
            try testing.expect(out[5] <= 0.0001); // rising velocity zeroed
            try testing.expect(out[4] > 1.0); // horizontal speed preserved through the bonk
        }
    }
    try testing.expect(bonked);
    try testing.expectEqual(@as(f32, 1), out[7]); // falls back and lands
}

test "head bonk: a low floor above the ground never drops the feet through it" {
    // The head-bonk seats the head under an overhead slab — but a landing floor at
    // the TOP of a staircase has its underside ABOVE your head while you climb, so
    // ceiling - height lands BELOW the surface you stand on. Naively seating the
    // head there pushed the feet through the steps (fly through the staircase,
    // stuck under the floor). The clamp is bounded by the ground support, so the
    // feet never sink below it. Jump in place on the heightfield (x fixed = stays
    // on the 3x3 grid) under a low slab and assert the feet hold the surface.
    registerSlope(0.6); // heightfield rising +x; at x=1 the surface is 0.2
    defer physics.clearHeightfields();
    const surface_y: f32 = 0.2;
    // Slab underside at 1.0: ceiling - height = -0.7, far below the 0.2 support —
    // exactly the case that used to yank the feet underground.
    const landing = [physics.RECT_FLOATS]f32{ -2, -2, 5, 5, 1.2, 1, 0.5, 0, 1.0 };
    var sim = Sim{
        .dt = 0.016,
        .jump = true,
        .jump_speed = 5,
        .gravity = 10,
        .px = 1.0,
        .py = surface_y,
        .pz = 1.0,
        .player_height = 1.7,
        .rects = &.{landing},
    };
    var out = physics.step(sim.pack(&g_buf)).?;
    sim.jump = false;
    var frames: usize = 0;
    while (frames < 120) : (frames += 1) {
        sim.py = out[2];
        sim.pvy = out[5];
        out = physics.step(sim.pack(&g_buf)).?;
        // Feet never sink below the surface they stand on (no fly-through).
        try testing.expect(out[2] >= surface_y - 0.05);
    }
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

test "one heightfield can be released without dropping its neighbors" {
    physics.clearHeightfields();
    defer physics.clearHeightfields();
    var low = [4]f32{ 1, 1, 1, 1 };
    var high = [4]f32{ 5, 5, 5, 5 };
    try testing.expect(physics.registerHeightfield(.{
        .id = 2,
        .origin_x = 0,
        .origin_z = 0,
        .cell = 1,
        .cols = 2,
        .rows = 2,
        .base_y = 0,
        .walk_cos = 0.5,
    }, std.mem.sliceAsBytes(low[0..])));
    try testing.expect(physics.registerHeightfield(.{
        .id = 3,
        .origin_x = 4,
        .origin_z = 0,
        .cell = 1,
        .cols = 2,
        .rows = 2,
        .base_y = 0,
        .walk_cos = 0.5,
    }, std.mem.sliceAsBytes(high[0..])));

    physics.unregisterHeightfield(2);
    try testing.expect(physics.heightfieldSurfaceAt(0.5, 0.5) == null);
    try testing.expectApproxEqAbs(@as(f32, 5), physics.heightfieldSurfaceAt(4.5, 0.5).?.height, 1e-5);
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

test "heightfield: walking downhill stays glued to the grade, never ballistic" {
    registerSlope(0.5);
    // At 60fps the per-frame slope drop (v·dt·grade) outruns the first-frame
    // gravity drop (g·dt²), so without the downhill snap the player goes
    // airborne and re-lands every few frames — the "falling on every step" bug.
    var sim = Sim{ .dt = 1.0 / 60.0, .px = 1.5, .pz = 1.0, .py = 0.3, .move_x = -1, .speed = 4 };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    while (frame < 20) : (frame += 1) {
        try testing.expectEqual(@as(f32, 1), out[7]); // grounded every frame
        try testing.expectApproxEqAbs(out[1] * 0.2, out[2], 1e-3); // riding h = 0.2x
        try testing.expectApproxEqAbs(@as(f32, 0), out[5], 1e-5); // no fall speed
        sim.px = out[1];
        sim.py = out[2];
        sim.pvx = out[4];
        sim.pvy = out[5];
        out = physics.step(sim.pack(&g_buf)).?;
    }
    try testing.expect(out[1] < 1.2); // actually advanced down-slope
    physics.clearHeightfields();
}

test "ground collide: walking off a ledge taller than a step still falls" {
    physics.clearHeightfields();
    // Platform top=1 for x<0, street at 0: the 1m drop exceeds step_height,
    // so the downhill snap must NOT glue the player across the edge.
    const platform = [physics.RECT_FLOATS]f32{ -50, -50, 0, 50, 1, 0, 0.5, 0, -1e9 };
    var sim = Sim{
        .dt = 1.0 / 60.0,
        .px = -0.05,
        .py = 1,
        .pz = 0,
        .move_x = 1,
        .speed = 4,
        .rects = &.{ platform, GROUND },
    };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    var went_airborne = false;
    while (frame < 30) : (frame += 1) {
        if (out[1] > 0.01 and out[7] == 0) went_airborne = true;
        sim.px = out[1];
        sim.py = out[2];
        sim.pvx = out[4];
        sim.pvy = out[5];
        out = physics.step(sim.pack(&g_buf)).?;
    }
    try testing.expect(went_airborne); // the ledge was a real fall
    try testing.expectApproxEqAbs(@as(f32, 0), out[2], 1e-4); // landed on the street
    try testing.expectEqual(@as(f32, 1), out[7]);
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
    while (frame < 27) : (frame += 1) {
        const selected = physics.heightfieldGroundSurfaceAt(sim.px, sim.pz, sim.py, sim.step_height).?;
        try testing.expect(selected.normal_y >= selected.walk_cos);
        const prev_px = sim.px;
        const prev_py = sim.py;
        const prev_pz = sim.pz;
        const stepped = physics.step(sim.pack(&g_buf)).?;
        const surface_speed = @sqrt(
            (stepped[1] - prev_px) * (stepped[1] - prev_px) +
                (stepped[2] - prev_py) * (stepped[2] - prev_py) +
                (stepped[3] - prev_pz) * (stepped[3] - prev_pz),
        ) / sim.dt;
        std.debug.print(
            "[RAMPASCENT-ZIG] frame={} selected(h={d:.3},ny={d:.3},cos={d:.3}) surfaceSpeed={d:.3} pos=({d:.3},{d:.3},{d:.3}) vel=({d:.3},{d:.3},{d:.3}) grounded={d:.0}\n",
            .{ frame, selected.height, selected.normal_y, selected.walk_cos, surface_speed, stepped[1], stepped[2], stepped[3], stepped[4], stepped[5], stepped[6], stepped[7] },
        );
        try testing.expectEqual(@as(f32, 1), stepped[7]);
        try testing.expect(surface_speed <= sim.speed + 0.01);
        sim.px = stepped[1];
        sim.py = stepped[2];
        sim.pz = stepped[3];
        sim.pvx = stepped[4];
        sim.pvy = stepped[5];
        sim.pvz = stepped[6];
    }
    try testing.expect(sim.pz >= 7.35);
    try testing.expectApproxEqAbs(@as(f32, 2.85), sim.py, 0.08);
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

// ── compiled door lifecycle (DOORS-0611, req_0663/req_0669) ──────────
// These pack the EXACT rect floats world_loader.zig writes for a door leaf
// (walk door at the origin: opening 1.2m wide, panel 2.2m tall, 0.26m deep,
// DOOR_PANEL_FRICTION/RESTITUTION) and walk a body at the doorway through
// the REAL physics step — the proof req_0669 demanded after "the test says
// the compiled game can go through an open door [and] its not true".

// the loader's closed walk-door rect (buildPhysicsColliders door section)
const DOOR_CLOSED = [physics.RECT_FLOATS]f32{ -0.6, -0.13, 0.6, 0.13, 2.2, 1, 0.85, 0.02, 0 };
// the loader's OPEN rect: toggleDoor PARKS the bounds 1e9 m away
const DOOR_PARKED = [physics.RECT_FLOATS]f32{ -0.6 + 1.0e9, -0.13 + 1.0e9, 0.6 + 1.0e9, 0.13 + 1.0e9, 2.2, 0, 0.85, 0.02, 0 };
// the first cut's WRONG open rect: bounds in place, only blocksPlayer
// de-flagged — the req_0663 bug this suite must never let return
const DOOR_DEFLAGGED = [physics.RECT_FLOATS]f32{ -0.6, -0.13, 0.6, 0.13, 2.2, 0, 0.85, 0.02, 0 };

fn walkAtDoor(door: [physics.RECT_FLOATS]f32) f32 {
    physics.clearHeightfields();
    var sim = Sim{ .dt = 0.05, .pz = -1.0, .pvz = 3, .walkable_side_push_grace = 0.08, .rects = &.{ GROUND, door } };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    while (frame < 40) : (frame += 1) {
        sim.px = out[1];
        sim.py = out[2];
        sim.pz = out[3];
        sim.pvz = 3;
        out = physics.step(sim.pack(&g_buf)).?;
    }
    return out[3]; // final z
}

test "compiled door: the CLOSED leaf blocks the body at the doorway" {
    const z = walkAtDoor(DOOR_CLOSED);
    try testing.expect(z <= -0.13 - 0.4 + 1e-3); // held at the panel face minus radius
}

test "compiled door: the OPEN (parked) leaf admits the body straight through" {
    const z = walkAtDoor(DOOR_PARKED);
    try testing.expect(z > 1.0); // walked clean through the doorway
}

test "compiled door: de-flagging alone is NOT open — the law that broke req_0663" {
    // A non-solid rect taller than step height still side-pushes (that is
    // what keeps bodies from clipping through walkable platforms' sides).
    // If this ever starts passing, collideSolidRects changed its law and
    // toggleDoor's parking can be revisited — until then, parking is the
    // only correct open state.
    const z = walkAtDoor(DOOR_DEFLAGGED);
    try testing.expect(z <= -0.13 - 0.4 + 1e-3);
}

// ── interact reach gate (req_0674) ───────────────────────────────────

// Eye at the standing chest line, target a fridge-height point 2m east.
const REACH_EYE = [3]f32{ 0, 1.4, 0 };
const REACH_TARGET = [3]f32{ 2, 0.9, 0 };

fn reachBlockedWithRects(rects: []const [physics.RECT_FLOATS]f32) bool {
    const sim = Sim{ .rects = rects };
    const buf = sim.pack(&g_buf);
    return physics.reachBlockedStepColliders(
        buf,
        rects.len,
        0,
        REACH_EYE[0],
        REACH_EYE[1],
        REACH_EYE[2],
        REACH_TARGET[0],
        REACH_TARGET[1],
        REACH_TARGET[2],
        0.5,
    );
}

test "reach gate: a thin solid wall between eye and prop blocks the E" {
    // 0.25m-thick wall slab crossing the segment at x≈1
    const wall = [physics.RECT_FLOATS]f32{ 1.0, -2, 1.25, 2, 3, 1, 0.5, 0, 0 };
    try testing.expect(reachBlockedWithRects(&.{wall}));
}

test "reach gate: an OPEN door (solid flag dropped) does not block" {
    const open_door = [physics.RECT_FLOATS]f32{ 1.0, -2, 1.25, 2, 3, 0, 0.5, 0, 0 };
    try testing.expect(!reachBlockedWithRects(&.{open_door}));
}

test "reach gate: the candidate's own chunky collider is not an obstruction" {
    // the fridge body: 0.8×0.8 plan (past the thinness cap) containing the target
    const fridge = [physics.RECT_FLOATS]f32{ 1.6, -0.4, 2.4, 0.4, 1.8, 1, 0.5, 0, 0 };
    try testing.expect(!reachBlockedWithRects(&.{fridge}));
}

test "reach gate: a wall behind the player does not block" {
    const behind = [physics.RECT_FLOATS]f32{ -1.25, -2, -1.0, 2, 3, 1, 0.5, 0, 0 };
    try testing.expect(!reachBlockedWithRects(&.{behind}));
}

test "reach gate: a thin box CONTAINING the target (the aimed door panel) is skipped" {
    // panel around the target point itself — aiming at a door must not self-block
    const panel = [physics.RECT_FLOATS]f32{ 1.9, -1.5, 2.1, 1.5, 3, 1, 0.5, 0, 0 };
    const eye_to_panel_center = physics.reachBlockedStepColliders(
        (Sim{ .rects = &.{panel} }).pack(&g_buf),
        1,
        0,
        REACH_EYE[0],
        REACH_EYE[1],
        REACH_EYE[2],
        2.0,
        1.5,
        0,
        0.5,
    );
    try testing.expect(!eye_to_panel_center);
}

test "reach gate: an explicitly identified swung door leaf cannot make its prompt one-sided" {
    // Closed-position prompt target is x=0. Once the panel swings toward +X it
    // crosses only the +X player's sightline; containment can no longer identify
    // it as the candidate. Explicit rect identity keeps both approaches valid.
    const swung_leaf = [physics.RECT_FLOATS]f32{ 0.55, -0.1, 0.75, 0.1, 2.2, 1, 0.5, 0, 0 };
    const buf = (Sim{ .rects = &.{swung_leaf} }).pack(&g_buf);
    try testing.expect(!physics.reachBlockedStepColliders(buf, 1, 0, -2, 1.4, 0, 0, 1.1, 0, 0.5));
    try testing.expect(physics.reachBlockedStepColliders(buf, 1, 0, 2, 1.4, 0, 0, 1.1, 0, 0.5));
    try testing.expect(!physics.reachBlockedStepCollidersExceptRect(buf, 1, 0, -2, 1.4, 0, 0, 1.1, 0, 0.5, 0));
    try testing.expect(!physics.reachBlockedStepCollidersExceptRect(buf, 1, 0, 2, 1.4, 0, 0, 1.1, 0, 0.5, 0));
}

test "reach gate: skipping the candidate leaf still respects another wall" {
    const wall = [physics.RECT_FLOATS]f32{ 0.9, -1, 1.1, 1, 3, 1, 0.5, 0, 0 };
    const leaf = [physics.RECT_FLOATS]f32{ 1.4, -0.1, 1.6, 0.1, 2.2, 1, 0.5, 0, 0 };
    const buf = (Sim{ .rects = &.{ wall, leaf } }).pack(&g_buf);
    try testing.expect(physics.reachBlockedStepCollidersExceptRect(buf, 2, 0, 0, 1.4, 0, 2, 1.1, 0, 0.5, 1));
}

// ── stair traversal (req_1453) ───────────────────────────────────────
// A 3x3x3 stairs build piece bakes (placed.ts) into a slope heightfield rising
// 0..3 along +z (walk_cos 0.6) plus three full-height boundary walls (2 sides +
// 1 far/high wall at the crest, floor=0 top=3). Climbing the 45° run, the
// player's circle (radius R) reaches the crest wall while its CENTER is R back,
// where the slope is R*grade lower than the crest — a radius-induced lip. At
// step_height 0.35 that lip (0.34 at 45°, up to 0.45 at the steepest walkable
// 53° ramp) sat right at the limit, so the climber got walled out at the top —
// worse as the frame dt grew (the per-frame advance overshoots the thin grace
// window). The fix raises playerStepHeightMeters so every walkable stair/ramp
// crest clears with margin at any framerate. This pins the crest behavior.
fn registerStairSlope() void {
    physics.clearHeightfields();
    // 6 rows along +z, each row flat across x; rises 0,0.6,1.2,1.8,2.4,3.0.
    var samples = [36]f32{
        0,   0,   0,   0,   0,   0,
        0.6, 0.6, 0.6, 0.6, 0.6, 0.6,
        1.2, 1.2, 1.2, 1.2, 1.2, 1.2,
        1.8, 1.8, 1.8, 1.8, 1.8, 1.8,
        2.4, 2.4, 2.4, 2.4, 2.4, 2.4,
        3.0, 3.0, 3.0, 3.0, 3.0, 3.0,
    };
    std.debug.assert(physics.registerHeightfield(.{
        .id = 0,
        .origin_x = 0,
        .origin_z = 0,
        .cell = 0.6,
        .cols = 6,
        .rows = 6,
        .base_y = 0,
        .walk_cos = 0.6,
    }, std.mem.sliceAsBytes(samples[0..])));
}

const STAIR_GROUND = [physics.RECT_FLOATS]f32{ -10, -10, 10, 10, 0, 0, 0.85, 0, -1e9 };
const STAIR_FAR_WALL = [physics.RECT_FLOATS]f32{ -0.25, 3.0, 3.25, 3.25, 3, 1, 0.85, 0, 0 };
const STAIR_SIDE_L = [physics.RECT_FLOATS]f32{ -0.25, 0.0, 0.0, 3.0, 3, 1, 0.85, 0, 0 };
const STAIR_SIDE_R = [physics.RECT_FLOATS]f32{ 3.0, 0.0, 3.25, 3.0, 3, 1, 0.85, 0, 0 };

// Highest py the player reaches running up the standalone staircase from the
// ground — 3.0 means the full crest, ~2.66 means walled out at the radius lip.
// Highest py the player reaches running up the standalone staircase from the
// ground with the user's REAL saved physics (gravity 13.5) at the worst-case
// frame the game allows (dt = maxDriveFrameSeconds 0.05). 3.0 = full crest;
// ~2.66 = walled out at the radius lip 0.34m below the top.
fn stairClimbPeak(step_h: f32) f32 {
    registerStairSlope();
    var sim = Sim{
        .dt = 0.05,
        .px = 1.5,
        .pz = -1.0,
        .py = 0,
        .move_z = 1,
        .speed = 5.8,
        .gravity = 13.5,
        .jump_speed = 5.65,
        .player_radius = 0.34,
        .player_height = 1.65,
        .step_height = step_h,
        .walkable_side_push_grace = 0.08,
        .rects = &.{ STAIR_GROUND, STAIR_FAR_WALL, STAIR_SIDE_L, STAIR_SIDE_R },
    };
    var out = physics.step(sim.pack(&g_buf)).?;
    var frame: usize = 0;
    var max_py: f32 = out[2];
    while (frame < 120) : (frame += 1) {
        max_py = @max(max_py, out[2]);
        sim.px = out[1];
        sim.py = out[2];
        sim.pz = out[3];
        sim.pvx = out[4];
        sim.pvy = out[5];
        sim.pvz = out[6];
        out = physics.step(sim.pack(&g_buf)).?;
    }
    physics.clearHeightfields();
    return max_py;
}

test "stair crest: the shipped step height clears a staircase top (req_1453/1470)" {
    // The shipped step height (HMSC_SCALE.playerStepHeightMeters, floored onto
    // legacy saves by reviveGameState) must clear the 45° stair crest even at
    // the worst frame. With the OLD 0.35 the climber was walled out 0.34m short
    // (the player-radius lip at the crest); 0.5 crests with margin.
    try testing.expect(stairClimbPeak(0.5) >= 2.97); // crests the 3.0 top
    try testing.expect(stairClimbPeak(0.35) < 2.8); // the bug: stuck at the lip
}

test "reach gate: an oriented thin wall between eye and prop blocks the E" {
    var buf: [physics.INPUT_HEADER_FLOATS + physics.ORIENTED_FLOATS]f32 = @splat(0);
    // yaw-0 oriented slab at world x∈[0.875,1.125], z∈[-2,2] (pivot 1,0)
    const o = [physics.ORIENTED_FLOATS]f32{ -0.125, -2, 0.125, 2, 3, 1, 0.5, 0, 0, 1.0, 0, 0 };
    @memcpy(buf[physics.INPUT_HEADER_FLOATS..], &o);
    try testing.expect(physics.reachBlockedStepColliders(
        &buf,
        0,
        1,
        REACH_EYE[0],
        REACH_EYE[1],
        REACH_EYE[2],
        REACH_TARGET[0],
        REACH_TARGET[1],
        REACH_TARGET[2],
        0.5,
    ));
}
