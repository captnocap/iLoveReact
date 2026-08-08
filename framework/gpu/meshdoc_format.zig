//! Small wire-boundary invariants shared by the resident mesh owner and RJMD writer.

const std = @import("std");
const mesh_edge_semantics = @import("mesh_edge_semantics.zig");

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
    groups: ?[]const u32 = null,
    materials: ?[]const u32 = null,
    semantic_regions: ?[]const u32 = null,
    semantic_instances: ?[]const u32 = null,
    /// One native edit-vertex id per lowered render corner. These ids may be sparse
    /// while the editor is live; composeSnapshot performs the one durable dense
    /// compaction shared by RJMD and the skin-binding writer.
    render_corner_logical_ids: ?[]const u32 = null,
    colors: ?[]const u8 = null,
};

pub const Snapshot = struct {
    verts: []f32,
    groups: ?[]u32,
    materials: ?[]u32,
    semantic_regions: ?[]u32,
    semantic_instances: ?[]u32,
    /// Dense RJMD ids in render-corner order. Null preserves the v1-v4 prop path.
    render_corner_logical_ids: ?[]u32,
    logical_vertex_count: u32,
    /// Reverse half of the save-snapshot remap: dense id -> resident native id.
    /// The character skin writer consumes this exact table instead of compacting
    /// topology independently.
    dense_to_stable_logical_ids: ?[]u32,
    semantic_table_json: ?[]u8,
    glass_first_vertex: u32,

    pub fn deinit(self: *Snapshot, allocator: std.mem.Allocator) void {
        allocator.free(self.verts);
        if (self.groups) |rows| allocator.free(rows);
        if (self.materials) |rows| allocator.free(rows);
        if (self.semantic_regions) |rows| allocator.free(rows);
        if (self.semantic_instances) |rows| allocator.free(rows);
        if (self.render_corner_logical_ids) |rows| allocator.free(rows);
        if (self.dense_to_stable_logical_ids) |rows| allocator.free(rows);
        if (self.semantic_table_json) |json| allocator.free(json);
        self.* = undefined;
    }
};

pub const MAGIC: u32 = 0x444D4A52;
pub const VERSION_LOGICAL_TOPOLOGY: u32 = 5;
pub const MAX_SEMANTIC_TABLE_BYTES: usize = 1024 * 1024;

/// Owned decoder result for the persisted RJMD document. Editor save assembly
/// and runtime character loading share this reader so a file cannot be accepted
/// by one side and interpreted differently by the other. Versions 1-4 remain
/// valid prop documents; character callers additionally require `version == 5`
/// and the non-null logical-id table.
pub const Document = struct {
    version: u32,
    verts: []f32,
    groups: ?[]u32,
    materials: ?[]u32,
    semantic_regions: ?[]u32,
    semantic_instances: ?[]u32,
    ranges: []u32,
    render_corner_logical_ids: ?[]u32,
    logical_vertex_count: u32,
    semantic_table_json: ?[]u8,
    /// Stable Outliner object IDs paired to `ranges` by their persisted [lo,hi)
    /// values. RJMD v5 stores this table inside semantic JSON so the binary section
    /// order stays unchanged; v1-v4 documents never synthesize it.
    range_object_ids: ?[][]u8,
    glass_first_vertex: ?u32,

    pub fn deinit(self: *Document, allocator: std.mem.Allocator) void {
        allocator.free(self.verts);
        if (self.groups) |rows| allocator.free(rows);
        if (self.materials) |rows| allocator.free(rows);
        if (self.semantic_regions) |rows| allocator.free(rows);
        if (self.semantic_instances) |rows| allocator.free(rows);
        allocator.free(self.ranges);
        if (self.render_corner_logical_ids) |rows| allocator.free(rows);
        if (self.range_object_ids) |rows| {
            for (rows) |object_id| allocator.free(object_id);
            allocator.free(rows);
        }
        if (self.semantic_table_json) |json| allocator.free(json);
        self.* = undefined;
    }
};

pub const DecodeError = std.mem.Allocator.Error || error{
    InvalidDocument,
    UnsupportedVersion,
    IntegerOverflow,
};

pub const EncodeError = std.mem.Allocator.Error || error{
    InvalidSnapshot,
    SizeOverflow,
};

pub const RangeObjectMetadataError = std.mem.Allocator.Error || error{
    InvalidRangeObjectMetadata,
};

/// Rebind semantic edge paths to the sole dense logical-id snapshot. Face-only
/// tables are preserved through the same strict parser, so callers never need to
/// guess whether a future semantic field contains topology identity.
pub fn semanticTableForLogicalSnapshotAlloc(
    allocator: std.mem.Allocator,
    semantic_json: []const u8,
    dense_to_stable_logical_ids: []const u32,
) ![]u8 {
    return mesh_edge_semantics.remapForSnapshotAlloc(
        allocator,
        semantic_json,
        dense_to_stable_logical_ids,
    );
}

fn rangeObjectJsonU32(value: std.json.Value) RangeObjectMetadataError!u32 {
    return switch (value) {
        .integer => |integer| if (integer >= 0 and integer <= std.math.maxInt(u32))
            @intCast(integer)
        else
            error.InvalidRangeObjectMetadata,
        else => error.InvalidRangeObjectMetadata,
    };
}

fn freeRangeObjectIds(allocator: std.mem.Allocator, rows: [][]u8, initialized: usize) void {
    for (rows[0..initialized]) |object_id| allocator.free(object_id);
    allocator.free(rows);
}

/// Decode the v5 range/object association embedded in the trailing semantic JSON.
/// Missing metadata is surfaced as null so the generic RJMD reader can still inspect
/// an unbound v5 document; strict character consumers reject that null explicitly.
pub fn rangeObjectIdsAlloc(
    allocator: std.mem.Allocator,
    semantic_json: []const u8,
    ranges: []const u32,
) RangeObjectMetadataError!?[][]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, semantic_json, .{}) catch
        return error.InvalidRangeObjectMetadata;
    defer parsed.deinit();
    const root = switch (parsed.value) {
        .object => |object| object,
        else => return error.InvalidRangeObjectMetadata,
    };
    const value = root.get("rangeObjects") orelse return null;
    const items = switch (value) {
        .array => |array| array.items,
        else => return error.InvalidRangeObjectMetadata,
    };
    if (items.len == 0 or ranges.len != items.len * 2 or
        items.len > std.math.maxInt(u32) or !rangesValid(ranges, @intCast(items.len)))
    {
        return error.InvalidRangeObjectMetadata;
    }
    const result = try allocator.alloc([]u8, items.len);
    var initialized: usize = 0;
    errdefer freeRangeObjectIds(allocator, result, initialized);
    for (items, 0..) |item, index| {
        const object = switch (item) {
            .object => |map| map,
            else => return error.InvalidRangeObjectMetadata,
        };
        const object_id = switch (object.get("objectId") orelse return error.InvalidRangeObjectMetadata) {
            .string => |text| text,
            else => return error.InvalidRangeObjectMetadata,
        };
        if (object_id.len == 0 or std.mem.indexOfScalar(u8, object_id, 0) != null) {
            return error.InvalidRangeObjectMetadata;
        }
        const lo = try rangeObjectJsonU32(object.get("lo") orelse return error.InvalidRangeObjectMetadata);
        const hi = try rangeObjectJsonU32(object.get("hi") orelse return error.InvalidRangeObjectMetadata);
        if (lo != ranges[index * 2] or hi != ranges[index * 2 + 1]) {
            return error.InvalidRangeObjectMetadata;
        }
        for (result[0..initialized]) |prior| if (std.mem.eql(u8, prior, object_id)) {
            return error.InvalidRangeObjectMetadata;
        };
        result[index] = try allocator.dupe(u8, object_id);
        initialized += 1;
    }
    return result;
}

