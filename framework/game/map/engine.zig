// game/map/engine — the map painter's stroke engine: tool state, stroke
// lifecycle, and the GLOBAL-frame routing of stamps across chunks. Ported from
// the interaction core of cart/hmsc-int/PaintCanvas.tsx (USER ASK req_2473).
//
// This is the piece that used to run in JS per dab. The bindings (and, next,
// the loader's native input path) feed it strokeBegin/strokeMove/strokeEnd in
// WORLD METERS; everything from interpolation to typed-buffer mutation happens
// in-process. Zero JS per dab.
//
// PORT DISCIPLINE (PaintCanvas.tsx line refs throughout):
//   · stroke interpolation: step = max(0.5, radius·0.5) m, ≤256 sub-stamps (:1621)
//   · per-stroke stamp dedup on the GLOBAL sample cell (:868)
//   · height/water stamp in the shared global sample frame across every chunk
//     in reach — the seam-free border invariant (:861)
//   · smooth fits ONE plane across all covered chunks, then eases toward it (:966)
//   · ramp is a drag gesture: midpoint center, atan2 angle, max(1, dist) length,
//     parameter fallback under 0.5 m (:1516)
//   · slope stamps at stroke END over the accumulated centerline, runM = total
//     stroke length (:1563)
// Deliberate deviation: tile/flora/zone cells paint in the GLOBAL cell frame
// (cross-chunk), where the TS clipped the footprint to the cursor's chunk.

const std = @import("std");
const chunks = @import("chunks.zig");
const stamps = @import("stamps.zig");
pub const roads = @import("roads.zig");

const DOT_M = chunks.DOT_M;
const CHUNK_TILES = chunks.CHUNK_TILES;

// ── the armed tool ────────────────────────────────────────────────────────────

pub const Channel = enum(u8) { terrain = 0, tile = 1, water = 2, flora = 3, zone = 4, road = 5 };
pub const Mode = enum(u8) { paint = 0, erase = 1 };
/// Terrain sub-tools (the height card's modes: brush/ramp/slope/smooth).
pub const TerrainTool = enum(u8) { brush = 0, ramp = 1, slope = 2, smooth = 3 };

pub const Tool = struct {
    channel: Channel = .terrain,
    mode: Mode = .paint,
    terrain_tool: TerrainTool = .brush,
    shape: stamps.BrushShape = .circle,
    profile: stamps.BrushProfile = .cone,
    /// brush radius: meters for terrain/water, TILES for tile/flora/zone
    /// (identical numbers under the 1 tile = 1 m contract)
    radius_m: f32 = 2,
    /// height-brush peak, signed (raise vs dig)
    center_z: f32 = 4,
    // ramp + slope share the min→max dials (PaintCanvas b.rampMin/rampMax)
    ramp_min: f32 = 0,
    ramp_max: f32 = 4,
    ramp_wide: f32 = 3,
    ramp_long: f32 = 6,
    ramp_angle_deg: f32 = 0,
    smooth_strength: f32 = 0.5,
    /// armed tile kind (content index; the engine treats it as opaque)
    kind_idx: i16 = chunks.EMPTY_CELL,
    /// armed flora kind + its population lane (0 grass, 1 tree, 2 bush)
    flora_kind_idx: i16 = chunks.EMPTY_CELL,
    flora_lane: u8 = 0,
    /// armed zone list index
    zone_idx: i16 = chunks.EMPTY_CELL,
};

var g_tool: Tool = .{};

pub fn setTool(next: Tool) void {
    g_tool = next;
}

pub fn tool() Tool {
    return g_tool;
}

// ── stroke state ──────────────────────────────────────────────────────────────

pub const StrokeStats = struct {
    samples: u32 = 0,
    stamps: u32 = 0,
    /// chunks dirtied by this stroke
    touched: u32 = 0,
    /// water stroke found no sub-0 basin to fill (PaintCanvas:940 nudge)
    water_dry: bool = false,
};

const MAX_SLOPE_POINTS: usize = 2048;

var g_stroke_active = false;
var g_stats: StrokeStats = .{};
var g_last: ?[2]f32 = null;
var g_slope_points: [MAX_SLOPE_POINTS][2]f32 = undefined;
var g_slope_count: usize = 0;
var g_ramp_start: ?[2]f32 = null;
var g_ramp_current: [2]f32 = .{ 0, 0 };
var g_water_wet_any = false;

/// Per-stroke stamp dedup keys (global sample cell + a stamp-family tag).
var g_seen: std.AutoHashMapUnmanaged(u64, void) = .empty;
const seen_alloc = std.heap.page_allocator;

fn seenKey(tag: u8, a: i32, b: i32, c: i32, d: i32) u64 {
    var h = std.hash.Wyhash.init(tag);
    h.update(std.mem.asBytes(&a));
    h.update(std.mem.asBytes(&b));
    h.update(std.mem.asBytes(&c));
    h.update(std.mem.asBytes(&d));
    return h.final();
}

/// true = first deposit at this key this stroke; false = already stamped.
fn claimStamp(key: u64) bool {
    const gop = g_seen.getOrPut(seen_alloc, key) catch return true;
    return !gop.found_existing;
}

pub fn reset() void {
    chunks.clearAll();
    roads.clearAll();
    g_road_under.clearRetainingCapacity();
    road_plan_truncated = false;
    g_tool = .{};
    g_stroke_active = false;
    g_last = null;
    g_slope_count = 0;
    g_ramp_start = null;
    g_seen.clearRetainingCapacity();
}

/// The draft profile road clicks author with (set by chrome before drafting).
var g_road_profile: roads.RoadProfile = .{ .lanesF = 1, .lanesB = 1, .sidewalks = true };

pub fn setRoadProfile(p: roads.RoadProfile) void {
    g_road_profile = roads.clampProfile(p);
}

// ── the stroke lifecycle ──────────────────────────────────────────────────────

pub fn strokeBegin(x: f32, z: f32) void {
    g_stroke_active = true;
    g_stats = .{};
    g_last = null;
    g_slope_count = 0;
    g_ramp_start = null;
    g_water_wet_any = false;
    g_seen.clearRetainingCapacity();

    if (g_tool.channel == .terrain and g_tool.terrain_tool == .ramp) {
        // anchor snapped to the cell center (PaintCanvas beginRamp:1541)
        const anchor = cellCenter(x, z);
        g_ramp_start = anchor;
        g_ramp_current = anchor;
        return;
    }
    if (g_tool.channel == .terrain and g_tool.terrain_tool == .slope) {
        pushSlopePoint(x, z);
        return;
    }
    if (g_tool.channel == .road) {
        // roads are CLICK-authored strokes (painterBehavior 'click'): each
        // press lays a draft centerline point at the cell center, in the
        // global-tile frame the road compiler plans in. Commit stamps.
        if (roads.draftPointCount() == 0) roads.beginDraft(g_road_profile);
        const cell = cellCenter(x, z);
        roads.addDraftPoint(cell[0] + chunks.CHUNK_METERS / 2, cell[1] + chunks.CHUNK_METERS / 2);
        g_stats.stamps += 1;
        return;
    }
    // first sample of the stroke: just the point (PaintCanvas:1616)
    applySampleAt(x, z);
    g_last = .{ x, z };
}

