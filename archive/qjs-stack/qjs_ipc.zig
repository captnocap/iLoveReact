//! QuickJS host functions for the IPC debug client.
//!
//! Exposes debug_client.zig to JavaScript as:
//!   __ipc_connect(port, pubkey_hex)  → 1 on success, 0 on failure
//!   __ipc_disconnect()               → undefined
//!   __ipc_poll()                     → 1 if new response, 0 otherwise
//!   __ipc_status()                   → {connected, authenticated, awaiting_code}
//!   __ipc_submit_code(code)          → 1 on success, 0 on failure
//!   __ipc_request(method)            → undefined (sends encrypted request)
//!   __ipc_request_node(id)           → undefined (sends debug.node request)
//!   __ipc_tree_count()               → number of cached tree nodes
//!   __ipc_tree_node(i)               → {index, tag, depth} or undefined
//!   __ipc_response()                 → last decrypted JSON string or undefined

const std = @import("std");
const build_options = @import("build_options");
const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;

const dc = @import("debug_client.zig");

const qjs = if (HAS_QUICKJS) @cImport({
    @cDefine("_GNU_SOURCE", "1");
    @cDefine("QUICKJS_NG_BUILD", "1");
    @cInclude("quickjs.h");
}) else struct {
    pub const JSContext = opaque {};
    pub const JSValue = extern struct { u: extern union { int32: i32 } = .{ .int32 = 0 }, tag: i64 = 0 };
};

const QJS_UNDEFINED = qjs.JSValue{ .u = .{ .int32 = 0 }, .tag = 3 };

// ── Host functions ─────────────────────────────────────────────────

fn hostIpcConnect(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 2) return qjs.JS_NewFloat64(null, 0);

    // arg 0: port (number)
    var port_val: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &port_val, argv[0]);
    if (port_val <= 0 or port_val > 65535) return qjs.JS_NewFloat64(null, 0);

    // arg 1: pubkey_hex (string)
    var len: usize = 0;
    const ptr = qjs.JS_ToCStringLen(c2, &len, argv[1]);
    if (ptr == null) return qjs.JS_NewFloat64(null, 0);
    defer qjs.JS_FreeCString(c2, ptr);

    const hex = ptr[0..len];
    const ok = dc.connect(@intCast(port_val), hex);
    return qjs.JS_NewFloat64(null, if (ok) 1 else 0);
}

fn hostIpcDisconnect(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    dc.disconnect();
    return QJS_UNDEFINED;
}

fn hostIpcPoll(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const got = dc.poll();
    return qjs.JS_NewFloat64(null, if (got) 1 else 0);
}

fn hostIpcStatus(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "connected", if (dc.isConnected()) 1 else 0);
    setF(c2, obj, "authenticated", if (dc.isAuthenticated()) 1 else 0);
    setF(c2, obj, "awaiting_code", if (dc.isAwaitingCode()) 1 else 0);
    return obj;
}

fn hostIpcSubmitCode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return qjs.JS_NewFloat64(null, 0);

    var len: usize = 0;
    const ptr = qjs.JS_ToCStringLen(c2, &len, argv[0]);
    if (ptr == null) return qjs.JS_NewFloat64(null, 0);
    defer qjs.JS_FreeCString(c2, ptr);

    const ok = dc.submitCode(ptr[0..len]);
    return qjs.JS_NewFloat64(null, if (ok) 1 else 0);
}

fn hostIpcRequest(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;

    var len: usize = 0;
    const ptr = qjs.JS_ToCStringLen(c2, &len, argv[0]);
    if (ptr == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(c2, ptr);

    dc.request(ptr[0..len]);
    return QJS_UNDEFINED;
}

fn hostIpcRequestNode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;

    var id: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &id, argv[0]);
    dc.requestWithId("debug.node", id);
    return QJS_UNDEFINED;
}

fn hostIpcTreeCount(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    return qjs.JS_NewFloat64(null, @floatFromInt(dc.getTreeNodeCount()));
}

