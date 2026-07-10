// game/map/store — the map painter's persistence: row-RLE serialization of
// every channel + the road stroke RECIPES, ported from the shape of
// cart/hmsc-int/mapStore.ts (USER ASK req_2473; V29 alignment: editor RLE is
// the source format, Compile transcodes to the binary mapfile lumps).
//
// Roads persist as RECIPES, never derived tiles (ROADSTROKE-0610 / req_0795:
// the grid is a pure base+roads function): save() writes the UNDERCOATED base
// grid — road-stamped cells resolve back to the paint beneath — plus the
// strokes; load() rebuilds the base and lets the caller restamp.
//
// Heights/water quantize to i16 hundredths of a meter (mapStore.ts HEIGHT_Q)
// then row-RLE as (count u16, value i16) pairs. Cell channels RLE the raw i16.
// Legends (tile-kind names, flora kinds, zone defs) are CART content and
// persist cart-side; this blob stores indices only.

const std = @import("std");
const chunks = @import("chunks.zig");
const roads = @import("roads.zig");

pub const MAGIC: u32 = 0x50414d52; // "RMAP"
/// v2 (req_2693): + the tile-binding table (count u32, count×4 f32 rows right
/// after the header) and a per-chunk MATERIALS cell channel (RLE, after tiles).
/// v1 blobs still load: no bindings, materials all EMPTY (kind-default look).
pub const VERSION: u32 = 2;

/// Floats per tile-binding row (engine.zig BINDING_FLOATS — kept in sync by
/// the loadMap/saveMap call sites passing engine-owned buffers).
const BINDING_FLOATS: usize = 4;
/// The editor's tile-binding legend is bounded by the map engine palette. Keep
/// this public so a file-header reader can size one fixed, tiny prefix buffer
/// without reading a potentially large painting just to count its chunks.
pub const MAX_BINDINGS: usize = 256;
pub const INSPECT_PREFIX_BYTES: usize = 16 + MAX_BINDINGS * BINDING_FLOATS * @sizeOf(f32);

const HEIGHT_Q: f32 = 100; // meters → hundredths

// ── the writer ────────────────────────────────────────────────────────────────

const Sink = struct {
    buf: []u8,
    n: usize = 0,
    overflow: bool = false,

    fn put(self: *Sink, comptime T: type, v: T) void {
        const bytes = std.mem.asBytes(&v);
        if (self.n + bytes.len > self.buf.len) {
            self.overflow = true;
            return;
        }
        @memcpy(self.buf[self.n .. self.n + bytes.len], bytes);
        self.n += bytes.len;
    }
};

fn rleWriteCells(sink: *Sink, cells: []const i16) void {
    // runs: (count u16, value i16); a chunk side is 120/241 so u16 always fits a row —
    // we run across the WHOLE buffer (rows are contiguous), capping runs at 65535.
    var i: usize = 0;
    var run_count: u32 = 0;
    const count_at = sink.n;
    sink.put(u32, 0); // patched below
    while (i < cells.len) {
        const v = cells[i];
        var run: usize = 1;
        while (i + run < cells.len and cells[i + run] == v and run < 65535) run += 1;
        sink.put(u16, @intCast(run));
        sink.put(i16, v);
        run_count += 1;
        i += run;
    }
    if (!sink.overflow) std.mem.writeInt(u32, sink.buf[count_at..][0..4], run_count, .little);
}

fn quantize(z: f32) i16 {
    const q = @round(z * HEIGHT_Q);
    return @intFromFloat(@max(-32768, @min(32767, q)));
}

fn rleWriteQuantized(sink: *Sink, samples: []const f32, scratch: []i16) void {
    for (samples, 0..) |z, i| scratch[i] = quantize(z);
    rleWriteCells(sink, scratch[0..samples.len]);
}

// ── the reader ────────────────────────────────────────────────────────────────

