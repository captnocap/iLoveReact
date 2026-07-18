//! Behavior tests for framework/game/pathing.zig (V5 capture, P4).
//! These assert BEHAVIOR — routes found/blocked, deterministic plans, lane
//! rules — not signatures. The old v8_bindings_pathing.zig emission and the
//! pathing_lab lane discipline are the behavior references these tests pin.
//!
//! Run: zig build test-game-pathing

const std = @import("std");
const testing = std.testing;
const pathing = @import("game_pathing");

// ── a small road world ───────────────────────────────────────────────────
// 24×16, cell 1m. One horizontal road (rows 5..10) crossing one vertical
// road (cols 12..17), each two 3-tile lane trios per the road grammar:
//   rows 5..7   kind 2  flow -x (westbound, low z)
//   rows 8..10  kind 3  flow +x (eastbound, high z)
//   cols 12..14 kind 4  flow +z (southbound, low x)
//   cols 15..17 kind 5  flow -z (northbound, high x)
// The crossing is junction kind 6 (flow-neutral, CLASS_JUNCTION). A
// crosswalk band (kind 7, flow-neutral) crosses the horizontal road at
// cols 6..7. Everything else is mud (kind 0) — blocked for the vehicle
// profile, open for the walker profile.

const COLS: usize = 24;
const ROWS: usize = 16;

const MUD: u16 = 0;
const LANE_W: u16 = 2;
const LANE_E: u16 = 3;
const LANE_S: u16 = 4;
const LANE_N: u16 = 5;
const JUNCTION: u16 = 6;
const CROSSWALK: u16 = 7;

const VEHICLE: usize = 0;
const WALKER: usize = 1;

fn kindAt(x: usize, z: usize) u16 {
    const h_road = z >= 5 and z <= 10;
    const v_road = x >= 12 and x <= 17;
    if (h_road and v_road) return JUNCTION;
    if (h_road and (x == 6 or x == 7)) return CROSSWALK;
    if (h_road) return if (z <= 7) LANE_W else LANE_E;
    if (v_road) return if (x <= 14) LANE_S else LANE_N;
    return MUD;
}

fn publishRoadWorld() void {
    var kinds: [COLS * ROWS]u16 = undefined;
    for (0..ROWS) |z| {
        for (0..COLS) |x| kinds[z * COLS + x] = kindAt(x, z);
    }
    _ = pathing.setGrid(0, 0, 1, COLS, ROWS, &kinds).?;

    var flows = [_]u8{0} ** 8;
    flows[LANE_W] = 2; // -x
    flows[LANE_E] = 1; // +x
    flows[LANE_S] = 3; // +z
    flows[LANE_N] = 4; // -z
    _ = pathing.setFlows(&flows);

    // vehicle: lanes + junction + crosswalk only; heavy wrong-way penalty
    var vcosts = [_]f32{-1} ** 8;
    vcosts[LANE_W] = 1;
    vcosts[LANE_E] = 1;
    vcosts[LANE_S] = 1;
    vcosts[LANE_N] = 1;
    vcosts[JUNCTION] = 1;
    vcosts[CROSSWALK] = 1;
    try_ok(pathing.setProfile(VEHICLE, 0, 12, 4, &vcosts));

    // walker: everything walkable, roads expensive (jaywalking)
    var wcosts = [_]f32{1} ** 8;
    wcosts[LANE_W] = 12;
    wcosts[LANE_E] = 12;
    wcosts[LANE_S] = 12;
    wcosts[LANE_N] = 12;
    wcosts[JUNCTION] = 12;
    try_ok(pathing.setProfile(WALKER, 0, 1, 1, &wcosts));
}

fn try_ok(ok: bool) void {
    std.debug.assert(ok);
}

fn enableDiscipline() void {
    var classes = [_]u8{0} ** 8;
    classes[JUNCTION] = pathing.CLASS_JUNCTION;
    classes[CROSSWALK] = pathing.CLASS_CROSSWALK;
    _ = pathing.setKindClasses(&classes);
}

const Route = struct { count: usize, xs: [64]f32, zs: [64]f32, generation: f32 };

