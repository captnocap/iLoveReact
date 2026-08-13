//! Canonical local-quaternion clips for the generated 24-bone humanoid.
//!
//! Clips are authored against the canonical palette but PLAY by semantic role
//! (req_4285): `sampleChannels` exposes every clip as bind-relative deltas on
//! the role-addressed channel vocabulary in `CHANNEL_IDS`, and any body whose
//! rig binds those roles can answer them — canonical or adopted. Samples
//! contain only root translation and rotations; authored bind translations
//! remain resident in the rig and therefore cannot be stretched by animation.
//! Key transitions use shortest-arc quaternion interpolation.

const std = @import("std");
pub const pose = @import("pose_stream.zig");
pub const rig = @import("rig_pose.zig");
pub const generated = @import("generated/humanoid_v1.zig");
const fk = pose.fk;

pub const BONE_COUNT: usize = generated.HUMANOID_V1_BONE_IDS.len;
pub const PALETTE_IDS = generated.HUMANOID_V1_BONE_IDS;

comptime {
    if (BONE_COUNT != 24) @compileError("humanoid-v1 clips require the canonical 24-bone palette");
}

pub const ClipId = enum(u8) {
    idle,
    walk,
    jump,
    sit,
    lay,
};

pub const ClipInfo = struct {
    duration_seconds: f32,
    looping: bool,
};

/// Every behavior-affecting clip value lives in this authored tuning table.
pub const ClipTuning = struct {
    /// Arms-down rest (req_4300): degrees each upper arm drops from the
    /// T-pose bind toward the body. 90 is straight down; a little less
    /// reads relaxed and keeps the hands clear of the thighs. Every clip
    /// key builds on this stance — the bind itself stays a T for skinning.
    arm_rest_degrees: f32 = 75.0,

    idle_duration_seconds: f32 = 2.0,
    idle_breath_spine_degrees: f32 = 2.0,
    idle_breath_head_degrees: f32 = -1.0,

    walk_duration_seconds: f32 = 1.0,
    walk_hip_swing_degrees: f32 = 26.0,
    walk_knee_base_degrees: f32 = 7.0,
    walk_knee_lift_degrees: f32 = 25.0,
    walk_arm_swing_degrees: f32 = 18.0,
    walk_elbow_base_degrees: f32 = 14.0,
    walk_elbow_follow_degrees: f32 = 6.0,
    walk_pelvis_twist_degrees: f32 = 3.0,
    walk_spine_counter_twist_degrees: f32 = -4.0,
    walk_bob_meters: f32 = 0.025,

    jump_duration_seconds: f32 = 0.60,
    jump_launch_time_seconds: f32 = 0.22,
    jump_crouch_root_y: f32 = -0.10,
    jump_flight_root_y: f32 = 0.12,
    jump_land_root_y: f32 = -0.03,
    jump_crouch_hip_degrees: f32 = 22.0,
    jump_crouch_knee_degrees: f32 = 48.0,
    jump_crouch_arm_degrees: f32 = -24.0,
    jump_flight_hip_degrees: f32 = -8.0,
    jump_flight_knee_degrees: f32 = 10.0,
    jump_flight_arm_degrees: f32 = 52.0,
    jump_land_hip_degrees: f32 = 8.0,
    jump_land_knee_degrees: f32 = 18.0,
    jump_land_arm_degrees: f32 = 8.0,

    sit_duration_seconds: f32 = 1.0,
    sit_root_y: f32 = -0.42,
    sit_pelvis_degrees: f32 = -10.0,
    sit_hip_degrees: f32 = 80.0,
    sit_knee_degrees: f32 = 75.0,
    sit_arm_degrees: f32 = 14.0,
    sit_elbow_degrees: f32 = 24.0,

    lay_duration_seconds: f32 = 1.0,
    lay_root_y: f32 = -0.78,
    lay_pelvis_degrees: f32 = -85.0,
    lay_arm_degrees: f32 = 8.0,
    lay_knee_degrees: f32 = 6.0,
};

pub const TUNING = ClipTuning{};

pub const Error = pose.Error || error{
    PaletteOrderMismatch,
    InvalidSampleTime,
};

