//! Native half of the model-package guard.
//!
//! This deliberately imports the production RJMD, RTGD, and RJSK codecs. The
//! catalog scripts do not carry another copy of any wire format: each inspect
//! command proves the owning native reader accepts the complete artifact, while
//! `canonicalize` re-encodes an already-valid editable document through the same
//! current-v5 writer used by the editor host door.

const std = @import("std");
const meshdoc = @import("meshdoc");
const mesh_edit = @import("mesh_edit");
const skin_binding = @import("skin_binding");

const MAX_MODEL_ARTIFACT_BYTES: usize = 2 * 1024 * 1024 * 1024;

const Command = enum {
    inspect,
    inspect_retopo_guide,
    inspect_skin_binding,
    inspect_skin_weights,
    canonicalize,
    export_obj,
    write_v4_test_fixture,
};

const Options = struct {
    command: Command,
    input: []const u8,
    output: ?[]const u8 = null,
    object_ids_path: ?[]const u8 = null,
    ranges_path: ?[]const u8 = null,
    skin: ?[]const u8 = null,
};

fn usage() void {
    std.debug.print(
        \\Usage:
        \\  model-blob-codec inspect --input PATH
        \\  model-blob-codec inspect-retopo-guide --input PATH
        \\  model-blob-codec inspect-skin-binding --input PATH
        \\  model-blob-codec inspect-skin-weights --input DOC_PATH --skin SKIN_PATH
        \\  model-blob-codec canonicalize --input PATH --output PATH [--object-ids-json PATH] [--ranges-json PATH]
        \\  model-blob-codec export-obj --input PATH --output PATH
        \\  model-blob-codec write-v4-test-fixture --output PATH
        \\
    , .{});
}

fn parseOptions(args: []const [:0]const u8) !Options {
    if (args.len < 2) return error.MissingCommand;
    const command: Command = if (std.mem.eql(u8, args[1], "inspect"))
        .inspect
    else if (std.mem.eql(u8, args[1], "inspect-retopo-guide"))
        .inspect_retopo_guide
    else if (std.mem.eql(u8, args[1], "inspect-skin-binding"))
        .inspect_skin_binding
    else if (std.mem.eql(u8, args[1], "inspect-skin-weights"))
        .inspect_skin_weights
    else if (std.mem.eql(u8, args[1], "canonicalize"))
        .canonicalize
    else if (std.mem.eql(u8, args[1], "export-obj"))
        .export_obj
    else if (std.mem.eql(u8, args[1], "write-v4-test-fixture"))
        .write_v4_test_fixture
    else
        return error.UnknownCommand;

    var input: ?[]const u8 = null;
    var output: ?[]const u8 = null;
    var object_ids_path: ?[]const u8 = null;
    var ranges_path: ?[]const u8 = null;
    var skin: ?[]const u8 = null;
    var index: usize = 2;
    while (index < args.len) {
        const arg = args[index];
        if (std.mem.eql(u8, arg, "--input")) {
            if (index + 1 >= args.len) return error.MissingArgumentValue;
            input = args[index + 1];
            index += 2;
        } else if (std.mem.eql(u8, arg, "--output")) {
            if (index + 1 >= args.len) return error.MissingArgumentValue;
            output = args[index + 1];
            index += 2;
        } else if (std.mem.eql(u8, arg, "--object-ids-json")) {
            if (index + 1 >= args.len) return error.MissingArgumentValue;
            object_ids_path = args[index + 1];
            index += 2;
        } else if (std.mem.eql(u8, arg, "--ranges-json")) {
            if (index + 1 >= args.len) return error.MissingArgumentValue;
            ranges_path = args[index + 1];
            index += 2;
        } else if (std.mem.eql(u8, arg, "--skin")) {
            if (index + 1 >= args.len) return error.MissingArgumentValue;
            skin = args[index + 1];
            index += 2;
        } else {
            return error.UnknownArgument;
        }
    }
    if (command != .inspect_skin_weights and skin != null) return error.InvalidArguments;
    if (command == .inspect_skin_weights and
        (input == null or skin == null or output != null or object_ids_path != null or ranges_path != null)) return error.InvalidArguments;
    if ((command == .canonicalize or command == .export_obj) and (input == null or output == null)) return error.MissingInputOrOutput;
    if (command == .export_obj and (object_ids_path != null or ranges_path != null)) return error.InvalidArguments;
    if (command == .write_v4_test_fixture and output == null) return error.MissingOutput;
    if (command == .write_v4_test_fixture and (input != null or object_ids_path != null or ranges_path != null)) return error.InvalidArguments;
    if (command != .canonicalize and command != .export_obj and command != .write_v4_test_fixture and command != .inspect_skin_weights and
        (input == null or output != null or object_ids_path != null or ranges_path != null)) return error.InvalidArguments;
    return .{
        .command = command,
        .input = input orelse "",
        .output = output,
        .object_ids_path = object_ids_path,
        .ranges_path = ranges_path,
        .skin = skin,
    };
}

