//! Optional native Fart Racer adapter inside WorldLoader's frame owner.

const std = @import("std");
const build_options = @import("build_options");
const enabled = @hasDecl(build_options, "has_fart_racer") and build_options.has_fart_racer;
const racer = if (enabled) @import("../games/custom/fart-racer/sim.zig") else struct {};
const wire = if (enabled) @import("../games/custom/fart-racer/wire.zig") else struct {};
const application_report = if (enabled) @import("../games/custom/fart-racer/application_report.zig") else struct {};
const player_state = @import("state.zig");
const player_stats = @import("../game/player_stats.zig");
const layout = @import("../layout.zig");
const vehicle_visual = @import("../games/custom/fart-racer/vehicle_visual.zig");

const AudioTelemetryTuning = struct {
    minimum_top_speed_meters_per_second: f32 = 0.001,
};
const AUDIO_TELEMETRY_TUNING = AudioTelemetryTuning{};

const VehicleVisualTuning = struct {
    /// Editor vehicle models use -Z as their semantic front (the same contract
    /// as ambient traffic). Driving heading 0 travels +Z, so the retained mesh
    /// needs this authored-frame conversion before it faces its trajectory.
    facing_offset_degrees: f32 = 180,
};
const VEHICLE_VISUAL_TUNING = VehicleVisualTuning{};

pub const State = if (enabled) struct {
    application: racer.VehicleApplication,
    target: racer.Target,
    race: racer.State,
    markers: wire.MarkerSet,
    marker_inside: [wire.MAX_MARKERS]bool = @splat(false),
    seeded_position: bool = false,
    vehicle_package_id: [160]u8 = @splat(0),
    vehicle_package_id_len: usize = 0,
    eat_events: u32 = 0,
    speaker_events: u32 = 0,
    tank_fill_events: u32 = 0,
    collision_events: u32 = 0,
    skid_events: u32 = 0,
    skid_active: bool = false,
    vehicle_audio_adopted: bool = false,
    food_audio_adopted: bool = false,
    brake_lights_on: bool = false,
    reverse_lights_on: bool = false,
} else struct {};

pub fn init(logic: []const u8) ?State {
    if (!enabled or logic.len == 0) return null;
    const decoded = wire.decode(logic) catch |err| {
        std.log.err("Fart Racer logic stream rejected: {s}", .{@errorName(err)});
        return null;
    };
    const application = racer.applyVehicleBlueprint(
        decoded.vehicle_blueprint,
        decoded.target,
        decoded.vehicle_fallbacks,
    );
    const markers = wire.decodeMarkers(std.heap.c_allocator, decoded.catalog_json) catch |err| {
        std.log.err("Fart Racer marker catalog rejected: {s}", .{@errorName(err)});
        return null;
    };
    const vehicle_package_id = wire.decodeVehiclePackageId(std.heap.c_allocator, decoded.catalog_json) catch |err| {
        std.log.err("Fart Racer vehicle mesh identity rejected: {s}", .{@errorName(err)});
        return null;
    };
    defer std.heap.c_allocator.free(vehicle_package_id);
    const audio_presence = wire.decodeAudioPresence(std.heap.c_allocator, decoded.catalog_json) catch |err| {
        std.log.err("Fart Racer audio blueprint catalog rejected: {s}", .{@errorName(err)});
        return null;
    };
    var state = State{
        .application = application,
        .target = decoded.target,
        .race = racer.State.init(application.config, decoded.target.sim),
        .markers = markers,
        .vehicle_audio_adopted = audio_presence.vehicle,
        .food_audio_adopted = audio_presence.food,
    };
    @memcpy(state.vehicle_package_id[0..vehicle_package_id.len], vehicle_package_id);
    state.vehicle_package_id_len = vehicle_package_id.len;
    return state;
}

