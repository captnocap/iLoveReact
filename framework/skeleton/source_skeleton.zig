//! BlazePose world-landmark calibration and 3D source-skeleton assembly.
//!
//! The camera supplies immutable 33-landmark frames carrying REAL metric 3D
//! (BlazePose GHUM world landmarks: metres, hip-centred) alongside screen
//! positions and per-landmark visibility. Thirty valid frames establish
//! median rest joints, segment directions, and lengths; live assembly reads
//! the model's own depth directly. The former MoveNet path — monocular depth
//! recovery from fixed segment lengths, the explicit DepthSign input, the
//! 13-keypoint calibration lottery — is gone (req_4387): depth is an input
//! now, not a guess.
//!
//! Spaces:
//! - WORLD (input): MediaPipe convention — metres, hip-centred, x right,
//!   y DOWN, z away from camera (a camera-facing nose has negative z).
//! - SOURCE (output): y UP, z TOWARD camera: src = (x, -y, -z). All joints,
//!   segments, and calibration rest data live here, in metres.
//! - SCREEN: source-frame-normalized image coords (0..1, y down) — carried
//!   for root translation (world coords are hip-centred, so global position
//!   must come from the image) and for UI preview dots.

const std = @import("std");
const fk = @import("fk_pose.zig");

pub const Vec3 = fk.Vec3;

pub const WORLD_LANDMARK_COUNT: usize = 33;
pub const JOINT_COUNT: usize = 16;
pub const SEGMENT_COUNT: usize = 12;
pub const CALIBRATION_FRAME_COUNT: usize = 30;
/// Below this pose-presence probability a frame contains nobody: calibration
/// ignores it and live assembly reports every channel unobserved so the
/// retargeter's hold/fade recovery takes over.
pub const PRESENCE_FLOOR: f32 = 0.5;

pub const Tuning = struct {
    /// Per-landmark visibility floor. BlazePose visibilities are sigmoid
    /// probabilities and well-separated in practice (visible limbs ≥ ~0.9,
    /// occluded ones fall fast), unlike the MoveNet score soup this replaced.
    /// 0.25 keeps genuinely-located-but-occluded limbs available to the
    /// calibration median; live retargeting keeps its own stricter drive
    /// gate (humanoid_retarget.Tuning.minimum_confidence).
    minimum_confidence: f32 = 0.25,
    calibration_frame_count: usize = CALIBRATION_FRAME_COUNT,
    calibration_deadline_ms: u64 = 10_000,
    numeric_epsilon: f32 = 1.0e-6,
};

pub const DEFAULT_TUNING = Tuning{};

/// MediaPipe's canonical 33 body landmarks, in model output order. Left and
/// right are the SUBJECT's. v8_bindings_capture_session comptime-asserts
/// this order against framework/ml/blazepose.zig's LandmarkName.
pub const WorldLandmarkName = enum(u8) {
    nose,
    eye_inner_left,
    eye_left,
    eye_outer_left,
    eye_inner_right,
    eye_right,
    eye_outer_right,
    ear_left,
    ear_right,
    mouth_left,
    mouth_right,
    shoulder_left,
    shoulder_right,
    elbow_left,
    elbow_right,
    wrist_left,
    wrist_right,
    pinky_left,
    pinky_right,
    index_left,
    index_right,
    thumb_left,
    thumb_right,
    hip_left,
    hip_right,
    knee_left,
    knee_right,
    ankle_left,
    ankle_right,
    heel_left,
    heel_right,
    foot_index_left,
    foot_index_right,
};

pub const WorldLandmark = struct {
    /// Source-frame-normalized image position (0..1, y down).
    screen: [2]f32,
    /// WORLD-space position: metres, hip-centred, MediaPipe axes (y down,
    /// z away from camera). Converted to SOURCE space internally.
    world: Vec3,
    /// Sigmoid visibility probability.
    visibility: f32,
};

