//! Cross-concern boundary tests for framework/game/map.

const std = @import("std");
const engine = @import("../../game/map/engine.zig");
const chunks = @import("../../game/map/chunks.zig");
const roads = @import("../../game/map/roads.zig");

fn oneChunkGeneratedWire(allocator: std.mem.Allocator) ![]f32 {
    const wire = engine.generated;
    const rows = try allocator.alloc(f32, wire.CHUNK_HEADER_FLOATS + wire.CHUNK_STRIDE);
    @memset(rows, 0);
    rows[0] = @floatFromInt(wire.WIRE_VERSION);
    rows[1] = 1;
    rows[2] = @floatFromInt(wire.CHUNK_STRIDE);
    rows[3] = @floatFromInt(chunks.SAMPLE_CELLS);
    rows[4] = @floatFromInt(chunks.TILE_CELLS);
    const cells_start = wire.CHUNK_HEADER_FLOATS + 2 + chunks.SAMPLE_CELLS * 2;
    @memset(rows[cells_start..], @as(f32, @floatFromInt(chunks.EMPTY_CELL)));
    return rows;
}

fn oneStreamChunkRecord(allocator: std.mem.Allocator, cx: i32, cz: i32) ![]f32 {
    const wire = engine.generated;
    const rows = try allocator.alloc(f32, wire.CHUNK_STRIDE);
    @memset(rows, 0);
    rows[0] = @floatFromInt(cx);
    rows[1] = @floatFromInt(cz);
    const cells_start = 2 + chunks.SAMPLE_CELLS * 2;
    @memset(rows[cells_start..], @as(f32, @floatFromInt(chunks.EMPTY_CELL)));
    return rows;
}

test "reset unbinds the outgoing document and clears map-scoped bindings" {
    engine.reset();
    engine.setTileBindings(std.testing.io, &.{ 11, 12, 13, 14, 21, 22, 23, 24 });
    try std.testing.expectEqual(@as(usize, 2), engine.tileBindings().len);

    const path = "/tmp/reactjit-map-reset-boundary.rmap";
    std.Io.Dir.cwd().deleteFile(std.testing.io, path) catch {};
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, path) catch {};

    _ = chunks.growChunk(0, 0).?;
    engine.setAutosaveFile(path);
    try std.testing.expect(engine.autosaveNow(std.testing.io));

    engine.reset();
    try std.testing.expectEqual(@as(usize, 0), engine.tileBindings().len);
    // Make the replacement map non-empty so false proves the document target
    // was unbound, rather than merely hitting autosave's empty-world guard.
    _ = chunks.growChunk(0, 0).?;
    try std.testing.expect(!engine.autosaveNow(std.testing.io));
}

test "generated replacement aligns world paths with chunks and clears transactional state" {
    engine.reset();
    defer engine.reset();
    var kinds: [roads.ROAD_CELL_KIND_COUNT]i16 = undefined;
    for (&kinds, 0..) |*kind, i| kind.* = @intCast(i);
    roads.setKindIndices(kinds);
    defer roads.setKindIndices(@splat(chunks.EMPTY_CELL));

    const chunk_rows = try oneChunkGeneratedWire(std.testing.allocator);
    defer std.testing.allocator.free(chunk_rows);
    const path_rows = [_]f32{
        1,  1,
        0,  1,
        1,  0,
        0,  8,
        40, 2,
        0,  0,
        0,  20,
        0,  0,
    };

    // The outgoing binding must not survive the replacement transaction.
    _ = chunks.growChunk(0, 0).?;
    engine.setAutosaveFile("/tmp/reactjit-generated-map-must-stay-unbound.rmap");
    const result = engine.installGeneratedMap(chunk_rows, &path_rows);
    try std.testing.expect(result.ok);
    try std.testing.expectEqual(@as(usize, 1), result.stats.chunks);
    try std.testing.expectEqual(@as(usize, 1), result.stats.paths);
    try std.testing.expectEqual(@as(usize, 1), result.stats.roads);
    try std.testing.expect(!engine.autosaveNow(std.testing.io));
    try std.testing.expectEqual(@as(usize, 0), engine.mapHistoryStats().undo);
    try std.testing.expectEqual(@as(usize, 0), engine.mapHistoryStats().redo);

    const installed_path = engine.transport.pathForId(1).?;
    // Generated wire points are world metres. Transport's author grid starts
    // at chunk (0,0)'s -60m corner, so world (0,0) is author cell (60,60).
    try std.testing.expectApproxEqAbs(@as(f32, 60), installed_path.points[0].gx, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 60), installed_path.points[0].gz, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 80), installed_path.points[1].gx, 0.001);
    const road_cell = chunks.cellIndex(70, 60).?;
    try std.testing.expect(chunks.chunkAt(0, 0).?.tiles[road_cell] != chunks.EMPTY_CELL);

    // Whole-wire validation happens before reset: a bad retry cannot erase the
    // successfully installed document.
    chunk_rows[0] = 99;
    const rejected = engine.installGeneratedMap(chunk_rows, &path_rows);
    try std.testing.expectEqual(engine.generated.Failure.chunk_version, rejected.failure);
    try std.testing.expect(chunks.chunkAt(0, 0).?.tiles[road_cell] != chunks.EMPTY_CELL);
}

