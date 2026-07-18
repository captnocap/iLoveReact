//! V8 host bindings for environment, process info, and exec.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const process_mod = @import("process/process.zig");
const prepared_input = @import("state/prepared_input.zig");
const log = @import("diag/log.zig");

extern fn getpid() c_int;

var g_app_dir_buf: [4096]u8 = undefined;
var g_app_dir_len: usize = 0;
var g_app_dir_resolved: bool = false;

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

fn setValue(info: v8.FunctionCallbackInfo, value: anytype) void {
    info.getReturnValue().set(value);
}

fn setUndefined(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initUndefined(info.getIsolate()).toValue());
}

fn setNull(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initNull(info.getIsolate()).toValue());
}

fn setNumber(info: v8.FunctionCallbackInfo, value: anytype) void {
    const num: f64 = switch (@typeInfo(@TypeOf(value))) {
        .float => @floatCast(value),
        .int, .comptime_int => @floatFromInt(value),
        else => @compileError("setNumber only supports ints and floats"),
    };
    setValue(info, v8.Number.init(info.getIsolate(), num));
}

fn setString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    const iso = info.getIsolate();
    setValue(info, v8.String.initUtf8(iso, value));
}

fn resolveAppDir(io: std.Io) usize {
    if (g_app_dir_resolved) return g_app_dir_len;
    g_app_dir_resolved = true;

    const exe_path_len = std.process.executablePath(io, &g_app_dir_buf) catch return 0;
    var dir_end: usize = exe_path_len;
    while (dir_end > 0 and g_app_dir_buf[dir_end - 1] != '/') dir_end -= 1;
    if (dir_end == 0) return 0;

    if (dir_end >= 4 and std.mem.eql(u8, g_app_dir_buf[dir_end - 4 .. dir_end], "lib/")) {
        dir_end -= 4;
        if (dir_end == 0 or g_app_dir_buf[dir_end - 1] != '/') {
            while (dir_end > 0 and g_app_dir_buf[dir_end - 1] != '/') dir_end -= 1;
        }
    }

    g_app_dir_len = dir_end;
    return dir_end;
}

fn execCmd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const alloc = std.heap.page_allocator;
    const cmd_buf = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "");
        return;
    };
    defer alloc.free(cmd_buf);

    const result = std.process.run(alloc, host.io, .{
        .argv = &.{ "/bin/sh", "-c", cmd_buf },
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .environ_map = host.environ,
    }) catch {
        setString(info, "");
        return;
    };
    defer alloc.free(result.stdout);
    defer alloc.free(result.stderr);
    setString(info, result.stdout);
}

fn getPid(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setNumber(info, @as(i64, getpid()));
}

fn getEnv(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const environ = v8_runtime.hostContext(info.getIsolate()).environ;
    const alloc = std.heap.page_allocator;
    const name_buf = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "");
        return;
    };
    defer alloc.free(name_buf);
    const val = environ.get(name_buf) orelse {
        setString(info, "");
        return;
    };
    setString(info, val);
}

fn envGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const environ = v8_runtime.hostContext(info.getIsolate()).environ;
    const alloc = std.heap.page_allocator;
    const name_buf = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(name_buf);
    const val = environ.get(name_buf) orelse {
        setNull(info);
        return;
    };
    setString(info, val);
}

fn envSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const environ = v8_runtime.hostContext(info.getIsolate()).environ;
    const alloc = std.heap.page_allocator;
    const name_buf = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(name_buf);
    const value_buf = argStringAlloc(alloc, info, 1) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(value_buf);

    environ.put(name_buf, value_buf) catch {};
    setUndefined(info);
}

fn exitHost(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const code = if (info.length() > 0) info.getArg(0).toI32(currentContext(info)) catch 0 else 0;
    std.process.exit(@intCast(code & 0xff));
}

