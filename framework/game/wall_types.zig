//! Contract-only types shared by semantic architecture modules.
//!
//! This file owns vocabulary and memory ownership, not topology, mutation, geometry,
//! rendering, V8, editor state, or legacy placement behavior.

const std = @import("std");
const architecture_scale = @import("architecture_scale");

pub const Unit = architecture_scale.Unit;

pub const Limits = struct {
    pub const minimum_unit: Unit = architecture_scale.Limits.min_unit;
    pub const maximum_unit: Unit = architecture_scale.Limits.max_unit;
    pub const maximum_id_bytes: usize = 512;
    pub const maximum_label_bytes: usize = 1_024;
    pub const maximum_tag_bytes: usize = 128;
    pub const maximum_path_segments: usize = 32;
    pub const maximum_tags_per_entry: usize = 256;
    pub const maximum_catalog_entries: usize = 65_536;
    pub const maximum_vertices: usize = 1_048_576;
    pub const maximum_edges: usize = 1_048_576;
    pub const maximum_openings: usize = 1_048_576;
    pub const maximum_anchors: usize = 1_048_576;
    pub const maximum_patch_operations: usize = 4_194_304;
    pub const maximum_output_rows: usize = 8_388_608;
};

pub const WallTuning = struct {
    minimum_wall_length_u: Unit,
    minimum_height_u: Unit,
    maximum_height_u: Unit,
    minimum_thickness_u: Unit,
    maximum_thickness_u: Unit,
    miter_limit_ratio: f64,
    maximum_floor_magnitude: i32,
};

/// Structural tuning contains no door/window size. Measured catalog entries own all
/// opening occupancy and clearance.
pub const wall_tuning = WallTuning{
    .minimum_wall_length_u = 2,
    .minimum_height_u = 1,
    .maximum_height_u = 4_096,
    .minimum_thickness_u = 1,
    .maximum_thickness_u = 1_024,
    .miter_limit_ratio = 4.0,
    .maximum_floor_magnitude = 4_096,
};

pub const ArchitectureFamily = enum(u8) {
    wall,
    floor,
    vertical_link,
    roof,
};

pub const ArchitectureKitRole = enum(u8) {
    style,
    opening,
    trim,
    cap,
    rail,
    door_leaf,
};

pub const WallProfile = enum(u8) { full, half };
pub const WallSide = enum(u8) { a, b };
pub const WallHinge = enum(u8) { start, end, none };
pub const WallOpeningKind = enum(u8) {
    door,
    window,
    double_window,
    broken_window,
    garage_door,
    sliding_door,
    arch,
};
pub const VerticalLinkKind = enum(u8) { stair, ramp, elevator };
pub const RoofProfile = enum(u8) { flat, shed, gable, hip, pyramid };
pub const PortalClass = enum(u8) { none, walk, vehicle };

pub const SemanticKind = union(enum) {
    wall_opening: WallOpeningKind,
    vertical_link: VerticalLinkKind,
    roof_profile: RoofProfile,
};

pub const ArchitecturePoint2 = struct {
    x_u: Unit,
    z_u: Unit,
};

pub const ArchitecturePoint3 = struct {
    x_u: Unit,
    y_u: Unit,
    z_u: Unit,
};

pub const WallCell = struct {
    column_u: Unit,
    row_u: Unit,
};

pub const WallSupport = union(enum) {
    absolute: struct { base_y_u: Unit },
    slab: struct {
        slab_id: []u8,
        join: SlabJoin,

        pub fn deinit(self: *@This(), allocator: std.mem.Allocator) void {
            freeBytes(allocator, self.slab_id);
            self.* = undefined;
        }
    },

    pub fn deinit(self: *WallSupport, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .absolute => {},
            .slab => |*value| value.deinit(allocator),
        }
        self.* = undefined;
    }
};

pub const SlabJoin = enum(u8) { on_top, at_edge };

pub const WallSideFinish = struct {
    material_id: []u8,

    pub fn deinit(self: *WallSideFinish, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.material_id);
        self.* = undefined;
    }
};

pub const WallOpening = struct {
    id: []u8,
    kind: WallOpeningKind,
    kit_id: []u8,
    column_u: Unit,
    row_u: Unit,
    facing_side: WallSide,
    hinge: WallHinge,

    pub fn deinit(self: *WallOpening, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.kit_id);
        self.* = undefined;
    }
};

pub const WallVertex = struct {
    id: []u8,
    floor: i32,
    x_u: Unit,
    z_u: Unit,

    pub fn deinit(self: *WallVertex, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        self.* = undefined;
    }
};

pub const WallEdge = struct {
    id: []u8,
    start_vertex_id: []u8,
    end_vertex_id: []u8,
    support: WallSupport,
    height_u: Unit,
    thickness_u: Unit,
    profile: WallProfile,
    style_id: []u8,
    side_a: WallSideFinish,
    side_b: WallSideFinish,
    openings: []WallOpening,

    pub fn deinit(self: *WallEdge, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.start_vertex_id);
        freeBytes(allocator, self.end_vertex_id);
        self.support.deinit(allocator);
        freeBytes(allocator, self.style_id);
        self.side_a.deinit(allocator);
        self.side_b.deinit(allocator);
        for (self.openings) |*opening| opening.deinit(allocator);
        freeSlice(WallOpening, allocator, self.openings);
        self.* = undefined;
    }
};

