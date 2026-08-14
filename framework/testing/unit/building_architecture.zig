//! Focused native contract tests for semantic building architecture.
//! Run: zig build test-building-architecture -Doptimize=ReleaseFast

const std = @import("std");
const testing = std.testing;
const architecture = @import("building_architecture");
const topology = @import("wall_topology");
const mutation = @import("wall_mutation");

test "facade constructs and owns one integer-u wall source" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const vertices = try allocator.alloc(architecture.types.WallVertex, 2);
    vertices[0] = .{
        .id = try allocator.dupe(u8, "draw-1:v:0"),
        .floor = 0,
        .x_u = 0,
        .z_u = 0,
    };
    vertices[1] = .{
        .id = try allocator.dupe(u8, "draw-1:v:1"),
        .floor = 0,
        .x_u = 16,
        .z_u = 0,
    };

    const edges = try allocator.alloc(architecture.types.WallEdge, 1);
    edges[0] = .{
        .id = try allocator.dupe(u8, "draw-1:e:0"),
        .start_vertex_id = try allocator.dupe(u8, "draw-1:v:0"),
        .end_vertex_id = try allocator.dupe(u8, "draw-1:v:1"),
        .support = .{ .absolute = .{ .base_y_u = 0 } },
        .height_u = 48,
        .thickness_u = 4,
        .profile = .full,
        .style_id = try allocator.dupe(u8, "build:wall:style:smoke"),
        .side_a = .{ .material_id = try allocator.dupe(u8, "material:plaster") },
        .side_b = .{ .material_id = try allocator.dupe(u8, "material:brick") },
        .openings = try allocator.alloc(architecture.types.WallOpening, 0),
    };

    var source = architecture.ArchitectureSource{
        .version = architecture.source_version,
        .revision = 0,
        .walls = .{
            .vertices = vertices,
            .edges = edges,
            .anchors = try allocator.alloc(architecture.types.WallAnchor, 0),
        },
    };
    defer source.deinit(allocator);

    try testing.expectEqual(@as(u16, 1), source.version);
    try testing.expectEqual(@as(usize, 2), source.walls.vertices.len);
    try testing.expectEqual(@as(architecture.Unit, 16), source.walls.vertices[1].x_u);
    try testing.expectEqualStrings("material:plaster", source.walls.edges[0].side_a.material_id);
    try testing.expectEqualStrings("material:brick", source.walls.edges[0].side_b.material_id);
}

test "facade preserves the exact 16-u to 1-m contract" {
    try testing.expectEqual(@as(architecture.Unit, 16), architecture.units_per_meter);
    try testing.expectEqual(@as(f32, 1.0), architecture.unitsToMeters(16));
    try testing.expectEqual(@as(f32, -1.0), architecture.unitsToMeters(-16));
}

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const HASH_D = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const EMPTY_STRINGS = [_][]u8{};
const EMPTY_CELLS = [_]architecture.types.WallCell{};
const STYLE_PATH = [_][]u8{ @constCast("Wall"), @constCast("Styles") };
const DOOR_PATH = [_][]u8{ @constCast("Wall"), @constCast("Openings"), @constCast("Doors") };
const DOOR_PROFILES = [_]architecture.types.WallProfile{.full};
const DOOR_THICKNESSES = [_]architecture.Unit{4};

fn validWallStyle() architecture.CatalogEntry {
    return .{
        .catalog_id = @constCast("build:wall:style:test"),
        .content_hash = @constCast(HASH_A),
        .package_id = @constCast("package:test-wall-style"),
        .label = @constCast("Test Wall"),
        .family = .wall,
        .role = .style,
        .semantic_kind = null,
        .category_path = @constCast(STYLE_PATH[0..]),
        .theme_tags = @constCast(EMPTY_STRINGS[0..]),
        .gameplay_tags = @constCast(EMPTY_STRINGS[0..]),
        .measurement = .{
            .source_bounds_u = .{
                .min_x_u = 0,
                .min_y_u = 0,
                .min_z_u = -2,
                .max_x_u = 16,
                .max_y_u = 48,
                .max_z_u = 2,
            },
            .mount_bounds_u = null,
            .footprint = null,
            .occupied_mask = @constCast(EMPTY_CELLS[0..]),
            .clearance_mask = @constCast(EMPTY_CELLS[0..]),
            .pivot_u = .{ .x_u = 0, .y_u = 0, .z_u = 0 },
        },
        .wall_style_defaults = .{ .height_u = 48, .thickness_u = 4, .profile = .full },
        .wall_opening_compatibility = null,
        .asset_refs = .{
            .mesh_content_hash = @constCast(HASH_B),
            .material_content_hashes = @constCast(EMPTY_STRINGS[0..]),
            .animation_content_hash = null,
        },
    };
}

fn validDoorKit() architecture.CatalogEntry {
    return .{
        .catalog_id = @constCast("build:wall:opening:door:test"),
        .content_hash = @constCast(HASH_C),
        .package_id = @constCast("package:test-door"),
        .label = @constCast("Test Door"),
        .family = .wall,
        .role = .opening,
        .semantic_kind = .{ .wall_opening = .door },
        .category_path = @constCast(DOOR_PATH[0..]),
        .theme_tags = @constCast(EMPTY_STRINGS[0..]),
        .gameplay_tags = @constCast(EMPTY_STRINGS[0..]),
        .measurement = .{
            .source_bounds_u = .{
                .min_x_u = -10,
                .min_y_u = 0,
                .min_z_u = -2,
                .max_x_u = 10,
                .max_y_u = 34,
                .max_z_u = 2,
            },
            .mount_bounds_u = .{ .min_u = -9.6, .min_v = 0, .max_u = 9.6, .max_v = 33.6 },
            .footprint = .{ .min_column = -10, .min_row = 0, .max_column_exclusive = 10, .max_row_exclusive = 34 },
            .occupied_mask = @constCast(EMPTY_CELLS[0..]),
            .clearance_mask = @constCast(EMPTY_CELLS[0..]),
            .pivot_u = .{ .x_u = 0, .y_u = 0, .z_u = 0 },
        },
        .wall_style_defaults = null,
        .wall_opening_compatibility = .{
            .permitted_profiles = @constCast(DOOR_PROFILES[0..]),
            .permitted_thickness_u = @constCast(DOOR_THICKNESSES[0..]),
            .portal_class = .walk,
        },
        .asset_refs = .{
            .mesh_content_hash = @constCast(HASH_D),
            .material_content_hashes = @constCast(EMPTY_STRINGS[0..]),
            .animation_content_hash = null,
        },
    };
}

const SourceFixture = struct {
    vertices: [2]architecture.types.WallVertex,
    edges: [1]architecture.types.WallEdge,
    openings: [1]architecture.types.WallOpening,

    fn init() SourceFixture {
        return .{
            .vertices = .{
                .{ .id = @constCast("v0"), .floor = 0, .x_u = 0, .z_u = 0 },
                .{ .id = @constCast("v1"), .floor = 0, .x_u = 16, .z_u = 0 },
            },
            .edges = .{.{
                .id = @constCast("e0"),
                .start_vertex_id = @constCast("v0"),
                .end_vertex_id = @constCast("v1"),
                .support = .{ .absolute = .{ .base_y_u = 0 } },
                .height_u = 48,
                .thickness_u = 4,
                .profile = .full,
                .style_id = @constCast("build:wall:style:test"),
                .side_a = .{ .material_id = @constCast("material:a") },
                .side_b = .{ .material_id = @constCast("material:b") },
                .openings = @constCast(&[_]architecture.types.WallOpening{}),
            }},
            .openings = .{.{
                .id = @constCast("o0"),
                .kind = .door,
                .kit_id = @constCast("build:wall:opening:door:test"),
                .column_u = 2,
                .row_u = 0,
                .facing_side = .a,
                .hinge = .start,
            }},
        };
    }

    fn source(self: *SourceFixture) architecture.ArchitectureSource {
        return .{
            .version = 1,
            .revision = 0,
            .walls = .{
                .vertices = self.vertices[0..],
                .edges = self.edges[0..],
                .anchors = @constCast(&[_]architecture.types.WallAnchor{}),
            },
        };
    }
};

test "source structure rejects duplicate and missing stable IDs" {
    var duplicate = SourceFixture.init();
    duplicate.vertices[1].id = @constCast("v0");
    var duplicate_source = duplicate.source();
    try testing.expectError(error.duplicate_source_id, architecture.types.validateSourceStructure(testing.allocator, &duplicate_source));

    var missing = SourceFixture.init();
    missing.edges[0].end_vertex_id = @constCast("absent");
    var missing_source = missing.source();
    try testing.expectError(error.missing_vertex_reference, architecture.types.validateSourceStructure(testing.allocator, &missing_source));
}

test "source structure rejects cross-floor zero and short edges" {
    var cross_floor = SourceFixture.init();
    cross_floor.vertices[1].floor = 1;
    var cross_floor_source = cross_floor.source();
    try testing.expectError(error.cross_floor_edge, architecture.types.validateSourceStructure(testing.allocator, &cross_floor_source));

    var zero = SourceFixture.init();
    zero.edges[0].end_vertex_id = @constCast("v0");
    var zero_source = zero.source();
    try testing.expectError(error.zero_length_edge, architecture.types.validateSourceStructure(testing.allocator, &zero_source));

    var short = SourceFixture.init();
    short.vertices[1].x_u = 1;
    var short_source = short.source();
    try testing.expectError(error.short_edge, architecture.types.validateSourceStructure(testing.allocator, &short_source));
}

test "structural DTO scalar gate rejects fractional values" {
    try testing.expectEqual(@as(architecture.Unit, 16), try architecture.types.validateStructuralNumber(16.0));
    try testing.expectError(error.structural_value_not_integer, architecture.types.validateStructuralNumber(15.5));
    try testing.expectError(error.structural_value_not_finite, architecture.types.validateStructuralNumber(std.math.nan(f64)));
}

test "source catalog references reject unknown styles and opening kits" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };

    var unknown_style = SourceFixture.init();
    unknown_style.edges[0].style_id = @constCast("build:wall:style:missing");
    var unknown_style_source = unknown_style.source();
    try testing.expectError(error.unknown_wall_style, architecture.catalog.validateSourceCatalogReferences(testing.allocator, &unknown_style_source, &entries));

    var unknown_kit = SourceFixture.init();
    unknown_kit.edges[0].openings = unknown_kit.openings[0..];
    unknown_kit.openings[0].kit_id = @constCast("build:wall:opening:missing");
    var unknown_kit_source = unknown_kit.source();
    try testing.expectError(error.unknown_opening_kit, architecture.catalog.validateSourceCatalogReferences(testing.allocator, &unknown_kit_source, &entries));
}

