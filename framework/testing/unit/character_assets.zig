//! Strict saved-character runtime loader regressions.
//! Run: zig build test-character-assets -Doptimize=ReleaseFast

const std = @import("std");
const testing = std.testing;
const character_assets = @import("character_assets");
const sk = character_assets.schema;
const humanoid = character_assets.canonical_humanoid;

const HASH = "0000000000000000000000000000000000000000000000000000000000000000";

const FixtureMode = enum {
    draft,
    needs_bind,
    bound_missing_binding,
    bound_stale_hashes,
};

fn quote(writer: *std.Io.Writer, value: []const u8) !void {
    try writer.writeByte('"');
    for (value) |byte| switch (byte) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11, 12, 14...31 => try writer.print("\\u{x:0>4}", .{byte}),
        else => try writer.writeByte(byte),
    };
    try writer.writeByte('"');
}

fn vec3(writer: *std.Io.Writer, value: sk.Vec3) !void {
    try writer.print("[{d},{d},{d}]", .{ value[0], value[1], value[2] });
}

fn quat(writer: *std.Io.Writer, value: sk.Quat) !void {
    try writer.print("[{d},{d},{d},{d}]", .{ value[0], value[1], value[2], value[3] });
}

fn joint(writer: *std.Io.Writer, value: sk.Joint) !void {
    try writer.writeAll("{\"kind\":");
    try quote(writer, @tagName(value.kind));
    switch (value.kind) {
        .fixed => {},
        .ball => try writer.print(
            ",\"swingX\":{{\"min\":{d},\"max\":{d}}},\"swingZ\":{{\"min\":{d},\"max\":{d}}},\"twistY\":{{\"min\":{d},\"max\":{d}}}",
            .{ value.swing_x.?.min, value.swing_x.?.max, value.swing_z.?.min, value.swing_z.?.max, value.twist_y.?.min, value.twist_y.?.max },
        ),
        else => {
            try writer.writeAll(",\"axis\":");
            try vec3(writer, value.axis.?);
            if (value.limit_min != null and value.limit_max != null) {
                try writer.print(",\"limits\":{{\"min\":{d},\"max\":{d}}}", .{ value.limit_min.?, value.limit_max.? });
            }
        },
    }
    try writer.writeByte('}');
}

fn skeletonJson(allocator: std.mem.Allocator, mode: FixtureMode) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    const writer = &output.writer;
    try writer.writeAll("{\"id\":\"runtime-character\",\"bones\":[");
    for (humanoid.HUMANOID_V1_BONES, 0..) |bone, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try quote(writer, bone.id);
        try writer.writeAll(",\"displayName\":");
        try quote(writer, bone.display_name orelse bone.id);
        try writer.writeAll(",\"parent\":");
        if (bone.parent) |parent| try quote(writer, parent) else try writer.writeAll("null");
        try writer.writeAll(",\"transform\":{\"pos\":");
        try vec3(writer, bone.transform.pos);
        try writer.writeAll(",\"rot\":");
        try quat(writer, bone.transform.rot);
        try writer.writeAll(",\"scale\":");
        try vec3(writer, bone.transform.scale);
        try writer.writeByte('}');
        if (bone.tip) |tip| {
            try writer.writeAll(",\"tip\":");
            try vec3(writer, tip);
        }
        if (bone.joint) |joint_value| {
            try writer.writeAll(",\"joint\":");
            try joint(writer, joint_value);
        }
        try writer.writeByte('}');
    }
    try writer.writeAll("],\"meshes\":{\"kind\":\"skinned\",\"geometryPath\":\"mesh/character-fixture.rjmd\"");
    if (mode == .bound_stale_hashes) {
        try writer.writeAll(",\"binding\":{\"path\":\"mesh/skin-fixture.rjsk\",\"format\":\"RJSK\",\"version\":1,\"artifactHash\":");
        try quote(writer, HASH);
        try writer.writeAll(",\"topologyHash\":");
        try quote(writer, HASH);
        try writer.writeAll(",\"semanticHash\":");
        try quote(writer, HASH);
        try writer.writeAll(",\"skeletonHash\":");
        try quote(writer, HASH);
        try writer.writeAll(",\"objectBindingHash\":");
        try quote(writer, HASH);
        try writer.writeAll(",\"logicalVertexCount\":3,\"maxInfluences\":4}");
    }
    const state = switch (mode) {
        .draft => "draft",
        .needs_bind => "needs_bind",
        .bound_missing_binding, .bound_stale_hashes => "bound",
    };
    try writer.writeAll("},\"characterRig\":{\"version\":1,\"state\":");
    try quote(writer, state);
    try writer.writeAll(",\"semanticBindings\":[");
    for (humanoid.HUMANOID_V1_SEMANTIC_BINDINGS, 0..) |binding, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"role\":");
        try quote(writer, @tagName(binding.role));
        if (binding.side) |side| {
            try writer.writeAll(",\"side\":");
            try quote(writer, @tagName(side));
        }
        try writer.writeAll(",\"boneId\":");
        try quote(writer, binding.bone_id);
        try writer.writeByte('}');
    }
    try writer.writeAll("],\"objectBindings\":[{\"objectId\":\"body-object\",\"mode\":\"body\"}],\"fit\":{");
    for (humanoid.HUMANOID_V1_BONE_IDS, 0..) |bone_id, index| {
        if (index != 0) try writer.writeByte(',');
        try quote(writer, bone_id);
        try writer.writeAll(":{\"source\":\"template\",\"confidence\":0.5,\"locked\":false}");
    }
    try writer.writeAll("},\"shapeHash\":");
    try quote(writer, if (mode == .bound_missing_binding or mode == .bound_stale_hashes) HASH else "");
    try writer.writeAll("}}");
    return allocator.dupe(u8, output.written());
}

