//! Host-side painting for the model viewer (the Studio mesh-editor path).
//!
//! The paint MODEL is the proven studio painter's, ported host-native (USER RULING
//! req_2515/req_2516): each AUTHORED FACE (face-group) is one UV ISLAND sized by its
//! physical footprint × a texels-per-METER density (Blockbench 16x semantics), laid
//! out by paint_islands.zig. So a big sign face gets the texels to write a word on,
//! and a stroke travels ONE continuous texture space across the whole face — no
//! per-triangle patches, no shredding at the diagonal. Ungrouped triangles (raw
//! imports) each get their own area-proportional island through the same path.
//!
//! What stays from the host-native design:
//!   • the atlas rides the EXISTING scene3d diffuse-texture path — zero shader change;
//!   • picking is a real raycast against the visible triangle, so you paint exactly
//!     the face under the cursor (no projection mismatch);
//!   • paint mutates the atlas in place; the GPU re-uploads only the dirty row band.
//!
//! Dabs land by BARYCENTRIC interpolation of the face's island-space corner texels
//! (Layout.corner_uv) — position-independent, so paint keeps working after a gizmo
//! move, and both halves of a quad share one continuous island space by construction.
//!
//! The viewer paints ONE model at a time, so the state here is a single active target
//! keyed by the mesh's intern-key hash. 3d.zig owns the camera + viewport + GPU upload
//! and drives this module; the math + paint buffer live here so they stay testable.

const std = @import("std");
const model_source = @import("model_source.zig");
const paint_islands = @import("paint_islands.zig");

const alloc = std.heap.c_allocator;

// ── Active paint target ─────────────────────────────────────────────────────────
var g_key_hash: u64 = 0; // intern-key hash of the mesh being painted
var g_positions: ?[]f32 = null; // facecount*9 floats: 3 verts (xyz) per face, model space
var g_facecount: u32 = 0;
var g_atlas_w: u32 = 0;
var g_atlas_h: u32 = 0;
// The island layout (paint_islands.zig): one island per authored face, sized by its
// physical footprint × density. corner_uv is the face→atlas map every paint op uses.
var g_layout: ?paint_islands.Layout = null;
// island → its triangles, CSR-packed: island i's triangles are
// g_isl_tris[g_isl_start[i] .. g_isl_start[i+1]]. Stamp clipping walks these — a dab
// is clipped to the island's whole silhouette, so strokes cross a quad's diagonal.
var g_isl_start: ?[]u32 = null;
var g_isl_tris: ?[]u32 = null;
// Requested texels-per-METER (Blockbench 16x semantics). Carries across meshes (edits
// keep their density); paint_islands.build self-clamps it per mesh to the GPU limits.
var g_density_req: f32 = 1.0;
// FIT mode (the proven painter's fidelity law, req_1299/req_2518): when set, the
// density is DERIVED so the whole model's islands fill a g_fit_req² atlas — a lone
// cube gets writing-grade texels, a whole car divides the same budget. Wins over
// g_density_req while set; an explicit setDetail clears it.
var g_fit_req: ?u32 = null;
// Dab/fill coverage claims edge texels slightly OUTSIDE the triangle (covers the
// half-texel corner inset + softens island borders under linear filtering)…
const PAINT_EPS: f32 = 0.75;
// …but the selection tint stays strictly inside its triangle, so tinting face A never
// touches texels face B's save/restore owns — deselect order can't leave residue.
const TINT_EPS: f32 = 0.0;
// The atlas IS the source of truth — a paint writes straight here (no separate per-face
// array, no full rebuild). The GPU re-uploads only the DIRTY ROW BAND since the last
// frame, so painting a 400k-tri model uploads one row band, not the whole texture.
var g_rgba: ?[]u8 = null; // atlas_w*atlas_h*4 — the diffuse texture, mutated in place
var g_dirty_lo: u32 = 0; // inclusive dirty-row range; lo > hi ⇒ nothing to upload
var g_dirty_hi: u32 = 0;
var g_has_dirty: bool = false;

/// Unpainted faces read as this neutral light grey, so a freshly-loaded model looks
/// the same as the plain shaded viewer until you paint it.
pub const DEFAULT_FACE: [4]u8 = .{ 200, 200, 205, 255 };

fn markRows(lo: u32, hi: u32) void {
    if (!g_has_dirty) {
        g_dirty_lo = lo;
        g_dirty_hi = hi;
        g_has_dirty = true;
    } else {
        if (lo < g_dirty_lo) g_dirty_lo = lo;
        if (hi > g_dirty_hi) g_dirty_hi = hi;
    }
}

/// The atlas rows changed since the last call (inclusive [lo,hi]), or null if none.
/// The GPU side uploads exactly this band and nothing else. Clears the pending range.
pub fn consumeDirtyRows() ?[2]u32 {
    if (!g_has_dirty) return null;
    const r = [2]u32{ g_dirty_lo, g_dirty_hi };
    g_has_dirty = false;
    return r;
}

/// Wipe the atlas back to the default face colour on every texel (all rows dirty) — the
/// blank canvas a paint-program replay paints onto. No-op if there's no atlas.
pub fn clearAtlas() void {
    const buf = g_rgba orelse return;
    var i: usize = 0;
    while (i < buf.len) : (i += 4) {
        buf[i + 0] = DEFAULT_FACE[0];
        buf[i + 1] = DEFAULT_FACE[1];
        buf[i + 2] = DEFAULT_FACE[2];
        buf[i + 3] = DEFAULT_FACE[3];
    }
    g_has_dirty = false;
    if (g_atlas_h > 0) markRows(0, g_atlas_h - 1);
    // Lay the CHOSEN atlas base (Texture Template / Solid Color / Blank) over the background,
    // so the sheet has tone and replaying a saved painting rebuilds the same base under it
    // (req_2537, req_2546). Template regenerates deterministically from the island layout.
    if (g_layout != null) applyBase();
}

pub fn hasTarget() bool {
    return g_positions != null;
}
pub fn isTarget(key_hash: u64) bool {
    return g_positions != null and key_hash == g_key_hash;
}
pub fn faceCount() u32 {
    return g_facecount;
}

// ── Atlas geometry: face → island texels ─────────────────────────────────────────
/// A face's three corners in ABSOLUTE atlas-texel coordinates (Layout.corner_uv).
fn triTexelCorners(lay: *const paint_islands.Layout, face: u32) [3][2]f32 {
    const base = @as(usize, face) * 6;
    return .{
        .{ lay.corner_uv[base + 0], lay.corner_uv[base + 1] },
        .{ lay.corner_uv[base + 2], lay.corner_uv[base + 3] },
        .{ lay.corner_uv[base + 4], lay.corner_uv[base + 5] },
    };
}

/// A face's island-space centroid texel, clamped into the atlas — the face's
/// representative texel (faceColor reads it; paintFace always writes it).
fn faceCentroidTexel(lay: *const paint_islands.Layout, face: u32) [2]u32 {
    const c = triTexelCorners(lay, face);
    const gx = (c[0][0] + c[1][0] + c[2][0]) / 3.0;
    const gy = (c[0][1] + c[1][1] + c[2][1]) / 3.0;
    const tx: u32 = @intFromFloat(std.math.clamp(@floor(gx), 0, @as(f32, @floatFromInt(g_atlas_w - 1))));
    const ty: u32 = @intFromFloat(std.math.clamp(@floor(gy), 0, @as(f32, @floatFromInt(g_atlas_h - 1))));
    return .{ tx, ty };
}

/// Is the point (px,py) inside the triangle, expanded outward by `eps` texels of
/// SIGNED DISTANCE per edge? A triangle degenerate in texel space (a sliver, or a
/// ≤1-texel island at low density) falls back to "near the centroid" so the face
/// still owns its representative texel.
fn pointInTri(c: [3][2]f32, px: f32, py: f32, eps: f32) bool {
    const area2 = (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]);
    if (@abs(area2) < 0.1) {
        const gx = (c[0][0] + c[1][0] + c[2][0]) / 3.0;
        const gy = (c[0][1] + c[1][1] + c[2][1]) / 3.0;
        const dx = px - gx;
        const dy = py - gy;
        const r = 0.75 + eps;
        return dx * dx + dy * dy <= r * r;
    }
    const s: f32 = if (area2 > 0) 1.0 else -1.0;
    var k: u32 = 0;
    while (k < 3) : (k += 1) {
        const a = c[k];
        const b = c[(k + 1) % 3];
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const e = (ex * (py - a[1]) - ey * (px - a[0])) * s;
        const len = @sqrt(ex * ex + ey * ey);
        if (e < -eps * len) return false;
    }
    return true;
}

/// Is the point inside ANY triangle of the island — the island's silhouette. A dab is
/// clipped to this (not to one triangle), so a stroke crosses the diagonal seamlessly
/// but still never bleeds past the authored face's boundary.
fn pointInIsland(lay: *const paint_islands.Layout, isl_idx: u32, px: f32, py: f32, eps: f32) bool {
    const starts = g_isl_start orelse return false;
    const tris = g_isl_tris orelse return false;
    var i = starts[isl_idx];
    const end_ = starts[isl_idx + 1];
    while (i < end_) : (i += 1) {
        if (pointInTri(triTexelCorners(lay, tris[i]), px, py, eps)) return true;
    }
    return false;
}

