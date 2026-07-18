//! SQLite3 wrapper via runtime dlopen of libsqlite3.
//!
//! Modeled on framework/videos.zig: no link-time dependency, no _real/_stub
//! split. The library is loaded at first call to `Database.open`. If
//! libsqlite3 isn't installed, every entry point returns `error.Unavailable`.
//!
//! Public API: SqliteError, ColumnType, Statement, Database.

const std = @import("std");

extern fn dlopen(filename: ?[*:0]const u8, flags: c_int) ?*anyopaque;
extern fn dlsym(handle: *anyopaque, symbol: [*:0]const u8) ?*anyopaque;

const RTLD_LAZY: c_int = 0x00001;

pub const SqliteError = error{
    Unavailable,
    CantOpen,
    Busy,
    Locked,
    Corrupt,
    Constraint,
    Mismatch,
    NoMem,
    Prepare,
    Step,
    Bind,
    Generic,
};

pub const ColumnType = enum { integer, float, text, blob, null_val };

// Result codes (sqlite3.h, stable ABI)
const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const SQLITE_BUSY: c_int = 5;
const SQLITE_LOCKED: c_int = 6;
const SQLITE_NOMEM: c_int = 7;
const SQLITE_CORRUPT: c_int = 11;
const SQLITE_CANTOPEN: c_int = 14;
const SQLITE_CONSTRAINT: c_int = 19;
const SQLITE_MISMATCH: c_int = 20;
const SQLITE_NOTADB: c_int = 26;

const SQLITE_INTEGER: c_int = 1;
const SQLITE_FLOAT: c_int = 2;
const SQLITE_TEXT: c_int = 3;
const SQLITE_BLOB: c_int = 4;
const SQLITE_NULL: c_int = 5;

// SQLITE_TRANSIENT = ((sqlite3_destructor_type)-1) — tell sqlite to copy data.
// align(1): on aarch64 a plain fn pointer has alignment >1, so @ptrFromInt of
// the all-ones sentinel (never actually called — sqlite only compares it) trips
// Zig's "requires aligned address" check. align(1) drops that constraint.
const SQLITE_TRANSIENT: ?*align(1) const fn (?*anyopaque) callconv(.c) void =
    @ptrFromInt(std.math.maxInt(usize));

// Opaque handle types
const Sqlite3 = opaque {};
const Sqlite3Stmt = opaque {};

// Function-pointer signatures (subset of sqlite3.h actually used)
const FnOpen = *const fn (filename: [*:0]const u8, ppDb: *?*Sqlite3) callconv(.c) c_int;
const FnClose = *const fn (db: *Sqlite3) callconv(.c) c_int;
const FnBusyTimeout = *const fn (db: *Sqlite3, ms: c_int) callconv(.c) c_int;
const FnExec = *const fn (
    db: *Sqlite3,
    sql: [*:0]const u8,
    cb: ?*const anyopaque,
    arg: ?*anyopaque,
    errmsg: ?*[*c]u8,
) callconv(.c) c_int;
const FnFree = *const fn (ptr: ?*anyopaque) callconv(.c) void;
const FnPrepareV2 = *const fn (
    db: *Sqlite3,
    sql: [*:0]const u8,
    nByte: c_int,
    ppStmt: *?*Sqlite3Stmt,
    pzTail: ?*?[*:0]const u8,
) callconv(.c) c_int;
const FnFinalize = *const fn (stmt: *Sqlite3Stmt) callconv(.c) c_int;
const FnStep = *const fn (stmt: *Sqlite3Stmt) callconv(.c) c_int;
const FnReset = *const fn (stmt: *Sqlite3Stmt) callconv(.c) c_int;
const FnClearBindings = *const fn (stmt: *Sqlite3Stmt) callconv(.c) c_int;
const FnBindText = *const fn (
    stmt: *Sqlite3Stmt,
    idx: c_int,
    text: [*]const u8,
    n: c_int,
    destructor: ?*align(1) const fn (?*anyopaque) callconv(.c) void,
) callconv(.c) c_int;
const FnBindInt64 = *const fn (stmt: *Sqlite3Stmt, idx: c_int, val: i64) callconv(.c) c_int;
const FnBindDouble = *const fn (stmt: *Sqlite3Stmt, idx: c_int, val: f64) callconv(.c) c_int;
const FnBindNull = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) c_int;
const FnColText = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) ?[*]const u8;
const FnColBytes = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) c_int;
const FnColInt64 = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) i64;
const FnColDouble = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) f64;
const FnColType = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) c_int;
const FnColCount = *const fn (stmt: *Sqlite3Stmt) callconv(.c) c_int;
const FnColName = *const fn (stmt: *Sqlite3Stmt, idx: c_int) callconv(.c) ?[*:0]const u8;
const FnChanges = *const fn (db: *Sqlite3) callconv(.c) c_int;
const FnLastInsert = *const fn (db: *Sqlite3) callconv(.c) i64;
const FnErrMsg = *const fn (db: *Sqlite3) callconv(.c) [*:0]const u8;

