// tsz/runtime/localstore.zig
//
// SQLite-backed namespaced key/value store.
// Mirrors love2d/lua/localstore.lua: (namespace, key) → text value with timestamp.
// Used by the compiler-generated useLocalStore() hook for persistent state.
//
// Depends on: fs.zig (data directory), sqlite.zig (database).
// fs.init() must be called before localstore.init().

const std = @import("std");
const fs = @import("../fs/fs.zig");
const sqlite = @import("sqlite.zig");

pub const MAX_KEY = 256;
// Values are heap-backed end to end — the v8 binding allocs the exact UTF-8 length,
// the write-queue job owns a heap []u8, and SQLite bindText handles up to ~1GB — so
// this is a SANITY ceiling, not a buffer size. History: 8192 when jobs held fixed
// buffers (silently ate custom-texture / game-state writes), then 4MB, which a
// detailed imported mesh (Studio EditMesh JSON in editor-state) blew with
// BufferTooSmall (req_2078/req_2079). Raised to 64MB so a high-poly model is never
// localstore-bound; it still catches a genuinely runaway (multi-hundred-MB) value.
pub const MAX_VALUE = 64 * 1024 * 1024;
pub const MAX_KEYS = 256;

const value_alloc = std.heap.c_allocator;

pub const KeyEntry = struct {
    buf: [MAX_KEY]u8 = undefined,
    len: u16 = 0,

    pub fn key(self: *const KeyEntry) []const u8 {
        return self.buf[0..self.len];
    }
};

// -- Module state --

var db: ?sqlite.Database = null;
var db_mutex: std.Io.Mutex = .init;
var db_path_buf: [fs.MAX_PATH]u8 = undefined;
var db_path_len: usize = 0;

const WRITE_QUEUE_CAP = 1024;

const WriteJob = struct {
    namespace: [MAX_KEY]u8 = undefined,
    namespace_len: u16 = 0,
    key: [MAX_KEY]u8 = undefined,
    key_len: u16 = 0,
    /// owned heap copy (value_alloc); freed by the writer thread (queue jobs),
    /// on overwrite/eviction (cache jobs), or in deinit
    value: []u8 = &.{},

    fn namespaceSlice(self: *const WriteJob) []const u8 {
        return self.namespace[0..self.namespace_len];
    }

    fn keySlice(self: *const WriteJob) []const u8 {
        return self.key[0..self.key_len];
    }

    fn valueSlice(self: *const WriteJob) []const u8 {
        return self.value;
    }
};

var write_mutex: std.Io.Mutex = .init;
var write_cond: std.Io.Condition = .init;
var write_queue: [WRITE_QUEUE_CAP]WriteJob = undefined;
var write_queue_len: usize = 0;
var write_cache: [WRITE_QUEUE_CAP]WriteJob = undefined;
var write_cache_len: usize = 0;
var write_stop: bool = false;
var write_tasks: std.Io.Group = .init;
var writer_started: bool = false;

fn ensureSchema(database: *sqlite.Database) !void {
    try database.exec(
        "CREATE TABLE IF NOT EXISTS store (" ++
            "namespace TEXT NOT NULL, " ++
            "key TEXT NOT NULL, " ++
            "value TEXT, " ++
            "updated_at INTEGER NOT NULL, " ++
            "PRIMARY KEY (namespace, key))",
    );
}

fn setWithDb(io: std.Io, database: *sqlite.Database, namespace: []const u8, key: []const u8, value: []const u8) !void {
    var stmt = try database.prepare(
        "INSERT OR REPLACE INTO store (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)",
    );
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);
    try stmt.bindText(3, value);
    try stmt.bindInt(4, std.Io.Clock.now(.real, io).toSeconds());

    _ = try stmt.step();
}

fn writeJobFrom(namespace: []const u8, key: []const u8, value: []const u8) !WriteJob {
    var job = WriteJob{};
    @memcpy(job.namespace[0..namespace.len], namespace);
    job.namespace_len = @intCast(namespace.len);
    @memcpy(job.key[0..key.len], key);
    job.key_len = @intCast(key.len);
    job.value = try value_alloc.dupe(u8, value);
    return job;
}

