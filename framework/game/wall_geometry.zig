//! Renderer-neutral wall geometry and gameplay lowering.
//!
//! This module converts validated semantic walls into one shared set of exact-u
//! intervals and metric quads. Renderers, collision, navigation, cover, sound,
//! visibility, and picking consume these outputs; none re-derive openings.

const std = @import("std");
const architecture_scale = @import("architecture_scale");
const types = @import("wall_types");
const catalog = @import("building_catalog");
const topology = @import("wall_topology");

const generated_pane_material_id = "architecture:generated:pane";

pub const Point2Meters = struct { u: f32, v: f32 };
pub const Point3Meters = struct { x: f32, y: f32, z: f32 };
pub const Vector3 = struct { x: f32, y: f32, z: f32 };

pub const SurfaceRole = enum(u8) {
    face,
    reveal,
    jamb,
    sill,
    header,
    cap,
    end,
    pane,
};

pub const PickKind = enum(u8) {
    wall_face,
    opening_void,
    opening_frame,
};

pub const JunctionKind = enum(u8) {
    miter,
    bevel,
    tee,
    cross,
};

pub const JunctionPatch = struct {
    vertex_id: []u8,
    floor: i32,
    kind: JunctionKind,
    incident_edge_count: u8,
    point_m: Point3Meters,
    miter_ratio: f32,

    pub fn deinit(self: *JunctionPatch, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.vertex_id);
        self.* = undefined;
    }
};

pub const SurfaceBand = struct {
    edge_id: []u8,
    opening_id: ?[]u8,
    role: SurfaceRole,
    side: ?types.WallSide,
    material_id: []u8,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    quad_m: [4]Point3Meters,
    normal: Vector3,
    uv_m: [4]Point2Meters,

    pub fn deinit(self: *SurfaceBand, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.edge_id);
        if (self.opening_id) |value| freeBytes(allocator, value);
        freeBytes(allocator, self.material_id);
        self.* = undefined;
    }
};

pub const SolidBand = struct {
    edge_id: []u8,
    opening_id: ?[]u8,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,

    pub fn deinit(self: *SolidBand, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.edge_id);
        if (self.opening_id) |value| freeBytes(allocator, value);
        self.* = undefined;
    }
};

pub const TraversalInterval = struct {
    edge_id: []u8,
    opening_id: []u8,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    portal_class: types.PortalClass,

    pub fn deinit(self: *TraversalInterval, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.edge_id);
        freeBytes(allocator, self.opening_id);
        self.* = undefined;
    }
};

pub const DoorAttachmentFrame = struct {
    edge_id: []u8,
    opening_id: []u8,
    kit_id: []u8,
    origin_m: Point3Meters,
    tangent: Vector3,
    outward: Vector3,
    up: Vector3,
    facing_side: types.WallSide,
    hinge: types.WallHinge,

    pub fn deinit(self: *DoorAttachmentFrame, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.edge_id);
        freeBytes(allocator, self.opening_id);
        freeBytes(allocator, self.kit_id);
        self.* = undefined;
    }
};

pub const PickProxy = struct {
    edge_id: []u8,
    opening_id: ?[]u8,
    kind: PickKind,
    side: ?types.WallSide,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    quad_m: [4]Point3Meters,
    normal: Vector3,

    pub fn deinit(self: *PickProxy, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.edge_id);
        if (self.opening_id) |value| freeBytes(allocator, value);
        self.* = undefined;
    }
};

pub const GeometryBundle = struct {
    surfaces: []SurfaceBand,
    colliders: []SolidBand,
    cover: []SolidBand,
    navigation_blockers: []SolidBand,
    sound_occluders: []SolidBand,
    sightline_occluders: []SolidBand,
    traversal: []TraversalInterval,
    door_frames: []DoorAttachmentFrame,
    pick_proxies: []PickProxy,
    junctions: []JunctionPatch,

    pub fn deinit(self: *GeometryBundle, allocator: std.mem.Allocator) void {
        deinitOwnedSlice(SurfaceBand, allocator, self.surfaces);
        deinitOwnedSlice(SolidBand, allocator, self.colliders);
        deinitOwnedSlice(SolidBand, allocator, self.cover);
        deinitOwnedSlice(SolidBand, allocator, self.navigation_blockers);
        deinitOwnedSlice(SolidBand, allocator, self.sound_occluders);
        deinitOwnedSlice(SolidBand, allocator, self.sightline_occluders);
        deinitOwnedSlice(TraversalInterval, allocator, self.traversal);
        deinitOwnedSlice(DoorAttachmentFrame, allocator, self.door_frames);
        deinitOwnedSlice(PickProxy, allocator, self.pick_proxies);
        deinitOwnedSlice(JunctionPatch, allocator, self.junctions);
        self.* = undefined;
    }
};

pub const BuildError = std.mem.Allocator.Error || error{
    geometry_not_implemented,
    invalid_geometry_source,
    missing_geometry_catalog_entry,
    geometry_limit_exceeded,
};

