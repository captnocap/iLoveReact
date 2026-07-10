//! Curve rendering pipeline — SDF quadratic bezier strokes.
//!
//! Owns the CurveInstance struct, CPU-side batch array, GPU buffer,
//! pipeline, and bind group. Cubics are split into quadratics on the
//! CPU side via de Casteljau subdivision.

const std = @import("std");
const log = @import("../diag/log.zig");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const pack = @import("pack.zig");
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/// Per-instance curve data — 32 bytes (was 64: f32x4 color + 20 bytes of
/// literal padding). Control points and stroke keep full f32; color rides
/// unorm8x4, widened back to vec4f by the vertex fetch.
pub const CurveInstance = extern struct {
    p0_x: f32,
    p0_y: f32,
    p1_x: f32,
    p1_y: f32,
    p2_x: f32,
    p2_y: f32,
    color: [4]u8,
    stroke_width: f32,
};

comptime {
    if (@sizeOf(CurveInstance) != 32 or @alignOf(CurveInstance) != 4) {
        @compileError("CurveInstance must match curve_wgsl per-instance vertex layout (32 bytes)");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Constants & State
// ════════════════════════════════════════════════════════════════════════

pub const MAX_CURVES = 32768;

var g_curves: [MAX_CURVES]CurveInstance = undefined;
var g_curve_count: usize = 0;
var g_last_curve_count: usize = 0;
var g_capacity_warning_emitted: bool = false;

var g_curve_pipeline: ?*wgpu.RenderPipeline = null;
var g_curve_buffer: ?*wgpu.Buffer = null;
var g_curve_bind_group: ?*wgpu.BindGroup = null;
var g_curve_bind_group_layout: ?*wgpu.BindGroupLayout = null;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Queue a quadratic bezier curve for drawing this frame.
pub fn drawCurve(
    p0x: f32,
    p0y: f32,
    p1x: f32,
    p1y: f32,
    p2x: f32,
    p2y: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    stroke_width: f32,
) void {
    if (g_curve_count >= MAX_CURVES) {
        if (!g_capacity_warning_emitted) {
            log.print("[gpu.curves] capacity reached: {d} curves; dropping later curve draws this frame\n", .{MAX_CURVES});
            g_capacity_warning_emitted = true;
        }
        return;
    }
    if (core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;

    // Apply canvas transform if active
    const transform = core.getTransform();
    const t0x = if (transform.active) (p0x - transform.ox) * transform.scale + transform.ox + transform.tx else p0x;
    const t0y = if (transform.active) (p0y - transform.oy) * transform.scale + transform.oy + transform.ty else p0y;
    const t1x = if (transform.active) (p1x - transform.ox) * transform.scale + transform.ox + transform.tx else p1x;
    const t1y = if (transform.active) (p1y - transform.oy) * transform.scale + transform.oy + transform.ty else p1y;
    const t2x = if (transform.active) (p2x - transform.ox) * transform.scale + transform.ox + transform.tx else p2x;
    const t2y = if (transform.active) (p2y - transform.oy) * transform.scale + transform.oy + transform.ty else p2y;
    const tw = if (transform.active) stroke_width * transform.scale else stroke_width;

    g_curves[g_curve_count] = .{
        .p0_x = t0x,
        .p0_y = t0y,
        .p1_x = t1x,
        .p1_y = t1y,
        .p2_x = t2x,
        .p2_y = t2y,
        .color = pack.rgba8(r, g, b, a),
        .stroke_width = tw,
    };
    g_curve_count += 1;
}

/// Queue a cubic bezier curve by splitting it into 2 quadratics via de Casteljau.
pub fn drawCubicCurve(
    p0x: f32,
    p0y: f32,
    p1x: f32,
    p1y: f32,
    p2x: f32,
    p2y: f32,
    p3x: f32,
    p3y: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    stroke_width: f32,
) void {
    // Split cubic at t=0.5 via de Casteljau
    const m01x = (p0x + p1x) * 0.5;
    const m01y = (p0y + p1y) * 0.5;
    const m12x = (p1x + p2x) * 0.5;
    const m12y = (p1y + p2y) * 0.5;
    const m23x = (p2x + p3x) * 0.5;
    const m23y = (p2y + p3y) * 0.5;

    const m012x = (m01x + m12x) * 0.5;
    const m012y = (m01y + m12y) * 0.5;
    const m123x = (m12x + m23x) * 0.5;
    const m123y = (m12y + m23y) * 0.5;

    const mid_x = (m012x + m123x) * 0.5;
    const mid_y = (m012y + m123y) * 0.5;

    // Left sub-cubic: p0, m01, m012, mid
    // Approximate as quadratic: ctrl = (3*(m01 + m012) - (p0 + mid)) / 4
    const lctrl_x = (3.0 * (m01x + m012x) - (p0x + mid_x)) * 0.25;
    const lctrl_y = (3.0 * (m01y + m012y) - (p0y + mid_y)) * 0.25;

    // Right sub-cubic: mid, m123, m23, p3
    // Approximate as quadratic: ctrl = (3*(m123 + m23) - (mid + p3)) / 4
    const rctrl_x = (3.0 * (m123x + m23x) - (mid_x + p3x)) * 0.25;
    const rctrl_y = (3.0 * (m123y + m23y) - (mid_y + p3y)) * 0.25;

    // Queue both quadratics
    drawCurve(p0x, p0y, lctrl_x, lctrl_y, mid_x, mid_y, r, g, b, a, stroke_width);
    drawCurve(mid_x, mid_y, rctrl_x, rctrl_y, p3x, p3y, r, g, b, a, stroke_width);
}

/// Initialize the curve rendering pipeline.
pub fn initPipeline(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "curve_shader",
        .code = shaders.curve_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("Failed to create curve shader module\n", .{});
        return;
    };
    defer shader_module.release();

    // Curve instance buffer
    g_curve_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("curve_instances"),
        .size = MAX_CURVES * @sizeOf(CurveInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    // Bind group layout (group 0: globals uniform)
    const bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = 1,
        .entries = @ptrCast(&wgpu.BindGroupLayoutEntry{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
            .buffer = .{
                .type = .uniform,
                .has_dynamic_offset = 0,
                .min_binding_size = 8,
            },
        }),
    }) orelse return;
    g_curve_bind_group_layout = bind_group_layout;

    // Bind group
    g_curve_bind_group = device.createBindGroup(&.{
        .layout = bind_group_layout,
        .entry_count = 1,
        .entries = @ptrCast(&wgpu.BindGroupEntry{
            .binding = 0,
            .buffer = globals_buffer,
            .offset = 0,
            .size = 16,
        }),
    });

    // Pipeline layout
    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bind_group_layout),
    }) orelse return;
    defer pipeline_layout.release();

    // 5 attribute slots over the 32-byte row (see CurveInstance).
    const instance_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0, .shader_location = 0 }, // p0
        .{ .format = .float32x2, .offset = 8, .shader_location = 1 }, // p1
        .{ .format = .float32x2, .offset = 16, .shader_location = 2 }, // p2
        .{ .format = .unorm8x4, .offset = 24, .shader_location = 3 }, // color
        .{ .format = .float32, .offset = 28, .shader_location = 4 }, // stroke_width
    };

    const instance_buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(CurveInstance),
        .attribute_count = instance_attrs.len,
        .attributes = &instance_attrs,
    };

    // Blend state: premultiplied alpha
    const blend_state = wgpu.BlendState.premultiplied_alpha_blending;

    const color_target = wgpu.ColorTargetState{
        .format = core.getFormat(),
        .blend = &blend_state,
        .write_mask = wgpu.ColorWriteMasks.all,
    };

    const fragment_state = wgpu.FragmentState{
        .module = shader_module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };

    g_curve_pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{
            .module = shader_module,
            .entry_point = wgpu.StringView.fromSlice("vs_main"),
            .buffer_count = 1,
            .buffers = @ptrCast(&instance_buffer_layout),
        },
        .primitive = .{
            .topology = .triangle_list,
        },
        .multisample = .{},
        .fragment = &fragment_state,
    });

    if (g_curve_pipeline == null) {
        log.print("Failed to create curve render pipeline\n", .{});
    }
}