fn rememberSetLocked(namespace: []const u8, key: []const u8, value: []const u8) !void {
    var i: usize = 0;
    while (i < write_cache_len) : (i += 1) {
        if (std.mem.eql(u8, write_cache[i].namespaceSlice(), namespace) and
            std.mem.eql(u8, write_cache[i].keySlice(), key))
        {
            const next = try value_alloc.dupe(u8, value);
            value_alloc.free(write_cache[i].value);
            write_cache[i].value = next;
            return;
        }
    }

    if (write_cache_len >= WRITE_QUEUE_CAP) {
        value_alloc.free(write_cache[0].value);
        var j: usize = 1;
        while (j < write_cache_len) : (j += 1) {
            write_cache[j - 1] = write_cache[j];
        }
        write_cache_len -= 1;
    }

    write_cache[write_cache_len] = try writeJobFrom(namespace, key, value);
    write_cache_len += 1;
}

fn getRemembered(io: std.Io, namespace: []const u8, key: []const u8, buf: []u8) !?usize {
    write_mutex.lockUncancelable(io);
    defer write_mutex.unlock(io);

    var remaining = write_cache_len;
    while (remaining > 0) {
        remaining -= 1;
        const job = &write_cache[remaining];
        if (std.mem.eql(u8, job.namespaceSlice(), namespace) and
            std.mem.eql(u8, job.keySlice(), key))
        {
            const val = job.valueSlice();
            // falling through to the DB here would read a STALE row — the
            // fresh value is this one; a too-small buffer is the caller's error
            if (val.len > buf.len) return error.BufferTooSmall;
            @memcpy(buf[0..val.len], val);
            return val.len;
        }
    }
    return null;
}

/// Read-your-writes lookup that allocates: pending/cached value first, then the
/// DB row. Caller owns the returned slice. Null = key not found.
fn getRememberedAlloc(io: std.Io, allocator: std.mem.Allocator, namespace: []const u8, key: []const u8) !?[]u8 {
    write_mutex.lockUncancelable(io);
    defer write_mutex.unlock(io);

    var remaining = write_cache_len;
    while (remaining > 0) {
        remaining -= 1;
        const job = &write_cache[remaining];
        if (std.mem.eql(u8, job.namespaceSlice(), namespace) and
            std.mem.eql(u8, job.keySlice(), key))
        {
            return try allocator.dupe(u8, job.valueSlice());
        }
    }
    return null;
}

/// Drop matching entries from the read-back cache AND the pending queue.
/// null namespace = everything; null key = the whole namespace. Without this,
/// delete()/clear() removed the DB row while the session cache kept serving
/// the dead value — a delete that doesn't delete.
fn purgeRemembered(io: std.Io, namespace: ?[]const u8, key: ?[]const u8) void {
    write_mutex.lockUncancelable(io);
    defer write_mutex.unlock(io);

    inline for (.{ .{ &write_cache, &write_cache_len }, .{ &write_queue, &write_queue_len } }) |pair| {
        const jobs = pair[0];
        const len = pair[1];
        var i: usize = 0;
        while (i < len.*) {
            const job = &jobs[i];
            const ns_hit = namespace == null or std.mem.eql(u8, job.namespaceSlice(), namespace.?);
            const key_hit = key == null or std.mem.eql(u8, job.keySlice(), key.?);
            if (ns_hit and key_hit) {
                value_alloc.free(job.value);
                var j: usize = i + 1;
                while (j < len.*) : (j += 1) jobs[j - 1] = jobs[j];
                len.* -= 1;
            } else {
                i += 1;
            }
        }
    }
}

fn enqueueSet(io: std.Io, namespace: []const u8, key: []const u8, value: []const u8) !void {
    if (namespace.len > MAX_KEY or key.len > MAX_KEY or value.len > MAX_VALUE) return error.BufferTooSmall;

    write_mutex.lockUncancelable(io);
    defer write_mutex.unlock(io);
    try rememberSetLocked(namespace, key, value);

    var i: usize = 0;
    while (i < write_queue_len) : (i += 1) {
        if (std.mem.eql(u8, write_queue[i].namespaceSlice(), namespace) and
            std.mem.eql(u8, write_queue[i].keySlice(), key))
        {
            const next = try value_alloc.dupe(u8, value);
            value_alloc.free(write_queue[i].value);
            write_queue[i].value = next;
            write_cond.signal(io);
            return;
        }
    }

    if (write_queue_len >= WRITE_QUEUE_CAP) {
        // Drop the oldest pending write rather than blocking the UI thread.
        value_alloc.free(write_queue[0].value);
        var j: usize = 1;
        while (j < write_queue_len) : (j += 1) {
            write_queue[j - 1] = write_queue[j];
        }
        write_queue_len -= 1;
    }

    write_queue[write_queue_len] = try writeJobFrom(namespace, key, value);
    write_queue_len += 1;
    write_cond.signal(io);
}

