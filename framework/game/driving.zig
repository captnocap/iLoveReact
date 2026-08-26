//! Reusable, compiled vehicle motion.
//!
//! This is the engine-side graduation of the original handling-lab bicycle
//! model. `Tuning` contains authored vehicle feel; `Model` contains the small
//! set of constants that define the shared algorithm. Consumers own both
//! tables and the live `State`.

const std = @import("std");

pub const Gear = enum { drive, reverse, neutral };

pub const Tuning = struct {
    engine_power: f32,
    brake_power: f32,
    reverse_power: f32,
    top_speed: f32,
    reverse_top_speed: f32,
    drag: f32,
    roll_resist: f32,
    max_steer: f32,
    steer_speed: f32,
    grip: f32,
    handbrake_grip: f32,
    max_lateral_g: f32,
    cornering_drag: f32,
    roll_lean_gain: f32,
    max_lean: f32,
    roll_ease: f32,
    center_of_gravity_height: f32,
    rollover_gravity: f32,
    roll_damping: f32,
    pitch_gain: f32,
    wheel_base: f32,
    track_width: f32,
};

/// Shared-model constants live in one inspectable table rather than being
/// scattered through the integration routine. Games may version this table
/// when they intentionally need a different driving model.
pub const Model = struct {
    gravity: f32,
    max_step_seconds: f32,
    direction_deadzone: f32,
    minimum_wheel_base: f32,
    minimum_steer_angle: f32,
    minimum_center_of_gravity_height: f32,
    flipped_shell_friction: f32,
    foot_brake_multiplier: f32,
    rollover_energy_height: f32,
    rollover_commit_multiplier: f32,
    rollover_damping_scale: f32,
    rollover_gravity_scale: f32,
    upright_roll_tolerance: f32,
    upright_velocity_tolerance: f32,
    pitch_force_scale: f32,
    pitch_limit: f32,
    pitch_ease: f32,
    slip_denominator_floor: f32,
    /// Overdrive shape. The gate multiplies the throttle before it scales the
    /// boost, so a car under part throttle gets part of the shove and a car
    /// coasting gets none — overdrive adds to what the engine is already doing
    /// instead of becoming a second, throttle-free engine.
    boost_throttle_gate: f32,
    boost_power_multiplier: f32,
    boost_top_speed_multiplier: f32,
};

pub const DEFAULT_MODEL = Model{
    .gravity = 9.81,
    .max_step_seconds = 0.05,
    .direction_deadzone = 0.2,
    .minimum_wheel_base = 0.01,
    .minimum_steer_angle = 0.001,
    .minimum_center_of_gravity_height = 0.2,
    .flipped_shell_friction = 3,
    .foot_brake_multiplier = 1.4,
    .rollover_energy_height = 0.7,
    .rollover_commit_multiplier = 1.15,
    .rollover_damping_scale = 0.12,
    .rollover_gravity_scale = 0.7,
    .upright_roll_tolerance = 0.25,
    .upright_velocity_tolerance = 0.6,
    .pitch_force_scale = 0.02,
    .pitch_limit = 0.1,
    .pitch_ease = 8,
    .boost_throttle_gate = 2,
    .boost_power_multiplier = 1.85,
    .boost_top_speed_multiplier = 1.3,
    .slip_denominator_floor = 0.001,
};

pub const State = struct {
    x: f32 = 0,
    z: f32 = 0,
    heading: f32 = 0,
    velocity_x: f32 = 0,
    velocity_z: f32 = 0,
    steer: f32 = 0,
    odometer: f32 = 0,
    roll: f32 = 0,
    roll_velocity: f32 = 0,
    pitch: f32 = 0,
    flipped: bool = false,

    pub fn right(self: *State) void {
        self.roll = 0;
        self.roll_velocity = 0;
        self.pitch = 0;
        self.flipped = false;
    }
};

pub const Input = struct {
    throttle: f32 = 0,
    brake: f32 = 0,
    steer: f32 = 0,
    handbrake: bool = false,
    foot_brake: bool = false,
    /// Overdrive, 0..1. A game decides what it COSTS and hands the surviving
    /// fraction here; the handling model only knows it as more engine and a
    /// higher ceiling, applied on top of throttle so it can never move a
    /// stationary car on its own.
    boost: f32 = 0,
};

