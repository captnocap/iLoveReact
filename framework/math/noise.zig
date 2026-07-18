//! noise.zig — Perlin noise (2D, 3D) and fBm.
//!
//! Grep target: `noise2d`, `noise3d`, `fbm2d`, `fbm3d`.
//!
//! The Perlin fade function is the same quintic S-curve as smootherstep —
//! we share `utils.smootherstepCurve`.

const std = @import("std");
const utils = @import("utils.zig");

const perm = [256]u8{
    151, 160, 137, 91,  90,  15,  131, 13,  201, 95,  96,  53,  194, 233, 7,   225,
    140, 36,  103, 30,  69,  142, 8,   99,  37,  240, 21,  10,  23,  190, 6,   148,
    247, 120, 234, 75,  0,   26,  197, 62,  94,  252, 219, 203, 117, 35,  11,  32,
    57,  177, 33,  88,  237, 149, 56,  87,  174, 20,  125, 136, 171, 168, 68,  175,
    74,  165, 71,  134, 139, 48,  27,  166, 77,  146, 158, 231, 83,  111, 229, 122,
    60,  211, 133, 230, 220, 105, 92,  41,  55,  46,  245, 40,  244, 102, 143, 54,
    65,  25,  63,  161, 1,   216, 80,  73,  209, 76,  132, 187, 208, 89,  18,  169,
    200, 196, 135, 130, 116, 188, 159, 86,  164, 100, 109, 198, 173, 186, 3,   64,
    52,  217, 226, 250, 124, 123, 5,   202, 38,  147, 118, 126, 255, 82,  85,  212,
    207, 206, 59,  227, 47,  16,  58,  17,  182, 189, 28,  42,  223, 183, 170, 213,
    119, 248, 152, 2,   44,  154, 163, 70,  221, 153, 101, 155, 167, 43,  172, 9,
    129, 22,  39,  253, 19,  98,  108, 110, 79,  113, 224, 232, 178, 185, 112, 104,
    218, 246, 97,  228, 251, 34,  242, 193, 238, 210, 144, 12,  191, 179, 162, 241,
    81,  51,  145, 235, 249, 14,  239, 107, 49,  192, 214, 31,  181, 199, 106, 157,
    254, 157, 115, 66,  180, 156, 126, 1,   20,  69,  173, 92,  52,  28,  56,  233,
    127, 236, 243, 215, 128, 205, 184, 176, 195, 204, 138, 222, 121, 114, 67,  29,
};

// Doubled permutation table (512 entries, 0-indexed)
const p = blk: {
    var table: [512]u8 = undefined;
    for (0..256) |i| {
        table[i] = perm[i];
        table[i + 256] = perm[i];
    }
    break :blk table;
};

fn grad2d(hash: u32, x: f32, y: f32) f32 {
    const h = hash % 8;
    return switch (h) {
        0 => x + y,
        1 => -x + y,
        2 => x - y,
        3 => -x - y,
        4 => x,
        5 => -x,
        6 => y,
        else => -y,
    };
}

fn grad3d(hash: u32, x: f32, y: f32, z: f32) f32 {
    const h = hash % 12;
    return switch (h) {
        0 => x + y,
        1 => -x + y,
        2 => x - y,
        3 => -x - y,
        4 => x + z,
        5 => -x + z,
        6 => x - z,
        7 => -x - z,
        8 => y + z,
        9 => -y + z,
        10 => y - z,
        else => -y - z,
    };
}

