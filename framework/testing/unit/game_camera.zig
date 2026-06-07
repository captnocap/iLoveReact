//! Behavior tests for framework/game/camera.zig (V23).
//!
//! Pins native Orbit/Aim solves against vectors generated from
//! runtime/cameras/{_util,rigs/aim,rigs/orbit}.ts using tools/v8cli, then
//! checks retained host-controller smoothing and walk<->aim transitions.
//!
//! Run: zig build test-game-camera

const std = @import("std");
const testing = std.testing;
const camera = @import("game_camera");

fn expectClose(actual: f32, expected: f32) !void {
    try testing.expectApproxEqAbs(expected, actual, 0.0001);
}

fn expectVec(actual: camera.Vec3, expected: camera.Vec3) !void {
    try expectClose(actual.x, expected.x);
    try expectClose(actual.y, expected.y);
    try expectClose(actual.z, expected.z);
}

fn expectSolved(actual: camera.Solved, pos: camera.Vec3, target: camera.Vec3, fov: f32) !void {
    try expectVec(actual.pos, pos);
    try expectVec(actual.target, target);
    try expectClose(actual.fov, fov);
}

const FakeCameraNode = struct {
    scene3d_camera: bool = false,
    scene3d_pos_x: f32 = 0,
    scene3d_pos_y: f32 = 0,
    scene3d_pos_z: f32 = 0,
    scene3d_look_x: f32 = 0,
    scene3d_look_y: f32 = 0,
    scene3d_look_z: f32 = 0,
    scene3d_fov: f32 = 0,
};

fn expectNodeCamera(node: FakeCameraNode, solved: camera.Solved) !void {
    try testing.expect(node.scene3d_camera);
    try expectClose(node.scene3d_pos_x, solved.pos.x);
    try expectClose(node.scene3d_pos_y, solved.pos.y);
    try expectClose(node.scene3d_pos_z, solved.pos.z);
    try expectClose(node.scene3d_look_x, solved.target.x);
    try expectClose(node.scene3d_look_y, solved.target.y);
    try expectClose(node.scene3d_look_z, solved.target.z);
    try expectClose(node.scene3d_fov, solved.fov);
}

fn solvedDistance(a: camera.Solved, b: camera.Solved) f32 {
    const px = a.pos.x - b.pos.x;
    const py = a.pos.y - b.pos.y;
    const pz = a.pos.z - b.pos.z;
    const tx = a.target.x - b.target.x;
    const ty = a.target.y - b.target.y;
    const tz = a.target.z - b.target.z;
    return @sqrt(px * px + py * py + pz * pz + tx * tx + ty * ty + tz * tz);
}

fn nodeSolved(node: FakeCameraNode) camera.Solved {
    return .{
        .pos = .{ .x = node.scene3d_pos_x, .y = node.scene3d_pos_y, .z = node.scene3d_pos_z },
        .target = .{ .x = node.scene3d_look_x, .y = node.scene3d_look_y, .z = node.scene3d_look_z },
        .fov = node.scene3d_fov,
    };
}

fn expectBetween(actual: f32, a: f32, b: f32) !void {
    try testing.expect(actual > @min(a, b));
    try testing.expect(actual < @max(a, b));
}

fn expectAxisClose(a: camera.Solved, b: camera.Solved) !void {
    const ax = a.target.x - a.pos.x;
    const ay = a.target.y - a.pos.y;
    const az = a.target.z - a.pos.z;
    const bx = b.target.x - b.pos.x;
    const by = b.target.y - b.pos.y;
    const bz = b.target.z - b.pos.z;
    const al = @sqrt(ax * ax + ay * ay + az * az);
    const bl = @sqrt(bx * bx + by * by + bz * bz);
    try expectClose(ax / al, bx / bl);
    try expectClose(ay / al, by / bl);
    try expectClose(az / al, bz / bl);
}

const SweepSums = struct {
    values: [7]f64 = .{ 0, 0, 0, 0, 0, 0, 0 },

    fn add(self: *SweepSums, solved: camera.Solved) void {
        self.values[0] += solved.pos.x;
        self.values[1] += solved.pos.y;
        self.values[2] += solved.pos.z;
        self.values[3] += solved.target.x;
        self.values[4] += solved.target.y;
        self.values[5] += solved.target.z;
        self.values[6] += solved.fov;
    }
};

