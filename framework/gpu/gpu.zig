//! wgpu-native GPU backend for tsz — core orchestrator.
//!
//! Owns the wgpu instance, adapter, device, queue, surface, and globals
//! uniform buffer. Coordinates the rect, text, and curve pipelines.
//! SDL2 is still used for windowing and events — wgpu gets the
//! native window handle from SDL to create its surface.

const std = @import("std");
const builtin = @import("builtin");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const mathx = @import("../math/root.zig");

const is_web = builtin.cpu.arch == .wasm32;

// SDL only needed on native for window handle + surface creation
const c = if (!is_web) @import("../c.zig").imports else struct {};
const rects = @import("rects.zig");
const text = @import("text.zig");
const curves = @import("curves.zig");
const capsules = @import("capsules.zig");
pub const polys = @import("polys.zig");
pub const gcurve_fill = @import("gcurve_fill.zig");
pub const images = @import("images.zig");
pub const sdf_icons = @import("sdf_icons.zig");
const scene3d = @import("3d.zig");
pub const filters = @import("filters.zig");
const log = @import("../diag/log.zig");

// ════════════════════════════════════════════════════════════════════════
// Re-exports — callers use gpu.drawRect(), gpu.RectInstance, etc.
// ════════════════════════════════════════════════════════════════════════

pub const drawRect = rects.drawRect;
pub const drawRectCorners = rects.drawRectCorners;
pub const drawRectCornersTransformed = rects.drawRectCornersTransformed;
pub const drawRectTransformed = rects.drawRectTransformed;
pub const drawRectShadow = rects.drawRectShadow;
pub const drawRectGradient = rects.drawRectGradient;
pub const drawTextLine = text.drawTextLine;
pub const drawTextWrapped = text.drawTextWrapped;
pub const measureTextLineWidth = text.measureTextLineWidth;
pub const drawColorTextRow = text.drawColorTextRow;
pub const drawSelectionRects = text.drawSelectionRects;
pub const byteIndexAtPos = text.byteIndexAtPos;
pub const getLineHeight = text.getLineHeight;
pub const drawCurve = curves.drawCurve;
pub const drawCubicCurve = curves.drawCubicCurve;
pub const drawCapsule = capsules.drawCapsule;
pub const drawTri = polys.drawTri;
pub const drawTriColored = polys.drawTriColored;
pub const initText = text.initText;
pub const getCharAdvance = text.getCharAdvance;
pub const getCharWidth = text.getCharWidth;
pub const drawGlyphAt = text.drawGlyphAt;
const layout_types = @import("../layout.zig");
pub const resetInlineSlots = text.resetInlineSlots;
pub const setTextEffect = text.setTextEffect;
pub const clearTextEffect = text.clearTextEffect;
pub const setLineHeightOverride = text.setLineHeightOverride;
pub const setLetterSpacing = text.setLetterSpacing;
pub const setBold = text.setBold;
pub const setBoldFace = text.setBoldFace;
pub const setFontFamily = text.setFontFamily;
pub fn getInlineSlotCount() u8 {
    return text.g_inline_slot_count;
}
pub fn getInlineSlots() *const [text.MAX_RECORDED_SLOTS]layout_types.InlineSlot {
    return &text.g_inline_slots;
}

// Type re-exports
pub const RectInstance = rects.RectInstance;
pub const GlyphInstance = text.GlyphInstance;
pub const CurveInstance = curves.CurveInstance;

// ════════════════════════════════════════════════════════════════════════
// GPU operations budget — cross-pipeline per-frame safety limit
// ═══════════════════════════════════════════════════════════��════════════

// Bumped 100K → 5M to allow data-dense workloads (e.g. chart_bench at
// 100 charts × 5000 points = ~500K capsules/frame from polyline alone, plus
// rects, glyphs, curves from the rest of the UI). 100K was a runaway-loop
// safety net; 5M leaves enough headroom for legitimate dense scenes while
// still tripping on actual infinite loops.
pub const GPU_OPS_BUDGET: u32 = 5_000_000;
pub var g_gpu_ops: u32 = 0;

// ════════════════════════════════════════════════════════════════════════
// Core GPU state
// ════════════════════════════════════════════════════════════════════════

var g_instance: ?*wgpu.Instance = null;
var g_surface: ?*wgpu.Surface = null;
var g_vsync_off: bool = false;

// KMS / no-display-server mode: render surfaceless into an offscreen texture
// and scan the result out via DRM (framework/render/kms.zig). Set by the
// engine before gpu.init() when ZIGOS_KMS is active.
const kms = @import("../render/kms.zig");
var g_kms: bool = false;
var g_offscreen: ?*wgpu.Texture = null;
var g_offscreen_view: ?*wgpu.TextureView = null;

/// Enable surfaceless DRM scanout. Must be called before init().
pub fn setKmsMode(on: bool) void {
    g_kms = on;
}

/// (Re)create the offscreen render target used in KMS mode.
fn createOffscreen(w: u32, h: u32) void {
    const device = g_device orelse return;
    if (g_offscreen_view) |v| {
        v.release();
        g_offscreen_view = null;
    }
    if (g_offscreen) |t| {
        t.release();
        g_offscreen = null;
    }
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("kms_scanout"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = g_format,
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.copy_src,
    }) orelse return;
    g_offscreen = tex;
    g_offscreen_view = tex.createView(null);
}