/// The face triangle's integer texel bounds (inclusive), expanded by `expand` texels and
/// clamped to its island rect — the iteration window for fills/tints/saves. The island
/// clamp means edge bleed can reach the pad gutter but never a NEIGHBOUR island.
fn faceTexelBounds(lay: *const paint_islands.Layout, face: u32, expand: f32) [4]u32 {
    const c = triTexelCorners(lay, face);
    const isl = lay.islands[lay.tri_island[face]];
    var min_x = @min(c[0][0], @min(c[1][0], c[2][0])) - expand;
    var min_y = @min(c[0][1], @min(c[1][1], c[2][1])) - expand;
    var max_x = @max(c[0][0], @max(c[1][0], c[2][0])) + expand;
    var max_y = @max(c[0][1], @max(c[1][1], c[2][1])) + expand;
    min_x = @max(min_x, @as(f32, @floatFromInt(isl.x)));
    min_y = @max(min_y, @as(f32, @floatFromInt(isl.y)));
    max_x = @min(max_x, @as(f32, @floatFromInt(isl.x + isl.w)) - 1.0);
    max_y = @min(max_y, @as(f32, @floatFromInt(isl.y + isl.h)) - 1.0);
    if (max_x < min_x or max_y < min_y) {
        const ct = faceCentroidTexel(lay, face);
        return .{ ct[0], ct[1], ct[0], ct[1] };
    }
    return .{
        @intFromFloat(@max(0, @floor(min_x))),
        @intFromFloat(@max(0, @floor(min_y))),
        @intFromFloat(@max(0, @floor(max_x))),
        @intFromFloat(@max(0, @floor(max_y))),
    };
}

/// Adopt a freshly-parsed mesh as the paint target. Builds the ISLAND layout at the
/// carried density, REWRITES each vertex's uv (in the caller's interleaved buffer,
/// 8 f32/vert) to its island texel, captures CPU positions for raycasting, and resets
/// every face to the default grey. Call BEFORE the verts are uploaded to the GPU so
/// the island UVs ship with the mesh.
///
/// NOTE the load order: model_source face groups usually arrive AFTER this (the
/// __mesh_set_face_groups door / a topo op's re-grouping), so this first layout may be
/// all-loose. The groups setter triggers scene3d.refreshPaintLayout → rebuildLayout,
/// which re-islands by authored face.
pub fn setTarget(key_hash: u64, verts: []f32, vert_count: u32) void {
    clear();
    if (vert_count < 3) return;
    const fc = vert_count / 3;
    g_key_hash = key_hash;
    g_facecount = fc;

    // CPU positions for raycasting (9 floats/face).
    const pos = alloc.alloc(f32, @as(usize, fc) * 9) catch return;
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        var k: u32 = 0;
        while (k < 3) : (k += 1) {
            const vi = f * 3 + k;
            pos[f * 9 + k * 3 + 0] = verts[vi * 8 + 0];
            pos[f * 9 + k * 3 + 1] = verts[vi * 8 + 1];
            pos[f * 9 + k * 3 + 2] = verts[vi * 8 + 2];
        }
    }
    g_positions = pos;

    rebuildLayoutInner(verts, vert_count, false);
}

/// Rebuild the island layout for the CURRENT target at the current density — the entry
/// 3d.zig calls when the authored face groups land (they arrive after setTarget) or the
/// density changes. Carries each face's base colour as a flat fill (sub-face strokes
/// come back via stroke-program replay, the durable form). Rewrites the caller's vertex
/// UVs in place; the caller re-uploads the mesh.
pub fn rebuildLayout(verts: []f32, vert_count: u32) void {
    if (g_positions == null) return;
    if (vert_count / 3 != g_facecount or g_facecount == 0) return;
    rebuildLayoutInner(verts, vert_count, true);
}

fn freeLayoutState() void {
    if (g_layout) |*l| l.deinit(alloc);
    g_layout = null;
    if (g_isl_start) |s| alloc.free(s);
    g_isl_start = null;
    if (g_isl_tris) |t| alloc.free(t);
    g_isl_tris = null;
    if (g_rgba) |r| alloc.free(r);
    g_rgba = null;
    g_atlas_w = 0;
    g_atlas_h = 0;
    g_has_dirty = false;
}

/// One authored-group id per displayed triangle, from model_source (NO_FACE_GROUP and
/// paint_islands.NO_GROUP are both maxInt(u32), so loose triangles pass through).
fn collectFaceGroups(fc: u32) ?[]u32 {
    const groups = alloc.alloc(u32, fc) catch return null;
    var f: u32 = 0;
    while (f < fc) : (f += 1) groups[f] = model_source.faceGroupOf(f);
    return groups;
}

fn rebuildLayoutInner(verts: []f32, vert_count: u32, carry: bool) void {
    const fc = g_facecount;
    const pos = g_positions orelse return;

    // Snapshot per-face base colours before the old layout goes away.
    var snap: ?[]u8 = null;
    if (carry and g_rgba != null) {
        if (alloc.alloc(u8, @as(usize, fc) * 4)) |s| {
            var f: u32 = 0;
            while (f < fc) : (f += 1) {
                const col = faceColor(f) orelse DEFAULT_FACE;
                s[f * 4 + 0] = col[0];
                s[f * 4 + 1] = col[1];
                s[f * 4 + 2] = col[2];
                s[f * 4 + 3] = col[3];
            }
            snap = s;
        } else |_| {}
    }
    defer if (snap) |s| alloc.free(s);

    const groups = collectFaceGroups(fc);
    defer if (groups) |g| alloc.free(g);

    freeLayoutState();
    // FIT mode derives the density from the model's own extent (the proven painter's
    // fidelity law); plain mode uses the carried texels/meter as-is.
    const built = if (g_fit_req) |ft|
        paint_islands.buildFit(alloc, pos[0 .. @as(usize, fc) * 9], groups, ft, MAX_ATLAS_DIM, ATLAS_BUDGET)
    else
        paint_islands.build(alloc, pos[0 .. @as(usize, fc) * 9], groups, g_density_req, MAX_ATLAS_DIM, ATLAS_BUDGET);
    const lay = built orelse {
        // Absurd mesh (even 1-texel islands blow the budget) — refuse LOUDLY. The
        // target stays valid for picking/editing; painting is disabled until a sane
        // density/mesh (every paint op no-ops on the missing atlas).
        std.debug.print("[model_paint] island layout failed for {d} faces at {d} texels/m — painting disabled for this mesh.\n", .{ fc, g_density_req });
        return;
    };
    g_layout = lay;
    g_atlas_w = lay.atlas_w;
    g_atlas_h = lay.atlas_h;

    // island → triangles CSR (stamp clipping walks the island silhouette).
    const n_islands = lay.islands.len;
    const starts = alloc.alloc(u32, n_islands + 1) catch {
        freeLayoutState();
        return;
    };
    @memset(starts, 0);
    var f: u32 = 0;
    while (f < fc) : (f += 1) starts[lay.tri_island[f] + 1] += 1;
    var i: usize = 1;
    while (i <= n_islands) : (i += 1) starts[i] += starts[i - 1];
    const tris = alloc.alloc(u32, fc) catch {
        alloc.free(starts);
        freeLayoutState();
        return;
    };
    const cursor = alloc.alloc(u32, n_islands) catch {
        alloc.free(starts);
        alloc.free(tris);
        freeLayoutState();
        return;
    };
    defer alloc.free(cursor);
    @memcpy(cursor, starts[0..n_islands]);
    f = 0;
    while (f < fc) : (f += 1) {
        const isl = lay.tri_island[f];
        tris[cursor[isl]] = f;
        cursor[isl] += 1;
    }
    g_isl_start = starts;
    g_isl_tris = tris;

    // Atlas: every texel starts at the default grey (this also covers pad gutters).
    const need = @as(usize, g_atlas_w) * @as(usize, g_atlas_h) * 4;
    const rgba = alloc.alloc(u8, need) catch {
        alloc.free(starts);
        alloc.free(tris);
        g_isl_start = null;
        g_isl_tris = null;
        freeLayoutState();
        return;
    };
    var b: usize = 0;
    while (b < need) : (b += 4) {
        rgba[b + 0] = DEFAULT_FACE[0];
        rgba[b + 1] = DEFAULT_FACE[1];
        rgba[b + 2] = DEFAULT_FACE[2];
        rgba[b + 3] = DEFAULT_FACE[3];
    }
    g_rgba = rgba;
    applyBase(); // lay the chosen base (template/solid/blank) before any carried paint lands (req_2537/req_2546)

    // Overwrite the mesh's UVs — each vertex to its island-texel corner, normalized.
    const aw: f32 = @floatFromInt(g_atlas_w);
    const ah: f32 = @floatFromInt(g_atlas_h);
    var vi: u32 = 0;
    while (vi < vert_count) : (vi += 1) {
        verts[vi * 8 + 6] = lay.corner_uv[@as(usize, vi) * 2 + 0] / aw;
        verts[vi * 8 + 7] = lay.corner_uv[@as(usize, vi) * 2 + 1] / ah;
    }

    if (snap) |s| applyColors(s); // flood each face with its carried base colour
    g_has_dirty = false;
    markRows(0, g_atlas_h - 1); // the whole fresh atlas needs its first upload
}

