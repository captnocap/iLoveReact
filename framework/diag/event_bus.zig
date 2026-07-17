//! event_bus.zig — single-door observability sink.
//!
//! Why: this codebase has at least four independent JSON channels (V8↔Zig,
//! IPC NDJSON, http/ws servers, embed protocol). Every "took two days to
//! find" bug we've shipped was a transient structural failure where the
//! symptom was N hops downstream of the cause and there was no event trail
//! connecting them. The 3.5MB cliff (RecvBuffer truncation surfacing as
//! "blank window, no error log") is the canonical example. The orphan
//! watcher hijack is another.
//!
//! Design borrowed wholesale from engaige's eventBus (see
//! old-project-ideas.md §2): one append-only log + auto-importance from
//! event-type substring match + causal chains via parent_id. Storage is
//! SQLite at `~/.cache/reactjit/events.db` (WAL mode, synchronous=NORMAL)
//! so multiple processes can read while the active runtime writes — the
//! eventlog cart runs as a separate binary and queries this same db.
//!
//! Contract:
//!   - Single writer (main thread). No locks. Polling other threads call
//!     emit() at their own risk; today nothing does.
//!   - Best-effort. If sqlite open fails (HAS_SQLITE off, no $HOME, FS
//!     permission), the bus keeps the in-memory ring alive but skips
//!     persistence. emit() never blocks the runtime.
//!   - event_type and source can be arbitrary UTF-8 — SQLite's parameter
//!     binding handles escape, no caller-side discipline required.
//!   - payload_json is stored as-is in the `payload` column. Callers
//!     SHOULD pass valid JSON ("{}" for empty); we don't validate.
//!
//! Auto-importance from substring match (no manual tuning per call):
//!   overflow|fatal|crash|panic              → 0.95
//!   error|dropped|failed|reject             → 0.85
//!   warn|stale|orphan|truncated             → 0.70
//!   boot|spawn|bundle|kill|reload           → 0.60
//!   recv|tick|poll                          → 0.20
//!   anything else                           → 0.50
//!
//! Importance is what a future eventlog cart sorts/filters by. High-volume
//! events (recv, tick) persist to disk but stay below the default console
//! gate, so logs don't drown.

const std = @import("std");
const sqlite = @import("../storage/sqlite.zig");
const json_probe = @import("json_probe.zig");
const host_io = @import("../host_io.zig");

const alloc = std.heap.c_allocator;

const RING_SIZE: usize = 4096;

/// Where the SQLite db lives. Stable across sessions so eventlog can
/// always find it. The file is created on first init() call.
pub const DB_SUBPATH = ".cache/reactjit/events.db";

const RingEntry = struct {
    id: u64 = 0,
    ts_ms: i64 = 0,
    importance: f32 = 0,
    parent_id: ?u64 = null,
    event_type: []u8 = &.{},
    source: []u8 = &.{},
    payload: []u8 = &.{},
};

var g_inited: bool = false;
/// Minimum importance an event must clear to be persisted/buffered. Set
/// at runtime via LOGLEVEL IPC. 0.0 = pass everything (default), higher
/// values gate cheaper "log"-tier events out of the stream so a hot
/// trace path doesn't cost SQL writes when off.
/// Default 0.30 — matches the devshell "info" level: log.info / boot /
/// bundle / warn / err all pass; log.debug (0.15) and below are gated.
/// `l` in devshell cycles to a lower threshold for opt-in trace.
/// 0.0 = pass everything, 1.0 = silence everything.
var g_min_importance: f32 = 0.30;
pub fn minImportance() f32 { return g_min_importance; }
pub fn setMinImportance(threshold: f32) void { g_min_importance = threshold; }

