//! Text selection — click-drag highlighting, double-click word select, Ctrl+A/C.
//!
//! Framework module. Engine wires mouse/key events in; this module tracks
//! selection state and emits highlight rects via gpu.drawSelectionRects().
//! No codegen involvement.

const std = @import("std");
const c = @import("c.zig").imports;
const layout = @import("layout.zig");
const gpu = @import("gpu/gpu.zig");
const log = @import("diag/log.zig");
const Node = layout.Node;
const Color = layout.Color;

// ── Selection state ─────────────────────────────────────────────────────

var sel_node: ?*Node = null;
var sel_end_node: ?*Node = null;
var sel_start: usize = 0;
var sel_end: usize = 0;
var sel_anchor: usize = 0;
var sel_dragging: bool = false;
var sel_last_click: u32 = 0;
var sel_click_count: u32 = 0;
var sel_all: bool = false;
// Walk-state machine for cross-node highlighting during paint traversal:
// 0 = before selection, 1 = inside selection, 2 = past selection
var sel_walk_state: u8 = 0;

// Deferred resolution — record mouse pos during events, resolve to char index during paint.
// This prevents FreeType state mutation during the event phase which corrupts layout measurements.
var pending_down: bool = false;
var pending_drag: bool = false;
var pending_mx: f32 = 0;
var pending_my: f32 = 0;
var pending_now: u32 = 0;
var pending_root: ?*Node = null;

const DOUBLE_CLICK_MS: u32 = 400;

// ── Text-style scope ────────────────────────────────────────────────────
//
// Anything that walks a text node's bytes (paint, selection rect, click
// hit-test) must do so under the SAME transient text-style globals the
// painter uses, otherwise glyph advances and line height drift apart and
// rects/indices land in the wrong place. The painter sets these in
// engine.zig:drawNodeTextCommon and clears them after; everyone else has to
// re-establish them. Bundling save+apply / restore in one place means future
// additions to text style only need to update this scope, not every caller.

pub const NodeTextScope = struct {
    bold: bool,
    line_height: f32,
    letter_spacing: f32,
    font_family_id: u8,
};

pub fn applyNodeTextScope(node: *const Node) NodeTextScope {
    const scope = NodeTextScope{
        .bold = node.font_weight >= 600,
        .line_height = node.line_height,
        .letter_spacing = node.letter_spacing,
        .font_family_id = node.font_family_id,
    };
    if (scope.line_height > 0) gpu.setLineHeightOverride(scope.line_height);
    if (scope.letter_spacing != 0) gpu.setLetterSpacing(scope.letter_spacing);
    if (scope.bold) gpu.setBold(true);
    if (scope.font_family_id != 0) gpu.setFontFamily(scope.font_family_id);
    return scope;
}

pub fn restoreNodeTextScope(scope: NodeTextScope) void {
    if (scope.line_height > 0) gpu.setLineHeightOverride(0);
    if (scope.letter_spacing != 0) gpu.setLetterSpacing(0);
    if (scope.bold) gpu.setBold(false);
    if (scope.font_family_id != 0) gpu.setFontFamily(0);
}

// ── Public API ──────────────────────────────────────────────────────────

/// Call on SDL_MOUSEBUTTONDOWN (left button).
/// Records the event for deferred resolution during paint — does NOT touch FreeType.
pub fn onMouseDown(root: *Node, mx: f32, my: f32, now: u32) void {
    const hit = hitTestText(root, mx, my);
    if (hit == null) {
        clear();
        return;
    }
    pending_down = true;
    pending_drag = false;
    pending_mx = mx;
    pending_my = my;
    pending_now = now;
    pending_root = root;
}

/// Call on SDL_MOUSEMOTION while left button is held.
/// Records for deferred resolution — does NOT touch FreeType.
pub fn onMouseDrag(_: *Node, mx: f32, my: f32) void {
    if (!sel_dragging and !pending_down) return;
    pending_drag = true;
    pending_mx = mx;
    pending_my = my;
}

