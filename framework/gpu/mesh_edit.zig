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
const model_source = @import("model_source.zig");

const alloc = std.heap.c_allocator;

pub const Mode = enum(u8) { none = 0, vertex = 1, edge = 2, face = 3 };
pub const Mutation = struct {
    changed: bool = false,
    first_face: u32 = 0,
    last_face: u32 = 0,
};
pub const Edge = [2]u32;

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
// Per welded edge: is it a BOUNDARY edge (a real model edge) vs an INTERNAL one (a
// triangulation diagonal)? An edge is internal when both faces touching it belong to the
// SAME authored face-group (the two halves of one quad share their diagonal). Boundary when
// the incident faces span >1 group, when it's a naked/non-manifold edge, or when the mesh
// carries no grouping at all (a plain triangle soup — every edge is real). Selection and the
// edit overlay use ONLY boundary edges, so a cube reads as 12 edges, not 18. (req_2367)
var g_edge_boundary: ?[]bool = null;
// Active edit SCOPE: when set, vertex/edge/face selection AND the overlay only consider faces
// whose authored group is in [g_scope_lo, g_scope_hi) — the outliner focusing ONE part so you
// edit just it, not the whole composed model. Inactive = the whole mesh. g_scope_vert/edge are
// derived masks (a vert is in scope if it belongs to an in-scope face; an edge if both ends
// are), rebuilt lazily when the scope or facecount changes. (req_2415)
var g_scope_active: bool = false;
var g_scope_lo: u32 = 0;
var g_scope_hi: u32 = 0;
var g_scope_vert: ?[]bool = null;
var g_scope_edge: ?[]bool = null;
var g_scope_built: u64 = 0;
var g_affect_vert: ?[]bool = null; // scratch: logical verts affected by the active selection

// ── Selection sets (one per element kind; modes keep their own) ──────────────────────
var g_sel_vert: ?[]bool = null;
var g_sel_edge: ?[]bool = null;
var g_sel_face: ?[]bool = null;
// Faces currently tinted as selected, each holding the EXACT saved patch bytes to
// restore on deselect. Storing the whole patch (not one base colour) preserves sub-face
// free-form paint when detail>1 — a flat base restore would wipe it (req_2281).
var g_face_base: std.AutoHashMapUnmanaged(u32, []u8) = .{};
const SELECT_TINT: [4]u8 = .{ 255, 138, 61, 255 };
// Pre-press snapshot of the active set, so a press that turns into an orbit-drag can
// undo its instant pick (select on mousedown for paint-like immediacy, revert if you drag).
var g_snap: ?[]bool = null;
var g_snap_mode: Mode = .none;

// ── Read accessors for the overlay renderer (3d.zig owns the GPU/capsule emit; this module
// stays GPU-free so its topology/selection logic is unit-testable without wgpu). ──────────
/// Build the welded topology if needed (so entering vertex/edge mode shows dots immediately).
pub fn ensureTopologyPub() bool {
    return ensureTopology();
}
pub fn vertPosPub(i: u32) [3]f32 {
    const v = g_verts orelse return .{ 0, 0, 0 };
    if (@as(usize, i) * 3 + 2 >= v.len) return .{ 0, 0, 0 };
    return .{ v[i * 3], v[i * 3 + 1], v[i * 3 + 2] };
}
pub fn vertSelectedPub(i: u32) bool {
    const s = g_sel_vert orelse return false;
    return i < s.len and s[i];
}
pub fn edgeEndpointsPub(e: u32) [2]u32 {
    const ed = g_edges orelse return .{ 0, 0 };
    if (@as(usize, e) * 2 + 1 >= ed.len) return .{ 0, 0 };
    return .{ ed[e * 2], ed[e * 2 + 1] };
}
pub fn edgeSelectedPub(e: u32) bool {
    const s = g_sel_edge orelse return false;
    return e < s.len and s[e];
}
pub fn selectedEdgeCountPub() u32 {
    return countTrue(g_sel_edge);
}
pub fn selectedEdgesPub(out: []Edge) u32 {
    if (!ensureTopology()) return 0;
    const sel = g_sel_edge orelse return 0;
    const edges = g_edges orelse return 0;
    var n: u32 = 0;
    var e: u32 = 0;
    while (e < sel.len and e < g_edge_count) : (e += 1) {
        if (!sel[e]) continue;
        if (n < out.len) out[n] = .{ edges[e * 2], edges[e * 2 + 1] };
        n += 1;
    }
    return n;
}
pub fn selectedEdgeIndexPub() ?u32 {
    if (!ensureTopology()) return null;
    const sel = g_sel_edge orelse return null;
    var found: ?u32 = null;
    var e: u32 = 0;
    while (e < sel.len) : (e += 1) {
        if (!sel[e]) continue;
        if (found != null) return null;
        found = e;
    }
    return found;
}
pub fn edgeAverageNormalPub(edge_idx: u32) [3]f32 {
    if (!ensureTopology()) return .{ 0, 1, 0 };
    const edges = g_edges orelse return .{ 0, 1, 0 };
    const corners = g_corner_vert orelse return .{ 0, 1, 0 };
    const pos = model_paint.positions() orelse return .{ 0, 1, 0 };
    if (edge_idx >= g_edge_count) return .{ 0, 1, 0 };
    const a = edges[edge_idx * 2];
    const b = edges[edge_idx * 2 + 1];
    var acc: [3]f32 = .{ 0, 0, 0 };
    var f: u32 = 0;
    const fc = model_paint.faceCount();
    while (f < fc) : (f += 1) {
        var has_a = false;
        var has_b = false;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const cv = corners[f * 3 + k];
            has_a = has_a or cv == a;
            has_b = has_b or cv == b;
        }
        if (!has_a or !has_b) continue;
        const p0: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const p1: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const p2: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        const n = vecNorm(vecCross(vecSub(p1, p0), vecSub(p2, p0)));
        acc[0] += n[0];
        acc[1] += n[1];
        acc[2] += n[2];
    }
    const n = vecNorm(acc);
    return if (vecDot(n, n) > 0.5) n else .{ 0, 1, 0 };
}

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
    if (g_edge_boundary) |b| alloc.free(b);
    if (g_scope_vert) |s| alloc.free(s);
    if (g_scope_edge) |s| alloc.free(s);
    if (g_affect_vert) |s| alloc.free(s);
    if (g_sel_vert) |s| alloc.free(s);
    if (g_sel_edge) |s| alloc.free(s);
    if (g_sel_face) |s| alloc.free(s);
    if (g_snap) |s| alloc.free(s);
    g_snap = null;
    g_verts = null;
    g_corner_vert = null;
    g_edges = null;
    g_edge_boundary = null;
    g_scope_vert = null;
    g_scope_edge = null;
    g_scope_built = 0;
    g_affect_vert = null;
    g_sel_vert = null;
    g_sel_edge = null;
    g_sel_face = null;
    g_vert_count = 0;
    g_edge_count = 0;
    g_built_for = 0;
}

