//! Unit coverage for the V31 compile-cache scaffolding:
//!   framework/world/compile_cache.zig (content hashing, manifest root, layout)
//!   framework/world/chunk_dirty.zig   (dirty region + subsystem halos)
//!
//! Asserts the doc's first two acceptance behaviors at the scaffolding layer (a
//! tile edit dirties exactly its chunk; a chunk-edge edit dirties that chunk plus
//! the neighbor whose edge signature changed) plus content-hash round-trip and
//! stability. Does NOT exercise per-chunk artifact split / reuse-by-hash — that
//! is the documented fast-follow; whole-map bake remains the fallback.
//!
//! INTEGRATION (build.zig — mirror the `world_gamefile_writer_test` block, ~1189):
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
//!   const compile_cache_test_mod = b.createModule(.{
//!       .root_source_file = b.path("framework/testing/unit/compile_cache.zig"),
//!       .target = target, .optimize = optimize, .link_libc = true,
//!   });
//!   compile_cache_test_mod.addImport("world_compile_cache", world_compile_cache_mod);
//!   compile_cache_test_mod.addImport("world_chunk_dirty", world_chunk_dirty_mod);
//!   const compile_cache_test = b.addTest(.{
//!       .name = "world-compile-cache-test", .root_module = compile_cache_test_mod,
//!   });
//!   const run_compile_cache_test = b.addRunArtifact(compile_cache_test);
//!   const compile_cache_test_step = b.step(
//!       "test-world-compile-cache", "Run the V31 compile-cache scaffolding tests");
//!   compile_cache_test_step.dependOn(&run_compile_cache_test.step);
//!   // and fold compile_cache_test_step into the aggregate test step.

const std = @import("std");
const testing = std.testing;
const cache = @import("world_compile_cache");
const dirty = @import("world_chunk_dirty");

test "a tile edit dirties exactly its chunk" {
    // Tile (60,60) is interior to chunk (0,0): not on any chunk boundary tile.
    const edit = dirty.Edit{ .kind = .paint, .bounds = dirty.TileRect.single(60, 60) };
    const region = try dirty.computeDirty(testing.allocator, edit);
    defer region.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 1), region.count());
    const only = region.find(.{ .cx = 0, .cz = 0 }).?;
    try testing.expect(only.has(.source));
    try testing.expect(only.mustRebuild());
    try testing.expect(!only.has(.edge));
}

test "a chunk-edge edit dirties that chunk plus the boundary neighbor" {
    // Tile (119,60) is the east boundary tile of chunk (0,0): its shared east edge
    // changes, so chunk (1,0) rebuilds too — and nobody else.
    const edit = dirty.Edit{ .kind = .border, .bounds = dirty.TileRect.single(119, 60) };
    const region = try dirty.computeDirty(testing.allocator, edit);
    defer region.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 2), region.count());

    const owner = region.find(.{ .cx = 0, .cz = 0 }).?;
    try testing.expect(owner.has(.source));

    const neighbor = region.find(.{ .cx = 1, .cz = 0 }).?;
    try testing.expect(neighbor.has(.edge));
    try testing.expect(neighbor.mustRebuild());

    // The off-axis neighbors did not move.
    try testing.expect(!region.contains(.{ .cx = 0, .cz = 1 }));
    try testing.expect(!region.contains(.{ .cx = -1, .cz = 0 }));
}

test "an interior tile declares a subsystem halo without dirtying off-halo chunks" {
    // A footprint edit interior to (1,1) declaring a 1-ring nav halo: the base
    // chunk is source, the 8 surrounding chunks carry only the nav concern.
    const halos = [_]dirty.HaloDecl{.{ .subsystem = .nav, .radius_chunks = 1 }};
    const edit = dirty.Edit{
        .kind = .footprint,
        .bounds = dirty.TileRect.single(180, 180), // chunk (1,1) interior
        .halos = &halos,
    };
    const region = try dirty.computeDirty(testing.allocator, edit);
    defer region.deinit(testing.allocator);

    // 3x3 ring of chunks around (1,1).
    try testing.expectEqual(@as(usize, 9), region.count());

    const base = region.find(.{ .cx = 1, .cz = 1 }).?;
    try testing.expect(base.has(.source));

    const halo_only = region.find(.{ .cx = 2, .cz = 2 }).?;
    try testing.expect(halo_only.has(.nav));
    try testing.expect(!halo_only.has(.source));
    try testing.expect(!halo_only.mustRebuild()); // halo touch is not a rebuild

    // Two rings out is untouched: the declared radius was exactly 1.
    try testing.expect(!region.contains(.{ .cx = 3, .cz = 1 }));
}

