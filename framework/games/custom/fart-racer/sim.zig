//! Fart Racer's compiled simulation.
//!
//! Documents provide `VehicleBlueprint` and `FoodBlueprint` values. The game
//! target provides all numeric tuning tables. This module carries only the
//! mapping rules and irreducible live state: fuel, digestion, bowel pressure,
//! durability, checkpoint progress, and elapsed race time.

pub const driving = @import("game_driving");

pub const MAX_DIGESTION_QUEUE: usize = 32;

pub const ApplicationStatus = enum {
    adopted,
    normalized,
    ignored_by_policy,
    unknown_preserved,
    defaulted,
};

pub const ApplicationRow = struct {
    field: []const u8,
    status: ApplicationStatus,
};

pub const Range = struct {
    minimum: f32,
    maximum: f32,

    pub fn sample(self: Range, rating: f32) f32 {
        const normalized = clamp(rating, 0, 1);
        return self.minimum + (self.maximum - self.minimum) * normalized;
    }

    pub fn sampleInverse(self: Range, rating: f32) f32 {
        return self.sample(1 - clamp(rating, 0, 1));
    }
};

pub const RatingFallbacks = struct {
    drive: f32,
    grip: f32,
    handling: f32,
    top_speed: f32,
    acceleration: f32,
};

/// Numeric bands are exported from the game target. The compiled adapter maps
/// semantic ratings to these bands, but never embeds a game's tuning numbers.
pub const DrivingBands = struct {
    engine_power: Range,
    brake_power: Range,
    reverse_power: Range,
    top_speed: Range,
    reverse_top_speed: Range,
    drag: Range,
    roll_resist: Range,
    max_steer: Range,
    steer_speed: Range,
    grip: Range,
    handbrake_grip: Range,
    max_lateral_g: Range,
    cornering_drag: Range,
    roll_lean_gain: Range,
    max_lean: Range,
    roll_ease: Range,
    center_of_gravity_height: Range,
    rollover_gravity: Range,
    roll_damping: Range,
    pitch_gain: Range,
    wheel_base: f32,
    track_width: f32,
};

pub const SimTuning = struct {
    initial_tank_ratio: f32,
    bowel_capacity: f32,
    minimum_collision_impulse: f32,
    collision_damage_per_impulse: f32,
    maximum_step_seconds: f32,
    /// What the exhaust dump costs. Overdrive burns the tank at this multiple
    /// of the ordinary rate, which is the whole bet: the gas you spend on a
    /// straight is gas you have to eat your way back into, and eating is the
    /// only thing that moves the lose-timer.
    boost_burn_multiplier: f32,
};

pub const Target = struct {
    rating_fallbacks: RatingFallbacks,
    driving_bands: DrivingBands,
    sim: SimTuning,
};

pub const VehicleBlueprint = struct {
    drive_rating: ?f32 = null,
    grip_rating: ?f32 = null,
    handling_rating: ?f32 = null,
    top_speed_rating: ?f32 = null,
    acceleration_rating: ?f32 = null,
    durability_capacity: ?f32 = null,
    tank_capacity_liters: ?f32 = null,
    burn_liters_per_second: ?f32 = null,
    fill_efficiency: ?f32 = null,
    leak_liters_per_damage_second: ?f32 = null,
};

pub const VehicleFallbacks = struct {
    durability_capacity: f32,
    tank_capacity_liters: f32,
    burn_liters_per_second: f32,
    fill_efficiency: f32,
    leak_liters_per_damage_second: f32,
};

pub const FoodBlueprint = struct {
    gas_yield_liters: f32,
    digest_seconds: f32,
    bowel_load: f32,
};

pub const VehicleConfig = struct {
    driving_tuning: driving.Tuning,
    durability_capacity: f32,
    tank_capacity_liters: f32,
    burn_liters_per_second: f32,
    fill_efficiency: f32,
    leak_liters_per_damage_second: f32,
};

pub const VehicleApplication = struct {
    config: VehicleConfig,
    report: [10]ApplicationRow,
};

fn clamp(value: f32, minimum: f32, maximum: f32) f32 {
    return @max(minimum, @min(maximum, value));
}

fn adoptedOrDefaulted(authored: ?f32) ApplicationStatus {
    return if (authored == null) .defaulted else .adopted;
}

fn valueOr(authored: ?f32, fallback: f32) f32 {
    return authored orelse fallback;
}

