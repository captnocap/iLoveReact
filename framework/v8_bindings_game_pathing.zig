//! Game pathing host bindings — thin V8 registrar over framework/game/
//! pathing.zig. All A*/lane-discipline/motion-plan logic lives in the module;
//! this file only parses V8 args and hands packed buffers across.
//!
//! Host fn names are preserved from the v8_bindings_pathing.zig era so
//! existing cart JS (runtime/pathing.ts importers) keeps working unchanged;
//! each gets an honest __game_pathing_* alias (V18) — the game door
//! (cart/hmsc-int/game/pathing.ts) speaks the honest names.
//!
//!   __path_set_grid(originX, originZ, cellSize, cols, rows, kindsU16) -> gen
//!   __path_update_cells(cellX, cellZ, w, h, kindsU16) -> gen
//!   __path_fill_rect(cellX, cellZ, w, h, kindIndex) -> gen
//!   __path_set_profile(profileId, laneOffset, againstFlow, crossFlow, costsF32)
//!   __path_set_flows(flowsU8) -> gen
//!   __path_find(profileId, sx, sz, gx, gz) -> Float32 ArrayBuffer
//!       [generation, count, x0, z0, ...] — host-owned scratch; consume or
//!       copy before the next __path_* call.
//!   __path_generation() -> number
//!
//! New surface (honest names only — no legacy callers exist):
//!   __game_pathing_set_kind_classes(classesU8) -> gen
//!       per-KIND class (0 plain, 1 junction, 2 crosswalk) — publishing this
//!       is the lane-discipline opt-in (trio snap + junction apexes).
//!   __game_pathing_plan(startTime, startSpeed, maxSpeed, accel, decel,
//!       minCornerSpeed, pointsF64) -> Float64 ArrayBuffer packed plan
//!       (see framework/game/pathing.zig for the layout) — the JS door
//!       unpacks it into the MotionPlan shape and samples in JS (closed
//!       form, zero bridge per frame). Host-owned scratch.
//!
//! Gated ingredient (V18): registered only when the metafile gate flips
//! -Dhas-game-pathing (sdk/dependency-registry.json `game-pathing`,
//! v8_ingredients.zig). A cart that never paths pays zero host fns.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const game_pathing = @import("game/pathing.zig");

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
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

fn setReturnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

fn setReturnF64(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn noopBackingStoreDeleter(_: ?*anyopaque, _: usize, _: ?*anyopaque) callconv(.c) void {}

fn setReturnBytesBuffer(info: v8.FunctionCallbackInfo, bytes: []u8) void {
    const iso = info.getIsolate();
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

// ── host fns ─────────────────────────────────────────────────────────────────

fn hostSetGrid(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 5) orelse {
        setReturnNull(info);
        return;
    };
    const kinds = std.mem.bytesAsSlice(u16, bytes[0 .. (bytes.len / 2) * 2]);
    const gen = game_pathing.setGrid(
        @floatCast(argToF64(info, 0) orelse 0),
        @floatCast(argToF64(info, 1) orelse 0),
        @floatCast(argToF64(info, 2) orelse 1),
        @trunc(@max(0.0, argToF64(info, 3) orelse 0)),
        @trunc(@max(0.0, argToF64(info, 4) orelse 0)),
        kinds,
    ) orelse {
        setReturnNull(info);
        return;
    };
    setReturnF64(info, gen);
}

fn hostUpdateCells(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const w: i64 = @trunc(@as(f64, argToF64(info, 2) orelse 0));
    const h: i64 = @trunc(@as(f64, argToF64(info, 3) orelse 0));
    const bytes = argBytes(info, 4) orelse {
        setReturnNull(info);
        return;
    };
    const kinds = std.mem.bytesAsSlice(u16, bytes[0 .. (bytes.len / 2) * 2]);
    if (w <= 0 or h <= 0 or kinds.len < @as(usize, @intCast(w * h))) {
        setReturnNull(info);
        return;
    }
    const gen = game_pathing.patchCells(
        @trunc(@as(f64, argToF64(info, 0) orelse 0)),
        @trunc(@as(f64, argToF64(info, 1) orelse 0)),
        w,
        h,
        kinds,
        0,
    );
    setReturnF64(info, gen);
}

fn hostFillRect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const kind_f = argToF64(info, 4) orelse {
        setReturnNull(info);
        return;
    };
    const gen = game_pathing.patchCells(
        @trunc(@as(f64, argToF64(info, 0) orelse 0)),
        @trunc(@as(f64, argToF64(info, 1) orelse 0)),
        @trunc(@as(f64, argToF64(info, 2) orelse 1)),
        @trunc(@as(f64, argToF64(info, 3) orelse 1)),
        null,
        @trunc(@max(0.0, @min(kind_f, @as(f64, game_pathing.MAX_KINDS - 1)))),
    );
    setReturnF64(info, gen);
}

