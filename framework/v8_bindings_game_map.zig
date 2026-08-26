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
//!   __map_install_generated(chunksF32, pathsF32)
//!       -> Float32 ArrayBuffer [ok, error, chunks, paths, roads, rails]
//!   __map_generated_begin(manifestF32, pathsF32) -> same result
//!   __map_generated_chunk(chunkRecordF32)         -> same result
//!   __map_generated_commit() / __map_generated_abort() -> same result
//!   __map_set_tool(f32[19])                    — arm channel/tool/brush params
//!   __map_set_brush_gizmo(index)               — in-world brush gizmo + dab style
//!   __map_set_tile_bindings(f32 count×4 rows)  — the painted-material table (req_2693)
//!   __map_get_tile_bindings() -> Float32 ArrayBuffer [count, rows…]
//!   __map_stroke_begin(x, z) / __map_stroke_move(x, z)
//!   __map_stroke_end() -> Float32 ArrayBuffer [samples, stamps, touched, waterDry]
//!   __map_event_drain() -> Float32 ArrayBuffer [count, fixed event rows…]
//!   __map_save_file(path) / __map_load_file(path) -> 0|1
//!   __map_prepare_file(path) -> requestId
//!   __map_prepare_status(requestId) -> Float32 ArrayBuffer [state,id,chunks]
//!   __map_commit_prepared(requestId,path) -> 0|1
//!   __map_inspect_file(path) -> Float32 ArrayBuffer [version, chunkCount]
//!   __map_path_snapshot() -> Float32 ArrayBuffer [version, pathCount, path records...]
//!   __map_path_sample(pathId, distanceM) -> Float32 ArrayBuffer
//!       [version,pathId,distance,total,x,y,z,tangentX,tangentY,tangentZ]
//!   __map_set_autosave_file(path) -> 0|1        — micro-save target (req_2765)
//!   __map_stats() -> Float32 ArrayBuffer [chunkCount, dirtyChunks]
//!   __map_height_at(worldX, worldZ) -> f64       — canonical terrain sample
//!   __map_render_height_max(minX,minZ,maxX,maxZ) -> f64|null
//!       — highest point on the loader's rendered/collider terrain mirror
//!   __map_read_height(cx, cz) / __map_read_water(cx, cz)
//!       -> Float32 ArrayBuffer of SAMPLE_CELLS (a copy; verification/readback)
//!   __map_read_floor(cx, cz) -> Float32 ArrayBuffer of FLOOR_CELLS (121x121)
//!       — the RENDERED floor mirror: what the ground pipeline draws and the
//!         physics heightfields collide against. Compile/export reads this.
//!   __map_ground_formula() -> string|null
//!   __map_read_ground_data(cx, cz) -> Float32 ArrayBuffer|null
//!       — exact native formula stream consumed by compiled heightfields
//!   __map_read_cells(cx, cz, channel) -> Float32 ArrayBuffer of TILE_CELLS
//!       channel: 0 tiles · 1 zones · 2 flora grass · 3 flora tree · 4 flora bush
//!       · 5 materials · 6/7/8 flora density for grass/tree/bush
//!
//! __map_set_tool packing (f32[19]):
//!   [0] channel  [1] mode  [2] terrainTool  [3] shape  [4] profile
//!   [5] radiusM  [6] centerZ
//!   [7] rampMin  [8] rampMax  [9] rampWide  [10] rampLong  [11] rampAngleDeg
//!   [12] smoothStrength  [13] kindIdx  [14] floraKindIdx  [15] floraLane
//!   [16] zoneIdx  [17] bindIdx (armed material binding; -1 = kind default)
//!   [18] floraDensity (0..1, quantized into each painted cell)
//!
//! __map_install_generated packing (version 1):
//!   chunks [version, count, stride, 58081, 14400], then fixed records
//!     [cx, cz, height×58081, water×58081, tiles×14400, zones×14400,
//!      floraGrass×14400, floraTree×14400, floraBush×14400]
//!   paths [version, count], then variable records
//!     [kind, lanesF, lanesB, sidewalks01, tracks, curveRadiusM, speedKph,
//!      pointCount, centeredWorldX, centeredWorldZ, elevationM, ...]
//!   streaming manifest [version, count, cx0, cz0, cx1, cz1, ...]
//!   streaming chunk is one headerless fixed chunk record in the bulk order
//!
//! Gated ingredient (V18): registered only when the metafile gate flips
//! -Dhas-game-map (see sdk/dependency-registry.json `game-map` and
//! v8_ingredients.zig). A cart that never paints a map pays zero bytes.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("dev_modules/v8_runtime_api.zig");
const chunks = @import("game/map/chunks.zig");
const engine = @import("game/map/engine.zig");
const prepare_slot = @import("game/map/prepare_slot.zig");
const stamps = @import("game/map/stamps.zig");

