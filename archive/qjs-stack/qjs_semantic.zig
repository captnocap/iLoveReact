//! QuickJS semantic terminal bridge — structured data from CLI output.
//!
//! Exposes the semantic graph, classified cache, session state, and
//! per-row token data to .tsz scripts. This is the bridge that turns
//! raw terminal output into structured data any UI can consume.
//!
//! Port of: love2d/lua/capabilities/semantic_terminal.lua
//! Pipeline: PTY → vterm → classifier → semantic graph → JS

const std = @import("std");
const qjs_c = @import("qjs_c.zig");
const qjs = qjs_c.qjs;
const QJS_UNDEFINED = qjs_c.UNDEFINED;
const jsv = @import("qjs_value.zig");
const setF = jsv.setF;
const setB = jsv.setB;
const semantic = @import("semantic.zig");
const classifier = @import("classifier.zig");
const vterm_mod = @import("vterm.zig");

pub fn hostSemState(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const s = semantic.getState();
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "mode", @floatFromInt(@intFromEnum(s.mode)));
    setB(c2, obj, "streaming", s.streaming);
    setF(c2, obj, "streaming_kind", @floatFromInt(@intFromEnum(s.streaming_kind)));
    setB(c2, obj, "awaiting_input", s.awaiting_input);
    setB(c2, obj, "awaiting_decision", s.awaiting_decision);
    setB(c2, obj, "modal_open", s.modal_open);
    setB(c2, obj, "interrupt_pending", s.interrupt_pending);
    setF(c2, obj, "turn_count", @floatFromInt(s.turn_count));
    setF(c2, obj, "current_turn_id", @floatFromInt(s.current_turn_id));
    setF(c2, obj, "node_count", @floatFromInt(s.node_count));
    setF(c2, obj, "group_count", @floatFromInt(s.group_count));
    const mode_name = @tagName(s.mode);
    _ = qjs.JS_SetPropertyStr(c2, obj, "mode_name", qjs.JS_NewStringLen(c2, mode_name.ptr, @intCast(mode_name.len)));
    const sk_name = @tagName(s.streaming_kind);
    _ = qjs.JS_SetPropertyStr(c2, obj, "streaming_kind_name", qjs.JS_NewStringLen(c2, sk_name.ptr, @intCast(sk_name.len)));
    return obj;
}

pub fn hostSemNodeCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(semantic.nodeCount()));
}

pub fn hostSemNode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const node = semantic.getNode(@intCast(idx)) orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    const kind_name = @tagName(node.kind);
    _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kind_name.ptr, @intCast(kind_name.len)));
    const role_name = @tagName(node.role);
    _ = qjs.JS_SetPropertyStr(c2, obj, "role", qjs.JS_NewStringLen(c2, role_name.ptr, @intCast(role_name.len)));
    const lane_name = @tagName(node.lane);
    _ = qjs.JS_SetPropertyStr(c2, obj, "lane", qjs.JS_NewStringLen(c2, lane_name.ptr, @intCast(lane_name.len)));
    const scope_name = @tagName(node.scope);
    _ = qjs.JS_SetPropertyStr(c2, obj, "scope", qjs.JS_NewStringLen(c2, scope_name.ptr, @intCast(scope_name.len)));
    setF(c2, obj, "turn_id", @floatFromInt(node.turn_id));
    setF(c2, obj, "group_id", @floatFromInt(node.group_id));
    setF(c2, obj, "row_start", @floatFromInt(node.row_start));
    setF(c2, obj, "row_end", @floatFromInt(node.row_end));
    setF(c2, obj, "row_count", @floatFromInt(node.row_count));
    setF(c2, obj, "children_count", @floatFromInt(node.children_count));
    setB(c2, obj, "active", node.active);
    if (node.row_count > 0) {
        const text = vterm_mod.getRowText(node.row_start);
        _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
    }
    return obj;
}

pub fn hostSemCacheCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(semantic.cacheCount()));
}

pub fn hostSemCacheEntry(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const entry = semantic.getCacheEntry(@intCast(idx)) orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "row", @floatFromInt(entry.row));
    const kind_name = @tagName(entry.kind);
    _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kind_name.ptr, @intCast(kind_name.len)));
    setF(c2, obj, "turn_id", @floatFromInt(entry.turn_id));
    setF(c2, obj, "group_id", @floatFromInt(entry.group_id));
    const text = vterm_mod.getRowText(entry.row);
    _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
    return obj;
}

pub fn hostSemRowToken(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var row: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &row, argv[0]);
    if (row < 0) return QJS_UNDEFINED;
    const token = classifier.getRowToken(@intCast(row));
    const name = @tagName(token);
    return qjs.JS_NewStringLen(c2, name.ptr, @intCast(name.len));
}

pub fn hostSemRowText(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;
    var row: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &row, argv[0]);
    if (row < 0) return QJS_UNDEFINED;
    const text = vterm_mod.getRowText(@intCast(row));
    return qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len));
}

