//! The five built-in clips as RJAN motion documents (req_4285, Pillar 2b).
//!
//! Each clip's authored keys are enumerable from ClipTuning: this module
//! samples the procedural table at exactly its authored key times and emits
//! the equivalent role-addressed document. The table remains the reference
//! implementation until playback parity is shot-verified per clip; these
//! documents are generated FROM it, never beside it, so the two cannot drift.
//!
//! Parity is exact by construction: slerp is left-invariant under a fixed
//! unit quaternion, so interpolating bind-relative deltas (the document path)
//! equals interpolating absolute bone-local rotations and then rebasing (the
//! clip path), key for key, segment for segment.

const std = @import("std");
pub const motion = @import("motion_document.zig");
pub const clips = @import("humanoid_clips.zig");

pub const Error = motion.Error || clips.Error;

const FULL_COVERAGE: u32 = (@as(u32, 1) << @intCast(clips.CHANNEL_IDS.len)) - 1;

fn keyTimes(clip: clips.ClipId) []const f32 {
    const tuning = clips.TUNING;
    return switch (clip) {
        // Breath out at 0, breath in at the half; the loop seam blends back.
        .idle => &.{ 0, tuning.idle_duration_seconds * 0.5 },
        // Stride 0, +1, 0, -1 at the quarter phases; the seam closes the gait.
        .walk => &.{
            0,
            tuning.walk_duration_seconds * 0.25,
            tuning.walk_duration_seconds * 0.5,
            tuning.walk_duration_seconds * 0.75,
        },
        // Crouch, flight at launch, land at the end. Non-looping holds land.
        .jump => &.{ 0, tuning.jump_launch_time_seconds, tuning.jump_duration_seconds },
        // Static poses: one key, held.
        .sit, .lay => &.{0},
    };
}

/// Build one clip as an owned motion document. Keys cover every clip channel
/// (identity deltas where the clip never drives a role — full-body ownership,
/// the exact semantics clips have today) plus root translation.
pub fn clipDocument(allocator: std.mem.Allocator, clip: clips.ClipId) Error!motion.Document {
    const info = clips.clipInfo(clip);
    const times = keyTimes(clip);

    const name = try allocator.dupe(u8, @tagName(clip));
    errdefer allocator.free(name);

    const channel_ids = try allocator.alloc([]const u8, clips.CHANNEL_IDS.len);
    errdefer allocator.free(channel_ids);
    var channels_owned: usize = 0;
    errdefer for (channel_ids[0..channels_owned]) |id| allocator.free(id);
    for (clips.CHANNEL_IDS, channel_ids) |source_id, *id| {
        id.* = try allocator.dupe(u8, source_id);
        channels_owned += 1;
    }

    const keys = try allocator.alloc(motion.Key, times.len);
    errdefer allocator.free(keys);
    var keys_owned: usize = 0;
    errdefer for (keys[0..keys_owned]) |key| allocator.free(key.deltas);
    for (times, keys) |time_seconds, *key| {
        const sampled = try clips.sampleChannels(clip, time_seconds);
        const deltas = try allocator.dupe(motion.Quat, &sampled.deltas);
        key.* = .{
            .time_seconds = time_seconds,
            .coverage = FULL_COVERAGE,
            .easing = .slerp,
            .root_translation = sampled.root_translation,
            .deltas = deltas,
        };
        keys_owned += 1;
    }

    const runs = try allocator.alloc(motion.Run, 0);
    errdefer allocator.free(runs);
    const document = motion.Document{
        .allocator = allocator,
        .name = name,
        .looping = info.looping,
        .duration_seconds = info.duration_seconds,
        .source = .clip_migration,
        .channel_ids = channel_ids,
        .keys = keys,
        .runs = runs,
    };
    try motion.validate(&document);
    return document;
}
