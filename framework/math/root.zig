//! root.zig — central re-export hub for the math module.
//!
//! This is the choke point. Cart code, framework code, and the v8 bridge
//! all reach math through `@import("math/root.zig")`. If you find yourself
//! grepping for `Vec2`, `m4perspective`, `noise2d`, etc. — they live in
//! sibling files (vec2.zig, mat4.zig, noise.zig) that this file aggregates.
//!
//! Internal repetition between those files lives in `utils.zig`. If you're
//! tempted to write `@sqrt(dx*dx + dy*dy)`, `@max(0, @min(1, x))`, or
//! `t * t * (3 - 2 * t)` inline — DON'T. The util already exists.
//!
//! Modules:
//!   - utils  — shared internals (EPSILON, length2/3, clamp01, S-curves, etc.)
//!   - vec2   — Vec2 + ops
//!   - vec3   — Vec3 + ops
//!   - vec4   — Vec4 + ops
//!   - mat4   — Mat4 + ops + Decomposed
//!   - quat   — Quat + ops (Quat aliases Vec4)
//!   - bbox   — BBox2 / BBox3 + ops
//!   - geo    — point/segment/line/circle/rect helpers
//!   - noise  — Perlin noise + fBm
//!   - bezier — Bezier evaluation
//!
//! Scalar helpers (lerp, clamp, remap, …) and JS-callable thin wrappers for
//! Zig builtins (@sin, @cos, …) live below.

const std = @import("std");

pub const utils = @import("utils.zig");
pub const vec2_mod = @import("vec2.zig");
pub const vec3_mod = @import("vec3.zig");
pub const vec4_mod = @import("vec4.zig");
pub const mat4_mod = @import("mat4.zig");
pub const quat_mod = @import("quat.zig");
pub const bbox_mod = @import("bbox.zig");
pub const geo_mod = @import("geo.zig");
pub const noise_mod = @import("noise.zig");
pub const bezier_mod = @import("bezier.zig");
pub const distribute_mod = @import("distribute.zig");
pub const wrap_mod = @import("wrap.zig");

const pi: f32 = std.math.pi;

// ── Constants & types ───────────────────────────────────────────────────

pub const EPSILON = utils.EPSILON;

pub const Vec2 = vec2_mod.Vec2;
pub const Vec3 = vec3_mod.Vec3;
pub const Vec4 = vec4_mod.Vec4;
pub const Quat = quat_mod.Quat;
pub const Mat4 = mat4_mod.Mat4;
pub const Decomposed = mat4_mod.Decomposed;
pub const BBox2 = bbox_mod.BBox2;
pub const BBox3 = bbox_mod.BBox3;

// ── Vec2 ────────────────────────────────────────────────────────────────

pub const v2 = vec2_mod.v2;
pub const v2zero = vec2_mod.v2zero;
pub const v2one = vec2_mod.v2one;
pub const v2add = vec2_mod.v2add;
pub const v2sub = vec2_mod.v2sub;
pub const v2mul = vec2_mod.v2mul;
pub const v2div = vec2_mod.v2div;
pub const v2scale = vec2_mod.v2scale;
pub const v2negate = vec2_mod.v2negate;
pub const v2dot = vec2_mod.v2dot;
pub const v2cross = vec2_mod.v2cross;
pub const v2length = vec2_mod.v2length;
pub const v2lengthSq = vec2_mod.v2lengthSq;
pub const v2distance = vec2_mod.v2distance;
pub const v2distanceSq = vec2_mod.v2distanceSq;
pub const v2normalize = vec2_mod.v2normalize;
pub const v2abs = vec2_mod.v2abs;
pub const v2floor = vec2_mod.v2floor;
pub const v2ceil = vec2_mod.v2ceil;
pub const v2round = vec2_mod.v2round;
pub const v2min = vec2_mod.v2min;
pub const v2max = vec2_mod.v2max;
pub const v2clamp = vec2_mod.v2clamp;
pub const v2lerp = vec2_mod.v2lerp;
pub const v2smoothstep = vec2_mod.v2smoothstep;
pub const v2angle = vec2_mod.v2angle;
pub const v2fromAngle = vec2_mod.v2fromAngle;
pub const v2rotate = vec2_mod.v2rotate;
pub const v2equals = vec2_mod.v2equals;
pub const v2almostEquals = vec2_mod.v2almostEquals;

// ── Vec3 ────────────────────────────────────────────────────────────────

