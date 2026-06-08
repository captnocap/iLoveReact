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
/// (null = absent cell); heap-owned. Grows as more streams are composed.
pub const Scene = struct {
    width: u32,
    height: u32,
    tiles: []?u16,

    pub fn deinit(self: Scene, allocator: std.mem.Allocator) void {
        allocator.free(self.tiles);
    }
};

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
    // grid.values ownership transfers to the Scene; do not deinit grid.
    return .{ .width = grid.width, .height = grid.height, .tiles = grid.values };
}
