//! qjs_bindings.zig — host-function bindings for runtime/hooks/* (fs, localstore,
//! crypto, env, exit). One call-site (`registerAll`) wires everything into the
//! JS global object.
//!
//! Called once from qjs_runtime.initVM at the end of its per-function block.
//! Paths in fs* bindings go straight to std.fs.cwd() (no confinement); carts
//! are trusted user-level code. localstore is an anonymous single-namespace
//! ("app") view over framework/localstore.zig.
//!
//! Shape contract lives in runtime/hooks/*.ts — every binding name registered
//! here corresponds to a `__<name>` global that those JS wrappers call via
//! ffi.callHost / ffi.callHostJson.

const std = @import("std");
const log = @import("log.zig");
const qjs_c = @import("qjs_c.zig");
const qjs = qjs_c.qjs;
const HAS_QUICKJS = qjs_c.HAS_QUICKJS;

const localstore = @import("localstore.zig");
const crypto_mod = @import("crypto.zig");
const sqlite_mod = @import("sqlite.zig");
const net_http = @import("net/http.zig");
const page_fetch = @import("net/page_fetch.zig");
const hotstate = @import("hotstate.zig");
const exec_async = @import("exec_async.zig");

const QJS_UNDEFINED = if (HAS_QUICKJS) (qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = qjs.JS_TAG_UNDEFINED }) else qjs.JSValue{};
const QJS_NULL = if (HAS_QUICKJS) (qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = qjs.JS_TAG_NULL }) else qjs.JSValue{};

const b64e = std.base64.standard.Encoder;
const b64d = std.base64.standard.Decoder;

// Local store namespace used when the JS hook doesn't specify one.
const LS_NS: []const u8 = "app";

// libc setenv/exit (posix std.posix exposes getenv but not setenv)
extern fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
extern fn exit(code: c_int) noreturn;

// sqlite3 column names — sqlite.zig wraps the rest of the API, just not this one.
extern fn sqlite3_column_name(stmt: *anyopaque, N: c_int) ?[*:0]const u8;

const HTTP_MAX_HEADERS: usize = 16; // must match net/http.zig MAX_HEADERS (private there)

// ── Helpers ────────────────────────────────────────────────────────

fn jsNewStr(ctx: *qjs.JSContext, s: []const u8) qjs.JSValue {
    return qjs.JS_NewStringLen(ctx, s.ptr, @intCast(s.len));
}

fn jsNewBool(b: bool) qjs.JSValue {
    if (comptime !HAS_QUICKJS) return qjs.JSValue{};
    return qjs.JSValue{
        .u = .{ .int32 = if (b) 1 else 0 },
        .tag = qjs.JS_TAG_BOOL,
    };
}

fn jsNewInt(v: i64) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(v));
}

fn jsToInt(ctx: *qjs.JSContext, v: qjs.JSValue) i32 {
    var out: c_int = 0;
    _ = qjs.JS_ToInt32(ctx, &out, v);
    return @intCast(out);
}

fn argStr(ctx: *qjs.JSContext, argc: c_int, argv: [*c]qjs.JSValue, i: c_int) ?[*:0]const u8 {
    if (i >= argc) return null;
    const p = qjs.JS_ToCString(ctx, argv[@intCast(i)]);
    return p;
}

fn freeStr(ctx: *qjs.JSContext, p: [*:0]const u8) void {
    qjs.JS_FreeCString(ctx, p);
}

/// Escape a JSON string fragment into an appending ArrayList.
fn jsonEscape(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |ch| switch (ch) {
        '"' => try out.appendSlice(alloc, "\\\""),
        '\\' => try out.appendSlice(alloc, "\\\\"),
        '\n' => try out.appendSlice(alloc, "\\n"),
        '\r' => try out.appendSlice(alloc, "\\r"),
        '\t' => try out.appendSlice(alloc, "\\t"),
        0...8, 11, 12, 14...31 => try out.writer(alloc).print("\\u{x:0>4}", .{ch}),
        else => try out.append(alloc, ch),
    };
    try out.append(alloc, '"');
}

// ── fs ────────────────────────────────────────────────────────────

fn fsRead(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_NULL;
    const path_p = argStr(c2, argc, argv, 0) orelse return QJS_NULL;
    defer freeStr(c2, path_p);
    const path = std.mem.span(path_p);

    const alloc = std.heap.page_allocator;
    const data = std.fs.cwd().readFileAlloc(alloc, path, 16 * 1024 * 1024) catch return QJS_NULL;
    defer alloc.free(data);
    return jsNewStr(c2, data);
}

fn fsWrite(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewBool(false);
    const path_p = argStr(c2, argc, argv, 0) orelse return jsNewBool(false);
    defer freeStr(c2, path_p);
    const content_p = argStr(c2, argc, argv, 1) orelse return jsNewBool(false);
    defer freeStr(c2, content_p);
    const path = std.mem.span(path_p);
    const content = std.mem.span(content_p);

    // Ensure parent dir
    if (std.mem.lastIndexOfScalar(u8, path, '/')) |idx| {
        std.fs.cwd().makePath(path[0..idx]) catch {};
    }
    const file = std.fs.cwd().createFile(path, .{ .truncate = true }) catch return jsNewBool(false);
    defer file.close();
    file.writeAll(content) catch return jsNewBool(false);
    return jsNewBool(true);
}

fn fsExists(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewBool(false);
    const path_p = argStr(c2, argc, argv, 0) orelse return jsNewBool(false);
    defer freeStr(c2, path_p);
    const path = std.mem.span(path_p);
    _ = std.fs.cwd().statFile(path) catch return jsNewBool(false);
    return jsNewBool(true);
}

fn fsListJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "[]");
    const path_p = argStr(c2, argc, argv, 0) orelse return jsNewStr(c2, "[]");
    defer freeStr(c2, path_p);
    const path = std.mem.span(path_p);

    const alloc = std.heap.page_allocator;
    var out = std.ArrayList(u8){};
    defer out.deinit(alloc);
    out.append(alloc, '[') catch return jsNewStr(c2, "[]");

    var dir = std.fs.cwd().openDir(path, .{ .iterate = true }) catch {
        out.append(alloc, ']') catch {};
        return jsNewStr(c2, out.items);
    };
    defer dir.close();

    var first = true;
    var iter = dir.iterate();
    while (iter.next() catch null) |entry| {
        if (!first) out.append(alloc, ',') catch break;
        first = false;
        jsonEscape(&out, alloc, entry.name) catch break;
    }
    out.append(alloc, ']') catch return jsNewStr(c2, "[]");
    return jsNewStr(c2, out.items);
}

