//! SVG Path — Parser, GPU-native bezier curves, stroke geometry.
//!
//! Ported from love2d/lua/svg.lua. Supports M L C Q S T A Z commands.
//! Two rendering modes:
//!   - drawStroke: tessellated polylines via gpu.drawRect (legacy, for fills)
//!   - drawStrokeCurves: GPU-native SDF bezier curves (smooth at any zoom)

const std = @import("std");
const gpu = @import("../gpu.zig");
const math = std.math;
const m = @import("../../math/root.zig");

// ── Flattened path output ───────────────────────────────────────────────

const MAX_POINTS = 4096;
const MAX_SUBPATHS = 64;

pub const Subpath = struct {
    points: [MAX_POINTS]f32 = undefined,  // x0,y0,x1,y1,...
    count: u32 = 0,                        // number of floats (count/2 = point count)
    closed: bool = false,
};

pub const Path = struct {
    subpaths: [MAX_SUBPATHS]Subpath = undefined,
    subpath_count: u32 = 0,
    // Curve segments for GPU-native rendering (parallel to flattened subpaths)
    curves: [MAX_CURVE_SEGMENTS]CurveSegment = undefined,
    curve_count: u32 = 0,

    pub fn pointCount(self: *const Path) u32 {
        var total: u32 = 0;
        for (0..self.subpath_count) |i| {
            total += self.subpaths[i].count / 2;
        }
        return total;
    }
};

// ── GPU-native curve segments ─────────────────────────────────────────

const MAX_CURVE_SEGMENTS = 2048;

pub const CurveKind = enum { line, quadratic, cubic };

/// Raw curve segment — stored during parsing, sent to GPU for native rendering.
pub const CurveSegment = struct {
    kind: CurveKind,
    // Start point
    x0: f32,
    y0: f32,
    // Control point 1 (quadratic: the control point; cubic: first control)
    x1: f32 = 0,
    y1: f32 = 0,
    // Control point 2 (cubic only)
    x2: f32 = 0,
    y2: f32 = 0,
    // End point
    x3: f32,
    y3: f32,
};

// ── Bezier tessellation ─────────────────────────────────────────────────

const DEFAULT_TOLERANCE: f32 = 0.5;

/// Flatten a cubic bezier (p0 → p1 → p2 → p3) into line segments.
/// Recursive de Casteljau subdivision until flatness tolerance is met.
fn flattenCubic(sp: *Subpath, x0: f32, y0: f32, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32, tol: f32) void {
    // Flatness test: distance of control points from baseline P0→P3
    const dx = x3 - x0;
    const dy = y3 - y0;
    const d2 = @abs((x1 - x3) * dy - (y1 - y3) * dx);
    const d3 = @abs((x2 - x3) * dy - (y2 - y3) * dx);
    const denom = dx * dx + dy * dy;

    if ((d2 + d3) * (d2 + d3) <= tol * tol * denom) {
        // Flat enough — emit endpoint
        if (sp.count + 2 <= MAX_POINTS) {
            sp.points[sp.count] = x3;
            sp.points[sp.count + 1] = y3;
            sp.count += 2;
        }
        return;
    }

    // Subdivide at midpoint (de Casteljau)
    const x01 = (x0 + x1) * 0.5;
    const y01 = (y0 + y1) * 0.5;
    const x12 = (x1 + x2) * 0.5;
    const y12 = (y1 + y2) * 0.5;
    const x23 = (x2 + x3) * 0.5;
    const y23 = (y2 + y3) * 0.5;
    const x012 = (x01 + x12) * 0.5;
    const y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5;
    const y123 = (y12 + y23) * 0.5;
    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;

    flattenCubic(sp, x0, y0, x01, y01, x012, y012, x0123, y0123, tol);
    flattenCubic(sp, x0123, y0123, x123, y123, x23, y23, x3, y3, tol);
}

/// Flatten a quadratic bezier by elevating to cubic.
fn flattenQuadratic(sp: *Subpath, x0: f32, y0: f32, x1: f32, y1: f32, x2: f32, y2: f32, tol: f32) void {
    // Quadratic → cubic elevation
    const cp1x = x0 + (x1 - x0) * (2.0 / 3.0);
    const cp1y = y0 + (y1 - y0) * (2.0 / 3.0);
    const cp2x = x2 + (x1 - x2) * (2.0 / 3.0);
    const cp2y = y2 + (y1 - y2) * (2.0 / 3.0);
    flattenCubic(sp, x0, y0, cp1x, cp1y, cp2x, cp2y, x2, y2, tol);
}

/// Convert SVG arc to cubic bezier segments, then flatten.
fn flattenArc(sp: *Subpath, x1: f32, y1: f32, rx_in: f32, ry_in: f32, x_rot_deg: f32, large_arc: bool, sweep: bool, x2: f32, y2: f32, tol: f32) void {
    if (rx_in == 0 or ry_in == 0) {
        // Degenerate arc = straight line
        if (sp.count + 2 <= MAX_POINTS) {
            sp.points[sp.count] = x2;
            sp.points[sp.count + 1] = y2;
            sp.count += 2;
        }
        return;
    }

    const rx = @abs(rx_in);
    const ry = @abs(ry_in);
    const phi = x_rot_deg * math.pi / 180.0;
    const cos_phi = @cos(phi);
    const sin_phi = @sin(phi);

    // Step 1: compute (x1', y1')
    const dx2 = (x1 - x2) * 0.5;
    const dy2 = (y1 - y2) * 0.5;
    const x1p = cos_phi * dx2 + sin_phi * dy2;
    const y1p = -sin_phi * dx2 + cos_phi * dy2;

    // Step 2: compute (cx', cy')
    var sq = (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) /
        (rx * rx * y1p * y1p + ry * ry * x1p * x1p);
    if (sq < 0) sq = 0;
    var root = @sqrt(sq);
    if (large_arc == sweep) root = -root;
    const cxp = root * rx * y1p / ry;
    const cyp = -root * ry * x1p / rx;

    // Step 3: compute (cx, cy)
    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;
    const cx = cos_phi * cxp - sin_phi * cyp + mx;
    const cy = sin_phi * cxp + cos_phi * cyp + my;

    // Step 4: compute angles
    const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dtheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep and dtheta > 0) dtheta -= 2.0 * math.pi;
    if (sweep and dtheta < 0) dtheta += 2.0 * math.pi;

    // Step 5: split into ≤90° segments, each approximated by cubic bezier
    const n_segs: u32 = @ceil(@abs(dtheta) / (math.pi / 2.0));
    const seg_angle = dtheta / @as(f32, @floatFromInt(n_segs));
    const alpha = 4.0 * @tan(seg_angle / 4.0) / 3.0;

    var theta = theta1;
    var seg_x = x1;
    var seg_y = y1;
    var seg_i: u32 = 0;
    while (seg_i < n_segs) : (seg_i += 1) {
        const next_theta = theta + seg_angle;
        const cos_t = @cos(theta);
        const sin_t = @sin(theta);
        const cos_nt = @cos(next_theta);
        const sin_nt = @sin(next_theta);

        // Control point 1
        const cp1x_local = rx * (cos_t - alpha * sin_t);
        const cp1y_local = ry * (sin_t + alpha * cos_t);
        // Control point 2
        const cp2x_local = rx * (cos_nt + alpha * sin_nt);
        const cp2y_local = ry * (sin_nt - alpha * cos_nt);
        // Endpoint
        const ex_local = rx * cos_nt;
        const ey_local = ry * sin_nt;

        // Transform back to original coordinate space
        const cp1x = cos_phi * cp1x_local - sin_phi * cp1y_local + cx;
        const cp1y = sin_phi * cp1x_local + cos_phi * cp1y_local + cy;
        const cp2x = cos_phi * cp2x_local - sin_phi * cp2y_local + cx;
        const cp2y = sin_phi * cp2x_local + cos_phi * cp2y_local + cy;
        const ex = cos_phi * ex_local - sin_phi * ey_local + cx;
        const ey = sin_phi * ex_local + cos_phi * ey_local + cy;

        flattenCubic(sp, seg_x, seg_y, cp1x, cp1y, cp2x, cp2y, ex, ey, tol);

        theta = next_theta;
        seg_x = ex;
        seg_y = ey;
    }
}