test "streamed generated replacement is manifest-bounded and commits only when complete" {
    engine.reset();
    defer engine.reset();
    const outgoing = chunks.growChunk(0, 0).?;
    outgoing.tiles[0] = 12;

    const no_paths = [_]f32{ engine.generated.WIRE_VERSION, 0 };
    const invalid_manifest = [_]f32{ engine.generated.WIRE_VERSION, 1, 0, chunks.MAX_CHUNK_ROW + 1 };
    const bad_coord = engine.generatedInstallBegin(&invalid_manifest, &no_paths);
    try std.testing.expectEqual(engine.generated.Failure.chunk_bounds, bad_coord.failure);
    try std.testing.expectEqual(@as(i16, 12), chunks.chunkAt(0, 0).?.tiles[0]);

    const manifest = [_]f32{
        engine.generated.WIRE_VERSION,
        2,
        0,
        0,
        0,
        chunks.MAX_CHUNK_ROW,
    };
    const bad_paths = [_]f32{ 99, 0 };
    const bad_path = engine.generatedInstallBegin(&manifest, &bad_paths);
    try std.testing.expectEqual(engine.generated.Failure.path_version, bad_path.failure);
    try std.testing.expectEqual(@as(i16, 12), chunks.chunkAt(0, 0).?.tiles[0]);

    const began = engine.generatedInstallBegin(&manifest, &no_paths);
    try std.testing.expect(began.ok);
    try std.testing.expectEqual(@as(usize, 2), began.stats.chunks);
    try std.testing.expectEqual(@as(usize, 0), chunks.chunkCount());
    try std.testing.expectEqual(engine.generated.Failure.stream_active, engine.generatedInstallBegin(&manifest, &no_paths).failure);

    const record = try oneStreamChunkRecord(std.testing.allocator, 1, 0);
    defer std.testing.allocator.free(record);
    try std.testing.expectEqual(engine.generated.Failure.chunk_unexpected, engine.generatedInstallChunk(record).failure);
    try std.testing.expectEqual(@as(usize, 0), chunks.chunkCount());

    record[0] = 0;
    record[1] = 0;
    record[2 + 42] = 3.25;
    try std.testing.expect(engine.generatedInstallChunk(record).ok);
    try std.testing.expectApproxEqAbs(@as(f32, 3.25), chunks.chunkAt(0, 0).?.height[42], 0.0001);
    try std.testing.expectEqual(engine.generated.Failure.chunk_duplicate, engine.generatedInstallChunk(record).failure);

    const premature = engine.generatedInstallCommit();
    try std.testing.expectEqual(engine.generated.Failure.chunk_missing, premature.failure);
    try std.testing.expect(chunks.chunkAt(0, 0) != null);

    record[1] = @floatFromInt(chunks.MAX_CHUNK_ROW);
    record[2 + 42] = 7.5;
    try std.testing.expect(engine.generatedInstallChunk(record).ok);
    const committed = engine.generatedInstallCommit();
    try std.testing.expect(committed.ok);
    try std.testing.expectEqual(@as(usize, 2), committed.stats.chunks);
    try std.testing.expectApproxEqAbs(@as(f32, 7.5), chunks.chunkAt(0, chunks.MAX_CHUNK_ROW).?.height[42], 0.0001);
    try std.testing.expectEqual(engine.generated.Failure.stream_inactive, engine.generatedInstallCommit().failure);
}

