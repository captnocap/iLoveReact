//! framework/v8_bindings_capture.zig — __capture_frame: the app screenshots
//! ITSELF (SELFSHOT-0606).
//!
//! USER RULING (2026-06-06, the all-lanes stop): "if anyone wants to get
//! screenshots. they need to figure it out without using my desktop. make a
//! command to get the proper screenshot of whatever u need, dont look at the
//! system." Desktop/X11 capture (import -window etc.) is BANNED; this binding
//! is the replacement — it reads back the frame the GPU already composed
//! (framework/gpu/capture.zig requestFrame → gpu.captureScreenshot), never
//! the user's screen.
//!
//! Gated INGREDIENT (V18): carts opt in by importing runtime/capture.ts
//! (the metafile-gate trigger flips -Dhas-capture=true). When off, this file
//! is never parsed — 2D/sweatshop carts pay zero bytes and zero host fns.
//!
//!   __capture_frame(path) → bool — queue a one-shot capture of the NEXT
//!   rendered frame to a PNG at `path`. The write lands within a frame or
//!   two (readback fires at the end of gpu.frame(), before present); the
//!   host logs `SCREENSHOT_SAVED:<path>` when the PNG is on disk. Returns
//!   false for an unusable path or while the F9 recorder owns the hook.
//!
//!   __capture_surface_pixels(staticKey) → Uint8Array | null — read a
//!   CAPTURED StaticSurface's pixels back as [w: u32 LE][h: u32 LE][RGBA
//!   tight rows] (DECALPIX-0610: the decal pixel bake — the editor executes
//!   a decal doc once and ships the pixels, since a decal has no WGSL recipe
//!   to re-run). Null until the surface has captured (mount it, give it a
//!   frame or two, poll). Blocks on the GPU copy — a save/bake-point door,
//!   not a per-frame one.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const capture = @import("gpu/capture.zig");
const gpu = @import("gpu/gpu.zig");

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

fn setBool(info: v8.FunctionCallbackInfo, value: bool) void {
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), value));
}

fn captureFrame(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setBool(info, false);
        return;
    };
    defer alloc.free(path);
    setBool(info, capture.requestFrame(path));
}

fn surfaceReadback(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    const alloc = std.heap.page_allocator;
    const key = argStringAlloc(alloc, info, 0) orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    defer alloc.free(key);

    const bytes = gpu.readbackStaticSurface(key) orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    // Zero-copy hand-off (the paintable readback pattern): the page-allocator
    // buffer becomes the Uint8Array's backing store; the deleter frees it when
    // the JS array is collected.
    const Ctx = struct { len: usize };
    const ctx = alloc.create(Ctx) catch {
        std.heap.page_allocator.free(bytes);
        info.getReturnValue().set(iso.initNull());
        return;
    };
    ctx.* = .{ .len = bytes.len };
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(@constCast(bytes.ptr)),
        bytes.len,
        surfaceReadbackDeleter,
        @ptrCast(ctx),
    ) orelse {
        std.heap.page_allocator.free(bytes);
        alloc.destroy(ctx);
        info.getReturnValue().set(iso.initNull());
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    const u8a = v8.Uint8Array.init(ab, 0, bytes.len);
    info.getReturnValue().set(u8a.toValue());
}

fn surfaceReadbackDeleter(data: ?*anyopaque, _: usize, deleter_data: ?*anyopaque) callconv(.c) void {
    if (data) |raw| {
        const Ctx = struct { len: usize };
        const ctx: *Ctx = @ptrCast(@alignCast(deleter_data.?));
        const bytes_ptr: [*]u8 = @ptrCast(raw);
        std.heap.page_allocator.free(bytes_ptr[0..ctx.len]);
        std.heap.page_allocator.destroy(ctx);
    }
}

pub fn registerCapture(_: anytype) void {
    v8_runtime.registerHostFn("__capture_frame", captureFrame);
    v8_runtime.registerHostFn("__capture_surface_pixels", surfaceReadback);
}