fn findRoute(profile: usize, sx: f32, sz: f32, gx: f32, gz: f32) Route {
    const buf = pathing.find(profile, sx, sz, gx, gz).?;
    var r = Route{ .count = @trunc(buf[1]), .xs = undefined, .zs = undefined, .generation = buf[0] };
    std.debug.assert(r.count <= 64);
    for (0..r.count) |i| {
        r.xs[i] = buf[2 + i * 2];
        r.zs[i] = buf[3 + i * 2];
    }
    return r;
}

// ── routes: found / blocked / disrupted-by-patch ─────────────────────────

test "path found on an open field, blocked by a wall, reopened by a patch" {
    pathing.clearKindClasses();
    var kinds = [_]u16{1} ** (10 * 10);
    _ = pathing.setGrid(0, 0, 1, 10, 10, &kinds).?;
    var flows = [_]u8{0} ** 2;
    _ = pathing.setFlows(&flows);
    var costs = [_]f32{ -1, 1 }; // kind 0 blocked, kind 1 open
    try_ok(pathing.setProfile(0, 0, 1, 1, &costs));

    var r = findRoute(0, 0.5, 0.5, 9.5, 0.5);
    try testing.expect(r.count >= 2);
    try testing.expectApproxEqAbs(@as(f32, 0.5), r.xs[0], 1e-4);
    try testing.expectApproxEqAbs(@as(f32, 9.5), r.xs[r.count - 1], 1e-4);

    // a full-height wall at x=5 blocks the route entirely
    const gen_before = pathing.generation();
    _ = pathing.patchCells(5, 0, 1, 10, null, 0);
    try testing.expect(pathing.generation() != gen_before); // disruption is visible
    r = findRoute(0, 0.5, 0.5, 9.5, 0.5);
    try testing.expectEqual(@as(usize, 0), r.count);

    // open a gate in the wall — the route threads it
    _ = pathing.patchCells(5, 4, 1, 1, null, 1);
    r = findRoute(0, 0.5, 0.5, 9.5, 0.5);
    try testing.expect(r.count >= 2);
}

test "an unchanged patch does not bump the generation" {
    pathing.clearKindClasses();
    var kinds = [_]u16{1} ** (4 * 4);
    _ = pathing.setGrid(0, 0, 1, 4, 4, &kinds).?;
    const gen = pathing.generation();
    _ = pathing.patchCells(1, 1, 2, 2, null, 1); // same kind — nothing changed
    try testing.expectEqual(gen, pathing.generation());
}

test "routes are deterministic: the same query twice gives identical waypoints" {
    publishRoadWorld();
    pathing.clearKindClasses();
    const a = findRoute(VEHICLE, 1.5, 9.5, 22.5, 9.5);
    const b = findRoute(VEHICLE, 1.5, 9.5, 22.5, 9.5);
    try testing.expectEqual(a.count, b.count);
    for (0..a.count) |i| {
        try testing.expectEqual(a.xs[i], b.xs[i]);
        try testing.expectEqual(a.zs[i], b.zs[i]);
    }
}

test "flow discipline: an eastbound vehicle routes on the eastbound trio" {
    publishRoadWorld();
    pathing.clearKindClasses();
    // start ON the eastbound trio (rows 8..10), drive east across the map
    const r = findRoute(VEHICLE, 1.5, 9.5, 22.5, 9.5);
    try testing.expect(r.count >= 2);
    for (0..r.count) |i| {
        // never strays into the westbound half (rows 5..7 → z < 8)
        try testing.expect(r.zs[i] >= 8.0);
    }
}

// ── lane discipline (the pathing_lab capture) ────────────────────────────

test "trio snap: every flowed waypoint rides its trio's center line" {
    publishRoadWorld();
    enableDiscipline();
    // eastbound trio rows 8..10 → center row 9 → line z = 9.5
    const r = findRoute(VEHICLE, 1.5, 8.5, 10.5, 10.5);
    try testing.expect(r.count >= 1);
    for (0..r.count) |i| {
        if (r.xs[i] < 11.5) { // on the horizontal road, before the junction
            try testing.expectApproxEqAbs(@as(f32, 9.5), r.zs[i], 1e-3);
        }
    }
    pathing.clearKindClasses();
}