// ── Edit scope (focus one part) ──────────────────────────────────────────────────
/// Restrict editing to the authored group range [lo, hi). hi <= lo clears the scope (edit
/// the whole model). The outliner sets this to the focused part's range.
pub fn setEditScope(lo: u32, hi: u32) void {
    if (hi > lo) {
        g_scope_active = true;
        g_scope_lo = lo;
        g_scope_hi = hi;
    } else {
        g_scope_active = false;
    }
}

fn faceInScope(f: u32) bool {
    if (!g_scope_active) return true;
    const g = model_source.faceGroupOf(f);
    return g != model_source.NO_FACE_GROUP and g >= g_scope_lo and g < g_scope_hi;
}
pub fn faceInScopePub(f: u32) bool {
    return faceInScope(f);
}

/// Build the per-vert / per-edge scope masks for the active scope (lazy; keyed on
/// facecount+range). A vert is in scope if any in-scope face touches it; an edge if both
/// endpoints are. No-op when the scope is inactive or the topology isn't welded yet.
fn ensureScopeMasks() void {
    if (!g_scope_active or g_verts == null) return;
    const sig = (@as(u64, model_paint.faceCount()) << 32) ^ (@as(u64, g_scope_lo) << 12) ^ @as(u64, g_scope_hi);
    if (g_scope_built == sig and g_scope_vert != null) return;
    if (g_scope_vert) |m| alloc.free(m);
    if (g_scope_edge) |m| alloc.free(m);
    g_scope_vert = alloc.alloc(bool, g_vert_count) catch return;
    g_scope_edge = alloc.alloc(bool, g_edge_count) catch return;
    @memset(g_scope_vert.?, false);
    @memset(g_scope_edge.?, false);
    const corners = g_corner_vert orelse return;
    const fc = model_paint.faceCount();
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        if (!faceInScope(f)) continue;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const v = corners[f * 3 + k];
            if (v < g_vert_count) g_scope_vert.?[v] = true;
        }
    }
    const edges = g_edges orelse return;
    var e: u32 = 0;
    while (e < g_edge_count) : (e += 1) {
        const a = edges[e * 2];
        const b = edges[e * 2 + 1];
        g_scope_edge.?[e] = a < g_vert_count and b < g_vert_count and g_scope_vert.?[a] and g_scope_vert.?[b];
    }
    g_scope_built = sig;
}
pub fn vertInScopePub(v: u32) bool {
    if (!g_scope_active) return true;
    ensureScopeMasks();
    const m = g_scope_vert orelse return true;
    return v < m.len and m[v];
}
pub fn edgeInScopePub(e: u32) bool {
    if (!g_scope_active) return true;
    ensureScopeMasks();
    const m = g_scope_edge orelse return true;
    return e < m.len and m[e];
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
    setFaceGroup(sel, idx, true);
    applyFaceHighlight();
    return true;
}

/// Select (face mode) every displayed face whose authored group id is in [lo, hi). The
/// outliner grabs a whole PART this way — each part occupies a contiguous group range in the
/// composed mesh. Returns the selected face count, or -1 if there's no mesh.
pub fn selectFacesByGroupRange(lo: u32, hi: u32, additive: bool) i32 {
    if (!ensureFaceSel()) return -1;
    g_mode = .face;
    const sel = g_sel_face orelse return -1;
    if (!additive) {
        @memset(sel, false);
        restoreAllFaces();
    }
    var f: u32 = 0;
    const fc: u32 = @intCast(sel.len);
    while (f < fc) : (f += 1) {
        const grp = model_source.faceGroupOf(f);
        if (grp != model_source.NO_FACE_GROUP and grp >= lo and grp < hi) sel[f] = true;
    }
    applyFaceHighlight();
    return @intCast(selCount());
}

/// Ctrl+A for the mesh editor: select every element of the current mode that's in the active
/// edit scope (whole model when no part is focused). Returns the selected count, -1 if no mesh
/// or no mode. Edges select only boundary edges (diagonals aren't real edges).
pub fn selectAll() i32 {
    if (g_mode == .none) return -1;
    const ready = if (g_mode == .face) ensureFaceSel() else ensureTopology();
    if (!ready) return -1;
    switch (g_mode) {
        .vertex => {
            const sel = g_sel_vert orelse return -1;
            const n: u32 = @intCast(sel.len);
            var i: u32 = 0;
            while (i < n) : (i += 1) sel[i] = vertInScopePub(i);
        },
        .edge => {
            const sel = g_sel_edge orelse return -1;
            const n: u32 = @intCast(sel.len);
            var e: u32 = 0;
            while (e < n) : (e += 1) sel[e] = edgeIsBoundaryPub(e) and edgeInScopePub(e);
        },
        .face => {
            const sel = g_sel_face orelse return -1;
            const n: u32 = @intCast(sel.len);
            var f: u32 = 0;
            while (f < n) : (f += 1) sel[f] = faceInScopePub(f);
            applyFaceHighlight();
        },
        .none => return -1,
    }
    return @intCast(selCount());
}

