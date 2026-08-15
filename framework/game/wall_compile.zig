//! Deterministic compiler boundary for semantic wall architecture.
//!
//! Authored source stays integer-u and renderer-neutral. This module owns the
//! ordered wall output packet consumed by live preview, frozen-world compilation,
//! physics, navigation, audio, visibility, picking, and later wire encoding.

const std = @import("std");
const types = @import("wall_types");
const catalog = @import("building_catalog");
const geometry = @import("wall_geometry");
const topology = @import("wall_topology");
const floor_geometry = @import("floor_geometry");

pub const bundle_magic = [4]u8{ 'R', 'J', 'A', 'B' };
pub const bundle_version: u16 = 1;
pub const wall_section_version: u16 = 1;
pub const floor_section_version: u16 = 1;
pub const compiler_version = "semantic-wall-compiler-v1";
pub const Digest = [std.crypto.hash.sha2.Sha256.digest_length]u8;
pub const PickProxy = geometry.PickProxy;
pub const PickProxyPoint = geometry.Point3Meters;

pub const CompileOptions = struct {
    /// Empty bounds select the complete source. Non-empty bounds select wall rows
    /// intersecting at least one half-open region on the same floor.
    affected_bounds: []const types.AffectedBounds = &.{},
    /// Empty targets select every wall product. Otherwise only named products are
    /// emitted; target hashes remain canonical for every selected floor.
    targets: []const types.DirtyTarget = &.{},
};

pub const MaterialSide = enum(u8) { a, b, generated };
pub const RoomKind = enum(u8) { interior, exterior, hole };
pub const DiagnosticSeverity = enum(u8) { warning, err };

pub const SectionDirectoryEntry = struct {
    family: types.ArchitectureFamily,
    version: u16,
    offset: u64,
    byte_length: u64,
    item_count: u64,
    section_hash: Digest,
};

pub const MaterialBinding = struct {
    id: []u8,
    edge_id: []u8,
    side: MaterialSide,
    role: geometry.SurfaceRole,
    catalog_id: []u8,
    content_hash: []u8,
    material_id: []u8,

    pub fn deinit(self: *MaterialBinding, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.edge_id);
        freeBytes(allocator, self.catalog_id);
        freeBytes(allocator, self.content_hash);
        freeBytes(allocator, self.material_id);
        self.* = undefined;
    }
};

pub const DoorRow = struct {
    id: []u8,
    opening_id: []u8,
    edge_id: []u8,
    kit_catalog_id: []u8,
    kit_content_hash: []u8,
    facing_side: types.WallSide,
    hinge: types.WallHinge,
    attachment: geometry.DoorAttachmentFrame,

    pub fn deinit(self: *DoorRow, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.opening_id);
        freeBytes(allocator, self.edge_id);
        freeBytes(allocator, self.kit_catalog_id);
        freeBytes(allocator, self.kit_content_hash);
        self.attachment.deinit(allocator);
        self.* = undefined;
    }
};

pub const PortalRow = struct {
    id: []u8,
    opening_id: []u8,
    edge_id: []u8,
    room_a: []u8,
    room_b: []u8,
    portal_class: types.PortalClass,
    traversable: bool,
    interval: geometry.TraversalInterval,

    pub fn deinit(self: *PortalRow, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.id);
        freeBytes(allocator, self.opening_id);
        freeBytes(allocator, self.edge_id);
        freeBytes(allocator, self.room_a);
        freeBytes(allocator, self.room_b);
        self.interval.deinit(allocator);
        self.* = undefined;
    }
};

pub const RoomFace = struct {
    signature: []u8,
    floor: i32,
    kind: RoomKind,
    signed_area_twice_u: i128,
    boundary_half_edge_ids: [][]u8,
    parent_signature: ?[]u8,

    pub fn deinit(self: *RoomFace, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.signature);
        freeStringList(allocator, self.boundary_half_edge_ids);
        if (self.parent_signature) |value| freeBytes(allocator, value);
        self.* = undefined;
    }
};

pub const ArchitectureDiagnostic = struct {
    code: []u8,
    severity: DiagnosticSeverity,
    family: types.ArchitectureFamily,
    subject_ids: [][]u8,
    floor: ?i32,
    message: []u8,

    pub fn deinit(self: *ArchitectureDiagnostic, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.code);
        freeStringList(allocator, self.subject_ids);
        freeBytes(allocator, self.message);
        self.* = undefined;
    }
};

pub const TargetHash = struct {
    target: types.DirtyTarget,
    floor: i32,
    content_hash: Digest,
};

pub const WallCompileSection = struct {
    version: u16,
    render_bands: []geometry.SurfaceBand,
    collider_bands: []geometry.SolidBand,
    cover_bands: []geometry.SolidBand,
    navigation_bands: []geometry.SolidBand,
    sound_bands: []geometry.SolidBand,
    visibility_bands: []geometry.SolidBand,
    material_bindings: []MaterialBinding,
    doors: []DoorRow,
    portals: []PortalRow,
    room_faces: []RoomFace,
    pick_proxies: []geometry.PickProxy,
    junctions: []geometry.JunctionPatch,
    diagnostics: []ArchitectureDiagnostic,
    target_hashes: []TargetHash,
    affected_bounds: []types.AffectedBounds,

    pub fn deinit(self: *WallCompileSection, allocator: std.mem.Allocator) void {
        deinitOwnedSlice(geometry.SurfaceBand, allocator, self.render_bands);
        deinitOwnedSlice(geometry.SolidBand, allocator, self.collider_bands);
        deinitOwnedSlice(geometry.SolidBand, allocator, self.cover_bands);
        deinitOwnedSlice(geometry.SolidBand, allocator, self.navigation_bands);
        deinitOwnedSlice(geometry.SolidBand, allocator, self.sound_bands);
        deinitOwnedSlice(geometry.SolidBand, allocator, self.visibility_bands);
        deinitOwnedSlice(MaterialBinding, allocator, self.material_bindings);
        deinitOwnedSlice(DoorRow, allocator, self.doors);
        deinitOwnedSlice(PortalRow, allocator, self.portals);
        deinitOwnedSlice(RoomFace, allocator, self.room_faces);
        deinitOwnedSlice(geometry.PickProxy, allocator, self.pick_proxies);
        deinitOwnedSlice(geometry.JunctionPatch, allocator, self.junctions);
        deinitOwnedSlice(ArchitectureDiagnostic, allocator, self.diagnostics);
        freeSlice(TargetHash, allocator, self.target_hashes);
        freeSlice(types.AffectedBounds, allocator, self.affected_bounds);
        self.* = undefined;
    }
};

/// Derived floor plates for enclosed rooms (USER RULING req_4482: floors react
/// to wall edits — derived from interior faces, never authored source records).
pub const FloorCompileSection = struct {
    version: u16,
    triangles: []floor_geometry.FloorTriangle,

    pub fn deinit(self: *FloorCompileSection, allocator: std.mem.Allocator) void {
        deinitOwnedSlice(floor_geometry.FloorTriangle, allocator, self.triangles);
        self.* = undefined;
    }
};

pub const ArchitectureCompileBundle = struct {
    magic: [4]u8,
    version: u16,
    source_revision: u32,
    source_hash: Digest,
    compiler_hash: Digest,
    tuning_hash: Digest,
    catalog_hash: Digest,
    bundle_hash: Digest,
    sections: []SectionDirectoryEntry,
    wall: WallCompileSection,
    floor: FloorCompileSection,
    canonical_bytes: []u8,

    pub fn deinit(self: *ArchitectureCompileBundle, allocator: std.mem.Allocator) void {
        freeSlice(SectionDirectoryEntry, allocator, self.sections);
        self.wall.deinit(allocator);
        self.floor.deinit(allocator);
        freeBytes(allocator, self.canonical_bytes);
        self.* = undefined;
    }
};

pub const CompileError = std.mem.Allocator.Error || error{
    invalid_compile_source,
    missing_compile_catalog_entry,
    compile_limit_exceeded,
} || topology.BuildError || geometry.BuildError;

