//! Asynchronous live-flora preview generation.
//!
//! The frame thread snapshots painted chunks; the worker owns generation; the frame
//! thread alone publishes completed row sets into retained scene nodes.

const std = @import("std");
const host_io = @import("../host_io.zig");
const layout = @import("../layout.zig");
const foliage = @import("../world/foliage.zig");
const map_paint = @import("../game/map/engine.zig");
const map_chunks = @import("../game/map/chunks.zig");
const config = @import("config.zig");
const paint_revision = @import("paint_revision.zig");
const state = @import("state.zig");
const log = std.debug;
const MAX_PAINT_SLOTS = config.MAX_PAINT_SLOTS;
const FOLIAGE_SEGMENT_HEADROOM_M = config.FOLIAGE_SEGMENT_HEADROOM_M;
const FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M = config.FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M;
const PaintFoliageFamily = config.PaintFoliageFamily;
const PAINT_FOLIAGE_FAMILY_COUNT = config.PAINT_FOLIAGE_FAMILY_COUNT;
const PAINT_FOLIAGE_THINNABLE_COUNT = config.PAINT_FOLIAGE_THINNABLE_COUNT;
const PAINT_WRAPPED_FAMILY_FIRST = config.PAINT_WRAPPED_FAMILY_FIRST;
const PAINT_FOLIAGE_START_CAPS = config.PAINT_FOLIAGE_START_CAPS;
const PAINT_FOLIAGE_NAMES = config.PAINT_FOLIAGE_NAMES;
const PALM_TRUNK_UNIT_RADIUS = config.PALM_TRUNK_UNIT_RADIUS;
const PALM_TRUNK_RADIUS_MIN = config.PALM_TRUNK_RADIUS_MIN;
const PALM_TRUNK_RADIUS_MAX = config.PALM_TRUNK_RADIUS_MAX;
const PALM_TRUNK_COLOR = config.PALM_TRUNK_COLOR;

// ── the live-foliage preview (req_2497) ───────────────────────────────────────
// Painting flora grows LITERAL foliage: the SAME foliage.zig generators the
// baked FLORA recipe expands through, driven straight off the painted lanes.
// Regenerated whole (all painted chunks) on any flora/height change —
// authoring-rate work; the nodes are static instance batches re-uploaded once
// per regen via the version bump, zero per-frame cost.

pub fn lerpF64(a: f64, b: f64, t: f64) f64 {
    return a + (b - a) * t;
}

/// Seeded Fisher–Yates over rows [first, end) of a family buffer (req_2868).
/// Deterministic per chunk: the same permutation every regen, so the distant
/// LOD subset never shimmers while painting elsewhere. WORKER THREAD.
pub fn shuffleFoliageRows(buf: []f32, first: u32, end: u32, seed: u32) void {
    var h = seed;
    var i: u32 = end - first;
    while (i > 1) {
        i -= 1;
        h = foliage.mix(h);
        const j = h % (i + 1);
        if (j == i) continue;
        const a = @as(usize, first + i) * foliage.STRIDE;
        const b = @as(usize, first + j) * foliage.STRIDE;
        var k: usize = 0;
        while (k < foliage.STRIDE) : (k += 1) {
            const tmp = buf[a + k];
            buf[a + k] = buf[b + k];
            buf[b + k] = tmp;
        }
    }
}

