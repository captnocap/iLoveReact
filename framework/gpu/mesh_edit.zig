//! Host-native mesh-element selection — the foundation of the in-house mesh editor.
//!
//! The Studio did vertex/edge/face selection in JS: it re-derived the camera in
//! JavaScript (meshSelect.tsx `makeProjector`) and screen-projected the whole mesh every
//! frame to pick + draw 2D overlays. That parallel camera math is exactly what drifted off
//! the model on zoom. Here selection lives in the HOST, against the SAME resident mesh and
//! the SAME camera the renderer uses (model_paint.cameraRay/project), so a picked vertex is
//! the pixel its raycast shoots back through — zero drift, no per-frame React render.
//!
//! The resident mesh is non-indexed (3 verts per triangle — every face owns its corners),
//! which is perfect for per-face paint but wrong for editing: moving "a vertex" must move
//! every triangle corner that shares its position. So we WELD: hash positions into logical
//! vertices, build the corner→vertex map and the unique edge list once, and select against
//! that. The same welded topology drives the coming gizmo (it transforms logical vertices →
//! writes back to every incident corner) and lives in harmony with the paint layers.
//!
//! Selection appearance is rendered by 3d.zig's screen-space overlay. It never rides the
//! paint atlas: selection must not obscure a UV's true multi-colour sample or create a
//! save/restore path capable of carrying pixels as geometry moves. Selection state and
//! picking live here; all presentation stays in the overlay pass.

const std = @import("std");
const builtin = @import("builtin");
const model_paint = @import("model_paint.zig");
const model_source = @import("model_source.zig");

pub const partRangesValid = model_source.partRangesValid;
pub const MeshDocFaceBlock = model_source.MeshDocFaceBlock;
pub const composeMeshDocSnapshot = model_source.composeMeshDocSnapshot;
pub const meshDocRangesOwnEveryFace = model_source.meshDocRangesOwnEveryFace;

const alloc = std.heap.c_allocator;

pub const Mode = enum(u8) { none = 0, vertex = 1, edge = 2, face = 3 };
pub const Mutation = struct {
    changed: bool = false,
    first_face: u32 = 0,
    last_face: u32 = 0,
};
pub const Edge = [2]u32;

/// Preview-only retopology bands. The planner deliberately owns no mesh mutation:
/// it partitions every displayed triangle by the centroid's coordinate on one
/// explicit axis, then the renderer may tint those assignments for review.
pub const RetopoBandTuning = struct {
    pub const min_width_m: f32 = 0.0001;
    pub const max_bands: u16 = 128;
};

// Durable model-package record for the teaching map and its frozen before-image.
// The overlay is not render/material data, but it is authored work: losing it at a
// process boundary destroys the user's demonstrated topology plan. Keep the wire
// format small and versioned so a 10k-face source costs hundreds of KB, not a huge
// JSON bridge allocation.
pub const RETOPO_GUIDE_MAGIC: u32 = 0x44475452; // "RTGD" little-endian
pub const RETOPO_GUIDE_VERSION: u32 = 1;
const RETOPO_GUIDE_HEADER_WORDS: usize = 6;
const RETOPO_GUIDE_FLAG_GHOST_VISIBLE: u32 = 1 << 0;
const RETOPO_GUIDE_FLAG_SOURCE_TRACKS_LIVE: u32 = 1 << 1;

pub const RetopoGuide = struct {
    live_bands: []const u16,
    source_positions: []const f32,
    source_bands: []const u16,
    ghost_visible: bool,
    source_tracks_live: bool,
};

pub const OwnedRetopoGuide = struct {
    live_bands: []u16,
    source_positions: []f32,
    source_bands: []u16,
    ghost_visible: bool,
    source_tracks_live: bool,

    pub fn deinit(self: *OwnedRetopoGuide, allocator: std.mem.Allocator) void {
        allocator.free(self.live_bands);
        allocator.free(self.source_positions);
        allocator.free(self.source_bands);
        self.* = undefined;
    }

    pub fn view(self: *const OwnedRetopoGuide) RetopoGuide {
        return .{
            .live_bands = self.live_bands,
            .source_positions = self.source_positions,
            .source_bands = self.source_bands,
            .ghost_visible = self.ghost_visible,
            .source_tracks_live = self.source_tracks_live,
        };
    }
};

fn validRetopoGuideBand(value: u16) bool {
    return value == RETOPO_BAND_UNASSIGNED or value < RetopoBandTuning.max_bands;
}

fn writeRetopoGuideWord(bytes: []u8, word: usize, value: u32) void {
    const at = word * @sizeOf(u32);
    std.mem.writeInt(u32, bytes[at..][0..4], value, .little);
}

fn readRetopoGuideWord(bytes: []const u8, word: usize) u32 {
    const at = word * @sizeOf(u32);
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}

pub fn encodeRetopoGuide(allocator: std.mem.Allocator, guide: RetopoGuide) ![]u8 {
    if (guide.live_bands.len == 0 or guide.source_bands.len == 0) return error.InvalidRetopoGuide;
    if (guide.live_bands.len > std.math.maxInt(u32) or guide.source_bands.len > std.math.maxInt(u32)) return error.InvalidRetopoGuide;
    const source_position_words = std.math.mul(usize, guide.source_bands.len, 9) catch return error.InvalidRetopoGuide;
    if (guide.source_positions.len != source_position_words) return error.InvalidRetopoGuide;
    for (guide.live_bands) |band| if (!validRetopoGuideBand(band)) return error.InvalidRetopoGuide;
    for (guide.source_bands) |band| if (!validRetopoGuideBand(band)) return error.InvalidRetopoGuide;

    var total_words = std.math.add(usize, RETOPO_GUIDE_HEADER_WORDS, guide.live_bands.len) catch return error.InvalidRetopoGuide;
    total_words = std.math.add(usize, total_words, guide.source_bands.len) catch return error.InvalidRetopoGuide;
    total_words = std.math.add(usize, total_words, source_position_words) catch return error.InvalidRetopoGuide;
    const byte_count = std.math.mul(usize, total_words, @sizeOf(u32)) catch return error.InvalidRetopoGuide;
    const bytes = try allocator.alloc(u8, byte_count);
    errdefer allocator.free(bytes);

    const flags = (if (guide.ghost_visible) RETOPO_GUIDE_FLAG_GHOST_VISIBLE else 0) |
        (if (guide.source_tracks_live) RETOPO_GUIDE_FLAG_SOURCE_TRACKS_LIVE else 0);
    writeRetopoGuideWord(bytes, 0, RETOPO_GUIDE_MAGIC);
    writeRetopoGuideWord(bytes, 1, RETOPO_GUIDE_VERSION);
    writeRetopoGuideWord(bytes, 2, @intCast(guide.live_bands.len));
    writeRetopoGuideWord(bytes, 3, @intCast(guide.source_bands.len));
    writeRetopoGuideWord(bytes, 4, flags);
    writeRetopoGuideWord(bytes, 5, 0);
    var word = RETOPO_GUIDE_HEADER_WORDS;
    for (guide.live_bands) |band| {
        writeRetopoGuideWord(bytes, word, band);
        word += 1;
    }
    for (guide.source_bands) |band| {
        writeRetopoGuideWord(bytes, word, band);
        word += 1;
    }
    for (guide.source_positions) |position| {
        if (!std.math.isFinite(position)) return error.InvalidRetopoGuide;
        writeRetopoGuideWord(bytes, word, @bitCast(position));
        word += 1;
    }
    return bytes;
}

pub fn decodeRetopoGuide(allocator: std.mem.Allocator, bytes: []const u8) !OwnedRetopoGuide {
    if (bytes.len < RETOPO_GUIDE_HEADER_WORDS * @sizeOf(u32) or bytes.len % @sizeOf(u32) != 0) return error.InvalidRetopoGuide;
    if (readRetopoGuideWord(bytes, 0) != RETOPO_GUIDE_MAGIC or readRetopoGuideWord(bytes, 1) != RETOPO_GUIDE_VERSION) return error.InvalidRetopoGuide;
    const live_count: usize = @intCast(readRetopoGuideWord(bytes, 2));
    const source_count: usize = @intCast(readRetopoGuideWord(bytes, 3));
    const flags = readRetopoGuideWord(bytes, 4);
    if (live_count == 0 or source_count == 0 or flags & ~(RETOPO_GUIDE_FLAG_GHOST_VISIBLE | RETOPO_GUIDE_FLAG_SOURCE_TRACKS_LIVE) != 0) return error.InvalidRetopoGuide;
    const source_position_words = std.math.mul(usize, source_count, 9) catch return error.InvalidRetopoGuide;
    var expected_words = std.math.add(usize, RETOPO_GUIDE_HEADER_WORDS, live_count) catch return error.InvalidRetopoGuide;
    expected_words = std.math.add(usize, expected_words, source_count) catch return error.InvalidRetopoGuide;
    expected_words = std.math.add(usize, expected_words, source_position_words) catch return error.InvalidRetopoGuide;
    if (bytes.len / @sizeOf(u32) != expected_words) return error.InvalidRetopoGuide;

    const live_bands = try allocator.alloc(u16, live_count);
    errdefer allocator.free(live_bands);
    const source_bands = try allocator.alloc(u16, source_count);
    errdefer allocator.free(source_bands);
    const source_positions = try allocator.alloc(f32, source_position_words);
    errdefer allocator.free(source_positions);
    var word = RETOPO_GUIDE_HEADER_WORDS;
    for (live_bands) |*band| {
        const raw = readRetopoGuideWord(bytes, word);
        if (raw > std.math.maxInt(u16)) return error.InvalidRetopoGuide;
        band.* = @intCast(raw);
        if (!validRetopoGuideBand(band.*)) return error.InvalidRetopoGuide;
        word += 1;
    }
    for (source_bands) |*band| {
        const raw = readRetopoGuideWord(bytes, word);
        if (raw > std.math.maxInt(u16)) return error.InvalidRetopoGuide;
        band.* = @intCast(raw);
        if (!validRetopoGuideBand(band.*)) return error.InvalidRetopoGuide;
        word += 1;
    }
    for (source_positions) |*position| {
        position.* = @bitCast(readRetopoGuideWord(bytes, word));
        if (!std.math.isFinite(position.*)) return error.InvalidRetopoGuide;
        word += 1;
    }
    return .{
        .live_bands = live_bands,
        .source_positions = source_positions,
        .source_bands = source_bands,
        .ghost_visible = flags & RETOPO_GUIDE_FLAG_GHOST_VISIBLE != 0,
        .source_tracks_live = flags & RETOPO_GUIDE_FLAG_SOURCE_TRACKS_LIVE != 0,
    };
}
pub const RETOPO_BAND_UNASSIGNED: u16 = std.math.maxInt(u16);

/// Apply one user-authored preview label to an exact displayed-triangle mask.
/// `label=null` erases the tint. This is deliberately geometry-agnostic: the
/// user's face selection is the specification, so no planner may reinterpret it.
pub fn assignRetopoManualBand(labels: []u16, selected: []const bool, label: ?u16) u32 {
    if (selected.len < labels.len) return 0;
    var changed: u32 = 0;
    for (labels, 0..) |*current, face| {
        if (!selected[face]) continue;
        current.* = label orelse RETOPO_BAND_UNASSIGNED;
        changed += 1;
    }
    return changed;
}

/// Carry preview-only retopology labels through an indexed topology result.
/// `source_faces` is the same provenance map used by paint/material inheritance:
/// every output triangle names the input triangle from which it was minted.
pub fn inheritRetopoManualBands(labels_in: []const u16, source_faces: []const u32, labels_out: []u16) bool {
    if (labels_out.len != source_faces.len) return false;
    for (source_faces) |source| {
        if (source >= labels_in.len) return false;
    }
    for (source_faces, 0..) |source, output| labels_out[output] = labels_in[source];
    return true;
}

/// Compact labels through a face-removal mask. Output order exactly matches the
/// survivor order used by the resident triangle-soup delete/weld rebuild.
pub fn compactRetopoManualBands(labels_in: []const u16, removed: []const bool, labels_out: []u16) bool {
    if (removed.len != labels_in.len) return false;
    var output: usize = 0;
    for (labels_in, 0..) |label, face| {
        if (removed[face]) continue;
        if (output >= labels_out.len) return false;
        labels_out[output] = label;
        output += 1;
    }
    return output == labels_out.len;
}

/// Return the one authored band shared by every face in a non-empty mask. An
/// unassigned or mixed selection deliberately has no inheritable band.
pub fn uniformRetopoManualBand(labels: []const u16, selected: []const bool) ?u16 {
    if (selected.len != labels.len) return null;
    var found: ?u16 = null;
    for (labels, 0..) |label, face| {
        if (!selected[face]) continue;
        if (label == RETOPO_BAND_UNASSIGNED) return null;
        if (found) |current| {
            if (current != label) return null;
        } else found = label;
    }
    return found;
}

/// The frozen source accepts tint edits only while the resident topology is the
/// exact generation/face domain it captured. After the first topology mutation,
/// live labels may continue evolving but the before-image is immutable.
pub fn retopoSourceGhostTracks(captured_generation: u32, resident_generation: u32, ghost_faces: usize, resident_faces: usize) bool {
    return captured_generation == resident_generation and ghost_faces == resident_faces;
}

pub fn assignedRetopoBandCount(labels: []const u16) u32 {
    var count: u32 = 0;
    for (labels) |label| if (label != RETOPO_BAND_UNASSIGNED) {
        count += 1;
    };
    return count;
}
pub const RetopoBandMode = enum { axis, rails };
pub const RetopoBandSummary = struct {
    id: u16,
    bucket: i32,
    faces: u32 = 0,
    range: [2]f32,
    bbox: [6]f32 = .{
        std.math.inf(f32),  std.math.inf(f32),  std.math.inf(f32),
        -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32),
    },
};
pub const RetopoBandPlan = struct {
    mode: RetopoBandMode = .axis,
    axis: u8,
    width: f32,
    origin: f32,
    rail_samples: u16 = 0,
    faces: []u16,
    bands: []RetopoBandSummary,

    pub fn deinit(self: *RetopoBandPlan, allocator: std.mem.Allocator) void {
        allocator.free(self.faces);
        allocator.free(self.bands);
        self.* = undefined;
    }
};

/// Partition packed triangle positions (`xyz` × 3 per face) into complete,
/// phase-adjustable axis bands. `origin=null` anchors band zero at the lowest
/// face centroid. Negative buckets are normalized to dense ids while retained in
/// each summary, so a demonstrated belt can be used as the phase origin.
pub fn planRetopoAxisBands(
    allocator: std.mem.Allocator,
    positions: []const f32,
    face_count: u32,
    axis: u8,
    width: f32,
    requested_origin: ?f32,
) !RetopoBandPlan {
    if (axis > 2 or !std.math.isFinite(width) or width < RetopoBandTuning.min_width_m) return error.InvalidArguments;
    const count: usize = @intCast(face_count);
    if (count == 0 or positions.len < count * 9) return error.InvalidArguments;

    var minimum_centroid = std.math.inf(f32);
    var face: usize = 0;
    while (face < count) : (face += 1) {
        const base = face * 9 + axis;
        const centroid = (positions[base] + positions[base + 3] + positions[base + 6]) / 3.0;
        if (!std.math.isFinite(centroid)) return error.InvalidArguments;
        minimum_centroid = @min(minimum_centroid, centroid);
    }
    const origin = requested_origin orelse minimum_centroid;
    if (!std.math.isFinite(origin)) return error.InvalidArguments;

    var min_bucket: i32 = std.math.maxInt(i32);
    var max_bucket: i32 = std.math.minInt(i32);
    face = 0;
    while (face < count) : (face += 1) {
        const base = face * 9 + axis;
        const centroid = (positions[base] + positions[base + 3] + positions[base + 6]) / 3.0;
        const raw = @floor((centroid - origin) / width);
        if (raw < @as(f32, @floatFromInt(std.math.minInt(i32))) or raw > @as(f32, @floatFromInt(std.math.maxInt(i32)))) return error.TooManyBands;
        const bucket: i32 = @intFromFloat(raw);
        min_bucket = @min(min_bucket, bucket);
        max_bucket = @max(max_bucket, bucket);
    }
    const band_count_i64 = @as(i64, max_bucket) - @as(i64, min_bucket) + 1;
    if (band_count_i64 < 1 or band_count_i64 > RetopoBandTuning.max_bands) return error.TooManyBands;
    const band_count: usize = @intCast(band_count_i64);
    const labels = try allocator.alloc(u16, count);
    errdefer allocator.free(labels);
    const summaries = try allocator.alloc(RetopoBandSummary, band_count);
    errdefer allocator.free(summaries);
    for (summaries, 0..) |*summary, id| {
        const bucket = min_bucket + @as(i32, @intCast(id));
        summary.* = .{
            .id = @intCast(id),
            .bucket = bucket,
            .range = .{ origin + @as(f32, @floatFromInt(bucket)) * width, origin + @as(f32, @floatFromInt(bucket + 1)) * width },
        };
    }

    face = 0;
    while (face < count) : (face += 1) {
        const base = face * 9;
        const centroid = (positions[base + axis] + positions[base + 3 + axis] + positions[base + 6 + axis]) / 3.0;
        const bucket: i32 = @intFromFloat(@floor((centroid - origin) / width));
        const id: u16 = @intCast(bucket - min_bucket);
        labels[face] = id;
        const summary = &summaries[id];
        summary.faces += 1;
        var corner: usize = 0;
        while (corner < 3) : (corner += 1) {
            const at = base + corner * 3;
            summary.bbox[0] = @min(summary.bbox[0], positions[at]);
            summary.bbox[1] = @min(summary.bbox[1], positions[at + 1]);
            summary.bbox[2] = @min(summary.bbox[2], positions[at + 2]);
            summary.bbox[3] = @max(summary.bbox[3], positions[at]);
            summary.bbox[4] = @max(summary.bbox[4], positions[at + 1]);
            summary.bbox[5] = @max(summary.bbox[5], positions[at + 2]);
        }
    }
    return .{ .axis = axis, .width = width, .origin = origin, .faces = labels, .bands = summaries };
}