pub const WallAnchor = struct {
    id: []u8,
    edge_id: []u8,
    side: WallSide,
    column_u: Unit,
    row_u: Unit,
    target_piece_id: []u8,

    pub fn deinit(self: *WallAnchor, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.edge_id);
        freeBytes(allocator, self.target_piece_id);
        self.* = undefined;
    }
};

pub const WallSource = struct {
    vertices: []WallVertex,
    edges: []WallEdge,
    anchors: []WallAnchor,

    pub fn deinit(self: *WallSource, allocator: std.mem.Allocator) void {
        for (self.vertices) |*vertex| vertex.deinit(allocator);
        for (self.edges) |*edge| edge.deinit(allocator);
        for (self.anchors) |*anchor| anchor.deinit(allocator);
        freeSlice(WallVertex, allocator, self.vertices);
        freeSlice(WallEdge, allocator, self.edges);
        freeSlice(WallAnchor, allocator, self.anchors);
        self.* = undefined;
    }
};

pub const ArchitectureSource = struct {
    version: u16 = 1,
    revision: u32,
    walls: WallSource,

    pub fn deinit(self: *ArchitectureSource, allocator: std.mem.Allocator) void {
        self.walls.deinit(allocator);
        self.* = undefined;
    }
};

/// Produce a recursively owned source candidate. Transaction boundaries use this
/// before mutation so validation failure can never require reconstructing caller state.
pub fn cloneSource(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
) std.mem.Allocator.Error!ArchitectureSource {
    const vertices = try allocator.alloc(WallVertex, source.walls.vertices.len);
    var initialized_vertices: usize = 0;
    errdefer {
        for (vertices[0..initialized_vertices]) |*vertex| vertex.deinit(allocator);
        freeSlice(WallVertex, allocator, vertices);
    }
    for (source.walls.vertices) |vertex| {
        vertices[initialized_vertices] = .{
            .id = try allocator.dupe(u8, vertex.id),
            .floor = vertex.floor,
            .x_u = vertex.x_u,
            .z_u = vertex.z_u,
        };
        initialized_vertices += 1;
    }

    const edges = try allocator.alloc(WallEdge, source.walls.edges.len);
    var initialized_edges: usize = 0;
    errdefer {
        for (edges[0..initialized_edges]) |*edge| edge.deinit(allocator);
        freeSlice(WallEdge, allocator, edges);
    }
    for (source.walls.edges) |edge| {
        edges[initialized_edges] = try cloneWallEdge(allocator, edge);
        initialized_edges += 1;
    }

    const anchors = try allocator.alloc(WallAnchor, source.walls.anchors.len);
    var initialized_anchors: usize = 0;
    errdefer {
        for (anchors[0..initialized_anchors]) |*anchor| anchor.deinit(allocator);
        freeSlice(WallAnchor, allocator, anchors);
    }
    for (source.walls.anchors) |anchor| {
        const id = try allocator.dupe(u8, anchor.id);
        errdefer allocator.free(id);
        const edge_id = try allocator.dupe(u8, anchor.edge_id);
        errdefer allocator.free(edge_id);
        const target_piece_id = try allocator.dupe(u8, anchor.target_piece_id);
        errdefer allocator.free(target_piece_id);
        anchors[initialized_anchors] = .{
            .id = id,
            .edge_id = edge_id,
            .side = anchor.side,
            .column_u = anchor.column_u,
            .row_u = anchor.row_u,
            .target_piece_id = target_piece_id,
        };
        initialized_anchors += 1;
    }

    return .{
        .version = source.version,
        .revision = source.revision,
        .walls = .{ .vertices = vertices, .edges = edges, .anchors = anchors },
    };
}