fn expectSums(actual: [7]f64, expected: [7]f64) !void {
    for (actual, expected) |a, e| {
        try testing.expectApproxEqAbs(e, a, 0.01);
    }
}

test "orbit solve matches TypeScript registry reference vectors" {
    try expectSolved(
        camera.solveOrbit(.{}),
        .{ .x = -8.688419, .y = 8.603647, .z = -8.688419 },
        .{},
        55,
    );
    try expectSolved(
        camera.solveOrbit(.{
            .target = .{ .x = 12, .y = 3, .z = -4 },
            .yaw = 30,
            .pitch = 40,
            .dist = 7.65,
            .fov = 52,
        }),
        .{ .x = 9.069880, .y = 7.917325, .z = -9.075117 },
        .{ .x = 12, .y = 3, .z = -4 },
        52,
    );
    try expectSolved(
        camera.solveOrbit(.{
            .target = .{ .x = -5, .y = 2, .z = 90 },
            .yaw = 200,
            .pitch = 70,
            .dist = 40,
            .zoom = 0.1,
            .fov = 38,
        }),
        .{ .x = 18.395556, .y = 189.938524, .z = 154.278761 },
        .{ .x = -5, .y = 2, .z = 90 },
        38,
    );
}

test "freefly solve matches TypeScript registry reference vectors" {
    try expectSolved(
        camera.solveFreeFly(.{}),
        .{ .x = 0, .y = 5, .z = 14 },
        .{ .x = 0, .y = 4.792088, .z = 13.021852 },
        60,
    );
    try expectSolved(
        camera.solveFreeFly(.{
            .position = .{ .x = 60, .y = 48, .z = 210 },
            .yaw = 180,
            .pitch = -18,
            .fov = 65,
        }),
        .{ .x = 60, .y = 48, .z = 210 },
        .{ .x = 60, .y = 47.690983, .z = 209.048943 },
        65,
    );
}

test "aim solve matches TypeScript ADS reference vectors and clamps pitch" {
    try expectSolved(
        camera.solveAim(.{}),
        .{ .x = -0.62, .y = 1.62, .z = -2.4 },
        .{ .x = -0.62, .y = 1.62, .z = 12 },
        47,
    );
    try expectSolved(
        camera.solveAim(.{
            .target = .{ .x = 7, .y = 0, .z = -2 },
            .yaw = 250,
            .pitch = 30,
        }),
        .{ .x = 9.165167, .y = 0.420000, .z = -1.871734 },
        .{ .x = -2.553520, .y = 7.620000, .z = -6.136987 },
        47,
    );
    try expectSolved(
        camera.solveAim(.{
            .target = .{ .x = 10, .y = 1, .z = -4 },
            .yaw = 45,
            .pitch = 90,
            .crouch = 1,
        }),
        .{ .x = 8.644670, .y = 0.180470, .z = -4.478517 },
        .{ .x = 14.146211, .y = 12.297652, .z = 1.023023 },
        47,
    );
    try expectSolved(
        camera.solveAim(.{
            .target = .{ .x = -3, .y = 2, .z = 8 },
            .yaw = 135,
            .pitch = -90,
            .crouch = 0.25,
        }),
        .{ .x = -3.254820, .y = 5.705633, .z = 9.131632 },
        .{ .x = 0.904537, .y = -7.438167, .z = 4.972275 },
        47,
    );
}

