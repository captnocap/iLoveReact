//! hit_trace — click-time hit-test diagnostic (NAVDEAD-0605).
//!
//! "The button is visually there but clicks land somewhere else." This dumps,
//! for every left mouse-down, the point, the node layout.hitTest picked, and
//! EVERY interactive node whose rect contains the point — in the exact order
//! hitTest checks them (front-most sibling first, children before self). When
//! nothing contains the point it lists the nearest interactive rects instead,
//! which exposes offset rects (visual vs hit mismatch) at a glance.
//!
//! It also flags the click-swallow case: layout.hitTest stops at the
//! front-most node with ANY handler (hover-only counts), but engine.zig only
//! dispatches when the winner is press-capable — a hover-only node sitting on
//! top of a button eats the click with zero feedback.
//!
//! Output always goes to /tmp/reactjit-hit.log (truncated per launch);
//! stderr too when ZIGOS_HIT_TRACE=1 is set (keeps the dev terminal quiet
//! by default — same discipline as GCHITCH-0605's probe cleanup).
//! Event-rate only (one block per click) — never in a per-frame path.

const std = @import("std");
const layout = @import("../layout.zig");
const Node = layout.Node;

const LOG_PATH = "/tmp/reactjit-hit.log";
const MAX_CONTAINS = 24;
const MAX_NEAR = 6;
const NEAR_RADIUS = 400.0; // px — ignore far-away rects in the nearest list

var log_file: ?std.Io.File = null;
var file_init = false;
var stderr_on = false;

const Entry = struct { node: *Node, depth: u32 };
var contains_buf: [MAX_CONTAINS]Entry = undefined;
var contains_n: usize = 0;
var contains_overflow: bool = false;

const Near = struct { node: *Node, dist: f32 };
var near_buf: [MAX_NEAR]Near = undefined;
var near_n: usize = 0;

fn ensureFile(io: std.Io, environ: *const std.process.Environ.Map) void {
    if (file_init) return;
    file_init = true;
    log_file = std.Io.Dir.createFileAbsolute(io, LOG_PATH, .{ .truncate = true }) catch null;
    stderr_on = environ.get("ZIGOS_HIT_TRACE") != null;
}

/// Write one formatted chunk to the log file (and stderr when opted in).
fn out(io: std.Io, comptime fmt: []const u8, args: anytype) void {
    var buf: [1024]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, fmt, args) catch return;
    if (stderr_on) std.Io.File.stderr().writeStreamingAll(io, s) catch {};
    if (log_file) |f| f.writeStreamingAll(io, s) catch {};
}

/// Mirrors layout.zig's private hasHandlers + the href/input/canvas/blocker extras —
/// the set of nodes layout.hitTest can return.
fn interactive(n: *const Node) bool {
    const h = n.handlers;
    return h.on_press != null or h.js_on_press != null or h.lua_on_press != null or
        h.on_mouse_down != null or h.js_on_mouse_down != null or h.lua_on_mouse_down != null or
        h.on_mouse_move != null or h.js_on_mouse_move != null or h.lua_on_mouse_move != null or
        h.on_mouse_up != null or h.js_on_mouse_up != null or h.lua_on_mouse_up != null or
        h.on_hover_enter != null or h.on_hover_exit != null or
        h.js_on_hover_enter != null or h.lua_on_hover_enter != null or
        h.js_on_hover_exit != null or h.lua_on_hover_exit != null or
        h.on_key != null or h.on_change_text != null or h.on_scroll != null or
        h.on_right_click != null or
        n.href != null or n.input_id != null or n.canvas_type != null or
        n.blocks_pointer_events;
}

/// Mirrors engine.zig's hit_is_interactive — the winner only dispatches a
/// left click when this is true. False = the click is swallowed.
fn pressCapable(n: *const Node) bool {
    const h = n.handlers;
    return n.input_id != null or n.href != null or
        h.on_press != null or h.js_on_press != null or h.lua_on_press != null or
        h.on_mouse_down != null or h.js_on_mouse_down != null or h.lua_on_mouse_down != null or
        h.on_mouse_move != null or h.js_on_mouse_move != null or h.lua_on_mouse_move != null or
        h.on_mouse_up != null or h.js_on_mouse_up != null or h.lua_on_mouse_up != null;
}

fn app(buf: []u8, len: *usize, s: []const u8) void {
    const n = @min(s.len, buf.len - len.*);
    @memcpy(buf[len.* .. len.* + n], s[0..n]);
    len.* += n;
}

/// Short comma-list of which handlers/marks this node carries.
fn handlerTags(n: *const Node, buf: []u8) []const u8 {
    const h = n.handlers;
    var len: usize = 0;
    if (h.on_press != null or h.js_on_press != null or h.lua_on_press != null) app(buf, &len, "press,");
    if (h.on_mouse_down != null or h.js_on_mouse_down != null or h.lua_on_mouse_down != null) app(buf, &len, "down,");
    if (h.on_mouse_move != null or h.js_on_mouse_move != null or h.lua_on_mouse_move != null) app(buf, &len, "move,");
    if (h.on_mouse_up != null or h.js_on_mouse_up != null or h.lua_on_mouse_up != null) app(buf, &len, "up,");
    if (h.on_hover_enter != null or h.js_on_hover_enter != null or h.lua_on_hover_enter != null) app(buf, &len, "hoverE,");
    if (h.on_hover_exit != null or h.js_on_hover_exit != null or h.lua_on_hover_exit != null) app(buf, &len, "hoverX,");
    if (h.on_key != null) app(buf, &len, "key,");
    if (h.on_change_text != null) app(buf, &len, "text,");
    if (h.on_scroll != null or h.js_on_scroll != null) app(buf, &len, "scroll,");
    if (h.on_right_click != null) app(buf, &len, "rclick,");
    if (n.href != null) app(buf, &len, "href,");
    if (n.input_id != null) app(buf, &len, "input,");
    if (n.canvas_type != null) app(buf, &len, "canvas,");
    if (n.blocks_pointer_events) app(buf, &len, "block,");
    if (len > 0) len -= 1; // drop trailing comma
    return buf[0..len];
}

