//! Durable named-edge semantics for authored model topology.
//!
//! Edge table indices are presentation state. This module deals only in logical
//! edit-vertex ids, canonical non-branching paths, and the semantic JSON that rides
//! inside RJMD. It owns no renderer, journal, file, or global mesh state.

const std = @import("std");

pub const NO_ID: u32 = std.math.maxInt(u32);

pub const Role = enum {
    boundary,
    hinge,
    mount,
    contact,

    pub fn text(role: Role) []const u8 {
        return switch (role) {
            .boundary => "boundary",
            .hinge => "hinge",
            .mount => "mount",
            .contact => "contact",
        };
    }

    pub fn parse(value: []const u8) ?Role {
        inline for (std.meta.fields(Role)) |field| {
            if (std.mem.eql(u8, value, field.name)) return @enumFromInt(field.value);
        }
        return null;
    }
};

/// One authored edge in the resident logical topology. `part` is the native numeric
/// owner for the current session; the saved semantic row carries the stable object id.
pub const Edge = struct {
    a: u32,
    b: u32,
    part: u32,
};

pub const CanonicalPath = struct {
    allocator: std.mem.Allocator,
    vertices: []u32,
    closed: bool,
    part: u32,

    pub fn deinit(path: *CanonicalPath) void {
        path.allocator.free(path.vertices);
        path.* = undefined;
    }
};

pub const PathError = std.mem.Allocator.Error || error{
    EmptySelection,
    CollapsedEdge,
    DuplicateEdge,
    MixedPart,
    Branched,
    Disconnected,
};

const Neighbors = struct {
    count: u8 = 0,
    values: [2]u32 = .{ 0, 0 },
};

fn edgeKey(a_raw: u32, b_raw: u32) u64 {
    const a = @min(a_raw, b_raw);
    const b = @max(a_raw, b_raw);
    return (@as(u64, a) << 32) | b;
}

fn addNeighbor(adjacency: *std.AutoHashMap(u32, Neighbors), from: u32, to: u32) PathError!void {
    const entry = try adjacency.getOrPut(from);
    if (!entry.found_existing) entry.value_ptr.* = .{};
    if (entry.value_ptr.count >= 2) return error.Branched;
    entry.value_ptr.values[entry.value_ptr.count] = to;
    entry.value_ptr.count += 1;
}

/// Convert an unordered selected-edge set into one deterministic open chain or loop.
/// IDs, not coordinates or edge table order, choose the stored orientation.
pub fn canonicalPathAlloc(allocator: std.mem.Allocator, selected: []const Edge) PathError!CanonicalPath {
    if (selected.len == 0) return error.EmptySelection;
    const part = selected[0].part;
    var adjacency = std.AutoHashMap(u32, Neighbors).init(allocator);
    defer adjacency.deinit();
    var seen_edges = std.AutoHashMap(u64, void).init(allocator);
    defer seen_edges.deinit();

    for (selected) |edge| {
        if (edge.a == edge.b) return error.CollapsedEdge;
        if (edge.part != part) return error.MixedPart;
        const inserted = try seen_edges.getOrPut(edgeKey(edge.a, edge.b));
        if (inserted.found_existing) return error.DuplicateEdge;
        try addNeighbor(&adjacency, edge.a, edge.b);
        try addNeighbor(&adjacency, edge.b, edge.a);
    }

    var endpoint_count: usize = 0;
    var smallest_endpoint: u32 = NO_ID;
    var smallest_vertex: u32 = NO_ID;
    var iterator = adjacency.iterator();
    while (iterator.next()) |entry| {
        const vertex = entry.key_ptr.*;
        const degree = entry.value_ptr.count;
        if (degree == 0 or degree > 2) return error.Branched;
        smallest_vertex = @min(smallest_vertex, vertex);
        if (degree == 1) {
            endpoint_count += 1;
            smallest_endpoint = @min(smallest_endpoint, vertex);
        }
    }
    const closed = switch (endpoint_count) {
        0 => true,
        2 => false,
        else => return error.Disconnected,
    };
    if (closed and adjacency.count() != selected.len) return error.Disconnected;
    if (!closed and adjacency.count() != selected.len + 1) return error.Disconnected;

    const output_len = if (closed) selected.len else selected.len + 1;
    const vertices = try allocator.alloc(u32, output_len);
    errdefer allocator.free(vertices);
    const start = if (closed) smallest_vertex else smallest_endpoint;
    var current = start;
    var previous: ?u32 = null;
    for (0..output_len) |index| {
        vertices[index] = current;
        const neighbors = adjacency.get(current) orelse return error.Disconnected;
        if (!closed and index + 1 == output_len) break;
        var next: ?u32 = null;
        if (previous == null and neighbors.count == 2) {
            next = @min(neighbors.values[0], neighbors.values[1]);
        } else {
            for (neighbors.values[0..neighbors.count]) |candidate| {
                if (previous == null or candidate != previous.?) {
                    next = candidate;
                    break;
                }
            }
        }
        const resolved = next orelse return error.Disconnected;
        if (closed and index + 1 == output_len) {
            if (resolved != start) return error.Disconnected;
            break;
        }
        for (vertices[0 .. index + 1]) |visited| if (visited == resolved) return error.Disconnected;
        previous = current;
        current = resolved;
    }
    return .{ .allocator = allocator, .vertices = vertices, .closed = closed, .part = part };
}