/// Classify every face relative to an ordered pair of locally vertical rails.
/// Each sample is lower.xyz + upper.xyz; consecutive samples form the curved
/// bottom/top paths. A face projects to the nearest XZ rail segment and uses that
/// segment's interpolated local lower/upper Y, so a sloped established belt never
/// becomes one global min/max slab.
pub fn planRetopoRailBands(
    allocator: std.mem.Allocator,
    positions: []const f32,
    face_count: u32,
    rail_pairs: []const f32,
) !RetopoBandPlan {
    const count: usize = @intCast(face_count);
    if (count == 0 or positions.len < count * 9 or rail_pairs.len < 12 or rail_pairs.len % 6 != 0) return error.InvalidArguments;
    const sample_count = rail_pairs.len / 6;
    if (sample_count > std.math.maxInt(u16)) return error.InvalidArguments;
    var mean_height: f32 = 0;
    for (0..sample_count) |sample| {
        const at = sample * 6;
        const height = rail_pairs[at + 4] - rail_pairs[at + 1];
        if (!std.math.isFinite(height) or height < RetopoBandTuning.min_width_m) return error.InvalidArguments;
        mean_height += height;
    }
    mean_height /= @floatFromInt(sample_count);

    const buckets = try allocator.alloc(i32, count);
    defer allocator.free(buckets);
    var min_bucket: i32 = std.math.maxInt(i32);
    var max_bucket: i32 = std.math.minInt(i32);
    var face: usize = 0;
    while (face < count) : (face += 1) {
        const base = face * 9;
        const cx = (positions[base] + positions[base + 3] + positions[base + 6]) / 3.0;
        const cy = (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3.0;
        const cz = (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3.0;
        if (!std.math.isFinite(cx) or !std.math.isFinite(cy) or !std.math.isFinite(cz)) return error.InvalidArguments;
        var best_distance = std.math.inf(f32);
        var local_lower: f32 = 0;
        var local_upper: f32 = 0;
        var segment: usize = 0;
        while (segment + 1 < sample_count) : (segment += 1) {
            const a = segment * 6;
            const b = (segment + 1) * 6;
            const dx = rail_pairs[b] - rail_pairs[a];
            const dz = rail_pairs[b + 2] - rail_pairs[a + 2];
            const length_sq = dx * dx + dz * dz;
            const t = if (length_sq > 1e-12)
                std.math.clamp(((cx - rail_pairs[a]) * dx + (cz - rail_pairs[a + 2]) * dz) / length_sq, 0, 1)
            else
                0;
            const px = rail_pairs[a] + dx * t;
            const pz = rail_pairs[a + 2] + dz * t;
            const distance = (cx - px) * (cx - px) + (cz - pz) * (cz - pz);
            if (distance >= best_distance) continue;
            best_distance = distance;
            local_lower = rail_pairs[a + 1] + (rail_pairs[b + 1] - rail_pairs[a + 1]) * t;
            local_upper = rail_pairs[a + 4] + (rail_pairs[b + 4] - rail_pairs[a + 4]) * t;
        }
        const local_height = local_upper - local_lower;
        if (local_height < RetopoBandTuning.min_width_m) return error.InvalidArguments;
        const raw = @floor((cy - local_lower) / local_height);
        if (raw < @as(f32, @floatFromInt(std.math.minInt(i32))) or raw > @as(f32, @floatFromInt(std.math.maxInt(i32)))) return error.TooManyBands;
        const bucket: i32 = @intFromFloat(raw);
        buckets[face] = bucket;
        min_bucket = @min(min_bucket, bucket);
        max_bucket = @max(max_bucket, bucket);
    }

    const band_count_i64 = @as(i64, max_bucket) - @as(i64, min_bucket) + 1;
    if (band_count_i64 < 1 or band_count_i64 > RetopoBandTuning.max_bands) return error.TooManyBands;
    const band_count: usize = @intCast(band_count_i64);
    const labels = try allocator.alloc(u16, count);
    errdefer allocator.free(labels);
    const summaries = try allocator.alloc(RetopoBandSummary, band_count);
    errdefer allocator.free(summaries);
    for (summaries, 0..) |*summary, id| {
        const bucket = min_bucket + @as(i32, @intCast(id));
        summary.* = .{
            .id = @intCast(id),
            .bucket = bucket,
            .range = .{ @as(f32, @floatFromInt(bucket)) * mean_height, @as(f32, @floatFromInt(bucket + 1)) * mean_height },
        };
    }
    face = 0;
    while (face < count) : (face += 1) {
        const id: u16 = @intCast(buckets[face] - min_bucket);
        labels[face] = id;
        const summary = &summaries[id];
        summary.faces += 1;
        const base = face * 9;
        var corner: usize = 0;
        while (corner < 3) : (corner += 1) {
            const at = base + corner * 3;
            summary.bbox[0] = @min(summary.bbox[0], positions[at]);
            summary.bbox[1] = @min(summary.bbox[1], positions[at + 1]);
            summary.bbox[2] = @min(summary.bbox[2], positions[at + 2]);
            summary.bbox[3] = @max(summary.bbox[3], positions[at]);
            summary.bbox[4] = @max(summary.bbox[4], positions[at + 1]);
            summary.bbox[5] = @max(summary.bbox[5], positions[at + 2]);
        }
    }
    return .{
        .mode = .rails,
        .axis = 1,
        .width = mean_height,
        .origin = 0,
        .rail_samples = @intCast(sample_count),
        .faces = labels,
        .bands = summaries,
    };
}

// The resident model-view mesh format: position3 / normal3 / uv2, three rows per
// render triangle. These are layout constants, not tuning values.
const EDIT_VERTEX_FLOATS: usize = 8;
const TRIANGLE_VERTICES: usize = 3;
const TRIANGLE_FLOATS: usize = EDIT_VERTEX_FLOATS * TRIANGLE_VERTICES;
const NORMAL_FIRST: usize = 3;
const NORMAL_END: usize = 6;

/// Reverse every selected render triangle's winding while keeping each corner's UV
/// paired with its position. Negating the carried vertex normals makes this the native
/// triangle-soup twin of cart/editor/model/editMesh.ts `flipFace`: geometry, grouping,
/// and paint coordinates stay put; only the side the face points toward changes.
///
/// Returns the number of triangles flipped. An undersized mesh/mask is rejected at the
/// boundary before any write, so callers never receive a half-flipped authored face.
pub fn flipSelectedTriangleWinding(verts: []f32, triangle_count: u32, selected: []const bool) u32 {
    const count: usize = @intCast(triangle_count);
    if (selected.len < count or count > verts.len / TRIANGLE_FLOATS) return 0;

    var flipped: u32 = 0;
    var face: usize = 0;
    while (face < count) : (face += 1) {
        if (!selected[face]) continue;
        const base = face * TRIANGLE_FLOATS;
        const second = base + EDIT_VERTEX_FLOATS;
        const third = second + EDIT_VERTEX_FLOATS;

        // (a,b,c) -> (a,c,b) is one odd permutation: winding reverses without
        // changing the triangle's existing diagonal. Whole interleaved rows move, so
        // UVs remain attached to their geometric corners.
        var attr: usize = 0;
        while (attr < EDIT_VERTEX_FLOATS) : (attr += 1) {
            const tmp = verts[second + attr];
            verts[second + attr] = verts[third + attr];
            verts[third + attr] = tmp;
        }
        var corner: usize = 0;
        while (corner < TRIANGLE_VERTICES) : (corner += 1) {
            const row = base + corner * EDIT_VERTEX_FLOATS;
            var normal_attr = NORMAL_FIRST;
            while (normal_attr < NORMAL_END) : (normal_attr += 1) verts[row + normal_attr] = -verts[row + normal_attr];
        }
        flipped += 1;
    }
    return flipped;
}

// ── Winding repair (req_3450) ─────────────────────────────────────────────────────────
// Imported meshes can carry MIXED winding — triangles wound against their neighbors —
// which the editor's and world's back-face culling exposes as see-through faces ("every
// part I am face on looking at is invisible"). Nothing in the GLB/OBJ path normalizes
// orientation, so the defect survives save/placement verbatim.

const WindingEdgeUse = struct {
    tri: [2]u32 = .{ 0, 0 },
    /// Whether the triangle traverses this undirected edge as (lo→hi).
    forward: [2]bool = .{ false, false },
    count: u32 = 0,
};

/// Mark every render triangle wound AGAINST its neighbors, plus every closed
/// component that is wholly inside-out. Orientation propagates across each edge
/// shared by exactly TWO real triangles (a consistent surface traverses a shared
/// edge in opposite directions); each connected component then orients globally.
/// Components with NO boundary edges make their CENTROID-CENTERED signed volume
/// positive — this is what catches the real import defect (bookshelf_001): an
/// inside-out panel box glued to the body at T-junction edges, internally
/// consistent, so only its enclosed volume betrays it. Centering makes the test
/// position-independent for the planar coincident stacks such junctions create
/// (a flat sheet encloses exactly zero about its own centroid, so it never
/// flips on volume noise). Open sheets (boundary edges present) keep whichever
/// side needs fewer flips. Deliberate authoring stays untouched: degenerate wire
/// rows (Pen Edges' (a,b,b) format) never join the graph, and ≥3-incidence
/// edges are never crossed. Returns the number of triangles marked.
pub fn inconsistentWindingMask(verts: []const f32, triangle_count: u32, out_flip: []bool) u32 {
    const count: usize = @intCast(triangle_count);
    if (out_flip.len < count or count == 0 or count > verts.len / TRIANGLE_FLOATS) return 0;
    @memset(out_flip[0..count], false);

    // Weld corner positions to logical ids (exact quantised 3-int keys — see weldKey).
    const corner_vert = alloc.alloc(u32, count * 3) catch return 0;
    defer alloc.free(corner_vert);
    var weld = std.AutoHashMapUnmanaged([3]i32, u32).empty;
    defer weld.deinit(alloc);
    var next_vert: u32 = 0;
    for (0..count * 3) |corner| {
        const base = corner * EDIT_VERTEX_FLOATS;
        const entry = weld.getOrPut(alloc, weldKey(.{ verts[base], verts[base + 1], verts[base + 2] })) catch return 0;
        if (!entry.found_existing) {
            entry.value_ptr.* = next_vert;
            next_vert += 1;
        }
        corner_vert[corner] = entry.value_ptr.*;
    }

    // Undirected edge incidences. Degenerate triangles (repeated welded corner —
    // the wire-edge format) contribute nothing and are never flipped.
    const real = alloc.alloc(bool, count) catch return 0;
    defer alloc.free(real);
    var edges = std.AutoHashMapUnmanaged([2]u32, WindingEdgeUse).empty;
    defer edges.deinit(alloc);
    for (0..count) |tri| {
        const a = corner_vert[tri * 3];
        const b = corner_vert[tri * 3 + 1];
        const c = corner_vert[tri * 3 + 2];
        real[tri] = a != b and b != c and c != a;
        if (!real[tri]) continue;
        const tri_edges = [3][2]u32{ .{ a, b }, .{ b, c }, .{ c, a } };
        for (tri_edges) |edge| {
            const lo = @min(edge[0], edge[1]);
            const hi = @max(edge[0], edge[1]);
            const entry = edges.getOrPut(alloc, .{ lo, hi }) catch return 0;
            if (!entry.found_existing) entry.value_ptr.* = .{};
            const use = entry.value_ptr;
            if (use.count < 2) {
                use.tri[use.count] = @intCast(tri);
                use.forward[use.count] = edge[0] == lo;
            }
            use.count += 1;
        }
    }

    // Propagate orientation per component. parity: 0 = unvisited, 1 = keep, 2 = flip.
    const parity = alloc.alloc(u8, count) catch return 0;
    defer alloc.free(parity);
    @memset(parity, 0);
    var stack = std.ArrayListUnmanaged(u32).empty;
    defer stack.deinit(alloc);
    var component = std.ArrayListUnmanaged(u32).empty;
    defer component.deinit(alloc);
    var marked: u32 = 0;

    for (0..count) |seed| {
        if (!real[seed] or parity[seed] != 0) continue;
        parity[seed] = 1;
        component.clearRetainingCapacity();
        stack.clearRetainingCapacity();
        stack.append(alloc, @intCast(seed)) catch return 0;
        component.append(alloc, @intCast(seed)) catch return 0;
        var boundary_edges: u32 = 0;
        while (stack.pop()) |tri| {
            const flipped_here = parity[tri] == 2;
            const a = corner_vert[tri * 3];
            const b = corner_vert[tri * 3 + 1];
            const c = corner_vert[tri * 3 + 2];
            const tri_edges = [3][2]u32{ .{ a, b }, .{ b, c }, .{ c, a } };
            for (tri_edges) |edge| {
                const lo = @min(edge[0], edge[1]);
                const hi = @max(edge[0], edge[1]);
                const use = edges.get(.{ lo, hi }) orelse continue;
                if (use.count == 1) {
                    boundary_edges += 1;
                    continue;
                }
                // Only a clean two-triangle edge carries orientation. Non-manifold
                // stacks (T-junctions between merged boxes, coincident two-sided
                // sheets) are never crossed.
                if (use.count != 2) continue;
                const self_slot: usize = if (use.tri[0] == tri) 0 else 1;
                if (use.tri[self_slot] != tri) continue; // this tri overflowed the 2-slot record
                const other = use.tri[1 - self_slot];
                if (!real[other]) continue;
                // Consistent neighbors traverse the shared edge in OPPOSITE directions.
                const self_effective = use.forward[self_slot] != flipped_here;
                const other_needs_flip = use.forward[1 - self_slot] == self_effective;
                const wanted: u8 = if (other_needs_flip) 2 else 1;
                if (parity[other] == 0) {
                    parity[other] = wanted;
                    stack.append(alloc, other) catch return 0;
                    component.append(alloc, other) catch return 0;
                }
                // A contradicting already-set parity is a Möbius-like conflict; the
                // seed orientation wins and the odd triangle stays as classified.
            }
        }

        // Global orientation. No boundary edges → the component encloses space,
        // even when it meets the rest of the mesh only at uncrossable junctions:
        // its CENTROID-CENTERED signed volume (with parities applied) must be
        // positive. Centering zeroes the measure for flat coincident stacks, so
        // only genuinely enclosing shells can trip the rule. Open sheets flip
        // their minority instead.
        var centroid = [3]f64{ 0, 0, 0 };
        for (component.items) |tri| {
            const o = @as(usize, tri) * TRIANGLE_FLOATS;
            var corner: usize = 0;
            while (corner < TRIANGLE_VERTICES) : (corner += 1) {
                const row = o + corner * EDIT_VERTEX_FLOATS;
                centroid[0] += verts[row];
                centroid[1] += verts[row + 1];
                centroid[2] += verts[row + 2];
            }
        }
        const corner_total: f64 = @floatFromInt(component.items.len * 3);
        centroid[0] /= corner_total;
        centroid[1] /= corner_total;
        centroid[2] /= corner_total;
        var volume: f64 = 0;
        var flips: u32 = 0;
        for (component.items) |tri| {
            const o = @as(usize, tri) * TRIANGLE_FLOATS;
            const sign: f64 = if (parity[tri] == 2) -1 else 1;
            const ax: f64 = verts[o] - centroid[0];
            const ay: f64 = verts[o + 1] - centroid[1];
            const az: f64 = verts[o + 2] - centroid[2];
            const bx: f64 = verts[o + 8] - centroid[0];
            const by: f64 = verts[o + 9] - centroid[1];
            const bz: f64 = verts[o + 10] - centroid[2];
            const cx: f64 = verts[o + 16] - centroid[0];
            const cy: f64 = verts[o + 17] - centroid[1];
            const cz: f64 = verts[o + 18] - centroid[2];
            volume += sign * (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6.0;
            if (parity[tri] == 2) flips += 1;
        }
        const encloses = boundary_edges == 0;
        const invert = if (encloses) volume < -1e-9 else flips * 2 > component.items.len;
        for (component.items) |tri| {
            const flip = (parity[tri] == 2) != invert;
            if (flip) {
                out_flip[tri] = true;
                marked += 1;
            }
        }
    }
    return marked;
}

/// Detect and repair mixed winding in place — the import-boundary form (req_3450):
/// every GLB/OBJ arrival runs through this so inconsistent source meshes enter the
/// editor already coherent. Returns the number of triangles flipped (0 = clean).
pub fn normalizeTriangleWinding(verts: []f32, triangle_count: u32) u32 {
    const count: usize = @intCast(triangle_count);
    if (count == 0 or count > verts.len / TRIANGLE_FLOATS) return 0;
    const mask = alloc.alloc(bool, count) catch return 0;
    defer alloc.free(mask);
    if (inconsistentWindingMask(verts, triangle_count, mask) == 0) return 0;
    return flipSelectedTriangleWinding(verts, triangle_count, mask);
}

/// Click radius (pixels) for screen-nearest vertex / edge picking.
const VERT_PX: f32 = 12;
const EDGE_PX: f32 = 9;
/// Weld grid: positions rounded to this many units/metre collapse to one logical vertex.
const WELD_Q: f32 = 1024.0;

var g_mode: Mode = .none;

// ── Welded topology (built lazily from model_paint's CPU positions) ──────────────────
var g_built_for: u32 = 0; // facecount the current topology was built for (0 = none)
var g_verts: ?[]f32 = null; // unique vertex positions, 3 f32 each
var g_vert_count: u32 = 0;
var g_vert_part: ?[]u32 = null; // one outliner part id per logical vertex
var g_corner_vert: ?[]u32 = null; // facecount*3 → logical vertex index
var g_edges: ?[]u32 = null; // edgecount*2 → logical vertex indices (a<b)
var g_edge_count: u32 = 0;
// Per welded edge: is it a BOUNDARY edge (a real model edge) vs an INTERNAL one (a
// triangulation diagonal)? An edge is internal when both faces touching it belong to the
// SAME authored face-group (the two halves of one quad share their diagonal). Boundary when
// the incident faces span >1 group, when it's a naked/non-manifold edge, or when the mesh
// carries no grouping at all (a plain triangle soup — every edge is real). Selection and the
// edit overlay use ONLY boundary edges, so a cube reads as 12 edges, not 18. (req_2367)
var g_edge_boundary: ?[]bool = null;
// Number of distinct rasterizing/source faces incident to each welded edge. This is
// different from `g_edge_boundary`: boundary means an authored edge rather than a
// triangulation diagonal, while incidence==1 means an actually OPEN mesh edge.
var g_edge_incidence: ?[]u16 = null;
// Per welded edge: is it a naked WIRE edge — contributed ONLY by degenerate (repeated-
// corner) triangles, the Pen Edges format? Wire edges have no rasterizing face at all,
// so the view-mode overlay must draw them or the committed wire is invisible outside
// the edit modes. Cleared the moment any real (non-degenerate) face touches the edge.
var g_edge_wire: ?[]bool = null;
// Active edit SCOPE: when set, vertex/edge/face selection AND the overlay only consider faces
// whose authored group falls in ANY of g_scope_ranges' [lo,hi) pairs — the outliner focusing
// one part (one range) or a shift-accumulated multi-select (several ranges, req_2659) so you
// edit just those, not the whole composed model. Inactive = the whole mesh. g_scope_vert/edge
// are derived masks (a vert is in scope if it belongs to an in-scope face; an edge if both
// ends are), rebuilt lazily when the scope or facecount changes. (req_2415)
pub const max_scope_ranges: usize = 64; // outliner parts are dozens at most — truncation is LOUD below
const MAX_SCOPE_RANGES = max_scope_ranges;
var g_scope_active: bool = false;
var g_scope_ranges: [MAX_SCOPE_RANGES][2]u32 = undefined;
var g_scope_count: usize = 0;
var g_scope_vert: ?[]bool = null;
var g_scope_edge: ?[]bool = null;
var g_scope_built: u64 = 0;
var g_affect_vert: ?[]bool = null; // scratch: logical verts affected by the active selection

// ── Live mirror editing (req_2758 — the Studio's req_1183/1186 symmetric editing, host-native) ──
// With one or more planes enabled (bit 0 = X, 1 = Y, 2 = Z), every selection transform also
// lands on each moved vertex's MIRROR TWIN. The mirror plane is MIRROR_PLANE_CENTER — the
// model origin, the same plane Mirror Part duplicates across and the Center button (req_1538)
// aligns a model to. It is a fixed coordinate authority, NEVER derived from mesh, part, or
// selection bounds: a bounds-derived plane moves the moment a one-sided edit lands, which
// silently invalidated the very symmetry it was supposed to maintain (req_3795 — the chair
// whose arm dragged the "center" to x=0.05). Twins are matched by reflected position ONCE per
// topology into an index table — same outliner part preferred, any part otherwise (a
// mirror-duplicated part pairs with its twin part) — so a vertex stays paired through the
// whole modeling session even mid-drag; per-frame deltas then reflect through plain index
// lookups, no per-frame hashing. Multiple planes compose: every non-empty subset of the
// enabled axes is one reflection (X+Y on → the X twin, the Y twin, AND the XY-diagonal twin
// all follow). A vertex with no counterpart simply doesn't mirror — same honesty as the
// Studio's mirrorEditAxes.
/// The one symmetry-plane authority every mirror feature shares (live mirror, symmetrize,
/// the symmetry report, the plane overlay, and indexed diagonal sync via injection).
pub const MIRROR_PLANE_CENTER: [3]f32 = .{ 0, 0, 0 };
const MIRROR_NONE: u32 = 0xffff_ffff;
/// Twin matching quantization: positions rounded to this many units/metre must coincide.
/// Deliberately coarser than WELD_Q — mirrored halves come from float-reflected geometry
/// (the mirror-duplicate op), so exact-bit equality is too strict. 1e-3 m at model scale.
const MIRROR_Q: f32 = 1000.0;
var g_mirror_mask: u8 = 0; // enabled planes; survives model reloads (a user mode, not mesh state)
var g_mirror_twin: ?[]u32 = null; // 7 subsets × vert_count → twin vertex index (MIRROR_NONE = unpaired)
var g_mirror_built_for: u32 = 0; // vert count the table was built for (0 = stale)
var g_mirror_built_mask: u8 = 0; // mask the table was built for
var g_mirror_affect: ?[]bool = null; // scratch: verts written as mirror targets this transform

// ── Selection sets (one per element kind; modes keep their own) ──────────────────────
var g_sel_vert: ?[]bool = null;
var g_sel_edge: ?[]bool = null;
var g_sel_face: ?[]bool = null;
// Legacy atlas-highlight patches. New selection never populates this map; retaining
// restoration lets a hot-reloaded host safely unwind a patch created by older code.
var g_face_base: std.AutoHashMapUnmanaged(u32, []u8) = .empty;
// Compatibility depth for existing atlas mutation guards. The atlas now holds true
// paint at every depth; nested callers still balance through this strict boundary.
var g_tint_suspend: u32 = 0;
// Pre-press snapshot of the active set, so a press that turns into an orbit-drag can
// undo its instant pick (select on mousedown for paint-like immediacy, revert if you drag).
var g_snap: ?[]bool = null;
var g_snap_mode: Mode = .none;

// Element visibility is editor VIEW state, never mesh data. Surface mode is the
// safe default; X-Ray deliberately restores through-model handles and targeting.
// Camera masks are derived in O(faces + edges), avoiding one raycast per marker.
var g_xray: bool = false;
var g_camera_visible_vert: ?[]bool = null;
var g_camera_visible_edge: ?[]bool = null;

// ── Read accessors for the overlay renderer (3d.zig owns the GPU/capsule emit; this module
// stays GPU-free so its topology/selection logic is unit-testable without wgpu). ──────────
/// Build the welded topology if needed (so entering vertex/edge mode shows dots immediately).
pub fn ensureTopologyPub() bool {
    return ensureTopology();
}
pub fn vertPosPub(i: u32) [3]f32 {
    const v = g_verts orelse return .{ 0, 0, 0 };
    if (@as(usize, i) * 3 + 2 >= v.len) return .{ 0, 0, 0 };
    return .{ v[i * 3], v[i * 3 + 1], v[i * 3 + 2] };
}
pub fn vertPartPub(i: u32) ?u32 {
    if (!ensureTopology()) return null;
    const parts = g_vert_part orelse return null;
    return if (i < parts.len) parts[i] else null;
}
pub fn vertSelectedPub(i: u32) bool {
    const s = g_sel_vert orelse return false;
    return i < s.len and s[i];
}
pub fn edgeEndpointsPub(e: u32) [2]u32 {
    const ed = g_edges orelse return .{ 0, 0 };
    if (@as(usize, e) * 2 + 1 >= ed.len) return .{ 0, 0 };
    return .{ ed[e * 2], ed[e * 2 + 1] };
}
pub fn edgeSelectedPub(e: u32) bool {
    const s = g_sel_edge orelse return false;
    return e < s.len and s[e];
}

/// True when an editable edge runs between the two logical vertices — how a mirror-
/// extended op proves a twin EDGE actually exists before building on it (req_3797).
pub fn hasEdgeBetweenPub(a: u32, b: u32) bool {
    if (!ensureTopology()) return false;
    const ed = g_edges orelse return false;
    const lo = @min(a, b);
    const hi = @max(a, b);
    var e: usize = 0;
    while (e * 2 + 1 < ed.len) : (e += 1) {
        if (ed[e * 2] == lo and ed[e * 2 + 1] == hi) return true;
    }
    return false;
}

pub fn setXray(on: bool) void {
    g_xray = on;
}

pub fn xray() bool {
    return g_xray;
}

fn faceCameraFacing(cam: model_paint.Camera, face: u32) bool {
    const positions = model_paint.positions() orelse return false;
    const base = @as(usize, face) * 9;
    if (base + 8 >= positions.len) return false;
    const a = [3]f32{ positions[base], positions[base + 1], positions[base + 2] };
    const b = [3]f32{ positions[base + 3], positions[base + 4], positions[base + 5] };
    const c = [3]f32{ positions[base + 6], positions[base + 7], positions[base + 8] };
    const ab = [3]f32{ b[0] - a[0], b[1] - a[1], b[2] - a[2] };
    const ac = [3]f32{ c[0] - a[0], c[1] - a[1], c[2] - a[2] };
    const normal = [3]f32{
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    };
    const center = [3]f32{
        (a[0] + b[0] + c[0]) / 3.0,
        (a[1] + b[1] + c[1]) / 3.0,
        (a[2] + b[2] + c[2]) / 3.0,
    };
    const to_eye = [3]f32{ cam.eye[0] - center[0], cam.eye[1] - center[1], cam.eye[2] - center[2] };
    return normal[0] * to_eye[0] + normal[1] * to_eye[1] + normal[2] * to_eye[2] > 0.0;
}

/// Refresh the camera-derived vertex/edge target masks. Overlay presentation,
/// click candidates, and marquee selection all consume this one boundary.
pub fn refreshCameraVisibility(cam: model_paint.Camera) bool {
    if (!ensureTopology()) return false;
    if (g_camera_visible_vert == null or g_camera_visible_vert.?.len != g_vert_count) {
        if (g_camera_visible_vert) |mask| alloc.free(mask);
        g_camera_visible_vert = alloc.alloc(bool, g_vert_count) catch return false;
    }
    if (g_camera_visible_edge == null or g_camera_visible_edge.?.len != g_edge_count) {
        if (g_camera_visible_edge) |mask| alloc.free(mask);
        g_camera_visible_edge = alloc.alloc(bool, g_edge_count) catch return false;
    }
    const visible_vertices = g_camera_visible_vert.?;
    const visible_edges = g_camera_visible_edge.?;
    @memset(visible_vertices, false);
    @memset(visible_edges, false);
    if (g_xray) {
        @memset(visible_vertices, true);
        @memset(visible_edges, true);
        return true;
    }

    const corners = g_corner_vert orelse return false;
    const face_count = model_paint.faceCount();
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (!faceInScope(face) or !faceCameraFacing(cam, face)) continue;
        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const vertex = corners[face * 3 + corner];
            if (vertex < visible_vertices.len) visible_vertices[vertex] = true;
        }
    }
    const edges = g_edges orelse return false;
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        const a = edges[edge * 2];
        const b = edges[edge * 2 + 1];
        // A Pen Edges wire has no surface normal; the wire is the authored object.
        visible_edges[edge] = edgeIsWirePub(edge) or
            (a < visible_vertices.len and b < visible_vertices.len and visible_vertices[a] and visible_vertices[b]);
    }
    return true;
}

pub fn vertexCameraVisiblePub(vertex: u32) bool {
    if (g_xray) return true;
    const visible = g_camera_visible_vert orelse return false;
    return vertex < visible.len and visible[vertex];
}

pub fn edgeCameraVisiblePub(edge: u32) bool {
    if (g_xray) return true;
    const visible = g_camera_visible_edge orelse return false;
    return edge < visible.len and visible[edge];
}
/// Whether a displayed triangle belongs to the active authored-face selection.
/// UV authoring reads this same set so the 3D and 2D views never invent parallel
/// face-selection state.
pub fn faceSelectedPub(face: u32) bool {
    if (g_mode != .face) return false;
    const selected = g_sel_face orelse return false;
    return face < selected.len and selected[face];
}
/// Legacy patch read. New screen-space selection leaves the atlas true, so this is
/// normally null and callers read the live atlas directly.
pub fn savedFaceBaseColor(face: u32) ?[4]u8 {
    const patch = g_face_base.get(face) orelse return null;
    return model_paint.faceColorFromPatch(face, patch);
}
/// The logical (welded) vertex a face corner maps to — solidify walks the welded
/// topology to find selection-boundary edges and per-vertex offset normals.
pub fn cornerVertPub(f: u32, k: u32) u32 {
    const corners = g_corner_vert orelse return 0;
    const idx = @as(usize, f) * 3 + k;
    if (idx >= corners.len) return 0;
    return corners[idx];
}
/// The three welded vertex identities behind one displayed triangle. UV authoring
/// carries these alongside its corner coordinates so 2D and 3D can label the same
/// physical corner without guessing from either view's projected position.
pub fn faceCornerVerticesPub(face: u32) ?[3]u32 {
    if (!ensureTopology()) return null;
    const corners = g_corner_vert orelse return null;
    const base = @as(usize, face) * 3;
    if (base + 2 >= corners.len) return null;
    return .{ corners[base], corners[base + 1], corners[base + 2] };
}

const FollowEdgeUse = struct {
    a: u32,
    b: u32,
    first: u32,
    second: u32 = std.math.maxInt(u32),
    count: u32 = 1,
};

