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

fn expectBetween(actual: f32, a: f32, b: f32) !void {
    try testing.expect(actual > @min(a, b));
    try testing.expect(actual < @max(a, b));
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
}
