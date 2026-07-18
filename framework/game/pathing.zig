//! framework/game/pathing.zig — the game's host-side pathing (V5).
//!
//! ONE coherent system: grid A* with per-agent cost profiles and directional
//! flow penalties, LANE DISCIPLINE on the raw cell path (trio-center snap +
//! junction apexes — promoted host-side out of cart/pathing_lab per V5), and
//! deterministic motion plans (closed-form trapezoidal schedules — position
//! is a pure function of t, ported from runtime/motion.ts). Graduated out of
//! framework/v8_bindings_pathing.zig (2026-06); the V8 registrar for this
//! module is framework/v8_bindings_game_pathing.zig, which preserves the
//! legacy `__path_*` host-fn names and adds honest `__game_pathing_*` aliases.
//!
//! V5 doctrine: ALL NPC pathing is deterministic until a game-state change —
//! paths precomputed, the player's effect on the world (a grid patch, a flow
//! change) bumps the generation and is what invalidates them.
//!
//! The cart publishes its tile world ONCE (kind grid + per-agent cost tables +
//! per-kind flows + per-kind classes); the host owns the expensive part:
//! A* over the grid, lane discipline, path simplification, lane offset.
//!
//! ── Lane discipline (the pathing_lab capture) ────────────────────────────
//! Road grammar: a road is two 3-tile lane trios; the WHOLE trio carries the
//! flow; junction tiles are flow-neutral boxes where lanes meet. Two
//! hard-won, probe-verified rules ride along (structural-over-observed):
//!
//!   • trio-center snap — A* may route through any of a trio's columns
//!     (uniform cost), which put cars side by side inside one lane. Every
//!     flowed path cell snaps to its trio's marked CENTER line, derived from
//!     the contiguous same-flow run in the grid — never from whichever
//!     column A* wandered through. Flow-neutral cells (crosswalk bands)
//!     inside a corridor inherit the entry flank's line.
//!   • junction apexes — A* through a flow-neutral box is a staircase and
//!     every monotone staircase has EQUAL cost, so the tie-break happily
//!     drags a left turn across the oncoming half. The in-box waypoints are
//!     replaced by the single apex = intersection of the entry lane line and
//!     the exit lane line (early for a right turn, deep past the center for
//!     a left), both lane-true because the snap pass runs on the RAW cell
//!     path first (the cart-side version had to distrust merged waypoints;
//!     the host sees every cell). Straight passes just drop the stair dust.
//!
//! Discipline activates only when the cart publishes kind classes
//! (setKindClasses); without them every route is emitted exactly as the
//! pre-capture binding did, so existing callers are bit-identical.
//!
//! ── Motion plans (the runtime/motion.ts capture) ─────────────────────────
//! plan() compiles a polyline + profile into a packed trapezoidal schedule:
//! corner caps from turn angles → backward brake pass → forward throttle
//! pass → closed-form accel/cruise/brake phases. samplePlan(plan, t) is
//! exact for ANY t — frame-rate independent, rewindable, identical on every
//! machine; slicePlanPoints() is the interruption tool (the remaining
//! polyline from arc s0, cut at s1). All f64 — same precision as the JS
//! mirror the game door falls back to headless.
//!
//! P2: every gameplay number (costs, lane offsets, flow penalties, motion
//! profiles) arrives from the caller; this module owns zero tuning values.
//! Pure math — no V8, no SDL. Behavior-tested in
//! framework/testing/unit/game_pathing.zig.

const std = @import("std");

// 16k cells = a 128x128 world (or any cols*rows under the cap). Scratch is
// static (~400 KB total) — no allocation on the query path.
pub const MAX_CELLS: usize = 16384;
pub const MAX_KINDS: usize = 64;
pub const MAX_PROFILES: usize = 8;
// Corner waypoints after collinear merge; a pathological all-staircase path
// truncates here and the agent simply re-asks when it arrives at the cut.
pub const MAX_WAYPOINTS: usize = 1024;
pub const SNAP_RADIUS: i32 = 2;
// Widest contiguous same-flow run the trio snap will scan (the grammar says
// 3; 8 tolerates painted variants without scanning the whole row).
pub const MAX_TRIO_SCAN: i32 = 8;

// Kind classes (setKindClasses). LANE is implied by a kind having a flow;
// classes mark the flow-neutral semantics discipline needs.
pub const CLASS_PLAIN: u8 = 0;
pub const CLASS_JUNCTION: u8 = 1;
pub const CLASS_CROSSWALK: u8 = 2;