pub fn strokeMove(x: f32, z: f32) void {
    if (!g_stroke_active) return;
    g_stats.samples += 1;

    if (g_tool.channel == .road) return; // click tool: points land on press only

    if (g_tool.channel == .terrain and g_tool.terrain_tool == .ramp) {
        g_ramp_current = .{ x, z };
        return;
    }
    if (g_tool.channel == .terrain and g_tool.terrain_tool == .slope) {
        pushSlopePoint(x, z);
        return;
    }

    // Interpolate from the last stamp: a fast drag (or WASD pan) leaps cells per
    // event; stamping only endpoints leaves a dashed line. Step spacing scales
    // with the radius (a wide disc covers the gaps) and is capped so a big brush
    // can't explode into millions of stamps (PaintCanvas:1598).
    if (g_last) |prev| {
        const dx = x - prev[0];
        const dz = z - prev[1];
        const dist = std.math.hypot(dx, dz);
        const step_m = @max(0.5, g_tool.radius_m * 0.5); // ≤ ½ disc, so stamps overlap
        const steps_f = @min(256, @max(1, @ceil(dist / step_m)));
        const steps: u32 = @intFromFloat(steps_f);
        var i: u32 = 1;
        while (i <= steps) : (i += 1) {
            const t = @as(f32, @floatFromInt(i)) / steps_f;
            applySampleAt(prev[0] + dx * t, prev[1] + dz * t);
        }
    } else {
        applySampleAt(x, z);
    }
    g_last = .{ x, z };
}

pub fn strokeEnd() StrokeStats {
    if (!g_stroke_active) return g_stats;
    g_stroke_active = false;

    if (g_tool.channel == .terrain and g_tool.terrain_tool == .ramp) {
        finishRamp();
    } else if (g_tool.channel == .terrain and g_tool.terrain_tool == .slope) {
        finishSlope();
    }
    if (g_tool.channel == .water and g_tool.mode == .paint) {
        g_stats.water_dry = !g_water_wet_any;
    }
    g_stats.touched = dirtyChunkCount();
    return g_stats;
}

fn pushSlopePoint(x: f32, z: f32) void {
    // min spacing ¼ sample so a held cursor doesn't flood the centerline (:1609)
    if (g_slope_count > 0) {
        const prev = g_slope_points[g_slope_count - 1];
        if (std.math.hypot(x - prev[0], z - prev[1]) < DOT_M * 0.25) return;
    }
    if (g_slope_count >= MAX_SLOPE_POINTS) return;
    g_slope_points[g_slope_count] = .{ x, z };
    g_slope_count += 1;
}

/// Center of the 1m cell under (x,z), in world meters.
fn cellCenter(x: f32, z: f32) [2]f32 {
    const gtx: f32 = @floatFromInt(chunks.globalTile(x));
    const gtz: f32 = @floatFromInt(chunks.globalTile(z));
    const half = chunks.CHUNK_METERS / 2;
    return .{ gtx - half + 0.5, gtz - half + 0.5 };
}

// ── sample dispatch ───────────────────────────────────────────────────────────

fn applySampleAt(x: f32, z: f32) void {
    switch (g_tool.channel) {
        .terrain => switch (g_tool.terrain_tool) {
            .brush => stampHeightAt(x, z),
            .smooth => stampSmoothAt(x, z),
            .ramp, .slope => {}, // gesture tools stamp at stroke end
        },
        .water => stampWaterAt(x, z),
        .tile, .flora, .zone => stampCellsAt(x, z),
        .road => {}, // click-authored in strokeBegin; never a drag sample
    }
}

// ── height sculpt (PaintCanvas stampHeightAtGraph:866) ────────────────────────

fn stampHeightAt(x: f32, z: f32) void {
    const gsx: i32 = @intFromFloat(@round(x / DOT_M));
    const gsz: i32 = @intFromFloat(@round(z / DOT_M));
    if (!claimStamp(seenKey(1, gsx, gsz, 0, 0))) return;
    g_stats.stamps += 1;

    const radiusM = @max(0.5, g_tool.radius_m);
    const rd: f32 = @max(1, @ceil(radiusM / DOT_M));
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        const local = chunks.localSampleF(ch, x, z);
        const cix: f32 = @round(local[0]);
        const ciz: f32 = @round(local[1]);
        const edge: f32 = @floatFromInt(chunks.SAMPLE_COLS - 1);
        // skip chunks the brush can't reach (cheap; avoids dirtying them) (:884)
        if (cix + rd < 0 or cix - rd > edge or ciz + rd < 0 or ciz - rd > edge) continue;
        stamps.stampBrush(fieldOf(&ch.height), @intFromFloat(cix), @intFromFloat(ciz), .{
            .centerZ = g_tool.center_z,
            .radiusM = radiusM,
            .shape = g_tool.shape,
            .profile = g_tool.profile,
            .erase = g_tool.mode == .erase,
        });
        ch.dirty.height = true;
    }
}

fn fieldOf(z: *[chunks.SAMPLE_CELLS]f32) stamps.FieldView {
    return .{ .z = z[0..], .cols = chunks.SAMPLE_COLS, .rows = chunks.SAMPLE_COLS };
}

// ── water (PaintCanvas stampWaterAtGraph:899) ─────────────────────────────────
// Water does not dig: the brush marks wet samples only where the terrain bed is
// below zero and stores depth = −bed, so the surface resolves to world height 0.
// Erase drains without changing terrain.

