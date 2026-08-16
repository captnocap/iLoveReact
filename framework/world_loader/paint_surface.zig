//! Map-paint arming, pointer projection, and painted-water surface derivation.
//!
//! Mounted-node lookup stays in the facade; this module accepts an explicit runtime.

const std = @import("std");
const map_paint = @import("../game/map/engine.zig");
const map_chunks = @import("../game/map/chunks.zig");
const config = @import("config.zig");
const foliage_preview = @import("foliage_preview.zig");
const MAX_EMBEDDED_LOADERS = config.MAX_EMBEDDED_LOADERS;
const paintGroundY = foliage_preview.paintGroundY;
const paintSlotFloorFor = foliage_preview.paintSlotFloorFor;

pub const PendingPaint = struct {
    node_id: u32 = 0,
    enabled: bool = false,
};
var g_pending_paint: [MAX_EMBEDDED_LOADERS]PendingPaint = [_]PendingPaint{.{}} ** MAX_EMBEDDED_LOADERS;
var g_any_paint_armed: bool = false;

/// Arm/disarm in-viewport map painting for a loader node (the editor's door).
pub fn setPaintMode(node_id: u32, enabled: bool) void {
    if (node_id == 0) return;
    var slot: ?*PendingPaint = null;
    for (&g_pending_paint) |*p| {
        if (p.node_id == node_id) {
            slot = p;
            break;
        }
        if (slot == null and p.node_id == 0) slot = p;
    }
    if (slot) |p| {
        p.node_id = node_id;
        p.enabled = enabled;
    }
    g_any_paint_armed = false;
    for (&g_pending_paint) |*p| {
        if (p.node_id != 0 and p.enabled) g_any_paint_armed = true;
    }
}

pub fn paintArmed(node_id: u32) bool {
    for (&g_pending_paint) |*p| {
        if (p.node_id == node_id) return p.enabled;
    }
    return false;
}

/// Cheap pre-check for engine.zig's per-motion routing: any armed viewport at all?
pub fn anyPaintArmed() bool {
    return g_any_paint_armed;
}

pub const PaintPhase = enum { down, move, up };

/// Route a pointer event into the map painter (engine.zig calls this while a
/// paint drag owns the pointer). Screen coords are window-absolute; the pane
/// rect renderEmbedded stored maps them into the viewport.
pub fn paintPointer(runtime: anytype, io: std.Io, phase: PaintPhase, mx: f32, my: f32) void {
    if (phase == .up) {
        if (runtime.paint_stroking) {
            runtime.paint_stroking = false;
            _ = map_paint.strokeEnd(io);
        }
        return;
    }
    const hit = paintGroundHitAt(runtime, mx, my, 0) orelse return;
    runtime.paint_hover = hit;
    switch (phase) {
        .down => {
            runtime.paint_stroking = true;
            map_paint.strokeBegin(io, hit[0], hit[2]);
        },
        .move => {
            if (runtime.paint_stroking) map_paint.strokeMove(hit[0], hit[2]);
        },
        .up => unreachable,
    }
}

/// Window-space cursor → painted-terrain surface point, for the PLACEMENT path
/// (__compiled_world_ground_hit, req_2666). The EXACT brush-beam code path
/// (paintGroundHitAt below), so where a piece lands and where the brush strokes
/// can never disagree about the ground. Null when the loader isn't mounted, the
/// camera isn't the editor's external iso pose, the pane rect isn't live yet,
/// or the ray misses every painted chunk (off-map — the cart falls back to its
/// analytic flat plane).
///
/// `level_y` is the active storey's elevation in metres (req_2744): the ray is
/// intersected with the terrain surface LIFTED by level_y (floor N's slab rides
/// the terrain), so the returned x/z sit exactly under the cursor once the cart
/// bases the piece at terrainY + level_y. The returned y stays the TRUE terrain
/// height at that x/z — the cart owns the storey addition. 0 = ground behavior,
/// bit-identical to before.
pub fn groundHitAt(runtime: anytype, mx: f32, my: f32, level_y: f32) ?[3]f32 {
    return paintGroundHitAt(runtime, mx, my, level_y);
}

