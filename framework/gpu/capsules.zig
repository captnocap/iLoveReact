//! Capsule rendering pipeline — SDF line segments with round caps.
//!
//! Each capsule = one line segment (p0, p1) with a stroke width. Fragment
//! shader computes distance to the segment and smoothsteps at width/2. The
//! round caps emerge from the segment-distance function clamping its
//! parameter to [0,1] — fragments past an endpoint measure distance to the
//! endpoint itself, which the smoothstep turns into a semicircular cap.
//!
//! This is the primitive svg_path.drawLineSegment calls. Two adjacent
//! capsules sharing an endpoint union into a round-joined polyline for free:
//! each capsule's semicircle at the shared endpoint stacks onto the other's,
//! giving a full disc that covers the outside wedge of any turn angle.
//!
//! Structure mirrors framework/gpu/curves.zig — same per-instance layout
//! pattern, same init/reset/upload/drawBatch API so gpu.zig integrates it
//! the same way as every other primitive.

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

/// Per-instance capsule data — 24 bytes (was 48: f32x4 color + 12 bytes of
/// literal padding). Endpoints and stroke keep full f32 (pixel precision);
/// color rides unorm8x4, decoded back to vec4f by the vertex fetch.
pub const CapsuleInstance = extern struct {
    p0_x: f32,
    p0_y: f32,
    p1_x: f32,
    p1_y: f32,
    color: [4]u8,
    stroke_width: f32,
};

comptime {
    if (@sizeOf(CapsuleInstance) != 24 or @alignOf(CapsuleInstance) != 4) {
        @compileError("CapsuleInstance must match capsule_wgsl per-instance vertex layout (24 bytes)");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Constants & State
// ════════════════════════════════════════════════════════════════════════

// Bumped 32K → 1M to support data-dense polyline workloads (chart_bench at
// 100 charts × 5000 points = ~500K capsules/frame). 1M × 24 bytes = ~24 MB
// static state — fine on any modern desktop, and the GPU buffer of the same
// size is well below typical VRAM headroom. Without this, polyline charts
// silently truncate past ~6.5 fully-rendered cells in dense bench scenarios.
pub const MAX_CAPSULES = 1_048_576;

var g_capsules: [MAX_CAPSULES]CapsuleInstance = undefined;
var g_capsule_count: usize = 0;
var g_last_capsule_count: usize = 0;
var g_capacity_warning_emitted: bool = false;

var g_capsule_pipeline: ?*wgpu.RenderPipeline = null;
var g_capsule_buffer: ?*wgpu.Buffer = null;
var g_capsule_bind_group: ?*wgpu.BindGroup = null;
var g_capsule_bind_group_layout: ?*wgpu.BindGroupLayout = null;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Queue a capsule (SDF line segment with round caps) for drawing this frame.
pub fn drawCapsule(
    p0x: f32,
    p0y: f32,
    p1x: f32,
    p1y: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    stroke_width: f32,
) void {
    if (g_capsule_count >= MAX_CAPSULES) {
        if (!g_capacity_warning_emitted) {
            log.print("[gpu.capsules] capacity reached: {d} capsules; dropping later draws this frame\n", .{MAX_CAPSULES});
            g_capacity_warning_emitted = true;
        }
        return;
    }
    if (core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;

    // Apply canvas transform if active (matches curves/rects behavior).
    const transform = core.getTransform();
    const t0x = if (transform.active) (p0x - transform.ox) * transform.scale + transform.ox + transform.tx else p0x;
    const t0y = if (transform.active) (p0y - transform.oy) * transform.scale + transform.oy + transform.ty else p0y;
    const t1x = if (transform.active) (p1x - transform.ox) * transform.scale + transform.ox + transform.tx else p1x;
    const t1y = if (transform.active) (p1y - transform.oy) * transform.scale + transform.oy + transform.ty else p1y;
    const tw = if (transform.active) stroke_width * transform.scale else stroke_width;

    g_capsules[g_capsule_count] = .{
        .p0_x = t0x,
        .p0_y = t0y,
        .p1_x = t1x,
        .p1_y = t1y,
        .color = pack.rgba8(r, g, b, a),
        .stroke_width = tw,
    };
    g_capsule_count += 1;
}

pub fn initPipeline(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "capsule_shader",
        .code = shaders.capsule_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("Failed to create capsule shader module\n", .{});
        return;
    };
    defer shader_module.release();

    g_capsule_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("capsule_instances"),
        .size = MAX_CAPSULES * @sizeOf(CapsuleInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

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
    g_capsule_bind_group_layout = bind_group_layout;

    g_capsule_bind_group = device.createBindGroup(&.{
        .layout = bind_group_layout,
        .entry_count = 1,
        .entries = @ptrCast(&wgpu.BindGroupEntry{
            .binding = 0,
            .buffer = globals_buffer,
            .offset = 0,
            .size = 16,
        }),
    });

    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bind_group_layout),
    }) orelse return;
    defer pipeline_layout.release();

    // 4 attribute slots over the 24-byte row (see CapsuleInstance).
    const instance_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0, .shader_location = 0 }, // p0
        .{ .format = .float32x2, .offset = 8, .shader_location = 1 }, // p1
        .{ .format = .unorm8x4, .offset = 16, .shader_location = 2 }, // color
        .{ .format = .float32, .offset = 20, .shader_location = 3 }, // stroke_width
    };

    const instance_buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(CapsuleInstance),
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

    g_capsule_pipeline = device.createRenderPipeline(&.{
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

    if (g_capsule_pipeline == null) {
        log.print("Failed to create capsule render pipeline\n", .{});
    }
}

pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_capsule_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_capsule_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_capsule_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, bu.bytesOfCount(CapsuleInstance, g_capsule_count));
        }
        render_pass.draw(6, end - start, 0, start);
    }
}

