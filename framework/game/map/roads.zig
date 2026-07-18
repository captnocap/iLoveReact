// game/map/roads — ROAD STROKES: the authored road objects and the pure planner
// that compiles them to tile-kind stamps, ported VERBATIM from the TypeScript at
// cart/hmsc-int/roadData.ts (ROADSTROKE-0610; USER ASK req_2473).
//
// A road is authored as a STROKE — a centerline polyline + a cross-section
// profile — never tile by tile. Everything the locked grammar needs derives
// from the stroke (roadData.ts:1-29): lane DIRECTION falls out of draw order;
// lane WIDTH is the user-ruled 3 tiles; a two-way road adds a 1-tile median;
// sidewalks add 2 tiles per side; RIGHT-HAND traffic (forward lanes right of
// the centerline); JUNCTIONS are derived where carriageways CROSS (2-deep
// crosswalk bands outside the box); one-way roads centre on the stroke.
//
// PORT DISCIPLINE: tuning values and control flow mirror the TS 1:1 (file:line
// cites throughout) so the native planner stamps the exact grid the JS painter
// did. planRoads stays PURE — strokes in, cells out — testable with zero editor
// or GPU machinery.
//
// The grammar is CONTENT-FREE: it emits RoadCellKind (semantic names); the
// consumer maps them to tile-legend indices via setKindIndices.
//
// COORDINATES: every public fn works in the transport GLOBAL METRE frame.
// Authored RoadPoint gx/gz values snap to 25 cm; the gameplay compiler rounds
// only while rasterizing into global cells. The caller translates to/from the
// map engine's centered world frame.
//
// TODO(later slices): intersections.ts (junction controls + generated props,
// stable ids + pose overrides) and roadGrade.ts (road earthworks) ride the
// intersections pass, not this compiler. Editor display/gesture helpers
// (strokeChevrons, laneGuides, laneFlowArrows, strokeWireFlip, merge gesture,
// splitStroke, speed-along-route) stay cart-side until the road chrome needs
// them natively — the tile PLAN never depends on them.

const std = @import("std");
const transport = @import("transport.zig");

// ── the ruled constants (roadData.ts:74-88) ───────────────────────────────────

/// USER-RULED 2026-06-10: a driving lane is 3 tiles wide.
pub const LANE_TILES: i32 = 3;
/// The locked sidewalk ring is 2 tiles.
pub const SIDEWALK_TILES: i32 = 2;
/// The zebra band reaches 2 cells into each leg, just outside the junction box.
pub const CROSSWALK_DEPTH: usize = 2;
pub const MAX_LANES_PER_SIDE: i32 = 3;
/// Legacy saves predate authored curve reach and keep their original 5 m turn.
pub const ROAD_FILLET_TILES: f32 = transport.TUNING.legacy_road_curve_radius_m;

/// Speed presets (ROADSPEED-0610, roadData.ts:86-88).
pub const ROAD_SPEED_CITY_KPH: f32 = 50;
pub const ROAD_SPEED_RURAL_KPH: f32 = 90;
pub const SPEED_LIMIT_MIN_KPH: f32 = 10;
pub const SPEED_LIMIT_MAX_KPH: f32 = 130;

// ── the authored objects (roadData.ts:35-63) ──────────────────────────────────

pub const RoadProfile = transport.RoadProfile;

/// Global metre coords in the 1 m grid frame. Authored points snap to the
/// transport substrate; fillet output is fractional along the curve.
pub const RoadPoint = transport.Point;

pub const RoadStroke = struct {
    id: u32,
    points: []const RoadPoint,
    profile: RoadProfile,
    curve_radius_m: f32 = ROAD_FILLET_TILES,
};

/// Travel direction INTO a junction box, snapped to the dominant world axis
/// (roadData.ts:69).
pub const ApproachDir = enum(u8) { posX, negX, posZ, negZ };
/// The four box edges, named by the world side they face (roadData.ts:72).
pub const JunctionSide = enum(u8) { N, E, S, W };

// ── profile math (roadData.ts:90-122) ─────────────────────────────────────────

pub fn clampProfile(p: RoadProfile) RoadProfile {
    return transport.clampRoadProfile(p);
}

/// The clamped limit in m/s — what motion planning consumes (ts:105).
pub fn speedLimitMps(p: RoadProfile) f32 {
    return clampProfile(p).speedLimitKph / 3.6;
}

pub fn isOneWay(p: RoadProfile) bool {
    return p.lanesF == 0 or p.lanesB == 0;
}

/// Carriageway width in tiles (lanes + median; no sidewalks) (ts:114).
pub fn carriagewayTiles(p: RoadProfile) i32 {
    const median: i32 = if (p.lanesF > 0 and p.lanesB > 0) 1 else 0;
    return LANE_TILES * (p.lanesF + p.lanesB) + median;
}

/// Full stamped width in tiles, curb to curb including sidewalks (ts:120).
pub fn roadWidthTiles(p: RoadProfile) i32 {
    return carriagewayTiles(p) + (if (p.sidewalks) 2 * SIDEWALK_TILES else 0);
}

// ── analytic render ribbon ───────────────────────────────────────────────────
// The gameplay stamp stays a one-metre raster. The visible road is the authored
// filleted curve: these compact rows let the chunk ground shader evaluate a
// continuous distance field for asphalt, markings, and sidewalks.

pub const RIBBON_SEGMENT_FLOATS: usize = 11;
pub const MAX_RIBBON_SEGMENTS_PER_CHUNK: usize = 160;
pub const RIBBON_FILTER_MARGIN_M: f32 = 1.5;

pub const RibbonExtents = struct {
    right_road_m: f32,
    left_road_m: f32,
    right_full_m: f32,
    left_full_m: f32,
    two_way: bool,
    /// First absolute white-divider distance from the centerline. Repeats at
    /// LANE_TILES; an outer-edge check suppresses the final carriageway edge.
    divider_phase_m: f32,
};

pub fn ribbonExtents(profile: RoadProfile) RibbonExtents {
    const p = clampProfile(profile);
    var right_road_m: f32 = undefined;
    var left_road_m: f32 = undefined;
    var phase_m: f32 = undefined;
    const two_way = p.lanesF > 0 and p.lanesB > 0;
    if (two_way) {
        right_road_m = 0.5 + @as(f32, @floatFromInt(LANE_TILES * p.lanesF));
        left_road_m = 0.5 + @as(f32, @floatFromInt(LANE_TILES * p.lanesB));
        phase_m = 0.5 + @as(f32, @floatFromInt(LANE_TILES));
    } else {
        const lanes = @max(p.lanesF, p.lanesB);
        right_road_m = @as(f32, @floatFromInt(LANE_TILES * lanes)) * 0.5;
        left_road_m = right_road_m;
        phase_m = if (@mod(lanes, 2) == 1) @as(f32, @floatFromInt(LANE_TILES)) * 0.5 else 0;
    }
    const walk_m: f32 = if (p.sidewalks) @floatFromInt(SIDEWALK_TILES) else 0;
    return .{
        .right_road_m = right_road_m,
        .left_road_m = left_road_m,
        .right_full_m = right_road_m + walk_m,
        .left_full_m = left_road_m + walk_m,
        .two_way = two_way,
        .divider_phase_m = phase_m,
    };
}

