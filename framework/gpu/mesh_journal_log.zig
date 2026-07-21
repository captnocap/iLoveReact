//! Pure vocabulary, restore policy, and diagnostics for the resident model journal.
//!
//! The journal itself lives in 3d.zig because it owns GPU/editor state. This
//! module deliberately sees only borrowed slices: it maps semantic actions, converts
//! UV coordinates, and turns history into a compact ownership summary/JSON. Keeping
//! that analysis pure gives every caller a strict boundary and makes restore policy
//! plus corrupt group/range metadata testable without booting the renderer.

const std = @import("std");

pub const NO_FACE_GROUP: u32 = std.math.maxInt(u32);
pub const MAX_METADATA_NOTE_BYTES: usize = 1024 * 1024;

/// Semantic vocabulary for every geometry mutation admitted by the resident
/// mesh journal. Ordinals are a bridge contract with
/// cart/editor/model/nativeMeshEvents.ts; append new values, never reorder.
pub const ActionKind = enum(u8) {
    extrude_face,
    extrude_edge,
    create_face,
    loop_cut,
    symmetrize,
    delete_selection,
    delete_part,
    add_part,
    hide_part,
    show_part,
    duplicate_part,
    mirror_part,
    path_array,
    detach_faces,
    merge_parts,
    flip_faces,
    merge_faces,
    glass_faces,
    solidify_faces,
    split_quads,
    transform,
    nudge,
    scale_by_value,
    uv_edit,
    uv_texture_import,
    uv_texture_reload,
};

/// UV edit ordinals are a bridge contract with cart/editor/model/uvHistory.ts.
/// Append new actions; never reorder an existing one.
pub const UvAction = enum(u8) {
    move,
    vertex,
    rotate,
    scale,
    flip_u,
    flip_v,
    numeric,
    match_width,
    match_height,
    match_size,
    chain_horizontal,
    chain_vertical,
    pack,
};

pub const UV_TEXTURE_IMPORT_LABEL = "import UV texture";
pub const UV_TEXTURE_RELOAD_LABEL = "reload UV texture";
pub const UV_EQUIVALENCE_EPSILON: f32 = 0.0001;

pub fn uvActionLabel(raw: i32) ?[]const u8 {
    const action = std.enums.fromInt(UvAction, raw) orelse return null;
    return switch (action) {
        .move => "move UV islands",
        .vertex => "move UV vertex",
        .rotate => "rotate UV",
        .scale => "scale UV",
        .flip_u => "flip UV U",
        .flip_v => "flip UV V",
        .numeric => "edit UV values",
        .match_width => "match UV width",
        .match_height => "match UV height",
        .match_size => "match UV size",
        .chain_horizontal => "chain UV horizontally",
        .chain_vertical => "chain UV vertically",
        .pack => "pack UV islands",
    };
}

pub const ActionPhase = enum(u8) { applied, undone, redone };

/// Invocation-source ordinals mirror runtime/commands CommandSource. Native is
/// the safe default for engine-owned gizmo/input commits.
pub const ActionSource = enum(u8) {
    native,
    menu,
    hotkey,
    toolbar,
    dock,
    context_menu,
    palette,
    viewport,
    remote,
    automation,
};

pub const ActionEvent = struct {
    id: u32,
    document_token: u32,
    kind: ActionKind,
    phase: ActionPhase,
    source: ActionSource,
    before_vertices: u32,
    after_vertices: u32,
    before_parts: u32,
    after_parts: u32,
    dropped_before: u32 = 0,
};