fn fsMkdir(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewBool(false);
    const path_p = argStr(c2, argc, argv, 0) orelse return jsNewBool(false);
    defer freeStr(c2, path_p);
    const path = std.mem.span(path_p);
    std.fs.cwd().makePath(path) catch return jsNewBool(false);
    return jsNewBool(true);
}

fn fsRemove(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewBool(false);
    const path_p = argStr(c2, argc, argv, 0) orelse return jsNewBool(false);
    defer freeStr(c2, path_p);
    const path = std.mem.span(path_p);

    const stat = std.fs.cwd().statFile(path) catch return jsNewBool(false);
    switch (stat.kind) {
        .directory => std.fs.cwd().deleteDir(path) catch return jsNewBool(false),
        else => std.fs.cwd().deleteFile(path) catch return jsNewBool(false),
    }
    return jsNewBool(true);
}

fn fsStatJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_NULL;
    const path_p = argStr(c2, argc, argv, 0) orelse return QJS_NULL;
    defer freeStr(c2, path_p);
    const path = std.mem.span(path_p);

    const st = std.fs.cwd().statFile(path) catch return QJS_NULL;
    const mtime_ms: i64 = @intCast(@divTrunc(st.mtime, std.time.ns_per_ms));
    const is_dir = st.kind == .directory;

    var buf: [256]u8 = undefined;
    const s = std.fmt.bufPrint(
        &buf,
        "{{\"size\":{d},\"mtimeMs\":{d},\"isDir\":{s}}}",
        .{ st.size, mtime_ms, if (is_dir) "true" else "false" },
    ) catch return QJS_NULL;
    return jsNewStr(c2, s);
}

// ── localstore ────────────────────────────────────────────────────

fn storeGet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_NULL;
    if (!localstore.isInitialized()) return QJS_NULL;
    const key_p = argStr(c2, argc, argv, 0) orelse return QJS_NULL;
    defer freeStr(c2, key_p);

    var buf: [localstore.MAX_VALUE]u8 = undefined;
    const n = localstore.get(LS_NS, std.mem.span(key_p), &buf) catch return QJS_NULL;
    if (n == null) return QJS_NULL;
    return jsNewStr(c2, buf[0..n.?]);
}

fn storeSet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (!localstore.isInitialized()) return QJS_UNDEFINED;
    const key_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, key_p);
    const val_p = argStr(c2, argc, argv, 1) orelse return QJS_UNDEFINED;
    defer freeStr(c2, val_p);
    localstore.set(LS_NS, std.mem.span(key_p), std.mem.span(val_p)) catch {};
    return QJS_UNDEFINED;
}

fn storeRemove(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (!localstore.isInitialized()) return QJS_UNDEFINED;
    const key_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, key_p);
    localstore.delete(LS_NS, std.mem.span(key_p)) catch {};
    return QJS_UNDEFINED;
}

fn storeClear(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (!localstore.isInitialized()) return QJS_UNDEFINED;
    localstore.clear(LS_NS) catch {};
    return QJS_UNDEFINED;
}

fn storeKeysJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "[]");
    if (!localstore.isInitialized()) return jsNewStr(c2, "[]");

    var entries: [localstore.MAX_KEYS]localstore.KeyEntry = undefined;
    const n = localstore.keys(LS_NS, &entries) catch return jsNewStr(c2, "[]");

    const alloc = std.heap.page_allocator;
    var out = std.ArrayList(u8){};
    defer out.deinit(alloc);
    out.append(alloc, '[') catch return jsNewStr(c2, "[]");
    var i: usize = 0;
    while (i < n) : (i += 1) {
        if (i > 0) out.append(alloc, ',') catch break;
        jsonEscape(&out, alloc, entries[i].key()) catch break;
    }
    out.append(alloc, ']') catch return jsNewStr(c2, "[]");
    return jsNewStr(c2, out.items);
}

// ── crypto ────────────────────────────────────────────────────────

fn b64Encode(alloc: std.mem.Allocator, bytes: []const u8) ![]u8 {
    const sz = b64e.calcSize(bytes.len);
    const out = try alloc.alloc(u8, sz);
    _ = b64e.encode(out, bytes);
    return out;
}

fn b64Decode(alloc: std.mem.Allocator, s: []const u8) ![]u8 {
    const sz = try b64d.calcSizeForSlice(s);
    const out = try alloc.alloc(u8, sz);
    try b64d.decode(out, s);
    return out;
}

fn cryptoRandomB64(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    if (argc < 1) return jsNewStr(c2, "");
    const n = @as(usize, @intCast(@max(0, jsToInt(c2, argv[0]))));
    if (n == 0 or n > 1 << 20) return jsNewStr(c2, "");

    const alloc = std.heap.page_allocator;
    const raw = alloc.alloc(u8, n) catch return jsNewStr(c2, "");
    defer alloc.free(raw);
    std.crypto.random.bytes(raw);
    const enc = b64Encode(alloc, raw) catch return jsNewStr(c2, "");
    defer alloc.free(enc);
    return jsNewStr(c2, enc);
}

fn cryptoHmacSha256B64(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    const key_p = argStr(c2, argc, argv, 0) orelse return jsNewStr(c2, "");
    defer freeStr(c2, key_p);
    const msg_p = argStr(c2, argc, argv, 1) orelse return jsNewStr(c2, "");
    defer freeStr(c2, msg_p);

    const alloc = std.heap.page_allocator;
    const key_bytes = b64Decode(alloc, std.mem.span(key_p)) catch return jsNewStr(c2, "");
    defer alloc.free(key_bytes);
    const msg_bytes = b64Decode(alloc, std.mem.span(msg_p)) catch return jsNewStr(c2, "");
    defer alloc.free(msg_bytes);

    const mac = crypto_mod.hmacSha256(key_bytes, msg_bytes);
    const enc = b64Encode(alloc, &mac) catch return jsNewStr(c2, "");
    defer alloc.free(enc);
    return jsNewStr(c2, enc);
}

