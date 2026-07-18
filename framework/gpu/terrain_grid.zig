//! Shared CPU/GPU contract for formula-painted regular terrain.
//!
//! Terrain chunks are data grids, not arbitrary meshes. The renderer keeps one
//! immutable grid topology and reads each chunk's heights from the same storage
//! stream that already carries its ground formula inputs. This module owns the
//! CPU/GPU wire offsets so the loader and WGSL cannot drift independently.

const std = @import("std");

pub const MAX_RESIDENT_CHUNKS: usize = 128;

pub const SAMPLE_COLS: usize = 121;
pub const SAMPLE_ROWS: usize = 121;
pub const SAMPLE_COUNT: usize = SAMPLE_COLS * SAMPLE_ROWS;

/// Maximum prefix reserved for the formula's existing D stream. Layout v4 is
/// currently 32,134 floats at its largest; the spare room is intentional wire
/// compatibility for future palette/binding additions.
pub const FORMULA_FLOAT_CAP: usize = 34_000;
pub const HEIGHT_OFFSET: usize = FORMULA_FLOAT_CAP;
pub const CELL_X_OFFSET: usize = HEIGHT_OFFSET + SAMPLE_COUNT;
pub const CELL_Z_OFFSET: usize = CELL_X_OFFSET + 1;
pub const MARKER_OFFSET: usize = CELL_Z_OFFSET + 1;
pub const TOTAL_FLOATS: usize = MARKER_OFFSET + 1;

/// Finite bit-pattern marker, compared as u32 in WGSL so NaN canonicalization
/// cannot make a valid trailer disappear.
pub const TRAILER_MARKER: u32 = 0x524A_5447; // "R J T G"

/// Bare live terrain still uses the shared data-grid path. Multiplying this by
/// the node's editor tint reproduces the old untextured fallback without ever
/// allocating an arbitrary dynamic mesh while the cart's real look is absent.
pub const FALLBACK_FORMULA: []const u8 =
    "fn hf_ground_rgb(uv: vec2f) -> vec3f { _ = uv; return vec3f(1.0); }";

pub const TOPOLOGY_VERTEX_COUNT: usize =
    (SAMPLE_COLS - 1) * (SAMPLE_ROWS - 1) * 6 +
    2 * ((SAMPLE_COLS - 1) + (SAMPLE_ROWS - 1)) * 6;

pub const WGSL_SAMPLE_COLS = std.fmt.comptimePrint("{d}u", .{SAMPLE_COLS});
pub const WGSL_SAMPLE_LAST = std.fmt.comptimePrint("{d}", .{SAMPLE_COLS - 1});
pub const WGSL_HEIGHT_OFFSET = std.fmt.comptimePrint("{d}u", .{HEIGHT_OFFSET});
pub const WGSL_CELL_X_OFFSET = std.fmt.comptimePrint("{d}u", .{CELL_X_OFFSET});
pub const WGSL_CELL_Z_OFFSET = std.fmt.comptimePrint("{d}u", .{CELL_Z_OFFSET});
pub const WGSL_MARKER_OFFSET = std.fmt.comptimePrint("{d}u", .{MARKER_OFFSET});
pub const WGSL_TRAILER_MARKER = std.fmt.comptimePrint("{d}u", .{TRAILER_MARKER});

pub fn canAppend(formula_floats: usize, heights: []const f32, cols: u32, rows: u32) bool {
    return formula_floats <= FORMULA_FLOAT_CAP and
        heights.len == SAMPLE_COUNT and
        cols == SAMPLE_COLS and rows == SAMPLE_ROWS;
}

/// Append the fixed-offset height trailer after the caller has encoded the
/// formula prefix. Returns false without touching memory for an incompatible
/// grid or undersized destination.
pub fn append(dst: []f32, formula_floats: usize, heights: []const f32, cols: u32, rows: u32, cell_x: f32, cell_z: f32) bool {
    if (dst.len < TOTAL_FLOATS or !canAppend(formula_floats, heights, cols, rows)) return false;
    @memcpy(dst[HEIGHT_OFFSET .. HEIGHT_OFFSET + SAMPLE_COUNT], heights);
    dst[CELL_X_OFFSET] = cell_x;
    dst[CELL_Z_OFFSET] = cell_z;
    dst[MARKER_OFFSET] = @bitCast(TRAILER_MARKER);
    return true;
}

pub fn hasTrailer(data: ?[]const f32) bool {
    const values = data orelse return false;
    return values.len >= TOTAL_FLOATS and @as(u32, @bitCast(values[MARKER_OFFSET])) == TRAILER_MARKER;
}

pub fn heightSlice(data: []const f32) ?[]const f32 {
    if (!hasTrailer(data)) return null;
    return data[HEIGHT_OFFSET .. HEIGHT_OFFSET + SAMPLE_COUNT];
}

pub fn clearMarker(data: []f32) void {
    if (data.len > MARKER_OFFSET) data[MARKER_OFFSET] = 0;
}
