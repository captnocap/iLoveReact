//! Semantic transport paths shared by the road and rail authoring tools.
//!
//! A path is the authored object. Roads compile that object into the existing
//! lane/crosswalk tile grammar; railways render and later compile from the same
//! curve without becoming a second set of painted cells. The draft keeps one
//! transient hover point so the viewport can show the next piece immediately
//! after the first anchor, before the user commits another point.

const std = @import("std");

pub const Point = struct {
    gx: f32,
    gz: f32,
};

pub const Kind = enum(u8) {
    road = 0,
    light_rail = 1,
    railway = 2,
};

pub const RoadProfile = struct {
    lanesF: i32 = 1,
    lanesB: i32 = 1,
    sidewalks: bool = true,
    speedLimitKph: f32 = 0,
};

pub const RailProfile = struct {
    /// Parallel tracks carried by this alignment. One track has two rails.
    tracks: i32 = 1,
};

pub const Profile = union(Kind) {
    road: RoadProfile,
    light_rail: RailProfile,
    railway: RailProfile,
};

pub const Path = struct {
    id: u32,
    points: []const Point,
    profile: Profile,
    /// Quadratic corner-fillet reach in metres. Zero intentionally means a
    /// polyline with hard corners (valid for roads, invalid for turning rail).
    curve_radius_m: f32,
};

/// All behavior-affecting transport authoring values live here. UI presets are
/// merely convenient inputs; this table is the validating authority.
pub const Tuning = struct {
    max_paths: usize,
    max_points_per_path: usize,
    point_snap_m: f32,
    min_segment_m: f32,
    max_curve_radius_m: f32,
    legacy_road_curve_radius_m: f32,
    default_road_curve_radius_m: f32,
    default_light_rail_curve_radius_m: f32,
    default_railway_curve_radius_m: f32,
    light_rail_min_curve_m: f32,
    railway_min_curve_m: f32,
    straight_dot_threshold: f32,
    curve_samples_per_meter: f32,
    max_curve_samples_per_corner: usize,
    max_tracks: i32,
};

pub const TUNING = Tuning{
    .max_paths = 128,
    .max_points_per_path = 128,
    .point_snap_m = 0.25,
    .min_segment_m = 0.5,
    .max_curve_radius_m = 96,
    .legacy_road_curve_radius_m = 5,
    .default_road_curve_radius_m = 8,
    .default_light_rail_curve_radius_m = 18,
    .default_railway_curve_radius_m = 28,
    .light_rail_min_curve_m = 6,
    .railway_min_curve_m = 12,
    .straight_dot_threshold = 0.985,
    .curve_samples_per_meter = 1.5,
    .max_curve_samples_per_corner = 32,
    .max_tracks = 2,
};

pub const MAX_PATHS: usize = TUNING.max_paths;
pub const MAX_POINTS_PER_PATH: usize = TUNING.max_points_per_path;
pub const MAX_CURVE_POINTS: usize = 2 + (MAX_POINTS_PER_PATH - 2) * (TUNING.max_curve_samples_per_corner + 1);

pub fn kindOf(profile: Profile) Kind {
    return std.meta.activeTag(profile);
}

fn clampSpeedLimit(kph: f32) f32 {
    const city_kph: f32 = 50;
    const min_kph: f32 = 10;
    const max_kph: f32 = 130;
    const value = if (std.math.isFinite(kph) and kph > 0) @round(kph / 5) * 5 else city_kph;
    return std.math.clamp(value, min_kph, max_kph);
}

pub fn clampRoadProfile(raw: RoadProfile) RoadProfile {
    const lanes_f = std.math.clamp(raw.lanesF, 0, 3);
    const lanes_b = std.math.clamp(raw.lanesB, 0, 3);
    const speed = clampSpeedLimit(raw.speedLimitKph);
    if (lanes_f == 0 and lanes_b == 0) {
        return .{ .lanesF = 1, .lanesB = 0, .sidewalks = raw.sidewalks, .speedLimitKph = speed };
    }
    return .{ .lanesF = lanes_f, .lanesB = lanes_b, .sidewalks = raw.sidewalks, .speedLimitKph = speed };
}

