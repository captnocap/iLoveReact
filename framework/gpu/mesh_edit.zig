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
// topology into an index table. A whole-part correspondence is resolved first: same-part
// symmetry or one unique cross-part owner with majority reflected coverage. Individual
// vertices then pair only inside that owner. This prevents coincident seam vertices in an
// unrelated body/door from stealing a detached bumper's mirror target — so a vertex stays paired through the
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

/// Every input refreshCameraVisibility reads. Equal keys ⇒ the masks and the occlusion
/// grid it would build are byte-identical to the ones already standing, so the build is
/// skipped. Selection is deliberately absent: the masks answer "can the camera see it",
/// never "is it chosen". Adding an input to the refresh means adding it HERE, or the
/// overlay silently keeps drawing a stale answer.
const CameraVisibilityKey = struct {
    geometry_rev: u64,
    face_count: u32,
    vert_count: u32,
    edge_count: u32,
    scope: u64,
    xray: bool,
    eye: [3]f32,
    target: [3]f32,
    fov_deg: f32,
    vp_w: f32,
    vp_h: f32,
};
var g_vis_key: ?CameraVisibilityKey = null;

// ── Overlay occlusion depth buffer (Surface mode, req_3856/3859/3867) ──────────
// A small CPU depth buffer rebuilt by refreshCameraVisibility: every front-facing
// triangle of the resident mesh (scope-independent — anything rendered occludes,
// the same rule picking's model_paint.occluded applies) is RASTERIZED at ~1/3
// screen resolution, storing the nearest 1/depth per texel. A world point is
// hidden only when EVERY texel in its one-texel neighborhood holds a strictly
// nearer surface. This is what the user's eye actually tests: the buffer holds
// the same surface the render shows at that pixel, so far-side geometry can
// never leak through a grazing panel (an interpolated-plane test with scalar
// slack could — req_3861's slope bias overshot exactly there, req_3867), while
// markers within a texel of a silhouette survive via the neighborhood's
// background/far texels.
const OCC_BUF_SCALE: f32 = 3.0; // buffer texels are this many real screen pixels
const OCC_BUF_MAX_DIM: u32 = 1024;
const OCC_DEPTH_SLACK: f32 = 0.005; // relative — a texel must be nearer by more than this to hide
const OCC_RASTER_EDGE_SLACK: f32 = 1e-6; // texel-center inside test; shared edges may double-write

var g_occ_depth: []f32 = &.{}; // 1/view-depth per texel, 0 = empty/background
var g_occ_bw: u32 = 0;
var g_occ_bh: u32 = 0;
var g_occ_ready: bool = false;
var g_occ_cam: model_paint.Camera = .{ .eye = .{ 0, 0, 0 }, .target = .{ 0, 0, 1 }, .fov_deg = 50 };

fn occBufferDim(vp_px: f32) u32 {
    const dim = @floor(vp_px / OCC_BUF_SCALE);
    if (dim < 1) return 1;
    if (dim >= @as(f32, @floatFromInt(OCC_BUF_MAX_DIM))) return OCC_BUF_MAX_DIM;
    return @intFromFloat(dim);
}

/// Rasterize the mesh's front-facing triangles into the overlay depth buffer for
/// `cam`. False (buffer unusable) on no mesh, degenerate viewport, or OOM —
/// callers then skip occlusion pruning and Surface mode degrades to back-face culls.
fn occBuildDepth(cam: model_paint.Camera, vp_w: f32, vp_h: f32) bool {
    g_occ_ready = false;
    const pos = model_paint.positions() orelse return false;
    const fc = model_paint.faceCount();
    if (fc == 0 or vp_w <= 0 or vp_h <= 0) return false;
    const bw = occBufferDim(vp_w);
    const bh = occBufferDim(vp_h);
    const texels = @as(usize, bw) * @as(usize, bh);
    if (g_occ_depth.len < texels) {
        if (g_occ_depth.len > 0) alloc.free(g_occ_depth);
        g_occ_depth = alloc.alloc(f32, texels) catch {
            g_occ_depth = &.{};
            return false;
        };
    }
    const depth = g_occ_depth[0..texels];
    @memset(depth, 0);
    const bw_f = @as(f32, @floatFromInt(bw));
    const bh_f = @as(f32, @floatFromInt(bh));
    var face: u32 = 0;
    while (face < fc) : (face += 1) {
        const base = @as(usize, face) * 9;
        if (base + 8 >= pos.len) break;
        if (!faceCameraFacing(cam, face)) continue; // only front faces visibly occlude
        // A triangle with a corner behind the near plane cannot project coherently —
        // it is dropped, degrading (conservatively) to visible markers when the
        // camera is inside the geometry.
        const a = model_paint.projectDepth(cam, bw_f, bh_f, .{ pos[base + 0], pos[base + 1], pos[base + 2] }) orelse continue;
        const b = model_paint.projectDepth(cam, bw_f, bh_f, .{ pos[base + 3], pos[base + 4], pos[base + 5] }) orelse continue;
        const c = model_paint.projectDepth(cam, bw_f, bh_f, .{ pos[base + 6], pos[base + 7], pos[base + 8] }) orelse continue;
        const denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (@abs(denom) < 1e-9) continue; // zero-area sliver covers nothing
        const ia = 1.0 / a[2];
        const ib = 1.0 / b[2];
        const ic = 1.0 / c[2];
        const min_x = @min(a[0], @min(b[0], c[0]));
        const max_x = @max(a[0], @max(b[0], c[0]));
        const min_y = @min(a[1], @min(b[1], c[1]));
        const max_y = @max(a[1], @max(b[1], c[1]));
        if (max_x < 0 or max_y < 0 or min_x >= bw_f or min_y >= bh_f) continue;
        const tx0: u32 = @intFromFloat(@max(0, @floor(min_x)));
        const tx1: u32 = @min(bw - 1, @as(u32, @intFromFloat(@max(0, @ceil(max_x)))));
        const ty0: u32 = @intFromFloat(@max(0, @floor(min_y)));
        const ty1: u32 = @min(bh - 1, @as(u32, @intFromFloat(@max(0, @ceil(max_y)))));
        var ty = ty0;
        while (ty <= ty1) : (ty += 1) {
            const py = @as(f32, @floatFromInt(ty)) + 0.5;
            var tx = tx0;
            while (tx <= tx1) : (tx += 1) {
                const px = @as(f32, @floatFromInt(tx)) + 0.5;
                const w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / denom;
                const w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / denom;
                const w2 = 1.0 - w0 - w1;
                if (w0 < -OCC_RASTER_EDGE_SLACK or w1 < -OCC_RASTER_EDGE_SLACK or w2 < -OCC_RASTER_EDGE_SLACK) continue;
                // 1/depth interpolates linearly in screen space (perspective-correct).
                const inv_z = w0 * ia + w1 * ib + w2 * ic;
                const slot = &depth[@as(usize, ty) * bw + tx];
                if (inv_z > slot.*) slot.* = inv_z;
            }
        }
    }
    g_occ_bw = bw;
    g_occ_bh = bh;
    g_occ_cam = cam;
    g_occ_ready = true;
    return true;
}

/// Is world point `p` hidden behind the rasterized surface, per the depth buffer
/// the last refreshCameraVisibility built? False when no buffer is live (X-Ray,
/// no mesh). Hidden requires EVERY texel of the 3×3 neighborhood to hold a
/// strictly nearer surface: a point on its own visible surface always finds its
/// own (equal-depth) texel, a point within a texel of a silhouette finds the
/// background/far texel beyond the rim, and a point on the model's other side
/// finds nothing but nearer hull — exactly the split the eye expects.
fn occPointHidden(p: [3]f32) bool {
    if (!g_occ_ready or g_occ_bw == 0 or g_occ_bh == 0) return false;
    const bw_f = @as(f32, @floatFromInt(g_occ_bw));
    const bh_f = @as(f32, @floatFromInt(g_occ_bh));
    const sp = model_paint.projectDepth(g_occ_cam, bw_f, bh_f, p) orelse return false;
    // Off-buffer projections are off-viewport too: the scissor, marquee rect, and
    // click point are all inside the pane, so "visible" is free and harmless.
    if (sp[0] < 0 or sp[0] >= bw_f or sp[1] < 0 or sp[1] >= bh_f) return false;
    const piz = 1.0 / sp[2];
    const tol = piz * OCC_DEPTH_SLACK + 1e-7;
    const cx: i64 = @intFromFloat(@floor(sp[0]));
    const cy: i64 = @intFromFloat(@floor(sp[1]));
    var dy: i64 = -1;
    while (dy <= 1) : (dy += 1) {
        const ty = cy + dy;
        if (ty < 0 or ty >= g_occ_bh) return false; // rim of the pane counts as open
        var dx: i64 = -1;
        while (dx <= 1) : (dx += 1) {
            const tx = cx + dx;
            if (tx < 0 or tx >= g_occ_bw) return false;
            const d = g_occ_depth[@as(usize, @intCast(ty)) * g_occ_bw + @as(usize, @intCast(tx))];
            if (d <= piz + tol) return false; // farther/equal surface or background → seen
        }
    }
    return true;
}

/// Overlay-grade occlusion for arbitrary world points (face-mode dots and tint
/// centroids in 3d.zig) against the buffer refreshCameraVisibility built this frame.
pub fn overlayPointOccludedPub(p: [3]f32) bool {
    return occPointHidden(p);
}

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

/// True when the twin edge exists with the SAME face incidence as its source edge.
/// A mirrored op must mean the same thing on both sides: a bridge or extrusion built
/// from an OPEN source edge (one incident face) must not land on a filled side (two),
/// where the identical construction would stack duplicate coincident geometry no
/// click or camera can untangle (req_3843). Matching incidence instead of demanding
/// openness keeps deliberate authored-seam ops bilateral.
pub fn twinEdgeMatchesSourcePub(source: Edge, t0: u32, t1: u32) bool {
    if (!ensureTopology()) return false;
    const src = edgeIndexBetween(source[0], source[1]) orelse return false;
    const twin = edgeIndexBetween(t0, t1) orelse return false;
    return edgeFaceIncidencePub(twin) == edgeFaceIncidencePub(src);
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
/// (vp_w, vp_h) is the REAL viewport: edge occlusion samples are concentrated on
/// the on-screen span of each edge, so a zoomed-in edge whose endpoints are far
/// off-screen (or hidden) still draws where you can actually see it (req_3859).
pub fn refreshCameraVisibility(cam: model_paint.Camera, vp_w: f32, vp_h: f32) bool {
    if (!ensureTopology()) return false;
    // The masks and the occlusion grid are a pure function of this key, and the whole
    // build is screen-AREA work: rasterizing every front face plus walking every edge's
    // on-screen span. Zoomed in on a dense mesh that is milliseconds a frame, and the
    // overlay asked for it 240 times a second at a parked camera (req_4198). Recompute
    // only when an input actually moved.
    const key = CameraVisibilityKey{
        .geometry_rev = model_paint.geometryRevision(),
        .face_count = model_paint.faceCount(),
        .vert_count = g_vert_count,
        .edge_count = g_edge_count,
        .scope = scopeSignature(),
        .xray = g_xray,
        .eye = cam.eye,
        .target = cam.target,
        .fov_deg = cam.fov_deg,
        .vp_w = vp_w,
        .vp_h = vp_h,
    };
    if (g_vis_key) |built| {
        if (std.meta.eql(built, key) and
            g_camera_visible_vert != null and g_camera_visible_vert.?.len == g_vert_count and
            g_camera_visible_edge != null and g_camera_visible_edge.?.len == g_edge_count) return true;
    }
    g_vis_key = null; // a failed build must not be mistaken for a cached one
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
        g_occ_ready = false; // X-Ray: nothing is hidden — face dots consult this too
        g_vis_key = key;
        return true;
    }

    const corners = g_corner_vert orelse return false;
    const face_count = model_paint.faceCount();
    // Pass 1: face-touch candidates — every corner of a front-facing in-scope face.
    // This back-face mask is the edge precondition even where occlusion later prunes
    // the vertex markers themselves, so keep it separate from the final mask.
    const touched = alloc.alloc(bool, g_vert_count) catch return false;
    defer alloc.free(touched);
    @memset(touched, false);
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (!faceInScope(face) or !faceCameraFacing(cam, face)) continue;
        var corner: u32 = 0;
        while (corner < 3) : (corner += 1) {
            const vertex = corners[face * 3 + corner];
            if (vertex < touched.len) touched[vertex] = true;
        }
    }
    // Pass 2 (req_3856): Surface mode hides what the surface hides — a camera-facing
    // vertex sitting BEHIND a nearer front face (greebles under a hull, the model's
    // far side) must not draw or catch marquees, the same rule picking already
    // enforces per-click via model_paint.occluded. The depth buffer's one-texel
    // neighborhood keeps silhouette corners honest without any nudge heuristics
    // (req_3867). Buffer build failure degrades to the back-face-only mask.
    if (occBuildDepth(cam, vp_w, vp_h)) {
        var vertex: u32 = 0;
        while (vertex < g_vert_count) : (vertex += 1) {
            if (touched[vertex] and !occPointHidden(vertPos(vertex))) visible_vertices[vertex] = true;
        }
    } else {
        @memcpy(visible_vertices, touched);
    }
    const edges = g_edges orelse return false;
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        const a = edges[edge * 2];
        const b = edges[edge * 2 + 1];
        // A Pen Edges wire has no surface normal; the wire is the authored object.
        if (edgeIsWirePub(edge)) {
            visible_edges[edge] = true;
            continue;
        }
        if (a >= touched.len or b >= touched.len or !touched[a] or !touched[b]) continue;
        // A visible endpoint marker proves the edge's end is on screen and clear.
        // Otherwise the edge may STILL be visible in its interior — endpoints far
        // off-screen or tucked behind other parts while the middle crosses the view
        // (req_3859) — so walk occlusion samples across its on-screen span.
        visible_edges[edge] = visible_vertices[a] or visible_vertices[b] or
            !g_occ_ready or edgeSpanVisible(cam, vp_w, vp_h, vertPos(a), vertPos(b));
    }
    g_vis_key = key;
    return true;
}

const OCC_EDGE_NEAR_Z: f32 = 1e-3; // view-depth near clip for edge span sampling
const OCC_EDGE_SAMPLE_PX: f32 = 48; // one occlusion probe per this many on-screen pixels
const OCC_EDGE_MAX_SAMPLES: u32 = 16;

fn occLerp(a: [3]f32, b: [3]f32, t: f32) [3]f32 {
    return .{ a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t };
}

fn occViewDepth(cam: model_paint.Camera, p: [3]f32) f32 {
    const fwd = [3]f32{ cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2] };
    const len = @sqrt(fwd[0] * fwd[0] + fwd[1] * fwd[1] + fwd[2] * fwd[2]);
    if (len < 1e-9) return 0;
    return ((p[0] - cam.eye[0]) * fwd[0] + (p[1] - cam.eye[1]) * fwd[1] + (p[2] - cam.eye[2]) * fwd[2]) / len;
}

/// Is any point of segment (a,b) unoccluded within the real viewport? Clips the
/// segment to the near plane and the viewport rect, then probes occlusion at
/// screen-uniform steps mapped back to world perspective-correctly. Samples lie ON
/// the edge's incident surfaces, so occPointHidden's own-face slack keeps honest
/// samples clear; only genuinely covering geometry hides them.
fn edgeSpanVisible(cam: model_paint.Camera, vp_w: f32, vp_h: f32, a: [3]f32, b: [3]f32) bool {
    if (vp_w <= 0 or vp_h <= 0) return false;
    const za = occViewDepth(cam, a);
    const zb = occViewDepth(cam, b);
    if (za <= OCC_EDGE_NEAR_Z and zb <= OCC_EDGE_NEAR_Z) return false; // fully behind the camera
    // Clip to the near plane in world parameter space (view depth is linear in t).
    var t0: f32 = 0;
    var t1: f32 = 1;
    if (za < OCC_EDGE_NEAR_Z) t0 = (OCC_EDGE_NEAR_Z - za) / (zb - za);
    if (zb < OCC_EDGE_NEAR_Z) t1 = (OCC_EDGE_NEAR_Z - za) / (zb - za);
    if (t1 <= t0) return false;
    const wa = occLerp(a, b, t0);
    const wb = occLerp(a, b, t1);
    const pa = model_paint.projectDepth(cam, vp_w, vp_h, wa) orelse return false;
    const pb = model_paint.projectDepth(cam, vp_w, vp_h, wb) orelse return false;
    // Clip the projected segment to the viewport rect (Liang–Barsky, screen params).
    var s0: f32 = 0;
    var s1: f32 = 1;
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const bounds = [4][2]f32{
        .{ -dx, pa[0] - 0 },
        .{ dx, vp_w - pa[0] },
        .{ -dy, pa[1] - 0 },
        .{ dy, vp_h - pa[1] },
    };
    for (bounds) |edge_clip| {
        const p = edge_clip[0];
        const q = edge_clip[1];
        if (@abs(p) < 1e-9) {
            if (q < 0) return false; // parallel and outside
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > s1) return false;
            if (r > s0) s0 = r;
        } else {
            if (r < s0) return false;
            if (r < s1) s1 = r;
        }
    }
    if (s1 <= s0) return false;
    const span_px = @sqrt(dx * dx + dy * dy) * (s1 - s0);
    const samples: u32 = @min(OCC_EDGE_MAX_SAMPLES, 2 + @as(u32, @intFromFloat(span_px / OCC_EDGE_SAMPLE_PX)));
    var k: u32 = 0;
    while (k < samples) : (k += 1) {
        const s = s0 + (s1 - s0) * (@as(f32, @floatFromInt(k)) + 0.5) / @as(f32, @floatFromInt(samples));
        // Perspective-correct screen→world parameter within the near-clipped span.
        const zca = pa[2];
        const zcb = pb[2];
        const denom = zcb + s * (zca - zcb);
        if (@abs(denom) < 1e-9) continue;
        const u = s * zca / denom;
        if (!occPointHidden(occLerp(wa, wb, u))) return true;
    }
    return false;
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
    /// A crease whose incident planes are nearly antiparallel has an unbounded exact
    /// miter: the offset goes as thickness / sin(dihedral/2). Cap the displacement at
    /// this multiple of the requested thickness so a knife edge thickens instead of
    /// spiking. A closed cube corner needs sqrt(3) ~= 1.7321, so 2.0 leaves every
    /// well-conditioned corner exact and only bites on the degenerate ones.
    pub const miter_limit: f32 = 2.0;
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
        const length = @sqrt(x0 * x0 + x1 * x1 + x2 * x2);
        const limit = @as(f64, SolidifyTuning.miter_limit) * @as(f64, thickness);
        if (length > limit and length > 0) {
            const scale = limit / length;
            return .{ @floatCast(x0 * scale), @floatCast(x1 * scale), @floatCast(x2 * scale) };
        }
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

