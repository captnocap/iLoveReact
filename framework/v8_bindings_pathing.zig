//! Host tile pathing — grid A* + lane discipline for NPC walkers and drivers.
//!
//! The cart publishes its tile world ONCE (a grid of tile-kind indices plus
//! per-agent cost tables derived from the cart's tile definitions — hmsc's
//! tileKinds walk/run/vehicle costs slot straight in); the host owns the
//! expensive part: A* over the grid, path simplification, and the lane
//! offset that keeps two-way traffic on opposite sides of a road.
//!
//! Host fns (all registered by the `pathing` ingredient, prefix __path_):
//!   __path_set_grid(originX, originZ, cellSize, cols, rows, kindsU16)
//!       publish/replace the whole kind grid (row-major, z*cols+x).
//!   __path_update_cells(cellX, cellZ, w, h, kindsU16)
//!       patch a rect of kinds (a placed obstacle, an opened gate).
//!   __path_fill_rect(cellX, cellZ, w, h, kindIndex)
//!       patch a rect to ONE kind without building an array.
//!   __path_set_profile(profileId, laneOffset, costsF32)
//!       per-agent costs indexed BY KIND INDEX; <=0 / non-finite = blocked.
//!       laneOffset (world units) shifts waypoints toward the agent's
//!       travel-right (right = forward x up = (-fz, fx) in xz), so opposite
//!       directions naturally take opposite sides — vehicles drive their
//!       lane, pedestrians keep to one side of the walkway.
//!   __path_find(profileId, startWX, startWZ, goalWX, goalWZ)
//!       -> ArrayBuffer of f32 [generation, count, x0, z0, x1, z1, ...]
//!       (JS reads it as new Float32Array(buf) — the physics snapshot idiom)
//!       world-coordinate waypoints (cell centers + lane offset), collinear
//!       cells merged. count == 0 means no path. The buffer is host-owned
//!       scratch — consume or copy before the next __path_* call.
//!   __path_generation() -> number
//!       bumps on every grid publish/patch. The "pre-calculated until
//!       disrupted" contract: an agent keeps following its waypoints until
//!       the generation moves AND the disruption touches its remaining path
//!       (the JS wrapper does that test) — only then does it re-ask.
//!
//! Start/goal cells that are blocked snap to the nearest traversable cell
//! within a small ring (an agent standing where an obstacle just landed can
//! still path OUT of it).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");

// 16k cells = a 128x128 world (or any cols*rows under the cap). Scratch is
// static (~400 KB total) — no allocation on the query path.
const MAX_CELLS: usize = 16384;
const MAX_KINDS: usize = 64;
const MAX_PROFILES: usize = 8;
// Corner waypoints after collinear merge; a pathological all-staircase path
// truncates here and the agent simply re-asks when it arrives at the cut.
const MAX_WAYPOINTS: usize = 1024;
const SNAP_RADIUS: i32 = 2;

const Profile = struct {
    lane_offset: f32 = 0,
    min_cost: f32 = 1, // admissible heuristic scale (min positive cost)
    costs: [MAX_KINDS]f32 = [_]f32{-1} ** MAX_KINDS,
};

var g_origin_x: f32 = 0;
var g_origin_z: f32 = 0;
var g_cell: f32 = 1;
var g_cols: usize = 0;
var g_rows: usize = 0;
var g_kinds: [MAX_CELLS]u16 = [_]u16{0} ** MAX_CELLS;
var g_generation: u32 = 0;
var g_profiles: [MAX_PROFILES]Profile = [_]Profile{.{}} ** MAX_PROFILES;

// ── A* scratch (query-stamped so nothing is cleared between queries) ────────
var g_query: u32 = 0;
var g_gscore: [MAX_CELLS]f32 = undefined;
var g_came: [MAX_CELLS]u32 = undefined;
var g_open_stamp: [MAX_CELLS]u32 = [_]u32{0} ** MAX_CELLS;
var g_closed_stamp: [MAX_CELLS]u32 = [_]u32{0} ** MAX_CELLS;