pub fn clear() void {
    freeLayoutState();
    if (g_positions) |p| alloc.free(p);
    g_positions = null;
    g_facecount = 0;
    g_key_hash = 0;
    // g_density_req deliberately survives — edits/reloads keep their chosen density.
}

/// Paint one face — rasterizes its TRIANGLE in island space (the per-face fill
/// behaviour). The centroid texel is always written, so a sliver face still takes the
/// colour (and faceColor reads it back). `face` out of range is ignored (a raycast
/// miss passes -1 up the stack, never here).
pub fn paintFace(face: u32, rgba: [4]u8) void {
    const buf = g_rgba orelse return;
    const lay = &(g_layout orelse return);
    if (face >= g_facecount) return;
    const c = triTexelCorners(lay, face);
    const bb = faceTexelBounds(lay, face, PAINT_EPS + 0.5);
    var ty = bb[1];
    while (ty <= bb[3]) : (ty += 1) {
        var tx = bb[0];
        while (tx <= bb[2]) : (tx += 1) {
            const fx: f32 = @floatFromInt(tx);
            const fy: f32 = @floatFromInt(ty);
            if (!pointInTri(c, fx + 0.5, fy + 0.5, PAINT_EPS)) continue;
            const dst = (@as(usize, ty) * g_atlas_w + tx) * 4;
            buf[dst + 0] = rgba[0];
            buf[dst + 1] = rgba[1];
            buf[dst + 2] = rgba[2];
            buf[dst + 3] = rgba[3];
        }
    }
    const ct = faceCentroidTexel(lay, face);
    const dc = (@as(usize, ct[1]) * g_atlas_w + ct[0]) * 4;
    buf[dc + 0] = rgba[0];
    buf[dc + 1] = rgba[1];
    buf[dc + 2] = rgba[2];
    buf[dc + 3] = rgba[3];
    markRows(@min(bb[1], ct[1]), @max(bb[3], ct[1]));
}

// ── Texture template (req_2537) ─────────────────────────────────────────────────────
// Fill every UV island a distinct flat colour — Blockbench's "Texture Template". The atlas
// gets real tone and each face shows its own island colour on the model, so painting starts
// from a readable base instead of a blank grey sheet. Pastel hues are spread by the golden
// ratio so adjacent islands stay distinct; all of an island's triangles take its colour.
fn hsvPastel(h: f32) [4]u8 {
    // Saturation high enough that hues read as DISTINCT colours (Blockbench's green/pink/
    // yellow/blue register), not a wash of near-cream tints where every island looks the same
    // (req_2543). Still light (high v) so overpainting stays legible on top.
    const s: f32 = 0.5;
    const v: f32 = 0.92;
    const i = @as(u32, @intFromFloat(h * 6.0)) % 6;
    const f = h * 6.0 - @floor(h * 6.0);
    const p = v * (1.0 - s);
    const q = v * (1.0 - s * f);
    const t = v * (1.0 - s * (1.0 - f));
    var r: f32 = v;
    var g: f32 = v;
    var b: f32 = v;
    switch (i) {
        0 => { g = t; b = p; },
        1 => { r = q; b = p; },
        2 => { r = p; b = t; },
        3 => { r = p; g = q; },
        4 => { r = t; g = p; },
        else => { g = p; b = q; },
    }
    return .{ @as(u8, @intFromFloat(r * 255.0)), @as(u8, @intFromFloat(g * 255.0)), @as(u8, @intFromFloat(b * 255.0)), 255 };
}

fn templateColor(island_idx: u32) [4]u8 {
    return hsvPastel(@mod(@as(f32, @floatFromInt(island_idx)) * 0.61803398875, 1.0));
}

/// Paint every island its template colour (the Create-Texture "Texture Template" type).
pub fn fillTemplate() void {
    const lay = &(g_layout orelse return);
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) paintFace(f, templateColor(lay.tri_island[f]));
}

// The atlas base type the user picks in Create Paint Atlas — the same gate as the size, since
// both gate painting (req_2546). Mirrors Blockbench's Create Texture "Type": Texture Template
// (per-island pastels), Solid Color (one colour), or Blank (bare background).
pub const BaseMode = enum(u8) { template = 0, solid = 1, blank = 2 };
var g_base_mode: BaseMode = .template;
var g_base_color: [4]u8 = .{ 220, 220, 225, 255 };

/// Choose the atlas base type + solid colour. The next atlas build/clear lays this base; call
/// clearAtlas afterward to re-lay it on the current (unpainted) sheet.
pub fn setBase(mode: BaseMode, color: [4]u8) void {
    g_base_mode = mode;
    g_base_color = color;
}

// Lay the chosen base onto the (already background-cleared) atlas.
fn applyBase() void {
    switch (g_base_mode) {
        .template => fillTemplate(),
        .solid => {
            var f: u32 = 0;
            while (f < g_facecount) : (f += 1) paintFace(f, g_base_color);
        },
        .blank => {}, // leave the neutral background bare
    }
}

/// Bulk-set every face's colour from a per-face RGBA array (length ≥ facecount*4) —
/// how a quality change carries the source paint down onto the new (decimated) mesh.
/// Floods each patch (sub-face detail can't survive a topology change, so fill is right).
pub fn applyColors(colors: []const u8) void {
    if (g_rgba == null) return;
    if (colors.len < @as(usize, g_facecount) * 4) return;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        paintFace(f, .{ colors[f * 4 + 0], colors[f * 4 + 1], colors[f * 4 + 2], colors[f * 4 + 3] });
    }
}

/// Overwrite the WHOLE atlas with saved bytes — how a saved paint variant is loaded back onto
/// the model. The caller restores the matching detail first (setDetail), so the buffer is
/// already sized to the saved painting and the per-vertex UVs line up. Marks every row dirty so
/// the texture re-uploads. Returns false on a size mismatch (wrong detail / no target).
pub fn setAtlas(rgba: []const u8) bool {
    const buf = g_rgba orelse return false;
    if (rgba.len != buf.len) return false;
    @memcpy(buf, rgba);
    g_has_dirty = false;
    markRows(0, g_atlas_h - 1);
    return true;
}

/// A face's representative colour — the texel at its island-space triangle centroid.
/// Lets callers read a face's base tone (quality carry-over, the layout-rebuild carry,
/// the headless proof). Selection uses the rect save/restore below so it never
/// flattens sub-face paint.
pub fn faceColor(face: u32) ?[4]u8 {
    const buf = g_rgba orelse return null;
    const lay = &(g_layout orelse return null);
    if (face >= g_facecount) return null;
    const ct = faceCentroidTexel(lay, face);
    const d = (@as(usize, ct[1]) * g_atlas_w + ct[0]) * 4;
    return .{ buf[d], buf[d + 1], buf[d + 2], buf[d + 3] };
}

/// A face's representative colour read from a SAVED patch (saveFacePatch bytes) instead
/// of the live atlas — the face's TRUE colour while a selection tint sits over it.
/// The mesh-edit journal and colour-carry paths use this so a snapshot taken mid-selection
/// never bakes the highlight orange into the model.
pub fn faceColorFromPatch(face: u32, patch: []const u8) ?[4]u8 {
    const r = faceRect(face) orelse return null;
    const lay = &(g_layout orelse return null);
    const ct = faceCentroidTexel(lay, face);
    if (ct[0] < r[0] or ct[1] < r[1]) return null;
    const px = ct[0] - r[0];
    const py = ct[1] - r[1];
    if (px >= r[2] or py >= r[3]) return null;
    const d = (@as(usize, py) * r[2] + px) * 4;
    if (d + 3 >= patch.len) return null;
    return .{ patch[d], patch[d + 1], patch[d + 2], patch[d + 3] };
}

// ── Per-face rect save/restore/tint (the selection highlight rides this) ──────────
// The unit is the face triangle's island-space bounding rect. Save copies the whole
// rect; tint and restore touch ONLY texels strictly inside the triangle (TINT_EPS), so
// two faces sharing a diagonal in one island can tint/deselect in any order without
// residue — their strict texel sets are disjoint.
fn faceRect(face: u32) ?[4]u32 { // x, y, w, h
    const lay = &(g_layout orelse return null);
    if (face >= g_facecount) return null;
    const bb = faceTexelBounds(lay, face, 0.5);
    return .{ bb[0], bb[1], bb[2] - bb[0] + 1, bb[3] - bb[1] + 1 };
}

/// Bytes in one face's save rect (its island-triangle bbox × RGBA). Sized PER FACE now —
/// islands give big faces big rects. 0 when there's no target/layout.
pub fn facePatchLen(face: u32) usize {
    const r = faceRect(face) orelse return 0;
    return @as(usize, r[2]) * @as(usize, r[3]) * 4;
}

/// Copy a face's whole save rect into `out` (len ≥ facePatchLen(face)). False if no target.
pub fn saveFacePatch(face: u32, out: []u8) bool {
    const buf = g_rgba orelse return false;
    const r = faceRect(face) orelse return false;
    if (out.len < @as(usize, r[2]) * @as(usize, r[3]) * 4) return false;
    var py: u32 = 0;
    while (py < r[3]) : (py += 1) {
        const src = (@as(usize, r[1] + py) * g_atlas_w + r[0]) * 4;
        const dst = @as(usize, py) * r[2] * 4;
        @memcpy(out[dst .. dst + r[2] * 4], buf[src .. src + r[2] * 4]);
    }
    return true;
}

