//! mat4.zig — 4x4 matrix type and operations (column-major [16]f32).
//!
//! Grep target: `Mat4`, `m4multiply`, `m4perspective`, etc. land here.
//!
//! Layout:
//!   [0]  [1]  [2]  [3]     <- row 0
//!   [4]  [5]  [6]  [7]     <- row 1
//!   [8]  [9]  [10] [11]    <- row 2
//!   [12] [13] [14] [15]    <- row 3

const std = @import("std");
const utils = @import("utils.zig");
const vec3 = @import("vec3.zig");
const vec4 = @import("vec4.zig");

const EPSILON = utils.EPSILON;
const Vec3 = vec3.Vec3;
// `Quat` is structurally a Vec4 — see quat.zig. We accept Vec4 here to avoid
// a circular import between mat4 and quat.
const Quat = vec4.Vec4;

pub const Mat4 = [16]f32;

pub const Decomposed = struct {
    translation: Vec3 = .{},
    rotation: Quat = .{},
    scale: Vec3 = .{},
};

pub fn m4identity() Mat4 {
    return .{ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 };
}

pub fn m4multiply(a: Mat4, b: Mat4) Mat4 {
    return .{
        a[0] * b[0] + a[1] * b[4] + a[2] * b[8] + a[3] * b[12],
        a[0] * b[1] + a[1] * b[5] + a[2] * b[9] + a[3] * b[13],
        a[0] * b[2] + a[1] * b[6] + a[2] * b[10] + a[3] * b[14],
        a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3] * b[15],
        a[4] * b[0] + a[5] * b[4] + a[6] * b[8] + a[7] * b[12],
        a[4] * b[1] + a[5] * b[5] + a[6] * b[9] + a[7] * b[13],
        a[4] * b[2] + a[5] * b[6] + a[6] * b[10] + a[7] * b[14],
        a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7] * b[15],
        a[8] * b[0] + a[9] * b[4] + a[10] * b[8] + a[11] * b[12],
        a[8] * b[1] + a[9] * b[5] + a[10] * b[9] + a[11] * b[13],
        a[8] * b[2] + a[9] * b[6] + a[10] * b[10] + a[11] * b[14],
        a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11] * b[15],
        a[12] * b[0] + a[13] * b[4] + a[14] * b[8] + a[15] * b[12],
        a[12] * b[1] + a[13] * b[5] + a[14] * b[9] + a[15] * b[13],
        a[12] * b[2] + a[13] * b[6] + a[14] * b[10] + a[15] * b[14],
        a[12] * b[3] + a[13] * b[7] + a[14] * b[11] + a[15] * b[15],
    };
}

pub fn m4transpose(m: Mat4) Mat4 {
    return .{
        m[0], m[4], m[8],  m[12],
        m[1], m[5], m[9],  m[13],
        m[2], m[6], m[10], m[14],
        m[3], m[7], m[11], m[15],
    };
}

pub fn m4determinant(m: Mat4) f32 {
    const b0 = m[0] * m[5] - m[1] * m[4];
    const b1 = m[0] * m[6] - m[2] * m[4];
    const b2 = m[0] * m[7] - m[3] * m[4];
    const b3 = m[1] * m[6] - m[2] * m[5];
    const b4 = m[1] * m[7] - m[3] * m[5];
    const b5 = m[2] * m[7] - m[3] * m[6];
    const b6 = m[8] * m[13] - m[9] * m[12];
    const b7 = m[8] * m[14] - m[10] * m[12];
    const b8 = m[8] * m[15] - m[11] * m[12];
    const b9 = m[9] * m[14] - m[10] * m[13];
    const b10 = m[9] * m[15] - m[11] * m[13];
    const b11 = m[10] * m[15] - m[11] * m[14];
    return b0 * b11 - b1 * b10 + b2 * b9 + b3 * b8 - b4 * b7 + b5 * b6;
}