pub const TableError = std.mem.Allocator.Error || error{
    InvalidJson,
    InvalidTable,
    InvalidVersion,
    DuplicateId,
    DuplicateName,
    InvalidEdgeRegion,
    InvalidRole,
    MissingRegion,
    LogicalIdMissing,
};

fn valueU32(value: std.json.Value) ?u32 {
    return switch (value) {
        .integer => |integer| if (integer >= 0 and integer <= std.math.maxInt(u32)) @intCast(integer) else null,
        else => null,
    };
}

fn objectU32(object: std.json.ObjectMap, key: []const u8) ?u32 {
    return valueU32(object.get(key) orelse return null);
}

fn objectString(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    return switch (object.get(key) orelse return null) {
        .string => |value| value,
        else => null,
    };
}

fn validName(value: []const u8) bool {
    return value.len > 0 and !std.mem.eql(u8, value, "_") and std.mem.indexOfScalar(u8, value, 0) == null;
}

fn validateIdentity(
    ids: *std.AutoHashMap(u32, void),
    names: *std.StringHashMap(void),
    object: std.json.ObjectMap,
) TableError!void {
    const id = objectU32(object, "id") orelse return error.InvalidTable;
    const name = objectString(object, "name") orelse return error.InvalidTable;
    if (id == NO_ID or !validName(name)) return error.InvalidTable;
    const id_entry = try ids.getOrPut(id);
    if (id_entry.found_existing) return error.DuplicateId;
    const name_entry = try names.getOrPut(name);
    if (name_entry.found_existing) return error.DuplicateName;
}

fn validateEdgeRegion(allocator: std.mem.Allocator, object: std.json.ObjectMap) TableError!void {
    const role_text = objectString(object, "role") orelse return error.InvalidEdgeRegion;
    if (Role.parse(role_text) == null) return error.InvalidRole;
    const object_id = objectString(object, "objectId") orelse return error.InvalidEdgeRegion;
    if (!validName(object_id)) return error.InvalidEdgeRegion;
    const closed = switch (object.get("closed") orelse return error.InvalidEdgeRegion) {
        .bool => |value| value,
        else => return error.InvalidEdgeRegion,
    };
    const vertices = switch (object.get("vertices") orelse return error.InvalidEdgeRegion) {
        .array => |array| array.items,
        else => return error.InvalidEdgeRegion,
    };
    if (vertices.len < 2 or (closed and vertices.len < 3)) return error.InvalidEdgeRegion;
    var seen = std.AutoHashMap(u32, void).init(allocator);
    defer seen.deinit();
    for (vertices) |value| {
        const vertex = valueU32(value) orelse return error.InvalidEdgeRegion;
        if (vertex == NO_ID) return error.InvalidEdgeRegion;
        const entry = try seen.getOrPut(vertex);
        if (entry.found_existing) return error.InvalidEdgeRegion;
    }
}

