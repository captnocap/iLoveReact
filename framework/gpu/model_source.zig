//! Authoritative source mesh for the model viewer/editor.
//!
//! The displayed mesh can be full-res or a quality-decimated projection. Paint already
//! writes displayed faces back through a displayed->source map; geometry edits use the
//! same rule so quality changes do not silently resurrect the original positions.

const std = @import("std");
const model_paint = @import("model_paint.zig");
const meshdoc_format = @import("meshdoc_format.zig");

pub const partRangesValid = meshdoc_format.rangesValid;
pub const MeshDocFaceBlock = meshdoc_format.FaceBlock;
pub const MeshDocSnapshot = meshdoc_format.Snapshot;
pub const composeMeshDocSnapshot = meshdoc_format.composeSnapshot;
pub const meshDocRangesOwnEveryFace = meshdoc_format.rangesOwnEveryFace;

const alloc = std.heap.c_allocator;

var g_source_verts: ?[]f32 = null; // interleaved 8 f32/vert, full-res source
var g_source_count: u32 = 0;
var g_source_path: ?[]u8 = null;
var g_source_colors: ?[]u8 = null; // source facecount*4 rgba
var g_face_to_source: ?[]u32 = null; // current displayed face -> source face
// One id per SOURCE face: source faces sharing an id came from the same authored
// n-gon (studio EditMesh, via editMeshToGeometry). Absent for plain triangle imports.
var g_source_face_group: ?[]u32 = null;
pub const NO_FACE_GROUP: u32 = std.math.maxInt(u32);
// One stable texture-role index per SOURCE face. NO_FACE_MATERIAL means the face
// keeps the model's painted atlas; a concrete index is substituted per placement.
var g_source_face_material: ?[]u32 = null;
pub const NO_FACE_MATERIAL: u32 = std.math.maxInt(u32);
// Durable semantic membership per SOURCE face. Unlike authored groups, these rows
// inherit through topology splits and answer what a surface means across sessions.
var g_source_face_region: ?[]u32 = null;
var g_source_face_instance: ?[]u32 = null;
// Opaque, versioned JSON dictionary for region names, op roles, and provenance.
// It is persisted atomically beside the face rows in RJMD and journal snapshots;
// the native topology core only owns its lifetime, while the cart/seat interprets it.
var g_semantic_table_json: ?[]u8 = null;
pub const NO_SEMANTIC_ID: u32 = std.math.maxInt(u32);
pub const MAX_SEMANTIC_TABLE_BYTES: usize = 1024 * 1024;
// Flattened [lo,hi) pairs of authored-group ids, sorted and non-overlapping — one pair
// per outliner PART of a composed multi-part model. The mesh editor welds coincident
// positions only WITHIN a part, so two stacked cubes stay independently editable.
// Absent (like face groups) for plain imports; cleared by the next retain().
var g_part_ranges: ?[]u32 = null;
pub const NO_PART: u32 = std.math.maxInt(u32);

pub fn retain(model_path: []const u8, mesh_verts: []const f32, source_count: u32) void {
    clear();
    g_source_verts = alloc.dupe(f32, mesh_verts) catch null;
    g_source_path = alloc.dupe(u8, model_path) catch null;
    g_source_count = if (g_source_verts != null) source_count else 0;

    const fc = source_count / 3;
    g_source_colors = alloc.alloc(u8, @as(usize, fc) * 4) catch null;
    if (g_source_colors) |cols| {
        var i: usize = 0;
        while (i < fc) : (i += 1) {
            cols[i * 4 + 0] = model_paint.DEFAULT_FACE[0];
            cols[i * 4 + 1] = model_paint.DEFAULT_FACE[1];
            cols[i * 4 + 2] = model_paint.DEFAULT_FACE[2];
            cols[i * 4 + 3] = model_paint.DEFAULT_FACE[3];
        }
    }
    g_face_to_source = alloc.alloc(u32, fc) catch null;
    if (g_face_to_source) |m| {
        var i: u32 = 0;
        while (i < fc) : (i += 1) m[i] = i;
    }
}

pub fn clear() void {
    if (g_source_verts) |v| alloc.free(v);
    if (g_source_path) |p| alloc.free(p);
    if (g_source_colors) |c| alloc.free(c);
    if (g_face_to_source) |m| alloc.free(m);
    if (g_source_face_group) |m| alloc.free(m);
    if (g_source_face_material) |m| alloc.free(m);
    if (g_source_face_region) |m| alloc.free(m);
    if (g_source_face_instance) |m| alloc.free(m);
    if (g_semantic_table_json) |m| alloc.free(m);
    if (g_part_ranges) |m| alloc.free(m);
    g_source_verts = null;
    g_source_path = null;
    g_source_colors = null;
    g_face_to_source = null;
    g_source_face_group = null;
    g_source_face_material = null;
    g_source_face_region = null;
    g_source_face_instance = null;
    g_semantic_table_json = null;
    g_part_ranges = null;
    g_source_count = 0;
}