pub const Telemetry = struct {
    speed: f32,
    lateral_speed: f32,
    slip_angle: f32,
    roll: f32,
    just_flipped: bool,
    gear: Gear,
    /// How much overdrive actually reached the road this step, 0..1 — after the
    /// throttle gate and the flip cutout. What a HUD, a camera, and an exhaust
    /// effect should all read, rather than the raw request.
    boost: f32,
};

fn clamp(value: f32, minimum: f32, maximum: f32) f32 {
    return @max(minimum, @min(maximum, value));
}

/// How much overdrive a throttle position actually earns, 0..1. The COST side
/// has to charge for exactly this, not for the raw request: a coasting car that
/// holds the button gets no shove, so it must not be billed for one either.
pub fn effectiveBoostWithModel(throttle: f32, boost: f32, model: Model) f32 {
    const gated = clamp(boost, 0, 1) * @min(1, clamp(throttle, 0, 1) * model.boost_throttle_gate);
    return clamp(gated, 0, 1);
}

pub fn effectiveBoost(throttle: f32, boost: f32) f32 {
    return effectiveBoostWithModel(throttle, boost, DEFAULT_MODEL);
}

pub fn step(state: *State, input: Input, tuning: Tuning, dt_seconds: f32) Telemetry {
    return stepWithModel(state, input, tuning, DEFAULT_MODEL, dt_seconds);
}