fn stampWaterAt(x: f32, z: f32) void {
    const gsx: i32 = @intFromFloat(@round(x / DOT_M));
    const gsz: i32 = @intFromFloat(@round(z / DOT_M));
    if (!claimStamp(seenKey(2, gsx, gsz, 0, 0))) return;
    g_stats.stamps += 1;

    const radiusM = @max(0.5, g_tool.radius_m);
    const rd_f: f32 = @max(1, @ceil(radiusM / DOT_M));
    const rd: i32 = @intFromFloat(rd_f);
    const erase = g_tool.mode == .erase;
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        const local = chunks.localSampleF(ch, x, z);
        const cix: i32 = @intFromFloat(@round(local[0]));
        const ciz: i32 = @intFromFloat(@round(local[1]));
        const edge: i32 = @intCast(chunks.SAMPLE_COLS - 1);
        if (cix + rd < 0 or cix - rd > edge or ciz + rd < 0 or ciz - rd > edge) continue;
        var wrote = false;
        var dz: i32 = -rd;
        while (dz <= rd) : (dz += 1) {
            const jz = ciz + dz;
            if (jz < 0 or jz > edge) continue;
            var dx: i32 = -rd;
            while (dx <= rd) : (dx += 1) {
                const jx = cix + dx;
                if (jx < 0 or jx > edge) continue;
                const dm = stamps.footprintDistance(g_tool.shape, @floatFromInt(dx), @floatFromInt(dz)) * DOT_M;
                if (dm > radiusM) continue;
                const idx = @as(usize, @intCast(jz)) * chunks.SAMPLE_COLS + @as(usize, @intCast(jx));
                const bed = ch.height[idx];
                if (bed < 0) g_water_wet_any = true;
                const next: f32 = if (erase) 0 else @max(0, -bed);
                if (ch.water[idx] != next) {
                    ch.water[idx] = next;
                    wrote = true;
                }
            }
        }
        if (wrote) ch.dirty.water = true;
    }
}

// ── smooth (PaintCanvas stampSmoothAtGraph:966) ───────────────────────────────
// ONE weighted plane fit across every covered chunk, then every covered sample
// eases toward that plane — preserving the broad slope while erasing chatter.

const SmoothSample = struct {
    chunk: *chunks.Chunk,
    idx: usize,
    x: f32,
    y: f32,
    z: f32,
    falloff: f32,
};
var g_smooth_scratch: [65536]SmoothSample = undefined;

fn stampSmoothAt(x: f32, z: f32) void {
    const gsx: i32 = @intFromFloat(@round(x / DOT_M));
    const gsz: i32 = @intFromFloat(@round(z / DOT_M));
    if (!claimStamp(seenKey(3, gsx, gsz, 0, 0))) return;
    g_stats.stamps += 1;

    const radiusM = @max(0.5, g_tool.radius_m);
    var count: usize = 0;
    var sw: f32 = 0;
    var sx: f32 = 0;
    var sy: f32 = 0;
    var sz: f32 = 0;
    var sxx: f32 = 0;
    var sxy: f32 = 0;
    var syy: f32 = 0;
    var sxz: f32 = 0;
    var syz: f32 = 0;

    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        const local = chunks.localSampleF(ch, x, z);
        const cix = local[0];
        const ciz = local[1];
        const rd = @max(1, @ceil(radiusM / DOT_M)) + 1;
        const edge: f32 = @floatFromInt(chunks.SAMPLE_COLS - 1);
        const min_x_f = @max(0, @floor(cix - rd));
        const max_x_f = @min(edge, @ceil(cix + rd));
        const min_y_f = @max(0, @floor(ciz - rd));
        const max_y_f = @min(edge, @ceil(ciz + rd));
        if (min_x_f > max_x_f or min_y_f > max_y_f) continue;
        var jy: usize = @intFromFloat(min_y_f);
        const max_y: usize = @intFromFloat(max_y_f);
        const min_x: usize = @intFromFloat(min_x_f);
        const max_x: usize = @intFromFloat(max_x_f);
        while (jy <= max_y) : (jy += 1) {
            var jx = min_x;
            while (jx <= max_x) : (jx += 1) {
                const px = (@as(f32, @floatFromInt(jx)) - cix) * DOT_M;
                const py = (@as(f32, @floatFromInt(jy)) - ciz) * DOT_M;
                const dm = stamps.footprintDistance(g_tool.shape, px / DOT_M, py / DOT_M) * DOT_M;
                if (dm > radiusM) continue;
                const falloff = stamps.brushProfile(g_tool.profile, dm / radiusM);
                if (falloff <= 0) continue;
                if (count >= g_smooth_scratch.len) continue;
                const idx = jy * chunks.SAMPLE_COLS + jx;
                const zv = ch.height[idx];
                const w = @max(0.001, falloff);
                g_smooth_scratch[count] = .{ .chunk = ch, .idx = idx, .x = px, .y = py, .z = zv, .falloff = falloff };
                count += 1;
                sw += w;
                sx += w * px;
                sy += w * py;
                sz += w * zv;
                sxx += w * px * px;
                sxy += w * px * py;
                syy += w * py * py;
                sxz += w * px * zv;
                syz += w * py * zv;
            }
        }
    }

    if (count == 0 or sw <= 0) return;
    const det = stamps.det3(sxx, sxy, sx, sxy, syy, sy, sx, sy, sw);
    var a: f32 = 0;
    var b: f32 = 0;
    var c: f32 = sz / sw;
    if (@abs(det) > 1e-9) {
        a = stamps.det3(sxz, sxy, sx, syz, syy, sy, sz, sy, sw) / det;
        b = stamps.det3(sxx, sxz, sx, sxy, syz, sy, sx, sz, sw) / det;
        c = stamps.det3(sxx, sxy, sxz, sxy, syy, syz, sx, sy, sz) / det;
    }

    const strength = @max(0.05, @min(1, g_tool.smooth_strength));
    for (g_smooth_scratch[0..count]) |s| {
        const target = stamps.clampHeight(a * s.x + b * s.y + c);
        s.chunk.height[s.idx] = stamps.clampHeight(s.z + (target - s.z) * strength * s.falloff);
        s.chunk.dirty.height = true;
    }
}

// ── ramp + slope gesture finishers ────────────────────────────────────────────

fn finishRamp() void {
    const start = g_ramp_start orelse return;
    g_ramp_start = null;
    const dx = g_ramp_current[0] - start[0];
    const dz = g_ramp_current[1] - start[1];
    const distM = std.math.hypot(dx, dz);
    // drag ≥ 0.5 m: ramp spans the drag; else stamp the parameter ramp (:1523)
    if (distM >= 0.5) {
        stampRampAt((start[0] + g_ramp_current[0]) / 2, (start[1] + g_ramp_current[1]) / 2, .{
            .minZ = g_tool.ramp_min,
            .maxZ = g_tool.ramp_max,
            .wideM = g_tool.ramp_wide,
            .longM = @max(1, distM),
            .angleDeg = std.math.atan2(dx, dz) * 180.0 / std.math.pi,
        });
    } else {
        stampRampAt(start[0], start[1], .{
            .minZ = g_tool.ramp_min,
            .maxZ = g_tool.ramp_max,
            .wideM = g_tool.ramp_wide,
            .longM = g_tool.ramp_long,
            .angleDeg = g_tool.ramp_angle_deg,
        });
    }
}