pub fn verts() ?[]f32 {
    return g_source_verts;
}

pub fn count() u32 {
    return g_source_count;
}

pub fn path() ?[]const u8 {
    return g_source_path;
}

pub fn colors() ?[]u8 {
    return g_source_colors;
}

/// Replace the current displayed->source face map (taking ownership of a copy of `m`).
pub fn setFaceMap(m: []const u32) void {
    if (g_face_to_source) |old| alloc.free(old);
    g_face_to_source = alloc.dupe(u32, m) catch null;
}

/// Adopt the authored-face grouping (one id per SOURCE face). Set after a load, once,
/// for studio models; cleared by the next retain(). File imports never set it.
pub fn setFaceGroups(m: []const u32) void {
    if (g_source_face_group) |old| alloc.free(old);
    g_source_face_group = alloc.dupe(u32, m) catch null;
}

/// The authored-face grouping (one id per SOURCE face), or null when no studio load
/// set it — the meshdoc writer persists it so a saved model reopens with real n-gon
/// face selection instead of fan slivers (req_2753).
pub fn faceGroups() ?[]const u32 {
    return g_source_face_group;
}

/// Bumped on every face-material change so consumers (live material regions,
/// req_3397) can cheaply notice and rebuild derived structures — assignments,
/// undo restores, and clears all funnel through the two setters below.
pub var face_materials_gen: u32 = 1;

pub fn setFaceMaterials(m: []const u32) void {
    if (g_source_face_material) |old| alloc.free(old);
    g_source_face_material = if (m.len == g_source_count / 3)
        alloc.dupe(u32, m) catch null
    else
        null;
    face_materials_gen +%= 1;
}

pub fn faceMaterials() ?[]const u32 {
    return g_source_face_material;
}

pub fn clearFaceMaterials() void {
    if (g_source_face_material) |old| alloc.free(old);
    g_source_face_material = null;
    face_materials_gen +%= 1;
}

pub fn faceMaterialOf(displayed_face: u32) u32 {
    const materials = g_source_face_material orelse return NO_FACE_MATERIAL;
    var sf = displayed_face;
    if (g_face_to_source) |map| {
        if (displayed_face >= map.len) return NO_FACE_MATERIAL;
        sf = map[displayed_face];
    }
    if (sf >= materials.len) return NO_FACE_MATERIAL;
    return materials[sf];
}

pub var face_semantics_gen: u32 = 1;

fn semanticRowsValid(regions: []const u32, instances: []const u32, face_count: usize) bool {
    if (regions.len != face_count or instances.len != face_count) return false;
    for (regions, instances) |region, instance| {
        if (region == NO_SEMANTIC_ID and instance != NO_SEMANTIC_ID) return false;
    }
    return true;
}

pub fn setFaceSemantics(regions: []const u32, instances: []const u32) bool {
    const face_count: usize = @intCast(g_source_count / 3);
    if (!semanticRowsValid(regions, instances, face_count)) return false;
    const next_regions = alloc.dupe(u32, regions) catch return false;
    const next_instances = alloc.dupe(u32, instances) catch {
        alloc.free(next_regions);
        return false;
    };
    if (g_source_face_region) |old| alloc.free(old);
    if (g_source_face_instance) |old| alloc.free(old);
    g_source_face_region = next_regions;
    g_source_face_instance = next_instances;
    face_semantics_gen +%= 1;
    return true;
}

pub fn clearFaceSemantics() void {
    if (g_source_face_region) |old| alloc.free(old);
    if (g_source_face_instance) |old| alloc.free(old);
    if (g_semantic_table_json) |old| alloc.free(old);
    g_source_face_region = null;
    g_source_face_instance = null;
    g_semantic_table_json = null;
    face_semantics_gen +%= 1;
}

pub fn faceSemanticRegions() ?[]const u32 {
    return g_source_face_region;
}

pub fn faceSemanticInstances() ?[]const u32 {
    return g_source_face_instance;
}

fn semanticTableJsonValid(json: []const u8) bool {
    if (json.len < 2 or json.len > MAX_SEMANTIC_TABLE_BYTES) return false;
    if (json[0] != '{' or json[json.len - 1] != '}') return false;
    return std.mem.indexOfScalar(u8, json, 0) == null;
}

pub fn setSemanticTableJson(json: []const u8) bool {
    if (!semanticTableJsonValid(json)) return false;
    const next = alloc.dupe(u8, json) catch return false;
    if (g_semantic_table_json) |old| alloc.free(old);
    g_semantic_table_json = next;
    face_semantics_gen +%= 1;
    return true;
}

