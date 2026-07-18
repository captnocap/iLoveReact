//! Pending editor inputs and live-overlay reconciliation.
//!
//! Setters own process-global ingress slots keyed by loader node id. Apply functions
//! reconcile one slot into an explicit runtime at the frame boundary.

const std = @import("std");
const constructor = @import("../world/constructor.zig");
const game_physics = @import("../game/physics.zig");
const instance_collider_policy = @import("../world/instance_collider_policy.zig");
const live_mesh_doors = @import("../world/live_mesh_doors.zig");
const config = @import("config.zig");
const loader_state = @import("state.zig");
const instances = @import("instances.zig");
const physics = @import("physics.zig");
const streaming_support = @import("streaming_support.zig");
const log = std.debug;
const INSTANCE_STRIDE = config.INSTANCE_STRIDE;
const CAMERA_FOV_DEGREES = config.CAMERA_FOV_DEGREES;
const PHYSICS_SOLID_HEIGHT_METERS = config.PHYSICS_SOLID_HEIGHT_METERS;
const MAX_EMBEDDED_LOADERS = config.MAX_EMBEDDED_LOADERS;
const Vec3 = loader_state.Vec3;
const CookedDoor = loader_state.CookedDoor;
const cookedDoorWorldBox = loader_state.cookedDoorWorldBox;
const cookedDoorRectFloats = loader_state.cookedDoorRectFloats;
const solidVertexCount = loader_state.solidVertexCount;
const instanceYawRadians = instances.instanceYawRadians;
const rectFloats = instances.rectFloats;
const orientedFloats = instances.orientedFloats;
const islandOrientedFloats = physics.islandOrientedFloats;
const meshPropIslands = physics.meshPropIslands;
const buildPhysicsColliders = physics.buildPhysicsColliders;
const EraseRect = streaming_support.EraseRect;

// External-camera pending table (LOADERVIEW req_1757): keyed by node id, INDEPENDENT of
// mount state (findMounted needs a live runtime, but the editor pushes a pose before the
// lazy first-render mount). applyPendingCam runs every renderEmbedded frame, so the iso
// pose survives the mount and Compile remounts with no JS frame loop (headless has no rAF).
pub const PendingCam = struct {
    node_id: u32 = 0,
    set: bool = false,
    pos: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    look: Vec3 = .{ .x = 0, .y = 0, .z = 0 },
    fov: f32 = CAMERA_FOV_DEGREES,
};
var g_pending_cams: [MAX_EMBEDDED_LOADERS]PendingCam = [_]PendingCam{.{}} ** MAX_EMBEDDED_LOADERS;