pub const FollowActionQueue = struct {
    const Record = struct {
        kind: u8,
        source: u8,
        before: []u8,
        after: []u8,
    };

    records: std.ArrayListUnmanaged(Record) = .empty,

    pub fn deinit(queue: *FollowActionQueue, allocator: std.mem.Allocator) void {
        queue.clear(allocator);
        queue.records.deinit(allocator);
    }

    pub fn clear(queue: *FollowActionQueue, allocator: std.mem.Allocator) void {
        for (queue.records.items) |record| {
            allocator.free(record.before);
            allocator.free(record.after);
        }
        queue.records.clearRetainingCapacity();
    }

    /// Retain every accepted native Merge Faces lesson until Follow reads it.
    /// The queue, rather than a single "last merge" slot, is load-bearing: a user
    /// can complete several quick strips between React/CLI polling beats.
    pub fn append(
        queue: *FollowActionQueue,
        allocator: std.mem.Allocator,
        kind: u8,
        source: u8,
        before: []const u8,
        after: []const u8,
    ) !void {
        const owned_before = try allocator.dupe(u8, before);
        errdefer allocator.free(owned_before);
        const owned_after = try allocator.dupe(u8, after);
        errdefer allocator.free(owned_after);
        try queue.records.append(allocator, .{
            .kind = kind,
            .source = source,
            .before = owned_before,
            .after = owned_after,
        });
    }

    /// One destructive read: once JS has accepted these lessons into the hot
    /// Follow session, the native queue no longer owns a second copy.
    pub fn drainJson(queue: *FollowActionQueue, allocator: std.mem.Allocator) ![]u8 {
        var out: std.Io.Writer.Allocating = .init(allocator);
        errdefer out.deinit();
        const writer = &out.writer;
        try writer.writeAll("{\"version\":1,\"events\":[");
        for (queue.records.items, 0..) |record, index| {
            try writer.print("{s}{{\"kind\":{d},\"source\":{d},\"before\":{s},\"after\":{s}}}", .{
                if (index == 0) "" else ",",
                record.kind,
                record.source,
                record.before,
                record.after,
            });
        }
        try writer.writeAll("]}");
        queue.clear(allocator);
        return out.toOwnedSlice();
    }
};

/// Exact selected-edge observation for Follow's second demonstrated action:
/// after deleting a strip, the user picks two exposed boundary edges and Create
/// Face bridges them. The nested face patch supplies the adjacent live context;
/// endpoints and positions make the lesson stable across later face re-keying.
pub fn followSelectedEdgesJson(allocator: std.mem.Allocator, rings_raw: u32) ?[]u8 {
    if (!ensureTopology() or g_mode != .edge) return null;
    const selected_edges = g_sel_edge orelse return null;
    const edges = g_edges orelse return null;
    const face_count = model_paint.faceCount();
    const corners = g_corner_vert orelse return null;
    if (corners.len < @as(usize, face_count) * 3) return null;

    var selected_keys = std.AutoHashMapUnmanaged(u64, void).empty;
    defer selected_keys.deinit(allocator);
    var selected_count: u32 = 0;
    var edge: u32 = 0;
    while (edge < g_edge_count and edge < selected_edges.len) : (edge += 1) {
        if (!selected_edges[edge]) continue;
        const a = edges[edge * 2];
        const b = edges[edge * 2 + 1];
        selected_keys.put(allocator, edgeKey(@min(a, b), @max(a, b)), {}) catch return null;
        selected_count += 1;
    }
    if (selected_count == 0) return null;

    var adjacent: std.ArrayListUnmanaged(u32) = .empty;
    defer adjacent.deinit(allocator);
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        const base = @as(usize, face) * 3;
        var side: usize = 0;
        while (side < 3) : (side += 1) {
            const a = corners[base + side];
            const b = corners[base + ((side + 1) % 3)];
            if (!selected_keys.contains(edgeKey(@min(a, b), @max(a, b)))) continue;
            adjacent.append(allocator, face) catch return null;
            break;
        }
    }
    const patch = if (adjacent.items.len > 0)
        followPatchJson(allocator, adjacent.items, rings_raw) orelse return null
    else
        null;
    defer if (patch) |json| allocator.free(json);

    var out: std.Io.Writer.Allocating = .init(allocator);
    defer out.deinit();
    const writer = &out.writer;
    writer.writeAll("{\"version\":1,\"selectedEdges\":[") catch return null;
    var emitted: u32 = 0;
    edge = 0;
    while (edge < g_edge_count and edge < selected_edges.len) : (edge += 1) {
        if (!selected_edges[edge]) continue;
        const a = edges[edge * 2];
        const b = edges[edge * 2 + 1];
        const pa = vertPosPub(a);
        const pb = vertPosPub(b);
        writer.print(
            "{s}{{\"id\":{d},\"vertices\":[{d},{d}],\"at\":[[{d},{d},{d}],[{d},{d},{d}]],\"boundary\":{s}}}",
            .{ if (emitted == 0) "" else ",", edge, a, b, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], if (edgeIsBoundaryPub(edge)) "true" else "false" },
        ) catch return null;
        emitted += 1;
    }
    writer.print("],\"patch\":{s}}}", .{if (patch) |json| json else "null"}) catch return null;
    return out.toOwnedSlice() catch null;
}

/// Exact, read-only topology vocabulary for an Agent Seat Follow demonstration.
///
/// A merge-faces example does not move resident triangles; it changes only their
/// authored group ids. That makes the durable demonstration much smaller than a
/// mesh snapshot: exact selected triangle ids, their welded corners, the requested
/// adjacency rings, and the selected patch frontier are enough to compare the same
/// triangles before/after the native commit and to walk into the next strip.
///
/// `requested_faces == null` reads the live face selection. Supplying ids is used
/// immediately after Merge Faces clears the UI selection, so the recorder can read
/// those same resident triangles with their newly committed group identity.
pub fn followPatchJson(allocator: std.mem.Allocator, requested_faces: ?[]const u32, rings_raw: u32) ?[]u8 {
    if (!ensureTopology()) return null;
    const face_count = model_paint.faceCount();
    if (face_count == 0) return null;
    const corners = g_corner_vert orelse return null;
    if (corners.len < @as(usize, face_count) * 3) return null;

    const selected = allocator.alloc(bool, @intCast(face_count)) catch return null;
    defer allocator.free(selected);
    @memset(selected, false);
    var selected_count: u32 = 0;
    if (requested_faces) |faces| {
        for (faces) |face| {
            if (face >= face_count or selected[face]) continue;
            selected[face] = true;
            selected_count += 1;
        }
    } else {
        if (g_mode != .face) return null;
        const live = g_sel_face orelse return null;
        var face: usize = 0;
        while (face < face_count and face < live.len) : (face += 1) {
            if (!live[face]) continue;
            selected[face] = true;
            selected_count += 1;
        }
    }
    if (selected_count == 0) return null;

    var edges = std.AutoHashMapUnmanaged(u64, FollowEdgeUse).empty;
    defer edges.deinit(allocator);
    edges.ensureTotalCapacity(allocator, face_count * 3) catch return null;
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        const base = @as(usize, face) * 3;
        var side: usize = 0;
        while (side < 3) : (side += 1) {
            const va = corners[base + side];
            const vb = corners[base + ((side + 1) % 3)];
            const a = @min(va, vb);
            const b = @max(va, vb);
            const key = edgeKey(a, b);
            const entry = edges.getOrPutAssumeCapacity(key);
            if (!entry.found_existing) {
                entry.value_ptr.* = .{ .a = a, .b = b, .first = face };
            } else if (entry.value_ptr.count == 1) {
                entry.value_ptr.second = face;
                entry.value_ptr.count = 2;
            } else {
                entry.value_ptr.count += 1;
            }
        }
    }

    const included = allocator.dupe(bool, selected) catch return null;
    defer allocator.free(included);
    const rings = @min(rings_raw, 4);
    var ring: u32 = 0;
    while (ring < rings) : (ring += 1) {
        var changed = false;
        var iterator = edges.valueIterator();
        while (iterator.next()) |edge| {
            // Never teach propagation through a non-manifold junction. The trace
            // still reports it on the frontier so the agent stops and asks for a
            // fresh seed instead of inventing connectivity.
            if (edge.count != 2) continue;
            const first_in = included[edge.first];
            const second_in = included[edge.second];
            if (first_in == second_in) continue;
            if (first_in) included[edge.second] = true else included[edge.first] = true;
            changed = true;
        }
        if (!changed) break;
    }

    const vertex_count = g_vert_count;
    const included_vertices = allocator.alloc(bool, @intCast(vertex_count)) catch return null;
    defer allocator.free(included_vertices);
    @memset(included_vertices, false);
    face = 0;
    while (face < face_count) : (face += 1) {
        if (!included[face]) continue;
        const base = @as(usize, face) * 3;
        included_vertices[corners[base]] = true;
        included_vertices[corners[base + 1]] = true;
        included_vertices[corners[base + 2]] = true;
    }

    var out: std.Io.Writer.Allocating = .init(allocator);
    defer out.deinit();
    const writer = &out.writer;
    writer.print("{{\"version\":1,\"rings\":{d},\"selectedTriangles\":[", .{rings}) catch return null;
    var emitted: usize = 0;
    face = 0;
    while (face < face_count) : (face += 1) {
        if (!selected[face]) continue;
        writer.print("{s}{d}", .{ if (emitted == 0) "" else ",", face }) catch return null;
        emitted += 1;
    }

    writer.writeAll("],\"selectedGroups\":[") catch return null;
    var seen_groups = std.AutoHashMapUnmanaged(u32, void).empty;
    defer seen_groups.deinit(allocator);
    emitted = 0;
    face = 0;
    while (face < face_count) : (face += 1) {
        if (!selected[face]) continue;
        const group = model_source.faceGroupOf(face);
        const entry = seen_groups.getOrPut(allocator, group) catch return null;
        if (entry.found_existing) continue;
        writer.print("{s}{d}", .{ if (emitted == 0) "" else ",", group }) catch return null;
        emitted += 1;
    }

    writer.writeAll("],\"vertices\":[") catch return null;
    emitted = 0;
    var vertex: u32 = 0;
    while (vertex < vertex_count) : (vertex += 1) {
        if (!included_vertices[vertex]) continue;
        const position = vertPosPub(vertex);
        writer.print("{s}{{\"id\":{d},\"at\":[{d},{d},{d}]}}", .{
            if (emitted == 0) "" else ",", vertex, position[0], position[1], position[2],
        }) catch return null;
        emitted += 1;
    }

    writer.writeAll("],\"triangles\":[") catch return null;
    emitted = 0;
    face = 0;
    while (face < face_count) : (face += 1) {
        if (!included[face]) continue;
        const base = @as(usize, face) * 3;
        const group = model_source.faceGroupOf(face);
        const semantic = model_source.faceSemanticOf(face);
        writer.print(
            "{s}{{\"id\":{d},\"selected\":{s},\"group\":{d},\"part\":{d},\"material\":{d},\"region\":{d},\"instance\":{d},\"vertices\":[{d},{d},{d}]}}",
            .{
                if (emitted == 0) "" else ",", face,                            if (selected[face]) "true" else "false",
                group,                         model_source.partIndexOf(group), model_source.faceMaterialOf(face),
                semantic.region,               semantic.instance,               corners[base],
                corners[base + 1],             corners[base + 2],
            },
        ) catch return null;
        emitted += 1;
    }

    // The frontier is the selected patch boundary, not the outer edge of the
    // returned neighborhood. It tells the next agent exactly where a demonstrated
    // strip can continue and where it must stop (outside:null or nonManifold:true).
    writer.writeAll("],\"frontier\":[") catch return null;
    var emitted_edges = std.AutoHashMapUnmanaged(u64, void).empty;
    defer emitted_edges.deinit(allocator);
    emitted = 0;
    face = 0;
    while (face < face_count) : (face += 1) {
        if (!selected[face]) continue;
        const base = @as(usize, face) * 3;
        var side: usize = 0;
        while (side < 3) : (side += 1) {
            const va = corners[base + side];
            const vb = corners[base + ((side + 1) % 3)];
            const key = edgeKey(va, vb);
            if (emitted_edges.contains(key)) continue;
            const edge = edges.get(key) orelse continue;
            const other = if (edge.count == 2)
                (if (edge.first == face) edge.second else edge.first)
            else
                std.math.maxInt(u32);
            if (edge.count == 2 and other < face_count and selected[other]) continue;
            emitted_edges.put(allocator, key, {}) catch return null;
            writer.print("{s}{{\"vertices\":[{d},{d}],\"inside\":{d},\"outside\":", .{
                if (emitted == 0) "" else ",", edge.a, edge.b, face,
            }) catch return null;
            if (edge.count == 2 and other < face_count) writer.print("{d}", .{other}) catch return null else writer.writeAll("null") catch return null;
            writer.print(",\"nonManifold\":{s}}}", .{if (edge.count > 2) "true" else "false"}) catch return null;
            emitted += 1;
        }
    }
    writer.writeAll("]}") catch return null;
    return out.toOwnedSlice() catch null;
}

/// Solidify works from the authored surface, not its render triangulation. These
/// values are deliberately centralized because both the host operation and its
/// unit regressions consume the same boundary contract.
pub const SolidifyTuning = struct {
    pub const default_thickness_m: f32 = 0.125;
    /// Damped least-squares keeps one-plane and two-plane boundary vertices stable
    /// while converging to the exact three-plane intersection at closed corners.
    pub const plane_solver_regularization: f64 = 1.0e-9;
    pub const normal_epsilon_squared: f64 = 1.0e-18;
};

/// One selected render triangle plus the authored face it came from. `group` is
/// NO_FACE_GROUP for ungrouped imports, where each render triangle is intentionally
/// treated as its own authored plane.
pub const SolidifyTriangle = struct {
    face: u32,
    group: u32,
    corners: [3]u32,
    positions: [3][3]f32,
};

/// Deep result surface for solidify: callers only ask for the already-solved inward
/// displacement of a welded vertex. Plane grouping, miter solving, and ownership stay
/// private, so the resident-mesh operation cannot accidentally reintroduce triangle
/// weighting.
pub const SolidifyOffsets = struct {
    allocator: std.mem.Allocator,
    by_vertex: std.AutoHashMapUnmanaged(u32, [3]f32) = .empty,

    pub fn deinit(self: *SolidifyOffsets) void {
        self.by_vertex.deinit(self.allocator);
        self.* = undefined;
    }

    pub fn get(self: *const SolidifyOffsets, vertex: u32) [3]f32 {
        return self.by_vertex.get(vertex) orelse .{ 0, 0, 0 };
    }
};

const SolidifyPlane = struct {
    index: u32,
    normal_sum: [3]f64 = .{ 0, 0, 0 },
};

const SolidifyPlaneSystem = struct {
    // A^T A (symmetric) and A^T 1 for n_i · displacement = -thickness.
    matrix: [3][3]f64 = .{
        .{ 0, 0, 0 },
        .{ 0, 0, 0 },
        .{ 0, 0, 0 },
    },
    normal_sum: [3]f64 = .{ 0, 0, 0 },

    fn addPlane(self: *SolidifyPlaneSystem, normal: [3]f32) void {
        const n = [3]f64{ normal[0], normal[1], normal[2] };
        inline for (0..3) |row| {
            self.normal_sum[row] += n[row];
            inline for (0..3) |column| self.matrix[row][column] += n[row] * n[column];
        }
    }

    fn solve(self: SolidifyPlaneSystem, thickness: f32) [3]f32 {
        // (A^T A + lambda I)d = -thickness A^T 1. Cholesky is stable for the
        // positive-definite damped system and naturally returns the minimum-length
        // inset at one-/two-plane boundary vertices.
        const regularization = SolidifyTuning.plane_solver_regularization;
        var a = self.matrix;
        inline for (0..3) |axis| a[axis][axis] += regularization;
        const b = [3]f64{
            -@as(f64, thickness) * self.normal_sum[0],
            -@as(f64, thickness) * self.normal_sum[1],
            -@as(f64, thickness) * self.normal_sum[2],
        };

        const l00 = @sqrt(@max(a[0][0], regularization));
        const l10 = a[1][0] / l00;
        const l20 = a[2][0] / l00;
        const l11 = @sqrt(@max(a[1][1] - l10 * l10, regularization));
        const l21 = (a[2][1] - l20 * l10) / l11;
        const l22 = @sqrt(@max(a[2][2] - l20 * l20 - l21 * l21, regularization));

        const y0 = b[0] / l00;
        const y1 = (b[1] - l10 * y0) / l11;
        const y2 = (b[2] - l20 * y0 - l21 * y1) / l22;
        const x2 = y2 / l22;
        const x1 = (y1 - l21 * x2) / l11;
        const x0 = (y0 - l10 * x1 - l20 * x2) / l00;
        return .{ @floatCast(x0), @floatCast(x1), @floatCast(x2) };
    }
};

fn solidifyPlaneKey(triangle: SolidifyTriangle) u64 {
    if (triangle.group != model_source.NO_FACE_GROUP) return triangle.group;
    // Authored ids occupy the low u32 domain. The upper namespace makes an
    // ungrouped render triangle distinct without colliding with a real group id.
    return (@as(u64, 1) << 32) | triangle.face;
}

/// Compute an even-thickness inward displacement for every welded vertex touched by
/// `triangles`. Render triangles sharing an authored face-group first collapse into ONE
/// area-weighted plane; each vertex then intersects its incident planes after all move
/// inward by `thickness`. A triangulated cube therefore becomes a smaller parallel cube,
/// independent of which diagonal split each quad happened to use.
pub fn solidifyOffsets(
    allocator: std.mem.Allocator,
    triangles: []const SolidifyTriangle,
    thickness: f32,
) !SolidifyOffsets {
    var result = SolidifyOffsets{ .allocator = allocator };
    errdefer result.deinit();
    if (triangles.len == 0 or thickness <= 0) return result;

    var planes = std.AutoHashMapUnmanaged(u64, SolidifyPlane).empty;
    defer planes.deinit(allocator);
    // Packed (welded vertex, sequential plane index), unique even when a vertex is
    // present in both render triangles of the same authored quad.
    var vertex_plane_uses = std.AutoHashMapUnmanaged(u64, void).empty;
    defer vertex_plane_uses.deinit(allocator);

    for (triangles) |triangle| {
        const ab = [3]f64{
            @as(f64, triangle.positions[1][0]) - triangle.positions[0][0],
            @as(f64, triangle.positions[1][1]) - triangle.positions[0][1],
            @as(f64, triangle.positions[1][2]) - triangle.positions[0][2],
        };
        const ac = [3]f64{
            @as(f64, triangle.positions[2][0]) - triangle.positions[0][0],
            @as(f64, triangle.positions[2][1]) - triangle.positions[0][1],
            @as(f64, triangle.positions[2][2]) - triangle.positions[0][2],
        };
        const cross = [3]f64{
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        };
        const area_squared = cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2];
        if (area_squared <= SolidifyTuning.normal_epsilon_squared) continue;

        const key = solidifyPlaneKey(triangle);
        const plane = try planes.getOrPut(allocator, key);
        if (!plane.found_existing) plane.value_ptr.* = .{ .index = @intCast(planes.count() - 1) };
        inline for (0..3) |axis| plane.value_ptr.normal_sum[axis] += cross[axis];
        for (triangle.corners) |vertex| {
            const use_key = (@as(u64, vertex) << 32) | plane.value_ptr.index;
            try vertex_plane_uses.put(allocator, use_key, {});
        }
    }

    const plane_normals = try allocator.alloc([3]f32, planes.count());
    defer allocator.free(plane_normals);
    @memset(plane_normals, .{ 0, 0, 0 });
    var plane_it = planes.valueIterator();
    while (plane_it.next()) |plane| {
        const sum = plane.normal_sum;
        const length = @sqrt(sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2]);
        if (length <= @sqrt(SolidifyTuning.normal_epsilon_squared)) continue;
        plane_normals[plane.index] = .{
            @floatCast(sum[0] / length),
            @floatCast(sum[1] / length),
            @floatCast(sum[2] / length),
        };
    }

    var systems = std.AutoHashMapUnmanaged(u32, SolidifyPlaneSystem).empty;
    defer systems.deinit(allocator);
    var use_it = vertex_plane_uses.keyIterator();
    while (use_it.next()) |use_key| {
        const vertex: u32 = @intCast(use_key.* >> 32);
        const plane_index: u32 = @truncate(use_key.*);
        if (plane_index >= plane_normals.len) continue;
        const normal = plane_normals[plane_index];
        if (normal[0] == 0 and normal[1] == 0 and normal[2] == 0) continue;
        const system = try systems.getOrPut(allocator, vertex);
        if (!system.found_existing) system.value_ptr.* = .{};
        system.value_ptr.addPlane(normal);
    }

    var system_it = systems.iterator();
    while (system_it.next()) |entry| {
        try result.by_vertex.put(allocator, entry.key_ptr.*, entry.value_ptr.solve(thickness));
    }
    return result;
}

/// Select one welded vertex by stable topology index. Popup sessions use this only
/// to restore the exact pre-preview selection after Cancel.
pub fn selectVertexByIndex(idx: u32, additive: bool) bool {
    if (!ensureTopology()) return false;
    const selected = g_sel_vert orelse return false;
    if (idx >= selected.len or !vertInScopePub(idx)) return false;
    g_mode = .vertex;
    if (!additive) @memset(selected, false);
    selected[idx] = true;
    applyFaceHighlight();
    return true;
}

/// Exactly one selected welded vertex, or null for an empty/ambiguous/out-of-scope
/// set. This is the strict selection boundary for vertex bevel.
pub fn selectedVertexIndexPub() ?u32 {
    if (!ensureTopology()) return null;
    const selected = g_sel_vert orelse return null;
    var found: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < selected.len) : (vertex += 1) {
        if (!selected[vertex]) continue;
        if (!vertInScopePub(vertex) or found != null) return null;
        found = vertex;
    }
    return found;
}

/// Copy the current in-scope welded-vertex selection into `out`. The returned
/// count is the full selection size, even when `out` is smaller, so command
/// boundaries can require exactly two vertices without allocating.
pub fn selectedVerticesPub(out: []u32) u32 {
    if (!ensureTopology()) return 0;
    const selected = g_sel_vert orelse return 0;
    var count: u32 = 0;
    var vertex: u32 = 0;
    while (vertex < selected.len) : (vertex += 1) {
        if (!selected[vertex] or !vertInScopePub(vertex)) continue;
        if (count < out.len) out[count] = vertex;
        count += 1;
    }
    return count;
}

pub fn selectedVertexPartPub() ?u32 {
    const vertex = selectedVertexIndexPub() orelse return null;
    const parts = g_vert_part orelse return null;
    return if (vertex < parts.len) parts[vertex] else null;
}

pub fn selectedEdgeCountPub() u32 {
    return countTrue(g_sel_edge);
}

/// The three boundary vertices implied by two adjacent selected edges.  Create
/// Face uses this as the triangle form of Blockbench's 3-vertex fill; previously
/// the host accepted only two disjoint edges (quad bridge) and silently refused
/// this common hole-repair gesture.
pub fn triangleFromAdjacentEdges(e0: Edge, e1: Edge, out: *[3]u32) bool {
    var shared: ?u32 = null;
    var a: ?u32 = null;
    var b: ?u32 = null;
    for (e0) |v| {
        if (v == e1[0] or v == e1[1]) {
            if (shared != null) return false;
            shared = v;
        } else a = v;
    }
    const joint = shared orelse return false;
    for (e1) |v| {
        if (v != joint) b = v;
    }
    if (a == null or b == null or a.? == b.?) return false;
    out.* = .{ a.?, joint, b.? };
    return true;
}

pub fn selectedEdgesPub(out: []Edge) u32 {
    if (!ensureTopology()) return 0;
    const sel = g_sel_edge orelse return 0;
    const edges = g_edges orelse return 0;
    var n: u32 = 0;
    var e: u32 = 0;
    while (e < sel.len and e < g_edge_count) : (e += 1) {
        if (!sel[e]) continue;
        if (n < out.len) out[n] = .{ edges[e * 2], edges[e * 2 + 1] };
        n += 1;
    }
    return n;
}
pub fn selectedEdgeIndexPub() ?u32 {
    if (!ensureTopology()) return null;
    const sel = g_sel_edge orelse return null;
    var found: ?u32 = null;
    var e: u32 = 0;
    while (e < sel.len) : (e += 1) {
        if (!sel[e]) continue;
        if (found != null) return null;
        found = e;
    }
    return found;
}
pub fn selectedEdgePartPub() ?u32 {
    const edge_idx = selectedEdgeIndexPub() orelse return null;
    const edges = g_edges orelse return null;
    const parts = g_vert_part orelse return null;
    if (@as(usize, edge_idx) * 2 + 1 >= edges.len) return null;
    const a = edges[edge_idx * 2];
    const b = edges[edge_idx * 2 + 1];
    if (a >= parts.len or b >= parts.len or parts[a] != parts[b]) return null;
    return parts[a];
}

/// One authoritative outliner-part owner for the complete selected-edge set.
/// Welded vertex ids are already keyed by part, so this preserves the identity the
/// user actually selected instead of asking a later triangle scan to infer it again
/// from coincident seam geometry. Null means no edge is selected or the selection
/// crosses part boundaries; NO_PART remains a legitimate result for an unparted mesh.
pub fn selectedEdgesCommonPartPub() ?u32 {
    if (!ensureTopology()) return null;
    const selected = g_sel_edge orelse return null;
    const edges = g_edges orelse return null;
    const parts = g_vert_part orelse return null;
    var owner: ?u32 = null;
    var edge: u32 = 0;
    while (edge < selected.len and edge < g_edge_count) : (edge += 1) {
        if (!selected[edge]) continue;
        const a = edges[edge * 2];
        const b = edges[edge * 2 + 1];
        if (a >= parts.len or b >= parts.len or parts[a] != parts[b]) return null;
        if (owner) |part| {
            if (part != parts[a]) return null;
        } else {
            owner = parts[a];
        }
    }
    return owner;
}