/// Draw a batch of curves in the given instance range.
pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_curve_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_curve_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_curve_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, bu.bytesOfCount(CurveInstance, g_curve_count));
        }
        render_pass.draw(6, end - start, 0, start);
    }
}

/// Upload curve instance data to the GPU.
pub fn upload(queue: *wgpu.Queue) void {
    if (g_curve_count > 0) {
        if (g_curve_buffer) |buf| {
            bu.writeTypedBuffer(queue, buf, 0, CurveInstance, g_curves[0..g_curve_count]);
        }
    }
}

/// Recreate buffer + bind group to reclaim fragmented GPU memory.
pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    if (g_curve_bind_group) |bg| bg.release();
    if (g_curve_buffer) |b| b.release();

    g_curve_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("curve_instances"),
        .size = MAX_CURVES * @sizeOf(CurveInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    if (g_curve_bind_group_layout) |layout| {
        g_curve_bind_group = device.createBindGroup(&.{
            .layout = layout,
            .entry_count = 1,
            .entries = @ptrCast(&wgpu.BindGroupEntry{
                .binding = 0,
                .buffer = globals_buffer,
                .offset = 0,
                .size = 16,
            }),
        });
    }
}

/// Release all GPU resources.
pub fn deinit() void {
    if (g_curve_bind_group) |bg| bg.release();
    if (g_curve_bind_group_layout) |l| l.release();
    if (g_curve_buffer) |b| b.release();
    if (g_curve_pipeline) |p| p.release();
    g_curve_bind_group = null;
    g_curve_bind_group_layout = null;
    g_curve_buffer = null;
    g_curve_pipeline = null;
}

/// Current number of queued curves.
pub fn count() usize {
    return g_curve_count;
}

/// Last frame's curve count (captured before reset).
pub fn lastCount() usize {
    return g_last_curve_count;
}

/// Reset for next frame.
pub fn reset() void {
    g_last_curve_count = g_curve_count;
    g_curve_count = 0;
    g_capacity_warning_emitted = false;
}

/// Hash the current curve instance data for dirty checking.
pub fn hashData() u64 {
    var h: u64 = @as(u64, g_curve_count) *% 0x6a09e667f3bcc908;
    if (g_curve_count > 0) {
        const len = g_curve_count * @sizeOf(CurveInstance);
        const bytes: [*]const u8 = @ptrCast(&g_curves);
        var i: usize = 0;
        while (i + 8 <= len) : (i += 8) {
            h ^= std.mem.readInt(u64, bytes[i..][0..8], .little);
            h = h *% 0x2127599bf4325c37 +% 0x880355f21e6d1965;
        }
    }
    return h;
}