const Source = struct {
    buf: []const u8,
    n: usize = 0,
    bad: bool = false,

    fn get(self: *Source, comptime T: type) T {
        const size = @sizeOf(T);
        if (self.n + size > self.buf.len) {
            self.bad = true;
            return 0;
        }
        const v = std.mem.readInt(
            std.meta.Int(.unsigned, size * 8),
            self.buf[self.n..][0..size],
            .little,
        );
        self.n += size;
        return @bitCast(v);
    }
};

/// Non-mutating facts available in the fixed RMAP header. Workspace catalogs
/// use this instead of `load`: inspecting an inactive map must never replace
/// the live authoring world.
pub const HeaderSummary = struct {
    version: u32,
    chunk_count: u32,
};

/// Inspect only the fixed-size prefix of an RMAP. v2's variable binding rows
/// are still header material and are capped at MAX_BINDINGS, so callers need
/// at most INSPECT_PREFIX_BYTES regardless of map size.
pub fn inspectHeader(bytes: []const u8) ?HeaderSummary {
    var src = Source{ .buf = bytes };
    if (src.get(u32) != MAGIC) return null;
    const version = src.get(u32);
    if (version < 1 or version > VERSION) return null;
    if (version >= 2) {
        const binding_count = src.get(u32);
        if (binding_count > MAX_BINDINGS) return null;
        const binding_bytes = @as(usize, binding_count) * BINDING_FLOATS * @sizeOf(f32);
        if (src.n + binding_bytes > bytes.len) return null;
        src.n += binding_bytes;
    }
    const chunk_count = src.get(u32);
    if (src.bad or chunk_count > chunks.SLOT_COUNT) return null;
    return .{ .version = version, .chunk_count = chunk_count };
}

fn rleReadCells(src: *Source, cells: []i16) void {
    const runs = src.get(u32);
    var i: usize = 0;
    var r: u32 = 0;
    while (r < runs) : (r += 1) {
        const run = src.get(u16);
        const v = src.get(i16);
        if (src.bad) return;
        var k: u16 = 0;
        while (k < run and i < cells.len) : (k += 1) {
            cells[i] = v;
            i += 1;
        }
    }
    if (i != cells.len) src.bad = true;
}

fn rleReadQuantized(src: *Source, samples: []f32, scratch: []i16) void {
    rleReadCells(src, scratch[0..samples.len]);
    if (src.bad) return;
    for (samples, 0..) |*z, i| z.* = @as(f32, @floatFromInt(scratch[i])) / HEIGHT_Q;
}

// ── the base-grid view (roads resolved back to the paint beneath) ─────────────

/// Fill `out` with one of the chunk's cell grids (tiles or materials),
/// substituting undercoat values on road-stamped cells — the persisted BASE
/// the load-time restamp rebuilds from. `which` picks the undercoat lane:
/// 0 = tile, 1 = material (the g_road_under value layout).
fn baseCells(chunk: *const chunks.Chunk, cells: []const i16, under: *const std.AutoHashMapUnmanaged(u64, [2]i16), which: usize, out: []i16) void {
    @memcpy(out, cells);
    var it = under.iterator();
    while (it.next()) |entry| {
        const gx: i32 = @bitCast(@as(u32, @truncate(entry.key_ptr.* >> 32)));
        const gz: i32 = @bitCast(@as(u32, @truncate(entry.key_ptr.*)));
        const cx = chunks.chunkOfGlobalTile(gx);
        const cz = chunks.chunkOfGlobalTile(gz);
        if (cx != chunk.cx or cz != chunk.cz) continue;
        if (chunks.cellIndex(gx - cx * chunks.CHUNK_TILES, gz - cz * chunks.CHUNK_TILES)) |idx| {
            out[idx] = entry.value_ptr.*[which];
        }
    }
}

// ── save / load ───────────────────────────────────────────────────────────────

var g_cell_scratch: [chunks.SAMPLE_CELLS]i16 = undefined;
var g_tile_scratch: [chunks.TILE_CELLS]i16 = undefined;