fn boneIndex(comptime bone_id: []const u8) usize {
    inline for (PALETTE_IDS, 0..) |candidate, index| {
        if (std.mem.eql(u8, candidate, bone_id)) return index;
    }
    @compileError("clip channel names a bone outside humanoid-v1");
}

const ROOT = boneIndex("root");
const PELVIS = boneIndex("pelvis");
const SPINE_LOWER = boneIndex("spine_lower");
const SPINE_UPPER = boneIndex("spine_upper");
const HEAD = boneIndex("head");
const UPPER_ARM_LEFT = boneIndex("upper_arm_left");
const LOWER_ARM_LEFT = boneIndex("lower_arm_left");
const UPPER_ARM_RIGHT = boneIndex("upper_arm_right");
const LOWER_ARM_RIGHT = boneIndex("lower_arm_right");
const UPPER_LEG_LEFT = boneIndex("upper_leg_left");
const LOWER_LEG_LEFT = boneIndex("lower_leg_left");
const UPPER_LEG_RIGHT = boneIndex("upper_leg_right");
const LOWER_LEG_RIGHT = boneIndex("lower_leg_right");

pub fn clipInfo(clip: ClipId) ClipInfo {
    return switch (clip) {
        .idle => .{ .duration_seconds = TUNING.idle_duration_seconds, .looping = true },
        .walk => .{ .duration_seconds = TUNING.walk_duration_seconds, .looping = true },
        .jump => .{ .duration_seconds = TUNING.jump_duration_seconds, .looping = false },
        .sit => .{ .duration_seconds = TUNING.sit_duration_seconds, .looping = true },
        .lay => .{ .duration_seconds = TUNING.lay_duration_seconds, .looping = true },
    };
}

pub fn validatePalette(ids: []const []const u8) Error!void {
    if (ids.len != BONE_COUNT) return error.PaletteSizeMismatch;
    for (ids, PALETTE_IDS) |actual, expected| {
        if (!std.mem.eql(u8, actual, expected)) return error.PaletteOrderMismatch;
    }
}

fn radians(degrees: f32) f32 {
    return degrees * std.math.pi / 180.0;
}

fn bindFrame(frame_id: u64) Error!pose.Frame {
    var out = pose.Frame{
        .bone_count = BONE_COUNT,
        .frame_id = frame_id,
        .root_translation = .{ 0, 0, 0 },
    };
    for (generated.HUMANOID_V1_BONES, 0..) |bone, index| {
        out.local_quaternions[index] = try fk.normalizeQuat(bone.transform.rot);
    }
    return out;
}

fn rotateLocal(frame: *pose.Frame, bone_index: usize, axis: [3]f32, degrees: f32) Error!void {
    const delta = try fk.axisAngle(axis, radians(degrees));
    frame.local_quaternions[bone_index] = try fk.normalizeQuat(fk.multiplyQuat(
        frame.local_quaternions[bone_index],
        delta,
    ));
}

fn authoredHingeAxis(comptime bone_index: usize) [3]f32 {
    const joint = generated.HUMANOID_V1_BONES[bone_index].joint orelse
        @compileError("canonical clip hinge has no authored joint");
    if (joint.kind != .hinge) @compileError("canonical clip hinge names a non-hinge joint");
    return joint.axis orelse @compileError("canonical clip hinge has no authored axis");
}

fn rotateKneeFlex(frame: *pose.Frame, comptime bone_index: usize, degrees: f32) Error!void {
    try rotateLocal(frame, bone_index, authoredHingeAxis(bone_index), degrees);
}

fn blend(a: pose.Frame, b: pose.Frame, alpha_raw: f32) Error!pose.Frame {
    const alpha = std.math.clamp(alpha_raw, 0, 1);
    var out = a;
    for (&out.root_translation, b.root_translation) |*value, target| {
        value.* += (target - value.*) * alpha;
    }
    for (out.local_quaternions[0..BONE_COUNT], b.local_quaternions[0..BONE_COUNT]) |*rotation, target| {
        rotation.* = try fk.slerpQuat(rotation.*, target, alpha);
    }
    return out;
}