pub fn actionKindForLabel(label: []const u8) ?ActionKind {
    const labels = [_]struct { []const u8, ActionKind }{
        .{ "extrude face", .extrude_face },
        .{ "extrude edge", .extrude_edge },
        .{ "create face", .create_face },
        .{ "loop cut", .loop_cut },
        .{ "symmetrize", .symmetrize },
        .{ "delete selection", .delete_selection },
        .{ "delete part", .delete_part },
        .{ "add part", .add_part },
        .{ "hide part", .hide_part },
        .{ "show part", .show_part },
        .{ "duplicate part", .duplicate_part },
        .{ "mirror part", .mirror_part },
        .{ "path array", .path_array },
        .{ "detach faces", .detach_faces },
        .{ "merge parts", .merge_parts },
        .{ "flip faces", .flip_faces },
        .{ "merge faces", .merge_faces },
        .{ "glass faces", .glass_faces },
        .{ "solidify faces", .solidify_faces },
        .{ "split quads", .split_quads },
        .{ "transform", .transform },
        .{ "nudge", .nudge },
        .{ "scale by value", .scale_by_value },
        .{ "move UV islands", .uv_edit },
        .{ "move UV vertex", .uv_edit },
        .{ "rotate UV", .uv_edit },
        .{ "scale UV", .uv_edit },
        .{ "flip UV U", .uv_edit },
        .{ "flip UV V", .uv_edit },
        .{ "edit UV values", .uv_edit },
        .{ "match UV width", .uv_edit },
        .{ "match UV height", .uv_edit },
        .{ "match UV size", .uv_edit },
        .{ "chain UV horizontally", .uv_edit },
        .{ "chain UV vertically", .uv_edit },
        .{ "pack UV islands", .uv_edit },
        .{ UV_TEXTURE_IMPORT_LABEL, .uv_texture_import },
        .{ UV_TEXTURE_RELOAD_LABEL, .uv_texture_reload },
    };
    for (labels) |row| if (std.mem.eql(u8, label, row[0])) return row[1];
    return null;
}

pub fn actionCommandId(kind: ActionKind) []const u8 {
    return switch (kind) {
        .extrude_face => "model.mesh.extrude-face",
        .extrude_edge => "model.mesh.extrude-edge",
        .create_face => "model.mesh.create-face",
        .loop_cut => "model.mesh.loop-cut",
        .symmetrize => "model.mesh.symmetrize",
        .delete_selection => "model.mesh.delete-selection",
        .delete_part => "model.mesh.delete-part",
        .add_part => "model.mesh.add-part",
        .hide_part => "model.mesh.hide-part",
        .show_part => "model.mesh.show-part",
        .duplicate_part => "model.mesh.duplicate-part",
        .mirror_part => "model.mesh.mirror-part",
        .path_array => "model.mesh.path-array",
        .detach_faces => "model.mesh.detach-faces",
        .merge_parts => "model.mesh.merge-parts",
        .flip_faces => "model.mesh.flip-faces",
        .merge_faces => "model.mesh.merge-faces",
        .glass_faces => "model.mesh.glass-faces",
        .solidify_faces => "model.mesh.solidify-faces",
        .split_quads => "model.mesh.split-quads",
        .transform => "model.mesh.transform",
        .nudge => "model.mesh.nudge",
        .scale_by_value => "model.mesh.scale-by",
        .uv_edit => "model.uv.edit",
        .uv_texture_import => "model.uv.import-texture",
        .uv_texture_reload => "model.uv.reload-texture",
    };
}

/// Structural edits change the set/grouping of UV islands.  A previously
/// authored atlas is then stale and painting must remain locked until the user
/// explicitly rebuilds it. Position-only, visibility, material, and metadata
/// edits preserve the UV contract.
pub fn actionInvalidatesPaintLayout(kind: ActionKind) bool {
    return switch (kind) {
        .extrude_face,
        .extrude_edge,
        .create_face,
        .loop_cut,
        .delete_selection,
        .delete_part,
        .add_part,
        .duplicate_part,
        .mirror_part,
        .path_array,
        .detach_faces,
        .merge_parts,
        .merge_faces,
        .solidify_faces,
        .split_quads,
        .symmetrize,
        => true,
        .hide_part,
        .show_part,
        .flip_faces,
        .glass_faces,
        .transform,
        .nudge,
        .scale_by_value,
        .uv_edit,
        .uv_texture_import,
        .uv_texture_reload,
        => false,
    };
}

