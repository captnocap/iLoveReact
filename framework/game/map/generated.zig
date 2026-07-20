//! Bulk installation boundary for generated map source data.
//!
//! The generator crosses one numeric wire and this module validates the whole
//! payload before any native owner is touched. Chunks land directly in the
//! canonical sparse registry; roads and rails land as semantic transport paths
//! and therefore keep the same edit/save/compile behavior as hand-authored
//! paths. Persistence remains the caller's concern.

const std = @import("std");
const chunks = @import("chunks.zig");
const transport = @import("transport.zig");

pub const WIRE_VERSION: u32 = 1;
pub const CHUNK_HEADER_FLOATS: usize = 5;
pub const CHUNK_STRIDE: usize = 2 + chunks.SAMPLE_CELLS * 2 + chunks.TILE_CELLS * 5;
pub const PATH_HEADER_FLOATS: usize = 2;
pub const PATH_RECORD_HEADER_FLOATS: usize = 8;

pub const Failure = enum(u8) {
    none = 0,
    chunk_header = 1,
    chunk_version = 2,
    chunk_count = 3,
    chunk_stride = 4,
    chunk_sample_count = 5,
    chunk_tile_count = 6,
    chunk_shape = 7,
    chunk_non_finite = 8,
    chunk_coordinate = 9,
    chunk_bounds = 10,
    chunk_duplicate = 11,
    height_range = 12,
    water_depth = 13,
    cell_index = 14,
    path_header = 15,
    path_version = 16,
    path_count = 17,
    path_shape = 18,
    path_non_finite = 19,
    path_kind = 20,
    path_profile = 21,
    path_point_count = 22,
    path_bounds = 23,
    path_segment_too_short = 24,
    path_curve_too_tight = 25,
    path_grade_too_steep = 26,
    chunk_allocation = 27,
    path_commit = 28,
    road_plan_truncated = 29,
};

pub const Stats = struct {
    chunks: usize = 0,
    paths: usize = 0,
    roads: usize = 0,
    rails: usize = 0,
};

pub const Result = struct {
    ok: bool,
    failure: Failure,
    stats: Stats,
};

pub fn failed(failure: Failure, stats: Stats) Result {
    return .{ .ok = false, .failure = failure, .stats = stats };
}

fn succeeded(stats: Stats) Result {
    return .{ .ok = true, .failure = .none, .stats = stats };
}

fn exactUsize(raw: f32, max: usize) ?usize {
    if (!std.math.isFinite(raw) or raw < 0 or @trunc(raw) != raw) return null;
    if (raw > @as(f32, @floatFromInt(max))) return null;
    const value: usize = @trunc(raw);
    return if (value <= max) value else null;
}

fn exactI32(raw: f32, min: i32, max: i32) ?i32 {
    if (!std.math.isFinite(raw) or @trunc(raw) != raw) return null;
    if (raw < @as(f32, @floatFromInt(min)) or raw > @as(f32, @floatFromInt(max))) return null;
    return @trunc(raw);
}

fn validCellIndex(raw: f32) bool {
    if (!std.math.isFinite(raw) or @trunc(raw) != raw) return false;
    return raw >= chunks.EMPTY_CELL and raw <= std.math.maxInt(i16);
}

fn chunkStats(chunk_count: usize) Stats {
    return .{ .chunks = chunk_count };
}

