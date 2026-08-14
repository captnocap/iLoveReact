//! Focused revision, calibration, immutable-frame, and freeze proofs.
//!
//! Direct run: tools/zig/zig test --dep capture_session
//!   -Mroot=framework/testing/unit/capture_session.zig
//!   -Mcapture_session=framework/skeleton/capture_session.zig -O ReleaseFast

const std = @import("std");
const testing = std.testing;
const capture = @import("capture_session");
const retarget = capture.humanoid_retarget;
const source = capture.source_skeleton;
const rig = retarget.rig;
const canonical = capture.canonical_humanoid;

const BONE_COUNT = canonical.HUMANOID_V1_BONE_IDS.len;
const EXTERNAL_BONE_COUNT = 53;

fn testBones() [BONE_COUNT]rig.Bone {
    var result: [BONE_COUNT]rig.Bone = undefined;
    for (canonical.HUMANOID_V1_BONES, 0..) |bone, index| {
        var parent_index: ?u8 = null;
        if (bone.parent) |parent_id| {
            for (canonical.HUMANOID_V1_BONE_IDS[0..index], 0..) |candidate, candidate_index| {
                if (std.mem.eql(u8, candidate, parent_id)) {
                    parent_index = @intCast(candidate_index);
                    break;
                }
            }
        }
        result[index] = .{
            .parent_index = parent_index,
            .bind_translation = bone.transform.pos,
            .bind_rotation = bone.transform.rot,
            .constraint = if (index == 0) .fixed else .unconstrained,
        };
    }
    return result;
}

const TestContext = struct {
    now_ms: u64 = 1_000,
    bone_count: usize = 0,
    bones: [retarget.MAX_BONES]rig.Bone = undefined,
    bone_ids: [retarget.MAX_BONES][]const u8 = undefined,
    id_storage: [retarget.MAX_BONES][24]u8 = undefined,
    load_count: usize = 0,
    activate_count: usize = 0,
    close_count: usize = 0,
    clear_count: usize = 0,
    retain_count: usize = 0,
    release_count: usize = 0,
    live_leases: isize = 0,
    publish_count: usize = 0,
    publish_attempt_count: usize = 0,
    reject_publication: bool = false,
    last_published_frame: u64 = 0,
    last_published_token: u64 = 0,
    publication_valid: bool = true,
    activated_valid: bool = true,
    render_source_buf: [96]u8 = undefined,
    render_source_len: usize = 0,
    save_motion_count: usize = 0,
    saved_motion_buf: [65536]u8 = undefined,
    saved_motion_len: usize = 0,

    fn init() TestContext {
        var state = TestContext{};
        const canonical_bones = testBones();
        @memcpy(state.bones[0..BONE_COUNT], &canonical_bones);
        @memcpy(state.bone_ids[0..BONE_COUNT], canonical.HUMANOID_V1_BONE_IDS[0..]);
        state.bone_count = BONE_COUNT;
        return state;
    }

    fn initExternal(self: *TestContext) !void {
        self.* = .{};
        self.bone_count = EXTERNAL_BONE_COUNT;
        for (0..EXTERNAL_BONE_COUNT) |index| {
            self.bone_ids[index] = try std.fmt.bufPrint(&self.id_storage[index], "external_joint_{d}", .{index});
            self.bones[index] = .{
                .parent_index = if (index == 0) null else @intCast(index - 1),
                .bind_translation = if (index == 0) .{ 0, 0, 0 } else .{ 0, 0.01, 0 },
                .constraint = .unconstrained,
            };
        }
        // These aliases are derived from saved semantic bindings by the
        // strict character loader; the underlying palette order remains 53.
        self.bone_ids[1] = "pelvis";
        self.bone_ids[2] = "spine_lower";
        self.bone_ids[3] = "spine_upper";
        self.bone_ids[4] = "head";
        self.bone_ids[5] = "upper_arm_left";
        self.bone_ids[6] = "lower_arm_left";
        self.bone_ids[7] = "upper_arm_right";
        self.bone_ids[8] = "lower_arm_right";
        self.bone_ids[9] = "upper_leg_left";
        self.bone_ids[10] = "lower_leg_left";
        self.bone_ids[11] = "upper_leg_right";
        self.bone_ids[12] = "lower_leg_right";
    }

    fn renderSource(self: *const TestContext) []const u8 {
        return self.render_source_buf[0..self.render_source_len];
    }
};

fn ctx(raw: ?*anyopaque) *TestContext {
    return @ptrCast(@alignCast(raw.?));
}

fn nowMs(raw: ?*anyopaque) u64 {
    return ctx(raw).now_ms;
}