/// Fill `out` (one bool per displayed triangle) with which triangles the current selection
/// deletes — exactly what's selected, nothing more: face mode drops selected faces; vertex
/// mode drops any face touching a selected vertex; edge mode drops any face using a selected
/// edge. Returns the count to delete. `out.len` must be >= facecount.
pub fn buildDeleteMask(out: []bool) u32 {
    const fc = model_paint.faceCount();
    if (out.len < fc) return 0;
    @memset(out[0..fc], false);
    switch (g_mode) {
        .face => {
            const sel = g_sel_face orelse return 0;
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                if (f < sel.len and sel[f]) out[f] = true;
            }
        },
        .vertex => {
            if (!ensureTopology()) return 0;
            const sel = g_sel_vert orelse return 0;
            const corners = g_corner_vert orelse return 0;
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                var k: u32 = 0;
                while (k < 3) : (k += 1) {
                    const v = corners[f * 3 + k];
                    if (v < sel.len and sel[v]) {
                        out[f] = true;
                        break;
                    }
                }
            }
        },
        .edge => {
            if (!ensureTopology()) return 0;
            const sel = g_sel_edge orelse return 0;
            const edges = g_edges orelse return 0;
            const corners = g_corner_vert orelse return 0;
            var eset = std.AutoHashMapUnmanaged(u64, void){};
            defer eset.deinit(alloc);
            var e: u32 = 0;
            while (e < g_edge_count) : (e += 1) {
                if (e < sel.len and sel[e]) eset.put(alloc, edgeKey(edges[e * 2], edges[e * 2 + 1]), {}) catch {};
            }
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                const a = corners[f * 3 + 0];
                const b = corners[f * 3 + 1];
                const cc = corners[f * 3 + 2];
                if (eset.contains(edgeKey(a, b)) or eset.contains(edgeKey(b, cc)) or eset.contains(edgeKey(cc, a))) out[f] = true;
            }
        },
        .none => {},
    }
    var count: u32 = 0;
    var i: u32 = 0;
    while (i < fc) : (i += 1) {
        if (out[i]) count += 1;
    }
    return count;
}

