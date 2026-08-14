//! Validated, measured architecture-kit catalog.
//!
//! Folder paths organize discovery. Typed family/role/kind fields and measured data
//! govern behavior. Neither this module nor its callers infer semantics from IDs.

const std = @import("std");
const scale = @import("architecture_scale");
const types = @import("wall_types");

pub const MeasuredBounds3 = struct {
    min_x_u: f64,
    min_y_u: f64,
    min_z_u: f64,
    max_x_u: f64,
    max_y_u: f64,
    max_z_u: f64,
};

pub const MountBounds2 = struct {
    min_u: f64,
    min_v: f64,
    max_u: f64,
    max_v: f64,
};

pub const Footprint = struct {
    min_column: types.Unit,
    min_row: types.Unit,
    max_column_exclusive: types.Unit,
    max_row_exclusive: types.Unit,

    pub fn width(self: Footprint) types.Unit {
        return self.max_column_exclusive - self.min_column;
    }

    pub fn height(self: Footprint) types.Unit {
        return self.max_row_exclusive - self.min_row;
    }

    pub fn contains(self: Footprint, cell: types.WallCell) bool {
        return cell.column_u >= self.min_column and
            cell.column_u < self.max_column_exclusive and
            cell.row_u >= self.min_row and
            cell.row_u < self.max_row_exclusive;
    }
};

pub const KitMeasurement = struct {
    source_bounds_u: MeasuredBounds3,
    mount_bounds_u: ?MountBounds2,
    footprint: ?Footprint,
    /// Empty means the complete footprint is occupied.
    occupied_mask: []types.WallCell,
    clearance_mask: []types.WallCell,
    pivot_u: types.ArchitecturePoint3,

    pub fn deinit(self: *KitMeasurement, allocator: std.mem.Allocator) void {
        freeSlice(types.WallCell, allocator, self.occupied_mask);
        freeSlice(types.WallCell, allocator, self.clearance_mask);
        self.* = undefined;
    }
};

pub const WallStyleDefaults = struct {
    height_u: types.Unit,
    thickness_u: types.Unit,
    profile: types.WallProfile,
};

pub const WallOpeningCompatibility = struct {
    permitted_profiles: []types.WallProfile,
    permitted_thickness_u: []types.Unit,
    portal_class: types.PortalClass,

    pub fn deinit(self: *WallOpeningCompatibility, allocator: std.mem.Allocator) void {
        freeSlice(types.WallProfile, allocator, self.permitted_profiles);
        freeSlice(types.Unit, allocator, self.permitted_thickness_u);
        self.* = undefined;
    }
};

pub const AssetRefs = struct {
    mesh_content_hash: []u8,
    material_content_hashes: [][]u8,
    animation_content_hash: ?[]u8,

    pub fn deinit(self: *AssetRefs, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.mesh_content_hash);
        freeStringList(allocator, self.material_content_hashes);
        if (self.animation_content_hash) |hash| freeBytes(allocator, hash);
        self.* = undefined;
    }
};

pub const CatalogEntry = struct {
    catalog_id: []u8,
    content_hash: []u8,
    package_id: []u8,
    label: []u8,
    family: types.ArchitectureFamily,
    role: types.ArchitectureKitRole,
    semantic_kind: ?types.SemanticKind,
    category_path: [][]u8,
    theme_tags: [][]u8,
    gameplay_tags: [][]u8,
    measurement: KitMeasurement,
    wall_style_defaults: ?WallStyleDefaults,
    wall_opening_compatibility: ?WallOpeningCompatibility,
    asset_refs: AssetRefs,

    pub fn deinit(self: *CatalogEntry, allocator: std.mem.Allocator) void {
        freeBytes(allocator, self.catalog_id);
        freeBytes(allocator, self.content_hash);
        freeBytes(allocator, self.package_id);
        freeBytes(allocator, self.label);
        freeStringList(allocator, self.category_path);
        freeStringList(allocator, self.theme_tags);
        freeStringList(allocator, self.gameplay_tags);
        self.measurement.deinit(allocator);
        if (self.wall_opening_compatibility) |*compatibility| compatibility.deinit(allocator);
        self.asset_refs.deinit(allocator);
        self.* = undefined;
    }
};

