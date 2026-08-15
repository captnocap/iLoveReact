//! Atomic semantic wall mutation.
//!
//! `applyCommand` is the only mutation entry point. Endpoint reuse, splitting,
//! opening redistribution, patch construction, and inverse construction stay
//! private so no caller can assemble a partial architectural edit.

const std = @import("std");
const types = @import("wall_types");
const catalog = @import("building_catalog");
const topology = @import("wall_topology");

const maximum_generated_index_digits: usize = 7;
const generated_id_separator_bytes: usize = 3;
const maximum_command_id_bytes = types.Limits.maximum_id_bytes -
    maximum_generated_index_digits - generated_id_separator_bytes;

pub const CommandPoint2 = struct {
    x_u: f64,
    z_u: f64,
};

pub const CommandSupport = union(enum) {
    absolute: struct { base_y_u: f64 },
    slab: struct { slab_id: []const u8, join: types.SlabJoin },
};

pub const DrawWall = struct {
    floor: i32,
    start: CommandPoint2,
    end: CommandPoint2,
    start_magnet_vertex_id: ?[]const u8 = null,
    end_magnet_vertex_id: ?[]const u8 = null,
    support: CommandSupport,
    height_u: f64,
    thickness_u: f64,
    profile: types.WallProfile,
    style_id: []const u8,
    side_a_material_id: []const u8,
    side_b_material_id: []const u8,
};

pub const SetEdgeDimensions = struct {
    edge_id: []const u8,
    support: CommandSupport,
    height_u: f64,
    thickness_u: f64,
};

pub const ConfigureOpening = struct {
    opening_id: []const u8,
    kind: types.WallOpeningKind,
    kit_id: []const u8,
    column_u: f64,
    row_u: f64,
    facing_side: types.WallSide,
    hinge: types.WallHinge,
};

pub const MoveOpening = struct {
    opening_id: []const u8,
    column_u: f64,
    row_u: f64,
};

pub const Operation = union(enum) {
    draw_wall: DrawWall,
    delete_edge: struct { edge_id: []const u8 },
    delete_vertex: struct { vertex_id: []const u8 },
    set_edge_dimensions: SetEdgeDimensions,
    set_profile: struct { edge_id: []const u8, profile: types.WallProfile },
    set_style: struct { edge_id: []const u8, style_id: []const u8 },
    set_side_finish: struct {
        edge_id: []const u8,
        side: types.WallSide,
        material_id: []const u8,
    },
    insert_opening: struct { edge_id: []const u8, opening: ConfigureOpening },
    move_opening: MoveOpening,
    delete_opening: struct { opening_id: []const u8 },
    configure_opening: ConfigureOpening,
    attach_anchor: struct {
        edge_id: []const u8,
        side: types.WallSide,
        column_u: f64,
        row_u: f64,
        target_piece_id: []const u8,
    },
    detach_anchor: struct { anchor_id: []const u8 },
    stamp_prefab: struct { canonical_prefab_bytes: []const u8 },
    apply_patch: *const types.ArchitecturePatch,
};

pub const Command = struct {
    command_id: []const u8,
    expected_revision: u32,
    operation: Operation,
};

pub const OpeningSlot = struct {
    column_u: types.Unit,
    row_u: types.Unit,
};

pub const OpeningSlots = struct {
    values: []OpeningSlot,

    pub fn deinit(self: *OpeningSlots, allocator: std.mem.Allocator) void {
        if (self.values.len != 0) allocator.free(self.values);
        self.* = undefined;
    }
};

pub const ApplyError = std.mem.Allocator.Error || error{
    mutation_operation_not_implemented,
    opening_query_invalid_source,
    opening_query_invalid_catalog,
    opening_query_unknown_edge,
    opening_query_unknown_kit,
    opening_query_limit_exceeded,
};

/// Apply one complete command or return one complete rejection. The source is
/// mutated only after candidate validation and receipt construction both succeed.
pub fn applyCommand(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
) ApplyError!types.MutationResult {
    if (command.expected_revision != source.revision) {
        return .{ .rejection = try ownedRejectionAtRevision(
            allocator,
            command,
            .stale_source_revision,
            &.{},
            "the command revision does not match the architecture source",
            source.revision,
        ) };
    }

    switch (command.operation) {
        .draw_wall => |draw| return applyDrawWall(allocator, source, entries, command, draw),
        .insert_opening => |value| return applyInsertOpening(allocator, source, entries, command, value.edge_id, value.opening),
        .move_opening => |value| return applyMoveOpening(allocator, source, entries, command, value),
        .delete_opening => |value| return applyDeleteOpening(allocator, source, entries, command, value.opening_id),
        .configure_opening => |value| return applyConfigureOpening(allocator, source, entries, command, value),
        .set_edge_dimensions => |value| return applyEdgeDimensions(allocator, source, entries, command, value),
        .set_profile => |value| return applyEdgeProfile(allocator, source, entries, command, value.edge_id, value.profile),
        .set_style => |value| return applyEdgeStyle(allocator, source, entries, command, value.edge_id, value.style_id),
        .set_side_finish => |value| return applySideFinish(allocator, source, entries, command, value.edge_id, value.side, value.material_id),
        .delete_edge => |value| return applyDeleteRecords(allocator, source, entries, command, .{ .edge_id = value.edge_id }),
        .delete_vertex => |value| return applyDeleteRecords(allocator, source, entries, command, .{ .vertex_id = value.vertex_id }),
        .attach_anchor => |value| return applyAttachAnchor(allocator, source, entries, command, value),
        .detach_anchor => |value| return applyDetachAnchor(allocator, source, entries, command, value.anchor_id),
        .apply_patch => |patch| return applyArchitecturePatch(allocator, source, entries, command, patch),
        else => return error.mutation_operation_not_implemented,
    }
}

pub fn openingSlots(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    edge_id: []const u8,
    kit_id: []const u8,
) ApplyError!OpeningSlots {
    types.validateSourceStructure(allocator, source) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.opening_query_invalid_source,
    };
    catalog.validateSourceCatalogReferences(allocator, source, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.opening_query_invalid_catalog,
    };
    const edge = findEdgeById(source, edge_id) orelse return error.opening_query_unknown_edge;
    const kit = findCatalogEntry(entries, kit_id) orelse return error.opening_query_unknown_kit;
    if (!isOpeningKit(kit)) return error.opening_query_unknown_kit;

    const column_count = completeEdgeLengthUnits(source, edge);
    const footprint = kit.measurement.footprint.?;
    const minimum_column: i64 = -@as(i64, footprint.min_column);
    const maximum_column: i64 = @as(i64, column_count) - footprint.max_column_exclusive;
    const minimum_row: i64 = -@as(i64, footprint.min_row);
    const maximum_row: i64 = @as(i64, edge.height_u) - footprint.max_row_exclusive;
    if (!openingKitCompatibleWithEdge(edge, kit) or
        minimum_column > maximum_column or minimum_row > maximum_row)
    {
        return .{ .values = try allocator.alloc(OpeningSlot, 0) };
    }

    var values: std.ArrayList(OpeningSlot) = .empty;
    defer values.deinit(allocator);
    var row = minimum_row;
    while (row <= maximum_row) : (row += 1) {
        var column = minimum_column;
        while (column <= maximum_column) : (column += 1) {
            const proposed = OpeningPlacement{
                .kind = openingKind(kit).?,
                .kit_id = kit.catalog_id,
                .column_u = @intCast(column),
                .row_u = @intCast(row),
                .facing_side = .a,
                .hinge = .none,
            };
            if (openingCollisionCode(entries, edge, proposed, null) != null) continue;
            if (values.items.len == types.Limits.maximum_output_rows) {
                return error.opening_query_limit_exceeded;
            }
            try values.append(allocator, .{ .column_u = @intCast(column), .row_u = @intCast(row) });
        }
    }
    return .{ .values = try values.toOwnedSlice(allocator) };
}

const OpeningPlacement = struct {
    kind: types.WallOpeningKind,
    kit_id: []const u8,
    column_u: types.Unit,
    row_u: types.Unit,
    facing_side: types.WallSide,
    hinge: types.WallHinge,
};

const OpeningChangeKind = enum { insert, update, delete };
const AnchorChangeKind = enum { insert, delete };

const OpeningChange = union(OpeningChangeKind) {
    insert: struct { edge_id: []const u8, config: ConfigureOpening },
    update: struct { config: ConfigureOpening },
    delete: struct { opening_id: []const u8 },
};

fn applyInsertOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    edge_id: []const u8,
    config: ConfigureOpening,
) ApplyError!types.MutationResult {
    return applyOpeningChange(allocator, source, entries, command, .{ .insert = .{
        .edge_id = edge_id,
        .config = config,
    } });
}

fn applyMoveOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    move: MoveOpening,
) ApplyError!types.MutationResult {
    const located = findOpeningById(source, move.opening_id) orelse return makeRejection(
        allocator,
        command,
        .invalid_source,
        &.{move.opening_id},
        "the opening to move does not exist",
    );
    return applyOpeningChange(allocator, source, entries, command, .{ .update = .{ .config = .{
        .opening_id = move.opening_id,
        .kind = located.opening.kind,
        .kit_id = located.opening.kit_id,
        .column_u = move.column_u,
        .row_u = move.row_u,
        .facing_side = located.opening.facing_side,
        .hinge = located.opening.hinge,
    } } });
}

fn applyConfigureOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    config: ConfigureOpening,
) ApplyError!types.MutationResult {
    return applyOpeningChange(allocator, source, entries, command, .{ .update = .{ .config = config } });
}

fn applyDeleteOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    opening_id: []const u8,
) ApplyError!types.MutationResult {
    return applyOpeningChange(allocator, source, entries, command, .{ .delete = .{ .opening_id = opening_id } });
}

fn applyOpeningChange(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    change: OpeningChange,
) ApplyError!types.MutationResult {
    if (try openingBoundaryRejection(allocator, source, entries, command)) |rejection| {
        return .{ .rejection = rejection };
    }

    var edge_id: []const u8 = undefined;
    var opening_id: []const u8 = undefined;
    var placement: ?OpeningPlacement = null;
    const change_kind: OpeningChangeKind = std.meta.activeTag(change);
    switch (change) {
        .insert => |insert| {
            edge_id = insert.edge_id;
            opening_id = insert.config.opening_id;
            if (!validId(edge_id) or !validId(opening_id)) {
                return makeRejection(allocator, command, .invalid_source, &.{}, "opening identifiers are invalid");
            }
            const expected_id = try generatedId(allocator, command.command_id, "o", 0);
            defer allocator.free(expected_id);
            if (!std.mem.eql(u8, opening_id, expected_id) or sourceContainsId(source, opening_id)) {
                return makeRejection(
                    allocator,
                    command,
                    .duplicate_command_id,
                    &.{opening_id},
                    "opening insertion requires one unused command-derived ID",
                );
            }
            const placement_result = try placementFromConfig(allocator, command, insert.config);
            switch (placement_result) {
                .placement => |value| placement = value,
                .rejection => |rejection| return .{ .rejection = rejection },
            }
        },
        .update => |update| {
            opening_id = update.config.opening_id;
            const located = findOpeningById(source, opening_id) orelse return makeRejection(
                allocator,
                command,
                .invalid_source,
                &.{opening_id},
                "the opening to configure does not exist",
            );
            edge_id = located.edge_id;
            const placement_result = try placementFromConfig(allocator, command, update.config);
            switch (placement_result) {
                .placement => |value| placement = value,
                .rejection => |rejection| return .{ .rejection = rejection },
            }
        },
        .delete => |delete| {
            opening_id = delete.opening_id;
            const located = findOpeningById(source, opening_id) orelse return makeRejection(
                allocator,
                command,
                .invalid_source,
                &.{opening_id},
                "the opening to delete does not exist",
            );
            edge_id = located.edge_id;
        },
    }

    const edge = findEdgeById(source, edge_id) orelse return makeRejection(
        allocator,
        command,
        .invalid_source,
        &.{edge_id},
        "the opening edge does not exist",
    );
    if (placement) |value| {
        if (try openingPlacementRejection(
            allocator,
            command,
            entries,
            source,
            edge,
            value,
            if (change_kind == .update) opening_id else null,
        )) |rejection| return .{ .rejection = rejection };
    }

    const revision_after = std.math.add(u32, source.revision, 1) catch return makeRejection(
        allocator,
        command,
        .limit_exceeded,
        &.{},
        "the architecture source revision cannot advance",
    );
    var candidate = try cloneSourceWithDraw(allocator, source, &.{}, &.{}, &.{}, &.{}, revision_after);
    errdefer candidate.deinit(allocator);
    switch (change_kind) {
        .insert => try insertOwnedOpening(allocator, &candidate, edge_id, opening_id, placement.?),
        .update => try updateOwnedOpening(allocator, &candidate, opening_id, placement.?),
        .delete => try deleteOwnedOpening(allocator, &candidate, opening_id),
    }
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_source, &.{opening_id}, "opening mutation produced an invalid source"),
    };
    catalog.validateSourceCatalogReferences(allocator, &candidate, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_catalog, &.{opening_id}, "opening mutation is incompatible with the catalog"),
    };

    const receipt = try buildOpeningReceipt(
        allocator,
        source,
        &candidate,
        command,
        edge_id,
        opening_id,
        change_kind,
    );
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

const PlacementResult = union(enum) {
    placement: OpeningPlacement,
    rejection: types.MutationRejection,
};

fn placementFromConfig(
    allocator: std.mem.Allocator,
    command: Command,
    config: ConfigureOpening,
) std.mem.Allocator.Error!PlacementResult {
    const column_u = types.validateStructuralNumber(config.column_u) catch |err| return .{
        .rejection = (try structuralNumberRejection(allocator, command, err)).rejection,
    };
    const row_u = types.validateStructuralNumber(config.row_u) catch |err| return .{
        .rejection = (try structuralNumberRejection(allocator, command, err)).rejection,
    };
    return .{ .placement = .{
        .kind = config.kind,
        .kit_id = config.kit_id,
        .column_u = column_u,
        .row_u = row_u,
        .facing_side = config.facing_side,
        .hinge = config.hinge,
    } };
}

fn openingBoundaryRejection(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
) std.mem.Allocator.Error!?types.MutationRejection {
    types.validateSourceStructure(allocator, source) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return try ownedRejection(allocator, command, .invalid_source, &.{}, "the architecture source is structurally invalid"),
    };
    catalog.validateSourceCatalogReferences(allocator, source, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.unknown_wall_style, error.unknown_opening_kit => return try ownedRejection(
            allocator,
            command,
            .unknown_catalog_id,
            &.{},
            "the architecture source references an unknown catalog entry",
        ),
        else => return try ownedRejection(allocator, command, .invalid_catalog, &.{}, "the catalog is invalid"),
    };
    return null;
}

fn openingPlacementRejection(
    allocator: std.mem.Allocator,
    command: Command,
    entries: []const catalog.CatalogEntry,
    source: *const types.ArchitectureSource,
    edge: *const types.WallEdge,
    placement: OpeningPlacement,
    excluded_opening_id: ?[]const u8,
) std.mem.Allocator.Error!?types.MutationRejection {
    if (!validId(placement.kit_id)) {
        return try ownedRejection(allocator, command, .unknown_catalog_id, &.{placement.kit_id}, "the opening kit ID is invalid");
    }
    const kit = findCatalogEntry(entries, placement.kit_id) orelse return try ownedRejection(
        allocator,
        command,
        .unknown_catalog_id,
        &.{placement.kit_id},
        "the opening kit does not exist",
    );
    if (!isOpeningKit(kit) or openingKind(kit).? != placement.kind) {
        return try ownedRejection(
            allocator,
            command,
            .invalid_catalog,
            &.{placement.kit_id},
            "the catalog entry is not the requested typed wall opening kind",
        );
    }
    const compatibility = kit.wall_opening_compatibility.?;
    if (std.mem.indexOfScalar(types.WallProfile, compatibility.permitted_profiles, edge.profile) == null) {
        return try ownedRejection(
            allocator,
            command,
            .opening_incompatible_profile,
            &.{ edge.id, placement.kit_id },
            "the measured opening kit does not permit this wall profile",
        );
    }
    if (std.mem.indexOfScalar(types.Unit, compatibility.permitted_thickness_u, edge.thickness_u) == null) {
        return try ownedRejection(
            allocator,
            command,
            .opening_incompatible_thickness,
            &.{ edge.id, placement.kit_id },
            "the measured opening kit does not permit this wall thickness",
        );
    }
    const footprint = kit.measurement.footprint.?;
    if (footprint.height() > edge.height_u) {
        return try ownedRejection(
            allocator,
            command,
            .opening_incompatible_height,
            &.{ edge.id, placement.kit_id },
            "the measured opening kit is taller than the wall",
        );
    }
    const edge_columns = completeEdgeLengthUnits(source, edge);
    const minimum_column = @as(i64, placement.column_u) + footprint.min_column;
    const maximum_column = @as(i64, placement.column_u) + footprint.max_column_exclusive;
    const minimum_row = @as(i64, placement.row_u) + footprint.min_row;
    const maximum_row = @as(i64, placement.row_u) + footprint.max_row_exclusive;
    if (minimum_column < 0 or maximum_column > edge_columns or
        minimum_row < 0 or maximum_row > edge.height_u)
    {
        return try ownedRejection(
            allocator,
            command,
            .opening_out_of_bounds,
            &.{ edge.id, placement.kit_id },
            "the measured opening footprint does not fit inside the wall surface",
        );
    }
    if (openingCollisionCode(entries, edge, placement, excluded_opening_id)) |code| {
        const detail = switch (code) {
            .opening_occupied_collision => "the opening occupied mask intersects another opening",
            .opening_clearance_collision => "the opening required-clear mask intersects another opening",
            else => unreachable,
        };
        return try ownedRejection(allocator, command, code, &.{ edge.id, placement.kit_id }, detail);
    }
    return null;
}

fn isOpeningKit(entry: *const catalog.CatalogEntry) bool {
    return entry.family == .wall and entry.role == .opening and openingKind(entry) != null;
}

fn openingKind(entry: *const catalog.CatalogEntry) ?types.WallOpeningKind {
    const semantic = entry.semantic_kind orelse return null;
    return switch (semantic) {
        .wall_opening => |kind| kind,
        else => null,
    };
}

fn openingKitCompatibleWithEdge(edge: *const types.WallEdge, kit: *const catalog.CatalogEntry) bool {
    const compatibility = kit.wall_opening_compatibility.?;
    return std.mem.indexOfScalar(types.WallProfile, compatibility.permitted_profiles, edge.profile) != null and
        std.mem.indexOfScalar(types.Unit, compatibility.permitted_thickness_u, edge.thickness_u) != null and
        kit.measurement.footprint.?.height() <= edge.height_u;
}