/// Select an edge by welded-edge index (no raycast) — used by toolbar/headless flows that
/// need a deterministic edge set for topology operations.
pub fn selectEdgeByIndex(idx: u32, additive: bool) bool {
    if (!ensureTopology()) return false;
    g_mode = .edge;
    const sel = g_sel_edge orelse return false;
    if (idx >= sel.len) return false;
    if (!additive) @memset(sel, false);
    sel[idx] = true;
    applyFaceHighlight(); // leaving face mode removes any face tint
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

/// EXACT weld key: the position quantised to WELD_Q, kept as a 3-int tuple. It MUST be
/// exact (not a hash packed into one integer) — a lossy pack collides for symmetric meshes.
/// A perfect cube's 8 corners are all (±q,±q,±q), and the old `x*C1 ^ y*C2 ^ z*C3` pack
/// XORed those sign-flips down to just 2 distinct values, welding 8 corners into 2 verts
/// (irregular meshes like a scanned GLB never hit the collision, which hid the bug). Keying
/// the AutoHashMap on the [3]i32 itself compares by value, so distinct positions never merge.
fn weldKey(p: [3]f32) [3]i32 {
    return .{
        @intFromFloat(@round(p[0] * WELD_Q)),
        @intFromFloat(@round(p[1] * WELD_Q)),
        @intFromFloat(@round(p[2] * WELD_Q)),
    };
}

/// Weld identity: quantised position PLUS the outliner part the face belongs to. Two
/// stacked cubes are two PARTS — their coincident corners must stay separate logical
/// verts or the gizmo writeback drags both cubes at once (edits "bleed"). Faces within
/// one part (a cube's 6 authored faces) still share the position key and weld normally.
/// With no part ranges set, every face is NO_PART and this degrades to position-only.
const WeldKey = struct { pos: [3]i32, part: u32 };

/// Build (or rebuild) the welded topology from model_paint's CPU triangle positions.
/// Returns false if there's no resident mesh. Idempotent for a given facecount.
fn ensureTopology() bool {
    const fc = model_paint.faceCount();
    if (fc == 0) return false;
    if (g_built_for == fc and g_verts != null) return true;

    var old_face_sel: ?[]bool = null;
    if (g_sel_face) |s| {
        if (s.len == fc) old_face_sel = alloc.dupe(bool, s) catch null;
    }
    defer if (old_face_sel) |s| alloc.free(s);

    reset();

    const pos = model_paint.positions() orelse return false;
    if (pos.len < @as(usize, fc) * 9) return false;

    var weld = std.AutoHashMapUnmanaged(WeldKey, u32){};
    defer weld.deinit(alloc);
    var verts = std.ArrayListUnmanaged(f32){};
    var corner_vert = alloc.alloc(u32, @as(usize, fc) * 3) catch return false;

    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const part = model_source.partIndexOf(model_source.faceGroupOf(f));
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const base = f * 9 + k * 3;
            const p: [3]f32 = .{ pos[base + 0], pos[base + 1], pos[base + 2] };
            const key = WeldKey{ .pos = weldKey(p), .part = part };
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

    // Unique undirected edges from the three corners of every face. emap maps an edge
    // key → its index in `edges`, so the boundary pass below can find an edge from a
    // face's corner pair.
    var emap = std.AutoHashMapUnmanaged(u64, u32){};
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

    // Classify each edge as boundary vs internal (a triangulation diagonal). An internal
    // edge is shared by exactly two faces of the SAME authored group; everything else is a
    // real edge. No grouping → every edge is real (a plain triangle mesh has no diagonals to
    // hide). This is what makes a cube read as 12 edges instead of 18.
    g_edge_boundary = alloc.alloc(bool, g_edge_count) catch return false;
    const boundary = g_edge_boundary.?;
    const has_groups = model_source.faceGroupOf(0) != model_source.NO_FACE_GROUP;
    if (!has_groups) {
        @memset(boundary, true);
    } else {
        @memset(boundary, false);
        const first_group = alloc.alloc(u32, g_edge_count) catch return false;
        defer alloc.free(first_group);
        const seen = alloc.alloc(bool, g_edge_count) catch return false;
        defer alloc.free(seen);
        const incidence = alloc.alloc(u16, g_edge_count) catch return false;
        defer alloc.free(incidence);
        @memset(seen, false);
        @memset(incidence, 0);
        f = 0;
        while (f < fc) : (f += 1) {
            const g = model_source.faceGroupOf(f);
            var k: u32 = 0;
            while (k < 3) : (k += 1) {
                const va = corner_vert[f * 3 + k];
                const vb = corner_vert[f * 3 + (k + 1) % 3];
                if (va == vb) continue;
                const idx = emap.get(edgeKey(va, vb)) orelse continue;
                if (incidence[idx] < std.math.maxInt(u16)) incidence[idx] += 1;
                if (!seen[idx]) {
                    seen[idx] = true;
                    first_group[idx] = g;
                } else if (first_group[idx] != g) {
                    boundary[idx] = true;
                }
            }
        }
        // A naked / non-manifold edge (not shared by exactly two faces) is always real.
        var e: u32 = 0;
        while (e < g_edge_count) : (e += 1) {
            if (incidence[e] != 2) boundary[e] = true;
        }
    }

    g_sel_vert = alloc.alloc(bool, g_vert_count) catch return false;
    g_sel_edge = alloc.alloc(bool, g_edge_count) catch return false;
    g_sel_face = alloc.alloc(bool, fc) catch return false;
    g_affect_vert = alloc.alloc(bool, g_vert_count) catch return false;
    @memset(g_sel_vert.?, false);
    @memset(g_sel_edge.?, false);
    @memset(g_sel_face.?, false);
    @memset(g_affect_vert.?, false);
    if (old_face_sel) |old| {
        if (old.len == g_sel_face.?.len) @memcpy(g_sel_face.?, old);
    }
    if (g_mode == .face) applyFaceHighlight();
    return true;
}

fn edgeKey(a0: u32, b0: u32) u64 {
    const a = @min(a0, b0);
    const b = @max(a0, b0);
    return (@as(u64, a) << 32) | @as(u64, b);
}

fn addEdge(emap: *std.AutoHashMapUnmanaged(u64, u32), edges: *std.ArrayListUnmanaged(u32), a0: u32, b0: u32) void {
    const a = @min(a0, b0);
    const b = @max(a0, b0);
    if (a == b) return;
    const gop = emap.getOrPut(alloc, edgeKey(a, b)) catch return;
    if (gop.found_existing) return;
    gop.value_ptr.* = @intCast(edges.items.len / 2);
    edges.append(alloc, a) catch return;
    edges.append(alloc, b) catch return;
}

/// Is welded edge `e` a boundary edge (a real model edge, not a triangulation diagonal)?
/// True when no topology/grouping is loaded, so callers default to showing every edge.
pub fn edgeIsBoundaryPub(e: u32) bool {
    const b = g_edge_boundary orelse return true;
    return e >= b.len or b[e];
}

/// Count of boundary edges (the ones selection + the overlay actually use).
pub fn boundaryEdgeCount() u32 {
    const b = g_edge_boundary orelse return g_edge_count;
    var n: u32 = 0;
    for (b) |v| {
        if (v) n += 1;
    }
    return n;
}

fn vertPos(i: u32) [3]f32 {
    const v = g_verts.?;
    return .{ v[i * 3 + 0], v[i * 3 + 1], v[i * 3 + 2] };
}

fn vecAdd(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}
fn vecSub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn vecMul(a: [3]f32, s: f32) [3]f32 {
    return .{ a[0] * s, a[1] * s, a[2] * s };
}
fn vecDot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn vecCross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn vecNorm(a: [3]f32) [3]f32 {
    const l = @sqrt(vecDot(a, a));
    if (l < 1e-8) return .{ 0, 0, 0 };
    return .{ a[0] / l, a[1] / l, a[2] / l };
}

fn markAffected(mask: []bool, idx: u32, count: *u32) void {
    if (idx >= mask.len or mask[idx]) return;
    mask[idx] = true;
    count.* += 1;
}

fn fillAffectedVerts() ?[]bool {
    if (!ensureTopology()) return null;
    const mask = g_affect_vert orelse return null;
    @memset(mask, false);
    var count: u32 = 0;
    switch (g_mode) {
        .vertex => {
            const sel = g_sel_vert orelse return null;
            var i: u32 = 0;
            while (i < sel.len) : (i += 1) {
                if (sel[i]) markAffected(mask, i, &count);
            }
        },
        .edge => {
            const sel = g_sel_edge orelse return null;
            const edges = g_edges orelse return null;
            var e: u32 = 0;
            while (e < sel.len and e < g_edge_count) : (e += 1) {
                if (!sel[e]) continue;
                markAffected(mask, edges[e * 2 + 0], &count);
                markAffected(mask, edges[e * 2 + 1], &count);
            }
        },
        .face => {
            const sel = g_sel_face orelse return null;
            const corners = g_corner_vert orelse return null;
            var f: u32 = 0;
            while (f < sel.len) : (f += 1) {
                if (!sel[f]) continue;
                markAffected(mask, corners[f * 3 + 0], &count);
                markAffected(mask, corners[f * 3 + 1], &count);
                markAffected(mask, corners[f * 3 + 2], &count);
            }
        },
        .none => return null,
    }
    return if (count > 0) mask else null;
}

/// Centroid of the logical vertices affected by the active selection. Used by the
/// native transform gizmo as its stable pivot.
pub fn selectionPivot() ?[3]f32 {
    const mask = fillAffectedVerts() orelse return null;
    var sum: [3]f32 = .{ 0, 0, 0 };
    var count: u32 = 0;
    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!mask[i]) continue;
        const p = vertPos(i);
        sum[0] += p[0];
        sum[1] += p[1];
        sum[2] += p[2];
        count += 1;
    }
    if (count == 0) return null;
    const inv = 1.0 / @as(f32, @floatFromInt(count));
    return .{ sum[0] * inv, sum[1] * inv, sum[2] * inv };
}

