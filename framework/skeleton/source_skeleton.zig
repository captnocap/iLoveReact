//! MoveNet landmark calibration and calibrated 3D source-skeleton recovery.
//!
//! The camera supplies immutable COCO-17 frames. Thirty fully valid frames
//! establish median source-space joints, segment directions, and lengths. Live
//! reconstruction keeps those segment lengths and makes monocular depth sign an
//! explicit input; it never fabricates a camera-side choice.

const std = @import("std");
const fk = @import("fk_pose.zig");

pub const Vec3 = fk.Vec3;

pub const KEYPOINT_COUNT: usize = 17;
pub const JOINT_COUNT: usize = 16;
pub const SEGMENT_COUNT: usize = 12;
pub const CALIBRATION_FRAME_COUNT: usize = 30;

pub const Tuning = struct {
    // MoveNet Lightning scores full-body footage that doesn't fill the 16:9
    // frame at ~0.27..0.77 after the 192x192 letterbox (measured live on the
    // OBS reference feed, req_4262/req_4263). The old 0.5 floor made every
    // such frame invalid — calibration could never collect one sample — and
    // even ordinary occlusion (a hand resting in a pocket) reports ~0.27 with
    // a plausible position. Absent limbs score ~0.1..0.2. 0.25 lets the
    // median-of-30 calibration accept what the model actually reports on
    // working footage; live retargeting keeps its own stricter drive gate
    // (humanoid_retarget.Tuning.minimum_confidence).
    minimum_confidence: f32 = 0.25,
    calibration_frame_count: usize = CALIBRATION_FRAME_COUNT,
    calibration_deadline_ms: u64 = 10_000,
    numeric_epsilon: f32 = 1.0e-6,
};

pub const DEFAULT_TUNING = Tuning{};

pub const KeypointName = enum(u8) {
    nose,
    eye_left,
    eye_right,
    ear_left,
    ear_right,
    shoulder_left,
    shoulder_right,
    elbow_left,
    elbow_right,
    wrist_left,
    wrist_right,
    hip_left,
    hip_right,
    knee_left,
    knee_right,
    ankle_left,
    ankle_right,
};

pub const CameraKeypoint = struct {
    name: KeypointName,
    x: f32,
    y: f32,
    confidence: f32,
};

pub const DetectedLandmarkFrame = struct {
    frame_id: u64,
    timestamp_ms: u64,
    keypoints: [KEYPOINT_COUNT]CameraKeypoint,
};

pub const JointId = enum(u8) {
    shoulder_left,
    shoulder_right,
    elbow_left,
    elbow_right,
    wrist_left,
    wrist_right,
    hip_left,
    hip_right,
    knee_left,
    knee_right,
    ankle_left,
    ankle_right,
    shoulder_center,
    hip_center,
    spine,
    head,
};

pub const SegmentId = enum(u8) {
    upper_arm_left,
    lower_arm_left,
    upper_arm_right,
    lower_arm_right,
    upper_leg_left,
    lower_leg_left,
    upper_leg_right,
    lower_leg_right,
    shoulder_line,
    hip_line,
    spine,
    head,
};

pub const SourceJoint = struct {
    id: JointId,
    position: Vec3,
    confidence: f32,
};

pub const SegmentFrame = struct {
    id: SegmentId,
    origin: Vec3,
    direction: Vec3,
    rotation: fk.Quat,
    length: f32,
    confidence: f32,
};

pub const SourceSkeletonFrame = struct {
    frame_id: u64,
    timestamp_ms: u64,
    joints: [JOINT_COUNT]SourceJoint,
    segments: [SEGMENT_COUNT]SegmentFrame,

    pub fn joint(self: *const SourceSkeletonFrame, id: JointId) SourceJoint {
        return self.joints[@intFromEnum(id)];
    }

    pub fn segment(self: *const SourceSkeletonFrame, id: SegmentId) SegmentFrame {
        return self.segments[@intFromEnum(id)];
    }
};

