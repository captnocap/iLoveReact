//! The gizmo's axis→screen mapping, and the one input that used to break it: an axis
//! aimed straight at the camera. `meshCompassSnap` produces that view EXACTLY (yaw
//! ±π/2, pitch 0 for a ±X view), and in it the old mapping divided a drag by a span
//! that had collapsed into float noise — one pixel of mouse travel threw the selection
//! ~100 world units off the screen, intermittently, depending on the last bit of the
//! projection (req_4160/4161).

const std = @import("std");
const gizmo_axis_map = @import("gizmo_axis_map");

const VP_W: f32 = 1540;
const VP_H: f32 = 940;
const PIVOT: [3]f32 = .{ 0, 0, 0 };
const X_AXIS: [3]f32 = .{ 1, 0, 0 };
const Y_AXIS: [3]f32 = .{ 0, 1, 0 };
const Z_AXIS: [3]f32 = .{ 0, 0, 1 };

/// The camera the orientation compass installs for a +X view: on the X axis, looking
/// down it at the origin. The X arm is exactly edge-on here.
fn compassSnappedToX() gizmo_axis_map.Camera {
    return .{ .eye = .{ 3, 0, 0 }, .target = PIVOT, .fov_deg = 50 };
}

/// A generic three-quarter view — every axis has a real screen span.
fn threeQuarter() gizmo_axis_map.Camera {
    return .{ .eye = .{ 2.2, 1.6, 2.9 }, .target = PIVOT, .fov_deg = 50 };
}

test "a face-on axis drags at the plain screen rate" {
    const cam = threeQuarter();
    const face_on = gizmo_axis_map.faceOnPxPerUnit(cam, VP_H, PIVOT);
    // Y is nearly in the screen plane from this eye: its span should be a large share
    // of face-on, and its drag rate close to the unforeshortened one.
    const s = gizmo_axis_map.axisScreen(cam, VP_W, VP_H, PIVOT, Y_AXIS).?;
    try std.testing.expect(gizmo_axis_map.isGrabbable(s, face_on));
    try std.testing.expect(s.px_per_unit > face_on * 0.5);
    const wpp = gizmo_axis_map.worldPerPx(s, face_on);
    try std.testing.expectApproxEqRel(1.0 / s.px_per_unit, wpp, 1e-3);
}

test "an axis aimed at the camera is not a handle" {
    const cam = compassSnappedToX();
    const face_on = gizmo_axis_map.faceOnPxPerUnit(cam, VP_H, PIVOT);
    // The other two axes stay perfectly usable — the view can express them.
    const y = gizmo_axis_map.axisScreen(cam, VP_W, VP_H, PIVOT, Y_AXIS).?;
    const z = gizmo_axis_map.axisScreen(cam, VP_W, VP_H, PIVOT, Z_AXIS).?;
    try std.testing.expect(gizmo_axis_map.isGrabbable(y, face_on));
    try std.testing.expect(gizmo_axis_map.isGrabbable(z, face_on));
    // X either vanishes outright or fails the gate. Either way it draws no arm and
    // takes no grab, so it can never be the axis a drag lands on.
    if (gizmo_axis_map.axisScreen(cam, VP_W, VP_H, PIVOT, X_AXIS)) |x| {
        try std.testing.expect(!gizmo_axis_map.isGrabbable(x, face_on));
    }
}

test "no drag rate exceeds the bound, however edge-on the axis" {
    const cam = compassSnappedToX();
    const face_on = gizmo_axis_map.faceOnPxPerUnit(cam, VP_H, PIVOT);
    const ceiling = 1.0 / (face_on * gizmo_axis_map.min_axis_screen_fraction);
    // Sweep from face-on all the way into the degenerate view direction. Before the
    // fix the last few of these returned world-per-px in the tens or hundreds.
    var i: u32 = 0;
    while (i <= 2000) : (i += 1) {
        const t = @as(f32, @floatFromInt(i)) / 2000.0;
        const angle = t * std.math.pi * 0.5; // 0 = screen-parallel Z, π/2 = down X
        const axis: [3]f32 = .{ @sin(angle), 0, @cos(angle) };
        const s = gizmo_axis_map.axisScreen(cam, VP_W, VP_H, PIVOT, axis) orelse continue;
        const wpp = gizmo_axis_map.worldPerPx(s, face_on);
        try std.testing.expect(wpp > 0);
        try std.testing.expect(wpp <= ceiling);
    }
}

test "a one-pixel twitch stays a modeling nudge, not a launch" {
    const cam = compassSnappedToX();
    const face_on = gizmo_axis_map.faceOnPxPerUnit(cam, VP_H, PIVOT);
    // The whole model in view is a couple of metres across; one pixel must never move
    // a vertex further than that, at any axis orientation.
    const model_span_m: f32 = 2.0;
    var i: u32 = 0;
    while (i <= 2000) : (i += 1) {
        const t = @as(f32, @floatFromInt(i)) / 2000.0;
        const angle = t * std.math.pi * 0.5;
        const axis: [3]f32 = .{ @sin(angle), 0, @cos(angle) };
        const s = gizmo_axis_map.axisScreen(cam, VP_W, VP_H, PIVOT, axis) orelse continue;
        if (!gizmo_axis_map.isGrabbable(s, face_on)) continue; // ungrabbable: never dragged
        try std.testing.expect(gizmo_axis_map.worldPerPx(s, face_on) < model_span_m);
    }
}

test "the bound tracks zoom instead of a fixed pixel count" {
    // Same geometry, camera pulled back 10×: the face-on rate drops with distance and
    // the ceiling must follow it, or the gate would reject usable arms when zoomed out
    // and pass launch-grade ones when zoomed in.
    const near: gizmo_axis_map.Camera = .{ .eye = .{ 0.4, 0.3, 0.5 }, .target = PIVOT, .fov_deg = 50 };
    const far: gizmo_axis_map.Camera = .{ .eye = .{ 4.0, 3.0, 5.0 }, .target = PIVOT, .fov_deg = 50 };
    const near_face_on = gizmo_axis_map.faceOnPxPerUnit(near, VP_H, PIVOT);
    const far_face_on = gizmo_axis_map.faceOnPxPerUnit(far, VP_H, PIVOT);
    try std.testing.expectApproxEqRel(@as(f32, 10.0), near_face_on / far_face_on, 1e-3);

    const near_y = gizmo_axis_map.axisScreen(near, VP_W, VP_H, PIVOT, Y_AXIS).?;
    const far_y = gizmo_axis_map.axisScreen(far, VP_W, VP_H, PIVOT, Y_AXIS).?;
    try std.testing.expect(gizmo_axis_map.isGrabbable(near_y, near_face_on));
    try std.testing.expect(gizmo_axis_map.isGrabbable(far_y, far_face_on));
    // Pulled back, a pixel is worth more world — that is the honest mapping, kept.
    try std.testing.expect(
        gizmo_axis_map.worldPerPx(far_y, far_face_on) > gizmo_axis_map.worldPerPx(near_y, near_face_on),
    );
}