fn cryptoHkdfSha256B64(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    if (argc < 4) return jsNewStr(c2, "");
    const ikm_p = argStr(c2, argc, argv, 0) orelse return jsNewStr(c2, "");
    defer freeStr(c2, ikm_p);
    const salt_p = argStr(c2, argc, argv, 1) orelse return jsNewStr(c2, "");
    defer freeStr(c2, salt_p);
    const info_p = argStr(c2, argc, argv, 2) orelse return jsNewStr(c2, "");
    defer freeStr(c2, info_p);
    const length = @as(usize, @intCast(@max(0, jsToInt(c2, argv[3]))));
    if (length == 0 or length > 8192) return jsNewStr(c2, "");

    const alloc = std.heap.page_allocator;
    const ikm_bytes = b64Decode(alloc, std.mem.span(ikm_p)) catch return jsNewStr(c2, "");
    defer alloc.free(ikm_bytes);
    const salt_bytes = b64Decode(alloc, std.mem.span(salt_p)) catch return jsNewStr(c2, "");
    defer alloc.free(salt_bytes);
    const info_bytes = b64Decode(alloc, std.mem.span(info_p)) catch return jsNewStr(c2, "");
    defer alloc.free(info_bytes);

    const prk = crypto_mod.hkdfExtract(salt_bytes, ikm_bytes);
    const okm = alloc.alloc(u8, length) catch return jsNewStr(c2, "");
    defer alloc.free(okm);
    crypto_mod.hkdfExpand(&prk, info_bytes, okm) catch return jsNewStr(c2, "");

    const enc = b64Encode(alloc, okm) catch return jsNewStr(c2, "");
    defer alloc.free(enc);
    return jsNewStr(c2, enc);
}

fn cryptoXchachaEncryptB64(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    const pt_p = argStr(c2, argc, argv, 0) orelse return jsNewStr(c2, "");
    defer freeStr(c2, pt_p);
    const key_p = argStr(c2, argc, argv, 1) orelse return jsNewStr(c2, "");
    defer freeStr(c2, key_p);
    const nonce_p = argStr(c2, argc, argv, 2) orelse return jsNewStr(c2, "");
    defer freeStr(c2, nonce_p);

    const alloc = std.heap.page_allocator;
    const pt = b64Decode(alloc, std.mem.span(pt_p)) catch return jsNewStr(c2, "");
    defer alloc.free(pt);
    const key = b64Decode(alloc, std.mem.span(key_p)) catch return jsNewStr(c2, "");
    defer alloc.free(key);
    const nonce = b64Decode(alloc, std.mem.span(nonce_p)) catch return jsNewStr(c2, "");
    defer alloc.free(nonce);

    const XCP = std.crypto.aead.chacha_poly.XChaCha20Poly1305;
    if (key.len != XCP.key_length or nonce.len != XCP.nonce_length) return jsNewStr(c2, "");

    const out = alloc.alloc(u8, pt.len + XCP.tag_length) catch return jsNewStr(c2, "");
    defer alloc.free(out);
    var tag: [XCP.tag_length]u8 = undefined;
    var key_arr: [XCP.key_length]u8 = undefined;
    var nonce_arr: [XCP.nonce_length]u8 = undefined;
    @memcpy(&key_arr, key);
    @memcpy(&nonce_arr, nonce);
    XCP.encrypt(out[0..pt.len], &tag, pt, "", nonce_arr, key_arr);
    @memcpy(out[pt.len..], &tag);

    const enc = b64Encode(alloc, out) catch return jsNewStr(c2, "");
    defer alloc.free(enc);
    return jsNewStr(c2, enc);
}

fn cryptoXchachaDecryptB64(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    const ct_p = argStr(c2, argc, argv, 0) orelse return jsNewStr(c2, "");
    defer freeStr(c2, ct_p);
    const key_p = argStr(c2, argc, argv, 1) orelse return jsNewStr(c2, "");
    defer freeStr(c2, key_p);
    const nonce_p = argStr(c2, argc, argv, 2) orelse return jsNewStr(c2, "");
    defer freeStr(c2, nonce_p);

    const alloc = std.heap.page_allocator;
    const ct_with_tag = b64Decode(alloc, std.mem.span(ct_p)) catch return jsNewStr(c2, "");
    defer alloc.free(ct_with_tag);
    const key = b64Decode(alloc, std.mem.span(key_p)) catch return jsNewStr(c2, "");
    defer alloc.free(key);
    const nonce = b64Decode(alloc, std.mem.span(nonce_p)) catch return jsNewStr(c2, "");
    defer alloc.free(nonce);

    const XCP = std.crypto.aead.chacha_poly.XChaCha20Poly1305;
    if (key.len != XCP.key_length or nonce.len != XCP.nonce_length or ct_with_tag.len < XCP.tag_length) return jsNewStr(c2, "");

    const ct_len = ct_with_tag.len - XCP.tag_length;
    const ct = ct_with_tag[0..ct_len];
    var tag: [XCP.tag_length]u8 = undefined;
    @memcpy(&tag, ct_with_tag[ct_len..]);

    const pt = alloc.alloc(u8, ct_len) catch return jsNewStr(c2, "");
    defer alloc.free(pt);
    var key_arr: [XCP.key_length]u8 = undefined;
    var nonce_arr: [XCP.nonce_length]u8 = undefined;
    @memcpy(&key_arr, key);
    @memcpy(&nonce_arr, nonce);
    XCP.decrypt(pt, ct, tag, "", nonce_arr, key_arr) catch return jsNewStr(c2, "");

    const enc = b64Encode(alloc, pt) catch return jsNewStr(c2, "");
    defer alloc.free(enc);
    return jsNewStr(c2, enc);
}

// ── sqlite ────────────────────────────────────────────────────────
//
// Handle registry: JS sees small ints, Zig stores heap-owned Database pointers.
// Param binding: JS serializes {sql, params} as JSON; Zig parses params array
// element-by-element and dispatches to bindInt/bindFloat/bindText/bindNull.
// query_json iterates rows, serializes to JSON array of objects keyed by
// column name.

var g_sql_dbs: ?std.AutoHashMap(u32, *sqlite_mod.Database) = null;
var g_sql_next_id: u32 = 1;

fn sqlDbs() *std.AutoHashMap(u32, *sqlite_mod.Database) {
    if (g_sql_dbs == null) {
        g_sql_dbs = std.AutoHashMap(u32, *sqlite_mod.Database).init(std.heap.page_allocator);
    }
    return &g_sql_dbs.?;
}

fn sqlOpen(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewInt(0);
    const path_p = argStr(c2, argc, argv, 0) orelse return jsNewInt(0);
    defer freeStr(c2, path_p);

    const alloc = std.heap.page_allocator;
    const db_ptr = alloc.create(sqlite_mod.Database) catch return jsNewInt(0);
    db_ptr.* = sqlite_mod.Database.open(std.mem.span(path_p)) catch {
        alloc.destroy(db_ptr);
        return jsNewInt(0);
    };
    const id = g_sql_next_id;
    g_sql_next_id += 1;
    sqlDbs().put(id, db_ptr) catch {
        db_ptr.close();
        alloc.destroy(db_ptr);
        return jsNewInt(0);
    };
    return jsNewInt(id);
}