/// Count selected edges inside the active Outliner scope. Raw selection bits remain
/// readable through selectionSnapshotJson so the surgery UI can diagnose stale owners,
/// but topology tools may never consume an edge from a sibling part.
pub fn selectedEdgeCountPub() u32 {
    if (!ensureTopology()) return 0;
    const selected = g_sel_edge orelse return 0;
    var count: u32 = 0;
    var edge: u32 = 0;
    while (edge < selected.len and edge < g_edge_count) : (edge += 1) {
        if (selected[edge] and edgeInScopePub(edge)) count += 1;
    }
    return count;
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

/// Copy the active scope's selected edges into `out`.
pub fn selectedEdgesPub(out: []Edge) u32 {
    if (!ensureTopology()) return 0;
    const sel = g_sel_edge orelse return 0;
    const edges = g_edges orelse return 0;
    var n: u32 = 0;
    var e: u32 = 0;
    while (e < sel.len and e < g_edge_count) : (e += 1) {
        if (!sel[e] or !edgeInScopePub(e)) continue;
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
        if (!sel[e] or !edgeInScopePub(e)) continue;
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

/// One authoritative outliner-part owner for the in-scope selected-edge set.
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
        if (!selected[edge] or !edgeInScopePub(edge)) continue;
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
        if (!selected[edge] or !edgeInScopePub(edge)) continue;
        const frame = edgeExtrusionFramePub(edge) orelse return null;
        if (count > 0 and vecDot(sum, frame.face_normal) <= 0) return null;
        sum = vecAdd(sum, frame.face_normal);
        count += 1;
    }
    if (count == 0) return null;
    const normal = vecNorm(sum);
    return if (vecDot(normal, normal) >= 0.5) normal else null;
}

/// The edge index running between two logical vertices, if one exists. Edges are
/// stored lo,hi like hasEdgeBetweenPub reads them.
fn edgeIndexBetween(a: u32, b: u32) ?u32 {
    const ed = g_edges orelse return null;
    const lo = @min(a, b);
    const hi = @max(a, b);
    var e: u32 = 0;
    while (@as(usize, e) * 2 + 1 < ed.len) : (e += 1) {
        if (ed[e * 2] == lo and ed[e * 2 + 1] == hi) return e;
    }
    return null;
}

/// Winding reference for a two-edge bridge whose OWN neighbors disagree (req_3840).
/// A bridge across a recess or ≥90° corner selects the two flank walls, whose
/// normals oppose — but the quad it closes has two OTHER edges, and when those both
/// already exist as legal boundary edges whose adjacent faces agree, that agreement
/// carries the winding: the same quad built from the passing opposite pair. Both
/// SELECTED edges must still be legal boundary edges on their own — this rescues
/// only the disagreement rejection, never an interior or out-of-scope selection.
pub fn bridgeCrossReferenceNormalPub(sel0: Edge, sel1: Edge, cross0: Edge, cross1: Edge) ?[3]f32 {
    if (!ensureTopology()) return null;
    inline for (.{ sel0, sel1 }) |sel| {
        const sel_edge = edgeIndexBetween(sel[0], sel[1]) orelse return null;
        _ = edgeExtrusionFramePub(sel_edge) orelse return null;
    }
    const f0 = edgeExtrusionFramePub(edgeIndexBetween(cross0[0], cross0[1]) orelse return null) orelse return null;
    const f1 = edgeExtrusionFramePub(edgeIndexBetween(cross1[0], cross1[1]) orelse return null) orelse return null;
    if (vecDot(f0.face_normal, f1.face_normal) <= 0) return null;
    const normal = vecNorm(vecAdd(f0.face_normal, f1.face_normal));
    return if (vecDot(normal, normal) >= 0.5) normal else null;
}

/// The direction in which the sole incident triangle traverses a boundary edge,
/// expressed relative to the caller's endpoint order. A manifold boundary owns
/// exactly one such directed use; interior, missing, or out-of-scope edges have no
/// usable circulation.
fn boundaryFaceRunsEdgeForward(edge: Edge) ?bool {
    const edge_idx = edgeIndexBetween(edge[0], edge[1]) orelse return null;
    if (!edgeIsBoundaryPub(edge_idx) or !edgeInScopePub(edge_idx)) return null;
    const corners = g_corner_vert orelse return null;
    const face_count = model_paint.faceCount();
    if (corners.len < @as(usize, face_count) * 3) return null;

    var found: ?bool = null;
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        const base = @as(usize, face) * 3;
        var side: usize = 0;
        while (side < 3) : (side += 1) {
            const a = corners[base + side];
            const b = corners[base + ((side + 1) % 3)];
            const forward = a == edge[0] and b == edge[1];
            const reverse = a == edge[1] and b == edge[0];
            if (!forward and !reverse) continue;
            if (found != null) return null;
            found = forward;
        }
    }
    return found;
}

fn loopRunsEdgeForward(loop: [4]u32, edge: Edge) ?bool {
    var side: usize = 0;
    while (side < loop.len) : (side += 1) {
        const a = loop[side];
        const b = loop[(side + 1) % loop.len];
        if (a == edge[0] and b == edge[1]) return true;
        if (a == edge[1] and b == edge[0]) return false;
    }
    return null;
}

/// The candidate quad's own surface normal, signed by whether its written order is
/// the one to keep. Degenerate loops have no usable normal and reject.
fn candidateLoopNormal(candidate: [4]u32, keep: bool) ?[3]f32 {
    const a = vertPosPub(candidate[0]);
    const b = vertPosPub(candidate[1]);
    const c = vertPosPub(candidate[2]);
    const d = vertPosPub(candidate[3]);
    const area_normal = vecAdd(
        vecCross(vecSub(b, a), vecSub(c, a)),
        vecCross(vecSub(c, a), vecSub(d, a)),
    );
    const normal = vecNorm(area_normal);
    if (vecDot(normal, normal) < 0.5) return null;
    return if (keep) normal else vecMul(normal, -1);
}

fn sameUndirectedEdge(a: Edge, b: Edge) bool {
    return (a[0] == b[0] and a[1] == b[1]) or (a[0] == b[1] and a[1] == b[0]);
}

/// Final Create Face winding authority for a valid two-edge boundary bridge when
/// neither opposite neighbor-normal pair agrees. Surface normals can legitimately
/// conflict around a corner transition; boundary circulation cannot. The candidate
/// face must traverse both selected manifold edges opposite to their sole incident
/// triangles. If those two constraints disagree, the bridge remains ambiguous and
/// is rejected instead of minting an inconsistently wound face.
pub fn bridgeBoundaryReferenceNormalPub(sel0: Edge, sel1: Edge, candidate: [4]u32) ?[3]f32 {
    if (!ensureTopology()) return null;
    var keep_candidate: ?bool = null;
    inline for (.{ sel0, sel1 }) |edge| {
        _ = edgeExtrusionFramePub(edgeIndexBetween(edge[0], edge[1]) orelse return null) orelse return null;
        const adjacent_forward = boundaryFaceRunsEdgeForward(edge) orelse return null;
        const candidate_forward = loopRunsEdgeForward(candidate, edge) orelse return null;
        const keep = adjacent_forward != candidate_forward;
        if (keep_candidate) |agreed| {
            if (agreed != keep) return null;
        } else {
            keep_candidate = keep;
        }
    }
    return candidateLoopNormal(candidate, keep_candidate orelse return null);
}

/// Winding taken from a side the new face ALREADY SHARES with the mesh (req_4204).
/// Two selected boundary edges joined by a third edge are not an ambiguous bridge:
/// that edge is a side of the quad, it already carries a face, and the new face must
/// traverse it opposite to that face. Nothing about the selected pair can overrule a
/// side that is physically there — a disagreement between the two selected edges only
/// means one of THEM is inside-out, and refusing the fill leaves the hole instead of
/// closing it against the surface it actually touches.
///
/// This exists because `bridgeCrossReferenceNormalPub` demands BOTH of the quad's
/// other sides AND agreeing normals across them, so it goes silent on the ordinary
/// case of exactly one connecting edge. Here every non-selected side that exists as a
/// manifold boundary votes; absent, interior, and non-manifold sides abstain rather
/// than reject, and the surviving votes must agree.
pub fn bridgeConnectingSideReferenceNormalPub(sel0: Edge, sel1: Edge, candidate: [4]u32) ?[3]f32 {
    if (!ensureTopology()) return null;
    inline for (.{ sel0, sel1 }) |edge| {
        _ = edgeExtrusionFramePub(edgeIndexBetween(edge[0], edge[1]) orelse return null) orelse return null;
    }
    var keep_candidate: ?bool = null;
    var side: usize = 0;
    while (side < candidate.len) : (side += 1) {
        const edge: Edge = .{ candidate[side], candidate[(side + 1) % candidate.len] };
        if (sameUndirectedEdge(edge, sel0) or sameUndirectedEdge(edge, sel1)) continue;
        const adjacent_forward = boundaryFaceRunsEdgeForward(edge) orelse continue;
        const candidate_forward = loopRunsEdgeForward(candidate, edge) orelse continue;
        const keep = adjacent_forward != candidate_forward;
        if (keep_candidate) |agreed| {
            if (agreed != keep) return null;
        } else {
            keep_candidate = keep;
        }
    }
    return candidateLoopNormal(candidate, keep_candidate orelse return null);
}

pub const ExtrudeTuning = struct {
    pub const maximum_absolute_angle_degrees: f32 = 89.0;
    pub const angle_epsilon_radians: f32 = 1.0e-7;
    pub const minimum_radial_radius: f32 = 1.0e-6;
    pub const minimum_face_scale: f32 = 1.0 / 1024.0;
};

/// Strict angle boundary shared by edge departure and face draft. Angles at or
/// beyond 90 degrees fold the new walls back across the source topology.
pub fn extrusionAngleRadiansPub(angle_degrees: f32) ?f32 {
    if (!std.math.isFinite(angle_degrees) or
        @abs(angle_degrees) > ExtrudeTuning.maximum_absolute_angle_degrees)
    {
        return null;
    }
    return angle_degrees * std.math.pi / 180.0;
}

/// Geometry needed to extend one selected edge without inventing a perpendicular
/// flap. Zero angle stays in the adjacent authored face's plane. A signed angle
/// tilts the new strip toward/away from that face's front while keeping the outer
/// edge parallel to the source edge.
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

    pub fn outerAtAngleRadians(self: EdgeExtrusionFrame, distance: f32, angle_radians: f32) [2][3]f32 {
        if (@abs(angle_radians) <= ExtrudeTuning.angle_epsilon_radians) return self.outer(distance);
        const direction = vecNorm(vecAdd(
            vecMul(self.outward, @cos(angle_radians)),
            vecMul(self.face_normal, @sin(angle_radians)),
        ));
        return .{
            vecAdd(self.a, vecMul(direction, distance)),
            vecAdd(self.b, vecMul(direction, distance)),
        };
    }
};

pub const AnchoredEdgeExtrusion = struct {
    outer: [2][3]f32,
    shared_index: u1,
    open_index: u1,
    triangle: bool,
};

/// Replace one outer corner of an ordinary edge extrusion with a selected
/// resident vertex. Selecting an endpoint explicitly anchors that endpoint and
/// produces one triangle; selecting any other same-part vertex produces a quad
/// that reuses it. The untouched outer corner is the only new open vertex.
pub fn anchoredEdgeExtrusionPub(
    frame: EdgeExtrusionFrame,
    source_vertices: [2]u32,
    target_vertex: u32,
    target_position: [3]f32,
    distance: f32,
    angle_radians: f32,
) AnchoredEdgeExtrusion {
    var outer = frame.outerAtAngleRadians(distance, angle_radians);
    const shared_index: u1 = if (target_vertex == source_vertices[0])
        0
    else if (target_vertex == source_vertices[1])
        1
    else if (vecDot(vecSub(target_position, outer[0]), vecSub(target_position, outer[0])) <=
        vecDot(vecSub(target_position, outer[1]), vecSub(target_position, outer[1])))
        0
    else
        1;
    outer[shared_index] = target_position;
    return .{
        .outer = outer,
        .shared_index = shared_index,
        .open_index = 1 - shared_index,
        .triangle = target_vertex == source_vertices[shared_index],
    };
}

/// Uniform cap scale corresponding to a face draft angle at DISTANCE. Positive
/// draft widens the cap; negative draft narrows it. Null refuses a collapsed or
/// numerically invalid cap before topology is rebuilt.
pub fn faceExtrudeScalePub(max_radius: f32, distance: f32, angle_radians: f32) ?f32 {
    if (!std.math.isFinite(max_radius) or !std.math.isFinite(distance) or
        !std.math.isFinite(angle_radians) or max_radius < ExtrudeTuning.minimum_radial_radius)
    {
        return null;
    }
    if (@abs(angle_radians) <= ExtrudeTuning.angle_epsilon_radians) return 1.0;
    const scale = 1.0 + @tan(angle_radians) * @abs(distance) / max_radius;
    if (!std.math.isFinite(scale) or scale < ExtrudeTuning.minimum_face_scale) return null;
    return scale;
}

/// Move one cap point along NORMAL while uniformly scaling only its in-plane
/// component around CENTER. Keeping the tiny normal residue preserves non-planar
/// authored input instead of flattening it as a side effect of extrusion.
pub fn faceExtrudePointPub(
    point: [3]f32,
    center: [3]f32,
    normal: [3]f32,
    distance: f32,
    scale: f32,
) [3]f32 {
    const relative = vecSub(point, center);
    const normal_component = vecMul(normal, vecDot(relative, normal));
    const tangent_component = vecSub(relative, normal_component);
    return vecAdd(
        center,
        vecAdd(
            vecAdd(vecMul(tangent_component, scale), normal_component),
            vecMul(normal, distance),
        ),
    );
}

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

pub const MeasurementSubject = enum {
    /// The active vertex/edge/face selection wins whenever it affects vertices.
    selection,
    /// With no element selection, an outliner/edit scope measures the focused part(s).
    scope,
    /// Neutral view with no scope measures the complete resident model.
    model,
};

pub const MeasurementBounds = struct {
    subject: MeasurementSubject,
    min: [3]f32,
    max: [3]f32,
    vertex_count: u32,

    pub fn size(self: MeasurementBounds) [3]f32 {
        return .{
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        };
    }
};

/// The one native size subject used by every Studio measurement overlay. Selection
/// outranks focused scope, which outranks the whole model. Walking welded logical
/// vertices keeps triangulation diagonals and duplicate triangle corners from changing
/// the answer; no geometry or per-frame data crosses into React.
pub fn measurementBoundsPub() ?MeasurementBounds {
    if (!ensureTopology()) return null;
    const selection = fillAffectedVerts();
    const subject: MeasurementSubject = if (selection != null)
        .selection
    else if (g_scope_active)
        .scope
    else
        .model;

    var min: [3]f32 = .{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) };
    var max: [3]f32 = .{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) };
    var count: u32 = 0;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        const included = switch (subject) {
            .selection => selection.?[vertex],
            .scope => vertInScopePub(vertex),
            .model => true,
        };
        if (!included) continue;
        const point = vertPosPub(vertex);
        for (0..3) |axis| {
            min[axis] = @min(min[axis], point[axis]);
            max[axis] = @max(max[axis], point[axis]);
        }
        count += 1;
    }
    if (count == 0) return null;
    return .{ .subject = subject, .min = min, .max = max, .vertex_count = count };
}

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
/// How many AUTHORED faces a per-triangle mask covers. A quad is ONE face even though
/// it is two triangles, and a cube is six even though it is twelve (the req_2509
/// vocabulary). Every number a surface prints as "faces" must come through here — a
/// raw triangle count told the user "named 2 faces" when they had selected one quad
/// (req_3888). Loose triangles carry no group and each count as their own face.
pub fn authoredFacesInMask(mask: []const bool) u32 {
    var groups = std.AutoHashMapUnmanaged(u32, void).empty;
    defer groups.deinit(alloc);
    var n: u32 = 0;
    for (mask, 0..) |selected, face| {
        if (!selected) continue;
        const grp = model_source.faceGroupOf(@intCast(face));
        if (grp == model_source.NO_FACE_GROUP) {
            n += 1;
        } else if (!groups.contains(grp)) {
            groups.put(alloc, grp, {}) catch {};
            n += 1;
        }
    }
    return n;
}

/// Count the current authored polygons from one exact displayed-triangle group
/// snapshot. Loose triangles each remain their own authored face. This is the
/// read-side twin of `authoredFacesInMask`, used by resident percepts that must
/// move with topology instead of repeating the document's opening group count.
pub fn authoredFaceCountFromGroups(groups: []const u32) ?u32 {
    var seen = std.AutoHashMapUnmanaged(u32, void).empty;
    defer seen.deinit(alloc);
    var count: u32 = 0;
    for (groups) |group| {
        if (group == model_source.NO_FACE_GROUP) {
            count += 1;
            continue;
        }
        const gop = seen.getOrPut(alloc, group) catch return null;
        if (!gop.found_existing) count += 1;
    }
    return count;
}

