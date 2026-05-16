//! Unified Canvas System — Built-in zoom/pan camera + optional custom renderers.
//!
//! Every <Canvas> gets zoom (scroll wheel) and pan (drag) for free.
//! Content is composed with <Canvas.Node gx={} gy={} gw={} gh={}> children
//! which are real framework nodes (Box, Text, etc.) positioned in graph space.
//!
//! Instance-safe: each <Canvas> gets its own camera, selection, and dim state.
//! Node.canvas_id indexes into the instance pool. Instance 0 is the default.

const std = @import("std");
const gpu = @import("../gpu/gpu.zig");

// ── Camera Transform ────────────────────────────────────────────────────

pub const CameraTransform = struct {
    cx: f32, // camera center X in graph space
    cy: f32, // camera center Y in graph space
    scale: f32, // zoom scale factor (1.0 = 1:1)
};

// ── Canvas Instance ─────────────────────────────────────────────────────

pub const MAX_CANVAS_INSTANCES: u8 = 16;

const MAX_CANVAS_CHILDREN: usize = 8192;

pub const CanvasInstance = struct {
    // Camera
    cam_x: f32 = 0,
    cam_y: f32 = 0,
    cam_zoom: f32 = 1.0,

    // Last (viewX/viewY/viewZoom) prop values applied from the cart. When
    // paintCanvasContainer sees new prop values that differ from these, it
    // re-centers the camera. This lets focusWorkerById / programmatic pans
    // override user-driven pan/zoom — without clobbering the camera on every
    // unrelated re-render.
    last_applied_view_x: f32 = 0,
    last_applied_view_y: f32 = 0,
    last_applied_view_zoom: f32 = 1.0,
    last_applied_valid: bool = false,

    // Selection
    hovered_node_idx: ?u16 = null,
    selected_node_idx: ?u16 = null,

    // Per-child dim/flow overrides (indexed by flattened canvas child_idx)
    node_dim: [MAX_CANVAS_CHILDREN]f32 = [_]f32{1.0} ** MAX_CANVAS_CHILDREN,
    flow_override: [MAX_CANVAS_CHILDREN]bool = [_]bool{true} ** MAX_CANVAS_CHILDREN,
    dim_active: bool = false, // true when any dim != 1.0
    flow_active: bool = false, // true when any flow != true

    // Active flag — true once any operation has touched this instance
    active: bool = false,
};

var instances: [MAX_CANVAS_INSTANCES]CanvasInstance = [_]CanvasInstance{.{}} ** MAX_CANVAS_INSTANCES;

fn inst(id: u8) *CanvasInstance {
    return &instances[@min(id, MAX_CANVAS_INSTANCES - 1)];
}

// ── Canvas Renderer Interface (optional, for custom drawing) ────────────

pub const CanvasRenderer = struct {
    /// Custom render pass — draws before Canvas.Node children.
    render_fn: *const fn (x: f32, y: f32, w: f32, h: f32, cam: CameraTransform) void,
};

// ── Registry (for custom renderers — shared across instances) ───────────

const MAX_CANVAS_TYPES = 32;

var type_names: [MAX_CANVAS_TYPES][]const u8 = undefined;
var type_renderers: [MAX_CANVAS_TYPES]CanvasRenderer = undefined;
var type_count: usize = 0;
var initialized: bool = false;

pub fn register(name: []const u8, renderer: CanvasRenderer) void {
    if (type_count >= MAX_CANVAS_TYPES) return;
    for (0..type_count) |i| {
        if (std.mem.eql(u8, type_names[i], name)) {
            type_renderers[i] = renderer;
            return;
        }
    }
    type_names[type_count] = name;
    type_renderers[type_count] = renderer;
    type_count += 1;
}

pub fn get(name: []const u8) ?*const CanvasRenderer {
    for (0..type_count) |i| {
        if (std.mem.eql(u8, type_names[i], name)) return &type_renderers[i];
    }
    return null;
}

// ── Lifecycle ───────────────────────────────────────────────────────────

pub fn init() void {
    if (initialized) return;
    initialized = true;
    for (&instances) |*ci| ci.* = .{};
}

/// Set camera position and zoom for a specific canvas instance.
pub fn setCamera(cx: f32, cy: f32, zoom: f32) void {
    setCameraFor(0, cx, cy, zoom);
}