const Lib = struct {
    open: FnOpen,
    close: FnClose,
    busy_timeout: FnBusyTimeout,
    exec: FnExec,
    free: FnFree,
    prepare_v2: FnPrepareV2,
    finalize: FnFinalize,
    step: FnStep,
    reset: FnReset,
    clear_bindings: FnClearBindings,
    bind_text: FnBindText,
    bind_int64: FnBindInt64,
    bind_double: FnBindDouble,
    bind_null: FnBindNull,
    col_text: FnColText,
    col_bytes: FnColBytes,
    col_int64: FnColInt64,
    col_double: FnColDouble,
    col_type: FnColType,
    col_count: FnColCount,
    col_name: FnColName,
    changes: FnChanges,
    last_insert: FnLastInsert,
    errmsg: FnErrMsg,
};

const SO_NAMES = [_][*:0]const u8{
    "libsqlite3.so.0",
    "libsqlite3.so",
    "libsqlite3.dylib",
    "libsqlite3.0.dylib",
};

var g_lib: ?Lib = null;
var g_tried: bool = false;

fn report(io: std.Io, comptime fmt: []const u8, args: anytype) void {
    var buf: [256]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, fmt, args) catch return;
    std.Io.File.stderr().writeStreamingAll(io, line) catch {};
}

fn loadLib(io: std.Io) ?*Lib {
    if (g_lib) |*l| return l;
    if (g_tried) return null;
    g_tried = true;

    var handle: ?*anyopaque = null;
    for (SO_NAMES) |name| {
        handle = dlopen(name, RTLD_LAZY);
        if (handle != null) break;
    }
    if (handle == null) {
        report(io, "[sqlite] libsqlite3 not found (tried {} names) — disabled\n", .{SO_NAMES.len});
        return null;
    }
    const h = handle.?;

    var lib: Lib = undefined;
    inline for (.{
        .{ "open", "sqlite3_open", FnOpen },
        .{ "close", "sqlite3_close", FnClose },
        .{ "busy_timeout", "sqlite3_busy_timeout", FnBusyTimeout },
        .{ "exec", "sqlite3_exec", FnExec },
        .{ "free", "sqlite3_free", FnFree },
        .{ "prepare_v2", "sqlite3_prepare_v2", FnPrepareV2 },
        .{ "finalize", "sqlite3_finalize", FnFinalize },
        .{ "step", "sqlite3_step", FnStep },
        .{ "reset", "sqlite3_reset", FnReset },
        .{ "clear_bindings", "sqlite3_clear_bindings", FnClearBindings },
        .{ "bind_text", "sqlite3_bind_text", FnBindText },
        .{ "bind_int64", "sqlite3_bind_int64", FnBindInt64 },
        .{ "bind_double", "sqlite3_bind_double", FnBindDouble },
        .{ "bind_null", "sqlite3_bind_null", FnBindNull },
        .{ "col_text", "sqlite3_column_text", FnColText },
        .{ "col_bytes", "sqlite3_column_bytes", FnColBytes },
        .{ "col_int64", "sqlite3_column_int64", FnColInt64 },
        .{ "col_double", "sqlite3_column_double", FnColDouble },
        .{ "col_type", "sqlite3_column_type", FnColType },
        .{ "col_count", "sqlite3_column_count", FnColCount },
        .{ "col_name", "sqlite3_column_name", FnColName },
        .{ "changes", "sqlite3_changes", FnChanges },
        .{ "last_insert", "sqlite3_last_insert_rowid", FnLastInsert },
        .{ "errmsg", "sqlite3_errmsg", FnErrMsg },
    }) |entry| {
        const raw = dlsym(h, entry[1]) orelse {
            report(io, "[sqlite] missing symbol {s} — disabled\n", .{entry[1]});
            return null;
        };
        @field(&lib, entry[0]) = @ptrCast(@alignCast(raw));
    }

    g_lib = lib;
    return &g_lib.?;
}