fn countSelectedAuthoredFaces() u32 {
    return authoredFacesInMask(g_sel_face orelse return 0);
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
    if (g_occ_depth.len > 0) alloc.free(g_occ_depth);
    g_occ_depth = &.{};
    g_occ_bw = 0;
    g_occ_bh = 0;
    g_occ_ready = false;
    g_vis_key = null; // the masks this key described were just freed
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

    /// Simulate a stale/corrupted selection crossing the active Outliner scope.
    /// Production picking cannot create this state; undo/adoption regressions have.
    pub fn forceEdgeSelection(indices: []const u32) bool {
        if (!ensureTopology()) return false;
        const selected = g_sel_edge orelse return false;
        @memset(selected, false);
        for (indices) |index| {
            if (index >= selected.len) return false;
            selected[index] = true;
        }
        g_mode = .edge;
        return true;
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

/// True when every selected element (all three sets) sits inside the ACTIVE scope.
/// The scope-change law below clears exactly the selections that would otherwise
/// leak across an ownership boundary; a selection the new scope fully contains is
/// not a leak — it is the same elements under a moved/renumbered range (req_4271:
/// the first range-changing topology op used to wipe its own result selection when
/// the outliner's follow-up push ACTIVATED the scope over the whole model).
fn selectionInsideScope() bool {
    if (!g_scope_active) return true;
    ensureScopeMasks();
    if (g_sel_face) |sel| {
        for (sel, 0..) |on, face| {
            if (on and !faceInScope(@intCast(face))) return false;
        }
    }
    if (g_sel_vert) |sel| {
        for (sel, 0..) |on, vertex| {
            if (on and !vertInScopePub(@intCast(vertex))) return false;
        }
    }
    if (g_sel_edge) |sel| {
        for (sel, 0..) |on, edge| {
            if (on and !edgeInScopePub(@intCast(edge))) return false;
        }
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
    // never inherit a vertex/edge/face selection from the previously focused part —
    // but a selection the NEW scope fully contains is the same ownership, not a
    // leak, and survives (a topology op's result selection rides the range move).
    if (!selectionInsideScope()) clearSelection();
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
    // Same containment law as setEditScope: only a selection the new scope does
    // NOT fully contain is an ownership leak worth clearing.
    if (!selectionInsideScope()) clearSelection();
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
/// Identity of the active scope: facecount plus the ordered range list. Two calls
/// returning the same value promise `faceInScope` answers identically for every face.
fn scopeSignature() u64 {
    if (!g_scope_active) return 0;
    var sig: u64 = @as(u64, model_paint.faceCount()) << 32;
    for (g_scope_ranges[0..g_scope_count]) |r| {
        sig ^= (@as(u64, r[0]) << 12) ^ @as(u64, r[1]);
        sig = sig *% 0x9e3779b97f4a7c15 +% 1; // order-sensitive mix so [a,b],[c,d] ≠ [c,d],[a,b]
    }
    return sig;
}

fn ensureScopeMasks() void {
    if (!g_scope_active or g_verts == null) return;
    const sig = scopeSignature();
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

/// Ctrl+I: invert the current mode's selection within the active edit scope (req_4271).
/// Exactly the complement of what Select All reaches: faces invert over in-scope
/// authored faces, edges over real boundary edges (diagonals aren't real edges),
/// vertices over in-scope welded vertices. Out-of-scope elements never enter the
/// selection, so an invert can't smuggle a sibling part's geometry into an edit.
/// Returns the new selected count, -1 if there is no mesh or no select mode.
pub fn invertSelection() i32 {
    if (g_mode == .none) return -1;
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;
    switch (g_mode) {
        .vertex => {
            const sel = g_sel_vert orelse return -1;
            const n: u32 = @intCast(sel.len);
            var i: u32 = 0;
            while (i < n) : (i += 1) sel[i] = vertInScopePub(i) and !sel[i];
        },
        .edge => {
            const sel = g_sel_edge orelse return -1;
            const n: u32 = @intCast(sel.len);
            var e: u32 = 0;
            while (e < n) : (e += 1) sel[e] = edgeIsBoundaryPub(e) and edgeInScopePub(e) and !sel[e];
        },
        .face => {
            // Per-triangle complement is group-consistent because every selection
            // path (pick, marquee, walks) already expands to whole authored faces.
            const sel = g_sel_face orelse return -1;
            const n: u32 = @intCast(sel.len);
            var f: u32 = 0;
            while (f < n) : (f += 1) sel[f] = faceInScopePub(f) and !sel[f];
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
/// Build the selected-face mask into `out`. The caller's buffer length is the MESH's
/// authority on how many faces exist; `model_paint.faceCount()` is the paint layout's
/// opinion and the two disagree constantly, because a stale atlas is the NORMAL state of
/// a model being edited (req_4125). Two bugs lived in that gap: `out.len < fc` refused
/// outright, killing the caller with no reason; and callers who allocate by triangle
/// count got a buffer memset only over `fc`, leaving uninitialised garbage past it that
/// read as phantom selected faces. Clamp to the buffer and clear all of it.
pub fn buildDeleteMask(out: []bool) u32 {
    const fc = @min(@as(usize, model_paint.faceCount()), out.len);
    @memset(out, false);
    switch (g_mode) {
        .face => {
            const sel = g_sel_face orelse return 0;
            var f: usize = 0;
            while (f < fc) : (f += 1) {
                if (f < sel.len and sel[f]) out[f] = true;
            }
        },
        .vertex => {
            if (!ensureTopology()) return 0;
            const sel = g_sel_vert orelse return 0;
            const corners = g_corner_vert orelse return 0;
            var f: usize = 0;
            while (f < fc) : (f += 1) {
                var k: usize = 0;
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
            var f: usize = 0;
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
    var i: usize = 0;
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

/// Select durable authored edges by logical endpoint identity. The entire request is
/// validated before selection changes, so a stale named path cannot leave a partial
/// orange selection behind.
pub fn selectEdgesByEndpointPairsPub(pairs: []const Edge, additive: bool) u32 {
    if (pairs.len == 0 or !ensureTopology()) return 0;
    const sel = g_sel_edge orelse return 0;
    for (pairs) |pair| {
        const edge = edgeIndexBetween(pair[0], pair[1]) orelse return 0;
        if (edge >= sel.len or !edgeIsBoundaryPub(edge) or !edgeInScopePub(edge)) return 0;
    }
    g_mode = .edge;
    if (!additive) @memset(sel, false);
    for (pairs) |pair| sel[edgeIndexBetween(pair[0], pair[1]).?] = true;
    applyFaceHighlight();
    return @intCast(pairs.len);
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

pub const LegacyLogicalTopology = struct {
    allocator: std.mem.Allocator,
    corner_vertices: []u32,
    vertex_positions: []f32,
    vertex_parts: []u32,

    pub fn deinit(topology: *LegacyLogicalTopology) void {
        if (topology.corner_vertices.len > 0) topology.allocator.free(topology.corner_vertices);
        if (topology.vertex_positions.len > 0) topology.allocator.free(topology.vertex_positions);
        if (topology.vertex_parts.len > 0) topology.allocator.free(topology.vertex_parts);
        topology.* = undefined;
    }
};

/// The one legacy position-weld implementation. Live v4 edge selection and the
/// v4->v5 persistence boundary both call this, so migration cannot mint a
/// different numeric vertex identity from the one named-edge authoring used.
fn buildLegacyLogicalTopologyAlloc(
    allocator: std.mem.Allocator,
    positions: []const f32,
    face_count: usize,
    floats_per_corner: usize,
    face_parts: []const u32,
) !LegacyLogicalTopology {
    if (face_count == 0 or floats_per_corner < 3 or face_parts.len != face_count or
        positions.len < face_count * 3 * floats_per_corner)
    {
        return error.InvalidLegacyLogicalTopology;
    }
    var weld = std.AutoHashMapUnmanaged(WeldKey, u32).empty;
    defer weld.deinit(allocator);
    var vertex_positions = std.ArrayListUnmanaged(f32).empty;
    defer vertex_positions.deinit(allocator);
    var vertex_parts = std.ArrayListUnmanaged(u32).empty;
    defer vertex_parts.deinit(allocator);
    const corner_vertices = try allocator.alloc(u32, face_count * 3);
    errdefer allocator.free(corner_vertices);

    for (0..face_count) |face| {
        for (0..3) |corner| {
            const base = (face * 3 + corner) * floats_per_corner;
            const point = [3]f32{ positions[base], positions[base + 1], positions[base + 2] };
            const key = WeldKey{ .pos = weldKey(point), .part = face_parts[face] };
            const entry = try weld.getOrPut(allocator, key);
            if (!entry.found_existing) {
                entry.value_ptr.* = @intCast(vertex_positions.items.len / 3);
                try vertex_positions.appendSlice(allocator, &point);
                try vertex_parts.append(allocator, face_parts[face]);
            }
            corner_vertices[face * 3 + corner] = entry.value_ptr.*;
        }
    }
    const owned_positions = try vertex_positions.toOwnedSlice(allocator);
    errdefer allocator.free(owned_positions);
    const owned_parts = try vertex_parts.toOwnedSlice(allocator);
    return .{
        .allocator = allocator,
        .corner_vertices = corner_vertices,
        .vertex_positions = owned_positions,
        .vertex_parts = owned_parts,
    };
}

/// Rebuild the live edit handles from the document's durable logical-corner rows.
/// Unlike the legacy position weld, coincident vertices with different stable ids
/// remain independent. This is the boundary that makes an Edge Split seam usable:
/// selecting and moving one face may not drag the position-coincident face across
/// the split with it.
fn buildExplicitLogicalTopologyAlloc(
    allocator: std.mem.Allocator,
    positions: []const f32,
    face_count: usize,
    floats_per_corner: usize,
    face_parts: []const u32,
    logical_rows: []const u32,
    logical_vertex_count: u32,
) !LegacyLogicalTopology {
    const corner_count = face_count * 3;
    if (face_count == 0 or floats_per_corner < 3 or face_parts.len != face_count or
        positions.len < corner_count * floats_per_corner or logical_rows.len != corner_count or
        logical_vertex_count == 0)
    {
        return error.InvalidLegacyLogicalTopology;
    }

    var dense_by_stable = std.AutoHashMapUnmanaged(u32, u32).empty;
    defer dense_by_stable.deinit(allocator);
    var vertex_positions = std.ArrayListUnmanaged(f32).empty;
    defer vertex_positions.deinit(allocator);
    var vertex_parts = std.ArrayListUnmanaged(u32).empty;
    defer vertex_parts.deinit(allocator);
    const corner_vertices = try allocator.alloc(u32, corner_count);
    errdefer allocator.free(corner_vertices);

    for (logical_rows, 0..) |stable_id, corner| {
        if (stable_id >= logical_vertex_count) return error.InvalidLegacyLogicalTopology;
        const base = corner * floats_per_corner;
        const point = [3]f32{ positions[base], positions[base + 1], positions[base + 2] };
        const part = face_parts[corner / 3];
        const entry = try dense_by_stable.getOrPut(allocator, stable_id);
        if (!entry.found_existing) {
            entry.value_ptr.* = @intCast(vertex_positions.items.len / 3);
            try vertex_positions.appendSlice(allocator, &point);
            try vertex_parts.append(allocator, part);
        } else {
            const dense = entry.value_ptr.*;
            const prior_base = @as(usize, dense) * 3;
            const prior = [3]f32{
                vertex_positions.items[prior_base],
                vertex_positions.items[prior_base + 1],
                vertex_positions.items[prior_base + 2],
            };
            const prior_key = weldKey(prior);
            const point_key = weldKey(point);
            if (vertex_parts.items[dense] != part or !std.mem.eql(i32, prior_key[0..], point_key[0..]))
                return error.InvalidLegacyLogicalTopology;
        }
        corner_vertices[corner] = entry.value_ptr.*;
    }

    const owned_positions = try vertex_positions.toOwnedSlice(allocator);
    errdefer allocator.free(owned_positions);
    const owned_parts = try vertex_parts.toOwnedSlice(allocator);
    return .{
        .allocator = allocator,
        .corner_vertices = corner_vertices,
        .vertex_positions = owned_positions,
        .vertex_parts = owned_parts,
    };
}

/// Explicit legacy-to-v5 mint boundary for a complete resident model assembled by
/// Scene3D. The caller supplies one owner per face and receives corner ids in that
/// exact face order. This is the same builder used by the live edit topology, so a
/// selected legacy edit edge can be promoted without inventing a second identity.
pub fn legacyLogicalTopologyAlloc(
    allocator: std.mem.Allocator,
    interleaved: []const f32,
    face_parts: []const u32,
) !LegacyLogicalTopology {
    if (interleaved.len == 0 or interleaved.len % 24 != 0) return error.InvalidLegacyLogicalTopology;
    return buildLegacyLogicalTopologyAlloc(allocator, interleaved, interleaved.len / 24, 8, face_parts);
}

pub const LegacyEdgeTopologyPromotion = struct {
    allocator: std.mem.Allocator,
    render_corner_logical_ids: []u32,
    dense_to_stable_logical_ids: []u32,
    logical_vertex_count: u32,

    pub fn deinit(promotion: *LegacyEdgeTopologyPromotion) void {
        if (promotion.render_corner_logical_ids.len > 0) promotion.allocator.free(promotion.render_corner_logical_ids);
        if (promotion.dense_to_stable_logical_ids.len > 0) promotion.allocator.free(promotion.dense_to_stable_logical_ids);
        promotion.* = undefined;
    }

    pub fn applyBorrowed(promotion: *const LegacyEdgeTopologyPromotion, snapshot: *model_source.MeshDocSnapshot) void {
        snapshot.render_corner_logical_ids = promotion.render_corner_logical_ids;
        snapshot.logical_vertex_count = promotion.logical_vertex_count;
        snapshot.dense_to_stable_logical_ids = promotion.dense_to_stable_logical_ids;
    }

    pub fn moveInto(promotion: *LegacyEdgeTopologyPromotion, snapshot: *model_source.MeshDocSnapshot) void {
        promotion.applyBorrowed(snapshot);
        promotion.render_corner_logical_ids = &.{};
        promotion.dense_to_stable_logical_ids = &.{};
    }
};

/// Promote only the legacy documents that actually carry durable named-edge
/// paths. Plain v1-v4 props remain non-logical. The reconstructed rows must make
/// every saved path selectable before they may enter a strict current-v5 file.
pub fn legacyEdgeTopologyPromotionAlloc(
    allocator: std.mem.Allocator,
    interleaved: []const f32,
    groups: ?[]const u32,
    ranges: []const u32,
    semantic_table_json: ?[]const u8,
) !?LegacyEdgeTopologyPromotion {
    const semantic_json = semantic_table_json orelse return null;
    if (try model_source.semanticEdgeRegionCount(allocator, semantic_json) == 0) return null;
    if (interleaved.len == 0 or interleaved.len % 24 != 0) return error.InvalidLegacyLogicalTopology;
    const face_count = interleaved.len / 24;
    const face_groups = groups orelse return error.InvalidLegacyLogicalTopology;
    if (face_groups.len != face_count or ranges.len == 0 or ranges.len % 2 != 0 or
        !partRangesValid(ranges, @intCast(ranges.len / 2)))
    {
        return error.InvalidLegacyLogicalTopology;
    }
    const face_parts = try allocator.alloc(u32, face_count);
    defer allocator.free(face_parts);
    for (face_groups, 0..) |group, face| {
        var owner: ?u32 = null;
        for (0..ranges.len / 2) |range_index| {
            if (group >= ranges[range_index * 2] and group < ranges[range_index * 2 + 1]) {
                owner = @intCast(range_index);
                break;
            }
        }
        face_parts[face] = owner orelse return error.InvalidLegacyLogicalTopology;
    }
    var topology = try buildLegacyLogicalTopologyAlloc(allocator, interleaved, face_count, 8, face_parts);
    defer topology.deinit();
    const logical_vertex_count: u32 = @intCast(topology.vertex_positions.len / 3);
    if (!try model_source.semanticEdgePathsResolveInTopology(
        allocator,
        semantic_json,
        topology.corner_vertices,
        logical_vertex_count,
        face_groups,
    )) return error.InvalidLegacyEdgePath;
    const logical_rows = topology.corner_vertices;
    topology.corner_vertices = &.{};
    errdefer allocator.free(logical_rows);
    const dense_to_stable = try allocator.alloc(u32, logical_vertex_count);
    for (dense_to_stable, 0..) |*stable, dense| stable.* = @intCast(dense);
    return .{
        .allocator = allocator,
        .render_corner_logical_ids = logical_rows,
        .dense_to_stable_logical_ids = dense_to_stable,
        .logical_vertex_count = logical_vertex_count,
    };
}

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

    const face_count: usize = @intCast(fc);
    const face_parts = alloc.alloc(u32, face_count) catch return false;
    defer alloc.free(face_parts);
    for (face_parts, 0..) |*part, face| part.* = model_source.partIndexOf(model_source.faceGroupOf(@intCast(face)));
    var topology = if (model_source.renderCornerLogicalIds()) |logical_rows|
        buildExplicitLogicalTopologyAlloc(
            alloc,
            pos,
            face_count,
            3,
            face_parts,
            logical_rows,
            model_source.logicalVertexCount(),
        ) catch return false
    else
        buildLegacyLogicalTopologyAlloc(alloc, pos, face_count, 3, face_parts) catch return false;
    var topology_adopted = false;
    defer if (!topology_adopted) topology.deinit();
    const corner_vert = topology.corner_vertices;

    var f: u32 = 0;

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

    const owned_edges = edges.toOwnedSlice(alloc) catch return false;
    g_verts = topology.vertex_positions;
    g_vert_part = topology.vertex_parts;
    g_corner_vert = corner_vert;
    g_edges = owned_edges;
    topology_adopted = true;
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
fn vecLen(a: [3]f32) f32 {
    return @sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
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

/// Align Loop chooses the least-varying world axis,
/// then collapses the selected row/loop to its centroid on that axis. Keeping
/// the epsilon in one tuning contract prevents model scale from changing which
/// nearly-planar coordinate wins and makes a repeated invocation a no-op.
pub const AlignLoopTuning = struct {
    pub const minimum_span_m: f32 = 0.000001;
};

pub const AlignLoopResult = struct {
    mutation: Mutation,
    axis: u8,
    coordinate: f32,
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

/// Position→vertex lookup for twin matching, keyed by exact authored part owner.
const MirrorMap = struct {
    by_part: std.AutoHashMapUnmanaged(MirrorKey, u32) = .empty,

    fn deinit(self: *MirrorMap) void {
        self.by_part.deinit(alloc);
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
        }
        return map;
    }

    fn get(self: *const MirrorMap, part: u32, p: [3]f32) ?u32 {
        return self.by_part.get(mirrorKey(part, p));
    }
};

/// Resolve one destination owner for every source-owner/reflection subset. Cross-part
/// pairing is accepted only when one owner uniquely covers at least half of the source
/// vertices. A lone coincident seam point is evidence of contact, not mirror ownership.
const MirrorPartPartners = struct {
    labels: []u32,
    count: usize,
    partners: []u32,

    fn deinit(self: *MirrorPartPartners) void {
        alloc.free(self.labels);
        alloc.free(self.partners);
        self.* = undefined;
    }

    fn get(self: *const MirrorPartPartners, source: u32, subset: u8) ?u32 {
        for (self.labels[0..self.count], 0..) |label, index| {
            if (label != source) continue;
            const target_index = self.partners[index * 7 + @as(usize, subset - 1)];
            return if (target_index == MIRROR_NONE or target_index >= @as(u32, @intCast(self.count))) null else self.labels[target_index];
        }
        return null;
    }
};

fn mirrorPartPartnersAlloc(parts: []const u32, map: *const MirrorMap) ?MirrorPartPartners {
    if (parts.len == 0) return null;
    const labels = alloc.alloc(u32, parts.len) catch return null;
    var label_count: usize = 0;
    for (parts) |part| {
        var known = false;
        for (labels[0..label_count]) |label| {
            if (label == part) {
                known = true;
                break;
            }
        }
        if (!known) {
            if (label_count >= 4096) {
                alloc.free(labels);
                return null;
            }
            labels[label_count] = part;
            label_count += 1;
        }
    }
    const partners = alloc.alloc(u32, label_count * 7) catch {
        alloc.free(labels);
        return null;
    };
    @memset(partners, MIRROR_NONE);
    const scores = alloc.alloc(u32, label_count) catch {
        alloc.free(labels);
        alloc.free(partners);
        return null;
    };
    defer alloc.free(scores);

    for (labels[0..label_count], 0..) |source_part, source_index| {
        var source_vertices: u32 = 0;
        for (parts) |part| if (part == source_part) {
            source_vertices += 1;
        };
        if (source_vertices == 0) continue;
        var subset: u8 = 1;
        while (subset <= 7) : (subset += 1) {
            @memset(scores, 0);
            var vertex: u32 = 0;
            while (vertex < g_vert_count) : (vertex += 1) {
                if (parts[@intCast(vertex)] != source_part) continue;
                const reflected = reflectPointAround(vertPos(vertex), subset, MIRROR_PLANE_CENTER);
                for (labels[0..label_count], 0..) |target_part, target_index| {
                    if (map.get(target_part, reflected) != null) scores[target_index] += 1;
                }
            }
            var best_index: u32 = MIRROR_NONE;
            var best_score: u32 = 0;
            var tied = false;
            for (scores, 0..) |score, target_index| {
                if (score > best_score) {
                    best_score = score;
                    best_index = @intCast(target_index);
                    tied = false;
                } else if (score != 0 and score == best_score) {
                    tied = true;
                }
            }
            const minimum = (source_vertices + 1) / 2;
            if (!tied and best_score >= minimum) {
                partners[source_index * 7 + @as(usize, subset - 1)] = best_index;
            }
        }
    }
    return .{ .labels = labels, .count = label_count, .partners = partners };
}

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
    var partners = mirrorPartPartnersAlloc(parts, &map) orelse {
        alloc.free(twins);
        return null;
    };
    defer partners.deinit();
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        const part = parts[@intCast(i)];
        const p = vertPos(i);
        var s: u8 = 1;
        while (s <= 7) : (s += 1) {
            const partner = partners.get(part, s) orelse continue;
            if (map.get(partner, reflectPointAround(p, s, MIRROR_PLANE_CENTER))) |t| {
                twins[@as(usize, s - 1) * g_vert_count + i] = t;
            }
        }
    }
    g_mirror_twin = twins;
    g_mirror_built_for = g_vert_count;
    g_mirror_built_mask = g_mirror_mask;
    return twins;
}

/// The reflected image of one logical vertex for a plane subset (bit 0/1/2 = X/Y/Z).
/// Unlike the distinct-twin door below, a vertex on the mirror plane legally maps to
/// itself. Create Face needs that identity when a bridge edge terminates on the seam:
/// its off-plane endpoint crosses to the other side while its seam endpoint stays put.
pub fn mirrorImageOfVertPub(v: u32, subset: u8) ?u32 {
    if (subset == 0 or subset > 7 or (subset & g_mirror_mask) != subset) return null;
    const twins = ensureMirrorTwins() orelse return null;
    if (v >= g_vert_count) return null;
    const t = twins[@as(usize, subset - 1) * g_vert_count + v];
    if (t == MIRROR_NONE or t >= g_vert_count) return null;
    return t;
}

/// The distinct mirror twin used by transforms and topology verbs that must not
/// process a plane vertex twice. Null also means the reflected image is `v` itself.
pub fn mirrorTwinOfVertPub(v: u32, subset: u8) ?u32 {
    const t = mirrorImageOfVertPub(v, subset) orelse return null;
    return if (t == v) null else t;
}

/// Live symmetry report against the exact same identity domains and
/// the shared MIRROR_PLANE_CENTER plane as mirrored transforms. Only vertices in the
/// current outliner scope contribute; pairing uses the same whole-owner correspondence
/// as actual mirror transforms.
pub fn symmetryReportPub(axis: u8) ?[3]f32 {
    if (axis > 2 or !ensureTopology()) return null;
    const parts = g_vert_part orelse return null;
    if (parts.len < g_vert_count) return null;
    const subset: u8 = @as(u8, 1) << @intCast(axis);
    const twins = ensureMirrorTwins() orelse return null;
    const epsilon: f32 = 1.5 / MIRROR_Q;
    var unmatched: u32 = 0;
    var total: u32 = 0;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        if (!vertInScopePub(vertex)) continue;
        total += 1;
        const reflected = reflectPointAround(vertPos(vertex), subset, MIRROR_PLANE_CENTER);
        const twin = twins[@as(usize, subset - 1) * g_vert_count + vertex];
        if (twin == MIRROR_NONE or twin >= g_vert_count) {
            unmatched += 1;
            continue;
        }
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
    return syncTransformedVerts(mask, twins_opt);
}

/// The shared tail of every vertex-position edit: land mirror twins, then push
/// the welded vertex table back into the per-face render positions. Callers
/// write new positions into g_verts for their masked verts FIRST (with the twin
/// table already built — pairing is positional) and this owns the rest. Split
/// out of applyTransform so Curve Pull's per-vertex targets (req_4325) ride the
/// exact mirror/writeback guarantees the rigid tools have.
fn syncTransformedVerts(mask: []const bool, twins_opt: ?[]u32) Mutation {
    const verts = g_verts orelse return .{};
    const corners = g_corner_vert orelse return .{};
    const pos = model_paint.positionsMutable() orelse return .{};

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

// ── Curve Pull (req_4325/req_4326) ───────────────────────────────────────────────
// Select one run of vertices, grab the gizmo, and the drag bends the run through
// a circular arc instead of rigid-translating it: the run's two endpoints hold as
// anchors, the middle vertex follows the cursor, and every vertex in between
// lands on the arc through (anchorA, pulled middle, anchorB) at its own original
// arc-length station. Applies ABSOLUTELY from positions captured at grab — the
// arc is re-solved per frame from base + offset, so a wandering drag can never
// compound error. Mirror twins and welded-corner writeback ride the shared
// syncTransformedVerts tail, so a mirrored half bends symmetrically for free.

pub const curve_pull_tuning = struct {
    /// a run longer than this refuses (loud) rather than silently lagging the drag
    pub const max_path_verts: u32 = 512;
    /// below this the three curve points are treated as collinear → tent fallback
    pub const collinear_epsilon: f32 = 1e-10;
    /// A faceted arc turns no farther than this between adjacent path vertices.
    /// Fifteen degrees keeps the silhouette smooth without spraying topology into
    /// shallow pulls; deeper bends cross thresholds and ask for more full loop cuts.
    pub const max_segment_turn_radians: f32 = std.math.pi / 12.0;
    /// Once a ring exists, curvature must fall materially below its lower density
    /// boundary before the gesture removes it.  This deadband prevents mouse jitter
    /// around 15° from alternating two full topology rebuilds frame after frame.
    pub const density_release_ratio: f32 = 0.80;
    /// One original edge may gain at most this many cuts in a single gesture.  The
    /// path-wide 512-vertex ceiling remains the stronger bound on long selections.
    pub const max_cuts_per_edge: u32 = 15;
    /// Indexed cut vertices are minted from exact lerps, but the durable soup boundary
    /// is f32.  This is well below the indexed import weld epsilon (1/1024 m).
    pub const topology_match_epsilon_sq: f32 = 1e-10;
};

var g_curve_ids: ?[]u32 = null; // ordered run, endpoint → endpoint
var g_curve_base: ?[][3]f32 = null; // grab-time positions, same order
var g_curve_params: ?[]f32 = null; // normalized chord-length station of each vert
var g_curve_grab: usize = 0; // index into the run of the pulled vertex
var g_curve_mask: ?[]bool = null; // scratch affected-mask for the sync tail
var g_curve_mode: Mode = .none;
var g_curve_part: u32 = model_source.NO_PART;

pub const CurvePullPath = struct {
    ids: []const u32,
    base: []const [3]f32,
    params: []const f32,
    grab: usize,
    mode: Mode,
    part: u32,
};

pub const CurvePullMirrorSeed = struct {
    base: []const [3]f32,
    part: u32,
};

pub const CurvePullDensifiedPath = struct {
    allocator: std.mem.Allocator,
    ids: []u32,
    base: [][3]f32,
    params: []f32,

    pub fn deinit(path: *CurvePullDensifiedPath) void {
        path.allocator.free(path.ids);
        path.allocator.free(path.base);
        path.allocator.free(path.params);
        path.* = undefined;
    }
};

pub fn curvePullEnd() void {
    if (g_curve_ids) |ids| alloc.free(ids);
    if (g_curve_base) |base| alloc.free(base);
    if (g_curve_params) |params| alloc.free(params);
    if (g_curve_mask) |mask| alloc.free(mask);
    g_curve_ids = null;
    g_curve_base = null;
    g_curve_params = null;
    g_curve_mask = null;
    g_curve_grab = 0;
    g_curve_mode = .none;
    g_curve_part = model_source.NO_PART;
}

pub fn curvePullActive() bool {
    return g_curve_ids != null;
}

pub fn curvePullPath() ?CurvePullPath {
    return .{
        .ids = g_curve_ids orelse return null,
        .base = g_curve_base orelse return null,
        .params = g_curve_params orelse return null,
        .grab = g_curve_grab,
        .mode = g_curve_mode,
        .part = g_curve_part,
    };
}

/// Capture the selected run at grab time. Refuses (false) unless the selection
/// is ONE open path of 3..max_path_verts vertices — a loop has no anchors and a
/// branched selection has no single bend direction.
pub fn curvePullBegin() bool {
    curvePullEnd();
    if (g_mode != .vertex and g_mode != .edge) return false;
    const mask = fillAffectedVerts() orelse return false;
    var count: u32 = 0;
    var v: u32 = 0;
    while (v < g_vert_count) : (v += 1) {
        if (mask[v]) count += 1;
    }
    if (count < 3 or count > curve_pull_tuning.max_path_verts) return false;
    if (!selectionFormsOnePathOrLoop(mask, count)) return false;

    // find an endpoint (degree 1 over the selected authored edges); none = loop → refuse
    const degrees = alloc.alloc(u8, g_vert_count) catch return false;
    defer alloc.free(degrees);
    @memset(degrees, 0);
    const edges = g_edges orelse return false;
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!selectedAlignmentEdge(edge, mask)) continue;
        degrees[edges[edge * 2]] += 1;
        degrees[edges[edge * 2 + 1]] += 1;
    }
    var start: ?u32 = null;
    v = 0;
    while (v < g_vert_count) : (v += 1) {
        if (mask[v] and degrees[v] == 1) {
            start = v;
            break;
        }
    }
    const first = start orelse return false; // closed loop — no anchors to hold

    // ordered walk endpoint → endpoint along the selected edges (degree ≤ 2 proven)
    const ids = alloc.alloc(u32, count) catch return false;
    const seen = alloc.alloc(bool, g_vert_count) catch {
        alloc.free(ids);
        return false;
    };
    defer alloc.free(seen);
    @memset(seen, false);
    ids[0] = first;
    seen[first] = true;
    var filled: u32 = 1;
    while (filled < count) {
        const current = ids[filled - 1];
        var next: ?u32 = null;
        edge = 0;
        while (edge < g_edge_count) : (edge += 1) {
            if (!selectedAlignmentEdge(edge, mask)) continue;
            const a = edges[edge * 2];
            const b = edges[edge * 2 + 1];
            const other = if (a == current) b else if (b == current) a else continue;
            if (seen[other]) continue;
            next = other;
            break;
        }
        const step = next orelse {
            alloc.free(ids);
            return false;
        };
        ids[filled] = step;
        seen[step] = true;
        filled += 1;
    }

    const parts = g_vert_part orelse {
        alloc.free(ids);
        return false;
    };
    if (ids[0] >= parts.len) {
        alloc.free(ids);
        return false;
    }
    const part = parts[ids[0]];
    for (ids) |id| {
        if (id >= parts.len or parts[id] != part) {
            alloc.free(ids);
            return false;
        }
    }

    const base = alloc.alloc([3]f32, count) catch {
        alloc.free(ids);
        return false;
    };
    const params = alloc.alloc(f32, count) catch {
        alloc.free(ids);
        alloc.free(base);
        return false;
    };
    var total: f32 = 0;
    var i: u32 = 0;
    while (i < count) : (i += 1) {
        base[i] = vertPos(ids[i]);
        if (i > 0) total += vecLen(vecSub(base[i], base[i - 1]));
        params[i] = total;
    }
    if (total < 1e-9) {
        alloc.free(ids);
        alloc.free(base);
        alloc.free(params);
        return false;
    }
    var grab: usize = 0;
    i = 0;
    while (i < count) : (i += 1) {
        params[i] /= total;
        if (@abs(params[i] - 0.5) < @abs(params[grab] - 0.5)) grab = i;
    }
    const scratch = alloc.alloc(bool, g_vert_count) catch {
        alloc.free(ids);
        alloc.free(base);
        alloc.free(params);
        return false;
    };
    g_curve_ids = ids;
    g_curve_base = base;
    g_curve_params = params;
    g_curve_grab = grab;
    g_curve_mask = scratch;
    g_curve_mode = g_mode;
    g_curve_part = part;
    return true;
}

/// Angle of `p` around center `o` in the (e1, e2) plane basis, unwound along the
/// sweep direction so 0 → |sweep| runs A → C the way the arc actually travels.
fn arcAngleAlong(rel: [3]f32, e1: [3]f32, e2: [3]f32, sweep_positive: bool) f32 {
    const raw = std.math.atan2(vecDot(rel, e2), vecDot(rel, e1));
    const two_pi = std.math.pi * 2.0;
    const ccw = @mod(raw + two_pi, two_pi);
    return if (sweep_positive) ccw else @mod(two_pi - ccw, two_pi);
}

const CurvePullArc = struct {
    center: [3]f32,
    e1: [3]f32,
    e2: [3]f32,
    radius: f32,
    span: f32,
    positive: bool,
    t_grab: f32,
    frac_grab: f32,

    fn fractionAt(arc: CurvePullArc, t: f32) f32 {
        if (t <= arc.t_grab) {
            return if (arc.t_grab > 1e-6) (t / arc.t_grab) * arc.frac_grab else 0;
        }
        return if (arc.t_grab < 1.0 - 1e-6)
            arc.frac_grab + ((t - arc.t_grab) / (1.0 - arc.t_grab)) * (1.0 - arc.frac_grab)
        else
            1;
    }

    fn pointAt(arc: CurvePullArc, t: f32) [3]f32 {
        const angle = arc.span * arc.fractionAt(t) * @as(f32, if (arc.positive) 1 else -1);
        return vecAdd(arc.center, vecAdd(
            vecMul(arc.e1, arc.radius * @cos(angle)),
            vecMul(arc.e2, arc.radius * @sin(angle)),
        ));
    }
};

/// One circle solution feeds both deformation and density planning.  If this returns
/// null the pull is collinear and Curve Pull uses its two straight tent segments,
/// which need no extra topology to represent exactly.
fn curvePullArc(path: CurvePullPath, offset: [3]f32) ?CurvePullArc {
    if (path.ids.len < 3 or path.base.len != path.ids.len or path.params.len != path.ids.len or path.grab >= path.ids.len) return null;
    const a = path.base[0];
    const c = path.base[path.base.len - 1];
    const b = vecAdd(path.base[path.grab], offset);
    const ab = vecSub(b, a);
    const ac = vecSub(c, a);
    const nrm = vecCross(ab, ac);
    const n2 = vecDot(nrm, nrm);
    if (n2 < curve_pull_tuning.collinear_epsilon) return null;

    const term1 = vecMul(vecCross(nrm, ab), vecDot(ac, ac));
    const term2 = vecMul(vecCross(ac, nrm), vecDot(ab, ab));
    const center = vecAdd(a, vecMul(vecAdd(term1, term2), 1.0 / (2.0 * n2)));
    const radius = vecLen(vecSub(a, center));
    if (radius < 1e-9 or !std.math.isFinite(radius)) return null;
    const e1 = vecMul(vecSub(a, center), 1.0 / radius);
    const plane_normal = vecMul(nrm, 1.0 / @sqrt(n2));
    const e2 = vecCross(plane_normal, e1);

    const two_pi = std.math.pi * 2.0;
    const ccw_b = arcAngleAlong(vecSub(b, center), e1, e2, true);
    const ccw_c = arcAngleAlong(vecSub(c, center), e1, e2, true);
    const positive = ccw_b <= ccw_c;
    const span = if (positive) ccw_c else @mod(two_pi - ccw_c, two_pi);
    if (span < 1e-7 or !std.math.isFinite(span)) return null;
    const along_b = if (positive) ccw_b else @mod(two_pi - ccw_b, two_pi);
    return .{
        .center = center,
        .e1 = e1,
        .e2 = e2,
        .radius = radius,
        .span = span,
        .positive = positive,
        .t_grab = path.params[path.grab],
        .frac_grab = along_b / span,
    };
}

/// Number of equal cuts needed inside EACH original selected edge for the current
/// bend.  The host rebuilds from the grab-time indexed mesh whenever this value
/// changes, so scrubbing back shallower removes surplus rings as well as deeper pulls
/// adding them.  No allocation and no topology walk occur on ordinary drag frames.
pub fn curvePullSuggestedCutsFor(path: CurvePullPath, offset: [3]f32) u32 {
    const arc = curvePullArc(path, offset) orelse return 0;
    var cuts: u32 = 0;
    var i: usize = 0;
    while (i + 1 < path.params.len) : (i += 1) {
        const turn = arc.span * @abs(arc.fractionAt(path.params[i + 1]) - arc.fractionAt(path.params[i]));
        const rounded_pieces: u32 = @ceil(turn / curve_pull_tuning.max_segment_turn_radians);
        const pieces = @max(1, rounded_pieces);
        cuts = @max(cuts, pieces - 1);
    }
    const original_edges: u32 = @intCast(path.ids.len - 1);
    const max_by_path_budget = (curve_pull_tuning.max_path_verts - 1) / original_edges - 1;
    return @min(cuts, @min(curve_pull_tuning.max_cuts_per_edge, max_by_path_budget));
}

pub fn curvePullSuggestedCuts(offset: [3]f32) u32 {
    return curvePullSuggestedCutsFor(curvePullPath() orelse return 0, offset);
}

pub fn curvePullAdaptiveCutsFor(path: CurvePullPath, offset: [3]f32, current_cuts: u32) u32 {
    const wanted = curvePullSuggestedCutsFor(path, offset);
    if (wanted >= current_cuts or current_cuts == 0) return wanted;
    const arc = curvePullArc(path, offset) orelse return 0;
    var max_turn: f32 = 0;
    var i: usize = 0;
    while (i + 1 < path.params.len) : (i += 1) {
        max_turn = @max(max_turn, arc.span * @abs(arc.fractionAt(path.params[i + 1]) - arc.fractionAt(path.params[i])));
    }
    const lower_piece_count: f32 = @floatFromInt(current_cuts);
    const release_turn = lower_piece_count * curve_pull_tuning.max_segment_turn_radians * curve_pull_tuning.density_release_ratio;
    return if (max_turn <= release_turn) wanted else current_cuts;
}

/// Re-solve the arc for the current pull offset and land every run vertex on it.
/// The grabbed vertex sits EXACTLY at base + offset; anchors never move.
pub fn curvePullApply(offset: [3]f32) Mutation {
    const ids = g_curve_ids orelse return .{};
    const base = g_curve_base orelse return .{};
    const params = g_curve_params orelse return .{};
    const scratch = g_curve_mask orelse return .{};
    const verts = g_verts orelse return .{};
    const n = ids.len;
    const t_grab = params[g_curve_grab];

    // twin table BEFORE positions move (same law as applyTransform)
    const twins_opt: ?[]u32 = if (g_mirror_mask != 0) ensureMirrorTwins() else null;

    const path = curvePullPath() orelse return .{};
    const arc = curvePullArc(path, offset);

    @memset(scratch, false);
    var i: usize = 0;
    if (arc == null) {
        // collinear (pull along the chord): tent falloff through the grab station —
        // anchors hold, the grab takes the full offset, stations blend linearly
        while (i < n) : (i += 1) {
            const t = params[i];
            const w = if (t <= t_grab)
                (if (t_grab > 1e-6) t / t_grab else 0)
            else
                (if (t_grab < 1.0 - 1e-6) (1.0 - t) / (1.0 - t_grab) else 0);
            const np = vecAdd(base[i], vecMul(offset, w));
            const id = ids[i];
            verts[id * 3 + 0] = np[0];
            verts[id * 3 + 1] = np[1];
            verts[id * 3 + 2] = np[2];
            scratch[id] = true;
        }
        return syncTransformedVerts(scratch, twins_opt);
    }

    while (i < n) : (i += 1) {
        const np = arc.?.pointAt(params[i]);
        const id = ids[i];
        verts[id * 3 + 0] = np[0];
        verts[id * 3 + 1] = np[1];
        verts[id * 3 + 2] = np[2];
        scratch[id] = true;
    }
    return syncTransformedVerts(scratch, twins_opt);
}

fn curvePointNear(a: [3]f32, b: [3]f32) bool {
    return vecDot(vecSub(a, b), vecSub(a, b)) <= curve_pull_tuning.topology_match_epsilon_sq;
}

fn indexedVertexBelongsToPart(mesh: anytype, vertex: u32, part: u32) bool {
    for (mesh.faces.items) |*face| {
        if (!face.alive or face.part != part) continue;
        for (face.vertices.items) |candidate| if (candidate == vertex) return true;
    }
    return false;
}

fn indexedVertexAtPoint(mesh: anytype, first: usize, point: [3]f32, part: u32) ?u32 {
    var vertex = first;
    while (vertex < mesh.vertices.items.len) : (vertex += 1) {
        const candidate = &mesh.vertices.items[vertex];
        if (!candidate.alive or !curvePointNear(candidate.position, point)) continue;
        if (!indexedVertexBelongsToPart(mesh, @intCast(vertex), part)) continue;
        return @intCast(vertex);
    }
    return null;
}

fn curveCutPoint(a: [3]f32, b: [3]f32, cut: u32, cuts: u32) [3]f32 {
    const t = @as(f32, @floatFromInt(cut)) / @as(f32, @floatFromInt(cuts + 1));
    return vecAdd(a, vecMul(vecSub(b, a), t));
}

fn indexedSegmentAlreadyDensified(mesh: anytype, a: [3]f32, b: [3]f32, part: u32, cuts: u32) bool {
    var cut: u32 = 1;
    while (cut <= cuts) : (cut += 1) {
        if (indexedVertexAtPoint(mesh, 0, curveCutPoint(a, b, cut, cuts), part) == null) return false;
    }
    return true;
}

/// Rebuild one selected path from its grab-time indexed mesh and propagate equal
/// loop cuts through every crossed authored quad strip.  This helper is generic on
/// the indexed mesh owner so the native boundary test can exercise the real topology
/// implementation without introducing a second mesh representation here.
pub fn curvePullDensifyIndexed(
    allocator: std.mem.Allocator,
    mesh: anytype,
    source: CurvePullPath,
    mirrors: []const CurvePullMirrorSeed,
    cuts: u32,
) !CurvePullDensifiedPath {
    if (source.ids.len < 3 or source.base.len != source.ids.len or source.params.len != source.ids.len or
        cuts > curve_pull_tuning.max_cuts_per_edge)
    {
        return error.InvalidCurvePullPath;
    }
    const edge_count = source.ids.len - 1;
    const pieces = std.math.add(usize, @as(usize, cuts), 1) catch return error.CurvePullPathTooLarge;
    const multiplied = std.math.mul(usize, edge_count, pieces) catch return error.CurvePullPathTooLarge;
    const output_count = std.math.add(usize, multiplied, 1) catch return error.CurvePullPathTooLarge;
    if (output_count > curve_pull_tuning.max_path_verts) return error.CurvePullPathTooLarge;

    for (source.ids, source.base) |id, point| {
        if (id >= mesh.vertices.items.len or !mesh.vertices.items[id].alive or
            !curvePointNear(mesh.vertices.items[id].position, point) or
            !indexedVertexBelongsToPart(mesh, id, source.part))
        {
            return error.CurvePullSourceDrift;
        }
    }

    const ids = try allocator.alloc(u32, output_count);
    errdefer allocator.free(ids);
    const base = try allocator.alloc([3]f32, output_count);
    errdefer allocator.free(base);
    const params = try allocator.alloc(f32, output_count);
    errdefer allocator.free(params);

    var write: usize = 0;
    var segment: usize = 0;
    while (segment < edge_count) : (segment += 1) {
        const a = source.base[segment];
        const b = source.base[segment + 1];
        const before_vertices = mesh.vertices.items.len;
        if (cuts > 0 and !(try mesh.loopCutFromEdge(a, b, source.part, cuts, 0.5))) {
            return error.CurvePullLoopCutRefused;
        }

        ids[write] = source.ids[segment];
        base[write] = a;
        params[write] = source.params[segment];
        write += 1;
        var cut: u32 = 1;
        while (cut <= cuts) : (cut += 1) {
            const point = curveCutPoint(a, b, cut, cuts);
            ids[write] = indexedVertexAtPoint(mesh, before_vertices, point, source.part) orelse
                return error.CurvePullCutVertexMissing;
            base[write] = point;
            const t = @as(f32, @floatFromInt(cut)) / @as(f32, @floatFromInt(cuts + 1));
            params[write] = source.params[segment] + (source.params[segment + 1] - source.params[segment]) * t;
            write += 1;
        }
    }
    ids[write] = source.ids[source.ids.len - 1];
    base[write] = source.base[source.base.len - 1];
    params[write] = source.params[source.params.len - 1];
    write += 1;
    if (write != output_count) return error.CurvePullPathCountMismatch;

    // A connected loop cut often reaches the mirrored side by itself.  Disconnected
    // mirrored halves do not, so prove the reflected samples exist before deciding
    // whether that side needs its own propagated cut.  The returned selected path is
    // still only the user's side; ordinary mirror writeback moves the reflected rows.
    if (cuts > 0) {
        for (mirrors) |mirror| {
            if (mirror.base.len != source.base.len) return error.InvalidCurvePullMirrorPath;
            segment = 0;
            while (segment < edge_count) : (segment += 1) {
                const a = mirror.base[segment];
                const b = mirror.base[segment + 1];
                if (indexedSegmentAlreadyDensified(mesh, a, b, mirror.part, cuts)) continue;
                if (!(try mesh.loopCutFromEdge(a, b, mirror.part, cuts, 0.5))) {
                    return error.CurvePullMirrorLoopCutRefused;
                }
            }
        }
    }

    return .{ .allocator = allocator, .ids = ids, .base = base, .params = params };
}

/// Re-arm the deformation after a topology rebuild.  `base` remains the straight,
/// grab-time path while the resident vertices may already show the current bend; the
/// next drag frame therefore continues absolute application with no jump or drift.
pub fn curvePullAdoptDensified(path: *const CurvePullDensifiedPath, selection_mode: Mode, part: u32, grab_t: f32) bool {
    if ((selection_mode != .vertex and selection_mode != .edge) or path.ids.len < 3 or
        path.base.len != path.ids.len or path.params.len != path.ids.len or
        path.ids.len > curve_pull_tuning.max_path_verts or !ensureTopology()) return false;
    const parts = g_vert_part orelse return false;
    var i: usize = 0;
    while (i < path.ids.len) : (i += 1) {
        const id = path.ids[i];
        if (id >= g_vert_count or id >= parts.len or parts[id] != part or
            !std.math.isFinite(path.params[i]) or
            (i > 0 and path.params[i] <= path.params[i - 1])) return false;
        if (i > 0) {
            const edge = edgeIndexBetween(path.ids[i - 1], id) orelse return false;
            if (!edgeIsBoundaryPub(edge) or !edgeInScopePub(edge)) return false;
        }
    }

    const ids = alloc.dupe(u32, path.ids) catch return false;
    const base = alloc.dupe([3]f32, path.base) catch {
        alloc.free(ids);
        return false;
    };
    const params = alloc.dupe(f32, path.params) catch {
        alloc.free(ids);
        alloc.free(base);
        return false;
    };
    const scratch = alloc.alloc(bool, g_vert_count) catch {
        alloc.free(ids);
        alloc.free(base);
        alloc.free(params);
        return false;
    };

    var grab: usize = 0;
    for (params, 0..) |station, index| {
        if (@abs(station - grab_t) < @abs(params[grab] - grab_t)) grab = index;
    }

    curvePullEnd();
    g_curve_ids = ids;
    g_curve_base = base;
    g_curve_params = params;
    g_curve_grab = grab;
    g_curve_mask = scratch;
    g_curve_mode = selection_mode;
    g_curve_part = part;
    g_mode = selection_mode;
    if (selection_mode == .vertex) {
        const selected = g_sel_vert orelse {
            curvePullEnd();
            return false;
        };
        @memset(selected, false);
        for (path.ids) |id| selected[id] = true;
    } else {
        const selected = g_sel_edge orelse {
            curvePullEnd();
            return false;
        };
        @memset(selected, false);
        i = 1;
        while (i < path.ids.len) : (i += 1) selected[edgeIndexBetween(path.ids[i - 1], path.ids[i]).?] = true;
    }
    applyFaceHighlight();
    return true;
}

fn selectedAlignmentEdge(edge: u32, mask: []const bool) bool {
    const edges = g_edges orelse return false;
    if (edge >= g_edge_count) return false;
    const a = edges[edge * 2];
    const b = edges[edge * 2 + 1];
    if (a >= mask.len or b >= mask.len or !mask[a] or !mask[b]) return false;
    return switch (g_mode) {
        .edge => if (g_sel_edge) |selected| edge < selected.len and selected[edge] and edgeInScopePub(edge) else false,
        .vertex => edgeIsBoundaryPub(edge) and edgeInScopePub(edge),
        else => false,
    };
}

/// Refuse branched or disconnected selections before a center-plane collapse.
/// Edge mode follows exactly the selected authored edges; vertex mode follows
/// visible authored edges between selected vertices (never hidden quad diagonals).
fn selectionFormsOnePathOrLoop(mask: []const bool, selected_count: u32) bool {
    const edges = g_edges orelse return false;
    const degrees = alloc.alloc(u8, g_vert_count) catch return false;
    defer alloc.free(degrees);
    @memset(degrees, 0);
    var selected_edges: u32 = 0;
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!selectedAlignmentEdge(edge, mask)) continue;
        const a = edges[edge * 2];
        const b = edges[edge * 2 + 1];
        if (degrees[a] == 2 or degrees[b] == 2) return false;
        degrees[a] += 1;
        degrees[b] += 1;
        selected_edges += 1;
    }
    if (selected_edges == 0) return false;
    var endpoints: u32 = 0;
    var first: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        if (!mask[vertex]) continue;
        if (degrees[vertex] == 0) return false;
        if (degrees[vertex] == 1) endpoints += 1;
        if (first == null) first = vertex;
    }
    if (endpoints != 0 and endpoints != 2) return false;

    const visited = alloc.alloc(bool, g_vert_count) catch return false;
    defer alloc.free(visited);
    @memset(visited, false);
    const queue = alloc.alloc(u32, selected_count) catch return false;
    defer alloc.free(queue);
    queue[0] = first orelse return false;
    visited[queue[0]] = true;
    var head: usize = 0;
    var tail: usize = 1;
    while (head < tail) : (head += 1) {
        const current = queue[head];
        edge = 0;
        while (edge < g_edge_count) : (edge += 1) {
            if (!selectedAlignmentEdge(edge, mask)) continue;
            const a = edges[edge * 2];
            const b = edges[edge * 2 + 1];
            const next = if (a == current) b else if (b == current) a else continue;
            if (visited[next]) continue;
            visited[next] = true;
            if (tail >= queue.len) return false;
            queue[tail] = next;
            tail += 1;
        }
    }
    return tail == selected_count;
}

/// Flatten the current vertex/edge selection in one motion. The smallest
/// coordinate span is the intended station plane: a vertical body row
/// chooses X, a horizontal ring chooses Y, and a depth station chooses Z. Axes
/// already flat make the operation an idempotent no-op. The ordinary transform
/// core owns welded corners and live mirror twins, so alignment keeps both guarantees.
pub fn alignSelectedLoop() ?AlignLoopResult {
    if (g_mode != .vertex and g_mode != .edge) return null;
    const mask = fillAffectedVerts() orelse return null;
    var min = [3]f32{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) };
    var max = [3]f32{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) };
    var count: u32 = 0;
    var vertex: u32 = 0;
    while (vertex < g_vert_count) : (vertex += 1) {
        if (!mask[vertex]) continue;
        const position = vertPos(vertex);
        inline for (0..3) |axis| {
            min[axis] = @min(min[axis], position[axis]);
            max[axis] = @max(max[axis], position[axis]);
        }
        count += 1;
    }
    if (count < 2) return null;
    if (!selectionFormsOnePathOrLoop(mask, count)) return null;

    var best_axis: ?u8 = null;
    var best_span = std.math.inf(f32);
    for (0..3) |axis| {
        const span = max[axis] - min[axis];
        if (!std.math.isFinite(span) or span >= best_span) continue;
        best_axis = @intCast(axis);
        best_span = span;
    }
    const axis = best_axis orelse return null;
    if (best_span <= AlignLoopTuning.minimum_span_m) return null;
    const pivot = selectionPivot() orelse return null;
    var direction = [3]f32{ 0, 0, 0 };
    direction[axis] = 1;
    const mutation = applyTransform(.scale_axis, .{ 0, 0, 0 }, direction, pivot, 0);
    if (!mutation.changed) return null;
    return .{ .mutation = mutation, .axis = axis, .coordinate = pivot[axis] };
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
    if (g_mode == .vertex or g_mode == .edge) _ = refreshCameraVisibility(cam, vp_w, vp_h);

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
    // Every mode consumes the camera masks here: vertex/edge gate on their
    // per-element visibility, and the face branch tests centroids against the
    // same occlusion buffer the drawn face dots obey (req_4610). The build is
    // key-cached, so the parked-camera marquee pays for it once.
    _ = refreshCameraVisibility(cam, vp_w, vp_h);
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
                // Surface mode: a face whose center is buried behind a nearer
                // surface draws no dot, so it must not catch the marquee either
                // (drawn == clickable, req_3856's buffer applied here, req_4610).
                // Back-face culling alone let a box sweep the model's FAR SIDE and
                // everything hidden behind the front wall. X-Ray leaves
                // g_occ_ready false, so this gate is inert there by construction.
                if (!g_xray and occPointHidden(c)) continue;
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
        // The camera-visible gate above IS the Surface-mode occlusion filter (with
        // the same slope bias the drawn markers get), so what draws is exactly what
        // clicks; X-Ray deliberately restores through-model handles (req_3861).
        if (d2 < best_d2) {
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
        // Same rule as pickVertex: edgeCameraVisiblePub already carries Surface-mode
        // occlusion (span-sampled, slope-biased) — a drawn edge is a clickable edge.
        if (d2 < best_d2) {
            best_d2 = d2;
            best = @intCast(e);
        }
    }
    return best;
}

// ── Interactive edge-path pick (req_4271) ────────────────────────────────────────
// Ctrl+click on an edge selects a whole edge path; ctrl+clicking the SAME edge again
// cycles through every path the topology offers through it, in a fixed stated order:
// quad loop → edge ring → the single edge. Which path is "right" is the user's call,
// so the editor shows each in turn instead of guessing. Identical sets collapse (a
// pole-bounded loop of one edge doesn't repeat as "single edge"), and any topology
// change or a click on a different edge starts a fresh cycle.
var g_pathcycle_edge: i64 = -1; // seed edge of the live cycle, -1 = none
var g_pathcycle_index: u32 = 0; // which candidate the NEXT click applies
var g_pathcycle_built_for: u32 = 0; // facecount the cycle was computed against
var g_pathcycle_base: ?[]bool = null; // selection the cycle unions onto (additive picks)

fn pathCycleReset() void {
    if (g_pathcycle_base) |base| alloc.free(base);
    g_pathcycle_base = null;
    g_pathcycle_edge = -1;
    g_pathcycle_index = 0;
}

fn pathCandidateEqual(a: []const u32, b: []const u32) bool {
    if (a.len != b.len) return false;
    // Candidate runs are tiny relative to the mesh; sorted copies keep the
    // comparison order-independent without touching the originals.
    const sa = alloc.dupe(u32, a) catch return false;
    defer alloc.free(sa);
    const sb = alloc.dupe(u32, b) catch return false;
    defer alloc.free(sb);
    std.mem.sort(u32, sa, {}, std.sort.asc(u32));
    std.mem.sort(u32, sb, {}, std.sort.asc(u32));
    return std.mem.eql(u32, sa, sb);
}

/// Follow an OPEN-BOUNDARY loop: the run of naked edges (exactly one incident face)
/// through the seed — a cylinder rim, a plane border, any hole's mouth. This is the
/// path a quad-loop walk can never return (a rim vertex is never a clean 4-way
/// junction), and it is exactly the run a bridge selects. Continuation at a vertex
/// is the unique OTHER naked edge; several candidates is a pole and stops the walk.
fn collectNakedLoopEdges(seed: u32) ?CollectedEdgeWalk {
    if (!walkEdgeUsable(seed)) return null;
    const incidence = g_edge_incidence orelse return null;
    if (seed >= incidence.len or incidence[seed] >= 2) return null; // not an open-boundary edge
    const index = buildVertexEdgeIndex() orelse return null;
    defer index.deinit();
    var collected = std.ArrayListUnmanaged(u32).empty;
    defer collected.deinit(alloc);
    const seen = alloc.alloc(bool, g_edge_count) catch return null;
    defer alloc.free(seen);
    @memset(seen, false);
    collected.append(alloc, seed) catch return null;
    seen[seed] = true;

    var termination: WalkTermination = .closed;
    var stopped_at: u32 = seed;
    const edges = g_edges orelse return null;
    for ([2]u32{ edges[seed * 2], edges[seed * 2 + 1] }) |start| {
        var current_edge = seed;
        var vertex = start;
        while (true) {
            var next_edge: ?u32 = null;
            var naked_here: u32 = 0;
            for (index.slice(vertex)) |edge| {
                if (edge == current_edge) continue;
                if (edge >= incidence.len or incidence[edge] >= 2) continue;
                naked_here += 1;
                if (next_edge == null or edge < next_edge.?) next_edge = edge;
            }
            if (naked_here != 1) {
                termination = if (naked_here == 0) .boundary else .pole;
                stopped_at = vertex;
                break;
            }
            const step = next_edge.?;
            if (seen[step]) {
                termination = .closed;
                stopped_at = vertex;
                break;
            }
            seen[step] = true;
            collected.append(alloc, step) catch return null;
            vertex = walkOtherEnd(step, vertex);
            current_edge = step;
        }
        if (termination == .closed) break;
    }
    const owned = collected.toOwnedSlice(alloc) catch return null;
    return .{ .ids = owned, .terminated = termination, .stopped_at = stopped_at };
}

/// Every usable boundary edge of one authored face group — the loop AROUND a
/// face. On a capped cylinder this is the top/bottom loop itself: the rim vertex
/// is never a 4-way junction (so the quad-loop walk stops immediately) and the cap
/// is not a quad (so the ring walk refuses), but the cap's boundary IS the loop
/// the click meant (req_4271, the pot rim). Quads count too — a cube's top ring
/// is exactly the top face's boundary, and nothing else can reach it through the
/// cube's all-pole corners (req_4277).
fn collectGroupBoundaryEdges(group: u32) ?CollectedEdgeWalk {
    var collected = std.ArrayListUnmanaged(u32).empty;
    defer collected.deinit(alloc);
    var edge: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!walkEdgeUsable(edge)) continue;
        var groups: [8]u32 = undefined;
        const group_count = walkEdgeGroups(edge, &groups);
        var borders = false;
        for (groups[0..group_count]) |have| borders = borders or have == group;
        if (!borders) continue;
        collected.append(alloc, edge) catch return null;
    }
    if (collected.items.len < 3) return null;
    const owned = collected.toOwnedSlice(alloc) catch return null;
    return .{ .ids = owned, .terminated = .closed, .stopped_at = owned[0] };
}

/// The ctrl+click pick. Edge mode only — other modes fall through to the plain pick.
/// `additive` (shift held) unions the path onto the selection as it stood when THIS
/// cycle started, so cycling a second path never accumulates its own earlier looks.
pub fn pathPick(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32, additive: bool) i32 {
    if (g_mode != .edge) return pick(cam, vp_w, vp_h, mx, my, additive);
    if (!ensureTopology()) return -1;
    _ = refreshCameraVisibility(cam, vp_w, vp_h);
    const hit = pickEdge(cam, vp_w, vp_h, mx, my);
    const sel = g_sel_edge orelse return -1;
    if (hit < 0) {
        pathCycleReset();
        if (!additive) clearSelection();
        return @intCast(selCount());
    }
    const seed: u32 = @intCast(hit);
    const same_cycle = g_pathcycle_edge == @as(i64, seed) and
        g_pathcycle_built_for == model_paint.faceCount() and
        g_pathcycle_base != null and g_pathcycle_base.?.len == sel.len;
    if (!same_cycle) {
        pathCycleReset();
        g_pathcycle_edge = @as(i64, seed);
        g_pathcycle_built_for = model_paint.faceCount();
        const base = alloc.alloc(bool, sel.len) catch return -1;
        if (additive) @memcpy(base, sel) else @memset(base, false);
        g_pathcycle_base = base;
    }

    // Build the candidate list fresh each click — the mesh is live and a stale run
    // would select edges that no longer mean what they meant. Order is stated and
    // fixed: open-boundary loop (a rim is what you meant when you clicked a rim),
    // the quad loop when it actually travelled (the long ring stays the first look
    // on interior edges), adjacent face-boundary loops (a cube's top ring, a cap's
    // rim — the loops no walk can reach through all-pole corners, req_4277), the
    // edge ring when IT travelled, then the single edge. A walk that terminated at
    // its seed is not a path — it never claims an early cycle slot; identical sets
    // collapse so the cycle never repeats a look.
    var candidates: [6][]u32 = undefined;
    var candidate_count: u32 = 0;
    defer for (candidates[0..candidate_count]) |ids| alloc.free(ids);
    const addCandidate = struct {
        fn add(list: *[6][]u32, count: *u32, ids: []u32) void {
            var duplicate = false;
            for (list[0..count.*]) |have| duplicate = duplicate or pathCandidateEqual(have, ids);
            if (duplicate or count.* >= list.len) {
                alloc.free(ids);
            } else {
                list[count.*] = ids;
                count.* += 1;
            }
        }
    }.add;
    if (collectNakedLoopEdges(seed)) |run| addCandidate(&candidates, &candidate_count, run.ids);
    if (collectLoopEdges(seed)) |run| {
        if (run.ids.len > 1) addCandidate(&candidates, &candidate_count, run.ids) else alloc.free(run.ids);
    }
    {
        var seed_groups: [8]u32 = undefined;
        const seed_group_count = walkEdgeGroups(seed, &seed_groups);
        // A non-quad neighbour's boundary (a cap n-gon) outranks a quad's own
        // perimeter: a pot-rim click means the cap loop, never the wall's sides.
        for ([2]bool{ false, true }) |quads_pass| {
            for (seed_groups[0..seed_group_count]) |group| {
                if ((walkGroupDistinctVertCount(group) == 4) != quads_pass) continue;
                if (collectGroupBoundaryEdges(group)) |run| addCandidate(&candidates, &candidate_count, run.ids);
            }
        }
    }
    if (collectRingEdges(seed)) |run| {
        if (run.ids.len > 1) addCandidate(&candidates, &candidate_count, run.ids) else alloc.free(run.ids);
    }
    single: {
        const one = alloc.alloc(u32, 1) catch break :single;
        one[0] = seed;
        addCandidate(&candidates, &candidate_count, one);
    }
    if (candidate_count == 0) return @intCast(selCount());

    const chosen = candidates[g_pathcycle_index % candidate_count];
    g_pathcycle_index +%= 1;
    @memcpy(sel, g_pathcycle_base.?);
    for (chosen) |edge| {
        if (edge < sel.len) sel[edge] = true;
    }
    return @intCast(selCount());
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
    try testing.expect(refreshCameraVisibility(cam, 800, 600));
    // Camera-facing but behind the front part: the drawn-overlay mask now agrees
    // with the pick gate — Surface mode hides it entirely (req_3856).
    try testing.expect(!vertexCameraVisiblePub(0));
    try testing.expect(overlayPointOccludedPub(hidden_vert));

    setXray(true);
    try testing.expect(vertexCameraVisiblePub(0)); // X-Ray restores through-model handles
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

test "an edge with both endpoints occluded still draws where its middle crosses the view" {
    // The zoomed-in regression (req_3859): a long hull edge crosses the view while
    // both of its endpoints sit BEHIND other parts. The endpoint-derived rule alone
    // would hide an edge you are looking straight at; span sampling must keep it,
    // while the hidden endpoint markers stay hidden.
    var verts = [_]f32{
        // scoped part, group 0: one wide triangle, bottom edge x ∈ [-2.8, 2.8] at z=0
        -2.8, 0.0,  0.0, 0, 0, 1, 0, 0,
        2.8,  0.0,  0.0, 0, 0, 1, 0, 0,
        0.0,  1.0,  0.0, 0, 0, 1, 0, 0,
        // occluder part, group 1+2: two panels at z=2 covering only the endpoint rays
        1.2,  -3.0, 2.0, 0, 0, 1, 0, 0,
        2.4,  -3.0, 2.0, 0, 0, 1, 0, 0,
        1.8,  6.0,  2.0, 0, 0, 1, 0, 0,
        -2.4, -3.0, 2.0, 0, 0, 1, 0, 0,
        -1.2, -3.0, 2.0, 0, 0, 1, 0, 0,
        -1.8, 6.0,  2.0, 0, 0, 1, 0, 0,
    };
    model_paint.setTarget(795, verts[0..], 9);
    model_source.setFaceGroups(&[_]u32{ 0, 1, 2 });
    model_source.setPartRanges(&[_]u32{ 0, 1, 1, 3 });
    setEditScope(0, 1);
    defer {
        setXray(false);
        setEditScope(0, 0);
        reset();
        model_paint.clear();
        model_source.clear();
    }

    const cam = model_paint.Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    try testing.expect(model_paint.occluded(cam, .{ -2.8, 0, 0 }));
    try testing.expect(model_paint.occluded(cam, .{ 2.8, 0, 0 }));
    try testing.expect(!model_paint.occluded(cam, .{ 0, 0, 0 })); // the middle is in plain view

    try testing.expect(ensureTopology());
    setMode(.edge);
    setXray(false);
    try testing.expect(refreshCameraVisibility(cam, 800, 600));
    try testing.expect(!vertexCameraVisiblePub(0)); // endpoint markers stay honest
    try testing.expect(!vertexCameraVisiblePub(1));
    try testing.expect(vertexCameraVisiblePub(2)); // apex is unobstructed

    var span_edge: ?u32 = null;
    var edge: u32 = 0;
    while (edge < edgeCount()) : (edge += 1) {
        const ends = edgeEndpointsPub(edge);
        if ((ends[0] == 0 and ends[1] == 1) or (ends[0] == 1 and ends[1] == 0)) span_edge = edge;
    }
    try testing.expect(span_edge != null);
    try testing.expect(edgeCameraVisiblePub(span_edge.?));
}

test "a point at a grazing silhouette stays visible; a buried point stays hidden" {
    // The hull-at-a-shallow-angle regression (req_3861/3867): a panel seen nearly
    // edge-on sweeps a huge depth range across a handful of pixels, so any
    // depth-compare with scalar slack either hides markers a hair past the
    // silhouette or lets the far side bleed through. The depth buffer's
    // neighborhood answers it structurally: a near-silhouette point sees the
    // background texel just past the rim, a buried point sees nothing but
    // nearer panel in every direction.
    var verts = [_]f32{
        // one flat panel, y=0, x ∈ [-2,2], z ∈ [-6,0], normal +y
        -2.0, 0.0, 0.0,  0, 1, 0, 0, 0,
        2.0,  0.0, -6.0, 0, 1, 0, 0, 0,
        -2.0, 0.0, -6.0, 0, 1, 0, 0, 0,
        -2.0, 0.0, 0.0,  0, 1, 0, 0, 0,
        2.0,  0.0, 0.0,  0, 1, 0, 0, 0,
        2.0,  0.0, -6.0, 0, 1, 0, 0, 0,
    };
    model_paint.setTarget(796, verts[0..], 6);
    model_source.setFaceGroups(&[_]u32{ 0, 0 });
    model_source.setPartRanges(&[_]u32{ 0, 1 });
    defer {
        setXray(false);
        reset();
        model_paint.clear();
        model_source.clear();
    }

    // Barely above the panel, looking almost along it — the grazing view.
    const cam = model_paint.Camera{ .eye = .{ 0, 0.2, 5 }, .target = .{ 0, 0, -1 }, .fov_deg = 50 };
    try testing.expect(ensureTopology());
    setMode(.vertex);
    setXray(false);
    try testing.expect(refreshCameraVisibility(cam, 800, 600));

    // Just past the far silhouette: the raw ray test calls it occluded, but its
    // buffer neighborhood reaches the open background past the panel's rim — the
    // overlay must keep it.
    const near_silhouette = [3]f32{ 0, -0.01, -6.2 };
    try testing.expect(model_paint.occluded(cam, near_silhouette));
    try testing.expect(!overlayPointOccludedPub(near_silhouette));

    // Well underneath the panel, screenwise inside its footprint: every nearby
    // texel shows nearer panel — the neighborhood is a silhouette courtesy, not
    // X-Ray through the floor.
    const buried = [3]f32{ 0, -0.15, -6.2 };
    try testing.expect(model_paint.occluded(cam, buried));
    try testing.expect(overlayPointOccludedPub(buried));
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

test "face selection transform respects a same-part explicit split seam" {
    var verts = [_]f32{
        // Two triangles remain position-coincident along the diagonal, but Edge
        // Split has assigned each face its own durable endpoint identities.
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    model_paint.setTarget(4400, &verts, 6);
    model_source.retain("edge-split-seam", &verts, 6);
    model_source.setFaceGroups(&.{ 0, 1 });
    try testing.expect(model_source.setLogicalTopology(&.{ 0, 1, 2, 3, 4, 5 }, 6));
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }

    try testing.expect(ensureTopology());
    try testing.expect(selectFaceByIndex(0, false));
    try testing.expectEqual(@as(u32, 6), vertCount());
    const mutation = translateSelection(.{ 0, 0, 2 });
    try testing.expect(mutation.changed);
    try testing.expectEqual(@as(u32, 0), mutation.first_face);
    try testing.expectEqual(@as(u32, 0), mutation.last_face);

    const positions = model_paint.positions().?;
    for (0..3) |corner| try testing.expectApproxEqAbs(@as(f32, 2), positions[corner * 3 + 2], 0.0001);
    for (3..6) |corner| try testing.expectApproxEqAbs(@as(f32, 0), positions[corner * 3 + 2], 0.0001);
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

fn findVertAtInPart(p: [3]f32, part: u32) ?u32 {
    const parts = g_vert_part orelse return null;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (parts[@intCast(i)] != part) continue;
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

test "mirror X keeps a detached part on one whole counterpart owner despite a coincident seam vertex" {
    var first: [12 * 3 * 8]f32 = undefined;
    var second: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&first);
    buildCubeSoup(&second);
    var corner: usize = 0;
    while (corner < 12 * 3) : (corner += 1) {
        first[corner * 8 + 0] -= 2;
        second[corner * 8 + 0] += 2;
    }
    var soup: [25 * 3 * 8]f32 = undefined;
    @memcpy(soup[0..first.len], first[0..]);
    @memcpy(soup[first.len .. first.len + second.len], second[0..]);
    const decoy = [3][3]f32{
        .{ 2.5, -0.5, -0.5 }, // coincides with one legitimate target-part vertex
        .{ 9.0, 9.0, 9.0 },
        .{ 9.0, 10.0, 9.0 },
    };
    for (decoy, 0..) |point, slot| {
        const base = (24 * 3 + slot) * 8;
        soup[base + 0] = point[0];
        soup[base + 1] = point[1];
        soup[base + 2] = point[2];
        @memset(soup[base + 3 .. base + 8], 0);
    }
    var groups: [25]u32 = undefined;
    for (0..12) |face| {
        groups[face] = @intCast(face / 2);
        groups[12 + face] = @intCast(6 + face / 2);
    }
    groups[24] = 12;
    model_source.setFaceGroups(groups[0..]);
    model_source.setPartRanges(&.{ 0, 6, 6, 12, 12, 13 });
    model_paint.setTarget(799, soup[0..], 75);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        setMirrorMask(0);
    }
    setMirrorMask(1);
    setMode(.vertex);
    try testing.expect(ensureTopology());
    const source = findVertAtInPart(.{ -2.5, -0.5, -0.5 }, 0).?;
    const target = findVertAtInPart(.{ 2.5, -0.5, -0.5 }, 1).?;
    const unrelated = findVertAtInPart(.{ 2.5, -0.5, -0.5 }, 2).?;
    g_sel_vert.?[source] = true;

    const mutation = translateSelection(.{ 0, 0.25, 0 });
    try testing.expect(mutation.changed);
    try testing.expectApproxEqAbs(@as(f32, -0.25), vertPos(target)[1], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(unrelated)[1], 0.0001);
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

// ── Per-document session (req_3850) ─────────────────────────────────────────
// The module's resident-model globals, parked by value. Pointer fields move by
// pointer — no deep copies, no frees. INVARIANT: a parked Session's contents are
// only meaningful while its document is NOT active; the coordinator in 3d.zig
// overwrites the record at every park. Adding a resident-model `var g_*` to this
// module requires adding the same name here, or that state silently leaks
// between documents.
pub const Session = struct {
    g_mode: @TypeOf(g_mode) = .none,
    g_built_for: @TypeOf(g_built_for) = 0,
    g_verts: @TypeOf(g_verts) = null,
    g_vert_count: @TypeOf(g_vert_count) = 0,
    g_vert_part: @TypeOf(g_vert_part) = null,
    g_corner_vert: @TypeOf(g_corner_vert) = null,
    g_edges: @TypeOf(g_edges) = null,
    g_edge_count: @TypeOf(g_edge_count) = 0,
    g_edge_boundary: @TypeOf(g_edge_boundary) = null,
    g_edge_incidence: @TypeOf(g_edge_incidence) = null,
    g_edge_wire: @TypeOf(g_edge_wire) = null,
    g_scope_active: @TypeOf(g_scope_active) = false,
    g_scope_ranges: @TypeOf(g_scope_ranges) = undefined,
    g_scope_count: @TypeOf(g_scope_count) = 0,
    g_scope_vert: @TypeOf(g_scope_vert) = null,
    g_scope_edge: @TypeOf(g_scope_edge) = null,
    g_scope_built: @TypeOf(g_scope_built) = 0,
    g_affect_vert: @TypeOf(g_affect_vert) = null,
    g_mirror_twin: @TypeOf(g_mirror_twin) = null,
    g_mirror_built_for: @TypeOf(g_mirror_built_for) = 0,
    g_mirror_built_mask: @TypeOf(g_mirror_built_mask) = 0,
    g_mirror_affect: @TypeOf(g_mirror_affect) = null,
    g_sel_vert: @TypeOf(g_sel_vert) = null,
    g_sel_edge: @TypeOf(g_sel_edge) = null,
    g_sel_face: @TypeOf(g_sel_face) = null,
    g_face_base: @TypeOf(g_face_base) = .empty,
    g_tint_suspend: @TypeOf(g_tint_suspend) = 0,
    g_snap: @TypeOf(g_snap) = null,
    g_snap_mode: @TypeOf(g_snap_mode) = .none,
    g_camera_visible_vert: @TypeOf(g_camera_visible_vert) = null,
    g_camera_visible_edge: @TypeOf(g_camera_visible_edge) = null,
    g_occ_depth: @TypeOf(g_occ_depth) = &.{},
    g_occ_bw: @TypeOf(g_occ_bw) = 0,
    g_occ_bh: @TypeOf(g_occ_bh) = 0,
    g_occ_ready: @TypeOf(g_occ_ready) = false,
    g_occ_cam: @TypeOf(g_occ_cam) = .{ .eye = .{ 0, 0, 0 }, .target = .{ 0, 0, 1 }, .fov_deg = 50 },
    g_vis_key: @TypeOf(g_vis_key) = null,
};

pub fn sessionSave(s: *Session) void {
    inline for (@typeInfo(Session).@"struct".fields) |f|
        @field(s, f.name) = @field(@This(), f.name);
}

pub fn sessionLoad(s: *const Session) void {
    inline for (@typeInfo(Session).@"struct".fields) |f|
        @field(@This(), f.name) = @field(s, f.name);
    g_occ_ready = false; // occlusion grid is camera-derived; rebuild for the restored mesh
    g_vis_key = null; // …so the cache must not claim the grid it describes is standing
}

pub fn sessionReset() void {
    const fresh = Session{};
    inline for (@typeInfo(Session).@"struct".fields) |f|
        @field(@This(), f.name) = @field(fresh, f.name);
    // Deliberately frees NOTHING: ownership of the previous state lives in the
    // record the coordinator just parked.
}

/// End command-lifetime previews before switching or destroying model sessions.
///
/// Curve Pull, edge-path cycling, and intent-amplifier walks deliberately do not
/// park: each retains borrowed topology identity or a selection baseline whose
/// numeric indices can look valid in a different document. Clearing only Curve
/// Pull allowed a same-sized document to inherit an old path-cycle baseline, and
/// a staged walk token could apply the prior document's ids. The process-monotonic
/// walk counter survives; only the document-relative staged capability is revoked.
pub fn sessionInvalidateTransients() void {
    curvePullEnd();
    pathCycleReset();
    clearWalkPlan();
}

/// Destroy one INACTIVE document's parked mesh-edit state.
///
/// This is deliberately not implemented by loading the record and calling `reset()`.
/// Loading would replace the active document, while `reset()` also unwinds legacy face
/// tint through the active `model_paint` authority. A parked legacy patch belongs to the
/// parked document: final teardown frees its bytes without replaying them into whichever
/// atlas happens to be active now. Every other pointer below is likewise owned solely by
/// the parked Session after the coordinator has completed park -> reset/load.
pub fn sessionDeinitParked(s: *Session) void {
    if (s.g_verts) |value| alloc.free(value);
    if (s.g_vert_part) |value| alloc.free(value);
    if (s.g_corner_vert) |value| alloc.free(value);
    if (s.g_edges) |value| alloc.free(value);
    if (s.g_edge_boundary) |value| alloc.free(value);
    if (s.g_edge_incidence) |value| alloc.free(value);
    if (s.g_edge_wire) |value| alloc.free(value);
    if (s.g_scope_vert) |value| alloc.free(value);
    if (s.g_scope_edge) |value| alloc.free(value);
    if (s.g_affect_vert) |value| alloc.free(value);
    if (s.g_mirror_twin) |value| alloc.free(value);
    if (s.g_mirror_affect) |value| alloc.free(value);
    if (s.g_sel_vert) |value| alloc.free(value);
    if (s.g_sel_edge) |value| alloc.free(value);
    if (s.g_sel_face) |value| alloc.free(value);
    if (s.g_snap) |value| alloc.free(value);
    if (s.g_camera_visible_vert) |value| alloc.free(value);
    if (s.g_camera_visible_edge) |value| alloc.free(value);
    if (s.g_occ_depth.len > 0) alloc.free(s.g_occ_depth);

    var patches = s.g_face_base.iterator();
    while (patches.next()) |entry| alloc.free(entry.value_ptr.*);
    s.g_face_base.deinit(alloc);

    // An empty value makes final teardown idempotent and prevents a stale parked record
    // from retaining counts/cache keys that describe storage it no longer owns.
    s.* = .{};
}

test "session transient invalidation revokes every non-parked allocation" {
    sessionInvalidateTransients();
    defer sessionInvalidateTransients();

    g_curve_ids = alloc.dupe(u32, &.{ 1, 2, 3 }) catch return error.OutOfMemory;
    g_curve_base = alloc.dupe([3]f32, &.{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 2, 0, 0 } }) catch return error.OutOfMemory;
    g_curve_params = alloc.dupe(f32, &.{ 0, 0.5, 1 }) catch return error.OutOfMemory;
    g_curve_mask = alloc.dupe(bool, &.{ true, true, true }) catch return error.OutOfMemory;
    g_pathcycle_base = alloc.dupe(bool, &.{ true, false }) catch return error.OutOfMemory;
    g_pathcycle_edge = 4;
    g_pathcycle_index = 2;
    g_pathcycle_built_for = 8;
    g_walk_ids = alloc.dupe(u32, &.{ 9, 10 }) catch return error.OutOfMemory;
    g_walk_token = 51;
    const counter_before = g_walk_counter;

    sessionInvalidateTransients();
    sessionInvalidateTransients();

    try testing.expect(g_curve_ids == null);
    try testing.expect(g_curve_base == null);
    try testing.expect(g_curve_params == null);
    try testing.expect(g_curve_mask == null);
    try testing.expect(g_pathcycle_base == null);
    try testing.expectEqual(@as(i64, -1), g_pathcycle_edge);
    try testing.expectEqual(@as(u32, 0), g_pathcycle_index);
    try testing.expect(g_walk_ids == null);
    try testing.expectEqual(@as(u64, 0), g_walk_token);
    try testing.expectEqual(counter_before, g_walk_counter);
}

// ── Intent amplifiers: two decisions expand to N correct elements (req_4061) ─────
//
// The agent supplies INTENT (two picks, a seed edge, a seed face); the editor supplies
// TOPOLOGY (the walk). This exists because agents are bad at exactly what it removes:
// long ephemeral id lists, per-element loops, and re-reading `elements` between steps.
// A walk that runs here also works on meshes far too dense to page across the socket.
//
// Two rules every walk obeys, because a silent arbitrary answer makes an agent undo-loop:
//   1. PREVIEW FIRST. A walk stages its result and reports what it computed; nothing
//      touches the live selection until `walkApply` is handed the matching token.
//   2. STATE WHY IT STOPPED AND HOW TIES BROKE. "Shortest path" and "loop continuation"
//      both have ambiguous cases; the reply names the rule that resolved them.

pub const WalkKind = enum { path, loop, ring, grow, similar };
pub const WalkSimilarBy = enum { normal, coplanar, area };
pub const WalkDomain = enum { vertex, edge, face };

pub const WalkRequest = struct {
    kind: WalkKind,
    /// path: logical vertex endpoints.
    from: u32 = 0,
    to: u32 = 0,
    /// path: restrict travel to edges that make monotone progress along this axis
    /// (0/1/2). 255 = unconstrained.
    axis: u8 = 255,
    /// loop / ring: the seed edge.
    edge: u32 = 0,
    /// grow: how many adjacency rings to expand by.
    rings: u32 = 1,
    /// similar: the seed face and what "similar" means.
    face: u32 = 0,
    by: WalkSimilarBy = .normal,
    /// degrees for normal/coplanar, relative fraction for area.
    tolerance: f32 = 10,
};

// `unreached` rather than `unreachable`: the latter is a Zig keyword.
pub const WalkTermination = enum { closed, boundary, pole, exhausted, unreached, complete };

pub const WalkPlan = struct {
    token: u64,
    domain: WalkDomain,
    count: u32,
    terminated: WalkTermination,
    /// The vertex a loop/ring walk stopped at, when the reason names one.
    stopped_at: u32,
    bbox: [6]f32,
};

/// The staged set. One at a time: a second plan replaces the first, so an agent can
/// never apply a walk it did not just read.
var g_walk_ids: ?[]u32 = null;
var g_walk_domain: WalkDomain = .face;
var g_walk_token: u64 = 0;
var g_walk_built_for: u32 = 0;
var g_walk_counter: u64 = 0;

fn clearWalkPlan() void {
    if (g_walk_ids) |ids| alloc.free(ids);
    g_walk_ids = null;
    g_walk_token = 0;
}

/// vertex → its incident boundary-edge ids, flattened CSR-style. Built per walk so a
/// traversal is linear in the mesh instead of rescanning the edge table per step.
const VertexEdgeIndex = struct {
    offsets: []u32,
    edges: []u32,

    fn deinit(self: VertexEdgeIndex) void {
        alloc.free(self.offsets);
        alloc.free(self.edges);
    }
    fn slice(self: VertexEdgeIndex, vertex: u32) []const u32 {
        if (vertex + 1 >= self.offsets.len) return &.{};
        return self.edges[self.offsets[vertex]..self.offsets[vertex + 1]];
    }
};

fn walkEdgeUsable(edge: u32) bool {
    const boundary = g_edge_boundary orelse return false;
    if (edge >= g_edge_count or edge >= boundary.len or !boundary[edge]) return false;
    if (g_scope_active) {
        ensureScopeMasks();
        const mask = g_scope_edge orelse return false;
        if (edge >= mask.len or !mask[edge]) return false;
    }
    return true;
}

fn buildVertexEdgeIndex() ?VertexEdgeIndex {
    const edges = g_edges orelse return null;
    const counts = alloc.alloc(u32, g_vert_count + 1) catch return null;
    @memset(counts, 0);
    var edge: u32 = 0;
    var usable: u32 = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!walkEdgeUsable(edge)) continue;
        counts[edges[edge * 2]] += 1;
        counts[edges[edge * 2 + 1]] += 1;
        usable += 1;
    }
    const offsets = alloc.alloc(u32, g_vert_count + 1) catch {
        alloc.free(counts);
        return null;
    };
    var running: u32 = 0;
    for (0..g_vert_count) |vertex| {
        offsets[vertex] = running;
        running += counts[vertex];
    }
    offsets[g_vert_count] = running;
    const flat = alloc.alloc(u32, running) catch {
        alloc.free(counts);
        alloc.free(offsets);
        return null;
    };
    @memset(counts, 0);
    edge = 0;
    while (edge < g_edge_count) : (edge += 1) {
        if (!walkEdgeUsable(edge)) continue;
        for ([2]u32{ edges[edge * 2], edges[edge * 2 + 1] }) |vertex| {
            flat[offsets[vertex] + counts[vertex]] = edge;
            counts[vertex] += 1;
        }
    }
    alloc.free(counts);
    return .{ .offsets = offsets, .edges = flat };
}

fn walkOtherEnd(edge: u32, vertex: u32) u32 {
    const edges = g_edges orelse return vertex;
    const a = edges[edge * 2];
    const b = edges[edge * 2 + 1];
    return if (a == vertex) b else a;
}

/// The authored face-groups touching an edge. Two for an interior quad edge, one at a
/// boundary. Groups are how a ring knows what a "quad" is.
fn walkEdgeGroups(edge: u32, out: *[8]u32) u32 {
    const corners = g_corner_vert orelse return 0;
    const edges = g_edges orelse return 0;
    const a = edges[edge * 2];
    const b = edges[edge * 2 + 1];
    const face_count = model_paint.faceCount();
    var found: u32 = 0;
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (!faceInScope(face)) continue;
        const base = @as(usize, face) * 3;
        if (base + 2 >= corners.len) break;
        var has_a = false;
        var has_b = false;
        for (0..3) |corner| {
            if (corners[base + corner] == a) has_a = true;
            if (corners[base + corner] == b) has_b = true;
        }
        if (!has_a or !has_b) continue;
        const group = model_source.faceGroupOf(face);
        if (group == model_source.NO_FACE_GROUP) continue;
        var seen = false;
        for (out[0..found]) |existing| {
            if (existing == group) seen = true;
        }
        if (seen) continue;
        if (found >= out.len) break;
        out[found] = group;
        found += 1;
    }
    return found;
}

/// Distinct logical corner vertices of an authored group, counted up to 5 — enough
/// to answer the only question asked: is this group a QUAD (exactly 4)?
fn walkGroupDistinctVertCount(group: u32) u32 {
    const corners = g_corner_vert orelse return 0;
    const face_count = model_paint.faceCount();
    var distinct: [5]u32 = undefined;
    var found: u32 = 0;
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (model_source.faceGroupOf(face) != group) continue;
        const base = @as(usize, face) * 3;
        if (base + 2 >= corners.len) break;
        for (0..3) |corner| {
            const vertex = corners[base + corner];
            var seen = false;
            for (distinct[0..found]) |have| seen = seen or have == vertex;
            if (seen) continue;
            if (found >= distinct.len) return @intCast(distinct.len + 1); // 5+ corners — not a quad
            distinct[found] = vertex;
            found += 1;
        }
    }
    return found;
}

/// The boundary edge of `group` that shares NO vertex with `edge` — a quad's opposite
/// side, which is the step a ring walk takes. A group that is NOT a quad has no
/// single opposite side; answering "lowest edge sharing no vertex" there made a
/// ring entering an n-gon cap hop to an arbitrary far edge and scatter across the
/// model (req_4271) — the documented contract ("stops when a group is not a quad")
/// now actually holds.
fn walkOppositeEdgeInGroup(group: u32, edge: u32) ?u32 {
    if (walkGroupDistinctVertCount(group) != 4) return null;
    const corners = g_corner_vert orelse return null;
    const edges = g_edges orelse return null;
    const a = edges[edge * 2];
    const b = edges[edge * 2 + 1];
    const face_count = model_paint.faceCount();
    var candidate: ?u32 = null;
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (model_source.faceGroupOf(face) != group or !faceInScope(face)) continue;
        const base = @as(usize, face) * 3;
        if (base + 2 >= corners.len) break;
        for (0..3) |corner| {
            const p = corners[base + corner];
            const q = corners[base + (corner + 1) % 3];
            if (p == a or p == b or q == a or q == b) continue;
            const found = edgeIndexBetween(p, q) orelse continue;
            if (!walkEdgeUsable(found)) continue;
            // A quad has exactly one opposite side; ties can only come from a group
            // that is not a quad, and the LOWEST edge id keeps that case deterministic.
            if (candidate == null or found < candidate.?) candidate = found;
        }
    }
    return candidate;
}

/// Face geometry comes from the WELDED topology (corner -> logical vertex -> position),
/// the same source selection and the overlay already trust. The raw paint soup is not a
/// stride-8 position array, and reading it as one silently produced 45-degree "normals".
fn walkFaceCorners(face: u32) ?[3][3]f32 {
    const corners = g_corner_vert orelse return null;
    const base = @as(usize, face) * 3;
    if (base + 2 >= corners.len) return null;
    return .{
        vertPosPub(corners[base]),
        vertPosPub(corners[base + 1]),
        vertPosPub(corners[base + 2]),
    };
}

fn walkFaceCross(face: u32) ?[3]f32 {
    const corner = walkFaceCorners(face) orelse return null;
    const u = [3]f32{ corner[1][0] - corner[0][0], corner[1][1] - corner[0][1], corner[1][2] - corner[0][2] };
    const v = [3]f32{ corner[2][0] - corner[0][0], corner[2][1] - corner[0][1], corner[2][2] - corner[0][2] };
    return .{ u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0] };
}