/// The authored surface direction beside the selected boundary edges. Create Face
/// uses this to make winding a topology-derived postcondition instead of an accident
/// of edge-table enumeration. Every selected edge must have a valid adjacent face;
/// disagreeing source normals reject rather than minting an arbitrarily flipped face.
pub fn selectedEdgesReferenceNormalPub() ?[3]f32 {
    if (!ensureTopology()) return null;
    const selected = g_sel_edge orelse return null;
    var sum: [3]f32 = .{ 0, 0, 0 };
    var count: u32 = 0;
    var edge: u32 = 0;
    while (edge < selected.len and edge < g_edge_count) : (edge += 1) {
        if (!selected[edge]) continue;
        const frame = edgeExtrusionFramePub(edge) orelse return null;
        if (count > 0 and vecDot(sum, frame.face_normal) <= 0) return null;
        sum = vecAdd(sum, frame.face_normal);
        count += 1;
    }
    if (count == 0) return null;
    const normal = vecNorm(sum);
    return if (vecDot(normal, normal) >= 0.5) normal else null;
}

/// Geometry needed to extend one selected edge without inventing a perpendicular
/// flap. The outer edge stays in the adjacent authored face's plane; the caller
/// chooses only the distance and owns the topology transaction.
pub const EdgeExtrusionFrame = struct {
    a: [3]f32,
    b: [3]f32,
    outward: [3]f32,
    face_normal: [3]f32,
    source_face: u32,

    pub fn outer(self: EdgeExtrusionFrame, distance: f32) [2][3]f32 {
        return .{
            vecAdd(self.a, vecMul(self.outward, distance)),
            vecAdd(self.b, vecMul(self.outward, distance)),
        };
    }
};

/// Solve the default edge-extrusion direction from the authored face beside the
/// edge. Using the whole face group matters: deriving it from only the incident
/// render triangle makes a triangulated quad extrude diagonally toward its hidden
/// crease. The face centroid gives a translation-invariant direction away from
/// the face interior, and projection removes any non-planar numerical residue.
///
/// At a seam shared by authored faces, the first resident face is the deterministic
/// reference, matching the editor's existing face order. Degenerate faces fail the
/// operation before the resident soup is rebuilt.
pub fn edgeExtrusionFramePub(edge_idx: u32) ?EdgeExtrusionFrame {
    if (!ensureTopology()) return null;
    const edges = g_edges orelse return null;
    const corners = g_corner_vert orelse return null;
    const positions = model_paint.positions() orelse return null;
    const face_count = model_paint.faceCount();
    if (edge_idx >= g_edge_count or
        !edgeIsBoundaryPub(edge_idx) or
        !edgeInScopePub(edge_idx) or
        positions.len < @as(usize, face_count) * 9)
    {
        return null;
    }

    const endpoint_a = edges[edge_idx * 2];
    const endpoint_b = edges[edge_idx * 2 + 1];
    var reference_face: ?u32 = null;
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        var has_a = false;
        var has_b = false;
        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const vertex = corners[face * 3 + corner];
            has_a = has_a or vertex == endpoint_a;
            has_b = has_b or vertex == endpoint_b;
        }
        if (has_a and has_b) {
            reference_face = face;
            break;
        }
    }
    const anchor = reference_face orelse return null;
    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    const reference_group = model_source.faceGroupOf(anchor);

    var other_vertices = std.AutoHashMapUnmanaged(u32, void).empty;
    defer other_vertices.deinit(alloc);
    var other_sum: [3]f32 = .{ 0, 0, 0 };
    var normal_sum: [3]f32 = .{ 0, 0, 0 };

    face = 0;
    while (face < face_count) : (face += 1) {
        const same_authored_face = if (has_groups)
            model_source.faceGroupOf(face) == reference_group
        else
            face == anchor;
        if (!same_authored_face) continue;

        const position_base = @as(usize, face) * 9;
        const p0: [3]f32 = .{ positions[position_base], positions[position_base + 1], positions[position_base + 2] };
        const p1: [3]f32 = .{ positions[position_base + 3], positions[position_base + 4], positions[position_base + 5] };
        const p2: [3]f32 = .{ positions[position_base + 6], positions[position_base + 7], positions[position_base + 8] };
        normal_sum = vecAdd(normal_sum, vecCross(vecSub(p1, p0), vecSub(p2, p0)));

        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const vertex = corners[face * 3 + corner];
            if (vertex == endpoint_a or vertex == endpoint_b) continue;
            const entry = other_vertices.getOrPut(alloc, vertex) catch return null;
            if (entry.found_existing) continue;
            other_sum = vecAdd(other_sum, vertPosPub(vertex));
        }
    }
    if (other_vertices.count() == 0) return null;

    const face_normal = vecNorm(normal_sum);
    if (vecDot(face_normal, face_normal) < 0.5) return null;
    const a = vertPosPub(endpoint_a);
    const b = vertPosPub(endpoint_b);
    const midpoint = vecMul(vecAdd(a, b), 0.5);
    const other_centroid = vecMul(other_sum, 1.0 / @as(f32, @floatFromInt(other_vertices.count())));
    const away = vecSub(midpoint, other_centroid);
    const in_plane = vecSub(away, vecMul(face_normal, vecDot(away, face_normal)));
    const outward = vecNorm(in_plane);
    if (vecDot(outward, outward) < 0.5) return null;

    return .{
        .a = a,
        .b = b,
        .outward = outward,
        .face_normal = face_normal,
        .source_face = anchor,
    };
}

fn activeSet() ?[]bool {
    return switch (g_mode) {
        .vertex => g_sel_vert,
        .edge => g_sel_edge,
        .face => g_sel_face,
        .none => null,
    };
}

pub fn mode() Mode {
    return g_mode;
}
pub fn setMode(m: Mode) void {
    if (m == g_mode) return;
    g_mode = m;
    // Leaving face mode drops the orange tint; entering it re-applies from the face set.
    applyFaceHighlight();
}

pub fn vertCount() u32 {
    return g_vert_count;
}
pub fn edgeCount() u32 {
    return g_edge_count;
}
pub fn faceCount() u32 {
    return model_paint.faceCount();
}

/// How many elements are selected in the active mode (the HUD count).
pub fn selCount() u32 {
    return switch (g_mode) {
        .vertex => countTrue(g_sel_vert),
        .edge => countTrue(g_sel_edge),
        .face => countSelectedAuthoredFaces(),
        .none => 0,
    };
}
fn countTrue(maybe: ?[]bool) u32 {
    const s = maybe orelse return 0;
    var n: u32 = 0;
    for (s) |b| {
        if (b) n += 1;
    }
    return n;
}

/// The inspector and Agent Seat consume one compact native selection snapshot instead
/// of reconstructing selection meaning from mesh-wide element tables. Exact totals are
/// always reported; detail rows are bounded so Ctrl+A on a dense import cannot allocate
/// an unbounded JSON reply on the interaction path.
pub const SelectionSnapshotTuning = struct {
    pub const max_detail_rows: u32 = 256;
};

/// JSON schema v1:
/// { mode, count, affectedVertices, selectedTriangles, truncated, pivot, bounds,
///   vertices:[{id,at,part}], edges:[{id,vertices,length,faces,open,part}],
///   triangles:[{id,group,part,material,region,instance,vertices,normal,area}] }
///
/// `count` uses the same authored-face contract as the visible selection HUD. Face
/// details remain triangle rows because group id is the exact authored-face join key;
/// consumers can group them without losing the resident triangle ids automation uses.
pub fn selectionSnapshotJson(allocator: std.mem.Allocator) ?[]u8 {
    if (g_mode != .none and !ensureTopology()) return null;

    const selected_count = selCount();
    const selected_triangles = if (g_mode == .face) countTrue(g_sel_face) else 0;
    const affected = fillAffectedVerts();
    var affected_count: u32 = 0;
    var pivot: [3]f32 = .{ 0, 0, 0 };
    var bounds_min: [3]f32 = .{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) };
    var bounds_max: [3]f32 = .{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) };
    if (affected) |mask| {
        var vertex: u32 = 0;
        while (vertex < g_vert_count and vertex < mask.len) : (vertex += 1) {
            if (!mask[vertex]) continue;
            const point = vertPosPub(vertex);
            for (0..3) |axis| {
                pivot[axis] += point[axis];
                bounds_min[axis] = @min(bounds_min[axis], point[axis]);
                bounds_max[axis] = @max(bounds_max[axis], point[axis]);
            }
            affected_count += 1;
        }
    }
    if (affected_count > 0) {
        const inverse = 1.0 / @as(f32, @floatFromInt(affected_count));
        for (0..3) |axis| pivot[axis] *= inverse;
    }

    const selected_edges = if (g_mode == .edge) countTrue(g_sel_edge) else 0;
    const truncated = affected_count > SelectionSnapshotTuning.max_detail_rows or
        selected_edges > SelectionSnapshotTuning.max_detail_rows or
        selected_triangles > SelectionSnapshotTuning.max_detail_rows;

    var out: std.Io.Writer.Allocating = .init(allocator);
    defer out.deinit();
    const writer = &out.writer;
    writer.print(
        "{{\"version\":1,\"mode\":{d},\"count\":{d},\"affectedVertices\":{d},\"selectedTriangles\":{d},\"truncated\":{s},\"pivot\":",
        .{ @intFromEnum(g_mode), selected_count, affected_count, selected_triangles, if (truncated) "true" else "false" },
    ) catch return null;
    if (affected_count == 0) {
        writer.writeAll("null,\"bounds\":null") catch return null;
    } else {
        writer.print(
            "[{d},{d},{d}],\"bounds\":[{d},{d},{d},{d},{d},{d}]",
            .{ pivot[0], pivot[1], pivot[2], bounds_min[0], bounds_min[1], bounds_min[2], bounds_max[0], bounds_max[1], bounds_max[2] },
        ) catch return null;
    }

    writer.writeAll(",\"vertices\":[") catch return null;
    var emitted: u32 = 0;
    if (affected) |mask| {
        var vertex: u32 = 0;
        while (vertex < g_vert_count and vertex < mask.len and emitted < SelectionSnapshotTuning.max_detail_rows) : (vertex += 1) {
            if (!mask[vertex]) continue;
            const point = vertPosPub(vertex);
            writer.print("{s}{{\"id\":{d},\"at\":[{d},{d},{d}],\"part\":", .{
                if (emitted == 0) "" else ",", vertex, point[0], point[1], point[2],
            }) catch return null;
            const part = vertPartPub(vertex) orelse model_source.NO_PART;
            if (part == model_source.NO_PART) writer.writeAll("null") catch return null else writer.print("{d}", .{part}) catch return null;
            writer.writeAll("}") catch return null;
            emitted += 1;
        }
    }

    writer.writeAll("],\"edges\":[") catch return null;
    emitted = 0;
    if (g_mode == .edge) {
        const selected = g_sel_edge orelse return null;
        var edge: u32 = 0;
        while (edge < selected.len and edge < g_edge_count and emitted < SelectionSnapshotTuning.max_detail_rows) : (edge += 1) {
            if (!selected[edge]) continue;
            const endpoints = edgeEndpointsPub(edge);
            const a = vertPosPub(endpoints[0]);
            const b = vertPosPub(endpoints[1]);
            const delta = vecSub(b, a);
            const length = @sqrt(vecDot(delta, delta));
            const incidence = edgeFaceIncidencePub(edge);
            const open = incidence == 1 and !edgeIsWirePub(edge);
            writer.print(
                "{s}{{\"id\":{d},\"vertices\":[{d},{d}],\"length\":{d},\"faces\":{d},\"open\":{s},\"part\":",
                .{ if (emitted == 0) "" else ",", edge, endpoints[0], endpoints[1], length, incidence, if (open) "true" else "false" },
            ) catch return null;
            const part_a = vertPartPub(endpoints[0]) orelse model_source.NO_PART;
            const part_b = vertPartPub(endpoints[1]) orelse model_source.NO_PART;
            if (part_a == model_source.NO_PART or part_a != part_b) writer.writeAll("null") catch return null else writer.print("{d}", .{part_a}) catch return null;
            writer.writeAll("}") catch return null;
            emitted += 1;
        }
    }

    writer.writeAll("],\"triangles\":[") catch return null;
    emitted = 0;
    if (g_mode == .face) {
        const selected = g_sel_face orelse return null;
        const corners = g_corner_vert orelse return null;
        var face: u32 = 0;
        while (face < selected.len and emitted < SelectionSnapshotTuning.max_detail_rows) : (face += 1) {
            if (!selected[face]) continue;
            const base = @as(usize, face) * 3;
            const vertices = [3]u32{ corners[base], corners[base + 1], corners[base + 2] };
            const a = vertPosPub(vertices[0]);
            const b = vertPosPub(vertices[1]);
            const c = vertPosPub(vertices[2]);
            const cross = vecCross(vecSub(b, a), vecSub(c, a));
            const cross_length = @sqrt(vecDot(cross, cross));
            const normal = if (cross_length > 0.00000001) vecMul(cross, 1.0 / cross_length) else [3]f32{ 0, 0, 0 };
            const area = cross_length * 0.5;
            const group = model_source.faceGroupOf(face);
            const part = model_source.partIndexOf(group);
            const material = model_source.faceMaterialOf(face);
            const semantic = model_source.faceSemanticOf(face);
            writer.print("{s}{{\"id\":{d},\"group\":", .{ if (emitted == 0) "" else ",", face }) catch return null;
            if (group == model_source.NO_FACE_GROUP) writer.writeAll("null") catch return null else writer.print("{d}", .{group}) catch return null;
            writer.writeAll(",\"part\":") catch return null;
            if (part == model_source.NO_PART) writer.writeAll("null") catch return null else writer.print("{d}", .{part}) catch return null;
            writer.writeAll(",\"material\":") catch return null;
            if (material == model_source.NO_FACE_MATERIAL) writer.writeAll("null") catch return null else writer.print("{d}", .{material}) catch return null;
            writer.writeAll(",\"region\":") catch return null;
            if (semantic.region == model_source.NO_SEMANTIC_ID) writer.writeAll("null") catch return null else writer.print("{d}", .{semantic.region}) catch return null;
            writer.writeAll(",\"instance\":") catch return null;
            if (semantic.instance == model_source.NO_SEMANTIC_ID) writer.writeAll("null") catch return null else writer.print("{d}", .{semantic.instance}) catch return null;
            writer.print(
                ",\"vertices\":[{d},{d},{d}],\"normal\":[{d},{d},{d}],\"area\":{d}}}",
                .{ vertices[0], vertices[1], vertices[2], normal[0], normal[1], normal[2], area },
            ) catch return null;
            emitted += 1;
        }
    }
    writer.writeAll("]}") catch return null;
    return out.toOwnedSlice() catch null;
}

/// Face-mode count in AUTHORED faces (a picked cube face reads as 1, not its 2 triangles):
/// grouped triangles count once per group; ungrouped triangles count individually.
fn countSelectedAuthoredFaces() u32 {
    const s = g_sel_face orelse return 0;
    var groups = std.AutoHashMapUnmanaged(u32, void).empty;
    defer groups.deinit(alloc);
    var n: u32 = 0;
    for (s, 0..) |b, f| {
        if (!b) continue;
        const grp = model_source.faceGroupOf(@intCast(f));
        if (grp == model_source.NO_FACE_GROUP) {
            n += 1;
        } else if (!groups.contains(grp)) {
            groups.put(alloc, grp, {}) catch {};
            n += 1;
        }
    }
    return n;
}

/// Re-read unique-vert positions from the displayed soup — for host-side restores that
/// bypass the mutation path (the unsafe-edit guard's Revert, req_2539). The weld map is
/// position-independent once built, so topology, selection, and scope all stay valid;
/// only the positions refresh. Without this the overlay dots/edges and the gizmo pivot
/// keep drawing the pre-revert positions while the shaded mesh shows the restore.
pub fn refreshPositionsFromSoup() void {
    const verts = g_verts orelse return;
    const corners = g_corner_vert orelse return;
    const pos = model_paint.positions() orelse return;
    const n = @min(corners.len, pos.len / 3);
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const dst = @as(usize, corners[i]) * 3;
        if (dst + 2 >= verts.len) continue;
        verts[dst + 0] = pos[i * 3 + 0];
        verts[dst + 1] = pos[i * 3 + 1];
        verts[dst + 2] = pos[i * 3 + 2];
    }
}

/// Drop topology + selection — call on model load / quality change (topology changed).
pub fn reset() void {
    restoreAllFaces();
    g_face_base.deinit(alloc);
    g_face_base = .{};
    if (g_verts) |v| alloc.free(v);
    if (g_vert_part) |p| alloc.free(p);
    if (g_corner_vert) |c| alloc.free(c);
    if (g_edges) |e| alloc.free(e);
    if (g_edge_boundary) |b| alloc.free(b);
    if (g_edge_incidence) |i| alloc.free(i);
    if (g_edge_wire) |w| alloc.free(w);
    if (g_scope_vert) |s| alloc.free(s);
    if (g_scope_edge) |s| alloc.free(s);
    if (g_camera_visible_vert) |s| alloc.free(s);
    if (g_camera_visible_edge) |s| alloc.free(s);
    if (g_affect_vert) |s| alloc.free(s);
    if (g_sel_vert) |s| alloc.free(s);
    if (g_sel_edge) |s| alloc.free(s);
    if (g_sel_face) |s| alloc.free(s);
    if (g_snap) |s| alloc.free(s);
    if (g_mirror_twin) |t| alloc.free(t);
    if (g_mirror_affect) |m| alloc.free(m);
    g_mirror_twin = null;
    g_mirror_affect = null;
    g_mirror_built_for = 0; // mask itself survives — it's a user mode, retwinned on next use
    g_snap = null;
    g_verts = null;
    g_vert_part = null;
    g_corner_vert = null;
    g_edges = null;
    g_edge_boundary = null;
    g_edge_incidence = null;
    g_edge_wire = null;
    g_scope_vert = null;
    g_scope_edge = null;
    g_camera_visible_vert = null;
    g_camera_visible_edge = null;
    g_scope_built = 0;
    g_affect_vert = null;
    g_sel_vert = null;
    g_sel_edge = null;
    g_sel_face = null;
    g_vert_count = 0;
    g_edge_count = 0;
    g_built_for = 0;
}

/// A fresh resident model is a new scope domain. Topology-only resets deliberately
/// preserve the focused outliner range across edits, but carrying that range into the
/// next document can expose just a prefix of its authored faces (for example [0,2)
/// turns a 12-sided cylinder into the seven-edge outline of two quads). Keep the
/// selection tool/mirror mode, but return edit scope to honest whole-model until the
/// new document's outliner focuses one of its own ranges.
pub fn resetForModelLoad() void {
    reset();
    g_scope_active = false;
    g_scope_count = 0;
}

/// Authored face groups are topology, not presentation metadata: they decide whether
/// a shared triangle edge is a real face boundary or an internal triangulation seam.
/// Group-only mutations keep the triangle count unchanged, so the normal face-count
/// cache key cannot notice them. Call this after such a mutation so the next overlay,
/// pick, or edit rebuilds the boundary classification from the new authored faces.
pub fn faceGroupsChanged() void {
    reset();
}

/// Headless fixture door for the focused unit target. It is absent from production
/// builds; tests still exercise this module's real model_source/model_paint instances.
pub const test_support = if (builtin.is_test) struct {
    pub fn loadGroupedSoup(key: u64, verts: []f32, count: u32, groups: []const u32) void {
        clear();
        model_source.setFaceGroups(groups);
        model_paint.setTarget(key, verts, count);
    }

    pub fn regroup(groups: []const u32) void {
        model_source.setFaceGroups(groups);
        faceGroupsChanged();
    }

    pub fn setPartRanges(ranges: []const u32) void {
        model_source.setPartRanges(ranges);
        reset();
    }

    pub fn replaceGroupedSoupSameFaceCount(key: u64, verts: []const f32, count: u32, groups: []const u32) bool {
        model_source.setFaceGroups(groups);
        return model_paint.setTargetPreservingAtlas(key, verts, count, groups);
    }

    pub fn clear() void {
        resetForModelLoad();
        model_paint.clear();
        model_source.clear();
    }
} else struct {};

// ── Edit scope (focus one part, or a multi-selected set of parts) ─────────────────
fn editScopeMatches(ranges: []const [2]u32) bool {
    if (!g_scope_active) return ranges.len == 0;
    if (g_scope_count != ranges.len) return false;
    for (ranges, 0..) |range, index| {
        if (g_scope_ranges[index][0] != range[0] or g_scope_ranges[index][1] != range[1]) return false;
    }
    return true;
}

/// Restrict editing to the authored group range [lo, hi). hi <= lo clears the scope (edit
/// the whole model). The outliner sets this to the focused part's range.
pub fn setEditScope(lo: u32, hi: u32) void {
    if (hi > lo) {
        const next = [1][2]u32{.{ lo, hi }};
        if (editScopeMatches(next[0..])) return;
        g_scope_active = true;
        g_scope_ranges[0] = .{ lo, hi };
        g_scope_count = 1;
    } else {
        if (editScopeMatches(&.{})) return;
        g_scope_active = false;
        g_scope_count = 0;
    }
    g_scope_built = 0;
    // Scope is an edit-ownership boundary, not a visual filter. A focused part must
    // never inherit a vertex/edge/face selection from the previously focused part.
    clearSelection();
}

/// Restrict editing to the UNION of several group ranges — flattened [lo,hi) pairs, the
/// outliner's shift-accumulated multi-select (req_2659). Degenerate pairs (hi <= lo) are
/// skipped; zero valid pairs clears the scope. Beyond MAX_SCOPE_RANGES the excess is
/// dropped LOUDLY (never silently mis-scoped).
pub fn setEditScopeRanges(pairs: []const u32) void {
    var next: [MAX_SCOPE_RANGES][2]u32 = undefined;
    var next_count: usize = 0;
    var i: usize = 0;
    while (i + 1 < pairs.len) : (i += 2) {
        if (pairs[i + 1] <= pairs[i]) continue;
        if (next_count >= MAX_SCOPE_RANGES) {
            std.debug.print("[mesh_edit] scope ranges TRUNCATED at {d} — {d} pairs requested\n", .{ MAX_SCOPE_RANGES, pairs.len / 2 });
            break;
        }
        next[next_count] = .{ pairs[i], pairs[i + 1] };
        next_count += 1;
    }
    if (editScopeMatches(next[0..next_count])) return;
    @memcpy(g_scope_ranges[0..next_count], next[0..next_count]);
    g_scope_count = next_count;
    g_scope_active = g_scope_count > 0;
    g_scope_built = 0;
    clearSelection();
}

/// Part-range ids are compact authored metadata, so topology edits can widen or
/// renumber them while preserving the same outliner-part identity. Rebase the
/// active scope by part rank before the topology cache rebuilds; otherwise a newly
/// appended face can immediately fall outside the stale pre-op range and its own
/// transaction rejects the result. This only updates the ownership boundary. The
/// caller decides whether selection/topology must be rebuilt.
pub fn rebaseEditScopePartRanges(old_pairs: []const u32, new_pairs: []const u32) bool {
    if (!g_scope_active or old_pairs.len != new_pairs.len or old_pairs.len % 2 != 0) return false;
    var changed = false;
    for (g_scope_ranges[0..g_scope_count]) |*scope| {
        var pair: usize = 0;
        while (pair + 1 < old_pairs.len) : (pair += 2) {
            if (scope[0] != old_pairs[pair] or scope[1] != old_pairs[pair + 1]) continue;
            const next_lo = new_pairs[pair];
            const next_hi = new_pairs[pair + 1];
            if (scope[0] != next_lo or scope[1] != next_hi) {
                scope.* = .{ next_lo, next_hi };
                changed = true;
            }
            break;
        }
    }
    if (changed) g_scope_built = 0;
    return changed;
}

/// Read-only flattened [lo,hi) scope ranges for diagnostics. Empty means the whole
/// model. Returns the number of u32 values copied (always an even number).
pub fn scopeRangesPub(out: []u32) usize {
    if (!g_scope_active) return 0;
    const pair_count = @min(g_scope_count, out.len / 2);
    for (g_scope_ranges[0..pair_count], 0..) |range, index| {
        out[index * 2] = range[0];
        out[index * 2 + 1] = range[1];
    }
    return pair_count * 2;
}

fn faceInScope(f: u32) bool {
    if (!g_scope_active) return true;
    const g = model_source.faceGroupOf(f);
    if (g == model_source.NO_FACE_GROUP) return false;
    for (g_scope_ranges[0..g_scope_count]) |r| {
        if (g >= r[0] and g < r[1]) return true;
    }
    return false;
}
pub fn faceInScopePub(f: u32) bool {
    return faceInScope(f);
}

