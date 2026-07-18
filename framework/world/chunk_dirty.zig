//! V31 dirty-region + subsystem-halo declaration API.
//!
//! Implements the doc's "Dirty Rules": every editor mutation must produce a
//! dirty region (the set of chunks whose compiled output may change) AND its
//! declared subsystem halos (nav/VIS/audio/physics/water/traffic). The doc rule
//! is load-bearing: "Subsystem halos must be declared in DATA, not hidden in
//! code. An edit that cannot state its dirty region is an incomplete editor
//! mutation." So an `Edit` here is a value that carries its bounds + halo
//! declarations; this module turns that value into the concrete chunk set with
//! per-chunk concern bits. No subsystem reach is implied by code branches — it
//! is read off the edit's `halos` slice.
//!
//! Chunk addressing is repurposed from cart/hmsc-int/chunks.ts: a chunk is a
//! CHUNK_TILES×CHUNK_TILES tile block; `ChunkCoord{cx,cz}` is reused from
//! compile_cache.zig. Edits are expressed in tile space (the editor paints
//! tiles); `boundsMetersToTileRect` bridges from the manifest's meter bounds.
//!
//! DEPTH (this pass): dirty compute + halo declaration as data. Resolving object
//! refs / asset-reference reverse-lookups to chunks is the hot authoring-state
//! index (workstream E); for asset/global edits this module takes an explicit
//! chunk list (`addChunk`) rather than scanning. Whole-map bake stays the
//! fallback path that consumes "everything dirty".
//!
//! INTEGRATION (build.zig): expose as module "world_chunk_dirty" rooted at this
//! file; imports "world_compile_cache" for ChunkCoord. See the test file's
//! INTEGRATION block for the exact lines.

const std = @import("std");
const cache = @import("world_compile_cache");

pub const ChunkCoord = cache.ChunkCoord;

/// Tiles per chunk side — matches CHUNK_TILES in cart/hmsc-int/chunks.ts.
pub const CHUNK_TILES: i32 = 120;

/// Inclusive tile-space rectangle an edit touched. min must be <= max per axis.
pub const TileRect = struct {
    min_tx: i32,
    min_tz: i32,
    max_tx: i32,
    max_tz: i32,

    pub fn single(tx: i32, tz: i32) TileRect {
        return .{ .min_tx = tx, .min_tz = tz, .max_tx = tx, .max_tz = tz };
    }
};

/// The subsystems whose continuity can cross a chunk boundary (doc halo list).
pub const Subsystem = enum {
    nav, // portals, ramps, lanes, crosswalks, link costs
    vis, // blockers + potential visibility cells
    audio, // occluders + propagation portals
    physics, // colliders touching chunk edges
    water, // water/void/seam terrain continuity
    traffic, // junctions + controlled stop lines
};

/// A declared halo: how many chunk rings a subsystem's effect spreads beyond the
/// touched chunks. This is the DATA the doc demands — the editor command states
/// its reach; nothing here infers it.
pub const HaloDecl = struct {
    subsystem: Subsystem,
    radius_chunks: u8,
};

/// What an editor mutation declares about its footprint. `kind` is descriptive
/// (it selects no hidden behavior); the dirty set is computed from `bounds` +
/// `halos` geometrically. The edge-neighbor expansion is automatic whenever the
/// bounds touch a chunk boundary tile, because that genuinely changes the shared
/// edge signature (doc: "neighbors whose edge signatures may change").
pub const EditKind = enum {
    paint, // tile/height/zone/flora paint
    border, // an edit known to ride a boundary (hint only)
    object, // a placed object: dirties chunks its bounds intersect
    footprint, // road/building/prefab: bounds + declared halos
    asset, // material/model/asset change: caller supplies referencing chunks
    global_abi, // tuning/compiler ABI: caller supplies the full chunk set
};

pub const Edit = struct {
    kind: EditKind,
    bounds: TileRect,
    halos: []const HaloDecl = &.{},
};

/// Why a chunk is in the dirty set. Bits OR together. `source` = this chunk's own
/// cells changed (rebuild). `edge` = a neighbor's boundary changed this chunk's
/// shared edge (rebuild). The subsystem bits record which declared halo reached
/// the chunk — DATA the recompiler reads to know what to recompute, kept distinct
/// so a halo-only touch is visible as such.
pub const Concern = enum(u4) {
    source = 0,
    edge = 1,
    nav = 2,
    vis = 3,
    audio = 4,
    physics = 5,
    water = 6,
    traffic = 7,
};