/// Convert SVG arc to cubic bezier segments and record them for GPU-native stroke rendering.
fn recordArcCubics(path: *Path, x1: f32, y1: f32, rx_in: f32, ry_in: f32, x_rot_deg: f32, large_arc: bool, sweep: bool, x2: f32, y2: f32) void {
    if (rx_in == 0 or ry_in == 0) {
        recordLine(path, x1, y1, x2, y2);
        return;
    }

    const rx = @abs(rx_in);
    const ry = @abs(ry_in);
    const phi = x_rot_deg * math.pi / 180.0;
    const cos_phi = @cos(phi);
    const sin_phi = @sin(phi);

    const dx2 = (x1 - x2) * 0.5;
    const dy2 = (y1 - y2) * 0.5;
    const x1p = cos_phi * dx2 + sin_phi * dy2;
    const y1p = -sin_phi * dx2 + cos_phi * dy2;

    var sq = (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) /
        (rx * rx * y1p * y1p + ry * ry * x1p * x1p);
    if (sq < 0) sq = 0;
    var root = @sqrt(sq);
    if (large_arc == sweep) root = -root;
    const cxp = root * rx * y1p / ry;
    const cyp = -root * ry * x1p / rx;

    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;
    const cx = cos_phi * cxp - sin_phi * cyp + mx;
    const cy = sin_phi * cxp + cos_phi * cyp + my;

    const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dtheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep and dtheta > 0) dtheta -= 2.0 * math.pi;
    if (sweep and dtheta < 0) dtheta += 2.0 * math.pi;

    const n_segs: u32 = @ceil(@abs(dtheta) / (math.pi / 2.0));
    const seg_angle = dtheta / @as(f32, @floatFromInt(n_segs));
    const alpha = 4.0 * @tan(seg_angle / 4.0) / 3.0;

    var theta = theta1;
    var seg_x = x1;
    var seg_y = y1;
    var seg_i: u32 = 0;
    while (seg_i < n_segs) : (seg_i += 1) {
        const next_theta = theta + seg_angle;
        const cos_t = @cos(theta);
        const sin_t = @sin(theta);
        const cos_nt = @cos(next_theta);
        const sin_nt = @sin(next_theta);

        const cp1x_local = rx * (cos_t - alpha * sin_t);
        const cp1y_local = ry * (sin_t + alpha * cos_t);
        const cp2x_local = rx * (cos_nt + alpha * sin_nt);
        const cp2y_local = ry * (sin_nt - alpha * cos_nt);
        const ex_local = rx * cos_nt;
        const ey_local = ry * sin_nt;

        const cp1x = cos_phi * cp1x_local - sin_phi * cp1y_local + cx;
        const cp1y = sin_phi * cp1x_local + cos_phi * cp1y_local + cy;
        const cp2x = cos_phi * cp2x_local - sin_phi * cp2y_local + cx;
        const cp2y = sin_phi * cp2x_local + cos_phi * cp2y_local + cy;
        const ex = cos_phi * ex_local - sin_phi * ey_local + cx;
        const ey = sin_phi * ex_local + cos_phi * ey_local + cy;

        recordCubic(path, seg_x, seg_y, cp1x, cp1y, cp2x, cp2y, ex, ey);

        theta = next_theta;
        seg_x = ex;
        seg_y = ey;
    }
}

fn vecAngle(ux: f32, uy: f32, vx: f32, vy: f32) f32 {
    const dot = ux * vx + uy * vy;
    const len = @sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    var ang = math.acos(@max(-1.0, @min(1.0, dot / @max(len, 1e-10))));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
}

// ── Curve segment recording ──────────────────────────────────────────────

fn recordLine(path: *Path, x0: f32, y0: f32, x1: f32, y1: f32) void {
    if (path.curve_count >= MAX_CURVE_SEGMENTS) return;
    path.curves[path.curve_count] = .{ .kind = .line, .x0 = x0, .y0 = y0, .x3 = x1, .y3 = y1 };
    path.curve_count += 1;
}

fn recordQuadratic(path: *Path, x0: f32, y0: f32, cpx: f32, cpy: f32, x1: f32, y1: f32) void {
    if (path.curve_count >= MAX_CURVE_SEGMENTS) return;
    path.curves[path.curve_count] = .{ .kind = .quadratic, .x0 = x0, .y0 = y0, .x1 = cpx, .y1 = cpy, .x3 = x1, .y3 = y1 };
    path.curve_count += 1;
}