fn sqlClose(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    const id: u32 = @intCast(@max(0, jsToInt(c2, argv[0])));
    if (sqlDbs().fetchRemove(id)) |kv| {
        kv.value.close();
        std.heap.page_allocator.destroy(kv.value);
    }
    return QJS_UNDEFINED;
}

/// Parse {sql, params} JSON. Caller owns the ParsedRequest struct and must
/// call .deinit() to release the parsed tree.
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
    return SqlRequest{ .parsed = parsed, .sql = sql_v.string, .params = params_slice };
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
    // prepare() wants sentinel-terminated sql
    const alloc = std.heap.page_allocator;
    const sql_z = try alloc.allocSentinel(u8, sql.len, 0);
    defer alloc.free(sql_z);
    @memcpy(sql_z, sql);
    var stmt = try db.prepare(sql_z.ptr);
    defer stmt.deinit();
    try bindParams(&stmt, params);
    _ = try stmt.step();
}

fn sqlExec(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewBool(false);
    if (argc < 2) return jsNewBool(false);
    const id: u32 = @intCast(@max(0, jsToInt(c2, argv[0])));
    const db_ptr = sqlDbs().get(id) orelse return jsNewBool(false);

    const json_p = argStr(c2, argc, argv, 1) orelse return jsNewBool(false);
    defer freeStr(c2, json_p);
    var req = parseSqlRequest(std.mem.span(json_p)) orelse return jsNewBool(false);
    defer req.deinit();

    execSqlStmt(db_ptr, req.sql, req.params) catch return jsNewBool(false);
    return jsNewBool(true);
}

fn sqlQueryJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "[]");
    if (argc < 2) return jsNewStr(c2, "[]");
    const id: u32 = @intCast(@max(0, jsToInt(c2, argv[0])));
    const db_ptr = sqlDbs().get(id) orelse return jsNewStr(c2, "[]");

    const json_p = argStr(c2, argc, argv, 1) orelse return jsNewStr(c2, "[]");
    defer freeStr(c2, json_p);
    var req = parseSqlRequest(std.mem.span(json_p)) orelse return jsNewStr(c2, "[]");
    defer req.deinit();

    const alloc = std.heap.page_allocator;
    const sql_z = alloc.allocSentinel(u8, req.sql.len, 0) catch return jsNewStr(c2, "[]");
    defer alloc.free(sql_z);
    @memcpy(sql_z, req.sql);
    var stmt = db_ptr.prepare(sql_z.ptr) catch return jsNewStr(c2, "[]");
    defer stmt.deinit();
    bindParams(&stmt, req.params) catch return jsNewStr(c2, "[]");

    const col_count = stmt.columnCount();
    if (col_count <= 0) return jsNewStr(c2, "[]");

    var col_names: [64][]const u8 = undefined;
    const nc: usize = @intCast(@min(col_count, 64));
    const raw_stmt: *anyopaque = @ptrCast(stmt.stmt);
    for (0..nc) |i| {
        const n = sqlite3_column_name(raw_stmt, @intCast(i));
        col_names[i] = if (n) |p| std.mem.span(p) else "";
    }

    var out = std.ArrayList(u8){};
    defer out.deinit(alloc);
    out.append(alloc, '[') catch return jsNewStr(c2, "[]");

    var first_row = true;
    while (stmt.step() catch false) {
        if (!first_row) out.append(alloc, ',') catch break;
        first_row = false;
        out.append(alloc, '{') catch break;
        for (0..nc) |i| {
            if (i > 0) out.append(alloc, ',') catch break;
            jsonEscape(&out, alloc, col_names[i]) catch break;
            out.append(alloc, ':') catch break;

            const t = stmt.columnType(@intCast(i));
            switch (t) {
                .null_val => out.appendSlice(alloc, "null") catch break,
                .integer => out.writer(alloc).print("{d}", .{stmt.columnInt(@intCast(i))}) catch break,
                .float => out.writer(alloc).print("{d}", .{stmt.columnFloat(@intCast(i))}) catch break,
                .text => {
                    const s = stmt.columnText(@intCast(i)) orelse "";
                    jsonEscape(&out, alloc, s) catch break;
                },
                .blob => out.appendSlice(alloc, "null") catch break,
            }
        }
        out.append(alloc, '}') catch break;
    }
    out.append(alloc, ']') catch return jsNewStr(c2, "[]");
    return jsNewStr(c2, out.items);
}

fn sqlLastRowId(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewInt(0);
    if (argc < 1) return jsNewInt(0);
    const id: u32 = @intCast(@max(0, jsToInt(c2, argv[0])));
    const db_ptr = sqlDbs().get(id) orelse return jsNewInt(0);
    return jsNewInt(db_ptr.lastInsertRowId());
}

fn sqlChanges(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewInt(0);
    if (argc < 1) return jsNewInt(0);
    const id: u32 = @intCast(@max(0, jsToInt(c2, argv[0])));
    const db_ptr = sqlDbs().get(id) orelse return jsNewInt(0);
    return jsNewInt(db_ptr.changes());
}

// ── http (sync) ───────────────────────────────────────────────────
//
// Sync path shells out to the `curl` CLI — simpler than driving libcurl from
// the main thread, and the framework already links curl for net/http.zig.
// For high-throughput or blocking-critical work, use the async variant.

const HttpReq = struct {
    method: []const u8,
    url: []const u8,
    headers: ?std.json.ObjectMap,
    body: ?[]const u8,
    timeout_sec: u32,
};

fn parseHttpReq(parsed: *std.json.Parsed(std.json.Value)) ?HttpReq {
    const root = parsed.value;
    if (root != .object) return null;
    const url_v = root.object.get("url") orelse return null;
    if (url_v != .string) return null;
    const method: []const u8 = if (root.object.get("method")) |mv|
        (if (mv == .string) mv.string else "GET")
    else
        "GET";
    const headers = if (root.object.get("headers")) |hv|
        (if (hv == .object) hv.object else null)
    else
        null;
    const body: ?[]const u8 = if (root.object.get("body")) |bv|
        (if (bv == .string) bv.string else null)
    else
        null;
    const timeout_ms: u32 = if (root.object.get("timeoutMs")) |tv|
        (switch (tv) {
            .integer => |i| @intCast(@max(0, i)),
            .float => |f| @intFromFloat(@max(0.0, f)),
            else => 30_000,
        })
    else
        30_000;
    const timeout_sec: u32 = @max(1, timeout_ms / 1000);
    return HttpReq{
        .method = method,
        .url = url_v.string,
        .headers = headers,
        .body = body,
        .timeout_sec = timeout_sec,
    };
}

