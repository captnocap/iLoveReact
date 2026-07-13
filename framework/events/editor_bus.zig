//! editor_bus.zig — the AUTHORING eventbus spine (source of truth for edits).
//!
//! This is workstream A of the editor foundation. It is the Zig authority behind
//! the `runtime/editorbus/` TS door (`bus.ts` + `event.ts`). Do NOT confuse it
//! with `framework/diag/event_bus.zig` — that one is fire-and-forget observability
//! (sampled, importance-gated, drop-on-overflow). THIS log is the opposite: an
//! append-only ORDERED record where every accepted edit gets an authoritative,
//! monotonic, durable `seq`. V20 is dead; this log + autosave snapshots + backup
//! is its replacement (see docs/game/EDITOR_FOUNDATION_CONTRACTS.md).
//!
//! Multiplayer-shaped: an event carries a producing-peer `origin` and the bus
//! stamps an authoritative `seq`. Two peers' events interleave deterministically
//! by `seq`, so the same log replays identically on every machine.
//!
//! Contract (mirrors runtime/editorbus/bus.ts):
//!   append(envelope_json) -> seq   Parse the JSON envelope, stamp an authoritative
//!                                   monotonic `seq` (overwriting the SEQ_PENDING the
//!                                   client sent), persist it, and fan the CONFIRMED
//!                                   envelope back to JS on the `editor.bus` channel
//!                                   (via the installed broadcaster → host __ffiEmit).
//!                                   Returns the assigned seq, or -1 on rejection.
//!   since(afterSeq) -> json        JSON array of confirmed envelopes with seq > afterSeq,
//!                                   oldest-first — for catch-up / replay.
//!   head() -> seq                  Highest committed seq (0 when empty).
//!
//! Storage (donor: framework/diag/event_bus.zig):
//!   - Bounded in-memory ring of confirmed envelopes (the hot replay window).
//!   - SQLite (WAL) at ~/.cache/reactjit/editor-events.db for durability +
//!     cross-process replay. Best-effort: if SQLite/$HOME is unavailable the ring
//!     still serves append/since/head, just without cross-session persistence.
//!
//! Single-writer discipline: the main (V8) thread owns this. No locks.

const std = @import("std");
// Keep SQLite in the framework root module, uniform with the sibling diagnostics
// bus. The unit-test root also lives at framework/ so this relative import remains
// inside one legal module boundary without registering the file a second time.
const sqlite = @import("../storage/sqlite.zig");

const alloc = std.heap.c_allocator;

/// The ffi channel confirmed envelopes are re-broadcast on. MUST match
/// `EDITOR_BUS_CHANNEL` in runtime/editorbus/bus.ts.
pub const CHANNEL = "editor.bus";

/// Where the durable log lives. Stable across sessions so an out-of-process
/// reader (eventbus dock, replay tool) can always find it.
pub const DB_SUBPATH = ".cache/reactjit/editor-events.db";

/// Hot replay window. Larger than the diag ring — an authoring session's
/// catch-up/undo surface wants generous in-memory history before falling to SQL.
const RING_SIZE: usize = 8192;

/// A confirmed event held in the ring: its authoritative seq + the full,
/// seq-stamped JSON envelope (owned).
const RingEntry = struct {
    seq: i64 = 0,
    json: []u8 = &.{},
};

var g_inited: bool = false;
/// The authoritative monotonic counter. Next seq to assign. Starts at 1 (seq 0
/// means "empty" per the head() contract); reseeded from MAX(seq)+1 on init so
/// the order survives restarts.
var g_next_seq: i64 = 1;

var g_ring: [RING_SIZE]RingEntry = undefined;
var g_ring_inited: bool = false;
var g_ring_count: u64 = 0;

var g_db: ?sqlite.Database = null;
var g_insert_stmt: ?sqlite.Statement = null;
var g_db_path_buf: [512]u8 = undefined;
var g_db_path_len: usize = 0;