test "catalog rejects non-finite empty and incorrectly rounded measurement" {
    var non_finite = validDoorKit();
    non_finite.measurement.mount_bounds_u.?.min_u = std.math.nan(f64);
    try testing.expectError(error.non_finite_measurement, architecture.catalog.validateEntry(non_finite));

    var empty = validDoorKit();
    empty.measurement.source_bounds_u.max_x_u = empty.measurement.source_bounds_u.min_x_u;
    try testing.expectError(error.empty_measurement, architecture.catalog.validateEntry(empty));

    var incorrect = validDoorKit();
    incorrect.measurement.footprint.?.max_column_exclusive = 9;
    try testing.expectError(error.incorrect_outward_footprint, architecture.catalog.validateEntry(incorrect));
}

test "catalog rejects incompatible family role and semantic kind" {
    var family_role = validDoorKit();
    family_role.family = .vertical_link;
    try testing.expectError(error.incompatible_family_role, architecture.catalog.validateEntry(family_role));

    var kind = validWallStyle();
    kind.semantic_kind = .{ .wall_opening = .door };
    try testing.expectError(error.incompatible_semantic_kind, architecture.catalog.validateEntry(kind));
}

test "catalog rejects invalid category paths and tags" {
    const invalid_path = [_][]u8{ @constCast("Wall"), @constCast("") };
    var path = validWallStyle();
    path.category_path = @constCast(invalid_path[0..]);
    try testing.expectError(error.invalid_category_path, architecture.catalog.validateEntry(path));

    const duplicate_tags = [_][]u8{ @constCast("suburb"), @constCast("suburb") };
    var tags = validWallStyle();
    tags.theme_tags = @constCast(duplicate_tags[0..]);
    try testing.expectError(error.duplicate_tag, architecture.catalog.validateEntry(tags));
}

test "typed role wins even when catalog ID text says door" {
    var style = validWallStyle();
    style.catalog_id = @constCast("build:wall:opening:door:this-text-is-not-authority");
    try architecture.catalog.validateEntry(style);
    try testing.expectEqual(architecture.types.ArchitectureKitRole.style, style.role);
}

test "catalog rejects out-of-range and occupied clearance cells" {
    const out_of_range_cells = [_]architecture.types.WallCell{.{ .column_u = 16_777_217, .row_u = 0 }};
    var out_of_range = validDoorKit();
    out_of_range.measurement.clearance_mask = @constCast(out_of_range_cells[0..]);
    try testing.expectError(error.invalid_clearance_mask, architecture.catalog.validateEntry(out_of_range));

    const overlapping_cells = [_]architecture.types.WallCell{.{ .column_u = 0, .row_u = 0 }};
    var overlapping = validDoorKit();
    overlapping.measurement.clearance_mask = @constCast(overlapping_cells[0..]);
    try testing.expectError(error.occupied_clearance_overlap, architecture.catalog.validateEntry(overlapping));
}

fn point(x_u: architecture.Unit, z_u: architecture.Unit) topology.Point {
    return .{ .x_u = x_u, .z_u = z_u };
}

test "topology predicates intersect horizontal vertical and diagonal spans exactly" {
    const orthogonal = (try topology.exactSegmentIntersection(
        point(0, 0),
        point(16, 0),
        point(8, -8),
        point(8, 8),
    )).?;
    try testing.expectEqual(point(8, 0), orthogonal);
    try testing.expect(topology.properSegmentsIntersect(
        point(0, 0),
        point(16, 0),
        point(8, -8),
        point(8, 8),
    ));

    const diagonal = (try topology.exactSegmentIntersection(
        point(0, 0),
        point(16, 16),
        point(0, 16),
        point(16, 0),
    )).?;
    try testing.expectEqual(point(8, 8), diagonal);
}

test "topology predicates distinguish parallel overlap and endpoint touch" {
    try testing.expectEqual(
        topology.SegmentIntersectionKind.none,
        topology.classifySegmentIntersection(point(0, 0), point(16, 0), point(0, 1), point(16, 1)),
    );
    try testing.expectEqual(
        @as(?topology.RationalPoint, null),
        topology.lineIntersection(point(0, 0), point(16, 0), point(0, 1), point(16, 1)),
    );
    try testing.expectEqual(
        @as(?topology.Point, null),
        try topology.exactSegmentIntersection(point(0, 0), point(16, 0), point(0, 1), point(16, 1)),
    );

    try testing.expectEqual(
        topology.SegmentIntersectionKind.collinear_overlap,
        topology.classifySegmentIntersection(point(0, 0), point(16, 0), point(8, 0), point(24, 0)),
    );
    try testing.expectError(
        error.collinear_overlap,
        topology.exactSegmentIntersection(point(0, 0), point(16, 0), point(8, 0), point(24, 0)),
    );

    try testing.expectEqual(
        topology.SegmentIntersectionKind.endpoint_touch,
        topology.classifySegmentIntersection(point(0, 0), point(16, 0), point(16, 0), point(16, 16)),
    );
    const endpoint = (try topology.exactSegmentIntersection(
        point(0, 0),
        point(16, 0),
        point(16, 0),
        point(16, 16),
    )).?;
    try testing.expectEqual(point(16, 0), endpoint);
    try testing.expect(topology.pointOnSegment(point(16, 0), point(0, 0), point(16, 0)));
}

test "topology predicates stay exact at large valid and negative coordinates" {
    const minimum = architecture.types.Limits.minimum_unit;
    const maximum = architecture.types.Limits.maximum_unit;
    const large = (try topology.exactSegmentIntersection(
        point(minimum, 0),
        point(maximum, 0),
        point(0, minimum),
        point(0, maximum),
    )).?;
    try testing.expectEqual(point(0, 0), large);
    try testing.expect(topology.orientation(
        point(minimum, minimum),
        point(maximum, minimum),
        point(maximum, maximum),
    ) > 0);

    const negative = (try topology.exactSegmentIntersection(
        point(-16, -16),
        point(0, 0),
        point(-16, 0),
        point(0, -16),
    )).?;
    try testing.expectEqual(point(-8, -8), negative);
}

test "topology rational crossings reject fractional lattice points and sort exactly" {
    try testing.expectError(
        error.intersection_off_lattice,
        topology.exactSegmentIntersection(point(0, 0), point(3, 3), point(0, 3), point(3, 0)),
    );

    const first = topology.intersectionParameter(
        point(0, 0),
        point(16, 0),
        point(4, -8),
        point(4, 8),
    ).?;
    const second = topology.intersectionParameter(
        point(0, 0),
        point(16, 0),
        point(12, -8),
        point(12, 8),
    ).?;
    try testing.expect(topology.rationalLessThan(first, second));
    try testing.expectEqual(topology.Rational.init(1, 4), first);
    try testing.expectEqual(topology.Rational.init(3, 4), second);
}

fn wallVertex(id: []const u8, x_u: architecture.Unit, z_u: architecture.Unit) architecture.types.WallVertex {
    return .{ .id = @constCast(id), .floor = 0, .x_u = x_u, .z_u = z_u };
}

fn wallEdge(id: []const u8, start_vertex_id: []const u8, end_vertex_id: []const u8) architecture.types.WallEdge {
    return .{
        .id = @constCast(id),
        .start_vertex_id = @constCast(start_vertex_id),
        .end_vertex_id = @constCast(end_vertex_id),
        .support = .{ .absolute = .{ .base_y_u = 0 } },
        .height_u = 48,
        .thickness_u = 4,
        .profile = .full,
        .style_id = @constCast("build:wall:style:test"),
        .side_a = .{ .material_id = @constCast("material:a") },
        .side_b = .{ .material_id = @constCast("material:b") },
        .openings = @constCast(&[_]architecture.types.WallOpening{}),
    };
}

fn wallSource(vertices: []architecture.types.WallVertex, edges: []architecture.types.WallEdge) architecture.types.WallSource {
    return .{
        .vertices = vertices,
        .edges = edges,
        .anchors = @constCast(&[_]architecture.types.WallAnchor{}),
    };
}

test "derived topology builds one square with twins interior and exterior" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),
        wallVertex("v1", 16, 0),
        wallVertex("v2", 16, 16),
        wallVertex("v3", 0, 16),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("e0", "v0", "v1"),
        wallEdge("e1", "v1", "v2"),
        wallEdge("e2", "v2", "v3"),
        wallEdge("e3", "v3", "v0"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 4), graph.vertices.len);
    try testing.expectEqual(@as(usize, 8), graph.half_edges.len);
    try testing.expectEqual(@as(usize, 1), graph.faces.len);
    try testing.expectEqual(@as(usize, 1), graph.exteriors.len);
    try testing.expectEqual(@as(usize, 0), graph.holes.len);
    try testing.expectEqual(@as(usize, 0), graph.diagnostics.len);
    try testing.expectEqual(@as(topology.Wide, 512), graph.faces[0].signed_area_twice);
    try testing.expectEqual(@as(usize, 4), graph.faces[0].outer_boundary.half_edge_indices.len);
    for (graph.half_edges, 0..) |half_edge, index| {
        try testing.expectEqual(index, graph.half_edges[half_edge.twin_half_edge_index].twin_half_edge_index);
    }
}

test "derived topology splits two adjacent rooms around one shared wall" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),
        wallVertex("v1", 16, 0),
        wallVertex("v2", 32, 0),
        wallVertex("v3", 32, 16),
        wallVertex("v4", 16, 16),
        wallVertex("v5", 0, 16),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("e0", "v0", "v1"),
        wallEdge("e1", "v1", "v2"),
        wallEdge("e2", "v2", "v3"),
        wallEdge("e3", "v3", "v4"),
        wallEdge("e4", "v4", "v5"),
        wallEdge("e5", "v5", "v0"),
        wallEdge("e6", "v1", "v4"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 2), graph.faces.len);
    try testing.expectEqual(@as(usize, 1), graph.exteriors.len);
    try testing.expectEqual(@as(usize, 0), graph.holes.len);
    try testing.expectEqual(@as(topology.Wide, 512), graph.faces[0].signed_area_twice);
    try testing.expectEqual(@as(topology.Wide, 512), graph.faces[1].signed_area_twice);
}

