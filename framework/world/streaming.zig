//! World content streaming (V30 FREEZE-0607 applied to the render plane) — the
//! GTA 3/Vice City-era trick, req_0524: stream full-detail content in around the
//! player by RADIUS, cull draws by LINE OF SIGHT (frustum now; the Compile-side
//! VIS lump slots into the same seam later), and keep a cheap LOD shell of the
//! whole city always drawable so the skyline sprawls to the horizon while only
//! the player's bubble pays full price. Draw distance is unchanged — this module
//! decides WHAT is drawn and at what detail, not how far the camera sees.
//!
//! Pure data logic: no GPU imports, no globals. The loader feeds it the same
//! packed instance-row families it draws (pos3 [rot3] scale3 color3 [shape]),
//! gets back chunk-sorted row arrays plus per-frame merged draw ranges, and
//! turns those into sub-range draws of ONE retained static instance upload
//! (gpu/3d.zig scene3d_instance_first). Residency follows the constitution:
//! promotion is instant, demotion is hysteretic; the unseen world stays frozen.
//!
//! The same chunk grid is the seam for the rest of the V30 activation predicate
//! (engaged ∪ zone ∪ tile-distance ∪ VIS): `vis` below is the renderer's slice
//! of that oracle and defaults to "everything potentially visible" until the
//! mapfile ships a precomputed VIS lump.

const std = @import("std");

/// A contiguous run of instance rows within one family's sorted row array.
pub const Range = struct { first: u32 = 0, count: u32 = 0 };

/// One packed instance-row batch as the loader draws it. Stride ≥ 9:
/// pos3 [+rot3 when stride ≥ 12] scale3 color3 [+shape id at 12].
/// `draw_radius` (meters, 0 = unlimited) is a per-family view-distance: short
/// foliage (grass/flora/trees) draws to HALF the structural view distance so a
/// dense field doesn't pay full-radius staging + animation cost (req_1665).
pub const FamilyRows = struct { rows: []const f32, stride: u32, draw_radius: f32 = 0 };

pub const Camera = struct {
    pos: [3]f32,
    look: [3]f32,
    fov_degrees: f32,
    aspect: f32,
    far: f32,
};

/// One draw the caller should issue this frame: a row range of `family`
/// (or of the synthesized LOD shell when `lod` is true).
pub const Draw = struct { family: u32, range: Range, lod: bool };

/// A family after partitioning: a chunk-sorted COPY of the input rows. Spanning
/// rows (wider than a cell — ground slabs, road strips) lead the array as the
/// `always` prefix and draw every frame; local rows follow, grouped per chunk.
pub const Family = struct {
    rows: []f32,
    stride: u32,
    always: Range,
    /// Per chunk (grid order, z-major). count == 0 → no rows in that chunk.
    ranges: []Range,
    /// Per-family view distance in meters (0 = unlimited). Foliage families set
    /// this to half the structural radius so far grass/trees are not drawn (req_1665).
    draw_radius: f32 = 0,

    fn deinit(self: *Family, allocator: std.mem.Allocator) void {
        allocator.free(self.rows);
        allocator.free(self.ranges);
    }
};

pub const BuildStats = struct {
    chunk_count: u32 = 0,
    occupied_chunks: u32 = 0,
    local_rows: u32 = 0,
    spanning_rows: u32 = 0,
    lod_rows: u32 = 0,
    /// The ladder rung that fit the budget: rows shorter than this vanish at
    /// distance (small maps: 2m; massive cities: only the skyline survives).
    lod_min_height: f32 = 0,
    /// Occupied chunks that got NO LOD rows because the row budget ran out.
    /// Never silent: the loader logs this.
    lod_truncated_chunks: u32 = 0,
};

