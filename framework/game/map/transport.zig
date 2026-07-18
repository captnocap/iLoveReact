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
    /// Signed vertical offset from the terrain surface in metres. Authored
    /// anchors use whole storeys; generated curve samples interpolate it.
    elevation_m: f32 = 0,
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

/// A gameplay control attached to the authored path recipe, never to rendered
/// ballast/rail geometry. Train motion consumes the same path-distance sample
/// that the editor uses to draw the marker.
pub const ControlKind = enum(u8) {
    stop = 0,
};

pub const Control = struct {
    id: u32,
    path_id: u32,
    kind: ControlKind = .stop,
    distance_m: f32,
};

pub const PathSample = struct {
    point: Point,
    /// Unit tangent in authored 3D space (elevation rides `elevation_m`).
    tangent: Point,
};

pub const ControlPreview = struct {
    path_id: u32,
    distance_m: f32,
    sample: PathSample,
    valid: bool,
};

/// All behavior-affecting transport authoring values live here. UI presets are
/// merely convenient inputs; this table is the validating authority.
pub const Tuning = struct {
    max_paths: usize,
    max_points_per_path: usize,
    max_controls: usize,
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
    meters_per_level: f32,
    min_level: i32,
    max_level: i32,
    light_rail_max_grade: f32,
    railway_max_grade: f32,
    control_snap_max_m: f32,
    control_distance_snap_m: f32,
    control_min_spacing_m: f32,
};

pub const TUNING = Tuning{
    .max_paths = 128,
    .max_points_per_path = 128,
    .max_controls = 256,
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
    .meters_per_level = 3,
    .min_level = -32,
    .max_level = 128,
    .light_rail_max_grade = 0.09,
    .railway_max_grade = 0.04,
    .control_snap_max_m = 6,
    .control_distance_snap_m = 0.25,
    .control_min_spacing_m = 1,
};

pub const MAX_PATHS: usize = TUNING.max_paths;
pub const MAX_POINTS_PER_PATH: usize = TUNING.max_points_per_path;
pub const MAX_CONTROLS: usize = TUNING.max_controls;
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

pub fn clampLevel(level: i32) i32 {
    return std.math.clamp(level, TUNING.min_level, TUNING.max_level);
}

pub fn elevationForLevel(level: i32) f32 {
    return @as(f32, @floatFromInt(clampLevel(level))) * TUNING.meters_per_level;
}

pub fn snapPointAtLevel(gx: f32, gz: f32, level: i32) Point {
    var point = snapPoint(gx, gz);
    point.elevation_m = elevationForLevel(level);
    return point;
}

fn snapAuthoredPoint(raw: Point) Point {
    var point = snapPoint(raw.gx, raw.gz);
    const min_elevation = elevationForLevel(TUNING.min_level);
    const max_elevation = elevationForLevel(TUNING.max_level);
    point.elevation_m = if (std.math.isFinite(raw.elevation_m))
        std.math.clamp(raw.elevation_m, min_elevation, max_elevation)
    else
        0;
    return point;
}

fn samePoint(a: Point, b: Point) bool {
    return a.gx == b.gx and a.gz == b.gz;
}

fn samePreviewPoint(a: Point, b: Point) bool {
    return samePoint(a, b) and a.elevation_m == b.elevation_m;
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
    grade_too_steep = 4,
};

pub const Validation = struct {
    valid: bool,
    reason: InvalidReason,
    /// Smallest effective turning reach. Infinity means the path is straight.
    min_curve_m: f32,
    /// Steepest rise/run ratio across authored anchors.
    max_grade: f32,
};