test "crosswalk band: the route crosses dead straight on the lane line" {
    publishRoadWorld();
    enableDiscipline();
    // route passes the flow-neutral crosswalk at cols 6..7
    const r = findRoute(VEHICLE, 1.5, 9.5, 10.5, 9.5);
    try testing.expect(r.count >= 2);
    for (0..r.count) |i| {
        try testing.expectApproxEqAbs(@as(f32, 9.5), r.zs[i], 1e-3);
    }
    pathing.clearKindClasses();
}

test "junction: a straight pass stays on its lane line through the box" {
    publishRoadWorld();
    enableDiscipline();
    const r = findRoute(VEHICLE, 1.5, 9.5, 22.5, 9.5);
    try testing.expect(r.count >= 2);
    for (0..r.count) |i| {
        try testing.expectApproxEqAbs(@as(f32, 9.5), r.zs[i], 1e-3);
    }
    pathing.clearKindClasses();
}

test "junction: turns apex at the lane-line intersection — right early, left deep" {
    publishRoadWorld();
    enableDiscipline();

    // RIGHT turn: eastbound (line z=9.5) → southbound (cols 12..14, center
    // col 13 → line x=13.5). Apex must be exactly (13.5, 9.5).
    var r = findRoute(VEHICLE, 1.5, 9.5, 13.5, 14.5);
    var found_right_apex = false;
    for (0..r.count) |i| {
        const in_box = r.xs[i] > 12.0 and r.xs[i] < 18.0 and r.zs[i] > 5.0 and r.zs[i] < 11.0;
        if (!in_box) continue;
        try testing.expectApproxEqAbs(@as(f32, 13.5), r.xs[i], 1e-3);
        try testing.expectApproxEqAbs(@as(f32, 9.5), r.zs[i], 1e-3);
        found_right_apex = true;
    }
    try testing.expect(found_right_apex);

    // LEFT turn: eastbound → northbound (cols 15..17, center col 16 → line
    // x=16.5). Apex (16.5, 9.5) — deeper across the box than the right
    // turn's 13.5, exactly where right-hand traffic belongs.
    r = findRoute(VEHICLE, 1.5, 9.5, 16.5, 1.5);
    var found_left_apex = false;
    for (0..r.count) |i| {
        const in_box = r.xs[i] > 12.0 and r.xs[i] < 18.0 and r.zs[i] > 5.0 and r.zs[i] < 11.0;
        if (!in_box) continue;
        try testing.expectApproxEqAbs(@as(f32, 16.5), r.xs[i], 1e-3);
        try testing.expectApproxEqAbs(@as(f32, 9.5), r.zs[i], 1e-3);
        found_left_apex = true;
    }
    try testing.expect(found_left_apex);
    pathing.clearKindClasses();
}

test "discipline is opt-in: without classes the emission is the legacy one" {
    publishRoadWorld();
    pathing.clearKindClasses();
    // weave start: same query as the trio-snap test — without classes the
    // waypoints stay on raw cell centers (x.5 on whatever rows A* chose),
    // and nothing forces them onto z=9.5
    const r = findRoute(VEHICLE, 1.5, 8.5, 10.5, 10.5);
    try testing.expect(r.count >= 2);
    try testing.expectApproxEqAbs(@as(f32, 8.5), r.zs[0], 1e-4); // start cell center, unsnapped
}

// ── deterministic motion plans ───────────────────────────────────────────

const WALK = pathing.MotionProfile{ .max_speed = 4, .accel = 3, .decel = 5, .min_corner_speed = 1.3 };

var g_plan: [pathing.MAX_PLAN_FLOATS]f64 = undefined;

