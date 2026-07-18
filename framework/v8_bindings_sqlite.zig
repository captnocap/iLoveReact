//! v8_bindings_sqlite.zig — the `__sql_*` host-fn surface over
//! framework/storage/sqlite.zig (runtime-dlopen'd libsqlite3; no link-time
//! dependency, so registering this costs nothing when the library is absent —
//! every call degrades to its failure return).
//!
//! Extracted from v8_bindings_telemetry.zig (STOREDB-0606): sqlite consumers
//! used to drag the whole telemetry ingredient in via the documented
//! has-telemetry piggyback, and tools/v8cli had no `__sql_*` at all — which
//! blocked the V20 data-store migration's P4 suites. Now sqlite is its own
//! ingredient (grep prefix `__sql_`) and v8_cli.zig registers it beside fs.
//!
//! JS-side wrapper: runtime/hooks/sqlite.ts (open/close/exec/query/changes/
//! lastRowId — params ride as JSON, bound with typed sqlite3_bind_*).

const std = @import("std");
const v8 = @import("v8");
const v8rt = @import("v8_runtime.zig");
const sqlite_mod = @import("storage/sqlite.zig");

var g_sql_dbs: ?std.AutoHashMap(u32, *sqlite_mod.Database) = null;
var g_sql_next_id: u32 = 1;

// ── small V8 helpers (private copies — bindings modules don't share) ──

fn currentContext(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn retUndefined(info_c: ?*const v8.c.FunctionCallbackInfo) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(info.getIsolate().initUndefined().toValue());
}

fn setNumberReturn(info: v8.FunctionCallbackInfo, n: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initNumber(n).toValue());
}

fn setBoolReturn(info: v8.FunctionCallbackInfo, b: bool) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initBoolean(b));
}

fn setStringReturn(info: v8.FunctionCallbackInfo, s: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(iso.initStringUtf8(s).toValue());
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, default: i32) i32 {
    if (idx >= info.length()) return default;
    const ctx = currentContext(info);
    return info.getArg(idx).toI32(ctx) catch default;
}

fn argOwnedUtf8(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const n = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn appendFormatted(out: *std.ArrayList(u8), alloc: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !void {
    var buf: [256]u8 = undefined;
    try out.appendSlice(alloc, try std.fmt.bufPrint(&buf, fmt, args));
}

fn appendJsonEscaped(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |ch| switch (ch) {
        '"' => try out.appendSlice(alloc, "\\\""),
        '\\' => try out.appendSlice(alloc, "\\\\"),
        '\n' => try out.appendSlice(alloc, "\\n"),
        '\r' => try out.appendSlice(alloc, "\\r"),
        '\t' => try out.appendSlice(alloc, "\\t"),
        0...8, 11, 12, 14...31 => try appendFormatted(out, alloc, "\\u{x:0>4}", .{ch}),
        else => try out.append(alloc, ch),
    };
    try out.append(alloc, '"');
}

// ── the handle table + callbacks ─────────────────────────────────────

fn sqlDbs() *std.AutoHashMap(u32, *sqlite_mod.Database) {
    if (g_sql_dbs == null) {
        g_sql_dbs = std.AutoHashMap(u32, *sqlite_mod.Database).init(std.heap.page_allocator);
    }
    return &g_sql_dbs.?;
}

fn sqlOpenCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8rt.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const path = argOwnedUtf8(alloc, info, 0) orelse {
        setNumberReturn(info, 0);
        return;
    };
    defer alloc.free(path);
    const db_ptr = alloc.create(sqlite_mod.Database) catch {
        setNumberReturn(info, 0);
        return;
    };
    db_ptr.* = sqlite_mod.Database.open(io, path) catch {
        alloc.destroy(db_ptr);
        setNumberReturn(info, 0);
        return;
    };
    const id = g_sql_next_id;
    g_sql_next_id += 1;
    sqlDbs().put(id, db_ptr) catch {
        db_ptr.close();
        alloc.destroy(db_ptr);
        setNumberReturn(info, 0);
        return;
    };
    setNumberReturn(info, id);
}

fn sqlCloseCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        retUndefined(info_c);
        return;
    }
    const id: u32 = @intCast(@max(0, argI32(info, 0, 0)));
    if (sqlDbs().fetchRemove(id)) |kv| {
        kv.value.close();
        std.heap.page_allocator.destroy(kv.value);
    }
    retUndefined(info_c);
}

const SqlRequest = struct {
    parsed: std.json.Parsed(std.json.Value),
    sql: []const u8,
    params: []const std.json.Value,

    fn deinit(self: *SqlRequest) void {
        self.parsed.deinit();
    }
};

fn parseSqlRequest(json_str: []const u8) ?SqlRequest {
    var parsed = std.json.parseFromSlice(std.json.Value, std.heap.page_allocator, json_str, .{}) catch return null;
    const root = parsed.value;
    if (root != .object) {
        parsed.deinit();
        return null;
    }
    const sql_v = root.object.get("sql") orelse {
        parsed.deinit();
        return null;
    };
    if (sql_v != .string) {
        parsed.deinit();
        return null;
    }
    const params_slice: []const std.json.Value = blk: {
        if (root.object.get("params")) |p| {
            if (p == .array) break :blk p.array.items;
        }
        break :blk &[_]std.json.Value{};
    };
    return .{ .parsed = parsed, .sql = sql_v.string, .params = params_slice };
}

