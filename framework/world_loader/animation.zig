//! Baked clip sampling and player/NPC scene-node posing.
//!
//! Animation transforms are sampled without owning clocks, models, or scene nodes.

const std = @import("std");
const layout = @import("../layout.zig");
const constructor = @import("../world/constructor.zig");
const config = @import("config.zig");
const state = @import("state.zig");
const Node = layout.Node;
const PLAYER_WALK_CYCLES_PER_SECOND = config.PLAYER_WALK_CYCLES_PER_SECOND;
const PLAYER_RUN_CYCLES_PER_SECOND = config.PLAYER_RUN_CYCLES_PER_SECOND;
const PLAYER_CLIP_IDLE = config.PLAYER_CLIP_IDLE;
const PLAYER_CLIP_WALK = config.PLAYER_CLIP_WALK;
const PLAYER_CLIP_JUMP = config.PLAYER_CLIP_JUMP;
const PLAYER_CLIP_SIT = config.PLAYER_CLIP_SIT;
const PLAYER_CLIP_LAY = config.PLAYER_CLIP_LAY;
const PlayerState = state.PlayerState;
const NpcRuntime = state.NpcRuntime;
const clamp = state.clamp;
const lerp = state.lerp;
const rotateYLocal = state.rotateYLocal;

pub fn findPlayerClip(animation: constructor.PlayerAnimationSet, clip_id: u32) ?constructor.PlayerAnimationClip {
    for (animation.clips) |clip| {
        if (clip.id == clip_id) return clip;
    }
    return null;
}

pub fn sampleClipTransform(clip: constructor.PlayerAnimationClip, node_index: usize, t_raw: f32) ?constructor.PlayerTransform {
    if (clip.keyframes.len == 0) return null;
    if (node_index >= clip.keyframes[0].transforms.len) return null;
    const duration = if (clip.duration > 0) clip.duration else 1.0;
    var t = t_raw;
    if (clip.looping) {
        t = @mod(t, duration);
        if (t < 0) t += duration;
    } else {
        t = clamp(t, 0, duration);
    }
    if (clip.keyframes.len == 1) return clip.keyframes[0].transforms[node_index];

    var prev = clip.keyframes[0];
    var next = clip.keyframes[clip.keyframes.len - 1];
    var i: usize = 1;
    while (i < clip.keyframes.len) : (i += 1) {
        if (t <= clip.keyframes[i].time) {
            next = clip.keyframes[i];
            break;
        }
        prev = clip.keyframes[i];
    }
    const span = @max(@as(f32, 0.000001), next.time - prev.time);
    const k = clamp((t - prev.time) / span, 0, 1);
    const a = prev.transforms[node_index];
    const b = next.transforms[node_index];
    return .{
        .position = .{ lerp(a.position[0], b.position[0], k), lerp(a.position[1], b.position[1], k), lerp(a.position[2], b.position[2], k) },
        .rotation = .{ lerp(a.rotation[0], b.rotation[0], k), lerp(a.rotation[1], b.rotation[1], k), lerp(a.rotation[2], b.rotation[2], k) },
        .scale = .{ lerp(a.scale[0], b.scale[0], k), lerp(a.scale[1], b.scale[1], k), lerp(a.scale[2], b.scale[2], k) },
    };
}

pub fn updatePlayerModelNodes(kids: []Node, first: usize, groups: []const constructor.PlayerModelGroup, animation: constructor.PlayerAnimationSet, player: PlayerState, moving: bool, running: bool, airborne: bool) void {
    const model_yaw_degrees = player.yaw * 180.0 / std.math.pi + 180.0;
    const clip_id: u32 = switch (player.posture) {
        .sit => PLAYER_CLIP_SIT,
        .lay => PLAYER_CLIP_LAY,
        .none => if (airborne) PLAYER_CLIP_JUMP else if (moving or running) PLAYER_CLIP_WALK else PLAYER_CLIP_IDLE,
    };
    const clip_time: f32 = if (clip_id == PLAYER_CLIP_WALK) player.gait_phase else if (clip_id == PLAYER_CLIP_JUMP) player.jump_time else 0;
    const clip = if (animation.node_count == groups.len) findPlayerClip(animation, clip_id) else null;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const base = groups[i];
        const base_transform = constructor.PlayerTransform{
            .position = base.position,
            .rotation = base.rotation,
            .scale = base.scale,
        };
        const t = if (clip) |cclip| sampleClipTransform(cclip, i, clip_time) orelse base_transform else base_transform;
        const local = rotateYLocal(t.position, model_yaw_degrees);
        const node = &kids[first + i];
        node.scene3d_pos_x = player.x + local.x;
        node.scene3d_pos_y = player.y + local.y;
        node.scene3d_pos_z = player.z + local.z;
        node.scene3d_rot_x = t.rotation[0];
        node.scene3d_rot_y = t.rotation[1] + model_yaw_degrees;
        node.scene3d_rot_z = t.rotation[2];
        node.scene3d_scale_x = t.scale[0];
        node.scene3d_scale_y = t.scale[1];
        node.scene3d_scale_z = t.scale[2];
    }
}