pub const v3 = vec3_mod.v3;
pub const v3zero = vec3_mod.v3zero;
pub const v3one = vec3_mod.v3one;
pub const v3up = vec3_mod.v3up;
pub const v3forward = vec3_mod.v3forward;
pub const v3right = vec3_mod.v3right;
pub const v3add = vec3_mod.v3add;
pub const v3sub = vec3_mod.v3sub;
pub const v3mul = vec3_mod.v3mul;
pub const v3div = vec3_mod.v3div;
pub const v3scale = vec3_mod.v3scale;
pub const v3negate = vec3_mod.v3negate;
pub const v3dot = vec3_mod.v3dot;
pub const v3cross = vec3_mod.v3cross;
pub const v3length = vec3_mod.v3length;
pub const v3lengthSq = vec3_mod.v3lengthSq;
pub const v3distance = vec3_mod.v3distance;
pub const v3distanceSq = vec3_mod.v3distanceSq;
pub const v3normalize = vec3_mod.v3normalize;
pub const v3abs = vec3_mod.v3abs;
pub const v3floor = vec3_mod.v3floor;
pub const v3ceil = vec3_mod.v3ceil;
pub const v3round = vec3_mod.v3round;
pub const v3min = vec3_mod.v3min;
pub const v3max = vec3_mod.v3max;
pub const v3clamp = vec3_mod.v3clamp;
pub const v3lerp = vec3_mod.v3lerp;
pub const v3smoothstep = vec3_mod.v3smoothstep;
pub const v3reflect = vec3_mod.v3reflect;
pub const v3slerp = vec3_mod.v3slerp;
pub const v3equals = vec3_mod.v3equals;
pub const v3almostEquals = vec3_mod.v3almostEquals;

// ── Vec4 ────────────────────────────────────────────────────────────────

pub const v4 = vec4_mod.v4;
pub const v4zero = vec4_mod.v4zero;
pub const v4one = vec4_mod.v4one;
pub const v4add = vec4_mod.v4add;
pub const v4sub = vec4_mod.v4sub;
pub const v4mul = vec4_mod.v4mul;
pub const v4div = vec4_mod.v4div;
pub const v4scale = vec4_mod.v4scale;
pub const v4negate = vec4_mod.v4negate;
pub const v4dot = vec4_mod.v4dot;
pub const v4length = vec4_mod.v4length;
pub const v4lengthSq = vec4_mod.v4lengthSq;
pub const v4normalize = vec4_mod.v4normalize;
pub const v4lerp = vec4_mod.v4lerp;
pub const v4min = vec4_mod.v4min;
pub const v4max = vec4_mod.v4max;
pub const v4clamp = vec4_mod.v4clamp;
pub const v4equals = vec4_mod.v4equals;
pub const v4almostEquals = vec4_mod.v4almostEquals;

// ── Mat4 ────────────────────────────────────────────────────────────────

pub const m4identity = mat4_mod.m4identity;
pub const m4multiply = mat4_mod.m4multiply;
pub const m4transpose = mat4_mod.m4transpose;
pub const m4determinant = mat4_mod.m4determinant;
pub const m4invert = mat4_mod.m4invert;
pub const m4translate = mat4_mod.m4translate;
pub const m4scale = mat4_mod.m4scale;
pub const m4rotateX = mat4_mod.m4rotateX;
pub const m4rotateY = mat4_mod.m4rotateY;
pub const m4rotateZ = mat4_mod.m4rotateZ;
pub const m4lookAt = mat4_mod.m4lookAt;
pub const m4perspective = mat4_mod.m4perspective;
pub const m4ortho = mat4_mod.m4ortho;
pub const m4transformPoint = mat4_mod.m4transformPoint;
pub const m4transformDir = mat4_mod.m4transformDir;
pub const m4fromQuat = mat4_mod.m4fromQuat;
pub const m4fromEuler = mat4_mod.m4fromEuler;
pub const m4decompose = mat4_mod.m4decompose;

// ── Quat ────────────────────────────────────────────────────────────────

pub const quatIdentity = quat_mod.quatIdentity;
pub const quatCreate = quat_mod.quatCreate;
pub const quatMultiply = quat_mod.quatMultiply;
pub const quatConjugate = quat_mod.quatConjugate;
pub const quatInverse = quat_mod.quatInverse;
pub const quatNormalize = quat_mod.quatNormalize;
pub const quatDot = quat_mod.quatDot;
pub const quatLength = quat_mod.quatLength;
pub const quatFromAxisAngle = quat_mod.quatFromAxisAngle;
pub const quatFromEuler = quat_mod.quatFromEuler;
pub const quatToEuler = quat_mod.quatToEuler;
pub const quatToMat4 = quat_mod.quatToMat4;
pub const quatSlerp = quat_mod.quatSlerp;
pub const quatRotateVec3 = quat_mod.quatRotateVec3;

