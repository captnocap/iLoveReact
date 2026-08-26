//! Behavior tests for the compiled Fart Racer simulation.
//!
//! Run: zig build test-fart-racer

const std = @import("std");
const testing = std.testing;
const driving = @import("game_driving");
const racer = @import("fart_racer");
const vehicle_visual = @import("fart_racer_vehicle_visual");

fn band(minimum: f32, maximum: f32) racer.Range {
    return .{ .minimum = minimum, .maximum = maximum };
}

const TARGET = racer.Target{
    .rating_fallbacks = .{ .drive = 0.5, .grip = 0.5, .handling = 0.5, .top_speed = 0.5, .acceleration = 0.5 },
    .driving_bands = .{
        .engine_power = band(4, 14),
        .brake_power = band(8, 18),
        .reverse_power = band(2, 7),
        .top_speed = band(15, 45),
        .reverse_top_speed = band(4, 12),
        .drag = band(0.0004, 0.0012),
        .roll_resist = band(0.2, 0.8),
        .max_steer = band(0.3, 0.65),
        .steer_speed = band(1.5, 6),
        .grip = band(1.5, 8),
        .handbrake_grip = band(0.2, 1.2),
        .max_lateral_g = band(0.5, 1.5),
        .cornering_drag = band(0.2, 0.9),
        .roll_lean_gain = band(0.08, 0.24),
        .max_lean = band(0.2, 0.4),
        .roll_ease = band(4, 12),
        .center_of_gravity_height = band(0.38, 0.58),
        .rollover_gravity = band(10, 22),
        .roll_damping = band(2, 7),
        .pitch_gain = band(0.02, 0.08),
        .wheel_base = 2.7,
        .track_width = 1.85,
    },
    .sim = .{
        .initial_tank_ratio = 0.25,
        .bowel_capacity = 100,
        .minimum_collision_impulse = 4,
        .collision_damage_per_impulse = 2,
        .maximum_step_seconds = 0.05,
        .boost_burn_multiplier = 4,
    },
};

const FALLBACKS = racer.VehicleFallbacks{
    .durability_capacity = 100,
    .tank_capacity_liters = 20,
    .burn_liters_per_second = 1,
    .fill_efficiency = 0.8,
    .leak_liters_per_damage_second = 0.001,
};

test "vehicle ratings map through target bands and report defaulted fields" {
    const application = racer.applyVehicleBlueprint(.{
        .acceleration_rating = 1,
        .top_speed_rating = 0,
        .tank_capacity_liters = 30,
    }, TARGET, FALLBACKS);
    try testing.expectEqual(@as(f32, 14), application.config.driving_tuning.engine_power);
    try testing.expectEqual(@as(f32, 15), application.config.driving_tuning.top_speed);
    try testing.expectEqual(@as(f32, 30), application.config.tank_capacity_liters);
    try testing.expectEqual(racer.ApplicationStatus.adopted, application.report[4].status);
    try testing.expectEqual(racer.ApplicationStatus.defaulted, application.report[0].status);
    try testing.expectEqual(racer.ApplicationStatus.adopted, application.report[6].status);
}

test "every target-rated car stays upright through an ordinary full-steer launch" {
    const ratings = [_]f32{ 0, 0.5, 1 };
    for (ratings) |grip| for (ratings) |handling| {
        const application = racer.applyVehicleBlueprint(.{
            .grip_rating = grip,
            .handling_rating = handling,
            .top_speed_rating = 1,
            .acceleration_rating = 1,
        }, TARGET, FALLBACKS);
        var state = racer.State.init(application.config, TARGET.sim);
        state.vehicle.velocity_z = 18;
        var frame: usize = 0;
        while (frame < 120) : (frame += 1) {
            const result = racer.step(&state, .{ .throttle = 1, .steer = 1 }, application.config, TARGET.sim, 1.0 / 60.0);
            try testing.expect(!result.driving.just_flipped);
            try testing.expect(!state.vehicle.flipped);
        }
    };
}

