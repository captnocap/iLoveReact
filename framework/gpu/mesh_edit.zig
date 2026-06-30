//! Host-native mesh-element selection — the foundation of the in-house mesh editor.
//!
//! The Studio did vertex/edge/face selection in JS: it re-derived the camera in
//! JavaScript (meshSelect.tsx `makeProjector`) and screen-projected the whole mesh every
//! frame to pick + draw 2D overlays. That parallel camera math is exactly what drifted off
//! the model on zoom. Here selection lives in the HOST, against the SAME resident mesh and
//! the SAME camera the renderer uses (model_paint.cameraRay/project), so a picked vertex is
//! the pixel its raycast shoots back through — zero drift, no per-frame React render.
//!
//! The resident mesh is non-indexed (3 verts per triangle — every face owns its corners),
//! which is perfect for per-face paint but wrong for editing: moving "a vertex" must move
//! every triangle corner that shares its position. So we WELD: hash positions into logical
//! vertices, build the corner→vertex map and the unique edge list once, and select against
//! that. The same welded topology drives the coming gizmo (it transforms logical vertices →
//! writes back to every incident corner) and lives in harmony with the paint layers.
//!
//! Face highlight rides the existing paint atlas (save the face's base colour, tint it the
//! selection orange, restore on deselect) — no second texture. Vertex/edge MARKERS render
//! through the overlay-geometry pass (next slice); selection state + picking are here now.

const std = @import("std");
const model_paint = @import("model_paint.zig");

const alloc = std.heap.c_allocator;

pub const Mode = enum(u8) { none = 0, vertex = 1, edge = 2, face = 3 };

/// Selection orange (matches the Studio's selectFaceColor), blended 0.7 over a face's base.
const SELECT_RGB: [3]f32 = .{ 255, 138, 61 };
const SELECT_MIX: f32 = 0.7;
/// Click radius (pixels) for screen-nearest vertex / edge picking.
const VERT_PX: f32 = 12;
const EDGE_PX: f32 = 9;
/// Weld grid: positions rounded to this many units/metre collapse to one logical vertex.
const WELD_Q: f32 = 1024.0;

var g_mode: Mode = .none;

// ── Welded topology (built lazily from model_paint's CPU positions) ──────────────────
var g_built_for: u32 = 0; // facecount the current topology was built for (0 = none)
var g_verts: ?[]f32 = null; // unique vertex positions, 3 f32 each
var g_vert_count: u32 = 0;
var g_corner_vert: ?[]u32 = null; // facecount*3 → logical vertex index
var g_edges: ?[]u32 = null; // edgecount*2 → logical vertex indices (a<b)
var g_edge_count: u32 = 0;

// ── Selection sets (one per element kind; modes keep their own) ──────────────────────
var g_sel_vert: ?[]bool = null;
var g_sel_edge: ?[]bool = null;
var g_sel_face: ?[]bool = null;
// Faces currently tinted as selected, with the base colour to restore on deselect.
var g_face_base: std.AutoHashMapUnmanaged(u32, [4]u8) = .{};
// Pre-press snapshot of the active set, so a press that turns into an orbit-drag can
// undo its instant pick (select on mousedown for paint-like immediacy, revert if you drag).
var g_snap: ?[]bool = null;
var g_snap_mode: Mode = .none;

fn activeSet() ?[]bool {
    return switch (g_mode) {
        .vertex => g_sel_vert,
        .edge => g_sel_edge,
        .face => g_sel_face,
        .none => null,
    };
}

pub fn mode() Mode {
    return g_mode;
}
pub fn setMode(m: Mode) void {
    if (m == g_mode) return;
    g_mode = m;
    // Leaving face mode drops the orange tint; entering it re-applies from the face set.
    applyFaceHighlight();
}

pub fn vertCount() u32 {
    return g_vert_count;
}
pub fn edgeCount() u32 {
    return g_edge_count;
}
pub fn faceCount() u32 {
    return model_paint.faceCount();
}

