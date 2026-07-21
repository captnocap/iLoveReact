// game/map/chunks — the map painter's chunked world grid, ported from the
// TypeScript at cart/hmsc-int/{chunks,tileData,heightData,floraData,zoneData}.ts
// into host-owned Zig (USER ASK req_2473).
//
// Why: the 2D tile map painter's entire mutation engine (~4.6k lines) ran in JS —
// per-dab typed-array stamps in the React cart. Per the doctrine (React is UI
// authoring; tools are host-owned — the same ruling that ported game/build), the
// authoring engine belongs here. The render/physics/pathing CONSUMERS of this
// data are already native; this module gives them a native AUTHOR.
//
// PORT DISCIPLINE: data-model behavior mirrors the TS (chunk size, sample grid,
// height clamp, channel shapes) so the painted output is identical. The world is
// a SPARSE grid of 120×120-tile chunks; chunk (cx,cz) is CENTERED at world
// (cx·120, cz·120) meters (PaintCanvas.tsx:881 convention), so neighbouring
// chunks SHARE their border sample column/row — the seam-free invariant.
//
// One deliberate deviation from the TS: nothing here clips cell painting to the
// cursor's chunk (PaintCanvas stampTileAtGraph clipped tile/flora/zone footprints
// at chunk borders — a seam bug, not a behavior). The engine paints all channels
// in the GLOBAL frame; see engine.zig.

const std = @import("std");

// ── shared layout (1 tile = 1 m, R4 scale contract) ──────────────────────────
// Verbatim from chunks.ts / heightData.ts.

pub const CHUNK_TILES: i32 = 120; // tiles per chunk side (chunks.ts:22)
pub const DOTS_PER_TILE: i32 = 2; // height samples per tile per axis (heightData.ts:17)
pub const DOT_M: f32 = 0.5; // meters between height samples (heightData.ts:18)
pub const CHUNK_METERS: f32 = @floatFromInt(CHUNK_TILES);

/// |Z| clamp (meters) — the single knob for terrain height range (heightData.ts:25).
pub const HEIGHT_LIMIT: f32 = 64;

/// World extent in CHUNK units. Columns preserve the complete legacy a-zzz
/// address window; rows include the 25×25 generated-city working square while
/// remaining backward-compatible with every previously valid chunk coordinate.
pub const MAX_CHUNK_COL: i32 = 152;
pub const MAX_CHUNK_ROW: i32 = 24;

pub const TILE_COLS: usize = @intCast(CHUNK_TILES); // per-chunk cells per axis
pub const TILE_CELLS: usize = TILE_COLS * TILE_COLS; // 14_400
pub const SAMPLE_COLS: usize = @intCast(CHUNK_TILES * DOTS_PER_TILE + 1); // 241
pub const SAMPLE_CELLS: usize = SAMPLE_COLS * SAMPLE_COLS; // 58_081

/// Flora population lanes (floraData.ts FLORA_LAYERS): grass, tree, bush.
/// Lanes are structural (a cell can host all three); flora KINDS are content and
/// stay cart-side — the engine stores opaque kind indices per lane.
pub const FLORA_LAYER_COUNT: usize = 3;

pub const EMPTY_CELL: i16 = -1;
pub const FLORA_DENSITY_FULL: u8 = std.math.maxInt(u8);

// ── the chunk ─────────────────────────────────────────────────────────────────

/// Per-channel dirty flags, set by stamps and drained by the render feed.
pub const ChannelDirty = struct {
    tiles: bool = false,
    height: bool = false,
    water: bool = false,
    flora: bool = false,
    zones: bool = false,

    pub fn any(self: ChannelDirty) bool {
        return self.tiles or self.height or self.water or self.flora or self.zones;
    }
};