fn hostSetProfile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id_f = argToF64(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const bytes = argBytes(info, 4) orelse {
        setReturnNull(info);
        return;
    };
    const costs = std.mem.bytesAsSlice(f32, bytes[0 .. (bytes.len / 4) * 4]);
    const ok = game_pathing.setProfile(
        @trunc(@max(0.0, id_f)),
        @floatCast(argToF64(info, 1) orelse 0),
        @floatCast(argToF64(info, 2) orelse 1),
        @floatCast(argToF64(info, 3) orelse 1),
        costs,
    );
    if (!ok) {
        setReturnNull(info);
        return;
    }
    setReturnF64(info, 1);
}

fn hostSetFlows(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    setReturnF64(info, game_pathing.setFlows(bytes));
}

fn hostSetKindClasses(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    setReturnF64(info, game_pathing.setKindClasses(bytes));
}

fn hostFind(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id: usize = @trunc(@max(0.0, argToF64(info, 0) orelse 0));
    const out = game_pathing.find(
        id,
        @floatCast(argToF64(info, 1) orelse 0),
        @floatCast(argToF64(info, 2) orelse 0),
        @floatCast(argToF64(info, 3) orelse 0),
        @floatCast(argToF64(info, 4) orelse 0),
    ) orelse {
        setReturnNull(info);
        return;
    };
    setReturnBytesBuffer(info, std.mem.sliceAsBytes(out));
}

fn hostGeneration(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, game_pathing.generation());
}

// Registrar-owned plan scratch — the same host-owned-buffer contract as
// __path_find: the JS door unpacks (copies) before the next call.
var g_plan_out: [game_pathing.MAX_PLAN_FLOATS]f64 = undefined;

fn hostPlan(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 6) orelse {
        setReturnNull(info);
        return;
    };
    const points = std.mem.bytesAsSlice(f64, bytes[0 .. (bytes.len / 8) * 8]);
    // The view may be unaligned (ArrayBuffer offset) — copy to aligned scratch.
    var pts: [game_pathing.MAX_PLAN_POINTS * 2]f64 = undefined;
    const n = @min(points.len, pts.len);
    for (0..n) |i| pts[i] = points[i];
    const prof = game_pathing.MotionProfile{
        .max_speed = argToF64(info, 2) orelse 1,
        .accel = argToF64(info, 3) orelse 1,
        .decel = argToF64(info, 4) orelse 1,
        .min_corner_speed = argToF64(info, 5) orelse 1.3,
    };
    const len = game_pathing.plan(
        pts[0..n],
        argToF64(info, 0) orelse 0,
        argToF64(info, 1) orelse 0,
        prof,
        &g_plan_out,
    ) orelse {
        setReturnNull(info);
        return;
    };
    setReturnBytesBuffer(info, std.mem.sliceAsBytes(g_plan_out[0..len]));
}

pub fn registerGamePathing(_: anytype) void {
    // Legacy names — existing cart JS keeps working unchanged.
    v8_runtime.registerHostFn("__path_set_grid", hostSetGrid);
    v8_runtime.registerHostFn("__path_update_cells", hostUpdateCells);
    v8_runtime.registerHostFn("__path_fill_rect", hostFillRect);
    v8_runtime.registerHostFn("__path_set_profile", hostSetProfile);
    v8_runtime.registerHostFn("__path_set_flows", hostSetFlows);
    v8_runtime.registerHostFn("__path_find", hostFind);
    v8_runtime.registerHostFn("__path_generation", hostGeneration);
    // Honest aliases (V18) — same callbacks, capability-named.
    v8_runtime.registerHostFn("__game_pathing_set_grid", hostSetGrid);
    v8_runtime.registerHostFn("__game_pathing_update_cells", hostUpdateCells);
    v8_runtime.registerHostFn("__game_pathing_fill_rect", hostFillRect);
    v8_runtime.registerHostFn("__game_pathing_set_profile", hostSetProfile);
    v8_runtime.registerHostFn("__game_pathing_set_flows", hostSetFlows);
    v8_runtime.registerHostFn("__game_pathing_find", hostFind);
    v8_runtime.registerHostFn("__game_pathing_generation", hostGeneration);
    // New surface — honest names only.
    v8_runtime.registerHostFn("__game_pathing_set_kind_classes", hostSetKindClasses);
    v8_runtime.registerHostFn("__game_pathing_plan", hostPlan);
}