const HeapNode = struct { f: f32, cell: u32 };
var g_heap: [MAX_CELLS]HeapNode = undefined;
var g_heap_len: usize = 0;

var g_cellpath: [MAX_CELLS]u32 = undefined;
var g_wx: [MAX_WAYPOINTS]f32 = undefined;
var g_wz: [MAX_WAYPOINTS]f32 = undefined;
var g_out: [2 + MAX_WAYPOINTS * 2]f32 = undefined;

fn heapPush(node: HeapNode) void {
    if (g_heap_len >= g_heap.len) return; // saturated — query degrades, never overflows
    var i = g_heap_len;
    g_heap[i] = node;
    g_heap_len += 1;
    while (i > 0) {
        const parent = (i - 1) / 2;
        if (g_heap[parent].f <= g_heap[i].f) break;
        std.mem.swap(HeapNode, &g_heap[parent], &g_heap[i]);
        i = parent;
    }
}

fn heapPop() ?HeapNode {
    if (g_heap_len == 0) return null;
    const top = g_heap[0];
    g_heap_len -= 1;
    if (g_heap_len > 0) {
        g_heap[0] = g_heap[g_heap_len];
        var i: usize = 0;
        while (true) {
            const l = i * 2 + 1;
            const r = l + 1;
            var smallest = i;
            if (l < g_heap_len and g_heap[l].f < g_heap[smallest].f) smallest = l;
            if (r < g_heap_len and g_heap[r].f < g_heap[smallest].f) smallest = r;
            if (smallest == i) break;
            std.mem.swap(HeapNode, &g_heap[i], &g_heap[smallest]);
            i = smallest;
        }
    }
    return top;
}

inline fn cellIndex(cx: usize, cz: usize) u32 {
    return @intCast(cz * g_cols + cx);
}

/// Entry cost of a cell for a profile; null = blocked.
inline fn cellCost(prof: *const Profile, idx: u32) ?f32 {
    const kind = g_kinds[idx];
    if (kind >= MAX_KINDS) return null;
    const c = prof.costs[kind];
    if (!(c > 0) or !std.math.isFinite(c)) return null;
    return c;
}

fn worldToCellX(wx: f32) i32 {
    return @intFromFloat(@floor((wx - g_origin_x) / g_cell));
}
fn worldToCellZ(wz: f32) i32 {
    return @intFromFloat(@floor((wz - g_origin_z) / g_cell));
}

/// Nearest traversable cell within SNAP_RADIUS rings of (cx, cz), or null.
fn snapTraversable(prof: *const Profile, cx_in: i32, cz_in: i32) ?u32 {
    const cols: i32 = @intCast(g_cols);
    const rows: i32 = @intCast(g_rows);
    var radius: i32 = 0;
    while (radius <= SNAP_RADIUS) : (radius += 1) {
        var dz: i32 = -radius;
        while (dz <= radius) : (dz += 1) {
            var dx: i32 = -radius;
            while (dx <= radius) : (dx += 1) {
                if (@max(@abs(dx), @abs(dz)) != radius) continue; // ring only
                const cx = cx_in + dx;
                const cz = cz_in + dz;
                if (cx < 0 or cz < 0 or cx >= cols or cz >= rows) continue;
                const idx = cellIndex(@intCast(cx), @intCast(cz));
                if (cellCost(prof, idx) != null) return idx;
            }
        }
    }
    return null;
}