/// Preserve the semantic dictionary while stamping stable object IDs against the
/// exact native range table. This changes only the trailing JSON bytes: RJMD's
/// ranges → logical IDs → semantic JSON section order remains untouched.
pub fn semanticTableWithRangeObjectIdsAlloc(
    allocator: std.mem.Allocator,
    semantic_json: []const u8,
    ranges: []const u32,
    range_object_ids: []const []const u8,
) RangeObjectMetadataError![]u8 {
    if (semantic_json.len == 0 or range_object_ids.len == 0 or
        ranges.len != range_object_ids.len * 2 or
        range_object_ids.len > std.math.maxInt(u32) or
        !rangesValid(ranges, @intCast(range_object_ids.len)))
    {
        return error.InvalidRangeObjectMetadata;
    }
    for (range_object_ids, 0..) |object_id, index| {
        if (object_id.len == 0 or std.mem.indexOfScalar(u8, object_id, 0) != null) {
            return error.InvalidRangeObjectMetadata;
        }
        for (range_object_ids[0..index]) |prior| if (std.mem.eql(u8, prior, object_id)) {
            return error.InvalidRangeObjectMetadata;
        };
    }

    var parsed = std.json.parseFromSlice(std.json.Value, allocator, semantic_json, .{}) catch
        return error.InvalidRangeObjectMetadata;
    defer parsed.deinit();
    const root = switch (parsed.value) {
        .object => |*object| object,
        else => return error.InvalidRangeObjectMetadata,
    };
    const arena = parsed.arena.allocator();
    var objects = std.json.Array.init(arena);
    for (range_object_ids, 0..) |object_id, index| {
        var row = std.json.ObjectMap.empty;
        try row.put(arena, "objectId", .{ .string = object_id });
        try row.put(arena, "lo", .{ .integer = ranges[index * 2] });
        try row.put(arena, "hi", .{ .integer = ranges[index * 2 + 1] });
        try objects.append(.{ .object = row });
    }
    try root.put(arena, "rangeObjects", .{ .array = objects });
    return try std.json.Stringify.valueAlloc(allocator, parsed.value, .{});
}

fn writeU32(bytes: []u8, at: *usize, value: u32) void {
    std.mem.writeInt(u32, bytes[at.*..][0..4], value, .little);
    at.* += 4;
}

fn writeF32(bytes: []u8, at: *usize, value: f32) void {
    writeU32(bytes, at, @bitCast(value));
}

fn encodeSnapshotVersionAlloc(
    allocator: std.mem.Allocator,
    snapshot: *const Snapshot,
    ranges: []const u32,
    version: u32,
) EncodeError![]u8 {
    if (version != 4 and version != VERSION_LOGICAL_TOPOLOGY) return error.InvalidSnapshot;
    if (snapshot.verts.len == 0 or snapshot.verts.len % 24 != 0) return error.InvalidSnapshot;
    const vertex_count = snapshot.verts.len / 8;
    const face_count = vertex_count / 3;
    if (vertex_count > std.math.maxInt(u32) or face_count > std.math.maxInt(u32) or ranges.len % 2 != 0) {
        return error.InvalidSnapshot;
    }
    const groups = snapshot.groups;
    const materials = snapshot.materials;
    const semantic_regions = snapshot.semantic_regions;
    const semantic_instances = snapshot.semantic_instances;
    const logical_ids = snapshot.render_corner_logical_ids;
    const semantic_json = snapshot.semantic_table_json orelse &.{};
    if ((groups != null and groups.?.len != face_count) or
        (materials != null and materials.?.len != face_count) or
        (semantic_regions == null) != (semantic_instances == null) or
        (semantic_regions != null and (semantic_regions.?.len != face_count or semantic_instances.?.len != face_count)) or
        (logical_ids != null and (logical_ids.?.len != vertex_count or snapshot.logical_vertex_count == 0)) or
        (logical_ids == null and snapshot.logical_vertex_count != 0) or
        (semantic_regions == null and semantic_json.len != 0))
    {
        return error.InvalidSnapshot;
    }
    const range_count: u32 = @intCast(ranges.len / 2);
    if (!rangesValid(ranges, range_count) or !rangesOwnEveryFace(ranges, groups, range_count)) {
        return error.InvalidSnapshot;
    }
    if (logical_ids) |rows| {
        if (!logicalRowsValid(allocator, snapshot.verts, rows, snapshot.logical_vertex_count, true)) {
            return error.InvalidSnapshot;
        }
    }
    if (version == 4 and logical_ids != null) return error.InvalidSnapshot;
    const header_bytes: usize = if (version == VERSION_LOGICAL_TOPOLOGY) 48 else 40;
    var total = header_bytes;
    total = std.math.add(usize, total, std.math.mul(usize, snapshot.verts.len, 4) catch return error.SizeOverflow) catch return error.SizeOverflow;
    if (groups) |rows| total = std.math.add(usize, total, rows.len * 4) catch return error.SizeOverflow;
    if (materials) |rows| total = std.math.add(usize, total, rows.len * 4) catch return error.SizeOverflow;
    if (semantic_regions) |rows| {
        total = std.math.add(usize, total, rows.len * 8) catch return error.SizeOverflow;
    }
    total = std.math.add(usize, total, ranges.len * 4) catch return error.SizeOverflow;
    if (logical_ids) |rows| total = std.math.add(usize, total, rows.len * 4) catch return error.SizeOverflow;
    total = std.math.add(usize, total, semantic_json.len) catch return error.SizeOverflow;
    if (semantic_json.len > std.math.maxInt(u32)) return error.SizeOverflow;

    const bytes = try allocator.alloc(u8, total);
    errdefer allocator.free(bytes);
    var at: usize = 0;
    writeU32(bytes, &at, MAGIC);
    writeU32(bytes, &at, version);
    writeU32(bytes, &at, @intCast(vertex_count));
    writeU32(bytes, &at, @intCast(face_count));
    writeU32(bytes, &at, if (groups != null) 1 else 0);
    writeU32(bytes, &at, range_count);
    writeU32(bytes, &at, @min(snapshot.glass_first_vertex, @as(u32, @intCast(vertex_count))));
    writeU32(bytes, &at, if (materials != null) 1 else 0);
    writeU32(bytes, &at, if (semantic_regions != null) 1 else 0);
    writeU32(bytes, &at, @intCast(semantic_json.len));
    if (version == VERSION_LOGICAL_TOPOLOGY) {
        writeU32(bytes, &at, if (logical_ids != null) 1 else 0);
        writeU32(bytes, &at, snapshot.logical_vertex_count);
    }
    for (snapshot.verts) |value| writeF32(bytes, &at, value);
    if (groups) |rows| for (rows) |value| writeU32(bytes, &at, value);
    if (materials) |rows| for (rows) |value| writeU32(bytes, &at, value);
    if (semantic_regions) |rows| {
        for (rows) |value| writeU32(bytes, &at, value);
        for (semantic_instances.?) |value| writeU32(bytes, &at, value);
    }
    for (ranges) |value| writeU32(bytes, &at, value);
    if (logical_ids) |rows| for (rows) |value| writeU32(bytes, &at, value);
    @memcpy(bytes[at..][0..semantic_json.len], semantic_json);
    at += semantic_json.len;
    std.debug.assert(at == bytes.len);
    return bytes;
}