test "streamed generated replacement abort discards partial owners" {
    engine.reset();
    defer engine.reset();
    const no_paths = [_]f32{ engine.generated.WIRE_VERSION, 0 };
    const manifest = [_]f32{ engine.generated.WIRE_VERSION, 1, 0, 0 };
    const record = try oneStreamChunkRecord(std.testing.allocator, 0, 0);
    defer std.testing.allocator.free(record);

    try std.testing.expect(engine.generatedInstallBegin(&manifest, &no_paths).ok);
    try std.testing.expect(engine.generatedInstallChunk(record).ok);
    try std.testing.expectEqual(@as(usize, 1), chunks.chunkCount());
    const aborted = engine.generatedInstallAbort();
    try std.testing.expect(aborted.ok);
    try std.testing.expectEqual(@as(usize, 1), aborted.stats.chunks);
    try std.testing.expectEqual(@as(usize, 0), chunks.chunkCount());
    try std.testing.expect(engine.generatedInstallAbort().ok);
}

test "transport pen previews after one anchor and keeps rail out of the road tile compiler" {
    engine.reset();
    defer engine.reset();
    const chunk = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .road });
    engine.setPathProfile(.{ .light_rail = .{ .tracks = 2 } }, 18);

    engine.strokeBegin(std.testing.io, -20, 0);
    _ = engine.strokeEnd(std.testing.io);
    engine.setPathHover(20, 0);
    const live = engine.transport.draftPreview().?;
    try std.testing.expectEqual(@as(usize, 1), engine.transport.draftPointCount());
    try std.testing.expectEqual(@as(usize, 2), live.points.len);
    try std.testing.expect(engine.transport.draftValidation().valid);

    engine.strokeBegin(std.testing.io, 20, 0);
    _ = engine.strokeEnd(std.testing.io);
    try std.testing.expect(engine.pathCommit(std.testing.io) != null);
    try std.testing.expectEqual(@as(usize, 1), engine.transport.railCount());
    for (chunk.tiles) |tile| try std.testing.expectEqual(chunks.EMPTY_CELL, tile);
}

test "linked map path snapshot is bounded and returns world-space recipes" {
    engine.reset();
    defer engine.reset();
    _ = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .road });
    engine.setPathProfile(.{ .road = .{ .lanesF = 2, .lanesB = 1, .sidewalks = true, .speedLimitKph = 50 } }, 10);
    engine.strokeBegin(std.testing.io, -20, 12);
    _ = engine.strokeEnd(std.testing.io);
    engine.strokeBegin(std.testing.io, 30, 42);
    _ = engine.strokeEnd(std.testing.io);
    const path_id = engine.pathCommit(std.testing.io).?;

    try std.testing.expectEqual(@as(usize, 17), engine.pathSnapshotFloatCount());
    var short: [16]f32 = undefined;
    try std.testing.expect(engine.writePathSnapshot(short[0..]) == null);
    var snapshot: [17]f32 = undefined;
    const written = engine.writePathSnapshot(snapshot[0..]).?;
    try std.testing.expectEqual(snapshot.len, written);
    try std.testing.expectEqual(@as(f32, @floatFromInt(engine.PATH_SNAPSHOT_VERSION)), snapshot[0]);
    try std.testing.expectEqual(@as(f32, 1), snapshot[1]);
    try std.testing.expectEqual(@as(f32, @floatFromInt(path_id)), snapshot[2]);
    try std.testing.expectEqual(@as(f32, @floatFromInt(@intFromEnum(engine.transport.Kind.road))), snapshot[3]);
    try std.testing.expectEqual(@as(f32, 2), snapshot[4]);
    try std.testing.expectEqual(@as(f32, 1), snapshot[5]);
    try std.testing.expectEqual(@as(f32, 1), snapshot[6]);
    try std.testing.expectApproxEqAbs(@as(f32, -20), snapshot[11], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 12), snapshot[12], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 30), snapshot[14], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 42), snapshot[15], 0.001);
}