pub const RibbonSegment = struct {
    ax: f32,
    az: f32,
    bx: f32,
    bz: f32,
    right_road_m: f32,
    left_road_m: f32,
    right_full_m: f32,
    left_full_m: f32,
    two_way: f32,
    divider_phase_m: f32,
    arc_start_m: f32,
};

pub const RibbonResult = struct { count: usize, truncated: bool };

/// Compile committed road recipes to chunk-local analytic rows. Arc distance is
/// accumulated before chunk filtering, so dash cadence remains continuous when
/// a path crosses a chunk boundary or a filleted corner.
pub fn ribbonSegmentsForChunk(
    strokes: []const RoadStroke,
    chunk_cx: i32,
    chunk_cz: i32,
    chunk_tiles: i32,
    out: []RibbonSegment,
) RibbonResult {
    const origin_x = @as(f32, @floatFromInt(chunk_cx * chunk_tiles));
    const origin_z = @as(f32, @floatFromInt(chunk_cz * chunk_tiles));
    const span: f32 = @floatFromInt(chunk_tiles);
    var count: usize = 0;
    for (strokes) |stroke| {
        if (stroke.points.len < 2) continue;
        const ext = ribbonExtents(stroke.profile);
        const reach = @max(ext.right_full_m, ext.left_full_m) + RIBBON_FILTER_MARGIN_M;
        var curve: [MAX_FILLETED_POINTS]RoadPoint = undefined;
        const curve_count = filletPoints(stroke.points, stroke.curve_radius_m, curve[0..]);
        var arc_start_m: f32 = 0;
        var i: usize = 0;
        while (i + 1 < curve_count) : (i += 1) {
            const ax = curve[i].gx - origin_x;
            const az = curve[i].gz - origin_z;
            const bx = curve[i + 1].gx - origin_x;
            const bz = curve[i + 1].gz - origin_z;
            const dx = bx - ax;
            const dz = bz - az;
            const segment_m = @sqrt(dx * dx + dz * dz);
            const touches = @max(ax, bx) >= -reach and @min(ax, bx) <= span + reach and
                @max(az, bz) >= -reach and @min(az, bz) <= span + reach;
            if (touches and segment_m > 0.0001) {
                if (count >= out.len) return .{ .count = count, .truncated = true };
                out[count] = .{
                    .ax = ax,
                    .az = az,
                    .bx = bx,
                    .bz = bz,
                    .right_road_m = ext.right_road_m,
                    .left_road_m = ext.left_road_m,
                    .right_full_m = ext.right_full_m,
                    .left_full_m = ext.left_full_m,
                    .two_way = if (ext.two_way) 1 else 0,
                    .divider_phase_m = ext.divider_phase_m,
                    .arc_start_m = arc_start_m,
                };
                count += 1;
            }
            arc_start_m += segment_m;
        }
    }
    return .{ .count = count, .truncated = false };
}

// ── the output vocabulary ─────────────────────────────────────────────────────

/// The semantic tile kinds the planner emits (the TS emitted TileKind names;
/// the grammar stays content-free — map to legend indices via setKindIndices).
pub const RoadCellKind = enum(u8) {
    laneNorth,
    laneSouth,
    laneEast,
    laneWest,
    median,
    sidewalk,
    junction,
    crosswalk,
};

pub const ROAD_CELL_KIND_COUNT: usize = @typeInfo(RoadCellKind).@"enum".fields.len;

/// Render-only lane-paint recipe carried beside the gameplay tile kind. The
/// tile kind continues to own flow/pathing; these flags are DERIVED from the
/// road stroke's 3 m cross-section and never become another authored grid.
///
/// Low/high name the transverse edge in world-coordinate order after the
/// renderer rotates UVs so x crosses the road and y runs along it. One byte is
/// enough for the current grammar and leaves bit 7 available for a later
/// turn/exit stencil without changing the ground-stream contract.
pub const RoadMarking = struct {
    pub const axis_x: u8 = 1 << 0;
    pub const yellow_center: u8 = 1 << 1;
    pub const white_dash_low: u8 = 1 << 2;
    pub const white_dash_high: u8 = 1 << 3;
    pub const white_solid_low: u8 = 1 << 4;
    pub const white_solid_high: u8 = 1 << 5;
    pub const crosswalk: u8 = 1 << 6;
};

var g_kind_indices: [ROAD_CELL_KIND_COUNT]i16 = @splat(-1);

/// Map each RoadCellKind → the content tile-legend index the consumer stamps.
pub fn setKindIndices(indices: [ROAD_CELL_KIND_COUNT]i16) void {
    g_kind_indices = indices;
}

pub fn kindIndex(kind: RoadCellKind) i16 {
    return g_kind_indices[@intFromEnum(kind)];
}

// ── cell keys + compass (roadData.ts:126-163) ─────────────────────────────────

fn cellKeyOf(gx: i32, gz: i32) u64 {
    return (@as(u64, @as(u32, @bitCast(gx))) << 32) | @as(u64, @as(u32, @bitCast(gz)));
}

fn cellOfKey(key: u64) [2]i32 {
    return .{ @bitCast(@as(u32, @truncate(key >> 32))), @bitCast(@as(u32, @truncate(key))) };
}

/// Compass step in cell space (+z south; north = -z, the hmsc facing convention).
const Dir = struct { dx: i32, dz: i32 };

fn laneKindFor(dir: Dir) RoadCellKind {
    if (dir.dx > 0) return .laneEast;
    if (dir.dx < 0) return .laneWest;
    if (dir.dz > 0) return .laneSouth;
    return .laneNorth;
}

/// Quantize a segment to its dominant compass axis (ts:148). Diagonals
/// staircase cell-wise but their lanes flow the dominant direction.
fn segmentDir(a: RoadPoint, b: RoadPoint) ?Dir {
    const dx = b.gx - a.gx;
    const dz = b.gz - a.gz;
    if (dx == 0 and dz == 0) return null;
    if (@abs(dx) >= @abs(dz)) return .{ .dx = signOf(dx), .dz = 0 };
    return .{ .dx = 0, .dz = signOf(dz) };
}

fn signOf(v: f32) i32 {
    if (v > 0) return 1;
    if (v < 0) return -1;
    return 0;
}

/// The RIGHT of travel in cell space (ts:158): east (1,0) → south (0,1).
fn rightOf(dir: Dir) Dir {
    return .{ .dx = -dir.dz, .dz = dir.dx };
}

const CenterCell = struct { gx: i32, gz: i32, dir: Dir };

// ── corner fillets (ROADCURVE-0610, roadData.ts:173-199) ──────────────────────

/// Every interior vertex becomes a quadratic-bezier arc (radius clamped to 45%
/// of its shorter neighbour segment). Writes into `out`; returns the count.
/// out.len must cover the worst case: 2 + (points-2)·(max(4,ceil(r·1.5))+1).
pub fn filletPoints(points: []const RoadPoint, radius: f32, out: []RoadPoint) usize {
    return transport.curvePoints(points, radius, out);
}

pub const MAX_FILLETED_POINTS: usize = transport.MAX_CURVE_POINTS;

// ── centerline rasterization (roadData.ts:203-223) ────────────────────────────