pub fn hostSemTree(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    var buf: [4096]u8 = undefined;
    const tree = semantic.formatTree(&buf);
    return qjs.JS_NewStringLen(c2, tree.ptr, @intCast(tree.len));
}

pub fn hostSemSetMode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 1) return QJS_UNDEFINED;
    var mode: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &mode, argv[0]);
    classifier.setMode(switch (mode) {
        1 => .basic,
        2 => .claude_code,
        3 => .json,
        else => .none,
    });
    classifier.markDirty();
    return QJS_UNDEFINED;
}

pub fn hostSemHasDiff(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, if (semantic.hasDiff()) 1.0 else 0.0);
}

pub fn hostSemFrame(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(semantic.getFrame()));
}

pub fn hostSemExport(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const count = semantic.cacheCount();
    const arr = qjs.JS_NewArray(c2);
    var i: u16 = 0;
    while (i < count) : (i += 1) {
        const entry = semantic.getCacheEntry(i) orelse continue;
        const obj = qjs.JS_NewObject(c2);
        setF(c2, obj, "row", @floatFromInt(entry.row));
        const kind_name = @tagName(entry.kind);
        _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kind_name.ptr, @intCast(kind_name.len)));
        setF(c2, obj, "turn_id", @floatFromInt(entry.turn_id));
        setF(c2, obj, "group_id", @floatFromInt(entry.group_id));
        const text = vterm_mod.getRowText(entry.row);
        _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
        const tc = classifier.tokenColor(entry.kind);
        var hex_buf: [8]u8 = undefined;
        const hex = std.fmt.bufPrint(&hex_buf, "#{x:0>2}{x:0>2}{x:0>2}", .{ tc.r, tc.g, tc.b }) catch "#e2e8f0";
        _ = qjs.JS_SetPropertyStr(c2, obj, "color", qjs.JS_NewStringLen(c2, hex.ptr, @intCast(hex.len)));
        _ = qjs.JS_SetPropertyUint32(c2, arr, @intCast(i), obj);
    }
    return arr;
}

// ── JSON-driven classifier bridge ────────────────────────────────
// These let JS set row tokens directly and trigger the graph build,
// enabling runtime classifiers loaded from JSON sheets.

pub fn hostSemSetRowToken(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    if (argc < 2) return QJS_UNDEFINED;
    var row: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &row, argv[0]);
    if (row < 0) return QJS_UNDEFINED;
    const name = qjs.JS_ToCString(ctx, argv[1]);
    if (name == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, name);
    const token = classifier.tokenFromName(std.mem.span(name));
    classifier.setRowToken(@intCast(row), token);
    return QJS_UNDEFINED;
}

pub fn hostSemVtermRows(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(vterm_mod.getRows()));
}

pub fn hostSemBuildGraph(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    var rows: i32 = 0;
    if (argc >= 1) _ = qjs.JS_ToInt32(ctx, &rows, argv[0]);
    if (rows <= 0) rows = @intCast(vterm_mod.getRows());
    semantic.tick(@intCast(rows));
    return QJS_UNDEFINED;
}