/// The LIVE-POSE twin (req_2786): identical node math, but the per-node
/// transforms come straight from the capture push instead of a clip — the
/// figure mirrors the camera. Transforms are model-local like clip keys.
pub fn updatePlayerModelNodesLive(kids: []Node, first: usize, groups: []const constructor.PlayerModelGroup, transforms: []const f32, player: PlayerState) void {
    const model_yaw_degrees = player.yaw * 180.0 / std.math.pi + 180.0;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const t = transforms[i * 9 ..][0..9];
        const local = rotateYLocal(.{ t[0], t[1], t[2] }, model_yaw_degrees);
        const node = &kids[first + i];
        node.scene3d_pos_x = player.x + local.x;
        node.scene3d_pos_y = player.y + local.y;
        node.scene3d_pos_z = player.z + local.z;
        node.scene3d_rot_x = t[3];
        node.scene3d_rot_y = t[4] + model_yaw_degrees;
        node.scene3d_rot_z = t[5];
        node.scene3d_scale_x = t[6];
        node.scene3d_scale_y = t[7];
        node.scene3d_scale_z = t[8];
    }
}

/// The NPC twin of updatePlayerModelNodes (req_0935): pose one NPC's child
/// nodes from its own transform + clip, reusing the SAME findPlayerClip /
/// sampleClipTransform / rotateYLocal the player figure uses (NPCs share the
/// PLAYER_ANIMATION clips). Stage 1 leaves clip = IDLE so figures stand.
pub fn updateNpcModelNodes(kids: []Node, npc: NpcRuntime, groups: []const constructor.PlayerModelGroup, animation: constructor.PlayerAnimationSet) void {
    const model_yaw_degrees = npc.yaw * 180.0 / std.math.pi + 180.0;
    const clip_time: f32 = if (npc.clip == PLAYER_CLIP_WALK) npc.gait_phase else 0;
    const clip = if (animation.node_count == groups.len) findPlayerClip(animation, npc.clip) else null;
    var i: usize = 0;
    while (i < groups.len) : (i += 1) {
        const base = groups[i];
        const base_transform = constructor.PlayerTransform{
            .position = base.position,
            .rotation = base.rotation,
            .scale = base.scale,
        };
        const t = if (clip) |cclip| sampleClipTransform(cclip, i, clip_time) orelse base_transform else base_transform;
        const local = rotateYLocal(t.position, model_yaw_degrees);
        const node = &kids[npc.first_child + i];
        node.scene3d_pos_x = npc.x + local.x;
        node.scene3d_pos_y = npc.y + local.y;
        node.scene3d_pos_z = npc.z + local.z;
        node.scene3d_rot_x = t.rotation[0];
        node.scene3d_rot_y = t.rotation[1] + model_yaw_degrees;
        node.scene3d_rot_z = t.rotation[2];
        node.scene3d_scale_x = t.scale[0];
        node.scene3d_scale_y = t.scale[1];
        node.scene3d_scale_z = t.scale[2];
    }
}

pub fn updatePlayerAnimationClock(player: *PlayerState, dt: f32, moving: bool, running: bool, airborne: bool) void {
    if (moving) {
        const cycles = if (running) PLAYER_RUN_CYCLES_PER_SECOND else PLAYER_WALK_CYCLES_PER_SECOND;
        player.gait_phase += dt * cycles;
        player.gait_phase = @mod(player.gait_phase, 1.0);
    }
    if (airborne) {
        player.jump_time += dt;
    } else {
        player.jump_time = 0;
    }
}