fn httpSyncViaCurl(req: HttpReq) ![]u8 {
    const alloc = std.heap.page_allocator;

    var argv = std.ArrayList([]const u8){};
    defer argv.deinit(alloc);
    try argv.appendSlice(alloc, &.{ "curl", "-sSi", "-X", req.method });

    // Timeout
    var tbuf: [16]u8 = undefined;
    const tstr = try std.fmt.bufPrint(&tbuf, "{d}", .{req.timeout_sec});
    try argv.appendSlice(alloc, &.{ "--max-time", tstr });

    // Headers
    if (req.headers) |hdrs| {
        var it = hdrs.iterator();
        while (it.next()) |entry| {
            if (entry.value_ptr.* != .string) continue;
            const hdr_line = try std.fmt.allocPrint(alloc, "{s}: {s}", .{ entry.key_ptr.*, entry.value_ptr.string });
            try argv.appendSlice(alloc, &.{ "-H", hdr_line });
        }
    }

    // Body
    if (req.body) |b| try argv.appendSlice(alloc, &.{ "--data-binary", b });

    try argv.append(alloc, req.url);

    const result = try std.process.Child.run(.{
        .allocator = alloc,
        .argv = argv.items,
        .max_output_bytes = 8 * 1024 * 1024,
    });
    defer alloc.free(result.stderr);

    // curl -i gives headers+blank+body. Split on \r\n\r\n (or \n\n).
    const raw = result.stdout;
    const sep_crlf = std.mem.indexOf(u8, raw, "\r\n\r\n");
    const sep_lf = std.mem.indexOf(u8, raw, "\n\n");
    const header_end: usize = if (sep_crlf) |v| v else (if (sep_lf) |v| v else raw.len);
    const body_start: usize = if (sep_crlf != null) header_end + 4 else (if (sep_lf != null) header_end + 2 else raw.len);

    const header_block = raw[0..header_end];
    const body = raw[body_start..];

    // Parse status line
    var status: u16 = 0;
    if (std.mem.indexOfScalar(u8, header_block, '\n')) |nl| {
        const first_line = std.mem.trim(u8, header_block[0..nl], " \r\t");
        if (std.mem.indexOfScalar(u8, first_line, ' ')) |sp1| {
            const after = first_line[sp1 + 1 ..];
            const sp2 = std.mem.indexOfScalar(u8, after, ' ') orelse after.len;
            status = std.fmt.parseInt(u16, after[0..sp2], 10) catch 0;
        }
    }

    // Build JSON response: {status, headers:{}, body:""}
    var out = std.ArrayList(u8){};
    errdefer out.deinit(alloc);
    try out.writer(alloc).print("{{\"status\":{d},\"headers\":{{", .{status});
    var first_hdr = true;
    var it = std.mem.splitScalar(u8, header_block, '\n');
    _ = it.next(); // skip status line
    while (it.next()) |line| {
        const trimmed = std.mem.trim(u8, line, " \r\t");
        if (trimmed.len == 0) continue;
        const colon = std.mem.indexOfScalar(u8, trimmed, ':') orelse continue;
        const k = std.mem.trim(u8, trimmed[0..colon], " \t");
        const v = std.mem.trim(u8, trimmed[colon + 1 ..], " \t");
        if (!first_hdr) try out.append(alloc, ',');
        first_hdr = false;
        try jsonEscape(&out, alloc, k);
        try out.append(alloc, ':');
        try jsonEscape(&out, alloc, v);
    }
    try out.appendSlice(alloc, "},\"body\":");
    try jsonEscape(&out, alloc, body);
    try out.append(alloc, '}');

    // Free the raw stdout (we've copied what we need)
    alloc.free(result.stdout);
    // Free argv string members we allocated
    // Note: simple ones are string-literals; the header_line + tbuf we allocated
    // are awkward to track individually; leak a few hundred bytes per request
    // rather than track. Acceptable given sync is bounded-rate.

    return out.toOwnedSlice(alloc);
}

fn httpRequestSync(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    const json_p = argStr(c2, argc, argv, 0) orelse return jsNewStr(c2, "");
    defer freeStr(c2, json_p);

    const alloc = std.heap.page_allocator;
    var parsed = std.json.parseFromSlice(std.json.Value, alloc, std.mem.span(json_p), .{}) catch
        return jsNewStr(c2, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"bad request json\"}");
    defer parsed.deinit();

    const req = parseHttpReq(&parsed) orelse
        return jsNewStr(c2, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"bad request\"}");

    const resp_json = httpSyncViaCurl(req) catch |err| {
        var buf: [256]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "{{\"status\":0,\"headers\":{{}},\"body\":\"\",\"error\":\"{s}\"}}", .{@errorName(err)}) catch
            return jsNewStr(c2, "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":\"curl failed\"}");
        return jsNewStr(c2, s);
    };
    defer alloc.free(resp_json);
    return jsNewStr(c2, resp_json);
}

// ── http (async) ──────────────────────────────────────────────────
//
// Backed by framework/net/http.zig's worker pool. JS sends a string reqId
// and we hash it to the u32 the worker pool uses; pending_ids maps back at
// drain time. tickDrain() runs each frame from appTick and fires
// __ffiEmit('http:<reqId>', responseJson) for every completed response.

var g_http_init_done: bool = false;
var g_http_pending: ?std.AutoHashMap(u32, []u8) = null;
var g_page_fetch_init_done: bool = false;
var g_page_fetch_pending: ?std.AutoHashMap(u32, []u8) = null;

fn httpPending() *std.AutoHashMap(u32, []u8) {
    if (g_http_pending == null) {
        g_http_pending = std.AutoHashMap(u32, []u8).init(std.heap.page_allocator);
    }
    return &g_http_pending.?;
}

fn pagePending() *std.AutoHashMap(u32, []u8) {
    if (g_page_fetch_pending == null) {
        g_page_fetch_pending = std.AutoHashMap(u32, []u8).init(std.heap.page_allocator);
    }
    return &g_page_fetch_pending.?;
}

fn hashReqId(s: []const u8) u32 {
    var h = std.hash.Wyhash.init(0xE1_FE_1D);
    h.update(s);
    return @truncate(h.final());
}

fn httpEnsureInit() void {
    if (g_http_init_done) return;
    net_http.init();
    g_http_init_done = true;
}

fn pageFetchEnsureInit() void {
    if (g_page_fetch_init_done) return;
    page_fetch.init();
    g_page_fetch_init_done = true;
}

