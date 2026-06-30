//! Authoritative source mesh for the model viewer/editor.
//!
//! The displayed mesh can be full-res or a quality-decimated projection. Paint already
//! writes displayed faces back through a displayed->source map; geometry edits use the
//! same rule so quality changes do not silently resurrect the original positions.

const std = @import("std");
const model_paint = @import("model_paint.zig");

const alloc = std.heap.c_allocator;

var g_source_verts: ?[]f32 = null; // interleaved 8 f32/vert, full-res source
var g_source_count: u32 = 0;
var g_source_path: ?[]u8 = null;
var g_source_colors: ?[]u8 = null; // source facecount*4 rgba
var g_face_to_source: ?[]u32 = null; // current displayed face -> source face

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
    g_source_verts = null;
    g_source_path = null;
    g_source_colors = null;
    g_face_to_source = null;
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

/// Write a painted DISPLAYED face's colour back to the authoritative source paint.
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
    cols[sf * 4 + 3] = 255;
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