test "rail storey points derive grade and TC Stops sample the same 3D path" {
    engine.reset();
    defer engine.reset();
    _ = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .road });
    engine.setPathProfile(.{ .light_rail = .{} }, 18);

    engine.setPathLevel(0);
    engine.strokeBegin(std.testing.io, -30, 0);
    _ = engine.strokeEnd(std.testing.io);
    engine.setPathLevel(1);
    engine.setPathHover(30, 0);
    const validation = engine.transport.draftValidation();
    try std.testing.expect(validation.valid);
    try std.testing.expectApproxEqAbs(@as(f32, 0.05), validation.max_grade, 0.001);
    engine.strokeBegin(std.testing.io, 30, 0);
    _ = engine.strokeEnd(std.testing.io);
    const path_id = engine.pathCommit(std.testing.io).?;
    const path = engine.transport.pathForId(path_id).?;
    try std.testing.expectApproxEqAbs(@as(f32, 3), path.points[1].elevation_m, 0.001);

    engine.setPathAuthoringTool(.stop);
    engine.setPathHover(0, 1);
    const stop_preview = engine.transport.controlPreview().?;
    try std.testing.expect(stop_preview.valid);
    try std.testing.expectApproxEqAbs(@as(f32, 1.5), stop_preview.sample.point.elevation_m, 0.1);
    engine.strokeBegin(std.testing.io, 0, 1);
    _ = engine.strokeEnd(std.testing.io);
    try std.testing.expectEqual(@as(usize, 1), engine.transport.controlCount());
}

test "Map Paint undo and redo restore the native RMAP concern per gesture" {
    engine.reset();
    defer engine.reset();
    _ = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 3, .center_z = 6, .profile = .flat });
    engine.strokeBegin(std.testing.io, 0, 0);
    _ = engine.strokeEnd(std.testing.io);
    try std.testing.expectApproxEqAbs(@as(f32, 6), engine.heightAt(0, 0), 0.001);
    try std.testing.expectEqual(@as(usize, 1), engine.mapHistoryStats().undo);

    const undone = engine.mapHistoryUndo(std.testing.io);
    try std.testing.expect(undone.ok);
    try std.testing.expectApproxEqAbs(@as(f32, 0), engine.heightAt(0, 0), 0.001);
    try std.testing.expectEqual(@as(usize, 1), undone.stats.redo);

    const redone = engine.mapHistoryRedo(std.testing.io);
    try std.testing.expect(redone.ok);
    try std.testing.expectApproxEqAbs(@as(f32, 6), engine.heightAt(0, 0), 0.001);
    try std.testing.expectEqual(@as(usize, 1), redone.stats.undo);
}

test "editor camera terrain query samples canonical world-metre height" {
    engine.reset();
    defer engine.reset();
    _ = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 4, .center_z = 17, .profile = .flat });
    engine.strokeBegin(std.testing.io, 15, -11);
    _ = engine.strokeEnd(std.testing.io);

    try std.testing.expectApproxEqAbs(@as(f32, 17), engine.heightAt(15, -11), 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 0), engine.heightAt(500, 500), 0.001);
}

test "build-run terrain query follows the rendered floor mirror" {
    engine.reset();
    defer engine.reset();
    const chunk = chunks.growChunk(0, 0).?;
    chunk.height[121 * chunks.SAMPLE_COLS + 121] = 8;

    try std.testing.expectApproxEqAbs(@as(f32, 0), engine.heightAt(0, 0), 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 8), engine.renderedHeightAt(0, 0), 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 8), engine.maxRenderedHeightInRect(-1.5, -1.5, 1.5, 1.5).?, 0.001);
}

