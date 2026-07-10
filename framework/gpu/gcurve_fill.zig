//! gcurve_fill.zig — Loop-Blinn-style filled quadratic-bezier triangles.
//!
//! Each instance is ONE TRIANGLE (3 vertices) whose corners are the three
//! control points of a quadratic bezier curve. The fragment shader does
//! a per-pixel interior test via interpolated barycentric coords:
//!
//!     vertex 0 → (u, v) = (0.0, 0.0)   start point
//!     vertex 1 → (u, v) = (0.5, 0.0)   control point
//!     vertex 2 → (u, v) = (1.0, 1.0)   end point
//!
//!     inside if  u*u - v < 0
//!
//! Smoothstep on `u*u - v` with `fwidth(...)` gives sub-pixel-perfect AA
//! — same anti-aliasing quality as text glyph atlases, but resolution-
//! independent (no texture, no atlas, no bake step). Curves stay crisp at
//! any zoom, any size, any animation.
//!
//! The technique is the original Loop-Blinn 2005 paper applied as an
//! *authoring* primitive (carts hand the engine triangle control points;
//! engine does no path tessellation). For closed shapes — circles, donut
//! wedges, area-chart rims — composing several of these triangles plus a
//! flat fill triangle (via polys.zig) produces mathematically perfect
//! curved boundaries with zero polygon faceting.
//!
//! Pipeline mirror of curves.zig but emits 3 triangle vertices per instance
//! instead of 6 quad vertices. Each instance pushes ~32 bytes; batched into
//! one draw call with N instances per frame.

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

/// Per-instance g-curve triangle — 28 bytes (was 40: f32x4 color). Control
/// points keep full f32; color rides unorm8x4, widened back to vec4f by the
/// vertex fetch, so gcurve_fill_wgsl is unchanged.
pub const GCurveFillInstance = extern struct {
    p0_x: f32,
    p0_y: f32,
    p1_x: f32,
    p1_y: f32,
    p2_x: f32,
    p2_y: f32,
    color: [4]u8,
};

comptime {
    if (@sizeOf(GCurveFillInstance) != 28 or @alignOf(GCurveFillInstance) != 4) {
        @compileError("GCurveFillInstance must match gcurve_fill_wgsl per-instance vertex layout (28 bytes)");
    }
}

// ════════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════════

pub const MAX_GCURVES = 1_048_576; // matches polys/capsules — chart-density workloads

var g_instances: [MAX_GCURVES]GCurveFillInstance = undefined;
var g_count: usize = 0;
var g_last_count: usize = 0;
var g_capacity_warning_emitted: bool = false;

var g_pipeline: ?*wgpu.RenderPipeline = null;
var g_buffer: ?*wgpu.Buffer = null;
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Queue a filled quadratic-bezier triangle. (p0, p1, p2) are the start,
/// control, and end points. The curve passes through p0 and p2; p1 is the
/// off-curve control. The fill is on the side of the curve where the
/// interior test `u*u - v` is negative — that's the side toward p1 in
/// the triangle. To fill the OTHER side, swap which side of the curve
/// you compose with a separate triangle (the speaker's "table of
/// primitives" includes both orientations).
pub fn drawGCurveFill(
    p0x: f32, p0y: f32,
    p1x: f32, p1y: f32,
    p2x: f32, p2y: f32,
    r: f32, g: f32, b: f32, a: f32,
) void {
    if (g_count >= MAX_GCURVES) {
        if (!g_capacity_warning_emitted) {
            log.print("[gpu.gcurve_fill] capacity reached: {d} instances; later draws this frame dropped\n", .{MAX_GCURVES});
            g_capacity_warning_emitted = true;
        }
        return;
    }
    if (core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;

    const transform = core.getTransform();
    const t0x = if (transform.active) (p0x - transform.ox) * transform.scale + transform.ox + transform.tx else p0x;
    const t0y = if (transform.active) (p0y - transform.oy) * transform.scale + transform.oy + transform.ty else p0y;
    const t1x = if (transform.active) (p1x - transform.ox) * transform.scale + transform.ox + transform.tx else p1x;
    const t1y = if (transform.active) (p1y - transform.oy) * transform.scale + transform.oy + transform.ty else p1y;
    const t2x = if (transform.active) (p2x - transform.ox) * transform.scale + transform.ox + transform.tx else p2x;
    const t2y = if (transform.active) (p2y - transform.oy) * transform.scale + transform.oy + transform.ty else p2y;

    g_instances[g_count] = .{
        .p0_x = t0x, .p0_y = t0y,
        .p1_x = t1x, .p1_y = t1y,
        .p2_x = t2x, .p2_y = t2y,
        .color = pack.rgba8(r, g, b, a),
    };
    g_count += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Pipeline init
// ════════════════════════════════════════════════════════════════════════

pub fn initPipeline(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "gcurve_fill_shader",
        .code = shaders.gcurve_fill_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("[gpu.gcurve_fill] shader module create failed\n", .{});
        return;
    };
    defer shader_module.release();

    const layout_entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = 8 },
        },
    };
    const bgl = device.createBindGroupLayout(&.{
        .entry_count = layout_entries.len,
        .entries = &layout_entries,
    }) orelse return;
    g_bind_group_layout = bgl;

    const bind_entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 8 },
    };
    g_bind_group = device.createBindGroup(&.{
        .layout = bgl,
        .entry_count = bind_entries.len,
        .entries = &bind_entries,
    });

    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bgl),
    }) orelse return;
    defer pipeline_layout.release();

    // Per-instance attributes — ordered to match GCurveFillInstance.
    const attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0,  .shader_location = 0 }, // p0
        .{ .format = .float32x2, .offset = 8,  .shader_location = 1 }, // p1
        .{ .format = .float32x2, .offset = 16, .shader_location = 2 }, // p2
        .{ .format = .unorm8x4, .offset = 24, .shader_location = 3 }, // color
    };
    const buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(GCurveFillInstance),
        .attribute_count = attrs.len,
        .attributes = &attrs,
    };

    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("gcurve_fill_instances"),
        .size = MAX_GCURVES * @sizeOf(GCurveFillInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

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
            .buffers = @ptrCast(&buffer_layout),
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    });
    if (g_pipeline == null) {
        log.print("[gpu.gcurve_fill] pipeline create failed\n", .{});
    }
}

// ════════════════════════════════════════════════════════════════════════
// Frame lifecycle
// ════════════════════════════════════════════════════════════════════════

pub fn upload(queue: *wgpu.Queue) void {
    if (g_count == 0) return;
    if (g_buffer) |buf| {
        bu.writeTypedBuffer(queue, buf, 0, GCurveFillInstance, g_instances[0..g_count]);
    }
}

pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, bu.bytesOfCount(GCurveFillInstance, g_count));
        }
        // 3 vertices per triangle, one triangle per instance.
        render_pass.draw(3, end - start, 0, start);
    }
}

pub fn count() usize {
    return g_count;
}

pub fn lastCount() usize {
    return g_last_count;
}

pub fn reset() void {
    g_last_count = g_count;
    g_count = 0;
}

pub fn deinit() void {
    if (g_bind_group) |bg| bg.release();
    if (g_bind_group_layout) |l| l.release();
    if (g_buffer) |b| b.release();
    if (g_pipeline) |p| p.release();
    g_bind_group = null;
    g_bind_group_layout = null;
    g_buffer = null;
    g_pipeline = null;
}