fn cloneWallEdge(allocator: std.mem.Allocator, edge: WallEdge) std.mem.Allocator.Error!WallEdge {
    const id = try allocator.dupe(u8, edge.id);
    errdefer allocator.free(id);
    const start_vertex_id = try allocator.dupe(u8, edge.start_vertex_id);
    errdefer allocator.free(start_vertex_id);
    const end_vertex_id = try allocator.dupe(u8, edge.end_vertex_id);
    errdefer allocator.free(end_vertex_id);
    var support: WallSupport = switch (edge.support) {
        .absolute => |value| .{ .absolute = value },
        .slab => |value| .{ .slab = .{
            .slab_id = try allocator.dupe(u8, value.slab_id),
            .join = value.join,
        } },
    };
    errdefer support.deinit(allocator);
    const style_id = try allocator.dupe(u8, edge.style_id);
    errdefer allocator.free(style_id);
    const side_a_material_id = try allocator.dupe(u8, edge.side_a.material_id);
    errdefer allocator.free(side_a_material_id);
    const side_b_material_id = try allocator.dupe(u8, edge.side_b.material_id);
    errdefer allocator.free(side_b_material_id);
    const openings = try allocator.alloc(WallOpening, edge.openings.len);
    var initialized_openings: usize = 0;
    errdefer {
        for (openings[0..initialized_openings]) |*opening| opening.deinit(allocator);
        freeSlice(WallOpening, allocator, openings);
    }
    for (edge.openings) |opening| {
        const opening_id = try allocator.dupe(u8, opening.id);
        errdefer allocator.free(opening_id);
        const kit_id = try allocator.dupe(u8, opening.kit_id);
        errdefer allocator.free(kit_id);
        openings[initialized_openings] = .{
            .id = opening_id,
            .kind = opening.kind,
            .kit_id = kit_id,
            .column_u = opening.column_u,
            .row_u = opening.row_u,
            .facing_side = opening.facing_side,
            .hinge = opening.hinge,
        };
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

pub const SourceValidationError = error{
    unsupported_source_version,
    source_limit_exceeded,
    empty_source_id,
    source_id_too_long,
    duplicate_source_id,
    floor_out_of_range,
    unit_out_of_range,
    invalid_wall_height,
    invalid_wall_thickness,
    missing_vertex_reference,
    cross_floor_edge,
    zero_length_edge,
    short_edge,
    missing_edge_reference,
};

pub const StructuralNumberError = error{
    structural_value_not_finite,
    structural_value_not_integer,
    structural_value_out_of_range,
};

const supported_source_version: u16 = 1;

/// Gate for dynamically typed wire/DTO numbers before they can enter integer-u
/// architecture state. No epsilon or rounding is accepted at this boundary.
pub fn validateStructuralNumber(value: f64) StructuralNumberError!Unit {
    if (!std.math.isFinite(value)) return error.structural_value_not_finite;
    if (@trunc(value) != value) return error.structural_value_not_integer;
    if (value < @as(f64, @floatFromInt(Limits.minimum_unit)) or
        value > @as(f64, @floatFromInt(Limits.maximum_unit)))
    {
        return error.structural_value_out_of_range;
    }
    return @intFromFloat(value);
}

/// Validate only persisted source structure. Catalog meaning and topology are
/// separate boundaries, so this function never guesses semantic intent from IDs.
pub fn validateSourceStructure(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
) (SourceValidationError || std.mem.Allocator.Error)!void {
    if (source.version != supported_source_version) return error.unsupported_source_version;
    if (source.walls.vertices.len > Limits.maximum_vertices or
        source.walls.edges.len > Limits.maximum_edges or
        source.walls.anchors.len > Limits.maximum_anchors)
    {
        return error.source_limit_exceeded;
    }

    var source_ids = std.StringHashMap(void).init(allocator);
    defer source_ids.deinit();
    var vertex_indices = std.StringHashMap(usize).init(allocator);
    defer vertex_indices.deinit();
    var edge_ids = std.StringHashMap(void).init(allocator);
    defer edge_ids.deinit();

    for (source.walls.vertices, 0..) |vertex, index| {
        try putUniqueSourceId(&source_ids, vertex.id);
        try putUniqueReference(&vertex_indices, vertex.id, index);
        if (vertex.floor < -wall_tuning.maximum_floor_magnitude or
            vertex.floor > wall_tuning.maximum_floor_magnitude)
        {
            return error.floor_out_of_range;
        }
        try validateUnit(vertex.x_u);
        try validateUnit(vertex.z_u);
    }

    var opening_count: usize = 0;
    for (source.walls.edges) |edge| {
        opening_count = std.math.add(usize, opening_count, edge.openings.len) catch
            return error.source_limit_exceeded;
        if (opening_count > Limits.maximum_openings) return error.source_limit_exceeded;

        try putUniqueSourceId(&source_ids, edge.id);
        const edge_result = try edge_ids.getOrPut(edge.id);
        if (edge_result.found_existing) return error.duplicate_source_id;
        try validateReferenceId(edge.start_vertex_id);
        try validateReferenceId(edge.end_vertex_id);
        try validateReferenceId(edge.style_id);
        try validateReferenceId(edge.side_a.material_id);
        try validateReferenceId(edge.side_b.material_id);
        switch (edge.support) {
            .absolute => |support| try validateUnit(support.base_y_u),
            .slab => |support| try validateReferenceId(support.slab_id),
        }
        if (edge.height_u < wall_tuning.minimum_height_u or
            edge.height_u > wall_tuning.maximum_height_u)
        {
            return error.invalid_wall_height;
        }
        if (edge.thickness_u < wall_tuning.minimum_thickness_u or
            edge.thickness_u > wall_tuning.maximum_thickness_u)
        {
            return error.invalid_wall_thickness;
        }

        const start_index = vertex_indices.get(edge.start_vertex_id) orelse
            return error.missing_vertex_reference;
        const end_index = vertex_indices.get(edge.end_vertex_id) orelse
            return error.missing_vertex_reference;
        const start = source.walls.vertices[start_index];
        const end = source.walls.vertices[end_index];
        if (start.floor != end.floor) return error.cross_floor_edge;
        const delta_x: i64 = @as(i64, end.x_u) - @as(i64, start.x_u);
        const delta_z: i64 = @as(i64, end.z_u) - @as(i64, start.z_u);
        const length_squared = delta_x * delta_x + delta_z * delta_z;
        if (length_squared == 0) return error.zero_length_edge;
        const minimum_length: i64 = wall_tuning.minimum_wall_length_u;
        if (length_squared < minimum_length * minimum_length) return error.short_edge;

        for (edge.openings) |opening| {
            try putUniqueSourceId(&source_ids, opening.id);
            try validateReferenceId(opening.kit_id);
            try validateUnit(opening.column_u);
            try validateUnit(opening.row_u);
        }
    }

    for (source.walls.anchors) |anchor| {
        try putUniqueSourceId(&source_ids, anchor.id);
        try validateReferenceId(anchor.edge_id);
        try validateReferenceId(anchor.target_piece_id);
        if (!edge_ids.contains(anchor.edge_id)) return error.missing_edge_reference;
        try validateUnit(anchor.column_u);
        try validateUnit(anchor.row_u);
    }
}

fn validateUnit(value: Unit) SourceValidationError!void {
    if (value < Limits.minimum_unit or value > Limits.maximum_unit) {
        return error.unit_out_of_range;
    }
}

fn validateReferenceId(id: []const u8) SourceValidationError!void {
    if (id.len == 0) return error.empty_source_id;
    if (id.len > Limits.maximum_id_bytes) return error.source_id_too_long;
}

fn putUniqueSourceId(
    ids: *std.StringHashMap(void),
    id: []const u8,
) (SourceValidationError || std.mem.Allocator.Error)!void {
    try validateReferenceId(id);
    const result = try ids.getOrPut(id);
    if (result.found_existing) return error.duplicate_source_id;
}

fn putUniqueReference(
    references: *std.StringHashMap(usize),
    id: []const u8,
    index: usize,
) std.mem.Allocator.Error!void {
    const result = try references.getOrPut(id);
    result.value_ptr.* = index;
}

pub const RecordFamily = enum(u8) { vertex, edge, opening, anchor };
pub const PatchOperationKind = enum(u8) { insert, replace, remove };
pub const DirtyTarget = enum(u8) {
    topology,
    render,
    collision,
    cover,
    materials,
    doors_portals,
    navigation,
    rooms,
    visibility,
    audio,
    pick_proxies,
};

pub const ArchitectureRejectionCode = enum(u16) {
    invalid_source,
    invalid_catalog,
    unknown_catalog_id,
    stale_source_revision,
    duplicate_command_id,
    structural_value_not_integer,
    zero_length_edge,
    short_edge,
    off_lattice_intersection,
    collinear_overlap,
    opening_out_of_bounds,
    opening_occupied_collision,
    opening_clearance_collision,
    opening_incompatible_profile,
    opening_incompatible_thickness,
    opening_incompatible_height,
    split_intersects_surface_child,
    topology_degenerate,
    limit_exceeded,
};

pub const RecordRef = struct {
    family: RecordFamily,
    id: []u8,

    pub fn deinit(self: *RecordRef, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        self.* = undefined;
    }
};

pub const RecordSnapshot = struct {
    family: RecordFamily,
    id: []u8,
    canonical_bytes: []u8,

    pub fn deinit(self: *RecordSnapshot, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.canonical_bytes);
        self.* = undefined;
    }
};

pub const RecordDelta = struct {
    family: RecordFamily,
    id: []u8,
    before_canonical_bytes: []u8,
    after_canonical_bytes: []u8,

    pub fn deinit(self: *RecordDelta, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.before_canonical_bytes);
        freeBytes(allocator, self.after_canonical_bytes);
        self.* = undefined;
    }
};