pub fn applyVehicleBlueprint(
    blueprint: VehicleBlueprint,
    target: Target,
    vehicle_fallbacks: VehicleFallbacks,
) VehicleApplication {
    const drive = valueOr(blueprint.drive_rating, target.rating_fallbacks.drive);
    const grip = valueOr(blueprint.grip_rating, target.rating_fallbacks.grip);
    const handling = valueOr(blueprint.handling_rating, target.rating_fallbacks.handling);
    const top_speed = valueOr(blueprint.top_speed_rating, target.rating_fallbacks.top_speed);
    const acceleration = valueOr(blueprint.acceleration_rating, target.rating_fallbacks.acceleration);
    const bands = target.driving_bands;
    return .{
        .config = .{
            .driving_tuning = .{
                .engine_power = bands.engine_power.sample(acceleration),
                .brake_power = bands.brake_power.sample(handling),
                .reverse_power = bands.reverse_power.sample(acceleration),
                .top_speed = bands.top_speed.sample(top_speed),
                .reverse_top_speed = bands.reverse_top_speed.sample(top_speed),
                .drag = bands.drag.sampleInverse(top_speed),
                .roll_resist = bands.roll_resist.sampleInverse(drive),
                .max_steer = bands.max_steer.sample(handling),
                .steer_speed = bands.steer_speed.sample(handling),
                .grip = bands.grip.sample(grip),
                .handbrake_grip = bands.handbrake_grip.sample(grip),
                .max_lateral_g = bands.max_lateral_g.sample(grip),
                .cornering_drag = bands.cornering_drag.sampleInverse(handling),
                .roll_lean_gain = bands.roll_lean_gain.sampleInverse(handling),
                .max_lean = bands.max_lean.sample(handling),
                .roll_ease = bands.roll_ease.sample(handling),
                .center_of_gravity_height = bands.center_of_gravity_height.sampleInverse(handling),
                .rollover_gravity = bands.rollover_gravity.sample(handling),
                .roll_damping = bands.roll_damping.sample(handling),
                .pitch_gain = bands.pitch_gain.sampleInverse(acceleration),
                .wheel_base = bands.wheel_base,
                .track_width = bands.track_width,
            },
            .durability_capacity = valueOr(blueprint.durability_capacity, vehicle_fallbacks.durability_capacity),
            .tank_capacity_liters = valueOr(blueprint.tank_capacity_liters, vehicle_fallbacks.tank_capacity_liters),
            .burn_liters_per_second = valueOr(blueprint.burn_liters_per_second, vehicle_fallbacks.burn_liters_per_second),
            .fill_efficiency = valueOr(blueprint.fill_efficiency, vehicle_fallbacks.fill_efficiency),
            .leak_liters_per_damage_second = valueOr(
                blueprint.leak_liters_per_damage_second,
                vehicle_fallbacks.leak_liters_per_damage_second,
            ),
        },
        .report = .{
            .{ .field = "rj.profile.vehicle.driveRating", .status = adoptedOrDefaulted(blueprint.drive_rating) },
            .{ .field = "rj.profile.vehicle.gripRating", .status = adoptedOrDefaulted(blueprint.grip_rating) },
            .{ .field = "rj.profile.vehicle.handlingRating", .status = adoptedOrDefaulted(blueprint.handling_rating) },
            .{ .field = "rj.profile.vehicle.topSpeedRating", .status = adoptedOrDefaulted(blueprint.top_speed_rating) },
            .{ .field = "rj.profile.vehicle.accelerationRating", .status = adoptedOrDefaulted(blueprint.acceleration_rating) },
            .{ .field = "rj.core.item.durabilityCapacity", .status = adoptedOrDefaulted(blueprint.durability_capacity) },
            .{ .field = "com.captnocap.fartracer.tankCapacityL", .status = adoptedOrDefaulted(blueprint.tank_capacity_liters) },
            .{ .field = "com.captnocap.fartracer.burnRatePerSec", .status = adoptedOrDefaulted(blueprint.burn_liters_per_second) },
            .{ .field = "com.captnocap.fartracer.fillEfficiency", .status = adoptedOrDefaulted(blueprint.fill_efficiency) },
            .{ .field = "com.captnocap.fartracer.leakRatePerDamage", .status = adoptedOrDefaulted(blueprint.leak_liters_per_damage_second) },
        },
    };
}

pub const RacePhase = enum { running, won, soiled, wrecked };

pub const Digestion = struct {
    gas_yield_liters: f32 = 0,
    seconds_remaining: f32 = 0,
};

pub const MealResult = enum { queued, queue_full, soiled };

