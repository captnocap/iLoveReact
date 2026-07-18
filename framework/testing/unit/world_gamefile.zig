//! Cross-language proof for framework/world/gamefile.zig — the platform
//! game-file reader + content store.
//!
//! Run: zig build test-world-gamefile
//!
//! The TS writer (framework/testing/fixtures/gen_gamefile.ts, via the production
//! runtime/workspace writer) emits a full game file — three streams + a
//! content-addressed asset vocabulary; `rjit game verify` writes it to
//! gamefile_roundtrip.b64. Here the Zig reader ingests the SAME tape, asserts
//! the three streams are byte/value identical, installs every asset into a
//! content store and confirms the hashes + bytes, and resolves every reference.
//! Two negative controls (a corrupted blob, a dangling reference) must fail
//! loudly — proving the dependency gate bites, not just the happy path.

const std = @import("std");
const testing = std.testing;
const gamefile = @import("world_gamefile");
const mapfile = gamefile.mapfile;

fn loadFixtureBytes(allocator: std.mem.Allocator) ![]u8 {
    const path = std.testing.environ.getAlloc(allocator, "GAMEFILE_FIXTURE") catch
        try allocator.dupe(u8, "framework/testing/fixtures/gamefile_roundtrip.b64");
    defer allocator.free(path);
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, allocator, .limited(1 << 20));
    defer allocator.free(raw);
    const trimmed = std.mem.trim(u8, raw, " \t\r\n");
    const dec = std.base64.standard.Decoder;
    const size = try dec.calcSizeForSlice(trimmed);
    const out = try allocator.alloc(u8, size);
    errdefer allocator.free(out);
    try dec.decode(out, trimmed);
    return out;
}

fn offsetOf(buffer: []const u8, slice: []const u8) usize {
    return @intFromPtr(slice.ptr) - @intFromPtr(buffer.ptr);
}

fn writeInstalledAsset(dir: std.Io.Dir, payload: []const u8) !void {
    var hash: [gamefile.HASH_BYTES]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(payload, &hash, .{});
    const hex = std.fmt.bytesToHex(hash, .lower);
    var file = try dir.createFile(std.testing.io, hex[0..], .{ .truncate = true });
    defer file.close(std.testing.io);
    try file.writeStreamingAll(std.testing.io, payload);
}

test "TS-written game file: three streams round-trip byte/value identical" {
    const bytes = loadFixtureBytes(testing.allocator) catch |e| {
        std.debug.print("gamefile fixture missing ({any}); run `rjit game verify`\n", .{e});
        return e;
    };
    defer testing.allocator.free(bytes);

    const file = try gamefile.readGameFile(testing.allocator, bytes);
    defer file.deinit(testing.allocator);

    // logic stream: references asset 100, carries the tick/disposition params.
    try testing.expectEqual(@as(usize, 1), file.logic.refs.len);
    try testing.expectEqual(@as(u32, 100), file.logic.refs[0]);
    try testing.expectEqualStrings("ticks=45\nkind.cop.disposition=hostile\n", file.logic.data);

    // skins stream: references asset 102, carries the dupe row.
    try testing.expectEqual(@as(usize, 1), file.skins.refs.len);
    try testing.expectEqual(@as(u32, 102), file.skins.refs[0]);
    try testing.expectEqualStrings("dupe:car01\n", file.skins.data);

    // map stream: references 100 + 101, data is a nested RJMP map container.
    try testing.expectEqual(@as(usize, 2), file.map.refs.len);
    try testing.expectEqual(@as(u32, 100), file.map.refs[0]);
    try testing.expectEqual(@as(u32, 101), file.map.refs[1]);
    const map_lumps = try mapfile.readLumps(testing.allocator, file.map.data, null);
    defer testing.allocator.free(map_lumps);
    try testing.expectEqual(@as(usize, 3), map_lumps.len);
    const tiles = mapfile.findLump(map_lumps, mapfile.LumpType.tiles).?;
    const tile_grid = try mapfile.decodeRle16(testing.allocator, tiles.data);
    defer tile_grid.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 3), tile_grid.width);
    try testing.expectEqual(@as(u32, 2), tile_grid.height);
    const want_tiles = [_]?u16{ 0, 0, 1, 1, 1, 1 };
    for (want_tiles, tile_grid.values) |w, g| try testing.expectEqual(w, g);
}

