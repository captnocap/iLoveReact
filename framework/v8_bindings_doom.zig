//! V8 host bindings for the doomgeneric subsystem (framework/doom/doom.zig).
//!
//! Exposes:
//!   __doom_init(wadPath: string)       → bool   boot doomgeneric with WAD
//!   __doom_tick()                      → void   one doomgeneric frame step
//!   __doom_framebuffer()               → ArrayBuffer  256KB view over the
//!                                                     640×400 BGRA buffer
//!   __doom_key(code: int, pressed: bool) → void  push a key event
//!   __doom_is_ready()                  → bool   has init() been called

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const doom = @import("doom/doom.zig");

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return @as(i32, @intCast(info.getArg(idx).toI32(ctx) catch return null));
}

fn argToBool(info: v8.FunctionCallbackInfo, idx: u32) bool {
    if (idx >= info.length()) return false;
    return info.getArg(idx).toBool(info.getIsolate());
}

fn argToString(info: v8.FunctionCallbackInfo, idx: u32, buf: []u8) ?[]const u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const v = info.getArg(idx);
    const s = v.toString(ctx) catch return null;
    const len = s.lenUtf8(iso);
    if (len >= buf.len) return null;
    _ = s.writeUtf8(iso, buf[0..len]);
    buf[len] = 0;
    return buf[0..len];
}

fn hostInit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var path_buf: [4096]u8 = undefined;
    const wad_path = argToString(info, 0, &path_buf) orelse {
        info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), false));
        return;
    };
    const ok = doom.init(std.heap.c_allocator, wad_path) catch false;
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), ok));
}

fn hostTick(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    _ = info;
    doom.tick();
}

fn hostIsReady(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), doom.isInitialised()));
}

fn noopBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

fn hostFramebuffer(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const fb = doom.framebufferPtr() orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    // Zero-copy view over DG_ScreenBuffer. doomgeneric mallocs it once at
    // create-time and never frees it, so the cart can keep typed-array refs
    // across frames without lifetime risk.
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(fb),
        doom.FB_BYTES,
        noopBackingStoreDeleter,
        null,
    ) orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    info.getReturnValue().set(ab);
}

fn hostKey(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const code = argToI32(info, 0) orelse return;
    if (code < 0 or code > 255) return;
    const pressed = argToBool(info, 1);
    doom.pushKey(@as(u8, @intCast(code)), pressed);
}

pub fn registerDoom(_: anytype) void {
    v8_runtime.registerHostFn("__doom_init", hostInit);
    v8_runtime.registerHostFn("__doom_tick", hostTick);
    v8_runtime.registerHostFn("__doom_is_ready", hostIsReady);
    v8_runtime.registerHostFn("__doom_framebuffer", hostFramebuffer);
    v8_runtime.registerHostFn("__doom_key", hostKey);
}

pub fn tickDrain() void {
    // No host-side events to drain. doomgeneric_Tick is driven from JS
    // (cart's per-frame __doom_tick call) so we don't autotick here.
}