pub fn m4invert(m: Mat4) ?Mat4 {
    const a0 = m[0];
    const a1 = m[1];
    const a2 = m[2];
    const a3 = m[3];
    const a4 = m[4];
    const a5 = m[5];
    const a6 = m[6];
    const a7 = m[7];
    const a8 = m[8];
    const a9 = m[9];
    const a10 = m[10];
    const a11 = m[11];
    const a12 = m[12];
    const a13 = m[13];
    const a14 = m[14];
    const a15 = m[15];

    const b0 = a0 * a5 - a1 * a4;
    const b1 = a0 * a6 - a2 * a4;
    const b2 = a0 * a7 - a3 * a4;
    const b3 = a1 * a6 - a2 * a5;
    const b4 = a1 * a7 - a3 * a5;
    const b5 = a2 * a7 - a3 * a6;
    const b6 = a8 * a13 - a9 * a12;
    const b7 = a8 * a14 - a10 * a12;
    const b8 = a8 * a15 - a11 * a12;
    const b9 = a9 * a14 - a10 * a13;
    const b10 = a9 * a15 - a11 * a13;
    const b11 = a10 * a15 - a11 * a14;

    const det = b0 * b11 - b1 * b10 + b2 * b9 + b3 * b8 - b4 * b7 + b5 * b6;
    if (@abs(det) < EPSILON) return null;
    const inv = 1.0 / det;

    return .{
        (a5 * b11 - a6 * b10 + a7 * b9) * inv,
        (-a1 * b11 + a2 * b10 - a3 * b9) * inv,
        (a13 * b5 - a14 * b4 + a15 * b3) * inv,
        (-a9 * b5 + a10 * b4 - a11 * b3) * inv,
        (-a4 * b11 + a6 * b8 - a7 * b7) * inv,
        (a0 * b11 - a2 * b8 + a3 * b7) * inv,
        (-a12 * b5 + a14 * b2 - a15 * b1) * inv,
        (a8 * b5 - a10 * b2 + a11 * b1) * inv,
        (a4 * b10 - a5 * b8 + a7 * b6) * inv,
        (-a0 * b10 + a1 * b8 - a3 * b6) * inv,
        (a12 * b4 - a13 * b2 + a15 * b0) * inv,
        (-a8 * b4 + a9 * b2 - a11 * b0) * inv,
        (-a4 * b9 + a5 * b7 - a6 * b6) * inv,
        (a0 * b9 - a1 * b7 + a2 * b6) * inv,
        (-a12 * b3 + a13 * b1 - a14 * b0) * inv,
        (a8 * b3 - a9 * b1 + a10 * b0) * inv,
    };
}

pub fn m4translate(m: Mat4, v: Vec3) Mat4 {
    const x = v.x;
    const y = v.y;
    const z = v.z;
    var out = m;
    out[3] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[7] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[11] = m[8] * x + m[9] * y + m[10] * z + m[11];
    out[15] = m[12] * x + m[13] * y + m[14] * z + m[15];
    return out;
}

pub fn m4scale(m: Mat4, v: Vec3) Mat4 {
    const sx = v.x;
    const sy = v.y;
    const sz = v.z;
    return .{
        m[0] * sx,  m[1] * sy,  m[2] * sz,  m[3],
        m[4] * sx,  m[5] * sy,  m[6] * sz,  m[7],
        m[8] * sx,  m[9] * sy,  m[10] * sz, m[11],
        m[12] * sx, m[13] * sy, m[14] * sz, m[15],
    };
}

pub fn m4rotateX(m: Mat4, radians: f32) Mat4 {
    const c = @cos(radians);
    const s = @sin(radians);
    const rot = Mat4{ 1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1 };
    return m4multiply(m, rot);
}

pub fn m4rotateY(m: Mat4, radians: f32) Mat4 {
    const c = @cos(radians);
    const s = @sin(radians);
    const rot = Mat4{ c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1 };
    return m4multiply(m, rot);
}

pub fn m4rotateZ(m: Mat4, radians: f32) Mat4 {
    const c = @cos(radians);
    const s = @sin(radians);
    const rot = Mat4{ c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 };
    return m4multiply(m, rot);
}

pub fn m4lookAt(eye: Vec3, target: Vec3, up: Vec3) Mat4 {
    var fx = eye.x - target.x;
    var fy = eye.y - target.y;
    var fz = eye.z - target.z;
    var len = utils.length3(fx, fy, fz);
    if (len > EPSILON) {
        fx /= len;
        fy /= len;
        fz /= len;
    }
    var sx = up.y * fz - up.z * fy;
    var sy = up.z * fx - up.x * fz;
    var sz = up.x * fy - up.y * fx;
    len = utils.length3(sx, sy, sz);
    if (len > EPSILON) {
        sx /= len;
        sy /= len;
        sz /= len;
    }
    const ux = fy * sz - fz * sy;
    const uy = fz * sx - fx * sz;
    const uz = fx * sy - fy * sx;
    return .{
        sx, sy, sz, -(sx * eye.x + sy * eye.y + sz * eye.z),
        ux, uy, uz, -(ux * eye.x + uy * eye.y + uz * eye.z),
        fx, fy, fz, -(fx * eye.x + fy * eye.y + fz * eye.z),
        0,  0,  0,  1,
    };
}

pub fn m4perspective(fovRadians: f32, aspect: f32, near: f32, far: f32) Mat4 {
    const f = 1.0 / @tan(fovRadians / 2.0);
    const ri = 1.0 / (near - far);
    return .{
        f / aspect, 0, 0,                 0,
        0,          f, 0,                 0,
        0,          0, (near + far) * ri, 2 * near * far * ri,
        0,          0, -1,                0,
    };
}

