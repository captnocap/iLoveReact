//! framework/pg.zig — Postgres client for cart-side `usePostgres` / `pg.ts`.
//!
//! Owns one `pg.Pool` per connection URI (cached process-wide). The
//! `__pg_*` host bindings in v8_bindings_pg.zig are thin wrappers around
//! the helpers below — all SQL travels through here so we can centralise
//! sanitization and connection lifetime.
//!
//! Default connection (URI = "") talks to the framework's embedded
//! postgres at `~/.cache/reactjit-embed/embed-pg-sock/.s.PGSQL.5432`.
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
//!   7. PATH (last-resort, by std.process.Child name lookup)
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

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
var gpa_ready = false;

fn allocator() std.mem.Allocator {
    if (!gpa_ready) gpa_ready = true;
    return gpa.allocator();
}

const default_socket_subpath = ".cache/reactjit-embed/embed-pg-sock";
const default_data_subpath = ".cache/reactjit-embed/embed-pg";
const default_user = "embed";
const default_database = "embed_bench";

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

/// Returns the bundle root (parent of `bin/`) if a `<root>/bin/postgres`
/// exists in any candidate location. Caller owns the returned slice.
fn findBundleRoot(a: std.mem.Allocator) ?[]u8 {
    if (std.posix.getenv("RJIT_PG_BUNDLE")) |env_root| {
        const probe = std.fs.path.join(a, &.{ env_root, "bin", "postgres" }) catch return null;
        defer a.free(probe);
        if (std.fs.cwd().access(probe, .{})) {
            return a.dupe(u8, env_root) catch null;
        } else |_| {}
    }

    const exe_path = std.fs.selfExePathAlloc(a) catch return null;
    defer a.free(exe_path);
    const exe_dir = std.fs.path.dirname(exe_path) orelse return null;

    for (bundle_relative_subdirs) |sub| {
        const root = std.fs.path.join(a, &.{ exe_dir, sub }) catch continue;
        const probe = std.fs.path.join(a, &.{ root, "bin", "postgres" }) catch {
            a.free(root);
            continue;
        };
        defer a.free(probe);
        if (std.fs.cwd().access(probe, .{})) {
            return root;
        } else |_| {
            a.free(root);
        }
    }
    return null;
}

/// Locate `<name>` (e.g. "postgres", "initdb") in a bundle or known
/// system dir. Returns absolute path or null. Caller owns the slice.
fn findPgBin(a: std.mem.Allocator, name: []const u8) ?[]u8 {
    if (findBundleRoot(a)) |root| {
        defer a.free(root);
        const path = std.fs.path.join(a, &.{ root, "bin", name }) catch return null;
        if (std.fs.cwd().access(path, .{})) {
            return path;
        } else |_| {
            a.free(path);
        }
    }
    for (system_pg_bin_dirs) |dir| {
        const path = std.fs.path.join(a, &.{ dir, name }) catch continue;
        if (std.fs.cwd().access(path, .{})) {
            return path;
        } else |_| {
            a.free(path);
        }
    }
    return null;
}

/// Locate the postgres `share/` tree (templates, encodings, locale).
/// Bundled copy wins; otherwise scan system layouts. Caller owns slice.
fn findShareDir(a: std.mem.Allocator) ?[]u8 {
    if (findBundleRoot(a)) |root| {
        defer a.free(root);
        const path = std.fs.path.join(a, &.{ root, "share", "postgresql" }) catch return null;
        if (std.fs.cwd().access(path, .{})) {
            return path;
        } else |_| {
            a.free(path);
        }
    }
    for (system_pg_share_dirs) |dir| {
        if (std.fs.cwd().access(dir, .{})) {
            return a.dupe(u8, dir) catch null;
        } else |_| {}
    }
    return null;
}

/// True iff the data dir contains a PG_VERSION marker (initdb's stamp).
/// An empty existing dir is NOT counted as initialized.
fn dataDirInitialized(data_dir: []const u8) bool {
    var d = std.fs.cwd().openDir(data_dir, .{}) catch return false;
    defer d.close();
    d.access("PG_VERSION", .{}) catch return false;
    return true;
}

/// Run `initdb` to seed an empty data dir. Idempotent: skipped when
/// `dataDirInitialized` already returns true.
fn runInitdb(a: std.mem.Allocator, data_dir: []const u8) !void {
    if (dataDirInitialized(data_dir)) return;
    std.fs.cwd().makePath(data_dir) catch {};

    const initdb = findPgBin(a, "initdb") orelse return error.ConnectFailed;
    defer a.free(initdb);

    const argv = [_][]const u8{
        initdb, "-D",   data_dir,     "-U",        default_user, "-A", "trust",
        "-E",   "UTF8", "--locale=C", "--no-sync",
    };

    var child = std.process.Child.init(&argv, a);
    var env_map = std.process.getEnvMap(a) catch return error.ConnectFailed;
    defer env_map.deinit();
    if (findShareDir(a)) |share| {
        defer a.free(share);
        env_map.put("PGSHAREDIR", share) catch return error.ConnectFailed;
    }
    child.env_map = &env_map;
    child.stdout_behavior = .Ignore;
    child.stderr_behavior = .Inherit;
    const term = child.spawnAndWait() catch return error.ConnectFailed;
    switch (term) {
        .Exited => |c| if (c != 0) return error.ConnectFailed,
        else => return error.ConnectFailed,
    }
}