fn loadTarget(
    raw: ?*anyopaque,
    session_id: []const u8,
    target: capture.TargetDescriptor,
) anyerror!capture.TargetRigView {
    const state = ctx(raw);
    state.load_count += 1;
    if (session_id.len == 0 or target.geometry_path.len == 0 or target.skin_path.len == 0 or
        target.skeleton_json.len == 0)
    {
        return error.InvalidTestTarget;
    }
    return .{
        .bone_ids = state.bone_ids[0..state.bone_count],
        .bones = state.bones[0..state.bone_count],
    };
}

fn activateTarget(
    raw: ?*anyopaque,
    session_id: []const u8,
    render_source: []const u8,
    target: capture.TargetDescriptor,
) anyerror!void {
    const state = ctx(raw);
    state.activate_count += 1;
    state.activated_valid = state.activated_valid and session_id.len > 0 and target.viewport_node_id == 77 and
        std.mem.startsWith(u8, render_source, "capture-session:") and
        std.mem.endsWith(u8, render_source, ":camera");
    if (render_source.len > state.render_source_buf.len) return error.RenderSourceTooLong;
    @memcpy(state.render_source_buf[0..render_source.len], render_source);
    state.render_source_len = render_source.len;
}

fn retainFrame(raw: ?*anyopaque, frame: capture.ImmutableCameraFrame) anyerror!void {
    const state = ctx(raw);
    if (frame.identity.token == 0) return error.InvalidToken;
    state.retain_count += 1;
    state.live_leases += 1;
}

fn releaseFrame(raw: ?*anyopaque, _: capture.ImmutableCameraFrame) void {
    const state = ctx(raw);
    state.release_count += 1;
    state.live_leases -= 1;
}

fn publishTriplet(raw: ?*anyopaque, publication: capture.DiagnosticPublication) anyerror!void {
    const state = ctx(raw);
    state.publish_attempt_count += 1;
    if (state.reject_publication) return error.TestPublicationRejected;
    state.publish_count += 1;
    state.last_published_frame = publication.triplet.camera.frame_id;
    state.last_published_token = publication.camera_frame.identity.token;
    state.publication_valid = state.publication_valid and
        publication.camera_frame.identity.frame_id == publication.triplet.camera.frame_id and
        publication.camera_frame.identity.timestamp_ms == publication.triplet.camera.timestamp_ms and
        publication.camera_frame.identity.token == publication.triplet.camera.token and
        std.mem.eql(u8, publication.camera_render_source, state.renderSource()) and
        publication.bone_ids.len == state.bone_count and publication.target_global_matrices.len == state.bone_count;
}

fn clearTriplet(raw: ?*anyopaque, _: []const u8, _: []const u8, _: u32) void {
    ctx(raw).clear_count += 1;
}

fn closeTarget(raw: ?*anyopaque, _: []const u8, _: []const u8, _: u32) void {
    ctx(raw).close_count += 1;
}

fn saveMotion(raw: ?*anyopaque, directory: []const u8, encoded: []const u8) anyerror!capture.SavedMotion {
    const state = ctx(raw);
    state.save_motion_count += 1;
    if (encoded.len > state.saved_motion_buf.len) return error.TestMotionTooLarge;
    @memcpy(state.saved_motion_buf[0..encoded.len], encoded);
    state.saved_motion_len = encoded.len;
    var saved = capture.SavedMotion{};
    var path_buf: [256]u8 = undefined;
    const path = try std.fmt.bufPrint(&path_buf, "{s}/motion-test.rjan", .{directory});
    try saved.set(path);
    return saved;
}

fn hooks(state: *TestContext) capture.Hooks {
    return .{
        .context = state,
        .now_ms = nowMs,
        .load_target = loadTarget,
        .activate_target = activateTarget,
        .retain_frame = retainFrame,
        .release_frame = releaseFrame,
        .publish_triplet = publishTriplet,
        .clear_triplet = clearTriplet,
        .close_target = closeTarget,
        .save_motion = saveMotion,
    };
}

const OPEN_REQUEST =
    "{\"op\":\"openTarget\",\"payload\":{" ++
    "\"geometryPath\":\"/tmp/character.rjmd\"," ++
    "\"skinPath\":\"/tmp/skin.rjsk\"," ++
    "\"skeletonJson\":\"{}\"," ++
    "\"cameraSource\":\"cam:2\"," ++
    "\"viewportNodeId\":77}}";

fn command(
    manager: *capture.Manager,
    op: []const u8,
    session_id: []const u8,
    revision: u64,
) ![]u8 {
    var buffer: [256]u8 = undefined;
    const request = try std.fmt.bufPrint(
        &buffer,
        "{{\"op\":\"{s}\",\"sessionId\":\"{s}\",\"expectedRevision\":{d}}}",
        .{ op, session_id, revision },
    );
    return manager.handle(request);
}