pub const PatchOperation = union(PatchOperationKind) {
    insert: RecordSnapshot,
    replace: RecordDelta,
    remove: RecordSnapshot,

    pub fn deinit(self: *PatchOperation, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .insert => |*value| value.deinit(allocator),
            .replace => |*value| value.deinit(allocator),
            .remove => |*value| value.deinit(allocator),
        }
        self.* = undefined;
    }
};

pub const ArchitecturePatch = struct {
    expected_revision: u32,
    result_revision: u32,
    operations: []PatchOperation,

    pub fn deinit(self: *ArchitecturePatch, allocator: std.mem.Allocator) void {
        for (self.operations) |*operation| operation.deinit(allocator);
        freeSlice(PatchOperation, allocator, self.operations);
        self.* = undefined;
    }
};

pub const EdgeChildRemap = struct {
    predecessor_edge_id: []u8,
    child_edge_ids: [][]u8,
    child_start_columns_u: []Unit,

    pub fn deinit(self: *EdgeChildRemap, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.predecessor_edge_id);
        freeStringList(allocator, self.child_edge_ids);
        freeSlice(Unit, allocator, self.child_start_columns_u);
        self.* = undefined;
    }
};

pub const SurfaceChildRemap = struct {
    child_family: RecordFamily,
    child_id: []u8,
    predecessor_edge_id: []u8,
    successor_edge_id: []u8,
    old_column_u: Unit,
    new_column_u: Unit,
    row_u: Unit,

    pub fn deinit(self: *SurfaceChildRemap, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.child_id);
        freeBytes(allocator, self.predecessor_edge_id);
        freeBytes(allocator, self.successor_edge_id);
        self.* = undefined;
    }
};