/// Apply the active outliner scope to a DISPLAYED-face raycast result.  Paint and
/// edit picking share the same part boundary: a hit on another part is a miss,
/// never permission to mutate that part (or to paint through it onto geometry
/// behind it).  Keeping this policy here prevents the fill/brush/sample entry
/// points from quietly drifting apart again.
pub fn scopedFaceHit(face: i32) i32 {
    if (face < 0) return -1;
    return if (faceInScope(@intCast(face))) face else -1;
}

/// Build the per-vert / per-edge scope masks for the active scope (lazy; keyed on
/// facecount+ranges). A vert is in scope if any in-scope face touches it; an edge if both
/// endpoints are. No-op when the scope is inactive or the topology isn't welded yet.
fn ensureScopeMasks() void {
    if (!g_scope_active or g_verts == null) return;
    var sig: u64 = @as(u64, model_paint.faceCount()) << 32;
    for (g_scope_ranges[0..g_scope_count]) |r| {
        sig ^= (@as(u64, r[0]) << 12) ^ @as(u64, r[1]);
        sig = sig *% 0x9e3779b97f4a7c15 +% 1; // order-sensitive mix so [a,b],[c,d] ≠ [c,d],[a,b]
    }
    if (g_scope_built == sig and g_scope_vert != null) return;
    if (g_scope_vert) |m| alloc.free(m);
    if (g_scope_edge) |m| alloc.free(m);
    g_scope_vert = alloc.alloc(bool, g_vert_count) catch return;
    g_scope_edge = alloc.alloc(bool, g_edge_count) catch return;
    @memset(g_scope_vert.?, false);
    @memset(g_scope_edge.?, false);
    const corners = g_corner_vert orelse return;
    const fc = model_paint.faceCount();
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        if (!faceInScope(f)) continue;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const v = corners[f * 3 + k];
            if (v < g_vert_count) g_scope_vert.?[v] = true;
        }
    }
    const edges = g_edges orelse return;
    var e: u32 = 0;
    while (e < g_edge_count) : (e += 1) {
        const a = edges[e * 2];
        const b = edges[e * 2 + 1];
        g_scope_edge.?[e] = a < g_vert_count and b < g_vert_count and g_scope_vert.?[a] and g_scope_vert.?[b];
    }
    g_scope_built = sig;
}
pub fn vertInScopePub(v: u32) bool {
    if (!g_scope_active) return true;
    ensureScopeMasks();
    const m = g_scope_vert orelse return true;
    return v < m.len and m[v];
}
pub fn edgeInScopePub(e: u32) bool {
    if (!g_scope_active) return true;
    ensureScopeMasks();
    const m = g_scope_edge orelse return true;
    return e < m.len and m[e];
}

pub fn clearSelection() void {
    restoreAllFaces();
    if (g_sel_vert) |s| @memset(s, false);
    if (g_sel_edge) |s| @memset(s, false);
    if (g_sel_face) |s| @memset(s, false);
}

/// Snapshot the active mode's selection before an instant (mousedown) pick.
pub fn snapshotSelection() void {
    const set = activeSet() orelse {
        if (g_snap) |s| alloc.free(s);
        g_snap = null;
        return;
    };
    if (g_snap) |s| {
        if (s.len != set.len) {
            alloc.free(s);
            g_snap = null;
        }
    }
    if (g_snap == null) g_snap = alloc.alloc(bool, set.len) catch return;
    @memcpy(g_snap.?, set);
    g_snap_mode = g_mode;
}

/// Restore the snapshot — the press became an orbit-drag, so undo its pick.
pub fn revertSelection() void {
    const snap = g_snap orelse return;
    if (g_snap_mode != g_mode) return;
    const set = activeSet() orelse return;
    if (set.len != snap.len) return;
    @memcpy(set, snap);
    if (g_mode == .face) applyFaceHighlight();
}

/// Select a face by index (no raycast) — programmatic selection (select-all, scripting)
/// and the headless highlight proof. Switches to face mode so the tint shows. Returns false
/// if there's no mesh or the index is out of range.
pub fn selectFaceByIndex(idx: u32, additive: bool) bool {
    if (!ensureFaceSel()) return false;
    g_mode = .face;
    const sel = g_sel_face orelse return false;
    if (idx >= sel.len) return false;
    if (!additive) {
        @memset(sel, false);
        restoreAllFaces();
    }
    setFaceGroup(sel, idx, true);
    applyFaceHighlight();
    return true;
}

/// Restore a face selection from a displayed-triangle mask in one highlight pass.
/// Grouped triangles expand back to their whole authored face, matching a normal pick.
/// Topology ops use this after reinstalling an unchanged face order so the user's
/// selected face(s) remain ready for another operation.
pub fn selectFacesByTriangleMask(mask: []const bool) u32 {
    if (!ensureFaceSel()) return 0;
    const sel = g_sel_face orelse return 0;
    if (mask.len < sel.len) return 0;
    g_mode = .face;
    restoreAllFaces();
    @memset(sel, false);
    var face: usize = 0;
    while (face < sel.len) : (face += 1) {
        if (mask[face]) setFaceGroup(sel, @intCast(face), true);
    }
    applyFaceHighlight();
    return selCount();
}

const SurfaceDirection = struct {
    axis: u8,
    sign: i8,
};

pub const UV_ORIENTATION_TUNING = struct {
    /// Reject triangles/islands too degenerate to supply a stable surface direction.
    pub const minimum_area_vector_length_sq: f32 = 0.000000000001;
};

fn dominantSurfaceDirection(area_vector: [3]f32) ?SurfaceDirection {
    const magnitude_sq = vecDot(area_vector, area_vector);
    if (!std.math.isFinite(magnitude_sq) or magnitude_sq <= UV_ORIENTATION_TUNING.minimum_area_vector_length_sq) return null;
    const absolute = [3]f32{ @abs(area_vector[0]), @abs(area_vector[1]), @abs(area_vector[2]) };
    const axis: u8 = if (absolute[0] >= absolute[1] and absolute[0] >= absolute[2])
        0
    else if (absolute[1] >= absolute[2])
        1
    else
        2;
    return .{ .axis = axis, .sign = if (area_vector[axis] < 0) -1 else 1 };
}

/// Expand the current authored-face selection to every UV island whose mesh surface
/// has the same dominant direction. Direction is derived from current 3D geometry,
/// not UV projection metadata: intrinsic generated charts and historical saved UVs
/// therefore share one correct ±X/±Y/±Z selection contract.
///
/// The first selected displayed triangle supplies the direction. A normal click
/// selects one authored face, so this remains deterministic while still accepting
/// selections made from either the 3D mesh or the UV panel. The active Outliner
/// scope remains an ownership boundary, and opposite-facing islands never match.
pub fn selectSameUvOrientation() u32 {
    if (g_mode != .face or !ensureFaceSel()) return 0;
    const selected = g_sel_face orelse return 0;
    const islands = model_paint.layoutIslands() orelse return 0;
    const positions = model_paint.positions() orelse return 0;
    const face_count = model_paint.faceCount();
    if (positions.len < @as(usize, face_count) * 9) return 0;

    const area_vectors = alloc.alloc([3]f32, islands.len) catch return 0;
    defer alloc.free(area_vectors);
    @memset(area_vectors, .{ 0, 0, 0 });
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        const island_index = model_paint.islandIndexForFace(face) orelse continue;
        if (island_index >= area_vectors.len) continue;
        const base = @as(usize, face) * 9;
        const a = [3]f32{ positions[base + 0], positions[base + 1], positions[base + 2] };
        const b = [3]f32{ positions[base + 3], positions[base + 4], positions[base + 5] };
        const c = [3]f32{ positions[base + 6], positions[base + 7], positions[base + 8] };
        const cross = vecCross(vecSub(b, a), vecSub(c, a));
        area_vectors[island_index] = vecAdd(area_vectors[island_index], cross);
    }

    var seed_island: ?u32 = null;
    face = 0;
    while (face < face_count and face < selected.len) : (face += 1) {
        if (!selected[face]) continue;
        const island_index = model_paint.islandIndexForFace(face) orelse continue;
        if (island_index >= islands.len) continue;
        seed_island = island_index;
        break;
    }
    const seed = dominantSurfaceDirection(area_vectors[seed_island orelse return 0]) orelse return 0;

    @memset(selected, false);
    face = 0;
    while (face < face_count and face < selected.len) : (face += 1) {
        if (!faceInScope(face)) continue;
        const island_index = model_paint.islandIndexForFace(face) orelse continue;
        if (island_index >= islands.len) continue;
        const direction = dominantSurfaceDirection(area_vectors[island_index]) orelse continue;
        selected[face] = direction.axis == seed.axis and direction.sign == seed.sign;
    }
    applyFaceHighlight();
    return selCount();
}

/// Select (face mode) every displayed face whose authored group id is in [lo, hi). The
/// outliner grabs a whole PART this way — each part occupies a contiguous group range in the
/// composed mesh. Returns the selected face count, or -1 if there's no mesh.
pub fn selectFacesByGroupRange(lo: u32, hi: u32, additive: bool) i32 {
    if (!ensureFaceSel()) return -1;
    g_mode = .face;
    const sel = g_sel_face orelse return -1;
    if (!additive) {
        @memset(sel, false);
        restoreAllFaces();
    }
    var f: u32 = 0;
    const fc: u32 = @intCast(sel.len);
    while (f < fc) : (f += 1) {
        const grp = model_source.faceGroupOf(f);
        if (grp != model_source.NO_FACE_GROUP and grp >= lo and grp < hi) sel[f] = true;
    }
    applyFaceHighlight();
    return @intCast(selCount());
}

/// Complete a Create Face operation by focusing exactly the appended authored face.
/// Grouped meshes select the whole new group (both triangles of a bridged quad read as
/// one face); ungrouped imports select every appended triangle. This is the native
/// postcondition that makes the next X key flip the result without another pick.
pub fn focusCreatedFace(first_triangle: u32, triangle_count: u32) u32 {
    const face_count = model_paint.faceCount();
    if (triangle_count == 0 or first_triangle >= face_count) return 0;
    const group = model_source.faceGroupOf(first_triangle);
    if (group != model_source.NO_FACE_GROUP) {
        const selected = selectFacesByGroupRange(group, group + 1, false);
        return if (selected > 0) @intCast(selected) else 0;
    }

    const end = @min(face_count, first_triangle +| triangle_count);
    var face = first_triangle;
    while (face < end) : (face += 1) {
        if (!selectFaceByIndex(face, face != first_triangle)) break;
    }
    return selCount();
}

/// Ctrl+A for the mesh editor: select every element of the current mode that's in the active
/// edit scope (whole model when no part is focused). Returns the selected count, -1 if no mesh
/// or no mode. Edges select only boundary edges (diagonals aren't real edges).
pub fn selectAll() i32 {
    if (g_mode == .none) return -1;
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;
    switch (g_mode) {
        .vertex => {
            const sel = g_sel_vert orelse return -1;
            const n: u32 = @intCast(sel.len);
            var i: u32 = 0;
            while (i < n) : (i += 1) sel[i] = vertInScopePub(i);
        },
        .edge => {
            const sel = g_sel_edge orelse return -1;
            const n: u32 = @intCast(sel.len);
            var e: u32 = 0;
            while (e < n) : (e += 1) sel[e] = edgeIsBoundaryPub(e) and edgeInScopePub(e);
        },
        .face => {
            const sel = g_sel_face orelse return -1;
            const n: u32 = @intCast(sel.len);
            var f: u32 = 0;
            while (f < n) : (f += 1) sel[f] = faceInScopePub(f);
            applyFaceHighlight();
        },
        .none => return -1,
    }
    return @intCast(selCount());
}

/// Fill `out` (one bool per displayed triangle) with which triangles the current selection
/// deletes — exactly what's selected, nothing more: face mode drops selected faces; vertex
/// mode drops any face touching a selected vertex; edge mode drops any face using a selected
/// edge. Returns the count to delete. `out.len` must be >= facecount.
pub fn buildDeleteMask(out: []bool) u32 {
    const fc = model_paint.faceCount();
    if (out.len < fc) return 0;
    @memset(out[0..fc], false);
    switch (g_mode) {
        .face => {
            const sel = g_sel_face orelse return 0;
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                if (f < sel.len and sel[f]) out[f] = true;
            }
        },
        .vertex => {
            if (!ensureTopology()) return 0;
            const sel = g_sel_vert orelse return 0;
            const corners = g_corner_vert orelse return 0;
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                var k: u32 = 0;
                while (k < 3) : (k += 1) {
                    const v = corners[f * 3 + k];
                    if (v < sel.len and sel[v]) {
                        out[f] = true;
                        break;
                    }
                }
            }
        },
        .edge => {
            if (!ensureTopology()) return 0;
            const sel = g_sel_edge orelse return 0;
            const edges = g_edges orelse return 0;
            const corners = g_corner_vert orelse return 0;
            var eset = std.AutoHashMapUnmanaged(u64, void).empty;
            defer eset.deinit(alloc);
            var e: u32 = 0;
            while (e < g_edge_count) : (e += 1) {
                if (e < sel.len and sel[e]) eset.put(alloc, edgeKey(edges[e * 2], edges[e * 2 + 1]), {}) catch {};
            }
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                const a = corners[f * 3 + 0];
                const b = corners[f * 3 + 1];
                const cc = corners[f * 3 + 2];
                if (eset.contains(edgeKey(a, b)) or eset.contains(edgeKey(b, cc)) or eset.contains(edgeKey(cc, a))) out[f] = true;
            }
        },
        .none => {},
    }
    var count: u32 = 0;
    var i: u32 = 0;
    while (i < fc) : (i += 1) {
        if (out[i]) count += 1;
    }
    return count;
}

/// Select an edge by welded-edge index (no raycast) — used by toolbar/headless flows that
/// need a deterministic edge set for topology operations.
pub fn selectEdgeByIndex(idx: u32, additive: bool) bool {
    if (!ensureTopology()) return false;
    const sel = g_sel_edge orelse return false;
    // Raw welded triangle edges include quad/n-gon fan diagonals. They are not
    // authored edges and every interactive picker already rejects them; keep the
    // deterministic/headless door on that same strict boundary.
    if (idx >= sel.len or !edgeIsBoundaryPub(idx) or !edgeInScopePub(idx)) return false;
    g_mode = .edge;
    if (!additive) @memset(sel, false);
    sel[idx] = true;
    applyFaceHighlight(); // leaving face mode removes any face tint
    return true;
}

// An extrusion rebuilds the resident soup before it can hand its new outer edge
// back to the editor.  The rebuilt positions can differ by a few float ULPs, so
// selection uses this deliberately small squared endpoint tolerance rather than
// requiring byte-identical coordinates.
const EXTRUSION_EDGE_FOCUS_ENDPOINT_DISTANCE_SQ: f32 = 1e-6;

fn pointDistanceSq(a: [3]f32, b: [3]f32) f32 {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
}

/// Replace the active edge selection with the boundary edge at these endpoints.
/// Topology operations use this to keep their newly created outer edge ready for
/// the next operation without a second click.
pub fn focusEdgeByEndpoints(p: [3]f32, q: [3]f32) bool {
    if (!ensureTopology()) return false;
    var closest: ?u32 = null;
    var closest_error = std.math.inf(f32);
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!edgeIsBoundaryPub(edge) or !edgeInScopePub(edge)) continue;
        const endpoints = edgeEndpointsPub(edge);
        const a = vertPosPub(endpoints[0]);
        const b = vertPosPub(endpoints[1]);
        const direct = pointDistanceSq(a, p) + pointDistanceSq(b, q);
        const reversed = pointDistanceSq(a, q) + pointDistanceSq(b, p);
        const distance_error = @min(direct, reversed);
        if (distance_error <= EXTRUSION_EDGE_FOCUS_ENDPOINT_DISTANCE_SQ and distance_error < closest_error) {
            closest = edge;
            closest_error = distance_error;
        }
    }
    return if (closest) |focused_edge| selectEdgeByIndex(focused_edge, false) else false;
}

// ── Topology ─────────────────────────────────────────────────────────────────────
/// Face mode needs ONLY a per-face selection bit array — never the welded vertex/edge
/// topology. Building the weld on the first face click is wasted work that made selection
/// feel laggy; this is the cheap path (a memset, no hashing). The raycast itself uses
/// model_paint's CPU positions directly, so face picking costs exactly what paint costs.
fn ensureFaceSel() bool {
    const fc = model_paint.faceCount();
    if (fc == 0) return false;
    if (g_sel_face) |s| {
        if (s.len == fc) return true; // already sized (from here or a prior weld)
    }
    reset(); // facecount changed / first use → everything stale
    g_sel_face = alloc.alloc(bool, fc) catch return false;
    @memset(g_sel_face.?, false);
    return true;
}

/// EXACT weld key: the position quantised to WELD_Q, kept as a 3-int tuple. It MUST be
/// exact (not a hash packed into one integer) — a lossy pack collides for symmetric meshes.
/// A perfect cube's 8 corners are all (±q,±q,±q), and the old `x*C1 ^ y*C2 ^ z*C3` pack
/// XORed those sign-flips down to just 2 distinct values, welding 8 corners into 2 verts
/// (irregular meshes like a scanned GLB never hit the collision, which hid the bug). Keying
/// the AutoHashMap on the [3]i32 itself compares by value, so distinct positions never merge.
fn weldKey(p: [3]f32) [3]i32 {
    return .{
        @round(p[0] * WELD_Q),
        @round(p[1] * WELD_Q),
        @round(p[2] * WELD_Q),
    };
}

/// Weld identity: quantised position PLUS the outliner part the face belongs to. Two
/// stacked cubes are two PARTS — their coincident corners must stay separate logical
/// verts or the gizmo writeback drags both cubes at once (edits "bleed"). Faces within
/// one part (a cube's 6 authored faces) still share the position key and weld normally.
/// With no part ranges set, every face is NO_PART and this degrades to position-only.
const WeldKey = struct { pos: [3]i32, part: u32 };

/// Build (or rebuild) the welded topology from model_paint's CPU triangle positions.
/// Returns false if there's no resident mesh. Idempotent for a given facecount.
fn ensureTopology() bool {
    const fc = model_paint.faceCount();
    if (fc == 0) return false;
    if (g_built_for == fc and g_verts != null) return true;

    var old_face_sel: ?[]bool = null;
    if (g_sel_face) |s| {
        if (s.len == fc) old_face_sel = alloc.dupe(bool, s) catch null;
    }
    defer if (old_face_sel) |s| alloc.free(s);

    reset();

    const pos = model_paint.positions() orelse return false;
    if (pos.len < @as(usize, fc) * 9) return false;

    var weld = std.AutoHashMapUnmanaged(WeldKey, u32).empty;
    defer weld.deinit(alloc);
    var verts = std.ArrayListUnmanaged(f32).empty;
    var vert_parts = std.ArrayListUnmanaged(u32).empty;
    var corner_vert = alloc.alloc(u32, @as(usize, fc) * 3) catch return false;

    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const part = model_source.partIndexOf(model_source.faceGroupOf(f));
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const base = f * 9 + k * 3;
            const p: [3]f32 = .{ pos[base + 0], pos[base + 1], pos[base + 2] };
            const key = WeldKey{ .pos = weldKey(p), .part = part };
            const gop = weld.getOrPut(alloc, key) catch return false;
            if (!gop.found_existing) {
                gop.value_ptr.* = @intCast(verts.items.len / 3);
                verts.append(alloc, p[0]) catch return false;
                verts.append(alloc, p[1]) catch return false;
                verts.append(alloc, p[2]) catch return false;
                vert_parts.append(alloc, part) catch return false;
            }
            corner_vert[f * 3 + k] = gop.value_ptr.*;
        }
    }

    // Unique undirected edges from the three corners of every face. emap maps an edge
    // key → its index in `edges`, so the boundary pass below can find an edge from a
    // face's corner pair.
    var emap = std.AutoHashMapUnmanaged(u64, u32).empty;
    defer emap.deinit(alloc);
    var edges = std.ArrayListUnmanaged(u32).empty;
    f = 0;
    while (f < fc) : (f += 1) {
        const a = corner_vert[f * 3 + 0];
        const b = corner_vert[f * 3 + 1];
        const c = corner_vert[f * 3 + 2];
        addEdge(&emap, &edges, a, b);
        addEdge(&emap, &edges, b, c);
        addEdge(&emap, &edges, c, a);
    }

    g_verts = verts.toOwnedSlice(alloc) catch return false;
    g_vert_part = vert_parts.toOwnedSlice(alloc) catch return false;
    g_corner_vert = corner_vert;
    g_edges = edges.toOwnedSlice(alloc) catch return false;
    g_vert_count = @intCast(g_verts.?.len / 3);
    g_edge_count = @intCast(g_edges.?.len / 2);
    g_built_for = fc;
    g_mirror_built_for = 0; // fresh weld = fresh vertex identities; retwin on next mirror use

    // Classify each edge as boundary vs internal (a triangulation diagonal). An internal
    // edge is shared by exactly two faces of the SAME authored group; everything else is a
    // real edge. No grouping → every edge is real (a plain triangle mesh has no diagonals to
    // hide). This is what makes a cube read as 12 edges instead of 18.
    g_edge_boundary = alloc.alloc(bool, g_edge_count) catch return false;
    const boundary = g_edge_boundary.?;
    g_edge_incidence = alloc.alloc(u16, g_edge_count) catch return false;
    const incidence = g_edge_incidence.?;
    @memset(incidence, 0);
    g_edge_wire = alloc.alloc(bool, g_edge_count) catch return false;
    const wire = g_edge_wire.?;
    // Count each distinct edge once per face regardless of authored grouping. The
    // resident Seat needs this to distinguish the perimeter of a deleted patch from
    // ordinary selectable face edges around the same vertex.
    f = 0;
    while (f < fc) : (f += 1) {
        var face_edges: [3]u32 = undefined;
        var face_edge_count: usize = 0;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const va = corner_vert[f * 3 + k];
            const vb = corner_vert[f * 3 + (k + 1) % 3];
            if (va == vb) continue;
            const idx = emap.get(edgeKey(va, vb)) orelse continue;
            var repeat = false;
            for (face_edges[0..face_edge_count]) |prior| {
                if (prior == idx) repeat = true;
            }
            if (repeat) continue;
            face_edges[face_edge_count] = idx;
            face_edge_count += 1;
            if (incidence[idx] < std.math.maxInt(u16)) incidence[idx] += 1;
        }
    }
    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    if (!has_groups) {
        @memset(boundary, true);
        @memset(wire, false);
    } else {
        @memset(boundary, false);
        // An edge starts as wire and loses the flag the moment a real (non-degenerate)
        // face touches it — surviving flags mark Pen Edges wires with no face at all.
        @memset(wire, true);
        const first_group = alloc.alloc(u32, g_edge_count) catch return false;
        defer alloc.free(first_group);
        const seen = alloc.alloc(bool, g_edge_count) catch return false;
        defer alloc.free(seen);
        @memset(seen, false);
        f = 0;
        while (f < fc) : (f += 1) {
            const g = model_source.faceGroupOf(f);
            const ca = corner_vert[f * 3 + 0];
            const cb = corner_vert[f * 3 + 1];
            const cc = corner_vert[f * 3 + 2];
            const face_degenerate = ca == cb or cb == cc or ca == cc;
            // Count each DISTINCT edge once per face: a degenerate wire triangle
            // (a, b, b — the Pen Edges format) walks its one real edge twice, and
            // double-counting would classify every naked pen edge as an internal
            // diagonal and hide it.
            var face_edges: [3]u32 = undefined;
            var face_edge_count: usize = 0;
            var k: u32 = 0;
            while (k < 3) : (k += 1) {
                const va = corner_vert[f * 3 + k];
                const vb = corner_vert[f * 3 + (k + 1) % 3];
                if (va == vb) continue;
                const idx = emap.get(edgeKey(va, vb)) orelse continue;
                var repeat = false;
                for (face_edges[0..face_edge_count]) |prior| {
                    if (prior == idx) repeat = true;
                }
                if (repeat) continue;
                face_edges[face_edge_count] = idx;
                face_edge_count += 1;
                if (!face_degenerate) wire[idx] = false;
                if (!seen[idx]) {
                    seen[idx] = true;
                    first_group[idx] = g;
                } else if (first_group[idx] != g) {
                    boundary[idx] = true;
                }
            }
        }
        // A naked / non-manifold edge (not shared by exactly two faces) is always real.
        var e: u32 = 0;
        while (e < g_edge_count) : (e += 1) {
            if (incidence[e] != 2) boundary[e] = true;
        }
    }

    g_sel_vert = alloc.alloc(bool, g_vert_count) catch return false;
    g_sel_edge = alloc.alloc(bool, g_edge_count) catch return false;
    g_sel_face = alloc.alloc(bool, fc) catch return false;
    g_affect_vert = alloc.alloc(bool, g_vert_count) catch return false;
    @memset(g_sel_vert.?, false);
    @memset(g_sel_edge.?, false);
    @memset(g_sel_face.?, false);
    @memset(g_affect_vert.?, false);
    if (old_face_sel) |old| {
        if (old.len == g_sel_face.?.len) @memcpy(g_sel_face.?, old);
    }
    if (g_mode == .face) applyFaceHighlight();
    return true;
}

