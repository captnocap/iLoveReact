//! 3d.zig — 3D rendering pipeline for wgpu
//!
//! Renders 3D.Mesh children to an offscreen texture with depth buffer,
//! composited into the 2D layout tree via images.queueQuad().
//! Reads camera/light/mesh props from the 3D.View node's children.

const std = @import("std");
const wgpu = @import("wgpu");
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");
const images = @import("images.zig");
const math = @import("../math/root.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;

// ════════════════════════════════════════════════════════════════════════
// Vertex format: position(3) + normal(3) + uv(2) = 32 bytes
// ════════════════════════════════════════════════════════════════════════

const Vertex = extern struct {
    px: f32,
    py: f32,
    pz: f32,
    nx: f32,
    ny: f32,
    nz: f32,
    u: f32,
    v: f32,
};

// ════════════════════════════════════════════════════════════════════════
// Uniform buffer — matches SceneUniforms in WGSL
// ════════════════════════════════════════════════════════════════════════

const SceneUniforms = extern struct {
    mvp: [16]f32,
    model: [16]f32,
    light_dir: [3]f32,
    specular_power: f32,
    light_color: [3]f32,
    _pad1: f32 = 0,
    ambient_color: [3]f32,
    _pad2: f32 = 0,
    camera_pos: [3]f32,
    _pad3: f32 = 0,
    color: [4]f32,
    fog_color: [3]f32,
    fog_near: f32,
    fog_far: f32,
    _pad4: @Vector(4, f32) = .{ 0, 0, 0, 0 },
};

comptime {
    if (@sizeOf(SceneUniforms) != 256 or @alignOf(SceneUniforms) != 16) {
        @compileError("SceneUniforms must match scene3d_wgsl uniform layout");
    }
}

// Skybox uniforms — must match SkyUniforms in shaders.skybox_wgsl. Each vec3 is
// followed by a scalar so the std140 16-byte alignment holds with no padding.
const SkyUniforms = extern struct {
    inv_vp: [16]f32,
    cam_pos: [3]f32,
    time: f32,
    sun_dir: [3]f32,
    sun_size: f32,
    zenith: [3]f32,
    haze: f32,
    horizon: [3]f32,
    cloud: f32,
    ground: [3]f32,
    sun_glow: f32,
    sun_color: [3]f32,
    night: f32,
};

comptime {
    // Size == 160 already proves there is no surprise padding; every vec3 sits
    // at a 16-byte-aligned offset followed by its scalar, matching WGSL's
    // uniform layout. (@alignOf is only 4 — no vec field — but writeBuffer is a
    // byte copy, so the field *offsets* are what must match, and they do.)
    if (@sizeOf(SkyUniforms) != 160) {
        @compileError("SkyUniforms must match skybox_wgsl uniform layout");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Geometry buffers
// ════════════════════════════════════════════════════════════════════════
//
// The framework knows ZERO shape names. Vertices arrive from @reactjit/geometries
// (TS generators) as bytes; the framework only uploads + draws them. There is no
// procedural shape generation here anymore — `generateBox`/`generateSphere`/… and
// the `generateGeometry` shape-name dispatch were deleted (the debug grid that
// depended on a hardwired box went with them).
//
// MAX_FRAME_VERTS caps the per-frame vertex buffer (the cache-full degrade path
// uploads here). Allocated once; writeBuffer only uploads bytes actually drawn,
// so a larger ceiling costs reserved GPU memory, not per-frame work.
const MAX_FRAME_VERTS = 262144;

// ── Retained geometry intern cache (@reactjit/geometries) ───────────────────
//
// A registry mesh ships its verts (already in Vertex layout) ONCE, tagged with
// an intern key. We upload each UNIQUE key into g_retained_vbuf and remember its
// (offset, count); every later frame just redraws that slice — no regeneration,
// no re-upload. This is the texture cache (getOrCreateTexBindGroup) applied to
// vertices: identical geometry across N meshes collapses to one GPU copy. The
// "240fps coconut" — regenerated every frame in the legacy path — becomes one
// upload that never runs again unless its params (hence its key) change.
const MAX_RETAINED_VERTS = 524288; // 512k verts × 32 B/vert ≈ 16 MB
const GEO_CACHE_SIZE = 512;
const GeoEntry = struct {
    hash: u64 = 0,
    offset_bytes: u64 = 0,
    count: u32 = 0,
    present: bool = false,
};
var g_geo_cache: [GEO_CACHE_SIZE]GeoEntry = [_]GeoEntry{.{}} ** GEO_CACHE_SIZE;
var g_geo_cache_len: usize = 0;
var g_retained_top: u64 = 0; // bump cursor (bytes) into g_retained_vbuf; persists across frames

const UNIFORM_STRIDE: u32 = 256;
const MAX_DRAW_UNIFORMS: u32 = 2048;


const MeshSpec = struct {
    // Geometry is supplied entirely by @reactjit/geometries: `vertices` are the
    // interleaved Vertex bytes the TS generator produced, `geom_key` is the intern
    // key. No shape name, no size/radius — dimensions live in the verts (and any
    // per-instance sizing rides in `scale`).
    geom_key: ?[]const u8 = null,
    vertices: ?[]const f32 = null, // interleaved Vertex layout
    vert_count: u32 = 0,
    position: math.Vec3 = .{},
    rotation: math.Vec3 = .{},
    scale: math.Vec3 = .{ .x = 1, .y = 1, .z = 1 },
    color: [4]f32 = .{ 0.8, 0.8, 0.8, 1.0 },
    tex_w: u32 = 0,
    tex_h: u32 = 0,
    tex_rgba: ?[]const u8 = null,
    tex_key: ?[]const u8 = null,
};

// ════════════════════════════════════════════════════════════════════════
// Pipeline state
// ════════════════════════════════════════════════════════════════════════

var g_pipeline: ?*wgpu.RenderPipeline = null;
var g_vertex_buffer: ?*wgpu.Buffer = null;
var g_retained_vbuf: ?*wgpu.Buffer = null; // persistent verts for interned registry geometry
var g_uniform_buffer: ?*wgpu.Buffer = null;
var g_bind_group: ?*wgpu.BindGroup = null;
var g_bind_group_layout: ?*wgpu.BindGroupLayout = null;
var g_tex_bind_group_layout: ?*wgpu.BindGroupLayout = null;
// Skybox: a separate pipeline + uniform buffer. Drawn as one fullscreen
// triangle before the meshes, depth-test = always / depth-write = off, so it
// fills the background and meshes paint over it. See shaders.skybox_wgsl.
var g_sky_pipeline: ?*wgpu.RenderPipeline = null;
var g_sky_uniform_buffer: ?*wgpu.Buffer = null;
var g_sky_bind_group: ?*wgpu.BindGroup = null;
var g_sky_bind_group_layout: ?*wgpu.BindGroupLayout = null;
// 1×1 white default texture so every mesh has *something* to sample —
// multiplying by white collapses to the uniform color, preserving the
// pre-texture look for meshes that don't supply their own texture.
var g_default_tex: ?*wgpu.Texture = null;
var g_default_tex_view: ?*wgpu.TextureView = null;
var g_default_tex_bind_group: ?*wgpu.BindGroup = null;
// Nearest-filter sampler for the diffuse texture path. Block-face pixels
// stay crisp; switch to linear later if smoother sampling is wanted.
var g_diffuse_sampler: ?*wgpu.Sampler = null;
var g_initialized: bool = false;

var g_sampler: ?*wgpu.Sampler = null;

// ── Render-target pool ─────────────────────────────────────────────────
//
// Each <Scene3D> instance needs its own render-to-texture surface so that
// when multiple scenes share a frame (the avatar's bust portrait next to
// the chat, plus the full-body view on /character, plus debug labs) they
// don't clobber each other's texture content before the image pipeline
// composites the quads.
//
// The pool is round-robin per frame: render() pulls the next slot, sizes
// it on first use (or on a size change), and renders into it. queueQuad
// references that slot's bind_group. frameCleanup() resets the cursor so
// the next frame reuses the same slots from the top.
//
// Slots persist across frames — only resized when a tile changes
// dimensions. With the pipeline already serialized (each frame flushes
// before the next begins), the previous frame's bind groups are no
// longer in flight by the time we recycle the slots.
const MAX_RT_POOL = 16;
const Rt = struct {
    color_texture: ?*wgpu.Texture = null,
    color_view: ?*wgpu.TextureView = null,
    depth_texture: ?*wgpu.Texture = null,
    depth_view: ?*wgpu.TextureView = null,
    composite_bind_group: ?*wgpu.BindGroup = null,
    width: u32 = 0,
    height: u32 = 0,
};
var g_rt_pool: [MAX_RT_POOL]Rt = [_]Rt{.{}} ** MAX_RT_POOL;
var g_rt_cursor: usize = 0;

// Scenes recorded by render() during the paint walk, drawn later by
// flushPending() (after StaticSurface captures). One pending entry per
// acquired RT slot, so it shares the pool's cap.
const Pending = struct { node: *Node, slot: *Rt, w: f32, h: f32 };
var g_pending: [MAX_RT_POOL]Pending = undefined;
var g_pending_count: usize = 0;

// ════════════════════════════════════════════════════════════════════════
// Init / deinit (same as before — pipeline, bind groups, sampler)
// ════════════════════════════════════════════════════════════════════════

pub fn init() void {
    const device = core.getDevice() orelse return;
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "render3d_shader", .code = shaders.scene3d_wgsl });
    const shader_module = device.createShaderModule(&shader_desc) orelse return;
    defer shader_module.release();

    g_vertex_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_verts"),
        .size = MAX_FRAME_VERTS * @sizeOf(Vertex),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    // Retained buffer for interned registry geometry — uploaded once per unique
    // key, never reset per frame (unlike g_vertex_buffer which bump-resets).
    g_retained_vbuf = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_retained_verts"),
        .size = MAX_RETAINED_VERTS * @sizeOf(Vertex),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    g_uniform_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("render3d_uniforms"),
        .size = @as(u64, UNIFORM_STRIDE) * @as(u64, MAX_DRAW_UNIFORMS),
        .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });
    g_bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = 1,
        .entries = @ptrCast(&wgpu.BindGroupLayoutEntry{
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 1, .min_binding_size = @sizeOf(SceneUniforms) },
        }),
    }) orelse return;
    g_bind_group = device.createBindGroup(&.{
        .layout = g_bind_group_layout.?,
        .entry_count = 1,
        .entries = @ptrCast(&wgpu.BindGroupEntry{
            .binding = 0,
            .buffer = g_uniform_buffer.?,
            .offset = 0,
            .size = @sizeOf(SceneUniforms),
        }),
    });

    // ── Texture bind group layout (group 1) ──
    // Per-mesh diffuse texture + sampler. Each mesh gets its own bind group
    // pointing at that mesh's texture; meshes without a texture point at
    // g_default_tex_bind_group (1×1 white).
    const tex_entries = [_]wgpu.BindGroupLayoutEntry{
        .{
            .binding = 0,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{ .sample_type = .float, .view_dimension = .@"2d", .multisampled = 0 },
        },
        .{
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            // Linear so the binding-type matches the sampler we create
            // (`.filtering` requires at least one linear filter). Linear
            // smooths the 16×16 BlockFace pixels between cells; switch
            // back to .non_filtering + nearest sampler if we want crisp
            // pixel art.
            .sampler = .{ .type = .filtering },
        },
    };
    g_tex_bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = tex_entries.len,
        .entries = &tex_entries,
    }) orelse return;

    g_diffuse_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    });

    // 1×1 white default texture so untextured meshes sample white →
    // multiply with uniform color → unchanged visual.
    g_default_tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_default_white"),
        .size = .{ .width = 1, .height = 1, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    });
    if (g_default_tex) |dtex| {
        const white_pixel = [_]u8{ 255, 255, 255, 255 };
        const queue = core.getQueue();
        if (queue) |q| {
            q.writeTexture(
                &.{ .texture = dtex, .mip_level = 0, .origin = .{}, .aspect = .all },
                @ptrCast(&white_pixel),
                white_pixel.len,
                &.{ .offset = 0, .bytes_per_row = 4, .rows_per_image = 1 },
                &.{ .width = 1, .height = 1, .depth_or_array_layers = 1 },
            );
        }
        g_default_tex_view = dtex.createView(&.{
            .format = .rgba8_unorm,
            .dimension = .@"2d",
            .base_mip_level = 0,
            .mip_level_count = 1,
            .base_array_layer = 0,
            .array_layer_count = 1,
            .aspect = .all,
        });
    }
    if (g_default_tex_view != null and g_diffuse_sampler != null) {
        const def_entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .texture_view = g_default_tex_view.? },
            .{ .binding = 1, .sampler = g_diffuse_sampler.? },
        };
        g_default_tex_bind_group = device.createBindGroup(&.{
            .layout = g_tex_bind_group_layout.?,
            .entry_count = def_entries.len,
            .entries = &def_entries,
        });
    }

    const layouts = [_]?*wgpu.BindGroupLayout{ g_bind_group_layout.?, g_tex_bind_group_layout.? };
    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = layouts.len,
        .bind_group_layouts = @ptrCast(&layouts),
    }) orelse return;
    defer pipeline_layout.release();
    const vert_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
        .{ .format = .float32x3, .offset = 12, .shader_location = 1 },
        .{ .format = .float32x2, .offset = 24, .shader_location = 2 },
    };
    const vert_layout = wgpu.VertexBufferLayout{
        .step_mode = .vertex,
        .array_stride = @sizeOf(Vertex),
        .attribute_count = vert_attrs.len,
        .attributes = &vert_attrs,
    };
    const color_target = wgpu.ColorTargetState{
        .format = .rgba8_unorm,
        .blend = &wgpu.BlendState.premultiplied_alpha_blending,
        .write_mask = wgpu.ColorWriteMasks.all,
    };
    const frag = wgpu.FragmentState{
        .module = shader_module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };
    const depth_stencil = wgpu.DepthStencilState{
        .format = .depth24_plus,
        .depth_write_enabled = .true,
        .depth_compare = .less,
        .stencil_front = .{},
        .stencil_back = .{},
    };
    g_pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{ .module = shader_module, .entry_point = wgpu.StringView.fromSlice("vs_main"), .buffer_count = 1, .buffers = @ptrCast(&vert_layout) },
        .primitive = .{ .topology = .triangle_list, .cull_mode = .back, .front_face = .ccw },
        .depth_stencil = &depth_stencil,
        .multisample = .{},
        .fragment = &frag,
    });
    g_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    });

    // ── Skybox pipeline ──
    // One uniform buffer (group 0), a fullscreen triangle generated from
    // @builtin(vertex_index) (no vertex buffer), no culling, and depth
    // compare = always with depth-write off so the sky never occludes the
    // meshes drawn after it. Same rgba8 color target as the mesh pipeline.
    const sky_desc = wgpu.shaderModuleWGSLDescriptor(.{ .label = "skybox_shader", .code = shaders.skybox_wgsl });
    const sky_shader = device.createShaderModule(&sky_desc);
    if (sky_shader) |sky_mod| {
        defer sky_mod.release();
        g_sky_uniform_buffer = device.createBuffer(&.{
            .label = wgpu.StringView.fromSlice("skybox_uniforms"),
            .size = @sizeOf(SkyUniforms),
            .usage = wgpu.BufferUsages.uniform | wgpu.BufferUsages.copy_dst,
            .mapped_at_creation = 0,
        });
        g_sky_bind_group_layout = device.createBindGroupLayout(&.{
            .entry_count = 1,
            .entries = @ptrCast(&wgpu.BindGroupLayoutEntry{
                .binding = 0,
                .visibility = wgpu.ShaderStages.vertex | wgpu.ShaderStages.fragment,
                .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = @sizeOf(SkyUniforms) },
            }),
        });
        if (g_sky_bind_group_layout != null and g_sky_uniform_buffer != null) {
            g_sky_bind_group = device.createBindGroup(&.{
                .layout = g_sky_bind_group_layout.?,
                .entry_count = 1,
                .entries = @ptrCast(&wgpu.BindGroupEntry{
                    .binding = 0,
                    .buffer = g_sky_uniform_buffer.?,
                    .offset = 0,
                    .size = @sizeOf(SkyUniforms),
                }),
            });
            const sky_layout = [_]?*wgpu.BindGroupLayout{g_sky_bind_group_layout.?};
            const sky_pipeline_layout = device.createPipelineLayout(&.{
                .bind_group_layout_count = sky_layout.len,
                .bind_group_layouts = @ptrCast(&sky_layout),
            });
            if (sky_pipeline_layout) |spl| {
                defer spl.release();
                const sky_color_target = wgpu.ColorTargetState{
                    .format = .rgba8_unorm,
                    .blend = &wgpu.BlendState.premultiplied_alpha_blending,
                    .write_mask = wgpu.ColorWriteMasks.all,
                };
                const sky_frag = wgpu.FragmentState{
                    .module = sky_mod,
                    .entry_point = wgpu.StringView.fromSlice("sky_fs"),
                    .target_count = 1,
                    .targets = @ptrCast(&sky_color_target),
                };
                const sky_depth = wgpu.DepthStencilState{
                    .format = .depth24_plus,
                    .depth_write_enabled = .false,
                    .depth_compare = .always,
                    .stencil_front = .{},
                    .stencil_back = .{},
                };
                g_sky_pipeline = device.createRenderPipeline(&.{
                    .layout = spl,
                    .vertex = .{ .module = sky_mod, .entry_point = wgpu.StringView.fromSlice("sky_vs"), .buffer_count = 0 },
                    .primitive = .{ .topology = .triangle_list, .cull_mode = .none, .front_face = .ccw },
                    .depth_stencil = &sky_depth,
                    .multisample = .{},
                    .fragment = &sky_frag,
                });
            }
        }
    }

    g_initialized = g_pipeline != null;
}