test "build footprint terrain query includes the taller side of a chunk seam" {
    engine.reset();
    defer engine.reset();
    const left = chunks.growChunk(0, 0).?;
    _ = chunks.growChunk(1, 0).?;
    left.height[120 * chunks.SAMPLE_COLS + 239] = 12;

    // The point sampler has deterministic right-side ownership at x=60. The
    // footprint query is closed and must include the independently mirrored
    // border vertex from the left chunk as well.
    try std.testing.expectApproxEqAbs(@as(f32, 0), engine.renderedHeightAt(60, 0), 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 12), engine.maxRenderedHeightInRect(60, 0, 60, 0).?, 0.001);
}

test "map memory counters report allocator ownership and release history" {
    engine.reset();
    defer engine.reset();
    try std.testing.expectEqual(@as(u64, 0), chunks.allocatedBytes());
    try std.testing.expectEqual(@as(u64, 0), engine.mapHistoryAllocatedBytes());

    _ = chunks.growChunk(0, 0).?;
    _ = chunks.growChunk(1, 0).?;
    const mapped_per_chunk = std.mem.alignForward(usize, @sizeOf(chunks.Chunk), std.heap.pageSize());
    try std.testing.expectEqual(@as(u64, mapped_per_chunk * 2), chunks.allocatedBytes());

    engine.beginMapHistory(.chunk_grow);
    try std.testing.expect(engine.mapHistoryAllocatedBytes() >= engine.saveSize());
    engine.commitMapHistory(false);
    try std.testing.expectEqual(@as(u64, 0), engine.mapHistoryAllocatedBytes());

    // Fixed road scratch is always owned; a live plan/hash can only add to it.
    try std.testing.expect(engine.roadAllocatedBytes() > 0);
}

