//! Render-rate interpolation for sparse live pose observations.
//!
//! Camera inference intentionally stays bounded at ~11Hz; consuming the newest
//! pose as a hard step made the figure visibly tick at that rate. Each ingress
//! now becomes a target that the render loop reaches over one observation
//! interval. This module is pure math: no clocks, globals, or allocation.

const std = @import("std");

pub const TRANSFORM_FLOATS: usize = 9;
pub const TARGET_INTERVAL_SECONDS: f32 = 0.090;

fn shortestDegrees(from: f32, to: f32) f32 {
    return @mod(to - from + 540.0, 360.0) - 180.0;
}

/// Advance `current` toward `target` by `dt`, consuming `remaining_seconds`.
/// Rows are [px,py,pz, rx,ry,rz, sx,sy,sz]. Rotation takes the shortest route
/// across ±180°; the final step copies the exact target representation.
pub fn advance(
    current: []f32,
    target: []const f32,
    remaining_seconds: *f32,
    dt: f32,
) void {
    if (current.len != target.len or current.len % TRANSFORM_FLOATS != 0) return;
    if (remaining_seconds.* <= 0 or dt <= 0) return;
    const step = @min(dt, remaining_seconds.*);
    const alpha = std.math.clamp(step / remaining_seconds.*, 0, 1);
    const final_step = step >= remaining_seconds.*;
    for (current, target, 0..) |*value, desired, i| {
        if (final_step) {
            value.* = desired;
        } else if (i % TRANSFORM_FLOATS >= 3 and i % TRANSFORM_FLOATS <= 5) {
            value.* += shortestDegrees(value.*, desired) * alpha;
        } else {
            value.* += (desired - value.*) * alpha;
        }
    }
    remaining_seconds.* = @max(0, remaining_seconds.* - step);
}
