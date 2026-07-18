//! framework/pg.zig — Postgres client for cart-side `usePostgres` / `pg.ts`.
//!
//! Owns one `pg.Pool` per connection URI (cached process-wide). The
//! `__pg_*` host bindings in v8_bindings_pg.zig are thin wrappers around
//! the helpers below — all SQL travels through here so we can centralise
//! sanitization and connection lifetime.
//!
//! Default connection (URI = "") talks to the framework's embedded
//! postgres cluster at `~/.cache/reactjit-embed/embed-pg-sock/.s.PGSQL.5432`,
//! role `postgres`, database `postgres` (the system DB initdb always
//! creates). The framework does NOT pick an application database for you
//! — pass an explicit URI to target your own role/db.
//!
//! ── Self-contained startup ────────────────────────────────────────────
//! On first connect, if the data dir is missing we run `initdb` to seed
//! it; if `postgres` is not listening, we spawn it. Both binaries are
//! resolved by `findPgBin()` which checks (in order):
//!   1. RJIT_PG_BUNDLE env var
//!   2. `<exe-dir>/.pg-bundle/bin/`     (dev mode in source tree)
//!   3. `<exe-dir>/../.pg-bundle/bin/`  (zig-out/bin layout)
//!   4. `<exe-dir>/pg/bin/`              (ship-extracted layout)
//!   5. `/usr/lib/postgresql/{17,16,15,14}/bin/` (Debian/Ubuntu)
//!   6. `/opt/homebrew/opt/postgresql@{17,16}/bin/` (macOS Homebrew)
//!   7. PATH (last-resort, by `std.process.spawn` name lookup)
//!
//! The "share" tree (initdb templates) is found similarly via
//! `findShareDir()`. When a bundled copy is found, we set PGSHAREDIR so
//! initdb finds its own files; system installs already know where their
//! share tree lives.

const std = @import("std");
const pg = @import("pg");

pub const PgError = error{
    NotInitialized,
    ConnectFailed,
    InvalidHandle,
    OutOfMemory,
    QueryFailed,
};

const max_handles: usize = 32;

const Slot = struct {
    pool: ?*pg.Pool,
    uri: []u8,
    last_changes: i64,
};

var slots: [max_handles]Slot = blk: {
    var s: [max_handles]Slot = undefined;
    for (&s) |*it| it.* = .{ .pool = null, .uri = &.{}, .last_changes = 0 };
    break :blk s;
};

var gpa = std.heap.DebugAllocator(.{}){};
var gpa_ready = false;

fn allocator() std.mem.Allocator {
    if (!gpa_ready) gpa_ready = true;
    return gpa.allocator();
}

const default_socket_subpath = ".cache/reactjit-embed/embed-pg-sock";
const default_data_subpath = ".cache/reactjit-embed/embed-pg";
// Neutral cluster defaults. `postgres` is the role+db initdb always
// creates; using these means the framework never assumes an application
// database name. Authors target their own roles/DBs via explicit URIs.
const default_user = "postgres";
const default_database = "postgres";

// Known postgres install layouts to scan when locating the binaries.
// Bundled paths win over system paths so `scripts/ship`-extracted apps
// use their own copy. macOS Intel Homebrew (Cellar) isn't pinned because
// the version-stamp dir varies; users on that path get caught by PATH.
const bundle_relative_subdirs = [_][]const u8{
    ".pg-bundle", // dev: <repo>/.pg-bundle
    "../.pg-bundle", // dev: exe at zig-out/bin/, bundle at <repo>/.pg-bundle
    "../../.pg-bundle",
    "pg", // ship: <extract-dir>/pg/
};

const system_pg_bin_dirs = [_][]const u8{
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/15/bin",
    "/usr/lib/postgresql/14/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/postgresql@15/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin", // Linux distros that just dump it here
};

const system_pg_share_dirs = [_][]const u8{
    "/usr/share/postgresql/17",
    "/usr/share/postgresql/16",
    "/usr/share/postgresql/15",
    "/usr/share/postgresql/14",
    "/opt/homebrew/share/postgresql@17",
    "/opt/homebrew/share/postgresql@16",
    "/opt/homebrew/share/postgresql",
    "/usr/local/share/postgresql@17",
    "/usr/local/share/postgresql",
    "/usr/share/postgresql",
};

