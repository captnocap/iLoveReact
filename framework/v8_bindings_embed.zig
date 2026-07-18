//! V8 host bindings for runtime/hooks/embed.ts + useEmbed.
//!
//! Single-instance design: one `Embedder`, one `Reranker`, one `Store` per
//! cart process. The TS layer's "handle" arg is currently ignored — we
//! always operate on the global slot. Multi-handle support can come later
//! if a cart needs to mix two embedding models.
//!
//! Exposed (mirrors runtime/hooks/embed.ts):
//!   __embed_load_model(path)                       → 1 | 0
//!   __embed_free_model(_)                          → void
//!   __embed_n_dim(_)                               → integer
//!   __embed_text(_, text)                          → JSON [v…] | "null"
//!   __embed_batch(_, textsJson)                    → JSON [[v…],[v…]…]
//!   __embed_rerank(rerankerPath, query, candsJson) → JSON [s, s, …]
//!   __embed_store_open(slug, dim)                  → 1 | 0
//!   __embed_store_close(_)                         → void
//!   __embed_store_upsert(_, rowJson)               → bool
//!   __embed_store_search_json(_, qvecJson, n, srcType) → JSON SearchHit[]
//!
//! All JSON args are plain UTF-8 strings; the TS side uses JSON.stringify
//! before calling and JSON.parse after. Keeps the binding ABI tiny.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const embed = @import("assistant/embed.zig");

var g_reranker: ?embed.Reranker = null;
var g_reranker_path: []u8 = &.{};
var g_store: ?embed.Store = null;

// One model in VRAM, shared by both query and ingest paths.
// `g_query_ctx` is lazily created on the first __embed_text/__embed_batch
// call so just sitting on the cart costs only the ~600 MB model weights.
// Ingest workers spawn additional WorkerCtxs from the same SharedModel.
var g_shared: ?embed.SharedModel = null;
var g_shared_path: []u8 = &.{};
var g_query_ctx: ?embed.WorkerCtx = null;
var g_ingest: ?*embed.IngestSession = null;

var g_alloc_state = std.heap.DebugAllocator(.{}){};

fn allocator() std.mem.Allocator {
    return g_alloc_state.allocator();
}

// ── arg helpers ────────────────────────────────────────────────────────

fn argStringAlloc(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (info.length() <= idx) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const len = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, len) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, fallback: i32) i32 {
    if (info.length() <= idx) return fallback;
    const ctx = info.getIsolate().getCurrentContext();
    return @as(i32, @intCast(info.getArg(idx).toI32(ctx) catch return fallback));
}

fn setNumber(info: v8.FunctionCallbackInfo, n: i64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), @floatFromInt(n)));
}

fn setBool(info: v8.FunctionCallbackInfo, b: bool) void {
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), b));
}

fn setString(info: v8.FunctionCallbackInfo, s: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), s));
}

// ── JSON helpers ───────────────────────────────────────────────────────

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

fn writeFloatArrayJson(buf: *std.array_list.Managed(u8), v: []const f32) !void {
    try buf.append('[');
    for (v, 0..) |x, i| {
        if (i > 0) try buf.append(',');
        try managedPrint(buf, "{d}", .{x});
    }
    try buf.append(']');
}

fn writeJsonStringEscaped(buf: *std.array_list.Managed(u8), s: []const u8) !void {
    try buf.append('"');
    for (s) |ch| switch (ch) {
        '"' => try buf.appendSlice("\\\""),
        '\\' => try buf.appendSlice("\\\\"),
        '\n' => try buf.appendSlice("\\n"),
        '\r' => try buf.appendSlice("\\r"),
        '\t' => try buf.appendSlice("\\t"),
        0x00...0x08, 0x0B, 0x0C, 0x0E...0x1F => try managedPrint(buf, "\\u{x:0>4}", .{ch}),
        else => try buf.append(ch),
    };
    try buf.append('"');
}