/// Worst-case byte budget for the current painting (every run length 1).
pub fn saveSizeUpperBound() usize {
    const per_cell_channel = 8 + chunks.TILE_CELLS * 4;
    const per_sample_channel = 8 + chunks.SAMPLE_CELLS * 4;
    const per_chunk = 8 + per_cell_channel * 6 + per_sample_channel * 2;
    const road_bytes = 16 + roads.MAX_STROKES * (24 + roads.MAX_POINTS_PER_STROKE * 8);
    const binding_bytes = 8 + 256 * BINDING_FLOATS * 4;
    return 16 + binding_bytes + chunks.chunkCount() * per_chunk + road_bytes;
}

/// Serialize the whole painting into dst. Returns bytes written, or 0 when dst
/// is too small (LOUD — callers size by saveSizeUpperBound()).
pub fn save(dst: []u8, under: *const std.AutoHashMapUnmanaged(u64, [2]i16), bindings: []const [BINDING_FLOATS]f32) usize {
    var sink = Sink{ .buf = dst };
    sink.put(u32, MAGIC);
    sink.put(u32, VERSION);
    sink.put(u32, @intCast(bindings.len));
    for (bindings) |row| {
        for (row) |v| sink.put(f32, v);
    }
    sink.put(u32, @intCast(chunks.chunkCount()));

    for (chunks.slots()) |maybe| {
        const chunk = maybe orelse continue;
        sink.put(i32, chunk.cx);
        sink.put(i32, chunk.cz);
        baseCells(chunk, chunk.tiles[0..], under, 0, g_tile_scratch[0..]);
        rleWriteCells(&sink, g_tile_scratch[0..]);
        baseCells(chunk, chunk.materials[0..], under, 1, g_tile_scratch[0..]);
        rleWriteCells(&sink, g_tile_scratch[0..]);
        rleWriteCells(&sink, chunk.zones[0..]);
        for (chunk.flora) |lane| rleWriteCells(&sink, lane[0..]);
        rleWriteQuantized(&sink, chunk.height[0..], g_cell_scratch[0..]);
        rleWriteQuantized(&sink, chunk.water[0..], g_cell_scratch[0..]);
    }

    var stroke_buf: [roads.MAX_STROKES]roads.RoadStroke = undefined;
    const stroke_count = roads.collectStrokes(stroke_buf[0..]);
    sink.put(u32, @intCast(stroke_count));
    for (stroke_buf[0..stroke_count]) |stroke| {
        sink.put(u32, stroke.id);
        sink.put(i32, stroke.profile.lanesF);
        sink.put(i32, stroke.profile.lanesB);
        sink.put(u8, if (stroke.profile.sidewalks) 1 else 0);
        sink.put(f32, stroke.profile.speedLimitKph);
        sink.put(u32, @intCast(stroke.points.len));
        for (stroke.points) |pt| {
            sink.put(f32, pt.gx);
            sink.put(f32, pt.gz);
        }
    }
    return if (sink.overflow) 0 else sink.n;
}

