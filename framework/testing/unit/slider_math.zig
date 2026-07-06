//! Unit tests for framework/primitive/slider_math.zig (MEDIASLIDER-0705).
//! Run: zig build test-slider-math

const std = @import("std");
const slider_math = @import("slider_math");

test "knobW clamps to [8,16]" {
    try std.testing.expectEqual(@as(f32, 8.0), slider_math.knobW(4));
    try std.testing.expectEqual(@as(f32, 12.0), slider_math.knobW(12));
    try std.testing.expectEqual(@as(f32, 16.0), slider_math.knobW(40));
}

test "fracFromMouse maps knob-center span and clamps" {
    // 100px track, 16px knob → span 84, knob centers at rx+8 .. rx+92
    try std.testing.expectEqual(@as(f32, 0.0), slider_math.fracFromMouse(0, 10, 100, 16));
    try std.testing.expectEqual(@as(f32, 0.0), slider_math.fracFromMouse(18, 10, 100, 16));
    try std.testing.expectEqual(@as(f32, 1.0), slider_math.fracFromMouse(102, 10, 100, 16));
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), slider_math.fracFromMouse(60, 10, 100, 16), 0.001);
}

test "snap steps and clamps in either bound order" {
    try std.testing.expectEqual(@as(f32, 0.5), slider_math.snap(0, 1, 0.25, 0.6));
    try std.testing.expectEqual(@as(f32, 1.0), slider_math.snap(0, 1, 0, 4.2));
    try std.testing.expectEqual(@as(f32, 0.0), slider_math.snap(0, 1, 0, -3));
    // inverted bounds still clamp into the numeric range
    try std.testing.expectEqual(@as(f32, 2.0), slider_math.snap(5, 2, 0, 1));
}

test "hoverBucket / bucketValue quantize by meaning" {
    try std.testing.expectEqual(@as(i64, 0), slider_math.hoverBucket(0.9, 1.0));
    try std.testing.expectEqual(@as(i64, 1), slider_math.hoverBucket(1.0, 1.0));
    try std.testing.expectEqual(@as(i64, 12), slider_math.hoverBucket(62.3, 5.0));
    try std.testing.expectEqual(@as(f32, 60.0), slider_math.bucketValue(12, 5.0));
    // step 0 falls back to 1s buckets rather than dividing by zero
    try std.testing.expectEqual(@as(i64, 7), slider_math.hoverBucket(7.5, 0));
}

test "tooltipLeft centers then clamps to track" {
    try std.testing.expectEqual(@as(f32, 18.0), slider_math.tooltipLeft(50, 200, 64));
    try std.testing.expectEqual(@as(f32, 0.0), slider_math.tooltipLeft(10, 200, 64));
    try std.testing.expectEqual(@as(f32, 136.0), slider_math.tooltipLeft(195, 200, 64));
    // zero-width tooltip → raw x clamped
    try std.testing.expectEqual(@as(f32, 200.0), slider_math.tooltipLeft(240, 200, 0));
}

test "settleHold holds until converged or window expires" {
    // window open, not converged → hold
    try std.testing.expect(slider_math.settleHold(1000, 1400, 10.0, 42.0));
    // converged → release even inside the window
    try std.testing.expect(!slider_math.settleHold(1000, 1400, 41.8, 42.0));
    // window expired → release
    try std.testing.expect(!slider_math.settleHold(1500, 1400, 10.0, 42.0));
    // tick wraparound: until wrapped past 0, now near u32 max → still open
    try std.testing.expect(slider_math.settleHold(0xFFFF_FF00, 0x0000_0100, 10.0, 42.0));
}