/// Row cap on the SQLite events table. Once exceeded, oldest rows are
/// pruned to keep the file from growing without bound during long
/// sessions. ~17 minutes of headroom at 200 events/sec sustained, hours
/// at human-meaningful event rates.
const ROW_CAP: u64 = 200_000;
// Prune cadence is a tradeoff: too frequent = visible frame hitches
// from the synchronous DELETE+WAL fsync (observed in user-side
// telemetry, ~3min cycle at info-level emit rates); too rare = the
// table briefly carries more than ROW_CAP between prunes. 5000 keeps
// drift to ~2.5% of cap and pushes the hitch out to 10-15min cycles
// at typical event rates.
const PRUNE_EVERY: u64 = 5000;
var g_emits_since_prune: u64 = 0;
var g_session_buf: [16]u8 = undefined;
var g_session_len: usize = 0;
var g_db_path_buf: [512]u8 = undefined;
var g_db_path_len: usize = 0;
var g_db: ?sqlite.Database = null;
var g_insert_stmt: ?sqlite.Statement = null;
var g_next_id: u64 = 1;
var g_ring: [RING_SIZE]RingEntry = undefined;
var g_ring_inited: bool = false;
var g_ring_count: u64 = 0;

pub fn isInitialized() bool {
    return g_inited;
}

pub fn sessionId() []const u8 {
    if (!g_inited) return "";
    return g_session_buf[0..g_session_len];
}

pub fn dbPath() []const u8 {
    if (!g_inited) return "";
    return g_db_path_buf[0..g_db_path_len];
}

/// Back-compat alias — older callers used logPath() when storage was
/// NDJSON. Now returns the SQLite db path.
pub fn logPath() []const u8 {
    return dbPath();
}

/// Initialize the bus. Idempotent. Safe to call before any cart code runs.
///
/// Best-effort:
///   - Always: in-memory ring is set up unconditionally.
///   - When SQLite + $HOME are available: opens ~/.cache/reactjit/events.db
///     in WAL mode, creates the schema, and prepares the insert
///     statement. Persistence is on.
///   - When SQLite is stubbed (HAS_SQLITE=false) or open fails: stays in
///     in-memory-only mode. emit() still works for in-process consumers
///     that read the ring; cross-process eventlog views will be empty.
pub fn init() void {
    if (g_inited) return;

    // Session id: random u64 from monotonic-ns seed. Stable for the
    // process; rolls on every boot.
    const seed_i128 = host_io.nanoTimestamp();
    const seed: u64 = @truncate(@as(u128, @bitCast(seed_i128)));
    var prng = std.Random.DefaultPrng.init(seed);
    const sid = prng.random().int(u64);
    const sid_str = std.fmt.bufPrint(&g_session_buf, "{x:0>16}", .{sid}) catch return;
    g_session_len = sid_str.len;

    for (&g_ring) |*e| e.* = .{};
    g_ring_inited = true;
    g_inited = true;

    // SQLite setup is best-effort and entirely optional. If anything below
    // fails, the bus continues with the ring alone.
    setupDb();

    _ = emitWithImportance("bus.boot", "framework/event_bus.zig", 0.6, null, "{}");
}

