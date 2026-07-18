//! Game build host bindings — thin V8 registrar over framework/game/build.zig.
//! All placement logic lives in the module (ported verbatim from game/build/*.ts,
//! USER ASK req_2349); this file only parses V8 args, marshals packed f32
//! buffers, and returns results. It is what lets the iso world editor stop being
//! a cross-cart TypeScript consumer (req_2178): the editor calls __game_build_*
//! and the whole game no longer has to be imported to place a floor.
//!
//! Pieces cross the boundary as packed f32 keyed by CATALOG INDEX (0..
//! BUILD_CATALOG.len), never strings — the editor mirrors the tiny id/label list
//! (static data it may clone) and passes indices; the logic stays host-owned.
//!
//!   __game_build_raycast(inputFloat32Array) -> Float32 ArrayBuffer
//!     input : [ox,oy,oz, dx,dy,dz, maxDist, count, {catIdx,x,y,z,yaw}×count]
//!     output: [hostUs, hitFlag, pieceIndex, t, px,py,pz, nx,ny,nz]
//!             hitFlag 0 = clean miss (pieceIndex -1).
//!   __game_build_validate(catIdx, x, y, z, yaw, editIndex) -> f64
//!     editIndex < 0 ⇒ no edit; else an index into the WallEdit enum. Returns a
//!     bitmask: 0 = valid, 1 unknown_piece, 2 kind_accepts_no_edits,
//!     4 position_not_finite.
//!   __game_build_catalog_count() -> f64   (BUILD_CATALOG.len; palette bootstrap)
//!   __game_build_catalog_rows() -> JSON string of every BUILD_CATALOG row
//!     ({id,label,kind,material,theme,snap,w,h,d,r,g,b,opacity}) — the editor's
//!     build-piece palette/metadata readback (req_2563); buildCatalog.ts prefers
//!     it over its hand-mirror when the door is live.
//!
//! Gated ingredient (V18): registered only when the metafile gate flips
//! -Dhas-game-build (see sdk/dependency-registry.json `game-build` and
//! v8_ingredients.zig). A cart that never places a build piece pays zero bytes.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const build = @import("game/build.zig");

// ── V8 arg / return helpers (same shapes as v8_bindings_game_physics.zig) ─────

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

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
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

inline fn nowNs(info: v8.FunctionCallbackInfo) i64 {
    return @as(i64, @truncate(std.Io.Clock.now(.awake, v8_runtime.hostContext(info.getIsolate()).io).toNanoseconds()));
}

// ── marshaling ────────────────────────────────────────────────────────────────

const RAYCAST_HEADER: usize = 8; // ox,oy,oz, dx,dy,dz, maxDist, count
const PIECE_STRIDE: usize = 5; // catIdx, x, y, z, yaw
const MAX_PIECES: usize = 16384;

// Reusable scratch (host fns are single-threaded on the V8 isolate).
var scratch_pieces: [MAX_PIECES]build.PlacedBuildPiece = undefined;
var raycast_out: [10]f32 = undefined;

/// Reconstruct a PlacedBuildPiece from a packed [catIdx,x,y,z,yaw] block. The
/// catalog index is clamped into range so a stray value can't index out of bounds
/// (id left empty — placement math never reads it; the index carries identity).
fn pieceFromPacked(block: []const f32) build.PlacedBuildPiece {
    var idx: usize = 0;
    if (block[0] > 0) {
        const raw: usize = @intFromFloat(block[0]);
        idx = if (raw >= build.BUILD_CATALOG.len) build.BUILD_CATALOG.len - 1 else raw;
    }
    return .{
        .id = "",
        .pieceId = build.BUILD_CATALOG[idx].id,
        .x = block[1],
        .y = block[2],
        .z = block[3],
        .yawDegrees = block[4],
    };
}

fn hostRaycast(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const t0 = nowNs(info);
    const bytes = argBytes(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    if (bytes.len < RAYCAST_HEADER * @sizeOf(f32)) {
        setReturnNull(info);
        return;
    }
    const in_ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    const input = in_ptr[0 .. bytes.len / @sizeOf(f32)];

    var count: usize = @intFromFloat(@max(@as(f32, 0), input[7]));
    if (count > MAX_PIECES) count = MAX_PIECES;
    if (input.len < RAYCAST_HEADER + count * PIECE_STRIDE) {
        setReturnNull(info);
        return;
    }
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const base = RAYCAST_HEADER + i * PIECE_STRIDE;
        scratch_pieces[i] = pieceFromPacked(input[base .. base + PIECE_STRIDE]);
    }

    const ray = build.PieceRay{
        .origin = .{ .x = input[0], .y = input[1], .z = input[2] },
        .dir = .{ .x = input[3], .y = input[4], .z = input[5] },
    };
    const hit = build.raycastPieces(ray, scratch_pieces[0..count], input[6]);

    raycast_out[0] = @floatCast(@as(f64, @floatFromInt(nowNs(info) - t0)) / 1000.0);
    if (hit) |h| {
        raycast_out[1] = 1;
        raycast_out[2] = @floatFromInt(h.index);
        raycast_out[3] = h.t;
        raycast_out[4] = h.point.x;
        raycast_out[5] = h.point.y;
        raycast_out[6] = h.point.z;
        raycast_out[7] = h.normal.x;
        raycast_out[8] = h.normal.y;
        raycast_out[9] = h.normal.z;
    } else {
        raycast_out[1] = 0;
        raycast_out[2] = -1;
        var k: usize = 3;
        while (k < raycast_out.len) : (k += 1) raycast_out[k] = 0;
    }
    setReturnF32Buffer(info, raycast_out[0..]);
}

