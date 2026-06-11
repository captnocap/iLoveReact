//! V8 bindings for the paintable GPU mask texture facility.
//!
//!   __paintable_circle(id, cx, cy, r, value)
//!     One circular brush dab. Value 0..1; for a binary mask, 1 = inside
//!     selection, 0 = outside. Queues the op — actual texture write happens
//!     in paintable.drainAll() at the top of the next frame.
//!
//!   __paintable_circle_edge(id, cx, cy, r, value, grayId, gradThreshold)
//!     Same as circle but only writes pixels whose sobel gradient against
//!     the `grayId` paintable falls below `gradThreshold`. Refine-brush
//!     behavior — expand/shrink without punching across strong edges.
//!     Gray rejection is enforced GPU-side in a followup; the threshold
//!     metadata travels with the op so existing callsites won't churn.
//!
//!   __paintable_brush(id, cx, cy, r, value, kind, angle, aspect, hardness, flow, scatter, seed)
//!     One general brush stamp. `kind` is a small numeric enum owned by
//!     the JS painter; angle is radians; aspect is width/height.
//!
//!   __paintable_polygon(id, vertsFloat32, value)
//!     Lasso/freehand polygon fill. `vertsFloat32` is a Float32Array of
//!     interleaved x,y pairs. CPU-rasterized into a small writeTexture
//!     for now (see paintable.zig:rasterizePolygonCpu).
//!
//!   __paintable_clear(id, value)
//!     Fill the entire texture with `value`. Used on session load /
//!     "invert mask" — replaces all pixels in one render pass.
//!
//!   __paintable_upload(id, uint8Array)
//!     Replace texture contents with raw R8 bytes (length == w*h).
//!     Used by SAM / flood-fill backends that produce CPU masks.
//!
//!   __paintable_readback(id) → Uint8Array | null
//!     Synchronous (blocking) GPU→CPU copy. Call at save / export
//!     boundaries only — NOT per frame.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const paintable = @import("gpu/paintable.zig");

const alloc = std.heap.c_allocator;

// ── Helpers (mirrored from v8_bindings_core's local style) ──────────────

fn argStrAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argF32(info: v8.FunctionCallbackInfo, idx: u32) ?f32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    const v = info.getArg(idx).toF64(ctx) catch return null;
    return @floatCast(v);
}

/// Pull raw bytes out of a Uint8Array / Float32Array / any ArrayBufferView
/// argument. Returns null when arg isn't an ArrayBufferView. Pointer is
/// owned by V8 — valid until the JS GC sweeps the backing store. Caller
/// MUST consume the bytes synchronously (copy if it needs to outlive the
/// call) since paintable.queueUpload() copies internally.
fn argBytes(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (idx >= info.length()) return null;
    const v = info.getArg(idx);
    if (!v.isArrayBufferView()) return null;
    // Cast the Value handle to ArrayBufferView. zig-v8's wrapper exposes
    // ArrayBufferView.castFrom only for typed-array structs, so we go
    // through the underlying handle pointer.
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(v.handle) };
    const byte_len = view.getByteLength();
    if (byte_len == 0) return &[_]u8{};
    const byte_off = view.getByteOffset();
    const ab = view.getBuffer();
    var shared = ab.getBackingStore();
    defer v8.BackingStore.sharedPtrReset(&shared);
    const bs = v8.BackingStore.sharedPtrGet(&shared);
    const base = bs.getData() orelse return null;
    const base_bytes: [*]const u8 = @ptrCast(base);
    return base_bytes[byte_off .. byte_off + byte_len];
}

// ── Bindings ────────────────────────────────────────────────────────────

fn paintCircle(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 5) return;
    const id = argStrAlloc(info, 0) orelse return;
    defer alloc.free(id);
    const cx = argF32(info, 1) orelse return;
    const cy = argF32(info, 2) orelse return;
    const r = argF32(info, 3) orelse return;
    const value = argF32(info, 4) orelse return;
    paintable.queueCircle(id, cx, cy, r, value);
}

fn paintCircleEdge(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 7) return;
    const id = argStrAlloc(info, 0) orelse return;
    defer alloc.free(id);
    const cx = argF32(info, 1) orelse return;
    const cy = argF32(info, 2) orelse return;
    const r = argF32(info, 3) orelse return;
    const value = argF32(info, 4) orelse return;
    const gray_id = argStrAlloc(info, 5) orelse return;
    defer alloc.free(gray_id);
    const threshold = argF32(info, 6) orelse return;
    paintable.queueCircleEdgeAware(id, cx, cy, r, value, gray_id, threshold);
}