pub const FaceLineage = struct {
    predecessor_signatures: [][]u8,
    successor_signatures: [][]u8,

    pub fn deinit(self: *FaceLineage, allocator: std.mem.Allocator) void {
        freeStringList(allocator, self.predecessor_signatures);
        freeStringList(allocator, self.successor_signatures);
        self.* = undefined;
    }
};

pub const AffectedBounds = struct {
    floor: i32,
    min_x_u: Unit,
    min_y_u: Unit,
    min_z_u: Unit,
    max_x_u_exclusive: Unit,
    max_y_u_exclusive: Unit,
    max_z_u_exclusive: Unit,
};

pub const MutationReceipt = struct {
    command_id: []u8,
    source_revision_before: u32,
    source_revision_after: u32,
    source_hash_before: []u8,
    source_hash_after: []u8,
    created: []RecordRef,
    updated: []RecordDelta,
    removed: []RecordSnapshot,
    edge_child_remaps: []EdgeChildRemap,
    opening_remaps: []SurfaceChildRemap,
    anchor_remaps: []SurfaceChildRemap,
    face_lineage: []FaceLineage,
    forward_patch: ArchitecturePatch,
    inverse_patch: ArchitecturePatch,
    affected_bounds: []AffectedBounds,
    dirty_targets: []DirtyTarget,

    pub fn deinit(self: *MutationReceipt, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.command_id);
        freeBytes(allocator, self.source_hash_before);
        freeBytes(allocator, self.source_hash_after);
        for (self.created) |*value| value.deinit(allocator);
        for (self.updated) |*value| value.deinit(allocator);
        for (self.removed) |*value| value.deinit(allocator);
        for (self.edge_child_remaps) |*value| value.deinit(allocator);
        for (self.opening_remaps) |*value| value.deinit(allocator);
        for (self.anchor_remaps) |*value| value.deinit(allocator);
        for (self.face_lineage) |*value| value.deinit(allocator);
        freeSlice(RecordRef, allocator, self.created);
        freeSlice(RecordDelta, allocator, self.updated);
        freeSlice(RecordSnapshot, allocator, self.removed);
        freeSlice(EdgeChildRemap, allocator, self.edge_child_remaps);
        freeSlice(SurfaceChildRemap, allocator, self.opening_remaps);
        freeSlice(SurfaceChildRemap, allocator, self.anchor_remaps);
        freeSlice(FaceLineage, allocator, self.face_lineage);
        self.forward_patch.deinit(allocator);
        self.inverse_patch.deinit(allocator);
        freeSlice(AffectedBounds, allocator, self.affected_bounds);
        freeSlice(DirtyTarget, allocator, self.dirty_targets);
        self.* = undefined;
    }
};

pub const MutationRejection = struct {
    command_id: []u8,
    code: ArchitectureRejectionCode,
    expected_revision: u32,
    actual_revision: u32,
    subject_ids: [][]u8,
    detail: []u8,

    pub fn deinit(self: *MutationRejection, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.command_id);
        freeStringList(allocator, self.subject_ids);
        freeBytes(allocator, self.detail);
        self.* = undefined;
    }
};

pub const MutationResult = union(enum) {
    receipt: MutationReceipt,
    rejection: MutationRejection,

    pub fn deinit(self: *MutationResult, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .receipt => |*value| value.deinit(allocator),
            .rejection => |*value| value.deinit(allocator),
        }
        self.* = undefined;
    }
};

pub const CanonicalRecordError = std.mem.Allocator.Error || error{
    invalid_canonical_record,
    canonical_record_too_large,
};

pub const LocatedWallOpening = struct {
    edge_id: []u8,
    opening: WallOpening,

    pub fn deinit(self: *LocatedWallOpening, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.edge_id);
        self.opening.deinit(allocator);
        self.* = undefined;
    }
};

pub const CanonicalRecord = union(RecordFamily) {
    vertex: WallVertex,
    edge: WallEdge,
    opening: LocatedWallOpening,
    anchor: WallAnchor,

    pub fn deinit(self: *CanonicalRecord, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .vertex => |*value| value.deinit(allocator),
            .edge => |*value| value.deinit(allocator),
            .opening => |*value| value.deinit(allocator),
            .anchor => |*value| value.deinit(allocator),
        }
        self.* = undefined;
    }

    pub fn id(self: *const CanonicalRecord) []const u8 {
        return switch (self.*) {
            .vertex => |value| value.id,
            .edge => |value| value.id,
            .opening => |value| value.opening.id,
            .anchor => |value| value.id,
        };
    }
};

const canonical_record_version: u8 = 1;