const MapPrepareState = prepare_slot.State;
const MapPrepareJob = struct { id: u32, path: []u8 };
var map_prepare_tasks: std.Io.Group = .init;
var map_prepare_mutex: std.Io.Mutex = .init;
var map_prepare: prepare_slot.Slot(engine.PreparedMap) = .{};

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
    return .{ @trunc(cx), @trunc(cz) };
}

fn argBool(info: v8.FunctionCallbackInfo, idx: u32, default: bool) bool {
    const raw = argToF64(info, idx) orelse return default;
    return std.math.isFinite(raw) and raw != 0;
}

fn argRequestId(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const raw = argToF64(info, idx) orelse return null;
    if (!std.math.isFinite(raw) or raw < 1 or raw > prepare_slot.MAX_REQUEST_ID or @trunc(raw) != raw) return null;
    return @intFromFloat(raw);
}

// ── world / chunk doors ───────────────────────────────────────────────────────

fn hostReset(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.reset();
}

fn hostGrowChunk(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const at = argChunkCoords(info) orelse {
        setReturnF64(info, 0);
        return;
    };
    const record = argBool(info, 2, true);
    const before = chunks.chunkCount();
    if (record) engine.beginMapHistory(.chunk_grow);
    const grew = chunks.growChunk(at[0], at[1]) != null;
    const changed = chunks.chunkCount() > before;
    if (record) engine.commitMapHistory(changed);
    if (grew) {
        _ = engine.autosaveNow(io);
        if (record and changed) engine.recordChunkGrow(at[0], at[1]);
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

// __map_install_generated(chunkRows, pathRows) — one strict bulk replacement
// door for procedural authoring. generated.zig validates both complete f32
// wires before engine.reset, copies canonical chunk channels, commits semantic
// transport paths, and rejects any incomplete road plan. The caller saves and
// rebinds the new named document explicitly after success.
var generated_install_out: [6]f32 = undefined;

fn setGeneratedInstallResult(info: v8.FunctionCallbackInfo, result: engine.generated.Result) void {
    generated_install_out[0] = if (result.ok) 1 else 0;
    generated_install_out[1] = @intFromEnum(result.failure);
    generated_install_out[2] = @floatFromInt(result.stats.chunks);
    generated_install_out[3] = @floatFromInt(result.stats.paths);
    generated_install_out[4] = @floatFromInt(result.stats.roads);
    generated_install_out[5] = @floatFromInt(result.stats.rails);
    setReturnF32Buffer(info, generated_install_out[0..]);
}

fn hostInstallGenerated(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setGeneratedInstallResult(info, engine.installGeneratedMap(argF32Slice(info, 0), argF32Slice(info, 1)));
}

fn hostGeneratedBegin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setGeneratedInstallResult(info, engine.generatedInstallBegin(argF32Slice(info, 0), argF32Slice(info, 1)));
}

fn hostGeneratedChunk(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setGeneratedInstallResult(info, engine.generatedInstallChunk(argF32Slice(info, 0)));
}

fn hostGeneratedCommit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setGeneratedInstallResult(info, engine.generatedInstallCommit());
}

fn hostGeneratedAbort(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setGeneratedInstallResult(info, engine.generatedInstallAbort());
}

// ── tool + stroke doors ───────────────────────────────────────────────────────

// 19 floats: per-stroke flora density appended without moving prior fields.
// Older 17/18-float bundles still arm with their historical defaults.
const TOOL_FLOATS: usize = 19;
const TOOL_FLOATS_V2: usize = 18;
const TOOL_FLOATS_V1: usize = 17;

