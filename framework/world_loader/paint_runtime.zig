//! Live painted-terrain, water, foliage, transport, and brush-gizmo publication.
//!
//! One frame-boundary function reconciles map revisions into retained scene nodes.

const std = @import("std");
const c = @import("../c.zig").imports;
const layout = @import("../layout.zig");
const game_physics = @import("../game/physics.zig");
const map_paint = @import("../game/map/engine.zig");
const map_chunks = @import("../game/map/chunks.zig");
const map_transport = @import("../game/map/transport.zig");
const streaming = @import("../world/streaming.zig");
const terrain_grid = @import("../gpu/terrain_grid.zig");
const config = @import("config.zig");
const paint_surface = @import("paint_surface.zig");
const paint_revision = @import("paint_revision.zig");
const transport_render = @import("transport_render.zig");
const foliage_preview = @import("foliage_preview.zig");
const Node = layout.Node;
const log = std.debug;
const MAX_PAINT_SLOTS = config.MAX_PAINT_SLOTS;
const PAINT_COLLIDER_BASE = config.PAINT_COLLIDER_BASE;
const PAINT_BEAM_HEIGHT_METERS = config.PAINT_BEAM_HEIGHT_METERS;
const PAINT_BEAM_ALPHA = config.PAINT_BEAM_ALPHA;
const PAINT_GIZMO_SURFACE_LIFT_M = config.PAINT_GIZMO_SURFACE_LIFT_M;
const PAINT_GIZMO_PROFILE_MAX_M = config.PAINT_GIZMO_PROFILE_MAX_M;
const TRANSPORT_RENDER = config.TRANSPORT_RENDER;
const paintArmed = paint_surface.paintArmed;
const paintGroundHitAt = paint_surface.paintGroundHitAt;
const paintWaterSurface = paint_surface.paintWaterSurface;
const rebuildCommittedTransport = transport_render.rebuildCommittedTransport;
const rebuildTransportPreview = transport_render.rebuildTransportPreview;
const paintPreviewAnchor = foliage_preview.paintPreviewAnchor;
const requestFoliageRegen = foliage_preview.requestFoliageRegen;
const pollFoliageRegen = foliage_preview.pollFoliageRegen;

/// Reset one loader's retained projection after the global map engine replaces
/// its whole document. Slot buffers stay allocated for reuse, but no outgoing
/// node, collider, water surface, or foliage batch remains publishable.
fn reconcileMapRevision(runtime: anytype) bool {
    const revision = map_paint.mapRevision();
    if (!paint_revision.reconcile(&runtime.paint_map_revision, revision, runtime.paint_slot_used[0..])) return false;

    const ground_first = runtime.paint_kids_first orelse return true;
    const water_first = runtime.paint_water_kids_first;
    for (0..MAX_PAINT_SLOTS) |i| {
        runtime.paint_slot_chunk[i] = .{ 0, 0 };
        runtime.kid_list.items[ground_first + i].scene3d_mesh = false;
        if (water_first) |first| runtime.kid_list.items[first + i].scene3d_mesh = false;
        game_physics.unregisterHeightfield(PAINT_COLLIDER_BASE + i);
    }
    @memset(runtime.paint_detail_resident[0..], false);
    @memset(runtime.paint_foliage_resident[0..], false);
    if (runtime.paint_foliage_kids_first) |first| {
        for (0..config.PAINT_FOLIAGE_FAMILY_COUNT) |i| {
            const node = &runtime.kid_list.items[first + i];
            node.scene3d_mesh = false;
            node.scene3d_instance_count = 0;
            node.scene3d_instance_segments = null;
        }
    }
    runtime.paint_drop_warned = false;
    runtime.paint_hover = null;
    runtime.paint_stroking = false;
    runtime.foliage_want = true;
    runtime.foliage_want_log = false;
    return true;
}