fn snapshotRequest(manager: *capture.Manager, session_id: []const u8) ![]u8 {
    var buffer: [192]u8 = undefined;
    const request = try std.fmt.bufPrint(
        &buffer,
        "{{\"op\":\"snapshot\",\"sessionId\":\"{s}\"}}",
        .{session_id},
    );
    return manager.handle(request);
}

fn closeRequest(manager: *capture.Manager, session_id: []const u8) ![]u8 {
    var buffer: [192]u8 = undefined;
    const request = try std.fmt.bufPrint(
        &buffer,
        "{{\"op\":\"close\",\"sessionId\":\"{s}\"}}",
        .{session_id},
    );
    return manager.handle(request);
}

const Placement = struct {
    world: [3]f32,
    screen: [2]f32,
};

/// A camera-facing standing figure in MediaPipe world convention (metres,
/// hip-centred, y down, subject-left = +x) — the same figure the retarget
/// suite poses.
fn placement(name: source.WorldLandmarkName) Placement {
    return switch (name) {
        .nose => .{ .world = .{ 0.00, -0.62, -0.10 }, .screen = .{ 0.50, 0.10 } },
        .eye_inner_left => .{ .world = .{ 0.02, -0.65, -0.09 }, .screen = .{ 0.51, 0.09 } },
        .eye_left => .{ .world = .{ 0.03, -0.65, -0.09 }, .screen = .{ 0.52, 0.09 } },
        .eye_outer_left => .{ .world = .{ 0.04, -0.65, -0.09 }, .screen = .{ 0.53, 0.09 } },
        .eye_inner_right => .{ .world = .{ -0.02, -0.65, -0.09 }, .screen = .{ 0.49, 0.09 } },
        .eye_right => .{ .world = .{ -0.03, -0.65, -0.09 }, .screen = .{ 0.48, 0.09 } },
        .eye_outer_right => .{ .world = .{ -0.04, -0.65, -0.09 }, .screen = .{ 0.47, 0.09 } },
        .ear_left => .{ .world = .{ 0.07, -0.64, -0.02 }, .screen = .{ 0.54, 0.11 } },
        .ear_right => .{ .world = .{ -0.07, -0.64, -0.02 }, .screen = .{ 0.46, 0.11 } },
        .mouth_left => .{ .world = .{ 0.02, -0.58, -0.09 }, .screen = .{ 0.51, 0.13 } },
        .mouth_right => .{ .world = .{ -0.02, -0.58, -0.09 }, .screen = .{ 0.49, 0.13 } },
        .shoulder_left => .{ .world = .{ 0.17, -0.50, 0.00 }, .screen = .{ 0.60, 0.30 } },
        .shoulder_right => .{ .world = .{ -0.17, -0.50, 0.00 }, .screen = .{ 0.40, 0.30 } },
        .elbow_left => .{ .world = .{ 0.25, -0.28, 0.00 }, .screen = .{ 0.65, 0.45 } },
        .elbow_right => .{ .world = .{ -0.25, -0.28, 0.00 }, .screen = .{ 0.35, 0.45 } },
        .wrist_left => .{ .world = .{ 0.28, -0.05, 0.00 }, .screen = .{ 0.65, 0.60 } },
        .wrist_right => .{ .world = .{ -0.28, -0.05, 0.00 }, .screen = .{ 0.35, 0.60 } },
        .pinky_left => .{ .world = .{ 0.30, 0.00, 0.00 }, .screen = .{ 0.66, 0.63 } },
        .pinky_right => .{ .world = .{ -0.30, 0.00, 0.00 }, .screen = .{ 0.34, 0.63 } },
        .index_left => .{ .world = .{ 0.30, 0.00, -0.02 }, .screen = .{ 0.66, 0.63 } },
        .index_right => .{ .world = .{ -0.30, 0.00, -0.02 }, .screen = .{ 0.34, 0.63 } },
        .thumb_left => .{ .world = .{ 0.29, -0.01, -0.02 }, .screen = .{ 0.65, 0.62 } },
        .thumb_right => .{ .world = .{ -0.29, -0.01, -0.02 }, .screen = .{ 0.35, 0.62 } },
        .hip_left => .{ .world = .{ 0.09, 0.00, 0.00 }, .screen = .{ 0.56, 0.55 } },
        .hip_right => .{ .world = .{ -0.09, 0.00, 0.00 }, .screen = .{ 0.44, 0.55 } },
        .knee_left => .{ .world = .{ 0.10, 0.40, 0.00 }, .screen = .{ 0.56, 0.75 } },
        .knee_right => .{ .world = .{ -0.10, 0.40, 0.00 }, .screen = .{ 0.44, 0.75 } },
        .ankle_left => .{ .world = .{ 0.11, 0.80, 0.00 }, .screen = .{ 0.56, 0.95 } },
        .ankle_right => .{ .world = .{ -0.11, 0.80, 0.00 }, .screen = .{ 0.44, 0.95 } },
        .heel_left => .{ .world = .{ 0.11, 0.84, 0.02 }, .screen = .{ 0.56, 0.97 } },
        .heel_right => .{ .world = .{ -0.11, 0.84, 0.02 }, .screen = .{ 0.44, 0.97 } },
        .foot_index_left => .{ .world = .{ 0.11, 0.86, -0.06 }, .screen = .{ 0.57, 0.98 } },
        .foot_index_right => .{ .world = .{ -0.11, 0.86, -0.06 }, .screen = .{ 0.43, 0.98 } },
    };
}

