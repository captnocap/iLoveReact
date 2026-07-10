//! SDF icon rendering pipeline — pre-baked atlas + instanced textured quads.
//!
//! Why this exists: <Graph.Path d="…"> is fast for one path, gross at scale.
//! Every paint re-parses the d-string, builds curve segments, and hands each
//! to drawStrokeCurves — fine for a single icon, but a toolbar with 50 icons
//! does 50× that work every frame. SDF flips the cost equation: rasterize the
//! icons ONCE at build time (scripts/bake-icons.js), upload the atlas to the
//! GPU once at startup, then each rendered icon is one textured quad. 50 icons
//! cost the same as 1 because they're one batched instanced draw.
//!
//! Pipeline mirror of framework/gpu/text.zig:
//!   - SdfIconInstance struct → wgsl `@location` attributes
//!   - g_icons[] CPU-side ring filled per frame via queueIcon()
//!   - Atlas texture (R8Unorm) uploaded once from icon_atlas.zig::ATLAS
//!   - drawBatch() at end of frame issues one instanced draw call
//!
//! Atlas format: each tile is the 2D unsigned distance field of an icon's
//! stroke geometry, encoded as bytes via:
//!   byte = clamp(255 * (1 - dist / SPREAD_HIRES), 0, 255)
//! so byte 255 = stroke center, byte 128 = the smoothstep edge, byte 0 = far.
//! See scripts/bake-icons.js for the bake. The shader thresholds via
//! smoothstep(0.5 - aa, 0.5 + aa, sample) with aa = fwidth(sample) * 0.7,
//! giving crisp edges at any rendering size — that's the SDF magic.

const std = @import("std");
const log = @import("../diag/log.zig");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const pack = @import("pack.zig");
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");
const atlas = @import("icon_atlas.zig");

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/// Per-instance icon quad — 32 bytes (was 56). Vertex-attribute layout must
/// match WGSL. Atlas UVs ride unorm16x4 ([0,1] by construction), color
/// unorm8x4, edge/smoothness float16x2 (both live near [0,1]); the vertex
/// fetch widens them back so sdf_icon_wgsl is unchanged.
pub const SdfIconInstance = extern struct {
    pos_x: f32,
    pos_y: f32,
    size_w: f32,
    size_h: f32,
    uv: [4]u16,
    color: [4]u8,
    // smoothstep midpoint (0.5 = the natural threshold) + extra AA in
    // atlas-UV units (0 = use fwidth() only)
    edge_smooth: [2]f16 = .{ 0.5, 0.0 },
};