test "derived topology accepts T and X junctions without manufacturing rooms" {
    var t_vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),
        wallVertex("vb", 8, 0),
        wallVertex("v1", 16, 0),
        wallVertex("v2", 16, 16),
        wallVertex("v3", 0, 16),
        wallVertex("vc", 8, 8),
    };
    var t_edges = [_]architecture.types.WallEdge{
        wallEdge("e0", "v0", "vb"),
        wallEdge("e1", "vb", "v1"),
        wallEdge("e2", "v1", "v2"),
        wallEdge("e3", "v2", "v3"),
        wallEdge("e4", "v3", "v0"),
        wallEdge("spur", "vb", "vc"),
    };
    var t_source = wallSource(&t_vertices, &t_edges);
    var t_graph = try topology.build(testing.allocator, &t_source);
    defer t_graph.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 1), t_graph.faces.len);
    try testing.expectEqual(@as(usize, 12), t_graph.half_edges.len);

    var x_vertices = [_]architecture.types.WallVertex{
        wallVertex("left", -16, 0),
        wallVertex("right", 16, 0),
        wallVertex("bottom", 0, -16),
        wallVertex("top", 0, 16),
        wallVertex("center", 0, 0),
    };
    var x_edges = [_]architecture.types.WallEdge{
        wallEdge("west", "left", "center"),
        wallEdge("east", "center", "right"),
        wallEdge("south", "bottom", "center"),
        wallEdge("north", "center", "top"),
    };
    var x_source = wallSource(&x_vertices, &x_edges);
    var x_graph = try topology.build(testing.allocator, &x_source);
    defer x_graph.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 0), x_graph.faces.len);
    try testing.expectEqual(@as(usize, 1), x_graph.exteriors.len);
    try testing.expectEqual(@as(usize, 8), x_graph.half_edges.len);
}

test "derived topology groups disconnected boundaries under one floor exterior" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("a0", 0, 0),   wallVertex("a1", 16, 0),
        wallVertex("a2", 16, 16), wallVertex("a3", 0, 16),
        wallVertex("b0", 32, 0),  wallVertex("b1", 48, 0),
        wallVertex("b2", 48, 16), wallVertex("b3", 32, 16),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("a-e0", "a0", "a1"), wallEdge("a-e1", "a1", "a2"),
        wallEdge("a-e2", "a2", "a3"), wallEdge("a-e3", "a3", "a0"),
        wallEdge("b-e0", "b0", "b1"), wallEdge("b-e1", "b1", "b2"),
        wallEdge("b-e2", "b2", "b3"), wallEdge("b-e3", "b3", "b0"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 2), graph.faces.len);
    try testing.expectEqual(@as(usize, 1), graph.exteriors.len);
    try testing.expectEqual(@as(usize, 2), graph.exteriors[0].boundary_cycles.len);
}

test "derived topology assigns a nested reverse boundary as a hole" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("o0", 0, 0),   wallVertex("o1", 32, 0),
        wallVertex("o2", 32, 32), wallVertex("o3", 0, 32),
        wallVertex("i0", 8, 8),   wallVertex("i1", 24, 8),
        wallVertex("i2", 24, 24), wallVertex("i3", 8, 24),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("o-e0", "o0", "o1"), wallEdge("o-e1", "o1", "o2"),
        wallEdge("o-e2", "o2", "o3"), wallEdge("o-e3", "o3", "o0"),
        wallEdge("i-e0", "i0", "i1"), wallEdge("i-e1", "i1", "i2"),
        wallEdge("i-e2", "i2", "i3"), wallEdge("i-e3", "i3", "i0"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 2), graph.faces.len);
    try testing.expectEqual(@as(usize, 1), graph.holes.len);
    try testing.expectEqual(@as(usize, 1), graph.faces[graph.holes[0].containing_face_index].hole_indices.len);
    try testing.expectEqual(@as(topology.Wide, -512), graph.holes[0].signed_area_twice);
}

test "derived topology retains a dangling edge in the exterior walk" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),
        wallVertex("v1", 16, 0),
    };
    var edges = [_]architecture.types.WallEdge{wallEdge("e0", "v0", "v1")};
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 0), graph.faces.len);
    try testing.expectEqual(@as(usize, 1), graph.exteriors.len);
    try testing.expectEqual(@as(usize, 2), graph.exteriors[0].boundary_cycles[0].half_edge_indices.len);
    try testing.expectEqual(@as(usize, 0), graph.diagnostics.len);
}

test "derived topology preserves source side after reversed edge direction" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),   wallVertex("v1", 16, 0),
        wallVertex("v2", 16, 16), wallVertex("v3", 0, 16),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("e0", "v1", "v0"),
        wallEdge("e1", "v1", "v2"),
        wallEdge("e2", "v2", "v3"),
        wallEdge("e3", "v3", "v0"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 1), graph.faces.len);
    var found_source_side = false;
    for (graph.half_edges) |half_edge| {
        if (!std.mem.eql(u8, half_edge.source_edge_id, "e0") or half_edge.source_side != .a) continue;
        found_source_side = true;
        try testing.expectEqualStrings(
            "v1",
            graph.vertices[half_edge.origin_vertex_index].source_vertex_id,
        );
        try testing.expectEqualStrings(
            "v0",
            graph.vertices[half_edge.target_vertex_index].source_vertex_id,
        );
    }
    try testing.expect(found_source_side);
}

fn expectSameOrderedTopologyIdentity(reference: topology.DerivedTopology, candidate: topology.DerivedTopology) !void {
    try testing.expectEqual(reference.faces.len, candidate.faces.len);
    for (reference.faces, candidate.faces) |reference_face, candidate_face| {
        try testing.expectEqualStrings(reference_face.signature, candidate_face.signature);
    }
    try testing.expectEqual(reference.diagnostics.len, candidate.diagnostics.len);
    for (reference.diagnostics, candidate.diagnostics) |reference_diagnostic, candidate_diagnostic| {
        try testing.expectEqual(reference_diagnostic.code, candidate_diagnostic.code);
        try testing.expectEqual(reference_diagnostic.floor, candidate_diagnostic.floor);
        try testing.expectEqual(reference_diagnostic.source_ids.len, candidate_diagnostic.source_ids.len);
        for (reference_diagnostic.source_ids, candidate_diagnostic.source_ids) |reference_id, candidate_id| {
            try testing.expectEqualStrings(reference_id, candidate_id);
        }
        try testing.expectEqualStrings(reference_diagnostic.detail, candidate_diagnostic.detail);
    }
}

test "derived topology face signatures and diagnostics ignore source permutations" {
    var vertices_a = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),   wallVertex("v1", 16, 0),
        wallVertex("v2", 32, 0),  wallVertex("v3", 32, 16),
        wallVertex("v4", 16, 16), wallVertex("v5", 0, 16),
    };
    var edges_a = [_]architecture.types.WallEdge{
        wallEdge("e0", "v0", "v1"), wallEdge("e1", "v1", "v2"),
        wallEdge("e2", "v2", "v3"), wallEdge("e3", "v3", "v4"),
        wallEdge("e4", "v4", "v5"), wallEdge("e5", "v5", "v0"),
        wallEdge("e6", "v1", "v4"),
    };
    var source_a = wallSource(&vertices_a, &edges_a);
    var graph_a = try topology.build(testing.allocator, &source_a);
    defer graph_a.deinit(testing.allocator);

    var vertices_b = [_]architecture.types.WallVertex{
        wallVertex("v5", 0, 16),  wallVertex("v4", 16, 16),
        wallVertex("v3", 32, 16), wallVertex("v2", 32, 0),
        wallVertex("v1", 16, 0),  wallVertex("v0", 0, 0),
    };
    var edges_b = [_]architecture.types.WallEdge{
        wallEdge("e6", "v1", "v4"), wallEdge("e5", "v5", "v0"),
        wallEdge("e4", "v4", "v5"), wallEdge("e3", "v3", "v4"),
        wallEdge("e2", "v2", "v3"), wallEdge("e1", "v1", "v2"),
        wallEdge("e0", "v0", "v1"),
    };
    var source_b = wallSource(&vertices_b, &edges_b);
    var graph_b = try topology.build(testing.allocator, &source_b);
    defer graph_b.deinit(testing.allocator);

    var vertices_c = [_]architecture.types.WallVertex{
        wallVertex("v2", 32, 0), wallVertex("v5", 0, 16),
        wallVertex("v0", 0, 0),  wallVertex("v4", 16, 16),
        wallVertex("v1", 16, 0), wallVertex("v3", 32, 16),
    };
    var edges_c = [_]architecture.types.WallEdge{
        wallEdge("e3", "v3", "v4"), wallEdge("e0", "v0", "v1"),
        wallEdge("e5", "v5", "v0"), wallEdge("e2", "v2", "v3"),
        wallEdge("e6", "v1", "v4"), wallEdge("e4", "v4", "v5"),
        wallEdge("e1", "v1", "v2"),
    };
    var source_c = wallSource(&vertices_c, &edges_c);
    var graph_c = try topology.build(testing.allocator, &source_c);
    defer graph_c.deinit(testing.allocator);

    var vertices_d = [_]architecture.types.WallVertex{
        wallVertex("v4", 16, 16), wallVertex("v0", 0, 0),
        wallVertex("v3", 32, 16), wallVertex("v1", 16, 0),
        wallVertex("v5", 0, 16),  wallVertex("v2", 32, 0),
    };
    var edges_d = [_]architecture.types.WallEdge{
        wallEdge("e1", "v1", "v2"), wallEdge("e4", "v4", "v5"),
        wallEdge("e6", "v1", "v4"), wallEdge("e2", "v2", "v3"),
        wallEdge("e5", "v5", "v0"), wallEdge("e0", "v0", "v1"),
        wallEdge("e3", "v3", "v4"),
    };
    var source_d = wallSource(&vertices_d, &edges_d);
    var graph_d = try topology.build(testing.allocator, &source_d);
    defer graph_d.deinit(testing.allocator);

    try expectSameOrderedTopologyIdentity(graph_a, graph_b);
    try expectSameOrderedTopologyIdentity(graph_a, graph_c);
    try expectSameOrderedTopologyIdentity(graph_a, graph_d);
    try testing.expectEqualStrings(
        "c176f07ee864969f1dccc246594e764a7acd8fd34cda82424ff482db1795ea5d",
        graph_a.faces[0].signature,
    );
    try testing.expectEqualStrings(
        "52f3e5822c628a0ae74fe676279c2fbedfb9e151f92713d386343fdf926e6d34",
        graph_a.faces[1].signature,
    );
}

fn expectTopologyDiagnostic(
    graph: topology.DerivedTopology,
    code: topology.DiagnosticCode,
    expected_source_ids: []const []const u8,
) !void {
    for (graph.diagnostics) |diagnostic| {
        if (diagnostic.code != code) continue;
        try testing.expectEqual(expected_source_ids.len, diagnostic.source_ids.len);
        for (expected_source_ids, diagnostic.source_ids) |expected_id, actual_id| {
            try testing.expectEqualStrings(expected_id, actual_id);
        }
        return;
    }
    return error.TestExpectedEqual;
}