// ── BBox / Geometry ─────────────────────────────────────────────────────

pub const bbox2 = bbox_mod.bbox2;
pub const bbox2width = bbox_mod.bbox2width;
pub const bbox2height = bbox_mod.bbox2height;
pub const bbox2center = bbox_mod.bbox2center;
pub const bbox2containsPoint = bbox_mod.bbox2containsPoint;
pub const bbox2containsBBox = bbox_mod.bbox2containsBBox;
pub const bbox2intersects = bbox_mod.bbox2intersects;
pub const bbox2intersection = bbox_mod.bbox2intersection;
pub const bbox2union = bbox_mod.bbox2union;
pub const bbox2expand = bbox_mod.bbox2expand;
pub const bbox3 = bbox_mod.bbox3;
pub const bbox3containsPoint = bbox_mod.bbox3containsPoint;
pub const bbox3intersects = bbox_mod.bbox3intersects;
pub const bbox3union = bbox_mod.bbox3union;
pub const bbox3expand = bbox_mod.bbox3expand;

pub const distancePointToSegment = geo_mod.distancePointToSegment;
pub const distancePointToRect = geo_mod.distancePointToRect;
pub const circleContainsPoint = geo_mod.circleContainsPoint;
pub const circleIntersectsRect = geo_mod.circleIntersectsRect;
pub const lineIntersection = geo_mod.lineIntersection;

// ── Noise ───────────────────────────────────────────────────────────────

pub const noise2d = noise_mod.noise2d;
pub const noise3d = noise_mod.noise3d;
pub const fbm2d = noise_mod.fbm2d;
pub const fbm3d = noise_mod.fbm3d;

// ── Bezier ──────────────────────────────────────────────────────────────

pub const bezierPoint = bezier_mod.bezierPoint;
pub const bezierCurve = bezier_mod.bezierCurve;
pub const cubicBezier = bezier_mod.cubicBezier;
pub const cubicBezierDerivative = bezier_mod.cubicBezierDerivative;
pub const quadraticBezier = bezier_mod.quadraticBezier;

// ── 1D distribution (justify-content / align-content style) ────────────

pub const Distribute = distribute_mod.Mode;
pub const Distribution = distribute_mod.Distribution;
pub const distribute = distribute_mod.distribute;

// ── 1D greedy line packing (flex-wrap style) ───────────────────────────

pub const Line = wrap_mod.Line;
pub const wrapPack = wrap_mod.pack;

// ── Cross-cutting helpers (re-exported from utils for convenience) ──────
//
// These are what cart/framework code grabs when it would otherwise inline
// `@sqrt(dx*dx + dy*dy)` etc. Always reach for these first.

pub const clamp01 = utils.clamp01;
pub const clampUnit = utils.clampUnit;
pub const length2 = utils.length2;
pub const lengthSq2 = utils.lengthSq2;
pub const length3 = utils.length3;
pub const lengthSq3 = utils.lengthSq3;
pub const length4 = utils.length4;
pub const lengthSq4 = utils.lengthSq4;
pub const pointInRectXYWH = utils.pointInRectXYWH;
pub const pointInRectXYWHInclusive = utils.pointInRectXYWHInclusive;
pub const clampOpt = utils.clampOpt;
pub const mat2dScaleX = utils.mat2dScaleX;
pub const mat2dScaleY = utils.mat2dScaleY;
pub const smoothstepCurve = utils.smoothstepCurve;
pub const smootherstepCurve = utils.smootherstepCurve;

// ── Scalar interpolation / range helpers ────────────────────────────────

pub fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

pub fn inverseLerp(a: f32, b: f32, value: f32) f32 {
    if (a == b) return 0;
    return (value - a) / (b - a);
}

pub fn smoothstep(edge0: f32, edge1: f32, x: f32) f32 {
    const t = std.math.clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return utils.smoothstepCurve(t);
}

pub fn smootherstep(edge0: f32, edge1: f32, x: f32) f32 {
    const t = std.math.clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return utils.smootherstepCurve(t);
}

pub fn remap(value: f32, inMin: f32, inMax: f32, outMin: f32, outMax: f32) f32 {
    return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}

pub fn clamp(value: f32, lo: f32, hi: f32) f32 {
    return std.math.clamp(value, lo, hi);
}

pub fn wrap(value: f32, lo: f32, hi: f32) f32 {
    const range = hi - lo;
    if (range == 0) return lo;
    return lo + @mod(@mod(value - lo, range) + range, range);
}

