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

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const capture = @import("gpu/capture.zig");

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

pub fn registerCapture(_: anytype) void {
    v8_runtime.registerHostFn("__capture_frame", captureFrame);
}
