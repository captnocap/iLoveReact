//! border_dash.zig — animated dashed/flowing borders for Box nodes.
//!
//! Ports love2d/lua/stroke_dash.lua into Zig.
//!
//! Pipeline:
//!   1. buildRoundedRectPerimeter → polyline + cumulative distances around
//!      a rounded rectangle. Arcs are flattened into short line segments.
//!   2. emitDashedStroke → walks the polyline with a `[dash, gap]` pattern
//!      plus a phase offset, emitting one `drawLineFn` call per visible dash.
//!      The pattern wraps; advancing `offset` over time produces marching
//!      ants. If `gap == 0`, the whole perimeter is drawn as one continuous
//!      stroke (still useful for `flow_speed > 0` stroke flow particles).
//!
//! The engine feeds `offset = -flow_speed_px_per_sec * elapsed_sec`, so
//! `flow_speed > 0` marches forward, `< 0` reverses, `0` means static dashes.

const std = @import("std");
const m = @import("../../math/root.zig");

pub const MAX_PERIMETER_POINTS = 512;

/// Segments per quarter-circle when flattening a corner arc. 12 keeps a clean
/// curve at typical card sizes (32–200px radii) without stressing MAX_POINTS.
const ARC_SEG: u32 = 12;

pub const Perimeter = struct {
    xs: [MAX_PERIMETER_POINTS]f32 = undefined,
    ys: [MAX_PERIMETER_POINTS]f32 = undefined,
    // cum[i] = cumulative arc length from vertex 0 up to vertex i.
    cum: [MAX_PERIMETER_POINTS]f32 = undefined,
    count: u32 = 0,
    total_length: f32 = 0,
};

/// Build a closed polyline tracing a rounded-rectangle perimeter. Per-corner
/// radii; 0 means square corner. Returns the Perimeter populated with the
/// point positions and cumulative arc lengths. The last sample equals the
/// first so the dash walker doesn't need to special-case closure.
pub fn buildRoundedRectPerimeter(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    tl_in: f32,
    tr_in: f32,
    br_in: f32,
    bl_in: f32,
) Perimeter {
    var p: Perimeter = .{};
    const max_r = @min(w, h) * 0.5;
    const tl = @min(tl_in, max_r);
    const tr = @min(tr_in, max_r);
    const br = @min(br_in, max_r);
    const bl = @min(bl_in, max_r);

    const addPoint = struct {
        fn call(peri: *Perimeter, px: f32, py: f32) void {
            if (peri.count >= MAX_PERIMETER_POINTS) return;
            peri.xs[peri.count] = px;
            peri.ys[peri.count] = py;
            peri.count += 1;
        }
    }.call;

    const addArc = struct {
        fn call(peri: *Perimeter, cx: f32, cy: f32, r: f32, a1: f32, a2: f32) void {
            if (r <= 0) return;
            var i: u32 = 0;
            while (i <= ARC_SEG) : (i += 1) {
                const t = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(ARC_SEG));
                const a = a1 + (a2 - a1) * t;
                addPoint(peri, cx + @cos(a) * r, cy + @sin(a) * r);
            }
        }
    }.call;

    const pi = std.math.pi;

    // Start at top-left after the corner (going clockwise around the rect).
    addPoint(&p, x + tl, y);
    addPoint(&p, x + w - tr, y);
    // Top-right corner: from 270° → 360° (screen-CW in Y-down).
    if (tr > 0) addArc(&p, x + w - tr, y + tr, tr, -pi * 0.5, 0);
    addPoint(&p, x + w, y + h - br);
    if (br > 0) addArc(&p, x + w - br, y + h - br, br, 0, pi * 0.5);
    addPoint(&p, x + bl, y + h);
    if (bl > 0) addArc(&p, x + bl, y + h - bl, bl, pi * 0.5, pi);
    addPoint(&p, x, y + tl);
    if (tl > 0) addArc(&p, x + tl, y + tl, tl, pi, pi * 1.5);
    // Close the loop — duplicating the first point simplifies segment-walk.
    addPoint(&p, x + tl, y);

    // Compute cumulative arc-lengths.
    if (p.count > 0) p.cum[0] = 0;
    var i: u32 = 1;
    while (i < p.count) : (i += 1) {
        const dx = p.xs[i] - p.xs[i - 1];
        const dy = p.ys[i] - p.ys[i - 1];
        p.cum[i] = p.cum[i - 1] + m.length2(dx, dy);
    }
    p.total_length = if (p.count > 0) p.cum[p.count - 1] else 0;
    return p;
}

/// Sample a point at arc-length `s` along the perimeter. Wraps to total_length
/// on overflow so callers can pass s outside [0, total] without clamping.
pub fn sampleAt(peri: *const Perimeter, s_in: f32) struct { x: f32, y: f32 } {
    if (peri.count < 2 or peri.total_length <= 0) return .{ .x = 0, .y = 0 };
    const s = m.wrap(s_in, 0, peri.total_length);
    // Binary search for the segment containing s. Cum is monotonically
    // non-decreasing so this is safe.
    var lo: u32 = 0;
    var hi: u32 = peri.count - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if (peri.cum[mid] <= s) lo = mid else hi = mid;
    }
    const seg_len = peri.cum[hi] - peri.cum[lo];
    const t = if (seg_len > 0) (s - peri.cum[lo]) / seg_len else 0;
    return .{
        .x = peri.xs[lo] + (peri.xs[hi] - peri.xs[lo]) * t,
        .y = peri.ys[lo] + (peri.ys[hi] - peri.ys[lo]) * t,
    };
}

