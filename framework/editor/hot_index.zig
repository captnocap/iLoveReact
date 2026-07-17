//! hot_index.zig — the HOT AUTHORING-STATE INDEX (workstream E of the editor
//! foundation). The host-side live working set, fed exclusively by CONFIRMED
//! authoring-bus events.
//!
//! GOVERNING DOCTRINE (placement-latency): one edit = one event = one index
//! delta. Folding an event MUST cost the same on an empty map and on a rich map —
//! O(1) in the index size, never O(objects). React reads SUMMARIES/counts only
//! (summaryJson); it never touches the per-edit fold loop. This is a host (Zig)
//! system; the only React surface is the read-only door in
//! v8_bindings_hot_index.zig.
//!
//! WHAT IT HOLDS
//!   - by-id object map     : id -> { kind, occupied chunks }   (the resolver)
//!   - by-chunk spatial index: chunk -> { object ids }          (the reverse view)
//!   - selected-id set      : the live selection
//!   - dirty-ids set        : objects whose compiled output may have changed
//!   - dirty-chunks set     : chunks the recompiler must revisit
//!   - baked signatures     : chunk -> last baked content hash (markBaked clears
//!                            dirty for a chunk once its artifact is current)
//!
//! HOW ONE EVENT FOLDS (observe)
//!   Parse the envelope's `targets: {kind,id}[]`. A `chunk` ref is resolved
//!   DIRECTLY (its id is "cx,cz") and unioned into dirty-chunks. An OBJECT ref is
//!   resolved to its chunks WITHOUT scanning the world: the object's chunk
//!   membership lives in its by-id entry (built when it was placed), so we read it
//!   in O(occupied-chunks-of-that-object). If the event also carries chunk refs,
//!   the object is re-homed to them (old buckets dropped, new buckets added). A
//!   brand-new object id is homed to the event's chunk refs. Touching one object
//!   never iterates the other objects — `last_observe_work` (a debug counter) is
//!   bounded by targets×occupied-chunks, independent of index size; the scaling
//!   unit test asserts exactly this.
//!
//! Donor: reuses `world_chunk_dirty` (ChunkCoord, chunkOfTile) and
//! `world_compile_cache` (Hash) — no re-implementation of chunk addressing.
//!
//! INTEGRATION (build.zig) — see v8_bindings_hot_index.zig and the test file's
//! INTEGRATION blocks for the exact module/test lines. This module imports two
//! sibling modules: "world_chunk_dirty" and "world_compile_cache".

const std = @import("std");
const chunk_dirty = @import("world_chunk_dirty");
const cache = @import("world_compile_cache");

pub const ChunkCoord = chunk_dirty.ChunkCoord;
pub const Hash = cache.Hash;

/// TargetRef.kind reserved for an explicit dirty-region declaration. Any other
/// kind is treated as an object reference (open vocabulary: piece/tile/prop/…).
pub const CHUNK_KIND: []const u8 = "chunk";

/// Debug instrumentation: the number of index touches the LAST `observe` made
/// (object lookups + chunk-set unions). It is reset at the top of every
/// `observe` and stays bounded by targets×occupied-chunks — NEVER by the number
/// of objects in the index. The scaling test reads this to prove O(1) folding.
pub var last_observe_work: usize = 0;

/// Pack a chunk coord into a u64 key (cx high, cz low) — matches chunk_dirty's
/// internal packing scheme so keys are comparable across the two modules.
fn packCoord(c: ChunkCoord) u64 {
    const cx: u64 = @as(u32, @bitCast(c.cx));
    const cz: u64 = @as(u32, @bitCast(c.cz));
    return (cx << 32) | cz;
}

fn unpackCoord(key: u64) ChunkCoord {
    return .{
        .cx = @bitCast(@as(u32, @truncate(key >> 32))),
        .cz = @bitCast(@as(u32, @truncate(key))),
    };
}

/// A set of object-id strings (owned dupes). Used both for a chunk's bucket and
/// for the selection / dirty-id sets.
const IdSet = std.StringHashMapUnmanaged(void);

/// One tracked object: its kind tag and the chunks it currently occupies. The
/// occupied-chunks list IS the object→chunk resolver (read on observe, no scan).
const ObjectEntry = struct {
    kind: []u8,
    chunks: std.ArrayListUnmanaged(u64) = .empty,

    fn occupies(self: *const ObjectEntry, packed_coord: u64) bool {
        for (self.chunks.items) |c| if (c == packed_coord) return true;
        return false;
    }
};