/// How many elements are selected in the active mode (the HUD count).
pub fn selCount() u32 {
    return switch (g_mode) {
        .vertex => countTrue(g_sel_vert),
        .edge => countTrue(g_sel_edge),
        .face => countTrue(g_sel_face),
        .none => 0,
    };
}
fn countTrue(maybe: ?[]bool) u32 {
    const s = maybe orelse return 0;
    var n: u32 = 0;
    for (s) |b| {
        if (b) n += 1;
    }
    return n;
}

/// Drop topology + selection — call on model load / quality change (topology changed).
pub fn reset() void {
    restoreAllFaces();
    g_face_base.deinit(alloc);
    g_face_base = .{};
    if (g_verts) |v| alloc.free(v);
    if (g_corner_vert) |c| alloc.free(c);
    if (g_edges) |e| alloc.free(e);
    if (g_sel_vert) |s| alloc.free(s);
    if (g_sel_edge) |s| alloc.free(s);
    if (g_sel_face) |s| alloc.free(s);
    if (g_snap) |s| alloc.free(s);
    g_snap = null;
    g_verts = null;
    g_corner_vert = null;
    g_edges = null;
    g_sel_vert = null;
    g_sel_edge = null;
    g_sel_face = null;
    g_vert_count = 0;
    g_edge_count = 0;
    g_built_for = 0;
}

pub fn clearSelection() void {
    restoreAllFaces();
    if (g_sel_vert) |s| @memset(s, false);
    if (g_sel_edge) |s| @memset(s, false);
    if (g_sel_face) |s| @memset(s, false);
}

/// Snapshot the active mode's selection before an instant (mousedown) pick.
pub fn snapshotSelection() void {
    const set = activeSet() orelse {
        if (g_snap) |s| alloc.free(s);
        g_snap = null;
        return;
    };
    if (g_snap) |s| {
        if (s.len != set.len) {
            alloc.free(s);
            g_snap = null;
        }
    }
    if (g_snap == null) g_snap = alloc.alloc(bool, set.len) catch return;
    @memcpy(g_snap.?, set);
    g_snap_mode = g_mode;
}

/// Restore the snapshot — the press became an orbit-drag, so undo its pick.
pub fn revertSelection() void {
    const snap = g_snap orelse return;
    if (g_snap_mode != g_mode) return;
    const set = activeSet() orelse return;
    if (set.len != snap.len) return;
    @memcpy(set, snap);
    if (g_mode == .face) applyFaceHighlight();
}

/// Select a face by index (no raycast) — programmatic selection (select-all, scripting)
/// and the headless highlight proof. Switches to face mode so the tint shows. Returns false
/// if there's no mesh or the index is out of range.
pub fn selectFaceByIndex(idx: u32, additive: bool) bool {
    if (!ensureFaceSel()) return false;
    g_mode = .face;
    const sel = g_sel_face orelse return false;
    if (idx >= sel.len) return false;
    if (!additive) {
        @memset(sel, false);
        restoreAllFaces();
    }
    sel[idx] = true;
    applyFaceHighlight();
    return true;
}

// ── Topology ─────────────────────────────────────────────────────────────────────
/// Face mode needs ONLY a per-face selection bit array — never the welded vertex/edge
/// topology. Building the weld on the first face click is wasted work that made selection
/// feel laggy; this is the cheap path (a memset, no hashing). The raycast itself uses
/// model_paint's CPU positions directly, so face picking costs exactly what paint costs.
fn ensureFaceSel() bool {
    const fc = model_paint.faceCount();
    if (fc == 0) return false;
    if (g_sel_face) |s| {
        if (s.len == fc) return true; // already sized (from here or a prior weld)
    }
    reset(); // facecount changed / first use → everything stale
    g_sel_face = alloc.alloc(bool, fc) catch return false;
    @memset(g_sel_face.?, false);
    return true;
}