/// Ordered, deduped centerline cells; quarter-cell sampling guarantees
/// 8-connected coverage on any diagonal. Arena-allocated.
fn rasterizeCenterline(arena: std.mem.Allocator, points: []const RoadPoint) ![]CenterCell {
    var out: std.ArrayListUnmanaged(CenterCell) = .empty;
    var seen: std.AutoHashMapUnmanaged(u64, void) = .empty;
    var i: usize = 0;
    while (i + 1 < points.len) : (i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const dir = segmentDir(a, b) orelse continue;
        const span = @max(@abs(b.gx - a.gx), @abs(b.gz - a.gz));
        const steps: usize = @max(1, @as(usize, @ceil(span * 4)));
        var s: usize = 0;
        while (s <= steps) : (s += 1) {
            const t = @as(f32, @floatFromInt(s)) / @as(f32, @floatFromInt(@max(1, steps)));
            const gx: i32 = @round(a.gx + (b.gx - a.gx) * t);
            const gz: i32 = @round(a.gz + (b.gz - a.gz) * t);
            const key = cellKeyOf(gx, gz);
            const gop = try seen.getOrPut(arena, key);
            if (gop.found_existing) continue;
            try out.append(arena, .{ .gx = gx, .gz = gz, .dir = dir });
        }
    }
    return out.items;
}

// ── the cross-section (roadData.ts:228-262) ───────────────────────────────────

const ColKind = enum(u8) { median, forward, backward };
const Col = struct { off: i32, kind: ColKind };

/// carriage max: 3 lanes × 3 tiles × 2 sides + median = 19; walk max 4.
pub const CrossSection = struct {
    carriage: [19]Col = undefined,
    carriage_count: usize = 0,
    walk: [4]i32 = undefined,
    walk_count: usize = 0,
};

pub fn crossSection(profile: RoadProfile) CrossSection {
    const p = clampProfile(profile);
    var xs = CrossSection{};
    var left: i32 = undefined;
    var right: i32 = undefined;
    if (p.lanesF > 0 and p.lanesB > 0) {
        // two-way: median on the stroke, forward group right, opposing left (ts:239)
        xs.carriage[xs.carriage_count] = .{ .off = 0, .kind = .median };
        xs.carriage_count += 1;
        right = LANE_TILES * p.lanesF;
        left = -LANE_TILES * p.lanesB;
        var o: i32 = 1;
        while (o <= right) : (o += 1) {
            xs.carriage[xs.carriage_count] = .{ .off = o, .kind = .forward };
            xs.carriage_count += 1;
        }
        o = -1;
        while (o >= left) : (o -= 1) {
            xs.carriage[xs.carriage_count] = .{ .off = o, .kind = .backward };
            xs.carriage_count += 1;
        }
    } else {
        // one-way: no median; centre the whole carriageway on the stroke (ts:247)
        const kind: ColKind = if (p.lanesF > 0) .forward else .backward;
        const w = LANE_TILES * @max(p.lanesF, p.lanesB);
        left = -@divFloor(w - 1, 2);
        right = left + w - 1;
        var o = left;
        while (o <= right) : (o += 1) {
            xs.carriage[xs.carriage_count] = .{ .off = o, .kind = kind };
            xs.carriage_count += 1;
        }
    }
    if (p.sidewalks) {
        var s: i32 = 1;
        while (s <= SIDEWALK_TILES) : (s += 1) {
            xs.walk[xs.walk_count] = right + s;
            xs.walk_count += 1;
            xs.walk[xs.walk_count] = left - s;
            xs.walk_count += 1;
        }
    }
    return xs;
}

// ── per-stroke rasterization (roadData.ts:270-328) ────────────────────────────
// Travel-axis bits per carriageway cell — the junction discriminator: a
// junction needs CROSSING traffic; parallel overlap must read as ONE road.

const AXIS_X: u8 = 1;
const AXIS_Z: u8 = 2;

const StrokeRaster = struct {
    stroke: RoadStroke,
    center: []CenterCell,
    /// cell → kind; closest-to-centerline column wins so corners stay clean
    carriage: std.AutoHashMapUnmanaged(u64, RoadCellKind),
    /// cell → derived paint flags for the same winning cross-section column
    markings: std.AutoHashMapUnmanaged(u64, u8),
    walk: std.AutoHashMapUnmanaged(u64, void),
    /// cell → |offset| that produced it (the corner tiebreak)
    rank: std.AutoHashMapUnmanaged(u64, i32),
    /// cell → travel-axis bits (AXIS_X / AXIS_Z) along this stroke
    axes: std.AutoHashMapUnmanaged(u64, u8),
};

fn axisMarking(dir: Dir) u8 {
    return if (dir.dx != 0) RoadMarking.axis_x else 0;
}

const EdgePaint = enum { dash, solid };

/// Flag the physical edge reached by stepping `offset_sign` along rightOf(dir).
/// The shader's transverse x is world Z for east/west roads and world X for
/// north/south roads, so this conversion keeps curves and reversed strokes from
/// silently swapping their left/right paint.
fn edgeMarking(dir: Dir, offset_sign: i32, paint: EdgePaint) u8 {
    const rt = rightOf(dir);
    const transverse_delta = if (dir.dx != 0) rt.dz * offset_sign else rt.dx * offset_sign;
    const high = transverse_delta > 0;
    return switch (paint) {
        .dash => if (high) RoadMarking.white_dash_high else RoadMarking.white_dash_low,
        .solid => if (high) RoadMarking.white_solid_high else RoadMarking.white_solid_low,
    };
}

/// Paint for one cross-section column. A lane is exactly LANE_TILES (3 m):
/// internal 3 m boundaries are dashed, the two carriageway shoulders are
/// solid, and the one-cell opposing-flow separator carries the yellow center.
fn columnMarking(profile: RoadProfile, col: Col, dir: Dir) u8 {
    const p = clampProfile(profile);
    var flags = axisMarking(dir);
    if (col.kind == .median) return flags | RoadMarking.yellow_center;

    if (p.lanesF > 0 and p.lanesB > 0) {
        const magnitude = @abs(col.off);
        const group_width = if (col.off > 0) LANE_TILES * p.lanesF else LANE_TILES * p.lanesB;
        if (magnitude == group_width) {
            flags |= edgeMarking(dir, signOf(@as(f32, @floatFromInt(col.off))), .solid);
        } else if (@mod(magnitude, LANE_TILES) == 0) {
            flags |= edgeMarking(dir, signOf(@as(f32, @floatFromInt(col.off))), .dash);
        }
        return flags;
    }

    // One-way roads are centred on the stroke. Group the continuous ribbon
    // from its low offset so every lane remains 3 m even when the width is even.
    const width = LANE_TILES * @max(p.lanesF, p.lanesB);
    const left = -@divFloor(width - 1, 2);
    const right = left + width - 1;
    if (col.off == left) flags |= edgeMarking(dir, -1, .solid);
    if (col.off == right) flags |= edgeMarking(dir, 1, .solid);
    if (col.off < right and @mod(col.off - left + 1, LANE_TILES) == 0) {
        flags |= edgeMarking(dir, 1, .dash);
    }
    return flags;
}

var g_fillet_scratch: [MAX_FILLETED_POINTS]RoadPoint = undefined;