fn validateChunks(rows: []const f32) Result {
    if (rows.len < CHUNK_HEADER_FLOATS) return failed(.chunk_header, .{});
    for (rows[0..CHUNK_HEADER_FLOATS]) |value| {
        if (!std.math.isFinite(value)) return failed(.chunk_non_finite, .{});
    }
    if (rows[0] != WIRE_VERSION) return failed(.chunk_version, .{});
    const chunk_count = exactUsize(rows[1], chunks.SLOT_COUNT) orelse return failed(.chunk_count, .{});
    const stats = chunkStats(chunk_count);
    if (rows[2] != @as(f32, @floatFromInt(CHUNK_STRIDE))) return failed(.chunk_stride, stats);
    if (rows[3] != @as(f32, @floatFromInt(chunks.SAMPLE_CELLS))) return failed(.chunk_sample_count, stats);
    if (rows[4] != @as(f32, @floatFromInt(chunks.TILE_CELLS))) return failed(.chunk_tile_count, stats);
    if (rows.len != CHUNK_HEADER_FLOATS + chunk_count * CHUNK_STRIDE) return failed(.chunk_shape, stats);

    var seen: [chunks.SLOT_COUNT]bool = @splat(false);
    var chunk_index: usize = 0;
    while (chunk_index < chunk_count) : (chunk_index += 1) {
        const base = CHUNK_HEADER_FLOATS + chunk_index * CHUNK_STRIDE;
        const cx = exactI32(rows[base], 0, chunks.MAX_CHUNK_COL) orelse {
            if (!std.math.isFinite(rows[base]) or @trunc(rows[base]) != rows[base]) return failed(.chunk_coordinate, stats);
            return failed(.chunk_bounds, stats);
        };
        const cz = exactI32(rows[base + 1], 0, chunks.MAX_CHUNK_ROW) orelse {
            if (!std.math.isFinite(rows[base + 1]) or @trunc(rows[base + 1]) != rows[base + 1]) return failed(.chunk_coordinate, stats);
            return failed(.chunk_bounds, stats);
        };
        const slot = @as(usize, @intCast(cz)) * chunks.SLOT_COLS + @as(usize, @intCast(cx));
        if (seen[slot]) return failed(.chunk_duplicate, stats);
        seen[slot] = true;

        const height_start = base + 2;
        const water_start = height_start + chunks.SAMPLE_CELLS;
        const cells_start = water_start + chunks.SAMPLE_CELLS;
        for (rows[height_start..water_start]) |height| {
            if (!std.math.isFinite(height)) return failed(.chunk_non_finite, stats);
            if (height < -chunks.HEIGHT_LIMIT or height > chunks.HEIGHT_LIMIT) return failed(.height_range, stats);
        }
        for (rows[water_start..cells_start]) |depth| {
            if (!std.math.isFinite(depth)) return failed(.chunk_non_finite, stats);
            if (depth < 0) return failed(.water_depth, stats);
        }
        for (rows[cells_start .. base + CHUNK_STRIDE]) |cell| {
            if (!validCellIndex(cell)) return failed(.cell_index, stats);
        }
    }
    return succeeded(stats);
}

/// The wire speaks the editor's centered world coordinates. Transport recipes
/// use the global authoring grid whose zero is chunk (0,0)'s minimum edge, so
/// perform the same origin shift as engine.pathPointFromWorld before snapping.
fn normalizedPoint(x: f32, z: f32, elevation_m: f32) transport.Point {
    const step = transport.TUNING.point_snap_m;
    const author_origin = chunks.CHUNK_METERS / 2;
    return .{
        .gx = @round((x + author_origin) / step) * step,
        .gz = @round((z + author_origin) / step) * step,
        .elevation_m = elevation_m,
    };
}

fn validationFailure(reason: transport.InvalidReason) Failure {
    return switch (reason) {
        .none => .none,
        .too_few_points, .segment_too_short => .path_segment_too_short,
        .curve_too_tight => .path_curve_too_tight,
        .grade_too_steep => .path_grade_too_steep,
    };
}