/// Compile one validated semantic source into the single wall parity packet.
pub fn compile(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    options: CompileOptions,
) CompileError!ArchitectureCompileBundle {
    var derived = try topology.build(allocator, &source.walls);
    defer derived.deinit(allocator);
    if (derived.diagnostics.len != 0) return error.invalid_compile_source;

    var generated = try geometry.build(allocator, source, entries, &derived);
    defer generated.deinit(allocator);
    sortGeometry(source, &generated);

    const source_hash = try hashCanonicalSource(allocator, source);
    const compiler_hash = hashBytes(compiler_version);
    const tuning_hash = try hashTuning(allocator);
    const catalog_hash = try hashCatalog(allocator, entries);
    const affected_bounds = try ownedSortedBounds(allocator, options.affected_bounds);
    errdefer freeSlice(types.AffectedBounds, allocator, affected_bounds);

    var wall = WallCompileSection{
        .version = wall_section_version,
        .render_bands = try buildRenderBands(allocator, source, generated.surfaces, options),
        .collider_bands = undefined,
        .cover_bands = undefined,
        .navigation_bands = undefined,
        .sound_bands = undefined,
        .visibility_bands = undefined,
        .material_bindings = undefined,
        .doors = undefined,
        .portals = undefined,
        .room_faces = undefined,
        .pick_proxies = undefined,
        .junctions = undefined,
        .diagnostics = undefined,
        .target_hashes = undefined,
        .affected_bounds = affected_bounds,
    };
    errdefer deinitOwnedSlice(geometry.SurfaceBand, allocator, wall.render_bands);
    wall.collider_bands = try buildSolidBands(allocator, source, generated.colliders, options, .collision);
    errdefer deinitOwnedSlice(geometry.SolidBand, allocator, wall.collider_bands);
    wall.cover_bands = try buildSolidBands(allocator, source, generated.cover, options, .cover);
    errdefer deinitOwnedSlice(geometry.SolidBand, allocator, wall.cover_bands);
    wall.navigation_bands = try buildSolidBands(allocator, source, generated.navigation_blockers, options, .navigation);
    errdefer deinitOwnedSlice(geometry.SolidBand, allocator, wall.navigation_bands);
    wall.sound_bands = try buildSolidBands(allocator, source, generated.sound_occluders, options, .audio);
    errdefer deinitOwnedSlice(geometry.SolidBand, allocator, wall.sound_bands);
    wall.visibility_bands = try buildSolidBands(allocator, source, generated.sightline_occluders, options, .visibility);
    errdefer deinitOwnedSlice(geometry.SolidBand, allocator, wall.visibility_bands);
    wall.material_bindings = try buildMaterialBindings(allocator, source, entries, options);
    errdefer deinitOwnedSlice(MaterialBinding, allocator, wall.material_bindings);
    wall.doors = try buildDoors(allocator, source, entries, generated.door_frames, options);
    errdefer deinitOwnedSlice(DoorRow, allocator, wall.doors);
    wall.room_faces = try buildRoomFaces(allocator, source, &derived, options);
    errdefer deinitOwnedSlice(RoomFace, allocator, wall.room_faces);
    wall.portals = try buildPortals(allocator, source, &derived, generated.traversal, options);
    errdefer deinitOwnedSlice(PortalRow, allocator, wall.portals);
    wall.pick_proxies = try buildPickProxies(allocator, source, generated.pick_proxies, options);
    errdefer deinitOwnedSlice(geometry.PickProxy, allocator, wall.pick_proxies);
    wall.junctions = try buildJunctions(allocator, generated.junctions, options);
    errdefer deinitOwnedSlice(geometry.JunctionPatch, allocator, wall.junctions);
    wall.diagnostics = try buildDiagnostics(allocator, derived.diagnostics, options);
    errdefer deinitOwnedSlice(ArchitectureDiagnostic, allocator, wall.diagnostics);
    wall.target_hashes = try buildTargetHashes(allocator, source, &wall, options);
    errdefer freeSlice(TargetHash, allocator, wall.target_hashes);

    var floor = FloorCompileSection{
        .version = floor_section_version,
        .triangles = try buildFloorTriangles(allocator, source, &derived, options),
    };
    errdefer floor.deinit(allocator);

    const section_bytes = try encodeWallSection(allocator, source, &wall);
    defer freeBytes(allocator, section_bytes);
    const section_hash = hashBytes(section_bytes);
    const floor_bytes = try encodeFloorSection(allocator, &floor);
    defer freeBytes(allocator, floor_bytes);
    const floor_hash = hashBytes(floor_bytes);
    const sections = try allocator.alloc(SectionDirectoryEntry, 2);
    errdefer allocator.free(sections);
    sections[0] = .{
        .family = .wall,
        .version = wall_section_version,
        .offset = 0,
        .byte_length = @intCast(section_bytes.len),
        .item_count = wallItemCount(&wall),
        .section_hash = section_hash,
    };
    sections[1] = .{
        .family = .floor,
        .version = floor_section_version,
        .offset = 0,
        .byte_length = @intCast(floor_bytes.len),
        .item_count = @intCast(floor.triangles.len),
        .section_hash = floor_hash,
    };
    const provisional_header = try encodeBundleHeader(
        allocator,
        source.revision,
        source_hash,
        compiler_hash,
        tuning_hash,
        catalog_hash,
        sections,
    );
    sections[0].offset = @intCast(provisional_header.len);
    sections[1].offset = @intCast(provisional_header.len + section_bytes.len);
    freeBytes(allocator, provisional_header);
    const header = try encodeBundleHeader(
        allocator,
        source.revision,
        source_hash,
        compiler_hash,
        tuning_hash,
        catalog_hash,
        sections,
    );
    defer freeBytes(allocator, header);
    const canonical_bytes = try allocator.alloc(u8, header.len + section_bytes.len + floor_bytes.len);
    errdefer allocator.free(canonical_bytes);
    @memcpy(canonical_bytes[0..header.len], header);
    @memcpy(canonical_bytes[header.len .. header.len + section_bytes.len], section_bytes);
    @memcpy(canonical_bytes[header.len + section_bytes.len ..], floor_bytes);
    return .{
        .magic = bundle_magic,
        .version = bundle_version,
        .source_revision = source.revision,
        .source_hash = source_hash,
        .compiler_hash = compiler_hash,
        .tuning_hash = tuning_hash,
        .catalog_hash = catalog_hash,
        .bundle_hash = hashBytes(canonical_bytes),
        .sections = sections,
        .wall = wall,
        .floor = floor,
        .canonical_bytes = canonical_bytes,
    };
}

/// Interior faces become floor plates; bounds/target selection mirrors the wall
/// products (floors ride the render target until they grow their own).
fn buildFloorTriangles(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    options: CompileOptions,
) std.mem.Allocator.Error![]floor_geometry.FloorTriangle {
    if (!targetSelected(options.targets, .render)) return allocator.alloc(floor_geometry.FloorTriangle, 0);
    if (options.affected_bounds.len == 0) return floor_geometry.build(allocator, source, derived, null);
    const included = try allocator.alloc(bool, derived.faces.len);
    defer freeSlice(bool, allocator, included);
    for (derived.faces, 0..) |face, face_index| {
        included[face_index] = cycleSelected(source, derived, face.outer_boundary.half_edge_indices, options.affected_bounds);
    }
    return floor_geometry.build(allocator, source, derived, included);
}

fn sortGeometry(source: *const types.ArchitectureSource, bundle: *geometry.GeometryBundle) void {
    std.mem.sort(geometry.SurfaceBand, bundle.surfaces, source, surfaceLessThan);
    std.mem.sort(geometry.SolidBand, bundle.colliders, source, solidLessThan);
    std.mem.sort(geometry.SolidBand, bundle.cover, source, solidLessThan);
    std.mem.sort(geometry.SolidBand, bundle.navigation_blockers, source, solidLessThan);
    std.mem.sort(geometry.SolidBand, bundle.sound_occluders, source, solidLessThan);
    std.mem.sort(geometry.SolidBand, bundle.sightline_occluders, source, solidLessThan);
    std.mem.sort(geometry.TraversalInterval, bundle.traversal, source, traversalLessThan);
    std.mem.sort(geometry.DoorAttachmentFrame, bundle.door_frames, source, doorFrameLessThan);
    std.mem.sort(geometry.PickProxy, bundle.pick_proxies, source, pickLessThan);
    std.mem.sort(geometry.JunctionPatch, bundle.junctions, {}, junctionLessThan);
}

fn surfaceLessThan(source: *const types.ArchitectureSource, left: geometry.SurfaceBand, right: geometry.SurfaceBand) bool {
    const floor_order = compareEdgeFloors(source, left.edge_id, right.edge_id);
    if (floor_order != .eq) return floor_order == .lt;
    const edge_order = std.mem.order(u8, left.edge_id, right.edge_id);
    if (edge_order != .eq) return edge_order == .lt;
    const left_side = sideOrder(left.side);
    const right_side = sideOrder(right.side);
    if (left_side != right_side) return left_side < right_side;
    if (left.column_start_u != right.column_start_u) return left.column_start_u < right.column_start_u;
    if (left.row_bottom_u != right.row_bottom_u) return left.row_bottom_u < right.row_bottom_u;
    if (left.column_end_u != right.column_end_u) return left.column_end_u < right.column_end_u;
    if (left.row_top_u != right.row_top_u) return left.row_top_u < right.row_top_u;
    if (left.role != right.role) return @intFromEnum(left.role) < @intFromEnum(right.role);
    return optionalStringLessThan(left.opening_id, right.opening_id);
}