pub const Catalog = struct {
    entries: []CatalogEntry,

    pub fn deinit(self: *Catalog, allocator: std.mem.Allocator) void {
        for (self.entries) |*entry| entry.deinit(allocator);
        freeSlice(CatalogEntry, allocator, self.entries);
        self.* = undefined;
    }
};

pub const CatalogQuery = struct {
    family: types.ArchitectureFamily,
    role: ?types.ArchitectureKitRole = null,
    semantic_kind: ?types.SemanticKind = null,
    required_theme_tags: []const []const u8 = &.{},
    required_gameplay_tags: []const []const u8 = &.{},
    maximum_width_u: ?types.Unit = null,
    maximum_height_u: ?types.Unit = null,
    wall_profile: ?types.WallProfile = null,
    wall_thickness_u: ?types.Unit = null,
};

pub const CatalogQueryResult = struct {
    entry_indices: []usize,

    pub fn deinit(self: *CatalogQueryResult, allocator: std.mem.Allocator) void {
        freeSlice(usize, allocator, self.entry_indices);
        self.* = undefined;
    }
};

pub const ValidationError = error{
    catalog_limit_exceeded,
    duplicate_catalog_id,
    empty_catalog_id,
    catalog_id_too_long,
    empty_package_id,
    empty_label,
    label_too_long,
    invalid_content_hash,
    invalid_asset_hash,
    incompatible_family_role,
    incompatible_semantic_kind,
    invalid_category_path,
    invalid_tag,
    duplicate_tag,
    non_finite_measurement,
    empty_measurement,
    measurement_out_of_range,
    missing_mount_bounds,
    unexpected_mount_bounds,
    missing_footprint,
    unexpected_footprint,
    incorrect_outward_footprint,
    invalid_pivot,
    invalid_occupied_mask,
    invalid_clearance_mask,
    occupied_clearance_overlap,
    missing_wall_style_defaults,
    unexpected_wall_style_defaults,
    incorrect_wall_style_defaults,
    missing_wall_opening_compatibility,
    unexpected_wall_opening_compatibility,
    invalid_wall_opening_compatibility,
};

pub const SourceReferenceError = error{
    unknown_wall_style,
    incompatible_wall_style,
    unknown_opening_kit,
    incompatible_opening_kit,
    opening_kind_mismatch,
};

pub fn validateCatalog(allocator: std.mem.Allocator, entries: []const CatalogEntry) (ValidationError || std.mem.Allocator.Error)!void {
    if (entries.len > types.Limits.maximum_catalog_entries) return error.catalog_limit_exceeded;

    var ids = std.StringHashMap(void).init(allocator);
    defer ids.deinit();

    for (entries) |entry| {
        try validateEntry(entry);
        const result = try ids.getOrPut(entry.catalog_id);
        if (result.found_existing) return error.duplicate_catalog_id;
    }
}

pub fn validateEntry(entry: CatalogEntry) ValidationError!void {
    if (entry.catalog_id.len == 0) return error.empty_catalog_id;
    if (entry.catalog_id.len > types.Limits.maximum_id_bytes) return error.catalog_id_too_long;
    if (entry.package_id.len == 0) return error.empty_package_id;
    if (entry.label.len == 0) return error.empty_label;
    if (entry.label.len > types.Limits.maximum_label_bytes) return error.label_too_long;
    if (!validContentHash(entry.content_hash)) return error.invalid_content_hash;
    if (!validContentHash(entry.asset_refs.mesh_content_hash)) return error.invalid_asset_hash;
    for (entry.asset_refs.material_content_hashes) |hash| {
        if (!validContentHash(hash)) return error.invalid_asset_hash;
    }
    if (entry.asset_refs.animation_content_hash) |hash| {
        if (!validContentHash(hash)) return error.invalid_asset_hash;
    }
    if (!familyRoleCompatible(entry.family, entry.role)) return error.incompatible_family_role;
    if (!semanticKindCompatible(entry.family, entry.role, entry.semantic_kind)) return error.incompatible_semantic_kind;
    try validatePath(entry.category_path);
    try validateTags(entry.theme_tags);
    try validateTags(entry.gameplay_tags);
    try validateMeasurement(entry);
}

