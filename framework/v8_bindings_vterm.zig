//! V8 host bindings for framework/terminal/vterm.zig.
//!
//! Recorder/playback/semantic host fns live in
//! framework/assistant/v8_bindings_sdk.zig under the __rec_*, __play_*, __sem_*
//! prefixes (gated on HAS_TERMINAL there). This file is the lean residue:
//! just shell-control bits that don't fit the sdk grouping.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const vterm = @import("terminal/vterm.zig");

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

fn hostTerminalSetCwd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse return;
    defer std.heap.c_allocator.free(path);
    vterm.setSpawnCwd(path);
}

pub fn registerVterm(_: anytype) void {
    v8_runtime.registerHostFn("__terminal_set_cwd", hostTerminalSetCwd);
}

pub fn tickDrain() void {}