fn recordCubic(path: *Path, x0: f32, y0: f32, cp1x: f32, cp1y: f32, cp2x: f32, cp2y: f32, x1: f32, y1: f32) void {
    if (path.curve_count >= MAX_CURVE_SEGMENTS) return;
    path.curves[path.curve_count] = .{ .kind = .cubic, .x0 = x0, .y0 = y0, .x1 = cp1x, .y1 = cp1y, .x2 = cp2x, .y2 = cp2y, .x3 = x1, .y3 = y1 };
    path.curve_count += 1;
}

// ── Path parser ─────────────────────────────────────────────────────────

/// Parse an SVG path string into flattened polylines.
pub fn parsePath(d: []const u8) Path {
    return parsePathWithTolerance(d, DEFAULT_TOLERANCE);
}

pub fn parsePathWithTolerance(d: []const u8, tol: f32) Path {
    var path = Path{};
    var sp = &path.subpaths[0];
    path.subpath_count = 1;

    var cx: f32 = 0; // current point
    var cy: f32 = 0;
    var sx: f32 = 0; // subpath start (for Z)
    var sy: f32 = 0;
    var last_cp_x: f32 = 0; // last control point (for S/T)
    var last_cp_y: f32 = 0;
    var last_cmd: u8 = 0;

    var pos: usize = 0;
    while (pos < d.len) {
        skipWhitespaceAndCommas(d, &pos);
        if (pos >= d.len) break;

        var cmd = d[pos];
        if (isCommand(cmd)) {
            pos += 1;
        } else if (last_cmd != 0) {
            // Implicit repeat of last command
            cmd = last_cmd;
            // After M, implicit repeats become L
            if (cmd == 'M') cmd = 'L';
            if (cmd == 'm') cmd = 'l';
        } else {
            break;
        }

        switch (cmd) {
            'M' => {
                const px = readNumber(d, &pos) orelse break;
                const py = readNumber(d, &pos) orelse break;
                // Start new subpath
                if (sp.count > 0) {
                    if (path.subpath_count < MAX_SUBPATHS) {
                        path.subpath_count += 1;
                        sp = &path.subpaths[path.subpath_count - 1];
                    }
                }
                sp.points[0] = px;
                sp.points[1] = py;
                sp.count = 2;
                cx = px;
                cy = py;
                sx = px;
                sy = py;
            },
            'm' => {
                const dx2 = readNumber(d, &pos) orelse break;
                const dy2 = readNumber(d, &pos) orelse break;
                cx += dx2;
                cy += dy2;
                if (sp.count > 0 and path.subpath_count < MAX_SUBPATHS) {
                    path.subpath_count += 1;
                    sp = &path.subpaths[path.subpath_count - 1];
                }
                sp.points[0] = cx;
                sp.points[1] = cy;
                sp.count = 2;
                sx = cx;
                sy = cy;
            },
            'L' => {
                const px = readNumber(d, &pos) orelse break;
                const py = readNumber(d, &pos) orelse break;
                if (sp.count + 2 <= MAX_POINTS) {
                    sp.points[sp.count] = px;
                    sp.points[sp.count + 1] = py;
                    sp.count += 2;
                }
                recordLine(&path, cx, cy, px, py);
                cx = px;
                cy = py;
            },
            'l' => {
                const dx2 = readNumber(d, &pos) orelse break;
                const dy2 = readNumber(d, &pos) orelse break;
                const nx = cx + dx2;
                const ny = cy + dy2;
                if (sp.count + 2 <= MAX_POINTS) {
                    sp.points[sp.count] = nx;
                    sp.points[sp.count + 1] = ny;
                    sp.count += 2;
                }
                recordLine(&path, cx, cy, nx, ny);
                cx = nx;
                cy = ny;
            },
            'H' => {
                const px = readNumber(d, &pos) orelse break;
                recordLine(&path, cx, cy, px, cy);
                cx = px;
                if (sp.count + 2 <= MAX_POINTS) {
                    sp.points[sp.count] = cx;
                    sp.points[sp.count + 1] = cy;
                    sp.count += 2;
                }
            },
            'h' => {
                const dx2 = readNumber(d, &pos) orelse break;
                const nx = cx + dx2;
                recordLine(&path, cx, cy, nx, cy);
                cx = nx;
                if (sp.count + 2 <= MAX_POINTS) {
                    sp.points[sp.count] = cx;
                    sp.points[sp.count + 1] = cy;
                    sp.count += 2;
                }
            },
            'V' => {
                const py = readNumber(d, &pos) orelse break;
                recordLine(&path, cx, cy, cx, py);
                cy = py;
                if (sp.count + 2 <= MAX_POINTS) {
                    sp.points[sp.count] = cx;
                    sp.points[sp.count + 1] = cy;
                    sp.count += 2;
                }
            },
            'v' => {
                const dy2 = readNumber(d, &pos) orelse break;
                const ny = cy + dy2;
                recordLine(&path, cx, cy, cx, ny);
                cy = ny;
                if (sp.count + 2 <= MAX_POINTS) {
                    sp.points[sp.count] = cx;
                    sp.points[sp.count + 1] = cy;
                    sp.count += 2;
                }
            },
            'C' => {
                const x1 = readNumber(d, &pos) orelse break;
                const y1 = readNumber(d, &pos) orelse break;
                const x2 = readNumber(d, &pos) orelse break;
                const y2 = readNumber(d, &pos) orelse break;
                const x3 = readNumber(d, &pos) orelse break;
                const y3 = readNumber(d, &pos) orelse break;
                flattenCubic(sp, cx, cy, x1, y1, x2, y2, x3, y3, tol);
                recordCubic(&path, cx, cy, x1, y1, x2, y2, x3, y3);
                last_cp_x = x2;
                last_cp_y = y2;
                cx = x3;
                cy = y3;
            },
            'c' => {
                const x1 = cx + (readNumber(d, &pos) orelse break);
                const y1 = cy + (readNumber(d, &pos) orelse break);
                const x2 = cx + (readNumber(d, &pos) orelse break);
                const y2 = cy + (readNumber(d, &pos) orelse break);
                const x3 = cx + (readNumber(d, &pos) orelse break);
                const y3 = cy + (readNumber(d, &pos) orelse break);
                flattenCubic(sp, cx, cy, x1, y1, x2, y2, x3, y3, tol);
                recordCubic(&path, cx, cy, x1, y1, x2, y2, x3, y3);
                last_cp_x = x2;
                last_cp_y = y2;
                cx = x3;
                cy = y3;
            },
            'S', 's' => {
                // Smooth cubic: reflected control point
                var cp1x = cx + (cx - last_cp_x);
                var cp1y = cy + (cy - last_cp_y);
                if (last_cmd != 'C' and last_cmd != 'c' and last_cmd != 'S' and last_cmd != 's') {
                    cp1x = cx;
                    cp1y = cy;
                }
                const rel = (cmd == 's');
                const x2 = (if (rel) cx else 0) + (readNumber(d, &pos) orelse break);
                const y2 = (if (rel) cy else 0) + (readNumber(d, &pos) orelse break);
                const x3 = (if (rel) cx else 0) + (readNumber(d, &pos) orelse break);
                const y3 = (if (rel) cy else 0) + (readNumber(d, &pos) orelse break);
                flattenCubic(sp, cx, cy, cp1x, cp1y, x2, y2, x3, y3, tol);
                recordCubic(&path, cx, cy, cp1x, cp1y, x2, y2, x3, y3);
                last_cp_x = x2;
                last_cp_y = y2;
                cx = x3;
                cy = y3;
            },
            'Q' => {
                const x1 = readNumber(d, &pos) orelse break;
                const y1 = readNumber(d, &pos) orelse break;
                const x2 = readNumber(d, &pos) orelse break;
                const y2 = readNumber(d, &pos) orelse break;
                flattenQuadratic(sp, cx, cy, x1, y1, x2, y2, tol);
                recordQuadratic(&path, cx, cy, x1, y1, x2, y2);
                last_cp_x = x1;
                last_cp_y = y1;
                cx = x2;
                cy = y2;
            },
            'q' => {
                const x1 = cx + (readNumber(d, &pos) orelse break);
                const y1 = cy + (readNumber(d, &pos) orelse break);
                const x2 = cx + (readNumber(d, &pos) orelse break);
                const y2 = cy + (readNumber(d, &pos) orelse break);
                flattenQuadratic(sp, cx, cy, x1, y1, x2, y2, tol);
                recordQuadratic(&path, cx, cy, x1, y1, x2, y2);
                last_cp_x = x1;
                last_cp_y = y1;
                cx = x2;
                cy = y2;
            },
            'T', 't' => {
                // Smooth quadratic: reflected control point
                var cp1x = cx + (cx - last_cp_x);
                var cp1y = cy + (cy - last_cp_y);
                if (last_cmd != 'Q' and last_cmd != 'q' and last_cmd != 'T' and last_cmd != 't') {
                    cp1x = cx;
                    cp1y = cy;
                }
                const rel = (cmd == 't');
                const x2 = (if (rel) cx else 0) + (readNumber(d, &pos) orelse break);
                const y2 = (if (rel) cy else 0) + (readNumber(d, &pos) orelse break);
                flattenQuadratic(sp, cx, cy, cp1x, cp1y, x2, y2, tol);
                recordQuadratic(&path, cx, cy, cp1x, cp1y, x2, y2);
                last_cp_x = cp1x;
                last_cp_y = cp1y;
                cx = x2;
                cy = y2;
            },
            'A', 'a' => {
                const rel = (cmd == 'a');
                const arx = readNumber(d, &pos) orelse break;
                const ary = readNumber(d, &pos) orelse break;
                const x_rot = readNumber(d, &pos) orelse break;
                const la_f = readNumber(d, &pos) orelse break;
                const sw_f = readNumber(d, &pos) orelse break;
                const ex = (if (rel) cx else 0) + (readNumber(d, &pos) orelse break);
                const ey = (if (rel) cy else 0) + (readNumber(d, &pos) orelse break);
                flattenArc(sp, cx, cy, arx, ary, x_rot, la_f > 0.5, sw_f > 0.5, ex, ey, tol);
                recordArcCubics(&path, cx, cy, arx, ary, x_rot, la_f > 0.5, sw_f > 0.5, ex, ey);
                cx = ex;
                cy = ey;
            },
            'Z', 'z' => {
                sp.closed = true;
                if (cx != sx or cy != sy) {
                    recordLine(&path, cx, cy, sx, sy);
                }
                cx = sx;
                cy = sy;
            },
            else => {},
        }
        last_cmd = cmd;
    }

    return path;
}

