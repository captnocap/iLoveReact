//! Fixed editor-live light wire. This module is intentionally allocation-free:
//! V8 ingress owns copying, while this boundary validates/clamps one borrowed
//! Float32 payload into the loader's small semantic Light rows.

const std = @import("std");

pub const FLOATS_PER_LIGHT: usize = 14;
pub const MAX_LIGHTS: usize = 256;

pub const Light = struct {
    kind: enum { point, spot },
    position: [3]f32,
    direction: [3]f32,
    color: [3]f32,
    intensity: f32,
    range: f32,
    cone_degrees: f32,
    casts_shadow: bool,
};

fn readF32(bytes: []const u8, float_index: usize) f32 {
    return std.mem.bytesToValue(f32, bytes[float_index * @sizeOf(f32) ..][0..@sizeOf(f32)]);
}

fn finiteOr(value: f32, fallback: f32) f32 {
    return if (std.math.isFinite(value)) value else fallback;
}

fn unitDirection(raw: [3]f32) [3]f32 {
    const x = finiteOr(raw[0], 0);
    const y = finiteOr(raw[1], -1);
    const z = finiteOr(raw[2], 0);
    const length = @sqrt(x * x + y * y + z * z);
    if (!std.math.isFinite(length) or length < 0.000001) return .{ 0, -1, 0 };
    return .{ x / length, y / length, z / length };
}

/// Decode complete rows only. A malformed tail is ignored, non-finite values
/// fall back safely, and output never exceeds either caller capacity or the GPU
/// light budget.
pub fn decode(bytes: []const u8, out: []Light) usize {
    const byte_stride = FLOATS_PER_LIGHT * @sizeOf(f32);
    const count = @min(@min(bytes.len / byte_stride, out.len), MAX_LIGHTS);
    for (out[0..count], 0..) |*light, index| {
        const base = index * FLOATS_PER_LIGHT;
        const spot = finiteOr(readF32(bytes, base), 0) >= 0.5;
        light.* = .{
            .kind = if (spot) .spot else .point,
            .position = .{
                finiteOr(readF32(bytes, base + 1), 0),
                finiteOr(readF32(bytes, base + 2), 0),
                finiteOr(readF32(bytes, base + 3), 0),
            },
            .direction = unitDirection(.{
                readF32(bytes, base + 4),
                readF32(bytes, base + 5),
                readF32(bytes, base + 6),
            }),
            .color = .{
                std.math.clamp(finiteOr(readF32(bytes, base + 7), 1), 0, 1),
                std.math.clamp(finiteOr(readF32(bytes, base + 8), 1), 0, 1),
                std.math.clamp(finiteOr(readF32(bytes, base + 9), 1), 0, 1),
            },
            .intensity = std.math.clamp(finiteOr(readF32(bytes, base + 10), 0), 0, 20),
            .range = std.math.clamp(finiteOr(readF32(bytes, base + 11), 0.1), 0.1, 100),
            .cone_degrees = std.math.clamp(finiteOr(readF32(bytes, base + 12), 32), 5, 85),
            .casts_shadow = spot and finiteOr(readF32(bytes, base + 13), 0) >= 0.5,
        };
    }
    return count;
}