// Demotion radius = promotion radius × this (V30: promotion instant, demotion
// hysteretic) so a player skirting the boundary doesn't thrash chunk residency.
const DEMOTE_FACTOR: f32 = 1.15;
// Per-model draw distance, the era's actual rule: a chunk holding H meters of
// content promotes at max(detail_radius, H × this) — an 80m tower wears its
// materials from ~480m out, while props keep the base bubble. The user-caught
// failure (req_0537): a huge textured face going flat at a distance where you
// can still read every brick.
pub const PROMOTE_PER_HEIGHT_METER: f32 = 6.0;
// Minimum row heights the far shell may keep, smallest rung first. The shell
// copies REAL rows verbatim (no merging — merged union boxes invented phantom
// buildings in gaps and swallowed recessed faces, req_0537), so the only
// degree of freedom is which rows survive at distance: the smallest rung whose
// surviving rows fit the budget wins. Small maps keep everything ≥ 2m; a
// massive city auto-raises the bar until only the skyline remains — small
// stuff vanishing far away is exactly the reference era's behavior.
const LOD_HEIGHT_LADDER = [_]f32{ 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96 };
// Hard cap on per-frame draws. Overflow DROPS the remaining ranges (counted in
// dropped_draws, never silent) — it must not widen a range across unwanted
// rows: bridged rows duplicate the other tier's geometry coplanar (the
// req_0537 face-eater).
//
// Sized generously (req_0548: contiguous-only merging fragments more, and a
// DENSE city multiplies ranges across every material family). The scratch
// itself is cheap (16 B/draw) and small worlds allocate min(actual, this)
// anyway; the true ceilings past this number are gpu/3d.zig's per-scene mesh
// collection (MAX_SCENE_MESHES = 32768 children) and per-frame encode cost —
// if this cap ever warns, the next move is distance-priority eviction of far
// LOD ranges, not a bigger constant.
pub const MAX_DRAWS: u32 = 16384;