fn validateParsedTable(allocator: std.mem.Allocator, value: std.json.Value) TableError!void {
    const root = switch (value) {
        .object => |object| object,
        else => return error.InvalidTable,
    };
    if (objectU32(root, "version") != 1) return error.InvalidVersion;
    const face_regions = switch (root.get("regions") orelse return error.InvalidTable) {
        .array => |array| array.items,
        else => return error.InvalidTable,
    };
    var ids = std.AutoHashMap(u32, void).init(allocator);
    defer ids.deinit();
    var names = std.StringHashMap(void).init(allocator);
    defer names.deinit();
    for (face_regions) |row| {
        const object = switch (row) {
            .object => |object| object,
            else => return error.InvalidTable,
        };
        try validateIdentity(&ids, &names, object);
    }
    if (root.get("edgeRegions")) |edge_value| {
        const edge_regions = switch (edge_value) {
            .array => |array| array.items,
            else => return error.InvalidTable,
        };
        for (edge_regions) |row| {
            const object = switch (row) {
                .object => |object| object,
                else => return error.InvalidEdgeRegion,
            };
            try validateIdentity(&ids, &names, object);
            try validateEdgeRegion(allocator, object);
        }
    }
    if (root.get("nextRegionId")) |next| {
        if (valueU32(next) == null) return error.InvalidTable;
    }
}

pub fn validateTableJson(allocator: std.mem.Allocator, json: []const u8) bool {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, json, .{}) catch return false;
    defer parsed.deinit();
    validateParsedTable(allocator, parsed.value) catch return false;
    return true;
}

/// Number of durable edge paths in one already-authored semantic table. Keeping
/// this query beside the table parser lets v4->v5 migration distinguish a plain
/// face-semantic document from one that requires explicit logical topology.
pub fn edgeRegionCount(allocator: std.mem.Allocator, json: []const u8) TableError!usize {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, json, .{}) catch return error.InvalidJson;
    defer parsed.deinit();
    try validateParsedTable(allocator, parsed.value);
    const root = switch (parsed.value) {
        .object => |object| object,
        else => return error.InvalidTable,
    };
    const value = root.get("edgeRegions") orelse return 0;
    return switch (value) {
        .array => |array| array.items.len,
        else => error.InvalidTable,
    };
}

const TopologyEdgeUse = struct {
    incidence: u32 = 0,
    first_group: u32 = NO_ID,
    crosses_groups: bool = false,
};