/// Lower validated semantic walls through their directed half-edge context.
pub fn build(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    derived_topology: *const topology.DerivedTopology,
) BuildError!GeometryBundle {
    if (derived_topology.diagnostics.len != 0) return error.invalid_geometry_source;
    var builder = GeometryBuilder.init(allocator);
    defer builder.deinit();

    for (source.walls.edges) |*edge| {
        const start = findSourceVertex(source, edge.start_vertex_id) orelse return error.invalid_geometry_source;
        const end = findSourceVertex(source, edge.end_vertex_id) orelse return error.invalid_geometry_source;
        const base_y_u: types.Unit = switch (edge.support) {
            .absolute => |support| support.base_y_u,
            .slab => return error.invalid_geometry_source,
        };
        const length_u = completeDistanceUnits(start, end);
        const direction = directionBetween(start, end);
        const side_a_normal = Vector3{ .x = -direction.z, .y = 0, .z = direction.x };
        const side_b_normal = Vector3{ .x = -side_a_normal.x, .y = 0, .z = -side_a_normal.z };
        const side_a_points = surfaceEndpoints(source, derived_topology, edge, .a);
        const side_b_points = surfaceEndpoints(source, derived_topology, edge, .b);
        const top_y_m = architecture_scale.unitsToMeters(base_y_u + edge.height_u);
        // Meters of texture per column unit for THIS edge: the true metric
        // centerline length over the quantized column span, so span-anchored
        // UVs keep exact density on angled walls (req_4485).
        const column_scale_m_per_u: f32 = if (length_u == 0) 0 else blk: {
            const delta_x_m = architecture_scale.unitsToMeters(end.x_u - start.x_u);
            const delta_z_m = architecture_scale.unitsToMeters(end.z_u - start.z_u);
            break :blk std.math.hypot(delta_x_m, delta_z_m) / @as(f32, @floatFromInt(length_u));
        };
        const opening_rects = try measuredOpeningRects(allocator, edge, entries, length_u);
        defer if (opening_rects.len != 0) allocator.free(opening_rects);
        try appendFacePartitions(
            &builder,
            edge,
            .a,
            edge.side_a.material_id,
            side_a_points,
            side_a_normal,
            base_y_u,
            length_u,
            column_scale_m_per_u,
            opening_rects,
        );
        try appendFacePartitions(
            &builder,
            edge,
            .b,
            edge.side_b.material_id,
            side_b_points,
            side_b_normal,
            base_y_u,
            length_u,
            column_scale_m_per_u,
            opening_rects,
        );
        for (opening_rects) |rect| {
            try appendOpeningGeometry(
                &builder,
                edge,
                start,
                direction,
                side_a_normal,
                base_y_u,
                rect,
            );
        }

        // End faces are COVERAGE, not topology (req_4481): an endpoint's
        // cross-section is exposed wherever no other incident edge's body
        // spans that height. A lone endpoint exposes its full section (the old
        // open-end band); an equal-height junction is fully covered (no
        // bands); a STEP junction exposes the taller wall's remainder above
        // its neighbours — the see-through hole this replaces.
        var start_gaps: [MAX_END_GAPS]EndGap = undefined;
        const start_gap_count = exposedEndGaps(
            source,
            derived_topology,
            edge,
            edge.start_vertex_id,
            base_y_u,
            base_y_u + edge.height_u,
            &start_gaps,
        );
        for (start_gaps[0..start_gap_count]) |gap| {
            try builder.appendSurface(try ownedSurfaceBand(
                allocator,
                edge.id,
                null,
                .end,
                null,
                edge.side_a.material_id,
                column_scale_m_per_u,
                0,
                0,
                gap.bottom_u - base_y_u,
                gap.top_u - base_y_u,
                verticalQuad(
                    side_b_points.start,
                    side_a_points.start,
                    architecture_scale.unitsToMeters(gap.bottom_u),
                    architecture_scale.unitsToMeters(gap.top_u),
                ),
                .{ .x = -direction.x, .y = 0, .z = -direction.z },
            ));
        }
        var end_gaps: [MAX_END_GAPS]EndGap = undefined;
        const end_gap_count = exposedEndGaps(
            source,
            derived_topology,
            edge,
            edge.end_vertex_id,
            base_y_u,
            base_y_u + edge.height_u,
            &end_gaps,
        );
        for (end_gaps[0..end_gap_count]) |gap| {
            try builder.appendSurface(try ownedSurfaceBand(
                allocator,
                edge.id,
                null,
                .end,
                null,
                edge.side_a.material_id,
                column_scale_m_per_u,
                length_u,
                length_u,
                gap.bottom_u - base_y_u,
                gap.top_u - base_y_u,
                verticalQuad(
                    side_a_points.end,
                    side_b_points.end,
                    architecture_scale.unitsToMeters(gap.bottom_u),
                    architecture_scale.unitsToMeters(gap.top_u),
                ),
                direction,
            ));
        }
        // Every wall seals its top (req_4478). The cap was half-profile-only on
        // the assumption a full wall meets a ceiling — but no floor family
        // exists yet, so full walls rendered as open-topped hollow shells with
        // their interior faces showing. When slabs land, suppressing the cap
        // under a covering slab belongs to that compile pass, not here.
        try builder.appendSurface(try ownedSurfaceBand(
            allocator,
            edge.id,
            null,
            .cap,
            null,
            edge.side_a.material_id,
            column_scale_m_per_u,
            0,
            length_u,
            edge.height_u,
            edge.height_u,
            .{
                point3(side_a_points.start, top_y_m),
                point3(side_a_points.end, top_y_m),
                point3(side_b_points.end, top_y_m),
                point3(side_b_points.start, top_y_m),
            },
            .{ .x = 0, .y = 1, .z = 0 },
        ));
    }

    for (derived_topology.vertices) |*vertex| {
        const incident_count = vertex.outgoing_half_edge_indices.len;
        if (incident_count < 2) continue;
        const classification = classifyJunction(derived_topology, vertex);
        try builder.appendJunction(.{
            .vertex_id = try allocator.dupe(u8, vertex.source_vertex_id),
            .floor = vertex.floor,
            .kind = classification.kind,
            .incident_edge_count = @intCast(@min(incident_count, std.math.maxInt(u8))),
            .point_m = .{
                .x = architecture_scale.unitsToMeters(vertex.point.x_u),
                .y = 0,
                .z = architecture_scale.unitsToMeters(vertex.point.z_u),
            },
            .miter_ratio = classification.miter_ratio,
        });
    }
    return builder.take();
}

const PointXZ = struct { x: f32, z: f32 };
const SegmentEndpoints = struct { start: PointXZ, end: PointXZ };

const OpeningRect = struct {
    opening: *const types.WallOpening,
    kit: *const catalog.CatalogEntry,
    left_u: types.Unit,
    right_u: types.Unit,
    bottom_u: types.Unit,
    top_u: types.Unit,
};

const VerticalInterval = struct { bottom_u: types.Unit, top_u: types.Unit };

fn measuredOpeningRects(
    allocator: std.mem.Allocator,
    edge: *const types.WallEdge,
    entries: []const catalog.CatalogEntry,
    edge_length_u: types.Unit,
) BuildError![]OpeningRect {
    const rects = try allocator.alloc(OpeningRect, edge.openings.len);
    errdefer if (rects.len != 0) allocator.free(rects);
    for (edge.openings, 0..) |*opening, index| {
        const kit = findCatalogEntry(entries, opening.kit_id) orelse return error.missing_geometry_catalog_entry;
        const semantic_kind = kit.semantic_kind orelse return error.missing_geometry_catalog_entry;
        const kit_kind = switch (semantic_kind) {
            .wall_opening => |kind| kind,
            else => return error.missing_geometry_catalog_entry,
        };
        if (kit.family != .wall or kit.role != .opening or kit_kind != opening.kind) {
            return error.missing_geometry_catalog_entry;
        }
        const footprint = kit.measurement.footprint orelse return error.missing_geometry_catalog_entry;
        const rect = OpeningRect{
            .opening = opening,
            .kit = kit,
            .left_u = opening.column_u + footprint.min_column,
            .right_u = opening.column_u + footprint.max_column_exclusive,
            .bottom_u = opening.row_u + footprint.min_row,
            .top_u = opening.row_u + footprint.max_row_exclusive,
        };
        if (rect.left_u < 0 or rect.right_u > edge_length_u or rect.left_u >= rect.right_u or
            rect.bottom_u < 0 or rect.top_u > edge.height_u or rect.bottom_u >= rect.top_u)
        {
            return error.invalid_geometry_source;
        }
        rects[index] = rect;
    }
    std.mem.sort(OpeningRect, rects, {}, openingRectLessThan);
    return rects;
}