fn walkFaceNormal(face: u32) ?[3]f32 {
    var n = walkFaceCross(face) orelse return null;
    const length = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (length <= 1e-12) return null;
    n[0] /= length;
    n[1] /= length;
    n[2] /= length;
    return n;
}

fn walkFaceArea(face: u32) f32 {
    const c = walkFaceCross(face) orelse return 0;
    return @sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) / 2;
}

fn walkFacePlaneOffset(face: u32, normal: [3]f32) f32 {
    const corner = walkFaceCorners(face) orelse return 0;
    return normal[0] * corner[0][0] + normal[1] * corner[0][1] + normal[2] * corner[0][2];
}

fn stageWalk(ids: []u32, domain: WalkDomain, terminated: WalkTermination, stopped_at: u32) ?WalkPlan {
    clearWalkPlan();
    g_walk_ids = ids;
    g_walk_domain = domain;
    g_walk_built_for = model_paint.faceCount();
    g_walk_counter +%= 1;
    // The token folds in the facecount the plan was computed for, so applying a walk
    // across a topology change cannot silently hit different elements.
    g_walk_token = (g_walk_counter << 32) | @as(u64, g_walk_built_for);
    var bbox = [6]f32{
        std.math.inf(f32),  std.math.inf(f32),  std.math.inf(f32),
        -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32),
    };
    for (ids) |id| {
        switch (domain) {
            .vertex => accumulateWalkVertex(&bbox, id),
            .edge => {
                const edges = g_edges orelse break;
                accumulateWalkVertex(&bbox, edges[id * 2]);
                accumulateWalkVertex(&bbox, edges[id * 2 + 1]);
            },
            .face => {
                const corners = g_corner_vert orelse break;
                const base = @as(usize, id) * 3;
                if (base + 2 >= corners.len) break;
                for (0..3) |corner| accumulateWalkVertex(&bbox, corners[base + corner]);
            },
        }
    }
    return .{
        .token = g_walk_token,
        .domain = domain,
        .count = @intCast(ids.len),
        .terminated = terminated,
        .stopped_at = stopped_at,
        .bbox = bbox,
    };
}