// ── Filled path rendering (ear-clipping tessellation) ─────────────────
//
// Non-convex-safe polygon tessellation. For each subpath we build an index
// list, normalize winding to CCW (positive shoelace area in a Y-down system
// means the polygon is drawn with mathematical winding reversed — we flip to
// a consistent CCW order before clipping), then repeatedly remove "ears":
// vertices whose triangle (prev, curr, next) is (a) convex and (b) contains
// no other polygon vertex. The ear triangle is emitted via `emit(a,b,c)` and
// the vertex is removed. O(n²) in vertex count — fine for icon-scale polygons.
//
// Subpaths are tessellated independently; this produces the correct visual for
// disjoint subpaths (e.g. OpenAI's 6 petals). Truly nested holes would need
// bridging — brand icons in the Lobe set don't use them so we don't either.

const MAX_POLY_VERTS = MAX_POINTS / 2;

const TriEmitContext = struct {
    ctx: *anyopaque,
    emit: *const fn (ctx: *anyopaque, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) void,
};

fn polygonSignedArea(sp: *const Subpath) f32 {
    var area: f32 = 0;
    const n = sp.count / 2;
    if (n < 3) return 0;
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const j: u32 = (i + 1) % n;
        const xi = sp.points[i * 2];
        const yi = sp.points[i * 2 + 1];
        const xj = sp.points[j * 2];
        const yj = sp.points[j * 2 + 1];
        area += xi * yj - xj * yi;
    }
    return area * 0.5;
}

/// True if triangle (a→b→c) is on the left side (convex vertex in CCW order).
fn triIsConvex(ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) bool {
    return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 0;
}

fn pointInTri(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) bool {
    // Strictly-inside test — boundary-hits don't reject the ear. Post-bezier
    // flattening produces many near-colinear vertex triples; the inclusive
    // version of this test was rejecting valid ears on curved subpaths when
    // an adjacent vertex landed on a triangle edge within float jitter.
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const all_pos = (d1 > 0) and (d2 > 0) and (d3 > 0);
    const all_neg = (d1 < 0) and (d2 < 0) and (d3 < 0);
    return all_pos or all_neg;
}

