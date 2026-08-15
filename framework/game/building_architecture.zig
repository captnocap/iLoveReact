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
const wall_compile = @import("wall_compile");

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
pub const ArchitectureCommandSupport = wall_mutation.CommandSupport;
pub const ArchitectureConfigureOpening = wall_mutation.ConfigureOpening;
pub const ArchitectureCommandEnvelope = ArchitectureCommand;
pub const ArchitectureMutationResult = wall_types.MutationResult;
pub const ApplyCommandError = ValidateSourceError || wall_mutation.ApplyError;
pub const ArchitectureCompileBundle = wall_compile.ArchitectureCompileBundle;
pub const CompileError = ValidateSourceError || wall_compile.CompileError;

pub const CompileRequest = struct {
    affected_bounds: []const wall_types.AffectedBounds = &.{},
    targets: []const wall_types.DirtyTarget = &.{},
};

pub const RaycastRequest = struct {
    origin_meters: [3]f64,
    direction: [3]f64,
    maximum_distance_meters: f64,
};

pub const RaycastHitKind = enum(u8) { wall_face, opening_frame };

pub const RaycastHit = struct {
    kind: RaycastHitKind,
    edge_id: []u8,
    opening_id: ?[]u8,
    side: wall_types.WallSide,
    column_u: Unit,
    row_u: Unit,
    distance_meters: f64,
    point_meters: [3]f64,
    normal: [3]f64,

    pub fn deinit(self: *RaycastHit, allocator: std.mem.Allocator) void {
        if (self.edge_id.len != 0) allocator.free(self.edge_id);
        if (self.opening_id) |value| if (value.len != 0) allocator.free(value);
        self.* = undefined;
    }
};

pub const RaycastResult = struct {
    hit: ?RaycastHit,

    pub fn deinit(self: *RaycastResult, allocator: std.mem.Allocator) void {
        if (self.hit) |*hit| hit.deinit(allocator);
        self.* = undefined;
    }
};

pub const RaycastError = ValidateSourceError || wall_compile.CompileError || error{invalid_raycast_request};

pub const OpeningSlotsRequest = struct {
    edge_id: []const u8,
    catalog_id: []const u8,
};
pub const OpeningSlots = wall_mutation.OpeningSlots;
pub const OpeningSlotsError = ValidateSourceError || wall_mutation.ApplyError;

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

pub fn compile(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
    entries: []const CatalogEntry,
    request: CompileRequest,
) CompileError!ArchitectureCompileBundle {
    try validateSource(allocator, source, entries);
    return wall_compile.compile(allocator, source, entries, .{
        .affected_bounds = request.affected_bounds,
        .targets = request.targets,
    });
}

pub fn raycast(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
    entries: []const CatalogEntry,
    request: RaycastRequest,
) RaycastError!RaycastResult {
    const direction_length = vectorLength(request.direction);
    if (!std.math.isFinite(direction_length) or direction_length <= wall_types.wall_tuning.ray_parallel_epsilon or
        !std.math.isFinite(request.maximum_distance_meters) or request.maximum_distance_meters < 0)
    {
        return error.invalid_raycast_request;
    }
    for (request.origin_meters) |component| if (!std.math.isFinite(component)) return error.invalid_raycast_request;
    const direction = [3]f64{
        request.direction[0] / direction_length,
        request.direction[1] / direction_length,
        request.direction[2] / direction_length,
    };
    const selected_targets = [_]wall_types.DirtyTarget{.pick_proxies};
    var bundle = try compile(allocator, source, entries, .{ .targets = &selected_targets });
    defer bundle.deinit(allocator);
    var nearest: ?RayCandidate = null;
    for (bundle.wall.pick_proxies) |*proxy| {
        if (proxy.kind == .opening_void) continue;
        const candidate = intersectPickProxy(request.origin_meters, direction, request.maximum_distance_meters, proxy) orelse continue;
        if (nearest == null or candidate.distance_meters < nearest.?.distance_meters) nearest = candidate;
    }
    const candidate = nearest orelse return .{ .hit = null };
    const edge_id = try allocator.dupe(u8, candidate.proxy.edge_id);
    errdefer allocator.free(edge_id);
    const opening_id = if (candidate.proxy.opening_id) |value| try allocator.dupe(u8, value) else null;
    errdefer if (opening_id) |value| allocator.free(value);
    const side = candidate.proxy.side orelse return error.invalid_raycast_request;
    return .{ .hit = .{
        .kind = switch (candidate.proxy.kind) {
            .wall_face => .wall_face,
            .opening_frame => .opening_frame,
            .opening_void => unreachable,
        },
        .edge_id = edge_id,
        .opening_id = opening_id,
        .side = side,
        .column_u = interpolateLocalUnit(
            candidate.proxy.column_start_u,
            candidate.proxy.column_end_u,
            candidate.local_u,
        ),
        .row_u = interpolateLocalUnit(
            candidate.proxy.row_bottom_u,
            candidate.proxy.row_top_u,
            candidate.local_v,
        ),
        .distance_meters = candidate.distance_meters,
        .point_meters = candidate.point_meters,
        .normal = .{
            candidate.proxy.normal.x,
            candidate.proxy.normal.y,
            candidate.proxy.normal.z,
        },
    } };
}