pub const World = struct {
    allocator: std.mem.Allocator,
    cell: f32,
    min_x: f32,
    min_z: f32,
    cols: u32,
    rows: u32,
    families: []Family,
    /// Synthesized far-shell boxes, stride 12 (pos3 rot3 scale3 color3),
    /// chunk-ranged like a family. Drawn for chunks OUTSIDE detail residency.
    lod: Family,
    /// Per-chunk union AABB of LOCAL rows (spanning rows excluded — they draw
    /// always and would smear every chunk's bounds across the world).
    bounds_min: [][3]f32,
    bounds_max: [][3]f32,
    occupied: []bool,
    /// bit-state per chunk: detail-resident (radius + hysteresis).
    resident: []bool,
    /// Renderer slice of the V30 activation oracle. null until the mapfile
    /// ships a precomputed chunk-to-chunk VIS lump; null = all visible.
    vis: ?[]const u8 = null,
    /// Player XZ from the last updateResidency — emitChunkRanges measures a
    /// family's per-chunk distance against its draw_radius from here (req_1665).
    last_player_x: f32 = 0,
    last_player_z: f32 = 0,
    stats: BuildStats,
    // per-frame scratch (allocated once)
    visible: []bool,
    draws: []Draw,
    draw_len: usize = 0,
    /// Ranges dropped by the MAX_DRAWS cap last frame (the loader warns once).
    dropped_draws: usize = 0,

    pub fn deinit(self: *World, allocator: std.mem.Allocator) void {
        for (self.families) |*family| family.deinit(allocator);
        allocator.free(self.families);
        self.lod.deinit(allocator);
        allocator.free(self.bounds_min);
        allocator.free(self.bounds_max);
        allocator.free(self.occupied);
        allocator.free(self.resident);
        allocator.free(self.visible);
        allocator.free(self.draws);
        self.* = undefined;
    }

    pub fn chunkCount(self: *const World) u32 {
        return self.cols * self.rows;
    }

    fn chunkIndexOf(self: *const World, x: f32, z: f32) usize {
        const cx = clampCell(@as(i64, @floor((x - self.min_x) / self.cell)), self.cols);
        const cz = clampCell(@as(i64, @floor((z - self.min_z) / self.cell)), self.rows);
        return cz * @as(usize, self.cols) + cx;
    }

    /// Detail residency around the player: promote any occupied chunk whose
    /// footprint touches its effective radius, demote only past × DEMOTE_FACTOR.
    /// The effective radius grows with the chunk's content height (per-model
    /// draw distance): tall textured buildings promote from far away, props
    /// keep the base bubble.
    pub fn updateResidency(self: *World, player_x: f32, player_z: f32, radius: f32) void {
        self.last_player_x = player_x;
        self.last_player_z = player_z;
        const n = self.chunkCount();
        var i: usize = 0;
        while (i < n) : (i += 1) {
            if (!self.occupied[i]) continue;
            const content_height = self.bounds_max[i][1] - self.bounds_min[i][1];
            const promote = @max(radius, content_height * PROMOTE_PER_HEIGHT_METER);
            const demote = promote * DEMOTE_FACTOR;
            const d2 = self.chunkDist2(i, player_x, player_z);
            if (d2 <= promote * promote) {
                self.resident[i] = true;
            } else if (d2 > demote * demote) {
                self.resident[i] = false;
            }
        }
    }

    /// Squared XZ distance from a point to the chunk's CELL footprint (cheap,
    /// stable — residency shouldn't depend on how tall a chunk's contents are).
    fn chunkDist2(self: *const World, chunk: usize, x: f32, z: f32) f32 {
        const cx = chunk % @as(usize, self.cols);
        const cz = chunk / @as(usize, self.cols);
        const lo_x = self.min_x + @as(f32, @floatFromInt(cx)) * self.cell;
        const lo_z = self.min_z + @as(f32, @floatFromInt(cz)) * self.cell;
        const dx = @max(0, @max(lo_x - x, x - (lo_x + self.cell)));
        const dz = @max(0, @max(lo_z - z, z - (lo_z + self.cell)));
        return dx * dx + dz * dz;
    }

    /// Assemble this frame's draw list: every family's always-prefix, detail
    /// ranges for resident+visible chunks, LOD ranges for the rest of the
    /// visible world. Ranges are merged across small gaps. The returned slice
    /// is valid until the next call.
    pub fn assembleDraws(self: *World, cam: Camera) []const Draw {
        self.draw_len = 0;
        self.dropped_draws = 0;
        self.computeVisibility(cam);

        var fi: u32 = 0;
        while (fi < self.families.len) : (fi += 1) {
            const family = &self.families[fi];
            if (family.always.count > 0) self.pushDraw(.{ .family = fi, .range = family.always, .lod = false });
            self.emitChunkRanges(fi, family, false);
        }
        self.emitChunkRanges(0, &self.lod, true);
        return self.draws[0..self.draw_len];
    }

    fn pushDraw(self: *World, draw: Draw) void {
        if (self.draw_len >= self.draws.len) {
            self.dropped_draws += 1;
            return;
        }
        self.draws[self.draw_len] = draw;
        self.draw_len += 1;
    }

    /// Walk a family's chunk ranges in grid order, keep the wanted ones
    /// (detail: resident ∧ visible; LOD: ¬resident ∧ visible), and coalesce
    /// runs that are CONTIGUOUS — ranges stay contiguous across empty cells,
    /// so sparse worlds still collapse to few draws. Never bridge across an
    /// occupied-but-unwanted chunk's rows: those rows duplicate the other
    /// tier's geometry coplanar (a bridged LOD box over a resident building
    /// was the req_0537 face-eater). Overflow drops ranges into dropped_draws.
    fn emitChunkRanges(self: *World, fi: u32, family: *const Family, lod: bool) void {
        var pending: ?Range = null;
        const n = self.chunkCount();
        var i: usize = 0;
        while (i < n) : (i += 1) {
            const r = family.ranges[i];
            if (r.count == 0) continue;
            const wanted = if (lod) (!self.resident[i] and self.visible[i]) else (self.resident[i] and self.visible[i]);
            if (!wanted) continue;
            // Per-family view distance (req_1665): a foliage family is drawn only
            // within its draw_radius of the player, so far grass/trees vanish well
            // inside the structural bubble — the dominant fps lever in dense fields.
            if (!lod and family.draw_radius > 0 and
                self.chunkDist2(i, self.last_player_x, self.last_player_z) > family.draw_radius * family.draw_radius) continue;
            if (pending) |*p| {
                if (r.first == p.first + p.count) {
                    p.count += r.count;
                    continue;
                }
                self.pushDraw(.{ .family = fi, .range = p.*, .lod = lod });
            }
            pending = r;
        }
        if (pending) |p| self.pushDraw(.{ .family = fi, .range = p, .lod = lod });
    }

    /// Conservative per-chunk frustum test: bounding sphere of the chunk's
    /// local-row AABB vs the view cone. Off-screen chunks skip their draw —
    /// instant both ways, invisible by definition. Residency is unaffected.
    fn computeVisibility(self: *World, cam: Camera) void {
        const n = self.chunkCount();
        var fwd = [3]f32{ cam.look[0] - cam.pos[0], cam.look[1] - cam.pos[1], cam.look[2] - cam.pos[2] };
        const flen = @sqrt(fwd[0] * fwd[0] + fwd[1] * fwd[1] + fwd[2] * fwd[2]);
        if (flen < 0.0001 or cam.fov_degrees <= 0 or cam.fov_degrees >= 179) {
            @memset(self.visible, true);
            return;
        }
        fwd = .{ fwd[0] / flen, fwd[1] / flen, fwd[2] / flen };
        var right = [3]f32{ fwd[2], 0, -fwd[0] }; // cross(fwd, up=(0,1,0)), pre-normalize
        const rlen = @sqrt(right[0] * right[0] + right[2] * right[2]);
        if (rlen < 0.0001) {
            // Looking straight up/down — the cone test degenerates; draw all.
            @memset(self.visible, true);
            return;
        }
        right = .{ right[0] / rlen, 0, right[2] / rlen };
        const up = [3]f32{
            right[1] * fwd[2] - right[2] * fwd[1],
            right[2] * fwd[0] - right[0] * fwd[2],
            right[0] * fwd[1] - right[1] * fwd[0],
        };
        const tan_v = @tan(cam.fov_degrees * 0.5 * std.math.pi / 180.0);
        const tan_h = tan_v * @max(cam.aspect, 0.1);
        const kv = @sqrt(1.0 + tan_v * tan_v);
        const kh = @sqrt(1.0 + tan_h * tan_h);

        var i: usize = 0;
        while (i < n) : (i += 1) {
            if (!self.occupied[i]) {
                self.visible[i] = false;
                continue;
            }
            const bmin = self.bounds_min[i];
            const bmax = self.bounds_max[i];
            const c = [3]f32{ (bmin[0] + bmax[0]) * 0.5, (bmin[1] + bmax[1]) * 0.5, (bmin[2] + bmax[2]) * 0.5 };
            const ex = (bmax[0] - bmin[0]) * 0.5;
            const ey = (bmax[1] - bmin[1]) * 0.5;
            const ez = (bmax[2] - bmin[2]) * 0.5;
            const r = @sqrt(ex * ex + ey * ey + ez * ez);
            const d = [3]f32{ c[0] - cam.pos[0], c[1] - cam.pos[1], c[2] - cam.pos[2] };
            const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
            if (z + r < 0) {
                self.visible[i] = false; // fully behind the eye
                continue;
            }
            if (cam.far > 0 and z - r > cam.far) {
                self.visible[i] = false; // fully past the draw radius
                continue;
            }
            const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
            const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
            const vis_h = @abs(x) <= z * tan_h + r * kh;
            const vis_v = @abs(y) <= z * tan_v + r * kv;
            self.visible[i] = vis_h and vis_v;
        }
    }
};

