//! easing.zig — CSS easing functions for the transition engine
//!
//! Pure math, zero dependencies beyond framework/math.zig.
//! All functions: f32 → f32, input 0.0–1.0, output 0.0–1.0 (may overshoot for spring/elastic).
//!
//! Easing functions:
//!   linear, easeIn, easeOut, easeInOut, spring, bounce, elastic
//!   cubicBezier (CSS cubic-bezier with Newton-Raphson solver)

const std = @import("std");
const m = @import("root.zig");

/// Easing function signature: normalized time (0–1) → eased value.
pub const EasingFn = *const fn (f32) f32;

/// Named easing presets. Matches CSS transition-timing-function names.
pub const EasingType = enum {
    linear,
    ease_in,
    ease_out,
    ease_in_out,
    spring,
    bounce,
    elastic,
    // cubic_bezier is handled separately via CubicBezierEasing

    /// Resolve a named easing type to its function pointer.
    pub fn resolve(self: EasingType) EasingFn {
        return switch (self) {
            .linear => &linear,
            .ease_in => &easeIn,
            .ease_out => &easeOut,
            .ease_in_out => &easeInOut,
            .spring => &spring,
            .bounce => &bounce,
            .elastic => &elasticDefault,
        };
    }
};

// ============================================================================
// Easing functions
// ============================================================================

/// Linear: no acceleration.
pub fn linear(t: f32) f32 {
    return t;
}

/// Ease in: quadratic acceleration from zero velocity.
pub fn easeIn(t: f32) f32 {
    return t * t;
}

/// Ease out: quadratic deceleration to zero velocity.
pub fn easeOut(t: f32) f32 {
    return t * (2.0 - t);
}

/// Ease in-out: quadratic acceleration then deceleration.
pub fn easeInOut(t: f32) f32 {
    if (t < 0.5) return 2.0 * t * t;
    return -1.0 + (4.0 - 2.0 * t) * t;
}

/// Spring: decaying sinusoidal overshoot. Reaches 1.0 with damped oscillation.
pub fn spring(t: f32) f32 {
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    const p: f32 = 0.3;
    const pi2 = std.math.pi * 2.0;
    return m.pow(2.0, -10.0 * t) * @sin((t - p / 4.0) * pi2 / p) + 1.0;
}

/// Sine wave: full oscillation 0→1→0 over t=[0,1].
/// Use with loop=cycle for an oscillating animation that traces a
/// sine wave (height = lerp(from, to, sine(t))). Output range [0, 1].
/// Math goes through framework/math.zig — single home for primitives.
pub fn sine(t: f32) f32 {
    return 0.5 + 0.5 * m.sin(t * m.tauValue() - m.piValue() * 0.5);
}

/// Bounce: simulates a bouncing ball. Identical curve to `bounceOut`;
/// kept as the canonical name for `EasingType.bounce` resolution.
pub fn bounce(t: f32) f32 {
    return bounceOut(t);
}

/// Elastic easing with configurable bounciness.
pub fn elastic(t: f32, bounciness: f32) f32 {
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    const p = 0.3 / @max(bounciness, 0.001);
    const pi2 = std.math.pi * 2.0;
    return m.pow(2.0, -10.0 * t) * @sin((t - p / 4.0) * pi2 / p) + 1.0;
}

/// Elastic with default bounciness (1.0). Used as the EasingFn for .elastic.
fn elasticDefault(t: f32) f32 {
    return elastic(t, 1.0);
}

// ============================================================================
// Named easing matrix (easings.net) — 30 curves matching runtime/easing.ts
// EASINGS keys exactly. Used by animations.zig CurveType when the cart
// declares a host-driven animation with one of these JS-side names.
// ============================================================================

const _back_c1: f32 = 1.70158;
const _back_c2: f32 = _back_c1 * 1.525;
const _back_c3: f32 = _back_c1 + 1.0;
const _elastic_c4: f32 = (2.0 * std.math.pi) / 3.0;
const _elastic_c5: f32 = (2.0 * std.math.pi) / 4.5;
const _bounce_n1: f32 = 7.5625;
const _bounce_d1: f32 = 2.75;