fn makeDetected(frame_id: u64, timestamp_ms: u64, visibility: f32) source.WorldLandmarkFrame {
    var frame = source.WorldLandmarkFrame{
        .frame_id = frame_id,
        .timestamp_ms = timestamp_ms,
        .presence = 1.0,
        .landmarks = undefined,
    };
    for (0..source.WORLD_LANDMARK_COUNT) |index| {
        const spot = placement(@enumFromInt(index));
        frame.landmarks[index] = .{
            .screen = spot.screen,
            .world = .{ spot.world[0], spot.world[1], spot.world[2] },
            .visibility = visibility,
        };
    }
    return frame;
}

fn immutableFrame(frame_id: u64, timestamp_ms: u64, token: u64) capture.ImmutableCameraFrame {
    return .{
        .identity = .{ .frame_id = frame_id, .timestamp_ms = timestamp_ms, .token = token },
        .width = 640,
        .height = 480,
        .stride_bytes = 640 * 4,
    };
}

fn expectReplyOk(reply: []const u8) !std.json.Parsed(std.json.Value) {
    var parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, reply, .{});
    errdefer parsed.deinit();
    try testing.expect(parsed.value.object.get("ok").?.bool);
    return parsed;
}

fn jsonNumber(value: std.json.Value) f64 {
    return switch (value) {
        .float => |number| number,
        .integer => |number| @floatFromInt(number),
        else => unreachable,
    };
}

fn open(manager: *capture.Manager) !void {
    const reply = try manager.handle(OPEN_REQUEST);
    defer testing.allocator.free(reply);
    var parsed = try expectReplyOk(reply);
    defer parsed.deinit();
    const snapshot = parsed.value.object.get("value").?.object;
    try testing.expectEqual(@as(i64, 0), snapshot.get("revision").?.integer);
    try testing.expectEqualStrings("uncalibrated", snapshot.get("calibration").?.object.get("state").?.string);
    const target_skeleton = snapshot.get("targetSkeleton").?.object;
    try testing.expect(target_skeleton.get("frameId").? == .null);
    const diagnostic_bones = target_skeleton.get("bones").?.array.items;
    try testing.expectEqual(BONE_COUNT, diagnostic_bones.len);
    try testing.expectEqualStrings("root", diagnostic_bones[0].object.get("boneId").?.string);
    try testing.expect(diagnostic_bones[0].object.get("parentBoneId").? == .null);
    try testing.expect(diagnostic_bones[0].object.get("deformedPosition").? == .null);
}

fn beginCalibration(manager: *capture.Manager) !void {
    const session_id = manager.currentSessionId().?;
    const reply = try command(manager, "calibrate", session_id, manager.currentRevision().?);
    defer testing.allocator.free(reply);
    var parsed = try expectReplyOk(reply);
    defer parsed.deinit();
}

fn calibrateThirty(manager: *capture.Manager, first_frame_id: u64, first_timestamp_ms: u64) !void {
    const session_id = manager.currentSessionId().?;
    for (0..source.CALIBRATION_FRAME_COUNT) |index| {
        const frame_id = first_frame_id + index;
        const timestamp_ms = first_timestamp_ms + index * 100;
        try manager.beginInference(session_id, immutableFrame(frame_id, timestamp_ms, 10_000 + frame_id));
        const detected = makeDetected(frame_id, timestamp_ms, 0.8);
        const result = try manager.ingestCompletedFrame(session_id, detected);
        if (index + 1 == source.CALIBRATION_FRAME_COUNT)
            try testing.expectEqual(capture.IngestResult.promoted, result)
        else
            try testing.expectEqual(capture.IngestResult.calibration_progress, result);
    }
}

fn presentSnapshot(manager: *capture.Manager, session_id: []const u8) !std.json.Parsed(std.json.Value) {
    const reply = try snapshotRequest(manager, session_id);
    defer testing.allocator.free(reply);
    return expectReplyOk(reply);
}

