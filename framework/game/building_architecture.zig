//! Deep public boundary for semantic building architecture.
//!
//! Consumers import this facade. Topology, mutation, geometry, wire, editor, and
//! renderer modules remain private implementation details behind it.

const architecture_scale = @import("architecture_scale.zig");
const wall_types = @import("wall_types.zig");
const building_catalog = @import("building_catalog.zig");

pub const types = wall_types;
pub const catalog = building_catalog;

pub const ArchitectureSource = wall_types.ArchitectureSource;
pub const CatalogEntry = building_catalog.CatalogEntry;
pub const CatalogQuery = building_catalog.CatalogQuery;
pub const CatalogQueryResult = building_catalog.CatalogQueryResult;
pub const Unit = wall_types.Unit;

pub const source_version: u16 = 1;
pub const units_per_meter: Unit = architecture_scale.units_per_meter;

pub fn unitsToMeters(units: Unit) f32 {
    return architecture_scale.unitsToMeters(units);
}

pub fn validateCatalog(allocator: @import("std").mem.Allocator, entries: []const CatalogEntry) !void {
    return building_catalog.validateCatalog(allocator, entries);
}

pub fn queryCatalog(allocator: @import("std").mem.Allocator, entries: []const CatalogEntry, query: CatalogQuery) !CatalogQueryResult {
    return building_catalog.queryCatalog(allocator, entries, query);
}