fn completeEdgeLengthUnits(source: *const types.ArchitectureSource, edge: *const types.WallEdge) types.Unit {
    const start = findVertexById(source, edge.start_vertex_id).?;
    const end = findVertexById(source, edge.end_vertex_id).?;
    return completeDistanceUnits(
        .{ .x_u = start.x_u, .z_u = start.z_u },
        .{ .x_u = end.x_u, .z_u = end.z_u },
    );
}

const CellMaskView = struct {
    origin_column_u: types.Unit,
    origin_row_u: types.Unit,
    footprint: catalog.Footprint,
    cells: []const types.WallCell,
    complete_footprint: bool,
};

const WorldCell = struct {
    column_u: i64,
    row_u: i64,
};

fn openingCollisionCode(
    entries: []const catalog.CatalogEntry,
    edge: *const types.WallEdge,
    proposed: OpeningPlacement,
    excluded_opening_id: ?[]const u8,
) ?types.ArchitectureRejectionCode {
    const proposed_kit = findCatalogEntry(entries, proposed.kit_id).?;
    const proposed_occupied = occupiedView(proposed_kit, proposed.column_u, proposed.row_u);
    const proposed_clearance = clearanceView(proposed_kit, proposed.column_u, proposed.row_u);
    for (edge.openings) |existing| {
        if (excluded_opening_id) |excluded| {
            if (std.mem.eql(u8, existing.id, excluded)) continue;
        }
        const existing_kit = findCatalogEntry(entries, existing.kit_id).?;
        const existing_occupied = occupiedView(existing_kit, existing.column_u, existing.row_u);
        const existing_clearance = clearanceView(existing_kit, existing.column_u, existing.row_u);
        if (maskViewsOverlap(proposed_occupied, existing_occupied)) return .opening_occupied_collision;
        if (maskViewsOverlap(proposed_occupied, existing_clearance) or
            maskViewsOverlap(proposed_clearance, existing_occupied))
        {
            return .opening_clearance_collision;
        }
    }
    return null;
}

fn occupiedView(entry: *const catalog.CatalogEntry, column_u: types.Unit, row_u: types.Unit) CellMaskView {
    return .{
        .origin_column_u = column_u,
        .origin_row_u = row_u,
        .footprint = entry.measurement.footprint.?,
        .cells = entry.measurement.occupied_mask,
        .complete_footprint = entry.measurement.occupied_mask.len == 0,
    };
}

fn clearanceView(entry: *const catalog.CatalogEntry, column_u: types.Unit, row_u: types.Unit) CellMaskView {
    return .{
        .origin_column_u = column_u,
        .origin_row_u = row_u,
        .footprint = entry.measurement.footprint.?,
        .cells = entry.measurement.clearance_mask,
        .complete_footprint = false,
    };
}

fn maskViewsOverlap(left: CellMaskView, right: CellMaskView) bool {
    if (!left.complete_footprint and left.cells.len == 0) return false;
    if (!right.complete_footprint and right.cells.len == 0) return false;
    if (left.complete_footprint and right.complete_footprint) return footprintViewsOverlap(left, right);
    if (left.complete_footprint) {
        for (right.cells) |cell| if (viewContainsWorldCell(left, worldCell(right, cell))) return true;
        return false;
    }
    if (right.complete_footprint) {
        for (left.cells) |cell| if (viewContainsWorldCell(right, worldCell(left, cell))) return true;
        return false;
    }
    for (left.cells) |left_cell| {
        const world_left = worldCell(left, left_cell);
        for (right.cells) |right_cell| {
            if (std.meta.eql(world_left, worldCell(right, right_cell))) return true;
        }
    }
    return false;
}

fn footprintViewsOverlap(left: CellMaskView, right: CellMaskView) bool {
    const left_min_column = @as(i64, left.origin_column_u) + left.footprint.min_column;
    const left_max_column = @as(i64, left.origin_column_u) + left.footprint.max_column_exclusive;
    const left_min_row = @as(i64, left.origin_row_u) + left.footprint.min_row;
    const left_max_row = @as(i64, left.origin_row_u) + left.footprint.max_row_exclusive;
    const right_min_column = @as(i64, right.origin_column_u) + right.footprint.min_column;
    const right_max_column = @as(i64, right.origin_column_u) + right.footprint.max_column_exclusive;
    const right_min_row = @as(i64, right.origin_row_u) + right.footprint.min_row;
    const right_max_row = @as(i64, right.origin_row_u) + right.footprint.max_row_exclusive;
    return left_min_column < right_max_column and right_min_column < left_max_column and
        left_min_row < right_max_row and right_min_row < left_max_row;
}

fn worldCell(view: CellMaskView, cell: types.WallCell) WorldCell {
    return .{
        .column_u = @as(i64, view.origin_column_u) + cell.column_u,
        .row_u = @as(i64, view.origin_row_u) + cell.row_u,
    };
}

fn viewContainsWorldCell(view: CellMaskView, cell: WorldCell) bool {
    if (view.complete_footprint) {
        return cell.column_u >= @as(i64, view.origin_column_u) + view.footprint.min_column and
            cell.column_u < @as(i64, view.origin_column_u) + view.footprint.max_column_exclusive and
            cell.row_u >= @as(i64, view.origin_row_u) + view.footprint.min_row and
            cell.row_u < @as(i64, view.origin_row_u) + view.footprint.max_row_exclusive;
    }
    for (view.cells) |local| if (std.meta.eql(worldCell(view, local), cell)) return true;
    return false;
}

fn insertOwnedOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    edge_id: []const u8,
    opening_id: []const u8,
    placement: OpeningPlacement,
) std.mem.Allocator.Error!void {
    const edge = findMutableEdgeById(source, edge_id).?;
    var opening = try ownedOpening(allocator, opening_id, placement);
    errdefer opening.deinit(allocator);
    const openings = try allocator.alloc(types.WallOpening, edge.openings.len + 1);
    @memcpy(openings[0..edge.openings.len], edge.openings);
    openings[edge.openings.len] = opening;
    if (edge.openings.len != 0) allocator.free(edge.openings);
    edge.openings = openings;
    std.mem.sort(types.WallOpening, edge.openings, {}, openingIdLessThan);
}

fn updateOwnedOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    opening_id: []const u8,
    placement: OpeningPlacement,
) std.mem.Allocator.Error!void {
    const opening = findMutableOpeningById(source, opening_id).?;
    const kit_id = try allocator.dupe(u8, placement.kit_id);
    allocator.free(opening.kit_id);
    opening.kit_id = kit_id;
    opening.kind = placement.kind;
    opening.column_u = placement.column_u;
    opening.row_u = placement.row_u;
    opening.facing_side = placement.facing_side;
    opening.hinge = placement.hinge;
}

fn deleteOwnedOpening(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    opening_id: []const u8,
) std.mem.Allocator.Error!void {
    for (source.walls.edges) |*edge| {
        for (edge.openings, 0..) |*opening, index| {
            if (!std.mem.eql(u8, opening.id, opening_id)) continue;
            var removed = opening.*;
            const old_openings = edge.openings;
            const shortened = try allocator.alloc(types.WallOpening, old_openings.len - 1);
            @memcpy(shortened[0..index], old_openings[0..index]);
            @memcpy(shortened[index..], old_openings[index + 1 ..]);
            allocator.free(old_openings);
            edge.openings = shortened;
            removed.deinit(allocator);
            return;
        }
    }
    unreachable;
}

const AnchorPlacement = struct {
    edge_id: []const u8,
    side: types.WallSide,
    column_u: types.Unit,
    row_u: types.Unit,
    target_piece_id: []const u8,
};

fn applyAttachAnchor(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    value: anytype,
) ApplyError!types.MutationResult {
    if (try openingBoundaryRejection(allocator, source, entries, command)) |rejection| {
        return .{ .rejection = rejection };
    }
    const edge = findEdgeById(source, value.edge_id) orelse return makeRejection(
        allocator,
        command,
        .invalid_source,
        &.{value.edge_id},
        "the wall edge to anchor does not exist",
    );
    if (!validId(value.target_piece_id)) {
        return makeRejection(allocator, command, .invalid_source, &.{value.edge_id}, "the anchored piece ID is invalid");
    }
    const column_u = types.validateStructuralNumber(value.column_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const row_u = types.validateStructuralNumber(value.row_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const length_u = completeEdgeLengthUnits(source, edge);
    if (column_u < 0 or column_u > length_u or row_u < 0 or row_u > edge.height_u) {
        return makeRejection(
            allocator,
            command,
            .opening_out_of_bounds,
            &.{value.edge_id},
            "the wall anchor lies outside the edge surface",
        );
    }
    for (source.walls.anchors) |anchor| {
        if (std.mem.eql(u8, anchor.target_piece_id, value.target_piece_id)) {
            return makeRejection(
                allocator,
                command,
                .invalid_source,
                &.{ anchor.id, value.target_piece_id },
                "the piece already has a semantic wall anchor",
            );
        }
    }

    const anchor_id = try generatedId(allocator, command.command_id, "a", 0);
    defer allocator.free(anchor_id);
    if (!validId(anchor_id) or sourceContainsId(source, anchor_id)) {
        return makeRejection(
            allocator,
            command,
            .duplicate_command_id,
            &.{anchor_id},
            "anchor attachment requires one unused command-derived ID",
        );
    }
    const revision_after = std.math.add(u32, source.revision, 1) catch return makeRejection(
        allocator,
        command,
        .limit_exceeded,
        &.{},
        "the architecture source revision cannot advance",
    );
    var candidate = try cloneSourceWithDraw(allocator, source, &.{}, &.{}, &.{}, &.{}, revision_after);
    errdefer candidate.deinit(allocator);
    try appendOwnedAnchor(allocator, &candidate, anchor_id, .{
        .edge_id = value.edge_id,
        .side = value.side,
        .column_u = column_u,
        .row_u = row_u,
        .target_piece_id = value.target_piece_id,
    });
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_source, &.{anchor_id}, "anchor attachment produced an invalid source"),
    };
    const receipt = try buildAnchorReceipt(allocator, source, &candidate, command, value.edge_id, anchor_id, .insert);
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

fn applyDetachAnchor(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    anchor_id: []const u8,
) ApplyError!types.MutationResult {
    if (try openingBoundaryRejection(allocator, source, entries, command)) |rejection| {
        return .{ .rejection = rejection };
    }
    const anchor = findAnchorById(source, anchor_id) orelse return makeRejection(
        allocator,
        command,
        .invalid_source,
        &.{anchor_id},
        "the wall anchor to detach does not exist",
    );
    const edge_id = try allocator.dupe(u8, anchor.edge_id);
    defer allocator.free(edge_id);
    const revision_after = std.math.add(u32, source.revision, 1) catch return makeRejection(
        allocator,
        command,
        .limit_exceeded,
        &.{},
        "the architecture source revision cannot advance",
    );
    var candidate = try cloneSourceWithDraw(allocator, source, &.{}, &.{}, &.{}, &.{}, revision_after);
    errdefer candidate.deinit(allocator);
    try deleteOwnedAnchor(allocator, &candidate, anchor_id);
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_source, &.{anchor_id}, "anchor detachment produced an invalid source"),
    };
    const receipt = try buildAnchorReceipt(allocator, source, &candidate, command, edge_id, anchor_id, .delete);
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

fn appendOwnedAnchor(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    anchor_id: []const u8,
    placement: AnchorPlacement,
) std.mem.Allocator.Error!void {
    const id = try allocator.dupe(u8, anchor_id);
    errdefer allocator.free(id);
    const edge_id = try allocator.dupe(u8, placement.edge_id);
    errdefer allocator.free(edge_id);
    const target_piece_id = try allocator.dupe(u8, placement.target_piece_id);
    errdefer allocator.free(target_piece_id);
    const anchors = try allocator.alloc(types.WallAnchor, source.walls.anchors.len + 1);
    @memcpy(anchors[0..source.walls.anchors.len], source.walls.anchors);
    anchors[source.walls.anchors.len] = .{
        .id = id,
        .edge_id = edge_id,
        .side = placement.side,
        .column_u = placement.column_u,
        .row_u = placement.row_u,
        .target_piece_id = target_piece_id,
    };
    if (source.walls.anchors.len != 0) allocator.free(source.walls.anchors);
    source.walls.anchors = anchors;
    std.mem.sort(types.WallAnchor, source.walls.anchors, {}, anchorIdLessThan);
}

fn deleteOwnedAnchor(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    anchor_id: []const u8,
) std.mem.Allocator.Error!void {
    for (source.walls.anchors, 0..) |*anchor, index| {
        if (!std.mem.eql(u8, anchor.id, anchor_id)) continue;
        var removed = anchor.*;
        const old_anchors = source.walls.anchors;
        const shortened = try allocator.alloc(types.WallAnchor, old_anchors.len - 1);
        @memcpy(shortened[0..index], old_anchors[0..index]);
        @memcpy(shortened[index..], old_anchors[index + 1 ..]);
        allocator.free(old_anchors);
        source.walls.anchors = shortened;
        removed.deinit(allocator);
        return;
    }
    unreachable;
}

fn anchorIdLessThan(_: void, left: types.WallAnchor, right: types.WallAnchor) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

const PatchRecordError = error{
    invalid_patch_record,
    patch_subject_missing,
    patch_subject_exists,
    patch_before_mismatch,
};

fn applyArchitecturePatch(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    patch: *const types.ArchitecturePatch,
) ApplyError!types.MutationResult {
    if (try openingBoundaryRejection(allocator, source, entries, command)) |rejection| {
        return .{ .rejection = rejection };
    }
    if (patch.expected_revision != source.revision) {
        return makeRejection(
            allocator,
            command,
            .stale_source_revision,
            &.{},
            "the architecture patch revision does not match the source",
        );
    }
    if (patch.operations.len > types.Limits.maximum_patch_operations) {
        return makeRejection(allocator, command, .limit_exceeded, &.{}, "the architecture patch exceeds its operation limit");
    }

    var candidate = try cloneSourceWithDraw(
        allocator,
        source,
        &.{},
        &.{},
        &.{},
        &.{},
        patch.result_revision,
    );
    errdefer candidate.deinit(allocator);
    for (patch.operations) |*operation| {
        applyPatchOperation(allocator, &candidate, operation) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.patch_subject_missing => return makeRejection(allocator, command, .invalid_source, &.{}, "a patch subject is missing"),
            error.patch_subject_exists => return makeRejection(allocator, command, .invalid_source, &.{}, "a patch insert subject already exists"),
            error.patch_before_mismatch => return makeRejection(allocator, command, .invalid_source, &.{}, "a patch before-snapshot does not match the source"),
            error.invalid_patch_record,
            error.invalid_canonical_record,
            error.canonical_record_too_large,
            => return makeRejection(allocator, command, .invalid_source, &.{}, "a patch record has invalid canonical bytes"),
        };
    }
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_source, &.{}, "the applied patch produced an invalid source"),
    };
    catalog.validateSourceCatalogReferences(allocator, &candidate, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_catalog, &.{}, "the applied patch is incompatible with the catalog"),
    };

    const receipt = try buildAppliedPatchReceipt(allocator, source, &candidate, command, patch);
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

fn applyPatchOperation(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    operation: *const types.PatchOperation,
) (std.mem.Allocator.Error || types.CanonicalRecordError || PatchRecordError)!void {
    switch (operation.*) {
        .insert => |snapshot| {
            if (sourceContainsId(source, snapshot.id)) return error.patch_subject_exists;
            var record = try decodePatchRecord(allocator, snapshot.family, snapshot.id, snapshot.canonical_bytes);
            errdefer record.deinit(allocator);
            try insertDecodedRecord(allocator, source, &record);
        },
        .remove => |snapshot| {
            try expectCurrentRecordBytes(allocator, source, snapshot.family, snapshot.id, snapshot.canonical_bytes);
            try removeOwnedRecord(allocator, source, snapshot.family, snapshot.id);
        },
        .replace => |delta| {
            try expectCurrentRecordBytes(allocator, source, delta.family, delta.id, delta.before_canonical_bytes);
            var record = try decodePatchRecord(allocator, delta.family, delta.id, delta.after_canonical_bytes);
            errdefer record.deinit(allocator);
            try removeOwnedRecord(allocator, source, delta.family, delta.id);
            try insertDecodedRecord(allocator, source, &record);
        },
    }
}

fn decodePatchRecord(
    allocator: std.mem.Allocator,
    family: types.RecordFamily,
    id: []const u8,
    canonical_bytes: []const u8,
) types.CanonicalRecordError!types.CanonicalRecord {
    var record = try types.decodeCanonicalRecord(allocator, canonical_bytes);
    errdefer record.deinit(allocator);
    if (std.meta.activeTag(record) != family or !std.mem.eql(u8, record.id(), id)) {
        return error.invalid_canonical_record;
    }
    return record;
}

fn expectCurrentRecordBytes(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    family: types.RecordFamily,
    id: []const u8,
    expected_bytes: []const u8,
) (std.mem.Allocator.Error || PatchRecordError)!void {
    const actual_bytes = switch (family) {
        .vertex => if (findVertexById(source, id)) |vertex|
            try canonicalVertexBytes(allocator, vertex)
        else
            return error.patch_subject_missing,
        .edge => if (findEdgeById(source, id)) |edge|
            try canonicalEdgeBytes(allocator, edge)
        else
            return error.patch_subject_missing,
        .opening => if (findOpeningById(source, id)) |opening|
            try canonicalLocatedOpeningBytes(allocator, opening)
        else
            return error.patch_subject_missing,
        .anchor => if (findAnchorById(source, id)) |anchor|
            try canonicalAnchorBytes(allocator, anchor)
        else
            return error.patch_subject_missing,
    };
    defer allocator.free(actual_bytes);
    if (!std.mem.eql(u8, actual_bytes, expected_bytes)) return error.patch_before_mismatch;
}

fn insertDecodedRecord(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    record: *types.CanonicalRecord,
) (std.mem.Allocator.Error || PatchRecordError)!void {
    switch (record.*) {
        .vertex => |*vertex| {
            const values = try allocator.alloc(types.WallVertex, source.walls.vertices.len + 1);
            @memcpy(values[0..source.walls.vertices.len], source.walls.vertices);
            values[source.walls.vertices.len] = vertex.*;
            if (source.walls.vertices.len != 0) allocator.free(source.walls.vertices);
            source.walls.vertices = values;
            std.mem.sort(types.WallVertex, source.walls.vertices, {}, vertexIdLessThan);
        },
        .edge => |*edge| {
            const values = try allocator.alloc(types.WallEdge, source.walls.edges.len + 1);
            @memcpy(values[0..source.walls.edges.len], source.walls.edges);
            values[source.walls.edges.len] = edge.*;
            if (source.walls.edges.len != 0) allocator.free(source.walls.edges);
            source.walls.edges = values;
            std.mem.sort(types.WallEdge, source.walls.edges, {}, edgeIdLessThan);
        },
        .opening => |*located| {
            const edge = findMutableEdgeById(source, located.edge_id) orelse return error.patch_subject_missing;
            const values = try allocator.alloc(types.WallOpening, edge.openings.len + 1);
            @memcpy(values[0..edge.openings.len], edge.openings);
            values[edge.openings.len] = located.opening;
            if (edge.openings.len != 0) allocator.free(edge.openings);
            edge.openings = values;
            std.mem.sort(types.WallOpening, edge.openings, {}, openingIdLessThan);
            allocator.free(located.edge_id);
        },
        .anchor => |*anchor| {
            const values = try allocator.alloc(types.WallAnchor, source.walls.anchors.len + 1);
            @memcpy(values[0..source.walls.anchors.len], source.walls.anchors);
            values[source.walls.anchors.len] = anchor.*;
            if (source.walls.anchors.len != 0) allocator.free(source.walls.anchors);
            source.walls.anchors = values;
            std.mem.sort(types.WallAnchor, source.walls.anchors, {}, anchorIdLessThan);
        },
    }
    record.* = undefined;
}