fn edgeKey(a0: u32, b0: u32) u64 {
    const a = @min(a0, b0);
    const b = @max(a0, b0);
    return (@as(u64, a) << 32) | @as(u64, b);
}

fn addEdge(emap: *std.AutoHashMapUnmanaged(u64, u32), edges: *std.ArrayListUnmanaged(u32), a0: u32, b0: u32) void {
    const a = @min(a0, b0);
    const b = @max(a0, b0);
    if (a == b) return;
    const gop = emap.getOrPut(alloc, edgeKey(a, b)) catch return;
    if (gop.found_existing) return;
    gop.value_ptr.* = @intCast(edges.items.len / 2);
    edges.append(alloc, a) catch return;
    edges.append(alloc, b) catch return;
}

/// Adopt a different render diagonal for one or more authored quads without
/// rebuilding logical vertex identity or dropping the active selection. The indexed
/// face table has already installed the new triangle corner positions in model_paint;
/// this updates the soup-facing corner/edge maps to match. Boundary edges and stable
/// welded vertex ids are unchanged, so vertex selections survive directly and edge
/// selections are restored by their endpoint ids.
pub fn adoptSameFaceTriangulation() bool {
    if (!ensureTopology()) return false;
    const positions = model_paint.positions() orelse return false;
    const face_count = model_paint.faceCount();
    if (positions.len < @as(usize, face_count) * 9) return false;
    const welded_positions = g_verts orelse return false;
    const welded_parts = g_vert_part orelse return false;
    if (welded_parts.len < g_vert_count) return false;

    var welded_by_key = std.AutoHashMapUnmanaged(WeldKey, u32).empty;
    defer welded_by_key.deinit(alloc);
    welded_by_key.ensureTotalCapacity(alloc, g_vert_count) catch return false;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        const base = @as(usize, vertex) * 3;
        welded_by_key.put(alloc, .{
            .pos = weldKey(.{ welded_positions[base], welded_positions[base + 1], welded_positions[base + 2] }),
            .part = welded_parts[vertex],
        }, vertex) catch return false;
    }

    const new_corners = alloc.alloc(u32, @as(usize, face_count) * 3) catch return false;
    var corners_adopted = false;
    defer if (!corners_adopted) alloc.free(new_corners);
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        const part = model_source.partIndexOf(model_source.faceGroupOf(face));
        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const base = @as(usize, face) * 9 + @as(usize, corner) * 3;
            new_corners[face * 3 + corner] = welded_by_key.get(.{
                .pos = weldKey(.{ positions[base], positions[base + 1], positions[base + 2] }),
                .part = part,
            }) orelse return false;
        }
    }

    var selected_edges = std.AutoHashMapUnmanaged(u64, void).empty;
    defer selected_edges.deinit(alloc);
    if (g_edges) |old_edges| {
        if (g_sel_edge) |old_selection| {
            var edge: u32 = 0;
            while (edge < g_edge_count and edge < old_selection.len) : (edge += 1) {
                if (!old_selection[edge]) continue;
                selected_edges.put(alloc, edgeKey(old_edges[edge * 2], old_edges[edge * 2 + 1]), {}) catch return false;
            }
        }
    }

    var edge_map = std.AutoHashMapUnmanaged(u64, u32).empty;
    defer edge_map.deinit(alloc);
    var new_edges = std.ArrayListUnmanaged(u32).empty;
    defer new_edges.deinit(alloc);
    edge_map.ensureTotalCapacity(alloc, face_count * 3) catch return false;
    new_edges.ensureTotalCapacity(alloc, @as(usize, face_count) * 6) catch return false;
    face = 0;
    while (face < face_count) : (face += 1) {
        const a = new_corners[face * 3 + 0];
        const b = new_corners[face * 3 + 1];
        const c = new_corners[face * 3 + 2];
        addEdge(&edge_map, &new_edges, a, b);
        addEdge(&edge_map, &new_edges, b, c);
        addEdge(&edge_map, &new_edges, c, a);
    }
    const new_edge_count: u32 = @intCast(new_edges.items.len / 2);
    const new_boundary = alloc.alloc(bool, new_edge_count) catch return false;
    var boundary_adopted = false;
    defer if (!boundary_adopted) alloc.free(new_boundary);
    const new_incidence = alloc.alloc(u16, new_edge_count) catch return false;
    var incidence_adopted = false;
    defer if (!incidence_adopted) alloc.free(new_incidence);
    @memset(new_incidence, 0);
    const new_wire = alloc.alloc(bool, new_edge_count) catch return false;
    defer if (!boundary_adopted) alloc.free(new_wire);
    face = 0;
    while (face < face_count) : (face += 1) {
        var face_edges: [3]u32 = undefined;
        var face_edge_count: usize = 0;
        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const a = new_corners[face * 3 + corner];
            const b = new_corners[face * 3 + (corner + 1) % 3];
            if (a == b) continue;
            const edge = edge_map.get(edgeKey(a, b)) orelse continue;
            var repeat = false;
            for (face_edges[0..face_edge_count]) |prior| {
                if (prior == edge) repeat = true;
            }
            if (repeat) continue;
            face_edges[face_edge_count] = edge;
            face_edge_count += 1;
            if (new_incidence[edge] < std.math.maxInt(u16)) new_incidence[edge] += 1;
        }
    }
    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    if (!has_groups) {
        @memset(new_boundary, true);
        @memset(new_wire, false);
    } else {
        @memset(new_boundary, false);
        @memset(new_wire, true);
        const first_group = alloc.alloc(u32, new_edge_count) catch return false;
        defer alloc.free(first_group);
        const seen = alloc.alloc(bool, new_edge_count) catch return false;
        defer alloc.free(seen);
        @memset(seen, false);
        face = 0;
        while (face < face_count) : (face += 1) {
            const group = model_source.faceGroupOf(face);
            const fa = new_corners[face * 3 + 0];
            const fb = new_corners[face * 3 + 1];
            const fc_corner = new_corners[face * 3 + 2];
            const face_degenerate = fa == fb or fb == fc_corner or fa == fc_corner;
            // Same distinct-edge-per-face rule as ensureTopology: a degenerate Pen
            // Edges triangle must not double-count its lone edge into hiding.
            var face_edges: [3]u32 = undefined;
            var face_edge_count: usize = 0;
            var corner: u32 = 0;
            while (corner < 3) : (corner += 1) {
                const a = new_corners[face * 3 + corner];
                const b = new_corners[face * 3 + (corner + 1) % 3];
                if (a == b) continue;
                const edge = edge_map.get(edgeKey(a, b)) orelse continue;
                var repeat = false;
                for (face_edges[0..face_edge_count]) |prior| {
                    if (prior == edge) repeat = true;
                }
                if (repeat) continue;
                face_edges[face_edge_count] = edge;
                face_edge_count += 1;
                if (!face_degenerate) new_wire[edge] = false;
                if (!seen[edge]) {
                    seen[edge] = true;
                    first_group[edge] = group;
                } else if (first_group[edge] != group) {
                    new_boundary[edge] = true;
                }
            }
        }
        var edge: u32 = 0;
        while (edge < new_edge_count) : (edge += 1) {
            if (new_incidence[edge] != 2) new_boundary[edge] = true;
        }
    }

    const new_selection = alloc.alloc(bool, new_edge_count) catch return false;
    var selection_adopted = false;
    defer if (!selection_adopted) alloc.free(new_selection);
    @memset(new_selection, false);
    var edge: u32 = 0;
    while (edge < new_edge_count) : (edge += 1) {
        new_selection[edge] = selected_edges.contains(edgeKey(new_edges.items[edge * 2], new_edges.items[edge * 2 + 1]));
    }
    const owned_edges = new_edges.toOwnedSlice(alloc) catch return false;
    var edges_adopted = false;
    defer if (!edges_adopted) alloc.free(owned_edges);

    if (g_corner_vert) |old| alloc.free(old);
    if (g_edges) |old| alloc.free(old);
    if (g_edge_boundary) |old| alloc.free(old);
    if (g_edge_incidence) |old| alloc.free(old);
    if (g_edge_wire) |old| alloc.free(old);
    if (g_sel_edge) |old| alloc.free(old);
    if (g_scope_vert) |old| alloc.free(old);
    if (g_scope_edge) |old| alloc.free(old);
    if (g_snap) |old| alloc.free(old);
    g_corner_vert = new_corners;
    g_edges = owned_edges;
    g_edge_boundary = new_boundary;
    g_edge_incidence = new_incidence;
    g_edge_wire = new_wire;
    g_sel_edge = new_selection;
    g_scope_vert = null;
    g_scope_edge = null;
    g_scope_built = 0;
    g_snap = null;
    g_edge_count = new_edge_count;
    g_built_for = face_count;
    corners_adopted = true;
    edges_adopted = true;
    boundary_adopted = true;
    incidence_adopted = true;
    selection_adopted = true;
    return true;
}

/// Is welded edge `e` a boundary edge (a real model edge, not a triangulation diagonal)?
/// True when no topology/grouping is loaded, so callers default to showing every edge.
pub fn edgeIsBoundaryPub(e: u32) bool {
    const b = g_edge_boundary orelse return true;
    return e >= b.len or b[e];
}

/// Distinct source-face incidence for an authored welded edge. One means the edge
/// is open; two is manifold; values above two are non-manifold.
pub fn edgeFaceIncidencePub(e: u32) u16 {
    const incidence = g_edge_incidence orelse return 0;
    return if (e < incidence.len) incidence[e] else 0;
}

/// A naked Pen Edges wire edge — no rasterizing face anywhere on it. The view-mode
/// overlay draws these so a committed wire stays visible outside the edit modes.
pub fn edgeIsWirePub(e: u32) bool {
    const w = g_edge_wire orelse return false;
    return e < w.len and w[e];
}

/// Count of boundary edges (the ones selection + the overlay actually use).
pub fn boundaryEdgeCount() u32 {
    const b = g_edge_boundary orelse return g_edge_count;
    var n: u32 = 0;
    for (b) |v| {
        if (v) n += 1;
    }
    return n;
}

fn vertPos(i: u32) [3]f32 {
    const v = g_verts.?;
    return .{ v[i * 3 + 0], v[i * 3 + 1], v[i * 3 + 2] };
}

fn vecAdd(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}
fn vecSub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn vecMul(a: [3]f32, s: f32) [3]f32 {
    return .{ a[0] * s, a[1] * s, a[2] * s };
}
fn vecDot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn vecCross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn vecNorm(a: [3]f32) [3]f32 {
    const l = @sqrt(vecDot(a, a));
    if (l < 1e-8) return .{ 0, 0, 0 };
    return .{ a[0] / l, a[1] / l, a[2] / l };
}

fn markAffected(mask: []bool, idx: u32, count: *u32) void {
    if (idx >= mask.len or mask[idx]) return;
    mask[idx] = true;
    count.* += 1;
}

fn fillAffectedVerts() ?[]bool {
    if (!ensureTopology()) return null;
    const mask = g_affect_vert orelse return null;
    @memset(mask, false);
    var count: u32 = 0;
    switch (g_mode) {
        .vertex => {
            const sel = g_sel_vert orelse return null;
            var i: u32 = 0;
            while (i < sel.len) : (i += 1) {
                if (sel[i] and vertInScopePub(i)) markAffected(mask, i, &count);
            }
        },
        .edge => {
            const sel = g_sel_edge orelse return null;
            const edges = g_edges orelse return null;
            var e: u32 = 0;
            while (e < sel.len and e < g_edge_count) : (e += 1) {
                if (!sel[e] or !edgeInScopePub(e)) continue;
                markAffected(mask, edges[e * 2 + 0], &count);
                markAffected(mask, edges[e * 2 + 1], &count);
            }
        },
        .face => {
            const sel = g_sel_face orelse return null;
            const corners = g_corner_vert orelse return null;
            var f: u32 = 0;
            while (f < sel.len) : (f += 1) {
                if (!sel[f] or !faceInScope(f)) continue;
                markAffected(mask, corners[f * 3 + 0], &count);
                markAffected(mask, corners[f * 3 + 1], &count);
                markAffected(mask, corners[f * 3 + 2], &count);
            }
        },
        .none => return null,
    }
    return if (count > 0) mask else null;
}

/// Centroid of the logical vertices affected by the active selection. Used by the
/// native transform gizmo as its stable pivot.
pub fn selectionPivot() ?[3]f32 {
    const mask = fillAffectedVerts() orelse return null;
    var sum: [3]f32 = .{ 0, 0, 0 };
    var count: u32 = 0;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!mask[i]) continue;
        const p = vertPos(i);
        sum[0] += p[0];
        sum[1] += p[1];
        sum[2] += p[2];
        count += 1;
    }
    if (count == 0) return null;
    const inv = 1.0 / @as(f32, @floatFromInt(count));
    return .{ sum[0] * inv, sum[1] * inv, sum[2] * inv };
}

/// The active selection's affected logical-vertex mask, copied into `out`
/// (welding, req_3382 — vertex mode welds the selected verts, edge mode the
/// selected edges' endpoints, exactly the set transforms move). Returns the
/// affected count; 0 = nothing selected / no topology.
pub fn affectedSelectionVertsPub(out: []bool) u32 {
    const mask = fillAffectedVerts() orelse return 0;
    const n = @min(out.len, mask.len);
    @memcpy(out[0..n], mask[0..n]);
    var count: u32 = 0;
    for (out[0..n]) |flag| {
        if (flag) count += 1;
    }
    return count;
}

pub const SelectionFrame = struct {
    center: [3]f32,
    radius: f32,
};

/// One ordered row of vertices whose edge widths should be made uniform.  The
/// row is explicit because retopology may contain poles and provisional open
/// seams: guessing a loop from valence at this boundary is how an equalizer
/// jumps into the wrong strip.  Open paths pin both endpoints; closed paths pin
/// the first vertex as the phase anchor and distribute the rest around the loop.
pub const NormalizeWidthPath = struct {
    vertices: []const u32,
    closed: bool = false,
};

pub const NormalizeWidthsRequest = struct {
    paths: []const NormalizeWidthPath,
    strength: f32 = 1,
};

/// Bounding sphere of the active logical selection. Numeric transforms use this
/// after a large one-shot scale to keep the result in view without changing the
/// user's orbit angle.
pub fn selectionFrame() ?SelectionFrame {
    const center = selectionPivot() orelse return null;
    const mask = fillAffectedVerts() orelse return null;
    var radius_sq: f32 = 0;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!mask[i]) continue;
        const rel = vecSub(vertPos(i), center);
        radius_sq = @max(radius_sq, vecDot(rel, rel));
    }
    return .{ .center = center, .radius = @sqrt(radius_sq) };
}

fn verticesShareBoundaryEdge(a: u32, b: u32) bool {
    const edges = g_edges orelse return false;
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!edgeIsBoundaryPub(edge)) continue;
        const x = edges[edge * 2];
        const y = edges[edge * 2 + 1];
        if ((x == a and y == b) or (x == b and y == a)) return true;
    }
    return false;
}

fn pointDistance(a: [3]f32, b: [3]f32) f32 {
    const d = vecSub(b, a);
    return @sqrt(vecDot(d, d));
}

/// Equal-arc resampling over the path that already exists. Targets stay on the
/// current piecewise-linear curve rather than a chord between its endpoints,
/// preserving the generated surface's curvature while removing narrow/wide
/// edge alternation.
fn resampleWidthPath(points: []const [3]f32, closed: bool, out: [][3]f32) bool {
    if (points.len < 3 or out.len != points.len) return false;
    const segment_count = if (closed) points.len else points.len - 1;
    var total: f32 = 0;
    for (0..segment_count) |segment| {
        const next = if (segment + 1 == points.len) 0 else segment + 1;
        const length = pointDistance(points[segment], points[next]);
        if (!std.math.isFinite(length) or length <= 1e-8) return false;
        total += length;
    }
    if (!std.math.isFinite(total) or total <= 1e-8) return false;

    for (0..points.len) |index| {
        if (!closed and (index == 0 or index + 1 == points.len)) {
            out[index] = points[index];
            continue;
        }
        const denominator: f32 = @floatFromInt(if (closed) points.len else points.len - 1);
        const wanted = total * (@as(f32, @floatFromInt(index)) / denominator);
        var accumulated: f32 = 0;
        var segment: usize = 0;
        while (segment < segment_count) : (segment += 1) {
            const next = if (segment + 1 == points.len) 0 else segment + 1;
            const length = pointDistance(points[segment], points[next]);
            if (wanted <= accumulated + length or segment + 1 == segment_count) {
                const t = std.math.clamp((wanted - accumulated) / length, 0, 1);
                out[index] = vecAdd(points[segment], vecMul(vecSub(points[next], points[segment]), t));
                break;
            }
            accumulated += length;
        }
    }
    return true;
}

fn applyExplicitVertexTargets(affected: []const bool, targets: []const f32) Mutation {
    if (affected.len < g_vert_count or targets.len < @as(usize, g_vert_count) * 3) return .{};
    const verts = g_verts orelse return .{};
    const corners = g_corner_vert orelse return .{};
    const positions = model_paint.positionsMutable() orelse return .{};

    var moved = false;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        if (!affected[vertex]) continue;
        const base = @as(usize, vertex) * 3;
        if (!std.math.isFinite(targets[base]) or
            !std.math.isFinite(targets[base + 1]) or
            !std.math.isFinite(targets[base + 2])) return .{};
        if (@abs(verts[base] - targets[base]) +
            @abs(verts[base + 1] - targets[base + 1]) +
            @abs(verts[base + 2] - targets[base + 2]) > 1e-8) moved = true;
    }
    if (!moved) return .{};

    vertex = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        if (!affected[vertex]) continue;
        const base = @as(usize, vertex) * 3;
        verts[base] = targets[base];
        verts[base + 1] = targets[base + 1];
        verts[base + 2] = targets[base + 2];
    }

    const face_count = model_paint.faceCount();
    var mutation = Mutation{ .first_face = face_count, .last_face = 0 };
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        var touched = false;
        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const logical = corners[face * 3 + corner];
            if (logical >= affected.len or !affected[logical]) continue;
            const dst = @as(usize, face) * 9 + @as(usize, corner) * 3;
            const src = @as(usize, logical) * 3;
            if (dst + 2 >= positions.len) continue;
            positions[dst] = verts[src];
            positions[dst + 1] = verts[src + 1];
            positions[dst + 2] = verts[src + 2];
            touched = true;
        }
        if (!touched) continue;
        mutation.first_face = @min(mutation.first_face, face);
        mutation.last_face = @max(mutation.last_face, face);
        mutation.changed = true;
    }
    return mutation;
}

/// Normalize one or more explicitly ordered retopology rows in one mutation.
/// Every requested step must already be a real model edge and every vertex must
/// be in the active part scope. Paths may not overlap: shared vertices make the
/// target ambiguous and are rejected before anything moves.
pub fn normalizeWidths(allocator: std.mem.Allocator, request: NormalizeWidthsRequest) Mutation {
    if (!ensureTopology() or request.paths.len == 0 or request.paths.len > 128 or
        !std.math.isFinite(request.strength) or request.strength <= 0 or request.strength > 1) return .{};
    const verts = g_verts orelse return .{};
    const affected = allocator.alloc(bool, g_vert_count) catch return .{};
    defer allocator.free(affected);
    @memset(affected, false);
    const targets = allocator.dupe(f32, verts) catch return .{};
    defer allocator.free(targets);

    var total_vertices: usize = 0;
    for (request.paths) |path| {
        if (path.vertices.len < 3) return .{};
        total_vertices += path.vertices.len;
        if (total_vertices > 8192) return .{};
        for (path.vertices, 0..) |vertex, index| {
            if (vertex >= g_vert_count or !vertInScopePub(vertex) or affected[vertex]) return .{};
            affected[vertex] = true;
            if (index > 0 and !verticesShareBoundaryEdge(path.vertices[index - 1], vertex)) return .{};
        }
        if (path.closed and !verticesShareBoundaryEdge(path.vertices[path.vertices.len - 1], path.vertices[0])) return .{};

        const points = allocator.alloc([3]f32, path.vertices.len) catch return .{};
        defer allocator.free(points);
        const normalized = allocator.alloc([3]f32, path.vertices.len) catch return .{};
        defer allocator.free(normalized);
        for (path.vertices, 0..) |vertex, index| points[index] = vertPos(vertex);
        if (!resampleWidthPath(points, path.closed, normalized)) return .{};
        for (path.vertices, 0..) |vertex, index| {
            const base = @as(usize, vertex) * 3;
            const target = vecAdd(points[index], vecMul(vecSub(normalized[index], points[index]), request.strength));
            targets[base] = target[0];
            targets[base + 1] = target[1];
            targets[base + 2] = target[2];
        }
    }
    return applyExplicitVertexTargets(affected, targets);
}

pub const ScaleFactorTuning = struct {
    min: f32,
    max: f32,
    no_op_epsilon: f32,
};

/// One scale-factor contract for mouse drags and exact numeric entry.
pub const scale_factor_tuning = ScaleFactorTuning{
    .min = 0.02,
    .max = 50.0,
    .no_op_epsilon = 1e-5,
};

pub const ScaleByValueTuning = struct {
    min_magnitude: f32,
    max_magnitude: f32,
    no_op_epsilon: f32,
};

/// Exact numeric Scale By is deliberately wider than drag scaling: a negative
/// uniform factor mirrors the selection through its pivot, while mouse drags
/// remain positive and never cross the zero singularity.
pub const scale_by_value_tuning = ScaleByValueTuning{
    .min_magnitude = 0.000001,
    .max_magnitude = 50.0,
    .no_op_epsilon = 1e-5,
};

fn exactScaleByFactor(factor: f32) ?f32 {
    if (!std.math.isFinite(factor)) return null;
    const magnitude = @abs(factor);
    if (magnitude < scale_by_value_tuning.min_magnitude or magnitude > scale_by_value_tuning.max_magnitude) return null;
    if (@abs(factor - 1.0) < scale_by_value_tuning.no_op_epsilon) return null;
    return factor;
}

const TransformKind = enum { translate, scale_axis, scale_uniform, rotate_axis };

fn transformPoint(kind: TransformKind, p: [3]f32, delta: [3]f32, axis: [3]f32, pivot: [3]f32, scalar: f32) [3]f32 {
    return switch (kind) {
        .translate => vecAdd(p, delta),
        .scale_axis => blk: {
            const rel = vecSub(p, pivot);
            const along = vecDot(rel, axis);
            break :blk vecAdd(p, vecMul(axis, along * (scalar - 1.0)));
        },
        .scale_uniform => vecAdd(pivot, vecMul(vecSub(p, pivot), scalar)),
        .rotate_axis => blk: {
            const rel = vecSub(p, pivot);
            const c = @cos(scalar);
            const s = @sin(scalar);
            const term1 = vecMul(rel, c);
            const term2 = vecMul(vecCross(axis, rel), s);
            const term3 = vecMul(axis, vecDot(axis, rel) * (1.0 - c));
            break :blk vecAdd(pivot, vecAdd(vecAdd(term1, term2), term3));
        },
    };
}

// ── Live mirror editing (req_2758) ────────────────────────────────────────────────
/// Set the enabled mirror planes (bit 0 = X, 1 = Y, 2 = Z). Toggling forces a twin-table
/// rebuild so pairing always reflects the mesh as it stands right now.
pub fn setMirrorMask(mask: u8) void {
    g_mirror_mask = mask & 7;
    g_mirror_built_for = 0;
}
pub fn mirrorMask() u8 {
    return g_mirror_mask;
}

pub const MirrorFrame = struct { center: [3]f32, radius: f32 };

/// The visual mirror frame: the shared plane at MIRROR_PLANE_CENTER, sized so the overlay
/// reaches the current edit scope's geometry wherever it sits relative to the plane.
pub fn mirrorFramePub() ?MirrorFrame {
    if (!ensureTopology()) return null;
    var reach: f32 = 0;
    var any = false;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!vertInScopePub(i)) continue;
        const p = vertPos(i);
        var d2: f32 = 0;
        var a: usize = 0;
        while (a < 3) : (a += 1) {
            const d = p[a] - MIRROR_PLANE_CENTER[a];
            d2 += d * d;
        }
        reach = @max(reach, d2);
        any = true;
    }
    if (!any) return null;
    return .{ .center = MIRROR_PLANE_CENTER, .radius = @max(0.6, @sqrt(reach) * 1.1) };
}

