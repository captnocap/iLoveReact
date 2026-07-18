//! v8_bindings_localstore.zig — `__localstore*` host functions as a LIGHT module
//! (std + v8 + v8_runtime + storage/localstore only, no engine/GPU deps), so the
//! minimal v8cli host can bind them too. The same functions live in the GPU host
//! via v8_bindings_core.registerCore; this lets a HEADLESS script (e.g. the
//! `rjit game bake` compile pipeline) read the SAME localstore.db the editor
//! writes — that's how custom Materialized materials reach the bake.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const localstore = @import("storage/localstore.zig");
const fs = @import("fs/fs.zig");

var g_keys_json_buf: [64 * 1024]u8 = undefined;

fn infoCtx(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = infoCtx(info);
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.Number.init(iso, value));
}

fn hostGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return setReturnString(info, "");
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return setReturnString(info, "");
    defer std.heap.c_allocator.free(key);
    const value = localstore.getAlloc(io, std.heap.c_allocator, ns, key) catch return setReturnString(info, "");
    if (value) |v| {
        defer std.heap.c_allocator.free(v);
        setReturnString(info, v);
    } else setReturnString(info, "");
}

fn hostHas(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return setReturnNumber(info, 0);
    defer std.heap.c_allocator.free(key);
    const found = localstore.has(io, ns, key) catch return setReturnNumber(info, 0);
    setReturnNumber(info, if (found) 1 else 0);
}

fn hostSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(key);
    const value = argToStringAlloc(info, 2) orelse return;
    defer std.heap.c_allocator.free(value);
    localstore.set(io, ns, key, value) catch |err| {
        // a swallowed set is invisible data loss (the 8KB-cap bug hid behind
        // exactly this catch) — fail loud on stderr
        std.debug.print("[localstore] SET FAILED ns={s} key={s} len={d}: {s}\n", .{ ns, key, value.len, @errorName(err) });
    };
}

fn hostDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    const key = argToStringAlloc(info, 1) orelse return;
    defer std.heap.c_allocator.free(key);
    localstore.delete(io, ns, key) catch {};
}

fn hostClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    if (info.length() < 1) return localstore.clear(io, null) catch {};
    const ns = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(ns);
    if (ns.len == 0) localstore.clear(io, null) catch {} else localstore.clear(io, ns) catch {};
}

fn hostKeysJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ns = argToStringAlloc(info, 0) orelse return setReturnString(info, "[]");
    defer std.heap.c_allocator.free(ns);
    var entries: [localstore.MAX_KEYS]localstore.KeyEntry = undefined;
    const count = localstore.keys(io, ns, &entries) catch return setReturnString(info, "[]");
    var pos: usize = 0;
    g_keys_json_buf[pos] = '[';
    pos += 1;
    var i: usize = 0;
    while (i < count) : (i += 1) {
        if (i > 0 and pos < g_keys_json_buf.len) {
            g_keys_json_buf[pos] = ',';
            pos += 1;
        }
        if (pos >= g_keys_json_buf.len) break;
        g_keys_json_buf[pos] = '"';
        pos += 1;
        for (entries[i].key()) |ch| {
            if (ch == '"' or ch == '\\') {
                if (pos + 2 > g_keys_json_buf.len) break;
                g_keys_json_buf[pos] = '\\';
                pos += 1;
            } else if (ch < 0x20) {
                continue;
            } else if (pos + 1 > g_keys_json_buf.len) break;
            g_keys_json_buf[pos] = ch;
            pos += 1;
        }
        if (pos >= g_keys_json_buf.len) break;
        g_keys_json_buf[pos] = '"';
        pos += 1;
    }
    if (pos < g_keys_json_buf.len) {
        g_keys_json_buf[pos] = ']';
        pos += 1;
    }
    setReturnString(info, g_keys_json_buf[0..pos]);
}

/// Open localstore.db under the app data dir. Inits fs("reactjit") so the path
/// matches the editor host's. Best-effort: on failure the host fns return empty
/// (a script reads as if the store is empty), never crashing the bake.
pub fn initStore(host: *HostContext) void {
    fs.init(host.io, host.environ, "reactjit") catch {};
    localstore.init(host.io) catch {};
}

pub fn registerLocalstore(_: anytype) void {
    v8_runtime.registerHostFn("__localstoreGet", hostGet);
    v8_runtime.registerHostFn("__localstoreHas", hostHas);
    v8_runtime.registerHostFn("__localstoreSet", hostSet);
    v8_runtime.registerHostFn("__localstoreDelete", hostDelete);
    v8_runtime.registerHostFn("__localstoreClear", hostClear);
    v8_runtime.registerHostFn("__localstoreKeysJson", hostKeysJson);
}
