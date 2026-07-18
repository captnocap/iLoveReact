//! V8 host bindings for runtime/hooks/pg.ts + usePostgres.
//!
//! Exposes:
//!   __pg_connect(uri)                            → integer handle | 0
//!   __pg_close(handle)                           → void
//!   __pg_exec(handle, sql, paramsJson)           → bool
//!   __pg_query_json(handle, sql, paramsJson)     → string (JSON rows)
//!   __pg_changes(handle)                         → integer
//!
//! All sql/params travel as plain strings. paramsJson is reserved for a
//! future param-binding upgrade — for now it's accepted (so the TS/JS
//! signatures don't need to change later) but ignored. Call sites that
//! need parameterised queries should use literal-substitution in SQL with
//! caller-side escaping (see runtime/hooks/sqlite.ts for the model).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const fpg = @import("storage/pg.zig");

fn currentContext(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

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

// ── host fns ───────────────────────────────────────────────────────────

fn hostConnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const a = host.gpa;
    const uri = argStringAlloc(a, info, 0) orelse {
        setNumber(info, 0);
        return;
    };
    defer a.free(uri);
    const handle = fpg.connect(host.io, host.environ, uri);
    setNumber(info, @intCast(handle));
}

fn hostClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const h = argI32(info, 0, 0);
    if (h <= 0) return;
    fpg.close(@intCast(h));
}

fn hostExec(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = v8_runtime.hostContext(info.getIsolate()).gpa;
    const h = argI32(info, 0, 0);
    if (h <= 0) {
        setBool(info, false);
        return;
    }
    const sql = argStringAlloc(a, info, 1) orelse {
        setBool(info, false);
        return;
    };
    defer a.free(sql);
    const params = argStringAlloc(a, info, 2) orelse "";
    defer if (params.len > 0) a.free(params);
    setBool(info, fpg.exec(@intCast(h), sql, params));
}

fn hostQueryJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = v8_runtime.hostContext(info.getIsolate()).gpa;
    const h = argI32(info, 0, 0);
    if (h <= 0) {
        setString(info, "[]");
        return;
    }
    const sql = argStringAlloc(a, info, 1) orelse {
        setString(info, "[]");
        return;
    };
    defer a.free(sql);
    const params = argStringAlloc(a, info, 2) orelse "";
    defer if (params.len > 0) a.free(params);
    const json = fpg.queryJson(a, @intCast(h), sql, params) catch {
        setString(info, "[]");
        return;
    };
    defer a.free(json);
    setString(info, json);
}

fn hostChanges(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const h = argI32(info, 0, 0);
    if (h <= 0) {
        setNumber(info, 0);
        return;
    }
    setNumber(info, fpg.changes(@intCast(h)));
}

pub fn registerPg(_: anytype) void {
    v8_runtime.registerHostFn("__pg_connect", hostConnect);
    v8_runtime.registerHostFn("__pg_close", hostClose);
    v8_runtime.registerHostFn("__pg_exec", hostExec);
    v8_runtime.registerHostFn("__pg_query_json", hostQueryJson);
    v8_runtime.registerHostFn("__pg_changes", hostChanges);
}

pub fn tickDrain() void {}