/// Rebuild the painting from a save() blob. Clears the world first; the CALLER
/// restamps roads after (engine.roadsRestamp) so the grid re-derives base+roads.
/// The loaded tile-binding table lands in `bindings_buf` (count via
/// `bindings_count`); v1 blobs have none. Returns false (world left cleared)
/// on a malformed blob.
pub fn load(bytes: []const u8, bindings_buf: [][BINDING_FLOATS]f32, bindings_count: *usize) bool {
    chunks.clearAll();
    roads.clearAll();
    bindings_count.* = 0;
    var src = Source{ .buf = bytes };
    if (src.get(u32) != MAGIC) return false;
    const version = src.get(u32);
    if (version < 1 or version > VERSION) return false;

    if (version >= 2) {
        const bind_count = src.get(u32);
        if (bind_count > bindings_buf.len) return false;
        var bi: u32 = 0;
        while (bi < bind_count) : (bi += 1) {
            for (&bindings_buf[bi]) |*v| v.* = src.get(f32);
        }
        if (src.bad) return false;
        bindings_count.* = bind_count;
    }

    const chunk_count = src.get(u32);
    if (chunk_count > chunks.SLOT_COUNT) return false;
    var ci: u32 = 0;
    while (ci < chunk_count) : (ci += 1) {
        const cx = src.get(i32);
        const cz = src.get(i32);
        const chunk = chunks.growChunk(cx, cz) orelse return false;
        rleReadCells(&src, chunk.tiles[0..]);
        if (version >= 2) rleReadCells(&src, chunk.materials[0..]);
        rleReadCells(&src, chunk.zones[0..]);
        for (&chunk.flora) |*lane| rleReadCells(&src, lane[0..]);
        rleReadQuantized(&src, chunk.height[0..], g_cell_scratch[0..]);
        rleReadQuantized(&src, chunk.water[0..], g_cell_scratch[0..]);
        if (src.bad) return false;
        chunk.dirty = .{ .tiles = true, .height = true, .water = true, .flora = true, .zones = true };
    }

    const stroke_count = src.get(u32);
    if (stroke_count > roads.MAX_STROKES) return false;
    var si: u32 = 0;
    while (si < stroke_count) : (si += 1) {
        const id = src.get(u32);
        _ = id; // ids re-mint sequentially; recipes carry no cross-references yet
        const profile = roads.RoadProfile{
            .lanesF = src.get(i32),
            .lanesB = src.get(i32),
            .sidewalks = src.get(u8) != 0,
            .speedLimitKph = src.get(f32),
        };
        const point_count = src.get(u32);
        if (point_count > roads.MAX_POINTS_PER_STROKE) return false;
        roads.beginDraft(profile);
        var pi: u32 = 0;
        while (pi < point_count) : (pi += 1) {
            const gx = src.get(f32);
            const gz = src.get(f32);
            roads.addDraftPoint(gx, gz);
        }
        if (src.bad) return false;
        _ = roads.commitDraft();
    }
    return !src.bad;
}

// ── tests ─────────────────────────────────────────────────────────────────────

test "save/load round-trips every channel and the road recipes" {
    chunks.clearAll();
    roads.clearAll();
    defer chunks.clearAll();
    defer roads.clearAll();

    const chunk = chunks.growChunk(1, 0).?;
    chunk.tiles[7] = 3;
    chunk.materials[7] = 1;
    chunk.zones[9] = 1;
    chunk.flora[1][11] = 5;
    chunk.height[100] = 4.25;
    chunk.water[100] = 4.25;

    roads.beginDraft(.{ .lanesF = 2, .lanesB = 0, .sidewalks = false });
    roads.addDraftPoint(10.5, 20.5);
    roads.addDraftPoint(40.5, 20.5);
    _ = roads.commitDraft().?;

    var empty_under: std.AutoHashMapUnmanaged(u64, [2]i16) = .empty;
    const bindings = [_][BINDING_FLOATS]f32{ .{ 41, 2, 1, 0 }, .{ 7, 0, 2, 1 } };
    const buf = std.testing.allocator.alloc(u8, saveSizeUpperBound()) catch unreachable;
    defer std.testing.allocator.free(buf);
    const n = save(buf, &empty_under, bindings[0..]);
    try std.testing.expect(n > 0);

    var bind_back: [8][BINDING_FLOATS]f32 = undefined;
    var bind_count: usize = 0;
    try std.testing.expect(load(buf[0..n], bind_back[0..], &bind_count));
    try std.testing.expectEqual(@as(usize, 2), bind_count);
    try std.testing.expectEqual(@as(f32, 41), bind_back[0][0]);
    try std.testing.expectEqual(@as(f32, 1), bind_back[1][3]);
    const back = chunks.chunkAt(1, 0).?;
    try std.testing.expectEqual(@as(i16, 3), back.tiles[7]);
    try std.testing.expectEqual(@as(i16, 1), back.materials[7]);
    try std.testing.expectEqual(@as(i16, chunks.EMPTY_CELL), back.materials[8]);
    try std.testing.expectEqual(@as(i16, 1), back.zones[9]);
    try std.testing.expectEqual(@as(i16, 5), back.flora[1][11]);
    try std.testing.expectApproxEqAbs(@as(f32, 4.25), back.height[100], 0.005);
    try std.testing.expectApproxEqAbs(@as(f32, 4.25), back.water[100], 0.005);
    try std.testing.expect(back.dirty.any());
    try std.testing.expectEqual(@as(usize, 1), roads.strokeCount());

    var stroke_buf: [roads.MAX_STROKES]roads.RoadStroke = undefined;
    _ = roads.collectStrokes(stroke_buf[0..]);
    try std.testing.expectEqual(@as(i32, 2), stroke_buf[0].profile.lanesF);
    try std.testing.expectEqual(@as(i32, 0), stroke_buf[0].profile.lanesB);
    try std.testing.expectEqual(@as(usize, 2), stroke_buf[0].points.len);
}