/// Parse a JSON array of strings into a slice of owned strings.
fn parseStringArray(alloc: std.mem.Allocator, json: []const u8) ![][]const u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, alloc, json, .{});
    defer parsed.deinit();
    if (parsed.value != .array) return error.NotAnArray;
    const arr = parsed.value.array;
    var out = try alloc.alloc([]const u8, arr.items.len);
    for (arr.items, 0..) |item, i| {
        if (item != .string) {
            out[i] = try alloc.dupe(u8, "");
        } else {
            out[i] = try alloc.dupe(u8, item.string);
        }
    }
    return out;
}

fn freeStringArray(alloc: std.mem.Allocator, arr: [][]const u8) void {
    for (arr) |s| alloc.free(s);
    alloc.free(arr);
}

/// Parse a JSON array of numbers into a []f32.
fn parseFloatArray(alloc: std.mem.Allocator, json: []const u8) ![]f32 {
    var parsed = try std.json.parseFromSlice(std.json.Value, alloc, json, .{});
    defer parsed.deinit();
    if (parsed.value != .array) return error.NotAnArray;
    const arr = parsed.value.array;
    var out = try alloc.alloc(f32, arr.items.len);
    for (arr.items, 0..) |item, i| {
        out[i] = switch (item) {
            .float => |f| @floatCast(f),
            .integer => |n| @floatFromInt(n),
            else => 0.0,
        };
    }
    return out;
}

// ── Embedder host fns ──────────────────────────────────────────────────

/// Ensure g_query_ctx exists. Lazy-creates from g_shared on first use so
/// just having the cart open doesn't allocate ~900 MB of KV cache for a
/// query path the user may never exercise.
fn ensureQueryCtx(io: std.Io) bool {
    if (g_query_ctx != null) return true;
    if (g_shared == null) return false;
    g_query_ctx = g_shared.?.newWorker(io, 8192) catch return false;
    return true;
}

fn freeQueryCtx() void {
    if (g_query_ctx) |*c| {
        c.deinit();
        g_query_ctx = null;
    }
}

fn hostLoadModel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = allocator();
    const path = argStringAlloc(a, info, 0) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(path);
    // Drop the query ctx — it'll be lazy-recreated against the new model.
    freeQueryCtx();
    if (!ensureSharedModel(path)) {
        setNumber(info, 0);
        return;
    }
    setNumber(info, 1);
}

fn hostFreeModel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = info;
    freeQueryCtx();
    if (g_shared) |*sm| {
        sm.deinit();
        g_shared = null;
    }
    const a = allocator();
    if (g_shared_path.len > 0) a.free(g_shared_path);
    g_shared_path = &.{};
}

fn hostNDim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (g_shared) |sm| {
        setNumber(info, @intCast(sm.n_embd));
    } else {
        setNumber(info, 0);
    }
}

fn hostEmbedText(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const a = allocator();
    if (!ensureQueryCtx(host.io)) {
        setString(info, "null");
        return;
    }
    const text = argStringAlloc(a, info, 1) orelse {
        setString(info, "null");
        return;
    };
    defer a.free(text);

    const vec = g_query_ctx.?.embedText(a, text) catch {
        setString(info, "null");
        return;
    };
    defer a.free(vec);

    var buf = std.array_list.Managed(u8).init(a);
    defer buf.deinit();
    writeFloatArrayJson(&buf, vec) catch {
        setString(info, "null");
        return;
    };
    setString(info, buf.items);
}