fn enumFromF32(comptime E: type, raw: f32) E {
    const count = @typeInfo(E).@"enum".fields.len;
    var v: usize = 0;
    if (raw > 0) {
        const cast: usize = @trunc(raw);
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
        .kind_idx = @trunc(@max(-1, p[13])),
        .flora_kind_idx = @trunc(@max(-1, p[14])),
        .flora_lane = @trunc(@max(0, @min(2, p[15]))),
        .zone_idx = @trunc(@max(-1, p[16])),
        .bind_idx = if (p.len >= TOOL_FLOATS_V2) @trunc(@max(-1, p[17])) else chunks.EMPTY_CELL,
        .flora_density = if (p.len >= TOOL_FLOATS and std.math.isFinite(p[18]))
            @intFromFloat(@round(@max(0, @min(1, p[18])) * chunks.FLORA_DENSITY_FULL))
        else
            chunks.FLORA_DENSITY_FULL,
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
    if (bytes.len < @sizeOf(f32) or bytes.len % @sizeOf(f32) != 0) return &[_]f32{};
    if (@intFromPtr(bytes.ptr) % @alignOf(f32) != 0) return &[_]f32{};
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
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const rows = argF32Slice(info, 0);
    const record = argBool(info, 1, false);
    if (record) engine.beginMapHistory(.tile_bindings);
    engine.setTileBindings(io, rows);
    if (record) {
        engine.commitMapHistory(true);
        engine.recordTileBindings(rows.len / engine.BINDING_FLOATS);
    }
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
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const idx = argToF64(info, 0) orelse return;
    if (idx < 0 or !std.math.isFinite(idx)) return;
    const zone_idx: i16 = @trunc(@min(idx, @as(f64, std.math.maxInt(i16))));
    const record = argBool(info, 1, true);
    if (record) engine.beginMapHistory(.zone_drop);
    chunks.dropZoneIndex(zone_idx);
    if (record) engine.commitMapHistory(true);
    _ = engine.autosaveNow(io);
    if (record) engine.recordZoneDrop(@intCast(zone_idx));
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
        .lanesF = @trunc(@max(0.0, argToF64(info, 0) orelse 1.0)),
        .lanesB = @trunc(@max(0.0, argToF64(info, 1) orelse 1.0)),
        .sidewalks = (argToF64(info, 2) orelse 1) != 0,
    });
}

// __map_path_set_profile(kind, lanesF, lanesB, sidewalks, tracks, curveRadius)
// — the one strict road/rail authoring boundary. Kind: 0 road, 1 light rail,
// 2 railway. Inapplicable fields are ignored by the tagged host profile.
fn hostPathSetProfile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw_kind = argToF64(info, 0) orelse 0;
    const kind_index: u8 = @trunc(std.math.clamp(raw_kind, 0, 2));
    const kind: engine.transport.Kind = @enumFromInt(kind_index);
    const tracks: i32 = @trunc(@max(1.0, argToF64(info, 4) orelse 1.0));
    const profile: engine.transport.Profile = switch (kind) {
        .road => .{ .road = .{
            .lanesF = @trunc(@max(0.0, argToF64(info, 1) orelse 1.0)),
            .lanesB = @trunc(@max(0.0, argToF64(info, 2) orelse 1.0)),
            .sidewalks = (argToF64(info, 3) orelse 1) != 0,
        } },
        .light_rail => .{ .light_rail = .{ .tracks = tracks } },
        .railway => .{ .railway = .{ .tracks = tracks } },
    };
    const curve_radius: f32 = @floatCast(argToF64(info, 5) orelse engine.transport.defaultCurveRadius(kind));
    engine.setPathProfile(profile, curve_radius);
}

// __map_path_set_tool(0 draw | 1 TC stop)
fn hostPathSetTool(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw = argToF64(info, 0) orelse 0;
    const index: u8 = @trunc(std.math.clamp(raw, 0, 1));
    engine.setPathAuthoringTool(@enumFromInt(index));
}

// __map_path_set_level(signed storey) — one storey is transport.TUNING's 3 m.
fn hostPathSetLevel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw = argToF64(info, 0) orelse 0;
    if (!std.math.isFinite(raw)) return;
    engine.setPathLevel(@trunc(raw));
}

// __map_road_set_kinds(f32[8]) — RoadCellKind → content tile index, in enum
// order (laneNorth, laneSouth, laneEast, laneWest, median, sidewalk, junction,
// crosswalk).
fn hostRoadSetKinds(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const vals = argF32Slice(info, 0);
    if (vals.len < engine.roads.ROAD_CELL_KIND_COUNT) return;
    var indices: [engine.roads.ROAD_CELL_KIND_COUNT]i16 = undefined;
    for (&indices, 0..) |*slot, i| slot.* = @trunc(@max(-1, vals[i]));
    engine.roads.setKindIndices(indices);
}

// __map_road_commit() -> stroke id (0 = draft too short / table full — LOUD).
fn hostRoadCommit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    setReturnF64(info, engine.roadCommit(io) orelse 0);
}

fn hostPathCommit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostRoadCommit(info_c);
}

fn hostRoadCancel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.roadCancel();
}

fn hostPathCancel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostRoadCancel(info_c);
}

fn hostPathUndo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, if (engine.pathUndoPoint()) 1 else 0);
}

// __map_road_delete(id) -> 0|1
fn hostRoadDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const id = argToF64(info, 0) orelse 0;
    if (id <= 0 or !std.math.isFinite(id)) {
        setReturnF64(info, 0);
        return;
    }
    setReturnF64(info, if (engine.roadDelete(io, @trunc(id))) 1 else 0);
}

fn hostPathDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    hostRoadDelete(info_c);
}