test "derived topology diagnoses duplicate coincident edges" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),
        wallVertex("v1", 16, 0),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("duplicate-a", "v0", "v1"),
        wallEdge("duplicate-b", "v1", "v0"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 4), graph.half_edges.len);
    try expectTopologyDiagnostic(graph, .duplicate_coincident_edge, &.{ "duplicate-a", "duplicate-b" });
}

test "derived topology diagnoses partial collinear overlap" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0), wallVertex("v1", 16, 0),
        wallVertex("v2", 8, 0), wallVertex("v3", 24, 0),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("overlap-a", "v0", "v1"),
        wallEdge("overlap-b", "v2", "v3"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 4), graph.half_edges.len);
    try expectTopologyDiagnostic(graph, .partial_collinear_overlap, &.{ "overlap-a", "overlap-b" });
}

test "derived topology diagnoses and explicitly excludes a self loop" {
    var vertices = [_]architecture.types.WallVertex{wallVertex("v0", 0, 0)};
    var edges = [_]architecture.types.WallEdge{wallEdge("self", "v0", "v0")};
    var source = wallSource(&vertices, &edges);
    var graph = try topology.build(testing.allocator, &source);
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 0), graph.half_edges.len);
    try expectTopologyDiagnostic(graph, .self_loop, &.{"self"});
}

test "derived topology diagnoses an intersection inside opening clearance" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("left", 0, 0),      wallVertex("right", 32, 0),
        wallVertex("bottom", 16, -16), wallVertex("top", 16, 16),
    };
    var opening = [_]architecture.types.WallOpening{.{
        .id = @constCast("door"),
        .kind = .door,
        .kit_id = @constCast("build:wall:opening:door:test"),
        .column_u = 12,
        .row_u = 0,
        .facing_side = .a,
        .hinge = .start,
    }};
    var edges = [_]architecture.types.WallEdge{
        wallEdge("wall", "left", "right"),
        wallEdge("crossing", "bottom", "top"),
    };
    edges[0].openings = opening[0..];
    var source = wallSource(&vertices, &edges);
    const clearance_zones = [_]topology.OpeningClearanceZone{.{
        .edge_id = "wall",
        .opening_id = "door",
        .minimum_column_u = 12,
        .maximum_column_exclusive_u = 20,
    }};
    var graph = try topology.buildWithOptions(testing.allocator, &source, .{
        .opening_clearance_zones = &clearance_zones,
    });
    defer graph.deinit(testing.allocator);

    try expectTopologyDiagnostic(
        graph,
        .intersection_in_opening_clearance,
        &.{ "crossing", "door", "wall" },
    );
}

test "derived topology diagnoses a traversal exceeding the half-edge bound" {
    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),   wallVertex("v1", 16, 0),
        wallVertex("v2", 16, 16), wallVertex("v3", 0, 16),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("e0", "v0", "v1"), wallEdge("e1", "v1", "v2"),
        wallEdge("e2", "v2", "v3"), wallEdge("e3", "v3", "v0"),
    };
    var source = wallSource(&vertices, &edges);
    var graph = try topology.buildWithOptions(testing.allocator, &source, .{
        .maximum_face_steps = 3,
    });
    defer graph.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 8), graph.half_edges.len);
    try expectTopologyDiagnostic(graph, .face_traversal_limit, &.{"e0"});
}

test "facade source validation constructs and rejects normalized topology atomically" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};

    var valid_fixture = SourceFixture.init();
    var valid_source = valid_fixture.source();
    try architecture.validateSource(testing.allocator, &valid_source, &entries);

    var vertices = [_]architecture.types.WallVertex{
        wallVertex("v0", 0, 0),
        wallVertex("v1", 16, 0),
    };
    var edges = [_]architecture.types.WallEdge{
        wallEdge("duplicate-a", "v0", "v1"),
        wallEdge("duplicate-b", "v1", "v0"),
    };
    var invalid_source = architecture.ArchitectureSource{
        .version = architecture.source_version,
        .revision = 0,
        .walls = wallSource(&vertices, &edges),
    };
    try testing.expectError(
        error.topology_invalid,
        architecture.validateSource(testing.allocator, &invalid_source, &entries),
    );
}

fn emptyOwnedArchitectureSource(allocator: std.mem.Allocator) !architecture.ArchitectureSource {
    return .{
        .version = architecture.source_version,
        .revision = 0,
        .walls = .{
            .vertices = try allocator.alloc(architecture.types.WallVertex, 0),
            .edges = try allocator.alloc(architecture.types.WallEdge, 0),
            .anchors = try allocator.alloc(architecture.types.WallAnchor, 0),
        },
    };
}

fn drawWallCommand(
    command_id: []const u8,
    expected_revision: u32,
    start_x_u: f64,
    start_z_u: f64,
    end_x_u: f64,
    end_z_u: f64,
    start_magnet_vertex_id: ?[]const u8,
    end_magnet_vertex_id: ?[]const u8,
) mutation.Command {
    return .{
        .command_id = command_id,
        .expected_revision = expected_revision,
        .operation = .{ .draw_wall = .{
            .floor = 0,
            .start = .{ .x_u = start_x_u, .z_u = start_z_u },
            .end = .{ .x_u = end_x_u, .z_u = end_z_u },
            .start_magnet_vertex_id = start_magnet_vertex_id,
            .end_magnet_vertex_id = end_magnet_vertex_id,
            .support = .{ .absolute = .{ .base_y_u = 0 } },
            .height_u = 48,
            .thickness_u = 4,
            .profile = .full,
            .style_id = "build:wall:style:test",
            .side_a_material_id = "material:a",
            .side_b_material_id = "material:b",
        } },
    };
}

fn applyExpectedDraw(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
    command: mutation.Command,
) !void {
    var result = try mutation.applyCommand(allocator, source, entries, command);
    defer result.deinit(allocator);
    switch (result) {
        .receipt => {},
        .rejection => |rejection| {
            std.debug.print("unexpected draw rejection: {s}\n", .{rejection.detail});
            return error.TestUnexpectedResult;
        },
    }
}

fn findSourceVertex(source: architecture.ArchitectureSource, id: []const u8) ?architecture.types.WallVertex {
    for (source.walls.vertices) |vertex_value| {
        if (std.mem.eql(u8, vertex_value.id, id)) return vertex_value;
    }
    return null;
}

fn findSourceEdge(source: architecture.ArchitectureSource, id: []const u8) ?architecture.types.WallEdge {
    for (source.walls.edges) |edge_value| {
        if (std.mem.eql(u8, edge_value.id, id)) return edge_value;
    }
    return null;
}

test "draw wall mutates an empty source with command-derived IDs" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);

    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("draw-empty", 0, 0, 0, 16, 0, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .receipt => |receipt| {
            try testing.expectEqual(@as(u32, 0), receipt.source_revision_before);
            try testing.expectEqual(@as(u32, 1), receipt.source_revision_after);
            try testing.expectEqual(@as(usize, 3), receipt.created.len);
            try testing.expectEqualStrings("draw-empty:v:0", receipt.created[0].id);
            try testing.expectEqualStrings("draw-empty:v:1", receipt.created[1].id);
            try testing.expectEqualStrings("draw-empty:e:0", receipt.created[2].id);
            try testing.expectEqual(@as(usize, 3), receipt.forward_patch.operations.len);
            try testing.expectEqual(@as(usize, 3), receipt.inverse_patch.operations.len);
            for (receipt.forward_patch.operations) |operation| switch (operation) {
                .insert => {},
                else => return error.TestUnexpectedResult,
            };
            for (receipt.inverse_patch.operations) |operation| switch (operation) {
                .remove => {},
                else => return error.TestUnexpectedResult,
            };
            try testing.expectEqual(@as(usize, 64), receipt.source_hash_before.len);
            try testing.expectEqual(@as(usize, 64), receipt.source_hash_after.len);
            try testing.expect(!std.mem.eql(u8, receipt.source_hash_before, receipt.source_hash_after));
            try testing.expectEqual(@as(usize, 1), receipt.affected_bounds.len);
            try testing.expectEqual(architecture.types.AffectedBounds{
                .floor = 0,
                .min_x_u = -2,
                .min_y_u = 0,
                .min_z_u = -2,
                .max_x_u_exclusive = 18,
                .max_y_u_exclusive = 48,
                .max_z_u_exclusive = 2,
            }, receipt.affected_bounds[0]);
        },
        .rejection => return error.TestUnexpectedResult,
    }
    try testing.expectEqual(@as(u32, 1), source.revision);
    try testing.expectEqual(@as(usize, 2), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 1), source.walls.edges.len);
    try testing.expect(findSourceVertex(source, "draw-empty:v:0") != null);
    try testing.expect(findSourceVertex(source, "draw-empty:v:1") != null);
    try testing.expect(findSourceEdge(source, "draw-empty:e:0") != null);
}

test "draw wall exactly reuses a coincident endpoint" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("first", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("coincident", 1, 16, 0, 16, 16, null, null),
    );

    try testing.expectEqual(@as(usize, 3), source.walls.vertices.len);
    const edge = findSourceEdge(source, "coincident:e:0").?;
    try testing.expectEqualStrings("first:v:1", edge.start_vertex_id);
    try testing.expectEqualStrings("coincident:v:0", edge.end_vertex_id);
}

test "draw wall reuses only an explicit magnet target" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("first", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("magnet", 1, 17, 0, 16, 16, "first:v:1", null),
    );

    try testing.expectEqual(@as(usize, 3), source.walls.vertices.len);
    const edge = findSourceEdge(source, "magnet:e:0").?;
    try testing.expectEqualStrings("first:v:1", edge.start_vertex_id);
    try testing.expectEqualStrings("magnet:v:0", edge.end_vertex_id);
}

test "draw wall keeps an adjacent one-unit endpoint distinct without magnet" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("first", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("adjacent", 1, 17, 0, 17, 16, null, null),
    );

    try testing.expectEqual(@as(usize, 4), source.walls.vertices.len);
    const start = findSourceVertex(source, "adjacent:v:0").?;
    try testing.expectEqual(@as(architecture.Unit, 17), start.x_u);
    try testing.expectEqual(@as(architecture.Unit, 0), start.z_u);
}

test "draw wall rejects non-integer structural input atomically" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("fractional", 0, 0.5, 0, 16, 0, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .receipt => return error.TestUnexpectedResult,
        .rejection => |rejection| try testing.expectEqual(
            architecture.types.ArchitectureRejectionCode.structural_value_not_integer,
            rejection.code,
        ),
    }
    try testing.expectEqual(@as(u32, 0), source.revision);
    try testing.expectEqual(@as(usize, 0), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 0), source.walls.edges.len);
}