pub fn getTexBindGroupLayout() ?*wgpu.BindGroupLayout {
    return g_tex_bind_group_layout;
}

pub fn deinit() void {
    // Release every pool slot's resources.
    for (0..MAX_RT_POOL) |i| {
        const slot = &g_rt_pool[i];
        if (slot.composite_bind_group) |bg| bg.release();
        if (slot.depth_view) |v| v.release();
        if (slot.depth_texture) |t| t.destroy();
        if (slot.color_view) |v| v.release();
        if (slot.color_texture) |t| t.destroy();
        slot.* = .{};
    }
    g_rt_cursor = 0;
    for (&g_tex_cache) |*e| dropTexEntry(e);
    if (g_sampler) |s| s.release();
    if (g_default_tex_bind_group) |bg| bg.release();
    if (g_default_tex_view) |v| v.release();
    if (g_default_tex) |t| t.destroy();
    if (g_diffuse_sampler) |s| s.release();
    if (g_tex_bind_group_layout) |l| l.release();
    if (g_bind_group) |bg| bg.release();
    if (g_bind_group_layout) |l| l.release();
    if (g_uniform_buffer) |b| b.release();
    if (g_vertex_buffer) |b| b.release();
    if (g_pipeline) |p| p.release();
    if (g_sky_bind_group) |bg| bg.release();
    if (g_sky_bind_group_layout) |l| l.release();
    if (g_sky_uniform_buffer) |b| b.release();
    if (g_sky_pipeline) |p| p.release();
    g_initialized = false;
}