/// Ear-clip one subpath, emitting triangles via the callback. Indices into
/// `sp.points` are normalized to CCW before clipping. Guards against infinite
/// loops on malformed geometry.
fn triangulateSubpath(sp: *const Subpath, emit_ctx: TriEmitContext) void {
    const n_pts = sp.count / 2;
    if (n_pts < 3) return;

    var verts: [MAX_POLY_VERTS]u32 = undefined;
    var remaining: u32 = n_pts;

    // Winding fix: triIsConvex returns true for a LEFT turn. Under SVG's
    // Y-down coords, a polygon with positive signed area traces CW on screen
    // (= math-CCW once Y is flipped), which already produces the LEFT turns
    // triIsConvex expects at every convex vertex. A negative-area polygon is
    // the other winding and needs reversing before clipping.
    //
    // Previous version had the inverse condition, so rectangles like a
    // BarChart bar (positive signed area) got reversed into the wrong winding,
    // no candidate vertex passed the convex test, and zero triangles were
    // emitted — fills rendered as empty outlines.
    const area = polygonSignedArea(sp);
    if (area < 0) {
        var i: u32 = 0;
        while (i < n_pts) : (i += 1) verts[i] = n_pts - 1 - i;
    } else {
        var i: u32 = 0;
        while (i < n_pts) : (i += 1) verts[i] = i;
    }

    const pt = struct {
        fn xy(s: *const Subpath, idx: u32) struct { x: f32, y: f32 } {
            return .{ .x = s.points[idx * 2], .y = s.points[idx * 2 + 1] };
        }
    };

    var guard: u32 = 0;
    const guard_limit: u32 = n_pts * n_pts + 4;
    while (remaining > 3) {
        if (guard >= guard_limit) break; // defensive — malformed polygon
        guard += 1;

        var found_ear = false;
        var i: u32 = 0;
        while (i < remaining) : (i += 1) {
            const ia = verts[(i + remaining - 1) % remaining];
            const ib = verts[i];
            const ic = verts[(i + 1) % remaining];
            const a = pt.xy(sp, ia);
            const b = pt.xy(sp, ib);
            const c = pt.xy(sp, ic);
            if (!triIsConvex(a.x, a.y, b.x, b.y, c.x, c.y)) continue; // reflex

            // No other polygon vertex may lie inside the candidate ear.
            var any_inside = false;
            var k: u32 = 0;
            while (k < remaining) : (k += 1) {
                if (k == i or k == (i + remaining - 1) % remaining or k == (i + 1) % remaining) continue;
                const p = pt.xy(sp, verts[k]);
                if (pointInTri(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y)) {
                    any_inside = true;
                    break;
                }
            }
            if (any_inside) continue;

            emit_ctx.emit(emit_ctx.ctx, a.x, a.y, b.x, b.y, c.x, c.y);
            var j: u32 = i;
            while (j + 1 < remaining) : (j += 1) verts[j] = verts[j + 1];
            remaining -= 1;
            found_ear = true;
            break;
        }
        if (!found_ear) {
            // Fallback — no strict ear found (happens on bezier-flattened curves
            // where near-colinear triples defeat either the convex test or the
            // point-in-triangle test). Force-clip at the most-convex vertex so
            // tessellation always makes progress. May produce minor overlap on
            // pathological paths but preserves full coverage.
            var best_i: u32 = 0;
            var best_cross: f32 = -1e30;
            var fi: u32 = 0;
            while (fi < remaining) : (fi += 1) {
                const fia = verts[(fi + remaining - 1) % remaining];
                const fib = verts[fi];
                const fic = verts[(fi + 1) % remaining];
                const fa = pt.xy(sp, fia);
                const fb = pt.xy(sp, fib);
                const fc_pt = pt.xy(sp, fic);
                const cross = (fb.x - fa.x) * (fc_pt.y - fa.y) - (fb.y - fa.y) * (fc_pt.x - fa.x);
                if (cross > best_cross) {
                    best_cross = cross;
                    best_i = fi;
                }
            }
            const ia = verts[(best_i + remaining - 1) % remaining];
            const ib = verts[best_i];
            const ic = verts[(best_i + 1) % remaining];
            const a = pt.xy(sp, ia);
            const b = pt.xy(sp, ib);
            const c = pt.xy(sp, ic);
            emit_ctx.emit(emit_ctx.ctx, a.x, a.y, b.x, b.y, c.x, c.y);
            var j: u32 = best_i;
            while (j + 1 < remaining) : (j += 1) verts[j] = verts[j + 1];
            remaining -= 1;
        }
    }
    if (remaining == 3) {
        const a = pt.xy(sp, verts[0]);
        const b = pt.xy(sp, verts[1]);
        const c = pt.xy(sp, verts[2]);
        emit_ctx.emit(emit_ctx.ctx, a.x, a.y, b.x, b.y, c.x, c.y);
    }
}

const SolidFillCtx = struct {
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    fn emit(opaque_ctx: *anyopaque, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) void {
        const self: *SolidFillCtx = @ptrCast(@alignCast(opaque_ctx));
        gpu.drawTri(ax, ay, bx, by, cx, cy, self.r, self.g, self.b, self.a);
    }
};

/// Fill a closed path with a solid color, using ear-clipping so non-convex
/// paths (e.g. brand logos) render correctly.
pub fn drawFill(path: *const Path, fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32) void {
    var ctx = SolidFillCtx{ .r = fill_r, .g = fill_g, .b = fill_b, .a = fill_a };
    const emit_ctx = TriEmitContext{ .ctx = &ctx, .emit = SolidFillCtx.emit };
    for (0..path.subpath_count) |si| {
        triangulateSubpath(&path.subpaths[si], emit_ctx);
    }
}

const EffectFillCtx = struct {
    pixels: [*]const u8,
    w: u32,
    h: u32,
    bb_x: f32,
    bb_y: f32,
    bb_w: f32,
    bb_h: f32,
    fn emit(opaque_ctx: *anyopaque, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) void {
        const self: *EffectFillCtx = @ptrCast(@alignCast(opaque_ctx));
        const ca = sampleEffect(self.pixels, self.w, self.h, ax, ay, self.bb_x, self.bb_y, self.bb_w, self.bb_h);
        const cb = sampleEffect(self.pixels, self.w, self.h, bx, by, self.bb_x, self.bb_y, self.bb_w, self.bb_h);
        const cc = sampleEffect(self.pixels, self.w, self.h, cx, cy, self.bb_x, self.bb_y, self.bb_w, self.bb_h);
        gpu.drawTriColored(
            ax, ay, ca[0], ca[1], ca[2], ca[3],
            bx, by, cb[0], cb[1], cb[2], cb[3],
            cx, cy, cc[0], cc[1], cc[2], cc[3],
        );
    }
};

