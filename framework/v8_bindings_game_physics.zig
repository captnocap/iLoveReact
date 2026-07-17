//! Game physics host bindings — thin V8 registrar over framework/game/
//! (physics.zig + movement.zig). All sim logic lives in the module; this
//! file only parses V8 args, hands packed buffers across, and stamps the
//! host-fn wall time into the snapshot.
//!
//! Host fn names are preserved from the physics_lab era so existing cart JS
//! (cart/hmsc-int/state/hostPhysics.ts, terrainColliders.ts, commands/registry.ts)
//! keeps working unchanged; each gets an honest __game_physics_* alias for
//! new callers (V18: honest capability names).
//!
//!   __hmsc_physics_step(inputFloat32Array) -> Float32 ArrayBuffer snapshot
//!     alias: __game_physics_step
//!   __game_physics_step_into(inputFloat32Array, outputFloat32Array) -> writtenFloatCount
//!     Allocation-free hot-path form; writes the same snapshot into caller-owned
//!     output storage.
//!   __hmsc_register_heightfield(id, originX, originZ, cell, cols, rows,
//!       baseY, walkCos, samplesFloat32Array, yaw?, pivotX?, pivotZ?)
//!     alias: __game_physics_register_heightfield
//!   __hmsc_clear_heightfields()
//!     alias: __game_physics_clear_heightfields
//!   __hmsc_spike_trace(on)   — engine per-frame spike logger toggle; rides
//!     along because hmsc's gv_perflog flips it next to the physics step.
//!   __game_physics_camera_occlusion(inputFloat32Array) -> Float32 ArrayBuffer
//!     Camera→player segment query against wall-class rects; output is
//!     [hostUs, hitCount, nearestTargetDistance, nearestOwnerId, ownerId...].
//!   __game_physics_camera_occlusion_configure(inputFloat32Array)
//!     Uploads the static wall-class rect set for allocation-free per-frame
//!     distance queries.
//!   __game_physics_camera_occlusion_distance(cx,cy,cz, tx,ty,tz, radius) -> f64
//!     Scalar hot-path query over the configured rect set; 0 means no hit.
//!   __game_physics_camera_occlusion_hit(cx,cy,cz, tx,ty,tz, radius) -> Float32 ArrayBuffer
//!     Owner-aware hot-path query over the configured rect set:
//!     [hostUs, nearestTargetDistance, nearestOwnerId].
//!
//! Gated ingredient (V18): registered only when the metafile gate flips
//! -Dhas-game-physics (see sdk/dependency-registry.json `game-physics` and
//! v8_ingredients.zig). A 2D cart pays zero bytes and zero host fns.

const std = @import("std");
const host_io = @import("host_io.zig");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const game_physics = @import("game/physics.zig");

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
}

fn argToBool(info: v8.FunctionCallbackInfo, idx: u32) ?bool {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toBool(info.getIsolate());
}

fn argBytes(info: v8.FunctionCallbackInfo, idx: u32) ?[]const u8 {
    if (idx >= info.length()) return null;
    const value = info.getArg(idx);
    if (!value.isArrayBufferView()) return null;
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(value.handle) };
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

fn argBytesMut(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const value = info.getArg(idx);
    if (!value.isArrayBufferView()) return null;
    const view: v8.ArrayBufferView = .{ .handle = @ptrCast(value.handle) };
    const byte_len = view.getByteLength();
    if (byte_len == 0) return &[_]u8{};
    const byte_off = view.getByteOffset();
    const ab = view.getBuffer();
    var shared = ab.getBackingStore();
    defer v8.BackingStore.sharedPtrReset(&shared);
    const bs = v8.BackingStore.sharedPtrGet(&shared);
    const base = bs.getData() orelse return null;
    const base_bytes: [*]u8 = @ptrCast(base);
    return base_bytes[byte_off .. byte_off + byte_len];
}

fn setReturnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