fn solidLessThan(source: *const types.ArchitectureSource, left: geometry.SolidBand, right: geometry.SolidBand) bool {
    const floor_order = compareEdgeFloors(source, left.edge_id, right.edge_id);
    if (floor_order != .eq) return floor_order == .lt;
    const edge_order = std.mem.order(u8, left.edge_id, right.edge_id);
    if (edge_order != .eq) return edge_order == .lt;
    if (left.column_start_u != right.column_start_u) return left.column_start_u < right.column_start_u;
    if (left.row_bottom_u != right.row_bottom_u) return left.row_bottom_u < right.row_bottom_u;
    if (left.column_end_u != right.column_end_u) return left.column_end_u < right.column_end_u;
    if (left.row_top_u != right.row_top_u) return left.row_top_u < right.row_top_u;
    return optionalStringLessThan(left.opening_id, right.opening_id);
}

fn traversalLessThan(source: *const types.ArchitectureSource, left: geometry.TraversalInterval, right: geometry.TraversalInterval) bool {
    const floor_order = compareEdgeFloors(source, left.edge_id, right.edge_id);
    if (floor_order != .eq) return floor_order == .lt;
    const edge_order = std.mem.order(u8, left.edge_id, right.edge_id);
    if (edge_order != .eq) return edge_order == .lt;
    if (left.column_start_u != right.column_start_u) return left.column_start_u < right.column_start_u;
    return std.mem.lessThan(u8, left.opening_id, right.opening_id);
}

fn doorFrameLessThan(source: *const types.ArchitectureSource, left: geometry.DoorAttachmentFrame, right: geometry.DoorAttachmentFrame) bool {
    const floor_order = compareEdgeFloors(source, left.edge_id, right.edge_id);
    if (floor_order != .eq) return floor_order == .lt;
    const edge_order = std.mem.order(u8, left.edge_id, right.edge_id);
    if (edge_order != .eq) return edge_order == .lt;
    return std.mem.lessThan(u8, left.opening_id, right.opening_id);
}

fn pickLessThan(source: *const types.ArchitectureSource, left: geometry.PickProxy, right: geometry.PickProxy) bool {
    const floor_order = compareEdgeFloors(source, left.edge_id, right.edge_id);
    if (floor_order != .eq) return floor_order == .lt;
    const edge_order = std.mem.order(u8, left.edge_id, right.edge_id);
    if (edge_order != .eq) return edge_order == .lt;
    const left_side = sideOrder(left.side);
    const right_side = sideOrder(right.side);
    if (left_side != right_side) return left_side < right_side;
    if (left.column_start_u != right.column_start_u) return left.column_start_u < right.column_start_u;
    if (left.row_bottom_u != right.row_bottom_u) return left.row_bottom_u < right.row_bottom_u;
    if (left.kind != right.kind) return @intFromEnum(left.kind) < @intFromEnum(right.kind);
    return optionalStringLessThan(left.opening_id, right.opening_id);
}

fn junctionLessThan(_: void, left: geometry.JunctionPatch, right: geometry.JunctionPatch) bool {
    if (left.floor != right.floor) return left.floor < right.floor;
    const id_order = std.mem.order(u8, left.vertex_id, right.vertex_id);
    if (id_order != .eq) return id_order == .lt;
    return @intFromEnum(left.kind) < @intFromEnum(right.kind);
}

fn compareEdgeFloors(source: *const types.ArchitectureSource, left_id: []const u8, right_id: []const u8) std.math.Order {
    return std.math.order(edgeFloor(source, left_id), edgeFloor(source, right_id));
}

fn optionalStringLessThan(left: ?[]const u8, right: ?[]const u8) bool {
    if (left == null) return right != null;
    if (right == null) return false;
    return std.mem.lessThan(u8, left.?, right.?);
}

fn sideOrder(side: ?types.WallSide) u8 {
    return if (side) |value| switch (value) {
        .a => 0,
        .b => 1,
    } else 2;
}

fn buildRenderBands(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    values: []const geometry.SurfaceBand,
    options: CompileOptions,
) std.mem.Allocator.Error![]geometry.SurfaceBand {
    if (!targetSelected(options.targets, .render)) return allocator.alloc(geometry.SurfaceBand, 0);
    var result: std.ArrayList(geometry.SurfaceBand) = .empty;
    errdefer deinitArrayList(geometry.SurfaceBand, allocator, &result);
    for (values) |value| {
        if (!edgeSelected(source, value.edge_id, options.affected_bounds)) continue;
        try result.append(allocator, try cloneSurfaceBand(allocator, value));
    }
    return result.toOwnedSlice(allocator);
}

fn buildSolidBands(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    values: []const geometry.SolidBand,
    options: CompileOptions,
    target: types.DirtyTarget,
) std.mem.Allocator.Error![]geometry.SolidBand {
    if (!targetSelected(options.targets, target)) return allocator.alloc(geometry.SolidBand, 0);
    var result: std.ArrayList(geometry.SolidBand) = .empty;
    errdefer deinitArrayList(geometry.SolidBand, allocator, &result);
    for (values) |value| {
        if (!edgeSelected(source, value.edge_id, options.affected_bounds)) continue;
        try result.append(allocator, try cloneSolidBand(allocator, value));
    }
    return result.toOwnedSlice(allocator);
}

fn buildPickProxies(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    values: []const geometry.PickProxy,
    options: CompileOptions,
) std.mem.Allocator.Error![]geometry.PickProxy {
    if (!targetSelected(options.targets, .pick_proxies)) return allocator.alloc(geometry.PickProxy, 0);
    var result: std.ArrayList(geometry.PickProxy) = .empty;
    errdefer deinitArrayList(geometry.PickProxy, allocator, &result);
    for (values) |value| {
        if (!edgeSelected(source, value.edge_id, options.affected_bounds)) continue;
        try result.append(allocator, try clonePickProxy(allocator, value));
    }
    return result.toOwnedSlice(allocator);
}

fn buildJunctions(
    allocator: std.mem.Allocator,
    values: []const geometry.JunctionPatch,
    options: CompileOptions,
) std.mem.Allocator.Error![]geometry.JunctionPatch {
    if (!targetSelected(options.targets, .render)) return allocator.alloc(geometry.JunctionPatch, 0);
    var result: std.ArrayList(geometry.JunctionPatch) = .empty;
    errdefer deinitArrayList(geometry.JunctionPatch, allocator, &result);
    for (values) |value| {
        if (!floorSelected(value.floor, options.affected_bounds)) continue;
        const vertex_id = try allocator.dupe(u8, value.vertex_id);
        errdefer allocator.free(vertex_id);
        try result.append(allocator, .{
            .vertex_id = vertex_id,
            .floor = value.floor,
            .kind = value.kind,
            .incident_edge_count = value.incident_edge_count,
            .point_m = value.point_m,
            .miter_ratio = value.miter_ratio,
        });
    }
    return result.toOwnedSlice(allocator);
}

fn cloneSurfaceBand(allocator: std.mem.Allocator, value: geometry.SurfaceBand) std.mem.Allocator.Error!geometry.SurfaceBand {
    const edge_id = try allocator.dupe(u8, value.edge_id);
    errdefer allocator.free(edge_id);
    const opening_id = if (value.opening_id) |id| try allocator.dupe(u8, id) else null;
    errdefer if (opening_id) |id| allocator.free(id);
    const material_id = try allocator.dupe(u8, value.material_id);
    errdefer allocator.free(material_id);
    return .{
        .edge_id = edge_id,
        .opening_id = opening_id,
        .role = value.role,
        .side = value.side,
        .material_id = material_id,
        .column_start_u = value.column_start_u,
        .column_end_u = value.column_end_u,
        .row_bottom_u = value.row_bottom_u,
        .row_top_u = value.row_top_u,
        .quad_m = value.quad_m,
        .normal = value.normal,
        .uv_m = value.uv_m,
    };
}

fn cloneSolidBand(allocator: std.mem.Allocator, value: geometry.SolidBand) std.mem.Allocator.Error!geometry.SolidBand {
    const edge_id = try allocator.dupe(u8, value.edge_id);
    errdefer allocator.free(edge_id);
    const opening_id = if (value.opening_id) |id| try allocator.dupe(u8, id) else null;
    errdefer if (opening_id) |id| allocator.free(id);
    return .{
        .edge_id = edge_id,
        .opening_id = opening_id,
        .column_start_u = value.column_start_u,
        .column_end_u = value.column_end_u,
        .row_bottom_u = value.row_bottom_u,
        .row_top_u = value.row_top_u,
    };
}

