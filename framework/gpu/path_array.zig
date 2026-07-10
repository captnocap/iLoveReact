const std = @import("std");

pub const Vec3 = [3]f32;

/// The source bay's forward direction in model space. Y is always world-up;
/// bridge arrays therefore turn in XZ and gain height in Y.
pub const Axis = enum(u8) {
    positive_x,
    negative_x,
    positive_z,
    negative_z,
};

pub const Profile = enum(u8) {
    linear,
    eased,
};

/// Behavior-affecting limits for both the host boundary and the editor dialog.
/// `bays` includes the untouched source bay; the host generates bays - 1 copies.
pub const Tuning = struct {
    min_bays: u32,
    max_bays: u32,
    min_source_length: f32,
    min_path_segment: f32,
    straight_turn_epsilon_radians: f32,
};

pub const TUNING = Tuning{
    .min_bays = 2,
    .max_bays = 64,
    .min_source_length = 0.0001,
    .min_path_segment = 0.0001,
    .straight_turn_epsilon_radians = 0.00001,
};

pub const Params = struct {
    axis: Axis,
    bays: u32,
    turn_radians: f32,
    rise: f32,
    profile: Profile,
};

/// Shared bounds for every part in one source bay. The array begins at the
/// source's forward end and leaves the source geometry untouched.
pub const Template = struct {
    forward_min: f32,
    forward_max: f32,
    lateral_center: f32,
    vertical_origin: f32,

    pub fn length(self: Template) f32 {
        return self.forward_max - self.forward_min;
    }
};

pub const Basis = struct {
    forward: Vec3,
    right: Vec3,
};

pub fn basis(axis: Axis) Basis {
    return switch (axis) {
        .positive_x => .{ .forward = .{ 1, 0, 0 }, .right = .{ 0, 0, -1 } },
        .negative_x => .{ .forward = .{ -1, 0, 0 }, .right = .{ 0, 0, 1 } },
        .positive_z => .{ .forward = .{ 0, 0, 1 }, .right = .{ 1, 0, 0 } },
        .negative_z => .{ .forward = .{ 0, 0, -1 }, .right = .{ -1, 0, 0 } },
    };
}

pub fn valid(template: Template, params: Params) bool {
    return params.bays >= TUNING.min_bays and
        params.bays <= TUNING.max_bays and
        std.math.isFinite(params.turn_radians) and
        std.math.isFinite(params.rise) and
        std.math.isFinite(template.forward_min) and
        std.math.isFinite(template.forward_max) and
        std.math.isFinite(template.lateral_center) and
        std.math.isFinite(template.vertical_origin) and
        template.length() >= TUNING.min_source_length;
}

pub fn validPointPath(template: Template, points: []const Vec3) bool {
    if (template.length() < TUNING.min_source_length or points.len < TUNING.min_bays or points.len > TUNING.max_bays) return false;
    for (points) |point| {
        if (!std.math.isFinite(point[0]) or !std.math.isFinite(point[1]) or !std.math.isFinite(point[2])) return false;
    }
    if (@abs(points[0][0]) >= TUNING.min_path_segment or @abs(points[0][1]) >= TUNING.min_path_segment or @abs(points[0][2]) >= TUNING.min_path_segment) return false;
    var i: usize = 1;
    while (i < points.len) : (i += 1) {
        const dx = points[i][0] - points[i - 1][0];
        const dy = points[i][1] - points[i - 1][1];
        const dz = points[i][2] - points[i - 1][2];
        if (dx * dx + dy * dy + dz * dz < TUNING.min_path_segment * TUNING.min_path_segment) return false;
    }
    return true;
}

fn dot(a: Vec3, b: Vec3) f32 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

fn add(a: Vec3, b: Vec3) Vec3 {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}

fn scale(v: Vec3, amount: f32) Vec3 {
    return .{ v[0] * amount, v[1] * amount, v[2] * amount };
}

fn profileValue(profile: Profile, raw_t: f32) f32 {
    const t = std.math.clamp(raw_t, 0, 1);
    return switch (profile) {
        .linear => t,
        // Smoothstep starts and finishes level, avoiding a pitch kink where the
        // untouched source bay meets the generated run.
        .eased => t * t * (3 - 2 * t),
    };
}