fn clipTime(seconds: f32, info: ClipInfo) Error!f32 {
    if (!std.math.isFinite(seconds)) return error.InvalidSampleTime;
    if (info.looping) {
        return seconds - @floor(seconds / info.duration_seconds) * info.duration_seconds;
    }
    return std.math.clamp(seconds, 0, info.duration_seconds);
}

/// Every clip key starts from the REST stance, not the raw bind: the
/// canonical rig (and the fits transported onto it) binds a T-pose for
/// skinning, but a standing body carries its arms at its sides (req_4300).
/// The clavicles bind rotated ±90° about Z, so a local-Z rotation on each
/// upper arm sweeps it down in the coronal plane; the clip's own arm swings
/// then compose in the lowered frame (sagittal, as arms actually swing).
fn restFrame(frame_id: u64) Error!pose.Frame {
    var out = try bindFrame(frame_id);
    try rotateLocal(&out, UPPER_ARM_LEFT, .{ 0, 0, 1 }, TUNING.arm_rest_degrees);
    try rotateLocal(&out, UPPER_ARM_RIGHT, .{ 0, 0, 1 }, -TUNING.arm_rest_degrees);
    return out;
}

fn idleKey(frame_id: u64, breath: f32) Error!pose.Frame {
    var out = try restFrame(frame_id);
    try rotateLocal(&out, SPINE_LOWER, .{ 1, 0, 0 }, TUNING.idle_breath_spine_degrees * breath);
    try rotateLocal(&out, HEAD, .{ 1, 0, 0 }, TUNING.idle_breath_head_degrees * breath);
    return out;
}

fn walkKey(frame_id: u64, stride: f32) Error!pose.Frame {
    var out = try restFrame(frame_id);
    const stride_abs = @abs(stride);
    out.root_translation[1] = TUNING.walk_bob_meters * stride_abs;
    try rotateLocal(&out, PELVIS, .{ 0, 1, 0 }, TUNING.walk_pelvis_twist_degrees * stride);
    try rotateLocal(&out, SPINE_UPPER, .{ 0, 1, 0 }, TUNING.walk_spine_counter_twist_degrees * stride);
    try rotateLocal(&out, UPPER_LEG_LEFT, .{ 1, 0, 0 }, TUNING.walk_hip_swing_degrees * stride);
    try rotateLocal(&out, UPPER_LEG_RIGHT, .{ 1, 0, 0 }, -TUNING.walk_hip_swing_degrees * stride);
    try rotateKneeFlex(&out, LOWER_LEG_LEFT, TUNING.walk_knee_base_degrees + TUNING.walk_knee_lift_degrees * @max(0, -stride));
    try rotateKneeFlex(&out, LOWER_LEG_RIGHT, TUNING.walk_knee_base_degrees + TUNING.walk_knee_lift_degrees * @max(0, stride));
    try rotateLocal(&out, UPPER_ARM_LEFT, .{ 1, 0, 0 }, -TUNING.walk_arm_swing_degrees * stride);
    try rotateLocal(&out, UPPER_ARM_RIGHT, .{ 1, 0, 0 }, TUNING.walk_arm_swing_degrees * stride);
    try rotateLocal(&out, LOWER_ARM_LEFT, .{ 1, 0, 0 }, TUNING.walk_elbow_base_degrees - TUNING.walk_elbow_follow_degrees * stride);
    try rotateLocal(&out, LOWER_ARM_RIGHT, .{ 1, 0, 0 }, TUNING.walk_elbow_base_degrees + TUNING.walk_elbow_follow_degrees * stride);
    return out;
}