test "asset vocabulary installs into the content store and references resolve" {
    const bytes = try loadFixtureBytes(testing.allocator);
    defer testing.allocator.free(bytes);
    const file = try gamefile.readGameFile(testing.allocator, bytes);
    defer file.deinit(testing.allocator);

    // manifest carries the three vocabulary assets.
    try testing.expectEqual(@as(usize, 3), file.manifest.len);
    try testing.expectEqual(@as(usize, 3), file.blobs.len);

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    // the dependency gate: verify + install + resolve, all green.
    try file.installAndValidate(testing.io, testing.allocator, tmp.dir);

    // each blob landed in the store keyed by hex(sha256), bytes intact.
    for (file.blobs) |blob| {
        var actual: [gamefile.HASH_BYTES]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(blob.payload, &actual, .{});
        const hex = std.fmt.bytesToHex(actual, .lower);
        const stored = try tmp.dir.readFileAlloc(std.testing.io, hex[0..], testing.allocator, .limited(1 << 20));
        defer testing.allocator.free(stored);
        try testing.expectEqualSlices(u8, blob.payload, stored);
    }

    // every stream reference resolves to an installed asset hash.
    for ([_]u32{ 100, 101, 102 }) |key| {
        const hash = file.assetHashForKey(key) orelse return error.TestUnexpectedResult;
        const hex = std.fmt.bytesToHex(hash, .lower);
        try tmp.dir.access(std.testing.io, hex[0..], .{});
    }
}

test "manifest-only asset resolves when its content-addressed bytes are already installed" {
    const bytes = try loadFixtureBytes(testing.allocator);
    defer testing.allocator.free(bytes);

    const probe = try gamefile.readGameFile(testing.allocator, bytes);
    const payload = try testing.allocator.dupe(u8, probe.blobs[0].payload);
    probe.deinit(testing.allocator);
    defer testing.allocator.free(payload);

    const manifest_only = try testing.allocator.dupe(u8, bytes);
    defer testing.allocator.free(manifest_only);
    const dir_offset = std.mem.readInt(u32, manifest_only[12..16], .little);
    const count = std.mem.readInt(u32, manifest_only[8..12], .little);
    var i: usize = 0;
    var removed = false;
    while (i < count) : (i += 1) {
        const at = @as(usize, dir_offset) + i * 24;
        if (std.mem.readInt(u32, manifest_only[at..][0..4], .little) == gamefile.LumpId.asset_blob) {
            std.mem.writeInt(u32, manifest_only[at..][0..4], 999, .little);
            removed = true;
            break;
        }
    }
    try testing.expect(removed);

    const file = try gamefile.readGameFile(testing.allocator, manifest_only);
    defer file.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 2), file.blobs.len);

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try writeInstalledAsset(tmp.dir, payload);
    try file.installAndValidate(testing.io, testing.allocator, tmp.dir);
}

test "negative control: a corrupted asset blob fails the hash check loudly" {
    const bytes = try loadFixtureBytes(testing.allocator);
    defer testing.allocator.free(bytes);

    // locate the first blob's payload in the source buffer, then corrupt a copy.
    const probe = try gamefile.readGameFile(testing.allocator, bytes);
    const payload_at = offsetOf(bytes, probe.blobs[0].payload);
    probe.deinit(testing.allocator);

    const corrupt = try testing.allocator.dupe(u8, bytes);
    defer testing.allocator.free(corrupt);
    corrupt[payload_at] ^= 0xff; // flip a payload byte; claimed hash untouched

    const file = try gamefile.readGameFile(testing.allocator, corrupt);
    defer file.deinit(testing.allocator);

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try testing.expectError(gamefile.Error.BadAssetHash, file.installAndValidate(testing.io, testing.allocator, tmp.dir));
}

test "negative control: a dangling stream reference fails loudly" {
    const bytes = try loadFixtureBytes(testing.allocator);
    defer testing.allocator.free(bytes);

    // rewrite the logic stream's first ref key to one absent from the manifest.
    const corrupt = try testing.allocator.dupe(u8, bytes);
    defer testing.allocator.free(corrupt);
    const lumps = try mapfile.readLumps(testing.allocator, corrupt, null);
    defer testing.allocator.free(lumps);
    const logic_lump = mapfile.findLump(lumps, gamefile.LumpId.stream_logic).?;
    const ref0_at = offsetOf(corrupt, logic_lump.data) + 4; // refCount(4) then refs[0]
    std.mem.writeInt(u32, corrupt[ref0_at..][0..4], 0xdeadbeef, .little);

    const file = try gamefile.readGameFile(testing.allocator, corrupt);
    defer file.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 0xdeadbeef), file.logic.refs[0]);

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try testing.expectError(gamefile.Error.MissingReference, file.installAndValidate(testing.io, testing.allocator, tmp.dir));
}