/// Single-shot semantic snapshot — the standardized consumer format.
/// Returns a versioned JS object with state + classified rows + graph.
/// Consumer calls JSON.stringify(__sem_snapshot()) to get the wire format.
///
/// Schema (v1):
///   { version, classifier, frame,
///     state: { mode, streaming, streaming_kind, awaiting_input, ... },
///     rows: [ { row, kind, role, lane, turn_id, group_id, text, color } ],
///     graph: { node_count, turn_count, tree } }
pub fn hostSemSnapshot(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const root = qjs.JS_NewObject(c2);

    // Version + metadata
    setF(c2, root, "version", 1.0);
    const cls_name = switch (classifier.getMode()) {
        .none => "none",
        .basic => "basic",
        .claude_code => "claude_code",
        .json => "json",
    };
    _ = qjs.JS_SetPropertyStr(c2, root, "classifier", qjs.JS_NewStringLen(c2, cls_name.ptr, @intCast(cls_name.len)));
    setF(c2, root, "frame", @floatFromInt(semantic.getFrame()));

    // State
    const s = semantic.getState();
    const st = qjs.JS_NewObject(c2);
    const mode_name = @tagName(s.mode);
    _ = qjs.JS_SetPropertyStr(c2, st, "mode", qjs.JS_NewStringLen(c2, mode_name.ptr, @intCast(mode_name.len)));
    setB(c2, st, "streaming", s.streaming);
    const sk = @tagName(s.streaming_kind);
    _ = qjs.JS_SetPropertyStr(c2, st, "streaming_kind", qjs.JS_NewStringLen(c2, sk.ptr, @intCast(sk.len)));
    setB(c2, st, "awaiting_input", s.awaiting_input);
    setB(c2, st, "awaiting_decision", s.awaiting_decision);
    setB(c2, st, "modal_open", s.modal_open);
    setB(c2, st, "interrupt_pending", s.interrupt_pending);
    setF(c2, st, "turn_count", @floatFromInt(s.turn_count));
    setF(c2, st, "current_turn_id", @floatFromInt(s.current_turn_id));
    setF(c2, st, "node_count", @floatFromInt(s.node_count));
    setF(c2, st, "group_count", @floatFromInt(s.group_count));
    _ = qjs.JS_SetPropertyStr(c2, root, "state", st);

    // Rows — classified cache with role/lane from the token definitions
    const count = semantic.cacheCount();
    const rows = qjs.JS_NewArray(c2);
    var i: u16 = 0;
    while (i < count) : (i += 1) {
        const entry = semantic.getCacheEntry(i) orelse continue;
        const obj = qjs.JS_NewObject(c2);
        setF(c2, obj, "row", @floatFromInt(entry.row));
        const kn = @tagName(entry.kind);
        _ = qjs.JS_SetPropertyStr(c2, obj, "kind", qjs.JS_NewStringLen(c2, kn.ptr, @intCast(kn.len)));
        const role = @tagName(semantic.roleOf(entry.kind));
        _ = qjs.JS_SetPropertyStr(c2, obj, "role", qjs.JS_NewStringLen(c2, role.ptr, @intCast(role.len)));
        const lane = @tagName(semantic.laneOf(entry.kind));
        _ = qjs.JS_SetPropertyStr(c2, obj, "lane", qjs.JS_NewStringLen(c2, lane.ptr, @intCast(lane.len)));
        setF(c2, obj, "turn_id", @floatFromInt(entry.turn_id));
        setF(c2, obj, "group_id", @floatFromInt(entry.group_id));
        const text = vterm_mod.getRowText(entry.row);
        _ = qjs.JS_SetPropertyStr(c2, obj, "text", qjs.JS_NewStringLen(c2, text.ptr, @intCast(text.len)));
        const tc = classifier.tokenColor(entry.kind);
        var hb: [8]u8 = undefined;
        const hx = std.fmt.bufPrint(&hb, "#{x:0>2}{x:0>2}{x:0>2}", .{ tc.r, tc.g, tc.b }) catch "#e2e8f0";
        _ = qjs.JS_SetPropertyStr(c2, obj, "color", qjs.JS_NewStringLen(c2, hx.ptr, @intCast(hx.len)));
        _ = qjs.JS_SetPropertyUint32(c2, rows, @intCast(i), obj);
    }
    _ = qjs.JS_SetPropertyStr(c2, root, "rows", rows);

    // Graph summary
    const g = qjs.JS_NewObject(c2);
    setF(c2, g, "node_count", @floatFromInt(semantic.nodeCount()));
    setF(c2, g, "turn_count", @floatFromInt(s.turn_count));
    var tree_buf: [4096]u8 = undefined;
    const tree = semantic.formatTree(&tree_buf);
    _ = qjs.JS_SetPropertyStr(c2, g, "tree", qjs.JS_NewStringLen(c2, tree.ptr, @intCast(tree.len)));
    _ = qjs.JS_SetPropertyStr(c2, root, "graph", g);

    return root;
}

/// Register all semantic host functions with a QuickJS context.
pub fn register(ctx: ?*qjs.JSContext, global: qjs.JSValue) void {
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_state", qjs.JS_NewCFunction(ctx, hostSemState, "__sem_state", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_node_count", qjs.JS_NewCFunction(ctx, hostSemNodeCount, "__sem_node_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_node", qjs.JS_NewCFunction(ctx, hostSemNode, "__sem_node", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_cache_count", qjs.JS_NewCFunction(ctx, hostSemCacheCount, "__sem_cache_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_cache_entry", qjs.JS_NewCFunction(ctx, hostSemCacheEntry, "__sem_cache_entry", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_row_token", qjs.JS_NewCFunction(ctx, hostSemRowToken, "__sem_row_token", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_row_text", qjs.JS_NewCFunction(ctx, hostSemRowText, "__sem_row_text", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_tree", qjs.JS_NewCFunction(ctx, hostSemTree, "__sem_tree", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_set_mode", qjs.JS_NewCFunction(ctx, hostSemSetMode, "__sem_set_mode", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_has_diff", qjs.JS_NewCFunction(ctx, hostSemHasDiff, "__sem_has_diff", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_frame", qjs.JS_NewCFunction(ctx, hostSemFrame, "__sem_frame", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_export", qjs.JS_NewCFunction(ctx, hostSemExport, "__sem_export", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_snapshot", qjs.JS_NewCFunction(ctx, hostSemSnapshot, "__sem_snapshot", 0));
    // JSON-driven classifier bridge
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_set_row_token", qjs.JS_NewCFunction(ctx, hostSemSetRowToken, "__sem_set_row_token", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_vterm_rows", qjs.JS_NewCFunction(ctx, hostSemVtermRows, "__sem_vterm_rows", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__sem_build_graph", qjs.JS_NewCFunction(ctx, hostSemBuildGraph, "__sem_build_graph", 1));
}