fn mapError(rc: c_int) SqliteError {
    return switch (rc) {
        SQLITE_BUSY => SqliteError.Busy,
        SQLITE_LOCKED => SqliteError.Locked,
        SQLITE_CORRUPT, SQLITE_NOTADB => SqliteError.Corrupt,
        SQLITE_CONSTRAINT => SqliteError.Constraint,
        SQLITE_MISMATCH => SqliteError.Mismatch,
        SQLITE_NOMEM => SqliteError.NoMem,
        SQLITE_CANTOPEN => SqliteError.CantOpen,
        else => SqliteError.Generic,
    };
}

fn mapColumnType(t: c_int) ColumnType {
    return switch (t) {
        SQLITE_INTEGER => .integer,
        SQLITE_FLOAT => .float,
        SQLITE_TEXT => .text,
        SQLITE_BLOB => .blob,
        else => .null_val,
    };
}

pub const Statement = struct {
    io: std.Io,
    stmt: *Sqlite3Stmt,

    pub fn deinit(self: *Statement) void {
        const lib = loadLib(self.io) orelse return;
        _ = lib.finalize(self.stmt);
    }

    pub fn bindText(self: *Statement, idx: c_int, text: []const u8) SqliteError!void {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        const rc = lib.bind_text(self.stmt, idx, text.ptr, @intCast(text.len), SQLITE_TRANSIENT);
        if (rc != SQLITE_OK) return SqliteError.Bind;
    }

    pub fn bindInt(self: *Statement, idx: c_int, val: i64) SqliteError!void {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        const rc = lib.bind_int64(self.stmt, idx, val);
        if (rc != SQLITE_OK) return SqliteError.Bind;
    }

    pub fn bindFloat(self: *Statement, idx: c_int, val: f64) SqliteError!void {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        const rc = lib.bind_double(self.stmt, idx, val);
        if (rc != SQLITE_OK) return SqliteError.Bind;
    }

    pub fn bindNull(self: *Statement, idx: c_int) SqliteError!void {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        const rc = lib.bind_null(self.stmt, idx);
        if (rc != SQLITE_OK) return SqliteError.Bind;
    }

    pub fn step(self: *Statement) SqliteError!bool {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        const rc = lib.step(self.stmt);
        if (rc == SQLITE_ROW) return true;
        if (rc == SQLITE_DONE) return false;
        return mapError(rc);
    }

    pub fn reset(self: *Statement) SqliteError!void {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        const rc = lib.reset(self.stmt);
        if (rc != SQLITE_OK) return mapError(rc);
        _ = lib.clear_bindings(self.stmt);
    }

    pub fn columnText(self: *const Statement, idx: c_int) ?[]const u8 {
        const lib = loadLib(self.io) orelse return null;
        const ptr = lib.col_text(self.stmt, idx) orelse return null;
        const len = lib.col_bytes(self.stmt, idx);
        if (len <= 0) return "";
        return ptr[0..@intCast(len)];
    }

    pub fn columnInt(self: *const Statement, idx: c_int) i64 {
        const lib = loadLib(self.io) orelse return 0;
        return lib.col_int64(self.stmt, idx);
    }

    pub fn columnFloat(self: *const Statement, idx: c_int) f64 {
        const lib = loadLib(self.io) orelse return 0;
        return lib.col_double(self.stmt, idx);
    }

    pub fn columnType(self: *const Statement, idx: c_int) ColumnType {
        const lib = loadLib(self.io) orelse return .null_val;
        return mapColumnType(lib.col_type(self.stmt, idx));
    }

    pub fn columnCount(self: *const Statement) c_int {
        const lib = loadLib(self.io) orelse return 0;
        return lib.col_count(self.stmt);
    }

    pub fn columnName(self: *const Statement, idx: c_int) ?[]const u8 {
        const lib = loadLib(self.io) orelse return null;
        const ptr = lib.col_name(self.stmt, idx) orelse return null;
        return std.mem.span(ptr);
    }
};