fn hostPathControlDelete(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const id = argToF64(info, 0) orelse 0;
    if (id <= 0 or !std.math.isFinite(id)) {
        setReturnF64(info, 0);
        return;
    }
    setReturnF64(info, if (engine.pathControlDelete(io, @trunc(id))) 1 else 0);
}

// __map_road_stats() -> [strokeCount, draftPoints, planTruncated]
var road_stats_out: [3]f32 = undefined;

fn hostRoadStats(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    road_stats_out[0] = @floatFromInt(engine.roads.strokeCount());
    road_stats_out[1] = @floatFromInt(engine.roads.draftPointCount());
    road_stats_out[2] = if (engine.road_plan_truncated or engine.road_ribbon_truncated) 1 else 0;
    setReturnF32Buffer(info, road_stats_out[0..]);
}

// __map_path_stats() -> [paths, roads, rails, draftPoints, planTruncated,
// draftKind(-1 none), valid, invalidReason, minCurve(-1 straight), lastId,
// draftCurveRadius, maxGrade, controls, lastControlId, previewPathId,
// previewDistance, previewValid, authoringTool, level]. UI-rate diagnostics.
var path_stats_out: [19]f32 = undefined;
var path_snapshot_out: [engine.PATH_SNAPSHOT_MAX_FLOATS]f32 = undefined;
var path_sample_out: [10]f32 = undefined;

fn hostPathStats(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const validation = engine.transport.draftValidation();
    path_stats_out[0] = @floatFromInt(engine.transport.pathCount());
    path_stats_out[1] = @floatFromInt(engine.transport.countKind(.road));
    path_stats_out[2] = @floatFromInt(engine.transport.railCount());
    path_stats_out[3] = @floatFromInt(engine.transport.draftPointCount());
    path_stats_out[4] = if (engine.road_plan_truncated or engine.road_ribbon_truncated) 1 else 0;
    path_stats_out[5] = if (engine.transport.draftKind()) |kind| @intFromEnum(kind) else -1;
    path_stats_out[6] = if (validation.valid) 1 else 0;
    path_stats_out[7] = @intFromEnum(validation.reason);
    path_stats_out[8] = if (std.math.isFinite(validation.min_curve_m)) validation.min_curve_m else -1;
    path_stats_out[9] = @floatFromInt(engine.transport.lastPathId());
    path_stats_out[10] = engine.transport.draftCurveRadius();
    path_stats_out[11] = validation.max_grade;
    path_stats_out[12] = @floatFromInt(engine.transport.controlCount());
    path_stats_out[13] = @floatFromInt(engine.transport.lastControlId());
    if (engine.transport.controlPreview()) |preview| {
        path_stats_out[14] = @floatFromInt(preview.path_id);
        path_stats_out[15] = preview.distance_m;
        path_stats_out[16] = if (preview.valid) 1 else 0;
    } else {
        path_stats_out[14] = -1;
        path_stats_out[15] = -1;
        path_stats_out[16] = 0;
    }
    path_stats_out[17] = @intFromEnum(engine.pathAuthoringTool());
    path_stats_out[18] = @floatFromInt(engine.pathLevel());
    setReturnF32Buffer(info, path_stats_out[0..]);
}

// __map_path_snapshot() -> compact current authored transport recipes in world
// metres. See engine.writePathSnapshot for the bounded versioned wire.
fn hostPathSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const written = engine.writePathSnapshot(path_snapshot_out[0..]) orelse {
        setReturnNull(info);
        return;
    };
    setReturnF32Buffer(info, path_snapshot_out[0..written]);
}

fn hostPathSample(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw_path_id = argToF64(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const raw_distance = argToF64(info, 1) orelse 0;
    if (!std.math.isFinite(raw_path_id) or raw_path_id <= 0 or raw_path_id > std.math.maxInt(u32) or !std.math.isFinite(raw_distance)) {
        setReturnNull(info);
        return;
    }
    const sample = engine.samplePathForSnapshot(@intFromFloat(@trunc(raw_path_id)), @floatCast(raw_distance)) orelse {
        setReturnNull(info);
        return;
    };
    path_sample_out = .{
        1,
        @floatFromInt(sample.path_id),
        sample.distance_m,
        sample.total_m,
        sample.x,
        sample.y,
        sample.z,
        sample.tangent_x,
        sample.tangent_y,
        sample.tangent_z,
    };
    setReturnF32Buffer(info, path_sample_out[0..]);
}

// Dedicated Map Paint history. Ctrl+Z routing stays cart-side, but the journal
// and every restore live beside the native RMAP mutations they own.
var map_history_out: [4]f32 = undefined;
var map_history_result_out: [5]f32 = undefined;

fn hostMapHistory(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const stats = engine.mapHistoryStats();
    map_history_out[0] = @floatFromInt(stats.undo);
    map_history_out[1] = @floatFromInt(stats.redo);
    map_history_out[2] = @floatFromInt(stats.bytes);
    map_history_out[3] = @floatFromInt(stats.dropped);
    setReturnF32Buffer(info, map_history_out[0..]);
}

fn setMapHistoryResult(info: v8.FunctionCallbackInfo, result: engine.MapHistoryResult) void {
    map_history_result_out[0] = if (result.ok) 1 else 0;
    map_history_result_out[1] = @intFromEnum(result.kind);
    map_history_result_out[2] = @floatFromInt(result.stats.undo);
    map_history_result_out[3] = @floatFromInt(result.stats.redo);
    map_history_result_out[4] = @floatFromInt(result.stats.dropped);
    setReturnF32Buffer(info, map_history_result_out[0..]);
}

fn hostMapUndo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setMapHistoryResult(info, engine.mapHistoryUndo(v8_runtime.hostContext(info.getIsolate()).io));
}