fn validatePaths(rows: []const f32, initial_stats: Stats) Result {
    if (rows.len < PATH_HEADER_FLOATS) return failed(.path_header, initial_stats);
    if (!std.math.isFinite(rows[0]) or !std.math.isFinite(rows[1])) return failed(.path_non_finite, initial_stats);
    if (rows[0] != WIRE_VERSION) return failed(.path_version, initial_stats);
    const path_count = exactUsize(rows[1], transport.MAX_PATHS) orelse return failed(.path_count, initial_stats);
    var stats = initial_stats;
    stats.paths = path_count;
    var cursor: usize = PATH_HEADER_FLOATS;
    var path_index: usize = 0;
    while (path_index < path_count) : (path_index += 1) {
        if (cursor + PATH_RECORD_HEADER_FLOATS > rows.len) return failed(.path_shape, stats);
        const header = rows[cursor .. cursor + PATH_RECORD_HEADER_FLOATS];
        for (header) |value| if (!std.math.isFinite(value)) return failed(.path_non_finite, stats);

        const raw_kind = exactUsize(header[0], @intFromEnum(transport.Kind.railway)) orelse return failed(.path_kind, stats);
        const kind: transport.Kind = @enumFromInt(raw_kind);
        const lanes_f = exactI32(header[1], 0, 3) orelse return failed(.path_profile, stats);
        const lanes_b = exactI32(header[2], 0, 3) orelse return failed(.path_profile, stats);
        const sidewalks = exactI32(header[3], 0, 1) orelse return failed(.path_profile, stats);
        const tracks = exactI32(header[4], 0, transport.TUNING.max_tracks) orelse return failed(.path_profile, stats);
        const curve_radius_m = header[5];
        const speed_limit_kph = header[6];
        if (curve_radius_m < 0 or curve_radius_m > transport.TUNING.max_curve_radius_m) return failed(.path_profile, stats);
        if (speed_limit_kph < 0 or speed_limit_kph > 130) return failed(.path_profile, stats);
        switch (kind) {
            .road => {
                const speed_is_default = speed_limit_kph == 0;
                const speed_is_authored = speed_limit_kph >= 10 and @round(speed_limit_kph / 5) * 5 == speed_limit_kph;
                if ((lanes_f == 0 and lanes_b == 0) or tracks != 0 or (!speed_is_default and !speed_is_authored)) {
                    return failed(.path_profile, stats);
                }
            },
            .light_rail, .railway => if (lanes_f != 0 or lanes_b != 0 or sidewalks != 0 or tracks < 1 or speed_limit_kph != 0) {
                return failed(.path_profile, stats);
            },
        }
        const point_count = exactUsize(header[7], transport.MAX_POINTS_PER_PATH) orelse return failed(.path_point_count, stats);
        if (point_count < 2) return failed(.path_point_count, stats);
        cursor += PATH_RECORD_HEADER_FLOATS;
        if (cursor + point_count * 3 > rows.len) return failed(.path_shape, stats);

        var points: [transport.MAX_POINTS_PER_PATH]transport.Point = undefined;
        for (points[0..point_count], 0..) |*point, i| {
            const gx = rows[cursor + i * 3];
            const gz = rows[cursor + i * 3 + 1];
            const elevation_m = rows[cursor + i * 3 + 2];
            if (!std.math.isFinite(gx) or !std.math.isFinite(gz) or !std.math.isFinite(elevation_m)) {
                return failed(.path_non_finite, stats);
            }
            const min_edge = -chunks.CHUNK_METERS / 2;
            const max_x = @as(f32, @floatFromInt(chunks.MAX_CHUNK_COL)) * chunks.CHUNK_METERS + chunks.CHUNK_METERS / 2;
            const max_z = @as(f32, @floatFromInt(chunks.MAX_CHUNK_ROW)) * chunks.CHUNK_METERS + chunks.CHUNK_METERS / 2;
            if (gx < min_edge or gx > max_x or gz < min_edge or gz > max_z) return failed(.path_bounds, stats);
            const min_elevation = transport.elevationForLevel(transport.TUNING.min_level);
            const max_elevation = transport.elevationForLevel(transport.TUNING.max_level);
            if (elevation_m < min_elevation or elevation_m > max_elevation) return failed(.path_bounds, stats);
            point.* = normalizedPoint(gx, gz, elevation_m);
            if (!std.math.isFinite(point.gx) or !std.math.isFinite(point.gz)) return failed(.path_non_finite, stats);
        }
        cursor += point_count * 3;

        const profile: transport.Profile = switch (kind) {
            .road => .{ .road = .{
                .lanesF = lanes_f,
                .lanesB = lanes_b,
                .sidewalks = sidewalks == 1,
                .speedLimitKph = speed_limit_kph,
            } },
            .light_rail => .{ .light_rail = .{ .tracks = tracks } },
            .railway => .{ .railway = .{ .tracks = tracks } },
        };
        const validation = transport.validate(.{
            .id = 0,
            .points = points[0..point_count],
            .profile = profile,
            .curve_radius_m = curve_radius_m,
        });
        if (!validation.valid) return failed(validationFailure(validation.reason), stats);
        switch (kind) {
            .road => stats.roads += 1,
            .light_rail, .railway => stats.rails += 1,
        }
    }
    if (cursor != rows.len) return failed(.path_shape, stats);
    return succeeded(stats);
}

