//! vec3.zig — 3D vector type and operations.
//!
//! Grep target: anyone searching for `Vec3` lands here.

const std = @import("std");
const utils = @import("utils.zig");

const EPSILON = utils.EPSILON;

pub const Vec3 = struct {
    x: f32 = 0,
    y: f32 = 0,
    z: f32 = 0,
};

pub fn v3(x: f32, y: f32, z: f32) Vec3 {
    return .{ .x = x, .y = y, .z = z };
}

pub fn v3zero() Vec3 {
    return .{ .x = 0, .y = 0, .z = 0 };
}

pub fn v3one() Vec3 {
    return .{ .x = 1, .y = 1, .z = 1 };
}

pub fn v3up() Vec3 {
    return .{ .x = 0, .y = 1, .z = 0 };
}

pub fn v3forward() Vec3 {
    return .{ .x = 0, .y = 0, .z = -1 };
}

pub fn v3right() Vec3 {
    return .{ .x = 1, .y = 0, .z = 0 };
}

pub fn v3add(a: Vec3, b: Vec3) Vec3 {
    return .{ .x = a.x + b.x, .y = a.y + b.y, .z = a.z + b.z };
}

pub fn v3sub(a: Vec3, b: Vec3) Vec3 {
    return .{ .x = a.x - b.x, .y = a.y - b.y, .z = a.z - b.z };
}

pub fn v3mul(a: Vec3, b: Vec3) Vec3 {
    return .{ .x = a.x * b.x, .y = a.y * b.y, .z = a.z * b.z };
}

pub fn v3div(a: Vec3, b: Vec3) Vec3 {
    return .{ .x = a.x / b.x, .y = a.y / b.y, .z = a.z / b.z };
}

pub fn v3scale(v: Vec3, s: f32) Vec3 {
    return .{ .x = v.x * s, .y = v.y * s, .z = v.z * s };
}

pub fn v3negate(v: Vec3) Vec3 {
    return .{ .x = -v.x, .y = -v.y, .z = -v.z };
}

pub fn v3dot(a: Vec3, b: Vec3) f32 {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

pub fn v3cross(a: Vec3, b: Vec3) Vec3 {
    return .{
        .x = a.y * b.z - a.z * b.y,
        .y = a.z * b.x - a.x * b.z,
        .z = a.x * b.y - a.y * b.x,
    };
}

pub fn v3length(v: Vec3) f32 {
    return @sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

pub fn v3lengthSq(v: Vec3) f32 {
    return v.x * v.x + v.y * v.y + v.z * v.z;
}

pub fn v3distance(a: Vec3, b: Vec3) f32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return @sqrt(dx * dx + dy * dy + dz * dz);
}

pub fn v3distanceSq(a: Vec3, b: Vec3) f32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

pub fn v3normalize(v: Vec3) Vec3 {
    const len = @sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len > EPSILON) return .{ .x = v.x / len, .y = v.y / len, .z = v.z / len };
    return .{ .x = 0, .y = 0, .z = 0 };
}

pub fn v3abs(v: Vec3) Vec3 {
    return .{ .x = @abs(v.x), .y = @abs(v.y), .z = @abs(v.z) };
}

pub fn v3floor(v: Vec3) Vec3 {
    return .{ .x = @floor(v.x), .y = @floor(v.y), .z = @floor(v.z) };
}

pub fn v3ceil(v: Vec3) Vec3 {
    return .{ .x = @ceil(v.x), .y = @ceil(v.y), .z = @ceil(v.z) };
}

pub fn v3round(v: Vec3) Vec3 {
    return .{ .x = @round(v.x), .y = @round(v.y), .z = @round(v.z) };
}

pub fn v3min(a: Vec3, b: Vec3) Vec3 {
    return .{ .x = @min(a.x, b.x), .y = @min(a.y, b.y), .z = @min(a.z, b.z) };
}

pub fn v3max(a: Vec3, b: Vec3) Vec3 {
    return .{ .x = @max(a.x, b.x), .y = @max(a.y, b.y), .z = @max(a.z, b.z) };
}

pub fn v3clamp(v: Vec3, lo: Vec3, hi: Vec3) Vec3 {
    return .{
        .x = std.math.clamp(v.x, lo.x, hi.x),
        .y = std.math.clamp(v.y, lo.y, hi.y),
        .z = std.math.clamp(v.z, lo.z, hi.z),
    };
}

pub fn v3lerp(a: Vec3, b: Vec3, t: f32) Vec3 {
    return .{
        .x = a.x + (b.x - a.x) * t,
        .y = a.y + (b.y - a.y) * t,
        .z = a.z + (b.z - a.z) * t,
    };
}

pub fn v3smoothstep(a: Vec3, b: Vec3, t: f32) Vec3 {
    const s = utils.smoothstepCurve(t);
    return .{
        .x = a.x + (b.x - a.x) * s,
        .y = a.y + (b.y - a.y) * s,
        .z = a.z + (b.z - a.z) * s,
    };
}

pub fn v3reflect(v: Vec3, normal: Vec3) Vec3 {
    const d = 2 * v3dot(v, normal);
    return .{
        .x = v.x - d * normal.x,
        .y = v.y - d * normal.y,
        .z = v.z - d * normal.z,
    };
}

pub fn v3slerp(a: Vec3, b: Vec3, t: f32) Vec3 {
    var d = v3dot(a, b);
    d = @max(-1.0, @min(1.0, d));
    const theta = std.math.acos(d) * t;
    const rel = v3normalize(v3sub(b, v3scale(a, d)));
    return v3add(v3scale(a, @cos(theta)), v3scale(rel, @sin(theta)));
}

pub fn v3equals(a: Vec3, b: Vec3) bool {
    return a.x == b.x and a.y == b.y and a.z == b.z;
}

pub fn v3almostEquals(a: Vec3, b: Vec3, eps: f32) bool {
    return @abs(a.x - b.x) < eps and @abs(a.y - b.y) < eps and @abs(a.z - b.z) < eps;
}