/// Reset the per-frame RT cursor so the next frame reuses pool slots from
/// the top. Slots themselves stay alive across frames — only resized when
/// a tile changes dimensions. Must be called AFTER images.drawAll() so the
/// previous frame's quads have all been sampled.
pub fn frameCleanup() void {
    g_rt_cursor = 0;
}

/// Acquire the next RT slot for this frame. Returns null on pool exhaustion
/// or device failure. Slots are reused across frames; resized lazily when
/// a tile's dimensions change.
fn acquireRt(w: u32, h: u32) ?*Rt {
    if (w == 0 or h == 0) return null;
    if (g_rt_cursor >= MAX_RT_POOL) return null;
    const slot = &g_rt_pool[g_rt_cursor];
    g_rt_cursor += 1;
    if (slot.width == w and slot.height == h and slot.color_view != null) return slot;

    const device = core.getDevice() orelse return null;

    // Drop the slot's previous resources. Frame loop is serial — by the
    // time we recycle a slot across frames, the prior frame's quads have
    // already been drawn and the bind group is no longer in flight.
    if (slot.composite_bind_group) |bg| bg.release();
    if (slot.depth_view) |v| v.release();
    if (slot.depth_texture) |t| t.destroy();
    if (slot.color_view) |v| v.release();
    if (slot.color_texture) |t| t.destroy();
    slot.* = .{};

    slot.color_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_color"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.render_attachment | wgpu.TextureUsages.texture_binding,
    }) orelse return null;
    slot.color_view = slot.color_texture.?.createView(&.{
        .format = .rgba8_unorm,
        .dimension = .@"2d",
        .base_mip_level = 0,
        .mip_level_count = 1,
        .base_array_layer = 0,
        .array_layer_count = 1,
        .aspect = .all,
    }) orelse return null;
    slot.depth_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_depth"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .depth24_plus,
        .usage = wgpu.TextureUsages.render_attachment,
    }) orelse return null;
    slot.depth_view = slot.depth_texture.?.createView(&.{
        .format = .depth24_plus,
        .dimension = .@"2d",
        .base_mip_level = 0,
        .mip_level_count = 1,
        .base_array_layer = 0,
        .array_layer_count = 1,
        .aspect = .all,
    }) orelse return null;
    if (g_sampler) |sampler| slot.composite_bind_group = images.createBindGroup(slot.color_view.?, sampler);
    slot.width = w;
    slot.height = h;
    return slot;
}

