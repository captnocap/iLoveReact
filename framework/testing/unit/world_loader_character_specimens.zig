//! Dual bind/deformed character node, placement, and ownership cutover tests.
//! Run: zig build test-world-loader -Doptimize=ReleaseFast

const std = @import("std");
const testing = std.testing;
const specimens = @import("world_loader_character_specimens");

fn functionSlice(source: []const u8, start_marker: []const u8, end_marker: []const u8) ![]const u8 {
    const start = std.mem.indexOf(u8, source, start_marker) orelse return error.MissingFunctionStart;
    const end_relative = std.mem.indexOf(u8, source[start + start_marker.len ..], end_marker) orelse
        return error.MissingFunctionEnd;
    return source[start .. start + start_marker.len + end_relative];
}

fn expectOrdered(source: []const u8, needles: []const []const u8) !void {
    var cursor: usize = 0;
    for (needles) |needle| {
        const relative = std.mem.indexOf(u8, source[cursor..], needle) orelse return error.MissingOrderedToken;
        cursor += relative + needle.len;
    }
}

test "normal player mount is one centered deformed node" {
    const skin_vertices = [_]f32{0} ** 16;
    const palette = [_]f32{1} ** 20;
    var nodes = [_]specimens.Node{ .{}, .{} };
    try specimens.configureSinglePlayerCharacter(&nodes, 0, .{
        .geometry_key = "normal-player",
        .vertices = &skin_vertices,
        .vertex_count = 1,
        .palette = &palette,
        .bone_count = 1,
    });
    const player = specimens.PlayerState{
        .x = 7,
        .y = 2,
        .z = -3,
        .yaw = 0.25,
    };
    specimens.placeSinglePlayerCharacter(&nodes, 0, player, 0);

    try testing.expectEqual(player.x, nodes[0].scene3d_pos_x);
    try testing.expectEqual(player.y, nodes[0].scene3d_pos_y);
    try testing.expectEqual(player.z, nodes[0].scene3d_pos_z);
    try testing.expect(nodes[0].scene3d_skin_vertices != null);
    try testing.expect(nodes[0].scene3d_skin_palette != null);
    try testing.expect(!nodes[1].scene3d_mesh);
    try testing.expect(nodes[1].scene3d_vertices == null);
    try testing.expect(nodes[1].scene3d_skin_vertices == null);
    try testing.expect(nodes[1].scene3d_skin_palette == null);
}

test "capture specimens have a stable origin anchor" {
    const anchor = specimens.characterDiagnosticAnchor();
    try testing.expectEqual(@as(f32, 0), anchor.x);
    try testing.expectEqual(@as(f32, 0), anchor.y);
    try testing.expectEqual(@as(f32, 0), anchor.z);
    try testing.expectEqual(@as(f32, 0), anchor.yaw);
}

test "native diagnostic camera contains a tall narrow side by side pair" {
    var camera = specimens.CameraState{
        .yaw_degrees = 0,
        .pitch_degrees = 0,
        .far = 64,
    };
    const bounds_min = [3]f32{ -1, 0, -0.25 };
    const bounds_max = [3]f32{ 1, 2, 0.25 };
    const separation: f32 = 2.5;
    const aspect: f32 = 0.55;

    try testing.expect(specimens.frameCharacterDiagnostic(
        &camera,
        bounds_min,
        bounds_max,
        separation,
        aspect,
    ));
    try testing.expect(camera.external);
    try testing.expectEqual(@as(f32, 0), camera.ext_look.x);
    try testing.expectEqual(@as(f32, 1), camera.ext_look.y);
    try testing.expectEqual(@as(f32, 0), camera.ext_look.z);
    try testing.expectEqual(camera.ext_look.x, camera.ext_pos.x);
    try testing.expectEqual(camera.ext_look.y, camera.ext_pos.y);
    try testing.expect(camera.ext_pos.z < camera.ext_look.z);

    const eye_distance = camera.ext_look.z - camera.ext_pos.z;
    const tan_half_fov = @tan(camera.ext_fov * std.math.pi / 360.0);
    const projected_half_width = eye_distance * tan_half_fov * aspect;
    try testing.expect(projected_half_width > (bounds_max[0] - bounds_min[0] + separation) * 0.5);
}