fn setReturnF64(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn noopBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

fn setReturnF32Buffer(info: v8.FunctionCallbackInfo, floats: []f32) void {
    const iso = info.getIsolate();
    const bytes = std.mem.sliceAsBytes(floats);
    const bs_raw = v8.c.v8__ArrayBuffer__NewBackingStore2(
        @ptrCast(bytes.ptr),
        bytes.len,
        noopBackingStoreDeleter,
        null,
    ) orelse {
        setReturnNull(info);
        return;
    };
    var shared = v8.c.v8__BackingStore__TO_SHARED_PTR(bs_raw);
    defer v8.BackingStore.sharedPtrReset(&shared);
    const ab = v8.ArrayBuffer.initWithBackingStore(iso, &shared);
    info.getReturnValue().set(ab);
}

inline fn nowNs() i64 {
    return @as(i64, @truncate(host_io.nanoTimestamp()));
}

// __hmsc_physics_step(inputFloat32Array) — one sim frame across the bridge.
// Returns null on a malformed buffer (cart falls back to JS movement).
fn hostPhysicsStep(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    if (bytes.len < game_physics.INPUT_HEADER_FLOATS * @sizeOf(f32)) {
        setReturnNull(info);
        return;
    }
    const input_ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    const input = input_ptr[0 .. bytes.len / @sizeOf(f32)];
    const snapshot = game_physics.step(input) orelse {
        setReturnNull(info);
        return;
    };
    snapshot[0] = @floatCast(@as(f64, @floatFromInt(nowNs() - t0)) / 1000.0);
    setReturnF32Buffer(info, snapshot);
}

fn hostPhysicsStepInto(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const input_bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const output_bytes = argBytesMut(info, 1) orelse {
        setReturnNull(info);
        return;
    };
    if (input_bytes.len < game_physics.INPUT_HEADER_FLOATS * @sizeOf(f32)) {
        setReturnNull(info);
        return;
    }
    const input_ptr: [*]const f32 = @ptrCast(@alignCast(input_bytes.ptr));
    const input = input_ptr[0 .. input_bytes.len / @sizeOf(f32)];
    const snapshot = game_physics.step(input) orelse {
        setReturnNull(info);
        return;
    };
    const snapshot_bytes = std.mem.sliceAsBytes(snapshot);
    if (output_bytes.len < snapshot_bytes.len) {
        setReturnNull(info);
        return;
    }
    snapshot[0] = @floatCast(@as(f64, @floatFromInt(nowNs() - t0)) / 1000.0);
    @memcpy(output_bytes[0..snapshot_bytes.len], snapshot_bytes);
    setReturnF64(info, @floatFromInt(snapshot.len));
}

fn hostCameraOcclusion(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    if (bytes.len < game_physics.CAMERA_OCCLUSION_HEADER_FLOATS * @sizeOf(f32)) {
        setReturnNull(info);
        return;
    }
    const input_ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    const input = input_ptr[0 .. bytes.len / @sizeOf(f32)];
    const snapshot = game_physics.cameraOcclusion(input) orelse {
        setReturnNull(info);
        return;
    };
    snapshot[0] = @floatCast(@as(f64, @floatFromInt(nowNs() - t0)) / 1000.0);
    setReturnF32Buffer(info, snapshot);
}

fn hostCameraOcclusionConfigure(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    defer setReturnNull(info);
    const bytes = argBytes(info, 0) orelse return;
    if (bytes.len < 2 * @sizeOf(f32)) return;
    const input_ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    const input = input_ptr[0 .. bytes.len / @sizeOf(f32)];
    _ = game_physics.configureCameraOcclusion(input);
}

fn hostCameraOcclusionDistance(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const distance = game_physics.cameraOcclusionConfiguredDistance(
        @floatCast(argToF64(info, 0) orelse 0),
        @floatCast(argToF64(info, 1) orelse 0),
        @floatCast(argToF64(info, 2) orelse 0),
        @floatCast(argToF64(info, 3) orelse 0),
        @floatCast(argToF64(info, 4) orelse 0),
        @floatCast(argToF64(info, 5) orelse 0),
        @floatCast(argToF64(info, 6) orelse 0),
    ) orelse {
        setReturnNull(info);
        return;
    };
    setReturnF64(info, distance);
}

fn hostCameraOcclusionHit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const snapshot = game_physics.cameraOcclusionConfiguredHitOutput(
        @floatCast(argToF64(info, 0) orelse 0),
        @floatCast(argToF64(info, 1) orelse 0),
        @floatCast(argToF64(info, 2) orelse 0),
        @floatCast(argToF64(info, 3) orelse 0),
        @floatCast(argToF64(info, 4) orelse 0),
        @floatCast(argToF64(info, 5) orelse 0),
        @floatCast(argToF64(info, 6) orelse 0),
    ) orelse {
        setReturnNull(info);
        return;
    };
    snapshot[0] = @floatCast(@as(f64, @floatFromInt(nowNs() - t0)) / 1000.0);
    setReturnF32Buffer(info, snapshot);
}