/// Readback the offscreen texture and hand the pixels to the DRM scanout.
/// BGRA8 with 256-aligned rows — kms.present() reconciles the stride.
fn presentKms() void {
    const device = g_device orelse return;
    const queue = g_queue orelse return;
    const texture = g_offscreen orelse return;
    const w = g_width;
    const h = g_height;
    if (w == 0 or h == 0) return;

    const unaligned_bpr = w * 4;
    const bytes_per_row = (unaligned_bpr + 255) & ~@as(u32, 255);
    const buf_size: u64 = @as(u64, bytes_per_row) * @as(u64, h);

    const staging = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("kms_staging"),
        .size = buf_size,
        .usage = wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.map_read,
        .mapped_at_creation = 0,
    }) orelse return;
    defer staging.release();

    const enc = device.createCommandEncoder(&.{}) orelse return;
    enc.copyTextureToBuffer(
        &.{ .texture = texture, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        &.{ .layout = .{ .offset = 0, .bytes_per_row = bytes_per_row, .rows_per_image = h }, .buffer = staging },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const cmd = enc.finish(null) orelse return;
    enc.release();
    queue.submit(&.{cmd});
    cmd.release();

    _ = staging.mapAsync(wgpu.MapModes.read, 0, @intCast(buf_size), .{
        .mode = .allow_process_events,
        .callback = &captureMapCallback,
    });
    _ = device.poll(true, null);

    const mapped_ptr = staging.getConstMappedRange(0, @intCast(buf_size)) orelse return;
    kms.present(@ptrCast(mapped_ptr), w, h, bytes_per_row);
    staging.unmap();
}
var g_adapter: ?*wgpu.Adapter = null;
var g_device: ?*wgpu.Device = null;
var g_queue: ?*wgpu.Queue = null;
// The limits the device actually GRANTED at creation (req_2843) — adapter-real
// on healthy drivers, WebGPU defaults on the fallback path. Zero-init until
// device creation fills it.
var g_device_limits: wgpu.Limits = .{};
var g_format: wgpu.TextureFormat = .bgra8_unorm;
var g_width: u32 = 0;
var g_height: u32 = 0;

// Globals uniform buffer (screen_size) — shared by all pipelines
var g_globals_buffer: ?*wgpu.Buffer = null;

// ════════════════════════════════════════════════════════════════════════
// Canvas transform state
// ════════════════════════════════════════════════════════════════════════

pub const Transform = struct {
    ox: f32,
    oy: f32,
    tx: f32,
    ty: f32,
    scale: f32,
    active: bool,
};

var g_transform_ox: f32 = 0;
var g_transform_oy: f32 = 0;
var g_transform_tx: f32 = 0;
var g_transform_ty: f32 = 0;
var g_transform_scale: f32 = 1.0;
var g_transform_active: bool = false;

/// Set canvas transform. All subsequent draw calls are transformed.
pub fn setTransform(ox: f32, oy: f32, tx: f32, ty: f32, scale: f32) void {
    g_transform_ox = ox;
    g_transform_oy = oy;
    g_transform_tx = tx;
    g_transform_ty = ty;
    g_transform_scale = scale;
    g_transform_active = true;
}

/// Reset transform to identity.
pub fn resetTransform() void {
    g_transform_ox = 0;
    g_transform_oy = 0;
    g_transform_tx = 0;
    g_transform_ty = 0;
    g_transform_scale = 1.0;
    g_transform_active = false;
}

/// Get current transform state (used by sub-pipelines).
pub fn getTransform() Transform {
    return .{
        .ox = g_transform_ox,
        .oy = g_transform_oy,
        .tx = g_transform_tx,
        .ty = g_transform_ty,
        .scale = g_transform_scale,
        .active = g_transform_active,
    };
}

// ════════════════════════════════════════════════════════════════════════
// CSS-style transform stack (rotate / scale / translate around origin)
// ════════════════════════════════════════════════════════════════════════
// 2D affine: pos' = (a*x + c*y + tx, b*x + d*y + ty).
// Identity = {a=1, b=0, c=0, d=1, tx=0, ty=0}.
// Mirrors love2d/cli/runtime/lua/painter.lua applyTransform — visual only,
// does not affect layout positions or hit testing.

pub const Affine = struct {
    a: f32 = 1,
    b: f32 = 0,
    c: f32 = 0,
    d: f32 = 1,
    tx: f32 = 0,
    ty: f32 = 0,

    pub fn identity() Affine {
        return .{};
    }

    pub fn isIdentity(m: Affine) bool {
        return m.a == 1 and m.b == 0 and m.c == 0 and m.d == 1 and m.tx == 0 and m.ty == 0;
    }

    /// Apply the matrix to a point.
    pub fn applyXY(m: Affine, x: f32, y: f32) [2]f32 {
        return .{ m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty };
    }

    /// Right-multiply: out = self * other (other applied first to a point).
    pub fn mul(self: Affine, o: Affine) Affine {
        return .{
            .a = self.a * o.a + self.c * o.b,
            .b = self.b * o.a + self.d * o.b,
            .c = self.a * o.c + self.c * o.d,
            .d = self.b * o.c + self.d * o.d,
            .tx = self.a * o.tx + self.c * o.ty + self.tx,
            .ty = self.b * o.tx + self.d * o.ty + self.ty,
        };
    }

    /// Decompose into rotation (radians), scale_x, scale_y. Assumes no skew/shear.
    pub fn decompose(m: Affine) struct { angle_rad: f32, sx: f32, sy: f32 } {
        const sx = mathx.mat2dScaleX(m.a, m.b);
        const sy = mathx.mat2dScaleY(m.c, m.d);
        const angle = std.math.atan2(m.b, m.a);
        return .{ .angle_rad = angle, .sx = sx, .sy = sy };
    }

    pub fn translation(dx: f32, dy: f32) Affine {
        return .{ .tx = dx, .ty = dy };
    }

    pub fn rotation(rad: f32) Affine {
        const c_ = @cos(rad);
        const s_ = @sin(rad);
        return .{ .a = c_, .b = s_, .c = -s_, .d = c_ };
    }

    pub fn scaling(sx: f32, sy: f32) Affine {
        return .{ .a = sx, .d = sy };
    }
};

const NODE_MATRIX_STACK_DEPTH: usize = 64;
var g_node_matrix_stack: [NODE_MATRIX_STACK_DEPTH]Affine = [_]Affine{.{}} ** NODE_MATRIX_STACK_DEPTH;
var g_node_matrix_top: usize = 0; // index of current top — stack[0] is identity
var g_node_matrix_active: bool = false;

/// Push the current node-transform matrix onto the stack so callers can compose
/// new transforms and later pop back. Saturates silently at max depth.
pub fn pushNodeMatrix() void {
    if (g_node_matrix_top + 1 >= NODE_MATRIX_STACK_DEPTH) return;
    g_node_matrix_top += 1;
    g_node_matrix_stack[g_node_matrix_top] = g_node_matrix_stack[g_node_matrix_top - 1];
}

/// Pop the topmost node matrix. Saturates at depth 0.
pub fn popNodeMatrix() void {
    if (g_node_matrix_top == 0) return;
    g_node_matrix_top -= 1;
    g_node_matrix_active = !g_node_matrix_stack[g_node_matrix_top].isIdentity();
}

/// Compose the CSS-style transform onto the top of the matrix stack:
///   M_new = M_old * T(pivot) * R(rotation) * S(sx, sy) * T(-pivot) * T(tx, ty)
/// pivot is in the same coordinate space the caller used to position the node
/// (typically screen pixels at the time of paint).
pub fn composeNodeTransform(
    pivot_x: f32,
    pivot_y: f32,
    rotation_rad: f32,
    scale_x: f32,
    scale_y: f32,
    translate_x: f32,
    translate_y: f32,
) void {
    var m = Affine.translation(pivot_x, pivot_y)
        .mul(Affine.rotation(rotation_rad))
        .mul(Affine.scaling(scale_x, scale_y))
        .mul(Affine.translation(-pivot_x, -pivot_y));
    if (translate_x != 0 or translate_y != 0) {
        m = m.mul(Affine.translation(translate_x, translate_y));
    }
    g_node_matrix_stack[g_node_matrix_top] = g_node_matrix_stack[g_node_matrix_top].mul(m);
    g_node_matrix_active = g_node_matrix_active or !g_node_matrix_stack[g_node_matrix_top].isIdentity();
}

/// Returns the current top of the node-matrix stack.
pub fn getNodeMatrix() Affine {
    return g_node_matrix_stack[g_node_matrix_top];
}

/// True when a non-identity node transform is in effect.
pub fn nodeMatrixActive() bool {
    return g_node_matrix_active;
}

/// Apply both the canvas pan/zoom transform and the node CSS transform to a
/// point. Order: node-matrix first (closest to local space), then canvas.
pub fn applyXY(x: f32, y: f32) [2]f32 {
    var p: [2]f32 = .{ x, y };
    if (g_node_matrix_active) p = g_node_matrix_stack[g_node_matrix_top].applyXY(p[0], p[1]);
    if (g_transform_active) {
        const px = (p[0] - g_transform_ox) * g_transform_scale + g_transform_ox + g_transform_tx;
        const py = (p[1] - g_transform_oy) * g_transform_scale + g_transform_oy + g_transform_ty;
        p = .{ px, py };
    }
    return p;
}

/// Combined effective scale on the X axis (canvas zoom × node-matrix sx).
pub fn effectiveScaleX() f32 {
    var s: f32 = 1;
    if (g_node_matrix_active) {
        const nm = g_node_matrix_stack[g_node_matrix_top];
        s *= mathx.mat2dScaleX(nm.a, nm.b);
    }
    if (g_transform_active) s *= g_transform_scale;
    return s;
}

pub fn effectiveScaleY() f32 {
    var s: f32 = 1;
    if (g_node_matrix_active) {
        const nm = g_node_matrix_stack[g_node_matrix_top];
        s *= mathx.mat2dScaleY(nm.c, nm.d);
    }
    if (g_transform_active) s *= g_transform_scale;
    return s;
}

/// Decomposed rotation of the active node matrix (radians). 0 if inactive.
pub fn nodeRotationRad() f32 {
    if (!g_node_matrix_active) return 0;
    const m = g_node_matrix_stack[g_node_matrix_top];
    return std.math.atan2(m.b, m.a);
}

/// Resolve a rect (top-left x/y, width, height) through the canvas pan/zoom
/// transform AND the node matrix stack. Returns the screen-space rect plus a
/// rotation_deg the caller should apply via the per-rect rotation field on the
/// shader (which rotates around the rect's own center). The returned (x, y) is
/// the unrotated top-left so that `(x + w/2, y + h/2)` is the correct rotation
/// pivot — matching what the rect/glyph shaders expect.
pub const TransformedRect = struct {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    rotation_deg: f32,
    scale_x: f32 = 1,
    scale_y: f32 = 1,
};

pub fn resolveRect(x: f32, y: f32, w: f32, h: f32) TransformedRect {
    var ox = x;
    var oy = y;
    var ow = w;
    var oh = h;
    var rot_deg: f32 = 0;

    if (g_node_matrix_active) {
        const m = g_node_matrix_stack[g_node_matrix_top];
        const sx = mathx.mat2dScaleX(m.a, m.b);
        const sy = mathx.mat2dScaleY(m.c, m.d);
        const angle = std.math.atan2(m.b, m.a);
        const cx = x + w / 2;
        const cy = y + h / 2;
        const new_center = m.applyXY(cx, cy);
        ow = w * sx;
        oh = h * sy;
        ox = new_center[0] - ow / 2;
        oy = new_center[1] - oh / 2;
        rot_deg = angle * 180.0 / std.math.pi;
    }

    if (g_transform_active) {
        ox = (ox - g_transform_ox) * g_transform_scale + g_transform_ox + g_transform_tx;
        oy = (oy - g_transform_oy) * g_transform_scale + g_transform_oy + g_transform_ty;
        ow *= g_transform_scale;
        oh *= g_transform_scale;
    }

    return .{ .x = ox, .y = oy, .w = ow, .h = oh, .rotation_deg = rot_deg };
}

// ════════════════════════════════════════════════════════════════════════
// Accessors for sub-pipelines
// ════════════════════════════════════════════════════════════════════════

pub fn getDevice() ?*wgpu.Device {
    return g_device;
}

pub fn getQueue() ?*wgpu.Queue {
    return g_queue;
}

/// The per-buffer ceiling the device GRANTED at creation (req_2843). Pool
/// growers size against this — it is the machine's real wall, typically
/// gigabytes on desktop GPUs. Falls back to the WebGPU-default 256 MiB when
/// the driver reported nothing usable.
pub fn deviceMaxBufferSize() u64 {
    const m = g_device_limits.max_buffer_size;
    if (m == 0 or m == std.math.maxInt(u64)) return 268_435_456;
    return m;
}

pub fn getWidth() u32 {
    return g_width;
}

pub fn getHeight() u32 {
    return g_height;
}

pub fn getFormat() wgpu.TextureFormat {
    return g_format;
}

// ════════════════════════════════════════════════════════════════════════
// Frame capture — wgpu equivalent of love.graphics.captureScreenshot()
// ════════════════════════════════════════════════════════════════════════

/// Callback receives: pixel data (BGRA8), width, height, stride.
/// The pixel data is only valid for the duration of the callback.
pub const CaptureCallback = *const fn (io: std.Io, pixels: [*]const u8, w: u32, h: u32, stride: u32) void;
var g_capture_cb: ?CaptureCallback = null;
var g_capture_requested: bool = false;

/// Request a single-frame capture. The callback fires during the next frame().
/// Matches the Love2D pattern: captureScreenshot(callback).
pub fn captureScreenshot(cb: CaptureCallback) void {
    g_capture_cb = cb;
    g_capture_requested = true;
}

/// Request continuous capture (recording). Callback fires every frame.
pub fn startCapture(cb: CaptureCallback) void {
    g_capture_cb = cb;
    g_capture_requested = true;
}

pub fn stopCapture() void {
    g_capture_cb = null;
    g_capture_requested = false;
}

pub fn isCapturing() bool {
    return g_capture_requested;
}

/// Perform the actual readback. Called inside frame() after queue.submit(),
/// before surface.present(). Uses a second encoder to copy texture→buffer,
/// maps synchronously, and delivers pixels to the callback.
fn performCapture(io: std.Io, device: *wgpu.Device, q: *wgpu.Queue, texture: *wgpu.Texture) void {
    const cb = g_capture_cb orelse return;
    const w = g_width;
    const h = g_height;
    if (w == 0 or h == 0) return;

    // bytes_per_row must be aligned to 256 for wgpu copyTextureToBuffer
    const unaligned_bpr = w * 4;
    const bytes_per_row = (unaligned_bpr + 255) & ~@as(u32, 255);
    const buf_size: u64 = @as(u64, bytes_per_row) * @as(u64, h);

    // Create staging buffer (map_read + copy_dst)
    const staging = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("capture_staging"),
        .size = buf_size,
        .usage = wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.map_read,
        .mapped_at_creation = 0,
    }) orelse return;
    defer staging.release();

    // Copy surface texture → staging buffer
    const enc = device.createCommandEncoder(&.{}) orelse return;
    enc.copyTextureToBuffer(
        &.{ .texture = texture, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        &.{ .layout = .{ .offset = 0, .bytes_per_row = bytes_per_row, .rows_per_image = h }, .buffer = staging },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const cmd = enc.finish(null) orelse return;
    enc.release();
    q.submit(&.{cmd});
    cmd.release();

    // Map synchronously — blocking poll until map completes
    _ = staging.mapAsync(wgpu.MapModes.read, 0, @intCast(buf_size), .{
        .mode = .allow_process_events,
        .callback = &captureMapCallback,
    });
    _ = device.poll(true, null);

    // Read mapped data
    const mapped_ptr = staging.getConstMappedRange(0, @intCast(buf_size)) orelse return;
    const mapped: [*]const u8 = @ptrCast(mapped_ptr);

    // Deliver to callback (pixels are BGRA8, may have row padding)
    cb(io, mapped, w, h, bytes_per_row);

    staging.unmap();

    // Single-shot: clear after delivery
    if (g_capture_cb != null and !g_capture_requested) {
        // continuous mode — keep callback
    }
}

fn captureMapCallback(_: wgpu.MapAsyncStatus, _: wgpu.StringView, _: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {
    // Nothing to do — we use blocking poll
}

pub fn getGlobalsBuffer() ?*wgpu.Buffer {
    return g_globals_buffer;
}

// ════════════════════════════════════════════════════════════════════════
// Draw boundaries — scissor transitions + image/effect z-order breaks
// ════════════════════════════════════════════════════════════════════════

const ScissorSegment = struct {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    rect_start: u32,
    glyph_start: u32,
    curve_start: u32,
    capsule_start: u32,
    poly_start: u32,
    image_start: u32,
    sdf_icon_start: u32,
};

const ZERO_SCISSOR_SEGMENT = ScissorSegment{
    .x = 0,
    .y = 0,
    .w = 0,
    .h = 0,
    .rect_start = 0,
    .glyph_start = 0,
    .curve_start = 0,
    .capsule_start = 0,
    .poly_start = 0,
    .image_start = 0,
    .sdf_icon_start = 0,
};

// Scissor history for clipped subtrees (overflow: hidden, ScrollView,
// StaticSurface capture). Each push + pop adds entries; at 1000 cells with
// `<Icon>` Boxes (overflow: hidden) the prior 768 was exhausted before the
// last row drew. 4096 covers stress-grid cardinality with headroom.
const MAX_SCISSOR_SEGMENTS = 4096;
var g_scissor_segments: [MAX_SCISSOR_SEGMENTS]ScissorSegment = undefined;
var g_scissor_count: usize = 0;

// Scissor stack for nested clips
const MAX_SCISSOR_STACK = 16;
var g_scissor_stack: [MAX_SCISSOR_STACK]ScissorSegment = undefined;
var g_scissor_depth: usize = 0;

pub const ActiveScissor = struct {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
};

fn sameBoundary(a: ScissorSegment, b: ScissorSegment) bool {
    return a.x == b.x and a.y == b.y and a.w == b.w and a.h == b.h and
        a.rect_start == b.rect_start and a.glyph_start == b.glyph_start and
        a.curve_start == b.curve_start and a.capsule_start == b.capsule_start and
        a.poly_start == b.poly_start and a.image_start == b.image_start and
        a.sdf_icon_start == b.sdf_icon_start;
}

fn recordBoundary(x: u32, y: u32, w: u32, h: u32, image_start: u32) void {
    if (g_scissor_count >= MAX_SCISSOR_SEGMENTS) return;

    const seg = ScissorSegment{
        .x = x,
        .y = y,
        .w = w,
        .h = h,
        .rect_start = @intCast(rects.count()),
        .glyph_start = @intCast(text.count()),
        .curve_start = @intCast(curves.count()),
        .capsule_start = @intCast(capsules.count()),
        .poly_start = @intCast(polys.count()),
        .image_start = image_start,
        .sdf_icon_start = @intCast(sdf_icons.count()),
    };

    if (g_scissor_count > 0 and sameBoundary(g_scissor_segments[g_scissor_count - 1], seg)) return;
    g_scissor_segments[g_scissor_count] = seg;
    g_scissor_count += 1;
}

pub fn recordImageBoundary(image_start: u32) void {
    if (g_scissor_depth > 0) {
        const clip = g_scissor_stack[g_scissor_depth - 1];
        recordBoundary(clip.x, clip.y, clip.w, clip.h, image_start);
    } else {
        recordBoundary(0, 0, g_width, g_height, image_start);
    }
}

pub fn pushScissor(x: f32, y: f32, w: f32, h: f32) void {
    // Floor position, ceil the far edge, so the scissor fully contains the
    // fractional rect.  Without this, canvas zoom scales produce fractional
    // coordinates where truncating y can place the scissor 1px below the
    // first glyph scanline — clipping the top or bottom of text depending
    // on which direction the rounding error falls.
    const fx = if (x > 0) @floor(x) else 0;
    const fy = if (y > 0) @floor(y) else 0;
    var sx: u32 = @intFromFloat(fx);
    var sy: u32 = @intFromFloat(fy);
    var sw: u32 = if (w > 0) @intFromFloat(@ceil(x - fx + w)) else 0;
    var sh: u32 = if (h > 0) @intFromFloat(@ceil(y - fy + h)) else 0;

    // Intersect with parent scissor
    if (g_scissor_depth > 0) {
        const parent = g_scissor_stack[g_scissor_depth - 1];
        const px2 = parent.x + parent.w;
        const py2 = parent.y + parent.h;
        const nx = @max(sx, parent.x);
        const ny = @max(sy, parent.y);
        const nx2 = @min(sx + sw, px2);
        const ny2 = @min(sy + sh, py2);
        sx = nx;
        sy = ny;
        sw = if (nx2 > nx) nx2 - nx else 0;
        sh = if (ny2 > ny) ny2 - ny else 0;
    }

    // Clamp to surface dimensions — wgpu requires x+w <= width AND y+h <= height
    if (sx >= g_width) {
        sx = 0;
        sw = 0;
    }
    if (sy >= g_height) {
        sy = 0;
        sh = 0;
    }
    if (sx + sw > g_width) sw = g_width - sx;
    if (sy + sh > g_height) sh = g_height - sy;

    // Record segment boundary
    recordBoundary(sx, sy, sw, sh, @intCast(images.count()));

    // Push to stack
    if (g_scissor_depth < MAX_SCISSOR_STACK) {
        g_scissor_stack[g_scissor_depth] = .{
            .x = sx,
            .y = sy,
            .w = sw,
            .h = sh,
            .rect_start = 0,
            .glyph_start = 0,
            .curve_start = 0,
            .capsule_start = 0,
            .poly_start = 0,
            .image_start = 0,
            .sdf_icon_start = 0,
        };
        g_scissor_depth += 1;
    }
}

pub fn popScissor() void {
    if (g_scissor_depth > 0) g_scissor_depth -= 1;

    // Record segment boundary for parent scissor (or full viewport)
    if (g_scissor_depth > 0) {
        const parent = g_scissor_stack[g_scissor_depth - 1];
        recordBoundary(parent.x, parent.y, parent.w, parent.h, @intCast(images.count()));
    } else {
        recordBoundary(0, 0, g_width, g_height, @intCast(images.count()));
    }
}

pub fn getActiveScissor() ?ActiveScissor {
    if (g_scissor_depth == 0) return null;
    const clip = g_scissor_stack[g_scissor_depth - 1];
    return .{ .x = clip.x, .y = clip.y, .w = clip.w, .h = clip.h };
}

// ════════════════════════════════════════════════════════════════════════
// Static surfaces — GPU render-to-texture cache for static subtrees
// ════════════════════════════════════════════════════════════════════════

pub const PrimitiveCounts = struct {
    rects: u32 = 0,
    glyphs: u32 = 0,
    curves: u32 = 0,
    capsules: u32 = 0,
    polys: u32 = 0,
    images: u32 = 0,
};

pub const StaticSurfaceToken = struct {
    entry_index: usize,
    width: u32,
    height: u32,
};

pub const ScissorSnapshot = struct {
    depth: usize,
    stack: [MAX_SCISSOR_STACK]ScissorSegment,
};

const StaticSurfaceEntry = struct {
    key_hash: u64 = 0,
    key_len: usize = 0,
    key_sample_len: u8 = 0,
    key_sample: [64]u8 = [_]u8{0} ** 64,
    width: u32 = 0,
    height: u32 = 0,
    texture: ?*wgpu.Texture = null,
    view: ?*wgpu.TextureView = null,
    sampler: ?*wgpu.Sampler = null,
    bind_group: ?*wgpu.BindGroup = null,
    bind_group_3d: ?*wgpu.BindGroup = null,
    ready: bool = false,
    active: bool = false,
    warmup_started_frame: u64 = 0,
    ready_frame: u64 = 0,
    /// Frame on which this entry's texture was last fully rendered. Compared
    /// against the surface node's subtree-mutation stamp at queue time: if
    /// any descendant was touched after this, the cached texture is stale
    /// and the surface re-captures.
    captured_frame: u64 = 0,
    // Filter mode — when true, this entry feeds a post-process shader
    // pass instead of being blitted as a plain image quad. The entry is
    // never marked ready=true, so the subtree re-renders every frame and
    // animations inside the filter keep playing.
    is_filter: bool = false,
    filter_uniform_buf: ?*wgpu.Buffer = null,
    filter_bind_group: ?*wgpu.BindGroup = null,
    // BORROWED view: an externally-owned texture (a materialized shader from
    // effects) installed via installStaticSurfaceView. This entry samples it but
    // never frees it — its owner does. Only the sampler / 3D bind group below
    // are this entry's to release.
    borrowed: bool = false,
};

const StaticSurfaceCapture = struct {
    entry_index: usize = 0,
    width: u32 = 0,
    height: u32 = 0,
    start: PrimitiveCounts = .{},
    end: PrimitiveCounts = .{},
    is_filter: bool = false,
    filter: filters.Filter = .invert,
    filter_intensity: f32 = 1.0,
    filter_x: f32 = 0,
    filter_y: f32 = 0,
    filter_w: f32 = 0,
    filter_h: f32 = 0,
};

// Cached-texture pool. Each entry holds one wgpu.Texture + view + sampler
// + bind group. Bumped from 512 so a typical settings/dashboard page (40+
// model cards × possibly nested cached subtrees) doesn't fall through to
// the uncached paint path mid-page once the pool fills.
const MAX_STATIC_SURFACES = 2048;
// Per-frame capture queue (subset of surfaces that recapture this frame).
// Same bound — initial mount of a 1000-card grid would otherwise drop
// captures past the 513th card.
const MAX_STATIC_CAPTURES = 2048;
var g_static_entries: [MAX_STATIC_SURFACES]StaticSurfaceEntry = [_]StaticSurfaceEntry{.{}} ** MAX_STATIC_SURFACES;
var g_static_captures: [MAX_STATIC_CAPTURES]StaticSurfaceCapture = [_]StaticSurfaceCapture{.{}} ** MAX_STATIC_CAPTURES;
var g_static_capture_count: usize = 0;
const MAX_STATIC_CAPTURE_TRACE: usize = 1024;
var g_last_static_capture_trace: [MAX_STATIC_CAPTURE_TRACE]u8 = [_]u8{0} ** MAX_STATIC_CAPTURE_TRACE;
var g_last_static_capture_trace_len: usize = 0;
var g_last_static_capture_count: usize = 0;

pub fn primitiveCounts() PrimitiveCounts {
    return .{
        .rects = @intCast(rects.count()),
        .glyphs = @intCast(text.count()),
        .curves = @intCast(curves.count()),
        .capsules = @intCast(capsules.count()),
        .polys = @intCast(polys.count()),
        .images = @intCast(images.count()),
    };
}

fn staticKeyHash(key: []const u8) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(key);
    return hasher.final();
}

fn staticScale(v: f32) f32 {
    return @max(1.0, @min(v, 4.0));
}

fn staticDim(v: f32, scale_f: f32) u32 {
    if (v <= 0) return 0;
    return @intFromFloat(@max(@as(f32, 1), @ceil(v * staticScale(scale_f))));
}

fn findStaticEntry(hash: u64, key_len: usize) ?usize {
    for (g_static_entries[0..], 0..) |entry, i| {
        if (entry.active and entry.key_hash == hash and entry.key_len == key_len) return i;
    }
    return null;
}

// ── Deferred release graveyard (req_2743) ────────────────────────────────────
// A static-surface entry's resources may be released MID-PAINT: ensureStaticEntry
// hits the resize path when the SAME key is requested at a new size (two mounts of
// one staticKey at different pixel sizes — e.g. a cached preview drawn in a panel
// and again in a popover). Image quads queued EARLIER in that same frame still
// hold the entry's old bind-group pointer (images.zig stores raw pointers), so an
// immediate release meant wgpu panicked at render: "BindGroup is no longer alive".
// Releases park here instead and drain in frame() AFTER queue.submit — the same
// point scene3d frees its deferred render targets.
const DeferredGpuRelease = union(enum) {
    bind_group: *wgpu.BindGroup,
    buffer: *wgpu.Buffer,
    sampler: *wgpu.Sampler,
    view: *wgpu.TextureView,
    texture: *wgpu.Texture,
};
const MAX_DEFERRED_RELEASES = 4096;
var g_deferred_releases: [MAX_DEFERRED_RELEASES]DeferredGpuRelease = undefined;
var g_deferred_release_count: usize = 0;

fn releaseDeferredItem(item: DeferredGpuRelease) void {
    switch (item) {
        .bind_group => |bg| bg.release(),
        .buffer => |buf| buf.release(),
        .sampler => |s| s.release(),
        .view => |v| v.release(),
        .texture => |t| t.release(),
    }
}

fn deferRelease(item: DeferredGpuRelease) void {
    if (g_deferred_release_count >= MAX_DEFERRED_RELEASES) {
        // Graveyard full — 4096 releases in one frame means something upstream is
        // thrashing; release now (accepting the rare mid-frame risk) over leaking.
        releaseDeferredItem(item);
        return;
    }
    g_deferred_releases[g_deferred_release_count] = item;
    g_deferred_release_count += 1;
}

fn drainDeferredReleases() void {
    for (g_deferred_releases[0..g_deferred_release_count]) |item| releaseDeferredItem(item);
    g_deferred_release_count = 0;
}

fn releaseStaticResources(entry: *StaticSurfaceEntry) void {
    if (entry.filter_bind_group) |bg| deferRelease(.{ .bind_group = bg });
    if (entry.filter_uniform_buf) |buf| deferRelease(.{ .buffer = buf });
    if (entry.bind_group_3d) |bg| deferRelease(.{ .bind_group = bg });
    if (entry.bind_group) |bg| deferRelease(.{ .bind_group = bg });
    if (entry.sampler) |sampler| deferRelease(.{ .sampler = sampler });
    // A borrowed view/texture is owned elsewhere (effects' material instance) —
    // free only the resources this entry created (sampler + bind groups above).
    if (!entry.borrowed) {
        if (entry.view) |view| deferRelease(.{ .view = view });
        if (entry.texture) |texture| deferRelease(.{ .texture = texture });
    }
    entry.filter_bind_group = null;
    entry.filter_uniform_buf = null;
    entry.bind_group_3d = null;
    entry.bind_group = null;
    entry.sampler = null;
    entry.view = null;
    entry.texture = null;
    entry.borrowed = false;
    entry.ready = false;
}

fn deinitStaticSurfaces() void {
    for (&g_static_entries) |*entry| {
        releaseStaticResources(entry);
        entry.* = .{};
    }
    g_static_capture_count = 0;
    // Teardown: no next frame() will drain the graveyard — flush it now.
    drainDeferredReleases();
}

fn ensureStaticEntry(key: []const u8, hash: u64, key_len: usize, width: u32, height: u32) ?usize {
    if (width == 0 or height == 0) return null;
    const device = g_device orelse return null;

    const idx = findStaticEntry(hash, key_len) orelse blk: {
        for (g_static_entries[0..], 0..) |entry, i| {
            if (!entry.active) {
                g_static_entries[i] = .{
                    .key_hash = hash,
                    .key_len = key_len,
                    .active = true,
                    .warmup_started_frame = g_frame_counter,
                    .ready_frame = g_frame_counter,
                };
                break :blk i;
            }
        }
        return null;
    };

    const entry = &g_static_entries[idx];
    const sample_len = @min(key_len, entry.key_sample.len);
    if (entry.key_sample_len == 0 or entry.key_hash != hash or entry.key_len != key_len) {
        @memset(&entry.key_sample, 0);
        if (sample_len > 0) @memcpy(entry.key_sample[0..sample_len], key[0..sample_len]);
        entry.key_sample_len = @intCast(sample_len);
    }
    if (entry.texture != null and entry.width == width and entry.height == height) return idx;

    releaseStaticResources(entry);
    entry.key_hash = hash;
    entry.key_len = key_len;
    @memset(&entry.key_sample, 0);
    if (sample_len > 0) @memcpy(entry.key_sample[0..sample_len], key[0..sample_len]);
    entry.key_sample_len = @intCast(sample_len);
    entry.width = width;
    entry.height = height;
    entry.active = true;
    entry.warmup_started_frame = g_frame_counter;
    entry.ready_frame = g_frame_counter;

    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("static_surface"),
        .size = .{ .width = width, .height = height, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = g_format,
        // copy_src: readbackStaticSurface (the decal pixel bake) copies the
        // captured texture back to bytes — same surface, one extra usage bit.
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_src,
    }) orelse return null;
    const view = tex.createView(null) orelse {
        tex.release();
        return null;
    };
    const sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    }) orelse {
        view.release();
        tex.release();
        return null;
    };
    const bg = images.createBindGroup(view, sampler) orelse {
        sampler.release();
        view.release();
        tex.release();
        return null;
    };

    entry.texture = tex;
    entry.view = view;
    entry.sampler = sampler;
    entry.bind_group = bg;
    entry.ready = false;
    return idx;
}