const MirrorKey = struct { part: u32, x: i32, y: i32, z: i32 };
fn mirrorKey(part: u32, p: [3]f32) MirrorKey {
    return .{
        .part = part,
        .x = @round(p[0] * MIRROR_Q),
        .y = @round(p[1] * MIRROR_Q),
        .z = @round(p[2] * MIRROR_Q),
    };
}

fn reflectPointAround(p: [3]f32, subset: u8, center: [3]f32) [3]f32 {
    var r = p;
    inline for (0..3) |a| {
        if (subset & (@as(u8, 1) << @intCast(a)) != 0) r[a] = center[a] * 2.0 - r[a];
    }
    return r;
}

/// Sentinel part id for the any-part position map — never a real part index.
const ANY_PART: u32 = MIRROR_NONE;

/// Position→vertex lookup for twin matching: the same-part map keeps welded identity
/// domains self-consistent; the any-part map lets a mirror-duplicated part pair with
/// its twin part across the shared plane. Same part always wins.
const MirrorMap = struct {
    by_part: std.AutoHashMapUnmanaged(MirrorKey, u32) = .empty,
    any_part: std.AutoHashMapUnmanaged(MirrorKey, u32) = .empty,

    fn deinit(self: *MirrorMap) void {
        self.by_part.deinit(alloc);
        self.any_part.deinit(alloc);
    }

    fn build(parts: []const u32) ?MirrorMap {
        var map = MirrorMap{};
        var i: u32 = 0;
        while (i < g_vert_count) : (i += 1) {
            const p = vertPos(i);
            map.by_part.put(alloc, mirrorKey(parts[@intCast(i)], p), i) catch {
                map.deinit();
                return null;
            };
            map.any_part.put(alloc, mirrorKey(ANY_PART, p), i) catch {
                map.deinit();
                return null;
            };
        }
        return map;
    }

    fn get(self: *const MirrorMap, part: u32, p: [3]f32) ?u32 {
        if (self.by_part.get(mirrorKey(part, p))) |v| return v;
        return self.any_part.get(mirrorKey(ANY_PART, p));
    }
};

/// Build (or reuse) the twin table: for every non-empty subset of ALL three axes, each
/// vertex's reflection partner across MIRROR_PLANE_CENTER. Built for the full 7 subsets
/// so a mask change alone can reuse it; rebuilt when the topology (vert count) changes
/// or a toggle forces it. Returns null when there's no topology or allocation fails.
fn ensureMirrorTwins() ?[]u32 {
    if (!ensureTopology()) return null;
    if (g_mirror_twin != null and g_mirror_built_for == g_vert_count and g_mirror_built_mask == g_mirror_mask) return g_mirror_twin;
    const parts = g_vert_part orelse return null;
    if (parts.len < g_vert_count) return null;
    if (g_mirror_twin) |t| alloc.free(t);
    g_mirror_twin = null;
    const total: usize = @as(usize, g_vert_count) * 7;
    const twins = alloc.alloc(u32, total) catch return null;
    @memset(twins, MIRROR_NONE);
    var map = MirrorMap.build(parts) orelse {
        alloc.free(twins);
        return null;
    };
    defer map.deinit();
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        const part = parts[@intCast(i)];
        const p = vertPos(i);
        var s: u8 = 1;
        while (s <= 7) : (s += 1) {
            if (map.get(part, reflectPointAround(p, s, MIRROR_PLANE_CENTER))) |t| {
                twins[@as(usize, s - 1) * g_vert_count + i] = t;
            }
        }
    }
    g_mirror_twin = twins;
    g_mirror_built_for = g_vert_count;
    g_mirror_built_mask = g_mirror_mask;
    return twins;
}

/// The mirror twin of one logical vertex for a plane subset (bit 0/1/2 = X/Y/Z),
/// through the same twin table live mirrored transforms use. Null when mirror is
/// off, the subset is not enabled, or the vertex has no reflection partner — the
/// door topology ops use to extend an edit to the other side (req_3797).
pub fn mirrorTwinOfVertPub(v: u32, subset: u8) ?u32 {
    if (subset == 0 or subset > 7 or (subset & g_mirror_mask) != subset) return null;
    const twins = ensureMirrorTwins() orelse return null;
    if (v >= g_vert_count) return null;
    const t = twins[@as(usize, subset - 1) * g_vert_count + v];
    if (t == MIRROR_NONE or t == v or t >= g_vert_count) return null;
    return t;
}

/// Live symmetry report against the exact same identity domains and
/// the shared MIRROR_PLANE_CENTER plane as mirrored transforms. Only vertices in the
/// current outliner scope contribute; pairing prefers the vertex's own part and falls
/// back to any part, exactly like the twin table.
pub fn symmetryReportPub(axis: u8) ?[3]f32 {
    if (axis > 2 or !ensureTopology()) return null;
    const parts = g_vert_part orelse return null;
    if (parts.len < g_vert_count) return null;
    var map = MirrorMap.build(parts) orelse return null;
    defer map.deinit();

    const subset: u8 = @as(u8, 1) << @intCast(axis);
    const epsilon: f32 = 1.5 / MIRROR_Q;
    var unmatched: u32 = 0;
    var total: u32 = 0;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        if (!vertInScopePub(vertex)) continue;
        total += 1;
        const reflected = reflectPointAround(vertPos(vertex), subset, MIRROR_PLANE_CENTER);
        const twin = map.get(parts[@intCast(vertex)], reflected) orelse {
            unmatched += 1;
            continue;
        };
        const actual = vertPos(twin);
        if (@abs(actual[0] - reflected[0]) > epsilon or
            @abs(actual[1] - reflected[1]) > epsilon or
            @abs(actual[2] - reflected[2]) > epsilon)
        {
            unmatched += 1;
        }
    }
    return .{ MIRROR_PLANE_CENTER[axis], @floatFromInt(unmatched), @floatFromInt(total) };
}

fn applyTransform(kind: TransformKind, delta: [3]f32, axis_raw: [3]f32, pivot: [3]f32, scalar: f32) Mutation {
    const mask = fillAffectedVerts() orelse return .{};
    const axis = vecNorm(axis_raw);
    if ((kind == .scale_axis or kind == .rotate_axis) and vecDot(axis, axis) < 0.5) return .{};
    const verts = g_verts orelse return .{};
    const corners = g_corner_vert orelse return .{};
    const pos = model_paint.positionsMutable() orelse return .{};
    // Twin table must exist BEFORE the move loop — it pairs by position, and a fresh
    // build against half-moved verts would find nothing on the reflected side.
    const twins_opt: ?[]u32 = if (g_mirror_mask != 0) ensureMirrorTwins() else null;

    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!mask[i]) continue;
        const p = vertPos(i);
        const np = transformPoint(kind, p, delta, axis, pivot, scalar);
        verts[i * 3 + 0] = np[0];
        verts[i * 3 + 1] = np[1];
        verts[i * 3 + 2] = np[2];
    }

    // MIRROR (req_2758): land the reflected edit on every moved vertex's twin. Reflecting
    // the vertex's already-transformed NEW position IS the mirrored transform (a mirrored
    // translate/scale/rotate about the reflected pivot), so one rule covers all three tools.
    // A twin that is itself selected is skipped — it's being transformed directly.
    var mmask: ?[]bool = null;
    if (g_mirror_mask != 0) mirror: {
        const twins = twins_opt orelse break :mirror;
        if (g_mirror_affect == null or g_mirror_affect.?.len != g_vert_count) {
            if (g_mirror_affect) |m| alloc.free(m);
            g_mirror_affect = alloc.alloc(bool, g_vert_count) catch null;
        }
        const mm = g_mirror_affect orelse break :mirror;
        @memset(mm, false);
        var v: u32 = 0;
        while (v < g_vert_count) : (v += 1) {
            if (!mask[v]) continue;
            const np: [3]f32 = .{ verts[v * 3 + 0], verts[v * 3 + 1], verts[v * 3 + 2] };
            var s: u8 = 1;
            while (s <= 7) : (s += 1) {
                if ((s & g_mirror_mask) != s) continue; // only subsets of the ENABLED planes
                const t = twins[@as(usize, s - 1) * g_vert_count + v];
                if (t == MIRROR_NONE or t == v or t >= g_vert_count or mask[t]) continue;
                const rp = reflectPointAround(np, s, MIRROR_PLANE_CENTER);
                verts[t * 3 + 0] = rp[0];
                verts[t * 3 + 1] = rp[1];
                verts[t * 3 + 2] = rp[2];
                mm[t] = true;
            }
        }
        mmask = mm;
    }

    const fc = model_paint.faceCount();
    var out = Mutation{ .first_face = fc, .last_face = 0 };
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        var touched = false;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const lv = corners[f * 3 + k];
            if (lv >= mask.len) continue;
            if (!mask[lv] and !(mmask != null and mmask.?[lv])) continue;
            const dst = f * 9 + k * 3;
            const src = lv * 3;
            if (@as(usize, dst) + 2 >= pos.len) continue;
            pos[dst + 0] = verts[src + 0];
            pos[dst + 1] = verts[src + 1];
            pos[dst + 2] = verts[src + 2];
            touched = true;
        }
        if (touched) {
            if (f < out.first_face) out.first_face = f;
            if (f > out.last_face) out.last_face = f;
            out.changed = true;
        }
    }
    if (!out.changed) return .{};
    return out;
}

pub fn translateSelection(delta: [3]f32) Mutation {
    if (@abs(delta[0]) + @abs(delta[1]) + @abs(delta[2]) < 1e-8) return .{};
    return applyTransform(.translate, delta, .{ 1, 0, 0 }, .{ 0, 0, 0 }, 0);
}

pub fn scaleSelectionAxis(axis: [3]f32, pivot: [3]f32, factor_raw: f32) Mutation {
    const factor = exactScaleByFactor(factor_raw) orelse return .{};
    return applyTransform(.scale_axis, .{ 0, 0, 0 }, axis, pivot, factor);
}

/// Bounding sphere for the resident interleaved position/normal/UV soup. This is
/// the live Model Focus + camera-frame truth after numeric transforms; load-time
/// `MeshRef.radius` is intentionally not consulted.
pub fn frameForInterleavedPositions(verts: []const f32) ?SelectionFrame {
    if (verts.len < 8 or verts.len % 8 != 0) return null;
    var min = [3]f32{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) };
    var max = [3]f32{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) };
    var at: usize = 0;
    while (at + 2 < verts.len) : (at += 8) for (0..3) |axis| {
        if (!std.math.isFinite(verts[at + axis])) return null;
        min[axis] = @min(min[axis], verts[at + axis]);
        max[axis] = @max(max[axis], verts[at + axis]);
    };
    const center = [3]f32{
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5,
    };
    var radius_sq: f32 = 0;
    at = 0;
    while (at + 2 < verts.len) : (at += 8) {
        const rel = [3]f32{ verts[at] - center[0], verts[at + 1] - center[1], verts[at + 2] - center[2] };
        radius_sq = @max(radius_sq, vecDot(rel, rel));
    }
    return .{ .center = center, .radius = @sqrt(radius_sq) };
}

/// Exact uniform scale in one mesh mutation. Applying X/Y/Z as three separate
/// mutations made an exact-value command vulnerable to partial application if a
/// later axis failed; this path transforms every selected position atomically.
pub fn scaleSelectionUniform(pivot: [3]f32, factor_raw: f32) Mutation {
    const factor = exactScaleByFactor(factor_raw) orelse return .{};
    return applyTransform(.scale_uniform, .{ 0, 0, 0 }, .{ 0, 0, 0 }, pivot, factor);
}

pub fn rotateSelectionAxis(axis: [3]f32, pivot: [3]f32, radians: f32) Mutation {
    if (@abs(radians) < 1e-6) return .{};
    return applyTransform(.rotate_axis, .{ 0, 0, 0 }, axis, pivot, radians);
}

// ── Picking ─────────────────────────────────────────────────────────────────────
/// Pick the element under viewport pixel (mx,my) in the current mode and fold it into the
/// selection (additive = toggle / extend, else replace). Returns the new selected count in
/// this mode, or -1 if there's no mesh. A miss with !additive clears (Blockbench rule).
pub fn pick(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32, additive: bool) i32 {
    if (g_mode == .none) return -1;
    // Face mode never needs the weld — the cheap face-set path keeps picking as fast as
    // paint. Vertex/edge modes build (once) the welded topology they project against.
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;
    if (g_mode == .vertex or g_mode == .edge) _ = refreshCameraVisibility(cam);

    var hit: i32 = switch (g_mode) {
        .face => model_paint.pick(cam, vp_w, vp_h, mx, my),
        .vertex => pickVertex(cam, vp_w, vp_h, mx, my),
        .edge => pickEdge(cam, vp_w, vp_h, mx, my),
        .none => -1,
    };
    // A face pick raycasts the whole mesh; drop it if the hit face is outside the focused
    // part (vertex/edge picks already skip out-of-scope elements). (req_2415)
    if (g_mode == .face and hit >= 0 and !faceInScope(@intCast(hit))) hit = -1;

    const set = switch (g_mode) {
        .vertex => g_sel_vert.?,
        .edge => g_sel_edge.?,
        .face => g_sel_face.?,
        .none => return -1,
    };

    if (hit < 0) {
        if (!additive) clearSelection();
    } else {
        const idx: u32 = @intCast(hit);
        if (g_mode == .face) {
            // Studio faces arrive fan-triangulated, so a face pick grabs the whole
            // authored n-gon (every triangle sharing its group), not one sliver.
            if (additive) {
                const want = if (idx < set.len) !set[idx] else true;
                setFaceGroup(set, idx, want);
            } else {
                @memset(set, false);
                restoreAllFaces();
                setFaceGroup(set, idx, true);
            }
        } else if (additive) {
            if (idx < set.len) set[idx] = !set[idx];
        } else {
            // Replace: clear the active set, select just this one.
            @memset(set, false);
            if (idx < set.len) set[idx] = true;
        }
    }
    if (g_mode == .face) applyFaceHighlight();
    return @intCast(selCount());
}

/// Set every displayed face sharing `idx`'s authored-face group (model_source), so one
/// pick selects a whole fan-triangulated n-gon. No grouping loaded → just the one face.
fn setFaceGroup(set: []bool, idx: u32, value: bool) void {
    const group = model_source.faceGroupOf(idx);
    if (group == model_source.NO_FACE_GROUP) {
        if (idx < set.len) set[idx] = value;
        return;
    }
    var f: u32 = 0;
    const fc: u32 = @intCast(set.len);
    while (f < fc) : (f += 1) {
        if (model_source.faceGroupOf(f) == group) set[f] = value;
    }
}

fn inRect(sp: ?[2]f32, minx: f32, maxx: f32, miny: f32, maxy: f32) bool {
    const p = sp orelse return false;
    return p[0] >= minx and p[0] <= maxx and p[1] >= miny and p[1] <= maxy;
}

/// Marquee (rubber-band) select: select every element whose representative screen point
/// (vertex / edge-midpoint / face-centroid) falls inside the rect (x0,y0)-(x1,y1). The
/// desktop-style drag-select — sweep to grab many at once instead of one-by-one. additive
/// (Shift held with Alt) unions with the pre-gesture snapshot so you can sweep to ADD;
/// otherwise the rect IS the selection. Recomputed live each drag move. Returns the count.
pub fn boxSelect(cam: model_paint.Camera, vp_w: f32, vp_h: f32, x0: f32, y0: f32, x1: f32, y1: f32, additive: bool) i32 {
    if (g_mode == .none) return -1;
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;
    if (g_mode == .vertex or g_mode == .edge) _ = refreshCameraVisibility(cam);
    const minx = @min(x0, x1);
    const maxx = @max(x0, x1);
    const miny = @min(y0, y1);
    const maxy = @max(y0, y1);
    const set = activeSet() orelse return -1;

    // Recompute from the base each move: the rect alone, or unioned with the snapshot.
    @memset(set, false);
    if (additive) {
        if (g_snap) |s| {
            if (s.len == set.len and g_snap_mode == g_mode) @memcpy(set, s);
        }
    }

    switch (g_mode) {
        .face => {
            const pos = model_paint.positions() orelse return -1;
            const n: u32 = @intCast(set.len);
            var f: u32 = 0;
            while (f < n) : (f += 1) {
                if (!faceInScope(f)) continue; // outside the focused part
                if (!g_xray and !faceCameraFacing(cam, f)) continue;
                const b = f * 9;
                const c: [3]f32 = .{
                    (pos[b + 0] + pos[b + 3] + pos[b + 6]) / 3.0,
                    (pos[b + 1] + pos[b + 4] + pos[b + 7]) / 3.0,
                    (pos[b + 2] + pos[b + 5] + pos[b + 8]) / 3.0,
                };
                if (inRect(model_paint.project(cam, vp_w, vp_h, c), minx, maxx, miny, maxy)) set[f] = true;
            }
            // A face selection means the whole authored n-gon — the same rule the
            // click path applies via setFaceGroup. Without this a marquee grabs
            // whichever triangle CENTROIDS land in the rect (half a quad), and a
            // delete then punches a triangular hole (req_2559).
            var groups_hit = std.AutoHashMapUnmanaged(u32, void).empty;
            defer groups_hit.deinit(alloc);
            f = 0;
            while (f < n) : (f += 1) {
                if (!set[f]) continue;
                const grp = model_source.faceGroupOf(f);
                if (grp != model_source.NO_FACE_GROUP) groups_hit.put(alloc, grp, {}) catch {};
            }
            if (groups_hit.count() > 0) {
                f = 0;
                while (f < n) : (f += 1) {
                    if (set[f]) continue;
                    const grp = model_source.faceGroupOf(f);
                    if (grp != model_source.NO_FACE_GROUP and groups_hit.contains(grp)) set[f] = true;
                }
            }
        },
        .vertex => {
            var i: u32 = 0;
            while (i < g_vert_count) : (i += 1) {
                if (!vertInScopePub(i)) continue; // outside the focused part
                if (!vertexCameraVisiblePub(i)) continue;
                if (inRect(model_paint.project(cam, vp_w, vp_h, vertPos(i)), minx, maxx, miny, maxy)) set[i] = true;
            }
        },
        .edge => {
            const edges = g_edges.?;
            var e: u32 = 0;
            while (e < g_edge_count) : (e += 1) {
                if (!edgeIsBoundaryPub(e)) continue; // diagonals aren't real edges
                if (!edgeInScopePub(e)) continue; // outside the focused part
                if (!edgeCameraVisiblePub(e)) continue;
                const a = vertPos(edges[e * 2 + 0]);
                const b = vertPos(edges[e * 2 + 1]);
                const mid: [3]f32 = .{ (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5 };
                if (inRect(model_paint.project(cam, vp_w, vp_h, mid), minx, maxx, miny, maxy)) set[e] = true;
            }
        },
        .none => return -1,
    }
    if (g_mode == .face) applyFaceHighlight();
    return @intCast(selCount());
}

fn pickVertex(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    var best: i32 = -1;
    var best_d2: f32 = VERT_PX * VERT_PX;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!vertInScopePub(i)) continue; // outside the focused part
        if (!vertexCameraVisiblePub(i)) continue;
        const sp = model_paint.project(cam, vp_w, vp_h, vertPos(i)) orelse continue;
        const dx = sp[0] - mx;
        const dy = sp[1] - my;
        const d2 = dx * dx + dy * dy;
        // Surface mode confirms the candidate is not behind another rendered part;
        // X-Ray deliberately follows the through-model overlay handle instead.
        if (d2 < best_d2 and (g_xray or !model_paint.occluded(cam, vertPos(i)))) {
            best_d2 = d2;
            best = @intCast(i);
        }
    }
    return best;
}

fn pickEdge(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    const edges = g_edges.?;
    var best: i32 = -1;
    var best_d2: f32 = EDGE_PX * EDGE_PX;
    var e: u32 = 0;
    while (e < g_edge_count) : (e += 1) {
        if (!edgeIsBoundaryPub(e)) continue; // diagonals aren't real edges — not pickable
        if (!edgeInScopePub(e)) continue; // outside the focused part
        if (!edgeCameraVisiblePub(e)) continue;
        const va = vertPos(edges[e * 2 + 0]);
        const vb = vertPos(edges[e * 2 + 1]);
        const a = model_paint.project(cam, vp_w, vp_h, va) orelse continue;
        const b = model_paint.project(cam, vp_w, vp_h, vb) orelse continue;
        const d2 = segDist2(mx, my, a[0], a[1], b[0], b[1]);
        const midpoint = [3]f32{ (va[0] + vb[0]) * 0.5, (va[1] + vb[1]) * 0.5, (va[2] + vb[2]) * 0.5 };
        if (d2 < best_d2 and (g_xray or !model_paint.occluded(cam, midpoint))) {
            best_d2 = d2;
            best = @intCast(e);
        }
    }
    return best;
}

/// Squared distance from point (px,py) to segment (ax,ay)-(bx,by), in screen space.
fn segDist2(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) f32 {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const len2 = vx * vx + vy * vy;
    const t = if (len2 > 1e-6) std.math.clamp((wx * vx + wy * vy) / len2, 0.0, 1.0) else 0.0;
    const cx = ax + t * vx;
    const cy = ay + t * vy;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
}

// ── Face selection presentation hand-off ─────────────────────────────────────────
/// Selection presentation belongs to the renderer's translucent overlay. Reconcile
/// only unwinds a legacy standing patch; it never writes highlight pixels into the
/// authored atlas. This keeps UV movement a pure coordinate edit and preserves every
/// colour under a selected face.
fn applyFaceHighlight() void {
    restoreAllFaces();
}

fn restoreAllFaces() void {
    var it = g_face_base.iterator();
    while (it.next()) |entry| {
        model_paint.restoreFacePatch(entry.key_ptr.*, entry.value_ptr.*);
        alloc.free(entry.value_ptr.*);
    }
    g_face_base.clearRetainingCapacity();
}

/// Compatibility guard around atlas mutation/read boundaries. Depth counting remains
/// so nested callers preserve their contract; selection itself no longer mutates pixels.
pub fn suspendFaceTint() void {
    if (g_tint_suspend == 0) restoreAllFaces();
    g_tint_suspend += 1;
}

/// Balance a compatibility guard. The settled atlas remains true authored paint.
pub fn resumeFaceTint() void {
    if (g_tint_suspend > 0) g_tint_suspend -= 1;
    if (g_tint_suspend == 0) applyFaceHighlight();
}

/// Inherit one RGBA row per output face through a topology result's `src_face` map.
/// Validates the complete boundary before writing, so a bad parent index cannot leave a
/// partially remapped attribute buffer. Loop-cut previews use this for every plane: face
/// order/count may change, but paint identity follows geometry rather than array position.
pub fn inheritFaceRgba(colors_in: []const u8, src_face: []const u32, colors_out: []u8) bool {
    if (colors_in.len % 4 != 0 or colors_out.len % 4 != 0 or colors_out.len / 4 != src_face.len) return false;
    const in_faces = colors_in.len / 4;
    for (src_face) |src| {
        if (src >= in_faces) return false;
    }
    for (src_face, 0..) |src, out_face| {
        const from = @as(usize, src) * 4;
        const to = out_face * 4;
        @memcpy(colors_out[to .. to + 4], colors_in[from .. from + 4]);
    }
    return true;
}

// ── Tests ───────────────────────────────────────────────────────────────────────
const testing = std.testing;

// A quad on z=0 as two triangles sharing the diagonal → 4 logical verts, 5 edges.
fn setupQuad() void {
    // Interleaved 8 f32/vert (px,py,pz,nx,ny,nz,u,v); positions are what matters.
    var verts = [_]f32{
        // tri 0: (0,0) (1,0) (1,1)
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        // tri 1: (0,0) (1,1) (0,1)
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    model_paint.setTarget(777, &verts, 6);
}

// A unit-cube triangle soup (6 quads → 12 tris → 36 interleaved verts), the exact shape
// primitiveMeshData feeds the host. Each quad is fan-split (shared diagonal), matching how a
// Studio cube triangulates.
fn buildCubeSoup(soup: *[12 * 3 * 8]f32) void {
    const c = [8][3]f32{
        .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
        .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
    };
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 }, .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    var w: usize = 0;
    for (quads) |q| {
        const tri = [6]u32{ q[0], q[1], q[2], q[0], q[2], q[3] };
        for (tri) |vi| {
            const p = c[vi];
            soup[w + 0] = p[0];
            soup[w + 1] = p[1];
            soup[w + 2] = p[2];
            soup[w + 3] = 0;
            soup[w + 4] = 0;
            soup[w + 5] = 1;
            soup[w + 6] = 0;
            soup[w + 7] = 0;
            w += 8;
        }
    }
}

