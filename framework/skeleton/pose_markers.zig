//! Applied-pose diagnostic marker contract (req_3538).
//!
//! Marker ids travel in the player-skin bone table's first reserved float.
//! They construct render nodes only for the Animation capture surface; normal
//! play carries `.none` and pays no node/per-frame cost.

const std = @import("std");

pub const Kind = enum(u8) {
    none = 0,
    face = 1,
    upper = 2,
    leg = 3,
};

pub const Tuning = struct {
    /// `sphere12x8` is a unit-diameter sphere, so this is also marker diameter.
    pub const diameter_meters: f32 = 0.10;
    pub const face_color = [3]f32{ 0.91, 0.76, 0.30 };
    pub const upper_color = [3]f32{ 0.30, 0.79, 0.91 };
    pub const leg_color = [3]f32{ 0.91, 0.53, 0.30 };
};

pub fn decode(raw: f32) Kind {
    if (!std.math.isFinite(raw)) return .none;
    const rounded: i32 = @intFromFloat(@round(raw));
    return switch (rounded) {
        1 => .face,
        2 => .upper,
        3 => .leg,
        else => .none,
    };
}

pub fn color(kind: Kind) [3]f32 {
    return switch (kind) {
        .none => .{ 0, 0, 0 },
        .face => Tuning.face_color,
        .upper => Tuning.upper_color,
        .leg => Tuning.leg_color,
    };
}
