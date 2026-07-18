//! V31 compile-cache scaffolding — the content-hash + chunk-cache type system.
//!
//! Implements the SCAFFOLDING half of docs/game/COMPILE_CACHE_ARCHITECTURE.md:
//! the `CompileManifest` + `ChunkOverview` shapes, the content-hashing helpers
//! (sha256 over compiler-abi + source-sig + deps + artifact + summary bytes),
//! the cache storage-layout path builders, the chunk-history row shape, and the
//! Compile telemetry counters.
//!
//! DEPTH (this pass): types + hashing + layout + telemetry ONLY. The actual
//! per-chunk artifact split and reuse-by-hash live in the documented fast-follow;
//! whole-map bake (framework/world/gamefile_writer.zig) stays the fallback. This
//! module owns no I/O of manifests yet — it owns the hashes that make reuse
//! decidable and the paths the artifacts will live at.
//!
//! Hashes are the authority (doc: "Version numbers are not validation. Hashes
//! validate; versions order history."). The canonical hash is the 32-byte sha256
//! digest; the doc's `string` hash fields are the lowercase-hex of that digest
//! (`hexOf`), which is also the content-store key form (matches gamefile.zig's
//! bytesToHex keying and runtime/workspace/sha256.ts byte-parity).
//!
//! INTEGRATION (build.zig — none of this is wired by this pass):
//!   - To unit-test, add a module + test artifact mirroring the
//!     `world_gamefile_writer_test` block (build.zig ~1189): create a module for
//!     framework/world/compile_cache.zig as "world_compile_cache", a module for
//!     framework/world/chunk_dirty.zig as "world_chunk_dirty", and a test module
//!     rooted at framework/testing/unit/compile_cache.zig importing both. See the
//!     INTEGRATION block in that test file for the exact lines.
//!   - When the per-chunk compiler lands, gamefile_writer.zig grows a per-chunk
//!     emit path; this module's `chunkContentHash` keys the artifact and
//!     `Layout.chunkPath` names the `.hgc` file. The whole-map writer stays as
//!     the fallback until the split is proven against the 8 acceptance tests.

const std = @import("std");
const Sha256 = std.crypto.hash.sha2.Sha256;

pub const HASH_BYTES: usize = 32;
pub const Hash = [HASH_BYTES]u8;
pub const ZERO_HASH: Hash = [_]u8{0} ** HASH_BYTES;

/// Manifest schema tag (doc: `schema: 'hmsc.compile_manifest.v1'`). A loader that
/// does not recognise the schema must refuse the manifest (cache ABI is mandatory).
pub const SCHEMA: []const u8 = "hmsc.compile_manifest.v1";

/// The compiler-format identity. A change here MUST change every chunk hash even
/// with no authored edit (doc: "A global compiler ABI change produces new hashes
/// without pretending every authored chunk got a local edit"). Bump the descriptor
/// whenever the chunk artifact wire format, lump set, or hashing framing changes.
pub const COMPILER_ABI_DESCRIPTOR: []const u8 =
    "hmsc.compile_cache.v1;artifact=hgc.v1;merkle=seqfold.v1;sha256";

// Domain tags keep the framings of distinct hash families from colliding even on
// identical input bytes (a source signature never equals an edge signature etc.).
const DOMAIN_CONTENT: []const u8 = "hmsc/chunk/content/v1";
const DOMAIN_SOURCE: []const u8 = "hmsc/chunk/source/v1";
const DOMAIN_DEPS: []const u8 = "hmsc/chunk/deps/v1";
const DOMAIN_EDGE: []const u8 = "hmsc/chunk/edge/v1";
const DOMAIN_SUMMARY: []const u8 = "hmsc/summary/v1";
const DOMAIN_MANIFEST: []const u8 = "hmsc/manifest/root/v1";
const DOMAIN_OVERVIEW_ROOT: []const u8 = "hmsc/manifest/chunks/v1";
const DOMAIN_ABI: []const u8 = "hmsc/compiler/abi/v1";

// ── Geometry ────────────────────────────────────────────────────────────────

/// The chunk-grid address, repurposed from cart/hmsc-int/chunks.ts (`cx,cz`).
/// Chunks are the residency + cache unit (V30), not separate maps.
pub const ChunkCoord = struct {
    cx: i32,
    cz: i32,

    pub fn eql(a: ChunkCoord, b: ChunkCoord) bool {
        return a.cx == b.cx and a.cz == b.cz;
    }
};

/// World-space footprint of a chunk artifact, in meters (doc's `boundsMeters`).
pub const BoundsMeters = struct {
    min_x: f32,
    min_z: f32,
    max_x: f32,
    max_z: f32,
};