fn appendFacePartitions(
    builder: *GeometryBuilder,
    edge: *const types.WallEdge,
    side: types.WallSide,
    material_id: []const u8,
    endpoints: SegmentEndpoints,
    normal: Vector3,
    base_y_u: types.Unit,
    edge_length_u: types.Unit,
    column_scale_m_per_u: f32,
    openings: []const OpeningRect,
) BuildError!void {
    const cuts = try builder.allocator.alloc(types.Unit, 2 + openings.len * 2);
    defer builder.allocator.free(cuts);
    cuts[0] = 0;
    cuts[1] = edge_length_u;
    for (openings, 0..) |opening, index| {
        cuts[2 + index * 2] = opening.left_u;
        cuts[3 + index * 2] = opening.right_u;
    }
    std.mem.sort(types.Unit, cuts, {}, unitLessThan);
    var unique_count: usize = 0;
    for (cuts) |cut| {
        if (unique_count == 0 or cuts[unique_count - 1] != cut) {
            cuts[unique_count] = cut;
            unique_count += 1;
        }
    }
    const active = try builder.allocator.alloc(VerticalInterval, openings.len);
    defer if (active.len != 0) builder.allocator.free(active);
    var cut_index: usize = 0;
    while (cut_index + 1 < unique_count) : (cut_index += 1) {
        const column_start_u = cuts[cut_index];
        const column_end_u = cuts[cut_index + 1];
        if (column_start_u == column_end_u) continue;
        var active_count: usize = 0;
        for (openings) |opening| {
            if (opening.left_u < column_end_u and column_start_u < opening.right_u) {
                active[active_count] = .{ .bottom_u = opening.bottom_u, .top_u = opening.top_u };
                active_count += 1;
            }
        }
        std.mem.sort(VerticalInterval, active[0..active_count], {}, verticalIntervalLessThan);
        var row_cursor_u: types.Unit = 0;
        for (active[0..active_count]) |interval| {
            if (interval.bottom_u > row_cursor_u) {
                try appendFaceRectangle(
                    builder,
                    edge,
                    side,
                    material_id,
                    endpoints,
                    normal,
                    base_y_u,
                    edge_length_u,
                    column_scale_m_per_u,
                    column_start_u,
                    column_end_u,
                    row_cursor_u,
                    interval.bottom_u,
                );
            }
            row_cursor_u = @max(row_cursor_u, interval.top_u);
        }
        if (row_cursor_u < edge.height_u) {
            try appendFaceRectangle(
                builder,
                edge,
                side,
                material_id,
                endpoints,
                normal,
                base_y_u,
                edge_length_u,
                column_scale_m_per_u,
                column_start_u,
                column_end_u,
                row_cursor_u,
                edge.height_u,
            );
        }
    }
}

fn appendFaceRectangle(
    builder: *GeometryBuilder,
    edge: *const types.WallEdge,
    side: types.WallSide,
    material_id: []const u8,
    endpoints: SegmentEndpoints,
    normal: Vector3,
    base_y_u: types.Unit,
    edge_length_u: types.Unit,
    column_scale_m_per_u: f32,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
) std.mem.Allocator.Error!void {
    const start = pointAtColumn(endpoints, column_start_u, edge_length_u);
    const end = pointAtColumn(endpoints, column_end_u, edge_length_u);
    const quad = verticalQuad(
        start,
        end,
        architecture_scale.unitsToMeters(base_y_u + row_bottom_u),
        architecture_scale.unitsToMeters(base_y_u + row_top_u),
    );
    try builder.appendSurface(try ownedSurfaceBand(
        builder.allocator,
        edge.id,
        null,
        .face,
        side,
        material_id,
        column_scale_m_per_u,
        column_start_u,
        column_end_u,
        row_bottom_u,
        row_top_u,
        quad,
        normal,
    ));
    try builder.appendPick(try ownedPickProxy(
        builder.allocator,
        edge.id,
        null,
        .wall_face,
        side,
        column_start_u,
        column_end_u,
        row_bottom_u,
        row_top_u,
        quad,
        normal,
    ));
    if (side == .a) {
        try builder.appendSolidPartition(
            edge.id,
            null,
            column_start_u,
            column_end_u,
            row_bottom_u,
            row_top_u,
        );
    }
}