const Profile = struct {
    lane_offset: f32 = 0,
    min_cost: f32 = 1, // admissible heuristic scale (min positive cost)
    // flow penalties, clamped >= 1 (a discount would break the heuristic)
    against_flow: f32 = 1,
    cross_flow: f32 = 1,
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

// Per-kind flow direction. Codes match the A* neighbor order AND the JS
// PATH_FLOW enum: 0 none, 1 +x, 2 -x, 3 +z, 4 -z.
var g_flows: [MAX_KINDS]u8 = [_]u8{0} ** MAX_KINDS;

// Per-kind class (CLASS_*). Publishing classes is the lane-discipline
// opt-in; until then routes are emitted exactly as before the capture.
var g_classes: [MAX_KINDS]u8 = [_]u8{0} ** MAX_KINDS;
var g_discipline: bool = false;

inline fn flowFactor(prof: *const Profile, kind: u16, dir_code: u8) f32 {
    const flow = g_flows[kind];
    if (flow == 0 or flow == dir_code) return 1;
    const opposite = (flow == 1 and dir_code == 2) or (flow == 2 and dir_code == 1) or
        (flow == 3 and dir_code == 4) or (flow == 4 and dir_code == 3);
    return if (opposite) prof.against_flow else prof.cross_flow;
}

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
var g_wx: [MAX_CELLS]f32 = undefined;
var g_wz: [MAX_CELLS]f32 = undefined;
var g_dropped: [MAX_CELLS]bool = undefined;
var g_mx: [MAX_WAYPOINTS]f32 = undefined;
var g_mz: [MAX_WAYPOINTS]f32 = undefined;
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
    return @floor((wx - g_origin_x) / g_cell);
}
fn worldToCellZ(wz: f32) i32 {
    return @floor((wz - g_origin_z) / g_cell);
}

// ── world publication ────────────────────────────────────────────────────────

/// Publish/replace the whole kind grid (row-major, z*cols+x). Returns the new
/// generation, or null on a malformed grid.
pub fn setGrid(origin_x: f32, origin_z: f32, cell: f32, cols: usize, rows: usize, kinds: []align(1) const u16) ?u32 {
    if (cols == 0 or rows == 0 or cols * rows > MAX_CELLS or cell <= 0) return null;
    if (kinds.len < cols * rows) return null;
    g_origin_x = origin_x;
    g_origin_z = origin_z;
    g_cell = cell;
    g_cols = cols;
    g_rows = rows;
    for (0..cols * rows) |i| g_kinds[i] = kinds[i];
    g_generation +%= 1;
    return g_generation;
}

/// Patch a rect of kinds (kinds slice row-major w×h, or null to fill with
/// `fill`). Out-of-grid cells are skipped. Bumps the generation only when a
/// cell actually changed. Returns the (possibly bumped) generation.
pub fn patchCells(cx0: i64, cz0: i64, w: i64, h: i64, kinds: ?[]align(1) const u16, fill: u16) u32 {
    if (g_cols == 0 or w <= 0 or h <= 0) return g_generation;
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
    return g_generation;
}

/// Per-agent cost table indexed BY KIND INDEX; <=0 / non-finite = blocked.
/// laneOffset (world units) shifts waypoints toward travel-right; the flow
/// penalties (>= 1) multiply a flowed tile's cost when entered against /
/// across its flow.
pub fn setProfile(id: usize, lane_offset: f32, against_flow: f32, cross_flow: f32, costs: []align(1) const f32) bool {
    if (id >= MAX_PROFILES) return false;
    var prof = &g_profiles[id];
    prof.lane_offset = lane_offset;
    prof.against_flow = @max(1.0, against_flow);
    prof.cross_flow = @max(1.0, cross_flow);
    var min_cost: f32 = std.math.floatMax(f32);
    for (0..MAX_KINDS) |i| {
        const c: f32 = if (i < costs.len) costs[i] else -1;
        prof.costs[i] = c;
        if (c > 0 and std.math.isFinite(c) and c < min_cost) min_cost = c;
    }
    prof.min_cost = if (min_cost == std.math.floatMax(f32)) 1 else min_cost;
    return true;
}

/// Per-KIND flow direction (0 none, 1 +x, 2 -x, 3 +z, 4 -z). Bumps the
/// generation — flows reshape every precomputed route.
pub fn setFlows(flows: []const u8) u32 {
    for (0..MAX_KINDS) |i| g_flows[i] = if (i < flows.len and flows[i] <= 4) flows[i] else 0;
    g_generation +%= 1;
    return g_generation;
}