fn popWriteJob(io: std.Io) ?WriteJob {
    write_mutex.lockUncancelable(io);
    defer write_mutex.unlock(io);

    while (write_queue_len == 0 and !write_stop) {
        // The writer owns queued heap values and must drain them during
        // shutdown, so this ownership wait is intentionally uncancelable.
        write_cond.waitUncancelable(io, &write_mutex);
    }

    if (write_queue_len == 0 and write_stop) return null;

    const job = write_queue[0];
    var i: usize = 1;
    while (i < write_queue_len) : (i += 1) {
        write_queue[i - 1] = write_queue[i];
    }
    write_queue_len -= 1;
    return job;
}

fn writerMain(io: std.Io) std.Io.Cancelable!void {
    while (popWriteJob(io)) |job| {
        db_mutex.lockUncancelable(io);
        if (db) |*d| {
            setWithDb(io, d, job.namespaceSlice(), job.keySlice(), job.valueSlice()) catch |err| {
                // a dropped persist is data loss — never fail silently
                var msg_buf: [768]u8 = undefined;
                const msg = std.fmt.bufPrint(&msg_buf, "[localstore] WRITE FAILED ns={s} key={s} len={d}: {s}\n", .{
                    job.namespaceSlice(), job.keySlice(), job.value.len, @errorName(err),
                }) catch &.{};
                std.Io.File.stderr().writeStreamingAll(io, msg) catch {};
            };
        }
        db_mutex.unlock(io);
        value_alloc.free(job.value);
    }
}

// -- Init / Deinit --

/// Initialize the local store. Opens (or creates) localstore.db in the app data directory.
/// Requires fs.init() to have been called first.
pub fn init(io: std.Io) !void {
    if (db != null) return;

    const data_path = try fs.dataDirPath();
    var path_buf: [fs.MAX_PATH]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/localstore.db", .{data_path}) catch
        return error.NameTooLong;

    var database = try sqlite.Database.open(io, path);

    ensureSchema(&database) catch |err| {
        database.close();
        return err;
    };

    @memcpy(db_path_buf[0..path.len], path);
    db_path_len = path.len;
    write_stop = false;
    db = database;
    write_tasks.concurrent(io, writerMain, .{io}) catch |err| {
        if (db) |*d| d.close();
        db = null;
        db_path_len = 0;
        return err;
    };
    writer_started = true;
}

pub fn deinit(io: std.Io) void {
    write_mutex.lockUncancelable(io);
    write_stop = true;
    write_cond.signal(io);
    write_mutex.unlock(io);
    if (writer_started) _ = write_tasks.await(io) catch {};
    writer_started = false;
    db_mutex.lockUncancelable(io);
    defer db_mutex.unlock(io);
    if (db) |*d| d.close();
    db = null;
    db_path_len = 0;
    // the writer drains the queue before join; these loops only matter when
    // the thread never spawned — and the read-back cache always owns its values
    var i: usize = 0;
    while (i < write_queue_len) : (i += 1) value_alloc.free(write_queue[i].value);
    write_queue_len = 0;
    i = 0;
    while (i < write_cache_len) : (i += 1) value_alloc.free(write_cache[i].value);
    write_cache_len = 0;
}

pub fn isInitialized() bool {
    return db != null;
}

// -- Get --