pub fn staticSurfaceReady(key: []const u8, width_f: f32, height_f: f32, scale_f: f32, dirty_frame: u64) bool {
    const width = staticDim(width_f, scale_f);
    const height = staticDim(height_f, scale_f);
    const idx = findStaticEntry(staticKeyHash(key), key.len) orelse return false;
    const entry = g_static_entries[idx];
    if (!(entry.ready and entry.width == width and entry.height == height and entry.bind_group != null)) return false;
    // Stale: the source subtree was mutated after the texture was captured.
    // Treat as cache miss so the paint loop falls through to recapture.
    if (entry.captured_frame < dirty_frame) return false;
    return true;
}

/// Public read-only accessor for the global frame counter. The host (v8_app)
/// uses this to stamp `subtree_last_mutated_frame` on Nodes so StaticSurface
/// can detect cache staleness.
pub fn frameCounter() u64 {
    return g_frame_counter;
}

fn staticSurfaceIntroProgress(entry: *const StaticSurfaceEntry, intro_frames: u16) f32 {
    if (intro_frames == 0) return 1;
    const age: f32 = @floatFromInt(g_frame_counter -| entry.ready_frame);
    const total: f32 = @floatFromInt(intro_frames);
    const t = @min(1.0, (age + 1.0) / @max(1.0, total));
    return 1.0 - std.math.pow(f32, 1.0 - t, 3.0);
}

fn queueStaticSurfaceQuad(entry: *const StaticSurfaceEntry, x: f32, y: f32, width_f: f32, height_f: f32, opacity: f32, intro_frames: u16) bool {
    const bg = entry.bind_group orelse return false;
    const t = staticSurfaceIntroProgress(entry, intro_frames);
    const scale = 0.985 + 0.015 * t;
    const draw_w = width_f * scale;
    const draw_h = height_f * scale;
    const draw_x = x + (width_f - draw_w) * 0.5;
    const draw_y = y + (height_f - draw_h) * 0.5;
    images.queueQuadNoFlip(draw_x, draw_y, draw_w, draw_h, opacity * t, bg);
    return true;
}

pub fn queueStaticSurface(key: []const u8, x: f32, y: f32, width_f: f32, height_f: f32, opacity: f32, intro_frames: u16, scale_f: f32, dirty_frame: u64) bool {
    if (!staticSurfaceReady(key, width_f, height_f, scale_f, dirty_frame)) return false;
    const idx = findStaticEntry(staticKeyHash(key), key.len) orelse return false;
    return queueStaticSurfaceQuad(&g_static_entries[idx], x, y, width_f, height_f, opacity, intro_frames);
}

pub fn staticSurfaceWarming(key: []const u8, width_f: f32, height_f: f32, warmup_frames: u16, scale_f: f32, dirty_frame: u64) bool {
    if (warmup_frames == 0) return false;
    const width = staticDim(width_f, scale_f);
    const height = staticDim(height_f, scale_f);
    const idx = ensureStaticEntry(key, staticKeyHash(key), key.len, width, height) orelse return false;
    const entry = &g_static_entries[idx];
    if (entry.ready) {
        // A captured-and-ready entry that's now stale must skip the warming
        // gate so the paint loop reaches `beginStaticSurfaceCapture` and
        // recaptures immediately. Warming is for the FIRST capture only.
        if (entry.captured_frame < dirty_frame) return false;
        return false;
    }
    const age = g_frame_counter -| entry.warmup_started_frame;
    return age < warmup_frames;
}

/// Return a 3D-pipeline-compatible bind group for a StaticSurface texture.
/// The bind group uses the Scene3D diffuse layout (texture@0, sampler@1)
/// and is cached on the StaticSurfaceEntry so repeated lookups are free.
///
/// Unlike the 2D paint path, we do NOT require entry.ready == true. The
/// 2D path uses `ready` to avoid compositing a stale quad while a new
/// capture is in flight. For 3D mesh texturing, the previous frame's
/// texture content is still valid in GPU memory until drawAll() overwrites
/// it. This prevents a chicken-and-egg where the StaticSurface is always
/// stale relative to the Scene3D render (both are in the same paint loop,
/// but the 3D scene is drawn before the StaticSurface GPU capture finishes).
/// Resolver injected by gpu/paintable.zig (lazily, on its first ensure) so a
/// Scene3D mesh whose `textureKey` names a paintable resolves to it. A fn
/// pointer instead of an @import keeps the paintable build-gate intact (no
/// resolver registered ⇒ paintable not compiled ⇒ this stays null) and avoids
/// an import cycle (paintable imports gpu.zig, not the reverse).
const PaintableResolver = *const fn (key: []const u8) ?*wgpu.BindGroup;
var g_paintable_resolver: ?PaintableResolver = null;
pub fn setPaintableResolver(f: PaintableResolver) void {
    g_paintable_resolver = f;
}