fn writeV4TestFixture(io: std.Io, allocator: std.mem.Allocator, output_path: []const u8) !void {
    const ranges = [_]u32{ 7, 8 };
    const snapshot = fixtureSnapshot(false);
    const bytes = try meshdoc.encodeSnapshotAlloc(allocator, &snapshot, &ranges);
    defer allocator.free(bytes);
    var decoded = try meshdoc.decodeDocument(allocator, bytes);
    defer decoded.deinit(allocator);
    if (decoded.version != 4) return error.TestFixtureVersionMismatch;
    try writeNewFile(io, output_path, bytes);
    var stdout_buffer: [256]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(io, &stdout_buffer);
    try stdout_writer.interface.print(
        "{{\"ok\":true,\"format\":\"RJMD\",\"version\":4,\"vertexCount\":{d},\"rangeCount\":{d}}}\n",
        .{ decoded.verts.len / 8, decoded.ranges.len / 2 },
    );
    try stdout_writer.interface.flush();
}

fn optionalU32SlicesEqual(a: ?[]const u32, b: ?[]const u32) bool {
    if ((a == null) != (b == null)) return false;
    if (a == null) return true;
    return std.mem.eql(u32, a.?, b.?);
}

fn documentsPreserveGeometry(before: *const meshdoc.Document, after: *const meshdoc.Document, promoted_logical_topology: bool) bool {
    if (!std.mem.eql(u8, std.mem.sliceAsBytes(before.verts), std.mem.sliceAsBytes(after.verts))) return false;
    if (!optionalU32SlicesEqual(before.groups, after.groups)) return false;
    if (!optionalU32SlicesEqual(before.materials, after.materials)) return false;
    if (!promoted_logical_topology) {
        if (!optionalU32SlicesEqual(before.render_corner_logical_ids, after.render_corner_logical_ids)) return false;
        if (before.logical_vertex_count != after.logical_vertex_count) return false;
    } else if (before.render_corner_logical_ids != null or before.logical_vertex_count != 0 or
        after.render_corner_logical_ids == null or after.logical_vertex_count == 0)
    {
        return false;
    }
    if (before.glass_first_vertex) |glass| {
        if (after.glass_first_vertex == null or after.glass_first_vertex.? != glass) return false;
    }
    if (before.semantic_regions != null) {
        if (!optionalU32SlicesEqual(before.semantic_regions, after.semantic_regions)) return false;
        if (!optionalU32SlicesEqual(before.semantic_instances, after.semantic_instances)) return false;
    }
    return true;
}

fn snapshotFromDocument(document: *const meshdoc.Document) meshdoc.Snapshot {
    return .{
        .verts = document.verts,
        .groups = document.groups,
        .materials = document.materials,
        .semantic_regions = document.semantic_regions,
        .semantic_instances = document.semantic_instances,
        .render_corner_logical_ids = document.render_corner_logical_ids,
        .logical_vertex_count = document.logical_vertex_count,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = document.semantic_table_json,
        .glass_first_vertex = document.glass_first_vertex orelse @intCast(document.verts.len / 8),
    };
}

pub fn canonicalizeBytesAlloc(
    allocator: std.mem.Allocator,
    input: []const u8,
    object_ids: ?[]const []const u8,
    recovered_ranges: ?[]const u32,
) ![]u8 {
    var source = try meshdoc.decodeDocument(allocator, input);
    defer source.deinit(allocator);
    const ranges = recovered_ranges orelse source.ranges;
    if (source.ranges.len > 0 and recovered_ranges != null) return error.StoredRangesMayNotBeReplaced;
    var snapshot = snapshotFromDocument(&source);
    var promotion = if (snapshot.render_corner_logical_ids == null)
        try mesh_edit.legacyEdgeTopologyPromotionAlloc(
            allocator,
            snapshot.verts,
            snapshot.groups,
            ranges,
            snapshot.semantic_table_json,
        )
    else
        null;
    defer if (promotion) |*value| value.deinit();
    if (promotion) |*value| value.applyBorrowed(&snapshot);
    const encoded = if (object_ids) |ids|
        try meshdoc.encodeCurrentSnapshotWithRangeObjectIdsAlloc(allocator, &snapshot, ranges, ids)
    else
        try meshdoc.encodeCurrentSnapshotAlloc(allocator, &snapshot, ranges);
    errdefer allocator.free(encoded);

    // Do not hand bytes to the migration transaction until the production native
    // reader accepts the result and all geometry-bearing channels are bit-exact.
    var roundtrip = try meshdoc.decodeDocument(allocator, encoded);
    defer roundtrip.deinit(allocator);
    if (roundtrip.version != meshdoc.VERSION_LOGICAL_TOPOLOGY or
        !documentsPreserveGeometry(&source, &roundtrip, promotion != null))
    {
        return error.CanonicalRoundtripMismatch;
    }
    if (promotion) |*value| {
        if (!optionalU32SlicesEqual(value.render_corner_logical_ids, roundtrip.render_corner_logical_ids) or
            value.logical_vertex_count != roundtrip.logical_vertex_count)
        {
            return error.CanonicalRoundtripMismatch;
        }
    }
    if (!std.mem.eql(u32, ranges, roundtrip.ranges)) return error.CanonicalRoundtripMismatch;
    if (object_ids) |ids| {
        const persisted = roundtrip.range_object_ids orelse return error.CanonicalRoundtripMismatch;
        if (persisted.len != ids.len) return error.CanonicalRoundtripMismatch;
        for (persisted, ids) |actual, expected| {
            if (!std.mem.eql(u8, actual, expected)) return error.CanonicalRoundtripMismatch;
        }
    }
    return encoded;
}