/// Fill a closed path sampling per-vertex colors from an effect pixel buffer.
/// Each triangle vertex gets its color from the effect texture at the corresponding
/// graph-space position. The GPU interpolates between vertices (Gouraud shading).
pub fn drawFillFromEffect(
    path: *const Path,
    effect_pixels: [*]const u8,
    effect_w: u32,
    effect_h: u32,
    bb_min_x: f32,
    bb_min_y: f32,
    bb_w: f32,
    bb_h: f32,
) void {
    if (bb_w <= 0 or bb_h <= 0) return;
    var ctx = EffectFillCtx{
        .pixels = effect_pixels,
        .w = effect_w,
        .h = effect_h,
        .bb_x = bb_min_x,
        .bb_y = bb_min_y,
        .bb_w = bb_w,
        .bb_h = bb_h,
    };
    const emit_ctx = TriEmitContext{ .ctx = &ctx, .emit = EffectFillCtx.emit };
    for (0..path.subpath_count) |si| {
        triangulateSubpath(&path.subpaths[si], emit_ctx);
    }
}

const GradientFillCtx = struct {
    x1: f32,
    y1: f32,
    dx: f32,
    dy: f32,
    len_sq: f32,
    stops: []const GradientStopF,
    fn emit(opaque_ctx: *anyopaque, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) void {
        const self: *GradientFillCtx = @ptrCast(@alignCast(opaque_ctx));
        const ca = sampleGradient(ax, ay, self.x1, self.y1, self.dx, self.dy, self.len_sq, self.stops);
        const cb = sampleGradient(bx, by, self.x1, self.y1, self.dx, self.dy, self.len_sq, self.stops);
        const cc = sampleGradient(cx, cy, self.x1, self.y1, self.dx, self.dy, self.len_sq, self.stops);
        gpu.drawTriColored(
            ax, ay, ca[0], ca[1], ca[2], ca[3],
            bx, by, cb[0], cb[1], cb[2], cb[3],
            cx, cy, cc[0], cc[1], cc[2], cc[3],
        );
    }
};

/// Fill a closed path with a linear gradient. Ear-clipped triangulation;
/// each triangle vertex samples `stops` by projection onto the gradient line,
/// and the GPU Gouraud-interpolates across the triangle.
///
/// `stops` must be sorted by `offset` ascending in [0,1]. Endpoints (x1,y1)
/// → (x2,y2) live in the path's own coordinate space, so `setTransform` at
/// the call site handles icon scaling.
pub fn drawFillLinearGradient(
    path: *const Path,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    stops: []const GradientStopF,
) void {
    if (stops.len == 0) return;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len_sq = dx * dx + dy * dy;
    if (len_sq <= 1e-8) return;
    var ctx = GradientFillCtx{
        .x1 = x1,
        .y1 = y1,
        .dx = dx,
        .dy = dy,
        .len_sq = len_sq,
        .stops = stops,
    };
    const emit_ctx = TriEmitContext{ .ctx = &ctx, .emit = GradientFillCtx.emit };
    for (0..path.subpath_count) |si| {
        triangulateSubpath(&path.subpaths[si], emit_ctx);
    }
}

/// Normalized gradient stop in f32 RGBA. Callers translate from the
/// layout.GradientStop representation (u8 Color) at the dispatch site.
pub const GradientStopF = struct {
    offset: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
};

fn sampleGradient(
    px: f32,
    py: f32,
    x1: f32,
    y1: f32,
    dx: f32,
    dy: f32,
    len_sq: f32,
    stops: []const GradientStopF,
) [4]f32 {
    const t_raw = ((px - x1) * dx + (py - y1) * dy) / len_sq;
    const t = if (t_raw < 0) 0.0 else if (t_raw > 1) 1.0 else t_raw;

    if (stops.len == 1) {
        return .{ stops[0].r, stops[0].g, stops[0].b, stops[0].a };
    }
    if (t <= stops[0].offset) {
        return .{ stops[0].r, stops[0].g, stops[0].b, stops[0].a };
    }
    const last = stops[stops.len - 1];
    if (t >= last.offset) {
        return .{ last.r, last.g, last.b, last.a };
    }
    var i: usize = 1;
    while (i < stops.len) : (i += 1) {
        if (t <= stops[i].offset) {
            const a = stops[i - 1];
            const b = stops[i];
            const span = b.offset - a.offset;
            const u = if (span > 1e-6) (t - a.offset) / span else 0.0;
            return .{
                a.r + (b.r - a.r) * u,
                a.g + (b.g - a.g) * u,
                a.b + (b.b - a.b) * u,
                a.a + (b.a - a.a) * u,
            };
        }
    }
    return .{ last.r, last.g, last.b, last.a };
}

/// Sample a color from the effect pixel buffer at a graph-space coordinate.
fn sampleEffect(
    pixels: [*]const u8,
    pw: u32,
    ph: u32,
    gx: f32,
    gy: f32,
    bb_x: f32,
    bb_y: f32,
    bb_w: f32,
    bb_h: f32,
) [4]f32 {
    // Map graph-space → pixel coords
    const u = (gx - bb_x) / bb_w;
    const v = (gy - bb_y) / bb_h;
    const px_i: i32 = @trunc(@max(0, @min(@as(f32, @floatFromInt(pw)) - 1, u * @as(f32, @floatFromInt(pw)))));
    const py_i: i32 = @trunc(@max(0, @min(@as(f32, @floatFromInt(ph)) - 1, v * @as(f32, @floatFromInt(ph)))));
    const px: u32 = @intCast(px_i);
    const py: u32 = @intCast(py_i);
    const idx: usize = @as(usize, py) * @as(usize, pw) * 4 + @as(usize, px) * 4;
    // Effect pixel buffer is RGBA8 in CPU memory.
    return .{
        @as(f32, pixels[idx]) / 255.0,
        @as(f32, pixels[idx + 1]) / 255.0,
        @as(f32, pixels[idx + 2]) / 255.0,
        @as(f32, pixels[idx + 3]) / 255.0,
    };
}

// ── GPU-native curve stroke rendering ─────────────────────────────────