fn max3(a: f32, b: f32, c: f32) f32 {
    return @max(a, @max(b, c));
}

fn estimateMeshRadius(node: *const Node) f32 {
    const sx = @abs(node.scene3d_scale_x);
    const sy = @abs(node.scene3d_scale_y);
    const sz = @abs(node.scene3d_scale_z);
    // The generator ships its own unscaled bounds — cull off that × max scale. No
    // per-shape switch; this is what lets the framework cull a shape it knows
    // nothing about. A node without bounds (broken legacy mesh) culls as ~unit.
    if (node.scene3d_bounds_radius > 0) {
        return node.scene3d_bounds_radius * max3(sx, sy, sz);
    }
    return max3(sx, sy, sz);
}

fn buildMeshSpec(node: *const Node) MeshSpec {
    return .{
        .geom_key = node.scene3d_geom_key,
        .vertices = node.scene3d_vertices,
        .vert_count = node.scene3d_vert_count,
        .position = .{ .x = node.scene3d_pos_x, .y = node.scene3d_pos_y, .z = node.scene3d_pos_z },
        .rotation = .{ .x = node.scene3d_rot_x, .y = node.scene3d_rot_y, .z = node.scene3d_rot_z },
        .scale = .{ .x = node.scene3d_scale_x, .y = node.scene3d_scale_y, .z = node.scene3d_scale_z },
        .color = .{ node.scene3d_color_r, node.scene3d_color_g, node.scene3d_color_b, 1.0 },
        .tex_w = node.scene3d_tex_w,
        .tex_h = node.scene3d_tex_h,
        .tex_rgba = node.scene3d_tex_rgba,
        .tex_key = node.scene3d_tex_key,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Per-mesh diffuse texture cache.
//
// v8_app.zig allocates a fresh RGBA byte buffer on every prop commit, so
// caching by pointer would miss every render. Instead the cache keys on a
// content hash of (w, h, bytes); identical textures across renders or
// across multiple meshes collapse to a single uploaded GPU texture.
//
// Eviction: FIFO when full. Cap is small because the moonshot expects
// only a handful of distinct face textures live at once.
// ════════════════════════════════════════════════════════════════════════

const TEX_CACHE_SIZE = 16;
const TexEntry = struct {
    hash: u64 = 0,
    w: u32 = 0,
    h: u32 = 0,
    tex: ?*wgpu.Texture = null,
    view: ?*wgpu.TextureView = null,
    bind_group: ?*wgpu.BindGroup = null,
};
var g_tex_cache: [TEX_CACHE_SIZE]TexEntry = [_]TexEntry{.{}} ** TEX_CACHE_SIZE;

fn hashTex(w: u32, h: u32, data: []const u8) u64 {
    var h64: u64 = 0xcbf29ce484222325;
    h64 ^= @as(u64, w);
    h64 *%= 0x100000001b3;
    h64 ^= @as(u64, h);
    h64 *%= 0x100000001b3;
    for (data) |byte| {
        h64 ^= byte;
        h64 *%= 0x100000001b3;
    }
    return h64;
}

fn dropTexEntry(e: *TexEntry) void {
    if (e.bind_group) |bg| bg.release();
    if (e.view) |v| v.release();
    if (e.tex) |t| t.destroy();
    e.* = .{};
}

fn getOrCreateTexBindGroup(rgba: []const u8, w: u32, h: u32) ?*wgpu.BindGroup {
    if (w == 0 or h == 0) return null;
    if (rgba.len != @as(usize, w) * @as(usize, h) * 4) return null;
    const hash = hashTex(w, h, rgba);

    for (&g_tex_cache) |*e| {
        if (e.bind_group != null and e.hash == hash and e.w == w and e.h == h) {
            return e.bind_group;
        }
    }

    var slot: ?*TexEntry = null;
    for (&g_tex_cache) |*e| {
        if (e.bind_group == null) {
            slot = e;
            break;
        }
    }
    if (slot == null) {
        // FIFO: drop slot 0, shift left, reuse last.
        dropTexEntry(&g_tex_cache[0]);
        var i: usize = 1;
        while (i < TEX_CACHE_SIZE) : (i += 1) {
            g_tex_cache[i - 1] = g_tex_cache[i];
        }
        g_tex_cache[TEX_CACHE_SIZE - 1] = .{};
        slot = &g_tex_cache[TEX_CACHE_SIZE - 1];
    }

    const device = core.getDevice() orelse return null;
    const queue = core.getQueue() orelse return null;
    const tex = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("r3d_diffuse"),
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    }) orelse return null;
    queue.writeTexture(
        &.{ .texture = tex, .mip_level = 0, .origin = .{}, .aspect = .all },
        @ptrCast(rgba.ptr),
        rgba.len,
        &.{ .offset = 0, .bytes_per_row = w * 4, .rows_per_image = h },
        &.{ .width = w, .height = h, .depth_or_array_layers = 1 },
    );
    const view = tex.createView(&.{
        .format = .rgba8_unorm,
        .dimension = .@"2d",
        .base_mip_level = 0,
        .mip_level_count = 1,
        .base_array_layer = 0,
        .array_layer_count = 1,
        .aspect = .all,
    }) orelse {
        tex.destroy();
        return null;
    };
    const sampler = g_diffuse_sampler orelse {
        view.release();
        tex.destroy();
        return null;
    };
    const layout_ = g_tex_bind_group_layout orelse {
        view.release();
        tex.destroy();
        return null;
    };
    const entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .texture_view = view },
        .{ .binding = 1, .sampler = sampler },
    };
    const bg = device.createBindGroup(&.{
        .layout = layout_,
        .entry_count = entries.len,
        .entries = &entries,
    }) orelse {
        view.release();
        tex.destroy();
        return null;
    };
    slot.?.* = .{ .hash = hash, .w = w, .h = h, .tex = tex, .view = view, .bind_group = bg };
    return bg;
}

