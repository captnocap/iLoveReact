//! Headless acceptance mode compiled into the exported Fart Racer binary.
//!
//! `./fart-racer --fart-racer-headless [--laps N]` reads the packaged
//! game.gamefile, applies every authored vehicle blueprint through the compiled
//! adapter, runs the native driver bot, and exits non-zero on contract drift.

const std = @import("std");
const gamefile = @import("../../../world/gamefile.zig");
const sim = @import("sim.zig");
const wire = @import("wire.zig");

const MAX_CARS: usize = 64;
const HarnessLimits = struct {
    /// The race the WORLD declares: one closed circuit, checkpoints in order,
    /// home line at the end. Three laps was a parameter from a 700 m track; on
    /// a 1.16 km circuit it exceeds the bowel budget by design — a car cannot
    /// survive it without soiling — so a three-lap gate would assert something
    /// the game does not claim. `--laps N` remains, for stress runs.
    default_laps: u32 = 1,
    maximum_laps: u32 = 32,
    maximum_steps: usize = 2_000_000,
    minimum_track_meters: f32 = 10,
    /// Tank level, in seconds of full-throttle burn, at which the bot pulls in.
    refuel_seconds_of_burn: f32 = 4,
};
const LIMITS = HarnessLimits{};

const Car = struct {
    id: []const u8,
    blueprint: sim.VehicleBlueprint,
};
const Result = struct {
    id: []const u8,
    top_speed_rating: f32,
    acceleration_rating: f32,
    engine_power: f32,
    tank_capacity: f32,
    elapsed_seconds: f32,
};

pub fn requested(args: []const []const u8) bool {
    for (args[1..]) |arg| if (std.mem.eql(u8, arg, "--fart-racer-headless")) return true;
    return false;
}

fn object(value: ?std.json.Value) ?std.json.ObjectMap {
    return switch (value orelse return null) {
        .object => |map| map,
        else => null,
    };
}
fn array(value: ?std.json.Value) ?[]const std.json.Value {
    return switch (value orelse return null) {
        .array => |items| items.items,
        else => null,
    };
}
fn string(value: ?std.json.Value) ?[]const u8 {
    return switch (value orelse return null) {
        .string => |text| text,
        else => null,
    };
}
fn number(value: ?std.json.Value) ?f32 {
    const resolved: f64 = switch (value orelse return null) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| float,
        else => return null,
    };
    return if (std.math.isFinite(resolved)) @floatCast(resolved) else null;
}

fn profileId(attachment: std.json.ObjectMap) ?[]const u8 {
    const profile = object(attachment.get("profile")) orelse return null;
    return string(profile.get("id"));
}

fn documentScoped(attachment: std.json.ObjectMap) bool {
    const scope = object(attachment.get("scope")) orelse return false;
    return std.mem.eql(u8, string(scope.get("kind")) orelse return false, "document");
}

fn parseVehicleBlueprint(value: std.json.Value) ?sim.VehicleBlueprint {
    const blueprint = object(value) orelse return null;
    const attachments = array(blueprint.get("stats")) orelse return null;
    var result = sim.VehicleBlueprint{};
    var found_vehicle = false;
    for (attachments) |attachment_value| {
        const attachment = object(attachment_value) orelse continue;
        if (!documentScoped(attachment)) continue;
        const profile = profileId(attachment) orelse continue;
        if (std.mem.eql(u8, profile, "rj.profile.vehicle")) {
            found_vehicle = true;
            result.drive_rating = number(attachment.get("driveRating"));
            result.grip_rating = number(attachment.get("gripRating"));
            result.handling_rating = number(attachment.get("handlingRating"));
            result.top_speed_rating = number(attachment.get("topSpeedRating"));
            result.acceleration_rating = number(attachment.get("accelerationRating"));
        } else if (std.mem.eql(u8, profile, "rj.core.item")) {
            result.durability_capacity = number(attachment.get("durabilityCapacity"));
        }
    }
    const extensions = object(blueprint.get("extensions"));
    const vendor = if (extensions) |rows| object(rows.get("com.captnocap.fartracer")) else null;
    if (vendor) |fields| {
        result.tank_capacity_liters = number(fields.get("tankCapacityL"));
        result.burn_liters_per_second = number(fields.get("burnRatePerSec"));
        result.fill_efficiency = number(fields.get("fillEfficiency"));
        result.leak_liters_per_damage_second = number(fields.get("leakRatePerDamage"));
    }
    return if (found_vehicle) result else null;
}