/// Resolve any pending mouse events. Call once per frame DURING PAINT,
/// after layout is complete and FreeType mutations are safe.
pub fn resolvePending() void {
    if (pending_down) {
        pending_down = false;
        const root = pending_root orelse return;
        const hit = hitTestText(root, pending_mx, pending_my);
        if (hit == null) {
            clear();
            return;
        }
        const node = hit.?.node;
        // Scroll-adjusted mouse coords (content-space, aligned with node.computed.x/y).
        const adj_mx = pending_mx + hit.?.scroll_x;
        const adj_my = pending_my + hit.?.scroll_y;

        // Double/triple click detection
        if (pending_now - sel_last_click < DOUBLE_CLICK_MS and sel_node == node) {
            sel_click_count += 1;
        } else {
            sel_click_count = 1;
        }
        sel_last_click = pending_now;

        log.info(.selection, "click #{d} on node", .{sel_click_count});

        if (sel_click_count == 2) {
            // Double click — select word
            if (node.text) |txt| {
                const idx = charIndexAtPos(txt, node, adj_mx, adj_my);
                const word = wordBoundsAt(txt, idx);
                sel_node = node;
                sel_end_node = node;
                sel_start = word.start;
                sel_end = word.end;
                sel_anchor = word.start;
                sel_dragging = false;
            }
            return;
        }

        if (sel_click_count >= 3) {
            // Triple click — select all text in node
            if (node.text) |txt| {
                sel_node = node;
                sel_end_node = node;
                sel_start = 0;
                sel_end = txt.len;
                sel_anchor = 0;
                sel_dragging = false;
            }
            return;
        }

        // Single click — start new selection
        if (node.text) |_| {
            const idx = charIndexAtPos(node.text.?, node, adj_mx, adj_my);
            sel_node = node;
            sel_end_node = node;
            sel_start = idx;
            sel_end = idx;
            sel_anchor = idx;
            sel_dragging = true;
            sel_all = false;
        }
    }

    if (pending_drag) {
        pending_drag = false;
        if (!sel_dragging) return;
        const anchor_node = sel_node orelse return;
        const root = pending_root orelse return;

        // Hit-test for the text node under the current mouse position
        const drag_hit = hitTestText(root, pending_mx, pending_my);

        if (drag_hit) |hit_res| {
            const drag_node = hit_res.node;
            if (drag_node == anchor_node) {
                // Same node — single-node selection
                sel_end_node = anchor_node;
                if (anchor_node.text) |_| {
                    const adj_mx = pending_mx + hit_res.scroll_x;
                    const adj_my = pending_my + hit_res.scroll_y;
                    const idx = charIndexAtPos(anchor_node.text.?, anchor_node, adj_mx, adj_my);
                    sel_start = @min(sel_anchor, idx);
                    sel_end = @max(sel_anchor, idx);
                }
            } else {
                // Different node — cross-node selection
                sel_end_node = drag_node;
                // Start node: from anchor to end of text
                sel_start = sel_anchor;
                if (anchor_node.text) |txt| {
                    sel_end = txt.len;
                }
                // End node position stored implicitly — paintHighlight
                // uses the walk-state machine to handle intermediate nodes
            }
        } else {
            // Mouse is not over any text node — keep current selection
            // but extend within the anchor node if possible. Look up the
            // anchor node's ancestor scroll offset so the extend logic
            // still works while dragging outside any text (e.g. into padding
            // or off the side of a scrolling container).
            if (anchor_node.text) |_| {
                var sx: f32 = 0;
                var sy: f32 = 0;
                _ = scrollOffsetForNode(root, anchor_node, &sx, &sy);
                const adj_mx = pending_mx + sx;
                const adj_my = pending_my + sy;
                const idx = charIndexAtPos(anchor_node.text.?, anchor_node, adj_mx, adj_my);
                sel_start = @min(sel_anchor, idx);
                sel_end = @max(sel_anchor, idx);
            }
        }
    }
}

