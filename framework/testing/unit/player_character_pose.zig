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

test "the five clips migrate into documents with playback parity on both bodies" {
    const clip_documents = @import("player_character_pose").clip_documents;
    const allocator = std.testing.allocator;

    const canonical_bones = canonicalBones();
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
    for (clips.CHANNEL_IDS, 0..) |channel_id, channel| {
        ids[3 + channel * 4] = channel_id;
    }

    // Pin the floor to the procedural table: this test compares the table
    // against a MOUNTED document layer, and the flipped default (.document)
    // would silently turn it into document-vs-document.
    mounted_pose.setClipFloorSource(.table);
    defer mounted_pose.setClipFloorSource(.document);

    const all_clips = [_]clips.ClipId{ .idle, .walk, .jump, .sit, .lay };
    for (all_clips) |clip| {
        var doc = try clip_documents.clipDocument(allocator, clip);
        defer doc.deinit();
        const duration = clips.clipInfo(clip).duration_seconds;

        var step: usize = 0;
        while (step <= 24) : (step += 1) {
            // Sweep past the end too: loop seams wrap, non-looping holds.
            const t = duration * @as(f32, @floatFromInt(step)) / 20.0;

            inline for (.{ "canonical", "external" }) |body| {
                const is_canonical = comptime std.mem.eql(u8, body, "canonical");
                const bones: []const rig_pose.Bone = if (is_canonical) &canonical_bones else &external_bones;
                const role_ids: []const []const u8 = if (is_canonical) clips.PALETTE_IDS[0..] else &ids;

                var clip_state: mounted_pose.State = .{};
                try clip_state.resetRig(bones, role_ids);
                const via_clip = try clip_state.advance(0, clip, t);

                // Pin the clip floor to the same explicit seconds: the
                // document IS the clip, so composition is weight-invariant
                // and any value drift is the document's fault alone.
                var doc_state: mounted_pose.State = .{};
                try doc_state.resetRig(bones, role_ids);
                try doc_state.playMotion(&doc, role_ids);
                const via_doc = try doc_state.advance(t, clip, t);

                for (0..3) |axis| {
                    try std.testing.expectApproxEqAbs(
                        via_clip.root_translation[axis],
                        via_doc.root_translation[axis],
                        1.0e-4,
                    );
                }
                for (via_clip.rotations(), via_doc.rotations()) |a, b| {
                    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
                    try std.testing.expect(@abs(dot) > 1.0 - 1.0e-4);
                }
            }
        }
    }
}

test "the resident clip document library holds the five clips in channel order" {
    const clip_documents = mounted_pose.clip_documents;
    const all_clips = [_]clips.ClipId{ .idle, .walk, .jump, .sit, .lay };
    for (all_clips) |clip| {
        const doc = try clip_documents.document(clip);
        const info = clips.clipInfo(clip);
        try std.testing.expectEqualStrings(@tagName(clip), doc.name);
        try std.testing.expectEqual(info.duration_seconds, doc.duration_seconds);
        try std.testing.expectEqual(info.looping, doc.looping);
        // The document clip floor indexes samples by CHANNEL_IDS position.
        try std.testing.expectEqual(clips.CHANNEL_IDS.len, doc.channel_ids.len);
        for (doc.channel_ids, clips.CHANNEL_IDS) |actual, expected| {
            try std.testing.expectEqualStrings(expected, actual);
        }
        // Resident and stable: the same clip answers with the same document.
        try std.testing.expectEqual(doc, try clip_documents.document(clip));
    }
}