fn setupDb() void {
    const home = host_io.getenv("HOME") orelse return;
    var dir_buf: [384]u8 = undefined;
    const dir_path = std.fmt.bufPrint(&dir_buf, "{s}/.cache/reactjit", .{home}) catch return;
    std.Io.Dir.createDirAbsolute(host_io.io(), dir_path, .default_dir) catch |e| switch (e) {
        error.PathAlreadyExists => {},
        else => return,
    };

    const db_path = std.fmt.bufPrint(&g_db_path_buf, "{s}/{s}", .{ home, DB_SUBPATH }) catch return;
    g_db_path_len = db_path.len;

    var db = sqlite.Database.open(db_path) catch return;
    // WAL + relaxed sync = batched fsyncs (every checkpoint, not every
    // commit). Combined with multi-process safety, this is what makes
    // running eventlog as a separate reader cheap.
    db.exec("PRAGMA journal_mode=WAL;") catch {};
    db.exec("PRAGMA synchronous=NORMAL;") catch {};
    // auto_vacuum=INCREMENTAL means the file actively shrinks as rows are
    // deleted (rather than just marking pages free). Only takes effect on
    // a fresh db (sqlite docs are explicit on this); existing dbs need a
    // full VACUUM to opt in. Together with the row cap below this stops
    // long sessions from bloating the events file unbounded.
    db.exec("PRAGMA auto_vacuum=INCREMENTAL;") catch {};
    db.exec(
        \\CREATE TABLE IF NOT EXISTS events (
        \\  id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\  ts_ms INTEGER NOT NULL,
        \\  session_id TEXT NOT NULL,
        \\  event_type TEXT NOT NULL,
        \\  source TEXT NOT NULL,
        \\  importance REAL NOT NULL,
        \\  parent_id INTEGER,
        \\  payload TEXT
        \\);
    ) catch {
        db.close();
        return;
    };
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms);") catch {};
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_imp ON events(importance);") catch {};
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);") catch {};

    const stmt = db.prepare(
        "INSERT INTO events(ts_ms, session_id, event_type, source, importance, parent_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?);",
    ) catch {
        db.close();
        return;
    };

    g_db = db;
    g_insert_stmt = stmt;
}

pub fn deinit() void {
    if (!g_inited) return;
    if (g_insert_stmt) |*s| s.deinit();
    g_insert_stmt = null;
    if (g_db) |*d| d.close();
    g_db = null;
    if (g_ring_inited) {
        for (&g_ring) |*e| {
            if (e.event_type.len > 0) alloc.free(e.event_type);
            if (e.source.len > 0) alloc.free(e.source);
            if (e.payload.len > 0) alloc.free(e.payload);
        }
        g_ring_inited = false;
    }
    g_inited = false;
}

fn containsAny(haystack: []const u8, needles: []const []const u8) bool {
    for (needles) |n| {
        if (std.mem.indexOf(u8, haystack, n) != null) return true;
    }
    return false;
}

/// Pure function — exposed so callers (and tests) can preview what
/// importance a given event_type will land on without emitting.
pub fn autoImportance(event_type: []const u8) f32 {
    if (containsAny(event_type, &.{ "overflow", "fatal", "crash", "panic" })) return 0.95;
    if (containsAny(event_type, &.{ "error", "dropped", "failed", "reject" })) return 0.85;
    if (containsAny(event_type, &.{ "warn", "stale", "orphan", "truncated" })) return 0.70;
    if (containsAny(event_type, &.{ "boot", "spawn", "bundle", "kill", "reload" })) return 0.60;
    if (containsAny(event_type, &.{ "recv", "tick", "poll" })) return 0.20;
    return 0.50;
}

/// Standard emission path. Returns the assigned event id (for parent_id
/// chaining), or 0 if the bus is uninitialized.
pub fn emit(event_type: []const u8, source: []const u8, parent_id: ?u64, payload_json: []const u8) u64 {
    return emitWithImportance(event_type, source, autoImportance(event_type), parent_id, payload_json);
}