/// Resolve persisted references against one already measurable catalog snapshot.
/// Lookup text identifies rows; typed family/role/kind fields alone grant meaning.
pub fn validateSourceCatalogReferences(
    allocator: std.mem.Allocator,
    source: *const types.ArchitectureSource,
    entries: []const CatalogEntry,
) (SourceReferenceError || ValidationError || std.mem.Allocator.Error)!void {
    try validateCatalog(allocator, entries);

    var entry_indices = std.StringHashMap(usize).init(allocator);
    defer entry_indices.deinit();
    for (entries, 0..) |entry, index| try entry_indices.put(entry.catalog_id, index);

    for (source.walls.edges) |edge| {
        const style_index = entry_indices.get(edge.style_id) orelse return error.unknown_wall_style;
        const style = entries[style_index];
        if (style.family != .wall or style.role != .style) return error.incompatible_wall_style;

        for (edge.openings) |opening| {
            const kit_index = entry_indices.get(opening.kit_id) orelse return error.unknown_opening_kit;
            const kit = entries[kit_index];
            if (kit.family != .wall or kit.role != .opening) return error.incompatible_opening_kit;
            const kind = kit.semantic_kind orelse return error.incompatible_opening_kit;
            switch (kind) {
                .wall_opening => |catalog_kind| {
                    if (catalog_kind != opening.kind) return error.opening_kind_mismatch;
                },
                else => return error.incompatible_opening_kit,
            }
        }
    }
}

pub fn queryCatalog(allocator: std.mem.Allocator, entries: []const CatalogEntry, query: CatalogQuery) std.mem.Allocator.Error!CatalogQueryResult {
    var indices: std.ArrayList(usize) = .empty;
    defer indices.deinit(allocator);

    for (entries, 0..) |entry, index| {
        if (!matchesQuery(entry, query)) continue;
        try indices.append(allocator, index);
    }

    std.mem.sort(usize, indices.items, entries, queryIndexLessThan);
    return .{ .entry_indices = try indices.toOwnedSlice(allocator) };
}

pub fn familyRoleCompatible(family: types.ArchitectureFamily, role: types.ArchitectureKitRole) bool {
    return switch (family) {
        .wall => switch (role) {
            .style, .opening, .trim, .cap, .rail, .door_leaf => true,
        },
        .floor => switch (role) {
            .style, .opening, .trim, .cap => true,
            .rail, .door_leaf => false,
        },
        .vertical_link => switch (role) {
            .style, .rail => true,
            .opening, .trim, .cap, .door_leaf => false,
        },
        .roof => switch (role) {
            .style, .opening, .trim, .cap => true,
            .rail, .door_leaf => false,
        },
    };
}

pub fn outwardFootprint(bounds: MountBounds2) ValidationError!Footprint {
    try validateMountBounds(bounds);
    return .{
        .min_column = try roundedUnit(bounds.min_u, .down),
        .min_row = try roundedUnit(bounds.min_v, .down),
        .max_column_exclusive = try roundedUnit(bounds.max_u, .up),
        .max_row_exclusive = try roundedUnit(bounds.max_v, .up),
    };
}