/// Get a value by namespace and key. Returns bytes written to buf, or null if not found.
pub fn get(io: std.Io, namespace: []const u8, key: []const u8, buf: []u8) !?usize {
    if (try getRemembered(io, namespace, key, buf)) |n| return n;

    db_mutex.lockUncancelable(io);
    defer db_mutex.unlock(io);

    var d = db orelse return error.NotInitialized;
    var stmt = try d.prepare("SELECT value FROM store WHERE namespace = ? AND key = ?");
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);

    if (!try stmt.step()) return null; // key not found

    const val = stmt.columnText(0) orelse return null;
    if (val.len > buf.len) return error.BufferTooSmall;
    @memcpy(buf[0..val.len], val);
    return val.len;
}

/// Get a value of any size. Caller owns the returned slice (free with the same
/// allocator). Null = key not found. This is the host bindings' read path —
/// fixed read buffers silently truncated/dropped large values (the same class
/// of bug as the old 8KB write cap).
pub fn getAlloc(io: std.Io, allocator: std.mem.Allocator, namespace: []const u8, key: []const u8) !?[]u8 {
    if (try getRememberedAlloc(io, allocator, namespace, key)) |v| return v;

    db_mutex.lockUncancelable(io);
    defer db_mutex.unlock(io);

    var d = db orelse return error.NotInitialized;
    var stmt = try d.prepare("SELECT value FROM store WHERE namespace = ? AND key = ?");
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);

    if (!try stmt.step()) return null; // key not found

    const val = stmt.columnText(0) orelse return null;
    return try allocator.dupe(u8, val);
}

/// Does the key exist? No value buffer involved, so size never matters.
pub fn has(io: std.Io, namespace: []const u8, key: []const u8) !bool {
    {
        write_mutex.lockUncancelable(io);
        defer write_mutex.unlock(io);
        var remaining = write_cache_len;
        while (remaining > 0) {
            remaining -= 1;
            const job = &write_cache[remaining];
            if (std.mem.eql(u8, job.namespaceSlice(), namespace) and
                std.mem.eql(u8, job.keySlice(), key)) return true;
        }
    }

    db_mutex.lockUncancelable(io);
    defer db_mutex.unlock(io);

    var d = db orelse return error.NotInitialized;
    var stmt = try d.prepare("SELECT 1 FROM store WHERE namespace = ? AND key = ?");
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);
    return try stmt.step();
}

/// Get a stored integer value. Returns null if not found.
pub fn getInt(io: std.Io, namespace: []const u8, key: []const u8) !?i64 {
    var buf: [64]u8 = undefined;
    const len = (try get(io, namespace, key, &buf)) orelse return null;
    return std.fmt.parseInt(i64, buf[0..len], 10) catch null;
}

/// Get a stored float value. Returns null if not found.
pub fn getFloat(io: std.Io, namespace: []const u8, key: []const u8) !?f64 {
    var buf: [64]u8 = undefined;
    const len = (try get(io, namespace, key, &buf)) orelse return null;
    return std.fmt.parseFloat(f64, buf[0..len]) catch null;
}

/// Get a stored boolean value. Returns null if not found.
pub fn getBool(io: std.Io, namespace: []const u8, key: []const u8) !?bool {
    var buf: [8]u8 = undefined;
    const len = (try get(io, namespace, key, &buf)) orelse return null;
    const s = buf[0..len];
    if (std.mem.eql(u8, s, "true") or std.mem.eql(u8, s, "1")) return true;
    if (std.mem.eql(u8, s, "false") or std.mem.eql(u8, s, "0")) return false;
    return null;
}

// -- Set --

/// Set a text value for namespace + key. Creates or replaces.
pub fn set(io: std.Io, namespace: []const u8, key: []const u8, value: []const u8) !void {
    if (db == null) return error.NotInitialized;
    try enqueueSet(io, namespace, key, value);
}

/// Set an integer value.
pub fn setInt(io: std.Io, namespace: []const u8, key: []const u8, value: i64) !void {
    var buf: [64]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "{d}", .{value}) catch return error.BufferTooSmall;
    return set(io, namespace, key, s);
}

/// Set a float value.
pub fn setFloat(io: std.Io, namespace: []const u8, key: []const u8, value: f64) !void {
    var buf: [64]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "{d}", .{value}) catch return error.BufferTooSmall;
    return set(io, namespace, key, s);
}

/// Set a boolean value.
pub fn setBool(io: std.Io, namespace: []const u8, key: []const u8, value: bool) !void {
    return set(io, namespace, key, if (value) "true" else "false");
}