pub const HotIndex = struct {
    allocator: std.mem.Allocator,

    /// id -> entry. Owns the id key strings and each entry's kind string.
    by_id: std.StringHashMapUnmanaged(ObjectEntry) = .empty,
    /// chunk -> set of object ids occupying it.
    by_chunk: std.AutoHashMapUnmanaged(u64, IdSet) = .empty,
    /// Currently-selected object ids.
    selected: IdSet = .{},
    /// Objects whose compiled output may have changed since the last bake.
    dirty_ids: IdSet = .{},
    /// Chunks the recompiler must revisit.
    dirty_chunks: std.AutoHashMapUnmanaged(u64, void) = .empty,
    /// chunk -> last baked content hash (set by markBaked, which also clears the
    /// chunk's dirty flag).
    baked: std.AutoHashMapUnmanaged(u64, Hash) = .empty,
    /// Highest event seq folded so far (0 = none). Metadata for the summary.
    last_seq: i64 = 0,

    pub fn init(allocator: std.mem.Allocator) HotIndex {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *HotIndex) void {
        const a = self.allocator;
        var it = self.by_id.iterator();
        while (it.next()) |e| {
            a.free(e.key_ptr.*);
            a.free(e.value_ptr.kind);
            e.value_ptr.chunks.deinit(a);
        }
        self.by_id.deinit(a);

        var cit = self.by_chunk.iterator();
        while (cit.next()) |e| freeIdSet(a, e.value_ptr);
        self.by_chunk.deinit(a);

        freeIdSet(a, &self.selected);
        freeIdSet(a, &self.dirty_ids);
        self.dirty_chunks.deinit(a);
        self.baked.deinit(a);
        self.* = .{ .allocator = a };
    }

    // ── Folding one confirmed event ──────────────────────────────────────────

    /// Fold ONE confirmed authoring event into the working set. `seq` is the
    /// authoritative order; `envelope_json` is the seq-stamped envelope the bus
    /// broadcast. Returns false only if the JSON is not a well-formed object
    /// (the index is left unchanged). Cost is O(targets × occupied-chunks),
    /// independent of how many objects the index holds.
    pub fn observe(self: *HotIndex, seq: i64, envelope_json: []const u8) bool {
        last_observe_work = 0;

        var parsed = std.json.parseFromSlice(std.json.Value, self.allocator, envelope_json, .{}) catch return false;
        defer parsed.deinit();
        if (parsed.value != .object) return false;
        if (seq > self.last_seq) self.last_seq = seq;

        const targets = arrayField(parsed.value, "targets") orelse return true;

        // Pass 1: gather the event's explicit chunk refs (its declared dirty
        // region) and union them into dirty-chunks directly.
        var event_chunks: std.ArrayListUnmanaged(u64) = .empty;
        defer event_chunks.deinit(self.allocator);
        for (targets) |t| {
            if (!isKind(t, CHUNK_KIND)) continue;
            const id = strField(t, "id") orelse continue;
            const coord = parseChunkId(id) orelse continue;
            const key = packCoord(coord);
            self.dirtyChunkKey(key) catch {};
            event_chunks.append(self.allocator, key) catch {};
            last_observe_work += 1;
        }

        // Pass 2: fold each object ref. Resolve its current chunks via the by-id
        // entry (no world scan); re-home to the event's chunks when present.
        for (targets) |t| {
            if (isKind(t, CHUNK_KIND)) continue;
            const id = strField(t, "id") orelse continue;
            const kind = strField(t, "kind") orelse "";
            self.foldObject(id, kind, event_chunks.items) catch {};
            self.markDirtyId(id) catch {};
        }
        return true;
    }

    /// Upsert one object and reconcile its chunk membership. If `new_chunks` is
    /// non-empty the object is (re-)homed to exactly those chunks; otherwise an
    /// existing object's current chunks are simply re-dirtied (move/delete/update
    /// that declared no new region). Cost is bounded by the object's own chunk
    /// count, never the total object count.
    fn foldObject(self: *HotIndex, id: []const u8, kind: []const u8, new_chunks: []const u64) !void {
        last_observe_work += 1;
        const gop = try self.by_id.getOrPut(self.allocator, id);
        if (!gop.found_existing) {
            gop.key_ptr.* = try self.allocator.dupe(u8, id);
            gop.value_ptr.* = .{ .kind = try self.allocator.dupe(u8, kind) };
        }
        const entry = gop.value_ptr;

        if (new_chunks.len == 0) {
            // No new region declared: re-dirty wherever the object already lives.
            for (entry.chunks.items) |c| {
                try self.dirtyChunkKey(c);
                last_observe_work += 1;
            }
            return;
        }

        // Re-home: drop the object from chunks it no longer occupies, add it to
        // the new ones. Both old and new chunks are dirtied.
        for (entry.chunks.items) |old_key| {
            if (!containsKey(new_chunks, old_key)) {
                self.removeFromChunk(old_key, id);
                try self.dirtyChunkKey(old_key);
            }
            last_observe_work += 1;
        }
        entry.chunks.clearRetainingCapacity();
        for (new_chunks) |key| {
            try entry.chunks.append(self.allocator, key);
            try self.addToChunk(key, id);
            try self.dirtyChunkKey(key);
            last_observe_work += 1;
        }
    }

    // ── by-chunk bucket maintenance ──────────────────────────────────────────

    fn addToChunk(self: *HotIndex, chunk_key: u64, id: []const u8) !void {
        const gop = try self.by_chunk.getOrPut(self.allocator, chunk_key);
        if (!gop.found_existing) gop.value_ptr.* = .{};
        if (!gop.value_ptr.contains(id)) {
            const owned = try self.allocator.dupe(u8, id);
            try gop.value_ptr.put(self.allocator, owned, {});
        }
    }

    fn removeFromChunk(self: *HotIndex, chunk_key: u64, id: []const u8) void {
        const bucket = self.by_chunk.getPtr(chunk_key) orelse return;
        if (bucket.fetchRemove(id)) |kv| self.allocator.free(kv.key);
        if (bucket.count() == 0) {
            var b = bucket.*;
            b.deinit(self.allocator);
            _ = self.by_chunk.remove(chunk_key);
        }
    }

    fn dirtyChunkKey(self: *HotIndex, chunk_key: u64) !void {
        try self.dirty_chunks.put(self.allocator, chunk_key, {});
    }

    // ── Public mutators (doors / commands) ───────────────────────────────────

    /// Dirty a chunk by coordinate (e.g. a global edit that names its region).
    pub fn dirtyChunk(self: *HotIndex, coord: ChunkCoord) !void {
        try self.dirtyChunkKey(packCoord(coord));
    }

    /// Dirty whatever chunk owns a tile (bridges a tile edit into the chunk grid).
    pub fn dirtyTile(self: *HotIndex, tx: i32, tz: i32) !void {
        try self.dirtyChunkKey(packCoord(chunk_dirty.chunkOfTile(tx, tz)));
    }

    pub fn markDirtyId(self: *HotIndex, id: []const u8) !void {
        if (self.dirty_ids.contains(id)) return;
        const owned = try self.allocator.dupe(u8, id);
        try self.dirty_ids.put(self.allocator, owned, {});
    }

    /// Record a chunk's freshly-baked content hash and clear its dirty flag. The
    /// recompiler calls this once a chunk artifact is current again.
    pub fn markBaked(self: *HotIndex, coord: ChunkCoord, signature: Hash) !void {
        const key = packCoord(coord);
        try self.baked.put(self.allocator, key, signature);
        _ = self.dirty_chunks.remove(key);
    }

    pub fn bakedSignature(self: *const HotIndex, coord: ChunkCoord) ?Hash {
        return self.baked.get(packCoord(coord));
    }

    /// Clear all dirty bookkeeping (after a full bake). Selection/objects stay.
    pub fn clearDirty(self: *HotIndex) void {
        freeIdSet(self.allocator, &self.dirty_ids);
        self.dirty_ids = .{};
        self.dirty_chunks.clearRetainingCapacity();
    }

    // selection ----------------------------------------------------------------

    pub fn select(self: *HotIndex, id: []const u8) !void {
        if (self.selected.contains(id)) return;
        const owned = try self.allocator.dupe(u8, id);
        try self.selected.put(self.allocator, owned, {});
    }

    pub fn deselect(self: *HotIndex, id: []const u8) void {
        if (self.selected.fetchRemove(id)) |kv| self.allocator.free(kv.key);
    }

    pub fn clearSelection(self: *HotIndex) void {
        freeIdSet(self.allocator, &self.selected);
        self.selected = .{};
    }

    pub fn isSelected(self: *const HotIndex, id: []const u8) bool {
        return self.selected.contains(id);
    }

    /// Fully remove an object (delete): drop it from every chunk bucket and the
    /// by-id map, dirtying the chunks it leaves. Bounded by its own chunk count.
    pub fn removeObject(self: *HotIndex, id: []const u8) void {
        const entry = self.by_id.getPtr(id) orelse return;
        for (entry.chunks.items) |key| {
            self.removeFromChunk(key, id);
            self.dirtyChunkKey(key) catch {};
        }
        entry.chunks.deinit(self.allocator);
        self.allocator.free(entry.kind);
        if (self.by_id.fetchRemove(id)) |kv| self.allocator.free(kv.key);
        self.deselect(id);
    }

    // ── Read-only queries (the summary surface) ──────────────────────────────

    pub fn objectCount(self: *const HotIndex) usize {
        return self.by_id.count();
    }
    pub fn occupiedChunkCount(self: *const HotIndex) usize {
        return self.by_chunk.count();
    }
    pub fn dirtyChunkCount(self: *const HotIndex) usize {
        return self.dirty_chunks.count();
    }
    pub fn dirtyIdCount(self: *const HotIndex) usize {
        return self.dirty_ids.count();
    }
    pub fn selectedCount(self: *const HotIndex) usize {
        return self.selected.count();
    }

    /// True if `coord` is in the dirty set.
    pub fn chunkIsDirty(self: *const HotIndex, coord: ChunkCoord) bool {
        return self.dirty_chunks.contains(packCoord(coord));
    }

    /// Number of objects the by-chunk index lists in `coord` (0 if none). This
    /// is an O(1) hash lookup — the reverse index, not a world scan.
    pub fn objectsInChunk(self: *const HotIndex, coord: ChunkCoord) usize {
        const bucket = self.by_chunk.getPtr(packCoord(coord)) orelse return 0;
        return bucket.count();
    }

    pub fn hasObject(self: *const HotIndex, id: []const u8) bool {
        return self.by_id.contains(id);
    }

    /// Does the by-id entry for `id` record membership in `coord`? The O(1)
    /// object→chunk resolution observe relies on.
    pub fn objectInChunk(self: *const HotIndex, id: []const u8, coord: ChunkCoord) bool {
        const entry = self.by_id.getPtr(id) orelse return false;
        return entry.occupies(packCoord(coord));
    }

    /// The read-only summary React consumes (counts only, never the per-edit
    /// loop). Caller owns the returned slice.
    pub fn summaryJson(self: *const HotIndex, allocator: std.mem.Allocator) ![]u8 {
        return std.fmt.allocPrint(allocator,
            \\{{"objects":{d},"occupiedChunks":{d},"dirtyIds":{d},"dirtyChunks":{d},"selected":{d},"lastSeq":{d}}}
        , .{
            self.by_id.count(),
            self.by_chunk.count(),
            self.dirty_ids.count(),
            self.dirty_chunks.count(),
            self.selected.count(),
            self.last_seq,
        });
    }
};