fn clonePickProxy(allocator: std.mem.Allocator, value: geometry.PickProxy) std.mem.Allocator.Error!geometry.PickProxy {
    const edge_id = try allocator.dupe(u8, value.edge_id);
    errdefer allocator.free(edge_id);
    const opening_id = if (value.opening_id) |id| try allocator.dupe(u8, id) else null;
    errdefer if (opening_id) |id| allocator.free(id);
    return .{
        .edge_id = edge_id,
        .opening_id = opening_id,
        .kind = value.kind,
        .side = value.side,
        .column_start_u = value.column_start_u,
        .column_end_u = value.column_end_u,
        .row_bottom_u = value.row_bottom_u,
        .row_top_u = value.row_top_u,
        .quad_m = value.quad_m,
        .normal = value.normal,
    };
}

fn cloneDoorFrame(allocator: std.mem.Allocator, value: geometry.DoorAttachmentFrame) std.mem.Allocator.Error!geometry.DoorAttachmentFrame {
    const edge_id = try allocator.dupe(u8, value.edge_id);
    errdefer allocator.free(edge_id);
    const opening_id = try allocator.dupe(u8, value.opening_id);
    errdefer allocator.free(opening_id);
    const kit_id = try allocator.dupe(u8, value.kit_id);
    errdefer allocator.free(kit_id);
    return .{
        .edge_id = edge_id,
        .opening_id = opening_id,
        .kit_id = kit_id,
        .origin_m = value.origin_m,
        .tangent = value.tangent,
        .outward = value.outward,
        .up = value.up,
        .facing_side = value.facing_side,
        .hinge = value.hinge,
    };
}

fn cloneTraversal(allocator: std.mem.Allocator, value: geometry.TraversalInterval) std.mem.Allocator.Error!geometry.TraversalInterval {
    const edge_id = try allocator.dupe(u8, value.edge_id);
    errdefer allocator.free(edge_id);
    const opening_id = try allocator.dupe(u8, value.opening_id);
    errdefer allocator.free(opening_id);
    return .{
        .edge_id = edge_id,
        .opening_id = opening_id,
        .column_start_u = value.column_start_u,
        .column_end_u = value.column_end_u,
        .row_bottom_u = value.row_bottom_u,
        .row_top_u = value.row_top_u,
        .portal_class = value.portal_class,
    };
}

fn buildMaterialBindings(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    options: CompileOptions,
) CompileError![]MaterialBinding {
    if (!targetSelected(options.targets, .materials)) return allocator.alloc(MaterialBinding, 0);
    const ordered_edges = try allocator.alloc(*const types.WallEdge, source.walls.edges.len);
    defer freeSlice(*const types.WallEdge, allocator, ordered_edges);
    for (source.walls.edges, 0..) |*edge, index| ordered_edges[index] = edge;
    std.mem.sort(*const types.WallEdge, ordered_edges, source, edgePointerLessThan);
    var result: std.ArrayList(MaterialBinding) = .empty;
    errdefer deinitArrayList(MaterialBinding, allocator, &result);
    for (ordered_edges) |edge| {
        if (!edgeSelected(source, edge.id, options.affected_bounds)) continue;
        const style = findCatalogEntry(entries, edge.style_id) orelse return error.missing_compile_catalog_entry;
        try result.append(allocator, try ownedMaterialBinding(allocator, edge, style, .a));
        try result.append(allocator, try ownedMaterialBinding(allocator, edge, style, .b));
    }
    return result.toOwnedSlice(allocator);
}

fn ownedMaterialBinding(
    allocator: std.mem.Allocator,
    edge: *const types.WallEdge,
    style: *const catalog.CatalogEntry,
    side: types.WallSide,
) std.mem.Allocator.Error!MaterialBinding {
    const side_text = if (side == .a) "a" else "b";
    const id = try std.fmt.allocPrint(allocator, "{s}:{s}:face", .{ edge.id, side_text });
    errdefer allocator.free(id);
    const edge_id = try allocator.dupe(u8, edge.id);
    errdefer allocator.free(edge_id);
    const catalog_id = try allocator.dupe(u8, style.catalog_id);
    errdefer allocator.free(catalog_id);
    const content_hash = try allocator.dupe(u8, style.content_hash);
    errdefer allocator.free(content_hash);
    const source_material_id = if (side == .a) edge.side_a.material_id else edge.side_b.material_id;
    const material_id = try allocator.dupe(u8, source_material_id);
    errdefer allocator.free(material_id);
    return .{
        .id = id,
        .edge_id = edge_id,
        .side = if (side == .a) .a else .b,
        .role = .face,
        .catalog_id = catalog_id,
        .content_hash = content_hash,
        .material_id = material_id,
    };
}

fn buildDoors(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const catalog.CatalogEntry,
    values: []const geometry.DoorAttachmentFrame,
    options: CompileOptions,
) CompileError![]DoorRow {
    if (!targetSelected(options.targets, .doors_portals)) return allocator.alloc(DoorRow, 0);
    var result: std.ArrayList(DoorRow) = .empty;
    errdefer deinitArrayList(DoorRow, allocator, &result);
    for (values) |value| {
        if (!edgeSelected(source, value.edge_id, options.affected_bounds)) continue;
        const kit = findCatalogEntry(entries, value.kit_id) orelse return error.missing_compile_catalog_entry;
        const id = try std.fmt.allocPrint(allocator, "door:{s}", .{value.opening_id});
        errdefer allocator.free(id);
        const opening_id = try allocator.dupe(u8, value.opening_id);
        errdefer allocator.free(opening_id);
        const edge_id = try allocator.dupe(u8, value.edge_id);
        errdefer allocator.free(edge_id);
        const kit_catalog_id = try allocator.dupe(u8, value.kit_id);
        errdefer allocator.free(kit_catalog_id);
        const kit_content_hash = try allocator.dupe(u8, kit.content_hash);
        errdefer allocator.free(kit_content_hash);
        const attachment = try cloneDoorFrame(allocator, value);
        errdefer {
            var owned_attachment = attachment;
            owned_attachment.deinit(allocator);
        }
        try result.append(allocator, .{
            .id = id,
            .opening_id = opening_id,
            .edge_id = edge_id,
            .kit_catalog_id = kit_catalog_id,
            .kit_content_hash = kit_content_hash,
            .facing_side = value.facing_side,
            .hinge = value.hinge,
            .attachment = attachment,
        });
    }
    return result.toOwnedSlice(allocator);
}

fn buildRoomFaces(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    options: CompileOptions,
) std.mem.Allocator.Error![]RoomFace {
    if (!targetSelected(options.targets, .rooms)) return allocator.alloc(RoomFace, 0);
    var result: std.ArrayList(RoomFace) = .empty;
    errdefer deinitArrayList(RoomFace, allocator, &result);
    for (derived.faces) |face| {
        if (!cycleSelected(source, derived, face.outer_boundary.half_edge_indices, options.affected_bounds)) continue;
        try result.append(allocator, try ownedRoomFace(
            allocator,
            derived,
            face.signature,
            face.floor,
            .interior,
            face.signed_area_twice,
            face.outer_boundary.half_edge_indices,
            null,
        ));
    }
    for (derived.exteriors, 0..) |exterior, exterior_index| {
        if (!floorSelected(exterior.floor, options.affected_bounds)) continue;
        var boundary_ids: std.ArrayList([]u8) = .empty;
        errdefer freeStringArrayList(allocator, &boundary_ids);
        var area: i128 = 0;
        for (exterior.boundary_cycles) |cycle| {
            area += cycleSignedArea(derived, cycle.half_edge_indices);
            try appendBoundaryIds(allocator, &boundary_ids, derived, cycle.half_edge_indices);
        }
        const ids = try boundary_ids.toOwnedSlice(allocator);
        errdefer freeStringList(allocator, ids);
        const signature = try exteriorSignature(allocator, derived, exterior_index);
        errdefer allocator.free(signature);
        try result.append(allocator, .{
            .signature = signature,
            .floor = exterior.floor,
            .kind = .exterior,
            .signed_area_twice_u = area,
            .boundary_half_edge_ids = ids,
            .parent_signature = null,
        });
    }
    for (derived.holes) |hole| {
        if (!cycleSelected(source, derived, hole.boundary.half_edge_indices, options.affected_bounds)) continue;
        try result.append(allocator, try ownedRoomFace(
            allocator,
            derived,
            hole.signature,
            hole.floor,
            .hole,
            hole.signed_area_twice,
            hole.boundary.half_edge_indices,
            derived.faces[hole.containing_face_index].signature,
        ));
    }
    const owned = try result.toOwnedSlice(allocator);
    std.mem.sort(RoomFace, owned, {}, roomFaceLessThan);
    return owned;
}