/// Per-side boundary signatures. A neighbor is dirty iff the shared edge's
/// signature changed (doc dirty rule + chunk_dirty.zig's edge-neighbor logic).
pub const EdgeSignatures = struct {
    north: Hash,
    east: Hash,
    south: Hash,
    west: Hash,
};

pub const MapKind = enum { city, interior };

/// The global-summary families derived FROM chunk summaries, not by rescanning
/// the whole map (doc "Global Summaries"). Each is content-addressed by its root.
pub const SummaryKind = enum {
    asset_manifest,
    vis_pvs_root,
    traffic_portal_graph,
    nav_supergraph,
    room_portal_index,
    streaming_residency,
    world_bounds_index,
    diagnostics,
};

// ── Manifest + overview shapes ────────────────────────────────────────────────

/// One manifest row — the cheap validation handle for one compiled chunk.
/// Mirrors the doc's `ChunkOverview`. `chunkHash` is the content-addressed
/// validation string for the whole compiled chunk; `localVersion` only orders
/// history. An exact `chunkHash` match means reuse with no deep revalidation.
pub const ChunkOverview = struct {
    coord: ChunkCoord,
    local_version: u32,
    chunk_hash: Hash,
    previous_chunk_hash: ?Hash = null,
    source_signature_hash: Hash,
    dependency_hash: Hash,
    artifact_hash: Hash,
    summary_hash: Hash,
    byte_length: u32,
    bounds_meters: BoundsMeters,
    edge_signatures: EdgeSignatures,
    /// Path/key into history/<mapId>/<cx>_<cz>.jsonl (doc storage layout).
    history_ref: []const u8,
};

/// A global summary the loader needs to assemble the world (doc `GlobalSummaryRef`).
pub const GlobalSummaryRef = struct {
    kind: SummaryKind,
    summary_hash: Hash,
    byte_length: u32,
};

/// Small, immutable, content-addressed map descriptor (doc `CompileManifest`).
/// The manifest is the authority for reconstructing the compiled world; it is
/// append-only and the "current" pointer is swapped atomically on success.
pub const CompileManifest = struct {
    schema: []const u8 = SCHEMA,
    manifest_hash: Hash,
    parent_manifest_hash: ?Hash = null,
    map_id: []const u8,
    map_kind: MapKind,
    created_at: []const u8, // ISO-8601 wall-clock metadata; the hash is authority.
    compiler_abi_hash: Hash,
    source_snapshot_hash: Hash,
    asset_manifest_hash: Hash,
    global_config_hash: Hash,
    chunk_overview_root_hash: Hash,
    chunks: []const ChunkOverview,
    global_summaries: []const GlobalSummaryRef,

    /// Recompute the Merkle root over this manifest's content (doc: compiler ABI,
    /// global config, asset manifest, ordered chunk overview hashes, summary
    /// hashes). Caller compares against `manifest_hash` to validate; the
    /// hash NEVER reads `created_at` / `local_version` (metadata, not content).
    pub fn computeRoot(self: CompileManifest, allocator: std.mem.Allocator) error{OutOfMemory}!Hash {
        const chunk_hashes = try allocator.alloc(Hash, self.chunks.len);
        defer allocator.free(chunk_hashes);
        for (self.chunks, 0..) |c, i| chunk_hashes[i] = c.chunk_hash;

        const summary_hashes = try allocator.alloc(Hash, self.global_summaries.len);
        defer allocator.free(summary_hashes);
        for (self.global_summaries, 0..) |s, i| summary_hashes[i] = s.summary_hash;

        return manifestRootHash(
            self.compiler_abi_hash,
            self.global_config_hash,
            self.asset_manifest_hash,
            chunk_hashes,
            summary_hashes,
        );
    }

    /// Cheap revalidation: the stored root equals a freshly recomputed one.
    pub fn rootMatches(self: CompileManifest, allocator: std.mem.Allocator) error{OutOfMemory}!bool {
        const recomputed = try self.computeRoot(allocator);
        return std.mem.eql(u8, &recomputed, &self.manifest_hash);
    }
};

/// One row in history/<mapId>/<cx>_<cz>.jsonl (doc `ChunkHistoryRow`). GC treats
/// retained history rows as roots: a chunk artifact is deletable only once no
/// retained manifest/history row references its hash.
pub const ChunkHistoryReason = enum { compile, restore, compiler_abi, repair };

pub const ChunkHistoryRow = struct {
    coord: ChunkCoord,
    local_version: u32,
    chunk_hash: Hash,
    parent_chunk_hash: ?Hash = null,
    manifest_hash: Hash,
    source_signature_hash: Hash,
    dependency_hash: Hash,
    reason: ChunkHistoryReason,
    label: ?[]const u8 = null,
    created_at: []const u8,
};