// ── small helpers ────────────────────────────────────────────────────────────

fn freeIdSet(allocator: std.mem.Allocator, set: *IdSet) void {
    var it = set.iterator();
    while (it.next()) |e| allocator.free(e.key_ptr.*);
    set.deinit(allocator);
}

fn containsKey(keys: []const u64, key: u64) bool {
    for (keys) |k| if (k == key) return true;
    return false;
}

fn isKind(t: std.json.Value, kind: []const u8) bool {
    const k = strField(t, "kind") orelse return false;
    return std.mem.eql(u8, k, kind);
}

fn strField(v: std.json.Value, key: []const u8) ?[]const u8 {
    if (v != .object) return null;
    const got = v.object.get(key) orelse return null;
    return switch (got) {
        .string => |s| s,
        else => null,
    };
}

fn arrayField(v: std.json.Value, key: []const u8) ?[]std.json.Value {
    if (v != .object) return null;
    const got = v.object.get(key) orelse return null;
    return switch (got) {
        .array => |a| a.items,
        else => null,
    };
}

/// Parse a `chunk` ref id of the form "cx,cz" into a ChunkCoord. Whitespace
/// around the comma is tolerated; anything malformed yields null (ref ignored).
fn parseChunkId(id: []const u8) ?ChunkCoord {
    const comma = std.mem.indexOfScalar(u8, id, ',') orelse return null;
    const cx_s = std.mem.trim(u8, id[0..comma], " ");
    const cz_s = std.mem.trim(u8, id[comma + 1 ..], " ");
    const cx = std.fmt.parseInt(i32, cx_s, 10) catch return null;
    const cz = std.fmt.parseInt(i32, cz_s, 10) catch return null;
    return .{ .cx = cx, .cz = cz };
}

// ── Process-wide singleton (the door + the editor_bus hook fold into this) ───

var g_index: ?HotIndex = null;

/// The one host-owned index. Lazily created on first access with the C
/// allocator (matches editor_bus.zig's long-lived storage).
pub fn instance() *HotIndex {
    if (g_index == null) g_index = HotIndex.init(std.heap.c_allocator);
    return &g_index.?;
}

/// Test-only: reset the singleton to empty. (The door + bus hook share it.)
pub fn resetForTest() void {
    if (g_index) |*ix| ix.deinit();
    g_index = null;
}