fn clampCell(v: i64, n: u32) usize {
    if (v < 0) return 0;
    if (v >= @as(i64, n)) return n - 1;
    return @intCast(v);
}

fn scaleBase(stride: u32) usize {
    return if (stride >= 12) 6 else 3;
}

fn colorBase(stride: u32) usize {
    return if (stride >= 12) 9 else 6;
}

fn isSpanning(rows: []const f32, row: usize, stride: u32, cell: f32) bool {
    const b = row * stride;
    const sb = scaleBase(stride);
    return @abs(rows[b + sb + 0]) > cell or @abs(rows[b + sb + 2]) > cell;
}

const Extent = struct { min_x: f32, min_z: f32, max_x: f32, max_z: f32, any: bool };

fn measureExtent(families: []const FamilyRows) Extent {
    var e = Extent{ .min_x = std.math.floatMax(f32), .min_z = std.math.floatMax(f32), .max_x = -std.math.floatMax(f32), .max_z = -std.math.floatMax(f32), .any = false };
    for (families) |family| {
        if (family.stride < 9) continue;
        const count = family.rows.len / family.stride;
        var i: usize = 0;
        while (i < count) : (i += 1) {
            const b = i * family.stride;
            e.min_x = @min(e.min_x, family.rows[b + 0]);
            e.max_x = @max(e.max_x, family.rows[b + 0]);
            e.min_z = @min(e.min_z, family.rows[b + 2]);
            e.max_z = @max(e.max_z, family.rows[b + 2]);
            e.any = true;
        }
    }
    return e;
}

