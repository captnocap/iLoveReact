const std = @import("std");
const codec = @import("motion_document_json");
const motion = codec.motion;

const AUTHORED =
    \\{ "name": "wave-hello", "looping": true, "durationSeconds": 1.5,
    \\  "channels": ["upper_arm_left", "lower_arm_left"],
    \\  "keys": [
    \\    { "timeSeconds": 0.0,
    \\      "channels": { "upper_arm_left": [0,0,0,1] } },
    \\    { "timeSeconds": 0.75, "easing": "smooth", "root": [0, 0.05, 0],
    \\      "planted": ["upper_arm_left"],
    \\      "channels": { "upper_arm_left": [0.3826834,0,0,0.9238795],
    \\                    "lower_arm_left": [0,0,0.1950903,0.9807853] } }
    \\  ] }
;

test "authoring JSON round-trips through the binary document" {
    const allocator = std.testing.allocator;
    var document = try codec.parseAlloc(allocator, AUTHORED);
    defer document.deinit();

    try std.testing.expectEqualStrings("wave-hello", document.name);
    try std.testing.expect(document.looping);
    try std.testing.expectEqual(@as(usize, 2), document.channel_ids.len);
    try std.testing.expectEqual(@as(usize, 2), document.keys.len);
    // Key 0 covers only the upper arm — partial by construction.
    try std.testing.expectEqual(@as(u32, 0b01), document.keys[0].coverage);
    try std.testing.expectEqual(@as(u32, 0b11), document.keys[1].coverage);
    try std.testing.expectEqual(@as(u32, 0b01), document.keys[1].planted);
    try std.testing.expectEqual(motion.Easing.smooth, document.keys[1].easing);
    try std.testing.expectEqual(@as(f32, 0.05), document.keys[1].root_translation.?[1]);

    // Binary round-trip.
    const bytes = try motion.encodeAlloc(allocator, &document);
    defer allocator.free(bytes);
    var reopened = try motion.decodeAlloc(allocator, bytes);
    defer reopened.deinit();

    // JSON round-trip.
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try codec.writeJson(&output.writer, &reopened);
    var reparsed = try codec.parseAlloc(allocator, output.written());
    defer reparsed.deinit();
    try std.testing.expectEqualStrings("wave-hello", reparsed.name);
    try std.testing.expectEqual(@as(u32, 0b11), reparsed.keys[1].coverage);
    try std.testing.expectApproxEqAbs(
        document.keys[1].deltas[0][0],
        reparsed.keys[1].deltas[0][0],
        1.0e-6,
    );

    // The parsed document samples like any other.
    const at = try motion.sample(&reparsed, 0.75);
    try std.testing.expectEqual(@as(u32, 0b11), at.coverage);
    try std.testing.expect(at.has_root);
}

test "a key naming a channel outside the table is refused" {
    const bad =
        \\{ "name": "x", "durationSeconds": 1, "channels": ["upper_arm_left"],
        \\  "keys": [ { "timeSeconds": 0, "channels": { "tail": [0,0,0,1] } } ] }
    ;
    try std.testing.expectError(error.UnknownChannel, codec.parseAlloc(std.testing.allocator, bad));
}