fn accumulateWalkVertex(bbox: *[6]f32, vertex: u32) void {
    const position = vertPosPub(vertex);
    for (0..3) |axis| {
        bbox[axis] = @min(bbox[axis], position[axis]);
        bbox[axis + 3] = @max(bbox[axis + 3], position[axis]);
    }
}

/// Shortest edge-walk between two logical vertices. Ties are broken by LOWEST vertex
/// id at every step — arbitrary, but stated and reproducible, so an agent that gets a
/// walk it did not want can reason about why instead of retrying blindly.
fn walkPath(request: WalkRequest) ?WalkPlan {
    const edges = g_edges orelse return null;
    if (request.from >= g_vert_count or request.to >= g_vert_count) return null;
    const index = buildVertexEdgeIndex() orelse return null;
    defer index.deinit();
    const previous = alloc.alloc(u32, g_vert_count) catch return null;
    defer alloc.free(previous);
    const visited = alloc.alloc(bool, g_vert_count) catch return null;
    defer alloc.free(visited);
    @memset(visited, false);
    const queue = alloc.alloc(u32, g_vert_count) catch return null;
    defer alloc.free(queue);

    const target = vertPosPub(request.to);
    visited[request.from] = true;
    previous[request.from] = request.from;
    queue[0] = request.from;
    var head: usize = 0;
    var tail: usize = 1;
    var reached = request.from == request.to;
    while (head < tail and !reached) : (head += 1) {
        const current = queue[head];
        const here = vertPosPub(current);
        // Deterministic frontier order: ascending neighbour id.
        var candidates: [64]u32 = undefined;
        var candidate_count: u32 = 0;
        for (index.slice(current)) |edge| {
            const next = walkOtherEnd(edge, current);
            if (visited[next]) continue;
            if (request.axis < 3) {
                // Monotone travel: never step away from the target along the axis the
                // caller constrained, so a spine walk cannot detour around a limb.
                const axis: usize = request.axis;
                const there = vertPosPub(next);
                const closer = @abs(there[axis] - target[axis]) <= @abs(here[axis] - target[axis]);
                if (!closer) continue;
            }
            if (candidate_count >= candidates.len) break;
            candidates[candidate_count] = next;
            candidate_count += 1;
        }
        std.mem.sort(u32, candidates[0..candidate_count], {}, std.sort.asc(u32));
        for (candidates[0..candidate_count]) |next| {
            if (visited[next]) continue;
            visited[next] = true;
            previous[next] = current;
            queue[tail] = next;
            tail += 1;
            if (next == request.to) {
                reached = true;
                break;
            }
        }
    }
    if (!reached) {
        const empty = alloc.alloc(u32, 0) catch return null;
        return stageWalk(empty, .vertex, .unreached, request.to);
    }
    var length: u32 = 1;
    var cursor = request.to;
    while (cursor != request.from) : (length += 1) cursor = previous[cursor];
    const chain = alloc.alloc(u32, length) catch return null;
    cursor = request.to;
    var at: usize = length;
    while (at > 0) {
        at -= 1;
        chain[at] = cursor;
        if (cursor == request.from) break;
        cursor = previous[cursor];
    }
    _ = edges;
    return stageWalk(chain, .vertex, .complete, request.to);
}

