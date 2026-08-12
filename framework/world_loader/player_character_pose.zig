//! One mounted character's built-in clip and external-pose state.
//!
//! The strict CharacterAsset owns geometry, bind data, and the mutable GPU
//! palette. This module owns only the current pose source. Built-in clips are
//! role-addressed (req_4285): the mount resolves each clip channel against the
//! role-aliased palette once, so any body that binds the clip roles — the
//! canonical humanoid or an adopted external rig — plays them. Clips are
//! sampled until an explicitly named external owner activates; exact,
//! monotonically increasing capture frame IDs then flow through the v1 local
//! quaternion Interpolator until that same owner clears the override.

const std = @import("std");
pub const pose_stream = @import("../skeleton/pose_stream.zig");
pub const clips = @import("../skeleton/humanoid_clips.zig");
pub const rig_pose = @import("../skeleton/rig_pose.zig");

pub const MAX_OWNER_BYTES: usize = 64;
pub const HOST_OWNER: []const u8 = "compiled-world-host";

pub const Error = pose_stream.Error || clips.Error || error{
    InvalidOwner,
    OwnerMismatch,
    ExternalPoseInactive,
    RigNotInitialized,
    EvaluatedFrameMismatch,
};

pub const OwnerId = struct {
    bytes: [MAX_OWNER_BYTES]u8 = undefined,
    len: usize = 0,

    pub fn set(self: *OwnerId, owner_id: []const u8) Error!void {
        if (owner_id.len == 0 or owner_id.len > self.bytes.len) return error.InvalidOwner;
        @memcpy(self.bytes[0..owner_id.len], owner_id);
        self.len = owner_id.len;
    }

    pub fn clear(self: *OwnerId) void {
        self.len = 0;
    }

    pub fn matches(self: *const OwnerId, owner_id: []const u8) bool {
        return self.len > 0 and std.mem.eql(u8, self.bytes[0..self.len], owner_id);
    }

    pub fn value(self: *const OwnerId) ?[]const u8 {
        return if (self.len == 0) null else self.bytes[0..self.len];
    }
};

