//! Behavior tests for framework/game/driving.zig.
//!
//! Run: zig build test-game-driving

const std = @import("std");
const testing = std.testing;
const driving = @import("game_driving");

const TUNING = driving.Tuning{
    .engine_power = 9,
    .brake_power = 14,
    .reverse_power = 5,
    .top_speed = 34,
    .reverse_top_speed = 8,
    .drag = 0.0008,
    .roll_resist = 0.5,
    .max_steer = 0.5,
    .steer_speed = 3.2,
    .grip = 4.5,
    .handbrake_grip = 0.8,
    .max_lateral_g = 1.05,
    .cornering_drag = 0.5,
    .roll_lean_gain = 0.16,
    .max_lean = 0.32,
    .roll_ease = 9,
    .center_of_gravity_height = 0.95,
    .rollover_gravity = 16,
    .roll_damping = 4,
    .pitch_gain = 0.05,
    .wheel_base = 2.7,
    .track_width = 1.85,
};

test "throttle accelerates forward and integrates distance" {
    var state = driving.State{};
    const telemetry = driving.step(&state, .{ .throttle = 1 }, TUNING, 0.05);
    try testing.expect(telemetry.speed > 0);
    try testing.expect(state.z > 0);
    try testing.expectApproxEqAbs(telemetry.speed * 0.05, state.odometer, 1e-6);
    try testing.expectEqual(driving.Gear.drive, telemetry.gear);
}

test "foot brake stops without crossing into reverse" {
    var state = driving.State{ .velocity_z = 1 };
    var frame: usize = 0;
    while (frame < 10) : (frame += 1) {
        _ = driving.step(&state, .{ .foot_brake = true }, TUNING, 0.05);
    }
    const stopped = driving.step(&state, .{ .foot_brake = true }, TUNING, 0.05);
    try testing.expectApproxEqAbs(@as(f32, 0), stopped.speed, 1e-6);
    try testing.expectEqual(driving.Gear.neutral, stopped.gear);
}

test "lateral grip limit makes low-grip car turn wider" {
    var low_grip = driving.State{ .velocity_z = 20 };
    var high_grip = low_grip;
    var loose = TUNING;
    loose.max_lateral_g = 0.2;
    loose.track_width = 8;
    loose.center_of_gravity_height = 0.2;
    var planted = TUNING;
    planted.max_lateral_g = 2;
    planted.track_width = loose.track_width;
    planted.center_of_gravity_height = loose.center_of_gravity_height;
    var frame: usize = 0;
    while (frame < 20) : (frame += 1) {
        _ = driving.step(&low_grip, .{ .steer = 1 }, loose, 0.05);
        _ = driving.step(&high_grip, .{ .steer = 1 }, planted, 0.05);
    }
    try testing.expect(@abs(low_grip.heading) < @abs(high_grip.heading));
}

test "top-heavy narrow vehicle can roll while wide low vehicle stays upright" {
    var top_heavy = driving.State{ .velocity_z = 24 };
    var planted = top_heavy;
    var tipping_tuning = TUNING;
    tipping_tuning.center_of_gravity_height = 2.4;
    tipping_tuning.track_width = 1;
    tipping_tuning.max_lateral_g = 3;
    var planted_tuning = tipping_tuning;
    planted_tuning.center_of_gravity_height = 0.4;
    planted_tuning.track_width = 2.4;
    var top_heavy_flipped = false;
    var planted_flipped = false;
    var frame: usize = 0;
    while (frame < 40) : (frame += 1) {
        top_heavy_flipped = top_heavy_flipped or driving.step(&top_heavy, .{ .steer = 1 }, tipping_tuning, 0.05).just_flipped;
        planted_flipped = planted_flipped or driving.step(&planted, .{ .steer = 1 }, planted_tuning, 0.05).just_flipped;
    }
    try testing.expect(top_heavy_flipped);
    try testing.expect(!planted_flipped);
}

test "step clamps tab-stall delta to the model maximum" {
    var stalled = driving.State{};
    var ordinary = driving.State{};
    const stalled_telemetry = driving.step(&stalled, .{ .throttle = 1 }, TUNING, 10);
    const ordinary_telemetry = driving.step(&ordinary, .{ .throttle = 1 }, TUNING, driving.DEFAULT_MODEL.max_step_seconds);
    try testing.expectApproxEqAbs(ordinary_telemetry.speed, stalled_telemetry.speed, 1e-6);
    try testing.expectApproxEqAbs(ordinary.z, stalled.z, 1e-6);
}

test "overdrive raises the ceiling and rides the throttle" {
    const tuning = TUNING;
    var plain = driving.State{};
    var boosted = driving.State{};
    var tick: usize = 0;
    while (tick < 400) : (tick += 1) {
        _ = driving.step(&plain, .{ .throttle = 1 }, tuning, 0.05);
        _ = driving.step(&boosted, .{ .throttle = 1, .boost = 1 }, tuning, 0.05);
    }
    // Both are at their own terminal speed by now; the boosted ceiling is higher.
    try testing.expect(boosted.velocity_z > plain.velocity_z * 1.05);

    // No throttle, no shove — overdrive is not a second engine.
    var coasting = driving.State{};
    const telemetry = driving.step(&coasting, .{ .boost = 1 }, tuning, 0.05);
    try testing.expectApproxEqAbs(@as(f32, 0), telemetry.speed, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), telemetry.boost, 1e-6);

    // And a flipped car keeps its cutout.
    var flipped = driving.State{ .flipped = true };
    const shell = driving.step(&flipped, .{ .throttle = 1, .boost = 1 }, tuning, 0.05);
    try testing.expectApproxEqAbs(@as(f32, 0), shell.boost, 1e-6);
}