/// An edge run computed by a loop/ring traversal, before anyone stages or selects
/// it. Owned ids — the caller frees (or hands them to stageWalk, which owns them).
const CollectedEdgeWalk = struct {
    ids: []u32,
    terminated: WalkTermination,
    stopped_at: u32,
};

/// Follow an edge loop from one seed. The continuation at a vertex is the edge that
/// shares NO authored face-group with the edge we arrived on — the classic quad-loop
/// rule. Anything other than a clean 4-way junction ends the walk and says so, because
/// guessing at a pole is how a loop silently swallows half a model.
fn collectLoopEdges(seed: u32) ?CollectedEdgeWalk {
    if (!walkEdgeUsable(seed)) return null;
    const index = buildVertexEdgeIndex() orelse return null;
    defer index.deinit();
    var collected = std.ArrayListUnmanaged(u32).empty;
    defer collected.deinit(alloc);
    const seen = alloc.alloc(bool, g_edge_count) catch return null;
    defer alloc.free(seen);
    @memset(seen, false);
    collected.append(alloc, seed) catch return null;
    seen[seed] = true;

    var termination: WalkTermination = .closed;
    var stopped_at: u32 = seed;
    const edges = g_edges orelse return null;
    // Walk both ways from the seed so a loop opened at a boundary still returns the
    // whole run rather than half of it.
    for ([2]u32{ edges[seed * 2], edges[seed * 2 + 1] }) |start| {
        var current_edge = seed;
        var vertex = start;
        while (true) {
            var groups: [8]u32 = undefined;
            const group_count = walkEdgeGroups(current_edge, &groups);
            var next_edge: ?u32 = null;
            var incident: u32 = 0;
            for (index.slice(vertex)) |edge| {
                incident += 1;
                if (edge == current_edge) continue;
                var candidate_groups: [8]u32 = undefined;
                const candidate_count = walkEdgeGroups(edge, &candidate_groups);
                var shares = false;
                for (candidate_groups[0..candidate_count]) |candidate| {
                    for (groups[0..group_count]) |group| {
                        if (candidate == group) shares = true;
                    }
                }
                if (shares) continue;
                if (next_edge == null or edge < next_edge.?) next_edge = edge;
            }
            if (incident != 4) {
                termination = if (incident < 3) .boundary else .pole;
                stopped_at = vertex;
                break;
            }
            const step = next_edge orelse {
                termination = .boundary;
                stopped_at = vertex;
                break;
            };
            if (seen[step]) {
                termination = .closed;
                stopped_at = vertex;
                break;
            }
            seen[step] = true;
            collected.append(alloc, step) catch return null;
            vertex = walkOtherEnd(step, vertex);
            current_edge = step;
        }
        if (termination == .closed) break;
    }
    const owned = collected.toOwnedSlice(alloc) catch return null;
    return .{ .ids = owned, .terminated = termination, .stopped_at = stopped_at };
}