fn hostMapRedo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setMapHistoryResult(info, engine.mapHistoryRedo(v8_runtime.hostContext(info.getIsolate()).io));
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
    engine.strokeBegin(v8_runtime.hostContext(info.getIsolate()).io, at[0], at[1]);
}

fn hostStrokeMove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argWorldPoint(info) orelse return;
    engine.strokeMove(at[0], at[1]);
}

var stroke_out: [4]f32 = undefined;

fn hostStrokeEnd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const stats = engine.strokeEnd(v8_runtime.hostContext(info.getIsolate()).io);
    stroke_out[0] = @floatFromInt(stats.samples);
    stroke_out[1] = @floatFromInt(stats.stamps);
    stroke_out[2] = @floatFromInt(stats.touched);
    stroke_out[3] = if (stats.water_dry) 1 else 0;
    setReturnF32Buffer(info, stroke_out[0..]);
}

const MAP_EVENT_FLOATS: usize = 33;
var map_event_buf: [engine.AUTHORING_EVENT_CAP]engine.AuthoringEvent = undefined;
var map_event_out: [1 + engine.AUTHORING_EVENT_CAP * MAP_EVENT_FLOATS]f32 = undefined;

fn eventKind(e: engine.AuthoringEvent) f32 {
    return @intFromEnum(e.kind);
}

fn hostEventDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const n = engine.drainAuthoringEvents(map_event_buf[0..]);
    map_event_out[0] = @floatFromInt(n);
    for (map_event_buf[0..n], 0..) |e, i| {
        const base = 1 + i * MAP_EVENT_FLOATS;
        map_event_out[base + 0] = eventKind(e);
        map_event_out[base + 1] = @intFromEnum(e.tool.channel);
        map_event_out[base + 2] = @intFromEnum(e.tool.mode);
        map_event_out[base + 3] = @intFromEnum(e.tool.terrain_tool);
        map_event_out[base + 4] = @intFromEnum(e.tool.shape);
        map_event_out[base + 5] = @intFromEnum(e.tool.profile);
        map_event_out[base + 6] = e.tool.radius_m;
        map_event_out[base + 7] = e.tool.center_z;
        map_event_out[base + 8] = e.tool.ramp_min;
        map_event_out[base + 9] = e.tool.ramp_max;
        map_event_out[base + 10] = e.tool.ramp_wide;
        map_event_out[base + 11] = e.tool.ramp_long;
        map_event_out[base + 12] = e.tool.ramp_angle_deg;
        map_event_out[base + 13] = e.tool.smooth_strength;
        map_event_out[base + 14] = e.tool.kind_idx;
        map_event_out[base + 15] = e.tool.bind_idx;
        map_event_out[base + 16] = e.tool.flora_kind_idx;
        map_event_out[base + 17] = e.tool.flora_lane;
        map_event_out[base + 18] = @as(f32, @floatFromInt(e.tool.flora_density)) / chunks.FLORA_DENSITY_FULL;
        map_event_out[base + 19] = e.tool.zone_idx;
        map_event_out[base + 20] = e.start_x;
        map_event_out[base + 21] = e.start_z;
        map_event_out[base + 22] = e.end_x;
        map_event_out[base + 23] = e.end_z;
        map_event_out[base + 24] = @floatFromInt(e.stats.samples);
        map_event_out[base + 25] = @floatFromInt(e.stats.stamps);
        map_event_out[base + 26] = @floatFromInt(e.stats.touched);
        map_event_out[base + 27] = if (e.stats.water_dry) 1 else 0;
        map_event_out[base + 28] = e.duration_ms;
        map_event_out[base + 29] = @floatFromInt(e.id);
        map_event_out[base + 30] = @floatFromInt(e.aux_a);
        map_event_out[base + 31] = @floatFromInt(e.aux_b);
        map_event_out[base + 32] = @floatFromInt(e.dropped_before);
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
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(path);
    setReturnF64(info, if (engine.saveFile(io, path)) 1 else 0);
}

