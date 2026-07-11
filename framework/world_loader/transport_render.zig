//! Semantic road, rail, and traffic-control preview geometry.
//!
//! Authored paths remain semantic data; this module alone lowers them into transient box rows.

const std = @import("std");
const layout = @import("../layout.zig");
const map_paint = @import("../game/map/engine.zig");
const map_chunks = @import("../game/map/chunks.zig");
const map_transport = @import("../game/map/transport.zig");
const config = @import("config.zig");
const foliage_preview = @import("foliage_preview.zig");
const state = @import("state.zig");
const Node = layout.Node;
const log = std.debug;
const paintGroundY = foliage_preview.paintGroundY;
const paintSlotFloorFor = foliage_preview.paintSlotFloorFor;
const INSTANCE_STRIDE = config.INSTANCE_STRIDE;
const TRANSPORT_RENDER = config.TRANSPORT_RENDER;
const clamp = state.clamp;

// ── semantic road / rail path preview (req_2924) ─────────────────────────────

pub fn transportWorldPoint(point: map_transport.Point) [3]f32 {
    const author_origin = map_chunks.CHUNK_METERS / 2;
    return .{ point.gx - author_origin, point.elevation_m, point.gz - author_origin };
}

pub fn transportGroundY(runtime: anytype, x: f32, z: f32) f32 {
    const cx = map_chunks.chunkOfGlobalTile(map_chunks.globalTile(x));
    const cz = map_chunks.chunkOfGlobalTile(map_chunks.globalTile(z));
    const chunk = map_chunks.chunkAt(cx, cz) orelse return 0;
    return paintGroundY(paintSlotFloorFor(runtime, cx, cz), chunk, x, z);
}

/// Append one terrain-draped cube row whose local +Z runs from A to B.
pub fn appendTransportBox(
    runtime: anytype,
    rows: *std.ArrayListUnmanaged(f32),
    ax: f32,
    az: f32,
    a_elevation_m: f32,
    bx: f32,
    bz: f32,
    b_elevation_m: f32,
    width_m: f32,
    height_m: f32,
    lift_m: f32,
    color: [3]f32,
) !void {
    const dx = bx - ax;
    const dz = bz - az;
    const horizontal = @sqrt(dx * dx + dz * dz);
    if (horizontal < 0.0001) return;
    const ay = transportGroundY(runtime, ax, az) + a_elevation_m + lift_m + height_m * 0.5;
    const by = transportGroundY(runtime, bx, bz) + b_elevation_m + lift_m + height_m * 0.5;
    const dy = by - ay;
    const length = @sqrt(horizontal * horizontal + dy * dy) + TRANSPORT_RENDER.segment_overlap_m;
    const degrees = 180.0 / std.math.pi;
    try rows.appendSlice(runtime.allocator, &[INSTANCE_STRIDE]f32{
        (ax + bx) * 0.5,
        (ay + by) * 0.5,
        (az + bz) * 0.5,
        -std.math.atan2(dy, horizontal) * degrees,
        std.math.atan2(dx, dz) * degrees,
        0,
        width_m,
        height_m,
        length,
        color[0],
        color[1],
        color[2],
    });
}

pub fn appendRoadPreview(runtime: anytype, path: map_transport.Path, rows: *std.ArrayListUnmanaged(f32), color: [3]f32) !void {
    const profile = switch (path.profile) {
        .road => |road| road,
        else => return,
    };
    var curve: [map_transport.MAX_CURVE_POINTS]map_transport.Point = undefined;
    const count = map_transport.curvePoints(path.points, path.curve_radius_m, curve[0..]);
    if (count < 2) return;
    const width_m: f32 = @floatFromInt(map_paint.roads.roadWidthTiles(profile));
    var i: usize = 0;
    while (i + 1 < count) : (i += 1) {
        const a = transportWorldPoint(curve[i]);
        const b = transportWorldPoint(curve[i + 1]);
        try appendTransportBox(
            runtime,
            rows,
            a[0],
            a[2],
            a[1],
            b[0],
            b[2],
            b[1],
            width_m,
            TRANSPORT_RENDER.preview_thickness_m,
            TRANSPORT_RENDER.surface_lift_m,
            color,
        );
    }
}