/// Draw a stroked path using GPU-native SDF bezier curves.
/// Smooth at any zoom level — no tessellation artifacts.
/// Lines are drawn as degenerate quadratics (control point at midpoint).
pub fn drawStrokeCurves(path: *const Path, stroke_r: f32, stroke_g: f32, stroke_b: f32, stroke_a: f32, stroke_width: f32, flow_speed: f32, ticks: u32) void {
    // When flow is active, dim the base stroke so the flowing pulse reads
    // as the foreground. At rest (flow_speed == 0), draw full-opacity stroke.
    const flowing = flow_speed != 0;
    const base_a = if (flowing) stroke_a * 0.25 else stroke_a;
    // GPU primitives (drawCurve, drawCubicCurve, drawRect) honor gpu.setTransform
    // internally, so pass raw segment coords through.
    for (0..path.curve_count) |i| {
        const seg = &path.curves[i];
        switch (seg.kind) {
            .line => {
                drawLineSegment(seg.x0, seg.y0, seg.x3, seg.y3, stroke_width, stroke_r, stroke_g, stroke_b, base_a);
            },
            .quadratic => {
                gpu.drawCurve(seg.x0, seg.y0, seg.x1, seg.y1, seg.x3, seg.y3, stroke_r, stroke_g, stroke_b, base_a, stroke_width);
            },
            .cubic => {
                gpu.drawCubicCurve(seg.x0, seg.y0, seg.x1, seg.y1, seg.x2, seg.y2, seg.x3, seg.y3, stroke_r, stroke_g, stroke_b, base_a, stroke_width);
            },
        }
        if (flowing) drawFlowParticles(seg, stroke_r, stroke_g, stroke_b, stroke_a, stroke_width, flow_speed, ticks);
    }
}

// Overlay a small moving glow along the segment. Clean anti-aliased look:
// one bright pulse per segment sliding end-to-end, drawn through the same
// SDF bezier shader as the stroke so it's always smooth.
fn drawFlowParticles(seg: *const CurveSegment, r: f32, g: f32, b: f32, a: f32, stroke_width: f32, flow_speed: f32, ticks: u32) void {
    const pulse_count: u32 = 2;
    const pulse_len: f32 = 0.18; // as fraction of segment
    const seconds = @as(f32, @floatFromInt(ticks)) * 0.001;
    // Positive flow_speed → pulse travels p0→p3, negative → reverse.
    const raw_phase = @mod(seconds * flow_speed * 0.15, 1.0);
    const phase = if (raw_phase < 0) raw_phase + 1.0 else raw_phase;
    var i: u32 = 0;
    while (i < pulse_count) : (i += 1) {
        const center = @mod(phase + @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(pulse_count)), 1.0);
        const t0 = @max(0.0, center - pulse_len * 0.5);
        const t1 = @min(1.0, center + pulse_len * 0.5);
        if (t1 <= t0) continue;
        const edge_fade = @min(center, 1.0 - center) * 6.0;
        const alpha = a * std.math.clamp(edge_fade, 0.0, 1.0);
        const tm = (t0 + t1) * 0.5;
        const p0 = sampleSegment(seg, t0);
        const pm = sampleSegment(seg, tm);
        const p1 = sampleSegment(seg, t1);
        // Bezier control needed to pass through pm at t=0.5
        const cx = 2.0 * pm[0] - 0.5 * (p0[0] + p1[0]);
        const cy = 2.0 * pm[1] - 0.5 * (p0[1] + p1[1]);
        gpu.drawCurve(p0[0], p0[1], cx, cy, p1[0], p1[1], r, g, b, alpha, stroke_width * 2.0);
    }
}

fn sampleSegment(seg: *const CurveSegment, t: f32) [2]f32 {
    switch (seg.kind) {
        .line => return .{ seg.x0 + (seg.x3 - seg.x0) * t, seg.y0 + (seg.y3 - seg.y0) * t },
        .quadratic => {
            const mt = 1.0 - t;
            return .{
                mt * mt * seg.x0 + 2.0 * mt * t * seg.x1 + t * t * seg.x3,
                mt * mt * seg.y0 + 2.0 * mt * t * seg.y1 + t * t * seg.y3,
            };
        },
        .cubic => {
            const mt = 1.0 - t;
            const mt2 = mt * mt;
            const t2 = t * t;
            return .{
                mt2 * mt * seg.x0 + 3.0 * mt2 * t * seg.x1 + 3.0 * mt * t2 * seg.x2 + t2 * t * seg.x3,
                mt2 * mt * seg.y0 + 3.0 * mt2 * t * seg.y1 + 3.0 * mt * t2 * seg.y2 + t2 * t * seg.y3,
            };
        },
    }
}

// ── Legacy stroke rendering (tessellated) ────────────────────────────

/// Draw a stroked path as a series of oriented quads (thin rectangles).
/// Goes through gpu.drawRect, so canvas GPU transform applies automatically.
/// Use drawStrokeCurves instead for smooth rendering.
pub fn drawStroke(path: *const Path, stroke_r: f32, stroke_g: f32, stroke_b: f32, stroke_a: f32, stroke_width: f32) void {
    for (0..path.subpath_count) |si| {
        const sp = &path.subpaths[si];
        if (sp.count < 4) continue; // need at least 2 points

        var pi: u32 = 0;
        while (pi + 2 < sp.count) : (pi += 2) {
            const x0 = sp.points[pi];
            const y0 = sp.points[pi + 1];
            const x1 = sp.points[pi + 2];
            const y1 = sp.points[pi + 3];
            drawLineSegment(x0, y0, x1, y1, stroke_width, stroke_r, stroke_g, stroke_b, stroke_a);
        }

        // Close path: connect last point to first
        if (sp.closed and sp.count >= 4) {
            const lx = sp.points[sp.count - 2];
            const ly = sp.points[sp.count - 1];
            const fx = sp.points[0];
            const fy = sp.points[1];
            drawLineSegment(lx, ly, fx, fy, stroke_width, stroke_r, stroke_g, stroke_b, stroke_a);
        }
    }
}

/// Draw a single line segment as a capsule SDF.
///
/// Capsule = segment (p0→p1) with round caps of radius width/2. Fragment
/// shader computes distance to the segment; fragments past an endpoint clamp
/// to that endpoint and measure a radius → semicircular cap falls out for
/// free.
///
/// Why this replaces the earlier rotated-rect + endpoint-extension approach:
/// round caps at each endpoint are exactly what makes polyline joins look
/// correct at any angle. Two adjacent capsules sharing a vertex each
/// contribute a semicircle there; their union is a full disc that covers
/// the outside wedge of a turn without any CPU-side join math. The old
/// "extend each rect by width/2 so they overlap at joints" trick couldn't
/// fill that wedge at acute angles, which is where the thin-and-dot bug
/// lived.
pub fn drawLineSegment(x0: f32, y0: f32, x1: f32, y1: f32, width: f32, r: f32, g: f32, b: f32, a: f32) void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy < 0.0001 * 0.0001) return;
    gpu.drawCapsule(x0, y0, x1, y1, r, g, b, a, width);
}