/// Validate both complete wires without changing chunks, paths, history, or
/// persistence bindings. The engine calls this before beginning replacement.
pub fn validate(chunk_rows: []const f32, path_rows: []const f32) Result {
    const chunk_result = validateChunks(chunk_rows);
    if (!chunk_result.ok) return chunk_result;
    return validatePaths(path_rows, chunk_result.stats);
}

fn copyCells(dst: []i16, src: []const f32) void {
    for (dst, src) |*cell, raw| cell.* = @trunc(raw);
}

/// Install a previously validated wire into empty chunk/transport owners.
/// This can still fail on allocation or an unexpected transport commit; the
/// engine wrapper is responsible for resetting its additional state then.
pub fn installValidated(chunk_rows: []const f32, path_rows: []const f32, stats: Stats) Result {
    const chunk_count: usize = @trunc(chunk_rows[1]);
    var chunk_index: usize = 0;
    while (chunk_index < chunk_count) : (chunk_index += 1) {
        const base = CHUNK_HEADER_FLOATS + chunk_index * CHUNK_STRIDE;
        const cx: i32 = @trunc(chunk_rows[base]);
        const cz: i32 = @trunc(chunk_rows[base + 1]);
        const chunk = chunks.growChunk(cx, cz) orelse return failed(.chunk_allocation, stats);
        const height_start = base + 2;
        const water_start = height_start + chunks.SAMPLE_CELLS;
        const tile_start = water_start + chunks.SAMPLE_CELLS;
        const zone_start = tile_start + chunks.TILE_CELLS;
        const grass_start = zone_start + chunks.TILE_CELLS;
        const tree_start = grass_start + chunks.TILE_CELLS;
        const bush_start = tree_start + chunks.TILE_CELLS;
        @memcpy(chunk.height[0..], chunk_rows[height_start..water_start]);
        @memcpy(chunk.water[0..], chunk_rows[water_start..tile_start]);
        copyCells(chunk.tiles[0..], chunk_rows[tile_start..zone_start]);
        copyCells(chunk.zones[0..], chunk_rows[zone_start..grass_start]);
        copyCells(chunk.flora[0][0..], chunk_rows[grass_start..tree_start]);
        copyCells(chunk.flora[1][0..], chunk_rows[tree_start..bush_start]);
        copyCells(chunk.flora[2][0..], chunk_rows[bush_start .. base + CHUNK_STRIDE]);
        for (chunk.flora, 0..) |lane, lane_index| {
            for (lane, 0..) |kind, cell_index| {
                chunk.flora_density[lane_index][cell_index] = if (kind == chunks.EMPTY_CELL) 0 else chunks.FLORA_DENSITY_FULL;
            }
        }
        @memset(chunk.materials[0..], chunks.EMPTY_CELL);
        chunk.dirty = .{ .tiles = true, .height = true, .water = true, .flora = true, .zones = true };
    }

    const path_count: usize = @trunc(path_rows[1]);
    var cursor: usize = PATH_HEADER_FLOATS;
    var path_index: usize = 0;
    while (path_index < path_count) : (path_index += 1) {
        const kind: transport.Kind = @enumFromInt(@as(u8, @trunc(path_rows[cursor])));
        const lanes_f: i32 = @trunc(path_rows[cursor + 1]);
        const lanes_b: i32 = @trunc(path_rows[cursor + 2]);
        const sidewalks = path_rows[cursor + 3] == 1;
        const tracks: i32 = @trunc(path_rows[cursor + 4]);
        const curve_radius_m = path_rows[cursor + 5];
        const speed_limit_kph = path_rows[cursor + 6];
        const point_count: usize = @trunc(path_rows[cursor + 7]);
        cursor += PATH_RECORD_HEADER_FLOATS;
        const profile: transport.Profile = switch (kind) {
            .road => .{ .road = .{
                .lanesF = lanes_f,
                .lanesB = lanes_b,
                .sidewalks = sidewalks,
                .speedLimitKph = speed_limit_kph,
            } },
            .light_rail => .{ .light_rail = .{ .tracks = tracks } },
            .railway => .{ .railway = .{ .tracks = tracks } },
        };
        transport.beginDraft(profile, curve_radius_m);
        var point_index: usize = 0;
        while (point_index < point_count) : (point_index += 1) {
            transport.addDraftPoint(normalizedPoint(
                path_rows[cursor + point_index * 3],
                path_rows[cursor + point_index * 3 + 1],
                path_rows[cursor + point_index * 3 + 2],
            ));
        }
        cursor += point_count * 3;
        if (transport.commitDraft() == null) return failed(.path_commit, stats);
    }
    return succeeded(stats);
}