pub fn semanticTableJson() ?[]const u8 {
    return g_semantic_table_json;
}

/// Install face membership and its dictionary as one boundary transaction. No
/// partially-restored semantic state becomes visible on an invalid row or table.
pub fn setSemanticState(regions: []const u32, instances: []const u32, json: []const u8) bool {
    const face_count: usize = @intCast(g_source_count / 3);
    if (!semanticRowsValid(regions, instances, face_count) or !semanticTableJsonValid(json)) return false;
    const next_regions = alloc.dupe(u32, regions) catch return false;
    const next_instances = alloc.dupe(u32, instances) catch {
        alloc.free(next_regions);
        return false;
    };
    const next_json = alloc.dupe(u8, json) catch {
        alloc.free(next_regions);
        alloc.free(next_instances);
        return false;
    };
    if (g_source_face_region) |old| alloc.free(old);
    if (g_source_face_instance) |old| alloc.free(old);
    if (g_semantic_table_json) |old| alloc.free(old);
    g_source_face_region = next_regions;
    g_source_face_instance = next_instances;
    g_semantic_table_json = next_json;
    face_semantics_gen +%= 1;
    return true;
}

pub const FaceSemantic = struct { region: u32 = NO_SEMANTIC_ID, instance: u32 = NO_SEMANTIC_ID };

pub fn faceSemanticOf(displayed_face: u32) FaceSemantic {
    const regions = g_source_face_region orelse return .{};
    const instances = g_source_face_instance orelse return .{};
    var source_face = displayed_face;
    if (g_face_to_source) |map| {
        if (displayed_face >= map.len) return .{};
        source_face = map[displayed_face];
    }
    if (source_face >= regions.len or source_face >= instances.len) return .{};
    return .{ .region = regions[source_face], .instance = instances[source_face] };
}

test "semantic face membership follows displayed to source projection" {
    const triangle_verts = [_]f32{0} ** 48;
    retain("semantic-test", triangle_verts[0..], 6);
    defer clear();
    try std.testing.expect(setFaceSemantics(&.{ 4, 9 }, &.{ 2, 7 }));
    setFaceMap(&.{1});
    const semantic = faceSemanticOf(0);
    try std.testing.expectEqual(@as(u32, 9), semantic.region);
    try std.testing.expectEqual(@as(u32, 7), semantic.instance);
}

test "cold document metadata installs membership and dictionary together" {
    const triangle_verts = [_]f32{0} ** 48;
    retain("semantic-cold-load", triangle_verts[0..], 6);
    defer clear();
    setFaceGroups(&.{ 2, 7 });
    setPartRanges(&.{ 2, 3, 7, 8 });
    const table = "{\"version\":1,\"regions\":[{\"id\":4,\"name\":\"panel.wall\"},{\"id\":9,\"name\":\"boss.cap\"}]}";
    try std.testing.expect(setSemanticState(&.{ 4, 9 }, &.{ 0, 0 }, table));
    try std.testing.expectEqualSlices(u32, &.{ 4, 9 }, faceSemanticRegions().?);
    try std.testing.expectEqualSlices(u32, &.{ 0, 0 }, faceSemanticInstances().?);
    try std.testing.expectEqualStrings(table, semanticTableJson().?);
    try std.testing.expectEqualSlices(u32, &.{ 2, 3, 7, 8 }, partRanges().?);
}

test "absent face material table means every face keeps paint" {
    const triangle_verts = [_]f32{0} ** 24;
    retain("material-test", triangle_verts[0..], 3);
    defer clear();
    const assigned = [_]u32{4};
    setFaceMaterials(assigned[0..]);
    try std.testing.expectEqual(@as(u32, 4), faceMaterialOf(0));
    clearFaceMaterials();
    try std.testing.expect(faceMaterials() == null);
    try std.testing.expectEqual(NO_FACE_MATERIAL, faceMaterialOf(0));
}

/// Adopt the per-part group ranges: flattened [lo,hi) pairs, sorted, non-overlapping.
/// Empty clears (back to position-only welding). The editor cart sends this after every
/// load/append so the weld knows which authored groups form one independent part.
pub fn setPartRanges(pairs: []const u32) void {
    if (g_part_ranges) |old| alloc.free(old);
    const range_count: u32 = @intCast(pairs.len / 2);
    g_part_ranges = if (meshdoc_format.rangesValid(pairs, range_count) and range_count > 0)
        alloc.dupe(u32, pairs) catch null
    else
        null;
}

pub fn hasPartRanges() bool {
    return g_part_ranges != null;
}

/// The live flattened [lo,hi) part-range pairs (null when none set) — the mesh-edit
/// journal snapshots these so an undo restores part identity along with the geometry.
pub fn partRanges() ?[]const u32 {
    return g_part_ranges;
}