test "a plan is deterministic, ends at rest at the destination" {
    const pts = [_]f64{ 0, 0, 10, 0, 10, 10 };
    const len = pathing.plan(&pts, 100, 0, WALK, &g_plan).?;
    const p = g_plan[0..len];
    const a = pathing.samplePlan(p, 101.5).?;
    const b = pathing.samplePlan(p, 101.5).?;
    try testing.expectEqual(a.x, b.x); // same t, same sample — exactly
    try testing.expectEqual(a.s, b.s);
    const duration = p[1];
    try testing.expect(duration > 0);
    const end = pathing.samplePlan(p, 100 + duration + 1).?;
    try testing.expect(end.done);
    try testing.expectApproxEqAbs(@as(f64, 0), end.speed, 1e-9);
    try testing.expectApproxEqAbs(@as(f64, 10), end.x, 1e-6);
    try testing.expectApproxEqAbs(@as(f64, 10), end.z, 1e-6);
}

test "a sample before t0 stands at the start; gravity of the schedule is monotone s" {
    const pts = [_]f64{ 0, 0, 20, 0 };
    const len = pathing.plan(&pts, 50, 0, WALK, &g_plan).?;
    const p = g_plan[0..len];
    const before = pathing.samplePlan(p, 0).?;
    try testing.expectApproxEqAbs(@as(f64, 0), before.s, 1e-12);
    var last_s: f64 = -1;
    var t: f64 = 50;
    while (t < 50 + p[1]) : (t += 0.25) {
        const m = pathing.samplePlan(p, t).?;
        try testing.expect(m.s >= last_s); // arc distance never runs backward
        try testing.expect(m.speed <= WALK.max_speed + 1e-9);
        last_s = m.s;
    }
}

test "a hairpin corner slows the plan below cruise speed" {
    // out and back: 180° turn at (10, 0)
    const pts = [_]f64{ 0, 0, 10, 0, 0, 0.5 };
    const len = pathing.plan(&pts, 0, 0, WALK, &g_plan).?;
    const p = g_plan[0..len];
    // sample around the corner arc distance (s = 10)
    var slowest: f64 = WALK.max_speed;
    var t: f64 = 0;
    while (t < p[1]) : (t += 0.05) {
        const m = pathing.samplePlan(p, t).?;
        if (m.s > 9 and m.s < 11) slowest = @min(slowest, m.speed);
    }
    try testing.expect(slowest < WALK.max_speed * 0.6);
    try testing.expect(slowest >= WALK.min_corner_speed - 1e-9);
}

test "an interruption slice starts exactly where the old sample stood" {
    const pts = [_]f64{ 0, 0, 20, 0 };
    const len = pathing.plan(&pts, 0, 0, WALK, &g_plan).?;
    const p = g_plan[0..len];
    const mid = pathing.samplePlan(p, p[1] / 2).?;
    var sliced: [16]f64 = undefined;
    const n = pathing.slicePlanPoints(p, mid.s, std.math.inf(f64), &sliced).?;
    try testing.expect(n >= 2);
    try testing.expectApproxEqAbs(mid.x, sliced[0], 1e-9);
    try testing.expectApproxEqAbs(mid.z, sliced[1], 1e-9);
    // replan from the slice carrying the sampled speed: resumes seamlessly
    var replan_buf: [pathing.MAX_PLAN_FLOATS]f64 = undefined;
    const rlen = pathing.plan(sliced[0 .. n * 2], 99, mid.speed, WALK, &replan_buf).?;
    const resumed = pathing.samplePlan(replan_buf[0..rlen], 99).?;
    try testing.expectApproxEqAbs(mid.speed, resumed.speed, 1e-9);
    try testing.expectApproxEqAbs(mid.x, resumed.x, 1e-9);
}

test "degenerate plans: empty and single-point polylines are safe" {
    const single = [_]f64{ 3, 4 };
    const len = pathing.plan(&single, 0, 0, WALK, &g_plan).?;
    const m = pathing.samplePlan(g_plan[0..len], 5).?;
    try testing.expect(m.done);
    try testing.expectApproxEqAbs(@as(f64, 3), m.x, 1e-12);
    const none = [_]f64{};
    try testing.expect(pathing.plan(&none, 0, 0, WALK, &g_plan) == null);
}
