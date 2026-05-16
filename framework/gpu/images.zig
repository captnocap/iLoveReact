//! Image/video quad pipeline — textured rectangles via wgpu.
//!
//! Each image/video has its own wgpu texture + bind group (not batched like rects).
//! Drawing uses separate draw calls per image with different bind groups.
//! The pipeline (shader + vertex layout) is shared across all images.
//!
//! Used by: framework/videos.zig (video frames), future image support.

const std = @import("std");
const wgpu = @import("wgpu");
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");
const log = @import("../diag/log.zig");

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/// Per-instance image quad data — matches the WGSL ImageInstance layout.
/// 6 x f32 = 24 bytes (aligned to 8 for float32x2).
pub const ImageQuad = extern struct {
    pos_x: f32,
    pos_y: f32,
    size_w: f32,
    size_h: f32,
    opacity: f32,
    no_flip_y: f32 = 0,
};

// ════════════════════════════════════════════════════════════════════════
// Constants & State
// ════════════════════════════════════════════════════════════════════════

// Image-quad pool shared by `<Image>` blits, render-to-texture composites
// (StaticSurface, Filter), rasterized SVG fills, and effect-fill
// quads. 256 was a long-standing default that capped real-world pages once
// they had ~50 cards × multiple images each. Bumped to 2048 — ~64KB BSS
// (g_quads + g_bind_groups arrays).
pub const MAX_IMAGE_QUADS = 2048;

var g_quads: [MAX_IMAGE_QUADS]ImageQuad = undefined;
var g_bind_groups: [MAX_IMAGE_QUADS]?*wgpu.BindGroup = .{null} ** MAX_IMAGE_QUADS;
var g_quad_count: usize = 0;

var g_pipeline: ?*wgpu.RenderPipeline = null;
var g_buffer: ?*wgpu.Buffer = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Queue a textured quad for drawing this frame.
/// bind_group must contain: globals uniform + texture_2d + sampler.
pub fn queueQuad(x: f32, y: f32, w: f32, h: f32, opacity: f32, bind_group: *wgpu.BindGroup) void {
    queueQuadInternal(x, y, w, h, opacity, bind_group, false);
}

/// Queue a textured quad without vertically flipping the sampled texture.
/// Use for render-to-texture outputs, where the texture is already top-down.
pub fn queueQuadNoFlip(x: f32, y: f32, w: f32, h: f32, opacity: f32, bind_group: *wgpu.BindGroup) void {
    queueQuadInternal(x, y, w, h, opacity, bind_group, true);
}

fn queueQuadInternal(x: f32, y: f32, w: f32, h: f32, opacity: f32, bind_group: *wgpu.BindGroup, no_flip_y: bool) void {
    if (g_quad_count >= MAX_IMAGE_QUADS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    core.recordImageBoundary(@intCast(g_quad_count));

    // Apply canvas transform if active
    const transform = core.getTransform();
    const tx = if (transform.active) (x - transform.ox) * transform.scale + transform.ox + transform.tx else x;
    const ty = if (transform.active) (y - transform.oy) * transform.scale + transform.oy + transform.ty else y;
    const tw = if (transform.active) w * transform.scale else w;
    const th = if (transform.active) h * transform.scale else h;

    g_quads[g_quad_count] = .{
        .pos_x = tx,
        .pos_y = ty,
        .size_w = tw,
        .size_h = th,
        .opacity = opacity,
        .no_flip_y = if (no_flip_y) 1 else 0,
    };
    g_bind_groups[g_quad_count] = bind_group;
    if (log.isEnabled(.gpu)) {
        log.debug(.gpu, "image queue idx={d} rect=({d:.0},{d:.0},{d:.0},{d:.0}) opacity={d:.2}", .{
            g_quad_count, tx, ty, tw, th, opacity,
        });
    }
    g_quad_count += 1;
    core.recordImageBoundary(@intCast(g_quad_count));
}

/// Get the bind group layout for creating per-image bind groups.
pub fn getBindGroupLayout() ?*wgpu.BindGroupLayout {
    return g_bind_group_layout;
}

/// Forward to gpu.gpu.zig — 3D pipeline needs StaticSurface textures.
pub fn staticSurfaceBindGroup3D(key: []const u8) ?*wgpu.BindGroup {
    return core.staticSurfaceBindGroup3D(key);
}

/// Create a bind group for a specific image texture.
/// Caller owns the returned bind group and must release it.
pub fn createBindGroup(
    texture_view: *wgpu.TextureView,
    sampler: *wgpu.Sampler,
) ?*wgpu.BindGroup {
    const device = core.getDevice() orelse return null;
    const globals_buffer = core.getGlobalsBuffer() orelse return null;
    const bgl = g_bind_group_layout orelse return null;

    const entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 16 },
        .{ .binding = 1, .texture_view = texture_view },
        .{ .binding = 2, .sampler = sampler },
    };

    return device.createBindGroup(&.{
        .layout = bgl,
        .entry_count = entries.len,
        .entries = &entries,
    });
}

