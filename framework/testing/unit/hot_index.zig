//! Unit coverage for the HOT AUTHORING-STATE INDEX (framework/editor/hot_index.zig).
//!
//! Asserts the placement-latency doctrine at the index layer:
//!   - feeding events updates the by-id and by-chunk indices correctly;
//!   - a `chunk` target dirties exactly that chunk;
//!   - an object target dirties its chunk by resolving through the index (no scan);
//!   - re-homing a placed object moves it between chunk buckets;
//!   - SCALING: with the index pre-loaded with many objects, ONE observe() touches
//!     a bounded amount of work, independent of the index size (the O(1) gate).
//!
//! Uses testing.allocator so any leak in the fold/teardown paths fails the test.
//!
//! INTEGRATION (build.zig — mirror the world_gamefile_writer_test block, ~1189).
//! hot_index.zig imports two sibling modules; the test rig must provide BOTH to
//! the index module AND to this test module:
//!
//!   const world_compile_cache_mod = b.createModule(.{
//!       .root_source_file = b.path("framework/world/compile_cache.zig"),
//!       .target = target, .optimize = optimize, .link_libc = true,
//!   });
//!   const world_chunk_dirty_mod = b.createModule(.{
//!       .root_source_file = b.path("framework/world/chunk_dirty.zig"),
//!       .target = target, .optimize = optimize, .link_libc = true,
//!   });
//!   world_chunk_dirty_mod.addImport("world_compile_cache", world_compile_cache_mod);
//!   const hot_index_mod_for_tests = b.createModule(.{
//!       .root_source_file = b.path("framework/editor/hot_index.zig"),
//!       .target = target, .optimize = optimize, .link_libc = true,
//!   });
//!   hot_index_mod_for_tests.addImport("world_chunk_dirty", world_chunk_dirty_mod);
//!   hot_index_mod_for_tests.addImport("world_compile_cache", world_compile_cache_mod);
//!   const hot_index_test_mod = b.createModule(.{
//!       .root_source_file = b.path("framework/testing/unit/hot_index.zig"),
//!       .target = target, .optimize = optimize, .link_libc = true,
//!   });
//!   hot_index_test_mod.addImport("hot_index", hot_index_mod_for_tests);
//!   hot_index_test_mod.addImport("world_chunk_dirty", world_chunk_dirty_mod);
//!   hot_index_test_mod.addImport("world_compile_cache", world_compile_cache_mod);
//!   const hot_index_test = b.addTest(.{
//!       .name = "hot-index-test", .root_module = hot_index_test_mod,
//!   });
//!   const run_hot_index_test = b.addRunArtifact(hot_index_test);
//!   const hot_index_test_step = b.step("test-hot-index", "Run the hot authoring-state index unit tests");
//!   hot_index_test_step.dependOn(&run_hot_index_test.step);
//!   // and fold hot_index_test_step into the aggregate test step.

const std = @import("std");
const testing = std.testing;
const hot_index = @import("hot_index");
const chunk_dirty = @import("world_chunk_dirty");

const ChunkCoord = chunk_dirty.ChunkCoord;

/// Build a minimal confirmed-envelope JSON with the given targets array body.
/// `targets_json` is the raw inner array text, e.g. `{"kind":"chunk","id":"3,2"}`.
fn envelope(buf: []u8, seq: i64, etype: []const u8, targets_json: []const u8) []const u8 {
    return std.fmt.bufPrint(
        buf,
        \\{{"seq":{d},"origin":"local","ts":0,"type":"{s}","targets":[{s}],"payload":{{}}}}
    ,
        .{ seq, etype, targets_json },
    ) catch unreachable;
}

test "a chunk target dirties exactly that chunk" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var buf: [256]u8 = undefined;
    const env = envelope(&buf, 1, "tile.paint", "{\"kind\":\"chunk\",\"id\":\"3,2\"}");
    try testing.expect(ix.observe(1, env));

    try testing.expectEqual(@as(usize, 1), ix.dirtyChunkCount());
    try testing.expect(ix.chunkIsDirty(.{ .cx = 3, .cz = 2 }));
    try testing.expect(!ix.chunkIsDirty(.{ .cx = 0, .cz = 0 }));
    // A chunk-only edit places no object.
    try testing.expectEqual(@as(usize, 0), ix.objectCount());
}

