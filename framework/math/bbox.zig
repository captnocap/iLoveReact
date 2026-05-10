//! bbox.zig — Axis-aligned bounding boxes (2D and 3D).
//!
//! Grep target: `BBox2`, `BBox3`, `bbox2contains*`, etc.
//!
//! BBox is a min/max representation. For x/y/w/h rect tests use
//! `utils.pointInRectXYWH` instead — different convention, different file.

const std = @import("std");
const vec2 = @import("vec2.zig");
const vec3 = @import("vec3.zig");

const Vec2 = vec2.Vec2;
const Vec3 = vec3.Vec3;

pub const BBox2 = struct {
    min: Vec2 = .{},
    max: Vec2 = .{},
};

pub const BBox3 = struct {
    min: Vec3 = .{},
    max: Vec3 = .{},
};

pub fn bbox2(min_x: f32, min_y: f32, max_x: f32, max_y: f32) BBox2 {
    return .{
        .min = .{ .x = min_x, .y = min_y },
        .max = .{ .x = max_x, .y = max_y },
    };
}

pub fn bbox2width(b: BBox2) f32 {
    return b.max.x - b.min.x;
}

pub fn bbox2height(b: BBox2) f32 {
    return b.max.y - b.min.y;
}

pub fn bbox2center(b: BBox2) Vec2 {
    return .{
        .x = (b.min.x + b.max.x) / 2.0,
        .y = (b.min.y + b.max.y) / 2.0,
    };
}

pub fn bbox2containsPoint(b: BBox2, pt: Vec2) bool {
    return pt.x >= b.min.x and pt.x <= b.max.x and pt.y >= b.min.y and pt.y <= b.max.y;
}

pub fn bbox2containsBBox(outer: BBox2, inner: BBox2) bool {
    return inner.min.x >= outer.min.x and inner.max.x <= outer.max.x and
        inner.min.y >= outer.min.y and inner.max.y <= outer.max.y;
}

pub fn bbox2intersects(a: BBox2, b: BBox2) bool {
    return a.min.x <= b.max.x and a.max.x >= b.min.x and
        a.min.y <= b.max.y and a.max.y >= b.min.y;
}

pub fn bbox2intersection(a: BBox2, b: BBox2) ?BBox2 {
    const mnx = @max(a.min.x, b.min.x);
    const mny = @max(a.min.y, b.min.y);
    const mxx = @min(a.max.x, b.max.x);
    const mxy = @min(a.max.y, b.max.y);
    if (mnx > mxx or mny > mxy) return null;
    return .{
        .min = .{ .x = mnx, .y = mny },
        .max = .{ .x = mxx, .y = mxy },
    };
}

pub fn bbox2union(a: BBox2, b: BBox2) BBox2 {
    return .{
        .min = .{ .x = @min(a.min.x, b.min.x), .y = @min(a.min.y, b.min.y) },
        .max = .{ .x = @max(a.max.x, b.max.x), .y = @max(a.max.y, b.max.y) },
    };
}

pub fn bbox2expand(b: BBox2, amount: f32) BBox2 {
    return .{
        .min = .{ .x = b.min.x - amount, .y = b.min.y - amount },
        .max = .{ .x = b.max.x + amount, .y = b.max.y + amount },
    };
}

pub fn bbox3(min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32) BBox3 {
    return .{
        .min = .{ .x = min_x, .y = min_y, .z = min_z },
        .max = .{ .x = max_x, .y = max_y, .z = max_z },
    };
}

pub fn bbox3containsPoint(b: BBox3, pt: Vec3) bool {
    return pt.x >= b.min.x and pt.x <= b.max.x and
        pt.y >= b.min.y and pt.y <= b.max.y and
        pt.z >= b.min.z and pt.z <= b.max.z;
}

pub fn bbox3intersects(a: BBox3, b: BBox3) bool {
    return a.min.x <= b.max.x and a.max.x >= b.min.x and
        a.min.y <= b.max.y and a.max.y >= b.min.y and
        a.min.z <= b.max.z and a.max.z >= b.min.z;
}

pub fn bbox3union(a: BBox3, b: BBox3) BBox3 {
    return .{
        .min = .{ .x = @min(a.min.x, b.min.x), .y = @min(a.min.y, b.min.y), .z = @min(a.min.z, b.min.z) },
        .max = .{ .x = @max(a.max.x, b.max.x), .y = @max(a.max.y, b.max.y), .z = @max(a.max.z, b.max.z) },
    };
}

pub fn bbox3expand(b: BBox3, amount: f32) BBox3 {
    return .{
        .min = .{ .x = b.min.x - amount, .y = b.min.y - amount, .z = b.min.z - amount },
        .max = .{ .x = b.max.x + amount, .y = b.max.y + amount, .z = b.max.z + amount },
    };
}