/// Write a saved rect back onto a face — only texels strictly inside the face triangle
/// (exact undo of tintFacePatch; a neighbour's texels are never touched).
pub fn restoreFacePatch(face: u32, in: []const u8) void {
    const buf = g_rgba orelse return;
    const lay = &(g_layout orelse return);
    const r = faceRect(face) orelse return;
    if (in.len < @as(usize, r[2]) * @as(usize, r[3]) * 4) return;
    const c = triTexelCorners(lay, face);
    var py: u32 = 0;
    while (py < r[3]) : (py += 1) {
        var px: u32 = 0;
        while (px < r[2]) : (px += 1) {
            const fx: f32 = @floatFromInt(r[0] + px);
            const fy: f32 = @floatFromInt(r[1] + py);
            if (!pointInTri(c, fx + 0.5, fy + 0.5, TINT_EPS)) continue;
            const dst = (@as(usize, r[1] + py) * g_atlas_w + r[0] + px) * 4;
            const src = (@as(usize, py) * r[2] + px) * 4;
            @memcpy(buf[dst .. dst + 4], in[src .. src + 4]);
        }
    }
    markRows(r[1], r[1] + r[3] - 1);
}

/// Blend the face triangle's texels toward `tint` by `amt` (0..1). The selection
/// highlight — reversible via the saved rect, so it never destroys the paint underneath.
pub fn tintFacePatch(face: u32, tint: [4]u8, amt: f32) void {
    const buf = g_rgba orelse return;
    const lay = &(g_layout orelse return);
    const r = faceRect(face) orelse return;
    const a = std.math.clamp(amt, 0.0, 1.0);
    const c = triTexelCorners(lay, face);
    var py: u32 = 0;
    while (py < r[3]) : (py += 1) {
        var px: u32 = 0;
        while (px < r[2]) : (px += 1) {
            const fx: f32 = @floatFromInt(r[0] + px);
            const fy: f32 = @floatFromInt(r[1] + py);
            if (!pointInTri(c, fx + 0.5, fy + 0.5, TINT_EPS)) continue;
            const d = (@as(usize, r[1] + py) * g_atlas_w + r[0] + px) * 4;
            inline for (0..3) |ch| {
                const base: f32 = @floatFromInt(buf[d + ch]);
                const tc: f32 = @floatFromInt(tint[ch]);
                buf[d + ch] = @intFromFloat(std.math.clamp(base + (tc - base) * a, 0.0, 255.0));
            }
        }
    }
    markRows(r[1], r[1] + r[3] - 1);
}

/// The CPU triangle positions (facecount*9 f32: 3 verts xyz per face), or null. The
/// selection layer welds these into vertices/edges; the same array the raycast uses.
pub fn positions() ?[]const f32 {
    return g_positions;
}

/// Mutable CPU triangle positions for host-native mesh editing. This is the same array
/// raycast/project read, so a moved vertex is immediately pickable at its new location.
pub fn positionsMutable() ?[]f32 {
    return g_positions;
}

/// Project a world point to viewport pixel (x,y), or null if behind the camera. The exact
/// inverse of cameraRay (same fov/aspect/basis), so a vertex projects to the pixel its
/// raycast would shoot back through — screen-nearest vertex/edge picking with zero drift.
pub fn project(cam: Camera, vp_w: f32, vp_h: f32, p: [3]f32) ?[2]f32 {
    if (vp_w <= 0 or vp_h <= 0) return null;
    const forward = norm(sub(cam.target, cam.eye));
    const right = norm(cross(forward, .{ 0, 1, 0 }));
    const up = cross(right, forward);
    const rel = sub(p, cam.eye);
    const z = dot(rel, forward);
    if (z <= 1e-4) return null; // behind the camera
    const aspect = vp_w / vp_h;
    const tan_h = @tan(cam.fov_deg * std.math.pi / 180.0 * 0.5);
    const ndc_x = (dot(rel, right) / z) / (tan_h * aspect);
    const ndc_y = (dot(rel, up) / z) / tan_h;
    return .{ (ndc_x * 0.5 + 0.5) * vp_w, (1.0 - ndc_y) * 0.5 * vp_h };
}

pub const Atlas = struct { rgba: []const u8, w: u32, h: u32 };

/// The live diffuse-texture bytes for the active target, or null if none. Always
/// current (paints mutate it in place); the GPU side uploads only consumeDirtyRows().
pub fn atlas() ?Atlas {
    const buf = g_rgba orelse return null;
    return .{ .rgba = buf, .w = g_atlas_w, .h = g_atlas_h };
}

// ── Raycast (Möller–Trumbore) ───────────────────────────────────────────────────
pub const Camera = struct { eye: [3]f32, target: [3]f32, fov_deg: f32 };

fn sub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn cross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn dot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn norm(a: [3]f32) [3]f32 {
    const l = @sqrt(dot(a, a));
    if (l < 1e-12) return .{ 0, 0, 0 };
    return .{ a[0] / l, a[1] / l, a[2] / l };
}

/// One triangle hit. Returns ray `t` (distance) on hit, else null. No backface cull —
/// paint works from either side.
fn rayTri(o: [3]f32, d: [3]f32, a: [3]f32, b: [3]f32, c: [3]f32) ?f32 {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (@abs(det) < 1e-9) return null;
    const inv = 1.0 / det;
    const tv = sub(o, a);
    const u = dot(tv, p) * inv;
    if (u < 0.0 or u > 1.0) return null;
    const q = cross(tv, e1);
    const v = dot(d, q) * inv;
    if (v < 0.0 or u + v > 1.0) return null;
    const t = dot(e2, q) * inv;
    return if (t > 1e-4) t else null;
}

/// Like rayTri but also returns the barycentric (u along a→b, v along a→c) of the hit —
/// exactly what maps a surface point into its patch (baryToPatchTexel). No backface cull.
const TriHit = struct { t: f32, u: f32, v: f32 };
fn rayTriBary(o: [3]f32, d: [3]f32, a: [3]f32, b: [3]f32, c: [3]f32) ?TriHit {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (@abs(det) < 1e-9) return null;
    const inv = 1.0 / det;
    const tv = sub(o, a);
    const u = dot(tv, p) * inv;
    if (u < 0.0 or u > 1.0) return null;
    const q = cross(tv, e1);
    const v = dot(d, q) * inv;
    if (v < 0.0 or u + v > 1.0) return null;
    const t = dot(e2, q) * inv;
    return if (t > 1e-4) TriHit{ .t = t, .u = u, .v = v } else null;
}

/// The world-space ray (origin = eye, direction) through viewport pixel (mx,my), built to
/// match the scene3d perspective (vertical fov, +Y up). The one place pixel→ray lives, so
/// every raycast (face pick, focus point, future vertex/edge picks) shoots the SAME ray
/// the user sees.
pub const Ray = struct { o: [3]f32, d: [3]f32 };
pub fn cameraRay(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) Ray {
    const aspect = vp_w / vp_h;
    const tan_h = @tan(cam.fov_deg * std.math.pi / 180.0 * 0.5);
    const ndc_x = 2.0 * mx / vp_w - 1.0;
    const ndc_y = 1.0 - 2.0 * my / vp_h;
    const forward = norm(sub(cam.target, cam.eye));
    const right = norm(cross(forward, .{ 0, 1, 0 }));
    const up = cross(right, forward);
    const dir = norm(.{
        ndc_x * tan_h * aspect * right[0] + ndc_y * tan_h * up[0] + forward[0],
        ndc_x * tan_h * aspect * right[1] + ndc_y * tan_h * up[1] + forward[1],
        ndc_x * tan_h * aspect * right[2] + ndc_y * tan_h * up[2] + forward[2],
    });
    return .{ .o = cam.eye, .d = dir };
}

/// The face under viewport pixel (mx,my), or -1 on a miss. Returns the nearest hit.
pub fn pick(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) i32 {
    const pos = g_positions orelse return -1;
    if (vp_w <= 0 or vp_h <= 0) return -1;
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    const dir = ray.d;

    // Prefer the nearest FRONT-facing hit — the triangle you can actually see. The
    // render culls back-faces (cull_mode=.back), so without this the ray would happily
    // pick the invisible near side of a closed surface or a back-face on a fold, and
    // paint a face the user can't see (the "it paints the wrong place" scatter on a
    // real scanned mesh). A fallback to the nearest ANY hit means a model whose winding
    // disagrees with the render still paints something rather than nothing.
    var best_front_t: f32 = std.math.floatMax(f32);
    var best_front: i32 = -1;
    var best_any_t: f32 = std.math.floatMax(f32);
    var best_any: i32 = -1;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const c: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        if (rayTri(cam.eye, dir, a, b, c)) |t| {
            if (t < best_any_t) {
                best_any_t = t;
                best_any = @intCast(f);
            }
            // Geometric normal (same winding as the triangle). Front-facing toward the
            // camera ⇒ it opposes the ray direction.
            const n = cross(sub(b, a), sub(c, a));
            if (dot(n, dir) < 0.0 and t < best_front_t) {
                best_front_t = t;
                best_front = @intCast(f);
            }
        }
    }
    return if (best_front >= 0) best_front else best_any;
}