fn hostEmbedBatch(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const a = allocator();
    if (!ensureQueryCtx(host.io)) {
        setString(info, "[]");
        return;
    }
    const json = argStringAlloc(a, info, 1) orelse {
        setString(info, "[]");
        return;
    };
    defer a.free(json);

    const texts = parseStringArray(a, json) catch {
        setString(info, "[]");
        return;
    };
    defer freeStringArray(a, texts);

    const vectors = g_query_ctx.?.embedBatch(a, texts) catch {
        setString(info, "[]");
        return;
    };
    defer {
        for (vectors) |v| a.free(v);
        a.free(vectors);
    }

    var buf = std.array_list.Managed(u8).init(a);
    defer buf.deinit();
    buf.append('[') catch {
        setString(info, "[]");
        return;
    };
    for (vectors, 0..) |v, i| {
        if (i > 0) buf.append(',') catch {
            setString(info, "[]");
            return;
        };
        writeFloatArrayJson(&buf, v) catch {
            setString(info, "[]");
            return;
        };
    }
    buf.append(']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, buf.items);
}

// ── Reranker host fn ───────────────────────────────────────────────────

fn ensureReranker(path: []const u8) bool {
    if (g_reranker != null and std.mem.eql(u8, g_reranker_path, path)) return true;
    const a = allocator();
    if (g_reranker) |*r| {
        r.deinit();
        g_reranker = null;
        if (g_reranker_path.len > 0) a.free(g_reranker_path);
        g_reranker_path = &.{};
    }
    g_reranker = embed.Reranker.init(path) catch return false;
    g_reranker_path = a.dupe(u8, path) catch {
        g_reranker.?.deinit();
        g_reranker = null;
        return false;
    };
    return true;
}

fn hostRerank(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = allocator();
    const path = argStringAlloc(a, info, 0) orelse {
        setString(info, "[]");
        return;
    };
    defer a.free(path);
    const query = argStringAlloc(a, info, 1) orelse {
        setString(info, "[]");
        return;
    };
    defer a.free(query);
    const cands_json = argStringAlloc(a, info, 2) orelse {
        setString(info, "[]");
        return;
    };
    defer a.free(cands_json);

    if (!ensureReranker(path)) {
        setString(info, "[]");
        return;
    }
    const cands = parseStringArray(a, cands_json) catch {
        setString(info, "[]");
        return;
    };
    defer freeStringArray(a, cands);

    var buf = std.array_list.Managed(u8).init(a);
    defer buf.deinit();
    buf.append('[') catch {
        setString(info, "[]");
        return;
    };
    for (cands, 0..) |doc, i| {
        if (i > 0) buf.append(',') catch {
            setString(info, "[]");
            return;
        };
        const s = g_reranker.?.score(a, query, doc) catch 0.0;
        managedPrint(&buf, "{d}", .{s}) catch {
            setString(info, "[]");
            return;
        };
    }
    buf.append(']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, buf.items);
}

// ── Store host fns ─────────────────────────────────────────────────────

fn hostStoreOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const a = allocator();
    const slug = argStringAlloc(a, info, 0) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(slug);
    const dim_i = argI32(info, 1, 0);
    if (dim_i <= 0) {
        setNumber(info, 0);
        return;
    }
    if (g_store) |*s| {
        s.close();
        g_store = null;
    }
    g_store = embed.Store.open(host.io, host.environ, a, slug, @intCast(dim_i)) catch {
        setNumber(info, 0);
        return;
    };
    // Eager partial-HNSW for the canonical kinds. Cheap if they exist.
    g_store.?.buildPartialHnsw("chat-log-chunk") catch {};
    g_store.?.buildPartialHnsw("code-chunk") catch {};
    g_store.?.buildPartialHnsw("document-chunk") catch {};
    setNumber(info, 1);
}

fn hostStoreClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = info;
    if (g_store) |*s| {
        s.close();
        g_store = null;
    }
}

const RowParse = struct {
    id: []const u8,
    source_type: []const u8,
    source_id: []const u8,
    chunk_index: i32,
    display_text: []const u8,
    text_preview: []const u8,
    metadata_json: []const u8,
    model: []const u8,
    text_sha: []const u8,
    vector: []f32,
};