fn ownedRoomFace(
    allocator: std.mem.Allocator,
    derived: *const topology.DerivedTopology,
    signature_value: []const u8,
    floor: i32,
    kind: RoomKind,
    area: i128,
    half_edge_indices: []const usize,
    parent: ?[]const u8,
) std.mem.Allocator.Error!RoomFace {
    const signature = try allocator.dupe(u8, signature_value);
    errdefer allocator.free(signature);
    var boundary_ids: std.ArrayList([]u8) = .empty;
    errdefer freeStringArrayList(allocator, &boundary_ids);
    try appendBoundaryIds(allocator, &boundary_ids, derived, half_edge_indices);
    const owned_ids = try boundary_ids.toOwnedSlice(allocator);
    errdefer freeStringList(allocator, owned_ids);
    const parent_signature = if (parent) |value| try allocator.dupe(u8, value) else null;
    errdefer if (parent_signature) |value| allocator.free(value);
    return .{
        .signature = signature,
        .floor = floor,
        .kind = kind,
        .signed_area_twice_u = area,
        .boundary_half_edge_ids = owned_ids,
        .parent_signature = parent_signature,
    };
}

fn appendBoundaryIds(
    allocator: std.mem.Allocator,
    result: *std.ArrayList([]u8),
    derived: *const topology.DerivedTopology,
    half_edge_indices: []const usize,
) std.mem.Allocator.Error!void {
    for (half_edge_indices) |half_edge_index| {
        const half_edge = derived.half_edges[half_edge_index];
        const side_text = if (half_edge.source_side == .a) "a" else "b";
        try result.append(allocator, try std.fmt.allocPrint(allocator, "{s}:{s}", .{ half_edge.source_edge_id, side_text }));
    }
}

fn cycleSignedArea(derived: *const topology.DerivedTopology, half_edge_indices: []const usize) i128 {
    var area: i128 = 0;
    for (half_edge_indices) |half_edge_index| {
        const half_edge = derived.half_edges[half_edge_index];
        const origin = derived.vertices[half_edge.origin_vertex_index].point;
        const target = derived.vertices[half_edge.target_vertex_index].point;
        area += @as(i128, origin.x_u) * @as(i128, target.z_u) - @as(i128, target.x_u) * @as(i128, origin.z_u);
    }
    return area;
}

fn roomFaceLessThan(_: void, left: RoomFace, right: RoomFace) bool {
    if (left.floor != right.floor) return left.floor < right.floor;
    if (left.kind != right.kind) return @intFromEnum(left.kind) < @intFromEnum(right.kind);
    return std.mem.lessThan(u8, left.signature, right.signature);
}

fn buildPortals(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    values: []const geometry.TraversalInterval,
    options: CompileOptions,
) std.mem.Allocator.Error![]PortalRow {
    if (!targetSelected(options.targets, .doors_portals)) return allocator.alloc(PortalRow, 0);
    var result: std.ArrayList(PortalRow) = .empty;
    errdefer deinitArrayList(PortalRow, allocator, &result);
    for (values) |value| {
        if (!edgeSelected(source, value.edge_id, options.affected_bounds)) continue;
        const id = try std.fmt.allocPrint(allocator, "portal:{s}", .{value.opening_id});
        errdefer allocator.free(id);
        const opening_id = try allocator.dupe(u8, value.opening_id);
        errdefer allocator.free(opening_id);
        const edge_id = try allocator.dupe(u8, value.edge_id);
        errdefer allocator.free(edge_id);
        const room_a = try halfEdgeRoomSignature(allocator, derived, value.edge_id, .a);
        errdefer allocator.free(room_a);
        const room_b = try halfEdgeRoomSignature(allocator, derived, value.edge_id, .b);
        errdefer allocator.free(room_b);
        const interval = try cloneTraversal(allocator, value);
        errdefer {
            var owned_interval = interval;
            owned_interval.deinit(allocator);
        }
        try result.append(allocator, .{
            .id = id,
            .opening_id = opening_id,
            .edge_id = edge_id,
            .room_a = room_a,
            .room_b = room_b,
            .portal_class = value.portal_class,
            .traversable = value.portal_class != .none,
            .interval = interval,
        });
    }
    return result.toOwnedSlice(allocator);
}

fn halfEdgeRoomSignature(
    allocator: std.mem.Allocator,
    derived: *const topology.DerivedTopology,
    edge_id: []const u8,
    side: types.WallSide,
) std.mem.Allocator.Error![]u8 {
    for (derived.half_edges) |half_edge| {
        if (half_edge.source_side != side or !std.mem.eql(u8, half_edge.source_edge_id, edge_id)) continue;
        const face = half_edge.face orelse return allocator.dupe(u8, "unresolved");
        return switch (face) {
            .interior => |index| allocator.dupe(u8, derived.faces[index].signature),
            .exterior => |index| exteriorSignature(allocator, derived, index),
        };
    }
    return allocator.dupe(u8, "unresolved");
}

fn exteriorSignature(
    allocator: std.mem.Allocator,
    derived: *const topology.DerivedTopology,
    exterior_index: usize,
) std.mem.Allocator.Error![]u8 {
    const exterior = derived.exteriors[exterior_index];
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendString("exterior");
    try encoder.appendInt(i32, exterior.floor);
    for (exterior.boundary_cycles) |cycle| {
        for (cycle.half_edge_indices) |half_edge_index| {
            const half_edge = derived.half_edges[half_edge_index];
            try encoder.appendString(half_edge.source_edge_id);
            try encoder.appendByte(@intFromEnum(half_edge.source_side));
        }
    }
    const digest = hashBytes(encoder.items());
    const hex = std.fmt.bytesToHex(digest, .lower);
    return allocator.dupe(u8, &hex);
}

fn buildDiagnostics(
    allocator: std.mem.Allocator,
    values: []const topology.TopologyDiagnostic,
    options: CompileOptions,
) std.mem.Allocator.Error![]ArchitectureDiagnostic {
    if (!targetSelected(options.targets, .topology)) return allocator.alloc(ArchitectureDiagnostic, 0);
    var result: std.ArrayList(ArchitectureDiagnostic) = .empty;
    errdefer deinitArrayList(ArchitectureDiagnostic, allocator, &result);
    for (values) |value| {
        if (!floorSelected(value.floor, options.affected_bounds)) continue;
        const code = try allocator.dupe(u8, @tagName(value.code));
        errdefer allocator.free(code);
        const subject_ids = try cloneStringList(allocator, value.source_ids);
        errdefer freeStringList(allocator, subject_ids);
        const message = try allocator.dupe(u8, value.detail);
        errdefer allocator.free(message);
        try result.append(allocator, .{
            .code = code,
            .severity = .err,
            .family = .wall,
            .subject_ids = subject_ids,
            .floor = value.floor,
            .message = message,
        });
    }
    return result.toOwnedSlice(allocator);
}

fn targetSelected(targets: []const types.DirtyTarget, target: types.DirtyTarget) bool {
    if (targets.len == 0) return true;
    for (targets) |candidate| if (candidate == target) return true;
    return false;
}

fn floorSelected(floor: i32, bounds: []const types.AffectedBounds) bool {
    if (bounds.len == 0) return true;
    for (bounds) |bound| if (bound.floor == floor) return true;
    return false;
}

fn edgeSelected(
    source: *const types.ArchitectureSource,
    edge_id: []const u8,
    bounds: []const types.AffectedBounds,
) bool {
    if (bounds.len == 0) return true;
    const edge = findEdge(source, edge_id) orelse return false;
    const start = findVertex(source, edge.start_vertex_id) orelse return false;
    const end = findVertex(source, edge.end_vertex_id) orelse return false;
    const base_y_u = switch (edge.support) {
        .absolute => |support| support.base_y_u,
        .slab => return false,
    };
    const half_thickness_u = @divTrunc(edge.thickness_u + 1, 2);
    const min_x_u = @min(start.x_u, end.x_u) - half_thickness_u;
    const min_z_u = @min(start.z_u, end.z_u) - half_thickness_u;
    const max_x_u_exclusive = @max(start.x_u, end.x_u) + half_thickness_u + 1;
    const max_z_u_exclusive = @max(start.z_u, end.z_u) + half_thickness_u + 1;
    for (bounds) |bound| {
        if (bound.floor != start.floor) continue;
        if (rangesIntersect(min_x_u, max_x_u_exclusive, bound.min_x_u, bound.max_x_u_exclusive) and
            rangesIntersect(base_y_u, base_y_u + edge.height_u, bound.min_y_u, bound.max_y_u_exclusive) and
            rangesIntersect(min_z_u, max_z_u_exclusive, bound.min_z_u, bound.max_z_u_exclusive)) return true;
    }
    return false;
}