fn hashKey(key: []const u8) u64 {
    var h: u64 = 0xcbf29ce484222325;
    for (key) |byte| {
        h ^= byte;
        h *%= 0x100000001b3;
    }
    return h;
}

const GeoSlice = struct { offset: u64, count: u32 };

// Resolve a geometry key to a retained (offset, count), uploading the verts on
// first sight. Returns null when the cache or retained buffer is full — the
// caller then falls back to a per-frame upload (correct, just not retained).
fn internGeometry(queue: *wgpu.Queue, key: []const u8, verts: []const f32, count: u32) ?GeoSlice {
    const hash = hashKey(key);
    for (g_geo_cache[0..g_geo_cache_len]) |*e| {
        if (e.present and e.hash == hash) return .{ .offset = e.offset_bytes, .count = e.count };
    }
    if (g_geo_cache_len >= GEO_CACHE_SIZE) return null;
    const buf = g_retained_vbuf orelse return null;
    const bytes: u64 = @as(u64, count) * @sizeOf(Vertex);
    if (g_retained_top + bytes > @as(u64, MAX_RETAINED_VERTS) * @sizeOf(Vertex)) return null;
    queue.writeBuffer(buf, g_retained_top, @ptrCast(verts.ptr), bytes);
    const off = g_retained_top;
    g_retained_top += bytes;
    g_geo_cache[g_geo_cache_len] = .{ .hash = hash, .offset_bytes = off, .count = count, .present = true };
    g_geo_cache_len += 1;
    return .{ .offset = off, .count = count };
}