pub const RestoreDomain = enum { mesh, uv, atlas };

/// The resident journal is chronological across mesh and UV authoring, but each
/// state kind has a different exact restore boundary.
pub fn restoreDomainForLabel(label: []const u8) RestoreDomain {
    const kind = actionKindForLabel(label) orelse return .mesh;
    return switch (kind) {
        .uv_edit => .uv,
        .uv_texture_import, .uv_texture_reload => .atlas,
        else => .mesh,
    };
}

/// Convert an interleaved mesh snapshot's normalized UV columns into the exact
/// absolute corner table consumed by model_paint.applyCornerUvs.
pub fn writeAtlasCornersFromInterleavedUv(
    verts: []const f32,
    vertex_count: u32,
    atlas_width: u32,
    atlas_height: u32,
    out: []f32,
) bool {
    if (atlas_width == 0 or atlas_height == 0) return false;
    const vertices: usize = @intCast(vertex_count);
    if (verts.len < vertices * 8 or out.len != vertices * 2) return false;
    const width: f32 = @floatFromInt(atlas_width);
    const height: f32 = @floatFromInt(atlas_height);
    for (0..vertices) |vertex| {
        const u = verts[vertex * 8 + 6];
        const v = verts[vertex * 8 + 7];
        if (!std.math.isFinite(u) or !std.math.isFinite(v)) return false;
        out[vertex * 2 + 0] = u * width;
        out[vertex * 2 + 1] = v * height;
    }
    return true;
}

/// Cheap no-op gate used before allocating a full journal snapshot.
pub fn atlasCornersMatchInterleavedUv(
    verts: []const f32,
    vertex_count: u32,
    atlas_width: u32,
    atlas_height: u32,
    corners: []const f32,
) bool {
    if (atlas_width == 0 or atlas_height == 0) return false;
    const vertices: usize = @intCast(vertex_count);
    if (verts.len < vertices * 8 or corners.len != vertices * 2) return false;
    const width: f32 = @floatFromInt(atlas_width);
    const height: f32 = @floatFromInt(atlas_height);
    for (0..vertices) |vertex| {
        const expected_x = verts[vertex * 8 + 6] * width;
        const expected_y = verts[vertex * 8 + 7] * height;
        const actual_x = corners[vertex * 2 + 0];
        const actual_y = corners[vertex * 2 + 1];
        if (!std.math.isFinite(expected_x) or !std.math.isFinite(expected_y) or
            !std.math.isFinite(actual_x) or !std.math.isFinite(actual_y)) return false;
        if (@abs(expected_x - actual_x) > UV_EQUIVALENCE_EPSILON or
            @abs(expected_y - actual_y) > UV_EQUIVALENCE_EPSILON) return false;
    }
    return true;
}

/// Metadata-only model actions share the resident mesh journal so Ctrl-Z keeps
/// one chronological document history. Reject inert or unbounded checkpoints
/// before the journal allocates a full mesh snapshot.
pub fn metadataCheckpointValid(before: []const u8, after: []const u8) bool {
    return before.len > 0 and after.len > 0 and
        before.len <= MAX_METADATA_NOTE_BYTES and after.len <= MAX_METADATA_NOTE_BYTES and
        !std.mem.eql(u8, before, after);
}

/// Strict vocabulary for metadata-only journal actions. The V8 door and the
/// cart command registry must meet here; keeping it in this testable module
/// prevents a new outliner command from looking accepted in JS while the host
/// silently refuses its checkpoint.
pub fn metadataCheckpointLabel(kind: []const u8) ?[]const u8 {
    const actions = [_]struct { []const u8, []const u8 }{
        .{ "part.rename", "rename part" },
        .{ "parts.group", "group parts" },
        .{ "parts.ungroup", "ungroup parts" },
        .{ "group.rename", "rename group" },
        .{ "group.dissolve", "dissolve group" },
        .{ "outliner.move", "move outliner item" },
    };
    for (actions) |action| if (std.mem.eql(u8, kind, action[0])) return action[1];
    return null;
}

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

