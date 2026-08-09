//! Authoring draw distance (req_4167).
//!
//! The editor's iso camera orbits from ~9 m (detail a wall) out to ~750 m
//! (survey a district), while `CameraState.far` is solved ONCE at load from the
//! world's instance extent. Driving the view off that stale plane hard-clipped
//! the world to bare sky at full zoom-out, and its 0.7× fog band washed out what
//! survived — the selection outline hung in the air over a building nobody could
//! see. These tests pin the plane to the pose that is actually drawn.

const std = @import("std");
const camera = @import("../../world_loader/camera.zig");
const loader_state = @import("../../world_loader/state.zig");
const config = @import("../../world_loader/config.zig");
const layout = @import("../../layout.zig");

const MARGIN = config.AUTHOR_FAR_MARGIN_METERS;

fn authoringCamera(eye_distance: f32, world_radius: f32, baked_far: f32) loader_state.CameraState {
    return .{
        .yaw_degrees = 45,
        .pitch_degrees = 35.264,
        .far = baked_far,
        .external = true,
        .ext_pos = .{ .x = 0, .y = eye_distance, .z = 0 },
        .ext_look = .{ .x = 0, .y = 0, .z = 0 },
        .world_radius = world_radius,
    };
}

test "authoring far reaches past the eye's own orbit distance" {
    // The failing case: zoomed out to a district survey (BASE_DIST 90 / MIN_ZOOM
    // 0.12 = 750 m) against a small map whose baked plane is a few hundred metres.
    const cam = authoringCamera(750, 40, 300);
    const far = camera.authoringFar(cam);
    try std.testing.expect(far > 750);
    try std.testing.expectApproxEqAbs(@as(f32, 750 + 40 + MARGIN), far, 0.001);
}

test "authoring far covers the world BEHIND the look point" {
    // Two cameras at the same orbit distance over worlds of different extent:
    // the wider world must draw further, or its far half clips at the horizon.
    const near_world = camera.authoringFar(authoringCamera(300, 20, 0));
    const wide_world = camera.authoringFar(authoringCamera(300, 900, 0));
    try std.testing.expect(wide_world - near_world > 800);
}

test "authoring far never shortens the baked plane" {
    // A huge baked world seen from a close-in wall-detail orbit keeps its own
    // plane — the authoring solve only ever extends.
    const cam = authoringCamera(9, 0, 4000);
    try std.testing.expectApproxEqAbs(@as(f32, 4000), camera.authoringFar(cam), 0.001);
}

test "drawFar leaves the game camera on its baked plane" {
    var cam = authoringCamera(750, 40, 300);
    cam.external = false;
    try std.testing.expectApproxEqAbs(@as(f32, 300), camera.drawFar(cam), 0.001);
    cam.external = true;
    try std.testing.expect(camera.drawFar(cam) > 300);
}

test "residency follows the view owner, not the avatar" {
    const player: loader_state.PlayerState = .{ .x = 5, .y = 0, .z = -7, .yaw = 0 };
    var cam = authoringCamera(300, 40, 300);
    cam.ext_look = .{ .x = 420, .y = 3, .z = -180 };

    // Editor camera panned across the map: the detail bubble belongs where it
    // LOOKS, not at the spawn the avatar is still standing on.
    const authoring = camera.residencyAnchor(cam, player);
    try std.testing.expectApproxEqAbs(@as(f32, 420), authoring.x, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, -180), authoring.z, 0.001);

    cam.external = false;
    const embodied = camera.residencyAnchor(cam, player);
    try std.testing.expectApproxEqAbs(@as(f32, 5), embodied.x, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, -7), embodied.z, 0.001);
}

test "fog child unfogs the authoring view and leaves the game view auto" {
    var node: layout.Node = .{};
    var cam = authoringCamera(300, 40, 300);

    camera.updateFogNode(&node, cam);
    try std.testing.expect(node.scene3d_fog);
    // Both planes past any authoring far plane, so the smoothstep never reaches
    // geometry and materials read at true value while you place them.
    try std.testing.expect(node.scene3d_fog_near > camera.authoringFar(cam));
    try std.testing.expect(node.scene3d_fog_far > node.scene3d_fog_near);

    cam.external = false;
    camera.updateFogNode(&node, cam);
    // 0 on both planes = "keep auto": scene3d's own far-anchored fade, unchanged.
    try std.testing.expectEqual(@as(f32, 0), node.scene3d_fog_near);
    try std.testing.expectEqual(@as(f32, 0), node.scene3d_fog_far);
}

test "the whole iso zoom range stays inside its own draw distance" {
    // isoStage.ts: dist = BASE_DIST(90) / zoom, zoom in [0.12, 10].
    const distances = [_]f32{ 9, 22.5, 90, 300, 750 };
    for (distances) |d| {
        const cam = authoringCamera(d, 120, 260);
        const far = camera.authoringFar(cam);
        // Everything from the eye to the far side of the world is inside the plane.
        try std.testing.expect(far >= d + 120);
    }
}