pub fn setCameraFor(id: u8, cx: f32, cy: f32, zoom: f32) void {
    const ci = inst(id);
    ci.cam_x = cx;
    ci.cam_y = cy;
    ci.cam_zoom = zoom;
    ci.active = true;
}

/// Apply the cart-provided viewX/viewY/viewZoom props if and only if they've
/// changed since the last application. This is how programmatic pans
/// (focusWorkerById setting setViewX/setViewY) override user pan/zoom —
/// re-renders that don't change the prop values leave user input alone.
pub fn applyPropView(id: u8, vx: f32, vy: f32, vz: f32) bool {
    const ci = inst(id);
    if (ci.last_applied_valid and vx == ci.last_applied_view_x and vy == ci.last_applied_view_y and vz == ci.last_applied_view_zoom) {
        return false;
    }
    ci.cam_x = vx;
    ci.cam_y = vy;
    ci.cam_zoom = vz;
    ci.active = true;
    ci.last_applied_view_x = vx;
    ci.last_applied_view_y = vy;
    ci.last_applied_view_zoom = vz;
    ci.last_applied_valid = true;
    return true;
}

// ── Rendering ───────────────────────────────────────────────────────────

pub fn renderCanvas(canvas_type: []const u8, x: f32, y: f32, w: f32, h: f32) void {
    renderCanvasFor(0, canvas_type, x, y, w, h);
}

pub fn renderCanvasFor(id: u8, canvas_type: []const u8, x: f32, y: f32, w: f32, h: f32) void {
    gpu.drawRect(x, y, w, h, 0.03, 0.05, 0.08, 1.0, 0, 0, 0, 0, 0, 0);
    if (get(canvas_type)) |renderer| {
        renderer.render_fn(x, y, w, h, getCameraTransformFor(id, x, y, w, h));
    }
}

pub fn getCameraTransform(_: f32, _: f32, _: f32, _: f32) CameraTransform {
    return getCameraTransformFor(0, 0, 0, 0, 0);
}

pub fn getCameraTransformFor(id: u8, _: f32, _: f32, _: f32, _: f32) CameraTransform {
    const ci = inst(id);
    return .{ .cx = ci.cam_x, .cy = ci.cam_y, .scale = ci.cam_zoom };
}

pub fn screenToGraph(screen_x: f32, screen_y: f32, vp_cx: f32, vp_cy: f32) [2]f32 {
    return screenToGraphFor(0, screen_x, screen_y, vp_cx, vp_cy);
}

pub fn screenToGraphFor(id: u8, screen_x: f32, screen_y: f32, vp_cx: f32, vp_cy: f32) [2]f32 {
    const ci = inst(id);
    if (ci.cam_zoom == 0) return .{ 0, 0 };
    return .{
        (screen_x - vp_cx + ci.cam_x * ci.cam_zoom) / ci.cam_zoom,
        (screen_y - vp_cy + ci.cam_y * ci.cam_zoom) / ci.cam_zoom,
    };
}

// ── Selection ───────────────────────────────────────────────────────────

pub fn setHoveredNode(idx: ?u16) void {
    setHoveredNodeFor(0, idx);
}

pub fn setHoveredNodeFor(id: u8, idx: ?u16) void {
    inst(id).hovered_node_idx = idx;
}

pub fn getHoveredNode() ?u16 {
    return getHoveredNodeFor(0);
}

pub fn getHoveredNodeFor(id: u8) ?u16 {
    return inst(id).hovered_node_idx;
}

pub fn clickNode() void {
    clickNodeFor(0);
}

pub fn clickNodeFor(id: u8) void {
    const ci = inst(id);
    if (ci.hovered_node_idx) |hi| {
        ci.selected_node_idx = if (ci.selected_node_idx != null and ci.selected_node_idx.? == hi) null else hi;
    } else {
        ci.selected_node_idx = null;
    }
}

pub fn getSelectedNode() ?u16 {
    return getSelectedNodeFor(0);
}

pub fn getSelectedNodeFor(id: u8) ?u16 {
    return inst(id).selected_node_idx;
}

pub fn getActiveNode() ?u16 {
    return getActiveNodeFor(0);
}