/// Partition every family into the shared chunk grid and synthesize the LOD
/// shell. `cell_meters` is the chunk size; it is doubled as needed so the grid
/// never exceeds ~1M chunks (degenerate world extents stay safe).
/// `lod_max_rows` caps the shell (the caller derives it from its GPU budget).
pub fn build(
    allocator: std.mem.Allocator,
    families: []const FamilyRows,
    cell_meters: f32,
    lod_max_rows: u32,
) !World {
    const extent = measureExtent(families);
    var cell = @max(8.0, cell_meters);
    var cols: u32 = 1;
    var rows: u32 = 1;
    if (extent.any) {
        while (true) {
            const cols_f = @floor((extent.max_x - extent.min_x) / cell) + 1;
            const rows_f = @floor((extent.max_z - extent.min_z) / cell) + 1;
            cols = @floor(cols_f);
            rows = @floor(rows_f);
            cols = @max(1, cols);
            rows = @max(1, rows);
            if (@as(u64, cols) * @as(u64, rows) <= (1 << 20)) break;
            cell *= 2;
        }
    }
    const chunk_count: usize = @as(usize, cols) * @as(usize, rows);

    var stats = BuildStats{ .chunk_count = @intCast(chunk_count) };

    const bounds_min = try allocator.alloc([3]f32, chunk_count);
    errdefer allocator.free(bounds_min);
    const bounds_max = try allocator.alloc([3]f32, chunk_count);
    errdefer allocator.free(bounds_max);
    const occupied = try allocator.alloc(bool, chunk_count);
    errdefer allocator.free(occupied);
    @memset(occupied, false);
    for (bounds_min) |*b| b.* = .{ std.math.floatMax(f32), std.math.floatMax(f32), std.math.floatMax(f32) };
    for (bounds_max) |*b| b.* = .{ -std.math.floatMax(f32), -std.math.floatMax(f32), -std.math.floatMax(f32) };

    const min_x = if (extent.any) extent.min_x else 0;
    const min_z = if (extent.any) extent.min_z else 0;

    var out_families = try allocator.alloc(Family, families.len);
    var built: usize = 0;
    errdefer {
        for (out_families[0..built]) |*family| family.deinit(allocator);
        allocator.free(out_families);
    }

    // Per-family partition: count per chunk → prefix sum → stable scatter,
    // spanning rows up front. Same CSR idea as the loader's collider grid.
    const counts = try allocator.alloc(u32, chunk_count);
    defer allocator.free(counts);

    for (families, 0..) |family, fi| {
        const stride = family.stride;
        const row_count = if (stride >= 9) family.rows.len / stride else 0;
        @memset(counts, 0);
        var spanning: u32 = 0;
        var i: usize = 0;
        while (i < row_count) : (i += 1) {
            if (isSpanning(family.rows, i, stride, cell)) {
                spanning += 1;
            } else {
                const b = i * stride;
                counts[chunkIndex(family.rows[b + 0], family.rows[b + 2], min_x, min_z, cell, cols, rows)] += 1;
            }
        }
        const sorted = try allocator.alloc(f32, family.rows.len);
        errdefer allocator.free(sorted);
        const ranges = try allocator.alloc(Range, chunk_count);
        errdefer allocator.free(ranges);

        var cursor: u32 = spanning;
        for (ranges, 0..) |*r, ci| {
            r.* = .{ .first = cursor, .count = 0 };
            cursor += counts[ci];
        }
        var span_at: u32 = 0;
        i = 0;
        while (i < row_count) : (i += 1) {
            const b = i * stride;
            var dst: u32 = undefined;
            if (isSpanning(family.rows, i, stride, cell)) {
                dst = span_at;
                span_at += 1;
            } else {
                const ci = chunkIndex(family.rows[b + 0], family.rows[b + 2], min_x, min_z, cell, cols, rows);
                dst = ranges[ci].first + ranges[ci].count;
                ranges[ci].count += 1;
                occupied[ci] = true;
                growBounds(&bounds_min[ci], &bounds_max[ci], family.rows, i, stride);
            }
            @memcpy(sorted[dst * stride ..][0..stride], family.rows[b .. b + stride]);
        }
        stats.spanning_rows += spanning;
        stats.local_rows += @intCast(row_count - spanning);
        out_families[fi] = .{
            .rows = sorted,
            .stride = stride,
            .always = .{ .first = 0, .count = spanning },
            .ranges = ranges,
            .draw_radius = family.draw_radius,
        };
        built += 1;
    }

    for (occupied) |o| {
        if (o) stats.occupied_chunks += 1;
    }

    var lod = try buildLodShell(allocator, out_families, occupied, chunk_count, lod_max_rows, &stats);
    errdefer lod.deinit(allocator);

    const resident = try allocator.alloc(bool, chunk_count);
    errdefer allocator.free(resident);
    @memset(resident, false);
    const visible = try allocator.alloc(bool, chunk_count);
    errdefer allocator.free(visible);
    @memset(visible, true);

    // Draw scratch: every nonempty chunk range of every family plus the LOD
    // shell could theoretically draw unmerged — cap it; overflow merges.
    var max_draws: usize = families.len + 1;
    for (out_families) |family| max_draws += countNonEmpty(family.ranges);
    max_draws += countNonEmpty(lod.ranges);
    const draws = try allocator.alloc(Draw, @min(max_draws, @as(usize, MAX_DRAWS)));
    errdefer allocator.free(draws);

    return .{
        .allocator = allocator,
        .cell = cell,
        .min_x = min_x,
        .min_z = min_z,
        .cols = cols,
        .rows = rows,
        .families = out_families,
        .lod = lod,
        .bounds_min = bounds_min,
        .bounds_max = bounds_max,
        .occupied = occupied,
        .resident = resident,
        .visible = visible,
        .draws = draws,
        .stats = stats,
    };
}