test "placing an object updates by-id + by-chunk and dirties its chunk" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var buf: [256]u8 = undefined;
    // place piece 'wall-7' in chunk 3,2 (object ref + chunk ref, the place shape).
    const env = envelope(&buf, 1, "piece.place", "{\"kind\":\"piece\",\"id\":\"wall-7\"},{\"kind\":\"chunk\",\"id\":\"3,2\"}");
    try testing.expect(ix.observe(1, env));

    try testing.expectEqual(@as(usize, 1), ix.objectCount());
    try testing.expect(ix.hasObject("wall-7"));
    // by-id resolver records the membership (object→chunk, no scan).
    try testing.expect(ix.objectInChunk("wall-7", .{ .cx = 3, .cz = 2 }));
    // by-chunk reverse index lists it.
    try testing.expectEqual(@as(usize, 1), ix.objectsInChunk(.{ .cx = 3, .cz = 2 }));
    // and the chunk is dirty + the id is dirty.
    try testing.expect(ix.chunkIsDirty(.{ .cx = 3, .cz = 2 }));
    try testing.expectEqual(@as(usize, 1), ix.dirtyIdCount());
}

test "an object target with no new chunk dirties its chunk via the index" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var buf: [256]u8 = undefined;
    // place, then clear dirty, then update the object WITHOUT a chunk ref.
    const place = envelope(&buf, 1, "piece.place", "{\"kind\":\"piece\",\"id\":\"lamp-1\"},{\"kind\":\"chunk\",\"id\":\"5,5\"}");
    try testing.expect(ix.observe(1, place));
    ix.clearDirty();
    try testing.expectEqual(@as(usize, 0), ix.dirtyChunkCount());

    var buf2: [256]u8 = undefined;
    const update = envelope(&buf2, 2, "piece.update", "{\"kind\":\"piece\",\"id\":\"lamp-1\"}");
    try testing.expect(ix.observe(2, update));

    // Resolved through the by-id entry, NOT by scanning the world.
    try testing.expect(ix.chunkIsDirty(.{ .cx = 5, .cz = 5 }));
    try testing.expectEqual(@as(usize, 1), ix.dirtyChunkCount());
}

test "re-homing a moved object moves it between chunk buckets" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var b1: [256]u8 = undefined;
    const place = envelope(&b1, 1, "piece.place", "{\"kind\":\"piece\",\"id\":\"car-9\"},{\"kind\":\"chunk\",\"id\":\"0,0\"}");
    try testing.expect(ix.observe(1, place));
    try testing.expectEqual(@as(usize, 1), ix.objectsInChunk(.{ .cx = 0, .cz = 0 }));

    var b2: [256]u8 = undefined;
    const move = envelope(&b2, 2, "piece.move", "{\"kind\":\"piece\",\"id\":\"car-9\"},{\"kind\":\"chunk\",\"id\":\"1,0\"}");
    try testing.expect(ix.observe(2, move));

    // Left the old chunk, joined the new one — both end up dirty.
    try testing.expectEqual(@as(usize, 0), ix.objectsInChunk(.{ .cx = 0, .cz = 0 }));
    try testing.expectEqual(@as(usize, 1), ix.objectsInChunk(.{ .cx = 1, .cz = 0 }));
    try testing.expect(ix.objectInChunk("car-9", .{ .cx = 1, .cz = 0 }));
    try testing.expect(!ix.objectInChunk("car-9", .{ .cx = 0, .cz = 0 }));
    try testing.expect(ix.chunkIsDirty(.{ .cx = 0, .cz = 0 }));
    try testing.expect(ix.chunkIsDirty(.{ .cx = 1, .cz = 0 }));
    // Still exactly one object.
    try testing.expectEqual(@as(usize, 1), ix.objectCount());
}

test "removeObject drops it from buckets and dirties the vacated chunk" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var buf: [256]u8 = undefined;
    const env = envelope(&buf, 1, "piece.place", "{\"kind\":\"piece\",\"id\":\"x\"},{\"kind\":\"chunk\",\"id\":\"2,2\"}");
    try testing.expect(ix.observe(1, env));
    ix.clearDirty();

    ix.removeObject("x");
    try testing.expectEqual(@as(usize, 0), ix.objectCount());
    try testing.expectEqual(@as(usize, 0), ix.objectsInChunk(.{ .cx = 2, .cz = 2 }));
    try testing.expect(ix.chunkIsDirty(.{ .cx = 2, .cz = 2 }));
}