/// Screen (window-absolute) → world ray through the external iso camera →
/// painted-terrain hit. The ray basis mirrors gpu/3d.zig drawScene's
/// m4perspective(fov_y, aspect) + lookAt(up = +Y) exactly, so the brush lands
/// under the cursor by construction.
///
/// `level_y` lifts the intersected surface by that many metres (req_2744) by
/// LOWERING the ray origin instead — intersecting y = terrain(x,z) + L with a
/// ray from O is identical to intersecting y = terrain(x,z) from O − (0,L,0),
/// so the heightfield march itself never learns what a storey is. The brush
/// paths always pass 0 (painting is a ground affair).
///
/// The ray marches the RENDERED surface — the 121-grid abs-max floor mirror the
/// mesh and collider use — NOT heightAt's fine 241-grid brush field, which sits
/// up to half a metre BELOW the rendered slope on sculpted ground. Placing on
/// that lower surface buried the 5 cm floor plate inside the visible hill while
/// a 3 m wall still poked through (req_2789 — the drowned-grass class, req_2704).
fn RenderFloorSurface(comptime RuntimePtr: type) type {
    return struct {
        runtime: RuntimePtr,
        pub fn sample(self: @This(), x: f32, z: f32) f32 {
            const cx = map_chunks.chunkOfGlobalTile(map_chunks.globalTile(x));
            const cz = map_chunks.chunkOfGlobalTile(map_chunks.globalTile(z));
            const chunk = map_chunks.chunkAt(cx, cz) orelse return 0;
            return paintGroundY(paintSlotFloorFor(self.runtime, cx, cz), chunk, x, z);
        }
    };
}

/// Screen (window-absolute) → world ray through the external iso camera:
/// [origin xyz, direction xyz]. The one copy of the basis math — the ground
/// march below and the wall-tool overlay's handle/plane tests both use it.
pub fn screenRayAt(runtime: anytype, mx: f32, my: f32) ?[6]f32 {
    if (runtime.paint_last_w <= 1 or runtime.paint_last_h <= 1) return null;
    const cam = &runtime.camera;
    if (!cam.external) return null; // an editor-viewport affair
    const nx = ((mx - runtime.paint_last_x) / runtime.paint_last_w) * 2 - 1;
    const ny = 1 - ((my - runtime.paint_last_y) / runtime.paint_last_h) * 2;
    if (nx < -1.05 or nx > 1.05 or ny < -1.05 or ny > 1.05) return null;

    var fx = cam.ext_look.x - cam.ext_pos.x;
    var fy = cam.ext_look.y - cam.ext_pos.y;
    var fz = cam.ext_look.z - cam.ext_pos.z;
    const flen = @sqrt(fx * fx + fy * fy + fz * fz);
    if (flen < 0.0001) return null;
    fx /= flen;
    fy /= flen;
    fz /= flen;
    // right = normalize(forward × up), up basis = right × forward
    var rx = -fz;
    var rz = fx;
    const rlen = @sqrt(rx * rx + rz * rz);
    if (rlen < 0.0001) return null; // straight-down camera: degenerate basis
    rx /= rlen;
    rz /= rlen;
    // up basis = right(rx,0,rz) × forward(fx,fy,fz)
    const up_x = -rz * fy;
    const up_y = rz * fx - rx * fz;
    const up_z = rx * fy;
    const tan_half = @tan(cam.ext_fov * std.math.pi / 360.0);
    const aspect = runtime.paint_last_w / runtime.paint_last_h;
    var dx = fx + rx * (nx * tan_half * aspect) + up_x * (ny * tan_half);
    var dy = fy + up_y * (ny * tan_half);
    var dz = fz + rz * (nx * tan_half * aspect) + up_z * (ny * tan_half);
    const dlen = @sqrt(dx * dx + dy * dy + dz * dz);
    if (dlen < 0.0001) return null;
    dx /= dlen;
    dy /= dlen;
    dz /= dlen;
    return .{ cam.ext_pos.x, cam.ext_pos.y, cam.ext_pos.z, dx, dy, dz };
}

