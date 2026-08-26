//! Strict decoder tests for the editor-emitted Fart Racer logic stream.
//!
//! Run: zig build test-fart-racer-wire

const std = @import("std");
const testing = std.testing;
const wire = @import("fart_racer_wire");

const CATALOG = "{\"version\":1}";
const BYTE_COUNT = 16 + wire.NUMBER_COUNT * 4 + CATALOG.len;

fn writeNumber(bytes: []u8, index: usize, value: f32) void {
    std.mem.writeInt(u32, bytes[16 + index * 4 ..][0..4], @bitCast(value), .little);
}

fn validTape() [BYTE_COUNT]u8 {
    var bytes: [BYTE_COUNT]u8 = @splat(0);
    std.mem.writeInt(u32, bytes[0..4], wire.MAGIC, .little);
    std.mem.writeInt(u32, bytes[4..8], wire.VERSION, .little);
    std.mem.writeInt(u32, bytes[8..12], wire.NUMBER_COUNT, .little);
    std.mem.writeInt(u32, bytes[12..16], CATALOG.len, .little);
    @memcpy(bytes[16 + wire.NUMBER_COUNT * 4 ..], CATALOG);
    return bytes;
}

test "fixed numeric prefix and trailing declarative catalog decode together" {
    var bytes = validTape();
    writeNumber(&bytes, 0, 0.25);
    writeNumber(&bytes, 45, 2.7);
    writeNumber(&bytes, 46, 1.85);
    writeNumber(&bytes, 57, 1);
    writeNumber(&bytes, 58, 0.75);
    writeNumber(&bytes, wire.NUMBER_COUNT - 1, 4);
    const decoded = try wire.decode(&bytes);
    try testing.expectApproxEqAbs(@as(f32, 0.25), decoded.target.rating_fallbacks.drive, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 2.7), decoded.target.driving_bands.wheel_base, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0.75), decoded.vehicle_blueprint.drive_rating.?, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 4), decoded.target.sim.boost_burn_multiplier, 1e-6);
    try testing.expectEqualStrings(CATALOG, decoded.catalog_json);
}

test "wire rejects wrong count, non-finite values, bad presence, and truncation" {
    var wrong_count = validTape();
    std.mem.writeInt(u32, wrong_count[8..12], wire.NUMBER_COUNT - 1, .little);
    try testing.expectError(error.BadNumberCount, wire.decode(&wrong_count));

    var non_finite = validTape();
    writeNumber(&non_finite, 0, std.math.nan(f32));
    try testing.expectError(error.NonFinite, wire.decode(&non_finite));

    var bad_presence = validTape();
    writeNumber(&bad_presence, 57, 2);
    try testing.expectError(error.BadPresence, wire.decode(&bad_presence));

    const truncated = validTape();
    try testing.expectError(error.Truncated, wire.decode(truncated[0 .. truncated.len - 1]));
}

test "declarative marker catalog becomes typed race triggers and ignores unrelated keys" {
    const json =
        \\{"version":1,"target":{"id":"fart-racer"},"blueprints":[
        \\{"packageId":"food:burrito","blueprint":{"extensions":{"com.captnocap.fartracer":{"gasYieldL":12,"digestSeconds":3,"bowelLoad":18}}}}
        \\],"markers":[
        \\{"id":"home","name":"Home","kind":"trigger","position":{"x":1,"y":0,"z":2},"trigger":{"bounds":{"halfX":6,"halfY":3,"halfZ":2.5},"event":{"tag":"race.home"}}},
        \\{"id":"cp0","name":"Checkpoint 1","kind":"trigger","position":{"x":10,"y":0,"z":2},"trigger":{"bounds":{"halfX":5,"halfY":2.5,"halfZ":2},"event":{"tag":"race.checkpoint","order":0}},"sourcePath":{"pathId":7,"distanceM":10}},
        \\{"id":"food","name":"Drive-Thru","kind":"trigger","position":{"x":5,"y":0,"z":4},"trigger":{"bounds":{"halfX":4,"halfY":2.5,"halfZ":4},"event":{"tag":"race.driveThru","sourceId":"food:burrito"}}},
        \\{"id":"vendor","name":"Opaque","kind":"trigger","position":{"x":0,"y":0,"z":0},"trigger":{"bounds":{"halfX":1,"halfY":1,"halfZ":1},"event":{"tag":"com.vendor.event"}}}
        \\]}
    ;
    const markers = try wire.decodeMarkers(testing.allocator, json);
    try testing.expectEqual(@as(usize, 3), markers.count);
    try testing.expectEqual(@as(u32, 1), markers.checkpointCount());
    try testing.expectEqual(wire.MarkerKind.home, markers.rows[0].kind);
    try testing.expectEqual(wire.MarkerKind.checkpoint, markers.rows[1].kind);
    try testing.expectEqual(@as(u32, 0), markers.rows[1].order);
    try testing.expectEqual(wire.MarkerKind.drive_thru, markers.rows[2].kind);
    try testing.expectApproxEqAbs(@as(f32, 12), markers.rows[2].food.?.gas_yield_liters, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 3), markers.rows[2].food.?.digest_seconds, 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 18), markers.rows[2].food.?.bowel_load, 1e-6);
}

test "catalog exposes the selected runtime vehicle package identity" {
    const json =
        \\{"version":1,"vehiclePackageId":"vehicle:junker","blueprints":[],"markers":[]}
    ;
    const id = try wire.decodeVehiclePackageId(testing.allocator, json);
    defer testing.allocator.free(id);
    try testing.expectEqualStrings("vehicle:junker", id);
}