pub const State = struct {
    bone_count: u16 = 0,
    /// Per clip channel: the bone that answers to that semantic role, resolved
    /// once at mount from the role-aliased palette (`retargetBoneIds`).
    clip_channel_targets: [clips.CHANNEL_IDS.len]?u8 = @splat(null),
    /// A body answers to the built-in clips exactly when every clip role is
    /// bound. Partially-bound rigs hold bind pose rather than half-animate.
    clip_capable: bool = false,
    bind_local_rotations: [pose_stream.MAX_BONES]pose_stream.Quat = @splat(pose_stream.fk.IDENTITY_QUAT),
    owner: OwnerId = .{},
    interpolator: ?pose_stream.Interpolator = null,
    last_root_translation: pose_stream.Vec3 = .{ 0, 0, 0 },
    last_external_frame_id: ?u64 = null,
    current_clip: clips.ClipId = .idle,
    clip_elapsed_seconds: f32 = 0,
    next_clip_frame_id: u64 = 1,

    /// Pin the stable target palette and bind-local rotations once when the
    /// strict asset is mounted. Replacing an asset resets all pose ownership.
    /// `role_ids` is the role-aliased palette (`CharacterAsset.retargetBoneIds`):
    /// role-bound bones carry their canonical channel name, everything else its
    /// private stable id. Clip channels resolve against it by role, never by a
    /// rig's private bone-ID string (req_4285).
    pub fn resetRig(
        self: *State,
        bones: []const rig_pose.Bone,
        role_ids: []const []const u8,
    ) Error!void {
        if (bones.len == 0 or bones.len > pose_stream.MAX_BONES) return error.InvalidBoneCount;
        if (role_ids.len != bones.len) return error.PaletteSizeMismatch;
        var targets: [clips.CHANNEL_IDS.len]?u8 = @splat(null);
        var mapped: usize = 0;
        for (clips.CHANNEL_IDS, &targets) |channel_id, *slot| {
            for (role_ids, 0..) |role_id, index| {
                if (std.mem.eql(u8, role_id, channel_id)) {
                    slot.* = @intCast(index);
                    mapped += 1;
                    break;
                }
            }
        }
        self.* = .{
            .bone_count = @intCast(bones.len),
            .clip_channel_targets = targets,
            .clip_capable = mapped == clips.CHANNEL_IDS.len,
        };
        for (bones, 0..) |bone, index| {
            self.bind_local_rotations[index] = try pose_stream.fk.normalizeQuat(bone.bind_rotation);
        }
    }

    pub fn resetEmpty(self: *State) void {
        self.* = .{};
    }

    pub fn ownedBy(self: *const State, owner_id: []const u8) bool {
        return self.owner.matches(owner_id);
    }

    /// Enter external mode from the pose currently displayed. This makes the
    /// first ingress interpolate from the clip/bind pose rather than snapping
    /// from a second hidden bind state.
    pub fn activate(
        self: *State,
        owner_id: []const u8,
        displayed_root: pose_stream.Vec3,
        displayed_local_rotations: []const pose_stream.Quat,
    ) Error!void {
        if (self.bone_count == 0) return error.RigNotInitialized;
        if (displayed_local_rotations.len != self.bone_count) return error.PaletteSizeMismatch;
        var next = try pose_stream.Interpolator.init(displayed_local_rotations);
        next.current_frame.root_translation = displayed_root;
        next.target_frame.root_translation = displayed_root;
        try self.owner.set(owner_id);
        self.interpolator = next;
        self.last_root_translation = displayed_root;
        self.last_external_frame_id = null;
    }

    pub fn publishFrame(self: *State, owner_id: []const u8, frame: pose_stream.Frame) Error!u64 {
        if (!self.owner.matches(owner_id)) return error.OwnerMismatch;
        const interpolator = &(self.interpolator orelse return error.ExternalPoseInactive);
        try interpolator.ingestFrame(frame);
        self.last_external_frame_id = frame.frame_id;
        return frame.frame_id;
    }

    pub fn publishBytes(self: *State, owner_id: []const u8, bytes: []const u8) Error!u64 {
        if (!self.owner.matches(owner_id)) return error.OwnerMismatch;
        const interpolator = &(self.interpolator orelse return error.ExternalPoseInactive);
        const frame = try pose_stream.decode(bytes, self.bone_count);
        try interpolator.ingestFrame(frame);
        self.last_external_frame_id = frame.frame_id;
        return frame.frame_id;
    }

    /// Ownership-guarded teardown. A replaced capture session cannot clear a
    /// newer session's pose merely because its close callback ran later.
    pub fn clear(self: *State, owner_id: []const u8) bool {
        if (!self.owner.matches(owner_id)) return false;
        self.owner.clear();
        self.interpolator = null;
        self.last_external_frame_id = null;
        return true;
    }

    /// Clear the visible external transaction without releasing ownership.
    /// Capture calibration/camera changes use this to return the target to bind
    /// while keeping the same session ready for its next completed frame.
    pub fn clearPublished(self: *State, owner_id: []const u8) Error!bool {
        if (!self.owner.matches(owner_id)) return false;
        const bind = self.bind_local_rotations[0..self.bone_count];
        var reset = try pose_stream.Interpolator.init(bind);
        reset.current_frame.root_translation = .{ 0, 0, 0 };
        reset.target_frame.root_translation = .{ 0, 0, 0 };
        self.interpolator = reset;
        self.last_root_translation = .{ 0, 0, 0 };
        self.last_external_frame_id = null;
        return true;
    }

    fn updateClipClock(self: *State, dt: f32, clip: clips.ClipId) Error!void {
        if (!std.math.isFinite(dt) or dt < 0) return error.InvalidDeltaTime;
        if (clip != self.current_clip) {
            self.current_clip = clip;
            self.clip_elapsed_seconds = 0;
        } else {
            self.clip_elapsed_seconds += dt;
        }
    }

    fn bindFrame(self: *State) pose_stream.Frame {
        const frame_id = self.next_clip_frame_id;
        self.next_clip_frame_id +%= 1;
        if (self.next_clip_frame_id == 0) self.next_clip_frame_id = 1;
        var frame = pose_stream.Frame{
            .bone_count = self.bone_count,
            .frame_id = frame_id,
            .root_translation = .{ 0, 0, 0 },
        };
        @memcpy(frame.local_quaternions[0..self.bone_count], self.bind_local_rotations[0..self.bone_count]);
        return frame;
    }

    /// Produce the one pose evaluated into CharacterAsset this render frame.
    /// `explicit_clip_seconds` pins locomotion/jump to their existing native
    /// clocks; idle/sit/lay use this state's continuous clip clock.
    pub fn advance(
        self: *State,
        dt: f32,
        fallback_clip: clips.ClipId,
        explicit_clip_seconds: ?f32,
    ) Error!pose_stream.Frame {
        if (self.bone_count == 0) return error.RigNotInitialized;
        try self.updateClipClock(dt, fallback_clip);
        if (self.interpolator) |*interpolator| {
            const sampled = try interpolator.advance(dt);
            self.last_root_translation = sampled.root_translation;
            return sampled;
        }

        // Built-in clips are role-addressed: a body answers to a clip channel
        // exactly when its rig bound that semantic role. A rig without the
        // full clip role set remains visible in bind pose until an explicit
        // capture/animation stream takes ownership of all its bones.
        if (!self.clip_capable) {
            const frame = self.bindFrame();
            self.last_root_translation = frame.root_translation;
            return frame;
        }

        const seconds = explicit_clip_seconds orelse self.clip_elapsed_seconds;
        const channels = try clips.sampleChannels(fallback_clip, seconds);
        var sampled = self.bindFrame();
        sampled.root_translation = channels.root_translation;
        for (channels.deltas, self.clip_channel_targets) |delta, target_slot| {
            const target = target_slot orelse continue;
            sampled.local_quaternions[target] = try pose_stream.fk.normalizeQuat(pose_stream.fk.multiplyQuat(
                self.bind_local_rotations[target],
                delta,
            ));
        }
        self.last_root_translation = sampled.root_translation;
        return sampled;
    }

    /// Feed the constraint-clamped rotations actually written to the GPU back
    /// into the interpolator's displayed endpoint. A hostile/out-of-range host
    /// frame therefore cannot make the next blend start from an invisible,
    /// unclamped quaternion while CharacterAsset displayed something else.
    pub fn acceptEvaluated(
        self: *State,
        frame_id: u64,
        root_translation: pose_stream.Vec3,
        local_rotations: []const pose_stream.Quat,
    ) Error!void {
        const interpolator = if (self.interpolator) |*value| value else return;
        if (interpolator.current_frame.frame_id != frame_id) return error.EvaluatedFrameMismatch;
        if (local_rotations.len != self.bone_count) return error.PaletteSizeMismatch;
        interpolator.current_frame.root_translation = root_translation;
        for (interpolator.current_frame.local_quaternions[0..self.bone_count], local_rotations) |*out, rotation| {
            out.* = try pose_stream.fk.normalizeQuat(rotation);
        }
    }
};
