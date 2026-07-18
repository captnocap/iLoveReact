//! ReactJIT Events — Phase 2
//!
//! Hit testing and event dispatch for the native engine.
//! Walk the node tree back-to-front (last child wins) to find
//! the deepest node containing a point that has event handlers.
//!
//! No allocations — handlers are compile-time function pointers.

const std = @import("std");
const layout = @import("layout.zig");
const Node = layout.Node;

// ── Filter-aware pointer warp ───────────────────────────────────────────
//
// The CRT filter applies barrel distortion in its fragment shader:
//   p = uv * 2 - 1
//   p' = p * (1 + k * |p|^2)        where k = 0.15 * filter_intensity
//   source_uv = p' * 0.5 + 0.5
// so the pixel VISUALLY shown at screen `uv` is the un-warped scene's
// content at `source_uv`. The hit-tester reads flat layout rects (which
// are pre-warp), so clicks fall through to the wrong elements unless we
// transform the pointer the same way before recursing into the filter's
// children.
//
// Other built-in filters (deepfry, vhs, chromatic, posterize, scanlines,
// invert, grayscale, pixelate, dither) DO NOT warp positions — they
// only manipulate per-pixel color. So crt is the only filter that
// needs this correction today.
const FilterWarp = struct {
    x: f32,
    y: f32,
    /// True if the warped point is still inside the filter's source
    /// rect [0,1]^2. The CRT shader returns transparent when out of
    /// range — hit-test should miss the same way.
    in_bounds: bool,
};

fn warpForFilter(node: *Node, r: layout.LayoutRect, mx: f32, my: f32) FilterWarp {
    const fname = node.filter_name orelse return .{ .x = mx, .y = my, .in_bounds = true };
    if (r.w <= 0 or r.h <= 0) return .{ .x = mx, .y = my, .in_bounds = true };

    if (std.mem.eql(u8, fname, "crt")) {
        const u = (mx - r.x) / r.w;
        const v = (my - r.y) / r.h;
        const px = u * 2.0 - 1.0;
        const py = v * 2.0 - 1.0;
        const r2 = px * px + py * py;
        const k = 0.15 * node.filter_intensity;
        const scale = 1.0 + k * r2;
        const ppx = px * scale;
        const ppy = py * scale;
        const src_u = ppx * 0.5 + 0.5;
        const src_v = ppy * 0.5 + 0.5;
        const in = src_u >= 0.0 and src_u <= 1.0 and src_v >= 0.0 and src_v <= 1.0;
        return .{
            .x = r.x + src_u * r.w,
            .y = r.y + src_v * r.h,
            .in_bounds = in,
        };
    }

    // Non-positional filter — identity.
    return .{ .x = mx, .y = my, .in_bounds = true };
}

// ── Event Handler ────────────────────────────────────────────────────────

pub const EventHandler = struct {
    /// Owner supplied to every native callback below. V8-backed handlers use
    /// this for their root-owned HostContext; pure native handlers may ignore
    /// a null context.
    context: ?*anyopaque = null,
    on_press: ?*const fn (?*anyopaque) void = null,
    on_mouse_down: ?*const fn (?*anyopaque) void = null,
    on_mouse_move: ?*const fn (?*anyopaque) void = null,
    on_mouse_up: ?*const fn (?*anyopaque) void = null,
    on_hover_enter: ?*const fn (?*anyopaque) void = null,
    on_hover_exit: ?*const fn (?*anyopaque) void = null,
    js_on_hover_enter: ?[*:0]const u8 = null,
    lua_on_hover_enter: ?[*:0]const u8 = null,
    js_on_hover_exit: ?[*:0]const u8 = null,
    lua_on_hover_exit: ?[*:0]const u8 = null,
    on_key: ?*const fn (?*anyopaque, key: c_int, mods: u16) void = null,
    on_change_text: ?*const fn (?*anyopaque) void = null,
    on_submit: ?*const fn (?*anyopaque) void = null,
    on_scroll: ?*const fn (?*anyopaque) void = null,
    on_right_click: ?*const fn (?*anyopaque, x: f32, y: f32) void = null,
    js_on_scroll: ?[*:0]const u8 = null,
    js_on_press: ?[*:0]const u8 = null,
    js_on_mouse_down: ?[*:0]const u8 = null,
    js_on_mouse_move: ?[*:0]const u8 = null,
    js_on_mouse_up: ?[*:0]const u8 = null,
    /// Lua expression to eval on press (LuaJIT logic runtime)
    lua_on_press: ?[*:0]const u8 = null,
    lua_on_mouse_down: ?[*:0]const u8 = null,
    lua_on_mouse_move: ?[*:0]const u8 = null,
    lua_on_mouse_up: ?[*:0]const u8 = null,
    js_on_middle_click: ?[*:0]const u8 = null,
};

// ── Hit Testing ──────────────────────────────────────────────────────────