fn parseChunkRow(a: std.mem.Allocator, json: []const u8, out_vec: *[]f32) !RowParse {
    var parsed = try std.json.parseFromSlice(std.json.Value, a, json, .{});
    // We hold parsed alive until we've duped strings.
    defer parsed.deinit();
    if (parsed.value != .object) return error.NotAnObject;
    const obj = parsed.value.object;

    const get_str = struct {
        fn s(o: std.json.ObjectMap, k: []const u8) []const u8 {
            const v = o.get(k) orelse return "";
            return switch (v) {
                .string => |str| str,
                else => "",
            };
        }
    }.s;

    const get_i32 = struct {
        fn n(o: std.json.ObjectMap, k: []const u8) i32 {
            const v = o.get(k) orelse return 0;
            return switch (v) {
                .integer => |i| @intCast(i),
                .float => |f| @intFromFloat(f),
                else => 0,
            };
        }
    }.n;

    // Strings (dup so they outlive `parsed`).
    const id = try a.dupe(u8, get_str(obj, "id"));
    errdefer a.free(id);
    const source_type = try a.dupe(u8, get_str(obj, "source_type"));
    errdefer a.free(source_type);
    const source_id = try a.dupe(u8, get_str(obj, "source_id"));
    errdefer a.free(source_id);
    const display_text = try a.dupe(u8, get_str(obj, "display_text"));
    errdefer a.free(display_text);
    const text_preview = try a.dupe(u8, get_str(obj, "text_preview"));
    errdefer a.free(text_preview);
    const metadata_json = try a.dupe(u8, get_str(obj, "metadata_json"));
    errdefer a.free(metadata_json);
    const model = try a.dupe(u8, get_str(obj, "model"));
    errdefer a.free(model);
    const text_sha = try a.dupe(u8, get_str(obj, "text_sha"));
    errdefer a.free(text_sha);

    // vector
    const vec_v = obj.get("vector") orelse return error.MissingVector;
    if (vec_v != .array) return error.VectorNotArray;
    const arr = vec_v.array;
    var vec = try a.alloc(f32, arr.items.len);
    errdefer a.free(vec);
    for (arr.items, 0..) |item, i| {
        vec[i] = switch (item) {
            .float => |f| @floatCast(f),
            .integer => |n| @floatFromInt(n),
            else => 0.0,
        };
    }

    out_vec.* = vec;
    return .{
        .id = id,
        .source_type = source_type,
        .source_id = source_id,
        .chunk_index = get_i32(obj, "chunk_index"),
        .display_text = display_text,
        .text_preview = text_preview,
        .metadata_json = metadata_json,
        .model = model,
        .text_sha = text_sha,
        .vector = vec,
    };
}

fn freeRow(a: std.mem.Allocator, r: RowParse) void {
    a.free(r.id);
    a.free(r.source_type);
    a.free(r.source_id);
    a.free(r.display_text);
    a.free(r.text_preview);
    a.free(r.metadata_json);
    a.free(r.model);
    a.free(r.text_sha);
    a.free(r.vector);
}

fn hostStoreUpsert(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = allocator();
    if (g_store == null) {
        setBool(info, false);
        return;
    }
    const json = argStringAlloc(a, info, 1) orelse {
        setBool(info, false);
        return;
    };
    defer a.free(json);

    var vec_holder: []f32 = &.{};
    const row = parseChunkRow(a, json, &vec_holder) catch {
        setBool(info, false);
        return;
    };
    defer freeRow(a, row);

    g_store.?.upsert(
        row.id,
        row.source_type,
        row.source_id,
        row.chunk_index,
        row.display_text,
        row.text_preview,
        row.metadata_json,
        row.model,
        row.text_sha,
        row.vector,
    ) catch {
        setBool(info, false);
        return;
    };
    setBool(info, true);
}

