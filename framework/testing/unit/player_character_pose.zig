const std = @import("std");
const mounted_pose = @import("player_character_pose");
const clips = mounted_pose.clips;
const pose_stream = mounted_pose.pose_stream;
const rig_pose = mounted_pose.rig_pose;
const fk = pose_stream.fk;

fn canonicalBones() [clips.BONE_COUNT]rig_pose.Bone {
    var out: [clips.BONE_COUNT]rig_pose.Bone = undefined;
    for (clips.generated.HUMANOID_V1_BONES, 0..) |bone, index| {
        out[index] = .{
            .parent_index = if (bone.parent) |parent_id| blk: {
                for (clips.PALETTE_IDS[0..index], 0..) |candidate, parent_index| {
                    if (std.mem.eql(u8, candidate, parent_id)) break :blk @intCast(parent_index);
                }
                unreachable;
            } else null,
            .bind_translation = bone.transform.pos,
            .bind_rotation = bone.transform.rot,
        };
    }
    return out;
}

fn externalFrame(frame_id: u64, root_x: f32) pose_stream.Frame {
    var frame = pose_stream.Frame{
        .bone_count = clips.BONE_COUNT,
        .frame_id = frame_id,
        .root_translation = .{ root_x, 0, 0 },
    };
    for (clips.generated.HUMANOID_V1_BONES, 0..) |bone, index| {
        frame.local_quaternions[index] = bone.transform.rot;
    }
    return frame;
}

test "clips drive a mounted canonical rig until an exact external frame takes ownership" {
    const bones = canonicalBones();
    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, clips.PALETTE_IDS[0..]);

    const clip_frame = try state.advance(0.1, .walk, 0.25);
    try std.testing.expect(state.owner.value() == null);
    try std.testing.expectEqual(@as(u16, clips.BONE_COUNT), clip_frame.bone_count);

    try state.activate("capture-7", clip_frame.root_translation, clip_frame.rotations());
    try std.testing.expectEqual(@as(u64, 44), try state.publishFrame("capture-7", externalFrame(44, 2)));
    const halfway = try state.advance(pose_stream.TARGET_INTERVAL_SECONDS / 2, .idle, null);
    try std.testing.expectEqual(@as(u64, 44), halfway.frame_id);
    try std.testing.expectApproxEqAbs(@as(f32, 1), halfway.root_translation[0], 1.0e-5);
    try std.testing.expectEqual(@as(u64, 44), state.last_external_frame_id.?);
}

test "owner and monotonic frame guards prevent stale capture teardown or publication" {
    const bones = canonicalBones();
    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, clips.PALETTE_IDS[0..]);
    try state.activate("capture-new", .{ 0, 0, 0 }, state.bind_local_rotations[0..state.bone_count]);
    try std.testing.expectError(error.OwnerMismatch, state.publishFrame("capture-old", externalFrame(3, 0)));
    try std.testing.expectEqual(@as(u64, 3), try state.publishFrame("capture-new", externalFrame(3, 0)));
    try std.testing.expectError(error.NonMonotonicFrame, state.publishFrame("capture-new", externalFrame(3, 1)));
    try std.testing.expect(!state.clear("capture-old"));
    try std.testing.expect(state.ownedBy("capture-new"));
    try std.testing.expect(state.clear("capture-new"));
    try std.testing.expect(state.owner.value() == null);
}

test "v1 byte ingress preserves the accepted frame identity" {
    const bones = canonicalBones();
    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, clips.PALETTE_IDS[0..]);
    try state.activate(mounted_pose.HOST_OWNER, .{ 0, 0, 0 }, state.bind_local_rotations[0..state.bone_count]);
    const frame = externalFrame(9_001, 0.5);
    var bytes: [pose_stream.HEADER_BYTES + clips.BONE_COUNT * pose_stream.QUATERNION_BYTES]u8 = undefined;
    try pose_stream.encode(frame, &bytes);
    try std.testing.expectEqual(@as(u64, 9_001), try state.publishBytes(mounted_pose.HOST_OWNER, &bytes));
    try std.testing.expectEqual(@as(u64, 9_001), (try state.advance(0, .idle, null)).frame_id);
}