test "JSON door enforces session identity and exact expected revisions, and reopen resets camera calibration" {
    var state = TestContext.init();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), capture.DEFAULT_TUNING);
    defer manager.deinit();

    const malformed = try manager.handle("not json");
    defer testing.allocator.free(malformed);
    var malformed_parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, malformed, .{});
    defer malformed_parsed.deinit();
    try testing.expect(!malformed_parsed.value.object.get("ok").?.bool);

    try open(&manager);
    try testing.expectEqualStrings("1", manager.currentSessionId().?);
    try testing.expectEqualStrings("capture-session:1:camera", try manager.cameraRenderSource("1"));
    try testing.expectEqualStrings("cam:2", manager.inferenceTarget().?.camera_source);
    try testing.expect(state.activated_valid);

    const stale = try command(&manager, "calibrate", "1", 9);
    defer testing.allocator.free(stale);
    var stale_parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, stale, .{});
    defer stale_parsed.deinit();
    try testing.expect(!stale_parsed.value.object.get("ok").?.bool);
    try testing.expectEqual(@as(i64, 0), stale_parsed.value.object.get("currentRevision").?.integer);
    try testing.expectEqual(@as(u64, 0), manager.currentRevision().?);

    try beginCalibration(&manager);
    try testing.expectEqual(source.CalibrationState.collecting, manager.session.?.calibrator.state);

    try open(&manager);
    try testing.expectEqualStrings("2", manager.currentSessionId().?);
    try testing.expectEqual(source.CalibrationState.uncalibrated, manager.session.?.calibrator.state);
    try testing.expectEqual(@as(usize, 2), state.load_count);
    try testing.expectEqual(@as(usize, 2), state.activate_count);
    try testing.expectEqual(@as(usize, 1), state.close_count);
}

test "role-mapped 53-bone target opens without a canonical palette fallback" {
    var state: TestContext = undefined;
    try state.initExternal();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), capture.DEFAULT_TUNING);
    defer manager.deinit();

    const reply = try manager.handle(OPEN_REQUEST);
    defer testing.allocator.free(reply);
    var parsed = try expectReplyOk(reply);
    defer parsed.deinit();
    const snapshot = parsed.value.object.get("value").?.object;
    const bones = snapshot.get("targetSkeleton").?.object.get("bones").?.array.items;
    try testing.expectEqual(@as(usize, EXTERNAL_BONE_COUNT), bones.len);
    try testing.expectEqualStrings("pelvis", bones[1].object.get("boneId").?.string);
    try testing.expectEqualStrings("head", bones[4].object.get("boneId").?.string);
    try testing.expectEqual(@as(usize, 1), state.activate_count);
    try testing.expect(state.activated_valid);
}