test "Orbit and Aim case sweep matches TypeScript reference aggregates" {
    var orbit_sums = SweepSums{};
    var orbit_cases: u32 = 0;
    for ([_]f32{ -180, -90, -22.5, 0, 37, 90, 181 }) |yaw| {
        for ([_]f32{ -15, 0, 22, 57 }) |pitch| {
            for ([_]f32{ 3, 7.65, 15 }) |dist| {
                for ([_]f32{ 0.1, 0.75, 1, 2.5 }) |zoom| {
                    orbit_sums.add(camera.solveOrbit(.{
                        .target = .{ .x = yaw / 13, .y = pitch / 11, .z = dist - zoom * 2 },
                        .yaw = yaw,
                        .pitch = pitch,
                        .dist = dist,
                        .zoom = zoom,
                        .fov = @floatFromInt(35 + ((orbit_cases * 7) % 40)),
                    }));
                    orbit_cases += 1;
                }
            }
        }
    }
    try testing.expectEqual(@as(u32, 336), orbit_cases);
    try expectSums(orbit_sums.values, .{
        -80.29665350692058,
        1814.0114563149614,
        1649.2045828359385,
        57.230769230764764,
        488.7272727272725,
        2142.0000000000023,
        18280,
    });

    var aim_sums = SweepSums{};
    var aim_cases: u32 = 0;
    for ([_]f32{ -225, -90, 0, 45, 135, 270 }) |yaw| {
        for ([_]f32{ -120, -66, -12, 0, 33, 57, 90 }) |pitch| {
            for ([_]f32{ 0, 0.35, 1 }) |crouch| {
                for ([_]f32{ 1.7, 2.4, 3.2 }) |distance| {
                    aim_sums.add(camera.solveAim(.{
                        .target = .{ .x = yaw / 17, .y = crouch * 1.5, .z = pitch / 19 },
                        .yaw = yaw,
                        .pitch = pitch,
                        .crouch = crouch,
                        .distance = distance,
                    }));
                    aim_cases += 1;
                }
            }
        }
    }
    try testing.expectEqual(@as(u32, 378), aim_cases);
    try expectSums(aim_sums.values, .{
        476.31642986245987,
        770.9257904411577,
        -76.68679028819942,
        550.6813840926912,
        920.0569786463461,
        102.84609077967721,
        17766,
    });
}

test "controller smoothing moves continuously instead of snapping" {
    var c = camera.Controller{};
    c.setSmoothing(4);
    c.setOrbit(.{ .target = .{}, .yaw = 0, .pitch = 0, .dist = 10, .fov = 50 });
    _ = c.step(0);
    const start = c.current;
    c.setOrbit(.{ .target = .{}, .yaw = 90, .pitch = 0, .dist = 10, .fov = 50 });
    const desired = c.desired();
    const first = c.step(0.016);
    try expectBetween(first.pos.x, start.pos.x, desired.pos.x);
    try expectBetween(first.pos.z, start.pos.z, desired.pos.z);
}

test "controller walk to aim transition interpolates toward ADS solve" {
    var c = camera.Controller{};
    c.setSmoothing(8);
    c.setMode(.orbit);
    c.setOrbit(.{ .target = .{ .x = 0, .y = 1.45, .z = 0 }, .yaw = 0, .pitch = 17.8, .dist = 7.65, .fov = 52 });
    const orbit = c.step(0);
    c.setAim(.{ .target = .{}, .yaw = 0, .pitch = 0 });
    c.setMode(.aim);
    const aim = c.desired();
    const blended = c.step(0.016);
    try testing.expect(blended.pos.y < orbit.pos.y);
    try testing.expect(blended.pos.y > aim.pos.y);
    try testing.expect(blended.fov < orbit.fov);
    try testing.expect(blended.fov > aim.fov);
}

test "orbit and aim orientation mapping round trips without pitch inversion" {
    const target = camera.Vec3{ .x = 3, .y = 0.4, .z = -8 };
    const yaws = [_]f32{ 0, 17, 90, 181, 359 };
    const orbit_pitches = [_]f32{ -10, 0, 17.8, 35, 62 };
    for (yaws) |yaw| {
        for (orbit_pitches) |start_pitch| {
            var walk_yaw = yaw;
            var walk_pitch = start_pitch;
            for (0..12) |_| {
                const aim_yaw = walk_yaw;
                const aim_pitch = -walk_pitch;
                const orbit = camera.solveOrbit(.{
                    .target = .{ .x = target.x, .y = target.y + 1.45, .z = target.z },
                    .yaw = walk_yaw,
                    .pitch = walk_pitch,
                    .dist = 7.65,
                    .fov = 52,
                });
                const aim = camera.solveAim(.{
                    .target = target,
                    .yaw = aim_yaw,
                    .pitch = aim_pitch,
                });
                try expectAxisClose(orbit, aim);
                walk_yaw = aim_yaw;
                walk_pitch = -aim_pitch;
            }
            try expectClose(walk_yaw, yaw);
            try expectClose(walk_pitch, start_pitch);
        }
    }
}