/// Scene3D diffuse texture layout + nearest sampler, exposed so paintable.zig
/// can build a mesh-sampling bind group matching the 3D pipeline (binding 0 =
/// texture, binding 1 = the .non_filtering nearest sampler — req_1321).
pub fn scene3dTexLayout() ?*wgpu.BindGroupLayout {
    return scene3d.getTexBindGroupLayout();
}
pub fn scene3dDiffuseSampler() ?*wgpu.Sampler {
    return scene3d.getDiffuseSampler();
}

/// Drop the retained 3D-geometry intern caches on dev hot-reload (see
/// scene3d.resetForReload). Without it the append-only bump caches accumulate
/// dead geometry across reloads until they overflow and silently drop meshes.
pub fn scene3dResetForReload() void {
    scene3d.resetForReload();
}

pub fn staticSurfaceBindGroup3D(key: []const u8) ?*wgpu.BindGroup {
    const idx = findStaticEntry(staticKeyHash(key), key.len) orelse {
        // Not a captured StaticSurface — try a paintable of the same key (the
        // Studio pixel painter installs its RGBA texture this way).
        if (g_paintable_resolver) |resolve| return resolve(key);
        return null;
    };
    const entry = &g_static_entries[idx];
    if (entry.view == null or entry.sampler == null) return null;
    if (entry.bind_group_3d) |bg| return bg;

    const layout_ = scene3d.getTexBindGroupLayout() orelse return null;
    const device = getDevice() orelse return null;
    // The Scene3D diffuse layout is .non_filtering (nearest, no cross-slot blend —
    // req_1321), so bind the matching nearest diffuse sampler, NOT the surface's own
    // (filtering) 2D-composite sampler — mixing them is a wgpu validation error/crash.
    const samp_3d = scene3d.getDiffuseSampler() orelse return null;
    const entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .texture_view = entry.view.? },
        .{ .binding = 1, .sampler = samp_3d },
    };
    entry.bind_group_3d = device.createBindGroup(&.{
        .layout = layout_,
        .entry_count = entries.len,
        .entries = &entries,
    }) orelse return null;
    return entry.bind_group_3d;
}

/// Install an externally-owned texture `view` as the StaticSurface keyed `key`,
/// so a 3D mesh with scene3d_tex_key=key samples it (via staticSurfaceBindGroup3D
/// above). The view is BORROWED — its owner (effects' materialized shader) frees
/// it; this entry only owns the sampler + the lazily-built 3D bind group. The
/// sampler REPEATS so a 1-tile material look tiles across a face. This is the
/// install half of the shared shader→texture primitive (gpu/material_tex.zig).
pub fn installStaticSurfaceView(key: []const u8, view: *wgpu.TextureView, width: u32, height: u32) bool {
    const device = g_device orelse return false;
    const hash = staticKeyHash(key);
    const key_len = key.len;
    const idx = findStaticEntry(hash, key_len) orelse blk: {
        for (g_static_entries[0..], 0..) |entry, i| {
            if (!entry.active) {
                g_static_entries[i] = .{ .key_hash = hash, .key_len = key_len, .active = true };
                break :blk i;
            }
        }
        return false; // pool full
    };
    const entry = &g_static_entries[idx];
    if (entry.borrowed and entry.view == view and entry.sampler != null) return true; // already installed
    releaseStaticResources(entry);
    entry.key_hash = hash;
    entry.key_len = key_len;
    const sample_len = @min(key_len, entry.key_sample.len);
    @memset(&entry.key_sample, 0);
    if (sample_len > 0) @memcpy(entry.key_sample[0..sample_len], key[0..sample_len]);
    entry.key_sample_len = @intCast(sample_len);
    entry.width = width;
    entry.height = height;
    entry.active = true;
    const sampler = device.createSampler(&.{
        .address_mode_u = .repeat,
        .address_mode_v = .repeat,
        .mag_filter = .linear,
        .min_filter = .linear,
    }) orelse return false;
    entry.view = view; // borrowed
    entry.sampler = sampler;
    entry.borrowed = true;
    entry.ready = true;
    return true;
}

/// Read a CAPTURED static surface's pixels back to CPU bytes (the decal
/// pixel bake, DECALPIX-0610). Returns one page_allocator allocation laid out
/// [w: u32 LE][h: u32 LE][RGBA, tight w*4 rows] — self-describing because the
/// texture may be a DPI multiple of the node's logical size. Caller frees.
/// Null until the surface has actually captured (entry.ready), for borrowed
/// views (materialized shaders own their textures), or when the GPU is down.
/// Blocks on the copy + map — call from save/bake points only.
pub fn readbackStaticSurface(key: []const u8) ?[]u8 {
    const idx = findStaticEntry(staticKeyHash(key), key.len) orelse return null;
    const entry = &g_static_entries[idx];
    if (!entry.ready or entry.borrowed) return null;
    const tex = entry.texture orelse return null;
    // Captured surfaces render in the swapchain format, which may be BGRA —
    // swizzle so the stored payload has ONE channel order no matter the backend.
    const swap_rb = g_format == .bgra8_unorm or g_format == .bgra8_unorm_srgb;
    return readbackTexture(tex, entry.width, entry.height, swap_rb);
}