// -- Delete --

/// Delete a single key from a namespace.
pub fn delete(io: std.Io, namespace: []const u8, key: []const u8) !void {
    // the cache/queue first, so a read can't resurrect the dead value
    purgeRemembered(io, namespace, key);

    db_mutex.lockUncancelable(io);
    defer db_mutex.unlock(io);

    var d = db orelse return error.NotInitialized;
    var stmt = try d.prepare("DELETE FROM store WHERE namespace = ? AND key = ?");
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);
    _ = try stmt.step();
}

// -- Keys --

fn keyEntryLessThan(_: void, a: KeyEntry, b: KeyEntry) bool {
    return std.mem.lessThan(u8, a.key(), b.key());
}

/// List all keys in a namespace, sorted alphabetically. Merges pending writes
/// (the async queue may not have committed yet) with the DB rows.
/// Returns the number of keys written to `out`.
pub fn keys(io: std.Io, namespace: []const u8, out: []KeyEntry) !usize {
    var count: usize = 0;
    {
        db_mutex.lockUncancelable(io);
        defer db_mutex.unlock(io);

        var d = db orelse return error.NotInitialized;
        var stmt = try d.prepare("SELECT key FROM store WHERE namespace = ? ORDER BY key");
        defer stmt.deinit();

        try stmt.bindText(1, namespace);

        while (try stmt.step()) {
            if (count >= out.len) break;
            const k = stmt.columnText(0) orelse continue;
            const len: u16 = @intCast(@min(k.len, MAX_KEY));
            @memcpy(out[count].buf[0..len], k[0..len]);
            out[count].len = len;
            count += 1;
        }
    }

    // read-your-writes: session-written keys the writer hasn't committed yet
    {
        write_mutex.lockUncancelable(io);
        defer write_mutex.unlock(io);
        var i: usize = 0;
        outer: while (i < write_cache_len) : (i += 1) {
            const job = &write_cache[i];
            if (!std.mem.eql(u8, job.namespaceSlice(), namespace)) continue;
            if (count >= out.len) break;
            var j: usize = 0;
            while (j < count) : (j += 1) {
                if (std.mem.eql(u8, out[j].key(), job.keySlice())) continue :outer;
            }
            const len: u16 = job.key_len;
            @memcpy(out[count].buf[0..len], job.keySlice());
            out[count].len = len;
            count += 1;
        }
    }

    std.sort.pdq(KeyEntry, out[0..count], {}, keyEntryLessThan);
    return count;
}

// -- Clear --

/// Clear all keys in a namespace. If namespace is null, clear everything.
pub fn clear(io: std.Io, namespace: ?[]const u8) !void {
    // the cache/queue first, so reads can't resurrect cleared values
    purgeRemembered(io, namespace, null);

    db_mutex.lockUncancelable(io);
    defer db_mutex.unlock(io);

    var d = db orelse return error.NotInitialized;

    if (namespace) |ns| {
        var stmt = try d.prepare("DELETE FROM store WHERE namespace = ?");
        defer stmt.deinit();
        try stmt.bindText(1, ns);
        _ = try stmt.step();
    } else {
        try d.exec("DELETE FROM store");
    }
}

// -- Tests --

fn initTestFs() !void {
    var environ = std.process.Environ.Map.init(std.testing.allocator);
    defer environ.deinit();
    try environ.put("HOME", "/tmp");
    try fs.init(std.testing.io, &environ, "tsz-localstore-test");
}

test "init requires fs" {
    // fs not initialized, so init should fail
    const result = init(std.testing.io);
    try std.testing.expectError(error.NotInitialized, result);
}

test "round-trip text value" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    try set(std.testing.io, "app", "theme", "dark");

    var buf: [256]u8 = undefined;
    const len = (try get(std.testing.io, "app", "theme", &buf)).?;
    try std.testing.expectEqualStrings("dark", buf[0..len]);
}