test "clearing a capture transaction retains its owner and returns to bind" {
    const bones = canonicalBones();
    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, clips.PALETTE_IDS[0..]);
    try state.activate("capture-12", .{ 0, 0, 0 }, state.bind_local_rotations[0..state.bone_count]);
    _ = try state.publishFrame("capture-12", externalFrame(88, 3));
    try std.testing.expect(try state.clearPublished("capture-12"));
    try std.testing.expect(state.ownedBy("capture-12"));
    try std.testing.expect(state.last_external_frame_id == null);
    const bind = try state.advance(0, .idle, null);
    try std.testing.expectEqual(@as(f32, 0), bind.root_translation[0]);
    try std.testing.expectEqual(@as(u64, 0), bind.frame_id);
    try std.testing.expectEqual(@as(u64, 89), try state.publishFrame("capture-12", externalFrame(89, 1)));
}

test "a role-less external palette remains visible in bind pose until capture owns it" {
    const count = 53;
    var bones: [count]rig_pose.Bone = undefined;
    var ids: [count][]const u8 = @splat("external_joint");
    for (&bones, 0..) |*bone, index| {
        bone.* = .{
            .parent_index = if (index == 0) null else @intCast(index - 1),
            .bind_translation = if (index == 0) .{ 0, 0, 0 } else .{ 0, 0.01, 0 },
            .constraint = .unconstrained,
        };
    }
    // No semantic aliases at all: a rig that answers to zero clip roles holds
    // bind pose no matter which clip the world selects.
    ids[0] = "external_joint_0";

    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, &ids);
    const bind = try state.advance(0, .walk, 0.25);
    try std.testing.expectEqual(@as(u16, count), bind.bone_count);
    try std.testing.expect(!state.clip_capable);

    try state.activate("capture-external", bind.root_translation, bind.rotations());
    var captured = bind;
    captured.frame_id = 44;
    captured.root_translation = .{ 0.2, 0, 0 };
    try std.testing.expectEqual(@as(u64, 44), try state.publishFrame("capture-external", captured));
}

test "an adopted rig with the full clip role set plays clips on its own indices" {
    const count = 53;
    var bones: [count]rig_pose.Bone = undefined;
    var ids: [count][]const u8 = undefined;
    var id_storage: [count][24]u8 = undefined;
    for (&bones, &ids, 0..) |*bone, *id, index| {
        bone.* = .{
            .parent_index = if (index == 0) null else @intCast(index - 1),
            .bind_translation = if (index == 0) .{ 0, 0, 0 } else .{ 0, 0.01, 0 },
            .constraint = .unconstrained,
        };
        id.* = std.fmt.bufPrint(&id_storage[index], "external_joint_{d}", .{index}) catch unreachable;
    }
    // Scatter the role aliases across non-canonical indices, the way an
    // adopted SkinTokens palette carries them (retargetBoneIds).
    for (clips.CHANNEL_IDS, 0..) |channel_id, channel| {
        ids[3 + channel * 4] = channel_id;
    }

    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, &ids);
    try std.testing.expect(state.clip_capable);

    // Mid-stride walk: hips must leave bind on the aliased indices, the root
    // must bob, and every un-aliased bone must hold its bind-local rotation.
    const frame = try state.advance(0, .walk, 0.25);
    try std.testing.expectEqual(@as(u16, count), frame.bone_count);
    const canonical = try clips.sample(.walk, 0.25, 1);
    try std.testing.expectApproxEqAbs(canonical.root_translation[1], frame.root_translation[1], 1.0e-6);
    var moved: usize = 0;
    for (clips.CHANNEL_IDS, 0..) |_, channel| {
        const target = state.clip_channel_targets[channel].?;
        const rotation = frame.local_quaternions[target];
        const bind = state.bind_local_rotations[target];
        const dot = rotation[0] * bind[0] + rotation[1] * bind[1] + rotation[2] * bind[2] + rotation[3] * bind[3];
        if (@abs(dot) < 1.0 - 1.0e-6) moved += 1;
    }
    try std.testing.expect(moved >= 8);
    for (ids, 0..) |id, index| {
        var aliased = false;
        for (clips.CHANNEL_IDS) |channel_id| {
            if (std.mem.eql(u8, id, channel_id)) aliased = true;
        }
        if (aliased) continue;
        try std.testing.expectEqual(state.bind_local_rotations[index], frame.local_quaternions[index]);
    }
}

