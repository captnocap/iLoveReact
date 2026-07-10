//! Polygon fill pipeline — instanced colored triangles.
//!
//! Filled paths are decomposed into triangles (fan from vertex 0) on the CPU.
//! Each triangle is one instance with 3 vertices + RGBA color.
//! The vertex shader converts pixel coords to NDC; the fragment shader outputs flat color.
//! Canvas transform is applied on the CPU side (same as rects/curves).

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

/// Per-instance triangle data — 3 vertices with per-vertex colors. 36 bytes
/// (was 80: f32x4 per color + 8 bytes of padding). Positions keep full f32;
/// each color rides unorm8x4 and the vertex fetch widens it back to vec4f,
/// so poly_wgsl is unchanged.
pub const TriInstance = extern struct {
    x0: f32,
    y0: f32,
    c0: [4]u8,
    x1: f32,
    y1: f32,
    c1: [4]u8,
    x2: f32,
    y2: f32,
    c2: [4]u8,
};

comptime {
    if (@sizeOf(TriInstance) != 36 or @alignOf(TriInstance) != 4) {
        @compileError("TriInstance must match poly_wgsl per-instance vertex layout (36 bytes)");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Constants & State
// ════════════════════════════════════════════════════════════════════════

// Bumped 8K → 1M for dense filled-polygon workloads (chart_bench's
// Graph.Polygon at 100 charts × 5000-point area-fills = ~500K triangles
// per frame). 1M × 36 bytes = ~36 MB static. Fine on modern GPUs; matches
// the capsules cap (1M) so polyline + polygon pipelines have parity.
pub const MAX_TRIS = 1_048_576;

var g_tris: [MAX_TRIS]TriInstance = undefined;
var g_tri_count: usize = 0;
var g_last_tri_count: usize = 0;

var g_pipeline: ?*wgpu.RenderPipeline = null;
var g_buffer: ?*wgpu.Buffer = null;
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

fn applyTransform(px: f32, py: f32) [2]f32 {
    const t = core.getTransform();
    if (t.active) {
        return .{ (px - t.ox) * t.scale + t.ox + t.tx, (py - t.oy) * t.scale + t.oy + t.ty };
    }
    return .{ px, py };
}

/// Queue a flat-colored triangle for drawing this frame.
pub fn drawTri(
    ax: f32,
    ay: f32,
    bx: f32,
    by: f32,
    cx: f32,
    cy: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) void {
    drawTriColored(ax, ay, r, g, b, a, bx, by, r, g, b, a, cx, cy, r, g, b, a);
}

/// Queue a triangle with per-vertex colors (for effect texture sampling).
pub fn drawTriColored(
    ax: f32,
    ay: f32,
    r0: f32,
    g0: f32,
    b0: f32,
    a0: f32,
    bx: f32,
    by: f32,
    r1: f32,
    g1: f32,
    b1: f32,
    a1: f32,
    cx: f32,
    cy: f32,
    r2: f32,
    g2: f32,
    b2: f32,
    a2: f32,
) void {
    if (g_tri_count >= MAX_TRIS or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;
    const ta = applyTransform(ax, ay);
    const tb = applyTransform(bx, by);
    const tc = applyTransform(cx, cy);

    g_tris[g_tri_count] = .{
        .x0 = ta[0],
        .y0 = ta[1],
        .c0 = pack.rgba8(r0, g0, b0, a0),
        .x1 = tb[0],
        .y1 = tb[1],
        .c1 = pack.rgba8(r1, g1, b1, a1),
        .x2 = tc[0],
        .y2 = tc[1],
        .c2 = pack.rgba8(r2, g2, b2, a2),
    };
    g_tri_count += 1;
}

/// Initialize the triangle fill pipeline.
pub fn initPipeline(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "poly_shader",
        .code = shaders.poly_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("Failed to create poly shader module\n", .{});
        return;
    };
    defer shader_module.release();

    // Triangle instance buffer
    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("poly_instances"),
        .size = MAX_TRIS * @sizeOf(TriInstance),
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

    // Instance vertex attributes: 3 vertices × (pos2 f32 + color unorm8x4)
    // over the 36-byte row (see TriInstance).
    const instance_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0, .shader_location = 0 }, // v0 pos
        .{ .format = .unorm8x4, .offset = 8, .shader_location = 1 }, // v0 color
        .{ .format = .float32x2, .offset = 12, .shader_location = 2 }, // v1 pos
        .{ .format = .unorm8x4, .offset = 20, .shader_location = 3 }, // v1 color
        .{ .format = .float32x2, .offset = 24, .shader_location = 4 }, // v2 pos
        .{ .format = .unorm8x4, .offset = 32, .shader_location = 5 }, // v2 color
    };

    const instance_buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(TriInstance),
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

    g_pipeline = device.createRenderPipeline(&.{
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

    if (g_pipeline == null) {
        log.print("Failed to create poly render pipeline\n", .{});
    }
}

/// Draw a batch of triangles in the given instance range.
pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, bu.bytesOfCount(TriInstance, g_tri_count));
        }
        render_pass.draw(3, end - start, 0, start);
    }
}

/// Upload triangle instance data to the GPU.
pub fn upload(queue: *wgpu.Queue) void {
    if (g_tri_count > 0) {
        if (g_buffer) |buf| {
            bu.writeTypedBuffer(queue, buf, 0, TriInstance, g_tris[0..g_tri_count]);
        }
    }
}

/// Recreate buffer + bind group to reclaim fragmented GPU memory.
pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    if (g_bind_group) |bg| bg.release();
    if (g_buffer) |b| b.release();

    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("poly_instances"),
        .size = MAX_TRIS * @sizeOf(TriInstance),
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
    if (g_buffer) |b| b.release();
    if (g_pipeline) |p| p.release();
    g_bind_group = null;
    g_bind_group_layout = null;
    g_buffer = null;
    g_pipeline = null;
}

/// Current number of queued triangles.
pub fn count() usize {
    return g_tri_count;
}

/// Last frame's triangle count (captured before reset).
pub fn lastCount() usize {
    return g_last_tri_count;
}

/// Reset for next frame.
pub fn reset() void {
    g_last_tri_count = g_tri_count;
    g_tri_count = 0;
}

/// Hash the current triangle instance data for dirty checking.
pub fn hashData() u64 {
    var h: u64 = @as(u64, g_tri_count) *% 0xbb67ae8584caa73b;
    if (g_tri_count > 0) {
        const len = g_tri_count * @sizeOf(TriInstance);
        const bytes: [*]const u8 = @ptrCast(&g_tris);
        var i: usize = 0;
        while (i + 8 <= len) : (i += 8) {
            h ^= std.mem.readInt(u64, bytes[i..][0..8], .little);
            h = h *% 0x2127599bf4325c37 +% 0x880355f21e6d1965;
        }
    }
    return h;
}