const TransformKind = enum { translate, scale_axis, rotate_axis };

fn transformPoint(kind: TransformKind, p: [3]f32, delta: [3]f32, axis: [3]f32, pivot: [3]f32, scalar: f32) [3]f32 {
    return switch (kind) {
        .translate => vecAdd(p, delta),
        .scale_axis => blk: {
            const rel = vecSub(p, pivot);
            const along = vecDot(rel, axis);
            break :blk vecAdd(p, vecMul(axis, along * (scalar - 1.0)));
        },
        .rotate_axis => blk: {
            const rel = vecSub(p, pivot);
            const c = @cos(scalar);
            const s = @sin(scalar);
            const term1 = vecMul(rel, c);
            const term2 = vecMul(vecCross(axis, rel), s);
            const term3 = vecMul(axis, vecDot(axis, rel) * (1.0 - c));
            break :blk vecAdd(pivot, vecAdd(vecAdd(term1, term2), term3));
        },
    };
}

fn applyTransform(kind: TransformKind, delta: [3]f32, axis_raw: [3]f32, pivot: [3]f32, scalar: f32) Mutation {
    const mask = fillAffectedVerts() orelse return .{};
    const axis = vecNorm(axis_raw);
    if ((kind == .scale_axis or kind == .rotate_axis) and vecDot(axis, axis) < 0.5) return .{};
    const verts = g_verts orelse return .{};
    const corners = g_corner_vert orelse return .{};
    const pos = model_paint.positionsMutable() orelse return .{};

    var i: u32 = 0;
    while (i < g_vert_count) : (i += 1) {
        if (!mask[i]) continue;
        const p = vertPos(i);
        const np = transformPoint(kind, p, delta, axis, pivot, scalar);
        verts[i * 3 + 0] = np[0];
        verts[i * 3 + 1] = np[1];
        verts[i * 3 + 2] = np[2];
    }

    const fc = model_paint.faceCount();
    var out = Mutation{ .first_face = fc, .last_face = 0 };
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        var touched = false;
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const lv = corners[f * 3 + k];
            if (lv >= mask.len or !mask[lv]) continue;
            const dst = f * 9 + k * 3;
            const src = lv * 3;
            if (@as(usize, dst) + 2 >= pos.len) continue;
            pos[dst + 0] = verts[src + 0];
            pos[dst + 1] = verts[src + 1];
            pos[dst + 2] = verts[src + 2];
            touched = true;
        }
        if (touched) {
            if (f < out.first_face) out.first_face = f;
            if (f > out.last_face) out.last_face = f;
            out.changed = true;
        }
    }
    if (!out.changed) return .{};
    return out;
}

pub fn translateSelection(delta: [3]f32) Mutation {
    if (@abs(delta[0]) + @abs(delta[1]) + @abs(delta[2]) < 1e-8) return .{};
    return applyTransform(.translate, delta, .{ 1, 0, 0 }, .{ 0, 0, 0 }, 0);
}

pub fn scaleSelectionAxis(axis: [3]f32, pivot: [3]f32, factor_raw: f32) Mutation {
    const factor = std.math.clamp(factor_raw, 0.02, 50.0);
    if (@abs(factor - 1.0) < 1e-5) return .{};
    return applyTransform(.scale_axis, .{ 0, 0, 0 }, axis, pivot, factor);
}

pub fn rotateSelectionAxis(axis: [3]f32, pivot: [3]f32, radians: f32) Mutation {
    if (@abs(radians) < 1e-6) return .{};
    return applyTransform(.rotate_axis, .{ 0, 0, 0 }, axis, pivot, radians);
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

    var hit: i32 = switch (g_mode) {
        .face => model_paint.pick(cam, vp_w, vp_h, mx, my),
        .vertex => pickVertex(cam, vp_w, vp_h, mx, my),
        .edge => pickEdge(cam, vp_w, vp_h, mx, my),
        .none => -1,
    };
    // A face pick raycasts the whole mesh; drop it if the hit face is outside the focused
    // part (vertex/edge picks already skip out-of-scope elements). (req_2415)
    if (g_mode == .face and hit >= 0 and !faceInScope(@intCast(hit))) hit = -1;

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
        if (g_mode == .face) {
            // Studio faces arrive fan-triangulated, so a face pick grabs the whole
            // authored n-gon (every triangle sharing its group), not one sliver.
            if (additive) {
                const want = if (idx < set.len) !set[idx] else true;
                setFaceGroup(set, idx, want);
            } else {
                @memset(set, false);
                restoreAllFaces();
                setFaceGroup(set, idx, true);
            }
        } else if (additive) {
            if (idx < set.len) set[idx] = !set[idx];
        } else {
            // Replace: clear the active set, select just this one.
            @memset(set, false);
            if (idx < set.len) set[idx] = true;
        }
    }
    if (g_mode == .face) applyFaceHighlight();
    return @intCast(selCount());
}