fn rasterizeStroke(arena: std.mem.Allocator, stroke: RoadStroke) !StrokeRaster {
    const profile = clampProfile(stroke.profile);
    const xs = crossSection(profile);
    // stamp the FILLETED polyline — corners rasterize as arcs (ts:290)
    const fcount = filletPoints(stroke.points, stroke.curve_radius_m, g_fillet_scratch[0..]);
    const center = try rasterizeCenterline(arena, g_fillet_scratch[0..fcount]);
    var r = StrokeRaster{
        .stroke = stroke,
        .center = center,
        .carriage = .empty,
        .markings = .empty,
        .walk = .empty,
        .rank = .empty,
        .axes = .empty,
    };

    for (center) |c| {
        const rt = rightOf(c.dir);
        const axis: u8 = if (c.dir.dx != 0) AXIS_X else AXIS_Z;
        for (xs.carriage[0..xs.carriage_count]) |col| {
            const gx = c.gx + rt.dx * col.off;
            const gz = c.gz + rt.dz * col.off;
            const key = cellKeyOf(gx, gz);
            const axes_gop = try r.axes.getOrPut(arena, key);
            if (!axes_gop.found_existing) axes_gop.value_ptr.* = 0;
            axes_gop.value_ptr.* |= axis;
            const score: i32 = @intCast(@abs(col.off));
            if (r.rank.get(key)) |prev| {
                if (prev <= score) continue;
            }
            try r.rank.put(arena, key, score);
            const kind: RoadCellKind = switch (col.kind) {
                .median => .median,
                .forward => laneKindFor(c.dir),
                .backward => laneKindFor(.{ .dx = -c.dir.dx, .dz = -c.dir.dz }),
            };
            try r.carriage.put(arena, key, kind);
            try r.markings.put(arena, key, columnMarking(profile, col, c.dir));
            _ = r.walk.remove(key); // carriageway beats this stroke's own sidewalk
        }
        for (xs.walk[0..xs.walk_count]) |off| {
            const gx = c.gx + rt.dx * off;
            const gz = c.gz + rt.dz * off;
            const key = cellKeyOf(gx, gz);
            if (r.carriage.contains(key)) continue;
            const score: i32 = @intCast(@abs(off));
            if (r.rank.get(key)) |prev| {
                if (prev <= score) continue;
            }
            try r.rank.put(arena, key, score);
            try r.walk.put(arena, key, {});
        }
    }
    return r;
}

// ── the plan (roadData.ts:335-406) ────────────────────────────────────────────

pub const PlanCell = struct {
    gx: i32,
    gz: i32,
    kind: RoadCellKind,
    markings: u8,
};

const PlanValue = struct { kind: RoadCellKind, markings: u8 };

pub const PlanResult = struct {
    count: usize,
    /// out was too small — the plan is INCOMPLETE. Callers must treat this as
    /// an error state (log LOUDLY / grow the buffer), never as a full plan.
    truncated: bool,
};

/// Cells the road network reads as junction: ≥2 carriageways whose travel axes
/// CROSS (ts:392). Shared by planRoads' stamp and deriveJunctions.
fn junctionCells(arena: std.mem.Allocator, rasters: []StrokeRaster) !std.AutoHashMapUnmanaged(u64, void) {
    var cover: std.AutoHashMapUnmanaged(u64, u32) = .empty;
    var cover_axes: std.AutoHashMapUnmanaged(u64, u8) = .empty;
    for (rasters) |*r| {
        var it = r.axes.iterator();
        while (it.next()) |entry| {
            const cgop = try cover.getOrPut(arena, entry.key_ptr.*);
            if (!cgop.found_existing) cgop.value_ptr.* = 0;
            cgop.value_ptr.* += 1;
            const agop = try cover_axes.getOrPut(arena, entry.key_ptr.*);
            if (!agop.found_existing) agop.value_ptr.* = 0;
            agop.value_ptr.* |= entry.value_ptr.*;
        }
    }
    var out: std.AutoHashMapUnmanaged(u64, void) = .empty;
    var it = cover.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* >= 2 and (cover_axes.get(entry.key_ptr.*) orelse 0) == (AXIS_X | AXIS_Z)) {
            try out.put(arena, entry.key_ptr.*, {});
        }
    }
    return out;
}

/// Compile every stroke to one tile-kind plan (ts:335). Later strokes win
/// plain overlap; junction boxes form where carriageways cross; crosswalk
/// bands stamp across each leg just outside the box. Results write into `out`
/// (iteration order is hash order — each cell is independent). NO SILENT
/// TRUNCATION: an undersized `out` sets .truncated and the caller must not
/// stamp the partial plan as if complete.
pub fn planRoads(strokes: []const RoadStroke, out: []PlanCell) PlanResult {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    return planRoadsArena(arena, strokes, out) catch .{ .count = 0, .truncated = true };
}

fn planRoadsArena(arena: std.mem.Allocator, strokes: []const RoadStroke, out: []PlanCell) !PlanResult {
    var rasters: std.ArrayListUnmanaged(StrokeRaster) = .empty;
    for (strokes) |s| {
        if (s.points.len < 2) continue;
        try rasters.append(arena, try rasterizeStroke(arena, s));
    }

    // 1) sidewalks first, then carriageways — any stroke's lanes beat any
    //    stroke's sidewalk where a corner grazes a neighbour road (ts:340).
    var plan: std.AutoHashMapUnmanaged(u64, PlanValue) = .empty;
    for (rasters.items) |*r| {
        var wit = r.walk.keyIterator();
        while (wit.next()) |key| try plan.put(arena, key.*, .{ .kind = .sidewalk, .markings = 0 });
    }
    for (rasters.items) |*r| {
        var cit = r.carriage.iterator();
        while (cit.next()) |entry| try plan.put(arena, entry.key_ptr.*, .{
            .kind = entry.value_ptr.*,
            .markings = r.markings.get(entry.key_ptr.*) orelse 0,
        });
    }

    // 2) junction boxes (ts:349)
    var junction = try junctionCells(arena, rasters.items);
    var jit = junction.keyIterator();
    while (jit.next()) |key| try plan.put(arena, key.*, .{ .kind = .junction, .markings = 0 });

    // 3) crosswalk bands: the CROSSWALK_DEPTH centerline cells just outside
    //    every enter/exit of the box stamp their carriageway cross-section as
    //    zebra (ts:355-376).
    if (junction.count() > 0) {
        for (rasters.items) |*r| {
            const n = r.center.len;
            const in_box = try arena.alloc(bool, n);
            for (r.center, 0..) |c, i| in_box[i] = junction.contains(cellKeyOf(c.gx, c.gz));
            const band_at = try arena.alloc(bool, n);
            @memset(band_at, false);
            var any_band = false;
            for (0..n) |i| {
                const next_in = if (i + 1 < n) in_box[i + 1] else false;
                const enter = !in_box[i] and (i + 1 < n and next_in);
                const exit = in_box[i] and (i + 1 < n and !next_in);
                if (enter) {
                    var d: usize = 0;
                    while (d < CROSSWALK_DEPTH) : (d += 1) {
                        if (i >= d and !in_box[i - d]) {
                            band_at[i - d] = true;
                            any_band = true;
                        }
                    }
                }
                if (exit) {
                    var d: usize = 1;
                    while (d <= CROSSWALK_DEPTH) : (d += 1) {
                        if (i + d < n and !in_box[i + d]) {
                            band_at[i + d] = true;
                            any_band = true;
                        }
                    }
                }
            }
            if (!any_band) continue;
            const xs = crossSection(clampProfile(r.stroke.profile));
            for (0..n) |i| {
                if (!band_at[i]) continue;
                const c = r.center[i];
                const rt = rightOf(c.dir);
                for (xs.carriage[0..xs.carriage_count]) |col| {
                    const key = cellKeyOf(c.gx + rt.dx * col.off, c.gz + rt.dz * col.off);
                    if (!junction.contains(key) and plan.contains(key)) {
                        try plan.put(arena, key, .{
                            .kind = .crosswalk,
                            .markings = axisMarking(c.dir) | RoadMarking.crosswalk,
                        });
                    }
                }
            }
        }
    }

    // copy out
    var count: usize = 0;
    var truncated = false;
    var pit = plan.iterator();
    while (pit.next()) |entry| {
        if (count >= out.len) {
            truncated = true;
            break;
        }
        const cell = cellOfKey(entry.key_ptr.*);
        out[count] = .{
            .gx = cell[0],
            .gz = cell[1],
            .kind = entry.value_ptr.kind,
            .markings = entry.value_ptr.markings,
        };
        count += 1;
    }
    return .{ .count = count, .truncated = truncated };
}