test "30 valid frames within ten seconds promote one atomic triplet and freeze pins its exact RGBA lease" {
    var state = TestContext.init();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), capture.DEFAULT_TUNING);
    defer manager.deinit();
    try open(&manager);
    try beginCalibration(&manager);
    const session_id = manager.currentSessionId().?;

    var low_confidence = makeDetected(1, 1_100, 0.8);
    low_confidence.landmarks[@intFromEnum(source.WorldLandmarkName.hip_left)].visibility =
        source.DEFAULT_TUNING.minimum_confidence - 0.001;
    try manager.beginInference(session_id, immutableFrame(1, 1_100, 1_001));
    try testing.expectEqual(
        capture.IngestResult.invalid_calibration_frame,
        try manager.ingestCompletedFrame(session_id, low_confidence),
    );
    try testing.expectEqual(@as(u8, 0), manager.session.?.calibrator.valid_frame_count);
    try testing.expectEqual(@as(isize, 0), state.live_leases);

    // Even a calibration-rejected frame feeds the live-detection preview
    // (req_4390): the surface shows what the pipeline sees the moment the
    // session opens, with no separate inference lane.
    {
        const preview_reply = try snapshotRequest(&manager, session_id);
        defer testing.allocator.free(preview_reply);
        var preview_parsed = try expectReplyOk(preview_reply);
        defer preview_parsed.deinit();
        const preview_value = preview_parsed.value.object.get("value").?.object;
        try testing.expect(preview_value.get("detected").? == .null);
        const preview = preview_value.get("preview").?.object;
        try testing.expectEqual(@as(i64, 640), preview.get("frameWidth").?.integer);
        try testing.expectEqual(@as(i64, 480), preview.get("frameHeight").?.integer);
        try testing.expectEqual(
            @as(usize, 33),
            preview.get("detected").?.object.get("landmarks").?.array.items.len,
        );
    }

    try calibrateThirty(&manager, 2, 1_200);
    try testing.expectEqual(source.CalibrationState.calibrated, manager.session.?.calibrator.state);
    try testing.expectEqual(@as(u8, 30), manager.session.?.calibrator.valid_frame_count);
    try testing.expectEqual(@as(usize, 0), state.publish_count);
    var first_presented = try presentSnapshot(&manager, session_id);
    defer first_presented.deinit();
    try testing.expectEqual(@as(usize, 1), state.publish_count);
    try testing.expectEqual(@as(u64, 31), state.last_published_frame);
    try testing.expectEqual(@as(isize, 2), state.live_leases);
    try testing.expect(state.publication_valid);

    var next_detected = makeDetected(32, 4_200, 0.9);
    // Step the whole figure sideways: root translation is screen-derived, so
    // the resumed deformed root must land away from the frozen one.
    for (&next_detected.landmarks) |*landmark| landmark.screen[0] += 0.08;
    try manager.beginInference(session_id, immutableFrame(32, 4_200, 10_032));
    try testing.expectEqual(@as(usize, 1), manager.inferenceTarget().?.pending_count);
    const freeze_reply = try command(&manager, "freeze", session_id, manager.currentRevision().?);
    defer testing.allocator.free(freeze_reply);
    var freeze_parsed = try expectReplyOk(freeze_reply);
    defer freeze_parsed.deinit();
    try testing.expect(manager.inferenceTarget().?.frozen);
    try testing.expectEqual(@as(isize, 4), state.live_leases);

    try testing.expectEqual(
        capture.IngestResult.promoted,
        try manager.ingestCompletedFrame(session_id, next_detected),
    );
    try testing.expectEqual(@as(usize, 1), state.publish_count);
    try testing.expectEqual(@as(isize, 3), state.live_leases);
    const frozen_snapshot_reply = try snapshotRequest(&manager, session_id);
    defer testing.allocator.free(frozen_snapshot_reply);
    var frozen_snapshot = try expectReplyOk(frozen_snapshot_reply);
    defer frozen_snapshot.deinit();
    const frozen_value = frozen_snapshot.value.object.get("value").?.object;
    try testing.expectEqual(@as(i64, 31), frozen_value.get("detected").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(i64, 31), frozen_value.get("source").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(i64, 31), frozen_value.get("target").?.object.get("frameId").?.integer);
    const frozen_target_skeleton = frozen_value.get("targetSkeleton").?.object;
    try testing.expectEqual(@as(i64, 31), frozen_target_skeleton.get("frameId").?.integer);
    try testing.expectEqual(
        @as(usize, 3),
        frozen_target_skeleton.get("bones").?.array.items[1].object.get("deformedPosition").?.array.items.len,
    );
    const frozen_root_x = jsonNumber(
        frozen_target_skeleton.get("bones").?.array.items[0].object.get("deformedPosition").?.array.items[0],
    );

    const resume_reply = try command(&manager, "resume", session_id, manager.currentRevision().?);
    defer testing.allocator.free(resume_reply);
    var resume_parsed = try expectReplyOk(resume_reply);
    defer resume_parsed.deinit();
    const resumed = resume_parsed.value.object.get("value").?.object;
    try testing.expectEqual(@as(i64, 32), resumed.get("detected").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(i64, 32), resumed.get("source").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(i64, 32), resumed.get("target").?.object.get("frameId").?.integer);
    try testing.expectEqual(
        @as(i64, 32),
        resumed.get("targetSkeleton").?.object.get("frameId").?.integer,
    );
    const resumed_root_x = jsonNumber(
        resumed.get("targetSkeleton").?.object.get("bones").?.array.items[0].object.get("deformedPosition").?.array.items[0],
    );
    try testing.expect(@abs(resumed_root_x - frozen_root_x) > 1.0e-4);
    try testing.expectEqual(@as(usize, 2), state.publish_count);
    try testing.expectEqual(@as(u64, 32), state.last_published_frame);
    try testing.expectEqual(@as(isize, 2), state.live_leases);

    try manager.beginInference(session_id, immutableFrame(33, 4_300, 10_033));
    const recal_reply = try command(&manager, "calibrate", session_id, manager.currentRevision().?);
    defer testing.allocator.free(recal_reply);
    var recal_parsed = try expectReplyOk(recal_reply);
    defer recal_parsed.deinit();
    const recal_snapshot = recal_parsed.value.object.get("value").?.object;
    try testing.expectEqualStrings("collecting", recal_snapshot.get("calibration").?.object.get("state").?.string);
    try testing.expect(recal_snapshot.get("detected").? == .null);
    // A configuration command invalidates the result but cannot release RGBA
    // that an in-flight worker may still be reading. Failure/cancellation owns
    // the explicit discard handshake.
    try testing.expectEqual(@as(usize, 1), manager.inferenceTarget().?.pending_count);
    try testing.expectEqual(@as(isize, 1), state.live_leases);
    try manager.discardInference(session_id, 33);
    try testing.expectEqual(@as(usize, 0), manager.inferenceTarget().?.pending_count);
    try testing.expectEqual(@as(isize, 0), state.live_leases);
    try testing.expectEqual(@as(usize, 2), state.clear_count);

    const close_reply = try closeRequest(&manager, session_id);
    defer testing.allocator.free(close_reply);
    var close_parsed = try expectReplyOk(close_reply);
    defer close_parsed.deinit();
    try testing.expect(manager.inferenceTarget() == null);
    try testing.expectEqual(@as(usize, 1), state.close_count);
    try testing.expectEqual(@as(isize, 0), state.live_leases);
}

