//! Platform map/game-file writer for compiler parity work.
//!
//! `framework/world/gamefile.zig` is the reader half. This module mirrors the
//! TypeScript writer in runtime/workspace/{lumps,gamefile}.ts closely enough for
//! byte-for-byte parity tests and for future migration of compile stages into Zig.

const std = @import("std");

pub const MAGIC: u32 = 0x504d4a52; // "RJMP", little-endian
pub const VERSION: u16 = 0;

pub const Encoding = enum(u16) {
    raw = 0,
    rle8 = 1,
    rle16 = 2,
    text = 3,
};

pub const MapLump = struct {
    pub const strings: u32 = 1;
    pub const tiles: u32 = 2;
    pub const heights: u32 = 3;
    pub const zones: u32 = 4;
    pub const placements: u32 = 5;
    pub const entities: u32 = 6;
};

pub const LumpInput = struct {
    type_id: u32,
    encoding: Encoding,
    data: []const u8,
};

pub const StreamInput = struct {
    refs: []const u32,
    data: []const u8,
};

pub const AssetInput = struct {
    key: u32,
    kind: u16,
    bytes: []const u8,
    embed: bool = true,
};

pub const GameFileInput = struct {
    logic: StreamInput,
    map: StreamInput,
    skins: StreamInput,
    assets: []const AssetInput,
};

pub const GameLump = struct {
    pub const stream_logic: u32 = 16;
    pub const stream_map: u32 = 17;
    pub const stream_skins: u32 = 18;
    pub const asset_manifest: u32 = 19;
    pub const asset_blob: u32 = 20;
};

pub const Error = error{
    OutOfMemory,
    ValueOutOfRange,
};

const ALIGNMENT: usize = 16;
const HEADER_BYTES: usize = 16;
const DIRECTORY_ENTRY_BYTES: usize = 24;
const MANIFEST_ENTRY_BYTES: usize = 44;
const HASH_BYTES: usize = 32;

fn alignForward(value: usize) usize {
    return ((value + ALIGNMENT - 1) / ALIGNMENT) * ALIGNMENT;
}

fn appendU16(out: *std.ArrayList(u8), allocator: std.mem.Allocator, value: u16) Error!void {
    var bytes: [2]u8 = undefined;
    std.mem.writeInt(u16, &bytes, value, .little);
    out.appendSlice(allocator, &bytes) catch return Error.OutOfMemory;
}

fn appendU32(out: *std.ArrayList(u8), allocator: std.mem.Allocator, value: u32) Error!void {
    var bytes: [4]u8 = undefined;
    std.mem.writeInt(u32, &bytes, value, .little);
    out.appendSlice(allocator, &bytes) catch return Error.OutOfMemory;
}

fn writeU16(out: []u8, at: usize, value: u16) void {
    std.mem.writeInt(u16, out[at..][0..2], value, .little);
}

fn writeU32(out: []u8, at: usize, value: u32) void {
    std.mem.writeInt(u32, out[at..][0..4], value, .little);
}

fn u32FromUsize(value: usize) Error!u32 {
    if (value > std.math.maxInt(u32)) return Error.ValueOutOfRange;
    return @intCast(value);
}

fn sha256(bytes: []const u8) [HASH_BYTES]u8 {
    var out: [HASH_BYTES]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &out, .{});
    return out;
}

pub fn writeLumpContainer(allocator: std.mem.Allocator, lumps: []const LumpInput) Error![]u8 {
    const Entry = struct {
        type_id: u32,
        encoding: Encoding,
        offset: u32,
        length: u32,
        decoded_length: u32,
    };

    const directory_bytes = lumps.len * DIRECTORY_ENTRY_BYTES;
    var data_offset = alignForward(HEADER_BYTES + directory_bytes);
    const entries = allocator.alloc(Entry, lumps.len) catch return Error.OutOfMemory;
    defer allocator.free(entries);

    for (lumps, 0..) |lump, i| {
        data_offset = alignForward(data_offset);
        entries[i] = .{
            .type_id = lump.type_id,
            .encoding = lump.encoding,
            .offset = try u32FromUsize(data_offset),
            .length = try u32FromUsize(lump.data.len),
            .decoded_length = try u32FromUsize(lump.data.len),
        };
        data_offset += lump.data.len;
    }

    const out = allocator.alloc(u8, data_offset) catch return Error.OutOfMemory;
    @memset(out, 0);
    writeU32(out, 0, MAGIC);
    writeU16(out, 4, VERSION);
    writeU16(out, 6, ALIGNMENT);
    writeU32(out, 8, try u32FromUsize(lumps.len));
    writeU32(out, 12, HEADER_BYTES);

    for (entries, 0..) |entry, i| {
        const at = HEADER_BYTES + i * DIRECTORY_ENTRY_BYTES;
        writeU32(out, at + 0, entry.type_id);
        writeU16(out, at + 4, @intFromEnum(entry.encoding));
        writeU16(out, at + 6, 0);
        writeU32(out, at + 8, entry.offset);
        writeU32(out, at + 12, entry.length);
        writeU32(out, at + 16, entry.decoded_length);
        writeU32(out, at + 20, 0);
        const dst = out[@as(usize, entry.offset)..][0..entry.length];
        @memcpy(dst, lumps[i].data);
    }
    return out;
}