fn jumpKey(frame_id: u64, key: enum { crouch, flight, land }) Error!pose.Frame {
    var out = try restFrame(frame_id);
    const root_y: f32, const hip: f32, const knee: f32, const arm: f32 = switch (key) {
        .crouch => .{
            TUNING.jump_crouch_root_y,
            TUNING.jump_crouch_hip_degrees,
            TUNING.jump_crouch_knee_degrees,
            TUNING.jump_crouch_arm_degrees,
        },
        .flight => .{
            TUNING.jump_flight_root_y,
            TUNING.jump_flight_hip_degrees,
            TUNING.jump_flight_knee_degrees,
            TUNING.jump_flight_arm_degrees,
        },
        .land => .{
            TUNING.jump_land_root_y,
            TUNING.jump_land_hip_degrees,
            TUNING.jump_land_knee_degrees,
            TUNING.jump_land_arm_degrees,
        },
    };
    out.root_translation[1] = root_y;
    for ([_]usize{ UPPER_LEG_LEFT, UPPER_LEG_RIGHT }) |index| try rotateLocal(&out, index, .{ 1, 0, 0 }, hip);
    try rotateKneeFlex(&out, LOWER_LEG_LEFT, knee);
    try rotateKneeFlex(&out, LOWER_LEG_RIGHT, knee);
    for ([_]usize{ UPPER_ARM_LEFT, UPPER_ARM_RIGHT }) |index| try rotateLocal(&out, index, .{ 1, 0, 0 }, arm);
    return out;
}

fn sitKey(frame_id: u64) Error!pose.Frame {
    var out = try restFrame(frame_id);
    out.root_translation[1] = TUNING.sit_root_y;
    try rotateLocal(&out, PELVIS, .{ 1, 0, 0 }, TUNING.sit_pelvis_degrees);
    for ([_]usize{ UPPER_LEG_LEFT, UPPER_LEG_RIGHT }) |index| try rotateLocal(&out, index, .{ 1, 0, 0 }, TUNING.sit_hip_degrees);
    try rotateKneeFlex(&out, LOWER_LEG_LEFT, TUNING.sit_knee_degrees);
    try rotateKneeFlex(&out, LOWER_LEG_RIGHT, TUNING.sit_knee_degrees);
    for ([_]usize{ UPPER_ARM_LEFT, UPPER_ARM_RIGHT }) |index| try rotateLocal(&out, index, .{ 1, 0, 0 }, TUNING.sit_arm_degrees);
    for ([_]usize{ LOWER_ARM_LEFT, LOWER_ARM_RIGHT }) |index| try rotateLocal(&out, index, .{ 1, 0, 0 }, TUNING.sit_elbow_degrees);
    return out;
}

fn layKey(frame_id: u64) Error!pose.Frame {
    var out = try restFrame(frame_id);
    out.root_translation[1] = TUNING.lay_root_y;
    try rotateLocal(&out, PELVIS, .{ 1, 0, 0 }, TUNING.lay_pelvis_degrees);
    for ([_]usize{ UPPER_ARM_LEFT, UPPER_ARM_RIGHT }) |index| try rotateLocal(&out, index, .{ 1, 0, 0 }, TUNING.lay_arm_degrees);
    try rotateKneeFlex(&out, LOWER_LEG_LEFT, TUNING.lay_knee_degrees);
    try rotateKneeFlex(&out, LOWER_LEG_RIGHT, TUNING.lay_knee_degrees);
    return out;
}

fn sampleIdle(frame_id: u64, seconds: f32) Error!pose.Frame {
    const half = TUNING.idle_duration_seconds * 0.5;
    if (seconds <= half) return blend(try idleKey(frame_id, 0), try idleKey(frame_id, 1), seconds / half);
    return blend(try idleKey(frame_id, 1), try idleKey(frame_id, 0), (seconds - half) / half);
}

fn sampleWalk(frame_id: u64, seconds: f32) Error!pose.Frame {
    const scaled = seconds / TUNING.walk_duration_seconds * 4;
    const segment: usize = @min(3, @as(usize, @intFromFloat(@floor(scaled))));
    const alpha = scaled - @as(f32, @floatFromInt(segment));
    const strides = [_]f32{ 0, 1, 0, -1, 0 };
    return blend(
        try walkKey(frame_id, strides[segment]),
        try walkKey(frame_id, strides[segment + 1]),
        alpha,
    );
}

fn sampleJump(frame_id: u64, seconds: f32) Error!pose.Frame {
    if (seconds <= TUNING.jump_launch_time_seconds) return blend(
        try jumpKey(frame_id, .crouch),
        try jumpKey(frame_id, .flight),
        seconds / TUNING.jump_launch_time_seconds,
    );
    return blend(
        try jumpKey(frame_id, .flight),
        try jumpKey(frame_id, .land),
        (seconds - TUNING.jump_launch_time_seconds) /
            (TUNING.jump_duration_seconds - TUNING.jump_launch_time_seconds),
    );
}