pub const WorldLandmarkFrame = struct {
    frame_id: u64,
    timestamp_ms: u64,
    /// Pose-presence probability from the landmark graph.
    presence: f32,
    landmarks: [WORLD_LANDMARK_COUNT]WorldLandmark,

    pub fn landmark(self: *const WorldLandmarkFrame, name: WorldLandmarkName) WorldLandmark {
        return self.landmarks[@intFromEnum(name)];
    }
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
    /// Rest joints in SOURCE space, metres, hip-centred (world landmarks are
    /// hip-centred by construction, so rest joints are automatically
    /// hip-relative).
    rest_joints: [JOINT_COUNT]Vec3,
    rest_segments: [SEGMENT_COUNT]RestSegment,
    /// Median calibration-time hip centre in SCREEN space (image coords,
    /// y down) — the anchor global translation is measured against.
    image_hip_center: [2]f32,
    /// Median hip-to-head SCREEN distance — the image-to-metres bridge for
    /// root translation.
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

pub const Error = fk.Error || error{
    InvalidTuning,
    InvalidFrame,
    CalibrationUnavailable,
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

/// The joints the CORE calibration gate demands: the sample's centre and
/// scale derive from hips and shoulders. Everything else joins each sample
/// at its reported position — the median over 30 samples is the noise
/// filter. This is the whole gate: no facial pairs, no full-limb roll call.
const REQUIRED_LANDMARKS = [_]WorldLandmarkName{
    .shoulder_left,
    .shoulder_right,
    .hip_left,
    .hip_right,
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

/// WORLD (MediaPipe: y down, z away from camera) → SOURCE (y up, z toward
/// camera). Two axis flips preserve handedness.
fn sourcePoint(landmark: WorldLandmark) Vec3 {
    return .{ landmark.world[0], -landmark.world[1], -landmark.world[2] };
}

fn frameValid(frame: *const WorldLandmarkFrame) bool {
    if (!std.math.isFinite(frame.presence) or frame.presence < 0 or frame.presence > 1) return false;
    for (frame.landmarks) |landmark| {
        if (!std.math.isFinite(landmark.screen[0]) or !std.math.isFinite(landmark.screen[1]) or
            !std.math.isFinite(landmark.world[0]) or !std.math.isFinite(landmark.world[1]) or
            !std.math.isFinite(landmark.world[2]) or !std.math.isFinite(landmark.visibility) or
            landmark.visibility < 0 or landmark.visibility > 1)
        {
            return false;
        }
    }
    return true;
}

fn visible(frame: *const WorldLandmarkFrame, name: WorldLandmarkName, tuning: Tuning) ?WorldLandmark {
    const landmark = frame.landmark(name);
    return if (landmark.visibility >= tuning.minimum_confidence) landmark else null;
}

const FaceFrame = struct {
    direction: Vec3,
    rotation: fk.Quat,
    confidence: f32,
};

/// Full source-space head frame from REAL 3D facial geometry: eyes and ears
/// provide the lateral axis in metres, shoulders-to-nose resolves anatomical
/// up. Confidence-weighted when both pairs are visible.
fn facialFrame(frame: *const WorldLandmarkFrame, tuning: Tuning) ?FaceFrame {
    const nose = visible(frame, .nose, tuning) orelse return null;
    const shoulder_left = visible(frame, .shoulder_left, tuning) orelse return null;
    const shoulder_right = visible(frame, .shoulder_right, tuning) orelse return null;

    var lateral_sum: Vec3 = .{ 0, 0, 0 };
    var facial_confidence: f32 = 0;
    const pairs = [_][2]WorldLandmarkName{
        .{ .eye_left, .eye_right },
        .{ .ear_left, .ear_right },
    };
    for (pairs) |pair| {
        const left = visible(frame, pair[0], tuning) orelse continue;
        const right = visible(frame, pair[1], tuning) orelse continue;
        const lateral = normalize(sub(sourcePoint(right), sourcePoint(left)), tuning.numeric_epsilon) orelse continue;
        const confidence = @min(left.visibility, right.visibility);
        lateral_sum = add(lateral_sum, scale(lateral, confidence));
        facial_confidence = @max(facial_confidence, confidence);
    }
    if (facial_confidence <= 0) return null;

    var x = normalize(lateral_sum, tuning.numeric_epsilon) orelse return null;
    const shoulder_center = midpoint(sourcePoint(shoulder_left), sourcePoint(shoulder_right));
    const upward_hint = sub(sourcePoint(nose), shoulder_center);
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
            @min(nose.visibility, @min(shoulder_left.visibility, shoulder_right.visibility)),
            facial_confidence,
        ),
    };
}

fn jointLandmark(id: JointId) ?WorldLandmarkName {
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

/// Centres and spine derive from the four direct torso joints; recomputed
/// whenever those move (assembly, parking).
fn recomputeDerivedJoints(joints: *[JOINT_COUNT]SourceJoint) void {
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
    const shoulder_center = joints[@intFromEnum(JointId.shoulder_center)];
    const hip_center = joints[@intFromEnum(JointId.hip_center)];
    joints[@intFromEnum(JointId.spine)] = .{
        .id = .spine,
        .position = midpoint(hip_center.position, shoulder_center.position),
        .confidence = @min(hip_center.confidence, shoulder_center.confidence),
    };
}

/// Direct joints from world landmarks (SOURCE space, metres). Confidence is
/// the landmark's visibility; derived centres take the min of their parents.
fn jointsFromWorld(frame: *const WorldLandmarkFrame) [JOINT_COUNT]SourceJoint {
    var joints: [JOINT_COUNT]SourceJoint = undefined;
    for (0..JOINT_COUNT) |index| {
        const id: JointId = @enumFromInt(index);
        if (jointLandmark(id)) |name| {
            const landmark = frame.landmark(name);
            joints[index] = .{
                .id = id,
                .position = sourcePoint(landmark),
                .confidence = landmark.visibility,
            };
        } else {
            joints[index] = .{ .id = id, .position = .{ 0, 0, 0 }, .confidence = 0 };
        }
    }
    recomputeDerivedJoints(&joints);
    return joints;
}

fn screenHipCenter(frame: *const WorldLandmarkFrame) [2]f32 {
    const left = frame.landmark(.hip_left).screen;
    const right = frame.landmark(.hip_right).screen;
    return .{ (left[0] + right[0]) * 0.5, (left[1] + right[1]) * 0.5 };
}

fn sampleFromWorldFrame(frame: *const WorldLandmarkFrame, tuning: Tuning) Error!?Sample {
    if (!frameValid(frame)) return error.InvalidFrame;
    if (frame.presence < PRESENCE_FLOOR) return null;
    for (REQUIRED_LANDMARKS) |name| {
        if (frame.landmark(name).visibility < tuning.minimum_confidence) return null;
    }
    const joints_full = jointsFromWorld(frame);
    var joints: [JOINT_COUNT]Vec3 = undefined;
    for (joints_full, 0..) |joint, index| joints[index] = joint.position;

    const hip_screen = screenHipCenter(frame);
    const nose_screen = frame.landmark(.nose).screen;
    const screen_dx = nose_screen[0] - hip_screen[0];
    const screen_dy = nose_screen[1] - hip_screen[1];
    const raw_hip_head_length = @sqrt(screen_dx * screen_dx + screen_dy * screen_dy);
    if (raw_hip_head_length <= tuning.numeric_epsilon) return null;

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
    if (facialFrame(frame, tuning)) |head_frame| {
        segments[@intFromEnum(SegmentId.head)].direction = head_frame.direction;
        segments[@intFromEnum(SegmentId.head)].rotation = head_frame.rotation;
    }
    // No facial pair visible: the shoulder→nose segment rotation already in
    // place is an honest upright default — calibration never blocks on it.
    return .{
        .joints = joints,
        .segments = segments,
        .raw_hip_center = hip_screen,
        .raw_hip_head_length = raw_hip_head_length,
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

    pub fn push(self: *Calibrator, frame: *const WorldLandmarkFrame) Error!CalibrationPush {
        if (self.state != .collecting) return .not_collecting;
        if (frame.timestamp_ms < self.started_ms or
            frame.timestamp_ms - self.started_ms > self.tuning.calibration_deadline_ms)
        {
            self.state = .failed;
            return .deadline_exceeded;
        }
        if (self.last_frame_id) |last| if (frame.frame_id <= last) return .ignored_invalid;
        const sample = try sampleFromWorldFrame(frame, self.tuning) orelse return .ignored_invalid;
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

/// Assemble one calibrated source frame directly from world landmarks. The
/// model's own metric depth IS the z — nothing is recovered or guessed. A
/// below-presence-floor frame assembles with every confidence at zero so the
/// retargeter's hold/fade recovery drives the rig.
pub fn reconstruct(
    frame: *const WorldLandmarkFrame,
    calibration: Calibration,
    tuning: Tuning,
) Error!SourceSkeletonFrame {
    if (!tuningValid(tuning) or calibration.image_hip_head_length <= tuning.numeric_epsilon) {
        return error.CalibrationUnavailable;
    }
    if (!frameValid(frame)) return error.InvalidFrame;

    const nobody = frame.presence < PRESENCE_FLOOR;
    var joints = jointsFromWorld(frame);
    if (nobody) {
        for (&joints) |*joint| {
            joint.position = calibration.rest_joints[@intFromEnum(joint.id)];
            joint.confidence = 0;
        }
    }

    // Root translation: world landmarks are hip-centred, so global position
    // comes from the SCREEN hip displacement against the calibration anchor,
    // bridged into metres by the person's own hip-to-head ratio.
    if (!nobody) {
        const rest_hip = calibration.rest_joints[@intFromEnum(JointId.hip_center)];
        const rest_head = calibration.rest_joints[@intFromEnum(JointId.head)];
        const hip_to_head_m = length(sub(rest_head, rest_hip));
        const hip_screen = screenHipCenter(frame);
        const metres_per_screen = hip_to_head_m / calibration.image_hip_head_length;
        const displacement = Vec3{
            (hip_screen[0] - calibration.image_hip_center[0]) * metres_per_screen,
            -(hip_screen[1] - calibration.image_hip_center[1]) * metres_per_screen,
            0,
        };
        for (&joints) |*joint| joint.position = add(joint.position, add(displacement, rest_hip));

        // Sub-floor joints are hallucinations (out-of-frame or occluded limbs
        // the model still positions). Park each one at its calibrated rest
        // offset from its live chain parent — SEGMENTS is parent-first, so
        // a whole unseen leg hangs naturally off a confident hip instead of
        // tap-dancing through noise (req_4389). Confidence stays as reported,
        // so retarget gating and the diagnostic dots remain honest.
        for (SEGMENTS) |definition| {
            const to_index = @intFromEnum(definition.to);
            if (jointLandmark(joints[to_index].id) == null) continue;
            if (joints[to_index].confidence >= tuning.minimum_confidence) continue;
            const rest = calibration.rest_segments[@intFromEnum(definition.id)];
            joints[to_index].position = add(
                joints[@intFromEnum(definition.from)].position,
                scale(rest.direction, rest.length),
            );
        }
        recomputeDerivedJoints(&joints);
    }

    var segments: [SEGMENT_COUNT]SegmentFrame = undefined;
    for (SEGMENTS) |definition| {
        const from = joints[@intFromEnum(definition.from)];
        const to = joints[@intFromEnum(definition.to)];
        const vector = sub(to.position, from.position);
        const rest = calibration.rest_segments[@intFromEnum(definition.id)];
        const direction = normalize(vector, tuning.numeric_epsilon) orelse rest.direction;
        segments[@intFromEnum(definition.id)] = .{
            .id = definition.id,
            .origin = from.position,
            .direction = direction,
            .rotation = try segmentRotation(direction, tuning.numeric_epsilon),
            .length = length(vector),
            .confidence = if (nobody) 0 else @min(from.confidence, to.confidence),
        };
    }
    const head_index = @intFromEnum(SegmentId.head);
    if (!nobody) {
        if (facialFrame(frame, tuning)) |head_frame| {
            segments[head_index].direction = head_frame.direction;
            segments[head_index].rotation = head_frame.rotation;
            segments[head_index].confidence = head_frame.confidence;
        } else {
            // A position-only nose observation is not a head orientation.
            // Preserve the calibrated frame as diagnostic data and mark the
            // channel missing so retargeting uses its temporal hold/fade.
            segments[head_index].direction = calibration.rest_segments[head_index].direction;
            segments[head_index].rotation = calibration.rest_segments[head_index].rotation;
            segments[head_index].confidence = 0;
        }
    } else {
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