test "vehicle visual steers front wheels, rolls all wheels, and follows the body center" {
    const pose = vehicle_visual.Pose{
        .x = 10,
        .y = 2,
        .z = 20,
        .yaw_degrees = 90,
        .pitch_degrees = 3,
        .roll_degrees = 4,
        .front_steer_degrees = 12,
        .wheel_roll_degrees = 45,
        .brake_lights_on = false,
        .reverse_lights_on = false,
    };
    const front = vehicle_visual.partTransform(@intFromEnum(vehicle_visual.PartRole.wheel_front_left), .{ 1, 0.5, 2 }, pose, vehicle_visual.DEFAULT_TUNING);
    const rear = vehicle_visual.partTransform(@intFromEnum(vehicle_visual.PartRole.wheel_rear_left), .{ 1, 0.5, -2 }, pose, vehicle_visual.DEFAULT_TUNING);
    try testing.expectApproxEqAbs(@as(f32, 102), front.rot_y, 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 90), rear.rot_y, 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 45), front.rot_x, 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 12), front.x, 1e-5);
    try testing.expectApproxEqAbs(@as(f32, 19), front.z, 1e-5);
}

test "brake and reverse lamps have distinct commanded states" {
    const tuning = vehicle_visual.DEFAULT_TUNING;
    const braking = vehicle_visual.lightState(-1, false, 8, tuning);
    try testing.expect(braking.brake);
    try testing.expect(!braking.reverse);
    const reversing = vehicle_visual.lightState(-1, false, -1, tuning);
    try testing.expect(!reversing.brake);
    try testing.expect(reversing.reverse);
    const stopped = vehicle_visual.lightState(0, true, 0, tuning);
    try testing.expect(stopped.brake);
}

test "throttle burns tank and an empty tank cannot accelerate" {
    const application = racer.applyVehicleBlueprint(.{}, TARGET, FALLBACKS);
    var state = racer.State.init(application.config, TARGET.sim);
    const before = state.tank_liters;
    _ = racer.step(&state, .{ .throttle = 1 }, application.config, TARGET.sim, 0.05);
    try testing.expect(state.tank_liters < before);
    state.tank_liters = 0;
    state.vehicle = .{};
    const dry = racer.step(&state, .{ .throttle = 1 }, application.config, TARGET.sim, 0.05);
    try testing.expectApproxEqAbs(@as(f32, 0), dry.driving.speed, 1e-6);
}

test "digested food fills the tank while its bowel load remains live state" {
    const application = racer.applyVehicleBlueprint(.{}, TARGET, FALLBACKS);
    var state = racer.State.init(application.config, TARGET.sim);
    state.tank_liters = 0;
    try testing.expectEqual(racer.MealResult.queued, state.eat(.{
        .gas_yield_liters = 10,
        .digest_seconds = 0.1,
        .bowel_load = 20,
    }, TARGET.sim));
    _ = racer.step(&state, driving.Input{}, application.config, TARGET.sim, 0.05);
    _ = racer.step(&state, driving.Input{}, application.config, TARGET.sim, 0.05);
    try testing.expectApproxEqAbs(@as(f32, 8), state.tank_liters, 1e-5);
    try testing.expectEqual(@as(f32, 20), state.bowel_pressure);
    try testing.expectEqual(@as(usize, 0), state.digestion_count);
}