fn validateMeasurement(entry: CatalogEntry) ValidationError!void {
    try validateSourceBounds(entry.measurement.source_bounds_u);
    try validatePivot(entry.measurement.pivot_u);

    const is_wall_opening = entry.family == .wall and entry.role == .opening;
    if (is_wall_opening) {
        const mount = entry.measurement.mount_bounds_u orelse return error.missing_mount_bounds;
        const footprint = entry.measurement.footprint orelse return error.missing_footprint;
        const expected = try outwardFootprint(mount);
        if (!std.meta.eql(expected, footprint)) return error.incorrect_outward_footprint;
        try validateMasks(entry.measurement, footprint);
        const compatibility = entry.wall_opening_compatibility orelse return error.missing_wall_opening_compatibility;
        try validateOpeningCompatibility(compatibility);
    } else {
        if (entry.measurement.mount_bounds_u != null) return error.unexpected_mount_bounds;
        if (entry.measurement.footprint != null) return error.unexpected_footprint;
        if (entry.measurement.occupied_mask.len != 0) return error.invalid_occupied_mask;
        if (entry.measurement.clearance_mask.len != 0) return error.invalid_clearance_mask;
        if (entry.wall_opening_compatibility != null) return error.unexpected_wall_opening_compatibility;
    }

    const is_wall_style = entry.family == .wall and entry.role == .style;
    if (is_wall_style) {
        const defaults = entry.wall_style_defaults orelse return error.missing_wall_style_defaults;
        const derived = try derivedWallStyleDefaults(entry.measurement.source_bounds_u, defaults.profile);
        if (!std.meta.eql(defaults, derived)) return error.incorrect_wall_style_defaults;
    } else if (entry.wall_style_defaults != null) {
        return error.unexpected_wall_style_defaults;
    }
}

fn validateSourceBounds(bounds: MeasuredBounds3) ValidationError!void {
    const values = [_]f64{
        bounds.min_x_u, bounds.min_y_u, bounds.min_z_u,
        bounds.max_x_u, bounds.max_y_u, bounds.max_z_u,
    };
    for (values) |value| {
        if (!std.math.isFinite(value)) return error.non_finite_measurement;
        if (value < scale.Limits.min_unit or value > scale.Limits.max_unit) return error.measurement_out_of_range;
    }
    if (bounds.min_x_u >= bounds.max_x_u or
        bounds.min_y_u >= bounds.max_y_u or
        bounds.min_z_u >= bounds.max_z_u)
    {
        return error.empty_measurement;
    }
}

fn validateMountBounds(bounds: MountBounds2) ValidationError!void {
    const values = [_]f64{ bounds.min_u, bounds.min_v, bounds.max_u, bounds.max_v };
    for (values) |value| {
        if (!std.math.isFinite(value)) return error.non_finite_measurement;
        if (value < scale.Limits.min_unit or value > scale.Limits.max_unit) return error.measurement_out_of_range;
    }
    if (bounds.min_u >= bounds.max_u or bounds.min_v >= bounds.max_v) return error.empty_measurement;
}

fn validatePivot(pivot: types.ArchitecturePoint3) ValidationError!void {
    if (pivot.x_u < scale.Limits.min_unit or pivot.x_u > scale.Limits.max_unit or
        pivot.y_u < scale.Limits.min_unit or pivot.y_u > scale.Limits.max_unit or
        pivot.z_u < scale.Limits.min_unit or pivot.z_u > scale.Limits.max_unit)
    {
        return error.invalid_pivot;
    }
}

fn derivedWallStyleDefaults(bounds: MeasuredBounds3, profile: types.WallProfile) ValidationError!WallStyleDefaults {
    const min_y = try roundedUnit(bounds.min_y_u, .down);
    const max_y = try roundedUnit(bounds.max_y_u, .up);
    const min_z = try roundedUnit(bounds.min_z_u, .down);
    const max_z = try roundedUnit(bounds.max_z_u, .up);
    const height = max_y - min_y;
    const thickness = max_z - min_z;
    if (height < types.wall_tuning.minimum_height_u or height > types.wall_tuning.maximum_height_u or
        thickness < types.wall_tuning.minimum_thickness_u or thickness > types.wall_tuning.maximum_thickness_u)
    {
        return error.incorrect_wall_style_defaults;
    }
    return .{ .height_u = height, .thickness_u = thickness, .profile = profile };
}