comptime {
    if (@sizeOf(SdfIconInstance) != 32 or @alignOf(SdfIconInstance) != 4) {
        @compileError("SdfIconInstance must match sdf_icon_wgsl per-instance vertex layout (32 bytes)");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Constants & state
// ════════════════════════════════════════════════════════════════════════

pub const MAX_ICONS = 8192; // 8K icons per frame is generous for any UI.

var g_icons: [MAX_ICONS]SdfIconInstance = undefined;
var g_icon_count: usize = 0;
var g_last_icon_count: usize = 0;

var g_pipeline: ?*wgpu.RenderPipeline = null;
var g_buffer: ?*wgpu.Buffer = null;
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;
var g_atlas_texture: ?*wgpu.Texture = null;
var g_atlas_view: ?*wgpu.TextureView = null;
var g_atlas_sampler: ?*wgpu.Sampler = null;

var g_initialized: bool = false;

// ════════════════════════════════════════════════════════════════════════
// Public lookup — name → atlas UV in [0..1]
// ════════════════════════════════════════════════════════════════════════

pub const IconUv = struct {
    u: f32,
    v: f32,
    w: f32,
    h: f32,
};

/// Look up an icon by exact name (case-sensitive PascalCase, e.g. "Heart").
/// Returns the UV rect in atlas-relative [0..1] coordinates, or null if absent.
/// Carts and runtime/icons/Icon.tsx use this to decide whether to route through
/// the SDF pipeline or fall back to <Graph.Path>.
pub fn lookup(name: []const u8) ?IconUv {
    for (atlas.ICONS) |it| {
        if (std.mem.eql(u8, it.name, name)) {
            const aw: f32 = @floatFromInt(atlas.ATLAS_W);
            const ah: f32 = @floatFromInt(atlas.ATLAS_H);
            return .{
                .u = @as(f32, @floatFromInt(it.u)) / aw,
                .v = @as(f32, @floatFromInt(it.v)) / ah,
                .w = @as(f32, @floatFromInt(it.w)) / aw,
                .h = @as(f32, @floatFromInt(it.h)) / ah,
            };
        }
    }
    return null;
}

pub fn iconCount() usize {
    return atlas.ICONS.len;
}

// ════════════════════════════════════════════════════════════════════════
// Init — upload atlas, create pipeline
// ════════════════════════════════════════════════════════════════════════

pub fn init() void {
    if (g_initialized) return;
    const device = core.getDevice() orelse return;

    // Atlas texture (single-channel R8Unorm — half the memory of RGBA8 and the
    // shader only needs the .r channel anyway).
    g_atlas_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("sdf_icon_atlas"),
        .size = .{
            .width = atlas.ATLAS_W,
            .height = atlas.ATLAS_H,
            .depth_or_array_layers = 1,
        },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .r8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    });
    if (g_atlas_texture == null) {
        log.print("[sdf_icons] failed to create atlas texture\n", .{});
        return;
    }
    g_atlas_view = g_atlas_texture.?.createView(null);

    g_atlas_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    });

    // Upload atlas bytes (one-shot — atlas is immutable, baked into the binary).
    const queue = core.getQueue() orelse {
        log.print("[sdf_icons] no queue at init — atlas upload deferred\n", .{});
        return;
    };
    const dest = wgpu.TexelCopyTextureInfo{
        .texture = g_atlas_texture.?,
        .mip_level = 0,
        .origin = .{ .x = 0, .y = 0, .z = 0 },
        .aspect = .all,
    };
    const layout = wgpu.TexelCopyBufferLayout{
        .offset = 0,
        .bytes_per_row = atlas.ATLAS_W,
        .rows_per_image = atlas.ATLAS_H,
    };
    const extent = wgpu.Extent3D{
        .width = atlas.ATLAS_W,
        .height = atlas.ATLAS_H,
        .depth_or_array_layers = 1,
    };
    queue.writeTexture(&dest, &atlas.ATLAS, atlas.ATLAS.len, &layout, &extent);

    // Instance buffer (vertex stream, GPU-writable via copy_dst for per-frame uploads).
    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("sdf_icon_instances"),
        .size = MAX_ICONS * @sizeOf(SdfIconInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    initPipeline(device);
    g_initialized = true;
    log.print("[sdf_icons] initialized — atlas {d}×{d}, {d} icons\n", .{
        atlas.ATLAS_W, atlas.ATLAS_H, atlas.ICONS.len,
    });
}

fn initPipeline(device: *wgpu.Device) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "sdf_icon_shader",
        .code = shaders.sdf_icon_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("[sdf_icons] failed to create shader module\n", .{});
        return;
    };
    defer shader_module.release();

    const atlas_view = g_atlas_view orelse return;
    const atlas_sampler = g_atlas_sampler orelse return;

    const layout_entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = 8 },
        },
        .{
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{
                .sample_type = .float,
                .view_dimension = .@"2d",
                .multisampled = 0,
            },
        },
        .{
            .binding = 2,
            .visibility = wgpu.ShaderStages.fragment,
            .sampler = .{ .type = .filtering },
        },
    };
    const bind_layout = device.createBindGroupLayout(&.{
        .entry_count = layout_entries.len,
        .entries = &layout_entries,
    }) orelse return;
    g_bind_group_layout = bind_layout;

    const globals_buffer = core.getGlobalsBuffer() orelse return;
    const bind_entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 8 },
        .{ .binding = 1, .texture_view = atlas_view },
        .{ .binding = 2, .sampler = atlas_sampler },
    };
    g_bind_group = device.createBindGroup(&.{
        .layout = bind_layout,
        .entry_count = bind_entries.len,
        .entries = &bind_entries,
    });

    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bind_layout),
    }) orelse return;
    defer pipeline_layout.release();

    // Attribute layout must match the SdfIconInstance field order/offsets exactly.
    const attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0,  .shader_location = 0 }, // pos
        .{ .format = .float32x2, .offset = 8,  .shader_location = 1 }, // size
        .{ .format = .unorm16x2, .offset = 16, .shader_location = 2 }, // uv_pos
        .{ .format = .unorm16x2, .offset = 20, .shader_location = 3 }, // uv_size
        .{ .format = .unorm8x4, .offset = 24, .shader_location = 4 }, // color
        .{ .format = .float16x2, .offset = 28, .shader_location = 5 }, // edge + smoothness
    };
    const buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(SdfIconInstance),
        .attribute_count = attrs.len,
        .attributes = &attrs,
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
            .buffers = @ptrCast(&buffer_layout),
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    });
    if (g_pipeline == null) {
        log.print("[sdf_icons] failed to create render pipeline\n", .{});
    }
}