pub fn clampRailProfile(raw: RailProfile) RailProfile {
    return .{ .tracks = std.math.clamp(raw.tracks, 1, TUNING.max_tracks) };
}

pub fn clampProfile(raw: Profile) Profile {
    return switch (raw) {
        .road => |profile| .{ .road = clampRoadProfile(profile) },
        .light_rail => |profile| .{ .light_rail = clampRailProfile(profile) },
        .railway => |profile| .{ .railway = clampRailProfile(profile) },
    };
}

pub fn clampCurveRadius(radius_m: f32) f32 {
    if (!std.math.isFinite(radius_m)) return 0;
    return std.math.clamp(radius_m, 0, TUNING.max_curve_radius_m);
}

pub fn defaultCurveRadius(kind: Kind) f32 {
    return switch (kind) {
        .road => TUNING.default_road_curve_radius_m,
        .light_rail => TUNING.default_light_rail_curve_radius_m,
        .railway => TUNING.default_railway_curve_radius_m,
    };
}

pub fn snapPoint(gx: f32, gz: f32) Point {
    const step = TUNING.point_snap_m;
    return .{
        .gx = @round(gx / step) * step,
        .gz = @round(gz / step) * step,
    };
}

fn samePoint(a: Point, b: Point) bool {
    return a.gx == b.gx and a.gz == b.gz;
}

fn turnReach(a: Point, vertex: Point, b: Point, requested_radius_m: f32) ?f32 {
    const d1 = std.math.hypot(vertex.gx - a.gx, vertex.gz - a.gz);
    const d2 = std.math.hypot(b.gx - vertex.gx, b.gz - vertex.gz);
    if (d1 < TUNING.min_segment_m or d2 < TUNING.min_segment_m) return 0;
    const u1x = (vertex.gx - a.gx) / d1;
    const u1z = (vertex.gz - a.gz) / d1;
    const u2x = (b.gx - vertex.gx) / d2;
    const u2z = (b.gz - vertex.gz) / d2;
    if (u1x * u2x + u1z * u2z > TUNING.straight_dot_threshold) return null;
    return @min(clampCurveRadius(requested_radius_m), @min(d1 * 0.45, d2 * 0.45));
}

pub const InvalidReason = enum(u8) {
    none = 0,
    too_few_points = 1,
    segment_too_short = 2,
    curve_too_tight = 3,
};

pub const Validation = struct {
    valid: bool,
    reason: InvalidReason,
    /// Smallest effective turning reach. Infinity means the path is straight.
    min_curve_m: f32,
};

pub fn validate(path: Path) Validation {
    if (path.points.len < 2) return .{ .valid = false, .reason = .too_few_points, .min_curve_m = 0 };
    for (path.points[0 .. path.points.len - 1], path.points[1..]) |a, b| {
        if (std.math.hypot(b.gx - a.gx, b.gz - a.gz) < TUNING.min_segment_m) {
            return .{ .valid = false, .reason = .segment_too_short, .min_curve_m = 0 };
        }
    }

    var min_curve = std.math.inf(f32);
    if (path.points.len >= 3) {
        var i: usize = 1;
        while (i + 1 < path.points.len) : (i += 1) {
            if (turnReach(path.points[i - 1], path.points[i], path.points[i + 1], path.curve_radius_m)) |reach| {
                min_curve = @min(min_curve, reach);
            }
        }
    }

    const required = switch (kindOf(path.profile)) {
        .road => 0,
        .light_rail => TUNING.light_rail_min_curve_m,
        .railway => TUNING.railway_min_curve_m,
    };
    if (min_curve < required) {
        return .{ .valid = false, .reason = .curve_too_tight, .min_curve_m = min_curve };
    }
    return .{ .valid = true, .reason = .none, .min_curve_m = min_curve };
}

