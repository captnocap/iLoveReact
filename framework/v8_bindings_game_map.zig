//! Game map-paint host bindings — thin V8 registrar over framework/game/map/
//! (chunks/stamps/engine). The 2D tile map painter's authoring engine, ported
//! from cart/hmsc-int (USER ASK req_2473); this file only parses V8 args and
//! marshals packed f32 buffers. All stroke/stamp/chunk logic is module-owned.
//!
//! The stroke doors exist for the React chrome and for tests; the per-dab hot
//! path is meant to route NATIVELY (loader input → engine.strokeMove in-process,
//! zero JS per event). UI-rate doors:
//!
//!   __map_reset()                              — drop the whole painting
//!   __map_grow_chunk(cx, cz) -> 0|1
//!   __map_chunk_count() -> f64
//!   __map_chunk_list() -> Float32 ArrayBuffer [maxCol, maxRow, count, cx0,cz0, …]
//!   __map_open_neighbors(cx, cz) -> Float32 ArrayBuffer [count, x0,z0, …]
//!   __map_set_tool(f32[18])                    — arm channel/tool/brush params
//!   __map_set_brush_gizmo(index)               — in-world brush gizmo + dab style
//!   __map_set_tile_bindings(f32 count×4 rows)  — the painted-material table (req_2693)
//!   __map_get_tile_bindings() -> Float32 ArrayBuffer [count, rows…]
//!   __map_stroke_begin(x, z) / __map_stroke_move(x, z)
//!   __map_stroke_end() -> Float32 ArrayBuffer [samples, stamps, touched, waterDry]
//!   __map_event_drain() -> Float32 ArrayBuffer [count, fixed event rows…]
//!   __map_save_file(path) / __map_load_file(path) -> 0|1
//!   __map_set_autosave_file(path) -> 0|1        — micro-save target (req_2765)
//!   __map_stats() -> Float32 ArrayBuffer [chunkCount, dirtyChunks]
//!   __map_read_height(cx, cz) / __map_read_water(cx, cz)
//!       -> Float32 ArrayBuffer of SAMPLE_CELLS (a copy; verification/readback)
//!   __map_read_cells(cx, cz, channel) -> Float32 ArrayBuffer of TILE_CELLS
//!       channel: 0 tiles · 1 zones · 2 flora grass · 3 flora tree · 4 flora bush
//!       · 5 materials (per-cell binding index)
//!
//! __map_set_tool packing (f32[18]):
//!   [0] channel  [1] mode  [2] terrainTool  [3] shape  [4] profile
//!   [5] radiusM  [6] centerZ
//!   [7] rampMin  [8] rampMax  [9] rampWide  [10] rampLong  [11] rampAngleDeg
//!   [12] smoothStrength  [13] kindIdx  [14] floraKindIdx  [15] floraLane
//!   [16] zoneIdx  [17] bindIdx (armed material binding; -1 = kind default)
//!
//! Gated ingredient (V18): registered only when the metafile gate flips
//! -Dhas-game-map (see sdk/dependency-registry.json `game-map` and
//! v8_ingredients.zig). A cart that never paints a map pays zero bytes.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const chunks = @import("game/map/chunks.zig");
const engine = @import("game/map/engine.zig");
const stamps = @import("game/map/stamps.zig");

// ── V8 arg / return helpers (same shapes as v8_bindings_game_build.zig) ───────

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

fn argChunkCoords(info: v8.FunctionCallbackInfo) ?[2]i32 {
    const cx = argToF64(info, 0) orelse return null;
    const cz = argToF64(info, 1) orelse return null;
    if (!std.math.isFinite(cx) or !std.math.isFinite(cz)) return null;
    return .{ @intFromFloat(cx), @intFromFloat(cz) };
}

fn argBool(info: v8.FunctionCallbackInfo, idx: u32, default: bool) bool {
    const raw = argToF64(info, idx) orelse return default;
    return std.math.isFinite(raw) and raw != 0;
}

// ── world / chunk doors ───────────────────────────────────────────────────────

fn hostReset(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.reset();
}