pub fn upload(queue: *wgpu.Queue) void {
    if (g_capsule_count > 0) {
        if (g_capsule_buffer) |buf| {
            bu.writeTypedBuffer(queue, buf, 0, CapsuleInstance, g_capsules[0..g_capsule_count]);
        }
    }
}

pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    if (g_capsule_bind_group) |bg| bg.release();
    if (g_capsule_buffer) |b| b.release();

    g_capsule_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("capsule_instances"),
        .size = MAX_CAPSULES * @sizeOf(CapsuleInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    if (g_capsule_bind_group_layout) |layout| {
        g_capsule_bind_group = device.createBindGroup(&.{
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

pub fn deinit() void {
    if (g_capsule_bind_group) |bg| bg.release();
    if (g_capsule_bind_group_layout) |l| l.release();
    if (g_capsule_buffer) |b| b.release();
    if (g_capsule_pipeline) |p| p.release();
    g_capsule_bind_group = null;
    g_capsule_bind_group_layout = null;
    g_capsule_buffer = null;
    g_capsule_pipeline = null;
}

pub fn count() usize {
    return g_capsule_count;
}

pub fn lastCount() usize {
    return g_last_capsule_count;
}

pub fn reset() void {
    g_last_capsule_count = g_capsule_count;
    g_capsule_count = 0;
    g_capacity_warning_emitted = false;
}

pub fn hashData() u64 {
    var h: u64 = @as(u64, g_capsule_count) *% 0x6a09e667f3bcc908;
    if (g_capsule_count > 0) {
        const len = g_capsule_count * @sizeOf(CapsuleInstance);
        const bytes: [*]const u8 = @ptrCast(&g_capsules);
        var i: usize = 0;
        while (i + 8 <= len) : (i += 8) {
            h ^= std.mem.readInt(u64, bytes[i..][0..8], .little);
            h = h *% 0x2127599bf4325c37 +% 0x880355f21e6d1965;
        }
    }
    return h;
}