fn countNonEmpty(ranges: []const Range) usize {
    var n: usize = 0;
    for (ranges) |r| {
        if (r.count > 0) n += 1;
    }
    return n;
}

fn chunkIndex(x: f32, z: f32, min_x: f32, min_z: f32, cell: f32, cols: u32, rows: u32) usize {
    const cx = clampCell(@as(i64, @floor((x - min_x) / cell)), cols);
    const cz = clampCell(@as(i64, @floor((z - min_z) / cell)), rows);
    return cz * @as(usize, cols) + cx;
}

fn growBounds(bmin: *[3]f32, bmax: *[3]f32, rows: []const f32, row: usize, stride: u32) void {
    const b = row * stride;
    const sb = scaleBase(stride);
    var axis: usize = 0;
    while (axis < 3) : (axis += 1) {
        const half = @abs(rows[b + sb + axis]) * 0.5;
        bmin[axis] = @min(bmin[axis], rows[b + axis] - half);
        bmax[axis] = @max(bmax[axis], rows[b + axis] + half);
    }
}

const LOD_STRIDE: u32 = 12;

fn rowHeight(rows: []const f32, row: usize, stride: u32) f32 {
    return @abs(rows[row * stride + scaleBase(stride) + 1]);
}

/// Copy one source row into the LOD shell verbatim (normalized to stride 12:
/// pos3 rot3 scale3 color3; the optional shape id drops — a far ramp reads as
/// its slab box). Copies happen BEFORE the loader whitens shader-material
/// rows, so a brick building keeps its brick fallback color at any distance.
fn appendLodRow(allocator: std.mem.Allocator, list: *std.ArrayList(f32), rows: []const f32, row: usize, stride: u32) !void {
    const b = row * stride;
    const sb = scaleBase(stride);
    const cb = colorBase(stride);
    const has_rot = stride >= 12;
    try list.appendSlice(allocator, &[LOD_STRIDE]f32{
        rows[b + 0],
        rows[b + 1],
        rows[b + 2],
        if (has_rot) rows[b + 3] else 0,
        if (has_rot) rows[b + 4] else 0,
        if (has_rot) rows[b + 5] else 0,
        rows[b + sb + 0],
        rows[b + sb + 1],
        rows[b + sb + 2],
        rows[b + cb + 0],
        rows[b + cb + 1],
        rows[b + cb + 2],
    });
}

