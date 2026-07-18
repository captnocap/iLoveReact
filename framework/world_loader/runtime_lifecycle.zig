//! Loader allocation-independent initialization, GPU material readiness, and teardown.
//!
//! Operations are generic over the retained Runtime shape to keep ownership in runtime.zig.

const std = @import("std");
const material_tex = @import("../gpu/material_tex.zig");
const decal_raster = @import("../gpu/decal_raster.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const constructor = @import("../world/constructor.zig");
const log = std.debug;
const m_config = @import("config.zig");
const m_streaming_support = @import("streaming_support.zig");
const m_game_file = @import("game_file.zig");
const m_live_inputs = @import("live_inputs.zig");
const scene_build = @import("scene_build.zig");

const MATERIAL_TILE_PX = m_config.MATERIAL_TILE_PX;
const materializeCutoutStencilPixels = m_streaming_support.materializeCutoutStencilPixels;
const loadGameFile = m_game_file.loadGameFile;
const setHideWalls = m_live_inputs.setHideWalls;
const build = scene_build.build;

fn envFlag(environ: *const std.process.Environ.Map, name: []const u8) bool {
    const value = environ.get(name) orelse return false;
    return value.len == 0 or value[0] != '0';
}

pub fn initInPlace(self: anytype, io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator, path: []const u8, store_dir: []const u8, node_id: u32) !void {
    const bytes = loadGameFile(io, allocator, path) catch |err| {
        // BLANKBOOT req_2490: no game file at this path yet — the paint-first
        // editor opens an EMPTY canvas instead of failing the mount. The world
        // is exactly the live layers (painted map, placed pieces, brush beam)
        // over nothing; the first Compile writes the file and a reload swaps
        // the real bake in. Only file-absence blanks; a corrupt file still
        // fails LOUDLY below.
        if (err == error.FileNotFound) {
            self.* = @TypeOf(self.*){
                .allocator = allocator,
                .node_id = node_id,
                .force_gait = envFlag(environ, "RJIT_FORCE_GAIT"),
                .live_log = envFlag(environ, "RJIT_LIVELOG"),
                .traffic_log = envFlag(environ, "RJIT_TRAFFICLOG"),
                .scene = constructor.blankScene(),
            };
            log.print("[loader] no game file at {s} — BLANK world (paint-first canvas)\n", .{path});
            try build(self, io, environ);
            return;
        }
        log.print("[loader] failed to read game-file {s}: {any}\n", .{ path, err });
        return err;
    };
    defer allocator.free(bytes);

    var store = std.Io.Dir.cwd().createDirPathOpen(io, store_dir, .{}) catch |err| {
        log.print("[loader] cannot open content store {s}: {any}\n", .{ store_dir, err });
        return err;
    };
    defer store.close(io);

    const scene = constructor.construct(io, allocator, bytes, store) catch |err| {
        log.print("[loader] construct FAILED: {any}\n", .{err});
        return err;
    };
    self.* = @TypeOf(self.*){
        .allocator = allocator,
        .node_id = node_id,
        .force_gait = envFlag(environ, "RJIT_FORCE_GAIT"),
        .live_log = envFlag(environ, "RJIT_LIVELOG"),
        .traffic_log = envFlag(environ, "RJIT_TRAFFICLOG"),
        .scene = scene,
    };
    errdefer deinit(self, io);
    log.print("[loader] constructed map {d}x{d} from {s} (no JS)\n", .{ self.scene.width, self.scene.height, path });
    // WALLHIDE req_2053: RJIT_HIDE_WALLS=1 seeds the editor's "disable walls" so a headless
    // `rjit game shot` exercises the collapse (the door is otherwise only called from the
    // editor build pane). Diagnostic knob in the RJIT_STREAM / RJIT_COLLIDERLOG family.
    if (environ.get("RJIT_HIDE_WALLS")) |v| {
        if (v.len > 0 and v[0] == '1') {
            setHideWalls(node_id, true);
            log.print("[loader] RJIT_HIDE_WALLS=1 — walls collapsed (interior-edit view)\n", .{});
        }
    }
    if (self.scene.stats_config) |sc| {
        log.print("[loader] player stats config: hp_max={d:.0} armor={d:.0}/{d:.0} energy={d:.0}/{d:.0} wanted_decay={d:.2} skill_max_lvl={d:.0} (carries end to end)\n", .{ sc.health_max, sc.armor_start, sc.armor_max, sc.energy_start, sc.energy_max, sc.wanted_decay, sc.max_level });
    } else {
        log.print("[loader] no stats config lump — player stats use built-in defaults\n", .{});
    }
    try build(self, io, environ);
}

/// Run each face material's RECIPE into its texture — a SHADER runs on
/// the GPU, a DECAL DOC rasterizes on the CPU (DECALRECIPE-0610,
/// gpu/decal_raster.zig) — and install it under the batch key
/// (idempotent; needs gpu up, so it runs at first render not build).
/// A material that fails to materialize leaves its faces on the
/// fallback color.
pub fn ensureMaterials(self: anytype, io: std.Io, environ: *const std.process.Environ.Map) void {
    if (self.materials_ready) return;
    self.materials_ready = true;
    // The content-addressed image payloads decal docs reference by key
    // (DECALIMG-0610) — constructor read them from the store; hand the
    // rasterizer its own view of the table (gpu/ stays world/-free).
    var images: []decal_raster.ImageAsset = &.{};
    defer if (images.len > 0) self.allocator.free(images);
    if (self.scene.decal_assets.len > 0) {
        if (self.allocator.alloc(decal_raster.ImageAsset, self.scene.decal_assets.len)) |buf| {
            for (self.scene.decal_assets, 0..) |asset, k| buf[k] = .{ .key = asset.key, .bytes = asset.bytes };
            images = buf;
        } else |_| {
            log.print("[loader] OOM mapping {d} decal image asset(s) — image nodes skip\n", .{self.scene.decal_assets.len});
        }
    }
    for (self.scene.materials, 0..) |m, i| {
        var buf: [32]u8 = undefined;
        const key = std.fmt.bufPrint(&buf, "wmat-{d}", .{i}) catch continue;
        // Decal materials carry their packed doc — rasterize + upload.
        if (m.decal_doc.len > 0) {
            if (decal_raster.rasterize(self.allocator, m.decal_doc, images)) |raster| {
                defer self.allocator.free(raster.rgba);
                if (!material_tex.materializePixels(key, raster.rgba, raster.w, raster.h))
                    log.print("[loader] decal material {d} not installed — faces show fallback color\n", .{i});
            } else {
                log.print("[loader] decal material {d} doc malformed — faces show fallback color\n", .{i});
            }
            continue;
        }
        // Translucent flat materials (glass: empty wgsl) have no shader to run —
        // they render through the transparent pass with the row's own color.
        // Feeding "" to the shader pipeline would crash wgpu, so skip them.
        if (m.wgsl.len == 0) continue;
        // Paint-bench cutout stencils ship as a tiny recipe: colors + a
        // coarse 0/1 mask grid. Rebuild that texture directly here so the
        // no-JS game path does not depend on the effects shader pipeline for
        // player-authored wall paint.
        if (materializeCutoutStencilPixels(self.allocator, key, m)) continue;
        if (!material_tex.materialize(io, environ, key, m.wgsl, m.data, MATERIAL_TILE_PX))
            log.print("[loader] material {d} not materialized — faces show fallback color\n", .{i});
    }
}

pub fn deinit(self: anytype, io: std.Io) void {
    self.mesh_by_hash.deinit(self.allocator);
    self.live_cooked_door_by_identity.deinit(self.allocator);
    if (self.resident) |*res| res.deinit(self.allocator);
    self.resident_by_hash.deinit(self.allocator);
    self.baked_by_pos.deinit(self.allocator);
    self.hidden_baked.deinit(self.allocator);
    self.baked_mesh_list.deinit(self.allocator);
    self.erased_rows.deinit(self.allocator);
    self.wall_collapsed_rows.deinit(self.allocator);
    self.skin_box_buf.deinit(self.allocator);
    self.transport_committed_rows.deinit(self.allocator);
    self.transport_preview_rows.deinit(self.allocator);
    {
        var it = self.live_mat_keys.valueIterator();
        while (it.next()) |v| self.allocator.free(v.*);
        self.live_mat_keys.deinit(self.allocator);
    }
    for (self.mesh_prop_vertex_buffers.items) |verts| self.allocator.free(verts);
    self.mesh_prop_vertex_buffers.deinit(self.allocator);
    for (self.mesh_prop_islands) |isls| self.allocator.free(isls);
    if (self.mesh_prop_islands.len > 0) self.allocator.free(self.mesh_prop_islands);
    for (self.player_geom_keys.items) |key| self.allocator.free(key);
    self.player_geom_keys.deinit(self.allocator);
    for (self.paint_slot_key) |maybe_key| {
        if (maybe_key) |key| self.allocator.free(key);
    }
    for (self.paint_slot_floor) |maybe_floor| {
        if (maybe_floor) |floor| self.allocator.free(floor);
    }
    for (self.paint_slot_ground) |maybe_ground| {
        if (maybe_ground) |ground| self.allocator.free(ground);
    }
    for (self.paint_slot_water_key) |maybe_key| {
        if (maybe_key) |key| self.allocator.free(key);
    }
    for (self.paint_slot_depths) |maybe_buf| {
        if (maybe_buf) |buf| self.allocator.free(buf);
    }
    for (self.paint_slot_surface) |maybe_buf| {
        if (maybe_buf) |buf| self.allocator.free(buf);
    }
    // Foliage worker teardown (req_2864): stop the mailbox, join, THEN free
    // the worker-owned row sets — never while a regen could be writing them.
    self.foliage_box.stop(io);
    if (self.foliage_worker_started) _ = self.foliage_tasks.await(io) catch {};
    self.foliage_worker_started = false;
    for (&self.foliage_sets) |*set| {
        for (&set.rows) |*maybe_rows| {
            if (maybe_rows.*) |buf| std.heap.c_allocator.free(buf);
        }
        for (&set.segs) |*segs| segs.deinit(std.heap.c_allocator);
    }
    if (self.foliage_snap.chunks.len > 0) std.heap.c_allocator.free(self.foliage_snap.chunks);
    {
        var it = self.live_slot_keys.valueIterator();
        while (it.next()) |key| self.allocator.free(key.*);
        self.live_slot_keys.deinit(self.allocator);
    }
    self.npcs.deinit(self.allocator);
    if (self.material_batches.len > 0) {
        for (self.material_batches) |batch| batch.deinit(self.allocator);
        self.allocator.free(self.material_batches);
    }
    self.kid_list.deinit(self.allocator);
    if (self.stream) |*w| w.deinit(self.allocator);
    self.stream_protos.deinit(self.allocator);
    if (self.has_shape_batches) self.shape_batches.deinit(self.allocator);
    if (self.has_physics_colliders) self.physics_colliders.deinit(self.allocator);
    if (self.camera_colliders) |cam_cols| cam_cols.deinit(self.allocator);
    if (self.grid) |g| g.deinit(self.allocator);
    if (self.fallback) |f| self.allocator.free(f);
    if (self.interact.searched.len > 0) self.allocator.free(self.interact.searched);
    if (self.bodies.len > 0) self.allocator.free(self.bodies);
    if (self.cars.len > 0) self.allocator.free(self.cars);
    if (self.doors_state.len > 0) self.allocator.free(self.doors_state);
    if (self.cooked_doors.len > 0) self.allocator.free(self.cooked_doors);
    if (self.live_cooked_doors.len > 0) self.allocator.free(self.live_cooked_doors);
    if (self.live_cooked_door_states.len > 0) self.allocator.free(self.live_cooked_door_states);
    for (self.ticker_buffers) |buf| self.allocator.free(buf);
    if (self.ticker_buffers.len > 0) self.allocator.free(self.ticker_buffers);
    if (self.traffic_box_buf.len > 0) self.allocator.free(self.traffic_box_buf);
    if (self.traffic_cyl_buf.len > 0) self.allocator.free(self.traffic_cyl_buf);
    if (self.traffic_sphere_buf.len > 0) self.allocator.free(self.traffic_sphere_buf);
    if (self.traffic_path_buf.len > 0) self.allocator.free(self.traffic_path_buf);
    if (self.live_buf.len > 0) self.allocator.free(self.live_buf); // LIVEHOST req_1798
    self.scene.deinit(self.allocator);
    self.* = undefined;
}
