//! ContextMenu — framework-owned right-click popover menu.
//!
//! Any node with `context_menu_items` gets an automatic context menu on right-click.
//! The engine calls show/hide; this module handles positioning, painting, and item dispatch.
//!
//! Usage from .zig:  node.context_menu_items = &.{
//!     .{ .label = "Copy",   .handler = handleCopy },
//!     .{ .label = "Delete", .handler = handleDelete },
//! }
//! Usage from .tsz:  <Box onRightClick={() => doSomething()}>  (via on_right_click handler)

const gpu = @import("../gpu/gpu.zig");
const layout = @import("../layout.zig");

// ── Types ─────────────────────────────────────────────────────────────

pub const MenuItem = struct {
    label: []const u8,
    handler: *const fn (?*anyopaque) void,
};

// ── Config ────────────────────────────────────────────────────────────

const PAD_H: f32 = 12;
const PAD_V: f32 = 6;
const ITEM_H: f32 = 28;
const MIN_W: f32 = 140;
const MAX_W: f32 = 280;
const BORDER_RADIUS: f32 = 6;
const FONT_SIZE: u16 = 13;
const MARGIN: f32 = 4;
const SEPARATOR_H: f32 = 1;

// Background: dark blue-grey (matches tooltip)
const BG_R: f32 = 0.11;
const BG_G: f32 = 0.12;
const BG_B: f32 = 0.17;
const BG_A: f32 = 0.97;

// Border: subtle lighter edge
const BD_R: f32 = 0.25;
const BD_G: f32 = 0.27;
const BD_B: f32 = 0.33;
const BD_A: f32 = 0.8;

// Text: off-white
const TX_R: f32 = 0.88;
const TX_G: f32 = 0.90;
const TX_B: f32 = 0.94;
const TX_A: f32 = 1.0;

// Hover highlight
const HV_R: f32 = 0.22;
const HV_G: f32 = 0.24;
const HV_B: f32 = 0.32;
const HV_A: f32 = 1.0;

// ── State ─────────────────────────────────────────────────────────────

var visible: bool = false;
var menu_x: f32 = 0;
var menu_y: f32 = 0;
var items_ptr: []const MenuItem = &.{};
var hover_idx: ?usize = null;
// React-side stable id of the node whose menu is active. Set by show().
// Trampolines in v8_app dispatch to JS using this id.
var active_node_id: u32 = 0;
// Computed dimensions (set on show)
var menu_w: f32 = 0;
var menu_h: f32 = 0;

// ── API (called by engine) ────────────────────────────────────────────

pub fn show(x: f32, y: f32, items: []const MenuItem) void {
    showFor(x, y, items, 0);
}

/// Same as show() but records the React-side node id whose menu is active.
/// JS-side handlers (v8_app trampolines) read this via activeNodeId() to
/// dispatch back to the correct React node.
pub fn showFor(x: f32, y: f32, items: []const MenuItem, node_id: u32) void {
    if (items.len == 0) return;
    items_ptr = items;
    menu_x = x;
    menu_y = y;
    hover_idx = null;
    visible = true;
    active_node_id = node_id;
    // Dimensions computed during paint (need measure_fn)
    menu_w = 0;
    menu_h = 0;
}

pub fn hide() void {
    visible = false;
    items_ptr = &.{};
    hover_idx = null;
    active_node_id = 0;
}

/// React-side stable id of the node whose menu is currently open.
/// Returns 0 when no menu is showing or when shown via show() (no node id).
pub fn activeNodeId() u32 {
    return active_node_id;
}

pub fn isVisible() bool {
    return visible;
}

/// Update hover state from mouse position. Called by engine on mouse move.
pub fn updateHover(mx: f32, my: f32) void {
    if (!visible or menu_w == 0) {
        hover_idx = null;
        return;
    }
    if (mx >= menu_x and mx < menu_x + menu_w and my >= menu_y and my < menu_y + menu_h) {
        const local_y = my - menu_y - PAD_V;
        if (local_y >= 0) {
            const idx: usize = @intFromFloat(local_y / ITEM_H);
            if (idx < items_ptr.len) {
                hover_idx = idx;
                return;
            }
        }
    }
    hover_idx = null;
}

