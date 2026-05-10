//! utils.zig — shared internals for the math module.
//!
//! The DRY layer underneath vec2/vec3/vec4/mat4/quat/bbox/geo/noise/bezier.
//! If a scalar equation appears in more than one math/* file, it lives here.
//! If you find yourself writing `@sqrt(dx*dx + dy*dy)` or
//! `@max(0, @min(1, x))` again — STOP — call into this file instead.

const std = @import("std");

/// Tolerance used for "is this length zero" / "is this matrix singular" checks.
pub const EPSILON: f32 = 1e-6;

/// Hermite S-curve `t*t*(3-2*t)` used by smoothstep on scalars and vectors.
/// Caller is responsible for clamping `t` to [0, 1] if needed.
pub inline fn smoothstepCurve(t: f32) f32 {
    return t * t * (3 - 2 * t);
}

/// Quintic S-curve `t*t*t*(t*(t*6-15)+10)` used by smootherstep AND by Perlin
/// noise as the fade function. Same equation, two consumers.
pub inline fn smootherstepCurve(t: f32) f32 {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/// 2D Euclidean length (a.k.a. hypot). Replaces inline `@sqrt(x*x + y*y)`.
pub inline fn length2(x: f32, y: f32) f32 {
    return @sqrt(x * x + y * y);
}

pub inline fn lengthSq2(x: f32, y: f32) f32 {
    return x * x + y * y;
}

/// 3D Euclidean length. Replaces inline `@sqrt(x*x + y*y + z*z)`.
pub inline fn length3(x: f32, y: f32, z: f32) f32 {
    return @sqrt(x * x + y * y + z * z);
}

pub inline fn lengthSq3(x: f32, y: f32, z: f32) f32 {
    return x * x + y * y + z * z;
}

pub inline fn length4(x: f32, y: f32, z: f32, w: f32) f32 {
    return @sqrt(x * x + y * y + z * z + w * w);
}

pub inline fn lengthSq4(x: f32, y: f32, z: f32, w: f32) f32 {
    return x * x + y * y + z * z + w * w;
}

/// Clamp to [0, 1]. Replaces inline `@max(0.0, @min(1.0, x))`.
pub inline fn clamp01(x: f32) f32 {
    return @max(0.0, @min(1.0, x));
}

/// Clamp to [-1, 1]. Used before acos to defend against FP drift.
pub inline fn clampUnit(x: f32) f32 {
    return @max(-1.0, @min(1.0, x));
}

/// Returns 1/len if len is non-degenerate, else 0. The "safe normalize" tail.
pub inline fn safeRecipLength(len: f32) f32 {
    return if (len > EPSILON) 1.0 / len else 0.0;
}

/// Clamp `x` to `[lo, hi]` where either bound may be null (= no clamp on
/// that side). Mirrors CSS min-/max- attribute semantics and the private
/// `clampVal` helper that has been duplicated across layout code.
pub inline fn clampOpt(x: f32, lo: ?f32, hi: ?f32) f32 {
    var v = x;
    if (lo) |mn| if (v < mn) {
        v = mn;
    };
    if (hi) |mx| if (v > mx) {
        v = mx;
    };
    return v;
}

/// Point-in-axis-aligned-rect test, x/y/w/h convention with **half-open**
/// upper bound — `[rx, rx+rw)` × `[ry, ry+rh)`. This matches the CSS
/// box-model and the convention used by `framework/layout.zig` hit-testing,
/// so two adjacent rects don't both claim a point on their shared edge.
/// Replaces inline `mx >= rx and mx < rx + rw and my >= ry and my < ry + rh`.
pub inline fn pointInRectXYWH(px: f32, py: f32, rx: f32, ry: f32, rw: f32, rh: f32) bool {
    return px >= rx and px < rx + rw and py >= ry and py < ry + rh;
}

/// Closed-interval variant: includes the far edge. Use only when you have
/// a deliberate inclusive convention (e.g. drawing a 1-pixel border that
/// counts as part of the rect). Most code should use `pointInRectXYWH`.
pub inline fn pointInRectXYWHInclusive(px: f32, py: f32, rx: f32, ry: f32, rw: f32, rh: f32) bool {
    return px >= rx and px <= rx + rw and py >= ry and py <= ry + rh;
}

/// Uniform scale factor along the X axis of a 2x3 affine matrix
/// (CSS / Blend2D / canvas convention `[a b c d e f]`). |(a, b)|.
pub inline fn mat2dScaleX(a: f32, b: f32) f32 {
    return @sqrt(a * a + b * b);
}

/// Uniform scale factor along the Y axis of a 2x3 affine matrix. |(c, d)|.
pub inline fn mat2dScaleY(c: f32, d: f32) f32 {
    return @sqrt(c * c + d * d);
}

test "smoothstepCurve endpoints" {
    try std.testing.expectEqual(@as(f32, 0), smoothstepCurve(0));
    try std.testing.expectEqual(@as(f32, 1), smoothstepCurve(1));
}

test "smootherstepCurve endpoints" {
    try std.testing.expectEqual(@as(f32, 0), smootherstepCurve(0));
    try std.testing.expectEqual(@as(f32, 1), smootherstepCurve(1));
}

test "length2 matches @sqrt" {
    try std.testing.expectEqual(@as(f32, 5), length2(3, 4));
}

test "clamp01 bounds" {
    try std.testing.expectEqual(@as(f32, 0), clamp01(-1));
    try std.testing.expectEqual(@as(f32, 1), clamp01(2));
    try std.testing.expectEqual(@as(f32, 0.5), clamp01(0.5));
}

test "pointInRectXYWH (half-open)" {
    // Interior + start edge
    try std.testing.expect(pointInRectXYWH(5, 5, 0, 0, 10, 10));
    try std.testing.expect(pointInRectXYWH(0, 0, 0, 0, 10, 10));
    // Far edge is OUT (half-open)
    try std.testing.expect(!pointInRectXYWH(10, 5, 0, 0, 10, 10));
    try std.testing.expect(!pointInRectXYWH(5, 10, 0, 0, 10, 10));
    // Outside
    try std.testing.expect(!pointInRectXYWH(11, 5, 0, 0, 10, 10));
    try std.testing.expect(!pointInRectXYWH(5, -1, 0, 0, 10, 10));
}

test "pointInRectXYWHInclusive (closed)" {
    // Far edge IS in (inclusive variant)
    try std.testing.expect(pointInRectXYWHInclusive(10, 5, 0, 0, 10, 10));
    try std.testing.expect(pointInRectXYWHInclusive(5, 10, 0, 0, 10, 10));
}

test "clampOpt with both bounds" {
    try std.testing.expectEqual(@as(f32, 5), clampOpt(5, 0, 10));
    try std.testing.expectEqual(@as(f32, 0), clampOpt(-3, 0, 10));
    try std.testing.expectEqual(@as(f32, 10), clampOpt(99, 0, 10));
}

test "clampOpt with null bounds is identity on that side" {
    try std.testing.expectEqual(@as(f32, -5), clampOpt(-5, null, 10));
    try std.testing.expectEqual(@as(f32, 99), clampOpt(99, 0, null));
    try std.testing.expectEqual(@as(f32, 42), clampOpt(42, null, null));
}