fn weldKey(p: [3]f32) u64 {
    const xi: i64 = @intFromFloat(@round(p[0] * WELD_Q));
    const yi: i64 = @intFromFloat(@round(p[1] * WELD_Q));
    const zi: i64 = @intFromFloat(@round(p[2] * WELD_Q));
    // Pack three ~21-bit quantised coords into one key (sufficient for editor-scale models).
    const ux: u64 = @bitCast(xi);
    const uy: u64 = @bitCast(yi);
    const uz: u64 = @bitCast(zi);
    return (ux *% 0x9E3779B97F4A7C15) ^ (uy *% 0xC2B2AE3D27D4EB4F) ^ (uz *% 0x165667B19E3779F9);
}

/// Build (or rebuild) the welded topology from model_paint's CPU triangle positions.
/// Returns false if there's no resident mesh. Idempotent for a given facecount.
fn ensureTopology() bool {
    const fc = model_paint.faceCount();
    if (fc == 0) return false;
    if (g_built_for == fc and g_verts != null) return true;
    reset();

    const pos = model_paint.positions() orelse return false;
    if (pos.len < @as(usize, fc) * 9) return false;

    var weld = std.AutoHashMapUnmanaged(u64, u32){};
    defer weld.deinit(alloc);
    var verts = std.ArrayListUnmanaged(f32){};
    var corner_vert = alloc.alloc(u32, @as(usize, fc) * 3) catch return false;

    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const base = f * 9 + k * 3;
            const p: [3]f32 = .{ pos[base + 0], pos[base + 1], pos[base + 2] };
            const key = weldKey(p);
            const gop = weld.getOrPut(alloc, key) catch return false;
            if (!gop.found_existing) {
                gop.value_ptr.* = @intCast(verts.items.len / 3);
                verts.append(alloc, p[0]) catch return false;
                verts.append(alloc, p[1]) catch return false;
                verts.append(alloc, p[2]) catch return false;
            }
            corner_vert[f * 3 + k] = gop.value_ptr.*;
        }
    }

    // Unique undirected edges from the three corners of every face.
    var emap = std.AutoHashMapUnmanaged(u64, void){};
    defer emap.deinit(alloc);
    var edges = std.ArrayListUnmanaged(u32){};
    f = 0;
    while (f < fc) : (f += 1) {
        const a = corner_vert[f * 3 + 0];
        const b = corner_vert[f * 3 + 1];
        const c = corner_vert[f * 3 + 2];
        addEdge(&emap, &edges, a, b);
        addEdge(&emap, &edges, b, c);
        addEdge(&emap, &edges, c, a);
    }

    g_verts = verts.toOwnedSlice(alloc) catch return false;
    g_corner_vert = corner_vert;
    g_edges = edges.toOwnedSlice(alloc) catch return false;
    g_vert_count = @intCast(g_verts.?.len / 3);
    g_edge_count = @intCast(g_edges.?.len / 2);
    g_built_for = fc;

    g_sel_vert = alloc.alloc(bool, g_vert_count) catch return false;
    g_sel_edge = alloc.alloc(bool, g_edge_count) catch return false;
    g_sel_face = alloc.alloc(bool, fc) catch return false;
    @memset(g_sel_vert.?, false);
    @memset(g_sel_edge.?, false);
    @memset(g_sel_face.?, false);
    return true;
}

fn addEdge(emap: *std.AutoHashMapUnmanaged(u64, void), edges: *std.ArrayListUnmanaged(u32), a0: u32, b0: u32) void {
    const a = @min(a0, b0);
    const b = @max(a0, b0);
    if (a == b) return;
    const key = (@as(u64, a) << 32) | @as(u64, b);
    const gop = emap.getOrPut(alloc, key) catch return;
    if (gop.found_existing) return;
    edges.append(alloc, a) catch return;
    edges.append(alloc, b) catch return;
}

