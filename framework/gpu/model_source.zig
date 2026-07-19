//! Authoritative source mesh for the model viewer/editor.
//!
//! The displayed mesh can be full-res or a quality-decimated projection. Paint already
//! writes displayed faces back through a displayed->source map; geometry edits use the
//! same rule so quality changes do not silently resurrect the original positions.

const std = @import("std");
const model_paint = @import("model_paint.zig");
const meshdoc_format = @import("meshdoc_format.zig");

pub const partRangesValid = meshdoc_format.rangesValid;

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
    if (g_part_ranges) |m| alloc.free(m);
    g_source_verts = null;
    g_source_path = null;
    g_source_colors = null;
    g_face_to_source = null;
    g_source_face_group = null;
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