/// Encode one immutable save snapshot. `composeSnapshot` already performed the
/// sole stable→dense logical remap; callers must pass this exact snapshot to any
/// companion RJSK writer rather than rebuilding topology independently.
///
/// This compatibility entry point retains the existing envelope choice: v5 for
/// logical character snapshots and v4 for non-logical prop snapshots. New durable
/// writes should use `encodeCurrentSnapshotAlloc`, which always emits current v5.
pub fn encodeSnapshotAlloc(
    allocator: std.mem.Allocator,
    snapshot: *const Snapshot,
    ranges: []const u32,
) EncodeError![]u8 {
    const version: u32 = if (snapshot.render_corner_logical_ids != null)
        VERSION_LOGICAL_TOPOLOGY
    else
        4;
    return encodeSnapshotVersionAlloc(allocator, snapshot, ranges, version);
}

const EMPTY_SEMANTIC_TABLE = "{\"version\":1,\"regions\":[]}";

/// Encode the canonical current RJMD envelope. Current v5 is valid both with a
/// dense logical topology and without one; the latter is represented explicitly
/// by `hasLogicalVertices=0, logicalVertexCount=0`, never by silently choosing v4.
/// Every supplied face channel is serialized exactly as supplied.
pub fn encodeCurrentSnapshotAlloc(
    allocator: std.mem.Allocator,
    snapshot: *const Snapshot,
    ranges: []const u32,
) EncodeError![]u8 {
    var persisted = snapshot.*;

    // Decoded pre-v4 inputs may express an absent semantic channel as two explicit
    // empty slices. Normalize only that absence spelling; non-empty channels remain
    // strict and must have one row per face.
    if (persisted.semantic_regions != null and persisted.semantic_instances != null and
        persisted.semantic_regions.?.len == 0 and persisted.semantic_instances.?.len == 0 and
        (persisted.semantic_table_json == null or persisted.semantic_table_json.?.len == 0))
    {
        persisted.semantic_regions = null;
        persisted.semantic_instances = null;
        persisted.semantic_table_json = null;
    } else if (persisted.semantic_regions != null and
        (persisted.semantic_table_json == null or persisted.semantic_table_json.?.len == 0))
    {
        // Semantic rows without a dictionary are still a complete, readable v5
        // channel: the empty dictionary is its canonical table.
        persisted.semantic_table_json = @constCast(EMPTY_SEMANTIC_TABLE);
    }

    if (persisted.semantic_table_json) |semantic_json| {
        if (semantic_json.len > MAX_SEMANTIC_TABLE_BYTES) return error.InvalidSnapshot;
        const range_object_ids = rangeObjectIdsAlloc(
            allocator,
            semantic_json,
            ranges,
        ) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.InvalidRangeObjectMetadata => return error.InvalidSnapshot,
        };
        defer if (range_object_ids) |rows| freeRangeObjectIds(allocator, rows, rows.len);
    }

    return encodeSnapshotVersionAlloc(
        allocator,
        &persisted,
        ranges,
        VERSION_LOGICAL_TOPOLOGY,
    );
}

/// Encode current v5 while stamping the exact stable Outliner object IDs paired
/// with each persisted range. Anonymous pre-v4 inputs have no semantic section in
/// which v5 can carry that metadata, so this function creates an explicitly
/// unassigned semantic row (`0xffffffff`) per face and an empty role dictionary.
/// It does not invent anatomy or logical welds.
pub fn encodeCurrentSnapshotWithRangeObjectIdsAlloc(
    allocator: std.mem.Allocator,
    snapshot: *const Snapshot,
    ranges: []const u32,
    range_object_ids: []const []const u8,
) EncodeError![]u8 {
    if (snapshot.verts.len == 0 or snapshot.verts.len % 24 != 0 or range_object_ids.len == 0) {
        return error.InvalidSnapshot;
    }
    const face_count = snapshot.verts.len / 24;
    if ((snapshot.semantic_regions == null) != (snapshot.semantic_instances == null)) {
        return error.InvalidSnapshot;
    }

    var persisted = snapshot.*;
    var unassigned_regions: ?[]u32 = null;
    defer if (unassigned_regions) |rows| allocator.free(rows);
    var unassigned_instances: ?[]u32 = null;
    defer if (unassigned_instances) |rows| allocator.free(rows);

    const semantics_absent = snapshot.semantic_regions == null or
        (snapshot.semantic_regions.?.len == 0 and snapshot.semantic_instances.?.len == 0);
    if (semantics_absent and snapshot.render_corner_logical_ids != null) {
        // A logical character snapshot has always required authored semantic rows.
        // Neutral synthesis is only the non-logical pre-v4 migration path.
        return error.InvalidSnapshot;
    }
    if (semantics_absent) {
        unassigned_regions = try allocator.alloc(u32, face_count);
        unassigned_instances = try allocator.alloc(u32, face_count);
        @memset(unassigned_regions.?, std.math.maxInt(u32));
        @memset(unassigned_instances.?, std.math.maxInt(u32));
        persisted.semantic_regions = unassigned_regions.?;
        persisted.semantic_instances = unassigned_instances.?;
    }

    const base_semantic_json = if (snapshot.semantic_table_json) |json|
        if (json.len > 0) json else EMPTY_SEMANTIC_TABLE
    else
        EMPTY_SEMANTIC_TABLE;
    const semantic_json = semanticTableWithRangeObjectIdsAlloc(
        allocator,
        base_semantic_json,
        ranges,
        range_object_ids,
    ) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.InvalidRangeObjectMetadata => return error.InvalidSnapshot,
    };
    defer allocator.free(semantic_json);
    persisted.semantic_table_json = semantic_json;
    return encodeCurrentSnapshotAlloc(allocator, &persisted, ranges);
}

