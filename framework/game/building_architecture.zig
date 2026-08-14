//! Deep public boundary for semantic building architecture.
//!
//! Consumers import this facade. Topology, mutation, geometry, wire, editor, and
//! renderer modules remain private implementation details behind it.

const std = @import("std");
const architecture_scale = @import("architecture_scale");
const wall_types = @import("wall_types");
const building_catalog = @import("building_catalog");
const wall_topology = @import("wall_topology");
const wall_mutation = @import("wall_mutation");

pub const types = wall_types;
pub const catalog = building_catalog;

pub const ArchitectureSource = wall_types.ArchitectureSource;
pub const CatalogEntry = building_catalog.CatalogEntry;
pub const CatalogQuery = building_catalog.CatalogQuery;
pub const CatalogQueryResult = building_catalog.CatalogQueryResult;
pub const Unit = wall_types.Unit;

pub const source_version: u16 = 1;
pub const units_per_meter: Unit = architecture_scale.units_per_meter;

/// Section-A/B API scaffolds name every deep operation before their focused modules
/// land. Each scaffold is replaced by its typed semantic result at the numbered step
/// that implements that operation; callers can never mistake absence for success.
pub const PendingOperationError = error{architecture_operation_not_implemented};
pub const ValidateSourceError = wall_types.SourceValidationError ||
    building_catalog.ValidationError ||
    building_catalog.SourceReferenceError ||
    wall_topology.BuildError ||
    std.mem.Allocator.Error ||
    error{topology_invalid};

pub const ArchitectureCommand = wall_mutation.Command;
pub const ArchitectureOperation = wall_mutation.Operation;
pub const ArchitectureCommandEnvelope = ArchitectureCommand;
pub const ArchitectureMutationResult = wall_types.MutationResult;
pub const ApplyCommandError = ValidateSourceError || wall_mutation.ApplyError;

pub const CompileRequest = struct {
    affected_bounds: []const wall_types.AffectedBounds = &.{},
    targets: []const wall_types.DirtyTarget = &.{},
};

pub const RaycastRequest = struct {
    origin_meters: [3]f64,
    direction: [3]f64,
    maximum_distance_meters: f64,
};

pub const OpeningSlotsRequest = struct {
    edge_id: []const u8,
    catalog_id: []const u8,
};

pub const LegacyWallMigrationRequest = struct {
    canonical_v4_bytes: []const u8,
};

pub fn unitsToMeters(units: Unit) f32 {
    return architecture_scale.unitsToMeters(units);
}

pub fn validateCatalog(allocator: std.mem.Allocator, entries: []const CatalogEntry) !void {
    return building_catalog.validateCatalog(allocator, entries);
}

pub fn queryCatalog(allocator: std.mem.Allocator, entries: []const CatalogEntry, query: CatalogQuery) !CatalogQueryResult {
    return building_catalog.queryCatalog(allocator, entries, query);
}

pub fn validateSource(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
    entries: []const CatalogEntry,
) ValidateSourceError!void {
    try wall_types.validateSourceStructure(allocator, source);
    try building_catalog.validateSourceCatalogReferences(allocator, source, entries);
    var derived = try wall_topology.build(allocator, &source.walls);
    defer derived.deinit(allocator);
    if (derived.diagnostics.len != 0) return error.topology_invalid;
}

pub fn applyCommand(
    allocator: std.mem.Allocator,
    source: *ArchitectureSource,
    entries: []const CatalogEntry,
    command: ArchitectureCommand,
) ApplyCommandError!ArchitectureMutationResult {
    try validateSource(allocator, source, entries);
    var candidate = try wall_types.cloneSource(allocator, source);
    errdefer candidate.deinit(allocator);
    var result = try wall_mutation.applyCommand(allocator, &candidate, entries, command);
    switch (result) {
        .rejection => {
            candidate.deinit(allocator);
            return result;
        },
        .receipt => {
            validateSource(allocator, &candidate, entries) catch |err| {
                result.deinit(allocator);
                return err;
            };
            source.deinit(allocator);
            source.* = candidate;
            return result;
        },
    }
}

pub fn compile(allocator: std.mem.Allocator, source: *const ArchitectureSource, entries: []const CatalogEntry, request: CompileRequest) PendingOperationError!void {
    _ = allocator;
    _ = source;
    _ = entries;
    _ = request;
    return error.architecture_operation_not_implemented;
}

pub fn raycast(allocator: std.mem.Allocator, source: *const ArchitectureSource, entries: []const CatalogEntry, request: RaycastRequest) PendingOperationError!void {
    _ = allocator;
    _ = source;
    _ = entries;
    _ = request;
    return error.architecture_operation_not_implemented;
}

pub fn openingSlots(allocator: std.mem.Allocator, source: *const ArchitectureSource, entries: []const CatalogEntry, request: OpeningSlotsRequest) PendingOperationError!void {
    _ = allocator;
    _ = source;
    _ = entries;
    _ = request;
    return error.architecture_operation_not_implemented;
}

pub fn migrateLegacyWallModules(allocator: std.mem.Allocator, entries: []const CatalogEntry, request: LegacyWallMigrationRequest) PendingOperationError!void {
    _ = allocator;
    _ = entries;
    _ = request;
    return error.architecture_operation_not_implemented;
}