/// Read any COPY_SRC texture back to CPU bytes: one page_allocator allocation,
/// [w: u32 LE][h: u32 LE][RGBA, tight w*4 rows]. Caller frees. Blocks on the
/// copy + map — a save/bake-point door, not a per-frame one. `swap_rb` swizzles
/// BGRA-format sources to RGBA; pass false for textures created as rgba8_unorm.
pub fn readbackTexture(tex: *wgpu.Texture, w: u32, h: u32, swap_rb: bool) ?[]u8 {
    const device = g_device orelse return null;
    const queue = g_queue orelse return null;
    if (w == 0 or h == 0) return null;

    // wgpu requires 256-byte-aligned rows on texture→buffer copies.
    const ALIGN: u32 = 256;
    const padded_row: u32 = ((w * 4 + ALIGN - 1) / ALIGN) * ALIGN;
    const total: usize = @as(usize, padded_row) * @as(usize, h);

    const buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("static_surface_readback"),
        .size = total,
        .usage = wgpu.BufferUsages.copy_dst | wgpu.BufferUsages.map_read,
        .mapped_at_creation = 0,
    }) orelse return null;
    defer buf.release();

    const encoder = device.createCommandEncoder(&.{
        .label = wgpu.StringView.fromSlice("static_surface_readback_cmd"),
    }) orelse return null;
    encoder.copyTextureToBuffer(
        &.{ .texture = tex, .mip_level = 0, .origin = .{ .x = 0, .y = 0, .z = 0 }, .aspect = .all },
        &.{ .buffer = buf, .layout = .{ .offset = 0, .bytes_per_row = padded_row, .rows_per_image = h } },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const cmd = encoder.finish(&.{
        .label = wgpu.StringView.fromSlice("static_surface_readback_finish"),
    }) orelse {
        encoder.release();
        return null;
    };
    encoder.release();
    queue.submit(&.{cmd});
    cmd.release();

    var done: bool = false;
    const cb_struct = struct {
        fn cb(status: wgpu.MapAsyncStatus, _: wgpu.StringView, userdata1: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {
            _ = status;
            const done_ptr: *bool = @ptrCast(@alignCast(userdata1.?));
            done_ptr.* = true;
        }
    };
    _ = buf.mapAsync(wgpu.MapModes.read, 0, total, .{ .callback = cb_struct.cb, .userdata1 = @ptrCast(&done) });
    while (!done) {
        _ = device.poll(true, null);
    }

    const mapped_ptr = buf.getConstMappedRange(0, total) orelse return null;
    const out = std.heap.page_allocator.alloc(u8, 8 + @as(usize, w) * @as(usize, h) * 4) catch {
        buf.unmap();
        return null;
    };
    std.mem.writeInt(u32, out[0..4], w, .little);
    std.mem.writeInt(u32, out[4..8], h, .little);
    // Strip row padding (and swizzle BGRA→RGBA when asked).
    const mapped: [*]const u8 = @ptrCast(mapped_ptr);
    var row: u32 = 0;
    while (row < h) : (row += 1) {
        const src_off: usize = @as(usize, row) * @as(usize, padded_row);
        const dst_off: usize = 8 + @as(usize, row) * @as(usize, w) * 4;
        var col: usize = 0;
        while (col < w) : (col += 1) {
            const si = src_off + col * 4;
            const di = dst_off + col * 4;
            if (swap_rb) {
                out[di + 0] = mapped[si + 2];
                out[di + 1] = mapped[si + 1];
                out[di + 2] = mapped[si + 0];
                out[di + 3] = mapped[si + 3];
            } else {
                out[di + 0] = mapped[si + 0];
                out[di + 1] = mapped[si + 1];
                out[di + 2] = mapped[si + 2];
                out[di + 3] = mapped[si + 3];
            }
        }
    }
    buf.unmap();
    return out;
}

pub fn beginStaticSurfaceCapture(key: []const u8, x: f32, y: f32, width_f: f32, height_f: f32, opacity: f32, intro_frames: u16, scale_f: f32) ?StaticSurfaceToken {
    const width = staticDim(width_f, scale_f);
    const height = staticDim(height_f, scale_f);
    const idx = ensureStaticEntry(key, staticKeyHash(key), key.len, width, height) orelse return null;
    const entry = &g_static_entries[idx];
    entry.ready_frame = g_frame_counter;
    _ = queueStaticSurfaceQuad(entry, x, y, width_f, height_f, opacity, intro_frames);
    return .{ .entry_index = idx, .width = width, .height = height };
}

pub fn suspendScissorForStaticCapture(width: u32, height: u32) ScissorSnapshot {
    var snapshot = ScissorSnapshot{
        .depth = g_scissor_depth,
        .stack = [_]ScissorSegment{ZERO_SCISSOR_SEGMENT} ** MAX_SCISSOR_STACK,
    };
    if (g_scissor_depth > 0) @memcpy(snapshot.stack[0..g_scissor_depth], g_scissor_stack[0..g_scissor_depth]);
    g_scissor_depth = 0;
    recordBoundary(0, 0, width, height, @intCast(images.count()));
    return snapshot;
}

pub fn restoreScissorAfterStaticCapture(snapshot: ScissorSnapshot) void {
    if (snapshot.depth > 0) @memcpy(g_scissor_stack[0..snapshot.depth], snapshot.stack[0..snapshot.depth]);
    g_scissor_depth = snapshot.depth;
    if (g_scissor_depth > 0) {
        const parent = g_scissor_stack[g_scissor_depth - 1];
        recordBoundary(parent.x, parent.y, parent.w, parent.h, @intCast(images.count()));
    } else {
        recordBoundary(0, 0, g_width, g_height, @intCast(images.count()));
    }
}

pub fn finishStaticSurfaceCapture(token: StaticSurfaceToken, start: PrimitiveCounts, end: PrimitiveCounts) void {
    if (token.entry_index >= MAX_STATIC_SURFACES) return;
    if (g_static_capture_count >= MAX_STATIC_CAPTURES) return;
    if (end.rects <= start.rects and end.glyphs <= start.glyphs and end.curves <= start.curves and end.capsules <= start.capsules and end.polys <= start.polys and end.images <= start.images) {
        return;
    }
    g_static_entries[token.entry_index].ready = false;
    g_static_captures[g_static_capture_count] = .{
        .entry_index = token.entry_index,
        .width = token.width,
        .height = token.height,
        .start = start,
        .end = end,
    };
    g_static_capture_count += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Filter capture — like static surface but the cache is intentionally
// disabled so animations inside survive. The same texture pool is used.
// ════════════════════════════════════════════════════════════════════════

fn ensureFilterResources(entry: *StaticSurfaceEntry) bool {
    if (entry.filter_bind_group != null and entry.filter_uniform_buf != null) return true;
    const device = g_device orelse return false;
    const view = entry.view orelse return false;
    const sampler = entry.sampler orelse return false;
    const globals = g_globals_buffer orelse return false;
    const res = filters.createEntryResources(device, globals, view, sampler) orelse return false;
    entry.filter_uniform_buf = res.uniform_buf;
    entry.filter_bind_group = res.bind_group;
    entry.is_filter = true;
    return true;
}

/// Like beginStaticSurfaceCapture, but the entry never marks ready=true,
/// so the subtree re-renders into the offscreen texture every frame.
/// The composite step runs `filter`'s fragment shader instead of a plain
/// blit. Caller should wrap the children paint with the same scissor /
/// transform / opacity dance as static surface.
pub fn beginFilterCapture(
    key: []const u8,
    filter_name: []const u8,
    intensity: f32,
    x: f32,
    y: f32,
    width_f: f32,
    height_f: f32,
    scale_f: f32,
) ?StaticSurfaceToken {
    _ = intensity;
    _ = x;
    _ = y;
    _ = filter_name;
    const width = staticDim(width_f, scale_f);
    const height = staticDim(height_f, scale_f);
    const idx = ensureStaticEntry(key, staticKeyHash(key), key.len, width, height) orelse return null;
    const entry = &g_static_entries[idx];
    if (!ensureFilterResources(entry)) return null;
    return .{ .entry_index = idx, .width = width, .height = height };
}

pub fn finishFilterCapture(
    token: StaticSurfaceToken,
    start: PrimitiveCounts,
    end: PrimitiveCounts,
    filter_name: []const u8,
    intensity: f32,
    x: f32,
    y: f32,
    width_f: f32,
    height_f: f32,
) void {
    if (token.entry_index >= MAX_STATIC_SURFACES) return;
    if (g_static_capture_count >= MAX_STATIC_CAPTURES) return;
    if (end.rects <= start.rects and end.glyphs <= start.glyphs and end.curves <= start.curves and end.capsules <= start.capsules and end.polys <= start.polys and end.images <= start.images) {
        return;
    }
    const filter = filters.resolveFilter(filter_name) orelse {
        log.warn(.gpu, "filter unknown: {s}", .{filter_name});
        return;
    };
    g_static_entries[token.entry_index].ready = false;
    g_static_captures[g_static_capture_count] = .{
        .entry_index = token.entry_index,
        .width = token.width,
        .height = token.height,
        .start = start,
        .end = end,
        .is_filter = true,
        .filter = filter,
        .filter_intensity = intensity,
        .filter_x = x,
        .filter_y = y,
        .filter_w = width_f,
        .filter_h = height_f,
    };
    g_static_capture_count += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Dirty tracking & memory drain
// ════════════════════════════════════════════════════════════════════════

var g_prev_frame_hash: u64 = 0;
var g_prev_dims: [2]u32 = .{ 0, 0 };

// Per-pipeline content hashes from the previous frame. Each 2D vertex buffer
// re-uploads only when ITS OWN data changed — so one on-screen change (a HUD
// number ticking, a debug readout refreshing) re-uploads just that pipeline's
// buffer instead of forcing a full re-upload of rects+text+curves+capsules+
// polys every time (which showed up as a per-change frame spike).
const PipelineHashes = struct {
    rects: u64 = 0,
    text: u64 = 0,
    curves: u64 = 0,
    capsules: u64 = 0,
    polys: u64 = 0,
};
var g_prev_pipeline_hashes: PipelineHashes = .{};
// Forces every pipeline to upload next frame regardless of hash: first frame,
// and after a drain() recreates the GPU buffers (their contents are gone).
var g_force_full_upload: bool = true;

const DRAIN_INTERVAL: u64 = 36000; // ~10 minutes at 60fps
var g_frame_counter: u64 = 0;

// Per-frame present/vsync wait (swapchain acquire + present). Reset at the top
// of frame(), accumulated around the two blocking calls. Read by telemetry
// after frame() returns. The spikewatch reports this as the real vblank wait.
var g_present_wait_us: u64 = 0;

/// Microseconds spent this frame waiting on the compositor (swapchain acquire +
/// present). A subset of gpu_us. Valid after frame() returns for the frame.
pub fn presentWaitUs() u64 {
    return g_present_wait_us;
}

/// Combined hash from all pipelines for dirty checking.
fn frameDataHash() u64 {
    var h = rects.hashData();
    h ^= text.hashData();
    h ^= curves.hashData();
    h ^= capsules.hashData();
    h ^= polys.hashData();
    return h;
}

fn writeGlobals(queue: *wgpu.Queue, width: u32, height: u32) void {
    const globals = [2]f32{ @floatFromInt(width), @floatFromInt(height) };
    if (g_globals_buffer) |buf| {
        bu.writeValue(queue, buf, 0, &globals);
    }
}

/// Point the shared 2D-pipeline globals (screen_size) at a SECONDARY surface's
/// dimensions while it draws px-coordinate batches into its own pass (the
/// world window's HUD, WORLDWIN + PROPUSE req_0624). writeBuffer is
/// queue-ordered, so commands submitted after this call see the new size.
/// ALWAYS pair with restoreGlobalsScreenSize() — the main frame only rewrites
/// globals when its content changed, so a leaked override mis-scales the
/// entire next editor frame.
pub fn setGlobalsScreenSize(width: u32, height: u32) void {
    const queue = g_queue orelse return;
    writeGlobals(queue, width, height);
}

pub fn restoreGlobalsScreenSize() void {
    const queue = g_queue orelse return;
    writeGlobals(queue, g_width, g_height);
}

fn countsFromSegment(seg: ScissorSegment) PrimitiveCounts {
    return .{
        .rects = seg.rect_start,
        .glyphs = seg.glyph_start,
        .curves = seg.curve_start,
        .capsules = seg.capsule_start,
        .polys = seg.poly_start,
        .images = seg.image_start,
    };
}

fn currentTotals() PrimitiveCounts {
    return .{
        .rects = @intCast(rects.count()),
        .glyphs = @intCast(text.count()),
        .curves = @intCast(curves.count()),
        .capsules = @intCast(capsules.count()),
        .polys = @intCast(polys.count()),
        .images = @intCast(images.count()),
    };
}

fn setClampedScissor(render_pass: *wgpu.RenderPassEncoder, x: u32, y: u32, w: u32, h: u32, limit_w: u32, limit_h: u32) bool {
    if (limit_w == 0 or limit_h == 0 or w == 0 or h == 0) return false;
    if (x >= limit_w or y >= limit_h) return false;
    var sw = w;
    var sh = h;
    if (x + sw > limit_w) sw = limit_w - x;
    if (y + sh > limit_h) sh = limit_h - y;
    if (sw == 0 or sh == 0) return false;
    render_pass.setScissorRect(x, y, sw, sh);
    return true;
}

fn drawCaptureSegment(render_pass: *wgpu.RenderPassEncoder, seg_start: PrimitiveCounts, seg_end: PrimitiveCounts, cap: StaticSurfaceCapture) void {
    const rs = @max(seg_start.rects, cap.start.rects);
    const re = @min(seg_end.rects, cap.end.rects);
    if (re > rs) rects.drawBatch(render_pass, rs, re);

    const gs = @max(seg_start.glyphs, cap.start.glyphs);
    const ge = @min(seg_end.glyphs, cap.end.glyphs);
    if (ge > gs) text.drawBatch(render_pass, gs, ge);

    const cs = @max(seg_start.curves, cap.start.curves);
    const ce = @min(seg_end.curves, cap.end.curves);
    if (ce > cs) curves.drawBatch(render_pass, cs, ce);

    const cps = @max(seg_start.capsules, cap.start.capsules);
    const cpe = @min(seg_end.capsules, cap.end.capsules);
    if (cpe > cps) capsules.drawBatch(render_pass, cps, cpe);

    const ps = @max(seg_start.polys, cap.start.polys);
    const pe = @min(seg_end.polys, cap.end.polys);
    if (pe > ps) polys.drawBatch(render_pass, ps, pe);

    const is = @max(seg_start.images, cap.start.images);
    const ie = @min(seg_end.images, cap.end.images);
    if (ie > is) images.drawBatch(render_pass, is, ie);
}

fn drawStaticCapture(render_pass: *wgpu.RenderPassEncoder, cap: StaticSurfaceCapture) void {
    if (g_scissor_count == 0) {
        render_pass.setScissorRect(0, 0, cap.width, cap.height);
        drawCaptureSegment(render_pass, .{}, currentTotals(), cap);
        return;
    }

    var prev_counts = PrimitiveCounts{};
    var prev_sx: u32 = 0;
    var prev_sy: u32 = 0;
    var prev_sw: u32 = cap.width;
    var prev_sh: u32 = cap.height;

    for (g_scissor_segments[0..g_scissor_count]) |seg| {
        const end_counts = countsFromSegment(seg);
        if (setClampedScissor(render_pass, prev_sx, prev_sy, prev_sw, prev_sh, cap.width, cap.height)) {
            drawCaptureSegment(render_pass, prev_counts, end_counts, cap);
        }
        prev_counts = end_counts;
        prev_sx = seg.x;
        prev_sy = seg.y;
        prev_sw = seg.w;
        prev_sh = seg.h;
    }

    if (setClampedScissor(render_pass, prev_sx, prev_sy, prev_sw, prev_sh, cap.width, cap.height)) {
        drawCaptureSegment(render_pass, prev_counts, currentTotals(), cap);
    }
}

// True when `inner`'s primitive range falls entirely within `outer`'s — i.e.
// `inner` was painted as part of `outer`'s captured subtree (nesting).
fn capEncloses(outer: StaticSurfaceCapture, inner: StaticSurfaceCapture) bool {
    return inner.start.rects >= outer.start.rects and inner.end.rects <= outer.end.rects and
        inner.start.glyphs >= outer.start.glyphs and inner.end.glyphs <= outer.end.glyphs and
        inner.start.images >= outer.start.images and inner.end.images <= outer.end.images;
}

fn writeStaticCaptureTraceLine(writer: anytype, entry_index: usize, key_sample: []const u8, width: u32, height: u32, start: PrimitiveCounts, end: PrimitiveCounts) !void {
    try writer.print("#{d} key=\"{s}\" {d}x{d} r{d} g{d} c{d} cap{d} p{d} img{d}", .{
        entry_index,
        key_sample,
        width,
        height,
        @as(i64, end.rects) - @as(i64, start.rects),
        @as(i64, end.glyphs) - @as(i64, start.glyphs),
        @as(i64, end.curves) - @as(i64, start.curves),
        @as(i64, end.capsules) - @as(i64, start.capsules),
        @as(i64, end.polys) - @as(i64, start.polys),
        @as(i64, end.images) - @as(i64, start.images),
    });
}

pub fn testingFormatStaticCaptureTrace(buffer: []u8, key: []const u8, width: u32, height: u32, start: PrimitiveCounts, end: PrimitiveCounts) []const u8 {
    var sample: [64]u8 = [_]u8{0} ** 64;
    const sample_len = @min(key.len, sample.len);
    if (sample_len > 0) @memcpy(sample[0..sample_len], key[0..sample_len]);
    var writer: std.Io.Writer = .fixed(buffer);
    writeStaticCaptureTraceLine(&writer, 0, sample[0..sample_len], width, height, start, end) catch {};
    return writer.buffered();
}

pub fn testingResetTextAttributionState() void {
    text.testingResetAttributionState();
}

pub fn testingRecordTextTrace(sample: []const u8, size_px: u16, render_size_px: u16) void {
    text.testingRecordTextTrace(sample, size_px, render_size_px);
}

pub fn testingBumpTextAtlasMisses(count: usize) void {
    text.testingBumpAtlasMisses(count);
}

pub fn testingResetTextFrame() void {
    text.reset();
}

pub fn testingLastTextAtlasMissCount() usize {
    return text.lastAtlasMissCount();
}

pub fn testingLastTextTraceSummary() []const u8 {
    return text.lastTraceSummary();
}

fn renderStaticSurfaceCaptures(device: *wgpu.Device, queue: *wgpu.Queue) void {
    g_last_static_capture_count = g_static_capture_count;
    var writer: std.Io.Writer = .fixed(&g_last_static_capture_trace);
    var wrote_any = false;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const entry = if (cap.entry_index < MAX_STATIC_SURFACES) &g_static_entries[cap.entry_index] else null;
        const key_sample = if (entry) |e| e.key_sample[0..e.key_sample_len] else "";
        const start = cap.start;
        const end = cap.end;
        if (wrote_any) writer.writeAll(" | ") catch break;
        writeStaticCaptureTraceLine(&writer, cap.entry_index, key_sample, cap.width, cap.height, start, end) catch break;
        wrote_any = true;
    }
    g_last_static_capture_trace_len = writer.buffered().len;
    if (g_static_capture_count == 0) return;

    // A <Filter> nested inside a <StaticSurface> shows up as a filter capture
    // whose range is enclosed by a (non-filter) static capture's range. Such a
    // filter must NOT composite to the main framebuffer (it would leak at its
    // capture-local origin); its filtered output is drawn INTO the parent
    // static texture during the parent's pass instead — so the captured
    // surface, and any mesh sampling it via textureKey, shows the filtered
    // result. Non-nested filters (e.g. a top-level fullscreen Filter) and
    // plain StaticSurfaces are unaffected.
    var nested = [_]bool{false} ** MAX_STATIC_CAPTURES;
    for (g_static_captures[0..g_static_capture_count], 0..) |cap, i| {
        if (!cap.is_filter) continue;
        for (g_static_captures[0..g_static_capture_count], 0..) |outer, j| {
            if (j == i or outer.is_filter) continue;
            if (capEncloses(outer, cap)) {
                nested[i] = true;
                break;
            }
        }
    }

    const t_seconds: f32 = @floatCast(@as(f64, @floatFromInt(g_frame_counter % 1_000_000)) / 60.0);

    for (g_static_captures[0..g_static_capture_count], 0..) |cap, i| {
        if (cap.entry_index >= MAX_STATIC_SURFACES) continue;
        const entry = &g_static_entries[cap.entry_index];
        const view = entry.view orelse continue;
        if (cap.width == 0 or cap.height == 0) continue;

        writeGlobals(queue, cap.width, cap.height);
        const encoder = device.createCommandEncoder(&.{}) orelse continue;

        const color_attachment = wgpu.ColorAttachment{
            .view = view,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = 0, .g = 0, .b = 0, .a = 0 },
        };
        const rp_desc = wgpu.RenderPassDescriptor{
            .color_attachment_count = 1,
            .color_attachments = @ptrCast(&color_attachment),
        };
        const render_pass = encoder.beginRenderPass(&rp_desc) orelse {
            encoder.release();
            continue;
        };
        // If a nested filter covers this surface's ENTIRE range, skip drawing
        // the raw content — the filter replaces it. Otherwise the filter's
        // inset/curvature (e.g. CRT barrel) reveals un-filtered pixels at the
        // edges (an orange border around the screen). A partial nested filter
        // still draws the raw content around itself.
        var raw_covered = false;
        if (!cap.is_filter) {
            for (g_static_captures[0..g_static_capture_count], 0..) |fcap, fi| {
                if (!fcap.is_filter or !nested[fi]) continue;
                if (capEncloses(fcap, cap)) {
                    raw_covered = true;
                    break;
                }
            }
        }
        if (!raw_covered) drawStaticCapture(render_pass, cap);

        // Parent static surface: fold each nested filter's shader pass directly
        // into this texture at the filter's local bounds. Nested filters were
        // appended before their parent (inner subtree finishes first), so their
        // raw input texture is already rendered by now.
        if (!cap.is_filter) {
            for (g_static_captures[0..g_static_capture_count], 0..) |fcap, fi| {
                if (!fcap.is_filter or !nested[fi]) continue;
                if (!capEncloses(cap, fcap)) continue;
                if (fcap.entry_index >= MAX_STATIC_SURFACES) continue;
                const fentry = &g_static_entries[fcap.entry_index];
                const fbg = fentry.filter_bind_group orelse continue;
                const fub = fentry.filter_uniform_buf orelse continue;
                filters.drawInline(render_pass, queue, fcap.filter, fbg, fub, fcap.filter_x, fcap.filter_y, fcap.filter_w, fcap.filter_h, t_seconds, fcap.filter_intensity);
            }
        }

        render_pass.end();
        render_pass.release();
        const command = encoder.finish(null) orelse {
            encoder.release();
            continue;
        };
        encoder.release();
        queue.submit(&.{command});
        command.release();
        if (cap.is_filter) {
            // Filter captures intentionally don't cache. Leave entry.ready=false
            // so the offscreen pass runs again next frame. A non-nested filter
            // composites to the main framebuffer; a nested one was already
            // folded into its parent's texture above.
            if (!nested[i]) {
                const bg = entry.filter_bind_group orelse continue;
                const ub = entry.filter_uniform_buf orelse continue;
                filters.queueComposite(
                    queue,
                    cap.filter,
                    bg,
                    ub,
                    cap.filter_x,
                    cap.filter_y,
                    cap.filter_w,
                    cap.filter_h,
                    t_seconds,
                    cap.filter_intensity,
                );
            }
        } else {
            entry.ready = true;
            entry.ready_frame = g_frame_counter;
            entry.captured_frame = g_frame_counter;
        }
    }

    writeGlobals(queue, g_width, g_height);
}

fn drawRectsSkipping(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    var cursor = start;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const skip_start = cap.start.rects;
        const skip_end = cap.end.rects;
        if (skip_end <= cursor or skip_start >= end) continue;
        if (skip_start > cursor) rects.drawBatch(render_pass, cursor, @min(skip_start, end));
        cursor = @max(cursor, @min(skip_end, end));
        if (cursor >= end) return;
    }
    if (cursor < end) rects.drawBatch(render_pass, cursor, end);
}

