//! Contract-only types shared by semantic architecture modules.
//!
//! This file owns vocabulary and memory ownership, not topology, mutation, geometry,
//! rendering, V8, editor state, or legacy placement behavior.

const std = @import("std");
const architecture_scale = @import("architecture_scale.zig");

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
    .minimum_wall_length_u = 1,
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