/// One readable line for a node: reconciler id, debug/test name, text snippet,
/// computed rect, handler tags.
fn describe(n: *Node, buf: []u8) []const u8 {
    var tag_buf: [160]u8 = undefined;
    const tags = handlerTags(n, &tag_buf);
    const r = n.computed;
    const name: []const u8 = n.debug_name orelse (n.test_id orelse "");
    const txt: []const u8 = if (n.text) |t| t[0..@min(t.len, 24)] else "";
    return std.fmt.bufPrint(
        buf,
        "id={d} name='{s}' text='{s}' rect({d:.0},{d:.0} {d:.0}x{d:.0}) [{s}]",
        .{ n.id, name, txt, r.x, r.y, r.w, r.h, tags },
    ) catch buf[0..0];
}

fn rectDist(r: layout.LayoutRect, x: f32, y: f32) f32 {
    const dx: f32 = if (x < r.x) r.x - x else if (x > r.x + r.w) x - (r.x + r.w) else 0;
    const dy: f32 = if (y < r.y) r.y - y else if (y > r.y + r.h) y - (r.y + r.h) else 0;
    return @sqrt(dx * dx + dy * dy);
}

fn noteNear(node: *Node, dist: f32) void {
    if (dist > NEAR_RADIUS) return;
    var i: usize = 0;
    while (i < near_n) : (i += 1) {
        if (dist < near_buf[i].dist) break;
    }
    if (i >= MAX_NEAR) return;
    var j: usize = @min(near_n, MAX_NEAR - 1);
    while (j > i) : (j -= 1) near_buf[j] = near_buf[j - 1];
    near_buf[i] = .{ .node = node, .dist = dist };
    if (near_n < MAX_NEAR) near_n += 1;
}

/// Same traversal + coordinate rules as layout.hitTest (scroll-clip, scroll
/// offset, reverse child order) — but exhaustive: records every interactive
/// node containing the point instead of stopping at the first.
/// (CRT filter warp is not replicated; a node with filter_name gets a note.)
fn walk(node: *Node, mx: f32, my: f32, depth: u32) void {
    if (node.style.display == .none) return;
    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var cx = mx;
    var cy = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) {
            // hitTest rejects the whole subtree here — still record proximity.
            if (interactive(node)) noteNear(node, rectDist(r, mx, my));
            return;
        }
        cx = mx + node.scroll_x;
        cy = my + node.scroll_y;
    }
    // Canvas guard — mirrors layout.hitTest (NAVDEAD-0605): graph-space
    // children are never screen-coord hit-testable; only Canvas.Clamp
    // children descend. The canvas itself self-matches when in bounds.
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) {
            if (interactive(node)) noteNear(node, rectDist(r, mx, my));
            return;
        }
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) walk(child, cx, cy, depth + 1);
        }
        if (contains_n < MAX_CONTAINS) {
            contains_buf[contains_n] = .{ .node = node, .depth = depth };
            contains_n += 1;
        } else contains_overflow = true;
        return;
    }
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        walk(&node.children[i], cx, cy, depth + 1);
    }
    if (interactive(node)) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            if (contains_n < MAX_CONTAINS) {
                contains_buf[contains_n] = .{ .node = node, .depth = depth };
                contains_n += 1;
            } else contains_overflow = true;
        } else {
            noteNear(node, rectDist(r, mx, my));
        }
    }
}

/// Call once per left mouse-down, right after layout.hitTest.
pub fn trace(io: std.Io, environ: *const std.process.Environ.Map, root: *Node, mx: f32, my: f32, winner: ?*Node) void {
    ensureFile(io, environ);
    contains_n = 0;
    contains_overflow = false;
    near_n = 0;
    walk(root, mx, my, 0);

    var dbuf: [512]u8 = undefined;
    out(io, "[hit] click ({d:.0},{d:.0})\n", .{ mx, my });
    if (winner) |w| {
        out(io, "  winner: {s}\n", .{describe(w, &dbuf)});
        if (!pressCapable(w)) {
            out(io, "  !! winner has NO press/down/up/move handler — engine SWALLOWS this click\n", .{});
        }
        if (w.filter_name != null) out(io, "  !! winner carries filter '{s}' (warp not replicated in trace)\n", .{w.filter_name.?});
    } else {
        out(io, "  winner: NONE\n", .{});
    }
    var k: usize = 0;
    while (k < contains_n) : (k += 1) {
        const e = contains_buf[k];
        out(io, "  in[{d}] depth={d} {s}\n", .{ k, e.depth, describe(e.node, &dbuf) });
    }
    if (contains_overflow) out(io, "  in[...] more than {d} containing nodes — list truncated\n", .{MAX_CONTAINS});
    if (contains_n == 0 or winner == null) {
        if (near_n == 0) {
            out(io, "  nearest: none within {d:.0}px\n", .{NEAR_RADIUS});
        } else {
            var m: usize = 0;
            while (m < near_n) : (m += 1) {
                out(io, "  near[{d}] dist={d:.0} {s}\n", .{ m, near_buf[m].dist, describe(near_buf[m].node, &dbuf) });
            }
        }
    }
}
