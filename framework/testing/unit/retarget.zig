//! Focused calibration, reconstruction, retarget, recovery, and frame-identity proofs.
//!
//! Direct run: tools/zig/zig test --dep humanoid_retarget
//!   -Mroot=framework/testing/unit/retarget.zig
//!   -Mhumanoid_retarget=framework/skeleton/humanoid_retarget.zig

const std = @import("std");
const testing = std.testing;
const retarget = @import("humanoid_retarget");
const source = retarget.source;
const rig = retarget.rig;
const fk = rig.fk;

fn point(name: source.KeypointName, x: f32, y: f32, confidence: f32) source.CameraKeypoint {
    return .{ .name = name, .x = x, .y = y, .confidence = confidence };
}

fn makeFrame(frame_id: u64, timestamp_ms: u64, confidence: f32) source.DetectedLandmarkFrame {
    return .{
        .frame_id = frame_id,
        .timestamp_ms = timestamp_ms,
        .keypoints = .{
            point(.nose, 0.50, 0.10, confidence),
            point(.eye_left, 0.48, 0.09, confidence),
            point(.eye_right, 0.52, 0.09, confidence),
            point(.ear_left, 0.46, 0.11, confidence),
            point(.ear_right, 0.54, 0.11, confidence),
            point(.shoulder_left, 0.40, 0.30, confidence),
            point(.shoulder_right, 0.60, 0.30, confidence),
            point(.elbow_left, 0.35, 0.45, confidence),
            point(.elbow_right, 0.65, 0.45, confidence),
            point(.wrist_left, 0.35, 0.60, confidence),
            point(.wrist_right, 0.65, 0.60, confidence),
            point(.hip_left, 0.44, 0.55, confidence),
            point(.hip_right, 0.56, 0.55, confidence),
            point(.knee_left, 0.44, 0.75, confidence),
            point(.knee_right, 0.56, 0.75, confidence),
            point(.ankle_left, 0.44, 0.95, confidence),
            point(.ankle_right, 0.56, 0.95, confidence),
        },
    };
}

fn rollFacePair(
    frame: *source.DetectedLandmarkFrame,
    left_name: source.KeypointName,
    right_name: source.KeypointName,
    radians: f32,
) void {
    const left = &frame.keypoints[@intFromEnum(left_name)];
    const right = &frame.keypoints[@intFromEnum(right_name)];
    const midpoint_x = (left.x + right.x) * 0.5;
    const midpoint_y = (left.y + right.y) * 0.5;
    const half_x = (right.x - left.x) * 0.5;
    const half_y = -(right.y - left.y) * 0.5;
    const cosine = @cos(radians);
    const sine = @sin(radians);
    const rotated_x = cosine * half_x - sine * half_y;
    const rotated_y = sine * half_x + cosine * half_y;
    left.x = midpoint_x - rotated_x;
    left.y = midpoint_y + rotated_y;
    right.x = midpoint_x + rotated_x;
    right.y = midpoint_y - rotated_y;
}

fn rollFace(frame: *source.DetectedLandmarkFrame, radians: f32) void {
    rollFacePair(frame, .eye_left, .eye_right, radians);
    rollFacePair(frame, .ear_left, .ear_right, radians);
}

fn setFacePairConfidence(frame: *source.DetectedLandmarkFrame, confidence: f32) void {
    for ([_]source.KeypointName{ .eye_left, .eye_right, .ear_left, .ear_right }) |name| {
        frame.keypoints[@intFromEnum(name)].confidence = confidence;
    }
}

fn rotationSimilarity(left: fk.Quat, right: fk.Quat) f32 {
    return @abs(fk.dotQuat(left, right));
}