/// Character-save encoder: the geometry snapshot and skin exporter share the same
/// dense logical remap, while the stable object/range association is stamped into
/// the existing trailing semantic JSON section.
pub fn encodeSnapshotWithRangeObjectIdsAlloc(
    allocator: std.mem.Allocator,
    snapshot: *const Snapshot,
    ranges: []const u32,
    range_object_ids: []const []const u8,
) EncodeError![]u8 {
    if (snapshot.render_corner_logical_ids == null or snapshot.semantic_table_json == null) {
        return error.InvalidSnapshot;
    }
    const semantic_json = semanticTableWithRangeObjectIdsAlloc(
        allocator,
        snapshot.semantic_table_json.?,
        ranges,
        range_object_ids,
    ) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.InvalidRangeObjectMetadata => return error.InvalidSnapshot,
    };
    defer allocator.free(semantic_json);
    var persisted = snapshot.*;
    persisted.semantic_table_json = semantic_json;
    return encodeSnapshotAlloc(allocator, &persisted, ranges);
}

fn readU32(bytes: []const u8, at: usize) DecodeError!u32 {
    if (at > bytes.len or bytes.len - at < 4) return error.InvalidDocument;
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}

fn checkedBytes(count: u32, stride: usize) DecodeError!usize {
    return std.math.mul(usize, @as(usize, count), stride) catch error.IntegerOverflow;
}

fn takeF32Rows(allocator: std.mem.Allocator, bytes: []const u8, at: *usize, count: usize) DecodeError![]f32 {
    const byte_count = std.math.mul(usize, count, @sizeOf(f32)) catch return error.IntegerOverflow;
    if (at.* > bytes.len or bytes.len - at.* < byte_count) return error.InvalidDocument;
    const result = try allocator.alloc(f32, count);
    errdefer allocator.free(result);
    for (result, 0..) |*value, index| {
        value.* = @bitCast(try readU32(bytes, at.* + index * 4));
        if (!std.math.isFinite(value.*)) return error.InvalidDocument;
    }
    at.* += byte_count;
    return result;
}

fn takeU32Rows(allocator: std.mem.Allocator, bytes: []const u8, at: *usize, count: usize) DecodeError![]u32 {
    const byte_count = std.math.mul(usize, count, @sizeOf(u32)) catch return error.IntegerOverflow;
    if (at.* > bytes.len or bytes.len - at.* < byte_count) return error.InvalidDocument;
    const result = try allocator.alloc(u32, count);
    errdefer allocator.free(result);
    for (result, 0..) |*value, index| value.* = try readU32(bytes, at.* + index * 4);
    at.* += byte_count;
    return result;
}

/// Decode exactly one RJMD v1-v5 file. The result never borrows from `bytes`.
pub fn decodeDocument(allocator: std.mem.Allocator, bytes: []const u8) DecodeError!Document {
    if (bytes.len < 24 or try readU32(bytes, 0) != MAGIC) return error.InvalidDocument;
    const version = try readU32(bytes, 4);
    if (version < 1 or version > VERSION_LOGICAL_TOPOLOGY) return error.UnsupportedVersion;
    const header_bytes: usize = if (version >= 5) 48 else if (version >= 4) 40 else if (version >= 3) 32 else if (version >= 2) 28 else 24;
    if (bytes.len < header_bytes) return error.InvalidDocument;

    const vert_count = try readU32(bytes, 8);
    const face_count = try readU32(bytes, 12);
    const has_groups = try readU32(bytes, 16);
    const range_count = try readU32(bytes, 20);
    const glass_first_vertex: ?u32 = if (version >= 2) try readU32(bytes, 24) else null;
    const has_materials: u32 = if (version >= 3) try readU32(bytes, 28) else 0;
    const has_semantics: u32 = if (version >= 4) try readU32(bytes, 32) else 0;
    const semantic_json_bytes: u32 = if (version >= 4) try readU32(bytes, 36) else 0;
    const has_logical_vertices: u32 = if (version >= 5) try readU32(bytes, 40) else 0;
    const logical_vertex_count: u32 = if (version >= 5) try readU32(bytes, 44) else 0;

    if (vert_count == 0 or vert_count % 3 != 0 or face_count != vert_count / 3) return error.InvalidDocument;
    if (has_groups > 1 or has_materials > 1 or has_semantics > 1 or has_logical_vertices > 1) return error.InvalidDocument;
    if (has_semantics == 0 and semantic_json_bytes != 0) return error.InvalidDocument;
    if ((has_logical_vertices == 0 and logical_vertex_count != 0) or
        (has_logical_vertices == 1 and (logical_vertex_count == 0 or logical_vertex_count > vert_count)))
    {
        return error.InvalidDocument;
    }
    if (glass_first_vertex) |glass| {
        if (glass > vert_count or glass % 3 != 0) return error.InvalidDocument;
    }

    var at = header_bytes;
    const verts = try takeF32Rows(allocator, bytes, &at, try checkedBytes(vert_count, 8));
    errdefer allocator.free(verts);
    const groups: ?[]u32 = if (has_groups == 1)
        try takeU32Rows(allocator, bytes, &at, face_count)
    else
        null;
    errdefer if (groups) |rows| allocator.free(rows);
    const materials: ?[]u32 = if (has_materials == 1)
        try takeU32Rows(allocator, bytes, &at, face_count)
    else
        null;
    errdefer if (materials) |rows| allocator.free(rows);
    const semantic_regions: ?[]u32 = if (has_semantics == 1)
        try takeU32Rows(allocator, bytes, &at, face_count)
    else
        null;
    errdefer if (semantic_regions) |rows| allocator.free(rows);
    const semantic_instances: ?[]u32 = if (has_semantics == 1)
        try takeU32Rows(allocator, bytes, &at, face_count)
    else
        null;
    errdefer if (semantic_instances) |rows| allocator.free(rows);
    const range_rows = std.math.mul(usize, @as(usize, range_count), 2) catch return error.IntegerOverflow;
    const ranges = try takeU32Rows(allocator, bytes, &at, range_rows);
    errdefer allocator.free(ranges);
    if (range_count > 0 and !rangesValid(ranges, range_count)) return error.InvalidDocument;
    const logical_ids: ?[]u32 = if (has_logical_vertices == 1)
        try takeU32Rows(allocator, bytes, &at, vert_count)
    else
        null;
    errdefer if (logical_ids) |rows| allocator.free(rows);
    if (logical_ids) |rows| {
        if (!logicalRowsValid(allocator, verts, rows, logical_vertex_count, true)) return error.InvalidDocument;
    }

    const json_len: usize = semantic_json_bytes;
    if (at > bytes.len or bytes.len - at != json_len) return error.InvalidDocument;
    const semantic_table_json: ?[]u8 = if (has_semantics == 1) blk: {
        if (json_len == 0) return error.InvalidDocument;
        // Validate syntax here; semantic membership-to-role validation belongs to
        // the character hash/loader boundary where the authored role vocabulary is known.
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes[at..], .{}) catch return error.InvalidDocument;
        parsed.deinit();
        break :blk try allocator.dupe(u8, bytes[at..]);
    } else null;
    errdefer if (semantic_table_json) |json| allocator.free(json);
    const range_object_ids: ?[][]u8 = if (version >= VERSION_LOGICAL_TOPOLOGY and semantic_table_json != null)
        rangeObjectIdsAlloc(allocator, semantic_table_json.?, ranges) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.InvalidRangeObjectMetadata => return error.InvalidDocument,
        }
    else
        null;
    errdefer if (range_object_ids) |rows| freeRangeObjectIds(allocator, rows, rows.len);

    return .{
        .version = version,
        .verts = verts,
        .groups = groups,
        .materials = materials,
        .semantic_regions = semantic_regions,
        .semantic_instances = semantic_instances,
        .ranges = ranges,
        .render_corner_logical_ids = logical_ids,
        .logical_vertex_count = logical_vertex_count,
        .semantic_table_json = semantic_table_json,
        .range_object_ids = range_object_ids,
        .glass_first_vertex = glass_first_vertex,
    };
}