fn hostStoreSearch(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = allocator();
    if (g_store == null) {
        setString(info, "[]");
        return;
    }
    const qvec_json = argStringAlloc(a, info, 1) orelse {
        setString(info, "[]");
        return;
    };
    defer a.free(qvec_json);
    const n_i = argI32(info, 2, 5);
    const n: usize = if (n_i <= 0) 5 else @intCast(n_i);
    const src = argStringAlloc(a, info, 3) orelse "";
    defer if (src.len > 0) a.free(src);

    const qvec = parseFloatArray(a, qvec_json) catch {
        setString(info, "[]");
        return;
    };
    defer a.free(qvec);

    const hits = g_store.?.searchTopNFiltered(a, qvec, n, src) catch {
        setString(info, "[]");
        return;
    };
    defer embed.freeHits(a, hits);

    var buf = std.array_list.Managed(u8).init(a);
    defer buf.deinit();
    buf.append('[') catch {
        setString(info, "[]");
        return;
    };
    for (hits, 0..) |h, i| {
        if (i > 0) buf.append(',') catch {
            setString(info, "[]");
            return;
        };
        buf.appendSlice("{\"id\":") catch {
            setString(info, "[]");
            return;
        };
        writeJsonStringEscaped(&buf, h.id) catch {
            setString(info, "[]");
            return;
        };
        buf.appendSlice(",\"source_id\":") catch {
            setString(info, "[]");
            return;
        };
        writeJsonStringEscaped(&buf, h.source_id) catch {
            setString(info, "[]");
            return;
        };
        managedPrint(&buf, ",\"chunk_index\":{d},\"text_preview\":", .{h.chunk_index}) catch {
            setString(info, "[]");
            return;
        };
        writeJsonStringEscaped(&buf, h.text_preview) catch {
            setString(info, "[]");
            return;
        };
        buf.appendSlice(",\"display_text\":") catch {
            setString(info, "[]");
            return;
        };
        writeJsonStringEscaped(&buf, h.display_text) catch {
            setString(info, "[]");
            return;
        };
        managedPrint(&buf, ",\"dense_score\":{d}}}", .{h.dense_score}) catch {
            setString(info, "[]");
            return;
        };
    }
    buf.append(']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, buf.items);
}

// ── Ingest pool host fns ───────────────────────────────────────────────

fn ensureSharedModel(model_path: []const u8) bool {
    if (g_shared != null and std.mem.eql(u8, g_shared_path, model_path)) return true;
    const a = allocator();
    if (g_shared) |*sm| {
        sm.deinit();
        g_shared = null;
    }
    if (g_shared_path.len > 0) a.free(g_shared_path);
    g_shared_path = &.{};

    const sm = embed.SharedModel.init(model_path) catch return false;
    g_shared = sm;
    g_shared_path = a.dupe(u8, model_path) catch {
        g_shared.?.deinit();
        g_shared = null;
        return false;
    };
    return true;
}

/// __embed_ingest_start(rootPath, kind, modelPath, slug, nWorkers,
///                      excludesJson?, chunkSize?) → 1 | 0
///
/// `kind` is one of: "code" | "claude" | "claude-overflow" | "codex" |
/// "kimi" | "memory". The framework picks the right walker, parser, and
/// canonical source_type label automatically. Backwards-compat: if the
/// arg looks like a source_type label ("code-chunk" / "chat-log-chunk" /
/// "document-chunk") we map it to the closest kind.
///
/// `kind` is one of the canonical kinds: "code" | "documentation" |
/// "conversation-history" | "knowledge". Legacy aliases ("claude",
/// "codex", "kimi", "memory", "claude-overflow") are accepted and
/// rewritten to the canonical kind in embed.CanonicalKind.fromStr.
///
/// `excludesJson` (optional) is a JSON array of path-substring matches
/// the walker should skip (applied to all kinds). Pass "[]" or omit
/// for no user excludes.
///
/// `chunkSize` (optional) overrides the window size:
///   - code / documentation → lines per chunk (default 200)
///   - conversation-history → events per window (default 4)
///   - knowledge → ignored (one record = one chunk)
/// Pass 0 or omit to keep the framework default.
///
/// `mappingJson` (optional) is a JSON object declaring how to read each
/// record from a structured source. Required for `conversation-history`
/// and `knowledge`; ignored for `code`/`documentation`. Recognised keys
/// (each value is a dotted JSON path into the source record):
///   role, content, timestamp, session_id  (conversation-history)
///   title, content, source_uri            (knowledge)
/// `content` is required for the structured kinds — the rest are
/// optional. Empty value = "field not mapped." Pass "{}" or omit when
/// not using a structured kind.
fn hostIngestStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const a = allocator();

    const root_path = argStringAlloc(a, info, 0) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(root_path);
    const kind_str = argStringAlloc(a, info, 1) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(kind_str);
    const model_path = argStringAlloc(a, info, 2) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(model_path);
    const slug = argStringAlloc(a, info, 3) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(slug);
    const n_workers_i = argI32(info, 4, 4);
    const n_workers: usize = if (n_workers_i <= 0) 1 else if (n_workers_i > 16) 16 else @intCast(n_workers_i);

    // Arg 5: JSON array of user-supplied excludes (path substring
    // matches). Optional — omit or pass "[]" for none. Parsed here, the
    // session keeps owned dupes.
    const excludes_json = argStringAlloc(a, info, 5) orelse a.dupe(u8, "[]") catch {
        setNumber(info, 0);
        return;
    };
    defer a.free(excludes_json);
    var excludes_list = std.array_list.Managed([]u8).init(a);
    defer {
        for (excludes_list.items) |s| a.free(s);
        excludes_list.deinit();
    }
    parseExcludesJson(a, excludes_json, &excludes_list) catch {};
    var excludes_const = a.alloc([]const u8, excludes_list.items.len) catch {
        setNumber(info, 0);
        return;
    };
    defer a.free(excludes_const);
    for (excludes_list.items, 0..) |s, i| excludes_const[i] = s;

    // Arg 6: chunk size override (lines for code, events for chat-log).
    // 0 = use the framework defaults.
    const chunk_size_i = argI32(info, 6, 0);
    const chunk_size: usize = if (chunk_size_i <= 0) 0 else @intCast(chunk_size_i);

    // Arg 7: mapping JSON for structured kinds. Optional; "{}" / empty
    // is fine for raw kinds. The session deep-parses it and keeps the
    // arena alive for the workers.
    const mapping_json = argStringAlloc(a, info, 7) orelse a.dupe(u8, "{}") catch {
        setNumber(info, 0);
        return;
    };
    defer a.free(mapping_json);

    // Map kind string → CanonicalKind. fromStr accepts the canonical
    // names AND the legacy vendor aliases (claude/codex/kimi/memory)
    // for one-step migration.
    const kind: embed.CanonicalKind = embed.CanonicalKind.fromStr(kind_str) orelse blk: {
        if (std.mem.eql(u8, kind_str, "code-chunk")) break :blk embed.CanonicalKind.code;
        if (std.mem.eql(u8, kind_str, "chat-log-chunk")) break :blk embed.CanonicalKind.conversation_history;
        if (std.mem.eql(u8, kind_str, "document-chunk")) break :blk embed.CanonicalKind.documentation;
        if (std.mem.eql(u8, kind_str, "knowledge-chunk")) break :blk embed.CanonicalKind.knowledge;
        setNumber(info, 0);
        return;
    };

    // Reap a previous (finished) session so we don't leak.
    if (g_ingest) |s| {
        if (s.done_flag.load(.monotonic)) {
            s.deinit();
            g_ingest = null;
        } else {
            // Already running. Refuse a new one rather than racing.
            setNumber(info, 0);
            return;
        }
    }

    if (!ensureSharedModel(model_path)) {
        setNumber(info, 0);
        return;
    }
    // Free the query ctx for the duration of the ingest.
    freeQueryCtx();

    // Open / re-open the store at the right slug + dim.
    const dim = g_shared.?.n_embd;
    if (g_store) |*s| {
        s.close();
        g_store = null;
    }
    g_store = embed.Store.open(host.io, host.environ, a, slug, dim) catch {
        setNumber(info, 0);
        return;
    };
    g_store.?.buildPartialHnsw(kind.canonicalSourceType()) catch {};

    // Use c_allocator for the session so its threads can use it without
    // contention with V8's main-thread-bound GPA.
    const sess_alloc = std.heap.c_allocator;
    const model_id = std.fs.path.basename(model_path);
    const sess = embed.IngestSession.start(
        host.io,
        sess_alloc,
        &g_shared.?,
        &g_store.?,
        root_path,
        kind,
        model_id,
        n_workers,
        excludes_const,
        chunk_size,
        mapping_json,
    ) catch {
        setNumber(info, 0);
        return;
    };
    g_ingest = sess;
    setNumber(info, 1);
}