/// Handle a left-click while the menu is visible.
/// Returns true if the click was consumed (hit an item or was inside the menu area).
pub fn handleClick(context: ?*anyopaque, mx: f32, my: f32) bool {
    if (!visible) return false;

    // If click is inside the menu bounds
    if (menu_w > 0 and mx >= menu_x and mx < menu_x + menu_w and my >= menu_y and my < menu_y + menu_h) {
        const local_y = my - menu_y - PAD_V;
        if (local_y >= 0) {
            const idx: usize = @intFromFloat(local_y / ITEM_H);
            if (idx < items_ptr.len) {
                const handler = items_ptr[idx].handler;
                hide();
                handler(context);
                return true;
            }
        }
        // Clicked inside menu but not on an item — still consume
        return true;
    }

    // Click outside — dismiss
    hide();
    return false;
}

// ── Paint (called by engine after main tree + tooltip) ────────────────

pub fn paintOverlay(measure_fn: layout.MeasureTextFn, win_w: f32, win_h: f32) void {
    if (!visible or items_ptr.len == 0) return;

    // Measure widest item to size the menu
    var max_text_w: f32 = 0;
    for (items_ptr) |item| {
        const m = measure_fn(item.label, FONT_SIZE, 0, MAX_W - PAD_H * 2, 0, 0, 0, false, false);
        if (m.width > max_text_w) max_text_w = m.width;
    }

    const item_count: f32 = @floatFromInt(items_ptr.len);
    const box_w = @max(MIN_W, max_text_w + PAD_H * 2);
    const box_h = item_count * ITEM_H + PAD_V * 2;

    // Position — prefer below-right of cursor, flip if clipped
    var tx = menu_x;
    var ty = menu_y;

    if (tx + box_w > win_w - MARGIN) tx = win_w - MARGIN - box_w;
    if (tx < MARGIN) tx = MARGIN;
    if (ty + box_h > win_h - MARGIN) ty = win_h - MARGIN - box_h;
    if (ty < MARGIN) ty = MARGIN;

    // Store computed position and dimensions for hit testing
    menu_x = tx;
    menu_y = ty;
    menu_w = box_w;
    menu_h = box_h;

    // Push full-viewport scissor to escape any parent overflow:hidden clipping
    gpu.pushScissor(0, 0, win_w, win_h);

    // Background + border (shadow effect via slightly offset darker rect)
    gpu.drawRect(tx + 2, ty + 2, box_w, box_h, 0, 0, 0, 0.3, BORDER_RADIUS, 0, 0, 0, 0, 0);
    gpu.drawRect(tx, ty, box_w, box_h, BG_R, BG_G, BG_B, BG_A, BORDER_RADIUS, 1, BD_R, BD_G, BD_B, BD_A);

    // Items
    var i: usize = 0;
    for (items_ptr) |item| {
        const iy = ty + PAD_V + @as(f32, @floatFromInt(i)) * ITEM_H;

        // Hover highlight
        if (hover_idx != null and hover_idx.? == i) {
            const hr: f32 = if (i == 0) BORDER_RADIUS else 0;
            const last = items_ptr.len - 1;
            const br: f32 = if (i == last) BORDER_RADIUS else 0;
            _ = hr;
            _ = br;
            // Simple rect highlight (no per-corner radius needed)
            gpu.drawRect(tx + 1, iy, box_w - 2, ITEM_H, HV_R, HV_G, HV_B, HV_A, 2, 0, 0, 0, 0, 0);
        }

        // Label text — vertically centered in item row
        _ = gpu.drawTextWrapped(item.label, tx + PAD_H, iy + (ITEM_H - @as(f32, @floatFromInt(FONT_SIZE))) / 2, FONT_SIZE, box_w - PAD_H * 2, TX_R, TX_G, TX_B, TX_A, 0);

        i += 1;
    }

    gpu.popScissor();
}

// ── Telemetry ─────────────────────────────────────────────────────────

pub fn telemetryVisible() bool {
    return visible;
}