test "chunkOfTile floors negative tiles to the left chunk" {
    try testing.expectEqual(dirty.ChunkCoord{ .cx = 0, .cz = 0 }, dirty.chunkOfTile(0, 0));
    try testing.expectEqual(dirty.ChunkCoord{ .cx = 0, .cz = 0 }, dirty.chunkOfTile(119, 119));
    try testing.expectEqual(dirty.ChunkCoord{ .cx = 1, .cz = 1 }, dirty.chunkOfTile(120, 120));
    try testing.expectEqual(dirty.ChunkCoord{ .cx = -1, .cz = -1 }, dirty.chunkOfTile(-1, -1));
}

test "chunk content hash is deterministic and stable for identical inputs" {
    const abi = cache.compilerAbiHash(cache.COMPILER_ABI_DESCRIPTOR);
    const inputs = cache.ChunkHashInputs{
        .compiler_abi = abi,
        .source_signature = cache.sourceSignatureHash("tiles+heights+zones"),
        .dependency_signature = cache.dependencyHash("asset:road,asset:grass"),
        .artifact = "compiled-chunk-bytes",
        .summary = "summary-bytes",
    };
    const a = cache.chunkContentHash(inputs);
    const b = cache.chunkContentHash(inputs);
    try testing.expectEqualSlices(u8, &a, &b);
    try testing.expect(!std.mem.eql(u8, &a, &cache.ZERO_HASH));

    // hex round-trip is the on-disk key form.
    const hex = cache.hexOf(a);
    try testing.expectEqual(@as(usize, 64), hex.len);
}

test "changing any single hash input changes the chunk hash" {
    const abi = cache.compilerAbiHash(cache.COMPILER_ABI_DESCRIPTOR);
    const base = cache.ChunkHashInputs{
        .compiler_abi = abi,
        .source_signature = cache.sourceSignatureHash("source-A"),
        .dependency_signature = cache.dependencyHash("deps-A"),
        .artifact = "artifact-A",
        .summary = "summary-A",
    };
    const base_hash = cache.chunkContentHash(base);

    var changed_source = base;
    changed_source.source_signature = cache.sourceSignatureHash("source-B");
    try testing.expect(!std.mem.eql(u8, &base_hash, &cache.chunkContentHash(changed_source)));

    var changed_artifact = base;
    changed_artifact.artifact = "artifact-B";
    try testing.expect(!std.mem.eql(u8, &base_hash, &cache.chunkContentHash(changed_artifact)));

    var changed_abi = base;
    changed_abi.compiler_abi = cache.compilerAbiHash("different.abi.v2");
    try testing.expect(!std.mem.eql(u8, &base_hash, &cache.chunkContentHash(changed_abi)));
}

test "distinct hash domains do not collide on identical bytes" {
    // Same bytes hashed as a source signature vs an edge signature must differ.
    const same = "boundary-cells";
    try testing.expect(!std.mem.eql(
        u8,
        &cache.sourceSignatureHash(same),
        &cache.edgeSignatureHash(same),
    ));
}

