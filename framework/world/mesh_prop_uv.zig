//! Resident mesh-prop face-material UV support. Paint and assigned face
//! materials deliberately keep separate vertex views: paint owns the original
//! atlas UVs; a live material selects the expanded face-local view.

const std = @import("std");

pub const Error = std.mem.Allocator.Error || error{InvalidUvCount};

fn readF32(data: []const u8, at: usize) f32 {
    return @bitCast(std.mem.readInt(u32, data[at..][0..4], .little));
}

/// Expand a packed pair-per-vertex wire block into a second stride-8 view.
pub fn expand(
    allocator: std.mem.Allocator,
    base_vertices: []const f32,
    vertex_count: u32,
    packed_uvs: []const u8,
) Error![]f32 {
    const count: usize = @intCast(vertex_count);
    if (base_vertices.len != count * 8 or packed_uvs.len != count * 2 * 4) return error.InvalidUvCount;
    const material_vertices = try allocator.dupe(f32, base_vertices);
    var vertex: usize = 0;
    while (vertex < count) : (vertex += 1) {
        material_vertices[vertex * 8 + 6] = readF32(packed_uvs, vertex * 8);
        material_vertices[vertex * 8 + 7] = readF32(packed_uvs, vertex * 8 + 4);
    }
    return material_vertices;
}

/// Select without copying. `override_active=false` always preserves paint UVs.
pub fn verticesForOverride(
    base_vertices: []const f32,
    material_vertices: ?[]const f32,
    override_active: bool,
) []const f32 {
    return if (override_active) material_vertices orelse base_vertices else base_vertices;
}