fn spawnSelf(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const io = host.io;
    const dir_len = resolveAppDir(io);
    if (dir_len == 0) {
        log.info(.engine, "spawn_self: failed to resolve app directory", .{});
        setNumber(info, -1);
        return;
    }

    const run_suffix = "run";
    if (dir_len + run_suffix.len >= g_app_dir_buf.len) {
        setNumber(info, -1);
        return;
    }

    var run_buf: [4096]u8 = undefined;
    @memcpy(run_buf[0..dir_len], g_app_dir_buf[0..dir_len]);
    @memcpy(run_buf[dir_len .. dir_len + run_suffix.len], run_suffix);
    const run_path = run_buf[0 .. dir_len + run_suffix.len];

    var child_environ = host.environ.clone(std.heap.c_allocator) catch {
        setNumber(info, -1);
        return;
    };
    defer child_environ.deinit();
    child_environ.put("TSZ_DEBUG", "1") catch {
        setNumber(info, -1);
        return;
    };

    log.info(.engine, "spawn_self: run_path={s}", .{run_path});
    var child = process_mod.spawn(std.heap.c_allocator, io, .{
        .argv = &.{run_path},
        .environ_map = &child_environ,
    }) catch |err| {
        log.info(.engine, "spawn_self: spawn failed: {s}", .{@errorName(err)});
        setNumber(info, -1);
        return;
    };
    log.info(.engine, "spawn_self: child pid={d}", .{child.pid});
    setNumber(info, @as(i64, child.pid));
    child.detach();
}

fn getAppDir(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dir_len = resolveAppDir(v8_runtime.hostContext(info.getIsolate()).io);
    if (dir_len == 0) {
        setString(info, "");
        return;
    }
    setString(info, g_app_dir_buf[0..dir_len]);
}

fn getRunPath(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const dir_len = resolveAppDir(v8_runtime.hostContext(info.getIsolate()).io);
    if (dir_len == 0) {
        setString(info, "");
        return;
    }
    const run_suffix = "run";
    if (dir_len + run_suffix.len >= g_app_dir_buf.len) {
        setString(info, "");
        return;
    }
    var buf: [4096]u8 = undefined;
    @memcpy(buf[0..dir_len], g_app_dir_buf[0..dir_len]);
    @memcpy(buf[dir_len .. dir_len + run_suffix.len], run_suffix);
    setString(info, buf[0 .. dir_len + run_suffix.len]);
}

fn beginTerminalDockResize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) {
        setUndefined(info);
        return;
    }
    const ctx = currentContext(info);
    const start_y = info.getArg(0).toF64(ctx) catch 0;
    const start_height = info.getArg(1).toF64(ctx) catch 0;
    prepared_input.beginTerminalDockResize(@floatCast(start_y), @floatCast(start_height));
    setUndefined(info);
}

fn endTerminalDockResize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    prepared_input.endTerminalDockResize();
    setUndefined(info);
}

fn getTerminalDockResizeState(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const obj = v8.Object.init(iso);
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, "active"), v8.Number.init(iso, if (prepared_input.terminalDockResizeActive()) 1 else 0).toValue());
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, "startY"), v8.Number.init(iso, prepared_input.terminalDockResizeStartY()));
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, "startHeight"), v8.Number.init(iso, prepared_input.terminalDockResizeStartHeight()));
    setValue(info, obj.toValue());
}

pub fn registerEnv(_: anytype) void {
    v8_runtime.registerHostFn("__getenv", getEnv);
    v8_runtime.registerHostFn("__env_get", envGet);
    v8_runtime.registerHostFn("__env_set", envSet);
    v8_runtime.registerHostFn("__getpid", getPid);
    v8_runtime.registerHostFn("__exec", execCmd);
    v8_runtime.registerHostFn("__exit", exitHost);
    v8_runtime.registerHostFn("__spawn_self", spawnSelf);
    v8_runtime.registerHostFn("__get_app_dir", getAppDir);
    v8_runtime.registerHostFn("__get_run_path", getRunPath);
    v8_runtime.registerHostFn("__beginTerminalDockResize", beginTerminalDockResize);
    v8_runtime.registerHostFn("__endTerminalDockResize", endTerminalDockResize);
    v8_runtime.registerHostFn("__getTerminalDockResizeState", getTerminalDockResizeState);
}

pub fn tickDrain() void {}