pub fn m4ortho(left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32) Mat4 {
    const rl = 1.0 / (right - left);
    const tb = 1.0 / (top - bottom);
    const nf = 1.0 / (near - far);
    return .{
        2 * rl, 0,      0,      -(right + left) * rl,
        0,      2 * tb, 0,      -(top + bottom) * tb,
        0,      0,      2 * nf, (far + near) * nf,
        0,      0,      0,      1,
    };
}

pub fn m4transformPoint(m: Mat4, v: Vec3) Vec3 {
    const w = m[12] * v.x + m[13] * v.y + m[14] * v.z + m[15];
    const invW = if (@abs(w) > EPSILON) 1.0 / w else 1.0;
    return .{
        .x = (m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3]) * invW,
        .y = (m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7]) * invW,
        .z = (m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11]) * invW,
    };
}

pub fn m4transformDir(m: Mat4, v: Vec3) Vec3 {
    return .{
        .x = m[0] * v.x + m[1] * v.y + m[2] * v.z,
        .y = m[4] * v.x + m[5] * v.y + m[6] * v.z,
        .z = m[8] * v.x + m[9] * v.y + m[10] * v.z,
    };
}

pub fn m4fromQuat(q: Quat) Mat4 {
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;
    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yy = qy * y2;
    const yz = qy * z2;
    const zz = qz * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;
    return .{
        1 - yy - zz, xy - wz,     xz + wy,     0,
        xy + wz,     1 - xx - zz, yz - wx,     0,
        xz - wy,     yz + wx,     1 - xx - yy, 0,
        0,           0,           0,           1,
    };
}

pub fn m4fromEuler(x: f32, y: f32, z: f32) Mat4 {
    const cx = @cos(x);
    const sx = @sin(x);
    const cy = @cos(y);
    const sy = @sin(y);
    const cz = @cos(z);
    const sz = @sin(z);
    return .{
        cy * cz, cy * sz * sx - sy * cx, cy * sz * cx + sy * sx, 0,
        sy * cz, sy * sz * sx + cy * cx, sy * sz * cx - cy * sx, 0,
        -sz,     cz * sx,                cz * cx,                0,
        0,       0,                      0,                      1,
    };
}

pub fn m4decompose(m: Mat4) Decomposed {
    const sx = utils.length3(m[0], m[4], m[8]);
    const sy = utils.length3(m[1], m[5], m[9]);
    const sz = utils.length3(m[2], m[6], m[10]);
    const isx = if (sx > EPSILON) 1.0 / sx else 0.0;
    const isy = if (sy > EPSILON) 1.0 / sy else 0.0;
    const isz = if (sz > EPSILON) 1.0 / sz else 0.0;
    const r00 = m[0] * isx;
    const r01 = m[1] * isy;
    const r02 = m[2] * isz;
    const r10 = m[4] * isx;
    const r11 = m[5] * isy;
    const r12 = m[6] * isz;
    const r20 = m[8] * isx;
    const r21 = m[9] * isy;
    const r22 = m[10] * isz;
    const trace = r00 + r11 + r22;

    var qx: f32 = undefined;
    var qy: f32 = undefined;
    var qz: f32 = undefined;
    var qw: f32 = undefined;

    if (trace > 0) {
        const s = 0.5 / @sqrt(trace + 1);
        qw = 0.25 / s;
        qx = (r21 - r12) * s;
        qy = (r02 - r20) * s;
        qz = (r10 - r01) * s;
    } else if (r00 > r11 and r00 > r22) {
        const s = 2 * @sqrt(1 + r00 - r11 - r22);
        qw = (r21 - r12) / s;
        qx = 0.25 * s;
        qy = (r01 + r10) / s;
        qz = (r02 + r20) / s;
    } else if (r11 > r22) {
        const s = 2 * @sqrt(1 + r11 - r00 - r22);
        qw = (r02 - r20) / s;
        qx = (r01 + r10) / s;
        qy = 0.25 * s;
        qz = (r12 + r21) / s;
    } else {
        const s = 2 * @sqrt(1 + r22 - r00 - r11);
        qw = (r10 - r01) / s;
        qx = (r02 + r20) / s;
        qy = (r12 + r21) / s;
        qz = 0.25 * s;
    }

    return .{
        .translation = .{ .x = m[3], .y = m[7], .z = m[11] },
        .rotation = .{ .x = qx, .y = qy, .z = qz, .w = qw },
        .scale = .{ .x = sx, .y = sy, .z = sz },
    };
}

test "mat4 identity multiply" {
    const id = m4identity();
    const result = m4multiply(id, id);
    try std.testing.expectEqual(id, result);
}