/// Release one physical terrain slot while retaining its owned buffers for the
/// next resident chunk. Geometry keys are physical-slot keyed, so replacement
/// overwrites the same GPU cache entry instead of leaking one per coordinate.
fn retirePaintSlot(runtime: anytype, ground_first: usize, slot: usize) void {
    runtime.kid_list.items[ground_first + slot].scene3d_mesh = false;
    if (runtime.paint_water_kids_first) |water_first| {
        runtime.kid_list.items[water_first + slot].scene3d_mesh = false;
    }
    game_physics.unregisterHeightfield(PAINT_COLLIDER_BASE + slot);
    runtime.paint_slot_used[slot] = false;
    runtime.paint_slot_chunk[slot] = .{ 0, 0 };
}

fn documentSlotIndex(coord: [2]i32) usize {
    return @as(usize, @intCast(coord[1])) * map_chunks.SLOT_COLS + @as(usize, @intCast(coord[0]));
}

pub fn paintGizmoColor(tool: map_paint.Tool) [3]f32 {
    if (tool.mode == .erase) return .{ 0.95, 0.25, 0.2 };
    return switch (tool.channel) {
        .terrain => if (tool.terrain_tool == .brush and tool.center_z < 0) .{ 0.95, 0.32, 0.24 } else .{ 0.45, 0.9, 0.28 },
        .water => .{ 0.25, 0.55, 0.95 },
        .flora => .{ 0.35, 0.88, 0.45 },
        .zone => .{ 0.85, 0.42, 1.0 },
        .road => .{ 1.0, 0.86, 0.25 },
        .tile => .{ 1.0, 0.72, 0.25 },
    };
}

pub fn paintGizmoProfileHeight(tool: map_paint.Tool, radius: f32) f32 {
    const raw = if (tool.channel == .terrain and tool.terrain_tool == .brush) @abs(tool.center_z) else radius * 0.75;
    return @max(0.75, @min(PAINT_GIZMO_PROFILE_MAX_M, raw));
}

pub fn setPaintGizmoMesh(node: *Node, key: []const u8, verts: []const f32, alpha: f32) void {
    node.scene3d_mesh = true;
    node.scene3d_geom_key = key;
    node.scene3d_vertices = verts;
    node.scene3d_vert_count = @intCast(verts.len / 8);
    node.scene3d_tex_key = null;
    node.scene3d_heights = null;
    node.scene3d_ground_formula = null;
    node.scene3d_ground_data = null;
    node.scene3d_instance_data = null;
    node.scene3d_instance_count = 0;
    node.scene3d_color_a = alpha;
}

pub fn setPaintGizmoTransform(node: *Node, hover: [3]f32, sx: f32, sy: f32, sz: f32, y_offset: f32, rot_y: f32) void {
    node.scene3d_pos_x = hover[0];
    node.scene3d_pos_y = hover[1] + y_offset;
    node.scene3d_pos_z = hover[2];
    node.scene3d_scale_x = sx;
    node.scene3d_scale_y = sy;
    node.scene3d_scale_z = sz;
    node.scene3d_rot_x = 0;
    node.scene3d_rot_y = rot_y;
    node.scene3d_rot_z = 0;
}