fn drawMesh(pass: anytype, queue: *wgpu.Queue, uniform_index: *u32, vert_byte_offset: *u64, vp: math.Mat4, cam_pos: math.Vec3, light_dir: [3]f32, light_color: [3]f32, ambient_color: [3]f32, fog_color: [3]f32, fog_near: f32, fog_far: f32, spec: MeshSpec) void {
    // ── Resolve the vertex source ──
    // Registry mesh (geom_key set): redraw a RETAINED slice — uploaded once on
    // first sight, no per-frame work. On cache/buffer overflow it degrades to a
    // per-frame upload. No geom_key = no geometry → nothing drawn.
    var draw_buffer: *wgpu.Buffer = undefined;
    var draw_offset: u64 = 0;
    var vert_count: u32 = 0;
    var advance_frame_buf = false;
    const frame_cap_bytes: u64 = @as(u64, MAX_FRAME_VERTS) * @sizeOf(Vertex);

    if (spec.geom_key) |key| {
        const verts = spec.vertices orelse return;
        if (spec.vert_count == 0) return;
        if (verts.len < @as(usize, spec.vert_count) * 8) return; // 8 floats/vertex
        if (internGeometry(queue, key, verts, spec.vert_count)) |slot| {
            draw_buffer = g_retained_vbuf.?;
            draw_offset = slot.offset;
            vert_count = slot.count;
        } else {
            // Cache/buffer full — degrade to a per-frame upload (still correct).
            const bytes: u64 = @as(u64, spec.vert_count) * @sizeOf(Vertex);
            if (vert_byte_offset.* + bytes > frame_cap_bytes) return;
            queue.writeBuffer(g_vertex_buffer.?, vert_byte_offset.*, @ptrCast(verts.ptr), bytes);
            draw_buffer = g_vertex_buffer.?;
            draw_offset = vert_byte_offset.*;
            vert_count = spec.vert_count;
            advance_frame_buf = true;
        }
    } else {
        // No geometry supplied. A cart still on the removed string-geometry path
        // lands here and draws nothing — the intended breakage that forces it onto
        // @reactjit/geometries.
        return;
    }
    if (uniform_index.* >= MAX_DRAW_UNIFORMS) return;
    const vert_bytes: u64 = @as(u64, vert_count) * @sizeOf(Vertex);

    const deg2rad = std.math.pi / 180.0;
    var model = math.m4scale(math.m4identity(), spec.scale);
    model = math.m4multiply(math.m4rotateZ(math.m4identity(), spec.rotation.z * deg2rad), model);
    model = math.m4multiply(math.m4rotateX(math.m4identity(), spec.rotation.x * deg2rad), model);
    model = math.m4multiply(math.m4rotateY(math.m4identity(), spec.rotation.y * deg2rad), model);
    model = math.m4multiply(math.m4translate(math.m4identity(), spec.position), model);

    const uniforms = SceneUniforms{
        .mvp = math.m4transpose(math.m4multiply(vp, model)),
        .model = math.m4transpose(model),
        .light_dir = light_dir,
        .specular_power = 64.0,
        .light_color = light_color,
        .ambient_color = ambient_color,
        .camera_pos = .{ cam_pos.x, cam_pos.y, cam_pos.z },
        .color = spec.color,
        .fog_color = fog_color,
        .fog_near = fog_near,
        .fog_far = fog_far,
    };
    const dynamic_offset = uniform_index.* * UNIFORM_STRIDE;
    queue.writeBuffer(g_uniform_buffer.?, dynamic_offset, @ptrCast(&uniforms), @sizeOf(SceneUniforms));
    uniform_index.* += 1;
    pass.setBindGroup(0, g_bind_group.?, 1, @ptrCast(&dynamic_offset));
    var tex_bg: ?*wgpu.BindGroup = g_default_tex_bind_group;
    if (spec.tex_rgba) |rgba| {
        if (getOrCreateTexBindGroup(rgba, spec.tex_w, spec.tex_h)) |bg| tex_bg = bg;
    }
    if (spec.tex_key) |key| {
        if (images.staticSurfaceBindGroup3D(key)) |bg| tex_bg = bg;
    }
    if (tex_bg) |bg| pass.setBindGroup(1, bg, 0, null);
    pass.setVertexBuffer(0, draw_buffer, draw_offset, vert_bytes);
    pass.draw(vert_count, 1, 0, 0);
    if (advance_frame_buf) vert_byte_offset.* += vert_bytes;
}


// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

pub fn update(_: f32) void {
    // Clear scenes recorded but never flushed (e.g. a frame where gpu.frame()
    // bailed before flushPending). Runs before the paint walk each frame.
    g_pending_count = 0;
}

/// Render a 3D.View node: walk children for 3D.Camera/Light/Mesh, draw to offscreen, composite.
pub fn render(node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    if (!g_initialized) init();
    if (!g_initialized) return false;
    const iw: u32 = @intFromFloat(@max(1, w));
    const ih: u32 = @intFromFloat(@max(1, h));
    const slot = acquireRt(iw, ih) orelse return false;

    // render() runs during the paint WALK and only RECORDS the scene. The
    // actual GPU pass is deferred to flushPending(), which gpu.frame() calls
    // AFTER renderStaticSurfaceCaptures(). That ordering is the whole point:
    // a mesh that samples a <StaticSurface> via textureKey (a billboard, a
    // screen) then reads THIS frame's captured content instead of last
    // frame's — fixing the one-frame-stale / first-frame-blank monitor.
    if (g_pending_count < g_pending.len) {
        g_pending[g_pending_count] = .{ .node = node, .slot = slot, .w = w, .h = h };
        g_pending_count += 1;
    }

    // Queue the composite quad NOW so the 3D view holds its z-order/position
    // in the 2D draw stream; its bind group points at slot.color_view, which
    // flushPending() fills before the main 2D pass samples it.
    if (slot.composite_bind_group) |bg| {
        // No-flip variant: the 3D pipeline writes the render-to-texture
        // already in final screen orientation, so the default Y-flip the
        // image compositor applies (correct for top-down sprite sources)
        // would invert the scene.
        images.queueQuadNoFlip(x, y, w, h, opacity, bg);
        return true;
    }
    return false;
}

// Draw every scene recorded by render() this frame. Called once from
// gpu.frame(), after StaticSurface captures and before the main 2D pass, so
// textureKey-sampled surfaces are already populated for this frame.
pub fn flushPending() void {
    for (g_pending[0..g_pending_count]) |p| drawScene(p.node, p.slot, p.w, p.h);
    g_pending_count = 0;
}

// Draw the analytic skybox as one fullscreen triangle. Reconstructs each
// pixel's world ray from inv(vp) in the shader, so the only data it needs is
// that inverse, the camera position, a wrapped wall-clock for cloud drift, and
// the sky colour/sun/haze/cloud/night params off the Scene3D node.
fn drawSky(pass: anytype, queue: *wgpu.Queue, node: *Node, vp: math.Mat4, cam_pos: math.Vec3) void {
    const sky_pipeline = g_sky_pipeline orelse return;
    const sky_bg = g_sky_bind_group orelse return;
    const sky_buf = g_sky_uniform_buffer orelse return;
    const inv_vp = math.m4invert(vp) orelse return;

    // Wrap the clock so float32 keeps cloud-noise precision (a raw epoch in
    // seconds is ~1.7e9 and quantises the drift to a stutter).
    const t: f32 = @as(f32, @floatFromInt(@mod(std.time.milliTimestamp(), 1_000_000))) / 1000.0;

    const u = SkyUniforms{
        .inv_vp = inv_vp,
        .cam_pos = .{ cam_pos.x, cam_pos.y, cam_pos.z },
        .time = t,
        .sun_dir = node.scene3d_sky_sun_dir,
        .sun_size = node.scene3d_sky_sun_size,
        .zenith = node.scene3d_sky_zenith,
        .haze = node.scene3d_sky_haze,
        .horizon = node.scene3d_sky_horizon,
        .cloud = node.scene3d_sky_cloud,
        .ground = node.scene3d_sky_ground,
        .sun_glow = node.scene3d_sky_sun_glow,
        .sun_color = node.scene3d_sky_sun_color,
        .night = node.scene3d_sky_night,
    };
    queue.writeBuffer(sky_buf, 0, @ptrCast(&u), @sizeOf(SkyUniforms));

    pass.setPipeline(sky_pipeline);
    pass.setBindGroup(0, sky_bg, 0, null);
    pass.draw(3, 1, 0, 0);
}