pub fn appendRailPath(runtime: anytype, path: map_transport.Path, rows: *std.ArrayListUnmanaged(f32), preview: bool, valid: bool) !void {
    const kind = map_transport.kindOf(path.profile);
    const rail_profile = switch (path.profile) {
        .light_rail => |rail| rail,
        .railway => |rail| rail,
        else => return,
    };
    var curve: [map_transport.MAX_CURVE_POINTS]map_transport.Point = undefined;
    const count = map_transport.curvePoints(path.points, path.curve_radius_m, curve[0..]);
    if (count < 2) return;

    const tracks: usize = @intCast(std.math.clamp(rail_profile.tracks, 1, map_transport.TUNING.max_tracks));
    const track_span = TRANSPORT_RENDER.double_track_spacing_m * @as(f32, @floatFromInt(tracks - 1)) + TRANSPORT_RENDER.rail_gauge_m;
    const is_light_rail = kind == .light_rail;
    const bed_margin = if (is_light_rail) TRANSPORT_RENDER.light_rail_slab_margin_m else TRANSPORT_RENDER.railway_bed_margin_m;
    const bed_height = if (is_light_rail) TRANSPORT_RENDER.light_rail_slab_height_m else TRANSPORT_RENDER.railway_bed_height_m;
    const preview_color = if (valid) TRANSPORT_RENDER.preview_color else TRANSPORT_RENDER.invalid_color;
    const bed_color = if (preview) preview_color else if (is_light_rail) TRANSPORT_RENDER.slab_color else TRANSPORT_RENDER.ballast_color;
    const detail_color = if (preview) preview_color else TRANSPORT_RENDER.steel_color;
    const sleeper_color = if (preview) preview_color else TRANSPORT_RENDER.sleeper_color;
    const bed_width = track_span + bed_margin * 2;
    var sleeper_to_next: f32 = 0;

    var i: usize = 0;
    while (i + 1 < count) : (i += 1) {
        const a = transportWorldPoint(curve[i]);
        const b = transportWorldPoint(curve[i + 1]);
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const segment_length = @sqrt(dx * dx + dz * dz);
        if (segment_length < 0.0001) continue;
        const right_x = -dz / segment_length;
        const right_z = dx / segment_length;

        try appendTransportBox(
            runtime,
            rows,
            a[0],
            a[2],
            a[1],
            b[0],
            b[2],
            b[1],
            bed_width,
            bed_height,
            TRANSPORT_RENDER.surface_lift_m,
            bed_color,
        );

        var track_index: usize = 0;
        while (track_index < tracks) : (track_index += 1) {
            const centered_index = @as(f32, @floatFromInt(track_index)) - @as(f32, @floatFromInt(tracks - 1)) * 0.5;
            const track_center = centered_index * TRANSPORT_RENDER.double_track_spacing_m;
            for ([_]f32{ -0.5, 0.5 }) |rail_side| {
                const offset = track_center + rail_side * TRANSPORT_RENDER.rail_gauge_m;
                try appendTransportBox(
                    runtime,
                    rows,
                    a[0] + right_x * offset,
                    a[2] + right_z * offset,
                    a[1],
                    b[0] + right_x * offset,
                    b[2] + right_z * offset,
                    b[1],
                    TRANSPORT_RENDER.rail_width_m,
                    TRANSPORT_RENDER.rail_height_m,
                    TRANSPORT_RENDER.surface_lift_m + bed_height,
                    detail_color,
                );
            }
        }

        // The live ghost keeps ballast + both steel lines but omits sleepers;
        // spacing hundreds of ties while the cursor moves adds no shape signal.
        if (!is_light_rail and !preview) {
            while (sleeper_to_next <= segment_length) : (sleeper_to_next += TRANSPORT_RENDER.sleeper_spacing_m) {
                const t = sleeper_to_next / segment_length;
                const cx = a[0] + dx * t;
                const cz = a[2] + dz * t;
                const elevation_m = a[1] + (b[1] - a[1]) * t;
                const half_sleeper = bed_width * 0.5 - bed_margin * 0.25;
                try appendTransportBox(
                    runtime,
                    rows,
                    cx - right_x * half_sleeper,
                    cz - right_z * half_sleeper,
                    elevation_m,
                    cx + right_x * half_sleeper,
                    cz + right_z * half_sleeper,
                    elevation_m,
                    TRANSPORT_RENDER.sleeper_width_m,
                    TRANSPORT_RENDER.sleeper_height_m,
                    TRANSPORT_RENDER.surface_lift_m + bed_height,
                    sleeper_color,
                );
            }
            sleeper_to_next -= segment_length;
        }
    }
}