fn hostGrowChunk(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argChunkCoords(info) orelse {
        setReturnF64(info, 0);
        return;
    };
    const grew = chunks.growChunk(at[0], at[1]) != null;
    if (grew) {
        _ = engine.autosaveNow();
        if (argBool(info, 2, true)) engine.recordChunkGrow(at[0], at[1]);
    }
    setReturnF64(info, if (grew) 1 else 0);
}

fn hostChunkCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, @floatFromInt(chunks.chunkCount()));
}

// __map_chunk_list() -> Float32 ArrayBuffer [maxCol, maxRow, count, cx0,cz0, …]
// — every grown chunk's coords plus the address window, for the Add Chunk
// topology dialog (req_2703). UI-rate.
var chunk_list_out: [3 + chunks.SLOT_COUNT * 2]f32 = undefined;

fn hostChunkList(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    chunk_list_out[0] = @floatFromInt(chunks.MAX_CHUNK_COL);
    chunk_list_out[1] = @floatFromInt(chunks.MAX_CHUNK_ROW);
    var n: usize = 0;
    for (chunks.slots()) |maybe| {
        const ch = maybe orelse continue;
        chunk_list_out[3 + n * 2] = @floatFromInt(ch.cx);
        chunk_list_out[4 + n * 2] = @floatFromInt(ch.cz);
        n += 1;
    }
    chunk_list_out[2] = @floatFromInt(n);
    setReturnF32Buffer(info, chunk_list_out[0 .. 3 + n * 2]);
}

var neighbors_out: [9]f32 = undefined;

fn hostOpenNeighbors(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argChunkCoords(info) orelse {
        setReturnNull(info);
        return;
    };
    var open: [4][2]i32 = undefined;
    const n = chunks.openNeighbors(at[0], at[1], &open);
    neighbors_out[0] = @floatFromInt(n);
    for (open[0..n], 0..) |slot, i| {
        neighbors_out[1 + i * 2] = @floatFromInt(slot[0]);
        neighbors_out[2 + i * 2] = @floatFromInt(slot[1]);
    }
    setReturnF32Buffer(info, neighbors_out[0 .. 1 + n * 2]);
}

// ── tool + stroke doors ───────────────────────────────────────────────────────

// 18 floats since req_2693 ([17] = armed material binding); a 17-float pack
// from an older bundle still arms (bind_idx falls to the kind default).
const TOOL_FLOATS: usize = 18;
const TOOL_FLOATS_V1: usize = 17;

fn enumFromF32(comptime E: type, raw: f32) E {
    const count = @typeInfo(E).@"enum".fields.len;
    var v: usize = 0;
    if (raw > 0) {
        const cast: usize = @intFromFloat(raw);
        v = if (cast >= count) count - 1 else cast;
    }
    return @enumFromInt(v);
}

fn hostSetTool(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const bytes = argBytes(info, 0) orelse return;
    if (bytes.len < TOOL_FLOATS_V1 * @sizeOf(f32)) return;
    const in_ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    const p = in_ptr[0 .. bytes.len / @sizeOf(f32)];
    engine.setTool(.{
        .channel = enumFromF32(engine.Channel, p[0]),
        .mode = enumFromF32(engine.Mode, p[1]),
        .terrain_tool = enumFromF32(engine.TerrainTool, p[2]),
        .shape = enumFromF32(stamps.BrushShape, p[3]),
        .profile = enumFromF32(stamps.BrushProfile, p[4]),
        .radius_m = p[5],
        .center_z = p[6],
        .ramp_min = p[7],
        .ramp_max = p[8],
        .ramp_wide = p[9],
        .ramp_long = p[10],
        .ramp_angle_deg = p[11],
        .smooth_strength = p[12],
        .kind_idx = @intFromFloat(@max(-1, p[13])),
        .flora_kind_idx = @intFromFloat(@max(-1, p[14])),
        .flora_lane = @intFromFloat(@max(0, @min(2, p[15]))),
        .zone_idx = @intFromFloat(@max(-1, p[16])),
        .bind_idx = if (p.len >= TOOL_FLOATS) @intFromFloat(@max(-1, p[17])) else chunks.EMPTY_CELL,
    });
}

