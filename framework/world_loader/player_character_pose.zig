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
pub const motion_document = @import("../skeleton/motion_document.zig");
pub const clip_documents = @import("../skeleton/clip_documents.zig");

pub const MAX_OWNER_BYTES: usize = 64;
pub const HOST_OWNER: []const u8 = "compiled-world-host";

pub const Error = pose_stream.Error || clips.Error || motion_document.Error || error{
    InvalidOwner,
    OwnerMismatch,
    ExternalPoseInactive,
    RigNotInitialized,
    EvaluatedFrameMismatch,
    NoMotionChannels,
};

/// One mounted motion document (req_4285): a replayed capture take, an
/// authored keyframe document, or a migrated clip, resolved onto this body's
/// role palette once at play time. The document is borrowed — its owner is
/// whoever mounted it (the world runtime), never this state.
pub const ActiveMotion = struct {
    document: *const motion_document.Document,
    channel_targets: [motion_document.MAX_CHANNELS]?u8,
    elapsed_seconds: f32 = 0,
    /// Blend-in weight, ramping 0 → 1 so a mount never snaps from the pose
    /// underneath it.
    weight: f32 = 0,
    /// Scrub state: a paused layer holds its playhead; advance() stops
    /// accumulating dt but keeps composing, so the workbench scrubs the
    /// exact frame the mixer would play.
    paused: bool = false,
};

/// A stopped layer's goodbye: its last composed pose, snapshotted so the
/// document can be freed immediately, held-and-faded toward whatever plays
/// underneath — the capture gate's dropout discipline reused as the mixer's
/// blend-out law.
const FadingMotion = struct {
    channel_targets: [motion_document.MAX_CHANNELS]?u8,
    rotations: [motion_document.MAX_CHANNELS]pose_stream.Quat,
    coverage: u32,
    has_root: bool,
    root_translation: pose_stream.Vec3,
    weight: f32,
};

/// Independent per-role layer slots, ascending priority. Slot 0 is the base
/// override (a replayed take, a migrated clip); higher slots compose partial
/// documents over it by role coverage — wave over walk.
pub const MAX_MOTION_LAYERS: usize = 4;
/// Blend windows lifted from the capture gate's hold/fade dropout law.
pub const MOTION_BLEND_IN_SECONDS: f32 = 0.15;
pub const MOTION_BLEND_OUT_SECONDS: f32 = 0.35;

/// Which sampler the clip floor plays (req_4294). `.table` is the procedural
/// reference in humanoid_clips; `.document` replays the generated RJAN clip
/// documents through the same `motion_document.sample` the mixer's layers
/// use. The default flips to `.document` once per-clip playback parity is
/// shot-verified (the roof's gate, req_4285); the table then stays as the
/// documents' generator input. `RJIT_CLIP_SOURCE=table|document` pins it —
/// the repro hook of the `RJIT_FORCE_GAIT` family.
pub const ClipFloorSource = enum { table, document };
var clip_floor_source: ClipFloorSource = .table;

pub fn setClipFloorSource(source: ClipFloorSource) void {
    clip_floor_source = source;
}

