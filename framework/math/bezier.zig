//! bezier.zig — Bezier curve evaluation (general, cubic, quadratic).
//!
//! Grep target: `bezierPoint`, `cubicBezier`, `quadraticBezier`.

const std = @import("std");
const vec2 = @import("vec2.zig");

const Vec2 = vec2.Vec2;

pub fn bezierPoint(points: []const Vec2, t: f32) Vec2 {
    const n = points.len;
    if (n == 0) return .{};
    if (n == 1) return points[0];

    // De Casteljau's algorithm using a stack buffer (max 32 control points).
    var work: [32]Vec2 = undefined;
    const count = @min(n, 32);
    for (0..count) |i| {
        work[i] = points[i];
    }
    var level: usize = count - 1;
    while (level >= 1) : (level -= 1) {
        for (0..level) |j| {
            work[j] = .{
                .x = work[j].x + (work[j + 1].x - work[j].x) * t,
                .y = work[j].y + (work[j + 1].y - work[j].y) * t,
            };
        }
    }
    return work[0];
}

pub fn bezierCurve(points: []const Vec2, segments: u32, out: []Vec2) u32 {
    if (points.len < 2) {
        if (points.len == 1 and out.len >= 1) {
            out[0] = points[0];
            return 1;
        }
        return 0;
    }
    const count = segments + 1;
    const write_count = @min(count, @as(u32, @intCast(out.len)));
    for (0..write_count) |i| {
        const t: f32 = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(segments));
        out[i] = bezierPoint(points, t);
    }
    return write_count;
}

pub fn cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: f32) Vec2 {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    return .{
        .x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
        .y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    };
}

pub fn cubicBezierDerivative(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: f32) Vec2 {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return .{
        .x = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
        .y = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
    };
}

pub fn quadraticBezier(p0: Vec2, p1: Vec2, p2: Vec2, t: f32) Vec2 {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return .{
        .x = mt2 * p0.x + 2 * mt * t * p1.x + t2 * p2.x,
        .y = mt2 * p0.y + 2 * mt * t * p1.y + t2 * p2.y,
    };
}

test "bezier point at endpoints" {
    const v2 = vec2.v2;
    const pts = [_]Vec2{ v2(0, 0), v2(1, 1) };
    const start = bezierPoint(&pts, 0);
    const end = bezierPoint(&pts, 1);
    try std.testing.expectEqual(@as(f32, 0), start.x);
    try std.testing.expectEqual(@as(f32, 1), end.x);
}