fn faceCount(block: FaceBlock) error{InvalidFaceBlock}!usize {
    if (block.verts.len == 0 or block.verts.len % 24 != 0) return error.InvalidFaceBlock;
    const faces = block.verts.len / 24;
    if (block.groups) |rows| if (rows.len != faces) return error.InvalidFaceBlock;
    if (block.materials) |rows| if (rows.len != faces) return error.InvalidFaceBlock;
    if (block.semantic_regions) |rows| if (rows.len != faces) return error.InvalidFaceBlock;
    if (block.semantic_instances) |rows| if (rows.len != faces) return error.InvalidFaceBlock;
    if ((block.semantic_regions == null) != (block.semantic_instances == null)) return error.InvalidFaceBlock;
    if (block.render_corner_logical_ids) |rows| if (rows.len != faces * 3) return error.InvalidFaceBlock;
    if (block.colors) |rows| if (rows.len != faces * 4) return error.InvalidFaceBlock;
    return faces;
}

const LogicalRecord = struct {
    position: [3]f32,
    dense: u32 = 0,
};

/// Validate one resident logical-id table. Live native ids may contain holes after
/// deletions, while an RJMD decoder passes `require_dense=true` to enforce the saved
/// [0, logical_vertex_count) contract. Duplicate render corners may split UVs and
/// normals, but their model-space positions must remain coincident at model scale.
pub fn logicalRowsValid(
    allocator: std.mem.Allocator,
    verts: []const f32,
    rows: []const u32,
    logical_vertex_count: u32,
    require_dense: bool,
) bool {
    if (logical_vertex_count == 0 or verts.len != rows.len * 8 or rows.len == 0) return false;
    var min = [3]f64{ std.math.inf(f64), std.math.inf(f64), std.math.inf(f64) };
    var max = [3]f64{ -std.math.inf(f64), -std.math.inf(f64), -std.math.inf(f64) };
    for (rows, 0..) |id, corner| {
        if (id >= logical_vertex_count) return false;
        const at = corner * 8;
        for (0..3) |axis| {
            const value = verts[at + axis];
            if (!std.math.isFinite(value)) return false;
            const wide: f64 = value;
            min[axis] = @min(min[axis], wide);
            max[axis] = @max(max[axis], wide);
        }
    }
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const tolerance = 0.000001 * @max(@as(f64, 1), @sqrt(dx * dx + dy * dy + dz * dz));
    const tolerance_sq = tolerance * tolerance;

    var records = std.AutoHashMapUnmanaged(u32, [3]f32).empty;
    defer records.deinit(allocator);
    for (rows, 0..) |id, corner| {
        const at = corner * 8;
        const position = [3]f32{ verts[at], verts[at + 1], verts[at + 2] };
        const entry = records.getOrPut(allocator, id) catch return false;
        if (!entry.found_existing) {
            entry.value_ptr.* = position;
            continue;
        }
        const prior = entry.value_ptr.*;
        const px: f64 = @as(f64, position[0]) - @as(f64, prior[0]);
        const py: f64 = @as(f64, position[1]) - @as(f64, prior[1]);
        const pz: f64 = @as(f64, position[2]) - @as(f64, prior[2]);
        if (px * px + py * py + pz * pz > tolerance_sq) return false;
    }
    return !require_dense or records.count() == logical_vertex_count;
}