fn parseHttpReqToOpts(req: HttpReq, headers_buf: *[HTTP_MAX_HEADERS][2][]const u8) net_http.RequestOpts {
    var opts = net_http.RequestOpts{
        .url = req.url,
        .body = req.body,
    };
    opts.method = if (std.ascii.eqlIgnoreCase(req.method, "POST")) .POST //
        else if (std.ascii.eqlIgnoreCase(req.method, "PUT")) .PUT //
        else if (std.ascii.eqlIgnoreCase(req.method, "DELETE")) .DELETE //
        else if (std.ascii.eqlIgnoreCase(req.method, "PATCH")) .PATCH //
        else if (std.ascii.eqlIgnoreCase(req.method, "HEAD")) .HEAD //
        else .GET;

    if (req.headers) |hdrs| {
        var it = hdrs.iterator();
        var n: usize = 0;
        while (it.next()) |entry| {
            if (n >= HTTP_MAX_HEADERS) break;
            if (entry.value_ptr.* != .string) continue;
            headers_buf[n] = .{ entry.key_ptr.*, entry.value_ptr.string };
            n += 1;
        }
        opts.headers = headers_buf[0..n];
    }
    return opts;
}

fn httpRequestAsync(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 2) return QJS_UNDEFINED;
    const spec_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, spec_p);
    const rid_p = argStr(c2, argc, argv, 1) orelse return QJS_UNDEFINED;
    defer freeStr(c2, rid_p);

    httpEnsureInit();

    const alloc = std.heap.page_allocator;
    var parsed = std.json.parseFromSlice(std.json.Value, alloc, std.mem.span(spec_p), .{}) catch return QJS_UNDEFINED;
    defer parsed.deinit();
    const req = parseHttpReq(&parsed) orelse return QJS_UNDEFINED;

    const rid_str = std.mem.span(rid_p);
    const id = hashReqId(rid_str);
    const rid_copy = alloc.dupe(u8, rid_str) catch return QJS_UNDEFINED;
    httpPending().put(id, rid_copy) catch {
        alloc.free(rid_copy);
        return QJS_UNDEFINED;
    };

    var hdrs_buf: [HTTP_MAX_HEADERS][2][]const u8 = undefined;
    const opts = parseHttpReqToOpts(req, &hdrs_buf);
    _ = net_http.request(id, opts);
    return QJS_UNDEFINED;
}

const PageReq = struct {
    url: []const u8,
};

fn parsePageReq(parsed: *std.json.Parsed(std.json.Value)) ?PageReq {
    const root = parsed.value;
    if (root != .object) return null;
    const url_v = root.object.get("url") orelse return null;
    if (url_v != .string) return null;
    return .{ .url = url_v.string };
}

fn emitChannelPayload(channel: []const u8, payload: []const u8, alloc: std.mem.Allocator) void {
    const ch_z = alloc.allocSentinel(u8, channel.len, 0) catch return;
    defer alloc.free(ch_z);
    @memcpy(ch_z, channel);
    const pl_z = alloc.allocSentinel(u8, payload.len, 0) catch return;
    defer alloc.free(pl_z);
    @memcpy(pl_z, payload);
    callEmit(ch_z.ptr, pl_z.ptr);
}

fn browserPageAsync(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 2) return QJS_UNDEFINED;
    const spec_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, spec_p);
    const rid_p = argStr(c2, argc, argv, 1) orelse return QJS_UNDEFINED;
    defer freeStr(c2, rid_p);

    pageFetchEnsureInit();

    const alloc = std.heap.page_allocator;
    var parsed = std.json.parseFromSlice(std.json.Value, alloc, std.mem.span(spec_p), .{}) catch return QJS_UNDEFINED;
    defer parsed.deinit();
    const req = parsePageReq(&parsed) orelse return QJS_UNDEFINED;

    const rid_str = std.mem.span(rid_p);
    const id = hashReqId(rid_str);
    const rid_copy = alloc.dupe(u8, rid_str) catch return QJS_UNDEFINED;
    pagePending().put(id, rid_copy) catch {
        alloc.free(rid_copy);
        return QJS_UNDEFINED;
    };

    if (!page_fetch.request(id, req.url)) {
        const rid = pagePending().fetchRemove(id) orelse return QJS_UNDEFINED;
        defer alloc.free(rid.value);
        var ch_buf: [256]u8 = undefined;
        const ch = std.fmt.bufPrint(&ch_buf, "browser-page:{s}", .{rid.value}) catch return QJS_UNDEFINED;
        emitChannelPayload(ch, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"queue full\"}", alloc);
    }
    return QJS_UNDEFINED;
}

fn browserPageSync(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "");
    const spec_p = argStr(c2, argc, argv, 0) orelse
        return jsNewStr(c2, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"missing request\"}");
    defer freeStr(c2, spec_p);

    const alloc = std.heap.page_allocator;
    var parsed = std.json.parseFromSlice(std.json.Value, alloc, std.mem.span(spec_p), .{}) catch
        return jsNewStr(c2, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"bad request json\"}");
    defer parsed.deinit();

    const req = parsePageReq(&parsed) orelse
        return jsNewStr(c2, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"bad request\"}");

    const resp = page_fetch.fetchSync(req.url);
    const payload = buildPageRespJson(&resp, alloc) catch
        return jsNewStr(c2, "{\"status\":0,\"finalUrl\":\"\",\"contentType\":\"\",\"body\":\"\",\"error\":\"serialize failed\"}");
    defer alloc.free(payload);
    return jsNewStr(c2, payload);
}

/// Build the JSON string the JS `__ffiEmit('http:<rid>', payload)` delivers.
/// Note: net/http.zig only captures status + body (no headers) today — the
/// headers field is emitted empty. Good enough for most REST clients; a
/// future improvement is to teach executeRequest() to capture them.
fn buildHttpRespJson(resp: *const net_http.Response, alloc: std.mem.Allocator) ![]u8 {
    var out = std.ArrayList(u8){};
    errdefer out.deinit(alloc);
    try out.writer(alloc).print("{{\"status\":{d},\"headers\":{{}},\"body\":", .{resp.status});
    try jsonEscape(&out, alloc, resp.bodySlice());
    if (resp.response_type == .err) {
        try out.appendSlice(alloc, ",\"error\":");
        try jsonEscape(&out, alloc, resp.errorSlice());
    }
    try out.append(alloc, '}');
    return out.toOwnedSlice(alloc);
}