/// Prove that every durable path still names selectable authored edges in one
/// reconstructed logical topology. A pair is selectable when it exists and is
/// not merely the internal triangulation diagonal of one authored face group.
/// This is the migration boundary that prevents a v4 opaque id row from becoming
/// a formally in-range but unusable v5 path.
pub fn pathsResolveInTopology(
    allocator: std.mem.Allocator,
    json: []const u8,
    logical_rows: []const u32,
    logical_vertex_count: u32,
    face_groups: ?[]const u32,
) TableError!bool {
    if (logical_vertex_count == 0 or logical_rows.len == 0 or logical_rows.len % 3 != 0) return false;
    const face_count = logical_rows.len / 3;
    if (face_groups) |groups| if (groups.len != face_count) return false;
    for (logical_rows) |vertex| if (vertex >= logical_vertex_count) return false;

    var uses = std.AutoHashMap(u64, TopologyEdgeUse).init(allocator);
    defer uses.deinit();
    for (0..face_count) |face| {
        const base = face * 3;
        const corners = [3]u32{ logical_rows[base], logical_rows[base + 1], logical_rows[base + 2] };
        var face_keys: [3]u64 = undefined;
        var face_key_count: usize = 0;
        for (0..3) |corner| {
            const a = corners[corner];
            const b = corners[(corner + 1) % 3];
            if (a == b) continue;
            const key = edgeKey(a, b);
            var repeated = false;
            for (face_keys[0..face_key_count]) |prior| {
                if (prior == key) repeated = true;
            }
            if (repeated) continue;
            face_keys[face_key_count] = key;
            face_key_count += 1;
            const entry = try uses.getOrPut(key);
            if (!entry.found_existing) entry.value_ptr.* = .{};
            entry.value_ptr.incidence += 1;
            if (face_groups) |groups| {
                const group = groups[face];
                if (entry.value_ptr.first_group == NO_ID) {
                    entry.value_ptr.first_group = group;
                } else if (entry.value_ptr.first_group != group) {
                    entry.value_ptr.crosses_groups = true;
                }
            }
        }
    }

    var parsed = std.json.parseFromSlice(std.json.Value, allocator, json, .{}) catch return error.InvalidJson;
    defer parsed.deinit();
    try validateParsedTable(allocator, parsed.value);
    const root = switch (parsed.value) {
        .object => |object| object,
        else => return error.InvalidTable,
    };
    const edge_value = root.get("edgeRegions") orelse return true;
    const edge_regions = switch (edge_value) {
        .array => |array| array.items,
        else => return error.InvalidTable,
    };
    for (edge_regions) |row_value| {
        const row = switch (row_value) {
            .object => |object| object,
            else => return error.InvalidEdgeRegion,
        };
        const vertices = switch (row.get("vertices") orelse return error.InvalidEdgeRegion) {
            .array => |array| array.items,
            else => return error.InvalidEdgeRegion,
        };
        const closed = switch (row.get("closed") orelse return error.InvalidEdgeRegion) {
            .bool => |value| value,
            else => return error.InvalidEdgeRegion,
        };
        const pair_count = vertices.len - 1 + @as(usize, if (closed) 1 else 0);
        for (0..pair_count) |index| {
            const a = valueU32(vertices[index]) orelse return error.InvalidEdgeRegion;
            const next_index = if (index + 1 < vertices.len) index + 1 else 0;
            const b = valueU32(vertices[next_index]) orelse return error.InvalidEdgeRegion;
            if (a >= logical_vertex_count or b >= logical_vertex_count) return false;
            const use = uses.get(edgeKey(a, b)) orelse return false;
            if (face_groups != null and use.incidence == 2 and !use.crosses_groups) return false;
        }
    }
    return true;
}

fn nextSemanticId(allocator: std.mem.Allocator, root: std.json.ObjectMap) TableError!u32 {
    var occupied = std.AutoHashMap(u32, void).init(allocator);
    defer occupied.deinit();
    var candidate = if (root.get("nextRegionId")) |value| valueU32(value) orelse return error.InvalidTable else 0;
    for ([_][]const u8{ "regions", "edgeRegions" }) |key| {
        const rows_value = root.get(key) orelse continue;
        const rows = switch (rows_value) {
            .array => |array| array.items,
            else => return error.InvalidTable,
        };
        for (rows) |row| {
            const object = switch (row) {
                .object => |object| object,
                else => return error.InvalidTable,
            };
            try occupied.put(objectU32(object, "id") orelse return error.InvalidTable, {});
        }
    }
    while (candidate == NO_ID or occupied.contains(candidate)) candidate = std.math.add(u32, candidate, 1) catch return error.InvalidTable;
    return candidate;
}

pub const AssignedTable = struct {
    allocator: std.mem.Allocator,
    id: u32,
    json: []u8,

    pub fn deinit(result: *AssignedTable) void {
        result.allocator.free(result.json);
        result.* = undefined;
    }
};