/// True means Fart Racer consumed locomotion for this frame. The retained
/// WorldLoader player is the current render/camera proxy for the native car.
pub fn step(
    maybe_state: *?State,
    player: *player_state.PlayerState,
    throttle_axis: f32,
    steer_axis: f32,
    handbrake: bool,
    foot_brake: bool,
    dt_seconds: f32,
) bool {
    if (!enabled) return false;
    const state = if (maybe_state.*) |*value| value else return false;
    if (!state.seeded_position) {
        state.race.vehicle.x = player.x;
        state.race.vehicle.z = player.z;
        state.race.vehicle.heading = player.yaw;
        state.seeded_position = true;
    }
    const before_odometer = state.race.vehicle.odometer;
    const tank_before_step = state.race.tank_liters;
    _ = racer.step(
        &state.race,
        .{
            .throttle = @max(0, throttle_axis),
            .brake = @max(0, -throttle_axis),
            .steer = steer_axis,
            .handbrake = handbrake,
            .foot_brake = foot_brake,
        },
        state.application.config,
        state.target.sim,
        dt_seconds,
    );
    const forward_speed = state.race.vehicle.velocity_x * @sin(state.race.vehicle.heading) +
        state.race.vehicle.velocity_z * @cos(state.race.vehicle.heading);
    const lights = vehicle_visual.lightState(throttle_axis, foot_brake, forward_speed, vehicle_visual.DEFAULT_TUNING);
    state.brake_lights_on = lights.brake;
    state.reverse_lights_on = lights.reverse;
    if (state.race.tank_liters > tank_before_step) state.tank_fill_events +%= 1;
    if (handbrake and !state.skid_active) state.skid_events +%= 1;
    state.skid_active = handbrake;
    player.x = state.race.vehicle.x;
    player.z = state.race.vehicle.z;
    player.vx = state.race.vehicle.velocity_x;
    player.vz = state.race.vehicle.velocity_z;
    player.yaw = state.race.vehicle.heading;
    player.gait_phase += @abs(state.race.vehicle.odometer - before_odometer);
    for (state.markers.rows[0..state.markers.count], 0..) |marker, index| {
        const inside = @abs(state.race.vehicle.x - marker.x) <= marker.half_x and
            @abs(state.race.vehicle.z - marker.z) <= marker.half_z;
        if (inside and !state.marker_inside[index]) switch (marker.kind) {
            .checkpoint => _ = state.race.crossCheckpoint(marker.order),
            .home => _ = state.race.crossHome(state.markers.checkpointCount()),
            .drive_thru => {
                state.speaker_events +%= 1;
                const meal = state.race.eat(marker.food.?, state.target.sim);
                if (meal != .queue_full) state.eat_events +%= 1;
            },
        };
        state.marker_inside[index] = inside;
    }
    return true;
}

pub fn traveledMeters(maybe_state: *const ?State, previous_odometer: f32) f32 {
    if (!enabled) return 0;
    const state = maybe_state.* orelse return 0;
    return @abs(state.race.vehicle.odometer - previous_odometer);
}

pub fn odometer(maybe_state: *const ?State) f32 {
    if (!enabled) return 0;
    const state = maybe_state.* orelse return 0;
    return state.race.vehicle.odometer;
}

pub fn active(maybe_state: *const ?State) bool {
    if (!enabled) return false;
    return maybe_state.* != null;
}

/// Where the race actually begins. Without this the car took the generic loader
/// spawn — a box top chosen from the instance buffer — which on a map with a
/// city in it is some rooftop nowhere near the track. The line and its heading
/// are authored data; the marker catalog answers, the loader only asks.
pub const StartPose = if (enabled) wire.StartPose else struct { x: f32, z: f32, yaw_radians: f32 };

pub fn startPose(maybe_state: *const ?State) ?StartPose {
    if (!enabled) return null;
    const state = if (maybe_state.*) |*value| value else return null;
    return state.markers.startPose();
}

pub fn collisionRadius(maybe_state: *const ?State) f32 {
    if (!enabled) return 0;
    const state = maybe_state.* orelse return 0;
    return state.application.config.driving_tuning.track_width * 0.5;
}

pub fn vehiclePackageId(maybe_state: *const ?State) ?[]const u8 {
    if (!enabled) return null;
    const state = if (maybe_state.*) |*value| value else return null;
    if (state.vehicle_package_id_len == 0) return null;
    return state.vehicle_package_id[0..state.vehicle_package_id_len];
}

pub fn isVehicleMesh(maybe_state: *const ?State, mesh_key: []const u8) bool {
    const package_id = vehiclePackageId(maybe_state) orelse return false;
    return std.mem.startsWith(u8, mesh_key, package_id) and mesh_key.len > package_id.len and mesh_key[package_id.len] == '@';
}

pub const VEHICLE_PART_COUNT = vehicle_visual.PART_COUNT;
pub const VisualPose = vehicle_visual.Pose;

pub fn visualPose(maybe_state: *const ?State, y: f32) ?VisualPose {
    if (!enabled) return null;
    const state = maybe_state.* orelse return null;
    return .{
        .x = state.race.vehicle.x,
        .y = y,
        .z = state.race.vehicle.z,
        .yaw_degrees = state.race.vehicle.heading * 180.0 / std.math.pi + VEHICLE_VISUAL_TUNING.facing_offset_degrees,
        .pitch_degrees = state.race.vehicle.pitch * 180.0 / std.math.pi,
        .roll_degrees = state.race.vehicle.roll * 180.0 / std.math.pi,
        .front_steer_degrees = state.race.vehicle.steer * 180.0 / std.math.pi,
        .wheel_roll_degrees = vehicle_visual.wheelRollDegrees(state.race.vehicle.odometer, vehicle_visual.DEFAULT_TUNING),
        .brake_lights_on = state.brake_lights_on,
        .reverse_lights_on = state.reverse_lights_on,
    };
}