fn validateMasks(measurement: KitMeasurement, footprint: Footprint) ValidationError!void {
    for (measurement.occupied_mask, 0..) |cell, index| {
        if (!footprint.contains(cell)) return error.invalid_occupied_mask;
        if (containsCell(measurement.occupied_mask[0..index], cell)) return error.invalid_occupied_mask;
    }

    for (measurement.clearance_mask, 0..) |cell, index| {
        if (!cellInUnitRange(cell)) return error.invalid_clearance_mask;
        if (containsCell(measurement.clearance_mask[0..index], cell)) return error.invalid_clearance_mask;
        const overlaps_occupied = if (measurement.occupied_mask.len == 0)
            footprint.contains(cell)
        else
            containsCell(measurement.occupied_mask, cell);
        if (overlaps_occupied) return error.occupied_clearance_overlap;
    }
}

fn validateOpeningCompatibility(compatibility: WallOpeningCompatibility) ValidationError!void {
    if (compatibility.permitted_profiles.len == 0 or compatibility.permitted_thickness_u.len == 0) {
        return error.invalid_wall_opening_compatibility;
    }
    for (compatibility.permitted_profiles, 0..) |profile, index| {
        if (std.mem.indexOfScalar(types.WallProfile, compatibility.permitted_profiles[0..index], profile) != null) {
            return error.invalid_wall_opening_compatibility;
        }
    }
    for (compatibility.permitted_thickness_u, 0..) |thickness, index| {
        if (thickness < types.wall_tuning.minimum_thickness_u or thickness > types.wall_tuning.maximum_thickness_u) {
            return error.invalid_wall_opening_compatibility;
        }
        if (std.mem.indexOfScalar(types.Unit, compatibility.permitted_thickness_u[0..index], thickness) != null) {
            return error.invalid_wall_opening_compatibility;
        }
    }
}

fn semanticKindCompatible(family: types.ArchitectureFamily, role: types.ArchitectureKitRole, semantic_kind: ?types.SemanticKind) bool {
    if (role == .opening and family == .wall) {
        if (semantic_kind) |kind| return kind == .wall_opening;
        return false;
    }
    if (family == .vertical_link and role == .style) {
        if (semantic_kind) |kind| return kind == .vertical_link;
        return false;
    }
    if (family == .roof and role == .style) {
        if (semantic_kind) |kind| return kind == .roof_profile;
        return false;
    }
    return semantic_kind == null;
}

fn validatePath(path: [][]u8) ValidationError!void {
    if (path.len == 0 or path.len > types.Limits.maximum_path_segments) return error.invalid_category_path;
    for (path) |segment| {
        if (!validCatalogText(segment, types.Limits.maximum_label_bytes) or
            std.mem.indexOfScalar(u8, segment, '/') != null or
            std.mem.indexOfScalar(u8, segment, ':') != null)
        {
            return error.invalid_category_path;
        }
    }
}

fn validateTags(tags: [][]u8) ValidationError!void {
    if (tags.len > types.Limits.maximum_tags_per_entry) return error.invalid_tag;
    for (tags, 0..) |tag, index| {
        if (!validCatalogText(tag, types.Limits.maximum_tag_bytes)) return error.invalid_tag;
        for (tags[0..index]) |earlier| {
            if (std.mem.eql(u8, earlier, tag)) return error.duplicate_tag;
        }
    }
}

fn validCatalogText(value: []const u8, maximum: usize) bool {
    if (value.len == 0 or value.len > maximum) return false;
    for (value) |byte| {
        if (byte < 0x20 or byte == 0x7f) return false;
    }
    return true;
}

fn validContentHash(value: []const u8) bool {
    if (value.len != 64) return false;
    for (value) |byte| {
        if (!((byte >= '0' and byte <= '9') or (byte >= 'a' and byte <= 'f'))) return false;
    }
    return true;
}

const RoundDirection = enum { down, up };

fn roundedUnit(value: f64, direction: RoundDirection) ValidationError!types.Unit {
    if (!std.math.isFinite(value)) return error.non_finite_measurement;
    if (value < scale.Limits.min_unit or value > scale.Limits.max_unit) return error.measurement_out_of_range;
    const rounded: i64 = switch (direction) {
        .down => @floor(value),
        .up => @ceil(value),
    };
    return scale.checkedUnit(rounded) catch return error.measurement_out_of_range;
}