/// Cached bundle root — resolved once per process.
var g_bundle_root: ?[]u8 = null;
var g_bundle_tried: bool = false;

fn bundleRoot(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator) ?[]const u8 {
    if (g_bundle_root) |r| return r;
    if (g_bundle_tried) return null;
    g_bundle_tried = true;
    g_bundle_root = resolveBundleRoot(io, environ, a);
    return g_bundle_root;
}

fn resolveBundleRoot(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator) ?[]u8 {
    if (environ.get("RJIT_PG_BUNDLE")) |env_root| {
        const probe = std.fs.path.join(a, &.{ env_root, "bin", "postgres" }) catch return null;
        defer a.free(probe);
        if (std.Io.Dir.cwd().access(io, probe, .{})) {
            return a.dupe(u8, env_root) catch null;
        } else |_| {}
    }

    const exe_path = std.process.executablePathAlloc(io, a) catch return null;
    defer a.free(exe_path);
    const exe_dir = std.fs.path.dirname(exe_path) orelse return null;

    for (bundle_relative_subdirs) |sub| {
        const root = std.fs.path.join(a, &.{ exe_dir, sub }) catch continue;
        const probe = std.fs.path.join(a, &.{ root, "bin", "postgres" }) catch {
            a.free(root);
            continue;
        };
        defer a.free(probe);
        if (std.Io.Dir.cwd().access(io, probe, .{})) {
            return root;
        } else |_| {
            a.free(root);
        }
    }
    return null;
}

fn findInDirs(io: std.Io, a: std.mem.Allocator, dirs: []const []const u8, name: []const u8) ?[]u8 {
    for (dirs) |dir| {
        const path = std.fs.path.join(a, &.{ dir, name }) catch continue;
        if (std.Io.Dir.cwd().access(io, path, .{})) {
            return path;
        } else |_| {
            a.free(path);
        }
    }
    return null;
}

fn findPgBin(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator, name: []const u8) ?[]u8 {
    if (bundleRoot(io, environ, a)) |root| {
        const path = std.fs.path.join(a, &.{ root, "bin", name }) catch return null;
        if (std.Io.Dir.cwd().access(io, path, .{})) return path else |_| a.free(path);
    }
    return findInDirs(io, a, &system_pg_bin_dirs, name);
}

fn findShareDir(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator) ?[]u8 {
    if (bundleRoot(io, environ, a)) |root| {
        const path = std.fs.path.join(a, &.{ root, "share", "postgresql" }) catch return null;
        if (std.Io.Dir.cwd().access(io, path, .{})) return path else |_| a.free(path);
    }
    for (system_pg_share_dirs) |dir| {
        if (std.Io.Dir.cwd().access(io, dir, .{})) {
            return a.dupe(u8, dir) catch null;
        } else |_| {}
    }
    return null;
}

const EmbedPaths = struct {
    data_dir: []u8,
    sock_dir: []u8,
    sock_path: []u8,

    fn resolve(a: std.mem.Allocator, environ: *const std.process.Environ.Map) !EmbedPaths {
        const home = environ.get("HOME") orelse return error.ConnectFailed;
        return .{
            .data_dir = try std.fmt.allocPrint(a, "{s}/{s}", .{ home, default_data_subpath }),
            .sock_dir = try std.fmt.allocPrint(a, "{s}/{s}", .{ home, default_socket_subpath }),
            .sock_path = try std.fmt.allocPrint(a, "{s}/{s}/.s.PGSQL.5432", .{ home, default_socket_subpath }),
        };
    }

    fn deinit(self: EmbedPaths, a: std.mem.Allocator) void {
        a.free(self.data_dir);
        a.free(self.sock_dir);
        a.free(self.sock_path);
    }
};

fn pgChildEnv(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator) !std.process.Environ.Map {
    var env_map = std.process.Environ.Map.init(a);
    for (environ.keys(), environ.values()) |key, value| {
        env_map.put(key, value) catch {
            env_map.deinit();
            return error.ConnectFailed;
        };
    }
    if (findShareDir(io, environ, a)) |share| {
        defer a.free(share);
        env_map.put("PGSHAREDIR", share) catch {
            env_map.deinit();
            return error.ConnectFailed;
        };
    }
    return env_map;
}

