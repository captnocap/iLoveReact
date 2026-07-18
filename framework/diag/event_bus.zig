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
//!   - `emit*` only copies into bounded memory. It never reads a clock, opens a
//!     file, touches SQLite, writes stderr, or needs an `std.Io` capability.
//!   - One root-owned `Sink` performs those effects from `flush(io)`. The sink
//!     is explicit state, so no process-global `std.Io` is retained here.
//!   - Single producer (main thread). No locks. Polling other threads call
//!     emit() at their own risk; today nothing does.
//!   - Best-effort. If SQLite is unavailable, the in-memory history remains
//!     live. If producers outrun flush, the oldest unflushed entries are
//!     evicted and the next flush reports the exact drop count.
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

pub const RING_SIZE: usize = 4096;
const EVENT_TYPE_CAP: usize = 96;
const SOURCE_CAP: usize = 160;
const PAYLOAD_CAP: usize = 4096;
const CONSOLE_QUEUE_SIZE: usize = 256;
const CONSOLE_LINE_CAP: usize = 2048;

/// Where the SQLite db lives. Stable across sessions so eventlog can
/// always find it. The file is created by the root-owned `open()` call.
pub const DB_SUBPATH = ".cache/reactjit/events.db";

fn BoundedText(comptime capacity: usize) type {
    return struct {
        const Self = @This();

        buf: [capacity]u8 = undefined,
        len: u16 = 0,

        fn slice(self: *const Self) []const u8 {
            return self.buf[0..self.len];
        }

        fn set(self: *Self, value: []const u8) void {
            if (value.len <= capacity) {
                @memcpy(self.buf[0..value.len], value);
                self.len = @intCast(value.len);
                return;
            }
            const marker = "<oversize>";
            @memcpy(self.buf[0..marker.len], marker);
            self.len = marker.len;
        }

        fn setPayload(self: *Self, value: []const u8) void {
            const safe = if (value.len == 0) "{}" else value;
            if (safe.len <= capacity) {
                @memcpy(self.buf[0..safe.len], safe);
                self.len = @intCast(safe.len);
                return;
            }
            const marker = std.fmt.bufPrint(
                &self.buf,
                "{{\"truncated\":true,\"original_bytes\":{d}}}",
                .{safe.len},
            ) catch "{}";
            self.len = @intCast(marker.len);
        }

        fn setLine(self: *Self, value: []const u8) void {
            if (value.len <= capacity) {
                @memcpy(self.buf[0..value.len], value);
                self.len = @intCast(value.len);
                return;
            }
            const suffix = "...\n";
            const prefix_len = capacity - suffix.len;
            @memcpy(self.buf[0..prefix_len], value[0..prefix_len]);
            @memcpy(self.buf[prefix_len..capacity], suffix);
            self.len = capacity;
        }
    };
}

const RingEntry = struct {
    id: u64 = 0,
    ts_ms: i64 = 0,
    importance: f32 = 0,
    parent_id: ?u64 = null,
    event_type: BoundedText(EVENT_TYPE_CAP) = .{},
    source: BoundedText(SOURCE_CAP) = .{},
    payload: BoundedText(PAYLOAD_CAP) = .{},

    fn set(
        self: *RingEntry,
        id: u64,
        ts_ms: i64,
        importance: f32,
        parent_id: ?u64,
        event_type: []const u8,
        source: []const u8,
        payload: []const u8,
    ) void {
        self.id = id;
        self.ts_ms = ts_ms;
        self.importance = importance;
        self.parent_id = parent_id;
        self.event_type.set(event_type);
        self.source.set(source);
        self.payload.setPayload(payload);
    }
};