test "the document clip floor replays the table clip floor on both bodies (the flip, req_4294)" {
    const canonical_bones = canonicalBones();
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
    for (clips.CHANNEL_IDS, 0..) |channel_id, channel| {
        ids[3 + channel * 4] = channel_id;
    }

    defer mounted_pose.setClipFloorSource(.document);
    const all_clips = [_]clips.ClipId{ .idle, .walk, .jump, .sit, .lay };
    for (all_clips) |clip| {
        const duration = clips.clipInfo(clip).duration_seconds;
        var step: usize = 0;
        while (step <= 24) : (step += 1) {
            const t = duration * @as(f32, @floatFromInt(step)) / 20.0;

            inline for (.{ "canonical", "external" }) |body| {
                const is_canonical = comptime std.mem.eql(u8, body, "canonical");
                const bones: []const rig_pose.Bone = if (is_canonical) &canonical_bones else &external_bones;
                const role_ids: []const []const u8 = if (is_canonical) clips.PALETTE_IDS[0..] else &ids;

                var table_state: mounted_pose.State = .{};
                try table_state.resetRig(bones, role_ids);
                mounted_pose.setClipFloorSource(.table);
                const via_table = try table_state.advance(0, clip, t);

                var document_state: mounted_pose.State = .{};
                try document_state.resetRig(bones, role_ids);
                mounted_pose.setClipFloorSource(.document);
                const via_document = try document_state.advance(0, clip, t);

                for (0..3) |axis| {
                    try std.testing.expectApproxEqAbs(
                        via_table.root_translation[axis],
                        via_document.root_translation[axis],
                        1.0e-4,
                    );
                }
                for (via_table.rotations(), via_document.rotations()) |a, b| {
                    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
                    try std.testing.expect(@abs(dot) > 1.0 - 1.0e-4);
                }
            }
        }
    }
}

test "wave over walk: a partial document owns exactly the roles it covers" {
    const motion = mounted_pose.motion_document;
    const bones = canonicalBones();

    // A one-channel wave: the left upper arm swings while everything else
    // belongs to whatever plays underneath.
    const wave_keys = [_]motion.Key{
        .{ .time_seconds = 0, .coverage = 0b1, .deltas = &.{try fk.axisAngle(.{ 0, 0, 1 }, 1.2)} },
        .{ .time_seconds = 1.0, .coverage = 0b1, .deltas = &.{try fk.axisAngle(.{ 0, 0, 1 }, 1.2)} },
    };
    const wave = motion.Document{
        .allocator = std.testing.allocator,
        .name = "wave",
        .looping = true,
        .duration_seconds = 1.0,
        .source = .hand,
        .channel_ids = &.{"upper_arm_left"},
        .keys = &wave_keys,
        .runs = &.{},
    };
    try motion.validate(&wave);

    var state: mounted_pose.State = .{};
    try state.resetRig(&bones, clips.PALETTE_IDS[0..]);
    try state.playMotionLayer(&wave, clips.PALETTE_IDS[0..], 1);

    // Walk keeps the floor; enough dt saturates the wave's blend-in.
    const mixed = try state.advance(0.5, .walk, 0.25);
    const reference = try state_reference_walk(&bones);

    var arm_index: usize = 0;
    var hip_index: usize = 0;
    for (clips.PALETTE_IDS, 0..) |id, index| {
        if (std.mem.eql(u8, id, "upper_arm_left")) arm_index = index;
        if (std.mem.eql(u8, id, "upper_leg_left")) hip_index = index;
    }

    // The hip is the walk's, untouched by the wave.
    {
        const a = mixed.local_quaternions[hip_index];
        const b = reference.local_quaternions[hip_index];
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        try std.testing.expect(@abs(dot) > 1.0 - 1.0e-5);
    }
    // The arm is the wave's, not the walk's.
    {
        const a = mixed.local_quaternions[arm_index];
        const b = reference.local_quaternions[arm_index];
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        try std.testing.expect(@abs(dot) < 1.0 - 1.0e-3);
    }
    // The walk's root bob survives — the wave carries no root channel.
    try std.testing.expectApproxEqAbs(reference.root_translation[1], mixed.root_translation[1], 1.0e-5);

    // Stopping the wave frees its document immediately (snapshot fade), and
    // the pose returns to pure walk once the fade window elapses.
    state.stopMotionLayer(1);
    try std.testing.expect(!state.motionLayerMounted(1));
    _ = try state.advance(mounted_pose.MOTION_BLEND_OUT_SECONDS + 0.1, .walk, 0.25);
    const settled = try state.advance(0, .walk, 0.25);
    {
        const a = settled.local_quaternions[arm_index];
        const b = reference.local_quaternions[arm_index];
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        try std.testing.expect(@abs(dot) > 1.0 - 1.0e-5);
    }
}

fn state_reference_walk(bones: []const rig_pose.Bone) !pose_stream.Frame {
    var reference_state: mounted_pose.State = .{};
    try reference_state.resetRig(bones, clips.PALETTE_IDS[0..]);
    return reference_state.advance(0, .walk, 0.25);
}