test "input deltas update only the active mode parameters" {
    var c = camera.Controller{};
    c.setMode(.orbit);
    c.setOrbit(.{ .yaw = 10, .pitch = 20 });
    c.applyInputDeltas(5, -3);
    try expectClose(c.orbit.yaw, 15);
    try expectClose(c.orbit.pitch, 17);
    c.setMode(.aim);
    c.setAim(.{ .yaw = 2, .pitch = 0 });
    c.applyInputDeltas(4, 90);
    try expectClose(c.aim.yaw, 6);
    try expectClose(c.aim.pitch, 1.0 / camera.DEG);
    try expectClose(c.orbit.yaw, 15);
    c.setMode(.freefly);
    c.setFreeFly(.{ .yaw = 180, .pitch = -18 });
    c.applyInputDeltas(3, -100);
    try expectClose(c.freefly.yaw, 183);
    try expectClose(c.freefly.pitch, -89);
}

test "freefly movement integrates natively and writes consumed layout fields" {
    var c = camera.Controller{};
    c.setMode(.freefly);
    c.setSmoothing(0);
    c.setFreeFly(.{
        .position = .{ .x = 60, .y = 48, .z = 210 },
        .yaw = 180,
        .pitch = -18,
        .fov = 65,
    });
    c.setMoveAxes(.{ .forward = 1, .speed = 45 });
    const solved = c.step(1.0);
    try expectSolved(
        solved,
        .{ .x = 60, .y = 34.094235, .z = 167.202456 },
        .{ .x = 60, .y = 33.785218, .z = 166.251399 },
        65,
    );
    var node = FakeCameraNode{};
    camera.writeNode(&node, solved);
    try expectNodeCamera(node, solved);
}

test "bound nodes keep independent rigs and per-frame state" {
    camera.resetForTests();
    defer camera.resetForTests();

    camera.bindNode(101);
    camera.setOrbitForNode(101, .{ .target = .{}, .yaw = 0, .pitch = 0, .dist = 10, .fov = 50 });
    camera.setSmoothingForNode(101, 4);

    camera.bindNode(202);
    camera.setOrbitForNode(202, .{ .target = .{}, .yaw = 90, .pitch = 0, .dist = 20, .fov = 70 });
    camera.setSmoothingForNode(202, 0);

    const a0 = camera.stepNode(101, 1) orelse return error.MissingCameraA;
    const b0 = camera.stepNode(202, 1) orelse return error.MissingCameraB;
    try expectSolved(a0, .{ .x = 0, .y = 0, .z = -10 }, .{}, 50);
    try expectSolved(b0, .{ .x = -20, .y = 0, .z = 0 }, .{}, 70);

    camera.setOrbitForNode(101, .{ .target = .{}, .yaw = 180, .pitch = 0, .dist = 10, .fov = 50 });
    camera.setOrbitForNode(202, .{ .target = .{}, .yaw = 90, .pitch = 0, .dist = 5, .fov = 70 });
    const a1 = camera.stepNode(101, 17) orelse return error.MissingCameraA;
    const b1 = camera.stepNode(202, 17) orelse return error.MissingCameraB;
    const a_want = camera.solveOrbit(.{ .target = .{}, .yaw = 180, .pitch = 0, .dist = 10, .fov = 50 });
    try expectBetween(a1.pos.z, a0.pos.z, a_want.pos.z);
    try expectSolved(b1, .{ .x = -5, .y = 0, .z = 0 }, .{}, 70);
}

test "legacy node-less params staged before binding drive the default binding" {
    camera.resetForTests();
    defer camera.resetForTests();

    camera.setOrbit(.{
        .target = .{ .x = 3, .y = 1.5, .z = -2 },
        .yaw = 90,
        .pitch = 0,
        .dist = 8,
        .fov = 51,
    });
    camera.setMode(.orbit);
    try testing.expectEqual(@as(u32, 0), camera.activeNodeId());

    camera.bindNode(303);
    try testing.expectEqual(@as(u32, 303), camera.activeNodeId());
    const solved = camera.stepActive(1) orelse return error.MissingCamera;
    try expectSolved(solved, .{ .x = -5, .y = 1.5, .z = -2 }, .{ .x = 3, .y = 1.5, .z = -2 }, 51);
}

