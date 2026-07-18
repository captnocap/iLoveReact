//! Platform game-file reader + content store (PLATMOD §2-4, V28/V29).
//!
//! A shipped game is DATA: an asset vocabulary (content-addressed blobs) plus
//! THREE RLE streams composing those assets BY REFERENCE — game-logic,
//! game-map, items/skins. This module is the READER half of that contract:
//!
//!   - readGameFile      ingest the three streams + the asset manifest + blobs
//!   - installAndValidate sha256-verify each blob, atomically install it into
//!                        the content store keyed by hash, then check every
//!                        manifest asset is present and every stream reference
//!                        resolves — all BEFORE anything is constructed.
//!
//! There is NO constructor here (PLATMOD §4.4, gated on this). The content
//! address is sha256; the writer half is runtime/workspace/gamefile.ts; the
//! frozen wire contract is docs/game/RLE_FORMAT.md §7.

const std = @import("std");
/// Re-exported so a single importer of gamefile.zig also gets the lump/RLE
/// reader without mapfile.zig having to be its own wired module.
pub const mapfile = @import("mapfile.zig");

pub const HASH_BYTES: usize = 32;
pub const MANIFEST_ENTRY_BYTES: usize = 44; // key(4) kind(2) rsv(2) length(4) hash(32)

/// Top-level game-file lump type ids (distinct range from map sub-lumps 1-6).
pub const LumpId = struct {
    pub const stream_logic: u32 = 16;
    pub const stream_map: u32 = 17;
    pub const stream_skins: u32 = 18;
    pub const asset_manifest: u32 = 19;
    pub const asset_blob: u32 = 20;
};

pub const Error = error{
    MissingStream,
    BadStream,
    BadManifest,
    BadBlob,
    BadAssetHash,
    MissingAsset,
    MissingReference,
    InstallFailed,
    OutOfMemory,
} || mapfile.Error;

/// A composed stream: the asset keys it references + its own data. `data` is a
/// slice into the source buffer (for STREAM_MAP it is a nested RJMP container).
pub const Stream = struct {
    refs: []u32,
    data: []const u8,
};

pub const ManifestEntry = struct {
    key: u32,
    kind: u16,
    length: u32,
    hash: [HASH_BYTES]u8,
};

pub const Blob = struct {
    claimed_hash: [HASH_BYTES]u8,
    payload: []const u8,
};

/// Borrows the source `bytes` (streams/blobs slice into it); the refs, manifest,
/// and blobs arrays are heap-owned. Keep `bytes` alive until deinit.
pub const GameFile = struct {
    logic: Stream,
    map: Stream,
    skins: Stream,
    manifest: []ManifestEntry,
    blobs: []Blob,

    pub fn deinit(self: GameFile, allocator: std.mem.Allocator) void {
        allocator.free(self.logic.refs);
        allocator.free(self.map.refs);
        allocator.free(self.skins.refs);
        allocator.free(self.manifest);
        allocator.free(self.blobs);
    }

    /// The content hash a referenced asset key resolves to, or null if the key
    /// is absent from the manifest.
    pub fn assetHashForKey(self: GameFile, key: u32) ?[HASH_BYTES]u8 {
        for (self.manifest) |entry| {
            if (entry.key == key) return entry.hash;
        }
        return null;
    }

    /// The dependency gate before construction: verify+install every asset blob,
    /// confirm every manifest asset is either embedded or already installed in
    /// the content store, and confirm every stream reference resolves. `dir` is
    /// the content store. Fails loudly on the first violation.
    pub fn installAndValidate(self: GameFile, io: std.Io, allocator: std.mem.Allocator, dir: std.Io.Dir) Error!void {
        var installed: std.ArrayList([HASH_BYTES]u8) = .empty;
        defer installed.deinit(allocator);

        for (self.blobs) |blob| {
            const actual = sha256(blob.payload);
            if (!std.mem.eql(u8, &actual, &blob.claimed_hash)) return Error.BadAssetHash;
            try atomicInstall(io, dir, actual, blob.payload);
            try installed.append(allocator, actual);
        }

        for (self.manifest) |entry| {
            if (containsHash(installed.items, entry.hash)) continue;
            if (!try installedAssetMatches(io, allocator, dir, entry)) return Error.MissingAsset;
        }

        try validateRefs(self.logic, self.manifest);
        try validateRefs(self.map, self.manifest);
        try validateRefs(self.skins, self.manifest);
    }
};

fn readU16(bytes: []const u8, at: usize) u16 {
    return std.mem.readInt(u16, bytes[at..][0..2], .little);
}

fn readU32(bytes: []const u8, at: usize) u32 {
    return std.mem.readInt(u32, bytes[at..][0..4], .little);
}

fn parseStream(allocator: std.mem.Allocator, payload: []const u8) Error!Stream {
    if (payload.len < 4) return Error.BadStream;
    const ref_count = readU32(payload, 0);
    const refs_end = 4 + @as(usize, ref_count) * 4;
    if (refs_end + 4 > payload.len) return Error.BadStream;
    const refs = allocator.alloc(u32, ref_count) catch return Error.OutOfMemory;
    errdefer allocator.free(refs);
    var i: usize = 0;
    while (i < ref_count) : (i += 1) refs[i] = readU32(payload, 4 + i * 4);
    const data_len = readU32(payload, refs_end);
    const data_start = refs_end + 4;
    if (data_start + @as(usize, data_len) > payload.len) return Error.BadStream;
    return .{ .refs = refs, .data = payload[data_start .. data_start + @as(usize, data_len)] };
}