pub const ConcernSet = u16;

pub fn bit(concern: Concern) ConcernSet {
    return @as(ConcernSet, 1) << @intFromEnum(concern);
}

fn subsystemConcern(subsystem: Subsystem) Concern {
    return switch (subsystem) {
        .nav => .nav,
        .vis => .vis,
        .audio => .audio,
        .physics => .physics,
        .water => .water,
        .traffic => .traffic,
    };
}

/// One entry in a computed dirty region: a chunk plus the OR of every concern
/// that marked it.
pub const ChunkDirty = struct {
    coord: ChunkCoord,
    concerns: ConcernSet,

    pub fn has(self: ChunkDirty, concern: Concern) bool {
        return (self.concerns & bit(concern)) != 0;
    }

    /// True if this chunk must be recompiled (its own cells or a shared edge
    /// changed), as opposed to only being in a subsystem halo.
    pub fn mustRebuild(self: ChunkDirty) bool {
        return (self.concerns & (bit(.source) | bit(.edge))) != 0;
    }
};

/// The chunk address space is mapped to a u64 key for the dedup hashmap.
fn packCoord(coord: ChunkCoord) u64 {
    const cx: u64 = @as(u32, @bitCast(coord.cx));
    const cz: u64 = @as(u32, @bitCast(coord.cz));
    return (cx << 32) | cz;
}

fn unpackCoord(key: u64) ChunkCoord {
    return .{
        .cx = @bitCast(@as(u32, @truncate(key >> 32))),
        .cz = @bitCast(@as(u32, @truncate(key))),
    };
}

/// Tile coordinate → owning chunk. Floored division so negative tiles map left.
pub fn chunkOfTile(tx: i32, tz: i32) ChunkCoord {
    return .{ .cx = @divFloor(tx, CHUNK_TILES), .cz = @divFloor(tz, CHUNK_TILES) };
}

/// First tile index owned by a chunk column/row.
pub fn chunkMinTile(c: i32) i32 {
    return c * CHUNK_TILES;
}

/// Last (inclusive) tile index owned by a chunk column/row.
pub fn chunkMaxTile(c: i32) i32 {
    return c * CHUNK_TILES + (CHUNK_TILES - 1);
}

/// Bridge from the manifest's meter bounds to a tile rect, given tile size in
/// meters. Inclusive on both ends (the max meter sample's tile is touched).
pub fn boundsMetersToTileRect(b: cache.BoundsMeters, tile_meters: f32) TileRect {
    return .{
        .min_tx = @floor(b.min_x / tile_meters),
        .min_tz = @floor(b.min_z / tile_meters),
        .max_tx = @floor(b.max_x / tile_meters),
        .max_tz = @floor(b.max_z / tile_meters),
    };
}

/// The computed dirty region: a sorted, deduped list of chunks with concern bits.
/// Owns its slice; free with `deinit`.
pub const DirtyRegion = struct {
    items: []ChunkDirty,

    pub fn deinit(self: DirtyRegion, allocator: std.mem.Allocator) void {
        allocator.free(self.items);
    }

    pub fn count(self: DirtyRegion) usize {
        return self.items.len;
    }

    pub fn find(self: DirtyRegion, coord: ChunkCoord) ?ChunkDirty {
        for (self.items) |item| {
            if (item.coord.eql(coord)) return item;
        }
        return null;
    }

    pub fn contains(self: DirtyRegion, coord: ChunkCoord) bool {
        return self.find(coord) != null;
    }
};