fn cycleSelected(
    source: *const types.ArchitectureSource,
    derived: *const topology.DerivedTopology,
    half_edge_indices: []const usize,
    bounds: []const types.AffectedBounds,
) bool {
    if (bounds.len == 0) return true;
    for (half_edge_indices) |index| {
        if (edgeSelected(source, derived.half_edges[index].source_edge_id, bounds)) return true;
    }
    return false;
}

fn rangesIntersect(first_min: types.Unit, first_max: types.Unit, second_min: types.Unit, second_max: types.Unit) bool {
    return first_min < second_max and second_min < first_max;
}

fn findEdge(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallEdge {
    for (source.walls.edges) |*edge| if (std.mem.eql(u8, edge.id, id)) return edge;
    return null;
}

fn findVertex(source: *const types.ArchitectureSource, id: []const u8) ?*const types.WallVertex {
    for (source.walls.vertices) |*vertex| if (std.mem.eql(u8, vertex.id, id)) return vertex;
    return null;
}

fn edgeFloor(source: *const types.ArchitectureSource, edge_id: []const u8) i32 {
    const edge = findEdge(source, edge_id) orelse unreachable;
    return (findVertex(source, edge.start_vertex_id) orelse unreachable).floor;
}

fn findCatalogEntry(entries: []const catalog.CatalogEntry, id: []const u8) ?*const catalog.CatalogEntry {
    for (entries) |*entry| if (std.mem.eql(u8, entry.catalog_id, id)) return entry;
    return null;
}

fn edgePointerLessThan(source: *const types.ArchitectureSource, left: *const types.WallEdge, right: *const types.WallEdge) bool {
    const left_floor = edgeFloor(source, left.id);
    const right_floor = edgeFloor(source, right.id);
    if (left_floor != right_floor) return left_floor < right_floor;
    return std.mem.lessThan(u8, left.id, right.id);
}

fn ownedSortedBounds(
    allocator: std.mem.Allocator,
    values: []const types.AffectedBounds,
) std.mem.Allocator.Error![]types.AffectedBounds {
    const result = try allocator.dupe(types.AffectedBounds, values);
    std.mem.sort(types.AffectedBounds, result, {}, affectedBoundsLessThan);
    return result;
}

fn affectedBoundsLessThan(_: void, left: types.AffectedBounds, right: types.AffectedBounds) bool {
    if (left.floor != right.floor) return left.floor < right.floor;
    if (left.min_x_u != right.min_x_u) return left.min_x_u < right.min_x_u;
    if (left.min_y_u != right.min_y_u) return left.min_y_u < right.min_y_u;
    if (left.min_z_u != right.min_z_u) return left.min_z_u < right.min_z_u;
    if (left.max_x_u_exclusive != right.max_x_u_exclusive) return left.max_x_u_exclusive < right.max_x_u_exclusive;
    if (left.max_y_u_exclusive != right.max_y_u_exclusive) return left.max_y_u_exclusive < right.max_y_u_exclusive;
    return left.max_z_u_exclusive < right.max_z_u_exclusive;
}

fn selectedFloors(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    bounds: []const types.AffectedBounds,
) std.mem.Allocator.Error![]i32 {
    var floors: std.ArrayList(i32) = .empty;
    defer floors.deinit(allocator);
    if (bounds.len == 0) {
        for (source.walls.vertices) |vertex| try appendUniqueFloor(allocator, &floors, vertex.floor);
    } else {
        for (bounds) |bound| try appendUniqueFloor(allocator, &floors, bound.floor);
    }
    std.mem.sort(i32, floors.items, {}, comptime std.sort.asc(i32));
    return allocator.dupe(i32, floors.items);
}

fn appendUniqueFloor(allocator: std.mem.Allocator, floors: *std.ArrayList(i32), floor: i32) std.mem.Allocator.Error!void {
    for (floors.items) |existing| if (existing == floor) return;
    try floors.append(allocator, floor);
}

fn buildTargetHashes(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    wall: *const WallCompileSection,
    options: CompileOptions,
) std.mem.Allocator.Error![]TargetHash {
    const floors = try selectedFloors(allocator, source, options.affected_bounds);
    defer freeSlice(i32, allocator, floors);
    var result: std.ArrayList(TargetHash) = .empty;
    defer result.deinit(allocator);
    for (floors) |floor| {
        for (std.enums.values(types.DirtyTarget)) |target| {
            if (!targetSelected(options.targets, target)) continue;
            try result.append(allocator, .{
                .target = target,
                .floor = floor,
                .content_hash = try hashTarget(allocator, source, wall, target, floor),
            });
        }
    }
    return result.toOwnedSlice(allocator);
}

fn hashTarget(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    wall: *const WallCompileSection,
    target: types.DirtyTarget,
    floor: i32,
) std.mem.Allocator.Error!Digest {
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendByte(@intFromEnum(target));
    try encoder.appendInt(i32, floor);
    switch (target) {
        .topology => try encodeFloorTopology(allocator, &encoder, source, floor),
        .render => {
            for (wall.render_bands) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeSurface(&encoder, value);
            for (wall.junctions) |value| if (value.floor == floor) try encodeJunction(&encoder, value);
            for (wall.material_bindings) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeMaterial(&encoder, value);
        },
        .collision => for (wall.collider_bands) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeSolid(&encoder, value),
        .cover => for (wall.cover_bands) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeSolid(&encoder, value),
        .materials => for (wall.material_bindings) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeMaterial(&encoder, value),
        .doors_portals => {
            for (wall.doors) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeDoor(&encoder, value);
            for (wall.portals) |value| if (edgeFloor(source, value.edge_id) == floor) try encodePortal(&encoder, value);
        },
        .navigation => for (wall.navigation_bands) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeSolid(&encoder, value),
        .rooms => for (wall.room_faces) |value| if (value.floor == floor) try encodeRoom(&encoder, value),
        .visibility => for (wall.visibility_bands) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeSolid(&encoder, value),
        .audio => for (wall.sound_bands) |value| if (edgeFloor(source, value.edge_id) == floor) try encodeSolid(&encoder, value),
        .pick_proxies => for (wall.pick_proxies) |value| if (edgeFloor(source, value.edge_id) == floor) try encodePick(&encoder, value),
    }
    return hashBytes(encoder.items());
}

fn encodeFloorTopology(
    allocator: std.mem.Allocator,
    encoder: *Encoder,
    source: *const types.ArchitectureSource,
    floor: i32,
) std.mem.Allocator.Error!void {
    const vertices = try allocator.alloc(*const types.WallVertex, source.walls.vertices.len);
    defer freeSlice(*const types.WallVertex, allocator, vertices);
    var vertex_count: usize = 0;
    for (source.walls.vertices) |*vertex| {
        if (vertex.floor != floor) continue;
        vertices[vertex_count] = vertex;
        vertex_count += 1;
    }
    std.mem.sort(*const types.WallVertex, vertices[0..vertex_count], {}, vertexPointerLessThan);
    try encoder.appendLength(vertex_count);
    for (vertices[0..vertex_count]) |vertex| {
        try encoder.appendString(vertex.id);
        try encoder.appendInt(types.Unit, vertex.x_u);
        try encoder.appendInt(types.Unit, vertex.z_u);
    }
    const edges = try allocator.alloc(*const types.WallEdge, source.walls.edges.len);
    defer freeSlice(*const types.WallEdge, allocator, edges);
    var edge_count: usize = 0;
    for (source.walls.edges) |*edge| {
        if (edgeFloor(source, edge.id) != floor) continue;
        edges[edge_count] = edge;
        edge_count += 1;
    }
    std.mem.sort(*const types.WallEdge, edges[0..edge_count], {}, rawEdgePointerLessThan);
    try encoder.appendLength(edge_count);
    for (edges[0..edge_count]) |edge| {
        try encoder.appendString(edge.id);
        try encoder.appendString(edge.start_vertex_id);
        try encoder.appendString(edge.end_vertex_id);
    }
}

fn vertexPointerLessThan(_: void, left: *const types.WallVertex, right: *const types.WallVertex) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn rawEdgePointerLessThan(_: void, left: *const types.WallEdge, right: *const types.WallEdge) bool {
    return std.mem.lessThan(u8, left.id, right.id);
}

fn hashCanonicalSource(allocator: std.mem.Allocator, source: *const types.ArchitectureSource) std.mem.Allocator.Error!Digest {
    const bytes = try types.canonicalSourceBytes(allocator, source);
    defer freeBytes(allocator, bytes);
    return hashBytes(bytes);
}

fn hashTuning(allocator: std.mem.Allocator) std.mem.Allocator.Error!Digest {
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendInt(types.Unit, types.wall_tuning.minimum_wall_length_u);
    try encoder.appendInt(types.Unit, types.wall_tuning.minimum_height_u);
    try encoder.appendInt(types.Unit, types.wall_tuning.maximum_height_u);
    try encoder.appendInt(types.Unit, types.wall_tuning.minimum_thickness_u);
    try encoder.appendInt(types.Unit, types.wall_tuning.maximum_thickness_u);
    try encoder.appendFloat(f64, types.wall_tuning.miter_limit_ratio);
    try encoder.appendFloat(f64, types.wall_tuning.ray_parallel_epsilon);
    try encoder.appendFloat(f64, types.wall_tuning.ray_bounds_epsilon);
    try encoder.appendInt(i32, types.wall_tuning.maximum_floor_magnitude);
    return hashBytes(encoder.items());
}

fn hashCatalog(allocator: std.mem.Allocator, entries: []const catalog.CatalogEntry) std.mem.Allocator.Error!Digest {
    const ordered = try allocator.alloc(*const catalog.CatalogEntry, entries.len);
    defer freeSlice(*const catalog.CatalogEntry, allocator, ordered);
    for (entries, 0..) |*entry, index| ordered[index] = entry;
    std.mem.sort(*const catalog.CatalogEntry, ordered, {}, catalogPointerLessThan);
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendLength(ordered.len);
    for (ordered) |entry| {
        try encoder.appendString(entry.catalog_id);
        try encoder.appendString(entry.content_hash);
    }
    return hashBytes(encoder.items());
}

fn catalogPointerLessThan(_: void, left: *const catalog.CatalogEntry, right: *const catalog.CatalogEntry) bool {
    return std.mem.lessThan(u8, left.catalog_id, right.catalog_id);
}

fn hashBytes(bytes: []const u8) Digest {
    var digest: Digest = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    return digest;
}

fn encodeBundleHeader(
    allocator: std.mem.Allocator,
    source_revision: u32,
    source_hash: Digest,
    compiler_hash: Digest,
    tuning_hash: Digest,
    catalog_hash: Digest,
    sections: []const SectionDirectoryEntry,
) std.mem.Allocator.Error![]u8 {
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendSlice(&bundle_magic);
    try encoder.appendInt(u16, bundle_version);
    try encoder.appendInt(u32, source_revision);
    try encoder.appendSlice(&source_hash);
    try encoder.appendSlice(&compiler_hash);
    try encoder.appendSlice(&tuning_hash);
    try encoder.appendSlice(&catalog_hash);
    try encoder.appendLength(sections.len);
    for (sections) |section| {
        try encoder.appendByte(@intFromEnum(section.family));
        try encoder.appendInt(u16, section.version);
        try encoder.appendInt(u64, section.offset);
        try encoder.appendInt(u64, section.byte_length);
        try encoder.appendInt(u64, section.item_count);
        try encoder.appendSlice(&section.section_hash);
    }
    return encoder.take();
}

fn encodeWallSection(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    wall: *const WallCompileSection,
) std.mem.Allocator.Error![]u8 {
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendInt(u16, wall.version);
    try encoder.appendLength(wall.render_bands.len);
    for (wall.render_bands) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeSurface(&encoder, value);
    }
    try encoder.appendLength(wall.collider_bands.len);
    for (wall.collider_bands) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeSolid(&encoder, value);
    }
    try encoder.appendLength(wall.cover_bands.len);
    for (wall.cover_bands) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeSolid(&encoder, value);
    }
    try encoder.appendLength(wall.navigation_bands.len);
    for (wall.navigation_bands) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeSolid(&encoder, value);
    }
    try encoder.appendLength(wall.sound_bands.len);
    for (wall.sound_bands) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeSolid(&encoder, value);
    }
    try encoder.appendLength(wall.visibility_bands.len);
    for (wall.visibility_bands) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeSolid(&encoder, value);
    }
    try encoder.appendLength(wall.material_bindings.len);
    for (wall.material_bindings) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeMaterial(&encoder, value);
    }
    try encoder.appendLength(wall.doors.len);
    for (wall.doors) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodeDoor(&encoder, value);
    }
    try encoder.appendLength(wall.portals.len);
    for (wall.portals) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodePortal(&encoder, value);
    }
    try encoder.appendLength(wall.room_faces.len);
    for (wall.room_faces) |value| try encodeRoom(&encoder, value);
    try encoder.appendLength(wall.pick_proxies.len);
    for (wall.pick_proxies) |value| {
        try encoder.appendInt(i32, edgeFloor(source, value.edge_id));
        try encodePick(&encoder, value);
    }
    try encoder.appendLength(wall.junctions.len);
    for (wall.junctions) |value| try encodeJunction(&encoder, value);
    try encoder.appendLength(wall.diagnostics.len);
    for (wall.diagnostics) |value| try encodeDiagnostic(&encoder, value);
    try encoder.appendLength(wall.target_hashes.len);
    for (wall.target_hashes) |value| {
        try encoder.appendByte(@intFromEnum(value.target));
        try encoder.appendInt(i32, value.floor);
        try encoder.appendSlice(&value.content_hash);
    }
    try encoder.appendLength(wall.affected_bounds.len);
    for (wall.affected_bounds) |value| try encodeBounds(&encoder, value);
    return encoder.take();
}