/// Override importance manually. Use when you know better than the
/// substring match (e.g. an "ipc.recv" you want flagged because the
/// payload is suspiciously large).
pub fn emitWithImportance(
    event_type: []const u8,
    source: []const u8,
    importance: f32,
    parent_id: ?u64,
    payload_json: []const u8,
) u64 {
    if (!g_inited) return 0;
    // Threshold gate. Cheap (single int compare), runs before any
    // string dup, JSON validation, SQL bind, or ring-slot eviction.
    if (importance < g_min_importance) return 0;

    const ts = host_io.milliTimestamp();
    const safe_payload = if (payload_json.len == 0) "{}" else payload_json;

    // SQLite insert (when persistence is wired). The autoincrement column
    // assigns its own rowid; we don't read it back — the ring's
    // independent monotonic counter is what emit() returns to callers
    // for parent_id chaining (works even when persistence is off).
    if (g_insert_stmt) |*stmt| {
        insertRow(stmt, ts, event_type, source, importance, parent_id, safe_payload);
        g_emits_since_prune += 1;
        if (g_emits_since_prune >= PRUNE_EVERY) {
            g_emits_since_prune = 0;
            pruneOldRows();
        }
    }

    const id = g_next_id;
    g_next_id += 1;

    if (g_ring_inited) {
        const slot: usize = @intCast(g_ring_count % RING_SIZE);
        const e = &g_ring[slot];
        if (e.event_type.len > 0) alloc.free(e.event_type);
        if (e.source.len > 0) alloc.free(e.source);
        if (e.payload.len > 0) alloc.free(e.payload);
        e.* = .{
            .id = id,
            .ts_ms = ts,
            .importance = importance,
            .parent_id = parent_id,
            .event_type = alloc.dupe(u8, event_type) catch &.{},
            .source = alloc.dupe(u8, source) catch &.{},
            .payload = alloc.dupe(u8, safe_payload) catch &.{},
        };
        g_ring_count += 1;
    }

    return id;
}

/// Serialize the most recent `max_n` ring entries as a JSON array.
/// Cheaper than a SQL query — the ring is in-process memory. Used by
/// dev_ipc's EVENTS verb so devshell can tail logs without ever
/// touching the events.db file.
///
/// event_type / source are framework-controlled identifiers (dotted
/// snake-case — "host.flush", "framework/dev_ipc.zig") so we don't
/// JSON-escape them. payload is already a JSON document; it's emitted
/// as-is.
pub fn recentEventsJson(out_alloc: std.mem.Allocator, max_n: usize) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(out_alloc);
    try out.append(out_alloc, '[');
    if (g_ring_inited and g_ring_count > 0) {
        const want = @min(max_n, RING_SIZE);
        const total = g_ring_count;
        const start = if (total > want) total - want else 0;
        var first = true;
        var i: u64 = start;
        while (i < total) : (i += 1) {
            const slot: usize = @intCast(i % RING_SIZE);
            const e = &g_ring[slot];
            if (e.event_type.len == 0) continue;
            if (!first) try out.append(out_alloc, ',');
            first = false;
            var head_buf: [192]u8 = undefined;
            const head = std.fmt.bufPrint(
                &head_buf,
                "{{\"id\":{d},\"ts\":{d},\"imp\":{d:.3},\"type\":\"{s}\",\"src\":\"{s}\",\"payload\":",
                .{ e.id, e.ts_ms, e.importance, e.event_type, e.source },
            ) catch continue;
            try out.appendSlice(out_alloc, head);
            try out.appendSlice(out_alloc, e.payload);
            try out.append(out_alloc, '}');
        }
    }
    try out.append(out_alloc, ']');
    return out.toOwnedSlice(out_alloc);
}

/// Drop everything below (max rowid - ROW_CAP). Bounded work — SQLite's
/// rowid is the primary key, so the WHERE clause hits the b-tree
/// directly. Called every PRUNE_EVERY emits, deleting ~PRUNE_EVERY rows
/// per call in steady state.
fn pruneOldRows() void {
    if (g_db) |*db| {
        var buf: [160:0]u8 = undefined;
        const sql = std.fmt.bufPrintZ(
            &buf,
            "DELETE FROM events WHERE rowid <= (SELECT MAX(rowid) - {d} FROM events);",
            .{ROW_CAP},
        ) catch return;
        db.exec(sql) catch {};
        // We deliberately do NOT call PRAGMA incremental_vacuum here —
        // it's another synchronous SQL pass on the freelist that
        // doubles the prune-cycle hitch. Without it, freed pages stay
        // in-file and get reused for new INSERTs, so the file stabilizes
        // at high-water mark rather than shrinking. Row count is still
        // bounded by ROW_CAP. Run `VACUUM` manually offline if you
        // need to actually shrink the file.
    }
}