test "dual character nodes keep bind static and place both around one midpoint" {
    var skin_vertices = [_]f32{0} ** 32;
    skin_vertices[0] = -2;
    skin_vertices[16] = 3;
    const palette = [_]f32{1} ** 20;
    var bind = try specimens.extractBindSpecimen(testing.allocator, &skin_vertices, 2);
    defer bind.deinit();
    var nodes = [_]specimens.Node{ .{}, .{} };

    try specimens.configurePlayerCharacterSpecimens(
        &nodes,
        0,
        1,
        .{
            .geometry_key = "deformed-key",
            .vertices = &skin_vertices,
            .vertex_count = 2,
            .palette = &palette,
            .bone_count = 1,
        },
        .{
            .geometry_key = "bind-key",
            .vertices = bind.vertices,
            .vertex_count = bind.vertex_count,
        },
    );

    try testing.expect(nodes[0].scene3d_skin_vertices != null);
    try testing.expect(nodes[0].scene3d_skin_palette != null);
    try testing.expect(nodes[0].scene3d_vertices == null);
    try testing.expect(!nodes[0].scene3d_mesh);

    try testing.expect(nodes[1].scene3d_mesh);
    try testing.expect(nodes[1].scene3d_vertices != null);
    try testing.expectEqual(@as(u32, 2), nodes[1].scene3d_vert_count);
    try testing.expect(nodes[1].scene3d_skin_geom_key == null);
    try testing.expect(nodes[1].scene3d_skin_vertices == null);
    try testing.expect(nodes[1].scene3d_skin_palette == null);
    try testing.expectEqual(@as(u32, 0), nodes[1].scene3d_skin_vert_count);
    try testing.expectEqual(@as(u32, 0), nodes[1].scene3d_skin_bone_count);

    const player = specimens.PlayerState{
        .x = 10,
        .y = 2,
        .z = -4,
        .yaw = @as(f32, std.math.pi) / 2.0,
    };
    specimens.placePlayerCharacterSpecimens(&nodes, 0, 1, player, bind.separation_x, 0);
    try testing.expectEqual(@as(f32, 6.25), bind.separation_x);
    try testing.expectEqual(@as(f32, 6.875), nodes[1].scene3d_pos_x);
    try testing.expectEqual(@as(f32, 13.125), nodes[0].scene3d_pos_x);
    for (nodes) |node| {
        try testing.expectEqual(player.y, node.scene3d_pos_y);
        try testing.expectEqual(player.z, node.scene3d_pos_z);
        try testing.expectApproxEqAbs(@as(f32, 270), node.scene3d_rot_y, 1.0e-4);
        try testing.expectEqual(@as(f32, 1), node.scene3d_scale_x);
        try testing.expectEqual(@as(f32, 1), node.scene3d_scale_y);
        try testing.expectEqual(@as(f32, 1), node.scene3d_scale_z);
    }

    try testing.expect(specimens.disablePlayerCharacterSpecimens(&nodes, 0, 1));
    try testing.expect(nodes[0].scene3d_skin_vertices == null);
    try testing.expect(nodes[0].scene3d_skin_palette == null);
    try testing.expect(nodes[1].scene3d_vertices == null);
    try testing.expect(!nodes[1].scene3d_mesh);
}

test "invalid dual-node configuration is non-mutating" {
    const skin_vertices = [_]f32{0} ** 16;
    const palette = [_]f32{1} ** 20;
    const bind_vertices = [_]f32{0} ** 8;
    var nodes = [_]specimens.Node{ .{
        .scene3d_geom_key = "sentinel-left",
        .scene3d_color_r = 0.25,
    }, .{
        .scene3d_geom_key = "sentinel-right",
        .scene3d_color_r = 0.75,
    } };
    const skinned = specimens.SkinnedSpecimenView{
        .geometry_key = "deformed-key",
        .vertices = &skin_vertices,
        .vertex_count = 1,
        .palette = &palette,
        .bone_count = 1,
    };
    const bind = specimens.StaticSpecimenView{
        .geometry_key = "bind-key",
        .vertices = &bind_vertices,
        .vertex_count = 1,
    };

    try testing.expectError(
        error.AliasedSpecimenNodes,
        specimens.configurePlayerCharacterSpecimens(&nodes, 0, 0, skinned, bind),
    );
    try testing.expectError(
        error.NodeUnavailable,
        specimens.configurePlayerCharacterSpecimens(&nodes, 0, 2, skinned, bind),
    );
    try testing.expect(std.mem.eql(u8, nodes[0].scene3d_geom_key.?, "sentinel-left"));
    try testing.expect(std.mem.eql(u8, nodes[1].scene3d_geom_key.?, "sentinel-right"));
    try testing.expectEqual(@as(f32, 0.25), nodes[0].scene3d_color_r);
    try testing.expectEqual(@as(f32, 0.75), nodes[1].scene3d_color_r);
}

