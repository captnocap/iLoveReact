//! Tooltip — framework-owned overlay that displays on hover.
//!
//! Any node with a `tooltip` field gets an automatic tooltip on hover.
//! The engine calls show/hide; this module handles positioning and painting.
//!
//! Usage from .tsz:  <Box tooltip="Helpful text">...</Box>
//! Usage from .zig:  node.tooltip = "Helpful text"

const gpu = @import("../gpu/gpu.zig");
const layout = @import("../layout.zig");

// ── Config ─────────────────────────────────────────────────────────────

const PAD_H: f32 = 10;
const PAD_V: f32 = 6;
const OFFSET_Y: f32 = 8;
const BORDER_RADIUS: f32 = 6;
const FONT_SIZE: u16 = 13;
const MAX_WIDTH: f32 = 300;
const MARGIN: f32 = 4;

// Background: dark blue-grey
const BG_R: f32 = 0.11;
const BG_G: f32 = 0.12;
const BG_B: f32 = 0.17;
const BG_A: f32 = 0.96;

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

// ── State ──────────────────────────────────────────────────────────────

var visible: bool = false;
var text_ptr: []const u8 = "";
var anchor_x: f32 = 0;
var anchor_y: f32 = 0;
var anchor_w: f32 = 0;
var anchor_h: f32 = 0;

// ── API (called by engine) ─────────────────────────────────────────────

pub fn show(text: []const u8, ax: f32, ay: f32, aw: f32, ah: f32) void {
    if (text.len == 0) return;
    text_ptr = text;
    anchor_x = ax;
    anchor_y = ay;
    anchor_w = aw;
    anchor_h = ah;
    visible = true;
}

pub fn hide() void {
    visible = false;
    text_ptr = "";
}

pub fn isVisible() bool {
    return visible;
}

// ── Paint (called by engine after main tree) ───────────────────────────

pub fn paintOverlay(measure_fn: layout.MeasureTextFn, win_w: f32, win_h: f32) void {
    if (!visible or text_ptr.len == 0) return;

    // Measure text to size the box
    const metrics = measure_fn(text_ptr, FONT_SIZE, 0, MAX_WIDTH, 0, 0, 0, false, false);
    const box_w = metrics.width + PAD_H * 2;
    const box_h = metrics.height + PAD_V * 2;

    // Center above anchor
    var tx = anchor_x + (anchor_w - box_w) / 2.0;
    var ty = anchor_y - box_h - OFFSET_Y;

    // Clamp horizontal
    if (tx < MARGIN) tx = MARGIN;
    if (tx + box_w > win_w - MARGIN) tx = win_w - MARGIN - box_w;

    // Flip below anchor if clipped at top
    if (ty < MARGIN) {
        ty = anchor_y + anchor_h + OFFSET_Y;
    }

    // Clamp vertical
    if (ty + box_h > win_h - MARGIN) ty = win_h - MARGIN - box_h;

    // Push full-viewport scissor to escape any parent overflow:hidden clipping
    gpu.pushScissor(0, 0, win_w, win_h);

    // Background + border
    gpu.drawRect(tx, ty, box_w, box_h, BG_R, BG_G, BG_B, BG_A, BORDER_RADIUS, 1, BD_R, BD_G, BD_B, BD_A);

    // Text
    _ = gpu.drawTextWrapped(text_ptr, tx + PAD_H, ty + PAD_V, FONT_SIZE, MAX_WIDTH, TX_R, TX_G, TX_B, TX_A, 0);

    gpu.popScissor();
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub fn telemetryVisible() bool {
    return visible;
}
