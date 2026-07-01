// game/map/stamps — the height/tile brush math, ported VERBATIM from the
// TypeScript at cart/hmsc-int/{brush,heightData}.ts (USER ASK req_2473).
//
// PORT DISCIPLINE: field names, tuning values, and control flow mirror the TS
// 1:1 so a stroke painted by the native engine deposits the exact heights the
// old painter would have. Every function here is pure over a FieldView — the
// chunk routing (global sample frame, dirty tracking) lives in engine.zig.

const std = @import("std");
const chunks = @import("chunks.zig");

pub const DOT_M = chunks.DOT_M;
pub const HEIGHT_LIMIT = chunks.HEIGHT_LIMIT;

/// A borrowed window onto one chunk's sample grid (heightData.ts HeightField).
pub const FieldView = struct {
    z: []f32,
    cols: usize,
    rows: usize,
};

// ── the brush footprint (brush.ts) ────────────────────────────────────────────

/// Footprint outline = the distance metric (brush.ts:4): circle Euclidean,
/// square Chebyshev, diamond Manhattan.
pub const BrushShape = enum(u8) { circle = 0, square = 1, diamond = 2 };

pub fn footprintDistance(shape: BrushShape, dx: f32, dy: f32) f32 {
    const ax = @abs(dx);
    const ay = @abs(dy);
    return switch (shape) {
        .square => @max(ax, ay),
        .diamond => ax + ay,
        .circle => std.math.hypot(dx, dy),
    };
}

// ── the height brush (heightData.ts) ──────────────────────────────────────────

/// Cross-section across the footprint (heightData.ts:61): cone linear slope,
/// flat vertical-walled plateau, dome hemispherical cap.
pub const BrushProfile = enum(u8) { cone = 0, flat = 1, dome = 2 };

/// Profile value at normalized distance t (0..1) for a unit peak (heightData.ts:73).
pub fn brushProfile(profile: BrushProfile, t: f32) f32 {
    return switch (profile) {
        .flat => 1,
        .dome => @sqrt(@max(0, 1 - t * t)),
        .cone => 1 - t,
    };
}

pub fn clampHeight(z: f32) f32 {
    return @max(-HEIGHT_LIMIT, @min(HEIGHT_LIMIT, z));
}

pub const StampOpts = struct {
    /// peak height at the brush center, signed (raise vs dig)
    centerZ: f32,
    /// brush radius in meters (where the footprint reaches its edge)
    radiusM: f32,
    shape: BrushShape,
    profile: BrushProfile,
    /// pull cells in range to 0 instead of stamping
    erase: bool = false,
};

/// Stamp a brush centered on sample (cix,ciy): each covered cell is RAISED
/// TOWARD the profile (signed max), never summed — overlapping stamps form the
/// union and painted height equals the set intensity (heightData.ts:89).
pub fn stampBrush(f: FieldView, cix: i32, ciy: i32, opts: StampOpts) void {
    const radiusM = @max(DOT_M, opts.radiusM);
    const rd: i32 = @max(1, @as(i32, @intFromFloat(@ceil(radiusM / DOT_M))));
    const sign: f32 = if (opts.centerZ >= 0) 1 else -1;
    const peak = @abs(opts.centerZ);
    var dy: i32 = -rd;
    while (dy <= rd) : (dy += 1) {
        const jy = ciy + dy;
        if (jy < 0 or jy >= f.rows) continue;
        var dx: i32 = -rd;
        while (dx <= rd) : (dx += 1) {
            const jx = cix + dx;
            if (jx < 0 or jx >= f.cols) continue;
            const dm = footprintDistance(opts.shape, @floatFromInt(dx), @floatFromInt(dy)) * DOT_M;
            if (dm > radiusM) continue;
            const idx = @as(usize, @intCast(jy)) * f.cols + @as(usize, @intCast(jx));
            if (opts.erase) {
                f.z[idx] = 0;
                continue;
            }
            const mag = peak * brushProfile(opts.profile, dm / radiusM);
            if (mag <= 0) continue;
            // Raise toward the signed target: re-stamping / overlap never climbs
            // past centerZ (heightData.ts:106).
            const target = sign * @min(mag, HEIGHT_LIMIT);
            f.z[idx] = if (sign > 0) @max(f.z[idx], target) else @min(f.z[idx], target);
        }
    }
}

pub const RampStampOpts = struct {
    minZ: f32,
    maxZ: f32,
    wideM: f32,
    longM: f32,
    angleDeg: f32,
};

