//! flora_dump — export every flora mesh as an editor model package (req_2993).
//!
//! The flora the world renders is a handful of shared meshes: the unit-space
//! instanced cards (grass blade, flower head, bush clump, palm frond, palm
//! trunk) plus the nine whole-plant wrapped species. They exist only inside the
//! engine; this tool materializes each one as a content-browser model package
//! (manifest.json + mesh/base.blob, the same interleaved 8-f32/vert layout the
//! studio's __model_mesh_write emits) so they can be inspected — and eventually
//! authored against — like any other model. Re-running overwrites in place:
//! the packages are pure derivations of the engine generators.
//!
//! Build + run from the repo root:
//!   zig build flora-dump && ./zig-out/bin/flora_dump

const std = @import("std");
// standalone module root: cannot import framework/host_io.zig; same process-wide instance
fn hio() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}
const flora_geometry = @import("flora_geometry");
const geometry = @import("loader_geometry");

const PROPS_HOME = "cart/editor/data/models/props";
const SUBDIRS = [_][]const u8{ "mesh", "atlases", "paints", "shaders" };

const Shape = struct {
    /// package dir leaf AND manifest name (name-first dirs, req_2735)
    name: []const u8,
    /// durable model id
    id: []const u8,
    /// browser swatch — mirrors the paint legend color for the kind
    color: []const u8,
    verts: []const f32,
};

fn writePackage(shape: Shape) !void {
    var path_buf: [256]u8 = undefined;
    const cwd = std.Io.Dir.cwd();

    for (SUBDIRS) |sub| {
        const dir_path = try std.fmt.bufPrint(&path_buf, "{s}/{s}/{s}", .{ PROPS_HOME, shape.name, sub });
        try cwd.createDirPath(hio(), dir_path);
    }

    const blob_path = try std.fmt.bufPrint(&path_buf, "{s}/{s}/mesh/base.blob", .{ PROPS_HOME, shape.name });
    const blob = try cwd.createFile(blob_path, .{});
    defer blob.close();
    try blob.writeAll(std.mem.sliceAsBytes(shape.verts));

    // The manifest is the commit point (same order the editor store uses):
    // blob first, manifest last, so an interrupted run never advertises a
    // partial package. mesh stays {} — the meshdoc reader's base.blob
    // fallback is the intended read path for a generator-derived package.
    var manifest_buf: [1024]u8 = undefined;
    const triangles = shape.verts.len / 8 / 3;
    const manifest = try std.fmt.bufPrint(&manifest_buf,
        \\{{
        \\  "version": 1,
        \\  "id": "{s}",
        \\  "name": "{s}",
        \\  "kind": "prop",
        \\  "stage": "wip",
        \\  "folderId": "props",
        \\  "semanticKind": "flora",
        \\  "sourceKind": "cooked-asset",
        \\  "color": "{s}",
        \\  "rig": "-",
        \\  "data": "-",
        \\  "triangles": {d},
        \\  "lods": 1,
        \\  "mesh": {{}},
        \\  "decompositions": [],
        \\  "atlases": [],
        \\  "paints": []
        \\}}
        \\
    , .{ shape.id, shape.name, shape.color, triangles });
    const manifest_path = try std.fmt.bufPrint(&path_buf, "{s}/{s}/manifest.json", .{ PROPS_HOME, shape.name });
    const file = try cwd.createFile(manifest_path, .{});
    defer file.close();
    try file.writeAll(manifest);

    std.debug.print("  {s}: {d} verts ({d} tris) -> {s}/{s}\n", .{ shape.name, shape.verts.len / 8, triangles, PROPS_HOME, shape.name });
}

pub fn main() !void {
    // Unit-space instanced cards — the per-instance transform gives them their
    // world size, so what you see here is the raw 1-unit-tall silhouette.
    const grass_blade = geometry.buildGrassBlade();
    const flower_head = geometry.buildFlowerHead();
    const bush_clump = geometry.buildBushClump();
    const palm_frond = geometry.buildFrond();
    const palm_trunk = geometry.buildPalmTrunk();

    // Whole-plant wrapped species, in WrappedSpecies order (flora_geometry).
    var wrapped: [flora_geometry.recipe.WRAPPED_SPECIES_COUNT]flora_geometry.WrappedMesh = undefined;
    for (&wrapped, 0..) |*mesh, i| mesh.* = flora_geometry.buildWrappedByIndex(i).?;

    const shapes = [_]Shape{
        .{ .name = "flora_grass_blade", .id = "flora:grass-blade", .color = "#4f8a34", .verts = grass_blade[0..] },
        .{ .name = "flora_flower_head", .id = "flora:flower-head", .color = "#d77ab6", .verts = flower_head[0..] },
        .{ .name = "flora_bush_clump", .id = "flora:bush-clump", .color = "#356326", .verts = bush_clump[0..] },
        .{ .name = "flora_palm_frond", .id = "flora:palm-frond", .color = "#2f6b3a", .verts = palm_frond[0..] },
        .{ .name = "flora_palm_trunk", .id = "flora:palm-trunk", .color = "#7a5a3a", .verts = palm_trunk[0..] },
        .{ .name = "flora_pine", .id = "flora:pine", .color = "#245d35", .verts = wrapped[0].constFloats() },
        .{ .name = "flora_maple", .id = "flora:maple", .color = "#4f7f32", .verts = wrapped[1].constFloats() },
        .{ .name = "flora_oak", .id = "flora:oak", .color = "#3f6c2b", .verts = wrapped[2].constFloats() },
        .{ .name = "flora_cedar", .id = "flora:cedar", .color = "#1f5b4a", .verts = wrapped[3].constFloats() },
        .{ .name = "flora_spruce", .id = "flora:spruce", .color = "#1c5144", .verts = wrapped[4].constFloats() },
        .{ .name = "flora_hydrangea_mophead", .id = "flora:hydrangea-mophead", .color = "#b94fa9", .verts = wrapped[5].constFloats() },
        .{ .name = "flora_hydrangea_panicle", .id = "flora:hydrangea-panicle", .color = "#e8b5b1", .verts = wrapped[6].constFloats() },
        .{ .name = "flora_leafy_thicket", .id = "flora:leafy-thicket", .color = "#245b2e", .verts = wrapped[7].constFloats() },
        .{ .name = "flora_wild_weed", .id = "flora:wild-weed", .color = "#39723b", .verts = wrapped[8].constFloats() },
    };

    std.debug.print("flora_dump: exporting {d} flora meshes as model packages\n", .{shapes.len});
    for (shapes) |shape| try writePackage(shape);
    std.debug.print("flora_dump: done\n", .{});
}