test "capture activation prepares both artifacts before one owner cutover" {
    const activation = try functionSlice(
        specimens.mounted_door_source,
        "pub fn activateMountedPlayerCharacterTarget",
        "pub fn publishMountedPlayerCharacterPose",
    );
    try expectOrdered(activation, &.{
        "ensureUnusedCapacity(runtime.allocator, 2)",
        "character_specimen.extractBindSpecimen",
        "player-character-bind-",
        "configurePlayerCharacterNodes(",
        "runtime.player_target_candidate = null",
        "runtime.player_bind_specimen = next_bind",
        "runtime.player_target_camera_aspect = null",
        "appendAssumeCapacity(skin_geometry_key)",
        "appendAssumeCapacity(bind_geometry_key)",
        "character_animation.characterDiagnosticAnchor()",
        "if (previous) |old| old.deinit()",
        "if (previous_bind) |*old_bind| old_bind.deinit()",
    });
    try testing.expect(std.mem.indexOf(u8, activation, "character_assets.loadFiles") == null);
    try testing.expectEqual(@as(usize, 2), std.mem.count(u8, activation, "appendAssumeCapacity("));
}

test "late owner close cannot sever either specimen and teardown frees bind ownership" {
    const close = try functionSlice(
        specimens.mounted_door_source,
        "pub fn closeMountedPlayerCharacterTarget",
        "pub fn setMountedPlayerCharacterPoseBytes",
    );
    try expectOrdered(close, &.{
        "if (!runtime.player_target_active_owner.matches(owner_id)) return",
        "if (!disablePlayerCharacterNodes(runtime)) return",
        "runtime.player_character_pose.clear(owner_id)",
        "runtime.player_target_camera_aspect = null",
        "runtime.camera.external = false",
        "if (runtime.player_bind_specimen) |*bind| bind.deinit()",
        "runtime.player_bind_specimen = null",
        "if (runtime.scene.player_character) |character| character.deinit()",
        "runtime.scene.player_character = null",
        "runtime.player_character_pose.resetEmpty()",
    });
    try expectOrdered(specimens.runtime_lifecycle_source, &.{
        "if (self.player_bind_specimen) |*bind| bind.deinit()",
        "self.player_bind_specimen = null",
        "self.kid_list.deinit(self.allocator)",
        "self.scene.deinit(self.allocator)",
    });
}

test "ordinary bind slot follows all seven NPC palette slots before scene tails" {
    try expectOrdered(specimens.scene_build_source, &.{
        "self.npc_first_child = self.kid_list.items.len",
        "for (0..m_npc_character_session.MAX_INSTANCES)",
        "self.player_bind_child = self.kid_list.items.len",
        "if (self.scene.mesh_props)",
        "self.stream_tail_start = self.kid_list.items.len",
        "self.perm_node_count = self.kid_list.items.len",
    });

    const bind_slot = std.mem.indexOf(
        u8,
        specimens.scene_build_source,
        "self.player_bind_child = self.kid_list.items.len",
    ) orelse return error.MissingBindSlot;
    const initial_mount = try functionSlice(
        specimens.scene_build_source[bind_slot..],
        "if (self.scene.player_character) |*character|",
        "if (self.scene.mesh_props)",
    );
    try testing.expect(std.mem.indexOf(u8, initial_mount, "configureSinglePlayerCharacter(") != null);
    try testing.expect(std.mem.indexOf(u8, initial_mount, "extractBindSpecimen") == null);
    try testing.expect(std.mem.indexOf(u8, initial_mount, "configurePlayerCharacterSpecimens(") == null);
    try testing.expect(std.mem.indexOf(u8, initial_mount, "player_bind_specimen =") == null);
}

test "frame placement performs no allocation, asset load, or bind extraction" {
    const placement = try functionSlice(
        specimens.runtime_stream_source,
        "updateCameraNode(&self.kid_list.items[0]",
        "updateDynamicPropNodes(self)",
    );
    try testing.expect(std.mem.indexOf(u8, placement, "placePlayerCharacterSpecimens(") != null);
    try testing.expect(std.mem.indexOf(u8, placement, "placeSinglePlayerCharacter(") != null);
    try testing.expect(std.mem.indexOf(u8, placement, "characterDiagnosticAnchor()") != null);
    try testing.expect(std.mem.indexOf(u8, placement, "player_target_active_owner.value() != null") != null);
    try testing.expect(std.mem.indexOf(u8, placement, "alloc") == null);
    try testing.expect(std.mem.indexOf(u8, placement, "loadFiles") == null);
    try testing.expect(std.mem.indexOf(u8, placement, "extractBindSpecimen") == null);
}