pub const RestSegment = struct {
    direction: Vec3,
    rotation: fk.Quat,
    length: f32,
};

pub const Calibration = struct {
    rest_joints: [JOINT_COUNT]Vec3,
    rest_segments: [SEGMENT_COUNT]RestSegment,
    image_hip_center: [2]f32,
    image_hip_head_length: f32,
};

pub const CalibrationState = enum {
    uncalibrated,
    collecting,
    calibrated,
    failed,
};

pub const CalibrationPush = enum {
    accepted,
    ignored_invalid,
    completed,
    deadline_exceeded,
    not_collecting,
};

pub const DepthSign = enum(i8) {
    negative = -1,
    positive = 1,
};

pub const Error = fk.Error || error{
    InvalidTuning,
    InvalidFrame,
    CalibrationUnavailable,
};

// A calibration frame is valid when the CORE that defines the sample's center
// and scale (hip center, hip-to-head height, shoulder line, facial baseline)
// is confidently observed. Limb keypoints join every sample at their reported
// positions regardless of confidence — the median over the 30 samples is the
// noise filter — because footage of a moving subject (the video workflow,
// req_4265) essentially never offers 30 frames where all four limbs are
// simultaneously confident, and demanding that made calibration a lottery.
// Live retargeting still gates each limb per frame at its own stricter floor.
const REQUIRED_KEYPOINTS = [_]KeypointName{
    .nose,
    .shoulder_left,
    .shoulder_right,
    .hip_left,
    .hip_right,
};

const SegmentDefinition = struct {
    id: SegmentId,
    from: JointId,
    to: JointId,
};

pub const SEGMENTS = [_]SegmentDefinition{
    .{ .id = .upper_arm_left, .from = .shoulder_left, .to = .elbow_left },
    .{ .id = .lower_arm_left, .from = .elbow_left, .to = .wrist_left },
    .{ .id = .upper_arm_right, .from = .shoulder_right, .to = .elbow_right },
    .{ .id = .lower_arm_right, .from = .elbow_right, .to = .wrist_right },
    .{ .id = .upper_leg_left, .from = .hip_left, .to = .knee_left },
    .{ .id = .lower_leg_left, .from = .knee_left, .to = .ankle_left },
    .{ .id = .upper_leg_right, .from = .hip_right, .to = .knee_right },
    .{ .id = .lower_leg_right, .from = .knee_right, .to = .ankle_right },
    .{ .id = .shoulder_line, .from = .shoulder_left, .to = .shoulder_right },
    .{ .id = .hip_line, .from = .hip_left, .to = .hip_right },
    .{ .id = .spine, .from = .hip_center, .to = .shoulder_center },
    .{ .id = .head, .from = .shoulder_center, .to = .head },
};

const Sample = struct {
    joints: [JOINT_COUNT]Vec3,
    segments: [SEGMENT_COUNT]RestSegment,
    raw_hip_center: [2]f32,
    raw_hip_head_length: f32,
};

fn tuningValid(tuning: Tuning) bool {
    return std.math.isFinite(tuning.minimum_confidence) and
        tuning.minimum_confidence >= 0 and tuning.minimum_confidence <= 1 and
        tuning.calibration_frame_count == CALIBRATION_FRAME_COUNT and
        tuning.calibration_deadline_ms > 0 and
        std.math.isFinite(tuning.numeric_epsilon) and tuning.numeric_epsilon > 0;
}

fn add(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}

fn sub(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}

fn scale(v: Vec3, factor: f32) Vec3 {
    return .{ v[0] * factor, v[1] * factor, v[2] * factor };
}

fn dot(a: Vec3, b: Vec3) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

fn length(v: Vec3) f32 {
    return @sqrt(dot(v, v));
}

fn normalize(v: Vec3, epsilon: f32) ?Vec3 {
    const magnitude = length(v);
    if (!std.math.isFinite(magnitude) or magnitude <= epsilon) return null;
    return scale(v, 1 / magnitude);
}

