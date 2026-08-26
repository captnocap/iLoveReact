//! Decoder for the Fart Racer logic stream emitted by the editor exporter.
//!
//! The numeric prefix is fixed and strictly validated. The trailing JSON is
//! borrowed opaque declarative catalog data; this module never evaluates it.

const std = @import("std");
const sim = @import("sim.zig");

pub const MAGIC: u32 = 0x31524746;
pub const VERSION: u32 = 1;
pub const NUMBER_COUNT: usize = 78;
pub const MAX_MARKERS: usize = 256;

pub const Decoded = struct {
    target: sim.Target,
    vehicle_fallbacks: sim.VehicleFallbacks,
    vehicle_blueprint: sim.VehicleBlueprint,
    catalog_json: []const u8,
};

pub const Error = error{
    Truncated,
    BadMagic,
    UnsupportedVersion,
    BadNumberCount,
    NonFinite,
    BadPresence,
};

pub const MarkerKind = enum { checkpoint, home, drive_thru };
pub const Marker = struct {
    kind: MarkerKind,
    order: u32 = 0,
    x: f32,
    y: f32,
    z: f32,
    half_x: f32,
    half_y: f32,
    half_z: f32,
    food: ?sim.FoodBlueprint = null,
};
pub const StartPose = struct { x: f32, z: f32, yaw_radians: f32 };

pub const MarkerSet = struct {
    rows: [MAX_MARKERS]Marker = undefined,
    count: usize = 0,

    /// Where the race begins: the authored HOME line, aimed at the first
    /// checkpoint. Heading 0 travels +Z, matching the driving model's frame.
    /// Null when the catalog declares no home line.
    pub fn startPose(self: *const MarkerSet) ?StartPose {
        var home: ?Marker = null;
        var first: ?Marker = null;
        for (self.rows[0..self.count]) |marker| switch (marker.kind) {
            .home => home = marker,
            .checkpoint => if (first == null or marker.order < first.?.order) {
                first = marker;
            },
            else => {},
        };
        const line = home orelse return null;
        const aim = first orelse return .{ .x = line.x, .z = line.z, .yaw_radians = 0 };
        return .{
            .x = line.x,
            .z = line.z,
            .yaw_radians = std.math.atan2(aim.x - line.x, aim.z - line.z),
        };
    }

    pub fn checkpointCount(self: *const MarkerSet) u32 {
        var count: u32 = 0;
        for (self.rows[0..self.count]) |marker| if (marker.kind == .checkpoint) {
            count += 1;
        };
        return count;
    }
};

pub const AudioPresence = struct {
    vehicle: bool = false,
    food: bool = false,
};

const MarkerPositionWire = struct { x: f32, y: f32, z: f32 };
const MarkerBoundsWire = struct { halfX: f32, halfY: f32, halfZ: f32 };
const MarkerEventWire = struct { tag: []const u8, order: ?u32 = null, sourceId: ?[]const u8 = null };
const MarkerTriggerWire = struct { bounds: MarkerBoundsWire, event: MarkerEventWire };
const MarkerSourceWire = struct { pathId: u32, distanceM: f32, trackLengthM: ?f32 = null };
const MarkerWire = struct {
    id: []const u8,
    name: []const u8,
    kind: []const u8,
    position: MarkerPositionWire,
    trigger: MarkerTriggerWire,
    sourcePath: ?MarkerSourceWire = null,
};
const FoodExtensionWire = struct {
    gasYieldL: ?f32 = null,
    digestSeconds: ?f32 = null,
    bowelLoad: ?f32 = null,
};
const BlueprintExtensionsWire = struct {
    @"com.captnocap.fartracer": ?FoodExtensionWire = null,
};
const BlueprintTableWire = struct {
    extensions: ?BlueprintExtensionsWire = null,
};
const BlueprintWire = struct {
    packageId: []const u8,
    blueprint: BlueprintTableWire,
};
const CatalogWire = struct {
    version: u32,
    vehiclePackageId: ?[]const u8 = null,
    vehicleVisualPackageId: ?[]const u8 = null,
    blueprints: []const BlueprintWire,
    markers: []const MarkerWire,
};