pub const State = struct {
    vehicle: driving.State = .{},
    tank_liters: f32,
    bowel_pressure: f32 = 0,
    durability: f32,
    damage: f32 = 0,
    digestion: [MAX_DIGESTION_QUEUE]Digestion = @splat(.{}),
    digestion_count: usize = 0,
    next_checkpoint: u32 = 0,
    elapsed_seconds: f32 = 0,
    phase: RacePhase = .running,

    pub fn init(config: VehicleConfig, tuning: SimTuning) State {
        return .{
            .tank_liters = config.tank_capacity_liters * clamp(tuning.initial_tank_ratio, 0, 1),
            .durability = config.durability_capacity,
        };
    }

    pub fn eat(self: *State, food: FoodBlueprint, tuning: SimTuning) MealResult {
        if (self.phase != .running) return if (self.phase == .soiled) .soiled else .queue_full;
        self.bowel_pressure += @max(0, food.bowel_load);
        if (self.bowel_pressure >= tuning.bowel_capacity) {
            self.phase = .soiled;
            return .soiled;
        }
        if (self.digestion_count >= self.digestion.len) return .queue_full;
        self.digestion[self.digestion_count] = .{
            .gas_yield_liters = @max(0, food.gas_yield_liters),
            .seconds_remaining = @max(0, food.digest_seconds),
        };
        self.digestion_count += 1;
        return .queued;
    }

    pub fn collide(self: *State, impulse: f32, config: VehicleConfig, tuning: SimTuning) f32 {
        if (self.phase != .running) return 0;
        const damaging_impulse = @max(0, impulse - tuning.minimum_collision_impulse);
        const dealt = damaging_impulse * tuning.collision_damage_per_impulse;
        self.damage = clamp(self.damage + dealt, 0, config.durability_capacity);
        self.durability = config.durability_capacity - self.damage;
        if (self.durability <= 0) self.phase = .wrecked;
        return dealt;
    }

    pub fn crossCheckpoint(self: *State, order: u32) bool {
        if (self.phase != .running or order != self.next_checkpoint) return false;
        self.next_checkpoint += 1;
        return true;
    }

    pub fn crossHome(self: *State, checkpoint_count: u32) bool {
        if (self.phase != .running or self.next_checkpoint != checkpoint_count) return false;
        self.phase = .won;
        return true;
    }
};

pub const StepResult = struct {
    driving: driving.Telemetry,
    tank_liters: f32,
    bowel_pressure: f32,
    durability: f32,
    phase: RacePhase,
};

pub fn step(
    state: *State,
    input: driving.Input,
    vehicle_config: VehicleConfig,
    sim_tuning: SimTuning,
    dt_seconds: f32,
) StepResult {
    const dt = clamp(dt_seconds, 0, sim_tuning.maximum_step_seconds);
    if (state.phase == .running) state.elapsed_seconds += dt;

    var index: usize = 0;
    while (index < state.digestion_count) {
        state.digestion[index].seconds_remaining -= dt;
        if (state.digestion[index].seconds_remaining <= 0) {
            const refill = state.digestion[index].gas_yield_liters * vehicle_config.fill_efficiency;
            state.tank_liters = clamp(state.tank_liters + refill, 0, vehicle_config.tank_capacity_liters);
            state.digestion_count -= 1;
            state.digestion[index] = state.digestion[state.digestion_count];
            state.digestion[state.digestion_count] = .{};
        } else {
            index += 1;
        }
    }

    const leak = state.damage * vehicle_config.leak_liters_per_damage_second * dt;
    state.tank_liters = @max(0, state.tank_liters - leak);
    var fueled_input = input;
    if (state.phase != .running) fueled_input = .{};
    // Throttle and overdrive draw from the same tank, so they are metered
    // together: a part-full tank scales BOTH down by the same fraction rather
    // than letting the dump run on fumes the engine no longer has.
    const boost_rate = driving.effectiveBoost(fueled_input.throttle, fueled_input.boost) * @max(0, sim_tuning.boost_burn_multiplier - 1);
    const requested_burn = (fueled_input.throttle + boost_rate) * vehicle_config.burn_liters_per_second * dt;
    if (requested_burn > 0) {
        const consumed = @min(requested_burn, state.tank_liters);
        state.tank_liters -= consumed;
        const served = consumed / requested_burn;
        fueled_input.throttle *= served;
        fueled_input.boost *= served;
    }
    if (state.tank_liters <= 0) {
        fueled_input.throttle = 0;
        fueled_input.boost = 0;
    }
    const telemetry = driving.step(&state.vehicle, fueled_input, vehicle_config.driving_tuning, dt);
    return .{
        .driving = telemetry,
        .tank_liters = state.tank_liters,
        .bowel_pressure = state.bowel_pressure,
        .durability = state.durability,
        .phase = state.phase,
    };
}