// ── junction derivation (roadData.ts:445-508) ─────────────────────────────────

pub const JunctionLeg = struct {
    /// travel direction INTO the box on this arm
    approach: ApproachDir,
    side: JunctionSide,
    roadId: u32,
    /// centerline cell just OUTSIDE the box on this arm (the prop anchor)
    gx: i32,
    gz: i32,
};

pub const AuthorJunction = struct {
    /// stable id: the box's rounded center cell packed (survives re-derivation)
    key: u64,
    minGx: i32,
    minGz: i32,
    maxGx: i32,
    maxGz: i32,
    centerGx: f32,
    centerGz: f32,
    cells: u32,
    legs: [4]JunctionLeg,
    leg_count: usize,
};

fn approachForSide(side: JunctionSide) ApproachDir {
    return switch (side) {
        .N => .posZ,
        .S => .negZ,
        .W => .posX,
        .E => .negX,
    };
}

/// Stable junction id from its box center (ts:439).
pub fn junctionKey(centerGx: f32, centerGz: f32) u64 {
    return cellKeyOf(@round(centerGx), @round(centerGz));
}

/// Derive every junction box and its arms from the authored strokes (ts:445).
/// Pure — strokes in, boxes-with-legs out. Writes into `out`; returns the
/// count (boxes past out.len are dropped — size for the map's junction count).
pub fn deriveJunctions(strokes: []const RoadStroke, out: []AuthorJunction) usize {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    return deriveJunctionsArena(arena, strokes, out) catch 0;
}

fn deriveJunctionsArena(arena: std.mem.Allocator, strokes: []const RoadStroke, out: []AuthorJunction) !usize {
    var rasters: std.ArrayListUnmanaged(StrokeRaster) = .empty;
    for (strokes) |s| {
        if (s.points.len < 2) continue;
        try rasters.append(arena, try rasterizeStroke(arena, s));
    }
    var junction = try junctionCells(arena, rasters.items);
    if (junction.count() == 0) return 0;

    // flood-fill junction cells → boxes (4-connected; bounds = cluster rect)
    var seen: std.AutoHashMapUnmanaged(u64, void) = .empty;
    var box_count: usize = 0;
    var jit = junction.keyIterator();
    while (jit.next()) |start_key| {
        if (seen.contains(start_key.*)) continue;
        var min_gx: i32 = std.math.maxInt(i32);
        var min_gz: i32 = std.math.maxInt(i32);
        var max_gx: i32 = std.math.minInt(i32);
        var max_gz: i32 = std.math.minInt(i32);
        var count: u32 = 0;
        var stack: std.ArrayListUnmanaged(u64) = .empty;
        try stack.append(arena, start_key.*);
        try seen.put(arena, start_key.*, {});
        while (stack.items.len > 0) {
            const key = stack.pop().?;
            const cell = cellOfKey(key);
            count += 1;
            min_gx = @min(min_gx, cell[0]);
            max_gx = @max(max_gx, cell[0]);
            min_gz = @min(min_gz, cell[1]);
            max_gz = @max(max_gz, cell[1]);
            const sides = [_][2]i32{ .{ 1, 0 }, .{ -1, 0 }, .{ 0, 1 }, .{ 0, -1 } };
            for (sides) |d| {
                const nk = cellKeyOf(cell[0] + d[0], cell[1] + d[1]);
                if (junction.contains(nk) and !seen.contains(nk)) {
                    try seen.put(arena, nk, {});
                    try stack.append(arena, nk);
                }
            }
        }
        if (box_count >= out.len) continue; // documented drop: size out for the map
        const center_gx = @as(f32, @floatFromInt(min_gx + max_gx + 1)) / 2;
        const center_gz = @as(f32, @floatFromInt(min_gz + max_gz + 1)) / 2;
        out[box_count] = .{
            .key = junctionKey(center_gx, center_gz),
            .minGx = min_gx,
            .minGz = min_gz,
            .maxGx = max_gx,
            .maxGz = max_gz,
            .centerGx = center_gx,
            .centerGz = center_gz,
            .cells = count,
            .legs = undefined,
            .leg_count = 0,
        };
        box_count += 1;
    }

    // legs: each boundary crossing is an arm; one leg per box SIDE, the last
    // crossing on that side wins (ts:481-506).
    for (out[0..box_count]) |*box| {
        var by_side: [4]?JunctionLeg = @splat(null);
        for (rasters.items) |*r| {
            const c = r.center;
            var i: usize = 0;
            while (i + 1 < c.len) : (i += 1) {
                const a = c[i];
                const b = c[i + 1];
                const a_in = a.gx >= box.minGx and a.gx <= box.maxGx and a.gz >= box.minGz and a.gz <= box.maxGz;
                const b_in = b.gx >= box.minGx and b.gx <= box.maxGx and b.gz >= box.minGz and b.gz <= box.maxGz;
                if (a_in == b_in) continue;
                const outside = if (a_in) b else a;
                const dir: Dir = if (a_in) .{ .dx = -b.dir.dx, .dz = -b.dir.dz } else .{ .dx = a.dir.dx, .dz = a.dir.dz };
                const side: JunctionSide = if (outside.gz < box.minGz) .N else if (outside.gz > box.maxGz) .S else if (outside.gx < box.minGx) .W else .E;
                const approach: ApproachDir = if (dir.dx != 0 or dir.dz != 0)
                    (if (@abs(dir.dx) >= @abs(dir.dz))
                        (if (dir.dx >= 0) ApproachDir.posX else ApproachDir.negX)
                    else
                        (if (dir.dz >= 0) ApproachDir.posZ else ApproachDir.negZ))
                else
                    approachForSide(side);
                by_side[@intFromEnum(side)] = .{
                    .approach = approach,
                    .side = side,
                    .roadId = r.stroke.id,
                    .gx = outside.gx,
                    .gz = outside.gz,
                };
            }
        }
        for (by_side) |maybe_leg| {
            if (maybe_leg) |leg| {
                box.legs[box.leg_count] = leg;
                box.leg_count += 1;
            }
        }
    }
    return box_count;
}

// ── road views over the shared transport-path table ──────────────────────────
// These wrappers preserve the road planner's strict surface while the authored
// table also carries light-rail and railway paths. planRoads never sees rail.

pub const MAX_STROKES: usize = transport.MAX_PATHS;
pub const MAX_POINTS_PER_STROKE: usize = transport.MAX_POINTS_PER_PATH;

pub fn clearAll() void {
    transport.clearAll();
}