pub fn damp(a: f32, b: f32, smoothing: f32, dt: f32) f32 {
    return lerp(a, b, 1 - @exp(-smoothing * dt));
}

pub fn step(edge: f32, x: f32) f32 {
    return if (x < edge) 0 else 1;
}

pub fn pingPong(value: f32, length: f32) f32 {
    const t = wrap(value, 0, length * 2);
    return length - @abs(t - length);
}

pub fn moveTowards(current: f32, target: f32, maxDelta: f32) f32 {
    const diff = target - current;
    if (@abs(diff) <= maxDelta) return target;
    return current + (if (diff > 0) maxDelta else -maxDelta);
}

pub fn moveTowardsAngle(current: f32, target: f32, maxDelta: f32) f32 {
    var diff = target - current;
    while (diff > pi) diff -= pi * 2;
    while (diff < -pi) diff += pi * 2;
    if (@abs(diff) <= maxDelta) return target;
    return current + (if (diff > 0) maxDelta else -maxDelta);
}

pub const SmoothDampResult = struct {
    result: f32 = 0,
    velocity: f32 = 0,
};

pub fn smoothDamp(current: f32, target: f32, velocity: f32, smoothTime: f32, dt: f32, maxSpeed: f32) SmoothDampResult {
    const omega = 2.0 / @max(0.0001, smoothTime);
    const x = omega * dt;
    const e = 1.0 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var change = current - target;
    const maxChange = maxSpeed * smoothTime;
    change = std.math.clamp(change, -maxChange, maxChange);
    const adjustedTarget = current - change;
    const temp = (velocity + omega * change) * dt;
    var newVel = (velocity - omega * temp) * e;
    var result = adjustedTarget + (change + temp) * e;
    if ((target - current > 0) == (result > target)) {
        result = target;
        newVel = (result - target) / dt;
    }
    return .{ .result = result, .velocity = newVel };
}

pub fn toRadians(degrees: f32) f32 {
    return degrees * (pi / 180.0);
}

pub fn toDegrees(radians: f32) f32 {
    return radians * (180.0 / pi);
}

// ── Scalar math primitives (exposed for the JS bridge) ──────────────────
// Zig's @sin / @cos / @exp etc. are builtins, not library fns, so the
// v8_bindings_zigcall reflection can't pick them up. Thin wrappers make
// them callable from cart JS through math.sin(), math.cos(), etc.

pub fn sin(x: f32) f32 {
    return @sin(x);
}
pub fn cos(x: f32) f32 {
    return @cos(x);
}
pub fn tan(x: f32) f32 {
    return @tan(x);
}
pub fn asin(x: f32) f32 {
    return std.math.asin(x);
}
pub fn acos(x: f32) f32 {
    return std.math.acos(x);
}
pub fn atan(x: f32) f32 {
    return std.math.atan(x);
}
pub fn atan2(y: f32, x: f32) f32 {
    return std.math.atan2(y, x);
}
pub fn exp(x: f32) f32 {
    return @exp(x);
}
pub fn exp2(x: f32) f32 {
    return @exp2(x);
}
pub fn log(x: f32) f32 {
    return @log(x);
}
pub fn log2(x: f32) f32 {
    return @log2(x);
}
pub fn log10(x: f32) f32 {
    return @log10(x);
}
pub fn sqrt(x: f32) f32 {
    return @sqrt(x);
}
pub fn pow(x: f32, y: f32) f32 {
    return std.math.pow(f32, x, y);
}
pub fn absf(x: f32) f32 {
    return @abs(x);
}
pub fn floorf(x: f32) f32 {
    return @floor(x);
}
pub fn ceilf(x: f32) f32 {
    return @ceil(x);
}
pub fn roundf(x: f32) f32 {
    return @round(x);
}
pub fn signf(x: f32) f32 {
    if (x > 0) return 1;
    if (x < 0) return -1;
    return 0;
}
pub fn hypot(x: f32, y: f32) f32 {
    return std.math.hypot(x, y);
}
pub fn fract(x: f32) f32 {
    return x - @floor(x);
}

pub fn piValue() f32 {
    return pi;
}
pub fn tauValue() f32 {
    return pi * 2.0;
}

// ── Tests ───────────────────────────────────────────────────────────────

test "lerp basic" {
    try std.testing.expectEqual(@as(f32, 5), lerp(0, 10, 0.5));
}

test "smoothstep matches curve at midpoint" {
    try std.testing.expectEqual(utils.smoothstepCurve(0.5), smoothstep(0, 1, 0.5));
}

test "module re-exports compile" {
    _ = Vec2;
    _ = Mat4;
    _ = noise2d;
    _ = clamp01;
    _ = length2;
}