fn readFileAlloc(io: std.Io, allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    return std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(MAX_MODEL_ARTIFACT_BYTES));
}

fn writeNewFile(io: std.Io, path: []const u8, bytes: []const u8) !void {
    var file = try std.Io.Dir.cwd().createFile(io, path, .{ .truncate = false, .exclusive = true });
    defer file.close(io);
    errdefer std.Io.Dir.cwd().deleteFile(io, path) catch {};
    try file.writeStreamingAll(io, bytes);
    try file.sync(io);
}

fn inspect(io: std.Io, allocator: std.mem.Allocator, path: []const u8) !void {
    const bytes = try readFileAlloc(io, allocator, path);
    defer allocator.free(bytes);
    var document = try meshdoc.decodeDocument(allocator, bytes);
    defer document.deinit(allocator);

    var stdout_buffer: [1024]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(io, &stdout_buffer);
    const stdout = &stdout_writer.interface;
    try stdout.print(
        "{{\"ok\":true,\"format\":\"RJMD\",\"version\":{d},\"currentVersion\":{d},\"current\":{s},\"vertexCount\":{d},\"faceCount\":{d},\"rangeCount\":{d},\"hasLogicalVertices\":{s},\"logicalVertexCount\":{d}}}\n",
        .{
            document.version,
            meshdoc.VERSION_LOGICAL_TOPOLOGY,
            if (document.version == meshdoc.VERSION_LOGICAL_TOPOLOGY) "true" else "false",
            document.verts.len / 8,
            document.verts.len / 24,
            document.ranges.len / 2,
            if (document.render_corner_logical_ids != null) "true" else "false",
            document.logical_vertex_count,
        },
    );
    try stdout.flush();
}

pub const RetopoGuideInspection = struct {
    live_face_count: usize,
    source_face_count: usize,
    source_position_count: usize,
    ghost_visible: bool,
    source_tracks_live: bool,
};

pub fn inspectRetopoGuideBytes(
    allocator: std.mem.Allocator,
    bytes: []const u8,
) !RetopoGuideInspection {
    var guide = try mesh_edit.decodeRetopoGuide(allocator, bytes);
    defer guide.deinit(allocator);
    return .{
        .live_face_count = guide.live_bands.len,
        .source_face_count = guide.source_bands.len,
        .source_position_count = guide.source_positions.len / 3,
        .ghost_visible = guide.ghost_visible,
        .source_tracks_live = guide.source_tracks_live,
    };
}

pub fn retopoGuideInspectionJsonAlloc(
    allocator: std.mem.Allocator,
    inspection: RetopoGuideInspection,
) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"format\":\"RTGD\",\"version\":{d},\"currentVersion\":{d},\"current\":true,\"liveFaceCount\":{d},\"sourceFaceCount\":{d},\"sourcePositionCount\":{d},\"ghostVisible\":{s},\"sourceTracksLive\":{s}}}\n",
        .{
            mesh_edit.RETOPO_GUIDE_VERSION,
            mesh_edit.RETOPO_GUIDE_VERSION,
            inspection.live_face_count,
            inspection.source_face_count,
            inspection.source_position_count,
            if (inspection.ghost_visible) "true" else "false",
            if (inspection.source_tracks_live) "true" else "false",
        },
    );
}

fn inspectRetopoGuide(io: std.Io, allocator: std.mem.Allocator, path: []const u8) !void {
    const bytes = try readFileAlloc(io, allocator, path);
    defer allocator.free(bytes);
    const inspection = try inspectRetopoGuideBytes(allocator, bytes);
    const json = try retopoGuideInspectionJsonAlloc(allocator, inspection);
    defer allocator.free(json);
    try std.Io.File.stdout().writeStreamingAll(io, json);
}

pub const SkinBindingInspection = struct {
    logical_vertex_count: u32,
    bone_count: usize,
};

pub fn inspectSkinBindingBytes(
    allocator: std.mem.Allocator,
    bytes: []const u8,
) !SkinBindingInspection {
    var binding = try skin_binding.decode(allocator, bytes);
    defer binding.deinit();
    return .{
        .logical_vertex_count = binding.logical_vertex_count,
        .bone_count = binding.bone_ids.len,
    };
}