fn stampRampAt(x: f32, z: f32, opts: stamps.RampStampOpts) void {
    const key = seenKey(
        4,
        @intFromFloat(@round(x / DOT_M)),
        @intFromFloat(@round(z / DOT_M)),
        @intFromFloat(@round(opts.angleDeg)),
        @intFromFloat(@round(opts.longM * 10) + @round(opts.wideM * 10) * 65536),
    );
    if (!claimStamp(key)) return;
    g_stats.stamps += 1;

    const rd = @ceil(std.math.hypot(opts.wideM, opts.longM) / DOT_M / 2) + 2;
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        const local = chunks.localSampleF(ch, x, z);
        const edge: f32 = @floatFromInt(chunks.SAMPLE_COLS - 1);
        if (local[0] + rd < 0 or local[0] - rd > edge or local[1] + rd < 0 or local[1] - rd > edge) continue;
        stamps.stampRamp(fieldOf(&ch.height), local[0], local[1], opts);
        ch.dirty.height = true;
    }
}

fn finishSlope() void {
    if (g_slope_count == 0) return;
    var totalM: f32 = 0;
    var i: usize = 1;
    while (i < g_slope_count) : (i += 1) {
        const a = g_slope_points[i - 1];
        const b = g_slope_points[i];
        totalM += std.math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const runM = @max(DOT_M, totalM);
    if (g_slope_count == 1) {
        stampSlopeSegmentAt(g_slope_points[0], g_slope_points[0], 0, runM);
        return;
    }
    var distanceStartM: f32 = 0;
    i = 1;
    while (i < g_slope_count) : (i += 1) {
        const from = g_slope_points[i - 1];
        const to = g_slope_points[i];
        stampSlopeSegmentAt(from, to, distanceStartM, runM);
        distanceStartM += std.math.hypot(to[0] - from[0], to[1] - from[1]);
    }
}

fn stampSlopeSegmentAt(from: [2]f32, to: [2]f32, distanceStartM: f32, runM: f32) void {
    const key = seenKey(
        5,
        @intFromFloat(@round(from[0] / DOT_M) + @round(from[1] / DOT_M) * 65536),
        @intFromFloat(@round(to[0] / DOT_M) + @round(to[1] / DOT_M) * 65536),
        @intFromFloat(@round(distanceStartM * 4)),
        0,
    );
    if (!claimStamp(key)) return;
    g_stats.stamps += 1;

    const radiusM = @max(0.5, g_tool.radius_m);
    const rd = @max(1, @ceil(radiusM / DOT_M)) + 1;
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        const a = chunks.localSampleF(ch, from[0], from[1]);
        const b = chunks.localSampleF(ch, to[0], to[1]);
        const edge: f32 = @floatFromInt(chunks.SAMPLE_COLS - 1);
        if (@max(a[0], b[0]) + rd < 0 or @min(a[0], b[0]) - rd > edge or
            @max(a[1], b[1]) + rd < 0 or @min(a[1], b[1]) - rd > edge) continue;
        const wrote = stamps.stampSlopeSegment(fieldOf(&ch.height), a[0], a[1], b[0], b[1], .{
            .startZ = g_tool.ramp_min,
            .endZ = g_tool.ramp_max,
            .runM = runM,
            .distanceStartM = distanceStartM,
            .radiusM = radiusM,
            .profile = g_tool.profile,
        });
        if (wrote) ch.dirty.height = true;
    }
}

// ── cell channels: tile / flora / zone (global cell frame) ────────────────────

fn stampCellsAt(x: f32, z: f32) void {
    const gtx = chunks.globalTile(x);
    const gtz = chunks.globalTile(z);
    const erase = g_tool.mode == .erase;
    const r: i32 = @intFromFloat(@max(0, @round(g_tool.radius_m)));
    const reach = @as(f32, @floatFromInt(r)) + 0.5; // brush.ts forEachFootprintCell:22
    g_stats.stamps += 1;

    var dz: i32 = -r;
    while (dz <= r) : (dz += 1) {
        var dx: i32 = -r;
        while (dx <= r) : (dx += 1) {
            if (stamps.footprintDistance(g_tool.shape, @floatFromInt(dx), @floatFromInt(dz)) > reach) continue;
            paintGlobalCell(gtx + dx, gtz + dz, erase);
        }
    }
}

fn paintGlobalCell(gtx: i32, gtz: i32, erase: bool) void {
    const cx = chunks.chunkOfGlobalTile(gtx);
    const cz = chunks.chunkOfGlobalTile(gtz);
    const ch = chunks.chunkAt(cx, cz) orelse return; // paint only grown chunks
    const idx = chunks.cellIndex(gtx - cx * CHUNK_TILES, gtz - cz * CHUNK_TILES) orelse return;
    switch (g_tool.channel) {
        .tile => {
            // TODO(phase 5): road-owned cells become immutable to paint/erase
            // once the road recipe layer lands (USER RULING req_0795).
            ch.tiles[idx] = if (erase) chunks.EMPTY_CELL else g_tool.kind_idx;
            ch.dirty.tiles = true;
        },
        .flora => {
            const lane = @min(g_tool.flora_lane, chunks.FLORA_LAYER_COUNT - 1);
            ch.flora[lane][idx] = if (erase) chunks.EMPTY_CELL else g_tool.flora_kind_idx;
            ch.dirty.flora = true;
        },
        .zone => {
            ch.zones[idx] = if (erase) chunks.EMPTY_CELL else g_tool.zone_idx;
            ch.dirty.zones = true;
        },
        else => {},
    }
}

// ── terrain queries (the loader's picking + beam ground) ─────────────────────

/// Bilinear painted-terrain height at a world-meter point. 0 where no chunk
/// (unpainted ground is the y=0 plane). Border samples are duplicated across
/// neighbouring chunks with identical values, so either side answers alike.
pub fn heightAt(x: f32, z: f32) f32 {
    const half = chunks.CHUNK_METERS / 2;
    const sxf = (x + half) / DOT_M;
    const szf = (z + half) / DOT_M;
    const sx0: i32 = @intFromFloat(@floor(sxf));
    const sz0: i32 = @intFromFloat(@floor(szf));
    const fx = sxf - @floor(sxf);
    const fz = szf - @floor(szf);
    const h00 = sampleAtGlobal(sx0, sz0);
    const h10 = sampleAtGlobal(sx0 + 1, sz0);
    const h01 = sampleAtGlobal(sx0, sz0 + 1);
    const h11 = sampleAtGlobal(sx0 + 1, sz0 + 1);
    const top = h00 + (h10 - h00) * fx;
    const bot = h01 + (h11 - h01) * fx;
    return top + (bot - top) * fz;
}