test "overeating loses before home and ordered checkpoints win otherwise" {
    const application = racer.applyVehicleBlueprint(.{}, TARGET, FALLBACKS);
    var soiled = racer.State.init(application.config, TARGET.sim);
    try testing.expectEqual(racer.MealResult.soiled, soiled.eat(.{
        .gas_yield_liters = 100,
        .digest_seconds = 1,
        .bowel_load = TARGET.sim.bowel_capacity,
    }, TARGET.sim));
    try testing.expectEqual(racer.RacePhase.soiled, soiled.phase);
    try testing.expect(!soiled.crossHome(0));

    var winner = racer.State.init(application.config, TARGET.sim);
    try testing.expect(!winner.crossCheckpoint(1));
    try testing.expect(winner.crossCheckpoint(0));
    try testing.expect(winner.crossCheckpoint(1));
    try testing.expect(winner.crossHome(2));
    try testing.expectEqual(racer.RacePhase.won, winner.phase);
}

test "collision damage leaks fuel and can wreck the car" {
    const application = racer.applyVehicleBlueprint(.{}, TARGET, FALLBACKS);
    var state = racer.State.init(application.config, TARGET.sim);
    const damage = state.collide(10, application.config, TARGET.sim);
    try testing.expect(damage > 0);
    const tank_before = state.tank_liters;
    _ = racer.step(&state, .{}, application.config, TARGET.sim, 0.05);
    try testing.expect(state.tank_liters < tank_before);
    _ = state.collide(1000, application.config, TARGET.sim);
    try testing.expectEqual(racer.RacePhase.wrecked, state.phase);
}

test "the exhaust dump trades tank for speed, and the trade is metered" {
    // The game's own verb: hold it down a straight and you go faster, but the
    // gas you spend is gas you have to eat your way back into — and eating is
    // the only thing that moves the lose-timer.
    const application = racer.applyVehicleBlueprint(.{}, TARGET, FALLBACKS);

    var plain = racer.State.init(application.config, TARGET.sim);
    var boosted = racer.State.init(application.config, TARGET.sim);
    // Full tanks: this half of the test is about what overdrive BUYS, and a
    // partial tank would only measure which car ran dry first.
    plain.tank_liters = application.config.tank_capacity_liters;
    boosted.tank_liters = application.config.tank_capacity_liters;
    var tick: usize = 0;
    while (tick < 120) : (tick += 1) {
        _ = racer.step(&plain, .{ .throttle = 1 }, application.config, TARGET.sim, TARGET.sim.maximum_step_seconds);
        _ = racer.step(&boosted, .{ .throttle = 1, .boost = 1 }, application.config, TARGET.sim, TARGET.sim.maximum_step_seconds);
    }
    try testing.expect(boosted.vehicle.odometer > plain.vehicle.odometer);
    try testing.expect(boosted.tank_liters < plain.tank_liters);

    // And the bill is the point: at the authored multiplier the dump drains the
    // tank several times faster than an ordinary flat-out lap.
    const plain_burn = application.config.tank_capacity_liters - plain.tank_liters;
    const boosted_burn = application.config.tank_capacity_liters - boosted.tank_liters;
    try testing.expect(boosted_burn > plain_burn * 2);

    // Overdrive rides ON the throttle. A coasting car cannot dump its way
    // forward, and it cannot spend fuel doing it either.
    var coasting = racer.State.init(application.config, TARGET.sim);
    const parked_tank = coasting.tank_liters;
    tick = 0;
    while (tick < 60) : (tick += 1) {
        _ = racer.step(&coasting, .{ .boost = 1 }, application.config, TARGET.sim, TARGET.sim.maximum_step_seconds);
    }
    try testing.expectApproxEqAbs(@as(f32, 0), coasting.vehicle.odometer, 1e-6);
    try testing.expectApproxEqAbs(parked_tank, coasting.tank_liters, 1e-6);

    // And a dry tank grants nothing, however hard it is asked.
    var dry = racer.State.init(application.config, TARGET.sim);
    dry.tank_liters = 0;
    const stalled = racer.step(&dry, .{ .throttle = 1, .boost = 1 }, application.config, TARGET.sim, TARGET.sim.maximum_step_seconds);
    try testing.expectApproxEqAbs(@as(f32, 0), stalled.driving.speed, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), dry.tank_liters, 1e-6);
}