pub const OwnedRegion = struct {
    allocator: std.mem.Allocator,
    id: u32,
    name: []u8,
    role: Role,
    object_id: []u8,
    closed: bool,
    vertices: []u32,

    pub fn deinit(region: *OwnedRegion) void {
        region.allocator.free(region.name);
        region.allocator.free(region.object_id);
        region.allocator.free(region.vertices);
        region.* = undefined;
    }
};

pub fn regionByIdAlloc(
    allocator: std.mem.Allocator,
    table_json: []const u8,
    wanted_id: u32,
) TableError!OwnedRegion {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, table_json, .{}) catch return error.InvalidJson;
    defer parsed.deinit();
    try validateParsedTable(allocator, parsed.value);
    const root = switch (parsed.value) {
        .object => |object| object,
        else => return error.InvalidTable,
    };
    const edge_rows = switch (root.get("edgeRegions") orelse return error.MissingRegion) {
        .array => |array| array.items,
        else => return error.InvalidTable,
    };
    for (edge_rows) |row_value| {
        const row = switch (row_value) {
            .object => |object| object,
            else => return error.InvalidEdgeRegion,
        };
        if (objectU32(row, "id") != wanted_id) continue;
        const name = try allocator.dupe(u8, objectString(row, "name") orelse return error.InvalidEdgeRegion);
        errdefer allocator.free(name);
        const object_id = try allocator.dupe(u8, objectString(row, "objectId") orelse return error.InvalidEdgeRegion);
        errdefer allocator.free(object_id);
        const vertex_values = switch (row.get("vertices") orelse return error.InvalidEdgeRegion) {
            .array => |array| array.items,
            else => return error.InvalidEdgeRegion,
        };
        const vertices = try allocator.alloc(u32, vertex_values.len);
        errdefer allocator.free(vertices);
        for (vertex_values, 0..) |value, index| vertices[index] = valueU32(value) orelse return error.InvalidEdgeRegion;
        const closed = switch (row.get("closed") orelse return error.InvalidEdgeRegion) {
            .bool => |value| value,
            else => return error.InvalidEdgeRegion,
        };
        return .{
            .allocator = allocator,
            .id = wanted_id,
            .name = name,
            .role = Role.parse(objectString(row, "role") orelse return error.InvalidRole) orelse return error.InvalidRole,
            .object_id = object_id,
            .closed = closed,
            .vertices = vertices,
        };
    }
    return error.MissingRegion;
}

/// Append one fully-authored edge row. The caller already proved/canonicalized the
/// selected path; this function supplies the single global semantic-id allocation.
pub fn appendRegionAlloc(
    allocator: std.mem.Allocator,
    table_json: []const u8,
    name: []const u8,
    role: Role,
    object_id: []const u8,
    path: CanonicalPath,
) TableError!AssignedTable {
    if (!validName(name) or !validName(object_id)) return error.InvalidEdgeRegion;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, table_json, .{}) catch return error.InvalidJson;
    defer parsed.deinit();
    try validateParsedTable(allocator, parsed.value);
    const root = switch (parsed.value) {
        .object => |*object| object,
        else => return error.InvalidTable,
    };
    for ([_][]const u8{ "regions", "edgeRegions" }) |key| {
        const rows_value = root.get(key) orelse continue;
        const rows = switch (rows_value) {
            .array => |array| array.items,
            else => return error.InvalidTable,
        };
        for (rows) |row| {
            const object = switch (row) {
                .object => |object| object,
                else => return error.InvalidTable,
            };
            if (std.mem.eql(u8, objectString(object, "name") orelse return error.InvalidTable, name)) return error.DuplicateName;
        }
    }
    const id = try nextSemanticId(allocator, root.*);
    const arena = parsed.arena.allocator();
    if (root.get("edgeRegions") == null) {
        try root.put(arena, "edgeRegions", .{ .array = std.json.Array.init(arena) });
    }
    const edge_value = root.getPtr("edgeRegions") orelse return error.InvalidTable;
    const edge_rows = switch (edge_value.*) {
        .array => |*array| array,
        else => return error.InvalidTable,
    };
    var row = std.json.ObjectMap.empty;
    try row.put(arena, "id", .{ .integer = id });
    try row.put(arena, "name", .{ .string = name });
    try row.put(arena, "role", .{ .string = role.text() });
    try row.put(arena, "objectId", .{ .string = object_id });
    try row.put(arena, "closed", .{ .bool = path.closed });
    var vertices = std.json.Array.init(arena);
    for (path.vertices) |vertex| try vertices.append(.{ .integer = vertex });
    try row.put(arena, "vertices", .{ .array = vertices });
    try edge_rows.append(.{ .object = row });
    try root.put(arena, "nextRegionId", .{ .integer = id + 1 });
    const json = try std.json.Stringify.valueAlloc(allocator, parsed.value, .{});
    errdefer allocator.free(json);
    if (!validateTableJson(allocator, json)) return error.InvalidTable;
    return .{ .allocator = allocator, .id = id, .json = json };
}