/// Assemble the durable model from the displayed block plus every hidden-part block.
/// Faces are stably partitioned opaque-then-glass because RJMD stores one trailing
/// glass boundary. Missing colour rows mean opaque; missing materials mean "use paint".
pub fn composeSnapshot(allocator: std.mem.Allocator, blocks: []const FaceBlock) !Snapshot {
    if (blocks.len == 0) return error.InvalidFaceBlock;
    var total_faces: usize = 0;
    var has_groups = false;
    var has_materials = false;
    var has_semantics = false;
    var has_logical_vertices = false;
    for (blocks) |block| {
        total_faces = std.math.add(usize, total_faces, try faceCount(block)) catch return error.InvalidFaceBlock;
        has_groups = has_groups or block.groups != null;
        if (block.materials) |rows| {
            for (rows) |material| if (material != NO_FACE_MATERIAL) {
                has_materials = true;
                break;
            };
        }
        has_semantics = has_semantics or block.semantic_regions != null;
        has_logical_vertices = has_logical_vertices or block.render_corner_logical_ids != null;
    }
    if (total_faces == 0 or total_faces > std.math.maxInt(u32) / 3) return error.InvalidFaceBlock;
    if (has_groups) for (blocks) |block| if (block.groups == null) return error.InvalidFaceBlock;
    if (has_semantics) for (blocks) |block| if (block.semantic_regions == null or block.semantic_instances == null) return error.InvalidFaceBlock;
    if (has_logical_vertices) for (blocks) |block| if (block.render_corner_logical_ids == null) return error.InvalidFaceBlock;

    const verts = try allocator.alloc(f32, total_faces * 24);
    errdefer allocator.free(verts);
    const groups: ?[]u32 = if (has_groups) try allocator.alloc(u32, total_faces) else null;
    errdefer if (groups) |rows| allocator.free(rows);
    const materials: ?[]u32 = if (has_materials) try allocator.alloc(u32, total_faces) else null;
    errdefer if (materials) |rows| allocator.free(rows);
    const semantic_regions: ?[]u32 = if (has_semantics) try allocator.alloc(u32, total_faces) else null;
    errdefer if (semantic_regions) |rows| allocator.free(rows);
    const semantic_instances: ?[]u32 = if (has_semantics) try allocator.alloc(u32, total_faces) else null;
    errdefer if (semantic_instances) |rows| allocator.free(rows);
    const render_corner_logical_ids: ?[]u32 = if (has_logical_vertices) try allocator.alloc(u32, total_faces * 3) else null;
    errdefer if (render_corner_logical_ids) |rows| allocator.free(rows);

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
                if (semantic_regions) |rows| rows[output_face] = block.semantic_regions.?[face];
                if (semantic_instances) |rows| rows[output_face] = block.semantic_instances.?[face];
                if (render_corner_logical_ids) |rows| {
                    @memcpy(rows[output_face * 3 .. output_face * 3 + 3], block.render_corner_logical_ids.?[face * 3 .. face * 3 + 3]);
                }
                output_face += 1;
                if (want_opaque) opaque_faces += 1;
            }
        }
    }
    if (output_face != total_faces) return error.InvalidFaceBlock;

    var logical_vertex_count: u32 = 0;
    var dense_to_stable_logical_ids: ?[]u32 = null;
    errdefer if (dense_to_stable_logical_ids) |rows| allocator.free(rows);
    if (render_corner_logical_ids) |logical_rows| {
        // Use the whole composed model for the scale-relative duplicate-position
        // check; validating visible and hidden blocks independently would make the
        // tolerance change when an Outliner eye is toggled.
        var min = [3]f64{ std.math.inf(f64), std.math.inf(f64), std.math.inf(f64) };
        var max = [3]f64{ -std.math.inf(f64), -std.math.inf(f64), -std.math.inf(f64) };
        for (logical_rows, 0..) |_, corner| {
            const at = corner * 8;
            for (0..3) |axis| {
                const value = verts[at + axis];
                if (!std.math.isFinite(value)) return error.InvalidLogicalTopology;
                const wide: f64 = value;
                min[axis] = @min(min[axis], wide);
                max[axis] = @max(max[axis], wide);
            }
        }
        const dx = max[0] - min[0];
        const dy = max[1] - min[1];
        const dz = max[2] - min[2];
        const tolerance = 0.000001 * @max(@as(f64, 1), @sqrt(dx * dx + dy * dy + dz * dz));
        const tolerance_sq = tolerance * tolerance;

        var records = std.AutoHashMapUnmanaged(u32, LogicalRecord).empty;
        defer records.deinit(allocator);
        for (logical_rows, 0..) |stable_id, corner| {
            const at = corner * 8;
            const position = [3]f32{ verts[at], verts[at + 1], verts[at + 2] };
            const entry = try records.getOrPut(allocator, stable_id);
            if (!entry.found_existing) {
                entry.value_ptr.* = .{ .position = position };
                continue;
            }
            const prior = entry.value_ptr.position;
            const px: f64 = @as(f64, position[0]) - @as(f64, prior[0]);
            const py: f64 = @as(f64, position[1]) - @as(f64, prior[1]);
            const pz: f64 = @as(f64, position[2]) - @as(f64, prior[2]);
            if (px * px + py * py + pz * pz > tolerance_sq) return error.InvalidLogicalTopology;
        }
        if (records.count() == 0 or records.count() > std.math.maxInt(u32)) return error.InvalidLogicalTopology;
        const dense_to_stable = try allocator.alloc(u32, records.count());
        dense_to_stable_logical_ids = dense_to_stable;
        var logical_index: usize = 0;
        var iterator = records.iterator();
        while (iterator.next()) |entry| : (logical_index += 1) dense_to_stable[logical_index] = entry.key_ptr.*;
        std.mem.sort(u32, dense_to_stable, {}, std.sort.asc(u32));
        for (dense_to_stable, 0..) |stable_id, dense_id| records.getPtr(stable_id).?.dense = @intCast(dense_id);
        for (logical_rows) |*stable_id| stable_id.* = records.get(stable_id.*).?.dense;
        logical_vertex_count = @intCast(dense_to_stable.len);
    }
    return .{
        .verts = verts,
        .groups = groups,
        .materials = materials,
        .semantic_regions = semantic_regions,
        .semantic_instances = semantic_instances,
        .render_corner_logical_ids = render_corner_logical_ids,
        .logical_vertex_count = logical_vertex_count,
        .dense_to_stable_logical_ids = dense_to_stable_logical_ids,
        .semantic_table_json = null,
        .glass_first_vertex = @intCast(opaque_faces * 3),
    };
}