fn encodeFloorSection(
    allocator: std.mem.Allocator,
    floor: *const FloorCompileSection,
) std.mem.Allocator.Error![]u8 {
    var encoder = Encoder.init(allocator);
    defer encoder.deinit();
    try encoder.appendInt(u16, floor.version);
    try encoder.appendLength(floor.triangles.len);
    for (floor.triangles) |value| {
        try encoder.appendString(value.face_signature);
        try encoder.appendInt(i32, value.floor);
        try encoder.appendByte(@intFromEnum(value.role));
        try encoder.appendString(value.material_id);
        for (value.corners_m) |corner| try encoder.appendPoint3(corner);
        try encoder.appendVector3(value.normal);
        for (value.uv_m) |uv| try encoder.appendPoint2(uv);
    }
    return encoder.take();
}

fn encodeSurface(encoder: *Encoder, value: geometry.SurfaceBand) std.mem.Allocator.Error!void {
    try encoder.appendString(value.edge_id);
    try encoder.appendOptionalString(value.opening_id);
    try encoder.appendByte(@intFromEnum(value.role));
    try encoder.appendOptionalSide(value.side);
    try encoder.appendString(value.material_id);
    try encodeExtent(encoder, value.column_start_u, value.column_end_u, value.row_bottom_u, value.row_top_u);
    for (value.quad_m) |point| try encoder.appendPoint3(point);
    try encoder.appendVector3(value.normal);
    for (value.uv_m) |point| try encoder.appendPoint2(point);
}

fn encodeSolid(encoder: *Encoder, value: geometry.SolidBand) std.mem.Allocator.Error!void {
    try encoder.appendString(value.edge_id);
    try encoder.appendOptionalString(value.opening_id);
    try encodeExtent(encoder, value.column_start_u, value.column_end_u, value.row_bottom_u, value.row_top_u);
}

fn encodeMaterial(encoder: *Encoder, value: MaterialBinding) std.mem.Allocator.Error!void {
    try encoder.appendString(value.id);
    try encoder.appendString(value.edge_id);
    try encoder.appendByte(@intFromEnum(value.side));
    try encoder.appendByte(@intFromEnum(value.role));
    try encoder.appendString(value.catalog_id);
    try encoder.appendString(value.content_hash);
    try encoder.appendString(value.material_id);
}

fn encodeDoor(encoder: *Encoder, value: DoorRow) std.mem.Allocator.Error!void {
    try encoder.appendString(value.id);
    try encoder.appendString(value.opening_id);
    try encoder.appendString(value.edge_id);
    try encoder.appendString(value.kit_catalog_id);
    try encoder.appendString(value.kit_content_hash);
    try encoder.appendByte(@intFromEnum(value.facing_side));
    try encoder.appendByte(@intFromEnum(value.hinge));
    try encoder.appendPoint3(value.attachment.origin_m);
    try encoder.appendVector3(value.attachment.tangent);
    try encoder.appendVector3(value.attachment.outward);
    try encoder.appendVector3(value.attachment.up);
}

