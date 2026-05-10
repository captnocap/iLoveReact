//! Rect rendering pipeline — instanced SDF rounded rectangles.
//!
//! Owns the RectInstance struct, CPU-side batch array, GPU buffer,
//! pipeline, and bind group. The core gpu.zig orchestrator calls
//! upload/drawBatch/reset each frame.

const std = @import("std");
const log = @import("../diag/log.zig");
const wgpu = @import("wgpu");
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/// Per-instance rect data — matches the WGSL struct layout.
/// 20 x f32 = 80 bytes (16-float aligned for GPU).
pub const RectInstance = extern struct {
    // Position (top-left, screen pixels)
    pos_x: f32,
    pos_y: f32,
    // Size (width, height in pixels)
    size_w: f32,
    size_h: f32,
    // Background color RGBA [0..1]
    color_r: f32,
    color_g: f32,
    color_b: f32,
    color_a: f32,
    // Border color RGBA [0..1]
    border_color_r: f32,
    border_color_g: f32,
    border_color_b: f32,
    border_color_a: f32,
    // Border radius per corner: tl, tr, br, bl
    radius_tl: f32,
    radius_tr: f32,
    radius_br: f32,
    radius_bl: f32,
    // Border width
    border_width: f32,
    // Per-node transform (visual only, no layout effect)
    rotation: f32 = 0, // degrees
    scale_x: f32 = 1.0,
    scale_y: f32 = 1.0,
    // SDF shadow blur — widens the smoothstep falloff in the fragment shader.
    // 0 = normal sharp rect, >0 = soft shadow edge over blur_radius pixels.
    blur_radius: f32 = 0,
    // Gradient: end color + direction (0=none, 1=vertical, 2=horizontal, 3=diagonal)
    grad_r: f32 = 0,
    grad_g: f32 = 0,
    grad_b: f32 = 0,
    grad_a: f32 = 0,
    grad_dir: f32 = 0,
};

// ════════════════════════════════════════════════════════════════════════
// Constants & State
// ════════════════════════════════════════════════════════════════════════

// Per-frame rect-instance pool. Each Box with bg/border consumes one
// slot. The chart_stress bench at 4000 bars rides above the prior 4096
// once chrome (toggles, header, summary) is included. Bumped to 16384;
// ~1.5MB BSS for the rect-instance array + GPU buffer.
pub const MAX_RECTS = 16384;

var g_rects: [MAX_RECTS]RectInstance = undefined;
var g_rect_count: usize = 0;
var g_last_rect_count: usize = 0;