/// Standalone owner-level replacement used by focused tests. Engine callers
/// use validate + installValidated so they can also clear autosave, undercoat,
/// history, and render identity at the same atomic boundary.
pub fn install(chunk_rows: []const f32, path_rows: []const f32) Result {
    const checked = validate(chunk_rows, path_rows);
    if (!checked.ok) return checked;
    chunks.clearAll();
    transport.clearAll();
    const result = installValidated(chunk_rows, path_rows, checked.stats);
    if (!result.ok) {
        chunks.clearAll();
        transport.clearAll();
    }
    return result;
}

fn testChunkWire(alloc: std.mem.Allocator, count: usize) ![]f32 {
    const rows = try alloc.alloc(f32, CHUNK_HEADER_FLOATS + count * CHUNK_STRIDE);
    @memset(rows, 0);
    rows[0] = WIRE_VERSION;
    rows[1] = @floatFromInt(count);
    rows[2] = @floatFromInt(CHUNK_STRIDE);
    rows[3] = @floatFromInt(chunks.SAMPLE_CELLS);
    rows[4] = @floatFromInt(chunks.TILE_CELLS);
    var chunk_index: usize = 0;
    while (chunk_index < count) : (chunk_index += 1) {
        const base = CHUNK_HEADER_FLOATS + chunk_index * CHUNK_STRIDE;
        rows[base] = @floatFromInt(chunk_index);
        const cells_start = base + 2 + chunks.SAMPLE_CELLS * 2;
        @memset(rows[cells_start .. base + CHUNK_STRIDE], chunks.EMPTY_CELL);
    }
    return rows;
}

