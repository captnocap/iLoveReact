//! Saved-character scene-node placement and animation clocks.

const std = @import("std");
const layout = @import("../layout.zig");
const config = @import("config.zig");
const state = @import("state.zig");
const Node = layout.Node;
const PLAYER_WALK_CYCLES_PER_SECOND = config.PLAYER_WALK_CYCLES_PER_SECOND;
const PLAYER_RUN_CYCLES_PER_SECOND = config.PLAYER_RUN_CYCLES_PER_SECOND;
const PlayerState = state.PlayerState;

pub const SpecimenNodeError = error{
    NodeUnavailable,
    AliasedSpecimenNodes,
};

pub const SkinnedSpecimenView = struct {
    geometry_key: []const u8,
    vertices: []const f32,
    vertex_count: u32,
    palette: []const f32,
    bone_count: u32,
};

pub const StaticSpecimenView = struct {
    geometry_key: []const u8,
    vertices: []const f32,
    vertex_count: u32,
};

fn validateSpecimenNodes(kids: []const Node, deformed_child: usize, bind_child: usize) SpecimenNodeError!void {
    if (deformed_child >= kids.len or bind_child >= kids.len) return error.NodeUnavailable;
    if (deformed_child == bind_child) return error.AliasedSpecimenNodes;
}

fn skinnedNode(view: SkinnedSpecimenView) Node {
    return .{
        .scene3d_skin_geom_key = view.geometry_key,
        .scene3d_skin_vertices = view.vertices,
        .scene3d_skin_vert_count = view.vertex_count,
        .scene3d_skin_palette = view.palette,
        .scene3d_skin_bone_count = view.bone_count,
        .scene3d_color_r = 1,
        .scene3d_color_g = 1,
        .scene3d_color_b = 1,
        .scene3d_color_a = 1,
    };
}

fn staticNode(view: StaticSpecimenView) Node {
    return .{
        .scene3d_mesh = true,
        .scene3d_geom_key = view.geometry_key,
        .scene3d_vertices = view.vertices,
        .scene3d_vert_count = view.vertex_count,
        .scene3d_color_r = 1,
        .scene3d_color_g = 1,
        .scene3d_color_b = 1,
        .scene3d_color_a = 1,
    };
}

/// Normal `/play` owns one centered deformed player. The second reserved node
/// remains empty until an explicit capture target activation.
pub fn configureSinglePlayerCharacter(
    kids: []Node,
    deformed_child: usize,
    skinned: SkinnedSpecimenView,
) SpecimenNodeError!void {
    if (deformed_child >= kids.len) return error.NodeUnavailable;
    kids[deformed_child] = skinnedNode(skinned);
}

/// Replace both reserved character nodes as one non-fallible-after-validation
/// operation. The bind specimen is deliberately an ordinary stride-8 mesh and
/// receives no skin palette, joints, or weights.
pub fn configurePlayerCharacterSpecimens(
    kids: []Node,
    deformed_child: usize,
    bind_child: usize,
    skinned: SkinnedSpecimenView,
    bind: StaticSpecimenView,
) SpecimenNodeError!void {
    try validateSpecimenNodes(kids, deformed_child, bind_child);

    kids[deformed_child] = skinnedNode(skinned);
    kids[bind_child] = staticNode(bind);
}

/// Clear both borrowed node views before either owned artifact is released.
pub fn disablePlayerCharacterSpecimens(kids: []Node, deformed_child: usize, bind_child: usize) bool {
    validateSpecimenNodes(kids, deformed_child, bind_child) catch return false;
    kids[deformed_child] = .{};
    kids[bind_child] = .{};
    return true;
}

fn placeSpecimenNode(node: *Node, player: PlayerState, x_offset: f32, facing_yaw_degrees: f32) void {
    node.scene3d_pos_x = player.x + x_offset;
    node.scene3d_pos_y = player.y;
    node.scene3d_pos_z = player.z;
    node.scene3d_rot_x = 0;
    // +180 is the canonical convention (the authored rig faces -Z); the
    // asset's own solved facing offset rides on top so any rig stands the
    // way the world expects (req_4291 — the skeleton owns facing).
    node.scene3d_rot_y = player.yaw * 180.0 / std.math.pi + 180.0 + facing_yaw_degrees;
    node.scene3d_rot_z = 0;
    node.scene3d_scale_x = 1;
    node.scene3d_scale_y = 1;
    node.scene3d_scale_z = 1;
}

pub fn placeSinglePlayerCharacter(kids: []Node, deformed_child: usize, player: PlayerState, facing_yaw_degrees: f32) void {
    if (deformed_child >= kids.len) return;
    placeSpecimenNode(&kids[deformed_child], player, 0, facing_yaw_degrees);
}

/// Capture diagnostics are stage specimens, not the simulated blank-world
/// player. Keeping this anchor explicit prevents gravity, spawn placement, or
/// input from carrying the bind/deformed pair out of its measured camera.
pub fn characterDiagnosticAnchor() PlayerState {
    return .{ .x = 0, .y = 0, .z = 0, .yaw = 0 };
}

/// Place intact bind on the left and current deformation on the right around
/// the player's unchanged camera/physics midpoint. This performs arithmetic
/// only; the owned static vertex copy is never rebuilt per frame.
pub fn placePlayerCharacterSpecimens(
    kids: []Node,
    deformed_child: usize,
    bind_child: usize,
    player: PlayerState,
    separation_x: f32,
    facing_yaw_degrees: f32,
) void {
    validateSpecimenNodes(kids, deformed_child, bind_child) catch return;
    if (!std.math.isFinite(separation_x) or separation_x < 0) return;
    const half_separation = separation_x * 0.5;
    if (!std.math.isFinite(half_separation) or
        !std.math.isFinite(player.x - half_separation) or
        !std.math.isFinite(player.x + half_separation)) return;

    placeSpecimenNode(&kids[bind_child], player, -half_separation, facing_yaw_degrees);
    placeSpecimenNode(&kids[deformed_child], player, half_separation, facing_yaw_degrees);
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