/// Parse a JSON array of strings into an array_list of owned u8 slices.
/// Lenient on shape — anything non-string is skipped; malformed JSON
/// leaves the list empty. This is "decode user excludes from V8 land",
/// not a general-purpose parser.
fn parseExcludesJson(
    a: std.mem.Allocator,
    json_text: []const u8,
    out: *std.array_list.Managed([]u8),
) !void {
    const parsed = std.json.parseFromSlice(std.json.Value, a, json_text, .{}) catch return;
    defer parsed.deinit();
    const root = parsed.value;
    if (root != .array) return;
    for (root.array.items) |item| {
        if (item != .string) continue;
        const s = try a.dupe(u8, item.string);
        try out.append(s);
    }
}

/// __embed_ingest_progress(handle) → JSON snapshot
fn hostIngestProgress(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = allocator();
    if (g_ingest == null) {
        setString(info, "{\"running\":false}");
        return;
    }
    const snap = g_ingest.?.snapshot();
    var buf = std.array_list.Managed(u8).init(a);
    defer buf.deinit();
    managedPrint(
        &buf,
        "{{\"running\":true,\"files_total\":{d},\"files_done\":{d},\"chunks_done\":{d},\"embed_ms_sum\":{d},\"done\":{},\"cancelled\":{},\"current_file\":",
        .{ snap.files_total, snap.files_done, snap.chunks_done, snap.embed_ms_sum, snap.done, snap.cancelled },
    ) catch {
        setString(info, "{\"running\":false}");
        return;
    };
    writeJsonStringEscaped(&buf, snap.current_file[0..snap.current_len]) catch {
        setString(info, "{\"running\":false}");
        return;
    };
    buf.appendSlice(",\"error\":") catch {
        setString(info, "{\"running\":false}");
        return;
    };
    writeJsonStringEscaped(&buf, snap.error_text[0..snap.error_text_len]) catch {
        setString(info, "{\"running\":false}");
        return;
    };
    buf.append('}') catch {
        setString(info, "{\"running\":false}");
        return;
    };
    setString(info, buf.items);
}