fn hostValidate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cat_f = argToF64(info, 0) orelse {
        setReturnF64(info, 1); // no piece → unknown_piece
        return;
    };
    var idx: usize = 0;
    if (cat_f > 0) {
        const raw: usize = @intFromFloat(cat_f);
        idx = if (raw >= build.BUILD_CATALOG.len) build.BUILD_CATALOG.len - 1 else raw;
    }
    const x: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const y: f32 = @floatCast(argToF64(info, 2) orelse 0);
    const z: f32 = @floatCast(argToF64(info, 3) orelse 0);
    const yaw: f32 = @floatCast(argToF64(info, 4) orelse 0);
    const edit_i = argToF64(info, 5) orelse -1;
    const edit: ?build.WallEdit = if (edit_i < 0) null else @enumFromInt(@as(usize, @intFromFloat(edit_i)));

    const placement = build.PlacedBuildPiece{
        .id = "",
        .pieceId = build.BUILD_CATALOG[idx].id,
        .x = x,
        .y = y,
        .z = z,
        .yawDegrees = yaw,
        .edit = edit,
    };
    const v = build.validatePlacement(placement);
    var bits: f64 = 0;
    if (v.unknown_piece) bits += 1;
    if (v.kind_accepts_no_edits) bits += 2;
    if (v.position_not_finite) bits += 4;
    setReturnF64(info, bits);
}

fn hostCatalogCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, @floatFromInt(build.BUILD_CATALOG.len));
}

// Representative display tint per material (0..1), verbatim from the editor's
// MATERIAL_LOOK (cart/hmsc-int/editors/build/pieceShapes.ts) so the readback and
// the JS fallback mirror agree. Gameplay truth stays in the tags.
inline fn u8f(v: u8) f32 {
    return @as(f32, @floatFromInt(v)) / 255.0;
}
fn materialRgb(m: build.BuildMaterial) [3]f32 {
    return switch (m) {
        .concrete => .{ u8f(0x9a), u8f(0xa3), u8f(0xad) },
        .brick => .{ u8f(0x8a), u8f(0x4a), u8f(0x3a) },
        .stucco => .{ u8f(0xd8), u8f(0xcd), u8f(0xb8) },
        .wood => .{ u8f(0x8a), u8f(0x6a), u8f(0x45) },
        .metal => .{ u8f(0x7d), u8f(0x85), u8f(0x8d) },
        .glass => .{ u8f(0xcf), u8f(0xe6), u8f(0xf2) },
        .chainlink => .{ u8f(0xb9), u8f(0xc2), u8f(0xc9) },
    };
}

fn materialOpacity(m: build.BuildMaterial) f32 {
    return switch (m) {
        .glass => 0.3,
        .chainlink => 0.45,
        else => 1.0,
    };
}

// __game_build_catalog_rows() -> JSON string. One object per BUILD_CATALOG row:
// { id, label, kind, material, theme, snap, w, h, d, r, g, b, opacity }. This is
// the source-of-truth readback the editor's buildCatalog.ts prefers over its
// hand-mirror (req_2563 Phase 0). Labels/ids carry no quotes/backslashes, so no
// JSON escaping is needed. Single-threaded isolate ⇒ a static scratch buffer is
// safe; V8 copies the bytes on initUtf8.
var catalog_json_buf: [24576]u8 = undefined;

fn hostCatalogRows(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var w = std.Io.Writer.fixed(&catalog_json_buf);
    w.writeByte('[') catch return setReturnString(info, "[]");
    for (build.BUILD_CATALOG, 0..) |e, i| {
        if (i != 0) w.writeByte(',') catch return setReturnString(info, "[]");
        const rgb = materialRgb(e.material);
        const edit_tag: []const u8 = if (e.defaultEdit) |ed| @tagName(ed) else "";
        w.print("{{\"id\":\"{s}\",\"label\":\"{s}\",\"kind\":\"{s}\",\"material\":\"{s}\",\"theme\":\"{s}\",\"snap\":\"{s}\",\"edit\":\"{s}\",\"w\":{d:.3},\"h\":{d:.3},\"d\":{d:.3},\"r\":{d:.4},\"g\":{d:.4},\"b\":{d:.4},\"opacity\":{d:.3}}}", .{
            e.id, // "id"
            e.label, // "label"
            @tagName(e.kind), // "kind"
            @tagName(e.material), // "material"
            @tagName(e.theme), // "theme"
            @tagName(e.snap), // "snap"
            edit_tag, // "edit" ("" = plain wall)
            e.size.widthMeters, // "w"
            e.size.heightMeters, // "h"
            e.size.depthMeters, // "d"
            rgb[0], // "r"
            rgb[1], // "g"
            rgb[2], // "b"
            materialOpacity(e.material), // "opacity"
        }) catch return setReturnString(info, "[]");
    }
    w.writeByte(']') catch return setReturnString(info, "[]");
    setReturnString(info, w.buffered());
}

pub fn registerGameBuild(_: anytype) void {
    v8_runtime.registerHostFn("__game_build_raycast", hostRaycast);
    v8_runtime.registerHostFn("__game_build_validate", hostValidate);
    v8_runtime.registerHostFn("__game_build_catalog_count", hostCatalogCount);
    v8_runtime.registerHostFn("__game_build_catalog_rows", hostCatalogRows);
}