pub fn beginDraft(profile: RoadProfile) void {
    transport.beginDraft(.{ .road = clampProfile(profile) }, ROAD_FILLET_TILES);
}

/// Append a point to the draft (dedups an exact repeat of the last point).
pub fn addDraftPoint(gx: f32, gz: f32) void {
    transport.addDraftPoint(.{ .gx = gx, .gz = gz });
}

pub fn draftPointCount() usize {
    return transport.draftPointCount();
}

pub fn cancelDraft() void {
    transport.cancelDraft();
}

/// Commit the draft as a stroke. Null when the draft has < 2 points or the
/// table is full (LOUD contract: callers surface both, never drop silently).
pub fn commitDraft() ?u32 {
    return transport.commitDraft();
}

pub fn deleteStroke(id: u32) bool {
    return transport.kindForId(id) == .road and transport.deletePath(id);
}

pub fn strokeCount() usize {
    return transport.countKind(.road);
}

/// Materialize the table as RoadStroke views for planRoads/deriveJunctions.
/// buf.len must be ≥ MAX_STROKES to never drop.
pub fn collectStrokes(buf: []RoadStroke) usize {
    var paths: [transport.MAX_PATHS]transport.Path = undefined;
    const path_count = transport.collectPaths(paths[0..]);
    var n: usize = 0;
    for (paths[0..path_count]) |path| {
        const profile = switch (path.profile) {
            .road => |road| road,
            else => continue,
        };
        if (n >= buf.len) break;
        buf[n] = .{
            .id = path.id,
            .points = path.points,
            .profile = profile,
            .curve_radius_m = path.curve_radius_m,
        };
        n += 1;
    }
    return n;
}

// ── tests ─────────────────────────────────────────────────────────────────────
// Ported from cart/hmsc-int/roadData.test.ts (the meaning-tests: the ruled
// grammar must FALL OUT of a drawn stroke).

fn testStroke(id: u32, points: []const RoadPoint, lanesF: i32, lanesB: i32, sidewalks: bool) RoadStroke {
    return .{ .id = id, .points = points, .profile = .{ .lanesF = lanesF, .lanesB = lanesB, .sidewalks = sidewalks } };
}

fn planKindAt(cells: []const PlanCell, count: usize, gx: i32, gz: i32) ?RoadCellKind {
    for (cells[0..count]) |c| {
        if (c.gx == gx and c.gz == gz) return c.kind;
    }
    return null;
}

fn planCellAt(cells: []const PlanCell, count: usize, gx: i32, gz: i32) ?PlanCell {
    for (cells[0..count]) |c| {
        if (c.gx == gx and c.gz == gz) return c;
    }
    return null;
}

fn countKind(cells: []const PlanCell, count: usize, kind: RoadCellKind) usize {
    var n: usize = 0;
    for (cells[0..count]) |c| {
        if (c.kind == kind) n += 1;
    }
    return n;
}

var test_plan: [16384]PlanCell = undefined;

test "a lane is 3 tiles; 1+1 with sidewalks is 11 wide curb to curb" {
    try std.testing.expectEqual(@as(i32, 7), carriagewayTiles(.{ .lanesF = 1, .lanesB = 1, .sidewalks = false }));
    try std.testing.expectEqual(@as(i32, 11), roadWidthTiles(.{ .lanesF = 1, .lanesB = 1, .sidewalks = true }));
    try std.testing.expectEqual(@as(i32, 6), roadWidthTiles(.{ .lanesF = 2, .lanesB = 0, .sidewalks = false }));
}

test "analytic ribbon extents match the semantic road cross-section" {
    const two_way = ribbonExtents(.{ .lanesF = 1, .lanesB = 1, .sidewalks = true });
    try std.testing.expect(two_way.two_way);
    try std.testing.expectApproxEqAbs(@as(f32, 3.5), two_way.right_road_m, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 3.5), two_way.left_road_m, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 5.5), two_way.right_full_m, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 3.5), two_way.divider_phase_m, 0.001);

    const one_way = ribbonExtents(.{ .lanesF = 2, .lanesB = 0, .sidewalks = false });
    try std.testing.expect(!one_way.two_way);
    try std.testing.expectApproxEqAbs(@as(f32, 3), one_way.right_road_m, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 0), one_way.divider_phase_m, 0.001);
}

test "analytic ribbon follows a slight filleted bend with continuous arc phase" {
    const pts = [_]RoadPoint{
        .{ .gx = 10, .gz = 10 },
        .{ .gx = 20, .gz = 10 },
        .{ .gx = 30, .gz = 13 },
    };
    const stroke = RoadStroke{
        .id = 1,
        .points = &pts,
        .profile = .{ .lanesF = 1, .lanesB = 1, .sidewalks = true },
        .curve_radius_m = 8,
    };
    var segments: [64]RibbonSegment = undefined;
    const result = ribbonSegmentsForChunk(&.{stroke}, 0, 0, 120, segments[0..]);
    try std.testing.expect(!result.truncated);
    try std.testing.expect(result.count > 3);
    var saw_fractional = false;
    var previous_arc: f32 = -1;
    for (segments[0..result.count]) |segment| {
        try std.testing.expect(segment.arc_start_m >= previous_arc);
        previous_arc = segment.arc_start_m;
        if (segment.ax != @floor(segment.ax) or segment.az != @floor(segment.az) or
            segment.bx != @floor(segment.bx) or segment.bz != @floor(segment.bz))
        {
            saw_fractional = true;
        }
    }
    try std.testing.expect(saw_fractional);

    var tiny: [1]RibbonSegment = undefined;
    const clipped = ribbonSegmentsForChunk(&.{stroke}, 0, 0, 120, tiny[0..]);
    try std.testing.expect(clipped.truncated);

    const long_pts = [_]RoadPoint{
        .{ .gx = 0, .gz = 20 },
        .{ .gx = 100, .gz = 20 },
        .{ .gx = 145, .gz = 50 },
    };
    const long_stroke = RoadStroke{
        .id = 2,
        .points = &long_pts,
        .profile = stroke.profile,
        .curve_radius_m = 12,
    };
    const next_chunk = ribbonSegmentsForChunk(&.{long_stroke}, 1, 0, 120, segments[0..]);
    try std.testing.expect(!next_chunk.truncated);
    try std.testing.expect(next_chunk.count > 0);
    try std.testing.expect(segments[0].arc_start_m > 0);
}

test "an eastbound two-way stroke puts forward lanes south of the median (right-hand traffic)" {
    const pts = [_]RoadPoint{ .{ .gx = 10, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    const res = planRoads(&.{testStroke(1, &pts, 1, 1, true)}, test_plan[0..]);
    try std.testing.expect(!res.truncated);
    try std.testing.expectEqual(RoadCellKind.median, planKindAt(&test_plan, res.count, 15, 10).?);
    for ([_]i32{ 11, 12, 13 }) |z| try std.testing.expectEqual(RoadCellKind.laneEast, planKindAt(&test_plan, res.count, 15, z).?);
    for ([_]i32{ 9, 8, 7 }) |z| try std.testing.expectEqual(RoadCellKind.laneWest, planKindAt(&test_plan, res.count, 15, z).?);
    for ([_]i32{ 14, 15, 6, 5 }) |z| try std.testing.expectEqual(RoadCellKind.sidewalk, planKindAt(&test_plan, res.count, 15, z).?);
    try std.testing.expect(planKindAt(&test_plan, res.count, 15, 16) == null);
}

test "one lane each way compiles the ruled seven metre marked carriageway" {
    const pts = [_]RoadPoint{ .{ .gx = 10, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    const res = planRoads(&.{testStroke(1, &pts, 1, 1, false)}, test_plan[0..]);
    try std.testing.expect(!res.truncated);

    const median = planCellAt(&test_plan, res.count, 15, 10).?;
    try std.testing.expect((median.markings & RoadMarking.axis_x) != 0);
    try std.testing.expect((median.markings & RoadMarking.yellow_center) != 0);

    // No white line duplicates the yellow separator. Each 3 m lane ends in
    // one solid shoulder line, leaving a centred 2.75 m vehicle 0.125 m/side.
    try std.testing.expectEqual(@as(u8, RoadMarking.axis_x), planCellAt(&test_plan, res.count, 15, 11).?.markings);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 13).?.markings & RoadMarking.white_solid_high) != 0);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 7).?.markings & RoadMarking.white_solid_low) != 0);
}

