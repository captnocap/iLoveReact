//! quat.zig — Quaternion type and operations.
//!
//! Grep target: `Quat`, `quatSlerp`, etc. land here.
//! `Quat` is a structural alias for `Vec4` (xyzw layout).

const std = @import("std");
const utils = @import("utils.zig");
const vec3 = @import("vec3.zig");
const vec4 = @import("vec4.zig");
const mat4 = @import("mat4.zig");

const EPSILON = utils.EPSILON;
const Vec3 = vec3.Vec3;
const Mat4 = mat4.Mat4;

pub const Quat = vec4.Vec4;

pub fn quatIdentity() Quat {
    return .{ .x = 0, .y = 0, .z = 0, .w = 1 };
}

pub fn quatCreate(x: f32, y: f32, z: f32, w: f32) Quat {
    return .{ .x = x, .y = y, .z = z, .w = w };
}

pub fn quatMultiply(a: Quat, b: Quat) Quat {
    return .{
        .x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        .y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        .z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        .w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

pub fn quatConjugate(q: Quat) Quat {
    return .{ .x = -q.x, .y = -q.y, .z = -q.z, .w = q.w };
}

pub fn quatInverse(q: Quat) Quat {
    const lenSq = utils.lengthSq4(q.x, q.y, q.z, q.w);
    if (lenSq < EPSILON) return .{ .x = 0, .y = 0, .z = 0, .w = 1 };
    const inv = 1.0 / lenSq;
    return .{ .x = -q.x * inv, .y = -q.y * inv, .z = -q.z * inv, .w = q.w * inv };
}

pub fn quatNormalize(q: Quat) Quat {
    const len = utils.length4(q.x, q.y, q.z, q.w);
    if (len > EPSILON) return .{ .x = q.x / len, .y = q.y / len, .z = q.z / len, .w = q.w / len };
    return .{ .x = 0, .y = 0, .z = 0, .w = 1 };
}

pub fn quatDot(a: Quat, b: Quat) f32 {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

pub fn quatLength(q: Quat) f32 {
    return utils.length4(q.x, q.y, q.z, q.w);
}

pub fn quatFromAxisAngle(axis: Vec3, radians: f32) Quat {
    const half = radians * 0.5;
    const s = @sin(half);
    const len = utils.length3(axis.x, axis.y, axis.z);
    if (len < EPSILON) return .{ .x = 0, .y = 0, .z = 0, .w = 1 };
    const inv = s / len;
    return .{ .x = axis.x * inv, .y = axis.y * inv, .z = axis.z * inv, .w = @cos(half) };
}

pub fn quatFromEuler(x: f32, y: f32, z: f32) Quat {
    const cx = @cos(x * 0.5);
    const sx = @sin(x * 0.5);
    const cy = @cos(y * 0.5);
    const sy = @sin(y * 0.5);
    const cz = @cos(z * 0.5);
    const sz = @sin(z * 0.5);
    return .{
        .x = sx * cy * cz + cx * sy * sz,
        .y = cx * sy * cz - sx * cy * sz,
        .z = cx * cy * sz + sx * sy * cz,
        .w = cx * cy * cz - sx * sy * sz,
    };
}

pub fn quatToEuler(q: Quat) Vec3 {
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    const sinP = 2 * (w * y - z * x);
    const pi = std.math.pi;
    const pitch = if (@abs(sinP) >= 1)
        (if (sinP > 0) @as(f32, pi / 2.0) else @as(f32, -pi / 2.0))
    else
        std.math.asin(sinP);
    const yaw = std.math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const roll = std.math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    return .{ .x = roll, .y = pitch, .z = yaw };
}

pub fn quatToMat4(q: Quat) Mat4 {
    return mat4.m4fromQuat(q);
}

pub fn quatSlerp(a: Quat, b: Quat, t: f32) Quat {
    var d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    var bx = b.x;
    var by = b.y;
    var bz = b.z;
    var bw = b.w;
    if (d < 0) {
        d = -d;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    if (d > 1 - EPSILON) {
        return quatNormalize(.{
            .x = a.x + (bx - a.x) * t,
            .y = a.y + (by - a.y) * t,
            .z = a.z + (bz - a.z) * t,
            .w = a.w + (bw - a.w) * t,
        });
    }
    const theta = std.math.acos(d);
    const sinTheta = @sin(theta);
    const wa = @sin((1 - t) * theta) / sinTheta;
    const wb = @sin(t * theta) / sinTheta;
    return .{
        .x = a.x * wa + bx * wb,
        .y = a.y * wa + by * wb,
        .z = a.z * wa + bz * wb,
        .w = a.w * wa + bw * wb,
    };
}

pub fn quatRotateVec3(q: Quat, v: Vec3) Vec3 {
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;
    const tx = 2 * (qy * v.z - qz * v.y);
    const ty = 2 * (qz * v.x - qx * v.z);
    const tz = 2 * (qx * v.y - qy * v.x);
    return .{
        .x = v.x + qw * tx + qy * tz - qz * ty,
        .y = v.y + qw * ty + qz * tx - qx * tz,
        .z = v.z + qw * tz + qx * ty - qy * tx,
    };
}
