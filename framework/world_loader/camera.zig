//! Third-person and externally-driven camera solving.
//!
//! Camera math consumes player/collider state and mutates only the camera node/state pair.

const std = @import("std");
const layout = @import("../layout.zig");
const game_physics = @import("../game/physics.zig");
const config = @import("config.zig");
const state = @import("state.zig");
const physics = @import("physics.zig");
const Node = layout.Node;
const CAMERA_DISTANCE_METERS = config.CAMERA_DISTANCE_METERS;
const CAMERA_MIN_PITCH_DEGREES = config.CAMERA_MIN_PITCH_DEGREES;
const CAMERA_MAX_PITCH_DEGREES = config.CAMERA_MAX_PITCH_DEGREES;
const CAMERA_TARGET_HEIGHT_METERS = config.CAMERA_TARGET_HEIGHT_METERS;
const CAMERA_FOV_DEGREES = config.CAMERA_FOV_DEGREES;
const CAMERA_SMOOTHING_PER_SECOND = config.CAMERA_SMOOTHING_PER_SECOND;
const AIM_SHOULDER_SHIFT_METERS = config.AIM_SHOULDER_SHIFT_METERS;
const AIM_PIVOT_HEIGHT_METERS = config.AIM_PIVOT_HEIGHT_METERS;
const AIM_CROUCH_DROP_METERS = config.AIM_CROUCH_DROP_METERS;
const AIM_DISTANCE_METERS = config.AIM_DISTANCE_METERS;
const AIM_LOOK_AHEAD_METERS = config.AIM_LOOK_AHEAD_METERS;
const AIM_MIN_PITCH_DEGREES = config.AIM_MIN_PITCH_DEGREES;
const AIM_MAX_PITCH_DEGREES = config.AIM_MAX_PITCH_DEGREES;
const AIM_FOV_DEGREES = config.AIM_FOV_DEGREES;
const CAMERA_SPRING_MIN_DISTANCE_METERS = config.CAMERA_SPRING_MIN_DISTANCE_METERS;
const CAMERA_SPRING_SKIN_METERS = config.CAMERA_SPRING_SKIN_METERS;
const CAMERA_SPRING_SWEEP_RADIUS_METERS = config.CAMERA_SPRING_SWEEP_RADIUS_METERS;
const Vec3 = state.Vec3;
const PlayerState = state.PlayerState;
const CameraState = state.CameraState;
const PhysicsColliders = state.PhysicsColliders;
const clamp = state.clamp;
const lerp = state.lerp;
const lerpVec3 = state.lerpVec3;

pub fn orbitEye(target: Vec3, yaw_degrees: f32, pitch_degrees: f32, distance: f32) Vec3 {
    const yaw = yaw_degrees * std.math.pi / 180.0;
    const elev = pitch_degrees * std.math.pi / 180.0;
    const horiz = distance * @cos(elev);
    const height = distance * @sin(elev);
    return .{
        .x = target.x - @sin(yaw) * horiz,
        .y = target.y + height,
        .z = target.z - @cos(yaw) * horiz,
    };
}

pub const CameraSolve = struct {
    pos: Vec3,
    target: Vec3,
    fov: f32,
    /// The player-side anchor the eye sits back from — the spring-arm casts
    /// pivot→pos against the walls and pulls the eye in to the wall's near side.
    pivot: Vec3,
};

pub const PitchLimits = struct {
    min: f32,
    max: f32,
};

pub fn solveAimCamera(player: PlayerState, yaw_degrees: f32, orbit_pitch_degrees: f32) CameraSolve {
    const yaw = yaw_degrees * std.math.pi / 180.0;
    const pitch = clamp(-orbit_pitch_degrees, AIM_MIN_PITCH_DEGREES, AIM_MAX_PITCH_DEGREES) * std.math.pi / 180.0;
    const cp = @cos(pitch);
    const fwd = Vec3{
        .x = @sin(yaw) * cp,
        .y = @sin(pitch),
        .z = @cos(yaw) * cp,
    };
    const pivot = Vec3{
        .x = player.x - @cos(yaw) * AIM_SHOULDER_SHIFT_METERS,
        .y = player.y + AIM_PIVOT_HEIGHT_METERS - 0 * AIM_CROUCH_DROP_METERS,
        .z = player.z + @sin(yaw) * AIM_SHOULDER_SHIFT_METERS,
    };
    return .{
        .pos = .{
            .x = pivot.x - fwd.x * AIM_DISTANCE_METERS,
            .y = pivot.y - fwd.y * AIM_DISTANCE_METERS,
            .z = pivot.z - fwd.z * AIM_DISTANCE_METERS,
        },
        .target = .{
            .x = pivot.x + fwd.x * AIM_LOOK_AHEAD_METERS,
            .y = pivot.y + fwd.y * AIM_LOOK_AHEAD_METERS,
            .z = pivot.z + fwd.z * AIM_LOOK_AHEAD_METERS,
        },
        .fov = AIM_FOV_DEGREES,
        .pivot = pivot,
    };
}

pub fn desiredCamera(cam: CameraState, player: PlayerState) CameraSolve {
    // External-camera (editor iso view): the JS-solved eye + look verbatim, no player
    // trailing, no aim mode.
    if (cam.external) {
        return .{
            .pos = cam.ext_pos,
            .target = cam.ext_look,
            .fov = cam.ext_fov,
            .pivot = cam.ext_look,
        };
    }
    if (cam.aiming) return solveAimCamera(player, cam.yaw_degrees, cam.pitch_degrees);
    const target = Vec3{ .x = player.x, .y = player.y + CAMERA_TARGET_HEIGHT_METERS, .z = player.z };
    return .{
        .pos = orbitEye(target, cam.yaw_degrees, cam.pitch_degrees, CAMERA_DISTANCE_METERS),
        .target = target,
        .fov = CAMERA_FOV_DEGREES,
        .pivot = target,
    };
}