/// Call on SDL_MOUSEBUTTONUP (left button).
pub fn onMouseUp() void {
    sel_dragging = false;
}

/// Call on SDL_KEYDOWN. Handles Ctrl+A (select all) and Ctrl+C (copy).
pub fn onKeyDown(root: *Node, sym: c_int, mod: u16) void {
    const ctrl = (mod & c.SDL_KMOD_CTRL) != 0;
    if (!ctrl) return;

    if (sym == c.SDLK_A) {
        // Ctrl+A — select all text across entire tree
        sel_all = true;
        sel_node = null;
        sel_dragging = false;
    } else if (sym == c.SDLK_C) {
        // Ctrl+C — copy selection to clipboard
        var buf: [4096]u8 = undefined;
        const len = collectSelectedText(root, &buf);
        log.info(.selection, "copy {d} bytes to clipboard", .{len});
        if (len > 0) {
            buf[len] = 0;
            _ = c.SDL_SetClipboardText(@ptrCast(&buf));
        }
    }
}

/// Clear all selection state.
pub fn clear() void {
    sel_node = null;
    sel_end_node = null;
    sel_start = 0;
    sel_end = 0;
    sel_anchor = 0;
    sel_dragging = false;
    sel_all = false;
    sel_click_count = 0;
}

/// Reset walk state each frame, before the paint walk begins.
pub fn resetWalkState() void {
    sel_walk_state = 0;
}

/// Paint selection highlights for a node during the paint walk.
/// Call this for each text node before drawing text.
/// Uses a walk-state machine for cross-node selection:
///   0 = before selection start, 1 = inside selection, 2 = past selection end
pub fn paintHighlight(node: *Node, screen_x: f32, screen_y: f32) void {
    const txt = node.text orelse return;
    if (txt.len == 0) return;

    const pad_l = node.style.padLeft();
    const pad_t = node.style.padTop();
    const pad_r = node.style.padRight();
    const max_w = @max(1.0, node.computed.w - pad_l - pad_r);

    const scope = applyNodeTextScope(node);
    defer restoreNodeTextScope(scope);

    if (sel_all) {
        // Select-all: highlight everything
        gpu.drawSelectionRects(txt, screen_x + pad_l, screen_y + pad_t, node.font_size, max_w, 0, txt.len);
        return;
    }

    // No selection active
    if (sel_node == null or sel_end_node == null) return;
    if (sel_start == sel_end and sel_node == sel_end_node) return;

    const is_start_node = (sel_node == node);
    const is_end_node = (sel_end_node == node);
    const is_same_node = (sel_node == sel_end_node);

    var s0: usize = 0;
    var s1: usize = 0;
    var should_highlight = false;

    if (is_same_node and is_start_node) {
        // Single-node selection
        s0 = @min(sel_start, sel_end);
        s1 = @max(sel_start, sel_end);
        should_highlight = (s1 > s0);
    } else if (is_start_node or is_end_node) {
        // First or last boundary node in cross-node selection
        if (sel_walk_state == 0) {
            // First boundary encountered in tree order
            if (is_start_node) {
                s0 = sel_start;
                s1 = txt.len;
            } else {
                // End node came first in tree order (backward drag)
                s0 = 0;
                s1 = txt.len; // highlight from start — end node char pos handled below
            }
            sel_walk_state = 1;
            should_highlight = true;
        } else if (sel_walk_state == 1) {
            // Second boundary — end of cross-node selection
            if (is_end_node) {
                s0 = 0;
                s1 = txt.len; // full node for end boundary
            } else {
                s0 = 0;
                s1 = sel_start;
            }
            sel_walk_state = 2;
            should_highlight = (s1 > s0);
        }
    } else if (sel_walk_state == 1) {
        // Middle node — fully selected
        s0 = 0;
        s1 = txt.len;
        should_highlight = true;
    }

    if (should_highlight and s1 > s0) {
        gpu.drawSelectionRects(txt, screen_x + pad_l, screen_y + pad_t, node.font_size, max_w, s0, s1);
    }
}