/// Per-KIND class (CLASS_PLAIN / CLASS_JUNCTION / CLASS_CROSSWALK) — the
/// lane-discipline opt-in. Bumps the generation (discipline reshapes routes).
pub fn setKindClasses(classes: []const u8) u32 {
    for (0..MAX_KINDS) |i| g_classes[i] = if (i < classes.len and classes[i] <= 2) classes[i] else 0;
    g_discipline = true;
    g_generation +%= 1;
    return g_generation;
}

/// Test hook + world reset: drop classes and return to pre-capture emission.
pub fn clearKindClasses() void {
    @memset(&g_classes, 0);
    g_discipline = false;
}

pub fn generation() u32 {
    return g_generation;
}

// ── A* ───────────────────────────────────────────────────────────────────────

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
        for (neighbors, 0..) |n, di| {
            if (n[0] < 0 or n[1] < 0 or n[0] >= cols or n[1] >= rows) continue;
            const nidx = cellIndex(@intCast(n[0]), @intCast(n[1]));
            if (g_closed_stamp[nidx] == g_query) continue;
            const cost = cellCost(prof, nidx) orelse continue;
            // neighbor order IS the direction code (+1): entering a flowed
            // tile against/across its direction pays the profile's penalty
            const step = cost * flowFactor(prof, g_kinds[nidx], @intCast(di + 1));
            const ng = g_gscore[current] + step;
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

// ── waypoint emission (legacy pipeline — discipline OFF) ─────────────────────

/// g_cellpath[0..len] -> g_mx/g_mz waypoints: collinear cells merged, then
/// each corner shifted laneOffset toward travel-right (averaged in/out
/// directions at corners so the offset path stays continuous). This is the
/// pre-capture emission, kept bit-identical for callers that never publish
/// kind classes.
fn emitWaypointsLegacy(prof: *const Profile, len: usize) usize {
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
        g_mx[count] = g_origin_x + (@as(f32, @floatFromInt(idx % g_cols)) + 0.5) * g_cell;
        g_mz[count] = g_origin_z + (@as(f32, @floatFromInt(idx / g_cols)) + 0.5) * g_cell;
        count += 1;
    }
    applyLaneOffset(prof, count);
    return count;
}