pub fn easeInSine(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - @cos((t * std.math.pi) / 2.0); }
pub fn easeOutSine(tin: f32) f32 { const t = m.clamp01(tin); return @sin((t * std.math.pi) / 2.0); }
pub fn easeInOutSine(tin: f32) f32 { const t = m.clamp01(tin); return -(@cos(std.math.pi * t) - 1.0) / 2.0; }

pub fn easeInQuad(tin: f32) f32 { const t = m.clamp01(tin); return t * t; }
pub fn easeOutQuad(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - (1.0 - t) * (1.0 - t); }
pub fn easeInOutQuad(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return 2.0 * t * t;
    return 1.0 - m.pow(-2.0 * t + 2.0, 2.0) / 2.0;
}

pub fn easeInCubic(tin: f32) f32 { const t = m.clamp01(tin); return t * t * t; }
pub fn easeOutCubic(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - m.pow(1.0 - t, 3.0); }
pub fn easeInOutCubic(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return 4.0 * t * t * t;
    return 1.0 - m.pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

pub fn easeInQuart(tin: f32) f32 { const t = m.clamp01(tin); return t * t * t * t; }
pub fn easeOutQuart(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - m.pow(1.0 - t, 4.0); }
pub fn easeInOutQuart(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return 8.0 * t * t * t * t;
    return 1.0 - m.pow(-2.0 * t + 2.0, 4.0) / 2.0;
}

pub fn easeInQuint(tin: f32) f32 { const t = m.clamp01(tin); return t * t * t * t * t; }
pub fn easeOutQuint(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - m.pow(1.0 - t, 5.0); }
pub fn easeInOutQuint(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return 16.0 * t * t * t * t * t;
    return 1.0 - m.pow(-2.0 * t + 2.0, 5.0) / 2.0;
}

pub fn easeInExpo(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t <= 0.0) return 0.0;
    return m.pow(2.0, 10.0 * t - 10.0);
}
pub fn easeOutExpo(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t >= 1.0) return 1.0;
    return 1.0 - m.pow(2.0, -10.0 * t);
}
pub fn easeInOutExpo(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    if (t < 0.5) return m.pow(2.0, 20.0 * t - 10.0) / 2.0;
    return (2.0 - m.pow(2.0, -20.0 * t + 10.0)) / 2.0;
}

pub fn easeInCirc(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - @sqrt(1.0 - t * t); }
pub fn easeOutCirc(tin: f32) f32 { const t = m.clamp01(tin); return @sqrt(1.0 - m.pow(t - 1.0, 2.0)); }
pub fn easeInOutCirc(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return (1.0 - @sqrt(1.0 - m.pow(2.0 * t, 2.0))) / 2.0;
    return (@sqrt(1.0 - m.pow(-2.0 * t + 2.0, 2.0)) + 1.0) / 2.0;
}

pub fn easeInBack(tin: f32) f32 { const t = m.clamp01(tin); return _back_c3 * t * t * t - _back_c1 * t * t; }
pub fn easeOutBack(tin: f32) f32 {
    const t = m.clamp01(tin);
    return 1.0 + _back_c3 * m.pow(t - 1.0, 3.0) + _back_c1 * m.pow(t - 1.0, 2.0);
}
pub fn easeInOutBack(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return (m.pow(2.0 * t, 2.0) * ((_back_c2 + 1.0) * 2.0 * t - _back_c2)) / 2.0;
    return (m.pow(2.0 * t - 2.0, 2.0) * ((_back_c2 + 1.0) * (t * 2.0 - 2.0) + _back_c2) + 2.0) / 2.0;
}