fn hostSetBrushGizmo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw = argToF64(info, 0) orelse 0;
    engine.setBrushGizmo(enumFromF32(engine.BrushGizmo, @floatCast(raw)));
}

// __map_set_ground_look(wgslBody, paletteFloat32Array) — the tile channel's
// shader contract: a WGSL body defining hf_ground_rgb(uv) reading the D stream,
// plus the kind palette (rgb triples in legend order). Content, pushed once at
// UI rate; the engine copies both.
fn argF32Slice(info: v8.FunctionCallbackInfo, idx: u32) []const f32 {
    const bytes = argBytes(info, idx) orelse return &[_]f32{};
    if (bytes.len < @sizeOf(f32)) return &[_]f32{};
    const ptr: [*]const f32 = @ptrCast(@alignCast(bytes.ptr));
    return ptr[0 .. bytes.len / @sizeOf(f32)];
}

fn hostSetGroundLook(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const formula = argStringAlloc(alloc, info, 0) orelse &[_]u8{};
    defer if (formula.len > 0) alloc.free(formula);
    engine.setGroundLook(formula, argF32Slice(info, 1), argF32Slice(info, 2), argF32Slice(info, 3));
}

// __map_set_zone_palette(rgbFloat32Array) — zones are user-authored mid-map;
// re-pushing just their palette keeps the overlay tints in step with the list.
fn hostSetZonePalette(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.setZonePalette(argF32Slice(info, 0));
}

// __map_set_tile_bindings(f32 rows) — the painted-material table (req_2693):
// count×4 opaque rows the cart's formula dispatches on ([materialId,
// boardIndex, variant, jointFlag] for the editor catalog). Pure DATA — arming
// or editing a binding re-encodes chunk D streams, never rebuilds the shader.
fn hostSetTileBindings(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rows = argF32Slice(info, 0);
    engine.setTileBindings(rows);
    if (argBool(info, 1, false)) engine.recordTileBindings(rows.len / engine.BINDING_FLOATS);
}

// __map_get_tile_bindings() -> Float32 ArrayBuffer [count, then count×4 rows] —
// the chrome's mirror after __map_load_file (the table persists in the RMAP).
var g_bindings_out: [1 + engine.MAX_TILE_BINDINGS * engine.BINDING_FLOATS]f32 = undefined;

fn hostGetTileBindings(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const rows = engine.tileBindings();
    g_bindings_out[0] = @floatFromInt(rows.len);
    for (rows, 0..) |row, i| {
        for (row, 0..) |v, j| g_bindings_out[1 + i * engine.BINDING_FLOATS + j] = v;
    }
    setReturnF32Buffer(info, g_bindings_out[0 .. 1 + rows.len * engine.BINDING_FLOATS]);
}

// __map_drop_zone(index) — deleting zone list entry `index`: unzone its cells
// and shift higher indices down so the grids track the shorter list.
fn hostDropZone(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const idx = argToF64(info, 0) orelse return;
    if (idx < 0 or !std.math.isFinite(idx)) return;
    const zone_idx: i16 = @intFromFloat(@min(idx, @as(f64, @floatFromInt(std.math.maxInt(i16)))));
    chunks.dropZoneIndex(zone_idx);
    _ = engine.autosaveNow();
    if (argBool(info, 1, true)) engine.recordZoneDrop(@intCast(zone_idx));
}

// __map_set_flora_specs(f32 triples) — per flora kind [spec, count, chance]
// in legend order (req_2497): the population contract the loader's LIVE
// foliage preview grows painted cells with. Content, pushed with the look.
fn hostSetFloraSpecs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.setFloraSpecs(argF32Slice(info, 0));
}

// ── road doors (ROADSTROKE-0610: click-authored recipes, host-compiled) ───────
// Clicks land through the stroke doors / native input while channel=road; these
// manage the draft lifecycle + the content mapping.

// __map_road_set_profile(lanesF, lanesB, sidewalks) — the draft profile.
fn hostRoadSetProfile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.setRoadProfile(.{
        .lanesF = @intFromFloat(@max(0, argToF64(info, 0) orelse 1)),
        .lanesB = @intFromFloat(@max(0, argToF64(info, 1) orelse 1)),
        .sidewalks = (argToF64(info, 2) orelse 1) != 0,
    });
}

