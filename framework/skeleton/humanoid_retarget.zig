//! Calibrated source-skeleton to constrained target-local humanoid poses.
//!
//! Retargeting runs in stable target hierarchy order. Source global segment
//! deltas are applied to target bind frames, converted back to parent-local
//! quaternions, clamped through `rig_pose`, and evaluated by the same FK path as
//! authored clips. Bind translations never change, so target lengths stay fixed.

const std = @import("std");
pub const source = @import("source_skeleton.zig");
pub const rig = @import("rig_pose.zig");
const fk = rig.fk;

pub const MAX_BONES: usize = rig.MAX_BONES;
pub const Vec3 = rig.Vec3;
pub const Quat = rig.Quat;
pub const Mat4 = rig.Mat4;

pub const Tuning = struct {
    // Deliberately STRICTER than source_skeleton's calibration floor (0.25).
    // Calibration medians can absorb a low-confidence sample; a live drive
    // channel cannot — an occluded wrist (~0.27 with a guessed position,
    // measured req_4263) should hold/fade rather than steer the forearm.
    // 0.35 clears what MoveNet reports for genuinely visible limbs on
    // non-frame-filling footage (0.37..0.77, req_4262) while parking
    // occluded ones; the hold/fade window below absorbs brief dips.
    minimum_confidence: f32 = 0.35,
    missing_hold_ms: u64 = 150,
    missing_fade_ms: u64 = 350,
    clavicle_share: f32 = 0.25,
    spine_lower_share: f32 = 0.45,
    spine_upper_share: f32 = 1.0,
    neck_share: f32 = 0.40,
    head_share: f32 = 1.0,
    numeric_epsilon: f32 = 1.0e-6,
};

pub const DEFAULT_TUNING = Tuning{};

pub const TargetPoseFrame = struct {
    frame_id: u64,
    timestamp_ms: u64,
    bone_count: u16,
    root_translation: Vec3,
    local_rotations: [MAX_BONES]Quat,
};

pub const Error = std.mem.Allocator.Error || rig.Error || error{
    InvalidTuning,
    BoneIdCountMismatch,
    DuplicateBoneId,
    RequiredBoneMissing,
    StaleFrame,
    FrameIdentityMismatch,
    NoCompletedFrame,
};

const Channel = struct {
    bone_id: []const u8,
    segment: source.SegmentId,
    share_kind: enum {
        full,
        clavicle,
        spine_lower,
        spine_upper,
        neck,
        head,
    } = .full,
};

/// The role wire ids capture drives, in stable channel order. This is the
/// recording channel table (req_4285): a captured take persists exactly the
/// channels the retargeter steers; everything else rides bind by construction.
pub const DRIVEN_CHANNEL_IDS = blk: {
    var ids: [CHANNELS.len][]const u8 = undefined;
    for (CHANNELS, 0..) |channel, index| ids[index] = channel.bone_id;
    break :blk ids;
};

const CHANNELS = [_]Channel{
    .{ .bone_id = "pelvis", .segment = .hip_line },
    .{ .bone_id = "spine_lower", .segment = .spine, .share_kind = .spine_lower },
    .{ .bone_id = "spine_upper", .segment = .spine, .share_kind = .spine_upper },
    .{ .bone_id = "neck", .segment = .head, .share_kind = .neck },
    .{ .bone_id = "head", .segment = .head, .share_kind = .head },
    .{ .bone_id = "clavicle_left", .segment = .shoulder_line, .share_kind = .clavicle },
    .{ .bone_id = "upper_arm_left", .segment = .upper_arm_left },
    .{ .bone_id = "lower_arm_left", .segment = .lower_arm_left },
    .{ .bone_id = "clavicle_right", .segment = .shoulder_line, .share_kind = .clavicle },
    .{ .bone_id = "upper_arm_right", .segment = .upper_arm_right },
    .{ .bone_id = "lower_arm_right", .segment = .lower_arm_right },
    .{ .bone_id = "upper_leg_left", .segment = .upper_leg_left },
    .{ .bone_id = "lower_leg_left", .segment = .lower_leg_left },
    .{ .bone_id = "upper_leg_right", .segment = .upper_leg_right },
    .{ .bone_id = "lower_leg_right", .segment = .lower_leg_right },
};