/// Sample one canonical clip using an explicit output frame identity.
pub fn sample(clip: ClipId, seconds_raw: f32, frame_id: u64) Error!pose.Frame {
    const seconds = try clipTime(seconds_raw, clipInfo(clip));
    return switch (clip) {
        .idle => sampleIdle(frame_id, seconds),
        .walk => sampleWalk(frame_id, seconds),
        .jump => sampleJump(frame_id, seconds),
        .sit => sitKey(frame_id),
        .lay => layKey(frame_id),
    };
}

/// Rebase canonical authored clip deltas onto a fitted target's bind-local
/// frames. Skeleton fitting may transport the canonical axes onto different
/// segment directions; replaying the template's absolute bind quaternions
/// would silently discard that authored bind.
pub fn sampleForBind(
    clip: ClipId,
    seconds_raw: f32,
    frame_id: u64,
    target_bind_local_rotations: []const pose.Quat,
) Error!pose.Frame {
    if (target_bind_local_rotations.len != BONE_COUNT) return error.PaletteSizeMismatch;
    var out = try sample(clip, seconds_raw, frame_id);
    for (out.local_quaternions[0..BONE_COUNT], target_bind_local_rotations, generated.HUMANOID_V1_BONES) |*rotation, target_bind, canonical_bone| {
        const canonical_bind = try fk.normalizeQuat(canonical_bone.transform.rot);
        const delta = try fk.normalizeQuat(fk.multiplyQuat(fk.inverseUnitQuat(canonical_bind), rotation.*));
        rotation.* = try fk.normalizeQuat(fk.multiplyQuat(target_bind, delta));
    }
    return out;
}

pub fn rootBoneIndex() usize {
    return ROOT;
}

// ── role-addressed channels (req_4285) ───────────────────────────────────────
// Motion addresses channels by SEMANTIC ROLE, never by a rig's private bone
// id. The wire form of a role is its canonical retarget id — the same names
// character_assets emits into `retargetBoneIds()` for adopted rigs — so a body
// answers to a channel exactly when its rig bound that role. Channels a body
// does not answer to ride their parents: the law the 11 canonical bones no
// clip touches have always followed, generalized to whole rigs.

/// Every rotation channel the built-in clips drive, in stable channel order.
/// Root translation is the one non-rotation channel and rides `ChannelSample`.
pub const CHANNEL_IDS = [_][]const u8{
    "pelvis",
    "spine_lower",
    "spine_upper",
    "head",
    "upper_arm_left",
    "lower_arm_left",
    "upper_arm_right",
    "lower_arm_right",
    "upper_leg_left",
    "lower_leg_left",
    "upper_leg_right",
    "lower_leg_right",
};

const CHANNEL_BONE_INDICES = blk: {
    var indices: [CHANNEL_IDS.len]usize = undefined;
    for (CHANNEL_IDS, 0..) |channel_id, channel| indices[channel] = boneIndex(channel_id);
    break :blk indices;
};

pub const ChannelSample = struct {
    root_translation: pose.Vec3,
    /// Bind-relative rotation deltas per channel. Rebase onto any target as
    /// `normalize(target_bind_local * delta)` — the same transport
    /// `sampleForBind` applies to fitted canonical rigs, per channel.
    deltas: [CHANNEL_IDS.len]pose.Quat,
};

/// Sample one clip as role-addressed bind-relative deltas plus root
/// translation. Frame identity is a playback concern and stays with callers.
pub fn sampleChannels(clip: ClipId, seconds_raw: f32) Error!ChannelSample {
    const sampled = try sample(clip, seconds_raw, 1);
    var out = ChannelSample{
        .root_translation = sampled.root_translation,
        .deltas = undefined,
    };
    inline for (CHANNEL_BONE_INDICES, 0..) |bone_index, channel| {
        const canonical_bind = try fk.normalizeQuat(generated.HUMANOID_V1_BONES[bone_index].transform.rot);
        out.deltas[channel] = try fk.normalizeQuat(fk.multiplyQuat(
            fk.inverseUnitQuat(canonical_bind),
            sampled.local_quaternions[bone_index],
        ));
    }
    return out;
}