/// Stamp a sloped rectangular plane centered on FRACTIONAL sample (cix,ciy) —
/// ramp drags are world-space lines and rounding per chunk makes shallow ramps
/// wobble against the lattice. The ramp is SET, not raised-toward
/// (heightData.ts:131).
pub fn stampRamp(f: FieldView, cix: f32, ciy: f32, opts: RampStampOpts) void {
    const wideM = @max(DOT_M, opts.wideM);
    const longM = @max(DOT_M, opts.longM);
    const hw = wideM / 2;
    const hl = longM / 2;
    const theta = opts.angleDeg * std.math.pi / 180.0;
    const sx = @sin(theta);
    const sy = @cos(theta);
    const px = @cos(theta);
    const py = -@sin(theta);
    const rd = @ceil(std.math.hypot(hw, hl) / DOT_M) + 1;
    const z0 = clampHeight(opts.minZ);
    const z1 = clampHeight(opts.maxZ);
    const min_x: usize = @intFromFloat(@max(0, @floor(cix - rd)));
    const max_x: usize = @intFromFloat(@min(@as(f32, @floatFromInt(f.cols - 1)), @ceil(cix + rd)));
    const min_y: usize = @intFromFloat(@max(0, @floor(ciy - rd)));
    const max_y: usize = @intFromFloat(@min(@as(f32, @floatFromInt(f.rows - 1)), @ceil(ciy + rd)));
    if (min_x > max_x or min_y > max_y) return;

    var jy = min_y;
    while (jy <= max_y) : (jy += 1) {
        var jx = min_x;
        while (jx <= max_x) : (jx += 1) {
            const mx = (@as(f32, @floatFromInt(jx)) - cix) * DOT_M;
            const my = (@as(f32, @floatFromInt(jy)) - ciy) * DOT_M;
            const along = mx * sx + my * sy;
            const across = mx * px + my * py;
            if (@abs(along) > hl or @abs(across) > hw) continue;
            const t = if (longM <= 0) 0 else (along + hl) / longM;
            f.z[jy * f.cols + jx] = clampHeight(z0 + (z1 - z0) * @max(0, @min(1, t)));
        }
    }
}

pub const SlopeSegmentStampOpts = struct {
    startZ: f32,
    endZ: f32,
    runM: f32,
    distanceStartM: f32,
    radiusM: f32,
    profile: BrushProfile,
    erase: bool = false,
};

/// Grade height at cumulative stroke distance (heightData.ts:187).
pub fn slopeHeightAtDistance(startZ: f32, endZ: f32, runM: f32, distanceM: f32) f32 {
    const run = @max(DOT_M, @abs(runM));
    const t = @max(0, @min(1, distanceM / run));
    return clampHeight(startZ + (endZ - startZ) * t);
}

fn applySignedTarget(f: FieldView, idx: usize, target: f32) void {
    if (target >= 0) {
        f.z[idx] = @max(f.z[idx], target);
    } else {
        f.z[idx] = @min(f.z[idx], target);
    }
}

/// Fill a continuous slope ribbon between two FRACTIONAL sample-space points —
/// each sample's grade distance comes from projecting onto the stroke segment,
/// so a fast drag makes one smooth grade, not a staircase (heightData.ts:215).
/// Returns whether any sample was written.
pub fn stampSlopeSegment(f: FieldView, ax: f32, ay: f32, bx: f32, by: f32, opts: SlopeSegmentStampOpts) bool {
    const radiusM = @max(DOT_M, opts.radiusM);
    const radius_samples = radiusM / DOT_M;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const lenM = @sqrt(len2) * DOT_M;
    const min_x: usize = @intFromFloat(@max(0, @floor(@min(ax, bx) - radius_samples - 1)));
    const max_xf = @min(@as(f32, @floatFromInt(f.cols - 1)), @ceil(@max(ax, bx) + radius_samples + 1));
    const min_y: usize = @intFromFloat(@max(0, @floor(@min(ay, by) - radius_samples - 1)));
    const max_yf = @min(@as(f32, @floatFromInt(f.rows - 1)), @ceil(@max(ay, by) + radius_samples + 1));
    if (max_xf < 0 or max_yf < 0) return false;
    const max_x: usize = @intFromFloat(max_xf);
    const max_y: usize = @intFromFloat(max_yf);
    var touched = false;

    var jy = min_y;
    while (jy <= max_y) : (jy += 1) {
        var jx = min_x;
        while (jx <= max_x) : (jx += 1) {
            const fx: f32 = @floatFromInt(jx);
            const fy: f32 = @floatFromInt(jy);
            const raw_t = if (len2 <= 1e-9) 0 else ((fx - ax) * dx + (fy - ay) * dy) / len2;
            const t = @max(0, @min(1, raw_t));
            const cx = ax + dx * t;
            const cy = ay + dy * t;
            const acrossM = std.math.hypot(fx - cx, fy - cy) * DOT_M;
            if (acrossM > radiusM) continue;
            const idx = jy * f.cols + jx;
            if (opts.erase) {
                f.z[idx] = 0;
                touched = true;
                continue;
            }
            const centerZ = slopeHeightAtDistance(opts.startZ, opts.endZ, opts.runM, opts.distanceStartM + lenM * t);
            const mag = @abs(centerZ) * brushProfile(opts.profile, acrossM / radiusM);
            if (mag <= 0) continue;
            const sign: f32 = if (centerZ >= 0) 1 else -1;
            applySignedTarget(f, idx, sign * @min(mag, HEIGHT_LIMIT));
            touched = true;
        }
    }
    return touched;
}