/// The far shell: VERBATIM copies of the tallest real rows, per chunk. A far
/// building is its own exact box wearing its own color — nothing merges, so
/// nothing phantom can appear in a gap and no stand-in can swallow a recessed
/// face (both user-caught, req_0537). The height ladder decides which rows
/// survive at distance: the smallest rung whose survivors fit `lod_max_rows`.
/// Short rows (curbs, road paint, props) simply vanish far away, exactly like
/// the reference era; with a roomy budget everything ≥ 2m persists.
fn buildLodShell(
    allocator: std.mem.Allocator,
    families: []const Family,
    occupied: []const bool,
    chunk_count: usize,
    lod_max_rows: u32,
    stats: *BuildStats,
) !Family {
    // One histogram pass: surviving-row count per ladder rung.
    var survivors = [_]u64{0} ** LOD_HEIGHT_LADDER.len;
    for (families) |family| {
        const total = family.rows.len / family.stride;
        var row: usize = family.always.count;
        while (row < total) : (row += 1) {
            const h = rowHeight(family.rows, row, family.stride);
            for (LOD_HEIGHT_LADDER, 0..) |min_h, li| {
                if (h >= min_h) survivors[li] += 1;
            }
        }
    }
    var rung: usize = 0;
    while (rung + 1 < LOD_HEIGHT_LADDER.len and survivors[rung] > lod_max_rows) rung += 1;
    const min_height = LOD_HEIGHT_LADDER[rung];
    stats.lod_min_height = min_height;

    var rows_list: std.ArrayList(f32) = .empty;
    errdefer rows_list.deinit(allocator);
    const ranges = try allocator.alloc(Range, chunk_count);
    errdefer allocator.free(ranges);

    var ci: usize = 0;
    while (ci < chunk_count) : (ci += 1) {
        const first: u32 = @intCast(rows_list.items.len / LOD_STRIDE);
        ranges[ci] = .{ .first = first, .count = 0 };
        if (!occupied[ci]) continue;
        var emitted: u32 = 0;
        var truncated = false;
        for (families) |family| {
            const r = family.ranges[ci];
            var k: u32 = 0;
            while (k < r.count) : (k += 1) {
                const row = @as(usize, r.first + k);
                if (rowHeight(family.rows, row, family.stride) < min_height) continue;
                if (first + emitted >= lod_max_rows) {
                    truncated = true;
                    break;
                }
                try appendLodRow(allocator, &rows_list, family.rows, row, family.stride);
                emitted += 1;
            }
            if (truncated) break;
        }
        if (truncated) stats.lod_truncated_chunks += 1;
        ranges[ci].count = emitted;
    }
    stats.lod_rows = @intCast(rows_list.items.len / LOD_STRIDE);
    return .{
        .rows = try rows_list.toOwnedSlice(allocator),
        .stride = LOD_STRIDE,
        .always = .{ .first = 0, .count = 0 },
        .ranges = ranges,
    };
}