/// Walk the tree back-to-front (children rendered later are "on top").
/// Returns the deepest node containing (mx, my) that has at least one handler
/// or explicitly blocks pointer events.
/// Skips display:none nodes entirely.
pub fn hitTest(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    // Scroll container: clip hit test to visible bounds and adjust coordinates
    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Filter-aware coordinate warp (CRT barrel etc.). Applied AFTER any
    // scroll adjustment because the filter's source rect is in screen
    // coords post-scroll. Off-screen warp means the shader returns
    // transparent — propagate as a hit-test miss.
    if (node.filter_name != null) {
        const w = warpForFilter(node, r, child_mx, child_my);
        if (!w.in_bounds) return null;
        child_mx = w.x;
        child_my = w.y;
    }

    // Canvas container: graph-space children must never be hit-tested with
    // screen coords — positionOneCanvasNode writes RAW GRAPH coordinates into
    // their computed rects, so a panned canvas leaves rects over the app's
    // chrome that swallow clicks (NAVDEAD-0605). Only Canvas.Clamp children
    // stay in screen space. Mirrors layout.hitTest + hitTestHoverable.
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (hitTest(child, child_mx, child_my)) |hit| return hit;
            }
        }
        return node;
    }

    // Check children in reverse order (last child = front-most)
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTest(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    // Check self — handlers/href/input/canvas dispatch, blocks_pointer_events consumes.
    if (node.blocks_pointer_events or hasHandlers(&node.handlers) or node.href != null or node.input_id != null or node.canvas_type != null) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }

    return null;
}

/// Returns true if the node has any event handler set.
fn hasHandlers(h: *const EventHandler) bool {
    return h.on_press != null or
        h.on_mouse_down != null or
        h.on_mouse_move != null or
        h.on_mouse_up != null or
        h.on_hover_enter != null or
        h.on_hover_exit != null or
        h.js_on_hover_enter != null or
        h.lua_on_hover_enter != null or
        h.js_on_hover_exit != null or
        h.lua_on_hover_exit != null or
        h.on_key != null or
        h.on_change_text != null or
        h.on_submit != null or
        h.on_scroll != null or
        h.js_on_scroll != null or
        h.on_right_click != null or
        h.js_on_middle_click != null or
        h.js_on_mouse_down != null or
        h.js_on_mouse_move != null or
        h.js_on_mouse_up != null or
        h.lua_on_press != null or
        h.lua_on_mouse_down != null or
        h.lua_on_mouse_move != null or
        h.lua_on_mouse_up != null or
        h.js_on_press != null;
}

// ── Hover Hit Test (any node, not just ones with handlers) ──────────────

/// Walk the tree back-to-front.
/// Returns the deepest node containing (mx, my) that has handlers, hoverable flag,
/// or pointer blocking. Used for hover effects and for clearing hover under overlays.
pub fn hitTestHoverable(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Filter-aware warp — see hitTest comment.
    if (node.filter_name != null) {
        const w = warpForFilter(node, r, child_mx, child_my);
        if (!w.in_bounds) return null;
        child_mx = w.x;
        child_my = w.y;
    }

    // Canvas container: Canvas.Node / Canvas.Path descendants have computed rects
    // in graph space (positionOneCanvasNode in engine.zig shifts them pre-paint).
    // Canvas.Clamp children stay in screen space. Bail if mouse is outside the
    // canvas rect so the graph-space point doesn't leak and match a tile painted
    // elsewhere on screen.
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        const canvas_mod = @import("primitive/canvas.zig");
        const vp_cx = r.x + r.w / 2;
        const vp_cy = r.y + r.h / 2;
        const gpos = canvas_mod.screenToGraph(mx, my, vp_cx, vp_cy);
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (hitTestHoverable(child, child_mx, child_my)) |hit| return hit;
            } else {
                if (hitTestHoverable(child, gpos[0], gpos[1])) |hit| return hit;
            }
        }
        return node;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestHoverable(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    if (node.blocks_pointer_events or hasHandlers(&node.handlers) or node.hoverable or node.href != null or node.input_id != null or node.canvas_type != null) {
        if (r.w > 0 and r.h > 0 and mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }

    return null;
}

// ── Content→Screen offset for a target node ─────────────────────────────
//
// Descendants of a scroll container have `computed.x/y` in CONTENT space
// (the layout pass writes pre-scroll coordinates; hit-test compensates by
// adding `scroll_x/y` to the mouse coords as it descends — see lines
// ~114-117 above). Anything that wants the on-screen position of such a
// node (tooltip, context menu, popover) must subtract the cumulative
// scroll of every scroll-ancestor between root and the node.
//
// Returns (sx, sy) such that `screen_pos = computed_pos - (sx, sy)`.
pub const ScrollOffset = struct { sx: f32, sy: f32 };

pub fn cumulativeScrollOffset(root: *Node, target: *Node) ScrollOffset {
    return findScroll(root, target, 0, 0) orelse ScrollOffset{ .sx = 0, .sy = 0 };
}

fn findScroll(node: *Node, target: *Node, sx_acc: f32, sy_acc: f32) ?ScrollOffset {
    if (node == target) return ScrollOffset{ .sx = sx_acc, .sy = sy_acc };
    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    const add_x: f32 = if (is_scroll) node.scroll_x else 0;
    const add_y: f32 = if (is_scroll) node.scroll_y else 0;
    for (node.children) |*child| {
        if (findScroll(child, target, sx_acc + add_x, sy_acc + add_y)) |hit| return hit;
    }
    return null;
}

// ── Text Hit Test (finds any text node, not just ones with handlers) ────

/// Find the deepest text node containing (mx, my).
/// Used for text selection — text nodes don't need event handlers.
pub fn hitTestText(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Filter-aware warp — see hitTest comment.
    if (node.filter_name != null) {
        const w = warpForFilter(node, r, child_mx, child_my);
        if (!w.in_bounds) return null;
        child_mx = w.x;
        child_my = w.y;
    }

    // Canvas guard — graph-space children skipped, see hitTest (NAVDEAD-0605).
    // A canvas itself is never a text node, so in-bounds resolves to clamp
    // children only.
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (hitTestText(child, child_mx, child_my)) |hit| return hit;
            }
        }
        return null;
    }

    // Check children in reverse order (last child = front-most)
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestText(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    // Check self — must be a text node within bounds
    if (node.text != null) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }

    return null;
}