fn vertPos(i: u32) [3]f32 {
    const v = g_verts.?;
    return .{ v[i * 3 + 0], v[i * 3 + 1], v[i * 3 + 2] };
}

// ── Picking ─────────────────────────────────────────────────────────────────────
/// Pick the element under viewport pixel (mx,my) in the current mode and fold it into the
/// selection (additive = toggle / extend, else replace). Returns the new selected count in
/// this mode, or -1 if there's no mesh. A miss with !additive clears (Blockbench rule).
pub fn pick(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32, additive: bool) i32 {
    if (g_mode == .none) return -1;
    // Face mode never needs the weld — the cheap face-set path keeps picking as fast as
    // paint. Vertex/edge modes build (once) the welded topology they project against.
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;

    const hit: i32 = switch (g_mode) {
        .face => model_paint.pick(cam, vp_w, vp_h, mx, my),
        .vertex => pickVertex(cam, vp_w, vp_h, mx, my),
        .edge => pickEdge(cam, vp_w, vp_h, mx, my),
        .none => -1,
    };

    const set = switch (g_mode) {
        .vertex => g_sel_vert.?,
        .edge => g_sel_edge.?,
        .face => g_sel_face.?,
        .none => return -1,
    };

    if (hit < 0) {
        if (!additive) clearSelection();
    } else {
        const idx: u32 = @intCast(hit);
        if (additive) {
            if (idx < set.len) set[idx] = !set[idx];
        } else {
            // Replace: clear the active set, select just this one.
            @memset(set, false);
            if (g_mode == .face) restoreAllFaces();
            if (idx < set.len) set[idx] = true;
        }
    }
    if (g_mode == .face) applyFaceHighlight();
    return @intCast(selCount());
}

fn inRect(sp: ?[2]f32, minx: f32, maxx: f32, miny: f32, maxy: f32) bool {
    const p = sp orelse return false;
    return p[0] >= minx and p[0] <= maxx and p[1] >= miny and p[1] <= maxy;
}

/// Marquee (rubber-band) select: select every element whose representative screen point
/// (vertex / edge-midpoint / face-centroid) falls inside the rect (x0,y0)-(x1,y1). The
/// desktop-style drag-select — sweep to grab many at once instead of one-by-one. additive
/// (Shift held with Alt) unions with the pre-gesture snapshot so you can sweep to ADD;
/// otherwise the rect IS the selection. Recomputed live each drag move. Returns the count.
pub fn boxSelect(cam: model_paint.Camera, vp_w: f32, vp_h: f32, x0: f32, y0: f32, x1: f32, y1: f32, additive: bool) i32 {
    if (g_mode == .none) return -1;
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;
    const minx = @min(x0, x1);
    const maxx = @max(x0, x1);
    const miny = @min(y0, y1);
    const maxy = @max(y0, y1);
    const set = activeSet() orelse return -1;

    // Recompute from the base each move: the rect alone, or unioned with the snapshot.
    @memset(set, false);
    if (additive) {
        if (g_snap) |s| {
            if (s.len == set.len and g_snap_mode == g_mode) @memcpy(set, s);
        }
    }

    switch (g_mode) {
        .face => {
            const pos = model_paint.positions() orelse return -1;
            const n: u32 = @intCast(set.len);
            var f: u32 = 0;
            while (f < n) : (f += 1) {
                const b = f * 9;
                const c: [3]f32 = .{
                    (pos[b + 0] + pos[b + 3] + pos[b + 6]) / 3.0,
                    (pos[b + 1] + pos[b + 4] + pos[b + 7]) / 3.0,
                    (pos[b + 2] + pos[b + 5] + pos[b + 8]) / 3.0,
                };
                if (inRect(model_paint.project(cam, vp_w, vp_h, c), minx, maxx, miny, maxy)) set[f] = true;
            }
        },
        .vertex => {
            var i: u32 = 0;
            while (i < g_vert_count) : (i += 1) {
                if (inRect(model_paint.project(cam, vp_w, vp_h, vertPos(i)), minx, maxx, miny, maxy)) set[i] = true;
            }
        },
        .edge => {
            const edges = g_edges.?;
            var e: u32 = 0;
            while (e < g_edge_count) : (e += 1) {
                const a = vertPos(edges[e * 2 + 0]);
                const b = vertPos(edges[e * 2 + 1]);
                const mid: [3]f32 = .{ (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5 };
                if (inRect(model_paint.project(cam, vp_w, vp_h, mid), minx, maxx, miny, maxy)) set[e] = true;
            }
        },
        .none => return -1,
    }
    if (g_mode == .face) applyFaceHighlight();
    return @intCast(selCount());
}

fn pickVertex(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    var best: i32 = -1;
    var best_d2: f32 = VERT_PX * VERT_PX;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        const sp = model_paint.project(cam, vp_w, vp_h, vertPos(i)) orelse continue;
        const dx = sp[0] - mx;
        const dy = sp[1] - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < best_d2) {
            best_d2 = d2;
            best = @intCast(i);
        }
    }
    return best;
}