test "draw wall accepts arbitrary-angle lattice endpoints" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("angle", 0, 0, 0, 7, 11, null, null),
    );
    const end = findSourceVertex(source, "angle:v:1").?;
    try testing.expectEqual(@as(architecture.Unit, 7), end.x_u);
    try testing.expectEqual(@as(architecture.Unit, 11), end.z_u);
}

test "draw wall preserves reversed drag as stable side-A direction" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("reverse", 0, 16, 0, 0, 0, null, null),
    );
    const edge = findSourceEdge(source, "reverse:e:0").?;
    try testing.expectEqualStrings("reverse:v:0", edge.start_vertex_id);
    try testing.expectEqualStrings("reverse:v:1", edge.end_vertex_id);
    try testing.expectEqual(@as(architecture.Unit, 16), findSourceVertex(source, edge.start_vertex_id).?.x_u);
    try testing.expectEqual(@as(architecture.Unit, 0), findSourceVertex(source, edge.end_vertex_id).?.x_u);
}

test "draw wall rejects a stale source revision without mutation" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("stale", 1, 0, 0, 16, 0, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .receipt => return error.TestUnexpectedResult,
        .rejection => |rejection| {
            try testing.expectEqual(
                architecture.types.ArchitectureRejectionCode.stale_source_revision,
                rejection.code,
            );
            try testing.expectEqual(@as(u32, 1), rejection.expected_revision);
            try testing.expectEqual(@as(u32, 0), rejection.actual_revision);
        },
    }
    try testing.expectEqual(@as(u32, 0), source.revision);
    try testing.expectEqual(@as(usize, 0), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 0), source.walls.edges.len);
}

fn findSourceVertexAtPoint(
    source: architecture.ArchitectureSource,
    floor: i32,
    x_u: architecture.Unit,
    z_u: architecture.Unit,
) ?architecture.types.WallVertex {
    for (source.walls.vertices) |vertex| {
        if (vertex.floor == floor and vertex.x_u == x_u and vertex.z_u == z_u) return vertex;
    }
    return null;
}

fn expectDirectedSourceEdge(
    source: architecture.ArchitectureSource,
    start_x_u: architecture.Unit,
    start_z_u: architecture.Unit,
    end_x_u: architecture.Unit,
    end_z_u: architecture.Unit,
) !void {
    for (source.walls.edges) |edge| {
        const start = findSourceVertex(source, edge.start_vertex_id).?;
        const end = findSourceVertex(source, edge.end_vertex_id).?;
        if (start.x_u == start_x_u and start.z_u == start_z_u and
            end.x_u == end_x_u and end.z_u == end_z_u)
        {
            return;
        }
    }
    return error.TestExpectedEqual;
}

fn findDirectedSourceEdge(
    source: architecture.ArchitectureSource,
    start_x_u: architecture.Unit,
    start_z_u: architecture.Unit,
    end_x_u: architecture.Unit,
    end_z_u: architecture.Unit,
) ?architecture.types.WallEdge {
    for (source.walls.edges) |edge| {
        const start = findSourceVertex(source, edge.start_vertex_id).?;
        const end = findSourceVertex(source, edge.end_vertex_id).?;
        if (start.x_u == start_x_u and start.z_u == start_z_u and
            end.x_u == end_x_u and end.z_u == end_z_u)
        {
            return edge;
        }
    }
    return null;
}

fn expectSourceVertexIdAtPoint(
    source: architecture.ArchitectureSource,
    floor: i32,
    x_u: architecture.Unit,
    z_u: architecture.Unit,
    expected_id: []const u8,
) !void {
    const vertex = findSourceVertexAtPoint(source, floor, x_u, z_u) orelse
        return error.TestExpectedEqual;
    try testing.expectEqualStrings(expected_id, vertex.id);
}

fn drawThreeVerticalCrossingTargets(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
) !void {
    try applyExpectedDraw(
        allocator,
        source,
        entries,
        drawWallCommand("target-left", 0, 4, -4, 4, 4, null, null),
    );
    try applyExpectedDraw(
        allocator,
        source,
        entries,
        drawWallCommand("target-middle", 1, 8, -4, 8, 4, null, null),
    );
    try applyExpectedDraw(
        allocator,
        source,
        entries,
        drawWallCommand("target-right", 2, 12, -4, 12, 4, null, null),
    );
}

test "draw wall splits one lattice-aligned X intersection" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    var base_command = drawWallCommand("base", 0, 0, 0, 16, 0, null, null);
    base_command.operation.draw_wall.side_a_material_id = "material:base-side-a";
    base_command.operation.draw_wall.side_b_material_id = "material:base-side-b";
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        base_command,
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("cross", 1, 8, -8, 8, 8, null, null),
    );

    try testing.expectEqual(@as(usize, 5), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 4), source.walls.edges.len);
    try expectSourceVertexIdAtPoint(source, 0, 8, 0, "cross:v:2");
    try expectDirectedSourceEdge(source, 0, 0, 8, 0);
    try expectDirectedSourceEdge(source, 8, 0, 16, 0);
    try expectDirectedSourceEdge(source, 8, -8, 8, 0);
    try expectDirectedSourceEdge(source, 8, 0, 8, 8);
    const first_base_child = findDirectedSourceEdge(source, 0, 0, 8, 0).?;
    const second_base_child = findDirectedSourceEdge(source, 8, 0, 16, 0).?;
    try testing.expectEqualStrings("material:base-side-a", first_base_child.side_a.material_id);
    try testing.expectEqualStrings("material:base-side-b", first_base_child.side_b.material_id);
    try testing.expectEqualStrings("material:base-side-a", second_base_child.side_a.material_id);
    try testing.expectEqualStrings("material:base-side-b", second_base_child.side_b.material_id);
}

test "draw wall splits one lattice-aligned T intersection" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("base", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("tee", 1, 8, 0, 8, 8, null, null),
    );

    try testing.expectEqual(@as(usize, 4), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 3), source.walls.edges.len);
    try expectSourceVertexIdAtPoint(source, 0, 8, 0, "tee:v:0");
    try expectDirectedSourceEdge(source, 0, 0, 8, 0);
    try expectDirectedSourceEdge(source, 8, 0, 16, 0);
    try expectDirectedSourceEdge(source, 8, 0, 8, 8);
}

test "draw wall splits a stroke crossing three source edges" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawThreeVerticalCrossingTargets(testing.allocator, &source, &entries);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("multi", 3, 0, 0, 16, 0, null, null),
    );

    try testing.expectEqual(@as(usize, 11), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 10), source.walls.edges.len);
    try expectSourceVertexIdAtPoint(source, 0, 4, 0, "multi:v:2");
    try expectSourceVertexIdAtPoint(source, 0, 8, 0, "multi:v:3");
    try expectSourceVertexIdAtPoint(source, 0, 12, 0, "multi:v:4");
}

test "draw wall orders intersection identities along a reversed stroke" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawThreeVerticalCrossingTargets(testing.allocator, &source, &entries);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("reverse-multi", 3, 16, 0, 0, 0, null, null),
    );

    try testing.expectEqual(@as(usize, 11), source.walls.vertices.len);
    try testing.expectEqual(@as(usize, 10), source.walls.edges.len);
    try expectSourceVertexIdAtPoint(source, 0, 12, 0, "reverse-multi:v:2");
    try expectSourceVertexIdAtPoint(source, 0, 8, 0, "reverse-multi:v:3");
    try expectSourceVertexIdAtPoint(source, 0, 4, 0, "reverse-multi:v:4");
    try expectDirectedSourceEdge(source, 16, 0, 12, 0);
    try expectDirectedSourceEdge(source, 12, 0, 8, 0);
    try expectDirectedSourceEdge(source, 8, 0, 4, 0);
    try expectDirectedSourceEdge(source, 4, 0, 0, 0);
}

test "draw wall rejects an off-lattice rational intersection atomically" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("diagonal-a", 0, 0, 0, 3, 3, null, null),
    );

    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("diagonal-b", 1, 0, 3, 3, 0, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .receipt => return error.TestUnexpectedResult,
        .rejection => |rejection| try testing.expectEqual(
            architecture.types.ArchitectureRejectionCode.off_lattice_intersection,
            rejection.code,
        ),
    }
    try testing.expectEqual(@as(u32, 1), source.revision);
    try testing.expectEqual(@as(usize, 1), source.walls.edges.len);
}

test "draw wall rejects a collinear overlap atomically" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("overlap-a", 0, 0, 0, 16, 0, null, null),
    );

    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("overlap-b", 1, 8, 0, 24, 0, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .receipt => return error.TestUnexpectedResult,
        .rejection => |rejection| try testing.expectEqual(
            architecture.types.ArchitectureRejectionCode.collinear_overlap,
            rejection.code,
        ),
    }
    try testing.expectEqual(@as(u32, 1), source.revision);
    try testing.expectEqual(@as(usize, 1), source.walls.edges.len);
}

const OpeningFixture = struct {
    id: []const u8,
    column_u: architecture.Unit,
};

fn installOpeningFixtures(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    edge_id: []const u8,
    fixtures: []const OpeningFixture,
) !void {
    for (source.walls.edges) |*edge| {
        if (!std.mem.eql(u8, edge.id, edge_id)) continue;
        for (edge.openings) |*opening| opening.deinit(allocator);
        if (edge.openings.len != 0) allocator.free(edge.openings);
        const openings = try allocator.alloc(architecture.types.WallOpening, fixtures.len);
        var initialized: usize = 0;
        errdefer {
            for (openings[0..initialized]) |*opening| opening.deinit(allocator);
            if (openings.len != 0) allocator.free(openings);
        }
        for (fixtures) |fixture| {
            const id = try allocator.dupe(u8, fixture.id);
            errdefer allocator.free(id);
            const kit_id = try allocator.dupe(u8, "build:wall:opening:door:test");
            errdefer allocator.free(kit_id);
            openings[initialized] = .{
                .id = id,
                .kind = .door,
                .kit_id = kit_id,
                .column_u = fixture.column_u,
                .row_u = 0,
                .facing_side = .a,
                .hinge = .start,
            };
            initialized += 1;
        }
        edge.openings = openings;
        return;
    }
    return error.TestExpectedEqual;
}

const AnchorFixture = struct {
    id: []const u8,
    column_u: architecture.Unit,
};