fn walkLoop(request: WalkRequest) ?WalkPlan {
    const run = collectLoopEdges(request.edge) orelse return null;
    return stageWalk(run.ids, .edge, run.terminated, run.stopped_at);
}

/// Follow an edge ring: step across each quad to its opposite side. Stops when a group
/// is not a quad, when the ring closes, or at an open boundary.
fn collectRingEdges(seed: u32) ?CollectedEdgeWalk {
    if (!walkEdgeUsable(seed)) return null;
    var collected = std.ArrayListUnmanaged(u32).empty;
    defer collected.deinit(alloc);
    const seen = alloc.alloc(bool, g_edge_count) catch return null;
    defer alloc.free(seen);
    @memset(seen, false);
    collected.append(alloc, seed) catch return null;
    seen[seed] = true;

    var termination: WalkTermination = .boundary;
    var groups: [8]u32 = undefined;
    const seed_groups = walkEdgeGroups(seed, &groups);
    var direction: u32 = 0;
    while (direction < seed_groups) : (direction += 1) {
        var current_edge = seed;
        var current_group = groups[direction];
        while (true) {
            const opposite = walkOppositeEdgeInGroup(current_group, current_edge) orelse {
                termination = .boundary;
                break;
            };
            if (seen[opposite]) {
                termination = .closed;
                break;
            }
            seen[opposite] = true;
            collected.append(alloc, opposite) catch return null;
            var next_groups: [8]u32 = undefined;
            const next_count = walkEdgeGroups(opposite, &next_groups);
            var stepped: ?u32 = null;
            for (next_groups[0..next_count]) |group| {
                if (group != current_group and (stepped == null or group < stepped.?)) stepped = group;
            }
            current_group = stepped orelse {
                termination = .boundary;
                break;
            };
            current_edge = opposite;
        }
        if (termination == .closed) break;
    }
    const owned = collected.toOwnedSlice(alloc) catch return null;
    return .{ .ids = owned, .terminated = termination, .stopped_at = seed };
}

