//! layout_bench.zig — micro-benchmark for framework/layout.zig.
//!
//! Mirrors the tree shapes from the pilatesjs/pilates bench suite
//! (github.com/pilatesjs/pilates, bench/scenarios/*.ts) so our native
//! flex layout can be compared apples-to-apples against their pure-TS
//! core and yoga-layout (WASM).
//!
//! Build + run:
//!   zig run -OReleaseFast -lc framework/layout_bench.zig
//! (-lc: layout.zig references the C allocator in its style-dup paths.)
//!
//! Each scenario is timed two ways:
//!   build+layout — construct the tree fresh then lay it out (matches what
//!                  pilates' tiny/realistic/stress/big/huge actually time).
//!   layout-only  — pre-built persistent tree, one full layout() pass per
//!                  iteration (matches the hot-relayout pattern; this is the
//!                  pure algorithm number since our layout() has no
//!                  dirty-skip — it re-flows the whole tree every call).

const std = @import("std");
const layout = @import("layout.zig");
const Node = layout.Node;
const Style = layout.Style;

/// A flex:1 child (grow=1, shrink=1, basis=0), matching pilates setFlex(1).
fn flexStyle(dir: layout.FlexDirection) Style {
    return .{ .flex_grow = 1, .flex_shrink = 1, .flex_basis = 0, .flex_direction = dir };
}

// ── Tree builders (arena-allocated) ────────────────────────────────────────
// Each returns the root *Node. Children slices live in the arena.

fn buildTiny(a: std.mem.Allocator) !*Node {
    const COLS = 80;
    const ROWS = 24;
    const CHILDREN = 9;
    const kids = try a.alloc(Node, CHILDREN);
    for (kids) |*c| c.* = .{ .style = .{ .flex_grow = 1, .flex_shrink = 1, .flex_basis = 0 } };
    const root = try a.create(Node);
    root.* = .{ .style = .{
        .flex_direction = .row,
        .width = COLS,
        .height = ROWS,
        .padding = 1,
    }, .children = kids };
    return root;
}

fn buildRealistic(a: std.mem.Allocator) !*Node {
    const COLS = 120;
    const ROWS = 40;
    const CARDS = 6;
    const ROWS_PER_CARD = 6;
    const SIDEBAR_ITEMS = 12;

    // sidebar items (height 1)
    const sidebar_kids = try a.alloc(Node, SIDEBAR_ITEMS);
    for (sidebar_kids) |*it| it.* = .{ .style = .{ .height = 1 } };

    // cards → rows → 3 spans each
    const cards = try a.alloc(Node, CARDS);
    for (cards) |*card| {
        const rows = try a.alloc(Node, ROWS_PER_CARD);
        for (rows) |*row| {
            const spans = try a.alloc(Node, 3);
            for (spans) |*s| s.* = .{ .style = .{ .flex_grow = 1, .flex_shrink = 1, .flex_basis = 0 } };
            row.* = .{ .style = .{ .height = 1, .flex_direction = .row }, .children = spans };
        }
        card.* = .{ .style = .{
            .flex_grow = 1,
            .flex_shrink = 1,
            .flex_basis = 0,
            .flex_direction = .column,
            .margin_bottom = 1,
        }, .children = rows };
    }

    const sidebar = try a.create(Node);
    sidebar.* = .{ .style = .{ .width = 20, .flex_direction = .column }, .children = sidebar_kids };
    const content = try a.create(Node);
    content.* = .{ .style = .{
        .flex_grow = 1,
        .flex_shrink = 1,
        .flex_basis = 0,
        .flex_direction = .column,
        .padding = 1,
    }, .children = cards };

    const body_kids = try a.alloc(Node, 2);
    body_kids[0] = sidebar.*;
    body_kids[1] = content.*;

    const header = Node{ .style = .{ .height = 1 } };
    const body = Node{ .style = .{
        .flex_grow = 1,
        .flex_shrink = 1,
        .flex_basis = 0,
        .flex_direction = .row,
    }, .children = body_kids };

    const root_kids = try a.alloc(Node, 2);
    root_kids[0] = header;
    root_kids[1] = body;
    const root = try a.create(Node);
    root.* = .{ .style = .{ .flex_direction = .column, .width = COLS, .height = ROWS }, .children = root_kids };
    return root;
}