pub fn easeInElastic(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    return -m.pow(2.0, 10.0 * t - 10.0) * @sin((t * 10.0 - 10.75) * _elastic_c4);
}
pub fn easeOutElastic(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    return m.pow(2.0, -10.0 * t) * @sin((t * 10.0 - 0.75) * _elastic_c4) + 1.0;
}
pub fn easeInOutElastic(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    if (t < 0.5) return -(m.pow(2.0, 20.0 * t - 10.0) * @sin((20.0 * t - 11.125) * _elastic_c5)) / 2.0;
    return (m.pow(2.0, -20.0 * t + 10.0) * @sin((20.0 * t - 11.125) * _elastic_c5)) / 2.0 + 1.0;
}

pub fn bounceOut(tin: f32) f32 {
    var t = m.clamp01(tin);
    if (t < 1.0 / _bounce_d1) return _bounce_n1 * t * t;
    if (t < 2.0 / _bounce_d1) { t -= 1.5 / _bounce_d1; return _bounce_n1 * t * t + 0.75; }
    if (t < 2.5 / _bounce_d1) { t -= 2.25 / _bounce_d1; return _bounce_n1 * t * t + 0.9375; }
    t -= 2.625 / _bounce_d1;
    return _bounce_n1 * t * t + 0.984375;
}
pub fn easeInBounce(tin: f32) f32 { const t = m.clamp01(tin); return 1.0 - bounceOut(1.0 - t); }
pub fn easeOutBounce(tin: f32) f32 { return bounceOut(tin); }
pub fn easeInOutBounce(tin: f32) f32 {
    const t = m.clamp01(tin);
    if (t < 0.5) return (1.0 - bounceOut(1.0 - 2.0 * t)) / 2.0;
    return (1.0 + bounceOut(2.0 * t - 1.0)) / 2.0;
}

// ============================================================================
// CSS cubic-bezier
// ============================================================================

/// Pre-computed cubic bezier easing curve.
/// CSS cubic-bezier(x1, y1, x2, y2) with fixed endpoints (0,0) and (1,1).
pub const CubicBezierEasing = struct {
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,

    /// Evaluate the easing curve at normalized time t.
    /// Uses Newton-Raphson to solve for the bezier parameter u where B_x(u) = t,
    /// then returns B_y(u).
    pub fn eval(self: CubicBezierEasing, t: f32) f32 {
        if (t <= 0.0) return 0.0;
        if (t >= 1.0) return 1.0;

        // Newton-Raphson: solve for u where sampleX(u) = t
        var u = t;
        for (0..8) |_| {
            const x_est = sampleCurve(u, self.x1, self.x2) - t;
            if (@abs(x_est) < 1e-6) break;
            const dx = sampleDerivative(u, self.x1, self.x2);
            if (@abs(dx) < 1e-6) break;
            u -= x_est / dx;
        }
        u = m.clamp(u, 0.0, 1.0);
        return sampleCurve(u, self.y1, self.y2);
    }

    /// Sample a 1D cubic bezier with fixed endpoints 0 and 1.
    /// B(t) = 3*(1-t)^2*t*p1 + 3*(1-t)*t^2*p2 + t^3
    fn sampleCurve(t: f32, p1: f32, p2: f32) f32 {
        const mt = 1.0 - t;
        return 3.0 * mt * mt * t * p1 + 3.0 * mt * t * t * p2 + t * t * t;
    }

    /// Derivative of the 1D cubic bezier.
    fn sampleDerivative(t: f32, p1: f32, p2: f32) f32 {
        const mt = 1.0 - t;
        return 3.0 * mt * mt * p1 + 6.0 * mt * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2);
    }
};

/// Common CSS presets.
pub const css_ease = CubicBezierEasing{ .x1 = 0.25, .y1 = 0.1, .x2 = 0.25, .y2 = 1.0 };
pub const css_ease_in = CubicBezierEasing{ .x1 = 0.42, .y1 = 0.0, .x2 = 1.0, .y2 = 1.0 };
pub const css_ease_out = CubicBezierEasing{ .x1 = 0.0, .y1 = 0.0, .x2 = 0.58, .y2 = 1.0 };
pub const css_ease_in_out = CubicBezierEasing{ .x1 = 0.42, .y1 = 0.0, .x2 = 0.58, .y2 = 1.0 };