test "generated wire installs native chunks and semantic paths" {
    chunks.clearAll();
    transport.clearAll();
    defer chunks.clearAll();
    defer transport.clearAll();
    const chunk_rows = try testChunkWire(std.testing.allocator, 1);
    defer std.testing.allocator.free(chunk_rows);
    const base = CHUNK_HEADER_FLOATS;
    const height_start = base + 2;
    const water_start = height_start + chunks.SAMPLE_CELLS;
    const tile_start = water_start + chunks.SAMPLE_CELLS;
    chunk_rows[height_start + 42] = 3.25;
    chunk_rows[water_start + 42] = 1.5;
    chunk_rows[tile_start] = 7;
    const path_rows = [_]f32{
        WIRE_VERSION,                      1,
        @intFromEnum(transport.Kind.road), 1,
        1,                                 1,
        0,                                 8,
        40,                                2,
        0,                                 0,
        0,                                 20,
        0,                                 0,
    };

    const result = install(chunk_rows, &path_rows);
    try std.testing.expect(result.ok);
    try std.testing.expectEqual(@as(usize, 1), result.stats.chunks);
    try std.testing.expectEqual(@as(usize, 1), result.stats.roads);
    const chunk = chunks.chunkAt(0, 0).?;
    try std.testing.expectApproxEqAbs(@as(f32, 3.25), chunk.height[42], 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 1.5), chunk.water[42], 0.0001);
    try std.testing.expectEqual(@as(i16, 7), chunk.tiles[0]);
    try std.testing.expectEqual(chunks.EMPTY_CELL, chunk.materials[0]);
    try std.testing.expect(chunk.dirty.tiles and chunk.dirty.height and chunk.dirty.water and chunk.dirty.flora and chunk.dirty.zones);
    try std.testing.expectEqual(@as(usize, 1), transport.pathCount());
    const installed_path = transport.pathForId(1).?;
    try std.testing.expectApproxEqAbs(@as(f32, 60), installed_path.points[0].gx, 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 60), installed_path.points[0].gz, 0.0001);
}

test "invalid generated wire is rejected before replacing live owners" {
    chunks.clearAll();
    transport.clearAll();
    defer chunks.clearAll();
    defer transport.clearAll();
    const chunk_rows = try testChunkWire(std.testing.allocator, 1);
    defer std.testing.allocator.free(chunk_rows);
    const no_paths = [_]f32{ WIRE_VERSION, 0 };
    try std.testing.expect(install(chunk_rows, &no_paths).ok);
    const installed = chunks.chunkAt(0, 0).?;

    const cells_start = CHUNK_HEADER_FLOATS + 2 + chunks.SAMPLE_CELLS * 2;
    chunk_rows[cells_start] = 1.5;
    const result = install(chunk_rows, &no_paths);
    try std.testing.expectEqual(Failure.cell_index, result.failure);
    try std.testing.expectEqual(installed, chunks.chunkAt(0, 0).?);
}

test "generated wire reports bounded chunk and transport failures" {
    const chunk_rows = try testChunkWire(std.testing.allocator, 1);
    defer std.testing.allocator.free(chunk_rows);
    const no_paths = [_]f32{ WIRE_VERSION, 0 };

    chunk_rows[CHUNK_HEADER_FLOATS] = chunks.MAX_CHUNK_COL + 1;
    try std.testing.expectEqual(Failure.chunk_bounds, validate(chunk_rows, &no_paths).failure);
    chunk_rows[CHUNK_HEADER_FLOATS] = 0;

    const short_path = [_]f32{
        WIRE_VERSION,                      1,
        @intFromEnum(transport.Kind.road), 1,
        1,                                 1,
        0,                                 8,
        40,                                2,
        0,                                 0,
        0,                                 0.25,
        0,                                 0,
    };
    try std.testing.expectEqual(Failure.path_segment_too_short, validate(chunk_rows, &short_path).failure);

    const negative_edge_path = [_]f32{
        WIRE_VERSION,                      1,
        @intFromEnum(transport.Kind.road), 1,
        0,                                 0,
        0,                                 0,
        30,                                2,
        -59,                               -59,
        0,                                 -40,
        -59,                               0,
    };
    try std.testing.expect(validate(chunk_rows, &negative_edge_path).ok);

    var road_with_tracks = negative_edge_path;
    road_with_tracks[6] = 1;
    try std.testing.expectEqual(Failure.path_profile, validate(chunk_rows, &road_with_tracks).failure);

    const rail_with_road_fields = [_]f32{
        WIRE_VERSION,                            1,
        @intFromEnum(transport.Kind.light_rail), 1,
        0,                                       0,
        1,                                       18,
        0,                                       2,
        -40,                                     -40,
        0,                                       20,
        -40,                                     0,
    };
    try std.testing.expectEqual(Failure.path_profile, validate(chunk_rows, &rail_with_road_fields).failure);
}