test "multi-lane groups derive dashed splits every three metres and solid outer edges" {
    const pts = [_]RoadPoint{ .{ .gx = 10, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    var res = planRoads(&.{testStroke(1, &pts, 2, 1, false)}, test_plan[0..]);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 13).?.markings & RoadMarking.white_dash_high) != 0);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 16).?.markings & RoadMarking.white_solid_high) != 0);

    // A centred two-lane one-way ribbon has two solid shoulders and one dashed
    // split; it does not need a median kind to recover its 3 m lane phase.
    res = planRoads(&.{testStroke(2, &pts, 2, 0, false)}, test_plan[0..]);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 8).?.markings & RoadMarking.white_solid_low) != 0);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 10).?.markings & RoadMarking.white_dash_high) != 0);
    try std.testing.expect((planCellAt(&test_plan, res.count, 15, 13).?.markings & RoadMarking.white_solid_high) != 0);
}

test "a northbound stroke flows laneNorth with its forward group on the east side" {
    const pts = [_]RoadPoint{ .{ .gx = 10, .gz = 20 }, .{ .gx = 10, .gz = 10 } };
    const res = planRoads(&.{testStroke(1, &pts, 1, 1, false)}, test_plan[0..]);
    try std.testing.expectEqual(RoadCellKind.median, planKindAt(&test_plan, res.count, 10, 15).?);
    for ([_]i32{ 11, 12, 13 }) |x| try std.testing.expectEqual(RoadCellKind.laneNorth, planKindAt(&test_plan, res.count, x, 15).?);
    for ([_]i32{ 9, 8, 7 }) |x| try std.testing.expectEqual(RoadCellKind.laneSouth, planKindAt(&test_plan, res.count, x, 15).?);
    try std.testing.expect((planCellAt(&test_plan, res.count, 13, 15).?.markings & RoadMarking.white_solid_high) != 0);
    try std.testing.expect((planCellAt(&test_plan, res.count, 7, 15).?.markings & RoadMarking.white_solid_low) != 0);
    try std.testing.expect((planCellAt(&test_plan, res.count, 10, 15).?.markings & RoadMarking.axis_x) == 0);
}

test "a one-way road has no median and centres the carriageway on the stroke" {
    const pts = [_]RoadPoint{ .{ .gx = 10, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    const res = planRoads(&.{testStroke(1, &pts, 1, 0, false)}, test_plan[0..]);
    for ([_]i32{ 9, 10, 11 }) |z| try std.testing.expectEqual(RoadCellKind.laneEast, planKindAt(&test_plan, res.count, 15, z).?);
    try std.testing.expectEqual(@as(usize, 0), countKind(&test_plan, res.count, .median));
}

test "drawing with lanesF=0 flows traffic AGAINST the draw direction" {
    const pts = [_]RoadPoint{ .{ .gx = 10, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    const res = planRoads(&.{testStroke(1, &pts, 0, 1, false)}, test_plan[0..]);
    for ([_]i32{ 9, 10, 11 }) |z| try std.testing.expectEqual(RoadCellKind.laneWest, planKindAt(&test_plan, res.count, 15, z).?);
}

test "crossing strokes form a junction box with zebra bands on all four legs" {
    const ew = [_]RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 30, .gz = 10 } };
    const ns = [_]RoadPoint{ .{ .gx = 15, .gz = 0 }, .{ .gx = 15, .gz = 25 } };
    const res = planRoads(&.{
        testStroke(1, &ew, 1, 1, true),
        testStroke(2, &ns, 1, 1, true),
    }, test_plan[0..]);
    try std.testing.expect(!res.truncated);

    // both carriageways are 7 wide → the 7×7 overlap is all junction
    try std.testing.expectEqual(@as(usize, 49), countKind(&test_plan, res.count, .junction));
    try std.testing.expectEqual(RoadCellKind.junction, planKindAt(&test_plan, res.count, 15, 10).?);
    try std.testing.expectEqual(RoadCellKind.junction, planKindAt(&test_plan, res.count, 12, 7).?);

    // zebra bands: 2 deep, full carriageway width, just outside each leg
    for ([_]i32{ 10, 11 }) |x| {
        for ([_]i32{ 7, 8, 9, 10, 11, 12, 13 }) |z| {
            try std.testing.expectEqual(RoadCellKind.crosswalk, planKindAt(&test_plan, res.count, x, z).?);
        }
    }
    for ([_]i32{ 19, 20 }) |x| try std.testing.expectEqual(RoadCellKind.crosswalk, planKindAt(&test_plan, res.count, x, 10).?);
    for ([_]i32{ 5, 6 }) |z| try std.testing.expectEqual(RoadCellKind.crosswalk, planKindAt(&test_plan, res.count, 15, z).?);
    for ([_]i32{ 14, 15 }) |z| try std.testing.expectEqual(RoadCellKind.crosswalk, planKindAt(&test_plan, res.count, 15, z).?);

    // past the zebra the lanes resume
    try std.testing.expectEqual(RoadCellKind.median, planKindAt(&test_plan, res.count, 9, 10).?);
    try std.testing.expectEqual(RoadCellKind.laneEast, planKindAt(&test_plan, res.count, 9, 11).?);
}

test "clampProfile never returns a lane-less road; speed clamps to presets" {
    const c = clampProfile(.{ .lanesF = 0, .lanesB = 0, .sidewalks = true });
    try std.testing.expect(c.lanesF == 1 and c.lanesB == 0);
    try std.testing.expect(isOneWay(.{ .lanesF = 2, .lanesB = 0, .sidewalks = false }));
    try std.testing.expect(!isOneWay(.{ .lanesF = 1, .lanesB = 1, .sidewalks = false }));
    try std.testing.expectEqual(@as(f32, 50), clampProfile(.{ .lanesF = 1, .lanesB = 1 }).speedLimitKph);
    try std.testing.expectEqual(@as(f32, 130), clampProfile(.{ .lanesF = 1, .lanesB = 1, .speedLimitKph = 999 }).speedLimitKph);
    try std.testing.expectApproxEqAbs(@as(f32, 25), speedLimitMps(.{ .lanesF = 1, .lanesB = 1, .speedLimitKph = 90 }), 0.001);
}

test "crossSection one-way width centres around the stroke" {
    const xs = crossSection(.{ .lanesF = 1, .lanesB = 0, .sidewalks = false });
    try std.testing.expectEqual(@as(usize, 3), xs.carriage_count);
    var min_off: i32 = 99;
    var max_off: i32 = -99;
    for (xs.carriage[0..xs.carriage_count]) |col| {
        min_off = @min(min_off, col.off);
        max_off = @max(max_off, col.off);
    }
    try std.testing.expectEqual(@as(i32, -1), min_off);
    try std.testing.expectEqual(@as(i32, 1), max_off);
}

test "continuing a road from its endpoint is ONE road — no phantom junction at the seam" {
    const a = [_]RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 15, .gz = 10 } };
    const b = [_]RoadPoint{ .{ .gx = 15, .gz = 10 }, .{ .gx = 30, .gz = 10 } };
    const res = planRoads(&.{
        testStroke(1, &a, 1, 1, true),
        testStroke(2, &b, 1, 1, true),
    }, test_plan[0..]);
    try std.testing.expectEqual(@as(usize, 0), countKind(&test_plan, res.count, .junction));
    try std.testing.expectEqual(@as(usize, 0), countKind(&test_plan, res.count, .crosswalk));
    try std.testing.expectEqual(RoadCellKind.median, planKindAt(&test_plan, res.count, 15, 10).?);
    try std.testing.expectEqual(RoadCellKind.laneEast, planKindAt(&test_plan, res.count, 15, 11).?);
}

