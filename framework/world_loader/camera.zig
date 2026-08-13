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
const CHARACTER_DIAGNOSTIC_CAMERA_PADDING_RATIO = config.CHARACTER_DIAGNOSTIC_CAMERA_PADDING_RATIO;
const CHARACTER_DIAGNOSTIC_CAMERA_MIN_ASPECT = config.CHARACTER_DIAGNOSTIC_CAMERA_MIN_ASPECT;
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

/// Give the capture target its own measured native camera (USER ASK req_4254).
///
/// Character nodes face 180 degrees in the runtime, so local X/Z bounds are
/// mirrored into world space. The two copies are separated on world X. This
/// solves one front-on pose that contains their complete union at the pane's
/// actual aspect ratio; no gameplay player/collider state participates.
pub fn frameCharacterDiagnostic(
    cam: *CameraState,
    bounds_min: [3]f32,
    bounds_max: [3]f32,
    separation_x: f32,
    aspect: f32,
) bool {
    for (bounds_min) |component| {
        if (!std.math.isFinite(component)) return false;
    }
    for (bounds_max) |component| {
        if (!std.math.isFinite(component)) return false;
    }
    if (!std.math.isFinite(separation_x) or separation_x < 0) return false;
    for (0..3) |axis| {
        if (bounds_max[axis] < bounds_min[axis]) return false;
    }

    const safe_aspect = if (std.math.isFinite(aspect) and aspect > 0)
        @max(aspect, CHARACTER_DIAGNOSTIC_CAMERA_MIN_ASPECT)
    else
        CHARACTER_DIAGNOSTIC_CAMERA_MIN_ASPECT;
    const half_vertical_fov = CAMERA_FOV_DEGREES * std.math.pi / 360.0;
    const tan_half_vertical_fov = @tan(half_vertical_fov);
    if (!std.math.isFinite(tan_half_vertical_fov) or tan_half_vertical_fov <= 0) return false;

    const half_width = (bounds_max[0] - bounds_min[0] + separation_x) * 0.5;
    const half_height = (bounds_max[1] - bounds_min[1]) * 0.5;
    const half_depth = (bounds_max[2] - bounds_min[2]) * 0.5;
    const vertical_distance = half_height / tan_half_vertical_fov;
    const horizontal_distance = half_width / (tan_half_vertical_fov * safe_aspect);
    const distance = @max(vertical_distance, horizontal_distance) *
        CHARACTER_DIAGNOSTIC_CAMERA_PADDING_RATIO + half_depth;
    if (!std.math.isFinite(distance) or distance <= 0) return false;

    // Rotation Y=180 maps local (x,z) to (-x,-z).
    const target = Vec3{
        .x = -(bounds_min[0] + bounds_max[0]) * 0.5,
        .y = (bounds_min[1] + bounds_max[1]) * 0.5,
        .z = -(bounds_min[2] + bounds_max[2]) * 0.5,
    };
    cam.external = true;
    cam.ext_pos = .{ .x = target.x, .y = target.y, .z = target.z - distance };
    cam.ext_look = target;
    cam.ext_fov = CAMERA_FOV_DEGREES;
    cam.initialized = false;
    return true;
}

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