fn pickEdge(cam: model_paint.Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    const edges = g_edges.?;
    var best: i32 = -1;
    var best_d2: f32 = EDGE_PX * EDGE_PX;
    var e: u32 = 0;
    while (e < g_edge_count) : (e += 1) {
        const a = model_paint.project(cam, vp_w, vp_h, vertPos(edges[e * 2 + 0])) orelse continue;
        const b = model_paint.project(cam, vp_w, vp_h, vertPos(edges[e * 2 + 1])) orelse continue;
        const d2 = segDist2(mx, my, a[0], a[1], b[0], b[1]);
        if (d2 < best_d2) {
            best_d2 = d2;
            best = @intCast(e);
        }
    }
    return best;
}

/// Squared distance from point (px,py) to segment (ax,ay)-(bx,by), in screen space.
fn segDist2(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) f32 {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const len2 = vx * vx + vy * vy;
    const t = if (len2 > 1e-6) std.math.clamp((wx * vx + wy * vy) / len2, 0.0, 1.0) else 0.0;
    const cx = ax + t * vx;
    const cy = ay + t * vy;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
}

// ── Face highlight (rides the paint atlas) ───────────────────────────────────────
fn blendSelect(base: [4]u8) [4]u8 {
    var out: [4]u8 = base;
    var c: usize = 0;
    while (c < 3) : (c += 1) {
        const b: f32 = @floatFromInt(base[c]);
        const v = b * (1.0 - SELECT_MIX) + SELECT_RGB[c] * SELECT_MIX;
        out[c] = @intFromFloat(std.math.clamp(v, 0, 255));
    }
    out[3] = 255;
    return out;
}

/// Reconcile the atlas tint with g_sel_face: restore faces no longer selected, tint newly
/// selected ones (saving their base so a later deselect is exact).
fn applyFaceHighlight() void {
    if (model_paint.faceCount() == 0) return;
    // In non-face modes, nothing should be tinted.
    if (g_mode != .face) {
        restoreAllFaces();
        return;
    }
    const sel = g_sel_face orelse return;
    // Restore faces that fell out of the selection.
    var to_restore = std.ArrayListUnmanaged(u32){};
    defer to_restore.deinit(alloc);
    var it = g_face_base.iterator();
    while (it.next()) |entry| {
        const f = entry.key_ptr.*;
        if (f >= sel.len or !sel[f]) to_restore.append(alloc, f) catch {};
    }
    for (to_restore.items) |f| {
        if (g_face_base.get(f)) |base| model_paint.paintFace(f, base);
        _ = g_face_base.remove(f);
    }
    // Tint newly selected faces.
    var f: u32 = 0;
    while (f < sel.len) : (f += 1) {
        if (!sel[f]) continue;
        if (g_face_base.contains(f)) continue;
        const base = model_paint.faceColor(f) orelse continue;
        g_face_base.put(alloc, f, base) catch continue;
        model_paint.paintFace(f, blendSelect(base));
    }
}