/// Serialize the complete source in stable-ID order. Array storage order is not
/// semantic and therefore cannot perturb command hashes or round-trip proofs.
pub fn canonicalSourceBytes(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
) std.mem.Allocator.Error![]u8 {
    var encoder = CanonicalEncoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendInt(u16, source.version);
    try encoder.appendInt(u32, source.revision);

    const vertices = try allocator.alloc(*const WallVertex, source.walls.vertices.len);
    defer if (vertices.len != 0) allocator.free(vertices);
    for (source.walls.vertices, 0..) |*vertex, index| vertices[index] = vertex;
    std.mem.sort(*const WallVertex, vertices, {}, vertexPointerLessThan);
    try encoder.appendLength(vertices.len);
    for (vertices) |vertex| try appendVertex(&encoder, vertex);

    const edges = try allocator.alloc(*const WallEdge, source.walls.edges.len);
    defer if (edges.len != 0) allocator.free(edges);
    for (source.walls.edges, 0..) |*edge, index| edges[index] = edge;
    std.mem.sort(*const WallEdge, edges, {}, edgePointerLessThan);
    try encoder.appendLength(edges.len);
    for (edges) |edge| try appendEdge(&encoder, edge);

    const anchors = try allocator.alloc(*const WallAnchor, source.walls.anchors.len);
    defer if (anchors.len != 0) allocator.free(anchors);
    for (source.walls.anchors, 0..) |*anchor, index| anchors[index] = anchor;
    std.mem.sort(*const WallAnchor, anchors, {}, anchorPointerLessThan);
    try encoder.appendLength(anchors.len);
    for (anchors) |anchor| try appendAnchor(&encoder, anchor);
    return encoder.take();
}

pub fn canonicalVertexRecordBytes(
    allocator: std.mem.Allocator,
    vertex: *const WallVertex,
) std.mem.Allocator.Error![]u8 {
    var encoder = CanonicalEncoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendByte(canonical_record_version);
    try encoder.appendByte(@intFromEnum(RecordFamily.vertex));
    try appendVertex(&encoder, vertex);
    return encoder.take();
}

pub fn canonicalEdgeRecordBytes(
    allocator: std.mem.Allocator,
    edge: *const WallEdge,
) std.mem.Allocator.Error![]u8 {
    var encoder = CanonicalEncoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendByte(canonical_record_version);
    try encoder.appendByte(@intFromEnum(RecordFamily.edge));
    try appendEdge(&encoder, edge);
    return encoder.take();
}

pub fn canonicalOpeningRecordBytes(
    allocator: std.mem.Allocator,
    edge_id: []const u8,
    opening: *const WallOpening,
) std.mem.Allocator.Error![]u8 {
    var encoder = CanonicalEncoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendByte(canonical_record_version);
    try encoder.appendByte(@intFromEnum(RecordFamily.opening));
    try encoder.appendString(edge_id);
    try appendOpening(&encoder, opening);
    return encoder.take();
}

pub fn canonicalAnchorRecordBytes(
    allocator: std.mem.Allocator,
    anchor: *const WallAnchor,
) std.mem.Allocator.Error![]u8 {
    var encoder = CanonicalEncoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendByte(canonical_record_version);
    try encoder.appendByte(@intFromEnum(RecordFamily.anchor));
    try appendAnchor(&encoder, anchor);
    return encoder.take();
}

/// Decode one owned record from the same format emitted above. The decoder
/// rejects trailing bytes, invalid enum tags, and lengths beyond the input.
pub fn decodeCanonicalRecord(
    allocator: std.mem.Allocator,
    bytes: []const u8,
) CanonicalRecordError!CanonicalRecord {
    var decoder = CanonicalDecoder{ .allocator = allocator, .bytes = bytes };
    if (try decoder.readByte() != canonical_record_version) return error.invalid_canonical_record;
    const family = std.enums.fromInt(RecordFamily, try decoder.readByte()) orelse
        return error.invalid_canonical_record;
    var record: CanonicalRecord = switch (family) {
        .vertex => .{ .vertex = try decodeVertex(&decoder) },
        .edge => .{ .edge = try decodeEdge(&decoder) },
        .opening => .{ .opening = try decodeLocatedOpening(&decoder) },
        .anchor => .{ .anchor = try decodeAnchor(&decoder) },
    };
    errdefer record.deinit(allocator);
    if (decoder.index != bytes.len) return error.invalid_canonical_record;
    return record;
}

fn appendVertex(encoder: *CanonicalEncoder, vertex: *const WallVertex) std.mem.Allocator.Error!void {
    try encoder.appendString(vertex.id);
    try encoder.appendInt(i32, vertex.floor);
    try encoder.appendInt(Unit, vertex.x_u);
    try encoder.appendInt(Unit, vertex.z_u);
}