pub fn dressPaintGizmo(runtime: anytype, node: *Node, hover: [3]f32, tool: map_paint.Tool) void {
    const radius = @max(0.5, tool.radius_m);
    const diameter = radius * 2;
    const color = paintGizmoColor(tool);
    node.scene3d_color_r = color[0];
    node.scene3d_color_g = color[1];
    node.scene3d_color_b = color[2];

    // The path pen targets a precise semantic anchor, not a brush footprint.
    // Once an anchor exists the full-width live path node becomes the gizmo.
    if (tool.channel == .road) {
        setPaintGizmoMesh(node, "paint-gizmo-rings", runtime.brush_rings[0..], 0.92);
        setPaintGizmoTransform(
            node,
            hover,
            TRANSPORT_RENDER.anchor_marker_m,
            1,
            TRANSPORT_RENDER.anchor_marker_m,
            PAINT_GIZMO_SURFACE_LIFT_M,
            0,
        );
        return;
    }

    const diamond_rot: f32 = if (tool.shape == .diamond) std.math.pi / 4.0 else 0.0;
    switch (map_paint.brushGizmo()) {
        .beam => {
            setPaintGizmoMesh(node, "box", runtime.cube[0..], PAINT_BEAM_ALPHA);
            setPaintGizmoTransform(node, hover, diameter, PAINT_BEAM_HEIGHT_METERS, diameter, PAINT_BEAM_HEIGHT_METERS / 2, diamond_rot);
        },
        .decal => {
            if (tool.shape == .circle) {
                setPaintGizmoMesh(node, "paint-gizmo-decal", runtime.brush_decal[0..], 0.42);
                setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, 0);
            } else {
                setPaintGizmoMesh(node, "box", runtime.cube[0..], 0.34);
                setPaintGizmoTransform(node, hover, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diameter, PAINT_GIZMO_SURFACE_LIFT_M * 0.5, diamond_rot);
            }
        },
        .rings => {
            setPaintGizmoMesh(node, "paint-gizmo-rings", runtime.brush_rings[0..], 0.88);
            setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
        },
        .profile => {
            const h = paintGizmoProfileHeight(tool, radius);
            if (tool.profile == .flat) {
                setPaintGizmoMesh(node, "paint-gizmo-decal", runtime.brush_decal[0..], 0.46);
                setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
            } else if (tool.profile == .dome) {
                setPaintGizmoMesh(node, "paint-gizmo-dome", runtime.brush_dome[0..], 0.3);
                setPaintGizmoTransform(node, hover, diameter, h * 2, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
            } else {
                setPaintGizmoMesh(node, "paint-gizmo-cone", runtime.brush_cone[0..], 0.34);
                setPaintGizmoTransform(node, hover, diameter, h * 2, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
            }
        },
        .handles => {
            setPaintGizmoMesh(node, "paint-gizmo-handles", runtime.brush_handles[0..], 0.9);
            setPaintGizmoTransform(node, hover, diameter, 1, diameter, PAINT_GIZMO_SURFACE_LIFT_M, diamond_rot);
        },
    }
}

/// Per-frame paint pass (renderEmbedded): mirror every painted chunk into its
/// reserved node + collider (dirty-coalesced), poll the hover gizmo, and dress
/// the gizmo node. Runs unconditionally — with no painted chunks and paint
/// disarmed it is a cheap slot scan.
pub fn applyPaintLayer(runtime: anytype, io: std.Io) void {
    const first = runtime.paint_kids_first orelse return;
    const map_replaced = reconcileMapRevision(runtime);

    // hover poll: the beam follows the mouse whenever the tool is armed, not
    // just during a drag — no per-motion tree walk needed for hover.
    const armed = paintArmed(runtime.node_id);
    if (armed and !runtime.paint_stroking) {
        var mx: f32 = 0;
        var my: f32 = 0;
        _ = c.SDL_GetMouseState(&mx, &my);
        if (mx >= runtime.paint_last_x and mx <= runtime.paint_last_x + runtime.paint_last_w and
            my >= runtime.paint_last_y and my <= runtime.paint_last_y + runtime.paint_last_h)
        {
            runtime.paint_hover = paintGroundHitAt(runtime, mx, my, 0);
        } else {
            runtime.paint_hover = null;
        }
    } else if (armed and runtime.paint_stroking) {
        // Mid-stroke, the WORLD can move under a held cursor (WASD pans the
        // iso camera) without a single motion event — re-stamp from the
        // per-frame pose so the brush keeps painting along the pan
        // (req_2704). strokeMove dedups per stamp cell, so a stationary
        // cursor over a stationary camera deposits nothing new.
        var mx: f32 = 0;
        var my: f32 = 0;
        _ = c.SDL_GetMouseState(&mx, &my);
        if (paintGroundHitAt(runtime, mx, my, 0)) |hit| {
            runtime.paint_hover = hit;
            map_paint.strokeMove(hit[0], hit[2]);
        }
    } else if (!armed) {
        runtime.paint_hover = null;
    }

    const live_tool = map_paint.tool();
    const path_active = armed and live_tool.channel == .road;
    if (path_active and runtime.paint_hover != null) {
        const hover = runtime.paint_hover.?;
        map_paint.setPathHover(hover[0], hover[2]);
    } else {
        map_paint.clearPathHover();
    }
    // Select the live working set through world/streaming's active bubble.
    // Physical terrain slots are only a capacity backstop; document order never
    // decides what exists. Capture whole-document dirtiness first so transport
    // and the streamed foliage projection observe edits before flags are drained.
    var path_terrain_dirty = map_replaced;
    var foliage_stale = map_replaced;
    const residency_anchor = paintPreviewAnchor(runtime);
    const foliage_radius = streaming.foliageDetailRadius(runtime.stream_radius);
    var resident_meta: [MAX_PAINT_SLOTS]streaming.NearestCandidate = undefined;
    var resident_chunks: [MAX_PAINT_SLOTS]*map_chunks.Chunk = undefined;
    var resident_mask: [map_chunks.SLOT_COUNT]bool = @splat(false);
    var resident_count: usize = 0;
    var detail_active_count: usize = 0;
    var foliage_residency_changed = false;
    for (map_chunks.slots(), 0..) |maybe, document_slot| {
        const chunk = maybe orelse continue;
        path_terrain_dirty = path_terrain_dirty or chunk.dirty.height;
        foliage_stale = foliage_stale or chunk.dirty.flora or chunk.dirty.height;

        const footprint = streaming.CellFootprint{
            .min_x = chunk.minX(),
            .min_z = chunk.minZ(),
            .size = map_chunks.CHUNK_METERS,
        };
        const detail_resident = streaming.updateCellResidency(
            runtime.paint_detail_resident[document_slot],
            footprint,
            residency_anchor[0],
            residency_anchor[1],
            runtime.stream_radius,
        );
        runtime.paint_detail_resident[document_slot] = detail_resident;

        const foliage_resident = streaming.updateCellResidency(
            runtime.paint_foliage_resident[document_slot],
            footprint,
            residency_anchor[0],
            residency_anchor[1],
            foliage_radius,
        );
        foliage_residency_changed = foliage_residency_changed or
            foliage_resident != runtime.paint_foliage_resident[document_slot];
        runtime.paint_foliage_resident[document_slot] = foliage_resident;

        if (!detail_resident) continue;
        detail_active_count += 1;
        const center_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS;
        const center_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS;
        const proposed = streaming.nearestCandidate(.{ chunk.cx, chunk.cz }, .{ center_x, center_z }, residency_anchor);
        if (streaming.offerNearest(resident_meta[0..], &resident_count, proposed)) |at| {
            resident_chunks[at] = chunk;
        }
    }
    for (resident_meta[0..resident_count]) |entry| resident_mask[documentSlotIndex(entry.coord)] = true;
    if (detail_active_count > MAX_PAINT_SLOTS) {
        if (!runtime.paint_drop_warned) {
            runtime.paint_drop_warned = true;
            log.print("[paint] streaming bubble has {d} active chunks but only {d} terrain slots; nearest active chunks remain projected\n", .{ detail_active_count, MAX_PAINT_SLOTS });
        }
    } else {
        runtime.paint_drop_warned = false;
    }

    // Evict coordinates that left the attention set before assigning new ones.
    for (0..MAX_PAINT_SLOTS) |i| {
        if (runtime.paint_slot_used[i] and !resident_mask[documentSlotIndex(runtime.paint_slot_chunk[i])]) {
            retirePaintSlot(runtime, first, i);
        }
    }

    // Painted-chunk mirror: assign physical slots, refresh dirty height/data,
    // and register the matching near-set colliders.
    for (resident_chunks[0..resident_count]) |chunk| {
        var slot: ?usize = null;
        var free_slot: ?usize = null;
        for (0..MAX_PAINT_SLOTS) |i| {
            if (runtime.paint_slot_used[i]) {
                if (runtime.paint_slot_chunk[i][0] == chunk.cx and runtime.paint_slot_chunk[i][1] == chunk.cz) {
                    slot = i;
                    break;
                }
            } else if (free_slot == null) {
                free_slot = i;
            }
        }
        const fresh = slot == null;
        if (fresh) {
            slot = free_slot orelse continue; // selection and slot caps are identical
        }
        const i = slot.?;
        const height_dirty = fresh or chunk.dirty.height;
        // flora + zones ride the same packed D stream as the tiles (layout v2),
        // so any cell-channel edit re-encodes it. A formula IDENTITY change also
        // re-encodes: setGroundLook keeps superseded formula bytes alive exactly
        // so this pointer-swap pass can migrate live nodes without a frame ever
        // reading freed memory (SIGSEGV req_2492).
        const live_formula = map_paint.groundFormula();
        const render_formula = live_formula orelse terrain_grid.FALLBACK_FORMULA;
        const formula_stale = node_has_formula: {
            const nf = runtime.kid_list.items[first + i].scene3d_ground_formula orelse break :node_has_formula true;
            break :node_has_formula nf.ptr != render_formula.ptr;
        };
        const tiles_dirty = fresh or chunk.dirty.tiles or chunk.dirty.flora or chunk.dirty.zones or (runtime.paint_slot_used[i] and formula_stale);
        // the water surface is bed + depth, so a re-dug bed moves the water too
        const water_dirty = height_dirty or chunk.dirty.water;
        // painted flora grows LITERAL foliage (req_2497): regrow when the lanes
        // change AND when terrain height moves (blades sit on the relief)
        if (fresh or chunk.dirty.flora or height_dirty) foliage_stale = true;
        if (!height_dirty and !tiles_dirty and !water_dirty) continue;

        const half_span = map_chunks.CHUNK_METERS / 2;
        const node = &runtime.kid_list.items[first + i];
        if (fresh) {
            const prior_ground_data_version = node.scene3d_ground_data_version;
            // one-time placement: the chunk is CENTERED at (cx·120, cz·120)
            node.* = .{
                .scene3d_hf_cols = @intCast(map_paint.FLOOR_RES),
                .scene3d_hf_rows = @intCast(map_paint.FLOOR_RES),
                .scene3d_hf_width = map_chunks.CHUNK_METERS,
                .scene3d_hf_depth = map_chunks.CHUNK_METERS,
                .scene3d_hf_base = 0,
                .scene3d_pos_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS,
                .scene3d_pos_y = 0,
                .scene3d_pos_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS,
                // Physical slots outlive coordinate claims. Preserve the
                // monotonic identity so a recycled CPU pointer cannot alias a
                // previous GPU upload after whole-map replacement.
                .scene3d_ground_data_version = prior_ground_data_version,
            };
            runtime.paint_slot_used[i] = true;
            runtime.paint_slot_chunk[i] = .{ chunk.cx, chunk.cz };
        }

        if (height_dirty) {
            const floor = runtime.paint_slot_floor[i] orelse blk: {
                const buf = runtime.allocator.alloc(f32, map_paint.FLOOR_CELLS) catch continue;
                runtime.paint_slot_floor[i] = buf;
                break :blk buf;
            };
            map_paint.downsampleFloorHeights(&chunk.height, floor);
            chunk.dirty.height = false;
            runtime.paint_slot_ver[i] += 1;
            if (runtime.paint_slot_key[i]) |old| runtime.allocator.free(old);
            const key = std.fmt.allocPrint(runtime.allocator, "~hf~paint-slot-{d}~{d}", .{ i, runtime.paint_slot_ver[i] }) catch continue;
            runtime.paint_slot_key[i] = key;

            var max_abs: f32 = 0;
            for (floor) |v| max_abs = @max(max_abs, @abs(v));
            node.scene3d_mesh = true;
            node.scene3d_geom_key = key;
            node.scene3d_heights = floor;
            node.scene3d_bounds_radius = @sqrt(half_span * half_span * 2 + max_abs * max_abs);

            // collider mirror: same grid the render bakes — see-it == walk-it
            _ = game_physics.registerHeightfield(.{
                .id = PAINT_COLLIDER_BASE + i,
                .origin_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS - half_span,
                .origin_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS - half_span,
                .cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(map_paint.FLOOR_RES - 1)),
                .cols = map_paint.FLOOR_RES,
                .rows = map_paint.FLOOR_RES,
                .base_y = 0,
                .walk_cos = 0.6,
            }, std.mem.sliceAsBytes(floor));
        }

        // ground texture (the tile channel): encode the chunk's cell grid as the
        // ground formula's D stream. The 3d.zig ground pipeline re-reads the
        // node's slice every frame, so no geometry re-key is needed — painting a
        // tile shows next frame. Falls back to the flat editor tint until the
        // cart pushes a formula (__map_set_ground_look).
        var ground_data_changed = false;
        if (tiles_dirty) {
            chunk.dirty.tiles = false;
            chunk.dirty.flora = false;
            chunk.dirty.zones = false;
            const need = if (live_formula != null) map_paint.groundDataFloats() else 0;
            const alloc_need = if (need <= terrain_grid.FORMULA_FLOAT_CAP) terrain_grid.TOTAL_FLOATS else need;
            var ground = runtime.paint_slot_ground[i];
            if (ground == null or ground.?.len < alloc_need) {
                if (ground) |old| runtime.allocator.free(old);
                ground = runtime.allocator.alloc(f32, alloc_need) catch null;
                if (ground) |buf| @memset(buf, 0);
                runtime.paint_slot_ground[i] = ground;
            }
            if (ground) |buf| {
                const used = if (live_formula != null) map_paint.encodeGroundData(chunk, buf) else 0;
                node.scene3d_ground_formula = render_formula;
                node.scene3d_ground_data = buf[0..used];
                ground_data_changed = true;
                // A real look supplies full RGB. The built-in formula is white
                // and preserves the old bare-terrain tint through inst_color.
                node.scene3d_color_r = if (live_formula != null) 1 else 0.42;
                node.scene3d_color_g = if (live_formula != null) 1 else 0.52;
                node.scene3d_color_b = if (live_formula != null) 1 else 0.34;
            }
        }

        // Formula-painted ground uses one immutable GPU topology. Its current
        // 121-grid heights ride a fixed trailer on D, so sculpting updates data
        // rather than allocating another 86k-vertex dynamic mesh. A future D
        // prefix larger than the reserved cap remains on the legacy mesh path
        // until its wire layout is deliberately revised.
        if (height_dirty or tiles_dirty) {
            if (runtime.paint_slot_ground[i]) |ground| {
                if (runtime.paint_slot_floor[i]) |floor| {
                    const formula_floats = if (live_formula != null) map_paint.groundDataFloats() else 0;
                    const cell = map_chunks.CHUNK_METERS / @as(f32, @floatFromInt(map_paint.FLOOR_RES - 1));
                    if (terrain_grid.append(
                        ground,
                        formula_floats,
                        floor,
                        @intCast(map_paint.FLOOR_RES),
                        @intCast(map_paint.FLOOR_RES),
                        cell,
                        cell,
                    )) {
                        node.scene3d_ground_data = ground[0..terrain_grid.TOTAL_FLOATS];
                        ground_data_changed = true;
                    }
                }
            }
        }
        if (ground_data_changed) node.scene3d_ground_data_version +%= 1;

        // the water channel: a second "~water~"-pipeline node over the same
        // footprint — shore-culled depths + bed+depth surface, dry cells tucked
        // under the basin floor (paintWaterSurface). Static bake; the water
        // pipeline animates the surface on the GPU from the host clock.
        if (water_dirty) {
            chunk.dirty.water = false;
            const wfirst = runtime.paint_water_kids_first orelse continue;
            const wnode = &runtime.kid_list.items[wfirst + i];
            const floor = runtime.paint_slot_floor[i] orelse continue; // beds (height ran first)
            const depths = runtime.paint_slot_depths[i] orelse blk: {
                const buf = runtime.allocator.alloc(f32, map_paint.FLOOR_CELLS) catch continue;
                runtime.paint_slot_depths[i] = buf;
                break :blk buf;
            };
            const surface = runtime.paint_slot_surface[i] orelse blk: {
                const buf = runtime.allocator.alloc(f32, map_paint.FLOOR_CELLS) catch continue;
                runtime.paint_slot_surface[i] = buf;
                break :blk buf;
            };
            // Depth must ride the EXACT source sample selected for the terrain
            // bed. Independent abs-max passes can combine a dry +6 m bank with
            // a neighbouring 2 m depth and invent an 8 m water surface.
            map_paint.downsampleFloorWaterDepths(&chunk.height, &chunk.water, depths);
            const wet = paintWaterSurface(depths, floor, depths, surface);
            if (!wet) {
                wnode.scene3d_mesh = false;
            } else {
                runtime.paint_slot_water_ver[i] += 1;
                if (runtime.paint_slot_water_key[i]) |old| runtime.allocator.free(old);
                const wkey = std.fmt.allocPrint(runtime.allocator, "~hf~paint-water-slot-{d}~{d}", .{ i, runtime.paint_slot_water_ver[i] }) catch continue;
                runtime.paint_slot_water_key[i] = wkey;
                var wmax: f32 = 0;
                for (surface) |v| wmax = @max(wmax, @abs(v));
                wnode.* = .{
                    .scene3d_mesh = true,
                    .scene3d_geom_key = wkey,
                    .scene3d_tex_key = "~water~",
                    .scene3d_heights = surface,
                    .scene3d_hf_depths = depths,
                    .scene3d_hf_cols = @intCast(map_paint.FLOOR_RES),
                    .scene3d_hf_rows = @intCast(map_paint.FLOOR_RES),
                    .scene3d_hf_width = map_chunks.CHUNK_METERS,
                    .scene3d_hf_depth = map_chunks.CHUNK_METERS,
                    .scene3d_hf_base = 0,
                    .scene3d_bounds_radius = @sqrt(half_span * half_span * 2 + wmax * wmax),
                    .scene3d_pos_x = @as(f32, @floatFromInt(chunk.cx)) * map_chunks.CHUNK_METERS,
                    .scene3d_pos_y = 0,
                    .scene3d_pos_z = @as(f32, @floatFromInt(chunk.cz)) * map_chunks.CHUNK_METERS,
                    // inst_color is ignored by the water shader; opaque keeps it
                    // on the pipeline-swap path (color_a < 1 would divert it)
                    .scene3d_color_a = 1,
                };
            }
        }
    }

    // Non-resident chunks have no live node to refresh. Their authored arrays
    // are already current (and autosaved); when one enters the working set,
    // `fresh` rebuilds every channel unconditionally. Drain the shared dirty
    // flags now so distant edits trigger transport/foliage once, not every frame.
    for (map_chunks.slots()) |maybe| {
        const chunk = maybe orelse continue;
        if (!resident_mask[documentSlotIndex(.{ chunk.cx, chunk.cz })]) {
            chunk.dirty = .{};
        }
    }

    // Height mirrors are current now, so a forced rail re-drape samples the
    // exact 121-grid surface the user sees rather than the previous frame.
    rebuildCommittedTransport(runtime, path_terrain_dirty);
    rebuildTransportPreview(runtime, path_active, path_terrain_dirty);

    // Regenerate when authored data changes OR the shared streaming bubble
    // promotes/demotes a foliage chunk. Hysteresis in world/streaming keeps
    // camera movement near a boundary from thrashing the worker.
    if (foliage_stale or foliage_residency_changed) requestFoliageRegen(runtime, foliage_stale);
    // req_2864: apply finished worker regens + feed the worker its next job.
    // The regen itself runs OFF this thread — a paint frame spends microseconds
    // here no matter how much of the world is planted.
    pollFoliageRegen(runtime, io);

    // the brush gizmo: preview-only chrome over the footprint at the hover point
    if (runtime.paint_beam_kid) |beam_kid| {
        const node = &runtime.kid_list.items[beam_kid];
        const path_has_ghost = path_active and (if (map_paint.pathAuthoringTool() == .stop)
            map_transport.controlPreview() != null
        else
            map_transport.draftPointCount() > 0);
        if (armed and runtime.paint_hover != null and !path_has_ghost) {
            const hover = runtime.paint_hover.?;
            const tool = map_paint.tool();
            dressPaintGizmo(runtime, node, hover, tool);
        } else {
            node.scene3d_mesh = false;
        }
    }
}