// ── Internal helpers ────────────────────────────────────────────────────

/// Resolve a mouse position to a byte index within a text node.
fn charIndexAtPos(text: []const u8, node: *Node, mx: f32, my: f32) usize {
    const r = node.computed;
    const pad_l = node.style.padLeft();
    const pad_t = node.style.padTop();
    const pad_r = node.style.padRight();
    const max_w = @max(1.0, r.w - pad_l - pad_r);

    const local_x = mx - (r.x + pad_l);
    const local_y = my - (r.y + pad_t);

    // Hit-test under the same text-style scope the painter uses, so a click
    // on a bold/letter-spaced/non-default-family node snaps to the byte
    // whose glyph is actually under the cursor.
    const scope = applyNodeTextScope(node);
    defer restoreNodeTextScope(scope);
    return gpu.byteIndexAtPos(text, node.font_size, max_w, local_x, local_y);
}

/// Find word boundaries around a byte index.
fn wordBoundsAt(text: []const u8, idx: usize) struct { start: usize, end: usize } {
    if (text.len == 0) return .{ .start = 0, .end = 0 };
    const pos = @min(idx, text.len - 1);

    // Scan backward to word start
    var start: usize = pos;
    while (start > 0 and !isWordBreak(text[start - 1])) start -= 1;

    // Scan forward to word end
    var end: usize = pos;
    while (end < text.len and !isWordBreak(text[end])) end += 1;

    return .{ .start = start, .end = end };
}

fn isWordBreak(ch: u8) bool {
    return ch == ' ' or ch == '\n' or ch == '\t' or ch == '.' or ch == ',' or
        ch == ';' or ch == ':' or ch == '(' or ch == ')' or ch == '[' or
        ch == ']' or ch == '{' or ch == '}' or ch == '<' or ch == '>' or
        ch == '"' or ch == '\'' or ch == '/' or ch == '\\';
}

const HitResult = struct {
    node: *Node,
    /// Accumulated scroll offset from all ancestor scroll containers.
    /// Add these to the original screen-space mouse coords to get content-space coords
    /// aligned with the hit node's `computed.x/y`.
    scroll_x: f32,
    scroll_y: f32,
};

/// Hit test for text nodes — returns deepest node with text under (mx, my)
/// plus the cumulative scroll offset that was applied while descending into it.
/// Scroll-aware: converts screen coords to content coords when entering scroll containers.
fn hitTestText(node: *Node, mx: f32, my: f32) ?HitResult {
    if (node.style.display == .none) return null;

    // Scroll container: clip to visible bounds and adjust coords for children
    const ov = node.style.overflow;
    const r = node.computed;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestText(&node.children[i], child_mx, child_my)) |hit| {
            var out = hit;
            if (is_scroll) {
                out.scroll_x += node.scroll_x;
                out.scroll_y += node.scroll_y;
            }
            return out;
        }
    }
    if (node.text != null) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return .{ .node = node, .scroll_x = 0, .scroll_y = 0 };
        }
    }
    return null;
}

/// Walk from `node` to find `target`, accumulating scroll_x/y from every
/// ancestor scroll container on the path. Returns true if target was found.
/// On return, `sx.*` / `sy.*` hold the cumulative offset to add to a
/// screen-space coord to make it content-space aligned with target.computed.
fn scrollOffsetForNode(node: *Node, target: *Node, sx: *f32, sy: *f32) bool {
    if (node == target) return true;
    const ov = node.style.overflow;
    const r = node.computed;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    for (node.children) |*child| {
        if (scrollOffsetForNode(child, target, sx, sy)) {
            if (is_scroll) {
                sx.* += node.scroll_x;
                sy.* += node.scroll_y;
            }
            return true;
        }
    }
    return false;
}

