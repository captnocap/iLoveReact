//! Platform constructor (PLATMOD §4.4, V28) — "the loader takes in all the data,
//! constructs the game from it."
//!
//! Reads a game-file (gamefile.zig), runs the load-time dependency gate
//! (install + sha256-verify every asset into the content store, resolve every
//! stream reference), then composes the smallest renderable: the game-map
//! stream's tile grid. The composed Scene is handed to the stateless render
//! capability (the loader's gpu draw loop) — NO per-game script, NO V8. This
//! is the data-only construct half of the keystone; the render half lives in
//! world_loader.zig.

const std = @import("std");
const gamefile = @import("gamefile.zig");
const mapfile = gamefile.mapfile;

pub const Error = gamefile.Error || error{
    NoMapTiles,
    UnsupportedTileEncoding,
};

/// The composed, renderable world. `tiles` is the row-major map tile grid
/// (null = absent cell); heap-owned. `instances` is the packed 3D instance
/// buffer (f32, stride 9: pos3/scale3/color3) the loader renders as one
/// instanced unit-cube batch — empty when the game-file carries no instance
/// lump (e.g. the codec round-trip fixture). Grows as more streams compose.
pub const Scene = struct {
    width: u32,
    height: u32,
    tiles: []?u16,
    instances: []f32,
    instance_count: u32,

    pub fn deinit(self: Scene, allocator: std.mem.Allocator) void {
        allocator.free(self.tiles);
        allocator.free(self.instances);
    }
};

const DecodedInstances = struct { values: []f32, count: u32 };

/// Decode an instance lump payload (u32 count | f32[count*9]) into a heap-owned
/// f32 buffer. Returns an empty buffer when the lump is absent or malformed.
fn decodeInstances(allocator: std.mem.Allocator, data: []const u8) Error!DecodedInstances {
    if (data.len < 4) return .{ .values = &.{}, .count = 0 };
    const count = std.mem.readInt(u32, data[0..4], .little);
    const floats = @as(usize, count) * 9;
    const need = 4 + floats * 4;
    if (count == 0 or need > data.len) return .{ .values = &.{}, .count = 0 };
    const values = allocator.alloc(f32, floats) catch return Error.OutOfMemory;
    errdefer allocator.free(values);
    var i: usize = 0;
    while (i < floats) : (i += 1) {
        const bits = std.mem.readInt(u32, data[4 + i * 4 ..][0..4], .little);
        values[i] = @bitCast(bits);
    }
    return .{ .values = values, .count = count };
}

/// Construct a Scene from a game-file's bytes: validate the dependency gate
/// against `store_dir`, then decode the map stream's tile grid. The asset
/// vocabulary is installed/verified as a side effect (the gate must pass before
/// anything is composed).
pub fn construct(allocator: std.mem.Allocator, bytes: []const u8, store_dir: std.fs.Dir) Error!Scene {
    const file = try gamefile.readGameFile(allocator, bytes);
    defer file.deinit(allocator);

    // The gate: install + sha256-verify every asset, resolve every reference.
    // Nothing is constructed until the whole vocabulary checks out.
    try file.installAndValidate(allocator, store_dir);

    // The game-map stream's data is a nested RJMP map container; pull its tiles.
    const map_lumps = try mapfile.readLumps(allocator, file.map.data, null);
    defer allocator.free(map_lumps);
    const tiles_lump = mapfile.findLump(map_lumps, mapfile.LumpType.tiles) orelse return Error.NoMapTiles;

    const grid = switch (tiles_lump.encoding) {
        .rle16 => try mapfile.decodeRle16(allocator, tiles_lump.data),
        .rle8 => try mapfile.decodeRle8(allocator, tiles_lump.data),
        else => return Error.UnsupportedTileEncoding,
    };
    errdefer allocator.free(grid.values);

    // The 3D geometry: the authored world's instance buffer (optional — absent
    // in the codec round-trip fixture, present in the real editor bake).
    const inst: DecodedInstances = if (mapfile.findLump(map_lumps, mapfile.LumpType.instances)) |lump|
        try decodeInstances(allocator, lump.data)
    else
        .{ .values = &.{}, .count = 0 };

    // grid.values ownership transfers to the Scene; do not deinit grid.
    return .{
        .width = grid.width,
        .height = grid.height,
        .tiles = grid.values,
        .instances = inst.values,
        .instance_count = inst.count,
    };
}