pub fn validate(path: Path) Validation {
    if (path.points.len < 2) return .{ .valid = false, .reason = .too_few_points, .min_curve_m = 0, .max_grade = 0 };
    var max_grade: f32 = 0;
    for (path.points[0 .. path.points.len - 1], path.points[1..]) |a, b| {
        const horizontal = std.math.hypot(b.gx - a.gx, b.gz - a.gz);
        if (horizontal < TUNING.min_segment_m) {
            return .{ .valid = false, .reason = .segment_too_short, .min_curve_m = 0, .max_grade = max_grade };
        }
        max_grade = @max(max_grade, @abs(b.elevation_m - a.elevation_m) / horizontal);
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
        return .{ .valid = false, .reason = .curve_too_tight, .min_curve_m = min_curve, .max_grade = max_grade };
    }
    const max_allowed_grade = switch (kindOf(path.profile)) {
        .road => std.math.inf(f32),
        .light_rail => TUNING.light_rail_max_grade,
        .railway => TUNING.railway_max_grade,
    };
    if (max_grade > max_allowed_grade) {
        return .{ .valid = false, .reason = .grade_too_steep, .min_curve_m = min_curve, .max_grade = max_grade };
    }
    return .{ .valid = true, .reason = .none, .min_curve_m = min_curve, .max_grade = max_grade };
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
        const p1_elevation = vertex.elevation_m - (vertex.elevation_m - a.elevation_m) * (r / d1);
        const p2_elevation = vertex.elevation_m + (b.elevation_m - vertex.elevation_m) * (r / d2);
        const wanted: usize = @ceil(r * TUNING.curve_samples_per_meter);
        const samples = std.math.clamp(wanted, 4, TUNING.max_curve_samples_per_corner);
        var sample: usize = 0;
        while (sample <= samples and count < out.len) : (sample += 1) {
            const t = @as(f32, @floatFromInt(sample)) / @as(f32, @floatFromInt(samples));
            const omt = 1 - t;
            out[count] = .{
                .gx = omt * omt * p1.gx + 2 * omt * t * vertex.gx + t * t * p2.gx,
                .gz = omt * omt * p1.gz + 2 * omt * t * vertex.gz + t * t * p2.gz,
                .elevation_m = omt * omt * p1_elevation + 2 * omt * t * vertex.elevation_m + t * t * p2_elevation,
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

const ControlSlot = struct {
    used: bool = false,
    id: u32 = 0,
    path_id: u32 = 0,
    kind: ControlKind = .stop,
    distance_m: f32 = 0,
};

var g_paths: [MAX_PATHS]Slot = @splat(.{});
var g_next_id: u32 = 1;
var g_controls: [MAX_CONTROLS]ControlSlot = @splat(.{});
var g_next_control_id: u32 = 1;
var g_draft: Slot = .{};
var g_draft_active = false;
var g_draft_hover: ?Point = null;
var g_control_hover: ?ControlPreview = null;
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
    for (&g_controls) |*slot| slot.used = false;
    g_next_id = 1;
    g_next_control_id = 1;
    g_draft_active = false;
    g_draft_hover = null;
    g_control_hover = null;
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
    g_control_hover = null;
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

pub fn draftCurveRadius() f32 {
    return if (g_draft_active) g_draft.curve_radius_m else 0;
}

pub fn addDraftPoint(raw: Point) void {
    if (!g_draft_active or g_draft.count >= MAX_POINTS_PER_PATH) return;
    const point = snapAuthoredPoint(raw);
    if (g_draft.count > 0 and samePoint(g_draft.points[g_draft.count - 1], point)) return;
    g_draft.points[g_draft.count] = point;
    g_draft.count += 1;
    g_draft_hover = null;
    bumpDraft();
}

pub fn setDraftHover(raw: Point) void {
    if (!g_draft_active or g_draft.count == 0) return;
    const point = snapAuthoredPoint(raw);
    const next: ?Point = if (samePoint(g_draft.points[g_draft.count - 1], point)) null else point;
    if (g_draft_hover == null and next == null) return;
    if (g_draft_hover != null and next != null and samePreviewPoint(g_draft_hover.?, next.?)) return;
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
    const preview = draftPreview() orelse return .{ .valid = false, .reason = .too_few_points, .min_curve_m = 0, .max_grade = 0 };
    return validate(preview);
}

fn idInUse(id: u32) bool {
    for (&g_paths) |*slot| {
        if (slot.used and slot.id == id) return true;
    }
    return false;
}

fn commitDraftAs(requested_id: ?u32) ?u32 {
    if (!g_draft_active or g_draft.count < 2) return null;
    const candidate = Path{
        .id = 0,
        .points = g_draft.points[0..g_draft.count],
        .profile = g_draft.profile,
        .curve_radius_m = g_draft.curve_radius_m,
    };
    if (!validate(candidate).valid) return null;
    const id = requested_id orelse g_next_id;
    if (id == 0 or idInUse(id)) return null;
    for (&g_paths) |*slot| {
        if (slot.used) continue;
        slot.* = g_draft;
        slot.id = id;
        g_next_id = @max(g_next_id, id +| 1);
        g_draft_active = false;
        g_draft_hover = null;
        bumpCommitted();
        bumpDraft();
        return slot.id;
    }
    return null;
}

pub fn commitDraft() ?u32 {
    return commitDraftAs(null);
}

/// Persistence door: restore the serialized identity so path-attached controls
/// and future semantic references survive a save/load cycle unchanged.
pub fn restoreDraft(id: u32) ?u32 {
    return commitDraftAs(id);
}

pub fn deletePath(id: u32) bool {
    for (&g_paths) |*slot| {
        if (!slot.used or slot.id != id) continue;
        slot.used = false;
        for (&g_controls) |*control| {
            if (control.used and control.path_id == id) control.used = false;
        }
        if (g_control_hover != null and g_control_hover.?.path_id == id) {
            g_control_hover = null;
            bumpDraft();
        }
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

pub fn pathForId(id: u32) ?Path {
    for (&g_paths) |*slot| {
        if (!slot.used or slot.id != id) continue;
        return .{
            .id = slot.id,
            .points = slot.points[0..slot.count],
            .profile = slot.profile,
            .curve_radius_m = slot.curve_radius_m,
        };
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
    var last: u32 = 0;
    for (&g_paths) |*slot| {
        if (slot.used) last = @max(last, slot.id);
    }
    return last;
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

pub fn pathLength(path: Path) f32 {
    var curve: [MAX_CURVE_POINTS]Point = undefined;
    const count = curvePoints(path.points, path.curve_radius_m, curve[0..]);
    var total: f32 = 0;
    if (count < 2) return total;
    var i: usize = 0;
    while (i + 1 < count) : (i += 1) {
        const horizontal = std.math.hypot(curve[i + 1].gx - curve[i].gx, curve[i + 1].gz - curve[i].gz);
        total += std.math.hypot(horizontal, curve[i + 1].elevation_m - curve[i].elevation_m);
    }
    return total;
}

/// Sample the shared curved centerline by distance. This is the deep gameplay
/// boundary: editor markers and train motion never infer a route from meshes.
pub fn samplePath(path: Path, raw_distance_m: f32) ?PathSample {
    var curve: [MAX_CURVE_POINTS]Point = undefined;
    const count = curvePoints(path.points, path.curve_radius_m, curve[0..]);
    if (count < 2) return null;
    const total = pathLengthFromCurve(curve[0..count]);
    const distance_m = std.math.clamp(if (std.math.isFinite(raw_distance_m)) raw_distance_m else 0, 0, total);
    var along: f32 = 0;
    var i: usize = 0;
    while (i + 1 < count) : (i += 1) {
        const a = curve[i];
        const b = curve[i + 1];
        const dx = b.gx - a.gx;
        const dz = b.gz - a.gz;
        const dy = b.elevation_m - a.elevation_m;
        const horizontal = std.math.hypot(dx, dz);
        const length = std.math.hypot(horizontal, dy);
        if (length < 0.0001) continue;
        if (along + length >= distance_m or i + 2 == count) {
            const t = std.math.clamp((distance_m - along) / length, 0, 1);
            return .{
                .point = .{ .gx = a.gx + dx * t, .gz = a.gz + dz * t, .elevation_m = a.elevation_m + dy * t },
                .tangent = .{ .gx = dx / length, .gz = dz / length, .elevation_m = dy / length },
            };
        }
        along += length;
    }
    return null;
}

fn pathLengthFromCurve(curve: []const Point) f32 {
    var total: f32 = 0;
    if (curve.len < 2) return total;
    for (curve[0 .. curve.len - 1], curve[1..]) |a, b| {
        const horizontal = std.math.hypot(b.gx - a.gx, b.gz - a.gz);
        total += std.math.hypot(horizontal, b.elevation_m - a.elevation_m);
    }
    return total;
}

const Projection = struct {
    path_id: u32,
    distance_m: f32,
    separation_sq: f32,
};

fn projectPath(path: Path, raw: Point) ?Projection {
    var curve: [MAX_CURVE_POINTS]Point = undefined;
    const count = curvePoints(path.points, path.curve_radius_m, curve[0..]);
    if (count < 2) return null;
    var best_sq = std.math.inf(f32);
    var best_distance: f32 = 0;
    var along: f32 = 0;
    var i: usize = 0;
    while (i + 1 < count) : (i += 1) {
        const a = curve[i];
        const b = curve[i + 1];
        const dx = b.gx - a.gx;
        const dz = b.gz - a.gz;
        const length_sq = dx * dx + dz * dz;
        if (length_sq < 0.000001) continue;
        const horizontal = @sqrt(length_sq);
        const spatial_length = std.math.hypot(horizontal, b.elevation_m - a.elevation_m);
        const t = std.math.clamp(((raw.gx - a.gx) * dx + (raw.gz - a.gz) * dz) / length_sq, 0, 1);
        const px = a.gx + dx * t;
        const pz = a.gz + dz * t;
        const ex = raw.gx - px;
        const ez = raw.gz - pz;
        const separation_sq = ex * ex + ez * ez;
        if (separation_sq < best_sq) {
            best_sq = separation_sq;
            best_distance = along + spatial_length * t;
        }
        along += spatial_length;
    }
    if (!std.math.isFinite(best_sq)) return null;
    return .{ .path_id = path.id, .distance_m = best_distance, .separation_sq = best_sq };
}

fn controlSpacingValid(path_id: u32, distance_m: f32) bool {
    for (&g_controls) |*slot| {
        if (!slot.used or slot.path_id != path_id) continue;
        if (@abs(slot.distance_m - distance_m) < TUNING.control_min_spacing_m) return false;
    }
    return true;
}

fn nearestRailControl(raw: Point) ?ControlPreview {
    var best: ?Projection = null;
    for (&g_paths) |*slot| {
        if (!slot.used or kindOf(slot.profile) == .road) continue;
        const path = Path{
            .id = slot.id,
            .points = slot.points[0..slot.count],
            .profile = slot.profile,
            .curve_radius_m = slot.curve_radius_m,
        };
        const projected = projectPath(path, raw) orelse continue;
        if (best == null or projected.separation_sq < best.?.separation_sq) best = projected;
    }
    var projected = best orelse return null;
    if (projected.separation_sq > TUNING.control_snap_max_m * TUNING.control_snap_max_m) return null;
    const step = TUNING.control_distance_snap_m;
    projected.distance_m = @round(projected.distance_m / step) * step;
    const path = pathForId(projected.path_id) orelse return null;
    const sample = samplePath(path, projected.distance_m) orelse return null;
    return .{
        .path_id = projected.path_id,
        .distance_m = projected.distance_m,
        .sample = sample,
        .valid = controlSpacingValid(projected.path_id, projected.distance_m),
    };
}

fn sameControlPreview(a: ControlPreview, b: ControlPreview) bool {
    return a.path_id == b.path_id and a.distance_m == b.distance_m and a.valid == b.valid;
}

pub fn setControlHover(raw: Point) void {
    const next = nearestRailControl(raw);
    if (g_control_hover == null and next == null) return;
    if (g_control_hover != null and next != null and sameControlPreview(g_control_hover.?, next.?)) return;
    g_control_hover = next;
    bumpDraft();
}

pub fn clearControlHover() void {
    if (g_control_hover == null) return;
    g_control_hover = null;
    bumpDraft();
}

pub fn controlPreview() ?ControlPreview {
    return g_control_hover;
}

fn controlIdInUse(id: u32) bool {
    for (&g_controls) |*slot| {
        if (slot.used and slot.id == id) return true;
    }
    return false;
}

fn addControlAs(path_id: u32, kind: ControlKind, raw_distance_m: f32, requested_id: ?u32) ?u32 {
    const path = pathForId(path_id) orelse return null;
    if (kindOf(path.profile) == .road) return null;
    const length = pathLength(path);
    if (length < TUNING.min_segment_m or !std.math.isFinite(raw_distance_m)) return null;
    const distance_m = std.math.clamp(raw_distance_m, 0, length);
    if (!controlSpacingValid(path_id, distance_m)) return null;
    const id = requested_id orelse g_next_control_id;
    if (id == 0 or controlIdInUse(id)) return null;
    for (&g_controls) |*slot| {
        if (slot.used) continue;
        slot.* = .{ .used = true, .id = id, .path_id = path_id, .kind = kind, .distance_m = distance_m };
        g_next_control_id = @max(g_next_control_id, id +| 1);
        bumpCommitted();
        return id;
    }
    return null;
}

pub fn commitControlPreview() ?u32 {
    const preview = g_control_hover orelse return null;
    if (!preview.valid) return null;
    const id = addControlAs(preview.path_id, .stop, preview.distance_m, null) orelse return null;
    g_control_hover = null;
    bumpDraft();
    return id;
}

pub fn restoreControl(control: Control) ?u32 {
    return addControlAs(control.path_id, control.kind, control.distance_m, control.id);
}

pub fn deleteControl(id: u32) bool {
    for (&g_controls) |*slot| {
        if (!slot.used or slot.id != id) continue;
        slot.used = false;
        bumpCommitted();
        return true;
    }
    return false;
}

pub fn controlCount() usize {
    var count: usize = 0;
    for (&g_controls) |*slot| if (slot.used) {
        count += 1;
    };
    return count;
}

pub fn lastControlId() u32 {
    var last: u32 = 0;
    for (&g_controls) |*slot| {
        if (slot.used) last = @max(last, slot.id);
    }
    return last;
}

pub fn collectControls(out: []Control) usize {
    var count: usize = 0;
    for (&g_controls) |*slot| {
        if (!slot.used or count >= out.len) continue;
        out[count] = .{ .id = slot.id, .path_id = slot.path_id, .kind = slot.kind, .distance_m = slot.distance_m };
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

test "stop control projects to the shared rail curve and samples one gameplay point" {
    clearAll();
    defer clearAll();
    beginDraft(.{ .light_rail = .{} }, 12);
    addDraftPoint(.{ .gx = 0, .gz = 0 });
    addDraftPoint(.{ .gx = 20, .gz = 0 });
    addDraftPoint(.{ .gx = 20, .gz = 20 });
    const path_id = commitDraft().?;

    setControlHover(.{ .gx = 16, .gz = 2 });
    const preview = controlPreview().?;
    try std.testing.expectEqual(path_id, preview.path_id);
    try std.testing.expect(preview.valid);
    const stop_id = commitControlPreview().?;
    try std.testing.expectEqual(@as(u32, 1), stop_id);

    var controls: [MAX_CONTROLS]Control = undefined;
    try std.testing.expectEqual(@as(usize, 1), collectControls(controls[0..]));
    const sampled = samplePath(pathForId(path_id).?, controls[0].distance_m).?;
    try std.testing.expectApproxEqAbs(preview.sample.point.gx, sampled.point.gx, 0.001);
    try std.testing.expectApproxEqAbs(preview.sample.point.gz, sampled.point.gz, 0.001);
}

test "stop controls reject roads and cascade when their rail path is deleted" {
    clearAll();
    defer clearAll();
    beginDraft(.{ .road = .{} }, 8);
    addDraftPoint(.{ .gx = 0, .gz = 0 });
    addDraftPoint(.{ .gx = 20, .gz = 0 });
    _ = commitDraft().?;
    setControlHover(.{ .gx = 10, .gz = 0 });
    try std.testing.expect(controlPreview() == null);

    beginDraft(.{ .railway = .{} }, 28);
    addDraftPoint(.{ .gx = 0, .gz = 10 });
    addDraftPoint(.{ .gx = 20, .gz = 10 });
    const rail_id = commitDraft().?;
    setControlHover(.{ .gx = 10, .gz = 11 });
    _ = commitControlPreview().?;
    try std.testing.expectEqual(@as(usize, 1), controlCount());
    try std.testing.expect(deletePath(rail_id));
    try std.testing.expectEqual(@as(usize, 0), controlCount());
}

test "signed storey anchors make segment run the grade transition" {
    const gentle = [_]Point{
        .{ .gx = 0, .gz = 0, .elevation_m = 0 },
        .{ .gx = 60, .gz = 0, .elevation_m = elevationForLevel(1) },
    };
    const steep = [_]Point{
        .{ .gx = 0, .gz = 0, .elevation_m = 0 },
        .{ .gx = 20, .gz = 0, .elevation_m = elevationForLevel(1) },
    };
    const gentle_path = Path{ .id = 1, .points = &gentle, .profile = .{ .light_rail = .{} }, .curve_radius_m = 18 };
    const steep_path = Path{ .id = 2, .points = &steep, .profile = .{ .light_rail = .{} }, .curve_radius_m = 18 };
    try std.testing.expect(validate(gentle_path).valid);
    try std.testing.expectApproxEqAbs(@as(f32, 0.05), validate(gentle_path).max_grade, 0.001);
    try std.testing.expectEqual(InvalidReason.grade_too_steep, validate(steep_path).reason);
}