/// Shift each waypoint laneOffset toward travel-right, pulling back toward
/// the raw point while the landing cell is blocked for this profile — a WIDE
/// lane offset must never shove a waypoint onto the sidewalk or into a wall.
fn applyLaneOffset(prof: *const Profile, count: usize) void {
    const lane = prof.lane_offset;
    if (lane == 0 or count < 2) return;
    // offsets computed from the UN-offset polyline, applied after
    var ox: [MAX_WAYPOINTS]f32 = undefined;
    var oz: [MAX_WAYPOINTS]f32 = undefined;
    var w: usize = 0;
    while (w < count) : (w += 1) {
        const px = if (w > 0) g_mx[w - 1] else g_mx[w];
        const pz = if (w > 0) g_mz[w - 1] else g_mz[w];
        const nx = if (w + 1 < count) g_mx[w + 1] else g_mx[w];
        const nz = if (w + 1 < count) g_mz[w + 1] else g_mz[w];
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
    const cols_i: i32 = @intCast(g_cols);
    const rows_i: i32 = @intCast(g_rows);
    w = 0;
    while (w < count) : (w += 1) {
        for ([_]f32{ 1.0, 0.66, 0.33, 0.0 }) |t| {
            const wx = g_mx[w] + ox[w] * t;
            const wz = g_mz[w] + oz[w] * t;
            const cx = worldToCellX(wx);
            const cz = worldToCellZ(wz);
            if (cx < 0 or cz < 0 or cx >= cols_i or cz >= rows_i) continue;
            if (cellCost(prof, cellIndex(@intCast(cx), @intCast(cz))) == null) continue;
            g_mx[w] = wx;
            g_mz[w] = wz;
            break;
        }
    }
}

// ── lane discipline (the pathing_lab capture — discipline ON) ────────────────

inline fn flowAlongX(flow: u8) bool {
    return flow == 1 or flow == 2;
}

inline fn cellFlow(idx: u32) u8 {
    const kind = g_kinds[idx];
    return if (kind < MAX_KINDS) g_flows[kind] else 0;
}

inline fn cellClass(idx: u32) u8 {
    const kind = g_kinds[idx];
    return if (kind < MAX_KINDS) g_classes[kind] else CLASS_PLAIN;
}

/// Center of the contiguous same-flow run through (cx, cz), measured along
/// the axis PERPENDICULAR to the flow — the trio's marked line, derived from
/// the grid (structural), never from whichever column A* wandered through.
fn trioCenter(cx: i32, cz: i32, flow: u8) f32 {
    const along_x = flowAlongX(flow);
    const cols: i32 = @intCast(g_cols);
    const rows: i32 = @intCast(g_rows);
    const at = if (along_x) cz else cx;
    var lo = at;
    var hi = at;
    var steps: i32 = 0;
    while (steps < MAX_TRIO_SCAN) : (steps += 1) {
        const probe = lo - 1;
        if (probe < 0) break;
        const idx = if (along_x) cellIndex(@intCast(cx), @intCast(probe)) else cellIndex(@intCast(probe), @intCast(cz));
        if (cellFlow(idx) != flow) break;
        lo = probe;
    }
    steps = 0;
    while (steps < MAX_TRIO_SCAN) : (steps += 1) {
        const probe = hi + 1;
        if (probe >= (if (along_x) rows else cols)) break;
        const idx = if (along_x) cellIndex(@intCast(cx), @intCast(probe)) else cellIndex(@intCast(probe), @intCast(cz));
        if (cellFlow(idx) != flow) break;
        hi = probe;
    }
    return (@as(f32, @floatFromInt(lo)) + @as(f32, @floatFromInt(hi))) / 2.0;
}

/// Disciplined emission: trio-center snap + corridor-gap inheritance +
/// junction apex replacement on the RAW cell path, then collinear merge in
/// world space, then the profile's lane offset.
fn emitWaypointsDisciplined(prof: *const Profile, len: usize) usize {
    if (len == 0) return 0;
    const path = g_cellpath[0..len];

    // Raw cell centers + per-cell metadata.
    for (path, 0..) |idx, i| {
        g_wx[i] = g_origin_x + (@as(f32, @floatFromInt(idx % g_cols)) + 0.5) * g_cell;
        g_wz[i] = g_origin_z + (@as(f32, @floatFromInt(idx / g_cols)) + 0.5) * g_cell;
        g_dropped[i] = false;
    }

    // Pass 1 — trio-center snap: every flowed cell rides its trio's line.
    for (path, 0..) |idx, i| {
        const flow = cellFlow(idx);
        if (flow == 0) continue;
        const cx: i32 = @intCast(idx % g_cols);
        const cz: i32 = @intCast(idx / g_cols);
        const center = trioCenter(cx, cz, flow);
        if (flowAlongX(flow)) {
            g_wz[i] = g_origin_z + (center + 0.5) * g_cell;
        } else {
            g_wx[i] = g_origin_x + (center + 0.5) * g_cell;
        }
    }

    // Pass 2 — corridor gaps: a run of flow-neutral, non-junction cells
    // (a crosswalk band) flanked in the path by SAME-flow lane cells
    // inherits the entry flank's snapped line, so the route crosses the
    // band dead straight instead of weaving on the neutral cells.
    var i: usize = 0;
    while (i < len) : (i += 1) {
        if (cellFlow(path[i]) != 0 or cellClass(path[i]) == CLASS_JUNCTION) continue;
        var k = i;
        while (k < len and cellFlow(path[k]) == 0 and cellClass(path[k]) != CLASS_JUNCTION) k += 1;
        if (i == 0 or k >= len) {
            i = k - 1;
            continue;
        }
        const entry_flow = cellFlow(path[i - 1]);
        if (entry_flow != 0 and entry_flow == cellFlow(path[k])) {
            var r = i;
            while (r < k) : (r += 1) {
                if (flowAlongX(entry_flow)) {
                    g_wz[r] = g_wz[i - 1];
                } else {
                    g_wx[r] = g_wx[i - 1];
                }
            }
        }
        i = k - 1;
    }

    // Pass 3 — junction apexes. The apex is the intersection of the entry
    // lane line and the exit lane line — both lane-true because passes 1–2
    // already snapped the flanking cells. Right turns apex early, left
    // turns deep past the center; straight passes drop the stair dust.
    i = 0;
    while (i < len) : (i += 1) {
        if (cellClass(path[i]) != CLASS_JUNCTION) continue;
        var k = i;
        while (k < len and cellClass(path[k]) == CLASS_JUNCTION) k += 1;
        if (i == 0 or k >= len) {
            // Route starts or ends inside the box — keep its cells as-is.
            i = if (k > 0) k - 1 else i;
            continue;
        }
        const prev_idx = path[i - 1];
        const first_idx = path[i];
        const entry_dx = @as(i64, @intCast(first_idx % g_cols)) - @as(i64, @intCast(prev_idx % g_cols));
        const entry_dz = @as(i64, @intCast(first_idx / g_cols)) - @as(i64, @intCast(prev_idx / g_cols));
        const h_entry = @abs(entry_dx) > @abs(entry_dz);
        const straight = if (h_entry)
            @abs(g_wz[k] - g_wz[i - 1]) < 0.6 * g_cell
        else
            @abs(g_wx[k] - g_wx[i - 1]) < 0.6 * g_cell;
        var r = i;
        while (r < k) : (r += 1) g_dropped[r] = true;
        if (!straight) {
            // Re-purpose the first in-box slot as the apex waypoint.
            g_dropped[i] = false;
            if (h_entry) {
                g_wx[i] = g_wx[k]; // exit lane's line (vertical road column)
                g_wz[i] = g_wz[i - 1]; // entry lane's line (horizontal road row)
            } else {
                g_wx[i] = g_wx[i - 1];
                g_wz[i] = g_wz[k];
            }
        }
        i = k - 1;
    }

    // Collapse to waypoints: drop marked cells, merge collinear runs (the
    // snap passes turn whole lane stretches into one straight segment).
    var count: usize = 0;
    i = 0;
    while (i < len and count < MAX_WAYPOINTS) : (i += 1) {
        if (g_dropped[i]) continue;
        if (count >= 2) {
            const ax = g_mx[count - 2];
            const az = g_mz[count - 2];
            const bx = g_mx[count - 1];
            const bz = g_mz[count - 1];
            const cross = (bx - ax) * (g_wz[i] - bz) - (bz - az) * (g_wx[i] - bx);
            const dot = (bx - ax) * (g_wx[i] - bx) + (bz - az) * (g_wz[i] - bz);
            if (@abs(cross) < 1e-3 and dot >= 0) {
                g_mx[count - 1] = g_wx[i];
                g_mz[count - 1] = g_wz[i];
                continue;
            }
        }
        // consecutive duplicates (a snap can land two cells on one point)
        if (count >= 1 and @abs(g_mx[count - 1] - g_wx[i]) < 1e-4 and @abs(g_mz[count - 1] - g_wz[i]) < 1e-4) continue;
        g_mx[count] = g_wx[i];
        g_mz[count] = g_wz[i];
        count += 1;
    }
    applyLaneOffset(prof, count);
    return count;
}

/// Host A*: world-coordinate waypoints for a profile, lane discipline
/// applied when kind classes are published. Returns the packed f32 buffer
/// [generation, count, x0, z0, x1, z1, ...] (count == 0: no route), or null
/// when the world/profile is unusable. The buffer is module-owned scratch —
/// consume or copy before the next call.
pub fn find(profile_id: usize, start_wx: f32, start_wz: f32, goal_wx: f32, goal_wz: f32) ?[]f32 {
    g_out[0] = @floatFromInt(g_generation);
    g_out[1] = 0;
    if (profile_id >= MAX_PROFILES or g_cols == 0 or g_rows == 0) return g_out[0..2];
    const prof = &g_profiles[profile_id];
    const start = snapTraversable(prof, worldToCellX(start_wx), worldToCellZ(start_wz)) orelse return g_out[0..2];
    const goal = snapTraversable(prof, worldToCellX(goal_wx), worldToCellZ(goal_wz)) orelse return g_out[0..2];

    const len = if (start == goal) blk: {
        g_cellpath[0] = start;
        break :blk @as(usize, 1);
    } else runAStar(prof, start, goal);
    const count = if (g_discipline) emitWaypointsDisciplined(prof, len) else emitWaypointsLegacy(prof, len);

    g_out[1] = @floatFromInt(count);
    for (0..count) |i| {
        g_out[2 + i * 2] = g_mx[i];
        g_out[3 + i * 2] = g_mz[i];
    }
    return g_out[0 .. 2 + count * 2];
}

// ── deterministic motion plans (the runtime/motion.ts capture, f64) ─────────
//
// Packed plan layout (f64), built by plan() and read by samplePlan()/
// slicePlanPoints() — and by the JS door, which unpacks it into the exact
// MotionPlan shape runtime/motion.ts defined:
//   [0] t0   [1] duration   [2] total arc length
//   [3] npoints   [4] nphases
//   [5 ..]                npoints × (x, z)
//   [5 + 2n ..]           npoints × cumulative arc length
//   [5 + 3n ..]           nphases × (t, s, v, a, dt)

pub const PLAN_HEADER: usize = 5;
pub const PHASE_FLOATS: usize = 5;
pub const MAX_PLAN_POINTS: usize = MAX_WAYPOINTS;
pub const MAX_PLAN_PHASES: usize = (MAX_PLAN_POINTS - 1) * 3;
pub const MAX_PLAN_FLOATS: usize = PLAN_HEADER + MAX_PLAN_POINTS * 3 + MAX_PLAN_PHASES * PHASE_FLOATS;

pub const MotionProfile = struct {
    max_speed: f64,
    accel: f64,
    decel: f64,
    /// floor through the sharpest corner — caller data (P2); the JS mirror's
    /// historical default is 1.3 m/s and lives with the caller, not here.
    min_corner_speed: f64,
};

pub const MotionSample = struct {
    x: f64,
    z: f64,
    /// path tangent at s (heading convention: forward = [sin, cos])
    heading_deg: f64,
    speed: f64,
    /// current acceleration (negative = braking)
    accel: f64,
    /// arc distance traveled along this plan
    s: f64,
    done: bool,
};

const DEG: f64 = 180.0 / std.math.pi;

fn cornerCap(points: []const f64, i: usize, prof: MotionProfile) f64 {
    const ax = points[(i - 1) * 2];
    const az = points[(i - 1) * 2 + 1];
    const bx = points[i * 2];
    const bz = points[i * 2 + 1];
    const cx = points[(i + 1) * 2];
    const cz = points[(i + 1) * 2 + 1];
    const h1 = std.math.atan2(bx - ax, bz - az);
    const h2 = std.math.atan2(cx - bx, cz - bz);
    var turn = @abs((h2 - h1) * DEG);
    if (turn > 180) turn = 360 - turn;
    if (turn < 12) return prof.max_speed;
    return @max(prof.min_corner_speed, prof.max_speed * std.math.pow(f64, @max(0.0, 1.0 - turn / 130.0), 1.15));
}

/// Compile points (x,z interleaved) + profile into a packed plan in `out`.
/// The plan always ENDS AT REST — "stop at the end of these points" is the
/// only contract; to keep cruising past an obstacle that cleared, replan
/// with the remaining points. Returns floats written, or null when the
/// polyline doesn't fit the caps / out buffer.
pub fn plan(points: []const f64, start_time: f64, start_speed: f64, prof: MotionProfile, out: []f64) ?usize {
    const n = points.len / 2;
    if (n == 0 or n > MAX_PLAN_POINTS) return null;
    if (out.len < PLAN_HEADER + n * 3) return null;

    // measure
    var cum: [MAX_PLAN_POINTS]f64 = undefined;
    cum[0] = 0;
    var total: f64 = 0;
    for (1..n) |i| {
        const dx = points[i * 2] - points[(i - 1) * 2];
        const dz = points[i * 2 + 1] - points[(i - 1) * 2 + 1];
        total += @sqrt(dx * dx + dz * dz);
        cum[i] = total;
    }

    out[0] = start_time;
    out[1] = 0;
    out[2] = total;
    out[3] = @floatFromInt(n);
    out[4] = 0;
    for (0..n) |i| {
        out[PLAN_HEADER + i * 2] = points[i * 2];
        out[PLAN_HEADER + i * 2 + 1] = points[i * 2 + 1];
        out[PLAN_HEADER + n * 2 + i] = cum[i];
    }
    if (n < 2 or total < 1e-4) return PLAN_HEADER + n * 3;

    // 1) per-waypoint speed caps
    var cap: [MAX_PLAN_POINTS]f64 = undefined;
    cap[0] = prof.max_speed;
    cap[n - 1] = 0;
    for (1..n - 1) |i| cap[i] = cornerCap(points, i, prof);

    // 2) backward pass — brakes must always make the next cap (and the stop)
    var allowed: [MAX_PLAN_POINTS]f64 = undefined;
    @memcpy(allowed[0..n], cap[0..n]);
    var bi: usize = n - 1;
    while (bi > 0) {
        bi -= 1;
        const seg = cum[bi + 1] - cum[bi];
        allowed[bi] = @min(cap[bi], @min(prof.max_speed, @sqrt(allowed[bi + 1] * allowed[bi + 1] + 2 * prof.decel * seg)));
    }

    // 3) forward pass — throttle must actually reach each speed. The start
    // speed is physical fact (keep it even over budget); the `brake` lower
    // bound keeps an overspeed entry honest.
    var v: [MAX_PLAN_POINTS]f64 = undefined;
    v[0] = @max(0.0, start_speed);
    for (1..n) |i| {
        const seg = cum[i] - cum[i - 1];
        const reach = @sqrt(v[i - 1] * v[i - 1] + 2 * prof.accel * seg);
        const brake = @sqrt(@max(0.0, v[i - 1] * v[i - 1] - 2 * prof.decel * seg));
        v[i] = @max(@min(allowed[i], @min(reach, prof.max_speed)), brake);
    }

    // 4) phases per segment: accel -> cruise -> brake, closed form
    const phases_at = PLAN_HEADER + n * 3;
    var nphases: usize = 0;
    var t: f64 = 0;
    for (0..n - 1) |i| {
        const seg_len = cum[i + 1] - cum[i];
        if (seg_len < 1e-6) continue;
        const vin = v[i];
        const vout = v[i + 1];
        var vc = @sqrt((2 * prof.accel * prof.decel * seg_len + prof.decel * vin * vin + prof.accel * vout * vout) /
            (prof.accel + prof.decel));
        vc = @min(vc, prof.max_speed);
        const peak = @max(vc, @max(vin, vout));
        const d_acc = if (peak > vin) (peak * peak - vin * vin) / (2 * prof.accel) else 0;
        const d_dec = if (peak > vout) (peak * peak - vout * vout) / (2 * prof.decel) else 0;
        const d_cruise = @max(0.0, seg_len - d_acc - d_dec);
        var s0 = cum[i];
        if (d_acc > 1e-6) {
            if (nphases >= MAX_PLAN_PHASES or out.len < phases_at + (nphases + 1) * PHASE_FLOATS) return null;
            const dt = (peak - vin) / prof.accel;
            writePhase(out, phases_at, nphases, t, s0, vin, prof.accel, dt);
            nphases += 1;
            t += dt;
            s0 += d_acc;
        }
        if (d_cruise > 1e-6 and peak > 1e-4) {
            if (nphases >= MAX_PLAN_PHASES or out.len < phases_at + (nphases + 1) * PHASE_FLOATS) return null;
            const dt = d_cruise / peak;
            writePhase(out, phases_at, nphases, t, s0, peak, 0, dt);
            nphases += 1;
            t += dt;
            s0 += d_cruise;
        }
        if (d_dec > 1e-6) {
            if (nphases >= MAX_PLAN_PHASES or out.len < phases_at + (nphases + 1) * PHASE_FLOATS) return null;
            const dt = (peak - vout) / prof.decel;
            writePhase(out, phases_at, nphases, t, s0, peak, -prof.decel, dt);
            nphases += 1;
            t += dt;
        }
    }
    out[1] = t;
    out[4] = @floatFromInt(nphases);
    return phases_at + nphases * PHASE_FLOATS;
}

inline fn writePhase(out: []f64, base: usize, i: usize, t: f64, s: f64, v: f64, a: f64, dt: f64) void {
    const at = base + i * PHASE_FLOATS;
    out[at] = t;
    out[at + 1] = s;
    out[at + 2] = v;
    out[at + 3] = a;
    out[at + 4] = dt;
}

const PlanView = struct {
    t0: f64,
    duration: f64,
    total: f64,
    n: usize,
    nphases: usize,
    points: []const f64,
    cum: []const f64,
    phases: []const f64,
};

fn viewPlan(packed_plan: []const f64) ?PlanView {
    if (packed_plan.len < PLAN_HEADER) return null;
    const n: usize = @trunc(@max(0.0, packed_plan[3]));
    const nphases: usize = @trunc(@max(0.0, packed_plan[4]));
    if (n > MAX_PLAN_POINTS or nphases > MAX_PLAN_PHASES) return null;
    if (packed_plan.len < PLAN_HEADER + n * 3 + nphases * PHASE_FLOATS) return null;
    return .{
        .t0 = packed_plan[0],
        .duration = packed_plan[1],
        .total = packed_plan[2],
        .n = n,
        .nphases = nphases,
        .points = packed_plan[PLAN_HEADER .. PLAN_HEADER + n * 2],
        .cum = packed_plan[PLAN_HEADER + n * 2 .. PLAN_HEADER + n * 3],
        .phases = packed_plan[PLAN_HEADER + n * 3 .. PLAN_HEADER + n * 3 + nphases * PHASE_FLOATS],
    };
}

/// Point + tangent heading at arc distance s along the plan's polyline.
fn pointAt(view: PlanView, s: f64) struct { x: f64, z: f64, heading_deg: f64 } {
    if (view.n == 0) return .{ .x = 0, .z = 0, .heading_deg = 0 };
    if (view.n == 1) return .{ .x = view.points[0], .z = view.points[1], .heading_deg = 0 };
    var i: usize = 1;
    while (i < view.n - 1 and view.cum[i] < s) i += 1;
    const ax = view.points[(i - 1) * 2];
    const az = view.points[(i - 1) * 2 + 1];
    const bx = view.points[i * 2];
    const bz = view.points[i * 2 + 1];
    const seg = view.cum[i] - view.cum[i - 1];
    const k = if (seg > 1e-6) @max(0.0, @min(1.0, (s - view.cum[i - 1]) / seg)) else 0;
    return .{
        .x = ax + (bx - ax) * k,
        .z = az + (bz - az) * k,
        .heading_deg = std.math.atan2(bx - ax, bz - az) * DEG,
    };
}

/// Exact state at time t — THE deterministic read. No integration, no drift.
pub fn samplePlan(packed_plan: []const f64, t: f64) ?MotionSample {
    const view = viewPlan(packed_plan) orelse return null;
    const tau = t - view.t0;
    if (view.nphases == 0 or tau >= view.duration) {
        const end = pointAt(view, view.total);
        return .{ .x = end.x, .z = end.z, .heading_deg = end.heading_deg, .speed = 0, .accel = 0, .s = view.total, .done = true };
    }
    if (tau <= 0) {
        const start = pointAt(view, 0);
        return .{ .x = start.x, .z = start.z, .heading_deg = start.heading_deg, .speed = view.phases[2], .accel = view.phases[3], .s = 0, .done = false };
    }
    var pi: usize = view.nphases - 1;
    for (0..view.nphases) |i| {
        if (tau < view.phases[i * PHASE_FLOATS] + view.phases[i * PHASE_FLOATS + 4]) {
            pi = i;
            break;
        }
    }
    const ph = view.phases[pi * PHASE_FLOATS .. pi * PHASE_FLOATS + PHASE_FLOATS];
    const dt = @min(tau - ph[0], ph[4]);
    const s = ph[1] + ph[2] * dt + 0.5 * ph[3] * dt * dt;
    const speed = @max(0.0, ph[2] + ph[3] * dt);
    const p = pointAt(view, s);
    return .{ .x = p.x, .z = p.z, .heading_deg = p.heading_deg, .speed = speed, .accel = ph[3], .s = s, .done = false };
}

/// The interruption tool: the remaining polyline from arc s0 (optionally cut
/// at s1 — "stop THERE"). First/last points are exact interpolations, so a
/// replanned schedule starts precisely where the old sample stood. Writes
/// (x, z) pairs into out_points; returns the point count.
pub fn slicePlanPoints(packed_plan: []const f64, s0: f64, s1: f64, out_points: []f64) ?usize {
    const view = viewPlan(packed_plan) orelse return null;
    if (view.n == 0) return 0;
    const from = @max(0.0, @min(s0, view.total));
    const to = @max(from, @min(s1, view.total));
    const start = pointAt(view, from);
    var count: usize = 0;
    if (out_points.len < 2) return null;
    out_points[0] = start.x;
    out_points[1] = start.z;
    count = 1;
    for (0..view.n) |i| {
        if (view.cum[i] <= from + 1e-4) continue;
        if (view.cum[i] >= to - 1e-4) break;
        if (out_points.len < (count + 1) * 2) return null;
        out_points[count * 2] = view.points[i * 2];
        out_points[count * 2 + 1] = view.points[i * 2 + 1];
        count += 1;
    }
    const end = pointAt(view, to);
    const lx = out_points[(count - 1) * 2];
    const lz = out_points[(count - 1) * 2 + 1];
    if (@sqrt((end.x - lx) * (end.x - lx) + (end.z - lz) * (end.z - lz)) > 1e-3) {
        if (out_points.len < (count + 1) * 2) return null;
        out_points[count * 2] = end.x;
        out_points[count * 2 + 1] = end.z;
        count += 1;
    }
    return count;
}