/// Recovery-only block composition. Ordinary Save remains strict through
/// `composeSnapshot`; this path preserves every independently coherent resident
/// channel when one sibling channel is stale. Missing semantic rows are filled
/// as unassigned, missing logical rows receive fresh stable ids, and a logical
/// position conflict drops only logical topology before one final composition.
pub fn composeRecoverySnapshot(allocator: std.mem.Allocator, blocks: []const FaceBlock) !Snapshot {
    if (blocks.len == 0) return error.InvalidFaceBlock;
    const normalized = try allocator.alloc(FaceBlock, blocks.len);
    defer allocator.free(normalized);

    var total_faces: usize = 0;
    var usable_blocks: usize = 0;
    var any_groups = false;
    var all_groups_valid = true;
    var any_semantics = false;
    var any_logical = false;
    var missing_logical_corners: usize = 0;
    var max_logical_id: u32 = 0;
    for (blocks) |block| {
        const faces = block.verts.len / 24;
        if (faces == 0) continue;
        total_faces = std.math.add(usize, total_faces, faces) catch return error.InvalidFaceBlock;
        usable_blocks += 1;
        const groups_valid = if (block.groups) |rows| rows.len >= faces else false;
        any_groups = any_groups or block.groups != null;
        all_groups_valid = all_groups_valid and groups_valid;
        const semantics_valid = block.semantic_regions != null and block.semantic_instances != null and
            block.semantic_regions.?.len >= faces and block.semantic_instances.?.len >= faces;
        any_semantics = any_semantics or semantics_valid;
        const corners = faces * 3;
        const logical_valid = if (block.render_corner_logical_ids) |rows| rows.len >= corners else false;
        any_logical = any_logical or logical_valid;
        if (logical_valid) {
            for (block.render_corner_logical_ids.?[0..corners]) |id| max_logical_id = @max(max_logical_id, id);
        } else {
            missing_logical_corners = std.math.add(usize, missing_logical_corners, corners) catch
                return error.InvalidFaceBlock;
        }
    }
    if (usable_blocks == 0 or total_faces > std.math.maxInt(u32) / 3) return error.InvalidFaceBlock;

    var use_logical = any_logical;
    if (use_logical and missing_logical_corners > 0) {
        const remaining = @as(u64, std.math.maxInt(u32)) - max_logical_id;
        if (missing_logical_corners > remaining) use_logical = false;
    }
    const semantic_fill = if (any_semantics) try allocator.alloc(u32, total_faces * 2) else null;
    defer if (semantic_fill) |rows| allocator.free(rows);
    if (semantic_fill) |rows| @memset(rows, std.math.maxInt(u32));
    const logical_fill = if (use_logical and missing_logical_corners > 0)
        try allocator.alloc(u32, missing_logical_corners)
    else
        null;
    defer if (logical_fill) |rows| allocator.free(rows);
    if (logical_fill) |rows| {
        var next = max_logical_id + 1;
        for (rows) |*id| {
            id.* = next;
            next += 1;
        }
    }

    var output_index: usize = 0;
    var semantic_fill_at: usize = 0;
    var logical_fill_at: usize = 0;
    for (blocks) |block| {
        const faces = block.verts.len / 24;
        if (faces == 0) continue;
        const corners = faces * 3;
        const semantics_valid = block.semantic_regions != null and block.semantic_instances != null and
            block.semantic_regions.?.len >= faces and block.semantic_instances.?.len >= faces;
        const logical_valid = if (block.render_corner_logical_ids) |rows| rows.len >= corners else false;
        const fallback_regions = if (semantic_fill) |rows| rows[semantic_fill_at .. semantic_fill_at + faces] else null;
        const fallback_instances = if (semantic_fill) |rows| rows[total_faces + semantic_fill_at .. total_faces + semantic_fill_at + faces] else null;
        const fallback_logical = if (use_logical and !logical_valid) blk: {
            const rows = logical_fill.?[logical_fill_at .. logical_fill_at + corners];
            logical_fill_at += corners;
            break :blk rows;
        } else null;
        normalized[output_index] = .{
            .verts = block.verts[0 .. faces * 24],
            .groups = if (any_groups and all_groups_valid) block.groups.?[0..faces] else null,
            .materials = if (block.materials) |rows| if (rows.len >= faces) rows[0..faces] else null else null,
            .semantic_regions = if (any_semantics) if (semantics_valid) block.semantic_regions.?[0..faces] else fallback_regions else null,
            .semantic_instances = if (any_semantics) if (semantics_valid) block.semantic_instances.?[0..faces] else fallback_instances else null,
            .render_corner_logical_ids = if (use_logical) if (logical_valid) block.render_corner_logical_ids.?[0..corners] else fallback_logical else null,
            .colors = if (block.colors) |rows| if (rows.len >= faces * 4) rows[0 .. faces * 4] else null else null,
        };
        output_index += 1;
        semantic_fill_at += faces;
    }

    return composeSnapshot(allocator, normalized[0..output_index]) catch |err| switch (err) {
        error.InvalidLogicalTopology => {
            for (normalized[0..output_index]) |*block| block.render_corner_logical_ids = null;
            return composeSnapshot(allocator, normalized[0..output_index]);
        },
        else => return err,
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

test "document composition reorders semantic rows with opaque and glass faces" {
    const solid_face = [_]f32{0} ** 24;
    const glass = [_]f32{1} ** 24;
    var opaque_color = [_]u8{ 10, 20, 30, 255 };
    var glass_color = [_]u8{ 40, 50, 60, 80 };
    var snapshot = try composeSnapshot(std.testing.allocator, &.{
        .{ .verts = glass[0..], .semantic_regions = &.{7}, .semantic_instances = &.{3}, .colors = glass_color[0..] },
        .{ .verts = solid_face[0..], .semantic_regions = &.{2}, .semantic_instances = &.{1}, .colors = opaque_color[0..] },
    });
    defer snapshot.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(u32, 3), snapshot.glass_first_vertex);
    try std.testing.expectEqualSlices(u32, &.{ 2, 7 }, snapshot.semantic_regions.?);
    try std.testing.expectEqualSlices(u32, &.{ 1, 3 }, snapshot.semantic_instances.?);
}

test "recovery composition preserves valid channels when one semantic block is stale" {
    var first = [_]f32{0} ** 24;
    var second = [_]f32{0} ** 24;
    first[8] = 1;
    first[17] = 1;
    second[0] = 2;
    second[8] = 3;
    second[17] = 1;
    var stale_regions = [_]u32{};
    var stale_instances = [_]u32{};
    var snapshot = try composeRecoverySnapshot(std.testing.allocator, &.{
        .{
            .verts = &first,
            .groups = &.{2},
            .materials = &.{3},
            .semantic_regions = &.{4},
            .semantic_instances = &.{0},
            .render_corner_logical_ids = &.{ 10, 11, 12 },
        },
        .{
            .verts = &second,
            .groups = &.{9},
            .materials = &.{7},
            .semantic_regions = &stale_regions,
            .semantic_instances = &stale_instances,
            .render_corner_logical_ids = &.{ 20, 21, 22 },
        },
    });
    defer snapshot.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u32, &.{ 2, 9 }, snapshot.groups.?);
    try std.testing.expectEqualSlices(u32, &.{ 3, 7 }, snapshot.materials.?);
    try std.testing.expectEqualSlices(u32, &.{ 4, std.math.maxInt(u32) }, snapshot.semantic_regions.?);
    try std.testing.expectEqualSlices(u32, &.{ 0, std.math.maxInt(u32) }, snapshot.semantic_instances.?);
    try std.testing.expectEqualSlices(u32, &.{ 0, 1, 2, 3, 4, 5 }, snapshot.render_corner_logical_ids.?);
    try std.testing.expectEqualSlices(u32, &.{ 10, 11, 12, 20, 21, 22 }, snapshot.dense_to_stable_logical_ids.?);
}