fn removeOwnedRecord(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    family: types.RecordFamily,
    id: []const u8,
) (std.mem.Allocator.Error || PatchRecordError)!void {
    switch (family) {
        .vertex => {
            const index = findVertexIndexById(source, id) orelse return error.patch_subject_missing;
            var removed = source.walls.vertices[index];
            const old_values = source.walls.vertices;
            const values = try allocator.alloc(types.WallVertex, old_values.len - 1);
            @memcpy(values[0..index], old_values[0..index]);
            @memcpy(values[index..], old_values[index + 1 ..]);
            allocator.free(old_values);
            source.walls.vertices = values;
            removed.deinit(allocator);
        },
        .edge => {
            const index = findEdgeIndexById(source, id) orelse return error.patch_subject_missing;
            var removed = source.walls.edges[index];
            const old_values = source.walls.edges;
            const values = try allocator.alloc(types.WallEdge, old_values.len - 1);
            @memcpy(values[0..index], old_values[0..index]);
            @memcpy(values[index..], old_values[index + 1 ..]);
            allocator.free(old_values);
            source.walls.edges = values;
            removed.deinit(allocator);
        },
        .opening => try deleteOwnedOpening(allocator, source, id),
        .anchor => try deleteOwnedAnchor(allocator, source, id),
    }
}

fn vertexIdLessThan(_: void, left: types.WallVertex, right: types.WallVertex) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn edgeIdLessThan(_: void, left: types.WallEdge, right: types.WallEdge) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn ownedOpening(
    allocator: std.mem.Allocator,
    opening_id: []const u8,
    placement: OpeningPlacement,
) std.mem.Allocator.Error!types.WallOpening {
    const id = try allocator.dupe(u8, opening_id);
    errdefer allocator.free(id);
    const kit_id = try allocator.dupe(u8, placement.kit_id);
    errdefer allocator.free(kit_id);
    return .{
        .id = id,
        .kind = placement.kind,
        .kit_id = kit_id,
        .column_u = placement.column_u,
        .row_u = placement.row_u,
        .facing_side = placement.facing_side,
        .hinge = placement.hinge,
    };
}

fn findMutableEdgeById(source: *types.ArchitectureSource, id: []const u8) ?*types.WallEdge {
    for (source.walls.edges) |*edge| if (std.mem.eql(u8, edge.id, id)) return edge;
    return null;
}

fn findMutableOpeningById(source: *types.ArchitectureSource, id: []const u8) ?*types.WallOpening {
    for (source.walls.edges) |*edge| {
        for (edge.openings) |*opening| if (std.mem.eql(u8, opening.id, id)) return opening;
    }
    return null;
}

const EdgeEditKind = enum { dimensions, profile, style, side_finish };

const EdgeEdit = union(EdgeEditKind) {
    dimensions: SetEdgeDimensions,
    profile: struct { edge_id: []const u8, profile: types.WallProfile },
    style: struct { edge_id: []const u8, style_id: []const u8 },
    side_finish: struct { edge_id: []const u8, side: types.WallSide, material_id: []const u8 },
};

fn applyEdgeDimensions(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    dimensions: SetEdgeDimensions,
) ApplyError!types.MutationResult {
    return applyEdgeEdit(allocator, source, entries, command, .{ .dimensions = dimensions });
}

fn applyEdgeProfile(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    edge_id: []const u8,
    profile: types.WallProfile,
) ApplyError!types.MutationResult {
    return applyEdgeEdit(allocator, source, entries, command, .{ .profile = .{
        .edge_id = edge_id,
        .profile = profile,
    } });
}

fn applyEdgeStyle(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    edge_id: []const u8,
    style_id: []const u8,
) ApplyError!types.MutationResult {
    return applyEdgeEdit(allocator, source, entries, command, .{ .style = .{
        .edge_id = edge_id,
        .style_id = style_id,
    } });
}

fn applySideFinish(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    edge_id: []const u8,
    side: types.WallSide,
    material_id: []const u8,
) ApplyError!types.MutationResult {
    return applyEdgeEdit(allocator, source, entries, command, .{ .side_finish = .{
        .edge_id = edge_id,
        .side = side,
        .material_id = material_id,
    } });
}

fn applyEdgeEdit(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    edit: EdgeEdit,
) ApplyError!types.MutationResult {
    if (try openingBoundaryRejection(allocator, source, entries, command)) |rejection| {
        return .{ .rejection = rejection };
    }
    const edge_id: []const u8 = switch (edit) {
        .dimensions => |value| value.edge_id,
        .profile => |value| value.edge_id,
        .style => |value| value.edge_id,
        .side_finish => |value| value.edge_id,
    };
    const edge = findEdgeById(source, edge_id) orelse return makeRejection(
        allocator,
        command,
        .invalid_source,
        &.{edge_id},
        "the wall edge to edit does not exist",
    );

    var proposed_edge = edge.*;
    var absolute_base_y_u: ?types.Unit = null;
    switch (edit) {
        .dimensions => |value| {
            absolute_base_y_u = switch (value.support) {
                .absolute => |support| types.validateStructuralNumber(support.base_y_u) catch |err|
                    return structuralNumberRejection(allocator, command, err),
                .slab => return makeRejection(
                    allocator,
                    command,
                    .invalid_source,
                    &.{edge_id},
                    "version 1 wall edits require an explicit absolute base",
                ),
            };
            proposed_edge.height_u = types.validateStructuralNumber(value.height_u) catch |err|
                return structuralNumberRejection(allocator, command, err);
            proposed_edge.thickness_u = types.validateStructuralNumber(value.thickness_u) catch |err|
                return structuralNumberRejection(allocator, command, err);
            if (proposed_edge.height_u < types.wall_tuning.minimum_height_u or
                proposed_edge.height_u > types.wall_tuning.maximum_height_u or
                proposed_edge.thickness_u < types.wall_tuning.minimum_thickness_u or
                proposed_edge.thickness_u > types.wall_tuning.maximum_thickness_u)
            {
                return makeRejection(allocator, command, .invalid_source, &.{edge_id}, "wall dimensions exceed tuning bounds");
            }
        },
        .profile => |value| proposed_edge.profile = value.profile,
        .style => |value| {
            if (!validId(value.style_id) or !drawStyleExists(entries, value.style_id)) {
                return makeRejection(
                    allocator,
                    command,
                    .unknown_catalog_id,
                    &.{value.style_id},
                    "the requested typed wall style does not exist",
                );
            }
        },
        .side_finish => |value| {
            if (!validId(value.material_id)) {
                return makeRejection(allocator, command, .invalid_source, &.{edge_id}, "the side material ID is invalid");
            }
        },
    }
    const validates_openings = switch (edit) {
        .dimensions, .profile => true,
        .style, .side_finish => false,
    };
    if (validates_openings) {
        for (edge.openings) |opening| {
            const placement = OpeningPlacement{
                .kind = opening.kind,
                .kit_id = opening.kit_id,
                .column_u = opening.column_u,
                .row_u = opening.row_u,
                .facing_side = opening.facing_side,
                .hinge = opening.hinge,
            };
            if (try openingPlacementRejection(
                allocator,
                command,
                entries,
                source,
                &proposed_edge,
                placement,
                opening.id,
            )) |rejection| return .{ .rejection = rejection };
        }
    }

    const revision_after = std.math.add(u32, source.revision, 1) catch return makeRejection(
        allocator,
        command,
        .limit_exceeded,
        &.{},
        "the architecture source revision cannot advance",
    );
    var candidate = try cloneSourceWithDraw(allocator, source, &.{}, &.{}, &.{}, &.{}, revision_after);
    errdefer candidate.deinit(allocator);
    const mutable_edge = findMutableEdgeById(&candidate, edge_id).?;
    switch (edit) {
        .dimensions => {
            mutable_edge.support.deinit(allocator);
            mutable_edge.support = .{ .absolute = .{ .base_y_u = absolute_base_y_u.? } };
            mutable_edge.height_u = proposed_edge.height_u;
            mutable_edge.thickness_u = proposed_edge.thickness_u;
        },
        .profile => |value| mutable_edge.profile = value.profile,
        .style => |value| {
            const style_id = try allocator.dupe(u8, value.style_id);
            allocator.free(mutable_edge.style_id);
            mutable_edge.style_id = style_id;
        },
        .side_finish => |value| {
            const material_id = try allocator.dupe(u8, value.material_id);
            const finish = if (value.side == .a) &mutable_edge.side_a else &mutable_edge.side_b;
            allocator.free(finish.material_id);
            finish.material_id = material_id;
        },
    }
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_source, &.{edge_id}, "edge edit produced an invalid source"),
    };
    catalog.validateSourceCatalogReferences(allocator, &candidate, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_catalog, &.{edge_id}, "edge edit is incompatible with the catalog"),
    };

    const receipt = try buildEdgeEditReceipt(
        allocator,
        source,
        &candidate,
        command,
        edge_id,
        std.meta.activeTag(edit),
    );
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

const DeleteTarget = union(enum) {
    edge_id: []const u8,
    vertex_id: []const u8,
};

fn applyDeleteRecords(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    target: DeleteTarget,
) ApplyError!types.MutationResult {
    if (try openingBoundaryRejection(allocator, source, entries, command)) |rejection| {
        return .{ .rejection = rejection };
    }

    const removed_edges = try allocator.alloc(bool, source.walls.edges.len);
    defer if (removed_edges.len != 0) allocator.free(removed_edges);
    @memset(removed_edges, false);
    const candidate_vertices = try allocator.alloc(bool, source.walls.vertices.len);
    defer if (candidate_vertices.len != 0) allocator.free(candidate_vertices);
    @memset(candidate_vertices, false);
    const removed_vertices = try allocator.alloc(bool, source.walls.vertices.len);
    defer if (removed_vertices.len != 0) allocator.free(removed_vertices);
    @memset(removed_vertices, false);

    switch (target) {
        .edge_id => |edge_id| {
            const edge_index = findEdgeIndexById(source, edge_id) orelse return makeRejection(
                allocator,
                command,
                .invalid_source,
                &.{edge_id},
                "the wall edge to delete does not exist",
            );
            removed_edges[edge_index] = true;
        },
        .vertex_id => |vertex_id| {
            const vertex_index = findVertexIndexById(source, vertex_id) orelse return makeRejection(
                allocator,
                command,
                .invalid_source,
                &.{vertex_id},
                "the wall vertex to delete does not exist",
            );
            candidate_vertices[vertex_index] = true;
            for (source.walls.edges, 0..) |edge, edge_index| {
                if (std.mem.eql(u8, edge.start_vertex_id, vertex_id) or
                    std.mem.eql(u8, edge.end_vertex_id, vertex_id))
                {
                    removed_edges[edge_index] = true;
                }
            }
        },
    }

    for (source.walls.edges, 0..) |edge, edge_index| {
        if (!removed_edges[edge_index]) continue;
        candidate_vertices[findVertexIndexById(source, edge.start_vertex_id).?] = true;
        candidate_vertices[findVertexIndexById(source, edge.end_vertex_id).?] = true;
    }
    for (candidate_vertices, 0..) |is_candidate, vertex_index| {
        if (!is_candidate) continue;
        const vertex_id = source.walls.vertices[vertex_index].id;
        var still_referenced = false;
        for (source.walls.edges, 0..) |edge, edge_index| {
            if (removed_edges[edge_index]) continue;
            if (std.mem.eql(u8, edge.start_vertex_id, vertex_id) or
                std.mem.eql(u8, edge.end_vertex_id, vertex_id))
            {
                still_referenced = true;
                break;
            }
        }
        removed_vertices[vertex_index] = !still_referenced;
    }

    const revision_after = std.math.add(u32, source.revision, 1) catch return makeRejection(
        allocator,
        command,
        .limit_exceeded,
        &.{},
        "the architecture source revision cannot advance",
    );
    var candidate = try cloneSourceForDeletion(
        allocator,
        source,
        removed_edges,
        removed_vertices,
        revision_after,
    );
    errdefer candidate.deinit(allocator);
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_source, &.{}, "record deletion produced an invalid source"),
    };
    catalog.validateSourceCatalogReferences(allocator, &candidate, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(allocator, command, .invalid_catalog, &.{}, "record deletion is incompatible with the catalog"),
    };

    const receipt = try buildDeletionReceipt(
        allocator,
        source,
        &candidate,
        command,
        removed_edges,
        removed_vertices,
    );
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

fn cloneSourceForDeletion(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    removed_edges: []const bool,
    removed_vertices: []const bool,
    revision_after: u32,
) std.mem.Allocator.Error!types.ArchitectureSource {
    var vertex_count: usize = 0;
    for (removed_vertices) |removed| if (!removed) {
        vertex_count += 1;
    };
    var edge_count: usize = 0;
    for (removed_edges) |removed| if (!removed) {
        edge_count += 1;
    };
    var anchor_count: usize = 0;
    for (source.walls.anchors) |anchor| if (!edgeIdIsRemoved(source, removed_edges, anchor.edge_id)) {
        anchor_count += 1;
    };

    const vertices = try allocator.alloc(types.WallVertex, vertex_count);
    var initialized_vertices: usize = 0;
    errdefer {
        for (vertices[0..initialized_vertices]) |*vertex| vertex.deinit(allocator);
        if (vertices.len != 0) allocator.free(vertices);
    }
    for (source.walls.vertices, 0..) |vertex, vertex_index| {
        if (removed_vertices[vertex_index]) continue;
        vertices[initialized_vertices] = try cloneVertex(allocator, vertex);
        initialized_vertices += 1;
    }

    const edges = try allocator.alloc(types.WallEdge, edge_count);
    var initialized_edges: usize = 0;
    errdefer {
        for (edges[0..initialized_edges]) |*edge| edge.deinit(allocator);
        if (edges.len != 0) allocator.free(edges);
    }
    for (source.walls.edges, 0..) |edge, edge_index| {
        if (removed_edges[edge_index]) continue;
        edges[initialized_edges] = try cloneEdge(allocator, edge);
        initialized_edges += 1;
    }

    const anchors = try allocator.alloc(types.WallAnchor, anchor_count);
    var initialized_anchors: usize = 0;
    errdefer {
        for (anchors[0..initialized_anchors]) |*anchor| anchor.deinit(allocator);
        if (anchors.len != 0) allocator.free(anchors);
    }
    for (source.walls.anchors) |anchor| {
        if (edgeIdIsRemoved(source, removed_edges, anchor.edge_id)) continue;
        anchors[initialized_anchors] = try cloneAnchor(allocator, anchor);
        initialized_anchors += 1;
    }

    return .{
        .version = source.version,
        .revision = revision_after,
        .walls = .{
            .vertices = vertices,
            .edges = edges,
            .anchors = anchors,
        },
    };
}

fn findEdgeIndexById(source: *const types.ArchitectureSource, id: []const u8) ?usize {
    for (source.walls.edges, 0..) |edge, index| {
        if (std.mem.eql(u8, edge.id, id)) return index;
    }
    return null;
}

fn findVertexIndexById(source: *const types.ArchitectureSource, id: []const u8) ?usize {
    for (source.walls.vertices, 0..) |vertex, index| {
        if (std.mem.eql(u8, vertex.id, id)) return index;
    }
    return null;
}

fn edgeIdIsRemoved(
    source: *const types.ArchitectureSource,
    removed_edges: []const bool,
    edge_id: []const u8,
) bool {
    const edge_index = findEdgeIndexById(source, edge_id) orelse return false;
    return removed_edges[edge_index];
}

const ResolvedEndpoint = struct {
    x_u: types.Unit,
    z_u: types.Unit,
    vertex_id: ?[]const u8,
};

const NewVertex = struct {
    id: []const u8,
    floor: i32,
    x_u: types.Unit,
    z_u: types.Unit,
};

const NewEdge = struct {
    id: []const u8,
    start_vertex_id: []const u8,
    end_vertex_id: []const u8,
    support: PlannedSupport,
    height_u: types.Unit,
    thickness_u: types.Unit,
    profile: types.WallProfile,
    style_id: []const u8,
    side_a_material_id: []const u8,
    side_b_material_id: []const u8,
    openings: []const types.WallOpening = &.{},
};

const PlannedSupport = union(enum) {
    absolute: struct { base_y_u: types.Unit },
    slab: struct { slab_id: []const u8, join: types.SlabJoin },
};