pub fn railBedMetrics(path: map_transport.Path) ?[2]f32 {
    const kind = map_transport.kindOf(path.profile);
    const profile = switch (path.profile) {
        .light_rail => |rail| rail,
        .railway => |rail| rail,
        else => return null,
    };
    const tracks: usize = @intCast(std.math.clamp(profile.tracks, 1, map_transport.TUNING.max_tracks));
    const track_span = TRANSPORT_RENDER.double_track_spacing_m * @as(f32, @floatFromInt(tracks - 1)) + TRANSPORT_RENDER.rail_gauge_m;
    const is_light_rail = kind == .light_rail;
    const margin = if (is_light_rail) TRANSPORT_RENDER.light_rail_slab_margin_m else TRANSPORT_RENDER.railway_bed_margin_m;
    const height = if (is_light_rail) TRANSPORT_RENDER.light_rail_slab_height_m else TRANSPORT_RENDER.railway_bed_height_m;
    return .{ track_span + margin * 2, height };
}

pub fn appendTransportUpright(
    runtime: anytype,
    rows: *std.ArrayListUnmanaged(f32),
    x: f32,
    z: f32,
    elevation_m: f32,
    width_m: f32,
    height_m: f32,
    lift_m: f32,
    color: [3]f32,
) !void {
    const y = transportGroundY(runtime, x, z) + elevation_m + lift_m + height_m * 0.5;
    try rows.appendSlice(runtime.allocator, &[INSTANCE_STRIDE]f32{
        x,        y,        z,
        0,        0,        0,
        width_m,  height_m, width_m,
        color[0], color[1], color[2],
    });
}

pub fn appendControlSample(
    runtime: anytype,
    path: map_transport.Path,
    sample: map_transport.PathSample,
    rows: *std.ArrayListUnmanaged(f32),
    preview: bool,
    valid: bool,
) !void {
    const metrics = railBedMetrics(path) orelse return;
    const point = transportWorldPoint(sample.point);
    const tangent_len = std.math.hypot(sample.tangent.gx, sample.tangent.gz);
    if (tangent_len < 0.0001) return;
    const right_x = -sample.tangent.gz / tangent_len;
    const right_z = sample.tangent.gx / tangent_len;
    const half_span = metrics[0] * 0.5 + TRANSPORT_RENDER.stop_side_margin_m;
    const color = if (preview)
        (if (valid) TRANSPORT_RENDER.preview_color else TRANSPORT_RENDER.invalid_color)
    else
        TRANSPORT_RENDER.stop_color;
    const track_lift = TRANSPORT_RENDER.surface_lift_m + metrics[1] + TRANSPORT_RENDER.rail_height_m;

    try appendTransportBox(
        runtime,
        rows,
        point[0] - right_x * half_span,
        point[2] - right_z * half_span,
        point[1],
        point[0] + right_x * half_span,
        point[2] + right_z * half_span,
        point[1],
        TRANSPORT_RENDER.stop_bar_depth_m,
        TRANSPORT_RENDER.stop_bar_height_m,
        track_lift,
        color,
    );

    for ([_]f32{ -1, 1 }) |side| {
        const x = point[0] + right_x * half_span * side;
        const z = point[2] + right_z * half_span * side;
        try appendTransportUpright(
            runtime,
            rows,
            x,
            z,
            point[1],
            TRANSPORT_RENDER.stop_post_width_m,
            TRANSPORT_RENDER.stop_post_height_m,
            track_lift,
            color,
        );
        try appendTransportUpright(
            runtime,
            rows,
            x,
            z,
            point[1],
            TRANSPORT_RENDER.stop_head_size_m,
            TRANSPORT_RENDER.stop_head_size_m,
            track_lift + TRANSPORT_RENDER.stop_post_height_m,
            color,
        );
    }
}