fn buildPageRespJson(resp: *const page_fetch.Response, alloc: std.mem.Allocator) ![]u8 {
    var out = std.ArrayList(u8){};
    errdefer out.deinit(alloc);
    try out.writer(alloc).print("{{\"status\":{d},\"finalUrl\":", .{resp.status});
    try jsonEscape(&out, alloc, resp.finalUrlSlice());
    try out.appendSlice(alloc, ",\"contentType\":");
    try jsonEscape(&out, alloc, resp.contentTypeSlice());
    try out.appendSlice(alloc, ",\"body\":");
    try jsonEscape(&out, alloc, resp.bodySlice());
    try out.writer(alloc).print(",\"truncated\":{s}", .{if (resp.truncated) "true" else "false"});
    if (resp.response_type == .err) {
        try out.appendSlice(alloc, ",\"error\":");
        try jsonEscape(&out, alloc, resp.errorSlice());
    }
    try out.append(alloc, '}');
    return out.toOwnedSlice(alloc);
}

// ── tick drain ────────────────────────────────────────────────────
//
// Called once per frame from qjs_app.appTick to flush responses/events that
// background workers produced since the last drain. Does nothing until the
// relevant subsystem has been init'd.

pub fn tickDrain() void {
    if (g_http_init_done) {
        var buf: [8]net_http.Response = undefined;
        const n = net_http.poll(&buf);
        const alloc = std.heap.page_allocator;
        for (buf[0..n]) |resp| {
            const rid = httpPending().fetchRemove(resp.id) orelse continue;
            defer alloc.free(rid.value);
            const payload = buildHttpRespJson(&resp, alloc) catch continue;
            defer alloc.free(payload);

            var ch_buf: [256]u8 = undefined;
            const ch = std.fmt.bufPrint(&ch_buf, "http:{s}", .{rid.value}) catch continue;
            emitChannelPayload(ch, payload, alloc);
        }
    }

    if (g_page_fetch_init_done) {
        var buf: [8]page_fetch.Response = undefined;
        const n = page_fetch.poll(&buf);
        const alloc = std.heap.page_allocator;
        for (buf[0..n]) |resp| {
            const rid = pagePending().fetchRemove(resp.id) orelse continue;
            defer alloc.free(rid.value);
            const payload = buildPageRespJson(&resp, alloc) catch continue;
            defer alloc.free(payload);

            var ch_buf: [256]u8 = undefined;
            const ch = std.fmt.bufPrint(&ch_buf, "browser-page:{s}", .{rid.value}) catch continue;
            emitChannelPayload(ch, payload, alloc);
        }
    }

    exec_async.drain(emitExecCompleted);
}

fn execAsync(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 2) return QJS_UNDEFINED;
    const cmd_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, cmd_p);
    const rid_p = argStr(c2, argc, argv, 1) orelse return QJS_UNDEFINED;
    defer freeStr(c2, rid_p);
    exec_async.spawn(std.mem.span(rid_p), std.mem.span(cmd_p));
    return QJS_UNDEFINED;
}

fn emitExecCompleted(rid: []const u8, stdout: []const u8, code: i32) void {
    const alloc = std.heap.page_allocator;
    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(alloc);
    const w = buf.writer(alloc);
    w.print("{{\"code\":{d},\"stdout\":\"", .{code}) catch return;
    for (stdout) |ch| {
        switch (ch) {
            '"' => w.writeAll("\\\"") catch return,
            '\\' => w.writeAll("\\\\") catch return,
            '\n' => w.writeAll("\\n") catch return,
            '\r' => w.writeAll("\\r") catch return,
            '\t' => w.writeAll("\\t") catch return,
            0...8, 11, 12, 14...31 => w.print("\\u{x:0>4}", .{ch}) catch return,
            else => w.writeByte(ch) catch return,
        }
    }
    w.writeAll("\"}") catch return;

    var ch_buf: [256]u8 = undefined;
    const channel = std.fmt.bufPrint(&ch_buf, "exec:{s}", .{rid}) catch return;
    emitChannelPayload(channel, buf.items, alloc);
}

// ── __ffiEmit bridge ──────────────────────────────────────────────
// Looks up globalThis.__ffiEmit and calls it with (channel, payload).

fn callEmit(channel: [*:0]const u8, payload: [*:0]const u8) void {
    if (comptime !HAS_QUICKJS) return;
    const ctx_opt = getQjsCtx();
    const ctx = ctx_opt orelse return;
    const global = qjs.JS_GetGlobalObject(ctx);
    defer qjs.JS_FreeValue(ctx, global);
    const func = qjs.JS_GetPropertyStr(ctx, global, "__ffiEmit");
    defer qjs.JS_FreeValue(ctx, func);
    if (qjs.JS_IsUndefined(func)) return;
    var args = [2]qjs.JSValue{
        qjs.JS_NewString(ctx, channel),
        qjs.JS_NewString(ctx, payload),
    };
    const r = qjs.JS_Call(ctx, func, global, 2, &args);
    qjs.JS_FreeValue(ctx, args[0]);
    qjs.JS_FreeValue(ctx, args[1]);
    qjs.JS_FreeValue(ctx, r);
}

/// qjs_runtime.zig owns g_qjs_ctx; it exposes it via this extern for us.
/// Implemented as a small accessor in qjs_runtime.zig.
extern fn qjs_runtime_get_ctx() ?*anyopaque;

fn getQjsCtx() ?*qjs.JSContext {
    const p = qjs_runtime_get_ctx() orelse return null;
    return @ptrCast(@alignCast(p));
}

// ── websocket ─────────────────────────────────────────────────────
//
// Pending: framework/net/websocket.zig needs to be updated for Zig 0.15's
// std.net.Stream.writer API (now requires a buffer argument). Once the net
// module compiles, wire handle registry + wsOpen/Send/Close bindings + a
// wsTickDrain() hooked into the tickDrain loop, emitting
// `ws:open|message|close|error:<id>` via __ffiEmit. Scope restriction: plain
// ws:// only — wss:// requires a TLS client in front of net/websocket.zig.

// ── hotstate (dev-mode state preservation) ────────────────────────
//
// Atoms survive QJS teardown because this memory lives in Zig, not JS.
// runtime/hooks/useHotState reads via __hot_get on first render, writes
// through on every setState, so cart state persists across hot reloads.

fn hotGet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_NULL;
    const key_p = argStr(c2, argc, argv, 0) orelse return QJS_NULL;
    defer freeStr(c2, key_p);
    const key = std.mem.span(key_p);
    const val = hotstate.get(key);
    log.print("[hot_get] key='{s}' hit={} count={}\n", .{ key, val != null, hotstate.count() });
    if (val) |v| return jsNewStr(c2, v);
    return QJS_NULL;
}