/// A* from start to goal cell index. Returns the path length written to
/// g_cellpath (start..goal forward order), or 0 for no path.
fn runAStar(prof: *const Profile, start: u32, goal: u32) usize {
    g_query +%= 1;
    if (g_query == 0) {
        // u32 wrapped (once per ~4B queries): stamps are ambiguous, clear them.
        @memset(&g_open_stamp, 0);
        @memset(&g_closed_stamp, 0);
        g_query = 1;
    }
    g_heap_len = 0;

    const cols: i32 = @intCast(g_cols);
    const rows: i32 = @intCast(g_rows);
    const goal_x: i32 = @intCast(goal % g_cols);
    const goal_z: i32 = @intCast(goal / g_cols);

    g_gscore[start] = 0;
    g_came[start] = start;
    g_open_stamp[start] = g_query;
    heapPush(.{ .f = 0, .cell = start });

    while (heapPop()) |node| {
        const current = node.cell;
        if (g_closed_stamp[current] == g_query) continue; // stale heap dup
        g_closed_stamp[current] = g_query;
        if (current == goal) break;

        const cx: i32 = @intCast(current % g_cols);
        const cz: i32 = @intCast(current / g_cols);
        const neighbors = [4][2]i32{ .{ cx + 1, cz }, .{ cx - 1, cz }, .{ cx, cz + 1 }, .{ cx, cz - 1 } };
        for (neighbors) |n| {
            if (n[0] < 0 or n[1] < 0 or n[0] >= cols or n[1] >= rows) continue;
            const nidx = cellIndex(@intCast(n[0]), @intCast(n[1]));
            if (g_closed_stamp[nidx] == g_query) continue;
            const cost = cellCost(prof, nidx) orelse continue;
            const ng = g_gscore[current] + cost;
            if (g_open_stamp[nidx] == g_query and ng >= g_gscore[nidx]) continue;
            g_gscore[nidx] = ng;
            g_came[nidx] = current;
            g_open_stamp[nidx] = g_query;
            const h: f32 = @floatFromInt(@abs(n[0] - goal_x) + @abs(n[1] - goal_z));
            heapPush(.{ .f = ng + h * prof.min_cost, .cell = nidx });
        }
    }

    if (g_closed_stamp[goal] != g_query) return 0;

    // walk back, then reverse in place
    var len: usize = 0;
    var cur = goal;
    while (true) {
        if (len >= g_cellpath.len) return 0; // cycle guard (cannot happen)
        g_cellpath[len] = cur;
        len += 1;
        if (cur == start) break;
        cur = g_came[cur];
    }
    std.mem.reverse(u32, g_cellpath[0..len]);
    return len;
}

/// g_cellpath[0..len] -> g_wx/g_wz waypoints: collinear cells merged, then
/// each corner shifted laneOffset toward travel-right (averaged in/out
/// directions at corners so the offset path stays continuous).
fn emitWaypoints(prof: *const Profile, len: usize) usize {
    if (len == 0) return 0;
    var count: usize = 0;
    var i: usize = 0;
    while (i < len and count < MAX_WAYPOINTS) : (i += 1) {
        if (i > 0 and i + 1 < len) {
            const a = g_cellpath[i - 1];
            const b = g_cellpath[i];
            const c = g_cellpath[i + 1];
            const dx1 = @as(i64, @intCast(b % g_cols)) - @as(i64, @intCast(a % g_cols));
            const dz1 = @as(i64, @intCast(b / g_cols)) - @as(i64, @intCast(a / g_cols));
            const dx2 = @as(i64, @intCast(c % g_cols)) - @as(i64, @intCast(b % g_cols));
            const dz2 = @as(i64, @intCast(c / g_cols)) - @as(i64, @intCast(b / g_cols));
            if (dx1 == dx2 and dz1 == dz2) continue; // straight-through cell
        }
        const idx = g_cellpath[i];
        g_wx[count] = g_origin_x + (@as(f32, @floatFromInt(idx % g_cols)) + 0.5) * g_cell;
        g_wz[count] = g_origin_z + (@as(f32, @floatFromInt(idx / g_cols)) + 0.5) * g_cell;
        count += 1;
    }

    const lane = prof.lane_offset;
    if (lane != 0 and count >= 2) {
        // offsets computed from the UN-offset polyline, applied after
        var ox: [MAX_WAYPOINTS]f32 = undefined;
        var oz: [MAX_WAYPOINTS]f32 = undefined;
        var w: usize = 0;
        while (w < count) : (w += 1) {
            const px = if (w > 0) g_wx[w - 1] else g_wx[w];
            const pz = if (w > 0) g_wz[w - 1] else g_wz[w];
            const nx = if (w + 1 < count) g_wx[w + 1] else g_wx[w];
            const nz = if (w + 1 < count) g_wz[w + 1] else g_wz[w];
            var fx = nx - px;
            var fz = nz - pz;
            const flen = @sqrt(fx * fx + fz * fz);
            if (flen > 0.0001) {
                fx /= flen;
                fz /= flen;
            }
            // travel-right = forward x up = (-fz, fx)
            ox[w] = -fz * lane;
            oz[w] = fx * lane;
        }
        w = 0;
        while (w < count) : (w += 1) {
            g_wx[w] += ox[w];
            g_wz[w] += oz[w];
        }
    }
    return count;
}