/// Map one source vertex into one generated bay. Cross-sections yaw with the
/// horizontal curve but remain world-vertical: this is the algorithmic version
/// of cumulatively lifting transverse bridge rings, so posts stay upright and
/// every generated ring uses the exact same path frame as its neighbor.
pub fn mapPoint(template: Template, params: Params, generated_bay_index: u32, point: Vec3) Vec3 {
    const b = basis(params.axis);
    const generated_bays: f32 = @floatFromInt(params.bays - 1);
    const source_length = template.length();
    const local_forward = std.math.clamp((dot(point, b.forward) - template.forward_min) / source_length, 0, 1);
    const bay: f32 = @floatFromInt(generated_bay_index);
    const t = std.math.clamp((bay + local_forward) / generated_bays, 0, 1);

    const total_distance = source_length * generated_bays;
    const distance = total_distance * t;
    const angle = params.turn_radians * t;
    var forward_distance = distance;
    var right_distance: f32 = 0;
    if (@abs(params.turn_radians) >= TUNING.straight_turn_epsilon_radians) {
        const radius = total_distance / params.turn_radians;
        forward_distance = std.math.sin(angle) * radius;
        right_distance = (1 - std.math.cos(angle)) * radius;
    }

    const rotated_right = add(scale(b.right, std.math.cos(angle)), scale(b.forward, -std.math.sin(angle)));
    const lateral = dot(point, b.right) - template.lateral_center;
    const vertical = point[1] - template.vertical_origin;
    const source_end = add(
        add(scale(b.forward, template.forward_max), scale(b.right, template.lateral_center)),
        .{ 0, template.vertical_origin, 0 },
    );
    const path_center = add(
        add(source_end, scale(b.forward, forward_distance)),
        add(scale(b.right, right_distance), .{ 0, params.rise * profileValue(params.profile, t), 0 }),
    );
    return add(add(path_center, scale(rotated_right, lateral)), .{ 0, vertical, 0 });
}

fn pointForward(axis: Axis, points: []const Vec3, index: usize) Vec3 {
    if (index == 0) return basis(axis).forward;
    const a = points[index - 1];
    const b = if (index + 1 < points.len) points[index + 1] else points[index];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const length = @sqrt(dx * dx + dz * dz);
    if (length < TUNING.min_path_segment) {
        const fallback = basis(axis).forward;
        return fallback;
    }
    return .{ dx / length, 0, dz / length };
}

fn shortestAngleDelta(from: f32, to: f32) f32 {
    var delta = to - from;
    while (delta > std.math.pi) delta -= 2 * std.math.pi;
    while (delta < -std.math.pi) delta += 2 * std.math.pi;
    return delta;
}

/// Map through explicit 3D boundary points (offsets from the source's forward-end
/// center). Each adjacent pair is one generated bay. Boundary frames are shared,
/// so neighboring copies meet exactly even when their runs change direction.
pub fn mapPointPath(template: Template, axis: Axis, points: []const Vec3, generated_bay_index: u32, point: Vec3) Vec3 {
    const bay: usize = @intCast(generated_bay_index);
    if (points.len < 2 or bay + 1 >= points.len) return point;
    const base = basis(axis);
    const source_length = template.length();
    const local_forward = std.math.clamp((dot(point, base.forward) - template.forward_min) / source_length, 0, 1);
    const p0 = points[bay];
    const p1 = points[bay + 1];
    const center_offset: Vec3 = .{
        p0[0] + (p1[0] - p0[0]) * local_forward,
        p0[1] + (p1[1] - p0[1]) * local_forward,
        p0[2] + (p1[2] - p0[2]) * local_forward,
    };

    const forward0 = pointForward(axis, points, bay);
    const forward1 = pointForward(axis, points, bay + 1);
    const angle0 = std.math.atan2(forward0[2], forward0[0]);
    const angle1 = std.math.atan2(forward1[2], forward1[0]);
    const angle = angle0 + shortestAngleDelta(angle0, angle1) * local_forward;
    const rotated_right: Vec3 = .{ std.math.sin(angle), 0, -std.math.cos(angle) };

    const lateral = dot(point, base.right) - template.lateral_center;
    const vertical = point[1] - template.vertical_origin;
    const source_end = add(
        add(scale(base.forward, template.forward_max), scale(base.right, template.lateral_center)),
        .{ 0, template.vertical_origin, 0 },
    );
    const path_center = add(source_end, center_offset);
    return add(add(path_center, scale(rotated_right, lateral)), .{ 0, vertical, 0 });
}