pub fn encodeRle16Grid(
    allocator: std.mem.Allocator,
    width: u32,
    height: u32,
    context: anytype,
    comptime valueAt: anytype,
) Error![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    out.appendNTimes(allocator, 0, 12) catch return Error.OutOfMemory;

    var pair_count: u32 = 0;
    var y: u32 = 0;
    while (y < height) : (y += 1) {
        var x: u32 = 0;
        while (x < width) {
            const value = valueAt(context, x, y);
            var run: u32 = 1;
            while (x + run < width and run < 0xffff) : (run += 1) {
                const next = valueAt(context, x + run, y);
                if (next != value) break;
            }
            const encoded: u16 = if (value) |v| v + 1 else 0;
            try appendU16(&out, allocator, @intCast(run));
            try appendU16(&out, allocator, encoded);
            pair_count += 1;
            x += run;
        }
    }

    writeU32(out.items, 0, width);
    writeU32(out.items, 4, height);
    writeU32(out.items, 8, pair_count);
    return out.toOwnedSlice(allocator) catch return Error.OutOfMemory;
}

pub fn encodeStream(allocator: std.mem.Allocator, stream: StreamInput) Error![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try appendU32(&out, allocator, try u32FromUsize(stream.refs.len));
    for (stream.refs) |ref| try appendU32(&out, allocator, ref);
    try appendU32(&out, allocator, try u32FromUsize(stream.data.len));
    out.appendSlice(allocator, stream.data) catch return Error.OutOfMemory;
    return out.toOwnedSlice(allocator) catch return Error.OutOfMemory;
}

pub fn encodeManifest(allocator: std.mem.Allocator, assets: []const AssetInput) Error![]u8 {
    const len = 4 + assets.len * MANIFEST_ENTRY_BYTES;
    const out = allocator.alloc(u8, len) catch return Error.OutOfMemory;
    @memset(out, 0);
    writeU32(out, 0, try u32FromUsize(assets.len));
    var at: usize = 4;
    for (assets) |asset| {
        const hash = sha256(asset.bytes);
        writeU32(out, at + 0, asset.key);
        writeU16(out, at + 4, asset.kind);
        writeU16(out, at + 6, 0);
        writeU32(out, at + 8, try u32FromUsize(asset.bytes.len));
        @memcpy(out[at + 12 .. at + 12 + HASH_BYTES], &hash);
        at += MANIFEST_ENTRY_BYTES;
    }
    return out;
}

pub fn encodeBlob(allocator: std.mem.Allocator, bytes: []const u8) Error![]u8 {
    const out = allocator.alloc(u8, HASH_BYTES + bytes.len) catch return Error.OutOfMemory;
    const hash = sha256(bytes);
    @memcpy(out[0..HASH_BYTES], &hash);
    @memcpy(out[HASH_BYTES..], bytes);
    return out;
}

pub fn writeGameFile(allocator: std.mem.Allocator, input: GameFileInput) Error![]u8 {
    const logic = try encodeStream(allocator, input.logic);
    defer allocator.free(logic);
    const map = try encodeStream(allocator, input.map);
    defer allocator.free(map);
    const skins = try encodeStream(allocator, input.skins);
    defer allocator.free(skins);
    const manifest = try encodeManifest(allocator, input.assets);
    defer allocator.free(manifest);

    var blob_payloads: std.ArrayList([]u8) = .empty;
    defer {
        for (blob_payloads.items) |payload| allocator.free(payload);
        blob_payloads.deinit(allocator);
    }

    var lumps: std.ArrayList(LumpInput) = .empty;
    defer lumps.deinit(allocator);
    lumps.append(allocator, .{ .type_id = GameLump.stream_logic, .encoding = .raw, .data = logic }) catch return Error.OutOfMemory;
    lumps.append(allocator, .{ .type_id = GameLump.stream_map, .encoding = .raw, .data = map }) catch return Error.OutOfMemory;
    lumps.append(allocator, .{ .type_id = GameLump.stream_skins, .encoding = .raw, .data = skins }) catch return Error.OutOfMemory;
    lumps.append(allocator, .{ .type_id = GameLump.asset_manifest, .encoding = .raw, .data = manifest }) catch return Error.OutOfMemory;
    for (input.assets) |asset| {
        if (!asset.embed) continue;
        const blob = try encodeBlob(allocator, asset.bytes);
        blob_payloads.append(allocator, blob) catch {
            allocator.free(blob);
            return Error.OutOfMemory;
        };
        lumps.append(allocator, .{ .type_id = GameLump.asset_blob, .encoding = .raw, .data = blob }) catch return Error.OutOfMemory;
    }
    return try writeLumpContainer(allocator, lumps.items);
}
