//! Focused coverage for the native model-stage scale cue.
//! Run: zig build test-stage-scale

const std = @import("std");
const testing = std.testing;
const scale = @import("stage_scale");

test "stage scale is the ruled game metre contract" {
    try testing.expectEqual(@as(f32, 1.0), scale.Tuning.tile_meters);
    try testing.expectEqual(@as(f32, 16.0), scale.Tuning.units_per_meter);
    try testing.expectEqual(@as(f32, 1.65), scale.Tuning.player_collider_height_meters);
    try testing.expectEqual(@as(f32, 2.04), scale.Tuning.player_visual_head_top_meters);
    try testing.expectEqual(@as(f32, 20.0), scale.metersToUnits(1.25));
}

test "stage overlays are quiet until the author turns them on" {
    const defaults: scale.OverlayOptions = .{};
    try testing.expect(!defaults.player_scale);
    try testing.expect(!defaults.measurements);
    const measuring: scale.OverlayOptions = .{ .measurements = true };
    try testing.expect(measuring.measurements);
    try testing.expect(!measuring.player_scale);
}

test "stage scale keeps collider and visual head as distinct references" {
    try testing.expect(scale.markFor(.collider) != null);
    try testing.expect(scale.markFor(.visual_head) != null);
    const collider = scale.markFor(.collider).?;
    const visual_head = scale.markFor(.visual_head).?;
    try testing.expectEqual(scale.Tuning.player_collider_height_meters, collider.meters);
    try testing.expectEqual(scale.Tuning.player_visual_head_top_meters, visual_head.meters);
    try testing.expect(collider.meters < visual_head.meters);
    try testing.expect(visual_head.meters <= scale.Tuning.ruler_height_meters);
}

test "stage ruler has quarter-metre ticks and whole-metre majors" {
    try testing.expectEqual(@as(u32, 12), scale.minorTickCount());
    try testing.expectEqual(@as(f32, 0), scale.tickMeters(0));
    try testing.expectEqual(@as(f32, 1), scale.tickMeters(4));
    try testing.expectEqual(@as(f32, 3), scale.tickMeters(scale.minorTickCount()));
    try testing.expect(scale.isMajorTick(0));
    try testing.expect(!scale.isMajorTick(3));
    try testing.expect(scale.isMajorTick(4));
    try testing.expect(scale.isMajorTick(8));
    try testing.expect(scale.isMajorTick(12));
}