fn installAnchorFixtures(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    edge_id: []const u8,
    fixtures: []const AnchorFixture,
) !void {
    for (source.walls.anchors) |*anchor| anchor.deinit(allocator);
    if (source.walls.anchors.len != 0) allocator.free(source.walls.anchors);
    const anchors = try allocator.alloc(architecture.types.WallAnchor, fixtures.len);
    var initialized: usize = 0;
    errdefer {
        for (anchors[0..initialized]) |*anchor| anchor.deinit(allocator);
        if (anchors.len != 0) allocator.free(anchors);
    }
    for (fixtures) |fixture| {
        const id = try allocator.dupe(u8, fixture.id);
        errdefer allocator.free(id);
        const owned_edge_id = try allocator.dupe(u8, edge_id);
        errdefer allocator.free(owned_edge_id);
        const target_piece_id = try allocator.dupe(u8, "prop:wall:test");
        errdefer allocator.free(target_piece_id);
        anchors[initialized] = .{
            .id = id,
            .edge_id = owned_edge_id,
            .side = .b,
            .column_u = fixture.column_u,
            .row_u = 12,
            .target_piece_id = target_piece_id,
        };
        initialized += 1;
    }
    source.walls.anchors = anchors;
}

fn findOpeningInSource(
    source: architecture.ArchitectureSource,
    opening_id: []const u8,
) ?struct { edge_id: []const u8, opening: architecture.types.WallOpening } {
    for (source.walls.edges) |edge| {
        for (edge.openings) |opening| {
            if (std.mem.eql(u8, opening.id, opening_id)) return .{
                .edge_id = edge.id,
                .opening = opening,
            };
        }
    }
    return null;
}

fn findAnchorInSource(
    source: architecture.ArchitectureSource,
    anchor_id: []const u8,
) ?architecture.types.WallAnchor {
    for (source.walls.anchors) |anchor| {
        if (std.mem.eql(u8, anchor.id, anchor_id)) return anchor;
    }
    return null;
}

test "wall split remaps measured openings before and after the split column" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("base", 0, 0, 0, 64, 0, null, null),
    );
    try installOpeningFixtures(testing.allocator, &source, "base:e:0", &.{
        .{ .id = "opening-left", .column_u = 16 },
        .{ .id = "opening-right", .column_u = 48 },
    });

    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("split", 1, 32, -16, 32, 16, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .rejection => return error.TestUnexpectedResult,
        .receipt => |receipt| {
            try testing.expectEqual(@as(usize, 1), receipt.edge_child_remaps.len);
            try testing.expectEqualStrings("base:e:0", receipt.edge_child_remaps[0].predecessor_edge_id);
            try testing.expectEqualSlices(
                architecture.Unit,
                &.{ 0, 32 },
                receipt.edge_child_remaps[0].child_start_columns_u,
            );
            try testing.expectEqual(@as(usize, 2), receipt.opening_remaps.len);
            try testing.expectEqual(@as(usize, 2), receipt.updated.len);
            try testing.expectEqual(architecture.types.RecordFamily.opening, receipt.updated[0].family);
            try testing.expectEqual(architecture.types.RecordFamily.opening, receipt.updated[1].family);
        },
    }

    const left = findOpeningInSource(source, "opening-left").?;
    const right = findOpeningInSource(source, "opening-right").?;
    try testing.expectEqualStrings("split:e:0", left.edge_id);
    try testing.expectEqual(@as(architecture.Unit, 16), left.opening.column_u);
    try testing.expectEqualStrings("split:e:1", right.edge_id);
    try testing.expectEqual(@as(architecture.Unit, 16), right.opening.column_u);
}

test "wall split rejects an intersection through an opening occupied cell" {
    var occupied_cells = [_]architecture.types.WallCell{.{ .column_u = 0, .row_u = 0 }};
    var door = validDoorKit();
    door.measurement.occupied_mask = &occupied_cells;
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), door };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("base", 0, 0, 0, 64, 0, null, null),
    );
    try installOpeningFixtures(testing.allocator, &source, "base:e:0", &.{
        .{ .id = "opening-on-split", .column_u = 32 },
    });

    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("blocked-split", 1, 32, -16, 32, 16, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .receipt => return error.TestUnexpectedResult,
        .rejection => |rejection| try testing.expectEqual(
            architecture.types.ArchitectureRejectionCode.split_intersects_surface_child,
            rejection.code,
        ),
    }
    try testing.expectEqual(@as(u32, 1), source.revision);
    try testing.expectEqualStrings("base:e:0", findOpeningInSource(source, "opening-on-split").?.edge_id);
}

test "wall split remaps anchors on both child cell ranges" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("base", 0, 0, 0, 64, 0, null, null),
    );
    try installAnchorFixtures(testing.allocator, &source, "base:e:0", &.{
        .{ .id = "anchor-left", .column_u = 8 },
        .{ .id = "anchor-right", .column_u = 48 },
    });

    var result = try mutation.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("split", 1, 32, -16, 32, 16, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .rejection => return error.TestUnexpectedResult,
        .receipt => |receipt| {
            try testing.expectEqual(@as(usize, 1), receipt.edge_child_remaps.len);
            try testing.expectEqual(@as(usize, 2), receipt.anchor_remaps.len);
            try testing.expectEqual(@as(usize, 2), receipt.updated.len);
            var forward_anchor_replaces: usize = 0;
            for (receipt.forward_patch.operations) |operation| switch (operation) {
                .replace => |delta| if (delta.family == .anchor) {
                    forward_anchor_replaces += 1;
                },
                else => {},
            };
            var inverse_anchor_replaces: usize = 0;
            for (receipt.inverse_patch.operations) |operation| switch (operation) {
                .replace => |delta| if (delta.family == .anchor) {
                    inverse_anchor_replaces += 1;
                },
                else => {},
            };
            try testing.expectEqual(@as(usize, 2), forward_anchor_replaces);
            try testing.expectEqual(@as(usize, 2), inverse_anchor_replaces);
        },
    }

    const left = findAnchorInSource(source, "anchor-left").?;
    const right = findAnchorInSource(source, "anchor-right").?;
    try testing.expectEqualStrings("split:e:0", left.edge_id);
    try testing.expectEqual(@as(architecture.Unit, 8), left.column_u);
    try testing.expectEqualStrings("split:e:1", right.edge_id);
    try testing.expectEqual(@as(architecture.Unit, 16), right.column_u);
}

const SMALL_DOOR_PROFILES = [_]architecture.types.WallProfile{ .full, .half };
const SMALL_DOOR_THICKNESSES = [_]architecture.Unit{4};

fn smallDoorKit() architecture.CatalogEntry {
    var kit = validDoorKit();
    kit.catalog_id = @constCast("build:wall:opening:door:small");
    kit.content_hash = @constCast(HASH_D);
    kit.label = @constCast("Small Test Door");
    kit.measurement.source_bounds_u = .{
        .min_x_u = -5,
        .min_y_u = 0,
        .min_z_u = -2,
        .max_x_u = 5,
        .max_y_u = 21,
        .max_z_u = 2,
    };
    kit.measurement.mount_bounds_u = .{ .min_u = -4.2, .min_v = 0, .max_u = 4.2, .max_v = 20.2 };
    kit.measurement.footprint = .{
        .min_column = -5,
        .min_row = 0,
        .max_column_exclusive = 5,
        .max_row_exclusive = 21,
    };
    kit.wall_opening_compatibility = .{
        .permitted_profiles = @constCast(SMALL_DOOR_PROFILES[0..]),
        .permitted_thickness_u = @constCast(SMALL_DOOR_THICKNESSES[0..]),
        .portal_class = .walk,
    };
    return kit;
}

fn openingCommand(
    command_id: []const u8,
    expected_revision: u32,
    edge_id: []const u8,
    opening_id: []const u8,
    kit_id: []const u8,
    column_u: f64,
    row_u: f64,
) mutation.Command {
    return .{
        .command_id = command_id,
        .expected_revision = expected_revision,
        .operation = .{ .insert_opening = .{
            .edge_id = edge_id,
            .opening = .{
                .opening_id = opening_id,
                .kind = .door,
                .kit_id = kit_id,
                .column_u = column_u,
                .row_u = row_u,
                .facing_side = .a,
                .hinge = .start,
            },
        } },
    };
}

fn configureOpeningCommand(
    command_id: []const u8,
    expected_revision: u32,
    opening_id: []const u8,
    kit_id: []const u8,
    column_u: f64,
    row_u: f64,
    facing_side: architecture.types.WallSide,
    hinge: architecture.types.WallHinge,
) mutation.Command {
    return .{
        .command_id = command_id,
        .expected_revision = expected_revision,
        .operation = .{ .configure_opening = .{
            .opening_id = opening_id,
            .kind = .door,
            .kit_id = kit_id,
            .column_u = column_u,
            .row_u = row_u,
            .facing_side = facing_side,
            .hinge = hinge,
        } },
    };
}

fn applyExpectedOpeningMutation(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
    command: mutation.Command,
) !void {
    var result = try mutation.applyCommand(allocator, source, entries, command);
    defer result.deinit(allocator);
    switch (result) {
        .receipt => {},
        .rejection => |rejection| {
            std.debug.print("unexpected opening rejection: {s}\n", .{rejection.detail});
            return error.TestUnexpectedResult;
        },
    }
}

fn drawOpeningTestWall(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
    profile: architecture.types.WallProfile,
    thickness_u: f64,
    height_u: f64,
) !void {
    var command = drawWallCommand("base", 0, 0, 0, 64, 0, null, null);
    command.operation.draw_wall.profile = profile;
    command.operation.draw_wall.thickness_u = thickness_u;
    command.operation.draw_wall.height_u = height_u;
    try applyExpectedDraw(allocator, source, entries, command);
}

fn expectOpeningRejection(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
    command: mutation.Command,
    expected: architecture.types.ArchitectureRejectionCode,
) !void {
    var result = try mutation.applyCommand(allocator, source, entries, command);
    defer result.deinit(allocator);
    switch (result) {
        .receipt => return error.TestUnexpectedResult,
        .rejection => |rejection| try testing.expectEqual(expected, rejection.code),
    }
}

test "opening insert stores only measured kit identity and placement" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("insert", 1, "base:e:0", "insert:o:0", "build:wall:opening:door:test", 16, 0),
    );

    const located = findOpeningInSource(source, "insert:o:0").?;
    try testing.expectEqualStrings("base:e:0", located.edge_id);
    try testing.expectEqualStrings("build:wall:opening:door:test", located.opening.kit_id);
    try testing.expectEqual(@as(architecture.Unit, 16), located.opening.column_u);
    try testing.expectEqual(@as(architecture.Unit, 0), located.opening.row_u);
}