// ── v8 plumbing (the physics_lab idioms) ─────────────────────────────────────

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

// ── host fns ─────────────────────────────────────────────────────────────────

fn hostSetGrid(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cols: usize = @intFromFloat(@max(0.0, argToF64(info, 3) orelse 0));
    const rows: usize = @intFromFloat(@max(0.0, argToF64(info, 4) orelse 0));
    const cell = argToF64(info, 2) orelse 1;
    if (cols == 0 or rows == 0 or cols * rows > MAX_CELLS or cell <= 0) {
        setReturnNull(info);
        return;
    }
    const bytes = argBytes(info, 5) orelse {
        setReturnNull(info);
        return;
    };
    const kinds = std.mem.bytesAsSlice(u16, bytes[0 .. (bytes.len / 2) * 2]);
    if (kinds.len < cols * rows) {
        setReturnNull(info);
        return;
    }
    g_origin_x = @floatCast(argToF64(info, 0) orelse 0);
    g_origin_z = @floatCast(argToF64(info, 1) orelse 0);
    g_cell = @floatCast(cell);
    g_cols = cols;
    g_rows = rows;
    for (0..cols * rows) |i| g_kinds[i] = kinds[i];
    g_generation +%= 1;
    setReturnF64(info, @floatFromInt(g_generation));
}

fn patchRect(cx0: i64, cz0: i64, w: i64, h: i64, kinds: ?[]align(1) const u16, fill: u16) bool {
    if (g_cols == 0 or w <= 0 or h <= 0) return false;
    var changed = false;
    var z: i64 = 0;
    while (z < h) : (z += 1) {
        var x: i64 = 0;
        while (x < w) : (x += 1) {
            const cx = cx0 + x;
            const cz = cz0 + z;
            if (cx < 0 or cz < 0 or cx >= @as(i64, @intCast(g_cols)) or cz >= @as(i64, @intCast(g_rows))) continue;
            const idx = cellIndex(@intCast(cx), @intCast(cz));
            const kind = if (kinds) |k| k[@intCast(z * w + x)] else fill;
            if (g_kinds[idx] != kind) {
                g_kinds[idx] = kind;
                changed = true;
            }
        }
    }
    if (changed) g_generation +%= 1;
    return changed;
}

fn hostUpdateCells(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const w: i64 = @intFromFloat(argToF64(info, 2) orelse 0);
    const h: i64 = @intFromFloat(argToF64(info, 3) orelse 0);
    const bytes = argBytes(info, 4) orelse {
        setReturnNull(info);
        return;
    };
    const kinds = std.mem.bytesAsSlice(u16, bytes[0 .. (bytes.len / 2) * 2]);
    if (w <= 0 or h <= 0 or kinds.len < @as(usize, @intCast(w * h))) {
        setReturnNull(info);
        return;
    }
    _ = patchRect(
        @intFromFloat(argToF64(info, 0) orelse 0),
        @intFromFloat(argToF64(info, 1) orelse 0),
        w,
        h,
        kinds,
        0,
    );
    setReturnF64(info, @floatFromInt(g_generation));
}