fn geometryBytes(allocator: std.mem.Allocator) ![]u8 {
    var verts = [_]f32{
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
    };
    var groups = [_]u32{0};
    var semantics = [_]u32{0};
    var instances = [_]u32{0};
    var logical = [_]u32{ 0, 1, 2 };
    var dense_to_stable = [_]u32{ 0, 1, 2 };
    var semantic_json = "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"Chest\",\"role\":\"chest\"}]}".*;
    const snapshot = character_assets.MeshDocSnapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = &semantics,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 3,
        .dense_to_stable_logical_ids = &dense_to_stable,
        .semantic_table_json = &semantic_json,
        .glass_first_vertex = 3,
    };
    return character_assets.encodeGeometryWithRangeObjectIds(
        allocator,
        &snapshot,
        &.{ 0, 1 },
        &.{"body-object"},
    );
}

test "runtime refuses draft and needs-bind character declarations" {
    const geometry = try geometryBytes(testing.allocator);
    defer testing.allocator.free(geometry);
    inline for (.{ FixtureMode.draft, FixtureMode.needs_bind }) |mode| {
        const json = try skeletonJson(testing.allocator, mode);
        defer testing.allocator.free(json);
        try testing.expectError(error.CharacterNotBound, character_assets.loadBytes(
            testing.allocator,
            geometry,
            &.{},
            json,
        ));
    }
}

test "runtime refuses a bound declaration with no saved skin binding" {
    const geometry = try geometryBytes(testing.allocator);
    defer testing.allocator.free(geometry);
    const json = try skeletonJson(testing.allocator, .bound_missing_binding);
    defer testing.allocator.free(json);
    try testing.expectError(error.CharacterSkeletonRejected, character_assets.loadBytes(
        testing.allocator,
        geometry,
        &.{},
        json,
    ));
}

test "runtime refuses hashes stale against persisted RJMD topology" {
    const geometry = try geometryBytes(testing.allocator);
    defer testing.allocator.free(geometry);
    const json = try skeletonJson(testing.allocator, .bound_stale_hashes);
    defer testing.allocator.free(json);
    try testing.expectError(error.StaleSkinBinding, character_assets.loadBytes(
        testing.allocator,
        geometry,
        &.{},
        json,
    ));
}

test "persisted range ids cover descriptor bindings independent of descriptor order" {
    const bindings = [_]sk.CharacterObjectBinding{
        .{ .rigid = .{ .object_id = "hat-object", .bone_id = "head" } },
        .{ .body = "body-object" },
    };
    try testing.expect(character_assets.objectBindingsCoverRangeIds(&bindings, &.{ "body-object", "hat-object" }));
    try testing.expect(!character_assets.objectBindingsCoverRangeIds(&bindings, &.{ "body-object", "body-object" }));
    try testing.expect(!character_assets.objectBindingsCoverRangeIds(&bindings, &.{ "body-object", "range-rank-1" }));
}

test "runtime loader source has no automatic-weight solver import or call" {
    const source = character_assets.runtime_loader_source;
    try testing.expect(std.mem.indexOf(u8, source, "autoweights") == null);
    try testing.expect(std.mem.indexOf(u8, source, "solveWeights") == null);
    try testing.expect(std.mem.indexOf(u8, source, "autoBind") == null);
    try testing.expect(std.mem.indexOf(u8, source, "RJIT_SKIN_SOLVE") == null);
}

test "the skeleton solves its own facing from left/right anatomy (req_4291)" {
    // Identity-rotation matrices with translations only: the facing solver
    // reads bind-global origins, nothing else.
    const at = struct {
        fn origin(x: f32, y: f32, z: f32) character_assets.rig_pose.Mat4 {
            var m: character_assets.rig_pose.Mat4 = .{
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            };
            m[12] = x;
            m[13] = y;
            m[14] = z;
            return m;
        }
    };

    // Canonical orientation: left at -X → forward -Z → zero offset.
    {
        const ids = [_][]const u8{ "upper_arm_left", "upper_arm_right", "pelvis" };
        const globals = [_]character_assets.rig_pose.Mat4{
            at.origin(-0.2, 1.4, 0),
            at.origin(0.2, 1.4, 0),
            at.origin(0, 1.0, 0),
        };
        try std.testing.expectApproxEqAbs(
            @as(f32, 0),
            character_assets.facingYawOffsetDegrees(&ids, &globals),
            0.01,
        );
    }
    // Mirrored authoring: left at +X → forward +Z → half-turn offset.
    {
        const ids = [_][]const u8{ "upper_arm_left", "upper_arm_right", "upper_leg_left", "upper_leg_right" };
        const globals = [_]character_assets.rig_pose.Mat4{
            at.origin(0.2, 1.4, 0),
            at.origin(-0.2, 1.4, 0),
            at.origin(0.1, 0.9, 0),
            at.origin(-0.1, 0.9, 0),
        };
        try std.testing.expectApproxEqAbs(
            @as(f32, 180),
            @abs(character_assets.facingYawOffsetDegrees(&ids, &globals)),
            0.01,
        );
    }
    // No side pairs (a prop): faces canonically by definition.
    {
        const ids = [_][]const u8{ "pelvis", "head" };
        const globals = [_]character_assets.rig_pose.Mat4{ at.origin(0, 1, 0), at.origin(0, 1.6, 0) };
        try std.testing.expectApproxEqAbs(
            @as(f32, 0),
            character_assets.facingYawOffsetDegrees(&ids, &globals),
            0.01,
        );
    }
}