fn slotFor(handle: usize) ?*Slot {
    if (handle == 0 or handle >= max_handles) return null;
    if (slots[handle].pool == null) return null;
    return &slots[handle];
}

fn dataDirInitialized(io: std.Io, data_dir: []const u8) bool {
    var d = std.Io.Dir.cwd().openDir(io, data_dir, .{}) catch return false;
    defer d.close(io);
    d.access(io, "PG_VERSION", .{}) catch return false;
    return true;
}

/// Run `initdb` to seed an empty data dir. Idempotent: skipped when
/// `dataDirInitialized` already returns true.
fn runInitdb(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator, data_dir: []const u8) !void {
    if (dataDirInitialized(io, data_dir)) return;
    std.Io.Dir.cwd().createDirPath(io, data_dir) catch {};

    const initdb = findPgBin(io, environ, a, "initdb") orelse return error.ConnectFailed;
    defer a.free(initdb);

    const argv = [_][]const u8{
        initdb, "-D",   data_dir,     "-U",        default_user, "-A", "trust",
        "-E",   "UTF8", "--locale=C", "--no-sync",
    };

    var env_map = try pgChildEnv(io, environ, a);
    defer env_map.deinit();
    var child = std.process.spawn(io, .{
        .argv = &argv,
        .environ_map = &env_map,
        .stdout = .ignore,
        .stderr = .inherit,
    }) catch return error.ConnectFailed;
    const term = child.wait(io) catch return error.ConnectFailed;
    switch (term) {
        .exited => |c| if (c != 0) return error.ConnectFailed,
        else => return error.ConnectFailed,
    }
}

/// Wait for postgres to accept a connection on the unix socket. Returns
/// the live pool on success. Replaces the old `waitForSocket(file-only)`
/// path which would falsely return on a stale socket file from a prior
/// crashed instance.
fn waitForReady(io: std.Io, a: std.mem.Allocator, sock_path: []const u8, max_seconds: u32) !*pg.Pool {
    var elapsed: u32 = 0;
    while (elapsed < max_seconds) : (elapsed += 1) {
        if (pg.Pool.init(io, a, .{
            .size = 16,
            .connect = .{ .host = sock_path },
            .auth = .{ .username = default_user, .database = default_database },
        })) |pool| {
            return pool;
        } else |_| {}
        std.Io.sleep(io, .fromNanoseconds(std.time.ns_per_s), .awake) catch |err| switch (err) {
            error.Canceled => return error.ConnectFailed,
        };
    }
    return error.ConnectFailed;
}

/// Find a free slot. Returns 0 if none available.
fn allocSlot() usize {
    var i: usize = 1; // 0 is the "invalid" sentinel returned to JS
    while (i < max_handles) : (i += 1) {
        if (slots[i].pool == null) return i;
    }
    return 0;
}

// Connections per bucket pool. The cart is single-threaded V8 issuing
// SYNCHRONOUS pg.query/exec — a query runs to completion before any other JS
// runs, so there is never more than ONE query in flight in a process. One
// connection per bucket is all that's ever used; the "pool" is just
// acquire/release bookkeeping around that single connection. (The library
// default of 16 was dead capacity; there is no concurrency for it to serve.)
//
// It also bounds clients against the shared embedded cluster:
// (live app processes) × (buckets touched) × 1. At the old 16, ONE app process
// touching ~8 buckets + the cluster default opened ~144 connections — enough to
// trip "too many clients already" by itself against a default-100 cluster (the
// max_connections=300 arg below only applies when THIS code SPAWNS postgres
// fresh; a running cluster keeps its original cap). NOTE: nothing to do with
// the number of Claude Code sessions.
const POOL_SIZE = 1;

pub fn connect(io: std.Io, environ: *const std.process.Environ.Map, uri: []const u8) usize {
    const a = allocator();

    // Reuse an existing pool if the same URI is already open.
    var i: usize = 1;
    while (i < max_handles) : (i += 1) {
        if (slots[i].pool != null and std.mem.eql(u8, slots[i].uri, uri)) return i;
    }

    const idx = allocSlot();
    if (idx == 0) return 0;

    const pool = if (uri.len == 0)
        connectDefault(io, environ, a) catch return 0
    else
        connectUri(io, a, uri) catch return 0;

    const uri_owned = a.dupe(u8, uri) catch {
        pool.deinit();
        return 0;
    };

    slots[idx] = .{ .pool = pool, .uri = uri_owned, .last_changes = 0 };
    return idx;
}