test "head-on parallel overlap stays box-free; crossing axes still box" {
    const a = [_]RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    const head_on = [_]RoadPoint{ .{ .gx = 30, .gz = 10 }, .{ .gx = 15, .gz = 10 } };
    var res = planRoads(&.{
        testStroke(1, &a, 1, 1, false),
        testStroke(2, &head_on, 1, 1, false),
    }, test_plan[0..]);
    try std.testing.expectEqual(@as(usize, 0), countKind(&test_plan, res.count, .junction));

    const tee = [_]RoadPoint{ .{ .gx = 15, .gz = 10 }, .{ .gx = 15, .gz = 30 } };
    res = planRoads(&.{
        testStroke(1, &a, 1, 1, false),
        testStroke(2, &tee, 1, 1, false),
    }, test_plan[0..]);
    try std.testing.expect(countKind(&test_plan, res.count, .junction) > 0);
}

test "filletPoints rounds corners into arcs, leaves straights and endpoints alone" {
    const corner = [_]RoadPoint{ .{ .gx = 0, .gz = 20 }, .{ .gx = 20, .gz = 20 }, .{ .gx = 20, .gz = 0 } };
    var arc: [64]RoadPoint = undefined;
    const n = filletPoints(&corner, 5, arc[0..]);
    try std.testing.expect(n > 4);
    try std.testing.expectEqual(@as(f32, 0), arc[0].gx);
    try std.testing.expectEqual(@as(f32, 0), arc[n - 1].gz);
    for (arc[0..n]) |p| {
        try std.testing.expect(!(p.gx == 20 and p.gz == 20)); // sharp vertex gone
        try std.testing.expect(p.gx <= 20 and p.gz <= 20.0001); // arc stays inside the bend
    }

    const straight = [_]RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 10, .gz = 10 }, .{ .gx = 20, .gz = 10 } };
    try std.testing.expectEqual(@as(usize, 3), filletPoints(&straight, 5, arc[0..]));

    // the stamped plan actually cuts the corner: the chord cell is carriageway
    const res = planRoads(&.{testStroke(1, &corner, 1, 1, false)}, test_plan[0..]);
    const chord = planKindAt(&test_plan, res.count, 17, 17);
    try std.testing.expect(chord != null and chord.? != .sidewalk);
}

test "deriveJunctions boxes the crossing with four legs on the right sides" {
    const ew = [_]RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 30, .gz = 10 } };
    const ns = [_]RoadPoint{ .{ .gx = 15, .gz = 0 }, .{ .gx = 15, .gz = 25 } };
    var boxes: [8]AuthorJunction = undefined;
    const n = deriveJunctions(&.{
        testStroke(1, &ew, 1, 1, true),
        testStroke(2, &ns, 1, 1, true),
    }, boxes[0..]);
    try std.testing.expectEqual(@as(usize, 1), n);
    const box = boxes[0];
    try std.testing.expectEqual(@as(i32, 12), box.minGx);
    try std.testing.expectEqual(@as(i32, 18), box.maxGx);
    try std.testing.expectEqual(@as(i32, 7), box.minGz);
    try std.testing.expectEqual(@as(i32, 13), box.maxGz);
    try std.testing.expectEqual(@as(u32, 49), box.cells);
    try std.testing.expectEqual(@as(usize, 4), box.leg_count);
    // the east-west road approaches the box travelling +x on the W side
    var found_w = false;
    for (box.legs[0..box.leg_count]) |leg| {
        if (leg.side == .W) {
            found_w = true;
            try std.testing.expectEqual(ApproachDir.posX, leg.approach);
            try std.testing.expectEqual(@as(u32, 1), leg.roadId);
        }
    }
    try std.testing.expect(found_w);
}

test "the stroke table drafts, commits sequential ids, deletes, and collects" {
    clearAll();
    defer clearAll();
    beginDraft(.{ .lanesF = 1, .lanesB = 1, .sidewalks = true });
    addDraftPoint(0, 10);
    addDraftPoint(0, 10); // exact repeat dedups
    addDraftPoint(20, 10);
    try std.testing.expectEqual(@as(usize, 2), draftPointCount());
    const id1 = commitDraft().?;
    try std.testing.expectEqual(@as(u32, 1), id1);

    beginDraft(.{ .lanesF = 2, .lanesB = 0, .sidewalks = false });
    addDraftPoint(10, 0);
    addDraftPoint(10, 30);
    const id2 = commitDraft().?;
    try std.testing.expectEqual(@as(u32, 2), id2);
    try std.testing.expectEqual(@as(usize, 2), strokeCount());

    // a one-point draft never commits
    beginDraft(.{});
    addDraftPoint(5, 5);
    try std.testing.expect(commitDraft() == null);

    var views: [MAX_STROKES]RoadStroke = undefined;
    const n = collectStrokes(views[0..]);
    try std.testing.expectEqual(@as(usize, 2), n);
    const res = planRoads(views[0..n], test_plan[0..]);
    try std.testing.expect(res.count > 0 and !res.truncated);
    try std.testing.expect(countKind(&test_plan, res.count, .junction) > 0); // they cross

    try std.testing.expect(deleteStroke(id1));
    try std.testing.expect(!deleteStroke(id1));
    try std.testing.expectEqual(@as(usize, 1), strokeCount());
}

test "planRoads reports truncation LOUDLY instead of silently dropping cells" {
    const pts = [_]RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 40, .gz = 10 } };
    var tiny: [8]PlanCell = undefined;
    const res = planRoads(&.{testStroke(1, &pts, 1, 1, true)}, tiny[0..]);
    try std.testing.expect(res.truncated);
    try std.testing.expectEqual(@as(usize, 8), res.count);
}

test "kind indices map the content legend" {
    var table: [ROAD_CELL_KIND_COUNT]i16 = undefined;
    for (&table, 0..) |*v, i| v.* = @intCast(i + 10);
    setKindIndices(table);
    try std.testing.expectEqual(@as(i16, 14), kindIndex(.median));
    try std.testing.expectEqual(@as(i16, 17), kindIndex(.crosswalk));
    g_kind_indices = @splat(-1);
}