test "the role-addressed clip path matches sampleForBind on the canonical rig" {
    const bones = canonicalBones();
    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, clips.PALETTE_IDS[0..]);
    try std.testing.expect(state.clip_capable);

    const frame = try state.advance(0, .walk, 0.25);
    const reference = try clips.sampleForBind(.walk, 0.25, frame.frame_id, state.bind_local_rotations[0..clips.BONE_COUNT]);
    try std.testing.expectApproxEqAbs(reference.root_translation[1], frame.root_translation[1], 1.0e-6);
    for (frame.rotations(), reference.rotations()) |actual, expected| {
        const dot = actual[0] * expected[0] + actual[1] * expected[1] + actual[2] * expected[2] + actual[3] * expected[3];
        try std.testing.expect(@abs(dot) > 1.0 - 1.0e-5);
    }
}

test "a motion document replays onto two different bodies through their role palettes" {
    const motion = mounted_pose.motion_document;
    const keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b11, .root_translation = .{ 0, 0, 0 }, .deltas = &.{ fk.IDENTITY_QUAT, fk.IDENTITY_QUAT } },
        .{
            .time_seconds = 1.0,
            .coverage = 0b11,
            .root_translation = .{ 0, 0.2, 0 },
            .deltas = &.{
                try fk.axisAngle(.{ 1, 0, 0 }, 0.6),
                try fk.axisAngle(.{ 1, 0, 0 }, -0.4),
            },
        },
    };
    const doc = motion.Document{
        .allocator = std.testing.allocator,
        .name = "wave",
        .looping = false,
        .duration_seconds = 1.0,
        .source = .hand,
        .channel_ids = &.{ "pelvis", "upper_arm_left" },
        .keys = &keys,
        .runs = &.{},
    };
    try motion.validate(&doc);

    // Body one: the canonical rig — channels land on canonical indices.
    const bones = canonicalBones();
    var canonical_state: mounted_pose.State = .{};
    try canonical_state.resetRig(&bones, clips.PALETTE_IDS[0..]);
    try canonical_state.playMotion(&doc, clips.PALETTE_IDS[0..]);
    const on_canonical = try canonical_state.advance(0.5, .idle, null);
    try std.testing.expectApproxEqAbs(@as(f32, 0.1), on_canonical.root_translation[1], 1.0e-5);

    // Body two: a 53-bone adopted rig with role aliases on scattered indices.
    const count = 53;
    var external_bones: [count]rig_pose.Bone = undefined;
    var ids: [count][]const u8 = undefined;
    var id_storage: [count][24]u8 = undefined;
    for (&external_bones, &ids, 0..) |*bone, *id, index| {
        bone.* = .{
            .parent_index = if (index == 0) null else @intCast(index - 1),
            .bind_translation = if (index == 0) .{ 0, 0, 0 } else .{ 0, 0.01, 0 },
            .constraint = .unconstrained,
        };
        id.* = std.fmt.bufPrint(&id_storage[index], "external_joint_{d}", .{index}) catch unreachable;
    }
    ids[7] = "pelvis";
    ids[29] = "upper_arm_left";
    var external_state: mounted_pose.State = .{};
    try external_state.resetRig(&external_bones, &ids);
    try external_state.playMotion(&doc, &ids);
    const on_external = try external_state.advance(0.5, .idle, null);
    try std.testing.expectApproxEqAbs(@as(f32, 0.1), on_external.root_translation[1], 1.0e-5);

    // The same halfway delta reaches each body's own bone for the role.
    const external_arm = on_external.local_quaternions[29];
    const bind = external_state.bind_local_rotations[29];
    const dot = external_arm[0] * bind[0] + external_arm[1] * bind[1] + external_arm[2] * bind[2] + external_arm[3] * bind[3];
    try std.testing.expect(@abs(dot) < 1.0 - 1.0e-6);
    // Unmapped bones hold bind exactly.
    try std.testing.expectEqual(external_state.bind_local_rotations[30], on_external.local_quaternions[30]);

    // A document speaking only roles this body lacks is refused loudly.
    const foreign = motion.Document{
        .allocator = std.testing.allocator,
        .name = "tail-swish",
        .looping = false,
        .duration_seconds = 1.0,
        .source = .hand,
        .channel_ids = &.{"tail"},
        .keys = &.{.{ .time_seconds = 0, .coverage = 0b1, .deltas = &.{fk.IDENTITY_QUAT} }},
        .runs = &.{},
    };
    var refused: mounted_pose.State = .{};
    try refused.resetRig(&external_bones, &ids);
    try std.testing.expectError(error.NoMotionChannels, refused.playMotion(&foreign, &ids));
}