pub fn appendCommittedControl(runtime: anytype, control: map_transport.Control, rows: *std.ArrayListUnmanaged(f32)) !void {
    const path = map_transport.pathForId(control.path_id) orelse return;
    const sample = map_transport.samplePath(path, control.distance_m) orelse return;
    try appendControlSample(runtime, path, sample, rows, false, true);
}

pub fn updateTransportNode(runtime: anytype, maybe_kid: ?usize, rows: *std.ArrayListUnmanaged(f32)) void {
    const kid = maybe_kid orelse return;
    const node = &runtime.kid_list.items[kid];
    node.scene3d_mesh = rows.items.len >= INSTANCE_STRIDE;
    node.scene3d_instance_data = rows.items;
    node.scene3d_instance_count = @intCast(rows.items.len / INSTANCE_STRIDE);
    node.scene3d_instance_version +%= 1;
}

pub fn rebuildCommittedTransport(runtime: anytype, force: bool) void {
    const revision = map_transport.committedRevision();
    if (!force and runtime.transport_committed_revision == revision) return;
    runtime.transport_committed_rows.clearRetainingCapacity();
    var paths: [map_transport.MAX_PATHS]map_transport.Path = undefined;
    const count = map_transport.collectPaths(paths[0..]);
    for (paths[0..count]) |path| {
        if (map_transport.kindOf(path.profile) == .road) continue;
        appendRailPath(runtime, path, &runtime.transport_committed_rows, false, true) catch {
            runtime.transport_committed_rows.clearRetainingCapacity();
            break;
        };
    }
    var controls: [map_transport.MAX_CONTROLS]map_transport.Control = undefined;
    const control_count = map_transport.collectControls(controls[0..]);
    for (controls[0..control_count]) |control| {
        appendCommittedControl(runtime, control, &runtime.transport_committed_rows) catch {
            runtime.transport_committed_rows.clearRetainingCapacity();
            break;
        };
    }
    updateTransportNode(runtime, runtime.transport_committed_kid, &runtime.transport_committed_rows);
    runtime.transport_committed_revision = revision;
}

pub fn rebuildTransportPreview(runtime: anytype, active: bool, force: bool) void {
    const revision = map_transport.draftRevision();
    if (!force and runtime.transport_draft_revision == revision and runtime.transport_preview_active == active) return;
    runtime.transport_preview_rows.clearRetainingCapacity();
    if (active) {
        if (map_paint.pathAuthoringTool() == .stop) {
            if (map_transport.controlPreview()) |preview| {
                if (map_transport.pathForId(preview.path_id)) |path| {
                    appendControlSample(runtime, path, preview.sample, &runtime.transport_preview_rows, true, preview.valid) catch runtime.transport_preview_rows.clearRetainingCapacity();
                }
            }
        } else {
            if (map_transport.draftPreview()) |path| {
                const validation = map_transport.validate(path);
                const color = if (validation.valid) TRANSPORT_RENDER.preview_color else TRANSPORT_RENDER.invalid_color;
                switch (map_transport.kindOf(path.profile)) {
                    .road => appendRoadPreview(runtime, path, &runtime.transport_preview_rows, color) catch runtime.transport_preview_rows.clearRetainingCapacity(),
                    .light_rail, .railway => appendRailPath(runtime, path, &runtime.transport_preview_rows, true, validation.valid) catch runtime.transport_preview_rows.clearRetainingCapacity(),
                }
            }
        }
    }
    updateTransportNode(runtime, runtime.transport_preview_kid, &runtime.transport_preview_rows);
    runtime.transport_draft_revision = revision;
    runtime.transport_preview_active = active;
}