pub const Database = struct {
    io: std.Io,
    db: *Sqlite3,

    pub fn open(io: std.Io, path: []const u8) !Database {
        const lib = loadLib(io) orelse return SqliteError.Unavailable;

        var path_buf: [std.fs.max_path_bytes + 1]u8 = undefined;
        if (path.len >= path_buf.len) return error.NameTooLong;
        @memcpy(path_buf[0..path.len], path);
        path_buf[path.len] = 0;
        const path_z: [*:0]const u8 = @ptrCast(path_buf[0..path.len]);

        var db_ptr: ?*Sqlite3 = null;
        const rc = lib.open(path_z, &db_ptr);
        if (rc != SQLITE_OK) {
            if (db_ptr) |db| _ = lib.close(db);
            return SqliteError.CantOpen;
        }
        const db = db_ptr orelse return SqliteError.CantOpen;

        var self = Database{ .io = io, .db = db };
        // Host functions run on the UI thread — no busy waiting.
        _ = lib.busy_timeout(db, 0);
        self.exec("PRAGMA journal_mode=WAL") catch {};
        self.exec("PRAGMA foreign_keys=ON") catch {};
        return self;
    }

    pub fn openMemory(io: std.Io) !Database {
        return open(io, ":memory:");
    }

    pub fn close(self: *Database) void {
        const lib = loadLib(self.io) orelse return;
        _ = lib.close(self.db);
    }

    pub fn exec(self: *Database, sql_str: [*:0]const u8) SqliteError!void {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        var errmsg: [*c]u8 = null;
        const rc = lib.exec(self.db, sql_str, null, null, &errmsg);
        if (errmsg != null) lib.free(errmsg);
        if (rc != SQLITE_OK) return mapError(rc);
    }

    pub fn prepare(self: *Database, sql_str: [*:0]const u8) SqliteError!Statement {
        const lib = loadLib(self.io) orelse return SqliteError.Unavailable;
        var stmt_ptr: ?*Sqlite3Stmt = null;
        const rc = lib.prepare_v2(self.db, sql_str, -1, &stmt_ptr, null);
        if (rc != SQLITE_OK) return SqliteError.Prepare;
        return Statement{ .io = self.io, .stmt = stmt_ptr orelse return SqliteError.Prepare };
    }

    pub fn changes(self: *const Database) i32 {
        const lib = loadLib(self.io) orelse return 0;
        return lib.changes(self.db);
    }

    pub fn lastInsertRowId(self: *const Database) i64 {
        const lib = loadLib(self.io) orelse return 0;
        return lib.last_insert(self.db);
    }

    pub fn errMsg(self: *const Database) [*:0]const u8 {
        const lib = loadLib(self.io) orelse return "sqlite unavailable (libsqlite3 not loaded)";
        return lib.errmsg(self.db);
    }

    pub fn transaction(self: *Database, comptime func: fn (*Database) SqliteError!void) SqliteError!void {
        try self.exec("BEGIN");
        func(self) catch |err| {
            self.exec("ROLLBACK") catch {};
            return err;
        };
        self.exec("COMMIT") catch |err| {
            self.exec("ROLLBACK") catch {};
            return err;
        };
    }
};

/// Returns true if libsqlite3 is loadable on this system.
pub fn available(io: std.Io) bool {
    return loadLib(io) != null;
}