fn hostFillRect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const kind_f = argToF64(info, 4) orelse {
        setReturnNull(info);
        return;
    };
    _ = patchRect(
        @intFromFloat(argToF64(info, 0) orelse 0),
        @intFromFloat(argToF64(info, 1) orelse 0),
        @intFromFloat(argToF64(info, 2) orelse 1),
        @intFromFloat(argToF64(info, 3) orelse 1),
        null,
        @intFromFloat(@max(0.0, @min(kind_f, @as(f64, MAX_KINDS - 1)))),
    );
    setReturnF64(info, @floatFromInt(g_generation));
}

fn hostSetProfile(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id_f = argToF64(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const id: usize = @intFromFloat(@max(0.0, id_f));
    if (id >= MAX_PROFILES) {
        setReturnNull(info);
        return;
    }
    const bytes = argBytes(info, 2) orelse {
        setReturnNull(info);
        return;
    };
    const costs = std.mem.bytesAsSlice(f32, bytes[0 .. (bytes.len / 4) * 4]);
    var prof = &g_profiles[id];
    prof.lane_offset = @floatCast(argToF64(info, 1) orelse 0);
    var min_cost: f32 = std.math.floatMax(f32);
    for (0..MAX_KINDS) |i| {
        const c: f32 = if (i < costs.len) costs[i] else -1;
        prof.costs[i] = c;
        if (c > 0 and std.math.isFinite(c) and c < min_cost) min_cost = c;
    }
    prof.min_cost = if (min_cost == std.math.floatMax(f32)) 1 else min_cost;
    setReturnF64(info, 1);
}

fn hostFind(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    g_out[0] = @floatFromInt(g_generation);
    g_out[1] = 0;
    const fail = g_out[0..2];

    const id_f = argToF64(info, 0) orelse {
        setReturnF32Buffer(info, fail);
        return;
    };
    const id: usize = @intFromFloat(@max(0.0, id_f));
    if (id >= MAX_PROFILES or g_cols == 0 or g_rows == 0) {
        setReturnF32Buffer(info, fail);
        return;
    }
    const prof = &g_profiles[id];
    const start = snapTraversable(prof, worldToCellX(@floatCast(argToF64(info, 1) orelse 0)), worldToCellZ(@floatCast(argToF64(info, 2) orelse 0))) orelse {
        setReturnF32Buffer(info, fail);
        return;
    };
    const goal = snapTraversable(prof, worldToCellX(@floatCast(argToF64(info, 3) orelse 0)), worldToCellZ(@floatCast(argToF64(info, 4) orelse 0))) orelse {
        setReturnF32Buffer(info, fail);
        return;
    };

    const len = if (start == goal) blk: {
        g_cellpath[0] = start;
        break :blk @as(usize, 1);
    } else runAStar(prof, start, goal);
    const count = emitWaypoints(prof, len);

    g_out[1] = @floatFromInt(count);
    for (0..count) |i| {
        g_out[2 + i * 2] = g_wx[i];
        g_out[3 + i * 2] = g_wz[i];
    }
    setReturnF32Buffer(info, g_out[0 .. 2 + count * 2]);
}

fn hostGeneration(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, @floatFromInt(g_generation));
}

pub fn registerPathing(_: anytype) void {
    v8_runtime.registerHostFn("__path_set_grid", hostSetGrid);
    v8_runtime.registerHostFn("__path_update_cells", hostUpdateCells);
    v8_runtime.registerHostFn("__path_fill_rect", hostFillRect);
    v8_runtime.registerHostFn("__path_set_profile", hostSetProfile);
    v8_runtime.registerHostFn("__path_find", hostFind);
    v8_runtime.registerHostFn("__path_generation", hostGeneration);
}