pub fn updateVehiclePartNode(node: *layout.Node, part_index: usize, center: [3]f32, pose: VisualPose) void {
    if (part_index >= VEHICLE_PART_COUNT) return;
    const transform = vehicle_visual.partTransform(part_index, center, pose, vehicle_visual.DEFAULT_TUNING);
    node.scene3d_pos_x = transform.x;
    node.scene3d_pos_y = transform.y;
    node.scene3d_pos_z = transform.z;
    node.scene3d_rot_x = transform.rot_x;
    node.scene3d_rot_y = transform.rot_y;
    node.scene3d_rot_z = transform.rot_z;
    node.scene3d_color_r = transform.brightness;
    node.scene3d_color_g = transform.brightness;
    node.scene3d_color_b = transform.brightness;
}

/// Commit a continuous world sweep back into the authoritative race state.
/// The sweep fraction trims attempted travel/odometer, the contact normal
/// reflects only velocity entering the wall, and the same impact feeds the
/// package-derived durability/fuel leak loop.
pub fn applyWorldCollision(
    maybe_state: *?State,
    player: *player_state.PlayerState,
    from_x: f32,
    from_z: f32,
    attempted_x: f32,
    attempted_z: f32,
    normal_x: f32,
    normal_z: f32,
    fraction: f32,
    restitution: f32,
    prior_odometer: f32,
) f32 {
    if (!enabled) return 0;
    const state = if (maybe_state.*) |*value| value else return 0;
    const contact_fraction = std.math.clamp(fraction, 0, 1);
    state.race.vehicle.x = from_x + (attempted_x - from_x) * contact_fraction;
    state.race.vehicle.z = from_z + (attempted_z - from_z) * contact_fraction;
    state.race.vehicle.odometer = prior_odometer + (state.race.vehicle.odometer - prior_odometer) * contact_fraction;
    const into = state.race.vehicle.velocity_x * normal_x + state.race.vehicle.velocity_z * normal_z;
    const impact = @max(0, -into);
    if (into < 0) {
        const bounce = 1 + std.math.clamp(restitution, 0, 1);
        state.race.vehicle.velocity_x -= bounce * into * normal_x;
        state.race.vehicle.velocity_z -= bounce * into * normal_z;
    }
    const damage = state.race.collide(impact, state.application.config, state.target.sim);
    if (damage > 0) state.collision_events +%= 1;
    player.x = state.race.vehicle.x;
    player.z = state.race.vehicle.z;
    player.vx = state.race.vehicle.velocity_x;
    player.vz = state.race.vehicle.velocity_z;
    return damage;
}

pub fn telemetryAlloc(maybe_state: *const ?State, world_id: u32, allocator: std.mem.Allocator) !?[]u8 {
    if (!enabled) return null;
    const state = maybe_state.* orelse return null;
    const speed = @sqrt(
        state.race.vehicle.velocity_x * state.race.vehicle.velocity_x +
            state.race.vehicle.velocity_z * state.race.vehicle.velocity_z,
    );
    return try std.json.Stringify.valueAlloc(allocator, .{
        .version = 1,
        .game = "fart-racer",
        .phase = @tagName(state.race.phase),
        .tankLiters = state.race.tank_liters,
        .tankCapacityLiters = state.application.config.tank_capacity_liters,
        .bowelPressure = state.race.bowel_pressure,
        .bowelCapacity = state.target.sim.bowel_capacity,
        .durability = state.race.durability,
        .durabilityCapacity = state.application.config.durability_capacity,
        .nextCheckpoint = state.race.next_checkpoint,
        .checkpointCount = state.markers.checkpointCount(),
        .elapsedSeconds = state.race.elapsed_seconds,
        .speedMetersPerSecond = speed,
        .digestionCount = state.race.digestion_count,
        .worldId = world_id,
        .rpmNormalized = std.math.clamp(
            speed / @max(
                AUDIO_TELEMETRY_TUNING.minimum_top_speed_meters_per_second,
                state.application.config.driving_tuning.top_speed,
            ),
            0,
            1,
        ),
        .eatEvents = state.eat_events,
        .speakerEvents = state.speaker_events,
        .tankFillEvents = state.tank_fill_events,
        .collisionEvents = state.collision_events,
        .skidEvents = state.skid_events,
    }, .{});
}

/// The compiled consumer reports every field it touched. When Fart Racer is
/// inactive this returns null so ordinary WorldLoader keeps its player-stats
/// report unchanged; when active both consumers share one queryable report.
pub fn applicationReportAlloc(
    maybe_state: *const ?State,
    stats: *const player_stats.State,
    allocator: std.mem.Allocator,
) !?[]u8 {
    if (!enabled) return null;
    const state = maybe_state.* orelse return null;
    return try application_report.alloc(
        &state.application,
        state.vehicle_audio_adopted,
        state.food_audio_adopted,
        &player_stats.FIELD_NAMES,
        stats.authored_config,
        allocator,
    );
}