test "selection mutators + summaryJson reflect counts" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var buf: [256]u8 = undefined;
    const env = envelope(&buf, 7, "piece.place", "{\"kind\":\"piece\",\"id\":\"a\"},{\"kind\":\"chunk\",\"id\":\"1,1\"}");
    try testing.expect(ix.observe(7, env));

    try ix.select("a");
    try ix.select("a"); // idempotent
    try testing.expectEqual(@as(usize, 1), ix.selectedCount());
    try testing.expect(ix.isSelected("a"));

    const json = try ix.summaryJson(testing.allocator);
    defer testing.allocator.free(json);
    try expectContains(json, "\"objects\":1");
    try expectContains(json, "\"dirtyChunks\":1");
    try expectContains(json, "\"selected\":1");
    try expectContains(json, "\"lastSeq\":7");

    ix.deselect("a");
    try testing.expectEqual(@as(usize, 0), ix.selectedCount());
}

test "markBaked clears a chunk's dirty flag and records the signature" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    var buf: [256]u8 = undefined;
    const env = envelope(&buf, 1, "tile.paint", "{\"kind\":\"chunk\",\"id\":\"4,4\"}");
    try testing.expect(ix.observe(1, env));
    try testing.expect(ix.chunkIsDirty(.{ .cx = 4, .cz = 4 }));

    const sig = [_]u8{0xAB} ** 32;
    try ix.markBaked(.{ .cx = 4, .cz = 4 }, sig);
    try testing.expect(!ix.chunkIsDirty(.{ .cx = 4, .cz = 4 }));
    const got = ix.bakedSignature(.{ .cx = 4, .cz = 4 }) orelse return error.NoSignature;
    try testing.expect(std.mem.eql(u8, &got, &sig));
}

test "malformed envelope leaves the index unchanged" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();
    try testing.expect(!ix.observe(1, "not json"));
    try testing.expect(!ix.observe(1, "[1,2,3]")); // valid json, not an object
    try testing.expectEqual(@as(usize, 0), ix.objectCount());
}

test "SCALING: one observe touches bounded work regardless of index size" {
    var ix = hot_index.HotIndex.init(testing.allocator);
    defer ix.deinit();

    // Pre-load the index with many objects, each in its own distinct chunk.
    const N: i32 = 20_000;
    var i: i32 = 0;
    var buf: [320]u8 = undefined;
    while (i < N) : (i += 1) {
        var tbuf: [128]u8 = undefined;
        const targets = std.fmt.bufPrint(
            &tbuf,
            "{{\"kind\":\"piece\",\"id\":\"obj-{d}\"}},{{\"kind\":\"chunk\",\"id\":\"{d},0\"}}",
            .{ i, i },
        ) catch unreachable;
        const env = envelope(&buf, i + 1, "piece.place", targets);
        try testing.expect(ix.observe(i + 1, env));
    }
    try testing.expectEqual(@as(usize, @intCast(N)), ix.objectCount());

    // One more edit, touching ONE existing object. Its fold cost must be bounded
    // by the event's own targets×chunks — NOT by the 20k already in the index.
    var b2: [256]u8 = undefined;
    const move = envelope(&b2, N + 1, "piece.move", "{\"kind\":\"piece\",\"id\":\"obj-100\"},{\"kind\":\"chunk\",\"id\":\"5,5\"}");
    try testing.expect(ix.observe(N + 1, move));

    // The O(1) gate: the last fold's index touches are a small constant. (One
    // object ref + one chunk ref, each occupying a single chunk → well under 16.)
    try testing.expect(hot_index.last_observe_work < 16);

    // And it actually did the work: obj-100 moved to chunk 5,5.
    try testing.expect(ix.objectInChunk("obj-100", .{ .cx = 5, .cz = 5 }));
    try testing.expectEqual(@as(usize, @intCast(N)), ix.objectCount());
}

fn expectContains(haystack: []const u8, needle: []const u8) !void {
    if (std.mem.indexOf(u8, haystack, needle) == null) {
        std.debug.print("expected to find '{s}' in '{s}'\n", .{ needle, haystack });
        return error.NotFound;
    }
}