pub fn decodeVehiclePackageId(allocator: std.mem.Allocator, catalog_json: []const u8) ![]u8 {
    var parsed = try std.json.parseFromSlice(CatalogWire, allocator, catalog_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();
    if (parsed.value.version != 1) return error.UnsupportedVersion;
    const id = parsed.value.vehicleVisualPackageId orelse parsed.value.vehiclePackageId orelse return error.BadPresence;
    if (id.len == 0 or id.len > 160) return error.BadPresence;
    return allocator.dupe(u8, id);
}

fn stringField(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    return if (value == .string) value.string else null;
}

fn blueprintHasEvents(root: std.json.Value, package_id: []const u8, required: []const []const u8) bool {
    const blueprints = if (root == .object) root.object.get("blueprints") orelse return false else return false;
    if (blueprints != .array) return false;
    for (blueprints.array.items) |entry| {
        if (entry != .object or !std.mem.eql(u8, stringField(entry.object, "packageId") orelse continue, package_id)) continue;
        const blueprint = entry.object.get("blueprint") orelse return false;
        if (blueprint != .object) return false;
        const stats = blueprint.object.get("stats") orelse return false;
        if (stats != .array) return false;
        for (stats.array.items) |attachment| {
            if (attachment != .object) continue;
            const profile = attachment.object.get("profile") orelse continue;
            if (profile != .object or !std.mem.eql(u8, stringField(profile.object, "id") orelse continue, "rj.core.audio")) continue;
            const events = attachment.object.get("events") orelse continue;
            if (events != .object) continue;
            var complete = true;
            for (required) |tag| if (events.object.get(tag) == null) {
                complete = false;
                break;
            };
            if (complete) return true;
        }
        return false;
    }
    return false;
}

/// Strict projection used only for the compiled application report. Playback
/// still consumes the exporter-authored audio manifest; this proves which
/// blueprint packages supplied the event vocabularies that manifest adopted.
pub fn decodeAudioPresence(allocator: std.mem.Allocator, catalog_json: []const u8) !AudioPresence {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, catalog_json, .{});
    defer parsed.deinit();
    const root = parsed.value;
    if (root != .object) return error.BadPresence;
    const vehicle_id = stringField(root.object, "vehiclePackageId") orelse return error.BadPresence;
    const vehicle_events = [_][]const u8{ "vehicle.engine", "vehicle.skid", "impact.body", "vehicle.tankFill" };
    const food_events = [_][]const u8{ "item.eat", "driveThru.speaker" };
    var result = AudioPresence{ .vehicle = blueprintHasEvents(root, vehicle_id, &vehicle_events), .food = true };
    const markers = root.object.get("markers") orelse return error.BadPresence;
    if (markers != .array) return error.BadPresence;
    var drive_thrus: usize = 0;
    for (markers.array.items) |marker| {
        if (marker != .object) continue;
        const trigger = marker.object.get("trigger") orelse continue;
        if (trigger != .object) continue;
        const event = trigger.object.get("event") orelse continue;
        if (event != .object or !std.mem.eql(u8, stringField(event.object, "tag") orelse continue, "race.driveThru")) continue;
        drive_thrus += 1;
        const source_id = stringField(event.object, "sourceId") orelse {
            result.food = false;
            continue;
        };
        if (!blueprintHasEvents(root, source_id, &food_events)) result.food = false;
    }
    if (drive_thrus == 0) result.food = false;
    return result;
}