pub const Chunk = struct {
    cx: i32,
    cz: i32,
    /// ground tile-kind index per 1m cell, EMPTY_CELL = unpainted (tileData.ts:19)
    tiles: [TILE_CELLS]i16,
    /// per-cell MATERIAL binding index (engine.zig tile-binding table),
    /// EMPTY_CELL = the kind's default look. This is what lets two sidewalk
    /// tiles wear different materials (req_2693).
    materials: [TILE_CELLS]i16,
    /// zone list index per cell, EMPTY_CELL = unzoned (zoneData.ts:20)
    zones: [TILE_CELLS]i16,
    /// flora kind index per cell per lane (grass/tree/bush), EMPTY_CELL = none
    flora: [FLORA_LAYER_COUNT][TILE_CELLS]i16,
    /// stroke-authored population strength per flora cell (0 empty, 255 full).
    flora_density: [FLORA_LAYER_COUNT][TILE_CELLS]u8,
    /// terrain heights (meters) on the (2/tile + 1)² sample grid (heightData.ts:31)
    height: [SAMPLE_CELLS]f32,
    /// painted water DEPTH on the same sample grid; > 0 = wet (chunks.ts:37)
    water: [SAMPLE_CELLS]f32,
    dirty: ChannelDirty,

    pub fn reset(self: *Chunk, cx: i32, cz: i32) void {
        self.cx = cx;
        self.cz = cz;
        @memset(self.tiles[0..], EMPTY_CELL);
        @memset(self.materials[0..], EMPTY_CELL);
        @memset(self.zones[0..], EMPTY_CELL);
        for (self.flora[0..]) |*lane| @memset(lane[0..], EMPTY_CELL);
        for (self.flora_density[0..]) |*lane| @memset(lane[0..], 0);
        @memset(self.height[0..], 0);
        @memset(self.water[0..], 0);
        self.dirty = .{};
    }

    /// World-meter X of the chunk's minimum (left) edge. The chunk is CENTERED
    /// at (cx·120, cz·120), so the edge sits half a chunk below the center.
    pub fn minX(self: *const Chunk) f32 {
        return @as(f32, @floatFromInt(self.cx)) * CHUNK_METERS - CHUNK_METERS / 2;
    }
    pub fn minZ(self: *const Chunk) f32 {
        return @as(f32, @floatFromInt(self.cz)) * CHUNK_METERS - CHUNK_METERS / 2;
    }
};

// ── the sparse registry ───────────────────────────────────────────────────────
// Slots cover the whole address window; chunks allocate on grow (the TS grew a
// Map on demand — same shape, page_allocator-backed so a fresh cart pays nothing).

pub const SLOT_COLS: usize = @intCast(MAX_CHUNK_COL + 1);
pub const SLOT_ROWS: usize = @intCast(MAX_CHUNK_ROW + 1);
pub const SLOT_COUNT: usize = SLOT_COLS * SLOT_ROWS; // 3_825

var g_slots: [SLOT_COUNT]?*Chunk = @splat(null);
var g_count: usize = 0;

const chunk_alloc = std.heap.page_allocator;

/// A slot is addressable iff it is inside the preserved column address window
/// and the generated-city row window.
pub fn inBounds(cx: i32, cz: i32) bool {
    return cx >= 0 and cz >= 0 and cx <= MAX_CHUNK_COL and cz <= MAX_CHUNK_ROW;
}

fn slotIndex(cx: i32, cz: i32) usize {
    return @as(usize, @intCast(cz)) * SLOT_COLS + @as(usize, @intCast(cx));
}

pub fn chunkAt(cx: i32, cz: i32) ?*Chunk {
    if (!inBounds(cx, cz)) return null;
    return g_slots[slotIndex(cx, cz)];
}

/// Allocate (or return) the chunk at (cx,cz). Null when out of bounds or OOM.
pub fn growChunk(cx: i32, cz: i32) ?*Chunk {
    if (!inBounds(cx, cz)) return null;
    const slot = slotIndex(cx, cz);
    if (g_slots[slot]) |existing| return existing;
    const chunk = chunk_alloc.create(Chunk) catch return null;
    chunk.reset(cx, cz);
    g_slots[slot] = chunk;
    g_count += 1;
    return chunk;
}