pub fn paintGroundHitAt(runtime: anytype, mx: f32, my: f32, level_y: f32) ?[3]f32 {
    const ray = screenRayAt(runtime, mx, my) orelse return null;
    return map_paint.surfaceHit(RenderFloorSurface(@TypeOf(runtime)){ .runtime = runtime }, ray[0], ray[1] - level_y, ray[2], ray[3], ray[4], ray[5], 2000);
}

// Painted-water surface derivation (chunkFloor.ts floorToWaterBody, req_1840
// shore rule): a shallow cell (depth < SHORE_KEEP) only stays wet when a
// GENUINELY deep cell (≥ SHORE_DEEP) sits within SHORE_R grid steps — the deep
// body keeps its shoreline margin, isolated barely-negative film drops, and the
// height-0 contour reads as clean beach. Wet surface = bed + depth; dry cells
// tuck just UNDER the local terrain (bed − tuck) so the sheet edge dives into
// the bank it meets — one global basin base left a visible gap against raised
// shores and a floating slab over downhill ground (req_2704).
pub const PAINT_SHORE_DEEP_M: f32 = 0.5;
pub const PAINT_SHORE_KEEP_M: f32 = 0.5;
pub const PAINT_SHORE_R: i32 = 2;
pub const PAINT_WATER_TUCK_M: f32 = 0.3; // WATER_LOOK.floorTuckMeters

/// Shore-cull raw depths + build the water surface over the 121×121 floor grid.
/// Returns whether any cell is wet (dry chunk ⇒ hide the water node).
/// `depths` MAY alias `raw_depths` (the caller culls in place) — safe ONLY while
/// SHORE_KEEP == SHORE_DEEP: the neighbour scan looks for cells ≥ DEEP, and a
/// cell that gets zeroed is < KEEP, so an already-culled cell could never have
/// satisfied the scan anyway. Lower SHORE_DEEP below SHORE_KEEP and this needs
/// a scratch copy.
pub fn paintWaterSurface(raw_depths: []const f32, beds: []const f32, depths: []f32, surface: []f32) bool {
    const res: i32 = @intCast(map_paint.FLOOR_RES);
    var wet = false;
    for (raw_depths, 0..) |d, i| {
        var keep = d > 0 and d >= PAINT_SHORE_KEEP_M;
        if (!keep and d > 0) {
            const x: i32 = @intCast(i % map_paint.FLOOR_RES);
            const y: i32 = @intCast(i / map_paint.FLOOR_RES);
            search: {
                var dy: i32 = -PAINT_SHORE_R;
                while (dy <= PAINT_SHORE_R) : (dy += 1) {
                    const yy = y + dy;
                    if (yy < 0 or yy >= res) continue;
                    var dx: i32 = -PAINT_SHORE_R;
                    while (dx <= PAINT_SHORE_R) : (dx += 1) {
                        const xx = x + dx;
                        if (xx < 0 or xx >= res) continue;
                        if (raw_depths[@as(usize, @intCast(yy)) * map_paint.FLOOR_RES + @as(usize, @intCast(xx))] >= PAINT_SHORE_DEEP_M) {
                            keep = true;
                            break :search;
                        }
                    }
                }
            }
        }
        depths[i] = if (keep) d else 0;
        if (keep) wet = true;
    }
    if (!wet) return false;
    for (depths, 0..) |d, i| {
        surface[i] = if (d > 0) beds[i] + d else beds[i] - PAINT_WATER_TUCK_M;
    }
    return true;
}