/// Wait for postgres to accept a connection on the unix socket. Returns
/// the live pool on success. Replaces the old `waitForSocket(file-only)`
/// path which would falsely return on a stale socket file from a prior
/// crashed instance.
fn waitForReady(a: std.mem.Allocator, sock_path: []const u8, max_seconds: u32) !*pg.Pool {
    var elapsed: u32 = 0;
    while (elapsed < max_seconds) : (elapsed += 1) {
        if (pg.Pool.init(a, .{
            .size = 16,
            .connect = .{ .host = sock_path },
            .auth = .{ .username = default_user, .database = default_database },
        })) |pool| {
            return pool;
        } else |_| {}
        std.Thread.sleep(1 * std.time.ns_per_s);
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

pub fn connect(uri: []const u8) usize {
    const a = allocator();

    // Reuse an existing pool if the same URI is already open.
    var i: usize = 1;
    while (i < max_handles) : (i += 1) {
        if (slots[i].pool != null and std.mem.eql(u8, slots[i].uri, uri)) return i;
    }

    const idx = allocSlot();
    if (idx == 0) return 0;

    const pool = if (uri.len == 0)
        connectDefault(a) catch return 0
    else
        connectUri(a, uri) catch return 0;

    const uri_owned = a.dupe(u8, uri) catch {
        pool.deinit();
        return 0;
    };

    slots[idx] = .{ .pool = pool, .uri = uri_owned, .last_changes = 0 };
    return idx;
}

fn connectDefault(a: std.mem.Allocator) !*pg.Pool {
    const home = std.posix.getenv("HOME") orelse "/root";
    const sock_path = try std.fmt.allocPrint(a, "{s}/{s}/.s.PGSQL.5432", .{ home, default_socket_subpath });
    defer a.free(sock_path);
    const data_dir = try std.fmt.allocPrint(a, "{s}/{s}", .{ home, default_data_subpath });
    defer a.free(data_dir);

    // Try the live socket first — covers both "we already opened it this
    // process" and "user has postgres running from elsewhere".
    if (pg.Pool.init(a, .{
        .size = 16,
        .connect = .{ .host = sock_path },
        .auth = .{ .username = default_user, .database = default_database },
    })) |pool| {
        return pool;
    } else |_| {}

    // Cluster not running — make sure it exists, then spawn it. initdb
    // is idempotent (skipped when PG_VERSION already exists), so this
    // path is safe to take whether the data dir is missing or just stale.
    runInitdb(a, data_dir) catch return error.ConnectFailed;
    spawnEmbeddedPostgres(a) catch return error.ConnectFailed;
    return waitForReady(a, sock_path, 30) catch error.ConnectFailed;
}

fn connectUri(a: std.mem.Allocator, uri: []const u8) !*pg.Pool {
    // pg.zig accepts a connection URI via `Pool.initUri`. The signature is
    // `(allocator, std.Uri, Opts)` so we parse here.
    const parsed = std.Uri.parse(uri) catch return error.ConnectFailed;
    return pg.Pool.initUri(a, parsed, .{ .size = 16, .timeout = 10_000 }) catch return error.ConnectFailed;
}

fn spawnEmbeddedPostgres(a: std.mem.Allocator) !void {
    const home = std.posix.getenv("HOME") orelse return error.ConnectFailed;
    const data_dir = try std.fmt.allocPrint(a, "{s}/{s}", .{ home, default_data_subpath });
    defer a.free(data_dir);
    const sock_dir = try std.fmt.allocPrint(a, "{s}/{s}", .{ home, default_socket_subpath });
    defer a.free(sock_dir);

    // Caller (connectDefault) ran initdb if needed, so the data dir
    // should exist and contain PG_VERSION. Defensive check — bail
    // cleanly if something deleted it between calls.
    std.fs.cwd().access(data_dir, .{}) catch return error.ConnectFailed;
    std.fs.cwd().makePath(sock_dir) catch {};

    // postgres handles its own socket cleanup at startup. The one thing
    // that DOES block startup is a `postmaster.pid` whose PID is alive
    // (postgres assumes another instance owns the dir). Only clear it
    // when the PID is dead — a stale leftover from a crashed previous
    // instance. NEVER touch the socket files: we'd strand a live
    // cluster (its socket gone, but PG itself still up and refusing
    // duplicates), which is exactly the bug this comment exists to
    // prevent recurring.
    const pid_file = std.fs.path.join(a, &.{ data_dir, "postmaster.pid" }) catch return error.OutOfMemory;
    defer a.free(pid_file);
    if (!postmasterPidIsLive(pid_file)) {
        std.fs.cwd().deleteFile(pid_file) catch {};
    }

    const postgres_bin = findPgBin(a, "postgres") orelse return error.ConnectFailed;
    defer a.free(postgres_bin);

    // max_connections defaults to 100. Each bucket DB opens a 16-conn
    // pool keyed on its URI; with 8 buckets + cluster = 9 unique URIs
    // the per-process budget is ~144, blowing past the default. Bump
    // to 300 so the embeddings bucket also has headroom for parallel
    // ingest workers (each holds connections during embed.upsert).
    // Memory cost ≈ 5–10 MB per idle backend; ~2 GB worst case is
    // acceptable for a desktop app and well within ulimit defaults.
    const argv = [_][]const u8{
        postgres_bin,
        "-D",        data_dir,
        "-k",        sock_dir,
        "-c",        "listen_addresses=",
        "-c",        "max_connections=300",
    };

    var child = std.process.Child.init(&argv, a);
    var env_map = std.process.getEnvMap(a) catch return error.ConnectFailed;
    defer env_map.deinit();
    if (findShareDir(a)) |share| {
        defer a.free(share);
        env_map.put("PGSHAREDIR", share) catch return error.ConnectFailed;
    }
    child.env_map = &env_map;
    child.stdout_behavior = .Ignore;
    child.stderr_behavior = .Ignore;
    child.stdin_behavior = .Ignore;
    try child.spawn();
    // Detach — postgres double-forks itself into its supervisor on
    // success, so the immediate child becomes a wait()-able shell.
}

/// Returns true if `postmaster.pid` exists AND its first line (the PID)
/// matches a running process. Used to avoid clobbering a live cluster
/// that another process (e.g. the user) is using.
fn postmasterPidIsLive(pid_file: []const u8) bool {
    const f = std.fs.cwd().openFile(pid_file, .{}) catch return false;
    defer f.close();
    var buf: [32]u8 = undefined;
    const n = f.read(&buf) catch return false;
    var line_end: usize = 0;
    while (line_end < n and buf[line_end] != '\n') : (line_end += 1) {}
    const pid_str = std.mem.trim(u8, buf[0..line_end], " \t\r");
    const pid = std.fmt.parseInt(i32, pid_str, 10) catch return false;
    // kill(pid, 0) probes for existence without delivering a signal.
    std.posix.kill(pid, 0) catch return false;
    return true;
}

pub fn close(handle: usize) void {
    if (handle == 0 or handle >= max_handles) return;
    if (slots[handle].pool) |p| p.deinit();
    if (slots[handle].uri.len > 0) allocator().free(slots[handle].uri);
    slots[handle] = .{ .pool = null, .uri = &.{}, .last_changes = 0 };
}

fn poolFor(handle: usize) ?*pg.Pool {
    if (handle == 0 or handle >= max_handles) return null;
    return slots[handle].pool;
}

/// DDL or write. Returns true on success, false on failure (caller can't
/// distinguish the failure mode; check stderr for the pg error). Updates
/// `last_changes` for `changes()`.
pub fn exec(handle: usize, sql: []const u8, _: []const u8) bool {
    const pool = poolFor(handle) orelse return false;
    const affected_opt = pool.exec(sql, .{}) catch return false;
    slots[handle].last_changes = if (affected_opt) |n| n else 0;
    return true;
}

pub fn changes(handle: usize) i64 {
    if (handle == 0 or handle >= max_handles) return 0;
    return slots[handle].last_changes;
}

/// Run a SELECT and return the result rows as a JSON string allocated with
/// `out_alloc`. Each row is a JSON object keyed by column name. Columns of
/// numeric / boolean type are emitted as JSON primitives; text and unknown
/// types are emitted as quoted strings (escaped). Caller owns the returned
/// slice.
pub fn queryJson(
    out_alloc: std.mem.Allocator,
    handle: usize,
    sql: []const u8,
    _: []const u8,
) ![]u8 {
    const pool = poolFor(handle) orelse return error.InvalidHandle;
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

fn emitColumnValue(buf: *std.array_list.Managed(u8), row: anytype, ci: usize) !void {
    // Try a few common pg.zig column types in order. Whatever first decodes
    // wins. If everything fails, emit null. pg.zig returns errors when the
    // requested type doesn't match — that's how we narrow the actual type.
    if (row.get(?i64, ci)) |maybe| {
        if (maybe) |v| {
            try buf.writer().print("{d}", .{v});
            return;
        }
        try buf.appendSlice("null");
        return;
    } else |_| {}
    if (row.get(?f64, ci)) |maybe| {
        if (maybe) |v| {
            try buf.writer().print("{d}", .{v});
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
        0x00...0x08, 0x0B, 0x0C, 0x0E...0x1F => try buf.writer().print("\\u{x:0>4}", .{c}),
        else => try buf.append(c),
    };
}

/// Public accessor used by framework/embed.zig — it shares the pool that
/// `__pg_connect("")` already opened so embedding upserts and ad-hoc
/// queries don't compete for connections.
pub fn defaultPool() ?*pg.Pool {
    const idx = connect("");
    if (idx == 0) return null;
    return slots[idx].pool;
}
