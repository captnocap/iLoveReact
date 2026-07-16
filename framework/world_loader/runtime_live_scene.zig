//! Live mesh/material residency, erase, wall-hide, and overlay node reconciliation.
//!
//! Operations are generic over the retained Runtime shape to keep ownership in runtime.zig.

const std = @import("std");
const material_tex = @import("../gpu/material_tex.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const constructor = @import("../world/constructor.zig");
const live_mesh_doors = @import("../world/live_mesh_doors.zig");
const log = std.debug;
const m_config = @import("config.zig");
const m_state = @import("state.zig");
const m_instances = @import("instances.zig");
const m_streaming_support = @import("streaming_support.zig");
const m_live_inputs = @import("live_inputs.zig");
const runtime_dynamics = @import("runtime_dynamics.zig");

const MATERIAL_TILE_PX = m_config.MATERIAL_TILE_PX;
const INSTANCE_STRIDE = m_config.INSTANCE_STRIDE;
const WALL_SENTINEL_SHAPE = m_config.WALL_SENTINEL_SHAPE;
const GLASS_TINT = m_state.GLASS_TINT;
const LIVE_TEXTURED_ALPHA_ROUTE_ALPHA = m_state.LIVE_TEXTURED_ALPHA_ROUTE_ALPHA;
const LIVE_DOOR_FLAT_GLASS_ALPHA = m_state.LIVE_DOOR_FLAT_GLASS_ALPHA;
const appendInstanceRow = m_instances.appendInstanceRow;
const BakedRange = m_streaming_support.BakedRange;
const EraseRect = m_streaming_support.EraseRect;
const liveMeshHash = m_live_inputs.liveMeshHash;
const meshPosKey = m_live_inputs.meshPosKey;
const LiveMeshRef = m_live_inputs.LiveMeshRef;
const pendingLiveMeshFor = m_live_inputs.pendingLiveMeshFor;
const pendingLiveMatsFor = m_live_inputs.pendingLiveMatsFor;
const SKIN_BOX_OUTSET = m_live_inputs.SKIN_BOX_OUTSET;
const pendingSkinBoxesFor = m_live_inputs.pendingSkinBoxesFor;
const pendingDirtyEraseFor = m_live_inputs.pendingDirtyEraseFor;
const pendingWallHideFor = m_live_inputs.pendingWallHideFor;
const pendingResidentFor = m_live_inputs.pendingResidentFor;
const LIVE_MESH_GHOST_ALPHA = m_live_inputs.LIVE_MESH_GHOST_ALPHA;
const pendingMeshGhostFor = m_live_inputs.pendingMeshGhostFor;
const applyCookedDoorPose = runtime_dynamics.applyCookedDoorPose;

pub fn meshPropTexKey(self: anytype, material_ref: u32) !?[]const u8 {
    if (material_ref == 0) return null;
    const mi: usize = @intCast(material_ref - 1);
    if (mi >= self.scene.materials.len) return null;
    const material = self.scene.materials[mi];
    if (material.wgsl.len == 0 and material.decal_doc.len == 0) return null;
    const key = try std.fmt.allocPrint(self.allocator, "wmat-{d}", .{mi});
    errdefer self.allocator.free(key);
    try self.player_geom_keys.append(self.allocator, key);
    return key;
}

pub fn appendMeshPropNode(
    self: anytype,
    mesh: constructor.MeshPropMesh,
    inst: constructor.MeshPropInstance,
    key: []const u8,
    start: u32,
    count: u32,
    material_ref: u32,
    alpha_override: ?f32,
    tex_key_override: ?[]const u8,
) !void {
    if (count == 0) return;
    const float_start: usize = @as(usize, @intCast(start)) * 8;
    const float_count: usize = @as(usize, @intCast(count)) * 8;
    if (float_start + float_count > mesh.vertices.len) return;
    const tex_key = try meshPropTexKey(self, material_ref);
    // tex_key_override (LIVESKIN req_1843): a live face-skin materialized into its own
    // "live-mat:<hash>" tile wins over the mesh's baked texture. It rides the mesh's OWN
    // UVs with no per-frame flip-copy (the live path runs every frame — a copy would leak);
    // the exact V-orientation lands on Compile.
    const eff_tex_key = tex_key_override orelse tex_key;
    const vertices = if (tex_key != null) blk: {
        const copy = try self.allocator.alloc(f32, float_count);
        errdefer self.allocator.free(copy);
        @memcpy(copy, mesh.vertices[float_start .. float_start + float_count]);
        var i: usize = 7;
        while (i < copy.len) : (i += 8) copy[i] = 1 - copy[i];
        try self.mesh_prop_vertex_buffers.append(self.allocator, copy);
        break :blk copy;
    } else mesh.vertices[float_start .. float_start + float_count];
    const material_index: usize = if (material_ref > 0) @intCast(material_ref - 1) else self.scene.materials.len;
    const opacity = if (material_index < self.scene.materials.len) self.scene.materials[material_index].opacity else 1;
    // alpha_override (LIVEMESH ghost req_1841): the hover preview forces a translucent
    // alpha so it reads as a not-yet-placed ghost; a<1 routes it to the transparent pass.
    const final_alpha = alpha_override orelse opacity;
    const textured = eff_tex_key != null or mesh.tex_rgba != null;
    // GLASS TINT (req_2020): a flat-translucent material (empty shader, no decal,
    // alpha<1) is a cooked-prop glass pane. The lump ships opacity only — without
    // this the node fell back to the prop's gray tint, so a window over bright sky
    // read as hollow. Tint it the editor's Glass() blue (mirrors materials.ts
    // GLASS_TINT '#a9c8d8') so /compiled glass matches the React play view.
    const glass_tint: ?[3]f32 = if (!textured and alpha_override == null and material_index < self.scene.materials.len) blk: {
        const m = self.scene.materials[material_index];
        break :blk if (m.wgsl.len == 0 and m.decal_doc.len == 0 and m.opacity < 0.999) GLASS_TINT else null;
    } else null;
    const node_color: [3]f32 = if (textured) .{ 1, 1, 1 } else (glass_tint orelse mesh.color);
    try self.kid_list.append(self.allocator, .{
        .scene3d_mesh = count > 0,
        .scene3d_geom_key = key,
        .scene3d_vertices = vertices,
        .scene3d_vert_count = count,
        .scene3d_bounds_radius = mesh.bounds_radius,
        .scene3d_pos_x = inst.x,
        .scene3d_pos_y = inst.y,
        .scene3d_pos_z = inst.z,
        .scene3d_rot_y = inst.yaw_degrees,
        .scene3d_color_r = node_color[0],
        .scene3d_color_g = node_color[1],
        .scene3d_color_b = node_color[2],
        .scene3d_color_a = final_alpha,
        .scene3d_tex_w = if (eff_tex_key == null) mesh.tex_w else 0,
        .scene3d_tex_h = if (eff_tex_key == null) mesh.tex_h else 0,
        .scene3d_tex_rgba = if (eff_tex_key == null) mesh.tex_rgba else null,
        .scene3d_tex_key = eff_tex_key,
    });
}

// LIVEMESH req_1812: map every resident mesh-prop's key-hash → its mesh index, once.
// The editor pushes the SAME hash (FNV-1a of the mesh key the bake assigned), so a
// live placement resolves to the loaded mesh with no string marshalling across V8.
pub fn ensureMeshHashMap(self: anytype) void {
    if (self.mesh_hash_built) return;
    self.mesh_hash_built = true;
    const mp = self.scene.mesh_props orelse return;
    for (mp.meshes, 0..) |mesh, i| {
        self.mesh_by_hash.put(self.allocator, liveMeshHash(mesh.key), i) catch {};
    }
}

// FULLRES: resolve a live ref's key-hash to a loaded mesh — the BAKED scene meshes first
// (those carry their lump-loaded textures), then the editor's pushed resident catalog. Null
// when neither holds it (asset not installed). The two sets share the FNV-1a key-hash space,
// so a placement ref resolves whether the prop was baked into the gamefile or just compiled.
pub fn meshForHash(self: anytype, hash: u32) ?constructor.MeshPropMesh {
    if (self.scene.mesh_props) |mp| {
        if (self.mesh_by_hash.get(hash)) |idx| {
            if (idx < mp.meshes.len) return mp.meshes[idx];
        }
    }
    if (self.resident) |res| {
        if (self.resident_by_hash.get(hash)) |idx| {
            if (idx < res.meshes.len) return res.meshes[idx];
        }
    }
    return null;
}

// The stable per-slot geom key for a live mesh ref — "{meshKey}:base" (code 0) or
// "{meshKey}:slot-N" (code N+1), the SAME strings the baked slotted draw interns, so the
// two share one interned geometry slice. Built once per (meshHash, code) and cached (the
// live draw runs every frame; an allocPrint per frame would leak). Null on OOM → the caller
// falls back to the whole-mesh key (a coarser but safe draw).
pub fn liveSlotKey(self: anytype, mesh: constructor.MeshPropMesh, hash: u32, code: u32) ?[]const u8 {
    const packed_key: u64 = (@as(u64, hash) << 32) | @as(u64, code);
    if (self.live_slot_keys.get(packed_key)) |k| return k;
    const key = (if (code == 0)
        std.fmt.allocPrint(self.allocator, "{s}:base", .{mesh.key})
    else
        std.fmt.allocPrint(self.allocator, "{s}:slot-{d}", .{ mesh.key, code - 1 })) catch return null;
    self.live_slot_keys.put(self.allocator, packed_key, key) catch {
        self.allocator.free(key);
        return null;
    };
    return key;
}

pub fn liveCookedDoorIndex(self: anytype, r: LiveMeshRef) ?usize {
    const id = live_mesh_doors.identity(r.hash, r.x, r.y, r.z, r.yaw);
    if (self.live_cooked_door_by_identity.get(id)) |index| return index;
    // OOM while rebuilding the acceleration map must degrade to a small
    // linear scan, never to a physical door whose visible leaf cannot move.
    for (self.live_cooked_door_states, 0..) |state, index| {
        if (state.identity == id) return index;
    }
    return null;
}

// LIVEMESH req_1812: append draw node(s) for each live-placed mesh prop, referencing an
// already-resident mesh. Called at the END of stepNow, after refreshStreamNodes rebuilt the
// stream tail — so the streaming path truncated last frame's live nodes for us; the monolithic
// path truncates them here to perm_node_count. The hover GHOST (req_1841) rides the same path
// with a forced translucent alpha. req_2025: a multi-slot prop emits one node per texture slot
// so each slot wears its own skin (material_ref 0 throughout → no per-frame vertex allocation;
// the per-slot skin rides as a tex_key_override, the base/atlas slots ride mesh.tex_rgba).
pub fn appendLiveMeshRef(self: anytype, r: LiveMeshRef, alpha: ?f32) void {
    const mesh = meshForHash(self, r.hash) orelse return;
    // SPINPROP req_3128: a spinning prop DRAWS at yaw + rate×clock (the live tail is
    // rebuilt every frame, so this is the whole animation). Everything identity-shaped —
    // door state, the coincident baked-hide key, colliders — keeps the authored r.yaw.
    const draw_yaw = if (r.spin_deg_per_sec != 0)
        @mod(r.yaw + r.spin_deg_per_sec * self.live_spin_seconds, 360.0)
    else
        r.yaw;
    const inst: constructor.MeshPropInstance = .{ .mesh = 0, .x = r.x, .y = r.y, .z = r.z, .yaw_degrees = draw_yaw };
    // A placement (never the translucent ghost) binds to the live two-state
    // machine compiled by applyLiveColliders. Node indices are refreshed on
    // every append because the live draw tail is rebuilt every frame.
    const live_door_index = if (alpha == null and mesh.door != null) liveCookedDoorIndex(self, r) else null;
    if (live_door_index) |di| {
        if (di < self.live_cooked_doors.len) self.live_cooked_doors[di].node_child_count = 0;
    }
    // No texture slots, or no per-slot mats (ghost / unskinned new placement) → the whole
    // mesh on one optional override (back-compat: a single-surface prop's lone skin).
    // A door MUST split even without material overrides: its leaf slot needs
    // an independent node for the hinge animation.
    if (mesh.door == null and (mesh.slots.len == 0 or r.mats.len == 0)) {
        const override: ?[]const u8 = if (r.mats.len > 0 and r.mats[0] != 0) self.live_mat_keys.get(r.mats[0]) else null;
        // A facade (and any other painted resident mesh) bakes its untouched
        // texels as alpha-zero. Keep its draw out of the opaque depth-writing
        // pass so those holes reveal the wall face underneath; the shared mesh
        // shader discards the empty texels and blends the painted ones.
        const textured_alpha_route = alpha == null and override == null and
            live_mesh_doors.routeTexturedMeshTransparent(mesh.texture_has_translucency);
        const node_alpha = if (textured_alpha_route) LIVE_TEXTURED_ALPHA_ROUTE_ALPHA else alpha;
        appendMeshPropNode(self, mesh, inst, mesh.key, 0, mesh.vertex_count, 0, node_alpha, override) catch {};
        return;
    }
    // PER-SLOT (req_2025): mirror the baked slotted draw so a multi-slot cooked prop wears
    // each slot's own skin instead of the FIRST skin smeared over every face. The base
    // range (faces before slot 0) and any trailing loader slot past mats.len (glass/leaf)
    // get no override → the mesh's baked atlas, exactly as today's whole-mesh live draw.
    const first_slot_start = mesh.slots[0].start;
    if (first_slot_start > 0) {
        const key = liveSlotKey(self, mesh, r.hash, 0) orelse mesh.key;
        appendMeshPropNode(self, mesh, inst, key, 0, first_slot_start, 0, alpha, null) catch {};
    }
    for (mesh.slots, 0..) |slot, si| {
        const key = liveSlotKey(self, mesh, r.hash, @as(u32, @intCast(si + 1))) orelse mesh.key;
        const mat_hash: u32 = if (si < r.mats.len) r.mats[si] else 0;
        const override: ?[]const u8 = if (mat_hash != 0) self.live_mat_keys.get(mat_hash) else null;
        const node_first = self.kid_list.items.len;
        // Door compiler convention: leaf_slot is opaque; every trailing slot
        // is Studio-marked leaf glass. A placed live mesh has no baked material
        // ref for that slot, so route it explicitly through the transparent
        // depth-write-OFF pass. Its atlas alpha remains authoritative.
        const live_door_glass = alpha == null and if (mesh.door) |door|
            live_mesh_doors.routeSlotTransparent(si, door.leaf_slot, mesh.slots.len, mesh.texture_has_translucency)
        else
            false;
        const slot_alpha = if (live_door_glass)
            (if (mesh.tex_rgba != null or override != null) LIVE_TEXTURED_ALPHA_ROUTE_ALPHA else LIVE_DOOR_FLAT_GLASS_ALPHA)
        else
            alpha;
        appendMeshPropNode(self, mesh, inst, key, slot.start, slot.count, 0, slot_alpha, override) catch {};
        if (live_door_glass and mesh.tex_rgba == null and override == null) {
            for (self.kid_list.items[node_first..]) |*node| {
                node.scene3d_color_r = GLASS_TINT[0];
                node.scene3d_color_g = GLASS_TINT[1];
                node.scene3d_color_b = GLASS_TINT[2];
            }
        }
        if (live_door_index) |di| {
            if (di < self.live_cooked_doors.len) {
                if (mesh.door) |door| {
                    if (si >= door.leaf_slot and self.kid_list.items.len > node_first) {
                        if (self.live_cooked_doors[di].node_child_count == 0) {
                            self.live_cooked_doors[di].node_child_first = node_first;
                        }
                        self.live_cooked_doors[di].node_child_count =
                            self.kid_list.items.len - self.live_cooked_doors[di].node_child_first;
                    }
                }
            }
        }
    }
    if (live_door_index) |di| {
        if (di < self.live_cooked_doors.len) applyCookedDoorPose(self, &self.live_cooked_doors[di]);
    }
}

// FULLRES: decode + install the pushed resident catalog once per generation. The lump is a
// standard MESH_PROPS buffer (meshes only) — the SAME decode the gamefile uses, so textures
// (tex_rgba) and slots come through identically and a resident mesh renders exactly as a
// baked one would.
pub fn applyResidentMeshes(self: anytype) void {
    const pend = pendingResidentFor(self.node_id) orelse return;
    if (pend.gen == self.applied_resident_gen) return;
    self.applied_resident_gen = pend.gen;
    if (self.resident) |*old| old.deinit(self.allocator);
    self.resident = null;
    self.resident_by_hash.clearRetainingCapacity();
    if (pend.bytes.len == 0) return;
    const decoded = constructor.decodeMeshProps(self.allocator, pend.bytes) catch |e| {
        log.print("[loader] resident catalog decode failed: {any}\n", .{e});
        return;
    };
    self.resident = decoded;
    for (decoded.meshes, 0..) |mesh, i| {
        self.resident_by_hash.put(self.allocator, liveMeshHash(mesh.key), i) catch {};
    }
    log.print("[loader] resident catalog: {d} cooked mesh(es) ready (no rebake to place)\n", .{decoded.meshes.len});
}

// LIVESKIN req_1843: materialize the editor's queued face-skin recipes (GPU is up by
// render time), once per hash, into "live-mat:<hash>" tiles a live mesh ref then samples.
pub fn ensureLiveMaterials(self: anytype) void {
    const pm = pendingLiveMatsFor(self.node_id) orelse return;
    for (pm.mats.items) |m| {
        if (self.live_mat_keys.contains(m.hash)) continue;
        const key = std.fmt.allocPrint(self.allocator, "live-mat:{x}", .{m.hash}) catch continue;
        const data: ?[]const f32 = if (m.data.len > 0) m.data else null;
        const ok = if (m.kind == 0) material_tex.materialize(key, m.wgsl, data, MATERIAL_TILE_PX) else false;
        if (!ok) {
            self.allocator.free(key);
            continue;
        }
        self.live_mat_keys.put(self.allocator, m.hash, key) catch self.allocator.free(key);
    }
}

// RESKIN req_1845: a baked mesh-prop instance's nodes shown/hidden as a block.
pub fn setBakedRangeVisible(self: anytype, rng: BakedRange, visible: bool) void {
    var k: u32 = 0;
    while (k < rng.count) : (k += 1) {
        const ni: usize = @as(usize, rng.first) + k;
        if (ni < self.kid_list.items.len) self.kid_list.items[ni].scene3d_mesh = visible;
    }
}

// DIRTYRECT — the scale floats of a stride-N instance row (collapse target).
pub fn rowScaleBase(stride: usize) usize {
    return if (stride >= 12) 6 else 3;
}

pub fn pointInAnyEraseRect(rects: []const EraseRect, x: f32, y: f32, z: f32, test_y: bool) bool {
    for (rects) |r| {
        if (x >= r.min_x and x <= r.max_x and z >= r.min_z and z <= r.max_z) {
            if (!test_y or (y >= r.min_y and y <= r.max_y)) return true;
        }
    }
    return false;
}

// Collapse (scale→0) every row of a static instance buffer whose center sits inside
// an erase rect, recording the originals so a changed rect set restores them first.
// Returns whether anything changed (the owning node then re-uploads via its version).
pub fn collapseRowsInRects(self: anytype, buf: []f32, count: u32, stride: usize, rects: []const EraseRect) bool {
    if (count == 0 or buf.len < stride or rects.len == 0) return false;
    const sb = rowScaleBase(stride);
    var any = false;
    var row: usize = 0;
    while (row < count) : (row += 1) {
        const o = row * stride;
        if (o + sb + 3 > buf.len) break;
        if (buf[o + sb] == 0 and buf[o + sb + 1] == 0 and buf[o + sb + 2] == 0) continue; // already gone
        if (!pointInAnyEraseRect(rects, buf[o + 0], buf[o + 1], buf[o + 2], true)) continue;
        self.erased_rows.append(self.allocator, .{ .buf = buf, .row = row, .sx = buf[o + sb], .sy = buf[o + sb + 1], .sz = buf[o + sb + 2] }) catch {};
        buf[o + sb] = 0;
        buf[o + sb + 1] = 0;
        buf[o + sb + 2] = 0;
        any = true;
    }
    return any;
}

// DIRTYRECT req_1891/1892: erase the baked geometry a moved/deleted piece left at its
// old footprint, WITHOUT a rebake. Runs once per pushed rect generation (the GPU
// re-upload is the cost): un-collapse last round's box rows, collapse the rows inside
// the current rects, and bump every static node's version so the edited batches
// re-stage in place. Mesh-prop hides are recomputed per frame in applyLiveMeshProps
// (cheap bool toggles) so they need no generation gate here.
pub fn applyDirtyErase(self: anytype) void {
    const pend = pendingDirtyEraseFor(self.node_id) orelse return;
    if (pend.gen == self.applied_erase_gen) return;
    self.applied_erase_gen = pend.gen;
    const sb = rowScaleBase(self.stride);
    // 1. restore every row we collapsed last round (scale back to original).
    for (self.erased_rows.items) |er| {
        const o = er.row * self.stride + sb;
        if (o + 3 <= er.buf.len) {
            er.buf[o] = er.sx;
            er.buf[o + 1] = er.sy;
            er.buf[o + 2] = er.sz;
        }
    }
    self.erased_rows.clearRetainingCapacity();
    // 2. collapse the SOLID instance rows inside the current rects (flora is left
    // alone — a piece move never erases grass/flowers/fronds/palms). Streaming draws
    // its OWN spatially-sorted copies (w.families), so collapse THOSE; the monolithic
    // path collapses the shape/material batches directly.
    const rects = pend.rects;
    if (rects.len > 0) {
        if (self.stream) |*w| {
            for (w.families) |*fam| {
                if (fam.draw_radius > 0) continue; // flora family (req_1665 half-radius) — skip
                if (fam.rows.len >= fam.stride) _ = collapseRowsInRects(self, fam.rows, @intCast(fam.rows.len / fam.stride), fam.stride, rects);
            }
        } else {
            if (self.has_shape_batches) {
                const s = self.shape_batches;
                _ = collapseRowsInRects(self, s.boxes, s.box_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.boxes_open_run_min, s.box_open_run_min_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.boxes_open_run_max, s.box_open_run_max_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.boxes_open_run_both, s.box_open_run_both_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.ramps, s.ramp_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.cylinder8s, s.cylinder8_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.cylinder16s, s.cylinder16_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.spheres, s.sphere_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.gables, s.gable_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.corner_miters, s.corner_miter_count, self.stride, rects);
                _ = collapseRowsInRects(self, s.corner_miter_mirrors, s.corner_miter_mirror_count, self.stride, rects);
            }
            for (self.material_batches) |mb| _ = collapseRowsInRects(self, mb.boxes, mb.count, self.stride, rects);
        }
    }
    // 3. re-upload the edited static batches in place. Both paths bump a version the
    // static cache keys re-staging off (once per edit, vs a per-frame restage); the
    // touched-only refinement is a later optimization for huge maps. Streaming nodes are
    // rebuilt every frame, so they read the version from stream_erase_gen in refreshStreamNodes.
    if (self.stream != null) {
        self.stream_erase_gen +%= 1;
    } else {
        var ni: usize = 0;
        const limit = @min(self.perm_node_count, self.kid_list.items.len);
        while (ni < limit) : (ni += 1) {
            if (self.kid_list.items[ni].scene3d_instance_static) self.kid_list.items[ni].scene3d_instance_version +%= 1;
        }
    }
}

// WALLHIDE req_2053: collapse (scale→0) every WALL row of a built batch/family buffer —
// the rows appendInstanceRow stamped with WALL_SENTINEL in their shape slot. Records each
// collapsed row's original scale (twin of collapseRowsInRects) so toggling OFF restores it.
// Skips rows already collapsed (an erase rect got there first) so the two never double up.
pub fn collapseWallRows(self: anytype, buf: []f32, count: u32, stride: usize) bool {
    if (count == 0 or stride < 13 or buf.len < stride) return false;
    const sb = rowScaleBase(stride);
    var any = false;
    var row: usize = 0;
    while (row < count) : (row += 1) {
        const o = row * stride;
        if (o + sb + 3 > buf.len) break;
        if (buf[o + 12] != WALL_SENTINEL_SHAPE) continue; // not a wall row
        if (buf[o + sb] == 0 and buf[o + sb + 1] == 0 and buf[o + sb + 2] == 0) continue; // already gone (erased)
        self.wall_collapsed_rows.append(self.allocator, .{ .buf = buf, .row = row, .sx = buf[o + sb], .sy = buf[o + sb + 1], .sz = buf[o + sb + 2] }) catch {};
        buf[o + sb] = 0;
        buf[o + sb + 1] = 0;
        buf[o + sb + 2] = 0;
        any = true;
    }
    return any;
}

// WALLHIDE req_2053: the editor build pane's "disable walls" toggle, with NO rebake — mirror
// of applyDirtyErase. Re-runs only when the toggle flipped (its gen) OR an erase pass advanced
// (it may have restored a wall row this pass hid; re-collapsing keeps them consistent). Restore
// last round's collapses, collapse every WALL row when ON, then bump the same node/stream
// version the erase path does so the edited batches re-upload once.
pub fn applyWallHide(self: anytype) void {
    const pend = pendingWallHideFor(self.node_id);
    const want = if (pend) |p| p.on else false;
    const gen = if (pend) |p| p.gen else 0;
    // Mirror the state for applyLiveMeshProps (runs later this frame) so it hides the
    // cooked-wall MESH PROPS too — those aren't instance rows, so they ride that path.
    self.hide_walls = want;
    if (gen == self.applied_wall_gen and self.applied_erase_gen == self.wall_seen_erase_gen) return;
    self.applied_wall_gen = gen;
    self.wall_seen_erase_gen = self.applied_erase_gen;
    const sb = rowScaleBase(self.stride);
    // 1. restore every wall row we collapsed last round.
    for (self.wall_collapsed_rows.items) |er| {
        const o = er.row * self.stride + sb;
        if (o + 3 <= er.buf.len) {
            er.buf[o] = er.sx;
            er.buf[o + 1] = er.sy;
            er.buf[o + 2] = er.sz;
        }
    }
    self.wall_collapsed_rows.clearRetainingCapacity();
    // 2. collapse every wall row when the toggle is ON. Streaming draws its OWN sorted
    // copies (w.families); the monolithic path collapses the shape/material batches.
    if (want) {
        if (self.stream) |*w| {
            for (w.families) |*fam| {
                if (fam.draw_radius > 0) continue; // flora family — never a wall
                if (fam.rows.len >= fam.stride) _ = collapseWallRows(self, fam.rows, @intCast(fam.rows.len / fam.stride), fam.stride);
            }
        } else {
            if (self.has_shape_batches) {
                const s = self.shape_batches;
                _ = collapseWallRows(self, s.boxes, s.box_count, self.stride);
                _ = collapseWallRows(self, s.boxes_open_run_min, s.box_open_run_min_count, self.stride);
                _ = collapseWallRows(self, s.boxes_open_run_max, s.box_open_run_max_count, self.stride);
                _ = collapseWallRows(self, s.boxes_open_run_both, s.box_open_run_both_count, self.stride);
                _ = collapseWallRows(self, s.ramps, s.ramp_count, self.stride);
                _ = collapseWallRows(self, s.gables, s.gable_count, self.stride);
                _ = collapseWallRows(self, s.corner_miters, s.corner_miter_count, self.stride);
                _ = collapseWallRows(self, s.corner_miter_mirrors, s.corner_miter_mirror_count, self.stride);
            }
            for (self.material_batches) |mb| _ = collapseWallRows(self, mb.boxes, mb.count, self.stride);
        }
    }
    // 3. re-upload the edited static batches in place (same invalidation as applyDirtyErase).
    if (self.stream != null) {
        self.stream_erase_gen +%= 1;
    } else {
        var ni: usize = 0;
        const limit = @min(self.perm_node_count, self.kid_list.items.len);
        while (ni < limit) : (ni += 1) {
            if (self.kid_list.items[ni].scene3d_instance_static) self.kid_list.items[ni].scene3d_instance_version +%= 1;
        }
    }
}

// LIVEBLDSKIN req_1849: append a textured cube per procedurally-skinned building-piece
// face, OUTSET a hair so it covers the baked face-slab (building-piece boxes are batched
// instanced draws — can't hide one — so we cover instead of hide). One-instance box nodes
// into a pre-sized per-frame buffer (stable slices while kid_list grows).
pub fn appendLiveSkinBoxes(self: anytype) void {
    const sb = pendingSkinBoxesFor(self.node_id) orelse return;
    if (sb.boxes.len == 0) return;
    self.skin_box_buf.clearRetainingCapacity();
    self.skin_box_buf.ensureTotalCapacity(self.allocator, sb.boxes.len * INSTANCE_STRIDE) catch return;
    const out = SKIN_BOX_OUTSET;
    for (sb.boxes) |b| {
        const key = self.live_mat_keys.get(b.mat_hash) orelse continue; // material not materialized yet
        // A zero dimension marks a FLAT sticker stamp (req_3028): stickers are
        // planes, not solids — draw the matching 12-vert quad (4 tris vs the
        // cube's 12) at EXACT size (the stamp already floats off its face; the
        // slab-covering outset is a box concern). Scale on the thin axis stays 1
        // so the normal math never multiplies by zero.
        const flat_x = b.sx == 0;
        const flat_y = b.sy == 0;
        const flat_z = b.sz == 0;
        const flat = flat_x or flat_y or flat_z;
        const start = self.skin_box_buf.items.len;
        if (flat) {
            self.skin_box_buf.appendSliceAssumeCapacity(&[_]f32{
                b.cx, b.cy, b.cz, 0, b.yaw, 0,
                if (flat_x) 1 else b.sx, if (flat_y) 1 else b.sy, if (flat_z) 1 else b.sz,
                1, 1, 1,
            });
        } else {
            self.skin_box_buf.appendSliceAssumeCapacity(&[_]f32{ b.cx, b.cy, b.cz, 0, b.yaw, 0, b.sx + out, b.sy + out, b.sz + out, 1, 1, 1 });
        }
        const row = self.skin_box_buf.items[start .. start + INSTANCE_STRIDE];
        self.kid_list.append(self.allocator, .{
            .scene3d_mesh = true,
            .scene3d_geom_key = if (flat_x) "sticker_quad_x" else if (flat_y) "sticker_quad_y" else if (flat_z) "sticker_quad_z" else "box",
            .scene3d_vertices = if (flat_x) self.sticker_quad_x[0..] else if (flat_y) self.sticker_quad_y[0..] else if (flat_z) self.sticker_quad_z[0..] else self.cube[0..],
            .scene3d_vert_count = if (flat) 12 else 36,
            .scene3d_instance_data = row,
            .scene3d_instance_count = 1,
            .scene3d_instance_stride = @intCast(INSTANCE_STRIDE),
            .scene3d_instance_static = false,
            .scene3d_tex_key = key,
        }) catch {};
    }
}

pub fn applyLiveMeshProps(self: anytype) void {
    if (self.stream == null) self.kid_list.shrinkRetainingCapacity(self.perm_node_count);
    defer self.root.children = self.kid_list.items; // append may realloc; re-point the root
    ensureLiveMaterials(self);
    applyResidentMeshes(self); // FULLRES: install the editor's pushed cooked-asset catalog (once per gen)
    // RESKIN req_1845: un-hide whatever we hid last frame before re-evaluating, so a
    // reverted/reloaded prop shows its baked render again.
    for (self.hidden_baked.items) |rng| setBakedRangeVisible(self, rng, true);
    self.hidden_baked.clearRetainingCapacity();
    // Live mesh-prop refs resolve against the baked scene meshes AND the resident catalog
    // (meshForHash), so they draw even on a map with no baked mesh props — a just-compiled
    // asset places instantly off residency, no rebake.
    ensureMeshHashMap(self); // baked hash map (no-op when the map baked no mesh props)
    if (pendingLiveMeshFor(self.node_id)) |p| {
        for (p.refs) |r| {
            appendLiveMeshRef(self, r, null);
            // A live ref coincident with a BAKED instance is a RE-SKIN of an existing prop
            // (the editor pushes those + brand-new placements at fresh positions) — hide the
            // stale baked draw so the two don't z-fight. Resident-only meshes have no baked
            // twin, so this is gated on the baked table.
            if (self.scene.mesh_props != null and self.baked_by_pos.count() > 0) {
                if (self.mesh_by_hash.get(r.hash)) |idx| {
                    if (self.baked_by_pos.get(meshPosKey(idx, r.x, r.z, r.yaw))) |rng| {
                        setBakedRangeVisible(self, rng, false);
                        self.hidden_baked.append(self.allocator, rng) catch {};
                    }
                }
            }
        }
    }
    // The placement ghost: the armed mesh prop, translucent, tracking the snap target.
    if (pendingMeshGhostFor(self.node_id)) |gh| {
        if (gh.has) appendLiveMeshRef(self, gh.ref, LIVE_MESH_GHOST_ALPHA);
    }
    // DIRTYRECT req_1891/1892: hide every baked mesh prop whose old position sits inside
    // an active erase rect — the MOVED-prop case the coincident-hide above misses (the
    // live ref has moved to the new spot). Cheap bool toggles, recomputed each frame and
    // restored by the hidden_baked un-hide above; the live overlay draws the new position.
    if (pendingDirtyEraseFor(self.node_id)) |pend| {
        if (pend.rects.len > 0 and self.baked_mesh_list.items.len > 0) {
            for (self.baked_mesh_list.items) |bm| {
                if (pointInAnyEraseRect(pend.rects, bm.x, bm.y, bm.z, false)) {
                    setBakedRangeVisible(self, bm.range, false);
                    self.hidden_baked.append(self.allocator, bm.range) catch {};
                }
            }
        }
    }
    // WALLHIDE req_2058: hide every baked cooked-wall mesh prop while "disable walls" is on
    // (the box walls collapse via applyWallHide; these are mesh-prop nodes, hidden by range).
    // Recomputed each frame and restored by the hidden_baked un-hide above, exactly like erase.
    if (self.hide_walls) {
        for (self.baked_mesh_list.items) |bm| {
            if (!bm.wall) continue;
            setBakedRangeVisible(self, bm.range, false);
            self.hidden_baked.append(self.allocator, bm.range) catch {};
        }
    }
    appendLiveSkinBoxes(self);
}