fn tuningValid(tuning: Tuning) bool {
    return std.math.isFinite(tuning.minimum_confidence) and
        tuning.minimum_confidence >= 0 and tuning.minimum_confidence <= 1 and
        tuning.missing_fade_ms > 0 and
        std.math.isFinite(tuning.clavicle_share) and tuning.clavicle_share >= 0 and tuning.clavicle_share <= 1 and
        std.math.isFinite(tuning.spine_lower_share) and tuning.spine_lower_share >= 0 and tuning.spine_lower_share <= 1 and
        std.math.isFinite(tuning.spine_upper_share) and tuning.spine_upper_share >= 0 and tuning.spine_upper_share <= 1 and
        std.math.isFinite(tuning.neck_share) and tuning.neck_share >= 0 and tuning.neck_share <= 1 and
        std.math.isFinite(tuning.head_share) and tuning.head_share >= 0 and tuning.head_share <= 1 and
        std.math.isFinite(tuning.numeric_epsilon) and tuning.numeric_epsilon > 0;
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

fn shareFor(channel: Channel, tuning: Tuning) f32 {
    return switch (channel.share_kind) {
        .full => 1,
        .clavicle => tuning.clavicle_share,
        .spine_lower => tuning.spine_lower_share,
        .spine_upper => tuning.spine_upper_share,
        .neck => tuning.neck_share,
        .head => tuning.head_share,
    };
}

fn channelFor(bone_id: []const u8) ?Channel {
    for (CHANNELS) |channel| {
        if (std.mem.eql(u8, channel.bone_id, bone_id)) return channel;
    }
    return null;
}

/// These unobserved end effectors retain their authored local orientation,
/// including twist, while inheriting motion from their observed parents.
pub fn preservesBindOrientation(bone_id: []const u8) bool {
    return std.mem.eql(u8, bone_id, "hand_left") or
        std.mem.eql(u8, bone_id, "hand_right") or
        std.mem.eql(u8, bone_id, "fingers_left") or
        std.mem.eql(u8, bone_id, "fingers_right") or
        std.mem.eql(u8, bone_id, "foot_left") or
        std.mem.eql(u8, bone_id, "foot_right") or
        std.mem.eql(u8, bone_id, "toes_left") or
        std.mem.eql(u8, bone_id, "toes_right");
}

pub const Retargeter = struct {
    allocator: std.mem.Allocator,
    bone_ids: []const []const u8,
    bones: []const rig.Bone,
    tuning: Tuning,
    bind_global: []Mat4,
    inverse_bind: []Mat4,
    bind_global_rotations: []Quat,
    current_global_rotations: []Quat,
    requested_local_rotations: []Quat,
    current_local_rotations: []Quat,
    global_matrices: []Mat4,
    skin_matrices: []Mat4,
    missing_since_ms: []?u64,
    missing_start_rotations: []Quat,
    target_hip_to_head: f32,
    last_frame_id: ?u64 = null,
    last_timestamp_ms: ?u64 = null,
    root_translation: Vec3 = .{ 0, 0, 0 },

    pub fn init(
        allocator: std.mem.Allocator,
        bone_ids: []const []const u8,
        bones: []const rig.Bone,
        tuning: Tuning,
    ) Error!Retargeter {
        if (!tuningValid(tuning)) return error.InvalidTuning;
        if (bone_ids.len != bones.len) return error.BoneIdCountMismatch;
        for (bone_ids, 0..) |bone_id, index| {
            if (bone_id.len == 0) return error.RequiredBoneMissing;
            for (bone_ids[0..index]) |prior| {
                if (std.mem.eql(u8, prior, bone_id)) return error.DuplicateBoneId;
            }
        }
        const bind_global = try allocator.alloc(Mat4, bones.len);
        errdefer allocator.free(bind_global);
        const inverse_bind = try allocator.alloc(Mat4, bones.len);
        errdefer allocator.free(inverse_bind);
        const bind_global_rotations = try allocator.alloc(Quat, bones.len);
        errdefer allocator.free(bind_global_rotations);
        const current_global_rotations = try allocator.alloc(Quat, bones.len);
        errdefer allocator.free(current_global_rotations);
        const requested = try allocator.alloc(Quat, bones.len);
        errdefer allocator.free(requested);
        const current = try allocator.alloc(Quat, bones.len);
        errdefer allocator.free(current);
        const global_matrices = try allocator.alloc(Mat4, bones.len);
        errdefer allocator.free(global_matrices);
        const skin_matrices = try allocator.alloc(Mat4, bones.len);
        errdefer allocator.free(skin_matrices);
        const missing_since = try allocator.alloc(?u64, bones.len);
        errdefer allocator.free(missing_since);
        const missing_start = try allocator.alloc(Quat, bones.len);
        errdefer allocator.free(missing_start);

        try rig.prepareBind(bones, bind_global, inverse_bind);
        @memset(missing_since, null);
        for (bones, 0..) |bone, index| {
            const bind_local = try fk.normalizeQuat(bone.bind_rotation);
            requested[index] = bind_local;
            current[index] = bind_local;
            missing_start[index] = bind_local;
            bind_global_rotations[index] = if (bone.parent_index) |parent|
                try fk.normalizeQuat(fk.multiplyQuat(bind_global_rotations[parent], bind_local))
            else
                bind_local;
            current_global_rotations[index] = bind_global_rotations[index];
        }

        var pelvis_index: ?usize = null;
        var head_index: ?usize = null;
        for (bone_ids, 0..) |bone_id, index| {
            if (std.mem.eql(u8, bone_id, "pelvis")) pelvis_index = index;
            if (std.mem.eql(u8, bone_id, "head")) head_index = index;
        }
        const pelvis = pelvis_index orelse return error.RequiredBoneMissing;
        const head = head_index orelse return error.RequiredBoneMissing;
        const hip_to_head = length(.{
            bind_global[head][12] - bind_global[pelvis][12],
            bind_global[head][13] - bind_global[pelvis][13],
            bind_global[head][14] - bind_global[pelvis][14],
        });
        if (hip_to_head <= tuning.numeric_epsilon) return error.RequiredBoneMissing;
        return .{
            .allocator = allocator,
            .bone_ids = bone_ids,
            .bones = bones,
            .tuning = tuning,
            .bind_global = bind_global,
            .inverse_bind = inverse_bind,
            .bind_global_rotations = bind_global_rotations,
            .current_global_rotations = current_global_rotations,
            .requested_local_rotations = requested,
            .current_local_rotations = current,
            .global_matrices = global_matrices,
            .skin_matrices = skin_matrices,
            .missing_since_ms = missing_since,
            .missing_start_rotations = missing_start,
            .target_hip_to_head = hip_to_head,
        };
    }

    pub fn deinit(self: *Retargeter) void {
        self.allocator.free(self.bind_global);
        self.allocator.free(self.inverse_bind);
        self.allocator.free(self.bind_global_rotations);
        self.allocator.free(self.current_global_rotations);
        self.allocator.free(self.requested_local_rotations);
        self.allocator.free(self.current_local_rotations);
        self.allocator.free(self.global_matrices);
        self.allocator.free(self.skin_matrices);
        self.allocator.free(self.missing_since_ms);
        self.allocator.free(self.missing_start_rotations);
        self.* = undefined;
    }

    fn recoverMissing(self: *Retargeter, index: usize, timestamp_ms: u64) rig.Error!Quat {
        if (self.missing_since_ms[index] == null) {
            self.missing_since_ms[index] = timestamp_ms;
            self.missing_start_rotations[index] = self.current_local_rotations[index];
        }
        const started = self.missing_since_ms[index].?;
        const elapsed = timestamp_ms -| started;
        if (elapsed <= self.tuning.missing_hold_ms) return self.missing_start_rotations[index];
        const fade_elapsed = elapsed - self.tuning.missing_hold_ms;
        const alpha = std.math.clamp(
            @as(f32, @floatFromInt(fade_elapsed)) / @as(f32, @floatFromInt(self.tuning.missing_fade_ms)),
            0,
            1,
        );
        return fk.slerpQuat(
            self.missing_start_rotations[index],
            self.bones[index].bind_rotation,
            alpha,
        );
    }

    pub fn globalMatrices(self: *const Retargeter) []const Mat4 {
        return self.global_matrices;
    }

    /// Immutable fitted-target bind globals used by capture diagnostics. The
    /// UI receives only joint origins derived from these matrices; FK remains
    /// native and the saved target segment lengths stay authoritative.
    pub fn bindGlobalMatrices(self: *const Retargeter) []const Mat4 {
        return self.bind_global;
    }

    pub fn retarget(
        self: *Retargeter,
        calibration: source.Calibration,
        source_frame: *const source.SourceSkeletonFrame,
    ) Error!TargetPoseFrame {
        if (self.last_frame_id) |last| if (source_frame.frame_id <= last) return error.StaleFrame;
        if (self.last_timestamp_ms) |last| if (source_frame.timestamp_ms < last) return error.StaleFrame;
        const rest_hip = calibration.rest_joints[@intFromEnum(source.JointId.hip_center)];
        const live_hip = source_frame.joint(.hip_center).position;
        const rest_head = calibration.rest_joints[@intFromEnum(source.JointId.head)];
        const source_hip_to_head = length(sub(rest_head, rest_hip));
        if (source_hip_to_head <= self.tuning.numeric_epsilon) return error.RequiredBoneMissing;
        self.root_translation = scale(
            sub(live_hip, rest_hip),
            self.target_hip_to_head / source_hip_to_head,
        );

        for (self.bones, 0..) |bone, index| {
            const bind_local = try fk.normalizeQuat(bone.bind_rotation);
            var requested = bind_local;
            if (channelFor(self.bone_ids[index])) |channel| {
                const live_segment = source_frame.segment(channel.segment);
                if (live_segment.confidence >= self.tuning.minimum_confidence) {
                    const rest_segment = calibration.rest_segments[@intFromEnum(channel.segment)];
                    const full_delta = try fk.normalizeQuat(fk.multiplyQuat(
                        fk.inverseUnitQuat(try fk.normalizeQuat(rest_segment.rotation)),
                        try fk.normalizeQuat(live_segment.rotation),
                    ));
                    const shared_delta = try fk.slerpQuat(
                        fk.IDENTITY_QUAT,
                        full_delta,
                        shareFor(channel, self.tuning),
                    );
                    const desired_global = try fk.normalizeQuat(fk.multiplyQuat(
                        self.bind_global_rotations[index],
                        shared_delta,
                    ));
                    requested = if (bone.parent_index) |parent|
                        try fk.normalizeQuat(fk.multiplyQuat(
                            fk.inverseUnitQuat(self.current_global_rotations[parent]),
                            desired_global,
                        ))
                    else
                        desired_global;
                    self.missing_since_ms[index] = null;
                } else {
                    requested = try self.recoverMissing(index, source_frame.timestamp_ms);
                }
            } else {
                // Hands and feet intentionally remain at bind-local orientation;
                // all other unchannelled controls do the same.
                requested = bind_local;
                self.missing_since_ms[index] = null;
            }
            requested = try rig.clampLocalRotation(bind_local, requested, bone.constraint);
            self.requested_local_rotations[index] = requested;
            self.current_global_rotations[index] = if (bone.parent_index) |parent|
                try fk.normalizeQuat(fk.multiplyQuat(self.current_global_rotations[parent], requested))
            else
                requested;
        }
        try rig.evaluate(
            self.bones,
            self.inverse_bind,
            self.requested_local_rotations,
            self.root_translation,
            self.current_local_rotations,
            self.global_matrices,
            self.skin_matrices,
        );
        for (self.bones, 0..) |bone, index| {
            self.current_global_rotations[index] = if (bone.parent_index) |parent|
                try fk.normalizeQuat(fk.multiplyQuat(self.current_global_rotations[parent], self.current_local_rotations[index]))
            else
                self.current_local_rotations[index];
        }
        self.last_frame_id = source_frame.frame_id;
        self.last_timestamp_ms = source_frame.timestamp_ms;

        var pose = TargetPoseFrame{
            .frame_id = source_frame.frame_id,
            .timestamp_ms = source_frame.timestamp_ms,
            .bone_count = @intCast(self.bones.len),
            .root_translation = self.root_translation,
            .local_rotations = @splat(fk.IDENTITY_QUAT),
        };
        @memcpy(pose.local_rotations[0..self.bones.len], self.current_local_rotations);
        return pose;
    }
};

/// Immutable camera identity retained alongside the detected result.
pub const CameraFrameRef = struct {
    frame_id: u64,
    timestamp_ms: u64,
    token: u64,
};

pub const CompletedTriplet = struct {
    camera: CameraFrameRef,
    detected: source.WorldLandmarkFrame,
    reconstructed: source.SourceSkeletonFrame,
    target: TargetPoseFrame,
};

/// Pure promotion/freeze state. Promotion accepts only one frame identity across
/// all three diagnostic layers; freeze copies and pins the latest whole triplet.
pub const TripletState = struct {
    latest: ?CompletedTriplet = null,
    pinned: ?CompletedTriplet = null,
    frozen: bool = false,

    pub fn promote(self: *TripletState, triplet: CompletedTriplet) Error!void {
        const frame_id = triplet.camera.frame_id;
        const timestamp_ms = triplet.camera.timestamp_ms;
        if (triplet.detected.frame_id != frame_id or triplet.reconstructed.frame_id != frame_id or
            triplet.target.frame_id != frame_id or triplet.detected.timestamp_ms != timestamp_ms or
            triplet.reconstructed.timestamp_ms != timestamp_ms or triplet.target.timestamp_ms != timestamp_ms)
        {
            return error.FrameIdentityMismatch;
        }
        self.latest = triplet;
    }

    pub fn freeze(self: *TripletState) Error!void {
        if (self.frozen) return;
        self.pinned = self.latest orelse return error.NoCompletedFrame;
        self.frozen = true;
    }

    pub fn resumeLive(self: *TripletState) void {
        self.frozen = false;
        self.pinned = null;
    }

    pub fn visible(self: *const TripletState) ?*const CompletedTriplet {
        if (self.frozen) return if (self.pinned) |*triplet| triplet else null;
        return if (self.latest) |*triplet| triplet else null;
    }
};
