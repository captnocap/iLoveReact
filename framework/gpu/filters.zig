//! filters.zig — Post-process filter pipelines + composite queue.
//!
//! The OFFSCREEN render targets (texture + view + sampler) live in gpu.zig as
//! StaticSurfaceEntry — same pool, same primitive-replay machinery — but with
//! `is_filter = true` so the entry is never marked `ready` and re-renders
//! every frame. That's how animated children survive being filtered.
//!
//! What this module owns:
//!   * the Filter enum + name → WGSL lookup (filter_shaders.zig)
//!   * one render pipeline per filter, lazily compiled
//!   * a per-frame queue of "filter composite" draws — each one points at a
//!     bind_group whose texture is a captured StaticSurface entry's view
//!   * drawComposites(render_pass) — runs at the end of the main render pass
//!
//! Bind group layout (one per filter; all share):
//!   binding 0: globals uniform (vertex)        — screen_size
//!   binding 1: input texture (fragment)
//!   binding 2: sampler (fragment)
//!   binding 3: filter uniforms (vertex+frag)   — bounds, time, intensity

const std = @import("std");
const wgpu = @import("wgpu");

const filter_shaders = @import("filter_shaders.zig");
const log = @import("../diag/log.zig");

// ─── Filter taxonomy ────────────────────────────────────────────
pub const Filter = enum(u8) {
    deepfry,
    crt,
    chromatic,
    posterize,
    vhs,
    scanlines,
    invert,
    grayscale,
    pixelate,
    dither,
    bytecode,

    pub fn wgsl(self: Filter) []const u8 {
        return switch (self) {
            .deepfry => filter_shaders.deepfry_wgsl,
            .crt => filter_shaders.crt_wgsl,
            .chromatic => filter_shaders.chromatic_wgsl,
            .posterize => filter_shaders.posterize_wgsl,
            .vhs => filter_shaders.vhs_wgsl,
            .scanlines => filter_shaders.scanlines_wgsl,
            .invert => filter_shaders.invert_wgsl,
            .grayscale => filter_shaders.grayscale_wgsl,
            .pixelate => filter_shaders.pixelate_wgsl,
            .dither => filter_shaders.dither_wgsl,
            .bytecode => filter_shaders.bytecode_wgsl,
        };
    }

    pub fn label(self: Filter) []const u8 {
        return @tagName(self);
    }
};

pub fn resolveFilter(name: []const u8) ?Filter {
    inline for (@typeInfo(Filter).@"enum".fields) |f| {
        if (std.mem.eql(u8, name, f.name)) return @as(Filter, @enumFromInt(f.value));
    }
    return null;
}

// ─── Pipelines ──────────────────────────────────────────────────
const FILTER_COUNT = @typeInfo(Filter).@"enum".fields.len;

var g_pipelines: [FILTER_COUNT]?*wgpu.RenderPipeline = .{null} ** FILTER_COUNT;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;
var g_pipeline_layout: ?*wgpu.PipelineLayout = null;
var g_initialized: bool = false;

// ─── FilterUniforms (matches WGSL filter_u struct in filter_shaders.zig) ─
// Layout: bounds_pos(vec2f) + bounds_size(vec2f) + time(f32) + intensity(f32) + 2 pad floats
//        = 8 floats = 32 bytes.
pub const FilterUniforms = extern struct {
    bounds_x: f32,
    bounds_y: f32,
    bounds_w: f32,
    bounds_h: f32,
    time: f32,
    intensity: f32,
    _pad0: f32 = 0,
    _pad1: f32 = 0,
};

// ─── Composite queue ────────────────────────────────────────────
// Each entry is a single textured-quad draw using a specific filter
// pipeline. gpu.zig calls queueComposite() right after the offscreen pass
// that fills the source texture; drawComposites() runs during the main
// render pass.
const MAX_COMPOSITES = 256;

const Composite = struct {
    filter: Filter,
    bind_group: *wgpu.BindGroup,
    uniform_buf: *wgpu.Buffer,
    bounds: FilterUniforms,
};

var g_composites: [MAX_COMPOSITES]Composite = undefined;
var g_composite_count: usize = 0;

// ─── Public API ─────────────────────────────────────────────────

/// Initialize the bind group layout and one pipeline per filter.
/// Call once after the device is created.
pub fn ensureInit(device: *wgpu.Device, format: wgpu.TextureFormat) void {
    if (g_initialized) return;
    g_initialized = true;

    // Bind group layout
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
        .{
            .binding = 3,
            .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = @sizeOf(FilterUniforms) },
        },
    };

    const bgl = device.createBindGroupLayout(&.{
        .entry_count = layout_entries.len,
        .entries = &layout_entries,
    }) orelse {
        log.print("[filters] failed to create bind group layout\n", .{});
        return;
    };
    g_bind_group_layout = bgl;

    g_pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bgl),
    });
    if (g_pipeline_layout == null) {
        log.print("[filters] failed to create pipeline layout\n", .{});
        return;
    }

    // Compile each filter into its own pipeline.
    inline for (@typeInfo(Filter).@"enum".fields) |f| {
        const filter: Filter = @as(Filter, @enumFromInt(f.value));
        compileFilterPipeline(device, format, filter) catch |err| {
            log.print("[filters] {s} pipeline failed: {}\n", .{ filter.label(), err });
        };
    }
}