fn carsFromCatalog(root: std.json.ObjectMap, out: *[MAX_CARS]Car) !usize {
    const entries = array(root.get("blueprints")) orelse return error.MissingVehicleBlueprints;
    var count: usize = 0;
    for (entries) |entry_value| {
        const entry = object(entry_value) orelse continue;
        const blueprint_value = entry.get("blueprint") orelse continue;
        const blueprint = parseVehicleBlueprint(blueprint_value) orelse continue;
        if (count >= out.len) return error.TooManyVehicleBlueprints;
        out[count] = .{
            .id = string(entry.get("packageId")) orelse return error.MissingVehicleId,
            .blueprint = blueprint,
        };
        count += 1;
    }
    if (count == 0) return error.MissingVehicleBlueprints;
    return count;
}

fn trackLengthFromCatalog(root: std.json.ObjectMap) !f32 {
    const markers = array(root.get("markers")) orelse return error.MissingTrackLength;
    for (markers) |marker_value| {
        const marker = object(marker_value) orelse continue;
        const trigger = object(marker.get("trigger")) orelse continue;
        const event = object(trigger.get("event")) orelse continue;
        if (!std.mem.eql(u8, string(event.get("tag")) orelse continue, "race.home")) continue;
        const source = object(marker.get("sourcePath")) orelse continue;
        const length = number(source.get("trackLengthM")) orelse continue;
        if (length >= LIMITS.minimum_track_meters) return length;
    }
    return error.MissingTrackLength;
}

fn lapsFromArgs(args: []const []const u8) !u32 {
    for (args, 0..) |arg, index| {
        if (!std.mem.eql(u8, arg, "--laps")) continue;
        if (index + 1 >= args.len) return error.BadLapCount;
        const laps = std.fmt.parseInt(u32, args[index + 1], 10) catch return error.BadLapCount;
        if (laps == 0 or laps > LIMITS.maximum_laps) return error.BadLapCount;
        return laps;
    }
    return LIMITS.default_laps;
}

fn runCar(car: Car, decoded: wire.Decoded, track_meters: f32, laps: u32, meal: sim.FoodBlueprint) !Result {
    const application = sim.applyVehicleBlueprint(car.blueprint, decoded.target, decoded.vehicle_fallbacks);
    var state = sim.State.init(application.config, decoded.target.sim);
    const target_distance = track_meters * @as(f32, @floatFromInt(laps));
    const dt = decoded.target.sim.maximum_step_seconds;
    // The bot PLAYS THE GAME: it stops at the drive-thru when the tank runs
    // low, which is the loop the whole design is built on. A bot that only ever
    // holds the throttle finishes a long lap by coasting the last kilometre at
    // millimetres per second — the lap times it reports then measure a
    // roll-down, not a car, and a longer track times the harness out.
    const refuel_threshold = application.config.burn_liters_per_second * LIMITS.refuel_seconds_of_burn;
    var steps: usize = 0;
    while (state.vehicle.odometer < target_distance and state.phase == .running and steps < LIMITS.maximum_steps) : (steps += 1) {
        if (state.tank_liters < refuel_threshold and state.digestion_count == 0) {
            // Refuse the meal that would soil rather than eat it: losing IS a
            // legal outcome of the loop, but it is not this contract's subject.
            if (state.bowel_pressure + meal.bowel_load < decoded.target.sim.bowel_capacity) {
                _ = state.eat(meal, decoded.target.sim);
            }
        }
        _ = sim.step(&state, .{ .throttle = 1 }, application.config, decoded.target.sim, dt);
    }
    if (steps >= LIMITS.maximum_steps or state.phase != .running) return error.DriverBotDidNotFinish;
    return .{
        .id = car.id,
        .top_speed_rating = car.blueprint.top_speed_rating orelse decoded.target.rating_fallbacks.top_speed,
        .acceleration_rating = car.blueprint.acceleration_rating orelse decoded.target.rating_fallbacks.acceleration,
        .engine_power = application.config.driving_tuning.engine_power,
        .tank_capacity = application.config.tank_capacity_liters,
        .elapsed_seconds = state.elapsed_seconds,
    };
}

fn expectedLessThan(_: void, a: Result, b: Result) bool {
    if (a.top_speed_rating != b.top_speed_rating) return a.top_speed_rating < b.top_speed_rating;
    return a.acceleration_rating < b.acceleration_rating;
}