/// Accumulates dirty chunks across one or more edits, OR-ing concern bits per
/// chunk, then emits a sorted `DirtyRegion`. Use this to batch a multi-edit
/// command (e.g. a brush stroke) into one region before recompiling.
pub const DirtyBuilder = struct {
    allocator: std.mem.Allocator,
    map: std.AutoHashMapUnmanaged(u64, ConcernSet) = .{},

    pub fn init(allocator: std.mem.Allocator) DirtyBuilder {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *DirtyBuilder) void {
        self.map.deinit(self.allocator);
    }

    /// OR `concerns` into a chunk's entry, creating it if absent.
    pub fn addChunk(self: *DirtyBuilder, coord: ChunkCoord, concerns: ConcernSet) error{OutOfMemory}!void {
        const key = packCoord(coord);
        const gop = try self.map.getOrPut(self.allocator, key);
        if (!gop.found_existing) gop.value_ptr.* = 0;
        gop.value_ptr.* |= concerns;
    }

    /// Mark every chunk in an inclusive chunk-rect with `concerns`.
    fn addChunkRect(
        self: *DirtyBuilder,
        min_cx: i32,
        min_cz: i32,
        max_cx: i32,
        max_cz: i32,
        concerns: ConcernSet,
    ) error{OutOfMemory}!void {
        var cz = min_cz;
        while (cz <= max_cz) : (cz += 1) {
            var cx = min_cx;
            while (cx <= max_cx) : (cx += 1) {
                try self.addChunk(.{ .cx = cx, .cz = cz }, concerns);
            }
        }
    }

    /// Fold one declared edit into the region: base chunks (source), edge
    /// neighbors whose shared boundary the edit touches (edge), and each declared
    /// subsystem halo expanded by its ring radius (subsystem concern).
    pub fn addEdit(self: *DirtyBuilder, edit: Edit) error{OutOfMemory}!void {
        const b = edit.bounds;
        const min_chunk = chunkOfTile(b.min_tx, b.min_tz);
        const max_chunk = chunkOfTile(b.max_tx, b.max_tz);

        // Base: every chunk the bounds intersect rebuilds from its own cells.
        try self.addChunkRect(min_chunk.cx, min_chunk.cz, max_chunk.cx, max_chunk.cz, bit(.source));

        // Edge neighbors: when the bounds reach a chunk's boundary tile, the
        // shared edge signature changes, so the neighbor across that edge rebuilds.
        try self.addEdgeNeighbors(b, min_chunk, max_chunk);

        // Declared halos: pure data — expand the base chunk rect by each halo's
        // ring radius and tag the reached chunks with the subsystem concern.
        for (edit.halos) |halo| {
            const r: i32 = halo.radius_chunks;
            if (r == 0) continue;
            try self.addChunkRect(
                min_chunk.cx - r,
                min_chunk.cz - r,
                max_chunk.cx + r,
                max_chunk.cz + r,
                bit(subsystemConcern(halo.subsystem)),
            );
        }
    }

    fn addEdgeNeighbors(
        self: *DirtyBuilder,
        b: TileRect,
        min_chunk: ChunkCoord,
        max_chunk: ChunkCoord,
    ) error{OutOfMemory}!void {
        const edge_bit = bit(.edge);
        // West/east boundaries of the spanned chunk columns.
        if (b.min_tx == chunkMinTile(min_chunk.cx)) {
            try self.addChunkRect(min_chunk.cx - 1, min_chunk.cz, min_chunk.cx - 1, max_chunk.cz, edge_bit);
        }
        if (b.max_tx == chunkMaxTile(max_chunk.cx)) {
            try self.addChunkRect(max_chunk.cx + 1, min_chunk.cz, max_chunk.cx + 1, max_chunk.cz, edge_bit);
        }
        // North/south boundaries of the spanned chunk rows.
        if (b.min_tz == chunkMinTile(min_chunk.cz)) {
            try self.addChunkRect(min_chunk.cx, min_chunk.cz - 1, max_chunk.cx, min_chunk.cz - 1, edge_bit);
        }
        if (b.max_tz == chunkMaxTile(max_chunk.cz)) {
            try self.addChunkRect(min_chunk.cx, max_chunk.cz + 1, max_chunk.cx, max_chunk.cz + 1, edge_bit);
        }
    }

    /// Emit the accumulated region as a sorted (cz major, cx minor) slice.
    pub fn build(self: *DirtyBuilder) error{OutOfMemory}!DirtyRegion {
        const items = try self.allocator.alloc(ChunkDirty, self.map.count());
        var i: usize = 0;
        var it = self.map.iterator();
        while (it.next()) |entry| {
            items[i] = .{ .coord = unpackCoord(entry.key_ptr.*), .concerns = entry.value_ptr.* };
            i += 1;
        }
        std.mem.sort(ChunkDirty, items, {}, lessThan);
        return .{ .items = items };
    }

    fn lessThan(_: void, a: ChunkDirty, b: ChunkDirty) bool {
        if (a.coord.cz != b.coord.cz) return a.coord.cz < b.coord.cz;
        return a.coord.cx < b.coord.cx;
    }
};

/// Convenience: the dirty region for a single declared edit.
pub fn computeDirty(allocator: std.mem.Allocator, edit: Edit) error{OutOfMemory}!DirtyRegion {
    var builder = DirtyBuilder.init(allocator);
    defer builder.deinit();
    try builder.addEdit(edit);
    return builder.build();
}