test "test route node-scoped boot ignores already-mounted editor cameras" {
    camera.resetForTests();
    defer camera.resetForTests();

    const editor_node: u32 = 11;
    const test_node: u32 = 22;
    camera.bindNode(editor_node);
    const editor_params = camera.OrbitParams{
        .target = .{ .x = 4508.64, .y = -12866.19, .z = 6513.40 },
        .yaw = 0,
        .pitch = 0,
        .dist = 1,
        .fov = 65,
    };
    camera.setOrbitForNode(editor_node, editor_params);

    camera.bindNode(test_node);
    const test_params = camera.OrbitParams{
        .target = .{ .x = 0.5, .y = 1.45, .z = 0.5 },
        .yaw = 0,
        .pitch = 17.8,
        .dist = 7.65,
        .fov = 52,
    };
    camera.setOrbitForNode(test_node, test_params);
    camera.setModeForNode(test_node, .orbit);

    const solved = camera.stepNode(test_node, 1) orelse return error.MissingCamera;
    const expected = camera.solveOrbit(test_params);
    try expectSolved(solved, expected.pos, expected.target, expected.fov);

    const hidden = camera.stepNode(editor_node, 1) orelse return error.MissingEditorCamera;
    const expected_hidden = camera.solveOrbit(editor_params);
    try expectSolved(hidden, expected_hidden.pos, expected_hidden.target, expected_hidden.fov);
}

test "visible test camera layout fields receive the native frame when an editor camera is mounted" {
    camera.resetForTests();
    defer camera.resetForTests();

    const editor_node: u32 = 11;
    const test_node: u32 = 22;
    const hidden_boot = camera.Solved{
        .pos = .{ .x = 4508.65, .y = -12867.19, .z = 6513.38 },
        .target = .{ .x = 4508.64, .y = -12866.19, .z = 6513.40 },
        .fov = 65,
    };
    const hidden_layout = FakeCameraNode{
        .scene3d_camera = true,
        .scene3d_pos_x = hidden_boot.pos.x,
        .scene3d_pos_y = hidden_boot.pos.y,
        .scene3d_pos_z = hidden_boot.pos.z,
        .scene3d_look_x = hidden_boot.target.x,
        .scene3d_look_y = hidden_boot.target.y,
        .scene3d_look_z = hidden_boot.target.z,
        .scene3d_fov = hidden_boot.fov,
    };
    var visible_layout = FakeCameraNode{
        .scene3d_camera = true,
        .scene3d_pos_x = 0.5,
        .scene3d_pos_y = 3.79,
        .scene3d_pos_z = -6.78,
        .scene3d_look_x = 0.5,
        .scene3d_look_y = 1.45,
        .scene3d_look_z = 0.5,
        .scene3d_fov = 52,
    };

    camera.bindNode(editor_node);
    camera.setOrbitForNode(editor_node, .{
        .target = hidden_boot.target,
        .yaw = 0,
        .pitch = 0,
        .dist = 1,
        .fov = hidden_boot.fov,
    });

    camera.bindNode(test_node);
    const moved_params = camera.OrbitParams{
        .target = .{ .x = 1.45, .y = 1.45, .z = 0.5 },
        .yaw = 0,
        .pitch = 17.8,
        .dist = 7.65,
        .fov = 52,
    };
    camera.setOrbitForNode(test_node, moved_params);
    camera.setModeForNode(test_node, .orbit);
    const visible_solved = camera.stepNode(test_node, 1000) orelse return error.MissingCamera;
    camera.writeNode(&visible_layout, visible_solved);

    try expectNodeCamera(visible_layout, camera.solveOrbit(moved_params));
    try expectNodeCamera(hidden_layout, hidden_boot);
}