fn driveThruFood(markers: *const wire.MarkerSet) !sim.FoodBlueprint {
    for (markers.rows[0..markers.count]) |marker| {
        if (marker.kind == .drive_thru) return marker.food orelse error.MissingDriveThruFood;
    }
    return error.MissingDriveThruFood;
}

fn proveFailureLoop(decoded: wire.Decoded, track_meters: f32, markers: *const wire.MarkerSet) !void {
    const application = sim.applyVehicleBlueprint(decoded.vehicle_blueprint, decoded.target, decoded.vehicle_fallbacks);
    var dry = sim.State.init(application.config, decoded.target.sim);
    dry.tank_liters = application.config.burn_liters_per_second * decoded.target.sim.maximum_step_seconds;
    var steps: usize = 0;
    while (dry.tank_liters > 0 and steps < LIMITS.maximum_steps) : (steps += 1) {
        _ = sim.step(&dry, .{ .throttle = 1 }, application.config, decoded.target.sim, decoded.target.sim.maximum_step_seconds);
    }
    if (dry.tank_liters != 0 or dry.vehicle.odometer >= track_meters) return error.DryCarReachedHome;

    const meal = try driveThruFood(markers);
    var fueled = sim.State.init(application.config, decoded.target.sim);
    fueled.tank_liters = 0;
    if (fueled.eat(meal, decoded.target.sim) != .queued) return error.DriveThruMealDidNotQueue;
    var digest_steps: usize = 0;
    while (fueled.digestion_count > 0 and digest_steps < LIMITS.maximum_steps) : (digest_steps += 1) {
        _ = sim.step(&fueled, .{}, application.config, decoded.target.sim, decoded.target.sim.maximum_step_seconds);
    }
    if (fueled.tank_liters <= 0) return error.DriveThruMealDidNotFuel;

    var soiled = sim.State.init(application.config, decoded.target.sim);
    var meals: usize = 0;
    while (soiled.phase == .running and meals < sim.MAX_DIGESTION_QUEUE) : (meals += 1) {
        _ = soiled.eat(meal, decoded.target.sim);
    }
    if (soiled.phase != .soiled or soiled.crossHome(0)) return error.OvereatDidNotLose;
}

pub fn run(io: std.Io, args: []const []const u8) !void {
    const allocator = std.heap.c_allocator;
    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, "game.gamefile", allocator, .limited(256 << 20));
    defer allocator.free(bytes);
    const file = try gamefile.readGameFile(allocator, bytes);
    defer file.deinit(allocator);
    const decoded = try wire.decode(file.logic.data);
    const markers = try wire.decodeMarkers(allocator, decoded.catalog_json);
    if (markers.checkpointCount() < 3) return error.NotEnoughCheckpoints;

    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, decoded.catalog_json, .{});
    defer parsed.deinit();
    const root = object(parsed.value) orelse return error.BadCatalog;
    const track_meters = try trackLengthFromCatalog(root);
    const laps = try lapsFromArgs(args);
    var cars: [MAX_CARS]Car = undefined;
    const car_count = try carsFromCatalog(root, &cars);
    if (car_count < 2) return error.NotEnoughVehicleBlueprints;
    const meal = try driveThruFood(&markers);
    var results: [MAX_CARS]Result = undefined;
    for (cars[0..car_count], 0..) |car, index| results[index] = try runCar(car, decoded, track_meters, laps, meal);
    std.mem.sort(Result, results[0..car_count], {}, expectedLessThan);
    var index: usize = 1;
    while (index < car_count) : (index += 1) {
        if (!(results[index - 1].elapsed_seconds > results[index].elapsed_seconds)) return error.LapOrderingMismatch;
    }
    try proveFailureLoop(decoded, track_meters, &markers);
    for (results[0..car_count]) |result| std.debug.print(
        "[fart-racer-acceptance] CAR {s} top={d:.3} accel={d:.3} engine={d:.3} tank={d:.3} time={d:.3}s\n",
        .{ result.id, result.top_speed_rating, result.acceleration_rating, result.engine_power, result.tank_capacity, result.elapsed_seconds },
    );
    std.debug.print(
        "FART RACER HEADLESS PASS — {d} cars × {d} laps on {d:.1}m; ordering, dry-tank, authored drive-thru fuel, and overeat contracts green\n",
        .{ car_count, laps, track_meters },
    );
}