fn appendEdge(encoder: *CanonicalEncoder, edge: *const WallEdge) std.mem.Allocator.Error!void {
    try encoder.appendString(edge.id);
    try encoder.appendString(edge.start_vertex_id);
    try encoder.appendString(edge.end_vertex_id);
    switch (edge.support) {
        .absolute => |support| {
            try encoder.appendByte(0);
            try encoder.appendInt(Unit, support.base_y_u);
        },
        .slab => |support| {
            try encoder.appendByte(1);
            try encoder.appendString(support.slab_id);
            try encoder.appendByte(@intFromEnum(support.join));
        },
    }
    try encoder.appendInt(Unit, edge.height_u);
    try encoder.appendInt(Unit, edge.thickness_u);
    try encoder.appendByte(@intFromEnum(edge.profile));
    try encoder.appendString(edge.style_id);
    try encoder.appendString(edge.side_a.material_id);
    try encoder.appendString(edge.side_b.material_id);

    const openings = try encoder.allocator.alloc(*const WallOpening, edge.openings.len);
    defer if (openings.len != 0) encoder.allocator.free(openings);
    for (edge.openings, 0..) |*opening, index| openings[index] = opening;
    std.mem.sort(*const WallOpening, openings, {}, openingPointerLessThan);
    try encoder.appendLength(openings.len);
    for (openings) |opening| try appendOpening(encoder, opening);
}

fn appendOpening(encoder: *CanonicalEncoder, opening: *const WallOpening) std.mem.Allocator.Error!void {
    try encoder.appendString(opening.id);
    try encoder.appendByte(@intFromEnum(opening.kind));
    try encoder.appendString(opening.kit_id);
    try encoder.appendInt(Unit, opening.column_u);
    try encoder.appendInt(Unit, opening.row_u);
    try encoder.appendByte(@intFromEnum(opening.facing_side));
    try encoder.appendByte(@intFromEnum(opening.hinge));
}

fn appendAnchor(encoder: *CanonicalEncoder, anchor: *const WallAnchor) std.mem.Allocator.Error!void {
    try encoder.appendString(anchor.id);
    try encoder.appendString(anchor.edge_id);
    try encoder.appendByte(@intFromEnum(anchor.side));
    try encoder.appendInt(Unit, anchor.column_u);
    try encoder.appendInt(Unit, anchor.row_u);
    try encoder.appendString(anchor.target_piece_id);
}

fn decodeVertex(decoder: *CanonicalDecoder) CanonicalRecordError!WallVertex {
    const id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(id);
    return .{
        .id = id,
        .floor = try decoder.readInt(i32),
        .x_u = try decoder.readInt(Unit),
        .z_u = try decoder.readInt(Unit),
    };
}

fn decodeEdge(decoder: *CanonicalDecoder) CanonicalRecordError!WallEdge {
    const id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(id);
    const start_vertex_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(start_vertex_id);
    const end_vertex_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(end_vertex_id);
    var support: WallSupport = switch (try decoder.readByte()) {
        0 => .{ .absolute = .{ .base_y_u = try decoder.readInt(Unit) } },
        1 => slab: {
            const slab_id = try decoder.readOwnedString();
            errdefer decoder.allocator.free(slab_id);
            const join = std.enums.fromInt(SlabJoin, try decoder.readByte()) orelse
                return error.invalid_canonical_record;
            break :slab .{ .slab = .{ .slab_id = slab_id, .join = join } };
        },
        else => return error.invalid_canonical_record,
    };
    errdefer support.deinit(decoder.allocator);
    const height_u = try decoder.readInt(Unit);
    const thickness_u = try decoder.readInt(Unit);
    const profile = std.enums.fromInt(WallProfile, try decoder.readByte()) orelse
        return error.invalid_canonical_record;
    const style_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(style_id);
    const side_a_material_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(side_a_material_id);
    const side_b_material_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(side_b_material_id);
    const opening_count = try decoder.readLength(Limits.maximum_openings);
    const openings = try decoder.allocator.alloc(WallOpening, opening_count);
    var initialized_openings: usize = 0;
    errdefer {
        for (openings[0..initialized_openings]) |*opening| opening.deinit(decoder.allocator);
        if (openings.len != 0) decoder.allocator.free(openings);
    }
    while (initialized_openings < openings.len) : (initialized_openings += 1) {
        openings[initialized_openings] = try decodeOpening(decoder);
    }
    return .{
        .id = id,
        .start_vertex_id = start_vertex_id,
        .end_vertex_id = end_vertex_id,
        .support = support,
        .height_u = height_u,
        .thickness_u = thickness_u,
        .profile = profile,
        .style_id = style_id,
        .side_a = .{ .material_id = side_a_material_id },
        .side_b = .{ .material_id = side_b_material_id },
        .openings = openings,
    };
}

fn decodeOpening(decoder: *CanonicalDecoder) CanonicalRecordError!WallOpening {
    const id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(id);
    const kind = std.enums.fromInt(WallOpeningKind, try decoder.readByte()) orelse
        return error.invalid_canonical_record;
    const kit_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(kit_id);
    return .{
        .id = id,
        .kind = kind,
        .kit_id = kit_id,
        .column_u = try decoder.readInt(Unit),
        .row_u = try decoder.readInt(Unit),
        .facing_side = std.enums.fromInt(WallSide, try decoder.readByte()) orelse
            return error.invalid_canonical_record,
        .hinge = std.enums.fromInt(WallHinge, try decoder.readByte()) orelse
            return error.invalid_canonical_record,
    };
}

