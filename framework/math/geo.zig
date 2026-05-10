//! geo.zig — 2D geometry helpers (point/segment/rect/circle/line tests).
//!
//! Grep target: `distancePointToSegment`, `lineIntersection`, `circleIntersectsRect`.

const std = @import("std");
const utils = @import("utils.zig");
const vec2 = @import("vec2.zig");
const bbox = @import("bbox.zig");

const Vec2 = vec2.Vec2;
const BBox2 = bbox.BBox2;

pub fn distancePointToSegment(point: Vec2, a: Vec2, b: Vec2) f32 {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq == 0) {
        return utils.length2(point.x - a.x, point.y - a.y);
    }
    var t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
    t = utils.clamp01(t);
    return utils.length2(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

pub fn distancePointToRect(point: Vec2, rect: BBox2) f32 {
    const cx = @max(rect.min.x, @min(rect.max.x, point.x));
    const cy = @max(rect.min.y, @min(rect.max.y, point.y));
    return utils.length2(point.x - cx, point.y - cy);
}

pub fn circleContainsPoint(center: Vec2, radius: f32, point: Vec2) bool {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return dx * dx + dy * dy <= radius * radius;
}

pub fn circleIntersectsRect(center: Vec2, radius: f32, rect: BBox2) bool {
    return distancePointToRect(center, rect) <= radius;
}

pub fn lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2) ?Vec2 {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const cr = d1x * d2y - d1y * d2x;
    if (@abs(cr) < 1e-10) return null;
    const dx = b1.x - a1.x;
    const dy = b1.y - a1.y;
    const t = (dx * d2y - dy * d2x) / cr;
    const u = (dx * d1y - dy * d1x) / cr;
    if (t < 0 or t > 1 or u < 0 or u > 1) return null;
    return .{ .x = a1.x + t * d1x, .y = a1.y + t * d1y };
}