fn restoreAllFaces() void {
    var it = g_face_base.iterator();
    while (it.next()) |entry| {
        model_paint.paintFace(entry.key_ptr.*, entry.value_ptr.*);
    }
    g_face_base.clearRetainingCapacity();
}

// ── Tests ───────────────────────────────────────────────────────────────────────
const testing = std.testing;

// A quad on z=0 as two triangles sharing the diagonal → 4 logical verts, 5 edges.
fn setupQuad() void {
    // Interleaved 8 f32/vert (px,py,pz,nx,ny,nz,u,v); positions are what matters.
    var verts = [_]f32{
        // tri 0: (0,0) (1,0) (1,1)
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        // tri 1: (0,0) (1,1) (0,1)
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    model_paint.setTarget(777, &verts, 6);
}

test "weld builds 4 verts and 5 edges from a 2-tri quad" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 4), vertCount());
    try testing.expectEqual(@as(u32, 5), edgeCount()); // 4 sides + 1 shared diagonal
    try testing.expectEqual(@as(u32, 2), faceCount());
}

test "vertex pick selects the nearest welded corner; face highlight saves+restores" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    const cam = model_paint.Camera{ .eye = .{ 0.5, 0.5, 5 }, .target = .{ 0.5, 0.5, 0 }, .fov_deg = 50 };
    // Project corner (0,0) and click right on it.
    try testing.expect(ensureTopology());
    setMode(.vertex);
    const sp = model_paint.project(cam, 800, 600, .{ 0, 0, 0 }).?;
    const n = pick(cam, 800, 600, sp[0], sp[1], false);
    try testing.expectEqual(@as(i32, 1), n);

    // Face mode: select face 0, confirm it tints, then clearing restores the base.
    setMode(.face);
    const base0 = model_paint.faceColor(0).?;
    _ = pick(cam, 800, 600, 400, 300, false); // centre ray → a face
    try testing.expect(selCount() == 1);
    const tinted = model_paint.faceColor(0).?;
    // The hit face is no longer the plain default grey.
    try testing.expect(tinted[0] != base0[0] or tinted[1] != base0[1] or tinted[2] != base0[2]);
    clearSelection();
    const restored = model_paint.faceColor(0).?;
    try testing.expectEqual(base0[0], restored[0]);
    try testing.expectEqual(base0[1], restored[1]);
    try testing.expectEqual(base0[2], restored[2]);
}

test "box select grabs every element inside the rect; additive unions the snapshot" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    const cam = model_paint.Camera{ .eye = .{ 0.5, 0.5, 5 }, .target = .{ 0.5, 0.5, 0 }, .fov_deg = 50 };
    // A rect covering the whole viewport encloses every face/vertex.
    setMode(.vertex);
    try testing.expect(ensureTopology());
    _ = boxSelect(cam, 800, 600, 0, 0, 800, 600, false);
    try testing.expectEqual(@as(u32, 4), selCount()); // all 4 welded verts

    setMode(.face);
    _ = boxSelect(cam, 800, 600, 0, 0, 800, 600, false);
    try testing.expectEqual(@as(u32, 2), selCount()); // both faces' centroids enclosed

    // A tiny rect at one corner of the screen catches nothing.
    _ = boxSelect(cam, 800, 600, 0, 0, 2, 2, false);
    try testing.expectEqual(@as(u32, 0), selCount());

    // Additive box unions with the snapshot: select face 0, snapshot, then box the rest.
    _ = selectFaceByIndex(0, false);
    snapshotSelection();
    _ = boxSelect(cam, 800, 600, 0, 0, 800, 600, true);
    try testing.expectEqual(@as(u32, 2), selCount());
}
