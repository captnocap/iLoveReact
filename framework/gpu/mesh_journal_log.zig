//! Read-only diagnostics for the resident mesh-edit journal.
//!
//! The journal itself lives in 3d.zig because it owns GPU/editor state. This
//! module deliberately sees only borrowed slices, turning them into a compact
//! ownership summary and JSON. Keeping the analysis pure gives the right-click
//! history viewer a strict boundary and makes corrupt group/range metadata
//! testable without booting the renderer.

const std = @import("std");

pub const NO_FACE_GROUP: u32 = std.math.maxInt(u32);

pub const StateView = struct {
    vertex_count: u32,
    groups: ?[]const u32 = null,
    part_ranges: ?[]const u32 = null,
    hidden_parts: usize = 0,
    bytes: usize = 0,
    note: ?[]const u8 = null,
};

pub const EntryView = struct {
    label: []const u8,
    state: StateView,
};

pub const LogView = struct {
    capacity: usize,
    byte_budget: usize,
    journal_bytes: usize,
    pending_gizmo: bool,
    pending_loop_cut: bool,
    undo: []const EntryView,
    current: StateView,
    redo: []const EntryView,
};

pub const PartSummary = struct {
    lo: u32,
    hi: u32,
    faces: usize,
};

pub const StateSummary = struct {
    vertices: u32,
    triangles: usize,
    group_rows: usize,
    groups_match_triangles: bool,
    authored_groups: usize,
    parts: []PartSummary,
    ranges_valid: bool,
    unowned_faces: usize,
    multiply_owned_faces: usize,
    ownership_valid: bool,
    hidden_parts: usize,
    bytes: usize,

    pub fn deinit(self: *StateSummary, allocator: std.mem.Allocator) void {
        allocator.free(self.parts);
        self.* = undefined;
    }
};

/// True only when [lo,hi) is one complete pair in the current host partition.
/// A contained subrange is not a part: accepting it is how a stale outliner
/// range silently cloned only some of a loop-cut mesh.
pub fn hasExactPartRange(ranges: []const u32, lo: u32, hi: u32) bool {
    if (hi <= lo or ranges.len % 2 != 0) return false;
    var index: usize = 0;
    while (index + 1 < ranges.len) : (index += 2) {
        if (ranges[index] == lo and ranges[index + 1] == hi) return true;
    }
    return false;
}

fn structurallyValidRanges(ranges: []const u32) bool {
    if (ranges.len % 2 != 0) return false;
    var previous_hi: u32 = 0;
    var i: usize = 0;
    while (i + 1 < ranges.len) : (i += 2) {
        const lo = ranges[i];
        const hi = ranges[i + 1];
        if (hi <= lo) return false;
        if (i != 0 and lo < previous_hi) return false;
        previous_hi = hi;
    }
    return true;
}

fn findPart(parts: []const PartSummary, group: u32) ?usize {
    var lo: usize = 0;
    var hi: usize = parts.len;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        const part = parts[mid];
        if (group < part.lo) {
            hi = mid;
        } else if (group >= part.hi) {
            lo = mid + 1;
        } else return mid;
    }
    return null;
}

/// Summarize one mesh state and prove whether every triangle belongs to exactly
/// one valid outliner range. Valid partitions take O(faces log parts); only an
/// already-invalid range table falls back to the diagnostic O(faces * parts)
/// overlap count.
pub fn analyze(allocator: std.mem.Allocator, view: StateView) !StateSummary {
    const triangles: usize = @intCast(view.vertex_count / 3);
    const group_rows = if (view.groups) |groups| groups.len else 0;
    const groups_match = if (view.groups) |groups| groups.len == triangles else triangles == 0;
    const ranges = view.part_ranges orelse &.{};
    const pair_count = ranges.len / 2;
    const ranges_valid = structurallyValidRanges(ranges);

    const parts = try allocator.alloc(PartSummary, pair_count);
    errdefer allocator.free(parts);
    for (parts, 0..) |*part, index| {
        part.* = .{
            .lo = ranges[index * 2],
            .hi = ranges[index * 2 + 1],
            .faces = 0,
        };
    }

    var distinct = std.AutoHashMapUnmanaged(u32, void){};
    defer distinct.deinit(allocator);
    if (view.groups) |groups| {
        for (groups) |group| {
            if (group != NO_FACE_GROUP) try distinct.put(allocator, group, {});
        }
    }

    var unowned: usize = 0;
    var multiply_owned: usize = 0;
    var face: usize = 0;
    while (face < triangles) : (face += 1) {
        const group = if (view.groups) |groups|
            (if (face < groups.len) groups[face] else NO_FACE_GROUP)
        else
            NO_FACE_GROUP;
        if (group == NO_FACE_GROUP) {
            unowned += 1;
            continue;
        }

        if (ranges_valid) {
            if (findPart(parts, group)) |part_index| {
                parts[part_index].faces += 1;
            } else unowned += 1;
            continue;
        }

        var owners: usize = 0;
        for (parts) |*part| {
            if (part.hi > part.lo and group >= part.lo and group < part.hi) {
                part.faces += 1;
                owners += 1;
            }
        }
        if (owners == 0) unowned += 1 else if (owners > 1) multiply_owned += 1;
    }

    return .{
        .vertices = view.vertex_count,
        .triangles = triangles,
        .group_rows = group_rows,
        .groups_match_triangles = groups_match,
        .authored_groups = distinct.count(),
        .parts = parts,
        .ranges_valid = ranges_valid,
        .unowned_faces = unowned,
        .multiply_owned_faces = multiply_owned,
        .ownership_valid = groups_match and ranges_valid and unowned == 0 and multiply_owned == 0,
        .hidden_parts = view.hidden_parts,
        .bytes = view.bytes,
    };
}