/// The world-space point where the camera ray through (mx,my) first meets the visible
/// (front-facing) surface, or null on a miss. This is what re-centres the orbit pivot on
/// the exact spot you click — put the focus on a far corner of a big model and edit it
/// without camera gymnastics (req_2148). Same front-then-any preference as `pick`.
pub fn pickPoint(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) ?[3]f32 {
    const pos = g_positions orelse return null;
    if (vp_w <= 0 or vp_h <= 0) return null;
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    var best_front_t: f32 = std.math.floatMax(f32);
    var best_any_t: f32 = std.math.floatMax(f32);
    var hit_front = false;
    var hit_any = false;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const c: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        if (rayTri(ray.o, ray.d, a, b, c)) |t| {
            if (t < best_any_t) {
                best_any_t = t;
                hit_any = true;
            }
            const n = cross(sub(b, a), sub(c, a));
            if (dot(n, ray.d) < 0.0 and t < best_front_t) {
                best_front_t = t;
                hit_front = true;
            }
        }
    }
    if (!hit_any) return null;
    const t = if (hit_front) best_front_t else best_any_t;
    return .{ ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t };
}

/// Is world point `p` hidden behind the surface from the camera? True when a FRONT-facing
/// triangle sits between the eye and `p` (render culls back faces, so only front faces
/// visibly occlude). Lets vertex/edge picking ignore elements on the far side of the model
/// you can't even see. The eps tolerates a vertex's own incident faces (it lies ON them).
pub fn occluded(cam: Camera, p: [3]f32) bool {
    const pos = g_positions orelse return false;
    const ev = sub(p, cam.eye);
    const pdist = @sqrt(dot(ev, ev));
    if (pdist < 1e-6) return false;
    const dir: [3]f32 = .{ ev[0] / pdist, ev[1] / pdist, ev[2] / pdist };
    const eps = pdist * 0.003 + 1e-4;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const a: [3]f32 = .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] };
        const b: [3]f32 = .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] };
        const cc: [3]f32 = .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] };
        const n = cross(sub(b, a), sub(cc, a));
        if (dot(n, dir) >= 0.0) continue; // back-facing to the ray → not a visible occluder
        if (rayTri(cam.eye, dir, a, b, cc)) |t| {
            if (t < pdist - eps) return true;
        }
    }
    return false;
}

// ── Free-form brush (sub-face strokes, clipped to the face) ───────────────────────
fn triVerts(pos: []const f32, f: u32) [3][3]f32 {
    return .{
        .{ pos[f * 9 + 0], pos[f * 9 + 1], pos[f * 9 + 2] },
        .{ pos[f * 9 + 3], pos[f * 9 + 4], pos[f * 9 + 5] },
        .{ pos[f * 9 + 6], pos[f * 9 + 7], pos[f * 9 + 8] },
    };
}

/// CLIP mode: the nearest front-facing face under (mx,my) plus the hit's barycentric —
/// each dab paints whichever face it lands on, clipped to that face's triangle.
pub const StampHit = struct { face: u32, u: f32, v: f32 };
pub fn pickBary(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32) ?StampHit {
    const pos = g_positions orelse return null;
    if (vp_w <= 0 or vp_h <= 0) return null;
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    var best_front_t: f32 = std.math.floatMax(f32);
    var best_any_t: f32 = std.math.floatMax(f32);
    var front = StampHit{ .face = 0, .u = 0, .v = 0 };
    var any = StampHit{ .face = 0, .u = 0, .v = 0 };
    var hit_front = false;
    var hit_any = false;
    var f: u32 = 0;
    while (f < g_facecount) : (f += 1) {
        const tri = triVerts(pos, f);
        if (rayTriBary(ray.o, ray.d, tri[0], tri[1], tri[2])) |h| {
            if (h.t < best_any_t) {
                best_any_t = h.t;
                any = .{ .face = f, .u = h.u, .v = h.v };
                hit_any = true;
            }
            const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
            if (dot(n, ray.d) < 0.0 and h.t < best_front_t) {
                best_front_t = h.t;
                front = .{ .face = f, .u = h.u, .v = h.v };
                hit_front = true;
            }
        }
    }
    if (hit_front) return front;
    if (hit_any) return any;
    return null;
}

/// LOCK mode: the barycentric where the ray meets ONE fixed face's plane — UNCLAMPED,
/// deliberately. The dab is clipped to the face's island silhouette downstream, so a
/// locked stroke crosses the quad diagonal onto the sibling half (the bary just
/// extrapolates in the shared plane) and simply STOPS at the authored face's boundary
/// instead of smearing along the nearest edge. null only if the ray is parallel/behind.
pub fn baryOnFace(cam: Camera, vp_w: f32, vp_h: f32, mx: f32, my: f32, face: u32) ?[2]f32 {
    const pos = g_positions orelse return null;
    if (face >= g_facecount or vp_w <= 0 or vp_h <= 0) return null;
    const tri = triVerts(pos, face);
    const a = tri[0];
    const ray = cameraRay(cam, vp_w, vp_h, mx, my);
    const n = cross(sub(tri[1], a), sub(tri[2], a));
    const denom = dot(ray.d, n);
    if (@abs(denom) < 1e-9) return null;
    const t = dot(sub(a, ray.o), n) / denom;
    if (t <= 1e-4) return null;
    const hit: [3]f32 = .{ ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t };
    const v0 = sub(tri[1], a);
    const v1 = sub(tri[2], a);
    const v2 = sub(hit, a);
    const d00 = dot(v0, v0);
    const d01 = dot(v0, v1);
    const d11 = dot(v1, v1);
    const d20 = dot(v2, v0);
    const d21 = dot(v2, v1);
    const det = d00 * d11 - d01 * d01;
    if (@abs(det) < 1e-12) return null;
    const u = (d11 * d20 - d01 * d21) / det;
    const v = (d00 * d21 - d01 * d20) / det;
    return .{ u, v };
}

// ── Material ink: paint WITH a shader, not a flat colour ─────────────────────────
// A brush can "dip into a bucket of shader": the host renders a shader recipe to a
// small RGBA image (material_tex.bakePixels) and hands the pixels here; a dab then
// SAMPLES that image per texel instead of laying one flat colour, so the stroke
// deposits the material's LOOK onto the low-poly face. `g_mat_scale` tiles the image
// across each face patch. Cleared → dabs go back to flat-colour painting.
var g_mat_rgba: ?[]u8 = null;
var g_mat_w: u32 = 0;
var g_mat_h: u32 = 0;
var g_mat_scale: f32 = 1.0;

/// Adopt a material image as the active brush ink (copied — the caller keeps ownership
/// of `rgba`). `scale` tiles the image across each face patch. False on a malformed image.
pub fn setMaterialInk(rgba: []const u8, w: u32, h: u32, scale: f32) bool {
    if (w == 0 or h == 0 or rgba.len != @as(usize, w) * @as(usize, h) * 4) return false;
    const copy = alloc.alloc(u8, rgba.len) catch return false;
    @memcpy(copy, rgba);
    if (g_mat_rgba) |old| alloc.free(old);
    g_mat_rgba = copy;
    g_mat_w = w;
    g_mat_h = h;
    g_mat_scale = if (scale > 0.0) scale else 1.0;
    return true;
}

/// Drop the material ink — dabs go back to depositing their flat colour.
pub fn clearMaterialInk() void {
    if (g_mat_rgba) |old| alloc.free(old);
    g_mat_rgba = null;
    g_mat_w = 0;
    g_mat_h = 0;
    g_mat_scale = 1.0;
}

pub fn hasMaterialInk() bool {
    return g_mat_rgba != null;
}

/// Nearest-sample the material image at uv, wrapped so scaled uv tiles the material.
fn sampleMat(u: f32, v: f32) [4]u8 {
    const src = g_mat_rgba orelse return .{ 255, 255, 255, 255 };
    const fu = u - @floor(u);
    const fv = v - @floor(v);
    const sx = @min(@as(u32, @intFromFloat(fu * @as(f32, @floatFromInt(g_mat_w)))), g_mat_w - 1);
    const sy = @min(@as(u32, @intFromFloat(fv * @as(f32, @floatFromInt(g_mat_h)))), g_mat_h - 1);
    const si = (@as(usize, sy) * g_mat_w + sx) * 4;
    return .{ src[si], src[si + 1], src[si + 2], src[si + 3] };
}

// ── Logical faces (authored face-groups) — req_2506 ─────────────────────────────────
// The user paints FACES, not triangles: a cube face is one quad, not two tris with a
// diagonal seam. The mesh's authored face-GROUP (model_source) already encodes this —
// the two halves of a quad share one group (the same signal the edge overlay uses to
// hide diagonals, req_2367). The island layout makes the group ONE continuous texture
// space, so a single dab covers both halves and a material ink samples one planar
// window (the island) across the whole face. Fills still flood every member triangle
// (3d.zig walks groupFaces). Ungrouped soups (imported scans) are per-triangle islands.

pub const MAX_GROUP_FACES = 16; // an authored face is a quad or a small planar fan