test "analytic road rows and visual undercoat ride the compact ground stream" {
    engine.reset();
    defer engine.reset();
    var kinds: [roads.ROAD_CELL_KIND_COUNT]i16 = undefined;
    for (&kinds, 0..) |*kind, i| kind.* = @intCast(i);
    roads.setKindIndices(kinds);
    defer roads.setKindIndices(@splat(chunks.EMPTY_CELL));

    const chunk = chunks.growChunk(0, 0).?;
    engine.setTileBindings(std.testing.io, &.{ 11, 12, 13, 0 });
    const authored_undercoat = chunks.cellIndex(60, 66).?;
    chunk.tiles[authored_undercoat] = 4;
    chunk.materials[authored_undercoat] = 0;
    engine.setTool(.{ .channel = .road });
    engine.setPathProfile(.{ .road = .{ .lanesF = 2, .lanesB = 1, .sidewalks = false } }, 8);
    engine.strokeBegin(std.testing.io, -20, 0);
    _ = engine.strokeEnd(std.testing.io);
    engine.strokeBegin(std.testing.io, 20, 0);
    _ = engine.strokeEnd(std.testing.io);
    try std.testing.expect(engine.pathCommit(std.testing.io) != null);

    const data = try std.testing.allocator.alloc(f32, engine.groundDataFloats());
    defer std.testing.allocator.free(data);
    const written = engine.encodeGroundData(chunk, data);
    try std.testing.expect(written <= data.len);
    const tile_pal: usize = @trunc(data[2]);
    const flora_pal: usize = @trunc(data[3]);
    const zone_pal: usize = @trunc(data[4]);
    const bindings: usize = @trunc(data[5]);
    const material_base = 6 + (tile_pal + flora_pal + zone_pal) * 3 + bindings * engine.BINDING_FLOATS + chunks.TILE_CELLS;
    const ribbon_base = material_base + chunks.TILE_CELLS;
    const markingAt = struct {
        fn read(stream: []const f32, base: usize, gx: usize, gz: usize) u8 {
            const ref_value: i32 = @trunc(stream[base + gz * chunks.TILE_COLS + gx]);
            const lower = @mod(ref_value, engine.GROUND_UNDERCOAT_REF_STRIDE);
            return @intCast(@divFloor(lower, engine.GROUND_MATERIAL_REF_STRIDE));
        }
    }.read;
    const undercoatAt = struct {
        fn read(stream: []const f32, base: usize, gx: usize, gz: usize) i32 {
            const ref_value: i32 = @trunc(stream[base + gz * chunks.TILE_COLS + gx]);
            return @divFloor(ref_value, engine.GROUND_UNDERCOAT_REF_STRIDE);
        }
    }.read;
    const bindingAt = struct {
        fn read(stream: []const f32, base: usize, gx: usize, gz: usize) i32 {
            const ref_value: i32 = @trunc(stream[base + gz * chunks.TILE_COLS + gx]);
            const lower = @mod(ref_value, engine.GROUND_UNDERCOAT_REF_STRIDE);
            return @mod(lower, engine.GROUND_MATERIAL_REF_STRIDE) - 1;
        }
    }.read;

    const median = markingAt(data, material_base, 60, 60);
    const split = markingAt(data, material_base, 60, 63);
    const shoulder = markingAt(data, material_base, 60, 66);
    try std.testing.expect((median & roads.RoadMarking.yellow_center) != 0);
    try std.testing.expect((split & roads.RoadMarking.white_dash_high) != 0);
    try std.testing.expect((shoulder & roads.RoadMarking.white_solid_high) != 0);
    try std.testing.expectEqual(@as(i32, 1), undercoatAt(data, material_base, 60, 60)); // road over empty ground
    try std.testing.expectEqual(@as(i32, 6), undercoatAt(data, material_base, 60, 66)); // tile kind 4 + token bias
    try std.testing.expectEqual(@as(i32, 0), bindingAt(data, material_base, 60, 66)); // exact prior material binding

    const ribbon_count: usize = @trunc(data[ribbon_base]);
    try std.testing.expectEqual(@as(usize, 1), ribbon_count);
    try std.testing.expectEqual(ribbon_base + engine.GROUND_RIBBON_HEADER_FLOATS + ribbon_count * roads.RIBBON_SEGMENT_FLOATS, written);
    try std.testing.expectApproxEqAbs(@as(f32, 40), data[ribbon_base + 1], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 80), data[ribbon_base + 3], 0.001);
}

test "crosswalk marking contract preserves the semantic leg axis for the ground shader" {
    const east_west = [_]roads.RoadPoint{ .{ .gx = 0, .gz = 10 }, .{ .gx = 30, .gz = 10 } };
    const north_south = [_]roads.RoadPoint{ .{ .gx = 15, .gz = 0 }, .{ .gx = 15, .gz = 25 } };
    const strokes = [_]roads.RoadStroke{
        .{ .id = 1, .points = &east_west, .profile = .{ .lanesF = 1, .lanesB = 1, .sidewalks = true } },
        .{ .id = 2, .points = &north_south, .profile = .{ .lanesF = 1, .lanesB = 1, .sidewalks = true } },
    };
    const plan = try std.testing.allocator.alloc(roads.PlanCell, 16_384);
    defer std.testing.allocator.free(plan);
    const result = roads.planRoads(&strokes, plan);
    try std.testing.expect(!result.truncated);

    var horizontal: ?u8 = null;
    var vertical: ?u8 = null;
    for (plan[0..result.count]) |cell| {
        if (cell.gx == 10 and cell.gz == 10) horizontal = cell.markings;
        if (cell.gx == 15 and cell.gz == 5) vertical = cell.markings;
    }
    try std.testing.expect(horizontal != null and vertical != null);
    try std.testing.expect((horizontal.? & roads.RoadMarking.crosswalk) != 0);
    try std.testing.expect((horizontal.? & roads.RoadMarking.axis_x) != 0);
    try std.testing.expect((vertical.? & roads.RoadMarking.crosswalk) != 0);
    try std.testing.expect((vertical.? & roads.RoadMarking.axis_x) == 0);
}
