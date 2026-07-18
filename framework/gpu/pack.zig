//! Shared per-row quantizers for slim GPU instance/vertex formats.
//!
//! The slim-instance series (SlimInstance 24B, InstanceData 32B) proved the
//! pattern: store the FACTORS at the precision each field actually needs and
//! let the vertex stage widen them back — the fixed-function vertex fetch
//! decodes unorm/f16 formats to f32 for free. These helpers are the ONE
//! encode side of that contract; the decode side is the wgpu vertex format
//! declared in each pipeline's attribute layout (unorm8x4, float16x2, …).
//! Keep both in lockstep.
//!
//! Every per-frame pool (capsules, polys, curves, glyphs, rects, icons) and
//! the mesh vertex packer route through here — one clamp policy, one
//! rounding policy, no per-file drift.

const std = @import("std");

/// f32 [0,1] → unorm8. Out-of-range input clamps (a color channel outside
/// [0,1] is already meaningless for 8-bit display output).
pub inline fn unorm8(c: f32) u8 {
    return @round(std.math.clamp(c, 0.0, 1.0) * 255.0);
}

/// Pack an rgba color (4 × f32 [0,1]) into the unorm8x4 vertex-format row.
pub inline fn rgba8(r: f32, g: f32, b: f32, a: f32) [4]u8 {
    return .{ unorm8(r), unorm8(g), unorm8(b), unorm8(a) };
}

/// f32 [0,1] → unorm16 (atlas UVs, normalized sizes).
pub inline fn unorm16(v: f32) u16 {
    return @round(std.math.clamp(v, 0.0, 1.0) * 65535.0);
}

/// f32 → IEEE half (float16x* vertex formats). Full float range — NOT a
/// fixed-max unorm — so a large value degrades in precision, never clips.
pub inline fn f16FromF32(v: f32) f16 {
    return @floatCast(v);
}

/// Octahedral-encode a (not necessarily normalized) normal into snorm16x2.
/// The standard octahedron mapping: project onto the |x|+|y|+|z|=1 octahedron,
/// fold the lower hemisphere over the diagonals. Decode (WGSL side) is
/// oct_decode in shaders.zig — keep in lockstep. A zero-length normal encodes
/// as +Y rather than NaN (degenerate triangles shouldn't poison the fetch).
pub fn octEncodeSnorm16(nx: f32, ny: f32, nz: f32) [2]i16 {
    const len = @abs(nx) + @abs(ny) + @abs(nz);
    if (len < 1e-12) return .{ 0, std.math.maxInt(i16) }; // +Y
    var ox = nx / len;
    var oy = ny / len;
    if (nz < 0.0) {
        const fx = (1.0 - @abs(oy)) * (if (ox >= 0.0) @as(f32, 1.0) else @as(f32, -1.0));
        const fy = (1.0 - @abs(ox)) * (if (oy >= 0.0) @as(f32, 1.0) else @as(f32, -1.0));
        ox = fx;
        oy = fy;
    }
    const snorm = struct {
        fn q(v: f32) i16 {
            return @round(std.math.clamp(v, -1.0, 1.0) * 32767.0);
        }
    };
    return .{ snorm.q(ox), snorm.q(oy) };
}
