//! V8 host bindings for framework/videos.zig.
//!
//! Exposes:
//!   __video_set_paused(src, paused01)   → void
//!   __video_set_volume(src, vol_x100)   → void   volume in 0..150 (×100)
//!   __video_set_muted(src, muted01)     → void
//!   __video_set_loop(src, loop01)       → void
//!   __video_seek(src, seconds)          → void
//!   __video_get_time(src)               → number  (-1 if unknown)
//!   __video_get_duration(src)           → number  (-1 if unknown)
//!   __video_get_paused(src)             → bool
//!   __video_get_status(src)             → string  ("loading"|"ready"|"error"|"none")
//!   __video_get_dimensions(src)         → string  JSON {"w":W,"h":H} or "null"
//!   __video_count()                     → number
//!
//! No tickDrain — videos.zig is pumped from engine.zig:update() directly.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const videos = @import("render/videos.zig");

const alloc = std.heap.c_allocator;

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toI32(ctx) catch null;
}

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnBool(info: v8.FunctionCallbackInfo, value: bool) void {
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), text));
}

fn hostSetPaused(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(src);
    const flag = argToI32(info, 1) orelse 0;
    videos.setPaused(src, flag != 0);
}

fn hostSetVolume(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(src);
    // Volume comes in as integer ×100 so callers don't need to wrap floats
    // through callHost (which prefers ints/strings). videos.setVolume itself
    // multiplies by 100 again — so divide here to land back at 0..1.5.
    const vol_x100 = argToI32(info, 1) orelse 100;
    videos.setVolume(src, @as(f32, @floatFromInt(vol_x100)) / 100.0);
}

fn hostSetMuted(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(src);
    const flag = argToI32(info, 1) orelse 0;
    videos.setMuted(src, flag != 0);
}

fn hostSetLoop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(src);
    const flag = argToI32(info, 1) orelse 0;
    videos.setLoop(src, flag != 0);
}

fn hostSeek(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(src);
    const t = argToF64(info, 1) orelse 0;
    videos.seek(src, t);
}

fn hostGetTime(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, -1);
        return;
    };
    defer alloc.free(src);
    setReturnNumber(info, videos.getCurrentTime(src) orelse -1);
}

fn hostGetDuration(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, -1);
        return;
    };
    defer alloc.free(src);
    setReturnNumber(info, videos.getDuration(src) orelse -1);
}

fn hostGetPaused(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse {
        setReturnBool(info, true);
        return;
    };
    defer alloc.free(src);
    setReturnBool(info, videos.getPaused(src));
}

fn hostGetStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "none");
        return;
    };
    defer alloc.free(src);
    const st = videos.getStatus(src) orelse {
        setReturnString(info, "none");
        return;
    };
    setReturnString(info, switch (st) {
        .loading => "loading",
        .ready => "ready",
        .@"error" => "error",
    });
}

fn hostGetDimensions(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const src = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "null");
        return;
    };
    defer alloc.free(src);
    const dims = videos.getDimensions(src) orelse {
        setReturnString(info, "null");
        return;
    };
    var buf: [64]u8 = undefined;
    const out = std.fmt.bufPrint(&buf, "{{\"w\":{d},\"h\":{d}}}", .{ dims.w, dims.h }) catch {
        setReturnString(info, "null");
        return;
    };
    setReturnString(info, out);
}

fn hostCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(videos.videoCount()));
}

pub fn registerVideo(_: anytype) void {
    v8_runtime.registerHostFn("__video_set_paused", hostSetPaused);
    v8_runtime.registerHostFn("__video_set_volume", hostSetVolume);
    v8_runtime.registerHostFn("__video_set_muted", hostSetMuted);
    v8_runtime.registerHostFn("__video_set_loop", hostSetLoop);
    v8_runtime.registerHostFn("__video_seek", hostSeek);
    v8_runtime.registerHostFn("__video_get_time", hostGetTime);
    v8_runtime.registerHostFn("__video_get_duration", hostGetDuration);
    v8_runtime.registerHostFn("__video_get_paused", hostGetPaused);
    v8_runtime.registerHostFn("__video_get_status", hostGetStatus);
    v8_runtime.registerHostFn("__video_get_dimensions", hostGetDimensions);
    v8_runtime.registerHostFn("__video_count", hostCount);
}

pub fn tickDrain() void {}
