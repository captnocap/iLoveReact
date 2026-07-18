//! slider_math.zig — pure geometry/quantization helpers for the host
//! <Slider> (SLIDER-0611) and its media-scrubber extension (MEDIASLIDER-0705).
//!
//! Everything here is engine-agnostic: no SDL, no layout, no mpv. The
//! engine's drag/hover/follow machinery calls these, and
//! framework/testing/unit/slider_math.zig exercises them headlessly
//! (`zig build test-slider-math`).

const std = @import("std");

/// Knob is a square of the node height, clamped to [8, 16] px. Shared by
/// paint + drag so the knob center maps the value span identically.
pub fn knobW(node_h: f32) f32 {
    return @min(@max(node_h, 8.0), 16.0);
}

/// Mouse x → track fraction [0,1]. The value span is the track minus one
/// knob width so the knob center never overhangs the rect.
pub fn fracFromMouse(mx: f32, rx: f32, rw: f32, knob_w: f32) f32 {
    const span = @max(1.0, rw - knob_w);
    return @max(0.0, @min((mx - rx - knob_w * 0.5) / span, 1.0));
}

/// Snap a raw value to the slider's step grid (0 = continuous) and clamp
/// into [min,max] regardless of which bound is larger.
pub fn snap(min: f32, max: f32, step: f32, raw: f32) f32 {
    var v = raw;
    if (step > 0) {
        v = min + @round((v - min) / step) * step;
    }
    const lo = @min(min, max);
    const hi = @max(min, max);
    return @max(lo, @min(v, hi));
}

/// Quantize a hover/drag value into a bucket index. The bucket is the unit
/// of MEANING for JS dispatch: the host only tells React about the pointer
/// when it crosses into a new bucket (a new preview second, a new sprite
/// cell), never per pixel.
pub fn hoverBucket(value: f32, step: f32) i64 {
    const s = if (step > 0) step else 1.0;
    return @floor(value / s);
}

/// The representative value dispatched for a bucket (its left edge).
pub fn bucketValue(bucket: i64, step: f32) f32 {
    const s = if (step > 0) step else 1.0;
    return @as(f32, @floatFromInt(bucket)) * s;
}

/// Left position for a hover tooltip of width `tip_w`, centered on the
/// pointer's x-within-track but clamped so it never escapes the track —
/// the vidstack preview-clamp behavior. With tip_w == 0 this is just the
/// raw pointer x clamped into the track.
pub fn tooltipLeft(x_in_track: f32, track_w: f32, tip_w: f32) f32 {
    const x = @max(0.0, @min(x_in_track, track_w));
    if (tip_w <= 0) return x;
    return @max(0.0, @min(x - tip_w * 0.5, @max(0.0, track_w - tip_w)));
}

/// After a commit seek, mpv's time-pos lags the target while the demuxer
/// settles. Hold the displayed value at the target while (a) the settle
/// window is still open (wraparound-safe u32 tick compare) and (b) the
/// reported time hasn't converged to within 0.3s of the target. Without
/// this the thumb snaps back to the pre-seek position for a few frames.
pub fn settleHold(now_ms: u32, until_ms: u32, time: f64, target: f64) bool {
    const remaining: i32 = @bitCast(until_ms -% now_ms);
    if (remaining <= 0) return false;
    return @abs(time - target) > 0.3;
}