// ════════════════════════════════════════════════════════════════════════
// Per-frame queue
// ════════════════════════════════════════════════════════════════════════

/// Queue one icon for drawing this frame. (x, y, w, h) is the destination
/// rectangle in screen pixels. UV rect is what `lookup()` returns — already in
/// [0..1] atlas space. Color is straight RGBA (NOT pre-multiplied; the shader
/// handles that). Honors any active GPU transform (canvas pan/zoom) the same
/// way text/curves do, so icons inside <Canvas> nodes track the camera.
pub fn queueIcon(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    uv: IconUv,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) void {
    if (!g_initialized) return;
    if (g_icon_count >= MAX_ICONS) return;
    if (core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;

    const transform = core.getTransform();
    const px = if (transform.active) (x - transform.ox) * transform.scale + transform.ox + transform.tx else x;
    const py = if (transform.active) (y - transform.oy) * transform.scale + transform.oy + transform.ty else y;
    const pw = if (transform.active) w * transform.scale else w;
    const ph = if (transform.active) h * transform.scale else h;

    g_icons[g_icon_count] = .{
        .pos_x = px,
        .pos_y = py,
        .size_w = pw,
        .size_h = ph,
        .uv = .{ pack.unorm16(uv.u), pack.unorm16(uv.v), pack.unorm16(uv.w), pack.unorm16(uv.h) },
        .color = pack.rgba8(r, g, b, a),
    };
    g_icon_count += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Frame lifecycle (called from gpu.zig render loop)
// ════════════════════════════════════════════════════════════════════════

pub fn upload(queue: *wgpu.Queue) void {
    if (g_icon_count == 0) return;
    if (g_buffer) |buf| {
        bu.writeTypedBuffer(queue, buf, 0, SdfIconInstance, g_icons[0..g_icon_count]);
    }
}

pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, bu.bytesOfCount(SdfIconInstance, g_icon_count));
        }
        render_pass.draw(6, end - start, 0, start);
    }
}

pub fn count() usize {
    return g_icon_count;
}

pub fn lastCount() usize {
    return g_last_icon_count;
}

pub fn reset() void {
    g_last_icon_count = g_icon_count;
    g_icon_count = 0;
}

/// Rebind after a memory drain. drainMemory() in gpu.zig releases and recreates
/// the shared globals buffer (screen_size), so every pipeline's bind group — which
/// captured the OLD buffer — must be rebuilt against the new one. Without this the
/// icon bind group keeps pointing at the freed buffer: it reads the screen size it
/// held at drain time, so icons look fine until the window is resized, then divide
/// by a stale size and fly off. Mirrors text.drain / rects.drain; reuses the
/// existing layout + atlas view/sampler, only the instance buffer + bind group are
/// recreated.
pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    if (g_bind_group) |bg| bg.release();
    if (g_buffer) |b| b.release();

    g_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("sdf_icon_instances"),
        .size = MAX_ICONS * @sizeOf(SdfIconInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    if (g_bind_group_layout) |layout| {
        const bind_entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 8 },
            .{ .binding = 1, .texture_view = g_atlas_view },
            .{ .binding = 2, .sampler = g_atlas_sampler },
        };
        g_bind_group = device.createBindGroup(&.{
            .layout = layout,
            .entry_count = bind_entries.len,
            .entries = &bind_entries,
        });
    }
}

pub fn deinit() void {
    if (g_bind_group) |bg| bg.release();
    if (g_bind_group_layout) |l| l.release();
    if (g_buffer) |b| b.release();
    if (g_pipeline) |p| p.release();
    if (g_atlas_sampler) |s| s.release();
    if (g_atlas_view) |v| v.release();
    if (g_atlas_texture) |t| t.destroy();
    g_bind_group = null;
    g_bind_group_layout = null;
    g_buffer = null;
    g_pipeline = null;
    g_atlas_sampler = null;
    g_atlas_view = null;
    g_atlas_texture = null;
    g_initialized = false;
}