pub fn clipFloorSource() ClipFloorSource {
    return clip_floor_source;
}

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
    motion_layers: [MAX_MOTION_LAYERS]?ActiveMotion = @splat(null),
    fading_layers: [MAX_MOTION_LAYERS]?FadingMotion = @splat(null),
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

    /// Mount a motion document on layer 0 — the base override slot. Channels
    /// resolve against the same role-aliased palette clips use; a document
    /// whose roles this body does not bind at all is refused rather than
    /// silently frozen. An active external owner (capture, host stream)
    /// still wins everything.
    pub fn playMotion(
        self: *State,
        document: *const motion_document.Document,
        role_ids: []const []const u8,
    ) Error!void {
        return self.playMotionLayer(document, role_ids, 0);
    }

    /// Mount a motion document on one mixer layer. Higher layers compose
    /// over lower ones by role coverage — the wave-over-walk law. Replacing
    /// a mounted layer crossfades: the old layer's pose snapshots into the
    /// blend-out lane while the new one blends in.
    pub fn playMotionLayer(
        self: *State,
        document: *const motion_document.Document,
        role_ids: []const []const u8,
        layer: usize,
    ) Error!void {
        if (self.bone_count == 0) return error.RigNotInitialized;
        if (role_ids.len != self.bone_count) return error.PaletteSizeMismatch;
        if (layer >= MAX_MOTION_LAYERS) return error.NoMotionChannels;
        var targets: [motion_document.MAX_CHANNELS]?u8 = @splat(null);
        var matched: usize = 0;
        for (document.channel_ids, 0..) |channel_id, channel| {
            for (role_ids, 0..) |role_id, index| {
                if (std.mem.eql(u8, role_id, channel_id)) {
                    targets[channel] = @intCast(index);
                    matched += 1;
                    break;
                }
            }
        }
        if (matched == 0) return error.NoMotionChannels;
        self.snapshotLayerForFade(layer);
        self.motion_layers[layer] = .{ .document = document, .channel_targets = targets };
    }

    /// Stop one layer. The document may be freed immediately: the layer's
    /// last composed pose is snapshotted and fades out on its own.
    pub fn stopMotionLayer(self: *State, layer: usize) void {
        if (layer >= MAX_MOTION_LAYERS) return;
        self.snapshotLayerForFade(layer);
        self.motion_layers[layer] = null;
    }

    /// Stop every layer (fading). Documents may be freed immediately.
    pub fn stopMotion(self: *State) void {
        for (0..MAX_MOTION_LAYERS) |layer| self.stopMotionLayer(layer);
    }

    pub fn motionLayerMounted(self: *const State, layer: usize) bool {
        return layer < MAX_MOTION_LAYERS and self.motion_layers[layer] != null;
    }

    /// Park a layer's playhead at an exact time — the workbench scrub. The
    /// blend-in ramp is bypassed: scrubbing is authoring, and the author is
    /// owed the exact pose, not an approach to it.
    pub fn scrubMotionLayer(self: *State, layer: usize, seconds: f32) Error!void {
        if (layer >= MAX_MOTION_LAYERS) return error.NoMotionChannels;
        if (!std.math.isFinite(seconds) or seconds < 0) return error.InvalidSampleTime;
        const active = if (self.motion_layers[layer]) |*value| value else return error.NoMotionChannels;
        active.elapsed_seconds = seconds;
        active.paused = true;
        active.weight = 1;
    }

    /// Release a scrubbed layer back into normal playback from wherever the
    /// playhead stands.
    pub fn resumeMotionLayer(self: *State, layer: usize) Error!void {
        if (layer >= MAX_MOTION_LAYERS) return error.NoMotionChannels;
        const active = if (self.motion_layers[layer]) |*value| value else return error.NoMotionChannels;
        active.paused = false;
    }

    fn snapshotLayerForFade(self: *State, layer: usize) void {
        const active = if (self.motion_layers[layer]) |*value| value else return;
        if (active.weight <= 0) {
            self.motion_layers[layer] = null;
            return;
        }
        const sampled = motion_document.sample(active.document, active.elapsed_seconds) catch {
            self.motion_layers[layer] = null;
            return;
        };
        var fading = FadingMotion{
            .channel_targets = active.channel_targets,
            .rotations = @splat(pose_stream.fk.IDENTITY_QUAT),
            .coverage = sampled.coverage,
            .has_root = sampled.has_root,
            .root_translation = sampled.root_translation,
            .weight = active.weight,
        };
        for (0..active.document.channel_ids.len) |channel| {
            const bit = @as(u32, 1) << @intCast(channel);
            if ((sampled.coverage & bit) == 0) continue;
            const target = active.channel_targets[channel] orelse continue;
            fading.rotations[channel] = pose_stream.fk.normalizeQuat(pose_stream.fk.multiplyQuat(
                self.bind_local_rotations[target],
                sampled.deltas[channel],
            )) catch pose_stream.fk.IDENTITY_QUAT;
        }
        self.fading_layers[layer] = fading;
        self.motion_layers[layer] = null;
    }

    fn composeFading(frame: *pose_stream.Frame, fading: *FadingMotion, dt: f32) Error!bool {
        fading.weight -= dt / MOTION_BLEND_OUT_SECONDS;
        if (fading.weight <= 0) return false;
        for (0..motion_document.MAX_CHANNELS) |channel| {
            const bit = @as(u32, 1) << @intCast(channel);
            if ((fading.coverage & bit) == 0) continue;
            const target = fading.channel_targets[channel] orelse continue;
            frame.local_quaternions[target] = try pose_stream.fk.slerpQuat(
                frame.local_quaternions[target],
                fading.rotations[channel],
                fading.weight,
            );
        }
        if (fading.has_root) {
            for (&frame.root_translation, fading.root_translation) |*value, target_value| {
                value.* += (target_value - value.*) * fading.weight;
            }
        }
        return true;
    }

    fn composeActive(self: *State, frame: *pose_stream.Frame, active: *ActiveMotion, dt: f32) Error!void {
        if (!active.paused) active.elapsed_seconds += dt;
        active.weight = @min(1, active.weight + dt / MOTION_BLEND_IN_SECONDS);
        if (active.weight <= 0) return;
        const sampled = try motion_document.sample(active.document, active.elapsed_seconds);
        for (0..active.document.channel_ids.len) |channel| {
            const bit = @as(u32, 1) << @intCast(channel);
            if ((sampled.coverage & bit) == 0) continue;
            const target = active.channel_targets[channel] orelse continue;
            const layer_rotation = try pose_stream.fk.normalizeQuat(pose_stream.fk.multiplyQuat(
                self.bind_local_rotations[target],
                sampled.deltas[channel],
            ));
            frame.local_quaternions[target] = try pose_stream.fk.slerpQuat(
                frame.local_quaternions[target],
                layer_rotation,
                active.weight,
            );
        }
        if (sampled.has_root) {
            for (&frame.root_translation, sampled.root_translation) |*value, target_value| {
                value.* += (target_value - value.*) * active.weight;
            }
        }
    }

    fn anyMotion(self: *const State) bool {
        for (self.motion_layers) |layer| if (layer != null) return true;
        for (self.fading_layers) |layer| if (layer != null) return true;
        return false;
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

        // The mixer floor: built-in clips when this body binds the clip
        // roles, its bind pose otherwise. Clips are role-addressed — a body
        // answers to a clip channel exactly when its rig bound that role.
        // Two samplers can answer (req_4294): the generated clip documents
        // (via the same motion_document.sample every mounted layer plays)
        // or the procedural table they were generated from.
        var frame = self.bindFrame();
        if (self.clip_capable) {
            const seconds = explicit_clip_seconds orelse self.clip_elapsed_seconds;
            switch (clip_floor_source) {
                .table => {
                    const channels = try clips.sampleChannels(fallback_clip, seconds);
                    frame.root_translation = channels.root_translation;
                    for (channels.deltas, self.clip_channel_targets) |delta, target_slot| {
                        const target = target_slot orelse continue;
                        frame.local_quaternions[target] = try pose_stream.fk.normalizeQuat(pose_stream.fk.multiplyQuat(
                            self.bind_local_rotations[target],
                            delta,
                        ));
                    }
                },
                .document => {
                    const doc = try clip_documents.document(fallback_clip);
                    const sampled = try motion_document.sample(doc, seconds);
                    if (sampled.has_root) frame.root_translation = sampled.root_translation;
                    for (self.clip_channel_targets, 0..) |target_slot, channel| {
                        if ((sampled.coverage & (@as(u32, 1) << @intCast(channel))) == 0) continue;
                        const target = target_slot orelse continue;
                        frame.local_quaternions[target] = try pose_stream.fk.normalizeQuat(pose_stream.fk.multiplyQuat(
                            self.bind_local_rotations[target],
                            sampled.deltas[channel],
                        ));
                    }
                },
            }
        }

        // Motion-document layers compose over the floor in ascending slot
        // order, each owning exactly the roles it covers (wave over walk).
        // A stopped layer's snapshot fades beneath its slot's live document.
        for (0..MAX_MOTION_LAYERS) |layer| {
            if (self.fading_layers[layer]) |*fading| {
                if (!try composeFading(&frame, fading, dt)) self.fading_layers[layer] = null;
            }
            if (self.motion_layers[layer]) |*active| {
                try self.composeActive(&frame, active, dt);
            }
        }
        self.last_root_translation = frame.root_translation;
        return frame;
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