fn drawTextSkipping(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    var cursor = start;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const skip_start = cap.start.glyphs;
        const skip_end = cap.end.glyphs;
        if (skip_end <= cursor or skip_start >= end) continue;
        if (skip_start > cursor) text.drawBatch(render_pass, cursor, @min(skip_start, end));
        cursor = @max(cursor, @min(skip_end, end));
        if (cursor >= end) return;
    }
    if (cursor < end) text.drawBatch(render_pass, cursor, end);
}

fn drawCurvesSkipping(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    var cursor = start;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const skip_start = cap.start.curves;
        const skip_end = cap.end.curves;
        if (skip_end <= cursor or skip_start >= end) continue;
        if (skip_start > cursor) curves.drawBatch(render_pass, cursor, @min(skip_start, end));
        cursor = @max(cursor, @min(skip_end, end));
        if (cursor >= end) return;
    }
    if (cursor < end) curves.drawBatch(render_pass, cursor, end);
}

fn drawCapsulesSkipping(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    var cursor = start;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const skip_start = cap.start.capsules;
        const skip_end = cap.end.capsules;
        if (skip_end <= cursor or skip_start >= end) continue;
        if (skip_start > cursor) capsules.drawBatch(render_pass, cursor, @min(skip_start, end));
        cursor = @max(cursor, @min(skip_end, end));
        if (cursor >= end) return;
    }
    if (cursor < end) capsules.drawBatch(render_pass, cursor, end);
}

fn drawPolysSkipping(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    var cursor = start;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const skip_start = cap.start.polys;
        const skip_end = cap.end.polys;
        if (skip_end <= cursor or skip_start >= end) continue;
        if (skip_start > cursor) polys.drawBatch(render_pass, cursor, @min(skip_start, end));
        cursor = @max(cursor, @min(skip_end, end));
        if (cursor >= end) return;
    }
    if (cursor < end) polys.drawBatch(render_pass, cursor, end);
}

fn drawImagesSkipping(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    var cursor = start;
    for (g_static_captures[0..g_static_capture_count]) |cap| {
        const skip_start = cap.start.images;
        const skip_end = cap.end.images;
        if (skip_end <= cursor or skip_start >= end) continue;
        if (skip_start > cursor) images.drawBatch(render_pass, cursor, @min(skip_start, end));
        cursor = @max(cursor, @min(skip_end, end));
        if (cursor >= end) return;
    }
    if (cursor < end) images.drawBatch(render_pass, cursor, end);
}

/// Drain fragmented GPU memory by recreating buffers + bind groups.
fn drainMemory() void {
    const device = g_device orelse return;

    // Destroy old globals buffer
    if (g_globals_buffer) |b| b.release();

    // Blocking poll to reclaim all pending resources (not available on web)
    if (!is_web) _ = device.poll(true, null);

    // Recreate globals buffer
    g_globals_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("globals"),
        .size = 16,
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    const globals_buffer = g_globals_buffer orelse return;

    // Drain each pipeline
    rects.drain(device, globals_buffer);
    text.drain(device, globals_buffer);
    curves.drain(device, globals_buffer);
    capsules.drain(device, globals_buffer);
    polys.drain(device, globals_buffer);
    images.drain(device, globals_buffer);
    sdf_icons.drain(device, globals_buffer);

    // Force full redraw on next frame — the buffers were just recreated.
    g_prev_frame_hash = 0;
    g_prev_dims = .{ 0, 0 };
    g_force_full_upload = true;

    log.print("[gpu] Memory drain: buffers recreated at frame {d}\n", .{g_frame_counter});
}

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Web init — device provided by emscripten, surface from canvas.
/// Uses the C webgpu.h API directly for surface creation (emscripten-specific).
pub fn initWeb(device: *wgpu.Device, queue: *wgpu.Queue, width: u32, height: u32) !void {
    log.print("[gpu.initWeb] start w={} h={}\n", .{ width, height });
    g_device = device;
    g_queue = queue;
    g_width = width;
    g_height = height;

    // Create instance + surface from HTML canvas (web only)
    if (is_web) {
        log.print("[gpu.initWeb] creating instance...\n", .{});
        g_instance = wgpu.Instance.create(null) orelse return error.WGPUInstanceFailed;
        log.print("[gpu.initWeb] creating canvas surface...\n", .{});
        const instance = g_instance.?;
        g_surface = createCanvasSurface(instance) orelse return error.SurfaceCreateFailed;
        log.print("[gpu.initWeb] surface created\n", .{});
    }

    // Configure surface (same as native path)
    log.print("[gpu.initWeb] configuring surface...\n", .{});
    configureSurface(width, height);

    log.print("[gpu.initWeb] creating globals buffer...\n", .{});
    g_globals_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("globals"),
        .size = 16,
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    const globals_buffer = g_globals_buffer orelse return error.BufferCreateFailed;

    log.print("[gpu.initWeb] init rects pipeline...\n", .{});
    rects.initPipeline(device, globals_buffer);
    log.print("[gpu.initWeb] init curves pipeline...\n", .{});
    curves.initPipeline(device, globals_buffer);
    log.print("[gpu.initWeb] init capsules pipeline...\n", .{});
    capsules.initPipeline(device, globals_buffer);
    log.print("[gpu.initWeb] init polys pipeline...\n", .{});
    polys.initPipeline(device, globals_buffer);
    gcurve_fill.initPipeline(device, globals_buffer);
    log.print("[gpu.initWeb] init images pipeline...\n", .{});
    images.initPipeline(device, globals_buffer);
    filters.ensureInit(device, g_format);
    sdf_icons.init();
    log.print("[gpu.initWeb] done\n", .{});
}

// ── Web-specific surface creation (uses wgpu_web module's C types) ──

fn createCanvasSurface(instance: *wgpu.Instance) ?*wgpu.Surface {
    if (!is_web) return null;
    const wc = wgpu.c; // emdawnwebgpu C types
    const canvas_source = wc.WGPUEmscriptenSurfaceSourceCanvasHTMLSelector{
        .chain = .{
            .next = null,
            .sType = wc.WGPUSType_EmscriptenSurfaceSourceCanvasHTMLSelector,
        },
        .selector = .{ .data = "#canvas", .length = 7 },
    };
    const surface_desc = wc.WGPUSurfaceDescriptor{
        .nextInChain = @ptrCast(@constCast(&canvas_source.chain)),
        .label = .{ .data = "web-canvas", .length = 10 },
    };
    return @ptrCast(wc.wgpuInstanceCreateSurface(@ptrCast(instance), &surface_desc));
}

fn requestAdapterCallback(status: wgpu.RequestAdapterStatus, adapter: ?*wgpu.Adapter, message: wgpu.StringView, userdata1: ?*anyopaque, userdata2: ?*anyopaque) callconv(.c) void {
    const response: *wgpu.RequestAdapterResponse = @ptrCast(@alignCast(userdata1));
    response.* = .{
        .status = status,
        .message = message.toSlice(),
        .adapter = adapter,
    };
    const completed: *bool = @ptrCast(@alignCast(userdata2));
    completed.* = true;
}

fn requestAdapterSync(io: std.Io, instance: *wgpu.Instance, options: ?*const wgpu.RequestAdapterOptions, polling_interval_nanoseconds: u64) std.Io.Cancelable!wgpu.RequestAdapterResponse {
    var response: wgpu.RequestAdapterResponse = undefined;
    var completed = false;
    _ = instance.requestAdapter(options, .{
        .callback = requestAdapterCallback,
        .userdata1 = @ptrCast(&response),
        .userdata2 = @ptrCast(&completed),
    });
    instance.processEvents();
    while (!completed) {
        try std.Io.sleep(io, .fromNanoseconds(@intCast(polling_interval_nanoseconds)), .awake);
        instance.processEvents();
    }
    return response;
}

fn requestDeviceCallback(status: wgpu.RequestDeviceStatus, device: ?*wgpu.Device, message: wgpu.StringView, userdata1: ?*anyopaque, userdata2: ?*anyopaque) callconv(.c) void {
    const response: *wgpu.RequestDeviceResponse = @ptrCast(@alignCast(userdata1));
    response.* = .{
        .status = status,
        .message = message.toSlice(),
        .device = device,
    };
    const completed: *bool = @ptrCast(@alignCast(userdata2));
    completed.* = true;
}

fn requestDeviceSync(io: std.Io, adapter: *wgpu.Adapter, instance: *wgpu.Instance, descriptor: ?*const wgpu.DeviceDescriptor, polling_interval_nanoseconds: u64) std.Io.Cancelable!wgpu.RequestDeviceResponse {
    var response: wgpu.RequestDeviceResponse = undefined;
    var completed = false;
    _ = adapter.requestDevice(descriptor, .{
        .callback = requestDeviceCallback,
        .userdata1 = @ptrCast(&response),
        .userdata2 = @ptrCast(&completed),
    });
    instance.processEvents();
    while (!completed) {
        try std.Io.sleep(io, .fromNanoseconds(@intCast(polling_interval_nanoseconds)), .awake);
        instance.processEvents();
    }
    return response;
}

pub fn init(io: std.Io, environ: *const std.process.Environ.Map, window: if (is_web) *anyopaque else *c.SDL_Window) !void {
    if (is_web) @compileError("Use initWeb() on wasm32 targets");

    // Create wgpu instance — Metal on macOS, Vulkan on Linux
    const backend = if (comptime @import("builtin").os.tag == .macos) wgpu.InstanceBackends.metal else wgpu.InstanceBackends.vulkan;
    var extras = wgpu.InstanceExtras{
        .backends = backend,
        .flags = wgpu.InstanceFlags.default,
        .dx12_shader_compiler = .undefined,
        .gles3_minor_version = .automatic,
        .gl_fence_behavior = .gl_fence_behaviour_normal,
        .dxc_max_shader_model = .dxc_max_shader_model_v6_0,
    };
    var desc = wgpu.InstanceDescriptor{
        .features = .{ .timed_wait_any_enable = 0, .timed_wait_any_max_count = 0 },
    };
    desc = desc.withNativeExtras(&extras);
    g_instance = wgpu.Instance.create(&desc) orelse return error.WGPUInstanceFailed;
    const instance = g_instance.?;

    // Create surface from native window handle (SDL3 properties API).
    // KMS mode is surfaceless — render to an offscreen texture, scan out via DRM.
    if (!g_kms) {
        g_surface = createSurfaceFromSDL(instance, window) orelse return error.SurfaceCreateFailed;
    }

    // Request adapter (no compatible surface in KMS mode)
    const adapter_response = try requestAdapterSync(io, instance, &.{
        .compatible_surface = g_surface,
        .power_preference = .high_performance,
    }, 200_000_000);
    if (adapter_response.status != .success) {
        log.print("wgpu adapter request failed\n", .{});
        return error.AdapterRequestFailed;
    }
    g_adapter = adapter_response.adapter;
    const adapter = g_adapter.?;
    {
        var info: @import("../gpu/gpu.zig").wgpu.AdapterInfo = undefined;
        _ = adapter.getInfo(&info);
        log.print("[gpu] adapter: {s} (device=0x{x})\n", .{
            info.description.toSlice() orelse "(unknown)",
            info.device_id,
        });
    }

    // Request device — with the ADAPTER'S real limits (req_2843). Passing null
    // gets the WebGPU baseline (256 MiB maxBufferSize), and every world pool
    // inherited that default as its ceiling. The adapter supports what it
    // reports by definition; if the request still fails, fall back to defaults
    // so a quirky driver never blocks startup.
    var adapter_limits = wgpu.Limits{};
    const have_adapter_limits = adapter.getLimits(&adapter_limits) == .success;
    adapter_limits.next_in_chain = null;
    const limits_desc = wgpu.DeviceDescriptor{ .required_limits = &adapter_limits };
    var device_response = try requestDeviceSync(io, adapter, instance, if (have_adapter_limits) &limits_desc else null, 200_000_000);
    if (device_response.status != .success and have_adapter_limits) {
        log.print("[gpu] device request with adapter limits failed — retrying with WebGPU defaults\n", .{});
        device_response = try requestDeviceSync(io, adapter, instance, null, 200_000_000);
    }
    if (device_response.status != .success) {
        log.print("wgpu device request failed\n", .{});
        return error.DeviceRequestFailed;
    }
    g_device = device_response.device;
    const device = g_device.?;
    g_queue = device.getQueue();
    g_device_limits = wgpu.Limits{};
    if (device.getLimits(&g_device_limits) == .success) {
        log.print("[gpu] device limits granted: maxBufferSize {d} MiB\n", .{g_device_limits.max_buffer_size / (1024 * 1024)});
    } else {
        g_device_limits = wgpu.Limits{};
    }

    // Get window size and configure surface
    var w: c_int = 0;
    var h: c_int = 0;
    _ = c.SDL_GetWindowSize(window, &w, &h);
    g_width = @intCast(w);
    g_height = @intCast(h);

    g_vsync_off = if (environ.get("ZIGOS_VSYNC")) |value| std.mem.eql(u8, value, "0") else false;
    if (g_kms) {
        // No swapchain to configure — pick the readback-friendly format and
        // allocate the offscreen scanout target instead.
        g_format = .bgra8_unorm;
        createOffscreen(g_width, g_height);
    } else {
        configureSurface(g_width, g_height);
    }

    // Create globals uniform buffer
    g_globals_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("globals"),
        .size = 16,
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    const globals_buffer = g_globals_buffer orelse return error.BufferCreateFailed;

    // Initialize pipelines
    rects.initPipeline(device, globals_buffer);
    curves.initPipeline(device, globals_buffer);
    capsules.initPipeline(device, globals_buffer);
    polys.initPipeline(device, globals_buffer);
    gcurve_fill.initPipeline(device, globals_buffer);
    images.initPipeline(device, globals_buffer);
    filters.ensureInit(device, g_format);
    sdf_icons.init();

    log.print("wgpu initialized: {d}x{d}\n", .{ g_width, g_height });
}