/// Expand the editable point wire into the curve both preview and compilers
/// consume. Endpoints are stable; each real turn becomes a quadratic fillet.
pub fn curvePoints(points: []const Point, radius_m: f32, out: []Point) usize {
    if (points.len == 0 or out.len == 0) return 0;
    if (points.len < 3 or radius_m <= 0) {
        const count = @min(points.len, out.len);
        @memcpy(out[0..count], points[0..count]);
        return count;
    }

    var count: usize = 0;
    out[count] = points[0];
    count += 1;
    var i: usize = 1;
    while (i + 1 < points.len and count < out.len) : (i += 1) {
        const a = points[i - 1];
        const vertex = points[i];
        const b = points[i + 1];
        const d1 = std.math.hypot(vertex.gx - a.gx, vertex.gz - a.gz);
        const d2 = std.math.hypot(b.gx - vertex.gx, b.gz - vertex.gz);
        const reach = turnReach(a, vertex, b, radius_m);
        if (reach == null or reach.? < TUNING.min_segment_m or d1 == 0 or d2 == 0) {
            out[count] = vertex;
            count += 1;
            continue;
        }

        const r = reach.?;
        const u1x = (vertex.gx - a.gx) / d1;
        const u1z = (vertex.gz - a.gz) / d1;
        const u2x = (b.gx - vertex.gx) / d2;
        const u2z = (b.gz - vertex.gz) / d2;
        const p1 = Point{ .gx = vertex.gx - u1x * r, .gz = vertex.gz - u1z * r };
        const p2 = Point{ .gx = vertex.gx + u2x * r, .gz = vertex.gz + u2z * r };
        const wanted: usize = @intFromFloat(@ceil(r * TUNING.curve_samples_per_meter));
        const samples = std.math.clamp(wanted, 4, TUNING.max_curve_samples_per_corner);
        var sample: usize = 0;
        while (sample <= samples and count < out.len) : (sample += 1) {
            const t = @as(f32, @floatFromInt(sample)) / @as(f32, @floatFromInt(samples));
            const omt = 1 - t;
            out[count] = .{
                .gx = omt * omt * p1.gx + 2 * omt * t * vertex.gx + t * t * p2.gx,
                .gz = omt * omt * p1.gz + 2 * omt * t * vertex.gz + t * t * p2.gz,
            };
            count += 1;
        }
    }
    if (count < out.len) {
        out[count] = points[points.len - 1];
        count += 1;
    }
    return count;
}

const Slot = struct {
    used: bool = false,
    id: u32 = 0,
    profile: Profile = .{ .road = .{} },
    curve_radius_m: f32 = TUNING.default_road_curve_radius_m,
    count: usize = 0,
    points: [MAX_POINTS_PER_PATH]Point = undefined,
};

var g_paths: [MAX_PATHS]Slot = @splat(.{});
var g_next_id: u32 = 1;
var g_draft: Slot = .{};
var g_draft_active = false;
var g_draft_hover: ?Point = null;
var g_preview_points: [MAX_POINTS_PER_PATH + 1]Point = undefined;
var g_committed_revision: u64 = 1;
var g_draft_revision: u64 = 1;

fn bumpCommitted() void {
    g_committed_revision +%= 1;
    if (g_committed_revision == 0) g_committed_revision = 1;
}

fn bumpDraft() void {
    g_draft_revision +%= 1;
    if (g_draft_revision == 0) g_draft_revision = 1;
}

pub fn committedRevision() u64 {
    return g_committed_revision;
}

pub fn draftRevision() u64 {
    return g_draft_revision;
}

pub fn clearAll() void {
    for (&g_paths) |*slot| slot.used = false;
    g_next_id = 1;
    g_draft_active = false;
    g_draft_hover = null;
    bumpCommitted();
    bumpDraft();
}

pub fn beginDraft(profile: Profile, curve_radius_m: f32) void {
    g_draft = .{
        .used = true,
        .profile = clampProfile(profile),
        .curve_radius_m = clampCurveRadius(curve_radius_m),
        .count = 0,
    };
    g_draft_active = true;
    g_draft_hover = null;
    bumpDraft();
}