fn connectDefault(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator) !*pg.Pool {
    const paths = try EmbedPaths.resolve(a, environ);
    defer paths.deinit(a);

    if (pg.Pool.init(io, a, .{
        .size = POOL_SIZE,
        .connect = .{ .host = paths.sock_path },
        .auth = .{ .username = default_user, .database = default_database },
    })) |pool| {
        return pool;
    } else |_| {}

    runInitdb(io, environ, a, paths.data_dir) catch return error.ConnectFailed;
    spawnEmbeddedPostgres(io, environ, a, paths) catch return error.ConnectFailed;
    return waitForReady(io, a, paths.sock_path, 30) catch error.ConnectFailed;
}

fn connectUri(io: std.Io, a: std.mem.Allocator, uri: []const u8) !*pg.Pool {
    const parsed = std.Uri.parse(uri) catch return error.ConnectFailed;
    return pg.Pool.initUri(io, a, parsed, .{ .size = POOL_SIZE, .timeout = 10_000 }) catch return error.ConnectFailed;
}

fn spawnEmbeddedPostgres(io: std.Io, environ: *const std.process.Environ.Map, a: std.mem.Allocator, paths: EmbedPaths) !void {
    std.Io.Dir.cwd().access(io, paths.data_dir, .{}) catch return error.ConnectFailed;
    std.Io.Dir.cwd().createDirPath(io, paths.sock_dir) catch {};

    // Only clear a stale postmaster.pid whose PID is dead. NEVER touch
    // the socket files — we'd strand a live cluster.
    const pid_file = std.fs.path.join(a, &.{ paths.data_dir, "postmaster.pid" }) catch return error.OutOfMemory;
    defer a.free(pid_file);
    if (!postmasterPidIsLive(io, pid_file)) {
        std.Io.Dir.cwd().deleteFile(io, pid_file) catch {};
    }

    const postgres_bin = findPgBin(io, environ, a, "postgres") orelse return error.ConnectFailed;
    defer a.free(postgres_bin);

    const argv = [_][]const u8{
        postgres_bin,
        "-D",
        paths.data_dir,
        "-k",
        paths.sock_dir,
        "-c",
        "listen_addresses=",
        "-c",
        "max_connections=300",
    };

    var env_map = try pgChildEnv(io, environ, a);
    defer env_map.deinit();
    const child = try std.process.spawn(io, .{
        .argv = &argv,
        .environ_map = &env_map,
        .stdout = .ignore,
        .stderr = .ignore,
        .stdin = .ignore,
    });
    if (child.id == null) return error.ConnectFailed;
}

/// Returns true if `postmaster.pid` exists AND its first line (the PID)
/// matches a running process. Used to avoid clobbering a live cluster
/// that another process (e.g. the user) is using.
fn postmasterPidIsLive(io: std.Io, pid_file: []const u8) bool {
    const f = std.Io.Dir.cwd().openFile(io, pid_file, .{}) catch return false;
    defer f.close(io);
    var buf: [32]u8 = undefined;
    const n = f.readPositionalAll(io, &buf, 0) catch return false;
    var line_end: usize = 0;
    while (line_end < n and buf[line_end] != '\n') : (line_end += 1) {}
    const pid_str = std.mem.trim(u8, buf[0..line_end], " \t\r");
    const pid = std.fmt.parseInt(i32, pid_str, 10) catch return false;
    // kill(pid, 0) probes for existence without delivering a signal.
    std.posix.kill(pid, @enumFromInt(0)) catch return false;
    return true;
}

pub fn close(handle: usize) void {
    if (handle == 0 or handle >= max_handles) return;
    if (slots[handle].pool) |p| p.deinit();
    if (slots[handle].uri.len > 0) allocator().free(slots[handle].uri);
    slots[handle] = .{ .pool = null, .uri = &.{}, .last_changes = 0 };
}