// ============================================================================
// Tests
// ============================================================================

fn expectApprox(expected: f32, actual: f32) !void {
    if (@abs(expected - actual) > 0.01) {
        std.debug.print("expected {d:.4}, got {d:.4}\n", .{ expected, actual });
        return error.TestUnexpectedResult;
    }
}

test "linear is identity" {
    try expectApprox(0.0, linear(0.0));
    try expectApprox(0.5, linear(0.5));
    try expectApprox(1.0, linear(1.0));
}

test "easeIn starts slow" {
    try expectApprox(0.0, easeIn(0.0));
    try expectApprox(0.25, easeIn(0.5)); // 0.5^2 = 0.25
    try expectApprox(1.0, easeIn(1.0));
}

test "easeOut ends slow" {
    try expectApprox(0.0, easeOut(0.0));
    try expectApprox(0.75, easeOut(0.5)); // 0.5 * (2 - 0.5) = 0.75
    try expectApprox(1.0, easeOut(1.0));
}

test "easeInOut symmetric" {
    try expectApprox(0.0, easeInOut(0.0));
    try expectApprox(0.5, easeInOut(0.5));
    try expectApprox(1.0, easeInOut(1.0));
    // First half slower than second half
    const q1 = easeInOut(0.25);
    const q3 = easeInOut(0.75);
    try expectApprox(q1, 1.0 - q3); // symmetric around 0.5
}

test "spring overshoots then converges" {
    try expectApprox(0.0, spring(0.0));
    try expectApprox(1.0, spring(1.0));
    // Spring should overshoot 1.0 at some point
    var max_val: f32 = 0;
    for (0..100) |i| {
        const t: f32 = @as(f32, @floatFromInt(i)) / 100.0;
        max_val = @max(max_val, spring(t));
    }
    try std.testing.expect(max_val > 1.0);
}

test "bounce endpoints" {
    try expectApprox(0.0, bounce(0.0));
    try expectApprox(1.0, bounce(1.0));
}

test "elastic endpoints and overshoot" {
    try expectApprox(0.0, elastic(0.0, 1.0));
    try expectApprox(1.0, elastic(1.0, 1.0));
    var max_val: f32 = 0;
    for (0..100) |i| {
        const t: f32 = @as(f32, @floatFromInt(i)) / 100.0;
        max_val = @max(max_val, elastic(t, 1.0));
    }
    try std.testing.expect(max_val > 1.0);
}

test "cubicBezier endpoints" {
    const bez = CubicBezierEasing{ .x1 = 0.42, .y1 = 0.0, .x2 = 0.58, .y2 = 1.0 };
    try expectApprox(0.0, bez.eval(0.0));
    try expectApprox(1.0, bez.eval(1.0));
    try expectApprox(0.5, bez.eval(0.5)); // ease-in-out is symmetric
}

test "cubicBezier linear" {
    // cubic-bezier(0, 0, 1, 1) should be approximately linear
    const bez = CubicBezierEasing{ .x1 = 0.0, .y1 = 0.0, .x2 = 1.0, .y2 = 1.0 };
    for (0..11) |i| {
        const t: f32 = @as(f32, @floatFromInt(i)) / 10.0;
        try expectApprox(t, bez.eval(t));
    }
}

test "css presets are sane" {
    // All presets should map 0→0 and 1→1
    try expectApprox(0.0, css_ease.eval(0.0));
    try expectApprox(1.0, css_ease.eval(1.0));
    try expectApprox(0.0, css_ease_in.eval(0.0));
    try expectApprox(1.0, css_ease_in.eval(1.0));
    try expectApprox(0.0, css_ease_out.eval(0.0));
    try expectApprox(1.0, css_ease_out.eval(1.0));
    try expectApprox(0.0, css_ease_in_out.eval(0.0));
    try expectApprox(1.0, css_ease_in_out.eval(1.0));
}