/// 3×3 determinant for the smooth brush's plane fit (heightData.ts:255).
pub fn det3(
    a00: f32,
    a01: f32,
    a02: f32,
    a10: f32,
    a11: f32,
    a12: f32,
    a20: f32,
    a21: f32,
    a22: f32,
) f32 {
    return a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
}

// ── tests ─────────────────────────────────────────────────────────────────────

fn testField(comptime side: usize, buf: *[side * side]f32) FieldView {
    @memset(buf[0..], 0);
    return .{ .z = buf[0..], .cols = side, .rows = side };
}

test "footprint metrics match the three shapes" {
    try std.testing.expectApproxEqAbs(@as(f32, 5), footprintDistance(.circle, 3, 4), 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 4), footprintDistance(.square, 3, 4), 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 7), footprintDistance(.diamond, 3, 4), 0.0001);
}

test "stampBrush raises toward the profile, never sums" {
    var buf: [21 * 21]f32 = undefined;
    const f = testField(21, &buf);
    const opts = StampOpts{ .centerZ = 8, .radiusM = 2, .shape = .circle, .profile = .cone };
    stampBrush(f, 10, 10, opts);
    const center = f.z[10 * 21 + 10];
    try std.testing.expectApproxEqAbs(@as(f32, 8), center, 0.0001);
    // re-stamping is idempotent (raise-toward, not additive)
    stampBrush(f, 10, 10, opts);
    try std.testing.expectApproxEqAbs(@as(f32, 8), f.z[10 * 21 + 10], 0.0001);
    // cone falls off linearly: 1m out (2 samples) of a 2m radius = half peak
    try std.testing.expectApproxEqAbs(@as(f32, 4), f.z[10 * 21 + 12], 0.0001);
    // erase pulls covered cells to 0
    var erase_opts = opts;
    erase_opts.erase = true;
    stampBrush(f, 10, 10, erase_opts);
    try std.testing.expectApproxEqAbs(@as(f32, 0), f.z[10 * 21 + 10], 0.0001);
}

test "stampBrush digs with negative centerZ via signed min" {
    var buf: [21 * 21]f32 = undefined;
    const f = testField(21, &buf);
    stampBrush(f, 10, 10, .{ .centerZ = -6, .radiusM = 2, .shape = .circle, .profile = .flat });
    try std.testing.expectApproxEqAbs(@as(f32, -6), f.z[10 * 21 + 10], 0.0001);
    // a shallower dig cannot un-dig the deeper one
    stampBrush(f, 10, 10, .{ .centerZ = -2, .radiusM = 2, .shape = .circle, .profile = .flat });
    try std.testing.expectApproxEqAbs(@as(f32, -6), f.z[10 * 21 + 10], 0.0001);
}

test "stampRamp sets the lerped plane along its axis" {
    var buf: [41 * 41]f32 = undefined;
    const f = testField(41, &buf);
    // angle 0 → along = +y (sin 0 = 0, cos 0 = 1): a south-north ramp 4m long, 2m wide
    stampRamp(f, 20, 20, .{ .minZ = 0, .maxZ = 4, .wideM = 2, .longM = 4, .angleDeg = 0 });
    const mid = f.z[20 * 41 + 20];
    try std.testing.expectApproxEqAbs(@as(f32, 2), mid, 0.0001); // center = halfway up
    const lo = f.z[(20 - 4) * 41 + 20]; // 2m toward min end
    const hi = f.z[(20 + 4) * 41 + 20]; // 2m toward max end
    try std.testing.expectApproxEqAbs(@as(f32, 0), lo, 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 4), hi, 0.0001);
    // outside the half-width the plane is untouched
    try std.testing.expectApproxEqAbs(@as(f32, 0), f.z[20 * 41 + 20 + 6], 0.0001);
}

test "stampSlopeSegment grades along the stroke" {
    var buf: [41 * 41]f32 = undefined;
    const f = testField(41, &buf);
    const wrote = stampSlopeSegment(f, 4, 20, 36, 20, .{
        .startZ = 1,
        .endZ = 9,
        .runM = 16, // segment spans exactly the run: (36-4) samples · 0.5m
        .distanceStartM = 0,
        .radiusM = 1,
        .profile = .flat,
    });
    try std.testing.expect(wrote);
    try std.testing.expectApproxEqAbs(@as(f32, 1), f.z[20 * 41 + 4], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 5), f.z[20 * 41 + 20], 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 9), f.z[20 * 41 + 36], 0.001);
}

test "slopeHeightAtDistance clamps to the run and the height limit" {
    try std.testing.expectApproxEqAbs(@as(f32, 5), slopeHeightAtDistance(0, 10, 8, 4), 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 10), slopeHeightAtDistance(0, 10, 8, 99), 0.0001);
    try std.testing.expectApproxEqAbs(HEIGHT_LIMIT, slopeHeightAtDistance(0, 1000, 8, 8), 0.0001);
}