test "canonical current RJMD v5 round-trips every supplied nonlogical channel" {
    var verts = [_]f32{0} ** (6 * 8);
    for (0..6) |corner| {
        const at = corner * 8;
        verts[at] = @floatFromInt(corner);
        verts[at + 1] = @floatFromInt(corner % 2);
        verts[at + 2] = @floatFromInt(corner / 3);
        verts[at + 3] = 0.25;
        verts[at + 4] = 0.5;
        verts[at + 5] = 0.75;
        verts[at + 6] = @as(f32, @floatFromInt(corner)) / 5.0;
        verts[at + 7] = 1.0 - verts[at + 6];
    }
    var groups = [_]u32{ 2, 9 };
    var materials = [_]u32{ NO_FACE_MATERIAL, 7 };
    var semantic_regions = [_]u32{ 4, 5 };
    var semantic_instances = [_]u32{ 0, 1 };
    var semantic_json = [_]u8{ '{', '"', 'v', 'e', 'r', 's', 'i', 'o', 'n', '"', ':', '1', ',', '"', 'r', 'e', 'g', 'i', 'o', 'n', 's', '"', ':', '[', ']', '}' };
    const snapshot = Snapshot{
        .verts = verts[0..],
        .groups = groups[0..],
        .materials = materials[0..],
        .semantic_regions = semantic_regions[0..],
        .semantic_instances = semantic_instances[0..],
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = semantic_json[0..],
        .glass_first_vertex = 3,
    };
    const ranges = [_]u32{ 2, 3, 9, 10 };
    const bytes = try encodeCurrentSnapshotAlloc(std.testing.allocator, &snapshot, &ranges);
    defer std.testing.allocator.free(bytes);

    var document = try decodeDocument(std.testing.allocator, bytes);
    defer document.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(u32, VERSION_LOGICAL_TOPOLOGY), document.version);
    try std.testing.expectEqual(@as(?[]u32, null), document.render_corner_logical_ids);
    try std.testing.expectEqual(@as(u32, 0), document.logical_vertex_count);
    try std.testing.expectEqualSlices(f32, &verts, document.verts);
    try std.testing.expectEqualSlices(u32, &groups, document.groups.?);
    try std.testing.expectEqualSlices(u32, &materials, document.materials.?);
    try std.testing.expectEqualSlices(u32, &semantic_regions, document.semantic_regions.?);
    try std.testing.expectEqualSlices(u32, &semantic_instances, document.semantic_instances.?);
    try std.testing.expectEqualSlices(u32, &ranges, document.ranges);
    try std.testing.expectEqualStrings(&semantic_json, document.semantic_table_json.?);
    try std.testing.expectEqual(@as(?[][]u8, null), document.range_object_ids);
    try std.testing.expectEqual(@as(?u32, 3), document.glass_first_vertex);
}

test "canonical current RJMD v5 stamps stable range ids onto anonymous topology" {
    var verts = [_]f32{0} ** (6 * 8);
    const positions = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 2, 0, 0 }, .{ 3, 0, 0 }, .{ 2, 1, 0 },
    };
    for (positions, 0..) |position, corner| {
        const at = corner * 8;
        verts[at] = position[0];
        verts[at + 1] = position[1];
        verts[at + 2] = position[2];
    }
    var groups = [_]u32{ 2, 9 };
    var empty_regions = [_]u32{};
    var empty_instances = [_]u32{};
    var empty_semantic_json = [_]u8{};
    const snapshot = Snapshot{
        .verts = verts[0..],
        .groups = groups[0..],
        .materials = null,
        .semantic_regions = empty_regions[0..],
        .semantic_instances = empty_instances[0..],
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = empty_semantic_json[0..],
        .glass_first_vertex = 6,
    };
    const ranges = [_]u32{ 2, 3, 9, 10 };
    const object_ids = [_][]const u8{ "stable-body", "stable-wheel" };
    const bytes = try encodeCurrentSnapshotWithRangeObjectIdsAlloc(
        std.testing.allocator,
        &snapshot,
        &ranges,
        &object_ids,
    );
    defer std.testing.allocator.free(bytes);

    var document = try decodeDocument(std.testing.allocator, bytes);
    defer document.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(u32, VERSION_LOGICAL_TOPOLOGY), document.version);
    try std.testing.expectEqual(@as(?[]u32, null), document.render_corner_logical_ids);
    try std.testing.expectEqual(@as(u32, 0), document.logical_vertex_count);
    try std.testing.expectEqualSlices(u32, &.{ std.math.maxInt(u32), std.math.maxInt(u32) }, document.semantic_regions.?);
    try std.testing.expectEqualSlices(u32, &.{ std.math.maxInt(u32), std.math.maxInt(u32) }, document.semantic_instances.?);
    try std.testing.expectEqual(@as(usize, 2), document.range_object_ids.?.len);
    try std.testing.expectEqualStrings("stable-body", document.range_object_ids.?[0]);
    try std.testing.expectEqualStrings("stable-wheel", document.range_object_ids.?[1]);
    try std.testing.expectEqualSlices(u32, &ranges, document.ranges);
}

test "RJMD v5 persists stable object ids against exact range values" {
    var verts = [_]f32{0} ** (6 * 8);
    const positions = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 2, 0, 0 }, .{ 3, 0, 0 }, .{ 2, 1, 0 },
    };
    for (positions, 0..) |position, corner| {
        const at = corner * 8;
        verts[at] = position[0];
        verts[at + 1] = position[1];
        verts[at + 2] = position[2];
    }
    const snapshot = Snapshot{
        .verts = verts[0..],
        .groups = @constCast(&[_]u32{ 2, 9 }),
        .materials = null,
        .semantic_regions = @constCast(&[_]u32{ 4, 4 }),
        .semantic_instances = @constCast(&[_]u32{ 0, 0 }),
        .render_corner_logical_ids = @constCast(&[_]u32{ 0, 1, 2, 3, 4, 5 }),
        .logical_vertex_count = 6,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = @constCast(@as([]const u8, "{\"version\":1,\"regions\":[{\"id\":4,\"name\":\"body\",\"role\":\"chest\"}]}")),
        .glass_first_vertex = 6,
    };
    const ranges = [_]u32{ 2, 3, 9, 10 };
    const object_ids = [_][]const u8{ "object-left", "object-right" };
    const bytes = try encodeSnapshotWithRangeObjectIdsAlloc(
        std.testing.allocator,
        &snapshot,
        &ranges,
        &object_ids,
    );
    defer std.testing.allocator.free(bytes);
    var document = try decodeDocument(std.testing.allocator, bytes);
    defer document.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(u32, VERSION_LOGICAL_TOPOLOGY), document.version);
    try std.testing.expectEqualSlices(u32, &ranges, document.ranges);
    try std.testing.expectEqual(@as(usize, 2), document.range_object_ids.?.len);
    try std.testing.expectEqualStrings("object-left", document.range_object_ids.?[0]);
    try std.testing.expectEqualStrings("object-right", document.range_object_ids.?[1]);
}

test "v5 object metadata rejects duplicate ids and range drift" {
    const ranges = [_]u32{ 2, 3, 9, 10 };
    const duplicate_ids = [_][]const u8{ "same", "same" };
    try std.testing.expectError(error.InvalidRangeObjectMetadata, semanticTableWithRangeObjectIdsAlloc(
        std.testing.allocator,
        "{\"version\":1,\"regions\":[]}",
        &ranges,
        &duplicate_ids,
    ));
    try std.testing.expectError(error.InvalidRangeObjectMetadata, rangeObjectIdsAlloc(
        std.testing.allocator,
        "{\"version\":1,\"regions\":[],\"rangeObjects\":[{\"objectId\":\"left\",\"lo\":2,\"hi\":3},{\"objectId\":\"right\",\"lo\":8,\"hi\":10}]}",
        &ranges,
    ));
}