const RayCandidate = struct {
    proxy: *const wall_compile.PickProxy,
    distance_meters: f64,
    point_meters: [3]f64,
    local_u: f64,
    local_v: f64,
};

fn intersectPickProxy(
    origin: [3]f64,
    direction: [3]f64,
    maximum_distance_meters: f64,
    proxy: *const wall_compile.PickProxy,
) ?RayCandidate {
    const normal = [3]f64{ proxy.normal.x, proxy.normal.y, proxy.normal.z };
    const denominator = dot(direction, normal);
    if (@abs(denominator) <= wall_types.wall_tuning.ray_parallel_epsilon) return null;
    const quad_origin = pointArray(proxy.quad_m[0]);
    const distance_meters = dot(subtract(quad_origin, origin), normal) / denominator;
    const epsilon = wall_types.wall_tuning.ray_bounds_epsilon;
    if (distance_meters < -epsilon or distance_meters > maximum_distance_meters + epsilon) return null;
    const point = addScaled(origin, direction, @max(@as(f64, 0), distance_meters));
    const axis_u = subtract(pointArray(proxy.quad_m[1]), quad_origin);
    const axis_v = subtract(pointArray(proxy.quad_m[3]), quad_origin);
    const relative = subtract(point, quad_origin);
    const length_u_squared = dot(axis_u, axis_u);
    const length_v_squared = dot(axis_v, axis_v);
    if (length_u_squared <= epsilon or length_v_squared <= epsilon) return null;
    const local_u = dot(relative, axis_u) / length_u_squared;
    const local_v = dot(relative, axis_v) / length_v_squared;
    if (local_u < -epsilon or local_u > 1 + epsilon or local_v < -epsilon or local_v > 1 + epsilon) return null;
    return .{
        .proxy = proxy,
        .distance_meters = @max(@as(f64, 0), distance_meters),
        .point_meters = point,
        .local_u = std.math.clamp(local_u, 0, 1),
        .local_v = std.math.clamp(local_v, 0, 1),
    };
}

fn interpolateLocalUnit(start_u: Unit, end_u: Unit, parameter: f64) Unit {
    const value = @as(f64, @floatFromInt(start_u)) +
        @as(f64, @floatFromInt(end_u - start_u)) * parameter;
    return @intFromFloat(@round(value));
}

fn pointArray(point: wall_compile.PickProxyPoint) [3]f64 {
    return .{ point.x, point.y, point.z };
}

fn vectorLength(vector: [3]f64) f64 {
    return @sqrt(dot(vector, vector));
}

fn dot(left: [3]f64, right: [3]f64) f64 {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

fn subtract(left: [3]f64, right: [3]f64) [3]f64 {
    return .{ left[0] - right[0], left[1] - right[1], left[2] - right[2] };
}

fn addScaled(origin: [3]f64, direction: [3]f64, scale: f64) [3]f64 {
    return .{
        origin[0] + direction[0] * scale,
        origin[1] + direction[1] * scale,
        origin[2] + direction[2] * scale,
    };
}

pub fn openingSlots(
    allocator: std.mem.Allocator,
    source: *const ArchitectureSource,
    entries: []const CatalogEntry,
    request: OpeningSlotsRequest,
) OpeningSlotsError!OpeningSlots {
    try validateSource(allocator, source, entries);
    return wall_mutation.openingSlots(allocator, source, entries, request.edge_id, request.catalog_id);
}