fn hotSet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const key_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, key_p);
    const val_p = argStr(c2, argc, argv, 1) orelse return QJS_UNDEFINED;
    defer freeStr(c2, val_p);
    const key = std.mem.span(key_p);
    const val = std.mem.span(val_p);
    log.print("[hot_set] key='{s}' val='{s}'\n", .{ key, val });
    hotstate.set(key, val);
    return QJS_UNDEFINED;
}

fn hotRemove(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const key_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, key_p);
    hotstate.remove(std.mem.span(key_p));
    return QJS_UNDEFINED;
}

fn hotClear(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    hotstate.clear();
    return QJS_UNDEFINED;
}

fn hotKeysJson(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return jsNewStr(@ptrCast(ctx), "[]");
    const alloc = std.heap.page_allocator;
    const json = hotstate.keysJson(alloc) catch return jsNewStr(c2, "[]");
    defer alloc.free(json);
    return jsNewStr(c2, json);
}

// ── env / exit ────────────────────────────────────────────────────

fn envGet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_NULL;
    const name_p = argStr(c2, argc, argv, 0) orelse return QJS_NULL;
    defer freeStr(c2, name_p);
    const val = std.posix.getenv(std.mem.span(name_p)) orelse return QJS_NULL;
    return jsNewStr(c2, val);
}

fn envSet(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const name_p = argStr(c2, argc, argv, 0) orelse return QJS_UNDEFINED;
    defer freeStr(c2, name_p);
    const val_p = argStr(c2, argc, argv, 1) orelse return QJS_UNDEFINED;
    defer freeStr(c2, val_p);
    _ = setenv(name_p, val_p, 1);
    return QJS_UNDEFINED;
}

fn hostExit(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const code: c_int = if (argc > 0 and ctx != null) @intCast(jsToInt(ctx.?, argv[0])) else 0;
    exit(code);
}

// ── Registration ──────────────────────────────────────────────────

pub fn registerAll(ctx_opaque: *anyopaque) void {
    if (comptime !HAS_QUICKJS) return;
    const ctx: *qjs.JSContext = @ptrCast(@alignCast(ctx_opaque));
    const global = qjs.JS_GetGlobalObject(ctx);
    defer qjs.JS_FreeValue(ctx, global);

    // fs
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_read", qjs.JS_NewCFunction(ctx, fsRead, "__fs_read", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_write", qjs.JS_NewCFunction(ctx, fsWrite, "__fs_write", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_exists", qjs.JS_NewCFunction(ctx, fsExists, "__fs_exists", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_list_json", qjs.JS_NewCFunction(ctx, fsListJson, "__fs_list_json", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_mkdir", qjs.JS_NewCFunction(ctx, fsMkdir, "__fs_mkdir", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_remove", qjs.JS_NewCFunction(ctx, fsRemove, "__fs_remove", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__fs_stat_json", qjs.JS_NewCFunction(ctx, fsStatJson, "__fs_stat_json", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__exec_async", qjs.JS_NewCFunction(ctx, execAsync, "__exec_async", 2));

    // localstore
    _ = qjs.JS_SetPropertyStr(ctx, global, "__store_get", qjs.JS_NewCFunction(ctx, storeGet, "__store_get", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__store_set", qjs.JS_NewCFunction(ctx, storeSet, "__store_set", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__store_remove", qjs.JS_NewCFunction(ctx, storeRemove, "__store_remove", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__store_clear", qjs.JS_NewCFunction(ctx, storeClear, "__store_clear", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__store_keys_json", qjs.JS_NewCFunction(ctx, storeKeysJson, "__store_keys_json", 0));

    // crypto
    _ = qjs.JS_SetPropertyStr(ctx, global, "__crypto_random_b64", qjs.JS_NewCFunction(ctx, cryptoRandomB64, "__crypto_random_b64", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__crypto_hmac_sha256_b64", qjs.JS_NewCFunction(ctx, cryptoHmacSha256B64, "__crypto_hmac_sha256_b64", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__crypto_hkdf_sha256_b64", qjs.JS_NewCFunction(ctx, cryptoHkdfSha256B64, "__crypto_hkdf_sha256_b64", 4));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__crypto_xchacha_encrypt_b64", qjs.JS_NewCFunction(ctx, cryptoXchachaEncryptB64, "__crypto_xchacha_encrypt_b64", 3));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__crypto_xchacha_decrypt_b64", qjs.JS_NewCFunction(ctx, cryptoXchachaDecryptB64, "__crypto_xchacha_decrypt_b64", 3));

    // sqlite
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sql_open", qjs.JS_NewCFunction(ctx, sqlOpen, "__sql_open", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sql_close", qjs.JS_NewCFunction(ctx, sqlClose, "__sql_close", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sql_exec", qjs.JS_NewCFunction(ctx, sqlExec, "__sql_exec", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sql_query_json", qjs.JS_NewCFunction(ctx, sqlQueryJson, "__sql_query_json", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sql_last_rowid", qjs.JS_NewCFunction(ctx, sqlLastRowId, "__sql_last_rowid", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sql_changes", qjs.JS_NewCFunction(ctx, sqlChanges, "__sql_changes", 1));

    // http
    _ = qjs.JS_SetPropertyStr(ctx, global, "__http_request_sync", qjs.JS_NewCFunction(ctx, httpRequestSync, "__http_request_sync", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__http_request_async", qjs.JS_NewCFunction(ctx, httpRequestAsync, "__http_request_async", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__browser_page_sync", qjs.JS_NewCFunction(ctx, browserPageSync, "__browser_page_sync", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__browser_page_async", qjs.JS_NewCFunction(ctx, browserPageAsync, "__browser_page_async", 2));

    // hotstate (dev-mode state preservation)
    _ = qjs.JS_SetPropertyStr(ctx, global, "__hot_get", qjs.JS_NewCFunction(ctx, hotGet, "__hot_get", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__hot_set", qjs.JS_NewCFunction(ctx, hotSet, "__hot_set", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__hot_remove", qjs.JS_NewCFunction(ctx, hotRemove, "__hot_remove", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__hot_clear", qjs.JS_NewCFunction(ctx, hotClear, "__hot_clear", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__hot_keys_json", qjs.JS_NewCFunction(ctx, hotKeysJson, "__hot_keys_json", 0));

    // env / exit
    _ = qjs.JS_SetPropertyStr(ctx, global, "__env_get", qjs.JS_NewCFunction(ctx, envGet, "__env_get", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__env_set", qjs.JS_NewCFunction(ctx, envSet, "__env_set", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__exit", qjs.JS_NewCFunction(ctx, hostExit, "__exit", 1));
}
