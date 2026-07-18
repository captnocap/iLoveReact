//! Static-world streaming policy and material-stencil support types.
//!
//! Contains partitioning tunables and immutable row/range records, not runtime ownership.

const std = @import("std");
const constructor = @import("../world/constructor.zig");
const material_tex = @import("../gpu/material_tex.zig");
const config = @import("config.zig");
const state = @import("state.zig");
const MATERIAL_TILE_PX = config.MATERIAL_TILE_PX;
const clamp = state.clamp;

// ── world content streaming (req_0524, V30 applied to the render plane) ─────
// The GTA 3/VC/SA-era residency model: full-detail geometry streams in around
// the player by RADIUS (promotion instant, demotion hysteretic), draws are
// culled by sight (frustum now; the Compile-precomputed VIS lump shares the
// seam), and a derived LOD shell keeps the whole skyline visible for cheap.
// Draw distance (camera far + fog) is unchanged — this governs what is drawn
// at full detail, not how far the camera sees. framework/world/streaming.zig
// owns the partition/LOD/draw-set logic; here we feed it the draw batches and
// turn its ranges into sub-range static draws (scene3d_instance_first).
pub const STREAM_CELL_METERS: f32 = 64.0; // same granularity as the collider grid
pub const STREAM_DETAIL_RADIUS_METERS: f32 = 240.0;
pub const CUTOUT_STENCIL_DATA_HEADER: usize = 10;
pub const CUTOUT_STENCIL_MAX_CELLS: usize = 512 * 512;
pub const CUTOUT_STENCIL_MARKER = "D[10u + cy * igw + cx]";

pub const StreamMode = enum { off, auto, force };

pub fn streamModeFromEnv(environ: *const std.process.Environ.Map) StreamMode {
    const s = environ.get("RJIT_STREAM") orelse return .auto;
    if (s.len == 0) return .auto;
    if (std.mem.eql(u8, s, "0") or std.ascii.eqlIgnoreCase(s, "off")) return .off;
    return .force;
}

pub fn streamRadiusFromEnv(environ: *const std.process.Environ.Map) f32 {
    const s = environ.get("RJIT_STREAM_RADIUS") orelse return STREAM_DETAIL_RADIUS_METERS;
    const v = std.fmt.parseFloat(f32, s) catch return STREAM_DETAIL_RADIUS_METERS;
    return clamp(v, 64.0, 4096.0);
}

pub fn colorChannelByte(v: f32) u8 {
    const scaled = clamp(v, 0, 1) * 255.0;
    return @round(scaled);
}

pub fn cutoutStencilGridSize(data: []const f32) ?struct { w: usize, h: usize } {
    if (data.len < CUTOUT_STENCIL_DATA_HEADER) return null;
    const wf = data[0];
    const hf = data[1];
    if (wf < 1 or hf < 1 or wf > 512 or hf > 512) return null;
    const w: usize = @round(wf);
    const h: usize = @round(hf);
    if (w == 0 or h == 0 or w * h > CUTOUT_STENCIL_MAX_CELLS) return null;
    if (@abs(wf - @as(f32, @floatFromInt(w))) > 0.01) return null;
    if (@abs(hf - @as(f32, @floatFromInt(h))) > 0.01) return null;
    if (data.len < CUTOUT_STENCIL_DATA_HEADER + w * h) return null;
    return .{ .w = w, .h = h };
}

pub fn materializeCutoutStencilPixels(allocator: std.mem.Allocator, key: []const u8, material: constructor.Material) bool {
    if (std.mem.indexOf(u8, material.wgsl, CUTOUT_STENCIL_MARKER) == null) return false;
    const grid = cutoutStencilGridSize(material.data) orelse return false;
    const tile_px: usize = MATERIAL_TILE_PX;
    const rgba = allocator.alloc(u8, tile_px * tile_px * 4) catch return false;
    defer allocator.free(rgba);

    const fg = [_]u8{
        colorChannelByte(material.data[2]),
        colorChannelByte(material.data[3]),
        colorChannelByte(material.data[4]),
        255,
    };
    const bg = [_]u8{
        colorChannelByte(material.data[5]),
        colorChannelByte(material.data[6]),
        colorChannelByte(material.data[7]),
        colorChannelByte(material.data[8]),
    };
    const cells = material.data[CUTOUT_STENCIL_DATA_HEADER .. CUTOUT_STENCIL_DATA_HEADER + grid.w * grid.h];

    var py: usize = 0;
    while (py < tile_px) : (py += 1) {
        const cy = @min(grid.h - 1, (py * grid.h) / tile_px);
        var px: usize = 0;
        while (px < tile_px) : (px += 1) {
            const cx = @min(grid.w - 1, (px * grid.w) / tile_px);
            const cell_on = cells[cy * grid.w + cx] >= 0.5;
            const color = if (cell_on) fg else bg;
            const o = (py * tile_px + px) * 4;
            rgba[o + 0] = color[0];
            rgba[o + 1] = color[1];
            rgba[o + 2] = color[2];
            rgba[o + 3] = color[3];
        }
    }
    return material_tex.materializePixels(key, rgba, MATERIAL_TILE_PX, MATERIAL_TILE_PX);
}

/// What a streamed family draws as: the shared geometry + texture every range
/// node of that family carries. Indexes align with streaming.World.families.
pub const StreamProto = struct {
    geom_key: []const u8,
    verts: []const f32,
    tex_key: ?[]const u8,
};

// RESKIN req_1845: the kid_list node range a baked mesh-prop instance occupies, so a live
// re-skin of that prop can hide the stale baked draw for the frame.
pub const BakedRange = struct { first: u32, count: u32 };
// DIRTYRECT: a baked mesh-prop's world center + the node range it occupies, so an
// erase rect can hide the ones inside it (the move case the position-keyed RESKIN
// coincident-hide misses, because the live ref has moved off the baked spot).
pub const BakedMeshPos = struct { x: f32, y: f32, z: f32, range: BakedRange, wall: bool = false };
// DIRTYRECT: a collapsed BOX instance row — its buffer + row + the original scale,
// so a changed erase-rect set can un-collapse it before re-evaluating.
pub const ErasedRow = struct { buf: []f32, row: usize, sx: f32, sy: f32, sz: f32 };
// Erase rect = an AABB the editor marks dirty (a moved/deleted piece's old footprint).
pub const EraseRect = struct { min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32 };