/// Pull the desired eye in to the near side of any wall/roof between it and the
/// pivot (the compiled-game spring-arm — parity with the editor's JS one).
pub fn springArmEye(want: CameraSolve, maybe_colliders: ?PhysicsColliders) Vec3 {
    const dxp = want.pos.x - want.pivot.x;
    const dyp = want.pos.y - want.pivot.y;
    const dzp = want.pos.z - want.pivot.z;
    const base = @sqrt(dxp * dxp + dyp * dyp + dzp * dzp);
    if (base <= 0.0001) return want.pos;
    // The eye must clear BOTH the wall/roof boxes AND the terrain/ramp
    // heightfields (a separate collider type) — take the most restrictive cap.
    var cap: f32 = -1;
    if (maybe_colliders) |colliders| {
        if (colliders.rect_count != 0 or colliders.oriented_count != 0) {
            // cameraOcclusionStepColliders assumes rects at INPUT_HEADER_FLOATS
            // (no entity section) — skip past the body slots when present.
            const wall = game_physics.cameraOcclusionStepColliders(
                colliders.values[colliders.entity_capacity * game_physics.ENTITY_FLOATS ..],
                colliders.rect_count,
                colliders.oriented_count,
                want.pos.x,
                want.pos.y,
                want.pos.z,
                want.pivot.x,
                want.pivot.y,
                want.pivot.z,
                CAMERA_SPRING_SWEEP_RADIUS_METERS,
            );
            if (wall > 0) cap = wall;
        }
    }
    const terrain = game_physics.cameraOcclusionHeightfields(
        want.pos.x,
        want.pos.y,
        want.pos.z,
        want.pivot.x,
        want.pivot.y,
        want.pivot.z,
        CAMERA_SPRING_SWEEP_RADIUS_METERS,
    );
    if (terrain > 0 and (cap < 0 or terrain < cap)) cap = terrain;
    if (cap < 0) return want.pos;
    const safe = clamp(cap - CAMERA_SPRING_SKIN_METERS, CAMERA_SPRING_MIN_DISTANCE_METERS, base);
    const k = safe / base;
    return .{
        .x = want.pivot.x + dxp * k,
        .y = want.pivot.y + dyp * k,
        .z = want.pivot.z + dzp * k,
    };
}

pub fn updateCameraNode(camera_node: *Node, cam: *CameraState, player: PlayerState, colliders: ?PhysicsColliders, dt: f32) void {
    var want = desiredCamera(cam.*, player);
    // External-orbit (editor iso view): no spring-arm (the iso eye must stay at its
    // full authoring distance, never pulled in through a roof) and no smoothing (it
    // tracks the user's orbit/zoom drag frame-exact).
    if (cam.external) {
        cam.current_pos = want.pos;
        cam.current_target = want.target;
        cam.current_fov = want.fov;
        cam.initialized = true;
        camera_node.scene3d_pos_x = cam.current_pos.x;
        camera_node.scene3d_pos_y = cam.current_pos.y;
        camera_node.scene3d_pos_z = cam.current_pos.z;
        camera_node.scene3d_look_x = cam.current_target.x;
        camera_node.scene3d_look_y = cam.current_target.y;
        camera_node.scene3d_look_z = cam.current_target.z;
        camera_node.scene3d_fov = cam.current_fov;
        camera_node.scene3d_far = cam.far;
        return;
    }
    want.pos = springArmEye(want, colliders);
    if (!cam.initialized or dt <= 0 or CAMERA_SMOOTHING_PER_SECOND <= 0) {
        cam.current_pos = want.pos;
        cam.current_target = want.target;
        cam.current_fov = want.fov;
        cam.initialized = true;
    } else {
        const t = clamp(1.0 - @exp(-CAMERA_SMOOTHING_PER_SECOND * dt), 0, 1);
        cam.current_pos = lerpVec3(cam.current_pos, want.pos, t);
        cam.current_target = lerpVec3(cam.current_target, want.target, t);
        cam.current_fov = lerp(cam.current_fov, want.fov, t);
    }
    camera_node.scene3d_pos_x = cam.current_pos.x;
    camera_node.scene3d_pos_y = cam.current_pos.y;
    camera_node.scene3d_pos_z = cam.current_pos.z;
    camera_node.scene3d_look_x = cam.current_target.x;
    camera_node.scene3d_look_y = cam.current_target.y;
    camera_node.scene3d_look_z = cam.current_target.z;
    camera_node.scene3d_fov = cam.current_fov;
    camera_node.scene3d_far = cam.far;
}

pub fn aimPitchLimitsInOrbitSpace() PitchLimits {
    return .{ .min = -AIM_MAX_PITCH_DEGREES, .max = -AIM_MIN_PITCH_DEGREES };
}

pub fn setAimMode(cam: *CameraState, aiming: bool) void {
    if (cam.aiming == aiming) return;
    cam.aiming = aiming;
    if (!aiming) {
        cam.pitch_degrees = clamp(cam.pitch_degrees, CAMERA_MIN_PITCH_DEGREES, CAMERA_MAX_PITCH_DEGREES);
    }
}