fn decodeLocatedOpening(decoder: *CanonicalDecoder) CanonicalRecordError!LocatedWallOpening {
    const edge_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(edge_id);
    var opening = try decodeOpening(decoder);
    errdefer opening.deinit(decoder.allocator);
    return .{ .edge_id = edge_id, .opening = opening };
}

fn decodeAnchor(decoder: *CanonicalDecoder) CanonicalRecordError!WallAnchor {
    const id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(id);
    const edge_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(edge_id);
    const side = std.enums.fromInt(WallSide, try decoder.readByte()) orelse
        return error.invalid_canonical_record;
    const column_u = try decoder.readInt(Unit);
    const row_u = try decoder.readInt(Unit);
    const target_piece_id = try decoder.readOwnedString();
    errdefer decoder.allocator.free(target_piece_id);
    return .{
        .id = id,
        .edge_id = edge_id,
        .side = side,
        .column_u = column_u,
        .row_u = row_u,
        .target_piece_id = target_piece_id,
    };
}

fn vertexPointerLessThan(_: void, left: *const WallVertex, right: *const WallVertex) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn edgePointerLessThan(_: void, left: *const WallEdge, right: *const WallEdge) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn openingPointerLessThan(_: void, left: *const WallOpening, right: *const WallOpening) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn anchorPointerLessThan(_: void, left: *const WallAnchor, right: *const WallAnchor) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

const CanonicalEncoder = struct {
    allocator: std.mem.Allocator,
    bytes: std.ArrayList(u8),

    fn init(allocator: std.mem.Allocator) CanonicalEncoder {
        return .{ .allocator = allocator, .bytes = .empty };
    }

    fn deinit(self: *CanonicalEncoder) void {
        self.bytes.deinit(self.allocator);
        self.* = undefined;
    }

    fn take(self: *CanonicalEncoder) std.mem.Allocator.Error![]u8 {
        return self.bytes.toOwnedSlice(self.allocator);
    }

    fn appendByte(self: *CanonicalEncoder, value: u8) std.mem.Allocator.Error!void {
        try self.bytes.append(self.allocator, value);
    }

    fn appendLength(self: *CanonicalEncoder, value: usize) std.mem.Allocator.Error!void {
        try self.appendInt(u64, @intCast(value));
    }

    fn appendString(self: *CanonicalEncoder, value: []const u8) std.mem.Allocator.Error!void {
        try self.appendLength(value.len);
        try self.bytes.appendSlice(self.allocator, value);
    }

    fn appendInt(self: *CanonicalEncoder, comptime T: type, value: T) std.mem.Allocator.Error!void {
        var encoded: [@sizeOf(T)]u8 = undefined;
        std.mem.writeInt(T, &encoded, value, .little);
        try self.bytes.appendSlice(self.allocator, &encoded);
    }
};

const CanonicalDecoder = struct {
    allocator: std.mem.Allocator,
    bytes: []const u8,
    index: usize = 0,

    fn readByte(self: *CanonicalDecoder) CanonicalRecordError!u8 {
        if (self.index >= self.bytes.len) return error.invalid_canonical_record;
        const value = self.bytes[self.index];
        self.index += 1;
        return value;
    }

    fn readInt(self: *CanonicalDecoder, comptime T: type) CanonicalRecordError!T {
        const end = std.math.add(usize, self.index, @sizeOf(T)) catch
            return error.canonical_record_too_large;
        if (end > self.bytes.len) return error.invalid_canonical_record;
        const value = std.mem.readInt(T, self.bytes[self.index..end][0..@sizeOf(T)], .little);
        self.index = end;
        return value;
    }

    fn readLength(self: *CanonicalDecoder, maximum: usize) CanonicalRecordError!usize {
        const raw = try self.readInt(u64);
        if (raw > maximum or raw > std.math.maxInt(usize)) return error.canonical_record_too_large;
        return @intCast(raw);
    }

    fn readOwnedString(self: *CanonicalDecoder) CanonicalRecordError![]u8 {
        const length = try self.readLength(Limits.maximum_id_bytes);
        const end = std.math.add(usize, self.index, length) catch
            return error.canonical_record_too_large;
        if (end > self.bytes.len) return error.invalid_canonical_record;
        const result = try self.allocator.dupe(u8, self.bytes[self.index..end]);
        self.index = end;
        return result;
    }
};

fn freeBytes(allocator: std.mem.Allocator, bytes: []u8) void {
    if (bytes.len != 0) allocator.free(bytes);
}

fn freeSlice(comptime T: type, allocator: std.mem.Allocator, values: []T) void {
    if (values.len != 0) allocator.free(values);
}

fn freeStringList(allocator: std.mem.Allocator, values: [][]u8) void {
    for (values) |value| freeBytes(allocator, value);
    freeSlice([]u8, allocator, values);
}