/// Every face sharing `face`'s authored group — `face` itself first. A mesh with no
/// grouping (or a lone triangle) returns just {face}.
pub fn groupFaces(face: u32, buf: *[MAX_GROUP_FACES]u32) []u32 {
    buf[0] = face;
    var n: usize = 1;
    const grp = model_source.faceGroupOf(face);
    if (grp == model_source.NO_FACE_GROUP) return buf[0..1];
    var f: u32 = 0;
    while (f < g_facecount and n < MAX_GROUP_FACES) : (f += 1) {
        if (f == face) continue;
        if (model_source.faceGroupOf(f) == grp) {
            buf[n] = f;
            n += 1;
        }
    }
    return buf[0..n];
}

/// World point of a face's barycentric (u along v0→v1, v along v0→v2).
pub fn pointFromBary(face: u32, u: f32, v: f32) [3]f32 {
    const pos = g_positions orelse return .{ 0, 0, 0 };
    if (face >= g_facecount) return .{ 0, 0, 0 };
    const tri = triVerts(pos, face);
    const e1 = sub(tri[1], tri[0]);
    const e2 = sub(tri[2], tri[0]);
    return .{
        tri[0][0] + u * e1[0] + v * e2[0],
        tri[0][1] + u * e1[1] + v * e2[1],
        tri[0][2] + u * e1[2] + v * e2[2],
    };
}

/// Barycentric of world point `p` in `face`'s plane (Gram solve). May land outside
/// [0,1] — a dab centred on a neighbouring triangle still covers this face's texels
/// near the shared edge (stampInner clips to the triangle regardless).
pub fn baryOfPointOnFace(face: u32, p: [3]f32) [2]f32 {
    const pos = g_positions orelse return .{ 0, 0 };
    if (face >= g_facecount) return .{ 0, 0 };
    const tri = triVerts(pos, face);
    const e1 = sub(tri[1], tri[0]);
    const e2 = sub(tri[2], tri[0]);
    const dp = sub(p, tri[0]);
    const d11 = dot(e1, e1);
    const d12 = dot(e1, e2);
    const d22 = dot(e2, e2);
    const det = d11 * d22 - d12 * d12;
    if (@abs(det) < 1e-12) return .{ 0, 0 };
    const dp1 = dot(dp, e1);
    const dp2 = dot(dp, e2);
    return .{ (d22 * dp1 - d12 * dp2) / det, (d11 * dp2 - d12 * dp1) / det };
}

/// Sample the material ink at an atlas texel, in ISLAND space: uv (0..1) spans the
/// island's rect — one continuous window across the whole authored face, so the look
/// runs over the diagonal without restarting. Tiled by g_mat_scale.
fn sampleMatAtTexel(isl: paint_islands.Island, fx: f32, fy: f32) [4]u8 {
    const u = (fx + 0.5 - @as(f32, @floatFromInt(isl.x))) / @as(f32, @floatFromInt(@max(1, isl.w)));
    const v = (fy + 0.5 - @as(f32, @floatFromInt(isl.y))) / @as(f32, @floatFromInt(@max(1, isl.h)));
    return sampleMat(u * g_mat_scale, v * g_mat_scale);
}

/// Blend one texel toward `ink` by `amt` (alpha snaps opaque — paint is paint).
fn blendTexel(buf: []u8, d: usize, ink: [4]u8, amt: f32) void {
    inline for (0..3) |c| {
        const base: f32 = @floatFromInt(buf[d + c]);
        const tc: f32 = @floatFromInt(ink[c]);
        buf[d + c] = @intFromFloat(std.math.clamp(base + (tc - base) * amt, 0.0, 255.0));
    }
    buf[d + 3] = 255;
}

/// Stamp a brush dab: a disc of `radius` texels around the hit, in the face's ISLAND
/// space. The dab centre is the barycentric interpolation of the face's island-texel
/// corners, and clipping is the island's whole SILHOUETTE (every member triangle) —
/// so a stroke crosses the quad diagonal in one continuous space (the point of the
/// island port) but never bleeds past the authored face's boundary. `flow` (0..1) is
/// the blend toward the ink. When `mat` is set the ink is SAMPLED from the material
/// image (paint-with-a-shader) in island space; `fill` floods the face triangle
/// instead of a disc (bucket fill, material mode).
fn stampInner(face: u32, cu: f32, cv: f32, radius: f32, rgba: [4]u8, mat: bool, flow: f32, fill: bool) void {
    const buf = g_rgba orelse return;
    const lay = &(g_layout orelse return);
    if (face >= g_facecount) return;
    const isl_idx = lay.tri_island[face];
    const isl = lay.islands[isl_idx];
    const flow_amt = std.math.clamp(flow, 0.0, 1.0);
    if (flow_amt <= 0.0) return;

    if (fill) {
        // Bucket fill: exactly the face triangle (same texel set as paintFace), with
        // the ink sampled per texel. Centroid texel guaranteed for slivers.
        const c = triTexelCorners(lay, face);
        const bb = faceTexelBounds(lay, face, PAINT_EPS + 0.5);
        var ty = bb[1];
        while (ty <= bb[3]) : (ty += 1) {
            var tx = bb[0];
            while (tx <= bb[2]) : (tx += 1) {
                const fx: f32 = @floatFromInt(tx);
                const fy: f32 = @floatFromInt(ty);
                if (!pointInTri(c, fx + 0.5, fy + 0.5, PAINT_EPS)) continue;
                const ink: [4]u8 = if (mat) sampleMatAtTexel(isl, fx, fy) else rgba;
                blendTexel(buf, (@as(usize, ty) * g_atlas_w + tx) * 4, ink, flow_amt);
            }
        }
        const ct = faceCentroidTexel(lay, face);
        const ink: [4]u8 = if (mat) sampleMatAtTexel(isl, @floatFromInt(ct[0]), @floatFromInt(ct[1])) else rgba;
        blendTexel(buf, (@as(usize, ct[1]) * g_atlas_w + ct[0]) * 4, ink, flow_amt);
        markRows(@min(bb[1], ct[1]), @max(bb[3], ct[1]));
        return;
    }

    // Dab centre in absolute atlas texels — barycentric interpolation of the face's
    // island-space corners. Affine, so a LOCK-mode hit outside [0,1] extrapolates
    // correctly onto the sibling half of the face.
    const c = triTexelCorners(lay, face);
    const cx = c[0][0] + cu * (c[1][0] - c[0][0]) + cv * (c[2][0] - c[0][0]);
    const cy = c[0][1] + cu * (c[1][1] - c[0][1]) + cv * (c[2][1] - c[0][1]);
    // HARD-EDGED pixel dab — the proven painter stamps cells, it does not airbrush
    // (req_2538: the AA coverage ramp made every dab mostly soft ring, and a dragged
    // stroke stacked those partial texels into a blurry fan; a texel is either painted
    // at full flow or untouched). The 0.75 floor keeps a 1px brush from ever missing:
    // the farthest a texel CENTRE can sit from an arbitrary point is √2/2 ≈ 0.71.
    const r = @max(radius, 0.75);

    // Disc bounds ∩ island rect (a dab can bleed into the pad gutter via PAINT_EPS,
    // never into a neighbour island).
    const x0f = @max(@floor(cx - r), @as(f32, @floatFromInt(isl.x)));
    const y0f = @max(@floor(cy - r), @as(f32, @floatFromInt(isl.y)));
    const x1f = @min(@ceil(cx + r), @as(f32, @floatFromInt(isl.x + isl.w)) - 1.0);
    const y1f = @min(@ceil(cy + r), @as(f32, @floatFromInt(isl.y + isl.h)) - 1.0);
    if (x1f < x0f or y1f < y0f) return;
    const x0: u32 = @intFromFloat(@max(0, x0f));
    const y0: u32 = @intFromFloat(@max(0, y0f));
    const x1: u32 = @intFromFloat(@max(0, x1f));
    const y1: u32 = @intFromFloat(@max(0, y1f));

    var ty = y0;
    while (ty <= y1) : (ty += 1) {
        var tx = x0;
        while (tx <= x1) : (tx += 1) {
            const fx: f32 = @floatFromInt(tx);
            const fy: f32 = @floatFromInt(ty);
            // Binary coverage: the texel centre is in the disc or it isn't.
            const dx = fx + 0.5 - cx;
            const dy = fy + 0.5 - cy;
            if (dx * dx + dy * dy > r * r) continue;
            // Clip to the island silhouette — the dab covers every member triangle it
            // overlaps, so the diagonal is invisible to the stroke.
            if (!pointInIsland(lay, isl_idx, fx + 0.5, fy + 0.5, PAINT_EPS)) continue;
            const ink: [4]u8 = if (mat) sampleMatAtTexel(isl, fx, fy) else rgba;
            blendTexel(buf, (@as(usize, ty) * g_atlas_w + tx) * 4, ink, flow_amt);
        }
    }
    markRows(y0, y1);
}

pub fn paintStamp(face: u32, cu: f32, cv: f32, radius: f32, rgba: [4]u8, flow: f32) void {
    stampInner(face, cu, cv, radius, rgba, false, flow, false);
}

/// Free-form dab that deposits the active material ink (paint-with-a-shader). Same disc +
/// triangle clip as paintStamp; samples flat white if no material is set.
pub fn paintStampTex(face: u32, cu: f32, cv: f32, radius: f32, flow: f32) void {
    stampInner(face, cu, cv, radius, DEFAULT_FACE, true, flow, false);
}