pub fn getActiveNodeFor(id: u8) ?u16 {
    const ci = inst(id);
    return ci.selected_node_idx orelse ci.hovered_node_idx;
}

// ── Input handlers ──────────────────────────────────────────────────────

pub fn handleScroll(mx: f32, my: f32, delta: f32, vp_w: f32, vp_h: f32) void {
    handleScrollFor(0, mx, my, delta, vp_w, vp_h);
}

pub fn handleScrollFor(id: u8, mx: f32, my: f32, delta: f32, vp_w: f32, vp_h: f32) void {
    const ci = inst(id);
    const old_gx = ci.cam_x + (mx - vp_w / 2) / ci.cam_zoom;
    const old_gy = ci.cam_y + (my - vp_h / 2) / ci.cam_zoom;

    const factor: f32 = if (delta > 0) 1.15 else 1.0 / 1.15;
    ci.cam_zoom = @max(0.05, @min(ci.cam_zoom * factor, 100.0));

    const new_gx = ci.cam_x + (mx - vp_w / 2) / ci.cam_zoom;
    const new_gy = ci.cam_y + (my - vp_h / 2) / ci.cam_zoom;
    ci.cam_x += old_gx - new_gx;
    ci.cam_y += old_gy - new_gy;
}

pub fn handleDrag(dx: f32, dy: f32) void {
    handleDragFor(0, dx, dy);
}

pub fn handleDragFor(id: u8, dx: f32, dy: f32) void {
    const ci = inst(id);
    if (ci.cam_zoom > 0) {
        ci.cam_x -= dx / ci.cam_zoom;
        ci.cam_y -= dy / ci.cam_zoom;
    }
}

// ── Node dim/flow overrides ─────────────────────────────────────────────

pub fn setNodeDim(idx: u16, opacity: f32) void {
    setNodeDimFor(0, idx, opacity);
}

pub fn setNodeDimFor(id: u8, idx: u16, opacity: f32) void {
    const ci = inst(id);
    if (idx < MAX_CANVAS_CHILDREN) {
        ci.node_dim[idx] = opacity;
        if (opacity != 1.0) ci.dim_active = true;
    }
}

pub fn resetNodeDim() void {
    resetNodeDimFor(0);
}

pub fn resetNodeDimFor(id: u8) void {
    const ci = inst(id);
    @memset(&ci.node_dim, 1.0);
    ci.dim_active = false;
}

pub fn setFlowOverride(idx: u16, enabled: bool) void {
    setFlowOverrideFor(0, idx, enabled);
}

pub fn setFlowOverrideFor(id: u8, idx: u16, enabled: bool) void {
    const ci = inst(id);
    if (idx < MAX_CANVAS_CHILDREN) {
        ci.flow_override[idx] = enabled;
        if (!enabled) ci.flow_active = true;
    }
}

pub fn resetFlowOverride() void {
    resetFlowOverrideFor(0);
}

pub fn resetFlowOverrideFor(id: u8) void {
    const ci = inst(id);
    @memset(&ci.flow_override, true);
    ci.flow_active = false;
}

pub fn getNodeDim(idx: u16) f32 {
    return getNodeDimFor(0, idx);
}

pub fn getNodeDimFor(id: u8, idx: u16) f32 {
    const ci = inst(id);
    if (idx < MAX_CANVAS_CHILDREN) return ci.node_dim[idx];
    return 1.0;
}

pub fn getFlowOverride(idx: u16) bool {
    return getFlowOverrideFor(0, idx);
}

pub fn getFlowOverrideFor(id: u8, idx: u16) bool {
    const ci = inst(id);
    if (idx < MAX_CANVAS_CHILDREN) return ci.flow_override[idx];
    return true;
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub const TelemetryCameraState = struct {
    x: f32,
    y: f32,
    zoom: f32,
    type_count: u32,
};

pub fn telemetryCameraState() TelemetryCameraState {
    return telemetryCameraStateFor(0);
}

pub fn cameraIsActive(id: u8) bool {
    return inst(id).active;
}

pub fn telemetryCameraStateFor(id: u8) TelemetryCameraState {
    const ci = inst(id);
    return .{
        .x = ci.cam_x,
        .y = ci.cam_y,
        .zoom = ci.cam_zoom,
        .type_count = @intCast(type_count),
    };
}