pub fn stepWithModel(state: *State, input: Input, tuning: Tuning, model: Model, dt_seconds: f32) Telemetry {
    const dt = clamp(dt_seconds, 0, model.max_step_seconds);
    const controls = if (state.flipped) Input{} else Input{
        .throttle = clamp(input.throttle, 0, 1),
        .brake = clamp(input.brake, 0, 1),
        .steer = clamp(input.steer, -1, 1),
        .handbrake = input.handbrake,
        .foot_brake = input.foot_brake,
        .boost = clamp(input.boost, 0, 1),
    };

    const forward_x = @sin(state.heading);
    const forward_z = @cos(state.heading);
    const right_x = @cos(state.heading);
    const right_z = -@sin(state.heading);
    var forward_speed = state.velocity_x * forward_x + state.velocity_z * forward_z;
    var lateral_speed = state.velocity_x * right_x + state.velocity_z * right_z;

    const boost = effectiveBoostWithModel(controls.throttle, controls.boost, model);
    const engine_power = tuning.engine_power * (1 + boost * (model.boost_power_multiplier - 1));
    const top_speed = tuning.top_speed * (1 + boost * (model.boost_top_speed_multiplier - 1));
    if (controls.throttle > 0) forward_speed += controls.throttle * engine_power * dt;
    if (controls.brake > 0) {
        if (forward_speed > model.direction_deadzone) {
            forward_speed = @max(0, forward_speed - controls.brake * tuning.brake_power * dt);
        } else {
            forward_speed -= controls.brake * tuning.reverse_power * dt;
        }
    }
    if (controls.foot_brake) {
        const deceleration = tuning.brake_power * model.foot_brake_multiplier * dt;
        forward_speed = if (forward_speed > 0)
            @max(0, forward_speed - deceleration)
        else
            @min(0, forward_speed + deceleration);
    }
    forward_speed = clamp(forward_speed, -tuning.reverse_top_speed, top_speed);

    forward_speed -= forward_speed * tuning.roll_resist * dt;
    forward_speed -= forward_speed * @abs(forward_speed) * tuning.drag * dt;
    if (state.flipped) {
        const shell_decay = @exp(-model.flipped_shell_friction * dt);
        forward_speed *= shell_decay;
        lateral_speed *= shell_decay;
    }

    const lateral_grip = if (controls.handbrake) tuning.handbrake_grip else tuning.grip;
    lateral_speed *= @exp(-lateral_grip * dt);

    const target_steer = controls.steer * tuning.max_steer;
    state.steer += (target_steer - state.steer) * clamp(tuning.steer_speed * dt, 0, 1);
    const safe_wheel_base = @max(model.minimum_wheel_base, tuning.wheel_base);
    var angular_velocity = (forward_speed / safe_wheel_base) * @tan(state.steer);
    const maximum_lateral_acceleration = tuning.max_lateral_g * model.gravity;
    var lateral_acceleration = forward_speed * angular_velocity;
    if (@abs(lateral_acceleration) > maximum_lateral_acceleration and @abs(lateral_acceleration) > 0) {
        angular_velocity *= maximum_lateral_acceleration / @abs(lateral_acceleration);
        lateral_acceleration = forward_speed * angular_velocity;
    }
    state.heading += angular_velocity * dt;

    const steer_fraction = @abs(state.steer) / @max(model.minimum_steer_angle, tuning.max_steer);
    forward_speed -= forward_speed * steer_fraction * tuning.cornering_drag * dt;

    const was_flipped = state.flipped;
    if (!state.flipped) {
        const lean_target = clamp(
            -lateral_acceleration / model.gravity * tuning.roll_lean_gain,
            -tuning.max_lean,
            tuning.max_lean,
        );
        state.roll += (lean_target - state.roll) * clamp(tuning.roll_ease * dt, 0, 1);
        state.roll_velocity = 0;
        const tip_acceleration = model.gravity * (tuning.track_width * 0.5) /
            @max(model.minimum_center_of_gravity_height, tuning.center_of_gravity_height);
        if (@abs(lateral_acceleration) > tip_acceleration) {
            state.flipped = true;
            const crest = @sqrt(2 * tuning.rollover_gravity * model.rollover_energy_height) *
                model.rollover_commit_multiplier;
            state.roll_velocity = if (lateral_acceleration > 0) -crest else crest;
        }
    } else {
        state.roll_velocity += (-tuning.roll_damping * model.rollover_damping_scale * state.roll_velocity -
            tuning.rollover_gravity * model.rollover_gravity_scale * @sin(2 * state.roll)) * dt;
        state.roll += state.roll_velocity * dt;
        if (state.roll > std.math.pi) state.roll -= 2 * std.math.pi;
        if (state.roll < -std.math.pi) state.roll += 2 * std.math.pi;
        if (@abs(state.roll) < model.upright_roll_tolerance and
            @abs(state.roll_velocity) < model.upright_velocity_tolerance)
        {
            state.right();
        }
    }

    const forward_force = (if (controls.throttle > 0) controls.throttle * tuning.engine_power else 0) -
        (if (forward_speed > 0)
            (if (controls.brake > 0) controls.brake * tuning.brake_power else 0) +
                (if (controls.foot_brake) tuning.brake_power * model.foot_brake_multiplier else 0)
        else
            0);
    const pitch_target = clamp(
        forward_force * tuning.pitch_gain * model.pitch_force_scale,
        -model.pitch_limit,
        model.pitch_limit,
    );
    state.pitch += (pitch_target - state.pitch) * clamp(model.pitch_ease * dt, 0, 1);

    const next_forward_x = @sin(state.heading);
    const next_forward_z = @cos(state.heading);
    const next_right_x = @cos(state.heading);
    const next_right_z = -@sin(state.heading);
    state.velocity_x = forward_speed * next_forward_x + lateral_speed * next_right_x;
    state.velocity_z = forward_speed * next_forward_z + lateral_speed * next_right_z;
    state.x += state.velocity_x * dt;
    state.z += state.velocity_z * dt;
    state.odometer += forward_speed * dt;

    const gear: Gear = if (forward_speed > model.direction_deadzone)
        .drive
    else if (forward_speed < -model.direction_deadzone)
        .reverse
    else
        .neutral;
    return .{
        .speed = forward_speed,
        .lateral_speed = lateral_speed,
        .slip_angle = std.math.atan2(lateral_speed, @abs(forward_speed) + model.slip_denominator_floor),
        .roll = state.roll,
        .just_flipped = state.flipped and !was_flipped,
        .gear = gear,
        .boost = boost,
    };
}