pub fn deinit() void {
    deinitStaticSurfaces();
    filters.deinit();
    images.deinit();
    polys.deinit();
    capsules.deinit();
    curves.deinit();
    text.deinit();
    rects.deinit();
    if (g_globals_buffer) |b| b.release();
    if (g_offscreen_view) |v| v.release();
    if (g_offscreen) |t| t.release();
    if (g_queue) |q| q.release();
    if (g_device) |d| d.release();
    if (g_adapter) |a| a.release();
    if (g_surface) |s| s.release();
    if (g_instance) |i| i.release();
    g_offscreen_view = null;
    g_offscreen = null;
    g_globals_buffer = null;
    g_queue = null;
    g_device = null;
    g_adapter = null;
    g_surface = null;
    g_instance = null;
}

pub fn resize(width: u32, height: u32) void {
    if (width == 0 or height == 0) return;
    g_width = width;
    g_height = height;
    if (g_kms) {
        // The DRM scanout mode is fixed; only the offscreen target follows.
        createOffscreen(width, height);
    } else {
        configureSurface(width, height);
    }
}

/// The scissor-segmented 2D draw — every primitive batch (rects/text/curves/
/// capsules/polys/images/icons) clipped by the boundaries recorded during the
/// paint walk, then g-curve fills and filter composites. Shared by the main
/// frame() and renderPanelInto() so the pop-out window draws byte-identically
/// to the main window. Reads g_width/g_height + the batch counts; the caller
/// owns the render pass + globals + uploads.
fn drawSegmented2D(render_pass: *wgpu.RenderPassEncoder) void {
    const total_rects: u32 = @intCast(rects.count());
    const total_glyphs: u32 = @intCast(text.count());
    const total_curves: u32 = @intCast(curves.count());
    const total_capsules: u32 = @intCast(capsules.count());
    const total_polys: u32 = @intCast(polys.count());
    const total_images: u32 = @intCast(images.count());
    const total_icons: u32 = @intCast(sdf_icons.count());

    if (g_scissor_count == 0) {
        // Fast path — no clip or ordering boundaries, single draw for all primitives
        render_pass.setScissorRect(0, 0, g_width, g_height);
        drawRectsSkipping(render_pass, 0, total_rects);
        drawTextSkipping(render_pass, 0, total_glyphs);
        drawCurvesSkipping(render_pass, 0, total_curves);
        drawCapsulesSkipping(render_pass, 0, total_capsules);
        drawPolysSkipping(render_pass, 0, total_polys);
        drawImagesSkipping(render_pass, 0, total_images);
        if (total_icons > 0) sdf_icons.drawBatch(render_pass, 0, total_icons);
    } else {
        // Boundary-segmented rendering
        var segments: [MAX_SCISSOR_SEGMENTS + 1]ScissorSegment = undefined;
        const seg_count = g_scissor_count;
        @memcpy(segments[0..seg_count], g_scissor_segments[0..seg_count]);

        var prev_rect: u32 = 0;
        var prev_glyph: u32 = 0;
        var prev_curve: u32 = 0;
        var prev_capsule: u32 = 0;
        var prev_poly: u32 = 0;
        var prev_image: u32 = 0;
        var prev_icon: u32 = 0;
        var prev_sx: u32 = 0;
        var prev_sy: u32 = 0;
        var prev_sw: u32 = g_width;
        var prev_sh: u32 = g_height;

        for (0..seg_count) |si| {
            const seg = segments[si];
            const rect_end = seg.rect_start;
            const glyph_end = seg.glyph_start;
            const curve_end = seg.curve_start;
            const capsule_end = seg.capsule_start;
            const poly_end = seg.poly_start;
            const image_end = seg.image_start;
            const icon_end = seg.sdf_icon_start;

            if (rect_end > prev_rect or glyph_end > prev_glyph or curve_end > prev_curve or capsule_end > prev_capsule or poly_end > prev_poly or image_end > prev_image or icon_end > prev_icon) {
                if (setClampedScissor(render_pass, prev_sx, prev_sy, prev_sw, prev_sh, g_width, g_height)) {
                    if (rect_end > prev_rect) drawRectsSkipping(render_pass, prev_rect, rect_end);
                    if (glyph_end > prev_glyph) drawTextSkipping(render_pass, prev_glyph, glyph_end);
                    if (curve_end > prev_curve) drawCurvesSkipping(render_pass, prev_curve, curve_end);
                    if (capsule_end > prev_capsule) drawCapsulesSkipping(render_pass, prev_capsule, capsule_end);
                    if (poly_end > prev_poly) drawPolysSkipping(render_pass, prev_poly, poly_end);
                    if (image_end > prev_image) drawImagesSkipping(render_pass, prev_image, image_end);
                    if (icon_end > prev_icon) sdf_icons.drawBatch(render_pass, prev_icon, icon_end);
                }
            }

            prev_rect = rect_end;
            prev_glyph = glyph_end;
            prev_curve = curve_end;
            prev_capsule = capsule_end;
            prev_poly = poly_end;
            prev_image = image_end;
            prev_icon = icon_end;
            prev_sx = seg.x;
            prev_sy = seg.y;
            prev_sw = seg.w;
            prev_sh = seg.h;
        }

        // Draw remaining after last segment
        if (total_rects > prev_rect or total_glyphs > prev_glyph or total_curves > prev_curve or total_capsules > prev_capsule or total_polys > prev_poly or total_images > prev_image or total_icons > prev_icon) {
            if (setClampedScissor(render_pass, prev_sx, prev_sy, prev_sw, prev_sh, g_width, g_height)) {
                if (total_rects > prev_rect) drawRectsSkipping(render_pass, prev_rect, total_rects);
                if (total_glyphs > prev_glyph) drawTextSkipping(render_pass, prev_glyph, total_glyphs);
                if (total_curves > prev_curve) drawCurvesSkipping(render_pass, prev_curve, total_curves);
                if (total_capsules > prev_capsule) drawCapsulesSkipping(render_pass, prev_capsule, total_capsules);
                if (total_polys > prev_poly) drawPolysSkipping(render_pass, prev_poly, total_polys);
                if (total_images > prev_image) drawImagesSkipping(render_pass, prev_image, total_images);
                if (total_icons > prev_icon) sdf_icons.drawBatch(render_pass, prev_icon, total_icons);
            }
        }
    }

    // G-curve fill — Loop-Blinn quadratic-bezier-triangle fills.
    {
        const total_gcurves: u32 = @intCast(gcurve_fill.count());
        if (total_gcurves > 0) {
            render_pass.setScissorRect(0, 0, g_width, g_height);
            gcurve_fill.drawBatch(render_pass, 0, total_gcurves);
        }
    }

    // Filter composites — run AFTER all primitive draws so the filter shader
    // samples its captured offscreen texture and writes over the area where
    // the captured primitives would have appeared.
    render_pass.setScissorRect(0, 0, g_width, g_height);
    filters.drawComposites(render_pass);
}

// ════════════════════════════════════════════════════════════════════════
// Panel pop-out RT (PANELWIN-0628) — render an arbitrary 2D React subtree into
// an offscreen RT in the MAIN surface format, so framework/gpu/panel_window.zig
// can blit it into a second OS window's swapchain. Same device, sibling target.
// ════════════════════════════════════════════════════════════════════════

var g_panel_rt_tex: ?*wgpu.Texture = null;
var g_panel_rt_view: ?*wgpu.TextureView = null;
var g_panel_rt_w: u32 = 0;
var g_panel_rt_h: u32 = 0;

fn ensurePanelTarget(w: u32, h: u32) ?*wgpu.TextureView {
    if (g_panel_rt_view != null and g_panel_rt_w == w and g_panel_rt_h == h) return g_panel_rt_view;
    const device = g_device orelse return null;
    if (g_panel_rt_view) |v| v.release();
    g_panel_rt_view = null;
    if (g_panel_rt_tex) |t| t.release();
    g_panel_rt_tex = null;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("panel_window_rt"),
        .size = .{ .width = @max(1, w), .height = @max(1, h), .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = g_format,
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.texture_binding,
    }) orelse return null;
    const view = tex.createView(null) orelse {
        tex.release();
        return null;
    };
    g_panel_rt_tex = tex;
    g_panel_rt_view = view;
    g_panel_rt_w = w;
    g_panel_rt_h = h;
    return view;
}

pub fn releasePanelTarget() void {
    if (g_panel_rt_view) |v| v.release();
    g_panel_rt_view = null;
    if (g_panel_rt_tex) |t| t.release();
    g_panel_rt_tex = null;
    g_panel_rt_w = 0;
    g_panel_rt_h = 0;
}

/// Render a 2D subtree into the panel RT and return its view (or null on
/// failure). `paint_cb` is the engine's paint walk over the panel root, which
/// must already be laid out at (0,0,w,h). MUST be called AFTER the main frame()
/// has drawn + reset the shared 2D batches (they are ours, empty, for this
/// pass). Mirrors frame()'s upload→captures→pass→reset sequence, but targets
/// the offscreen RT and never touches a surface. Globals + g_width/g_height are
/// swapped to the panel's dims for the pass and restored before returning, so
/// the next main frame is unaffected.
pub fn renderPanelInto(io: std.Io, environ: *const std.process.Environ.Map, w: u32, h: u32, paint_cb: *const fn (std.Io, *const std.process.Environ.Map) void) ?*wgpu.TextureView {
    const device = g_device orelse return null;
    const queue = g_queue orelse return null;
    const target = ensurePanelTarget(w, h) orelse return null;

    const saved_w = g_width;
    const saved_h = g_height;
    g_width = w;
    g_height = h;

    // Defensive — frame() resets these at its tail, but never assume.
    rects.reset();
    text.reset();
    curves.reset();
    capsules.reset();
    polys.reset();
    images.reset();
    sdf_icons.reset();
    gcurve_fill.reset();
    g_static_capture_count = 0;
    g_scissor_count = 0;
    g_scissor_depth = 0;

    // Paint the panel subtree → fills the batches + queues its static/effect
    // captures + records scissor boundaries.
    paint_cb(io, environ);

    // Force-upload everything (the panel is small; skip the dirty-hash gate).
    writeGlobals(queue, w, h);
    rects.upload(queue);
    text.upload(queue);
    curves.upload(queue);
    capsules.upload(queue);
    polys.upload(queue);
    if (images.count() > 0) images.upload(queue);
    if (sdf_icons.count() > 0) sdf_icons.upload(queue);
    if (gcurve_fill.count() > 0) gcurve_fill.upload(queue);

    renderStaticSurfaceCaptures(device, queue);
    scene3d.flushPending(io, environ);

    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("panel_rt") }) orelse {
        restorePanelGlobals(saved_w, saved_h);
        return null;
    };
    const render_pass = encoder.beginRenderPass(&.{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&wgpu.ColorAttachment{
            .view = target,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = 0.043, .g = 0.075, .b = 0.125, .a = 1.0 },
        }),
    }) orelse {
        encoder.release();
        restorePanelGlobals(saved_w, saved_h);
        return null;
    };
    drawSegmented2D(render_pass);
    render_pass.end();
    render_pass.release();

    const command = encoder.finish(null) orelse {
        encoder.release();
        restorePanelGlobals(saved_w, saved_h);
        return null;
    };
    encoder.release();
    queue.submit(&.{command});
    command.release();

    // Leave the shared state exactly as the next main frame expects: empty
    // batches + main dims/globals.
    rects.reset();
    text.reset();
    curves.reset();
    capsules.reset();
    polys.reset();
    images.reset();
    sdf_icons.reset();
    gcurve_fill.reset();
    g_static_capture_count = 0;
    g_scissor_count = 0;
    g_scissor_depth = 0;
    restorePanelGlobals(saved_w, saved_h);
    return target;
}

fn restorePanelGlobals(saved_w: u32, saved_h: u32) void {
    g_width = saved_w;
    g_height = saved_h;
    if (g_queue) |q| writeGlobals(q, saved_w, saved_h);
}