test "save resolves road-stamped cells back to the undercoat base" {
    chunks.clearAll();
    roads.clearAll();
    defer chunks.clearAll();
    defer roads.clearAll();

    const chunk = chunks.growChunk(0, 0).?;
    const idx = chunks.cellIndex(60, 60).?;
    chunk.tiles[idx] = 12; // as if a road stamped over paint 4
    var under: std.AutoHashMapUnmanaged(u64, [2]i16) = .empty;
    defer under.deinit(std.testing.allocator);
    // global cell of local (60,60) in chunk (0,0): 0*120+60
    under.put(std.testing.allocator, (@as(u64, 60) << 32) | 60, .{ 4, chunks.EMPTY_CELL }) catch unreachable;

    var buf: [1 << 20]u8 = undefined;
    const empty_bindings = [_][BINDING_FLOATS]f32{};
    const n = save(buf[0..], &under, empty_bindings[0..]);
    try std.testing.expect(n > 0);
    var bind_back: [8][BINDING_FLOATS]f32 = undefined;
    var bind_count: usize = 0;
    try std.testing.expect(load(buf[0..n], bind_back[0..], &bind_count));
    try std.testing.expectEqual(@as(i16, 4), chunks.chunkAt(0, 0).?.tiles[idx]);
}

test "load rejects garbage LOUDLY and leaves a clean world" {
    const junk = [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 };
    var bind_back: [8][BINDING_FLOATS]f32 = undefined;
    var bind_count: usize = 0;
    try std.testing.expect(!load(junk[0..], bind_back[0..], &bind_count));
    try std.testing.expectEqual(@as(usize, 0), chunks.chunkCount());
}

test "inspectHeader reads v1 and v2 chunk counts without loading the world" {
    var v1: [12]u8 = @splat(0);
    std.mem.writeInt(u32, v1[0..4], MAGIC, .little);
    std.mem.writeInt(u32, v1[4..8], 1, .little);
    std.mem.writeInt(u32, v1[8..12], 7, .little);
    const first = inspectHeader(v1[0..]).?;
    try std.testing.expectEqual(@as(u32, 1), first.version);
    try std.testing.expectEqual(@as(u32, 7), first.chunk_count);

    var v2: [48]u8 = @splat(0);
    std.mem.writeInt(u32, v2[0..4], MAGIC, .little);
    std.mem.writeInt(u32, v2[4..8], VERSION, .little);
    std.mem.writeInt(u32, v2[8..12], 2, .little); // two 4-float bindings
    std.mem.writeInt(u32, v2[44..48], 11, .little);
    const second = inspectHeader(v2[0..]).?;
    try std.testing.expectEqual(VERSION, second.version);
    try std.testing.expectEqual(@as(u32, 11), second.chunk_count);

    try std.testing.expect(inspectHeader(v2[0..47]) == null);
    std.mem.writeInt(u32, v2[8..12], MAX_BINDINGS + 1, .little);
    try std.testing.expect(inspectHeader(v2[0..]) == null);
}