test "opening move and delete mutate one stable opening identity" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("insert", 1, "base:e:0", "insert:o:0", "build:wall:opening:door:test", 16, 0),
    );
    try applyExpectedOpeningMutation(testing.allocator, &source, &entries, .{
        .command_id = "move",
        .expected_revision = 2,
        .operation = .{ .move_opening = .{ .opening_id = "insert:o:0", .column_u = 40, .row_u = 4 } },
    });
    const moved = findOpeningInSource(source, "insert:o:0").?.opening;
    try testing.expectEqual(@as(architecture.Unit, 40), moved.column_u);
    try testing.expectEqual(@as(architecture.Unit, 4), moved.row_u);
    try applyExpectedOpeningMutation(testing.allocator, &source, &entries, .{
        .command_id = "delete",
        .expected_revision = 3,
        .operation = .{ .delete_opening = .{ .opening_id = "insert:o:0" } },
    });
    try testing.expect(findOpeningInSource(source, "insert:o:0") == null);
}

test "opening configure changes measured kit facing and hinge without changing ID" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit(), smallDoorKit() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("insert", 1, "base:e:0", "insert:o:0", "build:wall:opening:door:test", 16, 0),
    );
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        configureOpeningCommand("configure", 2, "insert:o:0", "build:wall:opening:door:small", 20, 6, .b, .end),
    );
    const configured = findOpeningInSource(source, "insert:o:0").?.opening;
    try testing.expectEqualStrings("build:wall:opening:door:small", configured.kit_id);
    try testing.expectEqual(architecture.types.WallSide.b, configured.facing_side);
    try testing.expectEqual(architecture.types.WallHinge.end, configured.hinge);
    try testing.expectEqual(@as(architecture.Unit, 20), configured.column_u);
    try testing.expectEqual(@as(architecture.Unit, 6), configured.row_u);
}

test "opening slots enumerate every valid anchor in row column order" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    var slots = try mutation.openingSlots(
        testing.allocator,
        &source,
        &entries,
        "base:e:0",
        "build:wall:opening:door:test",
    );
    defer slots.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 675), slots.values.len);
    try testing.expectEqual(mutation.OpeningSlot{ .column_u = 10, .row_u = 0 }, slots.values[0]);
    try testing.expectEqual(mutation.OpeningSlot{ .column_u = 11, .row_u = 0 }, slots.values[1]);
    try testing.expectEqual(mutation.OpeningSlot{ .column_u = 54, .row_u = 0 }, slots.values[44]);
    try testing.expectEqual(mutation.OpeningSlot{ .column_u = 10, .row_u = 1 }, slots.values[45]);
    try testing.expectEqual(mutation.OpeningSlot{ .column_u = 54, .row_u = 14 }, slots.values[674]);
}

test "interactive and procedural opening commands produce identical source hashes" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var interactive = try emptyOwnedArchitectureSource(testing.allocator);
    defer interactive.deinit(testing.allocator);
    var procedural = try emptyOwnedArchitectureSource(testing.allocator);
    defer procedural.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &interactive, &entries, .full, 4, 48);
    try drawOpeningTestWall(testing.allocator, &procedural, &entries, .full, 4, 48);
    const command = openingCommand("same", 1, "base:e:0", "same:o:0", "build:wall:opening:door:test", 24, 3);
    var interactive_result = try mutation.applyCommand(testing.allocator, &interactive, &entries, command);
    defer interactive_result.deinit(testing.allocator);
    var procedural_result = try mutation.applyCommand(testing.allocator, &procedural, &entries, command);
    defer procedural_result.deinit(testing.allocator);
    switch (interactive_result) {
        .rejection => return error.TestUnexpectedResult,
        .receipt => |interactive_receipt| switch (procedural_result) {
            .rejection => return error.TestUnexpectedResult,
            .receipt => |procedural_receipt| try testing.expectEqualStrings(
                interactive_receipt.source_hash_after,
                procedural_receipt.source_hash_after,
            ),
        },
    }
}

test "multiple openings may use disjoint occupied masks inside overlapping envelopes" {
    var sparse_cells = [_]architecture.types.WallCell{.{ .column_u = 0, .row_u = 0 }};
    var sparse_door = validDoorKit();
    sparse_door.measurement.occupied_mask = &sparse_cells;
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), sparse_door };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("first", 1, "base:e:0", "first:o:0", "build:wall:opening:door:test", 20, 0),
    );
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("second", 2, "base:e:0", "second:o:0", "build:wall:opening:door:test", 21, 0),
    );
    try testing.expectEqual(@as(usize, 2), source.walls.edges[0].openings.len);
}

test "opening insertion rejects measured envelope beyond a wall end" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try expectOpeningRejection(
        testing.allocator,
        &source,
        &entries,
        openingCommand("end", 1, "base:e:0", "end:o:0", "build:wall:opening:door:test", 9, 0),
        .opening_out_of_bounds,
    );
}

test "opening insertion rejects occupied mask collision" {
    var occupied_cells = [_]architecture.types.WallCell{.{ .column_u = 0, .row_u = 0 }};
    var door = validDoorKit();
    door.measurement.occupied_mask = &occupied_cells;
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), door };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("first", 1, "base:e:0", "first:o:0", "build:wall:opening:door:test", 20, 0),
    );
    try expectOpeningRejection(
        testing.allocator,
        &source,
        &entries,
        openingCommand("occupied", 2, "base:e:0", "occupied:o:0", "build:wall:opening:door:test", 20, 0),
        .opening_occupied_collision,
    );
}

test "opening insertion rejects clearance mask collision" {
    var occupied_cells = [_]architecture.types.WallCell{.{ .column_u = 0, .row_u = 0 }};
    var clearance_cells = [_]architecture.types.WallCell{.{ .column_u = 2, .row_u = 0 }};
    var door = validDoorKit();
    door.measurement.occupied_mask = &occupied_cells;
    door.measurement.clearance_mask = &clearance_cells;
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), door };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .full, 4, 48);
    try applyExpectedOpeningMutation(
        testing.allocator,
        &source,
        &entries,
        openingCommand("first", 1, "base:e:0", "first:o:0", "build:wall:opening:door:test", 20, 0),
    );
    try expectOpeningRejection(
        testing.allocator,
        &source,
        &entries,
        openingCommand("clearance", 2, "base:e:0", "clearance:o:0", "build:wall:opening:door:test", 22, 0),
        .opening_clearance_collision,
    );
}

test "opening insertion rejects incompatible thickness and profile" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var thick_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer thick_source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &thick_source, &entries, .full, 6, 48);
    try expectOpeningRejection(
        testing.allocator,
        &thick_source,
        &entries,
        openingCommand("thick", 1, "base:e:0", "thick:o:0", "build:wall:opening:door:test", 16, 0),
        .opening_incompatible_thickness,
    );

    var half_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer half_source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &half_source, &entries, .half, 4, 48);
    try expectOpeningRejection(
        testing.allocator,
        &half_source,
        &entries,
        openingCommand("profile", 1, "base:e:0", "profile:o:0", "build:wall:opening:door:test", 16, 0),
        .opening_incompatible_profile,
    );
}

test "opening insertion rejects a measured kit taller than a half wall" {
    var half_profiles = [_]architecture.types.WallProfile{.half};
    var door = validDoorKit();
    door.wall_opening_compatibility.?.permitted_profiles = &half_profiles;
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), door };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &source, &entries, .half, 4, 16);
    try expectOpeningRejection(
        testing.allocator,
        &source,
        &entries,
        openingCommand("height", 1, "base:e:0", "height:o:0", "build:wall:opening:door:test", 16, 0),
        .opening_incompatible_height,
    );
}

fn alternateWallStyle() architecture.CatalogEntry {
    var style = validWallStyle();
    style.catalog_id = @constCast("build:wall:style:alternate");
    style.content_hash = @constCast(HASH_C);
    style.package_id = @constCast("package:alternate-wall-style");
    style.label = @constCast("Alternate Test Wall");
    return style;
}

fn applyExpectedEdgeMutation(
    allocator: std.mem.Allocator,
    source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
    command: mutation.Command,
) !void {
    var result = try mutation.applyCommand(allocator, source, entries, command);
    defer result.deinit(allocator);
    switch (result) {
        .receipt => {},
        .rejection => |rejection| {
            std.debug.print("unexpected edge rejection: {s}\n", .{rejection.detail});
            return error.TestUnexpectedResult;
        },
    }
}

test "edge dimensions set an exact integer absolute base height and thickness" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("wall", 0, 0, 0, 32, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "dimensions",
        .expected_revision = 1,
        .operation = .{ .set_edge_dimensions = .{
            .edge_id = "wall:e:0",
            .support = .{ .absolute = .{ .base_y_u = -16 } },
            .height_u = 64,
            .thickness_u = 6,
        } },
    });
    const edge = findSourceEdge(source, "wall:e:0").?;
    switch (edge.support) {
        .absolute => |support| try testing.expectEqual(@as(architecture.Unit, -16), support.base_y_u),
        .slab => return error.TestUnexpectedResult,
    }
    try testing.expectEqual(@as(architecture.Unit, 64), edge.height_u);
    try testing.expectEqual(@as(architecture.Unit, 6), edge.thickness_u);
}

test "edge profile toggles half and full without replacing its stable ID" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("wall", 0, 0, 0, 32, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "half",
        .expected_revision = 1,
        .operation = .{ .set_profile = .{ .edge_id = "wall:e:0", .profile = .half } },
    });
    try testing.expectEqual(architecture.types.WallProfile.half, findSourceEdge(source, "wall:e:0").?.profile);
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "full",
        .expected_revision = 2,
        .operation = .{ .set_profile = .{ .edge_id = "wall:e:0", .profile = .full } },
    });
    try testing.expectEqual(architecture.types.WallProfile.full, findSourceEdge(source, "wall:e:0").?.profile);
}

test "edge style changes through a typed catalog reference" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), alternateWallStyle() };
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("wall", 0, 0, 0, 32, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "style",
        .expected_revision = 1,
        .operation = .{ .set_style = .{ .edge_id = "wall:e:0", .style_id = "build:wall:style:alternate" } },
    });
    try testing.expectEqualStrings("build:wall:style:alternate", findSourceEdge(source, "wall:e:0").?.style_id);
}

test "edge side A and side B finishes mutate independently" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("wall", 0, 0, 0, 32, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "finish-a",
        .expected_revision = 1,
        .operation = .{ .set_side_finish = .{ .edge_id = "wall:e:0", .side = .a, .material_id = "material:new-a" } },
    });
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "finish-b",
        .expected_revision = 2,
        .operation = .{ .set_side_finish = .{ .edge_id = "wall:e:0", .side = .b, .material_id = "material:new-b" } },
    });
    const edge = findSourceEdge(source, "wall:e:0").?;
    try testing.expectEqualStrings("material:new-a", edge.side_a.material_id);
    try testing.expectEqualStrings("material:new-b", edge.side_b.material_id);
}