pub fn updateDraftProfile(profile: Profile, curve_radius_m: f32) void {
    if (!g_draft_active) return;
    g_draft.profile = clampProfile(profile);
    g_draft.curve_radius_m = clampCurveRadius(curve_radius_m);
    bumpDraft();
}

pub fn draftActive() bool {
    return g_draft_active;
}

pub fn draftKind() ?Kind {
    return if (g_draft_active) kindOf(g_draft.profile) else null;
}

pub fn addDraftPoint(raw: Point) void {
    if (!g_draft_active or g_draft.count >= MAX_POINTS_PER_PATH) return;
    const point = snapPoint(raw.gx, raw.gz);
    if (g_draft.count > 0 and samePoint(g_draft.points[g_draft.count - 1], point)) return;
    g_draft.points[g_draft.count] = point;
    g_draft.count += 1;
    g_draft_hover = null;
    bumpDraft();
}

pub fn setDraftHover(raw: Point) void {
    if (!g_draft_active or g_draft.count == 0) return;
    const point = snapPoint(raw.gx, raw.gz);
    const next: ?Point = if (samePoint(g_draft.points[g_draft.count - 1], point)) null else point;
    if (g_draft_hover == null and next == null) return;
    if (g_draft_hover != null and next != null and samePoint(g_draft_hover.?, next.?)) return;
    g_draft_hover = next;
    bumpDraft();
}

pub fn clearDraftHover() void {
    if (g_draft_hover == null) return;
    g_draft_hover = null;
    bumpDraft();
}

pub fn undoDraftPoint() bool {
    if (!g_draft_active or g_draft.count == 0) return false;
    g_draft.count -= 1;
    g_draft_hover = null;
    if (g_draft.count == 0) g_draft_active = false;
    bumpDraft();
    return true;
}

pub fn draftPointCount() usize {
    return if (g_draft_active) g_draft.count else 0;
}

pub fn cancelDraft() void {
    if (!g_draft_active and g_draft_hover == null) return;
    g_draft_active = false;
    g_draft_hover = null;
    bumpDraft();
}

pub fn draftPreview() ?Path {
    if (!g_draft_active or g_draft.count == 0) return null;
    @memcpy(g_preview_points[0..g_draft.count], g_draft.points[0..g_draft.count]);
    var count = g_draft.count;
    if (g_draft_hover) |hover| {
        if (count < g_preview_points.len and !samePoint(g_preview_points[count - 1], hover)) {
            g_preview_points[count] = hover;
            count += 1;
        }
    }
    return .{
        .id = 0,
        .points = g_preview_points[0..count],
        .profile = g_draft.profile,
        .curve_radius_m = g_draft.curve_radius_m,
    };
}

pub fn draftValidation() Validation {
    const preview = draftPreview() orelse return .{ .valid = false, .reason = .too_few_points, .min_curve_m = 0 };
    return validate(preview);
}

pub fn commitDraft() ?u32 {
    if (!g_draft_active or g_draft.count < 2) return null;
    const candidate = Path{
        .id = 0,
        .points = g_draft.points[0..g_draft.count],
        .profile = g_draft.profile,
        .curve_radius_m = g_draft.curve_radius_m,
    };
    if (!validate(candidate).valid) return null;
    for (&g_paths) |*slot| {
        if (slot.used) continue;
        slot.* = g_draft;
        slot.id = g_next_id;
        g_next_id += 1;
        g_draft_active = false;
        g_draft_hover = null;
        bumpCommitted();
        bumpDraft();
        return slot.id;
    }
    return null;
}

pub fn deletePath(id: u32) bool {
    for (&g_paths) |*slot| {
        if (!slot.used or slot.id != id) continue;
        slot.used = false;
        bumpCommitted();
        return true;
    }
    return false;
}

pub fn kindForId(id: u32) ?Kind {
    for (&g_paths) |*slot| {
        if (slot.used and slot.id == id) return kindOf(slot.profile);
    }
    return null;
}