fn containsCell(cells: []const types.WallCell, wanted: types.WallCell) bool {
    for (cells) |cell| {
        if (cell.column_u == wanted.column_u and cell.row_u == wanted.row_u) return true;
    }
    return false;
}

fn cellInUnitRange(cell: types.WallCell) bool {
    return cell.column_u >= scale.Limits.min_unit and cell.column_u <= scale.Limits.max_unit and
        cell.row_u >= scale.Limits.min_unit and cell.row_u <= scale.Limits.max_unit;
}

fn matchesQuery(entry: CatalogEntry, query: CatalogQuery) bool {
    if (entry.family != query.family) return false;
    if (query.role) |role| if (entry.role != role) return false;
    if (query.semantic_kind) |kind| {
        const entry_kind = entry.semantic_kind orelse return false;
        if (!std.meta.eql(kind, entry_kind)) return false;
    }
    if (!containsAllTags(entry.theme_tags, query.required_theme_tags)) return false;
    if (!containsAllTags(entry.gameplay_tags, query.required_gameplay_tags)) return false;
    if (query.maximum_width_u) |maximum| {
        const footprint = entry.measurement.footprint orelse return false;
        if (footprint.width() > maximum) return false;
    }
    if (query.maximum_height_u) |maximum| {
        const footprint = entry.measurement.footprint orelse return false;
        if (footprint.height() > maximum) return false;
    }
    if (query.wall_profile) |profile| {
        if (entry.wall_opening_compatibility) |compatibility| {
            if (std.mem.indexOfScalar(types.WallProfile, compatibility.permitted_profiles, profile) == null) return false;
        } else if (entry.wall_style_defaults) |defaults| {
            if (defaults.profile != profile) return false;
        } else return false;
    }
    if (query.wall_thickness_u) |thickness| {
        if (entry.wall_opening_compatibility) |compatibility| {
            if (std.mem.indexOfScalar(types.Unit, compatibility.permitted_thickness_u, thickness) == null) return false;
        } else if (entry.wall_style_defaults) |defaults| {
            if (defaults.thickness_u != thickness) return false;
        } else return false;
    }
    return true;
}

fn containsAllTags(entry_tags: [][]u8, required_tags: []const []const u8) bool {
    for (required_tags) |required| {
        var found = false;
        for (entry_tags) |entry_tag| {
            if (std.mem.eql(u8, entry_tag, required)) {
                found = true;
                break;
            }
        }
        if (!found) return false;
    }
    return true;
}

fn queryIndexLessThan(entries: []const CatalogEntry, left: usize, right: usize) bool {
    const id_order = std.mem.order(u8, entries[left].catalog_id, entries[right].catalog_id);
    if (id_order != .eq) return id_order == .lt;
    return std.mem.lessThan(u8, entries[left].content_hash, entries[right].content_hash);
}

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

test "catalog footprint rounds outward and typed semantics beat names" {
    const footprint = try outwardFootprint(.{
        .min_u = -9.6,
        .min_v = 16.8,
        .max_u = 9.6,
        .max_v = 36.0,
    });
    try std.testing.expectEqual(@as(types.Unit, -10), footprint.min_column);
    try std.testing.expectEqual(@as(types.Unit, 16), footprint.min_row);
    try std.testing.expectEqual(@as(types.Unit, 10), footprint.max_column_exclusive);
    try std.testing.expectEqual(@as(types.Unit, 36), footprint.max_row_exclusive);
    try std.testing.expect(familyRoleCompatible(.wall, .opening));
    try std.testing.expect(!familyRoleCompatible(.vertical_link, .opening));
    try std.testing.expect(semanticKindCompatible(.wall, .opening, .{ .wall_opening = .door }));
    try std.testing.expect(!semanticKindCompatible(.wall, .opening, .{ .roof_profile = .gable }));
}