fn hostCameraOcclusionHits(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs();
    const snapshot = game_physics.cameraOcclusionConfiguredHits(
        @floatCast(argToF64(info, 0) orelse 0),
        @floatCast(argToF64(info, 1) orelse 0),
        @floatCast(argToF64(info, 2) orelse 0),
        @floatCast(argToF64(info, 3) orelse 0),
        @floatCast(argToF64(info, 4) orelse 0),
        @floatCast(argToF64(info, 5) orelse 0),
        @floatCast(argToF64(info, 6) orelse 0),
        @intFromFloat(@max(0.0, argToF64(info, 7) orelse 0)),
    ) orelse {
        setReturnNull(info);
        return;
    };
    snapshot[0] = @floatCast(@as(f64, @floatFromInt(nowNs() - t0)) / 1000.0);
    setReturnF32Buffer(info, snapshot);
}

// __hmsc_register_heightfield(id, originX, originZ, cell, cols, rows, baseY,
// walkCos, samplesFloat32Array, yaw?, pivotX?, pivotZ?) — upload/replace a
// terrain grid by id. Called once when a landform loads; the step samples it
// every frame after that.
fn hostRegisterHeightfield(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    defer setReturnNull(info);
    const id_f = argToF64(info, 0) orelse return;
    const bytes = argBytes(info, 8) orelse return;
    // Optional rotation (args after the samples array): yaw radians + pivot. A
    // mountain/hill/painted field passes 0s (axis-aligned); a rotated building's
    // floor passes its yaw + centre so the collider turns with the model.
    _ = game_physics.registerHeightfield(.{
        .id = @intFromFloat(@max(0.0, id_f)),
        .origin_x = @floatCast(argToF64(info, 1) orelse 0),
        .origin_z = @floatCast(argToF64(info, 2) orelse 0),
        .cell = @floatCast(argToF64(info, 3) orelse 1),
        .cols = @intFromFloat(@max(0.0, argToF64(info, 4) orelse 0)),
        .rows = @intFromFloat(@max(0.0, argToF64(info, 5) orelse 0)),
        .base_y = @floatCast(argToF64(info, 6) orelse 0),
        .walk_cos = @floatCast(argToF64(info, 7) orelse 1),
        .yaw = @floatCast(argToF64(info, 9) orelse 0),
        .pivot_x = @floatCast(argToF64(info, 10) orelse 0),
        .pivot_z = @floatCast(argToF64(info, 11) orelse 0),
    }, bytes);
}

// __hmsc_clear_heightfields() — drop all registered terrain (world reset /
// cart swap). TS re-registers what the new world needs.
fn hostClearHeightfields(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_physics.clearHeightfields();
    setReturnNull(info);
}

// __hmsc_spike_trace(on) — flip the engine's host-side per-frame spike logger.
// Driven by `gv_perflog 2` so the host's ground-truth frame phases print
// alongside the JS perfWatch report for cross-checking.
fn hostSpikeTrace(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    @import("engine.zig").g_host_spike_trace = argToBool(info, 0) orelse false;
    setReturnNull(info);
}

pub fn registerGamePhysics(_: anytype) void {
    v8_runtime.registerHostFn("__hmsc_physics_step", hostPhysicsStep);
    v8_runtime.registerHostFn("__hmsc_register_heightfield", hostRegisterHeightfield);
    v8_runtime.registerHostFn("__hmsc_clear_heightfields", hostClearHeightfields);
    v8_runtime.registerHostFn("__hmsc_spike_trace", hostSpikeTrace);
    // Honest aliases (V18) — same callbacks, capability-named.
    v8_runtime.registerHostFn("__game_physics_step", hostPhysicsStep);
    v8_runtime.registerHostFn("__game_physics_step_into", hostPhysicsStepInto);
    v8_runtime.registerHostFn("__game_physics_register_heightfield", hostRegisterHeightfield);
    v8_runtime.registerHostFn("__game_physics_clear_heightfields", hostClearHeightfields);
    v8_runtime.registerHostFn("__game_physics_camera_occlusion", hostCameraOcclusion);
    v8_runtime.registerHostFn("__game_physics_camera_occlusion_configure", hostCameraOcclusionConfigure);
    v8_runtime.registerHostFn("__game_physics_camera_occlusion_distance", hostCameraOcclusionDistance);
    v8_runtime.registerHostFn("__game_physics_camera_occlusion_hit", hostCameraOcclusionHit);
    v8_runtime.registerHostFn("__game_physics_camera_occlusion_hits", hostCameraOcclusionHits);
}