pub fn pathCount() usize {
    var count: usize = 0;
    for (&g_paths) |*slot| if (slot.used) {
        count += 1;
    };
    return count;
}

pub fn countKind(kind: Kind) usize {
    var count: usize = 0;
    for (&g_paths) |*slot| if (slot.used and kindOf(slot.profile) == kind) {
        count += 1;
    };
    return count;
}

pub fn railCount() usize {
    return countKind(.light_rail) + countKind(.railway);
}

pub fn lastPathId() u32 {
    return if (g_next_id > 1) g_next_id - 1 else 0;
}

pub fn collectPaths(out: []Path) usize {
    var count: usize = 0;
    for (&g_paths) |*slot| {
        if (!slot.used or count >= out.len) continue;
        out[count] = .{
            .id = slot.id,
            .points = slot.points[0..slot.count],
            .profile = slot.profile,
            .curve_radius_m = slot.curve_radius_m,
        };
        count += 1;
    }
    return count;
}

test "one anchor plus hover produces a live piece without accepting a second point" {
    clearAll();
    defer clearAll();
    beginDraft(.{ .road = .{} }, TUNING.default_road_curve_radius_m);
    addDraftPoint(.{ .gx = 0, .gz = 0 });
    setDraftHover(.{ .gx = 14.12, .gz = 0.11 });
    const preview = draftPreview().?;
    try std.testing.expectEqual(@as(usize, 1), draftPointCount());
    try std.testing.expectEqual(@as(usize, 2), preview.points.len);
    try std.testing.expectApproxEqAbs(@as(f32, 14.0), preview.points[1].gx, 0.001);
    try std.testing.expect(draftValidation().valid);
}

test "curve radius changes the shared preview and compiler curve" {
    const points = [_]Point{ .{ .gx = 0, .gz = 0 }, .{ .gx = 20, .gz = 0 }, .{ .gx = 20, .gz = 20 } };
    var tight: [MAX_CURVE_POINTS]Point = undefined;
    var broad: [MAX_CURVE_POINTS]Point = undefined;
    const tight_count = curvePoints(&points, 3, tight[0..]);
    const broad_count = curvePoints(&points, 12, broad[0..]);
    try std.testing.expect(broad_count > tight_count);
    try std.testing.expect(broad[1].gx < tight[1].gx);
    try std.testing.expectEqual(points[0], broad[0]);
    try std.testing.expectEqual(points[2], broad[broad_count - 1]);
}

test "rail validation rejects an unusably tight turn while roads retain hard-corner freedom" {
    const points = [_]Point{ .{ .gx = 0, .gz = 0 }, .{ .gx = 5, .gz = 0 }, .{ .gx = 5, .gz = 5 } };
    const rail = Path{ .id = 0, .points = &points, .profile = .{ .railway = .{} }, .curve_radius_m = 4 };
    const road = Path{ .id = 0, .points = &points, .profile = .{ .road = .{} }, .curve_radius_m = 0 };
    try std.testing.expectEqual(InvalidReason.curve_too_tight, validate(rail).reason);
    try std.testing.expect(validate(road).valid);
}

test "road and rail paths share ids and storage without sharing compile policy" {
    clearAll();
    defer clearAll();
    beginDraft(.{ .road = .{} }, 8);
    addDraftPoint(.{ .gx = 0, .gz = 0 });
    addDraftPoint(.{ .gx = 20, .gz = 0 });
    try std.testing.expectEqual(@as(u32, 1), commitDraft().?);
    beginDraft(.{ .light_rail = .{ .tracks = 2 } }, 18);
    addDraftPoint(.{ .gx = 0, .gz = 10 });
    addDraftPoint(.{ .gx = 20, .gz = 10 });
    try std.testing.expectEqual(@as(u32, 2), commitDraft().?);
    try std.testing.expectEqual(@as(usize, 2), pathCount());
    try std.testing.expectEqual(@as(usize, 1), countKind(.road));
    try std.testing.expectEqual(@as(usize, 1), railCount());
}
