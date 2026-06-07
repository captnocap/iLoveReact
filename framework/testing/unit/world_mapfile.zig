//! Behavior tests for framework/world/mapfile.zig.
//!
//! Run: zig build test-world-mapfile

const std = @import("std");
const testing = std.testing;
const mapfile = @import("world_mapfile");

const InputLump = struct {
    type_id: u32,
    encoding: mapfile.Encoding,
    data: []const u8,
};

fn writeU16(bytes: []u8, at: usize, value: u16) void {
    std.mem.writeInt(u16, bytes[at..][0..2], value, .little);
}

fn writeU32(bytes: []u8, at: usize, value: u32) void {
    std.mem.writeInt(u32, bytes[at..][0..4], value, .little);
}

fn align16(value: usize) usize {
    return ((value + 15) / 16) * 16;
}

fn fixture(allocator: std.mem.Allocator, lumps: []const InputLump) ![]u8 {
    var total = align16(mapfile.HEADER_BYTES + lumps.len * mapfile.DIRECTORY_ENTRY_BYTES);
    var offsets = try allocator.alloc(usize, lumps.len);
    defer allocator.free(offsets);
    for (lumps, 0..) |lump, i| {
        total = align16(total);
        offsets[i] = total;
        total += lump.data.len;
    }
    const out = try allocator.alloc(u8, total);
    @memset(out, 0);
    writeU32(out, 0, mapfile.MAGIC);
    writeU16(out, 4, mapfile.VERSION);
    writeU16(out, 6, 16);
    writeU32(out, 8, @intCast(lumps.len));
    writeU32(out, 12, mapfile.HEADER_BYTES);
    for (lumps, 0..) |lump, i| {
        const at = mapfile.HEADER_BYTES + i * mapfile.DIRECTORY_ENTRY_BYTES;
        writeU32(out, at + 0, lump.type_id);
        writeU16(out, at + 4, @intFromEnum(lump.encoding));
        writeU16(out, at + 6, 0);
        writeU32(out, at + 8, @intCast(offsets[i]));
        writeU32(out, at + 12, @intCast(lump.data.len));
        writeU32(out, at + 16, @intCast(lump.data.len));
        writeU32(out, at + 20, 0);
        @memcpy(out[offsets[i] .. offsets[i] + lump.data.len], lump.data);
    }
    return out;
}

fn rle16Fixture() []const u8 {
    // width=4 height=2 pairs:
    // row 0: [1,1,null,2]
    // row 1: [2,2,2,null]
    return &[_]u8{
        4, 0, 0, 0, 2, 0, 0, 0, 5, 0, 0, 0,
        2, 0, 2, 0,
        1, 0, 0, 0,
        1, 0, 3, 0,
        3, 0, 3, 0,
        1, 0, 0, 0,
    };
}

test "lump reader returns known entries and text payloads" {
    const bytes = try fixture(testing.allocator, &.{
        .{ .type_id = mapfile.LumpType.strings, .encoding = .text, .data = "0\troad\n" },
        .{ .type_id = mapfile.LumpType.entities, .encoding = .text, .data = "format=hmsc.entities.v0\n" },
    });
    defer testing.allocator.free(bytes);
    const lumps = try mapfile.readLumps(testing.allocator, bytes, null);
    defer testing.allocator.free(lumps);
    try testing.expectEqual(@as(usize, 2), lumps.len);
    try testing.expectEqual(mapfile.Encoding.text, lumps[0].encoding);
    try testing.expectEqualStrings("0\troad\n", lumps[0].data);
}

test "future lump types are skipped by an older known-type reader" {
    const future_type: u32 = 0x7fff_fff0;
    const known = [_]u32{mapfile.LumpType.tiles};
    const bytes = try fixture(testing.allocator, &.{
        .{ .type_id = mapfile.LumpType.tiles, .encoding = .rle16, .data = rle16Fixture() },
        .{ .type_id = future_type, .encoding = .raw, .data = &.{ 1, 2, 3, 4 } },
    });
    defer testing.allocator.free(bytes);
    const lumps = try mapfile.readLumps(testing.allocator, bytes, &known);
    defer testing.allocator.free(lumps);
    try testing.expectEqual(@as(usize, 1), lumps.len);
    try testing.expectEqual(mapfile.LumpType.tiles, lumps[0].type_id);
}

test "rle16 payload decodes count/value pairs with null sentinel" {
    const grid = try mapfile.decodeRle16(testing.allocator, rle16Fixture());
    defer grid.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 4), grid.width);
    try testing.expectEqual(@as(u32, 2), grid.height);
    try testing.expectEqual(@as(?u16, 1), grid.values[0]);
    try testing.expectEqual(@as(?u16, 1), grid.values[1]);
    try testing.expectEqual(@as(?u16, null), grid.values[2]);
    try testing.expectEqual(@as(?u16, 2), grid.values[3]);
    try testing.expectEqual(@as(?u16, 2), grid.values[4]);
    try testing.expectEqual(@as(?u16, 2), grid.values[5]);
    try testing.expectEqual(@as(?u16, 2), grid.values[6]);
    try testing.expectEqual(@as(?u16, null), grid.values[7]);
}