// ════════════════════════════════════════════════════════════════════════
// Pipeline setup
// ════════════════════════════════════════════════════════════════════════

pub fn initPipeline(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    _ = globals_buffer;

    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "image_shader",
        .code = shaders.image_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("Failed to create image shader module\n", .{});
        return;
    };
    defer shader_module.release();

    // Instance buffer
    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("image_quads"),
        .size = MAX_IMAGE_QUADS * @sizeOf(ImageQuad),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    // Bind group layout: globals uniform + texture + sampler
    const layout_entries = [_]wgpu.BindGroupLayoutEntry{
        .{ // binding 0: globals uniform
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = 8 },
        },
        .{ // binding 1: image texture
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{
                .sample_type = .float,
                .view_dimension = .@"2d",
                .multisampled = 0,
            },
        },
        .{ // binding 2: sampler
            .binding = 2,
            .visibility = wgpu.ShaderStages.fragment,
            .sampler = .{ .type = .filtering },
        },
    };

    const bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = layout_entries.len,
        .entries = &layout_entries,
    }) orelse return;
    g_bind_group_layout = bind_group_layout;

    // Pipeline layout
    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bind_group_layout),
    }) orelse return;
    defer pipeline_layout.release();

    // Instance vertex attributes
    const instance_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0, .shader_location = 0 }, // pos
        .{ .format = .float32x2, .offset = 8, .shader_location = 1 }, // size
        .{ .format = .float32, .offset = 16, .shader_location = 2 }, // opacity
        .{ .format = .float32, .offset = 20, .shader_location = 3 }, // _pad0
    };

    const instance_buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(ImageQuad),
        .attribute_count = instance_attrs.len,
        .attributes = &instance_attrs,
    };

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

    g_pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{
            .module = shader_module,
            .entry_point = wgpu.StringView.fromSlice("vs_main"),
            .buffer_count = 1,
            .buffers = @ptrCast(&instance_buffer_layout),
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    });

    if (g_pipeline == null) {
        log.print("Failed to create image render pipeline\n", .{});
    }
}

// ════════════════════════════════════════════════════════════════════════
// Per-frame lifecycle
// ════════════════════════════════════════════════════════════════════════

/// Upload queued image quad data to the GPU.
pub fn upload(queue: *wgpu.Queue) void {
    if (g_quad_count > 0) {
        if (g_buffer) |buf| {
            queue.writeBuffer(buf, 0, @ptrCast(&g_quads), g_quad_count * @sizeOf(ImageQuad));
        }
    }
}

/// Draw all queued image quads. Each quad uses its own bind group (texture).
pub fn drawAll(render_pass: *wgpu.RenderPassEncoder) void {
    drawBatch(render_pass, 0, @intCast(g_quad_count));
}

/// Draw a contiguous range of queued image quads.
pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (start >= end) return;
    const pipeline = g_pipeline orelse return;
    const buffer = g_buffer orelse return;

    render_pass.setPipeline(pipeline);
    render_pass.setVertexBuffer(0, buffer, 0, g_quad_count * @sizeOf(ImageQuad));

    var i = start;
    while (i < end) : (i += 1) {
        const bg = g_bind_groups[i] orelse continue;
        render_pass.setBindGroup(0, bg, 0, null);
        render_pass.draw(6, 1, 0, i);
    }
}

/// Current number of queued image quads.
pub fn count() usize {
    return g_quad_count;
}

/// Reset for next frame.
pub fn reset() void {
    g_quad_count = 0;
    for (&g_bind_groups) |*bg| bg.* = null;
}

// ════════════════════════════════════════════════════════════════════════
// Cleanup
// ════════════════════════════════════════════════════════════════════════

pub fn deinit() void {
    if (g_buffer) |b| b.release();
    if (g_pipeline) |p| p.release();
    if (g_bind_group_layout) |l| l.release();
    g_buffer = null;
    g_pipeline = null;
    g_bind_group_layout = null;
}

/// Drain fragmented GPU memory by recreating the instance buffer.
pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    _ = globals_buffer;
    if (g_buffer) |b| b.release();
    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("image_quads"),
        .size = MAX_IMAGE_QUADS * @sizeOf(ImageQuad),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
}
