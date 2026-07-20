const std = @import("std");

pub const OP_INK_COLOR: u8 = 0;
pub const OP_INK_MATERIAL: u8 = 1;
pub const OP_DAB: u8 = 2;
pub const OP_FILL: u8 = 3;
pub const OP_DAB_SHAPED: u8 = 4;

/// A live dab is necessarily the newest write into the shared atlas.  Once a
/// stroke commits, replay is required when that direct write does not already
/// match the layer composite: the active layer is hidden, or a visible layer
/// sits above it.
pub fn strokeCommitNeedsReplay(active_visible: bool, has_visible_layer_above: bool) bool {
    return !active_visible or has_visible_layer_above;
}

/// Operand byte count for a tag (bytes AFTER the tag byte), or null for unknown tags.
pub fn operandSize(tag: u8) ?usize {
    return switch (tag) {
        OP_INK_COLOR => 3,
        OP_INK_MATERIAL => 2,
        OP_DAB => 24,
        OP_FILL => 8,
        OP_DAB_SHAPED => 44,
        else => null,
    };
}

const Fill = struct {
    offset: usize,
    key: u64,
};

/// Byte offsets (of the TAG byte) of OP_FILL ops that are REDUNDANT in this stream:
/// for each (group, ord) face key, every fill except the LAST is redundant, because a
/// fill hard-overwrites the face's full fixed texel coverage. Offsets are returned
/// ascending, caller owns the slice (may be empty). Scanning STOPS at the first
/// unknown tag or truncated operand — exactly where replay execution also stops.
pub fn redundantFillOffsets(gpa: std.mem.Allocator, ops: []const u8) std.mem.Allocator.Error![]usize {
    var fills: std.ArrayList(Fill) = .empty;
    defer fills.deinit(gpa);
    var last_by_key: std.AutoHashMapUnmanaged(u64, usize) = .empty;
    defer last_by_key.deinit(gpa);

    var p: usize = 0;
    while (p < ops.len) {
        const offset = p;
        const tag = ops[p];
        p += 1;
        const operand_size = operandSize(tag) orelse break;
        if (operand_size > ops.len - p) break;
        if (tag == OP_FILL) {
            const group = std.mem.readInt(u32, ops[p..][0..4], .little);
            const ord = std.mem.readInt(u32, ops[p + 4 ..][0..4], .little);
            const key = (@as(u64, group) << 32) | ord;
            try fills.append(gpa, .{ .offset = offset, .key = key });
            try last_by_key.put(gpa, key, offset);
        }
        p += operand_size;
    }

    var redundant: std.ArrayList(usize) = .empty;
    errdefer redundant.deinit(gpa);
    for (fills.items) |fill| {
        if (fill.offset != last_by_key.get(fill.key).?) try redundant.append(gpa, fill.offset);
    }
    return redundant.toOwnedSlice(gpa);
}