// ── Content hashing ──────────────────────────────────────────────────────────

/// Raw sha256 of a byte buffer — the content-store address (matches gamefile.zig
/// and runtime/workspace/sha256.ts).
pub fn hashBytes(bytes: []const u8) Hash {
    var out: Hash = undefined;
    Sha256.hash(bytes, &out, .{});
    return out;
}

/// Lowercase-hex of a digest: the doc's `string` hash form and the on-disk key.
pub fn hexOf(hash: Hash) [HASH_BYTES * 2]u8 {
    return std.fmt.bytesToHex(hash, .lower);
}

// Length-prefixed absorb so concatenation of variable-length fields is
// unambiguous (a||b can never collide with a'||b').
fn absorb(h: *Sha256, bytes: []const u8) void {
    var len_buf: [8]u8 = undefined;
    std.mem.writeInt(u64, &len_buf, bytes.len, .little);
    h.update(&len_buf);
    h.update(bytes);
}

/// The compiler ABI hash. Hashing the descriptor (rather than trusting a version
/// int) means a format change is detectable content. Defaults to
/// `COMPILER_ABI_DESCRIPTOR`; pass an override to bake a tuning fingerprint in.
pub fn compilerAbiHash(descriptor: []const u8) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_ABI);
    absorb(&h, descriptor);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Signature of one chunk's authoring source bytes (tiles/heights/zones/flora/…
/// for that chunk's cells). Distinct domain from edge/deps so equal bytes hash
/// differently per role.
pub fn sourceSignatureHash(source_bytes: []const u8) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_SOURCE);
    absorb(&h, source_bytes);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Signature of a chunk's external dependencies (referenced asset hashes, shared
/// dictionary ids, global config slices it reads). Stable content-addressed ids
/// here avoid the "global dictionary dirties the whole map" hazard.
pub fn dependencyHash(dependency_bytes: []const u8) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_DEPS);
    absorb(&h, dependency_bytes);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Signature of one chunk boundary's shared cells. Two neighbors agree on a
/// boundary iff these match; a mismatch is exactly what dirties the neighbor.
pub fn edgeSignatureHash(boundary_bytes: []const u8) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_EDGE);
    absorb(&h, boundary_bytes);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Signature of a chunk's summary contribution to the global systems.
pub fn summaryHash(summary_bytes: []const u8) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_SUMMARY);
    absorb(&h, summary_bytes);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Inputs to the whole-chunk content hash (doc: derived from compiler ABI, local
/// source signature, dependency signature, output artifact bytes, summary bytes).
pub const ChunkHashInputs = struct {
    compiler_abi: Hash,
    source_signature: Hash,
    dependency_signature: Hash,
    artifact: []const u8,
    summary: []const u8,
};

/// The content-addressed validation string for one compiled chunk (`chunkHash`).
/// This IS the reuse key: an exact match means do not recompile, do not
/// deep-revalidate. Deterministic and stable for identical inputs.
pub fn chunkContentHash(inputs: ChunkHashInputs) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_CONTENT);
    absorb(&h, &inputs.compiler_abi);
    absorb(&h, &inputs.source_signature);
    absorb(&h, &inputs.dependency_signature);
    absorb(&h, inputs.artifact);
    absorb(&h, inputs.summary);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Deterministic fold over an ordered list of hashes — a content-addressed root