/// Callback-based dashed stroke emitter. Walks `perimeter` with a repeating
/// `[dash_on, dash_off]` pattern (both in px), starting at phase `offset`
/// (also px, wraps mod pattern period). For each visible dash, calls
/// `drawLineFn(ctx, x0, y0, x1, y1)` one or more times, subdivided at the
/// perimeter's own vertex joints so each emitted segment is a straight line.
///
/// If dash_off <= 0, emits the whole perimeter as a single continuous loop
/// (drawn as N segments, one per perimeter edge).
pub fn emitDashedStroke(
    peri: *const Perimeter,
    dash_on_in: f32,
    dash_off_in: f32,
    offset: f32,
    ctx: *anyopaque,
    drawLineFn: *const fn (ctx: *anyopaque, x0: f32, y0: f32, x1: f32, y1: f32) void,
) void {
    if (peri.count < 2 or peri.total_length <= 0) return;

    // Solid case: gap <= 0 → draw every perimeter edge.
    if (dash_off_in <= 0) {
        var i: u32 = 1;
        while (i < peri.count) : (i += 1) {
            drawLineFn(ctx, peri.xs[i - 1], peri.ys[i - 1], peri.xs[i], peri.ys[i]);
        }
        return;
    }

    // Quantize the dash period so an integer number of [on, off] cycles fit
    // the perimeter exactly. Without this, the seam at s=total_length → s=0
    // accumulates a fractional residual that reads as a "stutter" at one
    // corner — dashes pause there for a second or two while the phase walks
    // across the mismatch, then resume on the other side.
    //
    // We scale both on and off by the same factor, preserving their ratio so
    // the visible dash:gap ratio the cart author picked still reads correctly.
    const raw_period = dash_on_in + dash_off_in;
    if (raw_period <= 0) return;
    const n_periods: f32 = @max(1, @round(peri.total_length / raw_period));
    const period = peri.total_length / n_periods;
    const scale = period / raw_period;
    const dash_on = dash_on_in * scale;
    const dash_off = dash_off_in * scale;

    // Normalize starting phase to [0, period). A "dash" begins at phase 0
    // and runs to dash_on; a "gap" fills [dash_on, period).
    var phase = @mod(offset, period);
    if (phase < 0) phase += period;

    // Walk the perimeter vertex-by-vertex. Within each edge (between two
    // perimeter vertices) the dash pattern may start, continue, or finish;
    // subdivide and emit visible portions.
    var s: f32 = 0;
    var in_dash = phase < dash_on;
    var next_event = if (in_dash) dash_on - phase else period - phase;
    var dash_start: f32 = if (in_dash) 0 else -1; // -1 == "not currently drawing"

    var i: u32 = 1;
    while (i < peri.count) : (i += 1) {
        const seg_start_s = s;
        const seg_end_s = s + (peri.cum[i] - peri.cum[i - 1]);
        // Walk events within this edge.
        while (seg_start_s + (next_event) <= seg_end_s) {
            const evt_s = seg_start_s + next_event;
            next_event = 0; // will be reassigned below
            if (in_dash) {
                // End of a dash. Emit from dash_start to evt_s.
                if (dash_start >= 0) emitPolylineSegment(peri, ctx, drawLineFn, dash_start, evt_s);
                dash_start = -1;
                in_dash = false;
                next_event = dash_off;
            } else {
                // Start of a new dash at evt_s.
                dash_start = evt_s;
                in_dash = true;
                next_event = dash_on;
            }
            // Convert next_event from "delta s" to "remaining within this edge"
            // for the loop predicate — but we track s-absolute, so compute as
            // an absolute s threshold for next iteration by re-adding below.
            // Simpler: convert next_event into "s at which next event fires"
            // relative to seg_start_s by replacing `next_event` with
            // (evt_s - seg_start_s) + next_event.
            next_event = (evt_s - seg_start_s) + next_event;
        }
        // Edge ended mid-state; if we're in a dash, extend to the end of edge.
        // Move s forward.
        s = seg_end_s;
        // Subtract the consumed edge length from next_event so it's relative
        // to the next seg_start_s.
        next_event = @max(0, next_event - (seg_end_s - seg_start_s));
    }
    // Close final dash if still open.
    if (in_dash and dash_start >= 0) {
        emitPolylineSegment(peri, ctx, drawLineFn, dash_start, peri.total_length);
    }
}

/// Emit visible dash segments from arc-length `s0` to `s1` along the
/// perimeter, subdividing at each intermediate perimeter vertex so every
/// call to drawLineFn is a straight line.
fn emitPolylineSegment(
    peri: *const Perimeter,
    ctx: *anyopaque,
    drawLineFn: *const fn (ctx: *anyopaque, x0: f32, y0: f32, x1: f32, y1: f32) void,
    s0: f32,
    s1: f32,
) void {
    if (s1 <= s0) return;
    var current_s = s0;
    var current = sampleAt(peri, current_s);

    // Find the first perimeter vertex strictly inside (s0, s1), then iterate.
    var i: u32 = 1;
    while (i < peri.count) : (i += 1) {
        if (peri.cum[i] <= current_s) continue;
        if (peri.cum[i] >= s1) break;
        drawLineFn(ctx, current.x, current.y, peri.xs[i], peri.ys[i]);
        current_s = peri.cum[i];
        current = .{ .x = peri.xs[i], .y = peri.ys[i] };
    }
    const endp = sampleAt(peri, s1);
    drawLineFn(ctx, current.x, current.y, endp.x, endp.y);
}