fn appendOpeningGeometry(
    builder: *GeometryBuilder,
    edge: *const types.WallEdge,
    edge_start: *const types.WallVertex,
    direction: Vector3,
    side_a_normal: Vector3,
    base_y_u: types.Unit,
    rect: OpeningRect,
) BuildError!void {
    const half_thickness_m = architecture_scale.unitsToMeters(edge.thickness_u) / 2;
    const left_center = centerPointAtColumn(edge_start, direction, rect.left_u);
    const right_center = centerPointAtColumn(edge_start, direction, rect.right_u);
    const left_a = offsetPoint(left_center, side_a_normal, half_thickness_m);
    const left_b = offsetPoint(left_center, side_a_normal, -half_thickness_m);
    const right_a = offsetPoint(right_center, side_a_normal, half_thickness_m);
    const right_b = offsetPoint(right_center, side_a_normal, -half_thickness_m);
    const bottom_y_m = architecture_scale.unitsToMeters(base_y_u + rect.bottom_u);
    const top_y_m = architecture_scale.unitsToMeters(base_y_u + rect.top_u);
    const left_quad = verticalQuad(left_b, left_a, bottom_y_m, top_y_m);
    const right_quad = verticalQuad(right_a, right_b, bottom_y_m, top_y_m);
    try appendOpeningSurface(builder, edge, rect, .reveal, rect.left_u, rect.left_u, rect.bottom_u, rect.top_u, left_quad, .{ .x = direction.x, .y = 0, .z = direction.z });
    try appendOpeningSurface(builder, edge, rect, .reveal, rect.right_u, rect.right_u, rect.bottom_u, rect.top_u, right_quad, .{ .x = -direction.x, .y = 0, .z = -direction.z });
    try appendOpeningSurface(builder, edge, rect, .jamb, rect.left_u, rect.left_u, rect.bottom_u, rect.top_u, left_quad, .{ .x = direction.x, .y = 0, .z = direction.z });
    try appendOpeningSurface(builder, edge, rect, .jamb, rect.right_u, rect.right_u, rect.bottom_u, rect.top_u, right_quad, .{ .x = -direction.x, .y = 0, .z = -direction.z });

    if (rect.bottom_u > 0) {
        try appendOpeningSurface(builder, edge, rect, .sill, rect.left_u, rect.right_u, rect.bottom_u, rect.bottom_u, .{
            point3(left_a, bottom_y_m),
            point3(right_a, bottom_y_m),
            point3(right_b, bottom_y_m),
            point3(left_b, bottom_y_m),
        }, .{ .x = 0, .y = 1, .z = 0 });
    }
    if (rect.top_u < edge.height_u) {
        try appendOpeningSurface(builder, edge, rect, .header, rect.left_u, rect.right_u, rect.top_u, rect.top_u, .{
            point3(left_b, top_y_m),
            point3(right_b, top_y_m),
            point3(right_a, top_y_m),
            point3(left_a, top_y_m),
        }, .{ .x = 0, .y = -1, .z = 0 });
    }

    if (openingHasPane(rect.opening.kind)) {
        try builder.appendSurface(try ownedSurfaceBand(
            builder.allocator,
            edge.id,
            rect.opening.id,
            .pane,
            rect.opening.facing_side,
            generated_pane_material_id,
            0,
            rect.left_u,
            rect.right_u,
            rect.bottom_u,
            rect.top_u,
            verticalQuad(left_center, right_center, bottom_y_m, top_y_m),
            if (rect.opening.facing_side == .a) side_a_normal else .{
                .x = -side_a_normal.x,
                .y = 0,
                .z = -side_a_normal.z,
            },
        ));
        try builder.appendOpeningBlocker(
            edge.id,
            rect.opening.id,
            rect.left_u,
            rect.right_u,
            rect.bottom_u,
            rect.top_u,
        );
    }

    const center_quad = verticalQuad(left_center, right_center, bottom_y_m, top_y_m);
    try builder.appendPick(try ownedPickProxy(
        builder.allocator,
        edge.id,
        rect.opening.id,
        .opening_void,
        rect.opening.facing_side,
        rect.left_u,
        rect.right_u,
        rect.bottom_u,
        rect.top_u,
        center_quad,
        if (rect.opening.facing_side == .a) side_a_normal else .{
            .x = -side_a_normal.x,
            .y = 0,
            .z = -side_a_normal.z,
        },
    ));
    const compatibility = rect.kit.wall_opening_compatibility orelse return error.missing_geometry_catalog_entry;
    if (compatibility.portal_class != .none) {
        try builder.appendTraversal(try ownedTraversalInterval(
            builder.allocator,
            edge.id,
            rect.opening.id,
            rect,
            compatibility.portal_class,
        ));
    }
    if (openingHasLeaf(rect.opening.kind)) {
        const anchor_center = centerPointAtColumn(edge_start, direction, rect.opening.column_u);
        const outward = if (rect.opening.facing_side == .a) side_a_normal else Vector3{
            .x = -side_a_normal.x,
            .y = 0,
            .z = -side_a_normal.z,
        };
        try builder.appendDoorFrame(try ownedDoorFrame(
            builder.allocator,
            edge.id,
            rect,
            .{
                .x = anchor_center.x,
                .y = architecture_scale.unitsToMeters(base_y_u + rect.opening.row_u),
                .z = anchor_center.z,
            },
            direction,
            outward,
        ));
    }
}

fn appendOpeningSurface(
    builder: *GeometryBuilder,
    edge: *const types.WallEdge,
    rect: OpeningRect,
    role: SurfaceRole,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    quad: [4]Point3Meters,
    normal: Vector3,
) std.mem.Allocator.Error!void {
    try builder.appendSurface(try ownedSurfaceBand(
        builder.allocator,
        edge.id,
        rect.opening.id,
        role,
        null,
        edge.side_a.material_id,
        0,
        column_start_u,
        column_end_u,
        row_bottom_u,
        row_top_u,
        quad,
        normal,
    ));
    if (role == .jamb or role == .sill or role == .header) {
        try builder.appendPick(try ownedPickProxy(
            builder.allocator,
            edge.id,
            rect.opening.id,
            .opening_frame,
            rect.opening.facing_side,
            column_start_u,
            column_end_u,
            row_bottom_u,
            row_top_u,
            quad,
            normal,
        ));
    }
}

fn pointAtColumn(endpoints: SegmentEndpoints, column_u: types.Unit, edge_length_u: types.Unit) PointXZ {
    const parameter = @as(f32, @floatFromInt(column_u)) / @as(f32, @floatFromInt(edge_length_u));
    return .{
        .x = endpoints.start.x + (endpoints.end.x - endpoints.start.x) * parameter,
        .z = endpoints.start.z + (endpoints.end.z - endpoints.start.z) * parameter,
    };
}

fn centerPointAtColumn(start: *const types.WallVertex, direction: Vector3, column_u: types.Unit) PointXZ {
    const distance_m = architecture_scale.unitsToMeters(column_u);
    return .{
        .x = architecture_scale.unitsToMeters(start.x_u) + direction.x * distance_m,
        .z = architecture_scale.unitsToMeters(start.z_u) + direction.z * distance_m,
    };
}

fn offsetPoint(point: PointXZ, normal: Vector3, distance_m: f32) PointXZ {
    return .{ .x = point.x + normal.x * distance_m, .z = point.z + normal.z * distance_m };
}

fn openingHasPane(kind: types.WallOpeningKind) bool {
    return kind == .window or kind == .double_window;
}

fn openingHasLeaf(kind: types.WallOpeningKind) bool {
    return kind == .door or kind == .garage_door or kind == .sliding_door;
}

fn findCatalogEntry(entries: []const catalog.CatalogEntry, id: []const u8) ?*const catalog.CatalogEntry {
    for (entries) |*entry| if (std.mem.eql(u8, entry.catalog_id, id)) return entry;
    return null;
}

fn openingRectLessThan(_: void, left: OpeningRect, right: OpeningRect) bool {
    if (left.left_u != right.left_u) return left.left_u < right.left_u;
    if (left.bottom_u != right.bottom_u) return left.bottom_u < right.bottom_u;
    return std.mem.lessThan(u8, left.opening.id, right.opening.id);
}