/// Confirmed-event broadcaster. The V8 binding installs one that calls the host's
/// `__ffiEmit(CHANNEL, json)`. Kept as a function pointer so this core module has
/// ZERO dependency on v8 — it compiles & unit-tests fully headless.
pub const Broadcaster = *const fn (json: []const u8) void;
var g_broadcaster: ?Broadcaster = null;

pub fn setBroadcaster(bc: Broadcaster) void {
    g_broadcaster = bc;
}

pub fn isInitialized() bool {
    return g_inited;
}

pub fn dbPath() []const u8 {
    if (g_db_path_len == 0) return "";
    return g_db_path_buf[0..g_db_path_len];
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/// Initialize the bus. Idempotent. Safe to call before any cart code runs.
/// Always sets up the ring; opens SQLite best-effort (donor pattern).
pub fn init() void {
    if (g_inited) return;
    for (&g_ring) |*e| e.* = .{};
    g_ring_inited = true;
    g_next_seq = 1;
    g_inited = true;
    setupDb();
}

/// Test-only init: ring-only, no SQLite, fresh globals. Lets the unit test
/// exercise ordering + since()/head() without touching the user's real db.
pub fn initInMemoryForTest() void {
    deinit();
    for (&g_ring) |*e| e.* = .{};
    g_ring_inited = true;
    g_ring_count = 0;
    g_next_seq = 1;
    g_db = null;
    g_insert_stmt = null;
    g_db_path_len = 0;
    g_broadcaster = null;
    g_inited = true;
}

fn setupDb() void {
    const home = std.posix.getenv("HOME") orelse return;
    var dir_buf: [384]u8 = undefined;
    const dir_path = std.fmt.bufPrint(&dir_buf, "{s}/.cache/reactjit", .{home}) catch return;
    std.fs.makeDirAbsolute(dir_path) catch |e| switch (e) {
        error.PathAlreadyExists => {},
        else => return,
    };

    const db_path = std.fmt.bufPrint(&g_db_path_buf, "{s}/{s}", .{ home, DB_SUBPATH }) catch return;
    g_db_path_len = db_path.len;

    var db = sqlite.Database.open(db_path) catch return;
    db.exec("PRAGMA journal_mode=WAL;") catch {};
    db.exec("PRAGMA synchronous=NORMAL;") catch {};
    db.exec(
        \\CREATE TABLE IF NOT EXISTS editor_events (
        \\  seq INTEGER PRIMARY KEY,
        \\  origin TEXT,
        \\  ts INTEGER,
        \\  type TEXT,
        \\  envelope TEXT NOT NULL
        \\);
    ) catch {
        db.close();
        return;
    };

    const stmt = db.prepare(
        "INSERT OR REPLACE INTO editor_events(seq, origin, ts, type, envelope) VALUES (?, ?, ?, ?, ?);",
    ) catch {
        db.close();
        return;
    };

    g_db = db;
    g_insert_stmt = stmt;

    // Continue the authoritative order from where the durable log left off.
    g_next_seq = loadMaxSeq(&db) + 1;
}

fn loadMaxSeq(db: *sqlite.Database) i64 {
    var stmt = db.prepare("SELECT COALESCE(MAX(seq), 0) FROM editor_events;") catch return 0;
    defer stmt.deinit();
    const has_row = stmt.step() catch return 0;
    if (!has_row) return 0;
    return stmt.columnInt(0);
}

pub fn deinit() void {
    if (!g_inited) return;
    if (g_insert_stmt) |*s| s.deinit();
    g_insert_stmt = null;
    if (g_db) |*d| d.close();
    g_db = null;
    if (g_ring_inited) {
        for (&g_ring) |*e| {
            if (e.json.len > 0) alloc.free(e.json);
            e.* = .{};
        }
        g_ring_inited = false;
    }
    g_ring_count = 0;
    g_inited = false;
}

// ── Append ──────────────────────────────────────────────────────────────

/// Append one authoring event. Parses the JSON envelope, stamps the
/// authoritative seq, persists + rings the confirmed envelope, and fans it out
/// on CHANNEL. Returns the assigned seq, or -1 if the bus is uninitialized or the
/// payload is not a well-formed common event envelope. Domain payload schemas
/// stay above this storage boundary; this validates only the fields shared by
/// every legacy receipt and future command outcome.
pub fn append(envelope_json: []const u8) i64 {
    if (!g_inited) return -1;

    var parsed = std.json.parseFromSlice(std.json.Value, alloc, envelope_json, .{}) catch return -1;
    defer parsed.deinit();
    if (!validEnvelope(parsed.value)) return -1;

    const seq = g_next_seq;
    // Overwrite the client's SEQ_PENDING (-1) with the authoritative order.
    parsed.value.object.put("seq", .{ .integer = seq }) catch return -1;

    const confirmed = std.json.Stringify.valueAlloc(alloc, parsed.value, .{}) catch return -1;
    // `confirmed` ownership transfers to the ring (ringPush). It stays valid for
    // the persist + broadcast calls below, which run before the next append.

    g_next_seq = seq + 1;

    const origin = strField(parsed.value, "origin") orelse "local";
    const etype = strField(parsed.value, "type") orelse "";
    const ts = intField(parsed.value, "ts") orelse std.time.milliTimestamp();

    persist(seq, origin, ts, etype, confirmed);
    ringPush(seq, confirmed);

    if (g_broadcaster) |bc| bc(confirmed);

    return seq;
}

fn persist(seq: i64, origin: []const u8, ts: i64, etype: []const u8, envelope: []const u8) void {
    const stmt = if (g_insert_stmt) |*s| s else return;
    stmt.reset() catch return;
    stmt.bindInt(1, seq) catch return;
    stmt.bindText(2, origin) catch return;
    stmt.bindInt(3, ts) catch return;
    stmt.bindText(4, etype) catch return;
    stmt.bindText(5, envelope) catch return;
    _ = stmt.step() catch return;
}

/// Push a confirmed envelope into the ring (takes ownership of `json`).
fn ringPush(seq: i64, json: []u8) void {
    if (!g_ring_inited) {
        // No ring (shouldn't happen post-init) — don't leak.
        alloc.free(json);
        return;
    }
    const slot: usize = @intCast(g_ring_count % RING_SIZE);
    const e = &g_ring[slot];
    if (e.json.len > 0) alloc.free(e.json);
    e.* = .{ .seq = seq, .json = json };
    g_ring_count += 1;
}

// ── Query ───────────────────────────────────────────────────────────────

/// Highest committed seq (0 when empty). Cheap, in-memory.
pub fn head() i64 {
    return g_next_seq - 1;
}

/// JSON array of confirmed envelopes with seq > after_seq, oldest-first.
/// Prefers SQLite (complete + ordered, survives ring eviction); falls back to the
/// in-memory ring when persistence is off. Caller owns the returned slice.
pub fn since(allocator: std.mem.Allocator, after_seq: i64) ![]u8 {
    if (g_db != null) return sinceFromDb(allocator, after_seq);
    return sinceFromRing(allocator, after_seq);
}

fn sinceFromRing(allocator: std.mem.Allocator, after_seq: i64) ![]u8 {
    var out: std.ArrayList(u8) = .{};
    errdefer out.deinit(allocator);
    try out.append(allocator, '[');
    if (g_ring_inited and g_ring_count > 0) {
        const live: u64 = @min(g_ring_count, RING_SIZE);
        const start = g_ring_count - live;
        var first = true;
        var i: u64 = start;
        while (i < g_ring_count) : (i += 1) {
            const slot: usize = @intCast(i % RING_SIZE);
            const e = &g_ring[slot];
            if (e.json.len == 0 or e.seq <= after_seq) continue;
            if (!first) try out.append(allocator, ',');
            first = false;
            try out.appendSlice(allocator, e.json);
        }
    }
    try out.append(allocator, ']');
    return out.toOwnedSlice(allocator);
}

fn sinceFromDb(allocator: std.mem.Allocator, after_seq: i64) ![]u8 {
    const db = if (g_db) |*d| d else return sinceFromRing(allocator, after_seq);
    var stmt = db.prepare(
        "SELECT envelope FROM editor_events WHERE seq > ? ORDER BY seq ASC;",
    ) catch return sinceFromRing(allocator, after_seq);
    defer stmt.deinit();
    stmt.bindInt(1, after_seq) catch return sinceFromRing(allocator, after_seq);

    var out: std.ArrayList(u8) = .{};
    errdefer out.deinit(allocator);
    try out.append(allocator, '[');
    var first = true;
    while (stmt.step() catch false) {
        const env = stmt.columnText(0) orelse continue;
        if (!first) try out.append(allocator, ',');
        first = false;
        try out.appendSlice(allocator, env);
    }
    try out.append(allocator, ']');
    return out.toOwnedSlice(allocator);
}

// ── Autosave snapshot + backup ──────────────────────────────────────────
//
// The eventbus log IS the history; a snapshot is a materialized view of the
// whole ordered log (the full replay), and a backup is a copy of the durable
// store. Together they replace V20: restore = re-apply the snapshot, then replay
// the tail via since(snapshot_head).

/// Write the full ordered log (since seq 0) as a JSON array to `path` atomically
/// (write to `path.tmp`, then rename). This is the autosave artifact a fresh
/// session can boot from before replaying any tail. Returns on best-effort
/// failure without throwing for a missing dir.
pub fn snapshotToFile(path: []const u8) !void {
    const json = try since(alloc, 0);
    defer alloc.free(json);

    var tmp_buf: [600]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp", .{path}) catch return error.PathTooLong;
    {
        const f = try std.fs.cwd().createFile(tmp_path, .{ .truncate = true });
        defer f.close();
        try f.writeAll(json);
    }
    try std.fs.cwd().rename(tmp_path, path);
}

/// Copy the durable SQLite store to `dest_path`. Returns error.NoStore when
/// persistence is off (ring-only).
///
/// NOTE: this is a raw file copy. For a fully crash-consistent backup while the
/// WAL is hot, a `PRAGMA wal_checkpoint(TRUNCATE)` before the copy is the proper
/// path. STUBBED here: the periodic AUTOSAVE SCHEDULER (when/how often to call
/// snapshotToFile + backup), backup retention/rotation, and the V31
/// compiled-chunk restore surface are intentionally out of this pass — wire a
/// timer in the host loop and call snapshotToFile()/backupTo() from it.
pub fn backupTo(dest_path: []const u8) !void {
    if (g_db_path_len == 0) return error.NoStore;
    try std.fs.cwd().copyFile(dbPath(), std.fs.cwd(), dest_path, .{});
}

// ── JSON field helpers ──────────────────────────────────────────────────

fn strField(v: std.json.Value, key: []const u8) ?[]const u8 {
    if (v != .object) return null;
    const got = v.object.get(key) orelse return null;
    return switch (got) {
        .string => |s| s,
        else => null,
    };
}

fn intField(v: std.json.Value, key: []const u8) ?i64 {
    if (v != .object) return null;
    const got = v.object.get(key) orelse return null;
    return switch (got) {
        .integer => |n| n,
        .float => |f| @intFromFloat(f),
        else => null,
    };
}

fn validEnvelope(v: std.json.Value) bool {
    if (v != .object) return false;

    const origin = strField(v, "origin") orelse return false;
    if (origin.len == 0) return false;

    const event_type = strField(v, "type") orelse return false;
    if (event_type.len == 0) return false;

    const ts = v.object.get("ts") orelse return false;
    if (ts != .integer) return false;

    const targets = v.object.get("targets") orelse return false;
    if (targets != .array) return false;

    const payload = v.object.get("payload") orelse return false;
    if (payload != .object) return false;

    return true;
}