pub fn skinBindingInspectionJsonAlloc(
    allocator: std.mem.Allocator,
    inspection: SkinBindingInspection,
) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"format\":\"RJSK\",\"version\":{d},\"currentVersion\":{d},\"current\":true,\"logicalVertexCount\":{d},\"boneCount\":{d},\"maxInfluences\":{d}}}\n",
        .{
            skin_binding.VERSION,
            skin_binding.VERSION,
            inspection.logical_vertex_count,
            inspection.bone_count,
            skin_binding.MAX_INFLUENCES,
        },
    );
}

fn inspectSkinBinding(io: std.Io, allocator: std.mem.Allocator, path: []const u8) !void {
    const bytes = try readFileAlloc(io, allocator, path);
    defer allocator.free(bytes);
    const inspection = try inspectSkinBindingBytes(allocator, bytes);
    const json = try skinBindingInspectionJsonAlloc(allocator, inspection);
    defer allocator.free(json);
    try std.Io.File.stdout().writeStreamingAll(io, json);
}

/// Per-region skin-weight attribution (req_4303): join the RJMD document's
/// semantic regions with the RJSK influence rows, offline. For every named
/// region: which bones own its vertices, and which member vertices dissent
/// from the region's majority dominant bone. A mirrored mesh whose regions
/// pair by name ("thumb_left"/"thumb_right") exposes weight asymmetry as a
/// row-by-row difference — no live rig session, no bone-id mirror pairing.
fn inspectSkinWeights(io: std.Io, allocator: std.mem.Allocator, doc_path: []const u8, skin_path: []const u8) !void {
    const doc_bytes = try readFileAlloc(io, allocator, doc_path);
    defer allocator.free(doc_bytes);
    var document = try meshdoc.decodeDocument(allocator, doc_bytes);
    defer document.deinit(allocator);

    const skin_bytes = try readFileAlloc(io, allocator, skin_path);
    defer allocator.free(skin_bytes);
    var binding = try skin_binding.decode(allocator, skin_bytes);
    defer binding.deinit();

    const corner_ids = document.render_corner_logical_ids orelse return error.MissingLogicalChannel;
    const corner_count = document.verts.len / 8;
    if (corner_ids.len != corner_count) return error.MissingLogicalChannel;
    const logical_count: usize = binding.logical_vertex_count;
    if (document.logical_vertex_count != logical_count) return error.BindingDocumentMismatch;
    const face_regions = document.semantic_regions orelse return error.MissingSemanticChannel;
    const face_count = corner_count / 3;
    if (face_regions.len != face_count) return error.MissingSemanticChannel;

    // Logical positions from the first render corner carrying each id.
    const positions = try allocator.alloc([3]f32, logical_count);
    defer allocator.free(positions);
    for (corner_ids, 0..) |logical_id, corner| {
        if (logical_id >= logical_count) return error.BindingDocumentMismatch;
        const base = corner * 8;
        positions[logical_id] = .{ document.verts[base], document.verts[base + 1], document.verts[base + 2] };
    }

    // Dominant bone per logical vertex, straight from the binding rows.
    const dominant = try allocator.alloc(u16, logical_count);
    defer allocator.free(dominant);
    for (binding.bone_indices, binding.weights, dominant) |bone_indices, weights, *slot| {
        var best: u16 = skin_binding.UNUSED_BONE;
        var best_weight: f32 = 0;
        for (bone_indices, weights) |bone_index, weight| {
            if (bone_index == skin_binding.UNUSED_BONE) continue;
            if (weight > best_weight) {
                best_weight = weight;
                best = bone_index;
            }
        }
        slot.* = best;
    }

    // Region membership: each logical vertex joins every region whose faces
    // reference it (region ids are per face; boundary verts join several).
    const region_of_vertex = try allocator.alloc(std.AutoArrayHashMapUnmanaged(u32, void), logical_count);
    defer {
        for (region_of_vertex) |*set| set.deinit(allocator);
        allocator.free(region_of_vertex);
    }
    @memset(region_of_vertex, .empty);
    var region_ids: std.AutoArrayHashMapUnmanaged(u32, void) = .empty;
    defer region_ids.deinit(allocator);
    for (0..face_count) |face| {
        const region = face_regions[face];
        try region_ids.put(allocator, region, {});
        for (0..3) |corner| {
            const logical_id = corner_ids[face * 3 + corner];
            try region_of_vertex[logical_id].put(allocator, region, {});
        }
    }

    // Region names from the document's own semantic table.
    var region_names = std.AutoHashMap(u32, []const u8).init(allocator);
    defer region_names.deinit();
    var table_parsed: ?std.json.Parsed(std.json.Value) = null;
    defer if (table_parsed) |*parsed| parsed.deinit();
    if (document.semantic_table_json) |table_json| blk: {
        table_parsed = std.json.parseFromSlice(std.json.Value, allocator, table_json, .{}) catch break :blk;
        const root = table_parsed.?.value;
        if (root != .object) break :blk;
        const regions = root.object.get("regions") orelse break :blk;
        if (regions != .array) break :blk;
        for (regions.array.items) |region| {
            if (region != .object) continue;
            const id_value = region.object.get("id") orelse continue;
            const name_value = region.object.get("name") orelse continue;
            if (id_value != .integer or name_value != .string) continue;
            if (id_value.integer < 0 or id_value.integer > std.math.maxInt(u32)) continue;
            try region_names.put(@intCast(id_value.integer), name_value.string);
        }
    }

    var out = std.Io.Writer.Allocating.init(allocator);
    defer out.deinit();
    const writer = &out.writer;
    try writer.print(
        "{{\"ok\":true,\"op\":\"inspect-skin-weights\",\"logicalVertexCount\":{d},\"boneCount\":{d},\"regions\":[",
        .{ logical_count, binding.bone_ids.len },
    );

    const bone_count = binding.bone_ids.len;
    const total_weight = try allocator.alloc(f64, bone_count);
    defer allocator.free(total_weight);
    const dominant_votes = try allocator.alloc(u32, bone_count);
    defer allocator.free(dominant_votes);

    var first_region = true;
    for (region_ids.keys()) |region| {
        @memset(total_weight, 0);
        @memset(dominant_votes, 0);
        var member_count: u32 = 0;
        for (0..logical_count) |logical_id| {
            if (!region_of_vertex[logical_id].contains(region)) continue;
            member_count += 1;
            for (binding.bone_indices[logical_id], binding.weights[logical_id]) |bone_index, weight| {
                if (bone_index == skin_binding.UNUSED_BONE or bone_index >= bone_count) continue;
                total_weight[bone_index] += weight;
            }
            if (dominant[logical_id] != skin_binding.UNUSED_BONE) {
                dominant_votes[dominant[logical_id]] += 1;
            }
        }
        if (member_count == 0) continue;

        var majority_bone: usize = 0;
        for (dominant_votes, 0..) |votes, bone_index| {
            if (votes > dominant_votes[majority_bone]) majority_bone = bone_index;
        }

        if (!first_region) try writer.writeAll(",");
        first_region = false;
        try writer.writeAll("{\"region\":");
        if (region_names.get(region)) |name| {
            try std.json.Stringify.encodeJsonString(name, .{}, writer);
        } else {
            try writer.print("\"region-{d}\"", .{region});
        }
        try writer.print(",\"vertices\":{d},\"bones\":[", .{member_count});
        var first_bone = true;
        for (total_weight, dominant_votes, 0..) |weight_sum, votes, bone_index| {
            if (weight_sum <= 0 and votes == 0) continue;
            if (!first_bone) try writer.writeAll(",");
            first_bone = false;
            try writer.writeAll("{\"bone\":");
            try std.json.Stringify.encodeJsonString(binding.bone_ids[bone_index], .{}, writer);
            try writer.print(",\"totalWeight\":{d:.4},\"dominantVertices\":{d}}}", .{ weight_sum, votes });
        }
        try writer.writeAll("],\"dissenters\":[");
        // Dissenters: members whose dominant bone is not the region majority.
        var dissenters: usize = 0;
        for (0..logical_count) |logical_id| {
            if (dissenters >= 16) break;
            if (!region_of_vertex[logical_id].contains(region)) continue;
            if (dominant[logical_id] == skin_binding.UNUSED_BONE) continue;
            if (dominant[logical_id] == majority_bone) continue;
            if (dissenters > 0) try writer.writeAll(",");
            const position = positions[logical_id];
            try writer.print("{{\"vertex\":{d},\"position\":[{d:.4},{d:.4},{d:.4}],\"dominant\":", .{
                logical_id, position[0], position[1], position[2],
            });
            try std.json.Stringify.encodeJsonString(binding.bone_ids[dominant[logical_id]], .{}, writer);
            try writer.writeAll("}");
            dissenters += 1;
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]");

    // ── the mirror audit ──
    // Pair every vertex with its X-reflection (the mirror plane is the model
    // origin — authority law), infer each bone's mirror partner by majority
    // vote over twin dominants, then report the dissenters. The majority
    // defines the symmetry law; a mis-skinned patch on one side is exactly
    // the set of vertices that vote against it. No bone-id conventions.
    const mirror_tolerance: f32 = 1.0e-3;
    const twin = try allocator.alloc(?u32, logical_count);
    defer allocator.free(twin);
    var paired: u32 = 0;
    var unpaired: u32 = 0;
    for (positions, 0..) |position, logical_id| {
        const reflected = [3]f32{ -position[0], position[1], position[2] };
        var best: ?u32 = null;
        var best_distance_squared: f32 = mirror_tolerance * mirror_tolerance;
        for (positions, 0..) |candidate, candidate_id| {
            const dx = candidate[0] - reflected[0];
            const dy = candidate[1] - reflected[1];
            const dz = candidate[2] - reflected[2];
            const distance_squared = dx * dx + dy * dy + dz * dz;
            if (distance_squared <= best_distance_squared) {
                best = @intCast(candidate_id);
                best_distance_squared = distance_squared;
            }
        }
        twin[logical_id] = best;
        if (best == null) unpaired += 1 else paired += 1;
    }

    const votes = try allocator.alloc(u32, bone_count * bone_count);
    defer allocator.free(votes);
    @memset(votes, 0);
    for (dominant, twin) |own_bone, twin_id| {
        if (own_bone == skin_binding.UNUSED_BONE or twin_id == null) continue;
        const twin_bone = dominant[twin_id.?];
        if (twin_bone == skin_binding.UNUSED_BONE) continue;
        votes[@as(usize, own_bone) * bone_count + twin_bone] += 1;
    }
    const bone_twin = try allocator.alloc(?u16, bone_count);
    defer allocator.free(bone_twin);
    for (bone_twin, 0..) |*slot, bone_index| {
        var best_votes: u32 = 0;
        var best_bone: ?u16 = null;
        for (0..bone_count) |candidate| {
            const count = votes[bone_index * bone_count + candidate];
            if (count > best_votes) {
                best_votes = count;
                best_bone = @intCast(candidate);
            }
        }
        slot.* = best_bone;
    }

    try writer.print(",\"mirror\":{{\"tolerance\":{d},\"paired\":{d},\"unpaired\":{d},\"boneMap\":[", .{
        mirror_tolerance, paired, unpaired,
    });
    var first_map_row = true;
    for (bone_twin, 0..) |slot, bone_index| {
        const twin_bone = slot orelse continue;
        var for_votes: u32 = 0;
        var against_votes: u32 = 0;
        for (0..bone_count) |candidate| {
            const count = votes[bone_index * bone_count + candidate];
            if (candidate == twin_bone) for_votes += count else against_votes += count;
        }
        if (for_votes + against_votes == 0) continue;
        if (!first_map_row) try writer.writeAll(",");
        first_map_row = false;
        try writer.writeAll("{\"bone\":");
        try std.json.Stringify.encodeJsonString(binding.bone_ids[bone_index], .{}, writer);
        try writer.writeAll(",\"twin\":");
        try std.json.Stringify.encodeJsonString(binding.bone_ids[twin_bone], .{}, writer);
        try writer.print(",\"votes\":{d},\"dissent\":{d}}}", .{ for_votes, against_votes });
    }
    var offender_total: u32 = 0;
    for (dominant, twin) |own_bone, twin_id| {
        if (own_bone == skin_binding.UNUSED_BONE) continue;
        const expected = bone_twin[own_bone] orelse continue;
        if (twin_id == null or dominant[twin_id.?] != expected) offender_total += 1;
    }
    try writer.print("],\"offenderTotal\":{d},\"offenders\":[", .{offender_total});
    var offender_count: usize = 0;
    for (dominant, twin, 0..) |own_bone, twin_id, logical_id| {
        if (offender_count >= 64) break;
        if (own_bone == skin_binding.UNUSED_BONE) continue;
        const expected = bone_twin[own_bone] orelse continue;
        var offending = false;
        if (twin_id == null) {
            offending = true;
        } else if (dominant[twin_id.?] != expected) {
            offending = true;
        }
        if (!offending) continue;
        if (offender_count > 0) try writer.writeAll(",");
        const position = positions[logical_id];
        try writer.print("{{\"vertex\":{d},\"position\":[{d:.4},{d:.4},{d:.4}],\"row\":", .{
            logical_id, position[0], position[1], position[2],
        });
        try writeInfluenceRowJson(writer, binding.bone_indices[logical_id], binding.weights[logical_id], binding.bone_ids);
        if (twin_id) |paired_id| {
            try writer.print(",\"twin\":{d},\"twinRow\":", .{paired_id});
            try writeInfluenceRowJson(writer, binding.bone_indices[paired_id], binding.weights[paired_id], binding.bone_ids);
        } else {
            try writer.writeAll(",\"twin\":null,\"twinRow\":null");
        }
        try writer.writeAll("}");
        offender_count += 1;
    }
    try writer.print("],\"offendersShown\":{d}}}}}\n", .{offender_count});
    try std.Io.File.stdout().writeStreamingAll(io, out.written());
}

fn writeInfluenceRowJson(
    writer: *std.Io.Writer,
    bone_indices: skin_binding.BoneIndices,
    weights: skin_binding.Weights,
    bone_ids: []const []const u8,
) !void {
    try writer.writeAll("[");
    var written: usize = 0;
    for (bone_indices, weights) |bone_index, weight| {
        if (bone_index == skin_binding.UNUSED_BONE or weight <= 0) continue;
        if (written > 0) try writer.writeAll(",");
        try writer.writeAll("{\"bone\":");
        if (bone_index < bone_ids.len) {
            try std.json.Stringify.encodeJsonString(bone_ids[bone_index], .{}, writer);
        } else {
            try writer.print("\"palette-{d}\"", .{bone_index});
        }
        try writer.print(",\"weight\":{d:.4}}}", .{weight});
        written += 1;
    }
    try writer.writeAll("]");
}

/// Write one RJMD document's render geometry as a Wavefront OBJ triangle
/// soup: corners stay duplicated exactly as stored, faces index them 1-based
/// in storage order. External riggers sample the surface, so welding is the
/// importer's business, not this exporter's.
fn exportObj(io: std.Io, allocator: std.mem.Allocator, input_path: []const u8, output_path: []const u8) !void {
    if (std.mem.eql(u8, input_path, output_path)) return error.InputEqualsOutput;
    const bytes = try readFileAlloc(io, allocator, input_path);
    defer allocator.free(bytes);
    var document = try meshdoc.decodeDocument(allocator, bytes);
    defer document.deinit(allocator);

    const vertex_count = document.verts.len / 8;
    const face_count = document.verts.len / 24;

    var file = try std.Io.Dir.cwd().createFile(io, output_path, .{ .truncate = true });
    defer file.close(io);
    var file_buffer: [64 * 1024]u8 = undefined;
    var file_writer = file.writer(io, &file_buffer);
    const out = &file_writer.interface;

    try out.print("# RJMD v{d} render triangles: {s}\n", .{ document.version, input_path });
    var vertex: usize = 0;
    while (vertex < vertex_count) : (vertex += 1) {
        const at = vertex * 8;
        try out.print("v {d} {d} {d}\n", .{ document.verts[at], document.verts[at + 1], document.verts[at + 2] });
    }
    var face: usize = 0;
    while (face < face_count) : (face += 1) {
        const corner = face * 3 + 1;
        try out.print("f {d} {d} {d}\n", .{ corner, corner + 1, corner + 2 });
    }
    try out.flush();
    try file.sync(io);

    var stdout_buffer: [256]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(io, &stdout_buffer);
    try stdout_writer.interface.print(
        "{{\"ok\":true,\"format\":\"OBJ\",\"vertexCount\":{d},\"faceCount\":{d},\"output\":\"{s}\"}}\n",
        .{ vertex_count, face_count, output_path },
    );
    try stdout_writer.interface.flush();
}

fn canonicalize(
    io: std.Io,
    allocator: std.mem.Allocator,
    input_path: []const u8,
    output_path: []const u8,
    object_ids_path: ?[]const u8,
    ranges_path: ?[]const u8,
) !void {
    if (std.mem.eql(u8, input_path, output_path)) return error.InputEqualsOutput;
    const input = try readFileAlloc(io, allocator, input_path);
    defer allocator.free(input);

    var object_ids_json: ?[]u8 = null;
    defer if (object_ids_json) |json| allocator.free(json);
    var parsed_ids: ?std.json.Parsed([]const []const u8) = null;
    defer if (parsed_ids) |*parsed| parsed.deinit();
    if (object_ids_path) |path| {
        object_ids_json = try readFileAlloc(io, allocator, path);
        parsed_ids = try std.json.parseFromSlice([]const []const u8, allocator, object_ids_json.?, .{});
        if (parsed_ids.?.value.len == 0) return error.EmptyObjectIds;
    }

    var ranges_json: ?[]u8 = null;
    defer if (ranges_json) |json| allocator.free(json);
    var parsed_ranges: ?std.json.Parsed([]const u32) = null;
    defer if (parsed_ranges) |*parsed| parsed.deinit();
    if (ranges_path) |path| {
        ranges_json = try readFileAlloc(io, allocator, path);
        parsed_ranges = try std.json.parseFromSlice([]const u32, allocator, ranges_json.?, .{});
        if (parsed_ranges.?.value.len == 0 or parsed_ranges.?.value.len % 2 != 0) return error.InvalidRecoveredRanges;
    }

    const encoded = try canonicalizeBytesAlloc(
        allocator,
        input,
        if (parsed_ids) |parsed| parsed.value else null,
        if (parsed_ranges) |parsed| parsed.value else null,
    );
    defer allocator.free(encoded);
    try writeNewFile(io, output_path, encoded);
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    var gpa: std.heap.DebugAllocator(.{}) = .{};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var args_list: std.ArrayList([:0]const u8) = .empty;
    defer args_list.deinit(allocator);
    var args_it = std.process.Args.Iterator.init(init.minimal.args);
    while (args_it.next()) |arg| try args_list.append(allocator, arg);
    const options = parseOptions(args_list.items) catch |err| {
        usage();
        return err;
    };
    switch (options.command) {
        .inspect => try inspect(io, allocator, options.input),
        .inspect_retopo_guide => try inspectRetopoGuide(io, allocator, options.input),
        .inspect_skin_binding => try inspectSkinBinding(io, allocator, options.input),
        .inspect_skin_weights => try inspectSkinWeights(io, allocator, options.input, options.skin.?),
        .canonicalize => try canonicalize(
            io,
            allocator,
            options.input,
            options.output.?,
            options.object_ids_path,
            options.ranges_path,
        ),
        .export_obj => try exportObj(io, allocator, options.input, options.output.?),
        .write_v4_test_fixture => try writeV4TestFixture(io, allocator, options.output.?),
    }
}

fn fixtureSnapshot(with_logical: bool) meshdoc.Snapshot {
    const V = struct {
        var verts = [_]f32{
            0, 0, 0, 0, 0, 1, 0, 0,
            1, 0, 0, 0, 0, 1, 1, 0,
            0, 1, 0, 0, 0, 1, 0, 1,
        };
        var groups = [_]u32{7};
        var logical = [_]u32{ 0, 1, 2 };
    };
    return .{
        .verts = &V.verts,
        .groups = &V.groups,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = if (with_logical) &V.logical else null,
        .logical_vertex_count = if (with_logical) 3 else 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
}

test "canonicalizer upgrades a valid v4 envelope without inventing logical topology" {
    const ranges = [_]u32{ 7, 8 };
    const snapshot = fixtureSnapshot(false);
    const old = try meshdoc.encodeSnapshotAlloc(std.testing.allocator, &snapshot, &ranges);
    defer std.testing.allocator.free(old);
    const current = try canonicalizeBytesAlloc(std.testing.allocator, old, null, null);
    defer std.testing.allocator.free(current);
    var document = try meshdoc.decodeDocument(std.testing.allocator, current);
    defer document.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(u32, 5), document.version);
    try std.testing.expect(document.render_corner_logical_ids == null);
    try std.testing.expectEqual(@as(u32, 0), document.logical_vertex_count);
}

test "canonicalizer stamps stable object ids and neutral semantics" {
    const ranges = [_]u32{ 7, 8 };
    const ids = [_][]const u8{"part:migrate:fixture"};
    const snapshot = fixtureSnapshot(false);
    const old = try meshdoc.encodeSnapshotAlloc(std.testing.allocator, &snapshot, &ranges);
    defer std.testing.allocator.free(old);
    const current = try canonicalizeBytesAlloc(std.testing.allocator, old, &ids, null);
    defer std.testing.allocator.free(current);
    var document = try meshdoc.decodeDocument(std.testing.allocator, current);
    defer document.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(u32, 5), document.version);
    try std.testing.expectEqualSlices(u32, &.{std.math.maxInt(u32)}, document.semantic_regions.?);
    try std.testing.expectEqualStrings(ids[0], document.range_object_ids.?[0]);
}