fn drawScene(node: *Node, slot: *Rt, w: f32, h: f32) void {
    const queue = core.getQueue() orelse return;
    const device = core.getDevice() orelse return;

    // ── Extract camera, lights, meshes from children ──
    var cam_pos = math.Vec3{ .x = 0, .y = 5, .z = 10 };
    var cam_look = math.Vec3{ .x = 0, .y = 0, .z = 0 };
    var cam_fov: f32 = 60;
    var ambient_color: [3]f32 = .{ 0.15, 0.15, 0.2 };
    var light_dir: [3]f32 = .{ 0.577, 0.577, 0.577 };
    var light_color: [3]f32 = .{ 1.0, 0.95, 0.9 };
    var clear_color: [3]f32 = .{ 0.05, 0.05, 0.08 };
    if (node.style.background_color) |bg| {
        clear_color = .{
            @as(f32, @floatFromInt(bg.r)) / 255.0,
            @as(f32, @floatFromInt(bg.g)) / 255.0,
            @as(f32, @floatFromInt(bg.b)) / 255.0,
        };
    }
    // <Scene3D.Skybox> is a child View carrying scene3d_skybox + the sky_*
    // params, the same way Camera/Light are. Captured here, used for both the
    // sky draw and the horizon-coloured distance fog.
    var sky_node: ?*Node = null;

    for (node.children) |*child| {
        if (child.scene3d_skybox) sky_node = child;
        if (child.scene3d_camera) {
            cam_pos = .{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
            cam_look = .{ .x = child.scene3d_look_x, .y = child.scene3d_look_y, .z = child.scene3d_look_z };
            cam_fov = child.scene3d_fov;
        }
        if (child.scene3d_light) {
            if (child.scene3d_light_type) |lt| {
                const i = child.scene3d_intensity;
                if (std.mem.eql(u8, lt, "ambient")) {
                    ambient_color = .{ child.scene3d_color_r * i, child.scene3d_color_g * i, child.scene3d_color_b * i };
                } else if (std.mem.eql(u8, lt, "directional")) {
                    const dx = child.scene3d_dir_x;
                    const dy = child.scene3d_dir_y;
                    const dz = child.scene3d_dir_z;
                    const len = math.length3(dx, dy, dz);
                    if (len > 0.001) {
                        light_dir = .{ dx / len, dy / len, dz / len };
                    }
                    light_color = .{ child.scene3d_color_r * i, child.scene3d_color_g * i, child.scene3d_color_b * i };
                }
            }
        }
    }

    const focus_dist = math.v3distance(cam_pos, cam_look);
    var scene_extent: f32 = @max(8.0, focus_dist);
    for (node.children) |*child| {
        if (!child.scene3d_mesh) continue;
        const center = math.Vec3{ .x = child.scene3d_pos_x, .y = child.scene3d_pos_y, .z = child.scene3d_pos_z };
        scene_extent = @max(scene_extent, math.v3distance(center, cam_look) + estimateMeshRadius(child));
    }
    if (node.scene3d_show_grid or node.scene3d_show_axes) {
        scene_extent = @max(scene_extent, focus_dist * 1.8);
    }
    const fog_near = @max(6.0, focus_dist * 0.9);
    const fog_far = @max(fog_near + 12.0, fog_near + scene_extent * 1.5);

    // ── Build view + projection ──
    const aspect = w / @max(h, 1);
    const fov_rad = cam_fov * std.math.pi / 180.0;
    const projection = math.m4perspective(fov_rad, aspect, 0.1, 1000.0);
    const view = math.m4lookAt(cam_pos, cam_look, .{ .x = 0, .y = 1, .z = 0 });
    const vp = math.m4multiply(projection, view);

    // With a skybox, distant geometry should melt into the HORIZON colour, not
    // the flat clear colour — that distance fade is most of what sells the sky.
    const fog_color: [3]f32 = if (sky_node) |s| s.scene3d_sky_horizon else clear_color;

    // ── Begin render pass ──
    const color_view = slot.color_view orelse return;
    const depth_view = slot.depth_view orelse return;
    const encoder = device.createCommandEncoder(&.{ .label = wgpu.StringView.fromSlice("r3d") }) orelse return;
    const pass = encoder.beginRenderPass(&.{
        .color_attachment_count = 1,
        .color_attachments = @ptrCast(&wgpu.ColorAttachment{
            .view = color_view,
            .load_op = .clear,
            .store_op = .store,
            .clear_value = .{ .r = clear_color[0], .g = clear_color[1], .b = clear_color[2], .a = 1.0 },
        }),
        .depth_stencil_attachment = &wgpu.DepthStencilAttachment{
            .view = depth_view,
            .depth_load_op = .clear,
            .depth_store_op = .store,
            .depth_clear_value = 1.0,
            .stencil_load_op = .clear,
            .stencil_store_op = .store,
            .stencil_clear_value = 0,
        },
    }) orelse {
        encoder.release();
        return;
    };

    // ── Skybox first: fills the whole target behind the meshes ──
    if (sky_node) |s| drawSky(pass, queue, s, vp, cam_pos);

    pass.setPipeline(g_pipeline.?);
    var uniform_index: u32 = 0;
    var vert_byte_offset: u64 = 0;

    // ── Draw each mesh ──
    for (node.children) |*child| {
        if (!child.scene3d_mesh) continue;
        drawMesh(pass, queue, &uniform_index, &vert_byte_offset, vp, cam_pos, light_dir, light_color, ambient_color, fog_color, fog_near, fog_far, buildMeshSpec(child));
    }

    // (showGrid/showAxes were drawn via a hardwired box; that debug grid was
    // removed with the rest of the shape coupling. Re-add later via @reactjit/
    // geometries if wanted — the flags are currently inert.)

    pass.end();
    pass.release();
    const command = encoder.finish(&.{ .label = wgpu.StringView.fromSlice("r3d_cmd") }) orelse {
        encoder.release();
        return;
    };
    encoder.release();
    queue.submit(&.{command});
    command.release();
}