test "snapshot publication is fail-closed and retries one exact camera target transaction" {
    var state = TestContext.init();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), capture.DEFAULT_TUNING);
    defer manager.deinit();
    try open(&manager);
    try beginCalibration(&manager);
    const session_id = manager.currentSessionId().?;
    try calibrateThirty(&manager, 1, 1_100);

    state.reject_publication = true;
    const rejected_reply = try snapshotRequest(&manager, session_id);
    defer testing.allocator.free(rejected_reply);
    var rejected = try std.json.parseFromSlice(std.json.Value, testing.allocator, rejected_reply, .{});
    defer rejected.deinit();
    try testing.expect(!rejected.value.object.get("ok").?.bool);
    try testing.expectEqual(@as(usize, 1), state.publish_attempt_count);
    try testing.expectEqual(@as(usize, 0), state.publish_count);
    try testing.expect(manager.session.?.presented_frame == null);
    try testing.expectEqual(@as(isize, 1), state.live_leases);

    state.reject_publication = false;
    var accepted = try presentSnapshot(&manager, session_id);
    defer accepted.deinit();
    const value = accepted.value.object.get("value").?.object;
    try testing.expectEqual(@as(i64, 30), value.get("detected").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(i64, 30), value.get("source").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(i64, 30), value.get("target").?.object.get("frameId").?.integer);
    try testing.expectEqual(@as(usize, 2), state.publish_attempt_count);
    try testing.expectEqual(@as(usize, 1), state.publish_count);
    try testing.expectEqual(@as(u64, 30), state.last_published_frame);
    try testing.expectEqual(@as(isize, 2), state.live_leases);
}

test "deadline failure and discarded or mismatched inference release only their own pending frame" {
    var state = TestContext.init();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), .{ .max_pending_frames = 2 });
    defer manager.deinit();
    try open(&manager);
    try beginCalibration(&manager);
    const session_id = manager.currentSessionId().?;

    try manager.beginInference(session_id, immutableFrame(1, 1_100, 101));
    try manager.discardInference(session_id, 1);
    try testing.expectEqual(@as(usize, 0), manager.inferenceTarget().?.pending_count);
    try testing.expectEqual(@as(isize, 0), state.live_leases);
    try testing.expectEqual(@as(u64, 1), manager.currentRevision().?);

    try manager.beginInference(session_id, immutableFrame(2, 1_200, 102));
    const mismatched = makeDetected(2, 1_201, 0.9);
    try testing.expectError(
        error.FrameIdentityMismatch,
        manager.ingestCompletedFrame(session_id, mismatched),
    );
    try testing.expectEqual(@as(usize, 0), manager.inferenceTarget().?.pending_count);
    try testing.expectEqual(@as(isize, 0), state.live_leases);

    const late_timestamp = state.now_ms + source.DEFAULT_TUNING.calibration_deadline_ms + 1;
    try manager.beginInference(session_id, immutableFrame(3, late_timestamp, 103));
    const late = makeDetected(3, late_timestamp, 0.9);
    try testing.expectEqual(
        capture.IngestResult.calibration_failed,
        try manager.ingestCompletedFrame(session_id, late),
    );
    try testing.expectEqual(source.CalibrationState.failed, manager.session.?.calibrator.state);
    try testing.expectEqual(@as(isize, 0), state.live_leases);
    try testing.expectEqual(@as(u64, 2), manager.currentRevision().?);

    const snapshot_reply = try snapshotRequest(&manager, session_id);
    defer testing.allocator.free(snapshot_reply);
    var snapshot = try expectReplyOk(snapshot_reply);
    defer snapshot.deinit();
    const calibration = snapshot.value.object.get("value").?.object.get("calibration").?.object;
    try testing.expectEqualStrings("failed", calibration.get("state").?.string);
    try testing.expect(calibration.get("detail") != null);
}

fn recordStopRequest(manager: *capture.Manager, session_id: []const u8, revision: u64) ![]u8 {
    var buffer: [320]u8 = undefined;
    const request = try std.fmt.bufPrint(
        &buffer,
        "{{\"op\":\"recordStop\",\"sessionId\":\"{s}\",\"expectedRevision\":{d}," ++
            "\"payload\":{{\"directory\":\"/tmp/motion\",\"name\":\"take-1\"}}}}",
        .{ session_id, revision },
    );
    return manager.handle(request);
}

