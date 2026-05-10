//! vec4.zig — 4D vector type and operations.
//!
//! Grep target: `Vec4` lands here. Note `Quat` is a Vec4 alias — see quat.zig.

const std = @import("std");
const utils = @import("utils.zig");

const EPSILON = utils.EPSILON;

pub const Vec4 = struct {
    x: f32 = 0,
    y: f32 = 0,
    z: f32 = 0,
    w: f32 = 0,
};

pub fn v4(x: f32, y: f32, z: f32, w: f32) Vec4 {
    return .{ .x = x, .y = y, .z = z, .w = w };
}

pub fn v4zero() Vec4 {
    return .{ .x = 0, .y = 0, .z = 0, .w = 0 };
}

pub fn v4one() Vec4 {
    return .{ .x = 1, .y = 1, .z = 1, .w = 1 };
}

pub fn v4add(a: Vec4, b: Vec4) Vec4 {
    return .{ .x = a.x + b.x, .y = a.y + b.y, .z = a.z + b.z, .w = a.w + b.w };
}

pub fn v4sub(a: Vec4, b: Vec4) Vec4 {
    return .{ .x = a.x - b.x, .y = a.y - b.y, .z = a.z - b.z, .w = a.w - b.w };
}

pub fn v4mul(a: Vec4, b: Vec4) Vec4 {
    return .{ .x = a.x * b.x, .y = a.y * b.y, .z = a.z * b.z, .w = a.w * b.w };
}

pub fn v4div(a: Vec4, b: Vec4) Vec4 {
    return .{ .x = a.x / b.x, .y = a.y / b.y, .z = a.z / b.z, .w = a.w / b.w };
}

pub fn v4scale(v: Vec4, s: f32) Vec4 {
    return .{ .x = v.x * s, .y = v.y * s, .z = v.z * s, .w = v.w * s };
}

pub fn v4negate(v: Vec4) Vec4 {
    return .{ .x = -v.x, .y = -v.y, .z = -v.z, .w = -v.w };
}

pub fn v4dot(a: Vec4, b: Vec4) f32 {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

pub fn v4length(v: Vec4) f32 {
    return @sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w);
}

pub fn v4lengthSq(v: Vec4) f32 {
    return v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w;
}

pub fn v4normalize(v: Vec4) Vec4 {
    const len = @sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w);
    if (len > EPSILON) return .{ .x = v.x / len, .y = v.y / len, .z = v.z / len, .w = v.w / len };
    return .{ .x = 0, .y = 0, .z = 0, .w = 0 };
}

pub fn v4lerp(a: Vec4, b: Vec4, t: f32) Vec4 {
    return .{
        .x = a.x + (b.x - a.x) * t,
        .y = a.y + (b.y - a.y) * t,
        .z = a.z + (b.z - a.z) * t,
        .w = a.w + (b.w - a.w) * t,
    };
}

pub fn v4min(a: Vec4, b: Vec4) Vec4 {
    return .{ .x = @min(a.x, b.x), .y = @min(a.y, b.y), .z = @min(a.z, b.z), .w = @min(a.w, b.w) };
}

pub fn v4max(a: Vec4, b: Vec4) Vec4 {
    return .{ .x = @max(a.x, b.x), .y = @max(a.y, b.y), .z = @max(a.z, b.z), .w = @max(a.w, b.w) };
}

pub fn v4clamp(v: Vec4, lo: Vec4, hi: Vec4) Vec4 {
    return .{
        .x = std.math.clamp(v.x, lo.x, hi.x),
        .y = std.math.clamp(v.y, lo.y, hi.y),
        .z = std.math.clamp(v.z, lo.z, hi.z),
        .w = std.math.clamp(v.w, lo.w, hi.w),
    };
}

pub fn v4equals(a: Vec4, b: Vec4) bool {
    return a.x == b.x and a.y == b.y and a.z == b.z and a.w == b.w;
}

pub fn v4almostEquals(a: Vec4, b: Vec4, eps: f32) bool {
    return @abs(a.x - b.x) < eps and @abs(a.y - b.y) < eps and @abs(a.z - b.z) < eps and @abs(a.w - b.w) < eps;
}