/// Bucket-fill a whole face triangle with the material ink (the fill tool, material mode).
pub fn paintFaceTex(face: u32) void {
    stampInner(face, 0.34, 0.33, 0.0, DEFAULT_FACE, true, 1.0, true);
}

// ── Detail = DENSITY (texels per meter) ───────────────────────────────────────────
// "Detail" through every door now means texels-per-METER — the reference painter's
// PIXEL_DENSITIES (Blockbench semantics: 16x = 16 texels to the meter), with 256/512
// kept as high-density options. 1 = the fill-only look (≈ one texel per meter-scale
// face). paint_islands.build self-halves an over-budget request, so any pick is safe.
const ATLAS_BUDGET: usize = 256 * 1024 * 1024; // paint-atlas ceiling (bytes)
// Hard ceiling on either atlas texel DIMENSION — wgpu's default max_texture_dimension_2d.
// Exceeding it doesn't degrade, it PANICS the process inside wgpuDeviceCreateTexture (the
// "imported a bus while in paint mode" crash). paint_islands.build clamps to this.
const MAX_ATLAS_DIM: u32 = 8192;

/// The APPLIED density (texels/meter) — ≤ the request when the limits clamped it.
pub fn detail() u32 {
    if (g_layout) |lay| return @max(1, @as(u32, @intFromFloat(@round(lay.density))));
    return @max(1, @as(u32, @intFromFloat(@round(g_density_req))));
}

/// Set the paint density (texels/meter, any value ≥1 — no snapping: the FIT path and
/// program replay need exact densities), rebuilding the island layout and carrying each
/// face's current colour as a flat fill (sub-face strokes come back via stroke-program
/// replay). Rewrites the caller's vertex UVs in place — 3d.zig re-uploads the mesh
/// after. An over-budget density HALVES inside paint_islands.build (logged) — detail()
/// reports what actually took, so the UI shows the clamp.
pub fn setDetail(new_density: u32, verts: []f32, vert_count: u32) void {
    const nd = @max(1, new_density);
    const req: f32 = @floatFromInt(nd);
    if (g_positions == null) {
        g_density_req = req; // no target yet — carry the intent to the next adopt
        g_fit_req = null;
        return;
    }
    const fc = g_facecount;
    if (fc == 0 or vert_count / 3 != fc) return;
    if (g_fit_req == null and req == g_density_req and g_layout != null) return;
    g_density_req = req;
    g_fit_req = null; // an explicit density leaves fit mode
    rebuildLayoutInner(verts, vert_count, true);
    if (g_layout) |lay| {
        if (lay.density < req) {
            std.debug.print("[model_paint] density {d} texels/m exceeds the atlas limits ({d}px dim / {d}MB) — clamped to {d}.\n", .{ nd, MAX_ATLAS_DIM, ATLAS_BUDGET / (1024 * 1024), detail() });
        }
    }
}

/// Set the paint fidelity by ATLAS BUDGET — the proven painter's law (req_1299 in the
/// reference; USER req_2518): the whole model's islands FIT a fit_texels² atlas and the
/// density falls out of the model's own size. A lone cube gets ~330 texels/m from a
/// 1024² budget; a whole car divides the same budget. Carries like density; a later
/// explicit setDetail leaves fit mode.
pub fn setFit(fit_texels: u32, verts: []f32, vert_count: u32) void {
    const ft = @max(64, fit_texels);
    if (g_positions == null) {
        g_fit_req = ft; // carry the intent to the next adopt
        return;
    }
    const fc = g_facecount;
    if (fc == 0 or vert_count / 3 != fc) return;
    if (g_fit_req == ft and g_layout != null) return;
    g_fit_req = ft;
    rebuildLayoutInner(verts, vert_count, true);
    if (g_layout) |lay| g_density_req = lay.density; // the derived density becomes the carried one
}

/// Dry-run a density against the CURRENT target: the atlas dims + applied density that
/// layout would produce, without adopting it. The atlas-creation prompt asks this per
/// option so the labels show real costs (and real clamps). Null if no target/absurd.
pub const AtlasEstimate = struct { w: u32, h: u32, density: f32 };
pub fn estimateAtlas(density_req: f32) ?AtlasEstimate {
    const pos = g_positions orelse return null;
    if (g_facecount == 0) return null;
    const groups = collectFaceGroups(g_facecount);
    defer if (groups) |g| alloc.free(g);
    var lay = paint_islands.build(alloc, pos[0 .. @as(usize, g_facecount) * 9], groups, density_req, MAX_ATLAS_DIM, ATLAS_BUDGET) orelse return null;
    defer lay.deinit(alloc);
    return .{ .w = lay.atlas_w, .h = lay.atlas_h, .density = lay.density };
}

/// Dry-run an atlas-budget FIT (see setFit) — what dims + derived density would a
/// fit_texels² budget give this model? The prompt's per-option truth.
pub fn estimateAtlasFit(fit_texels: u32) ?AtlasEstimate {
    const pos = g_positions orelse return null;
    if (g_facecount == 0) return null;
    const groups = collectFaceGroups(g_facecount);
    defer if (groups) |g| alloc.free(g);
    var lay = paint_islands.buildFit(alloc, pos[0 .. @as(usize, g_facecount) * 9], groups, @max(64, fit_texels), MAX_ATLAS_DIM, ATLAS_BUDGET) orelse return null;
    defer lay.deinit(alloc);
    return .{ .w = lay.atlas_w, .h = lay.atlas_h, .density = lay.density };
}

/// The live island rects (packed atlas layout) — the UV inspector draws these so the
/// panel shows real face-shaped islands. Null when there's no layout.
pub fn layoutIslands() ?[]const paint_islands.Island {
    const lay = &(g_layout orelse return null);
    return lay.islands;
}

// ── Tests ───────────────────────────────────────────────────────────────────────
test "density clamps: a huge face at high density stays inside the GPU limits" {
    // A 100m×100m face at 128 texels/m wants a 12800² atlas — build() must HALVE the
    // density until it fits, never hand the GPU an illegal texture (the "imported a
    // bus while in paint mode" panic class).
    var verts: [6 * 8]f32 = std.mem.zeroes([6 * 8]f32);
    const q = [4][3]f32{ .{ 0, 0, 0 }, .{ 100, 0, 0 }, .{ 100, 0, 100 }, .{ 0, 0, 100 } };
    const tri = [6]u32{ 0, 1, 2, 0, 2, 3 };
    for (tri, 0..) |vi, i| {
        verts[i * 8 + 0] = q[vi][0];
        verts[i * 8 + 1] = q[vi][1];
        verts[i * 8 + 2] = q[vi][2];
    }
    setTarget(901, &verts, 6);
    defer {
        clear();
        model_source.clear();
    }
    model_source.setFaceGroups(&.{ 0, 0 });
    rebuildLayout(&verts, 6);
    setDetail(128, &verts, 6);
    const a = atlas().?;
    try std.testing.expect(a.w <= MAX_ATLAS_DIM and a.h <= MAX_ATLAS_DIM);
    try std.testing.expect(detail() < 128); // the clamp is visible through the door
    setDetail(1, &verts, 6); // restore the default density for later tests
    try std.testing.expectEqual(@as(u32, 1), detail());
}

test "pick hits the face straddling the ray and paints it" {
    // One triangle in the z=0 plane, camera on +Z looking at origin down -Z.
    var verts = [_]f32{
        -1, -1, 0, 0, 0, 1, 0, 0,
        1,  -1, 0, 0, 0, 1, 0, 0,
        0,  1,  0, 0, 0, 1, 0, 0,
    };
    setTarget(123, &verts, 3);
    defer clear();
    try std.testing.expectEqual(@as(u32, 1), faceCount());

    const cam = Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    // Centre pixel → the triangle.
    try std.testing.expectEqual(@as(i32, 0), pick(cam, 800, 600, 400, 300));
    // A corner pixel misses (ray leaves the small triangle).
    try std.testing.expectEqual(@as(i32, -1), pick(cam, 800, 600, 0, 0));

    paintFace(0, .{ 10, 20, 30, 255 });
    const col = faceColor(0).?;
    try std.testing.expectEqual(@as(u8, 10), col[0]);
    try std.testing.expectEqual(@as(u8, 30), col[2]);
}

test "pickPoint returns the world hit on the surface, null on a miss" {
    // Same single triangle in z=0, camera on +Z looking down -Z at the origin.
    var verts = [_]f32{
        -1, -1, 0, 0, 0, 1, 0, 0,
        1,  -1, 0, 0, 0, 1, 0, 0,
        0,  1,  0, 0, 0, 1, 0, 0,
    };
    setTarget(321, &verts, 3);
    defer clear();
    const cam = Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    // Centre pixel hits the triangle at the z=0 plane, on the ray, ≈ the origin.
    const hit = pickPoint(cam, 800, 600, 400, 300).?;
    try std.testing.expectApproxEqAbs(@as(f32, 0), hit[0], 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, 0), hit[1], 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, 0), hit[2], 1e-4);
    // A corner pixel misses → null (the cart keeps the current focus).
    try std.testing.expect(pickPoint(cam, 800, 600, 0, 0) == null);
}