/// Ground height on the surface the painted ground RENDERS — the chunk's
/// 121-grid abs-max floor downsample (the same grid the collider walks).
/// heightAt's fine 241-grid bilinear can sit up to half a metre BELOW the
/// rendered slope, which drowned 0.3 m grass while 1.6 m bush poked through
/// (req_2704). Falls back to heightAt while the chunk has no mirrored floor.
/// MAIN THREAD only (live chunk reads) — the foliage worker uses its snapshot
/// twin snapGroundY (req_2864); the req_2699 per-row re-seat lives inline in
/// the worker walk.
pub fn paintGroundY(floor: ?[]const f32, chunk: *const map_chunks.Chunk, wx: f32, wz: f32) f32 {
    const f = floor orelse return map_paint.heightAt(wx, wz);
    const res = map_paint.FLOOR_RES;
    const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
    const max_i: f32 = @floatFromInt(res - 1);
    const gx = @max(0, @min(max_i, (wx - chunk.minX()) / cell));
    const gz = @max(0, @min(max_i, (wz - chunk.minZ()) / cell));
    const x0: usize = @intFromFloat(@floor(gx));
    const z0: usize = @intFromFloat(@floor(gz));
    const x1 = @min(x0 + 1, res - 1);
    const z1 = @min(z0 + 1, res - 1);
    const tx = gx - @floor(gx);
    const tz = gz - @floor(gz);
    const h00 = f[z0 * res + x0];
    const h10 = f[z0 * res + x1];
    const h01 = f[z1 * res + x0];
    const h11 = f[z1 * res + x1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
}

/// The mirrored render-floor slice for a painted chunk, if it has a slot.
pub fn paintSlotFloorFor(runtime: anytype, cx: i32, cz: i32) ?[]const f32 {
    for (0..MAX_PAINT_SLOTS) |i| {
        if (runtime.paint_slot_used[i] and runtime.paint_slot_chunk[i][0] == cx and runtime.paint_slot_chunk[i][1] == cz) {
            return runtime.paint_slot_floor[i];
        }
    }
    return null;
}

/// Append one 12-float foliage row, GROWING the family when full (req_2843:
/// the row caps are STARTING sizes, not walls — "the 15.5mb cap on flora is
/// killing me"). The doubled CPU buffer re-keys the render batch and the GPU
/// pool grows to match (gpu/3d.zig growStaticPool); the recycled old region
/// ages out of the retain cache. false = the ALLOCATOR refused the growth —
/// the machine's honest wall, not a budget's. Runs on the foliage WORKER
/// thread (req_2864) — alloc is the thread-safe c_allocator, and the GREW
/// log prints through std.debug (mutex-serialized).
pub fn pushFoliageRow(alloc: std.mem.Allocator, slot: *?[]f32, name: []const u8, count: *u32, row: [foliage.STRIDE]f32) bool {
    var buf = slot.*.?;
    const cap: u32 = @intCast(buf.len / foliage.STRIDE);
    if (count.* >= cap) {
        const grown = alloc.realloc(buf, buf.len * 2) catch return false;
        slot.* = grown;
        buf = grown;
        std.debug.print("[paint] LIVE FOLIAGE PREVIEW GREW: {s} → {d} rows ({d} MiB CPU) — elastic budget, the machine is the wall (req_2843)\n", .{ name, buf.len / foliage.STRIDE, buf.len * @sizeOf(f32) / (1024 * 1024) });
    }
    const at = @as(usize, count.*) * foliage.STRIDE;
    @memcpy(buf[at .. at + foliage.STRIDE], row[0..]);
    count.* += 1;
    return true;
}

/// Marker for the regen-end saturation log: names WHICH family hit its cap.
pub fn clippedMark(family_full: bool) []const u8 {
    return if (family_full) " CLIPPED" else "";
}

pub fn ensureFoliageBuf(alloc: std.mem.Allocator, slot: *?[]f32, cap: u32) ?[]f32 {
    if (slot.*) |buf| return buf;
    const buf = alloc.alloc(f32, @as(usize, cap) * foliage.STRIDE) catch return null;
    slot.* = buf;
    return buf;
}

/// Where the author's attention is (req_2838): the brush hover point when the
/// painter is armed, else the camera's look target (the pushed external pose
/// in editor mode). The foliage preview budget spends nearest-first from here.
pub fn paintPreviewAnchor(runtime: anytype) [2]f32 {
    if (runtime.paint_hover) |h| return .{ h[0], h[2] };
    const look = if (runtime.camera.external) runtime.camera.ext_look else runtime.camera.current_target;
    return .{ look.x, look.z };
}

// ── the foliage regen WORKER (req_2864) ──────────────────────────────────────
// Painting at 240fps leaves ~4ms of frame budget; a whole-preview regen costs
// tens of ms and used to run synchronously on every stroke frame (240 → 10fps
// with a moving brush). The regen now runs on ONE worker thread behind a
// strictly serial mailbox (the pose_mailbox pattern, req_2845):
//
//   stroke → requestFoliageRegen flags `foliage_want`
//   pollFoliageRegen (every paint frame): applies a finished result (pointer
//   swap + version bump — microseconds), then turns `want` into a job when
//   the box is idle: SNAPSHOT the painted chunks (flora lanes + render
//   floor) and submit.
//   worker: grows rows + per-chunk segments (req_2859) into the row set the
//   renderer is NOT displaying, reading the snapshot alone — it never touches
//   live chunk storage, so painting continues freely while it works.
//
// Stroke bursts coalesce: however many cells change during a regen, the next
// job regenerates once from the newest snapshot. The preview lags the brush
// by one regen; the frame rate never does.

pub const FoliageChunkSnap = struct {
    cx: i32,
    cz: i32,
    flora: [map_chunks.FLORA_LAYER_COUNT][map_chunks.TILE_CELLS]i16,
    floor: [map_paint.FLOOR_CELLS]f32,
};

pub const FoliageSnapSlot = struct {
    chunks: []FoliageChunkSnap = &.{},
    count: u32 = 0,
};

/// One ping-pong half of the preview: every PaintFoliageFamily's rows + its
/// per-chunk segments, in the exact node order declared above. The
/// renderer displays one set while the worker fills the other.
pub const FoliageRowSet = struct {
    rows: [PAINT_FOLIAGE_FAMILY_COUNT]?[]f32 = @splat(null),
    segs: [PAINT_FOLIAGE_FAMILY_COUNT]std.ArrayListUnmanaged(layout.InstanceSegment) = @splat(.empty),
};

pub const FoliageJob = struct {
    set: u8,
    map_revision: u64,
    anchor: [2]f32,
    log_full: bool,
    specs: [map_paint.MAX_PALETTE]?map_paint.FloraSpec,
};

pub const FoliageResult = struct {
    set: u8,
    map_revision: u64,
    counts: [PAINT_FOLIAGE_FAMILY_COUNT]u32,
    fulls: [PAINT_FOLIAGE_FAMILY_COUNT]bool,
    segs_ok: [PAINT_FOLIAGE_FAMILY_COUNT]bool,
    anchor: [2]f32,
    log_full: bool,
};

/// Strictly serial cross-thread mailbox: at most ONE job anywhere in the
/// pipeline (pending, working, or unpolled result). submit() only succeeds
/// when fully idle, so snapshot/row-set ownership never overlaps between
/// the main thread and the worker.
pub const FoliageMailbox = struct {
    mutex: std.Io.Mutex = .init,
    cond: std.Io.Condition = .init,
    pending: ?FoliageJob = null,
    result: ?FoliageResult = null,
    working: bool = false,
    shutdown: bool = false,

    pub fn idle(self: *FoliageMailbox) bool {
        self.mutex.lockUncancelable(host_io.io());
        defer self.mutex.unlock(host_io.io());
        return self.pending == null and !self.working and self.result == null;
    }

    pub fn submit(self: *FoliageMailbox, job: FoliageJob) bool {
        self.mutex.lockUncancelable(host_io.io());
        defer self.mutex.unlock(host_io.io());
        if (self.shutdown) return false;
        if (self.pending != null or self.working or self.result != null) return false;
        self.pending = job;
        self.cond.signal(host_io.io());
        return true;
    }

    /// Worker-only blocking take. `null` means shutdown.
    pub fn waitTake(self: *FoliageMailbox) ?FoliageJob {
        self.mutex.lockUncancelable(host_io.io());
        defer self.mutex.unlock(host_io.io());
        while (self.pending == null and !self.shutdown) self.cond.waitUncancelable(host_io.io(), &self.mutex);
        if (self.shutdown) return null;
        const job = self.pending.?;
        self.pending = null;
        self.working = true;
        return job;
    }

    pub fn publish(self: *FoliageMailbox, result: FoliageResult) void {
        self.mutex.lockUncancelable(host_io.io());
        defer self.mutex.unlock(host_io.io());
        self.working = false;
        if (!self.shutdown) self.result = result;
    }

    pub fn poll(self: *FoliageMailbox) ?FoliageResult {
        self.mutex.lockUncancelable(host_io.io());
        defer self.mutex.unlock(host_io.io());
        const out = self.result;
        self.result = null;
        return out;
    }

    pub fn stop(self: *FoliageMailbox) void {
        self.mutex.lockUncancelable(host_io.io());
        self.shutdown = true;
        self.cond.signal(host_io.io());
        self.mutex.unlock(host_io.io());
    }
};

/// paintGroundY's snapshot twin (req_2704 semantics: the 121-grid render
/// floor is the surface plants must seat on). Bilinear over COPIED floor
/// data — the worker never reads live chunk storage.
pub fn snapGroundY(floor: *const [map_paint.FLOOR_CELLS]f32, min_x: f32, min_z: f32, wx: f32, wz: f32) f32 {
    const res = map_paint.FLOOR_RES;
    const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
    const max_i: f32 = @floatFromInt(res - 1);
    const gx = @max(0, @min(max_i, (wx - min_x) / cell));
    const gz = @max(0, @min(max_i, (wz - min_z) / cell));
    const x0: usize = @intFromFloat(@floor(gx));
    const z0: usize = @intFromFloat(@floor(gz));
    const x1 = @min(x0 + 1, res - 1);
    const z1 = @min(z0 + 1, res - 1);
    const tx = gx - @floor(gx);
    const tz = gz - @floor(gz);
    const h00 = floor[z0 * res + x0];
    const h10 = floor[z0 * res + x1];
    const h01 = floor[z1 * res + x0];
    const h11 = floor[z1 * res + x1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
}

/// MAIN THREAD: copy every painted chunk's flora lanes + render floor into
/// the snapshot slot (~150KB memcpy per chunk). Chunks without a paint slot
/// get their floor sampled from heightAt at the same 121 dots here, so the
/// worker never calls into live engine state.
pub fn snapshotPaintedChunks(runtime: anytype) bool {
    var count: u32 = 0;
    for (map_chunks.slots()) |maybe| {
        if (maybe != null) count += 1;
    }
    const snap = &runtime.foliage_snap;
    if (count == 0) {
        snap.count = 0;
        return true;
    }
    if (snap.chunks.len < count) {
        snap.chunks = std.heap.c_allocator.realloc(snap.chunks, count) catch return false;
    }
    var i: u32 = 0;
    for (map_chunks.slots()) |maybe| {
        const chunk = maybe orelse continue;
        const dst = &snap.chunks[i];
        dst.cx = chunk.cx;
        dst.cz = chunk.cz;
        dst.flora = chunk.flora;
        if (paintSlotFloorFor(runtime, chunk.cx, chunk.cz)) |floor| {
            @memcpy(dst.floor[0..], floor);
        } else {
            const res = map_paint.FLOOR_RES;
            const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(res - 1));
            var gz: usize = 0;
            while (gz < res) : (gz += 1) {
                var gx: usize = 0;
                while (gx < res) : (gx += 1) {
                    const wx = chunk.minX() + @as(f32, @floatFromInt(gx)) * cell;
                    const wz = chunk.minZ() + @as(f32, @floatFromInt(gz)) * cell;
                    dst.floor[gz * res + gx] = map_paint.heightAt(wx, wz);
                }
            }
        }
        i += 1;
    }
    snap.count = i;
    return true;
}

/// `log_full` is true on paint-driven regens (the saturation warning prints);
/// anchor-follow regens pass false so panning the camera doesn't spam it.
/// This only FLAGS the want — pollFoliageRegen turns it into a worker job.
pub fn requestFoliageRegen(runtime: anytype, log_full: bool) void {
    runtime.foliage_want = true;
    if (log_full) runtime.foliage_want_log = true;
}

/// MAIN THREAD, every paint-layer frame: apply a finished regen, then feed
/// the worker if a regen is wanted and the pipeline is idle.
pub fn pollFoliageRegen(runtime: anytype) void {
    if (runtime.foliage_box.poll()) |result| {
        if (paint_revision.resultIsCurrent(result.map_revision, runtime.paint_map_revision)) {
            applyFoliageResult(runtime, result);
        } else {
            // A worker may finish an outgoing document after reset/load. Never
            // flash those rows over the incoming map; request its snapshot.
            runtime.foliage_want = true;
        }
    }
    if (!runtime.foliage_want) return;
    if (!runtime.foliage_box.idle()) return;
    if (runtime.foliage_worker == null) {
        runtime.foliage_worker = std.Thread.spawn(.{}, foliageWorkerMain, .{runtime}) catch |err| {
            log.print("[paint] foliage worker spawn FAILED ({any}) — live foliage preview will not update\n", .{err});
            runtime.foliage_want = false;
            runtime.foliage_want_log = false;
            return;
        };
    }
    if (!snapshotPaintedChunks(runtime)) return; // OOM: keep the want, retry next frame
    var job = FoliageJob{
        .set = 1 - runtime.foliage_display,
        .map_revision = runtime.paint_map_revision,
        .anchor = paintPreviewAnchor(runtime),
        .log_full = runtime.foliage_want_log,
        .specs = undefined,
    };
    for (0..map_paint.MAX_PALETTE) |k| job.specs[k] = map_paint.floraSpec(@intCast(k));
    if (runtime.foliage_box.submit(job)) {
        runtime.foliage_want = false;
        runtime.foliage_want_log = false;
    }
}

/// MAIN THREAD: point every family kid at the finished row set. This is
/// the regen's only frame-time cost — pointers, counts, one version bump.
pub fn applyFoliageResult(runtime: anytype, result: FoliageResult) void {
    const first = runtime.paint_foliage_kids_first orelse return;
    runtime.foliage_display = result.set;
    const set = &runtime.foliage_sets[result.set];
    // A family only reads full when the ALLOCATOR refused to grow it — the
    // machine's wall, not a budget's (req_2843: the caps are starting sizes).
    var any_full = false;
    for (result.fulls) |family_full| any_full = any_full or family_full;
    runtime.paint_foliage_clipped = any_full;
    runtime.paint_foliage_anchor = result.anchor;
    if (result.log_full and any_full) {
        const cap = struct {
            fn rows(maybe: ?[]f32) usize {
                return if (maybe) |buf| buf.len / foliage.STRIDE else 0;
            }
        };
        log.print("[paint] LIVE FOLIAGE PREVIEW at the MACHINE'S wall (", .{});
        for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
            log.print("{s}{s} {d}/{d}{s}", .{
                if (fi == 0) "" else " · ",
                PAINT_FOLIAGE_NAMES[fi],
                result.counts[fi],
                cap.rows(set.rows[fi]),
                clippedMark(result.fulls[fi]),
            });
        }
        log.print(") — allocator refused further growth; nearest-first keeps clipping far from the brush. Compile grows the full population\n", .{});
    }
    runtime.paint_foliage_ver += 1;
    for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
        const node = &runtime.kid_list.items[first + fi];
        const buf = set.rows[fi] orelse {
            node.scene3d_mesh = false;
            continue;
        };
        // the FULL family slice every time: the static instance region is
        // reserved at first upload and re-uploaded in place on version bumps.
        // The slice only changes when the family GROWS (req_2843) — the
        // renderer then retains a fresh region and the old one ages out of
        // the cache (gpu/3d.zig staticCacheSlot).
        node.scene3d_instance_data = buf;
        node.scene3d_instance_count = result.counts[fi];
        node.scene3d_instance_version = runtime.paint_foliage_ver;
        node.scene3d_mesh = result.counts[fi] > 0;
        // req_2859: this family's per-chunk ranges, for frustum culling. A
        // family whose segment append failed draws whole.
        const segs = set.segs[fi].items;
        node.scene3d_instance_segments = if (result.segs_ok[fi] and segs.len > 0) segs else null;
        // req_2868: only ground flora is per-chunk shuffled. Palm parts and
        // whole wrapped plants keep authored order and draw their full silhouette.
        node.scene3d_instance_lod_density = fi < PAINT_FOLIAGE_THINNABLE_COUNT and node.scene3d_instance_segments != null;
    }
}

