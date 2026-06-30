//! Unit coverage for framework/world/gamefile_writer.zig.
//!
//! The writer must emit bytes that the existing platform reader accepts. The
//! cross-language parity command adds the byte-for-byte TS comparison; this test
//! keeps the Zig writer honest at the framework layer.

const std = @import("std");
const testing = std.testing;
const writer = @import("world_gamefile_writer");
const gamefile = @import("world_gamefile");
const mapfile = gamefile.mapfile;

const GridCtx = struct {
    values: []const ?u16,
    width: u32,
};

fn gridValue(ctx: GridCtx, x: u32, y: u32) ?u16 {
    return ctx.values[@as(usize, y) * @as(usize, ctx.width) + @as(usize, x)];
}

test "Zig writer emits a readable three-stream gamefile" {
    const tiles_values = [_]?u16{ 1, 1, 2, null, 2, 2 };
    const ctx = GridCtx{ .values = &tiles_values, .width = 3 };
    const tiles = try writer.encodeRle16Grid(testing.allocator, 3, 2, ctx, gridValue);
    defer testing.allocator.free(tiles);

    var map_lumps = [_]writer.LumpInput{
        .{ .type_id = mapfile.LumpType.strings, .encoding = .text, .data = "0\tnull\n1\troad\n2\tgrass\n" },
        .{ .type_id = mapfile.LumpType.tiles, .encoding = .rle16, .data = tiles },
    };
    const map_container = try writer.writeLumpContainer(testing.allocator, map_lumps[0..]);
    defer testing.allocator.free(map_container);

    const asset_bytes = "asset:parity\n";
    const assets = [_]writer.AssetInput{.{ .key = 1000, .kind = 30, .bytes = asset_bytes, .embed = true }};
    const refs = [_]u32{1000};
    const bytes = try writer.writeGameFile(testing.allocator, .{
        .logic = .{ .refs = &.{}, .data = "logic\n" },
        .map = .{ .refs = &refs, .data = map_container },
        .skins = .{ .refs = &.{}, .data = "skins\n" },
        .assets = &assets,
    });
    defer testing.allocator.free(bytes);

    const file = try gamefile.readGameFile(testing.allocator, bytes);
    defer file.deinit(testing.allocator);

    try testing.expectEqualStrings("logic\n", file.logic.data);
    try testing.expectEqualStrings("skins\n", file.skins.data);
    try testing.expectEqual(@as(usize, 1), file.map.refs.len);
    try testing.expectEqual(@as(u32, 1000), file.map.refs[0]);
    try testing.expectEqual(@as(usize, 1), file.manifest.len);
    try testing.expectEqual(@as(u32, 1000), file.manifest[0].key);
    try testing.expectEqual(@as(u16, 30), file.manifest[0].kind);
    try testing.expectEqual(@as(usize, 1), file.blobs.len);
    try testing.expectEqualStrings(asset_bytes, file.blobs[0].payload);

    const read_lumps = try mapfile.readLumps(testing.allocator, file.map.data, null);
    defer testing.allocator.free(read_lumps);
    const tiles_lump = mapfile.findLump(read_lumps, mapfile.LumpType.tiles).?;
    const grid = try mapfile.decodeRle16(testing.allocator, tiles_lump.data);
    defer grid.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 3), grid.width);
    try testing.expectEqual(@as(u32, 2), grid.height);
    for (tiles_values, grid.values) |want, got| try testing.expectEqual(want, got);
}