fn applyDrawWall(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    draw: DrawWall,
) ApplyError!types.MutationResult {
    types.validateSourceStructure(allocator, source) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(
            allocator,
            command,
            .invalid_source,
            &.{},
            "the architecture source is structurally invalid",
        ),
    };
    catalog.validateSourceCatalogReferences(allocator, source, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.unknown_wall_style, error.unknown_opening_kit => return makeRejection(
            allocator,
            command,
            .unknown_catalog_id,
            &.{},
            "the architecture source references an unknown catalog entry",
        ),
        else => return makeRejection(
            allocator,
            command,
            .invalid_catalog,
            &.{},
            "the catalog or an existing source reference is invalid",
        ),
    };

    if (!validId(command.command_id) or
        !validId(draw.style_id) or
        !validId(draw.side_a_material_id) or
        !validId(draw.side_b_material_id))
    {
        return makeRejection(
            allocator,
            command,
            .invalid_source,
            &.{},
            "draw identifiers must be non-empty and bounded",
        );
    }
    if (command.command_id.len > maximum_command_id_bytes) {
        return makeRejection(
            allocator,
            command,
            .limit_exceeded,
            &.{command.command_id},
            "the command ID leaves no bounded space for generated record identities",
        );
    }
    if (draw.floor < -types.wall_tuning.maximum_floor_magnitude or
        draw.floor > types.wall_tuning.maximum_floor_magnitude)
    {
        return makeRejection(
            allocator,
            command,
            .limit_exceeded,
            &.{},
            "the draw floor is outside the supported range",
        );
    }

    const proposed_start_x = types.validateStructuralNumber(draw.start.x_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const proposed_start_z = types.validateStructuralNumber(draw.start.z_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const proposed_end_x = types.validateStructuralNumber(draw.end.x_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const proposed_end_z = types.validateStructuralNumber(draw.end.z_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const height_u = types.validateStructuralNumber(draw.height_u) catch |err|
        return structuralNumberRejection(allocator, command, err);
    const thickness_u = types.validateStructuralNumber(draw.thickness_u) catch |err|
        return structuralNumberRejection(allocator, command, err);

    const support = switch (draw.support) {
        .absolute => |value| support: {
            const base_y_u = types.validateStructuralNumber(value.base_y_u) catch |err|
                return structuralNumberRejection(allocator, command, err);
            break :support PlannedSupport{ .absolute = .{ .base_y_u = base_y_u } };
        },
        .slab => |value| return makeRejection(
            allocator,
            command,
            .invalid_source,
            &.{value.slab_id},
            "version 1 wall draws require an explicit absolute base",
        ),
    };
    if (height_u < types.wall_tuning.minimum_height_u or
        height_u > types.wall_tuning.maximum_height_u or
        thickness_u < types.wall_tuning.minimum_thickness_u or
        thickness_u > types.wall_tuning.maximum_thickness_u)
    {
        return makeRejection(
            allocator,
            command,
            .invalid_source,
            &.{},
            "wall height or thickness is outside the configured tuning range",
        );
    }
    if (!drawStyleExists(entries, draw.style_id)) {
        return makeRejection(
            allocator,
            command,
            .unknown_catalog_id,
            &.{draw.style_id},
            "the requested wall style does not exist as a typed wall style",
        );
    }

    var start = try resolveEndpoint(
        allocator,
        source,
        command,
        draw.floor,
        proposed_start_x,
        proposed_start_z,
        draw.start_magnet_vertex_id,
    );
    if (start.rejection) |rejection| return .{ .rejection = rejection };
    var end = try resolveEndpoint(
        allocator,
        source,
        command,
        draw.floor,
        proposed_end_x,
        proposed_end_z,
        draw.end_magnet_vertex_id,
    );
    if (end.rejection) |rejection| return .{ .rejection = rejection };

    const delta_x: i64 = @as(i64, end.endpoint.x_u) - @as(i64, start.endpoint.x_u);
    const delta_z: i64 = @as(i64, end.endpoint.z_u) - @as(i64, start.endpoint.z_u);
    const length_squared = delta_x * delta_x + delta_z * delta_z;
    if (length_squared == 0) {
        return makeRejection(
            allocator,
            command,
            .zero_length_edge,
            &.{},
            "wall endpoints resolve to the same lattice point",
        );
    }
    const minimum_length: i64 = types.wall_tuning.minimum_wall_length_u;
    if (length_squared < minimum_length * minimum_length) {
        return makeRejection(
            allocator,
            command,
            .short_edge,
            &.{},
            "the wall is shorter than the configured minimum",
        );
    }

    const revision_after = std.math.add(u32, source.revision, 1) catch
        return makeRejection(
            allocator,
            command,
            .limit_exceeded,
            &.{},
            "the architecture source revision cannot advance",
        );

    // Collinear same-spec continuation from a free wall end EXTENDS that wall
    // instead of chaining a second edge (USER RULING req_4501: the invisible
    // crease from drawing a run in several strokes refused doors at spots
    // that look fine). Junction ends, spec changes, turns, and any stroke
    // that touches other structure all fall through to the ordinary plan.
    if (findWallExtension(
        source,
        &start.endpoint,
        &end.endpoint,
        support,
        height_u,
        thickness_u,
        draw.profile,
        draw.style_id,
        draw.side_a_material_id,
        draw.side_b_material_id,
        draw.floor,
    )) |extension| {
        return applyWallExtension(allocator, source, entries, command, extension, revision_after);
    }

    const plan_result = try planDraw(
        allocator,
        source,
        entries,
        command,
        &start.endpoint,
        &end.endpoint,
        .{
            .id = "",
            .start_vertex_id = "",
            .end_vertex_id = "",
            .support = support,
            .height_u = height_u,
            .thickness_u = thickness_u,
            .profile = draw.profile,
            .style_id = draw.style_id,
            .side_a_material_id = draw.side_a_material_id,
            .side_b_material_id = draw.side_b_material_id,
        },
        draw.floor,
    );
    var plan = switch (plan_result) {
        .plan => |value| value,
        .rejection => |rejection| return .{ .rejection = rejection },
    };
    defer plan.deinit();

    if (source.walls.vertices.len + plan.new_vertices.items.len > types.Limits.maximum_vertices or
        source.walls.edges.len - plan.removed_edge_indices.items.len + plan.new_edges.items.len > types.Limits.maximum_edges)
    {
        return makeRejection(
            allocator,
            command,
            .limit_exceeded,
            &.{},
            "the draw would exceed architecture source record limits",
        );
    }

    var candidate = try cloneSourceWithDraw(
        allocator,
        source,
        plan.new_vertices.items,
        plan.new_edges.items,
        plan.removed_edge_indices.items,
        plan.anchor_adjustments.items,
        revision_after,
    );
    errdefer candidate.deinit(allocator);
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(
            allocator,
            command,
            .invalid_source,
            &.{},
            "the candidate draw did not produce a valid source",
        ),
    };
    catalog.validateSourceCatalogReferences(allocator, &candidate, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.unknown_wall_style, error.unknown_opening_kit => return makeRejection(
            allocator,
            command,
            .unknown_catalog_id,
            &.{draw.style_id},
            "the candidate draw references an unknown catalog entry",
        ),
        else => return makeRejection(
            allocator,
            command,
            .invalid_catalog,
            &.{draw.style_id},
            "the candidate draw is incompatible with the catalog",
        ),
    };

    const receipt = try buildDrawReceipt(
        allocator,
        source,
        &candidate,
        command,
        plan.new_vertices.items,
        plan.new_edges.items,
        plan.removed_edge_indices.items,
        plan.split_lineage.items,
        plan.opening_remaps.items,
        plan.anchor_remaps.items,
    );
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

const WallExtension = struct {
    edge_index: usize,
    vertex_index: usize,
    new_x_u: types.Unit,
    new_z_u: types.Unit,
    /// Nonzero when the moved vertex is the edge's START: every opening and
    /// anchor column on the edge shifts by this much so world positions hold.
    column_shift_u: types.Unit,
};

/// A draw qualifies as an extension when exactly one endpoint rests on a
/// DEGREE-ONE vertex whose single edge matches the drawn spec exactly, the
/// stroke continues that edge's line outward, and the new span touches
/// nothing else. Everything else keeps the ordinary draw plan.
fn findWallExtension(
    source: *const types.ArchitectureSource,
    start: *const ResolvedEndpoint,
    end: *const ResolvedEndpoint,
    support: PlannedSupport,
    height_u: types.Unit,
    thickness_u: types.Unit,
    profile: types.WallProfile,
    style_id: []const u8,
    side_a_material_id: []const u8,
    side_b_material_id: []const u8,
    floor: i32,
) ?WallExtension {
    var anchored = start;
    var far = end;
    if (start.vertex_id != null and end.vertex_id == null) {
        // chained continuation: the stroke leaves an existing free end
    } else if (end.vertex_id != null and start.vertex_id == null) {
        anchored = end;
        far = start;
    } else {
        return null;
    }

    var vertex_index: ?usize = null;
    for (source.walls.vertices, 0..) |vertex, index| {
        if (std.mem.eql(u8, vertex.id, anchored.vertex_id.?)) {
            vertex_index = index;
            break;
        }
    }
    const shared_vertex = source.walls.vertices[vertex_index orelse return null];

    var edge_index: ?usize = null;
    var shared_is_edge_start = false;
    for (source.walls.edges, 0..) |edge, index| {
        const at_start = std.mem.eql(u8, edge.start_vertex_id, shared_vertex.id);
        const at_end = std.mem.eql(u8, edge.end_vertex_id, shared_vertex.id);
        if (!at_start and !at_end) continue;
        if (edge_index != null) return null; // junction: two or more incident edges
        edge_index = index;
        shared_is_edge_start = at_start;
    }
    const edge = source.walls.edges[edge_index orelse return null];

    const base_y_u = switch (support) {
        .absolute => |value| value.base_y_u,
        .slab => return null,
    };
    switch (edge.support) {
        .absolute => |value| if (value.base_y_u != base_y_u) return null,
        .slab => return null,
    }
    if (edge.height_u != height_u or
        edge.thickness_u != thickness_u or
        edge.profile != profile or
        !std.mem.eql(u8, edge.style_id, style_id) or
        !std.mem.eql(u8, edge.side_a.material_id, side_a_material_id) or
        !std.mem.eql(u8, edge.side_b.material_id, side_b_material_id))
    {
        return null;
    }

    const other_vertex_id = if (shared_is_edge_start) edge.end_vertex_id else edge.start_vertex_id;
    const other_vertex = findVertexById(source, other_vertex_id) orelse return null;
    const other_point = topology.Point{ .x_u = other_vertex.x_u, .z_u = other_vertex.z_u };
    const shared_point = topology.Point{ .x_u = shared_vertex.x_u, .z_u = shared_vertex.z_u };
    const far_point = topology.Point{ .x_u = far.x_u, .z_u = far.z_u };
    if (topology.orientation(other_point, shared_point, far_point) != 0) return null;
    const along_x = @as(i64, shared_point.x_u) - @as(i64, other_point.x_u);
    const along_z = @as(i64, shared_point.z_u) - @as(i64, other_point.z_u);
    const out_x = @as(i64, far_point.x_u) - @as(i64, shared_point.x_u);
    const out_z = @as(i64, far_point.z_u) - @as(i64, shared_point.z_u);
    if (along_x * out_x + along_z * out_z <= 0) return null;

    // The new span must run through open space: any touch with other
    // structure means junctions/splits, which the ordinary plan owns.
    for (source.walls.edges, 0..) |candidate, candidate_index| {
        if (candidate_index == edge_index.?) continue;
        const candidate_start = findVertexById(source, candidate.start_vertex_id).?;
        if (candidate_start.floor != floor) continue;
        const candidate_end = findVertexById(source, candidate.end_vertex_id).?;
        const kind = topology.classifySegmentIntersection(
            shared_point,
            far_point,
            .{ .x_u = candidate_start.x_u, .z_u = candidate_start.z_u },
            .{ .x_u = candidate_end.x_u, .z_u = candidate_end.z_u },
        );
        if (kind != .none) return null;
    }

    return .{
        .edge_index = edge_index.?,
        .vertex_index = vertex_index.?,
        .new_x_u = far.x_u,
        .new_z_u = far.z_u,
        .column_shift_u = if (shared_is_edge_start)
            completeDistanceUnits(shared_point, far_point)
        else
            0,
    };
}

fn applyWallExtension(
    allocator: std.mem.Allocator,
    source: *types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    extension: WallExtension,
    revision_after: u32,
) ApplyError!types.MutationResult {
    var candidate = try types.cloneSource(allocator, source);
    errdefer candidate.deinit(allocator);
    candidate.revision = revision_after;
    const moved = &candidate.walls.vertices[extension.vertex_index];
    moved.x_u = extension.new_x_u;
    moved.z_u = extension.new_z_u;
    const edge = &candidate.walls.edges[extension.edge_index];
    if (extension.column_shift_u != 0) {
        for (edge.openings) |*opening| opening.column_u += extension.column_shift_u;
        for (candidate.walls.anchors) |*anchor| {
            if (std.mem.eql(u8, anchor.edge_id, edge.id)) anchor.column_u += extension.column_shift_u;
        }
    }
    types.validateSourceStructure(allocator, &candidate) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(
            allocator,
            command,
            .invalid_source,
            &.{},
            "the wall extension did not produce a valid source",
        ),
    };
    catalog.validateSourceCatalogReferences(allocator, &candidate, entries) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return makeRejection(
            allocator,
            command,
            .invalid_catalog,
            &.{},
            "the wall extension is incompatible with the catalog",
        ),
    };
    const receipt = try buildExtensionReceipt(allocator, source, &candidate, command, extension);
    source.deinit(allocator);
    source.* = candidate;
    return .{ .receipt = receipt };
}

fn buildExtensionReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    extension: WallExtension,
) std.mem.Allocator.Error!types.MutationReceipt {
    const before_edge = before.walls.edges[extension.edge_index];
    const vertex_id = before.walls.vertices[extension.vertex_index].id;
    const shifted = extension.column_shift_u != 0;

    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    var shifted_anchor_count: usize = 0;
    if (shifted) {
        for (before.walls.anchors) |anchor| {
            if (std.mem.eql(u8, anchor.edge_id, before_edge.id)) shifted_anchor_count += 1;
        }
    }
    const updated_count = 1 + @as(usize, if (shifted) 1 else 0) + shifted_anchor_count;
    const updated = try allocator.alloc(types.RecordDelta, updated_count);
    var initialized_updated: usize = 0;
    errdefer {
        for (updated[0..initialized_updated]) |*value| value.deinit(allocator);
        if (updated.len != 0) allocator.free(updated);
    }
    updated[initialized_updated] = try recordDelta(allocator, before, after, .vertex, vertex_id);
    initialized_updated += 1;
    if (shifted) {
        updated[initialized_updated] = try recordDelta(allocator, before, after, .edge, before_edge.id);
        initialized_updated += 1;
        for (before.walls.anchors) |anchor| {
            if (!std.mem.eql(u8, anchor.edge_id, before_edge.id)) continue;
            updated[initialized_updated] = try recordDelta(allocator, before, after, .anchor, anchor.id);
            initialized_updated += 1;
        }
    }

    var patches = PatchBuilders.init(allocator);
    defer patches.deinit();
    {
        var operation = try deltaOperation(allocator, before, after, .vertex, vertex_id, false);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    if (shifted) {
        var operation = try deltaOperation(allocator, before, after, .edge, before_edge.id, false);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
        for (before.walls.anchors) |anchor| {
            if (!std.mem.eql(u8, anchor.edge_id, before_edge.id)) continue;
            var anchor_operation = try deltaOperation(allocator, before, after, .anchor, anchor.id, false);
            errdefer anchor_operation.deinit(allocator);
            try patches.appendForward(anchor_operation);
        }
        var anchor_index = before.walls.anchors.len;
        while (anchor_index > 0) {
            anchor_index -= 1;
            const anchor = before.walls.anchors[anchor_index];
            if (!std.mem.eql(u8, anchor.edge_id, before_edge.id)) continue;
            var anchor_operation = try deltaOperation(allocator, before, after, .anchor, anchor.id, true);
            errdefer anchor_operation.deinit(allocator);
            try patches.appendInverse(anchor_operation);
        }
        var inverse_edge = try deltaOperation(allocator, before, after, .edge, before_edge.id, true);
        errdefer inverse_edge.deinit(allocator);
        try patches.appendInverse(inverse_edge);
    }
    {
        var operation = try deltaOperation(allocator, before, after, .vertex, vertex_id, true);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    const forward_operations = try patches.takeForward();
    errdefer deinitPatchOperations(allocator, forward_operations);
    const inverse_operations = try patches.takeInverse();
    errdefer deinitPatchOperations(allocator, inverse_operations);

    const opening_remap_count: usize = if (shifted) before_edge.openings.len else 0;
    const opening_remaps = try allocator.alloc(types.SurfaceChildRemap, opening_remap_count);
    var initialized_opening_remaps: usize = 0;
    errdefer {
        for (opening_remaps[0..initialized_opening_remaps]) |*value| value.deinit(allocator);
        if (opening_remaps.len != 0) allocator.free(opening_remaps);
    }
    if (shifted) {
        for (before_edge.openings) |opening| {
            opening_remaps[initialized_opening_remaps] = .{
                .child_family = .opening,
                .child_id = try allocator.dupe(u8, opening.id),
                .predecessor_edge_id = try allocator.dupe(u8, before_edge.id),
                .successor_edge_id = try allocator.dupe(u8, before_edge.id),
                .old_column_u = opening.column_u,
                .new_column_u = opening.column_u + extension.column_shift_u,
                .row_u = opening.row_u,
            };
            initialized_opening_remaps += 1;
        }
    }
    const anchor_remaps = try allocator.alloc(types.SurfaceChildRemap, shifted_anchor_count);
    var initialized_anchor_remaps: usize = 0;
    errdefer {
        for (anchor_remaps[0..initialized_anchor_remaps]) |*value| value.deinit(allocator);
        if (anchor_remaps.len != 0) allocator.free(anchor_remaps);
    }
    if (shifted) {
        for (before.walls.anchors) |anchor| {
            if (!std.mem.eql(u8, anchor.edge_id, before_edge.id)) continue;
            anchor_remaps[initialized_anchor_remaps] = .{
                .child_family = .anchor,
                .child_id = try allocator.dupe(u8, anchor.id),
                .predecessor_edge_id = try allocator.dupe(u8, before_edge.id),
                .successor_edge_id = try allocator.dupe(u8, before_edge.id),
                .old_column_u = anchor.column_u,
                .new_column_u = anchor.column_u + extension.column_shift_u,
                .row_u = anchor.row_u,
            };
            initialized_anchor_remaps += 1;
        }
    }

    const created = try allocator.alloc(types.RecordRef, 0);
    const removed = try allocator.alloc(types.RecordSnapshot, 0);
    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, 0);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);

    const after_edge = after.walls.edges[extension.edge_index];
    const after_start = findVertexById(after, after_edge.start_vertex_id).?;
    const after_end = findVertexById(after, after_edge.end_vertex_id).?;
    const thickness_radius: types.Unit = @divTrunc(after_edge.thickness_u + 1, 2);
    const base_y_u = switch (after_edge.support) {
        .absolute => |value| value.base_y_u,
        .slab => types.Limits.minimum_unit,
    };
    const affected_bounds = try allocator.alloc(types.AffectedBounds, 1);
    errdefer allocator.free(affected_bounds);
    affected_bounds[0] = .{
        .floor = after_start.floor,
        .min_x_u = @min(after_start.x_u, after_end.x_u) - thickness_radius,
        .min_y_u = base_y_u,
        .min_z_u = @min(after_start.z_u, after_end.z_u) - thickness_radius,
        .max_x_u_exclusive = @max(after_start.x_u, after_end.x_u) + thickness_radius,
        .max_y_u_exclusive = base_y_u + after_edge.height_u,
        .max_z_u_exclusive = @max(after_start.z_u, after_end.z_u) + thickness_radius,
    };

    const dirty_values = [_]types.DirtyTarget{
        .topology,
        .render,
        .collision,
        .cover,
        .materials,
        .doors_portals,
        .navigation,
        .rooms,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, &dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = before.revision,
            .result_revision = after.revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = after.revision,
            .result_revision = before.revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

const StrokeCut = struct {
    point: topology.Point,
    parameter: topology.Rational,
    vertex_id: ?[]const u8 = null,
};

const SplitSourceEdge = struct {
    edge_index: usize,
    point: topology.Point,
};

const SplitLineagePlan = struct {
    predecessor_edge_index: usize,
    first_child_id: []const u8,
    second_child_id: []const u8,
    split_column_u: types.Unit,
};

const SurfaceRemapPlan = struct {
    child_family: types.RecordFamily,
    child_id: []const u8,
    predecessor_edge_id: []const u8,
    successor_edge_id: []const u8,
    old_column_u: types.Unit,
    new_column_u: types.Unit,
    row_u: types.Unit,
};

const AnchorAdjustment = struct {
    source_anchor_index: usize,
    successor_edge_id: []const u8,
    new_column_u: types.Unit,
};

const DrawPlan = struct {
    allocator: std.mem.Allocator,
    new_vertices: std.ArrayList(NewVertex) = .empty,
    new_edges: std.ArrayList(NewEdge) = .empty,
    removed_edge_indices: std.ArrayList(usize) = .empty,
    owned_ids: std.ArrayList([]u8) = .empty,
    split_lineage: std.ArrayList(SplitLineagePlan) = .empty,
    opening_remaps: std.ArrayList(SurfaceRemapPlan) = .empty,
    anchor_remaps: std.ArrayList(SurfaceRemapPlan) = .empty,
    anchor_adjustments: std.ArrayList(AnchorAdjustment) = .empty,
    opening_buffers: std.ArrayList([]types.WallOpening) = .empty,

    fn init(allocator: std.mem.Allocator) DrawPlan {
        return .{ .allocator = allocator };
    }

    fn deinit(self: *DrawPlan) void {
        for (self.owned_ids.items) |id| self.allocator.free(id);
        for (self.opening_buffers.items) |buffer| if (buffer.len != 0) self.allocator.free(buffer);
        self.new_vertices.deinit(self.allocator);
        self.new_edges.deinit(self.allocator);
        self.removed_edge_indices.deinit(self.allocator);
        self.owned_ids.deinit(self.allocator);
        self.split_lineage.deinit(self.allocator);
        self.opening_remaps.deinit(self.allocator);
        self.anchor_remaps.deinit(self.allocator);
        self.anchor_adjustments.deinit(self.allocator);
        self.opening_buffers.deinit(self.allocator);
        self.* = undefined;
    }

    fn allocateGeneratedId(
        self: *DrawPlan,
        source: *const types.ArchitectureSource,
        command_id: []const u8,
        family_token: []const u8,
        index: usize,
    ) std.mem.Allocator.Error!?[]const u8 {
        const id = try generatedId(self.allocator, command_id, family_token, index);
        errdefer self.allocator.free(id);
        if (!validId(id) or sourceContainsId(source, id)) {
            self.allocator.free(id);
            return null;
        }
        try self.owned_ids.append(self.allocator, id);
        return id;
    }
};

const DrawPlanResult = union(enum) {
    plan: DrawPlan,
    rejection: types.MutationRejection,
};

fn planDraw(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    command: Command,
    start: *ResolvedEndpoint,
    end: *ResolvedEndpoint,
    stroke_template: NewEdge,
    floor: i32,
) std.mem.Allocator.Error!DrawPlanResult {
    var plan = DrawPlan.init(allocator);
    var keep_plan = false;
    defer if (!keep_plan) plan.deinit();

    var vertex_number: usize = 0;
    if (start.vertex_id == null) {
        const id = (try plan.allocateGeneratedId(source, command.command_id, "v", vertex_number)) orelse
            return drawIdentityRejection(allocator, command);
        start.vertex_id = id;
        try plan.new_vertices.append(allocator, .{
            .id = id,
            .floor = floor,
            .x_u = start.x_u,
            .z_u = start.z_u,
        });
        vertex_number += 1;
    }
    if (end.vertex_id == null) {
        const id = (try plan.allocateGeneratedId(source, command.command_id, "v", vertex_number)) orelse
            return drawIdentityRejection(allocator, command);
        end.vertex_id = id;
        try plan.new_vertices.append(allocator, .{
            .id = id,
            .floor = floor,
            .x_u = end.x_u,
            .z_u = end.z_u,
        });
        vertex_number += 1;
    }

    const stroke_start = topology.Point{ .x_u = start.x_u, .z_u = start.z_u };
    const stroke_end = topology.Point{ .x_u = end.x_u, .z_u = end.z_u };
    var cuts: std.ArrayList(StrokeCut) = .empty;
    defer cuts.deinit(allocator);
    var split_edges: std.ArrayList(SplitSourceEdge) = .empty;
    defer split_edges.deinit(allocator);

    for (source.walls.edges, 0..) |edge, edge_index| {
        const edge_start_vertex = findVertexById(source, edge.start_vertex_id).?;
        const edge_end_vertex = findVertexById(source, edge.end_vertex_id).?;
        if (edge_start_vertex.floor != floor) continue;
        const edge_start = topology.Point{ .x_u = edge_start_vertex.x_u, .z_u = edge_start_vertex.z_u };
        const edge_end = topology.Point{ .x_u = edge_end_vertex.x_u, .z_u = edge_end_vertex.z_u };
        const kind = topology.classifySegmentIntersection(stroke_start, stroke_end, edge_start, edge_end);
        if (kind == .none) continue;
        if (kind == .collinear_overlap) {
            return .{ .rejection = try ownedRejection(
                allocator,
                command,
                .collinear_overlap,
                &.{edge.id},
                "the draw overlaps an existing collinear wall span",
            ) };
        }
        const point = topology.exactSegmentIntersection(stroke_start, stroke_end, edge_start, edge_end) catch |err| switch (err) {
            error.intersection_off_lattice => return .{ .rejection = try ownedRejection(
                allocator,
                command,
                .off_lattice_intersection,
                &.{edge.id},
                "the exact wall intersection is not on the whole-u lattice",
            ) },
            error.intersection_out_of_range => return .{ .rejection = try ownedRejection(
                allocator,
                command,
                .limit_exceeded,
                &.{edge.id},
                "the exact wall intersection is outside the supported u range",
            ) },
            error.collinear_overlap => unreachable,
        } orelse continue;

        if (!pointsEqual(point, stroke_start) and !pointsEqual(point, stroke_end) and
            findStrokeCut(cuts.items, point) == null)
        {
            try cuts.append(allocator, .{
                .point = point,
                .parameter = parameterForPoint(stroke_start, stroke_end, point),
            });
        }
        if (!pointsEqual(point, edge_start) and !pointsEqual(point, edge_end)) {
            try split_edges.append(allocator, .{ .edge_index = edge_index, .point = point });
        }
    }

    std.mem.sort(StrokeCut, cuts.items, {}, strokeCutLessThan);
    for (cuts.items) |*cut| {
        if (findVertexAt(source, floor, cut.point.x_u, cut.point.z_u)) |vertex| {
            cut.vertex_id = vertex.id;
        } else {
            const id = (try plan.allocateGeneratedId(source, command.command_id, "v", vertex_number)) orelse
                return drawIdentityRejection(allocator, command);
            cut.vertex_id = id;
            try plan.new_vertices.append(allocator, .{
                .id = id,
                .floor = floor,
                .x_u = cut.point.x_u,
                .z_u = cut.point.z_u,
            });
            vertex_number += 1;
        }
    }

    std.mem.sort(SplitSourceEdge, split_edges.items, source, splitSourceEdgeLessThan);
    var edge_number: usize = 0;
    for (split_edges.items) |split| {
        const predecessor = source.walls.edges[split.edge_index];
        const split_vertex_id = vertexIdForPoint(start.*, end.*, cuts.items, split.point).?;
        try plan.removed_edge_indices.append(allocator, split.edge_index);

        const first_id = (try plan.allocateGeneratedId(source, command.command_id, "e", edge_number)) orelse
            return drawIdentityRejection(allocator, command);
        edge_number += 1;

        const second_id = (try plan.allocateGeneratedId(source, command.command_id, "e", edge_number)) orelse
            return drawIdentityRejection(allocator, command);
        edge_number += 1;

        const predecessor_start = findVertexById(source, predecessor.start_vertex_id).?;
        const split_column_u = completeDistanceUnits(
            .{ .x_u = predecessor_start.x_u, .z_u = predecessor_start.z_u },
            split.point,
        );
        const opening_partition_result = try partitionOpenings(
            &plan,
            entries,
            command,
            predecessor,
            first_id,
            second_id,
            split_column_u,
        );
        const opening_partition = switch (opening_partition_result) {
            .partition => |value| value,
            .rejection => |rejection| return .{ .rejection = rejection },
        };
        if (try partitionAnchors(
            &plan,
            source,
            command,
            predecessor,
            first_id,
            second_id,
            split_column_u,
        )) |rejection| return .{ .rejection = rejection };
        try plan.split_lineage.append(allocator, .{
            .predecessor_edge_index = split.edge_index,
            .first_child_id = first_id,
            .second_child_id = second_id,
            .split_column_u = split_column_u,
        });

        try plan.new_edges.append(allocator, edgeChild(
            predecessor,
            first_id,
            predecessor.start_vertex_id,
            split_vertex_id,
            opening_partition.first,
        ));
        try plan.new_edges.append(allocator, edgeChild(
            predecessor,
            second_id,
            split_vertex_id,
            predecessor.end_vertex_id,
            opening_partition.second,
        ));
    }

    std.mem.sort(SurfaceRemapPlan, plan.opening_remaps.items, {}, surfaceRemapLessThan);
    std.mem.sort(SurfaceRemapPlan, plan.anchor_remaps.items, {}, surfaceRemapLessThan);

    var previous_vertex_id = start.vertex_id.?;
    for (cuts.items) |cut| {
        const stroke_edge_id = (try plan.allocateGeneratedId(source, command.command_id, "e", edge_number)) orelse
            return drawIdentityRejection(allocator, command);
        edge_number += 1;
        var stroke_edge = stroke_template;
        stroke_edge.id = stroke_edge_id;
        stroke_edge.start_vertex_id = previous_vertex_id;
        stroke_edge.end_vertex_id = cut.vertex_id.?;
        try plan.new_edges.append(allocator, stroke_edge);
        previous_vertex_id = cut.vertex_id.?;
    }
    const final_stroke_edge_id = (try plan.allocateGeneratedId(source, command.command_id, "e", edge_number)) orelse
        return drawIdentityRejection(allocator, command);
    var final_stroke_edge = stroke_template;
    final_stroke_edge.id = final_stroke_edge_id;
    final_stroke_edge.start_vertex_id = previous_vertex_id;
    final_stroke_edge.end_vertex_id = end.vertex_id.?;
    try plan.new_edges.append(allocator, final_stroke_edge);

    keep_plan = true;
    return .{ .plan = plan };
}

fn drawIdentityRejection(
    allocator: std.mem.Allocator,
    command: Command,
) std.mem.Allocator.Error!DrawPlanResult {
    return .{ .rejection = try ownedRejection(
        allocator,
        command,
        .duplicate_command_id,
        &.{command.command_id},
        "the command-derived identity already exists",
    ) };
}

fn strokeCutLessThan(_: void, left: StrokeCut, right: StrokeCut) bool {
    if (topology.rationalLessThan(left.parameter, right.parameter)) return true;
    if (topology.rationalLessThan(right.parameter, left.parameter)) return false;
    if (left.point.x_u != right.point.x_u) return left.point.x_u < right.point.x_u;
    return left.point.z_u < right.point.z_u;
}

fn splitSourceEdgeLessThan(
    source: *const types.ArchitectureSource,
    left: SplitSourceEdge,
    right: SplitSourceEdge,
) bool {
    return std.mem.lessThan(
        u8,
        source.walls.edges[left.edge_index].id,
        source.walls.edges[right.edge_index].id,
    );
}

fn parameterForPoint(start: topology.Point, end: topology.Point, point_value: topology.Point) topology.Rational {
    const delta_x: i64 = @as(i64, end.x_u) - @as(i64, start.x_u);
    const delta_z: i64 = @as(i64, end.z_u) - @as(i64, start.z_u);
    if (@abs(delta_x) >= @abs(delta_z) and delta_x != 0) {
        return topology.Rational.init(
            @as(topology.Wide, point_value.x_u) - @as(topology.Wide, start.x_u),
            delta_x,
        );
    }
    return topology.Rational.init(
        @as(topology.Wide, point_value.z_u) - @as(topology.Wide, start.z_u),
        delta_z,
    );
}

fn findStrokeCut(cuts: []const StrokeCut, point_value: topology.Point) ?usize {
    for (cuts, 0..) |cut, index| {
        if (pointsEqual(cut.point, point_value)) return index;
    }
    return null;
}

fn pointsEqual(left: topology.Point, right: topology.Point) bool {
    return left.x_u == right.x_u and left.z_u == right.z_u;
}

fn vertexIdForPoint(
    start: ResolvedEndpoint,
    end: ResolvedEndpoint,
    cuts: []const StrokeCut,
    point_value: topology.Point,
) ?[]const u8 {
    if (start.x_u == point_value.x_u and start.z_u == point_value.z_u) return start.vertex_id;
    if (end.x_u == point_value.x_u and end.z_u == point_value.z_u) return end.vertex_id;
    const cut_index = findStrokeCut(cuts, point_value) orelse return null;
    return cuts[cut_index].vertex_id;
}

const OpeningPartition = struct {
    first: []const types.WallOpening,
    second: []const types.WallOpening,
};

const OpeningPartitionResult = union(enum) {
    partition: OpeningPartition,
    rejection: types.MutationRejection,
};

fn partitionOpenings(
    plan: *DrawPlan,
    entries: []const catalog.CatalogEntry,
    command: Command,
    predecessor: types.WallEdge,
    first_child_id: []const u8,
    second_child_id: []const u8,
    split_column_u: types.Unit,
) std.mem.Allocator.Error!OpeningPartitionResult {
    var first_count: usize = 0;
    var second_count: usize = 0;

    for (predecessor.openings) |opening| {
        const kit = findCatalogEntry(entries, opening.kit_id).?;
        const range = openingColumnRange(kit, opening);
        if (range.minimum_u <= split_column_u and split_column_u < range.maximum_exclusive_u) {
            return .{ .rejection = try ownedRejection(
                plan.allocator,
                command,
                .split_intersects_surface_child,
                &.{ predecessor.id, opening.id },
                "the wall junction intersects an opening occupied or clearance cell",
            ) };
        }
        if (range.maximum_exclusive_u <= split_column_u) {
            first_count += 1;
        } else {
            second_count += 1;
        }
    }

    try plan.opening_buffers.ensureUnusedCapacity(plan.allocator, 2);
    const first_buffer = try plan.allocator.alloc(types.WallOpening, first_count);
    errdefer if (first_buffer.len != 0) plan.allocator.free(first_buffer);
    const second_buffer = try plan.allocator.alloc(types.WallOpening, second_count);
    errdefer if (second_buffer.len != 0) plan.allocator.free(second_buffer);
    first_count = 0;
    second_count = 0;

    for (predecessor.openings) |opening| {
        const kit = findCatalogEntry(entries, opening.kit_id).?;
        const range = openingColumnRange(kit, opening);
        var adjusted = opening;
        const successor_edge_id: []const u8 = if (range.maximum_exclusive_u <= split_column_u) first: {
            first_buffer[first_count] = adjusted;
            first_count += 1;
            break :first first_child_id;
        } else second: {
            adjusted.column_u -= split_column_u;
            second_buffer[second_count] = adjusted;
            second_count += 1;
            break :second second_child_id;
        };
        try plan.opening_remaps.append(plan.allocator, .{
            .child_family = .opening,
            .child_id = opening.id,
            .predecessor_edge_id = predecessor.id,
            .successor_edge_id = successor_edge_id,
            .old_column_u = opening.column_u,
            .new_column_u = adjusted.column_u,
            .row_u = opening.row_u,
        });
    }

    std.mem.sort(types.WallOpening, first_buffer[0..first_count], {}, openingIdLessThan);
    std.mem.sort(types.WallOpening, second_buffer[0..second_count], {}, openingIdLessThan);
    plan.opening_buffers.appendAssumeCapacity(first_buffer);
    plan.opening_buffers.appendAssumeCapacity(second_buffer);
    return .{ .partition = .{
        .first = first_buffer[0..first_count],
        .second = second_buffer[0..second_count],
    } };
}

const OpeningColumnRange = struct {
    minimum_u: i64,
    maximum_exclusive_u: i64,
};

fn openingColumnRange(entry: *const catalog.CatalogEntry, opening: types.WallOpening) OpeningColumnRange {
    const footprint = entry.measurement.footprint.?;
    var minimum: i64 = std.math.maxInt(i64);
    var maximum_exclusive: i64 = std.math.minInt(i64);
    if (entry.measurement.occupied_mask.len == 0) {
        minimum = @as(i64, opening.column_u) + footprint.min_column;
        maximum_exclusive = @as(i64, opening.column_u) + footprint.max_column_exclusive;
    } else {
        for (entry.measurement.occupied_mask) |cell| {
            const column = @as(i64, opening.column_u) + cell.column_u;
            minimum = @min(minimum, column);
            maximum_exclusive = @max(maximum_exclusive, column + 1);
        }
    }
    for (entry.measurement.clearance_mask) |cell| {
        const column = @as(i64, opening.column_u) + cell.column_u;
        minimum = @min(minimum, column);
        maximum_exclusive = @max(maximum_exclusive, column + 1);
    }
    return .{ .minimum_u = minimum, .maximum_exclusive_u = maximum_exclusive };
}

fn partitionAnchors(
    plan: *DrawPlan,
    source: *const types.ArchitectureSource,
    command: Command,
    predecessor: types.WallEdge,
    first_child_id: []const u8,
    second_child_id: []const u8,
    split_column_u: types.Unit,
) std.mem.Allocator.Error!?types.MutationRejection {
    for (source.walls.anchors, 0..) |anchor, anchor_index| {
        if (!std.mem.eql(u8, anchor.edge_id, predecessor.id)) continue;
        if (anchor.column_u == split_column_u) {
            return try ownedRejection(
                plan.allocator,
                command,
                .split_intersects_surface_child,
                &.{ predecessor.id, anchor.id },
                "the wall junction intersects a wall anchor cell",
            );
        }
        const successor_edge_id = if (anchor.column_u < split_column_u)
            first_child_id
        else
            second_child_id;
        const new_column_u = if (anchor.column_u < split_column_u)
            anchor.column_u
        else
            anchor.column_u - split_column_u;
        try plan.anchor_adjustments.append(plan.allocator, .{
            .source_anchor_index = anchor_index,
            .successor_edge_id = successor_edge_id,
            .new_column_u = new_column_u,
        });
        try plan.anchor_remaps.append(plan.allocator, .{
            .child_family = .anchor,
            .child_id = anchor.id,
            .predecessor_edge_id = predecessor.id,
            .successor_edge_id = successor_edge_id,
            .old_column_u = anchor.column_u,
            .new_column_u = new_column_u,
            .row_u = anchor.row_u,
        });
    }
    return null;
}

fn findCatalogEntry(entries: []const catalog.CatalogEntry, catalog_id: []const u8) ?*const catalog.CatalogEntry {
    for (entries) |*entry| {
        if (std.mem.eql(u8, entry.catalog_id, catalog_id)) return entry;
    }
    return null;
}

fn openingIdLessThan(_: void, left: types.WallOpening, right: types.WallOpening) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn surfaceRemapLessThan(_: void, left: SurfaceRemapPlan, right: SurfaceRemapPlan) bool {
    if (left.child_family != right.child_family) return @intFromEnum(left.child_family) < @intFromEnum(right.child_family);
    return std.mem.lessThan(u8, left.child_id, right.child_id);
}

fn completeDistanceUnits(start: topology.Point, end: topology.Point) types.Unit {
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
        if (middle <= value / middle) {
            lower = middle;
        } else {
            upper = middle;
        }
    }
    return lower;
}

fn edgeChild(
    predecessor: types.WallEdge,
    id: []const u8,
    start_vertex_id: []const u8,
    end_vertex_id: []const u8,
    openings: []const types.WallOpening,
) NewEdge {
    return .{
        .id = id,
        .start_vertex_id = start_vertex_id,
        .end_vertex_id = end_vertex_id,
        .support = plannedSupport(predecessor.support),
        .height_u = predecessor.height_u,
        .thickness_u = predecessor.thickness_u,
        .profile = predecessor.profile,
        .style_id = predecessor.style_id,
        .side_a_material_id = predecessor.side_a.material_id,
        .side_b_material_id = predecessor.side_b.material_id,
        .openings = openings,
    };
}

fn plannedSupport(support: types.WallSupport) PlannedSupport {
    return switch (support) {
        .absolute => |value| .{ .absolute = .{ .base_y_u = value.base_y_u } },
        .slab => |value| .{ .slab = .{ .slab_id = value.slab_id, .join = value.join } },
    };
}

const EndpointResolution = struct {
    endpoint: ResolvedEndpoint,
    rejection: ?types.MutationRejection = null,
};

fn resolveEndpoint(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    command: Command,
    floor: i32,
    proposed_x_u: types.Unit,
    proposed_z_u: types.Unit,
    magnet_vertex_id: ?[]const u8,
) std.mem.Allocator.Error!EndpointResolution {
    if (magnet_vertex_id) |magnet_id| {
        const vertex = findVertexById(source, magnet_id) orelse return .{
            .endpoint = undefined,
            .rejection = try ownedRejection(
                allocator,
                command,
                .invalid_source,
                &.{magnet_id},
                "the explicit magnet target is not a wall vertex",
            ),
        };
        if (vertex.floor != floor) return .{
            .endpoint = undefined,
            .rejection = try ownedRejection(
                allocator,
                command,
                .invalid_source,
                &.{magnet_id},
                "the explicit magnet target is on another floor",
            ),
        };
        return .{ .endpoint = .{
            .x_u = vertex.x_u,
            .z_u = vertex.z_u,
            .vertex_id = vertex.id,
        } };
    }

    if (findVertexAt(source, floor, proposed_x_u, proposed_z_u)) |vertex| {
        return .{ .endpoint = .{
            .x_u = vertex.x_u,
            .z_u = vertex.z_u,
            .vertex_id = vertex.id,
        } };
    }
    return .{ .endpoint = .{
        .x_u = proposed_x_u,
        .z_u = proposed_z_u,
        .vertex_id = null,
    } };
}

fn structuralNumberRejection(
    allocator: std.mem.Allocator,
    command: Command,
    err: types.StructuralNumberError,
) std.mem.Allocator.Error!types.MutationResult {
    const code: types.ArchitectureRejectionCode = switch (err) {
        error.structural_value_not_integer => .structural_value_not_integer,
        error.structural_value_not_finite => .invalid_source,
        error.structural_value_out_of_range => .limit_exceeded,
    };
    const detail = switch (err) {
        error.structural_value_not_integer => "structural wall values must be exact whole-u integers",
        error.structural_value_not_finite => "structural wall values must be finite",
        error.structural_value_out_of_range => "structural wall values exceed the supported u range",
    };
    return makeRejection(allocator, command, code, &.{}, detail);
}

fn makeRejection(
    allocator: std.mem.Allocator,
    command: Command,
    code: types.ArchitectureRejectionCode,
    subject_ids: []const []const u8,
    detail: []const u8,
) std.mem.Allocator.Error!types.MutationResult {
    return .{ .rejection = try ownedRejection(allocator, command, code, subject_ids, detail) };
}

fn ownedRejection(
    allocator: std.mem.Allocator,
    command: Command,
    code: types.ArchitectureRejectionCode,
    subject_ids: []const []const u8,
    detail: []const u8,
) std.mem.Allocator.Error!types.MutationRejection {
    return ownedRejectionAtRevision(
        allocator,
        command,
        code,
        subject_ids,
        detail,
        command.expected_revision,
    );
}

fn ownedRejectionAtRevision(
    allocator: std.mem.Allocator,
    command: Command,
    code: types.ArchitectureRejectionCode,
    subject_ids: []const []const u8,
    detail: []const u8,
    actual_revision: u32,
) std.mem.Allocator.Error!types.MutationRejection {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const subjects = try cloneStringList(allocator, subject_ids);
    errdefer freeStringList(allocator, subjects);
    const owned_detail = try allocator.dupe(u8, detail);
    errdefer allocator.free(owned_detail);
    return .{
        .command_id = command_id,
        .code = code,
        .expected_revision = command.expected_revision,
        .actual_revision = actual_revision,
        .subject_ids = subjects,
        .detail = owned_detail,
    };
}

fn validId(id: []const u8) bool {
    return id.len != 0 and id.len <= types.Limits.maximum_id_bytes;
}

fn drawStyleExists(entries: []const catalog.CatalogEntry, style_id: []const u8) bool {
    for (entries) |entry| {
        if (std.mem.eql(u8, entry.catalog_id, style_id)) {
            return entry.family == .wall and entry.role == .style;
        }
    }
    return false;
}

fn findVertexById(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallVertex {
    for (source.walls.vertices) |*vertex| {
        if (std.mem.eql(u8, vertex.id, id)) return vertex;
    }
    return null;
}

fn findVertexAt(
    source: *const types.ArchitectureSource,
    floor: i32,
    x_u: types.Unit,
    z_u: types.Unit,
) ?*const types.WallVertex {
    var result: ?*const types.WallVertex = null;
    for (source.walls.vertices) |*vertex| {
        if (vertex.floor != floor or vertex.x_u != x_u or vertex.z_u != z_u) continue;
        if (result == null or std.mem.lessThan(u8, vertex.id, result.?.id)) result = vertex;
    }
    return result;
}

fn generatedId(
    allocator: std.mem.Allocator,
    command_id: []const u8,
    family_token: []const u8,
    index: usize,
) std.mem.Allocator.Error![]u8 {
    return std.fmt.allocPrint(allocator, "{s}:{s}:{d}", .{ command_id, family_token, index });
}

fn sourceContainsId(source: *const types.ArchitectureSource, id: []const u8) bool {
    for (source.walls.vertices) |vertex| if (std.mem.eql(u8, vertex.id, id)) return true;
    for (source.walls.edges) |edge| {
        if (std.mem.eql(u8, edge.id, id)) return true;
        for (edge.openings) |opening| if (std.mem.eql(u8, opening.id, id)) return true;
    }
    for (source.walls.anchors) |anchor| if (std.mem.eql(u8, anchor.id, id)) return true;
    return false;
}

fn cloneSourceWithDraw(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    new_vertices: []const NewVertex,
    new_edges: []const NewEdge,
    removed_edge_indices: []const usize,
    anchor_adjustments: []const AnchorAdjustment,
    revision_after: u32,
) std.mem.Allocator.Error!types.ArchitectureSource {
    const vertex_count = source.walls.vertices.len + new_vertices.len;
    const edge_count = source.walls.edges.len - removed_edge_indices.len + new_edges.len;

    const vertices = try allocator.alloc(types.WallVertex, vertex_count);
    var initialized_vertices: usize = 0;
    errdefer {
        for (vertices[0..initialized_vertices]) |*vertex| vertex.deinit(allocator);
        if (vertices.len != 0) allocator.free(vertices);
    }
    for (source.walls.vertices) |vertex| {
        vertices[initialized_vertices] = try cloneVertex(allocator, vertex);
        initialized_vertices += 1;
    }
    for (new_vertices) |vertex| {
        vertices[initialized_vertices] = .{
            .id = try allocator.dupe(u8, vertex.id),
            .floor = vertex.floor,
            .x_u = vertex.x_u,
            .z_u = vertex.z_u,
        };
        initialized_vertices += 1;
    }

    const edges = try allocator.alloc(types.WallEdge, edge_count);
    var initialized_edges: usize = 0;
    errdefer {
        for (edges[0..initialized_edges]) |*edge| edge.deinit(allocator);
        if (edges.len != 0) allocator.free(edges);
    }
    for (source.walls.edges, 0..) |edge, edge_index| {
        if (containsIndex(removed_edge_indices, edge_index)) continue;
        edges[initialized_edges] = try cloneEdge(allocator, edge);
        initialized_edges += 1;
    }
    for (new_edges) |new_edge| {
        edges[initialized_edges] = try ownedNewEdge(allocator, new_edge);
        initialized_edges += 1;
    }

    const anchors = try allocator.alloc(types.WallAnchor, source.walls.anchors.len);
    var initialized_anchors: usize = 0;
    errdefer {
        for (anchors[0..initialized_anchors]) |*anchor| anchor.deinit(allocator);
        if (anchors.len != 0) allocator.free(anchors);
    }
    for (source.walls.anchors, 0..) |anchor, anchor_index| {
        anchors[initialized_anchors] = if (findAnchorAdjustment(anchor_adjustments, anchor_index)) |adjustment|
            try cloneAdjustedAnchor(allocator, anchor, adjustment)
        else
            try cloneAnchor(allocator, anchor);
        initialized_anchors += 1;
    }

    return .{
        .version = source.version,
        .revision = revision_after,
        .walls = .{
            .vertices = vertices,
            .edges = edges,
            .anchors = anchors,
        },
    };
}

fn containsIndex(indices: []const usize, wanted: usize) bool {
    return std.mem.indexOfScalar(usize, indices, wanted) != null;
}

fn findAnchorAdjustment(adjustments: []const AnchorAdjustment, source_anchor_index: usize) ?AnchorAdjustment {
    for (adjustments) |adjustment| {
        if (adjustment.source_anchor_index == source_anchor_index) return adjustment;
    }
    return null;
}

fn cloneVertex(allocator: std.mem.Allocator, vertex: types.WallVertex) std.mem.Allocator.Error!types.WallVertex {
    return .{
        .id = try allocator.dupe(u8, vertex.id),
        .floor = vertex.floor,
        .x_u = vertex.x_u,
        .z_u = vertex.z_u,
    };
}

fn cloneEdge(allocator: std.mem.Allocator, edge: types.WallEdge) std.mem.Allocator.Error!types.WallEdge {
    const id = try allocator.dupe(u8, edge.id);
    errdefer allocator.free(id);
    const start_vertex_id = try allocator.dupe(u8, edge.start_vertex_id);
    errdefer allocator.free(start_vertex_id);
    const end_vertex_id = try allocator.dupe(u8, edge.end_vertex_id);
    errdefer allocator.free(end_vertex_id);
    var support = try cloneWallSupport(allocator, edge.support);
    errdefer support.deinit(allocator);
    const style_id = try allocator.dupe(u8, edge.style_id);
    errdefer allocator.free(style_id);
    const side_a_material_id = try allocator.dupe(u8, edge.side_a.material_id);
    errdefer allocator.free(side_a_material_id);
    const side_b_material_id = try allocator.dupe(u8, edge.side_b.material_id);
    errdefer allocator.free(side_b_material_id);
    const openings = try allocator.alloc(types.WallOpening, edge.openings.len);
    var initialized_openings: usize = 0;
    errdefer {
        for (openings[0..initialized_openings]) |*opening| opening.deinit(allocator);
        if (openings.len != 0) allocator.free(openings);
    }
    for (edge.openings) |opening| {
        openings[initialized_openings] = try cloneOpening(allocator, opening);
        initialized_openings += 1;
    }
    return .{
        .id = id,
        .start_vertex_id = start_vertex_id,
        .end_vertex_id = end_vertex_id,
        .support = support,
        .height_u = edge.height_u,
        .thickness_u = edge.thickness_u,
        .profile = edge.profile,
        .style_id = style_id,
        .side_a = .{ .material_id = side_a_material_id },
        .side_b = .{ .material_id = side_b_material_id },
        .openings = openings,
    };
}

fn ownedNewEdge(allocator: std.mem.Allocator, edge: NewEdge) std.mem.Allocator.Error!types.WallEdge {
    const id = try allocator.dupe(u8, edge.id);
    errdefer allocator.free(id);
    const start_vertex_id = try allocator.dupe(u8, edge.start_vertex_id);
    errdefer allocator.free(start_vertex_id);
    const end_vertex_id = try allocator.dupe(u8, edge.end_vertex_id);
    errdefer allocator.free(end_vertex_id);
    var support = try ownedPlannedSupport(allocator, edge.support);
    errdefer support.deinit(allocator);
    const style_id = try allocator.dupe(u8, edge.style_id);
    errdefer allocator.free(style_id);
    const side_a_material_id = try allocator.dupe(u8, edge.side_a_material_id);
    errdefer allocator.free(side_a_material_id);
    const side_b_material_id = try allocator.dupe(u8, edge.side_b_material_id);
    errdefer allocator.free(side_b_material_id);
    const openings = try allocator.alloc(types.WallOpening, edge.openings.len);
    var initialized_openings: usize = 0;
    errdefer {
        for (openings[0..initialized_openings]) |*opening| opening.deinit(allocator);
        if (openings.len != 0) allocator.free(openings);
    }
    for (edge.openings) |opening| {
        openings[initialized_openings] = try cloneOpening(allocator, opening);
        initialized_openings += 1;
    }
    return .{
        .id = id,
        .start_vertex_id = start_vertex_id,
        .end_vertex_id = end_vertex_id,
        .support = support,
        .height_u = edge.height_u,
        .thickness_u = edge.thickness_u,
        .profile = edge.profile,
        .style_id = style_id,
        .side_a = .{ .material_id = side_a_material_id },
        .side_b = .{ .material_id = side_b_material_id },
        .openings = openings,
    };
}

fn cloneOpening(allocator: std.mem.Allocator, opening: types.WallOpening) std.mem.Allocator.Error!types.WallOpening {
    const id = try allocator.dupe(u8, opening.id);
    errdefer allocator.free(id);
    const kit_id = try allocator.dupe(u8, opening.kit_id);
    errdefer allocator.free(kit_id);
    return .{
        .id = id,
        .kind = opening.kind,
        .kit_id = kit_id,
        .column_u = opening.column_u,
        .row_u = opening.row_u,
        .facing_side = opening.facing_side,
        .hinge = opening.hinge,
    };
}

fn cloneAnchor(allocator: std.mem.Allocator, anchor: types.WallAnchor) std.mem.Allocator.Error!types.WallAnchor {
    const id = try allocator.dupe(u8, anchor.id);
    errdefer allocator.free(id);
    const edge_id = try allocator.dupe(u8, anchor.edge_id);
    errdefer allocator.free(edge_id);
    const target_piece_id = try allocator.dupe(u8, anchor.target_piece_id);
    errdefer allocator.free(target_piece_id);
    return .{
        .id = id,
        .edge_id = edge_id,
        .side = anchor.side,
        .column_u = anchor.column_u,
        .row_u = anchor.row_u,
        .target_piece_id = target_piece_id,
    };
}

fn cloneAdjustedAnchor(
    allocator: std.mem.Allocator,
    anchor: types.WallAnchor,
    adjustment: AnchorAdjustment,
) std.mem.Allocator.Error!types.WallAnchor {
    const id = try allocator.dupe(u8, anchor.id);
    errdefer allocator.free(id);
    const edge_id = try allocator.dupe(u8, adjustment.successor_edge_id);
    errdefer allocator.free(edge_id);
    const target_piece_id = try allocator.dupe(u8, anchor.target_piece_id);
    errdefer allocator.free(target_piece_id);
    return .{
        .id = id,
        .edge_id = edge_id,
        .side = anchor.side,
        .column_u = adjustment.new_column_u,
        .row_u = anchor.row_u,
        .target_piece_id = target_piece_id,
    };
}

fn cloneWallSupport(allocator: std.mem.Allocator, support: types.WallSupport) std.mem.Allocator.Error!types.WallSupport {
    return switch (support) {
        .absolute => |value| .{ .absolute = .{ .base_y_u = value.base_y_u } },
        .slab => |value| .{ .slab = .{
            .slab_id = try allocator.dupe(u8, value.slab_id),
            .join = value.join,
        } },
    };
}

fn ownedPlannedSupport(allocator: std.mem.Allocator, support: PlannedSupport) std.mem.Allocator.Error!types.WallSupport {
    return switch (support) {
        .absolute => |value| .{ .absolute = .{ .base_y_u = value.base_y_u } },
        .slab => |value| .{ .slab = .{
            .slab_id = try allocator.dupe(u8, value.slab_id),
            .join = value.join,
        } },
    };
}

fn buildDrawReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    new_vertices: []const NewVertex,
    new_edges: []const NewEdge,
    removed_edge_indices: []const usize,
    split_lineage: []const SplitLineagePlan,
    planned_opening_remaps: []const SurfaceRemapPlan,
    planned_anchor_remaps: []const SurfaceRemapPlan,
) std.mem.Allocator.Error!types.MutationReceipt {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    const created = try allocator.alloc(types.RecordRef, new_vertices.len + new_edges.len);
    var initialized_created: usize = 0;
    errdefer {
        for (created[0..initialized_created]) |*record| record.deinit(allocator);
        if (created.len != 0) allocator.free(created);
    }
    for (new_vertices) |vertex| {
        created[initialized_created] = .{
            .family = .vertex,
            .id = try allocator.dupe(u8, vertex.id),
        };
        initialized_created += 1;
    }
    for (new_edges) |new_edge| {
        created[initialized_created] = .{
            .family = .edge,
            .id = try allocator.dupe(u8, new_edge.id),
        };
        initialized_created += 1;
    }

    var patches = PatchBuilders.init(allocator);
    defer patches.deinit();
    for (removed_edge_indices) |edge_index| {
        const predecessor = before.walls.edges[edge_index];
        var operation = try snapshotOperation(allocator, before, .edge, predecessor.id, .remove);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    for (new_vertices) |vertex| {
        var operation = try snapshotOperation(allocator, after, .vertex, vertex.id, .insert);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    for (new_edges) |new_edge| {
        var operation = try snapshotOperation(allocator, after, .edge, new_edge.id, .insert);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    for (planned_anchor_remaps) |remap| {
        var operation = try deltaOperation(allocator, before, after, .anchor, remap.child_id, false);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    var inverse_anchor_index = planned_anchor_remaps.len;
    while (inverse_anchor_index > 0) {
        inverse_anchor_index -= 1;
        const remap = planned_anchor_remaps[inverse_anchor_index];
        var operation = try deltaOperation(allocator, before, after, .anchor, remap.child_id, true);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    var inverse_edge_index = new_edges.len;
    while (inverse_edge_index > 0) {
        inverse_edge_index -= 1;
        const new_edge = new_edges[inverse_edge_index];
        var operation = try snapshotOperation(allocator, after, .edge, new_edge.id, .remove);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    var inverse_vertex_index = new_vertices.len;
    while (inverse_vertex_index > 0) {
        inverse_vertex_index -= 1;
        const vertex = new_vertices[inverse_vertex_index];
        var operation = try snapshotOperation(allocator, after, .vertex, vertex.id, .remove);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    for (removed_edge_indices) |edge_index| {
        const predecessor = before.walls.edges[edge_index];
        var operation = try snapshotOperation(allocator, before, .edge, predecessor.id, .insert);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    const forward_operations = try patches.takeForward();
    errdefer deinitPatchOperations(allocator, forward_operations);
    const inverse_operations = try patches.takeInverse();
    errdefer deinitPatchOperations(allocator, inverse_operations);

    const updated = try buildSurfaceDeltas(
        allocator,
        before,
        after,
        planned_opening_remaps,
        planned_anchor_remaps,
    );
    errdefer deinitRecordDeltas(allocator, updated);
    const removed = try allocator.alloc(types.RecordSnapshot, removed_edge_indices.len);
    var initialized_removed: usize = 0;
    errdefer {
        for (removed[0..initialized_removed]) |*snapshot| snapshot.deinit(allocator);
        if (removed.len != 0) allocator.free(removed);
    }
    for (removed_edge_indices) |edge_index| {
        const predecessor = before.walls.edges[edge_index];
        removed[initialized_removed] = try recordSnapshot(allocator, before, .edge, predecessor.id);
        initialized_removed += 1;
    }
    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, split_lineage.len);
    var initialized_edge_remaps: usize = 0;
    errdefer {
        for (edge_child_remaps[0..initialized_edge_remaps]) |*remap| remap.deinit(allocator);
        if (edge_child_remaps.len != 0) allocator.free(edge_child_remaps);
    }
    for (split_lineage) |lineage| {
        const predecessor = before.walls.edges[lineage.predecessor_edge_index];
        const predecessor_edge_id = try allocator.dupe(u8, predecessor.id);
        errdefer allocator.free(predecessor_edge_id);
        const child_edge_ids = try cloneStringList(allocator, &.{ lineage.first_child_id, lineage.second_child_id });
        errdefer freeStringList(allocator, child_edge_ids);
        const child_start_columns_u = try allocator.dupe(types.Unit, &.{ 0, lineage.split_column_u });
        errdefer allocator.free(child_start_columns_u);
        edge_child_remaps[initialized_edge_remaps] = .{
            .predecessor_edge_id = predecessor_edge_id,
            .child_edge_ids = child_edge_ids,
            .child_start_columns_u = child_start_columns_u,
        };
        initialized_edge_remaps += 1;
    }
    const opening_remaps = try ownSurfaceRemaps(allocator, planned_opening_remaps);
    errdefer deinitSurfaceRemaps(allocator, opening_remaps);
    const anchor_remaps = try ownSurfaceRemaps(allocator, planned_anchor_remaps);
    errdefer deinitSurfaceRemaps(allocator, anchor_remaps);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);

    const affected_bounds = try allocator.alloc(types.AffectedBounds, 1);
    errdefer allocator.free(affected_bounds);
    affected_bounds[0] = drawAffectedBounds(after, new_edges);

    const dirty_values = [_]types.DirtyTarget{
        .topology,
        .render,
        .collision,
        .cover,
        .materials,
        .doors_portals,
        .navigation,
        .rooms,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, &dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = before.revision,
            .result_revision = after.revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = after.revision,
            .result_revision = before.revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

fn buildOpeningReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    edge_id: []const u8,
    opening_id: []const u8,
    change_kind: OpeningChangeKind,
) std.mem.Allocator.Error!types.MutationReceipt {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    const created_count: usize = if (change_kind == .insert) 1 else 0;
    const created = try allocator.alloc(types.RecordRef, created_count);
    var initialized_created: usize = 0;
    errdefer {
        for (created[0..initialized_created]) |*value| value.deinit(allocator);
        if (created.len != 0) allocator.free(created);
    }
    if (change_kind == .insert) {
        created[0] = .{ .family = .opening, .id = try allocator.dupe(u8, opening_id) };
        initialized_created = 1;
    }

    const updated_count: usize = if (change_kind == .update) 2 else 1;
    const updated = try allocator.alloc(types.RecordDelta, updated_count);
    var initialized_updated: usize = 0;
    errdefer {
        for (updated[0..initialized_updated]) |*value| value.deinit(allocator);
        if (updated.len != 0) allocator.free(updated);
    }
    updated[initialized_updated] = try recordDelta(allocator, before, after, .edge, edge_id);
    initialized_updated += 1;
    if (change_kind == .update) {
        updated[initialized_updated] = try recordDelta(allocator, before, after, .opening, opening_id);
        initialized_updated += 1;
    }

    const removed_count: usize = if (change_kind == .delete) 1 else 0;
    const removed = try allocator.alloc(types.RecordSnapshot, removed_count);
    var initialized_removed: usize = 0;
    errdefer {
        for (removed[0..initialized_removed]) |*value| value.deinit(allocator);
        if (removed.len != 0) allocator.free(removed);
    }
    if (change_kind == .delete) {
        removed[0] = try recordSnapshot(allocator, before, .opening, opening_id);
        initialized_removed = 1;
    }

    const forward_operations = try allocator.alloc(types.PatchOperation, 1);
    errdefer allocator.free(forward_operations);
    forward_operations[0] = try deltaOperation(allocator, before, after, .edge, edge_id, false);
    errdefer forward_operations[0].deinit(allocator);
    const inverse_operations = try allocator.alloc(types.PatchOperation, 1);
    errdefer allocator.free(inverse_operations);
    inverse_operations[0] = try deltaOperation(allocator, before, after, .edge, edge_id, true);
    errdefer inverse_operations[0].deinit(allocator);

    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, 0);
    const opening_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const anchor_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);
    const affected_bounds = try allocator.alloc(types.AffectedBounds, 1);
    errdefer allocator.free(affected_bounds);
    affected_bounds[0] = edgeAffectedBounds(after, findEdgeById(after, edge_id).?);
    const dirty_values = [_]types.DirtyTarget{
        .render,
        .collision,
        .cover,
        .doors_portals,
        .navigation,
        .rooms,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, &dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = before.revision,
            .result_revision = after.revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = after.revision,
            .result_revision = before.revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

fn buildAnchorReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    edge_id: []const u8,
    anchor_id: []const u8,
    change_kind: AnchorChangeKind,
) std.mem.Allocator.Error!types.MutationReceipt {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    const created = try allocator.alloc(types.RecordRef, if (change_kind == .insert) 1 else 0);
    var initialized_created: usize = 0;
    errdefer {
        for (created[0..initialized_created]) |*value| value.deinit(allocator);
        if (created.len != 0) allocator.free(created);
    }
    if (change_kind == .insert) {
        created[0] = .{ .family = .anchor, .id = try allocator.dupe(u8, anchor_id) };
        initialized_created = 1;
    }
    const updated = try allocator.alloc(types.RecordDelta, 0);
    const removed = try allocator.alloc(types.RecordSnapshot, if (change_kind == .delete) 1 else 0);
    var initialized_removed: usize = 0;
    errdefer {
        for (removed[0..initialized_removed]) |*value| value.deinit(allocator);
        if (removed.len != 0) allocator.free(removed);
    }
    if (change_kind == .delete) {
        removed[0] = try recordSnapshot(allocator, before, .anchor, anchor_id);
        initialized_removed = 1;
    }

    const forward_operations = try allocator.alloc(types.PatchOperation, 1);
    errdefer allocator.free(forward_operations);
    forward_operations[0] = if (change_kind == .insert)
        try snapshotOperation(allocator, after, .anchor, anchor_id, .insert)
    else
        try snapshotOperation(allocator, before, .anchor, anchor_id, .remove);
    errdefer forward_operations[0].deinit(allocator);
    const inverse_operations = try allocator.alloc(types.PatchOperation, 1);
    errdefer allocator.free(inverse_operations);
    inverse_operations[0] = if (change_kind == .insert)
        try snapshotOperation(allocator, after, .anchor, anchor_id, .remove)
    else
        try snapshotOperation(allocator, before, .anchor, anchor_id, .insert);
    errdefer inverse_operations[0].deinit(allocator);

    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, 0);
    const opening_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const anchor_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);
    const affected_bounds = try allocator.alloc(types.AffectedBounds, 1);
    errdefer allocator.free(affected_bounds);
    affected_bounds[0] = edgeAffectedBounds(before, findEdgeById(before, edge_id).?);
    const dirty_values = [_]types.DirtyTarget{
        .render,
        .collision,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, &dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = before.revision,
            .result_revision = after.revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = after.revision,
            .result_revision = before.revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

fn buildEdgeEditReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    edge_id: []const u8,
    edit_kind: EdgeEditKind,
) std.mem.Allocator.Error!types.MutationReceipt {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    const created = try allocator.alloc(types.RecordRef, 0);
    const updated = try allocator.alloc(types.RecordDelta, 1);
    errdefer allocator.free(updated);
    updated[0] = try recordDelta(allocator, before, after, .edge, edge_id);
    errdefer updated[0].deinit(allocator);
    const removed = try allocator.alloc(types.RecordSnapshot, 0);

    const forward_operations = try allocator.alloc(types.PatchOperation, 1);
    errdefer allocator.free(forward_operations);
    forward_operations[0] = try deltaOperation(allocator, before, after, .edge, edge_id, false);
    errdefer forward_operations[0].deinit(allocator);
    const inverse_operations = try allocator.alloc(types.PatchOperation, 1);
    errdefer allocator.free(inverse_operations);
    inverse_operations[0] = try deltaOperation(allocator, before, after, .edge, edge_id, true);
    errdefer inverse_operations[0].deinit(allocator);

    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, 0);
    const opening_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const anchor_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);
    const affected_bounds = try allocator.alloc(types.AffectedBounds, 1);
    errdefer allocator.free(affected_bounds);
    affected_bounds[0] = unionAffectedBounds(
        edgeAffectedBounds(before, findEdgeById(before, edge_id).?),
        edgeAffectedBounds(after, findEdgeById(after, edge_id).?),
    );

    const structural_dirty = [_]types.DirtyTarget{
        .topology,
        .render,
        .collision,
        .cover,
        .materials,
        .doors_portals,
        .navigation,
        .rooms,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const style_dirty = [_]types.DirtyTarget{
        .render,
        .collision,
        .materials,
        .pick_proxies,
    };
    const finish_dirty = [_]types.DirtyTarget{
        .render,
        .materials,
    };
    const dirty_values: []const types.DirtyTarget = switch (edit_kind) {
        .dimensions, .profile => &structural_dirty,
        .style => &style_dirty,
        .side_finish => &finish_dirty,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = before.revision,
            .result_revision = after.revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = after.revision,
            .result_revision = before.revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

fn buildDeletionReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    removed_edges: []const bool,
    removed_vertices: []const bool,
) std.mem.Allocator.Error!types.MutationReceipt {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    var removed_vertex_count: usize = 0;
    for (removed_vertices) |removed| if (removed) {
        removed_vertex_count += 1;
    };
    var removed_edge_count: usize = 0;
    var removed_opening_count: usize = 0;
    for (before.walls.edges, 0..) |edge, edge_index| {
        if (!removed_edges[edge_index]) continue;
        removed_edge_count += 1;
        removed_opening_count += edge.openings.len;
    }
    var removed_anchor_count: usize = 0;
    for (before.walls.anchors) |anchor| if (edgeIdIsRemoved(before, removed_edges, anchor.edge_id)) {
        removed_anchor_count += 1;
    };

    const created = try allocator.alloc(types.RecordRef, 0);
    const updated = try allocator.alloc(types.RecordDelta, 0);
    const removed = try allocator.alloc(
        types.RecordSnapshot,
        removed_vertex_count + removed_edge_count + removed_opening_count + removed_anchor_count,
    );
    var initialized_removed: usize = 0;
    errdefer {
        for (removed[0..initialized_removed]) |*snapshot| snapshot.deinit(allocator);
        if (removed.len != 0) allocator.free(removed);
    }
    for (before.walls.vertices, 0..) |vertex, vertex_index| {
        if (!removed_vertices[vertex_index]) continue;
        removed[initialized_removed] = try recordSnapshot(allocator, before, .vertex, vertex.id);
        initialized_removed += 1;
    }
    for (before.walls.edges, 0..) |edge, edge_index| {
        if (!removed_edges[edge_index]) continue;
        removed[initialized_removed] = try recordSnapshot(allocator, before, .edge, edge.id);
        initialized_removed += 1;
    }
    for (before.walls.edges, 0..) |edge, edge_index| {
        if (!removed_edges[edge_index]) continue;
        for (edge.openings) |opening| {
            removed[initialized_removed] = try recordSnapshot(allocator, before, .opening, opening.id);
            initialized_removed += 1;
        }
    }
    for (before.walls.anchors) |anchor| {
        if (!edgeIdIsRemoved(before, removed_edges, anchor.edge_id)) continue;
        removed[initialized_removed] = try recordSnapshot(allocator, before, .anchor, anchor.id);
        initialized_removed += 1;
    }

    var patches = PatchBuilders.init(allocator);
    defer patches.deinit();
    for (before.walls.anchors) |anchor| {
        if (!edgeIdIsRemoved(before, removed_edges, anchor.edge_id)) continue;
        var operation = try snapshotOperation(allocator, before, .anchor, anchor.id, .remove);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    for (before.walls.edges, 0..) |edge, edge_index| {
        if (!removed_edges[edge_index]) continue;
        var operation = try snapshotOperation(allocator, before, .edge, edge.id, .remove);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    for (before.walls.vertices, 0..) |vertex, vertex_index| {
        if (!removed_vertices[vertex_index]) continue;
        var operation = try snapshotOperation(allocator, before, .vertex, vertex.id, .remove);
        errdefer operation.deinit(allocator);
        try patches.appendForward(operation);
    }
    for (before.walls.vertices, 0..) |vertex, vertex_index| {
        if (!removed_vertices[vertex_index]) continue;
        var operation = try snapshotOperation(allocator, before, .vertex, vertex.id, .insert);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    for (before.walls.edges, 0..) |edge, edge_index| {
        if (!removed_edges[edge_index]) continue;
        var operation = try snapshotOperation(allocator, before, .edge, edge.id, .insert);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    for (before.walls.anchors) |anchor| {
        if (!edgeIdIsRemoved(before, removed_edges, anchor.edge_id)) continue;
        var operation = try snapshotOperation(allocator, before, .anchor, anchor.id, .insert);
        errdefer operation.deinit(allocator);
        try patches.appendInverse(operation);
    }
    const forward_operations = try patches.takeForward();
    errdefer deinitPatchOperations(allocator, forward_operations);
    const inverse_operations = try patches.takeInverse();
    errdefer deinitPatchOperations(allocator, inverse_operations);

    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, 0);
    const opening_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const anchor_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);
    const affected_bounds = try allocator.alloc(types.AffectedBounds, if (removed_edge_count == 0) 0 else 1);
    errdefer if (affected_bounds.len != 0) allocator.free(affected_bounds);
    if (removed_edge_count != 0) {
        var initialized_bounds = false;
        for (before.walls.edges, 0..) |edge, edge_index| {
            if (!removed_edges[edge_index]) continue;
            const bounds = edgeAffectedBounds(before, &edge);
            if (initialized_bounds) {
                affected_bounds[0] = unionAffectedBounds(affected_bounds[0], bounds);
            } else {
                affected_bounds[0] = bounds;
                initialized_bounds = true;
            }
        }
    }
    const dirty_values = [_]types.DirtyTarget{
        .topology,
        .render,
        .collision,
        .cover,
        .materials,
        .doors_portals,
        .navigation,
        .rooms,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, &dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = before.revision,
            .result_revision = after.revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = after.revision,
            .result_revision = before.revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

fn buildAppliedPatchReceipt(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    command: Command,
    patch: *const types.ArchitecturePatch,
) std.mem.Allocator.Error!types.MutationReceipt {
    const command_id = try allocator.dupe(u8, command.command_id);
    errdefer allocator.free(command_id);
    const source_hash_before = try hashSource(allocator, before);
    errdefer allocator.free(source_hash_before);
    const source_hash_after = try hashSource(allocator, after);
    errdefer allocator.free(source_hash_after);

    var created_count: usize = 0;
    var updated_count: usize = 0;
    var removed_count: usize = 0;
    for (patch.operations) |operation| switch (operation) {
        .insert => created_count += 1,
        .replace => updated_count += 1,
        .remove => removed_count += 1,
    };

    const created = try allocator.alloc(types.RecordRef, created_count);
    var initialized_created: usize = 0;
    errdefer {
        for (created[0..initialized_created]) |*value| value.deinit(allocator);
        if (created.len != 0) allocator.free(created);
    }
    const updated = try allocator.alloc(types.RecordDelta, updated_count);
    var initialized_updated: usize = 0;
    errdefer {
        for (updated[0..initialized_updated]) |*value| value.deinit(allocator);
        if (updated.len != 0) allocator.free(updated);
    }
    const removed = try allocator.alloc(types.RecordSnapshot, removed_count);
    var initialized_removed: usize = 0;
    errdefer {
        for (removed[0..initialized_removed]) |*value| value.deinit(allocator);
        if (removed.len != 0) allocator.free(removed);
    }
    for (patch.operations) |operation| switch (operation) {
        .insert => |snapshot| {
            created[initialized_created] = .{
                .family = snapshot.family,
                .id = try allocator.dupe(u8, snapshot.id),
            };
            initialized_created += 1;
        },
        .replace => |delta| {
            updated[initialized_updated] = try cloneRecordDelta(allocator, delta);
            initialized_updated += 1;
        },
        .remove => |snapshot| {
            removed[initialized_removed] = try cloneRecordSnapshot(allocator, snapshot);
            initialized_removed += 1;
        },
    };
    std.mem.sort(types.RecordRef, created, {}, recordRefLessThan);
    std.mem.sort(types.RecordDelta, updated, {}, recordDeltaLessThan);
    std.mem.sort(types.RecordSnapshot, removed, {}, recordSnapshotLessThan);

    const forward_operations = try clonePatchOperations(allocator, patch.operations);
    errdefer deinitPatchOperations(allocator, forward_operations);
    const inverse_operations = try allocator.alloc(types.PatchOperation, patch.operations.len);
    var initialized_inverse: usize = 0;
    errdefer {
        for (inverse_operations[0..initialized_inverse]) |*operation| operation.deinit(allocator);
        if (inverse_operations.len != 0) allocator.free(inverse_operations);
    }
    var source_index = patch.operations.len;
    while (source_index > 0) {
        source_index -= 1;
        inverse_operations[initialized_inverse] = try invertedPatchOperation(allocator, patch.operations[source_index]);
        initialized_inverse += 1;
    }

    const edge_child_remaps = try allocator.alloc(types.EdgeChildRemap, 0);
    const opening_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const anchor_remaps = try allocator.alloc(types.SurfaceChildRemap, 0);
    const face_lineage = try allocator.alloc(types.FaceLineage, 0);
    const affected_bounds = try allocator.alloc(types.AffectedBounds, 0);
    const dirty_values = [_]types.DirtyTarget{
        .topology,
        .render,
        .collision,
        .cover,
        .materials,
        .doors_portals,
        .navigation,
        .rooms,
        .visibility,
        .audio,
        .pick_proxies,
    };
    const dirty_targets = try allocator.dupe(types.DirtyTarget, &dirty_values);
    errdefer allocator.free(dirty_targets);

    return .{
        .command_id = command_id,
        .source_revision_before = before.revision,
        .source_revision_after = after.revision,
        .source_hash_before = source_hash_before,
        .source_hash_after = source_hash_after,
        .created = created,
        .updated = updated,
        .removed = removed,
        .edge_child_remaps = edge_child_remaps,
        .opening_remaps = opening_remaps,
        .anchor_remaps = anchor_remaps,
        .face_lineage = face_lineage,
        .forward_patch = .{
            .expected_revision = patch.expected_revision,
            .result_revision = patch.result_revision,
            .operations = forward_operations,
        },
        .inverse_patch = .{
            .expected_revision = patch.result_revision,
            .result_revision = patch.expected_revision,
            .operations = inverse_operations,
        },
        .affected_bounds = affected_bounds,
        .dirty_targets = dirty_targets,
    };
}

fn clonePatchOperations(
    allocator: std.mem.Allocator,
    operations: []const types.PatchOperation,
) std.mem.Allocator.Error![]types.PatchOperation {
    const result = try allocator.alloc(types.PatchOperation, operations.len);
    var initialized: usize = 0;
    errdefer {
        for (result[0..initialized]) |*operation| operation.deinit(allocator);
        if (result.len != 0) allocator.free(result);
    }
    for (operations) |operation| {
        result[initialized] = try clonePatchOperation(allocator, operation);
        initialized += 1;
    }
    return result;
}

fn clonePatchOperation(
    allocator: std.mem.Allocator,
    operation: types.PatchOperation,
) std.mem.Allocator.Error!types.PatchOperation {
    return switch (operation) {
        .insert => |snapshot| .{ .insert = try cloneRecordSnapshot(allocator, snapshot) },
        .replace => |delta| .{ .replace = try cloneRecordDelta(allocator, delta) },
        .remove => |snapshot| .{ .remove = try cloneRecordSnapshot(allocator, snapshot) },
    };
}

fn invertedPatchOperation(
    allocator: std.mem.Allocator,
    operation: types.PatchOperation,
) std.mem.Allocator.Error!types.PatchOperation {
    return switch (operation) {
        .insert => |snapshot| .{ .remove = try cloneRecordSnapshot(allocator, snapshot) },
        .remove => |snapshot| .{ .insert = try cloneRecordSnapshot(allocator, snapshot) },
        .replace => |delta| inverse: {
            var cloned = try cloneRecordDelta(allocator, delta);
            std.mem.swap([]u8, &cloned.before_canonical_bytes, &cloned.after_canonical_bytes);
            break :inverse .{ .replace = cloned };
        },
    };
}

fn cloneRecordSnapshot(
    allocator: std.mem.Allocator,
    snapshot: types.RecordSnapshot,
) std.mem.Allocator.Error!types.RecordSnapshot {
    const id = try allocator.dupe(u8, snapshot.id);
    errdefer allocator.free(id);
    const canonical_bytes = try allocator.dupe(u8, snapshot.canonical_bytes);
    errdefer allocator.free(canonical_bytes);
    return .{ .family = snapshot.family, .id = id, .canonical_bytes = canonical_bytes };
}

fn cloneRecordDelta(
    allocator: std.mem.Allocator,
    delta: types.RecordDelta,
) std.mem.Allocator.Error!types.RecordDelta {
    const id = try allocator.dupe(u8, delta.id);
    errdefer allocator.free(id);
    const before_bytes = try allocator.dupe(u8, delta.before_canonical_bytes);
    errdefer allocator.free(before_bytes);
    const after_bytes = try allocator.dupe(u8, delta.after_canonical_bytes);
    errdefer allocator.free(after_bytes);
    return .{
        .family = delta.family,
        .id = id,
        .before_canonical_bytes = before_bytes,
        .after_canonical_bytes = after_bytes,
    };
}

fn recordRefLessThan(_: void, left: types.RecordRef, right: types.RecordRef) bool {
    if (left.family != right.family) return @intFromEnum(left.family) < @intFromEnum(right.family);
    return std.mem.lessThan(u8, left.id, right.id);
}

fn recordDeltaLessThan(_: void, left: types.RecordDelta, right: types.RecordDelta) bool {
    if (left.family != right.family) return @intFromEnum(left.family) < @intFromEnum(right.family);
    return std.mem.lessThan(u8, left.id, right.id);
}

fn recordSnapshotLessThan(_: void, left: types.RecordSnapshot, right: types.RecordSnapshot) bool {
    if (left.family != right.family) return @intFromEnum(left.family) < @intFromEnum(right.family);
    return std.mem.lessThan(u8, left.id, right.id);
}

fn unionAffectedBounds(left: types.AffectedBounds, right: types.AffectedBounds) types.AffectedBounds {
    std.debug.assert(left.floor == right.floor);
    return .{
        .floor = left.floor,
        .min_x_u = @min(left.min_x_u, right.min_x_u),
        .min_y_u = @min(left.min_y_u, right.min_y_u),
        .min_z_u = @min(left.min_z_u, right.min_z_u),
        .max_x_u_exclusive = @max(left.max_x_u_exclusive, right.max_x_u_exclusive),
        .max_y_u_exclusive = @max(left.max_y_u_exclusive, right.max_y_u_exclusive),
        .max_z_u_exclusive = @max(left.max_z_u_exclusive, right.max_z_u_exclusive),
    };
}

fn edgeAffectedBounds(source: *const types.ArchitectureSource, edge: *const types.WallEdge) types.AffectedBounds {
    const start = findVertexById(source, edge.start_vertex_id).?;
    const end = findVertexById(source, edge.end_vertex_id).?;
    const thickness_radius: types.Unit = @divTrunc(edge.thickness_u + 1, 2);
    const min_y_u: types.Unit = switch (edge.support) {
        .absolute => |support| support.base_y_u,
        .slab => types.Limits.minimum_unit,
    };
    const max_y_u_exclusive: types.Unit = switch (edge.support) {
        .absolute => min_y_u + edge.height_u,
        .slab => types.Limits.maximum_unit + 1,
    };
    return .{
        .floor = start.floor,
        .min_x_u = @min(start.x_u, end.x_u) - thickness_radius,
        .min_y_u = min_y_u,
        .min_z_u = @min(start.z_u, end.z_u) - thickness_radius,
        .max_x_u_exclusive = @max(start.x_u, end.x_u) + thickness_radius,
        .max_y_u_exclusive = max_y_u_exclusive,
        .max_z_u_exclusive = @max(start.z_u, end.z_u) + thickness_radius,
    };
}

fn drawAffectedBounds(after: *const types.ArchitectureSource, new_edges: []const NewEdge) types.AffectedBounds {
    std.debug.assert(new_edges.len != 0);
    var result: types.AffectedBounds = undefined;
    for (new_edges, 0..) |edge_data, index| {
        const start = findVertexById(after, edge_data.start_vertex_id).?;
        const end = findVertexById(after, edge_data.end_vertex_id).?;
        const thickness_radius: types.Unit = @divTrunc(edge_data.thickness_u + 1, 2);
        const min_y_u: types.Unit = switch (edge_data.support) {
            .absolute => |support| support.base_y_u,
            .slab => types.Limits.minimum_unit,
        };
        const max_y_u_exclusive: types.Unit = switch (edge_data.support) {
            .absolute => min_y_u + edge_data.height_u,
            .slab => types.Limits.maximum_unit + 1,
        };
        const edge_bounds = types.AffectedBounds{
            .floor = start.floor,
            .min_x_u = @min(start.x_u, end.x_u) - thickness_radius,
            .min_y_u = min_y_u,
            .min_z_u = @min(start.z_u, end.z_u) - thickness_radius,
            .max_x_u_exclusive = @max(start.x_u, end.x_u) + thickness_radius,
            .max_y_u_exclusive = max_y_u_exclusive,
            .max_z_u_exclusive = @max(start.z_u, end.z_u) + thickness_radius,
        };
        if (index == 0) {
            result = edge_bounds;
        } else {
            result.min_x_u = @min(result.min_x_u, edge_bounds.min_x_u);
            result.min_y_u = @min(result.min_y_u, edge_bounds.min_y_u);
            result.min_z_u = @min(result.min_z_u, edge_bounds.min_z_u);
            result.max_x_u_exclusive = @max(result.max_x_u_exclusive, edge_bounds.max_x_u_exclusive);
            result.max_y_u_exclusive = @max(result.max_y_u_exclusive, edge_bounds.max_y_u_exclusive);
            result.max_z_u_exclusive = @max(result.max_z_u_exclusive, edge_bounds.max_z_u_exclusive);
        }
    }
    return result;
}

fn snapshotOperation(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    family: types.RecordFamily,
    id: []const u8,
    kind: types.PatchOperationKind,
) std.mem.Allocator.Error!types.PatchOperation {
    const snapshot = try recordSnapshot(allocator, source, family, id);
    return switch (kind) {
        .insert => .{ .insert = snapshot },
        .remove => .{ .remove = snapshot },
        .replace => unreachable,
    };
}

fn recordSnapshot(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    family: types.RecordFamily,
    id: []const u8,
) std.mem.Allocator.Error!types.RecordSnapshot {
    const owned_id = try allocator.dupe(u8, id);
    errdefer allocator.free(owned_id);
    const canonical_bytes = switch (family) {
        .vertex => try canonicalVertexBytes(allocator, findVertexById(source, id).?),
        .edge => try canonicalEdgeBytes(allocator, findEdgeById(source, id).?),
        .opening => try canonicalLocatedOpeningBytes(allocator, findOpeningById(source, id).?),
        .anchor => try canonicalAnchorBytes(allocator, findAnchorById(source, id).?),
    };
    errdefer allocator.free(canonical_bytes);
    return .{
        .family = family,
        .id = owned_id,
        .canonical_bytes = canonical_bytes,
    };
}

fn deltaOperation(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    family: types.RecordFamily,
    id: []const u8,
    reverse: bool,
) std.mem.Allocator.Error!types.PatchOperation {
    var delta = try recordDelta(allocator, before, after, family, id);
    if (reverse) std.mem.swap([]u8, &delta.before_canonical_bytes, &delta.after_canonical_bytes);
    return .{ .replace = delta };
}

fn recordDelta(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    family: types.RecordFamily,
    id: []const u8,
) std.mem.Allocator.Error!types.RecordDelta {
    var before_snapshot = try recordSnapshot(allocator, before, family, id);
    errdefer before_snapshot.deinit(allocator);
    var after_snapshot = try recordSnapshot(allocator, after, family, id);
    errdefer after_snapshot.deinit(allocator);
    const owned_id = try allocator.dupe(u8, id);
    errdefer allocator.free(owned_id);
    allocator.free(before_snapshot.id);
    allocator.free(after_snapshot.id);
    return .{
        .family = family,
        .id = owned_id,
        .before_canonical_bytes = before_snapshot.canonical_bytes,
        .after_canonical_bytes = after_snapshot.canonical_bytes,
    };
}

fn buildSurfaceDeltas(
    allocator: std.mem.Allocator,
    before: *const types.ArchitectureSource,
    after: *const types.ArchitectureSource,
    opening_plans: []const SurfaceRemapPlan,
    anchor_plans: []const SurfaceRemapPlan,
) std.mem.Allocator.Error![]types.RecordDelta {
    const deltas = try allocator.alloc(types.RecordDelta, opening_plans.len + anchor_plans.len);
    var initialized: usize = 0;
    errdefer {
        for (deltas[0..initialized]) |*delta| delta.deinit(allocator);
        if (deltas.len != 0) allocator.free(deltas);
    }
    for (opening_plans) |plan| {
        deltas[initialized] = try recordDelta(allocator, before, after, .opening, plan.child_id);
        initialized += 1;
    }
    for (anchor_plans) |plan| {
        deltas[initialized] = try recordDelta(allocator, before, after, .anchor, plan.child_id);
        initialized += 1;
    }
    return deltas;
}

fn deinitRecordDeltas(allocator: std.mem.Allocator, deltas: []types.RecordDelta) void {
    for (deltas) |*delta| delta.deinit(allocator);
    if (deltas.len != 0) allocator.free(deltas);
}

fn findEdgeById(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallEdge {
    for (source.walls.edges) |*edge| {
        if (std.mem.eql(u8, edge.id, id)) return edge;
    }
    return null;
}

const LocatedOpening = struct {
    edge_id: []const u8,
    opening: *const types.WallOpening,
};

fn findOpeningById(source: *const types.ArchitectureSource, id: []const u8) ?LocatedOpening {
    for (source.walls.edges) |*edge| {
        for (edge.openings) |*opening| {
            if (std.mem.eql(u8, opening.id, id)) return .{
                .edge_id = edge.id,
                .opening = opening,
            };
        }
    }
    return null;
}

fn findAnchorById(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallAnchor {
    for (source.walls.anchors) |*anchor| {
        if (std.mem.eql(u8, anchor.id, id)) return anchor;
    }
    return null;
}

fn canonicalVertexBytes(allocator: std.mem.Allocator, vertex: *const types.WallVertex) std.mem.Allocator.Error![]u8 {
    return types.canonicalVertexRecordBytes(allocator, vertex);
}

fn canonicalEdgeBytes(allocator: std.mem.Allocator, edge: *const types.WallEdge) std.mem.Allocator.Error![]u8 {
    return types.canonicalEdgeRecordBytes(allocator, edge);
}

fn canonicalLocatedOpeningBytes(
    allocator: std.mem.Allocator,
    located: LocatedOpening,
) std.mem.Allocator.Error![]u8 {
    return types.canonicalOpeningRecordBytes(allocator, located.edge_id, located.opening);
}

fn canonicalAnchorBytes(allocator: std.mem.Allocator, anchor: *const types.WallAnchor) std.mem.Allocator.Error![]u8 {
    return types.canonicalAnchorRecordBytes(allocator, anchor);
}

fn hashSource(allocator: std.mem.Allocator, source: *const types.ArchitectureSource) std.mem.Allocator.Error![]u8 {
    const bytes = try types.canonicalSourceBytes(allocator, source);
    defer if (bytes.len != 0) allocator.free(bytes);
    var digest: [std.crypto.hash.sha2.Sha256.digest_length]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    const hex = std.fmt.bytesToHex(digest, .lower);
    return allocator.dupe(u8, &hex);
}

fn cloneStringList(allocator: std.mem.Allocator, values: []const []const u8) std.mem.Allocator.Error![][]u8 {
    const result = try allocator.alloc([]u8, values.len);
    var initialized: usize = 0;
    errdefer {
        for (result[0..initialized]) |value| allocator.free(value);
        if (result.len != 0) allocator.free(result);
    }
    for (values) |value| {
        result[initialized] = try allocator.dupe(u8, value);
        initialized += 1;
    }
    return result;
}

fn ownSurfaceRemaps(
    allocator: std.mem.Allocator,
    plans: []const SurfaceRemapPlan,
) std.mem.Allocator.Error![]types.SurfaceChildRemap {
    const remaps = try allocator.alloc(types.SurfaceChildRemap, plans.len);
    var initialized: usize = 0;
    errdefer {
        for (remaps[0..initialized]) |*remap| remap.deinit(allocator);
        if (remaps.len != 0) allocator.free(remaps);
    }
    for (plans) |plan| {
        const child_id = try allocator.dupe(u8, plan.child_id);
        errdefer allocator.free(child_id);
        const predecessor_edge_id = try allocator.dupe(u8, plan.predecessor_edge_id);
        errdefer allocator.free(predecessor_edge_id);
        const successor_edge_id = try allocator.dupe(u8, plan.successor_edge_id);
        errdefer allocator.free(successor_edge_id);
        remaps[initialized] = .{
            .child_family = plan.child_family,
            .child_id = child_id,
            .predecessor_edge_id = predecessor_edge_id,
            .successor_edge_id = successor_edge_id,
            .old_column_u = plan.old_column_u,
            .new_column_u = plan.new_column_u,
            .row_u = plan.row_u,
        };
        initialized += 1;
    }
    return remaps;
}

fn deinitSurfaceRemaps(allocator: std.mem.Allocator, remaps: []types.SurfaceChildRemap) void {
    for (remaps) |*remap| remap.deinit(allocator);
    if (remaps.len != 0) allocator.free(remaps);
}

fn freeStringList(allocator: std.mem.Allocator, values: [][]u8) void {
    for (values) |value| if (value.len != 0) allocator.free(value);
    if (values.len != 0) allocator.free(values);
}

fn deinitPatchOperations(allocator: std.mem.Allocator, operations: []types.PatchOperation) void {
    for (operations) |*operation| operation.deinit(allocator);
    if (operations.len != 0) allocator.free(operations);
}

const PatchBuilders = struct {
    allocator: std.mem.Allocator,
    forward: std.ArrayList(types.PatchOperation),
    inverse: std.ArrayList(types.PatchOperation),

    fn init(allocator: std.mem.Allocator) PatchBuilders {
        return .{ .allocator = allocator, .forward = .empty, .inverse = .empty };
    }

    fn deinit(self: *PatchBuilders) void {
        for (self.forward.items) |*operation| operation.deinit(self.allocator);
        for (self.inverse.items) |*operation| operation.deinit(self.allocator);
        self.forward.deinit(self.allocator);
        self.inverse.deinit(self.allocator);
        self.* = undefined;
    }

    fn appendForward(self: *PatchBuilders, operation: types.PatchOperation) std.mem.Allocator.Error!void {
        try self.forward.append(self.allocator, operation);
    }

    fn appendInverse(self: *PatchBuilders, operation: types.PatchOperation) std.mem.Allocator.Error!void {
        try self.inverse.append(self.allocator, operation);
    }

    fn takeForward(self: *PatchBuilders) std.mem.Allocator.Error![]types.PatchOperation {
        return self.forward.toOwnedSlice(self.allocator);
    }

    fn takeInverse(self: *PatchBuilders) std.mem.Allocator.Error![]types.PatchOperation {
        return self.inverse.toOwnedSlice(self.allocator);
    }
};
