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
const host_io = @import("../host_io.zig");

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
var db_mutex: host_io.Mutex = .{};
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

var write_mutex: host_io.Mutex = .{};
var write_cond: std.Io.Condition = .init;
var write_queue: [WRITE_QUEUE_CAP]WriteJob = undefined;
var write_queue_len: usize = 0;
var write_cache: [WRITE_QUEUE_CAP]WriteJob = undefined;
var write_cache_len: usize = 0;
var write_stop: bool = false;
var write_thread: ?std.Thread = null;

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

fn setWithDb(database: *sqlite.Database, namespace: []const u8, key: []const u8, value: []const u8) !void {
    var stmt = try database.prepare(
        "INSERT OR REPLACE INTO store (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)",
    );
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);
    try stmt.bindText(3, value);
    try stmt.bindInt(4, host_io.timestamp());

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

fn getRemembered(namespace: []const u8, key: []const u8, buf: []u8) !?usize {
    write_mutex.lock();
    defer write_mutex.unlock();

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
fn getRememberedAlloc(allocator: std.mem.Allocator, namespace: []const u8, key: []const u8) !?[]u8 {
    write_mutex.lock();
    defer write_mutex.unlock();

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
fn purgeRemembered(namespace: ?[]const u8, key: ?[]const u8) void {
    write_mutex.lock();
    defer write_mutex.unlock();

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

fn enqueueSet(namespace: []const u8, key: []const u8, value: []const u8) !void {
    if (namespace.len > MAX_KEY or key.len > MAX_KEY or value.len > MAX_VALUE) return error.BufferTooSmall;

    write_mutex.lock();
    defer write_mutex.unlock();
    try rememberSetLocked(namespace, key, value);

    var i: usize = 0;
    while (i < write_queue_len) : (i += 1) {
        if (std.mem.eql(u8, write_queue[i].namespaceSlice(), namespace) and
            std.mem.eql(u8, write_queue[i].keySlice(), key))
        {
            const next = try value_alloc.dupe(u8, value);
            value_alloc.free(write_queue[i].value);
            write_queue[i].value = next;
            write_cond.signal(host_io.io());
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
    write_cond.signal(host_io.io());
}

fn popWriteJob() ?WriteJob {
    write_mutex.lock();
    defer write_mutex.unlock();

    while (write_queue_len == 0 and !write_stop) {
        write_cond.waitUncancelable(host_io.io(), &write_mutex.inner);
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

fn writerMain() void {
    while (popWriteJob()) |job| {
        db_mutex.lock();
        if (db) |*d| {
            setWithDb(d, job.namespaceSlice(), job.keySlice(), job.valueSlice()) catch |err| {
                // a dropped persist is data loss — never fail silently
                std.debug.print("[localstore] WRITE FAILED ns={s} key={s} len={d}: {s}\n", .{
                    job.namespaceSlice(), job.keySlice(), job.value.len, @errorName(err),
                });
            };
        }
        db_mutex.unlock();
        value_alloc.free(job.value);
    }
}

// -- Init / Deinit --

/// Initialize the local store. Opens (or creates) localstore.db in the app data directory.
/// Requires fs.init() to have been called first.
pub fn init() !void {
    if (db != null) return;

    const data_path = try fs.dataDirPath();
    var path_buf: [fs.MAX_PATH]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/localstore.db", .{data_path}) catch
        return error.NameTooLong;

    var database = try sqlite.Database.open(path);

    ensureSchema(&database) catch |err| {
        database.close();
        return err;
    };

    @memcpy(db_path_buf[0..path.len], path);
    db_path_len = path.len;
    write_stop = false;
    db = database;
    write_thread = std.Thread.spawn(.{}, writerMain, .{}) catch null;
}

pub fn deinit() void {
    write_mutex.lock();
    write_stop = true;
    write_cond.signal(host_io.io());
    write_mutex.unlock();
    if (write_thread) |t| t.join();
    write_thread = null;
    db_mutex.lock();
    defer db_mutex.unlock();
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
pub fn get(namespace: []const u8, key: []const u8, buf: []u8) !?usize {
    if (try getRemembered(namespace, key, buf)) |n| return n;

    db_mutex.lock();
    defer db_mutex.unlock();

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
pub fn getAlloc(allocator: std.mem.Allocator, namespace: []const u8, key: []const u8) !?[]u8 {
    if (try getRememberedAlloc(allocator, namespace, key)) |v| return v;

    db_mutex.lock();
    defer db_mutex.unlock();

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
pub fn has(namespace: []const u8, key: []const u8) !bool {
    {
        write_mutex.lock();
        defer write_mutex.unlock();
        var remaining = write_cache_len;
        while (remaining > 0) {
            remaining -= 1;
            const job = &write_cache[remaining];
            if (std.mem.eql(u8, job.namespaceSlice(), namespace) and
                std.mem.eql(u8, job.keySlice(), key)) return true;
        }
    }

    db_mutex.lock();
    defer db_mutex.unlock();

    var d = db orelse return error.NotInitialized;
    var stmt = try d.prepare("SELECT 1 FROM store WHERE namespace = ? AND key = ?");
    defer stmt.deinit();

    try stmt.bindText(1, namespace);
    try stmt.bindText(2, key);
    return try stmt.step();
}

/// Get a stored integer value. Returns null if not found.
pub fn getInt(namespace: []const u8, key: []const u8) !?i64 {
    var buf: [64]u8 = undefined;
    const len = (try get(namespace, key, &buf)) orelse return null;
    return std.fmt.parseInt(i64, buf[0..len], 10) catch null;
}

/// Get a stored float value. Returns null if not found.
pub fn getFloat(namespace: []const u8, key: []const u8) !?f64 {
    var buf: [64]u8 = undefined;
    const len = (try get(namespace, key, &buf)) orelse return null;
    return std.fmt.parseFloat(f64, buf[0..len]) catch null;
}

/// Get a stored boolean value. Returns null if not found.
pub fn getBool(namespace: []const u8, key: []const u8) !?bool {
    var buf: [8]u8 = undefined;
    const len = (try get(namespace, key, &buf)) orelse return null;
    const s = buf[0..len];
    if (std.mem.eql(u8, s, "true") or std.mem.eql(u8, s, "1")) return true;
    if (std.mem.eql(u8, s, "false") or std.mem.eql(u8, s, "0")) return false;
    return null;
}

// -- Set --

/// Set a text value for namespace + key. Creates or replaces.
pub fn set(namespace: []const u8, key: []const u8, value: []const u8) !void {
    if (db == null) return error.NotInitialized;
    try enqueueSet(namespace, key, value);
}

/// Set an integer value.
pub fn setInt(namespace: []const u8, key: []const u8, value: i64) !void {
    var buf: [64]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "{d}", .{value}) catch return error.BufferTooSmall;
    return set(namespace, key, s);
}

/// Set a float value.
pub fn setFloat(namespace: []const u8, key: []const u8, value: f64) !void {
    var buf: [64]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "{d}", .{value}) catch return error.BufferTooSmall;
    return set(namespace, key, s);
}

/// Set a boolean value.
pub fn setBool(namespace: []const u8, key: []const u8, value: bool) !void {
    return set(namespace, key, if (value) "true" else "false");
}

// -- Delete --

/// Delete a single key from a namespace.
pub fn delete(namespace: []const u8, key: []const u8) !void {
    // the cache/queue first, so a read can't resurrect the dead value
    purgeRemembered(namespace, key);

    db_mutex.lock();
    defer db_mutex.unlock();

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
pub fn keys(namespace: []const u8, out: []KeyEntry) !usize {
    var count: usize = 0;
    {
        db_mutex.lock();
        defer db_mutex.unlock();

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
        write_mutex.lock();
        defer write_mutex.unlock();
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
pub fn clear(namespace: ?[]const u8) !void {
    // the cache/queue first, so reads can't resurrect cleared values
    purgeRemembered(namespace, null);

    db_mutex.lock();
    defer db_mutex.unlock();

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

test "init requires fs" {
    // fs not initialized, so init should fail
    const result = init();
    try std.testing.expectError(error.NotInitialized, result);
}

test "round-trip text value" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    try set("app", "theme", "dark");

    var buf: [256]u8 = undefined;
    const len = (try get("app", "theme", &buf)).?;
    try std.testing.expectEqualStrings("dark", buf[0..len]);
}

test "round-trip typed values" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    // Integer
    try setInt("app", "count", 42);
    try std.testing.expectEqual(@as(?i64, 42), try getInt("app", "count"));

    // Float
    try setFloat("app", "ratio", 3.14);
    const f = (try getFloat("app", "ratio")).?;
    try std.testing.expect(std.math.approxEqAbs(f64, 3.14, f, 0.01));

    // Bool
    try setBool("app", "enabled", true);
    try std.testing.expectEqual(@as(?bool, true), try getBool("app", "enabled"));
}

test "get missing key returns null" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    var buf: [256]u8 = undefined;
    const result = try get("app", "nonexistent", &buf);
    try std.testing.expect(result == null);
}

test "delete key" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    try set("app", "temp", "value");
    try delete("app", "temp");

    var buf: [256]u8 = undefined;
    try std.testing.expect((try get("app", "temp", &buf)) == null);
}

test "keys listing" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    // Clear first
    try clear("test-keys");

    try set("test-keys", "alpha", "1");
    try set("test-keys", "beta", "2");
    try set("test-keys", "gamma", "3");

    var entries: [16]KeyEntry = undefined;
    const count = try keys("test-keys", &entries);
    try std.testing.expectEqual(@as(usize, 3), count);
    try std.testing.expectEqualStrings("alpha", entries[0].key());
    try std.testing.expectEqualStrings("beta", entries[1].key());
    try std.testing.expectEqualStrings("gamma", entries[2].key());
}

test "clear namespace" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    try set("clearme", "a", "1");
    try set("clearme", "b", "2");
    try set("keep", "c", "3");

    try clear("clearme");

    // clearme keys gone
    var buf: [256]u8 = undefined;
    try std.testing.expect((try get("clearme", "a", &buf)) == null);
    try std.testing.expect((try get("clearme", "b", &buf)) == null);

    // keep keys remain
    const len = (try get("keep", "c", &buf)).?;
    try std.testing.expectEqualStrings("3", buf[0..len]);
}

test "overwrite value" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    try set("app", "version", "1.0");
    try set("app", "version", "2.0");

    var buf: [256]u8 = undefined;
    const len = (try get("app", "version", &buf)).?;
    try std.testing.expectEqualStrings("2.0", buf[0..len]);
}

test "large value survives set, restart, and getAlloc" {
    // The regression that ate painted building-face materials: a ~33KB
    // custom-textures JSON was rejected by the old 8KB MAX_VALUE and the
    // failure was swallowed — visible all session (in-process caches), gone
    // on restart. This pins set→persist→reopen→read for a >64KB value
    // (past the old write cap AND the old fixed read buffers).
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();

    const big = try std.testing.allocator.alloc(u8, 100 * 1024);
    defer std.testing.allocator.free(big);
    for (big, 0..) |*c, i| c.* = 'a' + @as(u8, @intCast(i % 26));

    try set("app", "big-value", big);

    // read-your-writes before the writer commits
    const cached = (try getAlloc(std.testing.allocator, "app", "big-value")).?;
    defer std.testing.allocator.free(cached);
    try std.testing.expectEqualStrings(big, cached);

    // "restart": deinit flushes the write queue and drops the in-memory cache
    deinit();
    try init();
    defer deinit();

    const reread = (try getAlloc(std.testing.allocator, "app", "big-value")).?;
    defer std.testing.allocator.free(reread);
    try std.testing.expectEqualStrings(big, reread);
    try std.testing.expect(try has("app", "big-value"));
}

test "oversized value is a loud error, not a silent drop" {
    try fs.init("tsz-localstore-test");
    defer fs.deinit();
    try init();
    defer deinit();

    const huge = try std.testing.allocator.alloc(u8, MAX_VALUE + 1);
    defer std.testing.allocator.free(huge);
    @memset(huge, 'x');
    try std.testing.expectError(error.BufferTooSmall, set("app", "too-big", huge));
}
