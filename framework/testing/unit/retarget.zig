//! Focused calibration, world-landmark assembly, retarget, recovery, and
//! frame-identity proofs.
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

const Placement = struct {
    world: [3]f32,
    screen: [2]f32,
};

/// A camera-facing standing figure in MediaPipe world convention: metres,
/// hip-centred, y DOWN, z toward the subject's rear (face points at negative
/// z). Subject-left is +x, matching the model's real output.
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

fn makeFrame(frame_id: u64, timestamp_ms: u64, visibility: f32) source.WorldLandmarkFrame {
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

fn landmarkAt(frame: *source.WorldLandmarkFrame, name: source.WorldLandmarkName) *source.WorldLandmark {
    return &frame.landmarks[@intFromEnum(name)];
}

/// Roll a facial landmark pair about its midpoint in the world x/y plane —
/// an in-image head roll expressed in metric 3D.
fn rollFacePair(
    frame: *source.WorldLandmarkFrame,
    left_name: source.WorldLandmarkName,
    right_name: source.WorldLandmarkName,
    radians: f32,
) void {
    const left = landmarkAt(frame, left_name);
    const right = landmarkAt(frame, right_name);
    const midpoint_x = (left.world[0] + right.world[0]) * 0.5;
    const midpoint_y = (left.world[1] + right.world[1]) * 0.5;
    const half_x = (right.world[0] - left.world[0]) * 0.5;
    const half_y = -(right.world[1] - left.world[1]) * 0.5;
    const cosine = @cos(radians);
    const sine = @sin(radians);
    const rotated_x = cosine * half_x - sine * half_y;
    const rotated_y = sine * half_x + cosine * half_y;
    left.world[0] = midpoint_x - rotated_x;
    left.world[1] = midpoint_y + rotated_y;
    right.world[0] = midpoint_x + rotated_x;
    right.world[1] = midpoint_y - rotated_y;
}

fn rollFace(frame: *source.WorldLandmarkFrame, radians: f32) void {
    rollFacePair(frame, .eye_left, .eye_right, radians);
    rollFacePair(frame, .ear_left, .ear_right, radians);
}

fn setFacePairVisibility(frame: *source.WorldLandmarkFrame, visibility: f32) void {
    for ([_]source.WorldLandmarkName{ .eye_left, .eye_right, .ear_left, .ear_right }) |name| {
        landmarkAt(frame, name).visibility = visibility;
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
            landmarkAt(&frame, .elbow_left).world = .{ 0.60, -0.60, 0.30 };
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

test "calibration requires 30 distinct valid frames above the core gate within ten seconds" {
    const bar = source.DEFAULT_TUNING.minimum_confidence;
    var calibrator = try source.Calibrator.init(source.DEFAULT_TUNING);
    calibrator.begin(0);
    var rejected = makeFrame(1, 100, 0.8);
    landmarkAt(&rejected, .hip_left).visibility = bar - 0.001;
    try testing.expectEqual(source.CalibrationPush.ignored_invalid, try calibrator.push(&rejected));
    try testing.expectEqual(@as(u8, 0), calibrator.valid_frame_count);

    // Nobody in frame: presence below the floor is not a sample, no matter
    // how confident the individual landmarks claim to be.
    var absent = makeFrame(2, 150, 0.8);
    absent.presence = source.PRESENCE_FLOOR - 0.01;
    try testing.expectEqual(source.CalibrationPush.ignored_invalid, try calibrator.push(&absent));
    try testing.expectEqual(@as(u8, 0), calibrator.valid_frame_count);

    // Occluded facial pairs do NOT block calibration — the old 2D path's
    // facial-pair requirement was the calibration lottery, and it is gone.
    var faceless = makeFrame(3, 175, 0.8);
    setFacePairVisibility(&faceless, 0.1);
    try testing.expectEqual(source.CalibrationPush.accepted, try calibrator.push(&faceless));
    try testing.expectEqual(@as(u8, 1), calibrator.valid_frame_count);

    for (0..28) |index| {
        var frame = makeFrame(index + 4, @intCast(200 + index * 100), bar);
        try testing.expectEqual(source.CalibrationPush.accepted, try calibrator.push(&frame));
    }
    // Frame id 31 was the loop's last sample: a replayed id is not a frame.
    var replay = makeFrame(31, 5_100, 0.8);
    try testing.expectEqual(source.CalibrationPush.ignored_invalid, try calibrator.push(&replay));
    var thirtieth = makeFrame(32, 9_900, 0.8);
    try testing.expectEqual(source.CalibrationPush.completed, try calibrator.push(&thirtieth));
    try testing.expectEqual(source.CalibrationState.calibrated, calibrator.state);
    try testing.expectEqual(@as(u8, 30), calibrator.valid_frame_count);

    var expired = try source.Calibrator.init(source.DEFAULT_TUNING);
    expired.begin(0);
    var late = makeFrame(1, 10_001, 1);
    try testing.expectEqual(source.CalibrationPush.deadline_exceeded, try expired.push(&late));
    try testing.expectEqual(source.CalibrationState.failed, expired.state);
}

test "calibration uses medians and assembly passes metric depth straight through" {
    const calibration = try calibrateRest();
    // Upper arm from the standing figure: shoulder (0.17,-0.50) → elbow
    // (0.25,-0.28) in world metres = sqrt(0.08² + 0.22²). The one extreme
    // sample in calibrateRest must not move the median.
    const expected_upper_length = @sqrt(@as(f32, 0.08 * 0.08 + 0.22 * 0.22));
    try testing.expectApproxEqAbs(
        expected_upper_length,
        calibration.rest_segments[@intFromEnum(source.SegmentId.upper_arm_left)].length,
        1.0e-5,
    );
    // World landmarks are hip-centred, so rest hips sit at the origin and the
    // hip→head span is metric.
    try testing.expectApproxEqAbs(
        @as(f32, 0),
        vectorLength(calibration.rest_joints[@intFromEnum(source.JointId.hip_center)]),
        1.0e-4,
    );

    // The model says the elbow is 0.15 m toward the camera: SOURCE space
    // reports exactly that (+z toward camera), no sign input, no recovered
    // depth, no length clamp.
    var toward_camera = makeFrame(100, 12_000, 0.9);
    landmarkAt(&toward_camera, .elbow_left).world = .{ 0.25, -0.28, -0.15 };
    const assembled = try source.reconstruct(&toward_camera, calibration, source.DEFAULT_TUNING);
    try testing.expectApproxEqAbs(@as(f32, 0.15), assembled.joint(.elbow_left).position[2], 1.0e-4);
    const live_vector = [3]f32{
        0.25 - 0.17,
        -(-0.28) - 0.50, // source y: -(world y)
        0.15,
    };
    try testing.expectApproxEqAbs(
        vectorLength(live_vector),
        assembled.segment(.upper_arm_left).length,
        1.0e-4,
    );
}

test "hallucinated sub-floor limbs park at rest off their live parents" {
    const calibration = try calibrateRest();
    // A seated half-body subject: the model still positions legs, wildly and
    // differently every frame, at sub-floor confidence. Both frames must
    // assemble to the SAME parked leg — hanging off the live hip by the
    // calibrated rest offsets — instead of tap-dancing through the noise.
    var first = makeFrame(120, 13_000, 0.9);
    var second = makeFrame(121, 13_033, 0.9);
    const leg = [_]source.WorldLandmarkName{ .knee_left, .ankle_left, .knee_right, .ankle_right };
    for (leg, 0..) |name, index| {
        landmarkAt(&first, name).visibility = 0.1;
        landmarkAt(&second, name).visibility = 0.1;
        const wobble = @as(f32, @floatFromInt(index)) * 0.11;
        landmarkAt(&first, name).world = .{ 0.4 + wobble, 0.3 - wobble, 0.2 };
        landmarkAt(&second, name).world = .{ -0.3 - wobble, 0.6 + wobble, -0.25 };
    }
    const assembled_first = try source.reconstruct(&first, calibration, source.DEFAULT_TUNING);
    const assembled_second = try source.reconstruct(&second, calibration, source.DEFAULT_TUNING);
    for ([_]source.JointId{ .knee_left, .ankle_left, .knee_right, .ankle_right }) |joint_id| {
        const a = assembled_first.joint(joint_id).position;
        const b = assembled_second.joint(joint_id).position;
        try testing.expectApproxEqAbs(@as(f32, 0), vectorLength(.{ a[0] - b[0], a[1] - b[1], a[2] - b[2] }), 1.0e-5);
    }
    // Parked at the calibrated rest offset from the live hip, and still
    // reported unobserved so the retarget drive gate holds the rig legs.
    const hip = assembled_first.joint(.hip_left).position;
    const knee = assembled_first.joint(.knee_left).position;
    const rest_upper_leg = calibration.rest_segments[@intFromEnum(source.SegmentId.upper_leg_left)];
    try testing.expectApproxEqAbs(rest_upper_leg.length, vectorLength(.{ knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2] }), 1.0e-4);
    try testing.expect(assembled_first.segment(.upper_leg_left).confidence < 0.35);
}

test "nobody in frame assembles as all-unobserved at rest" {
    const calibration = try calibrateRest();
    var absent = makeFrame(110, 12_500, 0.9);
    absent.presence = 0.1;
    const assembled = try source.reconstruct(&absent, calibration, source.DEFAULT_TUNING);
    for (assembled.joints) |joint| try testing.expectEqual(@as(f32, 0), joint.confidence);
    for (assembled.segments) |segment| try testing.expectEqual(@as(f32, 0), segment.confidence);
    try testing.expectApproxEqAbs(
        @as(f32, 0),
        vectorLength(.{
            assembled.joint(.hip_center).position[0] - calibration.rest_joints[@intFromEnum(source.JointId.hip_center)][0],
            assembled.joint(.hip_center).position[1] - calibration.rest_joints[@intFromEnum(source.JointId.hip_center)][1],
            assembled.joint(.hip_center).position[2] - calibration.rest_joints[@intFromEnum(source.JointId.hip_center)][2],
        }),
        1.0e-6,
    );
}

test "confident eye and ear geometry authors the source head frame" {
    const calibration = try calibrateRest();
    const rest_head = calibration.rest_segments[@intFromEnum(source.SegmentId.head)];

    var rolled = makeFrame(101, 12_100, 0.9);
    rollFace(&rolled, std.math.pi / 6.0);
    const assembled = try source.reconstruct(&rolled, calibration, source.DEFAULT_TUNING);
    const head = assembled.segment(.head);
    try testing.expect(head.confidence >= 0.9);
    try testing.expect(rotationSimilarity(rest_head.rotation, head.rotation) < 0.99);

    var eyes_only = rolled;
    eyes_only.frame_id = 102;
    landmarkAt(&eyes_only, .ear_left).visibility = 0.1;
    landmarkAt(&eyes_only, .ear_right).visibility = 0.1;
    try testing.expect((try source.reconstruct(&eyes_only, calibration, source.DEFAULT_TUNING)).segment(.head).confidence >= 0.9);

    var ears_only = rolled;
    ears_only.frame_id = 103;
    landmarkAt(&ears_only, .eye_left).visibility = 0.1;
    landmarkAt(&ears_only, .eye_right).visibility = 0.1;
    try testing.expect((try source.reconstruct(&ears_only, calibration, source.DEFAULT_TUNING)).segment(.head).confidence >= 0.9);

    var missing = rolled;
    missing.frame_id = 104;
    setFacePairVisibility(&missing, 0.1);
    const missing_head = (try source.reconstruct(&missing, calibration, source.DEFAULT_TUNING)).segment(.head);
    try testing.expectEqual(@as(f32, 0), missing_head.confidence);
    try testing.expect(rotationSimilarity(rest_head.rotation, missing_head.rotation) > 0.99999);

    var missing_nose = rolled;
    missing_nose.frame_id = 105;
    landmarkAt(&missing_nose, .nose).visibility = 0.1;
    try testing.expectEqual(
        @as(f32, 0),
        (try source.reconstruct(&missing_nose, calibration, source.DEFAULT_TUNING)).segment(.head).confidence,
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
    var frame = try source.reconstruct(&detected, calibration, source.DEFAULT_TUNING);
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
    var source_frame = try source.reconstruct(&detected, calibration, source.DEFAULT_TUNING);
    const posed = try mapper.retarget(calibration, &source_frame);
    const neck_index: usize = 4;
    const head_index: usize = 5;
    try testing.expect(rotationSimilarity(TARGET_BONES[neck_index].bind_rotation, posed.local_rotations[neck_index]) < 0.999);
    try testing.expect(rotationSimilarity(TARGET_BONES[head_index].bind_rotation, posed.local_rotations[head_index]) < 0.999);
    try testing.expectEqualSlices(f32, &TARGET_BONES[9].bind_rotation, &posed.local_rotations[9]);
    try testing.expectEqualSlices(f32, &TARGET_BONES[12].bind_rotation, &posed.local_rotations[12]);

    var missing = detected;
    setFacePairVisibility(&missing, 0.1);
    missing.frame_id = 2;
    missing.timestamp_ms = 1_100;
    source_frame = try source.reconstruct(&missing, calibration, source.DEFAULT_TUNING);
    const hold_start = try mapper.retarget(calibration, &source_frame);
    missing.frame_id = 3;
    missing.timestamp_ms = 1_250;
    source_frame = try source.reconstruct(&missing, calibration, source.DEFAULT_TUNING);
    const hold_end = try mapper.retarget(calibration, &source_frame);
    for ([_]usize{ neck_index, head_index }) |index| {
        try testing.expect(rotationSimilarity(posed.local_rotations[index], hold_start.local_rotations[index]) > 0.99999);
        try testing.expect(rotationSimilarity(posed.local_rotations[index], hold_end.local_rotations[index]) > 0.99999);
    }

    missing.frame_id = 4;
    missing.timestamp_ms = 1_425;
    source_frame = try source.reconstruct(&missing, calibration, source.DEFAULT_TUNING);
    const fading = try mapper.retarget(calibration, &source_frame);
    for ([_]usize{ neck_index, head_index }) |index| {
        try testing.expect(rotationSimilarity(TARGET_BONES[index].bind_rotation, fading.local_rotations[index]) >
            rotationSimilarity(TARGET_BONES[index].bind_rotation, posed.local_rotations[index]));
    }

    missing.frame_id = 5;
    missing.timestamp_ms = 1_600;
    source_frame = try source.reconstruct(&missing, calibration, source.DEFAULT_TUNING);
    const bound = try mapper.retarget(calibration, &source_frame);
    for ([_]usize{ neck_index, head_index }) |index| {
        try testing.expect(rotationSimilarity(TARGET_BONES[index].bind_rotation, bound.local_rotations[index]) > 0.99999);
    }
}

test "triplet promotion rejects mixed frames and freeze pins one immutable triplet" {
    const calibration = try calibrateRest();
    var detected = makeFrame(1, 30_000, 0.9);
    var reconstructed = try source.reconstruct(&detected, calibration, source.DEFAULT_TUNING);
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