fn bindParams(stmt: *sqlite_mod.Statement, params: []const std.json.Value) sqlite_mod.SqliteError!void {
    for (params, 0..) |p, i| {
        const idx: c_int = @intCast(i + 1);
        switch (p) {
            .null => try stmt.bindNull(idx),
            .bool => |b| try stmt.bindInt(idx, if (b) 1 else 0),
            .integer => |v| try stmt.bindInt(idx, v),
            .float => |v| try stmt.bindFloat(idx, v),
            .number_string => |s| try stmt.bindText(idx, s),
            .string => |s| try stmt.bindText(idx, s),
            .array, .object => try stmt.bindNull(idx),
        }
    }
}

fn execSqlStmt(db: *sqlite_mod.Database, sql: []const u8, params: []const std.json.Value) !void {
    const alloc = std.heap.page_allocator;
    const sql_z = try alloc.allocSentinel(u8, sql.len, 0);
    defer alloc.free(sql_z);
    @memcpy(sql_z[0..sql.len], sql);
    var stmt = try db.prepare(sql_z.ptr);
    defer stmt.deinit();
    try bindParams(&stmt, params);
    _ = try stmt.step();
}

fn sqlExecCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    if (info.length() < 2) {
        setBoolReturn(info, false);
        return;
    }
    const id: u32 = @intCast(@max(0, argI32(info, 0, 0)));
    const db_ptr = sqlDbs().get(id) orelse {
        setBoolReturn(info, false);
        return;
    };
    const json = argOwnedUtf8(alloc, info, 1) orelse {
        setBoolReturn(info, false);
        return;
    };
    defer alloc.free(json);
    var req = parseSqlRequest(json) orelse {
        setBoolReturn(info, false);
        return;
    };
    defer req.deinit();
    execSqlStmt(db_ptr, req.sql, req.params) catch {
        setBoolReturn(info, false);
        return;
    };
    setBoolReturn(info, true);
}

fn sqlQueryJsonCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    if (info.length() < 2) {
        setStringReturn(info, "[]");
        return;
    }
    const id: u32 = @intCast(@max(0, argI32(info, 0, 0)));
    const db_ptr = sqlDbs().get(id) orelse {
        setStringReturn(info, "[]");
        return;
    };
    const json = argOwnedUtf8(alloc, info, 1) orelse {
        setStringReturn(info, "[]");
        return;
    };
    defer alloc.free(json);
    var req = parseSqlRequest(json) orelse {
        setStringReturn(info, "[]");
        return;
    };
    defer req.deinit();

    const sql_z = alloc.allocSentinel(u8, req.sql.len, 0) catch {
        setStringReturn(info, "[]");
        return;
    };
    defer alloc.free(sql_z);
    @memcpy(sql_z[0..req.sql.len], req.sql);
    var stmt = db_ptr.prepare(sql_z.ptr) catch {
        setStringReturn(info, "[]");
        return;
    };
    defer stmt.deinit();
    bindParams(&stmt, req.params) catch {
        setStringReturn(info, "[]");
        return;
    };

    const col_count = stmt.columnCount();
    if (col_count <= 0) {
        setStringReturn(info, "[]");
        return;
    }

    var col_names: [64][]const u8 = undefined;
    const nc: usize = @intCast(@min(col_count, 64));
    for (0..nc) |i| {
        col_names[i] = stmt.columnName(@intCast(i)) orelse "";
    }

    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    out.append(alloc, '[') catch {
        setStringReturn(info, "[]");
        return;
    };

    var first_row = true;
    while (stmt.step() catch false) {
        if (!first_row) out.append(alloc, ',') catch break;
        first_row = false;
        out.append(alloc, '{') catch break;
        for (0..nc) |i| {
            if (i > 0) out.append(alloc, ',') catch break;
            appendJsonEscaped(&out, alloc, col_names[i]) catch break;
            out.append(alloc, ':') catch break;
            const t = stmt.columnType(@intCast(i));
            switch (t) {
                .null_val => out.appendSlice(alloc, "null") catch break,
                .integer => appendFormatted(&out, alloc, "{d}", .{stmt.columnInt(@intCast(i))}) catch break,
                .float => appendFormatted(&out, alloc, "{d}", .{stmt.columnFloat(@intCast(i))}) catch break,
                .text => {
                    const s = stmt.columnText(@intCast(i)) orelse "";
                    appendJsonEscaped(&out, alloc, s) catch break;
                },
                .blob => out.appendSlice(alloc, "null") catch break,
            }
        }
        out.append(alloc, '}') catch break;
    }
    out.append(alloc, ']') catch {
        setStringReturn(info, "[]");
        return;
    };
    setStringReturn(info, out.items);
}

fn sqlLastRowIdCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setNumberReturn(info, 0);
        return;
    }
    const id: u32 = @intCast(@max(0, argI32(info, 0, 0)));
    const db_ptr = sqlDbs().get(id) orelse {
        setNumberReturn(info, 0);
        return;
    };
    setNumberReturn(info, @floatFromInt(db_ptr.lastInsertRowId()));
}

fn sqlChangesCb(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setNumberReturn(info, 0);
        return;
    }
    const id: u32 = @intCast(@max(0, argI32(info, 0, 0)));
    const db_ptr = sqlDbs().get(id) orelse {
        setNumberReturn(info, 0);
        return;
    };
    setNumberReturn(info, db_ptr.changes());
}

pub fn registerSqlite(_: anytype) void {
    v8rt.registerHostFn("__sql_open", sqlOpenCb);
    v8rt.registerHostFn("__sql_close", sqlCloseCb);
    v8rt.registerHostFn("__sql_exec", sqlExecCb);
    v8rt.registerHostFn("__sql_query_json", sqlQueryJsonCb);
    v8rt.registerHostFn("__sql_changes", sqlChangesCb);
    v8rt.registerHostFn("__sql_last_rowid", sqlLastRowIdCb);
}