/// Set every displayed face sharing `idx`'s authored-face group (model_source), so one
/// pick selects a whole fan-triangulated n-gon. No grouping loaded → just the one face.
fn setFaceGroup(set: []bool, idx: u32, value: bool) void {
    const group = model_source.faceGroupOf(idx);
    if (group == model_source.NO_FACE_GROUP) {
        if (idx < set.len) set[idx] = value;
        return;
    }
    var f: u32 = 0;
    const fc: u32 = @intCast(set.len);
    while (f < fc) : (f += 1) {
        if (model_source.faceGroupOf(f) == group) set[f] = value;
    }
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
                if (!faceInScope(f)) continue; // outside the focused part
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
                if (!vertInScopePub(i)) continue; // outside the focused part
                if (inRect(model_paint.project(cam, vp_w, vp_h, vertPos(i)), minx, maxx, miny, maxy)) set[i] = true;
            }
        },
        .edge => {
            const edges = g_edges.?;
            var e: u32 = 0;
            while (e < g_edge_count) : (e += 1) {
                if (!edgeIsBoundaryPub(e)) continue; // diagonals aren't real edges
                if (!edgeInScopePub(e)) continue; // outside the focused part
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
        if (!vertInScopePub(i)) continue; // outside the focused part
        const sp = model_paint.project(cam, vp_w, vp_h, vertPos(i)) orelse continue;
        const dx = sp[0] - mx;
        const dy = sp[1] - my;
        const d2 = dx * dx + dy * dy;
        // Only a candidate that beats the best AND is actually visible (not hidden behind the
        // surface) can win — so you never pick a vertex on the far side you can't see. The
        // occlusion raycast runs only for the few in-radius candidates, so a click stays cheap.
        if (d2 < best_d2 and !model_paint.occluded(cam, vertPos(i))) {
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
        if (!edgeIsBoundaryPub(e)) continue; // diagonals aren't real edges — not pickable
        if (!edgeInScopePub(e)) continue; // outside the focused part
        const va = vertPos(edges[e * 2 + 0]);
        const vb = vertPos(edges[e * 2 + 1]);
        const a = model_paint.project(cam, vp_w, vp_h, va) orelse continue;
        const b = model_paint.project(cam, vp_w, vp_h, vb) orelse continue;
        const d2 = segDist2(mx, my, a[0], a[1], b[0], b[1]);
        if (d2 < best_d2) {
            // Visible if the midpoint isn't behind the surface (an edge across the silhouette
            // stays pickable; one wholly on the far side does not).
            const mid: [3]f32 = .{ (va[0] + vb[0]) * 0.5, (va[1] + vb[1]) * 0.5, (va[2] + vb[2]) * 0.5 };
            if (model_paint.occluded(cam, mid)) continue;
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
        if (g_face_base.get(f)) |patch| {
            model_paint.restoreFacePatch(f, patch);
            alloc.free(patch);
        }
        _ = g_face_base.remove(f);
    }
    // Tint newly selected faces — save the face's whole island rect (sized PER FACE
    // now: islands give big faces big rects) so free-form paint survives.
    var f: u32 = 0;
    while (f < sel.len) : (f += 1) {
        if (!sel[f]) continue;
        if (g_face_base.contains(f)) continue;
        const plen = model_paint.facePatchLen(f);
        if (plen == 0) continue;
        const patch = alloc.alloc(u8, plen) catch continue;
        if (!model_paint.saveFacePatch(f, patch)) {
            alloc.free(patch);
            continue;
        }
        g_face_base.put(alloc, f, patch) catch {
            alloc.free(patch);
            continue;
        };
        model_paint.tintFacePatch(f, SELECT_TINT, SELECT_MIX);
    }
}

fn restoreAllFaces() void {
    var it = g_face_base.iterator();
    while (it.next()) |entry| {
        model_paint.restoreFacePatch(entry.key_ptr.*, entry.value_ptr.*);
        alloc.free(entry.value_ptr.*);
    }
    g_face_base.clearRetainingCapacity();
}

// ── Loop cut (plane split of a triangle soup) ────────────────────────────────────
// The host mesh editor keeps the live mesh as a non-indexed triangle soup (positions
// only matter here — normals are recomputed and UVs rewritten on install). A loop cut is
// a PLANE split of that soup: every triangle straddling the plane is sliced, the two
// halves keep their outward winding, and — when the mesh carries authored face grouping
// (studio EditMesh, one id per source face) — each crossed face splits into TWO
// independently-grouped faces (negative side keeps its id, positive side gets a fresh
// one). That keeps the result reading as clean n-gons, exactly like the Studio's
// loopCut(EditMesh) does, but on the resident host mesh so it stays fast on big meshes.
// This is PURE (no wgpu, no globals) so it unit-tests standalone; 3d.zig derives the
// cut plane from the selected edge and installs the result.
pub const CutResult = struct { positions: []f32, groups: ?[]u32, tri_count: u32 };

const CUT_EPS: f32 = 1e-5;

fn triArea2Local(a: [3]f32, b: [3]f32, c: [3]f32) f32 {
    const cr = vecCross(vecSub(b, a), vecSub(c, a));
    return vecDot(cr, cr);
}

fn emitTriPos(list: *std.ArrayListUnmanaged(f32), a: [3]f32, b: [3]f32, c: [3]f32) bool {
    inline for (.{ a, b, c }) |v| {
        list.append(alloc, v[0]) catch return false;
        list.append(alloc, v[1]) catch return false;
        list.append(alloc, v[2]) catch return false;
    }
    return true;
}

fn remapGroup(remap: *std.AutoHashMapUnmanaged(u32, u32), og: u32, next_id: *u32) u32 {
    if (og == model_source.NO_FACE_GROUP) return og;
    const gop = remap.getOrPut(alloc, og) catch return og;
    if (!gop.found_existing) {
        gop.value_ptr.* = next_id.*;
        next_id.* += 1;
    }
    return gop.value_ptr.*;
}

/// Sutherland–Hodgman clip of one triangle to a half-space of the plane. keep_positive
/// keeps the side where the signed distance is >= 0, else the <= 0 side. On-plane corners
/// are kept on BOTH sides (shared cut points); a strictly-crossed edge contributes one
/// interpolated point. A single plane cuts a triangle into a convex polygon of <= 4 verts.
fn planeClipSide(p: [3][3]f32, s: [3]f32, keep_positive: bool, out: *[4][3]f32) u32 {
    var n_out: u32 = 0;
    var i: usize = 0;
    while (i < 3) : (i += 1) {
        const cur = p[i];
        const cs = s[i];
        const j = (i + 1) % 3;
        const ns = s[j];
        const cur_in = if (keep_positive) cs >= -CUT_EPS else cs <= CUT_EPS;
        if (cur_in and n_out < 4) {
            out[n_out] = cur;
            n_out += 1;
        }
        const cross = (cs > CUT_EPS and ns < -CUT_EPS) or (cs < -CUT_EPS and ns > CUT_EPS);
        if (cross and n_out < 4) {
            const t = cs / (cs - ns);
            const nx = p[j];
            out[n_out] = .{ cur[0] + (nx[0] - cur[0]) * t, cur[1] + (nx[1] - cur[1]) * t, cur[2] + (nx[2] - cur[2]) * t };
            n_out += 1;
        }
    }
    return n_out;
}

/// Plane-cut a non-indexed triangle soup (`pos` = tri_count*9 floats, positions only) by
/// the plane {p : dot(n,p) = d}. Returns a fresh soup (caller frees .positions and, if
/// present, .groups). When groups_in is given (one id per input tri), the result carries
/// one id per OUTPUT tri with the negative/positive split described above; null ⇒ no
/// grouping is produced. Returns null only on allocation failure.
pub fn planeCutSoup(pos: []const f32, tri_count: u32, n: [3]f32, d: f32, groups_in: ?[]const u32) ?CutResult {
    var out_pos = std.ArrayListUnmanaged(f32){};
    var out_grp = std.ArrayListUnmanaged(u32){};
    const want_groups = groups_in != null;

    var remap = std.AutoHashMapUnmanaged(u32, u32){};
    defer remap.deinit(alloc);
    var next_id: u32 = 0;
    if (groups_in) |g| {
        var mx: u32 = 0;
        const lim = @min(@as(usize, tri_count), g.len);
        for (g[0..lim]) |v| {
            if (v != model_source.NO_FACE_GROUP and v > mx) mx = v;
        }
        next_id = mx + 1;
    }

    var f: u32 = 0;
    while (f < tri_count) : (f += 1) {
        const base = @as(usize, f) * 9;
        if (base + 8 >= pos.len) break;
        const p = [3][3]f32{
            .{ pos[base + 0], pos[base + 1], pos[base + 2] },
            .{ pos[base + 3], pos[base + 4], pos[base + 5] },
            .{ pos[base + 6], pos[base + 7], pos[base + 8] },
        };
        const s = [3]f32{
            n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2] - d,
            n[0] * p[1][0] + n[1] * p[1][1] + n[2] * p[1][2] - d,
            n[0] * p[2][0] + n[1] * p[2][1] + n[2] * p[2][2] - d,
        };
        var strict_neg: u32 = 0;
        var strict_pos: u32 = 0;
        for (s) |v| {
            if (v > CUT_EPS) strict_pos += 1;
            if (v < -CUT_EPS) strict_neg += 1;
        }
        const og: u32 = if (groups_in) |g| (if (f < g.len) g[f] else model_source.NO_FACE_GROUP) else 0;

        if (strict_pos == 0 or strict_neg == 0) {
            // Entirely on one side (or coplanar) — copy unchanged, grouped by side.
            if (!emitTriPos(&out_pos, p[0], p[1], p[2])) return null;
            if (want_groups) {
                const gid = if (strict_pos == 0) og else remapGroup(&remap, og, &next_id);
                out_grp.append(alloc, gid) catch return null;
            }
        } else {
            // Straddles the plane — clip each side and fan-triangulate, dropping slivers.
            inline for (.{ false, true }) |keep_pos| {
                var poly: [4][3]f32 = undefined;
                const cnt = planeClipSide(p, s, keep_pos, &poly);
                var k: u32 = 1;
                while (k + 1 < cnt) : (k += 1) {
                    if (triArea2Local(poly[0], poly[k], poly[k + 1]) < 1e-14) continue;
                    if (!emitTriPos(&out_pos, poly[0], poly[k], poly[k + 1])) return null;
                    if (want_groups) {
                        const gid = if (keep_pos) remapGroup(&remap, og, &next_id) else og;
                        out_grp.append(alloc, gid) catch return null;
                    }
                }
            }
        }
    }

    const tris: u32 = @intCast(out_pos.items.len / 9);
    const positions = out_pos.toOwnedSlice(alloc) catch return null;
    const groups: ?[]u32 = if (want_groups) (out_grp.toOwnedSlice(alloc) catch null) else null;
    return CutResult{ .positions = positions, .groups = groups, .tri_count = tris };
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

test "planeCutSoup splits a crossing triangle and regroups the positive side" {
    // Triangle (0,0)-(2,0)-(2,2) on z=0, cut by the plane x=1 (n=+X, d=1).
    var pos = [_]f32{ 0, 0, 0, 2, 0, 0, 2, 2, 0 };
    const groups = [_]u32{5};
    const r = planeCutSoup(pos[0..], 1, .{ 1, 0, 0 }, 1.0, groups[0..]).?;
    defer {
        alloc.free(r.positions);
        if (r.groups) |g| alloc.free(g);
    }
    // Negative side is one small triangle; positive side is a quad → 2 triangles.
    try testing.expectEqual(@as(u32, 3), r.tri_count);
    const g = r.groups.?;
    try testing.expectEqual(@as(usize, 3), g.len);
    var neg: u32 = 0;
    var new: u32 = 0;
    for (g) |v| {
        if (v == 5) neg += 1;
        if (v == 6) new += 1; // one fresh id above the max existing group (5)
    }
    try testing.expectEqual(@as(u32, 1), neg); // negative half keeps the source id
    try testing.expectEqual(@as(u32, 2), new); // positive half gets the new id
}

test "planeCutSoup leaves a non-crossing triangle whole" {
    // Same triangle, plane x=5 well past it → untouched, keeps its group.
    var pos = [_]f32{ 0, 0, 0, 2, 0, 0, 2, 2, 0 };
    const groups = [_]u32{9};
    const r = planeCutSoup(pos[0..], 1, .{ 1, 0, 0 }, 5.0, groups[0..]).?;
    defer {
        alloc.free(r.positions);
        if (r.groups) |g| alloc.free(g);
    }
    try testing.expectEqual(@as(u32, 1), r.tri_count);
    try testing.expectEqual(@as(u32, 9), r.groups.?[0]);
}

// A unit-cube triangle soup (6 quads → 12 tris → 36 interleaved verts), the exact shape
// primitiveMeshData feeds the host. Each quad is fan-split (shared diagonal), matching how a
// Studio cube triangulates.
fn buildCubeSoup(soup: *[12 * 3 * 8]f32) void {
    const c = [8][3]f32{
        .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
        .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
    };
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 }, .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    var w: usize = 0;
    for (quads) |q| {
        const tri = [6]u32{ q[0], q[1], q[2], q[0], q[2], q[3] };
        for (tri) |vi| {
            const p = c[vi];
            soup[w + 0] = p[0];
            soup[w + 1] = p[1];
            soup[w + 2] = p[2];
            soup[w + 3] = 0;
            soup[w + 4] = 0;
            soup[w + 5] = 1;
            soup[w + 6] = 0;
            soup[w + 7] = 0;
            w += 8;
        }
    }
}

test "symmetric cube welds to 8 verts + 18 edges (weld key must be exact, not a lossy hash)" {
    // The old x*C1 ^ y*C2 ^ z*C3 pack collapsed the cube's symmetric ±0.5 corners to 2 keys
    // → welded 8 corners into 2 verts (the "1 edge" cube bug).
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    model_paint.setTarget(778, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 8), vertCount());
    try testing.expectEqual(@as(u32, 18), edgeCount()); // 12 cube edges + 6 quad diagonals
}