/// The grid scenarios (stress / big / huge): root column of `row_count` rows,
/// each a flex row of `cells_per_row` flex cells.
fn buildGrid(a: std.mem.Allocator, cols: f32, rows_h: f32, row_count: usize, cells_per_row: usize) !*Node {
    const rows = try a.alloc(Node, row_count);
    for (rows) |*row| {
        const cells = try a.alloc(Node, cells_per_row);
        for (cells) |*c| c.* = .{ .style = .{ .flex_grow = 1, .flex_shrink = 1, .flex_basis = 0 } };
        row.* = .{ .style = .{ .flex_grow = 1, .flex_shrink = 1, .flex_basis = 0, .flex_direction = .row }, .children = cells };
    }
    const root = try a.create(Node);
    root.* = .{ .style = .{ .flex_direction = .column, .width = cols, .height = rows_h }, .children = rows };
    return root;
}

/// hot-relayout-boundary variant: rows have explicit height instead of flex.
fn buildGridBoundary(a: std.mem.Allocator, cols: f32, rows_h: f32, row_count: usize, cells_per_row: usize) !*Node {
    const row_h = rows_h / @as(f32, @floatFromInt(row_count));
    const rows = try a.alloc(Node, row_count);
    for (rows) |*row| {
        const cells = try a.alloc(Node, cells_per_row);
        for (cells) |*c| c.* = .{ .style = .{ .flex_grow = 1, .flex_shrink = 1, .flex_basis = 0 } };
        row.* = .{ .style = .{ .height = row_h, .flex_direction = .row }, .children = cells };
    }
    const root = try a.create(Node);
    root.* = .{ .style = .{ .flex_direction = .column, .width = cols, .height = rows_h }, .children = rows };
    return root;
}

// ── Timing ──────────────────────────────────────────────────────────────────

const Stats = struct { median_ns: f64, min_ns: f64, mean_ns: f64, iters: usize };

fn percentileMedian(samples: []u64) f64 {
    std.mem.sort(u64, samples, {}, std.sort.asc(u64));
    const n = samples.len;
    if (n == 0) return 0;
    return if (n % 2 == 1)
        @floatFromInt(samples[n / 2])
    else
        (@as(f64, @floatFromInt(samples[n / 2 - 1])) + @as(f64, @floatFromInt(samples[n / 2]))) / 2.0;
}

/// Time `f` over a warmup window then a measure window. Returns per-call stats.
fn timeIt(
    io: std.Io,
    comptime f: anytype,
    ctx: anytype,
    warmup_ms: u64,
    measure_ms: u64,
    samples: *std.ArrayList(u64),
    gpa: std.mem.Allocator,
) !Stats {
    // Warmup.
    const warm_ns = warmup_ms * std.time.ns_per_ms;
    const warm_start = std.Io.Clock.Timestamp.now(io, .awake);
    while (elapsedNs(warm_start, io) < warm_ns) {
        f(ctx);
    }
    // Measure.
    samples.clearRetainingCapacity();
    const meas_ns = measure_ms * std.time.ns_per_ms;
    var total: u128 = 0;
    const measure_start = std.Io.Clock.Timestamp.now(io, .awake);
    while (elapsedNs(measure_start, io) < meas_ns) {
        const call_start = std.Io.Clock.Timestamp.now(io, .awake);
        f(ctx);
        const dt = elapsedNs(call_start, io);
        try samples.append(gpa, dt);
        total += dt;
    }
    const med = percentileMedian(samples.items);
    return .{
        .median_ns = med,
        .min_ns = @floatFromInt(samples.items[0]),
        .mean_ns = @as(f64, @floatCast(@as(f64, @floatFromInt(@as(u64, @intCast(total)))) / @as(f64, @floatFromInt(samples.items.len)))),
        .iters = samples.items.len,
    };
}

fn elapsedNs(start: std.Io.Clock.Timestamp, io: std.Io) u64 {
    return std.math.lossyCast(u64, @max(0, start.untilNow(io).raw.toNanoseconds()));
}

// Context structs for the timed closures.
const BuildCtx = struct {
    builder: *const fn (std.mem.Allocator) anyerror!*Node,
    cols: f32,
    rows: f32,
};

fn buildAndLayout(ctx: BuildCtx) void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const root = ctx.builder(arena.allocator()) catch unreachable;
    layout.layout(root, 0, 0, ctx.cols, ctx.rows);
}

const LayoutCtx = struct {
    root: *Node,
    cols: f32,
    rows: f32,
    target: ?*Node = null,
    toggle: bool = false,
};