fn compileFilterPipeline(device: *wgpu.Device, format: wgpu.TextureFormat, filter: Filter) !void {
    const idx = @intFromEnum(filter);
    if (g_pipelines[idx] != null) return;

    const layout = g_pipeline_layout orelse return error.NoLayout;

    const code = filter.wgsl();
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "filter_shader",
        .code = code,
    });
    const module = device.createShaderModule(&shader_desc) orelse return error.ShaderModule;
    defer module.release();

    const blend_state = wgpu.BlendState.premultiplied_alpha_blending;
    const color_target = wgpu.ColorTargetState{
        .format = format,
        .blend = &blend_state,
        .write_mask = wgpu.ColorWriteMasks.all,
    };
    const fragment_state = wgpu.FragmentState{
        .module = module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };

    const empty_buffers: [0]wgpu.VertexBufferLayout = .{};
    g_pipelines[idx] = device.createRenderPipeline(&.{
        .layout = layout,
        .vertex = .{
            .module = module,
            .entry_point = wgpu.StringView.fromSlice("vs_main"),
            .buffer_count = 0,
            .buffers = &empty_buffers,
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    });
    if (g_pipelines[idx] == null) return error.PipelineCreate;
}

/// Per-entry resource creation. Caller (gpu.zig) creates the shared
/// texture/view/sampler; this returns a uniform buffer + bind group sized
/// for one filter composite. The caller must release them when the entry
/// is freed.
pub fn createEntryResources(
    device: *wgpu.Device,
    globals_buffer: *wgpu.Buffer,
    texture_view: *wgpu.TextureView,
    sampler: *wgpu.Sampler,
) ?struct { uniform_buf: *wgpu.Buffer, bind_group: *wgpu.BindGroup } {
    const bgl = g_bind_group_layout orelse return null;

    const uniform_buf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("filter_uniforms"),
        .size = @sizeOf(FilterUniforms),
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    }) orelse return null;

    const entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 16 },
        .{ .binding = 1, .texture_view = texture_view },
        .{ .binding = 2, .sampler = sampler },
        .{ .binding = 3, .buffer = uniform_buf, .offset = 0, .size = @sizeOf(FilterUniforms) },
    };

    const bind_group = device.createBindGroup(&.{
        .layout = bgl,
        .entry_count = entries.len,
        .entries = &entries,
    }) orelse {
        uniform_buf.release();
        return null;
    };

    return .{ .uniform_buf = uniform_buf, .bind_group = bind_group };
}

pub fn frameReset() void {
    g_composite_count = 0;
}

/// Queue a filter composite for the main render pass. The bind_group must
/// have been created via createEntryResources(), and the uniform_buf is
/// owned by the same entry — we'll write FilterUniforms into it before draw.
pub fn queueComposite(
    queue: *wgpu.Queue,
    filter: Filter,
    bind_group: *wgpu.BindGroup,
    uniform_buf: *wgpu.Buffer,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    time: f32,
    intensity: f32,
) void {
    if (g_composite_count >= MAX_COMPOSITES) {
        log.warn(.gpu, "filters: composite queue full", .{});
        return;
    }
    const u = FilterUniforms{
        .bounds_x = x,
        .bounds_y = y,
        .bounds_w = w,
        .bounds_h = h,
        .time = time,
        .intensity = std.math.clamp(intensity, 0.0, 1.0),
    };
    queue.writeBuffer(uniform_buf, 0, @ptrCast(&u), @sizeOf(FilterUniforms));

    g_composites[g_composite_count] = .{
        .filter = filter,
        .bind_group = bind_group,
        .uniform_buf = uniform_buf,
        .bounds = u,
    };
    g_composite_count += 1;
}

/// Draw ONE filter composite immediately into the given render pass, at
/// `bounds` in that pass's coordinate space (globals.screen_size must already
/// be the target's dims). Used to fold a <Filter> nested inside a
/// <StaticSurface> into the parent's offscreen texture, instead of leaking it
/// onto the main framebuffer. `bind_group` samples the filter's captured
/// (raw) input texture.
pub fn drawInline(
    render_pass: *wgpu.RenderPassEncoder,
    queue: *wgpu.Queue,
    filter: Filter,
    bind_group: *wgpu.BindGroup,
    uniform_buf: *wgpu.Buffer,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    time: f32,
    intensity: f32,
) void {
    const pipeline = g_pipelines[@intFromEnum(filter)] orelse return;
    const u = FilterUniforms{
        .bounds_x = x,
        .bounds_y = y,
        .bounds_w = w,
        .bounds_h = h,
        .time = time,
        .intensity = std.math.clamp(intensity, 0.0, 1.0),
    };
    queue.writeBuffer(uniform_buf, 0, @ptrCast(&u), @sizeOf(FilterUniforms));
    render_pass.setPipeline(pipeline);
    render_pass.setBindGroup(0, bind_group, 0, null);
    render_pass.draw(6, 1, 0, 0);
}

/// Run all queued filter composites against the main framebuffer.
/// Call from inside the main render pass, after primitive draws.
pub fn drawComposites(render_pass: *wgpu.RenderPassEncoder) void {
    if (g_composite_count == 0) return;
    for (g_composites[0..g_composite_count]) |c| {
        const pipeline = g_pipelines[@intFromEnum(c.filter)] orelse continue;
        render_pass.setPipeline(pipeline);
        render_pass.setBindGroup(0, c.bind_group, 0, null);
        render_pass.draw(6, 1, 0, 0);
    }
}

pub fn deinit() void {
    g_composite_count = 0;
    for (&g_pipelines) |*p| {
        if (p.*) |pl| pl.release();
        p.* = null;
    }
    if (g_pipeline_layout) |pl| {
        pl.release();
        g_pipeline_layout = null;
    }
    if (g_bind_group_layout) |bgl| {
        bgl.release();
        g_bind_group_layout = null;
    }
    g_initialized = false;
}