fn calibrateRest() !source.Calibration {
    var calibrator = try source.Calibrator.init(source.DEFAULT_TUNING);
    calibrator.begin(0);
    for (0..source.CALIBRATION_FRAME_COUNT) |index| {
        var frame = makeFrame(index + 1, @intCast(100 + index * 100), 0.8);
        // One extreme but valid sample must not displace a 30-frame median.
        if (index == 0) {
            frame.keypoints[@intFromEnum(source.KeypointName.elbow_left)].x = 0.90;
            frame.keypoints[@intFromEnum(source.KeypointName.elbow_left)].y = 0.80;
            rollFace(&frame, std.math.pi * 0.40);
        }
        const result = try calibrator.push(&frame);
        if (index + 1 == source.CALIBRATION_FRAME_COUNT)
            try testing.expectEqual(source.CalibrationPush.completed, result)
        else
            try testing.expectEqual(source.CalibrationPush.accepted, result);
    }
    return calibrator.result.?;
}

fn vectorLength(v: [3]f32) f32 {
    return @sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

test "calibration requires 30 distinct valid frames above the minimum confidence within ten seconds" {
    const bar = source.DEFAULT_TUNING.minimum_confidence;
    var calibrator = try source.Calibrator.init(source.DEFAULT_TUNING);
    calibrator.begin(0);
    var rejected = makeFrame(1, 100, 0.8);
    rejected.keypoints[@intFromEnum(source.KeypointName.hip_left)].confidence = bar - 0.001;
    try testing.expectEqual(source.CalibrationPush.ignored_invalid, try calibrator.push(&rejected));
    try testing.expectEqual(@as(u8, 0), calibrator.valid_frame_count);

    var missing_face = makeFrame(2, 150, 0.8);
    setFacePairConfidence(&missing_face, bar - 0.001);
    try testing.expectEqual(source.CalibrationPush.ignored_invalid, try calibrator.push(&missing_face));
    try testing.expectEqual(@as(u8, 0), calibrator.valid_frame_count);

    for (0..29) |index| {
        var frame = makeFrame(index + 1, @intCast(200 + index * 100), bar);
        try testing.expectEqual(source.CalibrationPush.accepted, try calibrator.push(&frame));
    }
    var duplicate = makeFrame(29, 5_000, 0.8);
    try testing.expectEqual(source.CalibrationPush.ignored_invalid, try calibrator.push(&duplicate));
    var thirtieth = makeFrame(30, 9_900, 0.8);
    try testing.expectEqual(source.CalibrationPush.completed, try calibrator.push(&thirtieth));
    try testing.expectEqual(source.CalibrationState.calibrated, calibrator.state);
    try testing.expectEqual(@as(u8, 30), calibrator.valid_frame_count);

    var expired = try source.Calibrator.init(source.DEFAULT_TUNING);
    expired.begin(0);
    var late = makeFrame(1, 10_001, 1);
    try testing.expectEqual(source.CalibrationPush.deadline_exceeded, try expired.push(&late));
    try testing.expectEqual(source.CalibrationState.failed, expired.state);
}

test "calibration uses medians and 3D reconstruction preserves calibrated segment length" {
    const calibration = try calibrateRest();
    const expected_upper_length = @sqrt(@as(f32, 0.05 * 0.05 + 0.15 * 0.15)) / 0.45;
    try testing.expectApproxEqAbs(
        expected_upper_length,
        calibration.rest_segments[@intFromEnum(source.SegmentId.upper_arm_left)].length,
        1.0e-5,
    );

    var foreshortened = makeFrame(100, 12_000, 0.9);
    foreshortened.keypoints[@intFromEnum(source.KeypointName.elbow_left)].x = 0.39;
    foreshortened.keypoints[@intFromEnum(source.KeypointName.elbow_left)].y = 0.34;
    const positive = try source.reconstruct(&foreshortened, calibration, .positive, source.DEFAULT_TUNING);
    const negative = try source.reconstruct(&foreshortened, calibration, .negative, source.DEFAULT_TUNING);
    const positive_segment = positive.segment(.upper_arm_left);
    const negative_segment = negative.segment(.upper_arm_left);
    try testing.expectApproxEqAbs(
        calibration.rest_segments[@intFromEnum(source.SegmentId.upper_arm_left)].length,
        positive_segment.length,
        1.0e-5,
    );
    try testing.expectApproxEqAbs(positive_segment.length, negative_segment.length, 1.0e-5);
    try testing.expect(positive.joint(.elbow_left).position[2] > 0);
    try testing.expect(negative.joint(.elbow_left).position[2] < 0);
    try testing.expectApproxEqAbs(
        @abs(positive.joint(.elbow_left).position[2]),
        @abs(negative.joint(.elbow_left).position[2]),
        1.0e-5,
    );
}

test "confident eye and ear geometry authors the source head frame" {
    const calibration = try calibrateRest();
    const rest_head = calibration.rest_segments[@intFromEnum(source.SegmentId.head)];

    var rolled = makeFrame(101, 12_100, 0.9);
    rollFace(&rolled, std.math.pi / 6.0);
    const reconstructed = try source.reconstruct(&rolled, calibration, .positive, source.DEFAULT_TUNING);
    const head = reconstructed.segment(.head);
    try testing.expect(head.confidence >= 0.9);
    try testing.expect(rotationSimilarity(rest_head.rotation, head.rotation) < 0.99);

    var eyes_only = rolled;
    eyes_only.frame_id = 102;
    eyes_only.keypoints[@intFromEnum(source.KeypointName.ear_left)].confidence = 0.1;
    eyes_only.keypoints[@intFromEnum(source.KeypointName.ear_right)].confidence = 0.1;
    try testing.expect((try source.reconstruct(&eyes_only, calibration, .positive, source.DEFAULT_TUNING)).segment(.head).confidence >= 0.9);

    var ears_only = rolled;
    ears_only.frame_id = 103;
    ears_only.keypoints[@intFromEnum(source.KeypointName.eye_left)].confidence = 0.1;
    ears_only.keypoints[@intFromEnum(source.KeypointName.eye_right)].confidence = 0.1;
    try testing.expect((try source.reconstruct(&ears_only, calibration, .positive, source.DEFAULT_TUNING)).segment(.head).confidence >= 0.9);

    var missing = rolled;
    missing.frame_id = 104;
    setFacePairConfidence(&missing, 0.1);
    const missing_head = (try source.reconstruct(&missing, calibration, .positive, source.DEFAULT_TUNING)).segment(.head);
    try testing.expectEqual(@as(f32, 0), missing_head.confidence);
    try testing.expect(rotationSimilarity(rest_head.rotation, missing_head.rotation) > 0.99999);

    var missing_nose = rolled;
    missing_nose.frame_id = 105;
    missing_nose.keypoints[@intFromEnum(source.KeypointName.nose)].confidence = 0.1;
    try testing.expectEqual(
        @as(f32, 0),
        (try source.reconstruct(&missing_nose, calibration, .positive, source.DEFAULT_TUNING)).segment(.head).confidence,
    );
}

const TARGET_IDS = [_][]const u8{
    "root",
    "pelvis",
    "spine_lower",
    "spine_upper",
    "neck",
    "head",
    "clavicle_left",
    "upper_arm_left",
    "lower_arm_left",
    "hand_left",
    "upper_leg_left",
    "lower_leg_left",
    "foot_left",
};

const TARGET_BONES = [_]rig.Bone{
    .{ .parent_index = null, .bind_translation = .{ 0, 0, 0 }, .constraint = .fixed },
    .{ .parent_index = 0, .bind_translation = .{ 0, 1, 0 } },
    .{ .parent_index = 1, .bind_translation = .{ 0, 0.2, 0 } },
    .{ .parent_index = 2, .bind_translation = .{ 0, 0.3, 0 } },
    .{ .parent_index = 3, .bind_translation = .{ 0, 0.25, 0 } },
    .{ .parent_index = 4, .bind_translation = .{ 0, 0.2, 0 } },
    .{ .parent_index = 3, .bind_translation = .{ -0.1, 0.15, 0 }, .bind_rotation = .{ 0, 0, 0.70710678, 0.70710678 } },
    .{ .parent_index = 6, .bind_translation = .{ 0, 0.2, 0 } },
    .{ .parent_index = 7, .bind_translation = .{ 0, 0.4, 0 }, .constraint = .{ .hinge_x = .{ .min = 0, .max = 0.6 } } },
    .{ .parent_index = 8, .bind_translation = .{ 0, 0.3, 0 }, .bind_rotation = .{ 0, 0.14943813, 0, 0.98877108 } },
    .{ .parent_index = 1, .bind_translation = .{ -0.12, 0, 0 } },
    .{ .parent_index = 10, .bind_translation = .{ 0, 0.5, 0 }, .constraint = .{ .hinge_x = .{ .min = 0, .max = 1.5 } } },
    .{ .parent_index = 11, .bind_translation = .{ 0, 0.5, 0 }, .bind_rotation = .{ 0, 0.09983342, 0, 0.99500417 } },
};

fn matrixPosition(matrix: rig.Mat4) [3]f32 {
    return .{ matrix[12], matrix[13], matrix[14] };
}

fn distance(a: [3]f32, b: [3]f32) f32 {
    return vectorLength(.{ a[0] - b[0], a[1] - b[1], a[2] - b[2] });
}

fn posedSource(calibration: source.Calibration, frame_id: u64, timestamp_ms: u64) !source.SourceSkeletonFrame {
    var detected = makeFrame(frame_id, timestamp_ms, 0.9);
    var frame = try source.reconstruct(&detected, calibration, .positive, source.DEFAULT_TUNING);
    const angle: f32 = 1.2;
    const segment_index = @intFromEnum(source.SegmentId.lower_arm_left);
    const local_flex = try fk.axisAngle(.{ 1, 0, 0 }, angle);
    const live_rotation = try fk.normalizeQuat(fk.multiplyQuat(
        calibration.rest_segments[segment_index].rotation,
        local_flex,
    ));
    frame.segments[segment_index].rotation = live_rotation;
    frame.segments[segment_index].direction = try fk.rotateVec3(live_rotation, .{ 0, 1, 0 });
    frame.segments[segment_index].confidence = 0.9;
    frame.joints[@intFromEnum(source.JointId.hip_center)].position[0] += 0.1;
    frame.joints[@intFromEnum(source.JointId.hip_center)].position[1] += 0.2;
    return frame;
}

test "retarget emits constrained locals, preserves bind end-effector twist and target lengths" {
    const calibration = try calibrateRest();
    var mapper = try retarget.Retargeter.init(
        testing.allocator,
        &TARGET_IDS,
        &TARGET_BONES,
        retarget.DEFAULT_TUNING,
    );
    defer mapper.deinit();
    var source_frame = try posedSource(calibration, 1, 20_000);
    const pose = try mapper.retarget(calibration, &source_frame);

    const elbow = pose.local_rotations[8];
    const elbow_angle = 2 * std.math.atan2(elbow[0], elbow[3]);
    try testing.expectApproxEqAbs(@as(f32, 0.6), elbow_angle, 1.0e-4);
    try testing.expectEqualSlices(f32, &TARGET_BONES[9].bind_rotation, &pose.local_rotations[9]);
    try testing.expectEqualSlices(f32, &TARGET_BONES[12].bind_rotation, &pose.local_rotations[12]);
    try testing.expect(retarget.preservesBindOrientation("hand_left"));
    try testing.expect(retarget.preservesBindOrientation("foot_left"));

    const globals = mapper.globalMatrices();
    try testing.expectApproxEqAbs(
        @as(f32, 0.4),
        distance(matrixPosition(globals[7]), matrixPosition(globals[8])),
        1.0e-5,
    );
    try testing.expectApproxEqAbs(
        @as(f32, 0.3),
        distance(matrixPosition(globals[8]), matrixPosition(globals[9])),
        1.0e-5,
    );
    const source_height = distance(
        calibration.rest_joints[@intFromEnum(source.JointId.hip_center)],
        calibration.rest_joints[@intFromEnum(source.JointId.head)],
    );
    const scale_factor = mapper.target_hip_to_head / source_height;
    try testing.expectApproxEqAbs(@as(f32, 0.1) * scale_factor, pose.root_translation[0], 1.0e-5);
    try testing.expectApproxEqAbs(@as(f32, 0.2) * scale_factor, pose.root_translation[1], 1.0e-5);
}

test "missing channel holds 150ms then slerps to bind over 350ms" {
    const calibration = try calibrateRest();
    var mapper = try retarget.Retargeter.init(
        testing.allocator,
        &TARGET_IDS,
        &TARGET_BONES,
        retarget.DEFAULT_TUNING,
    );
    defer mapper.deinit();
    var observed = try posedSource(calibration, 1, 1_000);
    const posed = try mapper.retarget(calibration, &observed);
    const posed_angle = 2 * std.math.atan2(posed.local_rotations[8][0], posed.local_rotations[8][3]);

    var missing = observed;
    missing.frame_id = 2;
    missing.timestamp_ms = 1_100;
    missing.segments[@intFromEnum(source.SegmentId.lower_arm_left)].confidence = 0;
    const hold_start = try mapper.retarget(calibration, &missing);
    missing.frame_id = 3;
    missing.timestamp_ms = 1_250;
    const hold_end = try mapper.retarget(calibration, &missing);
    try testing.expectApproxEqAbs(posed_angle, 2 * std.math.atan2(hold_start.local_rotations[8][0], hold_start.local_rotations[8][3]), 1.0e-5);
    try testing.expectApproxEqAbs(posed_angle, 2 * std.math.atan2(hold_end.local_rotations[8][0], hold_end.local_rotations[8][3]), 1.0e-5);

    missing.frame_id = 4;
    missing.timestamp_ms = 1_425;
    const fading = try mapper.retarget(calibration, &missing);
    const fading_angle = 2 * std.math.atan2(fading.local_rotations[8][0], fading.local_rotations[8][3]);
    try testing.expect(fading_angle > 0 and fading_angle < posed_angle);

    missing.frame_id = 5;
    missing.timestamp_ms = 1_600;
    const bound = try mapper.retarget(calibration, &missing);
    try testing.expectApproxEqAbs(@as(f32, 0), 2 * std.math.atan2(bound.local_rotations[8][0], bound.local_rotations[8][3]), 1.0e-5);
}

test "missing facial orientation holds neck and head then fades to bind" {
    const calibration = try calibrateRest();
    var mapper = try retarget.Retargeter.init(
        testing.allocator,
        &TARGET_IDS,
        &TARGET_BONES,
        retarget.DEFAULT_TUNING,
    );
    defer mapper.deinit();

    var detected = makeFrame(1, 1_000, 0.9);
    rollFace(&detected, std.math.pi / 5.0);
    var source_frame = try source.reconstruct(&detected, calibration, .positive, source.DEFAULT_TUNING);
    const posed = try mapper.retarget(calibration, &source_frame);
    const neck_index: usize = 4;
    const head_index: usize = 5;
    try testing.expect(rotationSimilarity(TARGET_BONES[neck_index].bind_rotation, posed.local_rotations[neck_index]) < 0.999);
    try testing.expect(rotationSimilarity(TARGET_BONES[head_index].bind_rotation, posed.local_rotations[head_index]) < 0.999);
    try testing.expectEqualSlices(f32, &TARGET_BONES[9].bind_rotation, &posed.local_rotations[9]);
    try testing.expectEqualSlices(f32, &TARGET_BONES[12].bind_rotation, &posed.local_rotations[12]);

    var missing = detected;
    setFacePairConfidence(&missing, 0.1);
    missing.frame_id = 2;
    missing.timestamp_ms = 1_100;
    source_frame = try source.reconstruct(&missing, calibration, .positive, source.DEFAULT_TUNING);
    const hold_start = try mapper.retarget(calibration, &source_frame);
    missing.frame_id = 3;
    missing.timestamp_ms = 1_250;
    source_frame = try source.reconstruct(&missing, calibration, .positive, source.DEFAULT_TUNING);
    const hold_end = try mapper.retarget(calibration, &source_frame);
    for ([_]usize{ neck_index, head_index }) |index| {
        try testing.expect(rotationSimilarity(posed.local_rotations[index], hold_start.local_rotations[index]) > 0.99999);
        try testing.expect(rotationSimilarity(posed.local_rotations[index], hold_end.local_rotations[index]) > 0.99999);
    }

    missing.frame_id = 4;
    missing.timestamp_ms = 1_425;
    source_frame = try source.reconstruct(&missing, calibration, .positive, source.DEFAULT_TUNING);
    const fading = try mapper.retarget(calibration, &source_frame);
    for ([_]usize{ neck_index, head_index }) |index| {
        try testing.expect(rotationSimilarity(TARGET_BONES[index].bind_rotation, fading.local_rotations[index]) >
            rotationSimilarity(TARGET_BONES[index].bind_rotation, posed.local_rotations[index]));
    }

    missing.frame_id = 5;
    missing.timestamp_ms = 1_600;
    source_frame = try source.reconstruct(&missing, calibration, .positive, source.DEFAULT_TUNING);
    const bound = try mapper.retarget(calibration, &source_frame);
    for ([_]usize{ neck_index, head_index }) |index| {
        try testing.expect(rotationSimilarity(TARGET_BONES[index].bind_rotation, bound.local_rotations[index]) > 0.99999);
    }
}

test "triplet promotion rejects mixed frames and freeze pins one immutable triplet" {
    const calibration = try calibrateRest();
    var detected = makeFrame(1, 30_000, 0.9);
    var reconstructed = try source.reconstruct(&detected, calibration, .positive, source.DEFAULT_TUNING);
    var target = retarget.TargetPoseFrame{
        .frame_id = 1,
        .timestamp_ms = 30_000,
        .bone_count = 1,
        .root_translation = .{ 0, 0, 0 },
        .local_rotations = @splat(fk.IDENTITY_QUAT),
    };
    var state = retarget.TripletState{};
    try state.promote(.{
        .camera = .{ .frame_id = 1, .timestamp_ms = 30_000, .token = 101 },
        .detected = detected,
        .reconstructed = reconstructed,
        .target = target,
    });
    try state.freeze();

    detected.frame_id = 2;
    detected.timestamp_ms = 30_100;
    reconstructed.frame_id = 2;
    reconstructed.timestamp_ms = 30_100;
    target.frame_id = 2;
    target.timestamp_ms = 30_100;
    try state.promote(.{
        .camera = .{ .frame_id = 2, .timestamp_ms = 30_100, .token = 102 },
        .detected = detected,
        .reconstructed = reconstructed,
        .target = target,
    });
    try testing.expectEqual(@as(u64, 1), state.visible().?.camera.frame_id);
    state.resumeLive();
    try testing.expectEqual(@as(u64, 2), state.visible().?.camera.frame_id);

    target.frame_id = 99;
    try testing.expectError(error.FrameIdentityMismatch, state.promote(.{
        .camera = .{ .frame_id = 3, .timestamp_ms = 30_200, .token = 103 },
        .detected = detected,
        .reconstructed = reconstructed,
        .target = target,
    }));
    try testing.expectEqual(@as(u64, 2), state.visible().?.camera.frame_id);
}