fn sampleAtGlobal(gsx: i32, gsz: i32) f32 {
    const per: i32 = chunks.CHUNK_TILES * chunks.DOTS_PER_TILE; // 240 samples per chunk span
    const cx = @divFloor(gsx, per);
    const cz = @divFloor(gsz, per);
    const ch = chunks.chunkAt(cx, cz) orelse return 0;
    const lx: usize = @intCast(gsx - cx * per);
    const lz: usize = @intCast(gsz - cz * per);
    return ch.height[lz * chunks.SAMPLE_COLS + lx];
}

/// March a camera ray against the painted terrain (plane y=0 where unpainted).
/// Returns the world hit point, or null when the ray never comes down within
/// max_dist. Coarse 0.5 m steps + 8 bisection refinements — editor picking, not
/// physics.
pub fn groundHit(ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_dist: f32) ?[3]f32 {
    const STEP: f32 = 0.5;
    var t_prev: f32 = 0;
    var above_prev = oy - heightAt(ox, oz);
    if (above_prev <= 0) return .{ ox, oy, oz }; // camera already at/below ground
    var t: f32 = STEP;
    while (t <= max_dist) : (t += STEP) {
        const px = ox + dx * t;
        const py = oy + dy * t;
        const pz = oz + dz * t;
        const above = py - heightAt(px, pz);
        if (above <= 0) {
            // bisect [t_prev, t] to the crossing
            var lo = t_prev;
            var hi = t;
            var i: u8 = 0;
            while (i < 8) : (i += 1) {
                const mid = (lo + hi) / 2;
                const my = oy + dy * mid - heightAt(ox + dx * mid, oz + dz * mid);
                if (my > 0) lo = mid else hi = mid;
            }
            const th = (lo + hi) / 2;
            return .{ ox + dx * th, oy + dy * th, oz + dz * th };
        }
        t_prev = t;
        above_prev = above;
    }
    return null;
}

// ── the loader's floor mirror ─────────────────────────────────────────────────

/// Vertices per side of a chunk's render/collider mirror: one per tile + 1.
/// The brush field samples finer (2/tile) than the mirror needs; 121×121 also
/// fits the collider budget (game_physics HF_MAX_SAMPLES) and the dyn-vert
/// scratch, which the full 241×241 grid would overflow. Port of
/// cart/hmsc-int/chunkFloor.ts CHUNK_FLOOR_HF_RES + downsampleChunkFloorHeights.
pub const FLOOR_RES: usize = @as(usize, @intCast(chunks.CHUNK_TILES)) + 1; // 121
pub const FLOOR_CELLS: usize = FLOOR_RES * FLOOR_RES;

/// Downsample a chunk's 241×241 sample grid into a 121×121 mirror, taking the
/// ABS-MAX over each cell's window so thin ridges/pits survive the resample
/// (chunkFloor.ts:52). dst.len must be FLOOR_CELLS.
pub fn downsampleFloorHeights(src: *const [chunks.SAMPLE_CELLS]f32, dst: []f32) void {
    const cols = chunks.SAMPLE_COLS;
    const res = FLOOR_RES;
    const s = @as(f32, @floatFromInt(cols - 1)) / @as(f32, @floatFromInt(res - 1));
    const h: i32 = @max(1, @as(i32, @intFromFloat(@ceil(s / 2))));
    var j: usize = 0;
    while (j < res) : (j += 1) {
        const cyi: i32 = @intFromFloat(@round(@as(f32, @floatFromInt(j)) * s));
        var i: usize = 0;
        while (i < res) : (i += 1) {
            const cxi: i32 = @intFromFloat(@round(@as(f32, @floatFromInt(i)) * s));
            var best: f32 = 0;
            var dy: i32 = -h;
            while (dy <= h) : (dy += 1) {
                const yy = cyi + dy;
                if (yy < 0 or yy >= cols) continue;
                var dx: i32 = -h;
                while (dx <= h) : (dx += 1) {
                    const xx = cxi + dx;
                    if (xx < 0 or xx >= cols) continue;
                    const v = src[@as(usize, @intCast(yy)) * cols + @as(usize, @intCast(xx))];
                    if (@abs(v) > @abs(best)) best = v;
                }
            }
            dst[j * res + i] = best;
        }
    }
}

// ── the ground look (the tile/flora/zone channels' shader contract) ───────────
// The cell channels render through the per-fragment ground FORMULA (the
// data-shape ground): the cart supplies a WGSL body defining
// `fn hf_ground_rgb(uv) -> vec3f` that reads the D reference stream, and the
// engine encodes each chunk's D stream from its cell grids. Formula + palettes
// are CONTENT — pushed at UI rate, kept across map reset.
//
// D layout v2 (one PACKED cell array keeps three channels inside the ground
// pipeline's per-chunk float budget):
//   [0]cols [1]rows [2]tilePaletteCount [3]floraPaletteCount [4]zonePaletteCount
//   tilePal×3 rgb, floraPal×3 rgb, zonePal×3 rgb, then rows×cols packed cells.
// Packed cell (exact in f32 — 24 bits): (tile+1) + (flora+1)·1024 + (zone+1)·262144
//   tile+1 in [0,1024) · flora+1 in [0,256) · zone+1 in [0,64); 0 = empty slot.
// Flora is the COMPOSITE authoring tint of the three lanes (tree over bush over
// grass); the real populations materialize at Compile from the full lanes.

pub const MAX_PALETTE: usize = 256;
pub const PACK_TILE_LIMIT: i16 = 1022;
pub const PACK_FLORA_LIMIT: i16 = 254;
pub const PACK_ZONE_LIMIT: i16 = 62;

var g_ground_formula: ?[]u8 = null;
var g_palette: [MAX_PALETTE][3]f32 = undefined;
var g_palette_count: usize = 0;
var g_flora_palette: [MAX_PALETTE][3]f32 = undefined;
var g_flora_palette_count: usize = 0;
var g_zone_palette: [MAX_PALETTE][3]f32 = undefined;
var g_zone_palette_count: usize = 0;
const look_alloc = std.heap.page_allocator;

fn copyPalette(dst: *[MAX_PALETTE][3]f32, rgb: []const f32) usize {
    const count = @min(MAX_PALETTE, rgb.len / 3);
    for (0..count) |i| {
        dst[i] = .{ rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2] };
    }
    return count;
}

