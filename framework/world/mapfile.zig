//! Platform mapfile reader for the slice-1 RJMP lump container.

const std = @import("std");

pub const MAGIC: u32 = 0x504d4a52; // "RJMP", little-endian
pub const VERSION: u16 = 0;
pub const HEADER_BYTES: usize = 16;
pub const DIRECTORY_ENTRY_BYTES: usize = 24;

pub const Encoding = enum(u16) {
    raw = 0,
    rle8 = 1,
    rle16 = 2,
    text = 3,
};

pub const LumpType = struct {
    pub const strings: u32 = 1;
    pub const tiles: u32 = 2;
    pub const heights: u32 = 3;
    pub const zones: u32 = 4;
    pub const placements: u32 = 5;
    pub const entities: u32 = 6;
    /// Packed 3D instance buffer: u32 count | f32[count*9] (pos3/scale3/color3).
    pub const instances: u32 = 7;
    /// Scene render environment (lighting / sky / camera framing) as data.
    pub const environment: u32 = 8;
    /// Baked local-coordinate player model mesh groups.
    pub const player_model: u32 = 9;
    /// Baked player animation clips: declarative transform keyframes.
    pub const player_animation: u32 = 10;
    /// Baked regular-grid terrain heightfields.
    pub const heightfields: u32 = 11;
};

pub const Lump = struct {
    type_id: u32,
    encoding: Encoding,
    offset: u32,
    length: u32,
    decoded_length: u32,
    data: []const u8,
};

pub const RleGrid = struct {
    width: u32,
    height: u32,
    values: []?u16,

    pub fn deinit(self: RleGrid, allocator: std.mem.Allocator) void {
        allocator.free(self.values);
    }
};

pub const Error = error{
    OutOfMemory,
    MapTooSmall,
    BadMagic,
    UnsupportedVersion,
    DirectoryOutOfBounds,
    UnknownEncoding,
    LumpOutOfBounds,
    RleTooSmall,
    RleTruncated,
    RleSizeOverflow,
};

fn readU16(bytes: []const u8, at: usize) u16 {
    return std.mem.readInt(u16, bytes[at..][0..2], .little);
}

fn readU32(bytes: []const u8, at: usize) u32 {
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}

fn known(type_id: u32, known_types: ?[]const u32) bool {
    const types = known_types orelse return true;
    for (types) |known_type| {
        if (known_type == type_id) return true;
    }
    return false;
}

pub fn readLumps(allocator: std.mem.Allocator, bytes: []const u8, known_types: ?[]const u32) Error![]Lump {
    if (bytes.len < HEADER_BYTES) return Error.MapTooSmall;
    if (readU32(bytes, 0) != MAGIC) return Error.BadMagic;
    if (readU16(bytes, 4) != VERSION) return Error.UnsupportedVersion;
    const count = readU32(bytes, 8);
    const dir_offset = readU32(bytes, 12);
    const dir_end = @as(usize, dir_offset) + @as(usize, count) * DIRECTORY_ENTRY_BYTES;
    if (dir_end > bytes.len) return Error.DirectoryOutOfBounds;

    var out: std.ArrayList(Lump) = .{};
    errdefer out.deinit(allocator);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const at = @as(usize, dir_offset) + i * DIRECTORY_ENTRY_BYTES;
        const type_id = readU32(bytes, at);
        const encoding_raw = readU16(bytes, at + 4);
        const encoding: Encoding = switch (encoding_raw) {
            0 => .raw,
            1 => .rle8,
            2 => .rle16,
            3 => .text,
            else => return Error.UnknownEncoding,
        };
        const offset = readU32(bytes, at + 8);
        const length = readU32(bytes, at + 12);
        const decoded_length = readU32(bytes, at + 16);
        const end = @as(usize, offset) + @as(usize, length);
        if (end > bytes.len) return Error.LumpOutOfBounds;
        if (!known(type_id, known_types)) continue;
        try out.append(allocator, .{
            .type_id = type_id,
            .encoding = encoding,
            .offset = offset,
            .length = length,
            .decoded_length = decoded_length,
            .data = bytes[@as(usize, offset)..end],
        });
    }
    return try out.toOwnedSlice(allocator);
}

pub fn findLump(lumps: []const Lump, type_id: u32) ?Lump {
    for (lumps) |lump| {
        if (lump.type_id == type_id) return lump;
    }
    return null;
}

pub fn decodeRle8(allocator: std.mem.Allocator, bytes: []const u8) Error!RleGrid {
    if (bytes.len < 12) return Error.RleTooSmall;
    const width = readU32(bytes, 0);
    const height = readU32(bytes, 4);
    const pair_count = readU32(bytes, 8);
    const payload_end = 12 + @as(usize, pair_count) * 3;
    if (payload_end > bytes.len) return Error.RleTruncated;
    const total = std.math.mul(usize, @as(usize, width), @as(usize, height)) catch return Error.RleSizeOverflow;
    const values = allocator.alloc(?u16, total) catch return Error.RleSizeOverflow;
    errdefer allocator.free(values);
    @memset(values, null);

    var out_index: usize = 0;
    var at: usize = 12;
    var i: usize = 0;
    while (i < pair_count) : (i += 1) {
        const count = readU16(bytes, at);
        const encoded = bytes[at + 2];
        at += 3;
        const value: ?u16 = if (encoded == 0) null else @as(u16, encoded) - 1;
        var n: usize = 0;
        while (n < count and out_index < values.len) : (n += 1) {
            values[out_index] = value;
            out_index += 1;
        }
    }
    return .{ .width = width, .height = height, .values = values };
}

pub fn decodeRle16(allocator: std.mem.Allocator, bytes: []const u8) Error!RleGrid {
    if (bytes.len < 12) return Error.RleTooSmall;
    const width = readU32(bytes, 0);
    const height = readU32(bytes, 4);
    const pair_count = readU32(bytes, 8);
    const payload_end = 12 + @as(usize, pair_count) * 4;
    if (payload_end > bytes.len) return Error.RleTruncated;
    const total = std.math.mul(usize, @as(usize, width), @as(usize, height)) catch return Error.RleSizeOverflow;
    const values = allocator.alloc(?u16, total) catch return Error.RleSizeOverflow;
    errdefer allocator.free(values);
    @memset(values, null);

    var out_index: usize = 0;
    var at: usize = 12;
    var i: usize = 0;
    while (i < pair_count) : (i += 1) {
        const count = readU16(bytes, at);
        const encoded = readU16(bytes, at + 2);
        at += 4;
        const value: ?u16 = if (encoded == 0) null else encoded - 1;
        var n: usize = 0;
        while (n < count and out_index < values.len) : (n += 1) {
            values[out_index] = value;
            out_index += 1;
        }
    }
    return .{ .width = width, .height = height, .values = values };
}