const ConsoleLine = struct {
    text: BoundedText(CONSOLE_LINE_CAP) = .{},
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
pub fn minImportance() f32 {
    return g_min_importance;
}
pub fn setMinImportance(threshold: f32) void {
    g_min_importance = threshold;
}

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
var g_next_id: u64 = 1;
var g_ring: [RING_SIZE]RingEntry = undefined;
var g_ring_inited: bool = false;
var g_ring_count: u64 = 0;
var g_flushed_count: u64 = 0;
// Producer timestamps use the most recent root clock sample (taken by open or
// flush). This keeps emit non-I/O while retaining frame-scale event timing.
var g_sampled_ts_ms: i64 = 0;
var g_events_dropped_total: u64 = 0;
var g_events_dropped_unreported: u64 = 0;
var g_console: [CONSOLE_QUEUE_SIZE]ConsoleLine = undefined;
var g_console_write: u64 = 0;
var g_console_read: u64 = 0;
var g_console_dropped_total: u64 = 0;
var g_console_dropped_unreported: u64 = 0;

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

/// Initialize only the bounded in-memory producer side. This is intentionally
/// non-I/O and safe to call before the root has an `std.Io` capability.
pub fn init() void {
    if (g_inited) return;
    for (&g_ring) |*e| e.* = .{};
    for (&g_console) |*line| line.* = .{};
    g_ring_inited = true;
    g_inited = true;
    g_min_importance = 0.30;
    g_emits_since_prune = 0;
    g_session_len = 0;
    g_db_path_len = 0;
    g_next_id = 1;
    g_ring_count = 0;
    g_flushed_count = 0;
    g_sampled_ts_ms = 0;
    g_events_dropped_total = 0;
    g_events_dropped_unreported = 0;
    g_console_write = 0;
    g_console_read = 0;
    g_console_dropped_total = 0;
    g_console_dropped_unreported = 0;
}

pub const FlushStats = struct {
    events_persisted: usize = 0,
    events_memory_only: usize = 0,
    console_lines_written: usize = 0,
    events_dropped: u64 = 0,
    console_lines_dropped: u64 = 0,
    persistence_failed: bool = false,
    stderr_failed: bool = false,
};

/// Root-owned effectful half of the bus. It may retain files/database handles,
/// but the producer globals above never retain an `std.Io` capability.
pub const Sink = struct {
    db: ?sqlite.Database = null,
    insert_stmt: ?sqlite.Statement = null,
    closed: bool = false,

    pub fn flush(self: *Sink, io: std.Io) FlushStats {
        if (self.closed) return .{};
        return flushTo(self, io);
    }

    /// Final flush, then release effectful resources. The explicit `io` keeps
    /// shutdown at the same capability boundary as normal flushing.
    pub fn close(self: *Sink, io: std.Io) FlushStats {
        if (self.closed) return .{};
        const stats = flushTo(self, io);
        if (self.insert_stmt) |*stmt| stmt.deinit();
        self.insert_stmt = null;
        if (self.db) |*db| db.close();
        self.db = null;
        self.closed = true;
        return stats;
    }
};

/// Open the root-owned sink. SQLite persistence is best-effort; a returned
/// sink with no database still drains the producer queue and stderr queue.
pub fn open(io: std.Io, environ: *const std.process.Environ.Map) Sink {
    if (!g_inited) init();

    var sid_bytes: [@sizeOf(u64)]u8 = undefined;
    io.random(&sid_bytes);
    const sid = std.mem.readInt(u64, &sid_bytes, .little);
    const sid_str = std.fmt.bufPrint(&g_session_buf, "{x:0>16}", .{sid}) catch &.{};
    g_session_len = sid_str.len;
    g_sampled_ts_ms = std.Io.Clock.now(.real, io).toMilliseconds();

    var sink: Sink = .{};
    openPersistence(&sink, io, environ);
    _ = emitWithImportance("bus.boot", "framework/event_bus.zig", 0.6, null, "{}");
    return sink;
}

fn openPersistence(sink: *Sink, io: std.Io, environ: *const std.process.Environ.Map) void {
    const home = environ.get("HOME") orelse return;
    var dir_buf: [384]u8 = undefined;
    const dir_path = std.fmt.bufPrint(&dir_buf, "{s}/.cache/reactjit", .{home}) catch return;
    std.Io.Dir.cwd().createDirPath(io, dir_path) catch |err| {
        queueOpenWarning("create event directory", err);
        return;
    };

    const db_path = std.fmt.bufPrint(&g_db_path_buf, "{s}/{s}", .{ home, DB_SUBPATH }) catch return;
    g_db_path_len = db_path.len;

    var db = sqlite.Database.open(io, db_path) catch |err| {
        queueOpenWarning("open event database", err);
        return;
    };
    db.exec("PRAGMA journal_mode=WAL;") catch {};
    db.exec("PRAGMA synchronous=NORMAL;") catch {};
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
    ) catch |err| {
        queueOpenWarning("create event schema", err);
        db.close();
        return;
    };
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms);") catch {};
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_imp ON events(importance);") catch {};
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);") catch {};

    const stmt = db.prepare(
        "INSERT INTO events(ts_ms, session_id, event_type, source, importance, parent_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?);",
    ) catch |err| {
        queueOpenWarning("prepare event insert", err);
        db.close();
        return;
    };
    sink.db = db;
    sink.insert_stmt = stmt;
}