pub const TopologyView = struct {
    welded_vertices: u32,
    triangle_edges: u32,
    editable_edges: u32,
};

pub const LogView = struct {
    capacity: usize,
    byte_budget: usize,
    journal_bytes: usize,
    pending_gizmo: bool,
    pending_loop_cut: bool,
    // Live tool state, not undo state. Empty scope ranges means whole-model.
    scope_ranges: []const u32 = &.{},
    topology: ?TopologyView = null,
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

/// Prove the boundary required before a structural outliner append: the host has
/// exactly the number of parts the cart says are already present, its ranges are
/// ordered/disjoint, and every resident face belongs to one of them.  Appending
/// while this is false would turn a metadata disagreement into shared edit
/// identity (coincident vertices then weld under the wrong part).
pub fn ownsExactPartPartition(groups: []const u32, ranges: []const u32, expected_parts: usize) bool {
    if (ranges.len != expected_parts * 2 or !structurallyValidRanges(ranges)) return false;
    if (groups.len == 0) return expected_parts == 0;
    if (expected_parts == 0) return false;
    for (groups) |group| {
        if (group == NO_FACE_GROUP or findPartInRanges(ranges, group) == null) return false;
    }
    var range_index: usize = 0;
    while (range_index + 1 < ranges.len) : (range_index += 2) {
        var owns_face = false;
        for (groups) |group| {
            if (group >= ranges[range_index] and group < ranges[range_index + 1]) {
                owns_face = true;
                break;
            }
        }
        if (!owns_face) return false;
    }
    return true;
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

fn findPartInRanges(ranges: []const u32, group: u32) ?usize {
    var lo: usize = 0;
    var hi: usize = ranges.len / 2;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (group < ranges[mid * 2]) {
            hi = mid;
        } else if (group >= ranges[mid * 2 + 1]) {
            lo = mid + 1;
        } else return mid;
    }
    return null;
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

    var distinct = std.AutoHashMapUnmanaged(u32, void).empty;
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
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();
    const writer = &out.writer;
    try writer.print(
        "{{\"version\":1,\"capacity\":{d},\"byteBudget\":{d},\"journalBytes\":{d},\"pending\":{{\"gizmo\":{s},\"loopCut\":{s}}},\"scope\":{{\"ranges\":[",
        .{
            log.capacity,
            log.byte_budget,
            log.journal_bytes,
            if (log.pending_gizmo) "true" else "false",
            if (log.pending_loop_cut) "true" else "false",
        },
    );
    var scope_index: usize = 0;
    while (scope_index + 1 < log.scope_ranges.len) : (scope_index += 2) {
        if (scope_index != 0) try writer.writeByte(',');
        try writer.print("[{d},{d}]", .{ log.scope_ranges[scope_index], log.scope_ranges[scope_index + 1] });
    }
    try writer.writeAll("]},\"topology\":");
    if (log.topology) |topology| {
        try writer.print(
            "{{\"weldedVertices\":{d},\"triangleEdges\":{d},\"editableEdges\":{d}}}",
            .{ topology.welded_vertices, topology.triangle_edges, topology.editable_edges },
        );
    } else try writer.writeAll("null");
    try writer.writeAll(",\"undo\":");
    try writeEntries(writer, allocator, log.undo);
    try writer.writeAll(",\"current\":");
    try writeState(writer, allocator, log.current);
    try writer.writeAll(",\"redo\":");
    try writeEntries(writer, allocator, log.redo);
    try writer.writeByte('}');
    return out.toOwnedSlice();
}