fn writeJsonString(writer: anytype, value: []const u8) !void {
    try writer.writeByte('"');
    for (value) |byte| switch (byte) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11...12, 14...31 => try writer.print("\\u{x:0>4}", .{byte}),
        else => try writer.writeByte(byte),
    };
    try writer.writeByte('"');
}

fn writeState(writer: anytype, allocator: std.mem.Allocator, view: StateView) !void {
    var summary = try analyze(allocator, view);
    defer summary.deinit(allocator);

    try writer.print(
        "{{\"vertices\":{d},\"triangles\":{d},\"groupRows\":{d},\"groupsMatchTriangles\":{s},\"authoredGroups\":{d},\"parts\":[",
        .{
            summary.vertices,
            summary.triangles,
            summary.group_rows,
            if (summary.groups_match_triangles) "true" else "false",
            summary.authored_groups,
        },
    );
    for (summary.parts, 0..) |part, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.print("{{\"lo\":{d},\"hi\":{d},\"faces\":{d}}}", .{ part.lo, part.hi, part.faces });
    }
    try writer.print(
        "],\"rangesValid\":{s},\"unownedFaces\":{d},\"multiplyOwnedFaces\":{d},\"ownershipValid\":{s},\"hiddenParts\":{d},\"bytes\":{d},\"note\":",
        .{
            if (summary.ranges_valid) "true" else "false",
            summary.unowned_faces,
            summary.multiply_owned_faces,
            if (summary.ownership_valid) "true" else "false",
            summary.hidden_parts,
            summary.bytes,
        },
    );
    if (view.note) |note| try writeJsonString(writer, note) else try writer.writeAll("null");
    try writer.writeByte('}');
}

fn writeEntries(writer: anytype, allocator: std.mem.Allocator, entries: []const EntryView) !void {
    try writer.writeByte('[');
    for (entries, 0..) |entry, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"label\":");
        try writeJsonString(writer, entry.label);
        try writer.writeAll(",\"state\":");
        try writeState(writer, allocator, entry.state);
        try writer.writeByte('}');
    }
    try writer.writeByte(']');
}

/// Encode the complete bounded journal. Undo is oldest-to-newest; redo is the
/// order it would be replayed (next redo first), with current between them.
pub fn encode(allocator: std.mem.Allocator, log: LogView) ![]u8 {
    var out = std.ArrayList(u8){};
    errdefer out.deinit(allocator);
    const writer = out.writer(allocator);
    try writer.print(
        "{{\"version\":1,\"capacity\":{d},\"byteBudget\":{d},\"journalBytes\":{d},\"pending\":{{\"gizmo\":{s},\"loopCut\":{s}}},\"undo\":",
        .{
            log.capacity,
            log.byte_budget,
            log.journal_bytes,
            if (log.pending_gizmo) "true" else "false",
            if (log.pending_loop_cut) "true" else "false",
        },
    );
    try writeEntries(writer, allocator, log.undo);
    try writer.writeAll(",\"current\":");
    try writeState(writer, allocator, log.current);
    try writer.writeAll(",\"redo\":");
    try writeEntries(writer, allocator, log.redo);
    try writer.writeByte('}');
    return out.toOwnedSlice(allocator);
}