fn queueOpenWarning(action: []const u8, err: anyerror) void {
    var buf: [256]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, "event bus could not {s}: {s}", .{ action, @errorName(err) }) catch return;
    _ = emitFromLog(.warn, "event_bus", msg);
}

/// Release only the non-I/O producer state. Close the root-owned Sink first.
pub fn deinit() void {
    if (!g_inited) return;
    g_ring_inited = false;
    g_inited = false;
    g_session_len = 0;
    g_db_path_len = 0;
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

    const id = g_next_id;
    g_next_id += 1;

    if (g_ring_inited) {
        // The history ring doubles as the pending persistence queue. When the
        // producer laps flush, advance the pending cursor and account for the
        // exact number of entries lost before persistence.
        if (g_ring_count - g_flushed_count >= RING_SIZE) {
            g_flushed_count += 1;
            g_events_dropped_total += 1;
            g_events_dropped_unreported += 1;
        }
        const slot: usize = @intCast(g_ring_count % RING_SIZE);
        const e = &g_ring[slot];
        e.set(id, g_sampled_ts_ms, importance, parent_id, event_type, source, payload_json);
        g_ring_count += 1;
    }

    return id;
}

fn enqueueConsole(line: []const u8) void {
    if (g_console_write - g_console_read >= CONSOLE_QUEUE_SIZE) {
        g_console_read += 1;
        g_console_dropped_total += 1;
        g_console_dropped_unreported += 1;
    }
    const slot: usize = @intCast(g_console_write % CONSOLE_QUEUE_SIZE);
    g_console[slot].text.setLine(line);
    g_console_write += 1;
}

pub fn pendingCount() usize {
    return @intCast(g_ring_count - g_flushed_count);
}

pub fn droppedCount() u64 {
    return g_events_dropped_total;
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
                .{ e.id, e.ts_ms, e.importance, e.event_type.slice(), e.source.slice() },
            ) catch continue;
            try out.appendSlice(out_alloc, head);
            try out.appendSlice(out_alloc, e.payload.slice());
            try out.append(out_alloc, '}');
        }
    }
    try out.append(out_alloc, ']');
    return out.toOwnedSlice(out_alloc);
}

fn flushTo(sink: *Sink, io: std.Io) FlushStats {
    if (!g_inited) return .{};
    var stats: FlushStats = .{};
    g_sampled_ts_ms = std.Io.Clock.now(.real, io).toMilliseconds();

    stats.events_dropped = g_events_dropped_unreported;
    if (g_events_dropped_unreported > 0) {
        if (writeDropReport(io, "events", g_events_dropped_unreported)) {
            g_events_dropped_unreported = 0;
        } else {
            stats.stderr_failed = true;
        }
    }

    stats.console_lines_dropped = g_console_dropped_unreported;
    if (g_console_dropped_unreported > 0) {
        if (writeDropReport(io, "stderr lines", g_console_dropped_unreported)) {
            g_console_dropped_unreported = 0;
        } else {
            stats.stderr_failed = true;
        }
    }

    while (g_console_read < g_console_write) {
        const slot: usize = @intCast(g_console_read % CONSOLE_QUEUE_SIZE);
        std.Io.File.stderr().writeStreamingAll(io, g_console[slot].text.slice()) catch {
            stats.stderr_failed = true;
            break;
        };
        g_console_read += 1;
        stats.console_lines_written += 1;
    }

    const flush_end = g_ring_count;
    if (sink.insert_stmt) |*stmt| {
        while (g_flushed_count < flush_end) {
            const slot: usize = @intCast(g_flushed_count % RING_SIZE);
            const entry = &g_ring[slot];
            if (entry.ts_ms == 0) entry.ts_ms = g_sampled_ts_ms;
            insertRow(stmt, entry) catch {
                stats.persistence_failed = true;
                break;
            };
            g_flushed_count += 1;
            stats.events_persisted += 1;
            g_emits_since_prune += 1;
            if (g_emits_since_prune >= PRUNE_EVERY) {
                g_emits_since_prune = 0;
                if (sink.db) |*db| pruneOldRows(db);
            }
        }
    } else {
        stats.events_memory_only = @intCast(flush_end - g_flushed_count);
        g_flushed_count = flush_end;
    }
    return stats;
}

