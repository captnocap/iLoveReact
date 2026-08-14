//! Focused native contract tests for semantic building architecture.
//! Run: zig build test-building-architecture -Doptimize=ReleaseFast

const std = @import("std");
const testing = std.testing;
const architecture = @import("building_architecture");
const topology = @import("wall_topology");

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
        wallVertex("a0", 0, 0), wallVertex("a1", 16, 0),
        wallVertex("a2", 16, 16), wallVertex("a3", 0, 16),
        wallVertex("b0", 32, 0), wallVertex("b1", 48, 0),
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
        wallVertex("o0", 0, 0), wallVertex("o1", 32, 0),
        wallVertex("o2", 32, 32), wallVertex("o3", 0, 32),
        wallVertex("i0", 8, 8), wallVertex("i1", 24, 8),
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
        wallVertex("v0", 0, 0), wallVertex("v1", 16, 0),
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
        wallVertex("v0", 0, 0), wallVertex("v1", 16, 0),
        wallVertex("v2", 32, 0), wallVertex("v3", 32, 16),
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
        wallVertex("v5", 0, 16), wallVertex("v4", 16, 16),
        wallVertex("v3", 32, 16), wallVertex("v2", 32, 0),
        wallVertex("v1", 16, 0), wallVertex("v0", 0, 0),
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
        wallVertex("v0", 0, 0), wallVertex("v4", 16, 16),
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
        wallVertex("v5", 0, 16), wallVertex("v2", 32, 0),
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
        wallVertex("left", 0, 0), wallVertex("right", 32, 0),
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
        wallVertex("v0", 0, 0), wallVertex("v1", 16, 0),
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