pub fn exec(handle: usize, sql: []const u8, _: []const u8) bool {
    const slot = slotFor(handle) orelse return false;
    const affected_opt = slot.pool.?.exec(sql, .{}) catch return false;
    slot.last_changes = if (affected_opt) |n| n else 0;
    return true;
}

pub fn changes(handle: usize) i64 {
    const slot = slotFor(handle) orelse return 0;
    return slot.last_changes;
}

pub fn queryJson(
    out_alloc: std.mem.Allocator,
    handle: usize,
    sql: []const u8,
    _: []const u8,
) ![]u8 {
    const slot = slotFor(handle) orelse return error.InvalidHandle;
    const pool = slot.pool.?;
    var result = pool.queryOpts(sql, .{}, .{ .column_names = true }) catch return error.QueryFailed;
    defer result.deinit();

    var buf = std.array_list.Managed(u8).init(out_alloc);
    errdefer buf.deinit();
    try buf.append('[');

    var first_row = true;
    const col_names = result.column_names;
    while (try result.next()) |row| {
        if (!first_row) try buf.append(',');
        first_row = false;
        try buf.append('{');
        var ci: usize = 0;
        while (ci < col_names.len) : (ci += 1) {
            if (ci > 0) try buf.append(',');
            try buf.append('"');
            try jsonEscape(&buf, col_names[ci]);
            try buf.appendSlice("\":");
            try emitColumnValue(&buf, row, ci);
        }
        try buf.append('}');
    }
    try buf.append(']');
    return buf.toOwnedSlice();
}

fn managedPrint(buf: *std.array_list.Managed(u8), comptime format: []const u8, args: anytype) !void {
    const alloc = buf.allocator;
    var list = buf.moveToUnmanaged();
    var writer: std.Io.Writer.Allocating = .fromArrayList(alloc, &list);
    defer {
        var restored = writer.toArrayList();
        buf.* = restored.toManaged(alloc);
    }
    try writer.writer.print(format, args);
}

fn emitColumnValue(buf: *std.array_list.Managed(u8), row: anytype, ci: usize) !void {
    // Try a few common pg.zig column types in order. Whatever first decodes
    // wins. If everything fails, emit null. pg.zig returns errors when the
    // requested type doesn't match — that's how we narrow the actual type.
    if (row.get(?i64, ci)) |maybe| {
        if (maybe) |v| {
            try managedPrint(buf, "{d}", .{v});
            return;
        }
        try buf.appendSlice("null");
        return;
    } else |_| {}
    if (row.get(?f64, ci)) |maybe| {
        if (maybe) |v| {
            try managedPrint(buf, "{d}", .{v});
            return;
        }
        try buf.appendSlice("null");
        return;
    } else |_| {}
    if (row.get(?bool, ci)) |maybe| {
        if (maybe) |v| {
            try buf.appendSlice(if (v) "true" else "false");
            return;
        }
        try buf.appendSlice("null");
        return;
    } else |_| {}
    if (row.get(?[]const u8, ci)) |maybe| {
        if (maybe) |v| {
            try buf.append('"');
            try jsonEscape(buf, v);
            try buf.append('"');
            return;
        }
        try buf.appendSlice("null");
        return;
    } else |_| {}
    try buf.appendSlice("null");
}

fn jsonEscape(buf: *std.array_list.Managed(u8), s: []const u8) !void {
    for (s) |c| switch (c) {
        '"' => try buf.appendSlice("\\\""),
        '\\' => try buf.appendSlice("\\\\"),
        '\n' => try buf.appendSlice("\\n"),
        '\r' => try buf.appendSlice("\\r"),
        '\t' => try buf.appendSlice("\\t"),
        0x00...0x08, 0x0B, 0x0C, 0x0E...0x1F => try managedPrint(buf, "\\u{x:0>4}", .{c}),
        else => try buf.append(c),
    };
}

/// Public accessor used by framework/embed.zig — it shares the pool that
/// `__pg_connect("")` already opened so embedding upserts and ad-hoc
/// queries don't compete for connections.
pub fn defaultPool(io: std.Io, environ: *const std.process.Environ.Map) ?*pg.Pool {
    const idx = connect(io, environ, "");
    if (idx == 0) return null;
    return slots[idx].pool;
}