fn unitLessThan(_: void, left: types.Unit, right: types.Unit) bool {
    return left < right;
}

fn verticalIntervalLessThan(_: void, left: VerticalInterval, right: VerticalInterval) bool {
    if (left.bottom_u != right.bottom_u) return left.bottom_u < right.bottom_u;
    return left.top_u < right.top_u;
}

fn surfaceEndpoints(
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    edge: *const types.WallEdge,
    side: types.WallSide,
) SegmentEndpoints {
    const half_edge_index = findHalfEdgeIndex(derived, edge.id, side).?;
    const origin = offsetVertexPoint(source, derived, half_edge_index, true);
    const target = offsetVertexPoint(source, derived, half_edge_index, false);
    return if (side == .a)
        .{ .start = origin, .end = target }
    else
        .{ .start = target, .end = origin };
}

fn offsetVertexPoint(
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    half_edge_index: usize,
    at_origin: bool,
) PointXZ {
    const half_edge = derived.half_edges[half_edge_index];
    const origin = derived.vertices[half_edge.origin_vertex_index].point;
    const target = derived.vertices[half_edge.target_vertex_index].point;
    const direction = directionBetweenPoints(origin, target);
    const edge = findSourceEdge(source, half_edge.source_edge_id).?;
    const half_thickness_m = architecture_scale.unitsToMeters(edge.thickness_u) / 2;
    const normal = PointXZ{ .x = -direction.z, .z = direction.x };
    const vertex_index = if (at_origin) half_edge.origin_vertex_index else half_edge.target_vertex_index;
    const vertex = derived.vertices[vertex_index];
    const base = PointXZ{
        .x = architecture_scale.unitsToMeters(vertex.point.x_u) + normal.x * half_thickness_m,
        .z = architecture_scale.unitsToMeters(vertex.point.z_u) + normal.z * half_thickness_m,
    };
    if (vertex.outgoing_half_edge_indices.len != 2) return base;
    const adjacent_index = if (at_origin) half_edge.previous_half_edge_index else half_edge.next_half_edge_index;
    const adjacent = derived.half_edges[adjacent_index];
    if (std.mem.eql(u8, adjacent.source_edge_id, half_edge.source_edge_id)) return base;
    const adjacent_origin = derived.vertices[adjacent.origin_vertex_index].point;
    const adjacent_target = derived.vertices[adjacent.target_vertex_index].point;
    const adjacent_direction = directionBetweenPoints(adjacent_origin, adjacent_target);
    const adjacent_edge = findSourceEdge(source, adjacent.source_edge_id).?;
    const adjacent_half_thickness_m = architecture_scale.unitsToMeters(adjacent_edge.thickness_u) / 2;
    const adjacent_normal = PointXZ{ .x = -adjacent_direction.z, .z = adjacent_direction.x };
    const adjacent_base = PointXZ{
        .x = architecture_scale.unitsToMeters(vertex.point.x_u) + adjacent_normal.x * adjacent_half_thickness_m,
        .z = architecture_scale.unitsToMeters(vertex.point.z_u) + adjacent_normal.z * adjacent_half_thickness_m,
    };
    const intersection = lineIntersection(base, direction, adjacent_base, adjacent_direction) orelse return base;
    const delta_x = intersection.x - architecture_scale.unitsToMeters(vertex.point.x_u);
    const delta_z = intersection.z - architecture_scale.unitsToMeters(vertex.point.z_u);
    const ratio = @sqrt(delta_x * delta_x + delta_z * delta_z) / half_thickness_m;
    if (!std.math.isFinite(ratio) or ratio > @as(f32, @floatCast(types.wall_tuning.miter_limit_ratio))) return base;
    return intersection;
}

fn lineIntersection(first_point: PointXZ, first_direction: Vector3, second_point: PointXZ, second_direction: Vector3) ?PointXZ {
    const denominator = first_direction.x * second_direction.z - first_direction.z * second_direction.x;
    if (denominator == 0) return null;
    const delta_x = second_point.x - first_point.x;
    const delta_z = second_point.z - first_point.z;
    const parameter = (delta_x * second_direction.z - delta_z * second_direction.x) / denominator;
    return .{
        .x = first_point.x + parameter * first_direction.x,
        .z = first_point.z + parameter * first_direction.z,
    };
}

const JunctionClassification = struct { kind: JunctionKind, miter_ratio: f32 };

fn classifyJunction(derived: *const topology.DerivedTopology, vertex: *const topology.DerivedVertex) JunctionClassification {
    const count = vertex.outgoing_half_edge_indices.len;
    if (count == 3) return .{ .kind = .tee, .miter_ratio = 0 };
    if (count >= 4) return .{ .kind = .cross, .miter_ratio = 0 };
    const first = derived.half_edges[vertex.outgoing_half_edge_indices[0]];
    const second = derived.half_edges[vertex.outgoing_half_edge_indices[1]];
    const first_direction = directionBetweenPoints(vertex.point, derived.vertices[first.target_vertex_index].point);
    const second_direction = directionBetweenPoints(vertex.point, derived.vertices[second.target_vertex_index].point);
    const dot = std.math.clamp(
        first_direction.x * second_direction.x + first_direction.z * second_direction.z,
        -1,
        1,
    );
    const sine_half = @sqrt(@max(@as(f32, 0), (1 - dot) / 2));
    const ratio = if (sine_half == 0) std.math.inf(f32) else 1 / sine_half;
    const limit: f32 = @floatCast(types.wall_tuning.miter_limit_ratio);
    return .{ .kind = if (ratio > limit) .bevel else .miter, .miter_ratio = ratio };
}

fn verticalQuad(start: PointXZ, end: PointXZ, bottom_y_m: f32, top_y_m: f32) [4]Point3Meters {
    return .{
        point3(start, bottom_y_m),
        point3(end, bottom_y_m),
        point3(end, top_y_m),
        point3(start, top_y_m),
    };
}

fn point3(point: PointXZ, y_m: f32) Point3Meters {
    return .{ .x = point.x, .y = y_m, .z = point.z };
}

fn directionBetween(start: *const types.WallVertex, end: *const types.WallVertex) Vector3 {
    return directionBetweenPoints(
        .{ .x_u = start.x_u, .z_u = start.z_u },
        .{ .x_u = end.x_u, .z_u = end.z_u },
    );
}