/// One collider set's spring-arm cap: the farthest pivot→eye distance still
/// clear of every camera-blocking band in the set (0 = clear).
fn stepColliderCap(colliders: PhysicsColliders, want: CameraSolve) f32 {
    if (colliders.rect_count == 0 and colliders.oriented_count == 0) return 0;
    // cameraOcclusionStepColliders assumes rects at INPUT_HEADER_FLOATS
    // (no entity section) — skip past the body slots when present.
    return game_physics.cameraOcclusionStepColliders(
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
}

/// Pull the desired eye in to the near side of any wall, roof, or elevated floor
/// between it and the pivot (the compiled-game spring-arm — parity with the
/// editor's JS one). TWO collider sets participate (req_4292): the dedicated
/// full-authored camera buffer (walls the physics windowing may drop), and the
/// live physics set — the ONLY carrier of mesh-prop coarse boxes (baked and
/// live-pushed placements), live pieces, door panels, and elevator cars. A
/// spring-arm reading just the authored buffer sailed straight through every
/// placed prop's walls. When both names resolve to the same buffer (pre-lump
/// bakes fall back to the physics set) the duplicate scan is skipped.
pub fn springArmEye(want: CameraSolve, maybe_walls: ?PhysicsColliders, maybe_props: ?PhysicsColliders) Vec3 {
    const dxp = want.pos.x - want.pivot.x;
    const dyp = want.pos.y - want.pivot.y;
    const dzp = want.pos.z - want.pivot.z;
    const base = @sqrt(dxp * dxp + dyp * dyp + dzp * dzp);
    if (base <= 0.0001) return want.pos;
    // The eye must clear authored collider bands, placed-prop bands, AND the
    // terrain/ramp heightfields — take the most restrictive cap.
    var cap: f32 = -1;
    if (maybe_walls) |walls| {
        const geometry = stepColliderCap(walls, want);
        if (geometry > 0) cap = geometry;
    }
    if (maybe_props) |props| {
        const duplicate = if (maybe_walls) |walls| walls.values.ptr == props.values.ptr else false;
        if (!duplicate) {
            const geometry = stepColliderCap(props, want);
            if (geometry > 0 and (cap < 0 or geometry < cap)) cap = geometry;
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

/// The draw distance the AUTHORING (external iso) camera needs, req_4167.
///
/// `cam.far` is solved once at load from the world's instance extent. That is the
/// right plane for the player-trailing game camera — it stands on the ground and
/// its distance never changes — and the wrong one for the editor camera, which
/// orbits from 9 m (detail a wall) out to 750 m (survey a district). Zoomed past
/// the stale plane, the world clipped away to bare sky; short of it, the fog band
/// anchored at 0.7×far washed the building out before the clip did.
///
/// Solve it from the pose being drawn instead: the eye's real distance to its
/// look point, plus the world radius so geometry BEHIND that point still draws,
/// plus a margin. Never shorter than the baked plane.
pub fn authoringFar(cam: CameraState) f32 {
    const dx = cam.ext_pos.x - cam.ext_look.x;
    const dy = cam.ext_pos.y - cam.ext_look.y;
    const dz = cam.ext_pos.z - cam.ext_look.z;
    const eye_distance = @sqrt(dx * dx + dy * dy + dz * dz);
    return @max(cam.far, eye_distance + cam.world_radius + config.AUTHOR_FAR_MARGIN_METERS);
}

/// Draw distance for whichever camera currently owns the view.
pub fn drawFar(cam: CameraState) f32 {
    return if (cam.external) authoringFar(cam) else cam.far;
}

/// Point the world should be resident around: the editor camera's look target
/// while it drives the view, else the player. Streaming residency followed the
/// player unconditionally, so an editor camera panned away from spawn surveyed
/// a district whose detail rows were still parked where the avatar stood.
pub fn residencyAnchor(cam: CameraState, player: PlayerState) Vec3 {
    if (cam.external) return cam.ext_look;
    return .{ .x = player.x, .y = player.y, .z = player.z };
}

/// Fog planes for the scene's fog child. The authoring view is unfogged (see
/// AUTHOR_FOG_*); the game view leaves both planes at 0 so scene3d keeps its
/// own far-anchored fade.
pub fn updateFogNode(fog_node: *Node, cam: CameraState) void {
    fog_node.scene3d_fog = true;
    fog_node.scene3d_fog_near = if (cam.external) config.AUTHOR_FOG_NEAR_METERS else 0;
    fog_node.scene3d_fog_far = if (cam.external) config.AUTHOR_FOG_FAR_METERS else 0;
}

pub fn updateCameraNode(camera_node: *Node, cam: *CameraState, player: PlayerState, colliders: ?PhysicsColliders, prop_colliders: ?PhysicsColliders, dt: f32) void {
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
        camera_node.scene3d_far = authoringFar(cam.*);
        return;
    }
    want.pos = springArmEye(want, colliders, prop_colliders);
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