fn midpoint(a: Vec3, b: Vec3) Vec3 {
    return scale(add(a, b), 0.5);
}

fn cross(a: Vec3, b: Vec3) Vec3 {
    return .{
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    };
}

fn quaternionFromBasis(x: Vec3, y: Vec3, z: Vec3) Error!fk.Quat {
    const m00 = x[0];
    const m01 = y[0];
    const m02 = z[0];
    const m10 = x[1];
    const m11 = y[1];
    const m12 = z[1];
    const m20 = x[2];
    const m21 = y[2];
    const m22 = z[2];
    const trace = m00 + m11 + m22;
    var q: fk.Quat = undefined;
    if (trace > 0) {
        const s: f32 = @sqrt(trace + 1) * 2;
        q = .{ (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s };
    } else if (m00 > m11 and m00 > m22) {
        const s: f32 = @sqrt(1 + m00 - m11 - m22) * 2;
        q = .{ 0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s };
    } else if (m11 > m22) {
        const s: f32 = @sqrt(1 + m11 - m00 - m22) * 2;
        q = .{ (m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s };
    } else {
        const s: f32 = @sqrt(1 + m22 - m00 - m11) * 2;
        q = .{ (m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s };
    }
    return fk.normalizeQuat(q);
}

fn segmentRotation(direction_raw: Vec3, epsilon: f32) Error!fk.Quat {
    const y = normalize(direction_raw, epsilon) orelse return error.InvalidFrame;
    var z = sub(.{ 0, 0, 1 }, scale(y, y[2]));
    if (normalize(z, epsilon) == null) z = sub(.{ 1, 0, 0 }, scale(y, y[0]));
    z = normalize(z, epsilon) orelse return error.InvalidFrame;
    const x = normalize(cross(y, z), epsilon) orelse return error.InvalidFrame;
    z = normalize(cross(x, y), epsilon) orelse return error.InvalidFrame;
    return quaternionFromBasis(x, y, z);
}

fn framePoints(frame: *const DetectedLandmarkFrame) Error![KEYPOINT_COUNT]CameraKeypoint {
    var ordered: [KEYPOINT_COUNT]CameraKeypoint = undefined;
    var seen: [KEYPOINT_COUNT]bool = @splat(false);
    for (frame.keypoints) |point| {
        const index = @intFromEnum(point.name);
        if (seen[index] or !std.math.isFinite(point.x) or !std.math.isFinite(point.y) or
            !std.math.isFinite(point.confidence) or point.confidence < 0 or point.confidence > 1)
        {
            return error.InvalidFrame;
        }
        seen[index] = true;
        ordered[index] = point;
    }
    for (seen) |present| if (!present) return error.InvalidFrame;
    return ordered;
}

fn imagePoint(point: CameraKeypoint) Vec3 {
    return .{ point.x, -point.y, 0 };
}

const FacePair = struct {
    lateral: Vec3,
    confidence: f32,
};

const FaceFrame = struct {
    direction: Vec3,
    rotation: fk.Quat,
    confidence: f32,
};

fn facePair(
    points: [KEYPOINT_COUNT]CameraKeypoint,
    left_name: KeypointName,
    right_name: KeypointName,
    tuning: Tuning,
) ?FacePair {
    const left = observed(points, left_name, tuning) orelse return null;
    const right = observed(points, right_name, tuning) orelse return null;
    return .{
        .lateral = normalize(sub(imagePoint(right), imagePoint(left)), tuning.numeric_epsilon) orelse return null,
        .confidence = @min(left.confidence, right.confidence),
    };
}

/// Build a full source-space head frame from facial geometry. Paired eyes and
/// ears provide the lateral axis; shoulders-to-nose only resolves which
/// perpendicular points anatomically upward. A single confident pair is
/// sufficient, while two pairs are confidence-weighted for a steadier frame.
fn facialFrame(points: [KEYPOINT_COUNT]CameraKeypoint, tuning: Tuning) ?FaceFrame {
    const nose = observed(points, .nose, tuning) orelse return null;
    const shoulder_left = observed(points, .shoulder_left, tuning) orelse return null;
    const shoulder_right = observed(points, .shoulder_right, tuning) orelse return null;
    const eye_pair = facePair(points, .eye_left, .eye_right, tuning);
    const ear_pair = facePair(points, .ear_left, .ear_right, tuning);
    if (eye_pair == null and ear_pair == null) return null;

    var lateral_sum: Vec3 = .{ 0, 0, 0 };
    var facial_confidence: f32 = 0;
    if (eye_pair) |pair| {
        lateral_sum = add(lateral_sum, scale(pair.lateral, pair.confidence));
        facial_confidence = @max(facial_confidence, pair.confidence);
    }
    if (ear_pair) |pair| {
        lateral_sum = add(lateral_sum, scale(pair.lateral, pair.confidence));
        facial_confidence = @max(facial_confidence, pair.confidence);
    }
    var x = normalize(lateral_sum, tuning.numeric_epsilon) orelse return null;
    const shoulder_center = midpoint(imagePoint(shoulder_left), imagePoint(shoulder_right));
    const upward_hint = sub(imagePoint(nose), shoulder_center);
    const y = normalize(
        sub(upward_hint, scale(x, dot(upward_hint, x))),
        tuning.numeric_epsilon,
    ) orelse return null;
    const z = normalize(cross(x, y), tuning.numeric_epsilon) orelse return null;
    x = normalize(cross(y, z), tuning.numeric_epsilon) orelse return null;
    return .{
        .direction = y,
        .rotation = quaternionFromBasis(x, y, z) catch return null,
        .confidence = @min(
            @min(nose.confidence, @min(shoulder_left.confidence, shoulder_right.confidence)),
            facial_confidence,
        ),
    };
}

fn setDirectJoint(joints: *[JOINT_COUNT]Vec3, id: JointId, point: Vec3) void {
    joints[@intFromEnum(id)] = point;
}

fn directJointLayout(points: [KEYPOINT_COUNT]CameraKeypoint) [JOINT_COUNT]Vec3 {
    var joints: [JOINT_COUNT]Vec3 = @splat(.{ 0, 0, 0 });
    setDirectJoint(&joints, .shoulder_left, imagePoint(points[@intFromEnum(KeypointName.shoulder_left)]));
    setDirectJoint(&joints, .shoulder_right, imagePoint(points[@intFromEnum(KeypointName.shoulder_right)]));
    setDirectJoint(&joints, .elbow_left, imagePoint(points[@intFromEnum(KeypointName.elbow_left)]));
    setDirectJoint(&joints, .elbow_right, imagePoint(points[@intFromEnum(KeypointName.elbow_right)]));
    setDirectJoint(&joints, .wrist_left, imagePoint(points[@intFromEnum(KeypointName.wrist_left)]));
    setDirectJoint(&joints, .wrist_right, imagePoint(points[@intFromEnum(KeypointName.wrist_right)]));
    setDirectJoint(&joints, .hip_left, imagePoint(points[@intFromEnum(KeypointName.hip_left)]));
    setDirectJoint(&joints, .hip_right, imagePoint(points[@intFromEnum(KeypointName.hip_right)]));
    setDirectJoint(&joints, .knee_left, imagePoint(points[@intFromEnum(KeypointName.knee_left)]));
    setDirectJoint(&joints, .knee_right, imagePoint(points[@intFromEnum(KeypointName.knee_right)]));
    setDirectJoint(&joints, .ankle_left, imagePoint(points[@intFromEnum(KeypointName.ankle_left)]));
    setDirectJoint(&joints, .ankle_right, imagePoint(points[@intFromEnum(KeypointName.ankle_right)]));
    joints[@intFromEnum(JointId.shoulder_center)] = midpoint(
        joints[@intFromEnum(JointId.shoulder_left)],
        joints[@intFromEnum(JointId.shoulder_right)],
    );
    joints[@intFromEnum(JointId.hip_center)] = midpoint(
        joints[@intFromEnum(JointId.hip_left)],
        joints[@intFromEnum(JointId.hip_right)],
    );
    joints[@intFromEnum(JointId.spine)] = midpoint(
        joints[@intFromEnum(JointId.hip_center)],
        joints[@intFromEnum(JointId.shoulder_center)],
    );
    joints[@intFromEnum(JointId.head)] = imagePoint(points[@intFromEnum(KeypointName.nose)]);
    return joints;
}

fn sampleFromFrame(frame: *const DetectedLandmarkFrame, tuning: Tuning) Error!?Sample {
    const points = try framePoints(frame);
    for (REQUIRED_KEYPOINTS) |name| {
        if (points[@intFromEnum(name)].confidence < tuning.minimum_confidence) return null;
    }
    const head_frame = facialFrame(points, tuning) orelse return null;
    var joints = directJointLayout(points);
    const raw_hip = joints[@intFromEnum(JointId.hip_center)];
    const raw_head = joints[@intFromEnum(JointId.head)];
    const raw_height = length(sub(raw_head, raw_hip));
    if (raw_height <= tuning.numeric_epsilon) return null;
    for (&joints) |*joint| joint.* = scale(sub(joint.*, raw_hip), 1 / raw_height);
    var segments: [SEGMENT_COUNT]RestSegment = undefined;
    for (SEGMENTS) |definition| {
        const vector = sub(joints[@intFromEnum(definition.to)], joints[@intFromEnum(definition.from)]);
        const segment_length = length(vector);
        if (segment_length <= tuning.numeric_epsilon) return null;
        segments[@intFromEnum(definition.id)] = .{
            .direction = normalize(vector, tuning.numeric_epsilon).?,
            .rotation = try segmentRotation(vector, tuning.numeric_epsilon),
            .length = segment_length,
        };
    }
    segments[@intFromEnum(SegmentId.head)].direction = head_frame.direction;
    segments[@intFromEnum(SegmentId.head)].rotation = head_frame.rotation;
    return .{
        .joints = joints,
        .segments = segments,
        .raw_hip_center = .{ raw_hip[0], -raw_hip[1] },
        .raw_hip_head_length = raw_height,
    };
}

fn median(values: *[CALIBRATION_FRAME_COUNT]f32) f32 {
    std.mem.sort(f32, values, {}, std.sort.asc(f32));
    return (values[CALIBRATION_FRAME_COUNT / 2 - 1] + values[CALIBRATION_FRAME_COUNT / 2]) * 0.5;
}

fn medianSegmentRotation(
    samples: *const [CALIBRATION_FRAME_COUNT]Sample,
    segment_index: usize,
    values: *[CALIBRATION_FRAME_COUNT]f32,
) Error!fk.Quat {
    const reference = samples[0].segments[segment_index].rotation;
    var result: fk.Quat = undefined;
    for (0..4) |component| {
        for (samples, 0..) |sample, sample_index| {
            const rotation = sample.segments[segment_index].rotation;
            const hemisphere: f32 = if (fk.dotQuat(reference, rotation) < 0) -1 else 1;
            values[sample_index] = rotation[component] * hemisphere;
        }
        result[component] = median(values);
    }
    return fk.normalizeQuat(result);
}

pub const Calibrator = struct {
    tuning: Tuning = DEFAULT_TUNING,
    state: CalibrationState = .uncalibrated,
    started_ms: u64 = 0,
    valid_frame_count: u8 = 0,
    last_frame_id: ?u64 = null,
    samples: [CALIBRATION_FRAME_COUNT]Sample = undefined,
    result: ?Calibration = null,

    pub fn init(tuning: Tuning) Error!Calibrator {
        if (!tuningValid(tuning)) return error.InvalidTuning;
        return .{ .tuning = tuning };
    }

    pub fn begin(self: *Calibrator, timestamp_ms: u64) void {
        self.state = .collecting;
        self.started_ms = timestamp_ms;
        self.valid_frame_count = 0;
        self.last_frame_id = null;
        self.result = null;
    }

    /// Camera changes call reset, invalidating both samples and solved rest data.
    pub fn reset(self: *Calibrator) void {
        self.state = .uncalibrated;
        self.started_ms = 0;
        self.valid_frame_count = 0;
        self.last_frame_id = null;
        self.result = null;
    }

    fn finish(self: *Calibrator) Error!void {
        var calibration: Calibration = undefined;
        var values: [CALIBRATION_FRAME_COUNT]f32 = undefined;
        for (0..JOINT_COUNT) |joint_index| for (0..3) |component| {
            for (self.samples, 0..) |sample, sample_index| values[sample_index] = sample.joints[joint_index][component];
            calibration.rest_joints[joint_index][component] = median(&values);
        };
        for (0..SEGMENT_COUNT) |segment_index| {
            var direction: Vec3 = undefined;
            for (0..3) |component| {
                for (self.samples, 0..) |sample, sample_index| values[sample_index] = sample.segments[segment_index].direction[component];
                direction[component] = median(&values);
            }
            for (self.samples, 0..) |sample, sample_index| values[sample_index] = sample.segments[segment_index].length;
            calibration.rest_segments[segment_index] = .{
                .direction = normalize(direction, self.tuning.numeric_epsilon) orelse return error.InvalidFrame,
                .rotation = undefined,
                .length = median(&values),
            };
            if (segment_index == @intFromEnum(SegmentId.head)) {
                const rotation = try medianSegmentRotation(&self.samples, segment_index, &values);
                calibration.rest_segments[segment_index].rotation = rotation;
                calibration.rest_segments[segment_index].direction = try fk.rotateVec3(rotation, .{ 0, 1, 0 });
            } else {
                calibration.rest_segments[segment_index].rotation = try segmentRotation(
                    calibration.rest_segments[segment_index].direction,
                    self.tuning.numeric_epsilon,
                );
            }
        }
        for (self.samples, 0..) |sample, sample_index| values[sample_index] = sample.raw_hip_center[0];
        calibration.image_hip_center[0] = median(&values);
        for (self.samples, 0..) |sample, sample_index| values[sample_index] = sample.raw_hip_center[1];
        calibration.image_hip_center[1] = median(&values);
        for (self.samples, 0..) |sample, sample_index| values[sample_index] = sample.raw_hip_head_length;
        calibration.image_hip_head_length = median(&values);
        self.result = calibration;
        self.state = .calibrated;
    }

    pub fn push(self: *Calibrator, frame: *const DetectedLandmarkFrame) Error!CalibrationPush {
        if (self.state != .collecting) return .not_collecting;
        if (frame.timestamp_ms < self.started_ms or
            frame.timestamp_ms - self.started_ms > self.tuning.calibration_deadline_ms)
        {
            self.state = .failed;
            return .deadline_exceeded;
        }
        if (self.last_frame_id) |last| if (frame.frame_id <= last) return .ignored_invalid;
        const sample = try sampleFromFrame(frame, self.tuning) orelse return .ignored_invalid;
        self.samples[self.valid_frame_count] = sample;
        self.valid_frame_count += 1;
        self.last_frame_id = frame.frame_id;
        if (self.valid_frame_count == CALIBRATION_FRAME_COUNT) {
            try self.finish();
            return .completed;
        }
        return .accepted;
    }
};

fn observed(points: [KEYPOINT_COUNT]CameraKeypoint, name: KeypointName, tuning: Tuning) ?CameraKeypoint {
    const point = points[@intFromEnum(name)];
    return if (point.confidence >= tuning.minimum_confidence) point else null;
}

fn calibratedPoint(point: CameraKeypoint, calibration: Calibration) Vec3 {
    return .{
        (point.x - calibration.image_hip_center[0]) / calibration.image_hip_head_length,
        -(point.y - calibration.image_hip_center[1]) / calibration.image_hip_head_length,
        0,
    };
}

fn jointKeypoint(id: JointId) ?KeypointName {
    return switch (id) {
        .shoulder_left => .shoulder_left,
        .shoulder_right => .shoulder_right,
        .elbow_left => .elbow_left,
        .elbow_right => .elbow_right,
        .wrist_left => .wrist_left,
        .wrist_right => .wrist_right,
        .hip_left => .hip_left,
        .hip_right => .hip_right,
        .knee_left => .knee_left,
        .knee_right => .knee_right,
        .ankle_left => .ankle_left,
        .ankle_right => .ankle_right,
        .head => .nose,
        .shoulder_center, .hip_center, .spine => null,
    };
}

fn reconstructLimbSegment(
    joints: *[JOINT_COUNT]SourceJoint,
    points: [KEYPOINT_COUNT]CameraKeypoint,
    calibration: Calibration,
    tuning: Tuning,
    depth_sign: DepthSign,
    segment_id: SegmentId,
    from_id: JointId,
    to_id: JointId,
) void {
    const rest = calibration.rest_segments[@intFromEnum(segment_id)];
    const from_key = jointKeypoint(from_id).?;
    const to_key = jointKeypoint(to_id).?;
    const from_point = observed(points, from_key, tuning);
    const to_point = observed(points, to_key, tuning);
    const parent = joints[@intFromEnum(from_id)];
    if (from_point == null or to_point == null) {
        joints[@intFromEnum(to_id)] = .{
            .id = to_id,
            .position = add(parent.position, scale(rest.direction, rest.length)),
            .confidence = 0,
        };
        return;
    }
    const raw_delta = sub(calibratedPoint(to_point.?, calibration), calibratedPoint(from_point.?, calibration));
    var planar = Vec3{ raw_delta[0], raw_delta[1], 0 };
    var projected = length(planar);
    if (projected > rest.length) {
        planar = scale(planar, rest.length / projected);
        projected = rest.length;
    }
    const depth: f32 = @sqrt(@max(0, rest.length * rest.length - projected * projected)) *
        @as(f32, @floatFromInt(@intFromEnum(depth_sign)));
    const vector = Vec3{ planar[0], planar[1], depth };
    joints[@intFromEnum(to_id)] = .{
        .id = to_id,
        .position = add(parent.position, vector),
        .confidence = @min(from_point.?.confidence, to_point.?.confidence),
    };
}

/// Reconstruct one calibrated source frame. Segment lengths remain equal to
/// calibration even when the observed projection is foreshortened.
pub fn reconstruct(
    frame: *const DetectedLandmarkFrame,
    calibration: Calibration,
    depth_sign: DepthSign,
    tuning: Tuning,
) Error!SourceSkeletonFrame {
    if (!tuningValid(tuning) or calibration.image_hip_head_length <= tuning.numeric_epsilon) {
        return error.CalibrationUnavailable;
    }
    const points = try framePoints(frame);
    var joints: [JOINT_COUNT]SourceJoint = undefined;
    for (0..JOINT_COUNT) |index| joints[index] = .{
        .id = @enumFromInt(index),
        .position = calibration.rest_joints[index],
        .confidence = 0,
    };

    var hip_displacement: Vec3 = .{ 0, 0, 0 };
    const hip_left_point = observed(points, .hip_left, tuning);
    const hip_right_point = observed(points, .hip_right, tuning);
    if (hip_left_point != null and hip_right_point != null) {
        const current_hip = midpoint(
            calibratedPoint(hip_left_point.?, calibration),
            calibratedPoint(hip_right_point.?, calibration),
        );
        hip_displacement = sub(current_hip, calibration.rest_joints[@intFromEnum(JointId.hip_center)]);
    }
    for (&joints) |*joint| joint.position = add(joint.position, hip_displacement);
    for ([_]JointId{ .shoulder_left, .shoulder_right, .hip_left, .hip_right, .head }) |joint_id| {
        const key = jointKeypoint(joint_id).?;
        if (observed(points, key, tuning)) |point| joints[@intFromEnum(joint_id)] = .{
            .id = joint_id,
            .position = calibratedPoint(point, calibration),
            .confidence = point.confidence,
        };
    }

    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .upper_arm_left, .shoulder_left, .elbow_left);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .lower_arm_left, .elbow_left, .wrist_left);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .upper_arm_right, .shoulder_right, .elbow_right);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .lower_arm_right, .elbow_right, .wrist_right);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .upper_leg_left, .hip_left, .knee_left);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .lower_leg_left, .knee_left, .ankle_left);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .upper_leg_right, .hip_right, .knee_right);
    reconstructLimbSegment(&joints, points, calibration, tuning, depth_sign, .lower_leg_right, .knee_right, .ankle_right);

    const shoulder_left = joints[@intFromEnum(JointId.shoulder_left)];
    const shoulder_right = joints[@intFromEnum(JointId.shoulder_right)];
    const hip_left = joints[@intFromEnum(JointId.hip_left)];
    const hip_right = joints[@intFromEnum(JointId.hip_right)];
    joints[@intFromEnum(JointId.shoulder_center)] = .{
        .id = .shoulder_center,
        .position = midpoint(shoulder_left.position, shoulder_right.position),
        .confidence = @min(shoulder_left.confidence, shoulder_right.confidence),
    };
    joints[@intFromEnum(JointId.hip_center)] = .{
        .id = .hip_center,
        .position = midpoint(hip_left.position, hip_right.position),
        .confidence = @min(hip_left.confidence, hip_right.confidence),
    };
    const hip_center = joints[@intFromEnum(JointId.hip_center)];
    const shoulder_center = joints[@intFromEnum(JointId.shoulder_center)];
    joints[@intFromEnum(JointId.spine)] = .{
        .id = .spine,
        .position = midpoint(hip_center.position, shoulder_center.position),
        .confidence = @min(hip_center.confidence, shoulder_center.confidence),
    };

    var segments: [SEGMENT_COUNT]SegmentFrame = undefined;
    for (SEGMENTS) |definition| {
        const from = joints[@intFromEnum(definition.from)];
        const to = joints[@intFromEnum(definition.to)];
        const vector = sub(to.position, from.position);
        const rest = calibration.rest_segments[@intFromEnum(definition.id)];
        segments[@intFromEnum(definition.id)] = .{
            .id = definition.id,
            .origin = from.position,
            .direction = normalize(vector, tuning.numeric_epsilon) orelse rest.direction,
            .rotation = try segmentRotation(
                normalize(vector, tuning.numeric_epsilon) orelse rest.direction,
                tuning.numeric_epsilon,
            ),
            .length = length(vector),
            .confidence = @min(from.confidence, to.confidence),
        };
    }
    const head_index = @intFromEnum(SegmentId.head);
    if (facialFrame(points, tuning)) |head_frame| {
        segments[head_index].direction = head_frame.direction;
        segments[head_index].rotation = head_frame.rotation;
        segments[head_index].confidence = head_frame.confidence;
    } else {
        // A position-only nose observation is not a head orientation. Preserve
        // the calibrated frame as diagnostic data and mark the channel missing
        // so retargeting uses its temporal hold/fade recovery.
        segments[head_index].direction = calibration.rest_segments[head_index].direction;
        segments[head_index].rotation = calibration.rest_segments[head_index].rotation;
        segments[head_index].confidence = 0;
    }
    return .{
        .frame_id = frame.frame_id,
        .timestamp_ms = frame.timestamp_ms,
        .joints = joints,
        .segments = segments,
    };
}