pub fn setGroundLook(formula: []const u8, tile_rgb: []const f32, flora_rgb: []const f32, zone_rgb: []const f32) void {
    // Consumers (the loader's painted-chunk nodes) hold the formula SLICE and
    // the GPU pipeline reads it every frame — so the allocation must stay put
    // whenever the content is unchanged (the common re-arm push), and a real
    // change must leave the old bytes to the loader's pointer-swap pass, never
    // free them under a live node (SIGSEGV req_2492: freed page, unmapped).
    const same = if (g_ground_formula) |old| std.mem.eql(u8, old, formula) else formula.len == 0;
    if (!same) {
        // Deliberately NOT freed: the loader re-points nodes on the next frame
        // by pointer identity; the superseded copy leaks (formula pushes are
        // rare content changes, not per-frame traffic).
        g_ground_formula = null;
        if (formula.len > 0) {
            const copy = look_alloc.alloc(u8, formula.len) catch return;
            @memcpy(copy, formula);
            g_ground_formula = copy;
        }
    }
    g_palette_count = copyPalette(&g_palette, tile_rgb);
    g_flora_palette_count = copyPalette(&g_flora_palette, flora_rgb);
    g_zone_palette_count = copyPalette(&g_zone_palette, zone_rgb);
}

/// Re-push just the zone palette (zones are user-authored and change mid-map).
pub fn setZonePalette(zone_rgb: []const f32) void {
    g_zone_palette_count = copyPalette(&g_zone_palette, zone_rgb);
}

pub fn groundFormula() ?[]const u8 {
    return g_ground_formula;
}

/// Floats one chunk's D stream needs at the current palettes.
pub fn groundDataFloats() usize {
    return 5 + (g_palette_count + g_flora_palette_count + g_zone_palette_count) * 3 + chunks.TILE_CELLS;
}

/// Composite flora lane tint for one cell: tree over bush over grass.
fn floraCompositeAt(chunk: *const chunks.Chunk, idx: usize) i16 {
    if (chunk.flora[1][idx] >= 0) return chunk.flora[1][idx]; // tree
    if (chunk.flora[2][idx] >= 0) return chunk.flora[2][idx]; // bush
    return chunk.flora[0][idx]; // grass (or empty)
}

/// Encode a chunk's cell channels as the ground formula's D stream (layout v2).
/// dst.len must be ≥ groundDataFloats(). Returns the floats written.
pub fn encodeGroundData(chunk: *const chunks.Chunk, dst: []f32) usize {
    dst[0] = @floatFromInt(chunks.TILE_COLS);
    dst[1] = @floatFromInt(chunks.TILE_COLS);
    dst[2] = @floatFromInt(g_palette_count);
    dst[3] = @floatFromInt(g_flora_palette_count);
    dst[4] = @floatFromInt(g_zone_palette_count);
    var n: usize = 5;
    for (g_palette[0..g_palette_count]) |rgb| {
        dst[n] = rgb[0];
        dst[n + 1] = rgb[1];
        dst[n + 2] = rgb[2];
        n += 3;
    }
    for (g_flora_palette[0..g_flora_palette_count]) |rgb| {
        dst[n] = rgb[0];
        dst[n + 1] = rgb[1];
        dst[n + 2] = rgb[2];
        n += 3;
    }
    for (g_zone_palette[0..g_zone_palette_count]) |rgb| {
        dst[n] = rgb[0];
        dst[n + 1] = rgb[1];
        dst[n + 2] = rgb[2];
        n += 3;
    }
    for (chunk.tiles, 0..) |tile, i| {
        const t: u32 = @intCast(@min(PACK_TILE_LIMIT, tile) + 1);
        const f: u32 = @intCast(@min(PACK_FLORA_LIMIT, floraCompositeAt(chunk, i)) + 1);
        const z: u32 = @intCast(@min(PACK_ZONE_LIMIT, chunk.zones[i]) + 1);
        dst[n] = @floatFromInt(t + f * 1024 + z * 262144);
        n += 1;
    }
    return n;
}

// ── roads: strokes compile to tile stamps with an UNDERCOAT ──────────────────
// ROADSTROKE-0610 semantics (PaintCanvas:1143): a road is a recipe (centerline
// + profile, roads.zig); stamping is DESTRUCTIVE into the chunk tile grids —
// the grid stays the single runtime truth — with an undercoat (cell → prior
// tile index) so editing/deleting a stroke restores the paint beneath. Any
// stroke change does a GLOBAL restamp (restore all, replan all, stamp all):
// junctions depend on every stroke, and road footprints are tiny next to the
// chunk grids.

const MAX_PLAN_CELLS: usize = 65536;
var g_plan_cells: [MAX_PLAN_CELLS]roads.PlanCell = undefined;
var g_road_under: std.AutoHashMapUnmanaged(u64, i16) = .empty;
var g_road_strokes_buf: [roads.MAX_STROKES]roads.RoadStroke = undefined;
/// LOUD truncation flag from the last restamp (surface it in chrome, never drop silently).
pub var road_plan_truncated: bool = false;

fn roadCellKey(gx: i32, gz: i32) u64 {
    return (@as(u64, @as(u32, @bitCast(gx))) << 32) | @as(u64, @as(u32, @bitCast(gz)));
}

fn tileAtGlobal(gx: i32, gz: i32) ?*i16 {
    const cx = chunks.chunkOfGlobalTile(gx);
    const cz = chunks.chunkOfGlobalTile(gz);
    const ch = chunks.chunkAt(cx, cz) orelse return null;
    const idx = chunks.cellIndex(gx - cx * CHUNK_TILES, gz - cz * CHUNK_TILES) orelse return null;
    ch.dirty.tiles = true;
    return &ch.tiles[idx];
}

/// Restore every undercoated cell, replan all strokes, stamp the plan, and
/// capture the fresh undercoat. Call after any stroke commit/delete.
pub fn roadsRestamp() void {
    // 1. restore the paint beneath the previous plan
    var it = g_road_under.iterator();
    while (it.next()) |entry| {
        const gx: i32 = @bitCast(@as(u32, @truncate(entry.key_ptr.* >> 32)));
        const gz: i32 = @bitCast(@as(u32, @truncate(entry.key_ptr.*)));
        if (tileAtGlobal(gx, gz)) |cell| cell.* = entry.value_ptr.*;
    }
    g_road_under.clearRetainingCapacity();

    // 2. replan every stroke
    const count = roads.collectStrokes(g_road_strokes_buf[0..]);
    const plan = roads.planRoads(g_road_strokes_buf[0..count], g_plan_cells[0..]);
    road_plan_truncated = plan.truncated;

    // 3. stamp, capturing the undercoat
    for (g_plan_cells[0..plan.count]) |pc| {
        const cell = tileAtGlobal(pc.gx, pc.gz) orelse continue;
        g_road_under.put(seen_alloc, roadCellKey(pc.gx, pc.gz), cell.*) catch continue;
        cell.* = roads.kindIndex(pc.kind);
    }
}

/// Commit the click-authored draft and restamp. Null = draft too short / table full.
pub fn roadCommit() ?u32 {
    const id = roads.commitDraft() orelse return null;
    roadsRestamp();
    return id;
}