// __map_inspect_file(path) -> [version, chunkCount] — read only the bounded
// RMAP header. This is deliberately separate from hostLoadFile: listing an
// inactive workspace must never replace the live native map.
var inspect_file_out: [2]f32 = undefined;

fn hostInspectFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setReturnNull(info);
        return;
    };
    defer alloc.free(path);
    var file = std.Io.Dir.cwd().openFile(io, path, .{}) catch {
        setReturnNull(info);
        return;
    };
    defer file.close(io);
    var prefix: [engine.store.INSPECT_PREFIX_BYTES]u8 = undefined;
    const read = file.readPositionalAll(io, prefix[0..], 0) catch {
        setReturnNull(info);
        return;
    };
    const summary = engine.store.inspectHeader(prefix[0..read]) orelse {
        setReturnNull(info);
        return;
    };
    inspect_file_out[0] = @floatFromInt(summary.version);
    inspect_file_out[1] = @floatFromInt(summary.chunk_count);
    setReturnF32Buffer(info, inspect_file_out[0..]);
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
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(path);
    const bytes = std.Io.Dir.cwd().readFileAlloc(io, path, alloc, .limited(MAX_MAP_FILE_BYTES)) catch {
        setReturnF64(info, 0);
        return;
    };
    defer alloc.free(bytes);
    const loaded = engine.loadMap(bytes);
    if (loaded) engine.noteFileLoaded(path);
    setReturnF64(info, if (loaded) 1 else 0);
}

fn publishMapPrepare(io: std.Io, id: u32, prepared: ?*engine.PreparedMap) void {
    map_prepare_mutex.lockUncancelable(io);
    const orphan = map_prepare.publish(id, prepared);
    map_prepare_mutex.unlock(io);
    if (orphan) |stale| stale.deinit();
}

fn mapPrepareWorker(io: std.Io, job: *MapPrepareJob) std.Io.Cancelable!void {
    defer {
        std.heap.c_allocator.free(job.path);
        std.heap.c_allocator.destroy(job);
    }
    const bytes = std.Io.Dir.cwd().readFileAlloc(io, job.path, std.heap.c_allocator, .limited(MAX_MAP_FILE_BYTES)) catch {
        publishMapPrepare(io, job.id, null);
        return;
    };
    defer std.heap.c_allocator.free(bytes);
    publishMapPrepare(io, job.id, engine.prepareMap(std.heap.c_allocator, bytes));
}

fn cleanupPreparedMap(prepared: *engine.PreparedMap) std.Io.Cancelable!void {
    prepared.deinit();
}

// __map_prepare_file(path) -> request id. File IO, RLE expansion, validation,
// and chunk allocation happen on a worker against detached ownership.
fn hostPrepareFile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const path = argStringAlloc(std.heap.c_allocator, info, 0) orelse {
        setReturnF64(info, 0);
        return;
    };
    const job = std.heap.c_allocator.create(MapPrepareJob) catch {
        std.heap.c_allocator.free(path);
        setReturnF64(info, 0);
        return;
    };

    map_prepare_mutex.lockUncancelable(host.io);
    const begin = map_prepare.begin();
    map_prepare_mutex.unlock(host.io);
    if (begin.orphan) |orphan| {
        map_prepare_tasks.concurrent(host.io, cleanupPreparedMap, .{orphan}) catch orphan.deinit();
    }

    job.* = .{ .id = begin.id, .path = path };
    map_prepare_tasks.concurrent(host.io, mapPrepareWorker, .{ host.io, job }) catch {
        publishMapPrepare(host.io, begin.id, null);
        std.heap.c_allocator.free(path);
        std.heap.c_allocator.destroy(job);
        setReturnF64(info, 0);
        return;
    };
    setReturnF64(info, begin.id);
}

var map_prepare_status_out: [3]f32 = undefined;

// __map_prepare_status(id) -> [state, id, chunks].
fn hostPrepareStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const requested = argRequestId(info, 0) orelse 0;
    map_prepare_mutex.lockUncancelable(io);
    defer map_prepare_mutex.unlock(io);
    const matches = requested != 0 and requested == map_prepare.id;
    map_prepare_status_out[0] = @floatFromInt(@intFromEnum(if (matches) map_prepare.state else MapPrepareState.failed));
    map_prepare_status_out[1] = @floatFromInt(map_prepare.id);
    map_prepare_status_out[2] = if (matches and map_prepare.result != null) @floatFromInt(map_prepare.result.?.document.slots.count) else 0;
    setReturnF32Buffer(info, map_prepare_status_out[0..]);
}