test "embedded capture render refits camera after receiving the real pane aspect" {
    const render = try functionSlice(
        specimens.mounted_door_source,
        "pub fn renderEmbedded",
        "pub fn renderDetachedView",
    );
    try expectOrdered(render, &.{
        "runtime.last_aspect = w / @max(h, 1)",
        "applyPendingCam(runtime)",
        "refreshMountedPlayerCharacterDiagnosticCamera(runtime)",
        "runtime.stepNow(io, environ)",
        "scene3d.render",
    });
}

test "capture presentation is one snapshot-turn target then camera transaction" {
    const ingest = try functionSlice(
        specimens.capture_session_source,
        "pub fn ingestCompletedFrame",
        "fn createSession",
    );
    try testing.expect(std.mem.indexOf(u8, ingest, "publishVisible") == null);

    const snapshot = try functionSlice(
        specimens.capture_session_source,
        "fn presentedSnapshotReply",
        "};\n\nfn validateTargetRig",
    );
    try expectOrdered(snapshot, &.{
        "snapshotReply(self.allocator, session)",
        "try session.publishVisible()",
        "return reply",
    });

    const host_publish = try functionSlice(
        specimens.capture_host_source,
        "fn targetPublish",
        "fn targetClear",
    );
    try expectOrdered(host_publish, &.{
        "validatePublication",
        "hooks.publish_triplet",
        "publishValidated",
    });

    const target_publish = try functionSlice(
        specimens.capture_target_source,
        "fn publishTriplet",
        "fn clearTriplet",
    );
    try testing.expect(std.mem.indexOf(
        u8,
        target_publish,
        "try game_runtime.publishMountedPlayerCharacterPose",
    ) != null);
    try testing.expect(std.mem.indexOf(u8, target_publish, "catch") == null);

    // React's interval calls snapshot during __jsTick. V8 drains the resulting
    // render/microtasks before appTick drains the ONNX completion queue, and it
    // applies the React mutation batch afterward. Because ingest above cannot
    // publish, a completion arriving in tickDrain waits for the next jsTick's
    // snapshot transaction; native panes cannot advance underneath old React
    // landmark/source overlays.
    const app_tick = try functionSlice(
        specimens.v8_app_source,
        "fn appTick",
        "fn childTitle",
    );
    try expectOrdered(app_tick, &.{
        "callGlobalInt(host, \"__jsTick\"",
        "ingredients.tickDrain(host)",
        "drainPendingFlushes(host)",
    });
}

test "capture target routes every operation through the visible Game runtime" {
    const load_target = try functionSlice(
        specimens.capture_target_source,
        "fn loadTarget",
        "fn activateTarget",
    );
    try expectOrdered(load_target, &.{
        "hostFromContext(context)",
        "game_runtime.loadMountedPlayerCharacterTarget(",
        "host.io",
        "host.environ",
        "descriptor.viewport_node_id",
    });
    try testing.expect(std.mem.indexOf(
        u8,
        specimens.capture_target_source,
        "@import(\"dev_modules/game_runtime.zig\")",
    ) != null);
    try testing.expect(std.mem.indexOf(
        u8,
        specimens.capture_target_source,
        "@import(\"world_loader.zig\")",
    ) == null);
    try testing.expect(std.mem.indexOf(u8, load_target, "renderEmbedded") == null);
}

test "modular capture load ensures and mutates the rendering module world" {
    const module_load = try functionSlice(
        specimens.game_module_source,
        "fn captureLoadTarget",
        "fn captureActivateTarget",
    );
    try expectOrdered(module_load, &.{
        "world.ensureBlankMounted(",
        "world.loadMountedPlayerCharacterTarget(",
        "out.bone_count",
    });

    const core_load = try functionSlice(
        specimens.game_runtime_source,
        "pub fn loadMountedPlayerCharacterTarget",
        "pub fn activateMountedPlayerCharacterTarget",
    );
    try testing.expect(std.mem.indexOf(u8, core_load, "dispatch.capture_load_target(") != null);
}