pub fn noise2d(x_in: f32, y_in: f32, seed: f32) f32 {
    const x = x_in + seed * 31.7;
    const y = y_in + seed * 17.3;
    const xi: u32 = @intCast(@as(i32, @floor(x)) & 255);
    const yi: u32 = @intCast(@as(i32, @floor(y)) & 255);
    const xf = x - @floor(x);
    const yf = y - @floor(y);
    const u = utils.smootherstepCurve(xf);
    const v = utils.smootherstepCurve(yf);
    const aa: u32 = @as(u32, p[@as(u32, p[xi]) + yi]);
    const ab: u32 = @as(u32, p[@as(u32, p[xi]) + yi + 1]);
    const ba: u32 = @as(u32, p[@as(u32, p[xi + 1]) + yi]);
    const bb: u32 = @as(u32, p[@as(u32, p[xi + 1]) + yi + 1]);
    const x1 = grad2d(aa, xf, yf) + (grad2d(ba, xf - 1, yf) - grad2d(aa, xf, yf)) * u;
    const x2 = grad2d(ab, xf, yf - 1) + (grad2d(bb, xf - 1, yf - 1) - grad2d(ab, xf, yf - 1)) * u;
    return x1 + (x2 - x1) * v;
}

pub fn noise3d(x_in: f32, y_in: f32, z_in: f32, seed: f32) f32 {
    const x = x_in + seed * 31.7;
    const y = y_in + seed * 17.3;
    const z = z_in + seed * 23.1;
    const xi: u32 = @intCast(@as(i32, @floor(x)) & 255);
    const yi: u32 = @intCast(@as(i32, @floor(y)) & 255);
    const zi: u32 = @intCast(@as(i32, @floor(z)) & 255);
    const xf = x - @floor(x);
    const yf = y - @floor(y);
    const zf = z - @floor(z);
    const u = utils.smootherstepCurve(xf);
    const v = utils.smootherstepCurve(yf);
    const w = utils.smootherstepCurve(zf);
    const aaa: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi]) + yi]) + zi]);
    const aba: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi]) + yi + 1]) + zi]);
    const aab: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi]) + yi]) + zi + 1]);
    const abb: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi]) + yi + 1]) + zi + 1]);
    const baa: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi + 1]) + yi]) + zi]);
    const bba: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi + 1]) + yi + 1]) + zi]);
    const bab: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi + 1]) + yi]) + zi + 1]);
    const bbb: u32 = @as(u32, p[@as(u32, p[@as(u32, p[xi + 1]) + yi + 1]) + zi + 1]);
    const x1a = grad3d(aaa, xf, yf, zf) + (grad3d(baa, xf - 1, yf, zf) - grad3d(aaa, xf, yf, zf)) * u;
    const x2a = grad3d(aba, xf, yf - 1, zf) + (grad3d(bba, xf - 1, yf - 1, zf) - grad3d(aba, xf, yf - 1, zf)) * u;
    const y1 = x1a + (x2a - x1a) * v;
    const x1b = grad3d(aab, xf, yf, zf - 1) + (grad3d(bab, xf - 1, yf, zf - 1) - grad3d(aab, xf, yf, zf - 1)) * u;
    const x2b = grad3d(abb, xf, yf - 1, zf - 1) + (grad3d(bbb, xf - 1, yf - 1, zf - 1) - grad3d(abb, xf, yf - 1, zf - 1)) * u;
    const y2 = x1b + (x2b - x1b) * v;
    return y1 + (y2 - y1) * w;
}

pub fn fbm2d(x: f32, y: f32, octaves: u32, seed: f32, lacunarity: f32, persistence: f32) f32 {
    var total: f32 = 0;
    var amplitude: f32 = 1;
    var frequency: f32 = 1;
    var maxValue: f32 = 0;
    for (0..octaves) |_| {
        total += noise2d(x * frequency, y * frequency, seed) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    return total / maxValue;
}

pub fn fbm3d(x: f32, y: f32, z: f32, octaves: u32, seed: f32, lacunarity: f32, persistence: f32) f32 {
    var total: f32 = 0;
    var amplitude: f32 = 1;
    var frequency: f32 = 1;
    var maxValue: f32 = 0;
    for (0..octaves) |_| {
        total += noise3d(x * frequency, y * frequency, z * frequency, seed) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    return total / maxValue;
}

test "noise2d returns bounded values" {
    const val = noise2d(1.5, 2.5, 0);
    try std.testing.expect(val >= -2 and val <= 2);
}