fn foodForSource(catalog: *const CatalogWire, source_id: []const u8) !sim.FoodBlueprint {
    if (source_id.len == 0) return error.BadPresence;
    for (catalog.blueprints) |entry| {
        if (!std.mem.eql(u8, entry.packageId, source_id)) continue;
        const extensions = entry.blueprint.extensions orelse return error.BadPresence;
        const food = extensions.@"com.captnocap.fartracer" orelse return error.BadPresence;
        const gas = food.gasYieldL orelse return error.BadPresence;
        const digest = food.digestSeconds orelse return error.BadPresence;
        const bowel = food.bowelLoad orelse return error.BadPresence;
        for ([_]f32{ gas, digest, bowel }) |value| {
            if (!std.math.isFinite(value)) return error.NonFinite;
            if (value < 0) return error.BadPresence;
        }
        return .{ .gas_yield_liters = gas, .digest_seconds = digest, .bowel_load = bowel };
    }
    return error.BadPresence;
}

/// Parse only the strict marker projection from the declarative catalog. All
/// unrelated target/blueprint keys are ignored as inert data; no value is ever
/// dispatched or evaluated.
pub fn decodeMarkers(allocator: std.mem.Allocator, catalog_json: []const u8) !MarkerSet {
    var parsed = try std.json.parseFromSlice(CatalogWire, allocator, catalog_json, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();
    if (parsed.value.version != 1 or parsed.value.markers.len > MAX_MARKERS) return error.BadNumberCount;
    var result = MarkerSet{};
    for (parsed.value.markers) |source| {
        if (!std.mem.eql(u8, source.kind, "trigger") or source.id.len == 0 or source.name.len == 0) return error.BadPresence;
        const kind: MarkerKind = if (std.mem.eql(u8, source.trigger.event.tag, "race.checkpoint"))
            .checkpoint
        else if (std.mem.eql(u8, source.trigger.event.tag, "race.home"))
            .home
        else if (std.mem.eql(u8, source.trigger.event.tag, "race.driveThru"))
            .drive_thru
        else
            continue;
        const values = [_]f32{
            source.position.x,           source.position.y,           source.position.z,
            source.trigger.bounds.halfX, source.trigger.bounds.halfY, source.trigger.bounds.halfZ,
        };
        for (values) |value| if (!std.math.isFinite(value)) return error.NonFinite;
        if (values[3] <= 0 or values[4] <= 0 or values[5] <= 0) return error.BadPresence;
        if (kind == .checkpoint and source.trigger.event.order == null) return error.BadPresence;
        if (kind != .checkpoint and source.trigger.event.order != null) return error.BadPresence;
        if (kind == .drive_thru and source.trigger.event.sourceId == null) return error.BadPresence;
        if (kind != .drive_thru and source.trigger.event.sourceId != null) return error.BadPresence;
        result.rows[result.count] = .{
            .kind = kind,
            .order = source.trigger.event.order orelse 0,
            .x = values[0],
            .y = values[1],
            .z = values[2],
            .half_x = values[3],
            .half_y = values[4],
            .half_z = values[5],
            .food = if (kind == .drive_thru)
                try foodForSource(&parsed.value, source.trigger.event.sourceId.?)
            else
                null,
        };
        result.count += 1;
    }
    return result;
}

const Reader = struct {
    values: []const u8,
    index: usize = 0,

    fn number(self: *Reader) Error!f32 {
        if (self.index * 4 + 4 > self.values.len) return error.Truncated;
        const at = self.index * 4;
        self.index += 1;
        const value: f32 = @bitCast(std.mem.readInt(u32, self.values[at..][0..4], .little));
        if (!std.math.isFinite(value)) return error.NonFinite;
        return value;
    }

    fn range(self: *Reader) Error!sim.Range {
        const minimum = try self.number();
        const maximum = try self.number();
        if (maximum < minimum) return error.NonFinite;
        return .{ .minimum = minimum, .maximum = maximum };
    }

    fn optional(self: *Reader) Error!?f32 {
        const present = try self.number();
        const value = try self.number();
        if (present == 0) return null;
        if (present != 1) return error.BadPresence;
        return value;
    }
};

pub fn decode(bytes: []const u8) Error!Decoded {
    if (bytes.len < 16) return error.Truncated;
    if (std.mem.readInt(u32, bytes[0..4], .little) != MAGIC) return error.BadMagic;
    if (std.mem.readInt(u32, bytes[4..8], .little) != VERSION) return error.UnsupportedVersion;
    const number_count: usize = @intCast(std.mem.readInt(u32, bytes[8..12], .little));
    if (number_count != NUMBER_COUNT) return error.BadNumberCount;
    const catalog_length: usize = @intCast(std.mem.readInt(u32, bytes[12..16], .little));
    const numbers_end = 16 + number_count * 4;
    if (numbers_end > bytes.len or catalog_length > bytes.len - numbers_end) return error.Truncated;
    var reader = Reader{ .values = bytes[16..numbers_end] };
    const target = sim.Target{
        .rating_fallbacks = .{
            .drive = try reader.number(),
            .grip = try reader.number(),
            .handling = try reader.number(),
            .top_speed = try reader.number(),
            .acceleration = try reader.number(),
        },
        .driving_bands = .{
            .engine_power = try reader.range(),
            .brake_power = try reader.range(),
            .reverse_power = try reader.range(),
            .top_speed = try reader.range(),
            .reverse_top_speed = try reader.range(),
            .drag = try reader.range(),
            .roll_resist = try reader.range(),
            .max_steer = try reader.range(),
            .steer_speed = try reader.range(),
            .grip = try reader.range(),
            .handbrake_grip = try reader.range(),
            .max_lateral_g = try reader.range(),
            .cornering_drag = try reader.range(),
            .roll_lean_gain = try reader.range(),
            .max_lean = try reader.range(),
            .roll_ease = try reader.range(),
            .center_of_gravity_height = try reader.range(),
            .rollover_gravity = try reader.range(),
            .roll_damping = try reader.range(),
            .pitch_gain = try reader.range(),
            .wheel_base = try reader.number(),
            .track_width = try reader.number(),
        },
        .sim = .{
            .initial_tank_ratio = try reader.number(),
            .bowel_capacity = try reader.number(),
            .minimum_collision_impulse = try reader.number(),
            .collision_damage_per_impulse = try reader.number(),
            .maximum_step_seconds = try reader.number(),
            .boost_burn_multiplier = 0, // appended at the tape's tail; read below
        },
    };
    const vehicle_fallbacks = sim.VehicleFallbacks{
        .durability_capacity = try reader.number(),
        .tank_capacity_liters = try reader.number(),
        .burn_liters_per_second = try reader.number(),
        .fill_efficiency = try reader.number(),
        .leak_liters_per_damage_second = try reader.number(),
    };
    const vehicle_blueprint = sim.VehicleBlueprint{
        .drive_rating = try reader.optional(),
        .grip_rating = try reader.optional(),
        .handling_rating = try reader.optional(),
        .top_speed_rating = try reader.optional(),
        .acceleration_rating = try reader.optional(),
        .durability_capacity = try reader.optional(),
        .tank_capacity_liters = try reader.optional(),
        .burn_liters_per_second = try reader.optional(),
        .fill_efficiency = try reader.optional(),
        .leak_liters_per_damage_second = try reader.optional(),
    };
    // Tail appendix: numbers added after v1 shipped live HERE, so every slot
    // above keeps the position it has always had.
    var tail_target = target;
    tail_target.sim.boost_burn_multiplier = try reader.number();
    if (reader.index != NUMBER_COUNT) return error.BadNumberCount;
    return .{
        .target = tail_target,
        .vehicle_fallbacks = vehicle_fallbacks,
        .vehicle_blueprint = vehicle_blueprint,
        .catalog_json = bytes[numbers_end .. numbers_end + catalog_length],
    };
}