fn insertRow(
    stmt: *sqlite.Statement,
    ts: i64,
    event_type: []const u8,
    source: []const u8,
    importance: f32,
    parent_id: ?u64,
    payload: []const u8,
) void {
    stmt.reset() catch return;
    stmt.bindInt(1, ts) catch return;
    stmt.bindText(2, g_session_buf[0..g_session_len]) catch return;
    stmt.bindText(3, event_type) catch return;
    stmt.bindText(4, source) catch return;
    stmt.bindFloat(5, importance) catch return;
    if (parent_id) |pid| {
        stmt.bindInt(6, @intCast(pid)) catch return;
    } else {
        stmt.bindNull(6) catch return;
    }
    stmt.bindText(7, payload) catch return;
    _ = stmt.step() catch return;
}

// ── std.log adapter ────────────────────────────────────────────────────
//
// Wire as `pub const std_options = .{ .logFn = event_bus.fromStdLog }`
// in v8_app.zig. Every `std.log.info/warn/err/debug` call in the
// framework then routes through here — bus first, optional stderr
// fallthrough for warns/errs so the terminal still surfaces real
// problems even if the eventlog window is closed.
//
// Importance map (level → imp):
//   .err   → 0.85   (eligible for stderr)
//   .warn  → 0.70   (eligible for stderr)
//   .info  → 0.30   (bus-only)
//   .debug → 0.15   (bus-only)
//
// Re-entrancy: every helper inside swallows errors with `catch`; nothing
// here calls `std.log.*`, so there's no recursion into the override.

const writeJsonString = json_probe.writeString;

/// Runtime-arg log emitter — used by both fromStdLog (the std.options
/// override) and framework/log.zig's print/info/warn/err helpers. Keeps
/// the formatting + escape + console-gate logic in one place.
pub fn emitFromLog(level: std.log.Level, scope: []const u8, msg: []const u8) u64 {
    const lvl_str = @tagName(level);

    // Console gate — errors and warns ALWAYS hit stderr regardless of bus
    // state, so pre-bus boot failures and post-deinit shutdown errors stay
    // visible. Lower levels are bus-only.
    if (level == .err or level == .warn) {
        const stderr = std.Io.File.stderr();
        var line_buf: [4200]u8 = undefined;
        const line = std.fmt.bufPrint(&line_buf, "[{s}/{s}] {s}\n", .{ lvl_str, scope, msg }) catch msg;
        stderr.writeStreamingAll(host_io.io(), line) catch {};
    }

    if (!g_inited) return 0;

    const importance: f32 = switch (level) {
        .err => 0.85,
        .warn => 0.70,
        .info => 0.30,
        .debug => 0.15,
    };

    var pbuf: std.ArrayList(u8) = .empty;
    defer pbuf.deinit(alloc);
    var aw: std.Io.Writer.Allocating = .fromArrayList(alloc, &pbuf);
    defer pbuf = aw.toArrayList();
    const w = &aw.writer;
    w.writeAll("{\"msg\":") catch return 0;
    writeJsonString(w, msg) catch return 0;
    w.writeAll(",\"scope\":") catch return 0;
    writeJsonString(w, scope) catch return 0;
    w.writeAll(",\"level\":") catch return 0;
    writeJsonString(w, lvl_str) catch return 0;
    w.writeAll("}") catch return 0;

    var src_buf: [80]u8 = undefined;
    const src = std.fmt.bufPrint(&src_buf, "log:{s}", .{scope}) catch "log:?";

    const event_type = switch (level) {
        .err => "log.err",
        .warn => "log.warn",
        .info => "log.info",
        .debug => "log.debug",
    };

    return emitWithImportance(event_type, src, importance, null, aw.written());
}

pub fn fromStdLog(
    comptime level: std.log.Level,
    comptime scope: @TypeOf(.enum_literal),
    comptime format: []const u8,
    args: anytype,
) void {
    var msg_buf: [4096]u8 = undefined;
    const msg_full: []const u8 = std.fmt.bufPrint(&msg_buf, format, args) catch blk: {
        const n = msg_buf.len;
        msg_buf[n - 3] = '.';
        msg_buf[n - 2] = '.';
        msg_buf[n - 1] = '.';
        break :blk msg_buf[0..];
    };
    _ = emitFromLog(level, @tagName(scope), msg_full);
}