// __map_road_set_kinds(f32[8]) — RoadCellKind → content tile index, in enum
// order (laneNorth, laneSouth, laneEast, laneWest, median, sidewalk, junction,
// crosswalk).
fn hostRoadSetKinds(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const vals = argF32Slice(info, 0);
    if (vals.len < engine.roads.ROAD_CELL_KIND_COUNT) return;
    var indices: [engine.roads.ROAD_CELL_KIND_COUNT]i16 = undefined;
    for (&indices, 0..) |*slot, i| slot.* = @intFromFloat(@max(-1, vals[i]));
    engine.roads.setKindIndices(indices);
}

// __map_road_commit() -> stroke id (0 = draft too short / table full — LOUD).
fn hostRoadCommit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, @floatFromInt(engine.roadCommit() orelse 0));
}

fn hostRoadCancel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.roadCancel();
}

// __map_road_delete(id) -> 0|1
fn hostRoadDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToF64(info, 0) orelse 0;
    if (id <= 0 or !std.math.isFinite(id)) {
        setReturnF64(info, 0);
        return;
    }
    setReturnF64(info, if (engine.roadDelete(@intFromFloat(id))) 1 else 0);
}

// __map_road_stats() -> [strokeCount, draftPoints, planTruncated]
var road_stats_out: [3]f32 = undefined;

fn hostRoadStats(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    road_stats_out[0] = @floatFromInt(engine.roads.strokeCount());
    road_stats_out[1] = @floatFromInt(engine.roads.draftPointCount());
    road_stats_out[2] = if (engine.road_plan_truncated) 1 else 0;
    setReturnF32Buffer(info, road_stats_out[0..]);
}

fn argWorldPoint(info: v8.FunctionCallbackInfo) ?[2]f32 {
    const x = argToF64(info, 0) orelse return null;
    const z = argToF64(info, 1) orelse return null;
    if (!std.math.isFinite(x) or !std.math.isFinite(z)) return null;
    return .{ @floatCast(x), @floatCast(z) };
}

fn hostStrokeBegin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argWorldPoint(info) orelse return;
    engine.strokeBegin(at[0], at[1]);
}

fn hostStrokeMove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argWorldPoint(info) orelse return;
    engine.strokeMove(at[0], at[1]);
}

var stroke_out: [4]f32 = undefined;

fn hostStrokeEnd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const stats = engine.strokeEnd();
    stroke_out[0] = @floatFromInt(stats.samples);
    stroke_out[1] = @floatFromInt(stats.stamps);
    stroke_out[2] = @floatFromInt(stats.touched);
    stroke_out[3] = if (stats.water_dry) 1 else 0;
    setReturnF32Buffer(info, stroke_out[0..]);
}

const MAP_EVENT_FLOATS: usize = 32;
var map_event_buf: [engine.AUTHORING_EVENT_CAP]engine.AuthoringEvent = undefined;
var map_event_out: [1 + engine.AUTHORING_EVENT_CAP * MAP_EVENT_FLOATS]f32 = undefined;

fn eventKind(e: engine.AuthoringEvent) f32 {
    return @floatFromInt(@intFromEnum(e.kind));
}