fn walkRing(request: WalkRequest) ?WalkPlan {
    const run = collectRingEdges(request.edge) orelse return null;
    return stageWalk(run.ids, .edge, run.terminated, run.stopped_at);
}

/// Expand the LIVE face selection by adjacency. The one amplifier that reads the current
/// selection rather than a seed, because "a bit more than what I have" is the intent.
fn walkGrow(request: WalkRequest) ?WalkPlan {
    const corners = g_corner_vert orelse return null;
    const face_count = model_paint.faceCount();
    const live = g_sel_face orelse return null;
    var mask = alloc.alloc(bool, face_count) catch return null;
    defer alloc.free(mask);
    @memset(mask, false);
    var selected: u32 = 0;
    var face: u32 = 0;
    while (face < face_count and face < live.len) : (face += 1) {
        if (!live[face] or !faceInScope(face)) continue;
        mask[face] = true;
        selected += 1;
    }
    if (selected == 0) return null;
    const vertex_hit = alloc.alloc(bool, g_vert_count) catch return null;
    defer alloc.free(vertex_hit);
    const rings = @max(1, @min(request.rings, 16));
    var ring: u32 = 0;
    while (ring < rings) : (ring += 1) {
        @memset(vertex_hit, false);
        face = 0;
        while (face < face_count) : (face += 1) {
            if (!mask[face]) continue;
            const base = @as(usize, face) * 3;
            if (base + 2 >= corners.len) break;
            for (0..3) |corner| vertex_hit[corners[base + corner]] = true;
        }
        face = 0;
        while (face < face_count) : (face += 1) {
            if (mask[face] or !faceInScope(face)) continue;
            const base = @as(usize, face) * 3;
            if (base + 2 >= corners.len) break;
            for (0..3) |corner| {
                if (vertex_hit[corners[base + corner]]) {
                    mask[face] = true;
                    break;
                }
            }
        }
    }
    return stageWalkFaceMask(mask, .complete);
}

/// Faces resembling a seed face. `coplanar` is the one that replaces the brittle
/// inside:box dance for isolating a flat panel: same normal AND the same plane.
fn walkSimilar(request: WalkRequest) ?WalkPlan {
    const face_count = model_paint.faceCount();
    if (request.face >= face_count or !faceInScope(request.face)) return null;
    const seed_normal = walkFaceNormal(request.face) orelse return null;
    const seed_area = walkFaceArea(request.face);
    const seed_offset = walkFacePlaneOffset(request.face, seed_normal);
    const cosine = @cos(std.math.degreesToRadians(std.math.clamp(request.tolerance, 0, 180)));
    var mask = alloc.alloc(bool, face_count) catch return null;
    defer alloc.free(mask);
    @memset(mask, false);
    var face: u32 = 0;
    while (face < face_count) : (face += 1) {
        if (!faceInScope(face)) continue;
        switch (request.by) {
            .area => {
                const area = walkFaceArea(face);
                const span = @max(seed_area, 1e-9);
                if (@abs(area - seed_area) / span <= @max(request.tolerance, 0)) mask[face] = true;
            },
            .normal, .coplanar => {
                const normal = walkFaceNormal(face) orelse continue;
                const dot = normal[0] * seed_normal[0] + normal[1] * seed_normal[1] + normal[2] * seed_normal[2];
                if (dot < cosine) continue;
                if (request.by == .coplanar) {
                    // Same facing is not the same panel: the far side of a slab passes a
                    // normal test and must fail a plane test.
                    if (@abs(walkFacePlaneOffset(face, seed_normal) - seed_offset) > 1e-3) continue;
                }
                mask[face] = true;
            },
        }
    }
    return stageWalkFaceMask(mask, .complete);
}

fn stageWalkFaceMask(mask: []const bool, terminated: WalkTermination) ?WalkPlan {
    var count: u32 = 0;
    for (mask) |hit| {
        if (hit) count += 1;
    }
    const ids = alloc.alloc(u32, count) catch return null;
    var at: usize = 0;
    for (mask, 0..) |hit, face| {
        if (!hit) continue;
        ids[at] = @intCast(face);
        at += 1;
    }
    return stageWalk(ids, .face, terminated, 0);
}

pub fn walkPlan(request: WalkRequest) ?WalkPlan {
    if (!ensureTopology()) return null;
    return switch (request.kind) {
        .path => walkPath(request),
        .loop => walkLoop(request),
        .ring => walkRing(request),
        .grow => walkGrow(request),
        .similar => walkSimilar(request),
    };
}

/// Commit the staged walk. The token must match the plan that was just read AND the
/// facecount it was computed for — a topology change between preview and apply is a
/// refusal, never a silently different set.
pub fn walkApply(token: u64, additive: bool) ?u32 {
    const ids = g_walk_ids orelse return null;
    if (token == 0 or token != g_walk_token) return null;
    if (g_walk_built_for != model_paint.faceCount()) return null;
    switch (g_walk_domain) {
        .face => {
            setMode(.face);
            const face_count = model_paint.faceCount();
            const mask = alloc.alloc(bool, face_count) catch return null;
            defer alloc.free(mask);
            @memset(mask, false);
            if (additive) {
                if (g_sel_face) |live| {
                    var face: usize = 0;
                    while (face < face_count and face < live.len) : (face += 1) mask[face] = live[face];
                }
            }
            for (ids) |id| {
                if (id < face_count) mask[id] = true;
            }
            return selectFacesByTriangleMask(mask);
        },
        .edge => {
            setMode(.edge);
            var applied: u32 = 0;
            for (ids, 0..) |id, at| {
                if (selectEdgeByIndex(id, additive or at > 0)) applied += 1;
            }
            return applied;
        },
        .vertex => {
            setMode(.vertex);
            var applied: u32 = 0;
            for (ids, 0..) |id, at| {
                if (selectVertexByIndex(id, additive or at > 0)) applied += 1;
            }
            return applied;
        },
    }
}

pub fn walkPlanJson(allocator: std.mem.Allocator, request: WalkRequest) ?[]u8 {
    const plan = walkPlan(request) orelse return null;
    const ids = g_walk_ids orelse return null;
    var out: std.Io.Writer.Allocating = .init(allocator);
    defer out.deinit();
    const writer = &out.writer;
    writer.print(
        "{{\"ok\":true,\"token\":\"{d}\",\"domain\":\"{s}\",\"count\":{d},\"terminated\":\"{s}\",\"stoppedAt\":{d},\"tieBreak\":\"{s}\",\"bbox\":[",
        .{
            plan.token,
            @tagName(plan.domain),
            plan.count,
            @tagName(plan.terminated),
            plan.stopped_at,
            "lowest element id wins an equal-cost step",
        },
    ) catch return null;
    for (plan.bbox, 0..) |value, at| {
        writer.print("{s}{d:.6}", .{ if (at == 0) "" else ",", value }) catch return null;
    }
    writer.writeAll("],\"elements\":[") catch return null;
    for (ids, 0..) |id, at| {
        writer.print("{s}{d}", .{ if (at == 0) "" else ",", id }) catch return null;
    }
    writer.writeAll("]}") catch return null;
    return out.toOwnedSlice() catch null;
}

// ── intent amplifier walks (req_4061) ────────────────────────────────────────────

fn setupGroupedCube(soup: *[12 * 3 * 8]f32) void {
    buildCubeSoup(soup);
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(9101, soup[0..], 36);
}

test "a path walk spans two picks and reports the chain, not a pair" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    // Two corners of a cube that share no edge: the walk must find the run between them.
    const plan = walkPlan(.{ .kind = .path, .from = 0, .to = 7 }) orelse return error.NoPlan;
    try testing.expectEqual(WalkDomain.vertex, plan.domain);
    try testing.expectEqual(WalkTermination.complete, plan.terminated);
    try testing.expect(plan.count >= 2);
    const ids = g_walk_ids orelse return error.NoIds;
    try testing.expectEqual(@as(u32, 0), ids[0]);
    try testing.expectEqual(@as(u32, 7), ids[ids.len - 1]);
    // Every consecutive pair must be a real edge, or it is not a walk.
    for (ids[0 .. ids.len - 1], ids[1..]) |a, b| try testing.expect(hasEdgeBetweenPub(a, b));
}

test "an unreachable target refuses instead of inventing a chain" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    const plan = walkPlan(.{ .kind = .path, .from = 0, .to = 99 });
    try testing.expect(plan == null); // out of range is a refusal, not an empty walk
}

test "a walk stages a preview and changes no selection until it is applied" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    const plan = walkPlan(.{ .kind = .path, .from = 0, .to = 7 }) orelse return error.NoPlan;
    var picked: [64]u32 = undefined;
    try testing.expectEqual(@as(u32, 0), selectedVerticesPub(picked[0..]));
    const applied = walkApply(plan.token, false) orelse return error.NotApplied;
    try testing.expectEqual(plan.count, applied);
    try testing.expectEqual(plan.count, selectedVerticesPub(picked[0..]));
}

test "a stale token cannot apply a walk" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    const first = walkPlan(.{ .kind = .path, .from = 0, .to = 7 }) orelse return error.NoPlan;
    _ = walkPlan(.{ .kind = .path, .from = 1, .to = 6 }) orelse return error.NoPlan;
    // The superseded plan's token is dead: an agent can only apply the walk it just read.
    try testing.expect(walkApply(first.token, false) == null);
    try testing.expect(walkApply(0, false) == null);
}

test "a cube edge loop closes at four edges and says so" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    var seed: u32 = 0;
    while (seed < g_edge_count and !walkEdgeUsable(seed)) : (seed += 1) {}
    const plan = walkPlan(.{ .kind = .loop, .edge = seed }) orelse return error.NoPlan;
    try testing.expectEqual(WalkDomain.edge, plan.domain);
    // Every vertex of a cube is 3-valent in boundary edges, so a quad loop cannot
    // continue — the walk must stop at the pole rather than guess a continuation.
    try testing.expectEqual(WalkTermination.pole, plan.terminated);
    try testing.expectEqual(@as(u32, 1), plan.count);
}

test "similar by coplanar isolates one panel, by normal takes the whole facing" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    const coplanar = walkPlan(.{ .kind = .similar, .face = 0, .by = .coplanar, .tolerance = 5 }) orelse return error.NoPlan;
    // One cube side is two triangles; the opposite side faces the other way and must
    // not join, and a same-facing far plane must fail the plane test.
    try testing.expectEqual(@as(u32, 2), coplanar.count);
    const normals = walkPlan(.{ .kind = .similar, .face = 0, .by = .normal, .tolerance = 5 }) orelse return error.NoPlan;
    try testing.expect(normals.count >= coplanar.count);
}

test "grow expands the live face selection by adjacency" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    try testing.expect(selectFaceByIndex(0, false));
    const plan = walkPlan(.{ .kind = .grow, .rings = 1 }) orelse return error.NoPlan;
    try testing.expectEqual(WalkDomain.face, plan.domain);
    try testing.expect(plan.count > 1); // a corner triangle always has neighbours
}

test "grow with nothing selected refuses rather than selecting everything" {
    var soup: [12 * 3 * 8]f32 = undefined;
    setupGroupedCube(&soup);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
        clearWalkPlan();
    }
    try testing.expect(ensureTopology());
    try testing.expect(walkPlan(.{ .kind = .grow, .rings = 1 }) == null);
}
