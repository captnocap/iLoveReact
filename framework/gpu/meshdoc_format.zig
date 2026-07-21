//! Small wire-boundary invariants shared by the resident mesh owner and RJMD writer.

const std = @import("std");

/// A durable Outliner table is exactly one sorted, non-overlapping [lo,hi) pair
/// per declared part. Extra, missing, empty, or crossed ranges are all corruption.
pub fn rangesValid(pairs: ?[]const u32, expected_count: u32) bool {
    if (expected_count == 0) return pairs == null or pairs.?.len == 0;
    const values = pairs orelse return false;
    const count: usize = @intCast(expected_count);
    if (count > std.math.maxInt(usize) / 2 or values.len != count * 2) return false;
    var previous_hi: u32 = 0;
    for (0..count) |index| {
        const lo = values[index * 2];
        const hi = values[index * 2 + 1];
        if (hi <= lo or (index > 0 and lo < previous_hi)) return false;
        previous_hi = hi;
    }
    return true;
}

pub const NO_FACE_GROUP: u32 = std.math.maxInt(u32);
pub const NO_FACE_MATERIAL: u32 = std.math.maxInt(u32);

/// One resident slice of a model document. The visible mesh is one block and every
/// host-stashed hidden Outliner part is another. Geometry stays host-resident; this
/// shape exists only long enough to build the atomic RJMD write snapshot.
pub const FaceBlock = struct {
    verts: []const f32,
    groups: ?[]const u32,
    materials: ?[]const u32,
    colors: ?[]const u8,
};

pub const Snapshot = struct {
    verts: []f32,
    groups: ?[]u32,
    materials: ?[]u32,
    glass_first_vertex: u32,

    pub fn deinit(self: *Snapshot, allocator: std.mem.Allocator) void {
        allocator.free(self.verts);
        if (self.groups) |rows| allocator.free(rows);
        if (self.materials) |rows| allocator.free(rows);
        self.* = undefined;
    }
};

fn faceCount(block: FaceBlock) error{InvalidFaceBlock}!usize {
    if (block.verts.len == 0 or block.verts.len % 24 != 0) return error.InvalidFaceBlock;
    const faces = block.verts.len / 24;
    if (block.groups) |rows| if (rows.len != faces) return error.InvalidFaceBlock;
    if (block.materials) |rows| if (rows.len != faces) return error.InvalidFaceBlock;
    if (block.colors) |rows| if (rows.len != faces * 4) return error.InvalidFaceBlock;
    return faces;
}

/// Assemble the durable model from the displayed block plus every hidden-part block.
/// Faces are stably partitioned opaque-then-glass because RJMD stores one trailing
/// glass boundary. Missing colour rows mean opaque; missing materials mean "use paint".
pub fn composeSnapshot(allocator: std.mem.Allocator, blocks: []const FaceBlock) !Snapshot {
    if (blocks.len == 0) return error.InvalidFaceBlock;
    var total_faces: usize = 0;
    var has_groups = false;
    var has_materials = false;
    for (blocks) |block| {
        total_faces = std.math.add(usize, total_faces, try faceCount(block)) catch return error.InvalidFaceBlock;
        has_groups = has_groups or block.groups != null;
        if (block.materials) |rows| {
            for (rows) |material| if (material != NO_FACE_MATERIAL) {
                has_materials = true;
                break;
            };
        }
    }
    if (total_faces == 0 or total_faces > std.math.maxInt(u32) / 3) return error.InvalidFaceBlock;
    if (has_groups) for (blocks) |block| if (block.groups == null) return error.InvalidFaceBlock;

    const verts = try allocator.alloc(f32, total_faces * 24);
    errdefer allocator.free(verts);
    const groups: ?[]u32 = if (has_groups) try allocator.alloc(u32, total_faces) else null;
    errdefer if (groups) |rows| allocator.free(rows);
    const materials: ?[]u32 = if (has_materials) try allocator.alloc(u32, total_faces) else null;
    errdefer if (materials) |rows| allocator.free(rows);

    var output_face: usize = 0;
    var opaque_faces: usize = 0;
    inline for (.{ true, false }) |want_opaque| {
        for (blocks) |block| {
            const faces = try faceCount(block);
            for (0..faces) |face| {
                const is_opaque = if (block.colors) |rows| rows[face * 4 + 3] >= 250 else true;
                if (is_opaque != want_opaque) continue;
                @memcpy(verts[output_face * 24 .. output_face * 24 + 24], block.verts[face * 24 .. face * 24 + 24]);
                if (groups) |rows| rows[output_face] = block.groups.?[face];
                if (materials) |rows| rows[output_face] = if (block.materials) |source| source[face] else NO_FACE_MATERIAL;
                output_face += 1;
                if (want_opaque) opaque_faces += 1;
            }
        }
    }
    if (output_face != total_faces) return error.InvalidFaceBlock;
    return .{
        .verts = verts,
        .groups = groups,
        .materials = materials,
        .glass_first_vertex = @intCast(opaque_faces * 3),
    };
}

/// A multipart RJMD is valid only when every serialized face belongs to exactly one
/// declared range and every declared Outliner row owns at least one serialized face.
/// This is the last guard against writing metadata-only parts after a visibility bug.
pub fn rangesOwnEveryFace(pairs: ?[]const u32, groups: ?[]const u32, expected_count: u32) bool {
    if (!rangesValid(pairs, expected_count) or expected_count == 0) return false;
    const ranges = pairs.?;
    const face_groups = groups orelse return false;
    const seen = std.heap.c_allocator.alloc(bool, expected_count) catch return false;
    defer std.heap.c_allocator.free(seen);
    @memset(seen, false);
    for (face_groups) |group| {
        if (group == NO_FACE_GROUP) return false;
        var owner: ?usize = null;
        for (0..expected_count) |index| {
            if (group >= ranges[index * 2] and group < ranges[index * 2 + 1]) {
                owner = index;
                break;
            }
        }
        const index = owner orelse return false;
        seen[index] = true;
    }
    for (seen) |present| if (!present) return false;
    return true;
}