pub fn roadCancel() void {
    roads.cancelDraft();
}

pub fn roadDelete(id: u32) bool {
    const ok = roads.deleteStroke(id);
    if (ok) roadsRestamp();
    return ok;
}

// ── flora specs (the population contract — req_2497) ─────────────────────────
// Flora KINDS are cart content; what the loader's live preview needs per kind is
// its population FAMILY + density: spec 0 grass blades, 1 bush clumps, 2 flower
// heads, 3 palms (trunk + frond crown). `count` = rows per painted cell (grass/
// bush/flowers); `chance` = per-cell spawn gate (palms — most cells stay bare,
// the palmPopulation.ts density rule). Pushed once at UI rate with the look.

pub const FloraSpec = struct {
    /// 0 grass · 1 bush · 2 flowers · 3 palm
    spec: u8,
    /// rows per painted cell (unused for palms — the crown sizes itself)
    count: u16,
    /// per-cell spawn chance 0..1 (1 = every painted cell grows)
    chance: f32,
};

var g_flora_specs: [MAX_PALETTE]FloraSpec = @splat(FloraSpec{ .spec = 0, .count = 0, .chance = 0 });
var g_flora_spec_count: usize = 0;

/// vals = per kind [spec, count, chance] triples, in flora legend order.
pub fn setFloraSpecs(vals: []const f32) void {
    g_flora_spec_count = @min(MAX_PALETTE, vals.len / 3);
    for (0..g_flora_spec_count) |i| {
        g_flora_specs[i] = .{
            .spec = @intFromFloat(@max(0, @min(3, vals[i * 3]))),
            .count = @intFromFloat(@max(0, @min(65535, vals[i * 3 + 1]))),
            .chance = @max(0, @min(1, vals[i * 3 + 2])),
        };
    }
}

/// The population spec for a painted flora kind; null = unknown kind or a spec
/// that never spawns (the live preview skips it).
pub fn floraSpec(kind: i16) ?FloraSpec {
    if (kind < 0 or kind >= g_flora_spec_count) return null;
    const s = g_flora_specs[@intCast(kind)];
    if (s.chance <= 0) return null;
    return s;
}

// ── persistence (store.zig: RLE blob of every channel + road recipes) ─────────

pub const store = @import("store.zig");

pub fn saveSizeUpperBound() usize {
    return store.saveSizeUpperBound();
}

/// Serialize the painting (roads resolved back to their undercoat base).
pub fn saveMap(dst: []u8) usize {
    return store.save(dst, &g_road_under);
}

/// Rebuild the painting from a save blob, then re-derive the road stamps
/// (grid = base + roads, req_0795). False on a malformed blob (world cleared).
pub fn loadMap(bytes: []const u8) bool {
    g_road_under.clearRetainingCapacity();
    const ok = store.load(bytes);
    if (ok) roadsRestamp();
    return ok;
}

// ── dirty bookkeeping ─────────────────────────────────────────────────────────

pub fn dirtyChunkCount() u32 {
    var n: u32 = 0;
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        if (ch.dirty.any()) n += 1;
    }
    return n;
}

pub fn clearDirty() void {
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        ch.dirty = .{};
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

test "heightAt bilinear-samples painted terrain, 0 off-chunk" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 4, .center_z = 6, .profile = .flat });
    strokeBegin(0, 0);
    _ = strokeEnd();
    try std.testing.expectApproxEqAbs(@as(f32, 6), heightAt(0, 0), 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 0), heightAt(50, 50), 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 0), heightAt(500, 0), 0.0001); // no chunk there
}

test "groundHit lands a top-down ray on the sculpted cap" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 4, .center_z = 6, .profile = .flat });
    strokeBegin(10, 10);
    _ = strokeEnd();

    // iso-style ray from above, angled onto the hill at (10,10)
    const hit = groundHit(10, 50, 40, 0, -0.8, -0.6, 200).?;
    try std.testing.expectApproxEqAbs(@as(f32, 10), hit[0], 0.6);
    try std.testing.expectApproxEqAbs(@as(f32, 6), hit[1], 0.6);
    // a ray that never comes down misses
    try std.testing.expect(groundHit(0, 10, 0, 0, 1, 0, 100) == null);
    // flat unpainted ground still hits the y=0 plane
    const flat = groundHit(40, 20, 40, 0, -1, 0, 100).?;
    try std.testing.expectApproxEqAbs(@as(f32, 0), flat[1], 0.1);
}

test "downsampleFloorHeights keeps ridge peaks through the resample" {
    reset();
    defer reset();
    const ch = chunks.growChunk(0, 0).?;
    // a one-sample spike that naive stride-sampling at odd offsets would drop
    ch.height[100 * chunks.SAMPLE_COLS + 101] = 9;
    var floor: [FLOOR_CELLS]f32 = undefined;
    downsampleFloorHeights(&ch.height, floor[0..]);
    var peak: f32 = 0;
    for (floor) |v| peak = @max(peak, v);
    try std.testing.expectApproxEqAbs(@as(f32, 9), peak, 0.0001);
}

test "height stroke stamps seam-free across the shared border" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    _ = chunks.growChunk(1, 0).?;

    setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 3, .center_z = 5, .profile = .flat });
    strokeBegin(60, 0); // dead on the chunk 0/1 border
    const stats = strokeEnd();
    try std.testing.expect(stats.touched == 2);

    const c0 = chunks.chunkAt(0, 0).?;
    const c1 = chunks.chunkAt(1, 0).?;
    // x=60, z=0: chunk 0's sample (240, 120); chunk 1's sample (0, 120)
    const border0 = c0.height[120 * chunks.SAMPLE_COLS + 240];
    const border1 = c1.height[120 * chunks.SAMPLE_COLS + 0];
    try std.testing.expectApproxEqAbs(@as(f32, 5), border0, 0.0001);
    try std.testing.expectApproxEqAbs(border0, border1, 0.0001); // the seam-free invariant
    try std.testing.expect(c0.dirty.height and c1.dirty.height);
}

test "stroke interpolation fills a fast drag without gaps" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    setTool(.{ .channel = .tile, .radius_m = 1, .kind_idx = 3 });

    strokeBegin(-50, 0);
    strokeMove(50, 0); // one event leaping 100 m
    _ = strokeEnd();

    const ch = chunks.chunkAt(0, 0).?;
    // every tile along z=60 (local row) between the endpoints is painted
    var gap = false;
    var gtx: i32 = chunks.globalTile(-50);
    const last = chunks.globalTile(50);
    while (gtx <= last) : (gtx += 1) {
        const idx = chunks.cellIndex(gtx, 60).?;
        if (ch.tiles[idx] != 3) gap = true;
    }
    try std.testing.expect(!gap);
    try std.testing.expect(ch.dirty.tiles);
}