fn writeDropReport(io: std.Io, comptime kind: []const u8, count: u64) bool {
    var buf: [160]u8 = undefined;
    const line = std.fmt.bufPrint(
        &buf,
        "[warn/event_bus] dropped {d} queued {s} before flush\n",
        .{ count, kind },
    ) catch return false;
    std.Io.File.stderr().writeStreamingAll(io, line) catch return false;
    return true;
}

/// Drop everything below (max rowid - ROW_CAP). Bounded work — SQLite's
/// rowid is the primary key, so the WHERE clause hits the b-tree directly.
fn pruneOldRows(db: *sqlite.Database) void {
    var buf: [160:0]u8 = undefined;
    const sql = std.fmt.bufPrintZ(
        &buf,
        "DELETE FROM events WHERE rowid <= (SELECT MAX(rowid) - {d} FROM events);",
        .{ROW_CAP},
    ) catch return;
    db.exec(sql) catch {};
}

fn insertRow(stmt: *sqlite.Statement, entry: *const RingEntry) !void {
    try stmt.reset();
    try stmt.bindInt(1, entry.ts_ms);
    try stmt.bindText(2, g_session_buf[0..g_session_len]);
    try stmt.bindText(3, entry.event_type.slice());
    try stmt.bindText(4, entry.source.slice());
    try stmt.bindFloat(5, entry.importance);
    if (entry.parent_id) |pid| {
        try stmt.bindInt(6, @intCast(pid));
    } else {
        try stmt.bindNull(6);
    }
    try stmt.bindText(7, entry.payload.slice());
    _ = try stmt.step();
}

// ── std.log adapter ────────────────────────────────────────────────────
//
// Wire as `pub const std_options = .{ .logFn = event_bus.fromStdLog }`
// in v8_app.zig. Every `std.log.info/warn/err/debug` call in the
// framework then routes through here. Warn/error terminal fallback is queued
// alongside the bus event and drained by the root-owned Sink.
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
/// override) and framework/log.zig's print/info/warn/err helpers. This only
/// formats and enqueues; warn/error stderr fallback is drained by Sink.flush.
pub fn emitFromLog(level: std.log.Level, scope: []const u8, msg: []const u8) u64 {
    if (!g_inited) init();
    const lvl_str = @tagName(level);

    // Console gate — errors and warns are always queued for stderr. Lower
    // levels remain bus-only.
    if (level == .err or level == .warn) {
        var line_buf: [4200]u8 = undefined;
        const line = std.fmt.bufPrint(&line_buf, "[{s}/{s}] {s}\n", .{ lvl_str, scope, msg }) catch msg;
        enqueueConsole(line);
    }

    const importance: f32 = switch (level) {
        .err => 0.85,
        .warn => 0.70,
        .info => 0.30,
        .debug => 0.15,
    };

    var pbuf: [PAYLOAD_CAP]u8 = undefined;
    var writer: std.Io.Writer = .fixed(&pbuf);
    const payload = blk: {
        writer.writeAll("{\"msg\":") catch break :blk "{\"truncated\":true}";
        writeJsonString(&writer, msg) catch break :blk "{\"truncated\":true}";
        writer.writeAll(",\"scope\":") catch break :blk "{\"truncated\":true}";
        writeJsonString(&writer, scope) catch break :blk "{\"truncated\":true}";
        writer.writeAll(",\"level\":") catch break :blk "{\"truncated\":true}";
        writeJsonString(&writer, lvl_str) catch break :blk "{\"truncated\":true}";
        writer.writeAll("}") catch break :blk "{\"truncated\":true}";
        break :blk writer.buffered();
    };

    var src_buf: [80]u8 = undefined;
    const src = std.fmt.bufPrint(&src_buf, "log:{s}", .{scope}) catch "log:?";

    const event_type = switch (level) {
        .err => "log.err",
        .warn => "log.warn",
        .info => "log.info",
        .debug => "log.debug",
    };

    return emitWithImportance(event_type, src, importance, null, payload);
}