/// Rewrite only edge path ids through the exact RJMD dense-id map. The input JSON
/// remains resident/stable; the returned JSON belongs to the immutable save snapshot.
pub fn remapForSnapshotAlloc(
    allocator: std.mem.Allocator,
    table_json: []const u8,
    dense_to_stable: []const u32,
) TableError![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, table_json, .{}) catch return error.InvalidJson;
    defer parsed.deinit();
    try validateParsedTable(allocator, parsed.value);
    var stable_to_dense = std.AutoHashMap(u32, u32).init(allocator);
    defer stable_to_dense.deinit();
    for (dense_to_stable, 0..) |stable, dense| {
        const entry = try stable_to_dense.getOrPut(stable);
        if (entry.found_existing or dense > std.math.maxInt(u32)) return error.InvalidTable;
        entry.value_ptr.* = @intCast(dense);
    }
    const root = switch (parsed.value) {
        .object => |*object| object,
        else => return error.InvalidTable,
    };
    if (root.getPtr("edgeRegions")) |edge_value| {
        const edge_rows = switch (edge_value.*) {
            .array => |*array| array,
            else => return error.InvalidTable,
        };
        for (edge_rows.items) |*row_value| {
            const row = switch (row_value.*) {
                .object => |*object| object,
                else => return error.InvalidEdgeRegion,
            };
            const vertices_value = row.getPtr("vertices") orelse return error.InvalidEdgeRegion;
            const vertices = switch (vertices_value.*) {
                .array => |*array| array,
                else => return error.InvalidEdgeRegion,
            };
            for (vertices.items) |*vertex_value| {
                const stable = valueU32(vertex_value.*) orelse return error.InvalidEdgeRegion;
                vertex_value.* = .{ .integer = stable_to_dense.get(stable) orelse return error.LogicalIdMissing };
            }
        }
    }
    const json = try std.json.Stringify.valueAlloc(allocator, parsed.value, .{});
    errdefer allocator.free(json);
    if (!validateTableJson(allocator, json)) return error.InvalidTable;
    return json;
}

/// Recovery-only semantic-table normalization. Face roles and any unrelated
/// metadata remain byte-semantically represented while stale topology paths or
/// stale persisted range/object rows can be removed independently. Ordinary
/// Save continues to use the strict validator/remapper above.
pub fn recoveryTableAlloc(
    allocator: std.mem.Allocator,
    table_json: []const u8,
    strip_edge_regions: bool,
    strip_range_objects: bool,
) TableError![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, table_json, .{}) catch return error.InvalidJson;
    defer parsed.deinit();
    const root = switch (parsed.value) {
        .object => |*object| object,
        else => return error.InvalidTable,
    };
    if (strip_edge_regions) _ = root.orderedRemove("edgeRegions");
    if (strip_range_objects) _ = root.orderedRemove("rangeObjects");
    const json = try std.json.Stringify.valueAlloc(allocator, parsed.value, .{});
    errdefer allocator.free(json);
    if (!validateTableJson(allocator, json)) return error.InvalidTable;
    return json;
}
