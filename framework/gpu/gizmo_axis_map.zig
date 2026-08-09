//! The transform gizmo's axis→screen mapping: where an arm points, how many screen
//! pixels one world unit spans along it, and how far a dragged pixel is allowed to
//! move the selection.
//!
//! This lives apart from 3d.zig because it is the whole of the drag's arithmetic and
//! it has one pathological input the viewport hands it constantly: an axis pointing
//! (nearly) AT the camera. The orientation compass snaps the orbit to EXACTLY that —
//! `meshCompassSnap` sets yaw = ±π/2, pitch = 0 for a ±X view — and a front/side view
//! is where half of modeling happens. Down that axis a one-centimetre probe projects
//! to the SAME pixel as the pivot, so:
//!
//!   * the arm's screen direction is the direction of two cancelling f32 pixel
//!     coordinates — pure noise. It still drew at a fixed 48px, landing on top of the
//!     neighbouring arms and stealing their grabs.
//!   * px-per-unit collapses toward zero, and the move drag divides by it. At the old
//!     `len <= 1e-4` reject (a float-noise threshold, not a geometric one) a single
//!     pixel of mouse travel mapped to ~100 world units — the selection left the
//!     screen on a twitch, and whether it happened at all was a coin flip on the last
//!     bit of the projection (req_4160/4161: "it's every other ctrl").
//!
//! The cure is one named ratio. An axis must keep at least `min_axis_screen_fraction`
//! of the span it would have face-on before it counts as a handle at all; above that
//! the same ratio floors the px→world mapping, so the steepest legal arm still moves a
//! bounded amount per pixel. Rotate/scale never divide (their drags are a constant
//! px→angle / px→factor rate) and are untouched, as is `gizmoRingWorldR`'s deliberate
//! ring blow-up down a foreshortened axis (req_2827, PINNED as a feature).

const std = @import("std");
const model_paint = @import("model_paint.zig");

pub const Camera = model_paint.Camera;

/// A world direction at the pivot, expressed on screen: the projected anchor, the 2D
/// unit direction the arm is drawn along, and how many screen px one world unit spans
/// there. `px_per_unit` is the RAW geometry — foreshortening included — so drawing and
/// hit-testing see the true collapse; callers gate on `isGrabbable` and take their
/// drag rate from `worldPerPx` rather than dividing by this field themselves.
pub const AxisScreen = struct { ax: f32, ay: f32, dx: f32, dy: f32, px_per_unit: f32 };

/// The share of its face-on screen span an axis must keep to be a handle: below this
/// it is within ~2.9° of pointing at the camera, its drawn direction is float noise,
/// and its drag rate is unusable. Doubles as the floor on the px→world mapping, so no
/// legal drag can exceed 1/this the face-on rate.
pub const min_axis_screen_fraction: f32 = 0.05;

/// The probe length the screen span is measured over. Small enough that perspective
/// does not bend the arm, large enough to clear f32 cancellation in the projected
/// pixel coordinates.
const probe_m: f32 = 0.01;

fn sub(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn add(a: [3]f32, b: [3]f32) [3]f32 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}
fn scale(a: [3]f32, k: f32) [3]f32 {
    return .{ a[0] * k, a[1] * k, a[2] * k };
}
fn dot(a: [3]f32, b: [3]f32) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn norm(a: [3]f32) [3]f32 {
    const l = @sqrt(dot(a, a));
    return if (l > 0) scale(a, 1.0 / l) else a;
}

/// World units one pixel spans at `p` for a span lying IN the screen plane — the
/// mapping a drag would get from an axis with no foreshortening at all.
pub fn worldUnitsPerPixel(cam: Camera, vp_h: f32, p: [3]f32) f32 {
    const fwd = norm(sub(cam.target, cam.eye));
    const z = @max(0.001, dot(sub(p, cam.eye), fwd));
    const span = 2.0 * z * @tan(cam.fov_deg * std.math.pi / 180.0 * 0.5);
    return if (vp_h > 1) span / vp_h else 0.01;
}

/// The inverse: screen px one world unit spans at `p`, face-on. The reference every
/// axis is measured against.
pub fn faceOnPxPerUnit(cam: Camera, vp_h: f32, p: [3]f32) f32 {
    return 1.0 / @max(worldUnitsPerPixel(cam, vp_h, p), 1.0e-6);
}

/// A world direction at the pivot, in screen space. Null when the pivot or its probe
/// projects behind the camera, or when the axis vanishes into the screen entirely —
/// at which point the direction below would be the quotient of two cancelled floats.
pub fn axisScreen(cam: Camera, vp_w: f32, vp_h: f32, pivot: [3]f32, u: [3]f32) ?AxisScreen {
    const a = model_paint.project(cam, vp_w, vp_h, pivot) orelse return null;
    const b = model_paint.project(cam, vp_w, vp_h, add(pivot, scale(u, probe_m))) orelse return null;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len = @sqrt(vx * vx + vy * vy);
    if (len <= 1e-4) return null;
    return .{ .ax = a[0], .ay = a[1], .dx = vx / len, .dy = vy / len, .px_per_unit = len / probe_m };
}

/// Whether this axis may be drawn as an arm, grabbed, and dragged. An axis that fails
/// is pointing at the camera: it has no honest screen direction to draw along and no
/// honest rate to drag at, so it is furniture-free — the two axes that remain are the
/// two the view can actually express.
pub fn isGrabbable(s: AxisScreen, face_on_px_per_unit: f32) bool {
    return s.px_per_unit >= face_on_px_per_unit * min_axis_screen_fraction;
}

/// World units one pixel of drag travels ALONG this axis. Floored at the same ratio
/// `isGrabbable` gates on, so even a caller that skipped the gate (an agent-seat drag,
/// a replayed gesture) gets a bounded mapping instead of a teleport.
pub fn worldPerPx(s: AxisScreen, face_on_px_per_unit: f32) f32 {
    return 1.0 / @max(s.px_per_unit, face_on_px_per_unit * min_axis_screen_fraction);
}