test "deleting one edge removes only vertices orphaned by that edge" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("first", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("second", 1, 16, 0, 32, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "delete-first",
        .expected_revision = 2,
        .operation = .{ .delete_edge = .{ .edge_id = "first:e:0" } },
    });
    try testing.expect(findSourceEdge(source, "first:e:0") == null);
    try testing.expect(findSourceVertex(source, "first:v:0") == null);
    try testing.expect(findSourceVertex(source, "first:v:1") != null);
    try testing.expectEqual(@as(usize, 1), source.walls.edges.len);
    try testing.expectEqual(@as(usize, 2), source.walls.vertices.len);
}

test "deleting the final incident edge removes its final vertices" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("wall", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "delete-final",
        .expected_revision = 1,
        .operation = .{ .delete_edge = .{ .edge_id = "wall:e:0" } },
    });
    try testing.expectEqual(@as(usize, 0), source.walls.edges.len);
    try testing.expectEqual(@as(usize, 0), source.walls.vertices.len);
}

test "deleting a vertex cascades every incident edge and newly orphaned vertex" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("first", 0, 0, 0, 16, 0, null, null),
    );
    try applyExpectedDraw(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("second", 1, 16, 0, 32, 0, null, null),
    );
    try applyExpectedEdgeMutation(testing.allocator, &source, &entries, .{
        .command_id = "delete-junction",
        .expected_revision = 2,
        .operation = .{ .delete_vertex = .{ .vertex_id = "first:v:1" } },
    });
    try testing.expectEqual(@as(usize, 0), source.walls.edges.len);
    try testing.expectEqual(@as(usize, 0), source.walls.vertices.len);
}

fn expectReceiptRoundTrip(
    allocator: std.mem.Allocator,
    mutated_source: *architecture.ArchitectureSource,
    patch_source: *architecture.ArchitectureSource,
    entries: []const architecture.CatalogEntry,
    command: mutation.Command,
) !void {
    const revision_before = patch_source.revision;
    var mutation_result = try mutation.applyCommand(allocator, mutated_source, entries, command);
    defer mutation_result.deinit(allocator);
    switch (mutation_result) {
        .rejection => |rejection| {
            std.debug.print("round-trip setup rejected: {s}\n", .{rejection.detail});
            return error.TestUnexpectedResult;
        },
        .receipt => |*receipt| {
            var forward_result = try mutation.applyCommand(allocator, patch_source, entries, .{
                .command_id = "round-trip:forward",
                .expected_revision = receipt.forward_patch.expected_revision,
                .operation = .{ .apply_patch = &receipt.forward_patch },
            });
            defer forward_result.deinit(allocator);
            switch (forward_result) {
                .rejection => |rejection| {
                    std.debug.print("forward patch rejected: {s}\n", .{rejection.detail});
                    return error.TestUnexpectedResult;
                },
                .receipt => {},
            }

            var inverse_result = try mutation.applyCommand(allocator, patch_source, entries, .{
                .command_id = "round-trip:inverse",
                .expected_revision = receipt.inverse_patch.expected_revision,
                .operation = .{ .apply_patch = &receipt.inverse_patch },
            });
            defer inverse_result.deinit(allocator);
            switch (inverse_result) {
                .rejection => |rejection| {
                    std.debug.print("inverse patch rejected: {s}\n", .{rejection.detail});
                    return error.TestUnexpectedResult;
                },
                .receipt => |inverse_receipt| {
                    try testing.expectEqual(revision_before, patch_source.revision);
                    try testing.expectEqualStrings(receipt.source_hash_before, inverse_receipt.source_hash_after);
                },
            }
        },
    }
}

test "draw receipt forward and inverse patches restore source identity" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try expectReceiptRoundTrip(
        testing.allocator,
        &mutated_source,
        &patch_source,
        &entries,
        drawWallCommand("round-trip-draw", 0, 0, 0, 32, 16, null, null),
    );
}

test "split receipt forward and inverse patches restore predecessor topology" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try applyExpectedDraw(testing.allocator, &mutated_source, &entries, drawWallCommand("base", 0, 0, 0, 64, 0, null, null));
    try applyExpectedDraw(testing.allocator, &patch_source, &entries, drawWallCommand("base", 0, 0, 0, 64, 0, null, null));
    try expectReceiptRoundTrip(
        testing.allocator,
        &mutated_source,
        &patch_source,
        &entries,
        drawWallCommand("round-trip-split", 1, 32, -16, 32, 16, null, null),
    );
}

test "opening receipt forward and inverse patches restore edge bytes" {
    var entries = [_]architecture.CatalogEntry{ validWallStyle(), validDoorKit() };
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try drawOpeningTestWall(testing.allocator, &mutated_source, &entries, .full, 4, 48);
    try drawOpeningTestWall(testing.allocator, &patch_source, &entries, .full, 4, 48);
    try expectReceiptRoundTrip(
        testing.allocator,
        &mutated_source,
        &patch_source,
        &entries,
        openingCommand("round-trip-opening", 1, "base:e:0", "round-trip-opening:o:0", "build:wall:opening:door:test", 16, 0),
    );
}

test "edge edit receipt forward and inverse patches restore edge bytes" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try applyExpectedDraw(testing.allocator, &mutated_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try applyExpectedDraw(testing.allocator, &patch_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try expectReceiptRoundTrip(testing.allocator, &mutated_source, &patch_source, &entries, .{
        .command_id = "round-trip-edge-edit",
        .expected_revision = 1,
        .operation = .{ .set_side_finish = .{
            .edge_id = "wall:e:0",
            .side = .a,
            .material_id = "material:round-trip",
        } },
    });
}

test "deletion receipt forward and inverse patches restore removed records" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try applyExpectedDraw(testing.allocator, &mutated_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try applyExpectedDraw(testing.allocator, &patch_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try expectReceiptRoundTrip(testing.allocator, &mutated_source, &patch_source, &entries, .{
        .command_id = "round-trip-delete",
        .expected_revision = 1,
        .operation = .{ .delete_edge = .{ .edge_id = "wall:e:0" } },
    });
}

test "anchor attach receipt forward and inverse patches restore source identity" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try applyExpectedDraw(testing.allocator, &mutated_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try applyExpectedDraw(testing.allocator, &patch_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try expectReceiptRoundTrip(testing.allocator, &mutated_source, &patch_source, &entries, .{
        .command_id = "round-trip-anchor",
        .expected_revision = 1,
        .operation = .{ .attach_anchor = .{
            .edge_id = "wall:e:0",
            .side = .b,
            .column_u = 16,
            .row_u = 12,
            .target_piece_id = "prop:wall:round-trip",
        } },
    });
}

test "anchor detach receipt forward and inverse patches restore source identity" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var mutated_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer mutated_source.deinit(testing.allocator);
    var patch_source = try emptyOwnedArchitectureSource(testing.allocator);
    defer patch_source.deinit(testing.allocator);
    try applyExpectedDraw(testing.allocator, &mutated_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try applyExpectedDraw(testing.allocator, &patch_source, &entries, drawWallCommand("wall", 0, 0, 0, 32, 0, null, null));
    try installAnchorFixtures(testing.allocator, &mutated_source, "wall:e:0", &.{.{ .id = "anchor", .column_u = 16 }});
    try installAnchorFixtures(testing.allocator, &patch_source, "wall:e:0", &.{.{ .id = "anchor", .column_u = 16 }});
    try expectReceiptRoundTrip(testing.allocator, &mutated_source, &patch_source, &entries, .{
        .command_id = "round-trip-detach",
        .expected_revision = 1,
        .operation = .{ .detach_anchor = .{ .anchor_id = "anchor" } },
    });
}

test "facade applies a valid wall command through its owned candidate" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    var result = try architecture.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("facade-wall", 0, 0, 0, 32, 0, null, null),
    );
    defer result.deinit(testing.allocator);
    switch (result) {
        .rejection => return error.TestUnexpectedResult,
        .receipt => |receipt| {
            try testing.expectEqual(@as(u32, 1), receipt.source_revision_after);
            try testing.expectEqual(@as(usize, 1), source.walls.edges.len);
        },
    }
}

test "facade discards a structurally valid patch whose candidate topology is invalid" {
    var entries = [_]architecture.CatalogEntry{validWallStyle()};
    var source = try emptyOwnedArchitectureSource(testing.allocator);
    defer source.deinit(testing.allocator);
    var draw_result = try architecture.applyCommand(
        testing.allocator,
        &source,
        &entries,
        drawWallCommand("facade-base", 0, 0, 0, 32, 0, null, null),
    );
    draw_result.deinit(testing.allocator);

    var no_openings = [_]architecture.types.WallOpening{};
    const duplicate_edge = architecture.types.WallEdge{
        .id = @constCast("facade-duplicate:e:0"),
        .start_vertex_id = @constCast("facade-base:v:0"),
        .end_vertex_id = @constCast("facade-base:v:1"),
        .support = .{ .absolute = .{ .base_y_u = 0 } },
        .height_u = 48,
        .thickness_u = 4,
        .profile = .full,
        .style_id = @constCast("build:wall:style:test"),
        .side_a = .{ .material_id = @constCast("material:plaster") },
        .side_b = .{ .material_id = @constCast("material:plaster") },
        .openings = &no_openings,
    };
    const canonical_bytes = try architecture.types.canonicalEdgeRecordBytes(testing.allocator, &duplicate_edge);
    defer testing.allocator.free(canonical_bytes);
    var operations = [_]architecture.types.PatchOperation{.{ .insert = .{
        .family = .edge,
        .id = @constCast("facade-duplicate:e:0"),
        .canonical_bytes = canonical_bytes,
    } }};
    const patch = architecture.types.ArchitecturePatch{
        .expected_revision = 1,
        .result_revision = 2,
        .operations = &operations,
    };
    try testing.expectError(error.topology_invalid, architecture.applyCommand(
        testing.allocator,
        &source,
        &entries,
        .{
            .command_id = "facade-invalid-topology",
            .expected_revision = 1,
            .operation = .{ .apply_patch = &patch },
        },
    ));
    try testing.expectEqual(@as(u32, 1), source.revision);
    try testing.expectEqual(@as(usize, 1), source.walls.edges.len);
    try testing.expect(findSourceEdge(source, "facade-duplicate:e:0") == null);
}