fn parseManifest(allocator: std.mem.Allocator, payload: []const u8) Error![]ManifestEntry {
    if (payload.len < 4) return Error.BadManifest;
    const count = readU32(payload, 0);
    const need = 4 + @as(usize, count) * MANIFEST_ENTRY_BYTES;
    if (need > payload.len) return Error.BadManifest;
    const entries = allocator.alloc(ManifestEntry, count) catch return Error.OutOfMemory;
    errdefer allocator.free(entries);
    var at: usize = 4;
    var i: usize = 0;
    while (i < count) : (i += 1) {
        var entry: ManifestEntry = undefined;
        entry.key = readU32(payload, at);
        entry.kind = readU16(payload, at + 4);
        entry.length = readU32(payload, at + 8);
        @memcpy(entry.hash[0..], payload[at + 12 .. at + 12 + HASH_BYTES]);
        entries[i] = entry;
        at += MANIFEST_ENTRY_BYTES;
    }
    return entries;
}

pub fn readGameFile(allocator: std.mem.Allocator, bytes: []const u8) Error!GameFile {
    const lumps = try mapfile.readLumps(allocator, bytes, null);
    defer allocator.free(lumps);

    const logic_lump = mapfile.findLump(lumps, LumpId.stream_logic) orelse return Error.MissingStream;
    const map_lump = mapfile.findLump(lumps, LumpId.stream_map) orelse return Error.MissingStream;
    const skins_lump = mapfile.findLump(lumps, LumpId.stream_skins) orelse return Error.MissingStream;
    const manifest_lump = mapfile.findLump(lumps, LumpId.asset_manifest) orelse return Error.MissingStream;

    const logic = try parseStream(allocator, logic_lump.data);
    errdefer allocator.free(logic.refs);
    const map = try parseStream(allocator, map_lump.data);
    errdefer allocator.free(map.refs);
    const skins = try parseStream(allocator, skins_lump.data);
    errdefer allocator.free(skins.refs);
    const manifest = try parseManifest(allocator, manifest_lump.data);
    errdefer allocator.free(manifest);

    var blob_list: std.ArrayList(Blob) = .empty;
    errdefer blob_list.deinit(allocator);
    for (lumps) |lump| {
        if (lump.type_id != LumpId.asset_blob) continue;
        if (lump.data.len < HASH_BYTES) return Error.BadBlob;
        var claimed: [HASH_BYTES]u8 = undefined;
        @memcpy(claimed[0..], lump.data[0..HASH_BYTES]);
        try blob_list.append(allocator, .{ .claimed_hash = claimed, .payload = lump.data[HASH_BYTES..] });
    }
    const blobs = try blob_list.toOwnedSlice(allocator);

    return .{ .logic = logic, .map = map, .skins = skins, .manifest = manifest, .blobs = blobs };
}

fn sha256(payload: []const u8) [HASH_BYTES]u8 {
    var out: [HASH_BYTES]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(payload, &out, .{});
    return out;
}

/// Atomic content-store install: write to a temp file, fsync, rename into place
/// keyed by hex(hash). The hash IS the corruption check (already verified by
/// the caller); the rename makes the install all-or-nothing.
fn atomicInstall(io: std.Io, dir: std.Io.Dir, hash: [HASH_BYTES]u8, bytes: []const u8) Error!void {
    const hex = std.fmt.bytesToHex(hash, .lower);
    var tmp_buf: [HASH_BYTES * 2 + 8]u8 = undefined;
    const tmp = std.fmt.bufPrint(&tmp_buf, ".tmp.{s}", .{hex}) catch return Error.InstallFailed;
    var file = dir.createFile(io, tmp, .{ .truncate = true }) catch return Error.InstallFailed;
    file.writeStreamingAll(io, bytes) catch {
        file.close(io);
        dir.deleteFile(io, tmp) catch {};
        return Error.InstallFailed;
    };
    file.sync(io) catch {
        file.close(io);
        dir.deleteFile(io, tmp) catch {};
        return Error.InstallFailed;
    };
    file.close(io);
    std.Io.Dir.rename(dir, tmp, dir, hex[0..], io) catch {
        dir.deleteFile(io, tmp) catch {};
        return Error.InstallFailed;
    };
}

fn containsHash(haystack: []const [HASH_BYTES]u8, needle: [HASH_BYTES]u8) bool {
    for (haystack) |entry| {
        if (std.mem.eql(u8, &entry, &needle)) return true;
    }
    return false;
}

fn installedAssetMatches(io: std.Io, allocator: std.mem.Allocator, dir: std.Io.Dir, entry: ManifestEntry) Error!bool {
    const hex = std.fmt.bytesToHex(entry.hash, .lower);
    const bytes = dir.readFileAlloc(io, hex[0..], allocator, .limited(@as(usize, entry.length) + 1)) catch return false;
    defer allocator.free(bytes);
    if (bytes.len != entry.length) return false;
    const actual = sha256(bytes);
    return std.mem.eql(u8, &actual, &entry.hash);
}

fn validateRefs(stream: Stream, manifest: []const ManifestEntry) Error!void {
    for (stream.refs) |key| {
        var found = false;
        for (manifest) |entry| {
            if (entry.key == key) {
                found = true;
                break;
            }
        }
        if (!found) return Error.MissingReference;
    }
}
