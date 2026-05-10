//! Node query engine — find nodes by debug_name, test_id, or text content.
//!
//! Walks the node tree recursively. Used by the test harness to locate
//! elements for assertions and input simulation.

const std = @import("std");
const layout = @import("../layout.zig");
const Node = layout.Node;

pub const QueryResult = struct {
    node: *Node,
    x: f32 = 0,
    y: f32 = 0,
    w: f32 = 0,
    h: f32 = 0,
    cx: f32 = 0, // center x
    cy: f32 = 0, // center y
};

pub const QueryOpts = struct {
    debug_name: ?[]const u8 = null,
    test_id: ?[]const u8 = null,
    text: ?[]const u8 = null,
    text_contains: ?[]const u8 = null,
    has_handler: bool = false,
};

fn resultFromNode(node: *Node, scroll_offset_y: f32) QueryResult {
    const r = node.computed;
    return .{
        .node = node,
        .x = r.x,
        .y = r.y - scroll_offset_y,
        .w = r.w,
        .h = r.h,
        .cx = r.x + r.w / 2.0,
        .cy = r.y - scroll_offset_y + r.h / 2.0,
    };
}

fn matches(node: *const Node, opts: QueryOpts) bool {
    if (opts.debug_name) |name| {
        const dn = node.debug_name orelse return false;
        if (!std.mem.eql(u8, dn, name)) return false;
    }
    if (opts.test_id) |id| {
        const tid = node.test_id orelse return false;
        if (!std.mem.eql(u8, tid, id)) return false;
    }
    if (opts.text) |txt| {
        const nt = node.text orelse return false;
        if (!std.mem.eql(u8, nt, txt)) return false;
    }
    if (opts.text_contains) |sub| {
        const nt = node.text orelse return false;
        if (std.mem.indexOf(u8, nt, sub) == null) return false;
    }
    if (opts.has_handler) {
        const h = node.handlers;
        if (h.on_press == null and h.on_hover_enter == null and
            h.on_hover_exit == null and h.js_on_hover_enter == null and
            h.lua_on_hover_enter == null and h.js_on_hover_exit == null and
            h.lua_on_hover_exit == null and h.on_key == null and
            h.on_change_text == null and h.on_scroll == null and
            h.js_on_press == null and h.lua_on_press == null) return false;
    }
    return true;
}

/// Find the first node matching opts. Returns null if not found.
/// Coordinates in the result account for parent scroll offsets.
pub fn find(root: *Node, opts: QueryOpts) ?QueryResult {
    return findWithScroll(root, opts, 0);
}

fn findWithScroll(node: *Node, opts: QueryOpts, scroll_y: f32) ?QueryResult {
    if (node.style.display == .none) return null;
    if (matches(node, opts)) return resultFromNode(node, scroll_y);
    // Accumulate scroll offset for children
    const child_scroll = scroll_y + node.scroll_y;
    for (node.children) |*child| {
        if (findWithScroll(child, opts, child_scroll)) |result| return result;
    }
    return null;
}

/// Find all nodes matching opts. Returns the number found.
pub fn findAll(root: *Node, opts: QueryOpts, out: []QueryResult) usize {
    var found: usize = 0;
    findAllRecurse(root, opts, out, &found, 0);
    return found;
}

fn findAllRecurse(node: *Node, opts: QueryOpts, out: []QueryResult, found: *usize, scroll_y: f32) void {
    if (node.style.display == .none) return;
    if (found.* >= out.len) return;
    if (matches(node, opts)) {
        out[found.*] = resultFromNode(node, scroll_y);
        found.* += 1;
    }
    const child_scroll = scroll_y + node.scroll_y;
    for (node.children) |*child| {
        if (found.* >= out.len) return;
        findAllRecurse(child, opts, out, found, child_scroll);
    }
}

/// Count nodes matching opts.
pub fn countMatches(root: *Node, opts: QueryOpts) usize {
    var n: usize = 0;
    countRecurse(root, opts, &n);
    return n;
}

fn countRecurse(node: *Node, opts: QueryOpts, n: *usize) void {
    if (node.style.display == .none) return;
    if (matches(node, opts)) n.* += 1;
    for (node.children) |*child| {
        countRecurse(child, opts, n);
    }
}

// ── Convenience shortcuts ──

pub fn findByText(root: *Node, text: []const u8) ?QueryResult {
    return find(root, .{ .text = text });
}

pub fn findByName(root: *Node, name: []const u8) ?QueryResult {
    return find(root, .{ .debug_name = name });
}

pub fn findById(root: *Node, id: []const u8) ?QueryResult {
    return find(root, .{ .test_id = id });
}