fn hostEventDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const n = engine.drainAuthoringEvents(map_event_buf[0..]);
    map_event_out[0] = @floatFromInt(n);
    for (map_event_buf[0..n], 0..) |e, i| {
        const base = 1 + i * MAP_EVENT_FLOATS;
        map_event_out[base + 0] = eventKind(e);
        map_event_out[base + 1] = @floatFromInt(@intFromEnum(e.tool.channel));
        map_event_out[base + 2] = @floatFromInt(@intFromEnum(e.tool.mode));
        map_event_out[base + 3] = @floatFromInt(@intFromEnum(e.tool.terrain_tool));
        map_event_out[base + 4] = @floatFromInt(@intFromEnum(e.tool.shape));
        map_event_out[base + 5] = @floatFromInt(@intFromEnum(e.tool.profile));
        map_event_out[base + 6] = e.tool.radius_m;
        map_event_out[base + 7] = e.tool.center_z;
        map_event_out[base + 8] = e.tool.ramp_min;
        map_event_out[base + 9] = e.tool.ramp_max;
        map_event_out[base + 10] = e.tool.ramp_wide;
        map_event_out[base + 11] = e.tool.ramp_long;
        map_event_out[base + 12] = e.tool.ramp_angle_deg;
        map_event_out[base + 13] = e.tool.smooth_strength;
        map_event_out[base + 14] = @floatFromInt(e.tool.kind_idx);
        map_event_out[base + 15] = @floatFromInt(e.tool.bind_idx);
        map_event_out[base + 16] = @floatFromInt(e.tool.flora_kind_idx);
        map_event_out[base + 17] = @floatFromInt(e.tool.flora_lane);
        map_event_out[base + 18] = @floatFromInt(e.tool.zone_idx);
        map_event_out[base + 19] = e.start_x;
        map_event_out[base + 20] = e.start_z;
        map_event_out[base + 21] = e.end_x;
        map_event_out[base + 22] = e.end_z;
        map_event_out[base + 23] = @floatFromInt(e.stats.samples);
        map_event_out[base + 24] = @floatFromInt(e.stats.stamps);
        map_event_out[base + 25] = @floatFromInt(e.stats.touched);
        map_event_out[base + 26] = if (e.stats.water_dry) 1 else 0;
        map_event_out[base + 27] = e.duration_ms;
        map_event_out[base + 28] = @floatFromInt(e.id);
        map_event_out[base + 29] = @floatFromInt(e.aux_a);
        map_event_out[base + 30] = @floatFromInt(e.aux_b);
        map_event_out[base + 31] = @floatFromInt(e.dropped_before);
    }
    setReturnF32Buffer(info, map_event_out[0 .. 1 + n * MAP_EVENT_FLOATS]);
}

var stats_out: [2]f32 = undefined;

fn hostStats(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    stats_out[0] = @floatFromInt(chunks.chunkCount());
    stats_out[1] = @floatFromInt(engine.dirtyChunkCount());
    setReturnF32Buffer(info, stats_out[0..]);
}

// ── persistence doors: the blob never crosses the bridge — the host writes/
// reads the file directly (RLE per store.zig; roads persist as recipes and
// restamp on load).

// __map_save_file(path) -> 0|1
fn hostSaveFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(path);
    const buf = alloc.alloc(u8, engine.saveSizeUpperBound()) catch {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(buf);
    const n = engine.saveMap(buf);
    if (n == 0) {
        setReturnF64(info, 0);
        return;
    }
    if (std.fs.path.dirname(path)) |dir| std.fs.cwd().makePath(dir) catch {};
    std.fs.cwd().writeFile(.{ .sub_path = path, .data = buf[0..n] }) catch {
        setReturnF64(info, 0);
        return;
    };
    setReturnF64(info, 1);
}

// __map_set_autosave_file(path) -> 0|1 — register the painting's micro-save
// target (SESSIONSAVE req_2765): every mutating gesture from here on rewrites
// this file atomically host-side. Empty string disables.
fn hostSetAutosaveFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(path);
    engine.setAutosaveFile(path);
    setReturnF64(info, 1);
}

const MAX_MAP_FILE_BYTES: usize = 512 * 1024 * 1024;

// __map_load_file(path) -> 0|1 (0 = missing/malformed; the world is untouched
// on a missing file, cleared on a malformed one — store.load's LOUD contract)
fn hostLoadFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(path);
    const bytes = std.fs.cwd().readFileAlloc(alloc, path, MAX_MAP_FILE_BYTES) catch {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(bytes);
    setReturnF64(info, if (engine.loadMap(bytes)) 1 else 0);
}

// ── readback doors (verification / chrome, UI-rate only) ──────────────────────

var sample_scratch: [chunks.SAMPLE_CELLS]f32 = undefined;
var cell_scratch: [chunks.TILE_CELLS]f32 = undefined;