test "water fills only carved basins and flags dry strokes" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;

    // dry stroke first: flat terrain has no basin
    setTool(.{ .channel = .water, .radius_m = 2 });
    strokeBegin(0, 0);
    var stats = strokeEnd();
    try std.testing.expect(stats.water_dry);

    // carve a pit, then water fills depth = -bed
    setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 3, .center_z = -4, .profile = .flat });
    strokeBegin(0, 0);
    _ = strokeEnd();
    setTool(.{ .channel = .water, .radius_m = 3 });
    strokeBegin(0, 0);
    stats = strokeEnd();
    try std.testing.expect(!stats.water_dry);

    const ch = chunks.chunkAt(0, 0).?;
    const center = 120 * chunks.SAMPLE_COLS + 120;
    try std.testing.expectApproxEqAbs(@as(f32, 4), ch.water[center], 0.0001);
    // erase drains without touching terrain
    setTool(.{ .channel = .water, .mode = .erase, .radius_m = 3 });
    strokeBegin(0, 0);
    _ = strokeEnd();
    try std.testing.expectApproxEqAbs(@as(f32, 0), ch.water[center], 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, -4), ch.height[center], 0.0001);
}

test "ramp drag stamps the lerped grade between anchor and release" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    setTool(.{ .channel = .terrain, .terrain_tool = .ramp, .ramp_min = 0, .ramp_max = 8, .ramp_wide = 4 });

    strokeBegin(0.2, 0.2); // anchors to cell center (0.5, 0.5)
    strokeMove(0.5, 20.5); // drag 20 m north
    _ = strokeEnd();

    const ch = chunks.chunkAt(0, 0).?;
    // the midpoint of the ramp carries the mid height
    const mid = chunks.localSampleF(ch, 0.5, 10.5);
    const mid_z = ch.height[@as(usize, @intFromFloat(@round(mid[1]))) * chunks.SAMPLE_COLS + @as(usize, @intFromFloat(@round(mid[0])))];
    try std.testing.expectApproxEqAbs(@as(f32, 4), mid_z, 0.25);
    try std.testing.expect(ch.dirty.height);
}

test "slope stroke grades along the drawn path at stroke end" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    setTool(.{ .channel = .terrain, .terrain_tool = .slope, .radius_m = 1, .ramp_min = 0, .ramp_max = 10, .profile = .flat });

    strokeBegin(-20, 0);
    strokeMove(0, 0);
    strokeMove(20, 0); // 40 m total run
    _ = strokeEnd();

    const ch = chunks.chunkAt(0, 0).?;
    const row: usize = 120;
    const at = struct {
        fn z(c: *chunks.Chunk, r: usize, x: f32) f32 {
            const s: usize = @intFromFloat(@round((x + 60) / DOT_M));
            return c.height[r * chunks.SAMPLE_COLS + s];
        }
    };
    try std.testing.expectApproxEqAbs(@as(f32, 0), at.z(ch, row, -20), 0.05);
    try std.testing.expectApproxEqAbs(@as(f32, 5), at.z(ch, row, 0), 0.3);
    try std.testing.expectApproxEqAbs(@as(f32, 10), at.z(ch, row, 20), 0.3);
}

test "smooth eases spikes toward the local plane" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    const ch = chunks.chunkAt(0, 0).?;
    // one spike in otherwise flat ground
    const spike = 120 * chunks.SAMPLE_COLS + 120;
    ch.height[spike] = 10;

    setTool(.{ .channel = .terrain, .terrain_tool = .smooth, .radius_m = 3, .smooth_strength = 1, .profile = .flat });
    strokeBegin(0, 0);
    _ = strokeEnd();
    // the spike collapses toward the (near-flat) fitted plane
    try std.testing.expect(ch.height[spike] < 1.0);
}

test "flora paints its lane; zone paints membership; erase clears" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    const ch = chunks.chunkAt(0, 0).?;

    setTool(.{ .channel = .flora, .radius_m = 0, .flora_kind_idx = 5, .flora_lane = 1 });
    strokeBegin(0, 0);
    _ = strokeEnd();
    const idx = chunks.cellIndex(60, 60).?;
    try std.testing.expectEqual(@as(i16, 5), ch.flora[1][idx]);
    try std.testing.expectEqual(chunks.EMPTY_CELL, ch.flora[0][idx]);

    setTool(.{ .channel = .zone, .radius_m = 0, .zone_idx = 2 });
    strokeBegin(0, 0);
    _ = strokeEnd();
    try std.testing.expectEqual(@as(i16, 2), ch.zones[idx]);

    setTool(.{ .channel = .zone, .mode = .erase, .radius_m = 0 });
    strokeBegin(0, 0);
    _ = strokeEnd();
    try std.testing.expectEqual(chunks.EMPTY_CELL, ch.zones[idx]);
}

test "stationary height brush deposits once per stroke (global dedup)" {
    reset();
    defer reset();
    _ = chunks.growChunk(0, 0).?;
    setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 2, .center_z = 3 });
    strokeBegin(0, 0);
    strokeMove(0.01, 0.01);
    strokeMove(0.02, 0.0);
    const stats = strokeEnd();
    try std.testing.expectEqual(@as(u32, 1), stats.stamps);
}

test "road clicks draft, commit stamps with undercoat, delete restores" {
    reset();
    defer reset();
    const ch = chunks.growChunk(0, 0).?;
    // pre-paint the ground so the undercoat has something to restore
    setTool(.{ .channel = .tile, .radius_m = 40, .kind_idx = 7 });
    strokeBegin(0, 0);
    _ = strokeEnd();

    // map road cell kinds to content indices (RoadCellKind order)
    roads.setKindIndices(.{ 10, 11, 12, 13, 14, 15, 16, 17 });
    setRoadProfile(.{ .lanesF = 1, .lanesB = 1, .sidewalks = true });
    setTool(.{ .channel = .road });
    // two clicks: a straight vertical road through the chunk center
    strokeBegin(0, -20);
    _ = strokeEnd();
    strokeBegin(0, 20);
    _ = strokeEnd();
    const id = roadCommit().?;
    try std.testing.expect(!road_plan_truncated);

    // the centerline cell wears a road kind, not the pre-paint
    const mid = chunks.cellIndex(60, 60).?;
    const stamped = ch.tiles[mid];
    try std.testing.expect(stamped >= 10 and stamped <= 17);
    try std.testing.expect(ch.dirty.tiles);

    // delete restores the paint beneath
    try std.testing.expect(roadDelete(id));
    try std.testing.expectEqual(@as(i16, 7), ch.tiles[mid]);
    try std.testing.expectEqual(@as(usize, 0), roads.strokeCount());
}