/// JS-side log adapter — paired with the __hostLog host fn. Severity:
///   0 = log/info  → js.log  imp 0.30 (bus-only)
///   1 = warn      → js.warn imp 0.70 (bus + stderr)
///   2 = error     → js.err  imp 0.85 (bus + stderr)
/// Stderr fallthrough fires regardless of bus state so JS-side errors
/// remain visible during pre-bus boot or post-deinit shutdown.
pub fn emitJsLog(severity: i32, msg: []const u8) u64 {
    if (severity >= 1) {
        const stderr = std.Io.File.stderr();
        var line_buf: [4200]u8 = undefined;
        const tag: []const u8 = if (severity >= 2) "[js.err]" else "[js.warn]";
        const line = std.fmt.bufPrint(&line_buf, "{s} {s}\n", .{ tag, msg }) catch msg;
        stderr.writeStreamingAll(host_io.io(), line) catch {};
    }
    if (!g_inited) return 0;

    const importance: f32 = switch (severity) {
        2 => 0.85,
        1 => 0.70,
        else => 0.30,
    };
    const event_type: []const u8 = switch (severity) {
        2 => "js.err",
        1 => "js.warn",
        else => "js.log",
    };

    var pbuf: std.ArrayList(u8) = .empty;
    defer pbuf.deinit(alloc);
    var aw: std.Io.Writer.Allocating = .fromArrayList(alloc, &pbuf);
    defer pbuf = aw.toArrayList();
    const w = &aw.writer;
    w.writeAll("{\"msg\":") catch return 0;
    writeJsonString(w, msg) catch return 0;
    w.writeAll("}") catch return 0;

    return emitWithImportance(event_type, "js", importance, null, aw.written());
}

/// Build a JSON array of recent events with importance >= min_importance,
/// newest first, capped at max_count. Caller owns the returned slice.
/// Returns "[]" when uninitialized or when the ring is empty.
pub fn recentJson(allocator: std.mem.Allocator, max_count: usize, min_importance: f32) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    errdefer buf.deinit(allocator);
    try buf.append(allocator, '[');

    if (g_inited and g_ring_inited and g_ring_count > 0) {
        const live: u64 = @min(g_ring_count, RING_SIZE);
        var emitted: usize = 0;
        var i: u64 = 0;
        while (i < live and emitted < max_count) : (i += 1) {
            const idx: usize = @intCast((g_ring_count - 1 - i) % RING_SIZE);
            const e = &g_ring[idx];
            if (e.importance < min_importance) continue;
            if (emitted > 0) try buf.append(allocator, ',');
            var aw: std.Io.Writer.Allocating = .fromArrayList(allocator, &buf);
            defer buf = aw.toArrayList();
            const w = &aw.writer;
            const payload_str = if (e.payload.len > 0) e.payload else "{}";
            if (e.parent_id) |pid| {
                try w.print(
                    "{{\"id\":{d},\"ts\":{d},\"type\":\"{s}\",\"src\":\"{s}\",\"imp\":{d:.3},\"par\":{d},\"payload\":{s}}}",
                    .{ e.id, e.ts_ms, e.event_type, e.source, e.importance, pid, payload_str },
                );
            } else {
                try w.print(
                    "{{\"id\":{d},\"ts\":{d},\"type\":\"{s}\",\"src\":\"{s}\",\"imp\":{d:.3},\"par\":null,\"payload\":{s}}}",
                    .{ e.id, e.ts_ms, e.event_type, e.source, e.importance, payload_str },
                );
            }
            emitted += 1;
        }
    }

    try buf.append(allocator, ']');
    return buf.toOwnedSlice(allocator);
}