fn directionBetweenPoints(start: topology.Point, end: topology.Point) Vector3 {
    const delta_x: f32 = @floatFromInt(@as(i64, end.x_u) - @as(i64, start.x_u));
    const delta_z: f32 = @floatFromInt(@as(i64, end.z_u) - @as(i64, start.z_u));
    const length = @sqrt(delta_x * delta_x + delta_z * delta_z);
    return .{ .x = delta_x / length, .y = 0, .z = delta_z / length };
}

fn completeDistanceUnits(start: *const types.WallVertex, end: *const types.WallVertex) types.Unit {
    const delta_x: i64 = @as(i64, end.x_u) - @as(i64, start.x_u);
    const delta_z: i64 = @as(i64, end.z_u) - @as(i64, start.z_u);
    const squared: u64 = @intCast(delta_x * delta_x + delta_z * delta_z);
    return @intCast(floorSquareRoot(squared));
}

fn floorSquareRoot(value: u64) u64 {
    if (value == 0) return 0;
    var lower: u64 = 0;
    var upper: u64 = value + 1;
    while (lower + 1 < upper) {
        const middle = lower + (upper - lower) / 2;
        if (middle <= value / middle) lower = middle else upper = middle;
    }
    return lower;
}

fn findSourceVertex(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallVertex {
    for (source.walls.vertices) |*vertex| if (std.mem.eql(u8, vertex.id, id)) return vertex;
    return null;
}

fn findSourceEdge(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallEdge {
    for (source.walls.edges) |*edge| if (std.mem.eql(u8, edge.id, id)) return edge;
    return null;
}

fn findHalfEdgeIndex(derived: *const topology.DerivedTopology, edge_id: []const u8, side: types.WallSide) ?usize {
    for (derived.half_edges, 0..) |half_edge, index| {
        if (half_edge.source_side == side and std.mem.eql(u8, half_edge.source_edge_id, edge_id)) return index;
    }
    return null;
}

/// One uncovered vertical span of an endpoint's cross-section, absolute units.
const EndGap = struct { bottom_u: types.Unit, top_u: types.Unit };
/// Incident edges at one vertex bound the cover-span count; junctions are tiny.
const MAX_END_GAPS = 8;

/// Coverage decides end faces (req_4481): subtract every OTHER incident
/// edge's body interval from this edge's own [bottom, top] at the vertex and
/// return the exposed remainders. The same subtraction is the intended lane
/// for future coverers — a slab over a cap, an opening kit over a reveal:
/// candidate face minus covering bodies, emit what remains.
fn exposedEndGaps(
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    edge: *const types.WallEdge,
    vertex_id: []const u8,
    bottom_u: types.Unit,
    top_u: types.Unit,
    gaps: *[MAX_END_GAPS]EndGap,
) usize {
    var cover: [MAX_END_GAPS]EndGap = undefined;
    var cover_len: usize = 0;
    for (derived.vertices) |vertex| {
        if (!std.mem.eql(u8, vertex.source_vertex_id, vertex_id)) continue;
        for (vertex.outgoing_half_edge_indices) |half_edge_index| {
            const other_id = derived.half_edges[half_edge_index].source_edge_id;
            if (std.mem.eql(u8, other_id, edge.id)) continue;
            const other = findSourceEdge(source, other_id) orelse continue;
            const other_bottom = switch (other.support) {
                .absolute => |support| support.base_y_u,
                .slab => continue,
            };
            if (cover_len >= cover.len) break;
            cover[cover_len] = .{ .bottom_u = other_bottom, .top_u = other_bottom + other.height_u };
            cover_len += 1;
        }
        break;
    }
    var index: usize = 1;
    while (index < cover_len) : (index += 1) {
        const held = cover[index];
        var slot = index;
        while (slot > 0 and cover[slot - 1].bottom_u > held.bottom_u) : (slot -= 1) cover[slot] = cover[slot - 1];
        cover[slot] = held;
    }
    var count: usize = 0;
    var cursor = bottom_u;
    for (cover[0..cover_len]) |span| {
        if (cursor >= top_u) break;
        const lo = @max(span.bottom_u, bottom_u);
        const hi = @min(span.top_u, top_u);
        if (hi <= cursor) continue;
        if (lo > cursor and count < gaps.len) {
            gaps[count] = .{ .bottom_u = cursor, .top_u = @min(lo, top_u) };
            count += 1;
        }
        cursor = @max(cursor, hi);
    }
    if (cursor < top_u and count < gaps.len) {
        gaps[count] = .{ .bottom_u = cursor, .top_u = top_u };
        count += 1;
    }
    return count;
}

fn ownedSurfaceBand(
    allocator: std.mem.Allocator,
    edge_id: []const u8,
    opening_id: ?[]const u8,
    role: SurfaceRole,
    side: ?types.WallSide,
    material_id: []const u8,
    column_scale_m_per_u: f32,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    quad_m: [4]Point3Meters,
    normal: Vector3,
) std.mem.Allocator.Error!SurfaceBand {
    const owned_edge_id = try allocator.dupe(u8, edge_id);
    errdefer allocator.free(owned_edge_id);
    const owned_opening_id = if (opening_id) |value| try allocator.dupe(u8, value) else null;
    errdefer if (owned_opening_id) |value| allocator.free(value);
    const owned_material_id = try allocator.dupe(u8, material_id);
    errdefer allocator.free(owned_material_id);
    return .{
        .edge_id = owned_edge_id,
        .opening_id = owned_opening_id,
        .role = role,
        .side = side,
        .material_id = owned_material_id,
        .column_start_u = column_start_u,
        .column_end_u = column_end_u,
        .row_bottom_u = row_bottom_u,
        .row_top_u = row_top_u,
        .quad_m = quad_m,
        .normal = normal,
        // Texture space is the AUTHORED PIECE, not the band (req_4485): when
        // openings or coverage split a face into many bands, each band maps
        // only the sub-rectangle of the edge-span UV space it occupies, so a
        // texture stays spread over the whole piece distance across every
        // cut. The column axis scales by the edge's true metric length so
        // angled walls keep exact texture density (the pre-existing metric
        // contract). Opening-frame strips (reveal/jamb/sill/header/pane) are
        // kit-owned local surfaces and keep band-local metric UVs.
        .uv_m = switch (role) {
            .face => spanQuadUv(column_scale_m_per_u, column_start_u, column_end_u, row_bottom_u, row_top_u),
            .cap => capQuadUv(column_scale_m_per_u, column_start_u, column_end_u, quad_m),
            .end => endQuadUv(row_bottom_u, row_top_u, quad_m),
            else => metricQuadUv(quad_m),
        },
    };
}

fn spanColumnMeters(column_scale_m_per_u: f32, column_u: types.Unit) f32 {
    return column_scale_m_per_u * @as(f32, @floatFromInt(column_u));
}

/// Face bands: u = metric meters along the authored edge span, v = meters up
/// the wall's row space. Corners follow verticalQuad order (start-bottom,
/// end-bottom, end-top, start-top).
fn spanQuadUv(
    column_scale_m_per_u: f32,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
) [4]Point2Meters {
    const u_start = spanColumnMeters(column_scale_m_per_u, column_start_u);
    const u_end = spanColumnMeters(column_scale_m_per_u, column_end_u);
    const v_bottom = architecture_scale.unitsToMeters(row_bottom_u);
    const v_top = architecture_scale.unitsToMeters(row_top_u);
    return .{
        .{ .u = u_start, .v = v_bottom },
        .{ .u = u_end, .v = v_bottom },
        .{ .u = u_end, .v = v_top },
        .{ .u = u_start, .v = v_top },
    };
}

/// Caps run the same column axis as faces; u anchors to the edge span so
/// future coverage splits stay continuous, v stays thickness-local.
fn capQuadUv(
    column_scale_m_per_u: f32,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    quad_m: [4]Point3Meters,
) [4]Point2Meters {
    const u_start = spanColumnMeters(column_scale_m_per_u, column_start_u);
    const u_end = spanColumnMeters(column_scale_m_per_u, column_end_u);
    const thickness_m = pointDistance(quad_m[1], quad_m[2]);
    return .{
        .{ .u = u_start, .v = 0 },
        .{ .u = u_end, .v = 0 },
        .{ .u = u_end, .v = thickness_m },
        .{ .u = u_start, .v = thickness_m },
    };
}

/// End cross-sections anchor v to the wall's row space (step junctions expose
/// partial heights); u stays thickness-local.
fn endQuadUv(
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    quad_m: [4]Point3Meters,
) [4]Point2Meters {
    const width_m = pointDistance(quad_m[0], quad_m[1]);
    const v_bottom = architecture_scale.unitsToMeters(row_bottom_u);
    const v_top = architecture_scale.unitsToMeters(row_top_u);
    return .{
        .{ .u = 0, .v = v_bottom },
        .{ .u = width_m, .v = v_bottom },
        .{ .u = width_m, .v = v_top },
        .{ .u = 0, .v = v_top },
    };
}

fn ownedPickProxy(
    allocator: std.mem.Allocator,
    edge_id: []const u8,
    opening_id: ?[]const u8,
    kind: PickKind,
    side: ?types.WallSide,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
    quad_m: [4]Point3Meters,
    normal: Vector3,
) std.mem.Allocator.Error!PickProxy {
    const owned_edge_id = try allocator.dupe(u8, edge_id);
    errdefer allocator.free(owned_edge_id);
    const owned_opening_id = if (opening_id) |value| try allocator.dupe(u8, value) else null;
    errdefer if (owned_opening_id) |value| allocator.free(value);
    return .{
        .edge_id = owned_edge_id,
        .opening_id = owned_opening_id,
        .kind = kind,
        .side = side,
        .column_start_u = column_start_u,
        .column_end_u = column_end_u,
        .row_bottom_u = row_bottom_u,
        .row_top_u = row_top_u,
        .quad_m = quad_m,
        .normal = normal,
    };
}

fn ownedTraversalInterval(
    allocator: std.mem.Allocator,
    edge_id: []const u8,
    opening_id: []const u8,
    rect: OpeningRect,
    portal_class: types.PortalClass,
) std.mem.Allocator.Error!TraversalInterval {
    const owned_edge_id = try allocator.dupe(u8, edge_id);
    errdefer allocator.free(owned_edge_id);
    const owned_opening_id = try allocator.dupe(u8, opening_id);
    errdefer allocator.free(owned_opening_id);
    return .{
        .edge_id = owned_edge_id,
        .opening_id = owned_opening_id,
        .column_start_u = rect.left_u,
        .column_end_u = rect.right_u,
        .row_bottom_u = rect.bottom_u,
        .row_top_u = rect.top_u,
        .portal_class = portal_class,
    };
}

fn ownedSolidBand(
    allocator: std.mem.Allocator,
    edge_id: []const u8,
    opening_id: ?[]const u8,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
) std.mem.Allocator.Error!SolidBand {
    const owned_edge_id = try allocator.dupe(u8, edge_id);
    errdefer allocator.free(owned_edge_id);
    const owned_opening_id = if (opening_id) |value| try allocator.dupe(u8, value) else null;
    errdefer if (owned_opening_id) |value| allocator.free(value);
    return .{
        .edge_id = owned_edge_id,
        .opening_id = owned_opening_id,
        .column_start_u = column_start_u,
        .column_end_u = column_end_u,
        .row_bottom_u = row_bottom_u,
        .row_top_u = row_top_u,
    };
}

fn ownedDoorFrame(
    allocator: std.mem.Allocator,
    edge_id: []const u8,
    rect: OpeningRect,
    origin_m: Point3Meters,
    tangent: Vector3,
    outward: Vector3,
) std.mem.Allocator.Error!DoorAttachmentFrame {
    const owned_edge_id = try allocator.dupe(u8, edge_id);
    errdefer allocator.free(owned_edge_id);
    const owned_opening_id = try allocator.dupe(u8, rect.opening.id);
    errdefer allocator.free(owned_opening_id);
    const owned_kit_id = try allocator.dupe(u8, rect.opening.kit_id);
    errdefer allocator.free(owned_kit_id);
    return .{
        .edge_id = owned_edge_id,
        .opening_id = owned_opening_id,
        .kit_id = owned_kit_id,
        .origin_m = origin_m,
        .tangent = tangent,
        .outward = outward,
        .up = .{ .x = 0, .y = 1, .z = 0 },
        .facing_side = rect.opening.facing_side,
        .hinge = rect.opening.hinge,
    };
}

fn metricQuadUv(quad_m: [4]Point3Meters) [4]Point2Meters {
    const width_m = pointDistance(quad_m[0], quad_m[1]);
    const height_m = pointDistance(quad_m[1], quad_m[2]);
    return .{
        .{ .u = 0, .v = 0 },
        .{ .u = width_m, .v = 0 },
        .{ .u = width_m, .v = height_m },
        .{ .u = 0, .v = height_m },
    };
}

fn pointDistance(a: Point3Meters, b: Point3Meters) f32 {
    const delta_x = b.x - a.x;
    const delta_y = b.y - a.y;
    const delta_z = b.z - a.z;
    return @sqrt(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z);
}

const GeometryBuilder = struct {
    allocator: std.mem.Allocator,
    surfaces: std.ArrayList(SurfaceBand) = .empty,
    colliders: std.ArrayList(SolidBand) = .empty,
    cover: std.ArrayList(SolidBand) = .empty,
    navigation_blockers: std.ArrayList(SolidBand) = .empty,
    sound_occluders: std.ArrayList(SolidBand) = .empty,
    sightline_occluders: std.ArrayList(SolidBand) = .empty,
    traversal: std.ArrayList(TraversalInterval) = .empty,
    door_frames: std.ArrayList(DoorAttachmentFrame) = .empty,
    pick_proxies: std.ArrayList(PickProxy) = .empty,
    junctions: std.ArrayList(JunctionPatch) = .empty,

    fn init(allocator: std.mem.Allocator) GeometryBuilder {
        return .{ .allocator = allocator };
    }

    fn deinit(self: *GeometryBuilder) void {
        deinitList(SurfaceBand, self.allocator, &self.surfaces);
        deinitList(SolidBand, self.allocator, &self.colliders);
        deinitList(SolidBand, self.allocator, &self.cover);
        deinitList(SolidBand, self.allocator, &self.navigation_blockers);
        deinitList(SolidBand, self.allocator, &self.sound_occluders);
        deinitList(SolidBand, self.allocator, &self.sightline_occluders);
        deinitList(TraversalInterval, self.allocator, &self.traversal);
        deinitList(DoorAttachmentFrame, self.allocator, &self.door_frames);
        deinitList(PickProxy, self.allocator, &self.pick_proxies);
        deinitList(JunctionPatch, self.allocator, &self.junctions);
        self.* = undefined;
    }

    fn appendSurface(self: *GeometryBuilder, value: SurfaceBand) std.mem.Allocator.Error!void {
        var owned = value;
        errdefer owned.deinit(self.allocator);
        try self.surfaces.append(self.allocator, owned);
    }

    fn appendPick(self: *GeometryBuilder, value: PickProxy) std.mem.Allocator.Error!void {
        var owned = value;
        errdefer owned.deinit(self.allocator);
        try self.pick_proxies.append(self.allocator, owned);
    }

    fn appendJunction(self: *GeometryBuilder, value: JunctionPatch) std.mem.Allocator.Error!void {
        var owned = value;
        errdefer owned.deinit(self.allocator);
        try self.junctions.append(self.allocator, owned);
    }

    fn appendTraversal(self: *GeometryBuilder, value: TraversalInterval) std.mem.Allocator.Error!void {
        var owned = value;
        errdefer owned.deinit(self.allocator);
        try self.traversal.append(self.allocator, owned);
    }

    fn appendDoorFrame(self: *GeometryBuilder, value: DoorAttachmentFrame) std.mem.Allocator.Error!void {
        var owned = value;
        errdefer owned.deinit(self.allocator);
        try self.door_frames.append(self.allocator, owned);
    }

    fn appendSolidPartition(
        self: *GeometryBuilder,
        edge_id: []const u8,
        opening_id: ?[]const u8,
        column_start_u: types.Unit,
        column_end_u: types.Unit,
        row_bottom_u: types.Unit,
        row_top_u: types.Unit,
    ) std.mem.Allocator.Error!void {
        try self.appendSolid(&self.colliders, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.cover, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.navigation_blockers, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.sound_occluders, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.sightline_occluders, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
    }

    fn appendOpeningBlocker(
        self: *GeometryBuilder,
        edge_id: []const u8,
        opening_id: []const u8,
        column_start_u: types.Unit,
        column_end_u: types.Unit,
        row_bottom_u: types.Unit,
        row_top_u: types.Unit,
    ) std.mem.Allocator.Error!void {
        try self.appendSolid(&self.colliders, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.navigation_blockers, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.sound_occluders, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
        try self.appendSolid(&self.sightline_occluders, try ownedSolidBand(self.allocator, edge_id, opening_id, column_start_u, column_end_u, row_bottom_u, row_top_u));
    }

    fn appendSolid(
        self: *GeometryBuilder,
        list: *std.ArrayList(SolidBand),
        value: SolidBand,
    ) std.mem.Allocator.Error!void {
        var owned = value;
        errdefer owned.deinit(self.allocator);
        try list.append(self.allocator, owned);
    }

    fn take(self: *GeometryBuilder) std.mem.Allocator.Error!GeometryBundle {
        const surfaces = try self.surfaces.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(SurfaceBand, self.allocator, surfaces);
        const colliders = try self.colliders.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(SolidBand, self.allocator, colliders);
        const cover = try self.cover.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(SolidBand, self.allocator, cover);
        const navigation_blockers = try self.navigation_blockers.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(SolidBand, self.allocator, navigation_blockers);
        const sound_occluders = try self.sound_occluders.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(SolidBand, self.allocator, sound_occluders);
        const sightline_occluders = try self.sightline_occluders.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(SolidBand, self.allocator, sightline_occluders);
        const traversal = try self.traversal.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(TraversalInterval, self.allocator, traversal);
        const door_frames = try self.door_frames.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(DoorAttachmentFrame, self.allocator, door_frames);
        const pick_proxies = try self.pick_proxies.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(PickProxy, self.allocator, pick_proxies);
        const junctions = try self.junctions.toOwnedSlice(self.allocator);
        errdefer deinitOwnedSlice(JunctionPatch, self.allocator, junctions);
        return .{
            .surfaces = surfaces,
            .colliders = colliders,
            .cover = cover,
            .navigation_blockers = navigation_blockers,
            .sound_occluders = sound_occluders,
            .sightline_occluders = sightline_occluders,
            .traversal = traversal,
            .door_frames = door_frames,
            .pick_proxies = pick_proxies,
            .junctions = junctions,
        };
    }
};

fn deinitList(comptime T: type, allocator: std.mem.Allocator, list: *std.ArrayList(T)) void {
    for (list.items) |*value| value.deinit(allocator);
    list.deinit(allocator);
}

fn freeBytes(allocator: std.mem.Allocator, bytes: []u8) void {
    if (bytes.len != 0) allocator.free(bytes);
}

fn deinitOwnedSlice(comptime T: type, allocator: std.mem.Allocator, values: []T) void {
    for (values) |*value| value.deinit(allocator);
    if (values.len != 0) allocator.free(values);
}