/// The PART index an authored group id falls in (binary search over the [lo,hi) pairs).
/// NO_PART when no ranges are set, the group is ungrouped, or it falls in a gap — all
/// such faces weld together, which is exactly the pre-part behaviour.
pub fn partIndexOf(group: u32) u32 {
    const r = g_part_ranges orelse return NO_PART;
    if (group == NO_FACE_GROUP) return NO_PART;
    var lo: usize = 0;
    var hi: usize = r.len / 2;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (group < r[mid * 2]) {
            hi = mid;
        } else if (group >= r[mid * 2 + 1]) {
            lo = mid + 1;
        } else {
            return @intCast(mid);
        }
    }
    return NO_PART;
}

/// The authored-face group a DISPLAYED face belongs to — composes displayed->source
/// (decimation) with source->group. NO_FACE_GROUP when no grouping is loaded.
pub fn faceGroupOf(displayed_face: u32) u32 {
    const groups = g_source_face_group orelse return NO_FACE_GROUP;
    var sf = displayed_face;
    if (g_face_to_source) |map| {
        if (displayed_face >= map.len) return NO_FACE_GROUP;
        sf = map[displayed_face];
    }
    if (sf >= groups.len) return NO_FACE_GROUP;
    return groups[sf];
}

/// Write a painted DISPLAYED face's colour back to the authoritative source paint.
/// COLOUR only — the alpha channel is the face's glass state (modelGlassFirstVertex
/// derives the meshdoc's transparent run from it), so painting never un-glasses (req_2928).
pub fn writeColor(displayed_face: i32, r: u8, g: u8, b: u8) void {
    if (displayed_face < 0) return;
    const map = g_face_to_source orelse return;
    const cols = g_source_colors orelse return;
    const df: usize = @intCast(displayed_face);
    if (df >= map.len) return;
    const sf = map[df];
    if (@as(usize, sf) * 4 + 3 >= cols.len) return;
    cols[sf * 4 + 0] = r;
    cols[sf * 4 + 1] = g;
    cols[sf * 4 + 2] = b;
}

/// writeColor's read twin: the durable source colour behind a DISPLAYED face,
/// through the same displayed→source mapping. Null when no map/table is resident
/// (callers fall back to their own default). Colour captures use this while the
/// paint layout is STALE — the frozen atlas must not be sampled then (req_3468).
pub fn colorOf(displayed_face: u32) ?[4]u8 {
    const map = g_face_to_source orelse return null;
    const cols = g_source_colors orelse return null;
    if (@as(usize, displayed_face) >= map.len) return null;
    const sf = map[displayed_face];
    if (@as(usize, sf) * 4 + 3 >= cols.len) return null;
    return .{ cols[sf * 4 + 0], cols[sf * 4 + 1], cols[sf * 4 + 2], cols[sf * 4 + 3] };
}

/// Copy changed DISPLAYED face positions back onto their mapped source faces. Full-res
/// display is exact; decimated display follows the same representative-face rule paint
/// already uses at low quality.
pub fn updateGeometryFromDisplayed(displayed_positions: []const f32, first_face: u32, last_face: u32) bool {
    const src = g_source_verts orelse return false;
    const map = g_face_to_source orelse return false;
    if (displayed_positions.len == 0 or first_face > last_face) return false;

    const max_face: u32 = @intCast(@min(map.len, displayed_positions.len / 9));
    if (first_face >= max_face) return false;
    const hi = @min(last_face, max_face - 1);

    var f = first_face;
    while (f <= hi) : (f += 1) {
        const sf = map[f];
        const src_base = @as(usize, sf) * 3 * 8;
        if (src_base + 2 * 8 + 2 >= src.len) continue;
        const pos_base = @as(usize, f) * 9;
        var k: usize = 0;
        while (k < 3) : (k += 1) {
            const dst = src_base + k * 8;
            const src_pos = pos_base + k * 3;
            src[dst + 0] = displayed_positions[src_pos + 0];
            src[dst + 1] = displayed_positions[src_pos + 1];
            src[dst + 2] = displayed_positions[src_pos + 2];
        }
    }
    return true;
}

/// Replace the interleaved source rows when only the render triangulation changed.
/// The triangle count and every face-slot owner stay identical, so groups, materials,
/// part ranges, colours, and the displayed-to-source map remain valid. This narrow
/// boundary is used by live mirror editing when it makes twin quad diagonals agree;
/// running the generic retain path here would incorrectly erase all of that metadata.
pub fn replaceGeometrySameTriangleCount(interleaved: []const f32, vertex_count: u32) bool {
    const source = g_source_verts orelse return false;
    const need = @as(usize, vertex_count) * 8;
    if (vertex_count != g_source_count or interleaved.len < need or source.len < need) return false;
    @memcpy(source[0..need], interleaved[0..need]);
    return true;
}