// __map_commit_prepared(id, path) -> 0|1. Publication swaps one fixed pointer table;
// the outgoing document is destroyed on a cleanup worker.
fn hostCommitPrepared(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const requested = argRequestId(info, 0) orelse 0;
    const path = argStringAlloc(std.heap.c_allocator, info, 1) orelse {
        setReturnF64(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(path);
    map_prepare_mutex.lockUncancelable(host.io);
    const prepared = map_prepare.takeReady(requested);
    map_prepare_mutex.unlock(host.io);
    if (prepared == null) {
        setReturnF64(info, 0);
        return;
    }

    const ok = engine.commitPreparedMap(prepared.?);
    if (ok) {
        engine.noteFileLoaded(path);
        map_prepare_tasks.concurrent(host.io, cleanupPreparedMap, .{prepared.?}) catch prepared.?.deinit();
    } else {
        prepared.?.deinit();
    }
    setReturnF64(info, if (ok) 1 else 0);
}

// ── readback doors (verification / chrome, UI-rate only) ──────────────────────

fn hostHeightAt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argWorldPoint(info) orelse {
        setReturnF64(info, 0);
        return;
    };
    setReturnF64(info, engine.heightAt(at[0], at[1]));
}

fn hostRenderHeightMax(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ax = argToF64(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const az = argToF64(info, 1) orelse {
        setReturnNull(info);
        return;
    };
    const bx = argToF64(info, 2) orelse {
        setReturnNull(info);
        return;
    };
    const bz = argToF64(info, 3) orelse {
        setReturnNull(info);
        return;
    };
    const highest = engine.maxRenderedHeightInRect(
        @floatCast(ax),
        @floatCast(az),
        @floatCast(bx),
        @floatCast(bz),
    ) orelse {
        setReturnNull(info);
        return;
    };
    setReturnF64(info, highest);
}

var sample_scratch: [chunks.SAMPLE_CELLS]f32 = undefined;
var floor_scratch: [engine.FLOOR_CELLS]f32 = undefined;
var cell_scratch: [chunks.TILE_CELLS]f32 = undefined;
var ground_data_scratch: [engine.MAX_GROUND_DATA_FLOATS]f32 = undefined;

fn hostGroundFormula(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const formula = engine.groundFormula() orelse {
        setReturnNull(info);
        return;
    };
    setReturnString(info, formula);
}

fn hostReadGroundData(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argChunkCoords(info) orelse {
        setReturnNull(info);
        return;
    };
    const chunk = chunks.chunkAt(at[0], at[1]) orelse {
        setReturnNull(info);
        return;
    };
    const written = engine.encodeGroundData(chunk, ground_data_scratch[0..]);
    setReturnF32Buffer(info, ground_data_scratch[0..written]);
}

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

/// The chunk's RENDERED floor mirror — the 121x121 grid the ground pipeline
/// draws and the physics heightfield table collides against, produced by the
/// same abs-max downsample the live paint residency runs
/// (engine.downsampleFloorHeights). The 241x241 sculpt field behind
/// `__map_read_height` is the BRUSH resolution: it overflows both
/// game_physics.HF_MAX_SAMPLES and the dynamic-vertex scratch, and fails
/// terrain_grid.canAppend, so a compile that ships it renders and collides as
/// nothing at all. Export paths must read THIS door.
fn hostReadFloor(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const at = argChunkCoords(info) orelse {
        setReturnNull(info);
        return;
    };
    const chunk = chunks.chunkAt(at[0], at[1]) orelse {
        setReturnNull(info);
        return;
    };
    engine.downsampleFloorHeights(&chunk.height, floor_scratch[0..]);
    setReturnF32Buffer(info, floor_scratch[0..]);
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
    const channel_index: u8 = if (channel > 0 and channel < 9) @trunc(channel) else 0;
    if (channel_index >= 6) {
        const density = chunk.flora_density[channel_index - 6][0..];
        for (density, 0..) |value, i| cell_scratch[i] = value;
        setReturnF32Buffer(info, cell_scratch[0..]);
        return;
    }
    const src: []const i16 = switch (channel_index) {
        1 => chunk.zones[0..],
        2 => chunk.flora[0][0..],
        3 => chunk.flora[1][0..],
        4 => chunk.flora[2][0..],
        5 => chunk.materials[0..],
        else => chunk.tiles[0..],
    };
    for (src, 0..) |v, i| cell_scratch[i] = v;
    setReturnF32Buffer(info, cell_scratch[0..]);
}

pub fn registerGameMap(_: anytype) void {
    v8_runtime.registerHostFn("__map_reset", hostReset);
    v8_runtime.registerHostFn("__map_grow_chunk", hostGrowChunk);
    v8_runtime.registerHostFn("__map_chunk_count", hostChunkCount);
    v8_runtime.registerHostFn("__map_chunk_list", hostChunkList);
    v8_runtime.registerHostFn("__map_open_neighbors", hostOpenNeighbors);
    v8_runtime.registerHostFn("__map_install_generated", hostInstallGenerated);
    v8_runtime.registerHostFn("__map_generated_begin", hostGeneratedBegin);
    v8_runtime.registerHostFn("__map_generated_chunk", hostGeneratedChunk);
    v8_runtime.registerHostFn("__map_generated_commit", hostGeneratedCommit);
    v8_runtime.registerHostFn("__map_generated_abort", hostGeneratedAbort);
    v8_runtime.registerHostFn("__map_set_tool", hostSetTool);
    v8_runtime.registerHostFn("__map_set_brush_gizmo", hostSetBrushGizmo);
    v8_runtime.registerHostFn("__map_set_ground_look", hostSetGroundLook);
    v8_runtime.registerHostFn("__map_set_tile_bindings", hostSetTileBindings);
    v8_runtime.registerHostFn("__map_get_tile_bindings", hostGetTileBindings);
    v8_runtime.registerHostFn("__map_set_zone_palette", hostSetZonePalette);
    v8_runtime.registerHostFn("__map_drop_zone", hostDropZone);
    v8_runtime.registerHostFn("__map_set_flora_specs", hostSetFloraSpecs);
    v8_runtime.registerHostFn("__map_road_set_profile", hostRoadSetProfile);
    v8_runtime.registerHostFn("__map_path_set_profile", hostPathSetProfile);
    v8_runtime.registerHostFn("__map_path_set_tool", hostPathSetTool);
    v8_runtime.registerHostFn("__map_path_set_level", hostPathSetLevel);
    v8_runtime.registerHostFn("__map_road_set_kinds", hostRoadSetKinds);
    v8_runtime.registerHostFn("__map_road_commit", hostRoadCommit);
    v8_runtime.registerHostFn("__map_road_cancel", hostRoadCancel);
    v8_runtime.registerHostFn("__map_road_delete", hostRoadDelete);
    v8_runtime.registerHostFn("__map_road_stats", hostRoadStats);
    v8_runtime.registerHostFn("__map_path_commit", hostPathCommit);
    v8_runtime.registerHostFn("__map_path_cancel", hostPathCancel);
    v8_runtime.registerHostFn("__map_path_undo", hostPathUndo);
    v8_runtime.registerHostFn("__map_path_delete", hostPathDelete);
    v8_runtime.registerHostFn("__map_path_control_delete", hostPathControlDelete);
    v8_runtime.registerHostFn("__map_path_stats", hostPathStats);
    v8_runtime.registerHostFn("__map_path_snapshot", hostPathSnapshot);
    v8_runtime.registerHostFn("__map_path_sample", hostPathSample);
    v8_runtime.registerHostFn("__map_history", hostMapHistory);
    v8_runtime.registerHostFn("__map_undo", hostMapUndo);
    v8_runtime.registerHostFn("__map_redo", hostMapRedo);
    v8_runtime.registerHostFn("__map_save_file", hostSaveFile);
    v8_runtime.registerHostFn("__map_inspect_file", hostInspectFile);
    v8_runtime.registerHostFn("__map_set_autosave_file", hostSetAutosaveFile);
    v8_runtime.registerHostFn("__map_load_file", hostLoadFile);
    v8_runtime.registerHostFn("__map_prepare_file", hostPrepareFile);
    v8_runtime.registerHostFn("__map_prepare_status", hostPrepareStatus);
    v8_runtime.registerHostFn("__map_commit_prepared", hostCommitPrepared);
    v8_runtime.registerHostFn("__map_stroke_begin", hostStrokeBegin);
    v8_runtime.registerHostFn("__map_stroke_move", hostStrokeMove);
    v8_runtime.registerHostFn("__map_stroke_end", hostStrokeEnd);
    v8_runtime.registerHostFn("__map_event_drain", hostEventDrain);
    v8_runtime.registerHostFn("__map_stats", hostStats);
    v8_runtime.registerHostFn("__map_height_at", hostHeightAt);
    v8_runtime.registerHostFn("__map_render_height_max", hostRenderHeightMax);
    v8_runtime.registerHostFn("__map_read_height", hostReadHeight);
    v8_runtime.registerHostFn("__map_read_floor", hostReadFloor);
    v8_runtime.registerHostFn("__map_read_water", hostReadWater);
    v8_runtime.registerHostFn("__map_ground_formula", hostGroundFormula);
    v8_runtime.registerHostFn("__map_read_ground_data", hostReadGroundData);
    v8_runtime.registerHostFn("__map_read_cells", hostReadCells);
}