fn layoutOnly(ctx: *LayoutCtx) void {
    if (ctx.target) |t| {
        ctx.toggle = !ctx.toggle;
        t.style.flex_grow = if (ctx.toggle) 1 else 2;
    }
    layout.layout(ctx.root, 0, 0, ctx.cols, ctx.rows);
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const gpa = init.gpa;

    var samples: std.ArrayList(u64) = .empty;
    defer samples.deinit(gpa);

    var stdout_buffer: [4096]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(io, &stdout_buffer);
    const out = &stdout_writer.interface;
    defer stdout_writer.flush() catch {};

    // Persistent arena for the layout-only trees (built once).
    var persist = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer persist.deinit();
    const pa = persist.allocator();

    try out.print("\n  framework/layout.zig micro-bench  (ReleaseFast, native)\n", .{});
    try out.print("  median time per layout pass — lower is better\n\n", .{});
    try out.print("  {s:<22} {s:>12} {s:>12} {s:>12}\n", .{ "scenario", "median", "min", "mean" });
    try out.print("  {s:<22} {s:>12} {s:>12} {s:>12}\n", .{ "--------", "------", "---", "----" });

    const WARM = 400;
    const MEAS = 2500;

    // ---- build+layout scenarios (match pilates tiny/realistic/stress/big/huge) ----
    const BuildScenario = struct { name: []const u8, ctx: BuildCtx };
    const build_scenarios = [_]BuildScenario{
        .{ .name = "tiny (10 nodes)", .ctx = .{ .builder = &buildTiny, .cols = 80, .rows = 24 } },
        .{ .name = "realistic (~100)", .ctx = .{ .builder = &buildRealistic, .cols = 120, .rows = 40 } },
        .{ .name = "stress (~1000)", .ctx = .{ .builder = &buildStress, .cols = 200, .rows = 100 } },
        .{ .name = "big (~5000)", .ctx = .{ .builder = &buildBig, .cols = 400, .rows = 200 } },
        .{ .name = "huge (~10000)", .ctx = .{ .builder = &buildHuge, .cols = 400, .rows = 400 } },
    };

    try out.print("\n  -- build + layout (tree constructed fresh each pass) --\n", .{});
    for (build_scenarios) |s| {
        const st = try timeIt(io, buildAndLayout, s.ctx, WARM, MEAS, &samples, gpa);
        try printRow(out, s.name, st);
    }

    // ---- layout-only (persistent tree, one full re-flow per pass) ----
    try out.print("\n  -- layout-only (persistent tree, full re-flow per pass) --\n", .{});
    {
        const root = try buildTiny(pa);
        var c = LayoutCtx{ .root = root, .cols = 80, .rows = 24 };
        try printRow(out, "tiny (10 nodes)", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }
    {
        const root = try buildRealistic(pa);
        var c = LayoutCtx{ .root = root, .cols = 120, .rows = 40 };
        try printRow(out, "realistic (~100)", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }
    {
        const root = try buildGrid(pa, 200, 100, 50, 20);
        var c = LayoutCtx{ .root = root, .cols = 200, .rows = 100 };
        try printRow(out, "stress (~1000)", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }
    {
        const root = try buildGrid(pa, 400, 200, 50, 100);
        var c = LayoutCtx{ .root = root, .cols = 400, .rows = 200 };
        try printRow(out, "big (~5000)", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }
    {
        const root = try buildGrid(pa, 400, 400, 100, 100);
        var c = LayoutCtx{ .root = root, .cols = 400, .rows = 400 };
        try printRow(out, "huge (~10000)", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }

    // ---- hot-relayout (persistent 1k tree, mutate one leaf flex per pass) ----
    try out.print("\n  -- hot-relayout (1k persistent, mutate one leaf/pass) --\n", .{});
    {
        const root = try buildGrid(pa, 200, 100, 50, 20);
        const target = &root.children[0].children[0];
        var c = LayoutCtx{ .root = root, .cols = 200, .rows = 100, .target = target };
        try printRow(out, "hot-relayout", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }
    {
        const root = try buildGridBoundary(pa, 200, 100, 50, 20);
        const target = &root.children[0].children[0];
        var c = LayoutCtx{ .root = root, .cols = 200, .rows = 100, .target = target };
        try printRow(out, "hot-relayout+boundary", try timeIt(io, layoutOnly, &c, WARM, MEAS, &samples, gpa));
    }

    try out.print("\n", .{});
}

fn printRow(out: anytype, name: []const u8, st: Stats) !void {
    try out.print("  {s:<22} {d:>9.3}µs {d:>9.3}µs {d:>9.3}µs\n", .{
        name,
        st.median_ns / 1000.0,
        st.min_ns / 1000.0,
        st.mean_ns / 1000.0,
    });
}

// Grid builder wrappers so they fit the `fn(Allocator) !*Node` signature.
fn buildStress(a: std.mem.Allocator) !*Node {
    return buildGrid(a, 200, 100, 50, 20);
}
fn buildBig(a: std.mem.Allocator) !*Node {
    return buildGrid(a, 400, 200, 50, 100);
}
fn buildHuge(a: std.mem.Allocator) !*Node {
    return buildGrid(a, 400, 400, 100, 100);
}