/// for an ordered set. (A sequential fold, not a binary tree; sufficient as the
/// manifest/overview root for the scaffolding pass. Domain-tagged so the chunk
/// root and the manifest root never collide.)
fn foldHashes(domain: []const u8, hashes: []const Hash) Hash {
    var h = Sha256.init(.{});
    h.update(domain);
    var count_buf: [8]u8 = undefined;
    std.mem.writeInt(u64, &count_buf, hashes.len, .little);
    h.update(&count_buf);
    for (hashes) |item| h.update(&item);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

/// Root over the manifest's ordered chunk hashes (the doc's
/// `chunkOverviewRootHash`).
pub fn chunkOverviewRootHash(chunk_hashes: []const Hash) Hash {
    return foldHashes(DOMAIN_OVERVIEW_ROOT, chunk_hashes);
}

/// The manifest Merkle root (doc: over compiler ABI, global config, asset
/// manifest, ordered chunk overview hashes, global summary hashes).
pub fn manifestRootHash(
    compiler_abi: Hash,
    global_config: Hash,
    asset_manifest: Hash,
    chunk_hashes: []const Hash,
    summary_hashes: []const Hash,
) Hash {
    var h = Sha256.init(.{});
    h.update(DOMAIN_MANIFEST);
    h.update(&compiler_abi);
    h.update(&global_config);
    h.update(&asset_manifest);
    const chunk_root = chunkOverviewRootHash(chunk_hashes);
    h.update(&chunk_root);
    const summary_root = foldHashes(DOMAIN_OVERVIEW_ROOT, summary_hashes);
    h.update(&summary_root);
    var out: Hash = undefined;
    h.final(&out);
    return out;
}

// ── Storage layout ────────────────────────────────────────────────────────────

/// Logical cache layout (doc "Storage Layout"). The backing store may be FS or
/// SQLite; these are the relative path builders for the FS form. The longest
/// path is history/<mapId>/<cx>_<cz>.jsonl, bounded by `MAX_PATH`.
pub const Layout = struct {
    pub const manifests_dir: []const u8 = "manifests";
    pub const chunks_dir: []const u8 = "chunks";
    pub const summaries_dir: []const u8 = "summaries";
    pub const assets_dir: []const u8 = "assets";
    pub const history_dir: []const u8 = "history";
    pub const current_dir: []const u8 = "current";

    /// Bound for the path buffers below: dir + '/' + 64-hex + ".manifest"/jsonl
    /// plus a generous map-id allowance.
    pub const MAX_PATH: usize = 256;

    pub fn manifestPath(buf: []u8, manifest_hash: Hash) []const u8 {
        const hex = hexOf(manifest_hash);
        return std.fmt.bufPrint(buf, "{s}/{s}.json", .{ manifests_dir, hex }) catch unreachable;
    }

    pub fn chunkPath(buf: []u8, chunk_hash: Hash) []const u8 {
        const hex = hexOf(chunk_hash);
        return std.fmt.bufPrint(buf, "{s}/{s}.hgc", .{ chunks_dir, hex }) catch unreachable;
    }

    pub fn summaryPath(buf: []u8, summary_hash_value: Hash) []const u8 {
        const hex = hexOf(summary_hash_value);
        return std.fmt.bufPrint(buf, "{s}/{s}.bin", .{ summaries_dir, hex }) catch unreachable;
    }

    pub fn assetPath(buf: []u8, asset_hash: Hash) []const u8 {
        const hex = hexOf(asset_hash);
        return std.fmt.bufPrint(buf, "{s}/{s}", .{ assets_dir, hex }) catch unreachable;
    }

    pub fn historyPath(buf: []u8, map_id: []const u8, coord: ChunkCoord) error{NoSpaceLeft}![]const u8 {
        return std.fmt.bufPrint(buf, "{s}/{s}/{d}_{d}.jsonl", .{ history_dir, map_id, coord.cx, coord.cz });
    }

    pub fn currentPath(buf: []u8, map_id: []const u8) error{NoSpaceLeft}![]const u8 {
        return std.fmt.bufPrint(buf, "{s}/{s}.manifest", .{ current_dir, map_id });
    }

    /// Create the fixed top-level subdirectories under an opened cache root.
    /// `history/<mapId>` is created on demand by the writer (map-id varies).
    pub fn ensure(io: std.Io, root: std.Io.Dir) !void {
        try root.createDirPath(io, manifests_dir);
        try root.createDirPath(io, chunks_dir);
        try root.createDirPath(io, summaries_dir);
        try root.createDirPath(io, assets_dir);
        try root.createDirPath(io, history_dir);
        try root.createDirPath(io, current_dir);
    }
};

// ── Telemetry ─────────────────────────────────────────────────────────────────

/// Per-Compile counters (doc acceptance test: "Compile telemetry reports changed
/// chunks, reused chunks, rebuilt chunks, cache hit rate, and bytes reused").
/// `changed` = chunks whose source/deps changed; `rebuilt` = chunks recompiled
/// (subset of changed plus quarantine repairs); `reused` = exact-hash hits.
pub const Telemetry = struct {
    changed: u32 = 0,
    reused: u32 = 0,
    rebuilt: u32 = 0,
    quarantined: u32 = 0,
    bytes_reused: u64 = 0,
    bytes_rebuilt: u64 = 0,

    pub fn recordReused(self: *Telemetry, byte_length: u32) void {
        self.reused += 1;
        self.bytes_reused += byte_length;
    }

    pub fn recordRebuilt(self: *Telemetry, byte_length: u32) void {
        self.rebuilt += 1;
        self.changed += 1;
        self.bytes_rebuilt += byte_length;
    }

    pub fn recordQuarantine(self: *Telemetry) void {
        self.quarantined += 1;
    }

    /// Reused chunks over total chunks considered (reused + rebuilt). Returns 0
    /// when no chunks were considered.
    pub fn cacheHitRate(self: Telemetry) f32 {
        const total = self.reused + self.rebuilt;
        if (total == 0) return 0;
        return @as(f32, @floatFromInt(self.reused)) / @as(f32, @floatFromInt(total));
    }
};