fn hostIpcTreeNode(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    if (argc < 1) return QJS_UNDEFINED;

    var idx: i32 = 0;
    _ = qjs.JS_ToInt32(c2, &idx, argv[0]);
    if (idx < 0) return QJS_UNDEFINED;

    const node = dc.getTreeNode(@intCast(idx)) orelse return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "index", @floatFromInt(node.index));
    setF(c2, obj, "depth", @floatFromInt(node.depth));
    _ = qjs.JS_SetPropertyStr(c2, obj, "tag", qjs.JS_NewStringLen(c2, &node.tag, @intCast(node.tag_len)));
    return obj;
}

fn hostIpcResponse(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const resp = dc.getLastResponse() orelse return QJS_UNDEFINED;
    return qjs.JS_NewStringLen(c2, resp.ptr, @intCast(resp.len));
}

fn hostIpcPerf(ctx: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    const c2 = ctx orelse return QJS_UNDEFINED;
    const p = dc.getPerf();
    if (!p.valid) return QJS_UNDEFINED;
    const obj = qjs.JS_NewObject(c2);
    setF(c2, obj, "fps", @floatFromInt(p.fps));
    setF(c2, obj, "layout_us", @floatFromInt(p.layout_us));
    setF(c2, obj, "paint_us", @floatFromInt(p.paint_us));
    setF(c2, obj, "gpu_us", @floatFromInt(p.gpu_us));
    setF(c2, obj, "tick_us", @floatFromInt(p.tick_us));
    setF(c2, obj, "frame_total_us", @floatFromInt(p.frame_total_us));
    setF(c2, obj, "rects", @floatFromInt(p.rects));
    setF(c2, obj, "glyphs", @floatFromInt(p.glyphs));
    setF(c2, obj, "total_nodes", @floatFromInt(p.total_nodes));
    setF(c2, obj, "visible_nodes", @floatFromInt(p.visible_nodes));
    setF(c2, obj, "window_w", @floatFromInt(p.window_w));
    setF(c2, obj, "window_h", @floatFromInt(p.window_h));
    return obj;
}

fn hostIpcEnableTelemetry(_: ?*qjs.JSContext, _: qjs.JSValue, _: c_int, _: [*c]qjs.JSValue) callconv(.c) qjs.JSValue {
    dc.enableTelemetryStream();
    return QJS_UNDEFINED;
}

// ── Registration ───────────────────────────────────────────────────

fn setF(ctx: *qjs.JSContext, obj: qjs.JSValue, key: [*:0]const u8, val: f64) void {
    _ = qjs.JS_SetPropertyStr(ctx, obj, key, qjs.JS_NewFloat64(ctx, val));
}

pub fn registerAll(raw_ctx: *anyopaque) void {
    const ctx: *qjs.JSContext = @ptrCast(@alignCast(raw_ctx));
    const global = qjs.JS_GetGlobalObject(ctx);

    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_connect", qjs.JS_NewCFunction(ctx, hostIpcConnect, "__ipc_connect", 2));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_disconnect", qjs.JS_NewCFunction(ctx, hostIpcDisconnect, "__ipc_disconnect", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_poll", qjs.JS_NewCFunction(ctx, hostIpcPoll, "__ipc_poll", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_status", qjs.JS_NewCFunction(ctx, hostIpcStatus, "__ipc_status", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_submit_code", qjs.JS_NewCFunction(ctx, hostIpcSubmitCode, "__ipc_submit_code", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_request", qjs.JS_NewCFunction(ctx, hostIpcRequest, "__ipc_request", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_request_node", qjs.JS_NewCFunction(ctx, hostIpcRequestNode, "__ipc_request_node", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_tree_count", qjs.JS_NewCFunction(ctx, hostIpcTreeCount, "__ipc_tree_count", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_tree_node", qjs.JS_NewCFunction(ctx, hostIpcTreeNode, "__ipc_tree_node", 1));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_response", qjs.JS_NewCFunction(ctx, hostIpcResponse, "__ipc_response", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_perf", qjs.JS_NewCFunction(ctx, hostIpcPerf, "__ipc_perf", 0));
    _ = qjs.JS_SetPropertyStr(ctx, global, "__ipc_enable_telemetry", qjs.JS_NewCFunction(ctx, hostIpcEnableTelemetry, "__ipc_enable_telemetry", 0));

    qjs.JS_FreeValue(ctx, global);
}