test "catalog visual vehicle overrides rendering without replacing gameplay identity" {
    const json =
        \\{"version":1,"vehiclePackageId":"vehicle:physics","vehicleVisualPackageId":"vehicle:visual","blueprints":[],"markers":[]}
    ;
    const id = try wire.decodeVehiclePackageId(testing.allocator, json);
    defer testing.allocator.free(id);
    try testing.expectEqualStrings("vehicle:visual", id);
}

test "catalog reports required vehicle and food audio vocabularies" {
    const json =
        \\{"version":1,"vehiclePackageId":"vehicle:junker","blueprints":[
        \\{"packageId":"vehicle:junker","blueprint":{"stats":[{"profile":{"id":"rj.core.audio","version":1},"events":{"vehicle.engine":{},"vehicle.skid":{},"impact.body":{},"vehicle.tankFill":{}}}]}},
        \\{"packageId":"food:burrito","blueprint":{"stats":[{"profile":{"id":"rj.core.audio","version":1},"events":{"item.eat":{},"driveThru.speaker":{}}}]}}
        \\],"markers":[{"trigger":{"event":{"tag":"race.driveThru","sourceId":"food:burrito"}}}]}
    ;
    const presence = try wire.decodeAudioPresence(testing.allocator, json);
    try testing.expect(presence.vehicle);
    try testing.expect(presence.food);

    const missing =
        \\{"version":1,"vehiclePackageId":"vehicle:junker","blueprints":[
        \\{"packageId":"vehicle:junker","blueprint":{"stats":[]}},
        \\{"packageId":"food:burrito","blueprint":{"stats":[]}}
        \\],"markers":[{"trigger":{"event":{"tag":"race.driveThru","sourceId":"food:burrito"}}}]}
    ;
    const absent = try wire.decodeAudioPresence(testing.allocator, missing);
    try testing.expect(!absent.vehicle);
    try testing.expect(!absent.food);
}

test "drive-thru markers reject missing or incomplete food package references" {
    const missing_source =
        \\{"version":1,"blueprints":[],"markers":[
        \\{"id":"food","name":"Drive-Thru","kind":"trigger","position":{"x":0,"y":0,"z":0},"trigger":{"bounds":{"halfX":4,"halfY":2.5,"halfZ":4},"event":{"tag":"race.driveThru"}}}
        \\]}
    ;
    try testing.expectError(error.BadPresence, wire.decodeMarkers(testing.allocator, missing_source));

    const incomplete_food =
        \\{"version":1,"blueprints":[{"packageId":"food:empty","blueprint":{"extensions":{"com.captnocap.fartracer":{"gasYieldL":10}}}}],"markers":[
        \\{"id":"food","name":"Drive-Thru","kind":"trigger","position":{"x":0,"y":0,"z":0},"trigger":{"bounds":{"halfX":4,"halfY":2.5,"halfZ":4},"event":{"tag":"race.driveThru","sourceId":"food:empty"}}}
        \\]}
    ;
    try testing.expectError(error.BadPresence, wire.decodeMarkers(testing.allocator, incomplete_food));
}

test "the race starts on the authored home line, aimed at the first checkpoint" {
    // The generic loader spawn picks a box top out of the instance buffer. On a
    // map with a city in it that is a rooftop nowhere near the track, so the
    // marker catalog has to answer where a race begins.
    const catalog =
        \\{"version":1,"blueprints":[],"markers":[
        \\{"id":"cp2","name":"Checkpoint 2","kind":"trigger","position":{"x":300,"y":0,"z":90},"trigger":{"bounds":{"halfX":5,"halfY":2.5,"halfZ":2},"event":{"tag":"race.checkpoint","order":1}}},
        \\{"id":"home","name":"Home","kind":"trigger","position":{"x":70,"y":0,"z":90},"trigger":{"bounds":{"halfX":6,"halfY":3,"halfZ":2.5},"event":{"tag":"race.home"}}},
        \\{"id":"cp1","name":"Checkpoint 1","kind":"trigger","position":{"x":120,"y":0,"z":90},"trigger":{"bounds":{"halfX":5,"halfY":2.5,"halfZ":2},"event":{"tag":"race.checkpoint","order":0}}}
        \\]}
    ;
    const markers = try wire.decodeMarkers(testing.allocator, catalog);
    const start = markers.startPose().?;
    try testing.expectEqual(@as(f32, 70), start.x);
    try testing.expectEqual(@as(f32, 90), start.z);
    // Aimed at checkpoint ORDER 0 (which is listed last), straight down +X.
    // Heading 0 travels +Z, so +X is a quarter turn: pi/2.
    try testing.expectApproxEqAbs(@as(f32, std.math.pi / 2.0), start.yaw_radians, 0.001);

    const no_line =
        \\{"version":1,"blueprints":[],"markers":[
        \\{"id":"cp1","name":"Checkpoint 1","kind":"trigger","position":{"x":120,"y":0,"z":90},"trigger":{"bounds":{"halfX":5,"halfY":2.5,"halfZ":2},"event":{"tag":"race.checkpoint","order":0}}}
        \\]}
    ;
    const orphan = try wire.decodeMarkers(testing.allocator, no_line);
    try testing.expect(orphan.startPose() == null);
}