test "recording taps promoted frames into a durable role-addressed take" {
    var state: TestContext = undefined;
    try state.initExternal();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), capture.DEFAULT_TUNING);
    defer manager.deinit();
    const open_reply = try manager.handle(OPEN_REQUEST);
    defer testing.allocator.free(open_reply);
    var open_parsed = try expectReplyOk(open_reply);
    defer open_parsed.deinit();
    try beginCalibration(&manager);
    try calibrateThirty(&manager, 1, 1_100);
    const session_id = manager.currentSessionId().?;

    const record_reply = try command(&manager, "record", session_id, manager.currentRevision().?);
    defer testing.allocator.free(record_reply);
    var record_parsed = try expectReplyOk(record_reply);
    defer record_parsed.deinit();
    const recording_state = record_parsed.value.object.get("value").?.object.get("recording").?.object;
    try testing.expectEqual(@as(i64, 0), recording_state.get("frameCount").?.integer);

    for (0..3) |index| {
        const frame_id = 40 + index;
        const timestamp_ms = 5_000 + index * 33;
        try manager.beginInference(session_id, immutableFrame(frame_id, timestamp_ms, 20_000 + frame_id));
        const result = try manager.ingestCompletedFrame(session_id, makeDetected(frame_id, timestamp_ms, 0.8));
        try testing.expectEqual(capture.IngestResult.promoted, result);
    }

    const stop_reply = try recordStopRequest(&manager, session_id, manager.currentRevision().?);
    defer testing.allocator.free(stop_reply);
    var stop_parsed = try expectReplyOk(stop_reply);
    defer stop_parsed.deinit();
    const stop_value = stop_parsed.value.object.get("value").?.object;
    try testing.expectEqual(@as(i64, 3), stop_value.get("frameCount").?.integer);
    try testing.expectEqualStrings("/tmp/motion/motion-test.rjan", stop_value.get("path").?.string);
    try testing.expect(!stop_value.get("truncated").?.bool);
    try testing.expectEqual(@as(usize, 1), state.save_motion_count);

    // The persisted bytes are a valid RJAN capture document: the 12 role
    // channels this rig binds, one dense run, real per-frame times, root
    // motion — and it evaluates.
    var doc = try capture.motion_document.decodeAlloc(
        testing.allocator,
        state.saved_motion_buf[0..state.saved_motion_len],
    );
    defer doc.deinit();
    try testing.expectEqual(capture.motion_document.SourceKind.capture, doc.source);
    try testing.expectEqualStrings("take-1", doc.name);
    try testing.expectEqual(@as(usize, 12), doc.channel_ids.len);
    try testing.expectEqualStrings("pelvis", doc.channel_ids[0]);
    try testing.expectEqual(@as(usize, 0), doc.keys.len);
    try testing.expectEqual(@as(usize, 1), doc.runs.len);
    try testing.expectEqual(@as(usize, 3), doc.runs[0].frameCount());
    try testing.expectApproxEqAbs(@as(f32, 0.066), doc.runs[0].times[2], 0.001);
    try testing.expect(doc.runs[0].root_translations != null);

    const sampled = try capture.motion_document.sample(&doc, 0.03);
    try testing.expectEqual(@as(u32, 0xFFF), sampled.coverage);
    try testing.expect(sampled.has_root);

    // A second stop is a protocol error, not a crash.
    const double_stop = try recordStopRequest(&manager, session_id, manager.currentRevision().?);
    defer testing.allocator.free(double_stop);
    var double_parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, double_stop, .{});
    defer double_parsed.deinit();
    try testing.expect(!double_parsed.value.object.get("ok").?.bool);
}

test "recalibration discards an active recording instead of splicing rest references" {
    var state: TestContext = undefined;
    try state.initExternal();
    var manager = try capture.Manager.init(testing.allocator, hooks(&state), capture.DEFAULT_TUNING);
    defer manager.deinit();
    const open_reply = try manager.handle(OPEN_REQUEST);
    defer testing.allocator.free(open_reply);
    var open_parsed = try expectReplyOk(open_reply);
    defer open_parsed.deinit();
    try beginCalibration(&manager);
    try calibrateThirty(&manager, 1, 1_100);
    const session_id = manager.currentSessionId().?;

    const record_reply = try command(&manager, "record", session_id, manager.currentRevision().?);
    defer testing.allocator.free(record_reply);
    var record_parsed = try expectReplyOk(record_reply);
    defer record_parsed.deinit();

    const recalibrate_reply = try command(&manager, "calibrate", session_id, manager.currentRevision().?);
    defer testing.allocator.free(recalibrate_reply);
    var recalibrate_parsed = try expectReplyOk(recalibrate_reply);
    defer recalibrate_parsed.deinit();
    const snapshot = recalibrate_parsed.value.object.get("value").?.object;
    try testing.expect(snapshot.get("recording").? == .null);
}