test "canonicalizer preserves a real logical table" {
    const ranges = [_]u32{ 7, 8 };
    const snapshot = fixtureSnapshot(true);
    const old = try meshdoc.encodeSnapshotAlloc(std.testing.allocator, &snapshot, &ranges);
    defer std.testing.allocator.free(old);
    const current = try canonicalizeBytesAlloc(std.testing.allocator, old, null, null);
    defer std.testing.allocator.free(current);
    var document = try meshdoc.decodeDocument(std.testing.allocator, current);
    defer document.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u32, &.{ 0, 1, 2 }, document.render_corner_logical_ids.?);
    try std.testing.expectEqual(@as(u32, 3), document.logical_vertex_count);
}

test "canonicalizer accepts only explicit recovered ranges for a rangeless legacy document" {
    const ranges = [_]u32{ 7, 8 };
    const ids = [_][]const u8{"part:migrate:recovered"};
    const snapshot = fixtureSnapshot(false);
    const with_range = try meshdoc.encodeSnapshotAlloc(std.testing.allocator, &snapshot, &ranges);
    defer std.testing.allocator.free(with_range);

    // The range section is the final eight bytes in this v4/no-semantics fixture.
    // Removing it and changing the stored count produces the exact historical
    // rangeless spelling accepted by both readers; range recovery itself belongs
    // to the production TS connectivity algorithm, not this codec.
    const rangeless = try std.testing.allocator.dupe(u8, with_range[0 .. with_range.len - 8]);
    defer std.testing.allocator.free(rangeless);
    std.mem.writeInt(u32, rangeless[20..24], 0, .little);
    var decoded = try meshdoc.decodeDocument(std.testing.allocator, rangeless);
    defer decoded.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), decoded.ranges.len);

    try std.testing.expectError(
        error.InvalidSnapshot,
        canonicalizeBytesAlloc(std.testing.allocator, rangeless, &ids, null),
    );
    const current = try canonicalizeBytesAlloc(std.testing.allocator, rangeless, &ids, &ranges);
    defer std.testing.allocator.free(current);
    var roundtrip = try meshdoc.decodeDocument(std.testing.allocator, current);
    defer roundtrip.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u32, &ranges, roundtrip.ranges);
}