/// WORKER THREAD entry: block on the mailbox, regen, publish, repeat.
pub fn foliageWorkerMain(runtime: anytype) void {
    while (runtime.foliage_box.waitTake()) |job| {
        runtime.foliage_box.publish(buildFoliageRows(runtime, job));
    }
}

/// WORKER THREAD: the regen walk — grow every painted cell's plants from the
/// snapshot into the off-display row set. Reads the snapshot and job ONLY.
pub fn buildFoliageRows(runtime: anytype, job: FoliageJob) FoliageResult {
    const alloc = std.heap.c_allocator;
    const set = &runtime.foliage_sets[job.set];
    var result = FoliageResult{
        .set = job.set,
        .map_revision = job.map_revision,
        .counts = @splat(0),
        .fulls = @splat(false),
        .segs_ok = @splat(true),
        .anchor = job.anchor,
        .log_full = job.log_full,
    };
    for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
        if (ensureFoliageBuf(alloc, &set.rows[fi], PAINT_FOLIAGE_START_CAPS[fi]) == null) return result;
        set.segs[fi].clearRetainingCapacity();
    }

    var counts: [PAINT_FOLIAGE_FAMILY_COUNT]u32 = @splat(0);
    var fulls: [PAINT_FOLIAGE_FAMILY_COUNT]bool = @splat(false);

    // req_2838: the budget spends NEAREST-FIRST from the author's anchor, so a
    // saturated preview undresses the FARTHEST chunks — never the one under
    // the brush. Raw slot order dropped whatever chunks the walk reached last,
    // which could be exactly where the user was painting (invisible strokes).
    const Order = struct {
        idx: u32,
        d2: f32,
        fn closer(_: void, a: @This(), b: @This()) bool {
            return a.d2 < b.d2;
        }
    };
    var order: [map_chunks.SLOT_COUNT]Order = undefined;
    const snap = &runtime.foliage_snap;
    const n_chunks: usize = @min(snap.count, snap.chunks.len);
    for (snap.chunks[0..n_chunks], 0..) |*chunk_snap, ci| {
        // chunks are CENTERED at (cx·CHUNK_METERS, cz·CHUNK_METERS)
        const dx = @as(f32, @floatFromInt(chunk_snap.cx)) * map_chunks.CHUNK_METERS - job.anchor[0];
        const dz = @as(f32, @floatFromInt(chunk_snap.cz)) * map_chunks.CHUNK_METERS - job.anchor[1];
        order[ci] = .{ .idx = @intCast(ci), .d2 = dx * dx + dz * dz };
    }
    std.sort.pdq(Order, order[0..n_chunks], {}, Order.closer);

    for (order[0..n_chunks]) |entry| {
        const chunk_snap = &snap.chunks[entry.idx];
        const min_x = @as(f32, @floatFromInt(chunk_snap.cx)) * map_chunks.CHUNK_METERS - map_chunks.CHUNK_METERS / 2;
        const min_z = @as(f32, @floatFromInt(chunk_snap.cz)) * map_chunks.CHUNK_METERS - map_chunks.CHUNK_METERS / 2;
        const seg_start = counts;
        var seg_ymin: f32 = std.math.floatMax(f32);
        var seg_ymax: f32 = -std.math.floatMax(f32);
        var lz: i32 = 0;
        while (lz < map_chunks.CHUNK_TILES) : (lz += 1) {
            var lx: i32 = 0;
            while (lx < map_chunks.CHUNK_TILES) : (lx += 1) {
                const idx = @as(usize, @intCast(lz)) * map_chunks.TILE_COLS + @as(usize, @intCast(lx));
                var lane: usize = 0;
                while (lane < map_chunks.FLORA_LAYER_COUNT) : (lane += 1) {
                    const kind = chunk_snap.flora[lane][idx];
                    if (kind < 0 or kind >= @as(i16, @intCast(map_paint.MAX_PALETTE))) continue;
                    const spec = job.specs[@intCast(kind)] orelse continue;
                    const recipe = foliage.specFromWire(spec.spec) orelse continue;
                    const wx = min_x + @as(f32, @floatFromInt(lx)) + 0.5;
                    const wz = min_z + @as(f32, @floatFromInt(lz)) + 0.5;
                    const top: f64 = snapGroundY(&chunk_snap.floor, min_x, min_z, wx, wz);
                    seg_ymin = @min(seg_ymin, @as(f32, @floatCast(top)));
                    seg_ymax = @max(seg_ymax, @as(f32, @floatCast(top)));
                    const gx = chunk_snap.cx * map_chunks.CHUNK_TILES + lx;
                    const gz = chunk_snap.cz * map_chunks.CHUNK_TILES + lz;
                    const cell_key: u32 = (@as(u32, @bitCast(gx)) *% 0x9E3779B1) ^
                        (@as(u32, @bitCast(gz)) *% 0x85EBCA77) ^
                        (@as(u32, @intCast(lane + 1)) *% 0xC2B2AE3D);

                    if (foliage.wrappedSpecies(recipe)) |species| {
                        if (foliage.wrappedSpawnRoll(species, cell_key) > spec.chance) continue;
                        var wrapped_row = foliage.wrappedRow(species, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key);
                        wrapped_row[1] += snapGroundY(&chunk_snap.floor, min_x, min_z, wrapped_row[0], wrapped_row[2]) - @as(f32, @floatCast(top));
                        const fi = PAINT_WRAPPED_FAMILY_FIRST + @intFromEnum(species);
                        if (!pushFoliageRow(alloc, &set.rows[fi], PAINT_FOLIAGE_NAMES[fi], &counts[fi], wrapped_row)) fulls[fi] = true;
                        continue;
                    }
                    switch (recipe) {
                        .palm => {
                            // Palms are density-GATED per cell (most stay bare — the
                            // grove look) and roll trunk + crown off the SAME hash
                            // chain palmPopulation.ts uses, so bark and fronds agree.
                            const seed = foliage.mix(cell_key ^ 0x9d2c5680);
                            if (foliage.unit(seed) > spec.chance) continue;
                            const h0 = foliage.mix(seed ^ 0x1b56c4e9);
                            const h1 = foliage.mix(h0 ^ 0x68bc21eb);
                            const h2 = foliage.mix(h1 ^ 0x7feb352d);
                            const trunk_h = lerpF64(foliage.PALM.trunk_h_min, foliage.PALM.trunk_h_max, foliage.unit(h0));
                            const radius = lerpF64(PALM_TRUNK_RADIUS_MIN, PALM_TRUNK_RADIUS_MAX, foliage.unit(h1));
                            const lean = (foliage.unit(foliage.mix(h2 ^ 0x51)) - 0.5) * 0.8 * 140.0;
                            const px = @as(f64, wx) + (foliage.unit(foliage.mix(h0 ^ 0xa5)) - 0.5) * 0.7;
                            const pz = @as(f64, wz) + (foliage.unit(foliage.mix(h1 ^ 0xa5)) - 0.5) * 0.7;
                            const span: f32 = @floatCast(radius / PALM_TRUNK_UNIT_RADIUS);
                            // Trunk + crown ride ONE ground delta (the trunk's
                            // footing) so bark and fronds stay attached on slopes.
                            const trunk_delta = snapGroundY(&chunk_snap.floor, min_x, min_z, @floatCast(px), @floatCast(pz)) - @as(f32, @floatCast(top));
                            const trunk_fi = @intFromEnum(PaintFoliageFamily.palm_trunks);
                            if (!pushFoliageRow(alloc, &set.rows[trunk_fi], PAINT_FOLIAGE_NAMES[trunk_fi], &counts[trunk_fi], .{
                                @floatCast(px),      @as(f32, @floatCast(top)) + trunk_delta, @floatCast(pz),
                                0,                   @floatCast(lean),                        0,
                                span,                @floatCast(trunk_h),                     span,
                                PALM_TRUNK_COLOR[0], PALM_TRUNK_COLOR[1],                     PALM_TRUNK_COLOR[2],
                            })) fulls[trunk_fi] = true;
                            const crown = foliage.palmCrown(&foliage.PALM, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key);
                            const fc = crown.total();
                            const frond_fi = @intFromEnum(PaintFoliageFamily.palm_fronds);
                            var k: u32 = 0;
                            while (k < fc) : (k += 1) {
                                var row = foliage.palmFrondRow(&crown, k);
                                row[1] += trunk_delta;
                                if (!pushFoliageRow(alloc, &set.rows[frond_fi], PAINT_FOLIAGE_NAMES[frond_fi], &counts[frond_fi], row)) fulls[frond_fi] = true;
                            }
                        },
                        .flowers => {
                            const fi = @intFromEnum(PaintFoliageFamily.flowers);
                            var k: u32 = 0;
                            while (k < spec.count) : (k += 1) {
                                var row = foliage.flowerRow(&foliage.FLOWER, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key, k);
                                // re-seat on the terrain under the row's OWN x/z
                                // (req_2699: cell-centre height buries slope rows)
                                row[1] += snapGroundY(&chunk_snap.floor, min_x, min_z, row[0], row[2]) - @as(f32, @floatCast(top));
                                if (!pushFoliageRow(alloc, &set.rows[fi], PAINT_FOLIAGE_NAMES[fi], &counts[fi], row)) fulls[fi] = true;
                            }
                        },
                        else => if (foliage.bladePopulation(recipe)) |population| {
                            const family: PaintFoliageFamily = if (population.family == .grass) .grass else .bush;
                            const fi = @intFromEnum(family);
                            var k: u32 = 0;
                            while (k < spec.count) : (k += 1) {
                                var row = foliage.bladeRow(population.config, @as(f64, wx), @as(f64, wz), top, 1.0, cell_key, k);
                                row[1] += snapGroundY(&chunk_snap.floor, min_x, min_z, row[0], row[2]) - @as(f32, @floatCast(top));
                                if (!pushFoliageRow(alloc, &set.rows[fi], PAINT_FOLIAGE_NAMES[fi], &counts[fi], row)) fulls[fi] = true;
                            }
                        },
                    }
                }
            }
        }
        // Close out this chunk's segments (req_2859): one {row range, sphere}
        // per family that grew rows here. Sphere = chunk half-diagonal (+
        // lateral jitter) horizontally, sampled ground span + tallest-plant
        // headroom (the tallest wrapped flora is <16 m) vertically; conservative
        // bounds only ever draw a little extra, never cull a visible plant.
        const seg_end = counts;
        // req_2868: shuffle each thin-able family's chunk rows (seeded per
        // chunk, IDENTICAL across regens — no distant shimmer while painting)
        // so a PREFIX of the range is a spatially uniform density subset; the
        // renderer's distance LOD draws prefixes. Palm parts and whole wrapped
        // species anchor the silhouette and always draw whole.
        const chunk_seed: u32 = (@as(u32, @bitCast(chunk_snap.cx)) *% 0x9E3779B1) ^
            (@as(u32, @bitCast(chunk_snap.cz)) *% 0x85EBCA77);
        for (0..PAINT_FOLIAGE_THINNABLE_COUNT) |fi| {
            if (seg_end[fi] > seg_start[fi]) {
                shuffleFoliageRows(set.rows[fi].?, seg_start[fi], seg_end[fi], chunk_seed +% @as(u32, @intCast(fi)));
            }
        }
        const seg_cx = @as(f32, @floatFromInt(chunk_snap.cx)) * map_chunks.CHUNK_METERS;
        const seg_cz = @as(f32, @floatFromInt(chunk_snap.cz)) * map_chunks.CHUNK_METERS;
        const seg_grounded = seg_ymax >= seg_ymin;
        const seg_cy: f32 = if (seg_grounded) (seg_ymin + seg_ymax) * 0.5 else 0;
        const seg_yhalf: f32 = (if (seg_grounded) (seg_ymax - seg_ymin) * 0.5 else 0) + FOLIAGE_SEGMENT_HEADROOM_M;
        const seg_radius: f32 = @sqrt(FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M * FOLIAGE_SEGMENT_HORIZONTAL_RADIUS_M + seg_yhalf * seg_yhalf);
        for (0..PAINT_FOLIAGE_FAMILY_COUNT) |fi| {
            const added = seg_end[fi] - seg_start[fi];
            if (added == 0 or !result.segs_ok[fi]) continue;
            set.segs[fi].append(alloc, .{
                .first = seg_start[fi],
                .count = added,
                .cx = seg_cx,
                .cy = seg_cy,
                .cz = seg_cz,
                .radius = seg_radius,
            }) catch {
                result.segs_ok[fi] = false;
            };
        }
    }

    result.counts = counts;
    result.fulls = fulls;
    return result;
}