pub fn fromStdLog(
    comptime level: std.log.Level,
    comptime scope: @EnumLiteral(),
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
/// Stderr fallthrough is queued regardless of bus state so JS-side errors
/// remain visible at the next root flush.
pub fn emitJsLog(severity: i32, msg: []const u8) u64 {
    if (!g_inited) init();
    if (severity >= 1) {
        var line_buf: [4200]u8 = undefined;
        const tag: []const u8 = if (severity >= 2) "[js.err]" else "[js.warn]";
        const line = std.fmt.bufPrint(&line_buf, "{s} {s}\n", .{ tag, msg }) catch msg;
        enqueueConsole(line);
    }

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

    var pbuf: [PAYLOAD_CAP]u8 = undefined;
    var writer: std.Io.Writer = .fixed(&pbuf);
    const payload = blk: {
        writer.writeAll("{\"msg\":") catch break :blk "{\"truncated\":true}";
        writeJsonString(&writer, msg) catch break :blk "{\"truncated\":true}";
        writer.writeAll("}") catch break :blk "{\"truncated\":true}";
        break :blk writer.buffered();
    };

    return emitWithImportance(event_type, "js", importance, null, payload);
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
            const payload_str = if (e.payload.len > 0) e.payload.slice() else "{}";
            if (e.parent_id) |pid| {
                try w.print(
                    "{{\"id\":{d},\"ts\":{d},\"type\":\"{s}\",\"src\":\"{s}\",\"imp\":{d:.3},\"par\":{d},\"payload\":{s}}}",
                    .{ e.id, e.ts_ms, e.event_type.slice(), e.source.slice(), e.importance, pid, payload_str },
                );
            } else {
                try w.print(
                    "{{\"id\":{d},\"ts\":{d},\"type\":\"{s}\",\"src\":\"{s}\",\"imp\":{d:.3},\"par\":null,\"payload\":{s}}}",
                    .{ e.id, e.ts_ms, e.event_type.slice(), e.source.slice(), e.importance, payload_str },
                );
            }
            emitted += 1;
        }
    }

    try buf.append(allocator, ']');
    return buf.toOwnedSlice(allocator);
}

test "emit is non-I/O and preserves filter and id semantics" {
    init();
    defer deinit();

    setMinImportance(0.5);
    try std.testing.expectEqual(@as(u64, 0), emitWithImportance("below", "test", 0.2, null, "{}"));
    const first = emit("first", "test", null, "{}");
    const second = emitWithImportance("second", "test", 0.9, first, "{}");
    try std.testing.expectEqual(@as(u64, 1), first);
    try std.testing.expectEqual(@as(u64, 2), second);
    try std.testing.expectEqual(@as(usize, 2), pendingCount());
}

test "pending queue is bounded and reports exact overwrite count" {
    init();
    defer deinit();
    setMinImportance(0);

    for (0..RING_SIZE + 3) |_| _ = emit("bulk", "test", null, "{}");
    try std.testing.expectEqual(RING_SIZE, pendingCount());
    try std.testing.expectEqual(@as(u64, 3), droppedCount());
}

test "memory-only flush drains pending events at explicit Io boundary" {
    init();
    defer deinit();
    _ = emit("memory", "test", null, "{}");

    var sink: Sink = .{};
    const stats = sink.flush(std.testing.io);
    try std.testing.expectEqual(@as(usize, 1), stats.events_memory_only);
    try std.testing.expectEqual(@as(usize, 0), pendingCount());
}

test "oversize payload remains valid JSON marker" {
    init();
    defer deinit();
    setMinImportance(0);
    var payload: [PAYLOAD_CAP + 1]u8 = undefined;
    @memset(&payload, 'x');
    _ = emit("large", "test", null, &payload);
    const json = try recentEventsJson(std.testing.allocator, 1);
    defer std.testing.allocator.free(json);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"truncated\":true") != null);
}