test "occluded: a point behind a front face is hidden; on/in front of it is not" {
    // One triangle in z=0 facing +Z, camera on +Z looking down -Z.
    var verts = [_]f32{
        -1, -1, 0, 0, 0, 1, 0, 0,
        1,  -1, 0, 0, 0, 1, 0, 0,
        0,  1,  0, 0, 0, 1, 0, 0,
    };
    setTarget(322, &verts, 3);
    defer clear();
    const cam = Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    // Behind the triangle (z<0), along the ray through its centre → hidden by the front face.
    try std.testing.expect(occluded(cam, .{ 0, 0, -1 }));
    // In front of the triangle (closer to the eye) → visible.
    try std.testing.expect(!occluded(cam, .{ 0, 0, 1 }));
    // A vertex lying ON the triangle → visible (eps tolerates its own face).
    try std.testing.expect(!occluded(cam, .{ 0, 1, 0 }));
}

// A unit quad in z=0 as two triangles sharing the diagonal (0,0)-(1,1), both in one
// authored group — the exact shape a cube face composes to.
const QUAD_VERTS = [_]f32{
    // tri A: (0,0) (1,0) (1,1)
    0, 0, 0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 0, 1, 0, 0,
    1, 1, 0, 0, 0, 1, 0, 0,
    // tri B: (0,0) (1,1) (0,1)
    0, 0, 0, 0, 0, 1, 0, 0,
    1, 1, 0, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 0, 1, 0, 0,
};

fn setupQuadTarget() void {
    var verts = QUAD_VERTS;
    setTarget(77, &verts, 6);
    model_source.setFaceGroups(&.{ 0, 0 });
}

// The full product flow for a grouped quad at a chosen density: adopt → groups land →
// layout refresh (the door path) → density. Returns the UV-rewritten verts.
fn setupQuadAtDensity(density: u32) [6 * 8]f32 {
    var verts = QUAD_VERTS;
    setTarget(77, &verts, 6);
    model_source.setFaceGroups(&.{ 0, 0 });
    rebuildLayout(&verts, 6);
    setDetail(density, &verts, 6);
    return verts;
}

test "island UVs: a grouped quad is ONE island and every vertex UV lands inside it" {
    var verts = setupQuadAtDensity(16);
    defer {
        setDetail(1, &verts, 6); // restore the default density for later tests
        clear();
        model_source.clear();
    }
    const isls = layoutIslands().?;
    try std.testing.expectEqual(@as(usize, 1), isls.len);
    try std.testing.expectEqual(@as(u32, 16), detail());
    // A 1m quad at 16 texels/m → a 16×16 island.
    try std.testing.expectEqual(@as(u32, 16), isls[0].w);
    try std.testing.expectEqual(@as(u32, 16), isls[0].h);
    const a = atlas().?;
    var vi: u32 = 0;
    while (vi < 6) : (vi += 1) {
        const x = verts[vi * 8 + 6] * @as(f32, @floatFromInt(a.w));
        const y = verts[vi * 8 + 7] * @as(f32, @floatFromInt(a.h));
        try std.testing.expect(x >= @as(f32, @floatFromInt(isls[0].x)) and x <= @as(f32, @floatFromInt(isls[0].x + isls[0].w)));
        try std.testing.expect(y >= @as(f32, @floatFromInt(isls[0].y)) and y <= @as(f32, @floatFromInt(isls[0].y + isls[0].h)));
    }
}

test "a dab straddling the quad diagonal paints CONTIGUOUS texels (anti-shredding)" {
    var verts = setupQuadAtDensity(16);
    defer {
        setDetail(1, &verts, 6);
        clear();
        model_source.clear();
    }
    // Dab centred ON the diagonal (world (0.5,0.5): tri A bary u=0, v=0.5), radius 4.
    paintStamp(0, 0.0, 0.5, 4.0, .{ 255, 0, 0, 255 }, 1.0);
    const a = atlas().?;
    const isls = layoutIslands().?;
    // The dab centre in island space, by the same corner interpolation the stamp uses.
    const lay = &(g_layout.?);
    const c = triTexelCorners(lay, 0);
    const cx = c[0][0] + 0.0 * (c[1][0] - c[0][0]) + 0.5 * (c[2][0] - c[0][0]);
    const cy = c[0][1] + 0.0 * (c[1][1] - c[0][1]) + 0.5 * (c[2][1] - c[0][1]);
    // Every texel within radius-1 of the centre AND inside the island interior is
    // fully red — on BOTH sides of the diagonal, no gap. The patch grid could never
    // do this: each half lived in its own disconnected square.
    var checked: u32 = 0;
    var ty = isls[0].y;
    while (ty < isls[0].y + isls[0].h) : (ty += 1) {
        var tx = isls[0].x;
        while (tx < isls[0].x + isls[0].w) : (tx += 1) {
            const dx = @as(f32, @floatFromInt(tx)) + 0.5 - cx;
            const dy = @as(f32, @floatFromInt(ty)) + 0.5 - cy;
            if (@sqrt(dx * dx + dy * dy) > 3.0) continue;
            const d = (@as(usize, ty) * a.w + tx) * 4;
            try std.testing.expectEqual(@as(u8, 255), a.rgba[d + 0]);
            try std.testing.expectEqual(@as(u8, 0), a.rgba[d + 1]);
            checked += 1;
        }
    }
    try std.testing.expect(checked >= 20); // a real disc, not a sliver
}

test "setFit gives a lone 1m quad writing-grade texels (the proven painter's fidelity)" {
    var verts = setupQuadAtDensity(16);
    defer {
        setDetail(1, &verts, 6);
        clear();
        model_source.clear();
    }
    // A 1m quad alone at fit-512: naturalExtent = max(1, 1/0.85) ≈ 1.176m →
    // density ≈ 512×0.92/1.176 ≈ 400 texels/m. At the old flat 16x this face got 16
    // texels across — a 25× fidelity jump from the SAME model, which is exactly what
    // the fixed-atlas-budget law is for (req_2518).
    setFit(512, &verts, 6);
    try std.testing.expect(detail() >= 380 and detail() <= 420);
    const isls = layoutIslands().?;
    try std.testing.expectEqual(@as(usize, 1), isls.len);
    try std.testing.expect(isls[0].w >= 380 and isls[0].w <= 420);
    const a = atlas().?;
    try std.testing.expect(a.w <= 520 and a.h <= 520); // ≈ the requested budget
}

test "fill paints exactly the face's triangle, not its island rect" {
    var verts = setupQuadAtDensity(16);
    defer {
        setDetail(1, &verts, 6);
        clear();
        model_source.clear();
    }
    // The base is whatever the atlas starts with (the texture template tints islands,
    // req_2537) — the invariant is that tri B's texels DON'T CHANGE when tri A fills.
    const before_b = faceColor(1).?;
    paintFace(0, .{ 0, 200, 0, 255 }); // tri A only ((0,0)(1,0)(1,1) — below the diagonal)
    // Tri A's centroid texel took the fill; tri B's centroid kept its base exactly.
    try std.testing.expectEqual(@as(u8, 200), faceColor(0).?[1]);
    try std.testing.expectEqual(before_b, faceColor(1).?);
}

test "selection tint + restore round-trips without touching the sibling triangle" {
    var verts = setupQuadAtDensity(16);
    defer {
        setDetail(1, &verts, 6);
        clear();
        model_source.clear();
    }
    paintFace(0, .{ 200, 40, 40, 255 });
    paintFace(1, .{ 40, 40, 200, 255 });
    const before_a = faceColor(0).?;
    const before_b = faceColor(1).?;
    const len = facePatchLen(0);
    try std.testing.expect(len > 0);
    const saved = alloc.alloc(u8, len) catch unreachable;
    defer alloc.free(saved);
    try std.testing.expect(saveFacePatch(0, saved));
    tintFacePatch(0, .{ 255, 255, 255, 255 }, 0.5);
    try std.testing.expect(faceColor(0).?[0] != before_a[0]); // tint visibly landed
    try std.testing.expectEqual(before_b, faceColor(1).?); // sibling untouched by the tint
    restoreFacePatch(0, saved);
    try std.testing.expectEqual(before_a, faceColor(0).?); // exact undo
    try std.testing.expectEqual(before_b, faceColor(1).?);
}

test "a quad's two triangles are one logical face" {
    setupQuadTarget();
    defer {
        clear();
        model_source.clear();
    }
    var buf: [MAX_GROUP_FACES]u32 = undefined;
    const a = groupFaces(0, &buf);
    try std.testing.expectEqual(@as(usize, 2), a.len);
    try std.testing.expectEqual(@as(u32, 0), a[0]);
    try std.testing.expectEqual(@as(u32, 1), a[1]);
}

test "bary point round trip crosses the diagonal consistently" {
    setupQuadTarget();
    defer {
        clear();
        model_source.clear();
    }
    // A point inside tri A, expressed on tri B's plane, maps back to the same 3D spot.
    const p = pointFromBary(0, 0.4, 0.3);
    const uvb = baryOfPointOnFace(1, p);
    const p2 = pointFromBary(1, uvb[0], uvb[1]);
    try std.testing.expectApproxEqAbs(p[0], p2[0], 1e-5);
    try std.testing.expectApproxEqAbs(p[1], p2[1], 1e-5);
    try std.testing.expectApproxEqAbs(p[2], p2[2], 1e-5);
}