var g_rect_pipeline: ?*wgpu.RenderPipeline = null;
var g_rect_buffer: ?*wgpu.Buffer = null;
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Queue a rectangle for drawing this frame.
pub fn drawRect(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    border_radius: f32,
    border_width: f32,
    br: f32,
    bg: f32,
    bb: f32,
    ba: f32,
) void {
    if (g_rect_count >= MAX_RECTS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;

    // Compose canvas pan/zoom + node CSS transform stack into a single rect.
    const tr = core.resolveRect(x, y, w, h);

    g_rects[g_rect_count] = .{
        .pos_x = tr.x,
        .pos_y = tr.y,
        .size_w = tr.w,
        .size_h = tr.h,
        .color_r = r,
        .color_g = g,
        .color_b = b,
        .color_a = a,
        .border_color_r = br,
        .border_color_g = bg,
        .border_color_b = bb,
        .border_color_a = ba,
        .radius_tl = border_radius,
        .radius_tr = border_radius,
        .radius_br = border_radius,
        .radius_bl = border_radius,
        .border_width = border_width,
        .rotation = tr.rotation_deg,
    };
    g_rect_count += 1;
}

/// Queue a rectangle with per-corner border radii.
pub fn drawRectCorners(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    rtl: f32,
    rtr: f32,
    rbr: f32,
    rbl: f32,
    border_width: f32,
    br: f32,
    bg: f32,
    bb: f32,
    ba: f32,
) void {
    if (g_rect_count >= MAX_RECTS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    const tr = core.resolveRect(x, y, w, h);
    g_rects[g_rect_count] = .{
        .pos_x = tr.x,
        .pos_y = tr.y,
        .size_w = tr.w,
        .size_h = tr.h,
        .color_r = r,
        .color_g = g,
        .color_b = b,
        .color_a = a,
        .border_color_r = br,
        .border_color_g = bg,
        .border_color_b = bb,
        .border_color_a = ba,
        .radius_tl = rtl,
        .radius_tr = rtr,
        .radius_br = rbr,
        .radius_bl = rbl,
        .border_width = border_width,
        .rotation = tr.rotation_deg,
    };
    g_rect_count += 1;
}

/// Queue a rectangle with per-corner radii and explicit per-rect rotation/scale.
/// Composes with any active node-matrix transform.
pub fn drawRectCornersTransformed(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    rtl: f32,
    rtr: f32,
    rbr: f32,
    rbl: f32,
    border_width: f32,
    br: f32,
    bg: f32,
    bb: f32,
    ba: f32,
    rotation_deg: f32,
    sx: f32,
    sy: f32,
) void {
    if (g_rect_count >= MAX_RECTS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    const tr = core.resolveRect(x, y, w, h);
    g_rects[g_rect_count] = .{
        .pos_x = tr.x,
        .pos_y = tr.y,
        .size_w = tr.w,
        .size_h = tr.h,
        .color_r = r,
        .color_g = g,
        .color_b = b,
        .color_a = a,
        .border_color_r = br,
        .border_color_g = bg,
        .border_color_b = bb,
        .border_color_a = ba,
        .radius_tl = rtl,
        .radius_tr = rtr,
        .radius_br = rbr,
        .radius_bl = rbl,
        .border_width = border_width,
        .rotation = rotation_deg + tr.rotation_deg,
        .scale_x = sx,
        .scale_y = sy,
    };
    g_rect_count += 1;
}

/// Queue a rectangle with explicit per-rect rotation/scale. Composes with any
/// active node-matrix transform.
pub fn drawRectTransformed(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    border_radius: f32,
    border_width: f32,
    br: f32,
    bg: f32,
    bb: f32,
    ba: f32,
    rotation_deg: f32,
    sx: f32,
    sy: f32,
) void {
    if (g_rect_count >= MAX_RECTS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    const tr = core.resolveRect(x, y, w, h);
    g_rects[g_rect_count] = .{
        .pos_x = tr.x,
        .pos_y = tr.y,
        .size_w = tr.w,
        .size_h = tr.h,
        .color_r = r,
        .color_g = g,
        .color_b = b,
        .color_a = a,
        .border_color_r = br,
        .border_color_g = bg,
        .border_color_b = bb,
        .border_color_a = ba,
        .radius_tl = border_radius,
        .radius_tr = border_radius,
        .radius_br = border_radius,
        .radius_bl = border_radius,
        .border_width = border_width,
        .rotation = rotation_deg + tr.rotation_deg,
        .scale_x = sx,
        .scale_y = sy,
    };
    g_rect_count += 1;
}

/// Queue a single shadow rect with SDF blur.
/// The rect is expanded by blur pixels and positioned at the shadow offset.
/// The fragment shader uses blur_radius to widen the SDF falloff for a soft edge.
pub fn drawRectShadow(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    rtl: f32,
    rtr: f32,
    rbr: f32,
    rbl: f32,
    blur: f32,
) void {
    if (g_rect_count >= MAX_RECTS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    const tr = core.resolveRect(x, y, w, h);
    g_rects[g_rect_count] = .{
        .pos_x = tr.x,
        .pos_y = tr.y,
        .size_w = tr.w,
        .size_h = tr.h,
        .color_r = r,
        .color_g = g,
        .color_b = b,
        .color_a = a,
        .border_color_r = 0,
        .border_color_g = 0,
        .border_color_b = 0,
        .border_color_a = 0,
        .radius_tl = rtl,
        .radius_tr = rtr,
        .radius_br = rbr,
        .radius_bl = rbl,
        .border_width = 0,
        .blur_radius = blur,
        .rotation = tr.rotation_deg,
    };
    g_rect_count += 1;
}

/// Queue a rectangle with a gradient background.
/// dir: 1=vertical, 2=horizontal, 3=diagonal
pub fn drawRectGradient(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    rtl: f32,
    rtr: f32,
    rbr: f32,
    rbl: f32,
    border_width: f32,
    br: f32,
    bg: f32,
    bb: f32,
    ba: f32,
    gr: f32,
    gg: f32,
    gb: f32,
    ga: f32,
    dir: f32,
) void {
    if (g_rect_count >= MAX_RECTS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    const tr = core.resolveRect(x, y, w, h);
    g_rects[g_rect_count] = .{
        .pos_x = tr.x,
        .pos_y = tr.y,
        .size_w = tr.w,
        .size_h = tr.h,
        .color_r = r,
        .color_g = g,
        .color_b = b,
        .color_a = a,
        .border_color_r = br,
        .border_color_g = bg,
        .border_color_b = bb,
        .border_color_a = ba,
        .radius_tl = rtl,
        .radius_tr = rtr,
        .radius_br = rbr,
        .radius_bl = rbl,
        .border_width = border_width,
        .grad_r = gr,
        .grad_g = gg,
        .grad_b = gb,
        .grad_a = ga,
        .grad_dir = dir,
        .rotation = tr.rotation_deg,
    };
    g_rect_count += 1;
}

/// Initialize the rect rendering pipeline.
pub fn initPipeline(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "rect_shader",
        .code = shaders.rect_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("Failed to create rect shader module\n", .{});
        return;
    };
    defer shader_module.release();

    // Rect instance buffer
    g_rect_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("rect_instances"),
        .size = MAX_RECTS * @sizeOf(RectInstance),
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
    g_bind_group_layout = bind_group_layout;

    // Bind group
    g_bind_group = device.createBindGroup(&.{
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

    // Instance vertex attributes (12 locations for 26 floats)
    const instance_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0, .shader_location = 0 }, // pos
        .{ .format = .float32x2, .offset = 8, .shader_location = 1 }, // size
        .{ .format = .float32x4, .offset = 16, .shader_location = 2 }, // color
        .{ .format = .float32x4, .offset = 32, .shader_location = 3 }, // border_color
        .{ .format = .float32x4, .offset = 48, .shader_location = 4 }, // radii
        .{ .format = .float32, .offset = 64, .shader_location = 5 }, // border_width
        .{ .format = .float32, .offset = 68, .shader_location = 6 }, // rotation
        .{ .format = .float32, .offset = 72, .shader_location = 7 }, // scale_x
        .{ .format = .float32, .offset = 76, .shader_location = 8 }, // scale_y
        .{ .format = .float32, .offset = 80, .shader_location = 9 }, // blur_radius
        .{ .format = .float32x4, .offset = 84, .shader_location = 10 }, // grad_color
        .{ .format = .float32, .offset = 100, .shader_location = 11 }, // grad_dir
    };

    const instance_buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(RectInstance),
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

    g_rect_pipeline = device.createRenderPipeline(&.{
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

    if (g_rect_pipeline == null) {
        log.print("Failed to create rect render pipeline\n", .{});
    }
}

/// Draw a batch of rects in the given instance range.
pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_rect_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_rect_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, g_rect_count * @sizeOf(RectInstance));
        }
        render_pass.draw(6, end - start, 0, start);
    }
}

/// Upload rect instance data to the GPU.
pub fn upload(queue: *wgpu.Queue) void {
    if (g_rect_count > 0) {
        if (g_rect_buffer) |buf| {
            const byte_size = g_rect_count * @sizeOf(RectInstance);
            queue.writeBuffer(buf, 0, @ptrCast(&g_rects), byte_size);
        }
    }
}

/// Recreate buffer + bind group to reclaim fragmented GPU memory.
pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    if (g_bind_group) |bg| bg.release();
    if (g_rect_buffer) |b| b.release();

    g_rect_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("rect_instances"),
        .size = MAX_RECTS * @sizeOf(RectInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    if (g_bind_group_layout) |layout| {
        g_bind_group = device.createBindGroup(&.{
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
    if (g_bind_group) |bg| bg.release();
    if (g_bind_group_layout) |l| l.release();
    if (g_rect_buffer) |b| b.release();
    if (g_rect_pipeline) |p| p.release();
    g_bind_group = null;
    g_bind_group_layout = null;
    g_rect_buffer = null;
    g_rect_pipeline = null;
}

/// Current number of queued rects.
pub fn count() usize {
    return g_rect_count;
}

/// Last frame's rect count (captured before reset).
pub fn lastCount() usize {
    return g_last_rect_count;
}

/// Reset for next frame.
pub fn reset() void {
    g_last_rect_count = g_rect_count;
    g_rect_count = 0;
}

/// Hash the current rect instance data for dirty checking.
pub fn hashData() u64 {
    var h: u64 = @as(u64, g_rect_count) *% 0x9e3779b97f4a7c15;
    if (g_rect_count > 0) {
        const len = g_rect_count * @sizeOf(RectInstance);
        const bytes: [*]const u8 = @ptrCast(&g_rects);
        var i: usize = 0;
        while (i + 8 <= len) : (i += 8) {
            h ^= std.mem.readInt(u64, bytes[i..][0..8], .little);
            h = h *% 0x2127599bf4325c37 +% 0x880355f21e6d1965;
        }
    }
    return h;
}