fn paintBrush(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 12) return;
    const id = argStrAlloc(info, 0) orelse return;
    defer alloc.free(id);
    const cx = argF32(info, 1) orelse return;
    const cy = argF32(info, 2) orelse return;
    const r = argF32(info, 3) orelse return;
    const value = argF32(info, 4) orelse return;
    const kind = argF32(info, 5) orelse return;
    const angle = argF32(info, 6) orelse return;
    const aspect = argF32(info, 7) orelse return;
    const hardness = argF32(info, 8) orelse return;
    const flow = argF32(info, 9) orelse return;
    const scatter = argF32(info, 10) orelse return;
    const seed = argF32(info, 11) orelse return;
    paintable.queueBrush(id, cx, cy, r, value, kind, angle, aspect, hardness, flow, scatter, seed);
}

fn paintPolygon(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 3) return;
    const id = argStrAlloc(info, 0) orelse return;
    defer alloc.free(id);
    const bytes = argBytes(info, 1) orelse return;
    const value = argF32(info, 2) orelse return;
    if (bytes.len < @sizeOf(f32) * 6) return; // need at least 3 (x,y) points
    // Interpret as a Float32Array view. The byte alignment is guaranteed by
    // the JS Float32Array constructor (always aligned to 4).
    const float_len = bytes.len / @sizeOf(f32);
    const floats_ptr: [*]const f32 = @alignCast(@ptrCast(bytes.ptr));
    paintable.queuePolygon(id, floats_ptr[0..float_len], value);
}

fn paintClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = argStrAlloc(info, 0) orelse return;
    defer alloc.free(id);
    const value = argF32(info, 1) orelse 0;
    paintable.queueClear(id, value);
}

fn paintUpload(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const id = argStrAlloc(info, 0) orelse return;
    defer alloc.free(id);
    const bytes = argBytes(info, 1) orelse return;
    paintable.queueUpload(id, bytes);
}

fn paintReadback(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const iso = info.getIsolate();
    if (info.length() < 1) {
        info.getReturnValue().set(iso.initNull());
        return;
    }
    const id = argStrAlloc(info, 0) orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    defer alloc.free(id);

    const bytes = paintable.readbackSync(id) orelse {
        info.getReturnValue().set(iso.initNull());
        return;
    };
    // bytes is owned by paintable's page_allocator. Hand the same buffer
    // to V8 as a zero-copy backing store with a deleter that frees it
    // when the JS Uint8Array goes out of scope. Saves an in-engine memcpy
    // for what can be a 16MB+ mask at 4K.
    const Ctx = struct {
        len: usize,
    };
    const ctx = alloc.create(Ctx) catch {
        std.heap.page_allocator.free(bytes);
        info.getReturnValue().set(iso.initNull());
        return;
    };
    ctx.* = .{ .len = bytes.len };

    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(@constCast(bytes.ptr)),
        bytes.len,
        readbackDeleter,
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

fn readbackDeleter(data: ?*anyopaque, _: usize, deleter_data: ?*anyopaque) callconv(.c) void {
    if (data) |raw| {
        const Ctx = struct {
            len: usize,
        };
        const ctx: *Ctx = @ptrCast(@alignCast(deleter_data.?));
        const bytes_ptr: [*]u8 = @ptrCast(raw);
        std.heap.page_allocator.free(bytes_ptr[0..ctx.len]);
        alloc.destroy(ctx);
    }
}

// ── Registration ────────────────────────────────────────────────────────

pub fn registerPaintable(_: anytype) void {
    v8_runtime.registerHostFn("__paintable_circle", paintCircle);
    v8_runtime.registerHostFn("__paintable_circle_edge", paintCircleEdge);
    v8_runtime.registerHostFn("__paintable_brush", paintBrush);
    v8_runtime.registerHostFn("__paintable_polygon", paintPolygon);
    v8_runtime.registerHostFn("__paintable_clear", paintClear);
    v8_runtime.registerHostFn("__paintable_upload", paintUpload);
    v8_runtime.registerHostFn("__paintable_readback", paintReadback);
}