test "grouped cube exposes 12 boundary edges — the 6 quad diagonals are hidden" {
    var soup: [12 * 3 * 8]f32 = undefined;
    buildCubeSoup(&soup);
    // One authored-face id per SOURCE triangle: the two tris of each quad share a group.
    const groups = [12]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(779, soup[0..], 36);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 18), edgeCount()); // topology still has all 18 welded edges
    try testing.expectEqual(@as(u32, 12), boundaryEdgeCount()); // but only 12 are REAL edges
}

test "two coincident cubes in DIFFERENT parts weld to 16 verts, not 8" {
    // The "edits bleed across stacked parts" bug: two identical cubes composed at the
    // origin. Position-only welding merged their corners into 8 shared logical verts, so
    // the gizmo moving cube 2's vert dragged cube 1 too. With part ranges set, the weld
    // keys on (position, part) and each cube keeps its own 8 verts.
    var soup: [2 * 12 * 3 * 8]f32 = undefined;
    buildCubeSoup(soup[0 .. 12 * 3 * 8]);
    buildCubeSoup(soup[12 * 3 * 8 ..][0 .. 12 * 3 * 8]);
    // Cube 1 owns groups 0..6, cube 2 owns groups 6..12 (two tris per authored quad).
    var groups: [24]u32 = undefined;
    for (&groups, 0..) |*g, i| g.* = @intCast(i / 2);
    model_source.setFaceGroups(groups[0..]);
    model_paint.setTarget(780, soup[0..], 72);
    defer {
        reset();
        model_paint.clear();
        model_source.clear();
    }

    // No part ranges → coincident corners weld across the cubes (the old behaviour).
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 8), vertCount());

    // Part ranges [0,6) and [6,12) → each cube welds independently: 16 verts, 36 edges.
    model_source.setPartRanges(&[_]u32{ 0, 6, 6, 12 });
    reset();
    try testing.expect(ensureTopology());
    try testing.expectEqual(@as(u32, 16), vertCount());
    try testing.expectEqual(@as(u32, 36), edgeCount()); // 18 welded edges per cube
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