/// Render all queued primitives and present.
pub fn frame(io: std.Io, environ: *const std.process.Environ.Map, bg_r: f64, bg_g: f64, bg_b: f64) void {
    const device = g_device orelse return;
    const queue = g_queue orelse return;

    // Periodic memory drain
    g_frame_counter += 1;
    if (g_frame_counter % DRAIN_INTERVAL == 0) drainMemory();
    filters.frameReset();

    // Reset the per-frame present/vsync-wait accumulator. We time the two points
    // where the compositor can block us — swapchain acquire and present — so the
    // spikewatch reports the real vblank wait instead of inferring it from a
    // small CPU phase. (This wait is a subset of gpu_us, not of "other".)
    g_present_wait_us = 0;

    // Acquire the render-target view: the swapchain's current texture in
    // windowed mode, or the persistent offscreen texture in KMS mode (which
    // is read back and scanned out via DRM after the frame).
    var surface_texture: wgpu.SurfaceTexture = undefined;
    var owned_view: ?*wgpu.TextureView = null; // swapchain view — released each frame
    var capture_tex: ?*wgpu.Texture = null; // texture the pre-present capture hook reads (windowed)
    const view: *wgpu.TextureView = blk: {
        if (g_kms) break :blk g_offscreen_view orelse return;
        const surface = g_surface orelse return;
        const acquire_t0 = std.Io.Clock.now(.awake, io).toMicroseconds();
        surface.getCurrentTexture(&surface_texture);
        g_present_wait_us += @intCast(@max(0, std.Io.Clock.now(.awake, io).toMicroseconds() - acquire_t0));
        if (surface_texture.status != .success_optimal and surface_texture.status != .success_suboptimal) {
            if (surface_texture.texture) |t| t.release();
            if (g_width > 0 and g_height > 0) configureSurface(g_width, g_height);
            rects.reset();
            text.reset();
            curves.reset();
            capsules.reset();
            polys.reset();
            images.reset();
            sdf_icons.reset();
            gcurve_fill.reset();
            g_static_capture_count = 0;
            g_scissor_count = 0;
            g_scissor_depth = 0;
            return;
        }
        const texture_obj = surface_texture.texture orelse return;
        capture_tex = texture_obj;
        const v = texture_obj.createView(null) orelse return;
        owned_view = v;
        break :blk v;
    };
    defer if (capture_tex) |t| t.release();
    defer if (owned_view) |v| v.release();

    // Per-pipeline dirty upload. Each 2D vertex buffer re-uploads only when its
    // own content changed this frame, so a single on-screen change touches only
    // the buffer it actually affected (a HUD number → text), instead of the old
    // combined-hash gate that re-uploaded ALL five buffers on ANY change — a
    // full-buffer re-upload spike on every frame something on screen ticked.
    //
    // force_all covers: the first frame and a post-drain frame (buffers were
    // recreated), a resize (globals + every buffer must refresh), and a pending
    // StaticSurface capture (the whole 2D pass re-runs into an offscreen target,
    // so every buffer must be live that frame).
    const dims_changed = (g_width != g_prev_dims[0] or g_height != g_prev_dims[1]);
    const force_all = g_force_full_upload or dims_changed or g_static_capture_count > 0;
    g_force_full_upload = false;
    if (dims_changed) g_prev_dims = .{ g_width, g_height };

    const rects_hash = rects.hashData();
    const text_hash = text.hashData();
    const curves_hash = curves.hashData();
    const capsules_hash = capsules.hashData();
    const polys_hash = polys.hashData();

    var uploaded_any = force_all;
    if (force_all or rects_hash != g_prev_pipeline_hashes.rects) {
        g_prev_pipeline_hashes.rects = rects_hash;
        rects.upload(queue);
        uploaded_any = true;
    }
    if (force_all or text_hash != g_prev_pipeline_hashes.text) {
        g_prev_pipeline_hashes.text = text_hash;
        text.upload(queue);
        uploaded_any = true;
    }
    if (force_all or curves_hash != g_prev_pipeline_hashes.curves) {
        g_prev_pipeline_hashes.curves = curves_hash;
        curves.upload(queue);
        uploaded_any = true;
    }
    if (force_all or capsules_hash != g_prev_pipeline_hashes.capsules) {
        g_prev_pipeline_hashes.capsules = capsules_hash;
        capsules.upload(queue);
        uploaded_any = true;
    }
    if (force_all or polys_hash != g_prev_pipeline_hashes.polys) {
        g_prev_pipeline_hashes.polys = polys_hash;
        polys.upload(queue);
        uploaded_any = true;
    }

    // Whenever we touched a buffer (or a capture will run), make sure the globals
    // uniform holds the screen size before the main pass. Captures overwrite it
    // with their own dims and restore screen dims when they finish; this covers
    // the no-capture path. Telemetry frame_hash mirrors the combined content.
    if (uploaded_any) {
        writeGlobals(queue, g_width, g_height);
        g_prev_frame_hash = rects_hash ^ text_hash ^ curves_hash ^ capsules_hash ^ polys_hash;
    }

    // Image quads always upload (video frames change independently of UI dirty state)
    if (images.count() > 0) images.upload(queue);
    // SDF icon quads — outside the dirty-check fast path because their atlas
    // is immutable but instance positions change with layout.
    if (sdf_icons.count() > 0) sdf_icons.upload(queue);
    if (gcurve_fill.count() > 0) gcurve_fill.upload(queue);

    renderStaticSurfaceCaptures(device, queue);

    // Draw deferred 3D scenes now — AFTER StaticSurface captures so a mesh that
    // samples a captured surface via textureKey reads THIS frame's content
    // (billboards / screens), and BEFORE the main pass so the composite quad
    // queued during the paint walk samples a freshly-rendered 3D RT.
    scene3d.flushPending(io, environ);

    const encoder = device.createCommandEncoder(&.{}) orelse return;

    // Render pass
    const color_attachment = wgpu.ColorAttachment{
        .view = view,
        .load_op = .clear,
        .store_op = .store,
        .clear_value = .{ .r = bg_r, .g = bg_g, .b = bg_b, .a = 1.0 },
    };

    const rp_desc = wgpu.RenderPassDescriptor{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&color_attachment),
    };
    const render_pass = encoder.beginRenderPass(&rp_desc) orelse return;

    const total_rects: u32 = @intCast(rects.count());
    const total_glyphs: u32 = @intCast(text.count());
    const total_curves: u32 = @intCast(curves.count());
    const total_capsules: u32 = @intCast(capsules.count());
    const total_polys: u32 = @intCast(polys.count());
    const total_images: u32 = @intCast(images.count());
    // Per-frame breakdown — debug tier so it doesn't drown the event ring
    // at default threshold; opt in via devshell `l` to trace.
    log.debug(.gpu, "frame dims={d}x{d} rects={d} glyphs={d} curves={d} capsules={d} polys={d} images={d} boundaries={d}", .{
        g_width, g_height, total_rects, total_glyphs, total_curves, total_capsules, total_polys, total_images, g_scissor_count,
    });

    drawSegmented2D(render_pass);

    render_pass.end();
    render_pass.release();

    const command = encoder.finish(null) orelse return;
    encoder.release();

    queue.submit(&.{command});
    command.release();

    // Capture hook — readback the rendered frame before present (like Love2D's captureScreenshot)
    // Sync readback requires device.poll() — not available on web.
    if (!is_web and g_capture_requested) {
        const cap_t = if (g_kms) g_offscreen else capture_tex;
        if (cap_t) |t| performCapture(io, device, queue, t);
    }

    if (g_kms) {
        // No swapchain — read back the offscreen texture and scan it out via DRM.
        presentKms();
    } else if (!is_web) {
        if (g_surface) |s| {
            const present_t0 = std.Io.Clock.now(.awake, io).toMicroseconds();
            _ = s.present();
            g_present_wait_us += @intCast(@max(0, std.Io.Clock.now(.awake, io).toMicroseconds() - present_t0));
        }
    }

    // Release deferred 3D render targets after image compositing, before reset
    scene3d.frameCleanup();
    // Drain the static-surface release graveyard (req_2743): everything parked
    // during this frame's paint was still referenced by the just-submitted
    // command buffer — now it's safe to let go.
    drainDeferredReleases();

    // Reset for next frame
    rects.reset();
    text.reset();
    curves.reset();
    capsules.reset();
    polys.reset();
    images.reset();
    sdf_icons.reset();
    gcurve_fill.reset();
    g_static_capture_count = 0;
    g_scissor_count = 0;
    g_scissor_depth = 0;
    if (g_gpu_ops >= GPU_OPS_BUDGET) {
        @import("std").debug.print("[BUDGET] GPU ops hit {d}/{d} this frame\n", .{ g_gpu_ops, GPU_OPS_BUDGET });
    }
    g_gpu_ops = 0;
}

// ════════════════════════════════════════════════════════════════════════
// Telemetry & diagnostics
// ════════════════════════════════════════════════════════════════════════

pub const Stats = struct {
    rect_count: usize,
    glyph_count: usize,
    atlas_count: usize,
    atlas_max: usize,
    rect_max: usize,
    glyph_max: usize,
    atlas_row_y: u32,
    atlas_size: u32,
};

pub fn getStats() Stats {
    return .{
        .rect_count = rects.lastCount(),
        .glyph_count = text.lastCount(),
        .atlas_count = text.atlasCount(),
        .atlas_max = text.atlasCapacity(),
        .rect_max = rects.MAX_RECTS,
        .glyph_max = text.MAX_GLYPHS,
        .atlas_row_y = text.atlasRowY(),
        .atlas_size = text.atlasSize(),
    };
}

pub const TelemetryStats = struct {
    rect_count: u32,
    glyph_count: u32,
    rect_capacity: u32,
    glyph_capacity: u32,
    atlas_glyph_count: u32,
    atlas_miss_count: u32,
    atlas_capacity: u32,
    atlas_row_x: u32,
    atlas_row_y: u32,
    scissor_depth: u32,
    scissor_segment_count: u32,
    surface_w: u32,
    surface_h: u32,
    frame_hash: u64,
    rect_hash: u64,
    text_hash: u64,
    curves_hash: u64,
    capsules_hash: u64,
    polys_hash: u64,
    text_trace: []const u8,
    static_capture_count: u32,
    static_capture_trace: []const u8,
    frames_since_drain: u64,
};

pub fn telemetryStats() TelemetryStats {
    return .{
        .rect_count = @intCast(rects.lastCount()),
        .glyph_count = @intCast(text.lastCount()),
        .rect_capacity = rects.MAX_RECTS,
        .glyph_capacity = text.MAX_GLYPHS,
        .atlas_glyph_count = @intCast(text.atlasCount()),
        .atlas_miss_count = @intCast(text.lastAtlasMissCount()),
        .atlas_capacity = @intCast(text.atlasCapacity()),
        .atlas_row_x = 0, // internal to text pipeline now
        .atlas_row_y = text.atlasRowY(),
        .scissor_depth = @intCast(g_scissor_depth),
        .scissor_segment_count = @intCast(g_scissor_count),
        .surface_w = g_width,
        .surface_h = g_height,
        .frame_hash = g_prev_frame_hash,
        .rect_hash = g_prev_pipeline_hashes.rects,
        .text_hash = g_prev_pipeline_hashes.text,
        .curves_hash = g_prev_pipeline_hashes.curves,
        .capsules_hash = g_prev_pipeline_hashes.capsules,
        .polys_hash = g_prev_pipeline_hashes.polys,
        .text_trace = text.lastTraceSummary(),
        .static_capture_count = @intCast(g_last_static_capture_count),
        .static_capture_trace = g_last_static_capture_trace[0..g_last_static_capture_trace_len],
        .frames_since_drain = g_frame_counter % DRAIN_INTERVAL,
    };
}

pub fn telemetryFrameCounter() u64 {
    return g_frame_counter;
}

// ════════════════════════════════════════════════════════════════════════
// Surface / platform helpers
// ════════════════════════════════════════════════════════════════════════

fn configureSurface(width: u32, height: u32) void {
    if (is_web) return; // Browser manages the canvas swapchain
    const surface = g_surface orelse return;
    const device = g_device orelse return;
    const adapter = g_adapter orelse return;

    var caps: wgpu.SurfaceCapabilities = undefined;
    _ = surface.getCapabilities(adapter, &caps);

    // Prefer non-sRGB format to avoid double gamma correction.
    g_format = .bgra8_unorm;
    if (caps.format_count > 0) {
        g_format = caps.formats[0];
        for (caps.formats[0..caps.format_count]) |fmt| {
            if (fmt == .bgra8_unorm or fmt == .rgba8_unorm) {
                g_format = fmt;
                break;
            }
        }
    }

    const config = wgpu.SurfaceConfiguration{
        .device = device,
        .format = g_format,
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.copy_src,
        .width = width,
        .height = height,
        .present_mode = if (g_vsync_off) .immediate else .fifo,
        .alpha_mode = .auto,
    };
    surface.configure(&config);
}

// ════════════════════════════════════════════════════════════════════════
// Extra surfaces (WORLDWIN-0611) — additional OS windows on the SAME wgpu
// device. The main surface/swapchain stays the singleton this module is
// built around; an extra surface is a sibling swapchain a secondary window
// (gpu/world_window.zig) acquires/presents itself. Shared device + queue
// means the pop-out can sample any texture this process rendered (the 3D
// render-to-texture slots) with zero copies.
// ════════════════════════════════════════════════════════════════════════

/// Create a wgpu surface for an additional SDL window (same instance).
pub fn createWindowSurface(window: *c.SDL_Window) ?*wgpu.Surface {
    const instance = g_instance orelse return null;
    return createSurfaceFromSDL(instance, window);
}

/// Configure an extra surface's swapchain; returns the format chosen from its
/// own capabilities (an extra window may land on a different format than the
/// main surface — its blit pipeline must be built against THIS return value).
pub fn configureExtraSurface(surface: *wgpu.Surface, width: u32, height: u32) ?wgpu.TextureFormat {
    const device = g_device orelse return null;
    const adapter = g_adapter orelse return null;
    var caps: wgpu.SurfaceCapabilities = undefined;
    _ = surface.getCapabilities(adapter, &caps);
    var format: wgpu.TextureFormat = .bgra8_unorm;
    if (caps.format_count > 0) {
        format = caps.formats[0];
        for (caps.formats[0..caps.format_count]) |fmt| {
            if (fmt == .bgra8_unorm or fmt == .rgba8_unorm) {
                format = fmt;
                break;
            }
        }
    }
    surface.configure(&.{
        .device = device,
        .format = format,
        .usage = wgpu.TextureUsages.render_attachment,
        .width = @max(1, width),
        .height = @max(1, height),
        .present_mode = .fifo,
        .alpha_mode = .auto,
    });
    return format;
}

fn createSurfaceFromSDL(instance: *wgpu.Instance, window: *c.SDL_Window) ?*wgpu.Surface {
    const props = c.SDL_GetWindowProperties(window);

    // Try X11 first
    const x11_display = c.SDL_GetPointerProperty(props, c.SDL_PROP_WINDOW_X11_DISPLAY_POINTER, null);
    const x11_window = c.SDL_GetNumberProperty(props, c.SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0);
    if (x11_display != null and x11_window != 0) {
        const d = wgpu.surfaceDescriptorFromXlibWindow(.{
            .display = @ptrCast(x11_display),
            .window = @intCast(x11_window),
        });
        return instance.createSurface(&d);
    }

    // Try Wayland
    const wl_display = c.SDL_GetPointerProperty(props, c.SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, null);
    const wl_surface = c.SDL_GetPointerProperty(props, c.SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, null);
    if (wl_display != null and wl_surface != null) {
        const d = wgpu.surfaceDescriptorFromWaylandSurface(.{
            .display = @ptrCast(wl_display),
            .surface = @ptrCast(wl_surface),
        });
        return instance.createSurface(&d);
    }

    // Try Metal (macOS / iOS)
    const metal_view = c.SDL_Metal_CreateView(window);
    if (metal_view) |view| {
        if (c.SDL_Metal_GetLayer(view)) |layer| {
            const d = wgpu.surfaceDescriptorFromMetalLayer(.{
                .layer = layer,
            });
            return instance.createSurface(&d);
        }
    }

    log.print("No supported windowing subsystem found (tried X11, Wayland, Metal)\n", .{});
    return null;
}