test "round-trip typed values" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    // Integer
    try setInt(std.testing.io, "app", "count", 42);
    try std.testing.expectEqual(@as(?i64, 42), try getInt(std.testing.io, "app", "count"));

    // Float
    try setFloat(std.testing.io, "app", "ratio", 3.14);
    const f = (try getFloat(std.testing.io, "app", "ratio")).?;
    try std.testing.expect(std.math.approxEqAbs(f64, 3.14, f, 0.01));

    // Bool
    try setBool(std.testing.io, "app", "enabled", true);
    try std.testing.expectEqual(@as(?bool, true), try getBool(std.testing.io, "app", "enabled"));
}

test "get missing key returns null" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    var buf: [256]u8 = undefined;
    const result = try get(std.testing.io, "app", "nonexistent", &buf);
    try std.testing.expect(result == null);
}

test "delete key" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    try set(std.testing.io, "app", "temp", "value");
    try delete(std.testing.io, "app", "temp");

    var buf: [256]u8 = undefined;
    try std.testing.expect((try get(std.testing.io, "app", "temp", &buf)) == null);
}

test "keys listing" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    // Clear first
    try clear(std.testing.io, "test-keys");

    try set(std.testing.io, "test-keys", "alpha", "1");
    try set(std.testing.io, "test-keys", "beta", "2");
    try set(std.testing.io, "test-keys", "gamma", "3");

    var entries: [16]KeyEntry = undefined;
    const count = try keys(std.testing.io, "test-keys", &entries);
    try std.testing.expectEqual(@as(usize, 3), count);
    try std.testing.expectEqualStrings("alpha", entries[0].key());
    try std.testing.expectEqualStrings("beta", entries[1].key());
    try std.testing.expectEqualStrings("gamma", entries[2].key());
}

test "clear namespace" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    try set(std.testing.io, "clearme", "a", "1");
    try set(std.testing.io, "clearme", "b", "2");
    try set(std.testing.io, "keep", "c", "3");

    try clear(std.testing.io, "clearme");

    // clearme keys gone
    var buf: [256]u8 = undefined;
    try std.testing.expect((try get(std.testing.io, "clearme", "a", &buf)) == null);
    try std.testing.expect((try get(std.testing.io, "clearme", "b", &buf)) == null);

    // keep keys remain
    const len = (try get(std.testing.io, "keep", "c", &buf)).?;
    try std.testing.expectEqualStrings("3", buf[0..len]);
}

test "overwrite value" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    try set(std.testing.io, "app", "version", "1.0");
    try set(std.testing.io, "app", "version", "2.0");

    var buf: [256]u8 = undefined;
    const len = (try get(std.testing.io, "app", "version", &buf)).?;
    try std.testing.expectEqualStrings("2.0", buf[0..len]);
}

test "large value survives set, restart, and getAlloc" {
    // The regression that ate painted building-face materials: a ~33KB
    // custom-textures JSON was rejected by the old 8KB MAX_VALUE and the
    // failure was swallowed — visible all session (in-process caches), gone
    // on restart. This pins set→persist→reopen→read for a >64KB value
    // (past the old write cap AND the old fixed read buffers).
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);

    const big = try std.testing.allocator.alloc(u8, 100 * 1024);
    defer std.testing.allocator.free(big);
    for (big, 0..) |*c, i| c.* = 'a' + @as(u8, @intCast(i % 26));

    try set(std.testing.io, "app", "big-value", big);

    // read-your-writes before the writer commits
    const cached = (try getAlloc(std.testing.io, std.testing.allocator, "app", "big-value")).?;
    defer std.testing.allocator.free(cached);
    try std.testing.expectEqualStrings(big, cached);

    // "restart": deinit flushes the write queue and drops the in-memory cache
    deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    const reread = (try getAlloc(std.testing.io, std.testing.allocator, "app", "big-value")).?;
    defer std.testing.allocator.free(reread);
    try std.testing.expectEqualStrings(big, reread);
    try std.testing.expect(try has(std.testing.io, "app", "big-value"));
}

test "oversized value is a loud error, not a silent drop" {
    try initTestFs();
    defer fs.deinit(std.testing.io);
    try init(std.testing.io);
    defer deinit(std.testing.io);

    const huge = try std.testing.allocator.alloc(u8, MAX_VALUE + 1);
    defer std.testing.allocator.free(huge);
    @memset(huge, 'x');
    try std.testing.expectError(error.BufferTooSmall, set(std.testing.io, "app", "too-big", huge));
}