test "edge selection by index sets edge mode and supports additive sets" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(selectEdgeByIndex(0, false));
    try testing.expectEqual(Mode.edge, mode());
    try testing.expectEqual(@as(u32, 1), selCount());
    try testing.expectEqual(@as(u32, 1), selectedEdgeCountPub());
    try testing.expect(selectEdgeByIndex(1, true));
    try testing.expectEqual(@as(u32, 2), selectedEdgeCountPub());
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

test "face selection transform moves welded shared corners" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    try testing.expect(selectFaceByIndex(0, false));
    const pivot = selectionPivot().?;
    try testing.expectApproxEqAbs(@as(f32, 2.0 / 3.0), pivot[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 1.0 / 3.0), pivot[1], 0.0001);

    const m = translateSelection(.{ 0, 0, 2 });
    try testing.expect(m.changed);
    try testing.expectEqual(@as(u32, 0), m.first_face);
    try testing.expectEqual(@as(u32, 1), m.last_face);

    const pos = model_paint.positions().?;
    // Face 0's three logical vertices moved.
    try testing.expectApproxEqAbs(@as(f32, 2), pos[2], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), pos[5], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), pos[8], 0.0001);
    // Face 1 shares (0,0) and (1,1), so those corners move too; its unique (0,1) stays.
    try testing.expectApproxEqAbs(@as(f32, 2), pos[11], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 2), pos[14], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), pos[17], 0.0001);
}

test "axis scale and rotate operate around the selection pivot" {
    setupQuad();
    defer {
        reset();
        model_paint.clear();
    }
    setMode(.vertex);
    try testing.expect(ensureTopology());
    g_sel_vert.?[0] = true; // (0,0,0)
    g_sel_vert.?[1] = true; // (1,0,0)

    const pivot = selectionPivot().?;
    try testing.expectApproxEqAbs(@as(f32, 0.5), pivot[0], 0.0001);
    _ = scaleSelectionAxis(.{ 1, 0, 0 }, pivot, 2.0);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(0)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 1.5), vertPos(1)[0], 0.0001);

    _ = rotateSelectionAxis(.{ 0, 0, 1 }, pivot, std.math.pi);
    try testing.expectApproxEqAbs(@as(f32, 1.5), vertPos(0)[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, -0.5), vertPos(1)[0], 0.0001);
}
