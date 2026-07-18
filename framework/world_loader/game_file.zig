//! Game-file input compatibility boundary.

const std = @import("std");
const host_io = @import("../host_io.zig");
const RJMP_MAGIC = @import("config.zig").RJMP_MAGIC;

pub fn loadGameFile(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    // 256MB read cap. Real editor bakes are a few MB; the headroom is for the
    // procedural scale lab (`rjit game play --massive --blocks N`), where the
    // instance buffer alone can run to hundreds of MB — we want the test to probe
    // the GPU/physics limit, not an artificial I/O wall.
    const raw = try std.Io.Dir.cwd().readFileAlloc(host_io.io(), path, allocator, .limited(256 << 20));
    if (raw.len >= 4 and std.mem.readInt(u32, raw[0..4], .little) == RJMP_MAGIC) return raw;
    defer allocator.free(raw);
    const trimmed = std.mem.trim(u8, raw, " \t\r\n");
    const dec = std.base64.standard.Decoder;
    const size = try dec.calcSizeForSlice(trimmed);
    const out = try allocator.alloc(u8, size);
    errdefer allocator.free(out);
    try dec.decode(out, trimmed);
    return out;
}