test "two adjacent selected edges imply the missing triangle" {
    var order: [3]u32 = undefined;
    try testing.expect(triangleFromAdjacentEdges(.{ 4, 7 }, .{ 7, 9 }, &order));
    try testing.expectEqualSlices(u32, &.{ 4, 7, 9 }, &order);
    try testing.expect(!triangleFromAdjacentEdges(.{ 4, 7 }, .{ 8, 9 }, &order));
    try testing.expect(!triangleFromAdjacentEdges(.{ 4, 7 }, .{ 7, 4 }, &order));
}

test "width normalization resamples the existing curve instead of its endpoint chord" {
    const points = [_][3]f32{
        .{ 0, 0, 0 },
        .{ 1, 0, 0 },
        .{ 1, 3, 0 },
    };
    var normalized: [points.len][3]f32 = undefined;
    try testing.expect(resampleWidthPath(&points, false, &normalized));
    try testing.expectEqual(points[0], normalized[0]);
    try testing.expectEqual(points[2], normalized[2]);
    // Half the four-metre arc is one metre up the second segment. A chord
    // interpolation would have incorrectly landed at (0.5, 1.5, 0).
    try testing.expectApproxEqAbs(@as(f32, 1), normalized[1][0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 1), normalized[1][1], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), normalized[1][2], 0.0001);
}

test "normalizeWidths equalizes an explicit topology path and pins open endpoints" {
    const corner_positions = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 1, 0, 0 }, .{ 4, 0, 0 }, .{ 0, 1, 0 },
    };
    var soup: [corner_positions.len * 8]f32 = @splat(0);
    for (corner_positions, 0..) |point, corner| {
        const base = corner * 8;
        soup[base] = point[0];
        soup[base + 1] = point[1];
        soup[base + 2] = point[2];
        soup[base + 5] = 1;
    }
    model_paint.setTarget(777, soup[0..], corner_positions.len);
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(ensureTopology());
    const left = findVertAt(.{ 0, 0, 0 }).?;
    const uneven = findVertAt(.{ 1, 0, 0 }).?;
    const right = findVertAt(.{ 4, 0, 0 }).?;
    const path_vertices = [_]u32{ left, uneven, right };
    const paths = [_]NormalizeWidthPath{.{ .vertices = &path_vertices }};
    const mutation = normalizeWidths(testing.allocator, .{ .paths = &paths });
    try testing.expect(mutation.changed);
    try testing.expectApproxEqAbs(@as(f32, 0), vertPos(left)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), vertPos(uneven)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 4), vertPos(right)[0], 0.0001);
}

test "symmetric cube welds to 8 verts + 18 edges (weld key must be exact, not a lossy hash)" {
    // The old x*C1 ^ y*C2 ^ z*C3 pack collapsed the cube's symmetric ±0.5 corners to 2 keys
    // → welded 8 corners into 2 verts (the "1 edge" cube bug).
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    model_paint.setTarget(778, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 8), vertCount());
    try testing.expectEqual(@as(u32, 18), edgeCount()); // 12 cube edges + 6 quad diagonals
}

test "grouped cube exposes 12 boundary edges — the 6 quad diagonals are hidden" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    // One authored-face id per SOURCE triangle: the two tris of each quad share a group.
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(779, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 18), edgeCount()); // topology still has all 18 welded edges
    try testing.expectEqual(@as(u32, 12), boundaryEdgeCount()); // but only 12 are REAL edges
}

test "two coincident cubes in DIFFERENT parts weld to 16 verts, not 8" {
    // The "edits bleed across stacked parts" bug: two identical cubes composed at the
    // origin. Position-only welding merged their corners into 8 shared logical verts, so
    // the gizmo moving cube 2's vert dragged cube 1 too. With part ranges set, the weld
    // keys on (position, part) and each cube keeps its own 8 verts.
    var soup: [2 * 12 * 3 * 8]f32 = undefined;
    buildCubeSoup(soup[0 .. 12 * 3 * 8]);
    buildCubeSoup(soup[12 * 3 * 8 ..][0 .. 12 * 3 * 8]);
    // Cube 1 owns groups 0..6, cube 2 owns groups 6..12 (two tris per authored quad).
    var groups: [24]u32 = undefined;
    for (&groups, 0..) |*g, i| g.* = @intCast(i / 2);
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(780, soup[0..], 72);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }

    // No part ranges → coincident corners weld across the cubes (the old behaviour).
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 8), vertCount());

    // Part ranges [0,6) and [6,12) → each cube welds independently: 16 verts, 36 edges.
    model_source.setPartRanges(&[_]u32{ 0, 6, 6, 12 });
    reset();
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 16), vertCount());
    try testing.expectEqual(@as(u32, 36), edgeCount()); // 18 welded edges per cube
}

test "weld builds 4 verts and 5 edges from a 2-tri quad" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 4), vertCount());
    try testing.expectEqual(@as(u32, 5), edgeCount()); // 4 sides + 1 shared diagonal
    try testing.expectEqual(@as(u32, 2), faceCount());
}

test "edge selection by index sets edge mode and supports additive sets" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(selectEdgeByIndex(0, false));
    try testing.expectEqual(Mode.edge, mode());
    try testing.expectEqual(@as(u32, 1), selCount());
    try testing.expectEqual(@as(u32, 1), selectedEdgeCountPub());
    try testing.expect(selectEdgeByIndex(1, true));
    try testing.expectEqual(@as(u32, 2), selectedEdgeCountPub());
}

test "vertex pick selects the nearest welded corner; face selection leaves atlas true" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    const cam = model_paint.Camera{ .eye = .{ 0.5, 0.5, 5 }, .target = .{ 0.5, 0.5, 0 }, .fov_deg = 50 };
    // Project corner (0,0) and click right on it.
    try testing.expect(ensureTopology());
    setMode(.vertex);
    const sp = model_paint.project(cam, 800, 600, .{ 0, 0, 0 }).?;
    const n = pick(cam, 800, 600, sp[0], sp[1], false);
    try testing.expectEqual(@as(i32, 1), n);

    // Face mode: selection state changes, but its renderer overlay never changes paint.
    setMode(.face);
    const base0 = model_paint.faceColor(0).?;
    _ = pick(cam, 800, 600, 400, 300, false); // centre ray → a face
    try testing.expect(selCount() == 1);
    const selected_color = model_paint.faceColor(0).?;
    try testing.expectEqual(base0, selected_color);
    clearSelection();
    const restored = model_paint.faceColor(0).?;
    try testing.expectEqual(base0[0], restored[0]);
    try testing.expectEqual(base0[1], restored[1]);
    try testing.expectEqual(base0[2], restored[2]);
}

test "surface mode rejects occluded element handles and xray deliberately restores them" {
    // Back/scoped triangle is hidden behind a front triangle from the camera's ray.
    // Surface mode must not let that unrelated part steal a click; X-Ray is the explicit
    // opt-in for reaching through the front surface.
    var verts = [_]f32{
        // scoped back part, group 0
        0.00,  0.00, -1.0, 0, 0, 1, 0, 0,
        0.25,  0.20, -1.0, 0, 0, 1, 0, 0,
        -0.25, 0.20, -1.0, 0, 0, 1, 0, 0,
        // front occluder part, group 1
        -1.0,  -1.0, 0.0,  0, 0, 1, 0, 0,
        1.0,   -1.0, 0.0,  0, 0, 1, 0, 0,
        0.0,   1.0,  0.0,  0, 0, 1, 0, 0,
    };
    model_paint.setTarget(794, verts[0..], 6);
    model_source.setFaceGroups(&[_]u32{ 0, 1 });
    model_source.setPartRanges(&[_]u32{ 0, 1, 1, 2 });
    setEditScope(0, 1);
    defer {
        setXray(false);
        setEditScope(0, 0);
        reset();
        model_paint.clear();
        model_source.clear();
    }

    const cam = model_paint.Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    const hidden_vert = [3]f32{ 0, 0, -1 };
    try testing.expect(model_paint.occluded(cam, hidden_vert));

    try testing.expect(ensureTopology());
    setMode(.vertex);
    const sp = model_paint.project(cam, 800, 600, hidden_vert).?;
    setXray(false);
    try testing.expectEqual(@as(i32, 0), pick(cam, 800, 600, sp[0], sp[1], false));
    try testing.expect(refreshCameraVisibility(cam));
    try testing.expect(vertexCameraVisiblePub(0)); // camera-facing, but exactly occluded by the other part

    setXray(true);
    try testing.expectEqual(@as(i32, 1), pick(cam, 800, 600, sp[0], sp[1], false));
    const pivot = selectionPivot().?;
    try testing.expectApproxEqAbs(@as(f32, -1), pivot[2], 1e-4);

    clearSelection();
    setMode(.edge);
    const hidden_edge_mid = [3]f32{ 0.125, 0.10, -1 };
    try testing.expect(model_paint.occluded(cam, hidden_edge_mid));
    const ep = model_paint.project(cam, 800, 600, hidden_edge_mid).?;
    setXray(false);
    try testing.expectEqual(@as(i32, 0), pick(cam, 800, 600, ep[0], ep[1], false));
    setXray(true);
    try testing.expectEqual(@as(i32, 1), pick(cam, 800, 600, ep[0], ep[1], false));
    try testing.expectEqual(@as(u32, 1), selectedEdgeCountPub());
}

test "box select grabs every element inside the rect; additive unions the snapshot" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    const cam = model_paint.Camera{ .eye = .{ 0.5, 0.5, 5 }, .target = .{ 0.5, 0.5, 0 }, .fov_deg = 50 };
    // A rect covering the whole viewport encloses every face/vertex.
    setMode(.vertex);
    try testing.expect(ensureTopology());
    _ = boxSelect(cam, 800, 600, 0, 0, 800, 600, false);
    try testing.expectEqual(@as(u32, 4), selCount()); // all 4 welded verts

    setMode(.face);
    _ = boxSelect(cam, 800, 600, 0, 0, 800, 600, false);
    try testing.expectEqual(@as(u32, 2), selCount()); // both faces' centroids enclosed

    // A tiny rect at one corner of the screen catches nothing.
    _ = boxSelect(cam, 800, 600, 0, 0, 2, 2, false);
    try testing.expectEqual(@as(u32, 0), selCount());

    // Additive box unions with the snapshot: select face 0, snapshot, then box the rest.
    _ = selectFaceByIndex(0, false);
    snapshotSelection();
    _ = boxSelect(cam, 800, 600, 0, 0, 800, 600, true);
    try testing.expectEqual(@as(u32, 2), selCount());
}

test "face selection transform moves welded shared corners" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(selectFaceByIndex(0, false));
    const pivot = selectionPivot().?;
    try testing.expectApproxEqAbs(@as(f32, 2.0 / 3.0), pivot[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 1.0 / 3.0), pivot[1], 0.0001);

    const m = translateSelection(.{ 0, 0, 2 });
    try testing.expect(m.changed);
    try testing.expectEqual(@as(u32, 0), m.first_face);
    try testing.expectEqual(@as(u32, 1), m.last_face);

    const pos = model_paint.positions().?;
    // Face 0's three logical vertices moved.
    try testing.expectApproxEqAbs(@as(f32, 2), pos[2], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), pos[5], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), pos[8], 0.0001);
    // Face 1 shares (0,0) and (1,1), so those corners move too; its unique (0,1) stays.
    try testing.expectApproxEqAbs(@as(f32, 2), pos[11], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), pos[14], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), pos[17], 0.0001);
}

test "axis scale and rotate operate around the selection pivot" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    setMode(.vertex);
    try testing.expect(ensureTopology());
    g_sel_vert.?[0] = true; // (0,0,0)
    g_sel_vert.?[1] = true; // (1,0,0)

    const pivot = selectionPivot().?;
    try testing.expectApproxEqAbs(@as(f32, 0.5), pivot[0], 0.0001);
    _ = scaleSelectionAxis(.{ 1, 0, 0 }, pivot, 2.0);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(0)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 1.5), vertPos(1)[0], 0.0001);

    _ = rotateSelectionAxis(.{ 0, 0, 1 }, pivot, std.math.pi);
    try testing.expectApproxEqAbs(@as(f32, 1.5), vertPos(0)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(1)[0], 0.0001);
}

test "selection and nested tint guards keep the authored atlas byte-exact" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    const base0 = model_paint.faceColor(0).?;
    try testing.expect(selectFaceByIndex(0, false));
    try testing.expectEqual(base0, model_paint.faceColor(0).?);

    // Nested legacy guards remain balanced while selection changes underneath them.
    suspendFaceTint();
    const clean = model_paint.faceColor(0).?;
    try testing.expectEqual(base0[0], clean[0]);
    try testing.expectEqual(base0[1], clean[1]);
    try testing.expectEqual(base0[2], clean[2]);
    try testing.expect(selectFaceByIndex(1, false));
    const still_clean = model_paint.faceColor(1).?;
    try testing.expectEqual(base0[0], still_clean[0]);

    suspendFaceTint();
    resumeFaceTint();
    try testing.expectEqual(base0[0], model_paint.faceColor(1).?[0]);

    resumeFaceTint();
    try testing.expectEqual(base0, model_paint.faceColor(1).?);
    try testing.expectEqual(base0[0], model_paint.faceColor(0).?[0]);

    clearSelection();
    try testing.expectEqual(base0[0], model_paint.faceColor(1).?[0]);
}

test "face-mode selCount reads AUTHORED faces — a grouped cube face is 1, not 2 tris" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(781, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }
    try testing.expect(selectFaceByIndex(0, false)); // grabs the whole quad (2 tris)
    try testing.expectEqual(@as(u32, 1), selCount());
    try testing.expect(selectFaceByIndex(2, true)); // a second quad, additively
    try testing.expectEqual(@as(u32, 2), selCount());
}

test "multi-face selection clears without baking — overlapping island discs (req_2613)" {
    // The real repro: a grouped cube at default (tiny-island) density. Both halves of a
    // quad degenerate to near-identical centroid discs, so the old interleaved save/tint
    // left later patches holding earlier faces' tint — deselect wrote it back as paint.
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(782, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }
    var base: [12][4]u8 = undefined;
    var f: u32 = 0;
    while (f < 12) : (f += 1) base[f] = model_paint.faceColor(f).?;

    // Select EVERY face (the marquee / Ctrl+A shape), then deselect.
    try testing.expectEqual(@as(i32, 6), selectFacesByGroupRange(0, 6, false));
    clearSelection();
    f = 0;
    while (f < 12) : (f += 1) {
        const c = model_paint.faceColor(f).?;
        try testing.expectEqual(base[f][0], c[0]);
        try testing.expectEqual(base[f][1], c[1]);
        try testing.expectEqual(base[f][2], c[2]);
    }

    // And the additive-pile shape (click every face with shift), same assertion.
    f = 0;
    while (f < 12) : (f += 2) _ = selectFaceByIndex(f, true);
    clearSelection();
    f = 0;
    while (f < 12) : (f += 1) {
        const c = model_paint.faceColor(f).?;
        try testing.expectEqual(base[f][0], c[0]);
        try testing.expectEqual(base[f][1], c[1]);
        try testing.expectEqual(base[f][2], c[2]);
    }
}

// ── Live mirror editing (req_2758) ────────────────────────────────────────────────

/// Index of the welded vertex sitting (exactly) at `p`, or null.
fn findVertAt(p: [3]f32) ?u32 {
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        const v = vertPos(i);
        if (@abs(v[0] - p[0]) < 0.001 and @abs(v[1] - p[1]) < 0.001 and @abs(v[2] - p[2]) < 0.001) return i;
    }
    return null;
}

test "mirror X: translating a vertex drags its position twin to the reflected spot" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    model_paint.setTarget(790, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        setMirrorMask(0);
    }
    setMirrorMask(1); // X plane
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -0.5, -0.5, -0.5 }).?;
    const ti = findVertAt(.{ 0.5, -0.5, -0.5 }).?;
    g_sel_vert.?[vi] = true;

    const m = translateSelection(.{ 0, 0.25, 0 });
    try testing.expect(m.changed);
    // The selected vertex moved up…
    try testing.expectApproxEqAbs(@as(f32, -0.25), vertPos(vi)[1], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(vi)[0], 0.0001);
    // …and its X-twin followed, reflected (same y/z, opposite x untouched at +0.5).
    try testing.expectApproxEqAbs(@as(f32, -0.25), vertPos(ti)[1], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0.5), vertPos(ti)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(ti)[2], 0.0001);

    // The displayed soup carries the twin's move too (its faces are in the mutation).
    const pos = model_paint.positions().?;
    var found = false;
    var c: usize = 0;
    while (c + 2 < pos.len) : (c += 3) {
        if (@abs(pos[c] - 0.5) < 0.001 and @abs(pos[c + 1] + 0.25) < 0.001 and @abs(pos[c + 2] + 0.5) < 0.001) found = true;
    }
    try testing.expect(found);
}

test "mirror Y is the workspace-origin plane — an off-origin part does not self-mirror" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    var i: usize = 0;
    while (i + 1 < soup.len) : (i += 8) {
        soup[i + 1] += 3.0;
    }
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    model_source.setFaceGroups(groups[0..]);
    model_source.setPartRanges(&[_]u32{ 0, 6 });
    model_paint.setTarget(795, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        setMirrorMask(0);
    }
    setMirrorMask(2); // Y plane at workspace y=0 — nothing sits across it from this cube.
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -0.5, 3.5, -0.5 }).?;
    const ti = findVertAt(.{ -0.5, 2.5, -0.5 }).?;
    g_sel_vert.?[vi] = true;

    const m = translateSelection(.{ 0, 0.25, 0 });
    try testing.expect(m.changed);
    try testing.expectApproxEqAbs(@as(f32, 3.75), vertPos(vi)[1], 0.0001);
    // y=2.5 is NOT the reflection of y=3.5 across the origin plane — it stays put.
    // (The old part-bounds-center plane dragged it, and drifted on every one-sided edit.)
    try testing.expectApproxEqAbs(@as(f32, 2.5), vertPos(ti)[1], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(ti)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(ti)[2], 0.0001);
}

test "mirror X: one-sided geometry cannot drift the plane (req_3795)" {
    // The chair-arm failure distilled: a cube symmetric about x=0 grows a one-sided
    // detail far out on +X. A bounds-derived plane would shift to the new midpoint and
    // unpair every twin; the origin plane keeps the cube mirroring exactly as before.
    var soup: [13 * 3 * 8]f32 = undefined;
    buildCubeSoup(soup[0 .. 12 * 3 * 8]);
    const arm = [3][3]f32{ .{ 2.0, 0.3, 0.1 }, .{ 2.2, 0.5, 0.1 }, .{ 2.4, 0.1, 0.2 } };
    for (arm, 0..) |p, corner| {
        const base = (12 * 3 + corner) * 8;
        soup[base + 0] = p[0];
        soup[base + 1] = p[1];
        soup[base + 2] = p[2];
        @memset(soup[base + 3 .. base + 8], 0);
    }
    model_paint.setTarget(797, soup[0..], 39);
    defer {
        reset();
        model_paint.clear();
        setMirrorMask(0);
    }
    setMirrorMask(1); // X plane
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -0.5, -0.5, -0.5 }).?;
    g_sel_vert.?[vi] = true;

    const m = translateSelection(.{ 0, 0.25, 0 });
    try testing.expect(m.changed);
    // The +X twin followed across x=0 even though the mesh bounds midpoint is now +0.7.
    try testing.expect(findVertAt(.{ 0.5, -0.25, -0.5 }) != null);
    // The one-sided arm itself never moved.
    try testing.expect(findVertAt(.{ 2.0, 0.3, 0.1 }) != null);
}

test "mirror X pairs across outliner parts — a mirror-duplicated part follows its twin part" {
    var first: [12 * 3 * 8]f32 = undefined;
    var second: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&first);
    buildCubeSoup(&second);
    var corner: usize = 0;
    while (corner < 12 * 3) : (corner += 1) {
        first[corner * 8 + 0] -= 2;
        second[corner * 8 + 0] += 2;
    }
    var soup: [24 * 3 * 8]f32 = undefined;
    @memcpy(soup[0..first.len], first[0..]);
    @memcpy(soup[first.len..], second[0..]);
    var groups: [24]u32 = undefined;
    for (0..12) |face| {
        groups[face] = @intCast(face / 2);
        groups[12 + face] = @intCast(6 + face / 2);
    }
    model_source.setFaceGroups(groups[0..]);
    model_source.setPartRanges(&.{ 0, 6, 6, 12 });
    model_paint.setTarget(798, soup[0..], 72);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        setMirrorMask(0);
    }
    setMirrorMask(1); // X plane
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -2.5, -0.5, -0.5 }).?; // left cube, part 0
    g_sel_vert.?[vi] = true;

    const m = translateSelection(.{ 0, 0.25, 0 });
    try testing.expect(m.changed);
    // Its reflection lives in the OTHER part and still followed.
    try testing.expect(findVertAt(.{ 2.5, -0.25, -0.5 }) != null);
}

test "symmetry report measures scoped vertices against the shared origin plane" {
    var first: [12 * 3 * 8]f32 = undefined;
    var second: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&first);
    buildCubeSoup(&second);
    var corner: usize = 0;
    while (corner < 12 * 3) : (corner += 1) {
        second[corner * 8 + 0] += 20;
        second[corner * 8 + 1] += 3;
    }
    var soup: [24 * 3 * 8]f32 = undefined;
    @memcpy(soup[0..first.len], first[0..]);
    @memcpy(soup[first.len..], second[0..]);
    var groups: [24]u32 = undefined;
    for (0..12) |face| {
        groups[face] = @intCast(face / 2);
        groups[12 + face] = @intCast(6 + face / 2);
    }
    model_source.setFaceGroups(groups[0..]);
    model_source.setPartRanges(&.{ 0, 6, 6, 12 });
    model_paint.setTarget(796, soup[0..], 72);
    defer {
        resetForModelLoad();
        model_paint.clear();
        model_source.clear();
    }

    // Focused scope: the origin-centered cube is symmetric about x=0 — nothing unmatched.
    setEditScope(0, 6);
    const focused = symmetryReportPub(0).?;
    try testing.expectEqual(@as(f32, 0), focused[0]);
    try testing.expectEqual(@as(f32, 0), focused[1]);
    try testing.expectEqual(@as(f32, 8), focused[2]);

    // Whole model: the second cube sits entirely at x≈20 with no reflection across x=0,
    // so the report honestly counts all 8 of its vertices as unmatched. (The old
    // per-part bounds plane called it symmetric — the drift the report exists to catch.)
    setEditScope(0, 0);
    const whole = symmetryReportPub(0).?;
    try testing.expectEqual(@as(f32, 8), whole[1]);
    try testing.expectEqual(@as(f32, 16), whole[2]);
}

test "mirror X+Y: a moved corner carries its X, Y, and XY-diagonal twins" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    model_paint.setTarget(791, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        setMirrorMask(0);
    }
    setMirrorMask(3); // X and Y planes
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -0.5, -0.5, -0.5 }).?;
    g_sel_vert.?[vi] = true;

    _ = translateSelection(.{ 0, 0, -0.25 });
    // All four symmetric corners on z=-0.5 slid to z=-0.75.
    try testing.expect(findVertAt(.{ -0.5, -0.5, -0.75 }) != null);
    try testing.expect(findVertAt(.{ 0.5, -0.5, -0.75 }) != null); // X twin
    try testing.expect(findVertAt(.{ -0.5, 0.5, -0.75 }) != null); // Y twin
    try testing.expect(findVertAt(.{ 0.5, 0.5, -0.75 }) != null); // XY diagonal twin
    // The far z=+0.5 corners did NOT move (Z mirror is off).
    try testing.expect(findVertAt(.{ -0.5, -0.5, 0.5 }) != null);
}

test "mirror off: the twin stays put (no accidental symmetry)" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    model_paint.setTarget(792, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        setMirrorMask(0);
    }
    setMirrorMask(0);
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -0.5, -0.5, -0.5 }).?;
    const ti = findVertAt(.{ 0.5, -0.5, -0.5 }).?;
    g_sel_vert.?[vi] = true;
    _ = translateSelection(.{ 0, 0.25, 0 });
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(ti)[1], 0.0001);
}

test "mirror X: a selection containing BOTH twins transforms each directly (no double-write)" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    model_paint.setTarget(793, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        setMirrorMask(0);
    }
    setMirrorMask(1);
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const vi = findVertAt(.{ -0.5, -0.5, -0.5 }).?;
    const ti = findVertAt(.{ 0.5, -0.5, -0.5 }).?;
    g_sel_vert.?[vi] = true;
    g_sel_vert.?[ti] = true;
    _ = translateSelection(.{ 0.25, 0, 0 });
    // Both selected verts slid +x as ONE rigid selection — the mirror never re-reflected
    // a selected twin back over the plane.
    try testing.expectApproxEqAbs(@as(f32, -0.25), vertPos(vi)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0.75), vertPos(ti)[0], 0.0001);
}
