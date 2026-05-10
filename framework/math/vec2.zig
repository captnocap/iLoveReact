//! vec2.zig — 2D vector type and operations.
//!
//! Grep target: anyone searching for `Vec2` or 2D vector ops lands here.
//! Do NOT reinvent these inline. Use `math/root.zig` (or import this file directly).

const std = @import("std");
const utils = @import("utils.zig");

const EPSILON = utils.EPSILON;

pub const Vec2 = struct {
    x: f32 = 0,
    y: f32 = 0,
};

pub fn v2(x: f32, y: f32) Vec2 {
    return .{ .x = x, .y = y };
}

pub fn v2zero() Vec2 {
    return .{ .x = 0, .y = 0 };
}

pub fn v2one() Vec2 {
    return .{ .x = 1, .y = 1 };
}

pub fn v2add(a: Vec2, b: Vec2) Vec2 {
    return .{ .x = a.x + b.x, .y = a.y + b.y };
}

pub fn v2sub(a: Vec2, b: Vec2) Vec2 {
    return .{ .x = a.x - b.x, .y = a.y - b.y };
}

pub fn v2mul(a: Vec2, b: Vec2) Vec2 {
    return .{ .x = a.x * b.x, .y = a.y * b.y };
}

pub fn v2div(a: Vec2, b: Vec2) Vec2 {
    return .{ .x = a.x / b.x, .y = a.y / b.y };
}

pub fn v2scale(v: Vec2, s: f32) Vec2 {
    return .{ .x = v.x * s, .y = v.y * s };
}

pub fn v2negate(v: Vec2) Vec2 {
    return .{ .x = -v.x, .y = -v.y };
}

pub fn v2dot(a: Vec2, b: Vec2) f32 {
    return a.x * b.x + a.y * b.y;
}

pub fn v2cross(a: Vec2, b: Vec2) f32 {
    return a.x * b.y - a.y * b.x;
}

pub fn v2length(v: Vec2) f32 {
    return @sqrt(v.x * v.x + v.y * v.y);
}

pub fn v2lengthSq(v: Vec2) f32 {
    return v.x * v.x + v.y * v.y;
}

pub fn v2distance(a: Vec2, b: Vec2) f32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return @sqrt(dx * dx + dy * dy);
}

pub fn v2distanceSq(a: Vec2, b: Vec2) f32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

pub fn v2normalize(v: Vec2) Vec2 {
    const len = @sqrt(v.x * v.x + v.y * v.y);
    if (len > EPSILON) return .{ .x = v.x / len, .y = v.y / len };
    return .{ .x = 0, .y = 0 };
}

pub fn v2abs(v: Vec2) Vec2 {
    return .{ .x = @abs(v.x), .y = @abs(v.y) };
}

pub fn v2floor(v: Vec2) Vec2 {
    return .{ .x = @floor(v.x), .y = @floor(v.y) };
}

pub fn v2ceil(v: Vec2) Vec2 {
    return .{ .x = @ceil(v.x), .y = @ceil(v.y) };
}

pub fn v2round(v: Vec2) Vec2 {
    return .{ .x = @round(v.x), .y = @round(v.y) };
}

pub fn v2min(a: Vec2, b: Vec2) Vec2 {
    return .{ .x = @min(a.x, b.x), .y = @min(a.y, b.y) };
}

pub fn v2max(a: Vec2, b: Vec2) Vec2 {
    return .{ .x = @max(a.x, b.x), .y = @max(a.y, b.y) };
}

pub fn v2clamp(v: Vec2, lo: Vec2, hi: Vec2) Vec2 {
    return .{
        .x = std.math.clamp(v.x, lo.x, hi.x),
        .y = std.math.clamp(v.y, lo.y, hi.y),
    };
}

pub fn v2lerp(a: Vec2, b: Vec2, t: f32) Vec2 {
    return .{
        .x = a.x + (b.x - a.x) * t,
        .y = a.y + (b.y - a.y) * t,
    };
}

pub fn v2smoothstep(a: Vec2, b: Vec2, t: f32) Vec2 {
    const s = utils.smoothstepCurve(t);
    return .{
        .x = a.x + (b.x - a.x) * s,
        .y = a.y + (b.y - a.y) * s,
    };
}

pub fn v2angle(v: Vec2) f32 {
    return std.math.atan2(v.y, v.x);
}

pub fn v2fromAngle(radians: f32) Vec2 {
    return .{ .x = @cos(radians), .y = @sin(radians) };
}

pub fn v2rotate(v: Vec2, radians: f32) Vec2 {
    const c = @cos(radians);
    const s = @sin(radians);
    return .{ .x = v.x * c - v.y * s, .y = v.x * s + v.y * c };
}

pub fn v2equals(a: Vec2, b: Vec2) bool {
    return a.x == b.x and a.y == b.y;
}

pub fn v2almostEquals(a: Vec2, b: Vec2, eps: f32) bool {
    return @abs(a.x - b.x) < eps and @abs(a.y - b.y) < eps;
}

test "vec2 basic ops" {
    const a = v2(3, 4);
    const b = v2(1, 2);
    const sum = v2add(a, b);
    try std.testing.expectEqual(@as(f32, 4), sum.x);
    try std.testing.expectEqual(@as(f32, 6), sum.y);
    try std.testing.expectEqual(@as(f32, 5), v2length(a));
}