/// Drop every chunk (world reset / new map).
pub fn clearAll() void {
    for (g_slots[0..], 0..) |maybe, i| {
        if (maybe) |chunk| {
            chunk_alloc.destroy(chunk);
            g_slots[i] = null;
        }
    }
    g_count = 0;
}

pub fn chunkCount() usize {
    return g_count;
}

/// Bytes mapped by the page allocator for the canonical chunk payloads.
/// `Chunk` is larger than a page, and page_allocator maps each growChunk()
/// allocation independently, so page-rounding each object matches the owned
/// mapping rather than reporting only the smaller struct payload.
pub fn allocatedBytes() u64 {
    const mapped_per_chunk = std.mem.alignForward(usize, @sizeOf(Chunk), std.heap.pageSize());
    return @as(u64, @intCast(g_count)) * @as(u64, @intCast(mapped_per_chunk));
}

/// The raw slot table for allocated-chunk iteration (the TS focusedChunks loop):
/// `for (chunks.slots()) |maybe| { const ch = maybe orelse continue; … }`.
pub fn slots() []const ?*Chunk {
    return g_slots[0..];
}

/// The in-bounds, unoccupied neighbour slots of (cx,cz) — every side the editor
/// may grow into (chunks.ts openNeighbors). Returns the count written into out.
pub fn openNeighbors(cx: i32, cz: i32, out: *[4][2]i32) usize {
    const sides = [_][2]i32{ .{ -1, 0 }, .{ 1, 0 }, .{ 0, -1 }, .{ 0, 1 } };
    var n: usize = 0;
    for (sides) |side| {
        const nx = cx + side[0];
        const nz = cz + side[1];
        if (inBounds(nx, nz) and chunkAt(nx, nz) == null) {
            out[n] = .{ nx, nz };
            n += 1;
        }
    }
    return n;
}

// ── world-meter ↔ grid coordinate mapping ─────────────────────────────────────
// The GLOBAL frames share one origin: chunk (0,0)'s min corner at (-60,-60) m.
// Global tile gt = floor(x + 60); chunk cx = floor(gt / 120); local = gt − cx·120.
// Global sample gs = round((x + 60) / DOT_M); chunk cx covers [cx·240, cx·240+240]
// (the shared-border duplication that keeps strokes seam-free, PaintCanvas:861).

pub fn globalTile(x: f32) i32 {
    return @floor(x + CHUNK_METERS / 2);
}

pub fn globalSample(x: f32) i32 {
    return @round((x + CHUNK_METERS / 2) / DOT_M);
}

pub fn chunkOfGlobalTile(gt: i32) i32 {
    return @divFloor(gt, CHUNK_TILES);
}

/// Local sample index of a global brush center inside THIS chunk (fractional).
/// Verbatim mapping from PaintCanvas.tsx:881: (x − cx·PATCH + PATCH/2)/PATCH·(cols−1).
pub fn localSampleF(chunk: *const Chunk, x: f32, z: f32) [2]f32 {
    const lx = (x - @as(f32, @floatFromInt(chunk.cx)) * CHUNK_METERS + CHUNK_METERS / 2) / DOT_M;
    const lz = (z - @as(f32, @floatFromInt(chunk.cz)) * CHUNK_METERS + CHUNK_METERS / 2) / DOT_M;
    return .{ lx, lz };
}

// ── cell ops (tileData.ts paintTile / zoneData.ts paintZoneCell shapes) ───────

pub fn cellIndex(lx: i32, lz: i32) ?usize {
    if (lx < 0 or lz < 0 or lx >= CHUNK_TILES or lz >= CHUNK_TILES) return null;
    return @as(usize, @intCast(lz)) * TILE_COLS + @as(usize, @intCast(lx));
}