fn encodePortal(encoder: *Encoder, value: PortalRow) std.mem.Allocator.Error!void {
    try encoder.appendString(value.id);
    try encoder.appendString(value.opening_id);
    try encoder.appendString(value.edge_id);
    try encoder.appendString(value.room_a);
    try encoder.appendString(value.room_b);
    try encoder.appendByte(@intFromEnum(value.portal_class));
    try encoder.appendByte(@intFromBool(value.traversable));
    try encodeExtent(
        encoder,
        value.interval.column_start_u,
        value.interval.column_end_u,
        value.interval.row_bottom_u,
        value.interval.row_top_u,
    );
}

fn encodeRoom(encoder: *Encoder, value: RoomFace) std.mem.Allocator.Error!void {
    try encoder.appendString(value.signature);
    try encoder.appendInt(i32, value.floor);
    try encoder.appendByte(@intFromEnum(value.kind));
    try encoder.appendInt(i128, value.signed_area_twice_u);
    try encoder.appendLength(value.boundary_half_edge_ids.len);
    for (value.boundary_half_edge_ids) |id| try encoder.appendString(id);
    try encoder.appendOptionalString(value.parent_signature);
}

fn encodePick(encoder: *Encoder, value: geometry.PickProxy) std.mem.Allocator.Error!void {
    try encoder.appendString(value.edge_id);
    try encoder.appendOptionalString(value.opening_id);
    try encoder.appendByte(@intFromEnum(value.kind));
    try encoder.appendOptionalSide(value.side);
    try encodeExtent(encoder, value.column_start_u, value.column_end_u, value.row_bottom_u, value.row_top_u);
    for (value.quad_m) |point| try encoder.appendPoint3(point);
    try encoder.appendVector3(value.normal);
}

fn encodeJunction(encoder: *Encoder, value: geometry.JunctionPatch) std.mem.Allocator.Error!void {
    try encoder.appendString(value.vertex_id);
    try encoder.appendInt(i32, value.floor);
    try encoder.appendByte(@intFromEnum(value.kind));
    try encoder.appendByte(value.incident_edge_count);
    try encoder.appendPoint3(value.point_m);
    try encoder.appendFloat(f32, value.miter_ratio);
}

fn encodeDiagnostic(encoder: *Encoder, value: ArchitectureDiagnostic) std.mem.Allocator.Error!void {
    try encoder.appendString(value.code);
    try encoder.appendByte(@intFromEnum(value.severity));
    try encoder.appendByte(@intFromEnum(value.family));
    try encoder.appendLength(value.subject_ids.len);
    for (value.subject_ids) |id| try encoder.appendString(id);
    try encoder.appendByte(@intFromBool(value.floor != null));
    if (value.floor) |floor| try encoder.appendInt(i32, floor);
    try encoder.appendString(value.message);
}

fn encodeBounds(encoder: *Encoder, value: types.AffectedBounds) std.mem.Allocator.Error!void {
    try encoder.appendInt(i32, value.floor);
    try encoder.appendInt(types.Unit, value.min_x_u);
    try encoder.appendInt(types.Unit, value.min_y_u);
    try encoder.appendInt(types.Unit, value.min_z_u);
    try encoder.appendInt(types.Unit, value.max_x_u_exclusive);
    try encoder.appendInt(types.Unit, value.max_y_u_exclusive);
    try encoder.appendInt(types.Unit, value.max_z_u_exclusive);
}

fn encodeExtent(
    encoder: *Encoder,
    column_start_u: types.Unit,
    column_end_u: types.Unit,
    row_bottom_u: types.Unit,
    row_top_u: types.Unit,
) std.mem.Allocator.Error!void {
    try encoder.appendInt(types.Unit, column_start_u);
    try encoder.appendInt(types.Unit, column_end_u);
    try encoder.appendInt(types.Unit, row_bottom_u);
    try encoder.appendInt(types.Unit, row_top_u);
}

fn wallItemCount(wall: *const WallCompileSection) u64 {
    return @intCast(wall.render_bands.len +
        wall.collider_bands.len +
        wall.cover_bands.len +
        wall.navigation_bands.len +
        wall.sound_bands.len +
        wall.visibility_bands.len +
        wall.material_bindings.len +
        wall.doors.len +
        wall.portals.len +
        wall.room_faces.len +
        wall.pick_proxies.len +
        wall.junctions.len +
        wall.diagnostics.len +
        wall.target_hashes.len);
}

const Encoder = struct {
    allocator: std.mem.Allocator,
    bytes: std.ArrayList(u8) = .empty,

    fn init(allocator: std.mem.Allocator) Encoder {
        return .{ .allocator = allocator };
    }

    fn deinit(self: *Encoder) void {
        self.bytes.deinit(self.allocator);
        self.* = undefined;
    }

    fn items(self: *const Encoder) []const u8 {
        return self.bytes.items;
    }

    fn take(self: *Encoder) std.mem.Allocator.Error![]u8 {
        return self.bytes.toOwnedSlice(self.allocator);
    }

    fn appendByte(self: *Encoder, value: u8) std.mem.Allocator.Error!void {
        try self.bytes.append(self.allocator, value);
    }

    fn appendSlice(self: *Encoder, value: []const u8) std.mem.Allocator.Error!void {
        try self.bytes.appendSlice(self.allocator, value);
    }

    fn appendLength(self: *Encoder, value: usize) std.mem.Allocator.Error!void {
        try self.appendInt(u64, @intCast(value));
    }

    fn appendString(self: *Encoder, value: []const u8) std.mem.Allocator.Error!void {
        try self.appendLength(value.len);
        try self.appendSlice(value);
    }

    fn appendOptionalString(self: *Encoder, value: ?[]const u8) std.mem.Allocator.Error!void {
        try self.appendByte(@intFromBool(value != null));
        if (value) |text| try self.appendString(text);
    }

    fn appendOptionalSide(self: *Encoder, value: ?types.WallSide) std.mem.Allocator.Error!void {
        try self.appendByte(if (value) |side| @intFromEnum(side) + 1 else 0);
    }

    fn appendInt(self: *Encoder, comptime T: type, value: T) std.mem.Allocator.Error!void {
        var encoded: [@sizeOf(T)]u8 = undefined;
        std.mem.writeInt(T, &encoded, value, .little);
        try self.appendSlice(&encoded);
    }

    fn appendFloat(self: *Encoder, comptime T: type, value: T) std.mem.Allocator.Error!void {
        const Bits = std.meta.Int(.unsigned, @bitSizeOf(T));
        try self.appendInt(Bits, @bitCast(value));
    }

    fn appendPoint2(self: *Encoder, point: geometry.Point2Meters) std.mem.Allocator.Error!void {
        try self.appendFloat(f32, point.u);
        try self.appendFloat(f32, point.v);
    }

    fn appendPoint3(self: *Encoder, point: geometry.Point3Meters) std.mem.Allocator.Error!void {
        try self.appendFloat(f32, point.x);
        try self.appendFloat(f32, point.y);
        try self.appendFloat(f32, point.z);
    }

    fn appendVector3(self: *Encoder, vector: geometry.Vector3) std.mem.Allocator.Error!void {
        try self.appendFloat(f32, vector.x);
        try self.appendFloat(f32, vector.y);
        try self.appendFloat(f32, vector.z);
    }
};

fn cloneStringList(allocator: std.mem.Allocator, values: []const []u8) std.mem.Allocator.Error![][]u8 {
    const result = try allocator.alloc([]u8, values.len);
    var initialized: usize = 0;
    errdefer {
        for (result[0..initialized]) |value| allocator.free(value);
        freeSlice([]u8, allocator, result);
    }
    for (values) |value| {
        result[initialized] = try allocator.dupe(u8, value);
        initialized += 1;
    }
    return result;
}

fn deinitArrayList(comptime T: type, allocator: std.mem.Allocator, values: *std.ArrayList(T)) void {
    for (values.items) |*value| value.deinit(allocator);
    values.deinit(allocator);
}

fn freeStringArrayList(allocator: std.mem.Allocator, values: *std.ArrayList([]u8)) void {
    for (values.items) |value| freeBytes(allocator, value);
    values.deinit(allocator);
}

fn deinitOwnedSlice(comptime T: type, allocator: std.mem.Allocator, values: []T) void {
    for (values) |*value| value.deinit(allocator);
    freeSlice(T, allocator, values);
}

fn freeStringList(allocator: std.mem.Allocator, values: [][]u8) void {
    for (values) |value| freeBytes(allocator, value);
    freeSlice([]u8, allocator, values);
}

fn freeBytes(allocator: std.mem.Allocator, bytes: []u8) void {
    if (bytes.len != 0) allocator.free(bytes);
}

fn freeSlice(comptime T: type, allocator: std.mem.Allocator, values: []T) void {
    if (values.len != 0) allocator.free(values);
}