fn hostReadHeight(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    readSampleField(info_c, .height);
}

fn hostReadWater(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    readSampleField(info_c, .water);
}

fn readSampleField(info_c: ?*const v8.c.FunctionCallbackInfo, which: enum { height, water }) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argChunkCoords(info) orelse {
        setReturnNull(info);
        return;
    };
    const chunk = chunks.chunkAt(at[0], at[1]) orelse {
        setReturnNull(info);
        return;
    };
    const src = switch (which) {
        .height => chunk.height[0..],
        .water => chunk.water[0..],
    };
    @memcpy(sample_scratch[0..], src);
    setReturnF32Buffer(info, sample_scratch[0..]);
}

fn hostReadCells(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argChunkCoords(info) orelse {
        setReturnNull(info);
        return;
    };
    const chunk = chunks.chunkAt(at[0], at[1]) orelse {
        setReturnNull(info);
        return;
    };
    const channel = argToF64(info, 2) orelse 0;
    const src: []const i16 = switch (@as(u8, if (channel > 0 and channel < 6) @intFromFloat(channel) else 0)) {
        1 => chunk.zones[0..],
        2 => chunk.flora[0][0..],
        3 => chunk.flora[1][0..],
        4 => chunk.flora[2][0..],
        5 => chunk.materials[0..],
        else => chunk.tiles[0..],
    };
    for (src, 0..) |v, i| cell_scratch[i] = @floatFromInt(v);
    setReturnF32Buffer(info, cell_scratch[0..]);
}

pub fn registerGameMap(_: anytype) void {
    v8_runtime.registerHostFn("__map_reset", hostReset);
    v8_runtime.registerHostFn("__map_grow_chunk", hostGrowChunk);
    v8_runtime.registerHostFn("__map_chunk_count", hostChunkCount);
    v8_runtime.registerHostFn("__map_chunk_list", hostChunkList);
    v8_runtime.registerHostFn("__map_open_neighbors", hostOpenNeighbors);
    v8_runtime.registerHostFn("__map_set_tool", hostSetTool);
    v8_runtime.registerHostFn("__map_set_brush_gizmo", hostSetBrushGizmo);
    v8_runtime.registerHostFn("__map_set_ground_look", hostSetGroundLook);
    v8_runtime.registerHostFn("__map_set_tile_bindings", hostSetTileBindings);
    v8_runtime.registerHostFn("__map_get_tile_bindings", hostGetTileBindings);
    v8_runtime.registerHostFn("__map_set_zone_palette", hostSetZonePalette);
    v8_runtime.registerHostFn("__map_drop_zone", hostDropZone);
    v8_runtime.registerHostFn("__map_set_flora_specs", hostSetFloraSpecs);
    v8_runtime.registerHostFn("__map_road_set_profile", hostRoadSetProfile);
    v8_runtime.registerHostFn("__map_road_set_kinds", hostRoadSetKinds);
    v8_runtime.registerHostFn("__map_road_commit", hostRoadCommit);
    v8_runtime.registerHostFn("__map_road_cancel", hostRoadCancel);
    v8_runtime.registerHostFn("__map_road_delete", hostRoadDelete);
    v8_runtime.registerHostFn("__map_road_stats", hostRoadStats);
    v8_runtime.registerHostFn("__map_save_file", hostSaveFile);
    v8_runtime.registerHostFn("__map_set_autosave_file", hostSetAutosaveFile);
    v8_runtime.registerHostFn("__map_load_file", hostLoadFile);
    v8_runtime.registerHostFn("__map_stroke_begin", hostStrokeBegin);
    v8_runtime.registerHostFn("__map_stroke_move", hostStrokeMove);
    v8_runtime.registerHostFn("__map_stroke_end", hostStrokeEnd);
    v8_runtime.registerHostFn("__map_event_drain", hostEventDrain);
    v8_runtime.registerHostFn("__map_stats", hostStats);
    v8_runtime.registerHostFn("__map_read_height", hostReadHeight);
    v8_runtime.registerHostFn("__map_read_water", hostReadWater);
    v8_runtime.registerHostFn("__map_read_cells", hostReadCells);
}