/// Removing a zone at list index r: unzone its cells and shift higher indices
/// down so the map stays aligned with the shorter zone list (zoneData.ts:43).
pub fn dropZoneIndex(r: i16) void {
    for (g_slots[0..]) |maybe| {
        const chunk = maybe orelse continue;
        var changed = false;
        for (chunk.zones[0..]) |*v| {
            if (v.* == r) {
                v.* = EMPTY_CELL;
                changed = true;
            } else if (v.* > r) {
                v.* -= 1;
                changed = true;
            }
        }
        if (changed) chunk.dirty.zones = true;
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

test "grow, bounds, and neighbor openings" {
    clearAll();
    defer clearAll();

    try std.testing.expect(growChunk(0, 0) != null);
    try std.testing.expectEqual(@as(usize, 1), chunkCount());
    // regrow is idempotent
    try std.testing.expectEqual(chunkAt(0, 0).?, growChunk(0, 0).?);
    try std.testing.expectEqual(@as(usize, 1), chunkCount());
    // out-of-window slots refuse (seed corner: left/top are out of bounds)
    try std.testing.expect(growChunk(-1, 0) == null);
    try std.testing.expect(growChunk(0, -1) == null);
    try std.testing.expect(growChunk(MAX_CHUNK_COL + 1, 0) == null);
    try std.testing.expect(growChunk(0, MAX_CHUNK_ROW) != null);
    try std.testing.expect(growChunk(0, MAX_CHUNK_ROW + 1) == null);

    var open: [4][2]i32 = undefined;
    // the seed opens only right + bottom (chunks.ts header)
    try std.testing.expectEqual(@as(usize, 2), openNeighbors(0, 0, &open));
    _ = growChunk(1, 0);
    try std.testing.expectEqual(@as(usize, 1), openNeighbors(0, 0, &open));
    try std.testing.expectEqual(@as(i32, 0), open[0][0]);
    try std.testing.expectEqual(@as(i32, 1), open[0][1]);
}

test "chunk buffers initialize to the empty painting" {
    clearAll();
    defer clearAll();
    const chunk = growChunk(2, 1).?;
    try std.testing.expectEqual(EMPTY_CELL, chunk.tiles[0]);
    try std.testing.expectEqual(EMPTY_CELL, chunk.zones[TILE_CELLS - 1]);
    try std.testing.expectEqual(EMPTY_CELL, chunk.flora[2][7]);
    try std.testing.expectEqual(@as(u8, 0), chunk.flora_density[2][7]);
    try std.testing.expectEqual(@as(f32, 0), chunk.height[SAMPLE_CELLS - 1]);
    try std.testing.expectEqual(@as(f32, 0), chunk.water[0]);
    try std.testing.expect(!chunk.dirty.any());
}

test "world-meter mapping: chunks are centered, borders shared" {
    clearAll();
    defer clearAll();
    const c0 = growChunk(0, 0).?;
    const c1 = growChunk(1, 0).?;

    // chunk 0 spans [-60, 60): x = -60 is its tile 0; x = 59.9 its tile 119
    try std.testing.expectEqual(@as(i32, 0), globalTile(-60.0));
    try std.testing.expectEqual(@as(i32, 119), globalTile(59.9));
    try std.testing.expectEqual(@as(i32, 120), globalTile(60.0)); // chunk 1's first tile
    try std.testing.expectEqual(@as(i32, 0), chunkOfGlobalTile(119));
    try std.testing.expectEqual(@as(i32, 1), chunkOfGlobalTile(120));

    // the shared border x = 60: sample 240 of chunk 0 AND sample 0 of chunk 1
    const l0 = localSampleF(c0, 60.0, 0.0);
    const l1 = localSampleF(c1, 60.0, 0.0);
    try std.testing.expectApproxEqAbs(@as(f32, 240), l0[0], 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 0), l1[0], 0.0001);
}

test "dropZoneIndex unzones and shifts" {
    clearAll();
    defer clearAll();
    const chunk = growChunk(0, 0).?;
    chunk.zones[0] = 0;
    chunk.zones[1] = 1;
    chunk.zones[2] = 2;
    dropZoneIndex(1);
    try std.testing.expectEqual(@as(i16, 0), chunk.zones[0]);
    try std.testing.expectEqual(EMPTY_CELL, chunk.zones[1]);
    try std.testing.expectEqual(@as(i16, 1), chunk.zones[2]);
    try std.testing.expect(chunk.dirty.zones);
}