test "per-node moving target stream matches legacy staging smoothness at the consumed layout fields" {
    const node: u32 = 44;
    const frames = [_]u32{ 1, 17, 33, 50, 67, 83, 100, 117, 133, 150 };

    var legacy_layout = FakeCameraNode{ .scene3d_camera = true };
    var legacy_last: ?camera.Solved = null;
    var legacy_max_step: f32 = 0;
    camera.resetForTests();
    camera.setOrbit(.{ .target = .{ .x = 0.5, .y = 1.45, .z = 0.5 }, .yaw = 0, .pitch = 17.8, .dist = 7.65, .fov = 52 });
    camera.setMode(.orbit);
    camera.bindNode(node);
    for (frames, 0..) |now, i| {
        const target_x = 0.5 + @as(f32, @floatFromInt(i)) * 0.04;
        camera.setOrbit(.{ .target = .{ .x = target_x, .y = 1.45, .z = 0.5 }, .yaw = 0, .pitch = 17.8, .dist = 7.65, .fov = 52 });
        const solved = camera.stepNode(node, now) orelse return error.MissingLegacyCamera;
        camera.writeNode(&legacy_layout, solved);
        const consumed = nodeSolved(legacy_layout);
        if (legacy_last) |prev| legacy_max_step = @max(legacy_max_step, solvedDistance(prev, consumed));
        legacy_last = consumed;
    }

    var node_layout = FakeCameraNode{ .scene3d_camera = true };
    var node_last: ?camera.Solved = null;
    var node_max_step: f32 = 0;
    camera.resetForTests();
    camera.bindNode(node);
    camera.setOrbitForNode(node, .{ .target = .{ .x = 0.5, .y = 1.45, .z = 0.5 }, .yaw = 0, .pitch = 17.8, .dist = 7.65, .fov = 52 });
    camera.setModeForNode(node, .orbit);
    for (frames, 0..) |now, i| {
        // Mirrors the declarative nativeCamera prop being applied again during
        // React updates: rebinding an existing slot must not reset smoothing.
        camera.bindNode(node);
        const target_x = 0.5 + @as(f32, @floatFromInt(i)) * 0.04;
        camera.setOrbitForNode(node, .{ .target = .{ .x = target_x, .y = 1.45, .z = 0.5 }, .yaw = 0, .pitch = 17.8, .dist = 7.65, .fov = 52 });
        const solved = camera.stepNode(node, now) orelse return error.MissingNodeCamera;
        camera.writeNode(&node_layout, solved);
        const consumed = nodeSolved(node_layout);
        if (node_last) |prev| node_max_step = @max(node_max_step, solvedDistance(prev, consumed));
        node_last = consumed;
    }

    try expectNodeCamera(node_layout, nodeSolved(legacy_layout));
    try expectClose(node_max_step, legacy_max_step);
}

test "unbind cleans state and rebind is safe" {
    camera.resetForTests();
    defer camera.resetForTests();

    camera.bindNode(77);
    camera.setOrbitForNode(77, .{ .target = .{}, .yaw = 0, .pitch = 0, .dist = 10, .fov = 50 });
    const first = camera.stepNode(77, 0) orelse return error.MissingCamera;
    camera.bindNode(77);
    const rebound_same = camera.stepNode(77, 16) orelse return error.MissingCamera;
    try expectSolved(rebound_same, first.pos, first.target, first.fov);

    camera.unbindNode(77);
    try testing.expect(!camera.isBound(77));
    try testing.expect(camera.stepNode(77, 32) == null);

    camera.bindNode(77);
    camera.setOrbitForNode(77, .{ .target = .{}, .yaw = 90, .pitch = 0, .dist = 6, .fov = 40 });
    const rebound_fresh = camera.stepNode(77, 48) orelse return error.MissingCamera;
    try expectSolved(rebound_fresh, .{ .x = -6, .y = 0, .z = 0 }, .{}, 40);
}

test "camera cadence probe is sampled state, not a terminal side effect" {
    camera.resetForTests();
    defer camera.resetForTests();

    const node: u32 = 99;
    camera.bindNode(node);
    camera.setModeForNode(node, .orbit);
    camera.setOrbitForNode(node, .{ .target = .{ .x = 0.5, .y = 1.45, .z = 0.5 }, .yaw = 0, .pitch = 17.8, .dist = 7.65, .fov = 52 });

    var now: u32 = 0;
    while (now <= 1000) : (now += 16) {
        _ = camera.stepNode(node, now) orelse return error.MissingCamera;
    }

    const snap = camera.probeSnapshot();
    try testing.expect(snap.has_sample);
    try testing.expectEqual(node, snap.node_id);
    try testing.expect(snap.frames > 0);
    try testing.expect(snap.avg_dt_ms >= 0);
    try testing.expectEqual(@as(u32, 0), snap.params);
    try testing.expectEqual(camera.Mode.orbit, snap.mode);
    try testing.expect(snap.max_pos_lag >= 0);
}