/// Collect selected text into a buffer. Returns bytes written.
/// Handles single-node and cross-node selections using the same
/// walk-state machine approach as paintHighlight.
fn collectSelectedText(root: *Node, buf: []u8) usize {
    if (sel_all) {
        return collectAllText(root, buf, 0);
    }
    const start_node = sel_node orelse return 0;
    const end_node = sel_end_node orelse return 0;

    if (start_node == end_node) {
        // Single-node selection
        if (sel_start >= sel_end) return 0;
        if (start_node.text) |txt| {
            const s0 = @min(sel_start, txt.len);
            const s1 = @min(sel_end, txt.len);
            const n = @min(s1 - s0, buf.len);
            if (n > 0) @memcpy(buf[0..n], txt[s0 .. s0 + n]);
            return n;
        }
        return 0;
    }

    // Cross-node selection — walk tree, collect text from start through end
    var walk_state: u8 = 0; // 0=before, 1=inside, 2=past
    return collectCrossNodeText(root, buf, 0, start_node, end_node, &walk_state);
}

/// Walk tree collecting text between start_node and end_node.
fn collectCrossNodeText(node: *Node, buf: []u8, pos: usize, start_node: *Node, end_node: *Node, walk_state: *u8) usize {
    if (walk_state.* == 2) return pos; // past selection
    var p = pos;

    const is_start = (node == start_node);
    const is_end = (node == end_node);

    if (node.text) |txt| {
        if (is_start or is_end) {
            if (walk_state.* == 0) {
                // First boundary in tree order
                const s0 = if (is_start) @min(sel_start, txt.len) else 0;
                const s1 = txt.len;
                if (s1 > s0) {
                    if (p > 0 and p < buf.len) { buf[p] = '\n'; p += 1; }
                    const n = @min(s1 - s0, buf.len - p);
                    if (n > 0) { @memcpy(buf[p .. p + n], txt[s0 .. s0 + n]); p += n; }
                }
                walk_state.* = 1;
            } else if (walk_state.* == 1) {
                // Second boundary — end of selection
                const s1 = if (is_end) @min(sel_end, txt.len) else @min(sel_start, txt.len);
                if (s1 > 0) {
                    if (p > 0 and p < buf.len) { buf[p] = '\n'; p += 1; }
                    const n = @min(s1, buf.len - p);
                    if (n > 0) { @memcpy(buf[p .. p + n], txt[0..n]); p += n; }
                }
                walk_state.* = 2;
                return p;
            }
        } else if (walk_state.* == 1) {
            // Middle node — fully selected
            if (p > 0 and p < buf.len) { buf[p] = '\n'; p += 1; }
            const n = @min(txt.len, buf.len - p);
            if (n > 0) { @memcpy(buf[p .. p + n], txt[0..n]); p += n; }
        }
    }

    for (node.children) |*child| {
        p = collectCrossNodeText(child, buf, p, start_node, end_node, walk_state);
        if (walk_state.* == 2) break;
    }
    return p;
}

/// Recursively collect all text in the tree.
fn collectAllText(node: *Node, buf: []u8, pos: usize) usize {
    var p = pos;
    if (node.text) |txt| {
        if (p > 0 and p < buf.len) {
            buf[p] = '\n';
            p += 1;
        }
        const n = @min(txt.len, buf.len - p);
        if (n > 0) {
            @memcpy(buf[p .. p + n], txt[0..n]);
            p += n;
        }
    }
    for (node.children) |*child| {
        p = collectAllText(child, buf, p);
    }
    return p;
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub fn telemetryHasSelection() bool {
    return sel_node != null;
}

/// Copy the active tree-text selection into `buf`. Returns bytes written.
/// Reuses the root pointer last passed through `onMouseDown`.
/// Returns 0 if there is no selection or if the root has not been seen yet.
pub fn copySelectionToBuf(buf: []u8) usize {
    if (sel_node == null and !sel_all) return 0;
    const root = pending_root orelse return 0;
    return collectSelectedText(root, buf);
}

pub fn telemetryIsDragging() bool {
    return sel_dragging;
}