// Live physics-globals override (GLOBALS req_2770): the editor's Globals → Physics
// panel pushes the SAME 13 floats the PHYSICS_CONFIG lump bakes (order:
// gravity, jumpSpeed, playerRadius, playerHeight, stepHeight, wallRestitution,
// bodyRestitution, walkableSidePushGrace, accelMult, surfaceFriction,
// surfaceRestitution, walkSpeed, runSpeed — the encodePhysicsConfigLump layout),
// and the mounted runtime's NEXT physics step reads them. Keyed by node id and
// INDEPENDENT of mount state (same reason as PendingCam), applied each
// renderEmbedded frame; `on = false` reverts to the baked lump / built-ins.
pub const PHYSICS_CONFIG_FLOATS: usize = 13;
pub const PendingPhysics = struct {
    node_id: u32 = 0,
    set: bool = false,
    on: bool = false,
    values: [PHYSICS_CONFIG_FLOATS]f32 = @splat(0),
    gen: u64 = 0,
};
var g_pending_physics: [MAX_EMBEDDED_LOADERS]PendingPhysics = [_]PendingPhysics{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingPhysicsFor(node_id: u32) ?*PendingPhysics {
    for (&g_pending_physics) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live physics override for a node (GLOBALS req_2770). `bytes` is the raw
/// Float32Array backing (13 floats, lump order); we copy so the JS array can be freed.
/// Short/oversized payloads are rejected loudly — a wrong pack is a bug, not a default.
pub fn setPhysicsConfig(node_id: u32, bytes: []const u8) bool {
    if (bytes.len < PHYSICS_CONFIG_FLOATS * 4) {
        log.print("[loader] physics override rejected: {d} bytes (need {d})\n", .{ bytes.len, PHYSICS_CONFIG_FLOATS * 4 });
        return false;
    }
    var slot: ?*PendingPhysics = pendingPhysicsFor(node_id);
    if (slot == null) {
        for (&g_pending_physics) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return false;
    p.node_id = node_id;
    p.set = true;
    p.on = true;
    @memcpy(std.mem.sliceAsBytes(p.values[0..]), bytes[0 .. PHYSICS_CONFIG_FLOATS * 4]);
    p.gen +%= 1;
    return true;
}

/// Drop the live physics override for a node — the next step reads the baked
/// PHYSICS_CONFIG lump again (or the loader built-ins on a pre-lump/blank world).
pub fn clearPhysicsConfig(node_id: u32) void {
    const p = pendingPhysicsFor(node_id) orelse return;
    p.on = false;
    p.gen +%= 1;
}

// Copy the node's pending physics override into the runtime (gen-guarded, so a
// still panel costs nothing per frame). Field order = the lump order above.
pub fn applyPendingPhysics(runtime: anytype) void {
    const p = pendingPhysicsFor(runtime.node_id) orelse return;
    if (runtime.physics_override_gen == p.gen) return;
    runtime.physics_override = if (p.on) constructor.PhysicsConfig{
        .gravity = p.values[0],
        .jump_speed = p.values[1],
        .player_radius = p.values[2],
        .player_height = p.values[3],
        .step_height = p.values[4],
        .wall_restitution = p.values[5],
        .body_restitution = p.values[6],
        .walkable_side_push_grace = p.values[7],
        .accel_mult = p.values[8],
        .surface_friction = p.values[9],
        .surface_restitution = p.values[10],
        .walk_speed = p.values[11],
        .run_speed = p.values[12],
    } else null;
    runtime.physics_override_gen = p.gen;
}

// Live-pieces overlay (LIVEHOST req_1798): the editor pushes instance rows for pieces
// it has placed-but-not-yet-baked, and the loader draws them as real solid box meshes
// THIS frame — no rebake. Keyed by node id and INDEPENDENT of mount state (same reason
// as PendingCam: the push can arrive before the lazy first-render mount), applied each
// renderEmbedded. `gen` bumps on every set so a mounted runtime re-copies only on change.
// Owns its `rows` allocation (page_allocator), grown on demand and freed on clear/replace.
pub const PendingLive = struct {
    node_id: u32 = 0,
    set: bool = false,
    rows: []f32 = &.{}, // 12-stride instance rows (cx,cy,cz, 0,yaw,0, sx,sy,sz, r,g,b)
    count: usize = 0, // instance count (rows.len / INSTANCE_STRIDE)
    gen: u64 = 0,
};
var g_pending_live: [MAX_EMBEDDED_LOADERS]PendingLive = [_]PendingLive{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingLiveFor(node_id: u32) ?*PendingLive {
    for (&g_pending_live) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live overlay rows for a node (LIVEHOST req_1798). `bytes` is the raw
/// Float32Array backing (12 floats per instance); we own a copy so the JS array can be
/// freed. Bumps gen so applyPendingLive re-uploads on the next frame.
pub fn setLivePieces(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingLive = pendingLiveFor(node_id);
    if (slot == null) {
        for (&g_pending_live) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const float_count = bytes.len / 4;
    const new_rows = alloc.alloc(f32, float_count) catch return;
    @memcpy(std.mem.sliceAsBytes(new_rows), bytes[0 .. float_count * 4]);
    if (p.rows.len > 0) alloc.free(p.rows);
    p.node_id = node_id;
    p.set = true;
    p.rows = new_rows;
    p.count = float_count / INSTANCE_STRIDE;
    p.gen +%= 1;
}

/// Drop the live overlay for a node (after a bake reload folds the pieces into the
/// baked world). Keeps the slot so gen keeps advancing; frees the row allocation.
pub fn clearLivePieces(node_id: u32) void {
    const p = pendingLiveFor(node_id) orelse return;
    if (p.rows.len > 0) std.heap.page_allocator.free(p.rows);
    p.rows = &.{};
    p.count = 0;
    p.gen +%= 1;
}

// ── live editor MESH-prop overlay (LIVEMESH req_1812) ───────────────────────
// FNV-1a 32-bit over the mesh key's bytes — MUST match the JS fnv1a in pieceMeshes.tsx
// so a kind's key hashes the same on both sides (keys are ASCII content hashes / ids).
pub fn liveMeshHash(key: []const u8) u32 {
    var h: u32 = 2166136261;
    for (key) |b| {
        h ^= b;
        h *%= 16777619;
    }
    return h;
}

// RESKIN req_1845: a position+mesh identity for matching a live re-skin ref to the baked
// instance it replaces. The live ref and the baked instance carry the SAME authored x/z/yaw
// (a re-skin doesn't move the prop), so quantizing to mm / 0.01° matches them exactly.
pub fn meshPosKey(mesh_index: usize, x: f32, z: f32, yaw: f32) u64 {
    const xi: i64 = @intFromFloat(@round(x * 1000.0));
    const zi: i64 = @intFromFloat(@round(z * 1000.0));
    const yi: i64 = @intFromFloat(@round(yaw * 100.0));
    var h: u64 = 1469598103934665603;
    h = (h ^ @as(u64, @intCast(mesh_index & 0xffff))) *% 1099511628211;
    h = (h ^ @as(u64, @bitCast(xi))) *% 1099511628211;
    h = (h ^ @as(u64, @bitCast(zi))) *% 1099511628211;
    h = (h ^ @as(u64, @bitCast(yi))) *% 1099511628211;
    return h;
}

// A live mesh-prop ref: a resident-mesh key-hash + transform + per-slot material hashes
// (req_2025). `mats[i]` is the live material for loader texture slot i (0 = that slot wears
// the mesh's own baked atlas); an empty `mats` = the whole mesh on its baked texture (ghost /
// brand-new unskinned placement). Trailing loader slots beyond mats.len (glass/leaf) read 0.
// spin_deg_per_sec (SPINPROP req_3128): a continuous visual yaw rate — the draw
// spins about the placement anchor while colliders/door identity keep the
// authored yaw (the tickers/traffic law: animation is visual-only).
pub const LiveMeshRef = struct { hash: u32, x: f32, y: f32, z: f32, yaw: f32, spin_deg_per_sec: f32 = 0, mats: []u32 = &.{} };
pub const LIVE_MESH_HEADER_BYTES: usize = 24; // v1: u32 keyHash + 4×f32 + u32 matCount, then matCount×u32
pub const LIVE_MESH_HEADER_BYTES_V2: usize = 28; // v2: u32 keyHash + f32 x,y,z,yaw,spin + u32 matCount, then matCount×u32
pub const PendingLiveMesh = struct {
    node_id: u32 = 0,
    set: bool = false,
    refs: []LiveMeshRef = &.{},
    gen: u64 = 0,
};
var g_pending_live_mesh: [MAX_EMBEDDED_LOADERS]PendingLiveMesh = [_]PendingLiveMesh{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingLiveMeshFor(node_id: u32) ?*PendingLiveMesh {
    for (&g_pending_live_mesh) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live MESH-prop refs for a node (LIVEMESH req_1812). `bytes` packs a variable
/// stride per ref: a 24-byte header (u32 keyHash, f32 x,y,z,yaw, u32 matCount) then matCount×u32
/// per-slot material hashes (little-endian, the layout pieceMeshes.tsx writes). We own a copy
/// (refs + each ref's mats array) so the JS buffer can be freed.
pub fn setLiveMeshProps(node_id: u32, bytes: []const u8) void {
    setLiveMeshPropsWire(node_id, bytes, LIVE_MESH_HEADER_BYTES);
}

/// The v2 wire (SPINPROP req_3128): a 28-byte header that carries spin_deg_per_sec
/// between yaw and matCount. Its own door (__compiled_world_set_live_mesh_props2) so
/// an older host keeps decoding v1 pushes correctly — the editor presence-gates.
pub fn setLiveMeshProps2(node_id: u32, bytes: []const u8) void {
    setLiveMeshPropsWire(node_id, bytes, LIVE_MESH_HEADER_BYTES_V2);
}

fn setLiveMeshPropsWire(node_id: u32, bytes: []const u8, header_bytes: usize) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingLiveMesh = pendingLiveMeshFor(node_id);
    if (slot == null) {
        for (&g_pending_live_mesh) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    // VARIABLE STRIDE (req_2025): each ref is a fixed header + matCount×u32, so walk the
    // buffer with a cursor into an ArrayList instead of a fixed divide. A malformed tail
    // (header runs past the buffer) just stops the walk — never reads out of bounds.
    const v2 = header_bytes == LIVE_MESH_HEADER_BYTES_V2;
    var built: std.ArrayListUnmanaged(LiveMeshRef) = .empty;
    var off: usize = 0;
    while (off + header_bytes <= bytes.len) {
        const mat_count = std.mem.bytesToValue(u32, bytes[off + header_bytes - 4 ..][0..4]);
        const mats_bytes = @as(usize, mat_count) * 4;
        if (off + header_bytes + mats_bytes > bytes.len) break; // truncated tail
        var mats: []u32 = &.{};
        if (mat_count > 0) {
            mats = alloc.alloc(u32, mat_count) catch break;
            var k: usize = 0;
            while (k < mat_count) : (k += 1) {
                mats[k] = std.mem.bytesToValue(u32, bytes[off + header_bytes + k * 4 ..][0..4]);
            }
        }
        built.append(alloc, .{
            .hash = std.mem.bytesToValue(u32, bytes[off..][0..4]),
            .x = std.mem.bytesToValue(f32, bytes[off + 4 ..][0..4]),
            .y = std.mem.bytesToValue(f32, bytes[off + 8 ..][0..4]),
            .z = std.mem.bytesToValue(f32, bytes[off + 12 ..][0..4]),
            .yaw = std.mem.bytesToValue(f32, bytes[off + 16 ..][0..4]),
            .spin_deg_per_sec = if (v2) std.mem.bytesToValue(f32, bytes[off + 20 ..][0..4]) else 0,
            .mats = mats,
        }) catch {
            if (mats.len > 0) alloc.free(mats);
            break;
        };
        off += header_bytes + mats_bytes;
    }
    freeLiveRefs(alloc, p.refs);
    p.node_id = node_id;
    p.set = true;
    p.refs = built.toOwnedSlice(alloc) catch &.{};
    p.gen +%= 1;
}

/// Free a live-mesh-ref slice plus each ref's owned per-slot mats array.
pub fn freeLiveRefs(alloc: std.mem.Allocator, refs: []LiveMeshRef) void {
    for (refs) |r| if (r.mats.len > 0) alloc.free(r.mats);
    if (refs.len > 0) alloc.free(refs);
}

/// Drop the live mesh-prop refs for a node (after a bake reload folds them in).
pub fn clearLiveMeshProps(node_id: u32) void {
    const p = pendingLiveMeshFor(node_id) orelse return;
    freeLiveRefs(std.heap.page_allocator, p.refs);
    p.refs = &.{};
    p.gen +%= 1;
}

// ── live editor face-skin MATERIALS (LIVESKIN req_1843) ─────────────────────
// A procedural skin pushed by the editor — its WGSL recipe + tuned data — queued per node
// until applyLiveMeshProps materializes it (the GPU is up by render time). Materialized once
// per hash into "live-mat:<hash>"; a live mesh ref bearing that mat_hash then wears it.
pub const LiveMat = struct { hash: u32, kind: u32, wgsl: []u8, data: []f32, opacity: f32 };
pub const PendingLiveMats = struct {
    node_id: u32 = 0,
    set: bool = false,
    mats: std.ArrayListUnmanaged(LiveMat) = .empty,
};
var g_pending_live_mats: [MAX_EMBEDDED_LOADERS]PendingLiveMats = [_]PendingLiveMats{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingLiveMatsFor(node_id: u32) ?*PendingLiveMats {
    for (&g_pending_live_mats) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Queue a live face-skin material for a node (LIVESKIN req_1843). kind 0 = shader (wgsl +
/// data). Owns copies of wgsl/data. Deduped by hash — the loader materializes each once.
pub fn setLiveMaterial(node_id: u32, hash: u32, kind: u32, wgsl: []const u8, data_bytes: []const u8, opacity: f32) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingLiveMats = pendingLiveMatsFor(node_id);
    if (slot == null) {
        for (&g_pending_live_mats) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    p.node_id = node_id;
    p.set = true;
    for (p.mats.items) |m| if (m.hash == hash) return; // already queued — materialized once
    const wgsl_copy = alloc.dupe(u8, wgsl) catch return;
    const n = data_bytes.len / 4;
    const data_copy = alloc.alloc(f32, n) catch {
        alloc.free(wgsl_copy);
        return;
    };
    var i: usize = 0;
    while (i < n) : (i += 1) data_copy[i] = std.mem.bytesToValue(f32, data_bytes[i * 4 ..][0..4]);
    p.mats.append(alloc, .{ .hash = hash, .kind = kind, .wgsl = wgsl_copy, .data = data_copy, .opacity = opacity }) catch {
        alloc.free(wgsl_copy);
        alloc.free(data_copy);
    };
}

// ── live BUILDING-PIECE skin boxes (LIVEBLDSKIN req_1849) ────────────────────
// A procedurally-skinned building-piece face, drawn as a textured cube outset over the
// baked face-slab. 32 bytes/box: cx,cy,cz, sx,sy,sz, yawDeg (f32), matHash (u32).
pub const SKIN_BOX_OUTSET: f32 = 0.008; // grow each dim so the live face protrudes past the baked
pub const SkinBox = struct { cx: f32, cy: f32, cz: f32, sx: f32, sy: f32, sz: f32, yaw: f32, mat_hash: u32 };
pub const SKIN_BOX_STRIDE_BYTES: usize = 32;
pub const PendingSkinBoxes = struct {
    node_id: u32 = 0,
    set: bool = false,
    boxes: []SkinBox = &.{},
    gen: u64 = 0,
};
var g_pending_skin_boxes: [MAX_EMBEDDED_LOADERS]PendingSkinBoxes = [_]PendingSkinBoxes{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingSkinBoxesFor(node_id: u32) ?*PendingSkinBoxes {
    for (&g_pending_skin_boxes) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the live building-piece skin boxes for a node (LIVEBLDSKIN req_1849).
pub fn setLiveSkinBoxes(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingSkinBoxes = pendingSkinBoxesFor(node_id);
    if (slot == null) {
        for (&g_pending_skin_boxes) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const n = bytes.len / SKIN_BOX_STRIDE_BYTES;
    const boxes = alloc.alloc(SkinBox, n) catch return;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const o = i * SKIN_BOX_STRIDE_BYTES;
        boxes[i] = .{
            .cx = std.mem.bytesToValue(f32, bytes[o..][0..4]),
            .cy = std.mem.bytesToValue(f32, bytes[o + 4 ..][0..4]),
            .cz = std.mem.bytesToValue(f32, bytes[o + 8 ..][0..4]),
            .sx = std.mem.bytesToValue(f32, bytes[o + 12 ..][0..4]),
            .sy = std.mem.bytesToValue(f32, bytes[o + 16 ..][0..4]),
            .sz = std.mem.bytesToValue(f32, bytes[o + 20 ..][0..4]),
            .yaw = std.mem.bytesToValue(f32, bytes[o + 24 ..][0..4]),
            .mat_hash = std.mem.bytesToValue(u32, bytes[o + 28 ..][0..4]),
        };
    }
    if (p.boxes.len > 0) alloc.free(p.boxes);
    p.node_id = node_id;
    p.set = true;
    p.boxes = boxes;
    p.gen +%= 1;
}

// ── DIRTYRECT erase (req_1891/1892) ─────────────────────────────────────────
// The editor marks a moved/deleted piece's OLD footprint dirty; the loader collapses
// the baked rows + hides the baked mesh-prop nodes inside it (see applyDirtyErase /
// applyLiveMeshProps) so the stale geometry vanishes with no rebake. 24 bytes/rect:
// minX,minY,minZ, maxX,maxY,maxZ (all f32).
pub const ERASE_RECT_STRIDE_BYTES: usize = 24;
pub const PendingDirtyErase = struct {
    node_id: u32 = 0,
    set: bool = false,
    rects: []EraseRect = &.{},
    gen: u64 = 0,
};
var g_pending_dirty_erase: [MAX_EMBEDDED_LOADERS]PendingDirtyErase = [_]PendingDirtyErase{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingDirtyEraseFor(node_id: u32) ?*PendingDirtyErase {
    for (&g_pending_dirty_erase) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the dirty-erase rect set for a node (DIRTYRECT req_1891/1892). Each rect is
/// an old-footprint AABB; an empty `bytes` clears them (everything un-erases next frame).
pub fn setDirtyErase(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingDirtyErase = pendingDirtyEraseFor(node_id);
    if (slot == null) {
        for (&g_pending_dirty_erase) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const n = bytes.len / ERASE_RECT_STRIDE_BYTES;
    const rects = alloc.alloc(EraseRect, n) catch return;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const o = i * ERASE_RECT_STRIDE_BYTES;
        rects[i] = .{
            .min_x = std.mem.bytesToValue(f32, bytes[o..][0..4]),
            .min_y = std.mem.bytesToValue(f32, bytes[o + 4 ..][0..4]),
            .min_z = std.mem.bytesToValue(f32, bytes[o + 8 ..][0..4]),
            .max_x = std.mem.bytesToValue(f32, bytes[o + 12 ..][0..4]),
            .max_y = std.mem.bytesToValue(f32, bytes[o + 16 ..][0..4]),
            .max_z = std.mem.bytesToValue(f32, bytes[o + 20 ..][0..4]),
        };
    }
    if (p.rects.len > 0) alloc.free(p.rects);
    p.node_id = node_id;
    p.set = true;
    p.rects = rects;
    p.gen +%= 1;
}

// ── WALLHIDE editor "disable walls" toggle (req_2053) ───────────────────────
// The editor build pane flips this so you can see/edit a building's interior. The
// Runtime's applyWallHide reads it (once per generation) and collapses/restores
// the WALL_SENTINEL rows. Per node, the same slot pattern as the erase pending.
pub const PendingWallHide = struct {
    node_id: u32 = 0,
    set: bool = false,
    on: bool = false,
    gen: u64 = 0,
};
var g_pending_wall_hide: [MAX_EMBEDDED_LOADERS]PendingWallHide = [_]PendingWallHide{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingWallHideFor(node_id: u32) ?*PendingWallHide {
    for (&g_pending_wall_hide) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Toggle the editor's hide-walls for a node (req_2053). `on` true hides every wall
/// piece (collapses its rows) so the interior is visible/editable; false restores them.
pub fn setHideWalls(node_id: u32, on: bool) void {
    var slot: ?*PendingWallHide = pendingWallHideFor(node_id);
    if (slot == null) {
        for (&g_pending_wall_hide) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    if (p.set and p.node_id == node_id and p.on == on) return; // unchanged — no needless re-collapse
    p.node_id = node_id;
    p.set = true;
    p.on = on;
    p.gen +%= 1;
}

// ── FULLRES resident-mesh catalog (req_1909/1911/1912) ──────────────────────
// The editor pushes the WHOLE cooked-asset catalog as a MESH_PROPS lump (meshes only) so
// every compiled asset is resident in the /editor route — no rebake to place one. We hold the
// raw lump bytes here; the Runtime decodes them once per generation (applyResidentMeshes).
pub const PendingResident = struct {
    node_id: u32 = 0,
    set: bool = false,
    bytes: []u8 = &.{},
    gen: u64 = 0,
};
var g_pending_resident: [MAX_EMBEDDED_LOADERS]PendingResident = [_]PendingResident{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingResidentFor(node_id: u32) ?*PendingResident {
    for (&g_pending_resident) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Replace the resident cooked-asset catalog for a node (FULLRES). `bytes` is a MESH_PROPS
/// lump (meshes only); empty clears residency. A copy is held until the Runtime decodes it.
pub fn setResidentMeshes(node_id: u32, bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingResident = pendingResidentFor(node_id);
    if (slot == null) {
        for (&g_pending_resident) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const copy = alloc.alloc(u8, bytes.len) catch return;
    @memcpy(copy, bytes);
    if (p.bytes.len > 0) alloc.free(p.bytes);
    p.node_id = node_id;
    p.set = true;
    p.bytes = copy;
    p.gen +%= 1;
}

// ── live placement GHOST (LIVEMESH req_1841) ────────────────────────────────
// The armed mesh prop, drawn as the REAL mesh translucent at the snap target — a far
// clearer preview than the faint projected wireframe. ONE ref per node, no allocation.
pub const LIVE_MESH_GHOST_ALPHA: f32 = 0.5;
pub const PendingMeshGhost = struct {
    node_id: u32 = 0,
    set: bool = false,
    has: bool = false, // a ref is currently armed (vs cleared but slot retained)
    ref: LiveMeshRef = .{ .hash = 0, .x = 0, .y = 0, .z = 0, .yaw = 0 },
};
var g_pending_mesh_ghost: [MAX_EMBEDDED_LOADERS]PendingMeshGhost = [_]PendingMeshGhost{.{}} ** MAX_EMBEDDED_LOADERS;

pub fn pendingMeshGhostFor(node_id: u32) ?*PendingMeshGhost {
    for (&g_pending_mesh_ghost) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

/// Set the placement-ghost mesh ref for a node (LIVEMESH req_1841). `bytes` is ONE ref:
/// u32 keyHash, f32 x,y,z,yaw — the same layout as a live mesh-prop ref.
pub fn setLiveMeshGhost(node_id: u32, bytes: []const u8) void {
    if (bytes.len < LIVE_MESH_HEADER_BYTES) {
        clearLiveMeshGhost(node_id);
        return;
    }
    var slot: ?*PendingMeshGhost = pendingMeshGhostFor(node_id);
    if (slot == null) {
        for (&g_pending_mesh_ghost) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    p.node_id = node_id;
    p.set = true;
    p.has = true;
    p.ref = .{
        .hash = std.mem.bytesToValue(u32, bytes[0..4]),
        .x = std.mem.bytesToValue(f32, bytes[4..8]),
        .y = std.mem.bytesToValue(f32, bytes[8..12]),
        .z = std.mem.bytesToValue(f32, bytes[12..16]),
        .yaw = std.mem.bytesToValue(f32, bytes[16..20]),
    };
}

/// Drop the placement ghost for a node (disarmed, or hovering a non-mesh prop).
pub fn clearLiveMeshGhost(node_id: u32) void {
    const p = pendingMeshGhostFor(node_id) orelse return;
    p.has = false;
}

pub fn pendingCamFor(node_id: u32) ?*PendingCam {
    for (&g_pending_cams) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

pub fn setPendingCam(node_id: u32, pos: Vec3, look: Vec3, fov: f32) void {
    var slot: ?*PendingCam = pendingCamFor(node_id);
    if (slot == null) {
        for (&g_pending_cams) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    if (slot) |p| {
        p.node_id = node_id;
        p.set = true;
        p.pos = pos;
        p.look = look;
        p.fov = fov;
    }
}

pub fn applyPendingCam(runtime: anytype) void {
    const p = pendingCamFor(runtime.node_id) orelse return;
    runtime.camera.external = true;
    runtime.camera.ext_pos = p.pos;
    runtime.camera.ext_look = p.look;
    runtime.camera.ext_fov = p.fov;
}

// Copy the node's pending live-overlay rows into the runtime's own buffer and point the
// live render node at them (LIVEHOST req_1798). Only re-copies when the pending gen moved
// (a placement/move/delete or a clear), so a still view costs nothing. The live node was
// reserved in build() at live_kid in the STABLE node prefix, so streaming never clobbers it.
pub fn applyPendingLive(runtime: anytype) void {
    const kid = runtime.live_kid orelse return;
    const p = pendingLiveFor(runtime.node_id) orelse return;
    if (runtime.live_gen == p.gen) return;
    const floats = p.count * INSTANCE_STRIDE;
    if (floats > runtime.live_buf.len) {
        if (runtime.live_buf.len > 0) runtime.allocator.free(runtime.live_buf);
        runtime.live_buf = runtime.allocator.alloc(f32, floats) catch {
            runtime.live_buf = &.{};
            return;
        };
    }
    if (floats > 0) @memcpy(runtime.live_buf[0..floats], p.rows[0..floats]);
    const node = &runtime.kid_list.items[kid];
    node.scene3d_instance_data = runtime.live_buf[0..floats];
    node.scene3d_instance_count = @intCast(p.count);
    node.scene3d_mesh = p.count > 0;
    runtime.live_gen = p.gen;
    // [live-diag req_1812] RJIT_LIVELOG=1: prove the overlay applies + dump the first row,
    // so an invisible placed piece is diagnosed (0 rows? off-screen? zero scale?).
    if (runtime.live_log) {
        if (p.count > 0) {
            log.print("[live] kid={d} count={d} gen={d} row0 pos=({d:.1},{d:.1},{d:.1}) scale=({d:.1},{d:.1},{d:.1}) col=({d:.2},{d:.2},{d:.2})\n", .{
                kid, p.count, p.gen, p.rows[0], p.rows[1], p.rows[2], p.rows[6], p.rows[7], p.rows[8], p.rows[9], p.rows[10], p.rows[11],
            });
        } else {
            log.print("[live] kid={d} count=0 gen={d} (overlay cleared)\n", .{ kid, p.gen });
        }
    }
}

// Fold the live overlay into the PHYSICS colliders (req_2792: "I can walk
// through every wall" — the overlay was draw-only, so the playtest tab had no
// solids). When the overlay generation moves, the step buffer is rebuilt as
// BASE + LIVE:
//   • BASE = the build-time rect/oriented sections, copied from the CURRENT
//     buffer so in-place door/elevator state survives (their rect indices sit
//     inside the base and never move — live rows append strictly after).
//   • LIVE = the same two-pass derivation the pre-lump instance path uses,
//     over the 12-stride live rows: walkable floors first so ground always
//     survives the rect cap, walls solid by height, yawed rows oriented.
// Heightfields are deliberately NOT touched — a full buildPhysicsColliders
// rerun would clearHeightfields() and silently drop the PAINTED terrain
// (applyPaintLayer only re-registers a chunk when its height goes dirty).
pub fn applyLiveColliders(runtime: anytype, comptime live_scene: type) void {
    const p = pendingLiveFor(runtime.node_id);
    const pm = pendingLiveMeshFor(runtime.node_id);
    if (p == null and pm == null) return;
    const piece_gen: u64 = if (p) |x| x.gen else 0;
    const mesh_gen: u64 = if (pm) |x| x.gen else 0;
    const resident_gen: u64 = if (pendingResidentFor(runtime.node_id)) |x| x.gen else 0;
    if (runtime.live_collider_gen == piece_gen and
        runtime.live_mesh_collider_gen == mesh_gen and
        runtime.live_resident_collider_gen == resident_gen) return;
    if (!runtime.has_physics_colliders) return;
    if (runtime.windowed) {
        // The huge-map window rebuild owns this buffer per frame; folding live
        // rows here would fight it. Say so once instead of silently no-oping.
        if (!runtime.live_collider_warned) {
            runtime.live_collider_warned = true;
            log.print("[live] windowed map — live-piece colliders skipped (window rebuild owns the physics set)\n", .{});
        }
        runtime.live_collider_gen = piece_gen;
        runtime.live_mesh_collider_gen = mesh_gen;
        runtime.live_resident_collider_gen = resident_gen;
        return;
    }
    // A live MESH ref resolves through the resident catalog + baked hash map, which
    // stepNow builds AFTER this runs in the frame — force the gen-guarded decode NOW
    // or the rebuild on the push's own frame misses every mesh placement.
    live_scene.applyResidentMeshes(runtime);
    live_scene.ensureMeshHashMap(runtime);
    const alloc = runtime.allocator;

    var live_rects: std.ArrayList(f32) = .empty;
    defer live_rects.deinit(alloc);
    var live_oriented: std.ArrayList(f32) = .empty;
    defer live_oriented.deinit(alloc);
    var next_live_doors: std.ArrayList(CookedDoor) = .empty;
    defer next_live_doors.deinit(alloc);
    var next_live_door_states: std.ArrayList(live_mesh_doors.State) = .empty;
    defer next_live_door_states.deinit(alloc);
    var live_rect_count: usize = 0;
    var live_oriented_count: usize = 0;
    var clipped: usize = 0;

    if (p) |pp| {
        const rows = pp.rows[0 .. pp.count * INSTANCE_STRIDE];
        var pass: usize = 0;
        while (pass < 2) : (pass += 1) {
            const want_solid = pass == 1;
            var row: usize = 0;
            while (row < pp.count) : (row += 1) {
                const b = row * INSTANCE_STRIDE;
                const sx = @abs(rows[b + 6]);
                const sy = @abs(rows[b + 7]);
                const sz = @abs(rows[b + 8]);
                if (sx <= 0.001 or sy <= 0.001 or sz <= 0.001) continue;
                const solid = instance_collider_policy.blocksPlayerByHeight(sy, PHYSICS_SOLID_HEIGHT_METERS);
                if (solid != want_solid) continue;
                const yaw = instanceYawRadians(rows, row, INSTANCE_STRIDE);
                if (@abs(yaw) > 0.0001) {
                    if (runtime.base_oriented_count + live_oriented_count >= game_physics.MAX_ORIENTED) {
                        clipped += 1;
                        continue;
                    }
                    live_oriented.appendSlice(alloc, &orientedFloats(rows, row, INSTANCE_STRIDE, solid)) catch {
                        clipped += 1;
                        continue;
                    };
                    live_oriented_count += 1;
                } else {
                    if (runtime.base_rect_count + live_rect_count >= game_physics.MAX_RECTS) {
                        clipped += 1;
                        continue;
                    }
                    live_rects.appendSlice(alloc, &rectFloats(rows, row, INSTANCE_STRIDE, solid)) catch {
                        clipped += 1;
                        continue;
                    };
                    live_rect_count += 1;
                }
            }
        }
    }

    // req_2832 ("i walk right through it"): live MESH placements collide too — box
    // pieces folded in above, but a placed authored prop was draw-only. Same
    // per-island oriented boxes the baked mesh-prop path emits (walk under a
    // sign's overhead board), anchored at the live ref's transform. The GHOST
    // (pendingMeshGhostFor) stays collision-free — it's a placement preview.
    if (pm) |pmx| {
        for (pmx.refs) |r| {
            const mesh = live_scene.meshForHash(runtime, r.hash) orelse continue;
            const inst: constructor.MeshPropInstance = .{ .mesh = 0, .x = r.x, .y = r.y, .z = r.z, .yaw_degrees = r.yaw };
            const isls = meshPropIslands(alloc, mesh) catch continue;
            defer alloc.free(isls);
            for (isls) |isl| {
                if (runtime.base_oriented_count + live_oriented_count >= game_physics.MAX_ORIENTED) {
                    clipped += 1;
                    continue;
                }
                live_oriented.appendSlice(alloc, &islandOrientedFloats(inst, isl)) catch {
                    clipped += 1;
                    continue;
                };
                live_oriented_count += 1;
            }
            // Resident Door Wall metadata uses the SAME cookedDoorWorldBox +
            // swing machine as baked MESH_PROPS instances. Its static islands
            // already exclude the leaf (solidVertexCount); add that leaf as one
            // live rect and carry its transient state across generation rebuilds.
            if (cookedDoorWorldBox(mesh, inst)) |initial_box| {
                if (runtime.base_rect_count + live_rect_count >= game_physics.MAX_RECTS) {
                    clipped += 1;
                    continue;
                }
                const identity = live_mesh_doors.identity(r.hash, r.x, r.y, r.z, r.yaw);
                const carried = live_mesh_doors.reconcile(identity, initial_box.open, runtime.live_cooked_door_states);
                var box = initial_box;
                box.open = carried.open;
                box.progress = carried.progress;
                box.rect_index = runtime.base_rect_count + live_rect_count;
                live_rects.appendSlice(alloc, &cookedDoorRectFloats(box)) catch {
                    clipped += 1;
                    continue;
                };
                next_live_doors.append(alloc, box) catch {
                    live_rects.shrinkRetainingCapacity(live_rects.items.len - game_physics.RECT_FLOATS);
                    clipped += 1;
                    continue;
                };
                next_live_door_states.append(alloc, carried) catch {
                    _ = next_live_doors.pop();
                    live_rects.shrinkRetainingCapacity(live_rects.items.len - game_physics.RECT_FLOATS);
                    clipped += 1;
                    continue;
                };
                live_rect_count += 1;
            }
        }
    }

    // Reassemble: header + entity slots zeroed (the step rewrites both every
    // call), base rects + live rects, base oriented + live oriented.
    const old = runtime.physics_colliders;
    const rect_base = old.rectBase();
    const base_rect_floats = runtime.base_rect_count * game_physics.RECT_FLOATS;
    const base_oriented_floats = runtime.base_oriented_count * game_physics.ORIENTED_FLOATS;
    const old_oriented_start = rect_base + old.rect_count * game_physics.RECT_FLOATS;
    const values = alloc.alloc(f32, rect_base + base_rect_floats + live_rects.items.len + base_oriented_floats + live_oriented.items.len) catch {
        log.print("[live] collider rebuild allocation failed — live pieces stay walk-through\n", .{});
        runtime.live_collider_gen = piece_gen;
        runtime.live_mesh_collider_gen = mesh_gen;
        runtime.live_resident_collider_gen = resident_gen;
        return;
    };
    @memset(values[0..rect_base], 0);
    var at: usize = rect_base;
    @memcpy(values[at .. at + base_rect_floats], old.values[rect_base .. rect_base + base_rect_floats]);
    at += base_rect_floats;
    @memcpy(values[at .. at + live_rects.items.len], live_rects.items);
    at += live_rects.items.len;
    @memcpy(values[at .. at + base_oriented_floats], old.values[old_oriented_start .. old_oriented_start + base_oriented_floats]);
    at += base_oriented_floats;
    @memcpy(values[at .. at + live_oriented.items.len], live_oriented.items);

    const owned_live_doors = next_live_doors.toOwnedSlice(alloc) catch {
        alloc.free(values);
        log.print("[live] door state allocation failed — keeping previous live collider generation\n", .{});
        return;
    };
    const owned_live_states = next_live_door_states.toOwnedSlice(alloc) catch {
        if (owned_live_doors.len > 0) alloc.free(owned_live_doors);
        alloc.free(values);
        log.print("[live] door reconciliation allocation failed — keeping previous live collider generation\n", .{});
        return;
    };

    alloc.free(old.values);
    runtime.physics_colliders.values = values;
    runtime.physics_colliders.rect_count = runtime.base_rect_count + live_rect_count;
    runtime.physics_colliders.oriented_count = runtime.base_oriented_count + live_oriented_count;
    if (runtime.live_cooked_doors.len > 0) alloc.free(runtime.live_cooked_doors);
    if (runtime.live_cooked_door_states.len > 0) alloc.free(runtime.live_cooked_door_states);
    runtime.live_cooked_doors = owned_live_doors;
    runtime.live_cooked_door_states = owned_live_states;
    runtime.live_cooked_door_by_identity.clearRetainingCapacity();
    for (owned_live_states, 0..) |state, index| {
        runtime.live_cooked_door_by_identity.put(alloc, state.identity, index) catch {};
    }
    runtime.live_collider_gen = piece_gen;
    runtime.live_mesh_collider_gen = mesh_gen;
    runtime.live_resident_collider_gen = resident_gen;
    if (clipped > 0) {
        log.print("[live] collider cap CLIPPED {d} live rows — distant pieces are walk-through\n", .{clipped});
    }
    // Successful rebuilds are routine projection traffic, not warnings. Keep
    // the detail behind the same opt-in diagnostic used by the live overlay;
    // allocation failures and clipping remain unconditionally loud above.
    if (runtime.live_log) {
        log.print("[live] colliders folded: {d} base + {d} live rects, {d} base + {d} live oriented, {d} live door(s)\n", .{ runtime.base_rect_count, live_rect_count, runtime.base_oriented_count, live_oriented_count, runtime.live_cooked_doors.len });
    }
}