// ── Arc-length utilities (for animation) ────────────────────────────────

/// Compute cumulative arc lengths for a subpath.
/// Returns total length.
pub fn arcLength(sp: *const Subpath) f32 {
    if (sp.count < 4) return 0;
    var total: f32 = 0;
    var pi: u32 = 0;
    while (pi + 2 < sp.count) : (pi += 2) {
        const dx = sp.points[pi + 2] - sp.points[pi];
        const dy = sp.points[pi + 3] - sp.points[pi + 1];
        total += m.length2(dx, dy);
    }
    return total;
}

/// Sample a point at parameter t ∈ [0,1] along a subpath (by arc length).
pub fn sampleAt(sp: *const Subpath, t: f32) [2]f32 {
    if (sp.count < 4) return .{ sp.points[0], sp.points[1] };

    const total = arcLength(sp);
    const target = t * total;
    var accum: f32 = 0;
    var pi: u32 = 0;
    while (pi + 2 < sp.count) : (pi += 2) {
        const x0 = sp.points[pi];
        const y0 = sp.points[pi + 1];
        const x1 = sp.points[pi + 2];
        const y1 = sp.points[pi + 3];
        const seg_len = m.length2(x1 - x0, y1 - y0);
        if (accum + seg_len >= target) {
            const frac = if (seg_len > 0) (target - accum) / seg_len else 0;
            return .{ x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac };
        }
        accum += seg_len;
    }
    return .{ sp.points[sp.count - 2], sp.points[sp.count - 1] };
}

/// Get tangent angle at parameter t ∈ [0,1] along a subpath.
pub fn tangentAt(sp: *const Subpath, t: f32) f32 {
    if (sp.count < 4) return 0;

    const total = arcLength(sp);
    const target = t * total;
    var accum: f32 = 0;
    var pi: u32 = 0;
    while (pi + 2 < sp.count) : (pi += 2) {
        const x0 = sp.points[pi];
        const y0 = sp.points[pi + 1];
        const x1 = sp.points[pi + 2];
        const y1 = sp.points[pi + 3];
        const seg_len = m.length2(x1 - x0, y1 - y0);
        if (accum + seg_len >= target) {
            return math.atan2(y1 - y0, x1 - x0);
        }
        accum += seg_len;
    }
    // Return angle of last segment
    const lx0 = sp.points[sp.count - 4];
    const ly0 = sp.points[sp.count - 3];
    const lx1 = sp.points[sp.count - 2];
    const ly1 = sp.points[sp.count - 1];
    return math.atan2(ly1 - ly0, lx1 - lx0);
}

/// Draw a partial stroke up to parameter t ∈ [0,1] (for reveal animation).
pub fn drawStrokePartial(path: *const Path, t: f32, stroke_r: f32, stroke_g: f32, stroke_b: f32, stroke_a: f32, stroke_width: f32) void {
    if (path.subpath_count == 0) return;

    // For simplicity, animate across all subpaths by total arc length
    var total_len: f32 = 0;
    for (0..path.subpath_count) |si| {
        total_len += arcLength(&path.subpaths[si]);
    }

    var target_len = t * total_len;
    for (0..path.subpath_count) |si| {
        const sp = &path.subpaths[si];
        if (sp.count < 4) continue;

        var pi: u32 = 0;
        while (pi + 2 < sp.count) : (pi += 2) {
            const x0 = sp.points[pi];
            const y0 = sp.points[pi + 1];
            const x1 = sp.points[pi + 2];
            const y1 = sp.points[pi + 3];
            const seg_len = m.length2(x1 - x0, y1 - y0);

            if (target_len <= 0) return;

            if (seg_len <= target_len) {
                drawLineSegment(x0, y0, x1, y1, stroke_width, stroke_r, stroke_g, stroke_b, stroke_a);
                target_len -= seg_len;
            } else {
                // Partial segment
                const frac = target_len / seg_len;
                const ex = x0 + (x1 - x0) * frac;
                const ey = y0 + (y1 - y0) * frac;
                drawLineSegment(x0, y0, ex, ey, stroke_width, stroke_r, stroke_g, stroke_b, stroke_a);
                return;
            }
        }
    }
}

var flow_mode: u2 = 2; // 0=off, 1=partial, 2=full

pub fn setFlowMode(mode: u2) void {
    flow_mode = mode;
}

// ── Tokenizer helpers ───────────────────────────────────────────────────

fn isCommand(c: u8) bool {
    return switch (c) {
        'M', 'm', 'L', 'l', 'H', 'h', 'V', 'v',
        'C', 'c', 'S', 's', 'Q', 'q', 'T', 't',
        'A', 'a', 'Z', 'z',
        => true,
        else => false,
    };
}

fn skipWhitespaceAndCommas(d: []const u8, pos: *usize) void {
    while (pos.* < d.len and (d[pos.*] == ' ' or d[pos.*] == ',' or d[pos.*] == '\t' or d[pos.*] == '\n' or d[pos.*] == '\r')) {
        pos.* += 1;
    }
}

fn readNumber(d: []const u8, pos: *usize) ?f32 {
    skipWhitespaceAndCommas(d, pos);
    if (pos.* >= d.len) return null;

    const start = pos.*;
    // Optional sign
    if (pos.* < d.len and (d[pos.*] == '-' or d[pos.*] == '+')) pos.* += 1;
    // Integer part
    while (pos.* < d.len and d[pos.*] >= '0' and d[pos.*] <= '9') pos.* += 1;
    // Decimal part
    if (pos.* < d.len and d[pos.*] == '.') {
        pos.* += 1;
        while (pos.* < d.len and d[pos.*] >= '0' and d[pos.*] <= '9') pos.* += 1;
    }
    // Exponent
    if (pos.* < d.len and (d[pos.*] == 'e' or d[pos.*] == 'E')) {
        pos.* += 1;
        if (pos.* < d.len and (d[pos.*] == '-' or d[pos.*] == '+')) pos.* += 1;
        while (pos.* < d.len and d[pos.*] >= '0' and d[pos.*] <= '9') pos.* += 1;
    }

    if (pos.* == start) return null;
    return std.fmt.parseFloat(f32, d[start..pos.*]) catch null;
}