// ── Scroll Container Hit Test ───────────────────────────────────────────

/// Find the deepest scroll container under (mx, my).
/// Any node with overflow scroll or auto (when content overflows) is scrollable.
/// Find the deepest canvas node under the cursor.
pub fn findCanvasNode(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;
    const r = node.computed;
    // No AABB pre-reject — an absolute-positioned canvas (or a canvas
    // inside an absolute popover) extends past its anchor's bounds, and
    // pre-rejecting here would prevent the walker from ever reaching it.
    // Bounds are checked at self-match below. Same shape as hitTest.
    if (node.canvas_type != null and mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
        return node;
    }
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (findCanvasNode(&node.children[i], child_mx, child_my)) |hit| return hit;
    }
    return null;
}

/// Walk the tree back-to-front to find the deepest node containing (mx, my)
/// that has a right-click handler or context_menu_items.
pub fn hitTestRightClick(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Filter-aware warp — see hitTest comment.
    if (node.filter_name != null) {
        const w = warpForFilter(node, r, child_mx, child_my);
        if (!w.in_bounds) return null;
        child_mx = w.x;
        child_my = w.y;
    }

    // Canvas guard — graph-space children skipped, see hitTest (NAVDEAD-0605).
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (hitTestRightClick(child, child_mx, child_my)) |hit| return hit;
            }
        }
        if (node.blocks_pointer_events or node.handlers.on_right_click != null or node.context_menu_items != null) return node;
        return null;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestRightClick(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    if (node.blocks_pointer_events or node.handlers.on_right_click != null or node.context_menu_items != null) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }

    return null;
}

/// Walk the tree back-to-front to find the deepest node containing (mx, my)
/// that has an onScroll handler but is NOT itself a scroll container. This is
/// the wheel-event fallback for nodes that opt into the raw wheel delta — e.g.
/// a transparent <Pressable onScroll> over a <Scene3D> driving camera dolly.
/// A real scroll container is handled earlier by findScrollContainer; this only
/// runs when no container captured the wheel, so the two never double-fire.
pub fn hitTestScroll(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Filter-aware warp — see hitTest comment.
    if (node.filter_name != null) {
        const w = warpForFilter(node, r, child_mx, child_my);
        if (!w.in_bounds) return null;
        child_mx = w.x;
        child_my = w.y;
    }

    // Canvas guard — graph-space children skipped, see hitTest (NAVDEAD-0605).
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (hitTestScroll(child, child_mx, child_my)) |hit| return hit;
            }
        }
        if (node.blocks_pointer_events or node.handlers.js_on_scroll != null or node.handlers.on_scroll != null) return node;
        return null;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestScroll(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    if (node.blocks_pointer_events or node.handlers.js_on_scroll != null or node.handlers.on_scroll != null) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }

    return null;
}

pub fn findScrollContainer(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;

    // Scroll container: adjust coordinates for children in content space
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Canvas guard — graph-space children skipped, see hitTest (NAVDEAD-0605).
    // A scroll container inside a panned-away Canvas.Node must not capture
    // wheel events through its leaked graph-space rect.
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (findScrollContainer(child, child_mx, child_my)) |hit| return hit;
            }
        }
        if (is_scroll) return node;
        return null;
    }

    // Check children in reverse order (deepest/front-most first). NO AABB
    // rejection on this node first: an absolute-positioned popover (model
    // picker, tooltip) can extend well past its anchor's bounds, so we have
    // to descend regardless of whether the cursor is inside the parent.
    // Mirrors hitTest()'s shape — that's why clicks land on the popover but
    // wheel scroll didn't until this loop stopped pre-rejecting.
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (findScrollContainer(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    // Check self — scroll always scrollable, auto only when content
    // overflows. Self only counts if the cursor is actually inside its box.
    if (is_scroll and mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) return node;

    return null;
}