/// __embed_ingest_cancel() → bool
fn hostIngestCancel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (g_ingest) |s| {
        s.cancel();
        setBool(info, true);
        return;
    }
    setBool(info, false);
}

pub fn registerEmbed(_: anytype) void {
    v8_runtime.registerHostFn("__embed_load_model", hostLoadModel);
    v8_runtime.registerHostFn("__embed_free_model", hostFreeModel);
    v8_runtime.registerHostFn("__embed_n_dim", hostNDim);
    v8_runtime.registerHostFn("__embed_text", hostEmbedText);
    v8_runtime.registerHostFn("__embed_batch", hostEmbedBatch);
    v8_runtime.registerHostFn("__embed_rerank", hostRerank);
    v8_runtime.registerHostFn("__embed_store_open", hostStoreOpen);
    v8_runtime.registerHostFn("__embed_store_close", hostStoreClose);
    v8_runtime.registerHostFn("__embed_store_upsert", hostStoreUpsert);
    v8_runtime.registerHostFn("__embed_ingest_start", hostIngestStart);
    v8_runtime.registerHostFn("__embed_ingest_progress", hostIngestProgress);
    v8_runtime.registerHostFn("__embed_ingest_cancel", hostIngestCancel);
    v8_runtime.registerHostFn("__embed_store_search_json", hostStoreSearch);
}

pub fn tickDrain() void {}