test "manifest root recomputes stably and reflects chunk membership" {
    const abi = cache.compilerAbiHash(cache.COMPILER_ABI_DESCRIPTOR);
    const cfg = cache.hashBytes("global-config");
    const assets = cache.hashBytes("asset-manifest");

    const overview = cache.ChunkOverview{
        .coord = .{ .cx = 0, .cz = 0 },
        .local_version = 1,
        .chunk_hash = cache.chunkContentHash(.{
            .compiler_abi = abi,
            .source_signature = cache.sourceSignatureHash("s"),
            .dependency_signature = cache.dependencyHash("d"),
            .artifact = "a",
            .summary = "sum",
        }),
        .source_signature_hash = cache.sourceSignatureHash("s"),
        .dependency_hash = cache.dependencyHash("d"),
        .artifact_hash = cache.hashBytes("a"),
        .summary_hash = cache.summaryHash("sum"),
        .byte_length = 1,
        .bounds_meters = .{ .min_x = 0, .min_z = 0, .max_x = 120, .max_z = 120 },
        .edge_signatures = .{
            .north = cache.edgeSignatureHash("n"),
            .east = cache.edgeSignatureHash("e"),
            .south = cache.edgeSignatureHash("s"),
            .west = cache.edgeSignatureHash("w"),
        },
        .history_ref = "history/city/0_0.jsonl",
    };
    const chunks = [_]cache.ChunkOverview{overview};
    const summaries = [_]cache.GlobalSummaryRef{};

    const chunk_hashes = [_]cache.Hash{overview.chunk_hash};
    const root = cache.manifestRootHash(abi, cfg, assets, &chunk_hashes, &.{});

    var manifest = cache.CompileManifest{
        .manifest_hash = root,
        .map_id = "city",
        .map_kind = .city,
        .created_at = "2026-06-30T00:00:00Z",
        .compiler_abi_hash = abi,
        .source_snapshot_hash = cache.hashBytes("snapshot"),
        .asset_manifest_hash = assets,
        .global_config_hash = cfg,
        .chunk_overview_root_hash = cache.chunkOverviewRootHash(&chunk_hashes),
        .chunks = &chunks,
        .global_summaries = &summaries,
    };

    try testing.expect(try manifest.rootMatches(testing.allocator));

    // Re-running Compile with no edits reproduces the identical root (the
    // doc's "reuses every chunk" property at the hash layer).
    const root_again = try manifest.computeRoot(testing.allocator);
    try testing.expectEqualSlices(u8, &root, &root_again);

    // A different recorded root no longer validates.
    manifest.manifest_hash = cache.hashBytes("tampered");
    try testing.expect(!try manifest.rootMatches(testing.allocator));
}

test "storage layout builds the documented paths" {
    const h = cache.hashBytes("x");
    const hex = cache.hexOf(h);

    var buf: [cache.Layout.MAX_PATH]u8 = undefined;

    const manifest_path = cache.Layout.manifestPath(&buf, h);
    try testing.expect(std.mem.startsWith(u8, manifest_path, "manifests/"));
    try testing.expect(std.mem.endsWith(u8, manifest_path, ".json"));
    try testing.expect(std.mem.indexOf(u8, manifest_path, &hex) != null);

    const chunk_path = cache.Layout.chunkPath(&buf, h);
    try testing.expect(std.mem.startsWith(u8, chunk_path, "chunks/"));
    try testing.expect(std.mem.endsWith(u8, chunk_path, ".hgc"));

    const summary_path = cache.Layout.summaryPath(&buf, h);
    try testing.expect(std.mem.endsWith(u8, summary_path, ".bin"));

    const asset_path = cache.Layout.assetPath(&buf, h);
    try testing.expect(std.mem.startsWith(u8, asset_path, "assets/"));

    const history_path = try cache.Layout.historyPath(&buf, "city", .{ .cx = 3, .cz = 2 });
    try testing.expectEqualStrings("history/city/3_2.jsonl", history_path);

    const current_path = try cache.Layout.currentPath(&buf, "city");
    try testing.expectEqualStrings("current/city.manifest", current_path);
}

test "storage layout creates its directories through injected io" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try cache.Layout.ensure(testing.io, tmp.dir);

    inline for (.{
        cache.Layout.manifests_dir,
        cache.Layout.chunks_dir,
        cache.Layout.summaries_dir,
        cache.Layout.assets_dir,
        cache.Layout.history_dir,
        cache.Layout.current_dir,
    }) |name| {
        var dir = try tmp.dir.openDir(testing.io, name, .{});
        dir.close(testing.io);
    }
}

test "telemetry tallies reuse vs rebuild and hit rate" {
    var tel = cache.Telemetry{};
    tel.recordReused(1000);
    tel.recordReused(2000);
    tel.recordRebuilt(500);

    try testing.expectEqual(@as(u32, 2), tel.reused);
    try testing.expectEqual(@as(u32, 1), tel.rebuilt);
    try testing.expectEqual(@as(u32, 1), tel.changed);
    try testing.expectEqual(@as(u64, 3000), tel.bytes_reused);
    try testing.expectEqual(@as(u64, 500), tel.bytes_rebuilt);
    try testing.expectApproxEqAbs(@as(f32, 2.0 / 3.0), tel.cacheHitRate(), 0.0001);

    var empty = cache.Telemetry{};
    try testing.expectEqual(@as(f32, 0), empty.cacheHitRate());
}
